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
import { dirname, isAbsolute, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { types } from "node:util";
import { Worker } from "node:worker_threads";
import type {
  Block,
  Diagnostic,
  DimensionPicture,
  DimensionStyle,
  Drawing,
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
  InsertSummary,
  LayerSummary,
  LayoutSummary,
  StandardSummary,
  XrefSummary,
} from "./state.ts";
import { LEFT_OUT, without } from "./omit.ts";
import { fileVersion } from "./version.ts";
import { formatSteps, librarySteps, stripSteps } from "./warmup.ts";

export interface BuildRequest {
  readonly type: "build";
  readonly file: string;
  /** The project folder: files under it, outside node_modules, are the user's code. */
  readonly root: string;
  /** Draws the layers that do not plot too. */
  readonly drawNoPlot?: boolean;
  /**
   * Draws this one rectangle, of model space or of the layout named, in place of the pictures
   * of every space.
   */
  readonly view?:
    | { readonly box: readonly [number, number, number, number]; readonly layout?: string }
    | undefined;
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
  | { readonly type: "done"; readonly result: WorkerResult };

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
  readonly timings: {
    readonly load?: number;
    readonly lint?: number;
    readonly inspect?: number;
    readonly intent?: number;
    readonly svg?: number;
  };
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
  readonly swatches: Readonly<Record<string, string>>;
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
}

/** What the `xrefs` export gives: a drawing, or `{ drawing, xrefs }`, by an xref's name. */
type GivenXrefs = Readonly<Record<string, unknown>>;

interface Library {
  readonly lint: (
    drawing: Drawing,
    options?: {
      standard?: unknown;
      xrefs?: GivenXrefs;
      shapes?: Readonly<Record<string, Uint8Array>>;
    },
  ) => Diagnostic[];
  /** A copy of tsdraft from before standards has none, and its `lint` takes no standard. */
  readonly defineStandard?: unknown;
  readonly toSVG: (
    drawing: Drawing,
    options?: {
      margin?: number;
      drawNoPlot?: boolean;
      xrefs?: GivenXrefs;
      layout?: string;
      view?: readonly [number, number, number, number];
      images?: Readonly<Record<string, Uint8Array>>;
      shapes?: Readonly<Record<string, Uint8Array>>;
    },
  ) => string;
  /** The key a shape file is found by. A copy of tsdraft from before shapes has none. */
  readonly shapeFileKey?: (file: string) => string;
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
  readonly dimensionPicture?: (
    dimension: Extract<Entity, { readonly kind: `${string}-dimension` }>,
    style: DimensionStyle,
  ) => DimensionPicture;
}

// The streams' own `write`, which a drawing file may replace on `process.stdout` and
// `process.stderr`: the process writes through these to know its output has left it.
const [writeOut, writeErr] = [process.stdout.write, process.stderr.write];
/** The streams themselves, which a drawing may replace, end or cork. */
const [stdout, stderr] = [process.stdout, process.stderr];

// Deep enough that a drawing calling helpers several levels down still has its own frame.
Error.stackTraceLimit = 100;
// Every builder the drawing file makes records the call that draws each entity, for `call`.
(globalThis as { TSDRAFT_RECORD_CALLS?: boolean }).TSDRAFT_RECORD_CALLS = true;
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

/** Notes a version of a path the build depends on, and tells the parent at once. */
function track(path: string, version: string | null): void {
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
process.on("message", (message: BuildRequest | WarmRequest) => {
  if (request) return;
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
  const unwritten = (...given: unknown[]): boolean => {
    const written = given.at(-1);
    if (typeof written === "function") written();
    return true;
  };
  process.stdout.write = process.stderr.write = unwritten as typeof writeOut;
  const steps = [...stripSteps];
  try {
    if (library !== null && ownEntries.includes(library)) {
      // The library is its folder: a file from elsewhere is one this process cannot answer for.
      aheadFolder = dirname(library) + sep;
      const loadedAhead = (await import(pathToFileURL(library).href)) as Record<string, unknown>;
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

async function build({ file, root, drawNoPlot, view }: BuildRequest): Promise<WorkerResult> {
  const timings: {
    load?: number;
    lint?: number;
    inspect?: number;
    intent?: number;
    svg?: number;
  } = {};
  const fail = (error: BuildError, thrown?: unknown): WorkerResult => ({
    ok: false,
    files: [...readFiles(file), ...missingFile(thrown)],
    timings,
    drawing: null,
    diagnostics: drawingErrorDiagnostics(thrown),
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
    const module = (await import(pathToFileURL(file).href)) as {
      default?: unknown;
      xrefs?: unknown;
      intent?: unknown;
      standard?: unknown;
    };
    let value = module.default;
    if (typeof value === "function") value = await (value as () => unknown)();
    const problem = notADrawing(value, "default" in module) ?? notXrefs(module.xrefs);
    if (problem) return fail(atExport(file, problem));
    drawing = value as Drawing;
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
    const checked = standard !== undefined && typeof library.defineStandard === "function";
    // A copy that draws attachments says why a drawing the export gives is not drawn.
    // The export with one name for each xref, the first, which the pictures and lint both take.
    const exported = exportedXrefs(library, drawing, referenced);
    // A copy that draws attachments says why a drawing the export gives is not drawn.
    const chains = typeof library.drawnXrefs === "function" ? { xrefs: exported } : {};
    // The shape files the linetypes name, read from the drawing file's folder, which lint and the
    // pictures both take.
    const shaped = shapeFiles(library, drawing, file);
    const found = library.lint(
      drawing,
      checked ? { standard, ...chains, ...shaped } : { ...chains, ...shaped },
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
    const size = (list: unknown): number => (Array.isArray(list) ? list.length : 0);
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
        diagnostics.push(...intentWarnings(library, shown, intent));
        timings.intent = now() - t;
      }
      t = now();
      // The files of the drawing's images, read once from the drawing file's folder, and of each
      // xref's from the folder of its file.
      const budget = { total: 0 };
      const rasters = rasterFiles(library, shown, file, budget);
      diagnostics.push(...rasters.diagnostics);
      const images = rasters.images === undefined ? {} : { images: rasters.images };
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
          ...shaped,
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
                ...shaped,
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
        const one = library.toSVG(shown, {
          view: view.box,
          ...(view.layout === undefined ? {} : { layout: view.layout }),
          drawNoPlot: drawNoPlot === true,
          xrefs: pictured,
          ...images,
          ...shaped,
        });
        viewed = { layout: view.layout ?? null, svg: one, fonts: fontsOf(one) };
      }
      timings.svg = now() - t;
      const errors = diagnostics.filter((d) => d.severity === "error").length;
      return {
        ok: true,
        files: readFiles(file),
        timings,
        drawing: {
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
          ...(omitted.length > 0 ? { omitted } : {}),
          layers: layerSummaries(shown),
          blocks: blockSummaries(library, shown),
          inserts: insertSummaries(library, shown),
          dimensions: dimensionSummaries(library, shown),
          xrefs: xrefSummaries(library, shown, given),
          layouts: layoutSummaries(library, shown),
        },
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
function intentWarnings(library: Library, drawing: Drawing, intent: unknown): BuildDiagnostic[] {
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
    return library.checkIntent(drawing, intent as Intent).map((warning) => {
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
function drawingErrorDiagnostics(thrown: unknown): Diagnostic[] {
  const diagnostics = (thrown as { diagnostics?: unknown } | null)?.diagnostics;
  return thrown instanceof Error && thrown.name === "DrawingError" && Array.isArray(diagnostics)
    ? (diagnostics as Diagnostic[]).map(withPath)
    : [];
}

/** The file an import named that does not exist, so its creation can be watched. */
function missingFile(thrown: unknown): FileVersion[] {
  if (
    !(thrown instanceof Error) ||
    (thrown as { code?: unknown }).code !== "ERR_MODULE_NOT_FOUND"
  ) {
    return [];
  }
  const url = (thrown as { url?: unknown }).url;
  const named = /^Cannot find module '([^']+)'/.exec(thrown.message)?.[1];
  const path =
    typeof url === "string" && url.startsWith("file:")
      ? fileURLToPath(url)
      : named && toPath(named);
  return path && isAbsolute(path) && tracked(path) ? [[path, null]] : [];
}

/**
 * Says what is wrong with an `xrefs` export, or returns undefined: it is an object that gives
 * a drawing for each xref the pictures are to draw, by the xref's name, as a Drawing or as
 * `{ drawing, xrefs }` with the drawings that drawing's own xrefs stand for.
 */
function notXrefs(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const shape =
    "The export `xrefs` must be an object that gives a Drawing, or { drawing, xrefs } with the drawings of that drawing's own xrefs, for an xref's name, such as `export const xrefs = { BASE: base }`";
  // Each object given is checked once, so a circle of them ends.
  const seen = new Set<object>();
  const open: [xrefs: unknown, at: string][] = [[value, ""]];
  for (let next = open.pop(); next !== undefined; next = open.pop()) {
    const [xrefs, at] = next;
    if (typeof xrefs !== "object" || xrefs === null || Array.isArray(xrefs)) {
      return at === "" ? shape : `${shape}. Its ${at} is not an object`;
    }
    if (seen.has(xrefs)) continue;
    seen.add(xrefs);
    for (const [name, given] of Object.entries(xrefs)) {
      const here = `${at}${at === "" ? "" : " > "}${JSON.stringify(name)}`;
      const { drawing, xrefs: inner } = givenOf(given);
      if (notADrawing(drawing, true)) return `${shape}. Its ${here} is not a Drawing`;
      if (inner !== undefined) open.push([inner, `xrefs of ${here}`]);
    }
  }
  return undefined;
}

/** The drawing a value of the `xrefs` export gives, and what it gives for that drawing's xrefs. */
function givenOf(value: unknown): { readonly drawing: unknown; readonly xrefs: unknown } {
  if (typeof value === "object" && value !== null && "drawing" in value) {
    const nested = value as { readonly drawing: unknown; readonly xrefs?: unknown };
    return { drawing: nested.drawing, xrefs: nested.xrefs };
  }
  return { drawing: value, xrefs: undefined };
}

function notADrawing(value: unknown, hasDefault: boolean): string | undefined {
  if (!hasDefault) {
    return "The file has no default export. End it with `export default d.build()`";
  }
  if (typeof value === "object" && value !== null) {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.layers) && Array.isArray(v.entities) && typeof v.units === "string") {
      return undefined;
    }
    if (typeof v.build === "function") {
      return "The default export is the builder, not the drawing. Export `d.build()` instead";
    }
  }
  return "The default export must be a Drawing, or a function that returns one";
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
  const load = async (path: string) =>
    (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  const has = (module: Record<string, unknown>, ...names: string[]) =>
    names.every((name) => typeof module[name] === "function");
  const found = (module: unknown, path: string) => ({
    library: module as Library,
    entry: ownEntries.includes(path) ? path : null,
  });

  const own = imported.get(file) ?? [];
  for (const path of own.filter(isLibrary)) {
    const library = await load(path);
    if (has(library, "lint", "toSVG")) return found(library, path);
  }
  for (const path of own.filter((path) => /\.m?[jt]s$/.test(path))) {
    const library = await load(path);
    if (has(library, "createDrawing", "lint", "toSVG", "toDXF")) return found(library, path);
  }

  const all = [...loaded].map((url) => fileURLToPath(url)).filter(isLibrary);
  const named: string[] = [];
  try {
    named.push(createRequire(file).resolve("tsdraft"));
  } catch {
    // The drawing's folder has no tsdraft of its own.
  }
  for (const path of [...(all.length === 1 ? all : []), ...named, ...all]) {
    const library = await load(path);
    if (has(library, "lint", "toSVG")) return found(library, path);
  }
  return found(await import("tsdraft"), fileURLToPath(import.meta.resolve("tsdraft")));
}

const packageNames = new Map<string, string | undefined>();

/** The name in the nearest package.json above a file. */
function packageName(path: string): string | undefined {
  const dir = dirname(path);
  if (packageNames.has(dir)) return packageNames.get(dir);
  let name: string | undefined;
  try {
    name = (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string }).name;
  } catch {
    name = dir === dirname(dir) ? undefined : packageName(dir);
  }
  packageNames.set(dir, name);
  return name;
}

/**
 * Reads the extents from an SVG drawn with no margin, then gives it the margin `toSVG` uses by
 * default, 2% of the larger side, so one render serves both.
 */
function framed(svg: string): { svg: string; min: [number, number]; max: [number, number] } {
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
      if (typeof style?.font === "string") fonts.add(style.font);
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
    Array.isArray(layout?.entities) ? [layout.entities as readonly Entity[]] : [],
  );
}

/** The block an insert places, found as the library that checks the drawing finds it. */
function blockNamed(library: Library, drawing: Drawing, name: unknown): Block | undefined {
  return typeof name === "string" ? library.findBlock?.(drawing, name) : undefined;
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
  if (typeof name !== "string" || blockNamed(library, drawing, name)) return undefined;
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
  const offered: Record<string, unknown> = Object.create(null);
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
      const { drawing: other, xrefs } = givenOf(value) as { drawing: Drawing; xrefs?: GivenXrefs };
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
  const out: Record<string, unknown> = Object.create(null);
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
const SHAPE_FILE_BYTES = 4_000_000;
const SHAPE_BYTES = 64 << 20;

/**
 * The shape files a drawing's linetypes name, by the name a mark gives, each read once from the
 * folder of the drawing's file, where its name is found as the library's `shapeFileKey` finds it.
 * Each is tracked where it is or would be, so `tsdraft dev` builds again when one is copied
 * there or changes. A file not there, or too long, is left out, and `lint` warns of its shapes.
 * Empty for a copy of tsdraft from before shapes.
 */
function shapeFiles(
  library: Library,
  drawing: Drawing,
  file: string,
): { shapes?: Record<string, Uint8Array> } {
  const key = library.shapeFileKey;
  if (typeof key !== "function") return {};
  const names: string[] = [];
  for (const linetype of Array.isArray(drawing.linetypes) ? drawing.linetypes : []) {
    const marks: unknown = (linetype as { marks?: unknown } | undefined)?.marks;
    for (const m of Array.isArray(marks) ? marks : []) {
      const named = (m as { file?: unknown } | undefined)?.file;
      if (typeof m === "object" && m !== null && "shape" in m && typeof named === "string")
        names.push(named);
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
  const shapes: Record<string, Uint8Array> = Object.create(null);
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
          if (size <= SHAPE_FILE_BYTES && total + size <= SHAPE_BYTES) {
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
    if (bytes !== undefined) shapes[name] = bytes;
  }
  return { shapes };
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
): { images: Record<string, Uint8Array> | undefined; diagnostics: BuildDiagnostic[] } {
  if (typeof library.rasterSize !== "function") return { images: undefined, diagnostics: [] };
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
      if (typeof e !== "object" || e === null || e.kind !== "image") continue;
      const { path, pixels } = e as { path?: unknown; pixels?: unknown };
      if (
        typeof path !== "string" ||
        seen.has(path) ||
        isAbsolute(path) ||
        /^[A-Za-z]:/.test(path)
      ) {
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

/**
 * What the pictures are given for the xrefs: each drawing given with no lint error, and with
 * `files`, the files of its images, read from the folder of the xref's file, which `folder`, the
 * folder of the drawing that references it, starts its path from.
 */
function drawnOf(
  given: ReadonlyMap<Xref, Given>,
  folder = "",
  files?: (drawing: Drawing, file: string, xref: string) => Record<string, Uint8Array> | undefined,
): Record<string, unknown> {
  return Object.fromEntries(
    [...given]
      .filter(([, g]) => g.errors.length === 0)
      .map(([xref, g]) => {
        const path = typeof xref.path === "string" ? xref.path.replaceAll("\\", "/") : "";
        const at = isAbsolute(path) ? path : join(folder, path);
        // A path with a drive, which lint refuses, names no folder here.
        const found = path !== "" && !/^[A-Za-z]:/.test(path);
        const images = files && !g.preview && found ? files(g.drawing, at, g.name) : undefined;
        const nested = g.nested.size > 0 ? drawnOf(g.nested, dirname(at), files) : undefined;
        return [
          g.name,
          nested === undefined && images === undefined
            ? g.drawing
            : {
                drawing: g.drawing,
                ...(nested === undefined ? {} : { xrefs: nested }),
                ...(images === undefined ? {} : { images }),
              },
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
 * The field `key` of `value` when it is `value`'s own data. A getter is never run and a proxy
 * never asked, since the export `standard` may be anything.
 */
function ownData(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || types.isProxy(value)) return undefined;
  const field = Object.getOwnPropertyDescriptor(value, key);
  return field !== undefined && "value" in field ? field.value : undefined;
}

/**
 * Each title block of a standard whose border is an xref and that has a `preview`, as the
 * xref's name and the preview. Only own data is read, and anything else gives nothing.
 */
function titleBlockPreviews(standard: unknown): [name: string, preview: Drawing][] {
  try {
    const blocks = ownData(standard, "titleBlocks");
    if (typeof blocks !== "object" || blocks === null) return [];
    return Object.keys(blocks).flatMap((key) => {
      const block = ownData(blocks, key);
      const name = ownData(ownData(block, "xref"), "name");
      const preview = ownData(block, "preview");
      return typeof name === "string" &&
        Array.isArray(ownData(preview, "layers")) &&
        Array.isArray(ownData(preview, "entities")) &&
        typeof ownData(preview, "units") === "string"
        ? [[name, preview as Drawing]]
        : [];
    });
  } catch {
    return [];
  }
}

/** The id, version and hash of the file's export `standard`, when it holds all three. */
function standardSummary(standard: unknown, checked: boolean): StandardSummary | null {
  try {
    const [id, version, hash] = ["id", "version", "hash"].map((key) => ownData(standard, key));
    return typeof id === "string" && typeof version === "string" && typeof hash === "string"
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
  return {
    rule: found.rule,
    severity: found.severity,
    message: `Xref ${chain.map((name) => JSON.stringify(name)).join(" > ")}: ${what} has an error, so it is not drawn. ${found.message}`,
    xref: chain[0]!,
    ...(found.id === undefined ? {} : { id: found.id }),
    ...(found.call === undefined ? {} : { call: found.call }),
  };
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

/** Each dimension among some entities, with what the library the drawing loaded says it reads. */
function dimensionSummaries(
  library: Library,
  drawing: Drawing,
  entities: readonly Entity[] = drawing.entities,
): DimensionSummary[] {
  return entities.flatMap((e, entity): DimensionSummary[] => {
    if (!Object.hasOwn(SUMMARY_KINDS, e.kind)) return [];
    const dimension = e as Extract<Entity, { readonly kind: `${string}-dimension` }>;
    let read: { measurement: number; text: string } | undefined;
    try {
      const style =
        typeof dimension.style === "string"
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

/** Asks `toSVG` for each layer's color by drawing one short line on every layer. */
function swatches(library: Library, drawing: Drawing): Record<string, string> {
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
  const out: Record<string, string> = {};
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
function describe(thrown: unknown, root: string): BuildError {
  if (!(thrown instanceof Error)) {
    return {
      name: "Error",
      message: `The file threw ${typeof thrown === "string" ? thrown : JSON.stringify(thrown)}`,
      code: null,
      ...nowhere,
      stack: "",
    };
  }
  const stack = thrown.stack ?? "";
  const code = (thrown as { code?: unknown }).code;
  // Node reads a .ts file as CommonJS when the project's package.json says so, as `npm init`'s does.
  const commonjs =
    thrown instanceof SyntaxError &&
    thrown.message.startsWith("Cannot use import statement outside a module");
  return {
    name: thrown.name,
    message: commonjs
      ? `${thrown.message}. Set "type": "module" in the project's package.json, or name the file .mts`
      : thrown.message,
    code: typeof code === "string" ? code : null,
    ...locate(thrown, stack, root),
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
