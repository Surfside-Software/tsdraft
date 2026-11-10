import { fmt, written } from "./format.ts";
import { layerAuditKey, layerKey } from "./layers.ts";
import {
  arcProblem,
  layerColorProblem,
  magnitudeProblem,
  layerNameProblem,
  layerTwinProblem,
  sizeProblem,
  textProblem,
  type LayerColor,
  type LayerName,
  type Positive,
} from "./rules.ts";

/** A model-space point, in drawing units. Y points up, as in CAD. */
export type Point = readonly [x: number, y: number];

/**
 * The unit one drawing unit stands for. It is kept on the drawing for callers;
 * the DXF R12 writer has no field for it, so set units in CAD after opening.
 */
export type Units = "in" | "ft" | "mm" | "cm" | "m";

const UNITS: readonly string[] = ["in", "ft", "mm", "cm", "m"] satisfies readonly Units[];

/**
 * DXF versions tsdraft writes.
 *
 * - `"R12"` (AC1009) opens in nearly every CAD program, but stores no units and
 *   limits layer names to 31 letters, digits, `$`, `-` and `_`.
 * - `"R2018"` (AC1032) is the newest published version and the one AutoCAD has
 *   used since 2018. It records the drawing's units.
 */
export type DxfVersion = "R12" | "R2018";

const DXF_VERSIONS: readonly string[] = ["R12", "R2018"] satisfies readonly DxfVersion[];

export interface Layer {
  readonly name: string;
  /** AutoCAD Color Index, 1 to 255. 7 is white on dark backgrounds, black on light. */
  readonly color: number;
}

interface EntityBase {
  readonly layer: string;
}

export interface Line extends EntityBase {
  readonly kind: "line";
  readonly from: Point;
  readonly to: Point;
}

export interface Polyline extends EntityBase {
  readonly kind: "polyline";
  readonly points: readonly Point[];
  readonly closed: boolean;
}

export interface Circle extends EntityBase {
  readonly kind: "circle";
  readonly center: Point;
  readonly radius: number;
}

/** Angles are in degrees from 0 up to 360, counterclockwise from +X, as in DXF. */
export interface Arc extends EntityBase {
  readonly kind: "arc";
  readonly center: Point;
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
}

export interface Text extends EntityBase {
  readonly kind: "text";
  /** Left end of the text baseline. */
  readonly at: Point;
  readonly height: number;
  readonly value: string;
  /** Degrees counterclockwise. */
  readonly rotation: number;
}

export type Entity = Line | Polyline | Circle | Arc | Text;

export interface Drawing {
  readonly units: Units;
  /** The DXF version the drawing is written for. `toDXF` uses it unless told otherwise. */
  readonly dxf: DxfVersion;
  readonly layers: readonly Layer[];
  readonly entities: readonly Entity[];
}

export interface DrawingOptions<V extends DxfVersion = DxfVersion> {
  /** Defaults to `"in"`. */
  readonly units?: Units;
  /** The DXF version to check the drawing against and export. Defaults to `"R12"`. */
  readonly dxf?: V;
}

export interface LayerOptions<C extends number = number> {
  /** AutoCAD Color Index, 1 to 255. */
  readonly color?: LayerColor<C>;
}

export interface TextOptions<H extends number = number> {
  readonly height?: Positive<H>;
  /** Degrees counterclockwise. */
  readonly rotation?: number;
}

/**
 * Builds a drawing. Entities go on the current layer, which starts as "0".
 * `layer(name, opts, draw)` scopes everything drawn inside `draw` to that layer.
 *
 * Mistakes written as literals, such as a layer name the DXF version does not
 * allow or a negative radius, are compile errors. The same checks run again
 * when the code runs, for values the compiler cannot see.
 */
export class DrawingBuilder<V extends DxfVersion = "R12"> {
  readonly units: Units;
  readonly dxf: V;
  /** Keyed by `layerKey`, because AutoCAD ignores case in layer names. */
  readonly #layers = new Map<string, Layer>([["0", { name: "0", color: 7 }]]);
  /** The first layer name for each `layerAuditKey`, to find names AUDIT would call duplicates. */
  readonly #audited = new Map<string, string>([["0", "0"]]);
  readonly #entities: Entity[] = [];
  #current = "0";

  constructor(options: DrawingOptions<V> = {}) {
    const units = options.units ?? "in";
    if (!UNITS.includes(units)) throw new Error(`Unknown units: ${JSON.stringify(units)}`);
    const dxf = options.dxf ?? "R12";
    if (!DXF_VERSIONS.includes(dxf)) {
      throw new Error(`Unsupported DXF version: ${JSON.stringify(dxf)}`);
    }
    this.units = units;
    this.dxf = dxf as V;
  }

  /**
   * Defines or updates a layer. With `draw`, entities drawn inside it go on this layer.
   * `wall` and `WALL` are the same layer, as in CAD, and keep the first spelling.
   */
  layer<N extends string, C extends number = number>(
    name: LayerName<N, V>,
    options: LayerOptions<C> = {},
    draw?: () => void,
  ): this {
    // The parameter type is the error message when a literal name is wrong, so read it as a string.
    const requested = name as string;
    const nameProblem = layerNameProblem(requested, this.dxf);
    if (nameProblem) throw new Error(`Layer ${JSON.stringify(requested)}: ${nameProblem}`);
    const key = layerKey(requested);
    const existing = this.#layers.get(key);
    const auditKey = layerAuditKey(requested);
    const twinProblem = layerTwinProblem(requested, this.#audited.get(auditKey) ?? requested);
    if (twinProblem) throw new Error(`Layer ${JSON.stringify(requested)}: ${twinProblem}`);
    const color = (options.color as number | undefined) ?? existing?.color ?? 7;
    const colorProblem = layerColorProblem(color);
    if (colorProblem) throw new Error(`Layer ${JSON.stringify(requested)}: ${colorProblem}`);
    const layer = { name: existing?.name ?? requested, color };
    this.#layers.set(key, layer);
    if (!this.#audited.has(auditKey)) this.#audited.set(auditKey, layer.name);
    if (draw) {
      const previous = this.#current;
      this.#current = layer.name;
      try {
        draw();
      } finally {
        this.#current = previous;
      }
    }
    return this;
  }

  line(from: Point, to: Point): this {
    return this.#add({ kind: "line", layer: this.#current, from: pt(from), to: pt(to) });
  }

  polyline(points: readonly Point[], closed = false): this {
    if (points.length < 2) throw new Error("A polyline needs at least 2 points");
    return this.#add({ kind: "polyline", layer: this.#current, points: points.map(pt), closed });
  }

  /** Closed rectangle from its lower-left corner. */
  rect<W extends number, H extends number>(
    corner: Point,
    width: Positive<W>,
    height: Positive<H>,
  ): this {
    const [x, y] = pt(corner);
    const w = positive(width, "width");
    const h = positive(height, "height");
    // A side can still vanish in the file: a corner and the one across from it may round together.
    if (written(x + w) === written(x)) throw new Error(lostSide("width", "x", x));
    if (written(y + h) === written(y)) throw new Error(lostSide("height", "y", y));
    return this.polyline(
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
      true,
    );
  }

  circle<R extends number>(center: Point, radius: Positive<R>): this {
    return this.#add({
      kind: "circle",
      layer: this.#current,
      center: pt(center),
      radius: positive(radius, "radius"),
    });
  }

  /**
   * Arc from `startAngle` counterclockwise to `endAngle`. Angles are stored
   * from 0 up to 360, so -90 becomes 270, because AutoCAD's AUDIT rejects
   * angles outside that range.
   *
   * Angles are written with 6 decimals. An arc within 0.000001 degrees of a
   * full turn would be written with equal angles, which AutoCAD holds as an
   * arc of no length, so it throws: draw a circle instead.
   */
  arc<R extends number>(
    center: Point,
    radius: Positive<R>,
    startAngle: number,
    endAngle: number,
  ): this {
    const start = turn(num(startAngle, "startAngle"));
    const end = turn(num(endAngle, "endAngle"));
    if (start === end) throw new Error("An arc's start and end angles must differ");
    const problem = arcProblem(start, end);
    if (problem) throw new Error(problem);
    return this.#add({
      kind: "arc",
      layer: this.#current,
      center: pt(center),
      radius: positive(radius, "radius"),
      startAngle: start,
      endAngle: end,
    });
  }

  text<H extends number = number>(at: Point, value: string, options: TextOptions<H> = {}): this {
    const problem = textProblem(value);
    if (problem) throw new Error(problem);
    return this.#add({
      kind: "text",
      layer: this.#current,
      at: pt(at),
      value,
      height: positive(options.height ?? 0.125, "height"),
      rotation: kept(options.rotation ?? 0, "rotation"),
    });
  }

  build(): Drawing {
    return {
      units: this.units,
      dxf: this.dxf,
      layers: [...this.#layers.values()],
      entities: [...this.#entities],
    };
  }

  #add(entity: Entity): this {
    this.#entities.push(entity);
    return this;
  }
}

export function createDrawing<V extends DxfVersion = "R12">(
  options?: DrawingOptions<V>,
): DrawingBuilder<V> {
  return new DrawingBuilder(options);
}

/** Counterclockwise sweep from start to end, in degrees, within [0, 360). */
export function sweep(startAngle: number, endAngle: number): number {
  return turn(endAngle - startAngle);
}

/** Brings an angle in degrees into [0, 360). */
function turn(degrees: number): number {
  const wrapped = ((degrees % 360) + 360) % 360;
  // A tiny negative angle rounds up to exactly 360.
  return wrapped === 360 ? 0 : wrapped;
}

function num(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

/** Takes `unknown` because a `Positive<N>` parameter is a message string when the literal is wrong. */
function positive(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  const problem = sizeProblem(value);
  if (problem) throw new Error(`${label}: ${problem}`);
  return value;
}

function lostSide(size: string, axis: string, at: number): string {
  return `${size}: This value is too small at ${axis} = ${at}. Both sides of the rectangle are written as ${axis} = ${fmt(at)}, because tsdraft writes 6 decimals`;
}

/** A number the drawing keeps and the writers print, which AutoCAD must be able to read. */
function kept(value: number, label: string): number {
  const problem = magnitudeProblem(num(value, label));
  if (problem) throw new Error(`${label}: ${problem}`);
  return value;
}

function pt(point: Point): Point {
  return [kept(point[0], "x"), kept(point[1], "y")];
}
