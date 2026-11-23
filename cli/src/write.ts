// `tsdraft write`: an edited copy of each file the job's edit files name, each made in a process
// of its own, `write-child.ts`, under limits like a read's. A copy is written to a temporary file
// in the folder it goes to, and renamed into place once every check of the job has passed on it.
// It never writes the source's own path.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import type { EditCheck, EditDiagnostic } from "tsdraft";
import { isJsonObject, isString, type Json } from "./guards.ts";
import { editorFor, ReaderRefusal, type Readers } from "./readers.ts";
import type { WriteMessage } from "./write-child.ts";

const childPath = realpathSync.native(
  fileURLToPath(
    new URL(
      import.meta.url.endsWith(".ts") ? "./write-child.ts" : "./write-child.js",
      import.meta.url,
    ),
  ),
);

const MB = 1024 * 1024;

/** What `writeEdits` is given: where the readers come from, and where and how it writes. */
export interface WriteOptions {
  readonly readers: Readers;
  readonly out?: string | undefined;
  readonly root?: string | undefined;
  limits?: WriteLimits;
}

/** The limits of one edit's process. Each has its default. */
export interface WriteLimits {
  /** The heap of the process, in MB, as `--max-old-space-size`: 4096. */
  readonly maxMemoryMb?: number;
  /** How long one edit may take, from its start to its answer, in milliseconds: 300 seconds. */
  readonly timeoutMs?: number;
  /** The largest file written, in bytes: 1 GB. */
  readonly maxFileBytes?: number;
}

/** What became of one edit file. */
export interface WriteResult {
  readonly edit: string;
  /** The file the edit names, when the edit file said. */
  readonly source?: string;
  /** Where the edited copy goes. */
  readonly copy?: string;
  readonly written: boolean;
  readonly warnings: readonly string[];
  readonly checks?: readonly EditCheck[];
  /** Why no copy was written: a refusal, a failed check, or an error. */
  readonly reason?: string;
  /** The errors `lintEdit` gives for the edit, with the call of each, when they are the reason. */
  readonly diagnostics?: readonly EditDiagnostic[];
  readonly ms: number;
}

export interface WriteJob {
  readonly root: string;
  readonly out: string;
  readonly files: readonly WriteResult[];
}

/** The most bytes a message of JSON may hold: the checks and their problems, never a file. */
const MOST_MESSAGE = 64 * MB;

/** One edit's process, talked to in messages. */
class EditProcess {
  readonly child: ChildProcess;
  readonly #messages: { message: WriteMessage; bytes?: Uint8Array }[] = [];
  #waiting: (() => void) | undefined;
  /** What has come of the message being read: its length, then its JSON. */
  #head: Buffer[] = [];
  #headLength = 0;
  /** The length of the message being read, once its 4 bytes have come. */
  #length = -1;
  /** The written file that follows a `done` message, filled as it arrives. */
  #file: { message: WriteMessage; bytes: Uint8Array; filled: number } | undefined;
  ended: string | undefined;
  #stderr = "";
  readonly #limits: Required<WriteLimits>;
  /** When it started: its time limit runs from here to its answer. */
  readonly #started = Date.now();

  constructor(edit: string, limits: Required<WriteLimits>) {
    this.#limits = limits;
    const seconds = Math.ceil(limits.timeoutMs / 1000) + 30;
    const node = [`--max-old-space-size=${limits.maxMemoryMb}`, childPath, edit];
    const command = hasPrlimit() ? "prlimit" : process.execPath;

    const args = hasPrlimit()
      ? ["--core=1:1", `--cpu=${seconds}:${seconds + 5}`, "--", process.execPath, ...node]
      : node;

    const env = { ...process.env };
    delete env["NODE_OPTIONS"];
    this.child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe", "pipe"], env });
    // SAFETY: the fourth of `stdio` is a pipe, which the parent reads.
    const answers = this.child.stdio[3] as Readable;
    answers.on("data", (chunk: Buffer) => this.#take(chunk));
    answers.on("error", () => {});
    this.child.stderr!.setEncoding("utf8");
    this.child.stderr!.on(
      "data",
      (text: string) => (this.#stderr = (this.#stderr + text).slice(-4_000)),
    );
    this.child.stdin!.on("error", () => {});
    this.child.once("error", (error) => this.#end(`it could not start: ${error.message}`));
    this.child.once("close", (code, signal) => {
      const last = this.#stderr.trim().split("\n").at(-1)?.slice(0, 300);
      this.#end(
        /heap out of memory/.test(this.#stderr)
          ? `it ran out of memory, over its heap of ${limits.maxMemoryMb} MB`
          : signal === "SIGXCPU"
            ? "it used its limit of CPU time"
            : `it ended ${signal ? `with ${signal}` : `with exit code ${code}`}${last ? `: ${last}` : ""}`,
      );
    });
  }

  #stop(why: string): void {
    this.ended ??= why;
    this.child.kill("SIGKILL");
    // A process that is ended is done with, whatever still holds its pipes.
    this.#waiting?.();
  }

  /** Reads a chunk of the answers: each byte is copied once, into a message or into the file. */
  #take(chunk: Buffer): void {
    let at = 0;

    while (at < chunk.length && this.ended === undefined) {
      const file = this.#file;

      if (file) {
        const n = Math.min(chunk.length - at, file.bytes.length - file.filled);
        file.bytes.set(chunk.subarray(at, at + n), file.filled);
        file.filled += n;
        at += n;

        if (file.filled === file.bytes.length) {
          this.#file = undefined;
          this.#push({ message: file.message, bytes: file.bytes });
        }

        continue;
      }

      // A message: its length in 4 bytes, then its JSON.
      const want = this.#length < 0 ? 4 : 4 + this.#length;
      const n = Math.min(chunk.length - at, want - this.#headLength);
      this.#head.push(chunk.subarray(at, at + n));
      this.#headLength += n;
      at += n;

      if (this.#length < 0 && this.#headLength === 4) {
        this.#length = Buffer.concat(this.#head, 4).readUInt32BE(0);

        if (this.#length > MOST_MESSAGE) {
          this.#stop("its answer holds a message past its limit");

          return;
        }
      }

      if (this.#length < 0 || this.#headLength < 4 + this.#length) continue;
      const whole = Buffer.concat(this.#head, this.#headLength);
      this.#head = [];
      this.#headLength = 0;
      this.#length = -1;
      let message: WriteMessage;

      try {
        // SAFETY: the process is the command's own write-child.ts, which sends only a WriteMessage.
        message = JSON.parse(whole.subarray(4).toString("utf8")) as WriteMessage;
      } catch {
        this.#stop("its answer is not JSON");

        return;
      }

      if (message.kind !== "done") {
        this.#push({ message });
        continue;
      }

      if (
        !(
          Number.isInteger(message.bytes) &&
          message.bytes >= 0 &&
          message.bytes <= this.#limits.maxFileBytes
        )
      ) {
        this.#stop(`the file it wrote is over the limit of ${this.#limits.maxFileBytes / MB} MB`);

        return;
      }

      this.#file = { message, bytes: new Uint8Array(message.bytes), filled: 0 };

      if (message.bytes === 0) {
        this.#file = undefined;
        this.#push({ message, bytes: new Uint8Array(0) });
      }
    }
  }

  #push(item: { message: WriteMessage; bytes?: Uint8Array }): void {
    this.#messages.push(item);
    this.#waiting?.();
  }

  #end(why: string): void {
    this.ended ??= why;
    this.#waiting?.();
  }

  /** The next message, or undefined once the process has ended without one or its time ran out. */
  async next(): Promise<{ message: WriteMessage; bytes?: Uint8Array } | undefined> {
    const ms = this.#limits.timeoutMs;

    const timer = setTimeout(
      () => this.#stop(`it took longer than ${ms / 1000} s, and was ended`),
      Math.max(0, this.#started + ms - Date.now()),
    );

    try {
      while (this.#messages.length === 0 && this.ended === undefined)
        await new Promise<void>((go) => (this.#waiting = go));
    } finally {
      clearTimeout(timer);
      this.#waiting = undefined;
    }

    return this.#messages.shift();
  }

  /** Says go, with the module of the editor of the source's format, or stop. */
  say(line: "stop" | { readonly editor: string | undefined }): void {
    this.child.stdin!.end(
      line === "stop" ? "stop\n" : `go${line.editor ? ` ${line.editor}` : ""}\n`,
    );
  }

  /** Ends the process and waits until it has. */
  async close(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    // Its exit, not its pipes' close, which a process it started may hold open.
    const exited = new Promise<void>((done) => this.child.once("exit", () => done()));
    this.child.kill("SIGKILL");
    await exited;
  }
}

let prlimit: boolean | undefined;

const hasPrlimit = (): boolean =>
  (prlimit ??= spawnSync("prlimit", ["--core=1:1", "true"], { stdio: "ignore" }).status === 0);

const inside = (path: string, folder: string): boolean => {
  const rest = relative(folder, path);

  return rest === "" || (rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest));
};

/** The deepest folder that holds every path. */
function commonFolder(paths: readonly string[]): string {
  let folder = dirname(paths[0]!);

  while (!paths.every((path) => inside(path, folder)) && dirname(folder) !== folder)
    folder = dirname(folder);

  return folder;
}

/** The files of a job no copy may replace: by real path, and by device and inode. */
interface Kept {
  readonly reals: ReadonlyMap<string, string>;
  readonly files: ReadonlyMap<string, string>;
}

/** The files of the job, each resolved once. */
function keptFiles(paths: readonly string[]): Kept {
  const reals = new Map<string, string>();
  const files = new Map<string, string>();

  for (const path of new Set(paths)) {
    try {
      const real = realpathSync.native(path);
      reals.set(real, path);
      const { dev, ino } = statSync(real);
      files.set(`${dev}:${ino}`, path);
    } catch {
      // A file that is not there cannot be replaced.
    }
  }

  return { reals, files };
}

/**
 * The file of the job that writing `copy` would reach, or undefined: a source or a sheet itself,
 * by its real path, through a link to its folder, or as the same file under another name, as a
 * folder in another case on a file system that ignores case.
 */
function reaches(copy: string, kept: Kept): string | undefined {
  const target = join(realpathSync.native(dirname(copy)), basename(copy));
  const byPath = kept.reals.get(target);

  if (byPath !== undefined) return byPath;

  try {
    const { dev, ino } = statSync(target);

    return kept.files.get(`${dev}:${ino}`);
  } catch {
    return undefined;
  }
}

/**
 * The record a write keeps in its out folder of each copy it wrote, by its path from the folder,
 * and the SHA-256 it wrote: a write replaces a file at a copy's path only when the record names it
 * with the bytes it holds, so it never replaces a firm's file, or a copy a person changed.
 */
const RECORD = ".tsdraft-write.json";

/** The most copies the record lists, past which it is read as no record. */
const MOST_RECORDED = 1_000_000;

function readRecord(out: string): Map<string, string> {
  const record = new Map<string, string>();

  try {
    const value: Json = JSON.parse(readFileSync(join(out, RECORD), "utf8"));
    const copies = isJsonObject(value) ? value["copies"] : undefined;

    if (!isJsonObject(copies)) return record;
    let n = 0;

    for (const [path, sha] of Object.entries(copies)) {
      if (++n > MOST_RECORDED) return new Map();

      if (isString(sha) && /^[0-9a-f]{64}$/.test(sha)) record.set(path, sha);
    }
  } catch {
    // No record, or one that does not read: no file there is the write's to replace.
  }

  return record;
}

/** Writes the record again, through a temporary file renamed into place. */
function writeRecord(out: string, record: ReadonlyMap<string, string>): void {
  const temporary = join(out, `.${randomUUID()}.tsdraft-write`);
  writeFileSync(temporary, `${JSON.stringify({ copies: Object.fromEntries(record) }, null, 1)}\n`);
  renameSync(temporary, join(out, RECORD));
}

/** Why the file at a copy's path is not the write's to replace, or undefined when it is. */
function notOurs(
  copy: string,
  out: string,
  record: ReadonlyMap<string, string>,
): string | undefined {
  let held: Uint8Array;

  try {
    if (!statSync(copy).isFile()) return `${copy} is there and is no file`;
    held = readFileSync(copy);
  } catch {
    return undefined;
  }

  const written = record.get(relative(out, copy));

  if (written === undefined)
    return `${copy} is a file a write did not make, which a write never replaces`;

  if (createHash("sha256").update(held).digest("hex") !== written)
    return `${copy} changed since a write made it, and a write never replaces a change`;

  return undefined;
}

/** How many edit files are loaded at once to find what they name. */
const LOADING_AT_ONCE = 4;

interface Named {
  readonly edit: string;
  readonly source: string;
  readonly sheets: readonly string[];
}

/**
 * Writes the edited copy of each file the edit files name: the source's path from the job's
 * root, under `out`. The root is `root`, or the deepest folder that holds every source of the job
 * and every sheet the edits name. Each edit file is loaded first to find what it names, a few at
 * a time, and then edited in a process of its own, one at a time. Never throws for an edit file:
 * each one's result says why it wrote no copy.
 */
export async function writeEdits(
  edits: readonly string[],
  options: WriteOptions,
): Promise<WriteJob> {
  const limits: Required<WriteLimits> = {
    maxMemoryMb: options.limits?.maxMemoryMb ?? 4096,
    timeoutMs: options.limits?.timeoutMs ?? 300_000,
    maxFileBytes: options.limits?.maxFileBytes ?? 1024 * MB,
  };

  const started = Date.now();
  const results: WriteResult[] = [];
  const live = new Set<EditProcess>();

  const endAll = (): void => {
    for (const p of live) p.child.kill("SIGKILL");
  };

  process.once("exit", endAll);

  const run = async <T>(edit: string, use: (p: EditProcess) => Promise<T>): Promise<T> => {
    const p = new EditProcess(edit, limits);
    live.add(p);

    try {
      return await use(p);
    } finally {
      await p.close();
      live.delete(p);
    }
  };

  try {
    // What each edit file names, a few at a time.
    const named: Named[] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(LOADING_AT_ONCE, edits.length) }, async () => {
        while (next < edits.length) {
          const edit = edits[next++]!;
          await run(edit, async (p) => {
            const first = await p.next();
            p.say("stop");

            if (first?.message.kind === "source")
              named.push({ edit, source: first.message.source, sheets: first.message.sheets });
            else
              results.push({
                edit,
                written: false,
                warnings: [],
                reason:
                  first?.message.kind === "error"
                    ? first.message.error
                    : `The edit's process ${p.ended ?? "said nothing"}`,
                ms: Date.now() - started,
              });
          });
        }
      }),
    );
    const order = new Map(edits.map((e, i) => [e, i]));
    named.sort((a, b) => order.get(a.edit)! - order.get(b.edit)!);

    const root =
      options.root !== undefined
        ? resolve(options.root)
        : named.length > 0
          ? commonFolder(named.flatMap((p) => [p.source, ...p.sheets]))
          : process.cwd();

    const out = resolve(options.out ?? join(commonFolder(edits.map((e) => resolve(e))), "out"));
    const seen = new Map<string, string>();
    // Every source and sheet of the job, which no copy may replace.
    const kept = keptFiles(named.flatMap((n) => [n.source, ...n.sheets]));
    const record = readRecord(out);

    for (const { edit, source, sheets } of named) {
      const result = (fields: Omit<WriteResult, "edit" | "source" | "ms">): void => {
        results.push({ edit, source, ...fields, ms: Date.now() - started });
      };

      const refused = (reason: string, copy?: string): void =>
        result({ ...(copy !== undefined && { copy }), written: false, warnings: [], reason });

      const rest = relative(root, source);

      if (!inside(source, root) || rest === "") {
        refused(`${source} is not inside the root ${root}`);
        continue;
      }

      const copy = join(out, rest);

      if (seen.has(source)) {
        refused(`${seen.get(source)} edits the same file: one job makes one edit of a file`, copy);
        continue;
      }

      seen.set(source, edit);
      const extension = extname(source).toLowerCase();
      let editor: string | undefined;

      if (extension !== ".dxf") {
        try {
          editor = editorFor(options.readers, extension)?.editors?.[extension];
        } catch (error) {
          if (!(error instanceof ReaderRefusal)) throw error;
          refused(error.message, copy);
          continue;
        }

        if (editor === undefined) {
          refused(`No installed package edits ${extension} files`, copy);
          continue;
        }
      }

      await run(edit, async (p) => {
        const first = await p.next();

        const same =
          first?.message.kind === "source" &&
          first.message.source === source &&
          first.message.sheets.length === sheets.length &&
          first.message.sheets.every((sheet, i) => sheet === sheets[i]);

        if (!same) {
          p.say("stop");
          refused(
            first?.message.kind === "source"
              ? "The edit file named other files the second time it was loaded than the first"
              : `The edit's process ${p.ended ?? "said nothing"}`,
            copy,
          );

          return;
        }

        p.say({ editor });
        const answer = await p.next();

        if (!answer || answer.message.kind === "source") {
          refused(`The edit's process ${p.ended ?? "gave no answer"}`, copy);

          return;
        }

        const m = answer.message;

        if (m.kind === "error") return refused(m.error, copy);

        if (m.kind === "refused")
          return result({
            copy,
            written: false,
            warnings: m.warnings,
            reason: m.reason,
            ...(m.diagnostics && { diagnostics: m.diagnostics }),
          });
        const failed = m.checks.filter((c) => !c.passed);

        if (failed.length > 0)
          return result({
            copy,
            written: false,
            warnings: m.warnings,
            checks: m.checks,
            reason: `The written file failed the check ${failed.map((c) => c.check).join(", ")}`,
          });
        // The copy goes to a temporary file in its folder, is read back as it lies on the disk,
        // and is renamed into place only if those are the bytes the checks passed, and the place
        // is not the source's by any path.
        const temporary = join(dirname(copy), `.${randomUUID()}.tsdraft-write`);

        try {
          mkdirSync(dirname(copy), { recursive: true });

          const guard = (): void => {
            const reached = reaches(copy, kept);

            if (reached !== undefined)
              throw new Error(
                `${copy} is ${reached === source ? "the source itself" : `${reached}, a file of the job`}, which a write never replaces`,
              );
            const why = notOurs(copy, out, record);

            if (why !== undefined) throw new Error(why);
          };

          guard();
          writeFileSync(temporary, answer.bytes!);
          const onDisk = createHash("sha256").update(readFileSync(temporary)).digest("hex");

          if (onDisk !== m.sha256)
            throw new Error("the file on the disk is not the one the checks passed");
          guard();
          renameSync(temporary, copy);
          record.set(relative(out, copy), m.sha256);
          writeRecord(out, record);
          result({ copy, written: true, warnings: m.warnings, checks: m.checks });
        } catch (error) {
          rmSync(temporary, { force: true });
          result({
            copy,
            written: false,
            warnings: m.warnings,
            checks: m.checks,
            reason: `The copy could not be written: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      });
    }

    results.sort((a, b) => order.get(a.edit)! - order.get(b.edit)!);

    return { root, out, files: results };
  } finally {
    endAll();
    process.off("exit", endAll);
  }
}
