// A-201 and A-202: the four exterior elevations at 1/4" = 1'-0", drawn from the model: the
// walls, the openings at their real positions and heights, the hip roof, the lanai, the grade
// and the flood levels. A-301, the building and wall sections, is in elevations-section.ts.
import type { Point } from "../../../src/index.ts";
import { CRITERIA } from "../project.ts";
import {
  DEPTH,
  ENTRY,
  FLOOD_VENTS,
  HEIGHTS,
  L1,
  L2,
  LANAI,
  LANAI_SLAB,
  ROOF,
  W,
  WINDOW_TYPES,
  type Opening,
  type Rect,
} from "../model/house.ts";
import { frame } from "../lib/frame.ts";
import {
  AREA,
  dimString,
  ftIn,
  H,
  LAYERS,
  noteColumn,
  put,
  table,
  view,
  viewport,
  width,
  type D,
  type SheetDraw,
  type View,
} from "../lib/kit.ts";
import type { Box } from "../../lib/drafting.ts";
import {
  el,
  floodLine,
  guardElev,
  local,
  navd,
  noteStack,
  noteWidth,
  riser,
  stairFront,
  stairProfile,
  Z,
  type Local,
  type Note,
} from "./elevations-lib.ts";
import { SECTION_SHEETS } from "./elevations-section.ts";
import { elevSymbols, levelLeft } from "./elevations-symbols.ts";

type FaceKey = "S" | "N" | "E" | "W";

interface Face {
  readonly key: FaceKey;
  readonly title: string;
  /** The length of the main block's face. */
  readonly len: number;
  /** An opening's cut as its span along the view. */
  readonly span: (r: Rect) => [number, number];
  /** Whether a cut is in this face's wall. */
  readonly on: (r: Rect) => boolean;
}

const FACES: Record<FaceKey, Face> = {
  S: {
    key: "S",
    title: "SOUTH (FRONT) ELEVATION",
    len: W,
    span: (r) => [r[0], r[2]],
    on: (r) => r[1] === 0,
  },
  N: {
    key: "N",
    title: "NORTH (REAR) ELEVATION",
    len: W,
    span: (r) => [W - r[2], W - r[0]],
    on: (r) => r[3] === DEPTH,
  },
  E: {
    key: "E",
    title: "EAST (RIGHT SIDE) ELEVATION",
    len: DEPTH,
    span: (r) => [r[1], r[3]],
    on: (r) => r[2] === W,
  },
  W: {
    key: "W",
    title: "WEST (LEFT SIDE) ELEVATION",
    len: DEPTH,
    span: (r) => [DEPTH - r[3], DEPTH - r[1]],
    on: (r) => r[0] === 0,
  },
};

/** Model-space origins of the views, inside this module's range (x 80000 to 199999). */
export const ORIGIN: Record<FaceKey, Point> = {
  S: [82000, 0],
  N: [82000, 3000],
  E: [86000, 0],
  W: [86000, 3000],
};

const GARAGE: Rect = [0, 0, 272, 296];
const inGarage = (r: Rect) => {
  const cx = (r[0] + r[2]) / 2;
  const cy = (r[1] + r[3]) / 2;
  return cx > GARAGE[0] && cx < GARAGE[2] && cy > GARAGE[1] && cy < GARAGE[3];
};

/** The bottom and top of an opening, in inches above the first floor. */
function heights(level: "L1" | "L2", o: Opening): [number, number] {
  const base = level === "L2" ? HEIGHTS.l2 : 0;
  if (o.kind === "window") {
    const head = base + (o.head ?? 96);
    return [head - (o.height ?? 48), head];
  }
  const floor = level === "L1" && inGarage(o.cut) ? Z.garage : base;
  return [floor, floor + (o.height ?? 80)];
}

/**
 * Flood vents, 16" x 8", from the model: at a point along the face. Only the west wall's show
 * in an elevation; the east wall's vent faces the entry porch, inside its recess.
 */
const VENTS: { face: FaceKey; at: number }[] = FLOOD_VENTS.filter((x) => x.wall === "W").map(
  (x) => ({ face: "W", at: DEPTH - x.at[1] }),
);
const VENT = { w: 16, h: 8, bottom: Z.garage + 2 };

// The lanai: 12" square columns at its outer corners, LB-1 (8" x 20") on them, mono trusses on
// a ledger, as S-101 and S-102 have it.
const LAN = (() => {
  const roof = ROOF.lanai.rect;
  const thick = 8; // the fascia, and the roof's depth at the eave
  const lowTop = ROOF.lanai.low;
  const slope = HEIGHTS.lanaiPitch / 12;
  const topAt = (y: number) => ROOF.lanai.high - (y - DEPTH) * slope;
  const postY: [number, number] = [LANAI[3] - 12, LANAI[3]];
  const beamTop = HEIGHTS.lanaiPlate;
  return { roof, thick, lowTop, topAt, postY, beamTop, beamBottom: beamTop - 20, slab: Z.lanai };
})();

/** The lanai steps' riser, and the entry stair's. */
const LANAI_RISER = riser(Z.lanai, Z.deck, LANAI_SLAB.steps.risers);
const ENTRY_RISER = riser(Z.porch, Z.grade, ENTRY.risers);
const inches1 = (x: number): string => `${x.toFixed(1)}"`;

/** The roof's outline in a view: the eave's span and the ridge's span at the top. */
function roofOutline(f: Face): [number, number][] {
  const o = HEIGHTS.overhang;
  const run = (ROOF.eave[3] - ROOF.eave[1]) / 2;
  if (f.key === "S" || f.key === "N") {
    return [
      [-o, Z.eave],
      [-o + run, Z.ridge],
      [W + o - run, Z.ridge],
      [W + o, Z.eave],
    ];
  }
  return [
    [-o, Z.eave],
    [DEPTH / 2, Z.ridge],
    [DEPTH + o, Z.eave],
  ];
}

/** Vertical lines inside a convex outline, `step` apart: standing seams, for a hatch. */
function seams(
  L: Local,
  outline: readonly [number, number][],
  h0: number,
  h1: number,
  step: number,
): void {
  for (let h = h0 + step; h < h1 - 1; h += step) {
    // Where the vertical line at h meets the outline's edges.
    const zs: number[] = [];
    outline.forEach((a, k) => {
      const b = outline[(k + 1) % outline.length]!;
      if ((a[0] - h) * (b[0] - h) < 0 || (a[0] === h && b[0] !== h)) {
        const t = (h - a[0]) / (b[0] - a[0]);
        zs.push(a[1] + t * (b[1] - a[1]));
      }
    });
    if (zs.length >= 2) {
      const lo = Math.min(...zs);
      const hi = Math.max(...zs);
      if (hi - lo > 1) L.d.line(L.P(h, lo), L.P(h, hi));
    }
  }
}

/** A window in elevation: its stucco trim, its frame, sash lines and tag. */
function windowElev(
  L: Local,
  v: View,
  h0: number,
  h1: number,
  z0: number,
  z1: number,
  tag: string,
): void {
  const kind = WINDOW_TYPES[tag]?.kind ?? "";
  const hm = (h0 + h1) / 2;
  const zm = (z0 + z1) / 2;
  L.d.layer(LAYERS.elevFine, {}, () => {
    // The stucco trim band. At the second floor the head meets the soffit, so the band stops there.
    L.rect(h0 - 4, z0 - 3, h1 + 4, Math.min(z1 + 4, Z.soffit));
    L.line(h0 - 6, z0 - 3, h1 + 6, z0 - 3); // the sill projects
    L.rect(h0 + 2, z0 + 2, h1 - 2, z1 - 2);
  });
  L.d.layer(LAYERS.glaz, {}, () => {
    L.rect(h0, z0, h1, z1);
    if (kind === "TWIN SINGLE HUNG") {
      L.line(hm, z0, hm, z1);
      L.line(h0 + 2, zm, h1 - 2, zm);
    } else if (kind === "SINGLE HUNG") {
      L.line(h0 + 2, zm, h1 - 2, zm);
    } else if (kind === "CASEMENT") {
      // The operation lines meet on the hinge side.
      L.d.polyline([L.P(h0 + 2, z0 + 2), L.P(h1 - 2, zm), L.P(h0 + 2, z1 - 2)], false, {
        linetype: "DASHED",
      });
    } else if (kind === "AWNING") {
      L.d.polyline([L.P(h0 + 2, z0 + 2), L.P(hm, z1 - 2), L.P(h1 - 2, z0 + 2)], false, {
        linetype: "DASHED",
      });
    }
  });
  L.d.layer(LAYERS.tags, {}, () => {
    L.d.insert("WINDOW TAG", L.P(hm, z0 - 3 - v.p(0.2)), {
      scale: v.p(1),
      attributes: { WINDOW: tag },
    });
  });
}

/** A door in elevation, by kind. */
function doorElev(
  L: Local,
  v: View,
  h0: number,
  h1: number,
  z0: number,
  z1: number,
  o: Opening,
): void {
  L.d.layer(LAYERS.elevFine, {}, () => L.rect(h0 - 4, z0, h1 + 4, z1 + 4));
  L.d.layer(LAYERS.door, {}, () => {
    L.rect(h0, z0, h1, z1);
    if (o.kind === "overhead") {
      for (let k = 1; k < 4; k++)
        L.line(h0, z0 + ((z1 - z0) * k) / 4, h1, z0 + ((z1 - z0) * k) / 4);
      // A row of lites in the top section.
      const n = 8;
      const step = (h1 - h0) / n;
      for (let k = 0; k < n; k++)
        L.rect(h0 + k * step + 3, z1 - (z1 - z0) / 4 + 4, h0 + (k + 1) * step - 3, z1 - 5);
    } else if (o.kind === "slider") {
      const third = (h1 - h0) / 3;
      for (let k = 1; k < 3; k++) L.line(h0 + k * third, z0, h0 + k * third, z1);
      for (let k = 0; k < 3; k++)
        L.rect(h0 + k * third + 3, z0 + 4, h0 + (k + 1) * third - 3, z1 - 3);
    } else {
      L.rect(h0 + 5, z0 + 10, h1 - 5, z1 - 6); // a full lite, impact glass
      L.d.circle(L.P(o.hinge === "end" ? h0 + 4 : h1 - 4, z0 + 38), 1);
    }
  });
  if (o.tag) {
    L.d.layer(LAYERS.tags, {}, () => {
      L.d.insert("DOOR TAG", L.P((h0 + h1) / 2, (z0 + z1) / 2), {
        scale: v.p(1),
        attributes: { DOOR: o.tag! },
      });
    });
  }
}

interface Extent {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/** Draws one elevation at its origin. Returns its extent in local coordinates. */
function elevation(d: D, v: View, key: FaceKey): Extent {
  const f = FACES[key];
  const o = ORIGIN[key];
  const len = f.len;
  const ov = HEIGHTS.overhang;
  const front: Box[] = []; // what stands in front of the house's face, for hidden parts
  const F = local(d, o);
  const box = F.box;

  // --- The lanai, in front of the north face or in profile at the sides. ---------------------
  let lanaiLeft = -ov;
  let lanaiRight = len + ov;
  d.layer(LAYERS.elev, {}, () => {
    if (key === "N") {
      const [a, b] = f.span(LAN.roof);
      const [p0, p1] = f.span([LANAI[0], 0, LANAI[0] + 12, 0]);
      const [q0, q1] = f.span([LANAI[2] - 12, 0, LANAI[2], 0]);
      F.rect(a, LAN.lowTop - LAN.thick, b, LAN.lowTop); // fascia
      F.rect(a, LAN.lowTop, b, ROOF.lanai.high); // the roof, seen from its low side
      d.layer(LAYERS.elevFine, {}, () =>
        seams(
          F,
          [
            [a, LAN.lowTop],
            [b, LAN.lowTop],
            [b, ROOF.lanai.high],
            [a, ROOF.lanai.high],
          ],
          a,
          b,
          16,
        ),
      );
      F.rect(Math.min(p0, q0), LAN.beamBottom, Math.max(p1, q1), LAN.lowTop - LAN.thick); // beam
      F.rect(p0, LAN.slab, p1, LAN.beamBottom);
      F.rect(q0, LAN.slab, q1, LAN.beamBottom);
      const [s0, s1] = f.span(LANAI);
      // The steps to the pool deck, in front of the stem wall, which breaks behind them.
      const [t0, t1] = f.span([LANAI_SLAB.steps.x0, 0, LANAI_SLAB.steps.x1, 0]);
      local(d, o, [box(t0, Z.grade - 1, t1, LAN.slab + 1)]).rect(s0, Z.grade, s1, LAN.slab); // the slab edge and stem wall
      stairFront(F, t0, t1, LAN.slab, Z.deck, LANAI_SLAB.steps.risers);
      F.line(s0 - 24, Z.deck, s1 + 24, Z.deck); // the pool deck's edge
      // 36" guards on the open side, column to column, stopped at the steps.
      const c0 = Math.min(p1, q1);
      const c1 = Math.max(p0, q0);
      guardElev(F, c0, t0, LAN.slab);
      guardElev(F, t1, c1, LAN.slab);
      front.push(
        box(a, LAN.lowTop - LAN.thick, b, ROOF.lanai.high),
        box(Math.min(p0, q0), LAN.beamBottom, Math.max(p1, q1), LAN.lowTop),
        box(p0, LAN.slab, p1, LAN.beamBottom),
        box(q0, LAN.slab, q1, LAN.beamBottom),
        box(s0, Z.grade, s1, LAN.slab),
      );
    } else if (key === "E" || key === "W") {
      // h of a building y, for this face.
      const hy = (y: number) => (key === "E" ? y : DEPTH - y);
      const dir: 1 | -1 = key === "E" ? 1 : -1;
      const y1 = LAN.roof[3];
      F.poly(
        [
          [hy(DEPTH), ROOF.lanai.high],
          [hy(y1), LAN.lowTop],
          [hy(y1), LAN.lowTop - LAN.thick],
          [hy(DEPTH), ROOF.lanai.high - LAN.thick - 9],
        ],
        false,
      );
      F.rect(hy(LAN.postY[0]), LAN.slab, hy(LAN.postY[1]), LAN.beamBottom);
      F.rect(hy(LAN.postY[0]), LAN.beamBottom, hy(LAN.postY[1]), LAN.beamTop);
      F.rect(hy(DEPTH), Z.grade, hy(LANAI[3]), LAN.slab);
      // The side guard, house wall to column, and the steps in profile down to the pool deck.
      guardElev(
        F,
        Math.min(hy(DEPTH), hy(LAN.postY[0])),
        Math.max(hy(DEPTH), hy(LAN.postY[0])),
        LAN.slab,
      );
      const s = LANAI_SLAB.steps;
      stairProfile(F, hy(LANAI[3]), dir, LAN.slab, Z.deck, s.risers, s.tread);
      const deckEnd = hy(LANAI[3]) + dir * ((s.risers - 1) * s.tread + 30);
      F.line(hy(LANAI[3]), Z.deck, deckEnd, Z.deck);
      if (key === "E") lanaiRight = Math.max(lanaiRight, y1, deckEnd);
      else lanaiLeft = Math.min(lanaiLeft, hy(y1), deckEnd);
      // The entry stair, south of the porch, in profile.
      const entryEnd = hy(0) - dir * ((ENTRY.risers - 1) * ENTRY.tread);
      stairProfile(F, hy(0), -dir as 1 | -1, Z.porch, Z.grade, ENTRY.risers, ENTRY.tread);
      if (key === "E") lanaiLeft = Math.min(lanaiLeft, entryEnd - 12);
      else lanaiRight = Math.max(lanaiRight, entryEnd + 12);
    }
  });

  // The openings in this face, so the wall's lines stop at them.
  const openings: { level: "L1" | "L2"; op: Opening; h: [number, number]; z: [number, number] }[] =
    [];
  for (const [levelKey, level] of [
    ["L1", L1],
    ["L2", L2],
  ] as const) {
    for (const op of level.openings) {
      if (!op.exterior || !f.on(op.cut)) continue;
      if (key === "S" && op.tag === "101") continue;
      openings.push({ level: levelKey, op, h: f.span(op.cut), z: heights(levelKey, op) });
    }
  }
  const holes = openings.map((x) => box(x.h[0] - 4, x.z[0] - 3, x.h[1] + 4, x.z[1] + 4));
  if (key === "S") holes.push(box(272, Z.porch, 376, Z.tieBeam - 16));
  const L = local(d, o, front);
  const Lw = local(d, o, [...front, ...holes]);

  // --- The walls. ---------------------------------------------------------------------------
  d.layer(LAYERS.elev, {}, () => {
    L.line(0, Z.grade, 0, Z.soffit);
    L.line(len, Z.grade, len, Z.soffit);
    L.rect(-ov, Z.soffit, len + ov, Z.eave); // fascia
    L.line(0, Z.soffit, len, Z.soffit);
  });
  d.layer(LAYERS.elevFine, {}, () => {
    Lw.line(0, Z.ff, len, Z.ff); // control joint at the floor
    Lw.line(0, Z.tieBeam, len, Z.tieBeam); // the band at the floor line
    Lw.line(0, Z.l2, len, Z.l2);
  });
  // The roof, with standing seams.
  const outline = roofOutline(f);
  d.layer(LAYERS.elev, {}, () => F.poly(outline, false));
  d.layer(LAYERS.elevFine, {}, () => seams(F, outline, -ov, len + ov, 16));

  // The entry porch in the south face: an opening under the second floor, the door beyond.
  if (key === "S") {
    const p0 = 272;
    const p1 = 376;
    const top = Z.tieBeam - 16;
    d.layer(LAYERS.elev, {}, () => {
      L.poly(
        [
          [p0, Z.porch],
          [p0, top],
          [p1, top],
          [p1, Z.porch],
        ],
        false,
      );
      L.line(p0, Z.porch, p1, Z.porch);
    });
    const door = L1.openings.find((x) => x.tag === "101")!;
    doorElev(L, v, door.cut[0], door.cut[2], Z.ff, Z.ff + (door.height ?? 80), door);
    // The entry stair from the walk to the porch, handrails both sides, and the 36" guard along
    // the porch's open edge either side of it.
    stairFront(L, ENTRY.x0, ENTRY.x1, Z.porch, Z.grade, ENTRY.risers);
    guardElev(L, p0, ENTRY.x0, Z.porch);
    guardElev(L, ENTRY.x1, p1, Z.porch);
  }

  // --- Openings. ----------------------------------------------------------------------------
  for (const { op, h, z } of openings) {
    if (op.kind === "window") windowElev(L, v, h[0], h[1], z[0], z[1], op.tag ?? "");
    else doorElev(L, v, h[0], h[1], z[0], z[1], op);
  }

  // --- Flood vents. -------------------------------------------------------------------------
  const vents = VENTS.filter((x) => x.face === key);
  d.layer(LAYERS.elevFine, {}, () => {
    for (const vent of vents) {
      const h0 = vent.at - VENT.w / 2;
      const h1 = vent.at + VENT.w / 2;
      L.rect(h0, VENT.bottom, h1, VENT.bottom + VENT.h);
      for (let k = 1; k < 4; k++) L.line(h0 + 1, VENT.bottom + k * 2, h1 - 1, VENT.bottom + k * 2);
    }
  });

  // --- Below grade: the footing and stem wall, hidden. -------------------------------------
  d.layer(LAYERS.ftng, {}, () => {
    // 20" wide on the 8" wall, so 6" past each face; its top 6" below finish grade (1/S-501).
    const past = (Z.footingWidth - 8) / 2;
    F.rect(-past, Z.footingTop - Z.footingDepth, len + past, Z.footingTop);
  });

  // --- Grade, heavy, past both ends. ------------------------------------------------------
  const left = Math.min(lanaiLeft, -ov);
  const right = Math.max(lanaiRight, len + ov);
  d.layer(LAYERS.grade, {}, () => {
    F.line(left - v.p(0.5), Z.grade, right + v.p(0.5), Z.grade);
  });

  // --- Flood levels, dashed, labeled at the end that has room. ----------------------------
  // The labels end at the face's right end, or left of the flood vents where the vents are there.
  const ventsHere = VENTS.filter((x) => x.face === key);
  const labelAt = ventsHere.length ? Math.min(...ventsHere.map((x) => x.at)) - VENT.w : len;
  floodLine(
    F,
    v,
    0,
    len,
    Z.bfe,
    `B.F.E. ${CRITERIA.flood.bfe.toFixed(2)}' NAVD (ZONE ${CRITERIA.flood.zone})`,
    labelAt,
  );
  floodLine(
    F,
    v,
    0,
    len,
    Z.dfe,
    `D.F.E. ${CRITERIA.flood.dfe.toFixed(2)}' NAVD (BFE + 1'-0")`,
    labelAt,
  );

  // --- Levels, on the left, and the height dimensions between them. -----------------------
  const colA = left - v.p(1.05);
  const colB = colA - v.p(1.45);
  const garage = key === "S" || key === "W";
  const levels: { z: number; name: string; from: number; col: number }[] = [
    {
      z: Z.ridge,
      name: "RIDGE",
      from: f.key === "S" || f.key === "N" ? -ov + (ROOF.eave[3] - ROOF.eave[1]) / 2 : len / 2,
      col: colA,
    },
    { z: Z.mean, name: "MEAN ROOF HT.", from: -ov + (Z.mean - Z.eave) * 2, col: colA },
    { z: Z.plate, name: "TOP OF PLATE", from: 0, col: colA },
    { z: Z.l2, name: "SECOND FLOOR", from: 0, col: colA },
    { z: Z.tieBeam, name: "TOP OF TIE BEAM", from: 0, col: colA },
    { z: Z.ff, name: "FIRST FLOOR (F.F.E.)", from: 0, col: colA },
    ...(garage ? [{ z: Z.garage, name: "GARAGE SLAB", from: 0, col: colA }] : []),
    { z: Z.grade, name: "FINISH GRADE", from: left - v.p(0.5), col: garage ? colB : colA },
  ];
  for (const lv of levels)
    levelLeft(L, v, lv.col, lv.z, lv.from, lv.name, `EL. ${navd(lv.z).toFixed(2)}' NAVD`);
  d.layer(LAYERS.dims, {}, () => {
    const at = o[0] + left - v.p(0.45);
    const pts = [Z.grade, Z.ff, Z.tieBeam, Z.l2, Z.plate].map((z): Point =>
      L.P(Math.min(0, left), z),
    );
    dimString(d, v, pts, "y", at);
    // The building height, from the design flood elevation to the mean roof height.
    const x2 = o[0] + right + v.p(0.45);
    d.linearDimension(L.P(right, Z.dfe), L.P(right, Z.mean), [x2, 0], {
      style: v.dim,
      along: "y",
      text: `${ftIn(Z.mean - Z.dfe)} BLDG. HT., D.F.E. TO MEAN ROOF (${CRITERIA.zoning.maxHeight}'-0" MAX.)`,
    });
  });

  // --- Notes, on the right. ---------------------------------------------------------------
  const notes: Note[] = [];
  const roofAt = f.key === "S" || f.key === "N" ? len * 0.78 : len * 0.62;
  const roofZ = Z.eave + Math.min(roofAt + ov, len + ov - roofAt) * 0.5 * 0.5;
  notes.push({
    at: [roofAt, roofZ],
    lines: ["STANDING SEAM METAL ROOFING, 24 GA.,", "6:12, ON SELF-ADHERED UNDERLAYMENT"],
  });
  notes.push({
    at: [len + ov - 2, Z.eave - 3],
    lines: ["ALUMINUM FASCIA AND", "VENTED ALUMINUM SOFFIT"],
  });
  notes.push({
    at: [len - 20, Z.l2 + 70],
    lines: ['STUCCO ON LATH OVER 7/16" OSB', 'ON 2X6 STUDS AT 16" O.C.'],
  });
  notes.push({
    at: [len - 10, (Z.tieBeam + Z.l2) / 2],
    lines: ["STUCCO BAND AT FLOOR LINE,", "CONTROL JOINT TOP AND BOTTOM"],
  });
  notes.push({ at: [len - 20, 50], lines: ['5/8" STUCCO ON 8" CMU'] });
  notes.push({
    at: [len - 100, Z.ff - 3],
    lines: ["STUCCO ON CMU STEM WALL,", "COMPACTED FILL BELOW SLAB"],
  });
  // Notes about what stands at grade go under the grade, below what they point at, in one row:
  // the viewport's height leaves no room for a second.
  const under = Z.grade - v.p(0.75);
  let deepest = under;
  const below = (n: Note): void => {
    notes.push(n);
    deepest = Math.min(deepest, n.elbow![1]);
  };
  const entryNote = [
    "ENTRY STAIR: " +
      ENTRY.risers +
      " RISERS AT " +
      inches1(ENTRY_RISER) +
      ", " +
      (ENTRY.risers - 1) +
      " TREADS",
    "AT " + ENTRY.tread + '", HANDRAILS BOTH SIDES AT 34"-38"',
  ];
  const stepsNote = [
    `LANAI STEPS: ${LANAI_SLAB.steps.risers} RISERS AT ${inches1(LANAI_RISER)}, ${LANAI_SLAB.steps.tread}" TREADS,`,
    `HANDRAILS BOTH SIDES, TO POOL DECK EL. ${LANAI_SLAB.deck.toFixed(2)}'`,
  ];
  const guardNote = (where: string) => [
    `${LANAI_SLAB.guard}" GUARD AT ${where},`,
    '4" SPHERE MAX. OPENING (R312.1)',
  ];
  if (vents.length) {
    const vent = vents[vents.length - 1]!;
    below({
      at: [vent.at, VENT.bottom],
      elbow: [vent.at - v.p(0.6), under],
      lines: [
        `ENGINEERED FLOOD VENT, ${vents.length} HERE, ${FLOOD_VENTS.length} IN ALL,`,
        `EACH CERTIFIED FOR 200 SQ. FT., SEE S-101`,
      ],
    });
  }
  if (key === "W") {
    const door = L1.openings.find((x) => x.tag === "109")!;
    const [d0, d1] = f.span(door.cut);
    below({
      at: [(d0 + d1) / 2, Z.grade],
      elbow: [(d0 + d1) / 2 + v.p(0.6), under],
      lines: [
        'CONC. LANDING AT DOOR 109, 36" DEEP,',
        `${ftIn(Z.garage - Z.grade)} BELOW THRESHOLD (R311.3.2)`,
      ],
    });
    below({
      at: [-80, Z.lanai + 30],
      elbow: [-80 + v.p(0.5), under],
      lines: guardNote("LANAI, 3 SIDES"),
    });
    below({
      at: [DEPTH - LANAI[3] - 20, Z.deck + 10],
      elbow: [DEPTH - LANAI[3] - 20 - v.p(0.4), under],
      lines: stepsNote,
    });
    notes.push({ at: [DEPTH + 30, Z.grade + 14], lines: entryNote });
  }
  if (key === "E") {
    below({ at: [-22, Z.grade + 10], elbow: [-22 - v.p(0.5), under], lines: entryNote });
    notes.push({ at: [LANAI[3] - 60, Z.lanai + 30], lines: guardNote("LANAI, 3 SIDES") });
    notes.push({ at: [LANAI[3] + 16, Z.deck + 10], lines: stepsNote });
  }
  if (key === "N") {
    const [t0, t1] = f.span([LANAI_SLAB.steps.x0, 0, LANAI_SLAB.steps.x1, 0]);
    below({
      at: [50, Z.lanai + 30],
      elbow: [50 - v.p(0.5), under],
      lines: guardNote("LANAI, 3 SIDES"),
    });
    below({
      at: [t1 - 4, Z.deck + LANAI_RISER * 1.5],
      elbow: [t1 + v.p(0.6), under],
      lines: stepsNote,
    });
    void t0;
  }
  if (key === "S") {
    below({
      at: [ENTRY.x1 - 4, Z.grade + ENTRY_RISER * 1.5],
      elbow: [ENTRY.x1 + v.p(0.5), under],
      lines: entryNote,
    });
    below({
      at: [292, Z.porch + 30],
      elbow: [292 - v.p(0.5), under],
      lines: guardNote("PORCH EDGE"),
    });
  }
  const w = [...L1.openings, ...L2.openings].find(
    (x) => x.kind === "window" && x.exterior && f.on(x.cut),
  );
  if (w) {
    const [h0] = f.span(w.cut);
    const [, z1] = heights(L2.openings.includes(w) ? "L2" : "L1", w);
    notes.push({ at: [h0, z1 - 4], lines: ["IMPACT RATED WINDOW,", "SEE A-601"] });
  }
  if (key === "N")
    notes.push({
      at: [f.span(LAN.roof)[1] - 30, (LAN.lowTop + ROOF.lanai.high) / 2],
      lines: ["LANAI ROOF, STANDING SEAM", "METAL AT 3:12, SEE S-102"],
    });
  if (key === "S")
    below({
      at: [40, Z.garage + 20],
      elbow: [40 - v.p(0.6), under],
      lines: ["16'-0\" X 8'-0\" IMPACT", "OVERHEAD DOOR, SEE A-601"],
    });
  notes.push({
    at: [right + v.p(0.3), Z.grade],
    lines: [
      `FINISH GRADE EL. ${CRITERIA.flood.finishGrade.toFixed(2)}' NAVD, SLOPE`,
      'AWAY 6" IN 10\'-0" (FBC-R R401.3)',
    ],
  });
  const noteH = right + v.p(0.85);
  const lowest = noteStack(L, v, noteH, notes);

  // A heading under the view that names the flood zone.
  const textLeft =
    (garage ? colB : colA) -
    v.p(0.1) -
    v.p(Math.max(...levels.map((lv) => width(lv.name, H.note))));
  const noteRight = noteH + v.p(0.25) + v.p(Math.max(...notes.map((n) => noteWidth(n.lines))));
  return {
    left: textLeft,
    right: noteRight,
    bottom: Math.min(lowest, deepest - v.p(0.4)),
    top: Z.ridge + v.p(0.4),
  };
}

const ELEV_NOTES = [
  "ELEVATIONS IN FEET ARE IN NAVD 88. HEIGHTS ARE TO THE TOP OF CONCRETE OR THE TOP OF FRAMING.",
  `FLOOD ZONE ${CRITERIA.flood.zone}, PANEL ${CRITERIA.flood.panel}. B.F.E. ${CRITERIA.flood.bfe.toFixed(2)}', D.F.E. ${CRITERIA.flood.dfe.toFixed(2)}', F.F.E. ${CRITERIA.flood.ffe.toFixed(2)}' NAVD. THE LOWEST FLOOR IS ${ftIn((CRITERIA.flood.ffe - CRITERIA.flood.bfe) * 12)} ABOVE THE B.F.E. (FBC-R R322.2.1).`,
  "THE GARAGE IS BELOW THE D.F.E.: PARKING, ACCESS AND STORAGE ONLY. FLOOD DAMAGE-RESISTANT MATERIALS BELOW THE D.F.E. FLOOD VENTS PER S-101.",
  'STUCCO: 3 COATS, 7/8" ON LATH OVER FRAMING, 5/8" ON MASONRY, WITH CONTROL JOINTS AT 144 SQ. FT. MAX. AND AT EVERY CHANGE OF SUBSTRATE (ASTM C926, C1063).',
  `ALL WINDOWS AND DOORS IMPACT RATED, WITH FLORIDA PRODUCT APPROVAL, FOR THE DESIGN PRESSURES ON A-601. WINDOW HEADS: FIRST FLOOR ${ftIn(headOf(L1))}, SECOND FLOOR ${ftIn(headOf(L2))} A.F.F.; GARAGE WINDOW ${ftIn(garageHead())} ABOVE THE GARAGE SLAB.`,
  'ROOFING: STANDING SEAM METAL WITH FLORIDA PRODUCT APPROVAL, ON SELF-ADHERED UNDERLAYMENT OVER 19/32" PLYWOOD DECK (FBC-R R905.10).',
  `BUILDING HEIGHT IS MEASURED FROM THE D.F.E. (${CRITERIA.flood.dfe.toFixed(2)}' NAVD) TO THE MEAN ROOF HEIGHT: ${ftIn(Z.mean - Z.dfe)}, ${CRITERIA.zoning.maxHeight}'-0" MAX. IN ${CRITERIA.zoning.district}.`,
  `FINISH GRADE ${CRITERIA.flood.finishGrade.toFixed(2)}' NAVD AT THE FOUNDATION (EXISTING ${CRITERIA.flood.grade.toFixed(2)}'), SLOPING AWAY 6" IN THE FIRST 10'-0" TO THE SWALES (FBC-R R401.3). SEE C-101.`,
  `ENTRY STAIR: ${ENTRY.risers} RISERS OF ${inches1(ENTRY_RISER)} AND ${ENTRY.risers - 1} TREADS OF ${ENTRY.tread}" FROM THE PORCH (${ENTRY.slab.toFixed(2)}') TO THE WALK. LANAI STEPS: ${LANAI_SLAB.steps.risers} RISERS OF ${inches1(LANAI_RISER)} AND ${LANAI_SLAB.steps.risers - 1} TREADS OF ${LANAI_SLAB.steps.tread}" TO THE POOL DECK (${LANAI_SLAB.deck.toFixed(2)}'). HANDRAILS BOTH SIDES OF EACH, 34" TO 38" ABOVE THE NOSINGS (FBC-R R311.7.8).`,
  `GUARDS: ${LANAI_SLAB.guard}" HIGH AT THE ENTRY PORCH'S OPEN EDGE AND THE LANAI'S WEST, NORTH AND EAST SIDES, WHERE THE SLAB IS MORE THAN 30" ABOVE GRADE. NO OPENING PASSES A 4" SPHERE (FBC-R R312.1).`,
];

/** The head height of a level's windows, above its floor: the most common one. */
function headOf(level: typeof L1): number {
  const heads = level.openings
    .filter((o) => o.kind === "window" && !inGarage(o.cut))
    .map((o) => o.head ?? 96);
  return heads.sort(
    (a, b) => heads.filter((x) => x === b).length - heads.filter((x) => x === a).length,
  )[0]!;
}
/** The garage window's head above the garage slab. */
function garageHead(): number {
  return (L1.openings.find((o) => o.kind === "window" && inGarage(o.cut))?.head ?? 96) - Z.garage;
}

/** The levels as a table, for the notes column. */
function levelTable(d: D, at: Point, w: number): number {
  const rows: [string, number][] = [
    ["RIDGE", Z.ridge],
    ["MEAN ROOF HEIGHT", Z.mean],
    ["TOP OF PLATE, 2ND FLOOR", Z.plate],
    ["SECOND FLOOR", Z.l2],
    ["TOP OF TIE BEAM", Z.tieBeam],
    ["FIRST FLOOR (F.F.E.)", Z.ff],
    ["ENTRY PORCH AND LANAI SLAB", Z.porch],
    ["D.F.E.", Z.dfe],
    ["B.F.E.", Z.bfe],
    ["GARAGE SLAB", Z.garage],
    ["POOL DECK", Z.deck],
    ["FINISH GRADE AT FOUNDATION", Z.grade],
    ["EXISTING GRADE", Z.existing],
  ];
  const c2 = 1.0;
  const c3 = 0.9;
  return table(
    d,
    at,
    "LEVELS",
    [
      { name: "LEVEL", width: w - c2 - c3 },
      { name: "ABOVE F.F.", width: c2, align: "right" },
      { name: "NAVD 88", width: c3, align: "right" },
    ],
    rows.map(([name, z]) => [name, z >= 0 ? ftIn(z) : `-${ftIn(-z)}`, `${navd(z).toFixed(2)}'`]),
  );
}

const VP = { h: 10.25 };

function elevationSheet(d: D, number: string, keys: readonly [FaceKey, FaceKey]): void {
  elevSymbols(d);
  const v = view(d, 48);
  const extents = keys.map((k) => elevation(d, v, k));
  // Both views get the width of the wider, so their titles and the notes line up.
  const vpW = Math.max(...extents.map((e) => (e.right - e.left) / v.ratio)) + 0.3;
  frame(d, number, (dd, sheet) => {
    keys.forEach((k, i) => {
      const e = extents[i]!;
      const top = i === 0 ? AREA.top : AREA.top - VP.h - 0.95;
      const cx = (e.left + e.right) / 2;
      const cz = (e.bottom + e.top) / 2;
      const o = ORIGIN[k];
      viewport(dd, sheet, {
        corner: [AREA.left, top - VP.h],
        size: [vpW, VP.h],
        center: [o[0] + cx, o[1] + cz],
        v,
        id: `vp-${number}-${k}`,
        number: String(i + 1),
        sheetNo: number,
        title: FACES[k].title,
        titleAt: [AREA.left + 0.2, top - VP.h - 0.45],
      });
    });
    const x = AREA.left + vpW + 0.4;
    const w = AREA.right - x;
    let y = AREA.top - 0.1;
    y = noteColumn(dd, [x, y], w, "ELEVATION NOTES", ELEV_NOTES);
    y -= 0.25;
    y = levelTable(dd, [x, y], w);
    void width;
    void put;
    void H;
    void el;
  });
}

export const SHEETS: Record<string, SheetDraw> = {
  "A-201": (d) => elevationSheet(d, "A-201", ["S", "N"]),
  "A-202": (d) => elevationSheet(d, "A-202", ["E", "W"]),
  ...SECTION_SHEETS,
};
