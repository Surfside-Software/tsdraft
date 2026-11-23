// The fifth check of `tsdraft write`, the changed sheets: each layout of each file of the job, drawn
// as it plots from the project and again with every copy that passed the other checks in place of
// its source, in the process that keeps the reads, `worker.ts`. Each layout whose picture differs
// is drawn as a PNG and plotted to a PDF here.
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { DrawnSheet, SheetsRequest, WorkerMessage } from "./worker.ts";

const workerPath = fileURLToPath(
  new URL(import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js", import.meta.url),
);

/** The heap of the process that draws the sheets, in MB, as a write's edit has. */
const HEAP_MB = 4096;

/** What `drawSheets` is asked: the files, the copies in place, and how long it may take. */
export interface SheetsJob {
  readonly files: readonly string[];
  readonly copies: SheetsRequest["copies"];
  readonly shows: SheetsRequest["shows"];
  readonly reader?: string | undefined;
  readonly cwd: string;
  readonly timeoutMs: number;
}

/**
 * The layouts of the job's files whose pictures the copies change, each with its picture, and each
 * file or layout that could not be drawn with its reason; or why none could be drawn at all.
 */
export function drawSheets(job: SheetsJob): Promise<readonly DrawnSheet[] | string> {
  return new Promise((settle) => {
    let child: ReturnType<typeof fork>;

    try {
      child = fork(workerPath, [], {
        serialization: "advanced",
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        execArgv: ["--disable-warning=ExperimentalWarning", `--max-old-space-size=${HEAP_MB}`],
      });
    } catch (error) {
      settle(
        `its process could not start: ${error instanceof Error ? error.message : String(error)}`,
      );

      return;
    }

    let settled = false;

    const done = (answer: readonly DrawnSheet[] | string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      settle(answer);
    };

    const timer = setTimeout(
      () => done(`it took longer than ${job.timeoutMs / 1000} s, and was ended`),
      job.timeoutMs,
    );

    const request: SheetsRequest = {
      type: "sheets",
      id: 1,
      files: job.files,
      copies: job.copies,
      shows: job.shows,
      ...(job.reader !== undefined && { reader: job.reader }),
      cwd: job.cwd,
    };

    child.on("message", (m: WorkerMessage) => {
      if (m.type === "ready")
        child.send(request, (error) => error && done(`it could not be asked: ${error.message}`));
      else if (m.type === "sheeted" && m.id === 1) done(m.sheets);
    });
    child.once("error", (error) => done(`its process failed: ${error.message}`));
    child.once("exit", (code, signal) =>
      done(`its process ended with ${signal ?? `exit code ${code}`} before it answered`),
    );
  });
}

/**
 * The stem of a layout's pictures, `<name>.layout-<layout>`, as `tsdraft render` names them, and
 * one not taken yet among `taken`, which holds the stems of the job by their paths in lower case.
 */
export function sheetStem(
  folder: string,
  name: string,
  layout: string,
  taken: Set<string>,
): string {
  const safe = layout.replaceAll(/[^A-Za-z0-9._-]/g, "_");
  let stem = `${name}.layout-${safe}`;

  for (let n = 2; taken.has(`${folder}/${stem}`.toLowerCase()); n++)
    stem = `${name}.layout-${safe}-${n}`;
  taken.add(`${folder}/${stem}`.toLowerCase());

  return stem;
}
