// Helpers the elevation and section sheets share: a local frame for a view (h along the view,
// z up from the first floor), occluded lines, level markers, patterns tsdraft has no hatch for,
// and the heights in NAVD.
import type { Point } from "../../../src/index.ts";
import { CRITERIA } from "../project.ts";
import { ENTRY, HEIGHTS, LANAI_SLAB, ROOF } from "../model/house.ts";
import { H, LAYERS, leaderNote, put, width, type D, type View } from "../lib/kit.ts";
import { arrowhead, lineOutside, type Box } from "../../lib/drafting.ts";

/** Elevation in NAVD 88 of a height above the first floor, in inches. */
export const navd = (z: number): number => CRITERIA.flood.ffe + z / 12;
export const el = (z: number): string => `EL. ${navd(z).toFixed(2)}' NAVD`;
/** A height in NAVD as a height above the first floor, in inches. */
export const zOf = (elevation: number): number => (elevation - CRITERIA.flood.ffe) * 12;

const quarter = (z: number): number => Math.round(z * 4) / 4;

/** The heights every elevation and section reads, in inches above the first floor. */
export const Z = (() => {
  /** Finished grade at the foundation, after fill: the grade the elevations and sections draw. */
  const grade = zOf(CRITERIA.flood.finishGrade);
  const fascia = 6;
  return {
    grade,
    existing: zOf(CRITERIA.flood.grade),
    garage: zOf(CRITERIA.flood.garage),
    bfe: zOf(CRITERIA.flood.bfe),
    dfe: zOf(CRITERIA.flood.dfe),
    ff: 0,
    tieBeam: HEIGHTS.l1Plate,
    tieBeamDepth: 16,
    l2: HEIGHTS.l2,
    plate: HEIGHTS.l2Top,
    eave: ROOF.eaveHeight,
    fascia,
    soffit: ROOF.eaveHeight - fascia,
    ridge: ROOF.ridgeHeight,
    /** The mean roof height of a hip roof: halfway from the eave to the ridge. */
    mean: (ROOF.eaveHeight + ROOF.ridgeHeight) / 2,
    /** The continuous footing, as S-101 note 3 and 1/S-501 have it: 20" x 12", 18" below grade. */
    footingTop: grade - 6,
    footingDepth: 12,
    footingWidth: 20,
    // The model gives these in NAVD to 0.01'; to the nearest 1/4" the slabs are 4" below the F.F.E.
    porch: quarter(zOf(ENTRY.slab)),
    lanai: quarter(zOf(LANAI_SLAB.slab)),
    deck: quarter(zOf(LANAI_SLAB.deck)),
  };
})();

/** A stair's riser height, from the levels it joins and its number of risers. */
export const riser = (top: number, bottom: number, risers: number): number =>
  (top - bottom) / risers;

/**
 * A guard seen face-on: a top rail and a bottom rail with pickets at 4" o.c. between, `height`
 * above `z`, from h0 to h1. Lines, as aluminum pickets would be drawn.
 */
export function guardElev(
  L: Local,
  h0: number,
  h1: number,
  z: number,
  height = LANAI_SLAB.guard,
): void {
  if (h1 - h0 < 1) return;
  L.d.layer(LAYERS.elevFine, {}, () => {
    L.rect(h0, z + height - 2, h1, z + height);
    L.rect(h0, z + 2, h1, z + 3.5);
    const n = Math.max(1, Math.round((h1 - h0) / 4));
    for (let k = 1; k < n; k++) {
      const h = h0 + ((h1 - h0) * k) / n;
      L.line(h, z + 3.5, h, z + height - 2);
    }
    L.line(h0, z, h0, z + height);
    L.line(h1, z, h1, z + height);
  });
}

/**
 * A stair seen from the front: its sides, a line at each nosing, and a handrail at each side,
 * seen end-on as a post from the bottom to 36" above the top.
 */
export function stairFront(
  L: Local,
  h0: number,
  h1: number,
  top: number,
  bottom: number,
  risers: number,
  rail = true,
): void {
  const r = riser(top, bottom, risers);
  L.d.layer(LAYERS.elevFine, {}, () => {
    L.line(h0, bottom, h0, top);
    L.line(h1, bottom, h1, top);
    for (let k = 1; k < risers; k++) L.line(h0, top - k * r, h1, top - k * r);
    if (rail) {
      L.rect(h0, bottom, h0 + 2, top + 36);
      L.rect(h1 - 2, bottom, h1, top + 36);
    }
  });
}

/**
 * A stair in profile, from its top nosing at `h` going `dir` (+1 or -1 along h) down to
 * `bottom`, with a handrail 36" above the nosings and a post at each end.
 */
export function stairProfile(
  L: Local,
  h: number,
  dir: 1 | -1,
  top: number,
  bottom: number,
  risers: number,
  tread: number,
): void {
  const r = riser(top, bottom, risers);
  const pts: [number, number][] = [[h, top]];
  for (let k = 0; k < risers; k++) {
    const at = h + dir * k * tread;
    pts.push([at, top - (k + 1) * r]);
    if (k < risers - 1) pts.push([at + dir * tread, top - (k + 1) * r]);
  }
  const last = h + dir * (risers - 1) * tread;
  L.d.layer(LAYERS.elevFine, {}, () => {
    L.poly(pts);
    // The handrail, parallel to the nosings, with a post at each end.
    L.poly([
      [last, bottom + r + 36],
      [h, top + 36],
    ]);
    L.line(last - dir * 2, bottom + r, last - dir * 2, bottom + r + 36);
    L.line(h - dir * 2, top, h - dir * 2, top + 36);
  });
}

/** A frame of a view in model space: local h (along) and z (up), from an origin. */
export interface Local {
  readonly d: D;
  readonly o: Point;
  readonly P: (h: number, z: number) => Point;
  /** A line, left out where it passes behind `holes` when it is horizontal or vertical. */
  readonly line: (h0: number, z0: number, h1: number, z1: number) => void;
  readonly rect: (h0: number, z0: number, h1: number, z1: number) => void;
  readonly poly: (pts: readonly (readonly [number, number])[], closed?: boolean) => void;
  /** A box in model coordinates, for the drafting helpers. */
  readonly box: (h0: number, z0: number, h1: number, z1: number) => Box;
}

export function local(d: D, o: Point, holes: readonly Box[] = []): Local {
  const P = (h: number, z: number): Point => [o[0] + h, o[1] + z];
  const line = (h0: number, z0: number, h1: number, z1: number) => {
    if (holes.length && (h0 === h1 || z0 === z1)) lineOutside(d, P(h0, z0), P(h1, z1), holes);
    else d.line(P(h0, z0), P(h1, z1));
  };
  const rect = (h0: number, z0: number, h1: number, z1: number) => {
    if (holes.length) {
      line(h0, z0, h1, z0);
      line(h1, z0, h1, z1);
      line(h1, z1, h0, z1);
      line(h0, z1, h0, z0);
    } else d.polyline([P(h0, z0), P(h1, z0), P(h1, z1), P(h0, z1)], true);
  };
  const poly = (pts: readonly (readonly [number, number])[], closed = false) =>
    d.polyline(
      pts.map(([h, z]) => P(h, z)),
      closed,
    );
  const box = (h0: number, z0: number, h1: number, z1: number): Box => {
    const [a, b] = [P(Math.min(h0, h1), Math.min(z0, z1)), P(Math.max(h0, h1), Math.max(z0, z1))];
    return [a[0], a[1], b[0] - a[0], b[1] - a[1]];
  };
  return { d, o, P, line, rect, poly, box };
}

/** A level marker: the LEVEL block at `at`, its line run back to `from`. */
export function level(
  L: Local,
  v: View,
  h: number,
  z: number,
  from: number,
  name: string,
  elev: string,
): void {
  const r = v.p(0.08);
  L.d.layer(LAYERS.symb, {}, () => {
    const end = from < h ? h - r : h + r;
    L.line(from, z, end, z);
    L.d.insert("LEVEL", L.P(h, z), { scale: v.p(1), attributes: { NAME: name, EL: elev } });
  });
}

/** A dashed line across a view with a label ending at `labelAt` (its right end), for the flood levels. */
export function floodLine(
  L: Local,
  v: View,
  h0: number,
  h1: number,
  z: number,
  label: string,
  labelAt = h1,
): void {
  L.d.layer(LAYERS.anno, {}, () => {
    L.d.line(L.P(h0, z), L.P(h1, z), { linetype: "DASHED", lineweight: 0.35 });
    put(L.d, L.P(labelAt - v.p(0.1), z + v.p(0.04)), label, v.p(H.small), { align: "right" });
  });
}

export interface Note {
  /** The point the leader points to, local. */
  readonly at: readonly [number, number];
  readonly lines: readonly string[];
  /** Where the leader turns, local, for a note placed by hand. Stacked notes leave it out. */
  readonly elbow?: readonly [number, number];
  /** The side the text goes, when it is not the side away from the target. */
  readonly side?: 1 | -1;
}

/** The kit's leaderNote with the side of the text given: the kit puts it away from the target. */
export function sideNote(
  d: D,
  v: View,
  target: Point,
  elbow: Point,
  lines: readonly string[],
  side: 1 | -1,
): void {
  const h = v.p(H.note);
  const end: Point = [elbow[0] + side * v.p(1 / 8), elbow[1]];
  d.polyline([target, elbow, end]);
  arrowhead(d, target, elbow, v.p(1 / 8));
  const x = end[0] + side * v.p(1 / 16);
  lines.forEach((line, k) => {
    put(d, [x, elbow[1] - k * h * 1.6], line, h, {
      align: side > 0 ? "left" : "right",
      valign: "middle",
    });
  });
}

/**
 * Leader notes stacked in a column at local `h`, each as near the height of its target as the
 * notes above it let it be. Returns the lowest z used.
 */
export function noteStack(
  L: Local,
  v: View,
  h: number,
  notes: readonly Note[],
  top = Infinity,
  avoid: readonly (readonly [number, number])[] = [],
): number {
  const lead = v.p(H.note) * 1.6;
  const gap = v.p(0.12);
  const sorted = [...notes].sort((a, b) => b.at[1] - a.at[1]);
  let floor = top;
  L.d.layer(LAYERS.anno, {}, () => {
    for (const n of sorted) {
      if (n.elbow && n.side) {
        sideNote(L.d, v, L.P(n.at[0], n.at[1]), L.P(n.elbow[0], n.elbow[1]), n.lines, n.side);
        continue;
      }
      if (n.elbow) {
        leaderNote(L.d, v, L.P(n.at[0], n.at[1]), L.P(n.elbow[0], n.elbow[1]), n.lines);
        continue;
      }
      let z = Math.min(n.at[1], floor);
      // Keep the elbow out of the bands given, such as the text of level markers.
      for (const [lo, hi] of [...avoid].sort((a, b) => b[0] - a[0])) if (z > lo && z < hi) z = lo;
      leaderNote(L.d, v, L.P(n.at[0], n.at[1]), L.P(h, z), n.lines);
      floor = z - n.lines.length * lead - gap;
    }
  });
  return floor;
}

/** The longest line of a note, in paper inches. */
export const noteWidth = (lines: readonly string[]): number =>
  Math.max(...lines.map((l) => width(l, H.note)));

// ---------------------------------------------------------------------------------------------
// Patterns. tsdraft has no hatch entity, so these are lines, as lib/drafting.ts draws its own.

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const r2 = (p: Point): Point => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];

/**
 * Concrete as drafters draw it (AR-CONC): small triangles and dots scattered over `area`, one
 * mark per cell of `size`, kept inside the area.
 */
export function concrete(d: D, area: Box, size: number, seed = 7): void {
  const rnd = seeded(seed);
  const [x0, y0, w, h] = area;
  const m = size * 0.25;
  for (let y = y0; y < y0 + h - 1e-6; y += size) {
    for (let x = x0; x < x0 + w - 1e-6; x += size) {
      const c: Point = [x + m + rnd() * (size - 2 * m), y + m + rnd() * (size - 2 * m)];
      const inArea = (p: Point) =>
        p[0] > x0 + m * 0.5 &&
        p[0] < x0 + w - m * 0.5 &&
        p[1] > y0 + m * 0.5 &&
        p[1] < y0 + h - m * 0.5;
      if (rnd() < 0.45) {
        const s = size * (0.18 + 0.12 * rnd());
        const a = rnd() * Math.PI * 2;
        const pts = [0, 1, 2].map((k): Point =>
          r2([
            c[0] + s * Math.cos(a + (k * 2 * Math.PI) / 3),
            c[1] + s * Math.sin(a + (k * 2 * Math.PI) / 3),
          ]),
        );
        if (pts.every(inArea)) d.polyline(pts, true);
      } else {
        const s = size * 0.04;
        const p0 = r2([c[0] - s, c[1]]);
        const p1 = r2([c[0] + s, c[1]]);
        if (inArea(p0) && inArea(p1)) d.line(p0, p1);
      }
    }
  }
}

/** Compacted fill or sand: a sparse field of dots. */
export function dots(d: D, area: Box, size: number, seed = 3): void {
  const rnd = seeded(seed);
  const [x0, y0, w, h] = area;
  for (let y = y0; y < y0 + h - 1e-6; y += size) {
    for (let x = x0; x < x0 + w - 1e-6; x += size) {
      const c: Point = r2([x + size * (0.15 + 0.7 * rnd()), y + size * (0.15 + 0.7 * rnd())]);
      const s = size * 0.05;
      d.line(c, r2([c[0] + s, c[1]]));
    }
  }
}

/** Batt insulation running up a vertical cavity: the looping line, turned on its side. */
export function battUp(d: D, area: Box): void {
  const [x0, y0, w, h] = area;
  const radius = w / 2;
  const across = w / 4;
  const advance = w * 0.35;
  const loops = Math.max(1, Math.floor((h - across * 2) / advance));
  const start = y0 + (h - loops * advance) / 2;
  const pts: Point[] = [];
  for (let i = 0; i <= loops * 24; i++) {
    const t = (i / 24) * 2 * Math.PI;
    const y = start + (advance * t) / (2 * Math.PI) - across * Math.sin(t);
    pts.push(r2([x0 + radius - radius * Math.cos(t), y]));
  }
  d.polyline(pts);
}

/** A cut piece of lumber: its outline and the cross drafters draw through a cut member. */
export function lumber(L: Local, h0: number, z0: number, h1: number, z1: number): void {
  L.rect(h0, z0, h1, z1);
  L.line(h0, z0, h1, z1);
  L.line(h0, z1, h1, z0);
}

/** A rebar in section, a small circle. */
export function bar(L: Local, h: number, z: number, dia = 0.625): void {
  L.d.circle(L.P(h, z), dia / 2);
}
