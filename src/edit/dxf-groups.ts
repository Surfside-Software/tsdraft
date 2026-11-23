// The groups of one record of a DXF, with where each one's lines are in the file, so an edit can
// write a value again or leave a group out and copy every other byte as the file holds it.
import { isTooLarge, readable } from "../format.ts";
import { EditError } from "./model.ts";

/** A group of a record: its code, its value as the file holds it, and where its lines are. */
export interface HeldGroup {
  readonly code: number;
  /** The value's line without its line end, read byte for byte. */
  readonly value: string;
  /** Where the group's code line starts, its value line starts and ends, and the group ends. */
  readonly start: number;
  readonly valueStart: number;
  readonly valueEnd: number;
  readonly end: number;
  /** The line end of its code line. */
  readonly eol: string;
}

/** The most groups of one record an edit reads. */
export const MOST_GROUPS = 1 << 20;

/** The end of the line that starts at `at`, without its line end, and where the next starts. */
/**
 * Made when a record is first read, not when the module loads, so the library loads where no
 * TextDecoder is defined until a DXF is edited.
 */
let latin1: { decode(bytes: Uint8Array): string } | undefined;

function lineAt(bytes: Uint8Array, at: number, end: number): [stop: number, next: number] {
  let i = at;

  while (i < end && bytes[i] !== 0x0a) i++;
  const stop = i > at && bytes[i - 1] === 0x0d ? i - 1 : i;

  return [stop, i < end ? i + 1 : i];
}

/** The groups of the record that runs from `start` to `end`, or undefined for one that does not read. */
export function groupsOf(bytes: Uint8Array, start: number, end: number): HeldGroup[] | undefined {
  latin1 ??= new TextDecoder("latin1");
  const out: HeldGroup[] = [];
  let at = start;

  while (at < end) {
    if (out.length >= MOST_GROUPS) return undefined;
    const [codeStop, valueStart] = lineAt(bytes, at, end);

    if (valueStart >= end && codeStop === at) break;
    const code = Number(latin1.decode(bytes.subarray(at, codeStop)).trim());

    if (!Number.isInteger(code)) return undefined;
    const [valueEnd, next] = lineAt(bytes, valueStart, end);
    out.push({
      code,
      value: latin1.decode(bytes.subarray(valueStart, valueEnd)),
      start: at,
      valueStart,
      valueEnd,
      end: next,
      eol: valueStart - codeStop === 2 ? "\r\n" : "\n",
    });
    at = next;
  }

  return out;
}

/** A change of one record's bytes: a span replaced by new text, or left out. */
export interface Splice {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

const encoder = new TextEncoder();

/** The record's bytes with each splice made; the splices are in the record and do not overlap. */
export function spliced(
  bytes: Uint8Array,
  start: number,
  end: number,
  splices: readonly Splice[],
): Uint8Array {
  const sorted = [...splices].sort((a, b) => a.from - b.from);
  const parts: Uint8Array[] = [];
  let at = start;

  for (const s of sorted) {
    parts.push(bytes.subarray(at, s.from));

    if (s.text !== "") parts.push(encoder.encode(s.text));
    at = s.to;
  }

  parts.push(bytes.subarray(at, end));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;

  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }

  return out;
}

/**
 * A number in fixed notation with the fewest digits that read back as the same double, under
 * 1e100, as a firm's own DXF holds its coordinates, and with `0` for `-0`.
 */
export function shortest(value: number): string {
  const v = readable(value);

  if (v === 0) return "0";
  const s = String(v);
  const e = s.indexOf("e");

  if (e < 0) return s;
  const sign = s.startsWith("-") ? "-" : "";
  const mantissa = s.slice(sign.length, e);
  const exponent = Number(s.slice(e + 1));
  const point = mantissa.indexOf(".");
  const digits = mantissa.replace(".", "");
  // Where the point goes, counted in digits from the first.
  const place = (point < 0 ? mantissa.length : point) + exponent;

  if (place <= 0) return `${sign}0.${"0".repeat(-place)}${digits}`;

  if (place >= digits.length) return `${sign}${digits}${"0".repeat(place - digits.length)}`;

  return `${sign}${digits.slice(0, place)}.${digits.slice(place)}`;
}

/** The value of a number group as written again, keeping the padding the file gives it. */
export function numberAs(held: HeldGroup, value: number): Splice {
  // The leading CAD app misreads a number of 1e100 or more from a DXF: the edit is refused.
  if (isTooLarge(value))
    throw new EditError(`its group ${held.code} would come to ${value}, past what a DXF holds`);
  const lead = /^\s*/.exec(held.value)![0];

  return { from: held.valueStart, to: held.valueEnd, text: `${lead}${shortest(value)}` };
}

/** The splice that leaves a group out. */
export const leftOut = (held: HeldGroup): Splice => ({ from: held.start, to: held.end, text: "" });
