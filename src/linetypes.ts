// Linetypes and lineweights: the ones every drawing has, the ones plans use, and how the
// writers name and number them.
import type { Layer, Lineweight, Linetype, LinetypeMark, MarkOrient } from "./drawing.ts";
import { layerKey } from "./layers.ts";
import {
  givenShapeFiles,
  shapeFileKey,
  shapeReader,
  type ShapeFile,
  type ShapeFiles,
} from "./shapes.ts";

/** Every lineweight the leading CAD app offers, in millimetres, from thinnest to widest. */
export const LINEWEIGHTS: readonly Lineweight[] = [
  0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1,
  1.06, 1.2, 1.4, 1.58, 2, 2.11,
];

// The linetypes plans use most, with the names, descriptions and patterns that the 2025
// release of the leading CAD app loads from its acad.lin, so a drawing looks the same as one
// drafted by hand. The lengths are in drawing units: scale them with the drawing's linetypeScale.

/** Dashes: 0.5 on, 0.25 off. */
export const DASHED: Linetype = {
  name: "DASHED",
  description: "Dashed __ __ __ __ __ __ __ __ __ __ __ __ __ _",
  pattern: [0.5, -0.25],
};

/** Short dashes, half the size of `DASHED`. */
export const HIDDEN: Linetype = {
  name: "HIDDEN",
  description: "Hidden __ __ __ __ __ __ __ __ __ __ __ __ __ _",
  pattern: [0.25, -0.125],
};

/** Long dash, short dash. */
export const CENTER: Linetype = {
  name: "CENTER",
  description: "Center ____ _ ____ _ ____ _ ____ _ ____ _ ____",
  pattern: [1.25, -0.25, 0.25, -0.25],
};

/** Long dash, two short dashes. */
export const PHANTOM: Linetype = {
  name: "PHANTOM",
  description: "Phantom ______  __  __  ______  __  __  ______",
  pattern: [1.25, -0.25, 0.25, -0.25, 0.25, -0.25],
};

/** Dash, dot. */
export const DASHDOT: Linetype = {
  name: "DASHDOT",
  description: "Dash dot __ . __ . __ . __ . __ . __ . __ . __",
  pattern: [0.5, -0.25, 0, -0.25],
};

/** Dots, 0.25 apart. */
export const DOT: Linetype = {
  name: "DOT",
  description: "Dot . . . . . . . . . . . . . . . . . . . . . .",
  pattern: [0, -0.25],
};

/** The linetypes every drawing has, in the spelling the leading CAD app gives them. */
export const BUILT_IN_LINETYPES = ["ByBlock", "ByLayer", "Continuous"] as const;

/** The spelling the leading CAD app gives a built-in linetype, or undefined for any other name. */
export function builtInLinetype(name: string): (typeof BUILT_IN_LINETYPES)[number] | undefined {
  const key = layerKey(name);
  return BUILT_IN_LINETYPES.find((n) => layerKey(n) === key);
}

/** The linetype name a writer gives an entity, or undefined when it draws ByLayer. */
export function entityLinetype(e: { readonly linetype?: string }): string | undefined {
  if (e.linetype === undefined) return undefined;
  return builtInLinetype(e.linetype) === "ByLayer" ? undefined : e.linetype;
}

/** The linetype name a writer gives a layer. */
export function layerLinetype(layer: Layer): string {
  return layer.linetype ?? "Continuous";
}

/** A lineweight as DXF group 370 holds it: hundredths of a millimetre, or -1, -2 or -3. */
export function lineweightCode(value: number | "ByLayer" | "ByBlock" | "Default"): number {
  if (value === "ByLayer") return -1;
  if (value === "ByBlock") return -2;
  if (value === "Default") return -3;
  return Math.round(value * 100);
}

/** The total length of a pattern, as the leading CAD app stores it: the sum of the lengths, unsigned. */
export function patternLength(pattern: readonly number[]): number {
  return pattern.reduce((sum, length) => sum + Math.abs(length), 0);
}

/** The most characters of a linetype file `parseLinetypes` reads. */
export const LINETYPE_FILE_LENGTH = 1_000_000;

/**
 * The linetypes of a linetype file's text, in the format CAD programs read: a linetype starts at a
 * line `*NAME,description`, and the line after it is `A,` and its pattern, each length a dash
 * when positive, a gap when negative and a dot when 0. A text in brackets, `["W",STYLE,S=0.1,
 * R=0,X=-0.05,Y=-0.05]`, or a shape, `[NAME,file.shx,S=0.1]`, is drawn at the end of the length
 * before it, turned by `R=` from the line, `A=` from the X axis or `U=` upright. A `;` starts a
 * comment. A shape is given by its name in its file, and a drawing takes it by its number: with
 * its file in `options.shapes`, by the file's name as `shapeFileKey` finds it, a shape is given
 * its number, found by its name without regard to ASCII case, the first of the name in the file.
 * A shape whose file is not given keeps its name, which the builder refuses.
 *
 * @throws RangeError for a line it cannot read, naming its number, for a shape its given file
 *   lacks or a given file that does not read, for text past `LINETYPE_FILE_LENGTH` characters,
 *   and when two of the files' names are one file's.
 */
export function parseLinetypes(
  text: string,
  options: { readonly shapes?: ShapeFiles } = {},
): Linetype[] {
  if (typeof text !== "string") throw new RangeError("A linetype file's text must be a string");
  if (text.length > LINETYPE_FILE_LENGTH)
    throw new RangeError(`A linetype file is at most ${LINETYPE_FILE_LENGTH} characters`);
  const numberOf = shapeNumbers(
    typeof options === "object" && options !== null ? options.shapes : undefined,
  );
  const out: Linetype[] = [];
  let open: { name: string; description: string; line: number } | undefined;
  const rows = text.split(/\r\n|\r|\n/);
  rows.forEach((row, index) => {
    const line = withoutComment(row).trim();
    if (line === "") return;
    const where = `line ${index + 1} of the linetype file`;
    if (line.startsWith("*")) {
      if (open)
        throw new RangeError(`line ${open.line} of the linetype file: ${open.name} has no pattern`);
      const at = line.indexOf(",");
      const name = (at < 0 ? line.slice(1) : line.slice(1, at)).trim();
      if (name === "") throw new RangeError(`${where}: a linetype needs a name after *`);
      open = { name, description: at < 0 ? "" : line.slice(at + 1).trim(), line: index + 1 };
      return;
    }
    if (!open) throw new RangeError(`${where}: a pattern before any *NAME`);
    const items = splitItems(line, where);
    if ((items[0] ?? "").trim().toUpperCase() !== "A")
      throw new RangeError(`${where}: a pattern starts with A, its alignment`);
    const pattern: number[] = [];
    const marks: LinetypeMark[] = [];
    for (const item of items.slice(1)) {
      const value = item.trim();
      if (value.startsWith("[")) {
        if (pattern.length === 0)
          throw new RangeError(`${where}: a text or shape comes after the length it is drawn at`);
        if (marks.at(-1)?.after === pattern.length - 1)
          throw new RangeError(`${where}: one text or shape at the end of each length`);
        const mark = markOf(value, pattern.length - 1, where);
        marks.push(
          "shape" in mark && typeof mark.shape === "string"
            ? { ...mark, shape: numberOf(mark.file, mark.shape, where) ?? mark.shape }
            : mark,
        );
        continue;
      }
      const length = Number(value);
      if (value === "" || !Number.isFinite(length))
        throw new RangeError(`${where}: ${JSON.stringify(value)} is not a length`);
      pattern.push(length);
    }
    out.push({
      name: open.name,
      description: open.description,
      pattern,
      ...(marks.length === 0 ? {} : { marks }),
    });
    open = undefined;
  });
  if (open)
    throw new RangeError(`line ${open.line} of the linetype file: ${open.name} has no pattern`);
  return out;
}

/**
 * The number of a shape by its name in a file of `files`, or undefined when the file is not
 * given. Each file is read once, when first asked for.
 */
function shapeNumbers(
  files: ShapeFiles | undefined,
): (file: string, name: string, where: string) => number | undefined {
  const given = givenShapeFiles(files);
  // The files share one budget, as the plot's do, and the same bytes under many names are read once.
  const read = shapeReader();
  const fold = (name: string) => name.replace(/[a-z]/g, (c) => c.toUpperCase());
  const named = new Map<string, Map<string, number>>();
  // Each file read has one table of its names, however many names give the file.
  const tables = new Map<ShapeFile, Map<string, number>>();
  return (file, name, where) => {
    const key = shapeFileKey(file);
    if (!given.has(key)) return undefined;
    let names = named.get(key);
    if (names === undefined) {
      const shapes = read(given.get(key));
      if (shapes instanceof RangeError)
        throw new RangeError(`${where}: the shape file ${file} does not read: ${shapes.message}`);
      names = tables.get(shapes);
      if (names === undefined) {
        names = new Map();
        for (const shape of shapes.shapes)
          if (shape.name !== "" && !names.has(fold(shape.name)))
            names.set(fold(shape.name), shape.number);
        tables.set(shapes, names);
      }
      named.set(key, names);
    }
    const number = names.get(fold(name));
    if (number === undefined)
      throw new RangeError(`${where}: the shape file ${file} has no shape ${name}`);
    return number;
  };
}

/** A line up to its comment: a `;` outside the quotes of a text. */
function withoutComment(row: string): string {
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '"') quoted = !quoted;
    else if (row[i] === ";" && !quoted) return row.slice(0, i);
  }
  return row;
}

/** The items of a pattern, split at each comma outside a bracket and a text's quotes. */
function splitItems(line: string, where: string): string[] {
  const items: string[] = [];
  let [start, depth, quoted] = [0, 0, false];
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (c === "," && depth === 0) {
      items.push(line.slice(start, i));
      start = i + 1;
    }
    if (depth < 0 || depth > 1) throw new RangeError(`${where}: brackets that do not pair`);
  }
  if (quoted || depth !== 0) throw new RangeError(`${where}: a text or a bracket left open`);
  items.push(line.slice(start));
  return items;
}

/** An angle as a linetype file gives it: degrees, or with `r` radians or `g` grads. */
function angleOf(value: string, where: string): number {
  const v = value.trim();
  const unit = v.slice(-1).toLowerCase();
  const n = Number(/[dgr]/.test(unit) ? v.slice(0, -1) : v);
  if (v === "" || !Number.isFinite(n))
    throw new RangeError(`${where}: ${JSON.stringify(v)} is not an angle`);
  return unit === "r" ? (n * 180) / Math.PI : unit === "g" ? n * 0.9 : n;
}

/** A text or a shape of a pattern, from its brackets, drawn at the end of the length `after`. */
function markOf(item: string, after: number, where: string): LinetypeMark {
  if (!item.endsWith("]"))
    throw new RangeError(`${where}: ${JSON.stringify(item)} does not end in ]`);
  const fields = splitItems(item.slice(1, -1), where).map((f) => f.trim());
  const [first = "", second = "", ...options] = fields;
  const text = first.startsWith('"') && first.endsWith('"') && first.length >= 2;
  if (!text && first === "")
    throw new RangeError(`${where}: a shape needs its name, a text its quotes`);
  let size = 1;
  let rotation = 0;
  let orient: MarkOrient = "relative";
  let [x, y] = [0, 0];
  for (const option of options) {
    const at = option.indexOf("=");
    const key = option.slice(0, at).trim().toUpperCase();
    const value = option.slice(at + 1);
    const number = (): number => {
      const n = Number(value.trim());
      if (value.trim() === "" || !Number.isFinite(n))
        throw new RangeError(`${where}: ${key}= takes a number, not ${JSON.stringify(value)}`);
      return n;
    };
    if (at < 0) throw new RangeError(`${where}: ${JSON.stringify(option)} is not KEY=value`);
    else if (key === "S") size = number();
    else if (key === "X") x = number();
    else if (key === "Y") y = number();
    else if (key === "R" || key === "A" || key === "U") {
      rotation = angleOf(value, where);
      orient = key === "R" ? "relative" : key === "A" ? "absolute" : "upright";
    } else
      throw new RangeError(`${where}: ${JSON.stringify(key)} is not one of S, R, A, U, X and Y`);
  }
  const common = {
    after,
    ...(rotation === 0 ? {} : { rotation }),
    ...(orient === "relative" ? {} : { orient }),
    ...(x === 0 && y === 0 ? {} : { offset: [x, y] as const }),
  };
  if (text)
    return {
      ...common,
      text: first.slice(1, -1),
      ...(second === "" ? {} : { style: second }),
      height: size,
    };
  if (second === "") throw new RangeError(`${where}: a shape needs its shape file`);
  return { ...common, shape: first, file: second, scale: size };
}
