// Finds the packages that read drawing files. They come from one place: the project whose
// tsdraft is the one running, or `--reader`. No package.json is read but those on the walk up to
// the project, the project's dependencies', and the one `--reader` names.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The folder of the package this command belongs to, by its real path. */
export const OWN_FOLDER = realpathSync.native(fileURLToPath(new URL("../..", import.meta.url)));

/** A package that reads drawing files, as its package.json names them. */
export interface ReaderPackage {
  readonly name: string;
  readonly version: string;
  /** Its folder, by its real path. */
  readonly folder: string;
  /** The module that reads each extension, such as `.dwg`, by its real path. */
  readonly modules: Readonly<Record<string, string>>;
}

export interface Readers {
  /** The project the readers come from, by its real path, or `null` when there is none. */
  readonly project: string | null;
  /** Each dependency of the project that names a reader, or the one package `--reader` named. */
  readonly packages: readonly ReaderPackage[];
}

/** Why the command will not pick a reader. Its message says what to do. */
export class ReaderRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReaderRefusal";
  }
}

type Manifest = Record<string, unknown>;

function manifest(folder: string): Manifest | null {
  try {
    const value: unknown = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Manifest)
      : null;
  } catch {
    return null;
  }
}

const names = (manifest: Manifest, field: string): string[] => {
  const value = manifest[field];
  return typeof value === "object" && value !== null ? Object.keys(value) : [];
};

const dependencies = (manifest: Manifest): string[] => [
  ...new Set([...names(manifest, "dependencies"), ...names(manifest, "devDependencies")]),
];

/** A package name that stays one folder, or a scope and one folder, under `node_modules`. */
const PACKAGE_NAME = /^(?:@[\w~-][\w.~-]*\/)?[\w~-][\w.~-]*$/;

/**
 * The folder Node's lookup of `node_modules` finds a package in, starting at `from` and going
 * up, as found and not by its real path, or `null`.
 */
export function lookup(from: string, name: string): string | null {
  if (!PACKAGE_NAME.test(name)) return null;
  for (let dir = from; ; dir = dirname(dir)) {
    if (basename(dir) !== "node_modules") {
      const found = join(dir, "node_modules", name);
      if (existsSync(found)) return found;
    }
    if (dirname(dir) === dir) return null;
  }
}

const real = (path: string): string => {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
};

const inside = (path: string, folder: string): boolean => {
  const rest = relative(folder, path);
  return rest === "" || (rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest));
};

/**
 * The project: the nearest folder from `cwd` upward whose package.json lists `tsdraft` in
 * `dependencies` or `devDependencies`, and from which `tsdraft` resolves to this very package.
 * A folder that lists it and resolves another copy, or none, stops the walk with no project. A
 * folder inside an input path is passed over unread.
 */
export function findProject(cwd: string, inputs: readonly string[]): string | null {
  const within = inputs.map((input) => real(resolve(cwd, input)));
  for (let dir = real(cwd); ; dir = dirname(dir)) {
    const listed =
      !within.some((input) => inside(dir, input)) &&
      dependencies(manifest(dir) ?? {}).includes("tsdraft");
    if (listed) {
      const found = lookup(dir, "tsdraft");
      return found !== null && real(found) === OWN_FOLDER ? dir : null;
    }
    if (dirname(dir) === dir) return null;
  }
}

/** The package in a folder, when its package.json names a reader whose module is inside it. */
function readerPackage(folder: string): ReaderPackage | null {
  const found = manifest(folder);
  const readers = (found?.["tsdraft"] as { readers?: unknown } | undefined)?.readers;
  if (!found || typeof readers !== "object" || readers === null) return null;
  const modules: Record<string, string> = {};
  for (const [extension, path] of Object.entries(readers)) {
    if (!extension.startsWith(".") || typeof path !== "string" || isAbsolute(path)) continue;
    const module = real(resolve(folder, path));
    if (module !== folder && inside(module, folder)) modules[extension.toLowerCase()] = module;
  }
  if (Object.keys(modules).length === 0) return null;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return { name: text(found["name"]), version: text(found["version"]), folder, modules };
}

/**
 * The readers for a run of the command in `cwd` on `inputs`: the dependencies of the project
 * that name a reader, or, with `reader`, that one package alone. `reader` is a package resolved
 * from the project, or a path to a package's folder. Throws a `ReaderRefusal` for a `reader`
 * that cannot be found or names no reader.
 */
export function findReaders(options: {
  readonly cwd: string;
  readonly inputs: readonly string[];
  readonly reader?: string | undefined;
}): Readers {
  const { cwd, inputs, reader } = options;
  const project = findProject(cwd, inputs);
  if (reader !== undefined) {
    const path = reader.startsWith(".") || isAbsolute(reader);
    const folder = path
      ? resolve(cwd, reader)
      : project === null
        ? undefined
        : lookup(project, reader);
    if (folder === undefined) {
      throw new ReaderRefusal(
        `--reader ${reader}: a package name is looked up in the project, and no project here ` +
          `has this tsdraft installed. Give the path to the reader's folder instead`,
      );
    }
    if (folder === null || !existsSync(folder)) {
      throw new ReaderRefusal(`--reader ${reader}: no such package`);
    }
    const found = readerPackage(real(folder));
    if (!found) {
      throw new ReaderRefusal(
        `--reader ${reader}: its package.json names no reader, as ` +
          `"tsdraft": { "readers": { ".dwg": "./dist/read.js" } }`,
      );
    }
    return { project, packages: [found] };
  }
  if (project === null) return { project, packages: [] };
  // A dependency that resolves among the input paths is a file of the run, not a reader.
  const within = inputs.map((input) => real(resolve(cwd, input)));
  const packages: ReaderPackage[] = [];
  for (const name of dependencies(manifest(project) ?? {})) {
    const found = name === "tsdraft" ? null : lookup(project, name);
    const folder = found === null ? null : real(found);
    if (folder === null || within.some((input) => inside(folder, input))) continue;
    const reader = readerPackage(folder);
    if (reader) packages.push(reader);
  }
  return { project, packages };
}

/**
 * The package that reads files of an extension, such as `.dwg`, or `null` when none does.
 * Throws a `ReaderRefusal` that names them when two or more do. For `.dxf` it is `null`: the
 * core reads DXF, with no reader.
 */
export function readerFor(readers: Readers, extension: string): ReaderPackage | null {
  const key = extension.toLowerCase();
  if (key === ".dxf") return null;
  const found = readers.packages.filter((reader) => key in reader.modules);
  if (found.length > 1) {
    throw new ReaderRefusal(
      `${found.length} packages read ${key} files: ${found.map((p) => p.name).join(", ")}. ` +
        `Pick one with --reader <package>`,
    );
  }
  return found[0] ?? null;
}
