// M-101: the mechanical plans of both floors at 3/16" = 1'-0" over a screened base plan, with the
// equipment, fan and room airflow schedules and the notes, all from `mep-hvac.ts`.
import type { Point } from "../../../src/index.ts";
import { ATTIC_ACCESS, L1, L2, type Level, type Rect } from "../model/house.ts";
import { CRITERIA } from "../project.ts";
import { frame } from "../lib/frame.ts";
import { arrowhead } from "../../lib/drafting.ts";
import {
  AREA,
  ftIn,
  H,
  LAYERS,
  leaderNote,
  noteColumn,
  put,
  table,
  view,
  viewport,
  width,
  type D,
  type View,
} from "../lib/kit.ts";
import { BASE_LAYERS, drawPlan } from "../lib/plan.ts";
import { circuit, type Floor } from "./mep-power.ts";
import {
  ATTIC,
  center,
  DRAINS,
  dryerLength,
  EQUIP,
  EXHAUSTS,
  LINESETS,
  passageLength,
  project,
  roomAir,
  SYSTEMS,
  THERMOSTATS,
  trunkAir,
  type DuctSystem,
} from "./mep-hvac.ts";

export const M_ORIGIN: Record<Floor, Point> = { L1: [320000, 0], L2: [335000, 0] };
const LEVELS: Record<Floor, Level> = { L1, L2 };

/** Layers this sheet adds: the kit has none for HVAC. */
const ML = {
  eqpm: "M-HVAC-EQPM",
  sup: "M-HVAC-SDFF",
  ret: "M-HVAC-RDFF",
  exh: "M-EXHS-DUCT",
  refg: "M-REFG-PIPE",
  cond: "M-COND-PIPE",
  attic: "M-HVAC-ATTC",
  anno: "M-ANNO-TEXT",
} as const;

function defineMechLayers(d: D): void {
  d.layer(ML.eqpm, { color: 7, lineweight: 0.5 });
  d.layer(ML.sup, { color: 7, lineweight: 0.35 });
  d.layer(ML.ret, { color: 7, lineweight: 0.35, linetype: "HIDDEN" });
  d.layer(ML.exh, { color: 7, lineweight: 0.25 });
  d.layer(ML.refg, { color: 7, lineweight: 0.18, linetype: "DASHED" });
  d.layer(ML.cond, { color: 7, lineweight: 0.18, linetype: "PHANTOM" });
  d.layer(ML.attic, { color: 7, lineweight: 0.25, linetype: "DASHED" });
  d.layer(ML.anno, { color: 7, lineweight: 0.25 });
}

// --- Symbols, drawn at a size so the plan (true size) and the legend (paper) share them. --------

/** A 4-way ceiling supply diffuser: its face with both diagonals. */
function supplySym(d: D, c: Point, s: number): void {
  d.rect([c[0] - s / 2, c[1] - s / 2], s, s);
  d.line([c[0] - s / 2, c[1] - s / 2], [c[0] + s / 2, c[1] + s / 2]);
  d.line([c[0] - s / 2, c[1] + s / 2], [c[0] + s / 2, c[1] - s / 2]);
}
/** A return or transfer grille: its face with one diagonal. */
function returnSym(d: D, c: Point, s: number): void {
  d.rect([c[0] - s / 2, c[1] - s / 2], s, s);
  d.line([c[0] - s / 2, c[1] - s / 2], [c[0] + s / 2, c[1] + s / 2]);
}
/** A thermostat: a circle with a T. */
function tstatSym(d: D, c: Point, r: number): void {
  d.circle(c, r);
  put(d, c, "T", r * 1.1, { align: "center", valign: "middle" });
}
/** A termination: a wall cap as a box on the wall, a roof cap as a circle. */
function capSym(d: D, c: Point, s: number, kind: "WALL" | "ROOF"): void {
  if (kind === "ROOF") {
    d.circle(c, s / 2);
    d.circle(c, s / 4);
  } else {
    d.rect([c[0] - s / 2, c[1] - s / 2], s, s);
    d.line([c[0] - s / 2, c[1]], [c[0] + s / 2, c[1]]);
  }
}

/** A straight duct between two points as two lines `w` apart. */
function doubleLine(d: D, a: Point, b: Point, w: number, extend = 0): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return;
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  const a2: Point = [a[0] - ux * extend, a[1] - uy * extend];
  const b2: Point = [b[0] + ux * extend, b[1] + uy * extend];
  for (const k of [-1, 1]) {
    const nx = -uy * (w / 2) * k;
    const ny = ux * (w / 2) * k;
    d.line([a2[0] + nx, a2[1] + ny], [b2[0] + nx, b2[1] + ny]);
  }
}

// --- The plans. --------------------------------------------------------------------------------

/** Where a room's name sits when the default spot is taken by ducts. */
const ROOM_NAME_AT: Record<string, Point> = {
  "L1/FOYER": [349, 230],
  "L1/KITCHEN": [258, 505],
  "L1/LAUNDRY": [70, 320],
  "L2/BATH 2": [150, 220],
  "L2/LOFT": [300, 505],
  "L2/HALL": [300, 90],
  "L2/OWNER'S CLOSET": [450, 250],
};

function mechPlan(d: D, v: View, floor: Floor): void {
  const origin = M_ORIGIN[floor];
  const level = LEVELS[floor];
  const o = (p: Point): Point => [origin[0] + p[0], origin[1] + p[1]];
  const small = v.p(H.small);
  const note = v.p(H.note);
  drawPlan(d, origin, level, BASE_LAYERS(LAYERS.base), floor);
  d.layer(LAYERS.base, {}, () => {
    for (const r of level.rooms) {
      const [x0, y0, x1] = r.rect;
      const at = ROOM_NAME_AT[`${floor}/${r.name}`] ?? [(x0 + x1) / 2, y0 + v.p(0.12)];
      if (x1 - x0 < v.p(width(r.name, H.note) + 0.1)) continue;
      put(d, o(at), r.name, note, { align: "center" });
    }
  });
  const label = (
    at: Point,
    lines: string[],
    align: "left" | "right" | "center" = "left",
    h = small,
  ) =>
    d.layer(ML.anno, {}, () =>
      lines.forEach((t, k) => put(d, o([at[0], at[1] - k * h * 1.7]), t, h, { align })),
    );

  for (const s of SYSTEMS.filter((x) => x.floor === floor)) ductSystem(d, v, s, o);
  equipment(d, v, floor, o, label);
  exhausts(d, v, floor, o, label);

  // Refrigerant line sets and condensate drains.
  d.layer(ML.refg, {}, () => {
    for (const l of LINESETS.filter((x) => x.floor === floor)) d.polyline(l.path.map(o));
  });
  d.layer(ML.cond, {}, () => {
    for (const r of DRAINS.filter((x) => x.floor === floor)) {
      d.polyline(r.path.map(o));
      const end = r.path.at(-1)!;
      const prev = r.path.at(-2)!;
      arrowhead(d, o(end), o(prev), v.p(0.07));
    }
  });
  // Thermostats.
  d.layer(ML.eqpm, {}, () => {
    for (const t of THERMOSTATS.filter((x) => x.floor === floor)) {
      tstatSym(d, o(t.at), v.p(0.06));
      d.layer(ML.anno, {}, () =>
        put(d, o([t.at[0] - v.p(0.1), t.at[1]]), t.tag, small, {
          align: "right",
          valign: "middle",
        }),
      );
    }
  });
}

/** A system's trunks, run-outs, outlets, returns and jump ducts. */
function ductSystem(d: D, v: View, s: DuctSystem, o: (p: Point) => Point): void {
  const small = v.p(H.small);
  const air = new Map(roomAir(s).map((r) => [r.room, r]));
  const trunks = trunkAir(s);
  const face = 12;
  d.layer(ML.sup, {}, () => {
    for (const t of trunks) {
      const a = s.nodes[t.from]!;
      const b = s.nodes[t.to]!;
      doubleLine(d, o(a), o(b), t.width, t.from === "R" ? 0 : t.width / 2);
    }
    // Each trunk's size, beside it, along it.
    for (const t of trunks) {
      const a = s.nodes[t.from]!;
      const b = s.nodes[t.to]!;
      const horizontal = Math.abs(b[1] - a[1]) < 1;
      const mid: Point = TRUNK_LABEL_AT[`${s.unit}/${t.from}-${t.to}`] ?? [
        (a[0] + b[0]) / 2,
        (a[1] + b[1]) / 2,
      ];
      const off = t.width / 2 + v.p(0.04);
      d.layer(ML.anno, {}, () =>
        horizontal
          ? put(d, o([mid[0], mid[1] + off]), `${t.width}x${s.depth}`, small, { align: "center" })
          : put(d, o([mid[0] - off, mid[1]]), `${t.width}x${s.depth}`, small, {
              align: "center",
              rotation: 90,
            }),
      );
    }
    // Run-outs and outlets.
    for (const out of s.outlets) {
      const a = s.nodes[out.from[0]]!;
      const b = s.nodes[out.from[1]]!;
      const take = project(out.at, a, b);
      const len = Math.hypot(out.at[0] - take[0], out.at[1] - take[1]);
      if (len > face / 2) {
        const ux = (out.at[0] - take[0]) / len;
        const uy = (out.at[1] - take[1]) / len;
        // Stop at the face's edge along the run's direction.
        const k = face / 2 / Math.max(Math.abs(ux), Math.abs(uy));
        d.line(o(take), o([out.at[0] - ux * k, out.at[1] - uy * k]));
      }
      supplySym(d, o(out.at), face);
      const r = air.get(out.room)!;
      const at = OUTLET_TAG_AT[`${s.floor}/${out.at[0]},${out.at[1]}`] ?? [
        out.at[0] + face / 2 + v.p(0.03),
        out.at[1] + face / 2 + v.p(0.02),
      ];
      d.layer(ML.anno, {}, () =>
        put(d, o(at), `${r.neck}"Ø/${r.each}`, small, {
          align: at[0] < out.at[0] ? "right" : "left",
        }),
      );
    }
  });
  // Returns: the grille, and its duct to the unit, dashed.
  for (const r of s.returns) {
    d.layer(ML.ret, {}, () => {
      for (let k = 1; k < r.path.length; k++)
        doubleLine(d, o(r.path[k - 1]!), o(r.path[k]!), r.diameter, k === 1 ? 0 : r.diameter / 2);
    });
    d.layer(ML.sup, {}, () => returnSym(d, o(r.at), r.face));
  }
  // Jump ducts: a grille each side, a dashed line between.
  for (const [a, b] of s.jumps) {
    d.layer(ML.sup, {}, () => {
      returnSym(d, o(a), 10);
      returnSym(d, o(b), 10);
    });
    d.layer(ML.ret, {}, () =>
      d.line(
        o([a[0] + Math.sign(b[0] - a[0]) * 5, a[1]]),
        o([b[0] - Math.sign(b[0] - a[0]) * 5, b[1]]),
      ),
    );
    d.layer(ML.anno, {}, () =>
      put(d, o([(a[0] + b[0]) / 2, a[1] + 6 + v.p(0.03)]), "J", small, { align: "center" }),
    );
  }
}

/** Where an outlet's tag goes, by floor and outlet position, when the default spot is taken. */
const OUTLET_TAG_AT: Record<string, Point> = {
  "L1/349,140": [339, 152],
  "L1/596,330": [588, 350],
  "L1/560,48": [552, 64],
  "L1/45,452": [36, 466],
  "L2/40,160": [32, 176],
  "L2/40,400": [32, 416],
  "L2/596,448": [588, 466],
  "L2/596,340": [588, 358],
  "L2/562,218": [554, 232],
  "L2/562,112": [554, 128],
};
/** Where a trunk's size goes, by unit and edge, when its middle is taken. */
const TRUNK_LABEL_AT: Record<string, Point> = {
  "AHU-1/R-a": [201, 350],
  "AHU-2/R-m": [333, 260],
};

type Label = (at: Point, lines: string[], align?: "left" | "right" | "center", h?: number) => void;

/** The air handlers, the heat pumps, the attic passage and service space, and their notes. */
function equipment(d: D, v: View, floor: Floor, o: (p: Point) => Point, label: Label): void {
  const box = (r: Rect, linetype?: string) =>
    d.rect(o([r[0], r[1]]), r[2] - r[0], r[3] - r[1], linetype ? { linetype } : {});
  const tag = (r: Rect, t: string) =>
    d.layer(ML.anno, {}, () =>
      put(d, o(center(r)), t, v.p(H.small), { align: "center", valign: "middle" }),
    );
  const dfe = CRITERIA.flood.dfe.toFixed(2);
  if (floor === "L1") {
    d.layer(ML.eqpm, {}, () => {
      box(EQUIP.ahu1);
      box(EQUIP.pad);
      box(EQUIP.hp1);
      box(EQUIP.hp2);
      for (const r of [EQUIP.hp1, EQUIP.hp2]) d.circle(o(center(r)), 14);
    });
    tag(EQUIP.ahu1, "AHU-1");
    d.layer(ML.anno, {}, () => {
      for (const [r, t] of [
        [EQUIP.hp1, "HP-1"],
        [EQUIP.hp2, "HP-2"],
      ] as const)
        put(d, o(center(r)), t, v.p(H.small), { align: "center", valign: "middle" });
    });
    label([632, 180], ["HP-1, HP-2 ON", "CONC. PAD, TOP", `EL. ${dfe}' MIN.`]);
    d.layer(ML.anno, {}, () => {
      leaderNote(d, v, o([196, 266]), o([150, 200]), [
        "AHU-1 ON STAND, BASE",
        `ABOVE D.F.E. ${dfe}'`,
        "STEEL BOLLARD (NOTE 5)",
      ]);
      leaderNote(d, v, o([201, 284]), o([110, 120]), [
        "26 GA. STEEL SUPPLY",
        "PLENUM AND RETURN,",
        "NO OPENINGS IN GARAGE",
        "(FBC-R R302.5.2)",
      ]);
      leaderNote(d, v, o([254, -6]), o([150, -14]), [
        "AHU-1 COND. + WH-1 PAN",
        'DRAIN, 6" TO 24" ABOVE',
        "GRADE (NOTE 7)",
      ]);
      put(d, o([430, 308]), "REFRIG. LINE SET TO HP-1", v.p(H.small));
      leaderNote(d, v, o([396, 330]), o([430, 300]), ["RA-1, 24X24 FILTER", 'GRILLE, 18"Ø RA']);
    });
  } else {
    d.layer(ML.eqpm, {}, () => box(EQUIP.ahu2));
    tag(EQUIP.ahu2, "AHU-2");
    // The passageway and the service space, on the attic floor.
    d.layer(ML.attic, {}, () => {
      const outline: Point[] = [
        [ATTIC.passage[0]![0], ATTIC.passage[0]![1]],
        [ATTIC.passage[0]![2], ATTIC.passage[0]![1]],
        [ATTIC.passage[1]![0], ATTIC.passage[1]![1]],
        [ATTIC.service[0], ATTIC.passage[1]![1]],
        [ATTIC.service[0], ATTIC.service[1]],
        [ATTIC.service[2], ATTIC.service[1]],
        [ATTIC.service[2], ATTIC.service[3]],
        [ATTIC.service[0], ATTIC.service[3]],
        [ATTIC.service[0], ATTIC.passage[1]![3]],
        [ATTIC.passage[0]![0], ATTIC.passage[0]![3]],
      ];
      d.polyline(outline.map(o), true);
    });
    d.layer(ML.eqpm, {}, () => {
      const [a0, b0, a1, b1] = ATTIC_ACCESS;
      d.rect(o([a0, b0]), a1 - a0, b1 - b0);
    });
    const len = passageLength();
    if (len > 240) throw new Error(`The attic passageway is ${ftIn(len)}, past 20 ft`);
    d.layer(ML.anno, {}, () => {
      leaderNote(d, v, o([240, 40]), o([150, 40]), [
        'ATTIC ACCESS, 30"X54"',
        "PULL-DOWN STAIR (A-102)",
      ]);
      leaderNote(d, v, o([251, 120]), o([160, 130]), [
        '24" FLOORED PASSAGE,',
        `${ftIn(len)} LONG (20' MAX.)`,
      ]);
      leaderNote(d, v, o([307, 165]), o([250, 205]), ['30"X30" LEVEL', "SERVICE SPACE"]);
      leaderNote(d, v, o([344, 180]), o([396, 205]), [
        "AHU-2 ON",
        "PLATFORM, AUX.",
        "PAN + FLOAT SW.",
        "(NOTE 6)",
      ]);
      leaderNote(d, v, o([364, 114]), o([396, 128]), ["RA-2, 24X24", "FILTER GRILLE,", '18"Ø RA']);
    });
    label([606, 300], ["LINE SET +", "COND. IN EXT.", "WALL CHASE"], "right");
  }
}

/** The exhaust fans, the hood and the dryer, their ducts and terminations. */
function exhausts(d: D, v: View, floor: Floor, o: (p: Point) => Point, label: Label): void {
  for (const x of EXHAUSTS.filter((e) => e.floor === floor)) {
    d.layer(ML.exh, {}, () => {
      if (x.tag.startsWith("EF")) d.insert("E-EXHAUST", o(x.at), { scale: v.p(1) });
      else d.rect(o([x.at[0] - 6, x.at[1] - 6]), 12, 12);
      const pts = [...x.route];
      // Start the duct at the fan's edge.
      const a = pts[0]!;
      const b = pts[1]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const k = Math.min(v.p(0.09), len / 2);
      pts[0] = [a[0] + ((b[0] - a[0]) / len) * k, a[1] + ((b[1] - a[1]) / len) * k];
      d.polyline(pts.map(o));
      capSym(d, o(x.route.at(-1)!), 8, x.cap);
    });
    const at = EXH_TAG_AT[x.tag] ?? [x.at[0] + v.p(0.12), x.at[1] - v.p(0.2)];
    label(at, [x.tag]);
  }
}
const EXH_TAG_AT: Record<string, Point> = {
  "EF-1": [30, 505],
  "KH-1": [158, 380],
  "DE-1": [16, 393],
  "EF-2": [78, 300],
  "EF-3": [552, 84],
  "EF-4": [574, 150],
};

// --- Paper space. ------------------------------------------------------------------------------

function legend(d: D, at: Point, w: number): number {
  let y = at[1];
  d.layer(LAYERS.text, {}, () => {
    put(d, [at[0], y], "MECHANICAL LEGEND", H.label, { valign: "top" });
    y -= H.label + 0.06;
    d.line([at[0], y], [at[0] + w, y], { lineweight: 0.35 });
    y -= 0.22;
  });
  const rows: [string, string, (a: Point, b: Point) => void][] = [
    [
      "CEILING SUPPLY DIFFUSER, 4-WAY",
      ML.sup,
      (a, b) => supplySym(d, [(a[0] + b[0]) / 2, a[1]], 0.16),
    ],
    [
      'TAG: NECK SIZE / CFM, E.G. 8"Ø/150',
      ML.anno,
      (a, b) =>
        put(d, [(a[0] + b[0]) / 2, a[1]], '8"Ø/150', H.small, {
          align: "center",
          valign: "middle",
        }),
    ],
    [
      "RETURN GRILLE / JUMP DUCT GRILLE (J)",
      ML.sup,
      (a, b) => returnSym(d, [(a[0] + b[0]) / 2, a[1]], 0.16),
    ],
    ["SUPPLY TRUNK, RECT., SIZE W X D", ML.sup, (a, b) => doubleLine(d, a, b, 0.12)],
    ["FLEX RUN-OUT, R-6 (R-8 IN ATTIC)", ML.sup, (a, b) => d.line(a, b)],
    ["RETURN DUCT", ML.ret, (a, b) => doubleLine(d, a, b, 0.12)],
    [
      "EXHAUST FAN / DUCT",
      ML.exh,
      (a, b) => {
        d.insert("E-EXHAUST", [a[0] + 0.1, a[1]]);
        d.line([a[0] + 0.2, a[1]], b);
      },
    ],
    [
      "WALL CAP / ROOF CAP, BACKDRAFT DAMPER",
      ML.exh,
      (a, b) => {
        capSym(d, [a[0] + 0.12, a[1]], 0.12, "WALL");
        capSym(d, [b[0] - 0.12, a[1]], 0.12, "ROOF");
      },
    ],
    ["THERMOSTAT", ML.eqpm, (a, b) => tstatSym(d, [(a[0] + b[0]) / 2, a[1]], 0.06)],
    ["REFRIGERANT LINE SET", ML.refg, (a, b) => d.line(a, b)],
    ["CONDENSATE / PAN DRAIN", ML.cond, (a, b) => d.line(a, b)],
    [
      "ATTIC PASSAGEWAY / SERVICE SPACE",
      ML.attic,
      (a, b) => d.rect([a[0], a[1] - 0.06], b[0] - a[0], 0.12),
    ],
  ];
  for (const [text, layer, draw] of rows) {
    d.layer(layer, {}, () => draw([at[0] + 0.05, y], [at[0] + 0.6, y]));
    d.layer(LAYERS.text, {}, () => put(d, [at[0] + 0.75, y], text, H.note, { valign: "middle" }));
    y -= 0.28;
  }
  return y;
}

function equipmentSchedule(d: D, at: Point): number {
  const row = (
    tag: string,
    type: string,
    where: string,
    cfm: string,
    cool: string,
    heat: string,
    eff: string,
    key: string,
    mca: number,
    remarks: string,
  ) => {
    const c = circuit(key);
    return [
      tag,
      type,
      where,
      "3.0",
      cfm,
      cool,
      heat,
      eff,
      `240V/1PH, MCA ${mca}, MOCP ${c.amps}`,
      c.label,
      remarks,
    ];
  };
  const dfe = `${CRITERIA.flood.dfe.toFixed(2)}'`;
  const rows = [
    row(
      "AHU-1",
      "AIR HANDLER, VAR. SPEED, UPFLOW",
      `GARAGE, ON STAND ABOVE ${dfe}`,
      "1,200",
      "--",
      "5 KW STRIP",
      "--",
      "AHU1",
      30,
      "26 GA. STEEL IN GARAGE; FILTER AT RA-1",
    ),
    row(
      "HP-1",
      "SPLIT HEAT PUMP, OUTDOOR",
      `EAST SIDE, PAD AT ${dfe} MIN.`,
      "--",
      "34,000",
      "33,000 @ 47F",
      "15.2 / 7.8",
      "HP1",
      18,
      "AHRI MATCHED W/ AHU-1; LOCKING CAPS",
    ),
    row(
      "AHU-2",
      "AIR HANDLER, VAR. SPEED, HORIZ.",
      "ATTIC, OVER L2 LANDING",
      "1,200",
      "--",
      "5 KW STRIP",
      "--",
      "AHU2",
      30,
      "AUX. PAN + FLOAT SWITCH; FILTER AT RA-2",
    ),
    row(
      "HP-2",
      "SPLIT HEAT PUMP, OUTDOOR",
      `EAST SIDE, PAD AT ${dfe} MIN.`,
      "--",
      "34,000",
      "33,000 @ 47F",
      "15.2 / 7.8",
      "HP2",
      18,
      "AHRI MATCHED W/ AHU-2; LOCKING CAPS",
    ),
  ];
  return table(
    d,
    at,
    "MECHANICAL EQUIPMENT SCHEDULE",
    [
      { name: "TAG", width: 0.55 },
      { name: "TYPE", width: 2.85 },
      { name: "LOCATION", width: 2.75 },
      { name: "TONS", width: 0.5, align: "center" },
      { name: "CFM", width: 0.55, align: "right" },
      { name: "COOL BTUH", width: 0.95, align: "right" },
      { name: "HEAT", width: 1.25, align: "center" },
      { name: "SEER2/HSPF2", width: 1.15, align: "center" },
      { name: "ELECTRICAL", width: 2.4 },
      { name: "CKT", width: 0.75, align: "center" },
      { name: "REMARKS", width: 3.5 },
    ],
    rows,
    { height: H.note, rowHeight: 0.22 },
  );
}

function fanSchedule(d: D, at: Point): number {
  const rows = EXHAUSTS.map((x) => [
    x.tag,
    x.serves,
    x.cfm ? String(x.cfm) : "--",
    x.duct,
    x.capNote,
    circuit(x.ckt).label,
  ]);
  const y = table(
    d,
    at,
    "EXHAUST SCHEDULE",
    [
      { name: "TAG", width: 0.55 },
      { name: "SERVES", width: 1.85 },
      { name: "CFM", width: 0.5, align: "right" },
      { name: "DUCT", width: 1.45 },
      { name: "TERMINATION, BACKDRAFT DAMPER", width: 2.65 },
      { name: "CKT", width: 0.7, align: "center" },
    ],
    rows,
    { height: H.note, rowHeight: 0.22 },
  );
  const dl = dryerLength();
  let yy = y - 0.2;
  d.layer(LAYERS.text, {}, () => {
    for (const line of [
      `DE-1: ${dl.run.toFixed(1)} FT + ${dl.elbows} ELBOW X 5 FT = ${dl.total.toFixed(1)} FT DEVELOPED, 35 FT MAX. (M1502.4.5.1).`,
      "CFM AT 0.25 IN. W.C.; BATH 50 CFM MIN., KITCHEN 100 MIN. (M1505).",
    ]) {
      put(d, [at[0], yy], line, H.note);
      yy -= 0.19;
    }
  });
  return yy;
}

function airSchedule(d: D, at: Point): number {
  const rows: string[][] = [];
  for (const s of SYSTEMS) {
    const rs = roomAir(s);
    for (const r of rs)
      rows.push([r.room, s.unit, String(r.outlets), `${r.neck}"Ø`, String(r.cfm)]);
    rows.push([
      `TOTAL ${s.unit} SUPPLY`,
      "",
      String(rs.reduce((t, r) => t + r.outlets, 0)),
      "",
      rs.reduce((t, r) => t + r.cfm, 0).toLocaleString("en-US"),
    ]);
    for (const g of s.returns)
      rows.push([
        `${g.tag} RETURN, ${g.room}`,
        s.unit,
        "1",
        `${g.diameter}"Ø`,
        s.cfm.toLocaleString("en-US"),
      ]);
  }
  return table(
    d,
    at,
    "SUPPLY AND RETURN AIR BY ROOM",
    [
      { name: "ROOM", width: 2.4 },
      { name: "UNIT", width: 0.7, align: "center" },
      { name: "OUTLETS", width: 0.75, align: "center" },
      { name: "NECK", width: 0.6, align: "center" },
      { name: "CFM", width: 0.65, align: "right" },
    ],
    rows,
    { height: H.note, rowHeight: 0.19 },
  );
}

const NOTES = (): string[] => {
  const len = passageLength();
  return [
    "CODES: 2023 FBC-R CHAPTERS 12 THROUGH 24 (MECHANICAL) GOVERN THIS ONE-FAMILY DWELLING, WITH THE 2023 FBC, ENERGY CONSERVATION (RESIDENTIAL). SECTIONS CITED ARE FBC-R UNLESS NOTED FBC-EC.",
    "SIZING: LOADS BY ACCA MANUAL J, EQUIPMENT BY MANUAL S (M1401.3, FBC-EC R403.7), DUCTS BY MANUAL D (M1601.1). THE REPORTS ARE SUBMITTED WITH THE PERMIT AND GOVERN; ROOM AIRFLOWS SHOWN ARE DESIGN VALUES TO BE BALANCED TO THEM.",
    "DUCTS: SHEET METAL TRUNKS AND LISTED FLEX (M1601.1.1), SUPPORTED PER M1601.4.4, SEALED WITH MASTIC OR LISTED TAPE (M1601.4.1, FBC-EC R403.3.2). INSULATED R-8 IN THE ATTIC, R-6 ELSEWHERE OUTSIDE THE THERMAL ENVELOPE (FBC-EC R403.3.1). TESTED FOR TOTAL LEAKAGE PER FBC-EC R403.3.3.",
    'FIRST FLOOR DUCTS RUN IN THE FLOOR TRUSS SPACE. TRUSS MANUFACTURER TO PROVIDE A 24" X 12" CHASE ALONG EACH TRUNK; WHERE A TRUNK MEETS A BEARING LINE OR BEAM, DROP IT INTO A FRAMED SOFFIT, LOCATED ON THIS SHEET AND FRAMED BY THE TRUSS MANUFACTURER\'S CHASE.',
    `GARAGE (R302.5.2): DUCTS IN THE GARAGE AND DUCTS THROUGH ITS WALLS OR CEILING ARE 26 GA. SHEET STEEL MIN. WITH NO OPENINGS INTO THE GARAGE. NO SUPPLY OR RETURN OUTLET IN THE GARAGE. AHU-1'S FILTER IS AT RA-1, AND ITS CABINET AND RETURN ARE SEALED. AHU-1 STAND BASE ABOVE THE D.F.E. ${CRITERIA.flood.dfe.toFixed(2)}' NAVD (R322.1.6); 4" STEEL PIPE BOLLARD IN FRONT OF AHU-1 AND WH-1 (M1307.3.1).`,
    `ATTIC UNIT (M1305.1.3): AHU-2 IS REACHED THROUGH THE 30" X 54" PULL-DOWN STAIR (A-102), LARGE ENOUGH TO REMOVE IT, BY A PASSAGEWAY ${ftIn(len)} LONG (20 FT MAX.), 30" HIGH MIN., WITH SOLID FLOORING 24" WIDE, TO A LEVEL 30" X 30" SERVICE SPACE AT ITS SERVICE SIDE. LIGHT SWITCHED AT THE ACCESS AND A RECEPTACLE AT THE UNIT ON E-101 (M1305.1.3.1). PLATFORM AND UNIT LOAD BY THE TRUSS ENGINEER.`,
    'CONDENSATE (M1411.3): 3/4" PVC SCH. 40, TRAPPED, 1/8" PER FT. MIN. AHU-1\'S DRAIN RUNS BESIDE THE WH-1 PAN DRAIN THROUGH THE FRONT WALL, ENDING 6" TO 24" ABOVE GRADE ON SPLASH BLOCKS. AHU-2\'S RUNS WITH ITS LINE SET DOWN THE EAST WALL TO GRADE AT THE PAD. AHU-2 HAS AN AUXILIARY PAN WITH A WATER-LEVEL SWITCH THAT SHUTS THE UNIT OFF (M1411.3.1).',
    "EXHAUST (M1501, M1504): EVERY EXHAUST DISCHARGES OUTDOORS, NEVER INTO THE ATTIC, SOFFIT OR A CRAWL SPACE, THROUGH A CAP WITH A BACKDRAFT DAMPER 3 FT MIN. FROM OPERABLE OPENINGS AND PROPERTY LINES AND 10 FT FROM MECHANICAL AIR INTAKES (R303.5).",
    "RANGE HOOD KH-1 (M1503): SMOOTH, AIRTIGHT SINGLE-WALL GALVANIZED STEEL DUCT WITH A BACKDRAFT DAMPER, TO THE NORTH WALL. 300 CFM, UNDER 400 CFM, SO NO MAKEUP AIR IS REQUIRED.",
    'DRYER DE-1 (M1502): 4" RIGID METAL DUCT, 0.016" MIN., SMOOTH INSIDE, JOINTS LAPPED IN THE DIRECTION OF FLOW, NO SCREWS THROUGH IT. WALL CAP WITH A BACKDRAFT DAMPER AND NO SCREEN, 3 FT FROM OPENINGS (M1502.3). LENGTH LABEL WITHIN 6 FT OF THE CONNECTION (M1502.4.6).',
    "REFRIGERANT: LINE SETS INSULATED AND PROTECTED FROM SUN AND DAMAGE OUTDOORS (M1411.6), LOCKING TAMPER-RESISTANT CAPS ON OUTDOOR ACCESS PORTS (M1411.8). HP-1 AND HP-2 ANCHORED TO THE PAD FOR THE WIND DESIGN ON G-001; PAD TOP AT OR ABOVE THE D.F.E. (R322.1.6).",
    "VENTILATION: IF THE BLOWER-DOOR TEST (FBC-EC R402.4.1.2) IS UNDER 5 ACH50, ADD WHOLE-HOUSE MECHANICAL VENTILATION PER R303.4 AND M1505.4 BEFORE FINAL.",
    'CONTROLS: PROGRAMMABLE THERMOSTATS T-1 AND T-2 (FBC-EC R403.1.1) THAT KEEP STRIP HEAT OFF WHILE THE HEAT PUMP CAN MEET THE LOAD (R403.1.2). DOOR UNDERCUTS 3/4" TO BATHS AND CLOSETS; JUMP DUCTS (J) FROM THE BEDROOMS AND THE STUDY.',
  ];
};

function m101(d: D): void {
  defineMechLayers(d);
  const v = view(d, 64);
  mechPlan(d, v, "L1");
  mechPlan(d, v, "L2");
  frame(d, "M-101", (dd, sheet) => {
    const vpW = 12.0;
    const vpH = 11.8;
    const top = AREA.top - 0.1;
    const vpY = top - vpH;
    const c: Point = [300, 318];
    const vps: [Floor, number, string][] = [
      ["L1", AREA.left + 0.1, "FIRST FLOOR MECHANICAL PLAN"],
      ["L2", AREA.left + 0.1 + vpW + 0.25, "SECOND FLOOR AND ATTIC MECHANICAL PLAN"],
    ];
    vps.forEach(([floor, x, title], k) => {
      viewport(dd, sheet, {
        corner: [x, vpY],
        size: [vpW, vpH],
        center: [M_ORIGIN[floor][0] + c[0], M_ORIGIN[floor][1] + c[1]],
        v,
        id: `vp-M-101-${floor}`,
        number: String(k + 1),
        sheetNo: "M-101",
        title,
        titleAt: [x + 0.1, vpY - 0.45],
      });
      dd.layer(LAYERS.text, {}, () =>
        dd.insert("NORTH ARROW", [x + vpW - 0.6, vpY - 0.5], { scale: 0.8 }),
      );
    });
    const belowTop = vpY - 1.0;
    const lx = AREA.left + 0.1;
    legend(dd, [lx, belowTop], 4.0);
    const tx = lx + 4.4;
    const eq = equipmentSchedule(dd, [tx, belowTop]);
    const fy = fanSchedule(dd, [tx, eq - 0.35]);
    void fy;
    airSchedule(dd, [tx + 8.1, eq - 0.35]);
    const nx = AREA.left + 0.1 + 2 * vpW + 0.25 + 0.35;
    noteColumn(dd, [nx, top], AREA.right - nx, "MECHANICAL NOTES", NOTES());
  });
}

export const SHEETS_M = { "M-101": m101 };
