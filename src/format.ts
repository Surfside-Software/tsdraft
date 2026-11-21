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
 * A number with 15 significant digits and no exponent, which JavaScript writes for a number
 * under a millionth. Summed as a whole number, 15 digits stay under 2^53, so the double
 * the leading CAD app reads from them can be worked out exactly, where a 16th may move it a unit in
 * the last place.
 */
export function fifteenDigits(value: number): string {
  const kept = Number(value.toPrecision(15));
  return Math.abs(kept) < 1e-6 ? kept.toFixed(20) : String(kept);
}

/**
 * An arc angle in degrees as the DXF writers print it: rounded to 6 decimals,
 * with 0 in place of an angle that rounds up to 360.
 */
/**
 * A number the writers work out, such as a knot or a fitted point, as they print it: 16
 * significant digits, and below a millionth 20 decimals, never with an exponent.
 */
export function sixteenDigits(value: number): string {
  const kept = Number(value.toPrecision(16));
  return Math.abs(kept) < 1e-6
    ? kept.toFixed(20).replace(/0+$/, "").replace(/\.$/, "")
    : String(kept);
}

export function writtenAngle(degrees: number): number {
  const rounded = written(degrees);
  return rounded >= 360 ? rounded - 360 : rounded;
}

/**
 * The size from which a number prints with three exponent digits, as `1e+100`.
 * The leading CAD app reads only two from DXF: it takes `1e+100` for `1e+10` and
 * `1e+308` for `1e+30`, with no AUDIT error. Writing the digits out does not
 * help, because that app takes a number of 101 digits for 0.
 */
const TOO_LARGE = 1e100;

/** The largest number under `TOO_LARGE`. */
const LARGEST = 9.999999999999998e99;

/** The largest number of 15 digits under `TOO_LARGE`, which `fifteenDigits` keeps under it. */
const LARGEST_FIFTEEN_DIGITS = 9.99999999999999e99;

/**
 * A number a writer works out for itself as `fifteenDigits` writes it, brought into the range the
 * leading CAD app reads as `readable` brings one.
 */
export function readableFifteenDigits(value: number): string {
  return fifteenDigits(Math.max(-LARGEST_FIFTEEN_DIGITS, Math.min(LARGEST_FIFTEEN_DIGITS, value)));
}

/**
 * True for a number the leading CAD app would misread from DXF, because it is 1e100 or
 * more in size. `lint` refuses these wherever a drawing holds one.
 */
export function isTooLarge(value: number): boolean {
  return Math.abs(value) >= TOO_LARGE;
}

/**
 * Brings a number a writer works out for itself, such as an extent or the
 * height of the view, into the range the leading CAD app reads. `lint` cannot vouch for
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
 * A backslash that starts a `\U+XXXX` or `\M+NXXXX` sequence. The leading CAD app decodes
 * both forms in a DXF string, in either letter case.
 */
const ESCAPE_START = /\\(?=[Uu]\+[0-9A-Fa-f]{4}|[Mm]\+[1-5][0-9A-Fa-f]{4})/g;

/**
 * Escapes a string value for DXF, so that the leading CAD app holds the string as given.
 *
 * A caret starts a control-character escape in DXF, and that app discards the
 * drawing when it meets a bare one, so a literal caret is written as a caret
 * and a space.
 *
 * That app decodes `\U+XXXX` and `\M+NXXXX` in a string, and it does so twice.
 * A backslash that would start one is written as `\U+005CU+005C`: the first
 * pass leaves `\U+005C` and the second leaves the backslash, with nothing left
 * to decode what follows it. This lasts until that app saves the drawing:
 * that app writes the text unescaped, so it decodes it on a later open.
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

/**
 * Escapes a string that the leading CAD app decodes once when it reads DXF, as it does a linetype's
 * description, so that that app holds the string as given. `dxfText` explains the escapes; a
 * text is decoded twice, and a description once, so here a backslash that would start an
 * escape is written as `\U+005C`.
 */
export function dxfOnce(value: string): string {
  return value.replace(ESCAPE_START, "\\U+005C").replaceAll("^", "^ ");
}
