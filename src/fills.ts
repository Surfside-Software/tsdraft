// What a hatch, a wipeout and a text's mask draw, from the numbers as they are written: the one
// place the writers, `toSVG`, the extents and the readers take them from.
//
// The leading CAD app fills a hatch whose loops are all polylines and whose island style is normal
// by the parity of the loops around a point, whichever way each runs and in whatever order: so
// tsdraft writes every hatch that way. It holds a wipeout as a picture of one pixel, square, its
// lower-left corner the polygon's least X and Y and its side the larger of the polygon's width and
// height, clipped by the polygon in that pixel's axes, y down from its top. It plots a text's mask
// as the text's box grown by the mask's factor less one times its height, each side.
import type {
  Drawing,
  Entity,
  Hatch,
  HatchLoop,
  HatchPattern,
  PatternLine,
  Point,
  Polyline,
} from "./drawing.ts";
import { placedLines, userLines, type PlacedLine } from "./patterns.ts";
import { written } from "./format.ts";
import { keyHandle } from "./handles.ts";
import { layerKey } from "./layers.ts";
import { placer, type ParagraphLayout, type ParagraphToMeasure } from "./paragraphs.ts";
import { direction, polylineSides, type PolylineSide } from "./polylines.ts";
import { HATCH_LINES, PATTERN_ITEMS, PATTERN_REACH, patternDensityProblem } from "./rules.ts";
import { filled } from "./shape.ts";

/**
 * A hatch's loops that can be drawn: each an object up to the list's first empty slot. One of
 * another shape, which `lint` refuses, draws nothing.
 */
export function drawnLoops(loops: unknown): HatchLoop[] {
  const out: HatchLoop[] = [];
  for (const loop of filled(loops)) {
    if (typeof loop === "object" && loop !== null && !Array.isArray(loop))
      out.push(loop as HatchLoop);
  }
  return out;
}

/** A loop as the closed polyline it is drawn as, which `polylineSides` and the extents read. */
export function loopOutline(loop: HatchLoop, layer: string): Polyline {
  return {
    kind: "polyline",
    layer,
    points: loop.points,
    closed: true,
    ...(loop.bulges === undefined ? {} : { bulges: loop.bulges }),
  };
}

/** What a hatch's pattern draws, as a file holds it. */
export interface HatchLines {
  /** The pattern's name, or `_U` for user-defined lines, as the leading CAD app names them. */
  readonly name: string;
  /** Group 76: 2 a pattern of a file, 0 user-defined lines. */
  readonly type: 0 | 2;
  readonly angle: number;
  /** The pattern's scale, or the user-defined lines' spacing. */
  readonly scale: number;
  readonly crossed: boolean;
  readonly lines: readonly PlacedLine[];
}

/**
 * A drawing's patterns by the name a hatch gives, which is taken as a linetype's name is, whatever
 * the case of its letters: the first of a name where two share it, which `lint` refuses.
 */
export function patternFinder(
  patterns: readonly HatchPattern[] | undefined,
): (name: string) => HatchPattern | undefined {
  const byKey = new Map<string, HatchPattern>();
  for (const pattern of patterns ?? []) {
    const key = layerKey(pattern.name);
    if (!byKey.has(key)) byKey.set(key, pattern);
  }
  return (name) => byKey.get(layerKey(name));
}

/** A hatch's pattern as it is drawn, before its lines are placed. */
interface Chosen extends Omit<HatchLines, "lines"> {
  readonly origin: Point;
  /** The pattern of the drawing it names, or undefined for user-defined lines. */
  readonly pattern?: HatchPattern;
}

/**
 * A hatch's pattern from its numbers as written, a field the rules refuse taken as its default:
 * undefined for a solid hatch, and for a pattern `patternOf` does not find.
 */
function chosen(
  hatch: Pick<Hatch, "pattern">,
  patternOf: (name: string) => HatchPattern | undefined,
): Chosen | undefined {
  const p: unknown = hatch.pattern;
  if (typeof p !== "object" || p === null || Array.isArray(p)) return undefined;
  const given = p as Record<string, unknown>;
  const number = (value: unknown, otherwise: number) =>
    typeof value === "number" && Number.isFinite(value) ? written(value) : otherwise;
  const at = given.origin;
  const origin: Point =
    Array.isArray(at) && at.length === 2 ? [number(at[0], 0), number(at[1], 0)] : [0, 0];
  const angle = number(given.angle, 0);
  if (typeof given.spacing === "number") {
    const spacing = number(given.spacing, 0);
    if (!(spacing > 0)) return undefined;
    const crossed = given.crossed === true;
    return { name: "_U", type: 0, angle, scale: spacing, crossed, origin };
  }
  if (typeof given.name !== "string") return undefined;
  const pattern = patternOf(given.name);
  if (pattern === undefined) return undefined;
  const scale = number(given.scale, 1);
  if (!(scale > 0)) return undefined;
  return { name: pattern.name, type: 2, angle, scale, crossed: false, origin, pattern };
}

/**
 * The lines a hatch's pattern draws, placed in the drawing: undefined for a solid hatch, and for a
 * pattern `patternOf` does not find, which `lint` refuses.
 */
export function hatchLines(
  hatch: Pick<Hatch, "pattern">,
  patternOf: (name: string) => HatchPattern | undefined,
): HatchLines | undefined {
  const c = chosen(hatch, patternOf);
  if (c === undefined) return undefined;
  const { name, type, angle, scale, crossed, origin, pattern } = c;
  const lines = pattern
    ? placedLines(filled(pattern.lines), scale, angle, origin)
    : userLines(scale, angle, crossed, origin);
  return { name, type, angle, scale, crossed, lines };
}

/** The box of a hatch's loops: `[x0, y0, x1, y1]`. */
export type LoopsBox = readonly [number, number, number, number];

/**
 * A box that holds what a hatch's loops close around, its arcs too, from their numbers as given:
 * the box of each side grown by the height of its arc, `|bulge|` times half its chord, which holds
 * the arc whatever its sweep. Undefined for a loop with a point or a bulge that is not a finite
 * number, which `lint` refuses, and for no point at all.
 */
export function loopsBox(loops: unknown): LoopsBox | undefined {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  for (const loop of drawnLoops(loops)) {
    const points = filled(loop.points as unknown);
    const bulges: unknown = loop.bulges;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const p: unknown = points[i];
      const q: unknown = points[(i + 1) % n];
      if (!Array.isArray(p) || !Array.isArray(q)) return undefined;
      const [px, py, qx, qy]: unknown[] = [p[0], p[1], q[0], q[1]];
      if (!finite(px) || !finite(py) || !finite(qx) || !finite(qy)) return undefined;
      const b: unknown = Array.isArray(bulges) && i < bulges.length ? bulges[i] : 0;
      if (b !== undefined && !finite(b)) return undefined;
      const grow = b ? (Math.abs(b) * Math.hypot(qx - px, qy - py)) / 2 : 0;
      x0 = Math.min(x0, px - grow, qx - grow);
      y0 = Math.min(y0, py - grow, qy - grow);
      x1 = Math.max(x1, px + grow, qx + grow);
      y1 = Math.max(y1, py + grow, qy + grow);
    }
  }
  return x0 <= x1 && y0 <= y1 ? [x0, y0, x1, y1] : undefined;
}

/** What a hatch pattern's definition holds, as the checks of what a hatch draws read it. */
export interface PatternSizes {
  /** Its lines and the dashes of each, which a hatch's lines are placed from. */
  readonly items: number;
  /** The largest size of a line's angle. */
  readonly angle: number;
  /** The largest sum of the sizes of a line's base point's numbers. */
  readonly base: number;
  /** The largest size of a number a line's offset or dashes gives, the offset's two summed. */
  readonly reach: number;
}

/** The sizes of one of a pattern's lines, whose numbers are all finite. */
export function lineSizes(line: PatternLine): Omit<PatternSizes, "items"> {
  let reach = Math.abs(line.offset[0]) + Math.abs(line.offset[1]);
  for (const dash of filled(line.dashes ?? [])) reach = Math.max(reach, Math.abs(dash));
  return {
    angle: Math.abs(line.angle),
    base: Math.abs(line.base[0]) + Math.abs(line.base[1]),
    reach,
  };
}

/**
 * The sizes of a pattern's lines, or undefined when one cannot be placed: at most `PATTERN_ITEMS`
 * lines, each an object of finite numbers with at most as many dashes. A list of dashes that many
 * lines share is read once, through `dashesRead`.
 */
export function patternSizes(
  lines: unknown,
  dashesRead: WeakMap<object, number | undefined>,
): PatternSizes | undefined {
  if (!Array.isArray(lines) || lines.length > PATTERN_ITEMS) return undefined;
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  const pair = (p: unknown): boolean => Array.isArray(p) && finite(p[0]) && finite(p[1]);
  let [items, angle, bases, reach] = [lines.length, 0, 0, 0];
  for (let i = 0; i < lines.length; i++) {
    const line: unknown = lines[i];
    if (typeof line !== "object" || line === null) return undefined;
    const l = line as Record<string, unknown>;
    if (!finite(l.angle) || !pair(l.base) || !pair(l.offset)) return undefined;
    const dashes: unknown = l.dashes;
    let most = 0;
    if (dashes !== undefined) {
      if (!Array.isArray(dashes)) return undefined;
      if (!dashesRead.has(dashes)) {
        let found: number | undefined = 0;
        if (dashes.length > PATTERN_ITEMS) found = undefined;
        else
          for (let j = 0; j < dashes.length; j++) {
            const dash: unknown = dashes[j];
            if (!finite(dash)) {
              found = undefined;
              break;
            }
            found = Math.max(found, Math.abs(dash));
          }
        dashesRead.set(dashes, found);
      }
      const found = dashesRead.get(dashes);
      if (found === undefined) return undefined;
      most = found;
      items += dashes.length;
    }
    const [base, offset] = [l.base as Point, l.offset as Point];
    angle = Math.max(angle, Math.abs(l.angle));
    bases = Math.max(bases, Math.abs(base[0]) + Math.abs(base[1]));
    reach = Math.max(reach, most, Math.abs(offset[0]) + Math.abs(offset[1]));
  }
  return { items, angle, base: bases, reach };
}

/** A family of a hatch's lines as their count reads it: their angle and how far apart they lie. */
export interface Family {
  readonly angle: number;
  readonly apart: number;
}

/** What a hatch's pattern places, as the checks of what it draws read it. */
export interface PatternSpread {
  readonly families: readonly Family[];
  /** At least the largest size of a number a placed line holds: an angle, a coordinate, a dash. */
  readonly reach: number;
}

/**
 * What a hatch's pattern places, from its numbers as written: each family of lines, and a size no
 * number its placed lines hold is above. Undefined for a solid hatch, and for a pattern `patternOf`
 * does not find; `sizesOf` gives the sizes of the definition it finds.
 */
export function hatchSpread(
  hatch: Pick<Hatch, "pattern">,
  patternOf: (name: string) => HatchPattern | undefined,
  sizesOf: (pattern: HatchPattern) => PatternSizes | undefined,
): PatternSpread | undefined {
  const c = chosen(hatch, patternOf);
  if (c === undefined) return undefined;
  const { angle, scale, origin, pattern } = c;
  const away = Math.max(Math.abs(origin[0]), Math.abs(origin[1]));
  if (pattern === undefined) {
    const families = [{ angle, apart: scale }];
    if (c.crossed) families.push({ angle: angle + 90, apart: scale });
    return { families, reach: Math.max(Math.abs(angle) + 90, scale, away) };
  }
  const sizes = sizesOf(pattern);
  if (sizes === undefined) return undefined;
  const families: Family[] = [];
  for (const line of filled(pattern.lines)) {
    families.push({ angle: line.angle + angle, apart: line.offset[1] * scale });
  }
  // A line's base is scaled, turned and moved, and its offset and dashes scaled and turned.
  return {
    families,
    reach: Math.max(sizes.angle + Math.abs(angle), sizes.base * scale + away, sizes.reach * scale),
  };
}

/**
 * How many lines a hatch's pattern draws across the box of its loops, at most: for each family,
 * the box's extent across its lines over how far apart they lie, and one more.
 */
export function linesAcross(box: LoopsBox, families: readonly Family[]): number {
  const [width, height] = [box[2] - box[0], box[3] - box[1]];
  let count = 0;
  for (const { angle, apart } of families) {
    const [c, s] = direction(angle);
    count += Math.floor((width * Math.abs(s) + height * Math.abs(c)) / Math.abs(apart)) + 1;
  }
  return count;
}

/**
 * What is wrong with what a hatch's pattern draws inside its loops, or undefined: a number of its
 * placed lines that is 1e100 or more, or more lines than `HATCH_LINES`. `lint` and the builder
 * refuse such a hatch, and `toSVG` draws none of its lines.
 */
export function patternDrawnProblem(box: LoopsBox, spread: PatternSpread): string | undefined {
  // Written with 15 digits, a number just under 1e100 would print as 1e+100.
  if (!(Number(spread.reach.toPrecision(15)) < 1e100)) return PATTERN_REACH;
  const count = linesAcross(box, spread.families);
  return count <= HATCH_LINES ? undefined : patternDensityProblem(count);
}

/** The sides of a hatch's loop, as a closed polyline's. */
export function loopSides(loop: HatchLoop): PolylineSide[] {
  return polylineSides(loopOutline(loop, ""));
}

/** True when a loop has a side with a bulge as written. */
export function loopBulged(loop: HatchLoop): boolean {
  const bulges: unknown = loop.bulges;
  if (!Array.isArray(bulges)) return false;
  for (let i = 0; i < bulges.length && i in bulges; i++) {
    const b: unknown = bulges[i];
    if (typeof b === "number" && written(b) !== 0) return true;
  }
  return false;
}

/** True when a polygon's points, as written, all lie on one line, so it closes around no area. */
export function onOneLine(points: readonly Point[]): boolean {
  const p = points.map(([x, y]): Point => [written(x), written(y)]);
  const a = p[0];
  const b = p.find((q) => q[0] !== a?.[0] || q[1] !== a?.[1]);
  if (a === undefined || b === undefined) return true;
  return p.every((c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) === 0);
}

/**
 * True when two sides of a polygon cross or touch, other than where two sides meet at a corner,
 * from its points as written: each side against each one not next to it. A point given twice in
 * a row, or its first point again at its end, makes no side.
 */
export function polygonCrosses(points: readonly Point[]): boolean {
  const p: Point[] = [];
  for (const [x, y] of points) {
    const q: Point = [written(x), written(y)];
    const last = p.at(-1);
    if (last === undefined || last[0] !== q[0] || last[1] !== q[1]) p.push(q);
  }
  if (p.length > 1 && p[0]![0] === p.at(-1)![0] && p[0]![1] === p.at(-1)![1]) p.pop();
  const n = p.length;
  const turn = (a: Point, b: Point, c: Point): number =>
    Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const within = (a: Point, b: Point, c: Point): boolean =>
    Math.min(a[0], b[0]) <= c[0] &&
    c[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= c[1] &&
    c[1] <= Math.max(a[1], b[1]);
  for (let i = 0; i < n; i++) {
    const [a, b] = [p[i]!, p[(i + 1) % n]!];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [c, d] = [p[j]!, p[(j + 1) % n]!];
      const [t1, t2, t3, t4] = [turn(a, b, c), turn(a, b, d), turn(c, d, a), turn(c, d, b)];
      if (t1 !== t2 && t3 !== t4 && t1 !== 0 && t2 !== 0 && t3 !== 0 && t4 !== 0) return true;
      if (
        (t1 === 0 && within(a, b, c)) ||
        (t2 === 0 && within(a, b, d)) ||
        (t3 === 0 && within(c, d, a)) ||
        (t4 === 0 && within(c, d, b))
      )
        return true;
    }
  }
  return false;
}

/** A wipeout's picture of one pixel: its lower-left corner and its side, as written. */
export interface WipeoutPicture {
  readonly corner: Point;
  readonly side: number;
}

/** The picture a wipeout's points give, from the points as written. */
export function wipeoutPicture(points: readonly Point[]): WipeoutPicture {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of filled(points) as readonly Point[]) {
    const [wx, wy] = [written(x), written(y)];
    x0 = Math.min(x0, wx);
    y0 = Math.min(y0, wy);
    x1 = Math.max(x1, wx);
    y1 = Math.max(y1, wy);
  }
  return { corner: [x0, y0], side: Math.max(x1 - x0, y1 - y0) };
}

/**
 * A wipeout's polygon in its picture's axes, as the file holds it: x across from the left edge's
 * middle and y down from the top's, each from -0.5 to 0.5, with its first point again at its end.
 */
export function wipeoutClip(points: readonly Point[]): Point[] {
  const { corner, side } = wipeoutPicture(points);
  const given = filled(points) as readonly Point[];
  return [...given, given[0]!].map(([x, y]): Point => [
    (written(x) - corner[0]) / side - 0.5,
    0.5 - (written(y) - corner[1]) / side,
  ]);
}

/** A mask as it is drawn: none for `false`, and for `true` or an object its color and factor. */
export interface Mask {
  /** A color index, or undefined for the drawing's background. */
  readonly color?: number;
  readonly offsetFactor: number;
}

/** A mask's factor of the text height unless given, as the leading CAD app sets one. */
export const MASK_FACTOR = 1.5;

/** The factor of a dimension's mask, which its style does not set. */
export const DIMENSION_MASK_FACTOR = 1.25;

/**
 * A mask as it is drawn: none for `false`, and for `true` or an object the drawing's background or
 * a color index, and its factor as written. A field the rules refuse is drawn as its default, and
 * any other value as no mask.
 */
export function maskOf(mask: unknown): Mask | undefined {
  if (mask === true) return { offsetFactor: MASK_FACTOR };
  if (typeof mask !== "object" || mask === null || Array.isArray(mask)) return undefined;
  const { color, offsetFactor } = mask as Record<string, unknown>;
  const factor =
    typeof offsetFactor === "number" && Number.isFinite(offsetFactor)
      ? written(offsetFactor)
      : MASK_FACTOR;
  return {
    ...(Number.isInteger(color) && (color as number) >= 1 && (color as number) <= 256
      ? { color: color as number }
      : {}),
    offsetFactor: factor,
  };
}

/** The box of each layout's lines a mask covers, read once for a layout however often it is placed. */
const reaches = new WeakMap<ParagraphLayout, readonly [number, number, number, number]>();

/** A layout's frame, reaching to the start and the end of each line that passes it. */
function maskReach(layout: ParagraphLayout): readonly [number, number, number, number] {
  const known = reaches.get(layout);
  if (known) return known;
  let [left, bottom, right, top] = layout.frame;
  for (const line of layout.lines) {
    const first = line.runs[0];
    if (first === undefined) continue;
    if (first.x < left) left = first.x;
    if (line.end > right) right = line.end;
  }
  const reach = [left, bottom, right, top] as const;
  reaches.set(layout, reach);
  return reach;
}

/**
 * The box of a text's mask, `[left, bottom, right, top]` along its lines from its point: its box,
 * reaching to the end of a line longer than its width, grown by its factor less one times
 * `height` each side.
 */
export function maskBox(
  layout: ParagraphLayout,
  height: number,
  mask: Mask,
): [number, number, number, number] {
  const [left, bottom, right, top] = maskReach(layout);
  const grow = (mask.offsetFactor - 1) * height;
  return [left - grow, bottom - grow, right + grow, top + grow];
}

/** The corners of a paragraph's mask, its lower left first and counterclockwise. */
export function paragraphMaskCorners(
  paragraph: Pick<ParagraphToMeasure, "at" | "rotation" | "height">,
  layout: ParagraphLayout,
  mask: Mask,
): Point[] {
  const place = placer(paragraph);
  const [l, b, r, t] = maskBox(layout, paragraph.height, mask);
  return [place(l, b), place(r, b), place(r, t), place(l, t)];
}

/** How many wipeouts a drawing holds: in model space, on its layouts and in its blocks. */
export function wipeoutCount(drawing: Drawing): number {
  const lists: (readonly Entity[] | undefined)[] = [
    drawing.entities,
    ...filled(drawing.layouts ?? []).map((layout) => layout.entities),
    ...filled(drawing.blocks ?? []).map((block) => block.entities),
  ];
  let count = 0;
  for (const list of lists) for (const e of filled(list ?? [])) if (e.kind === "wipeout") count++;
  return count;
}

/** The mask of a dimension style's text, or undefined for none and for a value `lint` refuses. */
export function dimensionMask(
  style: { readonly textMask?: unknown } | undefined,
): Mask | undefined {
  const mask: unknown = style?.textMask;
  if (mask === true) return { offsetFactor: DIMENSION_MASK_FACTOR };
  if (typeof mask !== "object" || mask === null || Array.isArray(mask)) return undefined;
  const { color } = mask as Record<string, unknown>;
  if (!Number.isInteger(color) || (color as number) < 1 || (color as number) > 256)
    return undefined;
  return { color: color as number, offsetFactor: DIMENSION_MASK_FACTOR };
}

/** The handle of WIPEOUTVARIABLES, which the dictionary `ACAD_WIPEOUT_VARS` names. */
export function wipeoutVariablesHandle(): string {
  return keyHandle("wipeout-variables:");
}

/** The handle of the dictionary of the drawing's variables, `AcDbVariableDictionary`. */
export function variableDictionaryHandle(): string {
  return keyHandle("dictionary:acdbvariabledictionary");
}

/** The handle of the variable `WIPEOUTFRAME` there, which says whether wipeouts' frames show. */
export function wipeoutFrameVariableHandle(): string {
  return keyHandle("dictionary-variable:wipeoutframe");
}

/** The application the classes of a wipeout and its variables name. */
export const WIPEOUT_APPLICATION = "WipeOut";
