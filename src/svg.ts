import { sweep, type Drawing, type Entity, type Layer, type Point } from "./drawing.ts";
import { extents } from "./extents.ts";
import { fmt } from "./format.ts";
import { layerKey } from "./layers.ts";
import { builtInLinetype, lineweightCode } from "./linetypes.ts";

/** Screen colors for the standard ACI colors 1 to 7. Other indexes draw in currentColor. */
const ACI: Record<number, string> = {
  1: "#ff0000",
  2: "#ffff00",
  3: "#00ff00",
  4: "#00ffff",
  5: "#0000ff",
  6: "#ff00ff",
  7: "currentColor",
};

/** AutoCAD draws a lineweight of "Default" at its LWDEFAULT, 0.25 mm. */
const DEFAULT_LINEWEIGHT = 25;

/**
 * The most dashes one entity is cut into. AutoCAD draws a line solid when its pattern is too
 * fine to show, and so does the preview.
 */
const MAX_DASHES = 10000;

export interface SvgOptions {
  /** Margin around the drawing's extents, in drawing units. Defaults to 2% of the larger side. */
  readonly margin?: number;
  /**
   * Stroke width in screen pixels of a line of the default lineweight, 0.25 mm. Other
   * lineweights are drawn in proportion. It stays constant when the SVG scales.
   */
  readonly strokeWidth?: number;
}

/** How an entity is drawn. */
interface Pen {
  readonly color: string;
  /** Dash, gap, dash, ... in drawing units, starting with a dash. Undefined for a solid line. */
  readonly dashes: readonly number[] | undefined;
  /** In hundredths of a millimetre. */
  readonly lineweight: number;
}

/**
 * Renders a preview SVG. Model Y points up, so the drawing group flips Y. Entities on layers
 * that are off or frozen are left out. Dashed lines are cut into their dashes, scaled by the
 * drawing's linetype scale, and each line is as wide as its lineweight. Each entity's element
 * has its layer in `data-layer`, its index in `drawing.entities` in `data-entity`, and its `id`,
 * when it has one, in `data-id`.
 */
export function toSVG(drawing: Drawing, options: SvgOptions = {}): string {
  // Keyed as AutoCAD looks layers up, so an entity on `wall` takes the color of layer `WALL`.
  const layers = new Map(drawing.layers.map((l) => [layerKey(l.name), l]));
  // Each entity keeps its index in `drawing.entities`, for its element's data-entity.
  const shown = [...drawing.entities.entries()].filter(([, e]) => {
    const layer = layers.get(layerKey(e.layer));
    return !layer?.off && !layer?.frozen;
  });
  const [minX, minY, maxX, maxY] = extents(shown.map(([, e]) => e));
  const margin = options.margin ?? Math.max(maxX - minX, maxY - minY, 1) * 0.02;
  const x = minX - margin;
  const y = -(maxY + margin);
  const w = maxX - minX + margin * 2;
  const h = maxY - minY + margin * 2;
  const patterns = new Map(
    (drawing.linetypes ?? []).map((t) => [layerKey(t.name), alternating(t.pattern)]),
  );
  const scale = drawing.linetypeScale ?? 1;
  const stroke = options.strokeWidth ?? 1;

  const pen = (e: Entity): Pen => {
    const layer: Layer | undefined = layers.get(layerKey(e.layer));
    const byLayer = e.linetype === undefined || builtInLinetype(e.linetype) === "ByLayer";
    const linetype = byLayer ? layer?.linetype : e.linetype;
    const pattern = linetype === undefined ? undefined : patterns.get(layerKey(linetype));
    const weight =
      e.lineweight === undefined || e.lineweight === "ByLayer"
        ? (layer?.lineweight ?? "Default")
        : e.lineweight;
    const code = lineweightCode(weight);
    return {
      color: ACI[layer?.color ?? 7] ?? "currentColor",
      dashes: pattern?.map((length) => length * scale),
      lineweight: code < 0 ? DEFAULT_LINEWEIGHT : code,
    };
  };

  const body = shown.map(([i, e]) => entityToSvg(e, i, pen(e), stroke)).join("\n    ");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)}">`,
    `  <g transform="scale(1 -1)" fill="none" stroke-width="${fmt(stroke)}" vector-effect="non-scaling-stroke">`,
    `    ${body}`,
    `  </g>`,
    `</svg>`,
    ``,
  ].join("\n");
}

function entityToSvg(e: Entity, index: number, pen: Pen, stroke: number): string {
  // A lineweight of 0 draws as the thinnest line, as in AutoCAD.
  const width =
    pen.lineweight === DEFAULT_LINEWEIGHT
      ? ""
      : ` stroke-width="${fmt((stroke * Math.max(pen.lineweight, 5)) / DEFAULT_LINEWEIGHT)}"`;
  const mark = `data-layer="${esc(e.layer)}" data-entity="${index}"${e.id === undefined ? "" : ` data-id="${esc(e.id)}"`}`;
  const s = `stroke="${pen.color}"${width} vector-effect="non-scaling-stroke" ${mark}`;
  if (e.kind !== "text" && pen.dashes) {
    const d = dashedPath(e, pen.dashes);
    // A pattern with a dot draws it as a round cap on a path of no length.
    const cap = pen.dashes.includes(0) ? ` stroke-linecap="round"` : "";
    if (d !== undefined) return `<path d="${d}"${cap} ${s}/>`;
  }
  switch (e.kind) {
    case "line":
      return `<line x1="${fmt(e.from[0])}" y1="${fmt(e.from[1])}" x2="${fmt(e.to[0])}" y2="${fmt(e.to[1])}" ${s}/>`;
    case "polyline": {
      const tag = e.closed ? "polygon" : "polyline";
      const points = e.points.map(([px, py]) => `${fmt(px)},${fmt(py)}`).join(" ");
      return `<${tag} points="${points}" ${s}/>`;
    }
    case "circle":
      return `<circle cx="${fmt(e.center[0])}" cy="${fmt(e.center[1])}" r="${fmt(e.radius)}" ${s}/>`;
    case "arc": {
      const [cx, cy] = e.center;
      const a0 = rad(e.startAngle);
      const a1 = rad(e.endAngle);
      const large = sweep(e.startAngle, e.endAngle) > 180 ? 1 : 0;
      const start = `${fmt(cx + e.radius * Math.cos(a0))} ${fmt(cy + e.radius * Math.sin(a0))}`;
      const end = `${fmt(cx + e.radius * Math.cos(a1))} ${fmt(cy + e.radius * Math.sin(a1))}`;
      // SVG draws nothing for an arc that ends where it starts, which is where rounding can
      // put the ends of an arc that is all but a full turn.
      if (start === end && large === 1) {
        return `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(e.radius)}" ${s}/>`;
      }
      // sweep-flag 1 is the positive-angle direction in local (Y-up) coordinates: counterclockwise.
      return `<path d="M ${start} A ${fmt(e.radius)} ${fmt(e.radius)} 0 ${large} 1 ${end}" ${s}/>`;
    }
    case "text": {
      // Undo the group's Y flip so the text reads upright, then apply CAD rotation.
      const t = `translate(${fmt(e.at[0])} ${fmt(e.at[1])}) scale(1 -1)${e.rotation ? ` rotate(${fmt(-e.rotation)})` : ""}`;
      return `<text transform="${t}" font-size="${fmt(e.height)}" font-family="monospace" fill="${pen.color}" stroke="none" ${mark}>${esc(e.value)}</text>`;
    }
  }
}

/**
 * A linetype pattern as SVG thinks of dashes: dash, gap, dash, gap, starting with a dash and
 * of even length. Dashes or gaps side by side are joined, and a pattern that starts with a gap
 * is turned to start with the dash after it. Undefined for a pattern with no gap, with no dash
 * or dot, or with no length, and the caller then draws the entity solid.
 */
function alternating(pattern: readonly number[]): number[] | undefined {
  const first = pattern.findIndex((length) => length >= 0);
  if (first < 0) return undefined;
  const runs: number[] = [];
  // A dot is a dash of no length. Runs alternate dash, gap, so an odd index is a gap.
  for (const length of [...pattern.slice(first), ...pattern.slice(0, first)]) {
    if (runs.length % 2 === (length < 0 ? 0 : 1)) runs[runs.length - 1]! += Math.abs(length);
    else runs.push(Math.abs(length));
  }
  if (runs.length < 2) return undefined;
  if (runs.length % 2 === 1) runs[0]! += runs.pop()!;
  return runs.reduce((a, b) => a + b, 0) > 0 ? runs : undefined;
}

/**
 * An entity cut into the dashes of its pattern, as path data, or undefined when the pattern
 * is too fine for the entity and it draws solid. A polyline starts the pattern again at each
 * vertex, as AutoCAD does unless told otherwise.
 */
function dashedPath(
  e: Exclude<Entity, { kind: "text" }>,
  dashes: readonly number[],
): string | undefined {
  const total = dashes.reduce((a, b) => a + b, 0);
  const out: string[] = [];
  /** Cuts a stretch of the given length, and draws each dash from `from` to `to` along it. */
  const cut = (length: number, draw: (from: number, to: number) => string): boolean => {
    if (length / total > MAX_DASHES) return false;
    let at = 0;
    for (let i = 0; at < length; i = (i + 1) % dashes.length) {
      const end = Math.min(at + dashes[i]!, length);
      if (i % 2 === 0) out.push(draw(at, end));
      at += dashes[i]!;
    }
    return true;
  };
  const straight = (a: Point, b: Point): boolean => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const along = (t: number) =>
      `${fmt(a[0] + ((b[0] - a[0]) * t) / length)} ${fmt(a[1] + ((b[1] - a[1]) * t) / length)}`;
    return length === 0 || cut(length, (from, to) => `M ${along(from)} L ${along(to)}`);
  };
  const round = (center: Point, radius: number, start: number, turn: number): boolean => {
    const along = (t: number) => {
      const angle = rad(start) + t / radius;
      return `${fmt(center[0] + radius * Math.cos(angle))} ${fmt(center[1] + radius * Math.sin(angle))}`;
    };
    return cut(radius * rad(turn), (from, to) => {
      // SVG draws no arc between two equal points, so a dot is a line of no length.
      if (to === from) return `M ${along(from)} L ${along(to)}`;
      const arc = `A ${fmt(radius)} ${fmt(radius)} 0`;
      // A dash of a full turn ends where it starts, so it is drawn as two halves.
      if ((to - from) / radius > Math.PI && along(from) === along(to)) {
        return `M ${along(from)} ${arc} 0 1 ${along((from + to) / 2)} ${arc} 0 1 ${along(to)}`;
      }
      const large = (to - from) / radius > Math.PI ? 1 : 0;
      return `M ${along(from)} ${arc} ${large} 1 ${along(to)}`;
    });
  };
  let ok: boolean;
  switch (e.kind) {
    case "line":
      ok = straight(e.from, e.to);
      break;
    case "polyline": {
      const points = e.closed ? [...e.points, e.points[0]!] : e.points;
      ok = points.slice(1).every((p, i) => straight(points[i]!, p));
      break;
    }
    case "circle":
      ok = round(e.center, e.radius, 0, 360);
      break;
    case "arc":
      ok = round(e.center, e.radius, e.startAngle, sweep(e.startAngle, e.endAngle));
      break;
  }
  return ok && out.length > 0 ? out.join(" ") : undefined;
}

function rad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function esc(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}
