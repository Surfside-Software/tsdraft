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
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire, isBuiltin, registerHooks } from "node:module";
import { dirname, isAbsolute, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type {
  AlignedDimension,
  Block,
  Diagnostic,
  DimensionPicture,
  DimensionStyle,
  Drawing,
  Entity,
  Layout,
  LinearDimension,
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

interface Library {
  readonly lint: (drawing: Drawing) => Diagnostic[];
  readonly toSVG: (
    drawing: Drawing,
    options?: {
      margin?: number;
      drawNoPlot?: boolean;
      xrefs?: Readonly<Record<string, Drawing>>;
      layout?: string;
      view?: readonly [number, number, number, number];
    },
  ) => string;
  /** What is wrong with the text as it plots. A copy of tsdraft from before it has none. */
  readonly inspectText?: (
    drawing: Drawing,
    options?: { drawNoPlot?: boolean; xrefs?: Readonly<Record<string, Drawing>> },
  ) => TextWarning[];
  /** What a viewport shows, and the papers. A copy of tsdraft from before layouts has neither. */
  readonly viewportView?: (viewport: Viewport, paperUnits: PaperUnit, units: Units) => ViewportView;
  readonly PAPERS?: Readonly<Record<string, PaperInfo>>;
  /** The fonts a text style may have. A copy of tsdraft from before text styles has none. */
  readonly FONTS?: Readonly<Record<string, { readonly family: string }>>;
  /** The block an insert of a name places. A copy of tsdraft from before blocks has none. */
  readonly findBlock?: (drawing: Drawing, name: string) => Block | undefined;
  /** The xref an insert of a name places. A copy of tsdraft from before xrefs has none. */
  readonly findXref?: (drawing: Drawing, name: string) => Xref | undefined;
  /** A dimension's style and what it draws. A copy of tsdraft from before dimensions has neither. */
  readonly findDimensionStyle?: (drawing: Drawing, name: string) => DimensionStyle | undefined;
  readonly dimensionPicture?: (
    dimension: LinearDimension | AlignedDimension,
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
  const timings: { load?: number; lint?: number; inspect?: number; svg?: number } = {};
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
  let referenced: Readonly<Record<string, Drawing>>;
  try {
    const module = (await import(pathToFileURL(file).href)) as {
      default?: unknown;
      xrefs?: unknown;
    };
    let value = module.default;
    if (typeof value === "function") value = await (value as () => unknown)();
    const problem = notADrawing(value, "default" in module) ?? notXrefs(module.xrefs);
    if (problem) return fail(atExport(file, problem));
    drawing = value as Drawing;
    referenced = (module.xrefs ?? {}) as Readonly<Record<string, Drawing>>;
  } catch (thrown) {
    timings.load = now() - t;
    return fail(describe(thrown, root), thrown);
  }
  timings.load = now() - t;

  try {
    const { library, entry } = await findLibrary(file);
    t = now();
    const found = library.lint(drawing);
    const size = (list: unknown): number => (Array.isArray(list) ? list.length : 0);
    const errorsFirst = (a: Diagnostic, b: Diagnostic) =>
      Number(a.severity === "warning") - Number(b.severity === "warning");
    /** The build's answer, with `shown` drawn in place of the drawing when items are left out. */
    const report = (shown: Drawing, omitted: readonly string[]): WorkerResult => {
      const given = givenDrawings(library, shown, referenced);
      const drawn = Object.fromEntries(
        [...given.values()].filter((g) => g.errors.length === 0).map((g) => [g.name, g.drawing]),
      );
      const linted = [
        ...found,
        ...[...given].flatMap(([xref, g]) => g.errors.map((d) => inGiven(xref, d))),
      ]
        .sort(errorsFirst)
        .map((d) => aboutEntity(library, shown, drawn, d));
      timings.lint ??= now() - t;
      t = now();
      const diagnostics = [...linted, ...textWarnings(library, shown, drawn, drawNoPlot === true)];
      timings.inspect = now() - t;
      t = now();
      const fontsOf = fontsIn(library, [shown, ...Object.values(drawn)]);
      const { svg, min, max } = framed(
        library.toSVG(shown, { margin: 0, drawNoPlot: drawNoPlot === true, xrefs: drawn }),
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
                xrefs: drawn,
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
          xrefs: drawn,
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
        const diagnostics = [...found].sort(errorsFirst).map(withPath);
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
  referenced: Readonly<Record<string, Drawing>>,
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
  referenced: Readonly<Record<string, Drawing>>,
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
 * a drawing for each xref the pictures are to draw, by the xref's name.
 */
function notXrefs(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const shape =
    "The export `xrefs` must be an object that gives a Drawing for an xref's name, such as `export const xrefs = { BASE: base }`";
  if (typeof value !== "object" || value === null || Array.isArray(value)) return shape;
  for (const [name, drawing] of Object.entries(value)) {
    if (notADrawing(drawing, true)) return `${shape}. Its ${JSON.stringify(name)} is not a Drawing`;
  }
  return undefined;
}

/** Says what is wrong with a default export that is not a `Drawing`, or returns undefined. */
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

/** A drawing the file gives for an xref, under the name it gives it by. */
interface Given {
  readonly name: string;
  readonly drawing: Drawing;
  /** The errors `lint` finds in it. A drawing with any is not drawn. */
  readonly errors: readonly Diagnostic[];
}

/** The drawing given for each xref of the drawing, checked by the library that checks the drawing. */
function givenDrawings(
  library: Library,
  drawing: Drawing,
  referenced: Readonly<Record<string, Drawing>>,
): Map<Xref, Given> {
  const given = new Map<Xref, Given>();
  for (const [name, other] of Object.entries(referenced)) {
    const xref = xrefNamed(library, drawing, name);
    if (!xref || given.has(xref)) continue;
    const errors = library.lint(other).filter((d) => d.severity === "error");
    given.set(xref, { name, drawing: other, errors });
  }
  return given;
}

/**
 * A problem in the drawing given for an xref, as a problem of the xref. It keeps the rule, the
 * id and the call, and leaves out the entity's index, which counts another drawing's entities.
 */
function inGiven(xref: Xref, found: Diagnostic): Diagnostic {
  return {
    rule: found.rule,
    severity: found.severity,
    message: `Xref ${JSON.stringify(xref.name)}: the drawing given for it has an error, so it is not drawn. ${found.message}`,
    xref: xref.name,
    ...(found.id === undefined ? {} : { id: found.id }),
    ...(found.call === undefined ? {} : { call: found.call }),
  };
}

function xrefSummaries(
  library: Library,
  drawing: Drawing,
  given: ReadonlyMap<Xref, Given>,
): XrefSummary[] {
  const placed = new Map<unknown, number>();
  for (const entities of [
    drawing.entities,
    ...(drawing.blocks ?? []).map((b) => b.entities),
    ...sheetEntities(drawing),
  ]) {
    for (const e of entities) {
      if (e.kind !== "insert") continue;
      const xref = xrefNamed(library, drawing, e.block);
      placed.set(xref, (placed.get(xref) ?? 0) + 1);
    }
  }
  return (drawing.xrefs ?? []).map((x) => ({
    name: x.name,
    path: x.path,
    inserts: placed.get(x) ?? 0,
    shown: given.get(x)?.errors.length === 0,
    units: given.get(x)?.drawing.units ?? null,
  }));
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

/** Each dimension among some entities, with what the library the drawing loaded says it reads. */
function dimensionSummaries(
  library: Library,
  drawing: Drawing,
  entities: readonly Entity[] = drawing.entities,
): DimensionSummary[] {
  return entities.flatMap((e, entity): DimensionSummary[] => {
    if (e.kind !== "linear-dimension" && e.kind !== "aligned-dimension") return [];
    let read: { measurement: number; text: string } | undefined;
    try {
      const style =
        typeof e.style === "string" ? library.findDimensionStyle?.(drawing, e.style) : undefined;
      const picture = style && library.dimensionPicture?.(e, style);
      if (picture && Number.isFinite(picture.measurement)) {
        read = { measurement: picture.measurement, text: picture.label.value };
      }
    } catch {
      // A dimension or a style that breaks a rule, which the diagnostics say.
    }
    return [
      {
        entity,
        id: e.id ?? null,
        layer: e.layer,
        kind: e.kind === "linear-dimension" ? "linear" : "aligned",
        style: e.style,
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
