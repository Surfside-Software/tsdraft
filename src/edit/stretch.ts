// A stretch and a polyline's vertices as the read holds them after the edit, and what the writers
// make of each entity a stretch names: left as it is, moved whole, or given new points. The
// leading CAD app's STRETCH moves each point inside its crossing window, its edge among it, and a
// side whose one end moves keeps its arc's height (docs/roadmap/editing.md, section 3).
import type { Point } from "../drawing.ts";
import type { ReadArc, ReadEntity, ReadHatchLoop, ReadPolyline } from "../read/model.ts";
import { isString } from "../guards.ts";
import { canonicalHandle, MOST_BULGE, type Edit, type EditStatement } from "./model.ts";
import { degrees360 } from "./moved.ts";
import type { ReadIndex } from "./reach.ts";
import { applied, type Applied } from "./transform.ts";

export type Window = readonly [Point, Point];

type Stretch = Extract<EditStatement, { kind: "stretch" }>;

type VerticesStatement = Extract<EditStatement, { kind: "vertices" }>;

/** True when the point is inside the window or on its edge. */
export function inWindow(w: Window, p: Point): boolean {
  const [a, b] = w;

  return (
    p[0] >= Math.min(a[0], b[0]) &&
    p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) &&
    p[1] <= Math.max(a[1], b[1])
  );
}

/**
 * True when a point worked out from an angle is inside the window or on its edge, within the
 * rounding of its sine and cosine at the scale `size`.
 */
function nearWindow(w: Window, p: Point, size: number): boolean {
  const [a, b] = w;
  const tol = 8 * Number.EPSILON * Math.max(1, size);

  return (
    p[0] >= Math.min(a[0], b[0]) - tol &&
    p[0] <= Math.max(a[0], b[0]) + tol &&
    p[1] >= Math.min(a[1], b[1]) - tol &&
    p[1] <= Math.max(a[1], b[1]) + tol
  );
}

/** A move of the points inside the window alone, for a record whose points each stand alone. */
export function stretchApplied(w: Window, by: Point): Applied {
  const move = applied({ by });

  return {
    ...move,
    identity: false,
    point: (p) => (inWindow(w, p) ? move.point(p) : [p[0], p[1]]),
  };
}

/** What a stretch makes of one entity it names. */
export type Stretched =
  | { readonly kind: "none" }
  /** The leading CAD app's STRETCH leaves it as it is though the window crosses it. */
  | { readonly kind: "kept"; readonly why: string }
  | { readonly kind: "move" }
  | { readonly kind: "points"; readonly entity: ReadEntity }
  | { readonly kind: "refused"; readonly why: string };

const NONE: Stretched = { kind: "none" };
const MOVE: Stretched = { kind: "move" };

const distance = (a: Point, b: Point): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** A side's bulge once its ends are where they go: its arc's height kept. Undefined for none. */
export function keptHeight(
  bulge: number,
  from: Point,
  to: Point,
  newFrom: Point,
  newTo: Point,
): number | undefined {
  const was = distance(from, to);
  const now = distance(newFrom, newTo);

  if (now === 0 && was !== 0) return undefined;

  if (bulge === 0) return 0;

  if (was === now) return bulge;

  if (now === 0) return undefined;
  const b = (bulge * was) / now;

  return Number.isFinite(b) && Math.abs(b) <= MOST_BULGE ? b : undefined;
}

/**
 * A run of points and bulges, one for each side, stretched: each point inside moved, and each
 * side's bulge worked out again where one end moved. Undefined for a side that would come to
 * nothing.
 */
function stretchedRun(
  points: readonly Point[],
  bulges: readonly number[] | undefined,
  closed: boolean,
  w: Window,
  by: Point,
): { points: Point[]; bulges?: number[]; moved: number } | undefined {
  let moved = 0;

  const out = points.map((p): Point => {
    if (!inWindow(w, p)) return [p[0], p[1]];
    moved++;

    return [p[0] + by[0], p[1] + by[1]];
  });

  const next: number[] = [];

  for (let i = 0; i < sidesOf(points.length, closed); i++) {
    const j = (i + 1) % points.length;
    const b = keptHeight(bulges?.[i] ?? 0, points[i]!, points[j]!, out[i]!, out[j]!);

    if (b === undefined) return undefined;
    next.push(b);
  }

  return bulges === undefined ? { points: out, moved } : { points: out, bulges: next, moved };
}

/** An arc through two points with a bulge, counterclockwise from the first to the second. */
export function arcThrough(
  from: Point,
  to: Point,
  bulge: number,
): Pick<ReadArc, "center" | "radius" | "start" | "end"> {
  const c = distance(from, to);
  const mid: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  // The normal to the left of the chord, toward the center of an arc of a bulge below 1.
  const n: Point = [-(to[1] - from[1]) / c, (to[0] - from[0]) / c];
  const off = ((c / 2) * (1 - bulge * bulge)) / (2 * bulge);
  const center: Point = [mid[0] + n[0] * off, mid[1] + n[1] * off];

  const angle = (p: Point) =>
    degrees360((Math.atan2(p[1] - center[1], p[0] - center[0]) * 180) / Math.PI);

  return {
    center,
    radius: Math.hypot(c / 2, off),
    start: angle(from),
    end: angle(to),
  };
}

const onArc = (e: ReadArc, degrees: number): Point => {
  const r = (degrees * Math.PI) / 180;

  return [e.center[0] + e.radius * Math.cos(r), e.center[1] + e.radius * Math.sin(r)];
};

function stretchedArc(e: ReadArc, w: Window, by: Point): Stretched {
  const span = degrees360(e.end - e.start) || 360;
  const from = onArc(e, e.start);
  const to = onArc(e, e.end);
  // Its ends are worked out from its angles, so each is taken as on the edge within rounding.
  const size = Math.abs(e.center[0]) + Math.abs(e.center[1]) + e.radius;
  const [a, b] = [nearWindow(w, from, size), nearWindow(w, to, size)];

  if (a && b) return MOVE;

  if (nearWindow(w, onArc(e, e.start + span / 2), size))
    return { kind: "refused", why: "its middle is in the window and an end is not" };

  if (!a && !b) return NONE;
  const bulge = Math.tan((span * Math.PI) / 180 / 4);
  const newFrom: Point = a ? [from[0] + by[0], from[1] + by[1]] : from;
  const newTo: Point = b ? [to[0] + by[0], to[1] + by[1]] : to;
  const kept = keptHeight(bulge, from, to, newFrom, newTo);

  if (kept === undefined) return { kind: "refused", why: "its ends would meet" };

  return { kind: "points", entity: { ...e, ...arcThrough(newFrom, newTo, kept) } };
}

function stretchedPolyline(e: ReadPolyline, w: Window, by: Point): Stretched {
  const run = stretchedRun(e.points, e.bulges, e.closed, w, by);

  if (run === undefined) return { kind: "refused", why: "a side would come to nothing" };

  if (run.moved === 0) return NONE;

  if (run.moved === e.points.length) return MOVE;

  return {
    kind: "points",
    entity: { ...e, points: run.points, ...(run.bulges !== undefined && { bulges: run.bulges }) },
  };
}

/** The points of a dimension of the kind `dimension`, its text's among them. */
const dimensionPoints = (e: Extract<ReadEntity, { kind: "dimension" }>): Point[] => [
  e.from,
  e.to,
  e.line,
  e.textAt,
];

/** Whole, none or some of a list of points inside the window. */
function whole(points: readonly Point[], w: Window): "all" | "none" | "some" {
  const n = points.filter((p) => inWindow(w, p)).length;

  return n === 0 ? "none" : n === points.length ? "all" : "some";
}

/** What the leading CAD app's STRETCH makes of an entity the statement names. */
export function stretchedEntity(e: ReadEntity, w: Window, by: Point): Stretched {
  switch (e.kind) {
    case "line": {
      const [a, b] = [inWindow(w, e.from), inWindow(w, e.to)];

      if (a && b) return MOVE;

      if (!a && !b) return NONE;
      const move = stretchApplied(w, by);

      return { kind: "points", entity: { ...e, from: move.point(e.from), to: move.point(e.to) } };
    }

    case "polyline":
      return stretchedPolyline(e, w, by);
    case "solid": {
      const n = whole(e.points, w);

      if (n !== "some") return n === "all" ? MOVE : NONE;
      const run = stretchedRun(e.points, undefined, true, w, by);

      if (run === undefined) return { kind: "refused", why: "a side would come to nothing" };

      return { kind: "points", entity: { ...e, points: run.points } };
    }

    case "arc":
      return stretchedArc(e, w, by);
    case "circle":
      return inWindow(w, e.center) ? MOVE : NONE;
    case "point":
    case "insert":
    case "mtext":
      return inWindow(w, e.at) ? MOVE : NONE;
    case "text": {
      // Justified, by its alignment point alone; aligned or fit, by either of its two points.
      if (e.alignAt === undefined) return inWindow(w, e.stored) ? MOVE : NONE;

      if (e.align === "aligned" || e.align === "fit")
        return inWindow(w, e.stored) || inWindow(w, e.alignAt) ? MOVE : NONE;

      return inWindow(w, e.alignAt) ? MOVE : NONE;
    }

    case "hatch": {
      const points = e.loops.flatMap((l) => l.points);
      const n = whole(points, w);

      if (n !== "some") return n === "all" ? MOVE : NONE;

      if (!e.associative)
        return {
          kind: "kept",
          why: "the leading CAD app's STRETCH leaves a hatch with no boundary as it is unless the window holds it whole",
        };
      const loops: ReadHatchLoop[] = [];

      for (const l of e.loops) {
        const run = stretchedRun(l.points, l.bulges, true, w, by);

        if (run === undefined) return { kind: "refused", why: "a side would come to nothing" };
        loops.push({
          ...l,
          points: run.points,
          ...(run.bulges !== undefined && { bulges: run.bulges }),
        });
      }

      return { kind: "points", entity: { ...e, loops } };
    }

    case "dimension": {
      const n = whole(dimensionPoints(e), w);

      if (n === "some")
        return {
          kind: "refused",
          why: "it is a dimension with some of its points in the window, whose picture would be drawn again",
        };

      return n === "all" ? MOVE : NONE;
    }

    default:
      return {
        kind: "refused",
        why: `this version of tsdraft does not stretch a ${e.kind}: move it, or give each of its points with another edit`,
      };
  }
}

/** True when two runs of points and bulges are the same, as a hatch's loop copies its boundary. */
export function sameRun(
  loop: ReadHatchLoop,
  boundary: Pick<ReadPolyline, "points" | "bulges" | "closed">,
): boolean {
  const n = loop.points.length;

  if (n !== boundary.points.length || !boundary.closed) return false;

  for (let i = 0; i < n; i++) {
    const [p, q] = [loop.points[i]!, boundary.points[i]!];

    if (p[0] !== q[0] || p[1] !== q[1]) return false;

    if ((loop.bulges?.[i] ?? 0) !== (boundary.bulges?.[i] ?? 0)) return false;
  }

  return true;
}

/** How many sides a polyline of `points` has. */
export const sidesOf = (points: number, closed: boolean): number => (closed ? points : points - 1);

/** A polyline with the statement's vertices, or why it cannot take them. */
export function withVertices(e: ReadEntity, s: VerticesStatement): ReadPolyline | string {
  if (e.kind !== "polyline")
    return `it is a ${e.kind}, which has no vertices: only a light or a 2D polyline takes them`;
  const n = s.points.length;
  const sides = sidesOf(n, e.closed);
  const first = s.points[0]!;
  const last = s.points[n - 1]!;

  if (e.closed && first[0] === last[0] && first[1] === last[1])
    return "the polyline is closed, and its last point repeats its first: leave it out";

  if (s.bulges !== undefined && s.bulges.length !== sides)
    return `it gives ${s.bulges.length} bulges for ${sides} sides: one for each side`;
  const recounted = n !== e.points.length;

  if (recounted && e.heavy)
    return "it gives a 2D polyline another number of vertices, whose records would be added or erased";

  if (recounted && e.widths !== undefined)
    return "it gives a polyline with widths of each side another number of vertices";

  if (recounted && s.bulges === undefined && e.bulges?.some((b) => b !== 0))
    return "it gives a polyline with arcs another number of vertices and no bulges: give bulges, one for each side";
  const bulges = s.bulges ?? (recounted ? undefined : e.bulges);
  const { bulges: _, ...rest } = e;

  return {
    ...rest,
    points: s.points.map((p): Point => [p[0], p[1]]),
    ...(bulges !== undefined && bulges.some((b) => b !== 0) && { bulges: [...bulges] }),
  };
}

/** The statement's stretch of each entity it names, by handle. */
export const stretchOf = (s: Stretch, e: ReadEntity): Stretched =>
  stretchedEntity(e, s.window, s.by);

/** The key of a statement's handle in a plan's lists. */
export const planKey = (statement: number, handle: string): string => `${statement}:${handle}`;

/** An entity a statement gives new points, and the statement. */
export interface NewPoints {
  readonly statement: number;
  readonly entity: ReadEntity;
}

/** What an edit's stretches and vertices make of each entity they name, by its handle. */
export interface StretchPlan {
  /** Each handle a stretch moves whole, with its statement. */
  readonly moved: ReadonlyMap<string, number>;
  /** Each handle given new points. */
  readonly repointed: ReadonlyMap<string, NewPoints>;
  /** Why a statement cannot make what it states of a handle, by `planKey`. */
  readonly refused: ReadonlyMap<string, string>;
  /** Why it leaves one it names as it is, by `planKey`. */
  readonly kept: ReadonlyMap<string, string>;
}

const plans = new WeakMap<Edit, WeakMap<ReadIndex, StretchPlan>>();

/**
 * What each stretch and vertices statement makes of the entities it names, as the read holds
 * them: worked out once for each edit and read. A handle the read does not hold as an entity is
 * left out, for `lintEdit` to refuse.
 */
export function stretchPlan(edit: Edit, index: ReadIndex): StretchPlan {
  const held = plans.get(edit)?.get(index);

  if (held) return held;
  const moved = new Map<string, number>();
  const repointed = new Map<string, NewPoints>();
  const refused = new Map<string, string>();
  const kept = new Map<string, string>();

  // A handle an earlier statement names is worked out once: `lintEdit` refuses the second.
  const seen = new Set<string>();

  edit.statements.forEach((s, statement) => {
    if (s.kind !== "stretch" && s.kind !== "vertices") return;
    const names = s.kind === "stretch" ? s.handles : [s.handle];

    for (const handle of new Set(names.map(canonicalHandle))) {
      const at = index.byHandle.get(handle);

      if (at?.kind !== "entity" || seen.has(handle)) continue;
      seen.add(handle);

      if (s.kind === "vertices") {
        const made = withVertices(at.entity, s);

        if (isString(made)) refused.set(planKey(statement, handle), made);
        else repointed.set(handle, { statement, entity: made });
        continue;
      }

      const made = stretchOf(s, at.entity);

      if (made.kind === "move") moved.set(handle, statement);
      else if (made.kind === "points") repointed.set(handle, { statement, entity: made.entity });
      else if (made.kind === "refused") refused.set(planKey(statement, handle), made.why);
      else
        kept.set(
          planKey(statement, handle),
          made.kind === "kept" ? made.why : "no point of it is in the window",
        );
    }
  });

  const plan = { moved, repointed, refused, kept };
  let byIndex = plans.get(edit);

  if (!byIndex) plans.set(edit, (byIndex = new WeakMap()));
  byIndex.set(index, plan);

  return plan;
}

/** The transform a move or a stretch moves what it moves whole by, or undefined for another. */
export function transformOf(s: EditStatement): Applied | undefined {
  if (s.kind === "move") return applied(s.transform);

  if (s.kind === "stretch") return applied({ by: s.by });

  return undefined;
}
