// What a dimension needs worked out: the keys of the handles of a dimension style, of an
// arrowhead's block and of the block of a dimension's picture, the text the leading CAD app writes
// for a measurement, and the lines, arrowheads and text that app draws for a dimension.
import type {
  AlignedDimension,
  AngularDimension,
  ArcLengthDimension,
  OrdinateDimension,
  DiameterDimension,
  DimensionStyle,
  Drawing,
  JoggedRadiusDimension,
  LinearDimension,
  Point,
  RadiusDimension,
  TextStyle,
} from "./drawing.ts";
import {
  arrowheadInfo,
  ARROWHEADS,
  DEFAULT_ARROWHEAD,
  isArrowhead,
  JOG_ANGLE,
  MAX_ANGLE_PRECISION,
  MAX_PRECISION,
  type Arrowhead,
} from "./arrowheads.ts";
import { blockHandles } from "./blocks.ts";
import { STANDARD_FONT } from "./fonts.ts";
import {
  layoutDimensionText,
  type ParagraphLayout,
  type ParagraphToMeasure,
} from "./paragraphs.ts";
import { heldNumber, written } from "./format.ts";
import { keyHandle } from "./handles.ts";
import { layerKey } from "./layers.ts";
import { direction } from "./polylines.ts";
import {
  arrowRoomProblem,
  DIMENSION_CENTERED_WIDE,
  DIMENSION_LEADER_ARROWS,
  DIMENSION_LEADER_BELOW,
  dimensionMeasureProblem,
  ANGULAR_ARC_LOST,
  ARC_LENGTH_INSIDE_SHORT,
  ARC_LENGTH_NO_ARC,
  ARC_LENGTH_NO_REACH,
  ARC_LENGTH_ON_ARC,
  ORDINATE_NO_LEADER,
  ARC_LENGTH_SYMBOL_BELOW,
  ANGULAR_ARC_ON_LINE,
  ANGULAR_ARROWS_LONG,
  ANGULAR_TAILS_MEET,
  arcProblem,
  ANGULAR_ARC_ON_POINT,
  ANGULAR_CENTERED_SHORT,
  ANGULAR_CENTERED_BELOW,
  ANGULAR_NO_ANGLE,
  ANGULAR_TEXT_OUT,
  ANGULAR_NO_ARC,
  ANGULAR_NO_SIDE,
  RADIAL_CENTERED,
  RADIAL_JOG_SHORT,
  RADIAL_NO_RADIUS,
  RADIAL_PLACED_LEVEL,
  RADIAL_PREFIX,
  dimensionStyleNameProblem,
  idKey,
  idProblem,
  integerDigits,
  layoutNameProblem,
  pictureNumberProblem,
} from "./rules.ts";

/** A dimension along a line: linear or aligned. */
export type StraightDimension = LinearDimension | AlignedDimension;

/** A dimension of a circle or an arc: a radius, a diameter or a jogged radius. */
export type RadialDimension = RadiusDimension | DiameterDimension | JoggedRadiusDimension;

/** A dimension of any kind. */
export type Dimension =
  | StraightDimension
  | RadialDimension
  | AngularDimension
  | ArcLengthDimension
  | OrdinateDimension;

/** Whether an entity is a dimension. */
export function isDimension<E extends { readonly kind: string }>(
  entity: E,
): entity is Extract<E, Dimension> {
  return (
    entity.kind === "linear-dimension" ||
    entity.kind === "aligned-dimension" ||
    entity.kind === "angular-dimension" ||
    entity.kind === "arc-length-dimension" ||
    entity.kind === "ordinate-dimension" ||
    isRadial(entity)
  );
}

/** Whether a dimension measures a circle or an arc. */
export function isRadial(dimension: { readonly kind: string }): dimension is RadialDimension {
  return (
    dimension.kind === "radius-dimension" ||
    dimension.kind === "diameter-dimension" ||
    dimension.kind === "jogged-radius-dimension"
  );
}

/**
 * A dimension style's name as its handle is keyed: A to Z in lower case and nothing else
 * changed, as `idKey` treats an id. The leading CAD app takes two names with one key for one style,
 * so the duplicate rule refuses the second. No table that can grow is part of
 * this, and it must never change.
 */
function dimensionStyleKey(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** `dimensionStyleHandle` for a name the dimension style rules have passed. */
export function validDimensionStyleHandle(name: string): string {
  return keyHandle(`dimension-style:${dimensionStyleKey(name)}`);
}

/**
 * The handle of a dimension style in an R2018 drawing. It comes from the style's name with A
 * to Z in lower case, so the style keeps it when the drawing around it changes.
 *
 * @throws RangeError when `name` is not a valid name for a dimension style.
 */
export function dimensionStyleHandle(name: string): string {
  const problem = dimensionStyleNameProblem(name);

  if (problem !== undefined) throw new RangeError(problem);

  return validDimensionStyleHandle(name);
}

/**
 * The handles of the block that holds a dimension's picture in an R2018 drawing, and of each
 * object in it: the block's record, the two objects that open and close its definition in a
 * DXF, the two extension lines, the dimension line, the two arrowheads and the text. An ordinate
 * dimension, which has no dimension line, takes its handle for the third line of a jogged leader.
 */
export interface DimensionPictureHandles {
  readonly record: string;
  readonly begin: string;
  readonly end: string;
  readonly extensionLines: readonly [string, string];
  readonly dimensionLine: string;
  readonly arrowheads: readonly [string, string];
  readonly text: string;
  /** The pieces of the dimension line: the first is `dimensionLine`. */
  readonly dimensionLines: readonly [string, string, string, string];
  /** The lines of the leader to a text moved outside. */
  readonly leader: readonly [string, string];
  /** The text below the dimension line. */
  readonly belowText: string;
  /** The pieces of an angular or arc length dimension's arc, and an arc length one's symbol. */
  readonly dimensionArcs: readonly [string, string, string, string];
}

/** Where a dimension is: its id, or else its place among the entities of its space. */
export interface DimensionPlace {
  readonly id?: string;
  /** The layout the dimension is on, or undefined for model space. */
  readonly layout?: string;
  /** Its index among the entities of model space or of its layout. */
  readonly index: number;
}

/** `dimensionPictureHandles` for a place the rules have passed. */
export function validDimensionPictureHandles(place: DimensionPlace): DimensionPictureHandles {
  // An id holds neither `@` nor `/`, and a layout's name holds no `/`.
  const who =
    place.id !== undefined
      ? idKey(place.id)
      : `@${place.layout === undefined ? "" : dimensionStyleKey(place.layout)}/${place.index}`;

  const handle = (part: string): string => keyHandle(`dimension-picture:${who}/${part}`);

  return {
    record: handle("record"),
    begin: handle("begin"),
    end: handle("end"),
    extensionLines: [handle("extension-1"), handle("extension-2")],
    dimensionLine: handle("dimension-line"),
    arrowheads: [handle("arrowhead-1"), handle("arrowhead-2")],
    text: handle("text"),
    dimensionLines: [
      handle("dimension-line"),
      handle("dimension-line-2"),
      handle("dimension-line-3"),
      handle("dimension-line-4"),
    ],
    leader: [handle("leader-1"), handle("leader-2")],
    belowText: handle("text-below"),
    dimensionArcs: [handle("arc-1"), handle("arc-2"), handle("arc-3"), handle("arc-4")],
  };
}

/**
 * What the picture of a dimension at `place` is called in a message about its handles, with
 * a name shown through `show`.
 */
export function pictureOwner(place: DimensionPlace, show: (name: string) => string): string {
  return place.id !== undefined
    ? `the picture of the dimension ${show(place.id)}`
    : `the picture of dimension #${place.index}${place.layout === undefined ? "" : ` of layout ${show(place.layout)}`}`;
}

/** Every handle of a dimension's picture, for claiming them. */
export function pictureHandleList(handles: DimensionPictureHandles): string[] {
  return [
    handles.record,
    handles.begin,
    handles.end,
    ...handles.extensionLines,
    handles.dimensionLine,
    ...handles.arrowheads,
    handles.text,
    ...handles.dimensionLines.slice(1),
    ...handles.leader,
    handles.belowText,
    ...handles.dimensionArcs,
  ];
}

/**
 * The handles of the block that holds a dimension's picture in an R2018 drawing, and of the
 * objects in it. They come from the dimension's id when it has one, with A to Z in lower case,
 * so the picture keeps them when the drawing around it changes. A dimension without an id
 * takes them from its place: its layout's name, with A to Z in lower case, and its index among
 * the entities there.
 *
 * @throws RangeError when the id is not a valid id, the layout's name is not a valid layout
 *   name, or the index is not a whole number from 0 up.
 */
export function dimensionPictureHandles(place: DimensionPlace): DimensionPictureHandles {
  const { id, layout, index } = place;

  const problem =
    id !== undefined ? idProblem(id) : layout !== undefined ? layoutNameProblem(layout) : undefined;

  if (problem !== undefined) throw new RangeError(problem);

  if (id === undefined && !(Number.isSafeInteger(index) && index >= 0)) {
    throw new RangeError("The index of a dimension is a whole number from 0 up");
  }

  return validDimensionPictureHandles(place);
}

/**
 * The dimension style a dimension of this name is in: the first whose name the leading CAD app's
 * style table would take for the same, so `dims` finds `DIMS`.
 */
export function findDimensionStyle(
  drawing: Pick<Drawing, "dimensionStyles">,
  name: string,
): DimensionStyle | undefined {
  const key = layerKey(name);

  return drawing.dimensionStyles?.find((style) => layerKey(style.name) === key);
}

/**
 * The handle of the one entity an arrowhead's block holds. The block's own three handles are
 * the ones `blockHandles` gives its name.
 */
export function arrowheadEntityHandle(block: string): string {
  return keyHandle(`arrowhead:${dimensionStyleKey(block)}`);
}

/**
 * The handles of the block the leading CAD app draws an arrowhead with, in an R2018 drawing: the
 * block's record, and the stroke it holds. They come from the block's name, so they are the same in
 * every drawing. Undefined for an arrowhead that has no block.
 *
 * @throws RangeError when `arrowhead` is not one of `ARROWHEADS`.
 */
export function arrowheadHandles(
  arrowhead: Arrowhead,
): { readonly record: string; readonly stroke: string } | undefined {
  const info = arrowheadInfo(arrowhead);

  if (info === undefined) {
    throw new RangeError(`An arrowhead must be one of ${Object.keys(ARROWHEADS).join(", ")}`);
  }

  if (info.block === undefined) return undefined;

  return { record: blockHandles(info.block).record, stroke: arrowheadEntityHandle(info.block) };
}

/** The arrowheads with a block that the drawing's dimension styles use, each once. */
export function arrowheadsWithBlocks(
  styles: readonly DimensionStyle[] | undefined,
): { readonly arrowhead: Arrowhead; readonly block: string }[] {
  const used = new Map<string, Arrowhead>();

  for (const style of styles ?? []) {
    const arrowhead = style.arrowhead ?? DEFAULT_ARROWHEAD;
    const block = arrowheadInfo(arrowhead)?.block;

    if (block !== undefined && isArrowhead(arrowhead) && !used.has(block))
      used.set(block, arrowhead);
  }

  return [...used].map(([block, arrowhead]) => ({ arrowhead, block }));
}

/** How a dimension style writes a measurement. */
export type MeasurementFormat = Pick<
  DimensionStyle,
  | "units"
  | "precision"
  | "prefix"
  | "suffix"
  | "suppressZeros"
  | "feetInchZeros"
  | "measurementScale"
  | "fraction"
  | "fractionScale"
>;

/**
 * How far below the half a value may lie and still be written as on it, as the leading CAD app
 * writes a measurement: a ten-billionth of the value under 1, and from 1 up a ten-billionth and one
 * and a half units in the 16th significant digit, which grows with each power of ten.
 */
function belowHalf(value: number): number {
  return value < 1 ? 1e-10 * value : 1e-10 + 1.5 * 10 ** (integerDigits(value) - 16);
}

/**
 * A length as the leading CAD app writes it in decimal units, before any prefix or suffix: times
 * the style's measurement scale, with `precision` decimals, and without the zeros the style leaves
 * out. That app rounds half up, and takes a value a little below the half as on it: within a
 * ten-billionth of the value under 1, and from 1 up within a ten-billionth and one and a half
 * units in the 16th significant digit. So 52.15, which a computer holds as a little less, is
 * written `52.2` at a precision of 1, and so is 1234567.15.
 *
 * @param length - What the dimension measures, in drawing units, not negative.
 */
export function measurementNumber(length: number, format: MeasurementFormat): string {
  if (format.units === "architectural") return feetAndInches(length, format);
  let text = roundedMeasurement(length, format);
  const suppress = format.suppressZeros;

  if ((suppress === "trailing" || suppress === "both") && text.includes(".")) {
    text = text.replace(/0+$/, "").replace(/\.$/, "");
  }

  if ((suppress === "leading" || suppress === "both") && text.startsWith("0.")) {
    text = text.slice(1);
  }

  return text;
}

/**
 * A length times the style's measurement scale, rounded as `measurementNumber` rounds it, with
 * every decimal of the style's precision and before any zero is left out. In architectural
 * units it is the whole inches, which is all the rules hold of such a measurement's digits.
 */
export function roundedMeasurement(length: number, format: MeasurementFormat): string {
  const value = Math.abs(length) * written(format.measurementScale ?? 1);

  if (format.units === "architectural") {
    const [steps, per] = fractionSteps(value, format.precision);

    return String(Math.floor(steps / per));
  }

  return (value + belowHalf(value)).toFixed(precisionOf(format.precision));
}

/** A precision the rules refuse is drawn as the nearest one they take. */
function precisionOf(precision: number): number {
  return Math.min(MAX_PRECISION, Math.max(0, Math.trunc(precision) || 0));
}

/**
 * A length in inches rounded to the least fraction of a precision, as the count of those
 * fractions and how many make an inch. It is rounded half up as a decimal measurement is, with
 * the same tolerance below the half.
 */
function fractionSteps(inches: number, precision: number): readonly [steps: number, per: number] {
  const per = 2 ** precisionOf(precision);
  const value = inches * per;

  return [Math.floor(value + 0.5 + belowHalf(value + 0.5)), per];
}

/** `DIMZIN` from 0 to 3 for each choice of the zeros a length in feet and inches writes. */
export const FEET_INCH_ZEROS_CODES = { neither: 0, both: 1, feet: 2, inches: 3 } as const;

/**
 * A length as the leading CAD app writes it in architectural units, before any prefix or suffix:
 * times the style's measurement scale, as inches, rounded to the least fraction of the style's
 * precision and written as feet, a hyphen, inches and the fraction in lowest terms after a space,
 * with the inch mark: `4'-1 7/16"`. A length under a foot drops its feet and one of whole feet its
 * inches, unless `feetInchZeros` writes that zero: the default, `"inches"`, writes `4'-0"` and
 * `6"`. A length of less than an inch writes no zero inches before its fraction, as `1/2"`, unless
 * its feet are written: `0'-0 1/2"`.
 *
 * @param length - What the dimension measures, in drawing units, not negative.
 */
export function feetAndInches(length: number, format: MeasurementFormat): string {
  const value = Math.abs(length) * written(format.measurementScale ?? 1);
  const [steps, per] = fractionSteps(value, format.precision);
  const feet = Math.floor(steps / (12 * per));
  const rest = steps - feet * 12 * per;
  const inches = Math.floor(rest / per);
  let numerator = rest - inches * per;
  let denominator = per;

  while (numerator > 0 && numerator % 2 === 0) {
    numerator /= 2;
    denominator /= 2;
  }

  const zeros = format.feetInchZeros ?? "inches";
  const zeroFeet = zeros === "feet" || zeros === "both";
  const zeroInches = zeros === "inches" || zeros === "both";
  const stacked = format.fraction === "stacked" || format.fraction === "diagonal";

  // A stack is written at the style's share of the height, and follows the inches with no space.
  const fraction =
    numerator === 0
      ? ""
      : stacked
        ? `{\\H${written(format.fractionScale ?? 1)}x;\\S${numerator}${format.fraction === "stacked" ? "/" : "#"}${denominator};}`
        : `${numerator}/${denominator}`;

  const showFeet = feet > 0 || zeroFeet;
  const showInches = rest > 0 || zeroInches || !showFeet;

  const inchText =
    fraction === ""
      ? String(inches)
      : inches > 0 || showFeet
        ? `${inches}${stacked ? "" : " "}${fraction}`
        : fraction;

  if (!showFeet) return `${inchText}"`;

  return showInches ? `${feet}'-${inchText}"` : `${feet}'`;
}

/**
 * The text the leading CAD app draws for a dimension: the measurement with the style's prefix and
 * suffix, or the dimension's own text, in which the first `<>` stands for that.
 *
 * @param length - What the dimension measures, in drawing units.
 * @param text - The dimension's own text, when it has one.
 */
export function measurementText(length: number, format: MeasurementFormat, text?: string): string {
  const measured = `${format.prefix ?? ""}${measurementNumber(length, format)}${format.suffix ?? ""}`;

  if (text === undefined) return measured;
  const at = text.indexOf("<>");

  return at < 0 ? text : `${text.slice(0, at)}${measured}${text.slice(at + 2)}`;
}

/**
 * The text a dimension holds in its file: its own text, and the words below its line after `\\X`,
 * which the leading CAD app reads as the start of the part below.
 */
export function dimensionFileText(
  dimension: Pick<LinearDimension, "text" | "textBelow">,
): string | undefined {
  if (dimension.textBelow === undefined) return dimension.text;

  return `${dimension.text ?? "<>"}\\X${dimension.textBelow}`;
}

/**
 * What a dimension draws above its line and below it: its text with the first `<>` standing for
 * the measurement, cut at the first `\\X`. Undefined below when it has no words there.
 */
export function dimensionTexts(
  dimension: Pick<LinearDimension, "text" | "textBelow">,
  length: number,
  format: MeasurementFormat,
): readonly [above: string, below: string | undefined] {
  const drawn = measurementText(length, format, dimensionFileText(dimension));
  const at = drawn.indexOf("\\X");

  return at < 0 ? [drawn, undefined] : [drawn.slice(0, at), drawn.slice(at + 2)];
}

/**
 * The value of the MTEXT a dimension's picture draws for a text: with the code that centers what
 * is stacked in it, as the leading CAD app writes it.
 */
export function mtextOfLabel(value: string): string {
  return `\\A1;${value}`;
}

/** The text of a dimension as the leading CAD app draws it, and where. */
export interface DimensionLabel {
  /** What it reads, with the codes of a paragraph's value, such as a stacked fraction's. */
  readonly value: string;
  /** The middle of the text's baseline. */
  readonly at: Point;
  /** The height of its capitals, in the units of the dimension's space. */
  readonly height: number;
  /** Degrees counterclockwise, from above -90 up to 90, so that the text reads upright. */
  readonly rotation: number;
  /** The unit vector along the text: its rotation, exact along the axes. */
  readonly direction: Point;
  /** The text style, unless it is `Standard`. */
  readonly style?: string;
}

/** How the block of a dimension's picture draws one arrowhead. */
export type ArrowheadEntity =
  | {
      /** A filled triangle: the two corners of its base, then its tip. */
      readonly kind: "solid";
      readonly corners: readonly [Point, Point, Point];
    }
  | {
      /** An insert of the arrowhead's block on the end of the dimension line. */
      readonly kind: "insert";
      readonly block: string;
      readonly at: Point;
      /** Degrees counterclockwise, from 0 up to 360. */
      readonly rotation: number;
      readonly scale: number;
    };

/**
 * What the leading CAD app draws for a dimension, in the coordinates of the dimension's space, with
 * every number of the dimension and of its style taken as the writers write it.
 */
export interface DimensionPicture {
  /** What the dimension measures, in drawing units, before the style's measurement scale. */
  readonly measurement: number;
  /**
   * The point the file holds for the dimension line: the foot of the second point on it, as
   * written.
   */
  readonly definitionPoint: Point;
  /** The two extension lines, each from near its point to past the dimension line. */
  readonly extensionLines: readonly (readonly [Point, Point])[];
  /** The whole dimension line, between the arrowheads or through the ticks. */
  readonly dimensionLine: readonly [Point, Point];
  /**
   * The pieces of the dimension line it draws: the whole line, or one piece each side of a text
   * centered in a break of it.
   */
  readonly dimensionLines: readonly (readonly [Point, Point])[];
  /** The lines of the leader to a text moved outside the extension lines. Empty for none. */
  readonly leader: readonly (readonly [Point, Point])[];
  /** The pieces of an angular dimension's arc. Empty for a dimension of any other kind. */
  readonly dimensionArcs: readonly DimensionArc[];
  /** The outline of each arrowhead, which is filled. None for an arrow size of 0. */
  readonly arrowheads: readonly (readonly Point[])[];
  /**
   * The entity that draws each arrowhead in the block of the dimension's picture, as the leading
   * CAD app writes it: a filled triangle, or an insert of the arrowhead's block. None for an arrow
   * size of 0.
   */
  readonly arrowheadEntities: readonly ArrowheadEntity[];
  readonly label: DimensionLabel;
  /** The middle of the text's box. */
  readonly textMiddle: Point;
  /**
   * The point a file holds beside the dimension for its text: the middle of the text's box, or
   * the middle of the dimension line where words stand below it.
   */
  readonly textPoint: Point;
  /** How wide the text is drawn, the wider of the texts above and below the line. */
  readonly textWidth: number;
  /** The words below the dimension line, and the middle of their box. */
  readonly below?: { readonly label: DimensionLabel; readonly middle: Point };
  /**
   * The lineweight of the dimension line, its arrowheads and its leader, and of the extension
   * lines, as group 370 holds it: -2 ByBlock, or hundredths of a millimetre.
   */
  readonly lineweights: { readonly dimension: number; readonly extension: number };
}

/** A piece of an arc: its center, its radius, and the degrees it runs counterclockwise between. */
export interface DimensionArc {
  readonly center: Point;
  readonly radius: number;
  readonly start: number;
  readonly end: number;
}

/** The points of an arc's piece that bound it: its ends, and its points furthest along each axis. */
export function dimensionArcPoints(arc: DimensionArc): Point[] {
  const sweep = (((arc.end - arc.start) % 360) + 360) % 360;
  const out: Point[] = [];

  for (const degrees of [arc.start, arc.end, 0, 90, 180, 270]) {
    const past = (((degrees - arc.start) % 360) + 360) % 360;

    if (degrees !== arc.start && degrees !== arc.end && past > sweep) continue;
    const [x, y] = direction(degrees);
    out.push([arc.center[0] + x * arc.radius, arc.center[1] + y * arc.radius]);
  }

  return out;
}

/** A style's lineweight as group 370 holds it: ByBlock where it gives none. */
function lineweightCode(weight: number | undefined): number {
  if (weight === undefined) return -2;

  return Math.round(weight * 100);
}

/** The font of a dimension's text style, `Standard` where it has none, as its text is laid out. */
export type DimensionFont = Pick<TextStyle, "font" | "widthFactor" | "obliqueAngle">;

/**
 * Each text a dimension's picture draws, as the paragraph its block holds: the text over the line,
 * and the words below it. Each is laid out by `layoutDimensionText`, centered on its point.
 */
export function pictureTexts(
  picture: Pick<DimensionPicture, "label" | "textMiddle" | "below">,
  font: DimensionFont | undefined,
): ParagraphToMeasure[] {
  const one = (label: DimensionLabel, at: Point, value: string): ParagraphToMeasure => ({
    value,
    height: label.height,
    font: font?.font ?? STANDARD_FONT,
    widthFactor: written(font?.widthFactor ?? 1),
    obliqueAngle: written(font?.obliqueAngle ?? 0),
    at,
    rotation: label.rotation,
    align: "center",
    valign: "middle",
  });

  const below = picture.below;

  return [
    one(picture.label, picture.textMiddle, mtextOfLabel(picture.label.value)),
    ...(below === undefined
      ? []
      : [
          one(
            below.label,
            below.middle,
            below.label.value === "" ? "" : mtextOfLabel(below.label.value),
          ),
        ]),
  ];
}

const RADIANS = Math.PI / 180;

/** A direction in degrees turned into the one of the two along its line that reads upright. */
function readable(degrees: number): number {
  let angle = degrees % 360;

  if (angle > 180) angle -= 360;

  if (angle <= -180) angle += 360;

  if (angle > 90) return angle - 180;

  if (angle <= -90) return angle + 180;

  return angle;
}

/** The sizes of a dimension style in the units of the dimension's space. */
export interface DimensionSizes {
  readonly textHeight: number;
  readonly arrowSize: number;
  readonly extensionOffset: number;
  readonly extensionBeyond: number;
  readonly textGap: number;
  /** How far a tick's dimension line runs past an extension line, `DIMDLE`. */
  readonly lineExtension: number;
}

/** The sizes of a dimension style in the units of the dimension's space: each times the scale. */
export function dimensionSizes(style: DimensionStyle): DimensionSizes {
  const scale = written(style.scale ?? 1);

  return {
    textHeight: written(style.textHeight) * scale,
    arrowSize: written(style.arrowSize) * scale,
    extensionOffset: written(style.extensionOffset) * scale,
    extensionBeyond: written(style.extensionBeyond) * scale,
    textGap: written(style.textGap) * scale,
    lineExtension: written(style.lineExtension ?? style.arrowSize) * scale,
  };
}

/**
 * The angle a linear dimension measures along, as the writers write it: in degrees from 0 up
 * to 360, with 6 decimals. The rules take an angle from -360 to 360, and this turns one into
 * the same direction less than a turn, so -90 and 270 are one angle.
 */
export function dimensionAngle(dimension: Pick<LinearDimension, "angle">): number {
  const turned = ((written(dimension.angle ?? 0) % 360) + 360) % 360;

  return written(turned) === 360 ? 0 : written(turned);
}

/** What a dimension measures, and the angle it measures along. */
export interface DimensionMeasure {
  readonly angle: number;
  readonly measurement: number;
}

/**
 * The direction a dimension measures along, in degrees, and what it measures: for a linear
 * dimension the distance between its two points along its angle, and for an aligned one the
 * distance between them; for an ordinate one its axis, 0 for X and 90 for Y, and the distance
 * along it from its origin, without its sign. Every number is taken as the writers write it.
 */
export function dimensionMeasure(dimension: Dimension): DimensionMeasure {
  if (dimension.kind === "angular-dimension") {
    const { start, sweep } = angularArc(dimension);

    return { angle: start + sweep / 2, measurement: sweep * RADIANS };
  }

  if (dimension.kind === "arc-length-dimension") {
    const { start, sweep, radius } = arcLengthArc(dimension);

    return { angle: start + sweep / 2, measurement: radius * sweep * RADIANS };
  }

  if (dimension.kind === "ordinate-dimension") {
    // Along its axis, and the distance along it from the origin, without its sign.
    const i = dimension.axis === "x" ? 0 : 1;

    return {
      angle: i === 0 ? 0 : 90,
      measurement: Math.abs(written(dimension.feature[i]) - written(dimension.origin[i])),
    };
  }

  if (isRadial(dimension)) {
    const [x1, y1] = [written(dimension.center[0]), written(dimension.center[1])];
    const [x2, y2] = [written(dimension.point[0]), written(dimension.point[1])];
    const radius = Math.hypot(x2 - x1, y2 - y1);

    return {
      angle: Math.atan2(y2 - y1, x2 - x1) / RADIANS,
      measurement: dimension.kind === "diameter-dimension" ? 2 * radius : radius,
    };
  }

  const [x1, y1] = [written(dimension.from[0]), written(dimension.from[1])];
  const [x2, y2] = [written(dimension.to[0]), written(dimension.to[1])];

  if (dimension.kind === "aligned-dimension") {
    return {
      angle: Math.atan2(y2 - y1, x2 - x1) / RADIANS,
      measurement: Math.hypot(x2 - x1, y2 - y1),
    };
  }

  const angle = dimensionAngle(dimension);
  const [cos, sin] = direction(angle);

  return { angle, measurement: Math.abs((x2 - x1) * cos + (y2 - y1) * sin) };
}

/**
 * What the leading CAD app draws for a dimension in a style, for a dimension and a style the rules
 * have passed. The dimension line runs through the definition point along the direction measured.
 * Each extension line starts the style's offset from its point, on the side of the dimension
 * line, and ends the style's length beyond that line. The text is centered between the
 * extension lines, one gap above the dimension line as the text reads, and turned to read
 * from below or from the right. A closed filled arrowhead points outward from between the
 * extension lines, and a tick is centered on the end of the dimension line, which then runs
 * one arrow size past each extension line.
 *
 * @param style - The dimension's style.
 */
export function dimensionPicture(
  dimension: Dimension,
  given: DimensionStyle,
  textStyle?: DimensionFont,
): DimensionPicture {
  // A dimension's own scale is its override of its style's.
  const style = dimension.scale === undefined ? given : { ...given, scale: dimension.scale };

  if (isRadial(dimension)) return radialPicture(dimension, style, textStyle);

  if (dimension.kind === "angular-dimension") return angularPicture(dimension, style, textStyle);

  if (dimension.kind === "arc-length-dimension")
    return arcLengthPicture(dimension, style, textStyle);

  if (dimension.kind === "ordinate-dimension") return ordinatePicture(dimension, style, textStyle);
  const from: Point = [written(dimension.from[0]), written(dimension.from[1])];
  const to: Point = [written(dimension.to[0]), written(dimension.to[1])];
  const { angle, measurement } = dimensionMeasure(dimension);
  const aligned = dimension.kind === "aligned-dimension";
  // Along the direction measured, and across it to the left.
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);

  const along: Point =
    aligned && length > 0
      ? [(to[0] - from[0]) / length, (to[1] - from[1]) / length]
      : direction(aligned ? 0 : angle);

  const across: Point = [-along[1], along[0]];

  const offsetTo = (point: Point, through: Point): number =>
    (through[0] - point[0]) * across[0] + (through[1] - point[1]) * across[1];

  const move = (point: Point, by: Point, distance: number): Point => [
    point[0] + by[0] * distance,
    point[1] + by[1] * distance,
  ];

  // The file holds the foot of the second point on the dimension line, with 6 decimals.
  const through: Point = aligned
    ? move(to, across, written(dimension.offset))
    : [written(dimension.line[0]), written(dimension.line[1])];

  const foot = move(to, across, offsetTo(to, through));
  const definitionPoint: Point = [written(foot[0]), written(foot[1])];

  const sizes = dimensionSizes(style);
  const feet = [from, to].map((point) => move(point, across, offsetTo(point, definitionPoint)));
  const first = feet[0]!;
  const second = feet[1]!;

  const extensionLines = [from, to].map((point, i): [Point, Point] => {
    const side = offsetTo(point, definitionPoint) >= 0 ? 1 : -1;

    return [
      move(point, across, side * sizes.extensionOffset),
      move(feet[i]!, across, side * sizes.extensionBeyond),
    ];
  });

  // From the first foot to the second, which is against `along` when the points are given
  // from the far end.
  const span = Math.hypot(second[0] - first[0], second[1] - first[1]);

  const run: Point =
    span > 0 ? [(second[0] - first[0]) / span, (second[1] - first[1]) / span] : along;

  const side: Point = [-run[1], run[0]];
  const size = sizes.arrowSize;
  const info = arrowheadInfo(style.arrowhead ?? DEFAULT_ARROWHEAD);
  const stroke = info?.stroke;
  const tick = stroke !== undefined;

  const rotation = readable(angle);
  const up: Point = [-Math.sin(rotation * RADIANS), Math.cos(rotation * RADIANS)];
  const quarter = direction(rotation);
  const above: Point = rotation % 90 === 0 ? [-quarter[1], quarter[0]] : up;
  const middle: Point = [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
  const [aboveText, belowText] = dimensionTexts(dimension, measurement, style);
  // Each text is laid out as the paragraph the picture holds, centered on the middle of its box.
  const font = textStyle?.font ?? STANDARD_FONT;

  const lay = (value: string): ParagraphLayout =>
    layoutDimensionText({
      value,
      height: sizes.textHeight,
      font,
      widthFactor: written(textStyle?.widthFactor ?? 1),
      obliqueAngle: written(textStyle?.obliqueAngle ?? 0),
      align: "center",
      valign: "middle",
    });

  const boxHeight = (layout: ParagraphLayout): number => layout.frame[3] - layout.frame[1];

  const widest = (layout: ParagraphLayout): number =>
    layout.lines.reduce((most, line) => Math.max(most, line.end - line.start), 0);

  const topLayout = lay(mtextOfLabel(aboveText));

  const belowLayout =
    belowText === undefined ? undefined : lay(belowText === "" ? "" : mtextOfLabel(belowText));

  const centered = style.textPlacement === "centered";
  const textWidth = Math.max(widest(topLayout), belowLayout ? widest(belowLayout) : 0);

  // The arrowheads stay between the extension lines while they and the text fit there: a text in
  // the line takes its room from theirs, and one above it needs only its own, beside arrows that
  // need theirs and ticks that need none.
  const fits = centered
    ? span >= textWidth + 2 * size
    : (tick || span > 2 * size + 2 * sizes.textGap) && textWidth <= span - 2 * sizes.textGap;

  // With a leader, a text that has no room of its own between the extension lines moves out, and
  // the ticks then turn outward only where the line is shorter than two gaps.
  const leaderFit = style.textFit === "leader";
  const textOut = leaderFit && textWidth + 2 * sizes.textGap > span;

  // Ticks that do not fit turn outward, and the dimension line breaks at each of them. Where a
  // text may move out, one that stays turns them only in the line, where they and it need room.
  const outward =
    tick &&
    (textOut
      ? // A line two gaps long, as its points are written, is taken as long as two gaps.
        span + 1e-6 < 2 * sizes.textGap
      : leaderFit
        ? centered && (span < textWidth + 2 * size || span <= 2 * size + 2 * sizes.textGap)
        : !fits);

  const arrowheads: Point[][] = [];
  const arrowheadEntities: ArrowheadEntity[] = [];
  // The direction of the dimension line, from the first foot to the second.
  const runAngle = Math.atan2(run[1], run[0]) / RADIANS;

  if (size > 0) {
    for (const [tip, inward] of [
      [first, 1],
      [second, -1],
    ] as const) {
      if (tick) {
        // The block points along the line at the second end, and back along it at the first,
        // and the other way when the ticks turn outward.
        const turned = runAngle + (inward > 0 !== outward ? 180 : 0);
        arrowheadEntities.push({
          kind: "insert",
          block: info!.block!,
          at: tip,
          rotation: ((turned % 360) + 360) % 360,
          scale: size,
        });
        // The block's stroke runs from one corner of a square around the point to the other.
        const half = move(move([0, 0], run, stroke.to[0] * size), side, stroke.to[1] * size);
        const wide = (stroke.width * size) / 2 / Math.SQRT2;
        const edge: Point = [(run[0] - side[0]) * wide, (run[1] - side[1]) * wide];
        arrowheads.push([
          [tip[0] - half[0] + edge[0], tip[1] - half[1] + edge[1]],
          [tip[0] + half[0] + edge[0], tip[1] + half[1] + edge[1]],
          [tip[0] + half[0] - edge[0], tip[1] + half[1] - edge[1]],
          [tip[0] - half[0] - edge[0], tip[1] - half[1] - edge[1]],
        ]);
      } else {
        const base = move(tip, run, inward * size);
        arrowheads.push([tip, move(base, side, size / 6), move(base, side, -size / 6)]);
        // The leading CAD app gives the corner to the left of the direction measured first.
        arrowheadEntities.push({
          kind: "solid",
          corners: [move(base, across, size / 6), move(base, across, -size / 6), tip],
        });
      }
    }
  }

  // A tick's dimension line runs past the extension lines, and an arrow's stops at its base.
  const reach = tick ? sizes.lineExtension : -size;
  const dimensionLine: [Point, Point] = [move(first, run, -reach), move(second, run, reach)];

  // A text centered in the line sits on it, unless words below take the other side: then each
  // stands a gap off the line, as a text above it does.
  let textMiddle =
    centered && belowLayout === undefined
      ? middle
      : move(middle, above, sizes.textGap + boxHeight(topLayout) / 2);

  let textPoint = belowLayout === undefined ? textMiddle : middle;

  const belowMiddle =
    belowLayout && move(middle, above, -(sizes.textGap + boxHeight(belowLayout) / 2));

  // The inner part of the line: between the ticks that turned outward, or the whole line.
  const inner: readonly [Point, Point] = outward ? [first, second] : dimensionLine;

  const dimensionLines: (readonly [Point, Point])[] = outward
    ? [
        [first, dimensionLine[0]],
        [second, dimensionLine[1]],
      ]
    : [];

  const leader: (readonly [Point, Point])[] = [];

  if (textOut) {
    // The leader leaves the middle of the dimension line away from the points, leaning a tenth
    // of three toward where the text reads, to an elbow past the extension lines' reach and a
    // gap and a half, and the box of the text, more where the text reads from the other side.
    const away: Point = offsetTo(to, definitionPoint) >= 0 ? across : [-across[0], -across[1]];
    const half = boxHeight(topLayout) / 2;
    const facing = above[0] * away[0] + above[1] * away[1] > 0;
    const rise = sizes.extensionBeyond + 1.5 * sizes.textGap + (facing ? half : 3 * half);
    const elbow = move(move(middle, away, rise), quarter, 0.3 * rise);
    // Above the line the text stands over a landing as long as it and a gap each side; centered,
    // it follows a landing two gaps long.
    const landing = centered ? 2 * sizes.textGap : textWidth + 2 * sizes.textGap;
    leader.push([middle, elbow], [elbow, move(elbow, quarter, landing)]);
    const start = move(elbow, quarter, centered ? landing + sizes.textGap : sizes.textGap);
    textPoint = centered ? start : move(start, above, sizes.textGap + half);
    textMiddle = move(textPoint, quarter, textWidth / 2);
    // The whole line between the ticks, which a line shorter than two gaps draws twice.
    dimensionLines.push(inner, ...(outward ? [inner] : []));
  } else if (centered) {
    // The line breaks a gap either side of the wider text.
    const half = sizes.textGap + textWidth / 2;
    dimensionLines.push([inner[0], move(middle, run, -half)], [inner[1], move(middle, run, half)]);
  } else dimensionLines.push(inner);
  const textStyleName = style.textStyle;

  const label = (value: string, at: Point, layout: ParagraphLayout): DimensionLabel =>
    styledLabel(
      {
        value,
        at: move(at, above, layout.lines[0]?.baseline ?? 0),
        height: sizes.textHeight,
        rotation,
        direction: quarter,
      },
      textStyleName,
    );

  return {
    measurement,
    definitionPoint,
    extensionLines,
    dimensionLine,
    dimensionLines,
    leader,
    dimensionArcs: [],
    arrowheads,
    arrowheadEntities,
    label: label(aboveText, textMiddle, topLayout),
    textMiddle,
    textPoint,
    textWidth,
    ...(belowLayout &&
      belowMiddle && {
        below: { label: label(belowText!, belowMiddle, belowLayout), middle: belowMiddle },
      }),
    lineweights: {
      dimension: lineweightCode(style.dimensionLineweight),
      extension: lineweightCode(style.extensionLineweight),
    },
  };
}

/** The leader of an ordinate dimension, as the writers write it. */
export interface OrdinateLeader {
  readonly feature: Point;
  readonly end: Point;
  readonly length: number;
  readonly along: Point;
  readonly across: number;
  readonly jogged: boolean;
}

/**
 * Where an ordinate dimension's feature and leader end are, how far along its leader the end is
 * from the feature, the direction from one to the other along it, how far across the end is, and
 * whether the leader jogs, each in the numbers the leading CAD app holds for the written
 * coordinates, as `heldNumber` reads them: two that are written apart may be held as one. A leader whose end is held level with its feature runs
 * back, and one held across by no more than 1e-10 of the feature's coordinate that the dimension
 * gives, in the drawing and not from the dimension's origin, is drawn straight. At exactly that in
 * decimals the difference falls a hair to either side: 0.00001 at 100000 jogs, and 0.0001 at
 * 1000000 and 0.000003 at 30000 are straight.
 */
export function ordinateLeader(dimension: OrdinateDimension): OrdinateLeader {
  // The leader is laid out in the numbers that app holds, so each point it places is one that
  // app would place, and each choice is made from the numbers the point is placed from.
  const feature: Point = [heldNumber(dimension.feature[0]), heldNumber(dimension.feature[1])];
  const end: Point = [heldNumber(dimension.leaderEnd[0]), heldNumber(dimension.leaderEnd[1])];
  const x = dimension.axis === "x";
  const run = x ? end[1] - feature[1] : end[0] - feature[0];
  const across = x ? end[0] - feature[0] : end[1] - feature[1];
  // A leader's end level with its feature runs the leader back: down, or to the left.
  const way = run > 0 ? 1 : -1;

  return {
    feature,
    end,
    length: Math.abs(run),
    along: x ? [0, way] : [way, 0],
    across,
    jogged: Math.abs(across) > 1e-10 * Math.abs(x ? feature[0] : feature[1]),
  };
}

/**
 * The picture of an ordinate dimension: its leader from the style's offset off the feature, and
 * where it jogs a jog across, from twice the arrow size along the leader, or from four arrow sizes
 * short of the end where that is further, to two arrow sizes short of the end; then on past the
 * end under the text, which stands a gap beyond the end along the leader, read along it, a gap
 * above it. A leader that does not jog is one line, from the feature's side to the end's. Centered,
 * the leader stops at the end and the text stands on its line. The leader's lines take the
 * extension lines' lineweight.
 */
function ordinatePicture(
  dimension: OrdinateDimension,
  style: DimensionStyle,
  textStyle: DimensionFont | undefined,
): DimensionPicture {
  const { measurement } = dimensionMeasure(dimension);
  const sizes = dimensionSizes(style);
  const { feature, end, length, along, jogged } = ordinateLeader(dimension);
  const x = dimension.axis === "x";

  // A point `t` along the leader from the feature and `off` across it.
  const at = (t: number, off: number): Point =>
    x
      ? [feature[0] + off, feature[1] + along[1] * t]
      : [feature[0] + along[0] * t, feature[1] + off];

  const move = (point: Point, by: Point, distance: number): Point => [
    point[0] + by[0] * distance,
    point[1] + by[1] * distance,
  ];

  const rotation = x ? 90 : 0;
  const direction: Point = x ? [0, 1] : [1, 0];
  const above: Point = x ? [-1, 0] : [0, 1];
  const [aboveText, belowText] = dimensionTexts(dimension, measurement, style);
  const font = textStyle?.font ?? STANDARD_FONT;

  const lay = (value: string): ParagraphLayout =>
    layoutDimensionText({
      value,
      height: sizes.textHeight,
      font,
      widthFactor: written(textStyle?.widthFactor ?? 1),
      obliqueAngle: written(textStyle?.obliqueAngle ?? 0),
      align: "center",
      valign: "middle",
    });

  const boxHeight = (layout: ParagraphLayout): number => layout.frame[3] - layout.frame[1];

  const widest = (layout: ParagraphLayout): number =>
    layout.lines.reduce((most, line) => Math.max(most, line.end - line.start), 0);

  const topLayout = lay(mtextOfLabel(aboveText));

  const belowLayout =
    belowText === undefined ? undefined : lay(belowText === "" ? "" : mtextOfLabel(belowText));

  const textWidth = Math.max(widest(topLayout), belowLayout ? widest(belowLayout) : 0);
  const centered = style.textPlacement === "centered";
  const gap = sizes.textGap;
  // The leader's line through the text, beyond its end.
  const point = move(end, along, gap + textWidth / 2);
  const offset = sizes.extensionOffset;
  const size = sizes.arrowSize;
  // A point that lies a distance from the end is placed from the end, and one on the feature's
  // line from where the end stands across from it, which a far feature's arithmetic could lose.
  const past = move(end, along, centered ? 0 : gap + textWidth);
  const jogEnd = move(end, along, -2 * size);

  const jogStart =
    length - 4 * size >= 2 * size
      ? move(x ? [feature[0], end[1]] : [end[0], feature[1]], along, -4 * size)
      : at(2 * size, 0);

  const extensionLines: (readonly [Point, Point])[] = !jogged
    ? [[at(offset, 0), past]]
    : [
        [at(offset, 0), jogStart],
        [jogStart, jogEnd],
        [jogEnd, past],
      ];

  const textMiddle =
    centered && belowLayout === undefined
      ? point
      : move(point, above, gap + boxHeight(topLayout) / 2);

  const belowMiddle = belowLayout && move(point, above, -(gap + boxHeight(belowLayout) / 2));
  const textStyleName = style.textStyle;

  const label = (value: string, middle: Point, layout: ParagraphLayout): DimensionLabel =>
    styledLabel(
      {
        value,
        at: move(middle, above, layout.lines[0]?.baseline ?? 0),
        height: sizes.textHeight,
        rotation,
        direction,
      },
      textStyleName,
    );

  const last = extensionLines[extensionLines.length - 1]!;

  return {
    measurement,
    definitionPoint: [written(dimension.origin[0]), written(dimension.origin[1])],
    extensionLines,
    dimensionLine: [last[0], last[1]],
    dimensionLines: [],
    leader: [],
    dimensionArcs: [],
    arrowheads: [],
    arrowheadEntities: [],
    label: label(aboveText, textMiddle, topLayout),
    textMiddle,
    textPoint: belowLayout === undefined ? textMiddle : point,
    textWidth,
    ...(belowLayout &&
      belowMiddle && {
        below: { label: label(belowText!, belowMiddle, belowLayout), middle: belowMiddle },
      }),
    lineweights: {
      dimension: lineweightCode(style.dimensionLineweight),
      extension: lineweightCode(style.extensionLineweight),
    },
  };
}

/** What the leading CAD app writes before a radial dimension's measurement. */
export const RADIAL_PREFIXES = {
  "radius-dimension": "R",
  "diameter-dimension": "\u2205",
  "jogged-radius-dimension": "R",
} as const;

/** A style's way of writing a radial dimension's measurement: with the prefix of its kind. */
export function radialFormat(
  dimension: Pick<RadialDimension, "kind">,
  style: DimensionStyle,
): MeasurementFormat {
  // The fields a measurement's writing reads, and no others: a style may hold any number.
  const { units, precision, suffix, suppressZeros, feetInchZeros, measurementScale } = style;
  const { fraction, fractionScale } = style;

  // SAFETY: each field is the style's, and one the style leaves out is undefined, which the
  // writing reads as left out.
  return {
    units,
    precision,
    prefix: `${RADIAL_PREFIXES[dimension.kind]}${style.prefix ?? ""}`,
    suffix,
    suppressZeros,
    feetInchZeros,
    measurementScale,
    fraction,
    fractionScale,
  } as MeasurementFormat;
}

/**
 * What the leading CAD app draws for a radius, a diameter or a jogged radius dimension in a style.
 * Its line runs from the center through the point of the circle, and on through the center to the
 * point opposite for a diameter. Its text stands outside the circle past the arrowhead, along the
 * line or level on a landing, unless the dimension places it along the line; a jogged one's stands
 * along the last stretch, inside the arc. The arrowhead points at the circle from the side the text
 * is on.
 */
function radialPicture(
  dimension: RadialDimension,
  style: DimensionStyle,
  textStyle: DimensionFont | undefined,
): DimensionPicture {
  const center: Point = [written(dimension.center[0]), written(dimension.center[1])];
  const point: Point = [written(dimension.point[0]), written(dimension.point[1])];
  const { angle, measurement } = dimensionMeasure(dimension);
  const radius = Math.hypot(point[0] - center[0], point[1] - center[1]);

  const u: Point =
    radius > 0 ? [(point[0] - center[0]) / radius, (point[1] - center[1]) / radius] : [1, 0];

  const left: Point = [-u[1], u[0]];

  const move = (from: Point, by: Point, distance: number): Point => [
    from[0] + by[0] * distance,
    from[1] + by[1] * distance,
  ];

  const at = (distance: number): Point => move(center, u, distance);
  const sizes = dimensionSizes(style);
  const size = sizes.arrowSize;
  const gap = sizes.textGap;
  const info = arrowheadInfo(style.arrowhead ?? DEFAULT_ARROWHEAD);
  const stroke = info?.stroke;
  const tick = stroke !== undefined;

  const [aboveText, belowText] = dimensionTexts(
    dimension,
    measurement,
    radialFormat(dimension, style),
  );

  const font = textStyle?.font ?? STANDARD_FONT;

  const lay = (value: string): ParagraphLayout =>
    layoutDimensionText({
      value,
      height: sizes.textHeight,
      font,
      widthFactor: written(textStyle?.widthFactor ?? 1),
      obliqueAngle: written(textStyle?.obliqueAngle ?? 0),
      align: "center",
      valign: "middle",
    });

  const boxHeight = (layout: ParagraphLayout): number => layout.frame[3] - layout.frame[1];

  const widest = (layout: ParagraphLayout): number =>
    layout.lines.reduce((most, line) => Math.max(most, line.end - line.start), 0);

  const topLayout = lay(mtextOfLabel(aboveText));

  const belowLayout =
    belowText === undefined ? undefined : lay(belowText === "" ? "" : mtextOfLabel(belowText));

  const textWidth = Math.max(widest(topLayout), belowLayout ? widest(belowLayout) : 0);
  const centered = style.textPlacement === "centered";

  const lines: (readonly [Point, Point])[] = [];
  const arrowheads: Point[][] = [];
  const arrowheadEntities: ArrowheadEntity[] = [];

  /** An arrowhead with its tip on `tip`, pointing `inward` toward the center or away from it. */
  const arrow = (tip: Point, inward: boolean): void => {
    if (!(size > 0)) return;
    const way: Point = inward ? [-u[0], -u[1]] : u;

    if (tick) {
      const rotation = (((angle + (inward ? 180 : 0)) % 360) + 360) % 360;
      arrowheadEntities.push({
        kind: "insert",
        block: info!.block!,
        at: tip,
        rotation,
        scale: size,
      });

      const half = move(
        move([0, 0], way, stroke.to[0] * size),
        [-way[1], way[0]],
        stroke.to[1] * size,
      );

      const wide = (stroke.width * size) / 2 / Math.SQRT2;
      const edge: Point = [(way[0] + way[1]) * wide, (way[1] - way[0]) * wide];
      arrowheads.push([
        [tip[0] - half[0] + edge[0], tip[1] - half[1] + edge[1]],
        [tip[0] + half[0] + edge[0], tip[1] + half[1] + edge[1]],
        [tip[0] + half[0] - edge[0], tip[1] + half[1] - edge[1]],
        [tip[0] - half[0] - edge[0], tip[1] - half[1] - edge[1]],
      ]);

      return;
    }

    const base = move(tip, way, -size);
    arrowheads.push([tip, move(base, left, size / 6), move(base, left, -size / 6)]);
    // The leading CAD app gives the corner to the left of the way out from the center first.
    arrowheadEntities.push({
      kind: "solid",
      corners: [move(base, left, size / 6), move(base, left, -size / 6), tip],
    });
  };

  // The text along the line reads from below or from the right; level, it reads along X.
  const along = readable(angle);
  const alongUp: Point = [-Math.sin(along * RADIANS), Math.cos(along * RADIANS)];
  const alongQuarter = direction(along);
  const alongAbove: Point = along % 90 === 0 ? [-alongQuarter[1], alongQuarter[0]] : alongUp;
  const horizontal = style.radialText === "horizontal";
  let rotation = along;
  let quarter = alongQuarter;
  let above = alongAbove;
  let textMiddle: Point;
  let lineMiddle: Point;
  const half = boxHeight(topLayout) / 2;
  const reach = tick ? 0 : size;

  const placed =
    dimension.kind === "jogged-radius-dimension" ? undefined : dimension.textFromCenter;

  const inside = placed !== undefined && written(placed) < radius;

  if (dimension.kind === "jogged-radius-dimension") {
    const start: Point = [written(dimension.start[0]), written(dimension.start[1])];
    const jog: Point = [written(dimension.jog[0]), written(dimension.jog[1])];
    // The jog crosses the line at the style's angle, centered on its point, from where it meets
    // the way to the center to the same distance on the other side.
    const jogAngle = written(style.jogAngle ?? JOG_ANGLE.default);
    const across = direction(angle + 180 - jogAngle);
    const denominator = across[0] * u[1] - across[1] * u[0];

    const t =
      denominator === 0
        ? 0
        : ((center[0] - jog[0]) * u[1] - (center[1] - jog[1]) * u[0]) / denominator;

    const near = move(jog, across, t);
    const far = move(jog, across, -t);
    const end = at(radius - reach);
    // A tick's line runs on past the arc by the style's DIMDLE, one arrow size unless the style
    // says otherwise, and a level text's break widens by as much toward the center. The text keeps its place.
    const beyond = tick ? dimensionSizes(style).lineExtension : 0;
    lines.push([start, far], [far, near]);
    arrow(point, false);
    lineMiddle = [(near[0] + end[0]) / 2, (near[1] + end[1]) / 2];

    if (horizontal) {
      // A level text sits on the last stretch, which breaks where it meets the text's box and a
      // gap round it.
      rotation = 0;
      quarter = [1, 0];
      above = [0, 1];
      textMiddle = lineMiddle;
      const middle = (lineMiddle[0] - center[0]) * u[0] + (lineMiddle[1] - center[1]) * u[1];
      const wide = Math.abs(u[0]) > 0 ? (gap + textWidth / 2) / Math.abs(u[0]) : Infinity;
      const high = Math.abs(u[1]) > 0 ? (gap + half) / Math.abs(u[1]) : Infinity;
      const out = Math.min(wide, high);
      lines.push(
        [at(middle - out - beyond), near],
        [at(radius - reach + beyond), at(middle + out)],
      );
    } else {
      lines.push([near, at(radius - reach + beyond)]);
      textMiddle = move(lineMiddle, above, gap + half);
    }
  } else if (inside) {
    // A text placed inside: one line from beyond it to the arrowhead, which points out. The text
    // stays two arrow sizes and a gap clear of the circle.
    const middle = Math.min(written(placed!), radius - 2 * size - gap - textWidth / 2);
    lineMiddle = at(middle);
    const ends = [at(middle - textWidth / 2 - gap), at(radius - reach)] as const;
    // A diameter's placed text inside takes one arrowhead too, at its point.
    lines.push(ends);
    arrow(point, false);
    textMiddle = centered ? lineMiddle : move(lineMiddle, above, gap + half);
  } else {
    // Outside: the arrowhead points in at the circle, and the line runs out past the text.
    const out = placed === undefined ? radius + 2 * size + gap + textWidth / 2 : written(placed);
    const opposite = at(-radius);

    // A level line takes its text along it, as if it were not level.
    if (horizontal && u[1] !== 0) {
      // Above a line that runs down, the elbow stands a box further out.
      const lower = !centered && u[1] < 0 ? 2 * half : 0;
      const elbow = at(radius + 2 * size + lower);
      const level: Point = u[0] < 0 ? [-1, 0] : [1, 0];
      const landing = move(elbow, level, size);
      lines.push([landing, elbow], [elbow, at(radius + reach)]);
      rotation = 0;
      quarter = [1, 0];
      above = [0, 1];
      lineMiddle = move(landing, level, gap + textWidth / 2);
      textMiddle = lineMiddle;
    } else if (centered) {
      lines.push([at(radius + 2 * size), at(radius + reach)]);
      lineMiddle = at(out);
      textMiddle = lineMiddle;
    } else {
      lines.push([at(out + textWidth / 2 + gap), at(radius + reach)]);
      lineMiddle = at(out);
      textMiddle = move(lineMiddle, above, gap + half);
    }

    // A diameter's line runs across, with a tail past an arrowhead at the far point, and none
    // past a tick.
    if (dimension.kind === "diameter-dimension") {
      lines.push(
        [opposite, point],
        ...(tick ? [] : [[at(-radius - reach), at(-radius - reach - size)] as const]),
      );
    } else lines.push([center, point]);
    arrow(point, true);

    if (dimension.kind === "diameter-dimension") arrow(opposite, false);
  }

  const belowMiddle = belowLayout && move(lineMiddle, above, -(gap + boxHeight(belowLayout) / 2));
  // A placed text, and one with words below, is held by its point on the line.
  const textPoint = belowLayout === undefined && placed === undefined ? textMiddle : lineMiddle;
  const textStyleName = style.textStyle;

  const label = (value: string, middle: Point, layout: ParagraphLayout): DimensionLabel =>
    styledLabel(
      {
        value,
        at: move(middle, above, layout.lines[0]?.baseline ?? 0),
        height: sizes.textHeight,
        rotation,
        direction: quarter,
      },
      textStyleName,
    );

  const definition = dimension.kind === "diameter-dimension" ? at(-radius) : center;

  return {
    measurement,
    definitionPoint: [written(definition[0]), written(definition[1])],
    extensionLines: [],
    dimensionLine: [center, point],
    dimensionLines: lines,
    leader: [],
    dimensionArcs: [],
    arrowheads,
    arrowheadEntities,
    label: label(aboveText, textMiddle, topLayout),
    textMiddle,
    textPoint,
    textWidth,
    ...(belowLayout &&
      belowMiddle && {
        below: { label: label(belowText!, belowMiddle, belowLayout), middle: belowMiddle },
      }),
    lineweights: {
      dimension: lineweightCode(style.dimensionLineweight),
      extension: lineweightCode(style.extensionLineweight),
    },
  };
}

/** An angular dimension's arc as the writers write its points. */
export interface AngularArc {
  readonly vertex: Point;
  readonly radius: number;
  readonly start: number;
  readonly sweep: number;
  readonly first: Point;
  readonly second: Point;
}

/**
 * An angular dimension's arc as the writers write its points: its vertex, its radius, and the
 * degrees, from 0 up to 360, its arc runs counterclockwise between, from `start` through `sweep`.
 * The angle between the two lines from `from` round to `to` holds the arc's point, or else the
 * rest of the turn does, and the arc spans that one. `first` is the point at its start.
 */
export function angularArc(dimension: AngularDimension): AngularArc {
  const p = (q: Point): Point => [written(q[0]), written(q[1])];

  const [vertex, from, to, at] = [
    p(dimension.vertex),
    p(dimension.from),
    p(dimension.to),
    p(dimension.at),
  ];

  const angleOf = (q: Point): number => {
    const a = Math.atan2(q[1] - vertex[1], q[0] - vertex[0]) / RADIANS;

    return a < 0 ? a + 360 : a;
  };

  const turn = (a: number, b: number): number => (((b - a) % 360) + 360) % 360;
  const [a, b, c] = [angleOf(from), angleOf(to), angleOf(at)];
  const inside = turn(a, c) <= turn(a, b);
  const [start, end, first, second] = inside ? [a, b, from, to] : [b, a, to, from];

  return {
    vertex,
    radius: Math.hypot(at[0] - vertex[0], at[1] - vertex[1]),
    start,
    sweep: turn(start, end),
    first,
    second,
  };
}

/**
 * An angle as the leading CAD app writes it in a style, before any prefix or suffix: in the
 * style's `angleUnits`, with `anglePrecision` decimals, rounded half up as a length is, and without
 * the zeros `suppressAngleZeros` leaves out. In degrees, minutes and seconds the precision picks
 * the parts: 0 the degrees, 1 and 2 the minutes, 3 and 4 the seconds, and each more a decimal of
 * the seconds; no zero is left out of them.
 *
 * @param radians - The angle, not negative.
 */
export function angleNumber(
  radians: number,
  style: Pick<DimensionStyle, "angleUnits" | "anglePrecision" | "suppressAngleZeros">,
): string {
  const units = style.angleUnits ?? "degrees";

  const places = Math.min(
    MAX_ANGLE_PRECISION,
    Math.max(0, Math.trunc(style.anglePrecision ?? 0) || 0),
  );

  const degrees = radians / RADIANS;

  const round = (value: number, decimals: number): string =>
    (value + belowHalf(value)).toFixed(decimals);

  if (units === "degrees-minutes-seconds") {
    if (places === 0) return `${round(degrees, 0)}°`;

    if (places <= 2) {
      const minutes = Number(round(degrees * 60, 0));

      return `${Math.floor(minutes / 60)}°${minutes % 60}'`;
    }

    const decimals = Math.max(0, places - 4);
    const tenths = 10 ** decimals;
    const seconds = Number(round(degrees * 3600 * tenths, 0));
    const whole = Math.floor(seconds / tenths);
    const part = (seconds % tenths) / tenths;

    return `${Math.floor(whole / 3600)}°${Math.floor(whole / 60) % 60}'${((whole % 60) + part).toFixed(decimals)}"`;
  }

  let value = degrees;

  if (units === "grads") value = (degrees * 400) / 360;
  else if (units === "radians") value = radians;
  let text = round(value, places);
  const suppress = style.suppressAngleZeros;

  if ((suppress === "trailing" || suppress === "both") && text.includes(".")) {
    text = text.replace(/0+$/, "").replace(/\.$/, "");
  }

  if ((suppress === "leading" || suppress === "both") && text.startsWith("0."))
    text = text.slice(1);

  return `${text}${angleMark(units)}`;
}

/** What an angular dimension draws above its arc and below it, as `dimensionTexts` for a length. */
export function angularTexts(
  dimension: AngularDimension,
  radians: number,
  style: DimensionStyle,
): readonly [above: string, below: string | undefined] {
  const measured = `${style.prefix ?? ""}${angleNumber(radians, style)}${style.suffix ?? ""}`;
  const text = dimensionFileText(dimension);
  const at = text === undefined ? -1 : text.indexOf("<>");

  const drawn =
    text === undefined
      ? measured
      : at < 0
        ? text
        : `${text.slice(0, at)}${measured}${text.slice(at + 2)}`;

  const cut = drawn.indexOf("\\X");

  return cut < 0 ? [drawn, undefined] : [drawn.slice(0, cut), drawn.slice(cut + 2)];
}

/**
 * What the leading CAD app draws for an angular dimension in a style. Each extension line runs
 * along its line from the style's offset off its point, toward the arc, to the style's length
 * past the arc. The arc runs between the arrowheads, each of which takes a chord of the arrow
 * size, or between the ticks. The text stands at the middle of the arc, along it, turned to read
 * upright: a gap above it, or centered in a break of it.
 */
function angularPicture(
  dimension: AngularDimension,
  style: DimensionStyle,
  textStyle: DimensionFont | undefined,
): DimensionPicture {
  const { vertex, radius, start, sweep, first, second } = angularArc(dimension);
  const end = start + sweep;
  const measurement = sweep * RADIANS;

  const polar = (degrees: number, distance: number): Point => {
    const [x, y] = direction(degrees);

    return [vertex[0] + x * distance, vertex[1] + y * distance];
  };

  const move = (from: Point, by: Point, distance: number): Point => [
    from[0] + by[0] * distance,
    from[1] + by[1] * distance,
  ];

  const sizes = dimensionSizes(style);
  const size = sizes.arrowSize;
  const gap = sizes.textGap;
  const info = arrowheadInfo(style.arrowhead ?? DEFAULT_ARROWHEAD);
  const stroke = info?.stroke;
  const tick = stroke !== undefined;

  // An extension line runs from its point toward the arc, and past it.
  const extension = (degrees: number, side: Point): readonly [Point, Point] => {
    const r = Math.hypot(side[0] - vertex[0], side[1] - vertex[1]);
    const out = radius > r ? 1 : -1;

    return [
      polar(degrees, r + out * sizes.extensionOffset),
      polar(degrees, radius + out * sizes.extensionBeyond),
    ];
  };

  const extensionLines = [extension(start, first), extension(end, second)];

  const [aboveText, belowText] = angularTexts(dimension, measurement, style);
  const font = textStyle?.font ?? STANDARD_FONT;

  const lay = (value: string): ParagraphLayout =>
    layoutDimensionText({
      value,
      height: sizes.textHeight,
      font,
      widthFactor: written(textStyle?.widthFactor ?? 1),
      obliqueAngle: written(textStyle?.obliqueAngle ?? 0),
      align: "center",
      valign: "middle",
    });

  const boxHeight = (layout: ParagraphLayout): number => layout.frame[3] - layout.frame[1];

  const widest = (layout: ParagraphLayout): number =>
    layout.lines.reduce((most, line) => Math.max(most, line.end - line.start), 0);

  // Words below the arc are a second line of the one text, which stands on the arc.
  const value = belowText === undefined ? aboveText : `${aboveText}\\P${belowText}`;
  const layout = lay(mtextOfLabel(value));
  const textWidth = widest(layout);
  const half = boxHeight(layout) / 2;
  const centered = style.textPlacement === "centered";

  // An arrowhead takes a chord of its size at each end of the arc, and a tick none.
  const sizeChord = size > 0 ? (2 * Math.asin(Math.min(1, size / (2 * radius)))) / RADIANS : 0;
  const closed = !tick && size > 0;
  const chord = closed ? sizeChord : 0;
  const middle = start + sweep / 2;
  // Where a centered text, or a text that would move out, leaves the marks no room on the arc,
  // they turn outward, each with a tail past it, and the arc runs whole between them.
  const room = angularRoom(radius, sweep, textWidth, style);

  // An arrow size of 0 draws no marks, which have nothing to turn.
  const flipped =
    size > 0 && (closed ? centered || style.textFit === "leader" : centered) && !room.marks;

  const arc = (from: number, to: number): DimensionArc => ({
    center: vertex,
    radius,
    start: ((from % 360) + 360) % 360,
    end: ((to % 360) + 360) % 360,
  });

  const lineMiddle = polar(middle, radius);
  const rotation = readable(middle - 90);
  const quarter = direction(rotation);

  const above: Point =
    rotation % 90 === 0
      ? [-quarter[1], quarter[0]]
      : [-Math.sin(rotation * RADIANS), Math.cos(rotation * RADIANS)];

  let textMiddle: Point;
  const dimensionArcs: DimensionArc[] = [];

  if (flipped) {
    dimensionArcs.push(
      arc(start - chord - sizeChord, start - chord),
      arc(end + chord, end + chord + sizeChord),
      arc(start, end),
    );
  } else if (centered && belowText === undefined) {
    const opening = Math.asin(Math.min(1, (gap + textWidth / 2) / radius)) / RADIANS;
    dimensionArcs.push(arc(start + chord, middle - opening), arc(middle + opening, end - chord));
  } else {
    dimensionArcs.push(arc(start + chord, end - chord));
  }

  textMiddle =
    centered || belowText !== undefined ? lineMiddle : move(lineMiddle, above, gap + half);

  const arrowheads: Point[][] = [];
  const arrowheadEntities: ArrowheadEntity[] = [];

  /** An arrowhead at the arc's end at `degrees`, pointing on round the circle the way `turn` says. */
  const arrow = (degrees: number, turn: 1 | -1): void => {
    if (!(size > 0)) return;
    const tip = polar(degrees, radius);

    if (tick) {
      const pointing = (((degrees + turn * 90) % 360) + 360) % 360;
      const way = direction(pointing);
      arrowheadEntities.push({
        kind: "insert",
        block: info!.block!,
        at: tip,
        rotation: pointing,
        scale: size,
      });

      const halfStroke = move(
        move([0, 0], way, stroke.to[0] * size),
        [-way[1], way[0]],
        stroke.to[1] * size,
      );

      const wide = (stroke.width * size) / 2 / Math.SQRT2;
      const edge: Point = [(way[0] + way[1]) * wide, (way[1] - way[0]) * wide];
      arrowheads.push([
        [tip[0] - halfStroke[0] + edge[0], tip[1] - halfStroke[1] + edge[1]],
        [tip[0] + halfStroke[0] + edge[0], tip[1] + halfStroke[1] + edge[1]],
        [tip[0] + halfStroke[0] - edge[0], tip[1] + halfStroke[1] - edge[1]],
        [tip[0] - halfStroke[0] - edge[0], tip[1] - halfStroke[1] - edge[1]],
      ]);

      return;
    }

    const base = polar(degrees - turn * chord, radius);
    const length = Math.hypot(tip[0] - base[0], tip[1] - base[1]);
    const way: Point = [(tip[0] - base[0]) / length, (tip[1] - base[1]) / length];
    const left: Point = [-way[1], way[0]];
    arrowheads.push([tip, move(base, left, size / 6), move(base, left, -size / 6)]);
    arrowheadEntities.push({
      kind: "solid",
      corners: [move(base, left, size / 6), move(base, left, -size / 6), tip],
    });
  };

  arrow(start, flipped ? 1 : -1);
  arrow(end, flipped ? -1 : 1);

  const textStyleName = style.textStyle;

  const label = (value: string, at: Point, layout: ParagraphLayout): DimensionLabel =>
    styledLabel(
      {
        value,
        at: move(at, above, layout.lines[0]?.baseline ?? 0),
        height: sizes.textHeight,
        rotation,
        direction: quarter,
      },
      textStyleName,
    );

  const at: Point = [written(dimension.at[0]), written(dimension.at[1])];

  return {
    measurement,
    definitionPoint: at,
    extensionLines,
    dimensionLine: [polar(start, radius), polar(end, radius)],
    dimensionLines: [],
    leader: [],
    dimensionArcs,
    arrowheads,
    arrowheadEntities,
    label: label(value, textMiddle, layout),
    textMiddle,
    textPoint: textMiddle,
    textWidth,
    lineweights: {
      dimension: lineweightCode(style.dimensionLineweight),
      extension: lineweightCode(style.extensionLineweight),
    },
  };
}

/** What is wrong with an angular dimension in its style, or undefined. */
function angularDrawnProblem(
  dimension: AngularDimension,
  style: DimensionStyle,
  textStyle: TextStyle | undefined,
): string | undefined {
  const p = (q: Point): Point => [written(q[0]), written(q[1])];
  const vertex = p(dimension.vertex);
  const off = (q: Point): number => Math.hypot(p(q)[0] - vertex[0], p(q)[1] - vertex[1]);

  if (off(dimension.from) === 0 || off(dimension.to) === 0) return ANGULAR_NO_SIDE;

  if (off(dimension.at) === 0) return ANGULAR_NO_ARC;
  const { radius, sweep, first, second } = angularArc(dimension);

  if (!(sweep > 0) || sweep >= 360) return ANGULAR_NO_ANGLE;
  // Where the arc's point lies on one of the lines, a rounding picks the angle or the rest of the
  // turn.
  const at = p(dimension.at);

  for (const side of [first, second]) {
    const [ux, uy] = [side[0] - vertex[0], side[1] - vertex[1]];
    const [vx, vy] = [at[0] - vertex[0], at[1] - vertex[1]];
    const cross = ux * vy - uy * vx;

    if (ux * vx + uy * vy > 0 && Math.abs(cross) <= 1e-12 * Math.hypot(ux, uy) * Math.hypot(vx, vy))
      return ANGULAR_ARC_ON_LINE;
  }

  // The leading CAD app runs an extension line one way or the other by a rounding where the arc
  // passes through its point.
  for (const side of [first, second]) {
    const r = Math.hypot(side[0] - vertex[0], side[1] - vertex[1]);

    if (Math.abs(r - radius) <= 1e-9 * Math.max(1, radius)) return ANGULAR_ARC_ON_POINT;
  }

  // A closed arrowhead is a chord of the arc as long as the arrow size.
  const size = dimensionSizes(style).arrowSize;
  const closed = arrowheadInfo(style.arrowhead ?? DEFAULT_ARROWHEAD)?.stroke === undefined;

  if (closed && size >= 2 * radius) return ANGULAR_ARROWS_LONG;
  const picture = angularPicture(dimension, style, textStyle);

  // An arc of all but a whole turn is written with one angle at both ends, which draws nothing.
  for (const piece of picture.dimensionArcs) {
    if (arcProblem(piece.start, piece.end)) return ANGULAR_ARC_LOST;
  }

  const room = angularRoom(radius, sweep, picture.textWidth, style);

  if (style.textFit === "leader" && !room.text) return ANGULAR_TEXT_OUT;

  // A centered text breaks the arc, and each piece must run on from its mark to the text: one
  // that would run back past its mark, the long way round, is not laid out. Each half of the
  // arc holds a closed arrowhead's chord and half the text's opening.
  // Turned outward, the marks and their tails must stay clear of each other round the back.
  if (picture.dimensionArcs.length === 3) {
    const tail = (2 * Math.asin(Math.min(1, size / (2 * radius)))) / RADIANS;

    if (sweep + 2 * ((closed ? tail : 0) + tail) >= 360) return ANGULAR_TAILS_MEET;
  }

  if (style.textPlacement === "centered" && picture.dimensionArcs.length === 2) {
    const chord = closed && size > 0 ? (2 * Math.asin(size / (2 * radius))) / RADIANS : 0;
    const half = dimensionSizes(style).textGap + picture.textWidth / 2;
    const opening = Math.asin(Math.min(1, half / radius)) / RADIANS;

    if (opening + chord > sweep / 2 + 1e-9) return ANGULAR_CENTERED_SHORT;
  }

  if (style.textPlacement === "centered" && dimension.textBelow !== undefined)
    return ANGULAR_CENTERED_BELOW;

  return pictureNumbersProblem(picture);
}

/** Whether an angular dimension's arc holds its text, and its marks too. */
interface AngularRoom {
  readonly text: boolean;
  readonly marks: boolean;
}

/**
 * Whether an angular dimension's arc holds its text, with a gap each side, and its marks too: a
 * closed arrowhead's size each side more. The arc is measured along its length.
 */
function angularRoom(
  radius: number,
  sweep: number,
  textWidth: number,
  style: DimensionStyle,
): AngularRoom {
  const sizes = dimensionSizes(style);
  const length = radius * sweep * RADIANS;
  const needs = textWidth + 2 * sizes.textGap;
  const tick = arrowheadInfo(style.arrowhead ?? DEFAULT_ARROWHEAD)?.stroke !== undefined;
  const arrows = !tick && sizes.arrowSize > 0 ? 2 * sizes.arrowSize : 0;

  return { text: length > needs, marks: length > needs + arrows };
}

/** An arc length dimension's arc as the writers write it. */
export interface ArcLengthArc {
  readonly center: Point;
  readonly radius: number;
  readonly start: number;
  readonly sweep: number;
  readonly first: Point;
  readonly second: Point;
  readonly reach: number;
}

/**
 * An arc length dimension's arc as the writers write it: its center, its two ends with the 6
 * decimals tsdraft writes, the radius to the first, and the degrees, from 0 up to 360, it runs
 * counterclockwise from `start` through `sweep`; and how far its own arc's point is from the center.
 */
export function arcLengthArc(dimension: ArcLengthDimension): ArcLengthArc {
  const center: Point = [written(dimension.center[0]), written(dimension.center[1])];

  const end = (degrees: number): Point => {
    const [x, y] = direction(written(degrees));
    const r = written(dimension.radius);

    return [written(center[0] + x * r), written(center[1] + y * r)];
  };

  const [first, second] = [end(dimension.startAngle), end(dimension.endAngle)];

  const angleOf = (q: Point): number => {
    const a = Math.atan2(q[1] - center[1], q[0] - center[0]) / RADIANS;

    return a < 0 ? a + 360 : a;
  };

  const start = angleOf(first);
  const at: Point = [written(dimension.at[0]), written(dimension.at[1])];

  return {
    center,
    radius: Math.hypot(first[0] - center[0], first[1] - center[1]),
    start,
    sweep: (((angleOf(second) - start) % 360) + 360) % 360,
    first,
    second,
    reach: Math.hypot(at[0] - center[0], at[1] - center[1]),
  };
}

/** The least sweep, in degrees, the leading CAD app takes as a right angle: a millionth of a radian under. */
const RIGHT_ANGLE_UNDER = 90 - 1e-6 / RADIANS;

/** An arc length dimension's own arc, with its extension lines' feet. */
interface ArcLengthOwnArc {
  readonly arcCenter: Point;
  readonly arcRadius: number;
  readonly arcStart: number;
  readonly arcSweep: number;
  readonly footStart: Point;
  readonly footEnd: Point;
}

/**
 * An arc length dimension's own arc: its center and radius, and the degrees it runs between where
 * the extension lines meet it, from `arcStart` through `arcSweep`. From a right angle up, as the
 * leading CAD app takes a sweep within a millionth of a radian of one, it runs about the center through the
 * dimension's point; under one, it runs there too outside the arc, between the extension lines
 * parallel to the bisector, and inside the arc it is the arc moved along the bisector.
 */
function arcLengthOwnArc(dimension: ArcLengthDimension): ArcLengthOwnArc {
  const { center, radius, start, sweep, first, second, reach } = arcLengthArc(dimension);

  const move = (from: Point, by: Point, distance: number): Point => [
    from[0] + by[0] * distance,
    from[1] + by[1] * distance,
  ];

  const bisector = direction(start + sweep / 2);
  const out = reach > radius ? 1 : -1;
  // The leading CAD app takes a sweep within a millionth of a radian of a right angle as one.
  const parallel = sweep < RIGHT_ANGLE_UNDER;

  const [arcCenter, arcRadius]: [Point, number] =
    parallel && out < 0 ? [move(center, bisector, reach - radius), radius] : [center, reach];

  const angleAbout = (q: Point): number => {
    const a = Math.atan2(q[1] - arcCenter[1], q[0] - arcCenter[0]) / RADIANS;

    return a < 0 ? a + 360 : a;
  };

  /** Where an extension line from an end of the arc meets the dimension's own arc. */
  const foot = (p: Point, degrees: number): Point => {
    if (!parallel) {
      const [x, y] = direction(degrees);

      return [center[0] + x * reach, center[1] + y * reach];
    }

    if (out < 0) return move(p, bisector, reach - radius);
    // Along the bisector from the end to the circle about the center through the point.
    const along = (p[0] - center[0]) * bisector[0] + (p[1] - center[1]) * bisector[1];
    const square = (p[0] - center[0]) ** 2 + (p[1] - center[1]) ** 2;

    return move(p, bisector, -along + Math.sqrt(along * along - square + reach * reach));
  };

  const [footStart, footEnd] = [foot(first, start), foot(second, start + sweep)];
  const arcStart = angleAbout(footStart);

  return {
    arcCenter,
    arcRadius,
    arcStart,
    arcSweep: (((angleAbout(footEnd) - arcStart) % 360) + 360) % 360,
    footStart,
    footEnd,
  };
}

/**
 * What the leading CAD app draws for an arc length dimension in a style. From a right angle up its
 * own arc runs about the center through its point, and its extension lines along radii; under one,
 * its extension lines run parallel to the arc's bisector, and its own arc runs about the center
 * outside the arc, or is the arc moved along the bisector inside it. The marks, the text and its
 * break are an angular dimension's; the arc symbol is a half circle before the text, or an arc over
 * it.
 */
function arcLengthPicture(
  dimension: ArcLengthDimension,
  style: DimensionStyle,
  textStyle: DimensionFont | undefined,
): DimensionPicture {
  const { radius, start, sweep, first, second } = arcLengthArc(dimension);

  const { arcCenter, arcRadius, arcStart, arcSweep, footStart, footEnd } =
    arcLengthOwnArc(dimension);

  const measurement = radius * sweep * RADIANS;

  const move = (from: Point, by: Point, distance: number): Point => [
    from[0] + by[0] * distance,
    from[1] + by[1] * distance,
  ];

  const sizes = dimensionSizes(style);
  const size = sizes.arrowSize;
  const gap = sizes.textGap;
  const info = arrowheadInfo(style.arrowhead ?? DEFAULT_ARROWHEAD);
  const stroke = info?.stroke;
  const tick = stroke !== undefined;
  const middle = start + sweep / 2;

  const extension = (p: Point, q: Point): readonly [Point, Point] => {
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]);

    const way: Point =
      length > 0 ? [(q[0] - p[0]) / length, (q[1] - p[1]) / length] : direction(start);

    return [move(p, way, sizes.extensionOffset), move(q, way, sizes.extensionBeyond)];
  };

  const extensionLines = [extension(first, footStart), extension(second, footEnd)];
  const arcEnd = arcStart + arcSweep;

  const polar = (degrees: number, distance: number): Point => {
    const [x, y] = direction(degrees);

    return [arcCenter[0] + x * distance, arcCenter[1] + y * distance];
  };

  const [aboveText, belowText] = arcLengthTexts(dimension, measurement, style);
  const font = textStyle?.font ?? STANDARD_FONT;
  const value = belowText === undefined ? aboveText : `${aboveText}\\P${belowText}`;

  const layout = layoutDimensionText({
    value: mtextOfLabel(value),
    height: sizes.textHeight,
    font,
    widthFactor: written(textStyle?.widthFactor ?? 1),
    obliqueAngle: written(textStyle?.obliqueAngle ?? 0),
    align: "center",
    valign: "middle",
  });

  const textWidth = layout.lines.reduce((most, line) => Math.max(most, line.end - line.start), 0);
  const half = (layout.frame[3] - layout.frame[1]) / 2;
  const centered = style.textPlacement === "centered";
  const symbol = style.arcSymbol ?? "before";

  const sizeChord = size > 0 ? (2 * Math.asin(Math.min(1, size / (2 * arcRadius)))) / RADIANS : 0;
  const closed = !tick && size > 0;
  const chord = closed ? sizeChord : 0;
  // The text and its break stand on the bisector of the arc measured.
  const arcMiddle = middle;
  const lineMiddle = polar(arcMiddle, arcRadius);
  const rotation = readable(arcMiddle - 90);
  const quarter = direction(rotation);

  const above: Point =
    rotation % 90 === 0
      ? [-quarter[1], quarter[0]]
      : [-Math.sin(rotation * RADIANS), Math.cos(rotation * RADIANS)];

  // Along the text, the angle about its own arc grows when the text reads against the arc's way.
  const against = Math.abs(((((rotation - (arcMiddle - 90)) % 360) + 540) % 360) - 180) > 90;
  // A centered text and its symbol before it need the arc's room together.
  const symbolWidth = (style.arcSymbol ?? "before") === "before" ? 3.6 * half : 0;
  const room = angularRoom(arcRadius, arcSweep, textWidth + 2 * symbolWidth, style);

  const flipped =
    size > 0 && (closed ? centered || style.textFit === "leader" : centered) && !room.marks;

  const arc = (from: number, to: number): DimensionArc => ({
    center: arcCenter,
    radius: arcRadius,
    start: ((from % 360) + 360) % 360,
    end: ((to % 360) + 360) % 360,
  });

  const dimensionArcs: DimensionArc[] = [];

  if (flipped) {
    dimensionArcs.push(
      arc(arcStart - chord - sizeChord, arcStart - chord),
      arc(arcEnd + chord, arcEnd + chord + sizeChord),
      arc(arcStart, arcEnd),
    );
  } else if (centered && belowText === undefined) {
    // The break reaches a gap past the text, and past the symbol on the side it stands.
    const before = symbol === "before" ? 3.6 * half : 0;
    const opening = (along: number): number => Math.asin(Math.min(1, along / arcRadius)) / RADIANS;
    const [left, right] = [opening(gap + textWidth / 2 + before), opening(gap + textWidth / 2)];
    const [low, high] = against ? [left, right] : [right, left];
    // The break stands about the middle of the dimension's own arc.
    const breakMiddle = arcStart + arcSweep / 2;
    dimensionArcs.push(
      arc(arcStart + chord, breakMiddle - low),
      arc(breakMiddle + high, arcEnd - chord),
    );
  } else {
    dimensionArcs.push(arc(arcStart + chord, arcEnd - chord));
  }

  const textMiddle =
    centered || belowText !== undefined ? lineMiddle : move(lineMiddle, above, gap + half);

  // The arc symbol, in the text's own frame: x along it from its middle, y up it.
  const inText = (x: number, y: number): Point => move(move(textMiddle, quarter, x), above, y);

  if (symbol === "before") {
    dimensionArcs.push({
      center: inText(-textWidth / 2 - 2 * half, -0.8 * half),
      radius: 1.6 * half,
      start: ((rotation % 360) + 360) % 360,
      end: (((rotation + 180) % 360) + 360) % 360,
    });
  } else if (symbol === "above") {
    // Through two points beside the text's top and one above its middle.
    const lean = Math.atan2(1.575, 1.5) / RADIANS;
    dimensionArcs.push({
      center: inText(0, 0.025 * half),
      radius: 2.175 * half,
      start: (((rotation + lean) % 360) + 360) % 360,
      end: (((rotation + 180 - lean) % 360) + 360) % 360,
    });
  }

  const arrowheads: Point[][] = [];
  const arrowheadEntities: ArrowheadEntity[] = [];

  const arrow = (degrees: number, turn: 1 | -1): void => {
    if (!(size > 0)) return;
    const tip = polar(degrees, arcRadius);

    if (tick) {
      const pointing = (((degrees + turn * 90) % 360) + 360) % 360;
      const way = direction(pointing);
      arrowheadEntities.push({
        kind: "insert",
        block: info!.block!,
        at: tip,
        rotation: pointing,
        scale: size,
      });

      const halfStroke = move(
        move([0, 0], way, stroke.to[0] * size),
        [-way[1], way[0]],
        stroke.to[1] * size,
      );

      const wide = (stroke.width * size) / 2 / Math.SQRT2;
      const edge: Point = [(way[0] + way[1]) * wide, (way[1] - way[0]) * wide];
      arrowheads.push([
        [tip[0] - halfStroke[0] + edge[0], tip[1] - halfStroke[1] + edge[1]],
        [tip[0] + halfStroke[0] + edge[0], tip[1] + halfStroke[1] + edge[1]],
        [tip[0] + halfStroke[0] - edge[0], tip[1] + halfStroke[1] - edge[1]],
        [tip[0] - halfStroke[0] - edge[0], tip[1] - halfStroke[1] - edge[1]],
      ]);

      return;
    }

    const base = polar(degrees - turn * chord, arcRadius);
    const length = Math.hypot(tip[0] - base[0], tip[1] - base[1]);
    const way: Point = [(tip[0] - base[0]) / length, (tip[1] - base[1]) / length];
    const left: Point = [-way[1], way[0]];
    arrowheads.push([tip, move(base, left, size / 6), move(base, left, -size / 6)]);
    arrowheadEntities.push({
      kind: "solid",
      corners: [move(base, left, size / 6), move(base, left, -size / 6), tip],
    });
  };

  arrow(arcStart, flipped ? 1 : -1);
  arrow(arcEnd, flipped ? -1 : 1);

  const textStyleName = style.textStyle;
  const at: Point = [written(dimension.at[0]), written(dimension.at[1])];

  return {
    measurement,
    definitionPoint: at,
    extensionLines,
    dimensionLine: [polar(arcStart, arcRadius), polar(arcEnd, arcRadius)],
    dimensionLines: [],
    leader: [],
    dimensionArcs,
    arrowheads,
    arrowheadEntities,
    label: styledLabel(
      {
        value,
        at: move(textMiddle, above, layout.lines[0]?.baseline ?? 0),
        height: sizes.textHeight,
        rotation,
        direction: quarter,
      },
      textStyleName,
    ),
    textMiddle,
    textPoint: textMiddle,
    textWidth,
    lineweights: {
      dimension: lineweightCode(style.dimensionLineweight),
      extension: lineweightCode(style.extensionLineweight),
    },
  };
}

/** What is wrong with an arc length dimension in its style, or undefined. */
function arcLengthDrawnProblem(
  dimension: ArcLengthDimension,
  style: DimensionStyle,
  textStyle: TextStyle | undefined,
): string | undefined {
  const { radius, sweep, reach } = arcLengthArc(dimension);

  if (!(written(dimension.radius) > 0) || !(radius > 0) || !(sweep > 0) || sweep >= 360)
    return ARC_LENGTH_NO_ARC;

  if (!(reach > 0)) return ARC_LENGTH_NO_REACH;

  // The arc's ends are written with 6 decimals, which moves the radius by as much.
  if (Math.abs(reach - radius) <= 1e-6 * Math.max(1, radius)) return ARC_LENGTH_ON_ARC;

  // Inside an arc under a right angle, the leading CAD app's own arc stops short of an extension
  // line by an amount not laid out.
  if (sweep < RIGHT_ANGLE_UNDER && reach < radius) return ARC_LENGTH_INSIDE_SHORT;

  if (dimension.textBelow !== undefined && (style.arcSymbol ?? "before") !== "none")
    return ARC_LENGTH_SYMBOL_BELOW;

  if (style.textPlacement === "centered" && dimension.textBelow !== undefined)
    return ANGULAR_CENTERED_BELOW;
  const size = dimensionSizes(style).arrowSize;
  const closed = arrowheadInfo(style.arrowhead ?? DEFAULT_ARROWHEAD)?.stroke === undefined;
  const picture = arcLengthPicture(dimension, style, textStyle);
  const own = picture.dimensionArcs[0]!;

  if (closed && size >= 2 * own.radius) return ANGULAR_ARROWS_LONG;

  for (const piece of picture.dimensionArcs) {
    if (arcProblem(piece.start, piece.end)) return ANGULAR_ARC_LOST;
  }

  // The room on its own arc, with a symbol before the text counted on both sides of it.
  const { arcRadius, arcSweep } = arcLengthOwnArc(dimension);

  const layout = layoutDimensionText({
    value: mtextOfLabel(picture.label.value),
    height: dimensionSizes(style).textHeight,
    font: textStyle?.font ?? STANDARD_FONT,
    widthFactor: written(textStyle?.widthFactor ?? 1),
    obliqueAngle: written(textStyle?.obliqueAngle ?? 0),
    align: "center",
    valign: "middle",
  });

  const half = (layout.frame[3] - layout.frame[1]) / 2;
  const symbolWidth = (style.arcSymbol ?? "before") === "before" ? 3.6 * half : 0;
  const room = angularRoom(arcRadius, arcSweep, picture.textWidth + 2 * symbolWidth, style);

  if (style.textFit === "leader" && !room.text) return ANGULAR_TEXT_OUT;

  const chord =
    closed && size > 0 ? (2 * Math.asin(Math.min(1, size / (2 * arcRadius)))) / RADIANS : 0;

  // A centered text breaks the arc, and each piece must run on from its mark to the text.
  // The pieces of its own arc: all its arcs but the symbol, which comes last.
  const pieces = picture.dimensionArcs.length - ((style.arcSymbol ?? "before") === "none" ? 0 : 1);

  if (style.textPlacement === "centered" && pieces === 2) {
    const gap = dimensionSizes(style).textGap;
    const opening = (along: number): number => Math.asin(Math.min(1, along / arcRadius)) / RADIANS;
    const widest = opening(gap + picture.textWidth / 2 + symbolWidth);

    if (widest + chord > arcSweep / 2 + 1e-9) return ANGULAR_CENTERED_SHORT;
  }

  // Turned outward, the marks and their tails must stay clear of each other round the back.
  if (pieces === 3) {
    const tail = (2 * Math.asin(Math.min(1, size / (2 * arcRadius)))) / RADIANS;

    if (arcSweep + 2 * ((closed ? tail : 0) + tail) >= 360) return ANGULAR_TAILS_MEET;
  }

  // What it reads is held to the digits a length's writing holds.
  const scaled = picture.measurement * written(style.measurementScale ?? 1);

  const digits = dimensionMeasureProblem(
    picture.measurement,
    scaled,
    roundedMeasurement(picture.measurement, style),
    true,
    picture.label.value,
    undefined,
  );

  if (digits) return digits;

  return pictureNumbersProblem(picture);
}

/**
 * What is wrong with an ordinate dimension in its style, or undefined: a leader that ends at its
 * feature, and what it reads past the digits a length's writing holds. A feature at the origin
 * reads 0, as the leading CAD app draws it.
 */
function ordinateDrawnProblem(
  dimension: OrdinateDimension,
  style: DimensionStyle,
  textStyle: TextStyle | undefined,
): string | undefined {
  const { length, across } = ordinateLeader(dimension);

  if (length === 0 && across === 0) return ORDINATE_NO_LEADER;
  const picture = dimensionPicture(dimension, style, textStyle);
  const measurement = picture.measurement;
  const scaled = measurement * written(style.measurementScale ?? 1);

  if (!Number.isFinite(measurement) || !Number.isFinite(scaled)) {
    return "it measures no finite length";
  }

  if (written(measurement) !== 0) {
    const digits = dimensionMeasureProblem(
      measurement,
      scaled,
      roundedMeasurement(measurement, style),
      true,
      picture.label.value,
      undefined,
    );

    if (digits) return digits;
  }

  return pictureNumbersProblem(picture);
}

/** What an arc length dimension draws above its arc and below it, as `dimensionTexts` for a line. */
function arcLengthTexts(
  dimension: ArcLengthDimension,
  length: number,
  style: DimensionStyle,
): readonly [above: string, below: string | undefined] {
  return dimensionTexts(dimension, length, style);
}

/**
 * The widest a character of any font in `FONTS` is drawn, as a share of the text's height,
 * before its style's width factor: for the characters of a measurement, the widest the leading CAD
 * app lays out in any of them, and for every other character 2, which no character of Latin-1
 * reaches in any of them.
 */
/** How wide a character may be drawn, as a share of a text's height, by the character. */
export interface CharacterWidths {
  readonly [character: string]: number;
}

export const WIDEST_CHARACTERS: CharacterWidths = {
  "0": 1.1,
  "1": 1.1,
  "2": 1.1,
  "3": 1.1,
  "4": 1.1,
  "5": 1.1,
  "6": 1.1,
  "7": 1.1,
  "8": 1.1,
  "9": 1.104,
  ".": 1.1,
  "-": 1.239,
  "/": 1.239,
  "'": 1.1,
  '"': 1.1,
  " ": 1.1,
};

const WIDEST_CHARACTER = 2;

/**
 * The least a dimension with closed filled arrowheads must measure for the leading CAD app to draw
 * its arrowheads between the extension lines, whatever the widths of its font: more than twice the
 * arrow size and twice the gap, and at least the widest its text can be and twice the gap. A text
 * centered in the line breaks it, and needs the arrowheads' room as well as its own. The widest is
 * each character's width from `WIDEST_CHARACTERS` times the height and the width factor, and the
 * lean of a slanted style once, the height times the tangent of its angle. Undefined for a style
 * whose picture does not depend on that: one with ticks, or with an arrow size of 0.
 *
 * @param text - The text of the dimension as that app draws it.
 * @param textStyle - The text style of the dimension's style, unless it is `Standard`.
 */
export function arrowRoom(
  style: DimensionStyle,
  text: string,
  textStyle: TextStyle | undefined,
): number | undefined {
  if ((style.arrowhead ?? DEFAULT_ARROWHEAD) !== "closed-filled") return undefined;
  const sizes = dimensionSizes(style);

  if (!(sizes.arrowSize > 0)) return undefined;
  let widths = 0;

  for (const character of text) widths += WIDEST_CHARACTERS[character] ?? WIDEST_CHARACTER;

  const lean =
    sizes.textHeight * Math.abs(Math.tan((written(textStyle?.obliqueAngle ?? 0) * Math.PI) / 180));

  return roomBeside(style, widths * sizes.textHeight * written(textStyle?.widthFactor ?? 1) + lean);
}

/** The least a dimension with closed filled arrowheads must measure beside a text this wide. */
function roomBeside(style: DimensionStyle, width: number): number {
  const sizes = dimensionSizes(style);
  const arrows = 2 * sizes.arrowSize;
  const room = style.textPlacement === "centered" ? width + arrows : Math.max(arrows, width);

  return room + 2 * sizes.textGap;
}

const STACK = /\{\\H[^;]*;\\S(\d+)([/#])(\d+);\}/g;

/**
 * A dimension's text as wide as it may draw, with the longer part for each fraction it stacks
 * over a bar, and both parts and the slash for a diagonal one.
 */
function stackWidths(text: string): string {
  return text.replace(STACK, (_, top: string, mark: string, bottom: string) =>
    mark === "#" ? `${top}/${bottom}` : top.length > bottom.length ? top : bottom,
  );
}

/** A dimension's text with each fraction it stacks written inline, as a message shows it. */
function inlineFractions(text: string): string {
  return text.replace(
    STACK,
    (_, top: string, _mark: string, bottom: string, at: number) =>
      `${/\d/.test(text[at - 1] ?? "") ? " " : ""}${top}/${bottom}`,
  );
}

/**
 * Returns what is wrong with what a dimension draws in its style, or undefined, for a dimension
 * and a style the rules have passed one by one. It is the check the builder and `lint` share:
 * what the dimension measures, as `dimensionMeasureProblem` holds it, and every number of its
 * picture, which must be under 1e100.
 *
 * @param textStyle - The text style of the dimension's style, unless it is `Standard`.
 */
export function dimensionDrawnProblem(
  dimension: Dimension,
  style: DimensionStyle,
  textStyle: TextStyle | undefined,
): string | undefined {
  const { measurement } = dimensionMeasure(dimension);

  if (isRadial(dimension)) return radialDrawnProblem(dimension, measurement, style, textStyle);

  if (dimension.kind === "angular-dimension")
    return angularDrawnProblem(dimension, style, textStyle);

  if (dimension.kind === "arc-length-dimension")
    return arcLengthDrawnProblem(dimension, style, textStyle);

  if (dimension.kind === "ordinate-dimension")
    return ordinateDrawnProblem(dimension, style, textStyle);
  // The arrowheads need room for the wider of the texts above and below the line.
  const [above, below] = dimensionTexts(dimension, measurement, style);
  let drawn = above;
  let room = arrowRoom(style, stackWidths(above), textStyle);

  if (below !== undefined) {
    const needs = arrowRoom(style, stackWidths(below), textStyle);

    if (needs !== undefined && needs > (room ?? 0)) [drawn, room] = [below, needs];
  }

  const problem = dimensionMeasureProblem(
    measurement,
    measurement * written(style.measurementScale ?? 1),
    roundedMeasurement(measurement, style),
    dimension.kind === "aligned-dimension",
    inlineFractions(drawn),
    room,
  );

  if (problem) return problem;
  const picture = dimensionPicture(dimension, style, textStyle);
  // The text as laid out may be wider still: a narrow font does not narrow a stack's gap.
  const laid = room === undefined ? undefined : roomBeside(style, picture.textWidth);

  if (laid !== undefined && measurement <= laid) {
    return arrowRoomProblem(measurement, inlineFractions(drawn), laid);
  }

  const sizes = dimensionSizes(style);

  if (picture.leader.length > 0 && dimension.textBelow !== undefined) return DIMENSION_LEADER_BELOW;

  if (style.textFit === "leader" && sizes.arrowSize >= 2 * sizes.textHeight) {
    return DIMENSION_LEADER_ARROWS;
  }

  if (
    picture.leader.length === 0 &&
    style.textPlacement === "centered" &&
    // The extension lines stand as far apart as what the dimension measures.
    picture.textWidth + 2 * sizes.textGap > picture.measurement
  ) {
    return DIMENSION_CENTERED_WIDE;
  }

  return pictureNumbersProblem(picture);
}

/** What is wrong with a radius, a diameter or a jogged radius dimension in its style, or undefined. */
function radialDrawnProblem(
  dimension: RadialDimension,
  measurement: number,
  style: DimensionStyle,
  textStyle: TextStyle | undefined,
): string | undefined {
  if (written(measurement) === 0) return RADIAL_NO_RADIUS;

  if ((style.prefix ?? "") !== "") return RADIAL_PREFIX;

  if (
    style.radialText === "horizontal" &&
    dimension.kind !== "jogged-radius-dimension" &&
    dimension.textFromCenter !== undefined
  )
    return RADIAL_PLACED_LEVEL;

  if (
    style.textPlacement === "centered" &&
    (dimension.kind === "jogged-radius-dimension" || dimension.textFromCenter !== undefined)
  )
    return RADIAL_CENTERED;
  const format = radialFormat(dimension, style);

  const problem = dimensionMeasureProblem(
    measurement,
    measurement * written(style.measurementScale ?? 1),
    roundedMeasurement(measurement, format),
    false,
    measurementText(measurement, format, dimension.text),
    undefined,
  );

  if (problem) return problem;
  const picture = dimensionPicture(dimension, style, textStyle);

  if (
    dimension.kind === "jogged-radius-dimension" &&
    !joggedStretchFits(dimension, style, picture)
  ) {
    return RADIAL_JOG_SHORT;
  }

  return pictureNumbersProblem(picture);
}

/**
 * Whether a jogged radius dimension's last stretch, from its jog to its arrowhead, holds its text:
 * the text and a gap each side along it, or a level text's break within it.
 */
function joggedStretchFits(
  dimension: JoggedRadiusDimension,
  style: DimensionStyle,
  picture: DimensionPicture,
): boolean {
  const center: Point = [written(dimension.center[0]), written(dimension.center[1])];
  const point: Point = [written(dimension.point[0]), written(dimension.point[1])];
  const radius = Math.hypot(point[0] - center[0], point[1] - center[1]);
  const u: Point = [(point[0] - center[0]) / radius, (point[1] - center[1]) / radius];
  const along = (p: Point): number => (p[0] - center[0]) * u[0] + (p[1] - center[1]) * u[1];
  const lines = picture.dimensionLines;
  const near = along(lines[1]![1]);

  if (lines.length > 3) {
    // A level text: the stretch is broken on each side of it, from the jog and from the arrowhead.
    return along(lines[2]![0]) >= near && along(lines[3]![1]) <= along(lines[3]![0]);
  }

  // The text is centered short of a tick's line past the arc.
  const sizes = dimensionSizes(style);
  const tick = arrowheadInfo(style.arrowhead ?? DEFAULT_ARROWHEAD)?.stroke !== undefined;
  const end = along(lines[2]![1]) - (tick ? sizes.lineExtension : 0);

  return end - near >= picture.textWidth + 2 * sizes.textGap;
}

/** What is wrong with the numbers of a dimension's picture, each of which must be under 1e100. */
function pictureNumbersProblem(picture: DimensionPicture): string | undefined {
  const numbers = [
    ...picture.definitionPoint,
    ...picture.extensionLines.flat(2),
    ...picture.dimensionLine.flat(),
    ...picture.dimensionLines.flat(2),
    ...picture.leader.flat(2),
    ...picture.dimensionArcs.flatMap((arc) => [...arc.center, arc.radius]),
    ...picture.arrowheads.flat(2),
    ...picture.label.at,
    picture.label.height,
    ...picture.textMiddle,
    ...picture.textPoint,
    ...(picture.below ? [...picture.below.middle, ...picture.below.label.at] : []),
    ...picture.arrowheadEntities.flatMap((a) =>
      a.kind === "solid" ? a.corners.flat() : [...a.at, a.scale],
    ),
  ];

  for (const value of numbers) {
    const tooLarge = pictureNumberProblem(value);

    if (tooLarge) return tooLarge;
  }

  return undefined;
}

/** A dimension's label, in the text style its style names when it names one. */
function styledLabel(
  label: Omit<DimensionLabel, "style">,
  style: string | undefined,
): DimensionLabel {
  return style === undefined ? label : { ...label, style };
}

/** The mark after an angle in its units: the degree sign, `g` for grads, and `r` for radians. */
function angleMark(units: string): string {
  switch (units) {
    case "degrees":
      return "°";
    case "grads":
      return "g";
    default:
      return "r";
  }
}
