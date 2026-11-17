// The plot of a drawing's sheets as a PDF, made from the pictures of its layouts with the
// command's own copy of tsdraft, so a drawing whose copy is older still plots. Each plot runs in
// a process of its own, `pdf-child.ts`, one at a time, with a deadline and a cap on its heap: a
// plot too large for its time or for the machine's memory costs that plot alone.
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { PdfAnswer, PdfRequest } from "./pdf-child.ts";

const childPath = fileURLToPath(
  new URL(import.meta.url.endsWith(".ts") ? "./pdf-child.ts" : "./pdf-child.js", import.meta.url),
);

/** How long one plot may take. */
const DEADLINE_MS = 120_000;

/** The most heap one plot's process may hold, in megabytes. */
const HEAP_MB = 4096;

/**
 * A PDF of the pictures, one page each, with the characters each page lacks in the order of the
 * pictures, or why there is none.
 */
export type Plotted =
  | {
      readonly pdf: Uint8Array;
      readonly missing: readonly string[];
      readonly error: null;
    }
  | { readonly pdf: null; readonly missing: null; readonly error: string };

/** The plot running, which the next waits for: plots run one at a time. */
let running: Promise<unknown> = Promise.resolve();

export function plot(pictures: readonly string[]): Promise<Plotted> {
  const next = running.then(() => plotNow(pictures));
  running = next;
  return next;
}

function plotNow(pictures: readonly string[]): Promise<Plotted> {
  const failed = (why: string): Plotted => ({
    pdf: null,
    missing: null,
    error: `The sheets could not be plotted: ${why}`,
  });
  return new Promise((resolve) => {
    let child: ReturnType<typeof fork>;
    try {
      child = fork(childPath, [], {
        serialization: "advanced",
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        execArgv: [`--max-old-space-size=${HEAP_MB}`],
      });
    } catch (error) {
      resolve(failed((error as Error).message));
      return;
    }
    let settled = false;
    // The process waits once it has answered, so its end before an answer is always a failure.
    const settle = (plotted: Plotted): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null) child.kill();
      resolve(plotted);
    };
    const timer = setTimeout(
      () => settle(failed(`it took longer than ${DEADLINE_MS / 1000} seconds`)),
      DEADLINE_MS,
    );
    child.once("message", (answer: PdfAnswer) =>
      settle(
        "pdf" in answer
          ? { pdf: answer.pdf, missing: answer.missing, error: null }
          : failed(answer.error),
      ),
    );
    child.once("error", (error) => settle(failed(error.message)));
    child.once("exit", (code, signal) =>
      settle(failed(`its process ended with ${signal ?? `exit code ${code}`}`)),
    );
    child.send({ pictures } satisfies PdfRequest, (error) => {
      if (error) settle(failed(error.message));
    });
  });
}
