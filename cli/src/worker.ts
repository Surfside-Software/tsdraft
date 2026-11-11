// Runs one drawing file in a child process of its own, so that a crash, a hang or a changed
// import cannot reach the command, and every build imports fresh code. The parent starts this
// process ahead of time and sends it a file to build; it answers once and exits.
import { existsSync, readFileSync } from "node:fs";
import { createRequire, isBuiltin, registerHooks } from "node:module";
import { dirname, isAbsolute, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Diagnostic, Drawing } from "tsdraft";
import type { Box, BuildDiagnostic, BuildError, DrawingSummary, LayerSummary } from "./state.ts";
import { fileVersion } from "./version.ts";

export interface BuildRequest {
  readonly type: "build";
  readonly file: string;
  /** The project folder: files under it, outside node_modules, are the user's code. */
  readonly root: string;
  /** Draws the layers that do not plot too. */
  readonly drawNoPlot?: boolean;
}

/** `file` is sent as each tracked file is loaded, so a build that never answers still names them. */
export type WorkerMessage =
  | { readonly type: "ready"; readonly at: number }
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
  readonly timings: { readonly load?: number; readonly lint?: number; readonly svg?: number };
  readonly drawing: DrawingSummary | null;
  readonly diagnostics: readonly BuildDiagnostic[];
  readonly svg: string | null;
  /** The color `toSVG` draws each layer in, by layer name. */
  readonly swatches: Readonly<Record<string, string>>;
  readonly error: BuildError | null;
}

interface Library {
  readonly lint: (drawing: Drawing) => Diagnostic[];
  readonly toSVG: (drawing: Drawing, options?: { margin?: number; drawNoPlot?: boolean }) => string;
}

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

/** Each module URL the build loaded. */
const loaded = new Set<string>();
/** The files each file imported, by the importer's path. */
const imported = new Map<string, string[]>();
/** Each tracked path the build read, with every version it was read at. */
const read = new Map<string, Set<string | null>>();

/** Notes a version of a path the build depends on, and tells the parent at once. */
function track(path: string, version: string | null): void {
  let versions = read.get(path);
  if (!versions) read.set(path, (versions = new Set()));
  if (versions.has(version)) return;
  versions.add(version);
  process.send!({ type: "file", file: [path, version] } satisfies WorkerMessage);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // A path through a symlink: its version names the target, so pointing it elsewhere counts.
    // A bare import goes through the package's folder in node_modules, often a workspace link.
    const parent = context.parentURL?.startsWith("file:") ? context.parentURL : undefined;
    const asked = !parent
      ? undefined
      : /^(\.{0,2}\/|file:)/.test(specifier)
        ? fileURLToPath(new URL(specifier, parent))
        : packageFolder(specifier, fileURLToPath(parent));
    const version = asked === undefined ? null : fileVersion(asked);
    const result = nextResolve(specifier, context);
    if (parent && result.url.startsWith("file:")) {
      const path = fileURLToPath(result.url);
      if (asked !== undefined && path !== asked && tracked(path)) track(asked, version);
      // Every file a file imports, also through an alias that names no folder to watch.
      const importer = fileURLToPath(parent);
      const list = imported.get(importer);
      if (list) list.push(path);
      else imported.set(importer, [path]);
    }
    return result;
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && !loaded.has(url)) {
      loaded.add(url);
      const path = fileURLToPath(url);
      if (tracked(path)) track(path, fileVersion(path));
    }
    return nextLoad(url, context);
  },
});

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

process.once("message", (message: BuildRequest) => {
  void build(message).then((result) => {
    process.send!({ type: "done", result } satisfies WorkerMessage, () => process.exit(0));
  });
});
process.once("disconnect", () => process.exit(0));
process.send!({ type: "ready", at: now() } satisfies WorkerMessage);

async function build({ file, root, drawNoPlot }: BuildRequest): Promise<WorkerResult> {
  const timings: { load?: number; lint?: number; svg?: number } = {};
  const fail = (error: BuildError, thrown?: unknown): WorkerResult => ({
    ok: false,
    files: [...readFiles(file), ...missingFile(thrown)],
    timings,
    drawing: null,
    diagnostics: drawingErrorDiagnostics(thrown),
    svg: null,
    swatches: {},
    error,
  });

  let t = now();
  let drawing: Drawing;
  try {
    const module = (await import(pathToFileURL(file).href)) as { default?: unknown };
    let value = module.default;
    if (typeof value === "function") value = await (value as () => unknown)();
    const problem = notADrawing(value, "default" in module);
    if (problem) return fail(atExport(file, problem));
    drawing = value as Drawing;
  } catch (thrown) {
    timings.load = now() - t;
    return fail(describe(thrown, root), thrown);
  }
  timings.load = now() - t;

  try {
    const library = await findLibrary(file);
    t = now();
    const diagnostics = library
      .lint(drawing)
      .sort((a, b) => Number(a.severity === "warning") - Number(b.severity === "warning"))
      .map((d) => aboutEntity(library, drawing, d));
    timings.lint = now() - t;
    t = now();
    const { svg, min, max } = framed(
      library.toSVG(drawing, { margin: 0, drawNoPlot: drawNoPlot === true }),
    );
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
          layers: drawing.layers.length,
          entities: drawing.entities.length,
          errors,
          warnings: diagnostics.length - errors,
        },
        layers: layerSummaries(drawing),
      },
      diagnostics,
      svg,
      swatches: swatches(library, drawing),
      error: null,
    };
  } catch (thrown) {
    // The drawing is malformed in a way `lint` or `toSVG` cannot get past.
    return fail(describe(thrown, root), thrown);
  }
}

/** Adds the kind, layer and box of the entity a diagnostic is about. */
function aboutEntity(library: Library, drawing: Drawing, found: Diagnostic): BuildDiagnostic {
  const d = withPath(found);
  const entity = d.entity === undefined ? undefined : drawing.entities[d.entity];
  if (!entity) return d;
  // toSVG works out the box, so it agrees with the drawing's extents and the picture. An entity
  // on a layer that is off, frozen or not plotted still has a box.
  const one = { ...drawing, layers: shownLayers(drawing), entities: [entity] };
  const { min, max } = framed(library.toSVG(one, { margin: 0 }));
  const bounds: Box = { min, max };
  return { ...d, kind: entity.kind, layer: entity.layer, bounds };
}

/** Gives the file of a diagnostic's `call` as a path, as `error.file` is: Node's stack has a URL. */
function withPath(d: Diagnostic): Diagnostic {
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
async function findLibrary(file: string): Promise<Library> {
  const isLibrary = (path: string) =>
    /[\\/]index\.[jt]s$/.test(path) && packageName(path) === "tsdraft";
  const load = async (path: string) =>
    (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  const has = (module: Record<string, unknown>, ...names: string[]) =>
    names.every((name) => typeof module[name] === "function");

  const own = imported.get(file) ?? [];
  for (const path of own.filter(isLibrary)) {
    const library = await load(path);
    if (has(library, "lint", "toSVG")) return library as unknown as Library;
  }
  for (const path of own.filter((path) => /\.m?[jt]s$/.test(path))) {
    const library = await load(path);
    if (has(library, "createDrawing", "lint", "toSVG", "toDXF")) {
      return library as unknown as Library;
    }
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
    if (has(library, "lint", "toSVG")) return library as unknown as Library;
  }
  return (await import("tsdraft")) as Library;
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
