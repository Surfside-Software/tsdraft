// A-301: the building section, north-south through x = 450 looking west (the study, the great
// room and the lanai, the owner's bath, closet and bedroom above) at 1/4" = 1'-0", and the
// typical wall section through the first-floor CMU wall and the second-floor wood wall, from
// the footing to the roof, at 1/2" = 1'-0".
import type { Point } from "../../../src/index.ts";
import { CRITERIA } from "../project.ts";
import { DEPTH, HEIGHTS, L1, L2, LANAI, LANAI_SLAB, ROOF, W } from "../model/house.ts";
import { frame } from "../lib/frame.ts";
import {
  AREA,
  dimString,
  ftIn,
  H,
  LAYERS,
  noteColumn,
  put,
  sectionCut,
  table,
  view,
  viewport,
  width,
  type D,
  type SheetDraw,
  type View,
} from "../lib/kit.ts";
import { breakLine, earth, hatch, insulation } from "../../lib/drafting.ts";
import { ARCH_LAYERS, drawPlan } from "../lib/plan.ts";
import {
  bar,
  battUp,
  concrete,
  dots,
  floodLine,
  guardElev,
  local,
  lumber,
  navd,
  noteStack,
  noteWidth,
  Z,
  type Note,
} from "./elevations-lib.ts";
import { elevSymbols, levelLeft } from "./elevations-symbols.ts";

/** Model-space origins of the views, inside this module's range (x 80000 to 199999). */
export const ORIGIN = {
  building: [92000, 0] as Point,
  wall: [97000, 0] as Point,
  key: [103000, 0] as Point,
};

/** Where the building section cuts, in building x. */
export const CUT_X = 450;

const ov = HEIGHTS.overhang;
const slope = HEIGHTS.pitch / 12;
const TB = Z.tieBeam - Z.tieBeamDepth; // the bottom of the tie beam
/** The continuous footing of S-101 note 3 and 1/S-501: 20" x 12", centered on the 8" wall. */
const FOOT = { top: Z.footingTop, bottom: Z.footingTop - Z.footingDepth, w: Z.footingWidth };
/** LB-1, the lanai beam of S-102: 8" x 20", its top at the lanai plate height (4/S-501). */
const LB = { top: HEIGHTS.lanaiPlate, depth: 20, width: 8 };
const SLAB = 4;
const CLG2 = Z.plate; // the second floor's ceiling, under the roof trusses' bottom chords

/** The roof's top at building (x, y): the hip roof's planes, one pitch all round. */
const roofTop = (x: number, y: number): number =>
  Z.eave + slope * Math.min(x - ROOF.eave[0], ROOF.eave[2] - x, y - ROOF.eave[1], ROOF.eave[3] - y);

interface Extent {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

// ---------------------------------------------------------------------------------------------
// The building section.

function buildingSection(d: D, v: View): Extent {
  const o = ORIGIN.building;
  const L = local(d, o);
  const x = CUT_X;
  const N = DEPTH;
  const lan = { y0: DEPTH, y1: LANAI[3], roofEnd: ROOF.lanai.rect[3] };
  const lanaiTop = (y: number) => ROOF.lanai.high - (y - DEPTH) * (HEIGHTS.lanaiPitch / 12);

  // The cut parts, heavy.
  const cmuS: [number, number] = [0, 8];
  const cmuN: [number, number] = [N - 8, N];
  const winS = L1.openings.find(
    (op) => op.kind === "window" && op.cut[1] === 0 && op.cut[0] <= x && op.cut[2] >= x,
  );
  const slider = L1.openings.find((op) => op.cut[3] === DEPTH && op.cut[0] <= x && op.cut[2] >= x);
  const sill = winS ? (winS.head ?? 96) - (winS.height ?? 60) : 0;
  const head = winS ? (winS.head ?? 96) : 0;
  const sliderHead = slider ? (slider.height ?? 96) : 0;

  d.layer(LAYERS.sect, {}, () => {
    // Footings, stem walls and the slab.
    for (const [a, b] of [cmuS, cmuN]) {
      const c = (a + b) / 2;
      L.rect(c - FOOT.w / 2, FOOT.bottom, c + FOOT.w / 2, FOOT.top);
      L.rect(a, FOOT.top, b, Z.ff - SLAB);
    }
    L.rect(cmuS[0], Z.ff - SLAB, cmuN[1], Z.ff);
    // The thickened slab under the bearing wall between the study and the great room.
    L.poly([
      [180, Z.ff - SLAB],
      [186, Z.ff - 16],
      [203, Z.ff - 16],
      [209, Z.ff - SLAB],
    ]);
    // First floor CMU, the window in the south wall and the slider in the north wall.
    if (winS) {
      L.rect(cmuS[0], Z.ff, cmuS[1], sill);
      L.rect(cmuS[0], head, cmuS[1], TB);
    } else L.rect(cmuS[0], Z.ff, cmuS[1], TB);
    if (slider) L.rect(cmuN[0], sliderHead, cmuN[1], TB);
    else L.rect(cmuN[0], Z.ff, cmuN[1], TB);
    // Tie beams.
    L.rect(cmuS[0], TB, cmuS[1], Z.tieBeam);
    L.rect(cmuN[0], TB, cmuN[1], Z.tieBeam);
    // The interior bearing wall, 2x4 studs.
    L.rect(192, Z.ff, 196.5, Z.tieBeam);
    // Second floor walls: 2x6 outside, 2x4 inside.
    L.rect(0, Z.l2, 6, Z.plate);
    L.rect(N - 6, Z.l2, N, Z.plate);
    for (const w of L2.walls) {
      if (w[0] <= x && w[2] >= x && w[3] - w[1] < 10 && w[1] > 10 && w[3] < N - 10)
        L.rect(w[1], Z.l2, w[3], CLG2);
    }
    // The floor: the rim at each end, the sheathing over the trusses.
    L.rect(0.5, Z.tieBeam, 2, Z.l2 - 0.75);
    L.rect(N - 2, Z.tieBeam, N - 0.5, Z.l2 - 0.75);
    L.line(0, Z.l2, N, Z.l2);
    L.line(0, Z.l2 - 0.75, N, Z.l2 - 0.75);
    // The roof, cut through the east hip plane: up from the south eave, flat, down to the north.
    const prof: [number, number][] = [];
    for (const y of [
      ROOF.eave[1],
      ROOF.eave[1] + (ROOF.eave[2] - x),
      ROOF.eave[3] - (ROOF.eave[2] - x),
      ROOF.eave[3],
    ])
      prof.push([y, roofTop(x, y)]);
    L.poly(prof);
    L.poly(prof.map(([y, z]) => [y, z - 5]));
    L.line(prof[0]![0], prof[0]![1], prof[0]![0], prof[0]![1] - 5 - Z.fascia + 5);
    L.line(prof[3]![0], prof[3]![1], prof[3]![0], prof[3]![1] - Z.fascia);
    // Soffits.
    L.line(ROOF.eave[1], Z.soffit, 0, Z.soffit);
    L.line(N, Z.soffit, ROOF.eave[3], Z.soffit);
    // The lanai: its slab, stem wall and footing, the beam, the shed roof on its ledger.
    L.rect(N, Z.lanai - SLAB, lan.y1, Z.lanai);
    L.rect(lan.y1 - 8, FOOT.top, lan.y1, Z.lanai - SLAB);
    L.rect(lan.y1 - 4 - FOOT.w / 2, FOOT.bottom, lan.y1 - 4 + FOOT.w / 2, FOOT.top);
    L.poly(
      [
        [N, lanaiTop(N)],
        [lan.roofEnd, lanaiTop(lan.roofEnd)],
        [lan.roofEnd, lanaiTop(lan.roofEnd) - 8],
        [N, lanaiTop(N) - 9],
      ],
      false,
    );
    L.rect(lan.y1 - 2 - LB.width, LB.top - LB.depth, lan.y1 - 2, LB.top); // LB-1, cut
    L.rect(N, lanaiTop(N) - 9 - 9.25, N + 1.5, lanaiTop(N) - 9); // the 2x10 ledger
    // The pool deck north of the lanai.
    L.rect(lan.y1, Z.deck - 4, lan.y1 + 90, Z.deck);
  });

  // Seen beyond the cut, thin: the ridge beyond, the lanai post, the window's and slider's frames.
  d.layer(LAYERS.elevFine, {}, () => {
    const yA = ROOF.eave[1] + (ROOF.eave[2] - x);
    const yB = ROOF.eave[3] - (ROOF.eave[2] - x);
    L.poly([
      [yA, roofTop(x, yA)],
      [ROOF.ridgeY, Z.ridge],
      [yB, roofTop(x, yB)],
    ]);
    L.rect(lan.y1 - 12, Z.lanai, lan.y1, LB.top - LB.depth); // the 12" column beyond
    for (const z of [LB.top - 3, LB.top - LB.depth + 3])
      for (const dy of [2.3, 5.7]) bar(L, lan.y1 - 2 - LB.width + dy, z);
    if (winS) {
      L.rect(cmuS[0] + 2, sill, cmuS[1] - 2, head);
      L.line(cmuS[0] - 2, sill, cmuS[1], sill);
    }
    if (slider) L.rect(cmuN[0] + 2, Z.ff, cmuN[1] - 2, sliderHead);
    // Floor trusses, open web, at 24" o.c.: their chords and webs as they are seen.
    const t0 = cmuS[1] + 1;
    const t1 = cmuN[0] - 1;
    L.line(t0, Z.tieBeam + 3.5, t1, Z.tieBeam + 3.5);
    L.line(t0, Z.l2 - 0.75 - 3.5, t1, Z.l2 - 0.75 - 3.5);
    const panel = 30;
    for (let y = t0, k = 0; y + panel <= t1; y += panel, k++) {
      if (k % 2 === 0) L.line(y, Z.tieBeam + 3.5, y + panel, Z.l2 - 4.25);
      else L.line(y, Z.l2 - 4.25, y + panel, Z.tieBeam + 3.5);
    }
    // Roof trusses: the bottom chord and webs of the step-down hip truss at the cut.
    L.line(0, Z.plate + 3.5, N, Z.plate + 3.5);
    L.line(0, Z.plate, N, Z.plate);
    const webs = [60, 120, 174, 264, 354, 408, 468];
    for (const y of webs) L.line(y, Z.plate + 3.5, y, roofTop(x, y) - 5);
    for (let k = 0; k + 1 < webs.length; k++) {
      const [a, b] = [webs[k]!, webs[k + 1]!];
      if (k < 3) L.line(a, Z.plate + 3.5, b, roofTop(x, b) - 5);
      else L.line(a, roofTop(x, a) - 5, b, Z.plate + 3.5);
    }
    // Ceilings: gypsum under the floor trusses and the roof trusses; the owner's tray.
    L.line(cmuS[1], Z.tieBeam - 0.5, cmuN[0], Z.tieBeam - 0.5);
    L.line(6, CLG2 - 0.625, 300, CLG2 - 0.625);
    L.poly([
      [300, CLG2 - 0.625],
      [312, CLG2 + 11.4],
      [478, CLG2 + 11.4],
      [490, CLG2 - 0.625],
      [N - 6, CLG2 - 0.625],
    ]);
  });

  // Patterns, as lines (tsdraft has no hatch).
  d.layer(LAYERS.patt, {}, () => {
    const p = v.p(0.045);
    for (const [a, b] of [cmuS, cmuN]) {
      hatch(d, L.box(a, FOOT.top, b, Z.ff - SLAB), p);
      concrete(
        d,
        L.box((a + b) / 2 - FOOT.w / 2, FOOT.bottom, (a + b) / 2 + FOOT.w / 2, FOOT.top),
        v.p(0.06),
        11,
      );
      concrete(d, L.box(a, TB, b, Z.tieBeam), v.p(0.05), 5);
    }
    if (winS) {
      hatch(d, L.box(cmuS[0], Z.ff, cmuS[1], sill), p);
      hatch(d, L.box(cmuS[0], head, cmuS[1], TB), p);
    }
    hatch(d, L.box(cmuN[0], slider ? sliderHead : Z.ff, cmuN[1], TB), p);
    hatch(d, L.box(lan.y1 - 8, FOOT.top, lan.y1, Z.lanai - SLAB), p);
    concrete(
      d,
      L.box(lan.y1 - 4 - FOOT.w / 2, FOOT.bottom, lan.y1 - 4 + FOOT.w / 2, FOOT.top),
      v.p(0.06),
      29,
    );
    concrete(d, L.box(lan.y1 - 2 - LB.width, LB.top - LB.depth, lan.y1 - 2, LB.top), v.p(0.05), 31);
    // Earth below grade, and compacted fill under the slabs.
    const holes = [
      L.box(-FOOT.w / 2 + 4, FOOT.bottom, FOOT.w / 2 + 4, Z.grade),
      L.box(N - 4 - FOOT.w / 2, FOOT.bottom, N - 4 + FOOT.w / 2, Z.grade),
      L.box(lan.y1 - 4 - FOOT.w / 2, FOOT.bottom, lan.y1 - 4 + FOOT.w / 2, Z.grade),
    ];
    earth(d, L.box(-80, Z.grade - 48, lan.y1 + 70, Z.grade), holes, v.p(0.16));
    dots(d, L.box(cmuS[1] + 2, Z.grade + 2, cmuN[0] - 2, Z.ff - SLAB - 2), v.p(0.09), 5);
    dots(d, L.box(N + 2, Z.grade + 2, lan.y1 - 10, Z.lanai - SLAB - 2), v.p(0.09), 9);
    // Attic insulation over the second floor ceiling, R-38.
    insulation(d, L.box(30, Z.plate + 3.5, N - 30, Z.plate + 13.5));
    // Batts in the second floor's outside walls.
    battUp(d, L.box(0.75, Z.l2 + 2, 5.5, Z.plate - 3));
    battUp(d, L.box(N - 5.5, Z.l2 + 2, N - 0.75, Z.plate - 3));
  });

  // Grade, heavy, outside the walls.
  d.layer(LAYERS.grade, {}, () => {
    L.line(-100, Z.grade, 0, Z.grade);
  });
  // The lanai's guard: cut at its north edge and seen along its west side, column to house.
  guardElev(L, N, lan.y1 - 12, Z.lanai);
  floodLine(L, v, -60, lan.y1 + 60, Z.bfe, `B.F.E. ${CRITERIA.flood.bfe.toFixed(2)}' NAVD`);
  floodLine(L, v, -60, lan.y1 + 60, Z.dfe, `D.F.E. ${CRITERIA.flood.dfe.toFixed(2)}' NAVD`);

  // Room names, and the attic.
  d.layer(LAYERS.anno, {}, () => {
    const name = (h: number, z: number, lines: string[]) =>
      lines.forEach((t, k) =>
        put(d, L.P(h, z - k * v.p(H.note) * 1.6), t, v.p(k ? H.note : H.label), {
          align: "center",
        }),
      );
    const room = (r: { name: string; rect: readonly number[]; ceiling?: string }, z: number) =>
      name((Math.max(r.rect[1]!, 8) + Math.min(r.rect[3]!, N - 8)) / 2, z, [
        r.name,
        ...(r.ceiling ? [r.ceiling] : []),
      ]);
    for (const r of L1.rooms)
      if (r.rect[0] <= x && r.rect[2] >= x && r.name !== "COVERED LANAI") room(r, 70);
    for (const r of L2.rooms) if (r.rect[0] <= x && r.rect[2] >= x) room(r, Z.l2 + 70);
    name((N + lan.y1) / 2, 50, ["COVERED", "LANAI"]);
    name(264, Z.plate + 50, ["ATTIC"]);
  });

  // Levels and dimensions, on the left.
  const colA = -ov - v.p(1.1);
  const levels: [number, string][] = [
    [Z.ridge, "RIDGE (BEYOND)"],
    [Z.plate, "TOP OF PLATE"],
    [Z.l2, "SECOND FLOOR"],
    [Z.tieBeam, "TOP OF TIE BEAM"],
    [Z.ff, "FIRST FLOOR (F.F.E.)"],
    [Z.grade, "FINISH GRADE"],
  ];
  for (const [z, nm] of levels)
    levelLeft(
      L,
      v,
      colA,
      z,
      z === Z.ridge ? ROOF.ridgeY - 96 : z === Z.grade ? -100 : 0,
      nm,
      `EL. ${navd(z).toFixed(2)}' NAVD`,
    );
  d.layer(LAYERS.dims, {}, () => {
    dimString(
      d,
      v,
      [Z.grade, Z.ff, Z.tieBeam, Z.l2, Z.plate, Z.ridge].map((z): Point => L.P(-ov, z)),
      "y",
      o[0] - ov - v.p(0.45),
    );
  });

  // Notes, few: the wall section has the rest. The lanai's go in the space over its roof, the
  // slab's under the grade.
  const notes: Note[] = [
    {
      at: [lan.roofEnd - 40, lanaiTop(lan.roofEnd - 40)],
      elbow: [lan.roofEnd - 30, Z.plate + 52],
      side: -1,
      lines: ["LANAI: MT-1 MONO TRUSSES", 'AT 24" O.C., 3:12, ON 2X10', "P.T. LEDGER, SEE S-102"],
    },
    {
      at: [lan.y1 - 6, LB.top - 8],
      elbow: [lan.y1 + 6, Z.plate + 10],
      side: 1,
      lines: ['LB-1: 8"X20" CONC. BEAM', 'ON 12"X12" COLUMNS,', "C5 AND C7, S-102"],
    },
    {
      at: [lan.y1 - 40, Z.lanai - 2],
      elbow: [lan.y1 - 70, Z.grade - 48 - v.p(0.3)],
      lines: [
        `4" CONC. SLAB AT EL. ${LANAI_SLAB.slab.toFixed(2)}' ON FILL`,
        'IN 8" CMU STEM WALL, SEE S-101;',
        `${LANAI_SLAB.guard}" GUARD ON 3 SIDES, STEPS`,
        `TO POOL DECK (${LANAI_SLAB.deck.toFixed(2)}'), SEE A-201`,
      ],
    },
  ];
  noteStack(L, v, 0, notes);
  // The wall section's callout: a phantom box around the south wall and a bubble.
  d.layer(LAYERS.symb, {}, () => {
    const boxTop = Z.plate + 30;
    L.d.polyline(
      [L.P(-30, FOOT.bottom - 6), L.P(30, FOOT.bottom - 6), L.P(30, boxTop), L.P(-30, boxTop)],
      true,
      { linetype: "PHANTOM" },
    );
    L.d.insert("SECTION MARK", L.P(0, boxTop + v.p(0.45)), {
      scale: v.p(1),
      attributes: { SECT: "2", SHEET: "A-301" },
    });
    put(d, L.P(v.p(0.5), boxTop + v.p(0.45) - v.p(0.3)), "SIM.", v.p(H.note));
  });
  return {
    left: colA - v.p(0.15) - v.p(Math.max(...levels.map(([, n]) => width(n, H.note)))),
    right: lan.y1 + 90,
    bottom: Z.grade - 48 - v.p(1.0),
    top: Z.ridge + v.p(0.3),
  };
}

// ---------------------------------------------------------------------------------------------
// The wall section: h = 0 is the outside face of the CMU and of the sheathing, outside to the
// left; z from the first floor.

const WS = {
  stucco1: 0.625, // on CMU
  stucco2: 0.875, // on lath over sheathing
  osb: 0.4375,
  stud: 5.5,
  gwb: 0.5,
  inside: 48, // how far the section runs into the house
};

function wallSection(d: D, v: View): Extent {
  const o = ORIGIN.wall;
  const L = local(d, o);
  const R = WS.inside;
  const studIn = WS.osb + WS.stud; // the inside face of the 2x6 studs
  const atWall = Z.plate + HEIGHTS.heel; // the roof's top over the outside face of the wall
  const roofZ = (h: number) => atWall + slope * h;
  const deck = 1.25; // metal panel, underlayment and deck under the roof's top line
  const chord = 3.5 / Math.cos(Math.atan(slope)); // a 2x4 top chord's depth, plumb
  const rim = { h0: 0.5, h1: 2 };

  d.layer(LAYERS.sect, {}, () => {
    // Footing and stem wall.
    L.rect(4 - FOOT.w / 2, FOOT.bottom, 4 + FOOT.w / 2, FOOT.top);
    L.rect(0, FOOT.top, 8, Z.ff - SLAB);
    // Slab, on the stem wall.
    L.poly([
      [0, Z.ff - SLAB],
      [R, Z.ff - SLAB],
    ]);
    L.poly([
      [0, Z.ff],
      [R, Z.ff],
    ]);
    // First floor CMU and tie beam.
    L.rect(0, Z.ff, 8, TB);
    L.rect(0, TB, 8, Z.tieBeam);
    // The rim and floor sheathing.
    lumber(L, rim.h0, Z.tieBeam, rim.h1, Z.l2 - 0.75);
    L.rect(0, Z.l2 - 0.75, R, Z.l2);
    // The second floor wall: the plates, cut, and the cavity.
    lumber(L, WS.osb, Z.l2, studIn, Z.l2 + 1.5);
    lumber(L, WS.osb, Z.plate - 3, studIn, Z.plate - 1.5);
    lumber(L, WS.osb, Z.plate - 1.5, studIn, Z.plate);
    L.line(0, Z.l2 - 10, 0, Z.plate); // sheathing's outside face
    L.line(WS.osb, Z.l2 + 1.5, WS.osb, Z.plate - 3);
    L.line(studIn, Z.l2 + 1.5, studIn, Z.plate - 3);
    // Roof: the panel and deck, cut, from the fascia in.
    L.poly([
      [-ov, roofZ(-ov)],
      [R, roofZ(R)],
    ]);
    L.poly([
      [-ov, roofZ(-ov) - deck],
      [R, roofZ(R) - deck],
    ]);
  });

  d.layer(LAYERS.sectFine, {}, () => {
    // Stucco, outside: 5/8" on the CMU, 7/8" on lath over the sheathing.
    L.line(-WS.stucco1, Z.grade - 2, -WS.stucco1, Z.l2 - 10);
    L.line(-WS.stucco2, Z.l2 - 6, -WS.stucco2, Z.soffit);
    L.line(-WS.stucco1, Z.l2 - 10, -WS.stucco2, Z.l2 - 6); // casing bead and control joint
    // Inside the CMU: 3/4" furring with foil-faced insulation, and gypsum.
    L.line(8.75, Z.ff + 4, 8.75, Z.tieBeam - 0.5);
    L.line(9.25, Z.ff + 4, 9.25, Z.tieBeam - 0.5);
    L.rect(9.25, Z.ff, 9.75, Z.ff + 4); // base
    // First floor ceiling and the floor truss, seen.
    L.line(8, Z.tieBeam - 0.5, R, Z.tieBeam - 0.5);
    L.rect(rim.h1, Z.tieBeam, R, Z.tieBeam + 3.5); // bottom chord
    L.rect(rim.h1, Z.l2 - 0.75 - 3.5, R, Z.l2 - 0.75); // top chord
    L.line(rim.h1 + 3.5, Z.tieBeam + 3.5, rim.h1 + 3.5, Z.l2 - 4.25); // end vertical
    L.line(rim.h1 + 3.5, Z.tieBeam + 3.5, rim.h1 + 30, Z.l2 - 4.25);
    L.line(rim.h1, Z.tieBeam + 3.5, rim.h1, Z.l2 - 4.25);
    // Second floor gypsum.
    L.line(studIn + WS.gwb, Z.l2 + 4, studIn + WS.gwb, Z.plate - 0.625);
    L.rect(studIn + WS.gwb, Z.l2, studIn + WS.gwb + 0.5, Z.l2 + 4);
    // Roof truss: the bottom chord on the plate, the heel, the top chord, the ceiling under it.
    L.rect(0, Z.plate, R, Z.plate + 3.5);
    L.line(0, Z.plate + 3.5, 0, roofZ(0) - deck);
    L.line(3.5, Z.plate + 3.5, 3.5, roofZ(3.5) - deck - chord);
    L.poly([
      [-ov + 1.5, roofZ(-ov + 1.5) - deck - chord],
      [R, roofZ(R) - deck - chord],
    ]);
    L.line(studIn, Z.plate - 0.625, R, Z.plate - 0.625); // 5/8" gypsum ceiling
    L.line(3.5, Z.plate + 3.5, 30, roofZ(30) - deck - chord); // a web
    // Sub-fascia, aluminum fascia, vented soffit, baffle.
    L.rect(-ov, Z.soffit, -ov + 1.5, roofZ(-ov) - deck);
    L.poly([
      [-ov - 0.5, roofZ(-ov) + 0.5],
      [-ov - 0.5, Z.soffit - 0.5],
      [-WS.stucco2, Z.soffit - 0.5],
    ]);
    L.line(-ov + 1.5, Z.soffit, -WS.stucco2, Z.soffit);
    L.poly(
      [
        [2, roofZ(2) - deck - chord - 1.5],
        [2, Z.plate + 5],
        [26, Z.plate + 5],
        [26, roofZ(26) - deck - chord - 1.5],
      ],
      false,
    );
    // The vapor retarder under the slab, dashed.
    L.d.line(L.P(8, Z.ff - SLAB - 0.4), L.P(R, Z.ff - SLAB - 0.4), { linetype: "DASHED" });
    // Rebar: #5 vertical, hooked into the footing; (3) #5 in the footing; TB-1's (2) #5, placed
    // as 3/S-501 places them.
    L.poly([
      [4 + FOOT.w / 2 - 3, FOOT.bottom + 3],
      [4, FOOT.bottom + 3],
      [4, Z.tieBeam - 2.5],
    ]);
    for (const h of [4 - FOOT.w / 2 + 3.31, 4, 4 + FOOT.w / 2 - 3.31])
      bar(L, h, FOOT.bottom + 3.31);
    for (const h of [2.3, 5.7]) bar(L, h, Z.tieBeam - 3);
    // A slab dowel and the welded wire.
    L.d.line(L.P(10, Z.ff - 2), L.P(R, Z.ff - 2), { linetype: "DASHED" });
    // Straps: the embedded strap from the tie beam to the truss, the stud strap past the floor,
    // the hurricane clip at the heel.
    L.poly([
      [rim.h1 + 1.5, Z.tieBeam - 8],
      [rim.h1 + 1.5, Z.tieBeam + 12],
    ]);
    L.poly([
      [WS.osb + 0.2, Z.tieBeam - 10],
      [WS.osb + 0.2, Z.l2 + 26],
    ]);
    L.poly([
      [studIn - 0.2, Z.plate - 12],
      [studIn - 0.2, Z.plate + 0.2],
      [studIn + 3, Z.plate + 0.2],
      [studIn + 3, Z.plate + 3.7],
    ]);
  });

  // Patterns.
  d.layer(LAYERS.patt, {}, () => {
    hatch(d, L.box(0, FOOT.top, 8, Z.ff - SLAB), v.p(0.06));
    hatch(d, L.box(0, Z.ff, 8, TB), v.p(0.06));
    concrete(d, L.box(4 - FOOT.w / 2, FOOT.bottom, 4 + FOOT.w / 2, FOOT.top), v.p(0.08), 13);
    concrete(d, L.box(0, TB, 8, Z.tieBeam), v.p(0.08), 17);
    concrete(d, L.box(0, Z.ff - SLAB, R, Z.ff), v.p(0.06), 19);
    earth(
      d,
      L.box(-40, FOOT.bottom - 10, -0.7, Z.grade),
      [L.box(4 - FOOT.w / 2, FOOT.bottom, 4 + FOOT.w / 2, FOOT.top)],
      v.p(0.2),
    );
    earth(d, L.box(4 + FOOT.w / 2 + 1, FOOT.bottom - 10, R, FOOT.top), [], v.p(0.2));
    dots(d, L.box(8.5, FOOT.top + 1, R, Z.ff - SLAB - 1), v.p(0.12), 23);
    battUp(d, L.box(WS.osb + 0.2, Z.l2 + 2, WS.stud - 0.4, Z.plate - 3.5));
    insulation(d, L.box(26, Z.plate + 3.5, R, Z.plate + 13.5));
  });

  d.layer(LAYERS.grade, {}, () => L.line(-40, Z.grade, -WS.stucco1, Z.grade));
  d.layer(LAYERS.sectFine, {}, () => {
    for (const z of [Z.ff - SLAB - 6, Z.tieBeam + 6, Z.plate + 6])
      breakLine(d, L.P(R, z - 14), L.P(R, z + 14), v.p(0.1));
    breakLine(d, L.P(R - 3, roofZ(R - 3) - 10), L.P(R + 3, roofZ(R + 3) + 6), v.p(0.08));
  });

  // Levels, on the right.
  const right = R + v.p(0.4);
  const levels: [number, string][] = [
    [Z.plate, "TOP OF PLATE"],
    [Z.l2, "SECOND FLOOR"],
    [Z.tieBeam, "TOP OF TIE BEAM"],
    [Z.ff, "F.F.E."],
  ];
  d.layer(LAYERS.symb, {}, () => {
    for (const [z, nm] of levels) {
      L.d.line(L.P(R, z), L.P(right - v.p(0.08), z));
      L.d.insert("LEVEL", L.P(right, z), {
        scale: v.p(1),
        attributes: { NAME: nm, EL: `EL. ${navd(z).toFixed(2)}'` },
      });
    }
  });

  // Notes: outside on the left, inside on the right.
  const outside: Note[] = [
    {
      at: [-ov / 2, roofZ(-ov / 2)],
      lines: [
        "STANDING SEAM METAL ROOF PANELS,",
        "SELF-ADHERED UNDERLAYMENT,",
        '19/32" CDX PLY. DECK, 8D RS NAILS',
        'AT 4" O.C. EDGES / 6" FIELD',
      ],
    },
    { at: [-ov - 0.5, Z.soffit + 2], lines: ["ALUM. FASCIA OVER 2X6 SUB-FASCIA"] },
    { at: [-ov / 2, Z.soffit - 0.5], lines: ["VENTED ALUM. SOFFIT, 9 SQ. IN./FT."] },
    {
      at: [-WS.stucco2, Z.l2 + 50],
      lines: [
        '7/8" 3-COAT STUCCO ON 2.5 LB.',
        "METAL LATH OVER 2 LAYERS GRADE D",
        'PAPER, 7/16" OSB, 8D AT 4" EDGES',
        'AND 8" FIELD (S-501)',
      ],
    },
    {
      at: [-WS.stucco2, Z.l2 - 7],
      lines: ["CASING BEAD AND CONTROL JOINT", "AT THE CHANGE OF SUBSTRATE"],
    },
    {
      at: [-WS.stucco1, 60],
      lines: ['5/8" 2-COAT STUCCO ON 8" CMU,', "f'm = 2,000 PSI, TYPE S MORTAR"],
    },
    { at: [-WS.stucco1, Z.grade + 14], lines: ["STUCCO ON CMU STEM WALL"] },
    {
      at: [-30, Z.grade],
      lines: [
        `FINISH GRADE EL. ${CRITERIA.flood.finishGrade.toFixed(2)}',`,
        'SLOPE AWAY 6" IN 10\'-0"',
      ],
    },
    {
      at: [4 - FOOT.w / 2, FOOT.bottom + 6],
      lines: [`${FOOT.w}"X${Z.footingDepth}" CONT. FOOTING, (3) #5`, 'CONT., 3" CLR., SEE 1/S-501'],
    },
  ];
  const inside: Note[] = [
    {
      at: [36, roofZ(36) - deck - chord],
      lines: [
        "PRE-ENG. WOOD ROOF TRUSSES AT",
        `24" O.C., ${CRITERIA.dead.roof} PSF DEAD, SEE S-102`,
      ],
    },
    {
      at: [studIn + 3, Z.plate + 2],
      lines: ["TRUSS STRAP 'C1' AT EACH TRUSS", "END, UPLIFT PER S-102 SCHEDULE"],
    },
    { at: [40, Z.plate + 10], lines: ["R-38 BLOWN INSULATION,", "BAFFLE AT EAVE"] },
    { at: [40, Z.plate - 0.625], lines: ['5/8" GWB CEILING'] },
    {
      at: [WS.stud - 1, Z.l2 + 80],
      lines: ['2X6 STUDS AT 16" O.C., R-21', 'BATTS, 1/2" GWB, DBL. TOP PLATE'],
    },
    {
      at: [WS.osb + 0.2, Z.l2 + 22],
      lines: ["EMBEDDED STRAP 'C2', STUD TO", 'TIE BEAM, AT 32" O.C., 3/S-501'],
    },
    {
      at: [30, Z.tieBeam + 8],
      lines: ['16" FLOOR TRUSSES AT 24" O.C.,', '3/4" T&G OSB, GLUED AND NAILED'],
    },
    {
      at: [rim.h1 + 1.5, Z.tieBeam - 6],
      lines: ["EMBEDDED TRUSS ANCHOR 'C4'", "AT EACH FLOOR TRUSS, 3/S-501"],
    },
    { at: [5.7, Z.tieBeam - 3], lines: ["8\"X16\" TIE BEAM 'TB-1',", "(2) #5 CONT., SEE S-102"] },
    { at: [9, 70], lines: ['3/4" P.T. FURRING, R-4.1 FOIL-', 'FACED INSUL., 1/2" GWB'] },
    { at: [4, 30], lines: ['#5 VERT. AT 48" O.C. AND AT', "OPENINGS, IN GROUTED CELLS"] },
    { at: [24, Z.ff - 2], lines: ['4" CONC. SLAB, 6X6-W1.4XW1.4', "W.W.F., SEE S-101"] },
    {
      at: [30, Z.ff - SLAB - 0.4],
      lines: ["10 MIL VAPOR RETARDER, TERMITE", "TREATMENT PER FBC-R R318"],
    },
    { at: [30, -20], lines: ["CLEAN FILL COMPACTED TO 95%", '(ASTM D1557) IN 12" LIFTS'] },
    { at: [5, FOOT.bottom + 3], lines: ["#5 STD. HOOK INTO FOOTING"] },
  ];
  const leftH = -ov - v.p(0.5);
  const rightH = right + v.p(1.5);
  const lowL = noteStack(L, v, leftH, outside);
  const bands = levels.map(([z]): [number, number] => [z - v.p(0.55), z + v.p(0.2)]);
  const lowR = noteStack(L, v, rightH, inside, Infinity, bands);
  return {
    left: leftH - v.p(0.3) - v.p(Math.max(...outside.map((n) => noteWidth(n.lines)))),
    right: rightH + v.p(0.3) + v.p(Math.max(...inside.map((n) => noteWidth(n.lines)))),
    bottom: Math.min(lowL, lowR, FOOT.bottom - 10) - v.p(0.1),
    top: roofZ(R) + v.p(0.3),
  };
}

/** A key plan of the first floor at 1/16" = 1'-0", with the building section's cut. */
function keyPlan(d: D, v: View): Extent {
  const o = ORIGIN.key;
  drawPlan(d, o, L1, ARCH_LAYERS, "L1");
  const P = (x: number, y: number): Point => [o[0] + x, o[1] + y];
  d.layer(LAYERS.symb, {}, () => {
    const y0 = -v.p(0.45);
    const y1 = LANAI[3] + v.p(0.45);
    d.line(P(CUT_X, y0 + v.p(0.22)), P(CUT_X, y1 - v.p(0.22)), {
      linetype: "PHANTOM",
      lineweight: 0.35,
    });
    // The kit's mark, as A-101 and A-102 draw the same cut: the bubble upright, the arrow west.
    sectionCut(d, v, P(CUT_X, y0), "W", "1", "A-301");
    sectionCut(d, v, P(CUT_X, y1), "W", "1", "A-301");
  });
  d.layer(LAYERS.anno, {}, () => {
    put(d, P(312, -v.p(0.9)), "KEY PLAN, FIRST FLOOR", v.p(H.note), { align: "center" });
  });
  return { left: -v.p(0.4), right: 624 + v.p(0.4), bottom: -v.p(1.05), top: LANAI[3] + v.p(0.8) };
}

/**
 * The attic's ventilation, worked out as A-103 works it out: 1/150 of the attic floor, met by the
 * soffits, the ridge vent and the off-ridge vents the hip roof needs for its upper half.
 */
const VENTILATION = (() => {
  const attic = (W * DEPTH) / 144;
  const ridge = (((ROOF.ridge[1][0] - ROOF.ridge[0][0]) / 12) * 18) / 144; // 18 sq. in. per foot
  const soffit = (((2 * (W + DEPTH + 4 * HEIGHTS.overhang)) / 12) * 9) / 144; // 9 sq. in. per foot
  const offRidge = { count: 8, each: 54 }; // as A-103 has them, sq. in. of net free area each
  const off = (offRidge.count * offRidge.each) / 144;
  return {
    attic,
    required: attic / 150,
    ridge,
    soffit,
    offRidge,
    off,
    total: ridge + soffit + off,
  };
})();

const SECTION_NOTES = [
  "SEE S-101, S-102 AND S-501 FOR FOUNDATIONS, FRAMING, CONNECTORS AND REINFORCING. WHERE THIS SHEET AND THE STRUCTURAL SHEETS DIFFER, THE STRUCTURAL SHEETS GOVERN.",
  `THE LOWEST FLOOR (F.F.E. ${CRITERIA.flood.ffe.toFixed(2)}' NAVD) IS ABOVE THE D.F.E. (${CRITERIA.flood.dfe.toFixed(2)}' NAVD). MATERIALS BELOW THE D.F.E. ARE FLOOD DAMAGE-RESISTANT (FBC-R R322.1.8).`,
  "CONNECTORS ARE TAGGED C1 TO C8 AS ON THE S-102 CONNECTOR SCHEDULE. EACH IS RATED FOR AT LEAST THE UPLIFT LISTED THERE, HAS FLORIDA PRODUCT APPROVAL AND IS INSTALLED WITH EVERY FASTENER THE MANUFACTURER CALLS FOR.",
  `ROOF AND FLOOR TRUSSES: PRE-ENGINEERED FOR THE LOADS ON S-501 (ROOF ${CRITERIA.live.roof} PSF LIVE, ${CRITERIA.dead.roof} PSF DEAD), WITH SIGNED AND SEALED SHOP DRAWINGS SUBMITTED BEFORE THE FRAMING INSPECTION.`,
  `ATTIC VENTILATION (FBC-R R806.2): 1/150 OF THE ${VENTILATION.attic.toLocaleString("en-US")} SQ. FT. ATTIC FLOOR, ${VENTILATION.required.toFixed(2)} SQ. FT. OF NET FREE AREA REQUIRED. ${VENTILATION.total.toFixed(2)} SQ. FT. PROVIDED: VENTED SOFFITS ${VENTILATION.soffit.toFixed(2)}, RIDGE VENT ${VENTILATION.ridge.toFixed(2)} AND ${VENTILATION.offRidge.count} OFF-RIDGE VENTS OF ${VENTILATION.offRidge.each} SQ. IN. ${VENTILATION.off.toFixed(2)}. SEE A-103.`,
  'GARAGE SEPARATION (FBC-R R302.6, TABLE R302.6): 5/8" TYPE X GYPSUM BOARD ON THE GARAGE CEILING BELOW THE HABITABLE ROOMS, AND 1/2" GYPSUM BOARD ON THE GARAGE WALLS. SEE A-101.',
];

/** The building envelope's R-values, as the energy form uses them. */
function envelopeTable(d: D, at: Point, w: number): number {
  const rows = [
    ["CEILING UNDER ATTIC", "R-38", "BLOWN FIBERGLASS"],
    ["FRAME WALL, 2ND FLOOR", "R-21", "2X6, FIBERGLASS BATTS"],
    ["MASS WALL, 1ST FLOOR", "R-4.1", "FOIL-FACED, ON FURRING"],
    ["SLAB ON GRADE", "R-0", "NOT REQUIRED (CZ 2)"],
    ["WINDOWS", "U-0.40", "SHGC 0.25, IMPACT"],
  ];
  const c2 = 0.8;
  return table(
    d,
    at,
    "ENVELOPE (FBC-ENERGY R402, CLIMATE ZONE 2)",
    [
      { name: "ASSEMBLY", width: (w - c2) * 0.48 },
      { name: "R / U", width: c2, align: "center" },
      { name: "MATERIAL", width: (w - c2) * 0.52 },
    ],
    rows,
  );
}

/**
 * The load path, top to bottom, by the tags of the S-102 connector schedule: the products and
 * their uplifts are on S-102, so they are not repeated here.
 */
function strapTable(d: D, at: Point, w: number): number {
  const rows = [
    ["ROOF TRUSS TO 2ND FLR. TOP PLATE", "C1", "S-102"],
    ['2ND FLR. STUD TO TIE BEAM, 32" O.C.', "C2", "3/S-501"],
    ["FLOOR TRUSS TO TIE BEAM", "C4", "3/S-501"],
    ['TIE BEAM TO FOOTING, 48" O.C.', "#5 VERT.", "1/S-501"],
    ["LANAI MONO TRUSS TO LB-1", "C5", "4/S-501"],
    ["LANAI COLUMN TO LB-1 AND PAD", "C7", "S-101"],
  ];
  const c2 = 0.95;
  const c3 = 0.85;
  return table(
    d,
    at,
    "UPLIFT LOAD PATH (SCHEDULE ON S-102)",
    [
      { name: "CONNECTION", width: w - c2 - c3 },
      { name: "TAG", width: c2, align: "center" },
      { name: "SEE", width: c3, align: "center" },
    ],
    rows,
  );
}

function sectionSheet(d: D): void {
  elevSymbols(d);
  const v1 = view(d, 48);
  const v2 = view(d, 24);
  const e1 = buildingSection(d, v1);
  const e2 = wallSection(d, v2);
  const e3 = keyPlan(d, view(d, 192));
  frame(d, "A-301", (dd, sheet) => {
    // The building section, top left.
    const w1 = (e1.right - e1.left) / 48 + 0.3;
    const h1 = (e1.top - e1.bottom) / 48 + 0.3;
    const top = AREA.top - 0.1;
    viewport(dd, sheet, {
      corner: [AREA.left, top - h1],
      size: [w1, h1],
      center: [
        ORIGIN.building[0] + (e1.left + e1.right) / 2,
        ORIGIN.building[1] + (e1.bottom + e1.top) / 2,
      ],
      v: v1,
      id: "vp-A-301-1",
      number: "1",
      sheetNo: "A-301",
      title: "BUILDING SECTION",
      titleAt: [AREA.left + 0.2, top - h1 - 0.45],
    });
    // The wall section, on the right, full height.
    const w2 = (e2.right - e2.left) / 24 + 0.3;
    const h2 = (e2.top - e2.bottom) / 24 + 0.3;
    const x2 = AREA.right - w2;
    viewport(dd, sheet, {
      corner: [x2, top - h2],
      size: [w2, h2],
      center: [
        ORIGIN.wall[0] + (e2.left + e2.right) / 2,
        ORIGIN.wall[1] + (e2.bottom + e2.top) / 2,
      ],
      v: v2,
      id: "vp-A-301-2",
      number: "2",
      sheetNo: "A-301",
      title: "TYPICAL WALL SECTION",
      titleAt: [x2 + 0.2, top - h2 - 0.45],
    });
    // Under the building section: notes and two tables.
    const y0 = top - h1 - 1.2;
    const colW = Math.min(6.2, (x2 - AREA.left - 0.9) / 3);
    let y = noteColumn(dd, [AREA.left + 0.2, y0], colW, "SECTION NOTES", SECTION_NOTES);
    void y;
    envelopeTable(dd, [AREA.left + 0.5 + colW, y0], colW);
    strapTable(dd, [AREA.left + 0.8 + 2 * colW, y0], colW);
    // The key plan, bottom left.
    const v3 = view(dd, 192);
    const kw = (e3.right - e3.left) / 192 + 0.2;
    const kh = (e3.top - e3.bottom) / 192 + 0.2;
    viewport(dd, sheet, {
      corner: [AREA.left + 0.3, AREA.bottom + 0.9],
      size: [kw, kh],
      center: [ORIGIN.key[0] + (e3.left + e3.right) / 2, ORIGIN.key[1] + (e3.bottom + e3.top) / 2],
      v: v3,
      id: "vp-A-301-3",
      number: "3",
      sheetNo: "A-301",
      title: "KEY PLAN",
      scale: 'SCALE: 1/16" = 1\'-0"',
      titleAt: [AREA.left + 0.4, AREA.bottom + 0.5],
    });
    void ftIn;
  });
}

export const SECTION_SHEETS: Record<string, SheetDraw> = {
  "A-301": sectionSheet,
};
