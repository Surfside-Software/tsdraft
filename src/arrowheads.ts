// The arrowheads a dimension style may name, and the zeros it may leave out of a measurement.
// These are the lists: `lint`, the writers and `toSVG` all read them.

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

/** What tsdraft knows of an arrowhead, or undefined for a name that is not in `ARROWHEADS`. */
export function arrowheadInfo(name: unknown): ArrowheadInfo | undefined {
  return typeof name === "string" && Object.hasOwn(ARROWHEADS, name)
    ? ARROWHEADS[name as Arrowhead]
    : undefined;
}

/** The zeros of a measurement that a dimension style may leave out. */
export const ZERO_SUPPRESSIONS = ["leading", "trailing", "both"] as const;

/** The most decimals AutoCAD writes a measurement with. */
export const MAX_PRECISION = 8;

/** The dimension style every drawing has, in the spelling AutoCAD gives it. */
export const STANDARD_DIMENSION_STYLE = "Standard";
