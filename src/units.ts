// How long a length on paper is in a drawing's units. `fromPaper` and the rules of a viewport
// share this, and it checks nothing.
import type { Units } from "./drawing.ts";
import type { PaperUnit } from "./paper.ts";

/** Inches in one of each imperial unit, and millimetres in one of each metric unit. */
const SIZES = {
  in: ["imperial", 1],
  ft: ["imperial", 12],
  mm: ["metric", 1],
  cm: ["metric", 10],
  m: ["metric", 1000],
} as const satisfies Record<Units, readonly [string, number]>;

const MM_PER_INCH = 25.4;

/** True for a string that names a drawing's units. */
export function isUnits(value: unknown): value is Units {
  return typeof value === "string" && Object.hasOwn(SIZES, value);
}

/** True for a string that names the units of a paper length. */
export function isPaperUnit(value: unknown): value is PaperUnit {
  return value === "in" || value === "mm";
}

/**
 * A length on paper, at a ratio, in drawing units. Multiplying before dividing keeps 3/32 in
 * at 96 in feet at exactly 0.75.
 */
export function modelLength(length: number, unit: PaperUnit, ratio: number, units: Units): number {
  const from = SIZES[unit];
  const to = SIZES[units];
  const model = length * ratio * from[1];
  const converted =
    from[0] === to[0] ? model : from[0] === "imperial" ? model * MM_PER_INCH : model / MM_PER_INCH;
  return converted / to[1];
}
