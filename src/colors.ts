// An entity's own color: an index of the color index CAD programs share, ByBlock, or a true color,
// and how each is written and plotted.
import type { EntityColor, Rgb } from "./drawing.ts";
import { ENTITY_COLOR } from "./rules.ts";

/** The values of the five shades of each hue of the index, from the brightest. */
const SHADES = [255, 204, 153, 127, 76] as const;

/**
 * The colors the leading CAD app matches a true color against to find the index it stores beside
 * it, which are neither the colors it plots nor the colors it shows on screen. Indexes 10 to 249
 * are 24 hues 15 degrees apart from red, each in five shades, full and at half saturation, each
 * channel the whole part of its exact value; 250 to 255 are grays from a fifth of white to white.
 */
const MATCHED: readonly Rgb[] = (() => {
  const out: Rgb[] = [
    [0, 0, 0],
    [255, 0, 0],
    [255, 255, 0],
    [0, 255, 0],
    [0, 255, 255],
    [0, 0, 255],
    [255, 0, 255],
    [255, 255, 255],
    [128, 128, 128],
    [192, 192, 192],
  ];
  for (let index = 10; index < 250; index++) {
    const hue = Math.floor(index / 10) - 1;
    const value = SHADES[Math.floor((index % 10) / 2)]!;
    // In 120ths of the value, so each channel's exact value is a whole number of them.
    const low = index % 2 === 0 ? 0 : 60;
    const step = (hue % 4) * 15;
    const rising = low + ((120 - low) * step) / 60;
    const falling = low + ((120 - low) * (60 - step)) / 60;
    const of = (part: number) => Math.floor((value * part) / 120);
    const [v, up, down, lo] = [of(120), of(rising), of(falling), of(low)];
    const sector = Math.floor(hue / 4);
    out.push(
      (
        [
          [v, up, lo],
          [down, v, lo],
          [lo, v, up],
          [lo, down, v],
          [up, lo, v],
          [v, lo, down],
        ] as const
      )[sector]!,
    );
  }
  for (let k = 0; k < 6; k++) {
    const gray = Math.floor((255 * (5 + 4 * k)) / 25);
    out.push([gray, gray, gray]);
  }
  return out;
})();

/**
 * The index the leading CAD app stores beside a true color: the nearest of `MATCHED` by the sum
 * of the squares of the channels' differences, the lowest index where two are as near.
 */
export function matchedIndex(rgb: Rgb): number {
  const [red, green, blue] = [rgb[0], rgb[1], rgb[2]];
  let best = 1;
  let nearest = Infinity;
  for (let index = 1; index <= 255; index++) {
    const [r, g, b] = MATCHED[index]!;
    const distance = (red - r) ** 2 + (green - g) ** 2 + (blue - b) ** 2;
    if (distance < nearest) [best, nearest] = [index, distance];
  }
  return best;
}

/** A true color as one number, 0xRRGGBB, as DXF group 420 holds it. */
export const rgbValue = (rgb: Rgb): number => (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];

/** True for a true color: three whole numbers from 0 to 255. */
export function isRgb(value: unknown): value is Rgb {
  if (!Array.isArray(value) || value.length !== 3) return false;
  // Read by index, so an empty slot is no channel.
  for (let k = 0; k < 3; k++) {
    const v: unknown = value[k];
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 255) return false;
  }
  return true;
}

/** What is wrong with an entity's color, or undefined when it is one. */
export function entityColorProblem(color: unknown): string | undefined {
  if (color === "ByLayer" || color === "ByBlock") return undefined;
  if (typeof color === "number") {
    return Number.isInteger(color) && color >= 1 && color <= 255 ? undefined : ENTITY_COLOR;
  }
  return isRgb(color) ? undefined : ENTITY_COLOR;
}

/**
 * What a file holds of an entity's color: its index, 0 for ByBlock, and with a true color the
 * index the leading CAD app matches it to; and the true color. Undefined for ByLayer, which a file
 * leaves out.
 */
export function storedColor(
  color: EntityColor | undefined,
): { readonly index: number; readonly rgb?: number } | undefined {
  if (color === undefined || color === "ByLayer") return undefined;
  if (color === "ByBlock") return { index: 0 };
  if (typeof color === "number") return { index: color };
  return { index: matchedIndex(color), rgb: rgbValue(color) };
}

/**
 * A color as a multileader holds the color of its note, 32 bits: 0xC0 and nothing for ByLayer,
 * 0xC1 for ByBlock, 0xC3 and the index, and 0xC2 and a true color. The leading CAD app saves a
 * leader's own color there.
 */
export function heldColor(color: EntityColor | undefined): number {
  const stored = storedColor(color);
  if (stored === undefined) return 0xc0000000 | 0;
  if (stored.rgb !== undefined) return 0xc2000000 | stored.rgb | 0;
  return stored.index === 0 ? 0xc1000000 | 0 : 0xc3000000 | stored.index | 0;
}
