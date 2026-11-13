// The standards this copy of tsdraft made, and how it takes one that another copy made. The
// builder reads this module and not `define.ts`, which draws the built-in title block with the
// builder as it loads.
import type { Standard } from "./document.ts";

/** The standards this copy of tsdraft made, which need no second check. */
export const MADE = new WeakSet<object>();

let readAgain: ((value: unknown) => Standard | undefined) | undefined;

/** Sets how a standard from another copy of tsdraft is read again. `define.ts` sets it. */
export function readStandardsWith(read: (value: unknown) => Standard | undefined): void {
  readAgain = read;
}

/**
 * `value` as a standard of this copy of tsdraft: itself when this copy made it, or else read
 * again as data, and undefined when it is not a standard whose hash is its content's.
 */
export function adopted(value: unknown): Standard | undefined {
  if (typeof value === "object" && value !== null && MADE.has(value)) return value as Standard;
  return readAgain?.(value);
}
