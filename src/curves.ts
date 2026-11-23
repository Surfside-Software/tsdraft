/**
 * What an ellipse and a spline draw: the points of each, the spline the leading CAD app fits
 * through fit points, and the pieces the pictures draw them in. The writers, the plots, the
 * extents and the readers all take an ellipse and a spline from here.
 */
import type { Point } from "./drawing.ts";

/**
 * How the knots of a spline through fit points are spaced: by the chords between the points,
 * their square roots, or alike. A DXF holds chord alone; a DWG may hold another.
 */
export type KnotSpacing = "chord" | "square-root" | "uniform";

type Xy = readonly [number, number];

const TAU = 2 * Math.PI;

/** The parameter `t` of an ellipse turned into [0, 2π). */
export function unturned(t: number): number {
  const r = t % TAU;

  return r < 0 ? r + TAU : r;
}

/** A point of an ellipse about `center`, with `major` from the center and the minor `ratio`. */
export function ellipsePoint(center: Xy, major: Xy, ratio: number, t: number): [number, number] {
  const [c, s] = [Math.cos(t), Math.sin(t)];

  return [
    center[0] + major[0] * c - major[1] * ratio * s,
    center[1] + major[1] * c + major[0] * ratio * s,
  ];
}

/** The span of a B-spline's knots that holds `u`, among those the curve runs over. */
function spanOf(degree: number, knots: readonly number[], count: number, u: number): number {
  const last = count - 1;

  if (u >= knots[last + 1]!) {
    let k = last;

    while (k > degree && knots[k]! >= knots[last + 1]!) k--;

    return k;
  }

  let [lo, hi] = [degree, last + 1];

  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;

    if (u < knots[mid]!) hi = mid;
    else lo = mid;
  }

  return lo;
}

/**
 * A point of a B-spline at `u`, rational when `weights` are given, by de Boor's steps on the
 * control points of the span that holds `u`.
 */
export function splinePoint(
  degree: number,
  knots: readonly number[],
  points: readonly Xy[],
  weights: readonly number[] | undefined,
  u: number,
): [number, number] {
  const k = spanOf(degree, knots, points.length, u);
  const d: [number, number, number][] = [];

  for (let j = 0; j <= degree; j++) {
    const p = points[k - degree + j]!;
    const w = weights?.[k - degree + j] ?? 1;
    d.push([p[0] * w, p[1] * w, w]);
  }

  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const i = k - degree + j;
      const span = knots[i + degree - r + 1]! - knots[i]!;
      const a = span === 0 ? 0 : (u - knots[i]!) / span;
      const [p, q] = [d[j - 1]!, d[j]!];
      d[j] = [(1 - a) * p[0] + a * q[0], (1 - a) * p[1] + a * q[1], (1 - a) * p[2] + a * q[2]];
    }
  }

  const [x, y, w] = d[degree]!;

  return [x / w, y / w];
}

/** The knots of a B-spline that bound the pieces it draws: from `knots[degree]` to `knots[count]`. */
export function splineBreaks(degree: number, knots: readonly number[], count: number): number[] {
  const out: number[] = [];

  for (let i = degree; i <= count; i++) {
    const u = knots[i]!;

    if (out.length === 0 || u > out[out.length - 1]!) out.push(u);
  }

  return out;
}

/**
 * The points a B-spline is drawn through: each piece between two knots cut into `steps` of equal
 * parameter, the ends of the pieces among them.
 */
export function splinePolyline(
  degree: number,
  knots: readonly number[],
  points: readonly Xy[],
  weights: readonly number[] | undefined,
  steps: number,
): [number, number][] {
  const breaks = splineBreaks(degree, knots, points.length);
  const out: [number, number][] = [];

  for (let b = 0; b + 1 < breaks.length; b++) {
    const [u0, u1] = [breaks[b]!, breaks[b + 1]!];

    for (let s = b === 0 ? 0 : 1; s <= steps; s++)
      out.push(splinePoint(degree, knots, points, weights, u0 + ((u1 - u0) * s) / steps));
  }

  return out;
}

/** The parameter of each fit point, from 0, spaced as `spacing` says. */
/** How far a fit point's parameter is from the last one's, for a chord of that length. */
function stepOf(spacing: KnotSpacing, chord: number): number {
  switch (spacing) {
    case "chord":
      return chord;
    case "square-root":
      return Math.sqrt(chord);
    default:
      return 1;
  }
}

export function fitParameters(points: readonly Xy[], spacing: KnotSpacing): number[] {
  const out = [0];

  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1]!, points[i]!];
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
    out.push(out[i - 1]! + stepOf(spacing, chord));
  }

  return out;
}

/** A cubic B-spline through fit points: its knots and control points. */
export interface FittedSpline {
  readonly knots: readonly number[];
  readonly controlPoints: readonly Point[];
  /** For a closed spline, the direction it runs through its first point in, at both ends. */
  readonly tangent?: Point;
}

/**
 * The values at `u` of the `degree + 1` basis functions of the knots that are not 0 in the span
 * `span`: those of control points `span - degree` to `span`.
 */
function basisAt(degree: number, knots: readonly number[], span: number, u: number): number[] {
  const out = [1];
  const left: number[] = [];
  const right: number[] = [];

  for (let j = 1; j <= degree; j++) {
    left[j] = u - knots[span + 1 - j]!;
    right[j] = knots[span + j]! - u;
    let saved = 0;

    for (let r = 0; r < j; r++) {
      const term = out[r]! / (right[r + 1]! + left[j - r]!);
      out[r] = saved + right[r + 1]! * term;
      saved = left[j - r]! * term;
    }

    out[j] = saved;
  }

  return out;
}

/** One row of a system of three diagonals: what it holds of the unknown before, its own and the next. */
interface Row {
  readonly before: number;
  readonly own: number;
  readonly next: number;
  readonly value: Xy;
}

/** Solves a system of three diagonals by the Thomas algorithm. */
function threeDiagonals(rows: readonly Row[]): [number, number][] {
  const m = rows.length;
  const own = rows.map((r) => r.own);
  const value = rows.map((r): [number, number] => [r.value[0], r.value[1]]);

  for (let i = 1; i < m; i++) {
    const w = rows[i]!.before / own[i - 1]!;
    own[i] = own[i]! - w * rows[i - 1]!.next;
    value[i] = [value[i]![0] - w * value[i - 1]![0], value[i]![1] - w * value[i - 1]![1]];
  }

  const out: [number, number][] = new Array(m);
  out[m - 1] = [value[m - 1]![0] / own[m - 1]!, value[m - 1]![1] / own[m - 1]!];

  for (let i = m - 2; i >= 0; i--)
    out[i] = [
      (value[i]![0] - rows[i]!.next * out[i + 1]![0]) / own[i]!,
      (value[i]![1] - rows[i]!.next * out[i + 1]![1]) / own[i]!,
    ];

  return out;
}

/**
 * The control points of the clamped cubic through `points` at the knots `knots`: the first and
 * last are the end points, and each end either leaves with the derivative given or, with none
 * given, bends not at all there.
 */
function throughPoints(
  points: readonly Xy[],
  knots: readonly number[],
  startDerivative: Xy | undefined,
  endDerivative: Xy | undefined,
): Point[] {
  const n = points.length - 1;
  const count = n + 3;
  const [first, last] = [points[0]!, points[n]!];
  const t = (i: number) => knots[i]!;
  // The unknowns are control points 1 to count - 2.
  const rows: Row[] = [];

  if (startDerivative) {
    const f = (t(4) - t(1)) / 3;
    rows.push({
      before: 0,
      own: 1,
      next: 0,
      value: [first[0] + f * startDerivative[0], first[1] + f * startDerivative[1]],
    });
  } else {
    // No bend at the start: (P2 - P1) / (t5 - t2) = (P1 - P0) / (t4 - t1).
    const [a, b] = [t(4) - t(1), t(5) - t(2)];
    rows.push({
      before: 0,
      own: -(1 / a + 1 / b),
      next: 1 / b,
      value: [-first[0] / a, -first[1] / a],
    });
  }

  for (let k = 1; k <= n - 1; k++) {
    const [a, b, c] = basisAt(3, knots, k + 3, t(k + 3));
    rows.push({ before: a!, own: b!, next: c!, value: points[k]! });
  }

  if (endDerivative) {
    const f = (t(count) - t(count - 1)) / 3;
    rows.push({
      before: 0,
      own: 1,
      next: 0,
      value: [last[0] - f * endDerivative[0], last[1] - f * endDerivative[1]],
    });
  } else {
    const [a, b] = [t(count) - t(count - 1), t(count) - t(count - 2)];
    rows.push({
      before: 1 / b,
      own: -(1 / a + 1 / b),
      next: 0,
      value: [-last[0] / a, -last[1] / a],
    });
  }

  return [[first[0], first[1]], ...threeDiagonals(rows), [last[0], last[1]]];
}

/**
 * The cubic the leading CAD app fits through fit points: clamped knots at each point's parameter,
 * and an end's tangent given, as a direction, or worked out where it is not. Closed, it runs
 * through the points and the first again, with one tangent at both ends, worked out where they
 * join, which it returns.
 */
export function fitSpline(
  points: readonly Xy[],
  spacing: KnotSpacing,
  startTangent?: Xy,
  endTangent?: Xy,
  closed = false,
): FittedSpline {
  if (closed) {
    const ring = [...points, points[0]!];
    const tangent = joinTangent(ring, spacing);

    return { ...fitSpline(ring, spacing, tangent, tangent), tangent };
  }

  const u = fitParameters(points, spacing);
  const n = points.length - 1;
  const [u0, un] = [u[0]!, u[n]!];
  const knots = [u0, u0, u0, ...u, un, un, un];
  // A tangent is a direction: the curve leaves along it at the pace of its parameter, a unit of
  // chord for each unit of parameter.
  let chords = 0;

  for (let i = 1; i <= n; i++)
    chords += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  const pace = un - u0 > 0 ? chords / (un - u0) : 1;

  const derivative = (v: Xy | undefined): Xy | undefined => {
    if (v === undefined) return undefined;
    const l = Math.hypot(v[0], v[1]);

    return [(v[0] / l) * pace, (v[1] / l) * pace];
  };

  return {
    knots,
    controlPoints: throughPoints(points, knots, derivative(startTangent), derivative(endTangent)),
  };
}

/** A point in homogeneous coordinates: x and y times the weight, and the weight. */
export type Weighted = readonly [number, number, number];

/**
 * The Bézier pieces of a B-spline, one for each span of knots with a length between
 * `knots[degree]` and `knots[count]`: `degree + 1` control points each, in homogeneous
 * coordinates, which a rational spline needs. Each comes from the blossom of its span, in time in
 * proportion to the control points.
 */
export function splinePieces(
  degree: number,
  knots: readonly number[],
  points: readonly Xy[],
  weights: readonly number[] | undefined,
): Weighted[][] {
  const out: Weighted[][] = [];

  const [dx, dy, dw] = [
    new Float64Array(degree + 1),
    new Float64Array(degree + 1),
    new Float64Array(degree + 1),
  ];

  const count = points.length;

  for (let i = degree; i < count; i++) {
    const [a, b] = [knots[i]!, knots[i + 1]!];

    if (!(b > a)) continue;
    const piece: Weighted[] = [];

    for (let j = 0; j <= degree; j++) {
      // The blossom at `a` taken degree - j times and `b` taken j times.
      for (let k = 0; k <= degree; k++) {
        const p = points[i - degree + k]!;
        const w = weights?.[i - degree + k] ?? 1;
        [dx[k], dy[k], dw[k]] = [p[0] * w, p[1] * w, w];
      }

      for (let r = 1; r <= degree; r++) {
        const t = r <= degree - j ? a : b;

        for (let k = degree; k >= r; k--) {
          const at = i - degree + k;
          const span = knots[at + degree - r + 1]! - knots[at]!;
          const f = span === 0 ? 0 : (t - knots[at]!) / span;
          dx[k] = (1 - f) * dx[k - 1]! + f * dx[k]!;
          dy[k] = (1 - f) * dy[k - 1]! + f * dy[k]!;
          dw[k] = (1 - f) * dw[k - 1]! + f * dw[k]!;
        }
      }

      piece.push([dx[degree]!, dy[degree]!, dw[degree]!]);
    }

    out.push(piece);
  }

  return out;
}

/** A box: its least x and y, and its greatest. */
export type CurveBox = [number, number, number, number];

/** A Bézier piece cut in two at its middle. */
function halves(part: readonly Weighted[]): [Weighted[], Weighted[]] {
  let row: Weighted[] = [...part];
  const left: Weighted[] = [row[0]!];
  const right: Weighted[] = [row[row.length - 1]!];

  while (row.length > 1) {
    const next: Weighted[] = [];

    for (let k = 0; k + 1 < row.length; k++) {
      const [p, q] = [row[k]!, row[k + 1]!];
      next.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]);
    }

    left.push(next[0]!);
    right.push(next[next.length - 1]!);
    row = next;
  }

  return [left, right.reverse()];
}

/**
 * The box of a B-spline, from its curve. It passes through the ends of its Bézier pieces, and
 * each piece lies inside the hull of its control points, so a piece whose hull stays inside the
 * box of the ends is left as it is. A side a piece's hull reaches past is cut in two, as de
 * Casteljau cuts it, where it can still reach past the box, until the hull is within `tolerance`
 * of the curve or the cuts, 64 a side, run out, and the hull's side is taken. So the box holds the
 * curve, with at most `tolerance` more on a side but where the cuts ran out.
 */
export function splineBox(
  degree: number,
  knots: readonly number[],
  points: readonly Xy[],
  weights: readonly number[] | undefined,
  tolerance: number,
): CurveBox | undefined {
  const pieces = splinePieces(degree, knots, points, weights);

  if (pieces.length === 0) return undefined;
  const box: CurveBox = [Infinity, Infinity, -Infinity, -Infinity];

  for (const piece of pieces) {
    for (const p of [piece[0]!, piece[degree]!]) {
      const [x, y] = [p[0] / p[2], p[1] / p[2]];
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
    }
  }

  // Each of the four sides: the axis and whether it is the greatest.
  for (let side = 0; side < 4; side++) {
    const [axis, sign] = [side % 2, side >= 2 ? 1 : -1];
    const value = (p: Weighted): number => (sign * p[axis]!) / p[2];

    const reachOf = (part: readonly Weighted[]): number => {
      let most = -Infinity;

      for (const p of part) most = Math.max(most, value(p));

      return most;
    };

    let best = sign * box[side]!;

    for (const piece of pieces) {
      if (reachOf(piece) <= best) continue;
      let cuts = 0;
      const stack: Weighted[][] = [piece];

      while (stack.length > 0) {
        const part = stack.pop()!;
        const reach = reachOf(part);

        if (reach <= best) continue;
        best = Math.max(best, value(part[0]!), value(part[part.length - 1]!));

        if (reach - best <= tolerance || cuts >= 64) {
          best = reach;
          continue;
        }

        cuts++;
        stack.push(...halves(part));
      }
    }

    box[side] = sign * best;
  }

  return box;
}

/**
 * The box of an ellipse, or of its arc from `start` counterclockwise to `end` in radians: the
 * ends of the arc, and the parameters where x and y are greatest and least that it runs through.
 */
export function ellipseBox(
  center: Xy,
  major: Xy,
  ratio: number,
  start?: number,
  end?: number,
): CurveBox {
  const whole = start === undefined || end === undefined;
  const from = whole ? 0 : unturned(start);
  let sweep = whole ? TAU : unturned(end) - from;

  if (sweep <= 0) sweep += TAU;
  const ts: number[] = whole ? [] : [from, from + sweep];

  // x is greatest where its derivative, -major.x sin t - major.y ratio cos t, is 0, and least
  // half a turn on; y likewise.
  for (const t0 of [
    Math.atan2(-major[1] * ratio, major[0]),
    Math.atan2(major[0] * ratio, major[1]),
  ])
    for (const t of [t0, t0 + Math.PI]) {
      const on = unturned(t - from);

      if (whole || on <= sweep) ts.push(from + on);
    }

  const box: CurveBox = [Infinity, Infinity, -Infinity, -Infinity];

  for (const t of ts) {
    const [x, y] = ellipsePoint(center, major, ratio, t);
    box[0] = Math.min(box[0], x);
    box[1] = Math.min(box[1], y);
    box[2] = Math.max(box[2], x);
    box[3] = Math.max(box[3], y);
  }

  return box;
}

/**
 * The direction a closed spline through `ring`, whose last point is its first again, runs through
 * its first point in: that of the cubic that closes through the points smooth to its second
 * derivative.
 */
function joinTangent(ring: readonly Xy[], spacing: KnotSpacing): Point {
  // The derivatives D of the cubic that closes smooth to its second derivative through the m
  // points, each span i as long in parameter as h[i]: for each point,
  // h[i] D[i-1] + 2 (h[i-1] + h[i]) D[i] + h[i-1] D[i+1] = 3 (h[i] / h[i-1] (P[i] - P[i-1]) +
  // h[i-1] / h[i] (P[i+1] - P[i])), a cyclic system of three diagonals.
  const m = ring.length - 1;
  const u = fitParameters(ring, spacing);
  const h = (i: number) => u[(((i % m) + m) % m) + 1]! - u[((i % m) + m) % m]!;
  const P = (i: number) => ring[((i % m) + m) % m]!;
  const rows: Row[] = [];

  for (let i = 0; i < m; i++) {
    const [a, b] = [h(i - 1), h(i)];

    const along = (k: 0 | 1): number =>
      3 * ((b / a) * (P(i)[k] - P(i - 1)[k]) + (a / b) * (P(i + 1)[k] - P(i)[k]));

    const value: Xy = [along(0), along(1)];

    rows.push({ before: b, own: 2 * (a + b), next: a, value });
  }

  return cyclicFirst(rows);
}

/**
 * The first unknown of a cyclic system of three diagonals, whose first row also holds the last
 * unknown by `before` and whose last row the first by `next`, by the Sherman-Morrison formula.
 */
function cyclicFirst(rows: readonly Row[]): Point {
  const m = rows.length;
  const [corner, last] = [rows[0]!.before, rows[m - 1]!.next];
  const gamma = -rows[0]!.own;

  // The system less the corners, and `u` (gamma at the first, the last corner at the end).
  const plain = rows.map((r, i): Row => ({
    before: i === 0 ? 0 : r.before,
    own: i === 0 ? r.own - gamma : i === m - 1 ? r.own - (last * corner) / gamma : r.own,
    next: i === m - 1 ? 0 : r.next,
    value: r.value,
  }));

  const x = threeDiagonals(plain);

  const z = threeDiagonals(
    plain.map((r, i): Row => ({ ...r, value: [i === 0 ? gamma : i === m - 1 ? last : 0, 0] })),
  );

  const shared = 1 + z[0]![0] + (corner * z[m - 1]![0]) / gamma;
  const factor = (k: 0 | 1) => (x[0]![k] + (corner * x[m - 1]![k]) / gamma) / shared;

  return [x[0]![0] - factor(0) * z[0]![0], x[0]![1] - factor(1) * z[0]![0]];
}

/** A B-spline: its degree, knots, control points and, for a rational one, weights. */
export interface BSpline {
  readonly degree: number;
  readonly knots: readonly number[];
  readonly controlPoints: readonly Point[];
  readonly weights?: readonly number[];
}

/**
 * The same curve with clamped knots: its first and last knot each `degree + 1` times, so it
 * starts on its first control point and ends on its last, as the leading CAD app saves every
 * spline. Knots are inserted at the ends of what it runs over, one at a time as Boehm inserts
 * them, and the knots and control points outside are dropped. A clamped spline comes back as it
 * is.
 */
export function clamped(spline: BSpline): BSpline {
  const { degree: p } = spline;
  let knots = [...spline.knots];

  let points: Weighted[] = spline.controlPoints.map((q, i) => {
    const w = spline.weights?.[i] ?? 1;

    return [q[0] * w, q[1] * w, w];
  });

  const [a, b] = [knots[p]!, knots[spline.controlPoints.length]!];

  /** Inserts `u` once in the span from knot `k`, which holds it. */
  const insert = (u: number, k: number): void => {
    const next: Weighted[] = [];

    for (let i = 0; i <= points.length; i++) {
      if (i <= k - p) next.push(points[i]!);
      else if (i > k) next.push(points[i - 1]!);
      else {
        const f = (u - knots[i]!) / (knots[i + p]! - knots[i]!);
        const [q, r] = [points[i - 1]!, points[i]!];
        next.push([
          (1 - f) * q[0] + f * r[0],
          (1 - f) * q[1] + f * r[1],
          (1 - f) * q[2] + f * r[2],
        ]);
      }
    }

    knots.splice(k + 1, 0, u);
    points = next;
  };

  const count = (u: number) => knots.filter((t) => t === u).length;

  // At the start, in the span that ends after `a`; at the end, in the span that ends at `b`.
  for (let s = count(a); s < p + 1; s++) insert(a, knots.lastIndexOf(a));
  const first = knots.lastIndexOf(a) - p;
  knots = knots.slice(first);
  points = points.slice(first);

  for (let s = count(b); s < p + 1; s++) insert(b, knots.indexOf(b) - 1);
  const last = knots.indexOf(b);
  knots = knots.slice(0, last + p + 1);
  points = points.slice(0, last);

  const controlPoints = points.map(([x, y, w]): Point => [x / w, y / w]);

  return spline.weights === undefined
    ? { degree: p, knots, controlPoints }
    : { degree: p, knots, controlPoints, weights: points.map(([, , w]) => w) };
}
