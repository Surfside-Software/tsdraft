// `checkDrawingRead`: whether a value is a `DrawingRead` as plain data. A reader is code of its
// own, so what it answers is checked before anything reads it.
import { isRecord } from "../shape.ts";
import { shown } from "../rules.ts";
import { READ_FORMAT } from "./model.ts";

/** A field's type: a name below, an object's fields, a list of one type, or a map of one. */
type Type =
  | "string"
  | "number"
  | "boolean"
  | "point"
  | "count"
  | "entity"
  | { readonly fields: Fields }
  | { readonly list: Type }
  | { readonly map: Type }
  | { readonly oneOf: readonly string[] }
  /** The fields of one of these, named in a message as `named`. */
  | { readonly either: readonly Fields[]; readonly named: string };

/** Each field and its type. A field whose name ends in `?` may be left out. */
type Fields = Readonly<Record<string, Type>>;

const counts: Type = { map: "count" };

/** What a linetype's mark of either kind holds. */
const MARK: Fields = {
  after: "number",
  "rotation?": "number",
  "orient?": { oneOf: ["absolute", "upright"] },
  "offset?": "point",
};
const strings: Type = { list: "string" };

const LAYER_CENSUS: Fields = {
  kinds: counts,
  ownColor: "count",
  ownLinetype: "count",
  ownLineweight: "count",
  lineweights: counts,
};

const CENSUS: Fields = {
  layers: { map: { fields: LAYER_CENSUS } },
  texts: {
    list: {
      fields: {
        "handle?": "string",
        kind: { oneOf: ["TEXT", "MTEXT"] },
        layer: "string",
        style: "string",
        at: "point",
        height: "number",
        "inlineHeights?": { list: "number" },
      },
    },
  },
  dimensions: {
    list: {
      fields: {
        "handle?": "string",
        layer: "string",
        style: "string",
        at: "point",
        overrides: "boolean",
      },
    },
  },
  inserts: {
    list: {
      fields: {
        "handle?": "string",
        layer: "string",
        block: "string",
        at: "point",
        scale: "point",
      },
    },
  },
  counts: { fields: { texts: "count", dimensions: "count", inserts: "count" } },
  capped: "boolean",
};

const BASE = {
  "handle?": "string",
  layer: "string",
  "color?": "number",
  "trueColor?": "number",
  "colorBook?": { fields: { book: "string", name: "string" } },
  "linetype?": "string",
  "lineweight?": "number",
  "linetypeScale?": "number",
} as const;

const PLACEMENT: Fields = {
  at: "point",
  startFrom: { oneOf: ["file", "widths", "alignment"] },
  stored: "point",
  "alignAt?": "point",
  height: "number",
  rotation: "number",
  style: "string",
  "align?": { oneOf: ["center", "right", "aligned", "middle", "fit"] },
  "valign?": { oneOf: ["bottom", "middle", "top"] },
  "widthFactor?": "number",
  "oblique?": "number",
  "backward?": "boolean",
  "upsideDown?": "boolean",
};

const ATTRIBUTE_PARAGRAPH: Type = {
  fields: {
    at: "point",
    height: "number",
    width: "number",
    attachment: "number",
    rotation: "number",
    style: "string",
    lineSpacing: "number",
    lineSpacingStyle: { oneOf: ["at-least", "exactly"] },
    "mirrored?": "boolean",
  },
};

const ATTRIBUTE: Fields = {
  ...BASE,
  ...PLACEMENT,
  tag: "string",
  value: "string",
  "invisible?": "boolean",
  "paragraph?": ATTRIBUTE_PARAGRAPH,
};

const INSERT: Fields = {
  ...BASE,
  kind: { oneOf: ["insert"] },
  block: "string",
  "blockHandle?": "string",
  at: "point",
  scale: "point",
  rotation: "number",
  tags: { map: "boolean" },
  "attributes?": { list: { fields: ATTRIBUTE } },
};

const ENTITY: Readonly<Record<string, Fields>> = {
  line: { ...BASE, kind: { oneOf: ["line"] }, from: "point", to: "point" },
  polyline: {
    ...BASE,
    kind: { oneOf: ["polyline"] },
    points: { list: "point" },
    closed: "boolean",
    "bulges?": { list: "number" },
    "width?": "number",
    "widths?": { list: "point" },
    "linetypeGeneration?": "boolean",
  },
  circle: { ...BASE, kind: { oneOf: ["circle"] }, center: "point", radius: "number" },
  arc: {
    ...BASE,
    kind: { oneOf: ["arc"] },
    center: "point",
    radius: "number",
    start: "number",
    end: "number",
  },
  ellipse: {
    ...BASE,
    kind: { oneOf: ["ellipse"] },
    center: "point",
    majorAxis: "point",
    ratio: "number",
    "startParameter?": "number",
    "endParameter?": "number",
  },
  spline: {
    ...BASE,
    kind: { oneOf: ["spline"] },
    degree: "count",
    knots: { list: "number" },
    controlPoints: { list: "point" },
    "weights?": { list: "number" },
    closed: "boolean",
    "periodic?": "boolean",
    "fitPoints?": { list: "point" },
    "startTangent?": "point",
    "endTangent?": "point",
    "fitTolerance?": "number",
    "knotSpacing?": { oneOf: ["chord", "square-root", "uniform"] },
  },
  text: { ...BASE, ...PLACEMENT, kind: { oneOf: ["text"] }, value: "string" },
  insert: INSERT,
  mtext: {
    ...BASE,
    kind: { oneOf: ["mtext"] },
    at: "point",
    height: "number",
    width: "number",
    attachment: "number",
    rotation: "number",
    style: "string",
    value: "string",
    lineSpacing: "number",
    lineSpacingStyle: { oneOf: ["at-least", "exactly"] },
    "columns?": {
      either: [
        { height: "number", "count?": "count", "gutter?": "number" },
        { heights: { list: "number" }, "gutter?": "number" },
      ],
      named: "{ height, count?, gutter? } or { heights, gutter? }",
    },
    "mask?": {
      fields: { "color?": "number", "trueColor?": "number", offsetFactor: "number" },
    },
  },
  dimension: {
    ...BASE,
    kind: { oneOf: ["dimension"] },
    type: { oneOf: ["linear", "aligned"] },
    from: "point",
    to: "point",
    line: "point",
    "angle?": "number",
    textAt: "point",
    "measurement?": "number",
    "text?": "string",
    "textBelow?": "string",
    style: "string",
    "block?": "string",
    "blockHandle?": "string",
  },
  "radial-dimension": {
    ...BASE,
    kind: { oneOf: ["radial-dimension"] },
    type: { oneOf: ["radius", "diameter", "jogged-radius"] },
    center: "point",
    point: "point",
    "start?": "point",
    "jog?": "point",
    textAt: "point",
    "placed?": "boolean",
    "measurement?": "number",
    "text?": "string",
    "textBelow?": "string",
    style: "string",
    "block?": "string",
    "blockHandle?": "string",
  },
  "arc-length-dimension": {
    ...BASE,
    kind: { oneOf: ["arc-length-dimension"] },
    center: "point",
    radius: "number",
    startAngle: "number",
    endAngle: "number",
    at: "point",
    textAt: "point",
    "placed?": "boolean",
    "partial?": "boolean",
    "measurement?": "number",
    "text?": "string",
    "textBelow?": "string",
    style: "string",
    "block?": "string",
    "blockHandle?": "string",
  },
  "ordinate-dimension": {
    ...BASE,
    kind: { oneOf: ["ordinate-dimension"] },
    axis: { oneOf: ["x", "y"] },
    origin: "point",
    feature: "point",
    leaderEnd: "point",
    textAt: "point",
    "placed?": "boolean",
    "measurement?": "number",
    "text?": "string",
    "textBelow?": "string",
    style: "string",
    "block?": "string",
    "blockHandle?": "string",
  },
  "angular-dimension": {
    ...BASE,
    kind: { oneOf: ["angular-dimension"] },
    type: { oneOf: ["three-point", "two-line"] },
    "vertex?": "point",
    "from?": "point",
    "to?": "point",
    "first?": { list: "point" },
    "second?": { list: "point" },
    at: "point",
    textAt: "point",
    "placed?": "boolean",
    "measurement?": "number",
    "text?": "string",
    "textBelow?": "string",
    style: "string",
    "block?": "string",
    "blockHandle?": "string",
  },
  multileader: {
    ...BASE,
    kind: { oneOf: ["multileader"] },
    "style?": "string",
    shafts: { list: { list: "point" } },
    at: "point",
    direction: "point",
    landing: "number",
    roots: {
      list: {
        fields: {
          at: "point",
          direction: "point",
          landing: "number",
          shafts: { list: { list: "point" } },
        },
      },
    },
    shaft: { oneOf: ["straight", "curved", "none"] },
    text: "string",
    textAt: "point",
    textAttachment: "number",
    width: "number",
    textHeight: "number",
    textStyle: "string",
    arrowSize: "number",
    attachments: { fields: { left: "number", right: "number", top: "number", bottom: "number" } },
    "vertical?": "boolean",
    "frame?": "boolean",
    "mask?": { fields: { offsetFactor: "number", "color?": "number" } },
    "block?": {
      fields: {
        name: "string",
        at: "point",
        scale: "number",
        rotation: "number",
        "attributes?": { map: "string" },
      },
    },
  },
  leader: {
    ...BASE,
    kind: { oneOf: ["leader"] },
    style: "string",
    points: { list: "point" },
    shaft: { oneOf: ["straight", "curved"] },
    arrowhead: "boolean",
    "note?": "string",
  },
  solid: { ...BASE, kind: { oneOf: ["solid"] }, points: { list: "point" } },
  image: {
    ...BASE,
    kind: { oneOf: ["image"] },
    path: "string",
    "definition?": "string",
    pixels: "point",
    at: "point",
    u: "point",
    v: "point",
    "clip?": { list: "point" },
    "invertClip?": "boolean",
    "transparent?": "boolean",
    "hidden?": "boolean",
    "unclipped?": "boolean",
    "brightness?": "number",
    "contrast?": "number",
    "fade?": "number",
  },
  hatch: {
    ...BASE,
    kind: { oneOf: ["hatch"] },
    pattern: "string",
    solid: "boolean",
    style: { oneOf: ["normal", "outer", "ignore"] },
    "associative?": "boolean",
    loops: {
      list: {
        fields: { points: { list: "point" }, "bulges?": { list: "number" }, flags: "number" },
      },
    },
    "patternType?": "number",
    "patternAngle?": "number",
    "patternScale?": "number",
    "crossed?": "boolean",
    "patternLines?": {
      list: {
        fields: { angle: "number", base: "point", offset: "point", "dashes?": { list: "number" } },
      },
    },
    "gradient?": {
      fields: {
        name: "string",
        angle: "number",
        centered: "boolean",
        colors: { list: "number" },
        "tint?": "number",
      },
    },
  },
  wipeout: { ...BASE, kind: { oneOf: ["wipeout"] }, points: { list: "point" } },
  table: {
    ...BASE,
    kind: { oneOf: ["table"] },
    "style?": "string",
    at: "point",
    direction: "point",
    rows: { list: "number" },
    columns: { list: "number" },
    title: "boolean",
    header: "boolean",
    cells: {
      list: {
        fields: {
          row: "count",
          column: "count",
          rowSpan: "count",
          columnSpan: "count",
          "text?": "string",
          "block?": "string",
          "blockScale?": "number",
          "alignment?": "number",
          "textHeight?": "number",
          "color?": "number",
          "fill?": "number",
        },
      },
    },
    "block?": "string",
    "blockHandle?": "string",
  },
};

const TABLE_CELL_STYLE: Type = {
  fields: {
    textStyle: "string",
    textHeight: "number",
    alignment: "number",
    color: "number",
    "fill?": "number",
    lineweight: "number",
  },
};

const SPACE: Fields = {
  census: { fields: CENSUS },
  "entities?": { list: "entity" },
  "other?": counts,
  "drawOrder?": strings,
};

const DRAWING_READ: Fields = {
  format: "number",
  sha256: "string",
  bytes: "count",
  "version?": "string",
  "codepage?": "string",
  encoding: "string",
  header: {
    fields: {
      "insunits?": "number",
      "measurement?": "number",
      "ltscale?": "number",
      "psltscale?": "number",
      "msltscale?": "number",
      "dimscale?": "number",
      "dimstyle?": "string",
      "textstyle?": "string",
      "wipeoutFrame?": "number",
    },
  },
  layers: {
    list: {
      fields: {
        "handle?": "string",
        name: "string",
        "color?": "number",
        "trueColor?": "number",
        "linetype?": "string",
        "lineweight?": "number",
        on: "boolean",
        frozen: "boolean",
        locked: "boolean",
        plot: "boolean",
        xref: "boolean",
      },
    },
  },
  linetypes: {
    list: {
      fields: {
        "handle?": "string",
        name: "string",
        "description?": "string",
        pattern: { list: "number" },
        complex: "boolean",
        "marks?": {
          list: {
            either: [
              { ...MARK, text: "string", style: "string", height: "number" },
              { ...MARK, shape: "number", file: "string", scale: "number" },
            ],
            named: "a linetype's mark",
          },
        },
      },
    },
  },
  textStyles: {
    list: {
      fields: {
        "handle?": "string",
        name: "string",
        "font?": "string",
        "bigFont?": "string",
        "family?": "string",
        "height?": "number",
        "widthFactor?": "number",
        "oblique?": "number",
        annotative: "boolean",
        shapes: "boolean",
      },
    },
  },
  dimensionStyles: {
    list: {
      fields: {
        "handle?": "string",
        name: "string",
        annotative: "boolean",
        "scale?": "number",
        "textHeight?": "number",
        "arrowSize?": "number",
        "textStyle?": "string",
        "lengthUnits?": "number",
        "precision?": "number",
        "lengthFactor?": "number",
        "suffix?": "string",
        "textVertical?": "number",
        "textInside?": "number",
        "textMove?": "number",
        "fraction?": "number",
        "fractionScale?": "number",
        "dimensionLineweight?": "number",
        "extensionLineweight?": "number",
        "arrowheadBlock?": "string",
        "textFill?": "number",
        "textFillColor?": "number",
      },
    },
  },
  tableStyles: {
    list: {
      fields: {
        "handle?": "string",
        name: "string",
        horizontalMargin: "number",
        verticalMargin: "number",
        title: TABLE_CELL_STYLE,
        header: TABLE_CELL_STYLE,
        data: TABLE_CELL_STYLE,
      },
    },
  },
  blocks: {
    list: {
      fields: {
        "handle?": "string",
        name: "string",
        base: "point",
        anonymous: "boolean",
        attributeDefinitions: {
          list: {
            fields: {
              ...PLACEMENT,
              "handle?": "string",
              tag: "string",
              "prompt?": "string",
              "default?": "string",
              layer: "string",
              invisible: "boolean",
              constant: "boolean",
              "paragraph?": ATTRIBUTE_PARAGRAPH,
            },
          },
        },
        entities: { list: "entity" },
        "drawOrder?": strings,
        other: counts,
      },
    },
  },
  xrefs: {
    list: { fields: { "handle?": "string", name: "string", path: "string", overlay: "boolean" } },
  },
  images: {
    list: {
      fields: {
        "handle?": "string",
        name: "string",
        path: "string",
        pixels: "point",
        loaded: "boolean",
        images: "count",
      },
    },
  },
  model: { fields: SPACE },
  layouts: {
    list: {
      fields: {
        "handle?": "string",
        name: "string",
        tab: "number",
        "media?": "string",
        "plotter?": "string",
        "paperSize?": "point",
        "paperUnits?": "number",
        "plotStyleTable?": "string",
        plotRotation: "number",
        viewports: {
          list: {
            fields: {
              "handle?": "string",
              layer: "string",
              center: "point",
              width: "number",
              height: "number",
              viewCenter: "point",
              viewHeight: "number",
              ratio: "number",
              twist: "number",
              on: "boolean",
              frozenLayers: strings,
              turnedView: "boolean",
            },
          },
        },
        inserts: { list: { fields: INSERT } },
        ...SPACE,
      },
    },
  },
  fields: {
    list: {
      fields: {
        "handle?": "string",
        code: "string",
        text: {
          fields: {
            "handle?": "string",
            at: "point",
            height: "number",
            width: "number",
            layer: "string",
            "layout?": "string",
            "block?": "string",
          },
        },
      },
    },
  },
  otherFields: counts,
  unread: { fields: { entities: counts, objects: counts, malformed: counts } },
  "opensAt?": {
    fields: { "layout?": "string", center: "point", height: "number", width: "number" },
  },
};

/**
 * True for a list whose own keys are its items and `length` alone: no other field, getter or
 * hidden key, such as a `toJSON` that would run when it is written. A hole is found item by item.
 */
function onlyItems(v: unknown[]): boolean {
  const keys = Reflect.ownKeys(v);
  return (
    keys.length <= v.length + 1 &&
    keys.every((k) => k === "length" || /^(0|[1-9]\d*)$/.test(String(k)))
  );
}

/**
 * The items of a plain list whose every slot holds a value, read without running a getter, or
 * `undefined` for anything else.
 */
function plainList(v: unknown): unknown[] | undefined {
  if (
    !Array.isArray(v) ||
    Object.getPrototypeOf(v) !== Array.prototype ||
    v.length > 2 ||
    !onlyItems(v)
  ) {
    return undefined;
  }
  const items: unknown[] = [];
  for (let i = 0; i < v.length; i++) {
    const slot = Object.getOwnPropertyDescriptor(v, i);
    if (!slot || !("value" in slot)) return undefined;
    items.push(slot.value);
  }
  return items;
}

/** The most problems `checkDrawingRead` reports. */
const MAX_PROBLEMS = 20;

/**
 * What is wrong with `value` as a `DrawingRead`: each problem with the path of the field it is
 * about. Empty when it is one. It reads the value once, never throws, and stops after 20
 * problems.
 */
export function checkDrawingRead(value: unknown): string[] {
  const problems: string[] = [];
  const say = (at: string, problem: string): void => {
    if (problems.length < MAX_PROBLEMS) problems.push(`${at || "the read"} ${problem}`);
  };

  const check = (v: unknown, type: Type, at: string): void => {
    if (problems.length >= MAX_PROBLEMS) return;
    if (type === "entity") {
      const kind = isRecord(v) ? v.kind : undefined;
      const fields = typeof kind === "string" ? ENTITY[kind] : undefined;
      if (!fields) say(at, `has kind ${shown(kind)}, which is not an entity's kind`);
      else checkFields(v, fields, at);
      return;
    }
    switch (type) {
      case "string":
        if (typeof v !== "string") say(at, "must be a string");
        return;
      case "boolean":
        if (typeof v !== "boolean") say(at, "must be true or false");
        return;
      case "number":
        if (typeof v !== "number" || !Number.isFinite(v)) say(at, "must be a finite number");
        return;
      case "count":
        if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
          say(at, "must be a whole number, 0 or more");
        }
        return;
      case "point": {
        const xy = plainList(v);
        if (
          xy === undefined ||
          xy.length !== 2 ||
          !xy.every((n) => typeof n === "number" && Number.isFinite(n))
        ) {
          say(at, "must be two finite numbers");
        }
        return;
      }
    }
    if ("oneOf" in type) {
      if (typeof v !== "string" || !type.oneOf.includes(v)) {
        say(at, `must be ${type.oneOf.map(shown).join(" or ")}`);
      }
    } else if ("list" in type) {
      if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype || !onlyItems(v)) {
        say(at, "must be a plain list, with no field but its items");
        return;
      }
      for (let i = 0; i < v.length && problems.length < MAX_PROBLEMS; i++) {
        const slot = Object.getOwnPropertyDescriptor(v, i);
        if (!slot || !("value" in slot)) say(`${at}[${i}]`, "is an empty slot or a getter");
        else check(slot.value, type.list, `${at}[${i}]`);
      }
    } else if ("map" in type) {
      if (!isRecord(v)) {
        say(at, "must be a plain object");
        return;
      }
      for (const key of Object.keys(v)) {
        if (problems.length >= MAX_PROBLEMS) return;
        check(v[key], type.map, `${at}[${JSON.stringify(key).slice(0, 80)}]`);
      }
    } else if ("either" in type) {
      // The first of them it holds to, with what that one finds wrong taken back from the others.
      const before = problems.length;
      for (const fields of type.either) {
        checkFields(v, fields, at);
        if (problems.length === before) return;
        problems.length = before;
      }
      say(at, `must be ${type.named}`);
    } else checkFields(v, type.fields, at);
  };

  const checkFields = (v: unknown, fields: Fields, at: string): void => {
    if (!isRecord(v)) {
      say(at, "must be a plain object");
      return;
    }
    const known = new Set<string>();
    for (const [key, type] of Object.entries(fields)) {
      const optional = key.endsWith("?");
      const field = optional ? key.slice(0, -1) : key;
      known.add(field);
      const path = at ? `${at}.${field}` : field;
      if (!Object.hasOwn(v, field) || v[field] === undefined) {
        if (!optional) say(path, "is missing");
        continue;
      }
      check(v[field], type, path);
    }
    for (const key of Object.keys(v)) {
      if (!known.has(key))
        say(`${at ? `${at}.` : ""}${JSON.stringify(key).slice(0, 80)}`, "is not a field");
    }
  };

  checkFields(value, DRAWING_READ, "");
  if (problems.length === 0) {
    const read = value as { format: number; sha256: string };
    if (read.format !== READ_FORMAT) {
      say(
        "format",
        `is ${shown(read.format)}, and this version of tsdraft reads format ${READ_FORMAT}`,
      );
    }
    if (!/^[0-9a-f]{64}$/.test(read.sha256))
      say("sha256", "must be 64 lower-case hexadecimal digits");
  }
  return problems;
}
