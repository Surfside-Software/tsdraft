// Where the HVAC equipment stands and how the attic unit is reached, in building coordinates.
// E-101 places the disconnects, receptacles and lights from these; M-101 draws the units.
import type { Point } from "../../../src/index.ts";
import { ATTIC_ACCESS, type Rect } from "../model/house.ts";

/** The units, as rectangles in plan. */
export const EQUIP = {
  /** AHU-1: upflow, on a 30" stand against the garage's north wall, west of WH-1. */
  ahu1: [186, 258, 216, 288] as Rect,
  /** AHU-2: horizontal, in the attic over the second floor's landing; supply out the north end. */
  ahu2: [322, 130, 344, 186] as Rect,
  /** HP-1 and HP-2 on one pad on the east side, where C-101 puts the condensers. */
  hp1: [636, 196, 672, 232] as Rect,
  hp2: [636, 250, 672, 286] as Rect,
  pad: [630, 190, 678, 292] as Rect,
};

export const center = (r: Rect): Point => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];

/**
 * The attic AHU's access: a 24" floored passageway from the pull-down stair to a 30" x 30" level
 * service space on AHU-2's service (west) side. The centerline runs north from the opening's
 * edge, then east.
 */
export const ATTIC = {
  passage: [
    [239, ATTIC_ACCESS[3], 263, 170],
    [263, 146, 292, 170],
  ] as Rect[],
  service: [292, 143, 322, 173] as Rect,
  centerline: [
    [251, ATTIC_ACCESS[3]],
    [251, 158],
    [292, 158],
  ] as Point[],
};
export const passageLength = (): number =>
  ATTIC.centerline
    .slice(1)
    .reduce(
      (s, p, k) =>
        s + Math.abs(p[0] - ATTIC.centerline[k]![0]) + Math.abs(p[1] - ATTIC.centerline[k]![1]),
      0,
    );
