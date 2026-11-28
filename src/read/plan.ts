// `edgesInPlan`: the edges of a read solid, region or body as seen from above, as the lines,
// circles, arcs, ellipses and splines a `Drawing` holds, so that `toSVG` and `toPDF` draw them.
import type {
  Arc,
  Circle,
  ControlSpline,
  Ellipse,
  EntityColor,
  EntityTransparency,
  Line,
  Point,
} from "../drawing.ts";
import { written } from "../format.ts";
import { SPLINE_DEGREE_MOST } from "../rules.ts";
import type {
  Point3,
  ReadEdge,
  ReadEdgeEllipse,
  ReadEntityBase,
  ReadModelerGeometry,
} from "./model.ts";

/** What `edgesInPlan` gives for an edge. */
export type PlanEdge = Line | Circle | Arc | Ellipse | ControlSpline;

/** A ratio this near 1 draws a circle. */
const ROUND = 1e-9;

/** A projected axis this much shorter than the other draws as a line. */
const EDGE_ON = 1e-9;

const TURN = 2 * Math.PI;

const toDegrees = (r: number): number => {
  const d = (r * 180) / Math.PI;
  const turned = ((d % 360) + 360) % 360;

  return turned >= 360 ? 0 : turned;
};

/** The layer and the pen of a read entity, which each edge of a solid takes. */
interface Pen {
  layer: string;
  color?: EntityColor;
  transparency?: EntityTransparency;
  linetype?: string;
  lineweight?: number | "ByBlock" | "Default";
}

/** The pen a read entity sets for itself, as a drawing's entity holds it. */
export function penOf(s: ReadEntityBase): Pen {
  const color: EntityColor | undefined =
    s.trueColor !== undefined
      ? [(s.trueColor >> 16) & 255, (s.trueColor >> 8) & 255, s.trueColor & 255]
      : s.color === 0
        ? "ByBlock"
        : s.color;

  const transparency: EntityTransparency | undefined =
    s.alpha === undefined
      ? undefined
      : s.alpha === "ByBlock"
        ? "ByBlock"
        : Math.round(100 - s.alpha / 2.55);

  const lineweight =
    s.lineweight === undefined || s.lineweight === -1
      ? undefined
      : s.lineweight === -2
        ? ("ByBlock" as const)
        : s.lineweight === -3
          ? ("Default" as const)
          : s.lineweight / 100;

  return {
    layer: s.layer,
    ...(color !== undefined && { color }),
    ...(transparency !== undefined && { transparency }),
    ...(s.linetype !== undefined && { linetype: s.linetype }),
    ...(lineweight !== undefined && { lineweight }),
  };
}

const flat = (p: Point3): Point => [p[0], p[1]];

const samePoint = (a: Point, b: Point): boolean =>
  written(a[0]) === written(b[0]) && written(a[1]) === written(b[1]);

/**
 * The edges of a solid, a region or a body as seen from above, in the order it holds them, each
 * with the solid's layer and its own pen. A line edge stays a line, and a spline edge a spline by
 * its control points; an edge on an ellipse or a circle becomes the circle, arc or ellipse it
 * shows from above, and a line where it is seen edge on. An edge that shows as one point, such as
 * a vertical line, is left out.
 */
export function edgesInPlan(solid: ReadModelerGeometry): PlanEdge[] {
  const pen = penOf(solid);
  const out: PlanEdge[] = [];

  for (const edge of solid.edges) {
    const drawn = edgeInPlan(edge);

    if (drawn !== undefined) out.push({ ...pen, ...drawn });
  }

  return out;
}

type Curve =
  | Omit<Line, "layer">
  | Omit<Circle, "layer">
  | Omit<Arc, "layer">
  | Omit<Ellipse, "layer">
  | Omit<ControlSpline, "layer">;

function edgeInPlan(edge: ReadEdge): Curve | undefined {
  switch (edge.kind) {
    case "line": {
      const [from, to] = [flat(edge.from), flat(edge.to)];

      return samePoint(from, to) ? undefined : { kind: "line", from, to };
    }

    case "ellipse":
      return ellipseInPlan(edge);
    case "spline": {
      if (edge.degree > SPLINE_DEGREE_MOST) return undefined;
      const controlPoints = edge.controlPoints.map(flat);

      if (controlPoints.every((p) => samePoint(p, controlPoints[0]!))) return undefined;

      return {
        kind: "spline",
        degree: edge.degree,
        knots: edge.knots,
        controlPoints,
        ...(edge.weights !== undefined && { weights: edge.weights }),
      };
    }
  }
}

/**
 * An ellipse edge seen from above. Its points are `c + a cos t + b sin t`, where `a` and `b` are
 * its two axes seen from above: two conjugate half diameters of the ellipse it shows, which turn by
 * the phase `phi` into its own axes, at right angles.
 */
function ellipseInPlan(e: ReadEdgeEllipse): Curve | undefined {
  const n = e.normal;
  const A = e.majorAxis;

  const minor: Point3 = [
    e.ratio * (n[1] * A[2] - n[2] * A[1]),
    e.ratio * (n[2] * A[0] - n[0] * A[2]),
    e.ratio * (n[0] * A[1] - n[1] * A[0]),
  ];

  const c = flat(e.center);
  const a = flat(A);
  const b = flat(minor);

  // Parameters a whole turn apart are a whole ellipse too.
  const whole =
    e.startParameter === undefined ||
    e.endParameter === undefined ||
    e.endParameter - e.startParameter >= 360;

  const t0 = whole ? 0 : (e.startParameter! * Math.PI) / 180;
  const t1 = whole ? TURN : (e.endParameter! * Math.PI) / 180;
  // The phase that makes the axes square: tan 2φ = 2 a·b / (|a|² - |b|²).
  const ab = a[0] * b[0] + a[1] * b[1];
  const phi = 0.5 * Math.atan2(2 * ab, a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2);
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  // p = c + u cos(t - φ) + v sin(t - φ).
  let u: Point = [a[0] * cos + b[0] * sin, a[1] * cos + b[1] * sin];
  let v: Point = [-a[0] * sin + b[0] * cos, -a[1] * sin + b[1] * cos];
  let shift = phi;

  if (Math.hypot(...v) > Math.hypot(...u)) {
    // The longer axis is v: with s = t - φ - 90°, p = c + v cos s - u sin s.
    [u, v] = [v, [-u[0], -u[1]]];
    shift += Math.PI / 2;
  }

  const major = Math.hypot(...u);
  const minorLength = Math.hypot(...v);

  if (!(major > 0)) return undefined;
  let [s0, s1] = [t0 - shift, t1 - shift];

  // Seen from above it runs clockwise when v is a quarter turn clockwise of u: run it backward.
  if (u[0] * v[1] - u[1] * v[0] < 0) {
    v = [-v[0], -v[1]];
    [s0, s1] = [-s1, -s0];
  }

  const ratio = minorLength / major;

  const at = (s: number): Point => [
    c[0] + u[0] * Math.cos(s) + v[0] * Math.sin(s),
    c[1] + u[1] * Math.cos(s) + v[1] * Math.sin(s),
  ];

  // A ratio the writers would write as 0 draws a line, as one seen exactly edge on does.
  if (ratio < EDGE_ON || written(ratio) === 0) {
    // Seen edge on: the line over the furthest the parameters reach along the axis.
    let [lo, hi] = [Math.min(Math.cos(s0), Math.cos(s1)), Math.max(Math.cos(s0), Math.cos(s1))];

    // It reaches the axis's tip where it passes a whole turn, and its other end where it passes
    // a half turn past one.
    const passes = (offset: number): boolean =>
      Math.floor((s1 - offset) / TURN) >= Math.ceil((s0 - offset) / TURN);

    if (whole || s1 - s0 >= TURN) [lo, hi] = [-1, 1];
    else {
      if (passes(0)) hi = 1;

      if (passes(Math.PI)) lo = -1;
    }

    let from: Point = [c[0] + u[0] * lo, c[1] + u[1] * lo];
    let to: Point = [c[0] + u[0] * hi, c[1] + u[1] * hi];

    // A short arc at the tip moves across the axis more than along it: its own two ends.
    if (samePoint(from, to)) [from, to] = [at(s0), at(s1)];

    return samePoint(from, to) ? undefined : { kind: "line", from, to };
  }

  if (1 - ratio < ROUND) {
    const radius = (major + minorLength) / 2;

    if (whole) return { kind: "circle", center: c, radius };
    const angle = Math.atan2(u[1], u[0]);
    const [start, end] = [at(s0), at(s1)];

    if (samePoint(start, end) && s1 - s0 < 1) return undefined;

    return {
      kind: "arc",
      center: c,
      radius,
      startAngle: toDegrees(angle + s0),
      endAngle: toDegrees(angle + s1),
    };
  }

  const base = { kind: "ellipse" as const, center: c, majorAxis: u, ratio };

  if (whole) return base;

  return { ...base, startParameter: toDegrees(s0), endParameter: toDegrees(s1) };
}
