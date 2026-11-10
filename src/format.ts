/** The number of decimals the writers keep. */
const DECIMALS = 6;

/**
 * A number as the writers print it: rounded to 6 decimals. Two values that are
 * equal here are the same number in the file, whatever they were in the drawing.
 */
export function written(value: number): number {
  const rounded = Number(value.toFixed(DECIMALS));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * An arc angle in degrees as the DXF writers print it: rounded to 6 decimals,
 * with 0 in place of an angle that rounds up to 360.
 */
export function writtenAngle(degrees: number): number {
  const rounded = written(degrees);
  return rounded >= 360 ? rounded - 360 : rounded;
}

/**
 * The size from which a number prints with three exponent digits, as `1e+100`.
 * AutoCAD reads only two from DXF: it takes `1e+100` for `1e+10` and
 * `1e+308` for `1e+30`, with no AUDIT error. Writing the digits out does not
 * help, because AutoCAD takes a number of 101 digits for 0.
 */
const TOO_LARGE = 1e100;

/** The largest number under `TOO_LARGE`. */
const LARGEST = 9.999999999999998e99;

/**
 * True for a number AutoCAD would misread from DXF, because it is 1e100 or
 * more in size. `lint` refuses these wherever a drawing holds one.
 */
export function isTooLarge(value: number): boolean {
  return Math.abs(value) >= TOO_LARGE;
}

/**
 * Brings a number a writer works out for itself, such as an extent or the
 * height of the view, into the range AutoCAD reads. `lint` cannot vouch for
 * those: two coordinates under 1e100 can be more than 1e100 apart.
 */
export function readable(value: number): number {
  return Math.max(-LARGEST, Math.min(LARGEST, value));
}

/** Formats a coordinate with at most 6 decimals, no float noise, and no "-0". */
export function fmt(value: number): string {
  return String(written(value));
}

/**
 * A backslash that starts a `\U+XXXX` or `\M+NXXXX` sequence. AutoCAD decodes
 * both forms in a DXF string, in either letter case.
 */
const ESCAPE_START = /\\(?=[Uu]\+[0-9A-Fa-f]{4}|[Mm]\+[1-5][0-9A-Fa-f]{4})/g;

/**
 * Escapes a string value for DXF, so that AutoCAD holds the string as given.
 *
 * A caret starts a control-character escape in DXF, and AutoCAD discards the
 * drawing when it meets a bare one, so a literal caret is written as a caret
 * and a space.
 *
 * AutoCAD decodes `\U+XXXX` and `\M+NXXXX` in a string, and it does so twice.
 * A backslash that would start one is written as `\U+005CU+005C`: the first
 * pass leaves `\U+005C` and the second leaves the backslash, with nothing left
 * to decode what follows it. This lasts until AutoCAD saves the drawing:
 * AutoCAD writes the text unescaped, so it decodes it on a later open.
 *
 * With `ascii`, characters outside ASCII become `\U+XXXX`, which is how DXF
 * versions before 2007 carry them. Later versions are UTF-8 and need no escape.
 */
export function dxfText(value: string, ascii = false): string {
  const escaped = value.replace(ESCAPE_START, "\\U+005CU+005C").replaceAll("^", "^ ");
  if (!ascii) return escaped;
  let out = "";
  for (let i = 0; i < escaped.length; i++) {
    const code = escaped.charCodeAt(i);
    out += code < 0x80 ? escaped[i] : `\\U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return out;
}
