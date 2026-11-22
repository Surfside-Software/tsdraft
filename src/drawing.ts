import { entityColorProblem } from "./colors.ts";
import { entityTransparencyProblem } from "./transparency.ts";
import type { ParagraphColumns } from "./paragraphs.ts";
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
  DEFAULT_LEADER_ARROWHEAD,
  JOG_ANGLE,
  STANDARD_LEADER_STYLE,
  type Arrowhead,
  type DIMENSION_UNITS,
  type DIMENSION_FRACTIONS,
  type DIMENSION_TEXT_PLACEMENTS,
  type DIMENSION_TEXT_FITS,
  type DIMENSION_RADIAL_TEXTS,
  type DIMENSION_ANGLE_UNITS,
  type DIMENSION_ARC_SYMBOLS,
  type FEET_INCH_ZEROS,
  type LeaderArrowhead,
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
  type Dimension,
  type DimensionPlace,
} from "./dimensions.ts";
import { STANDARD_FONT, STANDARD_TEXT_STYLE } from "./fonts.ts";
import { paragraphUnknownCode, parseParagraph } from "./paragraph-codes.ts";
import {
  leaderArrowheadHandles,
  leaderDrawnProblem,
  leaderStyleDictionaryHandle,
  validLeaderStyleHandle,
} from "./leaders.ts";
import {
  STANDARD_TABLE_STYLE,
  tableMargins,
  tableStyleDictionaryHandle,
  tableTexts,
  validTableStyleHandle,
} from "./tables.ts";
import { fmt, written } from "./format.ts";
import { validIdHandle } from "./handles.ts";
import { layerAuditKey, layerKey, layoutNameKey } from "./layers.ts";
import { validLayoutHandles } from "./layouts.ts";
import { fromPaper, type PaperUnit } from "./paper.ts";
import {
  DEFAULT_PLOT_STYLE_TABLE,
  paperInfo,
  type Paper,
  type PaperInfo,
  type PlotStyleTable,
} from "./papers.ts";
import { BUILT_IN_LINETYPES, builtInLinetype } from "./linetypes.ts";
import { arcsAlong, cloud, donut, MAX_CLOUD_ARCS, rounded } from "./polylines.ts";
import {
  hatchSpread,
  loopsBox,
  onOneLine,
  patternDrawnProblem,
  patternSizes,
  polygonCrosses,
  type PatternSizes,
} from "./fills.ts";
import { parsePatterns } from "./patterns.ts";
import { imageVectors } from "./images.ts";
import { canonical } from "./json.ts";
import { DrawingError, type Diagnostic, type LintRule } from "./lint.ts";
import {
  arcProblem,
  ATTRIBUTE_KIND,
  ATTRIBUTES_SHAPE,
  PARAGRAPH_ONLY,
  paragraphOnlyProblem,
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
  donutHoleProblem,
  duplicateAttributeProblem,
  duplicateIdProblem,
  handleProblem,
  idHandleProblem,
  idKey,
  idProblem,
  isStandardDimensionStyle,
  isStandardLeaderStyle,
  isStandardTextStyle,
  LEADER_IN_BLOCK,
  leaderOwnProblem,
  leaderShaftsProblem,
  leaderStyleNameProblem,
  leaderStyleProblem,
  leaderStyleTwinProblem,
  standardTableStyleProblem,
  TABLE_COLOR,
  TABLE_TRANSPARENCY,
  LEADER_BLOCK_TRANSPARENCY,
  TABLE_IN_BLOCK,
  tableColumnsProblem,
  tableTextsProblem,
  tableProblem,
  tableStyleNameProblem,
  tableStyleProblem,
  tableStyleTwinProblem,
  leaderTextProblem,
  placedAttributeProblem,
  layerColorProblem,
  layerFlagProblem,
  layerLinetypeProblem,
  layerStateProblem,
  lineweightProblem,
  linetypeNameProblem,
  linetypeProblem,
  marksProblem,
  linetypeScaleProblem,
  magnitudeProblem,
  layerNameProblem,
  layerTwinProblem,
  layoutNameProblem,
  layoutTwinProblem,
  paperProblem,
  plotStyleProblem,
  polylineSidesProblems,
  R12_ONLY,
  scaleProblem,
  sheetNumberProblem,
  sizeProblem,
  textAlignProblem,
  textProblem,
  lineSpacingProblem,
  paragraphColumnsProblem,
  paragraphChoiceProblem,
  paragraphProblemIn,
  textStyleNameProblem,
  textStyleProblem,
  undefinedAttributeProblem,
  undefinedBlockProblem,
  leaderBlockContentProblem,
  undefinedDimensionStyleProblem,
  undefinedDimensionTextStyleProblem,
  undefinedLeaderStyleProblem,
  undefinedLeaderTextStyleProblem,
  undefinedLinetypeProblem,
  undefinedTextStyleProblem,
  viewportProblem,
  frozenLayerAbsent,
  XREF_ATTRIBUTES,
  xrefPathProblem,
  xrefTwinProblem,
  type ArrowheadOf,
  type AttributeTag,
  type BlockName,
  type DimensionAffix,
  type DimensionPrefix,
  type DimensionScale,
  type FeetInchZerosIn,
  type SuppressZerosIn,
  type DimensionStyleName,
  type DimensionText,
  type Description,
  type EntityId,
  type FontOf,
  type FrozenCurrent,
  type InsertScale,
  type LayerLinetypeName,
  type LeaderArrowheadOf,
  type LeaderScale,
  type LeaderSize,
  type LeaderStyleName,
  type LeaderTargetsOf,
  type LeaderText,
  type NewLeaderStyleName,
  type DonutHole,
  type PolylineWidth,
  type R12Leaders,
  type R12Polylines,
  type R12Images,
  type ImagePath,
  imageClipProblem,
  imagePathProblem,
  imagePixelsProblem,
  IMAGE_INVERT_WITHOUT_CLIP,
  type R12Paragraphs,
  type LineSpacing,
  type ParagraphValue,
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
  type EntityColorGiven,
  type EntityColorOf,
  type R12EntityColor,
  type LayerName,
  type LayoutName,
  type PaperLength,
  type PaperOf,
  type Positive,
  type R12Layouts,
  type Ratio,
  type MARK_ORIENTS,
  type TEXT_ALIGNS,
  type TEXT_VERTICAL_ALIGNS,
  type LINE_SPACING_STYLES,
  type PARAGRAPH_ALIGNS,
  type PARAGRAPH_VERTICAL_ALIGNS,
  type LEADER_ATTACHMENTS,
  type LEADER_DIRECTIONS,
  type LEADER_BLOCK_CONNECTIONS,
  type LEADER_SHAFT_KINDS,
  type LEADER_SIDES,
  type LEADER_VERTICAL_ATTACHMENTS,
  HATCH_LOOP_POINTS,
  controlSplineProblems,
  ellipseProblems,
  fitSplineProblems,
  type ControlPoints,
  type EllipseRatio,
  type FitPoints,
  type Knots,
  type SPLINE_CLOSED_TANGENT,
  type SplineDegree,
  type Tangent,
  type Weights,
  HATCH_NO_LOOPS,
  GRADIENT_WITH_PATTERN,
  type GRADIENT_KINDS,
  readGradient,
  hatchPatternChoiceProblem,
  hatchPatternProblem,
  type GradientOf,
  shown,
  undefinedHatchPatternProblem,
  textMaskProblem,
  PARAGRAPH_MASK_COLUMNS,
  WIPEOUT_CROSSES,
  WIPEOUT_FLAT,
  WIPEOUT_POINTS,
  ORDINATE_AXIS,
} from "./rules.ts";
import type {
  Standard,
  StandardDimensionStyle,
  StandardLeaderStyle,
  StandardLayer,
  StandardLinetype,
  StandardScale,
  StandardSheetFormat,
  StandardTextRole,
  StandardTitleBlock,
} from "./standard/document.ts";
import {
  dimensionStyleLacks,
  dimensionStyleReserved,
  disciplineLacks,
  DRAWN,
  fieldLacks,
  filledByCad,
  layerLacks,
  layoutAuditTwin,
  layoutNameField,
  layoutPaperUnitsProblem,
  leaderStyleLacks,
  leaderStyleReserved,
  linetypeLacks,
  noDefaultDimensionStyle,
  noDefaultLeaderStyle,
  noDefaultSheetFormat,
  numberNotLayoutName,
  penLacks,
  penLineweightProblem,
  roleBlockWithoutView,
  roleLacks,
  scaleLacks,
  sheetFormatLacks,
  sheetNumberOfFile,
  unnamedDisciplineProblem,
  viewNotDeclared,
  writingLacks,
  zoneLacks,
  type DimensionStyleDefined,
  type DimensionStyleOfStandard,
  type LeaderRoleAndText,
  type LeaderStyleDefined,
  type LeaderStyleOfStandard,
  type DisciplineWithoutStandard,
  type FieldsWithoutStandard,
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
  type SheetFormatWithoutStandard,
  type StandardLayerOptions,
  type StandardLayoutOptions,
  type LinetypeOfStandard,
  type StandardLinetypeScale,
  type LineweightUnderStandard,
  type PenOfStandard,
  type StandardR12,
  type TextStyleDefined,
  type TextWithoutRole,
  type TitleBlockWithoutStandard,
  type ViewportId,
  type ViewportRatio,
  type ViewWithoutStandard,
  type ZoneWithoutStandard,
} from "./standard/drawn.ts";
import { adopted } from "./standard/made.ts";
import { capitals, FILL_KEYS, READS_A_NAME, styleNameAt } from "./standard/rules.ts";

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
 * - `"R2018"` (AC1032) is the newest published version and the one the leading CAD app has
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
  /**
   * What the pattern draws besides its dashes: a text, such as a pipe's letters, or a shape of a
   * shape file, each at the end of a length of the pattern. In order of `after`, one a length.
   * R2018 only.
   */
  readonly marks?: readonly LinetypeMark[];
}

/**
 * How a linetype's mark is turned: `"relative"` to the line, `"absolute"` to the drawing's X
 * axis, or `"upright"`, along the line and turned half a turn where the line runs leftward, from
 * just past straight up to just short of straight down, so that it reads from the left.
 */
export type MarkOrient = (typeof MARK_ORIENTS)[number];

interface MarkBase {
  /** The index of the length of the pattern the mark is drawn at the end of, from 0. */
  readonly after: number;
  /** In degrees counterclockwise, from the line or the X axis as `orient` says. Defaults to 0. */
  readonly rotation?: number;
  /** Defaults to `"relative"`. */
  readonly orient?: MarkOrient;
  /**
   * Where the mark is from the end of its length: along the line, and to its left. In the
   * pattern's units, scaled as its lengths are. Defaults to `[0, 0]`.
   */
  readonly offset?: Point;
}

/** A text a linetype draws, such as the letters along a pipe. */
export interface LinetypeText extends MarkBase {
  readonly text: string;
  /** A text style of the drawing. Defaults to `"Standard"`. */
  readonly style?: string;
  /** The height of its capitals, in the pattern's units, scaled as its lengths are. */
  readonly height: number;
}

/**
 * A shape of a shape file a linetype draws, by its number in the file. tsdraft's plot draws it
 * from the file given as `shapes`, which `parseShapes` reads, and leaves a gap without it.
 */
export interface LinetypeShape extends MarkBase {
  /** Its number in its shape file. A name, as a linetype file gives it, is not written. */
  readonly shape: number | string;
  /** The shape file, as the drawing names it, such as `"shapes.shx"`. */
  readonly file: string;
  /**
   * Its size, as a multiple of the shape's own, scaled as the pattern's lengths are. A negative
   * scale turns it half a turn.
   */
  readonly scale: number;
}

export type LinetypeMark = LinetypeText | LinetypeShape;

/**
 * The lineweights the leading CAD app offers, in millimetres. A lineweight is how wide a line
 * plots, and how wide that app shows it when LWDISPLAY is on.
 */
export type Lineweight = LineweightMm;

export interface Layer {
  readonly name: string;
  /** A number from 1 to 255 in the color index CAD programs share. 7 is white on dark backgrounds, black on light. */
  readonly color: number;
  /** The linetype of the layer's entities that draw ByLayer. Defaults to `"Continuous"`. */
  readonly linetype?: string;
  /**
   * In millimetres, one of `Lineweight`, or `"Default"`, which the leading CAD app draws at its
   * LWDEFAULT of 0.25 mm. Defaults to `"Default"`.
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

/** A true color: its red, green and blue, each a whole number from 0 to 255. */
export type Rgb = readonly [red: number, green: number, blue: number];

/**
 * An entity's color: an index of the color index CAD programs share, from 1 to 255; `"ByLayer"`,
 * its layer's; `"ByBlock"`, the color of the insert that places its block; or a true color. CAD
 * programs plot an index through the layout's plot style table, and a true color as it is under
 * every table.
 */
export type EntityColor = number | "ByLayer" | "ByBlock" | Rgb;

/** An entity's own transparency: a whole percent from 0 to 90, `"ByLayer"` or `"ByBlock"`. */
export type EntityTransparency = number | "ByLayer" | "ByBlock";

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
  /** Its own color. Defaults to `"ByLayer"`. R2018 only. */
  readonly color?: EntityColor;
  /** Its own transparency, in percent. Defaults to `"ByLayer"`. R2018 only. */
  readonly transparency?: EntityTransparency;
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

/**
 * A polyline: sides from each point to the next and, when it is closed, from the last back to
 * the first. A side is straight, or an arc by its bulge, and may be drawn wide: CAD programs fill
 * a side that has a width, and draw one of width 0 with its pen.
 */
export interface Polyline extends EntityBase {
  readonly kind: "polyline";
  readonly points: readonly Point[];
  readonly closed: boolean;
  /**
   * The bulge of each side, one for each: 0 for a straight side, and for an arc the tangent of a
   * quarter of the angle it turns through, greater than 0 when it turns counterclockwise. 1 is a
   * half circle. Defaults to every side straight. R2018 only.
   */
  readonly bulges?: readonly number[];
  /** The width of every side, in drawing units, 0 or more. R2018 only. */
  readonly width?: number;
  /** The width of each side at its start and at its end, one pair for each side. R2018 only. */
  readonly widths?: readonly (readonly [start: number, end: number])[];
  /**
   * Runs the linetype's pattern on past each vertex, as one stretch along the whole polyline,
   * where it otherwise starts again on each side, so that a side shorter than the pattern is not
   * drawn solid. Around a closed polyline the pattern is stretched to a whole number of times.
   * R2018 only.
   */
  readonly linetypeGeneration?: boolean;
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
 * An ellipse, or an arc of one. Its points are `center + cos(t) * majorAxis + sin(t) * ratio *
 * minor` for each parameter `t`, where `minor` is `majorAxis` turned a quarter turn
 * counterclockwise. A parameter is not the angle a point is at from the center, except at
 * multiples of 90 degrees: on an ellipse of ratio 0.5, the parameter 45 is the point at about
 * 26.6 degrees. R2018 only.
 */
export interface Ellipse extends EntityBase {
  readonly kind: "ellipse";
  readonly center: Point;
  /** From the center to one end of the major axis: the major radius and its direction. */
  readonly majorAxis: Point;
  /** The minor radius over the major: above 0, and at most 1. */
  readonly ratio: number;
  /**
   * For an arc, the parameter it starts at, in degrees from 0 up to 360, counterclockwise from
   * the end of `majorAxis`. Given with `endParameter` or not at all, for a whole ellipse.
   */
  readonly startParameter?: number;
  /** For an arc, the parameter it ends at, in degrees from 0 up to 360. */
  readonly endParameter?: number;
}

/**
 * A spline through fit points: the cubic the leading CAD app's `SPLINE` fits through them, with
 * its knots spaced by the chords between the points, which the writers work out and write beside
 * the points. A DXF holds no other spacing: that app fits every spline it reads through fit points
 * by chord. R2018 only.
 */
export interface FitSpline extends EntityBase {
  readonly kind: "spline";
  /** The points it passes through, in order: 2 or more, 3 or more when it is closed. */
  readonly fitPoints: readonly Point[];
  /** The direction it leaves the first point in. Worked out from the points by default. */
  readonly startTangent?: Point;
  /** The direction it arrives at the last point in. Worked out from the points by default. */
  readonly endTangent?: Point;
  /**
   * Whether it runs from the last point back to the first, smooth through it. It then takes no
   * tangents. Defaults to false.
   */
  readonly closed?: boolean;
}

/** A spline by its control points: a B-spline of its degree, rational when it has weights. R2018 only. */
export interface ControlSpline extends EntityBase {
  readonly kind: "spline";
  readonly controlPoints: readonly Point[];
  /** From 1 up to `SPLINE_DEGREE_MOST`. */
  readonly degree: number;
  /** One more than the control points and the degree together, none less than the one before. */
  readonly knots: readonly number[];
  /** One for each control point, each above 0. Every weight is 1 when left out. */
  readonly weights?: readonly number[];
  /** Whether it is periodic, joined smooth where it starts. Defaults to false. */
  readonly closed?: boolean;
}

/** A spline: through fit points, or by its control points. `isFitSpline` tells the two apart. */
export type Spline = FitSpline | ControlSpline;

/** True for a spline through fit points. */
export function isFitSpline(spline: Spline): spline is FitSpline {
  return (spline as { readonly fitPoints?: unknown }).fitPoints !== undefined;
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

/** Where a paragraph's `at` point is across its box, and how its lines are set in it. */
export type ParagraphAlign = (typeof PARAGRAPH_ALIGNS)[number];

/** Where a paragraph's `at` point is up and down its box. */
export type ParagraphVerticalAlign = (typeof PARAGRAPH_VERTICAL_ALIGNS)[number];

/**
 * How a paragraph's line spacing is taken: as the least its lines are apart, so a line whose
 * letters reach further pushes the next one down, or as exactly that.
 */
export type LineSpacingStyle = (typeof LINE_SPACING_STYLES)[number];

/**
 * Paragraph text: one entity whose lines wrap at a width and break at each `\P`, which the
 * leading CAD app holds as one multi-line text and a drafter edits as one. Its value holds that
 * app's inline codes, such as `\L` for an underline and `\S1/2;` for a stacked fraction, which
 * `parseParagraph` reads. R2018 only.
 */
export interface Paragraph extends EntityBase {
  readonly kind: "paragraph";
  /** The point of its box `align` and `valign` name: with their defaults, its upper left corner. */
  readonly at: Point;
  /** The height of a capital, where no code sets another. */
  readonly height: number;
  /** The value, with its codes. `\P` breaks a paragraph. */
  readonly value: string;
  /** Degrees counterclockwise. */
  readonly rotation: number;
  /** The width its lines wrap at. Missing, its lines break only at `\P`. */
  readonly width?: number;
  /** A text style of the drawing. Defaults to `"Standard"`. */
  readonly style?: string;
  /** Defaults to `"left"`. */
  readonly align?: ParagraphAlign;
  /** Defaults to `"top"`. */
  readonly valign?: ParagraphVerticalAlign;
  /** A factor of the spacing of its lines, from 0.25 to 4. Defaults to 1. */
  readonly lineSpacing?: number;
  /** Defaults to `"at-least"`. */
  readonly lineSpacingStyle?: LineSpacingStyle;
  /** Columns its lines flow through, each `width` wide. Missing, one column. */
  readonly columns?: ParagraphColumns;
  /** A mask behind it, over its box: as wide as its width, or its widest line where that is wider. */
  readonly mask?: TextMask;
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
  /**
   * Words drawn under the dimension line, opposite the measurement, such as `"WINDOW HEAD HT."`.
   * `<>` in them stands for the measurement as it does in `text`.
   */
  readonly textBelow?: string;
}

/**
 * A linear dimension: the distance between two points along one direction, which is along X
 * unless `angle` says otherwise. The leading CAD app holds it as a dimension, measures it again
 * when its points move, and writes the measurement as its style says.
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

/** What a radius, a diameter and a jogged radius dimension have. */
interface RadialDimensionBase extends Placed {
  /** A dimension style of the drawing. */
  readonly style: string;
  /** The center of the circle or arc it measures. */
  readonly center: Point;
  /** The point of the circle or arc its line meets, which the radius reaches. */
  readonly point: Point;
  /** A text to draw in place of the measurement, as a linear dimension's `text`. */
  readonly text?: string;
  /** Words drawn under its line, opposite the text, as a linear dimension's `textBelow`. */
  readonly textBelow?: string;
}

/**
 * A radius dimension: the distance from the center of a circle or an arc to `point`, read with
 * an R before it. Its line runs from the center through `point`, and its arrowhead points at the
 * circle there from outside. The line to the center is always drawn.
 */
export interface RadiusDimension extends RadialDimensionBase {
  readonly kind: "radius-dimension";
  /**
   * How far the middle of its text is from the center, along its line: inside the circle, outside
   * it, or past the center for less than 0. Left out, the text stands outside the circle, past the
   * arrowhead, as the leading CAD app places it.
   */
  readonly textFromCenter?: number;
}

/**
 * A diameter dimension: twice the distance from the center of a circle to `point`, read with a
 * diameter sign before it. Its line runs through the center from `point` to the point opposite,
 * with an arrowhead at each, and its text stands at `point`'s end.
 */
export interface DiameterDimension extends RadialDimensionBase {
  readonly kind: "diameter-dimension";
  /** How far the middle of its text is from the center, as a radius dimension's. */
  readonly textFromCenter?: number;
}

/**
 * A jogged radius dimension: the radius of an arc whose center is far off, read with an R before
 * it. Its line starts at `start` instead of the center, runs to a jog across the line at `jog`,
 * and goes on toward the center to `point`, with its text along the last stretch, inside the arc.
 */
export interface JoggedRadiusDimension extends RadialDimensionBase {
  readonly kind: "jogged-radius-dimension";
  /** Where its line starts, standing in for the center. */
  readonly start: Point;
  /** The middle of the jog. */
  readonly jog: Point;
}

/**
 * An angular dimension: the angle at `vertex` between the line to `from` and the line to `to`, its
 * arc through `at`. The arc's point picks the angle, as the leading CAD app picks it: the one
 * between the two lines that holds `at`, or the rest of the turn, so the order of `from` and `to`
 * means nothing. Its extension lines run from near `from` and `to` along their lines to past the
 * arc, and its text stands at the middle of the arc.
 */
export interface AngularDimension extends Placed {
  readonly kind: "angular-dimension";
  /** A dimension style of the drawing. */
  readonly style: string;
  /** Where the two lines meet. */
  readonly vertex: Point;
  /** A point of each line, which its extension line starts near. */
  readonly from: Point;
  readonly to: Point;
  /** A point the dimension's arc passes through, about the vertex. */
  readonly at: Point;
  /** A text to draw in place of the measurement, as a linear dimension's `text`. */
  readonly text?: string;
  /** Words drawn under its arc, opposite the text, as a linear dimension's `textBelow`. */
  readonly textBelow?: string;
}

/**
 * An arc length dimension: the length of the arc about `center` of `radius`, counterclockwise from
 * `startAngle` to `endAngle` in degrees, as `d.arc` takes them, its own arc through `at`. Under a
 * right angle its extension lines run parallel to the arc's bisector; from one up they run along
 * radii. The arc symbol stands before its text, above it or nowhere, as its style says.
 */
export interface ArcLengthDimension extends Placed {
  readonly kind: "arc-length-dimension";
  /** A dimension style of the drawing. */
  readonly style: string;
  readonly center: Point;
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
  /** A point the dimension's own arc passes through. */
  readonly at: Point;
  /** A text to draw in place of the measurement, as a linear dimension's `text`. */
  readonly text?: string;
  /** Words drawn under its arc, opposite the text, as a linear dimension's `textBelow`. */
  readonly textBelow?: string;
}

/**
 * An ordinate dimension: the distance from `origin` to `feature` along X or along Y, as `axis`
 * says, on a leader from near `feature` to `leaderEnd` with its text beyond. The leader runs along
 * Y for `"x"` and along X for `"y"`, and jogs where `leaderEnd` is off that line. The distance has
 * no sign, so features either side of the origin read alike.
 */
export interface OrdinateDimension extends Placed {
  readonly kind: "ordinate-dimension";
  /** A dimension style of the drawing. */
  readonly style: string;
  /** `"x"` gives the feature's X from the origin, with its leader along Y; `"y"` its Y. */
  readonly axis: "x" | "y";
  /** The point it measures from. */
  readonly origin: Point;
  /** The point it gives the coordinate of. */
  readonly feature: Point;
  /** Where its leader ends; its text stands beyond. */
  readonly leaderEnd: Point;
  /** A text to draw in place of the measurement, as a linear dimension's `text`. */
  readonly text?: string;
  /** Words drawn under its leader, opposite the text, as a linear dimension's `textBelow`. */
  readonly textBelow?: string;
}

/** Which side of the point where its shafts meet a leader's note is on. */
export type LeaderSide = (typeof LEADER_SIDES)[number];

/** Where a leader's landing meets the side of its note: one of `LEADER_ATTACHMENTS`. */
export type LeaderAttachment = (typeof LEADER_ATTACHMENTS)[number];

/** Whether a leader style's landings meet the side of its notes or their top or bottom. */
export type LeaderDirection = (typeof LEADER_DIRECTIONS)[number];

/** How a leader's shafts run through their points: straight, or as a curve. */
export type LeaderShaftKind = (typeof LEADER_SHAFT_KINDS)[number];

/** How a block in place of a leader's note meets its landing. */
export type LeaderBlockConnection = (typeof LEADER_BLOCK_CONNECTIONS)[number];

/** Where a landing meets a note above or below it: at its middle, or with a line as wide as it. */
export type LeaderVerticalAttachment = (typeof LEADER_VERTICAL_ATTACHMENTS)[number];

/**
 * A mask behind a text, which hides what is drawn before it there: `true` for the drawing's
 * background, or a color index of its own, over the text's box grown by `offsetFactor` times its
 * text height less one, from 1 to 5 and 1.5 unless given.
 */
export type TextMask = boolean | { readonly color?: number; readonly offsetFactor?: number };

/**
 * A leader: a note joined to what it names by one or more shafts. The leading CAD app holds it as
 * one multileader, which a drafter moves and edits as one. Its shafts end at `at`, where its
 * landing starts: a level line as long as its style's `landing`, to the side the note is on, which
 * ends a gap short of the note. A note on the right is justified left, one on the left justified
 * right, and the landing meets the middle of its first line's capitals, or of its last line's.
 */
export interface Leader extends Placed {
  readonly kind: "leader";
  /** A leader style of the drawing. */
  readonly style: string;
  /**
   * The paragraphs of the note, from the top. Each is one line unless `width` wraps it. A leader
   * whose content is a block has none.
   */
  readonly text?: readonly string[];
  /** A block of the drawing in place of the note. Defaults to its style's. */
  readonly block?: string;
  /** The value of each attribute of the block, by its tag, where it is not its definition's. */
  readonly attributes?: Readonly<Record<string, string>>;
  /** Where the shafts meet and the landing starts. */
  readonly at: Point;
  /**
   * Each shaft: its tip, where its arrowhead points, then each point it bends at on its way to
   * `at`.
   */
  readonly shafts: readonly (readonly Point[])[];
  /**
   * Which side of `at` the note is on. Defaults to the side away from the first shaft: in a style
   * whose `direction` is horizontal, right when `at` is not to the left of the shaft's last point
   * before it, its last bend or its tip, and in a vertical one above when `at` is not below it.
   * Above or below, the landing meets the note at its bottom or top.
   */
  readonly side?: LeaderSide;
  /** Where the landing meets the side of the note. Defaults to its style's. */
  readonly attachment?: LeaderAttachment;
  /** Where the landing meets a note above or below it. Defaults to its style's. */
  readonly verticalAttachment?: LeaderVerticalAttachment;
  /** The width the note wraps at, in the same units as its sizes: times its style's scale. */
  readonly width?: number;
  /** True for a frame around the note. Defaults to its style's. */
  readonly frame?: boolean;
  /** A mask behind the note. */
  readonly mask?: TextMask;
  /** How its shafts run through their points. Defaults to its style's. */
  readonly shaft?: LeaderShaftKind;
  /**
   * The shafts of a second root, on the note's far side: each its tip, then each point it bends
   * at on its way to that root, whose point is worked out from the note.
   */
  readonly farShafts?: readonly (readonly Point[])[];
  /** The leader's own text style, in place of its style's. */
  readonly textStyle?: string;
  /** The leader's own sizes, in place of its style's, in the same units: each times its scale. */
  readonly textHeight?: number;
  readonly arrowSize?: number;
  readonly landing?: number;
  readonly gap?: number;
}

/**
 * A raster image: a PNG or a JPEG file, which the leading CAD app loads each time it opens the
 * drawing and draws at its size in drawing units. The drawing holds the file's path and its size
 * in pixels, and nothing of what it shows. Each file the drawing's images name is written as one
 * definition of it. R2018 only.
 */
export interface Image extends EntityBase {
  readonly kind: "image";
  /**
   * The file's path from the folder of this drawing's file, with `\` or `/` between folders, such
   * as `"aerial.png"` or `"..\\images\\aerial.png"`.
   */
  readonly path: string;
  /**
   * The file's width and height in pixels, as the file holds them, which `rasterSize` reads. The
   * leading CAD app draws the file's own pixels at the size each pixel has here, so an image of a
   * file with other pixels plots at the wrong size.
   */
  readonly pixels: readonly [width: number, height: number];
  /** Where its lower-left corner goes. */
  readonly at: Point;
  /** How wide it is along its bottom edge, in drawing units. */
  readonly width: number;
  /** How high it is up its side, in drawing units. */
  readonly height: number;
  /** Degrees counterclockwise. Defaults to 0. */
  readonly rotation?: number;
  /**
   * The outline that clips it, in the drawing's coordinates: two opposite corners of a rectangle
   * along its sides, or the points of a polygon, three or more. What lies outside the clip or
   * outside the image is not shown.
   */
  readonly clip?: readonly Point[];
  /** True to show the image outside its clip and hide what the clip holds. */
  readonly invertClip?: boolean;
  /** True to show what is behind the transparent pixels of a PNG. Otherwise it is opaque. */
  readonly transparent?: boolean;
}

/**
 * A closed outline of a hatch: from each point to the next and from the last back to the first,
 * each side straight or an arc by its bulge, as a closed `Polyline`'s sides are.
 */
export interface HatchLoop {
  readonly points: readonly Point[];
  /** The bulge of each side, one for each, as `Polyline.bulges`. Defaults to every side straight. */
  readonly bulges?: readonly number[];
}

/** One line of a pattern's definition, in its file's units. */
export interface PatternLine {
  /** Degrees counterclockwise. */
  readonly angle: number;
  /** A point the line runs through. */
  readonly base: Point;
  /** Where the next line of the family lies from this one: along the line, then across it. */
  readonly offset: Point;
  /** Its dashes: a length drawn, a negative length left out, 0 a dot. Missing for a solid line. */
  readonly dashes?: readonly number[];
}

/**
 * A hatch pattern's definition: families of parallel lines, each through its base point at its
 * angle, the next one over moved by its offset, its dashes repeating from the base point.
 * `parsePatterns` reads the patterns of a pattern file.
 */
export interface HatchPattern {
  readonly name: string;
  readonly description?: string;
  readonly lines: readonly PatternLine[];
}

/**
 * How a hatch is drawn when it is not solid: a pattern of the drawing's `patterns`, by its name,
 * scaled and turned; or lines of its own, `spacing` apart at `angle`, crossed by as many square
 * to them when `crossed`. `origin` is where the pattern's lines start, `[0, 0]` unless given.
 */
export type HatchPatternChoice =
  | {
      readonly name: string;
      readonly scale?: number;
      /** Degrees counterclockwise. */
      readonly angle?: number;
      readonly origin?: Point;
    }
  | {
      readonly spacing: number;
      /** Degrees counterclockwise. */
      readonly angle?: number;
      readonly crossed?: boolean;
      readonly origin?: Point;
    };

/**
 * How a gradient runs from its first color to its second. `linear` runs across the box of the
 * loops; `cylinder` from the first color at both sides to the second along the middle; `spherical`
 * from a spot of the second color out to the first; `hemispherical` from a spot half the box's
 * larger side below its middle; `curved` from an oval along the bottom. Each `inverted-` name swaps
 * its pair's colors.
 */
export type GradientName = (typeof GRADIENT_KINDS)[number];

/**
 * A hatch's gradient: two colors, or one color and its tint, which gives the second as the color
 * with its lightness set to the tint, from 0 for black to 1 for white. It is turned by `angle`
 * about the middle of the box of the loops, and moved off the middle unless `centered`. CAD programs plot a gradient in its own colors, whatever the plot style table.
 */
export type HatchGradient = {
  readonly name: GradientName;
  /** Degrees counterclockwise. Defaults to 0. */
  readonly angle?: number;
  /** Defaults to true. */
  readonly centered?: boolean;
} & (
  | { readonly colors: readonly [Rgb, Rgb]; readonly color?: never; readonly tint?: never }
  | { readonly color: Rgb; readonly tint: number; readonly colors?: never }
);

/**
 * A hatch: an area filled solid in its pen's color, with a pattern's lines in its pen, or with a
 * gradient, which the leading CAD app holds as one entity a drafter edits and measures as one. The
 * area inside an odd number of its loops is filled, so a loop inside another is a hole, and a loop
 * inside a hole fills again. R2018 only.
 */
export interface Hatch extends EntityBase {
  readonly kind: "hatch";
  /** Its loops, in any order and either way round. */
  readonly loops: readonly HatchLoop[];
  /** Its pattern. Missing, it is solid or a gradient. */
  readonly pattern?: HatchPatternChoice;
  /** Its gradient, never with a pattern. Missing, it is solid or a pattern. */
  readonly gradient?: HatchGradient;
}

/**
 * A wipeout: a polygon filled with the paper's color, which hides what is drawn before it, such
 * as the lines behind a note. Its frame, the polygon drawn in its pen, shows as
 * `Drawing.wipeoutFrame` says. R2018 only.
 */
export interface Wipeout extends EntityBase {
  readonly kind: "wipeout";
  /** Its corners, three or more, in order. It closes back to the first. */
  readonly points: readonly Point[];
}

/**
 * A cell of a table: its text, or an object with what it holds and what it changes of its row's
 * cell style. A text is paragraph text, with a paragraph's codes, which wraps at the column's width
 * less the margins and makes its row as tall as it needs.
 */
export type TableCell = string | TableCellContent;

/** What a cell holds, and what it changes of its row's cell style. */
export interface TableCellContent {
  /** Its text, as a paragraph's value with its codes. `\P` breaks a line. */
  readonly text?: string;
  /** A block of the drawing, in place of a text. It takes no attribute values. */
  readonly block?: string;
  /** The block's scale. Missing, the block is scaled to fit the cell, less its margins. */
  readonly blockScale?: number;
  /** How many columns it spans, from its own to the right. Defaults to 1. */
  readonly columnSpan?: number;
  /** How many rows it spans, from its own down. Defaults to 1. */
  readonly rowSpan?: number;
  readonly align?: ParagraphAlign;
  readonly valign?: ParagraphVerticalAlign;
  /** The height of its text's capitals. */
  readonly textHeight?: number;
  /** The color index of its text. */
  readonly color?: number;
  /** The color index it is filled with, as a swatch. */
  readonly fill?: number;
}

/**
 * A table: a title row, a header row and data rows, in columns, which the leading CAD app holds as
 * one table entity a drafter adds a row to, resizes and edits cell by cell. Each row is as tall as
 * its tallest cell needs, and no less than the height given for it. R2018 only.
 */
export interface Table extends Placed {
  readonly kind: "table";
  /** A table style of the drawing. */
  readonly style: string;
  /** Its upper left corner. */
  readonly at: Point;
  /** Degrees counterclockwise. Defaults to 0. */
  readonly rotation?: number;
  /** The width of each column, from the left. */
  readonly columns: readonly number[];
  /** The title, in one cell across every column. Missing, the table has no title row. */
  readonly title?: TableCell;
  /** The least height of the title row. */
  readonly titleHeight?: number;
  /**
   * The header row, a cell for each column. Missing, the table has no header row. A cell that
   * another spans is `null`.
   */
  readonly header?: readonly (TableCell | null)[];
  /** The least height of the header row. */
  readonly headerHeight?: number;
  /** The data rows, from the top, each with a cell for each column. A cell that another spans is `null`. */
  readonly rows: readonly (readonly (TableCell | null)[])[];
  /** The least height of each data row, or `null` for as tall as its cells need. */
  readonly rowHeights?: readonly (number | null)[];
}

export type Entity =
  | Line
  | Polyline
  | Circle
  | Arc
  | Ellipse
  | Spline
  | Text
  | Paragraph
  | Insert
  | LinearDimension
  | AlignedDimension
  | RadiusDimension
  | DiameterDimension
  | JoggedRadiusDimension
  | AngularDimension
  | ArcLengthDimension
  | OrdinateDimension
  | Leader
  | Image
  | Hatch
  | Wipeout
  | Table;

/** How the cells of one kind of row are drawn. Each size missing is its table style's. */
export interface TableCellStyle {
  /** The text style of its cells. Defaults to its table style's. */
  readonly textStyle?: string;
  /** The height of its text's capitals. Defaults to its table style's. */
  readonly textHeight?: number;
  readonly align?: ParagraphAlign;
  readonly valign?: ParagraphVerticalAlign;
  /** The color index of its text. Missing, its table's. */
  readonly color?: number;
  /** The color index its cells are filled with. Missing, they are not filled. */
  readonly fill?: number;
  /** The lineweight of its cells' borders, in millimetres. Missing, its table's. */
  readonly lineweight?: number;
}

/**
 * A table style: how the tables that name it are drawn. Its title row's cells are centered
 * across and up and down, as are its header's, and its data cells' are centered across at the
 * top, unless a cell style says otherwise.
 */
export interface TableStyle {
  readonly name: string;
  /** The text style of its cells. Defaults to `"Standard"`. */
  readonly textStyle?: string;
  /** The height of its text's capitals, for each kind of row that gives none of its own. */
  readonly textHeight: number;
  /** The room between a cell's sides and its content. Defaults to a third of `textHeight`. */
  readonly horizontalMargin?: number;
  /** The room between a cell's top and bottom and its content. Defaults to a third of `textHeight`. */
  readonly verticalMargin?: number;
  readonly title?: TableCellStyle;
  readonly header?: TableCellStyle;
  readonly data?: TableCellStyle;
}

/**
 * A leader style: how the leaders that name it are drawn. Its sizes are the sizes its leaders
 * plot at, each multiplied by `scale`, so a style for another view is the same style with
 * another scale.
 *
 * tsdraft draws every leader the same way where a style has no choice: straight shafts, a level
 * landing, and a note laid out as paragraph text, its lines spaced at least as far as they need.
 */
export interface LeaderStyle {
  readonly name: string;
  /** The text style of the note. Defaults to `"Standard"`. */
  readonly textStyle?: string;
  /** The height of the note's capitals. */
  readonly textHeight: number;
  /** One of `LEADER_ARROWHEADS`. Defaults to `"closed-filled"`. */
  readonly arrowhead?: string;
  /** The length of an arrowhead, or 0 for none. */
  readonly arrowSize: number;
  /** The length of the landing, or 0 for none. */
  readonly landing: number;
  /** The gap between the end of the landing and the note. */
  readonly gap: number;
  /** Where the landing meets the side of the note. Defaults to `"first-line"`. */
  readonly attachment?: LeaderAttachment;
  /**
   * Whether the landing meets the side of the note, `"horizontal"`, the default, or its top or
   * bottom, `"vertical"`, which also sets the side a leader's note takes by default.
   */
  readonly direction?: LeaderDirection;
  /** Where the landing meets a note above or below it. Defaults to `"center"`. */
  readonly verticalAttachment?: LeaderVerticalAttachment;
  /** True for a frame around each note, one gap outside it. Defaults to false. */
  readonly frame?: boolean;
  /** How its leaders' shafts run through their points: `"straight"`, the default, or `"curved"`. */
  readonly shaft?: LeaderShaftKind;
  /** A block of the drawing its leaders hold in place of a note. */
  readonly block?: string;
  /**
   * How a block meets the landing: by its extents, `"extents"`, the default, or by its outline on
   * the line through its insertion point, `"insertion"`.
   */
  readonly blockConnection?: LeaderBlockConnection;
  /** What the block is scaled by, times `scale`. Defaults to 1. */
  readonly blockScale?: number;
  /**
   * What every size of the style is multiplied by: how many units of the leader's space one
   * unit of the sizes is. Defaults to 1.
   */
  readonly scale?: number;
}

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
  /**
   * How a measurement is written: `"decimal"`, the default, or `"architectural"`, in feet and
   * inches with a fraction of an inch, such as `4'-1 7/16"`, taking a length times the
   * measurement scale as inches.
   */
  readonly units?: (typeof DIMENSION_UNITS)[number];
  /**
   * From 0 to 8: in decimal units the decimals a measurement is written with, and in
   * architectural units the least fraction of an inch, 1 over 2 to this power, so 0 writes
   * whole inches and 4 sixteenths.
   */
  readonly precision: number;
  /** Written before each measurement. */
  readonly prefix?: string;
  /** Written after each measurement. */
  readonly suffix?: string;
  /**
   * The zeros a measurement in decimal units leaves out: `"leading"` writes 0.5 as `.5`,
   * `"trailing"` writes 52.50 as `52.5` and 52.00 as `52`, and `"both"` does both. Defaults to
   * none.
   */
  readonly suppressZeros?: (typeof ZERO_SUPPRESSIONS)[number];
  /**
   * The zeros a measurement in architectural units writes: `"inches"`, the default, writes
   * `4'-0"` and `6"`, `"feet"` writes `4'` and `0'-6"`, `"both"` writes `4'-0"` and `0'-6"`, and
   * `"neither"` writes `4'` and `6"`.
   */
  readonly feetInchZeros?: (typeof FEET_INCH_ZEROS)[number];
  /** What a length is multiplied by before it is written. Defaults to 1. */
  readonly measurementScale?: number;
  /**
   * How a measurement in architectural units writes its fraction of an inch: `"inline"`, the
   * default, as `4'-1 7/16"`; `"stacked"`, over a bar; or `"diagonal"`, beside a slash.
   */
  readonly fraction?: (typeof DIMENSION_FRACTIONS)[number];
  /** The height of a stacked fraction as a share of the text's height, from 0.25 to 1. Defaults to 1. */
  readonly fractionScale?: number;
  /**
   * Where the text is: `"above"` the dimension line, the default, or `"centered"` in a break of
   * it.
   */
  readonly textPlacement?: (typeof DIMENSION_TEXT_PLACEMENTS)[number];
  /**
   * Where the text goes when it does not fit between the extension lines: `"inside"` them all the
   * same, the default, or outside on a `"leader"` from the middle of the dimension line.
   */
  readonly textFit?: (typeof DIMENSION_TEXT_FITS)[number];
  /**
   * In millimetres, one of `Lineweight`: how heavy the dimension line, its arrowheads and ticks
   * and a leader to its text plot. Defaults to the dimension's own.
   */
  readonly dimensionLineweight?: number;
  /** The same for the extension lines. Defaults to the dimension's own. */
  readonly extensionLineweight?: number;
  /**
   * How the text of a radius, a diameter or a jogged radius dimension reads: `"aligned"` along its
   * line, the default, or level, `"horizontal"`: on a short level landing outside a circle, and
   * across a jogged one's line. Linear and aligned dimensions take no notice of it.
   */
  readonly radialText?: (typeof DIMENSION_RADIAL_TEXTS)[number];
  /** The angle of a jogged radius dimension's jog to its line, in degrees from 5 to 90. Defaults to 45. */
  readonly jogAngle?: number;
  /**
   * The units an angular dimension writes its angle in: `"degrees"`, the default, as `45.5°`,
   * `"degrees-minutes-seconds"`, as `45°30'`, `"grads"`, as `50.56g`, or `"radians"`, as `0.79r`.
   */
  readonly angleUnits?: (typeof DIMENSION_ANGLE_UNITS)[number];
  /**
   * How many decimals an angle takes, from 0, the default, to 8. In degrees, minutes and seconds,
   * 0 writes the degrees, 1 and 2 the minutes too, 3 and 4 the seconds, and more the seconds'
   * decimals.
   */
  readonly anglePrecision?: number;
  /** The zeros an angle leaves out, as `suppressZeros` does for a length. */
  readonly suppressAngleZeros?: "leading" | "trailing" | "both";
  /**
   * A mask behind the text: `true` for the drawing's background, or a color index of its own, over
   * the text's box grown by a quarter of its height. Defaults to none.
   */
  readonly textMask?: boolean | { readonly color: number };
  /**
   * Where an arc length dimension draws the arc symbol: `"before"` its text, the default,
   * `"above"` it, or `"none"`.
   */
  readonly arcSymbol?: (typeof DIMENSION_ARC_SYMBOLS)[number];
}

/**
 * An attribute definition of a block: a text that each insert of the block carries with a
 * value of its own, under a tag, in the block's coordinates. One of one line is placed and
 * justified as a `Text` is, and one of paragraph text as a `Paragraph` is.
 */
export type AttributeDefinition = TextAttributeDefinition | ParagraphAttributeDefinition;

/** What an attribute definition of one line and one of paragraph text share. */
interface AttributeDefinitionBase {
  /** The name of the attribute in its block, with no lower-case letter a to z. */
  readonly tag: string;
  /** What CAD asks for when the block is inserted by hand. Defaults to the tag. */
  readonly prompt?: string;
  /** The value of an insert that does not set this attribute. */
  readonly value: string;
  /** The layer of the attribute on each insert. `"0"` stands for the insert's layer. */
  readonly layer: string;
  readonly at: Point;
  /** The height of a capital. */
  readonly height: number;
  /** Degrees counterclockwise. */
  readonly rotation: number;
  /** A text style of the drawing. Defaults to `"Standard"`. */
  readonly style?: string;
}

/** An attribute definition of one line, placed and justified as a `Text` is. */
export interface TextAttributeDefinition extends AttributeDefinitionBase {
  /** Defaults to `"text"`. */
  readonly kind?: "text";
  /** Defaults to `"left"`. */
  readonly align?: TextAlign;
  /** Defaults to `"baseline"`. */
  readonly valign?: TextVerticalAlign;
}

/**
 * An attribute definition of paragraph text: its value, and each insert's, holds the codes of a
 * `Paragraph`'s, wraps at `width` and breaks at each `\P`, and its box is placed by `at`, `align`
 * and `valign` as a paragraph's is. R2018 only.
 */
export interface ParagraphAttributeDefinition extends AttributeDefinitionBase {
  readonly kind: "paragraph";
  /** The width its lines wrap at. Missing, its lines break only at `\P`. */
  readonly width?: number;
  /** Defaults to `"left"`. */
  readonly align?: ParagraphAlign;
  /** Defaults to `"top"`. */
  readonly valign?: ParagraphVerticalAlign;
  /** A factor of the spacing of its lines, from 0.25 to 4. Defaults to 1. */
  readonly lineSpacing?: number;
  /** Defaults to `"at-least"`. */
  readonly lineSpacingStyle?: LineSpacingStyle;
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
 * An external reference, or xref: another drawing's DWG file, which the leading CAD app loads each
 * time it opens this drawing and draws wherever an insert of `name` places it. The drawing holds
 * the file's path and nothing of what the file draws.
 */
export interface Xref {
  /** A block name, which no block and no other xref of the drawing has. An insert names it. */
  readonly name: string;
  /**
   * The path of the DWG file from the folder of this drawing's file, with `\` or `/` between
   * folders, such as `"base.dwg"` or `"..\\survey\\base.dwg"`.
   */
  readonly path: string;
  /**
   * True for an attachment: a drawing that references this one draws the file too. An overlay,
   * the default, is drawn only by the drawing that references it.
   */
  readonly attach?: boolean;
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
  /**
   * The layers frozen in this viewport alone, by name. Each is a layer of the drawing. Nothing
   * on one shows in the viewport, as if it were frozen, and an insert on one shows nothing of
   * its block, while every other viewport and the model tab show them.
   */
  readonly frozenLayers?: readonly string[];
  /**
   * How far the view is turned, in degrees counterclockwise, more than -360 and less than 360:
   * the model shows on the paper turned that far about `center`. Defaults to 0.
   */
  readonly twist?: number;
}

/**
 * A layout: a sheet of paper with its page setup, what is drawn on it in paper units, and the
 * viewports that show model space on it. The leading CAD app shows each layout as a tab and plots
 * it as one page: on `DWG To PDF.pc3`, at 1:1, with the lineweights its entities have.
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
  /** The drawing's sheets. The leading CAD app opens a drawing that has one on the first. */
  readonly layouts?: readonly Layout[];
  /** The dimension styles that dimensions name. */
  readonly dimensionStyles?: readonly DimensionStyle[];
  /** The leader styles that leaders name. */
  readonly leaderStyles?: readonly LeaderStyle[];
  /** The table styles that tables name. */
  readonly tableStyles?: readonly TableStyle[];
  /**
   * Whether each image's frame shows and plots: its outline, or its clip's, in its pen. Defaults
   * to true, as the leading CAD app has it. A sheet with a logo or an aerial wants false.
   */
  readonly imageFrame?: boolean;
  /**
   * Whether each wipeout's frame shows and plots: its polygon, in its pen. Defaults to true, as
   * the leading CAD app has it. A mask behind notes wants false.
   */
  readonly wipeoutFrame?: boolean;
  /** The hatch patterns that hatches name, such as a firm's pattern file's from `parsePatterns`. */
  readonly patterns?: readonly HatchPattern[];
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
   * The values the drawing's sheets share in their title blocks, by what a field fills, such as
   * `project`, and by its tag for a field that fills none of them. `titleBlock()` gives a sheet's
   * own, which take their place. Under `sheetFiles` `"one-drawing"` a sheet's number is its
   * layout's name, and `fields` gives none.
   */
  readonly fields?: Z extends Standard ? TitleBlockFields : FieldsWithoutStandard;
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
  /**
   * Texts and shapes the pattern draws, each at the end of a length of it, in order: see
   * `Linetype.marks`. A text's style is one of the drawing's.
   */
  readonly marks?: readonly LinetypeMark[];
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
  /** A number from 1 to 255 in the color index CAD programs share. */
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
  C extends EntityColorGiven = EntityColor,
> {
  /**
   * A name for the entity that no other entity of the drawing has: 1 to 64 letters A to Z or a
   * to z, digits, `.`, `-` and `_`. Diagnostics and `toSVG` carry it.
   */
  readonly id?: EntityId<I>;
  /** Its own color: an index from 1 to 255, `"ByLayer"`, the default, `"ByBlock"`, or a true color. R2018 only. */
  readonly color?: V extends "R12" ? "ByLayer" | R12EntityColor : EntityColorOf<C>;
  /** Its own transparency: a whole percent from 0 to 90, `"ByLayer"`, the default, or `"ByBlock"`. R2018 only. */
  readonly transparency?: V extends "R12" ? "ByLayer" : EntityTransparency;
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

/** Checks a hatch's gradient as `lint` does, and returns the copy it checked. */
function hatchGradientCopy(given: unknown): HatchGradient {
  const read = readGradient(given);
  if ("problem" in read) return refuse("hatch-gradient", capitalized(read.problem));
  return read.gradient;
}

/** What `ellipse()` takes besides what every entity does. */
export interface EllipseOptions<
  V extends DxfVersion = "R2018",
  T extends string = string,
  W extends number = number,
  L extends LinetypeValue = LinetypeDefinition,
  I extends string = string,
  Z extends Standard | undefined = undefined,
  P extends string = string,
  O extends EntityColorGiven = EntityColor,
> extends EntityOptions<V, T, W, L, I, Z, P, O> {
  /**
   * For an arc of the ellipse, the parameter it starts at, in degrees counterclockwise from the end
   * of the major axis. Given with `endParameter` or not at all. Brought into 0 up to 360.
   */
  readonly startParameter?: number;
  /** For an arc of the ellipse, the parameter it ends at, in degrees. */
  readonly endParameter?: number;
}

/** What `spline()` takes besides what every entity does. */
export interface SplineOptions<
  V extends DxfVersion = "R2018",
  T extends string = string,
  W extends number = number,
  L extends LinetypeValue = LinetypeDefinition,
  I extends string = string,
  Z extends Standard | undefined = undefined,
  P extends string = string,
  S extends Point = Point,
  E extends Point = Point,
  C extends boolean = boolean,
  O extends EntityColorGiven = EntityColor,
> extends EntityOptions<V, T, W, L, I, Z, P, O> {
  /** The direction it leaves the first point in. Worked out from the points when left out. */
  readonly startTangent?: [C] extends [true] ? typeof SPLINE_CLOSED_TANGENT : Tangent<S>;
  /** The direction it arrives at the last point in. Worked out from the points when left out. */
  readonly endTangent?: [C] extends [true] ? typeof SPLINE_CLOSED_TANGENT : Tangent<E>;
  /** True to run from the last point back to the first, smooth through it. */
  readonly closed?: C;
}

/** What `controlSpline()` takes besides what every entity does. */
export interface ControlSplineOptions<
  V extends DxfVersion = "R2018",
  T extends string = string,
  W extends number = number,
  L extends LinetypeValue = LinetypeDefinition,
  I extends string = string,
  Z extends Standard | undefined = undefined,
  P extends string = string,
  D extends number = number,
  K extends readonly number[] = readonly number[],
  C extends readonly Point[] = readonly Point[],
  H extends readonly number[] = readonly number[],
  O extends EntityColorGiven = EntityColor,
> extends EntityOptions<V, T, W, L, I, Z, P, O> {
  /** From 1 up to `SPLINE_DEGREE_MOST`. Defaults to 3. */
  readonly degree?: SplineDegree<D>;
  /**
   * As many as the control points and the degree together, and one more, none less than the one
   * before. Defaults to clamped uniform knots: the degree and one more of 0, then 1, 2 and on,
   * and the degree and one more of the last.
   */
  readonly knots?: Knots<K, C, D>;
  /** One for each control point, each above 0, for a rational spline. */
  readonly weights?: Weights<H, C>;
  /**
   * True for a periodic spline, smooth where it joins. Without `knots`, the first `degree`
   * control points are added again at the end, with uniform knots, so the curve closes on them.
   */
  readonly closed?: boolean;
}

/**
 * A hatch's pattern as `hatch()` takes it: a `HatchPatternChoice` whose scale or spacing is greater
 * than 0 and not written as 0, with no field of the other kind.
 *
 * @typeParam S - The scale or the spacing as written.
 */
export type HatchPatternOf<S extends number = number> =
  | {
      readonly name: string;
      readonly scale?: Positive<S>;
      /** Degrees counterclockwise. */
      readonly angle?: number;
      readonly origin?: Point;
      readonly spacing?: never;
      readonly crossed?: never;
    }
  | {
      readonly spacing: Positive<S>;
      /** Degrees counterclockwise. */
      readonly angle?: number;
      readonly crossed?: boolean;
      readonly origin?: Point;
      readonly name?: never;
      readonly scale?: never;
    };

/**
 * The options of `hatch()`: its pattern or its gradient, and the options of every entity.
 *
 * @typeParam S - The pattern's scale or spacing as written.
 * @typeParam G - The gradient as written.
 */
export type HatchOptions<
  V extends DxfVersion = "R2018",
  T extends string = string,
  W extends number = number,
  L extends LinetypeValue = LinetypeDefinition,
  I extends string = string,
  Z extends Standard | undefined = undefined,
  P extends string = string,
  S extends number = number,
  G extends HatchGradient = HatchGradient,
  C extends EntityColorGiven = EntityColor,
> = EntityOptions<V, T, W, L, I, Z, P, C> &
  (
    | {
        /**
         * The lines it is drawn with in its pen: a pattern that `patterns()` added, by its name,
         * with its `scale`, `angle` and `origin`, or lines of its own, `spacing` apart. Solid when
         * left out.
         */
        readonly pattern?: HatchPatternOf<S>;
        readonly gradient?: never;
      }
    | {
        /**
         * Its gradient: two colors, or one color and its tint, never with a pattern. Each color
         * is `[red, green, blue]`, each a whole number from 0 to 255.
         */
        readonly gradient: GradientOf<G>;
        readonly pattern?: never;
      }
  );

/**
 * How wide a polyline is drawn: the width of every side, in drawing units, 0 or more. CAD
 * programs fill a side that has a width, at that width whatever its pen, and draw one of width 0
 * with its pen. R2018 only.
 */
interface Widened<V extends DxfVersion, N extends number> {
  readonly width?: V extends "R12" ? R12Polylines : PolylineWidth<N>;
}

/**
 * The options of `polyline()`: the bulge and the width of its sides, or a radius that rounds its
 * corners, and the options of every entity.
 *
 * @typeParam N - The width as written.
 * @typeParam R - The radius as written.
 */
export interface PolylineOptions<
  V extends DxfVersion = "R2018",
  T extends string = string,
  W extends number = number,
  L extends LinetypeValue = LinetypeDefinition,
  I extends string = string,
  Z extends Standard | undefined = undefined,
  P extends string = string,
  N extends number = number,
  R extends number = number,
  C extends EntityColorGiven = EntityColor,
>
  extends EntityOptions<V, T, W, L, I, Z, P, C>, Widened<V, N> {
  /**
   * The bulge of each side, one for each: 0 for a straight side, and for an arc the tangent of a
   * quarter of the angle it turns through, greater than 0 when it turns counterclockwise.
   * `bulgeThrough` gives the bulge of the arc through a third point. R2018 only.
   */
  readonly bulges?: V extends "R12" ? R12Polylines : readonly number[];
  /** The width of each side at its start and at its end, one pair for each side. R2018 only. */
  readonly widths?: V extends "R12" ? R12Polylines : readonly (readonly [number, number])[];
  /** Runs the linetype's pattern on past each vertex: see `Polyline.linetypeGeneration`. R2018 only. */
  readonly linetypeGeneration?: V extends "R12" ? R12Polylines : boolean;
  /**
   * Rounds every corner with an arc of this radius, tangent to both sides, as a bar's bend or a
   * duct's turn is drawn. The polyline then holds the arcs' ends in place of its corners. With
   * `width` only, not `bulges` or `widths`. R2018 only.
   */
  readonly radius?: V extends "R12" ? R12Polylines : Positive<R>;
}

/**
 * The options of `rect()`: a radius that rounds its corners, and the options of every entity.
 *
 * @typeParam R - The radius as written.
 */
export interface RectOptions<
  V extends DxfVersion = "R2018",
  T extends string = string,
  W extends number = number,
  L extends LinetypeValue = LinetypeDefinition,
  I extends string = string,
  Z extends Standard | undefined = undefined,
  P extends string = string,
  R extends number = number,
  C extends EntityColorGiven = EntityColor,
> extends EntityOptions<V, T, W, L, I, Z, P, C> {
  /** Rounds each corner with a quarter circle of this radius, at most half the shorter side. R2018 only. */
  readonly radius?: V extends "R12" ? R12Polylines : Positive<R>;
}

/**
 * The options of `cloud()`: the length of its arcs, its width, and the options of every entity.
 *
 * @typeParam A - The length of an arc as written.
 * @typeParam N - The width as written.
 */
export interface CloudOptions<
  A extends number = number,
  T extends string = string,
  W extends number = number,
  L extends LinetypeValue = LinetypeDefinition,
  I extends string = string,
  Z extends Standard | undefined = undefined,
  P extends string = string,
  N extends number = number,
  C extends EntityColorGiven = EntityColor,
>
  extends EntityOptions<"R2018", T, W, L, I, Z, P, C>, Widened<"R2018", N> {
  /**
   * About how far apart the ends of each arc are, in drawing units: each side of the outline
   * holds the whole number of arcs nearest its length over this, and at least one.
   */
  readonly arc: Positive<A>;
}

/**
 * The options of `donut()`: the diameter of its hole, and the options of every entity.
 *
 * @typeParam H - The diameter of the hole as written.
 */
export interface DonutOptions<
  H extends number = number,
  T extends string = string,
  W extends number = number,
  L extends LinetypeValue = LinetypeDefinition,
  I extends string = string,
  Z extends Standard | undefined = undefined,
  P extends string = string,
  C extends EntityColorGiven = EntityColor,
> extends EntityOptions<"R2018", T, W, L, I, Z, P, C> {
  /** The diameter of its hole, less than the outside diameter. Defaults to 0: a filled dot. */
  readonly inside?: DonutHole<H>;
}

/**
 * The options of `image()`: the file's pixels, the image's size and turn, its clip, and the
 * options of every entity.
 *
 * @typeParam IW - The width as written.
 * @typeParam IH - The height as written.
 */
export interface ImageOptions<
  IW extends number = number,
  IH extends number = number,
  T extends string = string,
  W extends number = number,
  L extends LinetypeValue = LinetypeDefinition,
  I extends string = string,
  Z extends Standard | undefined = undefined,
  P extends string = string,
  C extends EntityColorGiven = EntityColor,
> extends EntityOptions<"R2018", T, W, L, I, Z, P, C> {
  /** The file's width and height in pixels, which `rasterSize` reads from its bytes. */
  readonly pixels: readonly [width: number, height: number];
  /** How wide the image is along its bottom edge, in drawing units. */
  readonly width: Positive<IW>;
  /** How high it is. Defaults to the width times the file's height over its width. */
  readonly height?: Positive<IH>;
  /** Degrees counterclockwise. Defaults to 0. */
  readonly rotation?: number;
  /**
   * The outline that clips it, in the drawing's coordinates: two opposite corners of a rectangle
   * along its sides, or the points of a polygon, three or more.
   */
  readonly clip?: readonly Point[];
  /** True to show the image outside its clip and hide what the clip holds. */
  readonly invertClip?: boolean;
  /** True to show what is behind the transparent pixels of a PNG. */
  readonly transparent?: boolean;
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
  C extends EntityColorGiven = EntityColor,
> = EntityOptions<V, T, W, L, I, Z, P, C> &
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
 * The options of `paragraph()`: where its box is, its width, height, rotation, style,
 * justification and line spacing, and the options of every entity.
 *
 * @typeParam N - The width as written.
 * @typeParam F - The line spacing factor as written.
 */
export type ParagraphOptions<
  H extends number = number,
  T extends string = string,
  W extends number = number,
  L extends LinetypeValue = LinetypeDefinition,
  I extends string = string,
  S extends string = string,
  D extends TextStyleValue = TextStyleDefinition,
  Z extends Standard | undefined = undefined,
  P extends string = string,
  R extends string = string,
  N extends number = number,
  F extends number = number,
  C extends EntityColorGiven = EntityColor,
> = EntityOptions<"R2018", T, W, L, I, Z, P, C> &
  ParagraphPlacement<Z, N, F> &
  Sized<Z, R, Positive<H>, TextStyleChoice<S, D>>;

/** Where a paragraph is, how wide, turned and justified, how its lines are spaced, and the view it is read in. */
interface ParagraphPlacement<Z extends Standard | undefined, N extends number, F extends number> {
  /** The point of the paragraph's box `align` and `valign` name. */
  readonly at: Point;
  /** The width its lines wrap at. Missing, its lines break only at a line feed. */
  readonly width?: Positive<N>;
  /** Degrees counterclockwise. */
  readonly rotation?: number;
  /** In model space, the view a paragraph with a role is read in, which `view()` returns. */
  readonly view?: Z extends Standard ? View : ViewWithoutStandard;
  /** Where `at` is across the box, and how the lines are set in it. Defaults to `"left"`. */
  readonly align?: ParagraphAlign;
  /** Where `at` is up and down the box. Defaults to `"top"`. */
  readonly valign?: ParagraphVerticalAlign;
  /** A factor of the spacing of its lines, from 0.25 to 4. Defaults to 1. */
  readonly lineSpacing?: LineSpacing<F>;
  /** Defaults to `"at-least"`. */
  readonly lineSpacingStyle?: LineSpacingStyle;
  /**
   * Columns its lines flow through, each `width` wide, in drawing units: `{ count, height }` for
   * that many, `{ height }` for as many as it takes, or `{ heights }` for one of each height.
   */
  readonly columns?: ParagraphColumns;
  /**
   * A mask behind it, which hides what is drawn before it there: `true` for the drawing's
   * background, or `{ color, offsetFactor }`, over its box grown by the factor less one times its
   * height, 1.5 unless given.
   */
  readonly mask?: TextMask;
}

/**
 * The role, height and style of a text or an attribute, where `Height` and `Style` are what it
 * takes without a standard. Under a standard a text names a role, which gives its height and its
 * style, so a literal height or style is a compile error with the builder's message: with a
 * literal role it names the role, and without one it says to give one. Each conditional is inside
 * the field it rules, so each branch of a conditional is checked as written.
 */
type Sized<Z extends Standard | undefined, R extends string, Height, Style> = Size<
  Z extends Standard ? RoleOfStandard<R, Z> : RoleWithoutStandard,
  RoleOr<Z, R, Height, RoleAndHeight>,
  RoleOr<Z, R, Style, RoleAndStyle>
>;

/**
 * `Given` without a standard. Under one, `Message` for a text with a literal role, which takes no
 * height and no style of its own, and the message that says to give a role for a text with none.
 */
type RoleOr<Z extends Standard | undefined, R extends string, Given, Message> = Z extends Standard
  ? string extends R
    ? TextWithoutRole
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
 * rotation, style and justification, which are a text's, or with `kind: "paragraph"` a
 * paragraph's.
 *
 * @typeParam D - The text style as written, a name or a definition, checked as a text's is.
 * @typeParam R - The role as written.
 * @typeParam Q - The default value of paragraph text as written, checked as a paragraph's is.
 */
export type AttributeOptions<
  H extends number = number,
  S extends string = string,
  D extends TextStyleValue = TextStyleDefinition,
  Z extends Standard | undefined = undefined,
  R extends string = string,
  Q extends string = string,
  N extends number = number,
  F extends number = number,
> = (TextAttributeFields | ParagraphAttributeFields<Q, N, F>) &
  Sized<Z, R, Positive<H>, TextStyleChoice<S, D>>;

/** What an attribute definition holds besides its role, height and style. */
interface AttributeFields {
  /** What CAD asks for when the block is inserted by hand. Defaults to the tag. */
  readonly prompt?: string;
  /** Degrees counterclockwise. */
  readonly rotation?: number;
}

/** What a definition of one line holds besides its role, height and style. */
interface TextAttributeFields extends AttributeFields {
  /** Defaults to `"text"`. */
  readonly kind?: "text";
  /** The value of an insert that does not set the attribute. Defaults to `""`. */
  readonly value?: string;
  /** Where `at` is along the text's line. Defaults to `"left"`. */
  readonly align?: TextAlign;
  /** Where `at` is up and down the text's line. Defaults to `"baseline"`. */
  readonly valign?: TextVerticalAlign;
  /** Fields of paragraph text alone, which an attribute of one line never has. */
  readonly width?: never;
  readonly lineSpacing?: never;
  readonly lineSpacingStyle?: never;
}

/** What a definition of paragraph text holds besides its role, height and style. R2018 only. */
interface ParagraphAttributeFields<
  Q extends string,
  N extends number,
  F extends number,
> extends AttributeFields {
  readonly kind: "paragraph";
  /**
   * The value of an insert that does not set the attribute, with a paragraph's codes: a line
   * feed in it is written as `\P`. Defaults to `""`.
   */
  readonly value?: ParagraphValue<Q>;
  /** The width its lines wrap at. Missing, its lines break only at a line feed. */
  readonly width?: Positive<N>;
  /** Where `at` is across the box, and how the lines are set in it. Defaults to `"left"`. */
  readonly align?: ParagraphAlign;
  /** Where `at` is up and down the box. Defaults to `"top"`. */
  readonly valign?: ParagraphVerticalAlign;
  /** A factor of the spacing of its lines, from 0.25 to 4. Defaults to 1. */
  readonly lineSpacing?: LineSpacing<F>;
  /** Defaults to `"at-least"`. */
  readonly lineSpacingStyle?: LineSpacingStyle;
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
  C extends EntityColorGiven = EntityColor,
> = InsertFields<I, C> &
  (Z extends Standard
    ?
        | (Scaled<View, InsertViewAndScale> & { readonly view: View })
        | Scaled<undefined, InsertScale<S>>
    : Scaled<ViewWithoutStandard, InsertScale<S>>);

/** What an insert holds besides its scale and its view. */
interface InsertFields<I extends string, C extends EntityColorGiven = EntityColor> {
  /**
   * A name for the insert that no other entity of the drawing has. The insert's attributes
   * keep their handles with it.
   */
  readonly id?: EntityId<I>;
  /** Its own color: an index from 1 to 255, `"ByLayer"`, the default, `"ByBlock"`, or a true color. R2018 only. */
  readonly color?: EntityColorOf<C>;
  /** Its own transparency: a whole percent from 0 to 90, `"ByLayer"`, the default, or `"ByBlock"`. R2018 only. */
  readonly transparency?: EntityTransparency;
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
  U extends (typeof DIMENSION_UNITS)[number] = "decimal",
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
  /**
   * `"decimal"`, the default, or `"architectural"`, which writes feet and inches with a
   * fraction, such as `4'-1 7/16"`, taking a length times the measurement scale as inches.
   */
  readonly units?: U;
  /**
   * From 0 to 8: the decimals of a measurement in decimal units, and in architectural units
   * the least fraction of an inch, 1 over 2 to this power: 0 for whole inches, 4 for 1/16".
   */
  readonly precision: Precision<P>;
  /** Written before each measurement. */
  readonly prefix?: DimensionPrefix<PRE>;
  /** Written after each measurement, such as `"'"` for feet. */
  readonly suffix?: DimensionAffix<SUF>;
  /** The zeros a measurement in decimal units leaves out. Defaults to none. */
  readonly suppressZeros?: SuppressZerosIn<U>;
  /**
   * The zeros a measurement in architectural units writes: `"inches"`, the default, writes
   * `4'-0"` and `6"`, `"feet"` writes `4'` and `0'-6"`, `"both"` writes `4'-0"` and `0'-6"`,
   * and `"neither"` writes `4'` and `6"`.
   */
  readonly feetInchZeros?: FeetInchZerosIn<U>;
  /** What a length is multiplied by before it is written, greater than 0. Defaults to 1. */
  readonly measurementScale?: MeasurementScale<MS>;
  /**
   * In architectural units, how the fraction of an inch is written: `"inline"`, the default, as
   * `4'-1 7/16"`, `"stacked"` over a bar, or `"diagonal"` beside a slash.
   */
  readonly fraction?: U extends "architectural" ? (typeof DIMENSION_FRACTIONS)[number] : never;
  /** A stacked fraction's height as a share of the text's, from 0.25 to 1. Defaults to 1. */
  readonly fractionScale?: U extends "architectural" ? number : never;
  /** The text `"above"` the dimension line, the default, or `"centered"` in a break of it. */
  readonly textPlacement?: (typeof DIMENSION_TEXT_PLACEMENTS)[number];
  /**
   * Where the text goes when it does not fit between the extension lines: `"inside"` them, the
   * default, or outside on a `"leader"`.
   */
  readonly textFit?: (typeof DIMENSION_TEXT_FITS)[number];
  /** The lineweight of the dimension line and its arrowheads, in millimetres, one of `Lineweight`. */
  readonly dimensionLineweight?: number;
  /** The lineweight of the extension lines, in millimetres, one of `Lineweight`. */
  readonly extensionLineweight?: number;
  /** A radial dimension's text `"aligned"` along its line, the default, or `"horizontal"`. */
  readonly radialText?: (typeof DIMENSION_RADIAL_TEXTS)[number];
  /** The angle of a jogged radius dimension's jog to its line, in degrees from 5 to 90. Defaults to 45. */
  readonly jogAngle?: number;
  /**
   * The units an angular dimension writes its angle in: `"degrees"`, the default, as `45.5°`,
   * `"degrees-minutes-seconds"`, as `45°30'`, `"grads"`, as `50.56g`, or `"radians"`, as `0.79r`.
   */
  readonly angleUnits?: (typeof DIMENSION_ANGLE_UNITS)[number];
  /**
   * How many decimals an angle takes, from 0, the default, to 8. In degrees, minutes and seconds,
   * 0 writes the degrees, 1 and 2 the minutes too, 3 and 4 the seconds, and more the seconds'
   * decimals.
   */
  readonly anglePrecision?: number;
  /** The zeros an angle leaves out, as `suppressZeros` does for a length. */
  readonly suppressAngleZeros?: "leading" | "trailing" | "both";
  /**
   * A mask behind the text: `true` for the drawing's background, or a color index of its own, over
   * the text's box grown by a quarter of its height. Defaults to none.
   */
  readonly textMask?: boolean | { readonly color: number };
  /**
   * Where an arc length dimension draws the arc symbol: `"before"` its text, the default,
   * `"above"` it, or `"none"`.
   */
  readonly arcSymbol?: (typeof DIMENSION_ARC_SYMBOLS)[number];
}

/** What every dimension is drawn with. */
interface DimensionOptions<
  S extends string = string,
  T extends string = string,
  I extends string = string,
  C extends EntityColorGiven = EntityColor,
> {
  /** A dimension style of the drawing. */
  readonly style: DimensionStyleName<S>;
  /**
   * A text to draw in place of the measurement, in which `<>` stands for the measurement:
   * `"<> TYP"`, or `"VARIES"`.
   */
  readonly text?: DimensionText<T>;
  /**
   * Words under the dimension line, opposite its text: `"WINDOW HEAD HT."`. `<>` in them stands
   * for the measurement where `text` holds none.
   */
  readonly textBelow?: DimensionText<string>;
  /** A name for the dimension that no other entity of the drawing has. */
  readonly id?: EntityId<I>;
  /** Its own color: an index from 1 to 255, `"ByLayer"`, the default, `"ByBlock"`, or a true color. R2018 only. */
  readonly color?: EntityColorOf<C>;
  /** Its own transparency: a whole percent from 0 to 90, `"ByLayer"`, the default, or `"ByBlock"`. R2018 only. */
  readonly transparency?: EntityTransparency;
  readonly view?: ViewWithoutStandard;
}

/** The options of `linearDimension()`. */
export interface LinearDimensionOptions<
  S extends string = string,
  T extends string = string,
  I extends string = string,
  C extends EntityColorGiven = EntityColor,
> extends DimensionOptions<S, T, I, C> {
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
  C extends EntityColorGiven = EntityColor,
> = DimensionOptions<S, T, I, C>;

/** The options of `radiusDimension()`. */
export interface RadiusDimensionOptions<
  S extends string = string,
  T extends string = string,
  I extends string = string,
  C extends EntityColorGiven = EntityColor,
> extends DimensionOptions<S, T, I, C> {
  /**
   * How far the middle of its text is from the center, along its line, past the center for less
   * than 0. Left out, the text stands outside the circle, past the arrowhead.
   */
  readonly textFromCenter?: number;
}

/** The options of `diameterDimension()`. */
export type DiameterDimensionOptions<
  S extends string = string,
  T extends string = string,
  I extends string = string,
  C extends EntityColorGiven = EntityColor,
> = RadiusDimensionOptions<S, T, I, C>;

/** The options of `arcLengthDimension()`. */
export type ArcLengthDimensionOptions<
  S extends string = string,
  T extends string = string,
  I extends string = string,
  C extends EntityColorGiven = EntityColor,
> = DimensionOptions<S, T, I, C>;

/** The options of `ordinateDimension()`. */
export interface OrdinateDimensionOptions<
  S extends string = string,
  T extends string = string,
  I extends string = string,
  C extends EntityColorGiven = EntityColor,
> extends DimensionOptions<S, T, I, C> {
  /** `"x"` gives the feature's X from the origin, with its leader along Y; `"y"` its Y. */
  readonly axis: "x" | "y";
  /** The point it measures from. Defaults to `[0, 0]`. */
  readonly origin?: Point;
}

/** The options of `angularDimension()`. */
export type AngularDimensionOptions<
  S extends string = string,
  T extends string = string,
  I extends string = string,
  C extends EntityColorGiven = EntityColor,
> = DimensionOptions<S, T, I, C>;

/** The options of `joggedRadiusDimension()`. */
export type JoggedRadiusDimensionOptions<
  S extends string = string,
  T extends string = string,
  I extends string = string,
  C extends EntityColorGiven = EntityColor,
> = DimensionOptions<S, T, I, C>;

/**
 * What a dimension is drawn with under the standard `Z`: a dimension style of the standard by its
 * id, and in model space the view it is read in. The builder defines the drawing's own dimension
 * style for it on first use, with the standard's paper sizes, its role's text style and height, and
 * the writing of the units it is drawn in: `DIMS-1in-10ft` for the style `dims` in a view at
 * `1in-10ft`, scaled by `view.paper(1)`, and `DIMS` on a layout, unless the standard gives the
 * style another name there in `scaleNames` or `layoutName`.
 */
export interface StandardAlignedDimensionOptions<
  S extends string = string,
  T extends string = string,
  I extends string = string,
  Z extends Standard = Standard,
  C extends EntityColorGiven = EntityColor,
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
  /** Words under the dimension line, opposite its text, as `textBelow` of a drawing's own style. */
  readonly textBelow?: DimensionText<string>;
  /** A name for the dimension that no other entity of the drawing has. */
  readonly id?: EntityId<I>;
  /** Its own color: an index from 1 to 255, `"ByLayer"`, the default, `"ByBlock"`, or a true color. R2018 only. */
  readonly color?: EntityColorOf<C>;
  /** Its own transparency: a whole percent from 0 to 90, `"ByLayer"`, the default, or `"ByBlock"`. R2018 only. */
  readonly transparency?: EntityTransparency;
}

/** The options of `radiusDimension()` and `diameterDimension()` under the standard `Z`. */
export interface StandardRadiusDimensionOptions<
  S extends string = string,
  T extends string = string,
  I extends string = string,
  Z extends Standard = Standard,
  C extends EntityColorGiven = EntityColor,
> extends StandardAlignedDimensionOptions<S, T, I, Z, C> {
  /** How far the middle of its text is from the center, as `RadiusDimensionOptions` says. */
  readonly textFromCenter?: number;
}

/** The options of `ordinateDimension()` under the standard `Z`. */
export interface StandardOrdinateDimensionOptions<
  S extends string = string,
  T extends string = string,
  I extends string = string,
  Z extends Standard = Standard,
  C extends EntityColorGiven = EntityColor,
> extends StandardAlignedDimensionOptions<S, T, I, Z, C> {
  /** `"x"` gives the feature's X from the origin, with its leader along Y; `"y"` its Y. */
  readonly axis: "x" | "y";
  /** The point it measures from. Defaults to `[0, 0]`. */
  readonly origin?: Point;
}

/** The options of `linearDimension()` under the standard `Z`. */
export interface StandardLinearDimensionOptions<
  S extends string = string,
  T extends string = string,
  I extends string = string,
  Z extends Standard = Standard,
  C extends EntityColorGiven = EntityColor,
> extends StandardAlignedDimensionOptions<S, T, I, Z, C> {
  /**
   * The direction it measures along: `"x"`, the default, `"y"`, or an angle in degrees
   * counterclockwise from +X.
   */
  readonly along?: "x" | "y" | number;
}

/**
 * A leader style to define: a `LeaderStyle`, checked. Its sizes are lengths on paper, in the unit
 * that suits the sheet, and `scale` turns them into the units of the space its leaders are drawn
 * in: `fromPaper(1, "in", view)` for model space seen at a view's ratio, and 1 on a layout.
 */
export interface LeaderStyleDefinition<
  N extends string = string,
  S extends string = string,
  H extends number = number,
  A extends string = string,
  AS extends number = number,
  L extends number = number,
  G extends number = number,
  SC extends number = number,
> {
  readonly name: NewLeaderStyleName<N>;
  /** A text style of the drawing. Defaults to `"Standard"`. */
  readonly textStyle?: TextStyleName<S>;
  /** The height of the note's capitals, greater than 0. */
  readonly textHeight: Positive<H>;
  /** One of `LEADER_ARROWHEADS`. Defaults to `"closed-filled"`. */
  readonly arrowhead?: LeaderArrowheadOf<A>;
  /** The length of an arrowhead, or 0 for none. */
  readonly arrowSize: LeaderSize<AS>;
  /** The length of the landing, or 0 for none. */
  readonly landing: LeaderSize<L>;
  /** The gap between the end of the landing and the note. */
  readonly gap: LeaderSize<G>;
  /** Where the landing meets the side of the note. Defaults to `"first-line"`. */
  readonly attachment?: LeaderAttachment;
  /** `"horizontal"`, the default, or `"vertical"`: the landing meets the note's top or bottom. */
  readonly direction?: LeaderDirection;
  /** Where the landing meets a note above or below it. Defaults to `"center"`. */
  readonly verticalAttachment?: LeaderVerticalAttachment;
  /** True for a frame around each note, one gap outside it. Defaults to false. */
  readonly frame?: boolean;
  /** `"straight"`, the default, or `"curved"`: a curve through the tip, each bend and the landing. */
  readonly shaft?: LeaderShaftKind;
  /** A block of the drawing its leaders hold in place of a note, as `{ block }` gives one. */
  readonly block?: string;
  /** `"extents"`, the default, or `"insertion"`: how a block meets the landing. */
  readonly blockConnection?: LeaderBlockConnection;
  /** What the block is scaled by, times `scale`, greater than 0. Defaults to 1. */
  readonly blockScale?: number;
  /** What every size is multiplied by, greater than 0. Defaults to 1. */
  readonly scale?: LeaderScale<SC>;
}

/**
 * Where a leader's shafts end: the tip of its one shaft, or a list of shafts, each its tip, or
 * its tip and then each point it bends at on its way to the landing.
 */
export type LeaderTargets = Point | readonly (Point | readonly Point[])[];

/**
 * A block of the drawing in place of a leader's note, and the value of each of its attributes
 * that is not its definition's, by its tag. The note's own options, such as `width`, do not apply.
 */
export interface LeaderBlockContent {
  readonly block: string;
  readonly attributes?: Readonly<Record<string, string>>;
}

/** What every leader is drawn with: where its shafts meet, what they point to and how. */
interface LeaderPlacement<TO extends LeaderTargets = LeaderTargets> {
  /** Where the shafts meet and the landing starts. */
  readonly at: Point;
  /** What the note names: the tip of each shaft, as `LeaderTargets` says, and at least one. */
  readonly to: LeaderTargetsOf<TO>;
  /**
   * Which side of `at` the note is on. Defaults to the side away from the first shaft: right when
   * `at` is not to the left of the shaft's last point before it, or in a vertical style above
   * when `at` is not below it.
   */
  readonly side?: LeaderSide;
  /** Where the landing meets the side of the note. Defaults to its style's. */
  readonly attachment?: LeaderAttachment;
  /** Where the landing meets a note above or below it. Defaults to its style's. */
  readonly verticalAttachment?: LeaderVerticalAttachment;
  /** True for a frame around the note. Defaults to its style's. */
  readonly frame?: boolean;
  /** A mask behind the note: `true` for the drawing's background, or `{ color, offsetFactor }`. */
  readonly mask?: TextMask;
  /** How its shafts run through their points. Defaults to its style's. */
  readonly shaft?: LeaderShaftKind;
  /**
   * The shafts of a second root on the note's far side, as `to` gives shafts: its point is worked
   * out from the note, on its other side, or above or below it.
   */
  readonly toFarSide?: LeaderTargets;
}

/** The options of `leader()`. Each size of its own replaces its style's, and is multiplied by the style's scale. */
export interface LeaderOptions<
  S extends string = string,
  I extends string = string,
  TS extends string = string,
  H extends number = number,
  AS extends number = number,
  L extends number = number,
  G extends number = number,
  TO extends LeaderTargets = LeaderTargets,
  W extends number = number,
  C extends EntityColorGiven = EntityColor,
> extends LeaderPlacement<TO> {
  /** A leader style of the drawing. */
  readonly style: LeaderStyleName<S>;
  /** The width the note wraps at, greater than 0, in place of none: times the style's scale. */
  readonly width?: Positive<W>;
  /** A text style of the drawing for the note, in place of its style's. */
  readonly textStyle?: TextStyleName<TS>;
  /** The height of the note's capitals, in place of its style's. */
  readonly textHeight?: Positive<H>;
  /** The length of each arrowhead, in place of its style's. */
  readonly arrowSize?: LeaderSize<AS>;
  /** The length of the landing, in place of its style's. */
  readonly landing?: LeaderSize<L>;
  /** The gap between the landing and the note, in place of its style's. */
  readonly gap?: LeaderSize<G>;
  /** A name for the leader that no other entity of the drawing has. */
  readonly id?: EntityId<I>;
  /** Its own color: an index from 1 to 255, `"ByLayer"`, the default, `"ByBlock"`, or a true color. R2018 only. */
  readonly color?: EntityColorOf<C>;
  /** Its own transparency: a whole percent from 0 to 90, `"ByLayer"`, the default, or `"ByBlock"`. R2018 only. */
  readonly transparency?: EntityTransparency;
  readonly view?: ViewWithoutStandard;
  readonly role?: RoleWithoutStandard;
}

/**
 * What a leader is drawn with under the standard `Z`: a leader style of the standard by its id,
 * and in model space the view it is read in. The builder defines the drawing's own leader style for
 * it on first use, with the standard's paper sizes and its role's text style and height:
 * `NOTES-1in-10ft` for the style `notes` in a view at `1in-10ft`, scaled by `view.paper(1)`, and
 * `NOTES` on a layout. A size of the leader's own is a length on paper, which the scale multiplies
 * as it does the style's, and `role` gives the note the text style and height of another role.
 */
export interface StandardLeaderOptions<
  S extends string = string,
  I extends string = string,
  R extends string = string,
  Z extends Standard = Standard,
  AS extends number = number,
  L extends number = number,
  G extends number = number,
  TO extends LeaderTargets = LeaderTargets,
  W extends number = number,
  C extends EntityColorGiven = EntityColor,
> extends LeaderPlacement<TO> {
  /** A leader style of the standard, by its id. Defaults to its `defaultLeaderStyle`. */
  readonly style?: LeaderStyleOfStandard<S, Z>;
  /** The width the note wraps at on paper, greater than 0. */
  readonly width?: Positive<W>;
  /** In model space, the view the leader is read in, which `view()` returns. */
  readonly view?: View;
  /** A text role of the standard for the note, in place of its style's. */
  readonly role?: RoleOfStandard<R, Z>;
  /** The length of each arrowhead on paper, in place of its style's. */
  readonly arrowSize?: LeaderSize<AS>;
  /** The length of the landing on paper, in place of its style's. */
  readonly landing?: LeaderSize<L>;
  /** The gap between the landing and the note on paper, in place of its style's. */
  readonly gap?: LeaderSize<G>;
  /** A name for the leader that no other entity of the drawing has. */
  readonly id?: EntityId<I>;
  /** Its own color: an index from 1 to 255, `"ByLayer"`, the default, `"ByBlock"`, or a true color. R2018 only. */
  readonly color?: EntityColorOf<C>;
  /** Its own transparency: a whole percent from 0 to 90, `"ByLayer"`, the default, or `"ByBlock"`. R2018 only. */
  readonly transparency?: EntityTransparency;
  readonly textStyle?: LeaderRoleAndText;
  readonly textHeight?: LeaderRoleAndText;
}

/** What `layout()` sets on a layout. */
/** The options of `table()`: the table, but for its kind and its layer, which is the current one. */
export type TableOptions = Omit<Table, "kind" | "layer" | "color" | "transparency"> & {
  /** A table has no color of its own: its style and its cells give its colors. */
  readonly color?: "ByLayer";
  /** A table has no transparency of its own: CAD programs plot its grid opaque. */
  readonly transparency?: "ByLayer";
};

export interface LayoutOptions<P extends string = string> {
  /** One of `PAPERS`, such as `"ARCH D"`. */
  readonly paper: PaperOf<P>;
  /** Defaults to `"monochrome.ctb"`, which plots every color in black. */
  readonly plotStyle?: PlotStyleTable;
  readonly sheetFormat?: SheetFormatWithoutStandard;
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
  /** The layers frozen in this viewport alone, each a layer the drawing has by then. */
  readonly frozenLayers?: readonly string[];
  /** How far the view is turned, in degrees counterclockwise, under a turn. Defaults to 0. */
  readonly twist?: number;
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
  /** The layers frozen in this viewport alone, each a layer the drawing has by then. */
  readonly frozenLayers?: readonly string[];
  /** How far the view is turned, in degrees counterclockwise, under a turn. Defaults to 0. */
  readonly twist?: number;
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
  /** Under a standard, the part of the paper inside the border of the sheet format's title block. */
  readonly drawingArea: Z extends Standard ? Zone : undefined;
  /**
   * A zone of the layout's sheet format, a box of its drawing area that the sheet is laid out by,
   * such as `views`. Under a standard alone.
   */
  zone(name: Z extends Standard ? string : ZoneWithoutStandard): Zone;
  /**
   * Places the layout's title block: the firm's drawing as an xref at its point, when the title
   * block has one, and the block of its fields at `[0, 0]` over it, on the title block's layer. A
   * field is filled from `fields`, then from `createDrawing`'s `fields`, then by the builder:
   * under `sheetFiles` `"one-drawing"` the number is the layout's name, and the scale is the label
   * of the one scale the layout's viewports show, or `AS NOTED` when they show more, which the
   * builder writes when the layout's `draw` returns. Under a standard alone, once on a layout.
   */
  titleBlock(
    ...fields: Z extends Standard
      ? [fields?: TitleBlockFields]
      : [fields: TitleBlockWithoutStandard]
  ): this;
  /**
   * Adds a viewport: a rectangle from its lower-left `corner`, in paper units, that shows
   * model space about `view.center` at `view.ratio`. Its border is on the current layer, and
   * its view is locked against zooming. Under a standard it shows the options' `view`, at the
   * view's scale and with the view's id. `frozenLayers` names the layers frozen in this
   * viewport alone, each a layer the drawing has when it is called, and `twist` turns the view
   * that many degrees counterclockwise about `center`.
   */
  viewport<W extends number, H extends number, R extends number, I extends string = string>(
    corner: Point,
    width: Positive<W>,
    height: Positive<H>,
    view: Z extends Standard ? StandardViewportOptions : ViewportOptions<R, I>,
  ): this;
}

/** A box of the paper, in paper units: a zone of a sheet format, or its drawing area. */
export interface Zone {
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The values a title block's fields are filled with, by what a field fills, and by its tag for a
 * field that fills none of these. A field whose source is `attribute` is written as the value of
 * its attribute.
 */
export interface TitleBlockFields {
  /** The sheet's number. Under `sheetFiles` `"one-drawing"` it is the layout's name. */
  readonly number?: string;
  readonly title?: string;
  readonly project?: string;
  readonly date?: string;
  /** Defaults to the label of the one scale the layout's viewports show, or `AS NOTED`. */
  readonly scale?: string;
  readonly drawnBy?: string;
  readonly checkedBy?: string;
  /** A field that fills none of the above, by its tag. */
  readonly [tag: string]: string | undefined;
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
  /** Under a standard, its sheet format, by its id as the standard spells it. */
  readonly format: readonly [id: string, format: StandardSheetFormat] | undefined;
  /**
   * The title block once `titleBlock()` has placed it: the index of the insert of its fields, the
   * tags of its attributes in order, those the builder fills with the scale when `draw` returns,
   * and the sheet's number under `sheet-per-file`.
   */
  titleBlock:
    | {
        readonly index: number | undefined;
        readonly tags: readonly string[];
        readonly scaleTags: readonly string[];
        readonly number: string | undefined;
      }
    | undefined;
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
    | "leaderStyle"
    | "tableStyle"
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
  /** The standard the drawing is drawn to, with its entries by name as the leading CAD app compares them. */
  readonly #standard: Drawn | undefined;
  /** Keyed by `layerKey`, because the leading CAD app ignores case in layer names. */
  readonly #layers = new Map<string, Layer>([["0", { name: "0", color: 7 }]]);
  /** The first layer name for each `layerAuditKey`, to find names AUDIT would call duplicates. */
  readonly #audited = new Map<string, string>([["0", "0"]]);
  /** Keyed by `layerKey`: the leading CAD app compares linetype names as it compares layer names. */
  readonly #linetypes = new Map<string, Linetype>();
  /** Seeded with the built-in linetypes, whose twins AUDIT reports as it reports any other. */
  readonly #linetypesAudited = new Map<string, string>(
    BUILT_IN_LINETYPES.map((name) => [layerAuditKey(name), name]),
  );
  /** Keyed by `layerKey`: the leading CAD app compares text style names as it compares layer names. */
  readonly #textStyles = new Map<string, TextStyle>();
  /** Keyed by `layerKey`, with the sizes a hatch's check reads: a hatch finds its pattern so. */
  readonly #patterns = new Map<string, readonly [HatchPattern, PatternSizes]>();
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
   * The first block or xref name for each `layerAuditKey`: the leading CAD app takes two such names
   * for one block.
   */
  readonly #blocksAudited = new Map<string, { readonly name: string; readonly xref: boolean }>();
  /** The block being drawn, which takes what is drawn until its `draw` returns. */
  #open: OpenBlock | undefined;
  /** Keyed by `layoutNameKey`, as the leading CAD app compares layout names. In the order of the tabs. */
  readonly #layouts = new Map<string, Layout | undefined>();
  /** The layout being drawn, which takes what is drawn until its `draw` returns. */
  #sheet: OpenLayout | undefined;
  /** Keyed by `layerKey`: the leading CAD app compares dimension style names as it compares layer names. */
  readonly #dimensionStyles = new Map<string, DimensionStyle>();
  readonly #dimensionStylesAudited = new Map<string, string>();
  /** The blocks of the arrowheads the dimension styles use, whose handles are taken. */
  readonly #arrowheadBlocks = new Set<string>();
  /** Keyed by `layerKey`: leader style names are compared as dimension style names are. */
  readonly #leaderStyles = new Map<string, LeaderStyle>();
  /** Whether each block a leader places holds a percent of its own, looked through once. */
  readonly #leaderPlaced = new Map<Block, boolean>();
  readonly #leaderStylesAudited = new Map<string, string>();
  readonly #tableStyles = new Map<string, TableStyle>();
  readonly #tableStylesAudited = new Map<string, string>();
  /** The blocks of the arrowheads the leader styles use, whose handles are taken. */
  readonly #leaderArrowheadBlocks = new Set<string>();
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
   * Adds hatch patterns, which a hatch names in its `pattern`: the text of a pattern file, which
   * `parsePatterns` reads, or definitions. tsdraft has no patterns of its own, so pass the firm's
   * file. A pattern of a name the drawing has replaces it and keeps the first spelling, as
   * `linetype()` does, and of two of one name in one call the first is added, as CAD programs read
   * a pattern file. Nothing is added when one is refused. A hatch is checked against its pattern
   * when it is drawn; one a later pattern of its name makes too dense is left to `lint`.
   *
   * ```ts
   * d.patterns(readFileSync("firm.pat", "utf8"));
   * d.hatch(slab, { pattern: { name: "AR-CONC", scale: 0.5 } });
   * ```
   */
  patterns(file: string | readonly HatchPattern[]): this {
    try {
      if (this.dxf === "R12") refuse("hatch-pattern", R12_ONLY.hatches);
      let given: unknown = file;
      if (typeof file === "string") {
        try {
          given = parsePatterns(file);
        } catch (thrown) {
          refuse("hatch-pattern", thrown instanceof Error ? thrown.message : String(thrown));
        }
      }
      if (!Array.isArray(given)) {
        refuse(
          "hatch-pattern",
          "patterns() takes a pattern file's text or a list of hatch patterns",
        );
      }
      const added = new Map<string, readonly [HatchPattern, PatternSizes]>();
      for (const definition of given as readonly unknown[]) {
        const problem = hatchPatternProblem(definition);
        const { name, description, lines } = (definition ?? {}) as HatchPattern;
        if (problem) refuse("hatch-pattern", `Hatch pattern ${shown(name)}: ${problem}`);
        const key = layerKey(name);
        if (added.has(key)) continue;
        const copy: HatchPattern = {
          name: this.#patterns.get(key)?.[0].name ?? name,
          ...(description === undefined ? {} : { description }),
          lines: lines.map(({ angle, base, offset, dashes }) => ({
            angle,
            base: [base[0], base[1]],
            offset: [offset[0], offset[1]],
            ...(dashes === undefined ? {} : { dashes: [...dashes] }),
          })),
        };
        added.set(key, [copy, patternSizes(copy.lines, new WeakMap())!]);
      }
      for (const [key, pattern] of added) this.#patterns.set(key, pattern);
    } catch (thrown) {
      throw located(thrown, DrawingBuilder.prototype.patterns, {});
    }
    return this;
  }

  /**
   * Defines a text style, or updates the one of the same name. `notes` and `NOTES` are the
   * same style, and keep the first spelling. `Standard` is in every drawing, with the font
   * `txt.shx`. A drawing drawn to a standard defines none: its texts' styles are its roles'.
   */
  textStyle<
    N extends string,
    F extends string,
    W extends number = number,
    O extends number = number,
  >(
    style: Z extends Standard
      ? TextStyleDefined
      : V extends "R12"
        ? R12Text
        : TextStyleDefinition<N, F, W, O>,
  ): this {
    const definition = style as unknown as TextStyleDefinition;
    const name: unknown = definition?.name;
    try {
      if (this.dxf === "R12") refuse("text-style", R12_ONLY.text);
      if (this.#standard) refuse("text-style-outside-standard", DRAWN.textStyleDefined);
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
    const C extends EntityColorGiven = EntityColor,
  >(from: Point, to: Point, options: EntityOptions<V, T, W, L, I, Z, P, C> = {}): this {
    return this.#add(DrawingBuilder.prototype.line, options, () => ({
      kind: "line",
      layer: this.#current,
      from: pt(from),
      to: pt(to),
    }));
  }

  /**
   * A polyline through `points`, and back to the first when `closed`. `bulges` makes a side an
   * arc, `width` or `widths` draws the sides wide, and `radius` rounds every corner with an arc,
   * as a bar's hook is bent: `d.polyline(hook, false, { radius: bend, width: bar })`.
   */
  polyline<
    T extends string = string,
    W extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
    P extends string = string,
    N extends number = number,
    R extends number = number,
    const C extends EntityColorGiven = EntityColor,
  >(
    points: readonly Point[],
    closed = false,
    options: PolylineOptions<V, T, W, L, I, Z, P, N, R, C> = {},
  ): this {
    return this.#add(DrawingBuilder.prototype.polyline, options, () => {
      if (points.length < 2) refuse("geometry", "A polyline needs at least 2 points");
      return this.#polyline(points.map(pt), closed, options);
    });
  }

  /**
   * A closed rectangle from its lower-left corner, `width` along X and `height` along Y. `radius`
   * rounds its corners.
   */
  rect<
    W extends number,
    H extends number,
    T extends string = string,
    LW extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
    P extends string = string,
    R extends number = number,
    const C extends EntityColorGiven = EntityColor,
  >(
    corner: Point,
    width: Positive<W>,
    height: Positive<H>,
    options: RectOptions<V, T, LW, L, I, Z, P, R, C> = {},
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
      const { radius } = options as { readonly radius?: unknown };
      return this.#polyline(corners.map(pt), true, radius === undefined ? {} : { radius });
    });
  }

  /**
   * A revision cloud along a closed outline: the corners of a rectangle, or an outline drawn
   * around what changed. It is one closed polyline of arcs from point to point along each side,
   * each bulging out of the outline, so the cloud crosses nothing inside it. `arc` is about how
   * far apart each arc's ends are, and `width` draws it wide. An arc that would reach across the
   * outline, in a notch narrower than it bulges, is refused. R2018 only.
   */
  cloud<
    A extends number,
    T extends string = string,
    W extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
    P extends string = string,
    N extends number = number,
    const C extends EntityColorGiven = EntityColor,
  >(
    outline: readonly Point[],
    options: V extends "R12" ? R12Polylines : CloudOptions<A, T, W, L, I, Z, P, N, C>,
  ): this {
    const o = options as unknown as CloudOptions;
    return this.#add(DrawingBuilder.prototype.cloud, o, () => {
      if (this.dxf === "R12") refuse("geometry", R12_ONLY.polylines);
      if (outline.length < 3) refuse("geometry", "A cloud's outline needs at least 3 points");
      const corners = outline.map(pt);
      const arc = positive(o.arc, "arc");
      const count = arcsAlong(corners, arc);
      if (count > MAX_CLOUD_ARCS) {
        refuse(
          "geometry",
          `arc: the cloud would have ${count} arcs, and has at most ${MAX_CLOUD_ARCS}. Give a longer arc`,
        );
      }
      const made = cloud(corners, arc);
      if (typeof made === "string") refuse("geometry", capitalized(made));
      return this.#polyline(made.points, true, {
        bulges: made.bulges,
        ...(o.width === undefined ? {} : { width: o.width }),
      });
    });
  }

  /**
   * A donut: a filled ring `outside` across about `center`, with a hole `inside` across, which
   * defaults to 0 for a filled dot, such as a bar cut in a section. It is one closed polyline of
   * two half circles, as wide as the ring. R2018 only.
   */
  donut<
    D extends number,
    H extends number = number,
    T extends string = string,
    W extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
    P extends string = string,
    const C extends EntityColorGiven = EntityColor,
  >(
    center: Point,
    outside: V extends "R12" ? R12Polylines : Positive<D>,
    options?: V extends "R12" ? R12Polylines : DonutOptions<H, T, W, L, I, Z, P, C>,
  ): this {
    const o = (options ?? {}) as unknown as DonutOptions;
    return this.#add(DrawingBuilder.prototype.donut, o, () => {
      if (this.dxf === "R12") refuse("geometry", R12_ONLY.polylines);
      const [x, y] = pt(center);
      const across = positive(outside, "outside");
      const inside: unknown = o.inside ?? 0;
      const problem = donutHoleProblem(inside);
      if (problem) refuse("geometry", `inside: ${problem}`);
      if (!((inside as number) < across)) {
        refuse("geometry", "inside: A donut's hole must be less across than the donut");
      }
      const made = donut([x, y], across, inside as number);
      // Its middle, between its two points, and its ring are written within 1% of what they are.
      const middle = (across + (inside as number)) / 2;
      const chord = written(made.points[1]![0]) - written(made.points[0]![0]);
      const off = (wrote: number, is: number): boolean => !(Math.abs(wrote - is) <= is / 100);
      if (off(chord, middle) || off(written(made.width), made.width)) {
        refuse(
          "geometry",
          "outside: The donut is too small for the 6 decimals tsdraft writes: its ring or its middle would be written more than 1% off. Give a larger donut, or a hole further from its size",
        );
      }
      return this.#polyline(made.points.map(pt), true, {
        bulges: made.bulges,
        width: made.width,
      });
    });
  }

  /**
   * A hatch, filled solid in the current layer's color: one outline's points, or a list of loops.
   * The area inside an odd number of loops is filled, so a loop inside another is a hole and one
   * inside a hole fills again, whichever way each runs. A loop's `bulges` make its sides arcs, as
   * a polyline's do. R2018 only.
   *
   * With `pattern`, it draws a pattern's lines in its pen instead: a pattern `patterns()` added,
   * by its name, or lines of its own `spacing` apart, crossed by as many square to them when
   * `crossed`. A pattern that would draw more than 1,000,000 lines across the loops is refused.
   *
   * ```ts
   * d.hatch([
   *   { points: [[0, 0], [8, 0], [8, 0.5], [0, 0.5]] },
   *   { points: [[3, 0], [3.5, 0], [3.5, 0.5]] },
   * ]);
   * d.patterns(readFileSync("firm.pat", "utf8"));
   * d.hatch([[0, 1], [8, 1], [8, 3], [0, 3]], {
   *   pattern: { name: "AR-CONC", scale: 0.25, angle: 45, origin: [0, 1] },
   * });
   * d.hatch([[10, 1], [12, 1], [12, 3], [10, 3]], { pattern: { spacing: 0.125, crossed: true } });
   * ```
   *
   * With `gradient`, it is filled from one color to another: two colors, or one color and its
   * tint, `linear` across the loops or in one of the other kinds, turned by `angle`.
   *
   * ```ts
   * d.hatch([[0, 4], [8, 4], [8, 6], [0, 6]], {
   *   gradient: { name: "linear", angle: 90, colors: [[30, 120, 200], [255, 255, 255]] },
   * });
   * ```
   */
  hatch<
    T extends string = string,
    W extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
    P extends string = string,
    S extends number = number,
    const G extends HatchGradient = HatchGradient,
    const C extends EntityColorGiven = EntityColor,
  >(
    boundary: readonly Point[] | readonly HatchLoop[],
    options: HatchOptions<V, T, W, L, I, Z, P, S, G, C> = {},
  ): this {
    return this.#add(DrawingBuilder.prototype.hatch, options, () => {
      if (this.dxf === "R12") refuse("hatch", R12_ONLY.hatches);
      if (!Array.isArray(boundary))
        refuse("geometry", "A hatch's boundary is a list of points or of loops");
      const first: unknown = boundary[0];
      const outline = Array.isArray(first) || first === undefined;
      const given = (outline ? [{ points: boundary }] : boundary) as readonly HatchLoop[];
      if (given.length === 0 || (outline && boundary.length === 0))
        refuse("geometry", capitalized(HATCH_NO_LOOPS));
      const loops = given.map((loop, k): HatchLoop => {
        if (typeof loop !== "object" || loop === null || !Array.isArray(loop.points))
          return refuse("geometry", `Loop ${k} must be { points, bulges? }`);
        const points = loop.points.map(pt);
        const bulges = loop.bulges;
        const problem =
          polylineSidesProblems(points.length, bulges, undefined, undefined)[0] ??
          (points.length < 2 ||
          (points.length === 2 && !(bulges ?? []).some((b) => written(b) !== 0))
            ? HATCH_LOOP_POINTS
            : undefined);
        if (problem) refuse("geometry", `Loop ${k}: ${problem}`);
        return { points, ...(bulges === undefined ? {} : { bulges: [...bulges] }) };
      });
      const choice: unknown = options.pattern;
      const shade: unknown = options.gradient;
      if (choice !== undefined && shade !== undefined)
        refuse("hatch-gradient", capitalized(GRADIENT_WITH_PATTERN));
      return {
        kind: "hatch",
        layer: this.#current,
        loops,
        ...(choice === undefined ? {} : { pattern: this.#hatchPattern(choice, loops) }),
        ...(shade === undefined ? {} : { gradient: hatchGradientCopy(shade) }),
      };
    });
  }

  /**
   * Checks a hatch's pattern as `lint` does, with the name in the drawing's spelling, and returns
   * a copy of it.
   */
  #hatchPattern(choice: unknown, loops: readonly HatchLoop[]): HatchPatternChoice {
    const problem = hatchPatternChoiceProblem(choice);
    if (problem) refuse("hatch-pattern", capitalized(problem));
    const c = choice as Record<string, unknown>;
    const angle = c.angle === undefined ? {} : { angle: c.angle as number };
    const at = c.origin as Point | undefined;
    const origin = at === undefined ? {} : { origin: [at[0], at[1]] as Point };
    let found: readonly [HatchPattern, PatternSizes] | undefined;
    let copy: HatchPatternChoice;
    if (typeof c.name === "string") {
      found = this.#patterns.get(layerKey(c.name));
      if (found === undefined) refuse("hatch-pattern", undefinedHatchPatternProblem(c.name, true));
      const scale = c.scale === undefined ? {} : { scale: c.scale as number };
      copy = { name: found![0].name, ...scale, ...angle, ...origin };
    } else {
      const crossed = c.crossed === undefined ? {} : { crossed: c.crossed as boolean };
      copy = { spacing: c.spacing as number, ...angle, ...crossed, ...origin };
    }
    const box = loopsBox(loops);
    const spread = hatchSpread(
      { pattern: copy },
      () => found?.[0],
      () => found?.[1],
    );
    const drawn = box && spread ? patternDrawnProblem(box, spread) : undefined;
    if (drawn) refuse("hatch-pattern", capitalized(drawn));
    return copy;
  }

  /**
   * A wipeout: a polygon filled with the paper's color, which hides what is drawn before it, such
   * as the lines behind a note. Its frame shows as `Drawing.wipeoutFrame` says. R2018 only.
   *
   * ```ts
   * d.wipeout([[2, 2], [5, 2], [5, 3], [2, 3]]);
   * ```
   */
  wipeout<
    T extends string = string,
    W extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
    P extends string = string,
    const C extends EntityColorGiven = EntityColor,
  >(points: readonly Point[], options: EntityOptions<V, T, W, L, I, Z, P, C> = {}): this {
    return this.#add(DrawingBuilder.prototype.wipeout, options, () => {
      if (this.dxf === "R12") refuse("wipeout", R12_ONLY.hatches);
      if (!Array.isArray(points) || points.length < 3)
        refuse("geometry", capitalized(WIPEOUT_POINTS));
      const corners = points.map(pt);
      if (onOneLine(corners)) refuse("geometry", capitalized(WIPEOUT_FLAT));
      if (corners.length <= 4096 && polygonCrosses(corners))
        refuse("wipeout", capitalized(WIPEOUT_CROSSES));
      return { kind: "wipeout", layer: this.#current, points: corners };
    });
  }

  /**
   * A raster image: the PNG or JPEG file at `path`, from the folder of this drawing's file, with
   * its lower-left corner at `at`, `width` drawing units wide. `pixels` are the file's own, which
   * `rasterSize` reads, and its height defaults to the width times the file's height over its
   * width. `clip` hides what lies outside two corners of a rectangle along its sides or a
   * polygon, in the drawing's coordinates. R2018 only.
   *
   * ```ts
   * d.image("aerial.png", [0, 0], { pixels: [4000, 3000], width: 400 });
   * ```
   */
  image<
    const F extends string,
    IW extends number,
    IH extends number = number,
    T extends string = string,
    W extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
    P extends string = string,
    const C extends EntityColorGiven = EntityColor,
  >(
    path: V extends "R12" ? R12Images : ImagePath<F>,
    at: Point,
    options: V extends "R12" ? R12Images : ImageOptions<IW, IH, T, W, L, I, Z, P, C>,
  ): this {
    const o = options as unknown as ImageOptions;
    return this.#add(DrawingBuilder.prototype.image, o, () => {
      if (this.dxf === "R12") refuse("image", R12_ONLY.images);
      const pathProblem = imagePathProblem(path);
      if (pathProblem) refuse("image", pathProblem);
      const pixelsProblem = imagePixelsProblem(o.pixels);
      if (pixelsProblem) refuse("image", `pixels: ${pixelsProblem}`);
      const [w, h] = o.pixels;
      const width = positive(o.width, "width");
      const height = o.height === undefined ? width * (h / w) : positive(o.height, "height");
      if (o.height === undefined && sizeProblem(height)) {
        refuse("geometry", `height: ${sizeProblem(height)}`);
      }
      const rotation =
        o.rotation === undefined ? undefined : kept(num(o.rotation, "rotation"), "rotation");
      const image: Image = {
        kind: "image",
        layer: this.#current,
        path: path as string,
        pixels: [w, h],
        at: pt(at),
        width,
        height,
        ...(rotation === undefined ? {} : { rotation }),
      };
      if (o.clip !== undefined) {
        const [u, v] = imageVectors(image);
        const clipProblem = imageClipProblem(o.clip, image.at, u, v);
        if (clipProblem) refuse("image", `clip: ${clipProblem}`);
      } else if (o.invertClip === true) refuse("image", IMAGE_INVERT_WITHOUT_CLIP);
      for (const [field, value] of [
        ["invertClip", o.invertClip],
        ["transparent", o.transparent],
      ] as const) {
        if (value !== undefined && typeof value !== "boolean") {
          refuse("image", `${field} must be true or false`);
        }
      }
      return {
        ...image,
        ...(o.clip === undefined ? {} : { clip: o.clip.map(pt) }),
        ...(o.invertClip === true ? { invertClip: true } : {}),
        ...(o.transparent === true ? { transparent: true } : {}),
      };
    });
  }

  /**
   * A polyline of the current layer through `points`, with what `given` says of its sides, once
   * the sides are checked. A radius rounds the corners first.
   */
  #polyline(
    points: readonly Point[],
    closed: boolean,
    given: {
      readonly bulges?: unknown;
      readonly width?: unknown;
      readonly widths?: unknown;
      readonly radius?: unknown;
      readonly linetypeGeneration?: unknown;
    },
  ): Polyline {
    const { width, widths, radius, linetypeGeneration } = given;
    if (linetypeGeneration !== undefined) {
      if (this.dxf === "R12") refuse("geometry", R12_ONLY.polylines);
      if (typeof linetypeGeneration !== "boolean")
        refuse("geometry", "linetypeGeneration must be true or false");
    }
    let { bulges } = given;
    if (
      this.dxf === "R12" &&
      (bulges !== undefined || width !== undefined || widths !== undefined || radius !== undefined)
    ) {
      refuse("geometry", R12_ONLY.polylines);
    }
    let shape = points;
    if (radius !== undefined) {
      if (bulges !== undefined || widths !== undefined) {
        refuse(
          "geometry",
          "radius: A polyline whose corners a radius rounds takes no bulges or widths of its own, since its sides are made anew. Give it width alone",
        );
      }
      const made = rounded(points, closed, positive(radius, "radius"));
      if (typeof made === "string") refuse("geometry", `radius: ${capitalized(made)}`);
      shape = made.points.map(pt);
      if (made.bulges.some((bulge) => bulge !== 0)) bulges = made.bulges;
    }
    const sides = closed ? shape.length : shape.length - 1;
    const [problem] = polylineSidesProblems(sides, bulges, width, widths);
    if (problem) refuse("geometry", capitalized(problem));
    return {
      kind: "polyline",
      layer: this.#current,
      points: shape,
      closed,
      ...(bulges === undefined ? {} : { bulges: [...(bulges as readonly number[])] }),
      ...(width === undefined ? {} : { width: width as number }),
      ...(widths === undefined
        ? {}
        : {
            widths: (widths as readonly (readonly [number, number])[]).map(
              ([start, end]) => [start, end] as const,
            ),
          }),
      ...(linetypeGeneration === true ? { linetypeGeneration } : {}),
    };
  }

  circle<
    R extends number,
    T extends string = string,
    W extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
    P extends string = string,
    const C extends EntityColorGiven = EntityColor,
  >(center: Point, radius: Positive<R>, options: EntityOptions<V, T, W, L, I, Z, P, C> = {}): this {
    return this.#add(DrawingBuilder.prototype.circle, options, () => ({
      kind: "circle",
      layer: this.#current,
      center: pt(center),
      radius: positive(radius, "radius"),
    }));
  }

  /**
   * Arc from `startAngle` counterclockwise to `endAngle`. Angles are stored
   * from 0 up to 360, so -90 becomes 270, because the leading CAD app's AUDIT rejects
   * angles outside that range.
   *
   * Angles are written with 6 decimals. An arc within 0.000001 degrees of a
   * full turn would be written with equal angles, which that app holds as an
   * arc of no length, so it throws: draw a circle instead.
   */
  arc<
    R extends number,
    T extends string = string,
    W extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
    P extends string = string,
    const C extends EntityColorGiven = EntityColor,
  >(
    center: Point,
    radius: Positive<R>,
    startAngle: number,
    endAngle: number,
    options: EntityOptions<V, T, W, L, I, Z, P, C> = {},
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

  /**
   * An ellipse about `center`, with `majorAxis` from the center to one end of its major axis and
   * `ratio` its minor radius over its major, above 0 and at most 1. With `startParameter` and
   * `endParameter`, an arc of it, counterclockwise from one to the other. A parameter is not the
   * angle a point is at, except at multiples of 90 degrees: see `Ellipse`. R2018 only.
   *
   * ```ts
   * d.ellipse([10, 5], [4, 0], 0.5);
   * d.ellipse([10, 5], [0, 3], 0.6, { startParameter: 0, endParameter: 180 });
   * ```
   */
  ellipse<
    R extends number,
    T extends string = string,
    W extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
    P extends string = string,
    const O extends EntityColorGiven = EntityColor,
  >(
    center: Point,
    majorAxis: Point,
    ratio: EllipseRatio<R>,
    options: EllipseOptions<V, T, W, L, I, Z, P, O> = {},
  ): this {
    return this.#add(DrawingBuilder.prototype.ellipse, options, () => {
      if (this.dxf === "R12") refuse("geometry", R12_ONLY.curves);
      const axis = pt(majorAxis);
      const { startParameter, endParameter } = options;
      const arc = startParameter !== undefined && endParameter !== undefined;
      const start = arc ? turn(num(startParameter, "startParameter")) : startParameter;
      const end = arc ? turn(num(endParameter, "endParameter")) : endParameter;
      const [problem] = ellipseProblems(axis, ratio, start, end);
      if (problem) refuse("geometry", capitalized(problem));
      return {
        kind: "ellipse",
        layer: this.#current,
        center: pt(center),
        majorAxis: axis,
        ratio: ratio as number,
        ...(arc ? { startParameter: start!, endParameter: end! } : {}),
      };
    });
  }

  /**
   * A spline through `fitPoints`: the cubic the leading CAD app's `SPLINE` fits through them, its
   * knots spaced by the chords, with the tangents given at its ends or worked out from the points. `closed` runs it from the last
   * point back to the first, smooth through it. R2018 only.
   *
   * ```ts
   * d.spline([[0, 0], [10, 4], [20, 2], [30, 6]]);
   * d.spline([[0, 0], [10, 4], [20, 2]], { startTangent: [0, 1] });
   * ```
   */
  spline<
    const F extends readonly Point[],
    T extends string = string,
    W extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
    P extends string = string,
    const S extends Point = Point,
    const E extends Point = Point,
    C extends boolean = false,
    const O extends EntityColorGiven = EntityColor,
  >(fitPoints: FitPoints<F>, options: SplineOptions<V, T, W, L, I, Z, P, S, E, C, O> = {}): this {
    return this.#add(DrawingBuilder.prototype.spline, options, () => {
      if (this.dxf === "R12") refuse("geometry", R12_ONLY.curves);
      if (!Array.isArray(fitPoints))
        refuse("geometry", "A spline's fit points are a list of points");
      const o = options as unknown as SplineOptions;
      const points = (fitPoints as readonly Point[]).map(pt);
      const startTangent = o.startTangent === undefined ? undefined : pt(o.startTangent as Point);
      const endTangent = o.endTangent === undefined ? undefined : pt(o.endTangent as Point);
      const closed = o.closed === true;
      const [problem] = fitSplineProblems({
        fitPoints: points,
        startTangent,
        endTangent,
        closed,
      });
      if (problem) refuse("geometry", capitalized(problem));
      return {
        kind: "spline",
        layer: this.#current,
        fitPoints: points,
        ...(startTangent ? { startTangent } : {}),
        ...(endTangent ? { endTangent } : {}),
        ...(closed ? { closed } : {}),
      };
    });
  }

  /**
   * A spline by its control points: a B-spline of `degree`, 3 unless given, with clamped uniform
   * knots unless `knots` are given, rational with `weights`. `closed` makes it periodic: without
   * `knots`, its first `degree` control points are added again at the end, with uniform knots, so
   * it closes smooth on them. R2018 only.
   *
   * ```ts
   * d.controlSpline([[0, 0], [5, 8], [10, 0], [15, 8]]);
   * d.controlSpline([[0, 0], [0, 5], [5, 5]], { degree: 2, weights: [1, Math.SQRT1_2, 1] });
   * ```
   */
  controlSpline<
    const C extends readonly Point[],
    T extends string = string,
    W extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
    P extends string = string,
    D extends number = 3,
    const K extends readonly number[] = readonly number[],
    const H extends readonly number[] = readonly number[],
    const O extends EntityColorGiven = EntityColor,
  >(
    controlPoints: ControlPoints<C, D>,
    options: ControlSplineOptions<V, T, W, L, I, Z, P, D, K, C, H, O> = {},
  ): this {
    return this.#add(DrawingBuilder.prototype.controlSpline, options, () => {
      if (this.dxf === "R12") refuse("geometry", R12_ONLY.curves);
      if (!Array.isArray(controlPoints))
        refuse("geometry", "A spline's control points are a list of points");
      const o = options as unknown as ControlSplineOptions;
      const degree: unknown = o.degree ?? 3;
      const given = (controlPoints as readonly Point[]).map(pt);
      const closed = o.closed === true;
      const p = typeof degree === "number" ? degree : 0;
      if (Number.isInteger(p) && p >= 1 && given.length < p + 1)
        refuse(
          "geometry",
          capitalized(controlSplineProblems({ controlPoints: given, degree, knots: [] })[0]!),
        );
      const wrapped = closed && o.knots === undefined;
      const points = wrapped ? [...given, ...given.slice(0, p)] : given;
      const knots: readonly number[] =
        (o.knots as readonly number[] | undefined) ??
        (wrapped
          ? Array.from({ length: points.length + p + 1 }, (_, i) => i)
          : Array.from({ length: points.length + p + 1 }, (_, i) =>
              Math.min(Math.max(i - p, 0), points.length - p),
            ));
      const givenWeights = o.weights as readonly number[] | undefined;
      const weights =
        givenWeights === undefined
          ? undefined
          : wrapped
            ? [...givenWeights, ...givenWeights.slice(0, p)]
            : givenWeights;
      const [problem] = controlSplineProblems({
        controlPoints: points,
        degree,
        knots,
        weights,
        closed,
      });
      if (problem) refuse("geometry", capitalized(problem));
      return {
        kind: "spline",
        layer: this.#current,
        controlPoints: points,
        degree: degree as number,
        knots: [...knots],
        ...(weights === undefined ? {} : { weights: [...weights] }),
        ...(closed ? { closed } : {}),
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
    const C extends EntityColorGiven = EntityColor,
  >(at: Point, value: string, options: TextOptions<H, V, T, W, L, I, S, D, Z, P, R, C> = {}): this {
    return this.#add(DrawingBuilder.prototype.text, options, () => ({
      kind: "text",
      layer: this.#current,
      ...this.#textFields(at, value, options as unknown as TextOptions),
    }));
  }

  /**
   * Paragraph text: one entity whose lines wrap at `width` and break at each line feed, held as
   * the leading CAD app's multi-line text. Its box is placed by `at`, which `align` and `valign`
   * name a point of, its upper left corner by default. The value may hold that app's inline
   * codes, which `underline`, `bold`, `stack`, `superscript`, `subscript` and `plain` write, and
   * a line feed in it is written as `\P`. R2018 only.
   *
   * ```ts
   * d.paragraph(`GENERAL NOTES\n1. ALL WORK SHALL COMPLY WITH ${underline("THE CODES")}.`, {
   *   at: [1, 10],
   *   width: 4,
   *   height: 0.1,
   * });
   * ```
   */
  paragraph<
    Q extends string,
    H extends number = number,
    T extends string = string,
    W extends number = number,
    const L extends LinetypeValue = LinetypeDefinition,
    I extends string = string,
    S extends string = string,
    const D extends TextStyleValue = TextStyleDefinition,
    P extends string = string,
    R extends string = string,
    N extends number = number,
    F extends number = number,
    const C extends EntityColorGiven = EntityColor,
  >(
    value: ParagraphValue<Q>,
    options: V extends "R12"
      ? R12Paragraphs
      : ParagraphOptions<H, T, W, L, I, S, D, Z, P, R, N, F, C>,
  ): this {
    const o = options as unknown as ParagraphOptions;
    return this.#add(DrawingBuilder.prototype.paragraph, o, () => {
      if (this.dxf === "R12") refuse("paragraph", R12_ONLY.paragraphs);
      return this.#paragraph(value, o);
    });
  }

  /** Checks a paragraph and returns it on the current layer. */
  #paragraph(given: unknown, o: ParagraphOptions): Paragraph {
    if (typeof given !== "string")
      return refuse("paragraph", "A paragraph's value must be a string");
    // A backslash would escape the `\` of the `\P` a line feed becomes, as the type refuses it.
    let backslashes = 0;
    for (let i = 0; i < given.length; i++) {
      const code = given.charCodeAt(i);
      if (code === 92) backslashes++;
      else {
        if (code === 10 && backslashes % 2 === 1) {
          return refuse("paragraph", paragraphUnknownCode("\n"));
        }
        backslashes = 0;
      }
    }
    const value = given.replaceAll("\n", "\\P");
    const parsed = parseParagraph(value);
    if (parsed.problem) refuse("paragraph", parsed.problem);
    const at: unknown = o?.at;
    if (!Array.isArray(at) || at.length !== 2) {
      return refuse("geometry", "at must be a point, [x, y], of the paragraph's box");
    }
    const role = this.#role(o as unknown as TextOptions);
    const paragraph: { -readonly [K in keyof Paragraph]?: Paragraph[K] } & Pick<
      Paragraph,
      "kind" | "layer" | "at" | "value" | "height" | "rotation"
    > = {
      kind: "paragraph",
      layer: this.#current,
      at: pt(at as unknown as Point),
      value,
      height: positive(role ? role.height : (o.height ?? 0.125), "height"),
      rotation: kept(o.rotation ?? 0, "rotation"),
    };
    if (o.width !== undefined) paragraph.width = positive(o.width, "width");
    if (role) paragraph.style = role.style;
    else if (o.style !== undefined) {
      const style = this.#textStyleName(o.style);
      if (style !== STANDARD_TEXT_STYLE) paragraph.style = style;
    }
    // A value is checked in its style's font, which decides what `%%c` draws.
    const font =
      paragraph.style === undefined
        ? STANDARD_FONT
        : (this.#textStyles.get(layerKey(paragraph.style))?.font ?? STANDARD_FONT);
    const problem = paragraphProblemIn(parsed, font);
    if (problem) refuse("paragraph", problem);
    const { align, valign, lineSpacing, lineSpacingStyle } = o as unknown as Record<
      string,
      unknown
    >;
    for (const [field, chosen, plain] of [
      ["align", align, "left"],
      ["valign", valign, "top"],
      ["lineSpacingStyle", lineSpacingStyle, "at-least"],
    ] as const) {
      if (chosen === undefined) continue;
      const choiceProblem = paragraphChoiceProblem(field, chosen);
      if (choiceProblem)
        refuse(field === "lineSpacingStyle" ? "paragraph" : "text-align", choiceProblem);
      if (chosen !== plain) (paragraph as Record<string, unknown>)[field] = chosen;
    }
    if (lineSpacing !== undefined) {
      const spacingProblem = lineSpacingProblem(lineSpacing);
      if (spacingProblem) refuse("paragraph", spacingProblem);
      if (lineSpacing !== 1) paragraph.lineSpacing = lineSpacing as number;
    }
    const columns: unknown = (o as { columns?: unknown }).columns;
    if (columns !== undefined) {
      const columnsProblem = paragraphColumnsProblem(columns, paragraph.width, paragraph.height);
      if (columnsProblem) refuse("paragraph", columnsProblem);
      const c = columns as ParagraphColumns;
      const heights = c.heights;
      paragraph.columns = {
        ...(heights
          ? { heights: Array.from({ length: heights.length }, (_, i) => heights[i]!) }
          : { height: c.height! }),
        ...(c.count !== undefined && { count: c.count }),
        ...(c.gutter !== undefined && { gutter: c.gutter }),
      } as ParagraphColumns;
    }
    const mask: unknown = (o as { mask?: unknown }).mask;
    if (mask !== undefined) {
      const maskProblem = textMaskProblem(mask);
      if (maskProblem) refuse("paragraph", maskProblem);
      if (mask !== false && paragraph.columns !== undefined)
        refuse("paragraph", capitalized(PARAGRAPH_MASK_COLUMNS));
      if (mask !== false) paragraph.mask = mask === true ? true : { ...(mask as object) };
    }
    return paragraph as Paragraph;
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
   * xref has. `insert(name, at)` then places it, as it places a block, and the leading CAD app
   * loads the file and draws it there each time it opens this drawing. `path` leads from the folder
   * of this drawing's file to the DWG file, such as `"base.dwg"` or `"../survey/base.dwg"`.
   * The xref is an overlay unless `attach` is true: a drawing that references this one draws an
   * attachment too, and never an overlay.
   */
  xref<N extends string, P extends string>(
    name: V extends "R12" ? R12Xrefs : BlockName<N>,
    path: V extends "R12" ? R12Xrefs : XrefPath<P>,
    options: { readonly attach?: boolean } = {},
  ): this {
    // The parameter type is the error message when a literal is wrong, so read it as a string.
    const requested = name as string;
    try {
      this.#defineXref(requested, path, false, options?.attach);
    } catch (thrown) {
      throw located(thrown, DrawingBuilder.prototype.xref, { xref: requested });
    }
    return this;
  }

  /**
   * Checks an xref and stores it. With `shared`, an xref the drawing has of the same name and
   * path is the one it keeps, as a title block's border on each layout is.
   */
  #defineXref(requested: string, path: unknown, shared = false, attach?: unknown): void {
    const fail = (rule: LintRule, problem: string): never =>
      refuse(rule, `Xref ${JSON.stringify(requested)}: ${problem}`);
    if (this.dxf === "R12") fail("xref", R12_ONLY.xrefs);
    const nameProblem = blockNameProblem(requested);
    if (nameProblem) fail("xref", nameProblem);
    if (attach !== undefined && typeof attach !== "boolean") {
      fail("xref", "attach must be true or false");
    }
    if (shared && this.#xrefs.get(layerKey(requested))?.path === path) return;
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
    // An xref belongs to the drawing, also when it is referenced while a block or a layout is drawn.
    for (const handle of [handles.record, handles.begin, handles.end]) {
      this.#claim(handle, what, undefined, []);
    }
    this.#xrefs.set(layerKey(requested), {
      name: requested,
      path: path as string,
      ...(attach === true ? { attach: true } : {}),
    });
    this.#blocksAudited.set(layerAuditKey(requested), { name: requested, xref: true });
  }

  /**
   * Adds an attribute definition to the block being drawn: a text that each insert of the
   * block carries with a value of its own, under `tag`. It is placed and justified as `text()`
   * places a text, or with `kind: "paragraph"` as `paragraph()` places a paragraph, whose value
   * and each insert's hold a paragraph's codes, and goes on the current layer.
   */
  attribute<
    T extends string,
    H extends number = number,
    S extends string = string,
    const D extends TextStyleValue = TextStyleDefinition,
    R extends string = string,
    Q extends string = string,
    N extends number = number,
    F extends number = number,
  >(
    tag: V extends "R12" ? R12Blocks : AttributeTag<T>,
    at: Point,
    options: AttributeOptions<H, S, D, Z, R, Q, N, F> = {},
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
      const kind: unknown = options.kind;
      if (kind !== undefined && kind !== "text" && kind !== "paragraph") {
        refuse("attribute", ATTRIBUTE_KIND);
      }
      if (kind !== "paragraph") {
        const given = options as unknown as Readonly<Record<string, unknown>>;
        for (const field of PARAGRAPH_ONLY) {
          if (given[field] !== undefined) refuse("attribute", paragraphOnlyProblem(field));
        }
      }
      const fields =
        kind === "paragraph"
          ? this.#paragraphFields(
              at,
              options as unknown as ParagraphAttributeFields<string, number, number> & TextOptions,
            )
          : this.#textFields(at, options.value ?? "", options as unknown as TextOptions);
      this.#claim(
        definitionHandle(open.name, named),
        `the attribute ${JSON.stringify(named)} of the block ${JSON.stringify(open.name)}`,
      );
      open.attributes.push({
        tag: named,
        ...(prompt === undefined ? {} : { prompt: prompt as string }),
        layer: this.#current,
        ...fields,
      } as AttributeDefinition);
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
    const C extends EntityColorGiven = EntityColor,
  >(
    block: V extends "R12" ? R12Blocks : BlockName<N>,
    at: Point,
    options: InsertOptions<S, I, Z, C> = {},
  ): this {
    return this.#add(DrawingBuilder.prototype.insert, options, () =>
      this.#placed(block, at, options),
    );
  }

  /** Checks an insert of a block or an xref, and returns it on the current layer. */
  #placed(
    block: unknown,
    at: Point,
    options: {
      readonly scale?: unknown;
      readonly view?: unknown;
      readonly rotation?: number;
      readonly attributes?: unknown;
      readonly id?: unknown;
    },
  ): Insert {
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
        const definition = definitions.find((d) => d.tag === tag);
        if (!definition) refuse("undefined-attribute", undefinedAttributeProblem(tag, placed.name));
        if (definition!.kind === "paragraph") {
          const about = `attribute ${JSON.stringify(tag)}: `;
          values[tag] = this.#paragraphValue(value, definition!.style, "paragraph", about);
          continue;
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
    U extends (typeof DIMENSION_UNITS)[number] = "decimal",
  >(
    style: Z extends Standard
      ? DimensionStyleDefined
      : V extends "R12"
        ? R12Dimensions
        : DimensionStyleDefinition<N, S, H, A, AS, EO, EB, G, SC, P, PRE, SUF, MS, U>,
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
    const { prefix, suffix, suppressZeros, feetInchZeros } = definition;
    const { fraction, fractionScale, textPlacement, textFit } = definition;
    const { dimensionLineweight, extensionLineweight, radialText, jogAngle, textMask } = definition;
    const { angleUnits, anglePrecision, suppressAngleZeros, arcSymbol } = definition;
    const units = definition.units ?? "decimal";
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
      ...(units === "decimal" ? {} : { units }),
      precision: definition.precision,
      ...(prefix === undefined || prefix === "" ? {} : { prefix }),
      ...(suffix === undefined || suffix === "" ? {} : { suffix }),
      ...(suppressZeros === undefined ? {} : { suppressZeros }),
      ...(feetInchZeros === undefined ? {} : { feetInchZeros }),
      ...(measurementScale === 1 ? {} : { measurementScale }),
      ...(fraction === undefined || fraction === "inline" ? {} : { fraction }),
      ...(fractionScale === undefined || fractionScale === 1 ? {} : { fractionScale }),
      ...(textPlacement === undefined || textPlacement === "above" ? {} : { textPlacement }),
      ...(textFit === undefined || textFit === "inside" ? {} : { textFit }),
      ...(dimensionLineweight === undefined ? {} : { dimensionLineweight }),
      ...(extensionLineweight === undefined ? {} : { extensionLineweight }),
      ...(radialText === undefined || radialText === "aligned" ? {} : { radialText }),
      ...(jogAngle === undefined || written(jogAngle) === JOG_ANGLE.default ? {} : { jogAngle }),
      ...(angleUnits === undefined || angleUnits === "degrees" ? {} : { angleUnits }),
      ...(anglePrecision === undefined || anglePrecision === 0 ? {} : { anglePrecision }),
      ...(suppressAngleZeros === undefined ? {} : { suppressAngleZeros }),
      ...(textMask === undefined || textMask === false
        ? {}
        : { textMask: textMask === true ? true : { color: textMask.color } }),
      ...(arcSymbol === undefined || arcSymbol === "before" ? {} : { arcSymbol }),
    });
    this.#dimensionStylesAudited.set(layerAuditKey(named), named);
  }

  /**
   * Draws a linear dimension on the current layer: the distance from `from` to `to` along X,
   * or along `options.along`, with its dimension line through `line`. The leading CAD app holds it
   * as a dimension, which reads its length again when its points move.
   */
  linearDimension<
    S extends string,
    T extends string = string,
    I extends string = string,
    const C extends EntityColorGiven = EntityColor,
  >(
    from: Point,
    to: Point,
    line: Point,
    options: Z extends Standard
      ? StandardLinearDimensionOptions<S, T, I, Z, C>
      : V extends "R12"
        ? R12Dimensions
        : LinearDimensionOptions<S, T, I, C>,
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
  alignedDimension<
    S extends string,
    T extends string = string,
    I extends string = string,
    const C extends EntityColorGiven = EntityColor,
  >(
    from: Point,
    to: Point,
    offset: number,
    options: Z extends Standard
      ? StandardAlignedDimensionOptions<S, T, I, Z, C>
      : V extends "R12"
        ? R12Dimensions
        : AlignedDimensionOptions<S, T, I, C>,
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

  /**
   * Draws a radius dimension on the current layer: the distance from `center` to `point`, a point
   * of the circle or arc it measures, read with an R. Its line runs from the center through
   * `point`, and its text stands outside the circle unless `options.textFromCenter` places it.
   */
  radiusDimension<
    S extends string,
    T extends string = string,
    I extends string = string,
    const C extends EntityColorGiven = EntityColor,
  >(
    center: Point,
    point: Point,
    options: Z extends Standard
      ? StandardRadiusDimensionOptions<S, T, I, Z, C>
      : V extends "R12"
        ? R12Dimensions
        : RadiusDimensionOptions<S, T, I, C>,
  ): this {
    return this.#add(DrawingBuilder.prototype.radiusDimension, idOf(options), () =>
      this.#radial("radius-dimension", center, point, options),
    );
  }

  /**
   * Draws a diameter dimension on the current layer: twice the distance from `center` to `point`,
   * read with a diameter sign. Its line runs through the center from `point` to the point
   * opposite, and its text stands at `point`'s end, outside the circle unless
   * `options.textFromCenter` places it.
   */
  diameterDimension<
    S extends string,
    T extends string = string,
    I extends string = string,
    const C extends EntityColorGiven = EntityColor,
  >(
    center: Point,
    point: Point,
    options: Z extends Standard
      ? StandardRadiusDimensionOptions<S, T, I, Z, C>
      : V extends "R12"
        ? R12Dimensions
        : DiameterDimensionOptions<S, T, I, C>,
  ): this {
    return this.#add(DrawingBuilder.prototype.diameterDimension, idOf(options), () =>
      this.#radial("diameter-dimension", center, point, options),
    );
  }

  /**
   * Draws a jogged radius dimension on the current layer: the distance from `center` to `point`,
   * for an arc whose center is far off. Its line starts at `start`, jogs across at `jog`, and runs
   * on toward the center to `point`, with its text along the last stretch.
   */
  joggedRadiusDimension<
    S extends string,
    T extends string = string,
    I extends string = string,
    const C extends EntityColorGiven = EntityColor,
  >(
    center: Point,
    point: Point,
    start: Point,
    jog: Point,
    options: Z extends Standard
      ? StandardAlignedDimensionOptions<S, T, I, Z, C>
      : V extends "R12"
        ? R12Dimensions
        : JoggedRadiusDimensionOptions<S, T, I, C>,
  ): this {
    return this.#add(DrawingBuilder.prototype.joggedRadiusDimension, idOf(options), () =>
      this.#dimension(
        options as unknown as JoggedRadiusDimensionOptions | undefined,
        (style, text) => ({
          kind: "jogged-radius-dimension",
          layer: this.#current,
          style,
          center: pt(center),
          point: pt(point),
          start: pt(start),
          jog: pt(jog),
          ...text,
        }),
      ),
    );
  }

  /**
   * Draws an angular dimension on the current layer: the angle at `vertex` between the lines to
   * `from` and to `to`, with its arc through `at`. The arc's point picks which angle, so the order
   * of `from` and `to` means nothing.
   */
  angularDimension<
    S extends string,
    T extends string = string,
    I extends string = string,
    const C extends EntityColorGiven = EntityColor,
  >(
    vertex: Point,
    from: Point,
    to: Point,
    at: Point,
    options: Z extends Standard
      ? StandardAlignedDimensionOptions<S, T, I, Z, C>
      : V extends "R12"
        ? R12Dimensions
        : AngularDimensionOptions<S, T, I, C>,
  ): this {
    return this.#add(DrawingBuilder.prototype.angularDimension, idOf(options), () =>
      this.#dimension(options as unknown as AngularDimensionOptions | undefined, (style, text) => ({
        kind: "angular-dimension",
        layer: this.#current,
        style,
        vertex: pt(vertex),
        from: pt(from),
        to: pt(to),
        at: pt(at),
        ...text,
      })),
    );
  }

  /**
   * Draws an arc length dimension on the current layer: the length of the arc about `center` of
   * `radius`, counterclockwise from `startAngle` to `endAngle` in degrees, as `arc` takes them,
   * with its own arc through `at`.
   */
  arcLengthDimension<
    S extends string,
    T extends string = string,
    I extends string = string,
    const C extends EntityColorGiven = EntityColor,
  >(
    center: Point,
    radius: number,
    startAngle: number,
    endAngle: number,
    at: Point,
    options: Z extends Standard
      ? StandardAlignedDimensionOptions<S, T, I, Z, C>
      : V extends "R12"
        ? R12Dimensions
        : ArcLengthDimensionOptions<S, T, I, C>,
  ): this {
    return this.#add(DrawingBuilder.prototype.arcLengthDimension, idOf(options), () =>
      this.#dimension(
        options as unknown as ArcLengthDimensionOptions | undefined,
        (style, text) => ({
          kind: "arc-length-dimension",
          layer: this.#current,
          style,
          center: pt(center),
          radius: kept(radius, "radius"),
          startAngle: kept(startAngle, "startAngle"),
          endAngle: kept(endAngle, "endAngle"),
          at: pt(at),
          ...text,
        }),
      ),
    );
  }

  /**
   * Draws an ordinate dimension on the current layer: the distance from `options.origin`, or from
   * `[0, 0]`, to `feature` along `options.axis`, on a leader from near `feature` to `leaderEnd`.
   */
  ordinateDimension<
    S extends string,
    T extends string = string,
    I extends string = string,
    const C extends EntityColorGiven = EntityColor,
  >(
    feature: Point,
    leaderEnd: Point,
    options: Z extends Standard
      ? StandardOrdinateDimensionOptions<S, T, I, Z, C>
      : V extends "R12"
        ? R12Dimensions
        : OrdinateDimensionOptions<S, T, I, C>,
  ): this {
    return this.#add(DrawingBuilder.prototype.ordinateDimension, idOf(options), () => {
      const o = options as unknown as OrdinateDimensionOptions | undefined;
      const axis: unknown = o?.axis;
      if (axis !== "x" && axis !== "y") refuse("dimension", ORDINATE_AXIS);
      const origin: unknown = o?.origin ?? [0, 0];
      return this.#dimension(o, (style, text) => ({
        kind: "ordinate-dimension",
        layer: this.#current,
        style,
        axis,
        origin: pt(origin as Point),
        feature: pt(feature),
        leaderEnd: pt(leaderEnd),
        ...text,
      }));
    });
  }

  /** A radius or a diameter dimension, with its text where `options.textFromCenter` says. */
  #radial<K extends "radius-dimension" | "diameter-dimension">(
    kind: K,
    center: Point,
    point: Point,
    options: unknown,
  ): RadiusDimension | DiameterDimension {
    const o = options as RadiusDimensionOptions | undefined;
    const along: unknown = o?.textFromCenter;
    return this.#dimension(
      o,
      (style, text) =>
        ({
          kind,
          layer: this.#current,
          style,
          center: pt(center),
          point: pt(point),
          ...(along === undefined
            ? {}
            : { textFromCenter: kept(along as number, "textFromCenter") }),
          ...text,
        }) as RadiusDimension | DiameterDimension,
    );
  }

  /** Checks what a dimension names and what it measures, and returns the dimension `make` gives. */
  #dimension<D extends Dimension>(
    options:
      | {
          readonly style?: unknown;
          readonly text?: unknown;
          readonly textBelow?: unknown;
          readonly view?: unknown;
        }
      | undefined,
    make: (style: string, text: { readonly text?: string; readonly textBelow?: string }) => D,
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
    const below: unknown = options?.textBelow;
    for (const words of [text, below]) {
      if (words === undefined) continue;
      const problem = dimensionTextProblem(words);
      if (problem) refuse("dimension", problem);
    }
    const made = make(style!.name, {
      ...(text === undefined ? {} : { text: text as string }),
      ...(below === undefined ? {} : { textBelow: below as string }),
    });
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
   * The drawing's own style for a dimension style of the standard, where the dimension is drawn: on
   * a layout with a scale of 1 and the writing of the paper's units, and in model space with a
   * scale of `view.paper(1)` and the writing of the drawing's units, under the name `styleNameAt`
   * gives. It is defined on first use, with its role's text style.
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
    let name: string;
    let scale = 1;
    let units: string = this.units;
    if (sheet) {
      if (view !== undefined) refuse("dimension-style", DRAWN.dimensionViewOnPaper);
      units = sheet.info.units;
      name = styleNameAt(styleId, entry, undefined);
    } else {
      if (view === undefined) refuse("dimension-style", DRAWN.dimensionWithoutView);
      const shown = this.#declared(view, "dimension-style").view;
      name = styleNameAt(styleId, entry, shown.scale);
      scale = onPaper(shown, 1, "scale");
    }
    const writing = fields.writing[units as Units];
    if (writing === undefined)
      refuse("dimension-style", writingLacks(styleId, units, drawn.standard));
    const existing = this.#dimensionStyles.get(layerKey(name));
    if (existing !== undefined) return existing;
    const role = drawn.textRoles.get(idKey(fields.role))!;
    const { units: writes, precision, prefix, suffix, suppressZeros, feetInchZeros } = writing!;
    const { fraction, fractionScale } = writing!;
    const { dimensionLineweight, extensionLineweight } = fields;
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
      ...(writes === "decimal" ? {} : { units: writes }),
      precision,
      ...(prefix === undefined ? {} : { prefix }),
      ...(suffix === undefined ? {} : { suffix }),
      ...(suppressZeros === undefined ? {} : { suppressZeros }),
      ...(feetInchZeros === undefined ? {} : { feetInchZeros }),
      measurementScale: writing!.measurementScale,
      ...(fraction === "inline" ? {} : { fraction }),
      ...(fractionScale === 1 ? {} : { fractionScale }),
      ...(fields.textPlacement === "above" ? {} : { textPlacement: fields.textPlacement }),
      ...(fields.textFit === "inside" ? {} : { textFit: fields.textFit }),
      ...(dimensionLineweight === undefined ? {} : { dimensionLineweight }),
      ...(extensionLineweight === undefined ? {} : { extensionLineweight }),
      ...(fields.radialText === "aligned" ? {} : { radialText: fields.radialText }),
      ...(fields.jogAngle === JOG_ANGLE.default ? {} : { jogAngle: fields.jogAngle }),
      ...(fields.angleUnits === "degrees" ? {} : { angleUnits: fields.angleUnits }),
      ...(fields.anglePrecision === 0 ? {} : { anglePrecision: fields.anglePrecision }),
      ...(fields.suppressAngleZeros === undefined
        ? {}
        : { suppressAngleZeros: fields.suppressAngleZeros }),
      ...(fields.arcSymbol === "before" ? {} : { arcSymbol: fields.arcSymbol }),
    });
    return this.#dimensionStyles.get(layerKey(name))!;
  }

  /**
   * Defines a leader style: the text style and height of its leaders' notes, their arrowheads,
   * the length of the landing, the gap between the landing and the note, and which line of the
   * note the landing meets. The sizes are the sizes a leader plots at, and `scale` multiplies
   * each: `fromPaper(1, "in", view)` for leaders in model space that a viewport shows at the
   * view's ratio, and 1, the default, for leaders on a layout. A style is defined once, under a
   * name no other has. A drawing drawn to a standard defines none: its leaders name the
   * standard's styles by their ids.
   */
  leaderStyle<
    N extends string,
    S extends string = string,
    H extends number = number,
    A extends string = string,
    AS extends number = number,
    L extends number = number,
    G extends number = number,
    SC extends number = number,
  >(
    style: Z extends Standard
      ? LeaderStyleDefined
      : V extends "R12"
        ? R12Leaders
        : LeaderStyleDefinition<N, S, H, A, AS, L, G, SC>,
  ): this {
    const definition = style as unknown as LeaderStyle;
    try {
      if (this.dxf === "R12") refuse("leader-style", R12_ONLY.leaders);
      if (this.#standard) refuse("leader-style-outside-standard", DRAWN.leaderStyleDefined);
      this.#defineLeaderStyle(definition);
    } catch (thrown) {
      const name: unknown = (definition as { name?: unknown } | null)?.name;
      const about = typeof name === "string" ? { leaderStyle: name } : {};
      throw located(thrown, DrawingBuilder.prototype.leaderStyle, about);
    }
    return this;
  }

  /** Checks a leader style and stores it. */
  #defineLeaderStyle(definition: LeaderStyle): void {
    const name: unknown = (definition as { name?: unknown } | null)?.name;
    const fail = (rule: LintRule, problem: string): never =>
      refuse(
        rule,
        `Leader style ${typeof name === "string" ? JSON.stringify(name) : "with no name"}: ${problem}`,
      );
    const problem = leaderStyleProblem(definition);
    if (problem) fail("leader-style", problem);
    // leaderStyleProblem has checked the types.
    const named = name as string;
    const first = this.#leaderStylesAudited.get(layerAuditKey(named));
    if (first !== undefined) fail("duplicate-leader-style", leaderStyleTwinProblem(named, first)!);
    let textStyle: string | undefined;
    if (definition.textStyle !== undefined && !isStandardTextStyle(definition.textStyle)) {
      textStyle = this.#textStyles.get(layerKey(definition.textStyle))?.name;
      if (textStyle === undefined) {
        fail(
          "undefined-text-style",
          `${undefinedLeaderTextStyleProblem(definition.textStyle)}. Define it with textStyle() first`,
        );
      }
    }
    const arrowhead = (definition.arrowhead ?? DEFAULT_LEADER_ARROWHEAD) as LeaderArrowhead;
    const block = leaderArrowheadHandles(arrowhead);
    // A handle taken before another was refused is given back.
    const taken: string[] = [];
    try {
      const what = `the leader style ${JSON.stringify(named)}`;
      this.#claim(validLeaderStyleHandle(named), what, undefined, taken);
      // The first style brings the leading CAD app's own and the dictionary that holds them.
      if (this.#leaderStyles.size === 0) {
        const standard = `the leader style ${JSON.stringify(STANDARD_LEADER_STYLE)}`;
        this.#claim(validLeaderStyleHandle(STANDARD_LEADER_STYLE), standard, undefined, taken);
        this.#claim(
          leaderStyleDictionaryHandle(),
          "the dictionary of leader styles",
          undefined,
          taken,
        );
      }
      if (block !== undefined && !this.#leaderArrowheadBlocks.has(arrowhead)) {
        const head = `the arrowhead ${JSON.stringify(arrowhead)}`;
        for (const handle of [block.record, block.begin, block.end, ...block.strokes]) {
          this.#claim(handle, head, undefined, taken);
        }
      }
    } catch (thrown) {
      for (const handle of taken) this.#handles.delete(handle);
      throw thrown;
    }
    if (block !== undefined) this.#leaderArrowheadBlocks.add(arrowhead);
    const scale = definition.scale ?? 1;
    const attachment = definition.attachment ?? "first-line";
    this.#leaderStyles.set(layerKey(named), {
      name: named,
      ...(textStyle === undefined ? {} : { textStyle }),
      textHeight: definition.textHeight,
      ...(arrowhead === DEFAULT_LEADER_ARROWHEAD ? {} : { arrowhead }),
      arrowSize: definition.arrowSize,
      landing: definition.landing,
      gap: definition.gap,
      ...(attachment === "first-line" ? {} : { attachment }),
      ...(definition.direction === undefined || definition.direction === "horizontal"
        ? {}
        : { direction: definition.direction }),
      ...(definition.verticalAttachment === undefined || definition.verticalAttachment === "center"
        ? {}
        : { verticalAttachment: definition.verticalAttachment }),
      ...(definition.frame === true ? { frame: true } : {}),
      ...(definition.shaft === undefined || definition.shaft === "straight"
        ? {}
        : { shaft: definition.shaft }),
      ...(definition.block === undefined ? {} : { block: definition.block }),
      ...(definition.blockConnection === undefined || definition.blockConnection === "extents"
        ? {}
        : { blockConnection: definition.blockConnection }),
      ...(definition.blockScale === undefined || definition.blockScale === 1
        ? {}
        : { blockScale: definition.blockScale }),
      ...(scale === 1 ? {} : { scale }),
    });
    this.#leaderStylesAudited.set(layerAuditKey(named), named);
  }

  /**
   * Defines a table style: the text height of its cells, its margins, and the cell style of its
   * title, its header and its data rows. A table names it by `style`. R2018 only.
   *
   * ```ts
   * d.tableStyle({ name: "SCHEDULE", textHeight: 0.1, title: { textHeight: 0.15 } });
   * ```
   */
  tableStyle(style: TableStyle): this {
    const definition = style as unknown as TableStyle;
    try {
      if (this.dxf === "R12") refuse("table-style", R12_ONLY.tables);
      this.#defineTableStyle(definition);
    } catch (thrown) {
      const name: unknown = (definition as { name?: unknown } | null)?.name;
      const about = typeof name === "string" ? { tableStyle: name } : {};
      throw located(thrown, DrawingBuilder.prototype.tableStyle, about);
    }
    return this;
  }

  /** Checks a table style and stores it. */
  #defineTableStyle(definition: TableStyle): void {
    const name: unknown = (definition as { name?: unknown } | null)?.name;
    const fail = (rule: LintRule, problem: string): never =>
      refuse(
        rule,
        `Table style ${typeof name === "string" ? JSON.stringify(name) : "with no name"}: ${problem}`,
      );
    const problem = tableStyleProblem(definition);
    if (problem) fail("table-style", problem);
    const named = name as string;
    const first = this.#tableStylesAudited.get(layerAuditKey(named));
    if (first !== undefined) fail("duplicate-table-style", tableStyleTwinProblem(named, first)!);
    // Each text style it names is the drawing's, under the name the drawing has it by.
    const textStyleOf = (given: string | undefined, field: string): string | undefined => {
      if (given === undefined || isStandardTextStyle(given)) return undefined;
      const found = this.#textStyles.get(layerKey(given))?.name;
      if (found === undefined) {
        fail(
          "undefined-text-style",
          `${field}: text style ${JSON.stringify(given)} is not defined. Define it with textStyle() first`,
        );
      }
      return found;
    };
    const textStyle = textStyleOf(definition.textStyle, "textStyle");
    const cells: Partial<Record<"title" | "header" | "data", TableCellStyle>> = {};
    for (const kind of ["title", "header", "data"] as const) {
      const own = definition[kind];
      if (own === undefined) continue;
      // A row's own `Standard` stays, since it differs from a style's other text style.
      const ownText =
        own.textStyle !== undefined && isStandardTextStyle(own.textStyle)
          ? STANDARD_TEXT_STYLE
          : textStyleOf(own.textStyle, `${kind}.textStyle`);
      const { textStyle: _given, ...rest } = own;
      cells[kind] = { ...(ownText === undefined ? {} : { textStyle: ownText }), ...rest };
    }
    const taken: string[] = [];
    try {
      this.#claim(
        validTableStyleHandle(named),
        `the table style ${JSON.stringify(named)}`,
        undefined,
        taken,
      );
      // The first style brings the leading CAD app's own and the dictionary that holds them.
      if (this.#tableStyles.size === 0) {
        this.#claim(
          validTableStyleHandle(STANDARD_TABLE_STYLE),
          'the table style "Standard"',
          undefined,
          taken,
        );
        this.#claim(
          tableStyleDictionaryHandle(),
          "the dictionary of table styles",
          undefined,
          taken,
        );
      }
    } catch (thrown) {
      for (const handle of taken) this.#handles.delete(handle);
      throw thrown;
    }
    this.#tableStyles.set(layerKey(named), {
      name: named,
      ...(textStyle === undefined ? {} : { textStyle }),
      textHeight: definition.textHeight,
      ...(definition.horizontalMargin === undefined
        ? {}
        : { horizontalMargin: definition.horizontalMargin }),
      ...(definition.verticalMargin === undefined
        ? {}
        : { verticalMargin: definition.verticalMargin }),
      ...cells,
    });
    this.#tableStylesAudited.set(layerAuditKey(named), named);
  }

  /**
   * Draws a table on the current layer, its upper left corner at `at`: a title in one cell across
   * its columns, a header row and data rows, each row a list of cells, one for each column, with
   * `null` for a cell that another spans. The leading CAD app holds it as one table a drafter adds
   * a row to, resizes and edits cell by cell. R2018 only.
   *
   * ```ts
   * d.table({
   *   style: "SCHEDULE",
   *   at: [1, 10],
   *   columns: [0.6, 1.2, 2.4],
   *   title: "DOOR SCHEDULE",
   *   header: ["MARK", "SIZE", "NOTES"],
   *   rows: [["D1", "3'-0\" x 7'-0\"", "SOLID CORE"]],
   * });
   * ```
   */
  table(options: TableOptions): this {
    return this.#add(DrawingBuilder.prototype.table, options as object, () =>
      this.#table(options as unknown),
    );
  }

  /** Checks a table and what it names, and returns it. */
  #table(given: unknown): Table {
    if (this.dxf === "R12") refuse("table", R12_ONLY.tables);
    if (this.#open) refuse("table", TABLE_IN_BLOCK);
    const o = (typeof given === "object" && given !== null ? given : {}) as Record<string, unknown>;
    if (o.color !== undefined && o.color !== "ByLayer") refuse("entity-color", TABLE_COLOR);
    if (o.transparency !== undefined && o.transparency !== "ByLayer")
      refuse("entity-transparency", TABLE_TRANSPARENCY);
    const named = o.style;
    const nameProblem = tableStyleNameProblem(named);
    if (nameProblem) refuse("undefined-table-style", nameProblem);
    const standard = standardTableStyleProblem(named as string);
    if (standard) refuse("undefined-table-style", standard);
    const style = this.#tableStyles.get(layerKey(named as string));
    if (style === undefined) {
      refuse(
        "undefined-table-style",
        `Table style ${JSON.stringify(named)} is not defined. Define it with tableStyle() first`,
      );
    }
    const problem = tableProblem(o, (name) => this.#blocks.has(layerKey(name)));
    if (problem) refuse("table", problem);
    const narrow = tableColumnsProblem(o.columns as number[], tableMargins(style!)[0]);
    if (narrow) refuse("table", narrow);
    const fontOf = (name: string | undefined) =>
      name === undefined || isStandardTextStyle(name)
        ? STANDARD_FONT
        : this.#textStyles.get(layerKey(name))?.font;
    const lettered = tableTextsProblem(tableTexts(o as unknown as Table, style!), fontOf);
    if (lettered) refuse("table", lettered);
    const blockName = (cell: unknown): unknown => {
      if (typeof cell !== "object" || cell === null) return cell;
      const content = cell as TableCellContent;
      if (content.block === undefined) return { ...content };
      return { ...content, block: this.#blocks.get(layerKey(content.block))!.name };
    };
    const row = (cells: readonly unknown[]) => cells.map(blockName) as (TableCell | null)[];
    return {
      kind: "table",
      layer: this.#current,
      style: style!.name,
      at: pt(o.at as Point),
      ...(o.rotation === undefined || o.rotation === 0 ? {} : { rotation: o.rotation as number }),
      columns: [...(o.columns as number[])],
      ...(o.title === undefined ? {} : { title: blockName(o.title) as TableCell }),
      ...(o.titleHeight === undefined ? {} : { titleHeight: o.titleHeight as number }),
      ...(o.header === undefined ? {} : { header: row(o.header as unknown[]) }),
      ...(o.headerHeight === undefined ? {} : { headerHeight: o.headerHeight as number }),
      rows: (o.rows as unknown[][]).map(row),
      ...(o.rowHeights === undefined
        ? {}
        : { rowHeights: [...(o.rowHeights as (number | null)[])] }),
    };
  }

  /**
   * Draws a leader on the current layer: the note `text`, one line or a list of lines from the
   * top, joined by a shaft to each point `options.to` names. The shafts meet at `options.at`,
   * where the landing starts, and the note is a gap past the landing's end. The leading CAD app
   * holds it as one multileader, which a drafter moves and edits as one.
   *
   * ```ts
   * d.leader(["EXISTING WINDOW", "TO BE REPLACED"], { style: "NOTES", at: [40, 30], to: [32, 24] });
   * d.leader("2x4 STUDS @ 16\" O.C.", { style: "NOTES", at: [40, 30], to: [[32, 24], [34, 20]] });
   * ```
   */
  leader<
    const T,
    S extends string = string,
    I extends string = string,
    TS extends string = string,
    H extends number = number,
    AS extends number = number,
    L extends number = number,
    G extends number = number,
    R extends string = string,
    TO extends LeaderTargets = LeaderTargets,
    W extends number = number,
    const C extends EntityColorGiven = EntityColor,
  >(
    text: LeaderText<T> | LeaderBlockContent,
    options: Z extends Standard
      ? StandardLeaderOptions<S, I, R, Z, AS, L, G, TO, W, C>
      : V extends "R12"
        ? R12Leaders
        : LeaderOptions<S, I, TS, H, AS, L, G, TO, W, C>,
  ): this {
    return this.#add(DrawingBuilder.prototype.leader, idOf(options), () =>
      this.#leader(text as unknown, options as unknown),
    );
  }

  /** Checks what a leader names, its note and its shafts, and returns it. */
  #leader(text: unknown, given: unknown): Leader {
    if (this.dxf === "R12") refuse("leader", R12_ONLY.leaders);
    if (this.#open) refuse("leader", LEADER_IN_BLOCK);
    const o = (typeof given === "object" && given !== null ? given : {}) as Record<string, unknown>;
    // A block in place of the note: `{ block, attributes }`.
    const content =
      typeof text === "object" && text !== null && !Array.isArray(text)
        ? (text as { readonly block?: unknown; readonly attributes?: unknown })
        : undefined;
    const lines: unknown = typeof text === "string" ? [text] : text;
    if (content === undefined) {
      const textProblem = leaderTextProblem(lines);
      if (textProblem) refuse("leader", textProblem);
    } else {
      if (typeof content.block !== "string")
        refuse("undefined-block", "a block is named by a string");
      const placed = this.#blocks.get(layerKey(content.block as string));
      if (placed === undefined) {
        refuse(
          "undefined-block",
          `${undefinedBlockProblem(content.block as string)}. Define it with block() first`,
        );
      }
      const problem = leaderBlockContentProblem({ ...o, attributes: content.attributes });
      if (problem) refuse("leader", problem);
      // Each block is looked through once, however many leaders place it.
      let percent = this.#leaderPlaced.get(placed!);
      if (percent === undefined) {
        percent = placed!.entities.some((e) => typeof e.transparency === "number");
        this.#leaderPlaced.set(placed!, percent);
      }
      if (percent) refuse("entity-transparency", LEADER_BLOCK_TRANSPARENCY);
      // Each value names an attribute of the block, as an insert's does.
      const tags = new Set((placed!.attributes ?? []).map((d) => d.tag));
      for (const tag of Object.keys((content.attributes as object | undefined) ?? {})) {
        if (!tags.has(tag))
          refuse("undefined-attribute", undefinedAttributeProblem(tag, placed!.name));
      }
    }
    // Its point and its shafts first: under a standard, finding its style defines the style.
    const at = o.at;
    if (
      !Array.isArray(at) ||
      at.length !== 2 ||
      !at.every((n) => typeof n === "number" && Number.isFinite(n))
    ) {
      return refuse("leader", "at must be a point, [x, y], where the shafts meet");
    }
    const point = pt(at as unknown as Point);
    const shafts = shaftsOf(o.to);
    const shaftProblem = leaderShaftsProblem(shafts, point);
    if (shaftProblem) refuse("leader", shaftProblem);
    // The far root's point is the note's, so its shafts are checked as a leader's once it is made.
    const far = o.toFarSide === undefined ? undefined : shaftsOf(o.toFarSide);
    let style: LeaderStyle;
    let own: Partial<Pick<Leader, "textStyle" | "textHeight">> = {};
    if (this.#standard) {
      style = this.#standardLeaderStyle(o.style, o.view);
      if (o.textStyle !== undefined || o.textHeight !== undefined) {
        refuse("role", DRAWN.leaderRoleAndText);
      }
      if (o.role !== undefined) own = this.#leaderRole(o.role, o.style);
    } else {
      if (o.view !== undefined) refuse("leader-style", DRAWN.viewWithoutStandard);
      if (o.role !== undefined) refuse("role", DRAWN.roleWithoutStandard);
      const named = o.style;
      const nameProblem = leaderStyleNameProblem(named);
      if (nameProblem) refuse("undefined-leader-style", nameProblem);
      const found = this.#leaderStyles.get(layerKey(named as string));
      if (!found) {
        const absent = undefinedLeaderStyleProblem(named as string);
        refuse(
          "undefined-leader-style",
          isStandardLeaderStyle(named as string)
            ? absent
            : `${absent}. Define it with leaderStyle() first`,
        );
      }
      style = found!;
      if (o.textStyle !== undefined) {
        if (typeof o.textStyle !== "string") {
          refuse("undefined-text-style", "a text style is named by a string");
        }
        const name = this.#textStyleName(o.textStyle as string);
        own = { textStyle: name };
      }
      if (o.textHeight !== undefined) own = { ...own, textHeight: o.textHeight as number };
    }
    const made: Leader = {
      kind: "leader",
      layer: this.#current,
      style: style.name,
      ...(content === undefined
        ? { text: [...(lines as readonly string[])] }
        : {
            block: this.#blocks.get(layerKey(content.block as string))!.name,
            ...(content.attributes === undefined
              ? {}
              : { attributes: { ...(content.attributes as Record<string, string>) } }),
          }),
      at: point,
      shafts: (shafts as readonly (readonly Point[])[]).map((shaft) => shaft.map(pt)),
      ...(o.side === undefined ? {} : { side: o.side as LeaderSide }),
      ...(o.attachment === undefined ? {} : { attachment: o.attachment as LeaderAttachment }),
      ...(o.verticalAttachment === undefined
        ? {}
        : { verticalAttachment: o.verticalAttachment as LeaderVerticalAttachment }),
      ...own,
      ...(o.arrowSize === undefined ? {} : { arrowSize: o.arrowSize as number }),
      ...(o.landing === undefined ? {} : { landing: o.landing as number }),
      ...(o.gap === undefined ? {} : { gap: o.gap as number }),
      ...(o.width === undefined ? {} : { width: o.width as number }),
      ...(o.frame === undefined ? {} : { frame: o.frame as boolean }),
      ...(o.mask === undefined ? {} : { mask: o.mask as TextMask }),
      ...(o.shaft === undefined ? {} : { shaft: o.shaft as LeaderShaftKind }),
      ...(far === undefined
        ? {}
        : { farShafts: (far as readonly (readonly Point[])[]).map((shaft) => shaft.map(pt)) }),
    };
    const ownProblem = leaderOwnProblem(made, written(style.scale ?? 1));
    if (ownProblem) refuse("leader", ownProblem);
    const styleName = made.textStyle ?? style.textStyle;
    const textStyle =
      styleName === undefined ? undefined : this.#textStyles.get(layerKey(styleName));
    const drawn = leaderDrawnProblem(made, style, textStyle, (name) =>
      this.#blocks.get(layerKey(name)),
    );
    if (drawn) refuse("leader", drawn);
    return made;
  }

  /**
   * The drawing's own style for a leader style of the standard, where the leader is drawn: its id
   * in capitals on a layout, with a scale of 1, and with the view's scale id after it in model
   * space, with a scale of `view.paper(1)`. It is defined on first use, with
   * its role's text style and height.
   */
  #standardLeaderStyle(named: unknown, view: unknown): LeaderStyle {
    const drawn = this.#standard!;
    const id = named === undefined ? drawn.standard.defaultLeaderStyle : named;
    if (id === undefined) {
      return refuse("leader-style-outside-standard", noDefaultLeaderStyle(drawn.standard));
    }
    const found = typeof id === "string" ? drawn.leaderStyles.get(idKey(id)) : undefined;
    if (found === undefined) {
      return refuse(
        "leader-style-outside-standard",
        typeof id === "string"
          ? (leaderStyleReserved(id) ?? leaderStyleLacks(id, drawn.standard))
          : "A leader style is named by a string",
      );
    }
    const [styleId, entry] = found;
    const fields = this.#inDiscipline("Leader style", styleId, entry);
    let name = capitals(styleId);
    let scale = 1;
    if (this.#sheet) {
      if (view !== undefined) refuse("leader-style", DRAWN.leaderViewOnPaper);
    } else {
      if (view === undefined) refuse("leader-style", DRAWN.leaderWithoutView);
      const shown = this.#declared(view, "leader-style").view;
      name = `${name}-${shown.scale}`;
      scale = onPaper(shown, 1, "scale");
    }
    const existing = this.#leaderStyles.get(layerKey(name));
    if (existing !== undefined) return existing;
    const role = drawn.textRoles.get(idKey(fields.role))!;
    this.#defineLeaderStyle({
      name,
      textStyle: this.#roleStyle(role),
      textHeight: this.#roleFields(role).height,
      arrowhead: fields.arrowhead,
      arrowSize: fields.arrowSize,
      landing: fields.landing,
      gap: fields.gap,
      attachment: fields.attachment,
      direction: fields.direction,
      verticalAttachment: fields.verticalAttachment,
      frame: fields.frame,
      shaft: fields.shaft,
      scale,
    });
    return this.#leaderStyles.get(layerKey(name))!;
  }

  /**
   * The text style and height a leader's note takes from a role of the standard, where its own
   * style's role is another: none when the role is the style's.
   */
  #leaderRole(role: unknown, styleId: unknown): Partial<Pick<Leader, "textStyle" | "textHeight">> {
    const drawn = this.#standard!;
    const found = typeof role === "string" ? drawn.textRoles.get(idKey(role)) : undefined;
    if (found === undefined) {
      return refuse(
        "role",
        typeof role === "string" ? roleLacks(role, drawn.standard) : "A role is named by a string",
      );
    }
    const id = styleId === undefined ? drawn.standard.defaultLeaderStyle : styleId;
    const entry = typeof id === "string" ? drawn.leaderStyles.get(idKey(id)) : undefined;
    const styleRole =
      entry === undefined ? undefined : this.#inDiscipline("Leader style", ...entry).role;
    if (styleRole !== undefined && idKey(styleRole) === idKey(found[0])) return {};
    return { textStyle: this.#roleStyle(found), textHeight: this.#roleFields(found).height };
  }

  /**
   * Adds a layout: a sheet of `options.paper` that the leading CAD app shows as a tab and plots as
   * one page, at 1:1 on `DWG To PDF.pc3`. What `draw` draws goes on the sheet and not in model
   * space, in the paper's units from the sheet's lower-left corner, and `sheet.viewport()`
   * shows model space on it at a scale. Inside `draw` the current layer starts as `"0"`. A
   * layout is defined once, and not inside a block or another layout. That app opens a drawing
   * on its first layout.
   *
   * Drawn to a standard, a layout is on a sheet format of the standard, which gives its paper,
   * its plot style table, its title block and its zones: `layout(name, { sheetFormat }, draw)`,
   * or `layout(name, draw)` for the standard's `defaultSheetFormat`. The sheet's `zone()` and
   * `drawingArea` lay it out, and `titleBlock()` places its title block.
   */
  layout<N extends string, P extends string, F extends string = string>(
    name: V extends "R12" ? R12Layouts : LayoutName<N>,
    // Options of `undefined` are none. The conditional over `Z` stays one member of a union, so a
    // builder of one standard is still a builder of any.
    ...args:
      | [
          options:
            | (Z extends Standard ? StandardLayoutOptions<F, Z> : LayoutOptions<P>)
            | undefined,
          draw: (sheet: Sheet<Z>) => void,
        ]
      | [draw: (sheet: Sheet<Z>) => void]
  ): this {
    // The parameter type is the error message when a literal name is wrong, so read it as a string.
    const requested = name as string;
    // `draw` is last: the second argument, or the third after the options.
    const [first, second] = args as readonly unknown[];
    const drawFirst = typeof first === "function";
    const given = drawFirst ? undefined : first;
    const draw = (drawFirst ? first : second) as (sheet: Sheet<Z>) => void;
    let open: OpenLayout;
    const taken: string[] = [];
    try {
      const fail = (rule: LintRule, problem: string): never =>
        refuse(rule, `Layout ${JSON.stringify(requested)}: ${problem}`);
      if (typeof draw !== "function" || args.length !== (drawFirst ? 1 : 2)) {
        fail("layout", DRAWN.layoutDraw);
      }
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
      const drawn = this.#standard;
      const o = (given ?? {}) as {
        readonly paper?: unknown;
        readonly plotStyle?: unknown;
        readonly sheetFormat?: unknown;
      };
      let paper: unknown = o.paper;
      let plotStyle: unknown = o.plotStyle;
      let format: OpenLayout["format"];
      if (drawn) {
        const { standard } = drawn;
        if (paper !== undefined || plotStyle !== undefined) {
          fail("sheet-format-outside-standard", DRAWN.layoutPaper);
        }
        const id = o.sheetFormat === undefined ? standard.defaultSheetFormat : o.sheetFormat;
        if (id === undefined) fail("sheet-format-outside-standard", noDefaultSheetFormat(standard));
        format = typeof id === "string" ? drawn.sheetFormats.get(idKey(id)) : undefined;
        if (format === undefined) {
          fail(
            "sheet-format-outside-standard",
            typeof id === "string"
              ? sheetFormatLacks(id, standard)
              : "A sheet format is named by a string",
          );
        }
        if (standard.sheetFiles === "sheet-per-file" && this.#layouts.size > 0) {
          fail("sheet-per-file", DRAWN.secondLayout);
        }
        // The leading CAD app keeps two layouts apart whose names only its AUDIT takes for one, and
        // the record of each one's sheet format would have one key for the two.
        for (const other of this.#layouts.values()) {
          if (other && layerAuditKey(other.name) === layerAuditKey(requested)) {
            fail("duplicate-layout", layoutAuditTwin(other.name));
          }
        }
        paper = format![1].paper;
        const table = format![1].plotStyle ?? standard.plotStyle;
        plotStyle = table === DEFAULT_PLOT_STYLE_TABLE ? undefined : table;
      } else {
        if (given === undefined) fail("layout", DRAWN.layoutWithoutPaper);
        if (o.sheetFormat !== undefined) {
          fail("sheet-format-outside-standard", DRAWN.sheetFormatWithoutStandard);
        }
      }
      const problem = paperProblem(paper);
      if (problem) fail("layout", problem);
      const info = paperInfo(paper as Paper)!;
      if (drawn && info.units !== drawn.standard.paperUnits) {
        fail("layout", layoutPaperUnitsProblem(paper as string, info.units, drawn.standard));
      }
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
        format,
        titleBlock: undefined,
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
    const area = open.format && this.#sheetTitleBlock(open.format)[1].drawingArea;
    const sheet: Sheet<Z> = {
      name: open.name,
      paper: open.paper,
      units: open.info.units,
      width: open.info.width,
      height: open.info.height,
      drawingArea: (area ? zoneOf(area) : undefined) as Sheet<Z>["drawingArea"],
      zone: (zone) => {
        try {
          return this.#zone(open, zone);
        } catch (thrown) {
          throw located(thrown, sheet.zone, { layout: open.name });
        }
      },
      titleBlock: (...fields) => {
        this.#titleBlock(sheet.titleBlock, open, fields[0]);
        return sheet as never;
      },
      viewport: (corner, width, height, view) => {
        this.#viewport(sheet.viewport, open, corner, width, height, view);
        return sheet as never;
      },
    };
    try {
      draw(sheet);
      this.#finishSheet(open);
    } catch (thrown) {
      // Nothing of a layout that was not finished stays, so the call can be made again.
      this.#layouts.delete(key);
      for (const handle of open.handles) this.#handles.delete(handle);
      for (const id of open.ids) this.#ids.delete(id);
      for (const shown of open.views) shown.shown = false;
      throw located(thrown, DrawingBuilder.prototype.layout, { layout: requested });
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

  /** The title block of a sheet format, as the standard spells its id. */
  #sheetTitleBlock([, format]: readonly [string, StandardSheetFormat]): readonly [
    string,
    StandardTitleBlock,
  ] {
    return this.#standard!.titleBlocks.get(idKey(format.titleBlock))!;
  }

  /** A zone of the sheet format of the layout being drawn, by its id in any case. */
  #zone(open: OpenLayout, name: unknown): Zone {
    if (!open.format) return refuse("layout", DRAWN.zoneWithoutStandard);
    const [id, format] = open.format;
    const found =
      typeof name === "string"
        ? Object.entries(format.zones).find(([zone]) => idKey(zone) === idKey(name))
        : undefined;
    if (!found) {
      return refuse(
        "layout",
        typeof name === "string"
          ? zoneLacks(name, id, Object.keys(format.zones))
          : "A zone is named by a string",
      );
    }
    return zoneOf(found[1]);
  }

  /**
   * Places the title block of the layout being drawn: its xref, and the block of its fields over
   * it with the values the fields are filled with. `method` is the sheet's own.
   */
  #titleBlock(method: Method, open: OpenLayout, given: unknown): void {
    try {
      const drawn = this.#standard;
      if (!drawn) refuse("layout", DRAWN.titleBlockWithoutStandard);
      if (open.closed) refuse("layout", DRAWN.titleBlockClosed);
      if (open.titleBlock) refuse("layout", DRAWN.titleBlockTwice);
      const [id, block] = this.#sheetTitleBlock(open.format!);
      const { standard } = drawn!;
      const oneDrawing = standard.sheetFiles === "one-drawing";
      const fields = Object.entries(block.fields);
      if (
        oneDrawing &&
        fields.some(([, f]) => f.source === "fileName" || f.source === "layoutName")
      ) {
        refuse("standard", READS_A_NAME);
      }
      const own = titleBlockValues(given, id, fields);
      if (own.number !== undefined) {
        if (oneDrawing && own.number !== open.name) {
          refuse("layout", numberNotLayoutName(own.number, open.name));
        }
        const problem = oneDrawing ? undefined : sheetNumberProblem(own.number);
        if (problem) refuse("sheet-per-file", sheetNumberOfFile(problem));
      }
      const values: Record<string, string | undefined> = { ...drawn!.fields, ...own };
      if (oneDrawing) values.number = open.name;
      const attributes: Record<string, string> = {};
      const tags: string[] = [];
      const scaleTags: string[] = [];
      for (const [tag, field] of fields) {
        const key = field.fills ?? tag;
        if (field.source === "layoutName") {
          // Such a field is in a file of one sheet, so the drawing's own value is this sheet's.
          if (values[key] !== undefined && values[key] !== open.name) {
            refuse("layout", layoutNameField(tag, key, open.name));
          }
        } else if (field.source === "currentDate") {
          const taken = fields.some(([, f]) => f.source === "attribute" && (f.fills ?? "") === key);
          if (own[key] !== undefined && !taken) {
            refuse(
              "layout",
              filledByCad(tag, key, "the date the leading CAD app opens or plots the sheet"),
            );
          }
        } else if (field.source === "attribute") {
          tags.push(tag);
          const value = values[key];
          if (value !== undefined) attributes[tag] = value;
          else if (key === "scale") scaleTags.push(tag);
        }
      }
      const [layer, copied] = this.#layersOrNone(
        () =>
          [
            this.#standardLayer(block.layer, {} as LayerOptions),
            block.block && this.#copyTitleBlock(id, block),
          ] as const,
      );
      const target = open.entities;
      const entities = target.length;
      const calls = open.calls?.length ?? 0;
      const ids = open.ids.length;
      const handles = open.handles.length;
      const previous = this.#current;
      this.#current = layer.name;
      let index: number | undefined;
      try {
        if (block.xref) {
          const { name, path, at } = block.xref;
          this.#defineXref(name, path, true);
          const border = idWith(`${open.name}.border`);
          this.#add(method, border, () => this.#placed(name, at, border));
        }
        if (copied !== undefined) {
          index = target.length;
          const fields = idWith(`${open.name}.title-block`);
          this.#add(method, fields, () => this.#placed(copied, [0, 0], { ...fields, attributes }));
        }
      } catch (thrown) {
        // A refused insert leaves nothing on the layout.
        target.length = entities;
        open.calls?.splice(calls);
        for (const key of open.ids.splice(ids)) this.#ids.delete(key);
        for (const handle of open.handles.splice(handles)) this.#handles.delete(handle);
        throw thrown;
      } finally {
        this.#current = previous;
      }
      open.titleBlock = { index, tags, scaleTags, number: oneDrawing ? undefined : own.number };
    } catch (thrown) {
      throw located(thrown, method, { layout: open.name });
    }
  }

  /**
   * What the builder does when a layout's `draw` returns: it fills the scale of the title block's
   * fields that were given none, and under `sheet-per-file` it requires the sheet's number.
   */
  #finishSheet(open: OpenLayout): void {
    const drawn = this.#standard;
    if (!drawn) return;
    const block = open.titleBlock;
    const labels = [...new Set(open.views.map((shown) => shown.view.label))];
    if (block?.index !== undefined && block.scaleTags.length > 0 && labels.length > 0) {
      const scale = labels.length === 1 ? labels[0]! : "AS NOTED";
      const insert = open.entities[block.index] as Insert;
      const set: Record<string, string> = {};
      for (const tag of block.tags) {
        const value = block.scaleTags.includes(tag) ? scale : insert.attributes?.[tag];
        if (value !== undefined) set[tag] = value;
      }
      const placed = this.#blocks.get(layerKey(insert.block))!;
      const filled: Insert = { ...insert, attributes: set };
      for (const definition of placed.attributes ?? []) {
        if (!block.scaleTags.includes(definition.tag)) continue;
        const style =
          definition.style === undefined
            ? undefined
            : this.#textStyles.get(layerKey(definition.style));
        const problem = placedAttributeProblem(
          definition.tag,
          placeAttribute(definition, style, filled, placed.base),
        );
        if (problem) refuse("geometry", problem);
      }
      open.entities[block.index] = filled;
    }
    if (drawn.standard.sheetFiles === "sheet-per-file") {
      if ((block?.number ?? drawn.fields.number) === undefined) {
        refuse("sheet-per-file", DRAWN.sheetWithoutNumber);
      }
    }
  }

  /**
   * Copies the block of a title block into the drawing, with every block it inserts and every
   * text style they use, under their own names, and the layers and linetypes of the standard
   * they draw on. A definition the drawing has with the same definition is the one it keeps, and
   * one it has with another is refused. Returns the name of the block of the fields.
   */
  #copyTitleBlock(owner: string, titleBlock: StandardTitleBlock): string {
    const drawing = titleBlock.block!;
    const what = `The title block ${JSON.stringify(owner)}`;
    const byName = new Map((drawing.blocks ?? []).map((b) => [layerKey(b.name), b]));
    const start = byName.get(layerKey(titleBlock.blockName!))!;
    // Each block comes after the blocks it inserts.
    const closure: Block[] = [];
    const seen = new Set<Block>();
    const visit = (block: Block): void => {
      if (seen.has(block)) return;
      seen.add(block);
      for (const e of block.entities) {
        const inner = e.kind === "insert" ? byName.get(layerKey(e.block)) : undefined;
        if (inner) visit(inner);
      }
      closure.push(block);
    };
    visit(start);
    const styles = new Set<string>();
    for (const block of closure) {
      for (const e of block.entities)
        if ((e.kind === "text" || e.kind === "paragraph") && e.style) styles.add(layerKey(e.style));
      for (const a of block.attributes ?? []) if (a.style) styles.add(layerKey(a.style));
    }
    // Every refusal comes before the drawing takes a text style, block, id or handle, and
    // #titleBlock gives back the layers and linetypes, so a refused copy leaves nothing.
    const added: TextStyle[] = [];
    for (const style of drawing.textStyles ?? []) {
      const key = layerKey(style.name);
      if (!styles.has(key)) continue;
      const existing = this.#textStyles.get(key);
      if (existing) {
        if (canonical(existing) !== canonical(style)) {
          refuse(
            "duplicate-block",
            `${what} holds the text style ${JSON.stringify(style.name)}, and the drawing has a text style of this name with another font, width factor or oblique angle. A drawing holds one text style of a name`,
          );
        }
        continue;
      }
      const twin = this.#textStylesAudited.get(layerAuditKey(style.name));
      if (twin !== undefined) {
        refuse(
          "duplicate-block",
          `${what} holds the text style ${JSON.stringify(style.name)}, which the leading CAD app takes for the drawing's text style ${JSON.stringify(twin)}. A drawing holds one text style of a name`,
        );
      }
      added.push(style);
    }
    const copied: Block[] = [];
    const ids = new Map<string, string>();
    const claims = new Map<string, { readonly id?: string; readonly what: string }>();
    const claim = (handle: string, what: string, id?: string): void => {
      this.#free(handle, what, id, claims);
      claims.set(handle, id === undefined ? { what } : { id, what });
    };
    for (const block of closure) {
      const first = this.#blocksAudited.get(layerAuditKey(block.name));
      if (first !== undefined) {
        const existing = first.xref ? undefined : this.#blocks.get(layerKey(block.name));
        if (existing && canonical(existing) === canonical(block)) continue;
        refuse(
          "duplicate-block",
          `${what} holds the block ${JSON.stringify(block.name)}, and the drawing has ${first.xref ? "an xref" : "a block"} ${JSON.stringify(first.name)} that the leading CAD app takes for it, with another definition. A block's handles come from its name, so the builder renames neither: give one of them another name`,
        );
      }
      copied.push(block);
      const handles = blockHandles(block.name);
      const named = `the block ${JSON.stringify(block.name)}`;
      for (const handle of [handles.record, handles.begin, handles.end]) claim(handle, named);
      for (const { tag } of block.attributes ?? []) {
        claim(
          definitionHandle(block.name, tag),
          `the attribute ${JSON.stringify(tag)} of ${named}`,
        );
      }
      for (const e of block.entities) {
        if (e.id === undefined) continue;
        const key = this.#idKey(e.id);
        const first = ids.get(key);
        if (first !== undefined) refuse("duplicate-id", duplicateIdProblem(e.id, first));
        ids.set(key, e.id);
        claim(validIdHandle(e.id), `the id ${JSON.stringify(e.id)}`, e.id);
        // The handles #placed takes for an insert with an id.
        const tags = e.kind === "insert" ? (byName.get(layerKey(e.block))?.attributes ?? []) : [];
        if (tags.length === 0) continue;
        const insert = `the insert ${JSON.stringify(e.id)}`;
        for (const { tag } of tags) {
          claim(
            insertAttributeHandle(e.id, tag),
            `the attribute ${JSON.stringify(tag)} of ${insert}`,
          );
        }
        claim(insertEndHandle(e.id), `the end of the attributes of ${insert}`);
      }
    }
    for (const block of copied) {
      const layers = [...block.entities, ...(block.attributes ?? [])].map((e) => e.layer);
      for (const layer of new Set(layers)) {
        if (layer !== "0") this.#standardLayer(layer, {} as LayerOptions);
      }
      for (const e of block.entities) {
        const linetype: unknown = (e as { readonly linetype?: unknown }).linetype;
        if (linetype !== undefined) this.#linetypeName(linetype, refuse);
      }
    }
    for (const style of added) {
      this.#textStyles.set(layerKey(style.name), style);
      this.#textStylesAudited.set(layerAuditKey(style.name), style.name);
    }
    // The blocks belong to the drawing, also when a layout that is not finished copies them.
    for (const [handle, holder] of claims) this.#claim(handle, holder.what, holder.id, []);
    for (const [key, id] of ids) this.#ids.set(key, id);
    for (const block of copied) {
      this.#blocks.set(layerKey(block.name), block);
      this.#blocksAudited.set(layerAuditKey(block.name), { name: block.name, xref: false });
    }
    return start.name;
  }

  /** Runs `take`, and gives back every layer and linetype it stored when it throws. */
  #layersOrNone<T>(take: () => T): T {
    const tables: Map<string, unknown>[] = [
      this.#layers,
      this.#audited,
      this.#linetypes,
      this.#linetypesAudited,
    ];
    const kept = tables.map((table) => [...table]);
    try {
      return take();
    } catch (thrown) {
      tables.forEach((table, i) => {
        table.clear();
        for (const [key, value] of kept[i]!) table.set(key, value);
      });
      throw thrown;
    }
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
      | {
          readonly center?: Point;
          readonly ratio?: unknown;
          readonly id?: unknown;
          readonly frozenLayers?: unknown;
          readonly twist?: unknown;
        }
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
        ...(view?.frozenLayers === undefined ? {} : { frozenLayers: view.frozenLayers }),
        ...(view?.twist === undefined ? {} : { twist: view.twist }),
      };
      const problem = viewportProblem(made, open.info.units, this.units);
      if (problem) refuse("viewport", problem);
      // Each frozen layer by the drawing's own spelling of its name, once.
      const frozenLayers = new Map<string, string>();
      for (const name of (made.frozenLayers ?? []) as readonly string[]) {
        const layer = this.#layers.get(layerKey(name));
        if (!layer) refuse("undefined-layer", frozenLayerAbsent(name));
        if (!frozenLayers.has(layerKey(name))) frozenLayers.set(layerKey(name), layer!.name);
      }
      open.viewports.push({
        ...(made as Viewport),
        corner: pt(corner),
        center: pt(view!.center!),
        ...(made.frozenLayers === undefined ? {} : { frozenLayers: [...frozenLayers.values()] }),
      });
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
      ...(this.#leaderStyles.size > 0 ? { leaderStyles: [...this.#leaderStyles.values()] } : {}),
      ...(this.#tableStyles.size > 0 ? { tableStyles: [...this.#tableStyles.values()] } : {}),
      ...(this.#patterns.size > 0
        ? { patterns: [...this.#patterns.values()].map(([pattern]) => pattern) }
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
   * The fields of a definition of paragraph text: its point and value, and the height, rotation,
   * style, width, justification and line spacing its options give, each checked as a
   * paragraph's.
   */
  #paragraphFields(
    at: Point,
    options: ParagraphAttributeFields<string, number, number> & TextOptions,
  ): Omit<ParagraphAttributeDefinition, "tag" | "prompt" | "layer"> {
    const { align, valign, ...rest } = options as unknown as Record<string, unknown>;
    const placed = this.#textFields(at, "", rest as unknown as TextOptions);
    const definition: Record<string, unknown> = {
      kind: "paragraph",
      at: placed.at,
      height: placed.height,
      rotation: placed.rotation,
      ...(placed.style === undefined ? {} : { style: placed.style }),
      value: this.#paragraphValue(options.value ?? "", placed.style, "attribute"),
    };
    if (options.width !== undefined) definition["width"] = positive(options.width, "width");
    const { lineSpacing, lineSpacingStyle } = options as unknown as Record<string, unknown>;
    for (const [field, chosen, plain] of [
      ["align", align, "left"],
      ["valign", valign, "top"],
      ["lineSpacingStyle", lineSpacingStyle, "at-least"],
    ] as const) {
      if (chosen === undefined) continue;
      const choiceProblem = paragraphChoiceProblem(field, chosen);
      if (choiceProblem)
        refuse(field === "lineSpacingStyle" ? "paragraph" : "text-align", choiceProblem);
      if (chosen !== plain) definition[field] = chosen;
    }
    if (lineSpacing !== undefined) {
      const spacingProblem = lineSpacingProblem(lineSpacing);
      if (spacingProblem) refuse("paragraph", spacingProblem);
      if (lineSpacing !== 1) definition["lineSpacing"] = lineSpacing;
    }
    return definition as unknown as Omit<ParagraphAttributeDefinition, "tag" | "prompt" | "layer">;
  }

  /**
   * A value of paragraph text as the drawing holds it, with each line feed as `\P`, checked as a
   * paragraph's in the font of `style`, or refused under `rule`.
   */
  #paragraphValue(given: unknown, style: string | undefined, rule: LintRule, about = ""): string {
    if (typeof given !== "string")
      return refuse(rule, `${about}A paragraph's value must be a string`);
    // A backslash would escape the `\` of the `\P` a line feed becomes, as the type refuses it.
    let backslashes = 0;
    for (let i = 0; i < given.length; i++) {
      const code = given.charCodeAt(i);
      if (code === 92) backslashes++;
      else {
        if (code === 10 && backslashes % 2 === 1) {
          return refuse(rule, `${about}${paragraphUnknownCode("\n")}`);
        }
        backslashes = 0;
      }
    }
    const value = given.replaceAll("\n", "\\P");
    const font =
      style === undefined
        ? STANDARD_FONT
        : (this.#textStyles.get(layerKey(style))?.font ?? STANDARD_FONT);
    const problem = paragraphProblemIn(parseParagraph(value), font);
    if (problem) refuse(rule, `${about}${problem}`);
    return value;
  }

  /**
   * The height and text style of a text with a role, where it is drawn: the role's height in a
   * block and on a layout, and `view.paper` of it in model space. Undefined for a text with no
   * role and no view.
   */
  #role(options: TextOptions): { readonly height: number; readonly style: string } | undefined {
    const role: unknown = options.role;
    const view: unknown = options.view;
    const drawn = this.#standard;
    if (role === undefined && view === undefined) {
      return drawn ? refuse("text-style-outside-standard", DRAWN.textWithoutRole) : undefined;
    }
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
      // Before `make`, which takes a dimension's handles.
      const color = this.#color(o);
      const transparency = this.#transparency(o);
      const made = { ...make(), ...named, ...this.#style(o), ...color, ...transparency } as Entity;
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
    if (made.kind === "text" || made.kind === "paragraph") {
      return (options as { readonly role?: unknown }).role !== undefined;
    }
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
    this.#free(handle, what, id);
    this.#handles.set(handle, id === undefined ? { what } : { id, what });
    held?.push(handle);
  }

  /** Refuses a handle that the drawing, or `pending`, already holds. */
  #free(
    handle: string,
    what: string,
    id?: string,
    pending?: ReadonlyMap<string, { readonly id?: string; readonly what: string }>,
  ): void {
    const other = this.#handles.get(handle) ?? pending?.get(handle);
    if (other === undefined) return;
    refuse(
      "id-handle",
      id !== undefined && other.id !== undefined
        ? idHandleProblem(id, other.id, handle)
        : handleProblem(what, other.what, handle),
    );
  }

  /** The color an entity is stored with: none for ByLayer, and a true color as a copy. */
  #color(options: object): { readonly color?: EntityColor } {
    const color: unknown = (options as { readonly color?: unknown }).color;
    if (color === undefined) return {};
    const problem = entityColorProblem(color);
    if (problem) refuse("entity-color", problem);
    if (color === "ByLayer") return {};
    if (this.dxf === "R12") refuse("entity-color", R12_ONLY.entityColor);
    return {
      color: Array.isArray(color)
        ? ([color[0], color[1], color[2]] as const)
        : (color as EntityColor),
    };
  }

  /** The transparency an entity is stored with: none for ByLayer. */
  #transparency(options: object): { readonly transparency?: EntityTransparency } {
    const transparency: unknown = (options as { readonly transparency?: unknown }).transparency;
    if (transparency === undefined) return {};
    const problem = entityTransparencyProblem(transparency);
    if (problem) refuse("entity-transparency", problem);
    if (transparency === "ByLayer") return {};
    if (this.dxf === "R12") refuse("entity-transparency", R12_ONLY.entityTransparency);
    return { transparency: transparency as EntityTransparency };
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
    const problem =
      linetypeProblem(definition.name, definition.description ?? "", definition.pattern) ??
      marksProblem(definition.marks, definition.pattern as readonly number[]);
    if (problem) refuse("linetype", `${label}: ${problem}`);
    const marks = definition.marks?.map((m) => ({ ...m })) ?? [];
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
        existing.pattern.every((length, i) => length === lengths[i]) &&
        JSON.stringify(existing.marks ?? []) === JSON.stringify(marks);
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
      ...(marks.length === 0 ? {} : { marks }),
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

/** A standard as the builder reads it: its entries by the keys the leading CAD app finds them by. */
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
  readonly leaderStyles: ReadonlyMap<string, readonly [id: string, style: StandardLeaderStyle]>;
  /** Each sheet format and title block as the standard spells its id, by `idKey`. */
  readonly sheetFormats: ReadonlyMap<string, readonly [id: string, format: StandardSheetFormat]>;
  readonly titleBlocks: ReadonlyMap<string, readonly [id: string, block: StandardTitleBlock]>;
  /** The drawing's discipline, as the standard spells it. */
  readonly discipline?: string;
  /** The values `createDrawing`'s `fields` gives the drawing's title blocks. */
  readonly fields: Readonly<Record<string, string>>;
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
    if (options.fields !== undefined) refuse("standard", DRAWN.fieldsWithoutStandard);
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
      leaderStyles: byKey(standard.leaderStyles, idKey),
      sheetFormats: byKey(standard.sheetFormats, idKey),
      titleBlocks: byKey(standard.titleBlocks, idKey),
      fields: {},
    };
    drawnStandards.set(standard, drawn);
  }
  const fields = drawingFields(options.fields, standard);
  if (discipline === undefined) return { ...drawn, fields };
  if (typeof discipline !== "string")
    return refuse("standard", "A discipline is named by a string");
  const named = Object.keys(standard.disciplines).find((id) => idKey(id) === idKey(discipline));
  if (named === undefined) refuse("standard", disciplineLacks(discipline, standard));
  if (standard.sheetFiles === "one-drawing") refuse("standard", DRAWN.disciplineOneDrawing);
  return { ...drawn, discipline: named, fields };
}

/**
 * The values `createDrawing`'s `fields` gives the title blocks, checked: each key is a value of
 * `fills` or the tag of a field of a title block of the standard that fills nothing, and each
 * value a text a field can hold. Under `one-drawing` it gives no number, and under
 * `sheet-per-file` a number that names a file.
 */
function drawingFields(given: unknown, standard: Standard): Readonly<Record<string, string>> {
  if (given === undefined) return {};
  if (typeof given !== "object" || given === null || Array.isArray(given)) {
    return refuse("standard", "fields is an object of the values of title block fields, by key");
  }
  const tags = new Set<string>();
  for (const block of Object.values<StandardTitleBlock>(standard.titleBlocks)) {
    for (const [tag, field] of Object.entries(block.fields)) {
      if (field.fills === undefined) tags.add(tag);
    }
  }
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(given as Record<string, unknown>)) {
    if (value === undefined) continue;
    if (!(FILL_KEYS as readonly string[]).includes(key) && !tags.has(key)) {
      refuse("standard", fieldLacks(key, "fields"));
    }
    const problem = typeof value === "string" ? textProblem(value) : "must be a string";
    if (problem) refuse("standard", `fields.${key}: ${problem}`);
    values[key] = value as string;
  }
  const number = values.number;
  if (number !== undefined) {
    if (standard.sheetFiles === "one-drawing") refuse("layout", DRAWN.numberOneDrawing);
    const problem = sheetNumberProblem(number);
    if (problem) refuse("sheet-per-file", sheetNumberOfFile(problem));
  }
  return values;
}

/** `{ id }` for an insert the builder places, when `id` is a valid id, and `{}` otherwise. */
function idWith(id: string): { readonly id?: string } {
  return idProblem(id) === undefined ? { id } : {};
}

/** A box of a sheet format, `[left, bottom, right, top]`, as a `Zone`. */
function zoneOf([left, bottom, right, top]: readonly [number, number, number, number]): Zone {
  return Object.freeze({ left, bottom, right, top, width: right - left, height: top - bottom });
}

/**
 * The values `titleBlock()` is given, checked: each key is what a field of the title block fills,
 * or the tag of one of its fields that fills nothing, and each value a text a field can hold.
 */
function titleBlockValues(
  given: unknown,
  id: string,
  fields: readonly (readonly [string, { readonly fills?: string }])[],
): Readonly<Record<string, string | undefined>> {
  if (given === undefined) return {};
  if (typeof given !== "object" || given === null || Array.isArray(given)) {
    return refuse("layout", "titleBlock() takes an object of the values of its fields, by key");
  }
  const keys = new Set(fields.map(([tag, field]) => field.fills ?? tag));
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(given as Record<string, unknown>)) {
    if (value === undefined) continue;
    if (!keys.has(key)) refuse("layout", fieldLacks(key, `The title block ${JSON.stringify(id)}`));
    const problem = typeof value === "string" ? textProblem(value) : "must be a string";
    if (problem) refuse("text", `${key}: ${problem}`);
    values[key] = value as string;
  }
  return values;
}

/** The id and the color among the options of a dimension, which have no linetype or lineweight to take. */
function idOf(options: unknown): {
  readonly id?: unknown;
  readonly color?: unknown;
  readonly transparency?: unknown;
} {
  const { id, color, transparency } = (options ?? {}) as {
    id?: unknown;
    color?: unknown;
    transparency?: unknown;
  };
  return {
    ...(id === undefined ? {} : { id }),
    ...(color === undefined ? {} : { color }),
    ...(transparency === undefined ? {} : { transparency }),
  };
}

/**
 * The shafts `to` names, as lists of points from each tip, unchecked: a point is one shaft of its
 * tip, and a list holds a shaft for each item, a point or a list of points. Anything else is no
 * shaft, which `leaderShaftsProblem` refuses.
 */
function shaftsOf(to: unknown): unknown {
  if (!Array.isArray(to)) return undefined;
  if (typeof to[0] === "number") return [[to]];
  return to.map((shaft: unknown) =>
    Array.isArray(shaft) && typeof shaft[0] === "number" ? [shaft] : shaft,
  );
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

/** A problem as a sentence of its own. */
function capitalized(problem: string): string {
  return problem.charAt(0).toUpperCase() + problem.slice(1);
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

/** A number the drawing keeps and the writers print, which the leading CAD app must be able to read. */
function kept(value: number, label: string): number {
  const problem = magnitudeProblem(num(value, label));
  if (problem) refuse("geometry", `${label}: ${problem}`);
  return value;
}

function pt(point: Point): Point {
  return [kept(point[0], "x"), kept(point[1], "y")];
}
