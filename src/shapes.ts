// Shape files: the compiled file of shapes a linetype draws along its line, read into outlines.
import type { Point } from "./drawing.ts";

/** One pen-down run of a shape: its points, and the bulge of each side as a polyline gives it. */
export interface ShapeOutline {
  readonly points: readonly Point[];
  /** The bulge of the side from each point to the next, as `Polyline.bulges`. Left out when none. */
  readonly bulges?: readonly number[];
}

/** A shape of a shape file, in the file's own units, from where its pen starts at [0, 0]. */
export interface ShapeDefinition {
  readonly number: number;
  /** Its name, or "" when the file gives none. */
  readonly name: string;
  readonly outlines: readonly ShapeOutline[];
  /** Where its pen is left. */
  readonly end: Point;
}

/** A shape file's shapes, in the file's order. */
export interface ShapeFile {
  readonly shapes: readonly ShapeDefinition[];
}

/** The bytes of each shape file the drawing's linetypes name, by the file's name. */
export type ShapeFiles = Readonly<Record<string, Uint8Array>>;

/**
 * The key a shape file is found by, as the leading CAD app finds it: its name without regard to
 * ASCII case, with or without `.shx`.
 */
export function shapeFileKey(file: string): string {
  return file.replace(/[A-Z]/g, (c) => c.toLowerCase()).replace(/\.shx$/, "");
}

/** The most bytes `parseShapes` reads. */
export const SHAPE_FILE_LENGTH = 4_000_000;

/** The most points `parseShapes` makes of a file, all its shapes with their subshapes drawn. */
export const SHAPE_POINTS = 500_000;

/**
 * The most codes `parseShapes` runs of a file, each code of a subshape again each time it is
 * drawn, so a shape that draws a shape many times over is bounded too.
 */
export const SHAPE_STEPS = 5_000_000;

/** What reading shape files may still spend. */
export interface Budget {
  points: number;
  steps: number;
}

export const budgetOf = (): Budget => ({ points: SHAPE_POINTS, steps: SHAPE_STEPS });

/** How deep a shape may draw a shape that draws a shape. */
const SUBSHAPES = 16;

/** How many places a shape may push before it pops one. */
const STACK = 4;

/** The furthest a shape may move its pen, and the largest and smallest its scale may grow. */
const REACH = 1e9;
const SCALE_LIMIT = 1e9;

const HEADER = /^[A-Za-z]+-86 ([a-z]+) (\d+\.\d+)\r\n\x1a/;

/** The 16 directions of a vector, each as a step of one along the longer of its two axes. */
const DIRECTIONS: readonly Point[] = [
  [1, 0],
  [1, 0.5],
  [1, 1],
  [0.5, 1],
  [0, 1],
  [-0.5, 1],
  [-1, 1],
  [-1, 0.5],
  [-1, 0],
  [-1, -0.5],
  [-1, -1],
  [-0.5, -1],
  [0, -1],
  [0.5, -1],
  [1, -1],
  [1, -0.5],
];

const OCTANT = Math.PI / 4;

/**
 * Reads a compiled shape file (`.shx`) of shapes, such as the one a firm's complex linetypes
 * name, into each shape's outlines: its lines, and its arcs as bulges, as the leading CAD app
 * draws them, with each shape it draws inside it drawn in place. A pen-down move of no length
 * draws nothing. Shape 0 of a font, which holds the font's sizes and no outline, is left out.
 *
 * @throws RangeError when the bytes are not a shape file, a font of the `unifont` or `bigfont`
 *   kind among them, when they are longer than `SHAPE_FILE_LENGTH`, when a shape holds a code
 *   that is not a shape's or ends before its codes do, draws itself through its shapes, pops
 *   more places than it pushed, pushes more than 4, or moves its pen or scale out of reach, and
 *   when the file's shapes come to more than `SHAPE_POINTS` points or `SHAPE_STEPS` codes run.
 *   The message names the shape.
 */
export function parseShapes(bytes: Uint8Array): ShapeFile {
  return parseWithin(bytes, budgetOf());
}

/** `parseShapes`, spending from `budget`, which several files may share. */
export function parseWithin(bytes: Uint8Array, budget: Budget): ShapeFile {
  try {
    return parseBytes(bytes, budget);
  } catch (error) {
    // A value that only looks like bytes, such as a proxy that throws, does not read.
    if (error instanceof RangeError) throw error;
    throw new RangeError(`The shape file does not read: ${messageOf(error)}`);
  }
}

/** What an error says, or "" when even that throws. */
function messageOf(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "";
  }
}

function parseBytes(bytes: Uint8Array, budget: Budget): ShapeFile {
  if (!(bytes instanceof Uint8Array)) throw new RangeError("A shape file is given as its bytes");
  if (bytes.length > SHAPE_FILE_LENGTH)
    throw new RangeError(`A shape file has at most ${SHAPE_FILE_LENGTH} bytes`);
  // Reading the index and the names costs a step for each 8 bytes of the file.
  budget.steps -= Math.ceil(bytes.length / 8);
  if (budget.steps < 0)
    throw new RangeError(`The file's shapes run more than ${SHAPE_STEPS} codes`);
  let head = "";
  for (let i = 0; i < Math.min(bytes.length, 40); i++) head += String.fromCharCode(bytes[i]!);
  const header = HEADER.exec(head);
  if (header === null) throw new RangeError("The bytes are not a compiled shape file");
  const [, kind, version] = header;
  if (kind !== "shapes")
    throw new RangeError(`The file is a font of the ${kind} kind, which is not read`);
  if (version !== "1.0")
    throw new RangeError(`The file is of shapes ${version}, and only shapes 1.0 is read`);
  const u16 = (at: number): number => {
    if (at + 2 > bytes.length) throw new RangeError("The shape file ends before its index does");
    return bytes[at]! | (bytes[at + 1]! << 8);
  };
  let at = header[0].length;
  const count = u16(at + 4);
  at += 6;
  const index: { number: number; length: number }[] = [];
  for (let i = 0; i < count; i++, at += 4) index.push({ number: u16(at), length: u16(at + 2) });
  const raw = new Map<number, { name: string; codes: Uint8Array }>();
  for (const { number, length } of index) {
    if (at + length > bytes.length)
      throw new RangeError(`Shape ${number}: the file ends before its codes do`);
    const body = bytes.subarray(at, at + length);
    at += length;
    const nul = body.indexOf(0);
    if (nul < 0) throw new RangeError(`Shape ${number}: its name has no end`);
    let name = "";
    for (const b of body.subarray(0, nul)) name += String.fromCharCode(b);
    if (raw.has(number)) throw new RangeError(`Shape ${number} is in the file twice`);
    raw.set(number, { name, codes: body.subarray(nul + 1) });
  }
  const shapes: ShapeDefinition[] = [];
  for (const { number } of index) {
    // Shape 0 of a font holds its sizes, not an outline.
    if (number === 0) continue;
    const { name } = raw.get(number)!;
    shapes.push({ number, name, ...draw(number, raw, budget) });
  }
  return { shapes };
}

/** A shape a mark names, or why it plots as a gap: no file given, one not read, or no such shape. */
export type ShapeFound =
  | { readonly shape: ShapeDefinition }
  | { readonly missing: "file" | "unread" | "shape" };

/**
 * Finds the shapes marks name in the files given, each file read once when first asked for, as
 * the plot and `lint` both find them.
 *
 * @throws RangeError when two of the files' names are one file's, as `shapeFileKey` finds them.
 */
export function shapeFinder(
  files: ShapeFiles | undefined,
): (file: string, number: number) => ShapeFound {
  const given = givenShapeFiles(files);
  const read = shapeReader();
  const found = new Map<string, ReadonlyMap<number, ShapeDefinition> | undefined>();
  // Each file read has one table of its shapes, however many names give it.
  const tables = new Map<ShapeFile, ReadonlyMap<number, ShapeDefinition>>();
  return (file, number) => {
    const key = shapeFileKey(file);
    if (!given.has(key)) return { missing: "file" };
    if (!found.has(key)) {
      const shapes = read(given.get(key));
      if (shapes instanceof RangeError) found.set(key, undefined);
      else {
        let table = tables.get(shapes);
        if (table === undefined)
          tables.set(shapes, (table = new Map(shapes.shapes.map((d) => [d.number, d]))));
        found.set(key, table);
      }
    }
    const shapes = found.get(key);
    if (shapes === undefined) return { missing: "unread" };
    const shape = shapes.get(number);
    return shape === undefined ? { missing: "shape" } : { shape };
  };
}

/**
 * The shape files given, by `shapeFileKey` of each name, as `ShapeFiles` gives them.
 *
 * @throws RangeError when two names are one file's, or the record does not read.
 */
export function givenShapeFiles(files: unknown): Map<string, unknown> {
  const given = new Map<string, unknown>();
  if (typeof files !== "object" || files === null) return given;
  let entries: [string, unknown][];
  try {
    entries = Object.entries(files);
  } catch (error) {
    throw new RangeError(`The shape files given do not read: ${messageOf(error)}`);
  }
  for (const [name, bytes] of entries) {
    const key = shapeFileKey(name);
    if (given.has(key))
      throw new RangeError(`The shape files ${JSON.stringify(name)} and another are one file`);
    given.set(key, bytes);
  }
  return given;
}

/**
 * Reads shape files from one budget, each value read once however many names give it: its
 * shapes, or the RangeError it does not read with.
 */
export function shapeReader(): (bytes: unknown) => ShapeFile | RangeError {
  const budget = budgetOf();
  const read = new Map<unknown, ShapeFile | RangeError>();
  return (bytes) => {
    let shapes = read.get(bytes);
    if (shapes === undefined) {
      try {
        shapes = parseWithin(bytes as Uint8Array, budget);
      } catch (error) {
        shapes = error instanceof RangeError ? error : new RangeError(messageOf(error));
      }
      read.set(bytes, shapes);
    }
    return shapes;
  };
}

/** What a shape's codes leave: their outlines and where the pen ends. */
function draw(
  number: number,
  raw: ReadonlyMap<number, { name: string; codes: Uint8Array }>,
  budget: Budget,
): { outlines: ShapeOutline[]; end: Point } {
  const outlines: { points: Point[]; bulges: number[] }[] = [];
  let open: { points: Point[]; bulges: number[] } | undefined;
  const state = { x: 0, y: 0, down: true, scale: 1 };
  const stack: Point[] = [];
  const drawing: number[] = [];

  const close = () => {
    if (open !== undefined && open.points.length > 1) outlines.push(open);
    open = undefined;
  };
  const moveTo = (x: number, y: number, bulge: number, label: string) => {
    if (!(Math.abs(x) <= REACH && Math.abs(y) <= REACH))
      throw new RangeError(`${label}: its pen moves out of reach`);
    if (state.down && (x !== state.x || y !== state.y)) {
      if (open === undefined) open = { points: [[state.x, state.y]], bulges: [] };
      if (--budget.points < 0)
        throw new RangeError(`The file's shapes come to more than ${SHAPE_POINTS} points`);
      open.points.push([x, y]);
      open.bulges.push(bulge);
    } else if (!state.down) close();
    state.x = x;
    state.y = y;
  };
  /** An arc from the pen, about the center its start angle puts it on, cut into quarter turns. */
  const arc = (radius: number, start: number, sweep: number, label: string) => {
    const r = radius * state.scale;
    const cx = state.x - r * Math.cos(start);
    const cy = state.y - r * Math.sin(start);
    const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    for (let k = 1; k <= pieces; k++) {
      const angle = start + (sweep * k) / pieces;
      moveTo(
        cx + r * Math.cos(angle),
        cy + r * Math.sin(angle),
        Math.tan(sweep / pieces / 4),
        label,
      );
    }
  };

  const run = (shape: number) => {
    const entry = raw.get(shape);
    const label = `Shape ${shape}${entry && entry.name !== "" ? ` (${entry.name})` : ""}`;
    if (entry === undefined) throw new RangeError(`${label}: the file has no such shape`);
    if (drawing.includes(shape)) throw new RangeError(`${label}: it draws itself`);
    if (drawing.length >= SUBSHAPES)
      throw new RangeError(`${label}: its shapes draw shapes more than ${SUBSHAPES} deep`);
    drawing.push(shape);
    const codes = entry.codes;
    let i = 0;
    const next = (): number => {
      if (i >= codes.length) throw new RangeError(`${label}: its codes end before a 0`);
      if (--budget.steps < 0)
        throw new RangeError(`The file's shapes run more than ${SHAPE_STEPS} codes`);
      return codes[i++]!;
    };
    const signed = (): number => {
      const b = next();
      return b > 127 ? b - 256 : b;
    };
    /** An arc's octant byte: its direction, first octant and count of octants, 0 for 8. */
    const octants = () => {
      const b = next();
      return { turn: b & 0x80 ? -1 : 1, first: (b >> 4) & 7, count: b & 7 || 8 };
    };
    /** Steps over the command at `i`, for code 14 outside vertical text. */
    const skip = () => {
      // A code 14 before code 14 skips the command after both.
      let code = next();
      while (code === 14) code = next();
      if (code > 0x0f) return;
      if (code === 3 || code === 4 || code === 7) i += 1;
      else if (code === 8) i += 2;
      else if (code === 10) i += 2;
      else if (code === 11) i += 5;
      else if (code === 12) i += 3;
      else if (code === 9 || code === 13) {
        for (;;) {
          const dx = next();
          const dy = next();
          if (dx === 0 && dy === 0) break;
          if (code === 13) next();
        }
      } else if (code === 0 || code === 15)
        throw new RangeError(`${label}: code 14 comes before ${code}`);
      if (i > codes.length) throw new RangeError(`${label}: its codes end before a 0`);
    };
    for (;;) {
      const code = next();
      if (code === 0) break;
      if (code > 0x0f) {
        const [dx, dy] = DIRECTIONS[code & 0x0f]!;
        const length = (code >> 4) * state.scale;
        moveTo(state.x + dx * length, state.y + dy * length, 0, label);
        continue;
      }
      switch (code) {
        case 1:
          state.down = true;
          break;
        case 2:
          state.down = false;
          close();
          break;
        case 3:
        case 4: {
          const by = next();
          if (by === 0) throw new RangeError(`${label}: it scales by 0`);
          state.scale = code === 3 ? state.scale / by : state.scale * by;
          if (!(state.scale <= SCALE_LIMIT && state.scale >= 1 / SCALE_LIMIT))
            throw new RangeError(`${label}: its scale grows out of reach`);
          break;
        }
        case 5:
          if (stack.length >= STACK)
            throw new RangeError(`${label}: it pushes more than ${STACK} places`);
          stack.push([state.x, state.y]);
          break;
        case 6: {
          const place = stack.pop();
          if (place === undefined)
            throw new RangeError(`${label}: it pops a place it never pushed`);
          // A pop moves the pen without drawing.
          close();
          state.x = place[0];
          state.y = place[1];
          break;
        }
        case 7:
          run(next());
          break;
        case 8:
        case 9:
          for (;;) {
            const dx = signed();
            const dy = signed();
            if (code === 9 && dx === 0 && dy === 0) break;
            moveTo(state.x + dx * state.scale, state.y + dy * state.scale, 0, label);
            if (code === 8) break;
          }
          break;
        case 10: {
          const radius = next();
          const { turn, first, count } = octants();
          arc(radius, first * OCTANT, turn * count * OCTANT, label);
          break;
        }
        case 11: {
          const from = next();
          const to = next();
          const radius = (next() << 8) | next();
          const { turn, first, count } = octants();
          const start = first * OCTANT + (turn * from * OCTANT) / 256;
          const end = (first + turn * (count - 1)) * OCTANT + (turn * to * OCTANT) / 256;
          let sweep = end - start;
          // The arc runs the way its octant byte turns, a whole turn at most.
          if (turn * sweep <= 0) sweep += turn * 2 * Math.PI;
          arc(radius, start, sweep, label);
          break;
        }
        case 12:
        case 13:
          for (;;) {
            const dx = signed();
            const dy = signed();
            if (code === 13 && dx === 0 && dy === 0) break;
            const bulge = signed();
            if (bulge === -128) throw new RangeError(`${label}: a bulge of -128`);
            moveTo(state.x + dx * state.scale, state.y + dy * state.scale, bulge / 127, label);
            if (code === 12) break;
          }
          break;
        case 14:
          // Only vertical text draws the next command, and a shape along a line is not.
          skip();
          break;
        default:
          throw new RangeError(`${label}: ${code} is not a shape's code`);
      }
    }
    drawing.pop();
  };
  run(number);
  close();
  return {
    outlines: outlines.map((o) =>
      o.bulges.some((b) => b !== 0) ? { points: o.points, bulges: o.bulges } : { points: o.points },
    ),
    end: [state.x, state.y],
  };
}
