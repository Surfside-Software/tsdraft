// The mark tsdraft gives each entity, table record and block an edit adds: extended data under the
// application TSDRAFT, holding the mark's format, the edit's name, the addition's id, the handle it
// was written with and a hash of what it held. A later edit tells by it what is still tsdraft's: an
// entity whose mark holds its own handle and whose hash matches what it holds. A copy a person
// makes carries the mark with another's handle, and a change makes the hash differ.
import { written } from "../format.ts";
import { isNumber, type Json } from "../guards.ts";
import { MARK_APP } from "../read/mark.ts";
import type { ReadEntity, ReadMark } from "../read/model.ts";
import { sha256Text } from "../sha256.ts";
import { canonicalHandle } from "./model.ts";

export { MARK_APP, MARK_FORMAT, markOf } from "../read/mark.ts";

/** The mark of each handle the additions write, by the handle. */
export type Marks = ReadonlyMap<string, ReadMark>;

/** The groups of a mark, as a record's extended data ends with them. */
export function markGroups(mark: ReadMark): [number, string][] {
  return [
    [1001, MARK_APP],
    [1000, mark.format],
    [1000, mark.name],
    [1000, mark.id],
    [1000, mark.handle],
    [1000, mark.hash],
  ];
}

const BASE = [
  "layer",
  "color",
  "trueColor",
  "colorBook",
  "alpha",
  "linetype",
  "lineweight",
  "linetypeScale",
];

const TEXT = ["height", "rotation", "style", "align", "valign", "widthFactor", "oblique"];
const DIMENSION = ["textAt", "text", "textBelow", "style"];

/**
 * The fields of each kind format 1 hashes. Left out: the handle, the mark, the order of drawing, and
 * what the leading CAD app works out again of itself: a justified text's start, a dimension's
 * picture and measurement, a fit spline's knots, a multileader's stored note box, which its save
 * of a wrapped note sets, and the handles of what an entity names.
 */
const MARK_FIELDS = new Map<string, readonly string[]>(
  Object.entries({
    line: ["from", "to"],
    polyline: ["points", "closed", "bulges", "width", "widths", "linetypeGeneration", "heavy"],
    circle: ["center", "radius"],
    arc: ["center", "radius", "start", "end"],
    text: ["value", "point", "backward", "upsideDown", ...TEXT],
    insert: ["block", "at", "scale", "rotation", "attributes", "clip"],
    mtext: [
      "at",
      "height",
      "width",
      "attachment",
      "rotation",
      "style",
      "value",
      "lineSpacing",
      "lineSpacingStyle",
      "columns",
      "mask",
    ],
    dimension: ["type", "from", "to", "line", "angle", ...DIMENSION],
    "radial-dimension": ["type", "center", "point", "start", "jog", "placed", ...DIMENSION],
    "angular-dimension": [
      "type",
      "vertex",
      "from",
      "to",
      "first",
      "second",
      "at",
      "placed",
      ...DIMENSION,
    ],
    "ordinate-dimension": ["axis", "origin", "feature", "leaderEnd", "placed", ...DIMENSION],
    "arc-length-dimension": [
      "center",
      "radius",
      "startAngle",
      "endAngle",
      "at",
      "placed",
      "partial",
      ...DIMENSION,
    ],
    multileader: [
      "style",
      "shafts",
      "at",
      "direction",
      "landing",
      "shaft",
      "text",
      "textAttachment",
      "width",
      "textHeight",
      "textStyle",
      "arrowSize",
      "frame",
      "mask",
      "roots",
      "attachments",
      "left",
      "right",
      "top",
      "bottom",
      "vertical",
      "block",
      "name",
      "scale",
      "rotation",
      "attributes",
    ],
    leader: ["style", "points", "shaft", "arrowhead", "note"],
    table: ["style", "at", "direction", "rows", "columns", "title", "header", "cells"],
    solid: ["points"],
    wipeout: ["points"],
    point: ["at", "rotation"],
    ellipse: ["center", "majorAxis", "ratio", "startParameter", "endParameter", "normal"],
    spline: [
      "degree",
      "controlPoints",
      "weights",
      "closed",
      "periodic",
      "fitPoints",
      "startTangent",
      "endTangent",
      "fitTolerance",
      "knotSpacing",
    ],
    image: [
      "path",
      "pixels",
      "at",
      "u",
      "v",
      "clip",
      "invertClip",
      "transparent",
      "hidden",
      "brightness",
      "contrast",
      "fade",
    ],
    underlay: [
      "path",
      "page",
      "at",
      "scale",
      "rotation",
      "clip",
      "invertClip",
      "hidden",
      "monochrome",
      "fade",
      "contrast",
    ],
    hatch: [
      "pattern",
      "solid",
      "style",
      "loops",
      "patternType",
      "patternAngle",
      "patternScale",
      "crossed",
      "patternLines",
      "gradient",
    ],
  }),
);

const isJsonList = (v: Json): v is readonly Json[] => Array.isArray(v);

const isJsonObject = (v: Json): v is { readonly [key: string]: Json } =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * A value as the hash holds it, as JSON text: each number as the writers write it, each object by
 * its keys in order, without what names a handle.
 */
function plain(value: Json, depth = 0): string {
  if (depth > 32) return "null";

  if (isNumber(value)) return JSON.stringify(written(value));

  if (isJsonList(value)) return `[${value.map((v) => plain(v, depth + 1)).join(",")}]`;

  if (isJsonObject(value)) {
    const fields = Object.keys(value)
      .sort()
      .flatMap((key) =>
        value[key] === undefined || key === "handle" || key.endsWith("Handle")
          ? []
          : [`${JSON.stringify(key)}:${plain(value[key]!, depth + 1)}`],
      );

    return `{${fields.join(",")}}`;
  }

  return JSON.stringify(value);
}

/** The fields of an entity the mark's hash holds, by the list of its kind. */
function marked(e: ReadEntity): Json {
  const source = new Map(Object.entries(e));
  const out = new Map<string, Json>([["kind", e.kind]]);

  for (const key of [...BASE, ...(MARK_FIELDS.get(e.kind) ?? [])]) {
    let value = source.get(key);

    if (key === "point" && e.kind === "text") value = e.alignAt ?? e.at;
    else if (key === "attributes" && e.kind === "insert")
      value = e.attributes?.map((a) => {
        const source = new Map(Object.entries(a));

        // Each attribute as a text is held, where it is justified, with its tag and paragraph.
        const fields = [
          ...BASE,
          ...TEXT,
          "tag",
          "value",
          "invisible",
          "paragraph",
          "backward",
          "upsideDown",
        ].flatMap((k) => {
          const v = source.get(k);

          return v === undefined ? [] : [[k, v] as const];
        });

        return Object.fromEntries([...fields, ["point", a.alignAt ?? a.at]]);
      });

    if (value !== undefined) out.set(key, value);
  }

  return Object.fromEntries(out);
}

/** The hash of what an entity holds: 32 hexadecimal digits of the SHA-256 of its fields. */
export function markHash(e: ReadEntity): string {
  return sha256Text(plain(marked(e))).slice(0, 32);
}

/**
 * Whether an entity is still the one an edit wrote: its mark holds its own handle, and the hash
 * of what it holds is the mark's.
 */
export function markUnchanged(e: ReadEntity): boolean {
  const m = e.mark;

  return (
    m !== undefined &&
    e.handle !== undefined &&
    canonicalHandle(m.handle) === canonicalHandle(e.handle) &&
    m.hash === markHash(e)
  );
}
