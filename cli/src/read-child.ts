// The process that reads one drawing file for the command. `read.ts` starts it with the file's
// name, never its path, what to read, and the reader's module, or none for the core's `readDXF`, and streams
// the file's bytes to its stdin. It answers once, as JSON on file descriptor 3, which a reader
// that prints cannot reach, and ends.
import { writeSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { ReadDrawingFile, ReadOptions } from "tsdraft";

/** What the process answers: the reader's result, or why there is none. */
export type ReadAnswer =
  | { readonly read: unknown }
  | { readonly error: string; readonly loading: boolean }
  | { readonly malformed: string };

const ANSWER = 3;

const [name = "", what = "{}", module] = process.argv.slice(2);
const options: ReadOptions = { geometry: (JSON.parse(what) as ReadOptions).geometry === true };

const message = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, 2_000);

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

let read: ReadDrawingFile;
try {
  read = module
    ? ((await import(pathToFileURL(module).href)) as { readDrawingFile: ReadDrawingFile })
        .readDrawingFile
    : await import("tsdraft").then(
        ({ readDXF }): ReadDrawingFile =>
          (chunks, _name, options) =>
            readDXF(chunks, options),
      );
  if (typeof read !== "function") throw new Error(`${module} exports no readDrawingFile`);
} catch (error) {
  answer({ error: message(error), loading: true });
}
try {
  answer({ read: await read(process.stdin, name, options) });
} catch (error) {
  answer({ error: message(error), loading: false });
}
