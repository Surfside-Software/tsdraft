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
 * to decode what follows it.
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
