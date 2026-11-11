// Draws the preview SVG as a PNG with resvg, which needs no browser and no system program. The
// renderer runs in a process of its own, `png-child.ts`, because a fault in its native module
// ends the process it is in.
import { fork, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { PngAnswer, PngRequest } from "./png-child.ts";

const require = createRequire(import.meta.url);

const childPath = fileURLToPath(
  new URL(import.meta.url.endsWith(".ts") ? "./png-child.ts" : "./png-child.js", import.meta.url),
);

/** The most pixels one PNG may have: 16 million, 64 MB while it is drawn. */
export const MAX_PIXELS = 16_000_000;

let unavailable: string | null | undefined;

/**
 * Why no PNG can be made, or `null` when one can. The renderer is an optional dependency, so it
 * is absent after an install that left optional packages out, and on a platform it has no build
 * for. Loads the renderer on the first call, to see that it loads. It draws nothing here.
 */
export function pngUnavailable(): string | null {
  if (unavailable !== undefined) return unavailable;
  try {
    require("@resvg/resvg-js");
    unavailable = null;
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException;
    const cause = String(message).split("\n")[0];
    // The package itself is missing, or it is there and its native part is not.
    unavailable =
      code === "MODULE_NOT_FOUND" && cause?.includes("'@resvg/resvg-js'")
        ? `No PNG: the renderer @resvg/resvg-js, an optional dependency of tsdraft, is not ` +
          `installed. Install it with "npm i -D @resvg/resvg-js", or use the SVG`
        : `No PNG: the renderer @resvg/resvg-js has no build that loads on this platform, ` +
          `${process.platform} ${process.arch} (${cause}). Use the SVG`;
  }
  return unavailable;
}

/**
 * Thrown for a picture the renderer gave no PNG for: its process could not be started, died
 * while it drew the picture, or answered that it cannot draw it. The next picture is drawn all
 * the same, by a new process when this one is gone.
 */
export class RendererCrashed extends Error {
  constructor(how: string, when: "starting" | "drawing" | "answered") {
    super(
      when === "starting"
        ? `No PNG: the renderer's process could not start (${how}). Use the SVG`
        : `No PNG: the renderer @resvg/resvg-js ${
            when === "drawing" ? "stopped while it drew" : "could not draw"
          } this picture (${how}). Use the SVG. Other pictures are not affected`,
    );
    this.name = "RendererCrashed";
  }
}

interface Waiting {
  readonly request: PngRequest;
  readonly done: (png: Uint8Array) => void;
  readonly failed: (error: Error) => void;
}

let child: ChildProcess | undefined;
/** The pictures asked for, in order. The first is the one the process is drawing. */
const queue: Waiting[] = [];
let lastId = 0;

/**
 * Starts the renderer's process, when it is not running. `toPNG` does it too. A command that
 * will want a PNG calls this first, so the process starts while the drawing is built.
 */
export function startRenderer(): void {
  if (child || pngUnavailable() !== null) return;
  const started = fork(childPath, [], {
    serialization: "advanced",
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    execArgv: [],
  });
  child = started;
  // The process must not keep the command from ending. It ends itself when the command does.
  started.unref();
  started.channel?.unref();
  let running = false;
  started.once("spawn", () => (running = true));
  started.on("message", (answer: PngAnswer) => {
    const waiting = queue[0];
    if (child !== started || !waiting || waiting.request.id !== answer.id) return;
    queue.shift();
    if ("png" in answer) waiting.done(answer.png);
    else waiting.failed(new RendererCrashed(answer.error, "answered"));
    next();
  });
  // Once only for a process, however many of its events say that it is gone.
  const ended = (how: string): void => {
    if (child !== started) return;
    child = undefined;
    // A process that is still there after a failed send would keep the command from ending.
    started.kill();
    // The picture it was drawing is the one it died on. The rest go to a new process.
    queue.shift()?.failed(new RendererCrashed(how, running ? "drawing" : "starting"));
    next();
  };
  ends.set(started, ended);
  started.once("exit", (code, signal) => ended(signal ?? `exit code ${code}`));
  // Kept for the life of the process: an error with no listener would end the command.
  started.on("error", (error) => ended(error.message));
}

/** What to call when a process is found to be gone. */
const ends = new WeakMap<ChildProcess, (how: string) => void>();

/** Sends the first waiting picture to the process, starting one when there is none. */
function next(): void {
  const waiting = queue[0];
  if (!waiting) {
    child?.unref();
    child?.channel?.unref();
    return;
  }
  startRenderer();
  const to = child;
  if (!to) return;
  const gone = (error: Error): void => ends.get(to)?.(error.message);
  // While a picture is being drawn the command waits for the answer, or for the process to end.
  to.ref();
  to.channel?.ref();
  try {
    to.send(waiting.request, (error) => error && gone(error));
  } catch (error) {
    gone(error as Error);
  }
}

/**
 * Renders the SVG `width` pixels wide, its height following the drawing's proportions, in the
 * renderer's process. A width that would make more than `MAX_PIXELS` is narrowed to fit; the
 * result gives the width used. Rejects with the reason when `pngUnavailable()` gives one, and
 * with a `RendererCrashed` when the renderer's process died on this picture.
 */
export async function toPNG(svg: string, width: number): Promise<{ png: Buffer; width: number }> {
  const reason = pngUnavailable();
  if (reason !== null) throw new Error(reason);
  const [, , w = 1, h = 1] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? "").split(" ").map(Number);
  const aspect = Math.max(h, 1e-9) / Math.max(w, 1e-9);
  const fitted = Math.max(1, Math.min(width, Math.floor(Math.sqrt(MAX_PIXELS / aspect))));
  const png = await new Promise<Uint8Array>((done, failed) => {
    queue.push({ request: { id: ++lastId, svg, width: fitted }, done, failed });
    if (queue.length === 1) next();
  });
  return { png: Buffer.from(png.buffer, png.byteOffset, png.byteLength), width: fitted };
}
