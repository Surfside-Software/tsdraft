// The mark tsdraft gives what an edit adds, as both readers read it from extended data.
import type { ReadMark } from "./model.ts";

/** The application a mark is written under. */
export const MARK_APP = "TSDRAFT";

/** A mark from the strings of its extended data, or undefined for one of another shape. */
export function markOf(values: readonly unknown[]): ReadMark | undefined {
  if (values.length < 5) return undefined;
  const [format, name, id, handle, hash] = values.map(String);

  return { format: format!, name: name!, id: id!, handle: handle!, hash: hash! };
}

/** The additions an edit's record lists, from its groups: each id, group 1, and its handle, group 2. */
export function recordAdditions(
  groups: readonly { readonly code: number; readonly value: unknown }[],
): { readonly id: string; readonly handle: string }[] {
  const out: { id: string; handle: string }[] = [];
  let id: string | undefined;

  for (const g of groups) {
    if (g.code === 1) id = String(g.value);
    else if (g.code === 2 && id !== undefined) {
      out.push({ id, handle: String(g.value).trim().toUpperCase() });
      id = undefined;
    }
  }

  return out;
}
