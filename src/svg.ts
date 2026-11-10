import { sweep, type Drawing, type Entity } from "./drawing.ts";
import { extents } from "./extents.ts";
import { fmt } from "./format.ts";
import { layerKey } from "./layers.ts";

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

export interface SvgOptions {
  /** Margin around the drawing's extents, in drawing units. Defaults to 2% of the larger side. */
  readonly margin?: number;
  /** Stroke width in screen pixels; it stays constant when the SVG scales. */
  readonly strokeWidth?: number;
}

/** Renders a preview SVG. Model Y points up, so the drawing group flips Y. */
export function toSVG(drawing: Drawing, options: SvgOptions = {}): string {
  const [minX, minY, maxX, maxY] = extents(drawing.entities);
  const margin = options.margin ?? Math.max(maxX - minX, maxY - minY, 1) * 0.02;
  const x = minX - margin;
  const y = -(maxY + margin);
  const w = maxX - minX + margin * 2;
  const h = maxY - minY + margin * 2;
  // Keyed as AutoCAD looks layers up, so an entity on `wall` takes the color of layer `WALL`.
  const colors = new Map(
    drawing.layers.map((l) => [layerKey(l.name), ACI[l.color] ?? "currentColor"]),
  );
  const stroke = options.strokeWidth ?? 1;

  const body = drawing.entities
    .map((e) => entityToSvg(e, colors.get(layerKey(e.layer)) ?? "currentColor"))
    .join("\n    ");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)}">`,
    `  <g transform="scale(1 -1)" fill="none" stroke-width="${fmt(stroke)}" vector-effect="non-scaling-stroke">`,
    `    ${body}`,
    `  </g>`,
    `</svg>`,
    ``,
  ].join("\n");
}

function entityToSvg(e: Entity, color: string): string {
  const s = `stroke="${color}" vector-effect="non-scaling-stroke" data-layer="${esc(e.layer)}"`;
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
      return `<text transform="${t}" font-size="${fmt(e.height)}" font-family="monospace" fill="${color}" stroke="none" data-layer="${esc(e.layer)}">${esc(e.value)}</text>`;
    }
  }
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
