// S-102: the second floor framing plan and the roof framing plan, side by side at
// 3/16" = 1'-0", with the connector, lintel and beam schedules.
import type { Point } from "../../../src/index.ts";
import {
  ATTIC_ACCESS,
  HEIGHTS,
  L1,
  L2,
  LANAI,
  ROOF,
  STAIR,
  W,
  DEPTH,
  type Opening,
  type Rect,
} from "../model/house.ts";
import { CRITERIA } from "../project.ts";
import { frame } from "../lib/frame.ts";
import {
  AREA,
  dimString,
  ftIn,
  H,
  LAYERS,
  leaderNote,
  noteColumn,
  put,
  slopeArrow,
  table,
  view,
  viewport,
  type D,
  type View,
} from "../lib/kit.ts";
import { alongX, openingWidth, wallOutline } from "../lib/plan.ts";
import { breakLine } from "../../lib/drafting.ts";
import { shift, SL, spanArrow, structureSetup } from "./structure-kit.ts";
import { dim, FFE_ABOVE_GRADE, ROOF_TCDL, wood } from "./structure-details.ts";

const FLR: Point = [210000, 0];
const RF: Point = [220000, 0];

/** The bearing line of the floor trusses: the garage wall and the stair wall, then FB-1. */
const BEAR_Y = 290;
/** The roof trusses that flank the attic access, in place of the 24" layout's trusses there. */
const ATTIC_TRUSSES = [ATTIC_ACCESS[0] - 2, ATTIC_ACCESS[2] + 4];

/** The lintel over each masonry opening of the first floor, by its width. */
function lintelMark(o: Opening): string {
  const w = openingWidth(o);
  if (w <= 48) return "L-1";
  if (w <= 80) return "L-2";
  if (w <= 144) return "L-3";
  return "L-4";
}
const inMasonry = (o: Opening) =>
  L1.exterior.some(
    (r) =>
      o.cut[0] >= r[0] - 0.1 &&
      o.cut[2] <= r[2] + 0.1 &&
      o.cut[1] >= r[1] - 0.1 &&
      o.cut[3] <= r[3] + 0.1,
  );
const MASONRY_OPENINGS = L1.openings.filter(inMasonry);

function floorFraming(d: D, v: View): void {
  const o = (p: Point): Point => [FLR[0] + p[0], FLR[1] + p[1]];
  const h = v.p(H.note);
  // The walls below: CMU (with the tie beam on it) and the stud walls, both dashed.
  d.layer(SL.below, {}, () => {
    for (const [a, b] of wallOutline(
      L1.walls.map((r) => shift(r, FLR)),
      L1.openings.map((x) => shift(x.cut, FLR)),
    ))
      d.line(a, b);
  });
  // Floor trusses at 24" o.c., single lines from bearing to bearing.
  d.layer(LAYERS.fram, {}, () => {
    for (let x = 32; x < 616; x += 24) {
      const inStair = x > STAIR.x0 && x < STAIR.x1;
      if (inStair) {
        d.line(o([x, 8]), o([x, STAIR.y0]));
        if (BEAR_Y - STAIR.y1 > 6) d.line(o([x, STAIR.y1]), o([x, BEAR_Y]));
      } else d.line(o([x, 8]), o([x, BEAR_Y]));
      d.line(o([x, BEAR_Y + 4]), o([x, 520]));
    }
    // Doubled trimmer trusses each side of the stair opening, the girder truss FG-1 at its south
    // end, and a rim at its north end, which stops at the bearing wall below.
    for (const [x, s] of [
      [STAIR.x0, -1],
      [STAIR.x1, 1],
    ] as const) {
      d.line(o([x + s * 0.75, 8]), o([x + s * 0.75, BEAR_Y]));
      d.line(o([x + s * 2.25, 8]), o([x + s * 2.25, BEAR_Y]));
    }
    for (const dy of [-0.75, -2.25])
      d.line(o([STAIR.x0, STAIR.y0 + dy]), o([STAIR.x1, STAIR.y0 + dy]), { lineweight: 0.5 });
    d.line(o([STAIR.x0, STAIR.y1 + 0.75]), o([STAIR.x1, STAIR.y1 + 0.75]));
    // The opening, crossed.
    d.line(o([STAIR.x0 + 2, STAIR.y0 + 2]), o([STAIR.x1 - 2, STAIR.y1 - 2]));
    d.line(o([STAIR.x0 + 2, STAIR.y1 - 2]), o([STAIR.x1 - 2, STAIR.y0 + 2]));
  });
  // Beams: FB-1, the lintels and concrete beams, and the headers in the stud walls.
  d.layer(LAYERS.beam, {}, () => {
    d.line(o([382, BEAR_Y]), o([616, BEAR_Y]));
    d.line(o([382, BEAR_Y + 4]), o([616, BEAR_Y + 4]));
    for (const op of MASONRY_OPENINGS) {
      const ax = alongX(op);
      const c = ax ? (op.cut[1] + op.cut[3]) / 2 : (op.cut[0] + op.cut[2]) / 2;
      const [a0, a1] = ax ? [op.cut[0] - 8, op.cut[2] + 8] : [op.cut[1] - 8, op.cut[3] + 8];
      d.line(o(ax ? [a0, c] : [c, a0]), o(ax ? [a1, c] : [c, a1]));
    }
    d.line(o([264, 4]), o([384, 4]));
    for (const r of [
      [379.5, 92, 384, 168],
      [379.5, 208, 384, 272],
      [316, 288, 380, 292.5],
    ] as Rect[]) {
      const c = (r[0] + r[2]) / 2;
      if (r[3] - r[1] > r[2] - r[0]) d.line(o([c, r[1]]), o([c, r[3]]));
      else d.line(o([r[0], (r[1] + r[3]) / 2]), o([r[2], (r[1] + r[3]) / 2]));
    }
  });
  // The post under FB-1's west end.
  d.layer(LAYERS.fram, {}, () => d.rect(o([379.5, BEAR_Y - 2.75]), 4.5, 8.25));
  // Tags and notes.
  d.layer(LAYERS.strAnno, {}, () => {
    for (const op of MASONRY_OPENINGS) {
      const ax = alongX(op);
      const [cx, cy] = [(op.cut[0] + op.cut[2]) / 2, (op.cut[1] + op.cut[3]) / 2];
      const out = v.p(0.16);
      const inward = (ax ? (cy < 264 ? 1 : -1) : cx < 312 ? 1 : -1) * out;
      const at: Point = ax ? [cx, cy + inward] : [cx + inward, cy];
      put(d, o(at), lintelMark(op), v.p(H.small * 1.2), { align: "center", valign: "middle" });
    }
    spanArrow(d, v, o([150, 20]), o([150, BEAR_Y - 12]), ["FT-1", '16" FLR. TRUSSES @ 24" O.C.']);
    spanArrow(d, v, o([500, 20]), o([500, BEAR_Y - 12]), ["FT-1", '16" FLR. TRUSSES @ 24" O.C.']);
    spanArrow(d, v, o([150, BEAR_Y + 16]), o([150, 508]), ["FT-1", '16" FLR. TRUSSES @ 24" O.C.']);
    spanArrow(d, v, o([500, BEAR_Y + 16]), o([500, 508]), ["FT-1", '16" FLR. TRUSSES @ 24" O.C.']);
    const mid = (STAIR.y0 + STAIR.y1) / 2;
    put(d, o([(STAIR.x0 + STAIR.x1) / 2 - v.p(0.1), mid]), "STAIR OPENING", h, {
      align: "center",
      rotation: 90,
    });
    put(
      d,
      o([(STAIR.x0 + STAIR.x1) / 2 + v.p(0.1), mid]),
      `${ftIn(STAIR.x1 - STAIR.x0)} X ${ftIn(STAIR.y1 - STAIR.y0)}`,
      h,
      { align: "center", rotation: 90, valign: "top" },
    );
    leaderNote(d, v, o([560, BEAR_Y + 2]), o([580, 380]), ["FB-1, SEE", "SCHEDULE"]);
    leaderNote(d, v, o([381.75, BEAR_Y + 1]), o([330, 360]), ["(3) 2X6 POST", "AT FB-1"]);
    leaderNote(d, v, o([293, STAIR.y0]), o([230, 60]), ["FG-1 FLR. GIRDER", "TRUSS"]);
    leaderNote(d, v, o([STAIR.x0 + 8, STAIR.y1 + 0.75]), o([246, 335]), [
      "2X RIM ON BEARING",
      "WALL BELOW",
    ]);
    leaderNote(d, v, o([STAIR.x1 + 1.75, 140]), o([350, 150]), ["(2) FT-1", "TRIMMERS"]);
    leaderNote(d, v, o([0, 450]), o([-40, 470]), ["TB-1 ON ALL", "CMU WALLS"]);
    leaderNote(d, v, o([120, 4]), o([60, -40]), ["TB-2 OVER", "O.H. DOOR"]);
    leaderNote(d, v, o([320, 4]), o([400, -40]), ["TB-3 OVER PORCH"]);
    leaderNote(d, v, o([381.75, 130]), o([440, 110]), ["HDR. H-1"]);
    leaderNote(d, v, o([330, 290.25]), o([318, 318]), ["HDR. H-2"]);
    leaderNote(d, v, o([381.75, 240]), o([440, 240]), ["HDR. H-1"]);
    // Connector tags: C4 at each floor truss on the tie beam, C2 straps along the walls.
    d.layer(SL.conn, {}, () =>
      d.insert("S-CONN TAG", o([104, 30]), { scale: v.p(1), attributes: { CONN: "C4" } }),
    );
    put(
      d,
      o([118, 30]),
      `${CONNECTORS.find((r) => r[0] === "C4")![2]} LB AT EA. TRUSS, TYP.`,
      v.p(H.small * 1.2),
      { valign: "middle" },
    );
    d.layer(SL.conn, {}, () =>
      d.insert("S-CONN TAG", o([590, 30]), { scale: v.p(1), attributes: { CONN: "C2" } }),
    );
    put(
      d,
      o([578, 46]),
      `${CONNECTORS.find((r) => r[0] === "C2")![2]} LB AT 32" O.C. ALL EXT. WALLS`,
      v.p(H.small * 1.2),
      { align: "right", valign: "middle" },
    );
    d.layer(SL.conn, {}, () =>
      d.insert("S-CONN TAG", o([616, BEAR_Y - 22]), { scale: v.p(1), attributes: { CONN: "C8" } }),
    );
  });
  // The section mark to the tie beam detail, through window B in the north wall.
  d.layer(LAYERS.strAnno, {}, () => {
    d.line(o([238, 500]), o([238, 548]), { lineweight: 0.5 });
    d.insert("SECTION MARK", o([238, 560]), {
      scale: v.p(1),
      attributes: { SECT: "3", SHEET: "S-501" },
    });
  });
  d.layer(LAYERS.strDims, {}, () => {
    const first = v.p(0.5);
    const gap = v.p(0.3);
    dimString(d, v, [o([0, 0]), o([W, 0])], "x", FLR[1] - first - gap - v.p(0.5));
    dimString(d, v, [o([0, 0]), o([0, BEAR_Y + 2]), o([0, DEPTH])], "y", FLR[0] - first - v.p(0.7));
    dimString(d, v, [o([0, 0]), o([0, DEPTH])], "y", FLR[0] - first - gap - v.p(0.7));
  });
}

function roofFraming(d: D, v: View): void {
  const o = (p: Point): Point => [RF[0] + p[0], RF[1] + p[1]];
  const [ex0, ey0, ex1, ey1] = ROOF.eave;
  const g = 84; // the hip girder's setback from the end walls
  const gx = [g, W - g];
  d.layer(SL.below, {}, () => {
    for (const [a, b] of wallOutline(
      L2.exterior.map((r) => shift(r, RF)),
      [],
    ))
      d.line(a, b);
  });
  // Eave, hips and ridge.
  d.layer(LAYERS.roof, {}, () => {
    d.rect(o([ex0, ey0]), ex1 - ex0, ey1 - ey0);
    const [r0, r1] = ROOF.ridge;
    d.line(o(r0), o(r1));
    d.line(o([ex0, ey0]), o(r0));
    d.line(o([ex0, ey1]), o(r0));
    d.line(o([ex1, ey0]), o(r1));
    d.line(o([ex1, ey1]), o(r1));
  });
  d.layer(LAYERS.fram, {}, () => {
    // Hip girders, three plies, from wall to wall.
    for (const x of gx)
      for (const dx of [-2.25, 2.25])
        d.line(o([x + dx, 0]), o([x + dx, DEPTH]), { lineweight: 0.5 });
    // Step-down hip trusses and commons, full span with their tails.
    // The two at the attic access replace the 24" layout's trusses over the opening.
    for (let x = g + 24; x < W - g - 1; x += 24)
      if (x < ATTIC_TRUSSES[0]! - 6 || x > ATTIC_TRUSSES[1]! + 6) d.line(o([x, ey0]), o([x, ey1]));
    for (const x of ATTIC_TRUSSES) d.line(o([x, ey0]), o([x, ey1]));
    // The attic access in the ceiling, and its headers between the trusses.
    const [ax0, ay0, ax1, ay1] = ATTIC_ACCESS;
    d.rect(o([ax0, ay0]), ax1 - ax0, ay1 - ay0, { linetype: "HIDDEN" });
    for (const y of [ay0 - 1.5, ay1 + 1.5])
      d.line(o([ATTIC_TRUSSES[0]!, y]), o([ATTIC_TRUSSES[1]!, y]), { lineweight: 0.5 });
    // End jacks, from the eave to the girder.
    for (let y = 108; y <= 420; y += 24) {
      d.line(o([ex0, y]), o([g - 2.25, y]));
      d.line(o([W - g + 2.25, y]), o([ex1, y]));
    }
    // Corner jacks, to the hips, in both directions at each corner.
    for (const k of [12, 36, 60, 84]) {
      d.line(o([ex0, k]), o([k, k]));
      d.line(o([ex0, DEPTH - k]), o([k, DEPTH - k]));
      d.line(o([W - k, k]), o([ex1, k]));
      d.line(o([W - k, DEPTH - k]), o([ex1, DEPTH - k]));
      if (k < g) {
        d.line(o([k, ey0]), o([k, k]));
        d.line(o([k, DEPTH - k]), o([k, ey1]));
        d.line(o([W - k, ey0]), o([W - k, k]));
        d.line(o([W - k, DEPTH - k]), o([W - k, ey1]));
      }
    }
    // The lanai's shed: mono trusses from the ledger to the eave, on beam LB-1.
    const [lx0, ly0, lx1, ly1] = ROOF.lanai.rect;
    d.polyline([o([lx0, ly0]), o([lx0, ly1]), o([lx1, ly1]), o([lx1, ly0])]);
    for (let x = LANAI[0] + 4; x < LANAI[2]; x += 24) d.line(o([x, ey1]), o([x, ly1]));
  });
  d.layer(LAYERS.beam, {}, () => {
    d.line(o([LANAI[0], LANAI[3] - 10]), o([LANAI[2], LANAI[3] - 10]));
    d.line(o([LANAI[0], LANAI[3] - 2]), o([LANAI[2], LANAI[3] - 2]));
  });
  d.layer(SL.below, {}, () => {
    for (const x of [LANAI[0], LANAI[2] - 12]) d.rect(o([x, LANAI[3] - 12]), 12, 12);
  });
  // Slopes, labels and connector tags.
  const h = v.p(H.note);
  d.layer(LAYERS.strAnno, {}, () => {
    slopeArrow(d, v, o([312, 60]), -90, "6:12");
    slopeArrow(d, v, o([312, 470]), 90, "6:12");
    slopeArrow(d, v, o([30, 264]), 180, "6:12");
    slopeArrow(d, v, o([594, 264]), 0, "6:12");
    slopeArrow(d, v, o([450, 630]), 90, "3:12");
    leaderNote(d, v, o([g + 2.25, 200]), o([180, 200]), ["HG-1 HIP GIRDER", "TRUSS, 3-PLY"]);
    leaderNote(d, v, o([W - g - 2.25, 330]), o([450, 330]), ["HG-1 HIP GIRDER", "TRUSS, 3-PLY"]);
    leaderNote(d, v, o([156, 380]), o([190, 410]), [
      "H-1 TO H-7 STEP-DOWN",
      'HIP TRUSSES @ 24" O.C.',
    ]);
    leaderNote(d, v, o([300, 300]), o([330, 230]), ["T-1 COMMON", 'TRUSSES @ 24" O.C.']);
    leaderNote(
      d,
      v,
      o([ATTIC_ACCESS[2] - 4, (ATTIC_ACCESS[1] + ATTIC_ACCESS[3]) / 2]),
      o([340, 112]),
      [
        `ATTIC ACCESS ${ftIn(ATTIC_ACCESS[2] - ATTIC_ACCESS[0])} X ${ftIn(ATTIC_ACCESS[3] - ATTIC_ACCESS[1])} IN`,
        `HALL CLG.: TRUSSES ${ATTIC_TRUSSES[1]! - ATTIC_TRUSSES[0]!}" APART,`,
        "(2) 2X6 HDR. EA. END, NOTE 9",
      ],
    );
    leaderNote(d, v, o([30, 300]), o([30, 360]), ["EJ-7 END JACKS", '@ 24" O.C.']);
    leaderNote(d, v, o([36, 20]), o([120, 50]), ["CJ CORNER JACKS", "AND HJ-7 HIP JACK"]);
    leaderNote(d, v, o([430, LANAI[3] - 6]), o([340, 700]), [
      'LB-1 LANAI BEAM ON 12" SQ.',
      "CONC. COLUMNS",
    ]);
    leaderNote(d, v, o([LANAI[0] + 52, 600]), o([300, 640]), [
      "MT-1 MONO TRUSSES",
      '@ 24" O.C., 3:12',
    ]);
    leaderNote(d, v, o([LANAI[0] + 28, 556]), o([300, 590]), [
      '2X10 PT LEDGER, 1/2"',
      'THRU-BOLTS @ 16" O.C.',
    ]);
    put(d, o([284, ROOF.ridgeY + v.p(0.08)]), "RIDGE", h, { align: "center" });
    const tag = (at: Point, c: string) =>
      d.layer(SL.conn, {}, () =>
        d.insert("S-CONN TAG", o(at), { scale: v.p(1), attributes: { CONN: c } }),
      );
    const small = v.p(H.small * 1.2);
    const uplift = (c: string) => `${CONNECTORS.find((r) => r[0] === c)![2]} LB`;
    gx.forEach((x, k) => {
      const side = k === 0 ? 1 : -1;
      for (const y of [22, DEPTH - 22]) {
        tag([x + side * 16, y], "C3");
        put(d, o([x + side * 28, y]), uplift("C3"), small, {
          align: side > 0 ? "left" : "right",
          valign: "middle",
        });
      }
    });
    tag([300, 14], "C1");
    put(d, o([314, 14]), `${uplift("C1")} AT EA. TRUSS END, TYP.`, small, { valign: "middle" });
    tag([-10, 156], "C6");
    put(d, o([-10, 140]), uplift("C6"), small, { align: "center", valign: "middle" });
    put(d, o([-10, 132]), "TYP.", small, { align: "center", valign: "middle" });
    tag([LANAI[0] + 100, LANAI[3] - 22], "C5");
    put(d, o([LANAI[0] + 112, LANAI[3] - 22]), uplift("C5"), small, { valign: "middle" });
    tag([LANAI[0] + 6, LANAI[3] - 26], "C7");
    put(d, o([LANAI[0] + 18, LANAI[3] - 26]), uplift("C7"), small, { valign: "middle" });
  });
  d.layer(LAYERS.strAnno, {}, () => {
    d.line(o([500, 640]), o([500, 700]), { lineweight: 0.5 });
    d.insert("SECTION MARK", o([500, 712]), {
      scale: v.p(1),
      attributes: { SECT: "4", SHEET: "S-501" },
    });
  });
  d.layer(LAYERS.strDims, {}, () => {
    const first = v.p(0.5);
    const gap = v.p(0.3);
    dimString(
      d,
      v,
      [
        o([ex0, ey0]),
        o([0, ey0]),
        o([g, ey0]),
        o(ROOF.ridge[0]),
        o(ROOF.ridge[1]),
        o([W - g, ey0]),
        o([W, ey0]),
        o([ex1, ey0]),
      ].map((p) => [p[0], RF[1] + ey0] as Point),
      "x",
      RF[1] + ey0 - first,
    );
    dimString(d, v, [o([ex0, ey0]), o([ex1, ey0])], "x", RF[1] + ey0 - first - gap);
    dimString(
      d,
      v,
      [o([ex0, ey0]), o([ex0, 0]), o([ex0, DEPTH]), o([ex0, ey1])],
      "y",
      RF[0] + ex0 - first,
    );
  });
}

const HEEL: Point = [240000, 0];

/**
 * 5: the roof truss heel on the second floor wall, with strap C1. The wall's outer face at x 0,
 * the top of the double top plate at y 0.
 */
function heelDetail(d: D, v: View): void {
  const p = (x: number, y: number): Point => [HEEL[0] + x, HEEL[1] + y];
  const pitch = HEIGHTS.pitch / 12;
  const t = 3.5 / Math.cos(Math.atan(pitch));
  const yb = (x: number) => HEIGHTS.heel + pitch * x; // the top chord's underside
  const o = -HEIGHTS.overhang;
  const x1 = 30;
  wood(d, p, 0, -1.5, 5.5, 0);
  wood(d, p, 0, -3, 5.5, -1.5);
  d.layer(LAYERS.sectFine, {}, () => {
    // The stud, the wall sheathing and the ceiling.
    d.polyline([p(0, -26), p(0, -3)]);
    d.polyline([p(5.5, -26), p(5.5, -3)]);
    d.rect(p(-0.4375, -26), 0.4375, 26 + yb(0) - 0.5);
    breakLine(d, p(-2, -26), p(8, -26), v.p(0.1));
    d.rect(p(5.5, -0.5), x1 - 5.5, 0.5);
    // The bottom chord, the heel and the top chord out to the fascia.
    d.rect(p(0, 0), x1, 3.5);
    d.rect(p(0, 3.5), 1.5, yb(0) - 3.5 + 0.6);
    d.polyline([p(o, yb(o)), p(x1, yb(x1))]);
    d.polyline([p(o, yb(o) + t), p(x1, yb(x1) + t)]);
    d.line(p(o, yb(o)), p(o, yb(o) + t));
    d.line(p(1.5, 3.5), p(20, yb(20)));
    d.line(p(3.5, 3.5), p(22, yb(22)));
    breakLine(d, p(x1, -2), p(x1, yb(x1) + t + 3), v.p(0.1));
    d.polyline([p(o - 1.5, yb(o - 1.5) + t + 0.6), p(x1, yb(x1) + t + 0.6)]);
    d.rect(p(o - 1.5, yb(o) - 1.5), 1.5, 5.5);
    d.line(p(o, yb(o) - 1), p(-0.4375, yb(o) - 1));
  });
  // The strap, from the truss down the stud on the inside face.
  d.layer(SL.rebar, {}, () => d.polyline([p(5.8, -20), p(5.8, 0), p(5.8, 3.5), p(5.8, 10)]));
  dim(d, v, p(o, yb(o) - 6), p(0, yb(o) - 6), p(0, yb(o) - 10), "x");
  dim(d, v, p(0, 0), p(0, yb(0)), p(-6, 0), "y");
  d.layer(LAYERS.strAnno, {}, () => {
    d.insert("LEVEL", p(38, 0), {
      scale: v.p(1),
      attributes: { NAME: "T.O. PLATE", EL: `${ftIn(HEIGHTS.l2Top)} A.F.F.` },
    });
    leaderNote(d, v, p(5.8, -12), p(38, -16), [
      "C1 TRUSS STRAP AT EA. TRUSS END,",
      `RATED ${CONNECTORS[0]![2]} LB UPLIFT MIN., ALIGNED`,
      "OVER A STUD",
    ]);
    leaderNote(d, v, p(26, yb(26) + 1), p(38, 26), ['ROOF TRUSS AT 24" O.C., SEE PLAN']);
    leaderNote(d, v, p(3, -1.5), p(38, 10), ['DBL. 2X6 TOP PLATE, LAP 48" MIN.']);
    leaderNote(d, v, p(-0.2, -16), p(-12, -20), ['7/16" OSB, NAILED', "TO TOP PLATE"]);
    leaderNote(d, v, p(-12, yb(o) - 1), p(-20, -12), ["VENTED SOFFIT", "PER ARCH."]);
  });
}

const OPEN6: Point = [242000, 0];

/**
 * 6: a typical CMU wall at an opening, in elevation: the bars at each jamb and at 48" o.c., the
 * lintel's bearing and the tie beam. The first floor at y 0, the wall's west end at x 0.
 */
function openingElevation(d: D, v: View): void {
  const p = (x: number, y: number): Point => [OPEN6[0] + x, OPEN6[1] + y];
  const L = 168;
  const grade = -FFE_ABOVE_GRADE;
  const tb = HEIGHTS.l1Plate;
  const op = { x0: 60, x1: 132, sill: 36, head: 96 };
  d.layer(LAYERS.elev, {}, () => {
    d.polyline([p(0, grade), p(0, tb), p(L, tb), p(L, grade)]);
    d.rect(p(op.x0, op.sill), op.x1 - op.x0, op.head - op.sill);
    d.line(p(0, tb - 16), p(L, tb - 16));
    d.rect(p(op.x0 - 8, op.head), op.x1 - op.x0 + 16, 8);
  });
  // The coursing: bed joints at 8", head joints at 16" in running bond, kept out of the opening,
  // the lintel and the tie beam.
  d.layer(LAYERS.patt, {}, () => {
    for (let y = grade + 6, k = 0; y < tb - 16 - 0.1; y += 8, k++) {
      const inOpening = y > op.sill - 0.1 && y < op.head + 8 + 0.1;
      if (y > grade + 6.1) {
        if (inOpening) {
          d.line(p(0, y), p(op.x0 - (y > op.head ? 8 : 0), y));
          d.line(p(op.x1 + (y > op.head ? 8 : 0), y), p(L, y));
        } else d.line(p(0, y), p(L, y));
      }
      for (let x = k % 2 === 0 ? 16 : 8; x < L; x += 16) {
        const yTop = Math.min(y + 8, tb - 16);
        const blocked =
          (x > op.x0 - 8 && x < op.x1 + 8 && y + 8 > op.head - 0.1 && y < op.head + 8) ||
          (x > op.x0 && x < op.x1 && y + 8 > op.sill && y < op.head);
        if (!blocked && y >= grade + 6) d.line(p(x, y), p(x, yTop));
      }
    }
  });
  // Below grade, hidden: the stem and the footing.
  d.layer(LAYERS.ftng, {}, () => {
    d.rect(p(-6, grade - 18), L + 12, 12);
    d.line(p(0, grade), p(0, grade - 6));
    d.line(p(L, grade), p(L, grade - 6));
  });
  d.layer(LAYERS.grade, {}, () => d.line(p(-24, grade), p(L + 24, grade)));
  d.layer(LAYERS.sectFine, {}, () => d.line(p(-24, 0), p(L + 24, 0), { linetype: "DASHED" }));
  // The bars.
  const bars = [4, op.x0 - 4, op.x1 + 4, L - 4];
  d.layer(SL.rebar, {}, () => {
    for (const x of bars)
      d.polyline([p(x + 8, grade - 14), p(x, grade - 14), p(x, tb - 3), p(x + 6, tb - 3)]);
    d.line(p(-3, grade - 15), p(L + 3, grade - 15));
    d.line(p(2, tb - 4), p(L - 2, tb - 4));
    d.line(p(op.x0 - 6, op.head + 2), p(op.x1 + 6, op.head + 2));
  });
  dimString(
    d,
    v,
    [p(op.x0 - 8, tb), p(op.x0, tb), p(op.x1, tb), p(op.x1 + 8, tb)],
    "x",
    OPEN6[1] + tb + v.p(0.45),
  );
  dimString(
    d,
    v,
    [
      p(0, grade),
      p(bars[0]!, grade),
      p(bars[1]!, grade),
      p(bars[2]!, grade),
      p(bars[3]!, grade),
      p(L, grade),
    ],
    "x",
    OPEN6[1] + grade - v.p(0.75),
  );
  d.layer(LAYERS.strAnno, {}, () => {
    leaderNote(d, v, p(op.x0 - 4, 70), p(-30, 80), [
      "#5 VERT. IN GROUTED",
      "CELL EA. SIDE OF",
      "OPENING, FULL HT.",
    ]);
    leaderNote(d, v, p(4, 20), p(-30, 20), ["#5 VERT. AT CORNERS", 'AND 48" O.C. MAX.']);
    leaderNote(d, v, p(bars[2]! + 6, tb - 3), p(L + 30, tb + 8), [
      "STD. HOOK INTO TB-1,",
      "(2) #5 CONT.",
    ]);
    leaderNote(d, v, p(op.x1 + 4, op.head + 4), p(L + 30, op.head - 10), [
      'PRECAST LINTEL, 8" MIN.',
      "BEARING EA. END, SEE",
      "LINTEL SCHEDULE",
    ]);
    leaderNote(d, v, p(op.x1, 66), p(L + 30, 50), ["OPENING PER A-601"]);
    leaderNote(d, v, p(L - 4 + 8, grade - 14), p(L + 30, grade - 30), [
      'STD. HOOK IN FTG., 20" X 12"',
      "FTG. W/ (3) #5 CONT.",
    ]);
    leaderNote(d, v, p(L + 10, grade), p(L + 30, grade + 14), [
      `FINISHED GRADE ${CRITERIA.flood.finishGrade.toFixed(2)}' NAVD`,
    ]);
    leaderNote(d, v, p(L + 10, 0), p(L + 30, 22), ["FIRST FLOOR"]);
  });
}

const CONNECTORS: string[][] = [
  ["C1", "ROOF TRUSS TO 2ND FLR. DOUBLE TOP PLATE, EA. END", "1,250", "TRUSS STRAP"],
  ["C2", '2ND FLR. STUD TO TIE BEAM, AT 32" O.C., SEE 3/S-501', "1,450", "EMBEDDED STRAP"],
  ["C3", "HIP GIRDER HG-1 TO STUD PACK, EA. END", "4,850", "GIRDER TIE-DOWN"],
  ["C4", "FLOOR TRUSS TO TIE BEAM, SEE 3/S-501", "500", "EMBEDDED ANCHOR"],
  ["C5", "LANAI MONO TRUSS TO LB-1, SEE 4/S-501", "650", "EMBEDDED ANCHOR"],
  ["C6", "END AND CORNER JACK TO TOP PLATE", "450", "TRUSS STRAP"],
  ["C7", "LANAI COLUMN TO LB-1 AND PAD", "3,200", "CAST-IN DOWELS"],
  ["C8", "FB-1 TO TIE BEAM POCKET, EA. END", "2,100", "BEAM STRAP"],
];

const LINTELS: string[][] = (() => {
  const by = new Map<string, Set<string>>();
  for (const op of MASONRY_OPENINGS) {
    const m = lintelMark(op);
    if (!by.has(m)) by.set(m, new Set());
    if (op.tag) by.get(m)!.add(op.tag);
  }
  const spec: Record<string, [string, string, string]> = {
    "L-1": ["TO 4'-0\"", "PRECAST 8F8-1B", "TB-1 ABOVE"],
    "L-2": ["TO 6'-8\"", "PRECAST 8F16-1B/1T", "TB-1 ABOVE"],
    "L-3": ["TO 12'-0\"", "PRECAST 8F24-2B/1T", "TB-1 ABOVE"],
    "L-4": ["16'-0\"", "TB-2, CAST IN PLACE", "SEE BEAMS"],
  };
  return [...by.keys()]
    .sort()
    .map((m) => [m, spec[m]![0], spec[m]![1], [...by.get(m)!].sort().join(", ")]);
})();

const BEAMS: string[][] = [
  ["TB-1", '8"X16" CONC. TIE BEAM, ALL CMU WALLS', "(2) #5 CONT."],
  ["TB-2", '8"X24" CONC. BEAM OVER O.H. DOOR', '(3) #5 B, (2) #5 T, #3 @ 8"'],
  ["TB-3", '8"X24" CONC. BEAM OVER PORCH', '(2) #5 B, (2) #5 T, #3 @ 8"'],
  ["LB-1", '8"X20" CONC. LANAI BEAM', '(2) #5 B, (2) #5 T, #3 @ 8"'],
  ["FB-1", '(3) 1 3/4"X16" LVL FLUSH BEAM', "HANGERS EA. SIDE"],
  ["FG-1", "FLOOR GIRDER TRUSS AT STAIR", "BY TRUSS MFR."],
  ["H-1", "(2) 2X12 SYP NO. 2 HEADER", "(2) JACK STUDS EA. END"],
  ["H-2", "(3) 2X12 SYP NO. 2 HEADER", "(2) JACK STUDS EA. END"],
];

const FRAMING_NOTES = [
  'FLOOR TRUSSES FT-1: 16" DEEP OPEN WEB AT 24" O.C., FOR 40 PSF LIVE (30 PSF SLEEPING) AND 12 PSF DEAD, L/480 LIVE LOAD DEFLECTION. 2X6 STRONGBACKS AT 10\'-0" O.C. MAX.',
  `ROOF TRUSSES: AT 24" O.C., ${HEIGHTS.pitch}:12, ${ftIn(HEIGHTS.overhang)} OVERHANG, DESIGNED FOR THE WIND CRITERIA AND ROOF PRESSURES ON S-501, ${CRITERIA.live.roof} PSF LIVE, ${CRITERIA.dead.roof} PSF DEAD (${ROOF_TCDL} PSF TOP CHORD, ${CRITERIA.dead.roof - ROOF_TCDL} PSF BOTTOM CHORD).`,
  "THE TRUSS MANUFACTURER SUPPLIES EVERY TRUSS-TO-GIRDER HANGER AND SHOWS IT ON THE TRUSS LAYOUT.",
  `UPLIFTS ARE NET ALLOWABLE (0.6W - 0.6D) AT EACH CONNECTION. A CONNECTOR'S RATED ALLOWABLE UPLIFT, WITH ALL ITS FASTENERS, MUST MEET OR EXCEED THE SCHEDULE: C1 AT EVERY ROOF TRUSS END IS RATED ${CONNECTORS[0]![2]} LB OR MORE.`,
  "LOAD PATH: TRUSS (C1) TO TOP PLATE, STUDS, STRAP (C2) TO TIE BEAM, #5 VERTICALS TO THE FOOTING. NO LINK MAY BE LEFT OUT.",
  '2ND FLR. EXTERIOR WALLS: 2X6 AT 16" O.C., DOUBLE TOP PLATE, 7/16" OSB. STUD PACKS UNDER EVERY GIRDER BEARING, WITH SOLID BLOCKING THROUGH THE FLOOR TO THE TIE BEAM.',
  "WALLS BELOW ARE SHOWN DASHED. LINTELS ARE TAGGED AT EACH OPENING; SEE THE LINTEL SCHEDULE.",
  'GARAGE CEILING: 5/8" TYPE X GYPSUM BOARD ON THE FLOOR TRUSSES OVER THE GARAGE, BELOW THE HABITABLE ROOMS (FBC-R TABLE R302.6), AND 1/2" GYPSUM BOARD ON THE GARAGE WALLS.',
  `ATTIC ACCESS: ${ftIn(ATTIC_ACCESS[2] - ATTIC_ACCESS[0])} X ${ftIn(ATTIC_ACCESS[3] - ATTIC_ACCESS[1])} PULL-DOWN STAIR IN THE 2ND FLR. HALL CEILING (A-102). THE TRUSS MFR. SETS THE TRUSSES EACH SIDE ${ATTIC_TRUSSES[1]! - ATTIC_TRUSSES[0]!}" APART AND DESIGNS FOR IT; (2) 2X6 HEADERS EACH END ON HANGERS. NO TRUSS CHORD IS CUT.`,
];

export function framingSheet(d: D): void {
  structureSetup(d);
  const v = view(d, 64);
  floorFraming(d, v);
  roofFraming(d, v);
  const v12 = view(d, 12);
  heelDetail(d, v12);
  const v48 = view(d, 48);
  openingElevation(d, v48);
  frame(d, "S-102", (dd, sheet) => {
    const w = 12.6;
    const hgt = 13.6;
    const top = AREA.top;
    viewport(dd, sheet, {
      corner: [AREA.left, top - hgt],
      size: [w, hgt],
      center: [FLR[0] + 300, FLR[1] + 270],
      v,
      id: "vp-S-102-1",
      number: "1",
      sheetNo: "S-102",
      title: "SECOND FLOOR FRAMING PLAN",
      titleAt: [AREA.left + 0.2, top - hgt - 0.4],
    });
    viewport(dd, sheet, {
      corner: [AREA.left + w + 0.1, top - hgt],
      size: [w, hgt],
      center: [RF[0] + 312, RF[1] + 320],
      v,
      id: "vp-S-102-2",
      number: "2",
      sheetNo: "S-102",
      title: "ROOF FRAMING PLAN",
      titleAt: [AREA.left + w + 0.3, top - hgt - 0.4],
    });
    dd.layer(LAYERS.text, {}, () =>
      dd.insert("NORTH ARROW", [AREA.left + 2 * w - 0.6, top - hgt - 0.5]),
    );
    const x = AREA.left + 2 * w + 0.4;
    let y = top - 0.1;
    y = noteColumn(dd, [x, y], AREA.right - x, "FRAMING NOTES", FRAMING_NOTES);
    y -= 0.3;
    legend(dd, [x, y], AREA.right - x);
    // The schedules along the bottom.
    const ty = top - hgt - 1.1;
    table(
      dd,
      [AREA.left, ty],
      "UPLIFT CONNECTOR SCHEDULE",
      [
        { name: "MARK", width: 0.55, align: "center" },
        { name: "LOCATION", width: 4.2 },
        { name: "MIN. UPLIFT (LB)", width: 1.25, align: "center" },
        { name: "TYPE", width: 1.5 },
      ],
      CONNECTORS,
    );
    table(
      dd,
      [AREA.left + 7.9, ty],
      "LINTEL SCHEDULE",
      [
        { name: "MARK", width: 0.55, align: "center" },
        { name: "OPENING", width: 0.95 },
        { name: "LINTEL", width: 1.9 },
        { name: "AT OPENINGS", width: 2.0 },
      ],
      LINTELS,
    );
    table(
      dd,
      [AREA.left + 13.7, ty],
      "BEAM AND HEADER SCHEDULE",
      [
        { name: "MARK", width: 0.65, align: "center" },
        { name: "MEMBER", width: 3.1 },
        { name: "REINF. / NOTES", width: 2.35 },
      ],
      BEAMS,
    );
    const dw = 11.0;
    const dh = 4.9;
    const dc: Point = [AREA.left, AREA.bottom + 0.65];
    viewport(dd, sheet, {
      corner: dc,
      size: [dw, dh],
      center: [HEEL[0] + 17, HEEL[1] + 1.5],
      v: v12,
      id: "vp-S-102-5",
      number: "5",
      sheetNo: "S-102",
      title: "TRUSS HEEL AT 2ND FLR. WALL",
      titleAt: [dc[0] + 0.2, dc[1] - 0.4],
    });
    const ec: Point = [AREA.left + 20.3, AREA.bottom + 0.65];
    viewport(dd, sheet, {
      corner: ec,
      size: [9.4, 6.0],
      center: [OPEN6[0] + 95, OPEN6[1] + 32],
      v: v48,
      id: "vp-S-102-6",
      number: "6",
      sheetNo: "S-102",
      title: "TYPICAL CMU OPENING REINFORCING",
      titleAt: [ec[0] + 0.2, ec[1] - 0.4],
    });
  });
}

function legend(d: D, at: Point, w: number): number {
  let y = at[1];
  d.layer(LAYERS.text, {}, () => {
    put(d, [at[0], y], "LEGEND", H.label, { valign: "top" });
    y -= H.label + 0.06;
    d.line([at[0], y], [at[0] + w, y], { lineweight: 0.35 });
    y -= 0.3;
  });
  const row = (label: string, draw: (c: Point) => void) => {
    draw([at[0] + 0.3, y + 0.03]);
    d.layer(LAYERS.text, {}, () => put(d, [at[0] + 0.7, y], label, H.note, { valign: "middle" }));
    y -= 0.36;
  };
  row("TRUSS OR JOIST", (c) =>
    d.layer(LAYERS.fram, {}, () => d.line([c[0] - 0.25, c[1]], [c[0] + 0.25, c[1]])),
  );
  row("GIRDER TRUSS", (c) =>
    d.layer(LAYERS.fram, {}, () => {
      d.line([c[0] - 0.25, c[1] - 0.025], [c[0] + 0.25, c[1] - 0.025], { lineweight: 0.5 });
      d.line([c[0] - 0.25, c[1] + 0.025], [c[0] + 0.25, c[1] + 0.025], { lineweight: 0.5 });
    }),
  );
  row("BEAM, LINTEL OR HEADER", (c) =>
    d.layer(LAYERS.beam, {}, () => d.line([c[0] - 0.25, c[1]], [c[0] + 0.25, c[1]])),
  );
  row("WALL BELOW", (c) =>
    d.layer(SL.below, {}, () => d.line([c[0] - 0.25, c[1]], [c[0] + 0.25, c[1]])),
  );
  row("UPLIFT CONNECTOR, SEE SCHEDULE", (c) =>
    d.layer(LAYERS.strAnno, {}, () => d.insert("S-CONN TAG", c, { attributes: { CONN: "C1" } })),
  );
  row("SECTION, DETAIL / SHEET", (c) =>
    d.layer(LAYERS.strAnno, {}, () =>
      d.insert("SECTION MARK", [c[0] - 0.08, c[1]], {
        scale: 0.7,
        attributes: { SECT: "3", SHEET: "S-501" },
      }),
    ),
  );
  return y;
}
