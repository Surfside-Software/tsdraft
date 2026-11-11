// Runs builds in child processes. Starting Node is most of a small build's time, so with
// `warm` the next child starts as soon as a build starts, and waits for a file, so a save that
// follows at once finds it ready. A waiting child has loaded only the worker, never the drawing
// or tsdraft, so it cannot hold stale code.
import { fork, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BuildState, Timings } from "./state.ts";
import { fileVersion } from "./version.ts";
import type { BuildRequest, FileVersion, WorkerMessage, WorkerResult } from "./worker.ts";

// The worker beside this file: TypeScript in a checkout, JavaScript in the published package.
const workerPath = new URL(
  import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js",
  import.meta.url,
);
const LOG_LIMIT = 8_000;

export interface Outcome extends WorkerResult {
  readonly ms: number;
  readonly timings: Timings;
  readonly log: string;
}

interface Child {
  readonly process: ChildProcess;
  readonly spawnedAt: number;
  readonly ready: Promise<number>;
  log: string;
  cancelled: boolean;
}

export class Builder {
  readonly #timeout: number;
  /** Whether the pictures show the layers that do not plot. */
  readonly #drawNoPlot: boolean;
  readonly #warm: boolean;
  #spare: Child | undefined;
  #running: Child | undefined;

  constructor(options: { timeout: number; warm: boolean; drawNoPlot?: boolean }) {
    this.#drawNoPlot = options.drawNoPlot === true;
    this.#timeout = options.timeout;
    this.#warm = options.warm;
    this.#refill();
  }

  /** Builds a file. Resolves `undefined` when `cancel()` stopped it. */
  async build(file: string, root: string): Promise<Outcome | undefined> {
    const started = now();
    // A spare that died while it waited is replaced; so is any child the request cannot reach.
    for (let attempt = 0; ; attempt++) {
      const child = (attempt === 0 ? this.#spare : undefined) ?? spawn();
      if (child === this.#spare) this.#spare = undefined;
      this.#running = child;
      this.#refill();
      try {
        const outcome = await run(
          child,
          { type: "build", file, root, drawNoPlot: this.#drawNoPlot },
          started,
          this.#timeout,
        );
        if (outcome !== "unreached" || attempt > 0) {
          return outcome === "unreached" ? unreached(file, started, child.log) : outcome;
        }
      } finally {
        if (this.#running === child) this.#running = undefined;
        this.#refill();
      }
    }
  }

  #refill(): void {
    if (!this.#warm || this.#spare) return;
    const child = spawn();
    child.process.once("exit", () => {
      if (this.#spare === child) this.#spare = undefined;
    });
    this.#spare = child;
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
    const spare = this.#spare;
    this.#spare = undefined;
    spare?.process.kill("SIGKILL");
  }
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
    ready: new Promise((resolve, reject) => {
      proc.once("message", (m: WorkerMessage) => {
        if (m.type === "ready") resolve(m.at);
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
 * reached it, so the caller can try another.
 */
function run(
  child: Child,
  request: BuildRequest,
  started: number,
  timeout: number,
): Promise<Outcome | undefined | "unreached"> {
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
      else if (m.type === "done") {
        result = m.result;
        doneAt = now();
      }
    });
    // "close" comes after the process has ended and its output has all been read.
    proc.once("close", (code, signal) => {
      clearTimeout(timer);
      if (child.cancelled) return resolve(undefined);
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
    swatches: {},
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
