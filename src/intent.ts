// What a drawing is meant to hold to, which no rule of a file states: a building that keeps out
// of its setbacks. `lint` holds the rules a file must meet. These are warnings about the design.
import { callOf, type CallSite } from "./callsite.ts";
import type { Drawing, Point } from "./drawing.ts";
import { written } from "./format.ts";
import { grid, side, type Box } from "./inspect.ts";
import { idKey, shown } from "./rules.ts";

/** The checks `checkIntent` makes. */
export type IntentRule = "footprint-in-setback" | "footprint-off-property" | "intent-unchecked";

/**
 * A setback: how far each footprint keeps from the sides of a property line. The property line
 * and the footprints are closed polylines of model space, named by their ids.
 */
export interface Setback {
  /** The id of the property line. */
  readonly property: string;
  /** The ids of the footprints that keep out of the setback, one or more. */
  readonly footprints: readonly string[];
  /**
   * The setback in drawing units, the units the points are in: one distance for every side of
   * the property line, or one for each side in the order of its points. The first side runs
   * from the first point to the second, and the last from the last point back to the first.
   */
  readonly distance: number | readonly number[];
}

/** What a drawing is meant to hold to, which `checkIntent` checks. */
export interface Intent {
  readonly setbacks?: readonly Setback[];
}

/** What names an entity of model space. */
export interface IntentOccurrence {
  /** The index of the entity in model space. */
  readonly entity: number;
  /** The entity's `id`. */
  readonly id?: string;
}

/** A warning that a drawing does not hold to its intent, or that part of it was not checked. */
export interface IntentWarning extends Partial<IntentOccurrence> {
  readonly rule: IntentRule;
  readonly severity: "warning";
  readonly message: string;
  /**
   * The path in the intent of the part the warning is about, such as `setbacks[0]`. Missing
   * for the intent as a whole.
   */
  readonly item?: string;
  /** The layer the entity names. */
  readonly layer?: string;
  /** The side of the property line, counted from 0 as `distance` counts them. */
  readonly side?: number;
  /** The setback of that side, in drawing units. */
  readonly required?: number;
  /** The least distance from that side to the footprint, in drawing units, as measured. */
  readonly provided?: number;
  /**
   * In model space, in drawing units. For `footprint-in-setback`, the box of the two points of
   * the side and the footprint nearest each other, larger on every side by the setback. For
   * `footprint-off-property`, the footprint's box.
   */
  readonly bounds?: { readonly min: Point; readonly max: Point };
  /** The property line. */
  readonly other?: IntentOccurrence;
  /** The call that drew the entity, when the drawing's builder recorded calls. */
  readonly call?: CallSite;
}

/**
 * The most work one call does, in steps: one for each item of a list in the intent; twenty for
 * each point of an outline when it is read, which holds the memory that copying its points and
 * filing its sides takes to a few tens of megabytes; one for each box of a side that the search
 * for sides that meet looks at, one for each pair it finds, and `EXACT_COST` for each turn of
 * three corners it works out in integers; nine for each pair of a footprint's point and its
 * property line's when the two are checked; and two more for each piece of a footprint's side
 * beyond the first that the property line cuts it into.
 */
const MAX_WORK = 4_000_000;

/** `MAX_WORK` as a message gives it. */
const STEPS = "4,000,000";

/** What working out a turn of three corners in integers costs, in the steps of `MAX_WORK`. */
const EXACT_COST = 64;

/** What reading one point of an outline costs, from what `MAX_WORK` counts. */
const READ_COST = 20;

/** The most warnings one call gives. One more then says that the rest was not checked. */
const MAX_WARNINGS = 200;

/**
 * The tolerance of a comparison, as a share of the largest coordinate of the two outlines: 256
 * times the spacing of doubles that large.
 */
const RELATIVE_TOLERANCE = 2 ** -44;

/**
 * The most a tolerance may be: half a unit of the 6th decimal, which is how far rounding moves a
 * coordinate.
 */
const MOST_TOLERANCE = 5e-7;

const SETBACK_FIELDS = ["property", "footprints", "distance"];

/** A closed polyline of model space that an id named. */
interface Outline extends IntentOccurrence {
  readonly id: string;
  /** Its corners, with no point that repeats the one before it or the first. */
  readonly points: readonly Point[];
  /** The same corners from the first, which keeps the arithmetic small far from the origin. */
  readonly local: readonly Point[];
}

/**
 * An entity as reading it found it: an outline, why it is none, or that it could not be read,
 * because it is more than the work of a call by itself or because the work left was too little.
 */
type Read = Outline | { readonly why: string } | "alone" | "short";

/** What a setback names that the work of the call could not take. */
interface Unchecked {
  readonly what: string;
  readonly index: number | undefined;
  /** True when it is more than the work of a call by itself. */
  readonly alone: boolean;
}

/**
 * Checks a drawing against what it is meant to hold to, and warns of:
 *
 * - `footprint-in-setback`: a footprint that comes nearer a side of its property line than that
 *   side's setback, one warning for each such side. The distance is the least one from the
 *   side, from one corner of the property line to the next, to the footprint's outline.
 * - `footprint-off-property`: a footprint that is not wholly inside its property line. It gets
 *   no `footprint-in-setback` warning.
 * - `intent-unchecked`: part of the intent that could not be checked, and why: a field it does
 *   not know, an id that names no closed polyline of model space whose sides meet only at its
 *   corners, a distance that is not a number of 0 or more, distances that do not match the
 *   property line's sides, or more points than it checks, in one warning for each setback.
 *   Past 200 warnings it stops, with one more that says so.
 *
 * Distances are in drawing units, measured from the points as the drawing holds them. A
 * footprint keeps a setback when it is no nearer than the setback less a tolerance, and is on
 * its property line when it is within the tolerance of it: 2^-44 of the largest coordinate of
 * the two outlines, and never more than 0.0000005, half a unit of the sixth decimal the writers
 * round to. An id is found as the drawing compares ids, whatever its case. A layer's state does
 * not matter.
 *
 * It never changes what `lint` reports or what `toDXF` writes. It takes any plain data as the
 * intent and never throws on it.
 */
export function checkIntent(drawing: Drawing, intent: Intent): IntentWarning[] {
  const out: IntentWarning[] = [];
  const given: unknown = intent;
  const entities: readonly unknown[] = Array.isArray(drawing?.entities) ? drawing.entities : [];
  let stopped = false;
  const warn = (warning: IntentWarning): void => {
    if (out.length < MAX_WARNINGS) out.push(warning);
    else stopped = true;
  };
  const unchecked = (message: string, item?: string, about: Partial<IntentWarning> = {}): void =>
    warn({
      rule: "intent-unchecked",
      severity: "warning",
      message,
      ...(item === undefined ? {} : { item }),
      ...about,
    });
  let work = 0;
  /** The work each part of the intent took, by what it is, such as the outline of a lot. */
  const spentOn = new Map<string, number>();
  /** Counts the cost of a step for `job`, and says whether there is room left to take it. */
  const spend = (cost: number, job: string): boolean => {
    if (work + cost > MAX_WORK) return false;
    work += cost;
    spentOn.set(job, (spentOn.get(job) ?? 0) + cost);
    return true;
  };
  /** What took the most of the work, and how much of it. */
  const heaviest = (): string => {
    let most: [string, number] = ["nothing", 0];
    for (const entry of spentOn) if (entry[1] > most[1]) most = entry;
    return `${most[0]} took ${Math.round((100 * most[1]) / MAX_WORK)}% of them`;
  };

  let ids: Map<string, number> | undefined;
  /** The index of the first entity of model space with the id. */
  const find = (id: string): number | undefined => {
    if (!ids) {
      ids = new Map();
      for (let i = 0; i < entities.length; i++) {
        const own = (entities[i] as { id?: unknown } | null)?.id;
        if (typeof own === "string" && !ids.has(idKey(own))) ids.set(idKey(own), i);
      }
    }
    return ids.get(idKey(id));
  };
  /** What names an entity, with its layer and the call that drew it. */
  const about = (index: number): Partial<IntentWarning> => {
    const entity = entities[index] as { id?: unknown; layer?: unknown };
    const call = callOf(entities as object[], index);
    return {
      entity: index,
      ...(typeof entity.id === "string" ? { id: entity.id } : {}),
      ...(typeof entity.layer === "string" ? { layer: entity.layer } : {}),
      ...(call === undefined ? {} : { call }),
    };
  };
  const reads = new Map<number, Read>();
  /** The entity at an index as an outline, read once however often the intent names it. */
  const read = (index: number, job: string): Read => {
    let found = reads.get(index);
    if (found === undefined) {
      const pay = (cost: number) => spend(cost, job);
      found = outlineOf(entities[index] as Record<string, unknown>, index, pay);
      reads.set(index, found);
    }
    return found;
  };

  /** Checks one setback, the `n`th, with one warning for all of it that is more than it checks. */
  const check = (setback: unknown, n: number): void => {
    const item = `setbacks[${n}]`;
    const at = `Setback ${n}`;
    if (!isRecord(setback)) {
      unchecked(`${at} must be an object with property, footprints and distance`, item);
      return;
    }
    for (const key in setback) {
      if (stopped) return;
      if (!Object.hasOwn(setback, key) || SETBACK_FIELDS.includes(key)) continue;
      const message = `${at} has no field ${shown(key)}. Its fields are property, footprints and distance`;
      unchecked(message, item);
    }
    const left: Unchecked[] = [];
    measure(setback, item, at, left);
    const [first, ...more] = left;
    if (!first) return;
    const what =
      more.length === 0 ? `${first.what} was` : `${first.what} and ${more.length} more were`;
    const why = first.alone
      ? `By itself it is more than the ${STEPS} steps of work checkIntent does in one call`
      : `checkIntent does ${STEPS} steps of work in one call, and ${heaviest()}`;
    const named = first.index === undefined ? {} : about(first.index);
    unchecked(`${at}: ${what} not checked. ${why}`, item, named);
  };

  /** Checks what one setback names, keeping in `left` what the work of the call could not take. */
  const measure = (
    setback: Record<string, unknown>,
    item: string,
    at: string,
    left: Unchecked[],
  ): void => {
    /** The closed polyline an id names, or undefined with a warning that says why not. */
    const outline = (id: string, what: string): Outline | undefined => {
      const index = find(id);
      if (index === undefined) {
        unchecked(
          `${at} names ${what} ${shown(id)}, and no entity of model space has that id`,
          item,
        );
        return undefined;
      }
      const job = `the outline of ${what} ${shown(id)}`;
      const found = read(index, job);
      if (found === "alone" || found === "short") {
        left.push({ what: job, index, alone: found === "alone" });
        return undefined;
      }
      if ("why" in found) {
        unchecked(`${at} names ${what} ${shown(id)}${found.why}`, item, about(index));
        return undefined;
      }
      return found;
    };

    const { property, footprints, distance } = setback;
    let lot: Outline | undefined;
    if (typeof property === "string") lot = outline(property, "property line");
    else unchecked(`${at}'s property must be the id of a closed polyline`, item);
    const allowed = (d: unknown): d is number =>
      typeof d === "number" && Number.isFinite(d) && d >= 0;
    let distances: number | readonly number[] | undefined;
    if (allowed(distance)) {
      distances = distance;
    } else if (Array.isArray(distance) && !spend(distance.length, `the distances of ${at}`)) {
      const alone = distance.length > MAX_WORK;
      left.push({ what: "its list of distances", index: undefined, alone });
    } else if (Array.isArray(distance) && each(distance, allowed)) {
      if (lot && distance.length !== lot.points.length) {
        unchecked(
          `${at} gives ${distance.length} distances for property line ${shown(lot.id)}, which has ${lot.points.length} sides. Give one distance, or one for each side in the order of its points`,
          item,
          about(lot.entity),
        );
      } else {
        distances = distance;
      }
    } else {
      unchecked(
        `${at}'s distance must be a number of 0 or more, in drawing units, or an array of one for each side of the property line`,
        item,
      );
    }
    const listed = `${at}'s footprints must be an array of one or more ids of closed polylines`;
    if (!Array.isArray(footprints) || footprints.length === 0) {
      unchecked(listed, item);
      return;
    }
    if (!spend(footprints.length, `the footprints of ${at}`)) {
      const alone = footprints.length > MAX_WORK;
      left.push({ what: "its list of footprints", index: undefined, alone });
      return;
    }
    if (!each(footprints, (id): id is string => typeof id === "string")) {
      unchecked(listed, item);
      return;
    }
    // An id named twice is checked once.
    const named = new Set<string>();
    const buildings: Outline[] = [];
    for (let j = 0; j < footprints.length && !stopped; j++) {
      const key = idKey(footprints[j]!);
      if (named.has(key)) continue;
      named.add(key);
      const building = outline(footprints[j]!, "footprint");
      if (building) buildings.push(building);
    }
    if (!lot || distances === undefined) return;

    const sides = lot.points.length;
    const origin = lot.points[0]!;
    const stated = distances;
    const requiredAt = (i: number): number => (typeof stated === "number" ? stated : stated[i]!);
    for (const building of buildings) {
      if (stopped) return;
      const job = `footprint ${shown(building.id)} held against property line ${shown(lot.id)}`;
      const cost = 9 * sides * building.points.length;
      if (!spend(cost, job)) {
        left.push({ what: job, index: building.entity, alone: cost > MAX_WORK });
        continue;
      }
      const tolerance = toleranceOf(lot.points, building.points);
      const footprint = building.points.map(([x, y]): Point => [x - origin[0], y - origin[1]]);
      const found = { item, ...about(building.entity) };
      const other = { entity: lot.entity, id: lot.id };
      const inside = contained(footprint, lot.local, tolerance, (more) => spend(more, job));
      if (inside === undefined) {
        left.push({ what: job, index: building.entity, alone: false });
        continue;
      }
      if (!inside) {
        warn({
          rule: "footprint-off-property",
          severity: "warning",
          message: `Footprint ${shown(building.id)} is not wholly inside property line ${shown(lot.id)}. Move it inside, or name the property line it is on`,
          ...found,
          bounds: boxOf(building.points, [0, 0], 0),
          other,
        });
        continue;
      }
      for (let i = 0; i < sides && !stopped; i++) {
        const required = requiredAt(i);
        const near = nearest(lot.local[i]!, lot.local[(i + 1) % sides]!, footprint);
        const provided = near.distance;
        if (provided >= required - tolerance) continue;
        const how = provided <= tolerance ? "touches" : `is ${shownShort(provided, required)} from`;
        const a = lot.points[i]!;
        const b = lot.points[(i + 1) % sides]!;
        warn({
          rule: "footprint-in-setback",
          severity: "warning",
          message: `Footprint ${shown(building.id)} ${how} side ${i} of property line ${shown(lot.id)}, from ${shownPoint(a)} to ${shownPoint(b)}, whose setback is ${required}. Move the footprint back from that side or make it smaller`,
          ...found,
          side: i,
          required,
          provided,
          bounds: boxOf([near.onSide, near.onOutline], origin, required),
          other,
        });
      }
    }
  };

  const run = (): void => {
    if (!isRecord(given)) {
      unchecked("The intent must be an object, such as { setbacks: [...] }");
      return;
    }
    for (const key in given) {
      if (stopped) return;
      if (!Object.hasOwn(given, key) || key === "setbacks") continue;
      unchecked(`The intent has no field ${shown(key)}. Its one field is setbacks`);
    }
    const setbacks = given.setbacks;
    if (setbacks === undefined) return;
    if (!Array.isArray(setbacks)) {
      unchecked("The intent's setbacks must be an array", "setbacks");
      return;
    }
    for (let n = 0; n < setbacks.length && !stopped; n++) check(setbacks[n], n);
  };
  run();
  if (stopped) {
    out.push({
      rule: "intent-unchecked",
      severity: "warning",
      message: `checkIntent stopped after ${MAX_WARNINGS} warnings, so the rest of the intent was not checked. Act on these and check again`,
    });
  }
  return out;
}

/** Whether every item of an array passes, an empty slot included, which `every` skips. */
function each<T>(list: readonly unknown[], test: (item: unknown) => item is T): list is T[] {
  for (let i = 0; i < list.length; i++) if (!test(list[i])) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * An entity as an outline: a closed polyline whose points are numbers, which has an area and
 * whose sides meet only at its corners. A point that repeats the one before it, and a last
 * point that repeats the first, are the same corner. Its points are paid for before they are
 * read.
 */
function outlineOf(
  entity: Record<string, unknown>,
  index: number,
  spend: (cost: number) => boolean,
): Read {
  if (entity.kind !== "polyline") {
    return { why: `, which is an entity of kind ${shown(entity.kind)}, not a closed polyline` };
  }
  if (entity.closed !== true) return { why: ", which is an open polyline, not a closed polyline" };
  const points = entity.points;
  if (!Array.isArray(points)) return { why: ", which is a polyline with no points" };
  if (READ_COST * points.length > MAX_WORK) return "alone";
  if (!spend(READ_COST * points.length)) return "short";
  for (let i = 0; i < points.length; i++) {
    const p: unknown = points[i];
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      return { why: ", which has a point that is not two numbers" };
    }
  }
  const same = (p: Point, q: Point): boolean => p[0] === q[0] && p[1] === q[1];
  const corners: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Point;
    const last = corners.at(-1);
    if (!last || !same(p, last)) corners.push(p);
  }
  while (corners.length > 1 && same(corners[0]!, corners.at(-1)!)) corners.pop();
  const first = corners[0];
  if (!first || corners.length < 3) return { why: ", which has no area" };
  const local = corners.map(([x, y]): Point => [x - first[0], y - first[1]]);
  if (twiceArea(local) === 0) return { why: ", which has no area" };
  const simple = isSimple(corners, spend);
  if (simple === undefined) return "short";
  if (!simple) {
    return {
      why: ", whose outline crosses or touches itself. checkIntent takes an outline whose sides meet only where one ends and the next starts, so it takes no lot with a hole",
    };
  }
  return { entity: index, id: entity.id as string, points: corners, local };
}

/** Twice the area of a polygon whose first point is the origin, positive counterclockwise. */
function twiceArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 1; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Number.isFinite(sum) ? sum : 0;
}

/**
 * Whether the sides of a polygon meet only where one ends and the next starts. Two sides that
 * cross, touch or overlap, a side of no length, and a side that turns back along the one
 * before it all make it not simple. Undefined when `spend` has no room for the pairs of sides
 * that might meet.
 */
function isSimple(points: readonly Point[], spend: (cost: number) => boolean): boolean | undefined {
  const n = points.length;
  const ends = (i: number): [Point, Point] => [points[i]!, points[(i + 1) % n]!];
  const boxes: Box[] = [];
  for (let i = 0; i < n; i++) {
    const [a, b] = ends(i);
    if (a[0] === b[0] && a[1] === b[1]) return false;
    boxes.push([
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
    ]);
  }
  let short = false;
  const pay = (cost: number): boolean => {
    if (!short && spend(cost)) return true;
    short = true;
    return false;
  };
  const near = grid(boxes, pay);
  const exact = (): boolean => pay(EXACT_COST);
  let simple = true;
  for (let i = 1; i < n && simple && !short; i++) {
    const [a, b] = ends(i);
    near(
      boxes[i]!,
      (j) => {
        if (!simple || !pay(1)) return;
        const [c, d] = ends(j);
        // Two sides in a row share a corner, and meet wrongly only where one turns back.
        if (j === i - 1) simple = !folds(c, a, b, exact);
        else if (i === n - 1 && j === 0) simple = !folds(a, b, d, exact);
        else simple = !touch(a, b, c, d, exact);
      },
      i,
    );
  }
  return short ? undefined : simple;
}

/** Whether the side `s` to `q` turns back along the side `p` to `s` before it. */
function folds(p: Point, s: Point, q: Point, exact: () => boolean): boolean {
  // On one line, it turns back when `p` and `q` lie the same way from `s`.
  return (
    turn(p, s, q, exact) === 0 &&
    Math.sign(p[0] - s[0]) === Math.sign(q[0] - s[0]) &&
    Math.sign(p[1] - s[1]) === Math.sign(q[1] - s[1])
  );
}

/** Whether the segments `a` to `b` and `c` to `d` have a point in common. */
function touch(a: Point, b: Point, c: Point, d: Point, exact: () => boolean): boolean {
  const d1 = turn(c, d, a, exact);
  const d2 = turn(c, d, b, exact);
  const d3 = turn(a, b, c, exact);
  const d4 = turn(a, b, d, exact);
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  return (
    (d1 === 0 && spans(c, d, a)) ||
    (d2 === 0 && spans(c, d, b)) ||
    (d3 === 0 && spans(a, b, c)) ||
    (d4 === 0 && spans(a, b, d))
  );
}

/**
 * The most the turn of three corners worked out in doubles can be off, as a share of the sum of
 * the sizes of its two products: the first error bound of Shewchuk's `orient2d`.
 */
const TURN_ERROR = (3 + 16 * 2 ** -53) * 2 ** -53;

/** Below this, the two products of a turn may have lost digits to underflow. */
const TURN_SMALLEST = 2 ** -900;

/**
 * The sign of the turn from `a` to `b` to `c`, exactly for the doubles given: 1 to the left, -1
 * to the right and 0 when the three lie on one line. The doubles decide it when the turn is
 * larger than the error they can make, and integers do otherwise, which `exact` pays for. When
 * it refuses, the turn is 0.
 */
function turn(a: Point, b: Point, c: Point, exact: () => boolean): number {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  // A difference of two doubles has the right sign, and is 0 only when they are equal, so a
  // product with a factor of 0 is truly 0, and two products of other signs decide the turn.
  const leftSign = Math.sign(ux) * Math.sign(vy);
  const rightSign = Math.sign(uy) * Math.sign(vx);
  if (leftSign === 0 || rightSign === 0 || leftSign !== rightSign) {
    return Math.sign(leftSign - rightSign);
  }
  const left = ux * vy;
  const right = uy * vx;
  const size = Math.abs(left) + Math.abs(right);
  if (size > TURN_SMALLEST && size < Infinity) {
    const turned = left - right;
    if (turned > TURN_ERROR * size) return 1;
    if (turned < -TURN_ERROR * size) return -1;
  }
  return exact() ? exactTurn(a, b, c) : 0;
}

/**
 * The turn of three corners worked out in integers, with each double as its mantissa times a
 * power of two.
 */
function exactTurn(a: Point, b: Point, c: Point): number {
  const parts = [a[0], a[1], b[0], b[1], c[0], c[1]].map(binary);
  let low = Infinity;
  for (const [mantissa, exponent] of parts) if (mantissa !== 0n && exponent < low) low = exponent;
  if (low === Infinity) return 0;
  const [ax, ay, bx, by, cx, cy] = parts.map(([mantissa, exponent]) =>
    mantissa === 0n ? 0n : mantissa << BigInt(exponent - low),
  ) as [bigint, bigint, bigint, bigint, bigint, bigint];
  const turned = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return turned > 0n ? 1 : turned < 0n ? -1 : 0;
}

const bits = new BigUint64Array(1);
const float = new Float64Array(bits.buffer);

/** A finite double as `[m, e]`, an integer and a power of two whose product is the double. */
function binary(x: number): [bigint, number] {
  float[0] = x;
  const all = bits[0]!;
  const exponent = Number((all >> 52n) & 0x7ffn);
  const fraction = all & 0xfffffffffffffn;
  const mantissa = exponent === 0 ? fraction : fraction | 0x10000000000000n;
  return [all >> 63n ? -mantissa : mantissa, exponent === 0 ? -1074 : exponent - 1075];
}

/** Whether `p`, on the line through `a` and `b`, is in the box of the segment between them. */
function spans(a: Point, b: Point, p: Point): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])
  );
}

/** The tolerance for two outlines, from the largest of their coordinates. */
function toleranceOf(a: readonly Point[], b: readonly Point[]): number {
  let largest = 1;
  for (const points of [a, b]) {
    for (const [x, y] of points) largest = Math.max(largest, Math.abs(x), Math.abs(y));
  }
  return Math.min(MOST_TOLERANCE, largest * RELATIVE_TOLERANCE);
}

/**
 * A distance short of `required` as a message gives it: to 6 decimals, or in full where those
 * would hide the shortfall.
 */
function shownShort(provided: number, required: number): string {
  const rounded = written(provided);
  return String(rounded < required ? rounded : provided);
}

function shownPoint(p: Point): string {
  return `[${written(p[0])}, ${written(p[1])}]`;
}

/** The box around points taken from `origin`, larger on every side by `grow`, as written. */
function boxOf(points: readonly Point[], origin: Point, grow: number): { min: Point; max: Point } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    min: [written(origin[0] + minX - grow), written(origin[1] + minY - grow)],
    max: [written(origin[0] + maxX + grow), written(origin[1] + maxY + grow)],
  };
}

/**
 * Whether the outline `inner` lies wholly in the outline `outer`, where being within
 * `tolerance` of `outer` counts as in. Each corner of `inner` must be in, and no corner of
 * `outer` may be inside `inner` by more than the tolerance, since `outer`'s outline would then
 * pass through it. Each side of `inner` is cut where a side of `outer` crosses it and at each
 * corner of `outer` within the tolerance of it, and the middle of each piece must be in. So a
 * side that leaves `outer` and comes back through two of its corners is out. Undefined when
 * `spend` has no room for the pieces.
 */
function contained(
  inner: readonly Point[],
  outer: readonly Point[],
  tolerance: number,
  spend: (cost: number) => boolean,
): boolean | undefined {
  for (const p of inner) if (!inOrOn(p, outer, tolerance)) return false;
  for (const p of outer) if (insideBy(p, inner, tolerance)) return false;
  for (let j = 0; j < inner.length; j++) {
    const c = inner[j]!;
    const d = inner[(j + 1) % inner.length]!;
    const cuts = [0, 1];
    for (let i = 0; i < outer.length; i++) {
      const p = outer[i]!;
      const t = crossing(c, d, p, outer[(i + 1) % outer.length]!);
      if (t !== undefined) cuts.push(t);
      if (toSegment(p, c, d) <= tolerance) {
        const at = along(p, c, d);
        if (at > 0 && at < 1) cuts.push(at);
      }
    }
    // The first piece of each side is paid for with the outlines.
    if (cuts.length > 2 && !spend(2 * (cuts.length - 2) * outer.length)) return undefined;
    cuts.sort((x, y) => x - y);
    for (let k = 1; k < cuts.length; k++) {
      if (!(cuts[k]! > cuts[k - 1]!)) continue;
      const t = (cuts[k - 1]! + cuts[k]!) / 2;
      const middle: Point = [c[0] + t * (d[0] - c[0]), c[1] + t * (d[1] - c[1])];
      if (!inOrOn(middle, outer, tolerance)) return false;
    }
  }
  return true;
}

/**
 * Where, between 0 at `c` and 1 at `d`, the segment `c` to `d` crosses the segment `a` to `b`,
 * or undefined when it does not cross it between its ends.
 */
function crossing(c: Point, d: Point, a: Point, b: Point): number | undefined {
  const rx = d[0] - c[0];
  const ry = d[1] - c[1];
  const sx = b[0] - a[0];
  const sy = b[1] - a[1];
  const across = rx * sy - ry * sx;
  if (across === 0) return undefined;
  const qx = a[0] - c[0];
  const qy = a[1] - c[1];
  const t = (qx * sy - qy * sx) / across;
  const u = (qx * ry - qy * rx) / across;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : undefined;
}

/** Whether a point is inside a polygon, or within `tolerance` of its outline. */
function inOrOn(p: Point, polygon: readonly Point[], tolerance: number): boolean {
  return enclosed(p, polygon) || nearOutline(p, polygon, tolerance);
}

/** Whether a point is inside a polygon by more than `tolerance`. */
function insideBy(p: Point, polygon: readonly Point[], tolerance: number): boolean {
  return enclosed(p, polygon) && !nearOutline(p, polygon, tolerance);
}

/** Whether a point is inside a polygon, by the crossings of a ray from it. */
function enclosed(p: Point, polygon: readonly Point[]): boolean {
  const [x, y] = p;
  let odd = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a[1] > y !== b[1] > y && x < a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) {
      odd = !odd;
    }
  }
  return odd;
}

/** Whether a point is within `tolerance` of a polygon's outline. */
function nearOutline(p: Point, polygon: readonly Point[], tolerance: number): boolean {
  for (let i = 0; i < polygon.length; i++) {
    if (toSegment(p, polygon[i]!, polygon[(i + 1) % polygon.length]!) <= tolerance) return true;
  }
  return false;
}

/**
 * The least distance from the side `a` to `b` to a closed outline, with the point of the side
 * and the point of the outline that are that far apart.
 */
function nearest(
  a: Point,
  b: Point,
  outline: readonly Point[],
): { distance: number; onSide: Point; onOutline: Point } {
  let distance = Infinity;
  let edge = 0;
  for (let j = 0; j < outline.length && distance > 0; j++) {
    const found = apart(a, b, outline[j]!, outline[(j + 1) % outline.length]!);
    if (found < distance) [distance, edge] = [found, j];
  }
  const c = outline[edge]!;
  const d = outline[(edge + 1) % outline.length]!;
  return { distance, ...closest(a, b, c, d) };
}

/** Whether the segments `a` to `b` and `c` to `d` cross, each at a point inside the other. */
function cross(a: Point, b: Point, c: Point, d: Point): boolean {
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

/** The least distance between the segment `a` to `b` and the segment `c` to `d`. */
function apart(a: Point, b: Point, c: Point, d: Point): number {
  if (cross(a, b, c, d)) return 0;
  return Math.min(toSegment(c, a, b), toSegment(d, a, b), toSegment(a, c, d), toSegment(b, c, d));
}

/** The point of each segment nearest the other. */
function closest(a: Point, b: Point, c: Point, d: Point): { onSide: Point; onOutline: Point } {
  if (cross(a, b, c, d)) {
    const [s, t] = [side(c, d, a), side(c, d, b)];
    const at: Point = [a[0] + (s / (s - t)) * (b[0] - a[0]), a[1] + (s / (s - t)) * (b[1] - a[1])];
    return { onSide: at, onOutline: at };
  }
  const pairs: [Point, Point][] = [
    [nearestOn(c, a, b), c],
    [nearestOn(d, a, b), d],
    [a, nearestOn(a, c, d)],
    [b, nearestOn(b, c, d)],
  ];
  const length = ([p, q]: [Point, Point]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const [onSide, onOutline] = pairs.reduce((x, y) => (length(y) < length(x) ? y : x));
  return { onSide, onOutline };
}

/** The distance from `p` to the segment `a` to `b`. */
function toSegment(p: Point, a: Point, b: Point): number {
  const t = along(p, a, b);
  return Math.hypot(a[0] + t * (b[0] - a[0]) - p[0], a[1] + t * (b[1] - a[1]) - p[1]);
}

/** The point of the segment `a` to `b` nearest `p`. */
function nearestOn(p: Point, a: Point, b: Point): Point {
  const t = along(p, a, b);
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

/** How far along the segment `a` to `b` its point nearest `p` is, from 0 at `a` to 1 at `b`. */
function along(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  return length > 0
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length))
    : 0;
}
