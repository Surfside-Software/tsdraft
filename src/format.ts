/** Formats a coordinate with at most 6 decimals, no float noise, and no "-0". */
export function fmt(value: number): string {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}
