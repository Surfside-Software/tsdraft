// The electrical design of the house, once: the circuits, every device and where it is, in
// building coordinates. E-101 draws the plans, the panel schedule and the load calculation from
// this, so a receptacle added to a room shows up in its circuit's count and load.
import type { Point } from "../../../src/index.ts";
import {
  areas,
  ATTIC_ACCESS,
  GARAGE_STEPS,
  L1,
  L2,
  type Level,
  type Rect,
} from "../model/house.ts";
import { ATTIC, center, EQUIP } from "./mep-equip.ts";

export type Floor = "L1" | "L2";

/** A branch circuit, before it gets its breaker positions. */
export interface CircuitDef {
  readonly key: string;
  readonly desc: string;
  readonly amps: number;
  readonly poles: 1 | 2;
  /** Breaker type: AF (combination AFCI), GF (GFCI), DF (dual function), or plain. */
  readonly type?: "AF" | "GF" | "DF";
  /** A fixed load in VA, for an appliance or a small-appliance circuit. Else the devices add up. */
  readonly va?: number;
  /** What the load calculation counts it as. */
  readonly calc?: "sabc" | "laundry" | "appliance" | "hvac" | "general";
}

export const WIRE: Record<number, string> = {
  15: "#14",
  20: "#12",
  30: "#10",
  40: "#8",
  50: "#6",
  60: "#6",
};

/** The circuits, in the order they go into the panel. */
export const CIRCUIT_DEFS: readonly CircuitDef[] = [
  { key: "AHU1", desc: "AHU-1 + 5 KW HEAT", amps: 40, poles: 2, va: 5800, calc: "hvac" },
  { key: "HP1", desc: "HP-1 CONDENSER", amps: 30, poles: 2, va: 4400, calc: "hvac" },
  { key: "AHU2", desc: "AHU-2 + 5 KW HEAT", amps: 40, poles: 2, va: 5800, calc: "hvac" },
  { key: "HP2", desc: "HP-2 CONDENSER", amps: 30, poles: 2, va: 4400, calc: "hvac" },
  { key: "RANGE", desc: "RANGE", amps: 50, poles: 2, va: 12000, calc: "appliance" },
  { key: "WH", desc: "WATER HEATER, 50 GAL.", amps: 30, poles: 2, va: 4500, calc: "appliance" },
  { key: "DRYER", desc: "DRYER", amps: 30, poles: 2, type: "GF", va: 5000, calc: "appliance" },
  {
    key: "SABC1",
    desc: "KIT. COUNTER RECEPT.",
    amps: 20,
    poles: 1,
    type: "DF",
    va: 1500,
    calc: "sabc",
  },
  {
    key: "SABC2",
    desc: "KIT. COUNTER RECEPT.",
    amps: 20,
    poles: 1,
    type: "DF",
    va: 1500,
    calc: "sabc",
  },
  {
    key: "SABC3",
    desc: "ISLAND + DINING RECEPT.",
    amps: 20,
    poles: 1,
    type: "DF",
    va: 1500,
    calc: "sabc",
  },
  { key: "REF", desc: "REFRIGERATOR", amps: 20, poles: 1, type: "AF", va: 800, calc: "appliance" },
  { key: "DW", desc: "DISHWASHER", amps: 20, poles: 1, type: "DF", va: 1200, calc: "appliance" },
  { key: "DISP", desc: "DISPOSAL", amps: 20, poles: 1, type: "AF", va: 900, calc: "appliance" },
  {
    key: "MW",
    desc: "MICROWAVE / HOOD",
    amps: 20,
    poles: 1,
    type: "AF",
    va: 1500,
    calc: "appliance",
  },
  {
    key: "LAUN",
    desc: "LAUNDRY RECEPT.",
    amps: 20,
    poles: 1,
    type: "DF",
    va: 1500,
    calc: "laundry",
  },
  { key: "GAR", desc: "GARAGE RECEPT. + GDO", amps: 20, poles: 1, type: "GF" },
  { key: "EXT", desc: "EXTERIOR RECEPT., WP", amps: 20, poles: 1, type: "GF" },
  { key: "BATH1", desc: "PWDR. + BATH 2 RECEPT.", amps: 20, poles: 1, type: "GF" },
  { key: "BATH2", desc: "OWNER'S BATH RECEPT.", amps: 20, poles: 1, type: "GF" },
  { key: "R1A", desc: "RECEPT. STUDY, FOYER", amps: 20, poles: 1, type: "AF" },
  { key: "R1B", desc: "RECEPT. GREAT ROOM", amps: 20, poles: 1, type: "AF" },
  { key: "L1A", desc: "LTG. KITCHEN, GREAT RM.", amps: 15, poles: 1, type: "AF" },
  { key: "L1B", desc: "LTG. GAR., LAUN., FOYER, EXT.", amps: 15, poles: 1, type: "AF" },
  { key: "R2A", desc: "RECEPT. BED 2, BED 3, HALL", amps: 20, poles: 1, type: "AF" },
  { key: "R2B", desc: "RECEPT. OWNER'S BED, LOFT", amps: 20, poles: 1, type: "AF" },
  { key: "L2A", desc: "LTG. BED 2, BED 3, BATH 2", amps: 15, poles: 1, type: "AF" },
  { key: "L2B", desc: "LTG. OWNER'S SUITE, LOFT", amps: 15, poles: 1, type: "AF" },
  { key: "SMK", desc: "SMOKE / CO ALARMS", amps: 15, poles: 1, type: "AF" },
  { key: "ATTIC", desc: "ATTIC SVC. RECEPT. + LTG.", amps: 20, poles: 1, type: "GF" },
  { key: "SPARE1", desc: "SPARE", amps: 20, poles: 1 },
  { key: "SPARE2", desc: "SPARE", amps: 20, poles: 1 },
];

/** The panel: 40 spaces, odd on the left, even on the right, top to bottom. */
export const PANEL = {
  name: "A",
  spaces: 40,
  amps: 200,
  main: 200,
  volts: "120/240 V, 1 PH, 3 W",
  aic: 22,
} as const;

export interface Circuit extends CircuitDef {
  /** Breaker positions: one, or two for a two-pole breaker. */
  readonly positions: readonly number[];
  /** "A-1,3". */
  readonly label: string;
}

/** Places each circuit in the panel: each goes in the column whose next space is lower. */
function placeCircuits(defs: readonly CircuitDef[]): Circuit[] {
  const next = { odd: 1, even: 2 };
  return defs.map((c) => {
    const side = next.odd <= next.even - 1 ? "odd" : "even";
    const first = next[side];
    const positions = c.poles === 2 ? [first, first + 2] : [first];
    next[side] = first + 2 * c.poles;
    if (positions.at(-1)! > PANEL.spaces)
      throw new Error(`Panel ${PANEL.name} is full at ${c.key}`);
    return { ...c, positions, label: `${PANEL.name}-${positions.join(",")}` };
  });
}

export const CIRCUITS = placeCircuits(CIRCUIT_DEFS);
export const circuit = (key: string): Circuit => {
  const c = CIRCUITS.find((x) => x.key === key);
  if (!c) throw new Error(`No circuit ${key}`);
  return c;
};

// ---------------------------------------------------------------------------------------------
// Devices.

export type Block =
  | "E-DUPLEX"
  | "E-GFCI"
  | "E-SWITCH"
  | "E-SWITCH3"
  | "E-CEILING"
  | "E-RECESSED"
  | "E-FAN"
  | "E-WALLLIGHT"
  | "E-SMOKE"
  | "E-EXHAUST"
  | "E-PANEL"
  | "E-220"
  | "E-DISC";

export interface Device {
  readonly block: Block;
  readonly floor: Floor;
  readonly at: Point;
  readonly rot: number;
  readonly ckt: string;
  /** A short label beside the symbol: WP, DW, REF, a switch's letter. */
  readonly tag?: string | undefined;
  /** The switch group a switch or a fixture belongs to. */
  readonly group?: string | undefined;
}

/** Load of each kind of device, in VA, where the circuit has no fixed load. */
export const DEVICE_VA: Partial<Record<Block, number>> = {
  "E-DUPLEX": 180,
  "E-GFCI": 180,
  "E-CEILING": 60,
  "E-RECESSED": 15,
  "E-FAN": 100,
  "E-WALLLIGHT": 40,
  "E-SMOKE": 5,
  "E-EXHAUST": 50,
};

export const isReceptacle = (b: Block) => b === "E-DUPLEX" || b === "E-GFCI";
export const isSwitch = (b: Block) => b === "E-SWITCH" || b === "E-SWITCH3";
export const isLight = (b: Block) =>
  b === "E-CEILING" ||
  b === "E-RECESSED" ||
  b === "E-FAN" ||
  b === "E-WALLLIGHT" ||
  b === "E-EXHAUST";

const devices: Device[] = [];
/** The circuit key of a device on no branch circuit: the panel itself. */
export const NO_CIRCUIT = "PANEL";
const add = (
  floor: Floor,
  block: Block,
  at: Point,
  ckt: string,
  o: { rot?: number; tag?: string | undefined; group?: string } = {},
) => {
  if (ckt !== NO_CIRCUIT) circuit(ckt);
  devices.push({ block, floor, at, ckt, rot: o.rot ?? 0, tag: o.tag, group: o.group });
};

// --- Receptacles along walls: NEC 210.52(A), no point of the wall line more than 6 ft from one.

const inRect = (r: Rect, p: Point, grow = 0) =>
  p[0] >= r[0] - grow && p[0] <= r[2] + grow && p[1] >= r[1] - grow && p[1] <= r[3] + grow;

/**
 * The places along a room's wall line for receptacles, at most 12 ft apart and 6 ft from each
 * end of a run of wall. The wall line runs round the corners; a door, an opening with no wall,
 * or a `skip` zone (counters, appliances) ends a run. Returns each point with the rotation of its
 * wall, set in from the wall's face by `inset`.
 */
export function wallReceptacles(
  level: Level,
  room: Rect,
  inset: number,
  skip: readonly Rect[] = [],
): { at: Point; rot: number }[] {
  const [x0, y0, x1, y1] = room;
  const w = x1 - x0;
  const h = y1 - y0;
  const perim = 2 * (w + h);
  // A point on the perimeter at s, its outward normal and its wall's rotation.
  const along = (s: number): { p: Point; n: Point; rot: number } => {
    if (s < w) return { p: [x0 + s, y0], n: [0, -1], rot: 0 };
    if (s < w + h) return { p: [x1, y0 + (s - w)], n: [1, 0], rot: 90 };
    if (s < 2 * w + h) return { p: [x1 - (s - w - h), y1], n: [0, 1], rot: 0 };
    return { p: [x0, y1 - (s - 2 * w - h)], n: [-1, 0], rot: 90 };
  };
  const breaks = level.openings.filter((o) => o.kind !== "window").map((o) => o.cut);
  const isWall = (s: number) => {
    const { p, n } = along(s);
    const out: Point = [p[0] + n[0] * 2, p[1] + n[1] * 2];
    if (!level.walls.some((r) => inRect(r, out, 0.5))) return false;
    if (breaks.some((r) => inRect(r, out, 1))) return false;
    if (skip.some((r) => inRect(r, p, 1))) return false;
    return true;
  };
  const step = 1;
  const flags: boolean[] = [];
  for (let s = 0; s < perim; s += step) flags.push(isWall(s + step / 2));
  // Runs of wall, joined across the start of the perimeter.
  const runs: [number, number][] = [];
  let start: number | undefined;
  flags.forEach((f, k) => {
    if (f && start === undefined) start = k;
    if (!f && start !== undefined) {
      runs.push([start, k]);
      start = undefined;
    }
  });
  if (start !== undefined) {
    if (runs.length && runs[0]![0] === 0) runs[0] = [start - flags.length, runs[0]![1]];
    else runs.push([start, flags.length]);
  }
  const corners = [0, w, w + h, 2 * w + h, perim];
  const out: { at: Point; rot: number }[] = [];
  for (const [a, b] of runs) {
    const len = (b - a) * step;
    if (len < 24) continue; // NEC 210.52(A)(2)(1): wall space is 2 ft or more.
    // Spread n receptacles along the run, kept 12" off the corners, and add one until no point
    // of the run is more than 6 ft from one: NEC 210.52(A)(1).
    const place = (n: number): number[] =>
      Array.from({ length: n }, (_, i) => {
        let s = a * step + ((i + 0.5) * len) / n;
        for (const c of corners) {
          const cs = c + Math.floor((a * step) / perim) * perim;
          for (const cc of [cs, cs + perim, cs - perim])
            if (Math.abs(s - cc) < 12) s = s < cc ? cc - 12 : cc + 12;
        }
        return Math.min(Math.max(s, a * step), b * step);
      });
    const covered = (ss: number[]) => {
      for (let t = a * step; t <= b * step; t += 2)
        if (Math.min(...ss.map((x) => Math.abs(x - t))) > 72) return false;
      return true;
    };
    let n = Math.max(1, Math.ceil(len / 144));
    while (!covered(place(n))) n++;
    for (const s0 of place(n)) {
      const s = ((s0 % perim) + perim) % perim;
      const { p, n: nn, rot } = along(s);
      out.push({ at: [p[0] - nn[0] * inset, p[1] - nn[1] * inset], rot });
    }
  }
  return out;
}

/** Receptacles on the countertops along a wall, at most 4 ft apart: NEC 210.52(C)(1). */
function counterReceptacles(
  from: Point,
  to: Point,
  ckts: readonly string[],
  rot: number,
  floor: Floor,
  k0 = 0,
): number {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (len < 12) return k0;
  const n = Math.max(1, Math.ceil(len / 48));
  let k = k0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    add(
      floor,
      "E-GFCI",
      [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t],
      ckts[k % ckts.length]!,
      { rot },
    );
    k++;
  }
  return k;
}

const room = (level: Level, name: string, nth = 0): Rect => {
  const r = level.rooms.filter((x) => x.name === name)[nth];
  if (!r) throw new Error(`No room ${name}`);
  return r.rect;
};

const INSET = 5; // inches from a wall's face to a receptacle's middle
/** Panel A, on the garage's west wall north of door 109. */
export const PANEL_AT: Point = [12, 192];
const walls = (
  floor: Floor,
  level: Level,
  name: string,
  ckt: string,
  block: Block = "E-DUPLEX",
  skip: Rect[] = [],
  nth = 0,
  tag?: string,
) => {
  for (const r of wallReceptacles(level, room(level, name, nth), INSET, skip))
    add(floor, block, r.at, ckt, { rot: r.rot, tag });
};

/** Switches and the fixtures they control: the switch legs run from the first switch. */
const sw = (
  floor: Floor,
  group: string,
  ckt: string,
  switches: readonly [Point, "S" | "S3"][],
  fixtures: readonly [Block, Point, number?][],
) => {
  for (const [at, kind] of switches)
    add(floor, kind === "S3" ? "E-SWITCH3" : "E-SWITCH", at, ckt, {
      group,
      tag: group.length <= 2 ? group : undefined,
    });
  for (const [block, at, rot] of fixtures) add(floor, block, at, ckt, { group, rot: rot ?? 0 });
};

// --- First floor. ------------------------------------------------------------------------------
{
  const F = "L1" as const;
  const lv = L1;
  // Garage: GFCI receptacles on the walls, clear of the panel, the steps at door 103 and the
  // AHU-1 / WH-1 corner; the door opener's on the ceiling; the panel north of door 109.
  const g = GARAGE_STEPS;
  const stepsLow = g.top - g.landing - (g.risers - 1) * g.tread;
  walls(F, lv, "GARAGE", "GAR", "E-GFCI", [
    [8, PANEL_AT[1] - 14, 20, PANEL_AT[1] + 14],
    [EQUIP.ahu1[0] - 12, 232, 264, 288],
    [8, stepsLow - 8, g.x1 + 4, 288],
  ]);
  add(F, "E-GFCI", [120, 128], "GAR", { tag: "GDO" });
  // Three-way switches at the landing by door 103 and at door 109's latch side.
  sw(
    F,
    "a",
    "L1B",
    [
      [[g.x0, g.top - 10], "S3"],
      [[14, 110], "S3"],
    ],
    [
      ["E-CEILING", [70, 70]],
      ["E-CEILING", [190, 70]],
      ["E-CEILING", [70, 200]],
      ["E-CEILING", [160, 200]],
    ],
  );
  sw(
    F,
    "b",
    "L1B",
    [[[g.x0, g.top - 24], "S"]],
    [
      ["E-WALLLIGHT", [12, -4], 180],
      ["E-WALLLIGHT", [226, -4], 180],
      ["E-WALLLIGHT", [-4, 166], 90],
    ],
  );
  add(F, "E-PANEL", PANEL_AT, NO_CIRCUIT, { rot: 90 });
  // WH-1 in the garage's northeast corner, on its platform; AHU-1 on its stand west of it.
  add(F, "E-220", [248, 236], "WH", { tag: "WH" });
  add(F, "E-DISC", [EQUIP.ahu1[0] - 10, EQUIP.ahu1[3] - 8], "AHU1", { tag: "AHU-1" });
  // The heat pumps on their pad by the east wall, each with its disconnect on the wall, and a
  // service receptacle between them.
  add(F, "E-DISC", [628, center(EQUIP.hp1)[1]], "HP1", { tag: "HP-1" });
  add(F, "E-DISC", [628, center(EQUIP.hp2)[1]], "HP2", { tag: "HP-2" });
  add(F, "E-GFCI", [628, EQUIP.hp1[1] - 16], "EXT", { rot: 90, tag: "WP" });
  // Laundry.
  add(F, "E-220", [55, 403], "DRYER", { tag: "DRYER" });
  add(F, "E-GFCI", [85, 403], "LAUN", { tag: "W" });
  add(F, "E-GFCI", [13, 320], "LAUN", { rot: 90 });
  sw(F, "c", "L1B", [[[126, 358], "S"]], [["E-CEILING", [70, 345]]]);
  // Powder room and pantry.
  add(F, "E-GFCI", [67, 497], "BATH1", { rot: 90 });
  sw(
    F,
    "d",
    "L1B",
    [[[62, 418], "S"]],
    [
      ["E-CEILING", [40, 470]],
      ["E-EXHAUST", [22, 496]],
    ],
  );
  sw(F, "e", "L1B", [[[126, 432], "S"]], [["E-CEILING", [104, 466]]]);
  // Kitchen: counter receptacles on two small-appliance circuits, the island's, appliances.
  let k = counterReceptacles([160.5, 515], [226, 515], ["SABC1", "SABC2"], 0, F);
  k = counterReceptacles([278, 515], [379.5, 515], ["SABC1", "SABC2"], 0, F, k);
  k = counterReceptacles([141.5, 362], [141.5, 412], ["SABC1", "SABC2"], 90, F, k);
  counterReceptacles([141.5, 448], [141.5, 494], ["SABC1", "SABC2"], 90, F, k);
  // The island: 108" x 42" is 31.5 sq ft, one for the first 9 and one per 18 more (210.52(C)(2)).
  const islandSf = (108 * 42) / 144;
  const islandN = 1 + Math.ceil((islandSf - 9) / 18);
  for (let i = 0; i < islandN; i++)
    add(F, "E-GFCI", [204 + ((i + 0.5) * 108) / islandN, 389], "SABC3");
  walls(F, lv, "KITCHEN", "SABC3", "E-DUPLEX", [
    [136.5, 292.5, 160.5, 520],
    [136.5, 496, 379.5, 520],
  ]);
  add(F, "E-220", [141.5, 424], "RANGE", { rot: 90, tag: "R" });
  add(F, "E-DUPLEX", [141.5, 340], "REF", { rot: 90, tag: "REF" });
  // Under the sink: the dishwasher's and the disposal's outlets. The disposal's switch is on
  // the backsplash beside the sink.
  add(F, "E-GFCI", [272, 501], "DW", { tag: "DW" });
  add(F, "E-DUPLEX", [236, 501], "DISP", { tag: "DISP" });
  add(F, "E-SWITCH", [273, 515], "DISP", { tag: "SD" });
  add(F, "E-DUPLEX", [141.5, 444], "MW", { rot: 90, tag: "MW" });
  sw(
    F,
    "f",
    "L1A",
    [[[312, 298], "S"]],
    [
      ["E-RECESSED", [190, 330]],
      ["E-RECESSED", [250, 330]],
      ["E-RECESSED", [310, 330]],
      ["E-RECESSED", [355, 330]],
      ["E-RECESSED", [190, 465]],
      ["E-RECESSED", [250, 465]],
      ["E-RECESSED", [310, 465]],
      ["E-RECESSED", [355, 465]],
    ],
  );
  sw(
    F,
    "g",
    "L1A",
    [[[300, 298], "S"]],
    [
      ["E-CEILING", [222, 405]],
      ["E-CEILING", [258, 405]],
      ["E-CEILING", [294, 405]],
    ],
  );
  // Foyer, stair and porch.
  walls(F, lv, "FOYER", "R1A", "E-DUPLEX", [[318.5, 80, 330, 120]]);
  sw(F, "h", "L1B", [[[372, 90], "S"]], [["E-CEILING", [349, 190]]]);
  sw(
    F,
    "j",
    "L1B",
    [[[358, 90], "S"]],
    [
      ["E-WALLLIGHT", [314, 68], 180],
      ["E-WALLLIGHT", [376, 68], 180],
    ],
  );
  sw(F, "k", "L1B", [[[324, 104], "S3"]], [["E-WALLLIGHT", [276, 200], -90]]);
  add(F, "E-GFCI", [290, 67], "EXT", { tag: "WP" });
  // Study.
  walls(F, lv, "STUDY", "R1A");
  sw(F, "m", "L1A", [[[390, 168], "S"]], [["E-FAN", [500, 100]]]);
  // Great room and lanai.
  walls(F, lv, "GREAT ROOM", "R1B");
  sw(
    F,
    "n",
    "L1A",
    [[[390, 272], "S"]],
    [
      ["E-RECESSED", [425, 250]],
      ["E-RECESSED", [575, 250]],
      ["E-RECESSED", [425, 360]],
      ["E-RECESSED", [575, 360]],
      ["E-RECESSED", [425, 470]],
      ["E-RECESSED", [575, 470]],
    ],
  );
  sw(F, "p", "L1A", [[[402, 272], "S"]], [["E-FAN", [500, 360]]]);
  sw(
    F,
    "q",
    "L1B",
    [[[424, 513], "S"]],
    [
      ["E-FAN", [460, 605]],
      ["E-FAN", [560, 605]],
    ],
  );
  sw(
    F,
    "r",
    "L1B",
    [[[412, 513], "S"]],
    [
      ["E-WALLLIGHT", [420, 532], 0],
      ["E-WALLLIGHT", [588, 532], 0],
    ],
  );
  add(F, "E-GFCI", [400, 533], "EXT", { tag: "WP" });
  add(F, "E-GFCI", [604, 533], "EXT", { tag: "WP" });
  // Smoke and CO alarms.
  add(F, "E-SMOKE", [349, 245], "SMK");
  add(F, "E-SMOKE", [560, 150], "SMK");
}

// --- Second floor. -----------------------------------------------------------------------------
{
  const F = "L2" as const;
  const lv = L2;
  walls(F, lv, "BEDROOM 2", "R2A");
  sw(F, "a", "L2A", [[[210, 194], "S"]], [["E-FAN", [111, 105]]]);
  sw(F, "b", "L2A", [[[56, 198], "S"]], [["E-CEILING", [34, 262]]]);
  // Bath 2.
  add(F, "E-GFCI", [176, 214], "BATH1");
  sw(
    F,
    "c",
    "L2A",
    [[[210, 222], "S"]],
    [
      ["E-RECESSED", [141, 245]],
      ["E-RECESSED", [141, 296]],
      ["E-EXHAUST", [96, 285]],
    ],
  );
  walls(F, lv, "BEDROOM 3", "R2A");
  sw(F, "d", "L2A", [[[210, 332], "S"]], [["E-FAN", [111, 395]]]);
  sw(F, "e", "L2A", [[[88, 467], "S"]], [["E-CEILING", [36, 506]]]);
  walls(F, lv, "HALL", "R2A");
  sw(
    F,
    "f",
    "L2A",
    [
      [[226, 112], "S3"],
      [[262, 278], "S3"],
    ],
    [
      ["E-CEILING", [296, 56]],
      ["E-CEILING", [350, 56]],
      ["E-CEILING", [244, 190]],
    ],
  );
  // Loft.
  walls(F, lv, "LOFT", "R2B");
  sw(
    F,
    "g",
    "L2B",
    [[[226, 280], "S"]],
    [
      ["E-RECESSED", [260, 335]],
      ["E-RECESSED", [340, 335]],
      ["E-RECESSED", [260, 470]],
      ["E-RECESSED", [340, 470]],
    ],
  );
  // Owner's suite.
  walls(F, lv, "OWNER'S BEDROOM", "R2B");
  sw(F, "h", "L2B", [[[390, 392], "S"]], [["E-FAN", [501, 395]]]);
  sw(
    F,
    "j",
    "L2B",
    [[[464, 258], "S"]],
    [
      ["E-CEILING", [440, 218]],
      ["E-CEILING", [560, 218]],
    ],
  );
  add(F, "E-GFCI", [456, 163], "BATH2");
  add(F, "E-GFCI", [546, 163], "BATH2");
  sw(
    F,
    "k",
    "L2B",
    [[[412, 160], "S"]],
    [
      ["E-RECESSED", [430, 100]],
      ["E-RECESSED", [501, 110]],
      ["E-RECESSED", [430, 40]],
      ["E-RECESSED", [570, 30]],
      ["E-WALLLIGHT", [484, 164], 180],
      ["E-WALLLIGHT", [518, 164], 180],
    ],
  );
  sw(
    F,
    "m",
    "L2B",
    [[[392, 160], "S"]],
    [
      ["E-EXHAUST", [570, 75]],
      ["E-EXHAUST", [596, 140]],
    ],
  );
  // AHU-2 in the attic over the landing (M-101): its disconnect and a service receptacle at the
  // unit, and lights over the passage at the access and over the service space, switched at the
  // access (FBC-R M1305.1.3.1, NEC 210.63, 210.70(A)(3)).
  const svc = center(ATTIC.service);
  add(F, "E-DISC", [EQUIP.ahu2[0] - 6, EQUIP.ahu2[3] - 4], "AHU2", { tag: "AHU-2" });
  add(F, "E-GFCI", [ATTIC.service[0] - 7, ATTIC.service[1] - 7], "ATTIC", { tag: "ATTIC" });
  sw(
    F,
    "n",
    "ATTIC",
    [[[ATTIC_ACCESS[2] + 6, ATTIC_ACCESS[3] - 6], "S"]],
    [
      ["E-CEILING", [(ATTIC_ACCESS[0] + ATTIC_ACCESS[2]) / 2, ATTIC_ACCESS[3] + 18]],
      ["E-CEILING", svc],
    ],
  );
  // Smoke and CO alarms: each bedroom, outside the sleeping rooms, the loft.
  add(F, "E-SMOKE", [111, 160], "SMK");
  add(F, "E-SMOKE", [111, 440], "SMK");
  add(F, "E-SMOKE", [501, 470], "SMK");
  add(F, "E-SMOKE", [244, 240], "SMK");
  add(F, "E-SMOKE", [300, 300], "SMK");
}

export const DEVICES: readonly Device[] = devices;

/** Each circuit's devices, its load, and its count of receptacles and fixtures. */
export function circuitLoads() {
  return CIRCUITS.map((c) => {
    const ds = DEVICES.filter((x) => x.ckt === c.key);
    const counted = ds.filter((x) => DEVICE_VA[x.block] !== undefined);
    const va = c.va ?? counted.reduce((s, x) => s + DEVICE_VA[x.block]!, 0);
    return { ...c, devices: ds, count: counted.length, va, fixed: c.va !== undefined };
  });
}

/** The load calculation of NEC 220.82, the optional method for a dwelling. */
export function loadCalc() {
  const loads = circuitLoads();
  const living = Math.round(areas().living);
  const lighting = 3 * living;
  const sabc = loads.filter((c) => c.calc === "sabc").length * 1500;
  const laundry = loads.filter((c) => c.calc === "laundry").length * 1500;
  const appliances = loads.filter((c) => c.calc === "appliance");
  const general = lighting + sabc + laundry + appliances.reduce((s, c) => s + c.va, 0);
  const generalDemand = Math.min(general, 10000) + 0.4 * Math.max(0, general - 10000);
  const hvac = loads.filter((c) => c.calc === "hvac").reduce((s, c) => s + c.va, 0);
  const total = generalDemand + hvac;
  const amps = total / 240;
  return { living, lighting, sabc, laundry, appliances, general, generalDemand, hvac, total, amps };
}
