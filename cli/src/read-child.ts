// The process that reads one drawing file for the command. `read.ts` starts it with the file's
// name, never its path, what to read, and the reader's module, or none for the core's `readDXF`, and streams
// the file's bytes to its stdin. It answers once, as JSON on file descriptor 3, which a reader
// that prints cannot reach, and ends.
import { writeSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { ReadDrawingFile, ReadOptions } from "tsdraft";
import { isFunction } from "./guards.ts";

/** What the process answers: the reader's result, or why there is none. */
export type ReadAnswer =
  | { readonly read: unknown }
  | { readonly error: string; readonly loading: boolean }
  | { readonly malformed: string };

const ANSWER = 3;

const [name = "", what = "{}", module] = process.argv.slice(2);

// SAFETY: read.ts passes the read's options as JSON, and only the two read here are taken, each
// held to its type below or by the reader.
const asked = JSON.parse(what) as ReadOptions;

// The reader holds `only` to its rules, and refuses one that breaks them with a `ReadError`.
const options: ReadOptions = {
  geometry: asked.geometry === true,
  ...(asked.only !== undefined && { only: asked.only }),
};

const message = (cause: unknown): string =>
  (cause instanceof Error ? cause.message : String(cause)).slice(0, 2_000);

function answer(value: ReadAnswer): never {
  let text: string;

  try {
    text = JSON.stringify(value);
  } catch (error) {
    text = JSON.stringify({ malformed: `it is not JSON: ${message(error)}` });
  }

  const bytes = Buffer.from(text);

  for (let at = 0; at < bytes.length;) at += writeSync(ANSWER, bytes, at);
  process.exit(0);
}

// The command ends this process when it is done with it. Should the command itself be ended,
// this one ends too, or at its CPU limit when a reader holds the thread.
const parent = process.ppid;

setInterval(() => process.ppid !== parent && process.exit(1), 1_000).unref();

/**
 * What a reader's module exports, as the reader's package says. The export is checked to be a
 * function, and `checkDrawingRead` checks each answer.
 */
interface ReaderModule {
  readonly readDrawingFile: ReadDrawingFile;
}

let read: ReadDrawingFile;

try {
  if (module) {
    const reader: ReaderModule = await import(pathToFileURL(module).href);
    read = reader.readDrawingFile;
  } else {
    read = await import("tsdraft").then(
      ({ readDXF }): ReadDrawingFile =>
        (chunks, _name, options) =>
          readDXF(chunks, options),
    );
  }

  if (!isFunction(read)) throw new Error(`${module} exports no readDrawingFile`);
} catch (error) {
  answer({ error: message(error), loading: true });
}

try {
  answer({ read: await read(process.stdin, name, options) });
} catch (error) {
  answer({ error: message(error), loading: false });
}
