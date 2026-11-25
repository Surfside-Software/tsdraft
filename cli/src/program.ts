// Runs one program for `tsdraft mcp`'s `execute`, in a process of its own that the server starts
// and ends: a program that loops or throws takes nothing else with it, and what one leaves in a
// global never reaches the next. The program is the body of an async function, in JavaScript.
// `render` and `shows` cross to the server, which builds and reads; everything else runs here.
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { Worker } from "node:worker_threads";
import type { Brief } from "./brief.ts";
import { isNumber, isObject, isString, type Json } from "./guards.ts";
import type { BuildState } from "./state.ts";

/** The most characters of JSON a program may return. A larger value is refused, never cut. */
export const RESULT_LIMIT = 40_000;

/** The most pictures one program may show. */
export const SHOW_LIMIT = 8;

/** The largest PNG `show` takes. */
export const PNG_LIMIT = 16 * 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ProgramRequest {
  readonly type: "run";
  readonly code: string;
}

/** What `render` gives a program, its BuildState, or `shows`, its JSON. */
export type CallValue = BuildState | Json;

/** The server's answer to a call of `render` or `shows`. */
export interface ProgramAnswer {
  readonly type: "answer";
  readonly id: number;
  /** What the call gives the program, or `undefined` when it failed. */
  readonly value?: CallValue;
  /** For a render, the brief of its state. */
  readonly brief?: Brief;
  /** Why the call failed. */
  readonly message?: string;
}

export interface ProgramCall {
  readonly type: "call";
  readonly id: number;
  readonly name: "render" | "shows";
  readonly file: string;
  /** The options as the program gave them, for the server to check. */
  readonly options: unknown;
}

export interface ProgramDone {
  readonly type: "done";
  /** The value the program returned, as JSON, when it ran to its end. */
  readonly json?: string;
  /** Why it did not, when it did not. */
  readonly error?: ProgramError;
  /** The PNGs it showed, each read when it was shown, in base64. */
  readonly images: readonly string[];
}

export type ProgramMessage = { readonly type: "ready" } | ProgramCall | ProgramDone;

export interface ProgramError {
  /** `SyntaxError`, `Uncaught`, `TooLarge`, `NotJSON`, `Timeout` or `Exit`. */
  readonly kind: string;
  readonly message: string;
  /** Where in the program, counted from 1, when it is known. */
  readonly line?: number;
  readonly column?: number;
}

const FILENAME = "program.js";

// The streams' own writes, kept before a program runs, since one may replace them.
const writeOut = process.stdout.write.bind(process.stdout);
const writeErr = process.stderr.write.bind(process.stderr);

/** Settles once all written to a stream has left this process, or after a second. */
async function flushed(write: typeof writeOut): Promise<void> {
  await new Promise<void>((done) => {
    const timer = setTimeout(done, 1_000);

    try {
      write("", () => {
        clearTimeout(timer);
        done();
      });
    } catch {
      done();
    }
  });
}

/** Ends this process when its parent is gone, from a thread a program that never yields cannot hold. */
const WATCHDOG = `const { workerData: { ppid } } = require("node:worker_threads");
const flag = new Int32Array(new SharedArrayBuffer(4));
for (;;) {
  if (process.ppid !== ppid) process.kill(process.pid, "SIGKILL");
  Atomics.wait(flag, 0, 0, 250);
}`;

const send = (message: ProgramMessage): void => void process.send?.(message);

if (process.send) {
  const library = await import("tsdraft");
  const pending = new Map<number, (answer: ProgramAnswer) => void>();
  /** The brief of each state `render` gave the program. */
  const briefs = new WeakMap<object, Brief>();
  const images: string[] = [];
  let calls = 0;

  const call = async (
    name: "render" | "shows",
    file: unknown,
    options: unknown,
  ): Promise<CallValue> => {
    if (!isString(file)) throw new TypeError(`${name}'s first argument is the path of a file`);
    const id = ++calls;

    const answer = await new Promise<ProgramAnswer>((done) => {
      pending.set(id, done);
      send({ type: "call", id, name, file, options: options ?? {} });
    });

    if (answer.value === undefined) throw new Error(answer.message ?? `${name} failed`);

    if (isObject(answer.value) && answer.brief) briefs.set(answer.value, answer.brief);

    return answer.value;
  };

  // The names the program sees, in the order of the wrapper's parameters.
  const api = {
    render: async (file: unknown, options?: unknown) => call("render", file, options),
    shows: async (file: unknown, options?: unknown) => call("shows", file, options),
    show: (picture: unknown): string => {
      const path = isString(picture)
        ? picture
        : isObject(picture) && "png" in picture && isString(picture.png)
          ? picture.png
          : null;

      if (path === null) {
        throw new TypeError("show takes the path of a PNG, or a picture with one in png");
      }

      if (images.length >= SHOW_LIMIT) {
        throw new RangeError(`show takes at most ${SHOW_LIMIT} pictures in one program`);
      }

      // Read now: a render after this one may write over the file or take it away.
      images.push(readPng(resolve(path)).toString("base64"));

      return path;
    },
    brief: (state: unknown): Brief => {
      const made = isObject(state) ? briefs.get(state) : undefined;

      if (!made) throw new TypeError("brief takes a state that render returned");

      return made;
    },
    tsdraft: library,
  };

  const run = async (code: string): Promise<ProgramDone> => {
    let program: unknown;

    try {
      // The program's own lines keep their numbers: the wrapper's first line is line 0.
      const script = new vm.Script(`(async (${Object.keys(api).join(", ")}) => {\n${code}\n})`, {
        filename: FILENAME,
        lineOffset: -1,
        importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
      });

      program = script.runInThisContext();
    } catch (error) {
      return { type: "done", error: located("SyntaxError", error), images };
    }

    let value: unknown;

    try {
      if (!isProgram(program)) throw new TypeError("The program did not compile to a function");
      value = await program(...Object.values(api));
    } catch (error) {
      return { type: "done", error: located("Uncaught", error), images };
    }

    let json: string | undefined;

    try {
      json = JSON.stringify(value ?? null);
    } catch (error) {
      return { type: "done", error: located("NotJSON", error), images };
    }

    if (json === undefined) {
      const message = "The program returned a function or a symbol, which JSON cannot hold";

      return { type: "done", error: { kind: "NotJSON", message }, images };
    }

    if (json.length > RESULT_LIMIT) {
      const size = json.length.toLocaleString("en-US");
      const limit = RESULT_LIMIT.toLocaleString("en-US");

      const message = `The program returned ${size} characters of JSON, over the limit of ${limit}. Return only the fields, the counts or the page you need. What it returned: ${outline(value, 2)}`;

      return { type: "done", error: { kind: "TooLarge", message }, images };
    }

    return { type: "done", json, images };
  };

  process.on("message", (m: unknown) => {
    if (!isObject(m) || !("type" in m)) return;

    if (m.type === "answer" && "id" in m && isNumber(m.id)) {
      const waiting = pending.get(m.id);
      pending.delete(m.id);
      waiting?.(answerOf(m.id, new Map(Object.entries(m))));
    } else if (m.type === "run" && "code" in m && isString(m.code)) {
      void run(m.code).then(async (done) => {
        // What the program printed leaves first, so its log is whole when the answer comes.
        await Promise.all([flushed(writeOut), flushed(writeErr)]);
        send(done);
      });
    }
  });

  // The server disconnects once it has the answer, or when it is gone: nothing a program left
  // running, such as a timer, outlives that. A program that never yields cannot hear it, so a
  // thread of its own ends the process once the server is gone.
  process.on("disconnect", () => process.exit(0));
  const workerData = { ppid: process.ppid };
  new Worker(WATCHDOG, { eval: true, workerData, stdout: true, stderr: true }).unref();
  send({ type: "ready" });
}

/** The bytes of a PNG file, or why `show` cannot take it. */
function readPng(path: string): Buffer {
  // Without waiting on a pipe or a device that would hold the open.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);

  try {
    const stat = fstatSync(fd);

    if (!stat.isFile()) throw new TypeError(`show takes a PNG file, and ${path} is not a file`);

    if (stat.size > PNG_LIMIT) {
      throw new RangeError(`show takes a PNG of at most ${PNG_LIMIT} bytes, and ${path} is larger`);
    }

    const bytes = Buffer.alloc(stat.size);
    let read = 0;

    while (read < bytes.length) {
      const n = readSync(fd, bytes, read, bytes.length - read, read);

      if (n === 0) break;
      read += n;
    }

    const png = bytes.subarray(0, read);

    if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
      throw new TypeError(`show takes a PNG, and ${path} is not one`);
    }

    return png;
  } finally {
    closeSync(fd);
  }
}

/** The server's answer as this process received it, with each field checked. */
function answerOf(id: number, fields: ReadonlyMap<string, unknown>): ProgramAnswer {
  const value = fields.get("value");
  const message = fields.get("message");
  const made = fields.get("brief");

  return {
    type: "answer",
    id,
    ...(value !== undefined && { value: jsonOf(value) }),
    ...(isString(message) && { message }),
    // SAFETY: the server makes a brief with `brief` alone, and sends it whole.
    ...(isObject(made) && { brief: made as Brief }),
  };
}

/**
 * The async function a program compiles to. It should return what JSON holds; `run` writes what
 * it returns with `JSON.stringify`, which refuses anything else with a `NotJSON` error.
 */
type Program = (...api: readonly unknown[]) => Promise<Json | undefined>;

function isProgram(value: unknown): value is Program {
  return typeof value === "function";
}

/** A value that came through the channel: what the server sent as a `CallValue`. */
function jsonOf(value: unknown): CallValue {
  // SAFETY: the server sends a BuildState or the JSON of `shows`, and nothing else, as `value`.
  return value as CallValue;
}

/** The kind and message of an error, with where in the program it was thrown when its stack says. */
function located(kind: string, error: unknown): ProgramError {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  // A syntax error names its line above the stack, as `program.js:3`; a throw, in a frame.
  const at = new RegExp(`${FILENAME}:(\\d+)(?::(\\d+))?`).exec(stack);

  return {
    kind,
    message,
    ...(at && { line: Number(at[1]) }),
    ...(at?.[2] !== undefined && { column: Number(at[2]) }),
  };
}

/** A short account of what a value holds: its keys and their kinds, `depth` levels down. */
export function outline(value: unknown, depth: number): string {
  if (Array.isArray(value)) {
    return depth <= 0 || value.length === 0
      ? `Array(${value.length})`
      : `Array(${value.length}) of ${outline(value[0], depth - 1)}`;
  }

  if (isObject(value)) {
    const entries = Object.entries(value);

    if (depth <= 0) return `{${entries.length} keys}`;

    const shown = entries
      .slice(0, 12)
      .map(([key, entry]) => `${key}: ${outline(entry, depth - 1)}`);

    const more = entries.length > 12 ? `, …${entries.length - 12} more` : "";

    return `{ ${shown.join(", ")}${more} }`;
  }

  return value === null
    ? "null"
    : isString(value)
      ? "string"
      : isNumber(value)
        ? "number"
        : String(value);
}
