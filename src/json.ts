// The `Drawing` format as JSON: one canonical string for a drawing, and the parser that turns
// JSON back into a drawing and refuses what it does not know.
import type {
  Arc,
  AttributeDefinition,
  Block,
  Circle,
  Drawing,
  Entity,
  Insert,
  Layer,
  Line,
  Linetype,
  Polyline,
  Text,
  TextStyle,
} from "./drawing.ts";
import { DrawingError, lint } from "./lint.ts";
import { formatProblem, shown } from "./rules.ts";

/**
 * Writes the drawing as canonical JSON: no white space, the keys of every object in code-unit
 * order, and each number in the shortest form that reads back as the same number, with `-0`
 * for negative zero. Two drawings that are equal give the same string, whatever order their
 * keys were set in. A field that is `undefined` is left out.
 *
 * The drawing is written as it is and is not checked: `fromJSON` checks it when it is read.
 * Throws when the drawing holds a value JSON cannot, such as `NaN`.
 */
export function toJSON(drawing: Drawing): string {
  let out = "";
  const write = (value: unknown): void => {
    switch (typeof value) {
      case "number":
        if (!Number.isFinite(value)) break;
        out += Object.is(value, -0) ? "-0" : value;
        return;
      case "string":
        out += JSON.stringify(value);
        return;
      case "boolean":
        out += value;
        return;
      case "object": {
        if (value === null) {
          out += "null";
          return;
        }
        if (Array.isArray(value)) {
          out += "[";
          for (let i = 0; i < value.length; i++) {
            if (i > 0) out += ",";
            write(value[i]);
          }
          out += "]";
          return;
        }
        const fields = value as Record<string, unknown>;
        let first = true;
        for (const key of Object.keys(fields).sort()) {
          if (fields[key] === undefined) continue;
          out += `${first ? "{" : ","}${JSON.stringify(key)}:`;
          first = false;
          write(fields[key]);
        }
        out += first ? "{}" : "}";
        return;
      }
    }
    const shown = typeof value === "number" ? String(value) : typeof value;
    throw new Error(`A drawing with a value of ${shown} cannot be written as JSON`);
  };
  write(drawing);
  return out;
}

/**
 * Reads a drawing from JSON, as a string or as the value `JSON.parse` gives, which is returned
 * as the drawing when it passes.
 *
 * It refuses a format version it does not know, a field or an entity kind it does not know, a
 * missing field and a value of the wrong type, and then every error `lint` finds, so a drawing
 * that was read has passed each check the builder makes. It throws a `DrawingError` whose
 * diagnostics name each problem, with the rule `"format"` for the ones `lint` does not look for.
 */
export function fromJSON(json: unknown): Drawing {
  let value = json;
  if (typeof json === "string") {
    try {
      value = JSON.parse(json);
    } catch (thrown) {
      refuse([`The JSON cannot be parsed: ${(thrown as Error).message}`]);
    }
  }
  if (!isRecord(value)) refuse([`The drawing ${PLAIN_OBJECT}`]);
  // The fields of another format version cannot be judged, so its version is all that is said.
  const format = formatProblem(Object.hasOwn(value, "format") ? value.format : undefined);
  if (format) refuse([format]);
  const problems: string[] = [];
  drawing(value, "", problems);
  if (problems.length > 0) refuse(problems);
  const errors = lint(value as unknown as Drawing).filter((d) => d.severity === "error");
  if (errors.length > 0) throw new DrawingError(errors);
  return value as unknown as Drawing;
}

function refuse(problems: readonly string[]): never {
  throw new DrawingError(
    problems.map((message) => ({ rule: "format", severity: "error", message })),
  );
}

/** Adds what is wrong with `value`, which is at the path `at` in the drawing, to `problems`. */
type Check = (value: unknown, at: string, problems: string[]) => void;

type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T];
type Checks<T, K extends keyof T> = { readonly [F in K]-?: Check };

const PLAIN_OBJECT = "must be a plain object, with no getter, setter or hidden field";

/**
 * True for a plain object whose fields are all its own data: no class or other object behind it
 * to inherit a field from, no symbol or hidden key, which `toJSON` would not write, and no
 * getter or setter, which could give another value each time it is read. No field is read.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !field?.enumerable || !("value" in field)) return false;
  }
  return true;
}

/**
 * What is wrong with `value` as an array of plain data, or undefined: it must be an array with
 * the methods of `Array`, each index its own plain value, and no key but its indexes. Stopping
 * at the first empty slot keeps an array that is all slots, such as `new Array(1e9)`, cheap to
 * refuse. No item is read.
 */
function arrayProblem(value: unknown, at: string): string | undefined {
  if (!Array.isArray(value) || !(value instanceof Array)) return `${at} must be an array`;
  for (let i = 0; i < value.length; i++) {
    const item = Object.getOwnPropertyDescriptor(value, i);
    if (!item) return `${at} has no item at index ${i}. An array cannot have empty slots`;
    if (!("value" in item)) return `${at}[${i}] must be a plain value, not a getter or setter`;
  }
  // Its indexes and `length` are all the keys a plain array has.
  return Reflect.ownKeys(value).length === value.length + 1
    ? undefined
    : `${at} must have no key but its indexes`;
}

function isNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

const string: Check = (value, at, problems) => {
  if (typeof value !== "string") problems.push(`${at} must be a string`);
};

const number: Check = (value, at, problems) => {
  if (!isNumber(value)) problems.push(`${at} must be a number`);
};

const boolean: Check = (value, at, problems) => {
  if (typeof value !== "boolean") problems.push(`${at} must be true or false`);
};

const numberOrName: Check = (value, at, problems) => {
  if (typeof value !== "string") number(value, at, problems);
};

const point: Check = (value, at, problems) => {
  const pair = value as readonly unknown[];
  if (arrayProblem(value, at) || pair.length !== 2 || !isNumber(pair[0]) || !isNumber(pair[1])) {
    problems.push(`${at} must be a point, [x, y]`);
  }
};

const scale: Check = (value, at, problems) => {
  const pair = value as readonly unknown[];
  if (arrayProblem(value, at) || pair.length !== 2 || !isNumber(pair[0]) || !isNumber(pair[1])) {
    problems.push(`${at} must be a scale along each axis, [x, y]`);
  }
};

const oneOf =
  (...values: readonly string[]): Check =>
  (value, at, problems) => {
    if (!values.includes(value as string)) {
      problems.push(`${at} must be ${values.map(shown).join(" or ")}`);
    }
  };

const list =
  (item: Check): Check =>
  (value, at, problems) => {
    const problem = arrayProblem(value, at);
    if (problem) problems.push(problem);
    else (value as readonly unknown[]).forEach((v, i) => item(v, `${at}[${i}]`, problems));
  };

/** Adds what is wrong with the fields of a plain object, which is at the path `at`. */
type FieldsCheck = (value: Record<string, unknown>, at: string, problems: string[]) => void;

/**
 * The fields of an object with exactly the fields of `T`. The two tables must name every field
 * of `T`, so a field added to a type is a compile error here until the parser knows it.
 */
function fields<T>(
  required: Checks<T, Exclude<keyof T, OptionalKeys<T>>>,
  optional: Checks<T, OptionalKeys<T>>,
): FieldsCheck {
  const needed: Readonly<Record<string, Check>> = required;
  const known: Readonly<Record<string, Check>> = { ...required, ...optional };
  return (value, at, problems) => {
    const label = at || "The drawing";
    for (const key of Object.keys(needed)) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) {
        problems.push(`${label}: the field "${key}" is missing`);
      }
    }
    for (const [key, field] of Object.entries(value)) {
      if (!Object.hasOwn(known, key)) {
        problems.push(`${label}: unknown field ${JSON.stringify(key)}`);
      } else if (field !== undefined) {
        known[key]!(field, at ? `${at}.${key}` : key, problems);
      }
    }
  };
}

/** A plain object with the fields `check` knows. */
const record =
  (check: FieldsCheck): Check =>
  (value, at, problems) => {
    if (isRecord(value)) check(value, at, problems);
    else problems.push(`${at} ${PLAIN_OBJECT}`);
  };

/** A plain object whose every field passes `item`, whatever its keys. */
const map =
  (item: Check): Check =>
  (value, at, problems) => {
    if (!isRecord(value)) problems.push(`${at} ${PLAIN_OBJECT}`);
    else {
      for (const [key, field] of Object.entries(value)) {
        item(field, `${at}[${JSON.stringify(key)}]`, problems);
      }
    }
  };

const shared = { id: string, linetype: string, lineweight: numberOrName } as const;
const kind: Check = () => {};

const ENTITIES = {
  line: fields<Line>({ kind, layer: string, from: point, to: point }, shared),
  polyline: fields<Polyline>({ kind, layer: string, points: list(point), closed: boolean }, shared),
  circle: fields<Circle>({ kind, layer: string, center: point, radius: number }, shared),
  arc: fields<Arc>(
    { kind, layer: string, center: point, radius: number, startAngle: number, endAngle: number },
    shared,
  ),
  text: fields<Text>(
    { kind, layer: string, at: point, height: number, value: string, rotation: number },
    { ...shared, style: string, align: string, valign: string },
  ),
  insert: fields<Insert>(
    { kind, layer: string, block: string, at: point },
    { id: string, scale, rotation: number, attributes: map(string) },
  ),
} satisfies Record<Entity["kind"], FieldsCheck>;

const entity: Check = (value, at, problems) => {
  if (!isRecord(value)) {
    problems.push(`${at} ${PLAIN_OBJECT}`);
    return;
  }
  const named: unknown = Object.hasOwn(value, "kind") ? value.kind : undefined;
  if (typeof named === "string" && Object.hasOwn(ENTITIES, named)) {
    ENTITIES[named as Entity["kind"]](value, at, problems);
  } else {
    problems.push(`${at}: unknown entity kind ${shown(named)}`);
  }
};

const drawing = fields<Drawing>(
  {
    format: () => {},
    units: string,
    dxf: oneOf("R12", "R2018"),
    layers: list(
      record(
        fields<Layer>(
          { name: string, color: number },
          {
            linetype: string,
            lineweight: numberOrName,
            off: boolean,
            frozen: boolean,
            locked: boolean,
            plot: boolean,
          },
        ),
      ),
    ),
    entities: list(entity),
  },
  {
    linetypes: list(
      record(fields<Linetype>({ name: string, description: string, pattern: list(number) }, {})),
    ),
    linetypeScale: number,
    textStyles: list(
      record(
        fields<TextStyle>(
          { name: string, font: string },
          { widthFactor: number, obliqueAngle: number },
        ),
      ),
    ),
    blocks: list(
      record(
        fields<Block>(
          { name: string, entities: list(entity) },
          {
            base: point,
            attributes: list(
              record(
                fields<AttributeDefinition>(
                  {
                    tag: string,
                    value: string,
                    layer: string,
                    at: point,
                    height: number,
                    rotation: number,
                  },
                  { prompt: string, style: string, align: string, valign: string },
                ),
              ),
            ),
          },
        ),
      ),
    ),
  },
);
