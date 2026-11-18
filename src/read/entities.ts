// What a DXF record of an entity reads as: the kinds of `ReadEntity`, each in the world's
// coordinates with the pen it sets for itself.
import type { Point } from "../drawing.ts";
import { textOnce, textTwice } from "./groups.ts";
import type {
  ReadAttribute,
  ReadDimension,
  ReadEntity,
  ReadEntityBase,
  ReadMtext,
  ReadMultileader,
  ReadTextPlacement,
} from "./model.ts";
import {
  facing,
  first,
  name,
  num,
  placed,
  point,
  turned,
  type Facing,
  type Rec,
} from "./records.ts";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** What a record reads as: an entity, a kind left out and why, or a record that is broken. */
export type Reading =
  | { readonly entity: ReadEntity }
  | { readonly other: string }
  | { readonly malformed: string };

/** The handle a group holds: 1 to 16 hexadecimal digits, or undefined for anything else. */
export function handleAt(r: Rec, code: number): string | undefined {
  const value = first(r, code);
  return value !== undefined && /^[0-9A-Fa-f]{1,16}$/.test(value) ? value : undefined;
}

/** The pen an entity sets for itself, with each part left out at ByLayer. */
export function baseOf(r: Rec, layer: string, handle: string | undefined): ReadEntityBase {
  const color = num(r, 62);
  const trueColor = num(r, 420);
  const linetype = name(r, 6);
  const lineweight = num(r, 370);
  const linetypeScale = num(r, 48);
  return {
    handle,
    layer,
    ...(color !== undefined && color !== 256 && { color }),
    ...(trueColor !== undefined && { trueColor }),
    ...(linetype !== undefined && !/^bylayer$/i.test(linetype.trim()) && { linetype }),
    ...(lineweight !== undefined && lineweight !== -1 && { lineweight }),
    ...(linetypeScale !== undefined && linetypeScale !== 1 && { linetypeScale }),
  };
}

/** The group codes of the doubles an entity holds: its points, sizes, angles and direction. */
const isDouble = (code: number): boolean =>
  (code >= 10 && code <= 59) || (code >= 110 && code <= 149) || (code >= 210 && code <= 239);

/** True when a double of the record does not read as a finite number. */
export function brokenNumber(r: Rec): boolean {
  for (let i = 0; i < r.codes.length; i++) {
    if (!isDouble(r.codes[i]!)) continue;
    const value = r.values[i]!;
    if (value.trim() !== "" && !Number.isFinite(Number(value))) return true;
  }
  return false;
}

/** An angle in degrees, from 0 up to 360. */
const degrees = (n: number): number => ((n % 360) + 360) % 360;

const ALIGNS = ["left", "center", "right", "aligned", "middle", "fit"] as const;
const VALIGNS = ["baseline", "bottom", "middle", "top"] as const;

/** A justified text whose two points are one, as the file holds it, for its start to be worked out. */
export interface PendingStart {
  readonly placement: Mutable<ReadTextPlacement>;
  readonly value: string;
  /** The alignment point and the rotation in the entity's own coordinates. */
  readonly own: Point;
  readonly rotation: number;
  readonly face: Facing;
  /** Group 71: 2 for a text mirrored along its baseline, 4 across it. */
  readonly flags: number;
}

/**
 * Where a text, an attribute or an attribute definition is. A justified text whose file holds
 * its alignment point as its first point too gets `alignment` and a pending start, which the
 * reader works out once it knows the text's font.
 */
export function placementOf(
  r: Rec,
  face: Facing,
  value: string,
  valignCode: 73 | 74,
): { placement: Mutable<ReadTextPlacement>; pending?: PendingStart } {
  const align = ALIGNS[num(r, 72) ?? 0] ?? "left";
  // A text fitted or aligned between its points, or set on its middle, has no vertical one.
  const valign =
    align === "left" || align === "center" || align === "right"
      ? (VALIGNS[num(r, valignCode) ?? 0] ?? "baseline")
      : "baseline";
  const flags = num(r, 71) ?? 0;
  const own = point(r, 10);
  const ownAlign = first(r, 11) !== undefined ? point(r, 11) : own;
  const rotation = num(r, 50) ?? 0;
  const widthFactor = num(r, 41) ?? 1;
  const oblique = num(r, 51) ?? 0;
  const stored = placed(own, face);
  const justified = align !== "left" || valign !== "baseline";
  const placement: Mutable<ReadTextPlacement> = {
    at: stored,
    startFrom: "file",
    stored,
    ...(justified && { alignAt: placed(ownAlign, face) }),
    height: num(r, 40) ?? 0,
    // Seen from below, a text turns the other way and reads backward.
    rotation: face === -1 ? degrees(-rotation) : rotation,
    style: name(r, 7) ?? "Standard",
    ...(align !== "left" && { align }),
    ...(valign !== "baseline" && { valign }),
    ...(widthFactor !== 1 && { widthFactor }),
    ...(oblique !== 0 && { oblique }),
    ...(((flags & 2) !== 0) !== (face === -1) && { backward: true }),
    ...((flags & 4) !== 0 && { upsideDown: true }),
  };
  if (!justified || own[0] !== ownAlign[0] || own[1] !== ownAlign[1]) return { placement };
  placement.at = placement.alignAt!;
  placement.startFrom = "alignment";
  return { placement, pending: { placement, value, own: ownAlign, rotation, face, flags } };
}

/** The groups of an `MTEXT` before its embedded object, group 101, which repeats some of them. */
function ownGroups(r: Rec): Rec {
  const end = r.codes.indexOf(101);
  return end < 0
    ? r
    : { type: r.type, codes: r.codes.slice(0, end), values: r.values.slice(0, end) };
}

/** The names of the kinds of dimension `ReadDimension` does not hold, by group 70's low bits. */
const DIMENSION_KINDS = ["", "", "angular", "diameter", "radius", "angular 3-point", "ordinate"];

/** What the reader finishes once the whole file is read. */
export interface Later {
  /** A justified text whose start is worked out from its font. */
  start(pending: PendingStart): void;
  /** A multileader whose styles are named by these handles. */
  leader(entity: ReadMultileader, style: string | undefined, textStyle: string | undefined): void;
}

/**
 * What a record of a kind with nothing after it reads as, or undefined for a kind it does not
 * read here. `face` is how its own coordinates lie in the world.
 */
export function readingOf(
  r: Rec,
  base: ReadEntityBase,
  face: Facing,
  later: Later,
  r12 = false,
): Reading | undefined {
  if (brokenNumber(r)) return { malformed: `${r.type} with a number that is not finite` };
  switch (r.type) {
    case "LINE":
      return { entity: { ...base, kind: "line", from: point(r, 10), to: point(r, 11) } };
    case "CIRCLE":
      if (face === 0) return { other: "CIRCLE in 3D" };
      return {
        entity: {
          ...base,
          kind: "circle",
          center: placed(point(r, 10), face),
          radius: num(r, 40) ?? 0,
        },
      };
    case "ARC":
      if (face === 0) return { other: "ARC in 3D" };
      // Seen from below, an arc runs the other way: its end is the world's start.
      return {
        entity: {
          ...base,
          kind: "arc",
          center: placed(point(r, 10), face),
          radius: num(r, 40) ?? 0,
          start: turned(num(r, face === -1 ? 51 : 50) ?? 0, face),
          end: turned(num(r, face === -1 ? 50 : 51) ?? 0, face),
        },
      };
    case "LWPOLYLINE":
      return lwpolyline(r, base, face);
    case "TEXT": {
      if (face === 0) return { other: "TEXT in 3D" };
      const value = textTwice(first(r, 1) ?? "");
      const { placement, pending } = placementOf(r, face, value, 73);
      const entity = { ...base, kind: "text" as const, ...placement, value };
      if (pending) later.start({ ...pending, placement: entity });
      return { entity };
    }
    case "MTEXT":
      return mtext(r, base);
    case "DIMENSION":
      return dimension(r, base, face, r12);
    case "MULTILEADER":
      return multileader(r, base, later);
    case "SOLID": {
      if (face === 0) return { other: "SOLID in 3D" };
      const corner = (code: number): Point =>
        placed(first(r, code) === undefined ? point(r, 12) : point(r, code), face);
      return { entity: { ...base, kind: "solid", points: [10, 11, 13, 12].map(corner) } };
    }
    default:
      return undefined;
  }
}

function lwpolyline(r: Rec, base: ReadEntityBase, face: Facing): Reading {
  if (face === 0) return { other: "LWPOLYLINE in 3D" };
  const points: Point[] = [];
  let arcs = false;
  let x: number | undefined;
  let wide = (num(r, 43) ?? 0) !== 0;
  for (let i = 0; i < r.codes.length; i++) {
    const code = r.codes[i];
    if (code === 10) x = Number(r.values[i]);
    else if (code === 20 && x !== undefined) {
      points.push(placed([x, Number(r.values[i])], face));
      x = undefined;
    } else if (code === 42 && Number(r.values[i]) !== 0) arcs = true;
    else if ((code === 40 || code === 41) && Number(r.values[i]) !== 0) wide = true;
  }
  if (arcs) return { other: "LWPOLYLINE with arcs" };
  if (wide) return { other: "LWPOLYLINE with widths" };
  return {
    entity: {
      ...base,
      kind: "polyline",
      points,
      closed: ((num(r, 70) ?? 0) & 1) !== 0,
    },
  };
}

function mtext(record: Rec, base: ReadEntityBase): Reading {
  const face = facing(record);
  if (face !== 1) return { other: face === -1 ? "MTEXT seen from below" : "MTEXT in 3D" };
  const r = ownGroups(record);
  let value = "";
  for (let i = 0; i < r.codes.length; i++) {
    if (r.codes[i] === 3 || r.codes[i] === 1) value += r.values[i];
  }
  const dx = num(r, 11);
  const dy = num(r, 21);
  // Its direction, groups 11 and 21, or else its rotation in radians, group 50.
  const rotation =
    dx !== undefined && dy !== undefined && (dx !== 0 || dy !== 0)
      ? degrees((Math.atan2(dy, dx) * 180) / Math.PI)
      : degrees((((num(r, 50) ?? 0) % (2 * Math.PI)) * 180) / Math.PI);
  const entity: ReadMtext = {
    ...base,
    kind: "mtext",
    at: point(r, 10),
    height: num(r, 40) ?? 0,
    width: num(r, 41) ?? 0,
    attachment: num(r, 71) ?? 1,
    rotation,
    style: name(r, 7) ?? "Standard",
    value: textOnce(value),
  };
  return { entity };
}

function dimension(r: Rec, base: ReadEntityBase, face: Facing, r12: boolean): Reading {
  if (face !== 1) return { other: face === -1 ? "DIMENSION seen from below" : "DIMENSION in 3D" };
  const kind = (num(r, 70) ?? 0) & 7;
  if (kind > 1) return { other: `DIMENSION ${DIMENSION_KINDS[kind] ?? "of another kind"}` };
  const angle = kind === 0 ? (num(r, 50) ?? 0) : 0;
  // The leading CAD app leaves the measurement out when it is 1. An R12 file holds none.
  const measurement = num(r, 42) ?? (r12 ? undefined : 1);
  const text = first(r, 1);
  const block = name(r, 2);
  const entity: ReadDimension = {
    ...base,
    kind: "dimension",
    type: kind === 0 ? "linear" : "aligned",
    from: point(r, 13),
    to: point(r, 14),
    line: point(r, 10),
    ...(angle !== 0 && { angle }),
    textAt: point(r, 11),
    ...(measurement !== undefined && { measurement }),
    ...(text !== undefined && text !== "" && { text: textOnce(text) }),
    style: name(r, 3) ?? "Standard",
    ...(block !== undefined && block !== "" && { block }),
  };
  return { entity };
}

/**
 * A `MULTILEADER` with one root, straight shafts and a note, as the writers write one, from the
 * context data that says how it is drawn. Any other is left out by what it holds.
 */
function multileader(r: Rec, base: ReadEntityBase, later: Later): Reading {
  const c = r.codes;
  const v = r.values;
  let where: "before" | "context" | "leader" | "line" | "after" = "before";
  const roots: { shafts: Point[][]; groups: Record<number, string> }[] = [];
  let shaft: Point[] = [];
  // The first value of each group of the context and of what follows it, which hold each once.
  const context: Record<number, string> = {};
  const after: Record<number, string> = {};
  for (let i = 0; i < c.length; i++) {
    const code = c[i]!;
    const value = v[i]!;
    // The groups that open and close a part, as the leading CAD app writes them, may carry spaces.
    const mark = code >= 300 && code <= 305 ? value.trim() : value;
    if (where === "before") {
      if (code === 300 && mark === "CONTEXT_DATA{") where = "context";
    } else if (where === "context" && code === 301 && mark === "}") where = "after";
    else if (where === "context" && code === 302 && mark === "LEADER{") {
      where = "leader";
      roots.push({ shafts: [], groups: {} });
    } else if (where === "leader" && code === 304 && mark === "LEADER_LINE{") {
      where = "line";
      shaft = [];
    } else if (where === "line" && code === 305) {
      where = "leader";
      roots.at(-1)!.shafts.push(shaft);
    } else if (where === "leader" && code === 303) where = "context";
    else if (where === "line") {
      if (code === 10 && c[i + 1] === 20) shaft.push([Number(value), Number(v[i + 1])]);
    } else {
      const groups =
        where === "leader" ? roots.at(-1)!.groups : where === "context" ? context : after;
      if (!(code in groups)) groups[code] = value;
    }
  }
  const number = (groups: Record<number, string>, code: number, otherwise: number): number => {
    const value = Number(groups[code]);
    return groups[code] !== undefined && Number.isFinite(value) ? value : otherwise;
  };
  const pair = (groups: Record<number, string>, x: number): Point | undefined =>
    groups[x] === undefined ? undefined : [number(groups, x, 0), number(groups, x + 10, 0)];
  // Group 172 after the context is what the note is: 2 a text, 1 a block. 170 is the shafts'
  // kind: 1 straight, 2 curved, 0 none.
  if (number(after, 172, 2) !== 2) return { other: "MULTILEADER with a block" };
  if (number(after, 170, 1) !== 1) return { other: "MULTILEADER without straight shafts" };
  if (roots.length !== 1) return { other: "MULTILEADER with other than one root" };
  // The note's normal is groups 11, 21 and 31 of the context.
  if (
    Math.abs(number(context, 11, 0)) > 1e-9 ||
    Math.abs(number(context, 21, 0)) > 1e-9 ||
    number(context, 31, 1) <= 0
  ) {
    return { other: "MULTILEADER in 3D" };
  }
  const root = roots[0]!;
  const at = pair(root.groups, 10);
  const textAt = pair(context, 12);
  const text = context[304];
  if (text === undefined || !at || !textAt) return { other: "MULTILEADER without a note" };
  const entity: ReadMultileader = {
    ...base,
    kind: "multileader",
    shafts: root.shafts,
    at,
    direction: pair(root.groups, 11) ?? [1, 0],
    landing: number(root.groups, 40, 0),
    text: textOnce(text),
    textAt,
    textHeight: number(context, 41, 0),
    textStyle: "Standard",
    arrowSize: number(context, 140, 0),
  };
  later.leader(entity, after[340], context[340]);
  return { entity };
}

/** An attribute of an insert from its `ATTRIB` record. */
export function attributeOf(
  r: Rec,
  base: ReadEntityBase,
  later: Later,
): ReadAttribute | { malformed: string } | { other: string } {
  if (brokenNumber(r)) return { malformed: "ATTRIB with a number that is not finite" };
  const face = facing(r);
  if (face === 0) return { other: "ATTRIB in 3D" };
  const value = textTwice(first(r, 1) ?? "");
  const { placement, pending } = placementOf(r, face, value, 74);
  const attribute = {
    ...base,
    ...placement,
    tag: textTwice(first(r, 2) ?? ""),
    value,
    ...(((num(r, 70) ?? 0) & 1) !== 0 && { invisible: true }),
  };
  if (pending) later.start({ ...pending, placement: attribute });
  return attribute;
}

/** The characters a string costs against a budget: one item for each 32. */
export const nameCost = (value: string | undefined): number =>
  value === undefined ? 0 : Math.floor(value.length / 32);
const chars = nameCost;

/** What a text's place costs: one for each point it holds. */
const placementCost = (p: ReadTextPlacement): number =>
  2 + (p.alignAt === undefined ? 0 : 1) + chars(p.style);

/** What an attribute costs against a budget. */
export const attributeCost = (a: ReadAttribute): number =>
  1 + placementCost(a) + chars(a.tag) + chars(a.value) + chars(a.layer) + chars(a.linetype);

/**
 * What an entity costs against `BLOCK_ITEMS` or `GEOMETRY_ITEMS`: one, and one more for each of
 * its points, each attribute or tag, and each 32 characters of its names and its text.
 */
export function costOf(e: ReadEntity): number {
  const own = 1 + chars(e.layer) + chars(e.linetype);
  switch (e.kind) {
    case "line":
      return own + 2;
    case "circle":
    case "arc":
      return own + 1;
    case "polyline":
    case "solid":
      return own + e.points.length;
    case "text":
      return own + placementCost(e) + chars(e.value);
    case "mtext":
      return own + 1 + chars(e.value) + chars(e.style);
    case "dimension":
      return own + 4 + chars(e.text) + chars(e.style) + chars(e.block);
    case "multileader": {
      let points = 3;
      for (const shaft of e.shafts) points += shaft.length;
      return own + points + chars(e.text) + chars(e.textStyle) + chars(e.style);
    }
    case "insert": {
      let more = 2 + chars(e.block);
      for (const tag in e.tags) more += 1 + chars(tag);
      for (const a of e.attributes ?? []) more += attributeCost(a);
      return own + more;
    }
  }
}
