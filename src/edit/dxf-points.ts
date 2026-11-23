// New points of one DXF record, as a stretch or a vertices statement gives them: a light
// polyline's vertices and bulges, a 2D polyline's vertex records, an arc through its new ends,
// and an associative hatch's loops. Only the values that change are written again, but for a
// light polyline given another number of vertices, whose vertices are written anew.
import type { Point } from "../drawing.ts";
import type { ReadArc, ReadHatch, ReadPolyline } from "../read/model.ts";
import { facingOf, own } from "./dxf-move.ts";
import { numberAs, shortest, type HeldGroup, type Splice } from "./dxf-groups.ts";
import { sidesOf } from "./stretch.ts";

/** A record's own groups, outside its braces and its extended data, in order. */
const ownGroups = (groups: readonly HeldGroup[]): HeldGroup[] =>
  [...own(groups)].map(([i]) => groups[i]!);

/** The splice that sets a number group, where its value changes. */
function set(out: Splice[], g: HeldGroup | undefined, value: number): boolean {
  if (g === undefined) return false;

  if (Number(g.value) !== value) out.push(numberAs(g, value));

  return true;
}

const line = (code: number, value: string, end: string): string =>
  `${String(code).padStart(3)}${end}${value}${end}`;

/** A world point in the coordinates of a record that faces `face`, and back. */
const own2 = (p: Point, face: 1 | -1): Point => (face === 1 ? p : [-p[0], p[1]]);

/** A light polyline's vertices and bulges, the count of them changed or not. */
export function lwpolylinePoints(groups: readonly HeldGroup[], e: ReadPolyline): Splice[] | string {
  const face = facingOf(groups);

  if (face === 0) return "the LWPOLYLINE is not in the plan's plane";
  const held = ownGroups(groups);
  const vertices: { at: HeldGroup; y: HeldGroup; bulge?: HeldGroup; last: HeldGroup }[] = [];

  for (let k = 0; k < held.length; k++) {
    const g = held[k]!;

    if (g.code === 10) {
      const y = held[k + 1];

      if (y?.code !== 20) return "the record holds a vertex whose group 10 has no 20 after it";
      vertices.push({ at: g, y, last: y });
      k++;
      continue;
    }

    const v = vertices[vertices.length - 1];

    if (v === undefined) continue;

    if (g.code === 40 || g.code === 41 || g.code === 91) v.last = g;
    else if (g.code === 42) v.last = v.bulge = g;
  }

  if (vertices.length === 0) return "the LWPOLYLINE holds no vertices";
  const count = held.find((g) => g.code === 90);

  if (count === undefined || Number(count.value) !== vertices.length)
    return "the record's count of vertices, group 90, is not the vertices it holds";
  const end = groups[0]?.eol ?? "\r\n";
  const bulges = e.bulges ?? [];
  const bulgeOf = (i: number): number => face * (bulges[i] ?? 0);
  const out: Splice[] = [];

  if (vertices.length === e.points.length) {
    e.points.forEach((p, i) => {
      const v = vertices[i]!;
      const [x, y] = own2(p, face);
      set(out, v.at, x);
      set(out, v.y, y);
      const b = i < sidesOf(e.points.length, e.closed) ? bulgeOf(i) : 0;

      if (!set(out, v.bulge, b) && b !== 0)
        out.push({ from: v.last.end, to: v.last.end, text: line(42, shortest(b), end) });
    });

    return out;
  }

  if (held.some((g) => g.code === 40 || g.code === 41 || g.code === 91))
    return "the record holds widths or ids of each vertex, which another count of vertices would part from them";

  const text = e.points
    .map((p, i) => {
      const [x, y] = own2(p, face);
      const b = i < sidesOf(e.points.length, e.closed) ? bulgeOf(i) : 0;

      return `${line(10, shortest(x), end)}${line(20, shortest(y), end)}${b === 0 ? "" : line(42, shortest(b), end)}`;
    })
    .join("");

  out.push(numberAs(count, e.points.length));
  out.push({ from: vertices[0]!.at.start, to: vertices[vertices.length - 1]!.last.end, text });

  return out;
}

/** A 2D polyline's vertex records, one for each point, in its coordinates. */
export function vertexRecordPoints(
  polyline: readonly HeldGroup[],
  records: readonly (readonly HeldGroup[])[],
  e: ReadPolyline,
): Splice[][] | string {
  const face = facingOf(polyline);

  if (face === 0) return "the POLYLINE is not in the plan's plane";

  if (records.length !== e.points.length)
    return "the 2D polyline holds another number of vertex records than it is given points";
  const flags = Number(ownGroups(polyline).find((g) => g.code === 70)?.value ?? 0);

  if ((flags & 6) !== 0) return "the 2D polyline is fitted, by a curve or a spline";
  const sides = sidesOf(e.points.length, e.closed);

  return records.map((groups, i) => {
    const held = ownGroups(groups);
    const out: Splice[] = [];
    const x = held.find((g) => g.code === 10);
    const y = held.find((g) => g.code === 20);
    const [px, py] = own2(e.points[i]!, face);
    set(out, x, px);
    set(out, y, py);
    const b = i < sides ? face * (e.bulges?.[i] ?? 0) : 0;
    const bulge = held.find((g) => g.code === 42);

    if (!set(out, bulge, b) && b !== 0) {
      const after = [41, 40, 30, 20].map((c) => held.find((g) => g.code === c)).find(Boolean);

      if (after !== undefined)
        out.push({ from: after.end, to: after.end, text: line(42, shortest(b), after.eol) });
    }

    return out;
  });
}

/** An arc through its new ends: its center, radius and angles. */
export function arcPoints(groups: readonly HeldGroup[], e: ReadArc): Splice[] | string {
  if (facingOf(groups) !== 1) return "the ARC is not seen from above, +Z";
  const held = ownGroups(groups);
  const g = (code: number) => held.find((h) => h.code === code);
  const out: Splice[] = [];

  if (
    !set(out, g(10), e.center[0]) ||
    !set(out, g(20), e.center[1]) ||
    !set(out, g(40), e.radius) ||
    !set(out, g(50), e.start) ||
    !set(out, g(51), e.end)
  )
    return "the ARC lacks one of its groups 10, 20, 40, 50 and 51";

  return out;
}

/**
 * An associative hatch's loops: a polyline loop's points and bulges, or the ends of a loop of
 * lines, each loop as the read holds it after the stretch.
 */
export function hatchLoopPoints(groups: readonly HeldGroup[], e: ReadHatch): Splice[] | string {
  if (facingOf(groups) !== 1) return "the HATCH is not seen from above, +Z";
  const held = ownGroups(groups);
  const start = held.findIndex((g) => g.code === 91);

  if (start < 0 || Number(held[start]!.value) !== e.loops.length)
    return "the HATCH holds another number of loops than its read";
  const out: Splice[] = [];
  let k = start + 1;

  const next = (code: number): HeldGroup | undefined => {
    const g = held[k];

    if (g?.code !== code) return undefined;
    k++;

    return g;
  };

  const point = (code: number, p: Point): boolean => {
    const x = next(code);
    const y = next(code + 10);

    return set(out, x, p[0]) && set(out, y, p[1]);
  };

  for (const loop of e.loops) {
    const flags = next(92);

    if (flags === undefined) return "a loop of the HATCH does not start with its group 92";
    const n = loop.points.length;

    if ((Number(flags.value) & 2) !== 0) {
      const bulged = Number(next(72)?.value ?? 0) === 1;

      if (next(73) === undefined || Number(next(93)?.value) !== n)
        return "a polyline loop of the HATCH holds another number of points than its read";

      for (let i = 0; i < n; i++) {
        if (!point(10, loop.points[i]!)) return "a polyline loop's point is not 10 and 20";

        if (bulged && !set(out, next(42), loop.bulges?.[i] ?? 0))
          return "a polyline loop's point has no bulge, 42";

        if (!bulged && (loop.bulges?.[i] ?? 0) !== 0)
          return "a polyline loop with no bulges would take one";
      }
    } else {
      if (Number(next(93)?.value) !== n) return "a loop of the HATCH holds another number of sides";

      for (let i = 0; i < n; i++) {
        if (Number(next(72)?.value) !== 1)
          return "a loop of the HATCH holds an edge that is not a line";

        if (!point(10, loop.points[i]!) || !point(11, loop.points[(i + 1) % n]!))
          return "a line of a loop of the HATCH is not 10, 20, 11 and 21";
      }
    }

    // Its boundaries' count and handles, which stay.
    const boundaries = Number(next(97)?.value ?? 0);

    for (let b = 0; b < boundaries; b++)
      if (next(330) === undefined) return "a loop's boundary is not 330";
  }

  return out;
}
