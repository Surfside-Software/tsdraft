// The rules a drawing must follow for AutoCAD to open its DXF. Each rule exists
// twice: as a type, so a literal mistake is an error in the editor, and as a
// runtime check, for values the compiler can't see. The messages are shared.
//
// The layer name and text rules come from opening test files in AutoCAD 2025,
// which discards the whole drawing when a name breaks them.
import type { DxfVersion } from "./drawing.ts";

const NAME_EMPTY = "Layer names cannot be empty";
const NAME_CHARS = 'Layer names cannot contain < > / \\ " : ; ? * | = ` ^ , or line breaks';
const NAME_EDGE = "Layer names cannot start or end with a space";
const NAME_LENGTH = "Layer names cannot be longer than 255 characters";
const NAME_R12_CHARS =
  'R12 layer names can only use letters, digits, $, - and _. Use DXF version "R2018" for other characters';
const NAME_R12_LENGTH =
  'R12 layer names cannot be longer than 31 characters. Use DXF version "R2018" for longer names';
const COLOR = "A layer color must be an AutoCAD Color Index integer from 1 to 255";
const POSITIVE = "This value must be greater than 0";

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

/** Resolves to `N` when it is greater than 0, and to the error message otherwise. */
export type Positive<N extends number> = number extends N
  ? N
  : `${N}` extends `-${string}` | "0"
    ? typeof POSITIVE
    : N;

/** Returns what is wrong with a layer name for a DXF version, or undefined when it is valid. */
export function layerNameProblem(name: string, version: DxfVersion): string | undefined {
  if (name.length === 0) return NAME_EMPTY;
  if (/[<>/\\":;?*|=`^,]/.test(name) || hasControl(name) || hasAstral(name)) return NAME_CHARS;
  if (name !== name.trim()) return NAME_EDGE;
  if (name.length > 255) return NAME_LENGTH;
  if (version === "R12") {
    if (!/^[A-Za-z0-9$_-]+$/.test(name)) return NAME_R12_CHARS;
    if (name.length > 31) return NAME_R12_LENGTH;
  }
  return undefined;
}

/** Returns what is wrong with a layer color, or undefined when it is valid. */
export function layerColorProblem(color: number): string | undefined {
  return Number.isInteger(color) && color >= 1 && color <= 255 ? undefined : COLOR;
}

/** Returns what is wrong with a single-line text value, or undefined when it is valid. */
export function textProblem(value: string): string | undefined {
  if (hasControl(value)) return "Text must be a single line with no control characters";
  if (hasAstral(value)) {
    return "Text cannot contain emoji or other characters above U+FFFF, because AutoCAD cannot read them from DXF";
  }
  return undefined;
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
