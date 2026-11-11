// Runs builds in child processes, one build each. Starting Node and loading the library are
// most of a small build's time, so with `warm` two children wait. The first is asked to warm
// up: to load the library the last build used and run it once, when that library is the
// command's own package's. It never loads the drawing or anything else the drawing imports,
// and its library's files are compared with the disk before it builds, by the parent and
// then by itself. When one has changed, the build runs in the second, which has started and
// holds nothing, as every build does when the drawing uses another copy of the library.
import { fork, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BuildState, Timings } from "./state.ts";
import { fileVersion } from "./version.ts";
import type {
  BuildRequest,
  FileVersion,
  WarmRequest,
  WorkerMessage,
  WorkerResult,
} from "./worker.ts";

// The worker beside this file: TypeScript in a checkout, JavaScript in the published package.
const workerPath = new URL(
  import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js",
  import.meta.url,
);
const LOG_LIMIT = 8_000;
const SPARES = 2;
/** A warm-up takes a fraction of a second. One that takes this long will not end. */
const WARM_DEADLINE = 2_000;

export interface Outcome extends WorkerResult {
  readonly ms: number;
  readonly timings: Timings;
  readonly log: string;
}

interface Child {
  readonly process: ChildProcess;
  readonly spawnedAt: number;
  readonly ready: Promise<number>;
  isReady: boolean;
  /**
   * The library this child was asked to load ahead, `null` when it was asked to warm up
   * without one, and `undefined` while it has not been asked: it then holds nothing.
   */
  holds: string | null | undefined;
  /** Settles when the warming this child was asked for is over, or the child is. */
  warmed: Promise<void> | undefined;
  /** The files a warmed child holds, with the versions it will compare with the disk. */
  held: readonly FileVersion[];
  /** True once the parent ended it because it cannot build: the build goes to another. */
  dropped: boolean;
  log: string;
  cancelled: boolean;
}

export class Builder {
  readonly #timeout: number;
  /** Whether the pictures show the layers that do not plot. */
  readonly #drawNoPlot: boolean;
  readonly #warm: boolean;
  readonly #warmDeadline: number;
  /**
   * The children that wait for a build. The first is warmed up and the second holds
   * nothing, so that a build the first must not run has a child that has started.
   */
  readonly #spares: Child[] = [];
  #running: Child | undefined;
  /** The library the last good build used, when a spare may load it ahead. */
  #library: string | null = null;
  /**
   * The libraries a spare could not keep or did not warm up with in time, each with its folder
   * as it was then: every file and folder in it, and the folder itself. None loads one ahead
   * again until one of those changes. One that missed the deadline once is tried once more,
   * after the next build, since a busy or stopped machine can make any warm-up late.
   */
  readonly #unkept = new Map<
    string,
    { readonly files: readonly FileVersion[]; retries: number; trying: boolean }
  >();

  constructor(options: {
    timeout: number;
    warm: boolean;
    drawNoPlot?: boolean;
    /** How long a spare may take to warm up. */
    warmDeadline?: number;
  }) {
    this.#drawNoPlot = options.drawNoPlot === true;
    this.#timeout = options.timeout;
    this.#warm = options.warm;
    this.#warmDeadline = options.warmDeadline ?? WARM_DEADLINE;
    this.#refill();
  }

  /** Builds a file. Resolves `undefined` when `cancel()` stopped it. */
  async build(file: string, root: string): Promise<Outcome | undefined> {
    const started = now();
    // A spare that died while it waited is replaced; so is any child the request cannot reach.
    // A build that a warmed spare must not run goes to the spare that holds nothing.
    // The first spare is asked only when what it holds is on disk as it loaded it. It checks
    // again itself, since the parent's look and its own start are a moment apart.
    const first = this.#spares[0];
    let plain = first?.held.some(([path, version]) => fileVersion(path) !== version) === true;
    if (plain) this.#drop(first!);
    for (let retried = false; ;) {
      const at = plain ? this.#spares.findIndex((spare) => spare.holds === undefined) : 0;
      const child = (at < 0 ? undefined : this.#spares.splice(at, 1)[0]) ?? spawn();
      this.#running = child;
      let outcome: Awaited<ReturnType<typeof run>>;
      try {
        const running = run(
          child,
          { type: "build", file, root, drawNoPlot: this.#drawNoPlot },
          started,
          this.#timeout,
        );
        // Starting the next child takes time, so a child that is ready is sent the file first.
        if (child.isReady) await null;
        // While a warmed spare builds, the next warms up with the same library, so that a save
        // that follows at once finds it warm. Not when the library has just changed: the
        // spare that holds nothing is then the one that builds.
        if (!plain && this.#library !== null) this.#settle();
        else this.#refill();
        outcome = await running;
        if (outcome === "stale") {
          plain = true;
          continue;
        }
        if (outcome !== "unreached" || retried) {
          return outcome === "unreached" ? unreached(file, started, child.log) : outcome;
        }
        retried = true;
      } finally {
        if (this.#running === child) this.#running = undefined;
        this.#refill();
        // A build that was stopped is followed by another at once, which takes a spare as it is.
        if (typeof outcome! === "object") {
          if (outcome.ok) this.#library = outcome.library;
          this.#settle(true);
        }
      }
    }
  }

  /**
   * Leaves the first spare warmed up with the library the last good build used, and no
   * spare with another: one that warmed up with another, or with none, is replaced.
   */
  #settle(afterBuild = false): void {
    let library = this.#library;
    const mark = library === null ? undefined : this.#unkept.get(library);
    if (mark?.files.some(([path, version]) => fileVersion(path) !== version)) {
      this.#unkept.delete(library!);
    } else if (mark) {
      if (afterBuild && mark.retries > 0) {
        mark.retries--;
        mark.trying = true;
      }
      if (!mark.trying) library = null;
    }
    for (const spare of [...this.#spares]) {
      if (spare.holds !== undefined && spare.holds !== library) this.#drop(spare);
    }
    this.#refill();
    const first = this.#spares[0];
    if (first && first.holds === undefined) this.#warmUp(first, library);
  }

  /** Ends a spare that must not build. */
  #drop(spare: Child): void {
    spare.dropped = true;
    spare.process.kill("SIGKILL");
    const at = this.#spares.indexOf(spare);
    if (at >= 0) this.#spares.splice(at, 1);
  }

  #warmUp(spare: Child, library: string | null): void {
    spare.holds = library;
    const files = library === null ? [] : folderVersions(dirname(library));
    spare.warmed = new Promise((resolve) => {
      // A spare that cannot build, or does not finish in time, is ended, and its library is
      // not loaded ahead again as it is.
      const refuse = (late: boolean) => {
        if (library !== null) {
          // A first time late is tried again. A second, or a library that cannot be kept, waits.
          const retries = late && !this.#unkept.has(library) ? 1 : 0;
          this.#unkept.set(library, { files, retries, trying: false });
        }
        this.#drop(spare);
        if (!this.#running) this.#settle();
        resolve(this.warmed());
      };
      let deadline: NodeJS.Timeout | undefined;
      const done = (m?: WorkerMessage) => {
        if (m && m.type !== "warmed") return;
        clearTimeout(deadline);
        spare.process.off("message", done);
        if (m?.kept === false) return refuse(false);
        if (m && library !== null) this.#unkept.delete(library);
        spare.held = m?.held ?? [];
        resolve();
      };
      spare.process.on("message", done);
      spare.process.once("exit", () => done());
      // The deadline counts from the request, not from the child's start. The child ends itself
      // at twice it, should this process be gone or unable to end it.
      void spare.ready.then(
        () => {
          const request: WarmRequest = { type: "warm", library, deadline: this.#warmDeadline * 2 };
          spare.process.send(request);
          deadline = setTimeout(() => refuse(true), this.#warmDeadline);
        },
        () => done(),
      );
    });
  }

  /** Settles when each spare has finished the warming it was asked for, if any. */
  async warmed(): Promise<void> {
    await Promise.all(this.#spares.map((spare) => spare.warmed));
  }

  #refill(): void {
    while (this.#warm && this.#spares.length < SPARES) {
      const child = spawn();
      child.process.once("exit", () => {
        const at = this.#spares.indexOf(child);
        if (at >= 0) this.#spares.splice(at, 1);
      });
      this.#spares.push(child);
    }
  }

  /** Stops the build in progress, if any. */
  cancel(): void {
    if (!this.#running) return;
    this.#running.cancelled = true;
    this.#running.process.kill("SIGKILL");
    this.#running = undefined;
  }

  close(): void {
    this.cancel();
    for (const spare of this.#spares.splice(0)) spare.process.kill("SIGKILL");
  }
}

/**
 * The folder, and every file and folder in it and below it, with its version. A folder's
 * version changes when an entry is added to it or taken from it.
 */
function folderVersions(folder: string): FileVersion[] {
  const versions: FileVersion[] = [[folder, fileVersion(folder)]];
  try {
    for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
      const path = join(entry.parentPath, entry.name);
      versions.push([path, fileVersion(path)]);
    }
  } catch {
    // Missing: its version, null, says so.
  }
  return versions;
}

function now(): number {
  return performance.timeOrigin + performance.now();
}

function spawn(): Child {
  const spawnedAt = now();
  const proc = fork(workerPath, [], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    // The child takes no flags from the command's own invocation, such as --test.
    execArgv: ["--disable-warning=ExperimentalWarning"],
  });
  const child: Child = {
    process: proc,
    spawnedAt,
    log: "",
    cancelled: false,
    holds: undefined,
    warmed: undefined,
    held: [],
    dropped: false,
    isReady: false,
    ready: new Promise((resolve, reject) => {
      proc.once("message", (m: WorkerMessage) => {
        if (m.type !== "ready") return;
        child.isReady = true;
        resolve(m.at);
      });
      proc.once("exit", () => reject(new Error("The build process ended before it was ready")));
    }),
  };
  child.ready.catch(() => {});
  // A failed send or kill is reported through its callback or return value; this keeps the
  // event from ending the command.
  proc.on("error", () => {});
  const keep = (chunk: Buffer) => {
    child.log = (child.log + chunk.toString()).slice(-LOG_LIMIT);
  };
  proc.stdout!.on("data", keep);
  proc.stderr!.on("data", keep);
  return child;
}

/**
 * Runs one build in a child. Resolves `"unreached"` when the child ended before the request
 * reached it, and `"stale"` when the child holds a library that is no longer the one on disk,
 * so the caller can try another.
 */
function run(
  child: Child,
  request: BuildRequest,
  started: number,
  timeout: number,
): Promise<Outcome | undefined | "unreached" | "stale"> {
  const proc = child.process;
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null || !proc.connected) {
      return resolve("unreached");
    }
    let start: number | undefined;
    let result: WorkerResult | undefined;
    /** The files the child said it loaded, for when it dies before it answers. */
    const files: FileVersion[] = [];
    let doneAt: number | undefined;
    let timedOut = false;
    let sent = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeout);
    proc.on("message", (m: WorkerMessage) => {
      if (m.type === "file") files.push(m.file);
      else if (m.type === "stale") {
        // No need to wait for it to leave: another child takes the build now.
        clearTimeout(timer);
        resolve("stale");
      } else if (m.type === "done") {
        result = m.result;
        doneAt = now();
      }
    });
    // "close" comes after the process has ended and its output has all been read.
    proc.once("close", (code, signal) => {
      clearTimeout(timer);
      if (child.cancelled) return resolve(undefined);
      if (child.dropped && !result) return resolve("stale");
      if (!sent && !timedOut) return resolve("unreached");
      const ending = timedOut
        ? failure(
            request.file,
            "Timeout",
            `The drawing file took longer than ${timeout} ms to build. Look for a loop that never ends`,
            files,
          )
        : (result ??
          failure(
            request.file,
            "Exit",
            `The drawing file's process ended before it gave a drawing (${signal ?? `exit code ${code}`})`,
            files,
          ));
      resolve({
        ...ending,
        timings: { ...(start === undefined ? {} : { start }), ...ending.timings },
        ms: (doneAt ?? now()) - started,
        log: child.log.trim(),
      });
    });
    void child.ready.then(
      (readyAt) => {
        // A spare that was ready before the build began cost the build nothing.
        start = Math.max(0, readyAt - Math.max(started, child.spawnedAt));
        proc.send(request, (error) => {
          if (!error) sent = true;
        });
      },
      () => {},
    );
  });
}

function failure(
  file: string,
  name: string,
  message: string,
  loaded: readonly FileVersion[] = [],
): WorkerResult {
  return {
    ok: false,
    // The drawing file at its version now when the build never said it read it.
    files: loaded.some(([path]) => path === file) ? loaded : [[file, fileVersion(file)], ...loaded],
    timings: {},
    drawing: null,
    diagnostics: [],
    svg: null,
    fonts: [],
    layouts: [],
    swatches: {},
    library: null,
    modules: { read: 0, ahead: 0 },
    error: { name, message, code: null, file, line: null, column: null, stack: "" },
  };
}

/** The outcome when no child could be given the build, which only a broken setup causes. */
function unreached(file: string, started: number, log: string): Outcome {
  const ending = failure(file, "Exit", "The build process ended before it could be given the file");
  return { ...ending, ms: now() - started, log: log.trim() };
}

/** The project folder of a drawing file: the nearest folder above it with a package.json. */
export function projectRoot(file: string): string {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) return dir;
    if (dir === dirname(dir)) return dirname(file);
  }
}

/** The `BuildState` for an outcome, with outputs given as paths or URLs by the caller. */
export function toState(
  outcome: Outcome,
  session: string,
  build: number,
  file: string,
  shownBuild: number | null,
  outputs: BuildState["outputs"],
): BuildState {
  return {
    schema: 2,
    ok: outcome.ok,
    build,
    session,
    pending: null,
    shownBuild,
    file,
    finishedAt: new Date().toISOString(),
    ms: round(outcome.ms),
    timings: Object.fromEntries(
      Object.entries(outcome.timings).map(([step, ms]) => [step, round(ms)]),
    ),
    drawing: outcome.drawing,
    diagnostics: outcome.diagnostics,
    error: outcome.error,
    outputs,
    log: outcome.log,
  };
}

/** Milliseconds to a tenth. */
export function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}
