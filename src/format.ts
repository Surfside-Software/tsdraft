/** Formats a coordinate with at most 6 decimals, no float noise, and no "-0". */
export function fmt(value: number): string {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/**
 * Escapes a string value for DXF. A caret starts a control-character escape in
 * DXF, and AutoCAD discards the drawing when it meets a bare one, so a literal
 * caret is written as a caret and a space.
 *
 * With `ascii`, characters outside ASCII become `\U+XXXX`, which is how DXF
 * versions before 2007 carry them. Later versions are UTF-8 and need no escape.
 */
export function dxfText(value: string, ascii = false): string {
  const escaped = value.replaceAll("^", "^ ");
  if (!ascii) return escaped;
  let out = "";
  for (let i = 0; i < escaped.length; i++) {
    const code = escaped.charCodeAt(i);
    out += code < 0x80 ? escaped[i] : `\\U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return out;
}
