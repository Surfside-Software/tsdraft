// A change of one DXF record: the values of the groups that hold a text's value, its height and
// first point, an entity's pen, a layer's state and a viewport's view written again, a group the
// record lacks added where the leading CAD app writes it, and every other byte copied.
import { matchedIndex } from "../colors.ts";
import { dxfOnce, dxfText } from "../format.ts";
import { isNumber } from "../guards.ts";
import { numberAs, shortest, type HeldGroup, type Splice } from "./dxf-groups.ts";
import type { EntityChanges, LayerChanges } from "./model.ts";

/** A group of a record with the subclass it is in, `embedded` past group 101. */
interface Placed {
  readonly i: number;
  readonly g: HeldGroup;
  readonly subclass: string;
}

/** The groups that carry a record's own data, each with its subclass: not in braces, nor its extended data. */
function own(groups: readonly HeldGroup[]): Placed[] {
  const out: Placed[] = [];
  let braces = false;
  let subclass = "";

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;

    if (g.code === 1001) break;

    if (g.code === 102) {
      braces = g.value.trim().startsWith("{");
      continue;
    }

    if (braces) continue;

    if (g.code === 100) subclass = g.value.trim();
    else if (g.code === 101) subclass = "embedded";
    out.push({ i, g, subclass });
  }

  return out;
}

/** The 16-bit codes, whose integers the leading CAD app writes six wide. */
const short = (code: number): boolean =>
  (code >= 60 && code <= 79) ||
  (code >= 170 && code <= 179) ||
  (code >= 270 && code <= 289) ||
  (code >= 370 && code <= 389);

/** A group's lines as the record writes them, with its line end. */
function line(code: number, value: string | number, eol: string): string {
  const v = isNumber(value)
    ? Number.isInteger(value)
      ? String(value).padStart(short(code) ? 6 : 9)
      : shortest(value)
    : value;

  return `${String(code).padStart(3)}${eol}${v}${eol}`;
}

/** The splices that write a record's groups: set, added after an anchor, or left out. */
class Writer {
  readonly out: Splice[] = [];
  readonly #eol: string;

  constructor(groups: readonly HeldGroup[]) {
    this.#eol = groups[0]?.eol ?? "\r\n";
  }

  /** Writes a group's value again, keeping the padding of a number. */
  set(g: HeldGroup, value: string | number): void {
    if (isNumber(value)) this.out.push(numberAs(g, value));
    else this.out.push({ from: g.valueStart, to: g.valueEnd, text: value });
  }

  /** Adds a group after `anchor`. */
  after(anchor: HeldGroup, code: number, value: string | number): void {
    this.out.push({ from: anchor.end, to: anchor.end, text: line(code, value, this.#eol) });
  }

  /** Leaves a group out. */
  drop(g: HeldGroup): void {
    this.out.push({ from: g.start, to: g.end, text: "" });
  }

  /** Replaces a group with lines of its own. */
  replace(g: HeldGroup, lines: readonly (readonly [number, string | number])[]): void {
    this.out.push({
      from: g.start,
      to: g.end,
      text: lines.map(([c, v]) => line(c, v, this.#eol)).join(""),
    });
  }
}

/**
 * Sets the groups of `codes` in one subclass, in the order the leading CAD app writes them: a group
 * the record holds is written again, a missing one added after the last group of the order before
 * it, or after `start`, and one given `undefined` left out.
 */
function setInOrder(
  w: Writer,
  placed: readonly Placed[],
  subclass: string,
  order: readonly number[],
  values: ReadonlyMap<number, string | number | undefined>,
  start: HeldGroup,
): void {
  const held = new Map<number, HeldGroup>();

  for (const p of placed)
    if (p.subclass === subclass && order.includes(p.g.code) && !held.has(p.g.code))
      held.set(p.g.code, p.g);

  for (const [code, value] of values) {
    const g = held.get(code);

    if (value === undefined) {
      if (g !== undefined) w.drop(g);
      continue;
    }

    if (g !== undefined) {
      w.set(g, value);
      continue;
    }

    const before = order.slice(0, order.indexOf(code)).reverse();
    const anchor = before.map((c) => held.get(c)).find((x) => x !== undefined) ?? start;
    w.after(anchor, code, value);
  }
}

/** Group 370 of a lineweight by name: left out for ByLayer. */
const WEIGHTS = { ByLayer: undefined, ByBlock: -2, Default: -3 } as const;

/** The order of an entity's pen in its subclass AcDbEntity. */
const PEN = [8, 6, 62, 420, 430, 440, 48, 370];

/** The pen's groups a change sets, `undefined` for one it leaves out, by code. */
export function penValues(
  c: EntityChanges,
  names: { layer?: string; linetype?: string },
): Map<number, string | number | undefined> {
  const out = new Map<number, string | number | undefined>();

  if (names.layer !== undefined) out.set(8, names.layer);

  if (c.color !== undefined) {
    out.set(62, c.color === 256 ? undefined : c.color);
    out.set(420, undefined);
    out.set(430, undefined);
  }

  if (c.trueColor !== undefined) {
    const rgb = c.trueColor;
    out.set(62, matchedIndex([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255]));
    out.set(420, rgb);
    out.set(430, undefined);
  }

  if (names.linetype !== undefined)
    out.set(6, names.linetype === "ByLayer" ? undefined : names.linetype);
  const w = c.lineweight;

  if (w !== undefined) out.set(370, isNumber(w) ? w : WEIGHTS[w]);

  if (c.linetypeScale !== undefined)
    out.set(48, c.linetypeScale === 1 ? undefined : c.linetypeScale);

  return out;
}

/** The splices that set an entity's pen, or a reason the record holds no place for it. */
export function penSplices(
  groups: readonly HeldGroup[],
  values: ReadonlyMap<number, string | number | undefined>,
): Splice[] | string {
  if (values.size === 0) return [];
  const placed = own(groups);
  const start = placed.find((p) => p.g.code === 100 && p.g.value.trim() === "AcDbEntity");

  if (start === undefined) return "the record holds no AcDbEntity subclass";
  const w = new Writer(groups);
  setInOrder(w, placed, "AcDbEntity", PEN, values, start.g);

  return w.out;
}

/** A control character as a DXF holds it: a caret and the character 64 past it, a tab `^I`. */
const controls = (value: string): string =>
  value.replace(/[\u0000-\u001f]/g, (c) => `^${String.fromCharCode(c.charCodeAt(0) + 0x40)}`);

/** A single-line text's value as the core's writer writes one: a caret, a `\U+` and a control escaped. */
export const lineValue = (value: string): string => controls(dxfText(value));

/**
 * A paragraph's value cut into the groups 3 and a last 1 a DXF holds a long text in, 250
 * characters each, escaped as the core's writer escapes one, which the leading CAD app decodes once.
 */
function chunks(value: string): [number, string][] {
  const text = controls(dxfOnce(value));
  const out: [number, string][] = [];
  let at = 0;

  while (text.length - at > 250) {
    let end = at + 250;
    const c = text.charCodeAt(end - 1);

    // A pair of surrogates is never cut, nor a caret from what it escapes.
    if ((c >= 0xd800 && c <= 0xdbff) || text[end - 1] === "^") end--;
    out.push([3, text.slice(at, end)]);
    at = end;
  }

  out.push([1, text.slice(at)]);

  return out;
}

/** Where a kind holds its text: the subclass of its value and of its height and first point. */
export type TextPlace = "AcDbText" | "AcDbMText" | "embedded";

/** What a change writes of a text: its value, height, first point, width factor and width. */
export interface TextValues {
  readonly value?: string;
  readonly height?: number;
  readonly stored?: readonly [number, number];
  readonly widthFactor?: number;
  readonly width?: number;
}

/**
 * The splices that write a text's value, its height, its first point and width factor, and a
 * paragraph's width, in the subclass `place` and, for a width, its columns', or a reason it cannot.
 */
export function textSplices(
  groups: readonly HeldGroup[],
  place: TextPlace,
  t: TextValues,
): Splice[] | string {
  const placed = own(groups);
  const w = new Writer(groups);
  const inPlace = placed.filter((p) => p.subclass === place);
  const of = (code: number): HeldGroup | undefined => inPlace.find((p) => p.g.code === code)?.g;

  if (t.value !== undefined) {
    const parts = inPlace.filter((p) => p.g.code === 1 || p.g.code === 3);

    if (parts.length === 0) return `the record holds no value in its ${place}`;

    const lines: [number, string][] =
      place === "AcDbText" ? [[1, lineValue(t.value)]] : chunks(t.value);

    w.replace(parts[0]!.g, lines);

    for (const p of parts.slice(1)) w.drop(p.g);
  }

  if (t.height !== undefined) {
    const g = of(40);

    if (g === undefined) return `the record holds no height in its ${place}`;
    w.set(g, t.height);
  }

  if (t.stored !== undefined) {
    const [x, y] = [of(10), of(20)];

    if (x === undefined || y === undefined) return "the record holds no first point";

    if (Number(x.value) !== t.stored[0]) w.set(x, t.stored[0]);

    if (Number(y.value) !== t.stored[1]) w.set(y, t.stored[1]);
  }

  if (t.widthFactor !== undefined) {
    const g = of(41);
    const value = of(1);

    if (g !== undefined) w.set(g, t.widthFactor);
    else if (t.widthFactor !== 1 && value !== undefined) w.after(value, 41, t.widthFactor);
  }

  if (t.width !== undefined) {
    const g = of(41);

    if (g === undefined) return "the record holds no width";
    w.set(g, t.width);
    // A column's width and the width of all of one column, in its embedded object.
    const embedded = placed.filter((p) => p.subclass === "embedded");

    for (const code of [40, 42, 44]) {
      const e = embedded.find((p) => p.g.code === code);

      if (e !== undefined) w.set(e.g, t.width);
    }
  }

  return w.out;
}

/**
 * The splice that fits a multileader's note box to its text: its context's own group 44 set to 0,
 * as the leading CAD app writes a new note that does not wrap, or why it cannot. The context's own groups are those
 * from `CONTEXT_DATA{` to its `}` outside each `LEADER{`; its first 290 says it holds a note, and
 * group 293 after it that the multileader is annotative, with a context for each scale. A note in
 * columns, the context's group 173, is refused: no case shows how its columns take the box.
 */
export function boxSplices(groups: readonly HeldGroup[]): Splice[] | string {
  let where: "before" | "context" | "after" = "before";
  let depth = 0;
  let note: HeldGroup | undefined;
  let box: HeldGroup | undefined;
  let columns: HeldGroup | undefined;
  let annotative = false;

  for (const { g } of own(groups)) {
    const mark = g.value.trim();

    if (where === "before") {
      if (g.code === 300 && mark === "CONTEXT_DATA{") where = "context";
    } else if (where === "after") annotative ||= g.code === 293 && Number(g.value) === 1;
    else if (g.code === 302 && mark.endsWith("{")) depth++;
    else if (depth > 0 && g.code === 303) depth--;
    else if (depth === 0 && g.code === 301) where = "after";
    else if (depth === 0) {
      if (g.code === 290) note ??= g;
      else if (g.code === 44) box ??= g;
      else if (g.code === 173) columns ??= g;
    }
  }

  if (annotative) return "it is annotative, with a note box for each scale";

  if (note === undefined || Number(note.value) !== 1 || box === undefined)
    return "the multileader holds no note box";

  if (columns !== undefined && Number(columns.value) !== 0)
    return "its note is in columns, whose box a fit to the text is not made for";

  return Number(box.value) === 0 ? [] : [numberAs(box, 0)];
}

/** The bits a host's AcXRefLayerPropertyOverride sets for each property of an xref's layer. */
const OVERRIDES = {
  on: 1,
  frozen: 2,
  locked: 4,
  plot: 8,
  linetype: 32,
  lineweight: 64,
  color: 0x110,
} as const;

/** The splices of a layer's change, or a reason it cannot be made. */
export function layerSplices(
  groups: readonly HeldGroup[],
  c: LayerChanges,
  linetype: string | undefined,
  xref: boolean,
  /** True when the file registers AcXRefLayerPropertyOverride, so a layer that lacks it takes it. */
  registered = false,
): Splice[] | string {
  const placed = own(groups);
  const w = new Writer(groups);

  const at = (code: number) =>
    placed.find((p) => p.subclass === "AcDbLayerTableRecord" && p.g.code === code)?.g;

  const flags = at(70);
  const color = at(62);

  if (flags === undefined || color === undefined)
    return "the layer's record holds no flags or color";
  let f = Number(flags.value);
  const wasColor = Number(color.value);

  if (c.frozen !== undefined) f = c.frozen ? f | 1 : f & ~1;

  if (c.locked !== undefined) f = c.locked ? f | 4 : f & ~4;

  if (f !== Number(flags.value)) w.set(flags, f);
  const off = c.on === undefined ? wasColor < 0 : !c.on;
  let index = Math.abs(wasColor);

  if (c.color !== undefined) index = c.color;

  if (c.trueColor !== undefined) {
    const rgb = c.trueColor;
    index = matchedIndex([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255]);
  }

  const values = new Map<number, string | number | undefined>();

  if ((off ? -index : index) !== wasColor) values.set(62, off ? -index : index);

  if (c.color !== undefined || c.trueColor !== undefined) values.set(430, undefined);

  if (c.color !== undefined) values.set(420, undefined);

  if (c.trueColor !== undefined) values.set(420, c.trueColor);

  if (linetype !== undefined) values.set(6, linetype);

  if (c.plot !== undefined) values.set(290, c.plot ? undefined : 0);

  if (c.lineweight !== undefined) values.set(370, c.lineweight === "Default" ? -3 : c.lineweight);
  const start = at(2);

  if (start === undefined) return "the layer's record holds no name";
  setInOrder(
    w,
    placed,
    "AcDbLayerTableRecord",
    [2, 70, 62, 420, 430, 440, 6, 290, 370, 390, 347, 348],
    values,
    start,
  );

  if (xref) {
    // A host marks each property of an xref's layer it overrides, so a reload of the xref keeps it.
    let bits = 0;

    for (const key of ["on", "frozen", "locked", "plot", "linetype", "lineweight"] as const)
      if (c[key] !== undefined) bits |= OVERRIDES[key];

    if (c.color !== undefined || c.trueColor !== undefined) bits |= OVERRIDES.color;

    const data = groups.findIndex(
      (g) => g.code === 1001 && g.value.trim() === "AcXRefLayerPropertyOverride",
    );

    const held = data >= 0 && groups[data + 1]?.code === 1071 ? groups[data + 1] : undefined;

    if (held === undefined) {
      const last = groups.at(-1);

      if (!registered || last === undefined)
        return "the xref's layer holds no AcXRefLayerPropertyOverride, which a host's change of it sets, and the file registers no such application";
      w.after(last, 1001, "AcXRefLayerPropertyOverride");
      w.after(last, 1071, bits);
    } else {
      const was = Number(held.value);

      if ((was | bits) !== was) w.set(held, was | bits);
    }
  }

  return w.out;
}

/** What a viewport's change writes: its view in the coordinates of its display, its state and its frozen layers. */
export interface ViewportValues {
  readonly center?: readonly [number, number];
  readonly viewHeight?: number;
  readonly twist?: number;
  readonly on?: boolean;
  /** The handles of the layers frozen in it after the change. */
  readonly frozen?: readonly string[];
}

/** The splices of a viewport's change, or a reason it cannot be made. */
export function viewportSplices(
  groups: readonly HeldGroup[],
  v: ViewportValues,
): Splice[] | string {
  const placed = own(groups).filter((p) => p.subclass === "AcDbViewport");
  const w = new Writer(groups);
  const at = (code: number) => placed.find((p) => p.g.code === code)?.g;

  if (v.center !== undefined) {
    const [x, y] = [at(12), at(22)];

    if (x === undefined || y === undefined) return "the viewport holds no view center";

    if (Number(x.value) !== v.center[0]) w.set(x, v.center[0]);

    if (Number(y.value) !== v.center[1]) w.set(y, v.center[1]);
  }

  for (const [code, value] of [
    [45, v.viewHeight],
    [51, v.twist],
  ] as const) {
    if (value === undefined) continue;
    const g = at(code);

    if (g === undefined) return `the viewport holds no group ${code}`;
    w.set(g, value);
  }

  if (v.on !== undefined) {
    const status = at(90);
    const stack = at(68);
    const id = at(69);

    if (status === undefined || stack === undefined || id === undefined)
      return "the viewport holds no status";
    const s = Number(status.value);
    const next = v.on ? s & ~0x20000 : s | 0x20000;

    if (next !== s) w.set(status, next);
    const order = v.on ? (Number(stack.value) > 0 ? Number(stack.value) : Number(id.value)) : 0;

    if (order !== Number(stack.value)) w.set(stack, order);
  }

  if (v.frozen !== undefined) {
    const held = placed.filter((p) => p.g.code === 331);

    for (const p of held) w.drop(p.g);
    const anchor = at(72) ?? at(51);

    if (anchor === undefined) return "the viewport holds no place for its frozen layers";

    for (const h of v.frozen) w.after(anchor, 331, h);
  }

  return w.out;
}

/** The splice that writes a header variable's value, the group after its name. */
export function headerSplice(
  bytes: Uint8Array,
  start: number,
  length: number,
  value: number,
): Splice | undefined {
  const text = new TextDecoder("latin1").decode(bytes.subarray(start, start + length));
  const m = /^[^\n]*\n[^\n]*\n([^\n]*)\n([^\r\n]*)/.exec(text);

  if (m === null) return undefined;
  const offset = m.index + m[0].length - m[2]!.length;
  const lead = /^\s*/.exec(m[2]!)![0];

  return { from: start + offset, to: start + offset + m[2]!.length, text: `${lead}${value}` };
}
