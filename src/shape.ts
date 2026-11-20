// The shape of a `Drawing` as plain data: the fields of each object and the type of each field.
// `fromJSON` checks all of it. `lint` checks what its rules need to read a drawing, and leaves a
// field to the rule that reports it.
import type {
  AlignedDimension,
  Arc,
  AttributeDefinition,
  Block,
  Circle,
  DimensionStyle,
  Drawing,
  Entity,
  Image,
  Insert,
  Layer,
  Layout,
  Leader,
  LeaderStyle,
  Line,
  LinearDimension,
  RadiusDimension,
  DiameterDimension,
  JoggedRadiusDimension,
  AngularDimension,
  Linetype,
  Paragraph,
  Polyline,
  Text,
  TextStyle,
  Viewport,
  Xref,
} from "./drawing.ts";
import { shown, XREF_REFUSED_FIELDS, xrefFieldProblem } from "./rules.ts";

/**
 * Adds what is wrong with `value`, which is at the path `at` in the drawing, to `problems`. A
 * field nobody knows goes to `extra` when one is given, since `lint` still reads an object
 * that has one.
 */
export type Check = (value: unknown, at: string, problems: string[], extra?: string[]) => void;

/** Adds what is wrong with the fields of a plain object, which is at the path `at`. */
type FieldsCheck = (
  value: Record<string, unknown>,
  at: string,
  problems: string[],
  extra?: string[],
) => void;

type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T];
type Checks<T, K extends keyof T> = { readonly [F in K]-?: Check };

export const PLAIN_OBJECT = "must be a plain object, with no getter, setter or hidden field";

const KINDS = [
  "line",
  "polyline",
  "circle",
  "arc",
  "text",
  "paragraph",
  "insert",
  "linear-dimension",
  "aligned-dimension",
  "leader",
  "image",
] as const satisfies readonly Entity["kind"][];

/** What is wrong with an entity whose kind tsdraft does not know. */
function unknownKindProblem(kind: unknown): string {
  return `unknown entity kind ${shown(kind)}. An entity's kind is ${KINDS.map(shown)
    .join(", ")
    .replace(/, ([^,]*)$/, " or $1")}`;
}

/**
 * True for a plain object whose fields are all its own data: no class or other object behind it
 * to inherit a field from, no symbol or hidden key, which `toJSON` would not write, and no
 * getter or setter, which could give another value each time it is read. No field is read.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !field?.enumerable || !("value" in field)) return false;
  }
  return true;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What is wrong with `value` as an array of plain data, or undefined: it must be an array with
 * the methods of `Array`, each index its own plain value, and no key but its indexes. Stopping
 * at the first empty slot keeps an array that is all slots, such as `new Array(1e9)`, cheap to
 * refuse. No item is read.
 */
function plainArrayProblem(value: unknown, at: string): string | undefined {
  if (!Array.isArray(value) || !(value instanceof Array)) return `${at} must be an array`;
  for (let i = 0; i < value.length; i++) {
    const item = Object.getOwnPropertyDescriptor(value, i);
    if (!item) return slotProblem(at, i);
    if (!("value" in item)) return `${at}[${i}] must be a plain value, not a getter or setter`;
  }
  // Its indexes and `length` are all the keys a plain array has.
  return Reflect.ownKeys(value).length === value.length + 1
    ? undefined
    : `${at} must have no key but its indexes`;
}

/** What is wrong with `value` as an array with the methods of `Array`, whatever it holds. */
export function arrayProblem(value: unknown, at: string): string | undefined {
  return Array.isArray(value) && value instanceof Array ? undefined : `${at} must be an array`;
}

/**
 * The longest string V8 hashes by its characters. It hashes a longer one by its length alone, so
 * a `Map` keyed by many long strings of one length compares each it looks up with all the others.
 */
export const KEYED = 16_383;

/**
 * Values by strings, which stays fast for strings longer than `KEYED`. It keys each of those by
 * its length and 80 of its characters from its start, its middle and its end, and keeps one
 * string for each such key, which a string looked up is compared with. So a long string it does
 * not keep is one it never held, or one that took the place of another that agrees with it at
 * those characters, which `clashes` says, and a walk pays for reading such a one again.
 */
export class Strings<T> {
  readonly #short = new Map<string, T>();
  readonly #long = new Map<string, readonly [string, T]>();

  get(key: string): T | undefined {
    if (key.length <= KEYED) return this.#short.get(key);
    const kept = this.#long.get(sampled(key));
    return kept !== undefined && kept[0] === key ? kept[1] : undefined;
  }

  set(key: string, value: T): void {
    if (key.length <= KEYED) this.#short.set(key, value);
    else this.#long.set(sampled(key), [key, value]);
  }

  /** True for a string longer than `KEYED` whose place another string holds. */
  clashes(key: string): boolean {
    if (key.length <= KEYED) return false;
    const kept = this.#long.get(sampled(key));
    return kept !== undefined && kept[0] !== key;
  }
}

/** A short key for a long string: its length and 80 of its characters. */
function sampled(key: string): string {
  const middle = Math.floor(key.length / 2);
  return `${key.length}:${key.slice(0, 24)}${key.slice(middle - 16, middle + 16)}${key.slice(-24)}`;
}

/** What is wrong with the array at `at`, which has no item at `index`. */
export function slotProblem(at: string, index: number): string {
  return `${at} has no item at index ${index}. An array cannot have empty slots`;
}

/**
 * The items of a list up to its first empty slot, where `lint` stops it, or none when it is not
 * a list. A list with no empty slot is given itself, so `callOf` finds its calls.
 */
export function filled<T>(list: readonly T[] | undefined): readonly T[];
export function filled(list: unknown): readonly unknown[];
export function filled(list: unknown): readonly unknown[] {
  if (arrayProblem(list, "") !== undefined) return [];
  const items = list as readonly unknown[];
  for (let i = 0; i < items.length; i++) {
    if (items[i] === undefined && !(i in items)) return items.slice(0, i);
  }
  return items;
}

/**
 * How many letters must be changed, added, dropped or swapped with the next to make one word
 * of the other.
 */
function distance(a: string, b: string): number {
  let before: number[] = [];
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        next[j - 1]! + 1,
        row[j]! + 1,
        row[j - 1]! + Number(a[i - 1] !== b[j - 1]),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        next[j] = Math.min(next[j]!, before[j - 2]! + 1);
      }
    }
    before = row;
    row = next;
  }
  return row[b.length]!;
}

/** Every field some object of a drawing has, in lower case, filled as the tables are made. */
const EVERY_FIELD = new Set<string>();

/**
 * True when `short` shortens `long`: its letters are in `long` in their order, and the two
 * start with one letter or end alike, as `ltype` and `weight` do for `linetype` and
 * `lineweight`.
 */
function shortens(short: string, long: string): boolean {
  if (short.length < 4 || (short[0] !== long[0] && !long.endsWith(short))) return false;
  let at = 0;
  for (const letter of long) if (letter === short[at]) at++;
  return at === short.length;
}

/** The one item of `found`, or undefined when it has none or several. */
const only = (found: readonly string[]): string | undefined =>
  found.length === 1 ? found[0] : undefined;

/**
 * The one field of `known` that `key` is most likely meant for, or undefined. In order: the
 * field it is but for its capitals or a final `s`; none, when it is a field of another kind of
 * object, which is not a slip of the pen; the field one letter from it, or the field it
 * shortens, and none when those are two fields; the field two letters from it, when both have
 * more than four.
 */
function meant(key: string, known: readonly string[]): string | undefined {
  const typed = key.toLowerCase();
  const named = known.map((name): [string, string] => [name, name.toLowerCase()]);
  const same = named.find(
    ([, name]) => name === typed || name === `${typed}s` || `${name}s` === typed,
  );
  if (same) return same[0];
  if (EVERY_FIELD.has(typed)) return undefined;
  // Two words whose lengths differ by more than `letters` are further apart, which spares a long
  // key the comparison with each field.
  const away = (letters: number): string | undefined =>
    only(
      named
        .filter(
          ([, name]) =>
            Math.abs(typed.length - name.length) <= letters && distance(typed, name) === letters,
        )
        .map(([name]) => name),
    );
  const one = away(1);
  const short = only(named.filter(([, name]) => shortens(typed, name)).map(([name]) => name));
  if (one !== undefined && short !== undefined && one !== short) return undefined;
  if (one ?? short) return one ?? short;
  const two = away(2);
  return two !== undefined && Math.min(typed.length, two.length) > 4 ? two : undefined;
}

/** What is wrong with a field `key` that the object at `at` does not have. */
function unknownFieldProblem(at: string, key: string, known: readonly string[]): string {
  const name = meant(key, known);
  const hint = name === undefined ? "" : `. Did you mean ${shown(name)}?`;
  return `${at || "The drawing"}: unknown field ${JSON.stringify(key)}${hint}`;
}

/** True while `isSound` asks, when a path would be built for nothing. */
let asking = false;
const asked: string[] = [];
const unasked: string[] = [];

/**
 * True when `check` finds nothing wrong with `value`. A field nobody knows counts as wrong
 * unless `unknownFields` is false. It builds no path, so `lint` can ask it of every item of a
 * drawing.
 */
export function isSound(check: Check, value: unknown, unknownFields = true): boolean {
  asking = true;
  try {
    check(value, "", asked, unknownFields ? asked : unasked);
  } finally {
    asking = false;
  }
  if (unasked.length > 0) unasked.length = 0;
  if (asked.length === 0) return true;
  asked.length = 0;
  return false;
}

const inside = (at: string, key: string): string => (asking ? "" : at ? `${at}.${key}` : key);

/** A check that `ruled` left to a rule of `lint`. */
const LEFT: Check = () => {};

export interface Shapes {
  readonly drawing: FieldsCheck;
  readonly point: Check;
  readonly layer: Check;
  readonly linetype: Check;
  readonly textStyle: Check;
  readonly dimensionStyle: Check;
  readonly leaderStyle: Check;
  readonly block: Check;
  readonly attribute: Check;
  readonly xref: Check;
  readonly layout: Check;
  readonly viewport: Check;
  readonly entity: Check;
}

/** A paragraph's columns, every field of each kind at once, as their shape is checked. */
interface ColumnsShape {
  readonly height?: number;
  readonly heights?: readonly number[];
  readonly count?: number;
  readonly gutter?: number;
}

/**
 * The checks of each object in a drawing, with one message for a problem whichever is asked.
 *
 * With `all`, every field has its type, a number is finite, an object and an array are plain,
 * and a list is checked through to its last item. Without it, the checks are the ones `lint`
 * makes before its rules read an object: a list of objects is an array, whose items `lint`
 * checks as it comes to them, a number may be `NaN`, and a field under `ruled` is skipped,
 * because a rule reports it with a message of its own. With `typed`, a field under `ruled` is
 * checked all the same. Either way a field nobody knows is refused.
 */
function shapes(all: boolean, typed = all): Shapes {
  const object = all ? isRecord : isObject;
  const array = all ? plainArrayProblem : arrayProblem;
  const isNumber = all
    ? (value: unknown): boolean => typeof value === "number" && Number.isFinite(value)
    : (value: unknown): boolean => typeof value === "number";
  const ruled = (check: Check): Check => (typed ? check : LEFT);

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
  const pair =
    (what: string): Check =>
    (value, at, problems) => {
      const items = value as readonly unknown[];
      if (array(value, at) || items.length !== 2 || !isNumber(items[0]) || !isNumber(items[1])) {
        problems.push(`${at} must be ${what}`);
      }
    };
  const point = pair("a point, [x, y]");
  const scale = pair("a scale along each axis, [x, y]");
  const sideWidths = pair("the widths at a side's start and end, [start, end]");
  const oneOf =
    (...values: readonly string[]): Check =>
    (value, at, problems) => {
      if (!values.includes(value as string)) {
        problems.push(`${at} must be ${values.map(shown).join(" or ")}`);
      }
    };
  // `plainArrayProblem` has refused an empty slot already. Otherwise the first one ends the list.
  const list =
    (item: Check): Check =>
    (value, at, problems) => {
      const problem = array(value, at);
      if (problem) problems.push(problem);
      else {
        const items = value as readonly unknown[];
        for (let i = 0; i < items.length; i++) {
          if (items[i] === undefined && !(i in items)) {
            problems.push(slotProblem(at, i));
            break;
          }
          item(items[i], asking ? "" : `${at}[${i}]`, problems);
        }
      }
    };
  /** A list of objects. `lint` checks each as its rules come to it, so only that it is a list. */
  const table = (item: Check): Check =>
    all
      ? list(item)
      : (value, at, problems) => {
          const problem = array(value, at);
          if (problem) problems.push(problem);
        };

  /**
   * The fields of an object with exactly the fields of `T`. The two tables must name every
   * field of `T`, so a field added to a type is a compile error here until it has a check.
   */
  function fields<T>(
    required: Checks<T, Exclude<keyof T, OptionalKeys<T>>>,
    optional: Checks<T, OptionalKeys<T>>,
  ): FieldsCheck {
    const needed: Readonly<Record<string, Check>> = required;
    const known: Readonly<Record<string, Check>> = { ...required, ...optional };
    const names = Object.keys(known);
    for (const name of names) EVERY_FIELD.add(name.toLowerCase());
    const missing = (at: string, key: string) =>
      `${at || "The drawing"}: the field "${key}" is missing`;
    if (!all) {
      // One pass over the object's own keys finds a field nobody knows and checks the others.
      const checks: Record<string, Check> = Object.assign(Object.create(null), known);
      const musts = Object.keys(needed).filter((key) => needed[key] !== LEFT);
      const isMust: Record<string, true> = Object.create(null);
      for (const key of musts) isMust[key] = true;
      return (value, at, problems, extra = problems) => {
        let found = 0;
        for (const key in value) {
          const check = checks[key];
          // `isSound` reads no message, and the hint compares the key with every field's name.
          if (check === undefined) extra.push(asking ? "" : unknownFieldProblem(at, key, names));
          else if (check !== LEFT) {
            const field = value[key];
            if (field === undefined) continue;
            if (isMust[key]) found++;
            check(field, inside(at, key), problems);
          }
        }
        if (found === musts.length) return;
        for (const key of musts) if (value[key] === undefined) problems.push(missing(at, key));
      };
    }
    return (value, at, problems) => {
      for (const key of Object.keys(needed)) {
        if (!Object.hasOwn(value, key) || value[key] === undefined) {
          problems.push(missing(at, key));
        }
      }
      for (const [key, field] of Object.entries(value)) {
        if (!Object.hasOwn(known, key)) {
          problems.push(asking ? "" : unknownFieldProblem(at, key, names));
        } else if (field !== undefined) known[key]!(field, inside(at, key), problems);
      }
    };
  }

  /** An object with the fields `check` knows. */
  const record =
    (check: FieldsCheck): Check =>
    (value, at, problems, extra) => {
      if (object(value)) check(value, at, problems, extra);
      else problems.push(`${at} ${PLAIN_OBJECT}`);
    };

  /** An object whose every field passes `item`, whatever its keys. */
  const map =
    (item: Check): Check =>
    (value, at, problems) => {
      if (!object(value)) problems.push(`${at} ${PLAIN_OBJECT}`);
      else {
        for (const [key, field] of Object.entries(value)) {
          item(field, `${at}[${JSON.stringify(key)}]`, problems);
        }
      }
    };

  const kind: Check = LEFT;
  const shared = {
    id: ruled(string),
    linetype: ruled(string),
    lineweight: ruled(numberOrName),
  } as const;
  const justified = { style: ruled(string), align: ruled(string), valign: ruled(string) } as const;

  const ENTITIES = {
    line: fields<Line>({ kind, layer: string, from: point, to: point }, shared),
    polyline: fields<Polyline>(
      { kind, layer: string, points: list(point), closed: boolean },
      { ...shared, bulges: list(number), width: number, widths: list(sideWidths) },
    ),
    circle: fields<Circle>({ kind, layer: string, center: point, radius: number }, shared),
    arc: fields<Arc>(
      { kind, layer: string, center: point, radius: number, startAngle: number, endAngle: number },
      shared,
    ),
    text: fields<Text>(
      { kind, layer: string, at: point, height: number, value: string, rotation: number },
      { ...shared, ...justified },
    ),
    paragraph: fields<Paragraph>(
      { kind, layer: string, at: point, height: number, value: string, rotation: number },
      {
        ...shared,
        ...justified,
        width: number,
        lineSpacing: number,
        lineSpacingStyle: ruled(string),
        columns: ruled(
          record(
            fields<ColumnsShape>(
              {},
              { height: number, heights: list(number), count: number, gutter: number },
            ),
          ),
        ),
      },
    ),
    insert: fields<Insert>(
      { kind, layer: string, block: ruled(string), at: point },
      { id: ruled(string), scale: ruled(scale), rotation: number, attributes: ruled(map(string)) },
    ),
    "linear-dimension": fields<LinearDimension>(
      { kind, layer: string, style: ruled(string), from: point, to: point, line: point },
      { id: ruled(string), angle: number, text: ruled(string), textBelow: ruled(string) },
    ),
    "aligned-dimension": fields<AlignedDimension>(
      { kind, layer: string, style: ruled(string), from: point, to: point, offset: number },
      { id: ruled(string), text: ruled(string), textBelow: ruled(string) },
    ),
    "radius-dimension": fields<RadiusDimension>(
      { kind, layer: string, style: ruled(string), center: point, point },
      {
        id: ruled(string),
        text: ruled(string),
        textBelow: ruled(string),
        textFromCenter: number,
      },
    ),
    "diameter-dimension": fields<DiameterDimension>(
      { kind, layer: string, style: ruled(string), center: point, point },
      {
        id: ruled(string),
        text: ruled(string),
        textBelow: ruled(string),
        textFromCenter: number,
      },
    ),
    "jogged-radius-dimension": fields<JoggedRadiusDimension>(
      { kind, layer: string, style: ruled(string), center: point, point, start: point, jog: point },
      { id: ruled(string), text: ruled(string), textBelow: ruled(string) },
    ),
    "angular-dimension": fields<AngularDimension>(
      {
        kind,
        layer: string,
        style: ruled(string),
        vertex: point,
        from: point,
        to: point,
        at: point,
      },
      { id: ruled(string), text: ruled(string), textBelow: ruled(string) },
    ),
    // A rule of `lint` reports the note, the shafts and the leader's own fields, whatever their type.
    leader: fields<Leader>(
      {
        kind,
        layer: string,
        style: ruled(string),
        at: point,
        shafts: ruled(list(list(point))),
      },
      {
        id: ruled(string),
        text: ruled(list(string)),
        block: ruled(string),
        attributes: ruled(map(string)),
        side: ruled(string),
        attachment: ruled(string),
        verticalAttachment: ruled(string),
        width: ruled(number),
        frame: ruled(boolean),
        // true, false or an object: the rule reports any other.
        mask: LEFT,
        shaft: ruled(string),
        farShafts: ruled(list(list(point))),
        textStyle: ruled(string),
        textHeight: ruled(number),
        arrowSize: ruled(number),
        landing: ruled(number),
        gap: ruled(number),
      },
    ),
    // A rule of `lint` reports the path, the pixels, the clip and the flags, whatever their type.
    image: fields<Image>(
      {
        kind,
        layer: string,
        path: ruled(string),
        pixels: ruled(point),
        at: point,
        width: number,
        height: number,
      },
      {
        ...shared,
        rotation: number,
        clip: ruled(list(point)),
        invertClip: ruled(boolean),
        transparent: ruled(boolean),
      },
    ),
  } satisfies Record<Entity["kind"], FieldsCheck>;

  const entity: Check = (value, at, problems, extra) => {
    if (!object(value)) {
      problems.push(`${at} ${PLAIN_OBJECT}`);
      return;
    }
    const named: unknown = !all || Object.hasOwn(value, "kind") ? value.kind : undefined;
    if (typeof named === "string" && Object.hasOwn(ENTITIES, named)) {
      ENTITIES[named as Entity["kind"]](value, at, problems, extra);
    } else {
      problems.push(asking ? "" : `${at}: ${unknownKindProblem(named)}`);
    }
  };

  const xrefFields = fields<Xref>({ name: string, path: string }, { attach: boolean });

  /**
   * An xref, which is told why it cannot have a field of a block. `lint` has a rule for each of
   * its fields, so there it is checked only for a field nobody knows.
   */
  const xref: FieldsCheck = all
    ? (value, at, problems) => {
        const known: Record<string, unknown> = { ...value };
        for (const field of XREF_REFUSED_FIELDS) {
          if (!Object.hasOwn(value, field)) continue;
          problems.push(`${at}: ${xrefFieldProblem(field)}`);
          delete known[field];
        }
        xrefFields(known, at, problems);
      }
    : fields<Xref & { [F in (typeof XREF_REFUSED_FIELDS)[number]]?: unknown }>(
        { name: ruled(string), path: ruled(string) },
        { attach: boolean, entities: LEFT, base: LEFT, attributes: LEFT },
      );

  const layer = record(
    fields<Layer>(
      { name: string, color: ruled(number) },
      {
        linetype: ruled(string),
        lineweight: ruled(numberOrName),
        off: ruled(boolean),
        frozen: ruled(boolean),
        locked: ruled(boolean),
        plot: ruled(boolean),
      },
    ),
  );
  const linetype = record(
    fields<Linetype>(
      { name: ruled(string), description: ruled(string), pattern: ruled(list(number)) },
      {},
    ),
  );
  const textStyle = record(
    fields<TextStyle>(
      { name: ruled(string), font: ruled(string) },
      { widthFactor: ruled(number), obliqueAngle: ruled(number) },
    ),
  );
  // A rule of `lint` reports every field of a dimension style, whatever its type.
  const dimensionStyle = record(
    fields<DimensionStyle>(
      {
        name: ruled(string),
        textHeight: ruled(number),
        arrowSize: ruled(number),
        extensionOffset: ruled(number),
        extensionBeyond: ruled(number),
        textGap: ruled(number),
        precision: ruled(number),
      },
      {
        textStyle: ruled(string),
        arrowhead: ruled(string),
        scale: ruled(number),
        prefix: ruled(string),
        suffix: ruled(string),
        units: ruled(string),
        suppressZeros: ruled(string),
        feetInchZeros: ruled(string),
        measurementScale: ruled(number),
        fraction: ruled(string),
        fractionScale: ruled(number),
        textPlacement: ruled(string),
        textFit: ruled(string),
        dimensionLineweight: ruled(numberOrName),
        extensionLineweight: ruled(numberOrName),
        radialText: ruled(string),
        jogAngle: ruled(number),
        angleUnits: ruled(string),
        anglePrecision: ruled(number),
        suppressAngleZeros: ruled(string),
      },
    ),
  );
  // A rule of `lint` reports every field of a leader style, whatever its type.
  const leaderStyle = record(
    fields<LeaderStyle>(
      {
        name: ruled(string),
        textHeight: ruled(number),
        arrowSize: ruled(number),
        landing: ruled(number),
        gap: ruled(number),
      },
      {
        textStyle: ruled(string),
        arrowhead: ruled(string),
        attachment: ruled(string),
        direction: ruled(string),
        verticalAttachment: ruled(string),
        frame: ruled(boolean),
        shaft: ruled(string),
        block: ruled(string),
        blockConnection: ruled(string),
        blockScale: ruled(number),
        scale: ruled(number),
      },
    ),
  );
  const attribute = record(
    fields<AttributeDefinition>(
      {
        tag: ruled(string),
        value: ruled(string),
        layer: string,
        at: point,
        height: number,
        rotation: number,
      },
      { prompt: string, ...justified },
    ),
  );
  const block = record(
    fields<Block>(
      { name: ruled(string), entities: table(entity) },
      { base: point, attributes: table(attribute) },
    ),
  );
  // A rule of `lint` reports every field of a viewport, whatever its type.
  const viewport = record(
    fields<Viewport>(
      {
        layer: ruled(string),
        corner: ruled(point),
        width: ruled(number),
        height: ruled(number),
        center: ruled(point),
        ratio: ruled(number),
      },
      { id: ruled(string), frozenLayers: ruled(list(string)), twist: ruled(number) },
    ),
  );
  const layout = record(
    fields<Layout>(
      {
        name: ruled(string),
        paper: ruled(string),
        viewports: table(viewport),
        entities: table(entity),
      },
      { plotStyle: ruled(string) },
    ),
  );
  const drawing = fields<Drawing>(
    {
      format: LEFT,
      units: ruled(string),
      dxf: oneOf("R12", "R2018"),
      layers: ruled(table(layer)),
      entities: ruled(table(entity)),
    },
    {
      linetypes: ruled(table(linetype)),
      linetypeScale: ruled(number),
      textStyles: ruled(table(textStyle)),
      blocks: ruled(table(block)),
      xrefs: ruled(table(record(xref))),
      layouts: ruled(table(layout)),
      dimensionStyles: ruled(table(dimensionStyle)),
      leaderStyles: ruled(table(leaderStyle)),
      imageFrame: ruled(boolean),
    },
  );
  return {
    drawing,
    point,
    layer,
    linetype,
    textStyle,
    dimensionStyle,
    leaderStyle,
    block,
    attribute,
    xref: record(xref),
    layout,
    viewport,
    entity,
  };
}

/** Everything `fromJSON` holds a drawing to. */
export const readDrawing = shapes(true).drawing;

/** What `lint` needs of each object before its rules read it. */
export const WALKABLE = shapes(false);

/** The type of every field of each object, for `lint` to tell a wrong type from another error. */
export const TYPED = shapes(false, true);
