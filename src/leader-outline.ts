// The outline of a block a leader places in place of its note, read from a block made by hand,
// which may hold entities of any type.
import type { Block, Point } from "./drawing.ts";
import { ellipsePoint, splinePolyline, unturned } from "./curves.ts";
import { isNumber, isObjectOrArray, isRecord, isString } from "./guards.ts";
import { drawnEllipse, drawnSpline } from "./rules.ts";
import { filled } from "./shape.ts";

/** A block's own outline, as a block in place of a leader's note is placed by it. */
interface Outline {
  /** Its box, `[left, bottom, right, top]`, from its base point, or undefined when it draws nothing. */
  readonly box: readonly [number, number, number, number] | undefined;
  /** Where it crosses the level line through its base point: the least and the greatest X. */
  readonly crossing: readonly [number, number] | undefined;
}

const outlines = new WeakMap<object, Outline>();

/** An affine map of a point, `[a, b, c, d, e, f]`: x' = a x + c y + e, y' = b x + d y + f. */
type Affine = readonly [number, number, number, number, number, number];

const compose = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** A number of a block's data, or NaN for any other value, which the outline leaves out. */
const num = (value: unknown): number => (isNumber(value) ? value : Number.NaN);

/** How many blocks deep the outline follows the inserts a block holds. */
const OUTLINE_DEPTH = 8;

/**
 * The outline of a block's lines, polylines, circles and arcs, and of the blocks it inserts, up to
 * `OUTLINE_DEPTH` deep, worked out once for each block: their box, and where they cross
 * the level line through the base point. Text takes no part, nor anything past the first
 * `OUTLINE_ITEMS` read at any depth.
 */
export function outlineOf(block: Block, findBlock?: (name: string) => Block | undefined): Outline {
  // A block made by hand may give entities of any type.
  if (!isObjectOrArray(block.entities)) return { box: undefined, crossing: undefined };
  const known = outlines.get(block);

  if (known) return known;
  let box: [number, number, number, number] | undefined;
  let crossing: [number, number] | undefined;

  const add = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    box = box
      ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)]
      : [x, y, x, y];
  };

  const cross = (x: number): void => {
    if (!Number.isFinite(x)) return;
    crossing = crossing ? [Math.min(crossing[0], x), Math.max(crossing[1], x)] : [x, x];
  };

  const segment = (a: Point, b: Point): void => {
    add(a[0], a[1]);
    add(b[0], b[1]);

    if ((a[1] <= 0 && b[1] >= 0) || (a[1] >= 0 && b[1] <= 0)) {
      if (a[1] === b[1]) {
        cross(a[0]);
        cross(b[0]);
      } else cross(a[0] + ((b[0] - a[0]) * -a[1]) / (b[1] - a[1]));
    }
  };

  let read = 0;
  const open = new Set<Block>();

  const walk = (inner: Block, m: Affine, depth: number): void => {
    const map = (p: unknown): Point =>
      Array.isArray(p)
        ? [m[0] * num(p[0]) + m[2] * num(p[1]) + m[4], m[1] * num(p[0]) + m[3] * num(p[1]) + m[5]]
        : [Number.NaN, Number.NaN];

    // An arc as short chords, close enough to place a block by.
    const round = (center: unknown, r: number, from = 0, to = 360): void => {
      if (!Array.isArray(center)) return;
      const sweep = (((to - from) % 360) + 360) % 360 || 360;
      const steps = 64;
      let last: Point | undefined;

      for (let i = 0; i <= steps; i++) {
        const t = ((from + (sweep * i) / steps) * Math.PI) / 180;
        const p = map([num(center[0]) + r * Math.cos(t), num(center[1]) + r * Math.sin(t)]);

        if (last) segment(last, p);
        last = p;
      }
    };

    // A side with a bulge as the arc it is: a quarter of its turn's tangent, counterclockwise when above 0.
    const bulged = (a: unknown, b: unknown, bulge: number): void => {
      if (!Array.isArray(a) || !Array.isArray(b)) return;
      const [ax, ay, bx, by] = [num(a[0]), num(a[1]), num(b[0]), num(b[1])];
      const turn = 4 * Math.atan(bulge);
      const [dx, dy] = [bx - ax, by - ay];
      const chord = Math.hypot(dx, dy);

      if (!(chord > 0)) return;
      // The center is off the chord's middle, to its left, by half the chord times cot(turn / 2).
      const off = ((1 - bulge * bulge) / (2 * bulge)) * (chord / 2);
      const [cx, cy] = [(ax + bx) / 2 - (dy / chord) * off, (ay + by) / 2 + (dx / chord) * off];
      const r = Math.hypot(ax - cx, ay - cy);
      const from = Math.atan2(ay - cy, ax - cx);
      const steps = 32;
      let last = map([ax, ay]);

      for (let i = 1; i <= steps; i++) {
        const t = from + (turn * i) / steps;
        const p = map([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
        segment(last, p);
        last = p;
      }
    };

    open.add(inner);

    for (const e of filled(inner.entities)) {
      if (++read > OUTLINE_ITEMS) break;

      if (!isObjectOrArray(e)) continue;

      if (e.kind === "line") segment(map(e.from), map(e.to));
      else if (e.kind === "polyline") {
        const points = filled(e.points).slice(0, OUTLINE_ITEMS);
        const bulges = filled(e.bulges);
        read += points.length;
        const sides = e.closed && points.length > 2 ? points.length : points.length - 1;

        for (let i = 0; i < sides; i++) {
          const [a, b] = [points[i]!, points[(i + 1) % points.length]!];
          const bulge = num(bulges[i] ?? 0);

          if (!bulge || !Number.isFinite(bulge)) segment(map(a), map(b));
          else bulged(a, b, bulge);
        }
      } else if (e.kind === "circle") round(e.center, num(e.radius));
      else if (e.kind === "arc") round(e.center, num(e.radius), num(e.startAngle), num(e.endAngle));
      else if (e.kind === "ellipse" || e.kind === "spline") {
        // A curve as the points of 32 steps a turn of an ellipse, or 8 a piece of a spline.
        // An array, which no spline is, holds no field that reads, so it reads as none.
        const fields = isRecord(e) ? e : NO_FIELDS;
        const lists = [fields.fitPoints, fields.controlPoints, fields.knots, fields.weights];
        read += lists.reduce((n: number, l) => n + (Array.isArray(l) ? l.length : 0), 0);

        if (read > OUTLINE_ITEMS) break;
        let points: Point[] = [];

        if (e.kind === "ellipse") {
          const d = drawnEllipse(e);

          if (d) {
            const from = d.start ?? 0;

            const turn =
              d.start === undefined ? 2 * Math.PI : unturned(d.end! - from) || 2 * Math.PI;

            points = Array.from({ length: 33 }, (_, k) =>
              ellipsePoint(d.center, d.majorAxis, d.ratio, from + (turn * k) / 32),
            );
          }
        } else {
          const d = drawnSpline(isRecord(e) ? e : NO_FIELDS);

          if (d) points = splinePolyline(d.degree, d.knots, d.controlPoints, d.weights, 8);
        }

        read += points.length;

        for (let i = 1; i < points.length; i++) segment(map(points[i - 1]!), map(points[i]!));
      } else if (e.kind === "insert" && depth < OUTLINE_DEPTH && isString(e.block)) {
        const nested = findBlock?.(e.block);

        if (nested === undefined || open.has(nested)) continue;
        const [sx, sy] = Array.isArray(e.scale) ? e.scale : [1, 1];
        const turn = ((num(e.rotation ?? 0) || 0) * Math.PI) / 180;
        const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
        const [bx, by] = Array.isArray(nested.base) ? nested.base : [0, 0];
        const [ax, ay] = Array.isArray(e.at) ? e.at : [0, 0];

        // Its block's base point to its point, scaled and turned.
        const placed: Affine = [
          cos * num(sx),
          sin * num(sx),
          -sin * num(sy),
          cos * num(sy),
          num(ax) - (cos * num(sx) * num(bx) - sin * num(sy) * num(by)),
          num(ay) - (sin * num(sx) * num(bx) + cos * num(sy) * num(by)),
        ];

        walk(nested, compose(m, placed), depth + 1);
      }
    }

    open.delete(inner);
  };

  const [bx, by] = Array.isArray(block.base) ? block.base : [0, 0];
  walk(block, [1, 0, 0, 1, -num(bx), -num(by)], 0);
  const outline = { box, crossing };
  outlines.set(block, outline);

  return outline;
}

/** How many entities of a block, and points of a polyline, the outline reads. */
const OUTLINE_ITEMS = 4096;

/** The fields of a value that has none to read, among them the lists a curve may hold. */
const NO_FIELDS: {
  readonly fitPoints?: never;
  readonly controlPoints?: never;
  readonly knots?: never;
  readonly weights?: never;
} = Object.freeze({});
