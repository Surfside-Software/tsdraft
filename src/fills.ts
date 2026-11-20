// What a hatch, a wipeout and a text's mask draw, from the numbers as they are written: the one
// place the writers, `toSVG`, the extents and the readers take them from.
//
// The leading CAD app fills a hatch whose loops are all polylines and whose island style is normal
// by the parity of the loops around a point, whichever way each runs and in whatever order: so
// tsdraft writes every hatch that way. It holds a wipeout as a picture of one pixel, square, its
// lower-left corner the polygon's least X and Y and its side the larger of the polygon's width and
// height, clipped by the polygon in that pixel's axes, y down from its top. It plots a text's mask
// as the text's box grown by the mask's factor less one times its height, each side.
import type { Drawing, Entity, HatchLoop, Point, Polyline } from "./drawing.ts";
import { written } from "./format.ts";
import { keyHandle } from "./handles.ts";
import { placer, type ParagraphLayout, type ParagraphToMeasure } from "./paragraphs.ts";
import { polylineSides, type PolylineSide } from "./polylines.ts";
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
