// A move, a turn and a scale as the writers and `editedRead` apply them: each point scaled about
// `about`, then turned about it, then moved by `by`, in three steps and in that order, so a value
// comes out as a scale, a rotation and a move made one after another make it.
import type { Point } from "../drawing.ts";
import type { Transform } from "./model.ts";

/** A transform made ready to apply, in the world's coordinates. */
export interface Applied {
  /** True when it moves nothing, turns nothing and scales nothing. */
  readonly identity: boolean;
  /** True when it only moves. */
  readonly moveOnly: boolean;
  readonly scale: number;
  /** Degrees counterclockwise, less whole turns. */
  readonly rotate: number;
  /** The turn's cosine and sine, exact for a quarter turn. */
  readonly cos: number;
  readonly sin: number;
  readonly about: Point;
  readonly by: Point;
  point(p: Point): Point;
  /** A direction or a vector: turned and scaled, not moved. */
  vector(v: Point): Point;
  /** A direction of length one: turned only. */
  direction(v: Point): Point;
  /** An angle in degrees, turned. */
  degrees(a: number): number;
  /** An angle in radians, turned. */
  radians(a: number): number;
  /** A size: scaled. */
  size(s: number): number;
}

/** The cosine and sine of a turn in degrees, exact at each quarter turn. */
export function turn(degrees: number): [cos: number, sin: number] {
  const quarter = degrees / 90;

  if (Number.isInteger(quarter)) {
    switch (((quarter % 4) + 4) % 4) {
      case 0:
        return [1, 0];
      case 1:
        return [0, 1];
      case 2:
        return [-1, 0];
      default:
        return [0, -1];
    }
  }

  const r = (degrees * Math.PI) / 180;

  return [Math.cos(r), Math.sin(r)];
}

/** The transform ready to apply. */
export function applied(t: Transform): Applied {
  const scale = t.scale ?? 1;
  // The turn less whole turns, which `%` gives exactly, so a point and an angle turn alike.
  const rotate = (t.rotate ?? 0) % 360;
  const about: Point = t.about ?? [0, 0];
  const by: Point = t.by ?? [0, 0];
  const [cos, sin] = turn(rotate);
  const scales = scale !== 1;
  const turns = rotate !== 0;
  const moves = by[0] !== 0 || by[1] !== 0;
  const radians = (rotate * Math.PI) / 180;

  const point = (p: Point): Point => {
    let x = p[0];
    let y = p[1];

    if (scales) {
      x = about[0] + (x - about[0]) * scale;
      y = about[1] + (y - about[1]) * scale;
    }

    if (turns) {
      const dx = x - about[0];
      const dy = y - about[1];
      x = about[0] + (dx * cos - dy * sin);
      y = about[1] + (dx * sin + dy * cos);
    }

    if (moves) {
      x += by[0];
      y += by[1];
    }

    return [x, y];
  };

  const direction = (v: Point): Point =>
    turns ? [v[0] * cos - v[1] * sin, v[0] * sin + v[1] * cos] : [v[0], v[1]];

  return {
    identity: !scales && !turns && !moves,
    moveOnly: !scales && !turns,
    scale,
    rotate,
    cos,
    sin,
    about,
    by,
    point,
    vector: (v) => {
      const d = direction(v);

      return scales ? [d[0] * scale, d[1] * scale] : d;
    },
    direction,
    degrees: (a) => (turns ? a + rotate : a),
    radians: (a) => (turns ? a + radians : a),
    size: (s) => (scales ? s * scale : s),
  };
}

/**
 * What a scale does to the knots of a spline by fit points, which the readers fit again from its
 * points: knots spaced by chord scale with it, by the square root of the chord with its root.
 */
export function knotScale(spacing: string | undefined, scale: number): number {
  switch (spacing) {
    case "chord":
      return scale;
    case "square-root":
      return Math.sqrt(scale);
    default:
      return 1;
  }
}
