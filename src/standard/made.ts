// The standards this copy of tsdraft made, and how it takes one that another copy made. The
// builder and `lint` read this module and not `define.ts`, which draws the built-in title block
// with the builder as it loads.
import type { Standard } from "./document.ts";
import type { Problem } from "./shape.ts";

/** The standards this copy of tsdraft made, which need no second check. */
export const MADE = new WeakSet<object>();

let readAgain: ((value: unknown, problems: Problem[]) => Standard | undefined) | undefined;

/** Sets how a standard from another copy of tsdraft is read again. `define.ts` sets it. */
export function readStandardsWith(
  read: (value: unknown, problems: Problem[]) => Standard | undefined,
): void {
  readAgain = read;
}

/**
 * `value` as a standard of this copy of tsdraft: itself when this copy made it, or else read
 * again as data, and undefined when it is not a standard whose hash is its content's. Each
 * problem that makes it none is added to `problems`.
 */
export function adopted(value: unknown, problems: Problem[] = []): Standard | undefined {
  if (typeof value === "object" && value !== null && MADE.has(value)) return value as Standard;
  if (!readAgain) {
    problems.push({ item: "", message: "This copy of tsdraft has not loaded defineStandard" });
    return undefined;
  }
  return readAgain(value, problems);
}
