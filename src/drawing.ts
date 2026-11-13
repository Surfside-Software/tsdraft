import {
  definitionHandle,
  insertAttributeHandle,
  insertEndHandle,
  blockHandles,
  placeAttribute,
} from "./blocks.ts";
import {
  arrowheadInfo,
  DEFAULT_ARROWHEAD,
  type Arrowhead,
  type ZERO_SUPPRESSIONS,
} from "./arrowheads.ts";
import { holdCall, readCall, recordCalls, type CallSite, type HeldCall } from "./callsite.ts";
import {
  arrowheadEntityHandle,
  dimensionAngle,
  dimensionDrawnProblem,
  pictureHandleList,
  pictureOwner,
  validDimensionPictureHandles,
  validDimensionStyleHandle,
  type DimensionPlace,
} from "./dimensions.ts";
import { STANDARD_TEXT_STYLE } from "./fonts.ts";
import { fmt, written } from "./format.ts";
import { validIdHandle } from "./handles.ts";
import { layerAuditKey, layerKey, layoutNameKey } from "./layers.ts";
import { validLayoutHandles } from "./layouts.ts";
import { fromPaper, type PaperUnit } from "./paper.ts";
import { paperInfo, type Paper, type PaperInfo, type PlotStyleTable } from "./papers.ts";
import { BUILT_IN_LINETYPES, builtInLinetype } from "./linetypes.ts";
import { DrawingError, type Diagnostic, type LintRule } from "./lint.ts";
import {
  arcProblem,
  ATTRIBUTES_SHAPE,
  attributeTagProblem,
  blockCycleProblem,
  blockNameProblem,
  blockTwinProblem,
  DIMENSION_IN_BLOCK,
  dimensionStyleNameProblem,
  dimensionStyleProblem,
  dimensionStyleTwinProblem,
  dimensionAngleProblem,
  dimensionTextProblem,
  duplicateAttributeProblem,
  duplicateIdProblem,
  handleProblem,
  idHandleProblem,
  idKey,
  idProblem,
  isStandardDimensionStyle,
  isStandardTextStyle,
  placedAttributeProblem,
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
  layoutNameProblem,
  layoutTwinProblem,
  paperProblem,
  plotStyleProblem,
  R12_ONLY,
  scaleProblem,
  sizeProblem,
  textAlignProblem,
  textProblem,
  textStyleNameProblem,
  textStyleProblem,
  undefinedAttributeProblem,
  undefinedBlockProblem,
  undefinedDimensionStyleProblem,
  undefinedDimensionTextStyleProblem,
  undefinedLinetypeProblem,
  undefinedTextStyleProblem,
  viewportProblem,
  XREF_ATTRIBUTES,
  xrefPathProblem,
  xrefTwinProblem,
  type ArrowheadOf,
  type AttributeTag,
  type BlockName,
  type DimensionAffix,
  type DimensionPrefix,
  type DimensionScale,
  type DimensionStyleName,
  type DimensionText,
  type Description,
  type EntityId,
  type FontOf,
  type FrozenCurrent,
  type InsertScale,
  type LayerLinetypeName,
  type LineweightMm,
  type LineweightOf,
  type LinetypeName,
  type MeasurementScale,
  type NewDimensionStyleName,
  type NewLinetypeName,
  type NewTextStyleName,
  type NotNegative,
  type ObliqueAngle,
  type Pattern,
  type Precision,
  type R12Blocks,
  type R12Dimensions,
  type R12EntityStyle,
  type R12LayerStates,
  type R12Lineweights,
  type R12Linetypes,
  type R12Text,
  type R12Xrefs,
  type TextGap,
  type TextStyleName,
  type WidthFactor,
  type XrefPath,
  type LayerColor,
  type LayerName,
  type LayoutName,
  type PaperLength,
  type PaperOf,
  type Positive,
  type R12Layouts,
  type Ratio,
  type TEXT_ALIGNS,
  type TEXT_VERTICAL_ALIGNS,
} from "./rules.ts";
import type {
  Standard,
  StandardDimensionStyle,
  StandardLayer,
  StandardLinetype,
  StandardScale,
  StandardTextRole,
} from "./standard/document.ts";
import {
  dimensionStyleLacks,
  dimensionStyleReserved,
  disciplineLacks,
  DRAWN,
  layerLacks,
  layoutPaperUnitsProblem,
  linetypeLacks,
  noDefaultDimensionStyle,
  penLacks,
  penLineweightProblem,
  roleBlockWithoutView,
  roleLacks,
  roleTextStyleProblem,
  scaleLacks,
  unnamedDisciplineProblem,
  viewNotDeclared,
  writingLacks,
  type DimensionStyleDefined,
  type DimensionStyleOfStandard,
  type DisciplineWithoutStandard,
  type InsertViewAndScale,
  type LinetypeDefined,
  type PenWithoutStandard,
  type DisciplineOfStandard,
  type LayerOfStandard,
  type RoleAndHeight,
  type RoleAndStyle,
  type RoleOfStandard,
  type RoleWithoutStandard,
  type ScaleOfStandard,
  type ScaleWithoutStandard,
  type StandardLayerOptions,
  type LinetypeOfStandard,
  type StandardLinetypeScale,
  type LineweightUnderStandard,
  type PenOfStandard,
  type StandardR12,
  type ViewportId,
  type ViewportRatio,
  type ViewWithoutStandard,
} from "./standard/drawn.ts";
import { adopted } from "./standard/made.ts";
import { capitals } from "./standard/rules.ts";

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

interface Placed {
  /**
   * A name for this entity that stays the same when the drawing's code changes around it: 1 to
   * 64 letters A to Z or a to z, digits, `.`, `-` and `_`. No two entities of a drawing share
   * one, whatever its case, in model space or in a block.
   */
  readonly id?: string;
  /**
   * The entity's layer. In a block, layer `"0"` stands for the layer of the insert that
   * places the block.
   */
  readonly layer: string;
}

interface EntityBase extends Placed {
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

/**
 * A block placed at a point. It draws the block's entities there, scaled and turned about the
 * block's base point, and carries a value for each of the block's attribute definitions. An
 * insert of an xref places the file the xref names the same way, and sets no attributes.
 */
export interface Insert extends Placed {
  readonly kind: "insert";
  /** A block or an xref of the drawing. */
  readonly block: string;
  /** Where the block's base point goes. */
  readonly at: Point;
  /** The scale along the block's X and Y. Defaults to `[1, 1]`. A negative scale mirrors. */
  readonly scale?: readonly [x: number, y: number];
  /** Degrees counterclockwise. Defaults to 0. */
  readonly rotation?: number;
  /**
   * The value of each attribute this insert sets, by its tag. An attribute it does not set has
   * its definition's default value.
   */
  readonly attributes?: Readonly<Record<string, string>>;
}

/** What a linear and an aligned dimension share. */
interface DimensionBase extends Placed {
  /** A dimension style of the drawing. */
  readonly style: string;
  /** The first point it measures from, which its first extension line starts at. */
  readonly from: Point;
  /** The second point, which its second extension line starts at. */
  readonly to: Point;
  /**
   * A text to draw in place of the measurement. `<>` in it stands for the measurement as the
   * style writes it, so `"<> TYP"` adds to it and `"VARIES"` replaces it.
   */
  readonly text?: string;
}

/**
 * A linear dimension: the distance between two points along one direction, which is along X
 * unless `angle` says otherwise. AutoCAD holds it as a dimension, measures it again when its
 * points move, and writes the measurement as its style says.
 */
export interface LinearDimension extends DimensionBase {
  readonly kind: "linear-dimension";
  /** A point the dimension line passes through. */
  readonly line: Point;
  /**
   * The direction it measures along, in degrees counterclockwise from +X: 0 along X, 90 along
   * Y. Defaults to 0.
   */
  readonly angle?: number;
}

/**
 * An aligned dimension: the distance between two points, with its dimension line parallel to
 * the line between them.
 */
export interface AlignedDimension extends DimensionBase {
  readonly kind: "aligned-dimension";
  /**
   * How far the dimension line stands off the two points: to the left of the way from `from`
   * to `to` when it is greater than 0, and to the right when it is less.
   */
  readonly offset: number;
}

export type Entity =
  | Line
  | Polyline
  | Circle
  | Arc
  | Text
  | Insert
  | LinearDimension
  | AlignedDimension;

/**
 * A dimension style: how the dimensions that name it are drawn and how they write what they
 * measure. Its sizes are the sizes its dimensions plot at, each multiplied by `scale`, so a
 * style for another view is the same style with another scale.
 *
 * tsdraft draws every dimension the same way where a style has no choice: the text is above
 * the dimension line, between the extension lines and along the line, and the measurement is
 * in decimal units.
 */
export interface DimensionStyle {
  readonly name: string;
  /** The text style of the dimension's text. Defaults to `"Standard"`. */
  readonly textStyle?: string;
  /** The height of the text. */
  readonly textHeight: number;
  /** One of `ARROWHEADS`. Defaults to `"closed-filled"`. */
  readonly arrowhead?: string;
  /** The length of an arrowhead, or 0 for none. */
  readonly arrowSize: number;
  /** How far from its point an extension line starts. */
  readonly extensionOffset: number;
  /** How far an extension line runs past the dimension line. */
  readonly extensionBeyond: number;
  /** The gap between the dimension line and the text above it. */
  readonly textGap: number;
  /**
   * What every size of the style is multiplied by: how many units of the dimension's space one
   * unit of the sizes is. Defaults to 1.
   */
  readonly scale?: number;
  /** The decimals a measurement is written with, from 0 to 8. */
  readonly precision: number;
  /** Written before each measurement. */
  readonly prefix?: string;
  /** Written after each measurement. */
  readonly suffix?: string;
  /**
   * The zeros a measurement leaves out: `"leading"` writes 0.5 as `.5`, `"trailing"` writes
   * 52.50 as `52.5` and 52.00 as `52`, and `"both"` does both. Defaults to none.
   */
  readonly suppressZeros?: (typeof ZERO_SUPPRESSIONS)[number];
  /** What a length is multiplied by before it is written. Defaults to 1. */
  readonly measurementScale?: number;
}

/**
 * An attribute definition of a block: a text that each insert of the block carries with a
 * value of its own, under a tag. It is placed and justified as a `Text` is, in the block's
 * coordinates.
 */
export interface AttributeDefinition {
  /** The name of the attribute in its block, with no lower-case letter a to z. */
  readonly tag: string;
  /** What CAD asks for when the block is inserted by hand. Defaults to the tag. */
  readonly prompt?: string;
  /** The value of an insert that does not set this attribute. */
  readonly value: string;
  /** The layer of the attribute on each insert. `"0"` stands for the insert's layer. */
  readonly layer: string;
  readonly at: Point;
  readonly height: number;
  /** Degrees counterclockwise. */
  readonly rotation: number;
  /** A text style of the drawing. Defaults to `"Standard"`. */
  readonly style?: string;
  /** Defaults to `"left"`. */
  readonly align?: TextAlign;
  /** Defaults to `"baseline"`. */
  readonly valign?: TextVerticalAlign;
}

/**
 * A block: entities drawn once, under a name, and placed any number of times by inserts. Its
 * coordinates are its own, and `base` is the point of them that an insert puts at its `at`.
 */
export interface Block {
  readonly name: string;
  /** Defaults to `[0, 0]`. */
  readonly base?: Point;
  /** What every insert draws. An insert here places another block inside this one. */
  readonly entities: readonly Entity[];
  /** The attribute definitions, in the order CAD asks for their values. */
  readonly attributes?: readonly AttributeDefinition[];
}

/**
 * An external reference, or xref: another drawing's DWG file, which AutoCAD loads each time it
 * opens this drawing and draws wherever an insert of `name` places it. The drawing holds the
 * file's path and nothing of what the file draws.
 */
export interface Xref {
  /** A block name, which no block and no other xref of the drawing has. An insert names it. */
  readonly name: string;
  /**
   * The path of the DWG file from the folder of this drawing's file, with `\` or `/` between
   * folders, such as `"base.dwg"` or `"..\\survey\\base.dwg"`.
   */
  readonly path: string;
}

/**
 * A viewport: a rectangle on a layout's paper that shows model space at a scale. Its view is
 * locked, so that zooming inside it in CAD does not change the scale.
 */
export interface Viewport {
  /**
   * A name for the viewport that no entity and no other viewport of the drawing has, as an
   * entity's `id` is.
   */
  readonly id?: string;
  /**
   * The layer of the viewport's border. A viewport shows model space whether its layer plots
   * or not, and its border plots when its layer does.
   */
  readonly layer: string;
  /** The lower-left corner of the rectangle, in paper units. */
  readonly corner: Point;
  /** In paper units. */
  readonly width: number;
  /** In paper units. */
  readonly height: number;
  /** The point of model space shown at the middle of the rectangle, in drawing units. */
  readonly center: Point;
  /**
   * How many times larger the model is than its plot, as `fromPaper` takes it: 120 for
   * 1" = 10', 96 for 1/8" = 1'-0", 50 for 1:50.
   */
  readonly ratio: number;
}

/**
 * A layout: a sheet of paper with its page setup, what is drawn on it in paper units, and the
 * viewports that show model space on it. AutoCAD shows each layout as a tab and plots it as
 * one page: on `DWG To PDF.pc3`, at 1:1, with the lineweights its entities have.
 */
export interface Layout {
  /** The name on the layout's tab. */
  readonly name: string;
  /** One of `PAPERS`. Its units are the layout's paper units. */
  readonly paper: string;
  /** One of `PLOT_STYLE_TABLES`. Defaults to `"monochrome.ctb"`, which plots in black. */
  readonly plotStyle?: string;
  readonly viewports: readonly Viewport[];
  /** What is drawn on the paper, in paper units from its lower-left corner. */
  readonly entities: readonly Entity[];
}

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
  /** The blocks that inserts place. */
  readonly blocks?: readonly Block[];
  /** The DWG files the drawing references, which inserts place as they place blocks. */
  readonly xrefs?: readonly Xref[];
  /** The drawing's sheets. AutoCAD opens a drawing that has one on the first. */
  readonly layouts?: readonly Layout[];
  /** The dimension styles that dimensions name. */
  readonly dimensionStyles?: readonly DimensionStyle[];
}

/**
 * What `createDrawing` takes.
 *
 * @typeParam Z - The standard the drawing is drawn to, or `undefined` for none.
 * @typeParam D - The drawing's discipline as written.
 */
export interface DrawingOptions<
  V extends DxfVersion = DxfVersion,
  S extends number = number,
  Z extends Standard | undefined = undefined,
  D extends string = string,
> {
  /** Defaults to `"in"`. */
  readonly units?: Units;
  /**
   * The DXF version to check the drawing against and export. Defaults to `"R2018"`, which a
   * drawing drawn to a standard is.
   */
  readonly dxf?: Z extends Standard ? (V extends "R12" ? StandardR12 : V) : V;
  /**
   * The global linetype scale, which multiplies every linetype's pattern. Defaults to 1. Under a
   * standard it is the standard's, and may not be given.
   */
  readonly linetypeScale?: Z extends Standard
    ? StandardLinetypeScale
    : V extends "R12"
      ? 1 | R12Linetypes
      : Positive<S>;
  /**
   * The standard the drawing is drawn to, which `defineStandard` returns. `layer()` then names a
   * layer of the standard, which gives its color, linetype, lineweight and plot flag, an entity's
   * `pen` names a pen of it, and the linetype scale is the standard's.
   */
  readonly standard?: Z;
  /**
   * The drawing's discipline, a discipline of the standard: a model drawing's, or a sheet's, under
   * `sheetFiles` `"sheet-per-file"`. An entry of the standard with `byDiscipline` takes that
   * discipline's fields.
   */
  readonly discipline?: Z extends Standard ? DisciplineOfStandard<D, Z> : DisciplineWithoutStandard;
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
 * @typeParam Z - The drawing's standard, or `undefined` for none.
 * @typeParam P - The pen as written.
 */
export interface EntityOptions<
  V extends DxfVersion = "R2018",
  T extends string = string,
  W extends number = number,
  L extends LinetypeValue = LinetypeDefinition,
  I extends string = string,
  Z extends Standard | undefined = undefined,
  P extends string = string,
> {
  /**
   * A name for the entity that no other entity of the drawing has: 1 to 64 letters A to Z or a
   * to z, digits, `.`, `-` and `_`. Diagnostics and `toSVG` carry it.
   */
  readonly id?: EntityId<I>;
  /**
   * A linetype of the drawing, `"Continuous"`, `"ByBlock"` or `"ByLayer"`. R2018 only. Under a
   * standard, a linetype of the standard by name, which the drawing then has.
   */
  readonly linetype?: Z extends Standard
    ? LinetypeOfStandard<L, Z>
    : V extends "R12"
      ? R12LinetypeChoice<T, L, "bylayer", R12EntityStyle>
      : LinetypeChoice<T, L>;
  /**
   * In millimetres, or `"ByLayer"`, `"ByBlock"` or `"Default"`. R2018 only. Under a standard,
   * `"ByLayer"` or `"ByBlock"`, and a pen gives a lineweight.
   */
  readonly lineweight?: Z extends Standard
    ? LineweightUnderStandard<W>
    : V extends "R12"
      ? "ByLayer" | R12EntityStyle
      : LineweightOf<W> | "ByLayer" | "ByBlock" | "Default";
  /** A pen of the drawing's standard, whose lineweight the entity takes. */
  readonly pen?: Z extends Standard ? PenOfStandard<P, Z> : PenWithoutStandard;
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
 * @typeParam R - The role as written.
 */
export type TextOptions<
  H extends number = number,
  V extends DxfVersion = "R2018",
  T extends string = string,
  W extends number = number,
  L extends LinetypeValue = LinetypeDefinition,
  I extends string = string,
  S extends string = string,
  D extends TextStyleValue = TextStyleDefinition,
  Z extends Standard | undefined = undefined,
  P extends string = string,
  R extends string = string,
> = EntityOptions<V, T, W, L, I, Z, P> &
  TextPlacement<V, Z> &
  Sized<
    Z,
    R,
    Positive<H>,
    V extends "R12" ? typeof STANDARD_TEXT_STYLE | R12Text : TextStyleChoice<S, D>
  >;

/** Where a text is turned and justified, and in model space the view it is read in. */
interface TextPlacement<V extends DxfVersion, Z extends Standard | undefined> {
  /** Degrees counterclockwise. */
  readonly rotation?: number;
  /** In model space, the view a text with a role is read in, which `view()` returns. */
  readonly view?: Z extends Standard ? View : ViewWithoutStandard;
  /** Where `at` is along the text's line. Defaults to `"left"`. R2018 only. */
  readonly align?: V extends "R12" ? "left" | R12Text : TextAlign;
  /** Where `at` is up and down the text's line. Defaults to `"baseline"`. R2018 only. */
  readonly valign?: V extends "R12" ? "baseline" | R12Text : TextVerticalAlign;
}

/**
 * The role, height and style of a text or an attribute, where `Height` and `Style` are what it
 * takes without a role. Under a standard a literal role gives the height and the style, and the
 * options are one of two whole shapes, with the role or with none, so each branch of a
 * conditional is checked as written. A role that is not a literal is checked when the code runs.
 * One conditional on `Z` around both shapes would make a builder without a standard not
 * assignable to one whose standard may be any.
 */
type Sized<Z extends Standard | undefined, R extends string, Height, Style> =
  | Size<
      Z extends Standard ? RoleOfStandard<R, Z> : RoleWithoutStandard,
      RoleOr<Z, R, Height, RoleAndHeight>,
      RoleOr<Z, R, Style, RoleAndStyle>
    >
  | (Z extends Standard ? (string extends R ? never : Size<undefined, Height, Style>) : never);

/**
 * `Given` for a text with no role, or a role that is not a literal, and `Message` for a text with
 * a literal role under a standard, which takes no height and no style of its own.
 */
type RoleOr<Z extends Standard | undefined, R extends string, Given, Message> = Z extends Standard
  ? string extends R
    ? Given
    : Message
  : Given;

interface Size<Role, Height, Style> {
  /**
   * A text role of the drawing's standard, which gives the text its text style and the height it
   * plots at: that height on a layout and in a block, and `view.paper` of it in model space.
   */
  readonly role?: Role;
  /** Defaults to 0.125. A text with a role takes the role's. */
  readonly height?: Height;
  /**
   * A text style of the drawing, or a definition of one. Defaults to `"Standard"`. R2018 only. A
   * text with a role is in the role's text style.
   */
  readonly style?: Style;
}

/** What `block()` sets on a block. */
export interface BlockOptions {
  /** The point of the block that an insert puts at its `at`. Defaults to `[0, 0]`. */
  readonly base?: Point;
}

/**
 * The options of `attribute()`: the definition's default value and prompt, and its height,
 * rotation, style and justification, which are a text's.
 *
 * @typeParam D - The text style as written, a name or a definition, checked as a text's is.
 * @typeParam R - The role as written.
 */
export type AttributeOptions<
  H extends number = number,
  S extends string = string,
  D extends TextStyleValue = TextStyleDefinition,
  Z extends Standard | undefined = undefined,
  R extends string = string,
> = AttributeFields & Sized<Z, R, Positive<H>, TextStyleChoice<S, D>>;

/** What an attribute definition holds besides its role, height and style. */
interface AttributeFields {
  /** The value of an insert that does not set the attribute. Defaults to `""`. */
  readonly value?: string;
  /** What CAD asks for when the block is inserted by hand. Defaults to the tag. */
  readonly prompt?: string;
  /** Degrees counterclockwise. */
  readonly rotation?: number;
  /** Where `at` is along the text's line. Defaults to `"left"`. */
  readonly align?: TextAlign;
  /** Where `at` is up and down the text's line. Defaults to `"baseline"`. */
  readonly valign?: TextVerticalAlign;
}

/**
 * The options of `insert()`. Under a standard they are one of two whole shapes, with a view or
 * with a scale, and each branch of a conditional is checked as written.
 *
 * @typeParam Z - The drawing's standard, or `undefined` for none.
 */
export type InsertOptions<
  S extends number | readonly [number, number] = number,
  I extends string = string,
  Z extends Standard | undefined = undefined,
> = InsertFields<I> &
  (Z extends Standard
    ?
        | (Scaled<View, InsertViewAndScale> & { readonly view: View })
        | Scaled<undefined, InsertScale<S>>
    : Scaled<ViewWithoutStandard, InsertScale<S>>);

/** What an insert holds besides its scale and its view. */
interface InsertFields<I extends string> {
  /**
   * A name for the insert that no other entity of the drawing has. The insert's attributes
   * keep their handles with it.
   */
  readonly id?: EntityId<I>;
  /** Degrees counterclockwise, about the insert's point. Defaults to 0. */
  readonly rotation?: number;
  /** A value for each attribute to set, by its tag. The others have their default values. */
  readonly attributes?: Readonly<Record<string, string>>;
}

interface Scaled<ViewOf, Scale> {
  /**
   * One number for both axes, or `[x, y]`. Defaults to 1. A negative scale mirrors the block,
   * and no scale may be 0. An insert with a view takes the view's.
   */
  readonly scale?: Scale;
  /**
   * In model space, the view the insert is read in, which `view()` returns. The insert's scale
   * is then `view.paper(1)`, so a block drawn in paper units plots at its size. An insert in model
   * space of a block that holds texts with roles names one.
   */
  readonly view?: ViewOf;
}

/**
 * A dimension style to define: a `DimensionStyle`, checked. Its sizes are lengths on paper, in
 * the unit that suits the sheet, and `scale` turns them into the units of the space its
 * dimensions are drawn in: `fromPaper(1, "in", view)` for model space seen at a view's ratio,
 * and 1 on a layout.
 */
export interface DimensionStyleDefinition<
  N extends string = string,
  S extends string = string,
  H extends number = number,
  A extends string = string,
  AS extends number = number,
  EO extends number = number,
  EB extends number = number,
  G extends number = number,
  SC extends number = number,
  P extends number = number,
  PRE extends string = string,
  SUF extends string = string,
  MS extends number = number,
> {
  readonly name: NewDimensionStyleName<N>;
  /** A text style of the drawing. Defaults to `"Standard"`. */
  readonly textStyle?: TextStyleName<S>;
  /** The height of the text, greater than 0. */
  readonly textHeight: Positive<H>;
  /** One of `ARROWHEADS`. Defaults to `"closed-filled"`. */
  readonly arrowhead?: ArrowheadOf<A>;
  /** The length of an arrowhead, or 0 for none. */
  readonly arrowSize: NotNegative<AS>;
  /** How far from its point an extension line starts. */
  readonly extensionOffset: NotNegative<EO>;
  /** How far an extension line runs past the dimension line. */
  readonly extensionBeyond: NotNegative<EB>;
  /** The gap between the dimension line and the text above it. */
  readonly textGap: TextGap<G>;
  /** What every size is multiplied by, greater than 0. Defaults to 1. */
  readonly scale?: DimensionScale<SC>;
  /** The decimals a measurement is written with, from 0 to 8. */
  readonly precision: Precision<P>;
  /** Written before each measurement. */
  readonly prefix?: DimensionPrefix<PRE>;
  /** Written after each measurement, such as `"'"` for feet. */
  readonly suffix?: DimensionAffix<SUF>;
  /** The zeros a measurement leaves out. Defaults to none. */
  readonly suppressZeros?: (typeof ZERO_SUPPRESSIONS)[number];
  /** What a length is multiplied by before it is written, greater than 0. Defaults to 1. */
  readonly measurementScale?: MeasurementScale<MS>;
}

/** What every dimension is drawn with. */
interface DimensionOptions<
  S extends string = string,
  T extends string = string,
  I extends string = string,
> {
  /** A dimension style of the drawing. */
  readonly style: DimensionStyleName<S>;
  /**
   * A text to draw in place of the measurement, in which `<>` stands for the measurement:
   * `"<> TYP"`, or `"VARIES"`.
   */
  readonly text?: DimensionText<T>;
  /** A name for the dimension that no other entity of the drawing has. */
  readonly id?: EntityId<I>;
  readonly view?: ViewWithoutStandard;
}

/** The options of `linearDimension()`. */
export interface LinearDimensionOptions<
  S extends string = string,
  T extends string = string,
  I extends string = string,
> extends DimensionOptions<S, T, I> {
  /**
   * The direction it measures along: `"x"`, the default, `"y"`, or an angle in degrees
   * counterclockwise from +X.
   */
  readonly along?: "x" | "y" | number;
}

/** The options of `alignedDimension()`. */
export type AlignedDimensionOptions<
  S extends string = string,
  T extends string = string,
  I extends string = string,
> = DimensionOptions<S, T, I>;

/**
 * What a dimension is drawn with under the standard `Z`: a dimension style of the standard by its
 * id, and in model space the view it is read in. The builder defines the style's AutoCAD style on
 * first use, with the standard's paper sizes, its role's text style and height, and the writing of
 * the units it is drawn in: `DIMS-1in-10ft` for the style `dims` in a view at `1in-10ft`, scaled
 * by `view.paper(1)`, and `DIMS` on a layout.
 */
export interface StandardAlignedDimensionOptions<
  S extends string = string,
  T extends string = string,
  I extends string = string,
  Z extends Standard = Standard,
> {
  /** A dimension style of the standard, by its id. Defaults to its `defaultDimensionStyle`. */
  readonly style?: DimensionStyleOfStandard<S, Z>;
  /** In model space, the view the dimension is read in, which `view()` returns. */
  readonly view?: View;
  /**
   * A text to draw in place of the measurement, in which `<>` stands for the measurement:
   * `"<> TYP"`, or `"VARIES"`.
   */
  readonly text?: DimensionText<T>;
  /** A name for the dimension that no other entity of the drawing has. */
  readonly id?: EntityId<I>;
}

/** The options of `linearDimension()` under the standard `Z`. */
export interface StandardLinearDimensionOptions<
  S extends string = string,
  T extends string = string,
  I extends string = string,
  Z extends Standard = Standard,
> extends StandardAlignedDimensionOptions<S, T, I, Z> {
  /**
   * The direction it measures along: `"x"`, the default, `"y"`, or an angle in degrees
   * counterclockwise from +X.
   */
  readonly along?: "x" | "y" | number;
}

/** What `layout()` sets on a layout. */
export interface LayoutOptions<P extends string = string> {
  /** One of `PAPERS`, such as `"ARCH D"`. */
  readonly paper: PaperOf<P>;
  /** Defaults to `"monochrome.ctb"`, which plots every color in black. */
  readonly plotStyle?: PlotStyleTable;
}

/** The view of a viewport: what `viewport()` takes after the rectangle. */
export interface ViewportOptions<R extends number = number, I extends string = string> {
  /** The point of model space shown at the middle of the viewport, in drawing units. */
  readonly center: Point;
  /**
   * How many times larger the model is than its plot, as `fromPaper` takes it: 120 for
   * 1" = 10', 96 for 1/8" = 1'-0", 50 for 1:50.
   */
  readonly ratio: Ratio<R>;
  /** A name for the viewport that no entity and no other viewport of the drawing has. */
  readonly id?: EntityId<I>;
  readonly view?: ViewWithoutStandard;
}

/** What `viewport()` takes after the rectangle under a standard: the view it shows. */
export interface StandardViewportOptions {
  /**
   * The view the viewport shows, which `view()` returns. The viewport takes its id, and its ratio
   * from its scale. One viewport shows a view.
   */
  readonly view: View;
  /** The point of model space shown at the middle of the viewport, in drawing units. */
  readonly center: Point;
  readonly ratio?: ViewportRatio;
  readonly id?: ViewportId;
}

/**
 * A view: a scale of the drawing's standard under an id, which `view()` declares. One viewport
 * shows it, and takes its id. A text, an insert or a dimension of model space names the view it is
 * read in, so that it plots at its size in paper units.
 */
export interface View<I extends string = string, C extends string = string> {
  /** The view's id, an entity id of the drawing, which the viewport that shows it takes. */
  readonly id: I;
  /** The id of its scale in the standard. */
  readonly scale: C;
  /** The scale's label, such as `1" = 10'`. */
  readonly label: string;
  /** The scale's ratio, such as 120 for 1" = 10'. */
  readonly ratio: number;
  /**
   * A length on paper, in the standard's paper units, in drawing units at the view's ratio, as
   * `fromPaper(length, standard.paperUnits, { ratio, units })` works it out for the drawing's
   * units. A length that `fromPaper` refuses throws a `DrawingError` under `geometry`, with the
   * call.
   */
  paper<L extends number>(length: PaperLength<L>): number;
}

/**
 * The layout being drawn, which `layout()` gives its `draw`: the sheet's size, and the one
 * thing only a layout can hold, a viewport. Everything else is drawn with the builder's own
 * methods, which put it on the sheet while `draw` runs.
 *
 * @typeParam Z - The drawing's standard, or `undefined` for none.
 */
export interface Sheet<Z extends Standard | undefined = undefined> {
  /** The layout's name. */
  readonly name: string;
  readonly paper: Paper;
  /** The units of the paper, which are the units of everything drawn on the sheet. */
  readonly units: PaperUnit;
  /** The paper's size, in its units. The sheet's lower-left corner is `[0, 0]`. */
  readonly width: number;
  readonly height: number;
  /**
   * Adds a viewport: a rectangle from its lower-left `corner`, in paper units, that shows
   * model space about `view.center` at `view.ratio`. Its border is on the current layer, and
   * its view is locked against zooming. Under a standard it shows the options' `view`, at the
   * view's scale and with the view's id.
   */
  viewport<W extends number, H extends number, R extends number, I extends string = string>(
    corner: Point,
    width: Positive<W>,
    height: Positive<H>,
    view: Z extends Standard ? StandardViewportOptions : ViewportOptions<R, I>,
  ): this;
}

/** The linetype and lineweight an entity is stored with: only what differs from ByLayer. */
type EntityStyle = Pick<Line, "linetype" | "lineweight">;

type Method = (...args: never[]) => unknown;

/** A block while its `draw` runs. */
interface OpenBlock {
  readonly name: string;
  readonly base?: Point;
  readonly entities: Entity[];
  readonly attributes: AttributeDefinition[];
  /** The call that drew each entity, when calls are recorded. */
  readonly calls: (HeldCall | undefined)[] | undefined;
  readonly attributeCalls: (HeldCall | undefined)[];
  /** The handles and the id keys taken for the block and what is drawn in it. */
  readonly handles: string[];
  readonly ids: string[];
  /** True once a text or attribute with a role is in it, or an insert of a block that has one. */
  roles: boolean;
}

/** A layout while its `draw` runs. */
interface OpenLayout {
  readonly name: string;
  readonly paper: Paper;
  readonly info: PaperInfo;
  readonly plotStyle: PlotStyleTable | undefined;
  readonly viewports: Viewport[];
  readonly entities: Entity[];
  /** The call that drew each entity and each viewport, when calls are recorded. */
  readonly calls: (HeldCall | undefined)[] | undefined;
  readonly viewportCalls: (HeldCall | undefined)[];
  /** The handles and the id keys taken for the layout and what is drawn on it. */
  readonly handles: string[];
  readonly ids: string[];
  /** The views its viewports show. */
  readonly views: Shown[];
  /** True once `draw` has returned or thrown. */
  closed: boolean;
}

/** A view the drawing declared, and whether a viewport shows it. */
interface Shown {
  readonly view: View;
  shown: boolean;
}

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
  method: Method | readonly Method[],
  about: Pick<
    Diagnostic,
    | "id"
    | "layer"
    | "linetype"
    | "textStyle"
    | "dimensionStyle"
    | "block"
    | "attribute"
    | "xref"
    | "layout"
  >,
): unknown {
  if (!(thrown instanceof Problem)) return thrown;
  // The first of the methods that is on the stack is the one the caller called.
  let call: CallSite | undefined;
  for (const each of Array.isArray(method) ? method : [method]) {
    call ??= readCall(holdCall(each as Method));
  }
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
 * `block(name, opts, draw)` puts everything drawn inside `draw` in a block, `xref(name, path)`
 * references another drawing's DWG file, and `insert` places a block or an xref.
 * `dimensionStyle(style)` defines how dimensions are drawn and written, and `linearDimension`
 * and `alignedDimension` draw one between two points.
 * `layout(name, opts, draw)` puts everything drawn inside `draw` on a sheet of paper, in paper
 * units, and gives `draw` the sheet, whose `viewport()` shows model space on it at a scale.
 *
 * Mistakes written as literals, such as a layer name the DXF version does not
 * allow or a negative radius, are compile errors. The same checks run again
 * when the code runs, for values the compiler cannot see: `layer`, `linetype`,
 * `textStyle`, `block`, `attribute`, `xref`, `layout`, `viewport` and the entity methods then throw a `DrawingError` whose
 * diagnostic has the rule, the entity's `id` and the `call` that broke it.
 *
 * Drawn to a standard, `Z`, the drawing's layers, linetypes, pens and linetype scale are the
 * standard's: `layer()` names a layer of it, and an entity's `pen` one of its pens. A text's
 * `role` names a text role of it, `view(id, { scale })` declares a view at one of its scales,
 * which a viewport shows and the annotation of model space names, and a dimension names a
 * dimension style of it by id. `D` is the drawing's discipline as written, which the compiler
 * checks against the standard's.
 */
export class DrawingBuilder<
  V extends DxfVersion = "R2018",
  S extends number = number,
  Z extends Standard | undefined = undefined,
  D extends string = string,
> {
  readonly units: Units;
  readonly dxf: V;
  readonly linetypeScale: number;
  /** The standard the drawing is drawn to, with its entries by name as AutoCAD compares them. */
  readonly #standard: Drawn | undefined;
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
  /** What took each handle that comes from a name: an id, or a description of anything else. */
  readonly #handles = new Map<string, { readonly id?: string; readonly what: string }>();
  /** The call that drew each entity, when calls are recorded. */
  readonly #calls: (HeldCall | undefined)[] | undefined;
  /** Keyed by `layerKey`: an insert finds its block as an entity finds its layer. */
  readonly #blocks = new Map<string, Block>();
  /** Keyed by `layerKey`, as blocks are: an insert finds an xref as it finds a block. */
  readonly #xrefs = new Map<string, Xref>();
  /**
   * The first block or xref name for each `layerAuditKey`: AutoCAD takes two such names for
   * one block.
   */
  readonly #blocksAudited = new Map<string, { readonly name: string; readonly xref: boolean }>();
  /** The block being drawn, which takes what is drawn until its `draw` returns. */
  #open: OpenBlock | undefined;
  /** Keyed by `layoutNameKey`, as AutoCAD compares layout names. In the order of the tabs. */
  readonly #layouts = new Map<string, Layout | undefined>();
  /** The layout being drawn, which takes what is drawn until its `draw` returns. */
  #sheet: OpenLayout | undefined;
  /** Keyed by `layerKey`: AutoCAD compares dimension style names as it compares layer names. */
  readonly #dimensionStyles = new Map<string, DimensionStyle>();
  readonly #dimensionStylesAudited = new Map<string, string>();
  /** The blocks of the arrowheads the dimension styles use, whose handles are taken. */
  readonly #arrowheadBlocks = new Set<string>();
  /** The views `view()` declared, by `idKey` of their ids. */
  readonly #views = new Map<string, Shown>();
  /** The blocks that hold texts with roles, directly or in a block they insert, by `layerKey`. */
  readonly #roleBlocks = new Set<string>();
  #current = "0";

  constructor(options: DrawingOptions<V, S, Z, D> = {}) {
    const units = options.units ?? "in";
    if (!UNITS.includes(units)) throw new Error(`Unknown units: ${JSON.stringify(units)}`);
    const dxf: string = options.dxf ?? "R2018";
    if (!DXF_VERSIONS.includes(dxf)) {
      throw new Error(`Unsupported DXF version: ${JSON.stringify(dxf)}`);
    }
    let standard: Drawn | undefined;
    try {
      standard = drawnTo(options as DrawingOptions<DxfVersion, number, Standard>, dxf);
    } catch (thrown) {
      throw located(thrown, [createDrawing, DrawingBuilder as unknown as Method], {});
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
    this.linetypeScale = standard?.standard.linetypeScale ?? (scale as number | undefined) ?? 1;
    this.#standard = standard;
    this.#calls = (options.recordCalls ?? recordsCalls()) ? [] : undefined;
  }

  /**
   * Defines a linetype, or updates the one of the same name. `dashed` and
   * `DASHED` are the same linetype, as in CAD, and keep the first spelling.
   * tsdraft exports the linetypes plans use, such as `DASHED` and `HIDDEN`.
   * A drawing drawn to a standard defines none: its linetypes are the standard's.
   */
  linetype<N extends string, const P extends readonly number[], D extends string = string>(
    linetype: Z extends Standard
      ? LinetypeDefined
      : V extends "R12"
        ? R12Linetypes
        : LinetypeDefinition<N, P, D>,
  ): this {
    const definition = linetype as unknown as LinetypeDefinition;
    try {
      if (this.dxf === "R12") refuse("linetype", R12_ONLY.linetypes);
      if (this.#standard) refuse("linetype-outside-standard", DRAWN.linetypeDefined);
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
   * `txt.shx`. Under a standard, a role's text style is the standard's, and `textStyle()` defines
   * none of that name.
   */
  textStyle<
    N extends string,
    F extends string,
    W extends number = number,
    O extends number = number,
  >(style: V extends "R12" ? R12Text : TextStyleDefinition<N, F, W, O>): this {
    const definition = style as unknown as TextStyleDefinition;
    const name: unknown = definition?.name;
    try {
      if (this.dxf === "R12") refuse("text-style", R12_ONLY.text);
      const role =
        typeof name === "string" ? this.#standard?.roleStyles.get(layerKey(name)) : undefined;
      if (role !== undefined) {
        refuse("text-style", roleTextStyleProblem(name as string, role, this.#standard!.standard));
      }
      this.#defineTextStyle(definition);
    } catch (thrown) {
      const about = typeof name === "string" ? { textStyle: name } : {};
      throw located(thrown, DrawingBuilder.prototype.textStyle, about);
    }
    return this;
  }

  /**
   * Defines or updates a layer. With `draw`, entities drawn inside it go on this layer, as
   * `layer(name, draw)` or `layer(name, options, draw)`.
   * `wall` and `WALL` are the same layer, as in CAD, and keep the first spelling.
   * Options left out keep the values the layer has.
   *
   * Drawn to a standard, `name` is a layer of the standard, which gives its color, linetype,
   * lineweight and plot flag, and `options` sets only its states: `off`, `frozen` and `locked`.
   */
  layer<
    N extends string,
    C extends number = number,
    W extends number = number,
    T extends string = string,
    const L extends LinetypeValue = LinetypeDefinition,
  >(
    name: Z extends Standard ? LayerOfStandard<N, Z> : LayerName<N, V>,
    options:
      | (Z extends Standard ? StandardLayerOptions : LayerOptions<C, W, T, V, N, L>)
      | (() => void) = {},
    draw?: () => void,
  ): this {
    // The parameter type is the error message when a literal name is wrong, so read it as a string.
    const requested = name as string;
    const given = typeof options === "function" ? {} : options;
    if (typeof options === "function") draw = options;
    let layer: Layer;
    try {
      layer = this.#standard
        ? this.#standardLayer(requested, given as unknown as LayerOptions)
        : this.#layer(requested, given as unknown as LayerOptions);
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

  /** Checks a layer of the standard and stores it with the standard's properties. */
  #standardLayer(requested: string, o: LayerOptions): Layer {
    const drawn = this.#standard!;
    const nameProblem = layerNameProblem(requested, "R2018");
    if (nameProblem) refuse("layer-name", `Layer ${JSON.stringify(requested)}: ${nameProblem}`);
    if (requested === "0") refuse("layer-outside-standard", DRAWN.layerZero);
    const found = drawn.layers.get(layerKey(requested));
    if (!found) return refuse("layer-outside-standard", layerLacks(requested, drawn.standard));
    for (const field of ["color", "linetype", "lineweight", "plot"] as const) {
      if (o[field] !== undefined) {
        refuse(
          "layer-differs-from-standard",
          `Layer ${JSON.stringify(requested)}: ${DRAWN.layerProperties}`,
        );
      }
    }
    const [name, entry] = found;
    const fields: StandardLayer = this.#inDiscipline("Layer", name, entry);
    const pen = fields.pen === undefined ? undefined : drawn.standard.pens[fields.pen];
    return this.#layer(name, {
      color: fields.color as LayerColor<number>,
      linetype: fields.linetype,
      lineweight: (pen?.lineweight ?? "Default") as LineweightOf<number>,
      plot: fields.plot,
      off: o.off,
      frozen: o.frozen,
      locked: o.locked,
    } as LayerOptions);
  }

  /**
   * Declares a view: a scale of the standard, by its id, under an id of the drawing's, which
   * `view()` takes. One viewport shows it, with its id and its scale's ratio, and a text, an
   * insert or a dimension of model space names the view it is read in. `view.paper(length)` is a
   * length on paper in drawing units at the view's ratio.
   */
  view<I extends string, C extends string>(
    id: EntityId<I>,
    // Written out here: as an interface generic in `Z`, a builder without a standard would not be
    // assignable to one whose standard may be any.
    options: {
      /** A scale of the drawing's standard, by its id, such as `"1in-10ft"`. */
      readonly scale: Z extends Standard ? ScaleOfStandard<C, Z> : ScaleWithoutStandard;
    },
  ): View<I, C> {
    const requested: unknown = id;
    try {
      const drawn = this.#standard;
      if (!drawn) return refuse("scale-outside-standard", DRAWN.scaleWithoutStandard);
      const key = this.#idKey(requested);
      this.#freeIdHandle(requested as string);
      const scale: unknown = (options as { readonly scale?: unknown } | undefined)?.scale;
      const found = typeof scale === "string" ? drawn.scales.get(idKey(scale)) : undefined;
      if (found === undefined) {
        return refuse(
          "scale-outside-standard",
          typeof scale === "string"
            ? scaleLacks(scale, drawn.standard)
            : "A view's scale is named by a string",
        );
      }
      const [scaleId, { label, ratio }] = found;
      const { units } = this;
      const { paperUnits } = drawn.standard;
      const paper = <L extends number>(length: PaperLength<L>): number => {
        try {
          try {
            return fromPaper(length, paperUnits, { ratio, units });
          } catch (thrown) {
            return refuse("geometry", (thrown as Error).message);
          }
        } catch (thrown) {
          throw located(thrown, paper, { id: requested as string });
        }
      };
      const view: View<I, C> = Object.freeze({
        id: requested as I,
        scale: scaleId as C,
        label,
        ratio,
        paper,
      });
      // The view belongs to the drawing, also when it is declared while a block or a layout is drawn.
      this.#claim(
        validIdHandle(requested as string),
        `the id ${JSON.stringify(requested)}`,
        requested as string,
        [],
      );
      this.#ids.set(key, requested as string);
      this.#views.set(key, { view, shown: false });
      return view;
    } catch (thrown) {
      throw located(
        thrown,
        DrawingBuilder.prototype.view,
        typeof requested === "string" ? { id: requested } : {},
      );
    }
  }

  line<
    T extends string = string,
    W extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
    P extends string = string,
  >(from: Point, to: Point, options: EntityOptions<V, T, W, L, I, Z, P> = {}): this {
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
    P extends string = string,
  >(
    points: readonly Point[],
    closed = false,
    options: EntityOptions<V, T, W, L, I, Z, P> = {},
  ): this {
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
    P extends string = string,
  >(
    corner: Point,
    width: Positive<W>,
    height: Positive<H>,
    options: EntityOptions<V, T, LW, L, I, Z, P> = {},
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
    P extends string = string,
  >(center: Point, radius: Positive<R>, options: EntityOptions<V, T, W, L, I, Z, P> = {}): this {
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
    P extends string = string,
  >(
    center: Point,
    radius: Positive<R>,
    startAngle: number,
    endAngle: number,
    options: EntityOptions<V, T, W, L, I, Z, P> = {},
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
    P extends string = string,
    R extends string = string,
  >(at: Point, value: string, options: TextOptions<H, V, T, W, L, I, S, D, Z, P, R> = {}): this {
    return this.#add(DrawingBuilder.prototype.text, options, () => ({
      kind: "text",
      layer: this.#current,
      ...this.#textFields(at, value, options as unknown as TextOptions),
    }));
  }

  /**
   * Defines a block: what `draw` draws goes in the block and not in the drawing, in the
   * block's own coordinates, and `insert` then places it. Inside `draw` the current layer
   * starts as `"0"`, which in a block stands for the layer of each insert, and `layer()` puts
   * entities on a layer of their own. A block is defined once, and not inside another.
   */
  block<N extends string>(
    name: V extends "R12" ? R12Blocks : BlockName<N>,
    options: BlockOptions,
    draw: () => void,
  ): this {
    // The parameter type is the error message when a literal name is wrong, so read it as a string.
    const requested = name as string;
    let open: OpenBlock;
    try {
      const fail = (rule: LintRule, problem: string): never =>
        refuse(rule, `Block ${JSON.stringify(requested)}: ${problem}`);
      if (this.dxf === "R12") fail("block", R12_ONLY.blocks);
      const nameProblem = blockNameProblem(requested);
      if (nameProblem) fail("block", nameProblem);
      if (this.#open) {
        fail(
          "block",
          `a block cannot be defined inside another, and block ${JSON.stringify(this.#open.name)} is being drawn. Define this one first, and insert it`,
        );
      }
      if (this.#sheet) {
        fail(
          "block",
          `a block belongs to the drawing and cannot be defined on a layout, and layout ${JSON.stringify(this.#sheet.name)} is being drawn. Define this one first, and insert it`,
        );
      }
      const first = this.#blocksAudited.get(layerAuditKey(requested));
      if (first !== undefined) {
        fail(
          "duplicate-block",
          first.xref
            ? xrefTwinProblem(requested, first.name, "xref")
            : blockTwinProblem(requested, first.name)!,
        );
      }
      const base = options?.base === undefined ? undefined : pt(options.base);
      const handles = blockHandles(requested);
      const what = `the block ${JSON.stringify(requested)}`;
      const taken: string[] = [];
      for (const handle of [handles.record, handles.begin, handles.end]) {
        this.#claim(handle, what, undefined, taken);
      }
      open = {
        name: requested,
        ...(base && (base[0] !== 0 || base[1] !== 0) ? { base } : {}),
        entities: [],
        attributes: [],
        calls: this.#calls ? [] : undefined,
        attributeCalls: [],
        handles: taken,
        ids: [],
        roles: false,
      };
    } catch (thrown) {
      throw located(thrown, DrawingBuilder.prototype.block, { block: requested });
    }
    // The name is taken while the block is drawn, so nothing inside can take it too.
    const auditKey = layerAuditKey(requested);
    this.#blocksAudited.set(auditKey, { name: requested, xref: false });
    const previous = this.#current;
    this.#current = "0";
    this.#open = open;
    try {
      draw();
    } catch (thrown) {
      // Nothing of a block that was not finished stays, so the call can be made again.
      this.#blocksAudited.delete(auditKey);
      for (const handle of open.handles) this.#handles.delete(handle);
      for (const key of open.ids) this.#ids.delete(key);
      throw thrown;
    } finally {
      this.#current = previous;
      this.#open = undefined;
    }
    if (open.calls) {
      recordCalls(open.entities, open.calls);
      recordCalls(open.attributes, open.attributeCalls);
    }
    if (open.roles) this.#roleBlocks.add(layerKey(requested));
    this.#blocks.set(layerKey(requested), {
      name: open.name,
      ...(open.base ? { base: open.base } : {}),
      entities: open.entities,
      ...(open.attributes.length > 0 ? { attributes: open.attributes } : {}),
    });
    return this;
  }

  /**
   * References another drawing's DWG file as an xref, under a name that no block and no other
   * xref has. `insert(name, at)` then places it, as it places a block, and AutoCAD loads the
   * file and draws it there each time it opens this drawing. `path` leads from the folder of
   * this drawing's file to the DWG file, such as `"base.dwg"` or `"../survey/base.dwg"`.
   */
  xref<N extends string, P extends string>(
    name: V extends "R12" ? R12Xrefs : BlockName<N>,
    path: V extends "R12" ? R12Xrefs : XrefPath<P>,
  ): this {
    // The parameter type is the error message when a literal is wrong, so read it as a string.
    const requested = name as string;
    try {
      const fail = (rule: LintRule, problem: string): never =>
        refuse(rule, `Xref ${JSON.stringify(requested)}: ${problem}`);
      if (this.dxf === "R12") fail("xref", R12_ONLY.xrefs);
      const nameProblem = blockNameProblem(requested);
      if (nameProblem) fail("xref", nameProblem);
      const first = this.#blocksAudited.get(layerAuditKey(requested));
      if (first !== undefined) {
        fail(
          "duplicate-block",
          xrefTwinProblem(requested, first.name, first.xref ? "xref" : "block"),
        );
      }
      const pathProblem = xrefPathProblem(path);
      if (pathProblem) fail("xref", pathProblem);
      const handles = blockHandles(requested);
      const what = `the xref ${JSON.stringify(requested)}`;
      // An xref belongs to the drawing, also when it is referenced while a block is drawn.
      for (const handle of [handles.record, handles.begin, handles.end]) {
        this.#claim(handle, what, undefined, []);
      }
      this.#xrefs.set(layerKey(requested), { name: requested, path: path as string });
      this.#blocksAudited.set(layerAuditKey(requested), { name: requested, xref: true });
    } catch (thrown) {
      throw located(thrown, DrawingBuilder.prototype.xref, { xref: requested });
    }
    return this;
  }

  /**
   * Adds an attribute definition to the block being drawn: a text that each insert of the
   * block carries with a value of its own, under `tag`. It is placed and justified as `text()`
   * places a text, and goes on the current layer.
   */
  attribute<
    T extends string,
    H extends number = number,
    S extends string = string,
    const D extends TextStyleValue = TextStyleDefinition,
    R extends string = string,
  >(
    tag: V extends "R12" ? R12Blocks : AttributeTag<T>,
    at: Point,
    options: AttributeOptions<H, S, D, Z, R> = {},
  ): this {
    const requested: unknown = tag;
    const open = this.#open;
    try {
      if (this.dxf === "R12") refuse("attribute", R12_ONLY.blocks);
      if (!open) {
        return refuse(
          "attribute",
          "An attribute definition belongs to a block. Call attribute() inside the draw of block()",
        );
      }
      const tagProblem = attributeTagProblem(requested);
      if (tagProblem) refuse("attribute", tagProblem);
      const named = requested as string;
      if (open.attributes.some((definition) => definition.tag === named)) {
        refuse("duplicate-attribute", duplicateAttributeProblem(named));
      }
      const prompt: unknown = options.prompt;
      if (prompt !== undefined) {
        const problem = typeof prompt === "string" ? textProblem(prompt) : "must be a string";
        if (problem) refuse("text", `prompt: ${problem}`);
      }
      const fields = this.#textFields(at, options.value ?? "", options as unknown as TextOptions);
      this.#claim(
        definitionHandle(open.name, named),
        `the attribute ${JSON.stringify(named)} of the block ${JSON.stringify(open.name)}`,
      );
      open.attributes.push({
        tag: named,
        ...(prompt === undefined ? {} : { prompt: prompt as string }),
        layer: this.#current,
        ...fields,
      });
      if (options.role !== undefined) open.roles = true;
    } catch (thrown) {
      const about = typeof requested === "string" ? { attribute: requested } : {};
      throw located(thrown, DrawingBuilder.prototype.attribute, {
        ...(open ? { block: open.name } : {}),
        ...about,
      });
    }
    if (open.calls) open.attributeCalls.push(holdCall(DrawingBuilder.prototype.attribute));
    return this;
  }

  /**
   * Places a block or an xref of the drawing with its base point at `at`, on the current
   * layer. Inside `block()`, it places it in the block being drawn. In model space under a
   * standard, `view` scales it by `view.paper(1)`, so a block drawn in paper units plots at its
   * size.
   */
  insert<
    N extends string,
    const S extends number | readonly [number, number] = number,
    I extends string = string,
  >(
    block: V extends "R12" ? R12Blocks : BlockName<N>,
    at: Point,
    options: InsertOptions<S, I, Z> = {},
  ): this {
    return this.#add(DrawingBuilder.prototype.insert, options, () => {
      if (this.dxf === "R12") refuse("block", R12_ONLY.blocks);
      const requested: unknown = block;
      if (typeof requested !== "string")
        return refuse("undefined-block", "A block is named by a string");
      const nameProblem = blockNameProblem(requested);
      if (nameProblem)
        refuse("undefined-block", `Block ${JSON.stringify(requested)}: ${nameProblem}`);
      if (this.#open && layerAuditKey(this.#open.name) === layerAuditKey(requested)) {
        refuse("block-cycle", blockCycleProblem([this.#open.name, this.#open.name]));
      }
      const xref = this.#xrefs.get(layerKey(requested));
      const placed = this.#blocks.get(layerKey(requested));
      if (!placed && !xref) {
        refuse(
          "undefined-block",
          `${undefinedBlockProblem(requested)}. Define it with block() or xref() first`,
        );
      }
      const insert: { -readonly [K in keyof Insert]: Insert[K] } = {
        kind: "insert",
        layer: this.#current,
        block: (placed ?? xref)!.name,
        at: pt(at),
      };
      let scale: unknown = options.scale;
      const view: unknown = options.view;
      const inModel = !this.#open && !this.#sheet;
      if (view !== undefined) {
        if (!this.#standard) refuse("role", DRAWN.viewWithoutStandard);
        if (!inModel) refuse("role", DRAWN.insertViewOnPaper);
        if (scale !== undefined) refuse("role", DRAWN.insertViewAndScale);
        scale = onPaper(this.#declared(view, "role").view, 1, "scale");
      } else if (inModel && placed && this.#roleBlocks.has(layerKey(placed.name))) {
        refuse("role", roleBlockWithoutView(placed.name));
      }
      if (scale !== undefined) {
        const pair = (typeof scale === "number" ? [scale, scale] : scale) as readonly unknown[];
        if (!Array.isArray(pair) || pair.length !== 2) {
          refuse("geometry", "scale must be a number or [x, y]");
        }
        const problem = scaleProblem(pair[0]) ?? scaleProblem(pair[1]);
        if (problem) refuse("geometry", `scale: ${problem}`);
        if (pair[0] !== 1 || pair[1] !== 1) insert.scale = [pair[0] as number, pair[1] as number];
      }
      const rotation = kept(options.rotation ?? 0, "rotation");
      if (rotation !== 0) insert.rotation = rotation;
      const set: unknown = options.attributes;
      if (set !== undefined && (typeof set !== "object" || set === null || Array.isArray(set))) {
        return refuse("undefined-attribute", ATTRIBUTES_SHAPE);
      }
      if (!placed) {
        if (set !== undefined && Object.keys(set).length > 0) {
          refuse("undefined-attribute", XREF_ATTRIBUTES);
        }
        return insert;
      }
      const definitions = placed.attributes ?? [];
      if (set !== undefined) {
        const values: Record<string, string> = {};
        for (const [tag, value] of Object.entries(set as Record<string, unknown>)) {
          if (!definitions.some((definition) => definition.tag === tag)) {
            refuse("undefined-attribute", undefinedAttributeProblem(tag, placed.name));
          }
          const problem = typeof value === "string" ? textProblem(value) : "must be a string";
          if (problem) refuse("text", `attribute ${JSON.stringify(tag)}: ${problem}`);
          values[tag] = value as string;
        }
        if (Object.keys(values).length > 0) insert.attributes = values;
      }
      for (const definition of definitions) {
        const style =
          definition.style === undefined
            ? undefined
            : this.#textStyles.get(layerKey(definition.style));
        const problem = placedAttributeProblem(
          definition.tag,
          placeAttribute(definition, style, insert, placed.base),
        );
        if (problem) refuse("geometry", problem);
      }
      const id: unknown = options.id;
      if (typeof id === "string" && definitions.length > 0) {
        const what = `the insert ${JSON.stringify(id)}`;
        for (const { tag } of definitions) {
          this.#claim(
            insertAttributeHandle(id, tag),
            `the attribute ${JSON.stringify(tag)} of ${what}`,
          );
        }
        this.#claim(insertEndHandle(id), `the end of the attributes of ${what}`);
      }
      return insert;
    });
  }

  /**
   * Defines a dimension style: the text style and height of its dimensions' text, their
   * arrowheads, how far the extension lines start from the points and run past the dimension
   * line, the gap under the text, and how a measurement is written. The sizes are the sizes a
   * dimension plots at, and `scale` multiplies each: `fromPaper(1, "in", view)` for dimensions
   * in model space that a viewport shows at the view's ratio, and 1, the default, for
   * dimensions on a layout. A style is defined once, under a name no other has. A drawing drawn
   * to a standard defines none: its dimensions name the standard's styles by their ids.
   */
  dimensionStyle<
    N extends string,
    S extends string = string,
    H extends number = number,
    A extends string = string,
    AS extends number = number,
    EO extends number = number,
    EB extends number = number,
    G extends number = number,
    SC extends number = number,
    P extends number = number,
    PRE extends string = string,
    SUF extends string = string,
    MS extends number = number,
  >(
    style: Z extends Standard
      ? DimensionStyleDefined
      : V extends "R12"
        ? R12Dimensions
        : DimensionStyleDefinition<N, S, H, A, AS, EO, EB, G, SC, P, PRE, SUF, MS>,
  ): this {
    const definition = style as unknown as DimensionStyle;
    try {
      if (this.dxf === "R12") refuse("dimension-style", R12_ONLY.dimensions);
      if (this.#standard) refuse("dimension-style-outside-standard", DRAWN.dimensionStyleDefined);
      this.#defineDimensionStyle(definition);
    } catch (thrown) {
      const name: unknown = (definition as { name?: unknown } | null)?.name;
      const about = typeof name === "string" ? { dimensionStyle: name } : {};
      throw located(thrown, DrawingBuilder.prototype.dimensionStyle, about);
    }
    return this;
  }

  /** Checks a dimension style and stores it. */
  #defineDimensionStyle(definition: DimensionStyle): void {
    const name: unknown = (definition as { name?: unknown } | null)?.name;
    const fail = (rule: LintRule, problem: string): never =>
      refuse(
        rule,
        `Dimension style ${typeof name === "string" ? JSON.stringify(name) : "with no name"}: ${problem}`,
      );
    const problem = dimensionStyleProblem(definition);
    if (problem) fail("dimension-style", problem);
    // dimensionStyleProblem has checked the types.
    const named = name as string;
    const first = this.#dimensionStylesAudited.get(layerAuditKey(named));
    if (first !== undefined) {
      fail("duplicate-dimension-style", dimensionStyleTwinProblem(named, first)!);
    }
    let textStyle: string | undefined;
    if (definition.textStyle !== undefined && !isStandardTextStyle(definition.textStyle)) {
      textStyle = this.#textStyles.get(layerKey(definition.textStyle))?.name;
      if (textStyle === undefined) {
        fail(
          "undefined-text-style",
          `${undefinedDimensionTextStyleProblem(definition.textStyle)}. Define it with textStyle() first`,
        );
      }
    }
    const arrowhead = (definition.arrowhead ?? DEFAULT_ARROWHEAD) as Arrowhead;
    const block = arrowheadInfo(arrowhead)?.block;
    // A handle taken before another was refused is given back.
    const taken: string[] = [];
    try {
      const what = `the dimension style ${JSON.stringify(named)}`;
      this.#claim(validDimensionStyleHandle(named), what, undefined, taken);
      if (block !== undefined && !this.#arrowheadBlocks.has(block)) {
        const handles = blockHandles(block);
        const head = `the arrowhead ${JSON.stringify(arrowhead)}`;
        for (const handle of [
          handles.record,
          handles.begin,
          handles.end,
          arrowheadEntityHandle(block),
        ]) {
          this.#claim(handle, head, undefined, taken);
        }
      }
    } catch (thrown) {
      for (const handle of taken) this.#handles.delete(handle);
      throw thrown;
    }
    if (block !== undefined) this.#arrowheadBlocks.add(block);
    const { prefix, suffix, suppressZeros } = definition;
    const scale = definition.scale ?? 1;
    const measurementScale = definition.measurementScale ?? 1;
    this.#dimensionStyles.set(layerKey(named), {
      name: named,
      ...(textStyle === undefined ? {} : { textStyle }),
      textHeight: definition.textHeight,
      ...(arrowhead === DEFAULT_ARROWHEAD ? {} : { arrowhead }),
      arrowSize: definition.arrowSize,
      extensionOffset: definition.extensionOffset,
      extensionBeyond: definition.extensionBeyond,
      textGap: definition.textGap,
      ...(scale === 1 ? {} : { scale }),
      precision: definition.precision,
      ...(prefix === undefined || prefix === "" ? {} : { prefix }),
      ...(suffix === undefined || suffix === "" ? {} : { suffix }),
      ...(suppressZeros === undefined ? {} : { suppressZeros }),
      ...(measurementScale === 1 ? {} : { measurementScale }),
    });
    this.#dimensionStylesAudited.set(layerAuditKey(named), named);
  }

  /**
   * Draws a linear dimension on the current layer: the distance from `from` to `to` along X,
   * or along `options.along`, with its dimension line through `line`. AutoCAD holds it as a
   * dimension, which reads its length again when its points move.
   */
  linearDimension<S extends string, T extends string = string, I extends string = string>(
    from: Point,
    to: Point,
    line: Point,
    options: Z extends Standard
      ? StandardLinearDimensionOptions<S, T, I, Z>
      : V extends "R12"
        ? R12Dimensions
        : LinearDimensionOptions<S, T, I>,
  ): this {
    return this.#add(DrawingBuilder.prototype.linearDimension, idOf(options), () => {
      const o = options as unknown as LinearDimensionOptions | undefined;
      const along: unknown = o?.along ?? "x";
      const angle =
        along === "x"
          ? 0
          : along === "y"
            ? 90
            : typeof along === "number"
              ? turned(along)
              : refuse("dimension", 'along must be "x", "y" or an angle in degrees');
      return this.#dimension(o, (style, text) => ({
        kind: "linear-dimension",
        layer: this.#current,
        style,
        from: pt(from),
        to: pt(to),
        line: pt(line),
        ...(angle === 0 ? {} : { angle }),
        ...text,
      }));
    });
  }

  /**
   * Draws an aligned dimension on the current layer: the distance from `from` to `to`, with
   * its dimension line `offset` to the left of the way from the first to the second, or to the
   * right for an offset less than 0.
   */
  alignedDimension<S extends string, T extends string = string, I extends string = string>(
    from: Point,
    to: Point,
    offset: number,
    options: Z extends Standard
      ? StandardAlignedDimensionOptions<S, T, I, Z>
      : V extends "R12"
        ? R12Dimensions
        : AlignedDimensionOptions<S, T, I>,
  ): this {
    return this.#add(DrawingBuilder.prototype.alignedDimension, idOf(options), () =>
      this.#dimension(options as unknown as AlignedDimensionOptions | undefined, (style, text) => ({
        kind: "aligned-dimension",
        layer: this.#current,
        style,
        from: pt(from),
        to: pt(to),
        offset: kept(offset, "offset"),
        ...text,
      })),
    );
  }

  /** Checks what a dimension names and what it measures, and returns the dimension `make` gives. */
  #dimension<D extends LinearDimension | AlignedDimension>(
    options:
      | { readonly style?: unknown; readonly text?: unknown; readonly view?: unknown }
      | undefined,
    make: (style: string, text: { readonly text?: string }) => D,
  ): D {
    if (this.dxf === "R12") refuse("dimension", R12_ONLY.dimensions);
    if (this.#open) refuse("dimension", DIMENSION_IN_BLOCK);
    let style: DimensionStyle | undefined;
    if (this.#standard) style = this.#standardDimensionStyle(options?.style, options?.view);
    else {
      if (options?.view !== undefined) refuse("dimension-style", DRAWN.viewWithoutStandard);
      const named: unknown = options?.style;
      const nameProblem = dimensionStyleNameProblem(named);
      if (nameProblem) refuse("undefined-dimension-style", nameProblem);
      style = this.#dimensionStyles.get(layerKey(named as string));
      if (!style) {
        const absent = undefinedDimensionStyleProblem(named as string);
        refuse(
          "undefined-dimension-style",
          isStandardDimensionStyle(named as string)
            ? absent
            : `${absent}. Define it with dimensionStyle() first`,
        );
      }
    }
    const text: unknown = options?.text;
    if (text !== undefined) {
      const problem = dimensionTextProblem(text);
      if (problem) refuse("dimension", problem);
    }
    const made = make(style!.name, text === undefined ? {} : { text: text as string });
    const textStyle =
      style!.textStyle === undefined ? undefined : this.#textStyles.get(layerKey(style!.textStyle));
    const problem = dimensionDrawnProblem(made, style!, textStyle);
    if (problem) refuse("dimension", problem);
    // The block of the dimension's picture takes handles from its id, or else from its place.
    const id: unknown = (options as { readonly id?: unknown } | undefined)?.id;
    const sheet = this.#sheet;
    const place: DimensionPlace = {
      index: (sheet ?? { entities: this.#entities }).entities.length,
      ...(typeof id === "string" ? { id } : {}),
      ...(sheet ? { layout: sheet.name } : {}),
    };
    const what = pictureOwner(place, JSON.stringify);
    const own = typeof id === "string" ? validIdHandle(id) : undefined;
    const handles = pictureHandleList(validDimensionPictureHandles(place));
    for (const handle of handles) {
      const other =
        handle === own ? { what: `the id ${JSON.stringify(id)}` } : this.#handles.get(handle);
      if (other !== undefined) refuse("id-handle", handleProblem(what, other.what, handle));
    }
    for (const handle of handles) this.#claim(handle, what);
    return made;
  }

  /**
   * The AutoCAD style of a dimension style of the standard, where the dimension is drawn: its id
   * in capitals on a layout, with a scale of 1 and the writing of the paper's units, and with the
   * view's scale id after it in model space, with a scale of `view.paper(1)` and the writing of
   * the drawing's units. It is defined on first use, with its role's text style.
   */
  #standardDimensionStyle(named: unknown, view: unknown): DimensionStyle {
    const drawn = this.#standard!;
    const id = named === undefined ? drawn.standard.defaultDimensionStyle : named;
    if (id === undefined) {
      return refuse("dimension-style-outside-standard", noDefaultDimensionStyle(drawn.standard));
    }
    const found = typeof id === "string" ? drawn.dimensionStyles.get(idKey(id)) : undefined;
    if (found === undefined) {
      return refuse(
        "dimension-style-outside-standard",
        typeof id === "string"
          ? (dimensionStyleReserved(id) ?? dimensionStyleLacks(id, drawn.standard))
          : "A dimension style is named by a string",
      );
    }
    const [styleId, entry] = found;
    const fields = this.#inDiscipline("Dimension style", styleId, entry);
    const sheet = this.#sheet;
    let name = capitals(styleId);
    let scale = 1;
    let units: string = this.units;
    if (sheet) {
      if (view !== undefined) refuse("dimension-style", DRAWN.dimensionViewOnPaper);
      units = sheet.info.units;
    } else {
      if (view === undefined) refuse("dimension-style", DRAWN.dimensionWithoutView);
      const shown = this.#declared(view, "dimension-style").view;
      name = `${name}-${shown.scale}`;
      scale = onPaper(shown, 1, "scale");
    }
    const writing = fields.writing[units as Units];
    if (writing === undefined)
      refuse("dimension-style", writingLacks(styleId, units, drawn.standard));
    const existing = this.#dimensionStyles.get(layerKey(name));
    if (existing !== undefined) return existing;
    const role = drawn.textRoles.get(idKey(fields.role))!;
    const { precision, prefix, suffix, suppressZeros, measurementScale } = writing!;
    this.#defineDimensionStyle({
      name,
      textStyle: this.#roleStyle(role),
      textHeight: this.#roleFields(role).height,
      arrowhead: fields.arrowhead,
      arrowSize: fields.arrowSize,
      extensionOffset: fields.extensionOffset,
      extensionBeyond: fields.extensionBeyond,
      textGap: fields.textGap,
      scale,
      precision,
      ...(prefix === undefined ? {} : { prefix }),
      ...(suffix === undefined ? {} : { suffix }),
      ...(suppressZeros === undefined ? {} : { suppressZeros }),
      measurementScale,
    });
    return this.#dimensionStyles.get(layerKey(name))!;
  }

  /**
   * Adds a layout: a sheet of `options.paper` that AutoCAD shows as a tab and plots as one
   * page, at 1:1 on `DWG To PDF.pc3`. What `draw` draws goes on the sheet and not in model
   * space, in the paper's units from the sheet's lower-left corner, and `sheet.viewport()`
   * shows model space on it at a scale. Inside `draw` the current layer starts as `"0"`. A
   * layout is defined once, and not inside a block or another layout. AutoCAD opens a drawing
   * on its first layout.
   */
  layout<N extends string, P extends string>(
    name: V extends "R12" ? R12Layouts : LayoutName<N>,
    options: LayoutOptions<P>,
    draw: (sheet: Sheet<Z>) => void,
  ): this {
    // The parameter type is the error message when a literal name is wrong, so read it as a string.
    const requested = name as string;
    let open: OpenLayout;
    const taken: string[] = [];
    try {
      const fail = (rule: LintRule, problem: string): never =>
        refuse(rule, `Layout ${JSON.stringify(requested)}: ${problem}`);
      if (this.dxf === "R12") fail("layout", R12_ONLY.layouts);
      const nameProblem = layoutNameProblem(requested);
      if (nameProblem) fail("layout", nameProblem);
      const within = this.#open
        ? `block ${JSON.stringify(this.#open.name)}`
        : this.#sheet
          ? `layout ${JSON.stringify(this.#sheet.name)}`
          : undefined;
      if (within !== undefined) {
        fail(
          "layout",
          `a layout belongs to the drawing and cannot be defined inside a block or another layout, and ${within} is being drawn`,
        );
      }
      for (const [key, other] of this.#layouts) {
        // A layout that is being drawn holds its name too.
        if (key === layoutNameKey(requested)) {
          fail("duplicate-layout", layoutTwinProblem(requested, other?.name ?? requested)!);
        }
      }
      const paper: unknown = options?.paper;
      const problem = paperProblem(paper);
      if (problem) fail("layout", problem);
      const info = paperInfo(paper as Paper)!;
      const standard = this.#standard?.standard;
      if (standard && info.units !== standard.paperUnits) {
        fail("layout", layoutPaperUnitsProblem(paper as string, info.units, standard));
      }
      const plotStyle: unknown = options.plotStyle;
      if (plotStyle !== undefined) {
        const styleProblem = plotStyleProblem(plotStyle);
        if (styleProblem) fail("layout", styleProblem);
      }
      const handles = validLayoutHandles(requested);
      const what = `the layout ${JSON.stringify(requested)}`;
      for (const handle of Object.values(handles)) this.#claim(handle, what, undefined, taken);
      open = {
        name: requested,
        paper: paper as Paper,
        info,
        plotStyle: plotStyle as PlotStyleTable | undefined,
        viewports: [],
        entities: [],
        calls: this.#calls ? [] : undefined,
        viewportCalls: [],
        handles: taken,
        ids: [],
        views: [],
        closed: false,
      };
    } catch (thrown) {
      // A handle taken before another was refused is given back.
      for (const handle of taken) this.#handles.delete(handle);
      throw located(thrown, DrawingBuilder.prototype.layout, { layout: requested });
    }
    // The name is taken while the layout is drawn, and its place among the tabs is kept.
    const key = layoutNameKey(requested);
    this.#layouts.set(key, undefined);
    const previous = this.#current;
    this.#current = "0";
    this.#sheet = open;
    const sheet: Sheet<Z> = {
      name: open.name,
      paper: open.paper,
      units: open.info.units,
      width: open.info.width,
      height: open.info.height,
      viewport: (corner, width, height, view) => {
        this.#viewport(sheet.viewport, open, corner, width, height, view);
        return sheet as never;
      },
    };
    try {
      draw(sheet);
    } catch (thrown) {
      // Nothing of a layout that was not finished stays, so the call can be made again.
      this.#layouts.delete(key);
      for (const handle of open.handles) this.#handles.delete(handle);
      for (const id of open.ids) this.#ids.delete(id);
      for (const shown of open.views) shown.shown = false;
      throw thrown;
    } finally {
      this.#current = previous;
      this.#sheet = undefined;
      open.closed = true;
    }
    if (open.calls) {
      recordCalls(open.entities, open.calls);
      recordCalls(open.viewports, open.viewportCalls);
    }
    this.#layouts.set(key, {
      name: open.name,
      paper: open.paper,
      ...(open.plotStyle === undefined ? {} : { plotStyle: open.plotStyle }),
      viewports: open.viewports,
      entities: open.entities,
    });
    return this;
  }

  /** Checks a viewport and adds it to the layout being drawn. `method` is the sheet's own. */
  #viewport(
    method: Method,
    open: OpenLayout,
    corner: Point,
    width: unknown,
    height: unknown,
    options: unknown,
  ): void {
    const view = options as
      | { readonly center?: Point; readonly ratio?: unknown; readonly id?: unknown }
      | undefined;
    const shows: unknown = (options as { readonly view?: unknown } | undefined)?.view;
    let id: unknown = view?.id;
    try {
      if (open.closed) {
        refuse(
          "viewport",
          "A viewport is added while its layout is drawn. Call viewport() inside the draw of layout()",
        );
      }
      let shown: Shown | undefined;
      if (this.#standard) {
        if (view?.ratio !== undefined || shows === undefined)
          refuse("viewport", DRAWN.viewportRatio);
        if (id !== undefined) refuse("viewport", DRAWN.viewportId);
        shown = this.#declared(shows, "viewport");
        id = shown.view.id;
        if (shown.shown) refuse("duplicate-id", duplicateIdProblem(shown.view.id, shown.view.id));
      } else if (shows !== undefined) {
        refuse("viewport", DRAWN.viewWithoutStandard);
      }
      // A view's id was taken when view() declared it.
      const key = id === undefined || shown ? undefined : this.#idKey(id);
      if (key !== undefined) this.#freeIdHandle(id as string);
      const made = {
        ...(id === undefined ? {} : { id: id as string }),
        layer: this.#current,
        corner,
        width,
        height,
        center: view?.center,
        ratio: shown ? shown.view.ratio : view?.ratio,
      };
      const problem = viewportProblem(made, open.info.units, this.units);
      if (problem) refuse("viewport", problem);
      open.viewports.push({ ...(made as Viewport), corner: pt(corner), center: pt(view!.center!) });
      if (shown) {
        shown.shown = true;
        open.views.push(shown);
      }
      if (key !== undefined) {
        this.#ids.set(key, id as string);
        open.ids.push(key);
        this.#claim(validIdHandle(id as string), `the id ${JSON.stringify(id)}`, id as string);
      }
    } catch (thrown) {
      throw located(thrown, method, {
        layout: open.name,
        ...(typeof id === "string" ? { id } : {}),
      });
    }
    if (open.calls) open.viewportCalls.push(holdCall(method));
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
      ...(this.#blocks.size > 0 ? { blocks: [...this.#blocks.values()] } : {}),
      ...(this.#xrefs.size > 0 ? { xrefs: [...this.#xrefs.values()] } : {}),
      ...(this.#layouts.size > 0
        ? { layouts: [...this.#layouts.values()].filter((layout) => layout !== undefined) }
        : {}),
      ...(this.#dimensionStyles.size > 0
        ? { dimensionStyles: [...this.#dimensionStyles.values()] }
        : {}),
    };
  }

  /**
   * The fields of a text that `text()` and `attribute()` share: its point and value, and the
   * height, rotation, style and justification its options give.
   */
  #textFields(
    at: Point,
    value: string,
    options: TextOptions,
  ): Pick<Text, "at" | "value" | "height" | "rotation" | "style" | "align" | "valign"> {
    const problem = typeof value === "string" ? textProblem(value) : "Text must be a string";
    if (problem) refuse("text", problem);
    const role = this.#role(options);
    const text: { -readonly [K in keyof Text]?: Text[K] } & Pick<
      Text,
      "at" | "value" | "height" | "rotation"
    > = {
      at: pt(at),
      value,
      height: positive(role ? role.height : (options.height ?? 0.125), "height"),
      rotation: kept(options.rotation ?? 0, "rotation"),
    };
    const r12 = this.dxf === "R12";
    if (role) {
      text.style = role.style;
    } else if (options.style !== undefined) {
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
  }

  /**
   * The height and text style of a text with a role, where it is drawn: the role's height in a
   * block and on a layout, and `view.paper` of it in model space. Undefined for a text with no
   * role and no view.
   */
  #role(options: TextOptions): { readonly height: number; readonly style: string } | undefined {
    const role: unknown = options.role;
    const view: unknown = options.view;
    if (role === undefined && view === undefined) return undefined;
    const drawn = this.#standard;
    if (!drawn) {
      return refuse(
        "role",
        role === undefined ? DRAWN.viewWithoutStandard : DRAWN.roleWithoutStandard,
      );
    }
    if (role === undefined) return refuse("role", DRAWN.viewWithoutRole);
    const found = typeof role === "string" ? drawn.textRoles.get(idKey(role)) : undefined;
    if (found === undefined) {
      return refuse(
        "role",
        typeof role === "string" ? roleLacks(role, drawn.standard) : "A role is named by a string",
      );
    }
    if (options.height !== undefined) refuse("role", DRAWN.roleAndHeight);
    if (options.style !== undefined) refuse("role", DRAWN.roleAndStyle);
    let height = this.#roleFields(found).height;
    if (this.#open || this.#sheet) {
      if (view !== undefined) refuse("role", DRAWN.roleViewOnPaper);
    } else {
      if (view === undefined) refuse("role", DRAWN.roleWithoutView);
      height = onPaper(this.#declared(view, "role").view, height, "height");
    }
    return { height, style: this.#roleStyle(found) };
  }

  /** A role's fields in the drawing's discipline. */
  #roleFields([id, role]: readonly [string, StandardTextRole]): StandardTextRole {
    return this.#inDiscipline("Text role", id, role);
  }

  /** The text style of a role, which enters the drawing when the role is first used. */
  #roleStyle(found: readonly [string, StandardTextRole]): string {
    const { font, widthFactor, obliqueAngle } = this.#roleFields(found);
    return this.#defineTextStyle(
      { name: capitals(found[0]), font, widthFactor, obliqueAngle } as TextStyleDefinition,
      true,
    );
  }

  /**
   * An entry of the standard as the drawing's discipline resolves it: with that discipline's
   * fields from `byDiscipline`. An entry with `byDiscipline` in a drawing that names no
   * discipline is refused.
   */
  #inDiscipline<E extends { readonly byDiscipline?: { readonly [d: string]: object } }>(
    what: string,
    name: string,
    entry: E,
  ): E {
    if (!entry.byDiscipline) return entry;
    const discipline = this.#standard!.discipline;
    if (discipline === undefined) refuse("standard", unnamedDisciplineProblem(what, name, entry));
    return { ...entry, ...entry.byDiscipline[discipline!] };
  }

  /** The view `view()` of this drawing returned, or a refusal under `rule`. */
  #declared(view: unknown, rule: LintRule): Shown {
    const id: unknown = (view as { readonly id?: unknown } | null | undefined)?.id;
    const shown = typeof id === "string" ? this.#views.get(idKey(id)) : undefined;
    if (shown === undefined || shown.view !== view) return refuse(rule, viewNotDeclared(view));
    return shown;
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
      if (key !== undefined) this.#freeIdHandle(id as string);
      const named = id === undefined ? {} : { id: id as string };
      const made = { ...make(), ...named, ...this.#style(o) } as Entity;
      (this.#open ?? this.#sheet ?? { entities: this.#entities }).entities.push(made);
      if (this.#open && this.#drawsRoles(made, o)) this.#open.roles = true;
      if (key !== undefined) {
        this.#ids.set(key, id as string);
        (this.#open ?? this.#sheet)?.ids.push(key);
        this.#claim(validIdHandle(id as string), `the id ${JSON.stringify(id)}`, id as string);
      }
    } catch (thrown) {
      const within = this.#open
        ? { block: this.#open.name }
        : this.#sheet
          ? { layout: this.#sheet.name }
          : {};
      throw located(thrown, method, { ...within, ...(typeof id === "string" ? { id } : {}) });
    }
    (this.#open ?? this.#sheet ?? { calls: this.#calls }).calls?.push(holdCall(method));
    return this;
  }

  /** True for a text with a role, and for an insert of a block that holds one. */
  #drawsRoles(made: Entity, options: object): boolean {
    if (made.kind === "text") return (options as { readonly role?: unknown }).role !== undefined;
    return made.kind === "insert" && this.#roleBlocks.has(layerKey(made.block));
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

  /** Refuses an id whose handle something else has. */
  #freeIdHandle(id: string): void {
    const handle = validIdHandle(id);
    const other = this.#handles.get(handle);
    if (other === undefined) return;
    refuse(
      "id-handle",
      other.id !== undefined
        ? idHandleProblem(id, other.id, handle)
        : handleProblem(`the id ${JSON.stringify(id)}`, other.what, handle),
    );
  }

  /** Takes a handle that comes from a name, and refuses one that something else has. */
  #claim(
    handle: string,
    what: string,
    id?: string,
    held = (this.#open ?? this.#sheet)?.handles,
  ): void {
    const other = this.#handles.get(handle);
    if (other !== undefined) {
      refuse(
        "id-handle",
        id !== undefined && other.id !== undefined
          ? idHandleProblem(id, other.id, handle)
          : handleProblem(what, other.what, handle),
      );
    }
    this.#handles.set(handle, id === undefined ? { what } : { id, what });
    held?.push(handle);
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
    const pen: unknown = options.pen;
    const drawn = this.#standard;
    if (!drawn) {
      if (pen !== undefined) refuse("pen-outside-standard", DRAWN.penWithoutStandard);
    } else if (pen !== undefined) {
      if (weight !== undefined) refuse("pen-outside-standard", DRAWN.penAndLineweight);
      const found = typeof pen === "string" ? drawn.pens.get(idKey(pen)) : undefined;
      if (found === undefined) {
        return refuse(
          "pen-outside-standard",
          typeof pen === "string" ? penLacks(pen, drawn.standard) : "A pen is named by a string",
        );
      }
      style.lineweight = found;
      return style;
    } else if (weight !== undefined && weight !== "ByLayer" && weight !== "ByBlock") {
      refuse("pen-outside-standard", penLineweightProblem(drawn.standard));
    }
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
    const drawn = this.#standard;
    if (typeof choice === "object" && choice !== null) {
      if (drawn) fail("linetype-outside-standard", DRAWN.linetypeDefined);
      return this.#define(choice as LinetypeDefinition, true);
    }
    if (typeof choice !== "string") {
      return fail("undefined-linetype", "A linetype is a name or a LinetypeDefinition");
    }
    const problem = linetypeNameProblem(choice);
    if (problem) fail("undefined-linetype", `Linetype ${JSON.stringify(choice)}: ${problem}`);
    if (drawn && !builtInLinetype(choice)) {
      // The standard's linetype enters the drawing when a layer or an entity first names it.
      const found = drawn.linetypes.get(layerKey(choice));
      if (!found) fail("linetype-outside-standard", linetypeLacks(choice, drawn.standard));
      const [name, { description, pattern }] = found!;
      return (
        this.#linetypes.get(layerKey(name))?.name ?? this.#define({ name, description, pattern })
      );
    }
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

/**
 * Starts a drawing. With `standard`, the drawing is drawn to it: see `DrawingOptions.standard`.
 */
export function createDrawing<
  V extends DxfVersion = "R2018",
  S extends number = number,
  Z extends Standard | undefined = undefined,
  D extends string = string,
>(options?: DrawingOptions<V, S, Z, D>): DrawingBuilder<V, number, Z> {
  return new DrawingBuilder(options as DrawingOptions<V, number, Z>);
}

/** A standard as the builder reads it: its entries by the keys AutoCAD finds them by. */
interface Drawn {
  readonly standard: Standard;
  /** Each layer as the standard spells its name, by `layerKey`. */
  readonly layers: ReadonlyMap<string, readonly [name: string, layer: StandardLayer]>;
  /** Each linetype as the standard spells its name, by `layerKey`. */
  readonly linetypes: ReadonlyMap<string, readonly [name: string, linetype: StandardLinetype]>;
  /** Each pen's lineweight, by `idKey` of its id. */
  readonly pens: ReadonlyMap<string, number>;
  /** Each text role, scale and dimension style as the standard spells its id, by `idKey`. */
  readonly textRoles: ReadonlyMap<string, readonly [id: string, role: StandardTextRole]>;
  readonly scales: ReadonlyMap<string, readonly [id: string, scale: StandardScale]>;
  readonly dimensionStyles: ReadonlyMap<
    string,
    readonly [id: string, style: StandardDimensionStyle]
  >;
  /** The id of each text role, by `layerKey` of its text style's name. */
  readonly roleStyles: ReadonlyMap<string, string>;
  /** The drawing's discipline, as the standard spells it. */
  readonly discipline?: string;
}

/** The maps of each standard a drawing has been drawn to. */
const drawnStandards = new WeakMap<Standard, Drawn>();

/** The standard `options` draws the drawing to, checked with the options it rules out. */
function drawnTo(
  options: DrawingOptions<DxfVersion, number, Standard | undefined>,
  dxf: string,
): Drawn | undefined {
  const given: unknown = options.standard;
  const discipline: unknown = options.discipline;
  if (given === undefined) {
    if (discipline !== undefined) refuse("standard", DRAWN.disciplineWithoutStandard);
    return undefined;
  }
  const standard = adopted(given);
  if (!standard) return refuse("standard", DRAWN.notAStandard);
  if (dxf === "R12") refuse("standard", DRAWN.r12);
  if (options.linetypeScale !== undefined) refuse("standard", DRAWN.linetypeScale);
  let drawn = drawnStandards.get(standard);
  if (!drawn) {
    const byKey = <T>(entries: Readonly<Record<string, T>>, key: (name: string) => string) =>
      new Map(Object.entries(entries).map(([name, entry]) => [key(name), [name, entry] as const]));
    drawn = {
      standard,
      layers: byKey(standard.layers, layerKey),
      linetypes: byKey(standard.linetypes, layerKey),
      pens: new Map(Object.entries(standard.pens).map(([id, pen]) => [idKey(id), pen.lineweight])),
      textRoles: byKey(standard.textRoles, idKey),
      scales: byKey(standard.scales, idKey),
      dimensionStyles: byKey(standard.dimensionStyles, idKey),
      roleStyles: new Map(
        Object.keys(standard.textRoles).map((id) => [layerKey(capitals(id)), id]),
      ),
    };
    drawnStandards.set(standard, drawn);
  }
  if (discipline === undefined) return drawn;
  if (typeof discipline !== "string")
    return refuse("standard", "A discipline is named by a string");
  const named = Object.keys(standard.disciplines).find((id) => idKey(id) === idKey(discipline));
  if (named === undefined) refuse("standard", disciplineLacks(discipline, standard));
  if (standard.sheetFiles === "one-drawing") refuse("standard", DRAWN.disciplineOneDrawing);
  return { ...drawn, discipline: named };
}

/** The id among the options of a dimension, which have no linetype or lineweight to take. */
function idOf(options: unknown): { readonly id?: unknown } {
  const id: unknown = (options as { id?: unknown } | null | undefined)?.id;
  return id === undefined ? {} : { id };
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

/** A length on paper in drawing units at a view's ratio, refused when it cannot be written. */
function onPaper(view: View, length: number, label: string): number {
  try {
    return view.paper(length);
  } catch (thrown) {
    return refuse("geometry", `${label}: ${(thrown as Error).message}`);
  }
}

/** An angle a dimension measures along, refused beyond a turn, and turned to less than one. */
function turned(angle: number): number {
  const problem = dimensionAngleProblem(angle);
  if (problem) refuse("dimension", problem);
  return dimensionAngle({ angle });
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
