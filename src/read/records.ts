// A record of a DXF and what reads its groups: the readings of the model and of geometry share
// these.
import type { Point } from "../drawing.ts";
import { unescaped } from "./groups.ts";

/** One record: its kind, from group 0, and its groups after that. */
export interface Rec {
  type: string;
  codes: number[];
  values: string[];
}

export const first = (r: Rec, code: number): string | undefined => {
  const i = r.codes.indexOf(code);
  return i < 0 ? undefined : r.values[i];
};

export const num = (r: Rec, code: number): number | undefined => {
  const value = first(r, code);
  if (value === undefined) return undefined;
  const n = Number(value);
  return value.trim() !== "" && Number.isFinite(n) ? n : undefined;
};

export const point = (r: Rec, x: number): Point => [num(r, x) ?? 0, num(r, x + 10) ?? 0];

/** How an entity's own coordinates lie in the world: 1 as they are, -1 mirrored, 0 tilted. */
export type Facing = 1 | -1 | 0;

/**
 * How an entity's own coordinates lie in the world, from its extrusion, groups 210 to 230: 1 as
 * they are, -1 seen from below, which mirrors X, and 0 for any other direction.
 */
export function facing(r: Rec): Facing {
  const x = num(r, 210) ?? 0;
  const y = num(r, 220) ?? 0;
  const z = num(r, 230) ?? 1;
  if (Math.abs(x) > 1e-9 || Math.abs(y) > 1e-9 || z === 0) return 0;
  return z > 0 ? 1 : -1;
}

/** A point of an entity's own coordinates, in the world's, for an entity that faces up or down. */
export const placed = (p: Point, face: Facing): Point => (face === -1 ? [-p[0], p[1]] : p);

/** An angle of an entity's own coordinates in the world's, in degrees. */
export const turned = (angle: number, face: Facing): number =>
  face === -1 ? (((180 - angle) % 360) + 360) % 360 : angle;

export const name = (r: Rec, code: number): string | undefined => {
  const value = first(r, code);
  return value === undefined ? undefined : unescaped(value);
};

/** Each value of `code` after the subclass marker `subclass` (group 100) and before the next. */
export function inSubclass(r: Rec, subclass: string): Rec {
  const out: Rec = { type: r.type, codes: [], values: [] };
  let inside = false;
  for (let i = 0; i < r.codes.length; i++) {
    if (r.codes[i] === 100) inside = r.values[i] === subclass;
    else if (inside) {
      out.codes.push(r.codes[i]!);
      out.values.push(r.values[i]!);
    }
  }
  return out;
}

/** The values of an application's xdata: what follows its 1001 group, up to the next. */
export function xdata(r: Rec, app: string): Rec {
  const out: Rec = { type: r.type, codes: [], values: [] };
  let inside = false;
  for (let i = 0; i < r.codes.length; i++) {
    if (r.codes[i] === 1001) inside = r.values[i]!.toUpperCase() === app.toUpperCase();
    else if (inside) {
      out.codes.push(r.codes[i]!);
      out.values.push(r.values[i]!);
    }
  }
  return out;
}

/**
 * The handle of a record's owner: its first group 330 outside the groups an application opens
 * with 102, such as `{ACAD_REACTORS`, which hold handles of other objects.
 */
export function ownerOf(r: Rec): string | undefined {
  let inside = false;
  for (let i = 0; i < r.codes.length; i++) {
    if (r.codes[i] === 102) inside = r.values[i]!.startsWith("{");
    else if (!inside && r.codes[i] === 330) return r.values[i];
  }
  return undefined;
}

/** The handle a 102 group `{NAME` opens, through its 360 or 330 group. */
export function inGroup(r: Rec, group: string, code: number): string | undefined {
  let inside = false;
  for (let i = 0; i < r.codes.length; i++) {
    if (r.codes[i] === 102) inside = r.values[i] === group;
    else if (inside && r.codes[i] === code) return r.values[i];
  }
  return undefined;
}

/**
 * An object keyed by names from the file. It has no prototype, so a name such as `constructor`
 * or `__proto__` is a key like any other.
 */
export const map = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

export const add = (counts: Record<string, number>, key: string, n = 1): void => {
  counts[key] = (counts[key] ?? 0) + n;
};
