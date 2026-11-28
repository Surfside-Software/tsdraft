// The shape of a change, a layer's changes and a viewport's, as the builder and `checkEdit` take
// them from an edit file or from JSON: each field of its kind, and each value within what a file
// holds. Bounded on any value: a list or a record is paid for before it is walked.
import { isBoolean, isNumber, isRecord, isString } from "../guards.ts";
import { LINEWEIGHTS } from "../linetypes.ts";
import type { EntityChanges, LayerChanges, TextChange, ViewportChanges } from "./model.ts";

/** The most characters a text's value, a name or a replacement may hold. */
export const MOST_TEXT = 1 << 20;

/** The most attributes one change names, and layers one viewport's change names. */
export const MOST_NAMES = 10_000;

/** The lineweights a file holds, in hundredths of a millimetre, as group 370 gives them. */
export const LINEWEIGHT_VALUES: ReadonlySet<number> = new Set(
  LINEWEIGHTS.map((mm) => Math.round(mm * 100)),
);

const finite = (v: unknown): v is number => isNumber(v) && Number.isFinite(v);

/** A size a file holds: above 0 and within what a DXF writes. */
const size = (v: unknown): boolean => finite(v) && v > 0 && v < 1e15;

const name = (v: unknown): v is string => isString(v) && v !== "" && v.length <= 255;

/** A whole number from `low` to `high`. */
const whole = (v: unknown, low: number, high: number): boolean =>
  isNumber(v) && Number.isInteger(v) && v >= low && v <= high;

/** What is wrong with a text change, or undefined. */
export function textChangeProblem(value: unknown): string | undefined {
  if (isString(value)) return value.length > MOST_TEXT ? "the value is too long" : undefined;

  if (!isRecord(value)) return "a text change is a value or { replace: [from, to] }";

  for (const key in value)
    if (key !== "replace") return `it holds ${JSON.stringify(key.slice(0, 40))}`;
  const pair = value["replace"];

  if (!Array.isArray(pair) || pair.length !== 2) return "replace is not [from, to]";
  const [from, to]: unknown[] = [pair[0], pair[1]];

  if (!isString(from) || from === "" || from.length > MOST_TEXT)
    return "replace's from is not a string of 1 or more characters";

  if (!isString(to) || to.length > MOST_TEXT) return "replace's to is not a string";

  return undefined;
}

const ENTITY_KEYS: ReadonlySet<string> = new Set([
  "move",
  "text",
  "height",
  "width",
  "boxHeight",
  "attributes",
  "layer",
  "color",
  "trueColor",
  "linetype",
  "lineweight",
  "linetypeScale",
]);

/** What is wrong with a value meant as `EntityChanges`, or undefined. */
export function entityChangesProblem(value: EntityChanges): string | undefined {
  if (!isRecord(value)) return "the changes are not an object";
  let any = false;

  for (const key in value) {
    if (!ENTITY_KEYS.has(key))
      return `the changes hold ${JSON.stringify(key.slice(0, 40))}, which is not a change of an entity`;
    any ||= value[key] !== undefined;
  }

  if (!any) return "the changes change nothing";

  if (value.move !== undefined)
    return "a change's move is not made by this version of tsdraft: move the entity in a statement of its own";

  if (value.text !== undefined) {
    const p = textChangeProblem(value.text);

    if (p !== undefined) return `text: ${p}`;
  }

  if (value.height !== undefined && !size(value.height)) return "height is not a size above 0";

  if (value.width !== undefined && !(finite(value.width) && value.width >= 0 && value.width < 1e15))
    return "width is not 0 or more";

  if (value.boxHeight !== undefined && value.boxHeight !== 0)
    return "boxHeight is not 0, the one height set: 0 fits a multileader's note box to its text";

  if (value.attributes !== undefined) {
    if (!isRecord(value.attributes)) return "attributes is not a record of tags";
    let n = 0;

    for (const tag in value.attributes) {
      if (++n > MOST_NAMES) return `attributes names more than ${MOST_NAMES} tags`;

      if (!name(tag)) return "an attribute's tag is empty or too long";
      const p = textChangeProblem(value.attributes[tag]);

      if (p !== undefined) return `the attribute ${JSON.stringify(tag.slice(0, 40))}: ${p}`;
    }

    if (n === 0) return "attributes names no tag";
  }

  if (value.layer !== undefined && !name(value.layer)) return "layer is not a name";

  if (value.color !== undefined && !whole(value.color, 0, 256))
    return "color is not an index from 0, ByBlock, to 256, ByLayer";

  if (value.trueColor !== undefined && !whole(value.trueColor, 0, 0xffffff))
    return "trueColor is not a color 0xRRGGBB";

  if (value.color !== undefined && value.trueColor !== undefined)
    return "color and trueColor both given: give one";

  if (value.linetype !== undefined && !name(value.linetype)) return "linetype is not a name";
  const w = value.lineweight;

  if (
    w !== undefined &&
    !(isNumber(w)
      ? LINEWEIGHT_VALUES.has(w)
      : w === "ByLayer" || w === "ByBlock" || w === "Default")
  )
    return "lineweight is not one of a file's, in hundredths of a millimetre, nor ByLayer, ByBlock or Default";

  if (value.linetypeScale !== undefined && !size(value.linetypeScale))
    return "linetypeScale is not a size above 0";

  return undefined;
}

const LAYER_KEYS: ReadonlySet<string> = new Set([
  "on",
  "frozen",
  "locked",
  "plot",
  "color",
  "trueColor",
  "linetype",
  "lineweight",
]);

/** What is wrong with a value meant as `LayerChanges`, or undefined. */
export function layerChangesProblem(value: LayerChanges): string | undefined {
  if (!isRecord(value)) return "the changes are not an object";
  let any = false;

  for (const key in value) {
    if (!LAYER_KEYS.has(key))
      return `the changes hold ${JSON.stringify(key.slice(0, 40))}, which is not a change of a layer`;
    any ||= value[key] !== undefined;
  }

  if (!any) return "the changes change nothing";

  for (const key of ["on", "frozen", "locked", "plot"] as const)
    if (value[key] !== undefined && !isBoolean(value[key])) return `${key} is not true or false`;

  if (value.color !== undefined && !whole(value.color, 1, 255))
    return "a layer's color is an index from 1 to 255";

  if (value.trueColor !== undefined && !whole(value.trueColor, 0, 0xffffff))
    return "trueColor is not a color 0xRRGGBB";

  if (value.color !== undefined && value.trueColor !== undefined)
    return "color and trueColor both given: give one";

  if (value.linetype !== undefined && !name(value.linetype)) return "linetype is not a name";
  const w = value.lineweight;

  if (w !== undefined && !(isNumber(w) ? LINEWEIGHT_VALUES.has(w) : w === "Default"))
    return "a layer's lineweight is one of a file's, in hundredths of a millimetre, or Default";

  return undefined;
}

const VIEWPORT_KEYS: ReadonlySet<string> = new Set([
  "center",
  "ratio",
  "twist",
  "on",
  "freeze",
  "thaw",
]);

/** What is wrong with a value meant as `ViewportChanges`, or undefined. */
export function viewportChangesProblem(value: ViewportChanges): string | undefined {
  if (!isRecord(value)) return "the changes are not an object";
  let any = false;

  for (const key in value) {
    if (!VIEWPORT_KEYS.has(key))
      return `the changes hold ${JSON.stringify(key.slice(0, 40))}, which is not a change of a viewport`;
    any ||= value[key] !== undefined;
  }

  if (!any) return "the changes change nothing";
  const c = value.center;

  if (
    c !== undefined &&
    !(
      Array.isArray(c) &&
      c.length === 2 &&
      finite(c[0]) &&
      finite(c[1]) &&
      Math.abs(c[0]) < 1e15 &&
      Math.abs(c[1]) < 1e15
    )
  )
    return "center is not a point of two finite numbers";

  if (value.ratio !== undefined && !(size(value.ratio) && Number(value.ratio) > 1e-12))
    return "ratio is not a scale above 0";

  if (value.twist !== undefined && !(finite(value.twist) && Math.abs(value.twist) < 1e15))
    return "twist is not a finite number of degrees";

  if (value.on !== undefined && !isBoolean(value.on)) return "on is not true or false";

  for (const key of ["freeze", "thaw"] as const) {
    const list = value[key];

    if (list === undefined) continue;

    if (!Array.isArray(list) || list.length > MOST_NAMES)
      return `${key} is not a list of at most ${MOST_NAMES} layers`;

    for (let i = 0; i < list.length; i++)
      if (!name(list[i])) return `${key} holds a layer that is not a name`;
  }

  return undefined;
}

/** A text change copied, so a later change of what an edit file gave changes no statement. */
export const copyTextChange = (t: TextChange): TextChange =>
  isString(t) ? t : { replace: [t.replace[0], t.replace[1]] };
