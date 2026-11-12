// Linetypes and lineweights: the ones every drawing has, the ones plans use, and how the
// writers name and number them.
import type { Layer, Lineweight, Linetype } from "./drawing.ts";
import { layerKey } from "./layers.ts";

/** Every lineweight AutoCAD offers, in millimetres, from thinnest to widest. */
export const LINEWEIGHTS: readonly Lineweight[] = [
  0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1,
  1.06, 1.2, 1.4, 1.58, 2, 2.11,
];

// The linetypes plans use most, with the names, descriptions and patterns that AutoCAD 2025
// loads from its acad.lin, so a drawing looks the same as one drafted by hand. The lengths are
// in drawing units: scale them with the drawing's linetypeScale.

/** Dashes: 0.5 on, 0.25 off. */
export const DASHED: Linetype = {
  name: "DASHED",
  description: "Dashed __ __ __ __ __ __ __ __ __ __ __ __ __ _",
  pattern: [0.5, -0.25],
};

/** Short dashes, half the size of `DASHED`. */
export const HIDDEN: Linetype = {
  name: "HIDDEN",
  description: "Hidden __ __ __ __ __ __ __ __ __ __ __ __ __ _",
  pattern: [0.25, -0.125],
};

/** Long dash, short dash. */
export const CENTER: Linetype = {
  name: "CENTER",
  description: "Center ____ _ ____ _ ____ _ ____ _ ____ _ ____",
  pattern: [1.25, -0.25, 0.25, -0.25],
};

/** Long dash, two short dashes. */
export const PHANTOM: Linetype = {
  name: "PHANTOM",
  description: "Phantom ______  __  __  ______  __  __  ______",
  pattern: [1.25, -0.25, 0.25, -0.25, 0.25, -0.25],
};

/** Dash, dot. */
export const DASHDOT: Linetype = {
  name: "DASHDOT",
  description: "Dash dot __ . __ . __ . __ . __ . __ . __ . __",
  pattern: [0.5, -0.25, 0, -0.25],
};

/** Dots, 0.25 apart. */
export const DOT: Linetype = {
  name: "DOT",
  description: "Dot . . . . . . . . . . . . . . . . . . . . . .",
  pattern: [0, -0.25],
};

/** The linetypes every drawing has, in the spelling AutoCAD gives them. */
export const BUILT_IN_LINETYPES = ["ByBlock", "ByLayer", "Continuous"] as const;

/** The spelling AutoCAD gives a built-in linetype, or undefined for any other name. */
export function builtInLinetype(name: string): (typeof BUILT_IN_LINETYPES)[number] | undefined {
  const key = layerKey(name);
  return BUILT_IN_LINETYPES.find((n) => layerKey(n) === key);
}

/** The linetype name a writer gives an entity, or undefined when it draws ByLayer. */
export function entityLinetype(e: { readonly linetype?: string }): string | undefined {
  if (e.linetype === undefined) return undefined;
  return builtInLinetype(e.linetype) === "ByLayer" ? undefined : e.linetype;
}

/** The linetype name a writer gives a layer. */
export function layerLinetype(layer: Layer): string {
  return layer.linetype ?? "Continuous";
}

/** A lineweight as DXF group 370 holds it: hundredths of a millimetre, or -1, -2 or -3. */
export function lineweightCode(value: number | "ByLayer" | "ByBlock" | "Default"): number {
  if (value === "ByLayer") return -1;
  if (value === "ByBlock") return -2;
  if (value === "Default") return -3;
  return Math.round(value * 100);
}

/** The total length of a pattern, as AutoCAD stores it: the sum of the lengths, unsigned. */
export function patternLength(pattern: readonly number[]): number {
  return pattern.reduce((sum, length) => sum + Math.abs(length), 0);
}
