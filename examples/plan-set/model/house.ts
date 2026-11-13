// The house, once, in building coordinates: inches, from the southwest corner of the main
// block, x to the east and y to the north, toward the canal. Every plan, elevation, section,
// schedule and the site plan read this, so a moved window moves on every sheet.
import type { Point } from "../../../src/index.ts";
import { CRITERIA } from "../project.ts";

export type Rect = readonly [x0: number, y0: number, x1: number, y1: number];

export const W = 624; // 52'-0"
export const DEPTH = 528; // 44'-0"
export const LANAI: Rect = [384, 528, 616, 672];

export interface Opening {
  /** The cut through the wall. */
  readonly cut: Rect;
  readonly kind: "door" | "double" | "slider" | "overhead" | "bifold" | "cased" | "window";
  /** A door's number, or a window's type letter. */
  readonly tag?: string;
  /** For a door: the side it swings to, + or - across the wall, and the hinge end. */
  readonly swing?: 1 | -1;
  readonly hinge?: "start" | "end";
  /** The opening's height, in inches, for elevations and schedules. */
  readonly height?: number;
  /** Head height above the floor. */
  readonly head?: number;
  readonly exterior?: boolean;
  /** Which side of the wall its tag goes on, + or - across the wall, when not the room side. */
  readonly tagSide?: 1 | -1;
}

export interface Room {
  readonly name: string;
  readonly rect: Rect;
  readonly ceiling?: string;
  /** Where the tag goes, when not the middle. */
  readonly tagAt?: Point;
  /** The area in square feet, where the rectangle holds another room too. */
  readonly area?: number;
  readonly conditioned: boolean;
}

export interface Level {
  readonly name: string;
  readonly walls: readonly Rect[];
  readonly exterior: readonly Rect[];
  readonly low: readonly Rect[];
  readonly openings: readonly Opening[];
  readonly rooms: readonly Room[];
  /** The wall thickness of the exterior walls. */
  readonly ext: number;
}

/** Window types, by tag. Width and height in inches, head at 8'-0" unless noted. */
export const WINDOW_TYPES: Record<
  string,
  { width: number; height: number; kind: string; note: string }
> = {
  A: { width: 36, height: 60, kind: "SINGLE HUNG", note: "IMPACT LAMINATED, LOW-E" },
  B: { width: 48, height: 42, kind: "CASEMENT", note: "IMPACT LAMINATED, LOW-E" },
  C: { width: 24, height: 36, kind: "AWNING", note: "IMPACT, OBSCURE GLASS" },
  D: { width: 36, height: 36, kind: "SINGLE HUNG", note: "IMPACT LAMINATED, LOW-E" },
  E: { width: 72, height: 60, kind: "TWIN SINGLE HUNG", note: "IMPACT LAMINATED, LOW-E, MULLED" },
};

/** A window. `head` is its head height above the level's floor: 8'-0" on the first floor. */
const win = (tag: keyof typeof WINDOW_TYPES, cut: Rect, head = 96): Opening => ({
  cut,
  kind: "window",
  tag,
  height: WINDOW_TYPES[tag]!.height,
  head,
  exterior: true,
});
/** Second-floor heads, 7'-2" so the trim clears the soffit and every sill is 24" or more. */
const L2_HEAD = 86;
/** Garage window heads: 8'-0" above the garage slab, which is 2'-6" below the first floor. */
const GARAGE_HEAD = 66;

/**
 * The main stair: 18 risers of 7.68" over the 138.25" from floor to floor, and 17 treads of
 * 10", from a 36" landing inside the front door, going north along the garage wall.
 */
export const STAIR = {
  x0: 272,
  x1: 314,
  y0: 116,
  risers: 18,
  tread: 10,
  get treads() {
    return this.risers - 1;
  },
  get y1() {
    return this.y0 + this.treads * this.tread;
  },
};

/** The garage steps at door 103: a 36" landing at the door, then 4 risers of 7.5" down to the slab. */
export const GARAGE_STEPS = { x0: 14, x1: 62, top: 288, landing: 36, risers: 4, tread: 10 };

/** The front entry: the porch slab and 5 risers of 6.4" down to the walk, 4 treads of 11". */
export const ENTRY = { slab: 10.67, x0: 321, x1: 369, risers: 5, tread: 11 };

/** The lanai: a raised slab on stem walls, 36" guards on its three open sides, steps to the pool deck. */
export const LANAI_SLAB = {
  slab: 10.67,
  guard: 36,
  steps: { x0: 476, x1: 524, risers: 4, tread: 11, handrails: "both" as const },
  deck: 8.4,
};

/**
 * Engineered flood vents in the garage walls, by center. Each is certified (ICC-ES) to cover
 * `FLOOD_VENT_RATING` sq. ft. of enclosed area.
 */
export const FLOOD_VENT_RATING = 200;

/** The powder room's fixtures, by the y of their centerlines on the west wall. */
export const POWDER = { wc: 500, vanity: 470, vanityWidth: 30 };
export const FLOOD_VENTS: { at: Point; wall: "W" | "S" }[] = [
  { at: [4, 22], wall: "W" },
  { at: [4, 100], wall: "W" },
  { at: [4, 190], wall: "W" },
  // In the south wall's pier east of the garage door: the porch side of the east wall sits
  // against the porch fill, 26" above the garage slab.
  { at: [240, 4], wall: "S" },
];

/** Attic vents: rates per foot of ridge and soffit vent, and the off-ridge vents a hip needs. */
export const ROOF_VENTS = { ridgeRate: 18, soffitRate: 9, offRidge: { count: 8, each: 54 } };

/** The attic access: a 30" x 54" pull-down stair in the second-floor hall ceiling. */
export const ATTIC_ACCESS: Rect = [236, 24, 266, 78];

// --- First floor: 8" masonry outside, 4 1/2" studs inside. ---------------------------------
const L1_EXT: Rect[] = [
  [0, 0, 264, 8],
  [0, 0, 8, 528],
  [0, 520, 624, 528],
  [616, 0, 624, 528],
  [384, 0, 624, 8],
  [264, 0, 272, 296], // garage to porch and foyer, masonry
  [264, 72, 384, 80], // the porch's back wall
  [376, 0, 384, 80], // the porch's east side
  [8, 288, 272, 296], // garage to laundry, masonry
];
const L1_INT: Rect[] = [
  [379.5, 80, 384, 292.5],
  [384, 192, 616, 196.5],
  [272, 288, 384, 292.5],
  [132, 296, 136.5, 520],
  [8, 408, 132, 412.5],
  [72, 412.5, 76.5, 520],
];

export const L1: Level = {
  name: "FIRST FLOOR",
  ext: 8,
  exterior: L1_EXT,
  walls: [...L1_EXT, ...L1_INT],
  low: [[314, 116, 318.5, 286]],
  openings: [
    {
      cut: [324, 72, 366, 80],
      kind: "door",
      tag: "101",
      swing: 1,
      hinge: "start",
      height: 96,
      exterior: true,
    },
    { cut: [24, 0, 216, 8], kind: "overhead", tag: "102", height: 96, exterior: true },
    { cut: [24, 288, 60, 296], kind: "door", tag: "103", swing: 1, hinge: "start", height: 80 },
    { cut: [379.5, 100, 384, 160], kind: "double", tag: "104", swing: 1, height: 96 },
    {
      cut: [132, 312, 136.5, 348],
      kind: "door",
      tag: "105",
      swing: -1,
      hinge: "start",
      height: 80,
    },
    {
      cut: [24, 408, 54, 412.5],
      kind: "door",
      tag: "106",
      swing: 1,
      hinge: "start",
      height: 80,
      tagSide: 1,
    },
    { cut: [132, 440, 136.5, 470], kind: "door", tag: "107", swing: -1, hinge: "end", height: 80 },
    { cut: [432, 520, 576, 528], kind: "slider", tag: "108", height: 96, exterior: true },
    {
      cut: [0, 120, 8, 156],
      kind: "door",
      tag: "109",
      swing: 1,
      hinge: "end",
      height: 80,
      exterior: true,
    },
    { cut: [324, 288, 372, 292.5], kind: "cased" },
    { cut: [379.5, 216, 384, 264], kind: "cased" },
    win("A", [444, 0, 480, 8]),
    win("A", [528, 0, 564, 8]),
    win("A", [616, 78, 624, 114]),
    win("E", [616, 300, 624, 372]),
    win("A", [616, 432, 624, 468]),
    { ...win("B", [228, 520, 276, 528]), tagSide: 1 },
    win("D", [0, 330, 8, 366]),
    { ...win("C", [0, 452, 8, 476]), tagSide: -1 },
    win("D", [0, 40, 8, 76], GARAGE_HEAD),
  ],
  rooms: [
    { name: "GARAGE", rect: [8, 8, 264, 288], ceiling: "10'-0\" CLG.", conditioned: false },
    {
      name: "FOYER",
      rect: [318.5, 80, 379.5, 288],
      ceiling: "10'-0\" CLG.",
      tagAt: [349, 200],
      conditioned: true,
    },
    { name: "STUDY", rect: [384, 8, 616, 192], ceiling: "10'-0\" CLG.", conditioned: true },
    {
      name: "GREAT ROOM",
      rect: [384, 196.5, 616, 520],
      ceiling: "10'-0\" CLG.",
      conditioned: true,
    },
    {
      name: "KITCHEN",
      rect: [136.5, 292.5, 379.5, 520],
      ceiling: "10'-0\" CLG.",
      tagAt: [258, 340],
      conditioned: true,
    },
    { name: "LAUNDRY", rect: [8, 296, 132, 408], ceiling: "9'-0\" CLG.", conditioned: true },
    {
      name: "PWDR.",
      rect: [8, 412.5, 72, 520],
      ceiling: "9'-0\" CLG.",
      tagAt: [54, 438],
      conditioned: true,
    },
    { name: "PANTRY", rect: [76.5, 412.5, 132, 520], tagAt: [104, 500], conditioned: true },
    { name: "ENTRY PORCH", rect: [272, 0, 376, 72], conditioned: false },
    { name: "COVERED LANAI", rect: LANAI, conditioned: false },
  ],
};

// --- Second floor: 2x6 studs outside, 2x4 inside. -------------------------------------------
const L2_EXT: Rect[] = [
  [0, 0, 624, 6],
  [0, 0, 6, 528],
  [0, 522, 624, 528],
  [618, 0, 624, 528],
];
const L2_INT: Rect[] = [
  [216, 6, 220.5, 522],
  [6, 204, 216, 208.5],
  [6, 312, 216, 316.5],
  [61.5, 208.5, 66, 312],
  [6, 474, 96, 478.5],
  [96, 474, 100.5, 522],
  [379.5, 6, 384, 522],
  [384, 168, 618, 172.5],
  [384, 264, 618, 268.5],
];

export const L2: Level = {
  name: "SECOND FLOOR",
  ext: 6,
  exterior: L2_EXT,
  walls: [...L2_EXT, ...L2_INT],
  low: [
    [268, 112, 272.5, 286],
    [268, 112, 318.5, 116.5],
    [314, 112, 318.5, 286],
  ],
  openings: [
    {
      cut: [216, 150, 220.5, 186],
      kind: "door",
      tag: "201",
      swing: -1,
      hinge: "start",
      height: 80,
    },
    { cut: [18, 204, 48, 208.5], kind: "door", tag: "202", swing: -1, hinge: "start", height: 80 },
    { cut: [216, 230, 220.5, 260], kind: "door", tag: "203", swing: -1, hinge: "end", height: 80 },
    { cut: [216, 340, 220.5, 376], kind: "door", tag: "204", swing: -1, hinge: "end", height: 80 },
    { cut: [18, 474, 78, 478.5], kind: "bifold", tag: "205", height: 80 },
    { cut: [379.5, 400, 384, 436], kind: "door", tag: "206", swing: 1, hinge: "end", height: 80 },
    {
      cut: [420, 264, 450, 268.5],
      kind: "door",
      tag: "207",
      swing: -1,
      hinge: "start",
      height: 80,
    },
    {
      cut: [420, 168, 450, 172.5],
      kind: "door",
      tag: "208",
      swing: -1,
      hinge: "start",
      height: 80,
    },
    win("A", [60, 0, 96, 6], L2_HEAD),
    win("A", [132, 0, 168, 6], L2_HEAD),
    win("A", [0, 96, 6, 132], L2_HEAD),
    win("A", [0, 380, 6, 416], L2_HEAD),
    win("A", [132, 522, 168, 528], L2_HEAD),
    win("E", [264, 522, 336, 528], L2_HEAD),
    win("E", [468, 522, 540, 528], L2_HEAD),
    win("A", [618, 330, 624, 366], L2_HEAD),
    win("A", [618, 430, 624, 466], L2_HEAD),
    win("B", [480, 0, 528, 6], L2_HEAD),
    win("E", [284, 0, 356, 6], L2_HEAD),
    win("C", [618, 60, 624, 84], L2_HEAD),
  ],
  rooms: [
    { name: "BEDROOM 2", rect: [6, 6, 216, 204], ceiling: "9'-0\" CLG.", conditioned: true },
    { name: "CLO.", rect: [6, 208.5, 61.5, 312], conditioned: true },
    { name: "BATH 2", rect: [66, 208.5, 216, 312], ceiling: "9'-0\" CLG.", conditioned: true },
    {
      name: "BEDROOM 3",
      rect: [6, 316.5, 216, 522],
      area: (210 * 205.5 - 94.5 * 43.5) / 144,
      ceiling: "9'-0\" CLG.",
      tagAt: [120, 400],
      conditioned: true,
    },
    { name: "CLO.", rect: [6, 478.5, 96, 522], tagAt: [51, 504], conditioned: true },
    {
      name: "LOFT",
      rect: [220.5, 270, 379.5, 522],
      ceiling: "9'-0\" CLG.",
      tagAt: [300, 420],
      conditioned: true,
    },
    { name: "HALL", rect: [220.5, 6, 379.5, 106], tagAt: [300, 60], conditioned: true },
    { name: "OWNER'S BATH", rect: [384, 6, 618, 168], ceiling: "9'-0\" CLG.", conditioned: true },
    { name: "OWNER'S CLOSET", rect: [384, 172.5, 618, 264], conditioned: true },
    {
      name: "OWNER'S BEDROOM",
      rect: [384, 268.5, 618, 522],
      ceiling: "9'-0\" TRAY CLG.",
      conditioned: true,
    },
  ],
};

/** The footprint of the main block, as the site plan and the setbacks see it. */
export const FOOTPRINT: Point[] = [
  [0, 0],
  [264, 0],
  [264, 72],
  [376, 72],
  [376, 0],
  [W, 0],
  [W, DEPTH],
  [LANAI[2], DEPTH],
  [LANAI[2], LANAI[3]],
  [LANAI[0], LANAI[3]],
  [LANAI[0], DEPTH],
  [0, DEPTH],
];

/** Heights, in inches, from the first floor. The elevations and sections read these. */
export const HEIGHTS = {
  l1Plate: 120, // 10'-0" to the top of the tie beam
  floorDepth: 18.25, // a 1 1/2" P.T. sill on the tie beam, 16" floor trusses and 3/4" sheathing
  get l2() {
    return this.l1Plate + this.floorDepth;
  },
  l2Plate: 109.125, // 9'-1 1/8" studs and plates
  get l2Top() {
    return this.l2 + this.l2Plate;
  },
  pitch: 6, // in 12
  overhang: 24,
  heel: 6,
  get stem() {
    return (CRITERIA.flood.ffe - CRITERIA.flood.finishGrade) * 12; // 3'-0" from finished grade
  },
  garageDrop: 30, // the garage slab is 2'-6" below the first floor
  lanaiPlate: 108,
  lanaiPitch: 3,
};

/** The area of a rectangle in square feet. */
export const sf = (r: Rect): number => ((r[2] - r[0]) * (r[3] - r[1])) / 144;

/** Gross areas from the outside faces, in square feet. */
export function areas() {
  const garage = (264 * 288) / 144;
  const porch = (112 * 72) / 144;
  const l1Gross = (W * DEPTH) / 144 - porch - garage;
  const l2Gross = (W * DEPTH) / 144;
  const lanai = sf(LANAI);
  return {
    garage,
    porch,
    l1: l1Gross,
    l2: l2Gross,
    lanai,
    living: l1Gross + l2Gross,
    total: l1Gross + l2Gross + garage + porch + lanai,
  };
}

/**
 * The roofs. The main roof is a hip at 6:12 over the main block, with the overhang all round;
 * all four planes have one pitch, so the hips run at 45 degrees in plan and the ridge runs
 * east-west. The lanai has a shed roof at 3:12 on a ledger against the house's north wall.
 * Heights are inches above the first floor.
 */
export const ROOF = (() => {
  const o = HEIGHTS.overhang;
  const eave: Rect = [-o, -o, W + o, DEPTH + o];
  const half = (eave[3] - eave[1]) / 2; // the run from the eave to the ridge
  const ridgeY = (eave[1] + eave[3]) / 2;
  const ridge: [Point, Point] = [
    [eave[0] + half, ridgeY],
    [eave[2] - half, ridgeY],
  ];
  // The roof plane is `heel` above the plate over the outside face of the wall.
  const atWall = HEIGHTS.l2Top + HEIGHTS.heel;
  const eaveHeight = atWall - (o * HEIGHTS.pitch) / 12;
  const ridgeHeight = eaveHeight + (half * HEIGHTS.pitch) / 12;
  const lanai = {
    rect: [LANAI[0] - 12, DEPTH, LANAI[2] + 12, LANAI[3] + 18] as Rect,
    high: 150, // at the ledger on the house's wall
    get low() {
      return this.high - ((this.rect[3] - this.rect[1]) * HEIGHTS.lanaiPitch) / 12;
    },
  };
  return { eave, ridge, ridgeY, eaveHeight, ridgeHeight, lanai };
})();

/** Each window's mark, numbered through the first floor and then the second: 1-01, 2-10. */
export const WINDOW_MARKS: Map<Opening, string> = (() => {
  const marks = new Map<Opening, string>();
  let n = 0;
  for (const [level, prefix] of [
    [L1, "1"],
    [L2, "2"],
  ] as const) {
    for (const o of level.openings)
      if (o.kind === "window") marks.set(o, `${prefix}-${String(++n).padStart(2, "0")}`);
  }
  return marks;
})();
