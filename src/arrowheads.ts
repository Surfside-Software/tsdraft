// The arrowheads a dimension style and a leader style may name, and the zeros a dimension style
// may leave out of a measurement. These are the lists: `lint`, the writers and `toSVG` all read
// them.

/** What tsdraft knows of an arrowhead. */
export interface ArrowheadInfo {
  /**
   * The block AutoCAD draws the arrowhead with, which a drawing that uses it holds. Missing
   * for the closed filled arrowhead, which AutoCAD draws with no block.
   */
  readonly block?: string;
  /**
   * What that block holds: one stroke from `from` to `to`, `width` wide, for an arrow size of
   * 1. AutoCAD scales it by the arrow size and turns it with the dimension line.
   */
  readonly stroke?: {
    readonly from: readonly [x: number, y: number];
    readonly to: readonly [x: number, y: number];
    readonly width: number;
  };
}

/**
 * Every arrowhead a dimension style may have, by the name AutoCAD's dimension style dialog gives
 * it. `"closed-filled"` is a solid arrow as long as the arrow size and a third as wide.
 * `"architectural-tick"` is a heavy stroke through the end of the dimension line, at 45 degrees
 * to it, as long as the arrow size times the square root of 2.
 */
export const ARROWHEADS = {
  "closed-filled": {},
  "architectural-tick": {
    block: "_ArchTick",
    stroke: { from: [-0.5, -0.5], to: [0.5, 0.5], width: 0.15 },
  },
} as const satisfies Readonly<Record<string, ArrowheadInfo>>;

/** The name of an arrowhead a dimension style may have. */
export type Arrowhead = keyof typeof ARROWHEADS;

/** The arrowhead of a dimension style that names none. */
export const DEFAULT_ARROWHEAD: Arrowhead = "closed-filled";

/** The length of the longest name in `ARROWHEADS`. */
const LONGEST_ARROWHEAD = Math.max(...Object.keys(ARROWHEADS).map((name) => name.length));

/**
 * What tsdraft knows of an arrowhead, or undefined for a name that is not in `ARROWHEADS`. A name
 * longer than any arrowhead's is not looked up, since that can take time in proportion to it.
 */
export function arrowheadInfo(name: unknown): ArrowheadInfo | undefined {
  return typeof name === "string" &&
    name.length <= LONGEST_ARROWHEAD &&
    Object.hasOwn(ARROWHEADS, name)
    ? ARROWHEADS[name as Arrowhead]
    : undefined;
}

/**
 * One entity of the block of a leader's arrowhead, for an arrow size of 1, with the tip at the
 * origin and the leader's shaft leaving along -X. Each takes its color, linetype and lineweight
 * from the leader that draws it.
 */
export type LeaderArrowheadStroke =
  | {
      readonly kind: "line";
      readonly from: readonly [x: number, y: number];
      readonly to: readonly [x: number, y: number];
    }
  | {
      /** A closed polyline of two vertices, each with a bulge, as wide as `width`. */
      readonly kind: "polyline";
      readonly points: readonly (readonly [x: number, y: number])[];
      readonly bulges: readonly number[];
      readonly width: number;
    };

/** What tsdraft knows of an arrowhead a leader style may have. */
export interface LeaderArrowheadInfo {
  /**
   * The block AutoCAD draws the arrowhead with, which a drawing that uses it holds. Missing for
   * the closed filled arrowhead, which AutoCAD draws with no block.
   */
  readonly block?: string;
  /** What that block holds. */
  readonly strokes?: readonly LeaderArrowheadStroke[];
  /**
   * True when the shaft runs to the tip. Otherwise AutoCAD stops the shaft one arrow size short
   * of the tip and the arrowhead draws the rest.
   */
  readonly toTip?: boolean;
}

/**
 * Every arrowhead a leader style may have. `"closed-filled"` is a solid arrow as long as the
 * arrow size and a third as wide. `"open"` is the same arrow drawn as lines, `"dot"` a filled
 * disk as wide as the arrow size centered on the tip, and `"none"` draws nothing and the shaft
 * runs to the tip.
 */
export const LEADER_ARROWHEADS = {
  "closed-filled": {},
  open: {
    block: "_Open",
    strokes: [
      { kind: "line", from: [-1, 1 / 6], to: [0, 0] },
      { kind: "line", from: [-1, -1 / 6], to: [0, 0] },
      { kind: "line", from: [0, 0], to: [-1, 0] },
    ],
  },
  dot: {
    block: "_Dot",
    strokes: [
      // Two half circles as wide as their radius, which fill the disk.
      {
        kind: "polyline",
        points: [
          [-0.25, 0],
          [0.25, 0],
        ],
        bulges: [1, 1],
        width: 0.5,
      },
      { kind: "line", from: [-0.5, 0], to: [-1, 0] },
    ],
  },
  none: { block: "_None", strokes: [], toTip: true },
} as const satisfies Readonly<Record<string, LeaderArrowheadInfo>>;

/** The name of an arrowhead a leader style may have. */
export type LeaderArrowhead = keyof typeof LEADER_ARROWHEADS;

/** The arrowhead of a leader style that names none. */
export const DEFAULT_LEADER_ARROWHEAD: LeaderArrowhead = "closed-filled";

/** The length of the longest name in `LEADER_ARROWHEADS`. */
const LONGEST_LEADER_ARROWHEAD = Math.max(
  ...Object.keys(LEADER_ARROWHEADS).map((name) => name.length),
);

/**
 * What tsdraft knows of a leader's arrowhead, or undefined for a name not in
 * `LEADER_ARROWHEADS`. A name longer than any arrowhead's is not looked up.
 */
export function leaderArrowheadInfo(name: unknown): LeaderArrowheadInfo | undefined {
  return typeof name === "string" &&
    name.length <= LONGEST_LEADER_ARROWHEAD &&
    Object.hasOwn(LEADER_ARROWHEADS, name)
    ? LEADER_ARROWHEADS[name as LeaderArrowhead]
    : undefined;
}

/** The blocks of every arrowhead that has one, of dimensions and of leaders. */
export const ARROWHEAD_BLOCKS: readonly string[] = [
  ARROWHEADS["architectural-tick"].block,
  LEADER_ARROWHEADS.open.block,
  LEADER_ARROWHEADS.dot.block,
  LEADER_ARROWHEADS.none.block,
];

/** The zeros of a measurement in decimal units that a dimension style may leave out. */
export const ZERO_SUPPRESSIONS = ["leading", "trailing", "both"] as const;

/**
 * How a dimension style writes a measurement: in decimal units, or in feet and inches with a
 * fraction of an inch, such as 4'-1 7/16".
 */
export const DIMENSION_UNITS = ["decimal", "architectural"] as const;

/**
 * The zeros a measurement in feet and inches writes: the zero inches of 4'-0", the zero feet of
 * 0'-6", both, or neither, which writes 4' and 6".
 */
export const FEET_INCH_ZEROS = ["inches", "feet", "both", "neither"] as const;

/** The most decimals AutoCAD writes a measurement with. */
export const MAX_PRECISION = 8;

/** The dimension style every drawing has, in the spelling AutoCAD gives it. */
export const STANDARD_DIMENSION_STYLE = "Standard";

/** The leader style a drawing with leaders has beside its own, in the spelling AutoCAD gives it. */
export const STANDARD_LEADER_STYLE = "Standard";
