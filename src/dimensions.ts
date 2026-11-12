// What a dimension needs worked out: the keys of the handles of a dimension style, of an
// arrowhead's block and of the block of a dimension's picture, the text AutoCAD writes for a
// measurement, and the lines, arrowheads and text AutoCAD draws for a dimension.
import type {
  AlignedDimension,
  DimensionStyle,
  Drawing,
  LinearDimension,
  Point,
  TextStyle,
} from "./drawing.ts";
import {
  arrowheadInfo,
  ARROWHEADS,
  DEFAULT_ARROWHEAD,
  MAX_PRECISION,
  type Arrowhead,
} from "./arrowheads.ts";
import { blockHandles } from "./blocks.ts";
import { written } from "./format.ts";
import { keyHandle } from "./handles.ts";
import { layerKey } from "./layers.ts";
import {
  dimensionMeasureProblem,
  dimensionStyleNameProblem,
  idKey,
  idProblem,
  integerDigits,
  layoutNameProblem,
  pictureNumberProblem,
} from "./rules.ts";

/** A dimension of either kind. */
export type Dimension = LinearDimension | AlignedDimension;

/**
 * A dimension style's name as its handle is keyed: A to Z in lower case and nothing else
 * changed, as `idKey` treats an id. AutoCAD takes two names with one key for one style, so the
 * duplicate rule refuses the second. No table that can grow is part of this, and it must never
 * change.
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
 * DXF, the two extension lines, the dimension line, the two arrowheads and the text.
 */
export interface DimensionPictureHandles {
  readonly record: string;
  readonly begin: string;
  readonly end: string;
  readonly extensionLines: readonly [string, string];
  readonly dimensionLine: string;
  readonly arrowheads: readonly [string, string];
  readonly text: string;
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
 * The dimension style a dimension of this name is in: the first whose name AutoCAD's style
 * table would take for the same, so `dims` finds `DIMS`.
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
 * The handles of the block AutoCAD draws an arrowhead with, in an R2018 drawing: the block's
 * record, and the stroke it holds. They come from the block's name, so they are the same in
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
    if (block !== undefined && !used.has(block)) used.set(block, arrowhead as Arrowhead);
  }
  return [...used].map(([block, arrowhead]) => ({ arrowhead, block }));
}

/** How a dimension style writes a measurement. */
export type MeasurementFormat = Pick<
  DimensionStyle,
  "precision" | "prefix" | "suffix" | "suppressZeros" | "measurementScale"
>;

/**
 * How far below the half a value may lie and still be written as on it, as AutoCAD writes a
 * measurement: a ten-billionth of the value under 1, and from 1 up a ten-billionth and one and
 * a half units in the 16th significant digit, which grows with each power of ten.
 */
function belowHalf(value: number): number {
  return value < 1 ? 1e-10 * value : 1e-10 + 1.5 * 10 ** (integerDigits(value) - 16);
}

/**
 * A length as AutoCAD writes it in decimal units, before any prefix or suffix: times the
 * style's measurement scale, with `precision` decimals, and without the zeros the style leaves
 * out. AutoCAD rounds half up, and takes a value a little below the half as on it: within a
 * ten-billionth of the value under 1, and from 1 up within a ten-billionth and one and a half
 * units in the 16th significant digit. So 52.15, which a computer holds as a little less, is
 * written `52.2` at a precision of 1, and so is 1234567.15.
 *
 * @param length - What the dimension measures, in drawing units, not negative.
 */
export function measurementNumber(length: number, format: MeasurementFormat): string {
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
 * every decimal of the style's precision and before any zero is left out.
 */
export function roundedMeasurement(length: number, format: MeasurementFormat): string {
  const value = Math.abs(length) * written(format.measurementScale ?? 1);
  // A precision the rules refuse is drawn as the nearest one they take.
  const decimals = Math.min(MAX_PRECISION, Math.max(0, Math.trunc(format.precision) || 0));
  return (value + belowHalf(value)).toFixed(decimals);
}

/**
 * The text AutoCAD draws for a dimension: the measurement with the style's prefix and suffix,
 * or the dimension's own text, in which the first `<>` stands for that.
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

/** The text of a dimension as AutoCAD draws it, and where. */
export interface DimensionLabel {
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
 * What AutoCAD draws for a dimension, in the coordinates of the dimension's space, with every
 * number of the dimension and of its style taken as the writers write it.
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
  /** The dimension line, between the arrowheads or through the ticks. */
  readonly dimensionLine: readonly [Point, Point];
  /** The outline of each arrowhead, which is filled. None for an arrow size of 0. */
  readonly arrowheads: readonly (readonly Point[])[];
  /**
   * The entity that draws each arrowhead in the block of the dimension's picture, as AutoCAD
   * writes it: a filled triangle, or an insert of the arrowhead's block. None for an arrow
   * size of 0.
   */
  readonly arrowheadEntities: readonly ArrowheadEntity[];
  readonly label: DimensionLabel;
  /** The middle of the text's box, which a file holds beside the dimension. */
  readonly textMiddle: Point;
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

/** The sizes of a dimension style in the units of the dimension's space: each times the scale. */
export function dimensionSizes(style: DimensionStyle): {
  readonly textHeight: number;
  readonly arrowSize: number;
  readonly extensionOffset: number;
  readonly extensionBeyond: number;
  readonly textGap: number;
} {
  const scale = written(style.scale ?? 1);
  return {
    textHeight: written(style.textHeight) * scale,
    arrowSize: written(style.arrowSize) * scale,
    extensionOffset: written(style.extensionOffset) * scale,
    extensionBeyond: written(style.extensionBeyond) * scale,
    textGap: written(style.textGap) * scale,
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

/**
 * The direction a dimension measures along, in degrees, and what it measures: for a linear
 * dimension the distance between its two points along its angle, and for an aligned one the
 * distance between them. Every number is taken as the writers write it.
 */
export function dimensionMeasure(dimension: Dimension): {
  readonly angle: number;
  readonly measurement: number;
} {
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

/** The unit vector at an angle in degrees, exact along the axes. */
function direction(degrees: number): Point {
  const quarter = ((degrees % 360) + 360) % 360;
  if (quarter === 0) return [1, 0];
  if (quarter === 90) return [0, 1];
  if (quarter === 180) return [-1, 0];
  if (quarter === 270) return [0, -1];
  return [Math.cos(degrees * RADIANS), Math.sin(degrees * RADIANS)];
}

/**
 * What AutoCAD draws for a dimension in a style, for a dimension and a style the rules have
 * passed. The dimension line runs through the definition point along the direction measured.
 * Each extension line starts the style's offset from its point, on the side of the dimension
 * line, and ends the style's length beyond that line. The text is centered between the
 * extension lines, one gap above the dimension line as the text reads, and turned to read
 * from below or from the right. A closed filled arrowhead points outward from between the
 * extension lines, and a tick is centered on the end of the dimension line, which then runs
 * one arrow size past each extension line.
 *
 * @param style - The dimension's style.
 */
export function dimensionPicture(dimension: Dimension, style: DimensionStyle): DimensionPicture {
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
  const [first, second] = feet as [Point, Point];
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
        // The block points along the line at the second end, and back along it at the first.
        const turned = runAngle + (inward > 0 ? 180 : 0);
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
        // AutoCAD gives the corner to the left of the direction measured first.
        arrowheadEntities.push({
          kind: "solid",
          corners: [move(base, across, size / 6), move(base, across, -size / 6), tip],
        });
      }
    }
  }
  // A tick's dimension line runs past the extension lines, and an arrow's stops at its base.
  const reach = tick ? size : -size;
  const dimensionLine: [Point, Point] = [move(first, run, -reach), move(second, run, reach)];

  const rotation = readable(angle);
  const up: Point = [-Math.sin(rotation * RADIANS), Math.cos(rotation * RADIANS)];
  const quarter = direction(rotation);
  const above: Point = rotation % 90 === 0 ? [-quarter[1], quarter[0]] : up;
  const middle: Point = [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
  const textStyle = style.textStyle;
  return {
    measurement,
    definitionPoint,
    extensionLines,
    dimensionLine,
    arrowheads,
    arrowheadEntities,
    label: {
      value: measurementText(measurement, style, dimension.text),
      at: move(middle, above, sizes.textGap),
      height: sizes.textHeight,
      rotation,
      direction: quarter,
      ...(textStyle === undefined ? {} : { style: textStyle }),
    },
    textMiddle: move(middle, above, sizes.textGap + sizes.textHeight / 2),
  };
}

/**
 * The widest a character of any font in `FONTS` is drawn, as a share of the text's height,
 * before its style's width factor: for the characters of a measurement, the widest AutoCAD lays
 * out in any of them, and for every other character 2, which no character of Latin-1 reaches
 * in any of them.
 */
export const WIDEST_CHARACTERS: Readonly<Record<string, number>> = {
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
  "'": 1.1,
  '"': 1.1,
  " ": 1.1,
};
const WIDEST_CHARACTER = 2;

/**
 * The least a dimension with closed filled arrowheads must measure for AutoCAD to draw its
 * arrowheads between the extension lines, whatever the widths of its font: more than twice the
 * arrow size and twice the gap, and at least the widest its text can be and twice the gap. The
 * widest is each character's width from `WIDEST_CHARACTERS` times the height and the width
 * factor, and the lean of a slanted style once, the height times the tangent of its angle.
 * Undefined for a style whose picture does not depend on that: one with ticks, or with an
 * arrow size of 0.
 *
 * @param text - The text of the dimension as AutoCAD draws it.
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
  const widest = widths * sizes.textHeight * written(textStyle?.widthFactor ?? 1) + lean;
  return Math.max(2 * sizes.arrowSize, widest) + 2 * sizes.textGap;
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
  const drawn = measurementText(measurement, style, dimension.text);
  const problem = dimensionMeasureProblem(
    measurement,
    measurement * written(style.measurementScale ?? 1),
    roundedMeasurement(measurement, style),
    dimension.kind === "aligned-dimension",
    drawn,
    arrowRoom(style, drawn, textStyle),
  );
  if (problem) return problem;
  const picture = dimensionPicture(dimension, style);
  const numbers = [
    ...picture.definitionPoint,
    ...picture.extensionLines.flat(2),
    ...picture.dimensionLine.flat(),
    ...picture.arrowheads.flat(2),
    ...picture.label.at,
    picture.label.height,
    ...picture.textMiddle,
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
