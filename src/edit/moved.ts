// An entity of the read model as a move, a turn and a scale leave it: every point and angle it
// holds, and its sizes for a scale, as `editedRead` holds it and the writers write it.
import type { Point } from "../drawing.ts";
import type {
  ReadAttribute,
  ReadEntity,
  ReadHatchLoop,
  ReadLeaderRoot,
  ReadTextPlacement,
  ReadViewport,
} from "../read/model.ts";
import { knotScale, type Applied } from "./transform.ts";

/** An angle in degrees from 0 up to 360. */
export const degrees360 = (a: number): number => {
  if (a >= 0 && a < 360) return a;
  const r = a % 360;

  return r < 0 ? r + 360 : r === 0 ? 0 : r;
};

/** An angle a kind leaves out at 0, turned, and left out again where it comes to 0. */
const turned = (
  rotation: number | undefined,
  t: Applied,
  sense: 1 | -1 = 1,
): { rotation?: number } => {
  const a = degrees360((rotation ?? 0) + sense * t.rotate);

  return a === 0 ? {} : { rotation: a };
};

const points = (list: readonly Point[], t: Applied): Point[] => list.map((p) => t.point(p));

/** A text's placement moved. */
function placement<T extends ReadTextPlacement>(e: T, t: Applied): T {
  return {
    ...e,
    at: t.point(e.at),
    stored: t.point(e.stored),
    ...(e.alignAt !== undefined && { alignAt: t.point(e.alignAt) }),
    height: t.size(e.height),
    rotation: degrees360(t.degrees(e.rotation)),
  };
}

function attribute(a: ReadAttribute, t: Applied): ReadAttribute {
  const moved = placement(a, t);
  const p = a.paragraph;

  return p === undefined
    ? moved
    : {
        ...moved,
        paragraph: {
          ...p,
          at: t.point(p.at),
          height: t.size(p.height),
          width: t.size(p.width),
          // A mirrored paragraph holds its direction seen from below.
          rotation: degrees360(p.mirrored ? p.rotation - t.rotate : t.degrees(p.rotation)),
        },
      };
}

const loop = (l: ReadHatchLoop, t: Applied): ReadHatchLoop => ({
  ...l,
  points: points(l.points, t),
});

const root = (r: ReadLeaderRoot, t: Applied): ReadLeaderRoot => ({
  at: t.point(r.at),
  direction: t.direction(r.direction),
  landing: t.size(r.landing),
  shafts: r.shafts.map((s) => points(s, t)),
});

/** The kinds a scale is refused for: a dimension's measurement and a table's cells go with it. */
export const NOT_SCALED: ReadonlySet<ReadEntity["kind"]> = new Set([
  "dimension",
  "radial-dimension",
  "angular-dimension",
  "arc-length-dimension",
  "ordinate-dimension",
  "table",
]);

/** The kinds no writer moves: their modeler data would change. */
export const NOT_MOVED: ReadonlySet<ReadEntity["kind"]> = new Set(["3dsolid", "region", "body"]);

/** The entity as the transform leaves it, or the entity itself for an identity. */
export function movedEntity(e: ReadEntity, t: Applied): ReadEntity {
  if (t.identity) return e;

  switch (e.kind) {
    case "line":
      return { ...e, from: t.point(e.from), to: t.point(e.to) };
    case "polyline":
      return {
        ...e,
        points: points(e.points, t),
        ...(e.width !== undefined && { width: t.size(e.width) }),
        ...(e.widths !== undefined && {
          widths: e.widths.map(([a, b]) => [t.size(a), t.size(b)] as const),
        }),
      };
    case "circle":
      return { ...e, center: t.point(e.center), radius: t.size(e.radius) };
    case "arc":
      return {
        ...e,
        center: t.point(e.center),
        radius: t.size(e.radius),
        start: degrees360(t.degrees(e.start)),
        end: degrees360(t.degrees(e.end)),
      };
    case "point": {
      const { rotation, ...rest } = e;

      return {
        ...rest,
        at: t.point(e.at),
        // The file turns its angle with the point, and the read holds the figure's turn the other way.
        ...turned(rotation, t, -1),
      };
    }

    case "ellipse":
      return { ...e, center: t.point(e.center), majorAxis: t.vector(e.majorAxis) };
    case "spline":
      return {
        ...e,
        controlPoints: points(e.controlPoints, t),
        ...(e.fitPoints !== undefined && { fitPoints: points(e.fitPoints, t) }),
        // The readers fit the knots of one by fit points again: spaced by chord, they scale with it.
        ...(e.fitPoints !== undefined &&
          t.scale !== 1 && {
            knots: e.knots.map((k) => k * knotScale(e.knotSpacing, t.scale)),
          }),
        ...(e.startTangent !== undefined && { startTangent: t.direction(e.startTangent) }),
        ...(e.endTangent !== undefined && { endTangent: t.direction(e.endTangent) }),
      };
    case "text":
      return placement(e, t);
    case "insert":
      return {
        ...e,
        at: t.point(e.at),
        scale: [t.size(e.scale[0]), t.size(e.scale[1])],
        rotation: degrees360(t.degrees(e.rotation)),
        ...(e.attributes !== undefined && {
          attributes: e.attributes.map((a) => attribute(a, t)),
        }),
      };
    case "mtext": {
      const c = e.columns;

      return {
        ...e,
        at: t.point(e.at),
        height: t.size(e.height),
        width: t.size(e.width),
        rotation: degrees360(t.degrees(e.rotation)),
        ...(c !== undefined && {
          columns:
            c.heights !== undefined
              ? {
                  heights: c.heights.map((h) => t.size(h)),
                  ...(c.gutter !== undefined && { gutter: t.size(c.gutter) }),
                }
              : {
                  ...c,
                  height: t.size(c.height),
                  ...(c.gutter !== undefined && { gutter: t.size(c.gutter) }),
                },
        }),
      };
    }

    case "dimension": {
      const { angle, ...rest } = e;
      // A linear dimension's angle, which the readers leave out at 0.
      const turnedTo = e.type === "linear" ? degrees360(t.degrees(angle ?? 0)) : angle;

      return {
        ...rest,
        from: t.point(e.from),
        to: t.point(e.to),
        line: t.point(e.line),
        textAt: t.point(e.textAt),
        ...(turnedTo !== undefined && turnedTo !== 0 && { angle: turnedTo }),
      };
    }

    case "radial-dimension":
      return {
        ...e,
        center: t.point(e.center),
        point: t.point(e.point),
        ...(e.start !== undefined && { start: t.point(e.start) }),
        ...(e.jog !== undefined && { jog: t.point(e.jog) }),
        textAt: t.point(e.textAt),
      };
    case "angular-dimension":
      return {
        ...e,
        ...(e.vertex !== undefined && { vertex: t.point(e.vertex) }),
        ...(e.from !== undefined && { from: t.point(e.from) }),
        ...(e.to !== undefined && { to: t.point(e.to) }),
        ...(e.first !== undefined && { first: [t.point(e.first[0]), t.point(e.first[1])] }),
        ...(e.second !== undefined && { second: [t.point(e.second[0]), t.point(e.second[1])] }),
        at: t.point(e.at),
        textAt: t.point(e.textAt),
      };
    case "arc-length-dimension":
      return {
        ...e,
        center: t.point(e.center),
        at: t.point(e.at),
        textAt: t.point(e.textAt),
      };
    case "ordinate-dimension":
      return {
        ...e,
        origin: t.point(e.origin),
        feature: t.point(e.feature),
        leaderEnd: t.point(e.leaderEnd),
        textAt: t.point(e.textAt),
      };
    case "multileader":
      return {
        ...e,
        shafts: e.shafts.map((s) => points(s, t)),
        at: t.point(e.at),
        // One with no root holds no direction: the read gives it one along X.
        direction: e.roots.length > 0 ? t.direction(e.direction) : e.direction,
        landing: t.size(e.landing),
        roots: e.roots.map((r) => root(r, t)),
        textAt: t.point(e.textAt),
        width: t.size(e.width),
        textHeight: t.size(e.textHeight),
        arrowSize: t.size(e.arrowSize),
        ...(e.block !== undefined && {
          block: {
            ...e.block,
            at: t.point(e.block.at),
            scale: t.size(e.block.scale),
            rotation: degrees360(t.degrees(e.block.rotation)),
          },
        }),
      };
    case "leader":
      return { ...e, points: points(e.points, t) };
    case "solid":
    case "wipeout":
      return { ...e, points: points(e.points, t) };
    case "image":
      return {
        ...e,
        at: t.point(e.at),
        u: t.vector(e.u),
        v: t.vector(e.v),
        ...(e.clip !== undefined && { clip: points(e.clip, t) }),
      };
    case "underlay":
      return {
        ...e,
        at: t.point(e.at),
        scale: [t.size(e.scale[0]), t.size(e.scale[1])],
        rotation: degrees360(t.degrees(e.rotation)),
        ...(e.clip !== undefined && { clip: points(e.clip, t) }),
      };
    case "hatch":
      return {
        ...e,
        loops: e.loops.map((l) => loop(l, t)),
        ...(e.patternAngle !== undefined && {
          patternAngle: degrees360(t.degrees(e.patternAngle)),
        }),
        ...(e.patternScale !== undefined && { patternScale: t.size(e.patternScale) }),
        ...(e.patternLines !== undefined && {
          patternLines: e.patternLines.map((l) => ({
            ...l,
            angle: degrees360(t.degrees(l.angle)),
            base: t.point(l.base),
            offset: t.vector(l.offset),
            ...(l.dashes !== undefined && { dashes: l.dashes.map((d) => t.size(d)) }),
          })),
        }),
        ...(e.gradient !== undefined && {
          gradient: { ...e.gradient, angle: degrees360(t.degrees(e.gradient.angle)) },
        }),
      };
    case "table":
      return { ...e, at: t.point(e.at), direction: t.direction(e.direction) };
    case "3dsolid":
    case "region":
    case "body":
      return e;
  }
}

/** A viewport moved on its paper. Only a move is made of one: its view stays. */
export const movedViewport = (v: ReadViewport, t: Applied): ReadViewport =>
  t.identity ? v : { ...v, center: t.point(v.center) };
