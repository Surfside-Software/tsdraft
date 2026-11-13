// Helpers the structural sheets share: their own layers and blocks (defined once per drawing,
// since the kit has none for rebar or connectors), rebar in section, concrete and CMU in
// section, span arrows and level marks.
import type { Point } from "../../../src/index.ts";
import type { Rect } from "../model/house.ts";
import { arrowhead, earth, hatch, stipple, type Box } from "../../lib/drafting.ts";
import { H, LAYERS, put, type D, type View } from "../lib/kit.ts";

/** Layers the kit does not have. Defined on first use in a drawing. */
export const SL = {
  rebar: "S-REBR",
  below: "S-WALL-BLOW",
  conn: "S-ANNO-CONN",
} as const;

const ready = new WeakSet<D>();

/** Defines the structural sheets' own layers and blocks, once per drawing. */
export function structureSetup(d: D): void {
  if (ready.has(d)) return;
  ready.add(d);
  d.layer(SL.rebar, { color: 7, lineweight: 0.5 });
  d.layer(SL.below, { color: 7, lineweight: 0.18, linetype: "HIDDEN" });
  d.layer(SL.conn, { color: 7, lineweight: 0.25 });
  // A vertical bar in a grouted cell, for plans: a dot in a square cell.
  d.block("S-VERT BAR", {}, () => {
    d.rect([-0.045, -0.045], 0.09, 0.09);
    for (const r of [0.03, 0.02, 0.01]) d.circle([0, 0], r);
  });
  // A connector tag: a mark in a diamond.
  d.block("S-CONN TAG", {}, () => {
    const r = 0.12;
    d.polyline(
      [
        [r, 0],
        [0, r],
        [-r, 0],
        [0, -r],
      ],
      true,
    );
    d.attribute("CONN", [0, 0], {
      value: "C1",
      height: 0.075,
      style: "NOTES",
      align: "center",
      valign: "middle",
    });
  });
}

export const grow = (r: Rect, by: number): Rect => [r[0] - by, r[1] - by, r[2] + by, r[3] + by];
export const shift = (r: Rect, o: Point): Rect => [
  r[0] + o[0],
  r[1] + o[1],
  r[2] + o[0],
  r[3] + o[1],
];
export const box = (x0: number, y0: number, x1: number, y1: number): Box => [
  x0,
  y0,
  x1 - x0,
  y1 - y0,
];

/**
 * A bar in section. tsdraft has no solid fill, so the dot is three circles, which plot as a
 * near-solid dot at the pen widths of the rebar layer.
 */
export function barDot(d: D, c: Point, dia = 0.625): void {
  d.layer(SL.rebar, {}, () => {
    for (const k of [0.5, 0.33, 0.16]) d.circle(c, dia * k);
  });
}

/** Concrete cut in section: the outline, and the stipple drawn as lines (no hatch in tsdraft). */
export function concrete(d: D, b: Box, seed: number, v: View, holes: readonly Box[] = []): void {
  d.layer(LAYERS.sect, {}, () => d.rect([b[0], b[1]], b[2], b[3]));
  d.layer(LAYERS.patt, {}, () => {
    stipple(d, b, holes, { spacing: v.p(0.09), stroke: v.p(0.06), seed, margin: v.p(0.03) });
    // The aggregate: small triangles, as AR-CONC draws them.
    let s = seed;
    const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const step = v.p(0.32);
    for (let y = b[1] + step / 2; y < b[1] + b[3] - step / 3; y += step) {
      for (let x = b[0] + step / 2; x < b[0] + b[2] - step / 3; x += step) {
        const c: Point = [x + (rnd() - 0.5) * step * 0.5, y + (rnd() - 0.5) * step * 0.5];
        const r = v.p(0.035);
        const a = rnd() * Math.PI;
        const pts: Point[] = [0, 1, 2].map((k) => [
          c[0] + r * Math.cos(a + (k * 2 * Math.PI) / 3),
          c[1] + r * Math.sin(a + (k * 2 * Math.PI) / 3),
        ]);
        if (
          holes.some(
            (h) =>
              c[0] > h[0] - r &&
              c[0] < h[0] + h[2] + r &&
              c[1] > h[1] - r &&
              c[1] < h[1] + h[3] + r,
          )
        )
          continue;
        d.polyline(pts, true);
      }
    }
  });
}

/** A grouted CMU wall cut in section: outline, mortar joints at 8" and the 45 degree hatch. */
export function cmu(d: D, b: Box, v: View, jointsFrom = b[1]): void {
  d.layer(LAYERS.sect, {}, () => d.rect([b[0], b[1]], b[2], b[3]));
  d.layer(LAYERS.patt, {}, () => {
    hatch(d, b, v.p(0.06), 1);
    for (let y = jointsFrom + 8; y < b[1] + b[3] - 0.5; y += 8)
      if (y > b[1] + 0.5) d.line([b[0], y], [b[0] + b[2], y]);
  });
}

/** Earth and compacted fill. Earth is the kit's line weave; fill is a sparse stipple. */
export function soil(d: D, b: Box, holes: readonly Box[], v: View): void {
  d.layer(LAYERS.patt, {}, () => earth(d, b, holes, v.p(0.22)));
}
export function fill(d: D, b: Box, holes: readonly Box[], v: View, seed: number): void {
  d.layer(LAYERS.patt, {}, () =>
    stipple(d, b, holes, { spacing: v.p(0.16), stroke: v.p(0.08), seed }),
  );
}

/** A double-headed span arrow with its label over it, for framing plans. */
export function spanArrow(d: D, v: View, a: Point, b: Point, lines: readonly string[]): void {
  d.layer(LAYERS.strAnno, {}, () => {
    d.line(a, b);
    arrowhead(d, a, b, v.p(0.14));
    arrowhead(d, b, a, v.p(0.14));
    const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    let rot = ang;
    if (rot > 90) rot -= 180;
    if (rot <= -90) rot += 180;
    const m: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const t = (rot * Math.PI) / 180;
    const h = v.p(H.note);
    lines.forEach((line, k) => {
      const off = v.p(0.06) + (lines.length - 1 - k) * h * 1.6;
      put(d, [m[0] - Math.sin(t) * off, m[1] + Math.cos(t) * off], line, h, {
        align: "center",
        rotation: rot,
      });
    });
  });
}

/** A level mark (the kit's LEVEL block) for a detail, on the structural annotation layer. */
export function level(d: D, v: View, at: Point, name: string, el: string): void {
  d.layer(LAYERS.strAnno, {}, () => {
    d.insert("LEVEL", at, { scale: v.p(1), attributes: { NAME: name, EL: el } });
  });
}
