// An entity's own transparency: a percent from 0 to 90 as CAD programs set it, or ByBlock, and
// how it is written and plotted.
import type { EntityTransparency } from "./drawing.ts";
import { ENTITY_TRANSPARENCY } from "./rules.ts";
import { isNumber } from "./guards.ts";

/** The most a transparency may be, in percent, as CAD programs allow. */
export const TRANSPARENCY_MOST = 90;

/**
 * What is wrong with an entity's transparency, or undefined when it is one. It takes any value,
 * as a caller in plain JavaScript may give one.
 */
export function entityTransparencyProblem(transparency: unknown): string | undefined {
  if (transparency === "ByLayer" || transparency === "ByBlock") return undefined;

  return isNumber(transparency) &&
    Number.isInteger(transparency) &&
    transparency >= 0 &&
    transparency <= TRANSPARENCY_MOST
    ? undefined
    : ENTITY_TRANSPARENCY;
}

/** The opacity of a percent, from 0 to 255 with 255 opaque, as the leading CAD app stores it. */
export const alphaOf = (percent: number): number => Math.floor((255 * (100 - percent)) / 100);

/**
 * What a file holds of an entity's transparency, DXF group 440 and the DWG's bit-long alike:
 * `0x02000000` and its alpha, or `0x01000000` for ByBlock. Undefined for ByLayer, which a file
 * leaves out.
 */
export function storedTransparency(
  transparency: EntityTransparency | undefined,
): number | undefined {
  if (transparency === undefined || transparency === "ByLayer") return undefined;

  if (transparency === "ByBlock") return 0x01000000;

  return 0x02000000 | alphaOf(transparency);
}

/**
 * What a reader keeps of the 32 bits a file holds, as the leading CAD app reads them: the alpha
 * after `0x02`, from 0 to 255, `"ByBlock"` for `0x01` whatever follows, and nothing, ByLayer, for
 * any other.
 */
export function readAlpha(value: number | undefined): number | "ByBlock" | undefined {
  if (value === undefined) return undefined;
  const kind = value >>> 24;

  if (kind === 1) return "ByBlock";

  return kind === 2 ? value & 0xff : undefined;
}
