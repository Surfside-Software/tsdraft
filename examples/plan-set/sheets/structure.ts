// S-101, S-102 and S-501: the foundation plan, the floor and roof framing plans, and the
// structural details and notes. Model space from x 200000 to 299999.
import type { Point } from "../../../src/index.ts";
import { CRITERIA } from "../project.ts";
import {
  areas,
  ENTRY,
  FLOOD_VENTS,
  GARAGE_STEPS,
  L1,
  LANAI,
  LANAI_SLAB,
  type Opening,
  type Rect,
  FLOOD_VENT_RATING,
} from "../model/house.ts";
import { frame } from "../lib/frame.ts";
import {
  AREA,
  dimString,
  H,
  LAYERS,
  leaderNote,
  noteColumn,
  put,
  view,
  viewport,
  width,
  type D,
  type SheetDraw,
  type View,
} from "../lib/kit.ts";
import { alongX, wallOutline } from "../lib/plan.ts";
import { grow, shift, SL, structureSetup } from "./structure-kit.ts";
import { framingSheet } from "./structure-framing.ts";
import { detailsSheet } from "./structure-details.ts";

export const ORIGIN = { fnd: [200500, 0] as Point };

/** Walls under which the foundation runs: every masonry wall of the first floor, the porch's
 * open south edge, and the raised lanai's three sides. */
const PORCH_EDGE: Rect = [272, 0, 376, 8];
const LANAI_STEM: Rect[] = [
  [LANAI[0], LANAI[1], LANAI[0] + 8, LANAI[3]],
  [LANAI[2] - 8, LANAI[1], LANAI[2], LANAI[3]],
  [LANAI[0], LANAI[3] - 8, LANAI[2], LANAI[3]],
];
const STEM: Rect[] = [...L1.exterior, PORCH_EDGE, ...LANAI_STEM];
/** Interior bearing walls of the first floor, on thickened slab. */
const BEARING: Rect[] = [
  [272, 288, 384, 292.5],
  [379.5, 80, 384, 292.5],
];
/** The lanai's two columns, 12" square, and their pads, 3'-0" square. */
const COLUMNS: Point[] = [
  [LANAI[0] + 6, LANAI[3] - 6],
  [LANAI[2] - 6, LANAI[3] - 6],
];
/** The garage's flood vents, from the model, and whether the wall each sits in runs north-south. */
const alongY = (wall: string) => wall !== "S" && wall !== "N";
const VENTS = FLOOD_VENTS.map((x) => ({
  at: x.at,
  ns: alongY(x.wall),
  rot: alongY(x.wall) ? 90 : 0,
}));
/** Half a vent's width plus half a cell: a bar closer than this to a vent moves past it. */
const VENT_CLEAR = 12;

/** Vertical bars: at 48" o.c. along each masonry wall, and at each side of every opening. */
function vertBars(walls: readonly Rect[], openings: readonly Opening[]): Point[] {
  const out: Point[] = [];
  const add = (p: Point) => {
    if (!out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 10)) out.push(p);
  };
  for (const r of walls) {
    const ax = r[2] - r[0] > r[3] - r[1];
    const [a0, a1] = ax ? [r[0], r[2]] : [r[1], r[3]];
    const c = ax ? (r[1] + r[3]) / 2 : (r[0] + r[2]) / 2;
    const at = (a: number): Point => (ax ? [a, c] : [c, a]);
    const inWall = openings.filter(
      (o) =>
        alongX(o) === ax &&
        (ax
          ? o.cut[1] >= r[1] - 0.1 && o.cut[3] <= r[3] + 0.1 && o.cut[0] >= r[0] && o.cut[2] <= r[2]
          : o.cut[0] >= r[0] - 0.1 &&
            o.cut[2] <= r[2] + 0.1 &&
            o.cut[1] >= r[1] &&
            o.cut[3] <= r[3]),
    );
    const holes = inWall.map(
      (o) => (ax ? [o.cut[0], o.cut[2]] : [o.cut[1], o.cut[3]]) as [number, number],
    );
    for (const [h0, h1] of holes) {
      add(at(h0 - 4));
      add(at(h1 + 4));
    }
    add(at(a0 + 4));
    add(at(a1 - 4));
    for (let a = a0 + 4 + 48; a < a1 - 4; a += 48) {
      if (holes.some(([h0, h1]) => a > h0 - 8 && a < h1 + 8)) continue;
      add(at(a));
    }
  }
  // No bar cell under a flood vent: a vent needs an open cell, so the bar moves one cell past
  // it, or goes where a jamb bar already stands within a cell of that spot.
  const near = (p: Point, q: Point) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 10;
  const kept: Point[] = [];
  for (const p of out) {
    const k = (x: (typeof VENTS)[number]) => (x.ns ? 1 : 0); // the axis the wall runs along
    const v = VENTS.find(
      (x) =>
        Math.abs(p[1 - k(x)]! - x.at[1 - k(x)]!) < 6 &&
        Math.abs(p[k(x)]! - x.at[k(x)]!) < VENT_CLEAR,
    );
    if (!v) {
      kept.push(p);
      continue;
    }
    const along = v.at[k(v)]! + (p[k(v)]! < v.at[k(v)]! ? -VENT_CLEAR : VENT_CLEAR);
    const moved: Point = v.ns ? [p[0], along] : [along, p[1]];
    if (!out.some((q) => q !== p && near(q, moved))) kept.push(moved);
  }
  return kept;
}

const WALL_NAME: Record<string, string> = { W: "WEST", E: "EAST", S: "SOUTH", N: "NORTH" };

const FND_NOTES = [
  `ALLOWABLE SOIL BEARING PRESSURE ${CRITERIA.soil.toLocaleString("en-US")} PSF, TO BE VERIFIED BY A GEOTECHNICAL ENGINEER BEFORE FOOTINGS ARE PLACED. REMOVE ORGANICS AND DEBRIS; PROOF-ROLL THE BUILDING PAD.`,
  'FILL UNDER SLABS: CLEAN SAND, COMPACTED TO 95% OF MODIFIED PROCTOR (ASTM D1557) IN 12" LIFTS, DENSITY TESTED EVERY LIFT.',
  `CONTINUOUS FOOTINGS: 20" WIDE X 12" DEEP WITH (3) #5 CONTINUOUS, BOTTOM 18" MIN. BELOW FINISHED GRADE (${CRITERIA.flood.finishGrade.toFixed(2)}' NAVD AT THE FOUNDATION). SEE 1/S-501.`,
  'STEM WALLS: 8" CMU, CELLS WITH BARS GROUTED SOLID. #5 VERTICAL AT 48" O.C., AT CORNERS AND AT EACH SIDE OF OPENINGS, HOOKED IN THE FOOTING AND RUN TO THE TIE BEAM.',
  'SLAB ON GRADE: 4" CONCRETE, 3000 PSI, WITH 6X6-W1.4XW1.4 WWF ON A 10 MIL VAPOR RETARDER, LAPPED 6" AND TAPED. SAW-CUT CONTROL JOINTS WITHIN 12 HOURS, 15\'-0" O.C. MAX.',
  'THICKENED SLAB UNDER INTERIOR BEARING WALLS: 12" WIDE X 8" BELOW THE SLAB WITH (2) #5 CONTINUOUS.',
  'LANAI COLUMN PADS: 3\'-0" X 3\'-0" X 16" WITH (4) #5 EACH WAY, (4) #5 DOWELS INTO THE COLUMN.',
  `FLOOD VENTS: ${FLOOD_VENTS.length} ENGINEERED VENTS, EACH CERTIFIED (ICC-ES) TO COVER ${FLOOD_VENT_RATING} SQ. FT. OF ENCLOSED AREA (${FLOOD_VENTS.length * FLOOD_VENT_RATING} SQ. FT.), IN THE ${[...new Set(FLOOD_VENTS.map((x) => WALL_NAME[x.wall as string]))].join(" AND ")} GARAGE WALLS, IN UNGROUTED CELLS, BOTTOM WITHIN 12" OF FINISHED GRADE (FBC-R R322.2.2). THEY COVER THE GROSS GARAGE AREA, ${areas().garage} SQ. FT. TO THE OUTSIDE FACES.`,
  "SOIL UNDER THE BUILDING TREATED FOR TERMITES BEFORE THE VAPOR RETARDER IS LAID (FBC-R R318).",
  `ALL ELEVATIONS ARE NAVD 88. FINISHED GRADE AT THE FOUNDATION ${CRITERIA.flood.finishGrade.toFixed(2)}'; DESIGN FLOOD ELEVATION ${CRITERIA.flood.dfe.toFixed(2)}'; FIRST FLOOR ${CRITERIA.flood.ffe.toFixed(2)}'.`,
  `STEPS: CONC. ON COMPACTED FILL, 4" MIN. THICK, DOWELED TO THE STEM WALL WITH #4 AT 16" O.C. HANDRAILS, GUARDS AND RISER AND TREAD SIZES PER A-101.`,
];

function foundationPlan(d: D): void {
  structureSetup(d);
  const origin = ORIGIN.fnd;
  const v = view(d, 48);
  const o = (p: Point): Point => [origin[0] + p[0], origin[1] + p[1]];
  const sh = (r: Rect) => shift(r, origin);
  // Stem walls as one clean outline; they run unbroken under the openings.
  d.layer(LAYERS.fndn, {}, () => {
    for (const [a, b] of wallOutline(STEM.map(sh), [])) d.line(a, b);
  });
  // Footing edges, thickened slab and column pads: hidden lines, one merged outline.
  const pads = COLUMNS.map((c): Rect => [c[0] - 18, c[1] - 18, c[0] + 18, c[1] + 18]);
  d.layer(LAYERS.ftng, {}, () => {
    for (const [a, b] of wallOutline(
      [...STEM.map((r) => grow(r, 6)), ...BEARING.map((r) => grow(r, 3.75)), ...pads].map(sh),
      [],
    ))
      d.line(a, b);
  });
  // Bearing walls above, on the thickened slab: thin outline.
  d.layer(LAYERS.slab, {}, () => {
    for (const [a, b] of wallOutline(BEARING.map(sh), [])) d.line(a, b);
    // Steps from the model: the garage steps at door 103, the front entry and the lanai steps.
    const g = GARAGE_STEPS;
    const edge = g.top - g.landing;
    const foot = edge - (g.risers - 1) * g.tread;
    d.rect(o([g.x0, foot]), g.x1 - g.x0, g.top - foot);
    for (let k = 0; k < g.risers; k++)
      d.line(o([g.x0, edge - k * g.tread]), o([g.x1, edge - k * g.tread]));
    for (const st of [
      { x0: ENTRY.x0, x1: ENTRY.x1, y: 0, dir: -1, n: ENTRY.risers - 1, t: ENTRY.tread },
      {
        x0: LANAI_SLAB.steps.x0,
        x1: LANAI_SLAB.steps.x1,
        y: LANAI[3],
        dir: 1,
        n: LANAI_SLAB.steps.risers - 1,
        t: LANAI_SLAB.steps.tread,
      },
    ]) {
      for (let k = 0; k <= st.n; k++)
        d.line(o([st.x0, st.y + st.dir * k * st.t]), o([st.x1, st.y + st.dir * k * st.t]));
      for (const x of [st.x0, st.x1]) d.line(o([x, st.y]), o([x, st.y + st.dir * st.n * st.t]));
    }
  });
  // The lanai columns above their pads.
  d.layer(LAYERS.fndn, {}, () => {
    // Drawn heavier and crossed, so the 12" column reads apart from the 8" stem wall it sits on.
    for (const c of COLUMNS) {
      d.rect(o([c[0] - 6, c[1] - 6]), 12, 12, { lineweight: 0.5 });
      d.line(o([c[0] - 6, c[1] - 6]), o([c[0] + 6, c[1] + 6]));
      d.line(o([c[0] - 6, c[1] + 6]), o([c[0] + 6, c[1] - 6]));
    }
  });
  // Saw-cut control joints, 15'-0" o.c. max., between the stem walls' inside faces.
  d.layer(LAYERS.slab, {}, () => {
    const joints: [Point, Point][] = [
      [
        [500, 8],
        [500, 520],
      ],
      [
        [384, 100],
        [616, 100],
      ],
      [
        [384, 358],
        [616, 358],
      ],
      [
        [258, 296],
        [258, 520],
      ],
      [
        [136, 408],
        [380, 408],
      ],
      [
        [136, 8],
        [136, 288],
      ],
      [
        [8, 148],
        [264, 148],
      ],
      [
        [LANAI[0] + 8, 600],
        [LANAI[2] - 8, 600],
      ],
    ];
    for (const [a, b] of joints) d.line(o(a), o(b), { linetype: "CENTER" });
  });
  // Vertical bars.
  const masonry = L1.openings.filter((x) =>
    STEM.some(
      (r) =>
        x.cut[0] >= r[0] - 0.1 &&
        x.cut[2] <= r[2] + 0.1 &&
        x.cut[1] >= r[1] - 0.1 &&
        x.cut[3] <= r[3] + 0.1,
    ),
  );
  d.layer(SL.rebar, {}, () => {
    for (const p of vertBars(STEM, masonry)) d.insert("S-VERT BAR", o(p), { scale: v.p(1) });
  });
  // Flood vents.
  d.layer(LAYERS.strAnno, {}, () => {
    for (const x of VENTS) d.insert("FLOOD VENT", o(x.at), { scale: v.p(1), rotation: x.rot });
  });

  const h = v.p(H.note);
  d.layer(LAYERS.strAnno, {}, () => {
    // Slab notes and elevations.
    const slab = (at: Point, lines: string[]) =>
      lines.forEach((t, k) => put(d, o([at[0], at[1] - k * h * 1.6]), t, h, { align: "center" }));
    slab(
      [442, 420],
      [
        '4" CONC. SLAB ON GRADE',
        "ON 10 MIL V.R. ON COMPACTED FILL",
        `T.O. SLAB EL. ${CRITERIA.flood.ffe.toFixed(2)}' NAVD (F.F.E.)`,
      ],
    );
    slab(
      [442, 160],
      ['4" CONC. SLAB ON GRADE', `T.O. SLAB EL. ${CRITERIA.flood.ffe.toFixed(2)}' NAVD`],
    );
    slab(
      [196, 470],
      ['4" CONC. SLAB ON GRADE', `T.O. SLAB EL. ${CRITERIA.flood.ffe.toFixed(2)}' NAVD`],
    );
    slab(
      [72, 118],
      [
        '4" CONC. GARAGE SLAB, SLOPE',
        '1/8" PER FT. TO O.H. DOOR',
        `T.O. SLAB EL. ${CRITERIA.flood.garage.toFixed(2)}' NAVD`,
        "(2'-6\" BELOW F.F.E.)",
      ],
    );
    slab(
      [500, 640],
      [
        '4" CONC. RAISED LANAI SLAB, SLOPE 1/8"/FT.',
        `T.O. SLAB EL. ${LANAI_SLAB.slab.toFixed(2)}' NAVD`,
      ],
    );
    slab([324, 40], ['4" CONC. PORCH SLAB', `EL. ${ENTRY.slab.toFixed(2)}' NAVD`]);
    // Leaders.
    leaderNote(d, v, o([0, 400]), o([-150, 440]), [
      '8" CMU STEM WALL ON 20" X 12"',
      "CONT. FTG. W/ (3) #5 CONT.,",
      "TYP. AT ALL EXT. WALLS",
    ]);
    leaderNote(d, v, o([-6, 360]), o([-150, 330]), ["FTG. EDGE (HIDDEN), TYP."]);
    leaderNote(d, v, o([4, 476]), o([-150, 520]), [
      "#5 VERT. IN GROUTED CELL AT",
      '48" O.C., CORNERS AND EA.',
      "SIDE OF OPENINGS, TYP.",
    ]);
    leaderNote(d, v, o([0, FLOOD_VENTS[2]!.at[1]]), o([-150, 230]), [
      `FLOOD VENT, TYP. OF ${FLOOD_VENTS.length},`,
      "UNGROUTED CELL, NOTE 8",
    ]);
    leaderNote(d, v, o([382, 230]), o([450, 270]), [
      "THICKENED SLAB UNDER",
      "BEARING WALL, SEE NOTE 6",
    ]);
    leaderNote(d, v, o([300, 290]), o([300, 330]), ["THICKENED SLAB, SEE NOTE 6"]);
    leaderNote(
      d,
      v,
      o([
        (GARAGE_STEPS.x0 + GARAGE_STEPS.x1) / 2,
        GARAGE_STEPS.top - GARAGE_STEPS.landing - GARAGE_STEPS.tread * 1.5,
      ]),
      o([90, 200]),
      [
        `CONC. STEPS: ${GARAGE_STEPS.landing}" LANDING AT DOOR 103,`,
        `${GARAGE_STEPS.risers} RISERS DN. TO GARAGE SLAB, NOTE 11`,
      ],
    );
    leaderNote(d, v, o([ENTRY.x1 - 6, -ENTRY.tread * 1.5]), o([430, -30]), [
      `CONC. ENTRY STEPS, ${ENTRY.risers} RISERS DN.`,
      "TO WALK, NOTE 11",
    ]);
    leaderNote(
      d,
      v,
      o([LANAI_SLAB.steps.x0 + 6, LANAI[3] + LANAI_SLAB.steps.tread * 1.5]),
      o([440, 718]),
      [
        `CONC. STEPS, ${LANAI_SLAB.steps.risers} RISERS DN. TO`,
        `POOL DECK ${LANAI_SLAB.deck.toFixed(2)}', NOTE 11`,
      ],
    );
    leaderNote(d, v, o([252, 288]), o([242, 226]), ["SLAB STEP,", "SEE 2/S-501"]);
    leaderNote(d, v, o([120, 8]), o([120, 60]), [
      "SLAB EDGE AT O.H. DOOR,",
      'THICKENED 12" W/ (2) #5',
    ]);
    leaderNote(d, v, o(COLUMNS[1]!), o([650, 730]), [
      '12" X 12" CONC. COLUMN W/ (4) #5',
      'ON 3\'-0" SQ. X 16" PAD, SEE NOTE 7',
    ]);
    leaderNote(d, v, o([LANAI[0] + 4, 600]), o([300, 620]), [
      '8" CMU STEM WALL AROUND',
      "RAISED LANAI SLAB, TYP.",
    ]);
    leaderNote(d, v, o([500, 470]), o([444, 492]), ["SAW-CUT CONTROL", "JOINT, TYP., NOTE 5"]);
  });
  // Section marks to the details on S-501, each with its cut line.
  const mark = (at: Point, cut: [Point, Point], no: string) => {
    d.layer(LAYERS.strAnno, {}, () => {
      d.line(o(cut[0]), o(cut[1]), { lineweight: 0.5 });
      d.insert("SECTION MARK", o(at), { scale: v.p(1), attributes: { SECT: no, SHEET: "S-501" } });
    });
  };
  mark(
    [100, 568],
    [
      [100, 557],
      [100, 500],
    ],
    "1",
  );
  mark(
    [200, 252],
    [
      [200, 263],
      [200, 320],
    ],
    "2",
  );
  // Dimension strings.
  const first = v.p(0.75);
  const gap = v.p(0.375);
  d.layer(LAYERS.strDims, {}, () => {
    const south = -(ENTRY.risers - 1) * ENTRY.tread; // past the entry steps
    const north = LANAI[3] + (LANAI_SLAB.steps.risers - 1) * LANAI_SLAB.steps.tread; // past the lanai steps
    const S = (k: number) => origin[1] + south - first - gap * k;
    const Wx = (k: number) => origin[0] - first - gap * k;
    const N = (k: number) => origin[1] + north + first + gap * k;
    const E = (k: number) => origin[0] + 624 + first + gap * k;
    const pts = (xs: number[], y: number) => xs.map((x) => o([x, y]));
    const ptsY = (ys: number[], x: number) => ys.map((y) => o([x, y]));
    dimString(d, v, pts([0, 24, 216, 264, 272, 376, 384, 624], 0), "x", S(0));
    dimString(d, v, pts([0, 624], 0), "x", S(1));
    dimString(d, v, ptsY([0, 288, 296, 528], 0), "y", Wx(0));
    dimString(d, v, ptsY([0, 528], 0), "y", Wx(1));
    dimString(d, v, pts([0, 384, 616, 624], 528), "x", N(0));
    dimString(d, v, ptsY([0, 192, 528, 672], 624), "y", E(0));
    dimString(d, v, ptsY([0, 672], 624), "y", E(1));
  });

  frame(d, "S-101", (dd, sheet) => {
    const vpW = 22.0;
    const vpH = 20.6;
    viewport(dd, sheet, {
      corner: [AREA.left, AREA.top - vpH],
      size: [vpW, vpH],
      center: o([250, 330]),
      v,
      id: "vp-S-101",
      number: "1",
      sheetNo: "S-101",
      title: "FOUNDATION PLAN",
      titleAt: [AREA.left + 0.2, AREA.top - vpH - 0.5],
    });
    dd.layer(LAYERS.text, {}, () =>
      dd.insert("NORTH ARROW", [AREA.left + vpW - 1.0, AREA.top - vpH - 0.55]),
    );
    const x = AREA.left + vpW + 0.4;
    let y = AREA.top - 0.1;
    y = noteColumn(dd, [x, y], AREA.right - x, "FOUNDATION NOTES", FND_NOTES);
    y -= 0.3;
    legend(dd, [x, y], AREA.right - x);
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
  row('8" CMU STEM WALL', (c) =>
    d.layer(LAYERS.fndn, {}, () => d.rect([c[0] - 0.25, c[1] - 0.04], 0.5, 0.08)),
  );
  row("FOOTING OR THICKENED SLAB EDGE", (c) =>
    d.layer(LAYERS.ftng, {}, () => d.line([c[0] - 0.25, c[1]], [c[0] + 0.25, c[1]])),
  );
  row("#5 VERTICAL BAR IN GROUTED CELL", (c) =>
    d.layer(SL.rebar, {}, () => d.insert("S-VERT BAR", c)),
  );
  row("FLOOD VENT", (c) => d.layer(LAYERS.strAnno, {}, () => d.insert("FLOOD VENT", c)));
  row("SECTION, DETAIL / SHEET", (c) =>
    d.layer(LAYERS.strAnno, {}, () =>
      d.insert("SECTION MARK", [c[0] - 0.08, c[1]], {
        scale: 0.7,
        attributes: { SECT: "1", SHEET: "S-501" },
      }),
    ),
  );
  return y;
}

export const SHEETS: Record<string, SheetDraw> = {
  "S-101": (d) => foundationPlan(d),
  "S-102": (d) => framingSheet(d),
  "S-501": (d) => detailsSheet(d),
};

export type { View };
void width;
