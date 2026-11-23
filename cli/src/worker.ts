// Runs one drawing file in a child process of its own, so that a crash, a hang or a changed
// import cannot reach the command, and every build imports fresh code. The parent starts this
// process ahead of time and sends it a file to build; it answers once and exits.
//
// While it waits, the parent may ask it to warm up. It then loads the library ahead and runs
// it once on a drawing of its own, but only the library of the command's own package: the
// one in the folder this file's package is in, by real path. Another copy may print, count
// or loop when it is run, and a build must not differ for having waited. A build takes a
// module loaded ahead only when every file loaded ahead, every link on the way to one and
// every package.json above one is on disk as it was read. Otherwise the process answers
// `stale` and the parent builds in one that loaded nothing.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire, isBuiltin, registerHooks } from "node:module";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { types } from "node:util";
import { Worker } from "node:worker_threads";
import type {
  Block,
  CallSite,
  Diagnostic,
  DimensionPicture,
  DimensionStyle,
  Drawing,
  DrawingRead,
  Edit,
  EditFile,
  Entity,
  Intent,
  IntentWarning,
  Layout,
  PaperInfo,
  PaperUnit,
  TextWarning,
  Units,
  Viewport,
  ViewportView,
  Xref,
} from "tsdraft";
import type {
  BlockSummary,
  Box,
  BuildDiagnostic,
  BuildError,
  DimensionSummary,
  DrawingSummary,
  EditSummary,
  InsertSummary,
  LayerSummary,
  LayoutSummary,
  StandardSummary,
  XrefSummary,
} from "./state.ts";
import { LEFT_OUT, without } from "./omit.ts";
import { fileVersion } from "./version.ts";
import { isFunction, isNumber, isObject, isString } from "./guards.ts";
import { formatSteps, librarySteps, stripSteps, type Library as OwnLibrary } from "./warmup.ts";

export interface BuildRequest {
  readonly type: "build";
  readonly file: string;
  /** The project folder: files under it, outside node_modules, are the user's code. */
  readonly root: string;
  /** Draws the layers that do not plot too. */
  readonly drawNoPlot?: boolean;
  /** For a DXF or a DWG: the package that reads it, as `--reader` names it, from `cwd`. */
  readonly reader?: string;
  readonly cwd?: string;
  /**
   * Draws this one rectangle, of model space or of the layout named, in place of the pictures
   * of every space.
   */
  readonly view?:
    | { readonly box: readonly [number, number, number, number]; readonly layout?: string }
    | undefined;
}

/** What the build of an edit file gives: its edit, as data, and the file it names. */
export interface EditPlan {
  /** The file the edit names, by its absolute path. */
  readonly source: string;
  readonly edit: Edit;
  /** The call in the edit file that made each statement, its `file` an absolute path. */
  readonly calls: readonly (CallSite | null)[];
}

/**
 * Asks the process that keeps the reads to draw an edit's pictures. That process loads no
 * drawing file and no module of the user's: it is given the edit as data.
 */
export interface PreviewRequest {
  readonly type: "preview";
  readonly id: number;
  readonly plan: EditPlan;
  readonly drawNoPlot?: boolean;
  readonly view?: BuildRequest["view"];
  /** Whether to draw the pictures of changes now. Otherwise `ChangesRequest` asks for them. */
  readonly changes?: boolean;
  readonly reader?: string;
  readonly cwd?: string;
}

/** Asks the process that keeps the reads for the pictures of changes of the preview `id`. */
export interface ChangesRequest {
  readonly type: "changes";
  readonly id: number;
}

/**
 * Asks a waiting process to warm up, with the entry of the library to load ahead, if any, and
 * the milliseconds after which the process ends itself if the warm-up has not finished.
 */
export interface WarmRequest {
  readonly type: "warm";
  readonly library: string | null;
  readonly deadline: number;
}

/**
 * `file` is sent as each tracked file is loaded, so a build that never answers still names them.
 * `warmed` says the warming is over, also when a build cut it short, and `kept` whether this
 * process can still build: it cannot once it has loaded more than the library's own files.
 * `held` is every path it will compare with the disk before it builds, with the version it
 * holds, so the parent can tell a build it would refuse without asking it.
 * `stale` answers a build this process must not run.
 */
export type WorkerMessage =
  | { readonly type: "ready"; readonly at: number }
  | { readonly type: "warmed"; readonly kept: boolean; readonly held: readonly FileVersion[] }
  | { readonly type: "stale" }
  | { readonly type: "file"; readonly file: FileVersion }
  | { readonly type: "done"; readonly result: WorkerResult }
  | { readonly type: "previewed"; readonly id: number; readonly result: WorkerResult }
  | {
      readonly type: "changed";
      readonly id: number;
      /** `null` when that preview is no longer the last. */
      readonly changes: WorkerResult["changes"] | null;
    };

export type FileVersion = readonly [path: string, version: string | null];

export interface WorkerResult {
  readonly ok: boolean;
  /**
   * The files the build loaded whose real path has no node_modules folder, wherever they are, the
   * drawing file first, and one it failed to find, to watch for changes. Each with its
   * `fileVersion` from just before it was read. A path read at two versions is listed twice. A
   * path through a symlink is listed beside the file it led to, and so is the linked package
   * folder in node_modules that a bare import went through.
   */
  readonly files: readonly FileVersion[];
  readonly timings: Readonly<Timings>;
  readonly drawing: DrawingSummary | null;
  readonly diagnostics: readonly BuildDiagnostic[];
  readonly svg: string | null;
  /** The fonts of the drawing that text in the picture of model space is set in. */
  readonly fonts: readonly string[];
  /** The picture of each layout, in the order of `drawing.layouts`, with its fonts. */
  readonly layouts: readonly {
    readonly name: string;
    readonly svg: string;
    readonly fonts: readonly string[];
  }[];
  /** The picture of the rectangle the request asked for, with its fonts, or `null`. */
  readonly view: {
    readonly layout: string | null;
    readonly svg: string;
    readonly fonts: readonly string[];
  } | null;
  /** The color `toSVG` draws each layer in, by layer name. */
  readonly swatches: Readonly<Swatches>;
  readonly error: BuildError | null;
  /** True for a build that failed after `lint` reported errors, which `diagnostics` holds. */
  readonly linted?: boolean;
  /**
   * The entry of the copy of tsdraft that checked and drew the drawing, when it is the library
   * of the command's own package: what the next process may load ahead. `null` otherwise.
   */
  readonly library: string | null;
  /** The modules the build read from disk, and those it took from the ones loaded ahead. */
  readonly modules: { readonly read: number; readonly ahead: number };
  /** For an edit file, before its pictures are drawn: its edit, for the process that keeps reads. */
  readonly plan?: EditPlan;
  /** For an edit file, once drawn: its statements and where each is. */
  readonly edit?: EditSummary;
  /** For an edit file, once drawn: the pictures of what it changes, in the order of `layouts`. */
  readonly changes?: {
    readonly svg: string | null;
    readonly layouts: readonly { readonly name: string; readonly svg: string }[];
  };
  /** For an edit file drawn without them, the preview whose pictures of changes can be asked for. */
  readonly changesLater?: number;
}

/** How long each step of a build took, in milliseconds. */
interface Timings {
  load?: number;
  lint?: number;
  inspect?: number;
  intent?: number;
  svg?: number;
}

/** The fields of a value given as a drawing that the worker reads first, as the file gives each. */
interface DrawingFields {
  readonly layers?: unknown;
  readonly entities?: unknown;
  readonly units?: unknown;
  readonly build?: unknown;
}

/** A value of the `xrefs` export that holds `drawing`, with each field as the file gives it. */
interface XrefFields {
  readonly drawing: unknown;
  readonly xrefs?: unknown;
}

/** The fields of a thrown value that the worker reads, as the file gives each. */
interface ThrownFields {
  readonly name?: unknown;
  readonly code?: unknown;
  readonly url?: unknown;
  readonly diagnostics?: unknown;
}

/** The fields of a linetype and of its marks that the worker reads, as the drawing gives each. */
interface LinetypeFields {
  readonly marks?: unknown;
}

interface MarkFields {
  readonly file?: unknown;
}

/** The fields of an image or underlay that the worker reads, as the drawing gives each. */
interface PictureEntityFields {
  readonly kind?: unknown;
  readonly path?: unknown;
  readonly pixels?: unknown;
  readonly page?: unknown;
  readonly pageSize?: unknown;
}

/** The exports of a drawing file that a build reads, each as the file gives it. */
interface DrawingModule {
  readonly default?: unknown;
  readonly xrefs?: unknown;
  readonly intent?: unknown;
  readonly standard?: unknown;
}

/** What the `xrefs` export gives for one xref: a drawing, or `{ drawing, xrefs }`. */
type GivenXref = Drawing | GivenDrawing;

interface GivenDrawing {
  readonly drawing: Drawing;
  /** What is given for the xrefs of `drawing`. */
  readonly xrefs?: GivenXrefs;
  /** The files of the drawing's images, which the worker reads for the pictures. */
  readonly images?: Readonly<Record<string, Uint8Array>>;
}

/** What the `xrefs` export gives: a drawing, or `{ drawing, xrefs }`, by an xref's name. */
type GivenXrefs = Readonly<Record<string, GivenXref>>;

/** The files of a drawing's images and of its underlays' pages, for the pictures. */
interface PictureFiles {
  images?: Readonly<Record<string, Uint8Array>>;
  underlays?: Readonly<Record<string, Readonly<Record<string, Uint8Array>>>>;
}

/**
 * The shape files a drawing's linetypes name, for `lint` and the pictures: as `shx`, or as
 * `shapes` to a copy of tsdraft from before the SHX names.
 */
interface ShxFiles extends OlderShxFiles {
  shx?: Readonly<Record<string, Uint8Array>>;
}

/** The names a copy of tsdraft from before the SHX names gives what `ShxNames` names. */
const OLDER_SHX = { key: "shapeFileKey", glyph: "shape", option: "shapes" } as const;

/** The option of shape files of a copy of tsdraft from before the SHX names. */
type OlderShxFiles = { [K in typeof OLDER_SHX.option]?: Readonly<Record<string, Uint8Array>> };

/** The key of a shape file in a copy of tsdraft from before the SHX names. */
type OlderShxKey = { readonly [K in typeof OLDER_SHX.key]?: (file: string) => string };

interface LintOptions extends ShxFiles {
  standard?: unknown;
  xrefs?: GivenXrefs;
  underlays?: Readonly<Record<string, Readonly<Record<string, Uint8Array>>>>;
}

interface PictureOptions extends PictureFiles, ShxFiles {
  margin?: number;
  drawNoPlot?: boolean;
  xrefs?: GivenXrefs;
  layout?: string;
  view?: readonly [number, number, number, number];
}

interface Library extends OlderShxKey {
  /** The call that made a statement of an edit. A copy of tsdraft from before edits has none. */
  readonly statementCall?: (edit: Edit, index: number) => CallSite | undefined;
  readonly lint: (drawing: Drawing, options?: LintOptions) => Diagnostic[];
  /** A copy of tsdraft from before standards has none, and its `lint` takes no standard. */
  readonly defineStandard?: unknown;
  readonly toSVG: (drawing: Drawing, options?: PictureOptions) => string;
  /**
   * The key a shape file is found by. A copy of tsdraft from before the SHX names has
   * `OLDER_SHX.key` in its place, and one from before shapes has neither.
   */
  readonly shxFileKey?: (file: string) => string;
  /** Where an underlay's page goes. A copy of tsdraft from before underlays has none. */
  readonly underlayCorners?: unknown;
  /** A PDF page's size in inches. A copy of tsdraft from before it has none. */
  readonly pdfPageSize?: (
    bytes: Uint8Array,
    page: string | number,
  ) => readonly [number, number] | undefined;
  /** A raster file's pixels. A copy of tsdraft from before images has none. */
  readonly rasterSize?: (bytes: Uint8Array) => [number, number] | undefined;
  /** What is wrong with the text as it plots. A copy of tsdraft from before it has none. */
  readonly inspectText?: (
    drawing: Drawing,
    options?: { drawNoPlot?: boolean; xrefs?: GivenXrefs },
  ) => TextWarning[];
  /** Where the drawing does not hold to its intent. A copy of tsdraft from before it has none. */
  readonly checkIntent?: (drawing: Drawing, intent: Intent) => IntentWarning[];
  /** What a viewport shows, and the papers. A copy of tsdraft from before layouts has neither. */
  readonly viewportView?: (viewport: Viewport, paperUnits: PaperUnit, units: Units) => ViewportView;
  readonly PAPERS?: Readonly<Record<string, PaperInfo>>;
  /** The fonts a text style may have. A copy of tsdraft from before text styles has none. */
  readonly FONTS?: Readonly<Record<string, { readonly family: string }>>;
  /** The block an insert of a name places. A copy of tsdraft from before blocks has none. */
  readonly findBlock?: (drawing: Drawing, name: string) => Block | undefined;
  /** The xref an insert of a name places. A copy of tsdraft from before xrefs has none. */
  readonly findXref?: (drawing: Drawing, name: string) => Xref | undefined;
  /**
   * What the pictures draw of the drawings given for the xrefs. A copy of tsdraft from before
   * attachments has none, and draws no reference of a referenced drawing.
   */
  readonly drawnXrefs?: (drawing: Drawing, xrefs: GivenXrefs) => GivenXrefs;
  /** A dimension's style and what it draws. A copy of tsdraft from before dimensions has neither. */
  readonly findDimensionStyle?: (drawing: Drawing, name: string) => DimensionStyle | undefined;
  /** An older copy throws for a kind of dimension it does not know, which the caller catches. */
  readonly dimensionPicture?: (dimension: Dimension, style: DimensionStyle) => DimensionPicture;
}

// The streams' own `write`, which a drawing file may replace on `process.stdout` and
// `process.stderr`: the process writes through these to know its output has left it.
const [writeOut, writeErr] = [process.stdout.write, process.stderr.write];

/** The streams themselves, which a drawing may replace, end or cork. */
const [stdout, stderr] = [process.stdout, process.stderr];

// Deep enough that a drawing calling helpers several levels down still has its own frame.
Error.stackTraceLimit = 100;

// Every builder the drawing file makes records the call that draws each entity, for `call`.
Object.assign(globalThis, { TSDRAFT_RECORD_CALLS: true });

/**
 * This command's own code and the library beside it, built and as source, which are never the
 * user's code.
 */
const ownCode = ["./", "../../dist/", "../../src/"].map((folder) =>
  fileURLToPath(new URL(folder, import.meta.url)),
);

/**
 * The entries of the library of the command's own package, built and as source: the package
 * is the folder two above this file, by its real path, whatever its package.json says.
 */
const ownEntries = ["dist/index.js", "src/index.ts"].map((entry) =>
  join(realpathSync.native(fileURLToPath(new URL("../..", import.meta.url))), entry),
);

/** Each module URL the build loaded. */
const loaded = new Set<string>();

/** The files each file imported, by the importer's path. */
const imported = new Map<string, string[]>();

/** Each tracked path the build read, with every version it was read at. */
const read = new Map<string, Set<string | null>>();

/** An import of a module loaded ahead: where it led, and the link it went through, if any. */
interface AheadImport {
  readonly url: string;
  readonly path: string;
  readonly link: FileVersion | undefined;
}

/** Each module loaded ahead of the build, by its URL, with its version from before it was read. */
const ahead = new Map<
  string,
  { readonly path: string; readonly version: string | null; readonly imports: AheadImport[] }
>();

/**
 * Each path an import of a module loaded ahead named, with its version from before it was
 * followed. A version names the file the path leads to, so it covers every link on the way.
 */
const links = new Map<string, string | null>();

/** Each package.json Node may have read for a module loaded ahead, with its version before. */
const scopes = new Map<string, string | null>();

/**
 * False once something loaded ahead was reached other than by a path, such as a package or a
 * part of Node, or failed to load. What this process holds can then not be told from its files.
 */
let closed = true;

/** True from the moment a build is asked for. Before it, every load is one ahead. */
let building = false;

/**
 * The folder of the library being loaded ahead, with a separator at its end. An import that
 * leads outside it, or to a part of Node, is refused before anything of it runs.
 */
let aheadFolder: string | undefined;
const modules = { read: 0, ahead: 0 };

/** While what a kept process keeps is made, each path it reads, to tell later that it is current. */
let collecting: FileVersion[] | undefined;

/** Notes a version of a path the build depends on, and tells the parent at once. */
function track(path: string, version: string | null): void {
  if (collecting) {
    collecting.push([path, version]);

    return;
  }

  let versions = read.get(path);

  if (!versions) read.set(path, (versions = new Set()));

  if (versions.has(version)) return;
  versions.add(version);
  process.send!({ type: "file", file: [path, version] } satisfies WorkerMessage);
}

/** Notes every package.json above a path, and above the file it leads to, before Node reads one. */
function scope(path: string): void {
  let real = path;

  try {
    real = realpathSync.native(path);
  } catch {
    // Missing: Node will say so.
  }

  for (const start of new Set([path, real])) {
    for (let dir = dirname(start); ; dir = dirname(dir)) {
      const manifest = join(dir, "package.json");

      if (!scopes.has(manifest)) scopes.set(manifest, fileVersion(manifest));

      if (dir === dirname(dir)) break;
    }
  }
}

// This file's own, which Node has just read.
scope(fileURLToPath(import.meta.url));

/**
 * Counts a module loaded ahead, and all it imports, as loaded by the build, with the versions
 * they were read at: the build runs them as if it had read them now.
 */
function claim(url: string): void {
  const module = ahead.get(url);

  if (!module || loaded.has(url)) return;
  loaded.add(url);
  modules.ahead++;

  if (tracked(module.path)) track(module.path, module.version);

  for (const { url: to, path, link } of module.imports) {
    if (link) track(...link);
    const list = imported.get(module.path);

    if (list) list.push(path);
    else imported.set(module.path, [path]);
    claim(to);
  }
}

/**
 * Whether a file loaded ahead, a path that led to one or a package.json above one is no
 * longer as it was read.
 */
function stale(): boolean {
  if (!closed) return true;

  for (const { path, version } of ahead.values()) if (fileVersion(path) !== version) return true;

  for (const [path, version] of links) if (fileVersion(path) !== version) return true;

  if (ahead.size === 0) return false;

  for (const [path, version] of scopes) if (fileVersion(path) !== version) return true;

  return false;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // A path through a symlink: its version names the target, so pointing it elsewhere counts.
    // A bare import goes through the package's folder in node_modules, often a workspace link.
    const parent = context.parentURL?.startsWith("file:") ? context.parentURL : undefined;
    const byPath = /^(\.{0,2}\/|file:)/.test(specifier);

    const asked = !parent
      ? undefined
      : byPath
        ? fileURLToPath(new URL(specifier, parent))
        : packageFolder(specifier, fileURLToPath(parent));

    const version = asked === undefined ? null : fileVersion(asked);

    if (!building) {
      if (parent && byPath) {
        scope(asked!);

        if (!links.has(asked!)) links.set(asked!, version);
      } else closed = false;
    }

    const result = nextResolve(specifier, context);

    if (!building && aheadFolder !== undefined && !inside(result.url, aheadFolder)) {
      closed = false;
      throw new Error(`The library imports ${specifier}, which is not one of its own files`);
    }

    if (parent && result.url.startsWith("file:")) {
      const path = fileURLToPath(result.url);

      const link: FileVersion | undefined =
        asked !== undefined && path !== asked && tracked(path) ? [asked, version] : undefined;

      if (!building) {
        ahead.get(parent)?.imports.push({ url: result.url, path, link });

        return result;
      }

      if (link) track(...link);
      // Every file a file imports, also through an alias that names no folder to watch.
      const importer = fileURLToPath(parent);
      const list = imported.get(importer);

      if (list) list.push(path);
      else imported.set(importer, [path]);
      claim(result.url);
    }

    return result;
  },
  load(url, context, nextLoad) {
    if (!building) {
      if (url.startsWith("file:")) {
        const path = fileURLToPath(url);
        scope(path);
        ahead.set(url, { path, version: fileVersion(path), imports: [] });
      } else closed = false;
    } else if (url.startsWith("file:") && !loaded.has(url)) {
      loaded.add(url);
      modules.read++;
      const path = fileURLToPath(url);

      if (tracked(path)) track(path, fileVersion(path));
    }

    return nextLoad(url, context);
  },
});

/** Whether a module's URL is a file in a folder, by its real path. */
function inside(url: string, folder: string): boolean {
  if (!url.startsWith("file:")) return false;

  try {
    return realpathSync.native(fileURLToPath(url)).startsWith(folder);
  } catch {
    return false;
  }
}

/** Where Node looks for a bare import's package: the nearest `node_modules/<name>` that exists. */
function packageFolder(specifier: string, parent: string): string | undefined {
  const name = /^((?:@[^/:]+\/)?[^/:#.][^/:]*)(?:\/|$)/.exec(specifier)?.[1];

  if (!name || isBuiltin(specifier)) return undefined;

  for (let dir = dirname(parent); ; dir = dirname(dir)) {
    const folder = join(dir, "node_modules", name);

    if (existsSync(folder)) return folder;

    if (dir === dirname(dir)) return undefined;
  }
}

const now = () => performance.timeOrigin + performance.now();

let request: BuildRequest | undefined;
let warming: Promise<void> | undefined;

/**
 * The previews asked for, one after another. A process asked for one keeps the reads and the
 * pictures for the next, and never builds a drawing file.
 */
let previews: Promise<void> | undefined;

process.on("message", (message: BuildRequest | WarmRequest | PreviewRequest | ChangesRequest) => {
  if (message.type === "changes") {
    if (request || warming) return;
    previews = (previews ?? Promise.resolve()).then(() => {
      let changes: WorkerResult["changes"] | null = null;

      try {
        changes = lastChanges?.id === message.id ? lastChanges.draw() : null;
      } catch {
        // Drawn as the edited pictures were, which did not throw: none is given.
      }

      process.send!({ type: "changed", id: message.id, changes } satisfies WorkerMessage);
    });

    return;
  }

  if (message.type === "preview") {
    if (request || warming) return;
    previews = (previews ?? Promise.resolve()).then(async () => {
      const result = await preview(message).catch((cause: unknown) =>
        readFailed(
          message.plan.source,
          {},
          `The pictures of the edit could not be drawn: ${cause instanceof Error ? cause.message : String(cause)}`,
          "PictureError",
        ),
      );

      process.send!({ type: "previewed", id: message.id, result } satisfies WorkerMessage);
    });

    return;
  }

  if (request || previews) return;

  if (message.type === "warm") {
    warming ??= warm(message.library, message.deadline);

    return;
  }

  request = message;
  void (warming ?? Promise.resolve()).then(() => {
    building = true;

    if (stale()) {
      process.send!({ type: "stale" } satisfies WorkerMessage, leave);

      return;
    }

    void build(message).then((result) => {
      process.send!({ type: "done", result } satisfies WorkerMessage, leave);
    });
  });
});

process.once("disconnect", () => process.exit(0));

process.send!({ type: "ready", at: now() } satisfies WorkerMessage);

/**
 * Ends this process once all it wrote has left it: a build's log is whole. It then ends at
 * once, with nothing left to save. A stream the drawing ended, destroyed or corked is not
 * waited for, and the process ends within a second whatever the drawing did to its streams.
 */
function leave(): void {
  const end = () => process.kill(process.pid, "SIGKILL");
  setTimeout(end, 1_000);

  const flush = (stream: NodeJS.WriteStream, write: typeof writeOut, then: () => void): void => {
    if (stream.writableEnded || stream.destroyed || stream.writableCorked > 0) return then();

    try {
      write.call(stream, "", "utf8", () => then());
    } catch {
      then();
    }
  };

  flush(stdout, writeOut, () => flush(stderr, writeErr, end));
}

/**
 * A thread that ends this process when the warm-up has not said it is done by the deadline,
 * or when the parent is gone. It runs apart from the process's own thread, which a step that
 * never returns would hold.
 */
const WATCHDOG = `const { workerData: { flag, deadline, ppid } } = require("node:worker_threads");
const end = performance.now() + deadline;
while (Atomics.load(flag, 0) === 0) {
  if (performance.now() > end || process.ppid !== ppid) process.kill(process.pid, "SIGKILL");
  Atomics.wait(flag, 0, 0, 50);
}`;

/** Starts the watchdog, and gives the function that tells it the warm-up is done. */
function watch(deadline: number): () => void {
  const flag = new Int32Array(new SharedArrayBuffer(4));
  const workerData = { flag, deadline, ppid: process.ppid };
  new Worker(WATCHDOG, { eval: true, workerData, stdout: true, stderr: true }).unref();

  return () => {
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
  };
}

/**
 * Warms this process for the build to come. It stops between two steps once a build is asked
 * for, and no failure of a step matters: the build then finds less of the code compiled.
 * Nothing a step writes is kept, since a build's log is what the drawing file wrote.
 */
async function warm(library: string | null, deadline: number): Promise<void> {
  const done = watch(deadline);

  const unwritten: typeof writeOut = (...given: unknown[]): boolean => {
    const written = given.at(-1);

    if (isFunction(written)) written();

    return true;
  };

  process.stdout.write = process.stderr.write = unwritten;
  const steps = [...stripSteps];

  try {
    if (library !== null && ownEntries.includes(library)) {
      // The library is its folder: a file from elsewhere is one this process cannot answer for.
      aheadFolder = dirname(library) + sep;
      const loadedAhead: OwnLibrary = await import(pathToFileURL(library).href);
      steps.push(...librarySteps(loadedAhead));
    }
  } catch {
    closed = false;
  }

  aheadFolder = undefined;

  for (const step of [...steps, ...formatSteps]) {
    if (request) break;

    try {
      step();
    } catch {
      // A step that fails leaves the build less warm.
    }

    // Lets a request that has come be seen.
    await new Promise((resolve) => setImmediate(resolve));
  }

  [process.stdout.write, process.stderr.write] = [writeOut, writeErr];
  done();

  const held: FileVersion[] = [
    ...[...ahead.values()].map(({ path, version }): FileVersion => [path, version]),
    ...links,
    ...(ahead.size === 0 ? [] : scopes),
  ];

  process.send!({ type: "warmed", kept: closed, held } satisfies WorkerMessage);
}

/** The most xrefs of a read file whose drawings a build reads. */
const XREFS_READ = 32;

/** A file a reader reads, which the command draws as the leading CAD app shows it. */
export const READ_FILE = /\.(dxf|dwg)$/i;

async function build(request: BuildRequest): Promise<WorkerResult> {
  return READ_FILE.test(request.file) ? buildRead(request) : buildCode(request);
}

/** A process's reads, kept for its life, by the folder they are kept in on disk. */
const caches = new Map<string, InstanceType<typeof import("./read-cache.ts").ReadCache>>();

/**
 * What reads a drawing file and the files it names: the cache of the project's reads, and the
 * reader of each extension, `--reader`'s, the project's, or the file's folder's.
 */
async function readersOf(file: string, named: string | undefined, cwd: string | undefined) {
  const { findProject, findReaders, readerFor, ReaderRefusal } = await import("./readers.ts");
  const { cacheFolder, ReadCache } = await import("./read-cache.ts");
  const at = cwd ?? process.cwd();
  const folder = cacheFolder(findProject(at, [file]));
  let cache = caches.get(folder);

  if (!cache) caches.set(folder, (cache = new ReadCache(folder)));

  const readerOf = (extension: string) => {
    const found = readerFor(
      findReaders({ cwd: at, inputs: [file], ...(named !== undefined && { reader: named }) }),
      extension,
    );

    if (found !== null || named !== undefined || extension.toLowerCase() === ".dxf") return found;

    return readerFor(findReaders({ cwd: dirname(file), inputs: [file] }), extension);
  };

  return { cache, readerOf, ReaderRefusal };
}

type Readers = Awaited<ReturnType<typeof readersOf>>;

type CoreLibrary = typeof import("tsdraft") & Library;

/** What the pictures of a read file are drawn with, and what was found out on the way. */
interface ReadContext {
  /** The options of `readPicture`: the reads of the xrefs, the page sizes, images and shapes. */
  readonly options: Omit<Parameters<CoreLibrary["readPicture"]>[1] & object, "layout" | "view">;
  /** The drawing the picture of the read is made from. */
  readonly shown: Drawing;
  /** The warnings of the picture, and of the files it could not read. */
  readonly diagnostics: readonly BuildDiagnostic[];
  readonly fontsOf: (svg: string) => string[];
}

/**
 * What the pictures of a read file are drawn with: each xref's read, found from the path the file
 * holds, from the folder of the file that holds it, or else by its name in that folder, where CAD
 * programs look next, the file's own xrefs and theirs, each given with all of them, so an xref
 * finds its own attachments; the size of each page its underlays show, read from its PDF beside
 * the file; and its images and shapes.
 */
async function readContext(
  library: CoreLibrary,
  { cache, readerOf }: Readers,
  file: string,
  read: DrawingRead,
  drawNoPlot: boolean,
): Promise<ReadContext> {
  const pageSizes: Record<string, Record<string, readonly [number, number]>> = Object.create(null);
  const pdfs = new Map<string, Uint8Array | null>();

  const spaces = [
    read.model.entities,
    ...read.layouts.map((l) => l.entities),
    ...read.blocks.map((b) => b.entities),
  ];

  for (const list of spaces) {
    for (const e of list ?? []) {
      if (e.kind !== "underlay" || isAbsolute(e.path) || /^[A-Za-z]:/.test(e.path)) continue;
      const at = join(dirname(file), e.path.replaceAll("\\", "/"));
      let pdf = pdfs.get(at);

      if (pdf === undefined) {
        track(at, fileVersion(at));

        try {
          pdf = new Uint8Array(readFileSync(at));
        } catch {
          pdf = null;
        }

        pdfs.set(at, pdf);
      }

      const size = pdf === null ? undefined : library.pdfPageSize(pdf, e.page);

      if (size !== undefined) (pageSizes[e.path] ??= Object.create(null))[e.page] = size;
    }
  }

  type Given = {
    read: DrawingRead;
    xrefs: typeof xrefs;
    images?: Record<string, Uint8Array>;
  };

  // The bytes of the images of every drawing, the host's and its xrefs', count against one budget.
  const budget = { total: 0 };
  const diagnostics: BuildDiagnostic[] = [];
  const xrefs: Record<string, Given> = Object.create(null);

  let level: { readonly list: DrawingRead["xrefs"]; readonly from: string }[] = [
    { list: read.xrefs, from: file },
  ];

  let reads = 0;

  for (let depth = 0; depth < 2 && level.length > 0; depth++) {
    const next: typeof level = [];

    for (const { list, from } of level) {
      for (const xref of list) {
        if (Object.hasOwn(xrefs, xref.name) || reads >= XREFS_READ) continue;
        const path = xref.path.replaceAll("\\", "/");
        const name = path.slice(path.lastIndexOf("/") + 1);

        const found = [
          ...(isAbsolute(path) || /^[A-Za-z]:/.test(path) ? [] : [join(dirname(from), path)]),
          join(dirname(from), name),
        ].find((at) => existsSync(at) && statSync(at).isFile());

        if (found === undefined || !/\.(dxf|dwg)$/i.test(found) || found === file) continue;
        track(found, fileVersion(found));
        let xrefReader;

        try {
          xrefReader = readerOf(/\.[^.]*$/.exec(found)![0]);
        } catch {
          continue;
        }

        reads++;
        const got = await cache.read(found, xrefReader, {}, { geometry: true });

        if (!("read" in got)) continue;

        // Its images, from its own folder.
        const rasters = rasterFiles(
          library,
          library.pictureDrawing(got.read).drawing,
          found,
          budget,
          xref.name,
        );

        diagnostics.push(...rasters.diagnostics);
        xrefs[xref.name] = {
          read: got.read,
          xrefs,
          ...(rasters.images !== undefined && { images: rasters.images }),
        };
        next.push({ list: got.read.xrefs, from: found });
      }
    }

    level = next;
  }

  const made = library.pictureDrawing(read, { pageSizes, xrefs });
  const shown = made.drawing;
  const rasters = rasterFiles(library, shown, file, budget);
  diagnostics.push(...rasters.diagnostics);
  const pages = pageFiles(library, shown, file, budget);
  diagnostics.push(...pages.diagnostics);
  const shx = shxFilesOf(library, shown, file);

  const options = {
    drawNoPlot,
    pageSizes,
    xrefs,
    ...(rasters.images !== undefined && { images: rasters.images }),
    ...(pages.underlays !== undefined && { underlays: pages.underlays }),
    ...shx,
  };

  const { notes } = made;

  for (const { style, font, drawnIn } of notes.fonts) {
    diagnostics.push({
      rule: "read-picture",
      severity: "warning",
      message: `The text style ${JSON.stringify(style)} sets its text in ${JSON.stringify(font)}, which tsdraft does not have, so the pictures measure and draw it in ${drawnIn}`,
    });
  }

  for (const [kind, n] of Object.entries(notes.notDrawn)) {
    diagnostics.push({
      rule: "read-picture",
      severity: "warning",
      message: `The pictures draw nothing for ${n} of ${JSON.stringify(kind)}, which the read does not keep or the picture cannot draw`,
    });
  }

  for (const [what, n] of Object.entries(notes.approximate)) {
    diagnostics.push({
      rule: "read-picture",
      severity: "warning",
      message: `The pictures draw ${n} of ${JSON.stringify(what)} only nearly as the file holds it`,
    });
  }

  return { options, shown, diagnostics, fontsOf: fontsIn(library, [shown]) };
}

/** The summary of a read file's drawing, as the picture of its read makes it. */
function readSummary(
  library: Library,
  read: DrawingRead,
  shown: Drawing,
  extents: DrawingSummary["extents"],
  warnings: number,
): DrawingSummary {
  return {
    units: shown.units,
    dxf: shown.dxf,
    standard: null,
    extents,
    counts: {
      layers: read.layers.length,
      entities: read.model.entities?.length ?? 0,
      blocks: read.blocks.length,
      xrefs: read.xrefs.length,
      layouts: read.layouts.length,
      errors: 0,
      warnings,
    },
    layers: layerSummaries(shown),
    blocks: [],
    inserts: [],
    dimensions: [],
    xrefs: [],
    layouts: layoutSummaries(library, shown),
  };
}

/** The names of a read's layouts that have a picture: a layout the read did not read is not empty. */
function pictured(read: DrawingRead): string[] {
  const names = new Set<string>();

  for (const layout of read.layouts) if (layout.entities !== undefined) names.add(layout.name);

  return [...names];
}

/** A build that failed to read or draw a read file. */
function readFailed(
  file: string,
  timings: WorkerResult["timings"],
  message: string,
  name = "ReadError",
): WorkerResult {
  return {
    ok: false,
    files: readFiles(file),
    timings,
    drawing: null,
    diagnostics: [],
    svg: null,
    fonts: [],
    layouts: [],
    view: null,
    swatches: {},
    error: { name, message, code: null, file, line: null, column: null, stack: "" },
    library: null,
    modules,
  };
}

/**
 * The pictures of a drawing file a reader reads: model space and each layout, drawn from the read
 * with geometry by `readPicture`, with what it could not draw as warnings.
 */
async function buildRead({
  file,
  drawNoPlot,
  view,
  reader: named,
  cwd,
}: BuildRequest): Promise<WorkerResult> {
  const timings: Timings = {};
  const failed = (message: string, name?: string) => readFailed(file, timings, message, name);
  let t = now();
  track(file, fileVersion(file));
  // SAFETY: the command's own copy of tsdraft has each function Library names.
  const library = (await import("tsdraft")) as CoreLibrary;
  const readers = await readersOf(file, named, cwd);
  let reader;

  try {
    reader = readers.readerOf(/\.[^.]*$/.exec(file)![0]);
  } catch (error) {
    if (error instanceof readers.ReaderRefusal) return failed(error.message);
    throw error;
  }

  const outcome = await readers.cache.read(file, reader, {}, { geometry: true });
  timings.load = now() - t;

  if ("skipped" in outcome) return failed(`${file} was not read: ${outcome.skipped}`);
  const read = outcome.read;
  t = now();

  try {
    const { options, shown, diagnostics, fontsOf } = await readContext(
      library,
      readers,
      file,
      read,
      drawNoPlot === true,
    );

    let viewed: WorkerResult["view"] = null;
    let svg: string | null = null;
    let min: [number, number] = [0, 0];
    let max: [number, number] = [0, 0];
    const sheets: { name: string; svg: string; fonts: string[] }[] = [];

    if (view) {
      const one = library.readPicture(read, {
        ...options,
        view: view.box,
        ...(view.layout !== undefined && { layout: view.layout }),
      }).svg;

      viewed = { layout: view.layout ?? null, svg: one, fonts: fontsOf(one) };
    } else {
      ({ svg, min, max } = framed(library.readPicture(read, { ...options, margin: 0 }).svg));

      for (const name of pictured(read)) {
        const sheet = library.readPicture(read, { ...options, layout: name }).svg;
        sheets.push({ name, svg: sheet, fonts: fontsOf(sheet) });
      }
    }

    timings.svg = now() - t;

    return {
      ok: true,
      files: readFiles(file),
      timings,
      drawing: readSummary(library, read, shown, { min, max }, diagnostics.length),
      diagnostics,
      svg,
      fonts: svg === null ? [] : fontsOf(svg),
      layouts: sheets,
      view: viewed,
      swatches: {},
      error: null,
      library: null,
      modules,
    };
  } catch (thrown) {
    return failed(
      `${file} was read, and its pictures could not be drawn: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
      "PictureError",
    );
  }
}

async function buildCode(request: BuildRequest): Promise<WorkerResult> {
  const { file, root, drawNoPlot, view } = request;
  const timings: Timings = {};

  const fail = (error: BuildError, cause?: unknown): WorkerResult => ({
    ok: false,
    files: [...readFiles(file), ...missingFile(cause)],
    timings,
    drawing: null,
    diagnostics: drawingErrorDiagnostics(cause),
    svg: null,
    fonts: [],
    layouts: [],
    view: null,
    swatches: {},
    error,
    library: null,
    modules,
  });

  let t = now();
  let drawing: Drawing;
  let referenced: GivenXrefs;
  let intent: unknown;
  let standard: unknown;

  try {
    const module: DrawingModule = await import(pathToFileURL(file).href);
    let value = module.default;

    if (isEditFile(value)) return await buildEdit(request, value, t);

    if (isFunction(value)) value = await value();

    if (!("default" in module)) {
      return fail(
        atExport(file, "The file has no default export. End it with `export default d.build()`"),
      );
    }

    const given = drawingOf(value);

    if (isString(given)) return fail(atExport(file, given));
    const problem = notXrefs(module);

    if (problem !== undefined) return fail(atExport(file, problem));
    drawing = given;
    // SAFETY: notXrefs found the export absent, or an object that gives a Drawing, or
    // `{ drawing, xrefs }` with the same of that drawing's own xrefs, for each name.
    referenced = (module.xrefs ?? {}) as GivenXrefs;
    intent = module.intent;
    standard = module.standard;
  } catch (thrown) {
    timings.load = now() - t;

    return fail(describe(thrown, root), thrown);
  }

  timings.load = now() - t;

  try {
    const { library, entry } = await findLibrary(file);
    t = now();
    // A copy of tsdraft from before standards would take the export and check nothing of it.
    const checked = standard !== undefined && isFunction(library.defineStandard);
    // A copy that draws attachments says why a drawing the export gives is not drawn.
    // The export with one name for each xref, the first, which the pictures and lint both take.
    const exported = exportedXrefs(library, drawing, referenced);
    // A copy that draws attachments says why a drawing the export gives is not drawn.
    const chains: LintOptions = isFunction(library.drawnXrefs) ? { xrefs: exported } : {};
    // The shape files the linetypes name, read from the drawing file's folder, which lint and the
    // pictures both take.
    const shxGiven = shxFilesOf(library, drawing, file);

    const found = library.lint(
      drawing,
      checked ? { standard, ...chains, ...shxGiven } : { ...chains, ...shxGiven },
    );

    const unchecked: BuildDiagnostic[] =
      standard !== undefined && !checked
        ? [
            {
              rule: "standard-unchecked",
              severity: "warning",
              message:
                "The copy of tsdraft this drawing imports is from before standards and has no defineStandard, so the drawing was not checked against the export `standard`. Update it",
            },
          ]
        : [];

    // lint's check of a standard refuses a getter anywhere in it, so a preview is taken only
    // from a standard it checked and accepted.
    const refused = found.some((d) => d.rule === "standard" && d.severity === "error");
    const previews = checked && !refused ? titleBlockPreviews(standard) : [];

    const size = (list: readonly unknown[] | undefined): number =>
      Array.isArray(list) ? list.length : 0;

    const errorsFirst = (a: Diagnostic, b: Diagnostic) =>
      Number(a.severity === "warning") - Number(b.severity === "warning");

    /** The build's answer, with `shown` drawn in place of the drawing when items are left out. */
    const report = (shown: Drawing, omitted: readonly string[]): WorkerResult => {
      const given = givenDrawings(library, shown, exported, previews);
      const drawn = drawnOf(given);

      const linted = [...found, ...givenErrors(given, [])]
        .sort(errorsFirst)
        .map((d) => aboutEntity(library, shown, drawn, d));

      timings.lint ??= now() - t;
      t = now();

      const diagnostics = [
        ...linted,
        ...unchecked,
        ...textWarnings(library, shown, drawn, drawNoPlot === true),
      ];

      timings.inspect = now() - t;

      if (intent !== undefined) {
        t = now();
        // SAFETY: checkIntent checks the export as it checks a caller's in plain JavaScript, and
        // intentWarnings catches what it throws.
        diagnostics.push(...intentWarnings(library, shown, intent as Intent));
        timings.intent = now() - t;
      }

      t = now();
      // The files of the drawing's images, read once from the drawing file's folder, and of each
      // xref's from the folder of its file.
      const budget = { total: 0 };
      const rasters = rasterFiles(library, shown, file, budget);
      diagnostics.push(...rasters.diagnostics);
      const pages = pageFiles(library, shown, file, budget);
      diagnostics.push(...pages.diagnostics);

      const images: PictureFiles = {};

      if (rasters.images !== undefined) images.images = rasters.images;

      if (pages.underlays !== undefined) images.underlays = pages.underlays;

      const pictured =
        rasters.images === undefined
          ? drawn
          : drawnOf(given, dirname(file), (referenced, at, xref) => {
              const read = rasterFiles(library, referenced, at, budget, xref);
              diagnostics.push(...read.diagnostics);

              return read.images;
            });

      const fontsOf = fontsIn(library, [shown, ...drawingsOf(given)]);

      const { svg, min, max } = framed(
        library.toSVG(shown, {
          margin: 0,
          drawNoPlot: drawNoPlot === true,
          xrefs: pictured,
          ...images,
          ...shxGiven,
        }),
      );

      // Each layout's sheet. A copy of tsdraft from before layouts would draw model space for
      // each, so it draws none. Two layouts of one name are one picture, the first's.
      const drawnNames = new Set<string>();

      const sheets =
        library.viewportView === undefined || view
          ? []
          : (shown.layouts ?? []).flatMap((layout) => {
              if (drawnNames.has(layout.name)) return [];
              drawnNames.add(layout.name);

              const options = {
                layout: layout.name,
                drawNoPlot: drawNoPlot === true,
                xrefs: pictured,
                ...images,
                ...shxGiven,
              };

              const sheet = library.toSVG(shown, options);

              return [{ name: layout.name, svg: sheet, fonts: fontsOf(sheet) }];
            });

      // The one rectangle asked for, drawn with no margin around it.
      let viewed: WorkerResult["view"] = null;

      if (view) {
        if (library.inspectText === undefined) {
          throw new Error(
            "The copy of tsdraft this drawing imports is older than --view and draws no view. Update it",
          );
        }

        const asked: PictureOptions = { view: view.box };

        if (view.layout !== undefined) asked.layout = view.layout;

        const one = library.toSVG(shown, {
          ...asked,
          drawNoPlot: drawNoPlot === true,
          xrefs: pictured,
          ...images,
          ...shxGiven,
        });

        viewed = { layout: view.layout ?? null, svg: one, fonts: fontsOf(one) };
      }

      timings.svg = now() - t;
      const errors = diagnostics.filter((d) => d.severity === "error").length;

      const files = readFiles(file);

      const counted = {
        units: drawing.units,
        dxf: drawing.dxf,
        standard: standardSummary(standard, checked),
        extents: { min, max },
        counts: {
          layers: size(drawing.layers),
          entities: size(drawing.entities),
          blocks: size(drawing.blocks),
          xrefs: size(drawing.xrefs),
          layouts: size(drawing.layouts),
          errors,
          warnings: diagnostics.length - errors,
        },
      };

      const listed = {
        layers: layerSummaries(shown),
        blocks: blockSummaries(library, shown),
        inserts: insertSummaries(library, shown),
        dimensions: dimensionSummaries(library, shown),
        xrefs: xrefSummaries(library, shown, given),
        layouts: layoutSummaries(library, shown),
      };

      return {
        ok: true,
        files,
        timings,
        drawing:
          omitted.length > 0 ? { ...counted, omitted, ...listed } : { ...counted, ...listed },
        diagnostics,
        svg,
        fonts: fontsOf(svg),
        layouts: sheets,
        view: viewed,
        swatches: swatches(library, shown),
        error: null,
        library: entry,
        modules,
      };
    };

    try {
      return report(drawing, []);
    } catch (thrown) {
      // `toSVG` cannot get past something in the drawing. When `lint` has said what, the rest
      // is drawn without it. Failing that, the build fails and `lint`'s report is kept.
      const items = new Set(
        found.flatMap((d) => (d.severity === "error" && d.item ? [d.item] : [])),
      );

      if (!found.some((d) => d.severity === "error")) throw thrown;

      try {
        if (items.size === 0) throw thrown;

        return report(without(drawing, items), [...items].sort());
      } catch {
        const diagnostics = [...[...found].sort(errorsFirst).map(withPath), ...unchecked];

        return { ...fail(describe(thrown, root)), diagnostics, linted: true };
      }
    }
  } catch (thrown) {
    // The drawing is malformed in a way `lint` cannot get past.
    return fail(describe(thrown, root), thrown);
  }
}

/** An edit file's default export, as `editDrawing` makes it. Matched by shape: tsdraft may be another copy. */
function isEditFile(value: unknown): value is EditFile {
  if (!isObject(value) || !("build" in value) || !isFunction(value.build)) return false;
  const source = "source" in value ? value.source : undefined;

  return (
    isObject(source) &&
    "file" in source &&
    isString(source.file) &&
    "sha256" in source &&
    isString(source.sha256)
  );
}

/**
 * The build of an edit file: its source found beside it and its edit built, with the read of the
 * source when the edit file asks for it. The pictures are drawn by the process that keeps the
 * reads, from the edit as data, so this answers with the edit and no picture.
 */
async function buildEdit(
  { file, root, reader: named, cwd }: BuildRequest,
  editFile: EditFile,
  started: number,
): Promise<WorkerResult> {
  const timings: Timings = {};

  const failed = (error: BuildError): WorkerResult => ({
    ...readFailed(file, timings, error.message, error.name),
    error,
  });

  const source = resolve(dirname(file), editFile.source.file);
  track(source, fileVersion(source));

  if (!READ_FILE.test(source))
    return failed(
      atExport(file, `The edit names ${editFile.source.file}, which is not a DXF or a DWG`),
    );
  const readers = await readersOf(source, named, cwd);
  let reader;

  try {
    reader = readers.readerOf(extname(source));
  } catch (error) {
    if (error instanceof readers.ReaderRefusal) return failed(atExport(file, error.message));
    throw error;
  }

  const only = editFile.source.only;

  const kept = await readers.cache.keep(
    source,
    reader,
    {},
    { geometry: true, ...(only !== undefined && { only }) },
  );

  if ("skipped" in kept) return failed(atExport(file, `${source} was not read: ${kept.skipped}`));
  let edit: Edit;

  try {
    edit = editFile.build(() => kept.read());
  } catch (thrown) {
    timings.load = now() - started;

    return failed(describe(thrown, root));
  }

  timings.load = now() - started;
  const { library, entry } = await findLibrary(file);

  const calls = edit.statements.map((_, i): CallSite | null => {
    const call = library.statementCall?.(edit, i);

    return call === undefined ? null : { ...call, file: toPath(call.file) };
  });

  return {
    ...readFailed(file, timings, ""),
    ok: true,
    error: null,
    library: entry,
    // SAFETY: an Edit is plain data, so its copy through JSON is the same Edit.
    plan: { source, edit: JSON.parse(JSON.stringify(edit)) as Edit, calls },
  };
}

/** What the process that keeps the reads holds of the last source it drew, for the next edit. */
interface KeptPreview {
  readonly read: DrawingRead;
  readonly drawNoPlot: boolean;
  readonly context: ReadContext;
  /** The picture of model space before the edit, and of each layout, by its name. */
  readonly model: ReturnType<CoreLibrary["readPicture"]>;
  readonly layouts: ReadonlyMap<string, ReturnType<CoreLibrary["readPicture"]>>;
  /**
   * The fonts of each picture before the edit, model space's by `""`. An edit erases and moves,
   * so the pictures after it draw text in no other.
   */
  readonly fonts: ReadonlyMap<string, string[]>;
  /** Each file the context read, with its version: one changed since makes it again. */
  readonly files: readonly FileVersion[];
}

let keptPreview: KeptPreview | undefined;

/** What draws the pictures of changes of the last preview, by its id, when asked for later. */
let lastChanges: { readonly id: number; readonly draw: () => WorkerResult["changes"] } | undefined;

/**
 * The pictures of an edit: the source's read from the cache, its pictures before the edit kept
 * as fragments, and those after it joined from them by `editedPicture`, leaving out what the edit
 * erases and drawing again only what it moves; with the pictures of what it changes, `lintEdit`'s
 * diagnostics and where each statement is.
 */
async function preview({
  id,
  plan,
  drawNoPlot = false,
  view,
  changes: changesNow = true,
  reader: named,
  cwd,
}: PreviewRequest): Promise<WorkerResult> {
  const { source, edit, calls } = plan;
  const timings: Timings = {};
  const files: FileVersion[] = [];
  collecting = files;

  try {
    let t = now();
    track(source, fileVersion(source));
    // SAFETY: the command's own copy of tsdraft has each function Library names.
    const library = (await import("tsdraft")) as CoreLibrary;
    const readers = await readersOf(source, named, cwd);
    let reader;

    try {
      reader = readers.readerOf(extname(source));
    } catch (error) {
      if (error instanceof readers.ReaderRefusal)
        return { ...readFailed(source, timings, error.message), files };
      throw error;
    }

    const got = await readers.cache.read(
      source,
      reader,
      {},
      { geometry: true, ...(edit.only !== undefined && { only: edit.only }) },
    );

    if ("skipped" in got)
      return {
        ...readFailed(source, timings, `${source} was not read: ${got.skipped}`),
        files,
      };
    const read = got.read;
    let kept = keptPreview;

    const current =
      kept !== undefined &&
      kept.read === read &&
      kept.drawNoPlot === drawNoPlot &&
      kept.files.every(([path, version]) => fileVersion(path) === version);

    if (!current) {
      keptPreview = undefined;
      const own: FileVersion[] = [];
      collecting = own;
      const context = await readContext(library, readers, source, read, drawNoPlot);
      const model = library.readPicture(read, { ...context.options, margin: 0 });

      const layouts = new Map(
        pictured(read).map((name) => [
          name,
          library.readPicture(read, { ...context.options, layout: name }),
        ]),
      );

      collecting = files;
      files.push(...own);
      const fonts = new Map([["", context.fontsOf(model.svg)]]);

      for (const [name, picture] of layouts) fonts.set(name, context.fontsOf(picture.svg));
      kept = keptPreview = { read, drawNoPlot, context, model, layouts, fonts, files: own };
    } else files.push(...kept!.files);
    const { context, model, layouts, fonts } = kept!;
    const { options } = context;
    timings.load = now() - t;

    t = now();
    const applied = read.sha256 === edit.sha256;
    const lintDiagnostics = library.lintEdit(edit, read);

    const placeOf = (handle: string) =>
      library.statementPlace(read, { kind: "erase", handles: [handle] });

    const diagnostics: BuildDiagnostic[] = [
      ...lintDiagnostics
        .map((d): BuildDiagnostic => {
          const call = d.statement === undefined ? undefined : calls[d.statement];
          const place = d.handle === undefined ? undefined : placeOf(d.handle);
          const sheet = place?.layouts[0];
          const box = place?.model ?? sheet?.box;

          return {
            rule: d.rule,
            severity: d.severity,
            message:
              d.rule === "edit-hash"
                ? `${d.message}: the file changed after the edit was planned, so the pictures draw it as it is, without the edit`
                : d.message,
            ...(d.statement !== undefined && { statement: d.statement }),
            ...(d.handle !== undefined && { handle: d.handle }),
            ...(call && { call }),
            ...(box && { bounds: { min: [box[0], box[1]], max: [box[2], box[3]] } }),
            ...(place?.model === undefined && sheet && { layout: sheet.layout }),
          };
        })
        .sort(errorsBefore),
      ...context.diagnostics,
    ];

    timings.lint = now() - t;

    t = now();

    const shown = applied
      ? library.editPreview(read, edit)
      : {
          edited: read,
          erased: new Set<string>(),
          moved: new Set<string>(),
          drawn: read,
          blocks: new Set<string>(),
          redrawn: new Set<string>(),
          whole: false,
        };

    const after = shown.edited;
    const changed = after !== read;
    const { fontsOf } = context;
    const change = { erased: shown.erased, changed: shown.moved };
    const marks = { erased: shown.erased, moved: shown.moved, read };
    let svg: string | null = null;
    let min: [number, number] = [0, 0];
    let max: [number, number] = [0, 0];
    let viewed: WorkerResult["view"] = null;
    const sheets: { name: string; svg: string; fonts: string[] }[] = [];

    /** What draws the pictures of changes, from the pictures before the edit and of what it moves. */
    type Picture = typeof model;

    const toDraw: { name: string | null; before: Picture; drawn: Picture | undefined }[] = [];

    if (view) {
      const one = library.readPicture(after, {
        ...options,
        view: view.box,
        ...(view.layout !== undefined && { layout: view.layout }),
      }).svg;

      viewed = { layout: view.layout ?? null, svg: one, fonts: fontsOf(one) };
    } else {
      const drawnModel =
        changed && !shown.whole
          ? library.readPicture(shown.drawn, { ...options, margin: 0 })
          : undefined;

      const modelSvg = !changed
        ? model.svg
        : shown.whole
          ? library.readPicture(after, { ...options, margin: 0 }).svg
          : library.editedPicture(model, { ...change, drawn: drawnModel! });

      ({ svg, min, max } = framed(modelSvg));
      toDraw.push({ name: null, before: model, drawn: drawnModel });

      for (const [name, before] of layouts) {
        const again = shown.whole || shown.redrawn.has(name);

        const drawn =
          changed && !again
            ? library.readPicture(shown.drawn, { ...options, layout: name })
            : undefined;

        const sheet = !changed
          ? before.svg
          : again
            ? library.readPicture(after, { ...options, layout: name }).svg
            : library.editedPicture(before, { ...change, drawn: drawn! });

        sheets.push({ name, svg: sheet, fonts: fonts.get(name) ?? fontsOf(sheet) });
        toDraw.push({ name, before, drawn });
      }
    }

    const drawChanges = (): NonNullable<WorkerResult["changes"]> => {
      const pictures = toDraw.map(({ name, before, drawn }) => ({
        name,
        svg: library.changesPicture(before, { ...marks, ...(drawn && { drawn }) }),
      }));

      const own = pictures.find((p) => p.name === null);

      return {
        svg: own === undefined ? null : framed(own.svg).svg,
        layouts: pictures.flatMap((p) => (p.name === null ? [] : [{ name: p.name, svg: p.svg }])),
      };
    };

    lastChanges = view ? undefined : { id, draw: drawChanges };
    const changes = view ? undefined : changesNow ? drawChanges() : undefined;
    timings.svg = now() - t;

    const statements = edit.statements.map((statement, i) => {
      const place = library.statementPlace(read, statement);
      const box = place.model;

      return {
        kind: statement.kind,
        call: calls[i] ?? null,
        handles:
          statement.kind === "erase" || statement.kind === "move" ? [...statement.handles] : [],
        box: box === undefined ? null : { min: [box[0], box[1]], max: [box[2], box[3]] },
        layouts: place.layouts.map(({ layout, box: [x0, y0, x1, y1] }) => ({
          name: layout,
          box: { min: [x0, y0], max: [x1, y1] },
        })),
      } satisfies EditSummary["statements"][number];
    });

    const errors = diagnostics.filter((d) => d.severity === "error").length;
    const summary = readSummary(library, after, context.shown, { min, max }, 0);

    return {
      ok: true,
      files,
      timings,
      drawing: {
        ...summary,
        counts: { ...summary.counts, errors, warnings: diagnostics.length - errors },
      },
      diagnostics,
      svg,
      fonts: svg === null ? [] : (fonts.get("") ?? []),
      layouts: sheets,
      view: viewed,
      swatches: {},
      error: null,
      library: null,
      modules,
      edit: {
        source,
        name: edit.name,
        sha256: edit.sha256,
        read: read.sha256,
        applied,
        erased: shown.erased.size,
        moved: shown.moved.size,
        statements,
      },
      ...(changes && { changes }),
      ...(!view && !changesNow && { changesLater: id }),
    };
  } finally {
    collecting = undefined;
  }
}

/** Errors before warnings, each in the order found. */
const errorsBefore = (a: { severity: string }, b: { severity: string }) =>
  Number(a.severity === "warning") - Number(b.severity === "warning");

/** Adds the kind, layer and box of the entity a diagnostic is about. */
function aboutEntity(
  library: Library,
  drawing: Drawing,
  referenced: GivenXrefs,
  found: Diagnostic,
): BuildDiagnostic {
  const d = withPath(found);

  const layout =
    d.layout === undefined ? undefined : drawing.layouts?.find((l) => l.name === d.layout);

  if (d.viewport !== undefined) {
    // A viewport's box is its rectangle on the sheet.
    const rectangle = layout && viewportBox(library, drawing, layout, d.viewport)?.rectangle;

    return rectangle ? { ...d, bounds: rectangle } : d;
  }

  // An entity of a block is counted in its block, and its box is in the block's coordinates.
  // One of a layout is counted on its layout, and its box is on the sheet.
  const entities =
    d.block !== undefined
      ? (drawing.blocks?.find((b) => b.name === d.block)?.entities ?? [])
      : d.layout !== undefined
        ? (layout?.entities ?? [])
        : drawing.entities;

  const entity = d.entity === undefined ? undefined : entities[d.entity];

  if (!entity || entity === LEFT_OUT) return d;
  // toSVG works out the box, so it agrees with the drawing's extents and the picture. An entity
  // on a layer that is off, frozen or not plotted still has a box.
  const one = { ...drawing, layers: shownLayers(drawing), entities: [entity] };
  const { min, max } = framed(library.toSVG(one, { margin: 0, xrefs: referenced }));
  const bounds: Box = { min, max };

  return { ...d, kind: entity.kind, layer: entity.layer, bounds };
}

/**
 * What `inspectText` warns of in the drawing's text as it plots, each with the kind of the
 * entity that draws the text. A warning brings its own box. It is never the reason a build
 * fails: a drawing made by hand that it cannot read has no such warnings.
 */
function textWarnings(
  library: Library,
  drawing: Drawing,
  referenced: GivenXrefs,
  drawNoPlot: boolean,
): BuildDiagnostic[] {
  try {
    const found = library.inspectText?.(drawing, { drawNoPlot, xrefs: referenced }) ?? [];

    return found.map((warning) => {
      const entities =
        warning.layout === undefined
          ? drawing.entities
          : drawing.layouts?.find((l) => l.name === warning.layout)?.entities;

      const kind = warning.entity === undefined ? undefined : entities?.[warning.entity]?.kind;

      return withPath(kind === undefined ? warning : { ...warning, kind });
    });
  } catch {
    return [];
  }
}

/**
 * What `checkIntent` warns of where the drawing does not hold to the file's export `intent`,
 * each with the kind of the entity it names. A warning brings its own box. It is never the
 * reason a build fails. A copy of tsdraft from before `checkIntent`, or a throw from it, gives
 * one warning that the intent was not checked.
 */
function intentWarnings(library: Library, drawing: Drawing, intent: Intent): BuildDiagnostic[] {
  if (library.checkIntent === undefined) {
    return [
      {
        rule: "intent-unchecked",
        severity: "warning",
        message:
          "The copy of tsdraft this drawing imports has no checkIntent, so the export `intent` was not checked. Update it",
      },
    ];
  }

  try {
    return library.checkIntent(drawing, intent).map((warning) => {
      const kind =
        warning.entity === undefined ? undefined : drawing.entities?.[warning.entity]?.kind;

      return withPath(kind === undefined ? warning : { ...warning, kind });
    });
  } catch (thrown) {
    const reason = thrown instanceof Error ? thrown.message : String(thrown);

    return [
      {
        rule: "intent-unchecked",
        severity: "warning",
        message: `checkIntent stopped with an error, so the export \`intent\` was not checked: ${reason}`,
      },
    ];
  }
}

/** Gives the file of a diagnostic's `call` as a path, as `error.file` is: Node's stack has a URL. */
function withPath<D extends Pick<Diagnostic, "call">>(d: D): D {
  return d.call ? { ...d, call: { ...d.call, file: toPath(d.call.file) } } : d;
}

/**
 * The diagnostics of a `DrawingError`, as `toDXF` and the builder throw. Matched by shape:
 * tsdraft may be another copy.
 */
function drawingErrorDiagnostics(cause: unknown): Diagnostic[] {
  const thrown: ThrownFields | undefined = isObject(cause) ? cause : undefined;
  const diagnostics = thrown?.diagnostics;

  return cause instanceof Error && cause.name === "DrawingError" && Array.isArray(diagnostics)
    ? diagnostics.map(withPath)
    : [];
}

/** The file an import named that does not exist, so its creation can be watched. */
function missingFile(cause: unknown): FileVersion[] {
  if (!(cause instanceof Error)) return [];
  const thrown: ThrownFields = cause;

  if (thrown.code !== "ERR_MODULE_NOT_FOUND") return [];
  const { url } = thrown;
  const named = /^Cannot find module '([^']+)'/.exec(cause.message)?.[1];

  const path =
    isString(url) && url.startsWith("file:") ? fileURLToPath(url) : named && toPath(named);

  return path && isAbsolute(path) && tracked(path) ? [[path, null]] : [];
}

/**
 * Says what is wrong with an `xrefs` export, or returns undefined: it is an object that gives
 * a drawing for each xref the pictures are to draw, by the xref's name, as a Drawing or as
 * `{ drawing, xrefs }` with the drawings that drawing's own xrefs stand for.
 */
function notXrefs(module: DrawingModule): string | undefined {
  if (module.xrefs === undefined) return undefined;

  const expected =
    "The export `xrefs` must be an object that gives a Drawing, or { drawing, xrefs } with the drawings of that drawing's own xrefs, for an xref's name, such as `export const xrefs = { BASE: base }`";

  // Each object given is checked once, so a circle of them ends.
  const seen = new Set<object>();
  const open: [xrefs: unknown, at: string][] = [[module.xrefs, ""]];

  for (let next = open.pop(); next !== undefined; next = open.pop()) {
    const [xrefs, at] = next;

    if (!isObject(xrefs) || Array.isArray(xrefs)) {
      return at === "" ? expected : `${expected}. Its ${at} is not an object`;
    }

    if (seen.has(xrefs)) continue;
    seen.add(xrefs);

    for (const [name, given] of Object.entries(xrefs)) {
      const here = `${at}${at === "" ? "" : " > "}${JSON.stringify(name)}`;
      const nested: unknown = given;
      const pair: XrefFields | undefined = isPair(nested) ? nested : undefined;
      const drawing = pair === undefined ? nested : pair.drawing;
      const inner = pair?.xrefs;

      if (isString(drawingOf(drawing))) return `${expected}. Its ${here} is not a Drawing`;

      if (inner !== undefined) open.push([inner, `xrefs of ${here}`]);
    }
  }

  return undefined;
}

/** Whether a value of the `xrefs` export is `{ drawing, xrefs }` rather than a drawing. */
function isPair(value: unknown): value is XrefFields {
  return isObject(value) && "drawing" in value;
}

/** The drawing a value of the `xrefs` export gives, and what it gives for that drawing's xrefs. */
function givenOf(value: GivenXref): {
  readonly drawing: Drawing;
  readonly xrefs: GivenXrefs | undefined;
} {
  // An export made by hand may give a value that is no object, which holds no `drawing`.
  return isObject(value) && "drawing" in value
    ? { drawing: value.drawing, xrefs: value.xrefs }
    : { drawing: value, xrefs: undefined };
}

/** Whether a value is a Drawing as far as the worker reads one first: its two lists and units. */
function isDrawing(value: unknown): value is Drawing {
  if (!isObject(value)) return false;
  const fields: DrawingFields = value;

  return Array.isArray(fields.layers) && Array.isArray(fields.entities) && isString(fields.units);
}

/** A value given as a drawing, when it is a Drawing, or else what is wrong with it. */
function drawingOf(value: unknown): Drawing | string {
  if (isDrawing(value)) return value;

  return isBuilder(value)
    ? "The default export is the builder, not the drawing. Export `d.build()` instead"
    : "The default export must be a Drawing, or a function that returns one";
}

/** Whether a default export is the builder, exported in place of what it builds. */
function isBuilder(value: unknown): value is { readonly build: () => Drawing } {
  if (!isObject(value)) return false;
  const fields: DrawingFields = value;

  return isFunction(fields.build);
}

/**
 * The copy of tsdraft that checks and draws the drawing. The drawing file's own import decides,
 * since that is the version its project chose. In order:
 *
 * 1. what the drawing file itself imports that is the library by its package: the entry of a
 *    package named `tsdraft`, reached by name, as source, or through an alias;
 * 2. with none of those, what the file itself imports that exports all of `createDrawing`,
 *    `lint`, `toSVG` and `toDXF`: a copy kept under another name, or a kit that passes the
 *    library on. Two of the names would not do, since a helper of the user's may export them;
 * 3. the one copy the build loaded, when the file imports none itself and a helper did;
 * 4. the copy the file would get by importing `tsdraft` by name, which is its project's. This
 *    settles a build that loaded several copies, and one that loaded none;
 * 5. the first copy the build loaded, when it loaded several and the project has none;
 * 6. the library this command was installed with.
 */
async function findLibrary(file: string): Promise<{ library: Library; entry: string | null }> {
  const isLibrary = (path: string) =>
    /[\\/]index\.[jt]s$/.test(path) && packageName(path) === "tsdraft";

  const load = async (path: string): Promise<object> => await import(pathToFileURL(path).href);

  const found = (library: Library, path: string) => ({
    library,
    entry: ownEntries.includes(path) ? path : null,
  });

  const own = imported.get(file) ?? [];

  for (const path of own.filter(isLibrary)) {
    const library = await load(path);

    if (exportsFunctions(library, "lint", "toSVG")) return found(library, path);
  }

  for (const path of own.filter((path) => /\.m?[jt]s$/.test(path))) {
    const library = await load(path);

    if (exportsFunctions(library, "createDrawing", "lint", "toSVG", "toDXF")) {
      return found(library, path);
    }
  }

  const all = [...loaded].flatMap((url) => {
    const path = fileURLToPath(url);

    return isLibrary(path) ? [path] : [];
  });

  const named: string[] = [];

  try {
    named.push(createRequire(file).resolve("tsdraft"));
  } catch {
    // The drawing's folder has no tsdraft of its own.
  }

  for (const path of [...(all.length === 1 ? all : []), ...named, ...all]) {
    const library = await load(path);

    if (exportsFunctions(library, "lint", "toSVG")) return found(library, path);
  }

  // SAFETY: the command's own copy of tsdraft has each function Library names, and the worker
  // gives it only what it takes, as it does any copy.
  const installed = (await import("tsdraft")) as Library;

  return found(installed, fileURLToPath(import.meta.resolve("tsdraft")));
}

/**
 * Whether a module exports a function by each name, as a copy of tsdraft does. The rest of
 * `Library` is each optional, and each use checks it.
 */
function exportsFunctions(module: unknown, ...names: string[]): module is Library {
  return (
    isObject(module) &&
    names.every((name) => isFunction(Object.getOwnPropertyDescriptor(module, name)?.value))
  );
}

const packageNames = new Map<string, string | undefined>();

/** The name in the nearest package.json above a file. */
function packageName(path: string): string | undefined {
  const dir = dirname(path);

  if (packageNames.has(dir)) return packageNames.get(dir);
  let name: string | undefined;

  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));

    // A package.json of `null` has no name to read, as one that cannot be read.
    if (parsed === null) throw new TypeError("The package.json is null");
    name = isObject(parsed) && "name" in parsed && isString(parsed.name) ? parsed.name : undefined;
  } catch {
    name = dir === dirname(dir) ? undefined : packageName(dir);
  }

  packageNames.set(dir, name);

  return name;
}

/** An SVG with the margin `toSVG` gives by default, and the extents of what it draws. */
interface Framed {
  readonly svg: string;
  readonly min: [number, number];
  readonly max: [number, number];
}

/**
 * Reads the extents from an SVG drawn with no margin, then gives it the margin `toSVG` uses by
 * default, 2% of the larger side, so one render serves both.
 */
function framed(svg: string): Framed {
  const box = /viewBox="([^"]+)"/.exec(svg);
  const [x = 0, y = 0, w = 1, h = 1] = (box?.[1] ?? "").split(" ").map(Number);
  const m = Math.max(w, h, 1) * 0.02;
  const round = (n: number) => Number(n.toFixed(6));
  const viewBox = [x - m, y - m, w + m * 2, h + m * 2].map(round).join(" ");

  return {
    svg: svg.replace(/viewBox="[^"]+"/, `viewBox="${viewBox}"`),
    // The SVG flips Y, so its top edge is the drawing's highest point.
    min: [round(x), round(-y - h)],
    max: [round(x + w), round(-y)],
  };
}

/** The rectangle of a viewport on its sheet and the box of model space it shows. */
function viewportBox(
  library: Library,
  drawing: Drawing,
  layout: Layout,
  index: number,
): { rectangle: Box; shows: Box } | undefined {
  const paper = library.PAPERS?.[layout.paper];
  const viewport = layout.viewports[index];

  if (!paper || !viewport || !library.viewportView) return undefined;

  try {
    const view = library.viewportView(viewport, paper.units, drawing.units);
    const [x, y] = view.paperCenter;

    return {
      rectangle: {
        min: [x - view.width / 2, y - view.height / 2],
        max: [x + view.width / 2, y + view.height / 2],
      },
      shows: { min: [view.box[0], view.box[1]], max: [view.box[2], view.box[3]] },
    };
  } catch {
    // The viewport breaks a rule, which the diagnostics say.
    return undefined;
  }
}

/**
 * Gives, for a picture, the fonts of the drawings that its text is set in: each font of a text
 * style, or of the `Standard` style, whose font family the picture has.
 */
function fontsIn(library: Library, drawings: readonly Drawing[]): (svg: string) => string[] {
  const fonts = new Set(["txt.shx"]);

  for (const drawing of drawings) {
    for (const style of Array.isArray(drawing.textStyles) ? drawing.textStyles : []) {
      if (isString(style?.font)) fonts.add(style.font);
    }
  }

  const families = [...fonts].flatMap((font) => {
    const family = library.FONTS?.[font]?.family;

    return family === undefined ? [] : [[font, family] as const];
  });

  return (svg) => {
    const drawn = new Set<string>();

    for (const [, family] of svg.matchAll(/ font-family="([^"]*)"/g)) {
      drawn.add(family!.replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
    }

    return families.flatMap(([font, family]) => (drawn.has(family) ? [font] : [])).sort();
  };
}

/** Each layout whose paper tsdraft knows, with each of its viewports that can be worked out. */
function layoutSummaries(library: Library, drawing: Drawing): LayoutSummary[] {
  return (drawing.layouts ?? []).flatMap((layout) => {
    const paper = library.PAPERS?.[layout.paper];

    if (!paper || !Array.isArray(layout.viewports) || !Array.isArray(layout.entities)) return [];
    // toSVG finds a viewport's layer as CAD does, whatever the case of its name, and draws
    // the border when that layer plots. So the sheet is drawn once more with nothing on it but
    // its viewports, and each border it has is one that plots.
    let borders = "";

    try {
      const bare = { ...drawing, entities: [], layouts: [{ ...layout, entities: [] }] };
      borders = library.toSVG(bare, { layout: layout.name });
    } catch {
      // A viewport breaks a rule, which the diagnostics say.
    }

    return [
      {
        name: layout.name,
        paper: layout.paper,
        paperUnits: paper.units,
        width: paper.width,
        height: paper.height,
        plotStyle: layout.plotStyle ?? "monochrome.ctb",
        entities: layout.entities.length,
        inserts: insertSummaries(library, drawing, layout.entities),
        dimensions: dimensionSummaries(library, drawing, layout.entities),
        viewports: layout.viewports.flatMap((viewport, index) => {
          const box = viewportBox(library, drawing, layout, index);

          if (!box) return [];

          return [
            {
              id: viewport.id ?? null,
              layer: viewport.layer,
              border: borders.includes(`data-viewport-border="${index}"`),
              rectangle: box.rectangle,
              ratio: viewport.ratio,
              center: viewport.center,
              shows: box.shows,
            },
          ];
        }),
      },
    ];
  });
}

function layerSummaries(drawing: Drawing): LayerSummary[] {
  const counts = new Map<string, number>();

  for (const e of drawing.entities) counts.set(e.layer, (counts.get(e.layer) ?? 0) + 1);

  return drawing.layers.map((l) => ({
    name: l.name,
    color: l.color,
    linetype: l.linetype ?? "Continuous",
    lineweight: l.lineweight ?? "Default",
    off: l.off === true,
    frozen: l.frozen === true,
    plot: l.plot !== false,
    entities: counts.get(l.name) ?? 0,
  }));
}

/** The entities of each layout whose list of them can be read. */
function sheetEntities(drawing: Drawing): (readonly Entity[])[] {
  return (drawing.layouts ?? []).flatMap((layout) =>
    Array.isArray(layout?.entities) ? [layout.entities] : [],
  );
}

/** The block an insert places, found as the library that checks the drawing finds it. */
function blockNamed(library: Library, drawing: Drawing, name: unknown): Block | undefined {
  // A drawing made by hand may give an insert a name of another type.
  return isString(name) ? library.findBlock?.(drawing, name) : undefined;
}

function blockSummaries(library: Library, drawing: Drawing): BlockSummary[] {
  const blocks = drawing.blocks ?? [];
  const placed = new Map<unknown, number>();

  for (const entities of [
    drawing.entities,
    ...blocks.map((b) => b.entities),
    ...sheetEntities(drawing),
  ]) {
    for (const e of entities) {
      if (e.kind !== "insert") continue;
      const block = blockNamed(library, drawing, e.block);
      placed.set(block, (placed.get(block) ?? 0) + 1);
    }
  }

  return blocks.map((b) => ({
    name: b.name,
    entities: b.entities.length,
    attributes: (b.attributes ?? []).map((a) => a.tag),
    inserts: placed.get(b) ?? 0,
  }));
}

/** The xref an insert places, found as the library that checks the drawing finds it. */
function xrefNamed(library: Library, drawing: Drawing, name: unknown): Xref | undefined {
  if (!isString(name) || blockNamed(library, drawing, name)) return undefined;

  return library.findXref?.(drawing, name);
}

/**
 * A drawing the file gives for an xref, under the name it gives it by, or the preview of a
 * title block of its standard whose border is the xref.
 */
interface Given {
  readonly name: string;
  readonly drawing: Drawing;
  readonly preview: boolean;
  /** The errors `lint` finds in it. A drawing with any is not drawn. */
  readonly errors: readonly Diagnostic[];
  /** What the file gives for each attachment of `drawing` that the pictures draw. */
  readonly nested: ReadonlyMap<Xref, Given>;
}

/**
 * The drawing given for each xref of the drawing, checked by the library that checks the
 * drawing. A preview stands for an xref the file's `xrefs` gives no drawing for. Below them, each
 * drawing the library's `drawnXrefs` says the pictures draw. Each drawing is linted once.
 */
function givenDrawings(
  library: Library,
  drawing: Drawing,
  referenced: GivenXrefs,
  previews: readonly (readonly [name: string, preview: Drawing])[],
): Map<Xref, Given> {
  const linted = new Map<Drawing, readonly Diagnostic[]>();

  const errorsOf = (other: Drawing): readonly Diagnostic[] => {
    let found = linted.get(other);

    if (!found) {
      found = library.lint(other).filter((d) => d.severity === "error");
      linted.set(other, found);
    }

    return found;
  };

  // The file's own drawings for the xrefs come first, and a preview stands for one it does not
  // give.
  const exported = new Set<Xref>();
  const taken = new Set<Xref>();
  // An xref may be named `__proto__`, which an object with a prototype would not keep.
  const offered: Record<string, GivenXref> = Object.create(null);

  for (const [name, value, own] of [
    ...Object.entries(referenced).map(([name, value]) => [name, value, true] as const),
    ...previews.map(([name, preview]) => [name, preview, false] as const),
  ]) {
    const xref = xrefNamed(library, drawing, name);

    if (!xref || taken.has(xref)) continue;
    taken.add(xref);

    if (own) exported.add(xref);
    offered[name] = value;
  }

  /** What is given for the xrefs of `of`, as the library draws it. */
  const read = (of: Drawing, tree: GivenXrefs, top: boolean): Map<Xref, Given> => {
    const out = new Map<Xref, Given>();

    for (const [name, value] of Object.entries(tree)) {
      const xref = xrefNamed(library, of, name);

      if (!xref || out.has(xref)) continue;
      const { drawing: other, xrefs } = givenOf(value);
      const errors = errorsOf(other);

      const below =
        errors.length > 0 || xrefs === undefined ? new Map() : read(other, xrefs, false);

      const preview = top && !exported.has(xref);
      out.set(xref, { name, drawing: other, preview, errors, nested: below });
    }

    return out;
  };

  const drawn = library.drawnXrefs?.(drawing, offered) ?? flatOf(library, drawing, offered);

  return read(drawing, drawn, true);
}

/** The export `xrefs` with the first of its names for each xref of the drawing, and no other. */
function exportedXrefs(library: Library, drawing: Drawing, referenced: GivenXrefs): GivenXrefs {
  const taken = new Set<Xref>();
  const out: Record<string, GivenXref> = Object.create(null);

  for (const [name, value] of Object.entries(referenced)) {
    const xref = xrefNamed(library, drawing, name);

    if (!xref || taken.has(xref)) continue;
    taken.add(xref);
    out[name] = value;
  }

  return out;
}

/** What a copy of tsdraft from before attachments draws: each drawing given alone, as given. */
function flatOf(library: Library, drawing: Drawing, offered: GivenXrefs): GivenXrefs {
  return Object.fromEntries(
    Object.entries(offered).flatMap(([name, value]) => {
      const { drawing: other } = givenOf(value);

      return xrefNamed(library, drawing, name) && other !== drawing ? [[name, other]] : [];
    }),
  );
}

/** The most bytes a shape file is read to, and the shape files of a drawing all told. */
const SHX_FILE_BYTES = 4_000_000;
const SHX_BYTES = 64 << 20;

/**
 * How a copy of tsdraft names shape files: the key it finds a file by, the field of a mark that
 * holds its shape's number, and whether it takes the files as `OLDER_SHX.option`, as a copy from
 * before the SHX names does.
 */
interface ShxNames {
  readonly key: (file: string) => string;
  readonly glyph: string;
  readonly older: boolean;
}

/** How the library names shape files, or undefined for a copy of tsdraft from before shapes. */
function shxNamesOf(library: Library): ShxNames | undefined {
  const key = library.shxFileKey;

  if (isFunction(key)) return { key, glyph: "glyph", older: false };
  const older = library[OLDER_SHX.key];

  return isFunction(older) ? { key: older, glyph: OLDER_SHX.glyph, older: true } : undefined;
}

/**
 * The shape files a drawing's linetypes name, by the name a mark gives, each read once from the
 * folder of the drawing's file, where its name is found as the library's key of a shape file
 * finds it. Each is tracked where it is or would be, so `tsdraft dev` builds again when one is
 * copied there or changes. A file not there, or too long, is left out, and `lint` warns of its
 * shapes. Empty for a copy of tsdraft from before shapes.
 */
function shxFilesOf(library: Library, drawing: Drawing, file: string): ShxFiles {
  const named = shxNamesOf(library);

  if (named === undefined) return {};
  const { key, glyph } = named;
  const names: string[] = [];

  for (const linetype of Array.isArray(drawing.linetypes) ? drawing.linetypes : []) {
    // A drawing made by hand may hold anything in its lists.
    const given: LinetypeFields | null | undefined = linetype;
    const marks = given?.marks;

    for (const m of Array.isArray(marks) ? marks : []) {
      const mark: MarkFields | null | undefined = m;
      const named = mark?.file;

      if (isObject(mark) && glyph in mark && isString(named)) names.push(named);
    }
  }

  if (names.length === 0) return {};
  const folder = dirname(file);
  // The folder's shape files, each by its key, folded once.
  const found = new Map<string, string>();

  try {
    for (const entry of readdirSync(folder))
      if (/\.shx$/i.test(entry) && !found.has(key(entry))) found.set(key(entry), entry);
  } catch {
    // A folder that cannot be read has no shape files.
  }

  // A record of no prototype, so a file named `__proto__` is a name like any other.
  const files: Record<string, Uint8Array> = Object.create(null);
  // Each spelling a mark gives has an entry, and each file is read once.
  const bytesOf = new Map<string, Uint8Array | undefined>();
  const given = new Set<string>();
  let total = 0;

  for (const name of names) {
    if (given.has(key(name))) continue;
    given.add(key(name));
    const base = name.replaceAll("\\", "/").split("/").at(-1) ?? "";
    const k = key(base);

    if (base === "") continue;

    if (!bytesOf.has(k)) {
      const entry = found.get(k);
      const at = join(folder, entry ?? (/\.shx$/i.test(base) ? base : `${base}.shx`));
      track(at, fileVersion(at));
      let bytes: Uint8Array | undefined;

      if (entry !== undefined) {
        try {
          const size = statSync(at).size;

          if (size <= SHX_FILE_BYTES && total + size <= SHX_BYTES) {
            total += size;
            bytes = new Uint8Array(readFileSync(at));
          }
        } catch {
          // A file that cannot be read is left out.
        }
      }

      bytesOf.set(k, bytes);
    }

    const bytes = bytesOf.get(k);

    if (bytes !== undefined) files[name] = bytes;
  }

  return named.older ? { [OLDER_SHX.option]: files } : { shx: files };
}

/** The files of a drawing's images, by path, and what is wrong with them. */
interface RasterFiles {
  readonly images: Record<string, Uint8Array> | undefined;
  readonly diagnostics: BuildDiagnostic[];
}

/** The most bytes the files of a drawing's images are read to, all told. */
const RASTER_BYTES = 1 << 30;

/**
 * The files of a drawing's images, by each image's path as the drawing gives it, read from the
 * folder of the drawing's file, with what is wrong with each: one that is not there, is not a PNG
 * or a JPEG, or has other pixels than its image gives it, which the picture then draws as its
 * frame and its path, as the leading CAD app draws an image whose file it cannot find. Each is
 * tracked, so `tsdraft dev` builds again when one changes. `budget` counts the bytes read for
 * every drawing of the build, and once it is spent nothing more is read. `xref` names the xref
 * the drawing stands for. Undefined for a copy of tsdraft from before images.
 */
function rasterFiles(
  library: Library,
  drawing: Drawing,
  file: string,
  budget: { total: number },
  xref?: string,
): RasterFiles {
  if (!isFunction(library.rasterSize)) return { images: undefined, diagnostics: [] };

  if (budget.total > RASTER_BYTES) return { images: {}, diagnostics: [] };
  const of = xref === undefined ? "" : ` of the xref ${JSON.stringify(xref)}`;
  const images: Record<string, Uint8Array> = {};
  const diagnostics: BuildDiagnostic[] = [];
  const seen = new Set<string>();

  const lists: unknown[] = [
    drawing.entities,
    ...(Array.isArray(drawing.layouts) ? drawing.layouts.map((l) => l?.entities) : []),
    ...(Array.isArray(drawing.blocks) ? drawing.blocks.map((b) => b?.entities) : []),
  ];

  for (const list of lists) {
    if (!Array.isArray(list)) continue;

    for (const e of list) {
      const entity: unknown = e;

      if (!isObject(entity)) continue;
      const fields: PictureEntityFields = entity;

      if (fields.kind !== "image") continue;
      const { path, pixels } = fields;

      if (!isString(path) || seen.has(path) || isAbsolute(path) || /^[A-Za-z]:/.test(path)) {
        continue;
      }

      seen.add(path);
      const at = join(dirname(file), path.replaceAll("\\", "/"));
      // A link is watched beside the file it leads to, whose change it does not see.
      track(at, fileVersion(at));

      try {
        const real = realpathSync(at);

        if (real !== at) track(real, fileVersion(real));
      } catch {
        // A missing file has no file behind it.
      }

      let bytes: Uint8Array;

      try {
        bytes = new Uint8Array(readFileSync(at));
      } catch {
        diagnostics.push({
          rule: "image",
          severity: "warning",
          message: `The file of the image ${JSON.stringify(path)}${of} is not at ${at}, so the pictures draw its frame and its path, as the leading CAD app draws an image whose file it cannot find`,
        });
        continue;
      }

      budget.total += bytes.length;

      if (budget.total > RASTER_BYTES) {
        diagnostics.push({
          rule: "image",
          severity: "warning",
          message: `The files of the drawing's images come to more than ${RASTER_BYTES} bytes, so the pictures draw the image ${JSON.stringify(path)}${of} and those after it as frames`,
        });

        return { images, diagnostics };
      }

      const size = library.rasterSize(bytes);

      if (size === undefined) {
        diagnostics.push({
          rule: "image",
          severity: "warning",
          message: `The file of the image ${JSON.stringify(path)}${of} is not a PNG or a JPEG the pictures can draw, so they draw its frame and its path`,
        });
        continue;
      }

      if (!Array.isArray(pixels) || pixels[0] !== size[0] || pixels[1] !== size[1]) {
        diagnostics.push({
          rule: "image",
          severity: "error",
          message: `The file of the image ${JSON.stringify(path)}${of} is ${size[0]} by ${size[1]} pixels, and the drawing gives it ${JSON.stringify(pixels)}: the leading CAD app would plot it at the wrong size. Give it the file's pixels, which rasterSize reads`,
        });
        continue;
      }

      images[path] = bytes;
    }
  }

  return { images, diagnostics };
}

/** The pictures of a drawing's underlays' pages, by path and then page, and what is wrong. */
interface PageFiles {
  readonly underlays: Record<string, Record<string, Uint8Array>> | undefined;
  readonly diagnostics: BuildDiagnostic[];
}

/**
 * The pictures of the pages a drawing's underlays show, by each underlay's path as the drawing
 * gives it, then by its page: `<file>.page<N>.png` beside the PDF, which `pdftocairo` draws, read
 * from the folder of the drawing's file, with what is wrong with each. A page with no picture is
 * drawn as the leading CAD app draws an underlay whose file it cannot find, and the warning gives
 * the command that draws one. Where the library reads a PDF's page sizes, an underlay whose
 * `pageSize` is not its page's is an error. Each file is tracked, so `tsdraft dev` builds again
 * when one changes. Undefined for a copy of tsdraft from before underlays.
 */
function pageFiles(
  library: Library,
  drawing: Drawing,
  file: string,
  budget: { total: number },
): PageFiles {
  if (library.underlayCorners === undefined || !isFunction(library.rasterSize))
    return { underlays: undefined, diagnostics: [] };
  // Objects of no prototype, so a path or page such as `__proto__` is a key like any other.
  const underlays: Record<string, Record<string, Uint8Array>> = Object.create(null);
  const diagnostics: BuildDiagnostic[] = [];
  const pdfs = new Map<string, Uint8Array | null>();

  const lists: unknown[] = [
    drawing.entities,
    ...(Array.isArray(drawing.layouts) ? drawing.layouts.map((l) => l?.entities) : []),
    ...(Array.isArray(drawing.blocks) ? drawing.blocks.map((b) => b?.entities) : []),
  ];

  const read = (at: string): Uint8Array | null => {
    track(at, fileVersion(at));

    try {
      const real = realpathSync(at);

      if (real !== at) track(real, fileVersion(real));
    } catch {
      // A missing file has no file behind it.
    }

    try {
      return new Uint8Array(readFileSync(at));
    } catch {
      return null;
    }
  };

  /** Each page's files, read once: its PDF's size of it, and its picture's pixels. */
  const pagesRead = new Map<
    string,
    {
      pdfAt: string;
      /** The page's size in the PDF; undefined where it cannot be read, null with no PDF. */
      size: readonly [number, number] | undefined | null;
      /** Whether the PDF is read but has no such page. */
      absent: boolean;
      picture: Uint8Array | null;
      pixels: readonly [number, number] | undefined;
      command: string;
    }
  >();

  /** The pages a placement was refused for: the pictures draw none of their placements. */
  const refused: [path: string, page: string][] = [];
  /** Whether pdfPageSize reads each PDF's first page: if so, a page it cannot read is absent. */
  const firstPages = new Map<Uint8Array, boolean>();
  const said = new Set<string>();

  const say = (severity: "warning" | "error", message: string): void => {
    if (said.has(message)) return;
    said.add(message);
    diagnostics.push({ rule: "underlay", severity, message });
  };

  for (const list of lists) {
    if (!Array.isArray(list)) continue;

    for (const e of list) {
      const entity: unknown = e;

      if (!isObject(entity)) continue;
      const fields: PictureEntityFields = entity;

      if (fields.kind !== "underlay") continue;
      const { path, page: given, pageSize } = fields;
      const page = given === undefined ? "1" : given;

      if (!isString(path) || !isString(page)) continue;

      if (isAbsolute(path) || /^[A-Za-z]:/.test(path)) continue;
      const key = `${page}|${path}`;
      let files = pagesRead.get(key);

      if (files === undefined) {
        if (budget.total > RASTER_BYTES) continue;
        const pdfAt = join(dirname(file), path.replaceAll("\\", "/"));
        let pdf = pdfs.get(pdfAt);

        if (pdf === undefined) pdfs.set(pdfAt, (pdf = read(pdfAt)));
        const sizeOf = isFunction(library.pdfPageSize) ? library.pdfPageSize : undefined;
        const size = pdf === null ? null : sizeOf?.(pdf, page);
        let readable = pdf === null ? undefined : firstPages.get(pdf);

        if (pdf !== null && readable === undefined) {
          firstPages.set(pdf, (readable = sizeOf?.(pdf, 1) !== undefined));
        }

        const absent = size === undefined && readable === true;
        const pictureAt = `${pdfAt}.page${page}.png`;
        const picture = pdf === null || absent ? null : read(pictureAt);

        if (picture !== null) budget.total += picture.length;

        const pixels =
          picture === null || picture[0] !== 0x89 ? undefined : library.rasterSize(picture);

        const command = `pdftocairo -png -transp -cropbox -r 150 -f ${page} -l ${page} -singlefile ${JSON.stringify(pdfAt)} ${JSON.stringify(`${pdfAt}.page${page}`)}`;
        pagesRead.set(key, (files = { pdfAt, size, absent, picture, pixels, command }));
      }

      const { pdfAt, size, absent, picture, pixels, command } = files;
      const pictureAt = `${pdfAt}.page${page}.png`;

      if (size === null) {
        say(
          "warning",
          `The file of the underlay ${JSON.stringify(path)} is not at ${pdfAt}, so the pictures write that it is missing, as the leading CAD app does`,
        );
        continue;
      }

      if (absent) {
        say(
          "warning",
          `The file of the underlay ${JSON.stringify(path)} has no page ${page}, so the pictures write that it is missing`,
        );
        continue;
      }

      const [w, h]: readonly unknown[] = Array.isArray(pageSize) ? pageSize : [];

      if (size === undefined && isFunction(library.pdfPageSize)) {
        say(
          "warning",
          `The file of the underlay ${JSON.stringify(path)} has no page ${page} that pdfPageSize can read, so its size is not checked`,
        );
      } else if (
        size !== undefined &&
        (!isNumber(w) ||
          !isNumber(h) ||
          !(Math.abs(w - size[0]) <= 1e-6 * Math.max(1, size[0])) ||
          !(Math.abs(h - size[1]) <= 1e-6 * Math.max(1, size[1])))
      ) {
        say(
          "error",
          `Page ${page} of the underlay ${JSON.stringify(path)} is ${size[0]} by ${size[1]} inches, and the drawing gives it ${JSON.stringify(pageSize)}: the leading CAD app would place it at another size. Give it the page's size, which pdfPageSize reads. Until then the pictures write that the file of each underlay of the page is missing`,
        );
        refused.push([path, page]);
        continue;
      }

      if (picture === null) {
        say(
          "warning",
          `Page ${page} of the underlay ${JSON.stringify(path)} has no picture at ${pictureAt}, so the pictures write that its file is missing. Draw one with: ${command}`,
        );
        continue;
      }

      if (pixels === undefined) {
        say(
          "warning",
          `The picture ${pictureAt} of page ${page} of the underlay ${JSON.stringify(path)} is not a PNG the pictures can draw, so they write that its file is missing. Draw one with: ${command}`,
        );
        continue;
      }

      // Some one resolution draws both sides of the page within a pixel of the picture's.
      const [px, py] = pixels;

      if (
        isNumber(w) &&
        isNumber(h) &&
        w > 0 &&
        h > 0 &&
        !(Math.max((px - 1) / w, (py - 1) / h) <= Math.min((px + 1) / w, (py + 1) / h))
      ) {
        say(
          "error",
          `The picture ${pictureAt} is ${px} by ${py} pixels, and page ${page} of the underlay ${JSON.stringify(path)} is ${w} by ${h} inches: the picture must have the page's shape. Draw it from the page's crop box with: ${command}. Until then the pictures write that the file of each underlay of the page is missing`,
        );
        refused.push([path, page]);
        continue;
      }

      const byPage: Record<string, Uint8Array> = (underlays[path] ??= Object.create(null));
      byPage[page] = picture;
    }
  }

  for (const [path, page] of refused) delete underlays[path]?.[page];

  return { underlays, diagnostics };
}

/**
 * What the pictures are given for the xrefs: each drawing given with no lint error, and with
 * `files`, the files of its images, read from the folder of the xref's file, which `folder`, the
 * folder of the drawing that references it, starts its path from.
 */
function drawnOf(
  given: ReadonlyMap<Xref, Given>,
  folder = "",
  files?: (drawing: Drawing, file: string, xref: string) => Record<string, Uint8Array> | undefined,
): GivenXrefs {
  return Object.fromEntries(
    [...given].flatMap(([xref, g]): [string, GivenXref][] => {
      if (g.errors.length > 0) return [];
      const path = isString(xref.path) ? xref.path.replaceAll("\\", "/") : "";
      const at = isAbsolute(path) ? path : join(folder, path);
      // A path with a drive, which lint refuses, names no folder here.
      const found = path !== "" && !/^[A-Za-z]:/.test(path);
      const images = files && !g.preview && found ? files(g.drawing, at, g.name) : undefined;
      const nested = g.nested.size > 0 ? drawnOf(g.nested, dirname(at), files) : undefined;

      if (images === undefined) {
        return [[g.name, nested === undefined ? g.drawing : { drawing: g.drawing, xrefs: nested }]];
      }

      return [
        [
          g.name,
          nested === undefined
            ? { drawing: g.drawing, images }
            : { drawing: g.drawing, xrefs: nested, images },
        ],
      ];
    }),
  );
}

/** Every drawing the pictures are given for an xref, at any depth. */
function drawingsOf(given: ReadonlyMap<Xref, Given>): Drawing[] {
  return [...given.values()].flatMap((g) =>
    g.errors.length === 0 ? [g.drawing, ...drawingsOf(g.nested)] : [],
  );
}

/** The errors of each drawing given, as problems of the chain of xrefs that leads to it. */
function givenErrors(given: ReadonlyMap<Xref, Given>, chain: readonly string[]): Diagnostic[] {
  return [...given].flatMap(([xref, g]) => {
    const here = [...chain, xref.name];

    return [...g.errors.map((d) => inGiven(here, g, d)), ...givenErrors(g.nested, here)];
  });
}

/**
 * The field `key` of `of` when it is own data that `is` accepts. A getter is never run and a
 * proxy never asked, since the export `standard` may be anything.
 */
function ownField<T>(of: unknown, key: string, is: (field: unknown) => field is T): T | undefined {
  if (!isObject(of) || types.isProxy(of)) return undefined;
  const field = Object.getOwnPropertyDescriptor(of, key);

  if (field === undefined || !("value" in field)) return undefined;
  const value: unknown = field.value;

  return is(value) ? value : undefined;
}

/**
 * Each title block of a standard whose border is an xref and that has a `preview`, as the
 * xref's name and the preview. Only own data is read, and anything else gives nothing.
 */
function titleBlockPreviews(standard: unknown): [name: string, preview: Drawing][] {
  try {
    const blocks = ownField(standard, "titleBlocks", isObject);

    if (blocks === undefined) return [];

    return Object.keys(blocks).flatMap((key): [name: string, preview: Drawing][] => {
      const block = ownField(blocks, key, isObject);
      const name = ownField(ownField(block, "xref", isObject), "name", isString);
      const preview = ownField(block, "preview", isObject);

      if (
        name === undefined ||
        preview === undefined ||
        ownField(preview, "layers", Array.isArray) === undefined ||
        ownField(preview, "entities", Array.isArray) === undefined ||
        ownField(preview, "units", isString) === undefined
      ) {
        return [];
      }

      // SAFETY: the preview's layers and entities are own arrays and its units an own string,
      // which is what the worker reads first of a drawing, as of the default export.
      return [[name, preview as Drawing]];
    });
  } catch {
    return [];
  }
}

/** The id, version and hash of the file's export `standard`, when it holds all three. */
function standardSummary(standard: unknown, checked: boolean): StandardSummary | null {
  try {
    const [id, version, hash] = ["id", "version", "hash"].map((key) =>
      ownField(standard, key, isString),
    );

    return id !== undefined && version !== undefined && hash !== undefined
      ? { id, version, hash, checked }
      : null;
  } catch {
    return null;
  }
}

/**
 * A problem in the drawing given for an xref, as a problem of the xref. It keeps the rule, the
 * id and the call, and leaves out the entity's index, which counts another drawing's entities.
 * `chain` runs from the xref of the drawing down to the xref the drawing is given for.
 */
function inGiven(chain: readonly string[], given: Given, found: Diagnostic): Diagnostic {
  const what = given.preview ? "its title block's preview" : "the drawing given for it";

  const problem: Diagnostic = {
    rule: found.rule,
    severity: found.severity,
    message: `Xref ${chain.map((name) => JSON.stringify(name)).join(" > ")}: ${what} has an error, so it is not drawn. ${found.message}`,
    xref: chain[0]!,
  };

  const withId = found.id === undefined ? problem : { ...problem, id: found.id };

  return found.call === undefined ? withId : { ...withId, call: found.call };
}

/**
 * Each xref of the drawing. For a drawing drawn inside another, `referenced`, only what its
 * model space reaches is drawn, directly or through its blocks, so only those inserts count.
 */
function xrefSummaries(
  library: Library,
  drawing: Drawing,
  given: ReadonlyMap<Xref, Given>,
  referenced = false,
  counts = new Map<Drawing, Map<unknown, number>>(),
): XrefSummary[] {
  // A drawing given at many places is counted once, and each name in it looked up once: one
  // drawn inside another has passed lint, so its names are short.
  let placed = referenced ? counts.get(drawing) : undefined;

  if (!placed) {
    placed = new Map<unknown, number>();
    const named = new Map<string, Xref | undefined>();

    const xrefOf = (name: string): Xref | undefined => {
      if (!referenced) return xrefNamed(library, drawing, name);

      if (!named.has(name)) named.set(name, xrefNamed(library, drawing, name));

      return named.get(name);
    };

    const lists = referenced
      ? reached(library, drawing)
      : [
          drawing.entities,
          ...(drawing.blocks ?? []).map((b) => b.entities),
          ...sheetEntities(drawing),
        ];

    for (const entities of lists) {
      for (const e of entities) {
        if (e.kind !== "insert") continue;
        const xref = xrefOf(e.block);
        placed.set(xref, (placed.get(xref) ?? 0) + 1);
      }
    }

    if (referenced) counts.set(drawing, placed);
  }

  return (drawing.xrefs ?? []).map((x) => {
    const found = given.get(x);
    const inserts = placed.get(x) ?? 0;
    const shown = found?.errors.length === 0;

    return {
      name: x.name,
      path: x.path,
      attach: x.attach === true,
      inserts,
      shown,
      units: found?.drawing.units ?? null,
      xrefs: shown ? xrefSummaries(library, found.drawing, found.nested, true, counts) : [],
    };
  });
}

/** Model space and each block it reaches through its inserts, once each. */
function reached(library: Library, drawing: Drawing): (readonly Entity[])[] {
  const lists: (readonly Entity[])[] = [drawing.entities];
  const seen = new Set<Block>();
  // Each name is looked up once: the drawing has passed lint, so its names are short.
  const named = new Map<string, Block | undefined>();

  for (let at = 0; at < lists.length; at++) {
    for (const e of lists[at]!) {
      if (e.kind !== "insert") continue;

      if (!named.has(e.block)) named.set(e.block, blockNamed(library, drawing, e.block));
      const block = named.get(e.block);

      if (!block || seen.has(block)) continue;
      seen.add(block);
      lists.push(block.entities);
    }
  }

  return lists;
}

function insertSummaries(
  library: Library,
  drawing: Drawing,
  entities: readonly Entity[] = drawing.entities,
): InsertSummary[] {
  return entities.flatMap((e, entity): InsertSummary[] => {
    if (e.kind !== "insert") return [];
    const definitions = blockNamed(library, drawing, e.block)?.attributes ?? [];

    return [
      {
        entity,
        block: e.block,
        xref: xrefNamed(library, drawing, e.block) !== undefined,
        layer: e.layer,
        id: e.id ?? null,
        at: e.at,
        scale: e.scale ?? [1, 1],
        rotation: e.rotation ?? 0,
        attributes: Object.fromEntries(
          definitions.map((a) => [a.tag, e.attributes?.[a.tag] ?? a.value]),
        ),
      },
    ];
  });
}

/** The kind a dimension summary names for each kind of dimension. */
const SUMMARY_KINDS = {
  "linear-dimension": "linear",
  "aligned-dimension": "aligned",
  "radius-dimension": "radius",
  "diameter-dimension": "diameter",
  "jogged-radius-dimension": "jogged-radius",
  "angular-dimension": "angular",
  "arc-length-dimension": "arc-length",
  "ordinate-dimension": "ordinate",
} as const;

type Dimension = Extract<Entity, { readonly kind: `${string}-dimension` }>;

/** Whether an entity is a dimension of a kind a summary names. */
function isSummarized(e: Entity): e is Dimension {
  return Object.hasOwn(SUMMARY_KINDS, e.kind);
}

/** Each dimension among some entities, with what the library the drawing loaded says it reads. */
function dimensionSummaries(
  library: Library,
  drawing: Drawing,
  entities: readonly Entity[] = drawing.entities,
): DimensionSummary[] {
  return entities.flatMap((e, entity): DimensionSummary[] => {
    if (!isSummarized(e)) return [];
    const dimension = e;
    let read: { measurement: number; text: string } | undefined;

    try {
      const style = isString(dimension.style)
        ? library.findDimensionStyle?.(drawing, dimension.style)
        : undefined;

      const picture = style && library.dimensionPicture?.(dimension, style);

      if (picture && Number.isFinite(picture.measurement)) {
        // An angle in degrees, as every angle of a drawing is.
        const degrees = dimension.kind === "angular-dimension";
        const measurement = degrees ? (picture.measurement * 180) / Math.PI : picture.measurement;
        read = { measurement, text: picture.label.value };
      }
    } catch {
      // A dimension or a style that breaks a rule, which the diagnostics say.
    }

    return [
      {
        entity,
        id: e.id ?? null,
        layer: dimension.layer,
        kind: SUMMARY_KINDS[dimension.kind],
        style: dimension.style,
        measurement: read?.measurement ?? null,
        text: read?.text ?? null,
      },
    ];
  });
}

/** The drawing's layers, all on, thawed and plotting, so `toSVG` draws what is on each. */
function shownLayers(drawing: Drawing): Drawing["layers"] {
  return drawing.layers.map((l) => ({ ...l, off: false, frozen: false, plot: true }));
}

/** The color `toSVG` draws each layer in, by layer name. */
interface Swatches {
  [layer: string]: string;
}

/** Asks `toSVG` for each layer's color by drawing one short line on every layer. */
function swatches(library: Library, drawing: Drawing): Swatches {
  const probe: Drawing = {
    ...drawing,
    layers: shownLayers(drawing),
    entities: drawing.layers.map((l) => ({
      kind: "line",
      layer: l.name,
      from: [0, 0],
      to: [1, 0],
    })),
  };

  const out: Swatches = {};

  for (const match of library.toSVG(probe).matchAll(/stroke="([^"]+)"[^>]*data-layer="([^"]*)"/g)) {
    out[unescape(match[2]!)] = match[1]!;
  }

  return out;
}

function unescape(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

/** Every version of every tracked path the build read, the drawing file first. */
function readFiles(file: string): FileVersion[] {
  const first: FileVersion[] = [...(read.get(file) ?? [null])].map((v) => [file, v]);
  const rest = [...read].filter(([path]) => path !== file);

  return [
    ...first,
    ...rest.flatMap(([path, versions]) => [...versions].map((v): FileVersion => [path, v])),
  ];
}

/**
 * Whether a change to the file should rebuild: any file but an installed package's. A
 * workspace package linked into node_modules is tracked, as Node loads it by its real path.
 */
function tracked(path: string): boolean {
  return !path.includes(`${sep}node_modules${sep}`);
}

/** Whether the file is the user's code, to place an error in. */
function inProject(path: string, root: string): boolean {
  return path.startsWith(root + sep) && tracked(path);
}

/** An error about the default export, placed at the `export default` line when there is one. */
function atExport(file: string, message: string): BuildError {
  let line: number | null = null;

  try {
    const index = readFileSync(file, "utf8")
      .split("\n")
      .findIndex((l) => /\bexport\s+default\b/.test(l));

    if (index >= 0) line = index + 1;
  } catch {
    // Unreadable now; the message still says what to fix.
  }

  return { name: "Error", message, code: null, file, line, column: null, stack: "" };
}

/** Turns whatever the file threw into a `BuildError` that points at the user's code. */
function describe(cause: unknown, root: string): BuildError {
  if (!(cause instanceof Error)) {
    return {
      name: "Error",
      message: `The file threw ${isString(cause) ? cause : JSON.stringify(cause)}`,
      code: null,
      ...nowhere,
      stack: "",
    };
  }

  const stack = cause.stack ?? "";
  const thrown: ThrownFields = cause;
  const { code } = thrown;

  // Node reads a .ts file as CommonJS when the project's package.json says so, as `npm init`'s does.
  const commonjs =
    cause instanceof SyntaxError &&
    cause.message.startsWith("Cannot use import statement outside a module");

  return {
    name: cause.name,
    message: commonjs
      ? `${cause.message}. Set "type": "module" in the project's package.json, or name the file .mts`
      : cause.message,
    code: isString(code) ? code : null,
    ...locate(cause, stack, root),
    stack,
  };
}

const nowhere = { file: null, line: null, column: null };

function locate(
  error: Error,
  stack: string,
  root: string,
): Pick<BuildError, "file" | "line" | "column"> {
  const lines = stack.split("\n");
  // A syntax error starts its stack with "path:line", the source around it and a caret line.
  const head = /^((?:file:\/\/)?[^\s]+):(\d+)$/.exec(lines[0] ?? "");

  if (head) {
    const caret = lines.findIndex((l) => /^\s*\^+\s*$/.test(l));

    return {
      file: toPath(head[1]!),
      line: Number(head[2]),
      column: caret > 0 ? lines[caret]!.indexOf("^") + 1 : null,
    };
  }

  const frames = lines.flatMap((l) => {
    const m = /^\s+at .*?\(?((?:file:\/\/)?\/[^\s()]+):(\d+):(\d+)\)?$/.exec(l);

    return m ? [{ file: toPath(m[1]!), line: Number(m[2]), column: Number(m[3]) }] : [];
  });

  // The innermost frame of the user's code. tsdraft's frames lie outside the project or in
  // `ownCode`, as this worker's do, so a throw inside either lands on the call that led to it.
  const frame = frames.find(
    (f) => !ownCode.some((dir) => f.file.startsWith(dir)) && inProject(f.file, root),
  );

  if (frame) return frame;
  // "Cannot find module '/x/y.ts' imported from /x/drawing.ts" names the importer.
  const importer = / imported from (\S+)$/.exec(error.message);

  if (importer) return { file: toPath(importer[1]!), line: null, column: null };

  return nowhere;
}

function toPath(location: string): string {
  return location.startsWith("file://") ? fileURLToPath(location) : location;
}
