import { holdCall, readCall, recordCalls, type HeldCall } from "./callsite.ts";
import { STANDARD_TEXT_STYLE } from "./fonts.ts";
import { fmt, written } from "./format.ts";
import { validIdHandle } from "./handles.ts";
import { layerAuditKey, layerKey } from "./layers.ts";
import { BUILT_IN_LINETYPES, builtInLinetype } from "./linetypes.ts";
import { DrawingError, type Diagnostic, type LintRule } from "./lint.ts";
import {
  arcProblem,
  duplicateIdProblem,
  idHandleProblem,
  idKey,
  idProblem,
  isStandardTextStyle,
  layerColorProblem,
  layerFlagProblem,
  layerLinetypeProblem,
  layerStateProblem,
  lineweightProblem,
  linetypeNameProblem,
  linetypeProblem,
  linetypeScaleProblem,
  magnitudeProblem,
  layerNameProblem,
  layerTwinProblem,
  R12_ONLY,
  sizeProblem,
  textAlignProblem,
  textProblem,
  textStyleNameProblem,
  textStyleProblem,
  undefinedLinetypeProblem,
  undefinedTextStyleProblem,
  type Description,
  type EntityId,
  type FontOf,
  type FrozenCurrent,
  type LayerLinetypeName,
  type LineweightMm,
  type LineweightOf,
  type LinetypeName,
  type NewLinetypeName,
  type NewTextStyleName,
  type ObliqueAngle,
  type Pattern,
  type R12EntityStyle,
  type R12LayerStates,
  type R12Lineweights,
  type R12Linetypes,
  type R12Text,
  type TextStyleName,
  type WidthFactor,
  type LayerColor,
  type LayerName,
  type Positive,
  type TEXT_ALIGNS,
  type TEXT_VERTICAL_ALIGNS,
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

/**
 * A simple linetype: a repeating pattern of dashes, gaps and dots. The lengths are in drawing
 * units, and CAD multiplies them by the drawing's `linetypeScale`.
 */
export interface Linetype {
  readonly name: string;
  readonly description: string;
  /** A dash is a positive length, a gap a negative one, and a dot 0. Empty for a solid line. */
  readonly pattern: readonly number[];
}

/**
 * The lineweights AutoCAD offers, in millimetres. A lineweight is how wide a line plots, and
 * how wide AutoCAD shows it when LWDISPLAY is on.
 */
export type Lineweight = LineweightMm;

export interface Layer {
  readonly name: string;
  /** AutoCAD Color Index, 1 to 255. 7 is white on dark backgrounds, black on light. */
  readonly color: number;
  /** The linetype of the layer's entities that draw ByLayer. Defaults to `"Continuous"`. */
  readonly linetype?: string;
  /**
   * In millimetres, one of `Lineweight`, or `"Default"`, which AutoCAD draws at its LWDEFAULT
   * of 0.25 mm. Defaults to `"Default"`.
   */
  readonly lineweight?: number | "Default";
  /** An off layer is not shown or plotted, but CAD still regenerates it. */
  readonly off?: boolean;
  /** A frozen layer is not shown, plotted or regenerated. */
  readonly frozen?: boolean;
  /** A locked layer is shown and plotted, and CAD does not let its entities be edited. */
  readonly locked?: boolean;
  /** Whether the layer plots. Defaults to `true`. */
  readonly plot?: boolean;
}

interface EntityBase {
  /**
   * A name for this entity that stays the same when the drawing's code changes around it: 1 to
   * 64 letters A to Z or a to z, digits, `.`, `-` and `_`. No two entities of a drawing share
   * one, whatever its case.
   */
  readonly id?: string;
  readonly layer: string;
  /** A linetype of the drawing, `"Continuous"`, `"ByBlock"` or `"ByLayer"`, the default. */
  readonly linetype?: string;
  /** In millimetres, one of `Lineweight`, or `"ByLayer"`, the default, `"ByBlock"` or `"Default"`. */
  readonly lineweight?: number | "ByLayer" | "ByBlock" | "Default";
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

/**
 * A text style: the font of the texts that name it, and how wide and how slanted its characters
 * are drawn. It has no height, so each text keeps its own.
 */
export interface TextStyle {
  readonly name: string;
  /** One of `FONTS`: an SHX font by its file name, a TrueType font by its typeface. */
  readonly font: string;
  /** How wide each character is drawn, as a share of the font's own width. Defaults to 1. */
  readonly widthFactor?: number;
  /** The slant of each character, in degrees to the right, from -85 to 85. Defaults to 0. */
  readonly obliqueAngle?: number;
}

/** Where a text's `at` point is along its line. */
export type TextAlign = (typeof TEXT_ALIGNS)[number];

/**
 * Where a text's `at` point is up and down its line: on the baseline, at the bottom of the
 * letters that reach below it, half way up a capital, or at the top of a capital.
 */
export type TextVerticalAlign = (typeof TEXT_VERTICAL_ALIGNS)[number];

export interface Text extends EntityBase {
  readonly kind: "text";
  /**
   * The point `align` and `valign` justify the text to: with their defaults, the left end of
   * the baseline.
   */
  readonly at: Point;
  readonly height: number;
  readonly value: string;
  /** Degrees counterclockwise. */
  readonly rotation: number;
  /** A text style of the drawing. Defaults to `"Standard"`. */
  readonly style?: string;
  /** Defaults to `"left"`. */
  readonly align?: TextAlign;
  /** Defaults to `"baseline"`. */
  readonly valign?: TextVerticalAlign;
}

export type Entity = Line | Polyline | Circle | Arc | Text;

export interface Drawing {
  /**
   * The version of the `Drawing` format, which is separate from the DXF version in `dxf`.
   * Format 0 carries no promise of stability: a later tsdraft may change it without reading it.
   */
  readonly format: 0;
  readonly units: Units;
  /** The DXF version the drawing is written for. `toDXF` uses it unless told otherwise. */
  readonly dxf: DxfVersion;
  readonly layers: readonly Layer[];
  readonly entities: readonly Entity[];
  /** Linetypes beyond `Continuous`, `ByLayer` and `ByBlock`, which every drawing has. */
  readonly linetypes?: readonly Linetype[];
  /** The global linetype scale, `$LTSCALE`, which multiplies every pattern. Defaults to 1. */
  readonly linetypeScale?: number;
  /** Text styles beyond `Standard`, which every drawing has. */
  readonly textStyles?: readonly TextStyle[];
}

export interface DrawingOptions<V extends DxfVersion = DxfVersion, S extends number = number> {
  /** Defaults to `"in"`. */
  readonly units?: Units;
  /** The DXF version to check the drawing against and export. Defaults to `"R2018"`. */
  readonly dxf?: V;
  /** The global linetype scale, which multiplies every linetype's pattern. Defaults to 1. */
  readonly linetypeScale?: V extends "R12" ? 1 | R12Linetypes : Positive<S>;
  /**
   * Whether to record the call that draws each entity, so that a `lint` diagnostic names it in
   * `call`. It more than doubles the time the builder takes. Defaults to `false`, or to `true` when
   * `globalThis.TSDRAFT_RECORD_CALLS` is `true`, which a tool that runs drawing files sets
   * before it runs them.
   */
  readonly recordCalls?: boolean;
}

/** A linetype to define: a `Linetype`, whose description may be left out. */
export interface LinetypeDefinition<
  N extends string = string,
  P extends readonly number[] = readonly number[],
  D extends string = string,
> {
  readonly name: NewLinetypeName<N>;
  /** Shown beside the name in CAD's linetype lists. Defaults to `""`. */
  readonly description?: Description<D>;
  /** A dash is a positive length, a gap a negative one, and a dot 0. Empty for a solid line. */
  readonly pattern: Pattern<P>;
}

/** What a layer or an entity may be given as its linetype: a name, or a definition. */
type LinetypeValue = string | LinetypeDefinition;

/** Each definition in `L`, checked as `linetype()` checks one. A name in `L` adds nothing. */
type CheckedDefinition<L> = L extends LinetypeDefinition
  ? LinetypeDefinition<L["name"], L["pattern"], DescriptionOf<L>>
  : never;

type DescriptionOf<L> = L extends { readonly description: infer D extends string } ? D : string;

/**
 * A linetype for a layer or an entity: the name `T` of one the drawing has, or a
 * `LinetypeDefinition`, which is checked as `linetype()` checks one and defined first if the
 * drawing does not have it yet.
 *
 * `L` is the whole value given, a name or a definition, so the compiler infers it in one piece
 * even from a conditional that mixes the two. That is why this is one conditional type and not a
 * union: the compiler infers a union's members apart. The false branch is never taken: it is
 * there so the compiler infers `L`, and the tuple keeps `const L` from widening it.
 */
export type LinetypeChoice<T extends string, L extends LinetypeValue = LinetypeDefinition> = [
  L,
] extends [LinetypeValue]
  ? LinetypeName<T> | CheckedDefinition<L>
  : L;

/**
 * A linetype on an R12 drawing, which can only be the built-in `Allowed`. Any other literal name,
 * and any definition, resolves to `Message`. `L` holds a definition when it has an object in it
 * and is not left at its default, `LinetypeDefinition`. The last branch, never taken, lets `L` be
 * inferred, as in `LinetypeChoice`.
 */
type R12LinetypeChoice<
  T extends string,
  L extends LinetypeValue,
  Allowed extends string,
  Message,
> = [L] extends [LinetypeValue]
  ? LinetypeDefinition extends L
    ? R12LinetypeName<T, Allowed, Message>
    : [Extract<L, object>] extends [never]
      ? R12LinetypeName<T, Allowed, Message>
      : Message
  : L;

type R12LinetypeName<T extends string, Allowed extends string, Message> = string extends T
  ? T
  : Lowercase<T> extends Allowed
    ? T
    : Message;

/**
 * What `layer()` sets on a layer.
 *
 * @typeParam L - The linetype as written, a name or a definition. A definition's literal mistakes
 *   are compile errors.
 */
export interface LayerOptions<
  C extends number = number,
  W extends number = number,
  T extends string = string,
  V extends DxfVersion = "R2018",
  N extends string = string,
  L extends LinetypeValue = LinetypeDefinition,
> {
  /** AutoCAD Color Index, 1 to 255. */
  readonly color?: LayerColor<C>;
  /** Defaults to `"Continuous"`. It cannot be ByLayer or ByBlock. R2018 only. */
  readonly linetype?: V extends "R12"
    ? R12LinetypeChoice<T, L, "continuous", R12Linetypes>
    : // One conditional type, for the reason `LinetypeChoice` gives.
      [L] extends [LinetypeValue]
      ? LayerLinetypeName<T> | CheckedDefinition<L>
      : L;
  /** In millimetres, or `"Default"`, which is 0.25 mm. Defaults to `"Default"`. R2018 only. */
  readonly lineweight?: V extends "R12" ? "Default" | R12Lineweights : LineweightOf<W> | "Default";
  /** Hides the layer. R2018 only. */
  readonly off?: V extends "R12" ? false | R12LayerStates : boolean;
  /** Hides the layer and leaves it out of regeneration. Layer "0" cannot be frozen. R2018 only. */
  readonly frozen?: V extends "R12"
    ? false | R12LayerStates
    : N extends "0"
      ? false | FrozenCurrent
      : boolean;
  /** Keeps the layer's entities from being edited in CAD. R2018 only. */
  readonly locked?: V extends "R12" ? false | R12LayerStates : boolean;
  /** Whether the layer plots. Defaults to `true`. R2018 only. */
  readonly plot?: V extends "R12" ? true | R12LayerStates : boolean;
}

/**
 * The id an entity may have, and the linetype and lineweight it may have of its own. Both
 * default to ByLayer.
 *
 * @typeParam L - The linetype as written, a name or a definition. A definition's literal mistakes
 *   are compile errors.
 */
export interface EntityOptions<
  V extends DxfVersion = "R2018",
  T extends string = string,
  W extends number = number,
  L extends LinetypeValue = LinetypeDefinition,
  I extends string = string,
> {
  /**
   * A name for the entity that no other entity of the drawing has: 1 to 64 letters A to Z or a
   * to z, digits, `.`, `-` and `_`. Diagnostics and `toSVG` carry it.
   */
  readonly id?: EntityId<I>;
  /** A linetype of the drawing, `"Continuous"`, `"ByBlock"` or `"ByLayer"`. R2018 only. */
  readonly linetype?: V extends "R12"
    ? R12LinetypeChoice<T, L, "bylayer", R12EntityStyle>
    : LinetypeChoice<T, L>;
  /** In millimetres, or `"ByLayer"`, `"ByBlock"` or `"Default"`. R2018 only. */
  readonly lineweight?: V extends "R12"
    ? "ByLayer" | R12EntityStyle
    : LineweightOf<W> | "ByLayer" | "ByBlock" | "Default";
}

/** A text style to define: a `TextStyle`, checked. */
export interface TextStyleDefinition<
  N extends string = string,
  F extends string = string,
  W extends number = number,
  O extends number = number,
> {
  readonly name: NewTextStyleName<N>;
  /** One of `FONTS`: an SHX font by its file name, a TrueType font by its typeface. */
  readonly font: FontOf<F>;
  /**
   * How wide each character is drawn, as a share of the font's own width, from 0.01 to 100.
   * Defaults to 1.
   */
  readonly widthFactor?: WidthFactor<W>;
  /** The slant of each character, in degrees to the right, from -85 to 85. Defaults to 0. */
  readonly obliqueAngle?: ObliqueAngle<O>;
}

/** What a text may be given as its style: a name, or a definition. */
type TextStyleValue = string | TextStyleDefinition;

/** Each definition in `D`, checked as `textStyle()` checks one. A name in `D` adds nothing. */
type CheckedTextStyle<D> = D extends TextStyleDefinition
  ? TextStyleDefinition<D["name"], D["font"], WidthFactorOf<D>, ObliqueAngleOf<D>>
  : never;

type WidthFactorOf<D> = D extends { readonly widthFactor: infer W extends number } ? W : number;
type ObliqueAngleOf<D> = D extends { readonly obliqueAngle: infer O extends number } ? O : number;

/**
 * A style for a text: the name `S` of one the drawing has, or a `TextStyleDefinition`, which is
 * checked as `textStyle()` checks one and defined first if the drawing does not have it yet. `D`
 * is the whole value given, and this is one conditional type, for the reasons `LinetypeChoice`
 * gives.
 */
export type TextStyleChoice<S extends string, D extends TextStyleValue = TextStyleDefinition> = [
  D,
] extends [TextStyleValue]
  ? TextStyleName<S> | CheckedTextStyle<D>
  : D;

/**
 * The options of `text()`: its height, rotation, style and justification, and the options of
 * every entity.
 *
 * @typeParam L - The linetype as written, a name or a definition. A definition's literal mistakes
 *   are compile errors.
 * @typeParam D - The text style as written, a name or a definition, checked the same way.
 */
export interface TextOptions<
  H extends number = number,
  V extends DxfVersion = "R2018",
  T extends string = string,
  W extends number = number,
  L extends LinetypeValue = LinetypeDefinition,
  I extends string = string,
  S extends string = string,
  D extends TextStyleValue = TextStyleDefinition,
> extends EntityOptions<V, T, W, L, I> {
  readonly height?: Positive<H>;
  /** Degrees counterclockwise. */
  readonly rotation?: number;
  /** A text style of the drawing, or a definition of one. Defaults to `"Standard"`. R2018 only. */
  readonly style?: V extends "R12" ? typeof STANDARD_TEXT_STYLE | R12Text : TextStyleChoice<S, D>;
  /** Where `at` is along the text's line. Defaults to `"left"`. R2018 only. */
  readonly align?: V extends "R12" ? "left" | R12Text : TextAlign;
  /** Where `at` is up and down the text's line. Defaults to `"baseline"`. R2018 only. */
  readonly valign?: V extends "R12" ? "baseline" | R12Text : TextVerticalAlign;
}

/** The linetype and lineweight an entity is stored with: only what differs from ByLayer. */
type EntityStyle = Pick<Line, "linetype" | "lineweight">;

type Method = (...args: never[]) => unknown;

/** A broken rule, thrown inside a builder method and turned into a `DrawingError` on its way out. */
class Problem {
  readonly rule: LintRule;
  readonly message: string;

  constructor(rule: LintRule, message: string) {
    this.rule = rule;
    this.message = message;
  }
}

function refuse(rule: LintRule, message: string): never {
  throw new Problem(rule, message);
}

/**
 * What a builder method throws for something thrown inside it: for a `Problem`, a `DrawingError`
 * whose one diagnostic names the caller's call of `method` and what the call was `about`.
 */
function located(
  thrown: unknown,
  method: Method,
  about: Pick<Diagnostic, "id" | "layer" | "linetype" | "textStyle">,
): unknown {
  if (!(thrown instanceof Problem)) return thrown;
  const call = readCall(holdCall(method));
  const diagnostic: Diagnostic = {
    rule: thrown.rule,
    severity: "error",
    message: thrown.message,
    ...about,
    ...(call ? { call } : {}),
  };
  return new DrawingError([diagnostic], thrown.message);
}

/** Whether a tool that runs drawing files has asked every builder to record calls. */
function recordsCalls(): boolean {
  return (globalThis as { TSDRAFT_RECORD_CALLS?: unknown }).TSDRAFT_RECORD_CALLS === true;
}

/**
 * Builds a drawing. Entities go on the current layer, which starts as "0".
 * `layer(name, opts, draw)` scopes everything drawn inside `draw` to that layer.
 *
 * Mistakes written as literals, such as a layer name the DXF version does not
 * allow or a negative radius, are compile errors. The same checks run again
 * when the code runs, for values the compiler cannot see: `layer`, `linetype`,
 * `textStyle` and the entity methods then throw a `DrawingError` whose diagnostic has the
 * rule, the entity's `id` and the `call` that broke it.
 */
export class DrawingBuilder<V extends DxfVersion = "R2018", S extends number = number> {
  readonly units: Units;
  readonly dxf: V;
  readonly linetypeScale: number;
  /** Keyed by `layerKey`, because AutoCAD ignores case in layer names. */
  readonly #layers = new Map<string, Layer>([["0", { name: "0", color: 7 }]]);
  /** The first layer name for each `layerAuditKey`, to find names AUDIT would call duplicates. */
  readonly #audited = new Map<string, string>([["0", "0"]]);
  /** Keyed by `layerKey`: AutoCAD compares linetype names as it compares layer names. */
  readonly #linetypes = new Map<string, Linetype>();
  /** Seeded with the built-in linetypes, whose twins AUDIT reports as it reports any other. */
  readonly #linetypesAudited = new Map<string, string>(
    BUILT_IN_LINETYPES.map((name) => [layerAuditKey(name), name]),
  );
  /** Keyed by `layerKey`: AutoCAD compares text style names as it compares layer names. */
  readonly #textStyles = new Map<string, TextStyle>();
  readonly #textStylesAudited = new Map<string, string>([
    [layerAuditKey(STANDARD_TEXT_STYLE), STANDARD_TEXT_STYLE],
  ]);
  readonly #entities: Entity[] = [];
  /** The first spelling of each entity id, by `idKey`. */
  readonly #ids = new Map<string, string>();
  /** The first id that gave each handle. */
  readonly #idHandles = new Map<string, string>();
  /** The call that drew each entity, when calls are recorded. */
  readonly #calls: (HeldCall | undefined)[] | undefined;
  #current = "0";

  constructor(options: DrawingOptions<V, S> = {}) {
    const units = options.units ?? "in";
    if (!UNITS.includes(units)) throw new Error(`Unknown units: ${JSON.stringify(units)}`);
    const dxf = options.dxf ?? "R2018";
    if (!DXF_VERSIONS.includes(dxf)) {
      throw new Error(`Unsupported DXF version: ${JSON.stringify(dxf)}`);
    }
    const scale = options.linetypeScale as unknown;
    if (scale !== undefined) {
      if (typeof scale !== "number") throw new Error("linetypeScale must be a finite number");
      if (dxf === "R12" && scale !== 1) throw new Error(`linetypeScale: ${R12_ONLY.linetypes}`);
      const problem = linetypeScaleProblem(scale);
      if (problem) throw new Error(`linetypeScale: ${problem}`);
    }
    this.units = units;
    this.dxf = dxf as V;
    this.linetypeScale = (scale as number | undefined) ?? 1;
    this.#calls = (options.recordCalls ?? recordsCalls()) ? [] : undefined;
  }

  /**
   * Defines a linetype, or updates the one of the same name. `dashed` and
   * `DASHED` are the same linetype, as in CAD, and keep the first spelling.
   * tsdraft exports the linetypes plans use, such as `DASHED` and `HIDDEN`.
   */
  linetype<N extends string, const P extends readonly number[], D extends string = string>(
    linetype: V extends "R12" ? R12Linetypes : LinetypeDefinition<N, P, D>,
  ): this {
    const definition = linetype as unknown as LinetypeDefinition;
    try {
      if (this.dxf === "R12") refuse("linetype", R12_ONLY.linetypes);
      this.#define(definition);
    } catch (thrown) {
      const name: unknown = definition?.name;
      const about = typeof name === "string" ? { linetype: name } : {};
      throw located(thrown, DrawingBuilder.prototype.linetype, about);
    }
    return this;
  }

  /**
   * Defines a text style, or updates the one of the same name. `notes` and `NOTES` are the
   * same style, and keep the first spelling. `Standard` is in every drawing, with the font
   * `txt.shx`.
   */
  textStyle<
    N extends string,
    F extends string,
    W extends number = number,
    O extends number = number,
  >(style: V extends "R12" ? R12Text : TextStyleDefinition<N, F, W, O>): this {
    const definition = style as unknown as TextStyleDefinition;
    try {
      if (this.dxf === "R12") refuse("text-style", R12_ONLY.text);
      this.#defineTextStyle(definition);
    } catch (thrown) {
      const name: unknown = definition?.name;
      const about = typeof name === "string" ? { textStyle: name } : {};
      throw located(thrown, DrawingBuilder.prototype.textStyle, about);
    }
    return this;
  }

  /**
   * Defines or updates a layer. With `draw`, entities drawn inside it go on this layer.
   * `wall` and `WALL` are the same layer, as in CAD, and keep the first spelling.
   * Options left out keep the values the layer has.
   */
  layer<
    N extends string,
    C extends number = number,
    W extends number = number,
    T extends string = string,
    const L extends LinetypeValue = LinetypeDefinition,
  >(name: LayerName<N, V>, options: LayerOptions<C, W, T, V, N, L> = {}, draw?: () => void): this {
    // The parameter type is the error message when a literal name is wrong, so read it as a string.
    const requested = name as string;
    let layer: Layer;
    try {
      layer = this.#layer(requested, options as unknown as LayerOptions);
    } catch (thrown) {
      throw located(thrown, DrawingBuilder.prototype.layer, { layer: requested });
    }
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

  /** Checks a layer and stores it. */
  #layer(requested: string, o: LayerOptions): Layer {
    const fail = (rule: LintRule, problem: string): never =>
      refuse(rule, `Layer ${JSON.stringify(requested)}: ${problem}`);
    const nameProblem = layerNameProblem(requested, this.dxf);
    if (nameProblem) fail("layer-name", nameProblem);
    const key = layerKey(requested);
    const existing = this.#layers.get(key);
    const auditKey = layerAuditKey(requested);
    const twinProblem = layerTwinProblem(requested, this.#audited.get(auditKey) ?? requested);
    if (twinProblem) fail("duplicate-layer", twinProblem);
    const color = (o.color as number | undefined) ?? existing?.color ?? 7;
    const colorProblem = layerColorProblem(color);
    if (colorProblem) fail("layer-color", colorProblem);
    const layer: Layer = { name: existing?.name ?? requested, color };
    const set = <K extends keyof Layer>(field: K, value: Layer[K] | undefined, plain: Layer[K]) => {
      const kept = value === undefined ? existing?.[field] : value;
      if (kept !== undefined && kept !== plain) (layer as { [F in K]?: Layer[K] })[field] = kept;
    };
    const r12 = this.dxf === "R12";
    let linetype: string | undefined;
    if (o.linetype !== undefined) {
      if (r12 && !isBuiltIn(o.linetype, "Continuous")) fail("linetype", R12_ONLY.linetypes);
      linetype = this.#linetypeName(o.linetype, fail);
      const problem = layerLinetypeProblem(linetype);
      if (problem) fail("linetype", problem);
    }
    set(
      "linetype",
      linetype === undefined ? undefined : (builtInLinetype(linetype) ?? linetype),
      "Continuous",
    );
    if (o.lineweight !== undefined) {
      const problem = lineweightProblem(o.lineweight, "layer");
      if (problem) fail("lineweight", problem);
      if (r12 && o.lineweight !== "Default") fail("lineweight", R12_ONLY.lineweights);
    }
    set("lineweight", o.lineweight, "Default");
    for (const state of ["off", "frozen", "locked", "plot"] as const) {
      const value: unknown = o[state];
      const flagProblem = layerFlagProblem(state, value);
      if (flagProblem) fail("layer-state", flagProblem);
      if (r12 && value !== undefined && value !== (state === "plot")) {
        fail("layer-state", R12_ONLY.layerStates);
      }
      set(state, value as boolean | undefined, state === "plot");
    }
    const stateProblem = layerStateProblem(layer.name, layer.frozen);
    if (stateProblem) fail("layer-state", stateProblem);
    this.#layers.set(key, layer);
    if (!this.#audited.has(auditKey)) this.#audited.set(auditKey, layer.name);
    return layer;
  }

  line<
    T extends string = string,
    W extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
  >(from: Point, to: Point, options: EntityOptions<V, T, W, L, I> = {}): this {
    return this.#add(DrawingBuilder.prototype.line, options, () => ({
      kind: "line",
      layer: this.#current,
      from: pt(from),
      to: pt(to),
    }));
  }

  polyline<
    T extends string = string,
    W extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
  >(points: readonly Point[], closed = false, options: EntityOptions<V, T, W, L, I> = {}): this {
    return this.#add(DrawingBuilder.prototype.polyline, options, () => {
      if (points.length < 2) refuse("geometry", "A polyline needs at least 2 points");
      return { kind: "polyline", layer: this.#current, points: points.map(pt), closed };
    });
  }

  /** Closed rectangle from its lower-left corner. */
  rect<
    W extends number,
    H extends number,
    T extends string = string,
    LW extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
  >(
    corner: Point,
    width: Positive<W>,
    height: Positive<H>,
    options: EntityOptions<V, T, LW, L, I> = {},
  ): this {
    return this.#add(DrawingBuilder.prototype.rect, options, () => {
      const [x, y] = pt(corner);
      const w = positive(width, "width");
      const h = positive(height, "height");
      // A side can still vanish in the file: a corner and the one across from it may round together.
      if (written(x + w) === written(x)) refuse("geometry", lostSide("width", "x", x));
      if (written(y + h) === written(y)) refuse("geometry", lostSide("height", "y", y));
      const corners: Point[] = [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ];
      return { kind: "polyline", layer: this.#current, points: corners.map(pt), closed: true };
    });
  }

  circle<
    R extends number,
    T extends string = string,
    W extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
  >(center: Point, radius: Positive<R>, options: EntityOptions<V, T, W, L, I> = {}): this {
    return this.#add(DrawingBuilder.prototype.circle, options, () => ({
      kind: "circle",
      layer: this.#current,
      center: pt(center),
      radius: positive(radius, "radius"),
    }));
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
  arc<
    R extends number,
    T extends string = string,
    W extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
  >(
    center: Point,
    radius: Positive<R>,
    startAngle: number,
    endAngle: number,
    options: EntityOptions<V, T, W, L, I> = {},
  ): this {
    return this.#add(DrawingBuilder.prototype.arc, options, () => {
      const start = turn(num(startAngle, "startAngle"));
      const end = turn(num(endAngle, "endAngle"));
      if (start === end) refuse("geometry", "An arc's start and end angles must differ");
      const problem = arcProblem(start, end);
      if (problem) refuse("geometry", problem);
      return {
        kind: "arc",
        layer: this.#current,
        center: pt(center),
        radius: positive(radius, "radius"),
        startAngle: start,
        endAngle: end,
      };
    });
  }

  text<
    H extends number = number,
    T extends string = string,
    W extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
    S extends string = string,
    const D extends TextStyleValue = TextStyleDefinition,
  >(at: Point, value: string, options: TextOptions<H, V, T, W, L, I, S, D> = {}): this {
    return this.#add(DrawingBuilder.prototype.text, options, () => {
      const problem = textProblem(value);
      if (problem) refuse("text", problem);
      const text: { -readonly [K in keyof Text]: Text[K] } = {
        kind: "text",
        layer: this.#current,
        at: pt(at),
        value,
        height: positive(options.height ?? 0.125, "height"),
        rotation: kept(options.rotation ?? 0, "rotation"),
      };
      const r12 = this.dxf === "R12";
      if (options.style !== undefined) {
        const named: unknown = options.style;
        // An R12 drawing has no style to look up but Standard.
        if (r12 && !(typeof named === "string" && isStandardTextStyle(named))) {
          refuse("text-style", R12_ONLY.text);
        }
        const style = this.#textStyleName(options.style);
        if (style !== STANDARD_TEXT_STYLE) text.style = style;
      }
      const { align, valign }: { align?: unknown; valign?: unknown } = options;
      if (align !== undefined) {
        const alignProblem = textAlignProblem("align", align);
        if (alignProblem) refuse("text-align", alignProblem);
        if (align !== "left") {
          if (r12) refuse("text-align", R12_ONLY.text);
          text.align = align as TextAlign;
        }
      }
      if (valign !== undefined) {
        const alignProblem = textAlignProblem("valign", valign);
        if (alignProblem) refuse("text-align", alignProblem);
        if (valign !== "baseline") {
          if (r12) refuse("text-align", R12_ONLY.text);
          text.valign = valign as TextVerticalAlign;
        }
      }
      return text;
    });
  }

  build(): Drawing {
    const entities = [...this.#entities];
    if (this.#calls) recordCalls(entities, [...this.#calls]);
    return {
      format: 0,
      units: this.units,
      dxf: this.dxf,
      layers: [...this.#layers.values()],
      entities,
      linetypes: [...this.#linetypes.values()],
      linetypeScale: this.linetypeScale,
      ...(this.#textStyles.size > 0 ? { textStyles: [...this.#textStyles.values()] } : {}),
    };
  }

  /**
   * Checks the entity that `make` gives and the `EntityOptions` it was drawn with, whose type
   * parameters differ from method to method, and stores it. `method` is the builder method the
   * caller called, which a diagnostic names the call of.
   */
  #add(method: Method, options: object, make: () => Entity): this {
    const o = options as EntityOptions;
    const id: unknown = o.id;
    try {
      const key = id === undefined ? undefined : this.#idKey(id);
      const handle = key === undefined ? undefined : this.#idHandle(id as string);
      const named = id === undefined ? {} : { id: id as string };
      this.#entities.push({ ...make(), ...named, ...this.#style(o) });
      if (key !== undefined) this.#ids.set(key, id as string);
      if (handle !== undefined) this.#idHandles.set(handle, id as string);
    } catch (thrown) {
      throw located(thrown, method, typeof id === "string" ? { id } : {});
    }
    this.#calls?.push(holdCall(method));
    return this;
  }

  /** Checks an id the drawing does not have yet, and returns the key it is kept by. */
  #idKey(id: unknown): string {
    const problem = idProblem(id);
    if (problem) refuse("id", problem);
    const key = idKey(id as string);
    const first = this.#ids.get(key);
    if (first !== undefined) refuse("duplicate-id", duplicateIdProblem(id as string, first));
    return key;
  }

  /** Checks that no other id gave the handle this id gives, and returns the handle. */
  #idHandle(id: string): string {
    const handle = validIdHandle(id);
    const first = this.#idHandles.get(handle);
    if (first !== undefined) refuse("id-handle", idHandleProblem(id, first, handle));
    return handle;
  }

  /** The linetype and lineweight an entity is stored with. */
  #style(options: EntityOptions): EntityStyle {
    const style: { -readonly [K in keyof EntityStyle]: EntityStyle[K] } = {};
    if (options.linetype !== undefined) {
      if (this.dxf === "R12" && !isBuiltIn(options.linetype, "ByLayer")) {
        refuse("linetype", R12_ONLY.entityStyle);
      }
      const name = this.#linetypeName(options.linetype, refuse);
      const builtIn = builtInLinetype(name);
      if (builtIn !== "ByLayer") style.linetype = builtIn ?? name;
    }
    const weight: unknown = options.lineweight;
    if (weight !== undefined) {
      const problem = lineweightProblem(weight, "entity");
      if (problem) refuse("lineweight", problem);
      if (this.dxf === "R12" && weight !== "ByLayer") refuse("lineweight", R12_ONLY.entityStyle);
      if (weight !== "ByLayer") style.lineweight = weight as NonNullable<EntityStyle["lineweight"]>;
    }
    return style;
  }

  /**
   * The name of the linetype a layer or entity asks for, in the spelling the
   * drawing has it. A definition is defined first if the drawing does not have it.
   */
  #linetypeName(choice: unknown, fail: (rule: LintRule, problem: string) => never): string {
    if (typeof choice === "object" && choice !== null) {
      return this.#define(choice as LinetypeDefinition, true);
    }
    if (typeof choice !== "string") {
      return fail("undefined-linetype", "A linetype is a name or a LinetypeDefinition");
    }
    const problem = linetypeNameProblem(choice);
    if (problem) fail("undefined-linetype", `Linetype ${JSON.stringify(choice)}: ${problem}`);
    const known = builtInLinetype(choice) ?? this.#linetypes.get(layerKey(choice))?.name;
    if (known === undefined) {
      const absent = `${undefinedLinetypeProblem(choice)}. Define it with linetype() first`;
      fail("undefined-linetype", absent);
    }
    return known as string;
  }

  /**
   * Checks a definition and stores it, and returns the name the drawing has it by. A
   * definition given to a layer or an entity must match the one the drawing has of its name,
   * where `linetype()` replaces it.
   */
  #define(definition: LinetypeDefinition, inline = false): string {
    const label = `Linetype ${JSON.stringify(definition.name)}`;
    const problem = linetypeProblem(
      definition.name,
      definition.description ?? "",
      definition.pattern,
    );
    if (problem) refuse("linetype", `${label}: ${problem}`);
    // linetypeProblem has checked the types.
    const name = definition.name as string;
    const description = (definition.description ?? "") as string;
    const lengths = definition.pattern as readonly number[];
    const key = layerKey(name);
    const auditKey = layerAuditKey(name);
    const twin = layerTwinProblem(name, this.#linetypesAudited.get(auditKey) ?? name, "linetype");
    if (twin) refuse("duplicate-linetype", `${label}: ${twin}`);
    const existing = this.#linetypes.get(key);
    if (inline && existing) {
      const same =
        existing.description === description &&
        existing.pattern.length === lengths.length &&
        existing.pattern.every((length, i) => length === lengths[i]);
      if (!same) {
        refuse(
          "linetype",
          `${label}: the drawing has a linetype of this name with another pattern or description. Pass its name, or change it with linetype()`,
        );
      }
      return existing.name;
    }
    const stored = existing?.name ?? name;
    this.#linetypes.set(key, {
      name: stored,
      description,
      pattern: [...lengths],
    });
    if (!this.#linetypesAudited.has(auditKey)) this.#linetypesAudited.set(auditKey, name);
    return stored;
  }

  /**
   * The name of the text style a text asks for, in the spelling the drawing has it. A
   * definition is defined first if the drawing does not have it.
   */
  #textStyleName(choice: unknown): string {
    if (typeof choice === "object" && choice !== null) {
      return this.#defineTextStyle(choice as TextStyleDefinition, true);
    }
    if (typeof choice !== "string") {
      return refuse("undefined-text-style", "A text style is a name or a TextStyleDefinition");
    }
    const problem = textStyleNameProblem(choice);
    if (problem) {
      refuse("undefined-text-style", `Text style ${JSON.stringify(choice)}: ${problem}`);
    }
    if (isStandardTextStyle(choice)) return STANDARD_TEXT_STYLE;
    const known = this.#textStyles.get(layerKey(choice))?.name;
    if (known === undefined) {
      const absent = `${undefinedTextStyleProblem(choice)}. Define it with textStyle() first`;
      refuse("undefined-text-style", absent);
    }
    return known as string;
  }

  /**
   * Checks a text style and stores it, and returns the name the drawing has it by. A definition
   * given to a text must match the one the drawing has of its name, where `textStyle()`
   * replaces it.
   */
  #defineTextStyle(definition: TextStyleDefinition, inline = false): string {
    const label = `Text style ${JSON.stringify(definition.name)}`;
    const problem = textStyleProblem(
      definition.name,
      definition.font,
      definition.widthFactor ?? 1,
      definition.obliqueAngle ?? 0,
    );
    if (problem) refuse("text-style", `${label}: ${problem}`);
    // textStyleProblem has checked the types.
    const name = definition.name as string;
    const font = definition.font as string;
    const widthFactor = (definition.widthFactor ?? 1) as number;
    const obliqueAngle = (definition.obliqueAngle ?? 0) as number;
    const key = layerKey(name);
    const auditKey = layerAuditKey(name);
    const first = this.#textStylesAudited.get(auditKey) ?? name;
    const twin = layerTwinProblem(name, first, "text style");
    if (twin) refuse("duplicate-text-style", `${label}: ${twin}`);
    const existing = this.#textStyles.get(key);
    if (inline && existing) {
      const same =
        existing.font === font &&
        (existing.widthFactor ?? 1) === widthFactor &&
        (existing.obliqueAngle ?? 0) === obliqueAngle;
      if (!same) {
        refuse(
          "text-style",
          `${label}: the drawing has a text style of this name with another font, width factor or oblique angle. Pass its name, or change it with textStyle()`,
        );
      }
      return existing.name;
    }
    const stored = existing?.name ?? name;
    this.#textStyles.set(key, {
      name: stored,
      font,
      ...(widthFactor === 1 ? {} : { widthFactor }),
      ...(obliqueAngle === 0 ? {} : { obliqueAngle }),
    });
    if (!this.#textStylesAudited.has(auditKey)) this.#textStylesAudited.set(auditKey, name);
    return stored;
  }
}

export function createDrawing<V extends DxfVersion = "R2018", S extends number = number>(
  options?: DrawingOptions<V, S>,
): DrawingBuilder<V> {
  return new DrawingBuilder(options as DrawingOptions<V>);
}

/** True when `choice` names the built-in linetype `name`, in any case. */
function isBuiltIn(choice: unknown, name: "ByLayer" | "Continuous"): boolean {
  return typeof choice === "string" && builtInLinetype(choice) === name;
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
  if (!Number.isFinite(value)) refuse("geometry", `${label} must be a finite number`);
  return value;
}

/** Takes `unknown` because a `Positive<N>` parameter is a message string when the literal is wrong. */
function positive(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return refuse("geometry", `${label} must be a finite number`);
  }
  const problem = sizeProblem(value);
  if (problem) refuse("geometry", `${label}: ${problem}`);
  return value;
}

function lostSide(size: string, axis: string, at: number): string {
  return `${size}: This value is too small at ${axis} = ${at}. Both sides of the rectangle are written as ${axis} = ${fmt(at)}, because tsdraft writes 6 decimals`;
}

/** A number the drawing keeps and the writers print, which AutoCAD must be able to read. */
function kept(value: number, label: string): number {
  const problem = magnitudeProblem(num(value, label));
  if (problem) refuse("geometry", `${label}: ${problem}`);
  return value;
}

function pt(point: Point): Point {
  return [kept(point[0], "x"), kept(point[1], "y")];
}
