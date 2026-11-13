// The rules of a standard's document that are its own, each twice: as a type, so a literal
// mistake is a compile error, and as a runtime check with the same message, as `src/rules.ts`
// holds the rules of a drawing. The rules a standard shares with a drawing, such as a layer's
// name and color, are there.
import type { Section } from "./document.ts";

const PAPER_UNITS = 'paperUnits must be "in" or "mm"';
const SHEET_FILES = 'sheetFiles must be "one-drawing" or "sheet-per-file"';
const FILLS =
  'fills must be "number", "title", "project", "date", "scale", "drawnBy" or "checkedBy"';
const SOURCE = 'source must be "attribute", "fileName", "layoutName" or "currentDate"';
const WRITING_UNITS = 'units must be "decimal", the one way tsdraft writes a length';
const LAYER_ZERO =
  'Layer "0" is in every drawing and in no standard. AutoCAD makes it in every drawing, and an entity of a block on it draws on its insert\'s layer';
const ROLE_STANDARD =
  "A text role cannot be named standard, in any case of its letters. Its text style would be STANDARD, which AutoCAD takes for the text style Standard that every drawing has";
const DIMENSION_STYLE_STANDARD =
  "A dimension style cannot be named standard, in any case of its letters. Its name in AutoCAD would be STANDARD, which AutoCAD takes for the dimension style Standard that every drawing has";
const STANDARD_ID =
  "A standard's id has 1 to 128 characters, each a letter A to Z or a to z, a digit, ., -, _, @ or /";
const STANDARD_VERSION =
  "A standard's version has 1 to 64 characters, none of them a control character or a character above U+FFFF";
const SCALE_LABEL =
  "A scale's label has 1 to 64 characters, none of them a control character or a character above U+FFFF";

/** How a message names an entry of each section that a field names. */
const REFERENCES = {
  disciplines: ["Discipline", "a discipline", "disciplines"],
  pens: ["Pen", "a pen", "pens"],
  linetypes: ["Linetype", "a linetype", "linetypes or Continuous"],
  layers: ["Layer", "a layer", "layers"],
  textRoles: ["Text role", "a text role", "text roles"],
  scales: ["Scale", "a scale", "scales"],
  dimensionStyles: ["Dimension style", "a dimension style", "dimension styles"],
  titleBlocks: ["Title block", "a title block", "title blocks"],
  sheetFormats: ["Sheet format", "a sheet format", "sheet formats"],
} as const satisfies Record<Section, readonly [string, string, string]>;

type Reference<
  S extends Section,
  V extends string,
> = `${(typeof REFERENCES)[S][0]} "${V}" is not ${(typeof REFERENCES)[S][1]} of the standard. Add it to ${S}, or name one of its ${(typeof REFERENCES)[S][2]}`;

/**
 * Resolves to `V` when it names an entry of the section `S`, whose names are `Names`, and to
 * the error message otherwise. A name that is not a literal, or a section whose names are not
 * literals, passes the compiler and is checked when the code runs, where AutoCAD's folding of
 * case applies.
 */
export type NameIn<V, Names extends string, S extends Section> = V extends string
  ? string extends V
    ? V
    : string extends Names
      ? V
      : V extends Names
        ? V
        : Reference<S, V>
  : V;

/**
 * What is wrong with a field that names an entry of `section` the standard does not have.
 * `owner` is the section of the entry that holds the field, when that entry is the parent's.
 */
export function referenceProblem(section: Section, name: string, owner?: Section): string {
  const [what, a, plural] = REFERENCES[section];
  const parents = owner ? `, which the parent's ${REFERENCES[owner][0].toLowerCase()} names,` : "";
  return `${what} ${JSON.stringify(name)}${parents} is not ${a} of the standard. Add it to ${section}, or name one of its ${plural}`;
}

/**
 * What is wrong with a default the standard takes from its parent, `field`, when it names an
 * entry of `section` the standard removed.
 */
export function inheritedDefaultProblem(field: string, section: Section, name: string): string {
  const [what, a, plural] = REFERENCES[section];
  return `${what} ${JSON.stringify(name)}, the parent's ${field}, is not ${a} of the standard. Set ${field} to one of its ${plural}`;
}

/** Resolves to `V` when it is one of `Allowed`, and to `Message` otherwise. */
type OneOf<V, Allowed extends string, Message extends string> = V extends string
  ? string extends V
    ? V
    : V extends Allowed
      ? V
      : Message
  : V;

const oneOf =
  (allowed: readonly string[], message: string) =>
  (value: unknown): string | undefined =>
    allowed.includes(value as string) ? undefined : message;

export type PaperUnitsOf<V> = OneOf<V, "in" | "mm", typeof PAPER_UNITS>;
export const paperUnitsProblem = oneOf(["in", "mm"], PAPER_UNITS);

export type SheetFilesOf<V> = OneOf<V, "one-drawing" | "sheet-per-file", typeof SHEET_FILES>;
export const sheetFilesProblem = oneOf(["one-drawing", "sheet-per-file"], SHEET_FILES);

export const FILL_KEYS = [
  "number",
  "title",
  "project",
  "date",
  "scale",
  "drawnBy",
  "checkedBy",
] as const;
export type FillOf<V> = OneOf<V, (typeof FILL_KEYS)[number], typeof FILLS>;
export const fillProblem = oneOf(FILL_KEYS, FILLS);

export const SOURCES = ["attribute", "fileName", "layoutName", "currentDate"] as const;
export type SourceOf<V> = OneOf<V, (typeof SOURCES)[number], typeof SOURCE>;
export const sourceProblem = oneOf(SOURCES, SOURCE);

export type WritingUnitsOf<V> = OneOf<V, "decimal", typeof WRITING_UNITS>;
export const writingUnitsProblem = oneOf(["decimal"], WRITING_UNITS);

/** Resolves to the message when `N` is layer `0`, and to `never` otherwise. */
export type LayerZero<N extends string> = N extends "0" ? typeof LAYER_ZERO : never;
export function layerZeroProblem(name: string): string | undefined {
  return name === "0" ? LAYER_ZERO : undefined;
}

/** The text style of a role, and the name of a dimension style: an id with a to z in capitals. */
export function capitals(id: string): string {
  return id.replace(/[a-z]+/g, (letters) => letters.toUpperCase());
}

/** Resolves to the message when the role `I` would have the text style `STANDARD`. */
export type RoleStandard<I extends string> =
  Uppercase<I> extends "STANDARD" ? typeof ROLE_STANDARD : never;
export function roleNameProblem(id: string): string | undefined {
  return capitals(id) === "STANDARD" ? ROLE_STANDARD : undefined;
}

/** Resolves to the message when the dimension style `I` would be named `STANDARD`. */
export type DimensionStyleStandard<I extends string> =
  Uppercase<I> extends "STANDARD" ? typeof DIMENSION_STYLE_STANDARD : never;
export function dimensionStyleIdProblem(id: string): string | undefined {
  return capitals(id) === "STANDARD" ? DIMENSION_STYLE_STANDARD : undefined;
}

/** Returns what is wrong with a standard's id, or undefined. */
export function standardIdProblem(id: string): string | undefined {
  return /^[A-Za-z0-9._@/-]{1,128}$/.test(id) ? undefined : STANDARD_ID;
}

/**
 * True for a value a custom drawing property can hold, of 1 to `most` characters: no control
 * character, from U+0000 to U+001F and U+007F, and no character above U+FFFF.
 */
function propertyValue(value: string, most: number): boolean {
  if (value.length < 1 || value.length > most) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || (code >= 0xd800 && code <= 0xdfff)) return false;
  }
  return true;
}

/** Returns what is wrong with a standard's version, or undefined. */
export function standardVersionProblem(version: string): string | undefined {
  return propertyValue(version, 64) ? undefined : STANDARD_VERSION;
}

/** Returns what is wrong with a scale's label, or undefined. */
export function scaleLabelProblem(label: string): string | undefined {
  return propertyValue(label, 64) ? undefined : SCALE_LABEL;
}
