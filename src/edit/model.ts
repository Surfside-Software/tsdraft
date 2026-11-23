// The edit of a firm's drawing: the file it names by path and hash, and what it changes. An
// `Edit` round-trips through JSON as a `Drawing` does, so a process of its own, or a service,
// can take one with the file's bytes.
import type { Drawing, Entity, Point, Units } from "../drawing.ts";
import { isFunction, isRecord, isString } from "../guards.ts";
import type { DrawingRead } from "../read/model.ts";
import type { Standard } from "../standard/document.ts";

/** The version of the `Edit` format. Format 0 carries no promise of stability. */
export const EDIT_FORMAT = 0;

export interface Edit {
  readonly format: typeof EDIT_FORMAT;
  /** The path of the file, from the edit file. */
  readonly file: string;
  /** The SHA-256 of the bytes the edit was planned on, as `DrawingRead.sha256` gives it. */
  readonly sha256: string;
  /** What scopes the edit's marks: an id's characters, 1 to 64. */
  readonly name: string;
  /** The units of a file whose `$INSUNITS` is 0. Refused for any other. */
  readonly units?: Units;
  /** The sheets that show a model file through an xref, by their paths from the edit file. */
  readonly sheets?: readonly string[];
  readonly statements: readonly EditStatement[];
  readonly additions?: EditAdditions;
}

export type EditStatement =
  | { readonly kind: "erase"; readonly handles: readonly string[] }
  | { readonly kind: "move"; readonly handles: readonly string[]; readonly transform: Transform }
  | { readonly kind: "change"; readonly handle: string; readonly changes: EntityChanges }
  | { readonly kind: "layer"; readonly name: string; readonly changes: LayerChanges }
  | { readonly kind: "viewport"; readonly handle: string; readonly changes: ViewportChanges };

/** Scale and turn about `about`, then move by `by`. */
export interface Transform {
  readonly by?: Point;
  readonly about?: Point;
  /** Degrees counterclockwise. */
  readonly rotate?: number;
  readonly scale?: number;
}

export interface EntityChanges {
  readonly move?: Transform;
  readonly text?: TextChange;
  /** A text's or an attribute's height, and paragraph text's height and the width it wraps at. */
  readonly height?: number;
  readonly width?: number;
  /** An insert's attributes, by tag. */
  readonly attributes?: Readonly<Record<string, TextChange>>;
  readonly layer?: string;
  readonly color?: number;
  readonly trueColor?: number;
  readonly linetype?: string;
  readonly lineweight?: number | "ByLayer" | "ByBlock" | "Default";
  readonly linetypeScale?: number;
}

/** The whole value, with its codes, or the first and only place `from` reads, made `to`. */
export type TextChange = string | { readonly replace: readonly [from: string, to: string] };

export interface LayerChanges {
  readonly on?: boolean;
  readonly frozen?: boolean;
  readonly locked?: boolean;
  readonly plot?: boolean;
  readonly color?: number;
  readonly trueColor?: number;
  readonly linetype?: string;
  readonly lineweight?: number | "Default";
}

export interface ViewportChanges {
  readonly center?: Point;
  /** Paper units to drawing units, as a view's ratio. */
  readonly ratio?: number;
  /** Degrees counterclockwise. */
  readonly twist?: number;
  readonly on?: boolean;
  /** Layers frozen in the viewport: to add, and to take out. */
  readonly freeze?: readonly string[];
  readonly thaw?: readonly string[];
}

export interface EditAdditions {
  readonly model: readonly Entity[];
  readonly layouts: Readonly<Record<string, readonly Entity[]>>;
  /** What the additions use that the file lacks: layers, linetypes, styles, blocks, images. */
  readonly definitions: EditDefinitions;
}

export type EditDefinitions = Partial<
  Pick<
    Drawing,
    | "layers"
    | "linetypes"
    | "textStyles"
    | "blocks"
    | "dimensionStyles"
    | "leaderStyles"
    | "tableStyles"
    | "patterns"
  >
>;

/** What an edit file states before its edit is built: the file, and what judges its additions. */
export interface EditSource {
  readonly file: string;
  readonly sha256: string;
  readonly name: string;
  readonly standard?: Standard;
  readonly units?: Units;
  readonly sheets?: readonly string[];
}

/**
 * The builder an edit file's function is given. Each of its methods makes one statement; this
 * version of tsdraft has none yet, so an edit copies the file as it is.
 */
export interface EditBuilder {}

/** What `editDrawing` returns, which the command recognizes as an edit file's default export. */
export interface EditFile {
  readonly source: EditSource;
  /** The edit, given the file's read, which the function is handed when it first reads it. */
  build(read: DrawingRead | (() => DrawingRead)): Edit;
}

/** Thrown by a writer for an edit it cannot make, naming the statement where there is one. */
export class EditError extends Error {
  /** The place of the statement in `statements`, where one is at fault. */
  readonly statement: number | undefined;
  constructor(message: string, statement?: number) {
    super(message);
    this.name = "EditError";
    this.statement = statement;
  }
}

/**
 * An edit of a firm's file: `source` names the file, by its path from the edit file and the
 * SHA-256 of the bytes it was planned on, and `edit` states what changes. `read` is the file's
 * read with geometry, read only when the function first uses it.
 */
export function editDrawing(
  source: EditSource,
  edit: (e: EditBuilder, read: DrawingRead) => void = () => {},
): EditFile {
  return {
    source,
    build(read) {
      const statements: EditStatement[] = [];
      edit({}, isFunction(read) ? lazy(read) : read);

      return {
        format: EDIT_FORMAT,
        file: source.file,
        sha256: source.sha256.toLowerCase(),
        name: source.name,
        ...(source.units !== undefined && { units: source.units }),
        ...(source.sheets !== undefined && { sheets: [...source.sheets] }),
        statements,
      };
    },
  };
}

/** A read that is loaded when one of its fields is first asked for. */
function lazy(load: () => DrawingRead): DrawingRead {
  let read: DrawingRead | undefined;
  const loaded = (): DrawingRead => (read ??= load());

  // SAFETY: the proxy has no field of its own; each it is asked for comes from the loaded read.
  return new Proxy({} as DrawingRead, {
    // SAFETY: a proxy is asked for any key; indexing reads it from the read as `Reflect.get`
    // would, and gives undefined for a key the read lacks.
    get: (_, key) => loaded()[key as keyof DrawingRead],
    has: (_, key) => Reflect.has(loaded(), key),
    ownKeys: () => Reflect.ownKeys(loaded()),
    getOwnPropertyDescriptor: (_, key) => {
      const d = Reflect.getOwnPropertyDescriptor(loaded(), key);

      return d && { ...d, configurable: true };
    },
  });
}

/** The most statements, handles in all, sheets and additions' keys an edit may hold. */
export const EDIT_LIMITS = {
  statements: 100_000,
  handles: 1_000_000,
  sheets: 1_000,
  /** The most layouts and kinds of definition additions name. */
  keys: 10_000,
} as const;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SHA = /^[0-9a-f]{64}$/;
const HANDLE = /^[0-9A-Fa-f]{1,16}$/;
const UNITS: ReadonlySet<string> = new Set(["in", "ft", "mm", "cm", "m"]);
const KINDS: ReadonlySet<string> = new Set(["erase", "move", "change", "layer", "viewport"]);

/** True when each item of a list passes `test`, read by index and never by its methods. */
function everyOf(list: readonly unknown[], test: (item: unknown) => boolean): boolean {
  for (let i = 0; i < list.length; i++) if (!test(list[i])) return false;

  return true;
}

/** A path an edit names: 1 to 4096 characters. */
function isPath(value: unknown): value is string {
  return isString(value) && value !== "" && value.length <= 4096;
}

/** A handle an edit names: 1 to 16 hexadecimal digits. */
function isHandle(value: unknown): value is string {
  return isString(value) && HANDLE.test(value);
}

/**
 * What is wrong with a value meant as an `Edit`, as plain data from JSON: empty when nothing is.
 * It checks the fields this version of tsdraft makes edits of and the shape of each statement,
 * and stays bounded on any value: a list is paid for before it is walked.
 */
export function checkEdit(value: unknown): string[] {
  const problems: string[] = [];

  if (!isRecord(value)) return ["the edit is not an object"];

  if (value["format"] !== EDIT_FORMAT) problems.push(`format is not ${EDIT_FORMAT}`);

  if (!isPath(value["file"])) problems.push("file is not a path");
  const sha = value["sha256"];

  if (!isString(sha) || !SHA.test(sha))
    problems.push("sha256 is not 64 lower-case hexadecimal digits");
  const name = value["name"];

  if (!isString(name) || !ID.test(name))
    problems.push("name is not 1 to 64 letters, digits, - and _");
  const units = value["units"];

  if (units !== undefined && !(isString(units) && UNITS.has(units)))
    problems.push("units is not in, ft, mm, cm or m");
  const sheets = value["sheets"];

  if (sheets !== undefined) {
    if (!Array.isArray(sheets) || sheets.length > EDIT_LIMITS.sheets)
      problems.push(`sheets is not a list of at most ${EDIT_LIMITS.sheets} paths`);
    else if (!everyOf(sheets, isPath)) problems.push("a sheet is not a path");
  }

  const statements = value["statements"];

  if (!Array.isArray(statements) || statements.length > EDIT_LIMITS.statements) {
    problems.push(`statements is not a list of at most ${EDIT_LIMITS.statements}`);
  } else {
    let handles = 0;

    for (let i = 0; i < statements.length && problems.length < 100; i++) {
      const s: unknown = statements[i];

      const kind = isRecord(s) ? s["kind"] : undefined;

      if (!isRecord(s) || !isString(kind) || !KINDS.has(kind)) {
        problems.push(`statement ${i} is not of a kind an edit states`);
        continue;
      }

      const list = s["handles"];

      if (kind === "erase" || kind === "move") {
        if (!Array.isArray(list) || (handles += list.length) > EDIT_LIMITS.handles) {
          problems.push(`statement ${i}'s handles are not a list within the edit's limit`);
          continue;
        }

        if (!everyOf(list, isHandle))
          problems.push(`statement ${i} names a handle that is not 1 to 16 hexadecimal digits`);
      } else if (kind === "layer") {
        const layer = s["name"];

        if (!isString(layer) || layer === "") problems.push(`statement ${i} names no layer`);
      } else if (!isHandle(s["handle"])) {
        problems.push(`statement ${i} names a handle that is not 1 to 16 hexadecimal digits`);
      }
    }
  }

  const additions = value["additions"];

  if (additions !== undefined) {
    // Each field is read once, in order, and none after the first that is wrong.
    const given = isRecord(additions) ? additions : undefined;
    const layouts = given && Array.isArray(given["model"]) ? given["layouts"] : undefined;
    const definitions = given && isRecord(layouts) ? given["definitions"] : undefined;

    if (!isRecord(layouts)) problems.push("additions is not { model, layouts, definitions }");
    else if (!isRecord(definitions)) problems.push("additions has no definitions");
    else {
      const kinds = [
        { what: "the additions of the layout", fields: layouts, may: false },
        { what: "the definitions'", fields: definitions, may: true },
      ];

      for (const { what, fields, may } of kinds) {
        let n = 0;

        for (const key in fields) {
          if (++n > EDIT_LIMITS.keys) {
            problems.push(`${what} holds more than ${EDIT_LIMITS.keys} keys`);
            break;
          }

          const list = fields[key];

          if (!Array.isArray(list) && !(may && list === undefined))
            problems.push(`${what} ${JSON.stringify(key.slice(0, 64))} is not a list`);
        }
      }
    }
  }

  return problems;
}

/** True when an edit adds nothing. */
export function addsNothing(edit: Edit): boolean {
  const a = edit.additions;

  if (a === undefined) return true;

  if (a.model.length > 0) return false;

  for (const key in a.layouts) if ((a.layouts[key]?.length ?? 0) > 0) return false;

  // Every enumerable list, inherited ones too, as `checkEdit` walks them.
  const definitions: Readonly<Record<string, readonly object[] | undefined>> = a.definitions;

  for (const key in definitions) if ((definitions[key]?.length ?? 0) > 0) return false;

  return true;
}

/**
 * What every writer checks before it reads the bytes: the edit's shape, and the statements and
 * additions this version makes. Throws an `EditError`.
 */
export function editToMake(edit: unknown): Edit {
  const problems = checkEdit(edit);

  if (problems.length > 0) throw new EditError(`The edit is malformed: ${problems.join("; ")}`);
  // SAFETY: `checkEdit` found nothing wrong, so the value holds each field of an `Edit`.
  const made = edit as Edit;

  if (made.statements.length > 0)
    throw new EditError(
      `This version of tsdraft makes no ${made.statements[0]!.kind} statement yet`,
      0,
    );

  if (!addsNothing(made)) throw new EditError("This version of tsdraft makes no addition yet");

  return made;
}
