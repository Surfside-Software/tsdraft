// S-501: four structural details, each in its own viewport at its own scale, with the
// structural general notes and the design criteria table on the paper.
import type { Point } from "../../../src/index.ts";
import { CRITERIA } from "../project.ts";
import { HEIGHTS } from "../model/house.ts";
import { endZone, meanRoofHeight, qh, roofAngle, roofPressures } from "../model/structure-wind.ts";
import { frame } from "../lib/frame.ts";
import { breakLine } from "../../lib/drafting.ts";
import {
  AREA,
  ftIn,
  LAYERS,
  leaderNote,
  noteColumn,
  table,
  view,
  viewport,
  type D,
  type View,
} from "../lib/kit.ts";

/** The first floor above finished grade at the foundation, inches. */
export const FFE_ABOVE_GRADE = (CRITERIA.flood.ffe - CRITERIA.flood.finishGrade) * 12;
import {
  barDot,
  box,
  cmu,
  concrete,
  fill,
  level,
  SL,
  soil,
  structureSetup,
} from "./structure-kit.ts";

const O = {
  d1: [230000, 0] as Point,
  d2: [232000, 0] as Point,
  d3: [234000, 0] as Point,
  d4: [236000, 0] as Point,
};

type Tx = (x: number, y: number) => Point;
const at =
  (o: Point): Tx =>
  (x, y) => [o[0] + x, o[1] + y];
const bx = (o: Point) => (x0: number, y0: number, x1: number, y1: number) =>
  box(o[0] + x0, o[1] + y0, o[0] + x1, o[1] + y1);

/** A piece of lumber cut in section: its outline and the cross drafters draw in it. */
export function wood(d: D, p: Tx, x0: number, y0: number, x1: number, y1: number): void {
  d.layer(LAYERS.sectFine, {}, () => {
    d.polyline([p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)], true);
    d.line(p(x0, y0), p(x1, y1));
    d.line(p(x0, y1), p(x1, y0));
  });
}

/** A linear dimension in a detail, with its feet-and-inches text. */
export function dim(
  d: D,
  v: View,
  a: Point,
  b: Point,
  line: Point,
  along: "x" | "y",
  suffix = "",
): void {
  const len = along === "x" ? Math.abs(b[0] - a[0]) : Math.abs(b[1] - a[1]);
  d.layer(LAYERS.strDims, {}, () => {
    d.linearDimension(a, b, line, {
      style: v.dim,
      ...(along === "y" ? { along: "y" as const } : {}),
      text: ftIn(len) + suffix,
    });
  });
}

// ---------------------------------------------------------------------------------------------
// 1: the typical stem wall and footing. Finished grade at y 0, the wall's outer face at x 0.

function stemWallDetail(d: D): void {
  const v = view(d, 16);
  const p = at(O.d1);
  const b = bx(O.d1);
  const ff = FFE_ABOVE_GRADE;
  soil(d, b(-30, -30, 56, 0), [b(-6, -18, 14, -6), b(0, -6, 8, 0), b(8, -6, 56, 0)], v);
  fill(d, b(8, -6, 56, ff - 4), [], v, 11);
  concrete(d, b(-6, -18, 14, -6), 3, v);
  concrete(d, b(8, ff - 4, 56, ff), 5, v);
  cmu(d, b(0, -6, 8, ff + 24), v);
  d.layer(LAYERS.sectFine, {}, () => {
    breakLine(d, p(-3, ff + 24), p(11, ff + 24), v.p(0.1));
    breakLine(d, p(56, ff - 10), p(56, ff + 6), v.p(0.1));
    // The vapor retarder under the slab, the welded wire in it, and the stucco.
    d.line(p(8, ff - 4.15), p(56, ff - 4.15));
    d.line(p(9, ff - 2), p(55, ff - 2), { linetype: "HIDDEN" });
    d.line(p(-0.75, 1), p(-0.75, ff + 24));
  });
  d.layer(LAYERS.grade, {}, () => d.line(p(-30, 0), p(0, 0)));
  for (const x of [-2.69, 4, 10.69]) barDot(d, p(x, -14.69));
  d.layer(SL.rebar, {}, () => d.polyline([p(4, ff + 22), p(4, -13.2), p(11, -13.2)]));
  level(d, v, p(62, ff), "F.F.E.", `EL. ${CRITERIA.flood.ffe.toFixed(2)}' NAVD`);
  dim(d, v, p(-6, -18), p(14, -18), p(0, -24), "x");
  dim(d, v, p(-6, -18), p(-6, -6), p(-12, 0), "y");
  dim(d, v, p(0, -18), p(0, 0), p(-20, 0), "y", " MIN.");
  dim(d, v, p(0, 0), p(0, ff), p(-20, 0), "y");
  d.layer(LAYERS.strAnno, {}, () => {
    leaderNote(d, v, p(30, ff - 1), p(66, ff + 18), [
      '4" CONC. SLAB, 3000 PSI, W/',
      "6X6-W1.4XW1.4 W.W.F.",
    ]);
    leaderNote(d, v, p(46, ff - 4.15), p(66, ff - 12), [
      "10 MIL VAPOR RETARDER,",
      'LAP 6" AND TAPE',
    ]);
    leaderNote(d, v, p(36, 16), p(66, 14), [
      "CLEAN SAND FILL, COMPACTED",
      'TO 95% MOD. PROCTOR IN 12"',
      "LIFTS, TERMITE TREATED",
    ]);
    leaderNote(d, v, p(7, ff + 14), p(30, ff + 34), [
      '8" CMU, CELLS AT BARS GROUTED',
      "SOLID; LADDER JOINT REINF. AT",
      '16" O.C.',
    ]);
    leaderNote(d, v, p(4, 4), p(66, -2), [
      '#5 VERT. AT 48" O.C. AND EA.',
      "SIDE OF OPENINGS, STD. HOOK",
      'IN FTG., LAP 30" MIN.',
    ]);
    leaderNote(d, v, p(12, -10), p(66, -16), [
      '20" X 12" CONT. CONC. FTG.',
      'W/ (3) #5 CONT., 3" CLR.',
    ]);
    leaderNote(d, v, p(24, -26), p(66, -28), [
      "UNDISTURBED SOIL OR COMPACTED",
      `FILL, ${CRITERIA.soil} PSF ALLOWABLE`,
    ]);
    leaderNote(d, v, p(-14, 0), p(-28, 12), [
      "FINISHED GRADE EL.",
      `${CRITERIA.flood.finishGrade.toFixed(2)}' NAVD`,
    ]);
    leaderNote(d, v, p(-0.75, ff + 10), p(-14, ff + 18), ["STUCCO PER ARCH."]);
  });
}

// ---------------------------------------------------------------------------------------------
// 2: the slab step at the garage wall. The house is on the left, the garage on the right.

function garageStepDetail(d: D): void {
  const v = view(d, 16);
  const p = at(O.d2);
  const b = bx(O.d2);
  const house = HEIGHTS.garageDrop; // the house slab above the garage slab
  const g = (CRITERIA.flood.garage - CRITERIA.flood.finishGrade) * 12; // the garage slab's top above finished grade
  const top = g + house;
  soil(d, b(-40, -30, 48, -6), [b(-6, -18, 14, -6)], v);
  fill(d, b(-40, -6, 0, top - 4), [], v, 17);
  fill(d, b(8.5, -6, 48, g - 4), [], v, 19);
  concrete(d, b(-6, -18, 14, -6), 7, v);
  concrete(d, b(-40, top - 4, 0, top), 9, v);
  concrete(d, b(8.5, g - 4, 48, g), 13, v);
  cmu(d, b(0, -6, 8, top + 24), v);
  d.layer(LAYERS.sectFine, {}, () => {
    breakLine(d, p(-3, top + 24), p(11, top + 24), v.p(0.1));
    breakLine(d, p(-40, top - 10), p(-40, top + 6), v.p(0.1));
    breakLine(d, p(48, g - 10), p(48, g + 6), v.p(0.1));
    d.line(p(-40, top - 4.15), p(0, top - 4.15));
    d.line(p(8.5, g - 4.15), p(48, g - 4.15));
    // The expansion joint and the gypsum board on the garage face.
    d.rect(p(8, g - 4), 0.5, 4);
    d.line(p(8.6, g + 1), p(8.6, top + 24));
  });
  for (const x of [-2.69, 4, 10.69]) barDot(d, p(x, -14.69));
  d.layer(SL.rebar, {}, () => d.polyline([p(4, top + 22), p(4, -13.2), p(11, -13.2)]));
  dim(d, v, p(-6, -18), p(14, -18), p(0, -24), "x");
  dim(d, v, p(8, g), p(8, top), p(24, 0), "y");
  d.layer(LAYERS.strAnno, {}, () => {
    leaderNote(d, v, p(4, top + 12), p(26, top + 34), [
      '8" CMU WALL, GARAGE TO HOUSE, 1/2" GWB',
      'ON GARAGE WALLS; 5/8" TYPE X GWB ON',
      "GARAGE CEILING (FBC-R TABLE R302.6)",
    ]);
    leaderNote(d, v, p(4, 26), p(52, 44), [
      `STEM WALL RETAINS ${ftIn(HEIGHTS.garageDrop)} OF`,
      'FILL: #5 VERT. AT 32" O.C.,',
      "CELLS GROUTED SOLID",
    ]);
    leaderNote(d, v, p(8.25, g - 2), p(52, 24), ['1/2" EXPANSION JOINT']);
    leaderNote(d, v, p(30, g - 1), p(52, 4), [
      '4" CONC. GARAGE SLAB W/',
      "W.W.F. ON 10 MIL V.R., T.O.",
      `SLAB EL. ${CRITERIA.flood.garage.toFixed(2)}' NAVD`,
    ]);
    leaderNote(d, v, p(12, -10), p(52, -16), ['20" X 12" CONT. FTG.', "W/ (3) #5 CONT."]);
    leaderNote(d, v, p(-24, top - 1), p(-44, top + 16), [
      '4" CONC. SLAB W/ W.W.F.',
      "ON 10 MIL V.R., T.O. SLAB",
      `EL. ${CRITERIA.flood.ffe.toFixed(2)}' NAVD (F.F.E.)`,
    ]);
    leaderNote(d, v, p(-24, 10), p(-44, 6), ["COMPACTED FILL, 95%", "MOD. PROCTOR"]);
  });
}

// ---------------------------------------------------------------------------------------------
// 3: the tie beam and lintel over an opening, with the floor truss bearing and its straps.
// The wall's outer face at x 0, the window head (the lintel's bottom) at y 0.

function tieBeamDetail(d: D): void {
  const v = view(d, 12);
  const p = at(O.d3);
  const b = bx(O.d3);
  const tb = 24; // top of the tie beam
  const bc = tb + 1.5; // top of the sill plate, the truss's bearing
  const tc = bc + 16; // top of the floor truss
  const fl = tc + 0.75; // top of the sheathing
  // The window head below the lintel.
  d.layer(LAYERS.sectFine, {}, () => {
    d.rect(p(1.5, -3), 5, 3);
    d.line(p(3.5, -3), p(3.5, -14));
    d.line(p(4.5, -3), p(4.5, -14));
    breakLine(d, p(0, -14), p(8, -14), v.p(0.1));
  });
  concrete(d, b(0, 0, 8, 8), 21, v);
  concrete(d, b(0, 8, 8, tb), 23, v);
  barDot(d, p(4, 2.3));
  barDot(d, p(2.3, tb - 3));
  barDot(d, p(5.7, tb - 3));
  // The sill plate and its anchor bolt.
  wood(d, p, 0.5, tb, 7.75, bc);
  d.layer(LAYERS.sectFine, {}, () => d.polyline([p(4, bc + 0.6), p(4, tb - 7), p(5.5, tb - 7)]));
  // The rim board, the floor truss and the sheathing.
  wood(d, p, 0.5, bc, 1.625, tc);
  d.layer(LAYERS.sectFine, {}, () => {
    const x0 = 1.625;
    const xEnd = 40;
    d.polyline([p(xEnd, bc), p(x0, bc), p(x0, tc), p(xEnd, tc)]);
    d.line(p(x0, bc + 1.5), p(xEnd, bc + 1.5));
    d.line(p(x0, tc - 1.5), p(xEnd, tc - 1.5));
    d.line(p(x0 + 1.5, bc + 1.5), p(x0 + 1.5, tc - 1.5));
    // Webs: a zigzag of 2x4s, each drawn as its two edges.
    const webs: [number, number, number, number][] = [
      [3.1, bc + 1.5, 14, tc - 1.5],
      [14, tc - 1.5, 26, bc + 1.5],
      [26, bc + 1.5, 38, tc - 1.5],
    ];
    for (const [x1, y1, x2, y2] of webs) {
      d.line(p(x1, y1), p(x2, y2));
      d.line(p(x1 + 2, y1), p(x2 + 2, y2));
    }
    breakLine(d, p(xEnd, bc - 2), p(xEnd, fl + 2), v.p(0.1));
    d.rect(p(0.5, tc), xEnd - 0.5, 0.75);
    // The ceiling under the truss.
    d.rect(p(8, bc - 0.5), xEnd - 8, 0.5);
  });
  // The second floor wall: plate, stud and sheathing.
  wood(d, p, 0.4375, fl, 6, fl + 1.5);
  d.layer(LAYERS.sectFine, {}, () => {
    d.polyline([p(0.4375, fl + 22), p(0.4375, fl + 1.5), p(6, fl + 1.5), p(6, fl + 22)]);
    d.rect(p(0, bc), 0.4375, fl + 22 - bc);
    breakLine(d, p(-2, fl + 22), p(8, fl + 22), v.p(0.1));
  });
  // The straps: the stud-to-tie-beam strap on the outside, the truss anchor on the inside.
  d.layer(SL.rebar, {}, () => {
    d.polyline([p(2, tb - 8), p(-0.3, tb - 6), p(-0.3, fl + 16)]);
    d.polyline([p(7.2, tb - 6), p(7.2, tb), p(7.9, bc), p(7.9, bc + 9)]);
  });
  level(d, v, p(44, tb), "T.O. TIE BEAM", `${ftIn(HEIGHTS.l1Plate)} A.F.F.`);
  level(d, v, p(44, fl), "SECOND FLOOR", `${ftIn(HEIGHTS.l2)} A.F.F.`);
  dim(d, v, p(0, 0), p(0, 8), p(-5, 0), "y");
  dim(d, v, p(0, 8), p(0, tb), p(-5, 0), "y");
  d.layer(LAYERS.strAnno, {}, () => {
    leaderNote(d, v, p(0.2, fl + 12), p(-12, fl + 18), ['7/16" OSB SHEATHING']);
    leaderNote(d, v, p(-0.3, bc + 6), p(-12, bc + 12), [
      "EMBEDDED STRAP 'C2' AT 32\" O.C.,",
      "2ND FLR. STUD TO TIE BEAM,",
      "SEE SCHEDULE ON S-102",
    ]);
    leaderNote(d, v, p(2.3, tb - 3), p(-12, 16), [
      "8\" X 16\" CONC. TIE BEAM 'TB-1',",
      '(2) #5 CONT., LAP 30" MIN.',
    ]);
    leaderNote(d, v, p(4, 2.3), p(-12, 4), [
      "PRECAST LINTEL, (1) #5 BOT.,",
      "SEE LINTEL SCHEDULE S-102",
    ]);
    leaderNote(d, v, p(1.5, -8), p(-12, -8), [
      "IMPACT WINDOW PER A-601,",
      "ANCHORS PER PRODUCT APPROVAL",
    ]);
    leaderNote(d, v, p(24, tc + 0.4), p(44, fl + 14), ['3/4" T&G SHEATHING,', "GLUED AND NAILED"]);
    leaderNote(d, v, p(26, bc + 8), p(44, bc + 6), [
      "16\" FLOOR TRUSS 'FT-1' AT",
      '24" O.C., SEE S-102',
    ]);
    leaderNote(d, v, p(7.9, bc + 5), p(44, 14), [
      "EMBEDDED TRUSS ANCHOR 'C4'",
      "AT EA. FLOOR TRUSS",
    ]);
    leaderNote(d, v, p(5, tb + 0.75), p(44, 6), [
      'PT 2X8 SILL, 1/2" J-BOLTS',
      'AT 48" O.C., 7" EMBED.',
    ]);
  });
}

// ---------------------------------------------------------------------------------------------
// 4: a roof truss on a concrete tie beam (the lanai beam), with its uplift anchor. The wall's
// outer face at x 0, the top of the tie beam at y 12.

function trussAnchorDetail(d: D): void {
  const v = view(d, 12);
  const p = at(O.d4);
  const b = bx(O.d4);
  const pitch = 3 / 12;
  // LB-1, 8" x 20", cut between its columns, so open below.
  concrete(d, b(0, -8, 8, 12), 31, v);
  for (const y of [9, -5]) for (const x of [2.3, 5.7]) barDot(d, p(x, y));
  d.layer(LAYERS.sectFine, {}, () => {
    // The stirrup, with 1 1/2" cover.
    d.rect(p(1.5, -6.5), 5, 17);
    // The bottom chord, the heel and the top chord, which runs out over the overhang.
    const x1 = 44;
    d.rect(p(0, 12), x1, 3.5);
    const yb = (x: number) => 12 + 3.5 + 3 + pitch * x; // the top chord's underside
    const t = 3.5 / Math.cos(Math.atan(pitch));
    d.polyline([p(-18, yb(-18)), p(x1, yb(x1))]);
    d.polyline([p(-18, yb(-18) + t), p(x1, yb(x1) + t)]);
    d.line(p(-18, yb(-18)), p(-18, yb(-18) + t));
    d.rect(p(0, 15.5), 1.5, yb(0) - 15.5 + 0.4);
    d.line(p(1.5, 15.5), p(24, yb(24)));
    d.line(p(3.5, 15.5), p(26, yb(26)));
    breakLine(d, p(x1, 10), p(x1, yb(x1) + t + 3), v.p(0.1));
    // Sheathing and roofing, the fascia and the soffit.
    d.polyline([p(-19.5, yb(-19.5) + t + 0.6), p(x1, yb(x1) + t + 0.6)]);
    d.polyline([p(-20, yb(-20) + t + 1.1), p(x1, yb(x1) + t + 1.1)]);
    d.rect(p(-19.5, yb(-18) - 1), 1.5, 5.5);
    d.line(p(-18, yb(-18) - 0.5), p(-0.75, yb(-18) - 0.5));
    d.line(p(-0.75, -8), p(-0.75, yb(-18) - 0.5));
    d.line(p(-0.75, -8), p(8, -8));
  });
  d.layer(SL.rebar, {}, () => d.polyline([p(6.2, 8), p(6.2, 12), p(6.2, 15.5), p(6.2, 19)]));
  dim(d, v, p(-18, -12), p(0, -12), p(0, -16), "x");
  dim(d, v, p(8, -8), p(8, 12), p(12, 0), "y");
  level(d, v, p(52, 12), "T.O. LB-1", `${ftIn(HEIGHTS.lanaiPlate)} A.F.F.`);
  d.layer(LAYERS.strAnno, {}, () => {
    leaderNote(d, v, p(30, 26), p(52, 38), [
      "ENGINEERED MONO TRUSS 'MT-1'",
      'AT 24" O.C., SEE S-102',
    ]);
    leaderNote(d, v, p(6.2, 17), p(52, 26), [
      'EMBEDDED TRUSS ANCHOR, 4" MIN.',
      "EMBED., FASTENED PER MFR.,",
      "UPLIFT PER CONNECTOR SCHEDULE",
      "ON S-102 ('C5'; GIRDERS 'C3')",
    ]);
    leaderNote(d, v, p(5.7, 9), p(52, 6), [
      'LB-1: 8" X 20" CONC. LANAI BEAM,',
      "(2) #5 TOP AND (2) #5 BOT.",
    ]);
    leaderNote(d, v, p(6.5, -2), p(52, -6), ['#3 STIRRUPS AT 8" O.C.']);
    leaderNote(d, v, p(4, -8), p(52, -16), [
      "SIM. WHERE A TRUSS BEARS ON A",
      "CMU TIE BEAM (TB-1): SAME ANCHOR",
      "AND EMBEDMENT",
    ]);
    leaderNote(
      d,
      v,
      p(-8, 18.5 + pitch * -8 + 3.5 / Math.cos(Math.atan(pitch)) + 0.6),
      p(-12, 34),
      ['19/32" PLY. SHEATHING,', '8D RING SHANK AT 4"/6"'],
    );
    leaderNote(d, v, p(-10, 18.5 + pitch * -18 - 0.5), p(-22, 4), ["VENTED SOFFIT PER ARCH."]);
  });
}

// ---------------------------------------------------------------------------------------------
// The sheet.

const GENERAL = [
  `DESIGN: ${CRITERIA.code} AND ASCE 7-22. THE STRUCTURE IS STABLE ONLY WHEN COMPLETE; THE CONTRACTOR BRACES IT UNTIL THE ROOF DIAPHRAGM AND ALL CONNECTORS ARE IN PLACE.`,
  "THE CONTRACTOR VERIFIES ALL DIMENSIONS AND CONDITIONS AND REPORTS ANY CONFLICT TO THE ENGINEER BEFORE PROCEEDING. DO NOT SCALE THE DRAWINGS.",
  `FOUNDATIONS: ALLOWABLE SOIL BEARING ${CRITERIA.soil} PSF, ASSUMED. A GEOTECHNICAL ENGINEER VERIFIES IT AND THE COMPACTION OF FILL (95% MODIFIED PROCTOR, ASTM D1557) BEFORE FOOTINGS ARE PLACED.`,
  `CONCRETE: ${CRITERIA.concrete} PSI AT 28 DAYS, ACI 318, 5" SLUMP MAX., NORMAL WEIGHT. COVER: 3" CAST AGAINST EARTH, 1 1/2" FORMED. NO WATER ADDED AT THE SITE.`,
  `REINFORCING: ASTM A615 GRADE ${CRITERIA.rebar}. LAP 48 BAR DIAMETERS (30" FOR #5) UNLESS NOTED. CORNER BARS AT EVERY CORNER AND INTERSECTION OF FOOTINGS AND TIE BEAMS. WWF: ASTM A1064, IN FLAT SHEETS.`,
  `MASONRY: CMU ASTM C90, f'm = ${CRITERIA.cmu} PSI. TYPE S MORTAR, ASTM C270. GROUT ASTM C476, 3000 PSI, 8" TO 11" SLUMP. GROUT EVERY CELL WITH A BAR SOLID; CLEANOUTS WHERE A LIFT IS OVER 5'-4".`,
  'TIE BEAMS: 8" X 16" (TB-1) CONTINUOUS ON EVERY CMU WALL, POURED MONOLITHICALLY WITH THE CELLS BELOW. STEPPED TIE BEAMS LAP 30" AND GET A VERTICAL #5 AT EACH STEP.',
  'LINTELS: PRECAST, WITH FLORIDA PRODUCT APPROVAL, PER THE LINTEL SCHEDULE ON S-102. 8" MIN. BEARING EACH END, ON A GROUTED CELL WITH A #5 VERTICAL.',
  "WOOD: SOUTHERN PINE NO. 2 OR BETTER. LUMBER ON CONCRETE OR MASONRY IS PRESERVATIVE TREATED. NAILING PER FBC-R TABLE R602.3(1) UNLESS NOTED.",
  "TRUSSES: DESIGNED BY A FLORIDA-REGISTERED ENGINEER FOR THE LOADS AND WIND CRITERIA ON THIS SHEET. SUBMIT SEALED TRUSS DRAWINGS AND THE LAYOUT BEFORE FABRICATION. BRACE PER BCSI.",
  "CONNECTORS: GALVANIZED G185 OR STAINLESS, WITH FLORIDA PRODUCT APPROVAL, RATED FOR AT LEAST THE UPLIFT ON S-102. INSTALL EVERY FASTENER THE MANUFACTURER CALLS FOR.",
  'SHEATHING: ROOF 19/32" PLYWOOD, 8D RING-SHANK NAILS AT 4" O.C. EDGES AND 6" FIELD. WALLS 7/16" OSB, 8D AT 4" EDGES AND 8" FIELD. FLOOR 3/4" T&G, GLUED AND NAILED.',
  `FLOOD: MATERIALS BELOW THE DESIGN FLOOD ELEVATION (${CRITERIA.flood.dfe.toFixed(2)}' NAVD) ARE FLOOD-RESISTANT (FEMA TB 2). FLOOD VENTS PER S-101.`,
];

/** The roof dead load's share on the top chord; the rest hangs from the bottom chord. */
export const ROOF_TCDL = 10;

/** The roof components-and-cladding table, ASD, for roofing and sheathing (EWA 10 sq. ft.). */
const sgn = (p: number) => `${p > 0 ? "+" : ""}${p.toFixed(1)}`;
const ROOF_CC_ROWS: string[][] = roofPressures().map((r) => [
  r.zone,
  r.where,
  r.gcpPos === null ? r.gcp.toFixed(1) : `${sgn(r.gcpPos)} / ${r.gcp.toFixed(1)}`,
  r.pos === null ? sgn(r.neg) : `${sgn(r.pos)} / ${sgn(r.neg)}`,
]);

const ROOF_CC_NOTES = [
  `ASCE 7-22 CH. 30 PART 1, HIP ROOF FIG. 30.3-2F, VULT ${CRITERIA.wind.vult} MPH, EXPOSURE ${CRITERIA.wind.exposure}, KD 0.85, GCPI +/-0.18. ASD = 0.6 X STRENGTH, AS ON A-601. NEGATIVE IS UPLIFT (AWAY FROM THE SURFACE).`,
  `ZONE 3 IS WITHIN a = ${endZone().toFixed(1)}' OF AN EAVE; ZONE 2 IS WITHIN a OF THE RIDGE AND HIPS; ZONE 1 IS THE REST. PRESSURES ARE AT AN EFFECTIVE WIND AREA OF 10 SQ. FT., FOR ROOFING, UNDERLAYMENT, SHEATHING AND THEIR FASTENERS.`,
  "OVERHANGS: ROOF GCP PLUS THE WALL'S +1.0 UNDER THE SOFFIT (SECTION 30.7), NO GCPI. ROOFING, SOFFIT AND THEIR PRODUCT APPROVALS (G-001 NOTE 5, A-103 NOTE 1) MEET OR EXCEED THESE VALUES.",
];

const CRITERIA_ROWS: string[][] = [
  ["BUILDING CODE", "2023 FBC-R, 8TH EDITION"],
  ["LOADS", "ASCE 7-22"],
  ["ULTIMATE WIND SPEED, VULT", `${CRITERIA.wind.vult} MPH (3-SEC. GUST)`],
  ["NOMINAL WIND SPEED, VASD", `${CRITERIA.wind.vasd} MPH`],
  ["RISK CATEGORY", CRITERIA.wind.risk],
  ["WIND EXPOSURE", CRITERIA.wind.exposure],
  ["ENCLOSURE", CRITERIA.wind.enclosure],
  ["INTERNAL PRESSURE COEF., GCPI", CRITERIA.wind.gcpi],
  ["MEAN ROOF HEIGHT / QH", `${meanRoofHeight().toFixed(1)}' ABOVE GRADE / ${qh().toFixed(1)} PSF`],
  [
    "ROOF SLOPE / END ZONE a",
    `${HEIGHTS.pitch}:12 (${roofAngle().toFixed(1)} DEG.) HIP / ${endZone().toFixed(1)}'`,
  ],
  ["WIND-BORNE DEBRIS REGION", CRITERIA.wind.debris],
  [
    "FLOOD ZONE / BFE / DFE",
    `${CRITERIA.flood.zone} / ${CRITERIA.flood.bfe.toFixed(1)}' / ${CRITERIA.flood.dfe.toFixed(1)}' ${CRITERIA.flood.datum}`,
  ],
  ["FLOOR LIVE LOAD", `${CRITERIA.live.floor} PSF (SLEEPING ${CRITERIA.live.sleeping} PSF)`],
  ["ROOF LIVE LOAD", `${CRITERIA.live.roof} PSF`],
  ["DEAD LOADS", `ROOF ${CRITERIA.dead.roof} PSF TOTAL, FLOOR ${CRITERIA.dead.floor} PSF`],
  [
    "ROOF DEAD LOAD, TRUSSES",
    `TC ${ROOF_TCDL} PSF + BC ${CRITERIA.dead.roof - ROOF_TCDL} PSF = ${CRITERIA.dead.roof} PSF`,
  ],
  ["SOIL BEARING (ASSUMED)", `${CRITERIA.soil.toLocaleString("en-US")} PSF`],
  ["CONCRETE, f'c", `${CRITERIA.concrete.toLocaleString("en-US")} PSI AT 28 DAYS`],
  ["REINFORCING", `ASTM A615 GRADE ${CRITERIA.rebar}`],
  ["MASONRY, f'm", `${CRITERIA.cmu.toLocaleString("en-US")} PSI`],
  ["OCCUPANCY / CONSTRUCTION", `R-3 / ${CRITERIA.construction}`],
];

export function detailsSheet(d: D): void {
  structureSetup(d);
  stemWallDetail(d);
  garageStepDetail(d);
  tieBeamDetail(d);
  trussAnchorDetail(d);
  const v16 = view(d, 16);
  const v12 = view(d, 12);
  frame(d, "S-501", (dd, sheet) => {
    const w = 11.0;
    const h = 9.9;
    const xs = [AREA.left, AREA.left + w + 0.2];
    const ys = [AREA.top - h, AREA.top - 2 * h - 1.0];
    const views = [
      {
        no: "1",
        title: "TYPICAL STEM WALL FOOTING",
        v: v16,
        c: [O.d1[0] + 28, O.d1[1] + 22] as Point,
      },
      { no: "2", title: "GARAGE SLAB STEP", v: v16, c: [O.d2[0] + 4, O.d2[1] + 20] as Point },
      {
        no: "3",
        title: "TIE BEAM, LINTEL AND FLOOR TRUSS STRAP",
        v: v12,
        c: [O.d3[0] + 12, O.d3[1] + 26] as Point,
      },
      {
        no: "4",
        title: "TRUSS TO TIE BEAM UPLIFT CONNECTION",
        v: v12,
        c: [O.d4[0] + 20, O.d4[1] + 10] as Point,
      },
    ];
    views.forEach((x, k) => {
      const corner: Point = [xs[k % 2]!, ys[Math.floor(k / 2)]!];
      viewport(dd, sheet, {
        corner,
        size: [w, h],
        center: x.c,
        v: x.v,
        id: `vp-S-501-${x.no}`,
        number: x.no,
        sheetNo: "S-501",
        title: x.title,
        titleAt: [corner[0] + 0.2, corner[1] - 0.4],
      });
    });
    const x = AREA.left + 2 * w + 0.6;
    const cw = AREA.right - x;
    let y = AREA.top - 0.1;
    y = table(
      dd,
      [x, y],
      "DESIGN CRITERIA",
      [
        { name: "ITEM", width: 2.9 },
        { name: "VALUE", width: cw - 2.9 },
      ],
      CRITERIA_ROWS,
    );
    y -= 0.35;
    y = noteColumn(dd, [x, y], cw, "STRUCTURAL GENERAL NOTES", GENERAL);
    y -= 0.25;
    y = table(
      dd,
      [x, y],
      "ROOF COMPONENT AND CLADDING PRESSURES (ASD)",
      [
        { name: "ZONE", width: 0.8, align: "center" },
        { name: "LOCATION", width: 2.9 },
        { name: "GCP (+ / -)", width: 1.1, align: "center" },
        { name: "PSF (+ / -)", width: cw - 4.8, align: "center" },
      ],
      ROOF_CC_ROWS,
    );
    y -= 0.25;
    noteColumn(dd, [x, y], cw, "ROOF PRESSURE NOTES", ROOF_CC_NOTES);
  });
}
