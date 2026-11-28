// The edit of a firm's drawing: the file it names by path and hash, and what it changes. An
// `Edit` round-trips through JSON as a `Drawing` does, so a worker of its own, or a service,
// can take one with the file's bytes.
import { canonical } from "../json.ts";
import { holdCall, readCall, type CallSite, type HeldCall } from "../callsite.ts";
import {
  createDrawingInFile,
  type Drawing,
  type DrawingBuilder,
  type Entity,
  type Point,
  type Units,
} from "../drawing.ts";
import { isFunction, isRecord, isString } from "../guards.ts";
import { layerKey } from "../layers.ts";
import type { DrawingRead, ReadPart } from "../read/model.ts";
import type { Standard } from "../standard/document.ts";
import { fileTables, type FileTables } from "./file-tables.ts";
import { drawCopy, rowPlan, type ScheduleRow, type ScheduleWhere } from "./schedule.ts";
import {
  copyTextChange,
  entityChangesProblem,
  layerChangesProblem,
  viewportChangesProblem,
} from "./change-shape.ts";

/** The version of the `Edit` format. Format 0 carries no promise of stability. */
export const EDIT_FORMAT = 0;

export interface Edit {
  readonly format: typeof EDIT_FORMAT;
  /** The path of the file, from the edit file. */
  readonly file: string;
  /** The SHA-256 of the bytes the edit was planned on, as `DrawingRead.sha256` gives it. */
  readonly sha256: string;
  /** What scopes the edit's marks: an id's characters, 1 to 64. */
  readonly name: string;
  /** The units of a file whose `$INSUNITS` is 0. Refused for any other. */
  readonly units?: Units;
  /** The sheets that show a model file through an xref, by their paths from the edit file. */
  readonly sheets?: readonly string[];
  /** What the edit's read keeps of the file, as `ReadOptions.only` takes it. */
  readonly only?: ReadPart;
  readonly statements: readonly EditStatement[];
  readonly additions?: EditAdditions;
}

export type EditStatement =
  | { readonly kind: "erase"; readonly handles: readonly string[] }
  | { readonly kind: "move"; readonly handles: readonly string[]; readonly transform: Transform }
  | { readonly kind: "change"; readonly handle: string; readonly changes: EntityChanges }
  | { readonly kind: "layer"; readonly name: string; readonly changes: LayerChanges }
  | { readonly kind: "viewport"; readonly handle: string; readonly changes: ViewportChanges }
  | {
      readonly kind: "stretch";
      readonly handles: readonly string[];
      readonly window: readonly [Point, Point];
      readonly by: Point;
    }
  | {
      readonly kind: "vertices";
      readonly handle: string;
      readonly points: readonly Point[];
      readonly bulges?: readonly number[];
    };

/** What a stretch takes: the window, by two opposite corners, and how far its points move. */
export interface StretchBy {
  readonly window: readonly [Point, Point];
  readonly by: Point;
}

/**
 * A polyline's vertices: its points, and the bulge of each side, one for each as the read gives
 * them, an open polyline's one fewer than its points. Without them each side keeps its own.
 */
export interface Vertices {
  readonly points: readonly Point[];
  readonly bulges?: readonly number[];
}

/** Scale and turn about `about`, then move by `by`. */
export interface Transform {
  readonly by?: Point;
  readonly about?: Point;
  /** Degrees counterclockwise. */
  readonly rotate?: number;
  readonly scale?: number;
}

export interface EntityChanges {
  /** Not made yet: move the entity in a statement of its own. */
  readonly move?: Transform;
  /** A text's or paragraph text's value: the whole value, with its codes, or one replacement. */
  readonly text?: TextChange;
  /** A text's height, and paragraph text's height and the width it wraps at, 0 for none. */
  readonly height?: number;
  readonly width?: number;
  /**
   * A multileader's note box, as tall as its text: the box the file stores can be taller, and the
   * leading CAD app sizes the note's mask by it. Only 0, which fits the box to the text, is set.
   */
  readonly boxHeight?: 0;
  /** An insert's attributes, by tag. */
  readonly attributes?: Readonly<Record<string, TextChange>>;
  readonly layer?: string;
  /** A color index: 1 to 255, 0 for ByBlock or 256 for ByLayer. */
  readonly color?: number;
  /** A true color, 0xRRGGBB. */
  readonly trueColor?: number;
  /** A linetype the file holds, `ByLayer` or `ByBlock`. */
  readonly linetype?: string;
  /** Hundredths of a millimetre, as the read gives them, or `ByLayer`, `ByBlock` or `Default`. */
  readonly lineweight?: number | "ByLayer" | "ByBlock" | "Default";
  readonly linetypeScale?: number;
}

/** The whole value, with its codes, or the first and only place `from` reads, made `to`. */
export type TextChange = string | { readonly replace: readonly [from: string, to: string] };

export interface LayerChanges {
  readonly on?: boolean;
  readonly frozen?: boolean;
  readonly locked?: boolean;
  readonly plot?: boolean;
  /** A color index, 1 to 255. */
  readonly color?: number;
  /** A true color, 0xRRGGBB. */
  readonly trueColor?: number;
  readonly linetype?: string;
  /** Hundredths of a millimetre, as the read gives them, or `Default`. */
  readonly lineweight?: number | "Default";
}

export interface ViewportChanges {
  readonly center?: Point;
  /** Paper units to drawing units, as a view's ratio. */
  readonly ratio?: number;
  /** Degrees counterclockwise. */
  readonly twist?: number;
  readonly on?: boolean;
  /** Layers frozen in the viewport: to add, and to take out. */
  readonly freeze?: readonly string[];
  readonly thaw?: readonly string[];
}

export interface EditAdditions {
  readonly model: readonly Entity[];
  readonly layouts: Readonly<Record<string, readonly Entity[]>>;
  /** What the additions use that the file lacks: layers, linetypes, styles, blocks, images. */
  readonly definitions: EditDefinitions;
}

export type EditDefinitions = Partial<
  Pick<
    Drawing,
    | "layers"
    | "linetypes"
    | "textStyles"
    | "blocks"
    | "dimensionStyles"
    | "leaderStyles"
    | "tableStyles"
    | "patterns"
  >
>;

/** What an edit file states before its edit is built: the file, and what judges its additions. */
export interface EditSource {
  readonly file: string;
  readonly sha256: string;
  readonly name: string;
  readonly standard?: Standard;
  readonly units?: Units;
  readonly sheets?: readonly string[];
  /** What the edit's read keeps of the file, as `ReadOptions.only` takes it. */
  readonly only?: ReadPart;
}

/**
 * The builder an edit file's function is given. Each of its methods makes one statement, which
 * records its call, so a diagnostic names the line that made it. A handle is the hexadecimal
 * digits the read gives, in any case.
 */
export interface EditBuilder {
  /**
   * Erases each entity, with what it owns: an insert's attributes, a 2D polyline's vertices, a
   * dimension's picture and an image's reactor.
   */
  erase(...handles: string[]): void;
  /**
   * Scales each entity by `scale` and turns it by `rotate` degrees counterclockwise, both about
   * `about`, then moves it by `by`. An insert moves with its attributes, a dimension with its
   * picture, and a viewport with the entity that clips it.
   */
  move(handles: readonly string[], transform: Transform): void;
  /**
   * Draws additions in model space, with the drawing builder over the file's own layers, styles
   * and blocks, in the file's units. A name the file holds is the file's: an addition uses it as
   * the file defines it, and a name it lacks is defined by the edit.
   */
  model(draw: (d: EditDrawing) => void): void;
  /** Draws additions on the paper of the file's layout `name`, in the layout's own units. */
  layout(name: string, draw: (sheet: EditDrawing) => void): void;
  /**
   * Stretches each entity as the leading CAD app's STRETCH does by a crossing window: each of its
   * points inside `window`, its edge among it, moves by `by`, and a side whose one end moves keeps
   * its arc's height. An insert, a text, paragraph text, a circle and a point move whole when the
   * point they are placed by is inside, and an entity whose points are all inside moves as `move`
   * moves it.
   */
  stretch(handles: readonly string[], stretch: StretchBy): void;
  /** Sets a light or a 2D polyline's points, and its bulges where they are given. */
  vertices(handle: string, vertices: Vertices): void;
  /**
   * Changes an entity in place: its text, an insert's attributes by tag, its height and width,
   * and its pen. A text keeps its record, its style and its formats.
   */
  change(handle: string, changes: EntityChanges): void;
  /** Changes a layer by its name, an xref's `XREF|LAYER` among them, as a host overrides it. */
  layer(name: string, changes: LayerChanges): void;
  /** Re-aims a viewport, turns it on or off, and freezes or thaws layers in it alone. */
  viewport(handle: string, changes: ViewportChanges): void;
  /**
   * Adds a row to the schedule `readSchedule` read, below the row `row.after`: what lies below
   * moves down by that row's height, what spans the row's bottom edge, such as a frame or a
   * merged cell, stretches to it, and the row's own lines, polylines, circles and texts are drawn
   * again in the new row in their own layers, styles and pens, each text with the new row's value.
   * It makes a move, a stretch and additions, read again from the file by the schedule's window.
   */
  row(schedule: ScheduleWhere, row: ScheduleRow): void;
}

/** The drawing builder an edit's additions are drawn with, over the file's definitions. */
export type EditDrawing = DrawingBuilder<"R2018", number, undefined, string, string>;

/** What `editDrawing` returns, which the command recognizes as an edit file's default export. */
export interface EditFile {
  readonly source: EditSource;
  /** The edit, given the file's read, which the function is handed when it first reads it. */
  build(read: DrawingRead | (() => DrawingRead)): Edit;
}

/** Thrown by a writer for an edit it cannot make, naming the statement where there is one. */
export class EditError extends Error {
  /** The place of the statement in `statements`, where one is at fault. */
  readonly statement: number | undefined;
  constructor(message: string, statement?: number) {
    super(message);
    this.name = "EditError";
    this.statement = statement;
  }
}

/**
 * An edit of a firm's file: `source` names the file, by its path from the edit file and the
 * SHA-256 of the bytes it was planned on, and `edit` states what changes. `read` is the file's
 * read with geometry, read only when the function first uses it.
 */
export function editDrawing(
  source: EditSource,
  edit: (e: EditBuilder, read: DrawingRead) => void = () => {},
): EditFile {
  return {
    source,
    build(read) {
      const statements: EditStatement[] = [];
      const calls: (HeldCall | undefined)[] = [];

      const fail = (message: string): never => {
        throw new EditError(message, statements.length);
      };

      const handlesOf = (list: readonly string[], what: string): string[] => {
        if (!Array.isArray(list) || list.length > EDIT_LIMITS.handles)
          return fail(`${what} takes a list of at most ${EDIT_LIMITS.handles} handles`);
        const out: string[] = [];

        for (let i = 0; i < list.length; i++) {
          const h: unknown = list[i];

          if (!isHandle(h))
            return fail(`${what}: ${JSON.stringify(String(h).slice(0, 40))} is not a handle`);
          out.push(canonicalHandle(h));
        }

        return out;
      };

      let tables: FileTables | undefined;
      let loaded: DrawingRead | undefined;
      const spaces = new Map<string, { readonly name: string; readonly d: EditDrawing }>();

      const loadedRead = (): DrawingRead => (loaded ??= isFunction(read) ? read() : read);

      /** The builder of a space, model space by `undefined`, made when first drawn in. */
      const drawing = (layout: string | undefined): EditDrawing => {
        const key = layout === undefined ? "" : layoutKey(layout);
        const held = spaces.get(key);

        if (held) return held.d;
        const r = loadedRead();
        let units: Units;

        if (layout === undefined) units = unitsOf(r, source.units, fail);
        else {
          const found = r.layouts.find((l) => layoutKey(l.name) === key);

          if (found === undefined)
            return fail(
              `layout: the file has no layout ${JSON.stringify(layout)}, and an edit adds no layout`,
            );
          units = found.paperUnits === 1 ? "mm" : "in";
        }

        tables ??= fileTables(r);

        const d = createDrawingInFile({ units, standard: source.standard }, tables);

        spaces.set(key, {
          name:
            layout === undefined
              ? ""
              : (r.layouts.find((l) => layoutKey(l.name) === key)?.name ?? layout),
          d,
        });

        return d;
      };

      const builder: EditBuilder = {
        erase(...handles) {
          const list = handlesOf(handles, "erase");
          calls.push(holdCall(builder.erase));
          statements.push({ kind: "erase", handles: list });
        },
        move(handles, transform) {
          const list = handlesOf(handles, "move");
          const problem = transformProblem(transform);

          if (problem !== undefined) fail(`move: ${problem}`);
          calls.push(holdCall(builder.move));
          statements.push({ kind: "move", handles: list, transform: copyTransform(transform) });
        },
        model(draw) {
          draw(drawing(undefined));
        },
        layout(name, draw) {
          if (!isString(name)) fail("layout takes the name of one of the file's layouts");
          draw(drawing(name));
        },
        stretch(handles, stretch) {
          const list = handlesOf(handles, "stretch");
          const problem = stretchProblem(stretch);

          if (problem !== undefined) fail(`stretch: ${problem}`);
          calls.push(holdCall(builder.stretch));
          const [a, b] = stretch.window;
          statements.push({
            kind: "stretch",
            handles: list,
            window: [
              [a[0], a[1]],
              [b[0], b[1]],
            ],
            by: [stretch.by[0], stretch.by[1]],
          });
        },
        vertices(handle, vertices) {
          const [h] = handlesOf([handle], "vertices");
          const problem = verticesProblem(vertices);

          if (problem !== undefined) fail(`vertices: ${problem}`);
          calls.push(holdCall(builder.vertices));
          statements.push({
            kind: "vertices",
            handle: h!,
            points: vertices.points.map((p): Point => [p[0], p[1]]),
            ...(vertices.bulges !== undefined && { bulges: [...vertices.bulges] }),
          });
        },
        change(handle, changes) {
          const [h] = handlesOf([handle], "change");
          const problem = entityChangesProblem(changes);

          if (problem !== undefined) fail(`change: ${problem}`);
          calls.push(holdCall(builder.change));
          statements.push({ kind: "change", handle: h!, changes: copyEntityChanges(changes) });
        },
        layer(name, changes) {
          if (!isString(name) || name === "" || name.length > 255)
            fail("layer: the layer's name is not 1 to 255 characters");
          const problem = layerChangesProblem(changes);

          if (problem !== undefined) fail(`layer: ${problem}`);
          calls.push(holdCall(builder.layer));
          statements.push({ kind: "layer", name, changes: { ...changes } });
        },
        row(schedule, row) {
          let plan: ReturnType<typeof rowPlan>;

          try {
            plan = rowPlan(loadedRead(), schedule, row);
          } catch (error) {
            return fail(error instanceof Error ? `row: ${error.message}` : "row: refused");
          }

          const call = holdCall(builder.row);

          const move = (handles: readonly string[], by: Point): void => {
            calls.push(call);
            statements.push({ kind: "move", handles: [...handles], transform: { by } });
          };

          if (plan.below.length > 0) move(plan.below, plan.by);

          if (plan.spanning.length > 0) {
            calls.push(call);
            statements.push({
              kind: "stretch",
              handles: [...plan.spanning],
              window: [
                [plan.window[0][0], plan.window[0][1]],
                [plan.window[1][0], plan.window[1][1]],
              ],
              by: plan.by,
            });
          }

          for (const w of plan.within) move(w.handles, w.by);

          if (plan.copies.length > 0) {
            const d = drawing(plan.space);
            const styles = loadedRead().textStyles;

            for (const c of plan.copies)
              try {
                drawCopy(d, c.entity, c.by ?? plan.by[1], c.value, styles);
              } catch (error) {
                fail(
                  `row: ${c.entity.handle} is not copied: ${error instanceof Error ? error.message : "refused"}`,
                );
              }
          }
        },
        viewport(handle, changes) {
          const [h] = handlesOf([handle], "viewport");
          const problem = viewportChangesProblem(changes);

          if (problem !== undefined) fail(`viewport: ${problem}`);
          calls.push(holdCall(builder.viewport));
          statements.push({ kind: "viewport", handle: h!, changes: copyViewportChanges(changes) });
        },
      };

      edit(builder, isFunction(read) ? lazy(loadedRead) : read);
      statementCalls.set(statements, calls);
      const additions = spaces.size === 0 ? undefined : additionsOf(spaces, tables!);

      return {
        format: EDIT_FORMAT,
        file: source.file,
        sha256: source.sha256.toLowerCase(),
        name: source.name,
        ...(source.units !== undefined && { units: source.units }),
        ...(source.sheets !== undefined && { sheets: [...source.sheets] }),
        ...(source.only !== undefined && { only: source.only }),
        statements,
        ...(additions !== undefined && { additions }),
      };
    },
  };
}

/** How the leading CAD app compares layout names: as layer names, without regard to case. */
const layoutKey = (name: string): string => layerKey(name);

/** The units of model space, from `$INSUNITS`, or the edit's for a file of none. */
function unitsOf(read: DrawingRead, given: Units | undefined, fail: (m: string) => never): Units {
  const insunits = read.header.insunits ?? 0;
  const file = INSUNITS.get(insunits);

  if (insunits === 0) {
    if (given === undefined)
      return fail("model: the file states no units, $INSUNITS 0, so the edit gives its units");

    return given;
  }

  if (given !== undefined)
    return fail(`units: the file states its units, $INSUNITS ${insunits}, and an edit gives none`);

  if (file === undefined)
    return fail(`model: the file's units, $INSUNITS ${insunits}, are not ones tsdraft draws in`);

  return file;
}

/** The units of `$INSUNITS` tsdraft draws in. */
const INSUNITS = new Map<number, Units>([
  [1, "in"],
  [2, "ft"],
  [4, "mm"],
  [5, "cm"],
  [6, "m"],
]);

/** The definition lists of `EditDefinitions`, and the table of the file each is held in. */
const DEFINITIONS = [
  "layers",
  "linetypes",
  "textStyles",
  "blocks",
  "dimensionStyles",
  "leaderStyles",
  "tableStyles",
  "patterns",
] as const;

/**
 * What the builders of the spaces drew: each space's entities, with the file's own `Standard`
 * styles named as the file names them, and the definitions the file lacks.
 */
function additionsOf(
  spaces: ReadonlyMap<string, { readonly name: string; readonly d: EditDrawing }>,
  tables: FileTables,
): EditAdditions {
  const standIns = new Map<string, string>();

  for (const [key, alias] of tables.aliases)
    standIns.set(layerKey(alias), key.slice(key.indexOf(":") + 1));

  const named = (e: Entity): Entity =>
    "style" in e && isString(e.style) && standIns.has(layerKey(e.style))
      ? { ...e, style: "Standard" }
      : e;

  const held: Readonly<Record<(typeof DEFINITIONS)[number], ReadonlySet<string>>> = {
    layers: new Set(tables.layers.map((x) => layerKey(x.name))),
    linetypes: new Set(tables.linetypes.map((x) => layerKey(x.name))),
    textStyles: new Set(tables.textStyles.map((x) => layerKey(x.name))),
    blocks: new Set(tables.blocks.map((x) => layerKey(x.name))),
    dimensionStyles: new Set(tables.dimensionStyles.map((x) => layerKey(x.name))),
    leaderStyles: new Set(tables.leaderStyles.map((x) => layerKey(x.name))),
    tableStyles: new Set(tables.tableStyles.map((x) => layerKey(x.name))),
    patterns: new Set(),
  };

  let model: readonly Entity[] = [];
  const layouts: Record<string, readonly Entity[]> = {};
  const definitions: Record<string, { readonly name: string }[]> = {};
  // Each definition made, as JSON, by its table and name: the spaces share one of a name.
  const defined = new Map<string, string>();

  for (const [key, { name, d }] of spaces) {
    const built: Drawing = d.build();

    if (key === "") model = built.entities.map(named);
    else layouts[name] = built.entities.map(named);

    for (const table of DEFINITIONS)
      for (const item of built[table] ?? []) {
        const k = `${table}:${layerKey(item.name)}`;

        if (held[table].has(layerKey(item.name))) continue;
        const json = canonical(item);
        const was = defined.get(k);

        if (was !== undefined && was !== json)
          throw new EditError(
            `The spaces define ${JSON.stringify(item.name)} of ${table} otherwise: define it once, the same in each`,
          );

        if (was !== undefined) continue;
        defined.set(k, json);
        (definitions[table] ??= []).push(item);
      }
  }

  // SAFETY: each list holds the builder's own definitions of its table.
  return { model, layouts, definitions: definitions as EditDefinitions };
}

/** The calls that made each edit's statements, by its `statements` array. */
const statementCalls = new WeakMap<readonly EditStatement[], readonly (HeldCall | undefined)[]>();

/** The call that made the statement at `index` of an edit, when its builder recorded it. */
export function statementCall(edit: Edit, index: number): CallSite | undefined {
  return readCall(statementCalls.get(edit.statements)?.[index]);
}

/** A handle as its digits, in capitals and with no leading zero. */
export const canonicalHandle = (handle: string): string =>
  handle.replace(/^0+(?=.)/, "").toUpperCase();

/** A handle's number, or undefined for a value that is not 1 to 16 hexadecimal digits. */
export const handleNumber = (handle: string): bigint | undefined =>
  /^[0-9A-Fa-f]{1,16}$/.test(handle) ? BigInt(`0x${handle}`) : undefined;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const pointLike = (value: unknown): value is Point =>
  Array.isArray(value) && value.length === 2 && finite(value[0]) && finite(value[1]);

/** The most a transform's numbers may be: past it a point would not be written. */
export const MOST_TRANSFORM = 1e15;

/** What is wrong with a value meant as a `Transform`, or undefined when nothing is. */
export function transformProblem(value: Transform): string | undefined {
  if (!isRecord(value)) return "the transform is not an object";

  for (const key in value)
    if (!["by", "about", "rotate", "scale"].includes(key))
      return `the transform holds ${JSON.stringify(key.slice(0, 40))}, which is not by, about, rotate or scale`;

  for (const key of ["by", "about"] as const) {
    const p = value[key];

    if (p === undefined) continue;

    if (!pointLike(p) || Math.abs(p[0]) > MOST_TRANSFORM || Math.abs(p[1]) > MOST_TRANSFORM)
      return `the transform's ${key} is not a point of two finite numbers within ${MOST_TRANSFORM}`;
  }

  const rotate = value["rotate"];

  if (rotate !== undefined && (!finite(rotate) || Math.abs(rotate) > MOST_TRANSFORM))
    return "the transform's rotate is not a finite number of degrees";
  const scale = value["scale"];

  if (scale !== undefined && (!finite(scale) || scale <= 0 || scale > 1e6 || scale < 1e-6))
    return "the transform's scale is not a number from 0.000001 to 1000000";
  // A turn or a scale about the origin would throw a firm's entity far off its sheet.
  const turns = finite(rotate) && rotate % 360 !== 0;

  if ((turns || (scale !== undefined && scale !== 1)) && value["about"] === undefined)
    return "the transform turns or scales, and names no point to do it about: give it about";

  return undefined;
}

const withinTransform = (p: unknown): p is Point =>
  pointLike(p) && Math.abs(p[0]) <= MOST_TRANSFORM && Math.abs(p[1]) <= MOST_TRANSFORM;

/** What is wrong with a value meant as a `StretchBy`, or undefined when nothing is. */
export function stretchProblem(value: StretchBy): string | undefined {
  if (!isRecord(value)) return "the stretch is not { window, by }";

  for (const key in value)
    if (key !== "window" && key !== "by")
      return `the stretch holds ${JSON.stringify(key.slice(0, 40))}, which is not window or by`;
  const w: unknown = value["window"];

  if (!Array.isArray(w) || w.length !== 2 || !withinTransform(w[0]) || !withinTransform(w[1]))
    return `the window is not two points of finite numbers within ${MOST_TRANSFORM}`;
  // SAFETY: both items were just checked to be points.
  const [a, b] = w as [Point, Point];

  if (a[0] === b[0] || a[1] === b[1]) return "the window has no area";

  if (!withinTransform(value["by"]))
    return `by is not a point of two finite numbers within ${MOST_TRANSFORM}`;

  if (value.by[0] === 0 && value.by[1] === 0) return "by moves nothing";

  return undefined;
}

/** The most points a vertices statement gives a polyline. */
export const MOST_VERTICES = 100_000;

/** What is wrong with a value meant as `Vertices`, or undefined when nothing is. */
export function verticesProblem(value: Vertices): string | undefined {
  if (!isRecord(value)) return "the vertices are not { points, bulges }";

  for (const key in value)
    if (key !== "points" && key !== "bulges")
      return `the vertices hold ${JSON.stringify(key.slice(0, 40))}, which is not points or bulges`;
  const points: unknown = value["points"];

  if (!Array.isArray(points) || points.length < 2 || points.length > MOST_VERTICES)
    return `points is not a list of 2 to ${MOST_VERTICES} points`;

  if (!everyOf(points, withinTransform))
    return `a point is not two finite numbers within ${MOST_TRANSFORM}`;
  const bulges: unknown = value["bulges"];

  if (bulges !== undefined) {
    if (!Array.isArray(bulges) || bulges.length > points.length)
      return "bulges is not a list of one number for each side";

    if (!everyOf(bulges, (b) => finite(b) && Math.abs(b) <= MOST_BULGE))
      return `a bulge is not a finite number within ${MOST_BULGE}`;
  }

  return undefined;
}

/** The most a bulge may be: past it a side is a whole circle to the last digit. */
export const MOST_BULGE = 1e6;

const copyTransform = (t: Transform): Transform => ({
  ...(t.by !== undefined && { by: [t.by[0], t.by[1]] satisfies Point }),
  ...(t.about !== undefined && { about: [t.about[0], t.about[1]] satisfies Point }),
  ...(t.rotate !== undefined && { rotate: t.rotate }),
  ...(t.scale !== undefined && { scale: t.scale }),
});

const copyEntityChanges = (c: EntityChanges): EntityChanges => {
  const { text, attributes, move: _, ...rest } = c;
  const tags: Record<string, TextChange> = {};

  for (const tag in attributes) tags[tag] = copyTextChange(attributes[tag]!);

  return {
    ...rest,
    ...(text !== undefined && { text: copyTextChange(text) }),
    ...(attributes !== undefined && { attributes: tags }),
  };
};

const copyViewportChanges = (c: ViewportChanges): ViewportChanges => ({
  ...c,
  ...(c.center !== undefined && { center: [c.center[0], c.center[1]] satisfies Point }),
  ...(c.freeze !== undefined && { freeze: [...c.freeze] }),
  ...(c.thaw !== undefined && { thaw: [...c.thaw] }),
});

/** A read that is loaded when one of its fields is first asked for. */
function lazy(load: () => DrawingRead): DrawingRead {
  let read: DrawingRead | undefined;
  const loaded = (): DrawingRead => (read ??= load());

  // SAFETY: the proxy has no field of its own; each it is asked for comes from the loaded read.
  return new Proxy({} as DrawingRead, {
    // SAFETY: a proxy is asked for any key; indexing reads it from the read as `Reflect.get`
    // would, and gives undefined for a key the read lacks.
    get: (_, key) => loaded()[key as keyof DrawingRead],
    has: (_, key) => Reflect.has(loaded(), key),
    ownKeys: () => Reflect.ownKeys(loaded()),
    getOwnPropertyDescriptor: (_, key) => {
      const d = Reflect.getOwnPropertyDescriptor(loaded(), key);

      return d && { ...d, configurable: true };
    },
  });
}

/** The most statements, handles in all, sheets and additions' keys an edit may hold. */
export const EDIT_LIMITS = {
  statements: 100_000,
  handles: 1_000_000,
  sheets: 1_000,
  /** The most layouts and kinds of definition additions name. */
  keys: 10_000,
  /** The most entities and definitions additions hold in all. */
  additions: 100_000,
} as const;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SHA = /^[0-9a-f]{64}$/;
const HANDLE = /^[0-9A-Fa-f]{1,16}$/;
const UNITS: ReadonlySet<string> = new Set(["in", "ft", "mm", "cm", "m"]);

const KINDS: ReadonlySet<string> = new Set([
  "erase",
  "move",
  "change",
  "layer",
  "viewport",
  "stretch",
  "vertices",
]);

/** The kinds of statement this version makes. */
export const MADE_KINDS: ReadonlySet<string> = new Set([
  "erase",
  "move",
  "change",
  "layer",
  "viewport",
  "stretch",
  "vertices",
]);

/** True when each item of a list passes `test`, read by index and never by its methods. */
function everyOf(list: readonly unknown[], test: (item: unknown) => boolean): boolean {
  for (let i = 0; i < list.length; i++) if (!test(list[i])) return false;

  return true;
}

/** A path an edit names: 1 to 4096 characters. */
function isPath(value: unknown): value is string {
  return isString(value) && value !== "" && value.length <= 4096;
}

/** A handle an edit names: 1 to 16 hexadecimal digits. */
function isHandle(value: unknown): value is string {
  return isString(value) && HANDLE.test(value);
}

/**
 * What is wrong with a value meant as an `Edit`, as plain data from JSON: empty when nothing is.
 * It checks the fields this version of tsdraft makes edits of and the shape of each statement,
 * and stays bounded on any value: a list is paid for before it is walked.
 */
export function checkEdit(value: unknown): string[] {
  const problems: string[] = [];

  if (!isRecord(value)) return ["the edit is not an object"];

  if (value["format"] !== EDIT_FORMAT) problems.push(`format is not ${EDIT_FORMAT}`);

  if (!isPath(value["file"])) problems.push("file is not a path");
  const sha = value["sha256"];

  if (!isString(sha) || !SHA.test(sha))
    problems.push("sha256 is not 64 lower-case hexadecimal digits");
  const name = value["name"];

  if (!isString(name) || !ID.test(name))
    problems.push("name is not 1 to 64 letters, digits, - and _");
  const units = value["units"];

  if (units !== undefined && !(isString(units) && UNITS.has(units)))
    problems.push("units is not in, ft, mm, cm or m");
  const sheets = value["sheets"];

  if (sheets !== undefined) {
    if (!Array.isArray(sheets) || sheets.length > EDIT_LIMITS.sheets)
      problems.push(`sheets is not a list of at most ${EDIT_LIMITS.sheets} paths`);
    else if (!everyOf(sheets, isPath)) problems.push("a sheet is not a path");
  }

  const only = value["only"];

  if (only !== undefined) {
    // SAFETY: onlyProblem checks each field at run time, whatever the value given.
    const p = onlyProblem(only as ReadPart);

    if (p !== undefined) problems.push(`only ${p}`);
  }

  const statements = value["statements"];

  if (!Array.isArray(statements) || statements.length > EDIT_LIMITS.statements) {
    problems.push(`statements is not a list of at most ${EDIT_LIMITS.statements}`);
  } else {
    let handles = 0;

    for (let i = 0; i < statements.length && problems.length < 100; i++) {
      const s: unknown = statements[i];

      const kind = isRecord(s) ? s["kind"] : undefined;

      if (!isRecord(s) || !isString(kind) || !KINDS.has(kind)) {
        problems.push(`statement ${i} is not of a kind an edit states`);
        continue;
      }

      const list = s["handles"];

      if (kind === "erase" || kind === "move" || kind === "stretch") {
        if (!Array.isArray(list) || (handles += list.length) > EDIT_LIMITS.handles) {
          problems.push(`statement ${i}'s handles are not a list within the edit's limit`);
          continue;
        }

        if (!everyOf(list, isHandle))
          problems.push(`statement ${i} names a handle that is not 1 to 16 hexadecimal digits`);

        if (s["kind"] === "move") {
          // SAFETY: transformProblem checks each field at run time, whatever the value given.
          const problem = transformProblem(s["transform"] as Transform);

          if (problem !== undefined) problems.push(`statement ${i}: ${problem}`);
        }

        if (kind === "stretch") {
          // SAFETY: stretchProblem checks each field at run time, whatever the value given.
          const problem = stretchProblem({ window: s["window"], by: s["by"] } as StretchBy);

          if (problem !== undefined) problems.push(`statement ${i}: ${problem}`);
        }
      } else if (kind === "vertices") {
        const points = s["points"];

        if (!isHandle(s["handle"]))
          problems.push(`statement ${i} names a handle that is not 1 to 16 hexadecimal digits`);
        else if (Array.isArray(points) && (handles += points.length) > EDIT_LIMITS.handles)
          problems.push(`statement ${i}'s points are past the edit's limit`);
        else {
          const given = s["bulges"] === undefined ? { points } : { points, bulges: s["bulges"] };
          // SAFETY: verticesProblem checks each field at run time, whatever the value given.
          const problem = verticesProblem(given as Vertices);

          if (problem !== undefined) problems.push(`statement ${i}: ${problem}`);
        }
      } else if (kind === "layer") {
        const layer = s["name"];

        if (!isString(layer) || layer === "" || layer.length > 255)
          problems.push(`statement ${i} names no layer`);
        // SAFETY: layerChangesProblem checks each field at run time, whatever the value given.
        const p = layerChangesProblem(s["changes"] as LayerChanges);

        if (p !== undefined) problems.push(`statement ${i}: ${p}`);
      } else {
        if (!isHandle(s["handle"]))
          problems.push(`statement ${i} names a handle that is not 1 to 16 hexadecimal digits`);

        // SAFETY: each problem function checks each field at run time, whatever the value given.
        const p =
          kind === "change"
            ? entityChangesProblem(s["changes"] as EntityChanges)
            : viewportChangesProblem(s["changes"] as ViewportChanges);

        if (p !== undefined) problems.push(`statement ${i}: ${p}`);
      }
    }
  }

  const additions = value["additions"];

  if (additions !== undefined) {
    // Each field is read once, in order, and none after the first that is wrong.
    const given = isRecord(additions) ? additions : undefined;
    const layouts = given && Array.isArray(given["model"]) ? given["layouts"] : undefined;
    const definitions = given && isRecord(layouts) ? given["definitions"] : undefined;

    if (!isRecord(layouts)) problems.push("additions is not { model, layouts, definitions }");
    else if (!isRecord(definitions)) problems.push("additions has no definitions");
    else {
      const kinds = [
        { what: "the additions of the layout", fields: layouts, may: false },
        { what: "the definitions'", fields: definitions, may: true },
      ];

      // SAFETY: the guards above found `model` a list.
      const model = given!["model"] as unknown[];
      let held = model.length;

      // An entity is an object; what it holds, the drawing's checks read.
      if (held <= EDIT_LIMITS.additions && !everyOf(model, isRecord))
        problems.push("the additions of model space hold an item that is no object");

      for (const { what, fields, may } of kinds) {
        let n = 0;

        for (const key in fields) {
          if (++n > EDIT_LIMITS.keys) {
            problems.push(`${what} holds more than ${EDIT_LIMITS.keys} keys`);
            break;
          }

          const list = fields[key];

          if (!Array.isArray(list) && !(may && list === undefined))
            problems.push(`${what} ${JSON.stringify(key.slice(0, 64))} is not a list`);
          else if (Array.isArray(list)) {
            held += list.length;

            if (held <= EDIT_LIMITS.additions && !everyOf(list, isRecord))
              problems.push(
                `${what} ${JSON.stringify(key.slice(0, 64))} holds an item that is no object`,
              );
          }
        }
      }

      if (held > EDIT_LIMITS.additions)
        problems.push(
          `additions hold ${held} items, past the most an edit takes, ${EDIT_LIMITS.additions}`,
        );
    }
  }

  return problems;
}

/** What is wrong with a value meant as a `ReadPart`, or undefined when nothing is. */
function onlyProblem(only: ReadPart): string | undefined {
  if (!isRecord(only)) return "is not { layouts, areas }";
  const { layouts, areas } = only;

  if (layouts !== undefined) {
    if (!Array.isArray(layouts) || layouts.length > EDIT_LIMITS.keys)
      return `layouts is not a list of at most ${EDIT_LIMITS.keys} names`;

    if (!everyOf(layouts, (l) => isString(l) && l.length <= 4096))
      return "names a layout that is not a name";
  }

  if (areas !== undefined) {
    if (!Array.isArray(areas) || areas.length > EDIT_LIMITS.keys)
      return `areas is not a list of at most ${EDIT_LIMITS.keys} boxes`;

    if (
      !everyOf(
        areas,
        (a) => Array.isArray(a) && a.length === 2 && pointLike(a[0]) && pointLike(a[1]),
      )
    )
      return "holds an area that is not two points";
  }

  for (const key in only)
    if (key !== "layouts" && key !== "areas")
      return `holds ${JSON.stringify(key.slice(0, 40))}, which is not layouts or areas`;

  return undefined;
}

/** True when an edit adds nothing. */
export function addsNothing(edit: Edit): boolean {
  const a = edit.additions;

  if (a === undefined) return true;

  if (a.model.length > 0) return false;

  for (const key in a.layouts) if ((a.layouts[key]?.length ?? 0) > 0) return false;

  // Every enumerable list, inherited ones too, as `checkEdit` walks them.
  const definitions: Readonly<Record<string, readonly object[] | undefined>> = a.definitions;

  for (const key in definitions) if ((definitions[key]?.length ?? 0) > 0) return false;

  return true;
}

/**
 * What every writer checks before it reads the bytes: the edit's shape, and the statements and
 * additions this version makes. Throws an `EditError`.
 */
export function editToMake(edit: unknown): Edit {
  const problems = checkEdit(edit);

  if (problems.length > 0) throw new EditError(`The edit is malformed: ${problems.join("; ")}`);
  // SAFETY: `checkEdit` found nothing wrong, so the value holds each field of an `Edit`.
  const made = edit as Edit;
  const statements = made.statements;

  for (let i = 0; i < statements.length; i++)
    if (!MADE_KINDS.has(statements[i]!.kind))
      throw new EditError(
        `This version of tsdraft makes no ${statements[i]!.kind} statement yet`,
        i,
      );

  return made;
}
