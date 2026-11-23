// A schedule drawn as text in boxes, read as a grid, and a row added to it: the rows below moved,
// what spans the row stretched, and the row beside copied in its own formats.
import type { EntityColor, EntityTransparency, Point } from "../drawing.ts";
import { isNumber, isRecord, isString } from "../guards.ts";
import { layerKey } from "../layers.ts";
import { measureText } from "../measure.ts";
import { plain } from "../paragraph-codes.ts";
import type {
  DrawingRead,
  ReadArc,
  ReadEntity,
  ReadMtext,
  ReadText,
  ReadTextStyle,
} from "../read/model.ts";
import { canonicalHandle, EditError, type EditDrawing } from "./model.ts";

/** Where a schedule is: a window around it, in model space or on a layout's paper. */
export interface ScheduleWhere {
  /** Two corners of a window that holds the schedule whole and nothing else of its space. */
  readonly window: readonly [Point, Point];
  /** The layout whose paper holds it. Missing, model space. */
  readonly layout?: string;
}

/** A schedule read as a grid of cells from the lines and the polylines that box its texts. */
export interface ReadSchedule extends ScheduleWhere {
  /** The X of each column's left edge, left to right, and last the right edge of the last. */
  readonly columns: readonly number[];
  /** The Y of each row's top edge, top to bottom, and last the bottom edge of the last. */
  readonly rows: readonly number[];
  /** Each cell, a merged one once, by the row and then the column it starts at. */
  readonly cells: readonly ScheduleCell[];
  /** Each entity of the schedule, in the order of its space. */
  readonly handles: readonly string[];
}

/** A cell of a schedule: where it starts, how many rows and columns it spans, and what it holds. */
export interface ScheduleCell {
  readonly row: number;
  readonly column: number;
  readonly rows: number;
  readonly columns: number;
  /** Its lower left and upper right corners. */
  readonly box: readonly [Point, Point];
  /** Its texts without their codes, top to bottom, one line each. */
  readonly text: string;
  /** What it holds inside its edges: its texts first, then anything else, such as a circle. */
  readonly handles: readonly string[];
}

/** A row added to a schedule below the row `after`, in that row's formats. */
export interface ScheduleRow {
  /** The row it goes below, as `ReadSchedule.rows` counts them from 0. */
  readonly after: number;
  /**
   * The new row's value of each cell of the row `after`, left to right as `cells` lists them:
   * text, which is written as it reads, `""` for none, or `undefined` for the texts of the
   * cell above as they are. A cell that spans more than the row `after` grows by the new row
   * and takes `undefined`.
   */
  readonly cells: readonly (string | undefined)[];
}

/** The bounds of a schedule read. */
export const SCHEDULE_LIMITS = {
  /** The most entities a schedule's window holds. */
  entities: 20_000,
  /** The most edges across and up and down. */
  edges: 2_000,
  /** The most cells of one row and one column each, rows times columns. */
  cells: 250_000,
  /** The most sides its lines and polylines have in all. */
  sides: 200_000,
  /** The most points of the space's entities a read looks at to find what the window holds. */
  points: 10_000_000,
} as const;

type Box = readonly [x0: number, y0: number, x1: number, y1: number];

/** An entity of a schedule: its box, and the cell it is inside, or none for an edge. */
interface Held {
  readonly entity: ReadEntity;
  readonly handle: string;
  readonly box: Box;
  /** The index in `cells` of the cell whose inside holds it, for what is not an edge. */
  readonly cell?: number;
  /** True for a line or a polyline that draws some of the grid's edges. */
  readonly edge: boolean;
}

/** A schedule read, with what the row it is given needs of it. */
interface Grid {
  readonly schedule: ReadSchedule;
  readonly held: readonly Held[];
  /** How far apart two edges are and still one. */
  readonly tolerance: number;
  /** The horizontal sides of every entity, for the edges each draws. */
  readonly across: readonly Side[];
}

interface Side {
  readonly at: number;
  readonly from: number;
  readonly to: number;
  readonly held: number;
}

const fail = (message: string): never => {
  throw new EditError(`schedule: ${message}`);
};

const isPoint = (p: unknown): p is Point =>
  Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** The entities of the space a schedule is in. */
function spaceOf(read: DrawingRead, layout: string | undefined): readonly ReadEntity[] {
  if (layout === undefined) {
    const list = read.model.entities;

    return list ?? fail("the read holds no geometry: read the file with `geometry`");
  }

  if (!isString(layout)) return fail("a layout is named by a string");
  const found = read.layouts.find((l) => layerKey(l.name) === layerKey(layout));

  if (found === undefined) return fail(`the file has no layout ${JSON.stringify(layout)}`);

  return found.entities ?? fail("the read holds no geometry: read the file with `geometry`");
}

/** The points an entity's box is made from, or none for a kind a schedule does not place. */
function pointsOf(e: ReadEntity): Point[] {
  switch (e.kind) {
    case "line":
      return [e.from, e.to];
    case "polyline":
    case "solid":
      return Array.isArray(e.points) ? e.points : [];
    case "circle":
      return isPoint(e.center) && isNumber(e.radius) ? roundBox(e.center, e.radius, e.radius) : [];
    case "arc":
      return arcPoints(e);
    case "ellipse": {
      if (!isPoint(e.majorAxis) || !isNumber(e.ratio)) return [];
      const [mx, my] = e.majorAxis;

      return isPoint(e.center)
        ? roundBox(e.center, Math.hypot(mx, e.ratio * my), Math.hypot(my, e.ratio * mx))
        : [];
    }

    case "spline":
      return Array.isArray(e.controlPoints) ? e.controlPoints : [];
    case "leader":
    case "wipeout":
      return Array.isArray(e.points) ? e.points : [];
    case "image":
      return isPoint(e.at) && isPoint(e.u) && isPoint(e.v) && Array.isArray(e.pixels)
        ? [
            e.at,
            [e.at[0] + e.u[0] * e.pixels[0], e.at[1] + e.u[1] * e.pixels[0]],
            [e.at[0] + e.v[0] * e.pixels[1], e.at[1] + e.v[1] * e.pixels[1]],
            [
              e.at[0] + e.u[0] * e.pixels[0] + e.v[0] * e.pixels[1],
              e.at[1] + e.u[1] * e.pixels[0] + e.v[1] * e.pixels[1],
            ],
          ]
        : [];

    case "text":
      return e.alignAt === undefined ? [e.stored] : [e.stored, e.alignAt];
    case "mtext":
    case "insert":
    case "point":
    case "multileader":
    case "underlay":
    case "table":
      return [e.at];
    case "dimension":
      return [e.from, e.to, e.line, e.textAt];
    case "hatch":
      return Array.isArray(e.loops)
        ? e.loops.flatMap((l) => (Array.isArray(l?.points) ? l.points : []))
        : [];
    default:
      return [];
  }
}

/** The corners of a box `rx` and `ry` about a center. */
const roundBox = (c: Point, rx: number, ry: number): Point[] => [
  [c[0] - rx, c[1] - ry],
  [c[0] + rx, c[1] + ry],
];

/** An arc's ends, and each quarter of its circle it passes through. */
function arcPoints(e: ReadArc): Point[] {
  if (!isPoint(e.center) || !isNumber(e.radius) || !isNumber(e.start) || !isNumber(e.end))
    return [];
  const { center, radius, start, end } = e;

  const at = (degrees: number): Point => [
    center[0] + radius * Math.cos((degrees * Math.PI) / 180),
    center[1] + radius * Math.sin((degrees * Math.PI) / 180),
  ];

  const from = ((start % 360) + 360) % 360;
  const sweep = (((end - start) % 360) + 360) % 360 || 360;
  const out = [at(from), at(from + sweep)];

  for (const q of [0, 90, 180, 270, 360, 450, 540, 630])
    if (q > from && q < from + sweep) out.push(at(q));

  return out;
}

function boxOf(points: readonly Point[]): Box | undefined {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];

  for (const p of points) {
    if (!isPoint(p)) return undefined;
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }

  return points.length === 0 ? undefined : [x0, y0, x1, y1];
}

/** The straight sides of a line or a polyline, each from one point to the next. */
function sidesOf(e: ReadEntity): [Point, Point][] {
  if (e.kind === "line") return [[e.from, e.to]];

  if (e.kind !== "polyline" || !Array.isArray(e.points)) return [];
  const out: [Point, Point][] = [];
  const n = e.points.length;
  const count = e.closed ? n : n - 1;

  const bulges = Array.isArray(e.bulges) ? e.bulges : [];

  for (let i = 0; i < count; i++)
    if ((bulges[i] ?? 0) === 0) out.push([e.points[i]!, e.points[(i + 1) % n]!]);

  return out;
}

/** Where a text sits inside its cell: its point, half its height into the box it is placed by. */
function placeOf(e: ReadEntity, box: Box, styles: ReadonlyMap<string, ReadTextStyle>): Point {
  /** A point `x` along the text's line and `y` up from it, from `at`, turned as the text is. */
  const turned = (at: Point, x: number, y: number, degrees: number): Point => {
    const r = (degrees * Math.PI) / 180;

    return [at[0] + x * Math.cos(r) - y * Math.sin(r), at[1] + x * Math.sin(r) + y * Math.cos(r)];
  };

  if (e.kind === "mtext" && isPoint(e.at) && isNumber(e.height)) {
    const a = Math.min(Math.max(Math.trunc(isNumber(e.attachment) ? e.attachment : 1), 1), 9) - 1;
    const half = e.height / 2;

    return turned(
      e.at,
      [half, 0, -half][a % 3]!,
      [-half, 0, half][Math.floor(a / 3)]!,
      isNumber(e.rotation) ? e.rotation : 0,
    );
  }

  if (
    e.kind === "text" &&
    e.startFrom !== "alignment" &&
    isNumber(e.height) &&
    isPoint(e.at) &&
    isString(e.value)
  ) {
    // Half way along it as its font measures it, from where it starts to draw.
    const style = isString(e.style) ? styles.get(layerKey(e.style)) : undefined;
    const length = lengthOf(e, style);

    if (length !== undefined)
      return turned(e.at, length / 2, e.height / 2, isNumber(e.rotation) ? e.rotation : 0);
  }

  if (e.kind === "text" && isNumber(e.height)) {
    const half = e.height / 2;
    const at = e.alignAt ?? e.stored;
    const x = e.align === "right" ? -half : e.align === undefined ? half : 0;
    const y = e.valign === "top" ? -half : e.valign === "middle" || e.align === "middle" ? 0 : half;

    return isPoint(at) ? turned(at, x, y, isNumber(e.rotation) ? e.rotation : 0) : [NaN, NaN];
  }

  if (e.kind === "circle" && isPoint(e.center)) return e.center;

  return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
}

/** The edge of `edges`, in order up, nearest `v`. */
function nearestEdge(edges: readonly number[], v: number): number | undefined {
  let [lo, hi] = [0, edges.length - 1];

  if (hi < 0) return undefined;

  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;

    if (edges[mid]! <= v) lo = mid;
    else hi = mid;
  }

  return Math.abs(edges[lo]! - v) <= Math.abs(edges[hi]! - v) ? edges[lo] : edges[hi];
}

/** What the sides on each edge cover of it, as runs in order, by the edge. */
function runsOf(
  sides: readonly Side[],
  edges: readonly number[],
  tolerance: number,
): Map<number, [number, number][]> {
  const lists = new Map<number, Side[]>();

  for (const s of sides) {
    const e = nearestEdge(edges, s.at);

    if (e === undefined) continue;
    const list = lists.get(e) ?? [];
    list.push(s);
    lists.set(e, list);
  }

  const out = new Map<number, [number, number][]>();

  for (const [e, list] of lists) {
    const runs: [number, number][] = [];

    for (const s of list.sort((a, b) => a.from - b.from)) {
      const last = runs[runs.length - 1];

      if (last !== undefined && s.from - tolerance <= last[1]) last[1] = Math.max(last[1], s.to);
      else runs.push([s.from, s.to]);
    }

    out.set(e, runs);
  }

  return out;
}

/** The run of `runs`, in order, that holds `v`, or undefined. */
function runAt(
  runs: readonly [number, number][],
  v: number,
  tolerance: number,
): [number, number] | undefined {
  let [lo, hi] = [0, runs.length - 1];

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = runs[mid]!;

    if (v < r[0] - tolerance) hi = mid - 1;
    else if (v > r[1] + tolerance) lo = mid + 1;
    else return r;
  }

  return undefined;
}

/**
 * The runs joined to the schedule's outside, by the edges up and down (`ups`, by X) and across
 * (`acrosses`, by Y): each run on an outermost edge, and each run that meets one joined. What
 * stands alone inside a cell, a tag's box or a rule, is left out.
 */
function joined(
  ups: ReadonlyMap<number, [number, number][]>,
  acrosses: ReadonlyMap<number, [number, number][]>,
  tolerance: number,
): [Map<number, [number, number][]>, Map<number, [number, number][]>] {
  const xs = [...ups.keys()].sort((a, b) => a - b);
  const ys = [...acrosses.keys()].sort((a, b) => a - b);
  const seen = new Set<[number, number]>();
  let work = 0;

  /** Walks from `seeds` through the runs each meets, into `into`: the edges each way it reached. */
  const walk = (
    seeds: readonly { run: [number, number]; at: number; up: boolean }[],
    into: Set<[number, number]>,
  ): Reached => {
    const queue: { run: [number, number]; at: number; up: boolean }[] = [];
    const reached: Reached = { xs: new Set<number>(), ys: new Set<number>() };

    const visit = (run: [number, number], at: number, up: boolean): void => {
      if (into.has(run)) return;
      into.add(run);
      (up ? reached.xs : reached.ys).add(at);
      queue.push({ run, at, up });
    };

    for (const s of seeds) visit(s.run, s.at, s.up);

    while (queue.length > 0) {
      const { run, at, up } = queue.pop()!;
      // The other way's edges this run reaches across, and their runs that hold this run's line.
      const [edges, map] = up ? [ys, acrosses] : [xs, ups];
      let i = lowerBound(edges, run[0] - tolerance);

      for (; i < edges.length && edges[i]! <= run[1] + tolerance; i++) {
        if (++work > SCHEDULE_LIMITS.sides * 20)
          fail("its lines meet each other more often than a schedule's do");
        const other = runAt(map.get(edges[i]!) ?? [], at, tolerance);

        if (other !== undefined) visit(other, edges[i]!, !up);
      }
    }

    return reached;
  };

  const seeds: { run: [number, number]; at: number; up: boolean }[] = [];

  for (const [edges, map, up] of [
    [xs, ups, true],
    [ys, acrosses, false],
  ] as const)
    for (const e of [edges[0], edges[edges.length - 1]])
      if (e !== undefined) for (const run of map.get(e) ?? []) seeds.push({ run, at: e, up });
  walk(seeds, seen);

  // What stands apart is a tag, a rule or a box a cell holds; lines apart that make two cells or
  // more, are a schedule the outside does not reach, as inside a
  // frame drawn clear of it, and the read refuses them rather than guess.
  const apart = new Set<[number, number]>();

  for (const [map, up] of [
    [ups, true],
    [acrosses, false],
  ] as const)
    for (const [at, runs] of map)
      for (const run of runs) {
        if (seen.has(run) || apart.has(run)) continue;
        const part = walk([{ run, at, up }], apart);

        if (part.xs.size + part.ys.size >= 5)
          fail(
            "its lines inside stand apart from its outside and make a grid of their own: give a window that holds that grid alone, or join it to its frame",
          );
      }

  const keep = (map: ReadonlyMap<number, [number, number][]>): Map<number, [number, number][]> =>
    new Map(
      [...map].flatMap(([e, runs]): [number, [number, number][]][] => {
        const reached = runs.filter((r) => seen.has(r));

        return reached.length > 0 ? [[e, reached]] : [];
      }),
    );

  return [keep(ups), keep(acrosses)];
}

/** The edges a walk of runs reached, each way. */
interface Reached {
  readonly xs: Set<number>;
  readonly ys: Set<number>;
}

/** The first index of `sorted` at or past `v`. */
function lowerBound(sorted: readonly number[], v: number): number {
  let [lo, hi] = [0, sorted.length];

  while (lo < hi) {
    const mid = (lo + hi) >> 1;

    if (sorted[mid]! < v) lo = mid + 1;
    else hi = mid;
  }

  return lo;
}

/** True when a run reaches from one of `across`, in order up, to the next. */
function closesCell(
  runs: readonly [number, number][],
  across: readonly number[],
  tolerance: number,
): boolean {
  for (const [from, to] of runs) {
    let [lo, hi] = [0, across.length];

    while (lo < hi) {
      const mid = (lo + hi) >> 1;

      if (across[mid]! < from - tolerance) lo = mid + 1;
      else hi = mid;
    }

    if (lo + 1 < across.length && across[lo + 1]! <= to + tolerance) return true;
  }

  return false;
}

const styleMaps = new WeakMap<DrawingRead, Map<string, ReadTextStyle>>();

/** The read's text styles by their names as the leading CAD app compares them, made once a read. */
function stylesOf(read: DrawingRead): Map<string, ReadTextStyle> {
  const held = styleMaps.get(read);

  if (held) return held;
  const out = new Map<string, ReadTextStyle>();

  for (const t of Array.isArray(read.textStyles) ? read.textStyles : [])
    if (isString(t?.name) && !out.has(layerKey(t.name))) out.set(layerKey(t.name), t);
  styleMaps.set(read, out);

  return out;
}

/** How long a text is along its line, in its style's font, or undefined where it cannot be told. */
function lengthOf(e: ReadText, style: ReadTextStyle | undefined): number | undefined {
  try {
    const m = measureText({
      // Underline, overline and strike codes draw nothing.
      value: e.value.slice(0, 3_000).replace(/%%[uok]/gi, ""),
      height: e.height,
      ...(isString(style?.font) && { font: style.font }),
      widthFactor: isNumber(e.widthFactor) ? e.widthFactor : 1,
    });

    return Number.isFinite(m.length) ? m.length : undefined;
  } catch {
    return undefined;
  }
}

/** Values within `tolerance` of the next, as one edge each: the value most sides hold. */
function edgesOf(values: readonly number[], tolerance: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  let i = 0;

  while (i < sorted.length) {
    let j = i + 1;

    while (j < sorted.length && sorted[j]! - sorted[j - 1]! <= tolerance) j++;
    let best = sorted[i]!;
    let most = 0;

    for (let k = i; k < j;) {
      let m = k + 1;

      while (m < j && sorted[m]! === sorted[k]!) m++;

      if (m - k > most) [best, most] = [sorted[k]!, m - k];
      k = m;
    }

    out.push(best);
    i = j;
  }

  return out;
}

/** The text of a paragraph's value without its codes, each paragraph a line. */
export function paragraphPlain(value: string): string {
  let out = "";

  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;

    if (c === "{" || c === "}") continue;

    if (c !== "\\") {
      out += c;
      continue;
    }

    const code = value[i + 1];

    if (code === undefined) break;
    i++;

    if (code === "P") out += "\n";
    else if (code === "~") out += " ";
    else if ("\\{}".includes(code)) out += code;
    else if ("ACcfFHQTWpS".includes(code)) {
      const end = value.indexOf(";", i);

      if (code === "S")
        out += value.slice(i + 1, end < 0 ? value.length : end).replace(/[#^]/, "/");
      i = end < 0 ? value.length : end;
    } else if (code === "U" && value[i + 1] === "+") {
      const hex = value.slice(i + 2, i + 6);

      if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 5;
      }
    }
  }

  return out;
}

const isText = (e: ReadEntity): boolean => e.kind === "text" || e.kind === "mtext";

function textOf(e: ReadEntity): string {
  if (e.kind === "mtext") return paragraphPlain(e.value);

  return e.kind === "text" ? e.value : "";
}

/**
 * Reads the schedule a window holds as a grid: the edges its lines and polylines draw across
 * and up and down, and each cell they close, a merged one among them, with the texts inside it.
 * Throws an `EditError` for a window that holds no grid or more than `SCHEDULE_LIMITS`.
 */
export function readSchedule(read: DrawingRead, where: ScheduleWhere): ReadSchedule {
  try {
    return gridOf(read, where).schedule;
  } catch (error) {
    if (error instanceof EditError) throw error;

    return fail(`the read does not hold a schedule's shape: ${String(error)}`);
  }
}

function gridOf(read: DrawingRead, where: ScheduleWhere): Grid {
  if (!isRecord(where)) return fail("give the window that holds it");
  const w = where.window;

  if (!Array.isArray(w) || w.length !== 2 || !isPoint(w[0]) || !isPoint(w[1]))
    return fail("its window is two corners, each [x, y]");
  const [wx0, wx1] = [Math.min(w[0][0], w[1][0]), Math.max(w[0][0], w[1][0])];
  const [wy0, wy1] = [Math.min(w[0][1], w[1][1]), Math.max(w[0][1], w[1][1])];
  const space = spaceOf(read, where.layout);
  const inside: { e: ReadEntity; box: Box }[] = [];
  let looked = 0;

  for (let i = 0; i < space.length; i++) {
    const e = space[i];

    if (!isRecord(e) || !isString(e.handle)) continue;
    const points = pointsOf(e);
    looked += points.length;

    if (looked > SCHEDULE_LIMITS.points)
      return fail(`its space holds more than ${SCHEDULE_LIMITS.points} points`);
    const box = boxOf(points);

    if (box === undefined || box[0] < wx0 || box[1] < wy0 || box[2] > wx1 || box[3] > wy1) continue;

    if (inside.length >= SCHEDULE_LIMITS.entities)
      return fail(`its window holds more than ${SCHEDULE_LIMITS.entities} entities`);
    inside.push({ e, box });
  }

  let least = Infinity;

  for (const { e } of inside)
    if ((e.kind === "text" || e.kind === "mtext") && isNumber(e.height) && e.height > 0)
      least = Math.min(least, e.height);
  const scale = Math.max(Math.abs(wx0), Math.abs(wx1), Math.abs(wy0), Math.abs(wy1), 1);

  // Two edges a twentieth of the smallest text apart are one, as a drawing's are.
  const tolerance = Math.max(
    Number.isFinite(least) ? least / 20 : (wx1 - wx0 + wy1 - wy0) * 1e-6,
    scale * 1e-9,
  );

  const across: Side[] = [];
  const upDown: Side[] = [];

  let sideCount = 0;

  inside.forEach(({ e }, held) => {
    const count = e.kind === "polyline" && Array.isArray(e.points) ? e.points.length : 1;
    sideCount += count;

    if (sideCount > SCHEDULE_LIMITS.sides)
      fail(`its lines have more than ${SCHEDULE_LIMITS.sides} sides`);
    const sides = sidesOf(e);

    for (const [a, b] of sides) {
      if (!isPoint(a) || !isPoint(b)) continue;
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];

      if (Math.abs(dy) <= tolerance && Math.abs(dx) > tolerance)
        across.push({
          at: (a[1] + b[1]) / 2,
          from: Math.min(a[0], b[0]),
          to: Math.max(a[0], b[0]),
          held,
        });
      else if (Math.abs(dx) <= tolerance && Math.abs(dy) > tolerance)
        upDown.push({
          at: (a[0] + b[0]) / 2,
          from: Math.min(a[1], b[1]),
          to: Math.max(a[1], b[1]),
          held,
        });
    }
  });

  // An edge is one whose sides close at least one cell: they run from one edge across it to the
  // next. A short rule inside a cell, which closes none, is what the cell holds.
  let xs = edgesOf(
    upDown.map((s) => s.at),
    tolerance,
  );

  let ys = edgesOf(
    across.map((s) => s.at),
    tolerance,
  );

  const [xRuns, yRuns] = joined(
    runsOf(upDown, xs, tolerance),
    runsOf(across, ys, tolerance),
    tolerance,
  );

  xs = xs.filter((x) => xRuns.has(x));
  ys = ys.filter((y) => yRuns.has(y));

  for (let pass = 0; pass < 16; pass++) {
    const keptX = xs.filter((x) => closesCell(xRuns.get(x) ?? [], ys, tolerance));
    const keptY = ys.filter((y) => closesCell(yRuns.get(y) ?? [], xs, tolerance));

    if (keptX.length === xs.length && keptY.length === ys.length) break;
    [xs, ys] = [keptX, keptY];
  }

  ys = ys.reverse();
  const onX = new Set(xs);
  const onY = new Set(ys);

  const nearKept = (
    sides: readonly Side[],
    edges: readonly number[],
    kept: ReadonlySet<number>,
    runs: ReadonlyMap<number, [number, number][]>,
  ): Side[] =>
    sides.filter((s) => {
      const e = nearestEdge(edges, s.at);

      return (
        e !== undefined &&
        kept.has(e) &&
        Math.abs(e - s.at) <= tolerance &&
        runAt(runs.get(e) ?? [], (s.from + s.to) / 2, tolerance) !== undefined
      );
    });

  const edgeSides = {
    across: nearKept(across, [...ys].reverse(), onY, yRuns),
    upDown: nearKept(upDown, xs, onX, xRuns),
  };

  if (xs.length < 2 || ys.length < 2) return fail("its window holds no grid of lines");

  if (xs.length > SCHEDULE_LIMITS.edges || ys.length > SCHEDULE_LIMITS.edges)
    return fail(`it has more than ${SCHEDULE_LIMITS.edges} edges one way`);
  const [nr, nc] = [ys.length - 1, xs.length - 1];

  if (nr * nc > SCHEDULE_LIMITS.cells)
    return fail(`it has more than ${SCHEDULE_LIMITS.cells} cells of one row and column`);

  const nearest = (edges: readonly number[], v: number): number => {
    let [lo, hi] = [0, edges.length - 1];
    const down = edges[0]! > edges[edges.length - 1]!;

    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;

      if (down ? edges[mid]! >= v : edges[mid]! <= v) lo = mid;
      else hi = mid;
    }

    return Math.abs(edges[lo]! - v) <= Math.abs(edges[hi]! - v) ? lo : hi;
  };

  // What the sides on each edge cover of it, as runs in order, so a wall between two cells is
  // found by the edge it is on.
  const onEdge = (sides: readonly Side[], edges: readonly number[]): [number, number][][] => {
    const out: Side[][] = edges.map(() => []);

    for (const s of sides) out[nearest(edges, s.at)]!.push(s);

    return out.map((list) => {
      const runs: [number, number][] = [];

      for (const s of list.sort((a, b) => a.from - b.from)) {
        const last = runs[runs.length - 1];

        if (last !== undefined && s.from - tolerance <= last[1]) last[1] = Math.max(last[1], s.to);
        else runs.push([s.from, s.to]);
      }

      return runs;
    });
  };

  const ups = onEdge(edgeSides.upDown, xs);
  const acrosses = onEdge(edgeSides.across, ys);

  const covers = (runs: readonly [number, number][], v: number): boolean => {
    let [lo, hi] = [0, runs.length - 1];

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const [from, to] = runs[mid]!;

      if (v < from - tolerance) hi = mid - 1;
      else if (v > to + tolerance) lo = mid + 1;
      else return true;
    }

    return false;
  };

  const parent = Array.from({ length: nr * nc }, (_, i) => i);

  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }

    return i;
  };

  for (let r = 0; r < nr; r++)
    for (let c = 0; c < nc; c++) {
      const i = r * nc + c;

      if (c + 1 < nc && !covers(ups[c + 1]!, (ys[r]! + ys[r + 1]!) / 2))
        parent[root(i)] = root(i + 1);

      if (r + 1 < nr && !covers(acrosses[r + 1]!, (xs[c]! + xs[c + 1]!) / 2))
        parent[root(i)] = root(i + nc);
    }

  const spans = new Map<number, [r0: number, c0: number, r1: number, c1: number, n: number]>();

  for (let i = 0; i < nr * nc; i++) {
    const [r, c] = [Math.floor(i / nc), i % nc];
    const k = root(i);
    const s = spans.get(k);

    if (s === undefined) spans.set(k, [r, c, r, c, 1]);
    else spans.set(k, [s[0], Math.min(s[1], c), r, Math.max(s[3], c), s[4] + 1]);
  }

  const order = [...spans.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  for (const [r0, c0, r1, c1, n] of order)
    if ((r1 - r0 + 1) * (c1 - c0 + 1) !== n)
      return fail(`the cell at row ${r0} and column ${c0} is not a rectangle`);
  const cellAt = new Int32Array(nr * nc);

  order.forEach(([r0, c0, r1, c1], k) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cellAt[r * nc + c] = k;
  });

  const edgesHeld = new Set<number>();

  for (const list of [edgeSides.across, edgeSides.upDown])
    for (const x of list) edgesHeld.add(x.held);

  const held: Held[] = inside.map(({ e, box }, i) => {
    const handle = canonicalHandle(e.handle!);

    if (edgesHeld.has(i)) return { entity: e, handle, box, edge: true };
    const [x, y] = placeOf(e, box, stylesOf(read));

    if (!Number.isFinite(x) || !Number.isFinite(y)) return { entity: e, handle, box, edge: false };

    // A text beside the columns, in the rows' height, is in a column no line closes.
    if (isText(e) && y < ys[0]! && y > ys[nr]! && (x < xs[0]! || x > xs[nc]!))
      fail(
        `the text ${JSON.stringify(textOf(e))} is beside its columns, in a column no line up and down closes`,
      );
    const c = x < xs[0]! || x > xs[nc]! ? -1 : Math.min(Math.max(nearestBelow(xs, x), 0), nc - 1);
    const r = y > ys[0]! || y < ys[nr]! ? -1 : Math.min(Math.max(nearestAbove(ys, y), 0), nr - 1);

    if (c < 0 || r < 0) return { entity: e, handle, box, edge: false };

    return { entity: e, handle, box, edge: false, cell: cellAt[r * nc + c]! };
  });

  const byCell: Held[][] = order.map(() => []);

  for (const h of held) if (h.cell !== undefined) byCell[h.cell]!.push(h);

  const cells: ScheduleCell[] = order.map(([r0, c0, r1, c1], k) => {
    const mine = byCell[k]!;

    const texts = mine
      .filter((h) => isText(h.entity))
      .sort((a, b) => b.box[3] - a.box[3] || a.box[0] - b.box[0]);

    return {
      row: r0,
      column: c0,
      rows: r1 - r0 + 1,
      columns: c1 - c0 + 1,
      box: [
        [xs[c0]!, ys[r1 + 1]!],
        [xs[c1 + 1]!, ys[r0]!],
      ],
      text: texts.map((h) => textOf(h.entity)).join("\n"),
      handles: [
        ...texts.map((h) => h.handle),
        ...mine.filter((h) => !isText(h.entity)).map((h) => h.handle),
      ],
    };
  });

  return {
    schedule: {
      window: [
        [wx0, wy0],
        [wx1, wy1],
      ],
      ...(where.layout !== undefined && { layout: where.layout }),
      columns: xs,
      rows: ys,
      cells,
      handles: held.map((h) => h.handle),
    },
    held,
    tolerance,
    across: edgeSides.across,
  };
}

/** The index of the last edge at or left of `v`, of edges left to right. */
function nearestBelow(edges: readonly number[], v: number): number {
  let [lo, hi] = [0, edges.length - 1];

  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;

    if (edges[mid]! <= v) lo = mid;
    else hi = mid - 1;
  }

  return lo;
}

/** The index of the last edge at or above `v`, of edges top to bottom. */
function nearestAbove(edges: readonly number[], v: number): number {
  let [lo, hi] = [0, edges.length - 1];

  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;

    if (edges[mid]! >= v) lo = mid;
    else hi = mid - 1;
  }

  return lo;
}

/** What a row added makes: the statements, and the copies of the row beside it. */
export interface RowPlan {
  /** What lies below the row, moved down by the new row's height. */
  readonly below: readonly string[];
  /** What spans the row's bottom edge, stretched by a window to the edge. */
  readonly spanning: readonly string[];
  readonly window: readonly [Point, Point];
  readonly by: Point;
  /** What a cell that grows holds, moved to keep its place in the cell: each move by its offset. */
  readonly within: readonly { readonly handles: readonly string[]; readonly by: Point }[];
  /** Each copy, with its new value where the row gives one, moved by `by` or else the row's height. */
  readonly copies: readonly {
    readonly entity: ReadEntity;
    readonly value?: string;
    readonly by?: number;
  }[];
  readonly space: string | undefined;
}

/**
 * How far what a cell that grows by `h` holds moves to keep its place: none in the top third of
 * the cell, half the row in the middle third, the whole row in the bottom third.
 */
function keptPlace(y: number, cell: ScheduleCell, h: number): number {
  const [y0, y1] = [cell.box[0][1], cell.box[1][1]];
  const third = (y1 - y0) / 3;

  if (y >= y1 - third) return 0;

  return y <= y0 + third ? -h : -h / 2;
}

/** The plan of a row added to the schedule `where` holds in `read`. */
export function rowPlan(read: DrawingRead, where: ScheduleWhere, row: ScheduleRow): RowPlan {
  if (!isRecord(row)) return fail("a row is { after, cells }");
  const grid = gridOf(read, where);
  const { schedule, held, tolerance: tol } = grid;
  const nr = schedule.rows.length - 1;
  const k = row.after;

  if (!isNumber(k) || !Number.isInteger(k) || k < 0 || k >= nr)
    return fail(`after is a row from 0 to ${nr - 1}`);

  if (!Array.isArray(row.cells)) return fail("cells is a list of the row's values");
  const [t, b] = [schedule.rows[k]!, schedule.rows[k + 1]!];
  const h = t - b;
  const cells = schedule.cells;

  const mine = cells
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.row <= k && k < c.row + c.rows)
    .sort((x, y) => x.c.column - y.c.column);

  if (row.cells.length !== mine.length)
    return fail(
      `row ${k} has ${mine.length} cells, ${JSON.stringify(mine.map(({ c }) => c.text))}, and the row gives ${row.cells.length} values`,
    );
  const values = new Map<number, string | undefined>();

  mine.forEach(({ c, i }, n) => {
    const v: unknown = row.cells[n];

    if (v === undefined) {
      values.set(i, undefined);

      return;
    }

    if (!isString(v))
      return fail(`the value of cell ${n} is a string, or undefined for the cell above's`);

    if (c.rows > 1)
      fail(`cell ${n} spans more than row ${k}, grows by the new row, and takes no value`);
    values.set(i, v);
  });

  const below: string[] = [];
  const spanning: string[] = [];
  const within = new Map<number, string[]>();
  const copies: { entity: ReadEntity; value?: string; by?: number }[] = [];
  const kept = new Set<number>();
  const moved = new Set<number>();
  /** What each merged cell that grows holds, by the cell. */
  const growing = new Map<number, Held[]>();
  const texts = new Set(held.filter((x) => isText(x.entity)).map((x) => x.handle));

  const textCount = new Map(
    mine.map(({ c, i }) => [i, c.handles.filter((hd) => texts.has(hd)).length]),
  );

  for (const { c } of mine)
    if (c.rows > 1 && c.row + c.rows - 1 === k)
      fail(
        `the cell ${JSON.stringify(c.text)} spans rows ${c.row} to ${k} and ends on row ${k}'s foot, so whether the new row joins it is not clear: add the row below another`,
      );

  /** True for an entity of row `k`'s own band, not one on its top edge alone. */
  const ofRow = (box: Box): boolean =>
    box[1] >= b - tol &&
    box[3] <= t + tol &&
    !(box[3] - box[1] <= tol && Math.abs(box[1] - t) <= tol);

  held.forEach((x, n) => {
    const [, y0, , y1] = x.box;

    if (x.cell !== undefined) {
      const c = cells[x.cell]!;
      const last = c.row + c.rows - 1;

      if (c.row > k) {
        below.push(x.handle);
        moved.add(n);
      } else if (last < k) return;
      else if (c.rows === 1) {
        const v = values.get(x.cell);
        const text = texts.has(x.handle);
        const count = textCount.get(x.cell) ?? 0;

        if (text && v === "") return;

        if (text && v !== undefined && count > 1)
          fail(
            `cell ${JSON.stringify(c.text)} holds ${count} texts; give it undefined to copy them`,
          );
        copies.push({ entity: x.entity, ...(text && v !== undefined && { value: v }) });
        kept.add(n);
      } else {
        const list = growing.get(x.cell) ?? [];
        list.push(x);
        growing.set(x.cell, list);
      }

      return;
    }

    if (ofRow(x.box)) {
      copies.push({ entity: x.entity });
      kept.add(n);
    } else if (y1 <= b + tol) {
      below.push(x.handle);
      moved.add(n);
    } else if (y0 >= t - tol) return;
    else if (y0 <= b + tol) {
      spanning.push(x.handle);
      moved.add(n);
    } else fail(`${x.handle} ends inside row ${k}`);
  });

  // What a merged cell holds moves together, by the third of the cell the middle of all of it is in.
  for (const [i, list] of growing) {
    let [y0, y1] = [Infinity, -Infinity];

    for (const x of list) {
      const y = placeOf(x.entity, x.box, stylesOf(read))[1];

      if (Number.isFinite(y)) [y0, y1] = [Math.min(y0, y), Math.max(y1, y)];
    }

    const dy = Number.isFinite(y0) ? keptPlace((y0 + y1) / 2, cells[i]!, h) : -h / 2;

    if (dy !== 0) {
      const handles = within.get(dy) ?? [];

      for (const x of list) handles.push(x.handle);
      within.set(dy, handles);
    }
  }

  // A cell given text, with no text of its own whose format it takes.
  for (const { c, i } of mine) {
    const v = values.get(i);

    if (c.rows === 1 && v !== undefined && v !== "" && textCount.get(i) === 0)
      fail(`cell ${c.column} of row ${k} holds no text whose format the new one takes`);
  }

  // The row's bottom edge, at b, and the new row's, at b less h, each where a cell of the row
  // closes there: drawn by what the row keeps and copies, and what moves down from b. Where
  // nothing draws a part of either, a line in the pen of what drew it at b does.
  const atB = grid.across.filter((x) => Math.abs(x.at - b) <= tol);

  const closes = mine
    .filter(({ c }) => c.rows === 1)
    .map(({ c }): [number, number] => [c.box[0][0], c.box[1][0]]);

  const pieces = painted(atB);

  for (const [y, by, drawn] of [
    [b, 0, atB.filter((x) => kept.has(x.held))],
    [b, -h, atB.filter((x) => kept.has(x.held) || moved.has(x.held))],
  ] as const)
    for (let p = 0, gaps = gapsOf(closes, drawn, tol), g = 0; g < gaps.length; g++) {
      const [g0, g1] = gaps[g]!;

      while (p < pieces.length && pieces[p]!.to <= g0 + tol) p++;

      // Each part of a gap, in the pen of the side that drew it there.
      for (let q = p; q < pieces.length && pieces[q]!.from < g1 - tol; q++) {
        const side = pieces[q]!;
        const [from, to] = [Math.max(g0, side.from), Math.min(g1, side.to)];

        if (to - from <= tol) continue;
        const pen = held[side.held]!.entity;

        copies.push({
          entity: {
            ...penFields(pen),
            kind: "line",
            layer: pen.layer,
            from: [from, y],
            to: [to, y],
          },
          by,
        });
      }
    }

  const [w0, w1] = schedule.window;

  return {
    below,
    spanning,
    window: [
      [w0[0], w0[1]],
      [w1[0], b + tol],
    ],
    by: [0, -h],
    within: [...within].map(([dy, handles]) => ({ handles, by: [0, dy] })),
    copies,
    space: schedule.layout,
  };
}

/** The line `sides` draw, as pieces in order that do not overlap, each from the first side there. */
function painted(sides: readonly Side[]): Side[] {
  const out: Side[] = [];
  let cursor = -Infinity;

  for (const side of [...sides].sort((a, b) => a.from - b.from)) {
    const from = Math.max(side.from, cursor);

    if (side.to > from) out.push({ ...side, from });
    cursor = Math.max(cursor, side.to);
  }

  return out;
}

/** The parts of `spans` that no side of `sides` covers, each longer than `tol`, in order. */
function gapsOf(
  spans: readonly (readonly [number, number])[],
  sides: readonly Side[],
  tol: number,
): [number, number][] {
  const pieces = painted(sides);
  const out: [number, number][] = [];
  let p = 0;

  for (const [from, to] of [...spans].sort((a, b) => a[0] - b[0])) {
    let x = from;

    while (p < pieces.length && pieces[p]!.to <= x + tol) p++;

    for (let q = p; q < pieces.length && pieces[q]!.from < to - tol; q++) {
      if (pieces[q]!.from > x + tol) out.push([x, pieces[q]!.from]);
      x = Math.max(x, pieces[q]!.to);
    }

    if (x < to - tol) out.push([x, to]);
  }

  // Gaps that meet are one line.
  return out.reduce<[number, number][]>((list, g) => {
    const last = list[list.length - 1];

    if (last !== undefined && g[0] <= last[1] + tol) last[1] = Math.max(last[1], g[1]);
    else list.push([g[0], g[1]]);

    return list;
  }, []);
}

/** The pen of an entity, as a read holds it, for a line drawn in it. */
function penFields(e: ReadEntity): Partial<ReadEntity> {
  return {
    ...(e.color !== undefined && { color: e.color }),
    ...(e.trueColor !== undefined && { trueColor: e.trueColor }),
    ...(e.alpha !== undefined && { alpha: e.alpha }),
    ...(e.linetype !== undefined && { linetype: e.linetype }),
    ...(e.lineweight !== undefined && { lineweight: e.lineweight }),
    ...(e.linetypeScale !== undefined && { linetypeScale: e.linetypeScale }),
  };
}

/** A single-line text's value with its text made `text`, the codes it opens and ends with kept. */
export function textWith(value: string, text: string): string {
  const code = (at: number): boolean =>
    value.startsWith("%%", at) && "uUoOkK".includes(value[at + 2] ?? "");

  let open = 0;

  while (open + 3 <= value.length && code(open)) open += 3;
  let close = value.length;

  while (close - 3 >= open && code(close - 3)) close -= 3;

  return `${value.slice(0, open)}${text}${value.slice(close)}`;
}

/** A paragraph's value with its text made `text`: the codes it opens with and the braces they close kept. */
export function paragraphWith(value: string, text: string): string {
  const open = /^(?:\{|\\[ACcfFHQTWp][^;\\{}]*;|\\[LlOoKk])*/.exec(value)?.[0] ?? "";
  const braces = [...open].filter((c) => c === "{").length;

  return `${open}${plain(text).replaceAll("\n", "\\P")}${"}".repeat(braces)}`;
}

/** An entity's own pen, as the builder takes it. */
interface Pen {
  readonly color?: EntityColor;
  readonly transparency?: EntityTransparency;
  readonly linetype?: string;
  readonly lineweight?: number | "ByBlock" | "Default";
  readonly linetypeScale?: number;
}

function colorOf(e: ReadEntity): EntityColor | undefined {
  if (e.trueColor !== undefined)
    return [(e.trueColor >> 16) & 255, (e.trueColor >> 8) & 255, e.trueColor & 255];

  if (e.color === 0) return "ByBlock";

  return e.color !== undefined && e.color !== 256 ? e.color : undefined;
}

/** A lineweight as the read holds it, in hundredths, made the builder's: -1 is by layer. */
function lineweightOf(lw: number): number | "ByBlock" | "Default" {
  if (lw === -2) return "ByBlock";

  if (lw === -3) return "Default";

  return lw / 100;
}

function penOf(e: ReadEntity): Pen {
  const color = colorOf(e);
  const lw = e.lineweight;

  return {
    ...(color !== undefined && { color }),
    ...(e.alpha !== undefined && {
      transparency: e.alpha === "ByBlock" ? "ByBlock" : Math.round(100 - e.alpha / 2.55),
    }),
    ...(e.linetype !== undefined && { linetype: e.linetype }),
    ...(lw !== undefined && lw !== -1 && { lineweight: lineweightOf(lw) }),
    ...(e.linetypeScale !== undefined && { linetypeScale: e.linetypeScale }),
  };
}

const PARAGRAPH_ALIGN = ["left", "center", "right"] as const;
const PARAGRAPH_VALIGN = ["top", "middle", "bottom"] as const;

/** Draws a copy of a schedule's entity moved by `dy`, with a new value where one is given. */
export function drawCopy(
  d: EditDrawing,
  e: ReadEntity,
  dy: number,
  value: string | undefined,
  styles: readonly ReadTextStyle[],
): void {
  const at = (p: Point): Point => [p[0], p[1] + dy];
  const pen = penOf(e);

  d.layer(e.layer, () => {
    switch (e.kind) {
      case "line":
        d.line(at(e.from), at(e.to), pen);
        break;
      case "polyline":
        d.polyline(e.points.map(at), e.closed, {
          ...pen,
          ...(e.bulges !== undefined && { bulges: e.bulges }),
          ...(e.width !== undefined && { width: e.width }),
          ...(e.widths !== undefined && { widths: e.widths }),
          ...(e.linetypeGeneration && { linetypeGeneration: true }),
        });
        break;
      case "circle":
        d.circle(at(e.center), e.radius, pen);
        break;
      case "arc":
        d.arc(at(e.center), e.radius, e.start, e.end, pen);
        break;
      case "ellipse":
        if (e.startParameter !== undefined || e.endParameter !== undefined)
          fail(`${e.handle} is part of an ellipse, which a row does not copy yet`);
        d.ellipse(at(e.center), e.majorAxis, e.ratio, pen);
        break;
      case "mtext":
        copyParagraph(d, e, at, value, pen);
        break;
      case "text":
        copyText(d, e, at, value, pen, styles);
        break;
      default:
        fail(
          `a row copies lines, polylines, circles, arcs, ellipses, texts and paragraph text, and its row holds a ${e.kind}, ${e.handle}`,
        );
    }
  });
}

function copyParagraph(
  d: EditDrawing,
  e: ReadMtext,
  at: (p: Point) => Point,
  value: string | undefined,
  pen: Pen,
): void {
  if (e.mask?.trueColor !== undefined)
    fail(`${e.handle} has a mask of a true color, which a row does not copy yet`);
  const a = Math.min(Math.max(Math.trunc(e.attachment), 1), 9) - 1;

  d.paragraph(value === undefined ? e.value : paragraphWith(e.value, value), {
    ...pen,
    at: at(e.at),
    height: e.height,
    style: e.style,
    ...(e.width > 0 && { width: e.width }),
    ...(e.rotation !== 0 && { rotation: e.rotation }),
    align: PARAGRAPH_ALIGN[a % 3]!,
    valign: PARAGRAPH_VALIGN[Math.floor(a / 3)]!,
    ...(e.lineSpacing !== 1 && { lineSpacing: e.lineSpacing }),
    lineSpacingStyle: e.lineSpacingStyle,
    ...(e.columns !== undefined && { columns: e.columns }),
    ...(e.mask !== undefined && {
      mask:
        e.mask.color === undefined
          ? { offsetFactor: e.mask.offsetFactor }
          : { offsetFactor: e.mask.offsetFactor, color: e.mask.color },
    }),
  });
}

function copyText(
  d: EditDrawing,
  e: ReadText,
  at: (p: Point) => Point,
  value: string | undefined,
  pen: Pen,
  styles: readonly ReadTextStyle[],
): void {
  const style = styles.find((s) => layerKey(s.name) === layerKey(e.style));

  if (
    e.align === "aligned" ||
    e.align === "fit" ||
    e.align === "middle" ||
    e.backward === true ||
    e.upsideDown === true ||
    (e.widthFactor ?? 1) !== (style?.widthFactor ?? 1) ||
    (e.oblique ?? 0) !== (style?.oblique ?? 0)
  )
    fail(
      `${e.handle} is a text aligned, fitted or justified middle, mirrored, or of a width or slant its style does not give, which a row does not copy yet`,
    );
  d.text(at(e.alignAt ?? e.at), value === undefined ? e.value : textWith(e.value, value), {
    ...pen,
    height: e.height,
    style: e.style,
    ...(e.rotation !== 0 && { rotation: e.rotation }),
    ...((e.align === "center" || e.align === "right") && { align: e.align }),
    ...(e.valign !== undefined && { valign: e.valign }),
  });
}
