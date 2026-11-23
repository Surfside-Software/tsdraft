// Keeps the reads of drawing files, so that a file is read once for each SHA-256 of its bytes,
// reader and options, by `tsdraft dev`, `tsdraft render` and a restart alike. A file is watched
// by its size, time and inode, and hashed again only when one of them changes. The reads are
// kept in memory for the life of the command and on disk in the project's
// `node_modules/.cache/tsdraft`, and a read from disk is checked as a reader's answer is.
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, readdirSync, realpathSync, statSync, type Stats } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkDrawingRead, READ_FORMAT, type DrawingRead, type ReadOptions } from "tsdraft";
import { bare, readDrawingFile, type FileRead, type ReadLimits } from "./read.ts";
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
  const home = homedir();
  const base =
    process.platform === "win32"
      ? (process.env["LOCALAPPDATA"] ?? join(home, "AppData", "Local"))
      : process.platform === "darwin"
        ? join(home, "Library", "Caches")
        : (process.env["XDG_CACHE_HOME"] ?? join(home, ".cache"));
  return join(base, "tsdraft", "reads");
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

const sameStat = (a: Stamp, b: Stats): boolean =>
  a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.ino === b.ino;

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

/** The SHA-256 of a file's bytes, or undefined once it holds more than `most` of them. */
async function hashFile(file: string, most: number): Promise<string | undefined> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += (chunk as Buffer).length;
    if (bytes > most) return undefined;
    hash.update(chunk as Buffer);
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

function fingerprint(by: { name: string; version: string }, folder: string): string | null {
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

const core = JSON.parse(await readFile(join(OWN_FOLDER, "package.json"), "utf8")) as {
  name: string;
  version: string;
};

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

  /** Reads `file` with `reader`, or the core's `readDXF` for `null`, through the cache. */
  async read(
    file: string,
    reader: ReaderPackage | null,
    limits: ReadLimits = {},
    options: ReadOptions = {},
  ): Promise<CachedRead> {
    const by = reader ? { name: reader.name, version: reader.version } : core;
    let path: string;
    let found: Stats;
    try {
      path = realpathSync.native(file);
      found = await stat(path);
    } catch {
      return uncached(file, reader, limits, options);
    }
    // A file over the limit is refused as `readDrawingFile` refuses it, before it is hashed.
    if (found.size > (limits.maxFileBytes ?? 1024 * MB)) {
      return uncached(file, reader, limits, options);
    }
    const geometry = options.geometry === true;
    // A reader reads with the core's code too, so the core's own build is part of every key.
    const own = fingerprint(core, OWN_FOLDER);
    const theirs = reader ? fingerprint(by, reader.folder) : own;
    const print = own === null || theirs === null ? null : `${own} ${theirs}`;
    let stamp = this.#stamps.get(path) ?? (await this.#stampOnDisk(path));
    if (!stamp || !sameStat(stamp, found)) {
      stamp = await this.#stampNow(path, limits.maxFileBytes ?? 1024 * MB);
    }
    if (!stamp) return uncached(file, reader, limits, options);
    const keyOf = (sha256: string) =>
      sha(JSON.stringify([CACHE_FORMAT, READ_FORMAT, sha256, print ?? by.name, geometry]));
    const key = keyOf(stamp.sha256);
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
      const value = JSON.parse(await readFile(this.#stampPath(path), "utf8")) as Partial<Stamp> & {
        path?: unknown;
      };
      const ok =
        value.path === path &&
        typeof value.size === "number" &&
        typeof value.mtimeMs === "number" &&
        typeof value.ctimeMs === "number" &&
        typeof value.ino === "number" &&
        typeof value.sha256 === "string" &&
        /^[0-9a-f]{64}$/.test(value.sha256);
      return ok ? (value as Stamp) : undefined;
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
      const read = bare(JSON.parse(text)) as DrawingRead;
      const sound =
        checkDrawingRead(read).length === 0 &&
        read.sha256 === stamp.sha256 &&
        read.bytes === stamp.size;
      if (!sound) throw new Error("not this file's read");
      const now = new Date();
      await utimes(path, now, now).catch(() => {});
      return { read, bytes: text.length };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        await rm(path, { force: true, recursive: true }).catch(() => {});
      }
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
