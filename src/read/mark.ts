// The mark tsdraft gives what an edit adds, as both readers read it from extended data.
import { isString } from "../guards.ts";
import type { ReadMark } from "./model.ts";

/** The application a mark is written under. */
export const MARK_APP = "TSDRAFT";

/** The format of the mark and of its hash's lists of fields. */
export const MARK_FORMAT = "1";

/**
 * A mark from the strings of its extended data: the format, the edit's name, the addition's id,
 * its handle and its hash. Undefined for one of another shape or format, or with a part empty.
 */
export function markOf(values: readonly unknown[]): ReadMark | undefined {
  if (values.length !== 5 || !values.every(isString)) return undefined;
  const [format, name, id, handle, hash] = values;

  if (format !== MARK_FORMAT || name === "" || id === "" || hash === "") return undefined;

  if (!/^[0-9A-Fa-f]{1,16}$/.test(handle!)) return undefined;

  return { format, name: name!, id: id!, handle: handle!, hash: hash! };
}

/** The additions an edit's record lists, from its groups: each id, group 1, and its handle, group 2. */
export function recordAdditions(
  groups: readonly { readonly code: number; readonly value: unknown }[],
): { readonly id: string; readonly handle: string }[] {
  const out: { id: string; handle: string }[] = [];
  let id: string | undefined;

  for (const g of groups) {
    if (g.code === 1) id = isString(g.value) && g.value !== "" ? g.value : undefined;
    else if (g.code === 2 && id !== undefined) {
      const handle = isString(g.value) ? g.value.trim() : "";

      if (/^[0-9A-Fa-f]{1,16}$/.test(handle))
        out.push({ id, handle: handle.replace(/^0+(?=.)/, "").toUpperCase() });
      id = undefined;
    }
  }

  return out;
}
