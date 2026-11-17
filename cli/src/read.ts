// Reads drawing files, each in a process of its own, `read-child.ts`, which ends when it has
// answered. A reader is code the user installed, and these limits hold its mistakes: the file's
// size, the process's heap, the time and CPU time, the size and shape of the answer, and no core
// dump. Where Node has its permission model, the process may not write files, start processes or
// start workers, and reads only tsdraft's package and the reader's.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { pipeline, type Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { checkDrawingRead, type DrawingRead } from "tsdraft";
import { lookup, OWN_FOLDER, type ReaderPackage } from "./readers.ts";

const childPath = realpathSync.native(
  fileURLToPath(
    new URL(
      import.meta.url.endsWith(".ts") ? "./read-child.ts" : "./read-child.js",
      import.meta.url,
    ),
  ),
);

const MB = 1024 * 1024;

/** The limits of a read. Each has its default. */
export interface ReadLimits {
  /** The largest file read, in bytes: 1 GB. */
  readonly maxFileBytes?: number;
  /** The heap of the reading process, in MB, as `--max-old-space-size`: 2048. */
  readonly maxMemoryMb?: number;
  /** How long a read may take, in milliseconds: 120 seconds. */
  readonly timeoutMs?: number;
  /** The largest answer, in bytes of JSON: 128 MB. */
  readonly maxAnswerBytes?: number;
}

/** Who read a file: a reader's package, or tsdraft itself for the core's `readDXF`. */
export interface ReadBy {
  readonly name: string;
  readonly version: string;
}

/** What became of one file: its read, or why it was skipped. */
export type FileRead =
  | { readonly file: string; readonly reader: ReadBy; readonly read: DrawingRead }
  | { readonly file: string; readonly reader: ReadBy; readonly skipped: string };

/** How many reads run at once, across every caller. */
const AT_ONCE = 2;
let running = 0;
const waiting: (() => void)[] = [];

async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  while (running >= AT_ONCE) await new Promise<void>((go) => waiting.push(go));
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/**
 * The processes running now, ended should the command end first: on its exit, and on SIGINT and
 * SIGTERM, which then take their course. A process the command loses another way ends at its CPU
 * limit.
 */
const live = new Set<ChildProcess>();
let watching = false;

function endLive(): void {
  for (const child of live) child.kill("SIGKILL");
}

function onSignal(signal: NodeJS.Signals): void {
  endLive();
  process.off("SIGINT", onSignal).off("SIGTERM", onSignal);
  // Another listener, such as `tsdraft dev`'s, decides what the signal does.
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
}

function track(child: ChildProcess): void {
  if (live.size === 0) process.on("SIGINT", onSignal).on("SIGTERM", onSignal);
  live.add(child);
}

function untrack(child: ChildProcess): void {
  if (live.delete(child) && live.size === 0) {
    process.off("SIGINT", onSignal).off("SIGTERM", onSignal);
  }
}

const own = JSON.parse(readFileSync(join(OWN_FOLDER, "package.json"), "utf8")) as ReadBy;
const core: ReadBy = { name: own.name, version: own.version };

let prlimit: boolean | undefined;

/**
 * The flags that put the process under Node's permission model, found by feature: `--permission`,
 * or `--experimental-permission` before it, with read access to tsdraft's folder and the
 * reader's, and nothing else allowed. Empty where this Node has no permission model.
 */
function permission(reader: ReaderPackage | null): string[] {
  const flags = process.allowedNodeEnvironmentFlags;
  const on = ["--permission", "--experimental-permission"].find((flag) => flags.has(flag));
  if (!on || !flags.has("--allow-fs-read")) return [];
  const folders = [OWN_FOLDER];
  if (reader) {
    folders.push(reader.folder);
    // A reader that imports tsdraft reaches it through a link where pnpm installed it, and
    // Node's resolver reads the link before it follows it.
    const link = lookup(reader.folder, "tsdraft");
    if (link !== null && realpathSync.native(link) === OWN_FOLDER) folders.push(link);
  }
  return [on, ...folders.map((folder) => `--allow-fs-read=${folder}`)];
}

const size = (bytes: number): string =>
  bytes < MB ? `${bytes} bytes` : `${Math.round(bytes / MB)} MB`;

/**
 * Reads one drawing file with a reader's package, or with the core's `readDXF` when `reader` is
 * `null`, as `readerFor` gives for a DXF, within the limits. Never throws: a file that breaks a limit, makes the reader throw,
 * ends the process or gives a malformed answer is skipped with the reason. At most two reads run
 * at once; the rest wait their turn.
 */
export function readDrawingFile(
  file: string,
  reader: ReaderPackage | null,
  limits: ReadLimits = {},
): Promise<FileRead> {
  const by: ReadBy = reader ? { name: reader.name, version: reader.version } : core;
  const skip = (skipped: string): FileRead => ({ file, reader: by, skipped });
  const {
    maxFileBytes = 1024 * MB,
    maxMemoryMb = 2048,
    timeoutMs = 120_000,
    maxAnswerBytes = 128 * MB,
  } = limits;
  return inTurn(async () => {
    try {
      const found = await stat(file);
      const bytes = found.size;
      if (!found.isFile()) return skip("it is not a file");
      if (bytes > maxFileBytes) {
        return skip(`the file is ${size(bytes)}, over the limit of ${size(maxFileBytes)}`);
      }
    } catch (error) {
      return skip(`the file cannot be read: ${(error as Error).message}`);
    }
    const module = reader?.modules[extension(file)];
    if (reader && !module) return skip(`${reader.name} does not read ${basename(file)}`);
    if (!reader && extension(file) !== ".dxf") {
      return skip(`no installed reader reads ${basename(file)}`);
    }
    const outcome = await run(file, module, permission(reader), {
      maxFileBytes,
      maxMemoryMb,
      timeoutMs,
      maxAnswerBytes,
    });
    return "read" in outcome ? { file, reader: by, read: outcome.read } : skip(outcome.skipped);
  });
}

/** Reads each file as `readDrawingFile` does, and gives each one's outcome in order. */
export function readDrawingFiles(
  files: readonly { readonly file: string; readonly reader: ReaderPackage | null }[],
  limits: ReadLimits = {},
): Promise<FileRead[]> {
  return Promise.all(files.map(({ file, reader }) => readDrawingFile(file, reader, limits)));
}

const extension = (file: string): string => /\.[^./\\]*$/.exec(file)?.[0].toLowerCase() ?? "";

function run(
  file: string,
  module: string | undefined,
  allow: readonly string[],
  limits: Required<ReadLimits>,
): Promise<{ read: DrawingRead } | { skipped: string }> {
  const { maxFileBytes, maxMemoryMb, timeoutMs, maxAnswerBytes } = limits;
  prlimit ??= spawnSync("prlimit", ["--core=1:1", "true"], { stdio: "ignore" }).status === 0;
  const node = [
    `--max-old-space-size=${maxMemoryMb}`,
    ...allow,
    childPath,
    basename(file),
    ...(module ? [module] : []),
  ];
  const command = prlimit ? "prlimit" : process.execPath;
  // The kernel ends a process the command has lost at its CPU limit, as a busy reader never runs
  // the process's own check on its parent.
  // The soft limit sends SIGXCPU, which names the cause; the hard one, 5 s on, sends SIGKILL.
  const seconds = Math.ceil(timeoutMs / 1000) + 30;
  const cpu = `--cpu=${seconds}:${seconds + 5}`;
  const args = prlimit ? ["--core=1:1", cpu, "--", process.execPath, ...node] : node;
  // NODE_OPTIONS would add its own flags to the process's, and could allow what is denied.
  const env = { ...process.env };
  delete env["NODE_OPTIONS"];
  if (!watching) {
    watching = true;
    process.once("exit", endLive);
  }

  return new Promise((settle) => {
    const source = createReadStream(file);
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe", "pipe"], env });
    const [stdin, stderr, answers] = [child.stdin!, child.stderr!, child.stdio[3] as Readable];
    track(child);
    let settled = false;
    const done = (outcome: { read: DrawingRead } | { skipped: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      untrack(child);
      child.kill("SIGKILL");
      source.destroy();
      settle(outcome);
    };
    const timer = setTimeout(
      () => done({ skipped: `the read took longer than ${timeoutMs / 1000} s, and was ended` }),
      timeoutMs,
    );

    // The file's bytes go to the process as they are read, counted and hashed on the way.
    const hash = createHash("sha256");
    let sent = 0;
    let whole = false;
    source.on("data", (chunk) => {
      sent += chunk.length;
      hash.update(chunk);
      if (sent > maxFileBytes) {
        done({ skipped: `the file grew over the limit of ${size(maxFileBytes)} as it was read` });
      }
    });
    source.on("end", () => (whole = true));
    source.on("error", (error) => done({ skipped: `the file cannot be read: ${error.message}` }));
    // A process that ends before it has read every byte closes its stdin: that is not an error.
    pipeline(source, stdin, () => {});

    let tail = "";
    stderr.setEncoding("utf8");
    stderr.on("data", (text: string) => (tail = (tail + text).slice(-4_000)));

    const chunks: Buffer[] = [];
    let answered = 0;
    answers.on("data", (chunk: Buffer) => {
      if (settled) return;
      answered += chunk.length;
      if (answered > maxAnswerBytes) {
        chunks.length = 0;
        done({ skipped: `the reader's answer is over the limit of ${size(maxAnswerBytes)}` });
      } else chunks.push(chunk);
    });
    answers.on("error", () => {});

    child.once("error", (error) =>
      done({ skipped: `the reading process could not start: ${error.message}` }),
    );
    child.once("close", (code, signal) => {
      if (settled) return;
      const malformed = (why: string) =>
        done({ skipped: `the reader's answer is malformed: ${why}` });
      if (answered === 0) return done({ skipped: ended(code, signal, tail, maxMemoryMb) });
      let answer: Partial<Record<"read" | "error" | "loading" | "malformed", unknown>>;
      try {
        // Nothing from here to the end of the check awaits, so answers are joined and parsed one
        // at a time across reads, and the chunks are let go once joined.
        // Every object comes back with no prototype, as `readDXF` gives its maps, so a layer
        // named `constructor` is a key like any other here too.
        answer = bare(
          JSON.parse(Buffer.concat(chunks.splice(0), answered).toString("utf8")),
        ) as typeof answer;
      } catch {
        // A process that was ended while it wrote its answer left half of it.
        return code === 0
          ? malformed("it is not JSON")
          : done({ skipped: ended(code, signal, tail, maxMemoryMb) });
      }
      if (typeof answer !== "object" || answer === null) return malformed("it is not an object");
      if (typeof answer.error === "string") {
        return done({
          skipped: answer.loading
            ? `the reader could not be loaded: ${answer.error}`
            : `the reader threw: ${answer.error}`,
        });
      }
      if (typeof answer.malformed === "string") return malformed(answer.malformed);
      const problems = checkDrawingRead(answer.read);
      if (problems.length > 0) return malformed(problems.slice(0, 3).join("; "));
      const read = answer.read as DrawingRead;
      if (!whole) return malformed("it was given before the whole file was read");
      if (read.bytes !== sent || read.sha256 !== hash.digest("hex")) {
        return malformed("its size or SHA-256 is not the file's");
      }
      done({ read });
    });
  });
}

/**
 * Takes the prototype from each object of a parsed answer, in place. A reviver that made new
 * objects would put each in V8's slow mode, and parse about ten times slower.
 */
function bare(value: unknown): unknown {
  const stack = [value];
  while (stack.length > 0) {
    const item = stack.pop();
    if (typeof item !== "object" || item === null) continue;
    if (Array.isArray(item)) {
      for (const each of item) if (typeof each === "object" && each !== null) stack.push(each);
      continue;
    }
    Object.setPrototypeOf(item, null);
    for (const each of Object.values(item)) {
      if (typeof each === "object" && each !== null) stack.push(each);
    }
  }
  return value;
}

/** Why a process ended with no answer. */
function ended(
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: string,
  maxMemoryMb: number,
): string {
  if (/heap out of memory/.test(stderr)) {
    return `the reading process ran out of memory, over its heap of ${maxMemoryMb} MB`;
  }
  if (signal === "SIGXCPU") {
    return `the reading process used its limit of CPU time, the timeout and 30 seconds, before it answered`;
  }
  const last = stderr.trim().split("\n").at(-1)?.slice(0, 300);
  return (
    `the reading process ended ${signal ? `with ${signal}` : `with exit code ${code}`} ` +
    `before it answered${last ? `: ${last}` : ""}`
  );
}
