// The HVAC design of the house, once: the equipment and where it stands, the duct systems, the
// exhausts and their terminations, in building coordinates. M-101 draws it; E-101 places its
// disconnects and receptacles from the same positions; P-101 reads the condensate routes.
import type { Point } from "../../../src/index.ts";
import { L1, L2, type Level, type Rect } from "../model/house.ts";
import { DEVICES, type Floor } from "./mep-power.ts";
export { ATTIC, center, EQUIP, passageLength } from "./mep-equip.ts";

// ---------------------------------------------------------------------------------------------
// Duct systems.

export interface Outlet {
  readonly room: string;
  readonly at: Point;
  /** The trunk edge it takes off from, by node names. */
  readonly from: readonly [string, string];
}

export interface ReturnGrille {
  readonly tag: string;
  readonly room: string;
  readonly at: Point;
  /** The grille's face, square, in inches. */
  readonly face: number;
  /** The duct from the grille to the unit, as a path. */
  readonly path: readonly Point[];
  readonly diameter: number;
}

export interface DuctSystem {
  readonly unit: "AHU-1" | "AHU-2";
  readonly floor: Floor;
  readonly level: Level;
  readonly cfm: number;
  /** The trunks' depth, in inches. */
  readonly depth: number;
  readonly nodes: Readonly<Record<string, Point>>;
  /** Trunk edges, parent to child, from the unit's supply at node R. */
  readonly trunks: readonly (readonly [string, string])[];
  readonly outlets: readonly Outlet[];
  readonly returns: readonly ReturnGrille[];
  /** Jump ducts: a ceiling grille in a closed room to one outside it. */
  readonly jumps: readonly (readonly [Point, Point])[];
}

export const SYSTEMS: readonly DuctSystem[] = [
  {
    unit: "AHU-1",
    floor: "L1",
    level: L1,
    cfm: 1200,
    depth: 10,
    nodes: {
      R: [201, 273],
      a: [201, 400],
      w: [60, 400],
      b: [349, 400],
      c: [500, 400],
      e: [575, 400],
      s: [500, 110],
    },
    trunks: [
      ["R", "a"],
      ["a", "w"],
      ["a", "b"],
      ["b", "c"],
      ["c", "e"],
      ["c", "s"],
    ],
    outlets: [
      { room: "KITCHEN", at: [180, 362], from: ["a", "w"] },
      { room: "KITCHEN", at: [300, 462], from: ["a", "b"] },
      { room: "LAUNDRY", at: [100, 352], from: ["a", "w"] },
      { room: "PWDR.", at: [45, 452], from: ["a", "w"] },
      { room: "FOYER", at: [349, 140], from: ["a", "b"] },
      { room: "GREAT ROOM", at: [450, 488], from: ["b", "c"] },
      { room: "GREAT ROOM", at: [596, 330], from: ["c", "e"] },
      { room: "GREAT ROOM", at: [440, 250], from: ["c", "s"] },
      { room: "STUDY", at: [450, 48], from: ["c", "s"] },
      { room: "STUDY", at: [560, 48], from: ["c", "s"] },
    ],
    returns: [
      {
        tag: "RA-1",
        room: "GREAT ROOM",
        at: [408, 330],
        face: 24,
        path: [
          [396, 330],
          [180, 330],
          [180, 282],
        ],
        diameter: 18,
      },
    ],
    jumps: [
      [
        [398, 170],
        [366, 170],
      ],
    ],
  },
  {
    unit: "AHU-2",
    floor: "L2",
    level: L2,
    cfm: 1200,
    depth: 10,
    nodes: {
      R: [333, 186],
      n: [333, 400],
      m: [333, 290],
      w1: [110, 290],
      ws: [110, 110],
      wn: [110, 420],
      e1: [500, 290],
      es: [500, 110],
      en: [500, 450],
    },
    trunks: [
      ["R", "m"],
      ["m", "n"],
      ["m", "w1"],
      ["w1", "ws"],
      ["w1", "wn"],
      ["m", "e1"],
      ["e1", "es"],
      ["e1", "en"],
    ],
    outlets: [
      { room: "BEDROOM 2", at: [56, 48], from: ["w1", "ws"] },
      { room: "BEDROOM 2", at: [40, 160], from: ["w1", "ws"] },
      { room: "BATH 2", at: [176, 262], from: ["w1", "ws"] },
      { room: "BEDROOM 3", at: [40, 400], from: ["w1", "wn"] },
      { room: "BEDROOM 3", at: [160, 492], from: ["w1", "wn"] },
      { room: "LOFT", at: [298, 350], from: ["m", "n"] },
      { room: "LOFT", at: [272, 470], from: ["m", "n"] },
      { room: "HALL", at: [326, 86], from: ["e1", "es"] },
      { room: "OWNER'S BATH", at: [440, 96], from: ["e1", "es"] },
      { room: "OWNER'S BATH", at: [562, 112], from: ["e1", "es"] },
      { room: "OWNER'S CLOSET", at: [562, 218], from: ["e1", "es"] },
      { room: "OWNER'S BEDROOM", at: [504, 496], from: ["e1", "en"] },
      { room: "OWNER'S BEDROOM", at: [596, 448], from: ["e1", "en"] },
      { room: "OWNER'S BEDROOM", at: [596, 340], from: ["e1", "en"] },
    ],
    returns: [
      {
        tag: "RA-2",
        room: "LANDING",
        at: [352, 114],
        face: 24,
        path: [
          [340, 114],
          [333, 114],
          [333, 130],
        ],
        diameter: 18,
      },
    ],
    jumps: [
      [
        [196, 176],
        [244, 176],
      ],
      [
        [196, 420],
        [250, 420],
      ],
      [
        [404, 460],
        [360, 460],
      ],
    ],
  },
];

const area = (r: Rect) => ((r[2] - r[0]) * (r[3] - r[1])) / 144;
const roomRect = (level: Level, name: string): Rect => {
  const r = level.rooms.find((x) => x.name === name);
  if (!r) throw new Error(`No room ${name} on ${level.name}`);
  return r.rect;
};

/** Each room's supply: its share of the system's air by floor area, split over its outlets. */
export function roomAir(
  s: DuctSystem,
): { room: string; outlets: number; cfm: number; each: number; neck: number }[] {
  const names = [...new Set(s.outlets.map((o) => o.room))];
  const areas = names.map((n) => {
    const room = s.level.rooms.find((x) => x.name === n)!;
    return room.area ?? area(roomRect(s.level, n));
  });
  const total = areas.reduce((a, b) => a + b, 0);
  return names.map((room, k) => {
    const outlets = s.outlets.filter((o) => o.room === room).length;
    const each = Math.round((s.cfm * areas[k]!) / total / outlets / 5) * 5;
    return { room, outlets, cfm: each * outlets, each, neck: flexSize(each) };
  });
}

/** A flex run-out's size for its air, at about 0.08 in. w.c. per 100 ft. */
export function flexSize(cfm: number): number {
  const sizes: [number, number][] = [
    [6, 100],
    [7, 140],
    [8, 190],
    [9, 250],
    [10, 320],
    [12, 500],
  ];
  const hit = sizes.find(([, max]) => cfm <= max);
  if (!hit) throw new Error(`No flex size for ${cfm} CFM`);
  return hit[0];
}

/** A rectangular trunk's width for its air at 900 fpm, at the system's depth. */
export const trunkWidth = (cfm: number, depth: number): number =>
  Math.max(10, Math.ceil((cfm * 144) / 900 / depth / 2) * 2);

/** The point of segment a-b nearest p. */
export function project(p: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)),
  );
  return [a[0] + t * dx, a[1] + t * dy];
}

/** Each trunk edge with the air it carries: its own outlets and everything downstream. */
export function trunkAir(
  s: DuctSystem,
): { from: string; to: string; cfm: number; width: number }[] {
  const each = new Map(roomAir(s).map((r) => [r.room, r.each]));
  const own = (e: readonly [string, string]) =>
    s.outlets
      .filter((o) => o.from[0] === e[0] && o.from[1] === e[1])
      .reduce((t, o) => t + each.get(o.room)!, 0);
  const below = (e: readonly [string, string]): number =>
    own(e) + s.trunks.filter((x) => x[0] === e[1]).reduce((t, x) => t + below(x), 0);
  return s.trunks.map((e) => {
    const cfm = below(e);
    return { from: e[0], to: e[1], cfm, width: trunkWidth(cfm, s.depth) };
  });
}

// ---------------------------------------------------------------------------------------------
// Exhausts.

export interface Exhaust {
  readonly tag: string;
  readonly serves: string;
  readonly floor: Floor;
  readonly at: Point;
  readonly cfm: number;
  readonly duct: string;
  /** The duct's route to its termination, the last point being the cap. */
  readonly route: readonly Point[];
  readonly cap: "WALL" | "ROOF";
  readonly capNote: string;
  /** The E-101 circuit, by key. */
  readonly ckt: string;
}

/** The bath fans are E-101's exhaust devices; this finds each by where it is. */
const fan = (floor: Floor, at: Point) => {
  const dv = DEVICES.find(
    (x) => x.block === "E-EXHAUST" && x.floor === floor && x.at[0] === at[0] && x.at[1] === at[1],
  );
  if (!dv) throw new Error(`No exhaust fan on E-101 at ${floor} ${at.join(",")}`);
  return dv;
};

export const EXHAUSTS: readonly Exhaust[] = (() => {
  const f1 = fan("L1", [22, 496]);
  const f2 = fan("L2", [96, 285]);
  const f3 = fan("L2", [570, 75]);
  const f4 = fan("L2", [596, 140]);
  return [
    {
      tag: "EF-1",
      serves: "PWDR.",
      floor: "L1",
      at: f1.at,
      cfm: 50,
      duct: '4" ALUM.',
      route: [f1.at, [22, 528]],
      cap: "WALL",
      capNote: "WALL CAP, N. WALL",
      ckt: f1.ckt,
    },
    {
      tag: "EF-2",
      serves: "BATH 2",
      floor: "L2",
      at: f2.at,
      cfm: 80,
      duct: '4" INSUL. FLEX',
      route: [f2.at, [70, 285], [70, 250]],
      cap: "ROOF",
      capNote: "ROOF CAP",
      ckt: f2.ckt,
    },
    {
      tag: "EF-3",
      serves: "OWNER'S SHOWER",
      floor: "L2",
      at: f3.at,
      cfm: 80,
      duct: '4" INSUL. FLEX',
      route: [f3.at, [596, 75], [596, 40]],
      cap: "ROOF",
      capNote: "ROOF CAP",
      ckt: f3.ckt,
    },
    {
      tag: "EF-4",
      serves: "OWNER'S WC",
      floor: "L2",
      at: f4.at,
      cfm: 80,
      duct: '4" INSUL. FLEX',
      route: [f4.at, [596, 176]],
      cap: "ROOF",
      capNote: "ROOF CAP",
      ckt: f4.ckt,
    },
    {
      tag: "KH-1",
      serves: "RANGE (MICRO-HOOD)",
      floor: "L1",
      at: [150, 394],
      cfm: 300,
      duct: '6" GALV. STEEL',
      route: [
        [150, 394],
        [150, 528],
      ],
      cap: "WALL",
      capNote: "WALL CAP, N. WALL",
      ckt: "MW",
    },
    {
      tag: "DE-1",
      serves: "CLOTHES DRYER",
      floor: "L1",
      at: [55, 405],
      cfm: 0,
      duct: '4" RIGID METAL',
      route: [
        [55, 405],
        [0, 405],
      ],
      cap: "WALL",
      capNote: "WALL CAP, W. WALL",
      ckt: "DRYER",
    },
  ];
})();

/** The dryer duct's developed length, FBC-R M1502.4.5.1: run plus 5 ft per 90 degree elbow. */
export function dryerLength(): { run: number; elbows: number; total: number } {
  const de = EXHAUSTS.find((x) => x.tag === "DE-1")!;
  const run =
    de.route
      .slice(1)
      .reduce((s, p, k) => s + Math.hypot(p[0] - de.route[k]![0], p[1] - de.route[k]![1]), 0) / 12;
  // One 90 at the dryer's outlet, turning along the wall; the wall cap is straight through.
  const elbows = 1;
  const total = run + 5 * elbows;
  if (total > 35) throw new Error(`The dryer duct is ${total.toFixed(1)} ft developed, past 35 ft`);
  return { run, elbows, total };
}

// ---------------------------------------------------------------------------------------------
// Piping and controls.

/** Refrigerant line sets, from each heat pump to its air handler. AHU-2's rises in the east wall. */
export const LINESETS: { floor: Floor; path: Point[] }[] = [
  {
    floor: "L1",
    path: [
      [636, 214],
      [610, 214],
      [610, 304],
      [222, 304],
      [222, 280],
      [216, 280],
    ],
  },
  {
    floor: "L2",
    path: [
      [624, 268],
      [596, 268],
      [596, 236],
      [360, 236],
      [360, 160],
      [344, 160],
    ],
  },
];

/**
 * Condensate drains and the WH-1 pan drain, to the outside 6" to 24" above grade. The garage's
 * front pier holds a flood vent at x 240, so the two drains leave it east of the vent.
 */
export const DRAINS: { floor: Floor; label: string; path: Point[] }[] = [
  {
    floor: "L1",
    label: "AHU-1 COND.",
    path: [
      [214, 262],
      [214, 238],
      [254, 238],
      [254, -6],
    ],
  },
  {
    floor: "L1",
    label: "WH-1 PAN",
    path: [
      [257, 256],
      [260, 256],
      [260, -6],
    ],
  },
  {
    floor: "L2",
    label: "AHU-2 COND.",
    path: [
      [344, 140],
      [370, 140],
      [370, 230],
      [604, 230],
      [604, 262],
      [624, 262],
    ],
  },
];

export const THERMOSTATS: { tag: string; floor: Floor; at: Point }[] = [
  { tag: "T-1", floor: "L1", at: [374, 192] },
  { tag: "T-2", floor: "L2", at: [374, 330] },
];
