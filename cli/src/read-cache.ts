// Keeps the reads of drawing files, so that a file is read once for each SHA-256 of its bytes,
// reader and options, by `tsdraft dev`, `tsdraft render` and a restart alike. A file is watched
// by its size, time and inode, and hashed again only when one of them changes. The reads are
// kept in memory for the life of the command and on disk in the project's
// `node_modules/.cache/tsdraft`, and a read from disk is checked as a reader's answer is.
import { createHash, randomBytes } from "node:crypto";
import {
  createReadStream,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  type Stats,
} from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkDrawingRead, READ_FORMAT, type DrawingRead, type ReadOptions } from "tsdraft";
import { isNumber, isObject, isString, type Json, type JsonObject } from "./guards.ts";
import { bare, readDrawingFile, type FileRead, type ReadBy, type ReadLimits } from "./read.ts";
import { OWN_FOLDER, type ReaderPackage } from "./readers.ts";

/** The format of what is kept on disk. A change to it leaves every kept read behind. */
const CACHE_FORMAT = 2;

const MB = 1024 * 1024;

/** How much is kept on disk, past which the reads used longest ago are removed. */
const DISK_READS = 64;
const DISK_BYTES = 2048 * MB;

/** How much is kept in memory, by the size of each read's JSON. */
const MEMORY_BYTES = 512 * MB;

/**
 * A file whose time is this near the time it was hashed may change again within the same tick
 * of the clock, so its stamp is not kept.
 */
const RACY_MS = 2_000;

/** The most files of a reader's own folder looked at for its fingerprint. */
const FINGERPRINT_FILES = 20_000;

/** How long a reader's fingerprint is taken as current, so a build in a loop does not walk it. */
const FINGERPRINT_MS = 1_000;

/** Where the reads are kept: the project's `node_modules/.cache`, or the user's cache folder. */
export function cacheFolder(project: string | null): string {
  if (project !== null) return join(project, "node_modules", ".cache", "tsdraft", "reads");

  return join(userCache(homedir()), "tsdraft", "reads");
}

/** The user's cache folder, as each platform names it. */
function userCache(home: string): string {
  switch (process.platform) {
    case "win32":
      return process.env["LOCALAPPDATA"] ?? join(home, "AppData", "Local");
    case "darwin":
      return join(home, "Library", "Caches");
    default:
      return process.env["XDG_CACHE_HOME"] ?? join(home, ".cache");
  }
}

/** How a read was found: kept in memory, kept on disk, or read from the file now. */
export type ReadFrom = "memory" | "disk" | "file";

export type CachedRead =
  | (Extract<FileRead, { read: DrawingRead }> & { readonly from: ReadFrom })
  | Extract<FileRead, { skipped: string }>;

/** What a file was when it was hashed. */
interface Stamp {
  readonly size: number;
  readonly mtimeMs: number;
  /** The time of the last change to the file or its inode, which no program can set back. */
  readonly ctimeMs: number;
  readonly ino: number;
  readonly sha256: string;
}

/** Where a read is kept, by the file's stamp and the reader's fingerprint. */
interface Located {
  readonly path: string;
  readonly by: { readonly name: string; readonly version: string };
  /** The fingerprint of the readers, or null when nothing they read is kept on disk. */
  readonly print: string | null;
  readonly stamp: Stamp;
  readonly key: string;
  readonly keyOf: (sha256: string) => string;
}

/** Whether a stamp read back from disk is a whole one, and the stamp of the file at `path`. */
function isStampOf(value: Json, path: string): value is Json & Stamp {
  return (
    isObject(value) &&
    "path" in value &&
    value.path === path &&
    "size" in value &&
    isNumber(value.size) &&
    "mtimeMs" in value &&
    isNumber(value.mtimeMs) &&
    "ctimeMs" in value &&
    isNumber(value.ctimeMs) &&
    "ino" in value &&
    isNumber(value.ino) &&
    "sha256" in value &&
    isString(value.sha256) &&
    /^[0-9a-f]{64}$/.test(value.sha256)
  );
}

const sameStat = (a: Stamp, b: Stats): boolean =>
  a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.ino === b.ino;

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

/** The SHA-256 of a file's bytes, or undefined once it holds more than `most` of them. */
async function hashFile(file: string, most: number): Promise<string | undefined> {
  const hash = createHash("sha256");
  let bytes = 0;

  for await (const chunk of createReadStream(file)) {
    // A stream of a file opened with no encoding gives its bytes as Buffers.
    const piece: Buffer = chunk;
    bytes += piece.length;

    if (bytes > most) return undefined;
    hash.update(piece);
  }

  return hash.digest("hex");
}

/**
 * What tells one build of a reader from another: its name and version, and the count, the size
 * and the newest time of the code files of its folder, apart from the packages it depends on, since
 * a checkout, a link or a patch in place changes them without a new version. Null when the folder
 * holds too many files to look at, and nothing it reads is kept on disk.
 */
const prints = new Map<string, { at: number; print: string | null }>();

function fingerprint(by: ReadBy, folder: string): string | null {
  const known = prints.get(folder);

  if (known && performance.now() - known.at < FINGERPRINT_MS) return known.print;
  const print = walkPrint(by, folder);
  prints.set(folder, { at: performance.now(), print });

  return print;
}

function walkPrint(by: { name: string; version: string }, folder: string): string | null {
  let newest = 0;
  let bytes = 0;
  let files = 0;
  const stack = [folder];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;

    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = join(dir, entry.name);

      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile() && /\.(?:[cm]?[jt]s|json)$/.test(entry.name)) {
        if (++files > FINGERPRINT_FILES) return null;

        try {
          const found = statSync(path);
          newest = Math.max(newest, found.mtimeMs, found.ctimeMs);
          bytes += found.size;
        } catch {
          // A file removed while it was looked at changes the count, which is enough.
        }
      }
    }
  }

  return `${by.name}@${by.version}:${files}:${bytes}:${newest}`;
}

/** A read that the cache neither found nor keeps. */
const uncached = async (...args: Parameters<typeof readDrawingFile>): Promise<CachedRead> => {
  const done = await readDrawingFile(...args);

  return "read" in done ? { ...done, from: "file" } : done;
};

// SAFETY: the command's own package.json, which gives its name and its version as strings.
const core = JSON.parse(await readFile(join(OWN_FOLDER, "package.json"), "utf8")) as ReadBy;

/**
 * The reads of drawing files, kept. One for the life of a command: `read` gives each file's read
 * as `readDrawingFile` does, from memory, from disk or from the file, and never throws.
 */
export class ReadCache {
  readonly folder: string;
  readonly #stamps = new Map<string, Stamp>();
  readonly #memory = new Map<string, { read: DrawingRead; bytes: number }>();
  #memoryBytes = 0;
  readonly #reading = new Map<string, Promise<CachedRead>>();

  /** @param folder - Where the reads are kept on disk, `cacheFolder`'s by default; null for none. */
  constructor(folder: string | null) {
    this.folder = folder ?? "";
  }

  /** Where a read of `file` is kept: its key, its stamp and its reader, or nothing to keep. */
  async #locate(
    file: string,
    reader: ReaderPackage | null,
    limits: ReadLimits,
    options: ReadOptions,
  ): Promise<Located | undefined> {
    const by = reader ? { name: reader.name, version: reader.version } : core;
    let path: string;
    let found: Stats;

    try {
      path = realpathSync.native(file);
      found = await stat(path);
    } catch {
      return undefined;
    }

    // A file over the limit is refused as `readDrawingFile` refuses it, before it is hashed.
    if (found.size > (limits.maxFileBytes ?? 1024 * MB)) return undefined;
    const geometry = options.geometry === true;
    // A reader reads with the core's code too, so the core's own build is part of every key.
    const own = fingerprint(core, OWN_FOLDER);
    const theirs = reader ? fingerprint(by, reader.folder) : own;
    const print = own === null || theirs === null ? null : `${own} ${theirs}`;
    let stamp = this.#stamps.get(path) ?? (await this.#stampOnDisk(path));

    if (!stamp || !sameStat(stamp, found)) {
      stamp = await this.#stampNow(path, limits.maxFileBytes ?? 1024 * MB);
    }

    if (!stamp) return undefined;
    // A read by layout is a read of its own: its part joins the key.
    const part = geometry ? options.only : undefined;

    const keyOf = (sha256: string) =>
      sha(
        JSON.stringify([
          CACHE_FORMAT,
          READ_FORMAT,
          sha256,
          print ?? by.name,
          geometry,
          ...(part === undefined ? [] : [part]),
        ]),
      );

    return { path, by, print, stamp, key: keyOf(stamp.sha256), keyOf };
  }

  /** Reads `file` with `reader`, or the core's `readDXF` for `null`, through the cache. */
  async read(
    file: string,
    reader: ReaderPackage | null,
    limits: ReadLimits = {},
    options: ReadOptions = {},
  ): Promise<CachedRead> {
    const at = await this.#locate(file, reader, limits, options);

    if (at === undefined) return uncached(file, reader, limits, options);
    const { path, by, print, stamp, key, keyOf } = at;
    const kept = this.#memory.get(key);

    if (kept) {
      this.#memory.delete(key);
      this.#memory.set(key, kept);

      return { file, reader: by, read: kept.read, from: "memory" };
    }

    const pending = this.#reading.get(key);

    if (pending) return pending.then((done) => ({ ...done, file }));

    const work = (async (): Promise<CachedRead> => {
      if (print !== null) {
        const disk = await this.#fromDisk(key, stamp, limits.maxAnswerBytes ?? 128 * MB);

        if (disk) {
          this.#remember(key, disk.read, disk.bytes);

          return { file, reader: by, read: disk.read, from: "disk" };
        }
      }

      const done = await readDrawingFile(file, reader, limits, options);

      if (!("read" in done)) return done;
      // The file changed between its hash and its read: the read is of the bytes read.
      const readKey = done.read.sha256 === stamp.sha256 ? key : keyOf(done.read.sha256);

      if (readKey !== key) this.#stamps.delete(path);
      const text = JSON.stringify(done.read);
      this.#remember(readKey, done.read, text.length);

      if (print !== null) await this.#toDisk(readKey, text);

      return { ...done, from: "file" };
    })();

    this.#reading.set(key, work);

    try {
      return await work;
    } finally {
      this.#reading.delete(key);
    }
  }

  /**
   * Keeps the read of `file`, reading it now when neither memory nor disk holds it, and gives a
   * function that gives it at once, for code that asks for the read when it first uses it: from
   * memory, or from disk only when called. Its SHA-256 is the bytes' when the read was kept.
   */
  async keep(
    file: string,
    reader: ReaderPackage | null,
    limits: ReadLimits = {},
    options: ReadOptions = {},
  ): Promise<
    { readonly sha256: string; read(): DrawingRead } | Extract<FileRead, { skipped: string }>
  > {
    const at = await this.#locate(file, reader, limits, options);
    const most = limits.maxAnswerBytes ?? 128 * MB;

    if (at !== undefined && at.print !== null && !this.#memory.has(at.key)) {
      const onDisk = await stat(join(this.folder, `${at.key}.json`)).catch(() => undefined);

      if (this.folder !== "" && onDisk?.isFile() && onDisk.size <= most) {
        let held: DrawingRead | undefined;

        return {
          sha256: at.stamp.sha256,
          read: () => {
            held ??= this.#fromDiskNow(at.key, at.stamp, most);

            if (held !== undefined) return held;
            throw new Error(`The kept read of ${file} could not be loaded: read it again`);
          },
        };
      }
    }

    const done = await this.read(file, reader, limits, options);

    if (!("read" in done)) return done;

    return { sha256: done.read.sha256, read: () => done.read };
  }

  #remember(key: string, read: DrawingRead, bytes: number): void {
    if (bytes > MEMORY_BYTES) return;
    this.#memory.set(key, { read, bytes });
    this.#memoryBytes += bytes;

    for (const [old, { bytes: size }] of this.#memory) {
      if (this.#memoryBytes <= MEMORY_BYTES) break;
      this.#memory.delete(old);
      this.#memoryBytes -= size;
    }
  }

  #stampPath(path: string): string {
    return join(this.folder, "stamps", `${sha(path)}.json`);
  }

  async #stampOnDisk(path: string): Promise<Stamp | undefined> {
    if (this.folder === "") return undefined;

    try {
      const value: Json = JSON.parse(await readFile(this.#stampPath(path), "utf8"));

      return isStampOf(value, path) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  /** Hashes the file, and keeps its stamp when it did not change while it was hashed. */
  async #stampNow(path: string, most: number): Promise<Stamp | undefined> {
    try {
      const before = await stat(path);
      const sha256 = await hashFile(path, most);

      if (sha256 === undefined) return undefined;
      const after = await stat(path);

      const stamp: Stamp = {
        size: after.size,
        mtimeMs: after.mtimeMs,
        ctimeMs: after.ctimeMs,
        ino: after.ino,
        sha256,
      };

      if (!sameStat(stamp, before)) return undefined;

      if (Date.now() - Math.max(after.mtimeMs, after.ctimeMs) < RACY_MS) {
        this.#stamps.delete(path);

        return stamp;
      }

      this.#stamps.set(path, stamp);

      if (this.folder !== "") {
        await this.#write(this.#stampPath(path), JSON.stringify({ path, ...stamp }));
      }

      return stamp;
    } catch {
      return undefined;
    }
  }

  async #fromDisk(
    key: string,
    stamp: Stamp,
    maxBytes: number,
  ): Promise<{ read: DrawingRead; bytes: number } | undefined> {
    if (this.folder === "") return undefined;
    const path = join(this.folder, `${key}.json`);

    try {
      const found = await stat(path);

      if (!found.isFile() || found.size > maxBytes) throw new Error("too large");
      const text = await readFile(path, "utf8");
      const parsed: Json = JSON.parse(text);
      bare(parsed);

      if (checkDrawingRead(parsed).length > 0) throw new Error("not a sound read");
      // SAFETY: checkDrawingRead found the fields of a DrawingRead in it, each of its type.
      const read: DrawingRead = parsed as JsonObject & DrawingRead;

      if (read.sha256 !== stamp.sha256 || read.bytes !== stamp.size) {
        throw new Error("not this file's read");
      }

      const now = new Date();
      await utimes(path, now, now).catch(() => {});

      return { read, bytes: text.length };
    } catch (error) {
      // SAFETY: what fails here is an Error: the file system's with a code, the checks' with none.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        await rm(path, { force: true, recursive: true }).catch(() => {});
      }

      return undefined;
    }
  }

  /** `#fromDisk` at once, for a read asked for synchronously. */
  #fromDiskNow(key: string, stamp: Stamp, maxBytes: number): DrawingRead | undefined {
    try {
      const path = join(this.folder, `${key}.json`);

      if (statSync(path).size > maxBytes) return undefined;
      const text = readFileSync(path, "utf8");
      const parsed: Json = JSON.parse(text);
      bare(parsed);

      if (checkDrawingRead(parsed).length > 0) return undefined;
      // SAFETY: checkDrawingRead found the fields of a DrawingRead in it, each of its type.
      const read: DrawingRead = parsed as JsonObject & DrawingRead;

      if (read.sha256 !== stamp.sha256 || read.bytes !== stamp.size) return undefined;
      this.#remember(key, read, text.length);

      return read;
    } catch {
      return undefined;
    }
  }

  async #toDisk(key: string, text: string): Promise<void> {
    if (this.folder === "") return;

    if (await this.#write(join(this.folder, `${key}.json`), text)) await this.#prune();
  }

  /** Writes a file whole or not at all. False when it could not be written. */
  async #write(path: string, text: string): Promise<boolean> {
    const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;

    try {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(temporary, text);
      await rename(temporary, path);

      return true;
    } catch {
      await rm(temporary, { force: true }).catch(() => {});

      return false;
    }
  }

  /** Removes the reads used longest ago past `DISK_READS` or `DISK_BYTES`. */
  async #prune(): Promise<void> {
    try {
      const names = (await readdir(this.folder)).filter((name) =>
        /^[0-9a-f]{64}\.json$/.test(name),
      );

      const kept = await Promise.all(
        names.map(async (name) => {
          const found = await stat(join(this.folder, name)).catch(() => undefined);

          return { name, size: found?.size ?? 0, used: found?.mtimeMs ?? 0 };
        }),
      );

      kept.sort((a, b) => b.used - a.used);
      let total = 0;

      for (const [index, { name, size }] of kept.entries()) {
        total += size;

        if (index >= DISK_READS || total > DISK_BYTES) {
          await rm(join(this.folder, name), { force: true });
        }
      }
    } catch {
      // A folder that cannot be listed keeps what it holds.
    }
  }
}
