// The process that makes one edited copy for `tsdraft write`. `write.ts` starts it with the edit
// file's path. It loads the edit file and says what file the edit names, then waits for the
// command to say go, with the module of the editor of that file's format, or none for a DXF. Then it
// looks for a lock beside the file, checks the file's SHA-256 against the edit's, reads it, makes
// the edit, runs the checks of every job on what it made, and answers with the checks and the
// bytes it wrote. Each message to the command is a length and JSON, on file descriptor 3.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
  checkEditedCopy,
  dxfEditor,
  EditError,
  type EditFile,
  type EditorModule,
  type FileEditor,
} from "tsdraft";
import { isFunction, isObject, isString } from "./guards.ts";

/** What the process says, in order: the source, then the result. */
export type WriteMessage =
  | {
      readonly kind: "source";
      readonly source: string;
      readonly sha256: string;
      readonly name: string;
      readonly sheets: readonly string[];
    }
  | {
      readonly kind: "done";
      readonly warnings: readonly string[];
      readonly checks: Awaited<ReturnType<typeof checkEditedCopy>>;
      readonly sha256: string;
      readonly bytes: number;
    }
  | { readonly kind: "refused"; readonly warnings: readonly string[]; readonly reason: string }
  | { readonly kind: "error"; readonly error: string };

const ANSWER = 3;

const [editPath = ""] = process.argv.slice(2);

function send(message: WriteMessage, bytes?: Uint8Array): void {
  const json = Buffer.from(JSON.stringify(message));
  const head = Buffer.alloc(4);
  head.writeUInt32BE(json.length);

  for (const part of [head, json, ...(bytes ? [bytes] : [])])
    for (let at = 0; at < part.length;) at += writeSync(ANSWER, part, at);
}

const message = (cause: unknown): string =>
  (cause instanceof Error ? cause.message : String(cause)).slice(0, 2_000);

/** Whether `cause` is an error named `name`, from whichever copy of tsdraft threw it. */
const isNamed = (cause: unknown, name: string): boolean =>
  isObject(cause) && "name" in cause && cause.name === name;

function fail(error: string): never {
  send({ kind: "error", error });
  process.exit(0);
}

// Ends with the command, as a reading process does.
const parent = process.ppid;

setInterval(() => process.ppid !== parent && process.exit(1), 1_000).unref();

function isEditFile(value: unknown): value is EditFile {
  if (!isObject(value) || !("build" in value) || !("source" in value)) return false;
  const { build, source } = value;

  return (
    isFunction(build) &&
    isObject(source) &&
    "file" in source &&
    isString(source.file) &&
    "sha256" in source &&
    isString(source.sha256)
  );
}

/** What an edit file's module exports: its default is checked to be an edit file. */
interface EditFileModule {
  readonly default?: unknown;
}

let file: EditFile;

try {
  const module: EditFileModule = await import(pathToFileURL(editPath).href);

  if (!isEditFile(module.default))
    fail(
      "The default export must be an edit file: `export default editDrawing({ file, sha256, name }, ...)`",
    );
  file = module.default;
} catch (error) {
  fail(`The edit file could not be loaded: ${message(error)}`);
}

const folder = dirname(editPath);
const source = resolve(folder, file.source.file);

send({
  kind: "source",
  source,
  sha256: file.source.sha256.toLowerCase(),
  name: file.source.name,
  sheets: (file.source.sheets ?? []).map((sheet) => resolve(folder, sheet)),
});

// The command says `go`, with the module of the editor of the source's format where there is one.
const go = await new Promise<{ editor: string | undefined } | undefined>((settle) => {
  const lines = createInterface({ input: process.stdin });
  lines.once("line", (line) => {
    const [word, ...rest] = line.trim().split(" ");
    // Settled before the close, which `close()` emits at once.
    settle(word === "go" ? { editor: rest.length > 0 ? rest.join(" ") : undefined } : undefined);
    lines.close();
  });
  lines.once("close", () => settle(undefined));
});

if (!go) process.exit(0);

const editorModule = go.editor;

/** A lock beside the source: its name with `.dwl` or `.dwl2` for its extension, in any case. */
function locks(path: string): string[] {
  const stem = basename(path, extname(path)).toLowerCase();

  try {
    return readdirSync(dirname(path)).filter((name) =>
      [`${stem}.dwl`, `${stem}.dwl2`].includes(name.toLowerCase()),
    );
  } catch {
    return [];
  }
}

const warnings = locks(source).map(
  (lock) =>
    `${lock} beside the file says a CAD program has it open. The edited copy is written; the firm's file would not be`,
);

function refuse(reason: string): never {
  send({ kind: "refused", warnings, reason });
  process.exit(0);
}

let bytes: Uint8Array;

try {
  if (!statSync(source).isFile()) refuse(`${file.source.file} is not a file`);
  bytes = new Uint8Array(readFileSync(source));
} catch (error) {
  refuse(`${file.source.file} cannot be read: ${message(error)}`);
}

const hash = createHash("sha256").update(bytes).digest("hex");

if (hash !== file.source.sha256.toLowerCase())
  refuse(
    `${file.source.file} has the SHA-256 ${hash}, not the ${file.source.sha256} the edit was planned on: it changed after the edit was planned`,
  );

let editor: FileEditor;
const extension = extname(source).toLowerCase();

if (extension === ".dxf") editor = dxfEditor;
else if (editorModule === undefined) refuse(`No installed package edits ${extension} files`);
else {
  try {
    const loaded: EditorModule = await import(pathToFileURL(editorModule).href);
    editor = loaded.editor;

    if (!isFunction(editor?.edit)) throw new Error(`${editorModule} exports no editor`);
  } catch (error) {
    fail(`The editor could not be loaded: ${message(error)}`);
  }
}

try {
  const read = await editor.read(bytes);
  const edit = file.build(read);
  const written = editor.edit(bytes, edit, read);
  const checks = await checkEditedCopy(editor, bytes, read, edit, written);
  send(
    {
      kind: "done",
      warnings,
      checks,
      sha256: createHash("sha256").update(written).digest("hex"),
      bytes: written.length,
    },
    written,
  );
} catch (error) {
  if (error instanceof EditError || isNamed(error, "EditError")) refuse(message(error));

  if (isNamed(error, "ReadError")) refuse(`The file does not read: ${message(error)}`);
  fail(`The edit failed: ${message(error)}`);
}

process.exit(0);
