// What a polyline draws: each side, straight or an arc by its bulge, and how wide it is at each
// end, from the numbers as they are written. The writers, `toSVG`, the extents and the builder's
// shapes all read it. And the shapes the builder makes of polylines: a corner rounded by a
// radius, a revision cloud along an outline, a donut, and the bulge of an arc through a point.
import type { Point, Polyline } from "./drawing.ts";
import { written } from "./format.ts";
import { filled } from "./shape.ts";
import { isNumber, isString } from "./guards.ts";

/** The unit vector at an angle in degrees, exact along the axes. */
export function direction(degrees: number): Point {
  const quarter = ((degrees % 360) + 360) % 360;

  if (quarter === 0) return [1, 0];

  if (quarter === 90) return [0, 1];

  if (quarter === 180) return [-1, 0];

  if (quarter === 270) return [0, -1];
  const radians = (degrees * Math.PI) / 180;

  return [Math.cos(radians), Math.sin(radians)];
}

/** A side of a polyline, from one of its points to the next. */
export interface PolylineSide {
  readonly from: Point;
  readonly to: Point;
  /** Its bulge as written: 0 for a straight side. */
  readonly bulge: number;
  /** Its width at `from` and at `to`, as written. */
  readonly startWidth: number;
  readonly endWidth: number;
}

/** The arc of a side with a bulge, about its center. */
export interface SideArc {
  readonly center: Point;
  readonly radius: number;
  /** The angle of the side's `from` about the center, in radians counterclockwise from +X. */
  readonly start: number;
  /** The angle it turns through, in radians, counterclockwise when greater than 0. */
  readonly sweep: number;
}

/**
 * The sides of a polyline, from each point to the next and, when it is closed, from the last back
 * to the first, with the points, the bulge and the widths each is written with. A list of bulges
 * or widths that does not have one item for each side up to its first empty slot, or a value that
 * is no number, counts as 0, as `lint` reports it.
 */
export function polylineSides(e: Polyline): PolylineSide[] {
  const points = filled(e.points).map(([x, y]): Point => [number(x), number(y)]);

  const count = e.closed ? points.length : points.length - 1;

  if (count < 1) return [];
  // A list of points with an empty slot has its sides up to it straight and of no width, as
  // `hasArcsOrWidths`, which reads no point, takes them.
  const whole = Array.isArray(e.points) && e.points.length === points.length;

  const each = <T>(list: readonly T[] | undefined): readonly T[] | undefined =>
    whole && Array.isArray(list) && list.length === count && filled(list).length === count
      ? list
      : undefined;

  const bulges = each(e.bulges);
  const widths = each(e.widths);
  const constant = isNumber(e.width) ? number(e.width) : 0;
  const sides: PolylineSide[] = [];

  for (let i = 0; i < count; i++) {
    const pair: unknown = widths?.[i];
    const [start, end] = Array.isArray(pair) ? pair : [constant, constant];
    sides.push({
      from: points[i]!,
      to: points[(i + 1) % points.length]!,
      bulge: number(bulges?.[i]),
      startWidth: Math.max(0, number(start)),
      endWidth: Math.max(0, number(end)),
    });
  }

  return sides;
}

/** A number as written, and 0 for anything else. */
function number(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? written(value) : 0;
}

/** The key `PolylineMemo` keeps a field that is no list by, which its sides read as none. */
const NO_LIST: object = Object.freeze({});

/**
 * Values worked out for polylines, each kept for every polyline that holds the same lists of
 * points, bulges and widths, the same width and the same `closed`, since a drawing made in code
 * may share them among many. It lives for one call, so it holds what the drawing holds.
 */
export class PolylineMemo<T> {
  readonly #values = new Map<object, Map<object, Map<object, Map<string, T>>>>();

  get(e: Polyline): T | undefined {
    const [points, bulges, widths] = PolylineMemo.#lists(e);

    return this.#values.get(points)?.get(bulges)?.get(widths)?.get(PolylineMemo.#rest(e));
  }

  set(e: Polyline, value: T): void {
    const [points, bulges, widths] = PolylineMemo.#lists(e);
    let byBulges = this.#values.get(points);

    if (!byBulges) this.#values.set(points, (byBulges = new Map()));
    let byWidths = byBulges.get(bulges);

    if (!byWidths) byBulges.set(bulges, (byWidths = new Map()));
    let byRest = byWidths.get(widths);

    if (!byRest) byWidths.set(widths, (byRest = new Map()));
    byRest.set(PolylineMemo.#rest(e), value);
  }

  /** Each list as the key it is kept by: the list itself, or one key for whatever is no list. */
  static #lists(e: Polyline): [object, object, object] {
    const key = (list: readonly unknown[] | undefined): object =>
      Array.isArray(list) ? list : NO_LIST;

    return [key(e.points), key(e.bulges), key(e.widths)];
  }

  /** Whether it is closed and its width as written, which is all else its sides read. */
  static #rest(e: Polyline): string {
    return `${Boolean(e.closed)}/${isNumber(e.width) ? Math.max(0, number(e.width)) : 0}`;
  }
}

/**
 * True for a polyline that may have an arc or a width: one with a list of bulges or widths, or a
 * width greater than 0. It reads nothing but those three fields.
 */
export function mayCurve(e: Polyline): boolean {
  return (
    Array.isArray(e.bulges) || Array.isArray(e.widths) || (isNumber(e.width) && number(e.width) > 0)
  );
}

/**
 * True for a polyline with a side that is an arc or has a width. It reads no point, and of the
 * bulges and widths only a list with one item for each side, up to the side count, as
 * `polylineSides` does: a list of another length is read as all 0. The count is taken from the
 * length of the list of points, so a list with an empty slot may be taken for one with arcs, and
 * then drawn straight.
 */
export function hasArcsOrWidths(e: Polyline): boolean {
  const length = Array.isArray(e.points) ? e.points.length : 0;
  const count = length - (e.closed ? 0 : 1);

  if (!(count >= 1)) return false;

  if (isNumber(e.width) && number(e.width) > 0) return true;
  const { bulges, widths } = e;

  // Each list is read up to its first empty slot.
  if (Array.isArray(bulges) && bulges.length === count) {
    for (let i = 0; i < count && i in bulges; i++) if (number(bulges[i]) !== 0) return true;
  }

  if (Array.isArray(widths) && widths.length === count) {
    for (let i = 0; i < count && i in widths; i++) {
      const pair: unknown = widths[i];

      if (Array.isArray(pair) && (number(pair[0]) > 0 || number(pair[1]) > 0)) return true;
    }
  }

  return false;
}

/**
 * The arc of a side from `from` to `to` with a bulge, or undefined for a straight side and for
 * one whose ends are one point, which draws nothing.
 */
export function sideArc(from: Point, to: Point, bulge: number): SideArc | undefined {
  if (bulge === 0) return undefined;
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const chord = Math.hypot(dx, dy);

  if (!(chord > 0)) return undefined;
  // The center is off the middle of the chord, square to it: to its left for a bulge from 0 to 1.
  const off = (1 / bulge - bulge) / 4;
  const center: Point = [(from[0] + to[0]) / 2 - dy * off, (from[1] + to[1]) / 2 + dx * off];
  const size = Math.abs(bulge);

  return {
    center,
    radius: (chord / 4) * (size + 1 / size),
    start: Math.atan2(from[1] - center[1], from[0] - center[0]),
    sweep: 4 * Math.atan(bulge),
  };
}

/** The point of an arc at `t` of the way along it, from 0 at its start to 1 at its end. */
export function arcPoint(arc: SideArc, t: number, radius = arc.radius): Point {
  const angle = arc.start + arc.sweep * t;

  return [arc.center[0] + radius * Math.cos(angle), arc.center[1] + radius * Math.sin(angle)];
}

/** A box: least X, least Y, greatest X, greatest Y. */
export type PolylineBox = [number, number, number, number];

/**
 * Widens `box` to hold an arc of `radius` about the arc's center: its ends and each direction
 * along an axis that lies inside its sweep.
 */
export function includeArc(box: PolylineBox, arc: SideArc, radius = arc.radius): void {
  const include = ([x, y]: Point): void => {
    if (x < box[0]) box[0] = x;

    if (y < box[1]) box[1] = y;

    if (x > box[2]) box[2] = x;

    if (y > box[3]) box[3] = y;
  };

  include(arcPoint(arc, 0, radius));
  include(arcPoint(arc, 1, radius));

  const [from, to] =
    arc.sweep > 0 ? [arc.start, arc.start + arc.sweep] : [arc.start + arc.sweep, arc.start];

  const quarter = Math.PI / 2;

  for (let k = Math.ceil(from / quarter); k * quarter < to; k++) {
    const angle = k * quarter;
    include([arc.center[0] + radius * Math.cos(angle), arc.center[1] + radius * Math.sin(angle)]);
  }
}

/** True for a side that is drawn filled: one with a width at either end. */
export function isWide(side: PolylineSide): boolean {
  return side.startWidth > 0 || side.endWidth > 0;
}

/** The length of a side along its arc or its chord. */
export function sideLength(
  side: PolylineSide,
  arc = sideArc(side.from, side.to, side.bulge),
): number {
  return arc
    ? arc.radius * Math.abs(arc.sweep)
    : Math.hypot(side.to[0] - side.from[0], side.to[1] - side.from[1]);
}

/**
 * The filled shape of a wide side: its corners at its start and its end, to the left and the
 * right of the way it runs, and its arc. The corners of an arc are on the lines from its center
 * through its ends; those of a straight side are square to it, or where a join puts them.
 */
export interface Band {
  readonly side: PolylineSide;
  readonly arc: SideArc | undefined;
  startLeft: Point;
  startRight: Point;
  endLeft: Point;
  endRight: Point;
  /** Its corners ending square, whose lines are its edges, which each join reads. */
  readonly square: readonly [startLeft: Point, startRight: Point, endLeft: Point, endRight: Point];
}

/**
 * How far a join may reach, in half widths. Two straight sides meet in a miter when its corner is
 * no farther than this from the point where they meet: a turn of at most 2 acos(1/4), 151.04
 * degrees. A straight side meets an arc along the line from the arc's center through the point
 * when its edges reach that line no farther than this from where they end square: a turn whose
 * tangent is at most 4, so up to 75.96 degrees and from 104.04. Past either, both sides end
 * square, as the leading CAD app plots them.
 */
const JOIN_REACH = 4;

/**
 * The filled shape of each side of a polyline drawn solid, or undefined for a side of width 0 or
 * of no length, which a pen draws or nothing does. Where two wide sides meet, two straight ones
 * join in a miter, a straight one and an arc along the arc's line through the point, and two arcs
 * each end square; a join whose corner would reach past `JOIN_REACH` half widths is not made.
 */
export function polylineBands(
  sides: readonly PolylineSide[],
  closed: boolean,
): (Band | undefined)[] {
  const bands = sides.map((side): Band | undefined => {
    if (!isWide(side)) return undefined;
    const arc = sideArc(side.from, side.to, side.bulge);

    if (!(sideLength(side, arc) > 0)) return undefined;
    const [h0, h1] = [side.startWidth / 2, side.endWidth / 2];
    let square: Band["square"];

    if (arc) {
      // The left of an arc that turns counterclockwise is toward its center.
      const inward = arc.sweep > 0 ? 1 : -1;
      square = [
        arcPoint(arc, 0, arc.radius - inward * h0),
        arcPoint(arc, 0, arc.radius + inward * h0),
        arcPoint(arc, 1, arc.radius - inward * h1),
        arcPoint(arc, 1, arc.radius + inward * h1),
      ];
    } else {
      const [dx, dy] = [side.to[0] - side.from[0], side.to[1] - side.from[1]];
      const length = Math.hypot(dx, dy);
      const [nx, ny] = [-dy / length, dx / length];
      square = [
        [side.from[0] + nx * h0, side.from[1] + ny * h0],
        [side.from[0] - nx * h0, side.from[1] - ny * h0],
        [side.to[0] + nx * h1, side.to[1] + ny * h1],
        [side.to[0] - nx * h1, side.to[1] - ny * h1],
      ];
    }

    const [startLeft, startRight, endLeft, endRight] = square;

    return { side, arc, startLeft, startRight, endLeft, endRight, square };
  });

  const joins = closed ? bands.length : bands.length - 1;

  for (let i = 0; i < joins; i++) {
    const [a, b] = [bands[i], bands[(i + 1) % bands.length]];

    if (a && b && a !== b) join(a, b);
  }

  return bands;
}

/** The direction a band runs at its start or its end, as a unit vector. */
function heading(band: Band, end: boolean): Point {
  const { arc, side } = band;

  if (!arc) {
    const [dx, dy] = [side.to[0] - side.from[0], side.to[1] - side.from[1]];
    const length = Math.hypot(dx, dy);

    return [dx / length, dy / length];
  }

  const angle = arc.start + (end ? arc.sweep : 0);
  const turn = arc.sweep > 0 ? 1 : -1;

  return [-Math.sin(angle) * turn, Math.cos(angle) * turn];
}

/**
 * Joins band `a` to band `b`, which starts where `a` ends. Each join reads the edges of the sides
 * as they end square, so a join at one end of a short side leaves the other end's as it is.
 */
function join(a: Band, b: Band): void {
  if (a.arc && b.arc) return;
  const [u, v] = [heading(a, true), heading(b, false)];
  const cos = u[0] * v[0] + u[1] * v[1];
  const at = a.side.to;
  const [aStartLeft, aStartRight, aEndLeft, aEndRight] = a.square;
  const [bStartLeft, bStartRight, bEndLeft, bEndRight] = b.square;

  if (!a.arc && !b.arc) {
    // The miter's corner is 1 / cos(turn / 2) half widths from the point.
    if ((1 + cos) / 2 < 1 / JOIN_REACH ** 2) return;
    const left = meet(aStartLeft, aEndLeft, bStartLeft, bEndLeft);
    const right = meet(aStartRight, aEndRight, bStartRight, bEndRight);

    if (!left || !right) return;
    a.endLeft = b.startLeft = left;
    a.endRight = b.startRight = right;

    return;
  }

  // A straight side meets an arc on the arc's line through the point, tan(turn) half widths along
  // its edges from where they end square.
  const sin = u[0] * v[1] - u[1] * v[0];

  if (Math.abs(sin) > JOIN_REACH * Math.abs(cos)) return;
  const arc = (a.arc ?? b.arc)!;

  if (b.arc) {
    const left = meet(aStartLeft, aEndLeft, arc.center, at);
    const right = meet(aStartRight, aEndRight, arc.center, at);

    if (left && right) [a.endLeft, a.endRight] = [left, right];
  } else {
    const left = meet(bStartLeft, bEndLeft, arc.center, at);
    const right = meet(bStartRight, bEndRight, arc.center, at);

    if (left && right) [b.startLeft, b.startRight] = [left, right];
  }
}

/** Where the line through `a0` and `a1` meets the line through `b0` and `b1`, or undefined for parallel lines. */
function meet(a0: Point, a1: Point, b0: Point, b1: Point): Point | undefined {
  const [dx, dy] = [a1[0] - a0[0], a1[1] - a0[1]];
  const [ex, ey] = [b1[0] - b0[0], b1[1] - b0[1]];
  const cross = dx * ey - dy * ex;
  const scale = Math.hypot(dx, dy) * Math.hypot(ex, ey);

  if (!(Math.abs(cross) > scale * 1e-9)) return undefined;
  const t = ((b0[0] - a0[0]) * ey - (b0[1] - a0[1]) * ex) / cross;

  return [a0[0] + dx * t, a0[1] + dy * t];
}

/**
 * The box of what a polyline draws: its points, the arcs of its sides, and each wide side's
 * filled shape with its joins. Undefined for one with no point.
 */
export function polylineBox(e: Polyline): PolylineBox | undefined {
  const box: PolylineBox = [Infinity, Infinity, -Infinity, -Infinity];

  const include = ([x, y]: Point): void => {
    if (x < box[0]) box[0] = x;

    if (y < box[1]) box[1] = y;

    if (x > box[2]) box[2] = x;

    if (y > box[3]) box[3] = y;
  };

  for (const p of filled(e.points)) include(p);
  const sides = polylineSides(e);

  for (const side of sides) {
    const arc = sideArc(side.from, side.to, side.bulge);

    if (arc) includeArc(box, arc);
  }

  for (const band of polylineBands(sides, e.closed)) {
    if (!band) continue;

    // A dash ends square where the side drawn solid is joined.
    for (const p of [band.startLeft, band.startRight, band.endLeft, band.endRight, ...band.square])
      include(p);

    if (band.arc) {
      const most = Math.max(band.side.startWidth, band.side.endWidth) / 2;
      includeArc(box, band.arc, band.arc.radius + most);
      includeArc(box, band.arc, band.arc.radius - most);
    }
  }

  return box[0] === Infinity ? undefined : box;
}

/**
 * The bulge of the arc from `from` to `to` through `through`, for a side of a polyline. It is 0
 * when the three points are on one line.
 *
 * @throws RangeError when two of the points are one point, so that no arc passes through them.
 */
export function bulgeThrough(from: Point, through: Point, to: Point): number {
  const same = (a: Point, b: Point): boolean => a[0] === b[0] && a[1] === b[1];

  if (same(from, through) || same(through, to) || same(from, to)) {
    throw new RangeError("An arc through three points needs three different points");
  }

  // The arc turns through twice the angle between the chord and the way to `through`, as an
  // angle at the circle's edge is half the one at its center: the bulge is the tangent of half
  // the angle at `through` between the two chords, measured the other way round.
  const [ax, ay] = [from[0] - through[0], from[1] - through[1]];
  const [bx, by] = [to[0] - through[0], to[1] - through[1]];
  const cross = ax * by - ay * bx;
  const dot = ax * bx + ay * by;

  if (cross === 0) {
    if (dot < 0) return 0;
    throw new RangeError(
      "No arc passes through three points on one line, the middle one not between the others",
    );
  }

  const angle = Math.atan2(cross, dot);

  return Math.tan((Math.PI - Math.abs(angle)) / 2) * (angle < 0 ? 1 : -1);
}

/** Points and the bulge of each side between them, which a polyline holds. */
export interface Bulged {
  readonly points: Point[];
  readonly bulges: number[];
}

/**
 * Rounds each corner of a polyline with an arc of `radius` tangent to both its sides. An open
 * polyline keeps its two ends. A corner whose sides are on one line, as written, is no corner.
 * Returns what is wrong in place of the points when a corner cannot be rounded: the polyline
 * turns back on itself there, or the arcs at the two ends of a side need more of it than it has.
 */
export function rounded(
  points: readonly Point[],
  closed: boolean,
  radius: number,
): Bulged | string {
  const n = points.length;
  /** What the corner at each point becomes: the ends of its arc and its bulge, or none. */
  const corners: ({ in: Point; out: Point; bulge: number; reach: number } | undefined)[] = [];

  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      corners.push(undefined);
      continue;
    }

    const [a, p, b] = [points[(i - 1 + n) % n]!, points[i]!, points[(i + 1) % n]!];
    const [ux, uy] = [p[0] - a[0], p[1] - a[1]];
    const [vx, vy] = [b[0] - p[0], b[1] - p[1]];
    const [lu, lv] = [Math.hypot(ux, uy), Math.hypot(vx, vy)];

    if (!(lu > 0 && lv > 0)) return `the corner at point ${i} has a side of no length`;
    const turn = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const reach = radius * Math.tan(Math.abs(turn) / 2);
    // A corner the arc would leave where it is, once written, needs no arc.
    const cut: Point = [p[0] - (ux / lu) * reach, p[1] - (uy / lu) * reach];

    if (written(cut[0]) === written(p[0]) && written(cut[1]) === written(p[1])) {
      corners.push(undefined);
      continue;
    }

    if (Math.abs(turn) > Math.PI * (1 - 1e-9)) {
      return `the polyline turns back on itself at point ${i}, where no arc can round it`;
    }

    corners.push({
      in: cut,
      out: [p[0] + (vx / lv) * reach, p[1] + (vy / lv) * reach],
      bulge: Math.tan(turn / 4),
      reach,
    });
  }

  // The two arcs at a side's ends must fit in it as written: the end of the first may meet the
  // start of the second at one written point, and must not pass it. Two ends that meet exactly
  // may be written a unit or two of the last decimal past each other, and are then made one
  // point, which moves an arc's end about as far as writing it does.
  const sides = closed ? n : n - 1;
  const unit = 2.5e-6;

  for (let i = 0; i < sides; i++) {
    const [a, b] = [points[i]!, points[(i + 1) % n]!];
    const next = corners[(i + 1) % n];
    const from = corners[i]?.out ?? a;
    const to = next?.in ?? b;

    const along =
      (written(to[0]) - written(from[0])) * (b[0] - a[0]) +
      (written(to[1]) - written(from[1])) * (b[1] - a[1]);

    const close =
      Math.abs(written(to[0]) - written(from[0])) <= unit &&
      Math.abs(written(to[1]) - written(from[1])) <= unit;

    if (along < 0 && close) {
      if (next) next.in = from;
      else if (corners[i]) corners[i]!.out = to;
      continue;
    }

    // Arcs that need more of the side than it has end past each other, so this is where both
    // refusals are made.
    if (along < 0) {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const need = (corners[i]?.reach ?? 0) + (corners[(i + 1) % n]?.reach ?? 0);
      const between = `the arcs at points ${i} and ${(i + 1) % n}`;

      return written(need) > written(length)
        ? `${between} need ${written(need)} of the side between them, which is ${written(length)} long: give a smaller radius`
        : `${between} end past each other once their ends are written to 6 decimals: give a radius a little smaller`;
    }
  }

  const out: Point[] = [];
  const bulges: number[] = [];

  /** Adds a point, with the bulge of the side that starts there, unless it is the last one again. */
  const add = (p: Point, bulge: number): void => {
    const last = out.at(-1);

    if (last && written(last[0]) === written(p[0]) && written(last[1]) === written(p[1])) {
      bulges[bulges.length - 1] = bulge;

      return;
    }

    out.push(p);
    bulges.push(bulge);
  };

  for (let i = 0; i < n; i++) {
    const corner = corners[i];

    if (corner) {
      add(corner.in, corner.bulge);
      add(corner.out, 0);
    } else add(points[i]!, 0);
  }

  if (closed && out.length > 1) {
    // The last point may be the first again, where a side between two arcs had no length left.
    const [first, last] = [out[0]!, out.at(-1)!];

    if (written(first[0]) === written(last[0]) && written(first[1]) === written(last[1])) {
      out.pop();
      bulges.pop();
    }
  }

  if (!closed) bulges.pop();

  return { points: out, bulges };
}

/**
 * The bulge of each arc of a revision cloud: each turns through 110 degrees, as the arcs of the
 * leading CAD app's own clouds do.
 */
export const CLOUD_BULGE = Math.tan((110 / 4) * (Math.PI / 180));

/** The most arcs a cloud has, so that a short arc along a long outline cannot fill memory. */
export const MAX_CLOUD_ARCS = 10_000;

/**
 * How many arcs `cloud` puts along an outline, worked out before any is made, from its first
 * point as `cloud` works.
 */
export function arcsAlong(given: readonly Point[], arc: number): number {
  const [ox, oy] = given[0] ?? [0, 0];
  const outline = given.map(([x, y]): Point => [x - ox, y - oy]);
  let count = 0;

  for (let i = 0; i < outline.length; i++) {
    const [a, b] = [outline[i]!, outline[(i + 1) % outline.length]!];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);

    if (written(length) !== 0) count += Math.max(1, Math.round(length / arc));
  }

  return count;
}

/**
 * A revision cloud along a closed outline: arcs from point to point along each side, as many on a
 * side as the length over `arc` gives, rounded and at least one, each bulging out of the outline.
 * An arc turns through less than half a circle, so it stays beside its own stretch of the side,
 * and no arc may cross the outline, so the cloud never enters it: drawn around what it marks, it
 * crosses none of it. Returns what is wrong in place of the points for an outline with no area,
 * and for one with a notch an arc would reach across.
 */
export function cloud(given: readonly Point[], arc: number): Bulged | string {
  // Worked out from the first point, so that a cloud at a survey's coordinates is as exact as one
  // at the origin.
  const [ox, oy] = given[0] ?? [0, 0];
  const outline = given.map(([x, y]): Point => [x - ox, y - oy]);
  const made = cloudAt(outline, arc, [ox, oy]);

  if (isString(made)) return made;

  return { points: made.points.map(([x, y]): Point => [x + ox, y + oy]), bulges: made.bulges };
}

/** `cloud` along an outline near the origin, which messages name from `origin`. */
function cloudAt(outline: readonly Point[], arc: number, origin: Point): Bulged | string {
  const named = ([x, y]: Point): string => `(${written(x + origin[0])}, ${written(y + origin[1])})`;
  let area = 0;

  for (let i = 0; i < outline.length; i++) {
    const [a, b] = [outline[i]!, outline[(i + 1) % outline.length]!];
    area += a[0] * b[1] - b[0] * a[1];
  }

  if (!(Math.abs(area) > 0)) return "the outline of a cloud must enclose an area";
  // A positive bulge bulges to the right of the way it runs, which is out of an outline that
  // runs counterclockwise.
  const bulge = area > 0 ? CLOUD_BULGE : -CLOUD_BULGE;
  const points: Point[] = [];
  // The side of the outline each arc is on, by the point it starts at.
  const sideOf: number[] = [];

  for (let i = 0; i < outline.length; i++) {
    const [a, b] = [outline[i]!, outline[(i + 1) % outline.length]!];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);

    if (written(length) === 0) continue;
    const count = Math.max(1, Math.round(length / arc));

    for (let k = 0; k < count; k++) {
      points.push([a[0] + ((b[0] - a[0]) * k) / count, a[1] + ((b[1] - a[1]) * k) / count]);
      sideOf.push(i);
    }
  }

  // An arc bulges out of its own side, and in a notch narrower than it bulges it can reach the
  // notch's far wall, which is another side. The check reads the cloud and the outline as the file
  // would hold them, with their points and the bulge written. An arc is not held to its own side,
  // which writing its ends may move it across by a hair.
  const writ = ([x, y]: Point): Point => [
    written(x + origin[0]) - origin[0],
    written(y + origin[1]) - origin[1],
  ];

  const cloudPoints = points.map(writ);
  const walls = outline.map(writ);

  for (let k = 0; k < cloudPoints.length; k++) {
    const [from, to] = [cloudPoints[k]!, cloudPoints[(k + 1) % cloudPoints.length]!];
    const curve = sideArc(from, to, written(bulge));

    if (!curve) continue;
    const box: PolylineBox = [Infinity, Infinity, -Infinity, -Infinity];
    includeArc(box, curve);

    for (let i = 0; i < walls.length; i++) {
      if (i === sideOf[k]) continue;
      const [a, b] = [walls[i]!, walls[(i + 1) % walls.length]!];

      if (Math.max(a[0], b[0]) < box[0] || Math.min(a[0], b[0]) > box[2]) continue;

      if (Math.max(a[1], b[1]) < box[1] || Math.min(a[1], b[1]) > box[3]) continue;
      const crossing = arcCrossing(curve, a, b);

      if (crossing) {
        return `the cloud's arc from ${named(from)} reaches across the outline at ${named(crossing)}, as in a notch narrower than an arc bulges: give a shorter arc`;
      }
    }
  }

  return { points, bulges: points.map(() => bulge) };
}

/**
 * Where an arc crosses the segment from `a` to `b`, away from the arc's two ends, which lie on the
 * outline; undefined where it does not.
 */
function arcCrossing(arc: SideArc, a: Point, b: Point): Point | undefined {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const [fx, fy] = [a[0] - arc.center[0], a[1] - arc.center[1]];
  const qa = dx * dx + dy * dy;

  if (!(qa > 0)) return undefined;
  const qb = 2 * (fx * dx + fy * dy);
  const qc = fx * fx + fy * fy - arc.radius * arc.radius;
  const root = qb * qb - 4 * qa * qc;

  if (root < 0) return undefined;
  const ends = [arcPoint(arc, 0), arcPoint(arc, 1)];
  const near = 1e-9 * (arc.radius + Math.sqrt(qa));

  for (const sign of [-1, 1]) {
    const t = (-qb + sign * Math.sqrt(root)) / (2 * qa);

    if (t < 0 || t > 1) continue;
    const p: Point = [a[0] + dx * t, a[1] + dy * t];

    if (ends.some(([x, y]) => Math.hypot(p[0] - x, p[1] - y) <= near)) continue;
    // On the arc when its angle from the arc's start, the way the arc turns, is inside its sweep.
    const angle = Math.atan2(p[1] - arc.center[1], p[0] - arc.center[0]) - arc.start;
    const turn = 2 * Math.PI;
    const along = arc.sweep > 0 ? ((angle % turn) + turn) % turn : ((-angle % turn) + turn) % turn;

    if (along < Math.abs(arc.sweep)) return p;
  }

  return undefined;
}

/**
 * A donut of `outside` across about `center`, with a hole `inside` across: a closed polyline of
 * two half circles, as wide as the ring, through the middle of the ring.
 */
export function donut(center: Point, outside: number, inside: number): Bulged & { width: number } {
  const middle = (outside + inside) / 4;

  return {
    points: [
      [center[0] - middle, center[1]],
      [center[0] + middle, center[1]],
    ],
    bulges: [1, 1],
    width: (outside - inside) / 2,
  };
}
