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
  | { readonly oneOf: readonly string[] };

/** Each field and its type. A field whose name ends in `?` may be left out. */
type Fields = Readonly<Record<string, Type>>;

const counts: Type = { map: "count" };
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

const BASE = { "handle?": "string", layer: "string" } as const;

const INSERT: Fields = {
  ...BASE,
  kind: { oneOf: ["insert"] },
  block: "string",
  at: "point",
  scale: "point",
  rotation: "number",
  tags: { map: "boolean" },
};

const ENTITY: Readonly<Record<string, Fields>> = {
  line: { ...BASE, kind: { oneOf: ["line"] }, from: "point", to: "point" },
  polyline: {
    ...BASE,
    kind: { oneOf: ["polyline"] },
    points: { list: "point" },
    closed: "boolean",
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
  text: {
    ...BASE,
    kind: { oneOf: ["text"] },
    at: "point",
    height: "number",
    value: "string",
    rotation: "number",
    style: "string",
  },
  insert: INSERT,
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
              "handle?": "string",
              tag: "string",
              "prompt?": "string",
              "default?": "string",
              at: "point",
              "height?": "number",
              style: "string",
              layer: "string",
              invisible: "boolean",
              constant: "boolean",
            },
          },
        },
        entities: { list: "entity" },
        other: counts,
      },
    },
  },
  xrefs: {
    list: { fields: { "handle?": "string", name: "string", path: "string", overlay: "boolean" } },
  },
  model: { fields: { census: { fields: CENSUS } } },
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
        census: { fields: CENSUS },
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
