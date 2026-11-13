// P-101: the plumbing riser diagrams, drawn on the layout, not to scale. The water diagram is
// an isometric of the pipes at the fixtures' real places in the plans; the DWV diagram is an
// elevation of the stacks along the house, west to east. The fixture schedule adds up the
// drainage and water supply fixture units of the same fixtures.
import type { Point } from "../../../src/index.ts";
import { HEIGHTS } from "../model/house.ts";
import { HOUSE_AT, LOT } from "./site.ts";
import { frame } from "../lib/frame.ts";
import { arrowhead, earth, hatch, stipple } from "../../lib/drafting.ts";
import { CRITERIA } from "../project.ts";
import {
  AREA,
  dimString,
  H,
  LAYERS,
  leaderNote,
  noteColumn,
  put,
  table,
  view,
  viewport,
  viewTitle,
  width,
  type D,
  type View,
} from "../lib/kit.ts";
import { circuit } from "./mep-power.ts";

/** The water heater detail's origin in model space. */
const WH_ORIGIN: Point = [390000, 0];

/** Layers this sheet adds, for pipes the kit has none for. */
const HOT = "P-DOMW-HOTW";
const VENT = "P-SANR-VENT";

interface Fixture {
  readonly tag: string;
  readonly name: string;
  readonly room: string;
  readonly floor: "L1" | "L2";
  /** Where its supply and waste connect, in building inches, as `lib/plan.ts` draws it. */
  readonly at: Point;
  /** Height of the supply stop above its floor. */
  readonly z: number;
  readonly hot: boolean;
  readonly trap: string;
  /** Drainage fixture units, FBC-R Table P3004.1. */
  readonly dfu: number;
  /** Water supply fixture units, FBC-R Table P2903.6: total, cold, hot. */
  readonly wsfu: readonly [number, number, number];
  /** The stack its waste joins: 1 west, 2 east, or 0 for the building drain under the slab. */
  readonly stack: 0 | 1 | 2;
  /** The size of the supply branch. */
  readonly supply: string;
}

/** The fixtures, at the places `lib/plan.ts` draws them. */
export const FIXTURES: readonly Fixture[] = [
  {
    tag: "KS",
    name: "KITCHEN SINK W/ DISPOSAL",
    room: "KITCHEN",
    floor: "L1",
    at: [252, 508],
    z: 20,
    hot: true,
    trap: '1 1/2"',
    dfu: 2,
    wsfu: [1.4, 1.0, 1.0],
    stack: 0,
    supply: '1/2"',
  },
  {
    tag: "DW",
    name: "DISHWASHER",
    room: "KITCHEN",
    floor: "L1",
    at: [290, 505],
    z: 6,
    hot: true,
    trap: "VIA KS",
    dfu: 2,
    wsfu: [1.4, 0, 1.4],
    stack: 0,
    supply: '1/2"',
  },
  {
    tag: "CW",
    name: "CLOTHES WASHER BOX",
    room: "LAUNDRY",
    floor: "L1",
    at: [85, 404],
    z: 42,
    hot: true,
    trap: '2"',
    dfu: 2,
    wsfu: [1.4, 1.0, 1.0],
    stack: 1,
    supply: '1/2"',
  },
  {
    tag: "WC-1",
    name: "WATER CLOSET, 1.28 GPF TANK",
    room: "PWDR.",
    floor: "L1",
    at: [16, 490],
    z: 8,
    hot: false,
    trap: "INTEGRAL",
    dfu: 4,
    wsfu: [2.2, 2.2, 0],
    stack: 1,
    supply: '1/2"',
  },
  {
    tag: "LAV-1",
    name: "LAVATORY",
    room: "PWDR.",
    floor: "L1",
    at: [40, 512],
    z: 20,
    hot: true,
    trap: '1 1/4"',
    dfu: 1,
    wsfu: [0.7, 0.5, 0.5],
    stack: 1,
    supply: '1/2"',
  },
  {
    tag: "WC-2",
    name: "WATER CLOSET, 1.28 GPF TANK",
    room: "BATH 2",
    floor: "L2",
    at: [84, 240],
    z: 8,
    hot: false,
    trap: "INTEGRAL",
    dfu: 4,
    wsfu: [2.2, 2.2, 0],
    stack: 1,
    supply: '1/2"',
  },
  {
    tag: "LAV-2",
    name: "LAVATORY",
    room: "BATH 2",
    floor: "L2",
    at: [141, 222],
    z: 20,
    hot: true,
    trap: '1 1/4"',
    dfu: 1,
    wsfu: [0.7, 0.5, 0.5],
    stack: 1,
    supply: '1/2"',
  },
  {
    tag: "T-2",
    name: "BATHTUB W/ SHOWER",
    room: "BATH 2",
    floor: "L2",
    at: [168, 298],
    z: 30,
    hot: true,
    trap: '1 1/2"',
    dfu: 2,
    wsfu: [1.4, 1.0, 1.0],
    stack: 1,
    supply: '1/2"',
  },
  {
    tag: "LAV-3",
    name: "LAVATORY",
    room: "OWNER'S BATH",
    floor: "L2",
    at: [477, 158],
    z: 20,
    hot: true,
    trap: '1 1/4"',
    dfu: 1,
    wsfu: [0.7, 0.5, 0.5],
    stack: 2,
    supply: '1/2"',
  },
  {
    tag: "LAV-4",
    name: "LAVATORY",
    room: "OWNER'S BATH",
    floor: "L2",
    at: [525, 158],
    z: 20,
    hot: true,
    trap: '1 1/4"',
    dfu: 1,
    wsfu: [0.7, 0.5, 0.5],
    stack: 2,
    supply: '1/2"',
  },
  {
    tag: "T-3",
    name: "BATHTUB, DROP-IN",
    room: "OWNER'S BATH",
    floor: "L2",
    at: [404, 22],
    z: 20,
    hot: true,
    trap: '1 1/2"',
    dfu: 2,
    wsfu: [1.4, 1.0, 1.0],
    stack: 2,
    supply: '1/2"',
  },
  {
    tag: "SH-3",
    name: "SHOWER, 2.0 GPM HEAD",
    room: "OWNER'S BATH",
    floor: "L2",
    at: [580, 12],
    z: 48,
    hot: true,
    trap: '2"',
    dfu: 2,
    wsfu: [1.4, 1.0, 1.0],
    stack: 2,
    supply: '1/2"',
  },
  {
    tag: "WC-3",
    name: "WATER CLOSET, 1.28 GPF TANK",
    room: "OWNER'S BATH",
    floor: "L2",
    at: [610, 120],
    z: 8,
    hot: false,
    trap: "INTEGRAL",
    dfu: 4,
    wsfu: [2.2, 2.2, 0],
    stack: 2,
    supply: '1/2"',
  },
  {
    tag: "HB-1",
    name: "HOSE BIBB, VACUUM BREAKER",
    room: "GARAGE FRONT",
    floor: "L1",
    at: [212, -6],
    z: -18,
    hot: false,
    trap: "--",
    dfu: 0,
    wsfu: [2.5, 2.5, 0],
    stack: 0,
    supply: '3/4"',
  },
  {
    tag: "HB-2",
    name: "HOSE BIBB, VACUUM BREAKER",
    room: "LANAI",
    floor: "L1",
    at: [626, 470],
    z: 18,
    hot: false,
    trap: "--",
    dfu: 0,
    wsfu: [2.5, 2.5, 0],
    stack: 0,
    supply: '3/4"',
  },
];

/** Demand in gpm for a WSFU load (IPC Table E103.3(3)), for reference; the sizing uses Table P2903.7. */
const DEMAND: readonly [number, number][] = [
  [1, 3.0],
  [2, 5.0],
  [3, 6.5],
  [4, 8.0],
  [5, 9.4],
  [6, 10.7],
  [7, 11.8],
  [8, 12.8],
  [9, 13.7],
  [10, 14.6],
  [11, 15.4],
  [12, 16.0],
  [13, 16.5],
  [14, 17.0],
  [15, 17.5],
  [16, 18.0],
  [17, 18.4],
  [18, 18.8],
  [19, 19.2],
  [20, 19.6],
  [25, 21.5],
  [30, 23.3],
  [35, 24.9],
  [40, 26.3],
  [45, 27.7],
  [50, 29.1],
];
export function demandGpm(wsfu: number): number {
  for (let k = 1; k < DEMAND.length; k++) {
    const [f0, g0] = DEMAND[k - 1]!;
    const [f1, g1] = DEMAND[k]!;
    if (wsfu <= f1) return g0 + ((Math.max(wsfu, f0) - f0) / (f1 - f0)) * (g1 - g0);
  }
  throw new Error(`WSFU ${wsfu} is past the table`);
}

export const totals = () => {
  const sum = (f: (x: Fixture) => number) =>
    Math.round(FIXTURES.reduce((s, x) => s + f(x), 0) * 10) / 10;
  return {
    dfu: sum((x) => x.dfu),
    wsfu: sum((x) => x.wsfu[0]),
    cold: sum((x) => x.wsfu[1]),
    hot: sum((x) => x.wsfu[2]),
  };
};

// ---------------------------------------------------------------------------------------------
// The sizing basis: FBC-R P2903.7 and Table P2903.7, from the pressure and the developed length.

type P3 = readonly [number, number, number];
const L2Z = HEIGHTS.l2;
/** The trunks run in the floor truss space, over the first floor's ceiling. */
const TZ = HEIGHTS.l1Plate + 8;
const TY = 300; // along the line of the laundry and kitchen's south wall
/** The water meter, where C-101 puts it at the street, in building inches. */
const METER: Point = [LOT.width - 60 - HOUSE_AT[0], -18 - HOUSE_AT[1]];
/** The service riser on the garage's front pier, west of the flood vent and the drains. */
const RISER_X = 224;
const WH: P3 = [
  240,
  262,
  -HEIGHTS.garageDrop + Math.round((CRITERIA.flood.dfe - CRITERIA.flood.garage) * 12),
];
/** Pipe paths, shared by the isometric and the developed length. */
const PATH = {
  service: [
    [METER[0], METER[1], -48],
    [METER[0], -24, -48],
    [RISER_X, -24, -48],
    [RISER_X, -6, -48],
    [RISER_X, -6, -6],
    [RISER_X, 8, -6],
  ] as P3[],
  main: [
    [RISER_X, 8, -6],
    [RISER_X, 8, 96],
    [RISER_X, 256, 96],
    [RISER_X, 256, TZ],
    [RISER_X, TY, TZ],
  ] as P3[],
  whIn: [
    [RISER_X, 256, 96],
    [246, 256, 96],
    [246, 256, WH[2] + 60],
  ] as P3[],
  whOut: [
    [234, 268, WH[2] + 60],
    [234, 268, TZ - 6],
    [234, TY, TZ - 6],
  ] as P3[],
};
/** The assumed minimum static pressure at the meter, until the utility gives it. */
const STREET_PSI = 60;
const GRADE_AT_METER = 7.2;

/** FBC-R Table P2903.7, 40 to 60 psi: [meter and service, distribution, WSFU at each length]. */
const LENGTHS = [40, 60, 80, 100, 150, 200, 250, 300, 400, 500];
const TABLE_40_60: readonly [string, string, readonly number[]][] = [
  ['3/4"', '1/2"', [3, 2.5, 2, 1.5, 1.5, 1, 1, 0.5, 0.5, 0.5]],
  ['3/4"', '3/4"', [9.5, 9.5, 8.5, 7, 5.5, 4.5, 3.5, 3, 2.5, 2]],
  ['3/4"', '1"', [32, 32, 32, 26, 18, 13.5, 10.5, 9, 7.5, 6]],
  ['1"', '1"', [32, 32, 32, 32, 21, 15, 11.5, 9.5, 7.5, 6.5]],
  ['3/4"', '1 1/4"', [32, 32, 32, 32, 32, 32, 32, 27, 21, 16.5]],
  ['1"', '1 1/4"', [80, 80, 80, 80, 65, 52, 42, 35, 26, 20]],
  ['1 1/2"', '1 1/4"', [80, 80, 80, 80, 75, 59, 48, 39, 28, 21]],
];

const pathLength = (pts: readonly P3[]) =>
  pts
    .slice(1)
    .reduce(
      (t, p, k) =>
        t + Math.abs(p[0] - pts[k]![0]) + Math.abs(p[1] - pts[k]![1]) + Math.abs(p[2] - pts[k]![2]),
      0,
    );

/** The sizing: pressure range, developed length, and each segment's size from the table. */
export function waterSizing() {
  const shower = FIXTURES.find((f) => f.tag === "SH-3")!;
  const riser: Point = [501, 300];
  // The most remote outlet, SH-3, by way of the water heater: the hot path is the longer.
  const remote: P3[] = [
    ...PATH.service,
    ...PATH.main.slice(1, 3),
    ...PATH.whIn.slice(1),
    ...PATH.whOut,
    [riser[0] + 8, TY, TZ - 6],
    [riser[0] + 8, riser[1], L2Z + 6],
    [shower.at[0] + 8, riser[1], L2Z + 6],
    [shower.at[0] + 8, shower.at[1], L2Z + 6],
    [shower.at[0] + 8, shower.at[1], L2Z + shower.z + 30],
  ];
  const length = pathLength(remote) / 12;
  const design = length * 1.2;
  const col = LENGTHS.findIndex((l) => l >= design);
  if (col < 0) throw new Error(`Developed length ${design.toFixed(0)} ft is past Table P2903.7`);
  const headEl = CRITERIA.flood.ffe + (L2Z + shower.z + 30) / 12;
  const lift = headEl - GRADE_AT_METER;
  const psi = STREET_PSI - lift * 0.5;
  if (psi < 40 || psi > 60)
    throw new Error(`Available pressure ${psi.toFixed(1)} psi is outside the 40 to 60 psi table`);
  const t = totals();
  const size = (wsfu: number) => {
    const row = TABLE_40_60.find((x) => x[2][col]! >= wsfu);
    if (!row)
      throw new Error(`No pipe in Table P2903.7 carries ${wsfu} WSFU at ${LENGTHS[col]} ft`);
    return row[1];
  };
  const meterRow = TABLE_40_60.find((x) => x[0] === '1"' && x[2][col]! >= t.wsfu);
  if (!meterRow) throw new Error("A 1 in. meter does not serve the house");
  const sum = (fs: Fixture[], k: 1 | 2) =>
    Math.round(fs.reduce((a, f) => a + f.wsfu[k], 0) * 10) / 10;
  const hb1 = FIXTURES.find((f) => f.tag === "HB-1")!;
  const cwTrunk = Math.round((t.cold - hb1.wsfu[1]) * 10) / 10;
  const bath = (room: string) => FIXTURES.filter((f) => f.room === room);
  const risers = {
    "BATH 2": { cw: sum(bath("BATH 2"), 1), hw: sum(bath("BATH 2"), 2) },
    "OWNER'S BATH": { cw: sum(bath("OWNER'S BATH"), 1), hw: sum(bath("OWNER'S BATH"), 2) },
  };
  return {
    length,
    design,
    column: LENGTHS[col]!,
    lift,
    psi,
    meter: meterRow[0],
    main: meterRow[1],
    cwTrunk: { wsfu: cwTrunk, size: size(cwTrunk) },
    hw: { wsfu: t.hot, size: size(t.hot) },
    risers: Object.fromEntries(
      Object.entries(risers).map(([k, x]) => [
        k,
        { cw: size(x.cw), hw: size(x.hw), cwWsfu: x.cw, hwWsfu: x.hw },
      ]),
    ) as Record<string, { cw: string; hw: string; cwWsfu: number; hwWsfu: number }>,
  };
}

/** The building sewer: 4" from the house to the public main, inverts at 1/8" per ft. */
export function sewer() {
  const exit = 6.0; // invert leaving the house's west stem wall, under the laundry
  const toCleanout =
    (Math.abs(-30 - (120 - HOUSE_AT[0])) + Math.abs(400 - (-12 - HOUSE_AT[1]))) / 12;
  const toMain = 25; // half the right-of-way
  const slope = 1 / 8 / 12; // ft per ft
  const cleanout = exit - toCleanout * slope;
  const main = cleanout - toMain * slope;
  return { exit, toCleanout, cleanout, main };
}

// ---------------------------------------------------------------------------------------------
// The water isometric.

const C30 = Math.cos(Math.PI / 6);

/** The isometric: east up and to the right, north up and to the left, height straight up. */
function iso(origin: Point, s: number, sz: number) {
  return ([x, y, z]: P3): Point => [
    origin[0] + (x - y) * C30 * s,
    origin[1] + (x + y) * 0.5 * s + z * sz,
  ];
}

function waterIso(d: D, origin: Point): void {
  const P = iso(origin, 0.0116, 0.02);
  const pipe = (pts: P3[], hot: boolean) =>
    d.layer(hot ? HOT : LAYERS.plmb, {}, () => d.polyline(pts.map(P)));
  // A hot pipe runs beside its cold one: 8" east and 6" lower. An offset of equal x and y would
  // vanish in the isometric, where x - y sets the paper's horizontal.
  const off = (p: P3, hot: boolean): P3 => (hot ? [p[0] + 8, p[1], p[2] - 6] : p);
  const lbl = (p: P3, text: string, dx = 0.08, dy = 0.05, align: "left" | "right" = "left") =>
    d.layer(LAYERS.pAnno, {}, () => {
      const q = P(p);
      put(d, [q[0] + dx, q[1] + dy], text, H.note, { align });
    });
  // The two floors' outlines, for reference.
  d.layer(LAYERS.pAnno, {}, () => {
    for (const [z, name] of [
      [0, "FIRST FLOOR"],
      [L2Z, "SECOND FLOOR"],
    ] as const) {
      const pts = (
        [
          [0, 0],
          [624, 0],
          [624, 528],
          [0, 528],
        ] as const
      ).map(([x, y]) => P([x, y, z]));
      d.polyline(pts, true, { linetype: "PHANTOM", lineweight: 0.13 });
      put(d, [pts[1]![0] + 0.1, pts[1]![1]], name, H.note, { valign: "middle" });
    }
  });
  const sz = waterSizing();
  // The water service, from the meter at the street (C-101), up outside the garage's front pier
  // and in, with the main shutoff; HB-1 tees off the riser.
  pipe(PATH.service.slice(2), false);
  lbl(PATH.service[2]!, `${sz.meter} CW SERVICE FROM METER AT`, 0.1, -0.1);
  lbl(PATH.service[2]!, "STREET (C-101), MAIN SHUTOFF", 0.1, -0.26);
  const hb1 = FIXTURES.find((f) => f.tag === "HB-1")!;
  pipe(
    [
      [RISER_X, -6, hb1.z],
      [hb1.at[0], hb1.at[1], hb1.z],
    ],
    false,
  );
  lbl([hb1.at[0], hb1.at[1], hb1.z], `HB-1 ${hb1.supply}`, -0.07, -0.04, "right");
  // The main overhead in the garage to WH-1's tee, then up into the floor trusses.
  pipe(PATH.main, false);
  pipe(PATH.whIn, false);
  waterHeater(d, P, WH);
  pipe(PATH.whOut, true);
  // The trunks, cold and hot, along TY.
  const l1 = FIXTURES.filter((f) => f.tag !== "HB-1");
  const east = Math.max(...l1.map((f) => f.at[0]));
  const west = Math.min(...l1.map((f) => f.at[0]));
  pipe(
    [
      [west, TY, TZ],
      [east, TY, TZ],
    ],
    false,
  );
  const eastHot = Math.max(...FIXTURES.filter((f) => f.hot).map((f) => f.at[0]));
  const westHot = Math.min(...FIXTURES.filter((f) => f.hot).map((f) => f.at[0]));
  pipe([off([westHot, TY, TZ], true), off([eastHot, TY, TZ], true)], true);
  // The trunks' sizes lie on the pipes in the isometric's plane: turned 30 degrees along the
  // east axis and leaned the other way, as iso lettering is.
  isoText(d, P([300, TY, TZ]), `${sz.cwTrunk.size} CW TRUNK`, "east", 0.05);
  isoText(d, P(off([360, TY, TZ], true)), `${sz.hw.size} HW TRUNK`, "east", -0.17);
  // Each fixture: a branch off the trunk, along y to its place, up or down to its stop. The
  // second floor's fixtures share a riser per bathroom.
  const risers: Record<string, Point> = { "BATH 2": [141, 300], "OWNER'S BATH": [501, 300] };
  void east;
  const riserTop = (_room: string) => L2Z + 12;
  const drawn = new Set<string>();
  for (const f of FIXTURES) {
    if (f.tag === "HB-1") continue;
    for (const hot of f.hot ? [false, true] : [false]) {
      const [fx, fy] = f.at;
      if (f.floor === "L1") {
        const a = off([fx, TY, TZ], hot);
        const b = off([fx, fy, TZ], hot);
        const c = off([fx, fy, f.z], hot);
        pipe([a, b, c], hot);
        continue;
      }
      const r = risers[f.room]!;
      const top = riserTop(f.room);
      const key = `${f.room}/${hot}`;
      if (!drawn.has(key)) {
        drawn.add(key);
        pipe([off([r[0], TY, TZ], hot), off([r[0], r[1], top], hot)], hot);
        const rs = sz.risers[f.room]!;
        lbl(
          off([r[0], r[1], (TZ + top) / 2], hot),
          hot ? `${rs.hw} HW` : `${rs.cw} CW`,
          hot ? 0.08 : -0.08,
          0,
          hot ? "left" : "right",
        );
      }
      pipe(
        [
          off([r[0], r[1], top], hot),
          off([fx, r[1], top], hot),
          off([fx, fy, top], hot),
          off([fx, fy, L2Z + f.z], hot),
        ],
        hot,
      );
    }
    // The fixture's label at its cold stop.
    const z = (f.floor === "L2" ? L2Z : 0) + f.z;
    d.layer(LAYERS.plmb, {}, () => {
      const q = P([f.at[0], f.at[1], z]);
      d.circle(q, 0.03);
    });
    const [dx, dy, align] = LABEL_AT[f.tag] ?? [0.07, -0.04, "left"];
    lbl([f.at[0], f.at[1], z], `${f.tag} ${f.supply}`, dx, dy, align);
  }
}

/** Lettering in the isometric's horizontal plane, along the east or the north axis. */
function isoText(d: D, at: Point, value: string, axis: "east" | "north", lift: number): void {
  const rotation = axis === "east" ? 30 : -30;
  const style = axis === "east" ? ISO_EAST : ISO_NORTH;
  const n: Point = [-Math.sin((rotation * Math.PI) / 180), Math.cos((rotation * Math.PI) / 180)];
  d.layer(LAYERS.pAnno, {}, () =>
    d.text([at[0] + n[0] * lift, at[1] + n[1] * lift], value, {
      height: H.note,
      style,
      rotation,
      align: "center",
    }),
  );
}
const ISO_EAST = "ISO-EAST";
const ISO_NORTH = "ISO-NORTH";

/** Where a fixture's label sits from its stop on the isometric, where the default is crowded. */
const LABEL_AT: Record<string, [number, number, "left" | "right"]> = {
  KS: [-0.07, 0.05, "right"],
  DW: [0.07, -0.12, "left"],
  "LAV-2": [0.07, 0.06, "left"],
  "WC-2": [0.07, -0.14, "left"],
  "HB-2": [0.07, -0.12, "left"],
};

/** The water heater: a cylinder drawn as two ellipses and two sides, its T&P line to the floor. */
function waterHeater(d: D, P: (p: P3) => Point, base: P3): void {
  const r = 11;
  const ring = (z: number): Point[] => {
    const pts: Point[] = [];
    for (let k = 0; k < 24; k++) {
      const a = (2 * Math.PI * k) / 24;
      pts.push(P([base[0] + r * Math.cos(a), base[1] + r * Math.sin(a), z]));
    }
    return pts;
  };
  d.layer(LAYERS.plmb, {}, () => {
    d.polyline(ring(base[2]), true);
    d.polyline(ring(base[2] + 60), true);
    // The two sides, at the ring's leftmost and rightmost points on the paper.
    const lo = ring(base[2]);
    const hi = ring(base[2] + 60);
    const left = lo.reduce((m, p, k) => (p[0] < lo[m]![0] ? k : m), 0);
    const right = lo.reduce((m, p, k) => (p[0] > lo[m]![0] ? k : m), 0);
    d.line(lo[left]!, hi[left]!);
    d.line(lo[right]!, hi[right]!);
    // The platform under it, from the garage slab up to the D.F.E.
    const slab = -HEIGHTS.garageDrop;
    d.polyline([
      P([base[0] - 16, base[1] - 16, slab]),
      P([base[0] + 16, base[1] - 16, slab]),
      P([base[0] + 16, base[1] - 16, base[2]]),
      P([base[0] - 16, base[1] - 16, base[2]]),
    ]);
  });
  // The T&P relief: off the side, down to 6" above the floor.
  d.layer(LAYERS.plmb, {}, () => {
    d.polyline([
      P([base[0] + 11, base[1], base[2] + 50]),
      P([base[0] + 26, base[1], base[2] + 50]),
      P([base[0] + 26, base[1], -24]),
    ]);
  });
  // The expansion tank on the cold inlet.
  d.layer(LAYERS.plmb, {}, () => d.circle(P([236, 256, 88]), 0.07));
  const q = P(base);
  d.layer(LAYERS.pAnno, {}, () => {
    const lines = [
      "50 GAL. ELECTRIC WATER HEATER (WH-1)",
      "ON PLATFORM ABOVE D.F.E., GARAGE NE",
      'CORNER. 3/4" T&P DISCHARGE TO 6" ABOVE',
      "FLOOR (FBC-R P2804.6.1); PAN DRAIN TO",
      "OUTSIDE (P2801.6.1, M-101). EXPANSION",
      "TANK ON CW INLET (P2903.4)",
    ];
    const lx = q[0] - 1.0;
    const ly = q[1] - 0.55;
    lines.forEach((t, k) => put(d, [lx, ly - k * 0.15], t, H.note, { align: "right" }));
    d.line([lx + 0.05, ly + 0.03], [q[0] - 0.3, ly + 0.03]);
    d.line([q[0] - 0.3, ly + 0.03], [q[0] - 0.15, q[1] - 0.1]);
    arrowhead(d, [q[0] - 0.15, q[1] - 0.1], [q[0] - 0.3, ly + 0.03], 0.08);
  });
}

// ---------------------------------------------------------------------------------------------
// The DWV riser: an elevation along x, west to east.

function dwvRiser(d: D, at: Point, w: number): void {
  const X = (x: number) => at[0] + 0.8 + ((x + 40) / 680) * (w - 1.4);
  const Z = {
    drain: at[1] + 0.6,
    f1: at[1] + 1.4,
    f2: at[1] + 4.6,
    ceil2: at[1] + 7.3,
    roof: at[1] + 8.4,
  };
  const lbl = (p: Point, t: string, align: "left" | "right" | "center" = "left", h = H.small) =>
    d.layer(LAYERS.pAnno, {}, () => put(d, p, t, h, { align, valign: "middle" }));
  const san = (pts: Point[]) => d.layer(LAYERS.sanr, {}, () => d.polyline(pts));
  const vent = (pts: Point[]) => d.layer(VENT, {}, () => d.polyline(pts));
  const co = (p: Point, label = "CO") => {
    d.layer(LAYERS.sanr, {}, () => d.circle(p, 0.06));
    lbl([p[0], p[1] - 0.15], label, "center");
  };
  const trap = (x: number, y: number) =>
    d.layer(LAYERS.sanr, {}, () => d.arc([x, y], 0.06, 180, 360));
  // Floors and roof for reference.
  d.layer(LAYERS.pAnno, {}, () => {
    for (const [y, name] of [
      [Z.f1, "FIRST FLOOR F.F.E. 11.00' NAVD"],
      [Z.f2, "SECOND FLOOR"],
      [Z.roof, "ROOF"],
    ] as const) {
      d.line([at[0], y], [at[0] + w, y], { linetype: "PHANTOM", lineweight: 0.13 });
      put(d, [at[0] + w, y + 0.05], name, H.small, { align: "right" });
    }
  });
  const s1 = 100;
  const s2 = 540;
  // The building drain under the slab, sloping to the sewer at the west, and the sewer.
  san([
    [X(s2 + 60), Z.drain + 0.12],
    [X(-30), Z.drain],
  ]);
  d.layer(LAYERS.sanr, {}, () => {
    const a: Point = [X(-30), Z.drain];
    const b: Point = [X(-30) - 0.3, Z.drain - 0.02];
    d.line(a, b);
    arrowhead(d, b, a, 0.09);
  });
  const sw = sewer();
  lbl(
    [X(-30) - 0.3, Z.drain - 0.2],
    `4" PVC BUILDING SEWER, INV. ${sw.exit.toFixed(2)}' AT HOUSE, ${sw.cleanout.toFixed(2)}' AT P.L. C.O.,`,
    "left",
    H.note,
  );
  lbl(
    [X(-30) - 0.3, Z.drain - 0.36],
    `${sw.main.toFixed(2)}' AT PUBLIC MAIN (C-101; VERIFY WITH UTILITY)`,
    "left",
    H.note,
  );
  lbl(
    [X(400), Z.drain - 0.2],
    '4" PVC SCH. 40 BUILDING DRAIN AT 1/8" PER FT. MIN., UNDER SLAB',
    "center",
    H.note,
  );
  co([X(-14), Z.f1 - 0.15], "2-WAY CO");
  san([
    [X(-14), Z.drain],
    [X(-14), Z.f1 - 0.21],
  ]);
  co([X(s2 + 60), Z.f1 - 0.15]);
  san([
    [X(s2 + 60), Z.drain + 0.12],
    [X(s2 + 60), Z.f1 - 0.21],
  ]);
  // Stacks, up through the roof.
  for (const [x, name] of [
    [s1, "STACK 1"],
    [s2, "STACK 2"],
  ] as const) {
    const xb = X(x);
    san([
      [xb, Z.drain + (x / 640) * 0.12],
      [xb, Z.ceil2],
    ]);
    vent([
      [xb, Z.ceil2],
      [xb, Z.roof + 0.4],
    ]);
    lbl([xb + 0.08, Z.roof + 0.32], '3" VTR, 6" MIN. ABOVE ROOF', "left", H.note);
    lbl([xb + 0.08, (Z.f1 + Z.f2) / 2], `3" ${name}`, "left", H.note);
    co([xb + 0.25, Z.f1 + 0.25]);
    san([
      [xb, Z.f1 + 0.1],
      [xb + 0.25, Z.f1 + 0.19],
    ]);
  }
  // Each fixture: a trap, a drain to its stack or under the slab to the drain, and its vent.
  for (const f of FIXTURES) {
    if (f.dfu === 0 || f.tag === "DW") continue;
    const x = X(f.at[0]);
    const floor = f.floor === "L1" ? Z.f1 : Z.f2;
    const top = floor + 0.55;
    trap(x, top - 0.08);
    lbl([x - 0.05, top + 0.13], f.tag, "right", H.note);
    const stackX = f.stack === 1 ? X(s1) : f.stack === 2 ? X(s2) : x;
    const arm = floor - 0.25;
    if (f.floor === "L1") {
      // Down through the slab to the building drain, or to the stack's base.
      const into = f.stack === 0 ? Z.drain + (f.at[0] / 640) * 0.12 : arm;
      san([
        [x, top - 0.14],
        [x, arm],
        ...(f.stack === 0 ? [[x, into] as Point] : [[stackX, arm] as Point]),
      ]);
    } else {
      san([
        [x, top - 0.14],
        [x, arm],
        [stackX, arm - 0.04],
      ]);
    }
    lbl([x + 0.06, arm + 0.12], f.trap === "INTEGRAL" ? '3"' : f.trap, "left");
    // The fixture's vent: off its trap arm, up to a vent header. The first floor's vents join
    // a header under the second floor that rises in the west wall (WC-1's vent) to the attic,
    // so no vent joins a stack below the second floor's fixtures.
    const riserVent = f.tag === "WC-1" || f.tag === "KS";
    const ventTop = f.floor === "L1" && !riserVent ? Z.f2 - 0.35 : Z.ceil2 + 0.35;
    san([
      [x, top - 0.14],
      [x + 0.12, top - 0.14],
    ]);
    vent([
      [x + 0.12, top - 0.14],
      [x + 0.12, ventTop],
    ]);
  }
  // Vent headers, each sloping back to its stack's vent above the highest fixture.
  vent([
    [X(16) + 0.12, Z.f2 - 0.35],
    [X(85) + 0.12, Z.f2 - 0.35],
  ]);
  vent([
    [X(16) + 0.12, Z.ceil2 + 0.35],
    [X(252) + 0.12, Z.ceil2 + 0.35],
  ]);
  vent([
    [X(404) + 0.12, Z.ceil2 + 0.35],
    [X(610) + 0.12, Z.ceil2 + 0.35],
  ]);
  lbl([X(252) + 0.18, (Z.f2 + Z.ceil2) / 2], '2" VENT', "left", H.note);
  lbl(
    [X(320), Z.ceil2 + 0.55],
    '2" VENT HEADER IN ATTIC, 1/4" PER FT. BACK TO STACK',
    "center",
    H.note,
  );
  lbl([X(400), Z.f2 - 0.6], '3" PVC AT 1/4" PER FT. TO STACK', "center", H.note);
}

// ---------------------------------------------------------------------------------------------
// The sheet.

const NOTES = [
  "ALL WORK PER THE 2023 FBC-R, CHAPTERS 25 THROUGH 33 (PLUMBING), WHICH GOVERN THIS ONE-FAMILY DWELLING, AND THE LOCAL UTILITY'S RULES. SECTIONS CITED ARE FBC-R. THE DIAGRAMS ARE NOT TO SCALE; SEE THE PLANS FOR FIXTURES AND M-101 FOR DRAIN ROUTES.",
  'WATER DISTRIBUTION: PEX-A (ASTM F876/F877) OR CPVC (ASTM D2846), TABLE P2906.5. SIZED BY P2903.7 AND TABLE P2903.7 (SEE THE SIZING BASIS); 1/2" MIN. TO EACH FIXTURE. INSULATE HOT WATER PIPING PER FBC-EC R403.5.3.',
  'DRAINAGE AND VENT: PVC SCHEDULE 40 DWV (ASTM D2665), TABLES P3002.1(1) AND P3002.2. SLOPE 1/4" PER FT. FOR 2 1/2" AND SMALLER, 1/8" PER FT. FOR 3" AND LARGER (TABLE P3005.3).',
  "DRAINAGE FIXTURE UNITS PER TABLE P3004.1, TRAPS PER TABLE P3201.7. STACKS PER TABLE P3005.4.1; BUILDING DRAIN AND SEWER PER TABLE P3005.4.2.",
  "CLEANOUTS AT THE BASE OF EACH STACK, AT THE JUNCTION OF THE BUILDING DRAIN AND SEWER, AT THE PROPERTY LINE, AND AT EACH CHANGE OF DIRECTION OVER 45 DEGREES, WITH CLEARANCE AND ACCESS (P3005.2).",
  'VENTS: AT LEAST ONE VENT TO OUTDOORS FOR THE BUILDING DRAIN (P3102.1). TERMINALS 6" MIN. ABOVE THE ROOF AND 10 FT FROM, OR 3 FT ABOVE, ANY OPERABLE OPENING WITHIN 10 FT (P3103.1, P3103.5).',
  'WATER HEATER: LISTED, WITH A T&P RELIEF VALVE (P2804) AND A FULL-SIZE DISCHARGE PIPE ENDING 6" MAX. ABOVE THE FLOOR (P2804.6.1). PAN WITH A 3/4" DRAIN TO THE OUTSIDE, ENDING 6" TO 24" ABOVE GRADE (P2801.6.1; ROUTE ON M-101). THERMAL EXPANSION CONTROL (P2903.4). ON A PLATFORM ABOVE THE D.F.E. (R322.1.6).',
  "HOSE BIBBS WITH LISTED VACUUM BREAKERS (P2902.4.3). SHOWER AND TUB-SHOWER VALVES PRESSURE-BALANCE OR THERMOSTATIC, LIMITED TO 120 F (P2708.4, P2713.3).",
  "TEST: DWV WITH A 10 FT HEAD OF WATER OR 5 PSI AIR FOR 15 MINUTES; WATER PIPING AT THE WORKING PRESSURE WITHOUT LEAKS (P2503.5.1, P2503.7).",
  "FLOOD ZONE AE: WATER AND SEWER CONNECTIONS RESIST FLOOD WATER INFILTRATION (R322.1.7). BACKWATER VALVE ON THE BUILDING SEWER IF THE NEXT UPSTREAM MANHOLE COVER IS ABOVE THE LOWEST FIXTURE'S FLOOD-LEVEL RIM (P3008.1).",
  'CONDENSATE (M-101): AHU-1 AND AHU-2 PRIMARY CONDENSATE IN 3/4" PVC, TRAPPED, 1/8" PER FT. MIN., TO THE OUTSIDE (M1411.3); AHU-2 IN THE ATTIC WITH AN AUXILIARY PAN AND A WATER-LEVEL SWITCH (M1411.3.1).',
  "LOW-FLOW FIXTURES: WATER CLOSETS 1.28 GPF, LAVATORY FAUCETS 1.5 GPM, SHOWER HEADS 2.0 GPM AT 80 PSI (P2903.2).",
];

function fixtureSchedule(d: D, at: Point): number {
  const t = totals();
  const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const rows = FIXTURES.map((f) => [
    f.tag,
    f.name,
    f.room,
    f.trap,
    f.supply,
    f.hot ? '1/2"' : "--",
    num(f.dfu),
    num(f.wsfu[1]),
    num(f.wsfu[2]),
    num(f.wsfu[0]),
  ]);
  rows.push(["", "TOTAL", "", "", "", "", num(t.dfu), num(t.cold), num(t.hot), num(t.wsfu)]);
  return table(
    d,
    at,
    "PLUMBING FIXTURE SCHEDULE",
    [
      { name: "TAG", width: 0.6 },
      { name: "FIXTURE", width: 2.75 },
      { name: "LOCATION", width: 1.45 },
      { name: "TRAP", width: 0.9, align: "center" },
      { name: "CW", width: 0.5, align: "center" },
      { name: "HW", width: 0.5, align: "center" },
      { name: "DFU", width: 0.5, align: "right" },
      { name: "WSFU CW", width: 0.8, align: "right" },
      { name: "WSFU HW", width: 0.8, align: "right" },
      { name: "WSFU TOT.", width: 0.85, align: "right" },
    ],
    rows,
    { height: H.note, rowHeight: 0.21 },
  );
}

function sizing(d: D, at: Point, w: number): number {
  const t = totals();
  const z = waterSizing();
  const sw = sewer();
  const r2 = z.risers["BATH 2"]!;
  const r3 = z.risers["OWNER'S BATH"]!;
  const rows = [
    ["STATIC PRESSURE AT METER (ASSUMED; VERIFY W/ UTILITY)", `${STREET_PSI} PSI`],
    [
      `LIFT TO SH-3 HEAD, ${z.lift.toFixed(1)} FT X 0.5 PSI/FT`,
      `-${(z.lift * 0.5).toFixed(1)} PSI`,
    ],
    ["AVAILABLE, P2903.7 STEP 2: 40 TO 60 PSI RANGE", `${z.psi.toFixed(1)} PSI`],
    [
      `DEVELOPED LENGTH, METER TO SH-3 VIA WH-1, X 1.2`,
      `${z.length.toFixed(0)} X 1.2 = ${z.design.toFixed(0)} FT`,
    ],
    ["TABLE P2903.7 COLUMN", `${z.column} FT`],
    ["TOTAL WATER SUPPLY FIXTURE UNITS (WSFU)", t.wsfu.toFixed(1)],
    ["METER AND SERVICE / MAIN TO WH-1 TEE", `${z.meter} / ${z.main}`],
    [`CW TRUNK, ${z.cwTrunk.wsfu} WSFU`, z.cwTrunk.size],
    [`HW: WH-1 INLET AND TRUNK, ${z.hw.wsfu} WSFU`, z.hw.size],
    [`BATH 2 RISERS, CW ${r2.cwWsfu} / HW ${r2.hwWsfu} WSFU`, `${r2.cw} / ${r2.hw}`],
    [`OWNER'S BATH RISERS, CW ${r3.cwWsfu} / HW ${r3.hwWsfu} WSFU`, `${r3.cw} / ${r3.hw}`],
    ["TOTAL DRAINAGE FIXTURE UNITS (DFU)", String(t.dfu)],
    ['BUILDING DRAIN, 4" AT 1/8" PER FT., TABLE P3005.4.2', "180 DFU MAX."],
    ['STACKS, 3", TABLE P3005.4.1', "48 DFU MAX."],
    [`BUILDING SEWER, 4" AT 1/8" PER FT., INV. AT P.L. C.O.`, `${sw.cleanout.toFixed(2)}' NAVD`],
  ];
  if (t.dfu > 180) throw new Error(`The building drain carries ${t.dfu} DFU, more than 180`);
  return table(
    d,
    at,
    "PIPE SIZING BASIS (FBC-R P2903.7)",
    [
      { name: "ITEM", width: w - 1.8 },
      { name: "VALUE", width: 1.8, align: "right" },
    ],
    rows,
    { height: H.note, rowHeight: 0.2 },
  );
}

/**
 * The water heater's installation, in elevation, at its real size in model space: the garage
 * slab, the platform up to the D.F.E., the pan, the heater, its piping and its relief line.
 */
function heaterDetail(d: D, v: View): void {
  const o = (x: number, y: number): Point => [WH_ORIGIN[0] + x, WH_ORIGIN[1] + y];
  const rise = Math.round((CRITERIA.flood.dfe - CRITERIA.flood.garage) * 12); // 18"
  const panTop = rise + 2.5;
  const top = panTop + 60;
  const vx = 38; // the cold shutoff
  d.layer(LAYERS.sect, {}, () => {
    // The garage slab and the CMU wall behind the heater.
    d.polyline([o(-24, 0), o(64, 0)]);
    d.polyline([o(-24, -4), o(64, -4)]);
    d.polyline([o(-8, -4), o(-8, 124)]);
    d.polyline([o(0, 0), o(0, 124)]);
  });
  // Patterns, drawn as lines: tsdraft has no hatch entity. The slab is stippled, the earth under
  // it woven, the CMU wall cross-hatched.
  d.layer(LAYERS.patt, {}, () => {
    const [ox, oy] = WH_ORIGIN;
    stipple(d, [ox - 24, oy - 4, 88, 4], [], {
      spacing: v.p(0.05),
      stroke: v.p(0.04),
      seed: 7,
      margin: 0.4,
    });
    earth(d, [ox - 24, oy - 16, 88, 12], [], v.p(0.12));
    hatch(d, [ox - 8, oy, 8, 124], v.p(0.06), 1);
    hatch(d, [ox - 8, oy, 8, 124], v.p(0.06), -1);
  });
  d.layer(LAYERS.sectFine, {}, () => {
    // The platform: framed of treated lumber, its top at the D.F.E.
    d.rect(o(2, 0), 34, rise);
    d.line(o(2, 0), o(36, rise));
    d.line(o(2, rise), o(36, 0));
  });
  d.layer(LAYERS.plmb, {}, () => {
    // The pan, the heater and its top.
    d.polyline([o(4, rise + 2.5), o(4, rise), o(34, rise), o(34, rise + 2.5)]);
    d.rect(o(7, panTop), 24, 60);
    d.line(o(7, top - 4), o(31, top - 4));
    // Hot out at the left, cold in at the right, with its shutoff and the expansion tank.
    d.polyline([o(12, top), o(12, 124)]);
    d.polyline([o(26, top), o(26, 100), o(50, 100), o(50, 124)]);
    d.polyline([o(vx - 2.5, 98), o(vx + 2.5, 102), o(vx + 2.5, 98), o(vx - 2.5, 102)], true);
    d.line(o(44, 100), o(44, 94));
    d.rect(o(39, 76), 10, 18);
    // The T&P valve on the side, and its discharge down to 6" above the slab.
    d.polyline([o(31, top - 10), o(42, top - 10), o(42, 6)]);
    // The pan's drain, on its way to the outside (M-101).
    d.polyline([o(34, rise + 1.5), o(62, rise + 1.5)]);
  });
  // The D.F.E. and the slab's elevation.
  d.layer(LAYERS.pAnno, {}, () => {
    d.line(o(-24, rise), o(64, rise), { linetype: "DASHED" });
    d.line(o(-60, rise), o(-24, rise), { linetype: "DASHED" });
    put(d, o(-60, rise + v.p(0.06)), `D.F.E. ${CRITERIA.flood.dfe.toFixed(2)}' NAVD`, v.p(H.note));
    put(d, o(-60, v.p(0.06)), `GARAGE SLAB ${CRITERIA.flood.garage.toFixed(2)}' NAVD`, v.p(H.note));
    d.line(o(-60, 0), o(-24, 0));
  });
  d.layer(LAYERS.dims, {}, () => {
    dimString(d, v, [o(36, 0), o(36, rise)], "y", WH_ORIGIN[0] + 36 + v.p(0.45));
  });
  const wh = circuit("WH");
  d.layer(LAYERS.pAnno, {}, () => {
    const hw = waterSizing().hw.size;
    leaderNote(d, v, o(12, 116), o(70, 116), [`${hw} HW TO FIXTURES`]);
    leaderNote(d, v, o(50, 118), o(70, 108), [`${hw} CW FROM MAIN`]);
    leaderNote(d, v, o(vx, 102), o(70, 100), ["FULL-PORT BALL VALVE"]);
    leaderNote(d, v, o(49, 86), o(70, 90), ["THERMAL EXPANSION TANK,", "2 GAL. (FBC-R P2903.4)"]);
    leaderNote(d, v, o(31, top - 30), o(70, 74), [
      "WH-1, 50 GAL. ELECTRIC, 240 V,",
      `CKT. ${wh.label}, ${wh.amps} A/2P, ${WIRE_OF(wh.amps)} CU;`,
      "DISCONNECT WITHIN SIGHT",
    ]);
    leaderNote(d, v, o(42, 40), o(70, 50), [
      '3/4" T&P DISCHARGE, FULL SIZE,',
      '6" MAX. ABOVE FLOOR, NO VALVE',
      "OR THREAD AT END (FBC-R P2804.6.1)",
    ]);
    leaderNote(d, v, o(60, rise + 1.5), o(70, 24), [
      'PAN W/ 3/4" CPVC DRAIN, 1/8" PER',
      "FT., ALONG GARAGE E. WALL AND OUT",
      'THE FRONT PIER, ENDING 6" TO 24"',
      "ABOVE GRADE (FBC-R P2801.6.1;",
      "ROUTE ON M-101)",
    ]);
    leaderNote(d, v, o(10, 6), o(-30, 50), [
      "TREATED 2X4 PLATFORM,",
      "TOP AT D.F.E.",
      "(FBC-R R322.1.6)",
    ]);
  });
}

const WIRE_OF = (amps: number) =>
  ({ 30: "#10", 40: "#8", 50: "#6" } as Record<number, string>)[amps] ?? "";

/** The water heater schedule. */
function heaterSchedule(d: D, at: Point): number {
  return table(
    d,
    at,
    "WATER HEATER SCHEDULE",
    [
      { name: "TAG", width: 0.6 },
      { name: "TYPE", width: 2.4 },
      { name: "CAP.", width: 0.75, align: "center" },
      { name: "ELEMENTS", width: 1.3, align: "center" },
      { name: "ELECTRICAL", width: 1.9, align: "center" },
      { name: "RECOVERY", width: 1.6, align: "center" },
      { name: "UEF", width: 0.6, align: "center" },
      { name: "LOCATION", width: 2.6 },
    ],
    [
      [
        "WH-1",
        "ELECTRIC STORAGE, LISTED",
        "50 GAL.",
        "2 X 4500 W",
        "240 V, 30 A/2P (E-101)",
        "21 GPH AT 90 F",
        "0.92",
        "GARAGE NE CORNER, PLATFORM",
      ],
    ],
    { height: H.note, rowHeight: 0.21 },
  );
}

function legend(d: D, at: Point, w: number): number {
  let y = at[1];
  d.layer(LAYERS.text, {}, () => {
    put(d, [at[0], y], "PLUMBING LEGEND", H.label, { valign: "top" });
    y -= H.label + 0.06;
    d.line([at[0], y], [at[0] + w, y], { lineweight: 0.35 });
    y -= 0.25;
  });
  const rows: [string, string, (a: Point, b: Point) => void][] = [
    ["COLD WATER (CW)", LAYERS.plmb, (a, b) => d.line(a, b)],
    ["HOT WATER (HW)", HOT, (a, b) => d.line(a, b)],
    ["SANITARY WASTE / SOIL", LAYERS.sanr, (a, b) => d.line(a, b)],
    ["VENT", VENT, (a, b) => d.line(a, b)],
    ["CLEANOUT (CO)", LAYERS.sanr, (a, b) => d.circle([(a[0] + b[0]) / 2, a[1]], 0.06)],
    [
      "FIXTURE TRAP",
      LAYERS.sanr,
      (a, b) => d.arc([(a[0] + b[0]) / 2, a[1] + 0.04], 0.06, 180, 360),
    ],
    ["FIXTURE STOP / CONNECTION", LAYERS.plmb, (a, b) => d.circle([(a[0] + b[0]) / 2, a[1]], 0.03)],
  ];
  for (const [label, layer, draw] of rows) {
    d.layer(layer, {}, () => draw([at[0] + 0.05, y], [at[0] + 0.65, y]));
    d.layer(LAYERS.text, {}, () => put(d, [at[0] + 0.85, y], label, H.note, { valign: "middle" }));
    y -= 0.28;
  }
  return y;
}

function p101(d: D): void {
  d.layer(HOT, { color: 7, lineweight: 0.35, linetype: "HIDDEN" });
  d.textStyle({ name: ISO_EAST, font: "Arial", obliqueAngle: -30 });
  d.textStyle({ name: ISO_NORTH, font: "Arial", obliqueAngle: 30 });
  d.layer(VENT, { color: 7, lineweight: 0.25, linetype: "DASHED" });
  heaterDetail(d, view(d, 16));
  frame(d, "P-101", (dd, sheet) => {
    const left = AREA.left + 0.2;
    const diagramW = 14.2;
    // The water isometric, top left. The origin is the house's southwest corner at the floor.
    waterIso(dd, [left + 6.4, 13.25]);
    viewTitle(dd, [left, 12.5], "1", "P-101", "WATER DISTRIBUTION ISOMETRIC", "NOT TO SCALE");
    // The DWV riser, bottom left.
    dwvRiser(dd, [left, 2.2], diagramW);
    viewTitle(dd, [left, 1.4], "2", "P-101", "DRAINAGE, WASTE AND VENT RISER", "NOT TO SCALE");
    // Schedules and notes, right.
    const rx = left + diagramW + 0.7;
    let y = fixtureSchedule(dd, [rx, AREA.top - 0.1]);
    const rw = AREA.right - rx;
    const sTop = y - 0.4;
    y = sizing(dd, [rx, sTop], 6.4);
    const legendEnd = legend(dd, [rx + 6.9, sTop], rw - 6.9);
    const colW = (rw - 0.4) / 2;
    const half = Math.ceil(NOTES.length / 2);
    const ny = Math.min(y, legendEnd) - 0.45;
    // noteColumn numbers from 1, so the second column writes its own numbers.
    const n1 = noteColumn(dd, [rx, ny], colW, "PLUMBING NOTES", NOTES.slice(0, half));
    const n2 = noteColumn(
      dd,
      [rx + colW + 0.4, ny],
      colW,
      "PLUMBING NOTES (CONT.)",
      NOTES.slice(half).map((n, k) => `${half + k + 1}. ${n}`),
      { numbered: false },
    );
    const hs = heaterSchedule(dd, [rx, Math.min(n1, n2) - 0.4]);
    // The water heater detail, through a viewport, under the schedules.
    const vd = view(dd, 16);
    const vpTop = hs - 0.5;
    const vpH = vpTop - 2.0;
    const vpW = AREA.right - rx - 0.1;
    viewport(dd, sheet, {
      corner: [rx, 2.0],
      size: [vpW, vpH],
      center: [WH_ORIGIN[0] + 28, WH_ORIGIN[1] + 58],
      v: vd,
      id: "vp-P-101-wh",
      number: "3",
      sheetNo: "P-101",
      title: "WATER HEATER INSTALLATION",
      titleAt: [rx + 0.1, 1.5],
    });
    void width;
  });
}

export const SHEETS_P = { "P-101": p101 };
