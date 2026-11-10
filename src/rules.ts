// The rules a drawing must follow for AutoCAD to open its DXF. Each rule exists
// twice: as a type, so a literal mistake is an error in the editor, and as a
// runtime check, for values the compiler can't see. The messages are shared.
//
// The layer name and text rules come from opening test files in AutoCAD 2025,
// which discards the whole drawing when a name breaks them.
import type { DxfVersion } from "./drawing.ts";
import { isTooLarge, written, writtenAngle } from "./format.ts";
import {
  layerAuditKey,
  layerKey,
  rejectedNameCharacter,
  type REJECTED_COPTIC,
  type REJECTED_FORMAT,
  type REJECTED_GEORGIAN,
  type REJECTED_GLAGOLITIC,
  type REJECTED_LETTERLIKE,
  type REJECTED_PRIVATE,
} from "./layers.ts";

const NAME_EMPTY = "Layer names cannot be empty";
const NAME_CHARS = 'Layer names cannot contain < > / \\ " : ; ? * | = ` ^ , or line breaks';
const NAME_REJECTED =
  "Layer names cannot contain a character AutoCAD rejects or replaces in names, such as a zero-width space or the ohm sign U+2126. The README lists them";
const NAME_EDGE = "Layer names cannot start or end with a space";
const NAME_LENGTH = "Layer names cannot be longer than 255 characters";
const NAME_R12_CHARS =
  'R12 layer names can only use letters, digits, $, - and _. Use DXF version "R2018" for other characters';
const NAME_R12_LENGTH =
  'R12 layer names cannot be longer than 31 characters. Use DXF version "R2018" for longer names';
const COLOR = "A layer color must be an AutoCAD Color Index integer from 1 to 255";
const POSITIVE = "This value must be greater than 0";
const WRITTEN_AS_ZERO =
  "This value is written as 0, because tsdraft writes 6 decimals. Use 0.000001 or more";
const TOO_LARGE =
  "This value must be under 1e100, because AutoCAD reads only two exponent digits from DXF and would take 1e+100 for 1e+10";
const ARC_LOST =
  "An arc of nearly a full turn cannot be written: its angles are the same once rounded to 6 decimals, so AutoCAD would hold an arc of no length. Draw a circle instead";
const TEXT_PRIVATE_USE =
  "Text cannot contain the private-use characters U+E800 to U+E8FF, because AutoCAD replaces them when it reads DXF";
const TEXT_PERCENT =
  'AutoCAD reads "%%" in text as the start of a control code: it draws "%%d" as a degree sign and "%%%" as one percent sign. The text is stored as written';

type ForbiddenChar =
  | "<"
  | ">"
  | "/"
  | "\\"
  | '"'
  | ":"
  | ";"
  | "?"
  | "*"
  | "|"
  | "="
  | "`"
  | "^"
  | ","
  | "\n"
  | "\r"
  | "\t";

type Chars<S extends string, Found = never> = S extends `${infer C}${infer Rest}`
  ? Chars<Rest, Found | C>
  : Found;
type R12Char = Chars<"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$_-">;
type RejectedChar =
  | Chars<typeof REJECTED_FORMAT>
  | Chars<typeof REJECTED_LETTERLIKE>
  | Chars<typeof REJECTED_GLAGOLITIC>
  | Chars<typeof REJECTED_COPTIC>
  | Chars<typeof REJECTED_GEORGIAN>
  | Chars<typeof REJECTED_PRIVATE>;

/** Walks the name one character at a time, counting, so it can check both the characters and the length. */
type R12Name<
  N extends string,
  Rest extends string = N,
  Count extends 0[] = [],
> = Count["length"] extends 32
  ? typeof NAME_R12_LENGTH
  : Rest extends `${infer C}${infer Tail}`
    ? C extends R12Char
      ? R12Name<N, Tail, [...Count, 0]>
      : typeof NAME_R12_CHARS
    : N;

/**
 * Resolves to `N` when it is a valid layer name for DXF version `V`, and to the
 * error message otherwise, so the compiler reports the reason. Names that are
 * not literals pass the compiler and are checked when the code runs.
 */
export type LayerName<N extends string, V extends DxfVersion> = string extends N
  ? N
  : N extends ""
    ? typeof NAME_EMPTY
    : N extends `${string}${ForbiddenChar}${string}`
      ? typeof NAME_CHARS
      : N extends `${string}${RejectedChar}${string}`
        ? typeof NAME_REJECTED
        : N extends ` ${string}` | `${string} `
          ? typeof NAME_EDGE
          : V extends "R12"
            ? R12Name<N>
            : N;

type Enumerate<N extends number, A extends number[] = []> = A["length"] extends N
  ? A[number]
  : Enumerate<N, [...A, A["length"]]>;

/** AutoCAD Color Index: an integer from 1 to 255. */
export type Aci = Exclude<Enumerate<256>, 0>;

/** Resolves to `C` when it is a valid layer color, and to the error message otherwise. */
export type LayerColor<C extends number> = number extends C ? C : C extends Aci ? C : typeof COLOR;

/**
 * True for a number the writers round to 0, given as the compiler prints it.
 * A number under 0.000001 prints in exponent form, such as `4e-7`, and those
 * under 0.0000005 round to 0. `5e-7` itself is stored a little below a half,
 * so it rounds down too.
 */
type WrittenAsZero<S extends string> = S extends `${infer Mantissa}e-${infer Exponent}`
  ? Exponent extends "7"
    ? Mantissa extends "5"
      ? true
      : Mantissa extends `${5 | 6 | 7 | 8 | 9}${string}`
        ? false
        : true
    : true
  : false;

type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

/**
 * Resolves to `N` when it is a size the writers can keep, and to the error
 * message otherwise: `N` must be greater than 0, must not round to 0 at the
 * 6 decimals tsdraft writes, and must be under 1e100, where the compiler
 * prints a third exponent digit as the writers do.
 */
export type Positive<N extends number> = number extends N
  ? N
  : `${N}` extends `-${string}` | "0"
    ? typeof POSITIVE
    : WrittenAsZero<`${N}`> extends true
      ? typeof WRITTEN_AS_ZERO
      : `${N}` extends `${string}e+${Digit}${Digit}${Digit}`
        ? typeof TOO_LARGE
        : N;

/** Returns what is wrong with a layer name for a DXF version, or undefined when it is valid. */
export function layerNameProblem(name: string, version: DxfVersion): string | undefined {
  if (name.length === 0) return NAME_EMPTY;
  if (/[<>/\\":;?*|=`^,]/.test(name) || hasControl(name) || hasAstral(name)) return NAME_CHARS;
  const rejected = rejectedNameCharacter(name);
  if (rejected !== undefined) return `${NAME_REJECTED}. This name has ${codePoint(rejected)}`;
  // Only the ASCII space: AutoCAD takes a no-break space or any other at either end.
  if (name.startsWith(" ") || name.endsWith(" ")) return NAME_EDGE;
  if (name.length > 255) return NAME_LENGTH;
  if (version === "R12") {
    if (!/^[A-Za-z0-9$_-]+$/.test(name)) return NAME_R12_CHARS;
    if (name.length > 31) return NAME_R12_LENGTH;
  }
  return undefined;
}

/**
 * Returns what is wrong with a drawing that has both names as layers, or
 * undefined when the two can stand together. AutoCAD looks layers up one way
 * and its AUDIT compares their names another, so a few pairs of names, such
 * as `ΟΔΟΣ` and `οδος`, are two layers to AutoCAD and one duplicate name to
 * AUDIT. Names that are one layer to AutoCAD are not this function's concern.
 * The rule compares two names, so it has no type.
 *
 * @param name - The name of the layer being checked.
 * @param other - The name of another layer in the drawing.
 * @returns The problem, or undefined.
 */
export function layerTwinProblem(name: string, other: string): string | undefined {
  if (layerKey(name) === layerKey(other) || layerAuditKey(name) !== layerAuditKey(other)) {
    return undefined;
  }
  return `AutoCAD keeps this layer and ${JSON.stringify(other)} as two layers, but its AUDIT reports them as one duplicate name`;
}

/** Returns what is wrong with a layer color, or undefined when it is valid. */
export function layerColorProblem(color: number): string | undefined {
  return Number.isInteger(color) && color >= 1 && color <= 255 ? undefined : COLOR;
}

/**
 * Returns what is wrong with a radius, a text height or a rectangle size, or
 * undefined when it is valid. A size that is written as 0 is refused like 0
 * itself: AutoCAD gives text of height 0 the drawing's default text height,
 * and a circle of radius 0 is a point. A size of 1e100 or more is refused
 * too, as `magnitudeProblem` explains.
 *
 * @param value - The size, which must be a finite number.
 * @returns The problem, or undefined.
 */
export function sizeProblem(value: number): string | undefined {
  if (!(value > 0)) return POSITIVE;
  return written(value) === 0 ? WRITTEN_AS_ZERO : magnitudeProblem(value);
}

/**
 * Returns what is wrong with the size of a number a drawing holds, or
 * undefined when AutoCAD can read it. This goes for every number that is
 * written: coordinates, sizes and text rotation. Only sizes can be checked as
 * literals, through `Positive`, because points and rotations have no literal
 * types.
 *
 * @param value - The number, which must be finite.
 * @returns The problem, or undefined.
 */
export function magnitudeProblem(value: number): string | undefined {
  return isTooLarge(value) ? TOO_LARGE : undefined;
}

/**
 * Returns what is wrong with an arc's angles once they are rounded for
 * writing, or undefined when the arc can be written. AutoCAD holds an arc
 * whose start and end angles are equal as an arc of no length, so an arc that
 * is all but a full circle would vanish. The compiler cannot subtract two
 * literals, so this rule has no type.
 *
 * @param startAngle - The start angle in degrees, from 0 up to 360.
 * @param endAngle - The end angle in degrees, from 0 up to 360.
 * @returns The problem, or undefined.
 */
export function arcProblem(startAngle: number, endAngle: number): string | undefined {
  return roundsToOneAngle(startAngle, endAngle) && !isShortArc(startAngle, endAngle)
    ? ARC_LOST
    : undefined;
}

/**
 * True for an arc so short that its angles are the same once rounded, which
 * is written as an arc of no length. That is within rounding of what was
 * drawn, so it is worth a warning and not an error.
 *
 * @param startAngle - The start angle in degrees, from 0 up to 360.
 * @param endAngle - The end angle in degrees, from 0 up to 360.
 * @returns Whether the arc is written with no length.
 */
export function arcIsWrittenAsPoint(startAngle: number, endAngle: number): boolean {
  return roundsToOneAngle(startAngle, endAngle) && isShortArc(startAngle, endAngle);
}

/** Returns what is wrong with a single-line text value, or undefined when it is valid. */
export function textProblem(value: string): string | undefined {
  if (hasControl(value)) return "Text must be a single line with no control characters";
  if (hasAstral(value)) {
    return "Text cannot contain emoji or other characters above U+FFFF, because AutoCAD cannot read them from DXF";
  }
  if (/[\ue800-\ue8ff]/.test(value)) return TEXT_PRIVATE_USE;
  return undefined;
}

/**
 * Returns a warning for text that AutoCAD stores as written but draws
 * differently, or undefined when it draws what it stores.
 *
 * @param value - The text value.
 * @returns The warning, or undefined.
 */
export function textWarning(value: string): string | undefined {
  return value.includes("%%") ? TEXT_PERCENT : undefined;
}

function roundsToOneAngle(startAngle: number, endAngle: number): boolean {
  return writtenAngle(startAngle) === writtenAngle(endAngle);
}

/** True when the counterclockwise sweep from start to end is half a turn or less. */
function isShortArc(startAngle: number, endAngle: number): boolean {
  return (((endAngle - startAngle) % 360) + 360) % 360 <= 180;
}

function codePoint(character: string): string {
  return `U+${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
}

function hasControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** True when the string has a character above U+FFFF, which JavaScript stores as a surrogate pair. */
function hasAstral(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdfff) return true;
  }
  return false;
}
