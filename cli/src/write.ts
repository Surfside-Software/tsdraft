// `tsdraft write`: an edited copy of each file the job's edit files name, each made in a process
// of its own, `write-child.ts`, under limits like a read's, which runs the first four checks. A copy
// is written to a temporary file in the folder it goes to. The fifth check then draws the job's
// sheets with every copy that passed in place, `sheets.ts`, and a copy is renamed into place once
// it has passed all five. It never writes the source's own path.
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
import type { EditCheck, EditDiagnostic, EditSheet } from "tsdraft";
import { isJsonObject, isString, type Json } from "./guards.ts";
import { plot } from "./pdf.ts";
import { pngUnavailable, RendererCrashed, toPNG } from "./png.ts";
import { editorFor, ReaderRefusal, type Readers } from "./readers.ts";
import { drawSheets, sheetStem } from "./sheets.ts";
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
  /** The package `--reader` names, from `cwd`, for the reads of the changed sheets. */
  readonly reader?: string | undefined;
  readonly cwd?: string | undefined;
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

/**
 * The copies a write made, each path's SHA-256, and the pictures of the changed sheets, each path's
 * SHA-256 and the sheet's file it pictures, by its absolute path.
 */
interface Recorded {
  readonly copies: Map<string, string>;
  readonly pictures: Map<string, Picture>;
}

interface Picture {
  readonly sha256: string;
  readonly sheet: string;
}

const isSha = (value: Json | undefined): value is string =>
  isString(value) && /^[0-9a-f]{64}$/.test(value);

function readRecord(out: string): Recorded {
  const record: Recorded = { copies: new Map(), pictures: new Map() };

  try {
    const value: Json = JSON.parse(readFileSync(join(out, RECORD), "utf8"));
    let n = 0;

    const copies = isJsonObject(value) ? value["copies"] : undefined;
    const pictures = isJsonObject(value) ? value["pictures"] : undefined;

    // A path that leads out of the folder is no file of the write's, whatever the record says.
    const within = (path: string) => !isAbsolute(path) && inside(resolve(out, path), out);

    for (const [path, sha] of Object.entries(isJsonObject(copies) ? copies : {})) {
      if (++n > MOST_RECORDED) return { copies: new Map(), pictures: new Map() };

      if (isSha(sha) && within(path)) record.copies.set(path, sha);
    }

    for (const [path, picture] of Object.entries(isJsonObject(pictures) ? pictures : {})) {
      if (++n > MOST_RECORDED) return { copies: new Map(), pictures: new Map() };
      const sha = isJsonObject(picture) ? picture["sha256"] : undefined;
      const sheet = isJsonObject(picture) ? picture["sheet"] : undefined;

      if (isSha(sha) && isString(sheet) && within(path)) {
        record.pictures.set(path, { sha256: sha, sheet });
      }
    }
  } catch {
    // No record, or one that does not read: no file there is the write's to replace.
  }

  return record;
}

/** Writes the record again, through a temporary file renamed into place. */
function writeRecord(out: string, record: Recorded): void {
  const temporary = join(out, `.${randomUUID()}.tsdraft-write`);

  const text = JSON.stringify(
    {
      copies: Object.fromEntries(record.copies),
      ...(record.pictures.size > 0 && { pictures: Object.fromEntries(record.pictures) }),
    },
    null,
    1,
  );

  try {
    mkdirSync(out, { recursive: true });
    writeFileSync(temporary, `${text}\n`);
    renameSync(temporary, join(out, RECORD));
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
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
  // The copies that passed the first four checks, each in its temporary file until it passes all.
  const made: Made[] = [];
  const noPng = pngUnavailable();

  // The changed sheets are drawn as PNGs, so a machine that cannot make one writes nothing.
  if (noPng !== null)
    return {
      root: resolve(options.root ?? process.cwd()),
      out: resolve(options.out ?? join(commonFolder(edits.map((e) => resolve(e))), "out")),
      files: edits.map((edit) => ({
        edit,
        written: false,
        warnings: [],
        reason: `${noPng}. The check of the changed sheets draws each as a PNG, so nothing is written`,
        ms: 0,
      })),
    };

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
            checks: [...m.checks, NOT_RUN],
            reason: `The written file failed the check ${failed.map((c) => c.check).join(", ")}`,
          });
        // The copy goes to a temporary file in its folder, is read back as it lies on the disk,
        // and is renamed into place once it has passed the changed sheets too, if those are the
        // bytes the checks passed, and the place is not the source's by any path. It keeps the
        // source's extension, so the sheets' reads find its reader.
        const temporary = join(dirname(copy), `.${randomUUID()}.tsdraft-write${extname(source)}`);

        const guard = (): void => {
          const reached = reaches(copy, kept);

          if (reached !== undefined)
            throw new Error(
              `${copy} is ${reached === source ? "the source itself" : `${reached}, a file of the job`}, which a write never replaces`,
            );
          const why = notOurs(copy, out, record.copies);

          if (why !== undefined) throw new Error(why);
        };

        try {
          mkdirSync(dirname(copy), { recursive: true });
          guard();
          writeFileSync(temporary, answer.bytes!);
          const onDisk = createHash("sha256").update(readFileSync(temporary)).digest("hex");

          if (onDisk !== m.sha256)
            throw new Error("the file on the disk is not the one the checks passed");
          made.push({ edit, source, sheets, copy, temporary, done: m, guard });
        } catch (error) {
          rmSync(temporary, { force: true });
          result({
            copy,
            written: false,
            warnings: m.warnings,
            checks: [...m.checks, NOT_RUN],
            reason: `The copy could not be written: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      });
    }

    // The changed sheets, drawn with every copy that passed the other checks in place.
    if (made.length > 0) {
      const files = [...new Set(made.flatMap((p) => [p.source, ...p.sheets]))];

      const drawn = await drawSheets({
        files,
        copies: Object.fromEntries(
          made.map((p) => [p.source, { copy: p.temporary, blocks: p.done.blocks }]),
        ),
        shows: shownBy(made),
        reader: options.reader,
        cwd: options.cwd ?? process.cwd(),
        timeoutMs: limits.timeoutMs * files.length,
      });

      const pictures = await sheetPictures(drawn, files, root, out, record);

      for (const p of made) {
        const sheets: EditSheet[] = [];
        const problems: string[] = [];

        for (const file of new Set([p.source, ...p.sheets])) {
          sheets.push(...(pictures.get(file)?.sheets ?? []));

          for (const { text, source } of pictures.get(file)?.problems ?? [])
            if (source === undefined || source === p.source) problems.push(text);
        }

        const check: EditCheck = {
          check: "sheets",
          passed: problems.length === 0,
          problems: problems.slice(0, MOST_PROBLEMS),
          ...(sheets.length > 0 && { sheets }),
        };

        const checks = [...p.done.checks, check];

        const fields = {
          edit: p.edit,
          source: p.source,
          copy: p.copy,
          warnings: p.done.warnings,
          checks,
        };

        try {
          if (!check.passed) throw new Error("The written file failed the check sheets");
          p.guard();
          renameSync(p.temporary, p.copy);
          const key = relative(out, p.copy);
          const before = record.copies.get(key);
          record.copies.set(key, p.done.sha256);

          try {
            writeRecord(out, record);
          } catch (error) {
            // A copy the record does not hold is one no later write may replace: it goes.
            rmSync(p.copy, { force: true });

            if (before === undefined) record.copies.delete(key);
            else record.copies.set(key, before);
            throw error;
          }

          results.push({ ...fields, written: true, ms: Date.now() - started });
        } catch (error) {
          rmSync(p.temporary, { force: true });
          const why = error instanceof Error ? error.message : String(error);

          results.push({
            ...fields,
            written: false,
            reason: check.passed ? `The copy could not be written: ${why}` : why,
            ms: Date.now() - started,
          });
        }
      }

      keepWritten(results, out, record);
    }

    results.sort((a, b) => order.get(a.edit)! - order.get(b.edit)!);

    return { root, out, files: results };
  } finally {
    endAll();
    process.off("exit", endAll);

    for (const p of made) rmSync(p.temporary, { force: true });
  }
}

/**
 * Takes away each picture of a sheet that no copy written lists, as one drawn for a copy that then
 * failed: the out folder shows only what its copies hold. A failed copy's check keeps its problems.
 */
function keepWritten(results: WriteResult[], out: string, record: Recorded): void {
  const kept = new Set<string>();

  for (const r of results)
    if (r.written)
      for (const c of r.checks ?? []) for (const s of c.sheets ?? []) kept.add(s.png).add(s.pdf);

  for (const [i, r] of results.entries()) {
    if (r.written || r.checks === undefined) continue;

    const checks = r.checks.map((c) => {
      if (c.sheets === undefined) return c;

      for (const s of c.sheets)
        for (const path of [s.png, s.pdf])
          if (!kept.has(path)) {
            rmSync(path, { force: true });
            record.pictures.delete(relative(out, path));
          }

      const { sheets, ...rest } = c;
      const left = sheets.filter((s) => kept.has(s.png));

      return left.length > 0 ? { ...rest, sheets: left } : rest;
    });

    results[i] = { ...r, checks };
  }

  // A record that lists a picture taken away replaces nothing it should not.
  try {
    writeRecord(out, record);
  } catch {
    // Each copy written wrote it before; the next write reads that.
  }
}

/** Each sheet the copies' edits name, with the sources of those edits. */
function shownBy(made: readonly Made[]): Record<string, string[]> {
  const shows: Record<string, string[]> = Object.create(null);

  for (const p of made) for (const sheet of p.sheets) (shows[sheet] ??= []).push(p.source);

  return shows;
}

/** A copy that passed the first four checks, in its temporary file. */
interface Made {
  readonly edit: string;
  readonly source: string;
  readonly sheets: readonly string[];
  readonly copy: string;
  readonly temporary: string;
  readonly done: Extract<WriteMessage, { kind: "done" }>;
  /** Throws when the copy's path is a file of the job's, or a file the write may not replace. */
  readonly guard: () => void;
}

/** The changed sheets' check of a copy that failed an earlier one. */
const NOT_RUN: EditCheck = {
  check: "sheets",
  passed: false,
  problems: ["not run: the copy failed an earlier check, so its source stood in its place"],
};

/** The most problems one check lists. */
const MOST_PROBLEMS = 50;

/** The width of a changed sheet's PNG, in pixels, as `tsdraft render` draws a sheet. */
const SHEET_WIDTH = 1600;

/**
 * What the changed sheets' check found of one file: the pictures written, and the problems, each
 * with the source of the edits it is a problem of where it is of those alone.
 */
interface FilePictures {
  readonly sheets: EditSheet[];
  readonly problems: { readonly text: string; readonly source?: string }[];
}

/**
 * Writes each changed sheet's PNG and PDF under `out`, at its file's path from the root, as
 * `<name>.layout-<layout>`, and records each. A recorded picture of a file of the job that this
 * write did not draw again, as its layout no longer changes, is removed when it holds what was
 * recorded. Gives each file's pictures and problems.
 */
async function sheetPictures(
  drawn: Awaited<ReturnType<typeof drawSheets>>,
  files: readonly string[],
  root: string,
  out: string,
  record: Recorded,
): Promise<Map<string, FilePictures>> {
  const found = new Map<string, FilePictures>(files.map((f) => [f, { sheets: [], problems: [] }]));

  if (isString(drawn)) {
    for (const f of files)
      found.get(f)!.problems.push({ text: `The sheets could not be drawn: ${drawn}` });

    return found;
  }

  const taken = new Set<string>();
  const written = new Set<string>();
  const shas = new Map([...record.pictures].map(([path, p]) => [path, p.sha256]));

  for (const sheet of drawn) {
    const at = found.get(sheet.file);

    if (!at) continue;
    const place = sheet.layout === null ? sheet.file : `${sheet.file}, layout ${sheet.layout}`;

    if ("problem" in sheet) {
      at.problems.push({
        text: `${place}: ${sheet.problem}`,
        ...(sheet.source !== undefined && { source: sheet.source }),
      });
      continue;
    }

    const rest = relative(root, sheet.file);

    if (!inside(sheet.file, root) || rest === "") {
      at.problems.push({ text: `${place}: the sheet is not inside the root ${root}` });
      continue;
    }

    const folder = join(out, dirname(rest));
    const stem = sheetStem(folder, basename(rest, extname(rest)), sheet.layout, taken);
    const png = join(folder, `${stem}.png`);
    const pdf = join(folder, `${stem}.pdf`);

    try {
      for (const path of [png, pdf]) {
        const notMine = notOurs(path, out, shas);

        if (notMine !== undefined) throw new Error(notMine);
      }

      let drawnPng;

      try {
        drawnPng = await toPNG(sheet.svg, SHEET_WIDTH);
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        throw new Error(error instanceof RendererCrashed ? why : `No PNG: ${why}`, {
          cause: error,
        });
      }

      const plotted = await plot([sheet.svg]);

      if (plotted.pdf === null) throw new Error(plotted.error);
      mkdirSync(folder, { recursive: true });

      for (const [path, bytes] of [
        [png, drawnPng.png],
        [pdf, plotted.pdf],
      ] as const) {
        writeFileSync(path, bytes);
        record.pictures.set(relative(out, path), {
          sha256: createHash("sha256").update(bytes).digest("hex"),
          sheet: sheet.file,
        });
        written.add(relative(out, path));
      }

      at.sheets.push({ file: sheet.file, layout: sheet.layout, png, pdf });
    } catch (error) {
      at.problems.push({
        text: `${place}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  // A picture of a file of the job from an earlier write, of a layout that no longer changes.
  const drawnFiles = new Set(files);

  for (const [path, { sha256, sheet }] of record.pictures) {
    if (written.has(path) || !drawnFiles.has(sheet)) continue;

    try {
      const held = readFileSync(join(out, path));

      if (createHash("sha256").update(held).digest("hex") !== sha256) continue;
      rmSync(join(out, path), { force: true });
    } catch {
      // Gone already.
    }

    record.pictures.delete(path);
  }

  // Without the record a later write could not tell its pictures, so a copy waits for it.
  try {
    writeRecord(out, record);
  } catch (error) {
    const why = `the out folder's record could not be written: ${error instanceof Error ? error.message : String(error)}`;

    // A picture the record does not hold is one no later write may replace: it goes.
    for (const path of written) {
      rmSync(join(out, path), { force: true });
      record.pictures.delete(path);
    }

    for (const f of files) {
      const at = found.get(f)!;
      at.problems.push({ text: why });
      at.sheets.length = 0;
    }
  }

  return found;
}
