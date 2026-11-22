import { alphaOf, entityTransparencyProblem } from "./transparency.ts";
import { TRUE_COLOR } from "./paragraph-codes.ts";
import { isRgb } from "./colors.ts";
import {
  blocksByKey,
  compose,
  eachDrawn,
  mapPoint,
  referencedByKey,
  type BlockColor,
  type LayerRef,
  type Matrix,
  type Referenced,
  type XrefDrawings,
} from "./blocks.ts";
import { dimensionPicture, pictureTexts, type Dimension, isDimension } from "./dimensions.ts";
import {
  sweep,
  type DimensionStyle,
  type Drawing,
  type Ellipse,
  type Entity,
  type Hatch,
  type HatchPattern,
  type Image,
  type Underlay,
  type Insert,
  type Layer,
  type Leader,
  type Table,
  type TableStyle,
  type LeaderStyle,
  type Line,
  type Linetype,
  type LinetypeMark,
  type LinetypeShape,
  type Rgb,
  type Paragraph,
  type Point,
  type PointEntity,
  type PointStyle,
  type Polyline,
  type Spline,
  type Text,
  type TextStyle,
  type Viewport,
  type Wipeout,
} from "./drawing.ts";
import {
  dimensionMask,
  drawnLoops,
  gradientBoxer,
  type GradientPicture,
  gradientWritten,
  hatchLines,
  type HatchLines,
  hatchSpread,
  loopsBox,
  loopSides,
  maskOf,
  paragraphMaskCorners,
  patternDrawnProblem,
  patternSizes,
  type PatternSizes,
  writtenPoint,
} from "./fills.ts";
import { patternPieces } from "./patterns.ts";
import { pointFigure, pointReach, pointStyleProblems } from "./points.ts";
import {
  arcPoint,
  hasArcsOrWidths,
  isWide,
  mayCurve,
  polylineBands,
  polylineSides,
  PolylineMemo,
  sideArc,
  sideLength,
  type Band,
  type PolylineSide,
  type SideArc,
} from "./polylines.ts";
import { boxer, type Boxer } from "./extents.ts";
import { exactKey, imageCorners, imageDrawable, imageFrame, writtenImagePath } from "./images.ts";
import {
  MISSING_HEIGHT,
  missingLines,
  pageOf,
  missingReach,
  pictureFits,
  underlayAdjusted,
  underlayLook,
  underlayColor,
  underlayCorners,
  underlayDrawable,
  underlayFrame,
  underlayPlacement,
  fromPage,
} from "./underlays.ts";
import {
  base64,
  base64Length,
  hasAlpha,
  opaquePng,
  plotDecodes,
  pngPixels,
  storedPng,
  RASTER_PIXELS,
  rasterInfo,
  withoutExif,
  type RasterInfo,
} from "./raster.ts";

/**
 * The most pixels of a PNG with an alpha channel that a picture decodes and holds again without
 * it: 4 megapixels, 16 MB of samples, where a logo has far fewer and the copy of an aerial would
 * take more memory than a program has.
 */
export const OPAQUE_PIXELS = 4_194_304;

/**
 * Whether an image of a file that plots opaque is pictured from the file as it is, marked
 * `data-opaque`: a PNG with an alpha channel of more than `OPAQUE_PIXELS`.
 */
const markedOpaque = (info: RasterInfo): boolean =>
  info.kind === "png" &&
  (info.color === 4 || info.color === 6) &&
  info.width * info.height > OPAQUE_PIXELS;
import { fontInfo, STANDARD_FONT, capHeightOf } from "./fonts.ts";
import { fifteenDigits, fmt, written } from "./format.ts";
import { layerKey, layerKeys } from "./layers.ts";
import { findLayout, validViewportView } from "./layouts.ts";
import { leaderBlock, leaderBlockKeys, leaderPicture, type LeaderPicture } from "./leaders.ts";
import {
  tableCost,
  tableInserts,
  tableMatrix,
  tableMeasures,
  tableParagraph,
  tablePicture,
  type TablePicture,
} from "./tables.ts";
import { builtInLinetype, LINEWEIGHTS, lineweightCode } from "./linetypes.ts";
import { drawnValue, inStyle, layoutText } from "./measure.ts";
import {
  layoutCellText,
  layoutDimensionText,
  paragraphInStyle,
  paragraphMeasurer,
  paragraphTurn,
  placer,
  type ParagraphLayout,
} from "./paragraphs.ts";
import { arrowheadInfo, DEFAULT_ARROWHEAD } from "./arrowheads.ts";
import { DEFAULT_PLOT_STYLE_TABLE, paperInfo } from "./papers.ts";
import {
  drawnEllipse,
  MARK_ORIENTS,
  shown as quoted,
  SplineMemo,
  tableProblem,
  turning,
  viewportProblem,
  type DrawnEllipse,
  type DrawnSpline,
} from "./rules.ts";
import { ellipsePoint, splinePieces, splinePolyline, unturned } from "./curves.ts";
import { filled, KEYED } from "./shape.ts";
import { shapeFinder, type ShapeDefinition, type ShapeFiles } from "./shapes.ts";
import { isUnits } from "./units.ts";

/**
 * ACI, the color index CAD programs share: the color the leading CAD app plots each index in, from
 * 1 to 255, ten to a row. The entry for index 7 is not used: 7 is black on paper and white on a
 * dark screen, so it draws in currentColor.
 */
const ACI: readonly string[] = [
  "ff0000 ffff00 00ff00 00ffff 0000ff ff00ff 000000 808080 dcdcdc ff0000",
  "ff7f7f dd0000 dd6e6e b80000 b85c5c 950000 954a4a 720000 723939 ff3f00",
  "ff9f7f dd3700 dd8a6e b82e00 b8735c 952500 955d4a 721c00 724739 ff7f00",
  "ffbf7f dd6e00 dda56e b85c00 b88a5c 954a00 95704a 723900 725639 ffbf00",
  "ffdf7f dda500 ddc16e b88a00 b8a15c 957000 95834a 725600 726439 ffff00",
  "ffff7f dddd00 dddd6e b8b800 b8b85c 959500 95954a 727200 727239 bfff00",
  "dfff7f a5dd00 c1dd6e 8ab800 a1b85c 709500 83954a 567200 647239 7fff00",
  "bfff7f 6edd00 a5dd6e 5cb800 8ab85c 4a9500 70954a 397200 567239 3fff00",
  "9fff7f 37dd00 8add6e 2eb800 73b85c 259500 5d954a 1c7200 477239 00ff00",
  "7fff7f 00dd00 6edd6e 00b800 5cb85c 009500 4a954a 007200 397239 00ff3f",
  "7fff9f 00dd37 6edd8a 00b82e 5cb873 009525 4a955d 00721c 397247 00ff7f",
  "7fffbf 00dd6e 6edda5 00b85c 5cb88a 00954a 4a9570 007239 397256 00ffbf",
  "7fffdf 00dda5 6eddc1 00b88a 5cb8a1 009570 4a9583 007256 397264 00ffff",
  "7fffff 00dddd 6edddd 00b8b8 5cb8b8 009595 4a9595 007272 397272 00bfff",
  "7fdfff 00a5dd 6ec1dd 008ab8 5ca1b8 007095 4a8395 005672 396472 007fff",
  "7fbfff 006edd 6ea5dd 005cb8 5c8ab8 004a95 4a7095 003972 395672 003fff",
  "7f9fff 0037dd 6e8add 002eb8 5c73b8 002595 4a5d95 001c72 394772 0000ff",
  "7f7fff 0000dd 6e6edd 0000b8 5c5cb8 000095 4a4a95 000072 393972 3f00ff",
  "9f7fff 3700dd 8a6edd 2e00b8 735cb8 250095 5d4a95 1c0072 473972 7f00ff",
  "bf7fff 6e00dd a56edd 5c00b8 8a5cb8 4a0095 704a95 390072 563972 bf00ff",
  "df7fff a500dd c16edd 8a00b8 a15cb8 700095 834a95 560072 643972 ff00ff",
  "ff7fff dd00dd dd6edd b800b8 b85cb8 950095 954a95 720072 723972 ff00bf",
  "ff7fdf dd00a5 dd6ec1 b8008a b85ca1 950070 954a83 720056 723964 ff007f",
  "ff7fbf dd006e dd6ea5 b8005c b85c8a 95004a 954a70 720039 723956 ff003f",
  "ff7f9f dd0037 dd6e8a b8002e b85c73 950025 954a5d 72001c 723947 545454",
  "767676 989898 bababa dbdbdb fafafa",
]
  .join(" ")
  .split(" ");

/** The color of an ACI index. An index outside 1 to 255 draws like 7, in currentColor. */
function aciColor(index: number): string {
  const rgb = index === 7 ? undefined : ACI[index - 1];
  return rgb === undefined ? "currentColor" : `#${rgb}`;
}

/** The gray `Grayscale.ctb` plots each ACI index in, from 1 to 255, twenty to a row. */
const GRAYSCALE: readonly string[] = [
  "4c e1 95 b2 1d 69 00 7f db 4c a4 42 8e 37 77 2c 5f 22 49 70",
  "b7 62 9f 52 84 41 6a 32 51 96 ca 82 ae 6d 92 57 75 43 5a bc",
  "dc a2 bf 88 9f 6d 80 54 62 e1 ef c3 cf a3 ad 83 8b 64 6a ce",
  "e5 b2 c6 95 a6 78 86 5b 65 ba dc a1 be 87 9f 6d 80 53 61 a7",
  "d2 91 b6 79 98 62 7a 4a 5d 95 c8 81 ad 6c 91 57 75 42 59 9c",
  "cc 87 b0 71 94 5b 77 45 5b a3 cf 8d b3 76 96 5f 79 48 5c aa",
  "d3 93 b7 7b 99 63 7b 4b 5e b2 d7 9a ba 80 9b 67 7d 4e 5f 8d",
  "c4 79 aa 65 8d 51 72 3e 57 67 b2 59 99 4a 80 3b 67 2d 4f 41",
  "9f 39 8a 2f 72 25 5c 1c 46 1d 8c 19 79 14 65 10 51 0c 3e 2f",
  "96 29 82 21 6c 1b 56 14 42 42 a0 39 8a 2f 73 26 5c 1d 46 56",
  "a9 4a 92 3d 7a 31 62 25 4a 69 b3 5b 9b 4b 81 3c 67 2e 4f 61",
  "af 54 98 46 7f 38 65 2b 4e 5a ab 4e 94 41 7c 34 63 28 4c 53",
  "a8 48 91 3c 7a 30 61 25 4b 53 75 97 b9 d9 f8",
]
  .join(" ")
  .split(" ");

/**
 * The color of each pen of `DWF Virtual Pens.ctb`, which it plots each ACI index in, from 1 to
 * 255, ten to a row. A pen holds a color of its own, which is not always the index's.
 */
const VIRTUAL_PENS: readonly string[] = [
  "ff0000 ffff00 00ff00 00ffff 0000ff ff00ff 000000 808080 c0c0c0 ff0101",
  "ff7f7f a50000 a55252 7f0000 7f3f3f 4c0000 4c2626 260000 261313 ff3f00",
  "ff9f7f a52900 a56752 7f1f00 7f4f3f 4c1300 4c2f26 260900 261713 ff7f00",
  "ffbf7f a55200 a57c52 7f3f00 7f5f3f 4c2600 4c3926 261300 261c13 ffbf00",
  "ffdf7f a57c00 a59152 7f5f00 7f6f3f 4c3900 4c4226 261c00 262113 ffff01",
  "ffff7f a5a500 a5a552 7f7f00 7f7f3f 4c4c00 4c4c26 262600 262613 bfff00",
  "dfff7f 7ca500 91a552 5f7f00 6f7f3f 394c00 424c26 1c2600 212613 7fff00",
  "bfff7f 52a500 7ca552 3f7f00 5f7f3f 264c00 394c26 132600 1c2613 3fff00",
  "9fff7f 29a500 67a552 1f7f00 4f7f3f 134c00 2f4c26 092600 172613 01ff01",
  "7fff7f 00a500 52a552 007f00 3f7f3f 004c00 264c26 002600 132613 00ff3f",
  "7fff9f 00a529 52a567 007f1f 3f7f4f 004c13 264c2f 002609 132617 00ff7f",
  "7fffbf 00a552 52a57c 007f3f 3f7f5f 004c26 264c39 002613 13261c 00ffbf",
  "7fffdf 00a57c 52a591 007f5f 3f7f6f 004c39 264c42 00261c 132621 01ffff",
  "7fffff 00a5a5 52a5a5 007f7f 3f7f7f 004c4c 264c4c 002626 132626 00bfff",
  "7fdfff 007ca5 5291a5 005f7f 3f6f7f 00394c 26424c 001c26 132126 007fff",
  "7fbfff 0052a5 527ca5 003f7f 3f5f7f 00264c 26394c 001326 131c26 003fff",
  "7f9fff 0029a5 5267a5 001f7f 3f4f7f 00134c 262f4c 000926 131726 0101ff",
  "7f7fff 0000a5 5252a5 00007f 3f3f7f 00004c 26264c 000026 131326 3f00ff",
  "9f7fff 2900a5 6752a5 1f007f 4f3f7f 13004c 2f264c 090026 171326 7f00ff",
  "bf7fff 5200a5 7c52a5 3f007f 5f3f7f 26004c 39264c 130026 1c1326 bf00ff",
  "df7fff 7c00a5 9152a5 5f007f 6f3f7f 39004c 42264c 1c0026 211326 ff01ff",
  "ff7fff a500a5 a552a5 7f007f 7f3f7f 4c004c 4c264c 260026 261326 ff00bf",
  "ff7fdf a5007c a55291 7f005f 7f3f6f 4c0039 4c2642 26001c 261321 ff007f",
  "ff7fbf a50052 a5527c 7f003f 7f3f5f 4c0026 4c2639 260013 26131c ff003f",
  "ff7f9f a50029 a55267 7f001f 7f3f4f 4c0013 4c262f 260009 261317 545454",
  "767676 989898 bababa dcdcdc fcfcfc",
]
  .join(" ")
  .split(" ");

/**
 * The color a plot style table plots an ACI index in, on paper, where index 7 is black. Under a
 * table that gives each pen a color of its own, an index outside 1 to 255 plots as 7 does.
 */
function plottedColor(table: string, index: number): string {
  if (table === "monochrome.ctb" || index === 7) return "#000000";
  if (table === "Grayscale.ctb") return `#${GRAYSCALE[index - 1]?.repeat(3) ?? "000000"}`;
  if (table === "DWF Virtual Pens.ctb") return `#${VIRTUAL_PENS[index - 1] ?? "000000"}`;
  return aciColor(index);
}

/** The lineweight `DWF Virtual Pens.ctb` plots every pen at, in hundredths of a millimetre. */
const VIRTUAL_PEN_WIDTH = 25.4;

/** The leading CAD app draws a lineweight of "Default" at its LWDEFAULT, 0.25 mm. */
const DEFAULT_LINEWEIGHT = 25;

/**
 * The height of a capital, as a share of the font size, in the screen font that stands in for
 * an SHX font. The fonts themselves are not read, and a screen's own font may differ a little.
 */
const SCREEN_CAP_HEIGHT = 0.7;

/**
 * The most dashes one entity is cut into. The leading CAD app draws a line solid when its pattern
 * is too fine to show, and so does the preview.
 */
const MAX_DASHES = 10000;

/**
 * The most a picture walks that it does not draw: each block the walk of an insert enters, each
 * entity and attribute it reaches that draws nothing, such as one on a layer that is off, each
 * 64 entities of model space a viewport past the first `FREE_VIEWS` looks through for what it
 * shows, and each 32 lengths of a dash pattern scaled for a space. What the walk draws counts
 * against the characters instead.
 */
const MAX_WALKED = 2_000_000;

/**
 * The most characters a picture is written in, for each entity `MAX_WALKED` allows: 500 million
 * in all, under the 536,870,888 a JavaScript string holds.
 */
const CHARACTERS = 250;

/** The fewest items of a list a plan reads that `toSVG` pays for when another plan reads it again. */
const PLANNED = 64;

/** The viewports of a picture that look through model space free of `MAX_WALKED`. */
const FREE_VIEWS = 64;

/** How many elements of an insert are joined into one string as they are made. */
const JOINED = 1024;

/**
 * The format of a picture of a layout, which `svgToPDF` reads: it goes up whenever an element or
 * an attribute of such a picture changes what it means.
 */
export const SHEET_PICTURE = 3;

/** The mark of a line drawn as the thinnest the printer draws: a lineweight of 0, or a border. */
const THINNEST = ` data-thinnest=""`;

export interface SvgOptions {
  /** Margin around the drawing's extents, in drawing units. Defaults to 2% of the larger side. */
  readonly margin?: number;
  /**
   * Stroke width in screen pixels of a line of the default lineweight, 0.25 mm. Other
   * lineweights are drawn in proportion. It stays constant when the SVG scales.
   */
  readonly strokeWidth?: number;
  /** Draws the layers whose `plot` is false too. They are left out by default. */
  readonly drawNoPlot?: boolean;
  /**
   * The bytes of each raster file the drawing's images show, by the image's path exactly as the
   * drawing gives it: a PNG or a JPEG, which the picture holds. An image whose file is missing
   * here, or is neither, is drawn as the leading CAD app draws an image whose file it cannot find:
   * its frame, with its path written inside.
   */
  readonly images?: Readonly<Record<string, Uint8Array>>;
  /**
   * The picture of each page the drawing's underlays show, by the underlay's path exactly as the
   * drawing gives it, then by its page: a PNG of the page with a clear background, as
   * `pdftocairo -png -transp -cropbox` draws one, which the picture holds. Its width over its
   * height must be the page's, to a pixel. An underlay whose page is not given here is drawn as
   * the leading CAD app draws one whose file it cannot find: three lines that say so.
   */
  readonly underlays?: Readonly<Record<string, Readonly<Record<string, Uint8Array>>>>;
  /**
   * The drawing each xref stands for, by the xref's name. An insert of an xref draws the model
   * space of the drawing given here, and nothing when none is given. Given as
   * `{ drawing, xrefs }`, a drawing draws its attachments too, from the drawings its own `xrefs`
   * gives, and so on down. `{ drawing, images }` gives the files of that drawing's images.
   */
  readonly xrefs?: XrefDrawings;
  /**
   * The name of a layout to draw in place of model space: the sheet as it plots. `margin` then
   * defaults to 0, and `strokeWidth` is not used, because a sheet's lines are as wide as their
   * lineweights.
   */
  readonly layout?: string;
  /**
   * The part to draw, in place of the whole: the rectangle `[x0, y0, x1, y1]` from its
   * lower-left corner to its upper-right, in drawing units, or in paper units with `layout`.
   * `margin` then defaults to 0.
   */
  readonly view?: readonly [x0: number, y0: number, x1: number, y1: number];
  /**
   * The bytes of each shape file the drawing's linetypes name, by the file's name, found without
   * regard to case and with or without `.shx`, as `shapeFileKey` finds it. A linetype's shape
   * whose file is not here, does not read, or lacks the shape, leaves its gap, as `lint` warns.
   * The drawing's xrefs find their shapes here too.
   */
  readonly shapes?: ShapeFiles;
  /**
   * Draws each entity's transparency, as CAD programs plot it when told to plot transparency
   * always. Left out, every entity draws opaque, as they plot the page setups tsdraft writes.
   */
  readonly plotTransparency?: boolean;
}

/** How an entity is drawn. */
interface Pen {
  readonly color: string;
  /** The color of the entity's layer, which a paragraph's `\C256;` gives the characters after it. */
  readonly byLayer: string;
  /** The color ByBlock takes where the entity is, which `\C0;` gives the characters after it. */
  readonly byBlock: string;
  /** Undefined for a solid line. */
  readonly dashes: Dashes | undefined;
  /** In hundredths of a millimetre. */
  readonly lineweight: number;
  /**
   * The opacity, from 0 to 255, a dimension or a leader draws its picture at, which it fades in a
   * group of its own: the arrowheads of a block stay opaque, as CAD programs plot them.
   */
  readonly alpha?: number;
}

/**
 * Parts of an entity at an opacity from 0 to 255: in a group, so that where they overlap they are
 * no darker, as CAD programs compose a transparent entity before they fade it.
 */
function fadedGroup(parts: string, alpha: number): string {
  return alpha >= 255 ? parts : `<g opacity="${Number((alpha / 255).toFixed(5))}">${parts}</g>`;
}

/** A dash pattern scaled for a space, worked out once for each entity drawn with it. */
interface Dashes {
  /** Dash, gap, dash, ... in drawing units, starting with a dash. */
  readonly lengths: readonly number[];
  /** What they add up to. */
  readonly total: number;
  /** True when one has no length: a dot, which draws as a round cap. */
  readonly dot: boolean;
  /**
   * The pattern's last dash, which the first of `lengths` starts with when the pattern ends with
   * a dash, and the pattern's own first dash after it, which a line is fitted to. The dashes after
   * that one up to the first gap are the rest of the first of `lengths`.
   */
  readonly trail: number;
  readonly lead: number;
  /** The texts and shapes the pattern draws, where each is along it. */
  readonly marks?: readonly ScaledMark[];
}

/** A linetype's pattern as `alternating` gives it, with where along it each mark is drawn. */
interface LinePattern {
  readonly runs: readonly number[];
  /** The pattern's last dash, joined to the start of its first, and its first, as `Dashes` has them. */
  readonly trail: number;
  readonly lead: number;
  /** Each mark, `at` its distance from the start of `runs`, in the pattern's units. */
  readonly marks: readonly {
    readonly at: number;
    /** True for a mark at the end of the pattern's last length. */
    readonly end: boolean;
    readonly mark: LinetypeMark;
  }[];
}

/** A mark of a pattern scaled for a space. */
interface ScaledMark {
  /** Its distance from the start of the scaled pattern, in the units the pattern is cut in. */
  readonly at: number;
  /** True for a mark at the end of the pattern's last length. */
  readonly end: boolean;
  readonly mark: LinetypeMark;
  /** A text's style, as the drawing has it. */
  readonly style: TextStyle | undefined;
  /** A shape's outlines, as its file holds them. */
  readonly shape?: ShapeDefinition;
  /** What its offset and its height are multiplied by, in the units of the space it is drawn in. */
  readonly size: number;
}

/**
 * The sides of a polyline's points that have a length, which are all a pattern cuts: the points
 * up to the first empty slot, the index of the point each such side ends at, and the longest.
 */
interface Sides {
  readonly points: readonly Point[];
  readonly ends: readonly number[];
  readonly longest: number;
}

/**
 * What a polyline with an arc or a width draws, worked out once a picture, so that a placement
 * does work only for what it draws: each side that has a length, with its arc, the length a
 * pattern is fitted to and,
 * drawn solid, its filled shape and joins, and the longest side.
 */
interface Plan {
  readonly parts: readonly {
    readonly side: PolylineSide;
    readonly arc: SideArc | undefined;
    /**
     * The length a pattern is fitted to: the side's own, or for a wide arc its length along its
     * outer edge, at the larger of its widths.
     */
    readonly fit: number;
    readonly band: Band | undefined;
  }[];
  /** The longest `fit`, which a pattern too fine for draws the whole polyline solid. */
  readonly longest: number;
}

/**
 * What a picture works out once: the sides of each list of points, and the plan of each
 * polyline with an arc or a width, or `null` for one with neither.
 */
interface Known {
  readonly sides: WeakMap<object, Sides>;
  readonly plans: PolylineMemo<Plan | null>;
  /** The curve each ellipse, and each spline's drawn spline, draws, and its flat. */
  readonly curves: WeakMap<object, Curve | null>;
  readonly splines: SplineMemo;
  /**
   * Pays for the lists a plan is about to read, when a list was read for another plan before,
   * or refuses the picture.
   */
  readonly readAgain: (lists: readonly unknown[]) => void;
}

/** A new `Known`, for one picture, which pays for lists read again with `readAgain`. */
function knowing(readAgain: Known["readAgain"] = () => {}): Known {
  return {
    sides: new WeakMap(),
    plans: new PolylineMemo(),
    curves: new WeakMap(),
    splines: new SplineMemo(),
    readAgain,
  };
}

/** What an ellipse or a spline draws, and the flat it is cut into dashes along. */
interface Curve {
  readonly ellipse?: DrawnEllipse;
  readonly spline?: DrawnSpline;
  /** Its points from start to end in its own coordinates, worked out when first dashed. */
  flat?: Flat;
}

/** A curve as points close together, with the length along it to each. */
interface Flat {
  readonly points: readonly Point[];
  readonly lengths: readonly number[];
  /** True for one that closes, whose pattern goes round as a circle's does. */
  readonly closed: boolean;
}

/** The steps an ellipse is cut into for a full turn, and each piece of a spline. */
const ELLIPSE_STEPS = 512;
const SPLINE_STEPS = 32;

/**
 * The curve of an ellipse or a spline, worked out once into `known` for each: none for one of
 * the wrong shape or that `lint` refuses.
 */
function curveOf(e: Ellipse | Spline, known: Known): Curve | undefined {
  let key: object = e;
  let spline: DrawnSpline | undefined;
  if (e.kind === "spline") {
    const fields = e as unknown as Readonly<Record<string, unknown>>;
    spline = known.splines.get(fields, (lists) => {
      known.readAgain(lists);
      return true;
    });
    if (!spline) return undefined;
    key = spline;
  }
  const found = known.curves.get(key);
  if (found !== undefined) return found ?? undefined;
  let made: Curve | null = null;
  if (spline) made = { spline };
  else {
    const ellipse = drawnEllipse(e as Ellipse);
    if (ellipse) made = { ellipse };
  }
  known.curves.set(key, made);
  return made ?? undefined;
}

/** The flat of a curve, in its own coordinates. */
function flatOf(curve: Curve): Flat {
  if (curve.flat) return curve.flat;
  let points: Point[];
  let closed: boolean;
  if (curve.ellipse) {
    const { center, majorAxis, ratio, start, end } = curve.ellipse;
    const from = start ?? 0;
    const turn = start === undefined ? 2 * Math.PI : unturned(end! - from) || 2 * Math.PI;
    const steps = Math.max(8, Math.ceil((ELLIPSE_STEPS * turn) / (2 * Math.PI)));
    points = Array.from({ length: steps + 1 }, (_, k) =>
      ellipsePoint(center, majorAxis, ratio, from + (turn * k) / steps),
    );
    closed = start === undefined;
  } else {
    const { degree, knots, controlPoints, weights } = curve.spline!;
    points = splinePolyline(degree, knots, controlPoints, weights, SPLINE_STEPS);
    closed = curve.spline!.closed;
  }
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1]!, points[i]!];
    lengths.push(lengths[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return (curve.flat = { points, lengths, closed });
}

/**
 * An ellipse, or an arc of one, where `matrix` puts it: the image of an ellipse under the matrix
 * is an ellipse, whose axes come from the images of its two semi-axes, as `rounded` finds them.
 */
function ellipseToSvg(d: DrawnEllipse, matrix: Matrix | undefined, s: string): string {
  const [mx, my] = d.majorAxis;
  const minor: Point = [-my * d.ratio, mx * d.ratio];
  const linear = (v: Point): Point =>
    matrix ? [matrix[0] * v[0] + matrix[2] * v[1], matrix[1] * v[0] + matrix[3] * v[1]] : v;
  const [a, b] = [linear(d.majorAxis), linear(minor)];
  const round = rounded(1, [a[0], a[1], b[0], b[1], 0, 0]);
  const at = (p: Point): Point => (matrix ? mapPoint(matrix, p) : p);
  if (d.start === undefined) return roundToSvg(at(d.center), round, s);
  const turn = unturned(d.end! - d.start);
  const large = turn > Math.PI ? 1 : 0;
  const [start, end] = [d.start, d.end!].map((t) => {
    const [x, y] = at(ellipsePoint(d.center, d.majorAxis, d.ratio, t));
    return `${fmt(x)} ${fmt(y)}`;
  });
  // SVG draws nothing for an arc that ends where it starts.
  if (start === end && large === 1) return roundToSvg(at(d.center), round, s);
  return `<path d="M ${start} A ${fmt(round.rx)} ${fmt(round.ry)} ${fmt(round.turn)} ${large} ${round.sweep} ${end}" ${s}/>`;
}

/**
 * A spline as path data, where `matrix` puts it. One of degree 1 to 3 that is not rational is
 * drawn exactly, as lines or cubic Bézier pieces, a quadratic piece raised to a cubic; any other
 * as the points of its flat.
 */
function splinePath(curve: Curve, matrix: Matrix | undefined): string {
  const spline = curve.spline!;
  const place = ([x, y]: Point): string => {
    const [px, py] = matrix ? mapPoint(matrix, [x, y]) : [x, y];
    return `${fmt(px)} ${fmt(py)}`;
  };
  const parts: string[] = [];
  if (spline.weights !== undefined || spline.degree > 3) {
    flatOf(curve).points.forEach((p, i) => parts.push(`${i === 0 ? "M" : "L"} ${place(p)}`));
    return parts.join(" ");
  }
  const { degree, knots, controlPoints } = spline;
  let last = "";
  for (const piece of splinePieces(degree, knots, controlPoints, undefined)) {
    const q = piece.map(([x, y]): Point => [x, y]);
    const first = place(q[0]!);
    if (first !== last) parts.push(`M ${first}`);
    const end = place(q[degree]!);
    if (degree === 1) parts.push(`L ${end}`);
    else if (degree === 2) {
      const raised = (p: Point): Point => [
        p[0] + ((q[1]![0] - p[0]) * 2) / 3,
        p[1] + ((q[1]![1] - p[1]) * 2) / 3,
      ];
      parts.push(`C ${place(raised(q[0]!))} ${place(raised(q[2]!))} ${end}`);
    } else parts.push(`C ${place(q[1]!)} ${place(q[2]!)} ${end}`);
    last = end;
  }
  return parts.join(" ");
}

/**
 * The plan of a polyline with an arc or a width, or undefined for one with neither, worked out
 * once into `known` for every polyline that holds the same lists.
 */
function planOf(e: Polyline, known: Known): Plan | undefined {
  if (!mayCurve(e)) return undefined;
  const found = known.plans.get(e);
  if (found !== undefined) return found ?? undefined;
  // Telling whether it has an arc or a width reads its bulges and widths, and its plan its points.
  known.readAgain([e.bulges, e.widths]);
  if (!hasArcsOrWidths(e)) {
    known.plans.set(e, null);
    return undefined;
  }
  known.readAgain([e.points]);
  const sides = polylineSides(e);
  const bands = polylineBands(sides, e.closed);
  const parts: Plan["parts"][number][] = [];
  let longest = 0;
  sides.forEach((side, i) => {
    const arc = sideArc(side.from, side.to, side.bulge);
    const length = sideLength(side, arc);
    if (!(length > 0)) return;
    const fit =
      arc && isWide(side)
        ? (arc.radius + Math.max(side.startWidth, side.endWidth) / 2) * Math.abs(arc.sweep)
        : length;
    if (fit > longest) longest = fit;
    parts.push({ side, arc, fit, band: bands[i] });
  });
  const plan = { parts, longest };
  known.plans.set(e, plan);
  return plan;
}

/**
 * Renders a preview SVG of the drawing as it plots. Model Y points up, so the drawing group
 * flips Y. Entities on layers that are off, frozen or set not to plot are left out, and each
 * layer draws in the color the leading CAD app plots its index in. Dashed lines are cut into their
 * dashes, scaled by the drawing's linetype scale, and each line is as wide as its lineweight. A
 * text starts where `measureText` says it plots and is held to the length it plots with
 * `textLength`, with its style's width factor and oblique angle, in the CSS font family
 * tsdraft gives its style's font, which ends in a generic family for a screen that lacks the
 * font. Its element has the height of its capitals in `data-height`, and its font size is that
 * height over the cap height of its font. Each entity's element has its layer in `data-layer`,
 * its index in `drawing.entities` in `data-entity`, and its `id`, when it has one, in `data-id`.
 *
 * An insert is a group with its block's name in `data-block`. It holds an element for each
 * entity of the block, and of the blocks inserted in it, drawn where the insert puts it, and a
 * text for each attribute with the insert's value. An entity on layer `0` of a block draws as
 * its insert's layer does, and any other as its own layer does, which `data-layer` names. An
 * insert on a frozen layer, or on a layer that does not plot, draws nothing.
 *
 * An insert of an xref is such a group too, with the xref's path in `data-xref`. `toSVG` opens
 * no file, so it draws the drawing given for the xref in `options.xrefs`, as the leading CAD app
 * draws a loaded xref: an entity on layer `0` there draws as the insert's layer does, and any other
 * as its own layer of the referenced drawing does, in that layer's color, linetype, lineweight
 * and state, with `data-layer` naming it as that app does, `XREF|LAYER`. Dashes are scaled by
 * this drawing's linetype scale. The group is empty for an xref with no drawing given. A drawing
 * given as `{ drawing, xrefs }` draws each of its attachments the same way, inside the group,
 * with a layer of the attached drawing named by the attachment's name, and none of its
 * overlays, as that app loads no overlay of a referenced drawing. A circular reference is
 * broken where it would draw a drawing the chain above already draws, as that app breaks one,
 * and a chain is followed 16 drawings down; `lint` with the same `xrefs` reports both.
 *
 * With `options.layout`, the picture is that layout as the leading CAD app plots it, in paper
 * units: a white sheet the size of its paper, each viewport as a group with its index in
 * `data-viewport` that shows model space at the viewport's scale, clipped to its rectangle,
 * and then what is drawn on the sheet. Every line is as wide as its lineweight on the paper,
 * a dash is as long on the paper as its pattern times the linetype scale, in a viewport too,
 * and colors are the ones the layout's plot style table plots: black for `monochrome.ctb`.
 * `DWF Virtual Pens.ctb` plots every line 0.254 mm wide, whatever its lineweight. A
 * viewport's border is drawn as the thinnest line, or 0.254 mm wide under that table, when its
 * layer is on, thawed and set to plot, and its view is drawn whatever its layer's state. `data-entity` counts the layout's
 * entities, and inside a viewport's group the entities of model space. Every line of a sheet
 * ends and joins round, as a plotted pen does. The picture's format is its `data-picture`,
 * which `svgToPDF` reads; a line drawn as the thinnest the printer draws, a border or a line
 * of lineweight 0, has `data-thinnest`; the white of the paper has `data-paper-sheet`; and each
 * text has the font its style names in `data-font`, empty for a font that is not one of
 * `FONTS`.
 *
 * With `options.view`, the picture is that rectangle of the space: what lies well outside it is
 * left out, and a layout's viewports are cut to it.
 *
 * A list is read up to its first empty slot, where `lint` reports it.
 *
 * @throws RangeError when the drawing has no layout of the name `options.layout`, when
 *   `options.view` is not four finite numbers with a width and a height, and when the picture
 *   is larger than `toSVG` draws: it would be longer than 500,000,000 characters, or its walk
 *   of inserts would reach more than 2,000,000 blocks and entities that draw nothing, such as
 *   blocks nested to draw millions.
 *   Its message names the entity or the viewport it stopped at. Draw a part of such a drawing
 *   with `options.view`.
 */
export function toSVG(drawing: Drawing, options: SvgOptions = {}): string {
  return svgWithin(drawing, options, MAX_WALKED);
}

/** `toSVG` with `most` entities walked, and `most` times `CHARACTERS` characters written. */
export function svgWithin(drawing: Drawing, options: SvgOptions, most: number): string {
  const xrefs = referencedByKey(drawing, options.xrefs);
  const { tablesOf, layerOf, hidden, frozen, styleOf, key } = visibility(
    drawing,
    options.drawNoPlot,
  );
  // The first xref of each name, as `findXref` finds it.
  const xrefPaths = new Map<string, string>();
  for (const xref of filled(drawing.xrefs)) {
    if (!xrefPaths.has(key(xref.name))) xrefPaths.set(key(xref.name), xref.path);
  }
  const builtIns = new Map<string, ReturnType<typeof builtInLinetype>>();
  const builtIn = (name: string) => {
    if (!builtIns.has(name)) builtIns.set(name, builtInLinetype(name));
    return builtIns.get(name);
  };
  const blocks = blocksByKey(drawing.blocks);
  const view = viewOf(options.view);
  let work = 0;
  /** Counts the cost of a step, and says whether there is room left to take it. */
  const spend = (cost: number): boolean => (work += cost) <= most;
  let length = 0;
  const longest = most * CHARACTERS;
  /** Counts characters the picture writes, and says whether it has room for them. */
  const write = (characters: number): boolean => (length += characters) <= longest;
  const refuse = (where: string, boxing = false): never => {
    throw new RangeError(
      boxing
        ? `The extents of what the picture holds take more work than toSVG does, ${most} units: it stopped at ${where}, where inserts or the prefixes and suffixes of dimension styles repeat more than it reads`
        : length > longest
          ? `The picture is longer than toSVG writes, ${longest} characters: it stopped at ${where}. Draw a part of it with view`
          : `The picture walks more than toSVG does for one, ${most} blocks and entities that inserts reach and that draw nothing, or that viewports look through 64 at a time: it stopped at ${where}. Draw a part of it with view, or nest fewer inserts`,
    );
  };
  /** Where an entity of a space is, as a message names it. */
  const entityAt = (index: number, e: Entity, space: string): string =>
    `${e.kind === "insert" ? "insert" : "entity"} #${index} of ${space}`;
  /** The boxes of model space, made once for the picture, which reads each block once. */
  let boxes: Boxer | undefined;
  const boxesOf = (): Boxer =>
    (boxes ??= boxer(
      drawing.textStyles,
      drawing.blocks,
      hidden,
      frozen,
      xrefs,
      drawing.dimensionStyles,
      drawing.leaderStyles,
      most,
      most,
      drawing.tableStyles,
    ));
  const boxOf = (entities: readonly Entity[], at: (e: Entity) => string) => {
    const boxes = boxesOf();
    const box = boxes(entities);
    if (boxes.capped) refuse(at(boxes.capped), true);
    return box;
  };
  /**
   * The picture of each leader, worked out once for the picture, so that a leader an xref holds
   * costs what it writes each time an insert places it, and its shafts' sides are found once.
   */
  const pictures = new WeakMap<
    Leader,
    { style: LeaderStyle; textStyle: TextStyle | undefined; picture: LeaderPicture }
  >();
  const pictureOf = (
    e: Leader,
    style: LeaderStyle,
    textStyle: TextStyle | undefined,
  ): LeaderPicture => {
    const known = pictures.get(e);
    if (known?.style === style && known.textStyle === textStyle) return known.picture;
    const picture = leaderPicture(e, style, textStyle, (name) => blocks.get(key(name)));
    pictures.set(e, { style, textStyle, picture });
    return picture;
  };
  /** The picture of each table, worked out once for the picture. */
  /**
   * The box of each block a table's cell holds, by its drawing: of every entity of the block,
   * hidden or not, as the writers box it, so a cell's block takes the scale the file holds.
   */
  const blockBoxes = new Map<
    Drawing,
    {
      readonly box: Boxer;
      readonly known: Map<string, readonly [number, number, number, number] | undefined>;
    }
  >();
  const plainBoxOf = (of: Drawing, name: string) => {
    let held = blockBoxes.get(of);
    if (!held) {
      held = {
        box: boxer(
          of.textStyles,
          of.blocks,
          undefined,
          undefined,
          undefined,
          of.dimensionStyles,
          of.leaderStyles,
          most,
          most,
          of.tableStyles,
        ),
        known: new Map(),
      };
      blockBoxes.set(of, held);
    }
    const k = key(name);
    if (!held.known.has(k)) {
      const found = held.box([{ kind: "insert", layer: "0", block: name, at: [0, 0] }]);
      if (held.box.capped) refuse(drawingAt?.() ?? "a table", true);
      held.known.set(k, found);
    }
    return held.known.get(k);
  };
  /** The picture of each table, worked out once for each drawing it is drawn from. */
  const tablePictures = new WeakMap<Table, Map<Referenced | undefined, TablePicture | undefined>>();
  const tablePictureOf = (e: Table, from?: Referenced): TablePicture | undefined => {
    let byFrom = tablePictures.get(e);
    if (!byFrom) tablePictures.set(e, (byFrom = new Map()));
    if (byFrom.has(from)) return byFrom.get(from);
    byFrom.set(from, undefined);
    // A table or a style the rules refuse draws nothing. Its cells are paid for before they are
    // read, as the picture's other work is.
    if (typeof e.style !== "string") return undefined;
    if (!spend(tableCost(e))) refuse(drawingAt?.() ?? "a table");
    const tables = tablesOf(from);
    const style = tables.tableStyles.get(key(e.style));
    if (style === undefined || tableProblem(e) !== undefined) return undefined;
    const picture = tablePicture(
      e,
      style,
      tableMeasures(
        (name) => (name === undefined ? undefined : tables.textStyles.get(key(name))),
        (name) => plainBoxOf(from?.drawing ?? drawing, name),
      ),
    );
    byFrom.set(from, picture);
    return picture;
  };
  /** The layout of each paragraph, a long value laid out once for the picture. */
  const paragraphs = paragraphMeasurer();
  /**
   * Each raster file the picture holds, by the files it was given in and the path it was given
   * by: the drawing's own, or a referenced drawing's, whose paths start from its own folder.
   */
  /** A file the picture can hold, and the id of each of its two pictures once written. */
  interface Raster {
    readonly bytes: Uint8Array;
    readonly info: RasterInfo;
    /** False for a file the plot cannot draw, which the picture draws as a file not given. */
    readonly plotted: boolean;
    /** Its pixels as they are, and with any transparency left out; null for one not read. */
    shown?: string | null;
    opaque?: string | null;
  }
  // Keyed exactly, since a path may be long.
  const rasters = new WeakMap<object, Map<string, Raster | null>>();
  let rastersHeld = 0;
  /** Whether each clip an image gives can be drawn, read once however many images share it. */
  const clipsChecked = new WeakMap<object, boolean>();
  const defs: string[] = [];
  let clips = 0;
  let gradients = 0;
  /**
   * The id of a gradient's picture where `matrix` puts it, held in the definitions, or undefined
   * when the picture has no room for it.
   */
  const shade = (picture: GradientPicture, matrix: Matrix | undefined): string | undefined => {
    const id = `tsdraft-gradient-${gradients++}`;
    const frame = (matrix ? compose(matrix, picture.frame) : picture.frame).map(precise).join(" ");
    const stops = picture.stops
      .map(({ offset, color }) => `<stop offset="${precise(offset)}" stop-color="${hex(color)}"/>`)
      .join("");
    const shape =
      picture.kind === "linear"
        ? `linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0"`
        : `radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1"`;
    const def = `<${shape} spreadMethod="pad" gradientTransform="matrix(${frame})">${stops}</${picture.kind}Gradient>`;
    if (!write(def.length)) return undefined;
    defs.push(def);
    return id;
  };
  /**
   * The raster file of an image's path, read once for the picture, or null for none it draws. An
   * image of a referenced drawing, `from`, takes its file from that drawing's files alone.
   */
  const rasterOf = (e: Image, from: Referenced | undefined): Raster | null => {
    const given: unknown = from === undefined ? options.images : from.images;
    if (typeof given !== "object" || given === null) return null;
    let held = rasters.get(given);
    if (!held) rasters.set(given, (held = new Map()));
    const key = exactKey(e.path);
    let found = held.get(key);
    if (found === undefined) {
      const item = Object.getOwnPropertyDescriptor(given, e.path);
      const bytes = item && item.value instanceof Uint8Array ? item.value : undefined;
      const info = bytes === undefined ? undefined : rasterInfo(bytes);
      // A PNG the plot must decode and cannot, past `RASTER_PIXELS`, is drawn by neither.
      const plotted =
        info !== undefined &&
        (info.kind !== "png" || !plotDecodes(info) || info.width * info.height <= RASTER_PIXELS);
      found = info === undefined ? null : { bytes: bytes!, info, plotted };
      held.set(key, found);
    }
    // Every image of a file is held to its pixels, whichever drawing it is in.
    const info = found?.info;
    if (info !== undefined && (info.width !== e.pixels[0] || info.height !== e.pixels[1])) {
      throw new RangeError(
        `The file of the image ${quoted(e.path)} is ${info.width} by ${info.height} pixels, and the drawing gives it ${e.pixels[0]} by ${e.pixels[1]}: the leading CAD app would plot it at the wrong size. Give it the file's pixels, which rasterSize reads`,
      );
    }
    return found;
  };
  /**
   * The id of the picture's image of a file, written the first time an image shows it: as it is,
   * or for an image not marked transparent, with its transparency left out, as the leading CAD
   * app plots one. A renderer drops the colors of a pixel of no alpha, which that app shows, so
   * the picture holds the file again without its alpha, up to `OPAQUE_PIXELS`: past them it holds
   * the file, and marks the image `data-opaque` for the plot. Null for a file that does not decode.
   */
  const rasterId = (raster: Raster, opaque: boolean, path: string): string | null => {
    const { info } = raster;
    const copy = opaque && hasAlpha(info) && !markedOpaque(info);
    const known = copy ? raster.opaque : raster.shown;
    if (known !== undefined) return known;
    let bytes: Uint8Array | undefined = raster.bytes;
    if (info.kind === "jpeg") bytes = withoutExif(bytes);
    else if (copy && info.kind === "png") bytes = opaquePng(info, bytes);
    let id: string | null = null;
    if (bytes !== undefined) {
      id = `tsdraft-image-${rastersHeld++}`;
      const kind = info.kind === "png" ? "image/png" : "image/jpeg";
      const head = `<image id="${id}" width="1" height="1" preserveAspectRatio="none" data-pixels="${info.width} ${info.height}" href="data:${kind};base64,`;
      // Charged before it is encoded, so a file too long for the picture is refused unread.
      if (!write(head.length + base64Length(bytes.length) + 11))
        refuse(`the image ${quoted(path)}`);
      defs.push(`${head}${base64(bytes)}"/>`);
    }
    if (copy) raster.opaque = id;
    else raster.shown = id;
    return id;
  };
  /**
   * An image: its file mapped onto its corners and cut to its clip, then its frame in its pen.
   * One whose file is not given, or is not one the picture can hold, is its frame with its path
   * inside it, as the leading CAD app draws one whose file it cannot find.
   */
  const imageElement = (
    e: Image,
    mark: string,
    pen: Pen,
    look: Look,
    from: Referenced | undefined,
    matrix: Matrix | undefined,
    room: number,
  ): string => {
    const at = (p: Point): Point => (matrix ? mapPoint(matrix, p) : p);
    const raster = rasterOf(e, from);
    const shown =
      raster === null || !raster.plotted ? null : rasterId(raster, e.transparent !== true, e.path);
    const parts: string[] = [];
    // A closed outline, back to its first point, as a path of moves and lines.
    const ring = (points: readonly Point[]) =>
      [...points, points[0]!]
        .map(at)
        .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${precise(x)} ${precise(y)}`)
        .join(" ");
    if (shown !== null) {
      const [p0, p1, , p3] = imageCorners(e).map(at) as [Point, Point, Point, Point];
      // The unit square of the picture's image, its top row first, onto the image's corners.
      const place = [p1[0] - p0[0], p1[1] - p0[1], p0[0] - p3[0], p0[1] - p3[1], p3[0], p3[1]]
        .map(precise)
        .join(" ");
      // A file too large to hold again is the file, which the plot shows opaque.
      const marked = e.transparent !== true && markedOpaque(raster!.info);
      const use = `<use href="#${shown}" transform="matrix(${place})"${marked ? ` data-opaque=""` : ""}/>`;
      if (e.clip === undefined) parts.push(use);
      else {
        const id = `tsdraft-image-clip-${clips++}`;
        const outline = ring(imageFrame(e));
        const d = e.invertClip ? `${ring(imageCorners(e))} ${outline}` : outline;
        const rule = e.invertClip ? ` clip-rule="evenodd"` : "";
        parts.push(
          `<clipPath id="${id}"><path d="${d}"${rule}/></clipPath>`,
          `<g clip-path="url(#${id})">${use}</g>`,
        );
      }
    } else {
      // The path as the file holds it, centered, as high as the image is wide over its letters.
      const value = writtenImagePath(e.path);
      const corners = imageCorners(e);
      const middle: Point = [
        (corners[0][0] + corners[2][0]) / 2,
        (corners[0][1] + corners[2][1]) / 2,
      ];
      const text: Text = {
        kind: "text",
        layer: e.layer,
        at: middle,
        height: e.width / Math.max(1, value.length),
        value,
        rotation: e.rotation ?? 0,
        align: "center",
        valign: "middle",
      };
      parts.push(entityToSvg(text, "", pen, look, undefined, matrix, room));
    }
    if (drawing.imageFrame !== false) {
      parts.push(
        `<path d="${ring(imageFrame(e))}" stroke="${pen.color}"${look.stroke(pen.lineweight)}/>`,
      );
    }
    return `<g ${mark} data-image="">${parts.join("")}</g>`;
  };
  /**
   * What each page's picture given is, read once, and the id of its image the picture holds in
   * each set of colors.
   */
  const pages = new WeakMap<
    object,
    { info: ReturnType<typeof rasterInfo>; ids: Map<string, string | null> }
  >();
  /**
   * The id of the picture's image of an underlay's page, in the colors it plots in, written the
   * first time an underlay shows it, or null for a page not given or not a PNG it can draw.
   */
  const pageId = (e: Underlay, from: Referenced | undefined): string | null => {
    const given: unknown = from === undefined ? options.underlays : undefined;
    if (typeof given !== "object" || given === null) return null;
    const pagesOf = Object.getOwnPropertyDescriptor(given, e.path)?.value as unknown;
    if (typeof pagesOf !== "object" || pagesOf === null) return null;
    const item = Object.getOwnPropertyDescriptor(pagesOf, pageOf(e));
    const bytes = item && item.value instanceof Uint8Array ? item.value : undefined;
    if (bytes === undefined) return null;
    let read = pages.get(bytes);
    if (!read) pages.set(bytes, (read = { info: rasterInfo(bytes), ids: new Map() }));
    const { info, ids: held } = read;
    const adjust = underlayLook(e);
    const key = underlayAdjusted(e) ? `${adjust.fade},${adjust.contrast},${adjust.monochrome}` : "";
    // The page's picture is held to the page's shape, to a pixel.
    if (
      info !== undefined &&
      info.kind === "png" &&
      !pictureFits(info.width, info.height, e.pageSize)
    ) {
      const [w, h] = e.pageSize;
      throw new RangeError(
        `The picture of page ${pageOf(e)} of ${quoted(e.path)} is ${info.width} by ${info.height} pixels, and the page is ${w} by ${h} inches: the picture must have the page's shape. Draw it from the page's crop box`,
      );
    }
    const known = held.get(key);
    if (known !== undefined) return known;
    let id: string | null = null;
    if (info !== undefined && info.kind === "png" && info.width * info.height <= RASTER_PIXELS) {
      let png: Uint8Array | undefined = bytes;
      if (key !== "") {
        // The colored picture is stored, four bytes a pixel: refused before it is drawn.
        const stored = base64Length(info.width * info.height * 4);
        if (length + stored > longest) {
          length += stored;
          refuse(`the picture of ${quoted(e.path)}`);
        }
        const pixels = pngPixels(info);
        png = undefined;
        if (pixels !== undefined) {
          const { width, height, channels, samples } = pixels;
          const out = new Uint8Array(width * height * 4);
          for (let i = 0; i < width * height; i++) {
            const gray = channels <= 2;
            const at = i * channels;
            const rgb = underlayColor(
              gray
                ? [samples[at]!, samples[at]!, samples[at]!]
                : [samples[at]!, samples[at + 1]!, samples[at + 2]!],
              adjust,
            );
            out.set(rgb, i * 4);
            out[i * 4 + 3] = channels === 2 || channels === 4 ? samples[at + channels - 1]! : 255;
          }
          png = storedPng(width, height, 4, out);
        }
      }
      if (png !== undefined) {
        id = `tsdraft-image-${rastersHeld++}`;
        const head = `<image id="${id}" width="1" height="1" preserveAspectRatio="none" data-pixels="${info.width} ${info.height}" href="data:image/png;base64,`;
        if (!write(head.length + base64Length(png.length) + 11))
          refuse(`the picture of ${quoted(e.path)}`);
        defs.push(`${head}${base64(png)}"/>`);
      }
    }
    held.set(key, id);
    return id;
  };
  /**
   * An underlay: its page's picture mapped onto its corners and cut to its clip, then its frame in
   * its pen. One turned off is its frame alone. One whose page is not given is three lines at its
   * insertion point that say its file is missing, as the leading CAD app writes them, and no
   * frame.
   */
  const underlayElement = (
    e: Underlay,
    mark: string,
    pen: Pen,
    look: Look,
    from: Referenced | undefined,
    matrix: Matrix | undefined,
    room: number,
  ): string => {
    const at = (p: Point): Point => (matrix ? mapPoint(matrix, p) : p);
    const ring = (points: readonly Point[]) =>
      [...points, points[0]!]
        .map(at)
        .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${precise(x)} ${precise(y)}`)
        .join(" ");
    const parts: string[] = [];
    const on = e.on !== false;
    const shown = on ? pageId(e, from) : null;
    if (shown !== null) {
      const [p0, p1, , p3] = underlayCorners(e).map(at) as [Point, Point, Point, Point];
      const place = [p1[0] - p0[0], p1[1] - p0[1], p0[0] - p3[0], p0[1] - p3[1], p3[0], p3[1]]
        .map(precise)
        .join(" ");
      const use = `<use href="#${shown}" transform="matrix(${place})"/>`;
      if (e.clip === undefined) parts.push(use);
      else {
        const id = `tsdraft-image-clip-${clips++}`;
        const outline = ring(underlayFrame(e));
        const d = e.invertClip ? `${ring(underlayCorners(e))} ${outline}` : outline;
        const rule = e.invertClip ? ` clip-rule="evenodd"` : "";
        parts.push(
          `<clipPath id="${id}"><path d="${d}"${rule}/></clipPath>`,
          `<g clip-path="url(#${id})">${use}</g>`,
        );
      }
    } else if (on) {
      const { at: corner, u, v } = underlayPlacement(e);
      const scale = Math.hypot(u[0], u[1]);
      for (const line of missingLines(e)) {
        const text: Text = {
          kind: "text",
          layer: e.layer,
          at: fromPage(corner, u, v, line.at),
          height: MISSING_HEIGHT * scale,
          value: line.value,
          rotation: e.rotation ?? 0,
        };
        parts.push(entityToSvg(text, "", pen, look, undefined, matrix, room));
      }
    }
    if ((shown !== null || !on) && (drawing.underlayFrame ?? true) === true) {
      parts.push(
        `<path d="${ring(underlayFrame(e))}" stroke="${pen.color}"${look.stroke(pen.lineweight)}/>`,
      );
    }
    return `<g ${mark} data-image="">${parts.join("")}</g>`;
  };
  /**
   * The element of an entity that draws something of its own, where `matrix` puts it. Its
   * dashes stop once they pass the room left in the picture, and `write` then refuses it.
   */
  const drawn = (
    e: Drawn,
    mark: string,
    drawnPen: Pen,
    look: Look,
    from?: Referenced,
    matrix?: Matrix,
  ): string => {
    const room = longest - length;
    if (e.kind === "paragraph") {
      const style = styleOf(e, from);
      const layout = () => paragraphs.layout(paragraphInStyle(e, style));
      return paragraphToSvg(e, layout, mark, drawnPen, look, matrix, room);
    }
    if (e.kind === "leader") {
      const tables = tablesOf(from);
      const style = tables.leaderStyles.get(key(e.style));
      const named = e.textStyle ?? style?.textStyle;
      const textStyle = named === undefined ? undefined : tables.textStyles.get(key(named));
      const picture = style === undefined ? undefined : pictureOf(e, style, textStyle);
      const layOut = () => paragraphs.layout(paragraphInStyle(picture!.note, textStyle));
      return leaderToSvg(e, picture, layOut, mark, drawnPen, look, matrix, room, sides);
    }
    if (e.kind === "table") {
      const tables = tablesOf(from);
      const styleOf = (name: string | undefined) =>
        name === undefined ? undefined : tables.textStyles.get(key(name));
      return tableToSvg(
        e,
        tablePictureOf(e, from),
        styleOf,
        mark,
        drawnPen,
        look,
        matrix,
        room,
        sides,
      );
    }
    if (e.kind === "image") {
      // One whose fields cannot be drawn, which `lint` refuses, draws nothing.
      return imageDrawable(e, clipsChecked)
        ? imageElement(e, mark, drawnPen, look, from, matrix, room)
        : "";
    }
    if (e.kind === "underlay") {
      return underlayDrawable(e, clipsChecked)
        ? underlayElement(e, mark, drawnPen, look, from, matrix, room)
        : "";
    }
    if (e.kind === "hatch") {
      const found = tablesOf(from).hatchPatterns;
      // A pattern whose lines cannot be placed, which `lint` refuses, is one the drawing lacks.
      const patternOf = (name: string) => {
        const pattern = name.length > KEYED ? undefined : found.get(layerKey(name));
        return pattern !== undefined && sizesOf(pattern) !== undefined ? pattern : undefined;
      };
      // The walk of a pattern's lines is paid for as the picture's other work is, and placing
      // them by their number and their dashes'.
      const step = (cost: number) => spend(cost) || refuse(drawingAt?.() ?? "a hatch");
      const placing = (pattern: HatchPattern) => {
        const sizes = sizesOf(pattern);
        if (sizes !== undefined) step(Math.floor(sizes.items / 16));
        return sizes;
      };
      return hatchToSvg(e, mark, drawnPen, look, matrix, room, patternOf, placing, step, (p) =>
        shade(p, matrix),
      );
    }
    if (e.kind === "wipeout") {
      const frame = (from?.drawing ?? drawing).wipeoutFrame !== false;
      return wipeoutToSvg(e, mark, drawnPen, look, matrix, frame);
    }
    if (!isDimension(e)) {
      return entityToSvg(e, mark, drawnPen, look, styleOf(e, from), matrix, room, sides);
    }
    const tables = tablesOf(from);
    const style = tables.dimensionStyles.get(key(e.style));
    const textStyle =
      style?.textStyle === undefined ? undefined : tables.textStyles.get(key(style.textStyle));
    return dimensionToSvg(e, style, textStyle, mark, drawnPen, look, matrix, room);
  };

  /** The sizes of each list of a hatch pattern's lines, read once for the picture. */
  const linesRead = new WeakMap<object, PatternSizes | undefined>();
  const dashesRead = new WeakMap<object, number | undefined>();
  const sizesOf = (pattern: HatchPattern): PatternSizes | undefined => {
    const lines: unknown = pattern.lines;
    if (typeof lines !== "object" || lines === null) return undefined;
    if (!linesRead.has(lines)) linesRead.set(lines, patternSizes(lines, dashesRead));
    return linesRead.get(lines);
  };
  /** The sides of each list of points a pattern cuts, read once for the picture. */
  // A long list that one polyline's plan read and another's reads again is paid for, as `lint`
  // pays for it, by the entity drawn at the time.
  let drawingAt: (() => string) | undefined;
  const planned = new WeakSet<object>();
  const sides = knowing((lists) => {
    let cost = 0;
    for (const list of lists) {
      if (!Array.isArray(list) || list.length < PLANNED) continue;
      if (planned.has(list)) cost += Math.floor(list.length / 8);
      else planned.add(list);
    }
    if (cost > 0 && !spend(cost)) refuse(drawingAt?.() ?? "a polyline");
  });

  /** Each pattern scaled for each space, worked out when first drawn with. */
  const scaled = new Map<LinePattern, Map<number, Dashes>>();
  const findShape = shapeFinder(options.shapes);
  const fading = options.plotTransparency === true;
  /**
   * The blocks a leader places, of the drawing and of each it references, worked out once each:
   * they hold all they draw ByBlock, as CAD programs read them.
   */
  const leaderKeys = new Map<Drawing, ReadonlySet<string>>();
  const leaderHeld = fading
    ? (from: Referenced | undefined): ReadonlySet<string> => {
        const of = from?.drawing ?? drawing;
        let keys = leaderKeys.get(of);
        if (keys === undefined) leaderKeys.set(of, (keys = leaderBlockKeys(of)));
        return keys;
      }
    : undefined;
  /**
   * The opacity an entity draws at, from 0 to 255: its own, the insert's that holds it for
   * ByBlock, and opaque for ByLayer, since a layer has no transparency. Opaque unless asked.
   */
  const alphaFor = (own: unknown, byBlock: number | undefined, kind?: string): number => {
    // CAD programs plot a table's grid opaque, and the writers write it none.
    if (!fading || kind === "table") return 255;
    if (own === "ByBlock") return byBlock ?? 255;
    return typeof own === "number" && entityTransparencyProblem(own) === undefined
      ? alphaOf(own)
      : 255;
  };
  /**
   * An entity's element at its opacity: in a group, so that where its parts overlap it is no
   * darker, as CAD programs compose a transparent entity before they fade it.
   */
  const faded = (element: string, alpha: number): string => fadedGroup(element, alpha);
  /** The pen of an entity at `alpha`: a dimension and a leader fade their own pictures. */
  const fadedPen = (e: Entity, pen: Pen, alpha: number): Pen =>
    alpha < 255 && (isDimension(e) || e.kind === "leader") ? { ...pen, alpha } : pen;
  /** The opacity of the group around an entity: none for one that fades its own picture. */
  const groupAlpha = (e: Entity, alpha: number): number =>
    isDimension(e) || e.kind === "leader" ? 255 : alpha;
  /** Each pattern's marks scaled for a space, by its scale and size. */
  const marked = new Map<LinePattern, Map<string, Dashes>>();
  const dashesOf = (
    pattern: LinePattern,
    scale: number,
    where: () => string,
    size: number,
    styles: ReadonlyMap<string, TextStyle>,
  ): Dashes => {
    let byScale = scaled.get(pattern);
    if (!byScale) scaled.set(pattern, (byScale = new Map()));
    let found = byScale.get(scale);
    if (!found) {
      // A pattern the leading CAD app takes has at most 12 lengths, but one given as data may hold any number.
      if (!spend(Math.floor((pattern.runs.length + pattern.marks.length) / 32))) refuse(where());
      const lengths = pattern.runs.map((length) => length * scale);
      found = {
        lengths,
        total: lengths.reduce((a, b) => a + b, 0),
        // A gap of 0 is a pattern's of dashes alone.
        dot: lengths.some((length, i) => i % 2 === 0 && length === 0),
        trail: pattern.trail * scale,
        lead: pattern.lead * scale,
      };
      byScale.set(scale, found);
    }
    if (pattern.marks.length === 0) return found;
    let bySpace = marked.get(pattern);
    if (!bySpace) marked.set(pattern, (bySpace = new Map()));
    const space = `${scale} ${size}`;
    const known = bySpace.get(space);
    if (known) return known;
    if (!spend(Math.floor(pattern.marks.length / 32))) refuse(where());
    const made: Dashes = {
      ...found,
      // A shape its file does not give leaves its gap.
      marks: pattern.marks.flatMap(({ at, end, mark }): ScaledMark[] => {
        const found = "shape" in mark ? findShape(mark.file, mark.shape as number) : undefined;
        if (found !== undefined && !("shape" in found)) return [];
        return [
          {
            at: at * scale,
            end,
            mark,
            style: fontOnly(
              "text" in mark && typeof mark.style === "string"
                ? styles.get(key(mark.style))
                : undefined,
            ),
            ...(found === undefined ? {} : { shape: found.shape }),
            size,
          },
        ];
      }),
    };
    bySpace.set(space, made);
    return made;
  };

  /**
   * The pen of an entity that draws on `on`. `insertLayer` is the layer of the insert that
   * holds it, whose linetype and lineweight an entity set to ByBlock takes. `from` is the
   * referenced drawing the entity is in, whose linetypes it names. `where` names the entity of
   * the space it is drawn for.
   */
  const pen = (
    look: Look,
    e: Pick<Line, "linetype" | "lineweight" | "color">,
    on: LayerRef,
    where: () => string,
    insertLayer?: LayerRef,
    from?: Referenced,
    placed = 1,
    byBlock?: BlockColor,
  ): Pen => {
    const layer: Layer | undefined = layerOf(on);
    const byLayer = layer?.color ?? 7;
    const blockShade =
      byBlock === undefined
        ? 7
        : "color" in byBlock
          ? byBlock.color
          : (layerOf(byBlock.layer)?.color ?? 7);
    const own: unknown = e.color;
    const shade =
      own === "ByBlock" ? blockShade : typeof own === "number" || isRgb(own) ? own : byLayer;
    /**
     * The layer a linetype or a lineweight comes from, with the drawing whose layer it is, or
     * `"own"` for the entity's own.
     */
    const source = (
      value: string | number | undefined,
    ): { readonly layer: Layer | undefined; readonly of: Referenced | undefined } | "own" => {
      const name = typeof value === "string" ? builtIn(value) : undefined;
      if (value === undefined || name === "ByLayer") return { layer, of: on.of };
      // An insert draws ByLayer, so ByBlock is the insert's layer.
      if (name === "ByBlock" && insertLayer !== undefined) {
        return { layer: layerOf(insertLayer), of: insertLayer.of };
      }
      return "own";
    };
    const linetypeFrom = source(e.linetype);
    const linetype = linetypeFrom === "own" ? e.linetype : linetypeFrom.layer?.linetype;
    // A layer's linetype is one of the layer's drawing, and an entity's one of the entity's.
    const named = linetypeFrom === "own" ? from : linetypeFrom.of;
    const pattern =
      linetype === undefined ? undefined : tablesOf(named).patterns.get(key(linetype));
    const weightFrom = source(e.lineweight);
    const weight =
      weightFrom === "own"
        ? (e.lineweight ?? "Default")
        : (weightFrom.layer?.lineweight ?? "Default");
    const code = lineweightCode(weight);
    return {
      color: drawnColor(look, shade),
      byLayer: drawnColor(look, byLayer),
      byBlock: drawnColor(look, blockShade),
      // A pattern keeps its length whatever size an insert draws its entity at, so it is cut in
      // the block's own units shrunk by the insert's scale.
      dashes:
        pattern && Number.isFinite(look.dashScale / placed) && placed > 0
          ? dashesOf(
              pattern,
              look.dashScale / placed,
              where,
              look.dashScale,
              tablesOf(named).textStyles,
            )
          : undefined,
      lineweight: code < 0 ? DEFAULT_LINEWEIGHT : code,
    };
  };

  /**
   * The entities of a space that are drawn, each with its index among them. What an insert
   * holds is judged entity by entity, unless the insert's own layer is frozen.
   */
  const shownOf = (entities: readonly Entity[]): [number, Entity][] =>
    [...filled(entities).entries()]
      .filter(([, e]) =>
        e.kind === "insert" ? !frozen({ name: e.layer }) : !hidden({ name: e.layer }),
      )
      .flatMap(([i, e]): [number, Entity][] => {
        // A table draws the block of each of its cells as an insert of it, after itself.
        if (e.kind === "table") {
          const picture = tablePictureOf(e);
          // Each insert a placement makes is paid for before it is made.
          if (picture !== undefined && !spend(picture.blocks.length))
            refuse(drawingAt?.() ?? "a table");
          const inserts = picture === undefined ? [] : tableInserts(e, picture);
          return [[i, e], ...inserts.map((insert): [number, Entity] => [i, insert])];
        }
        // A leader whose content is a block draws the block as an insert of it, after itself.
        const content = e.kind === "leader" ? contentOf(e) : undefined;
        return content === undefined
          ? [[i, e]]
          : [
              [i, e],
              [i, content],
            ];
      });
  /** The insert of the block in place of a leader's note, where its picture places it. */
  const contentOf = (e: Leader): Insert | undefined => {
    const tables = tablesOf(undefined);
    const style = tables.leaderStyles.get(key(e.style));
    if (style === undefined || leaderBlock(e, style) === undefined) return undefined;
    const named = e.textStyle ?? style.textStyle;
    const textStyle = named === undefined ? undefined : tables.textStyles.get(key(named));
    const block = pictureOf(e, style, textStyle).block;
    // The multileader holds its block ByBlock, so what the block sets ByBlock takes the leader's
    // color. CAD programs draw the block opaque whatever the leader's transparency.
    if (block === undefined) return block;
    return e.color === undefined ? block : { ...block, color: e.color };
  };

  /**
   * An element for each entity that is drawn, as `look` draws it, in the space `space` names.
   * Each counts with the line it is written on, set in by `look.indent`.
   */
  const elements = (
    shown: readonly [number, Entity][],
    look: Look,
    space: string,
    frozenHere?: (layer: LayerRef) => boolean,
  ): string[] => {
    // A layer frozen in a viewport is frozen there for the walk of an insert too.
    const isFrozen = frozenHere ? (ref: LayerRef) => frozen(ref) || frozenHere(ref) : frozen;
    const marks = (e: Entity, index: number): string =>
      `data-layer="${esc(e.layer)}" data-entity="${index}"${e.id === undefined ? "" : ` data-id="${esc(e.id)}"`}`;
    const line = look.indent.length + 1;
    return shown.map(([i, e]) => {
      const where = () => entityAt(i, e, space);
      drawingAt = where;
      if (e.kind !== "insert") {
        // A dimension's texts are joined before it is drawn, so their length is paid for first.
        if (isDimension(e)) {
          if (!write((e.text?.length ?? 0) + (e.textBelow?.length ?? 0))) refuse(where());
        }
        const alpha = alphaFor(e.transparency, undefined, e.kind);
        const own = fadedPen(e, pen(look, styled(e), { name: e.layer }, where), alpha);
        const element = faded(drawn(e, marks(e, i), own, look), groupAlpha(e, alpha));
        if (!write(element.length + line)) refuse(where());
        return element;
      }
      // A walk that would spend more than is left is refused before it is taken.
      const boxes = boxesOf();
      if (work + boxes.walkCost(e) > most) refuse(where());
      if (boxes.capped) refuse(where(), true);
      const between = `\n${look.indent}  `;
      // An element is made of many small strings, so every `JOINED` of them are joined into one,
      // which holds no more than its characters, with what joins them as the group joins them.
      const joined: string[] = [];
      let parts: string[] = [];
      const walked = eachDrawn(
        e,
        blocks,
        isFrozen,
        (held, at) => {
          if (hidden(at.layer) || frozenHere?.(at.layer)) return;
          // The leading CAD app names a layer of an xref by the xref's name, a bar and the layer's.
          const { name, of } = at.layer;
          const mark = `data-layer="${esc(of ? `${of.name}|${name}` : name)}"`;
          const m = at.matrix;
          const heldPen = pen(
            look,
            styled(held),
            at.layer,
            where,
            at.insertLayer,
            at.from,
            m ? Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) : 1,
            at.byBlock,
          );
          const alpha = alphaFor(
            at.byBlockHeld ? "ByBlock" : held.transparency,
            at.byBlockAlpha,
            held.kind,
          );
          const part = faded(
            drawn(held, mark, fadedPen(held, heldPen, alpha), look, at.from, at.matrix),
            groupAlpha(held, alpha),
          );
          if (!write(part.length + line + 2)) return;
          parts.push(part);
          if (parts.length === JOINED) {
            joined.push(parts.join(between));
            parts = [];
          }
          // What is drawn counts against the characters, so it gives back its step of the walk.
          work--;
        },
        xrefs,
        (cost) => length <= longest && spend(cost),
        key,
        // A referenced drawing's table draws the block of each of its cells, as one of this
        // drawing's does, each insert paid for before it is made.
        (held, at) => {
          if (held.kind !== "table" || hidden(at.layer) || frozenHere?.(at.layer)) return [];
          const picture = tablePictureOf(held, at.from);
          if (picture === undefined || picture.blocks.length === 0) return [];
          if (!spend(picture.blocks.length)) refuse(where());
          return tableInserts(held, picture);
        },
        leaderHeld,
      );
      if (!walked || length > longest) refuse(where());
      const xref = blocks.has(key(e.block)) ? undefined : xrefPaths.get(key(e.block));
      // Its names are read for each insert, so they are paid for before they are written.
      const names = e.block.length + e.layer.length + (e.id?.length ?? 0) + (xref?.length ?? 0);
      if (!write(names)) refuse(where());
      const path = xref === undefined ? "" : ` data-xref="${esc(xref)}"`;
      const open = `<g ${marks(e, i)} data-block="${esc(e.block)}"${path}>`;
      const all = parts.length > 0 ? [...joined, parts.join(between)] : joined;
      if (!write(open.length - names + 4 + line + (all.length > 0 ? line : 0))) refuse(where());
      const inside = all.length > 0 ? `${between}${all.join(between)}\n${look.indent}` : "";
      return `${open}${inside}</g>`;
    });
  };

  /**
   * Each entity of model space that is drawn, with the box around what it draws, worked out
   * once, and how far past that box its ink may reach beyond its pen: a text's letters may
   * reach past its box, as one that hangs below the baseline does, and so may the texts of a
   * block.
   */
  let boxed:
    | {
        shown: [number, Entity];
        box: readonly [number, number, number, number];
        slack: number;
        figure: FigureReach;
      }[]
    | undefined;
  const figures = figureReaches(drawing);
  /** How many times model space has been looked through. */
  let views = 0;
  /**
   * The entities of model space that may reach into a rectangle of it, `[x0, y0, x1, y1]`, with
   * a pen that reaches `pen` past an entity's box. The test errs on the side of drawing.
   */
  const reaching = (
    rect: readonly number[],
    pen: number,
    where: string,
    height: number,
  ): [number, Entity][] => {
    if (!boxed) {
      boxed = shownOf(drawing.entities).flatMap((shown) => {
        const box = boxOf([shown[1]], (e) => entityAt(shown[0], e, "model space"));
        if (!box) return [];
        const lettered =
          shown[1].kind === "text" ||
          shown[1].kind === "paragraph" ||
          shown[1].kind === "insert" ||
          isDimension(shown[1]) ||
          shown[1].kind === "leader";
        const slack = lettered
          ? Math.max(box[2] - box[0], box[3] - box[1])
          : // The lines of a missing file reach from the page's corner past its box.
            shown[1].kind === "underlay"
            ? missingReach(shown[1])
            : 0;
        return [{ shown, box, slack, figure: figures(shown[1]) }];
      });
    }
    if (++views > FREE_VIEWS && !spend(Math.floor(boxed.length / 64))) refuse(where);
    // A point's figure reaches past its point, by a share of the view for a relative size.
    const reach = pointReach(pointStyle, height) ?? 0;
    const relative = typeof pointStyle.size !== "number";
    return boxed
      .filter(({ box: b, slack, figure }) => {
        const by = pen + slack + reach * (relative ? figure.relative : figure.absolute);
        return (
          b[0] - by <= rect[2]! &&
          b[2] + by >= rect[0]! &&
          b[1] - by <= rect[3]! &&
          b[3] + by >= rect[1]!
        );
      })
      .map(({ shown }) => shown);
  };

  // The leading CAD app scales the dashes of a referenced drawing by the linetype scale of the
  // drawing that references it.
  // That app reads a scale of 0 or less as 1, and so is one that is not a finite number here.
  const stated = drawing.linetypeScale ?? 1;
  const linetypeScale = stated > 0 && Number.isFinite(stated) ? stated : 1;
  // A style `lint` refuses plots each point as a dot.
  const pointStyle: PointStyle =
    drawing.pointStyle !== undefined && pointStyleProblems(drawing.pointStyle).length === 0
      ? drawing.pointStyle
      : { figure: "dot" };
  if (options.layout !== undefined) {
    const layout = findLayout(drawing, options.layout);
    const paper = layout && paperInfo(layout.paper);
    if (!layout || !paper) {
      throw new RangeError(`The drawing has no layout named ${JSON.stringify(options.layout)}`);
    }
    // A sheet is paper: a pen plots in the color its plot style table gives it, and in its own
    // lineweight unless the table gives every pen one.
    const table = layout.plotStyle ?? DEFAULT_PLOT_STYLE_TABLE;
    const color = (index: number): string => plottedColor(table, index);
    const pen = table === "DWF Virtual Pens.ctb" ? VIRTUAL_PEN_WIDTH : undefined;
    const base = pen ?? DEFAULT_LINEWEIGHT;
    // Hundredths of a millimetre in paper units.
    const perHundredth = paper.units === "in" ? 1 / 2540 : 1 / 100;
    /** A look whose lines are as wide as they plot, in a space `scale` paper units to one. */
    const plotted = (scale: number, indent: string, points: PointLook): Look => ({
      color,
      dashScale: linetypeScale / scale,
      chord: (paper.units === "in" ? 1 : 25.4) / 1200 / scale,
      indent,
      points,
      stroke: (lineweight) =>
        pen !== undefined || lineweight === DEFAULT_LINEWEIGHT
          ? ""
          : ` stroke-width="${precise((Math.max(lineweight, 5) * perHundredth) / scale)}"${lineweight === 0 ? THINNEST : ""}`,
    });
    const onPaper = plotted(1, "    ", { style: pointStyle, height: paper.height, up: [0, 1] });
    // A viewport's border plots as the thinnest line, or as the one pen a table gives every line.
    const thin = fmt((pen ?? 5) * perHundredth);
    const thinnest = pen === undefined ? THINNEST : "";
    // A drawing in units tsdraft does not know is drawn as one in inches, as `lint` judges it.
    const units = isUnits(drawing.units) ? drawing.units : "in";
    // The picture: the paper, or the view asked for, and the margin around it, in paper units
    // and as written.
    const margin = options.margin ?? 0;
    const [left, bottom, right, top] = view ?? [0, 0, paper.width, paper.height];
    const frame = [
      written(left - margin),
      written(-top - margin),
      written(right - left + margin * 2),
      written(top - bottom + margin * 2),
    ] as const;
    const picture = [frame[0], -(frame[1] + frame[3]), frame[0] + frame[2], -frame[1]] as const;
    const parts: string[] = [];
    const space = `layout ${quoted(layout.name)}`;
    /** Keeps a part of the sheet, each on a line of its own set in by four spaces. */
    const keep = (where: string, part: string): void => {
      if (!write(part.length + 5)) refuse(where);
      parts.push(part);
    };
    /** The lists of frozen layers the viewports have read. */
    const frozenLists = new WeakSet<object>();
    filled(layout.viewports).forEach((viewport, index) => {
      const at = `viewport #${index} of ${space}`;
      // A list of frozen layers another viewport holds too is read again, and paid for.
      const frozenList: unknown = (viewport as Partial<Viewport>).frozenLayers;
      if (Array.isArray(frozenList)) {
        if (!frozenLists.has(frozenList)) frozenLists.add(frozenList);
        else if (!spend(Math.ceil(frozenList.length / 64))) refuse(at);
      }
      const id = viewport.id === undefined ? "" : ` data-id="${esc(viewport.id)}"`;
      // A viewport `lint` refuses has no view to draw: a ratio of 0 or less, or no size.
      const sound = viewportProblem(viewport, paper.units, units) === undefined;
      if (!sound) {
        keep(at, `<g data-viewport="${index}"${id}/>`);
        // Its border is still drawn where its rectangle can be read.
        const { corner, width, height, layer } = viewport as Partial<Viewport>;
        const sizes = [corner?.[0], corner?.[1], width, height];
        if (
          typeof layer === "string" &&
          sizes.every((size) => typeof size === "number" && Number.isFinite(size)) &&
          width! > 0 &&
          height! > 0 &&
          !hidden({ name: layer })
        ) {
          const stroke = color(layerOf({ name: layer })?.color ?? 7);
          keep(
            at,
            `<rect x="${fmt(corner![0])}" y="${fmt(corner![1])}" width="${fmt(width!)}" height="${fmt(height!)}" stroke="${stroke}" stroke-width="${thin}"${thinnest} data-layer="${esc(layer)}" data-viewport-border="${index}"${id}/>`,
          );
        }
        return;
      }
      const view = validViewportView(viewport, paper.units, units);
      const [x, y] = [view.paperCenter[0] - view.width / 2, view.paperCenter[1] - view.height / 2];
      const box = `x="${fmt(x)}" y="${fmt(y)}" width="${fmt(view.width)}" height="${fmt(view.height)}"`;
      // Model space is placed so that the view's center lies at the middle of the rectangle,
      // turned by the twist about the origin as the file holds the view, with its center
      // turned too. The scale is written in full: six decimals leave a drawing in millimetres
      // at 1:1000, whose scale is 0.0000393701, two digits.
      const [cx, cy] = view.displayCenter;
      const turn = view.twist === 0 ? "" : ` rotate(${fmt(view.twist)})`;
      const place = `translate(${fmt(view.paperCenter[0])} ${fmt(view.paperCenter[1])}) scale(${precise(view.scale)}) translate(${fmt(-cx)} ${fmt(-cy)})${turn}`;
      // The layers frozen in this viewport alone, which an entity of the drawing's own is on.
      const frozenKeys = new Set(filled(viewport.frozenLayers ?? []).map(key));
      const frozenHere =
        frozenKeys.size === 0
          ? undefined
          : (ref: LayerRef) => ref.of === undefined && frozenKeys.has(key(ref.name));
      // A view is drawn only where it can be seen: the viewport, cut to the paper, cut to
      // the picture, with every number as it is written. The clip, the hidden rectangle and
      // the choice of what to draw all use this one rectangle.
      const seen = [
        written(Math.max(x, 0, picture[0])),
        written(Math.max(y, 0, picture[1])),
        written(Math.min(x + view.width, paper.width, picture[2])),
        written(Math.min(y + view.height, paper.height, picture[3])),
      ] as const;
      const [seenWidth, seenHeight] = [written(seen[2] - seen[0]), written(seen[3] - seen[1])];
      // It has a width and a height as written, and as a renderer that keeps numbers in
      // single precision reads its corners.
      const visible =
        seenWidth > 0 &&
        seenHeight > 0 &&
        Math.fround(seen[0]) < Math.fround(seen[2]) &&
        Math.fround(seen[1]) < Math.fround(seen[3]);
      // The box of the same rectangle in model space, turned back by the twist.
      const [cos, sin] = turning(view.twist);
      const corners = [0, 2].flatMap((i) =>
        [1, 3].map((j) => {
          const u = cx + (seen[i]! - view.paperCenter[0]) / view.scale;
          const v = cy + (seen[j]! - view.paperCenter[1]) / view.scale;
          return [u * cos + v * sin, v * cos - u * sin] as const;
        }),
      );
      const shows = [
        Math.min(...corners.map((c) => c[0])),
        Math.min(...corners.map((c) => c[1])),
        Math.max(...corners.map((c) => c[0])),
        Math.max(...corners.map((c) => c[1])),
      ];
      // Only what may reach into it is drawn: an entity's box, which for an arc is its
      // circle's, with the widest pen there is and the slack of its letters around it.
      const widest = (LINEWEIGHTS.at(-1)! * 100 * perHundredth) / view.scale;
      const reached = visible ? reaching(shows, widest, at, view.height / view.scale) : [];
      const near = frozenHere ? reached.filter(([, e]) => !frozenHere({ name: e.layer })) : reached;
      const inside = elements(
        near,
        plotted(view.scale, "        ", {
          style: pointStyle,
          height: view.height / view.scale,
          // Up the sheet, in model space: the view's twist turned back.
          up: [Math.sin((view.twist * Math.PI) / 180), Math.cos((view.twist * Math.PI) / 180)],
          dot: ` stroke-width="${precise((perHundredth * (2540 / 600)) / view.scale)}"`,
        }),
        `model space in ${at}`,
        frozenHere,
      );
      if (inside.length === 0) {
        // Nothing of the view can be seen, so there is nothing to clip.
        keep(at, `<g data-viewport="${index}"${id}/>`);
      } else {
        // The first element is hidden and is the rectangle itself. It draws nothing, and it
        // keeps the group's box on the picture whatever else the group holds: resvg, which
        // the command draws PNGs with, takes the box of a clipped group's elements before it
        // clips them, and stops the program that runs it when that box lies wholly more than
        // two widths of the picture to its left or right, or two heights above or below it.
        const rect = `x="${seen[0]}" y="${seen[1]}" width="${seenWidth}" height="${seenHeight}"`;
        keep(at, `<clipPath id="tsdraft-viewport-${index}"><rect ${rect}/></clipPath>`);
        // Its elements were counted as they were made.
        const head = [
          `<g data-viewport="${index}"${id} clip-path="url(#tsdraft-viewport-${index})">`,
          `      <rect ${rect} visibility="hidden" stroke="#000000"/>`,
          `      <g transform="${place}" stroke-width="${precise((base * perHundredth) / view.scale)}">`,
        ];
        const tail = [`      </g>`, `    </g>`];
        if (!write([...head, ...tail].join("\n").length + 6)) refuse(at);
        parts.push([...head, ...inside.map((element) => `        ${element}`), ...tail].join("\n"));
      }
      // The leading CAD app plots a viewport's border as its thinnest line, and only when its layer plots.
      if (!hidden({ name: viewport.layer })) {
        const stroke = color(layerOf({ name: viewport.layer })?.color ?? 7);
        keep(
          at,
          `<rect ${box} stroke="${stroke}" stroke-width="${thin}"${thinnest} data-layer="${esc(viewport.layer)}" data-viewport-border="${index}"${id}/>`,
        );
      }
    });
    // A sheet may hold more entities than a call takes arguments.
    for (const element of elements(shownOf(layout.entities), onPaper, space)) parts.push(element);
    const head = [
      `<svg xmlns="http://www.w3.org/2000/svg" data-picture="${SHEET_PICTURE}" viewBox="${frame.join(" ")}" data-layout="${esc(layout.name)}" data-paper="${esc(layout.paper)}">`,
      `  <rect x="0" y="${fmt(-paper.height)}" width="${fmt(paper.width)}" height="${fmt(paper.height)}" fill="#ffffff" data-paper-sheet=""/>`,
      `  <g transform="scale(1 -1)" fill="none" stroke-width="${fmt(base * perHundredth)}" stroke-linecap="round" stroke-linejoin="round">`,
    ];
    const tail = [`  </g>`, `</svg>`, ``];
    if (!write([...head, ...tail].join("\n").length + 1)) refuse(space);
    const held = defs.length > 0 ? [`  <defs>${defs.join("")}</defs>`] : [];
    return [
      head[0],
      ...held,
      ...head.slice(1),
      ...parts.map((part) => `    ${part}`),
      ...tail,
    ].join("\n");
  }

  // Each entity keeps its index in `drawing.entities`, for its element's data-entity.
  const all = shownOf(drawing.entities);
  const [minX, minY, maxX, maxY] = view ??
    boxOf(
      all.map(([, e]) => e),
      (e) => entityAt(all.find(([, shown]) => shown === e)![0], e, "model space"),
    ) ?? [0, 0, 1, 1];
  const margin = options.margin ?? (view ? 0 : Math.max(maxX - minX, maxY - minY, 1) * 0.02);
  const x = minX - margin;
  const y = -(maxY + margin);
  const w = maxX - minX + margin * 2;
  const h = maxY - minY + margin * 2;
  const stroke = options.strokeWidth ?? 1;
  // A view draws only what may reach into the picture. A pen is as wide in pixels at any size,
  // so it is taken to reach the picture's larger side past an entity's box, times the stroke
  // width when that is over 1: in a picture at least 5 pixels across no pen reaches further.
  const shown = view
    ? reaching(
        [x, -(y + h), x + w, -y],
        Math.max(w, h) * Math.max(1, stroke),
        "the view of model space",
        h,
      )
    : all;
  // On a screen each layer draws in its own color, and every line keeps its width in pixels
  // however far the picture is zoomed.
  const onScreen: Look = {
    color: aciColor,
    dashScale: linetypeScale,
    chord: 1 / 1200,
    indent: "    ",
    points: { style: pointStyle, height: h, up: [0, 1] },
    stroke: (lineweight) =>
      `${
        lineweight === DEFAULT_LINEWEIGHT
          ? ""
          : ` stroke-width="${fmt((stroke * Math.max(lineweight, 5)) / DEFAULT_LINEWEIGHT)}"`
      } vector-effect="non-scaling-stroke"`,
  };
  const body = elements(shown, onScreen, "model space").join("\n    ");
  const head = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)}">`,
    `  <g transform="scale(1 -1)" fill="none" stroke-width="${fmt(stroke)}" vector-effect="non-scaling-stroke">`,
  ];
  const tail = [`  </g>`, `</svg>`, ``];
  if (!write([...head, ...tail].join("\n").length + 1)) refuse("model space");
  const held = defs.length > 0 ? [`  <defs>${defs.join("")}</defs>`] : [];
  return [head[0], ...held, ...head.slice(1), `    ${body}`, ...tail].join("\n");
}

/**
 * A number with 12 significant digits, for a scale or a width that six decimals would cut
 * short. SVG reads the exponent a very small one is printed with.
 */
function precise(value: number): string {
  return String(Number(value.toPrecision(12)));
}

/**
 * The color an index or a true color draws in: an index as `look` draws it, and a true color as it
 * is, which CAD programs plot under every plot style table.
 */
function drawnColor(look: Look, shade: number | Rgb): string {
  if (typeof shade === "number") return look.color(shade);
  return `#${[shade[0], shade[1], shade[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The color of a paragraph's run that a `\C` or `\c` code colors: 0 the color ByBlock takes where
 * the paragraph is, 256 its layer's, 257 its own, an index as a layer's, and a true color as it is.
 */
function runColor(color: number, pen: Pen, look: Look): string {
  if (color >= TRUE_COLOR) {
    const rgb = color - TRUE_COLOR;
    return drawnColor(look, [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255]);
  }
  if (color === 0) return pen.byBlock;
  if (color === 256) return pen.byLayer;
  return color >= 1 && color <= 255 ? look.color(color) : pen.color;
}

/** How a space is drawn: on a screen, or as it plots on paper. */
interface Look {
  /** The color of an ACI index. */
  readonly color: (index: number) => string;
  /** What a linetype's pattern is multiplied by, to give dashes in the space's own units. */
  readonly dashScale: number;
  /**
   * How far, in the space's own units, a curve in a linetype may stray from the straight pieces
   * the leading CAD app cuts it into before its pattern, which its texts follow: 1/1200 inch on
   * the paper.
   */
  readonly chord: number;
  /** The attributes that set an element's stroke width, for a lineweight in hundredths of a millimetre. */
  readonly stroke: (lineweight: number) => string;
  /** The white space before an element, which what an insert holds is set in from. */
  readonly indent: string;
  /** How the space's points plot: the drawing's style, and the view they are seen in. */
  readonly points: PointLook;
}

/**
 * A space's points: the drawing's point style, the height of the view they are seen in and the
 * direction up that view, in the space's units, which a relative size is measured by.
 */
interface PointLook {
  readonly style: PointStyle;
  readonly height: number;
  readonly up: Point;
  /**
   * The stroke of a point drawn as a dot alone, where it is not the thinnest line: through a
   * viewport the leading CAD app plots one a device pixel wide, 1/600 inch.
   */
  readonly dot?: string;
}

/** What a drawing's entities name: its layers, its dash patterns and its text styles. */
interface Tables {
  /** Keyed as the leading CAD app looks layers up, so an entity on `wall` takes the color of layer `WALL`. */
  readonly layers: ReadonlyMap<string, Layer>;
  readonly patterns: ReadonlyMap<string, LinePattern | undefined>;
  readonly textStyles: ReadonlyMap<string, TextStyle>;
  readonly dimensionStyles: ReadonlyMap<string, DimensionStyle>;
  readonly leaderStyles: ReadonlyMap<string, LeaderStyle>;
  readonly tableStyles: ReadonlyMap<string, TableStyle>;
  /** The hatch patterns, by name as a linetype's is found: the first of a name. */
  readonly hatchPatterns: ReadonlyMap<string, HatchPattern>;
}

function tablesFor(drawing: Drawing): Tables {
  const hatchPatterns = new Map<string, HatchPattern>();
  for (const pattern of filled(drawing.patterns)) {
    if (typeof pattern?.name !== "string") continue;
    const key = layerKey(pattern.name);
    if (!hatchPatterns.has(key)) hatchPatterns.set(key, pattern);
  }
  return {
    layers: new Map(filled(drawing.layers).map((l) => [layerKey(l.name), l])),
    patterns: new Map(filled(drawing.linetypes).map((t) => [layerKey(t.name), linePattern(t)])),
    textStyles: new Map(filled(drawing.textStyles).map((t) => [layerKey(t.name), t])),
    dimensionStyles: new Map(filled(drawing.dimensionStyles).map((t) => [layerKey(t.name), t])),
    leaderStyles: new Map(filled(drawing.leaderStyles).map((t) => [layerKey(t.name), t])),
    // A style that is no object with a name, which `lint` refuses, is one the drawing lacks.
    tableStyles: new Map(
      filled(drawing.tableStyles)
        .filter((t) => typeof (t as { name?: unknown } | null)?.name === "string")
        .map((t) => [layerKey(t.name), t]),
    ),
    hatchPatterns,
  };
}

/**
 * Which layers of a drawing, and of the drawings it references, are drawn, and the tables that
 * say so. `toSVG` and `inspectText` share it, so they leave out the same entities.
 *
 * @param drawNoPlot - Draws the layers that do not plot too.
 */
export function visibility(drawing: Drawing, drawNoPlot: boolean | undefined) {
  // The tables of the drawing and of each drawing it references, made when first asked for.
  const tables = new Map<Drawing, Tables>();
  const tablesOf = (from: Referenced | undefined): Tables => {
    const source = from?.drawing ?? drawing;
    let found = tables.get(source);
    if (!found) tables.set(source, (found = tablesFor(source)));
    return found;
  };
  // A walk of inserts reads one name many times.
  const key = layerKeys();
  const layerOf = (ref: LayerRef): Layer | undefined => tablesOf(ref.of).layers.get(key(ref.name));
  const hidden = (ref: LayerRef): boolean => {
    const layer = layerOf(ref);
    if (layer?.off || layer?.frozen) return true;
    return drawNoPlot !== true && layer?.plot === false;
  };
  // An insert on a frozen layer draws nothing, and in a plot neither does one on a layer that
  // does not plot, whatever layers its block's entities are on.
  const frozen = (ref: LayerRef): boolean => {
    const layer = layerOf(ref);
    return layer?.frozen === true || (drawNoPlot !== true && layer?.plot === false);
  };
  const styleOf = (e: Entity, from?: Referenced): TextStyle | undefined =>
    (e.kind === "text" || e.kind === "paragraph") && e.style !== undefined
      ? tablesOf(from).textStyles.get(key(e.style))
      : undefined;
  return { tablesOf, layerOf, hidden, frozen, styleOf, key };
}

/** A view as given, checked: its corners as written, with a width and a height. */
function viewOf(view: SvgOptions["view"]): [number, number, number, number] | undefined {
  if (view === undefined) return undefined;
  const box = Array.isArray(view) && view.length === 4 ? view.map(Number) : [];
  const [x0 = NaN, y0 = NaN, x1 = NaN, y1 = NaN] = box.every(Number.isFinite)
    ? box.map(written)
    : [];
  if (!(x1 > x0 && y1 > y0)) {
    throw new RangeError(
      "A view is [x0, y0, x1, y1], four finite numbers from its lower-left corner to its upper-right, with x1 above x0 and y1 above y0",
    );
  }
  return [x0, y0, x1, y1];
}

/** An entity that draws something of its own, which an insert does not. */
type Drawn = Exclude<Entity, Insert>;

/** An entity that is one shape, with a linetype and a lineweight it may have of its own. */
type Shape = Exclude<
  Drawn,
  Dimension | Leader | Paragraph | Image | Underlay | Hatch | Wipeout | Table
>;

/** The linetype and the lineweight an entity has of its own. A dimension and a leader draw ByLayer. */
function styled(e: Drawn): Pick<Line, "linetype" | "lineweight" | "color"> {
  if (!isDimension(e) && e.kind !== "leader" && e.kind !== "table") return e;
  return e.color === undefined ? {} : { color: e.color };
}

/**
 * A leader as a group: its shafts and its landing, which take the dashes of its pen, its
 * arrowheads, and each line of its note. A filled arrowhead and a dot are filled. A leader whose
 * style the drawing does not have, and so has no picture, is an empty group.
 */
function leaderToSvg(
  e: Leader,
  picture: LeaderPicture | undefined,
  layOut: () => ParagraphLayout,
  mark: string,
  pen: Pen,
  look: Look,
  matrix: Matrix | undefined,
  room: number,
  sides: Known,
): string {
  if (picture === undefined) return `<g ${mark}/>`;
  const at = (p: Point): Point => (matrix ? mapPoint(matrix, p) : p);
  let parts: string[] = [];
  /** The parts that stay opaque when the leader fades. */
  const solid: string[] = [];
  // The parts share the picture's room: one that passes what is left ends the leader there,
  // longer than the room, which `write` then refuses.
  let left = room;
  const add = (part: (left: number) => string): void => {
    if (left < 0) return;
    const drawn = part(left);
    parts.push(drawn);
    left -= drawn.length;
  };
  const shape = (part: string, shaped: Shape): void =>
    add((left) =>
      entityToSvg(shaped, `data-part="${part}"`, pen, look, undefined, matrix, left, sides),
    );
  const points = (corners: readonly Point[]): string =>
    corners
      .map(at)
      .map(([x, y]) => `${fmt(x)},${fmt(y)}`)
      .join(" ");
  // A mask hides what is drawn before the leader, and none of the leader's own parts.
  if (picture.mask) {
    const color = picture.mask.color;
    const fill = color === undefined ? "#ffffff" : color === 256 ? pen.byLayer : look.color(color);
    // One in the drawing's background is marked, for a viewer whose background is not white.
    const background = color === undefined ? ` data-mask="background"` : "";
    add(
      () =>
        `<polygon points="${points(picture.mask!.corners)}" fill="${fill}" stroke="none"${background} data-part="mask"/>`,
    );
  }
  for (const shaft of picture.shafts) {
    shape("shaft", { kind: "polyline", layer: e.layer, points: shaft, closed: false });
  }
  for (const landing of [picture.landing, picture.farLanding]) {
    if (landing)
      shape("landing", { kind: "line", layer: e.layer, from: landing[0], to: landing[1] });
  }
  for (const arrowhead of picture.arrowheads) {
    if (arrowhead.filled.length > 0) {
      add(
        () =>
          `<polygon points="${points(arrowhead.filled)}" fill="${pen.color}" stroke="none" data-part="arrowhead"/>`,
      );
    }
    // An open or a dot arrowhead is a block's, which CAD programs plot opaque.
    const fading = parts;
    if (pen.alpha !== undefined) parts = solid;
    for (const [from, to] of arrowhead.lines) {
      shape("arrowhead", { kind: "line", layer: e.layer, from, to });
    }
    for (const { center, radius } of arrowhead.disks) {
      add(() =>
        roundToSvg(
          at(center),
          rounded(radius, matrix),
          `fill="${pen.color}" stroke="none" data-part="arrowhead"`,
        ),
      );
    }
    parts = fading;
  }
  for (const [from, to] of picture.underlines) {
    shape("underline", { kind: "line", layer: e.layer, from, to });
  }
  if (picture.frame) {
    shape("frame", { kind: "polyline", layer: e.layer, points: picture.frame, closed: true });
  }
  add((left) => paragraphToSvg(picture.note, layOut, `data-part="text"`, pen, look, matrix, left));
  const between = `\n${look.indent}  `;
  const drawnParts =
    pen.alpha === undefined
      ? [...parts, ...solid]
      : [fadedGroup(parts.join(between), pen.alpha), ...solid];
  return `<g ${mark} data-leader="${filled(e.text).map(esc).join("&#10;")}">${between}${drawnParts.join(between)}\n${look.indent}</g>`;
}

/**
 * A paragraph as a group: each run of each line as a text is drawn, in its font and in bold where
 * a code sets it, and its underlines, overlines, strike-throughs and the bars of its stacks as
 * lines of its pen, which take no dashes. It stops once it passes `room`, the characters left in
 * the picture, longer than the room, which `write` then refuses, and lays nothing out when its
 * value alone passes it.
 */
/**
 * A table as a group: the fill of each cell that has one, its lines, each in its own lineweight
 * or the table's, and the text of each cell, laid out as the leading CAD app lays out a cell's.
 * The blocks its cells hold are drawn after it, as inserts.
 */
function tableToSvg(
  e: Table,
  picture: TablePicture | undefined,
  styleOf: (name: string | undefined) => TextStyle | undefined,
  mark: string,
  pen: Pen,
  look: Look,
  matrix: Matrix | undefined,
  room: number,
  sides: Known,
): string {
  if (picture === undefined) return `<g ${mark}/>`;
  const placed = matrix ? compose(matrix, tableMatrix(e)) : tableMatrix(e);
  const own = tableMatrix(e);
  const at = (p: Point): Point => mapPoint(placed, p);
  const inSpace = (p: Point): Point => mapPoint(own, p);
  const parts: string[] = [];
  let left = room;
  const add = (part: (left: number) => string): void => {
    if (left < 0) return;
    const drawn = part(left);
    parts.push(drawn);
    left -= drawn.length;
  };
  for (const fill of picture.fills) {
    const [x0, y0, x1, y1] = fill.box;
    const corners = (
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ] as const
    ).map(at);
    add(
      () =>
        `<polygon points="${corners.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ")}" fill="${look.color(fill.color)}" stroke="none" data-part="fill"/>`,
    );
  }
  for (const line of picture.lines) {
    const weighed =
      line.lineweight === undefined ? pen : { ...pen, lineweight: lineweightCode(line.lineweight) };
    add((left) =>
      entityToSvg(
        { kind: "line", layer: e.layer, from: inSpace(line.from), to: inSpace(line.to) },
        `data-part="line"`,
        weighed,
        look,
        undefined,
        matrix,
        left,
        sides,
      ),
    );
  }
  for (const text of picture.texts) {
    const paragraph = tableParagraph(e, text);
    const lettered = text.color === undefined ? pen : { ...pen, color: look.color(text.color) };
    add((left) =>
      paragraphToSvg(
        paragraph,
        () => layoutCellText(paragraphInStyle(paragraph, styleOf(text.textStyle))),
        `data-part="text"`,
        lettered,
        look,
        matrix,
        left,
      ),
    );
  }
  return `<g ${mark} data-table="">\n${look.indent}  ${parts.join(`\n${look.indent}  `)}\n${look.indent}</g>`;
}

function paragraphToSvg(
  e: Paragraph,
  layOut: () => ParagraphLayout,
  mark: string,
  pen: Pen,
  look: Look,
  matrix: Matrix | undefined,
  room: number,
): string {
  const place = placer(e);
  const at = (p: Point): Point => (matrix ? mapPoint(matrix, p) : p);
  const parts: string[] = [];
  let left = room - e.value.length;
  const add = (part: string): void => {
    parts.push(part);
    left -= part.length;
  };
  const layout = left < 0 ? undefined : layOut();
  const mask = maskOf(e.mask);
  if (mask && layout) {
    const corners = paragraphMaskCorners(e, layout, mask).map(at);
    add(maskToSvg(corners, mask.color, pen, look));
  }
  for (const line of layout?.lines ?? []) {
    if (left < 0) break;
    for (const run of line.runs) {
      if (left < 0) break;
      // A run too small to write, which a `\H` factor can make of a small paragraph, draws
      // nothing, and its layout says it is approximate.
      if (!(written(run.height) > 0)) continue;
      const text: Text = {
        kind: "text",
        layer: e.layer,
        at: place(run.x, run.baseline),
        height: run.height,
        value: run.value,
        rotation: paragraphTurn(e.rotation),
      };
      // Each run in its own width factor and oblique angle, the style's or a code's.
      const style: TextStyle = {
        name: "",
        font: run.font,
        widthFactor: run.widthFactor,
        obliqueAngle: run.obliqueAngle,
      };
      // The run is drawn in its own face, from its first point.
      const drawn = {
        start: run.start - run.x,
        end: run.end - run.x,
        advance: run.advance,
        bold: run.bold,
      };
      const runPen =
        run.color === undefined ? pen : { ...pen, color: runColor(run.color, pen, look) };
      add(textToSvg(text, style, runPen, `data-part="text"`, matrix, false, drawn));
    }
  }
  for (const { kind, from, to } of layout?.strokes ?? []) {
    if (left < 0) break;
    const [a, b] = [at(place(...from)), at(place(...to))];
    add(
      `<line x1="${fmt(a[0])}" y1="${fmt(a[1])}" x2="${fmt(b[0])}" y2="${fmt(b[1])}" stroke="${pen.color}"${look.stroke(pen.lineweight)} data-part="${kind}"/>`,
    );
  }
  // A tab as `&#9;`, which an XML reader would read in an attribute as a space.
  const open = `<g ${mark} data-paragraph="${esc(e.value).replaceAll("\t", "&#9;")}"`;
  if (parts.length === 0) return `${open}/>`;
  return `${open}>\n${look.indent}  ${parts.join(`\n${look.indent}  `)}\n${look.indent}</g>`;
}

/**
 * A mask: a polygon in the drawing's background, white and marked so, or in a color index of its
 * own, or ByLayer for 256, with no outline.
 */
function maskToSvg(
  corners: readonly Point[],
  color: number | undefined,
  pen: Pen,
  look: Look,
): string {
  const fill = color === undefined ? "#ffffff" : color === 256 ? pen.byLayer : look.color(color);
  // One in the drawing's background is marked, for a viewer whose background is not white.
  const background = color === undefined ? ` data-mask="background"` : "";
  const points = corners.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");
  return `<polygon points="${points}" fill="${fill}" stroke="none"${background} data-part="mask"/>`;
}

/**
 * A hatch: its loops as one path, filled by the parity of the loops around each point, as the
 * leading CAD app fills them, with no outline: in its pen's color, or with its gradient, which
 * `shade` holds in the picture's definitions, in its own colors whatever the plot style table. Its
 * arcs are drawn as `matrix` puts them, and it stops once it passes the room left in the picture.
 * A gradient the rules refuse, or whose loops' box has no width or height, draws nothing.
 */
function hatchToSvg(
  e: Hatch,
  mark: string,
  pen: Pen,
  look: Look,
  matrix: Matrix | undefined,
  room: number,
  patternOf: (name: string) => HatchPattern | undefined,
  sizesOf: (pattern: HatchPattern) => PatternSizes | undefined,
  step: (cost: number) => boolean,
  shade: (picture: GradientPicture) => string | undefined,
): string {
  const spread = hatchSpread(e, patternOf, sizesOf);
  if (spread !== undefined) {
    // One whose loops or lines `lint` refuses draws none of its lines.
    const box = loopsBox(e.loops);
    if (box === undefined || patternDrawnProblem(box, spread) !== undefined) return `<g ${mark}/>`;
    const pattern = hatchLines(e, patternOf)!;
    return patternToSvg(e, pattern, mark, pen, look, matrix, room, step);
  }
  const place = (x: number, y: number): string => {
    const [px, py] = matrix ? mapPoint(matrix, [x, y]) : [x, y];
    return `${fmt(px)} ${fmt(py)}`;
  };
  const gradient = e.gradient === undefined ? undefined : gradientWritten(e.gradient);
  if (e.gradient !== undefined && gradient === undefined) return `<g ${mark}/>`;
  const boxer = gradient && gradientBoxer(gradient);
  // Each loop is one string once made, and each side is paid for from the room, so that what the
  // hatch holds stays near what it writes: the loop that passes the room ends there. The loops are
  // added on, not joined, so that a path past the room is not copied before `write` refuses it.
  // Each loop is paid for before the walk as an item that may draw nothing, since many hatches can
  // share one list of loops, and the sides of a path that is not drawn where it is left out.
  const loops = filled(e.loops);
  step(loops.length);
  let d = "";
  let left = room;
  let walked = 0;
  for (const loop of drawnLoops(loops)) {
    if (left < 0) break;
    const sides = loopSides(loop);
    walked += sides.length;
    if (sides.length === 0) continue;
    const parts = [`M ${place(...sides[0]!.from)}`];
    let used = parts[0]!.length;
    for (const side of sides) {
      if (used > left) break;
      boxer?.side(writtenPoint(side.from), writtenPoint(side.to), written(side.bulge));
      const arc = sideArc(side.from, side.to, side.bulge);
      if (!arc) parts.push(`L ${place(...side.to)}`);
      else {
        const round = rounded(arc.radius, matrix);
        const flag = arc.sweep > 0 ? round.sweep : 1 - round.sweep;
        const a = `A ${fmt(round.rx)} ${fmt(round.ry)} ${fmt(round.turn)} 0 ${flag}`;
        // An arc of more than half a turn is drawn as two halves, so that no arc of the path ends
        // where it starts, which SVG would draw as nothing.
        if (Math.abs(arc.sweep) > Math.PI) {
          parts.push(`${a} ${place(...arcPoint(arc, 0.5))}`);
          used += parts.at(-1)!.length + 1;
        }
        parts.push(`${a} ${place(...side.to)}`);
      }
      used += parts.at(-1)!.length + 1;
    }
    parts.push("Z");
    const path = parts.join(" ");
    d = d === "" ? path : d + " " + path;
    left -= path.length + 1;
  }
  if (d === "") return `<g ${mark}/>`;
  if (boxer) {
    const picture = boxer.picture();
    const id = picture && shade(picture);
    if (id === undefined) {
      step(walked);
      return `<g ${mark}/>`;
    }
    return `<path d="${d}" fill="url(#${id})" fill-rule="evenodd" stroke="none" ${mark} data-hatch="" data-gradient=""/>`;
  }
  return `<path d="${d}" fill="${pen.color}" fill-rule="evenodd" stroke="none" ${mark} data-hatch=""/>`;
}

/** A true color as `#rrggbb`. */
const hex = (color: readonly number[]): string =>
  `#${color.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/**
 * A hatch's pattern: each dash and dot its lines draw inside its loops, as one path in its pen,
 * a dot as a piece of no length, which the plot's round ends draw. It stops once it passes the
 * room left in the picture, longer than the room, which `write` then refuses; `step` pays for the
 * walk of its lines.
 */
function patternToSvg(
  e: Hatch,
  pattern: HatchLines,
  mark: string,
  pen: Pen,
  look: Look,
  matrix: Matrix | undefined,
  room: number,
  step: (cost: number) => boolean,
): string {
  const place = ([x, y]: Point): string => {
    const [px, py] = matrix ? mapPoint(matrix, [x, y]) : [x, y];
    return `${fmt(px)} ${fmt(py)}`;
  };
  // The loops and the lines as the file holds them: points with 6 decimals, lines with 15 digits.
  const rings = drawnLoops(e.loops).map(loopSides);
  const digits = (value: number) => Number(fifteenDigits(value));
  const lines = pattern.lines.map((line) => ({
    angle: digits(line.angle),
    base: [digits(line.base[0]), digits(line.base[1])] as Point,
    offset: [digits(line.offset[0]), digits(line.offset[1])] as Point,
    dashes: line.dashes.map(digits),
  }));
  // The pieces are paid for from the room, and the one that passes it ends the path there.
  const parts: string[] = [];
  let left = room;
  patternPieces(rings, lines, step, (from, to) => {
    const part = `M ${place(from)} L ${place(to)}`;
    parts.push(part);
    return (left -= part.length + 1) >= 0;
  });
  if (parts.length === 0) return `<g ${mark}/>`;
  const d = parts.join(" ");
  return `<path d="${d}" stroke="${pen.color}"${look.stroke(pen.lineweight)} stroke-linecap="round" ${mark} data-hatch=""/>`;
}

/**
 * A wipeout: its polygon in the paper's white, marked as a mask in the drawing's background, and
 * its frame in its pen when the drawing shows wipeouts' frames.
 */
function wipeoutToSvg(
  e: Wipeout,
  mark: string,
  pen: Pen,
  look: Look,
  matrix: Matrix | undefined,
  frame: boolean,
): string {
  const corners = filled(e.points).map((p) => (matrix ? mapPoint(matrix, p) : p));
  if (corners.length < 3) return `<g ${mark}/>`;
  const points = corners.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");
  const parts = [
    `<polygon points="${points}" fill="#ffffff" stroke="none" data-mask="background" data-part="mask"/>`,
  ];
  if (frame) {
    parts.push(
      `<polygon points="${points}" stroke="${pen.color}"${look.stroke(pen.lineweight)} data-part="frame"/>`,
    );
  }
  return `<g ${mark} data-wipeout="">${parts.join("")}</g>`;
}

/**
 * A dimension as a group: its extension lines, the pieces of its dimension line and the leader to
 * a text moved out, which take the dashes of its pen and the lineweights its style gives them,
 * its arrowheads, filled, or a tick with no width as a line, and each text as the paragraph its
 * block holds. A dimension whose style the drawing does not have is an empty group.
 */
function dimensionToSvg(
  e: Dimension,
  style: DimensionStyle | undefined,
  textStyle: TextStyle | undefined,
  mark: string,
  pen: Pen,
  look: Look,
  matrix: Matrix | undefined,
  room: number,
): string {
  if (style === undefined) return `<g ${mark}/>`;
  const picture = dimensionPicture(e, style, textStyle);
  const at = (p: Point): Point => (matrix ? mapPoint(matrix, p) : p);
  // A style's lineweight, as group 370 holds it, over the dimension's own.
  const weighed = (code: number): Pen => (code < 0 ? pen : { ...pen, lineweight: code });
  const line = (part: string, [from, to]: readonly [Point, Point], drawn: Pen): string =>
    entityToSvg(
      { kind: "line", layer: e.layer, from, to },
      `data-part="${part}"`,
      drawn,
      look,
      undefined,
      matrix,
      room,
    );
  const extension = weighed(picture.lineweights.extension);
  const dimension = weighed(picture.lineweights.dimension);
  const thin = arrowheadInfo(style.arrowhead ?? DEFAULT_ARROWHEAD)?.stroke?.width === 0;
  // A style's mask is drawn behind each text, as its picture's paragraph holds it.
  const masked = dimensionMask(style);
  const mask =
    masked === undefined
      ? undefined
      : {
          ...(masked.color === undefined ? {} : { color: masked.color }),
          offsetFactor: masked.offsetFactor,
        };
  const parts = [
    ...picture.extensionLines.map((ends) => line("extension-line", ends, extension)),
    ...picture.dimensionLines.map((ends) => line("dimension-line", ends, dimension)),
    ...picture.dimensionArcs.map((arc) =>
      entityToSvg(
        {
          kind: "arc",
          layer: e.layer,
          center: arc.center,
          radius: arc.radius,
          startAngle: arc.start,
          endAngle: arc.end,
        },
        `data-part="dimension-line"`,
        dimension,
        look,
        undefined,
        matrix,
        room,
      ),
    ),
    ...picture.leader.map((ends) => line("leader", ends, dimension)),
  ];
  // A tick or an oblique stroke is a block's, which CAD programs plot opaque.
  const blocked = arrowheadInfo(style.arrowhead ?? DEFAULT_ARROWHEAD)?.block !== undefined;
  const heads = picture.arrowheads.map((corners) => {
    if (thin) return line("arrowhead", [corners[0]!, corners[1]!], dimension);
    const points = corners
      .map(at)
      .map(([x, y]) => `${fmt(x)},${fmt(y)}`)
      .join(" ");
    return `<polygon points="${points}" fill="${pen.color}" stroke="none" data-part="arrowhead"/>`;
  });
  // Moved out of the faded group only when the dimension fades, so an opaque one is as it was.
  const apart = blocked && pen.alpha !== undefined;
  parts.push(
    ...(apart ? [] : heads),
    ...pictureTexts(picture, textStyle).map((text) =>
      paragraphToSvg(
        {
          kind: "paragraph",
          layer: e.layer,
          at: text.at!,
          height: text.height,
          value: text.value,
          rotation: text.rotation ?? 0,
          align: "center",
          valign: "middle",
          ...(mask === undefined ? {} : { mask }),
        },
        () => layoutDimensionText(text),
        `data-part="text"`,
        pen,
        look,
        matrix,
        room,
      ),
    ),
  );
  const between = `\n${look.indent}  `;
  const solid = apart ? heads : [];
  const drawnParts =
    pen.alpha === undefined
      ? [...parts, ...solid]
      : [fadedGroup(parts.join(between), pen.alpha), ...solid];
  return `<g ${mark} data-dimension="${esc(picture.label.value)}">${between}${drawnParts.join(between)}\n${look.indent}</g>`;
}

/**
 * What a matrix makes of a circle: an ellipse with these two radii, the first turned by `turn`
 * degrees, drawn counterclockwise when `sweep` is 1. With no matrix it is the circle.
 */
function rounded(
  radius: number,
  m: Matrix | undefined,
): { rx: number; ry: number; turn: number; sweep: 0 | 1 } {
  if (!m) return { rx: radius, ry: radius, turn: 0, sweep: 1 };
  // The two stretches of the matrix, and the turn it gives the first.
  const [e, f, g, h] = [(m[0] + m[3]) / 2, (m[0] - m[3]) / 2, (m[1] + m[2]) / 2, (m[1] - m[2]) / 2];
  const [q, r] = [Math.hypot(e, h), Math.hypot(f, g)];
  const sweep = m[0] * m[3] - m[1] * m[2] < 0 ? 0 : 1;
  const [rx, ry] = [radius * (q + r), radius * Math.abs(q - r)];
  // A matrix that scales both ways alike leaves a circle, which has no turn to give.
  if (fmt(rx) === fmt(ry)) return { rx, ry, turn: 0, sweep };
  return { rx, ry, turn: ((Math.atan2(g, f) + Math.atan2(h, e)) * 90) / Math.PI, sweep };
}

/**
 * How many times its figure's reach a point's figure may reach past an entity's box: 1 for a
 * point, and for an insert what the points of its block reach once placed. A size in drawing units
 * grows with each insert's larger scale; a relative one is not scaled but skewed, which stretches
 * it by at most the larger scale over the smaller. Each block is walked once.
 */
interface FigureReach {
  readonly absolute: number;
  readonly relative: number;
}

function figureReaches(drawing: Drawing): (e: Entity) => FigureReach {
  const NONE: FigureReach = { absolute: 0, relative: 0 };
  const blocks = blocksByKey(drawing.blocks);
  const key = layerKeys();
  // By each block's list of entities, so that blocks sharing one walk it once.
  const known = new Map<unknown, FigureReach>();
  /** The larger scale of an insert and the larger over the smaller, or undefined for none. */
  const scaleOf = (e: Insert): readonly [number, number] | undefined => {
    const scale: unknown = e.scale ?? [1, 1];
    if (!Array.isArray(scale)) return undefined;
    const [x, y]: unknown[] = [scale[0], scale[1]];
    if (typeof x !== "number" || typeof y !== "number") return undefined;
    const [most, least] = [Math.max(Math.abs(x), Math.abs(y)), Math.min(Math.abs(x), Math.abs(y))];
    return least > 0 && Number.isFinite(most) ? [most, most / least] : undefined;
  };
  interface Walk {
    readonly list: unknown;
    readonly items: readonly unknown[];
    readonly scale: readonly [number, number];
    i: number;
    absolute: number;
    relative: number;
  }
  const into = (
    to: { absolute: number; relative: number },
    r: FigureReach,
    by: readonly number[],
  ) => {
    to.absolute = Math.max(to.absolute, r.absolute * by[0]!);
    to.relative = Math.max(to.relative, r.relative * by[1]!);
  };
  // A stack of its own, so that blocks nested however deep do not run out of the call stack.
  const ofInsert = (e: Insert): FigureReach => {
    const out = { absolute: 0, relative: 0 };
    const stack: Walk[] = [];
    let at: { absolute: number; relative: number } = out;
    let insert: Insert | undefined = e;
    for (;;) {
      if (insert !== undefined) {
        const scale = scaleOf(insert);
        const name = insert.block;
        const list =
          scale && typeof name === "string" ? blocks.get(key(name))?.entities : undefined;
        const had = list === undefined ? NONE : known.get(list);
        if (had) into(at, had, scale ?? [0, 0]);
        else {
          // A block inside itself reaches nothing more.
          known.set(list, NONE);
          const walk = { list, items: filled(list), scale: scale!, i: 0, absolute: 0, relative: 0 };
          stack.push(walk);
          at = walk;
        }
        insert = undefined;
      }
      const top = stack.at(-1);
      if (!top) return out;
      if (top.i >= top.items.length) {
        const found = { absolute: top.absolute, relative: top.relative };
        known.set(top.list, found);
        stack.pop();
        at = stack.at(-1) ?? out;
        into(at, found, top.scale);
        continue;
      }
      const item = top.items[top.i++];
      if (typeof item !== "object" || item === null) continue;
      const kind = (item as Entity).kind;
      if (kind === "point") into(top, { absolute: 1, relative: 1 }, [1, 1]);
      else if (kind === "insert") insert = item as Insert;
    }
  };
  const of = (e: Entity): FigureReach =>
    typeof e !== "object" || e === null
      ? NONE
      : e.kind === "point"
        ? { absolute: 1, relative: 1 }
        : e.kind === "insert"
          ? ofInsert(e)
          : NONE;
  return of;
}

/**
 * A point's figure, in the thinnest line and solid, whatever its pen's lineweight and linetype.
 * Under an insert it is placed as the block's lines are, and a relative size is measured in the
 * block's units along the view's up direction taken back through the insert, so the insert's
 * scale does not change it.
 */
function pointToSvg(
  e: PointEntity,
  mark: string,
  pen: Pen,
  look: Look,
  matrix: Matrix | undefined,
): string {
  const { style, height, up } = look.points;
  // A point `lint` refuses draws nothing.
  const [x0, y0] = Array.isArray(e.at) ? e.at : [NaN, NaN];
  const turn = e.rotation ?? 0;
  if (![x0, y0, turn].every((n) => typeof n === "number" && Number.isFinite(n)))
    return `<g ${mark}/>`;
  let reach = pointReach(style, height);
  if (reach !== undefined && typeof style.size !== "number" && matrix) {
    const [a, b, c, d] = matrix;
    const det = a * d - b * c;
    const back = Math.hypot(d * up[0] - c * up[1], a * up[1] - b * up[0]) / Math.abs(det);
    reach = Number.isFinite(back) && back > 0 ? reach * back : undefined;
  }
  const parts = pointFigure(style, reach);
  if (parts.length === 0) return `<g ${mark}/>`;
  const turned = rad(e.rotation ?? 0);
  const [cos, sin] = [Math.cos(turned), Math.sin(turned)];
  const at = ([x, y]: Point): string => {
    const local: Point = [e.at[0] + x * cos - y * sin, e.at[1] + x * sin + y * cos];
    const [px, py] = matrix ? mapPoint(matrix, local) : local;
    return `${fmt(px)} ${fmt(py)}`;
  };
  const alone = style.figure === "dot" && !style.circle && !style.square;
  const s = `stroke="${pen.color}"${(alone && look.points.dot) || look.stroke(0)} data-part="figure"`;
  const paths = parts.map((part) => {
    if ("radius" in part) {
      // Two halves, from the point the figure's turn puts at 0 degrees, as the circle plots.
      const r = part.radius;
      const round = rounded(r, matrix);
      const arc = `A ${fmt(round.rx)} ${fmt(round.ry)} ${fmt(round.turn)} 0 ${round.sweep}`;
      return `<path d="M ${at([r, 0])} ${arc} ${at([-r, 0])} ${arc} ${at([r, 0])}" ${s}/>`;
    }
    const [first, ...rest] = part.points;
    // A dot is a path of no length, which a round cap draws.
    if (rest.length === 0)
      return `<path d="M ${at(first!)} L ${at(first!)}" stroke-linecap="round" ${s}/>`;
    return `<path d="M ${at(first!)} ${rest.map((p) => `L ${at(p)}`).join(" ")}" ${s}/>`;
  });
  return `<g ${mark} data-point="">\n${look.indent}  ${paths.join(`\n${look.indent}  `)}\n${look.indent}</g>`;
}

/**
 * @param mark - The data attributes of the element.
 * @param matrix - Where an insert puts the entity, for one that a block holds.
 * @param room - The characters left in the picture. Dashes stop once they pass it.
 * @param sides - The sides of each polyline's points, kept for the picture.
 */
function entityToSvg(
  e: Shape,
  mark: string,
  pen: Pen,
  look: Look,
  style: TextStyle | undefined,
  matrix: Matrix | undefined,
  room: number,
  sides: Known = knowing(),
): string {
  // A lineweight of 0 draws as the thinnest line, as in the leading CAD app.
  const s = `stroke="${pen.color}"${look.stroke(pen.lineweight)} ${mark}`;
  const at = (p: Point): Point => (matrix ? mapPoint(matrix, p) : p);
  if (e.kind === "point") return pointToSvg(e, mark, pen, look, matrix);
  const plan = e.kind === "polyline" ? planOf(e, sides) : undefined;
  if (e.kind === "polyline" && plan) {
    return polylineToSvg(e, plan, mark, pen, look, matrix, room, sides);
  }
  if (e.kind !== "text" && pen.dashes) {
    const letters = lettersOf(pen, look);
    const d = dashedPath(e, pen.dashes, matrix, room, sides, undefined, letters, look.chord);
    // A pattern with a dot draws it as a round cap on a path of no length.
    const cap = pen.dashes.dot ? ` stroke-linecap="round"` : "";
    if (d !== undefined) {
      if (!letters?.out.length) return `<path d="${d}"${cap} ${s}/>`;
      // The texts of its linetype are drawn after its dashes, in a group with them.
      const stroked = `stroke="${pen.color}"${look.stroke(pen.lineweight)}`;
      const parts = [`<path d="${d}"${cap} ${stroked}/>`, ...letters.out];
      return `<g ${mark}>\n${look.indent}  ${parts.join(`\n${look.indent}  `)}\n${look.indent}</g>`;
    }
  }
  switch (e.kind) {
    case "line": {
      const [from, to] = [at(e.from), at(e.to)];
      return `<line x1="${fmt(from[0])}" y1="${fmt(from[1])}" x2="${fmt(to[0])}" y2="${fmt(to[1])}" ${s}/>`;
    }
    case "polyline": {
      const tag = e.closed ? "polygon" : "polyline";
      const points = filled(e.points)
        .map(at)
        .map(([px, py]) => `${fmt(px)},${fmt(py)}`)
        .join(" ");
      return `<${tag} points="${points}" ${s}/>`;
    }
    case "circle":
      return roundToSvg(at(e.center), rounded(e.radius, matrix), s);
    case "arc": {
      const [cx, cy] = e.center;
      const a0 = rad(e.startAngle);
      const a1 = rad(e.endAngle);
      const large = sweep(e.startAngle, e.endAngle) > 180 ? 1 : 0;
      const ends = [a0, a1].map((a) =>
        at([cx + e.radius * Math.cos(a), cy + e.radius * Math.sin(a)]),
      );
      const [start, end] = ends.map(([px, py]) => `${fmt(px)} ${fmt(py)}`);
      const round = rounded(e.radius, matrix);
      // SVG draws nothing for an arc that ends where it starts, which is where rounding can
      // put the ends of an arc that is all but a full turn.
      if (start === end && large === 1) return roundToSvg(at(e.center), round, s);
      // sweep-flag 1 is the positive-angle direction in local (Y-up) coordinates: counterclockwise.
      return `<path d="M ${start} A ${fmt(round.rx)} ${fmt(round.ry)} ${fmt(round.turn)} ${large} ${round.sweep} ${end}" ${s}/>`;
    }
    case "text":
      return textToSvg(e, style, pen, mark, matrix, true);
    case "ellipse": {
      const curve = curveOf(e, sides);
      return curve ? ellipseToSvg(curve.ellipse!, matrix, s) : `<g ${mark}/>`;
    }
    case "spline": {
      const curve = curveOf(e, sides);
      return curve ? `<path d="${splinePath(curve, matrix)}" ${s}/>` : `<g ${mark}/>`;
    }
  }
}

/**
 * A text as an element, drawn from where `layoutText` starts it and held to its length, or, for a
 * run of a paragraph, from where its layout starts it, in bold where it is. `decode` draws its
 * `%%` codes as the characters they stand for. A bold run's `font-weight` comes before the three
 * attributes the command sizes a text by.
 */
function textToSvg(
  e: Text,
  style: TextStyle | undefined,
  pen: Pen,
  mark: string,
  matrix: Matrix | undefined,
  decode: boolean,
  run?: {
    readonly start: number;
    readonly end: number;
    readonly advance: number;
    readonly bold: boolean;
  },
): string {
  // Undo the group's Y flip so the text reads upright, then apply CAD rotation.
  let t = `translate(${fmt(e.at[0])} ${fmt(e.at[1])}) scale(1 -1)${e.rotation ? ` rotate(${fmt(-e.rotation)})` : ""}`;
  // An insert's matrix is applied last, so it comes first.
  if (matrix) t = `matrix(${matrix.map(fmt).join(" ")}) ${t}`;
  const named = style?.font ?? STANDARD_FONT;
  const font = fontInfo(named);
  const width = style?.widthFactor ?? 1;
  const oblique = style?.obliqueAngle ?? 0;
  // A text is drawn on its baseline, before the style widens or slants it. In a TrueType font it
  // is drawn from its first point and held to its characters' advances, as the leading CAD app's
  // PDF sets its glyphs; in an SHX font, which plots as strokes, from where it starts to plot and
  // held to the length it plots.
  const trueType = font?.pitchAndFamily !== undefined;
  let start: number;
  let end: number;
  let baseline = 0;
  if (run) [start, end] = trueType ? [0, run.advance] : [run.start, run.end];
  else {
    const laid = layoutText(inStyle(e, style));
    const first = laid.end - laid.advance;
    [start, end] = trueType ? [first, first + laid.advances] : [laid.start, laid.end];
    baseline = laid.baseline;
  }
  if (written(start) !== 0 || written(baseline) !== 0) {
    t += ` translate(${fmt(start)} ${fmt(-baseline)})`;
  }
  // The leading CAD app slants a text after it widens it, so the width factor does not widen
  // the lean. The transform applied last comes first.
  if (oblique !== 0) t += ` skewX(${fmt(-oblique)})`;
  if (width !== 1) t += ` scale(${fmt(width)} 1)`;
  // A text's height is the height of its capitals, which a font draws smaller than its size.
  const size = e.height / (capHeightOf(named, run?.bold) ?? SCREEN_CAP_HEIGHT);
  const length = written((end - start) / width);
  const held = length > 0 ? ` textLength="${length}" lengthAdjust="spacingAndGlyphs"` : "";
  const family = font?.family ?? "monospace";
  const value = decode ? drawnValue(e.value) : e.value;
  // The font by its name in `FONTS`, and empty for a font that is not one of them.
  const weight = run?.bold ? ` font-weight="bold"` : "";
  return `<text transform="${t}"${weight} font-size="${fmt(size)}" font-family="${esc(family)}" data-height="${fmt(e.height)}"${held} xml:space="preserve" fill="${pen.color}" stroke="none" data-font="${esc(font ? named : "")}" ${mark}>${esc(value)}</text>`;
}

/** A circle, or the ellipse an insert that scales unevenly makes of one. */
function roundToSvg(center: Point, round: ReturnType<typeof rounded>, s: string): string {
  const [cx, cy] = [fmt(center[0]), fmt(center[1])];
  if (fmt(round.rx) === fmt(round.ry))
    return `<circle cx="${cx}" cy="${cy}" r="${fmt(round.rx)}" ${s}/>`;
  const turn = round.turn === 0 ? "" : ` transform="rotate(${fmt(round.turn)} ${cx} ${cy})"`;
  return `<ellipse cx="${cx}" cy="${cy}" rx="${fmt(round.rx)}" ry="${fmt(round.ry)}"${turn} ${s}/>`;
}

/**
 * A linetype pattern as SVG thinks of dashes: dash, gap, dash, gap, starting with a dash and
 * of even length. Dashes or gaps side by side are joined, and a pattern that starts with a gap
 * is turned to start with the dash after it. Undefined for a pattern with no gap, with no dash
 * or dot, or with no length, and the caller then draws the entity solid.
 */
/** True for a mark whose fields a text or a shape can be drawn from, as `lint` holds them. */
function drawable(mark: unknown): mark is LinetypeMark {
  if (typeof mark !== "object" || mark === null) return false;
  const m = mark as Record<string, unknown>;
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const offset = m.offset;
  const what =
    "text" in m
      ? typeof m.text === "string" && finite(m.height) && (m.height as number) > 0
      : "shape" in m &&
        Number.isInteger(m.shape) &&
        typeof m.file === "string" &&
        finite(m.scale) &&
        m.scale !== 0;
  return (
    what &&
    Number.isInteger(m.after) &&
    (m.rotation === undefined || finite(m.rotation)) &&
    (m.orient === undefined || (MARK_ORIENTS as readonly unknown[]).includes(m.orient)) &&
    (m.style === undefined || typeof m.style === "string") &&
    (offset === undefined ||
      (Array.isArray(offset) && offset.length === 2 && finite(offset[0]) && finite(offset[1])))
  );
}

/**
 * A linetype's pattern as `alternating` gives it, with each of its marks at the end of its length,
 * measured from where the runs start. Undefined where `alternating` gives none.
 */
function linePattern(t: Linetype): LinePattern | undefined {
  const pattern = filled(t.pattern);
  const marks: readonly LinetypeMark[] = Array.isArray(t.marks) ? filled(t.marks) : [];
  // A pattern of dashes alone with marks draws them along a solid line, as one of no gap.
  const solid = pattern.length > 0 && pattern.every((length) => length >= 0);
  const whole = pattern.reduce((a, b) => a + Math.abs(b), 0);
  const alternated =
    solid && marks.length > 0 && whole > 0 ? { runs: [whole, 0], trail: 0 } : alternating(pattern);
  if (alternated === undefined) return undefined;
  const { runs, trail } = alternated;
  const total = runs.reduce((a, b) => a + b, 0);
  const first = pattern.findIndex((length) => length >= 0);
  const ends: number[] = [];
  let sum = 0;
  for (const length of pattern) ends.push((sum += Math.abs(length)));
  const shift = first > 0 ? ends[first - 1]! : 0;
  // Of two marks at one length only the first is drawn, so a pattern has no more marks than lengths.
  const seen = new Set<number>();
  return {
    runs,
    trail,
    lead: Math.abs(pattern[first]!),
    marks: marks.flatMap((mark) => {
      if (!drawable(mark)) return [];
      const end = ends[mark.after];
      if (end === undefined || seen.has(mark.after)) return [];
      seen.add(mark.after);
      // A mark on the length the pattern ends with, which a pattern that starts with a gap ends
      // where its runs start, is at the end of the pattern, whatever its lengths add up to.
      const last = mark.after === (first > 0 ? first - 1 : pattern.length - 1) && end > 0;
      const at = last ? 0 : (((end - shift) % total) + total) % total;
      return [{ at, end: last, mark }];
    }),
  };
}

function alternating(pattern: readonly number[]): { runs: number[]; trail: number } | undefined {
  const first = pattern.findIndex((length) => length >= 0);
  if (first < 0) return undefined;
  const runs: number[] = [];
  // A dot is a dash of no length. Runs alternate dash, gap, so an odd index is a gap.
  for (const length of [...pattern.slice(first), ...pattern.slice(0, first)]) {
    if (runs.length % 2 === (length < 0 ? 0 : 1)) runs[runs.length - 1]! += Math.abs(length);
    else runs.push(Math.abs(length));
  }
  if (runs.length < 2) return undefined;
  // A pattern that ends with a dash runs it into its first.
  const trail = runs.length % 2 === 1 ? runs.pop()! : 0;
  runs[0]! += trail;
  return runs.reduce((a, b) => a + b, 0) > 0 ? { runs, trail } : undefined;
}

/**
 * An entity cut into the dashes of its pattern, as path data, or undefined when the pattern
 * is too fine for the entity and it draws solid. A polyline starts the pattern again at each
 * vertex, as the leading CAD app does unless told otherwise. The cuts are made in the entity's own
 * coordinates, with the pattern shrunk by the insert's scale, and then placed by `matrix`, so a
 * dash is as long whatever size an insert draws its entity at.
 * Once the path is longer than `room` characters it stops, and is longer than the room. A
 * polyline's sides are read once a list of points, into `known`, so a placement does work only
 * for the sides it draws: one with no length draws nothing.
 */
function dashedPath(
  e: Exclude<Shape, { kind: "text" }>,
  pattern: Dashes,
  matrix: Matrix | undefined,
  room: number,
  known: Known,
  wide?: { readonly fills: string[]; readonly ends: string[] },
  letters?: Letters,
  spaceChord = 0,
): string | undefined {
  const { lengths: dashes, total } = pattern;
  // Dashes that add up to no length would never reach the end of a stretch.
  if (!(total > 0)) return undefined;
  const place = (px: number, py: number): string => {
    const [mx, my] = matrix ? mapPoint(matrix, [px, py]) : [px, py];
    return `${fmt(mx)} ${fmt(my)}`;
  };
  let out: string[] = [];
  let size = 0;
  /** Draws a dash from `from` to `to` along a stretch, and counts its characters. */
  const dash = (draw: (from: number, to: number) => string, from: number, to: number): void => {
    const drawn = draw(from, to);
    size += drawn.length + 1;
    out.push(drawn);
  };
  /**
   * Cuts a stretch of the given length, and draws each dash from `from` to `to` along it. A
   * line, a side of a polyline and an arc are `fitted`, a pattern that starts with a dot too, whose
   * end dots stay dots and whose leftover goes to the gaps beside them: it holds as many whole
   * patterns as fit in it, and its first and last dash are each half of the pattern's first
   * dash and of what is left over. A stretch shorter than its pattern is solid.
   */
  const cut = (
    length: number,
    draw: (from: number, to: number) => string,
    fitted = false,
    stretch = 1,
  ): boolean => {
    if (size > room) return true;
    if (length / total > MAX_DASHES) return false;
    const first = dashes[0]! * stretch;
    // The first run starts with the pattern's last dash when it ends with one, and runs on into
    // the dashes after its own first: a stretch starts with the pattern's own first dash, and is
    // fitted to it.
    const lead = pattern.lead * stretch;
    const after = first - pattern.trail * stretch - lead;
    let i = 0;
    let at = -pattern.trail * stretch;
    let last = length;
    // A stretch shorter than its pattern is solid, whatever the pattern starts with.
    if (fitted && length < total * (1 - 1e-9)) {
      dash(draw, 0, length);
      return true;
    }
    // A dot stays a dot: a stretch of a pattern that starts with one has a dot at each end, and
    // what is left over lengthens the gap after the first and before the last.
    const dotted = first === 0;
    if (fitted) {
      const k = Math.floor(length / total + 1e-9);
      const end = (length + lead - k * total) / 2;
      dash(draw, 0, dotted ? 0 : end + after);
      [i, at, last] = [1, end + after, length - end];
    }
    // The pattern ends where the last dash starts, or where the stretch ends, to within what
    // rounding moves a number.
    const stop = last - total * stretch * 1e-9;
    for (; at < stop && size <= room; i = (i + 1) % dashes.length) {
      if (i % 2 === 0) dash(draw, Math.max(at, 0), Math.min(at + dashes[i]! * stretch, last));
      at += dashes[i]! * stretch;
    }
    // A fitted stretch ends with its last dash, or a dot at its end.
    if (fitted && size <= room) dash(draw, dotted ? length : last, length);
    return true;
  };
  /** Draws the marks of a stretch, each where `frame` puts its point and its direction. */
  const markAlong = (
    length: number,
    frame: (s: number) => readonly [Point, Point],
    fitted: boolean,
    stretch = 1,
  ): void => {
    if (letters === undefined || pattern.marks === undefined) return;
    for (const { s, mark } of markSpots(length, pattern, fitted, stretch)) {
      if (size > room) return;
      const [p, t] = frame(s);
      const drawn = letterAt(mark, p, t, matrix, letters);
      if (drawn === undefined) continue;
      size += drawn.length + 1;
      letters.out.push(drawn);
    }
  };
  // An insert that scales one way more than the other draws a straight side longer or shorter
  // than the pattern's shrink allows for, and the pattern is fitted to it as it is drawn.
  const shrink = matrix ? Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2])) : 1;
  // `Look.chord` in the entity's own units.
  const chord = shrink > 0 && Number.isFinite(spaceChord / shrink) ? spaceChord / shrink : 0;
  const gauge = (a: Point, b: Point, length: number): number => {
    if (!matrix || !(shrink > 0)) return 1;
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const drawn = Math.hypot(matrix[0] * dx + matrix[2] * dy, matrix[1] * dx + matrix[3] * dy);
    const g = drawn / (length * shrink);
    return Number.isFinite(g) && g > 0 && Math.abs(g - 1) > 1e-9 ? g : 1;
  };
  /** Cuts a straight stretch; a side of a polyline too fine for its pattern as drawn is drawn solid. */
  const straight = (a: Point, b: Point, side = false): boolean => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length === 0) return true;
    const g = gauge(a, b, length);
    const along = (t: number) =>
      place(a[0] + ((b[0] - a[0]) * t) / g / length, a[1] + ((b[1] - a[1]) * t) / g / length);
    const draw = (from: number, to: number) => `M ${along(from)} L ${along(to)}`;
    const done = cut(length * g, draw, true) || (side && (dash(draw, 0, length * g), true));
    const frame = sideFrame({ from: a, to: b }, undefined, length);
    markAlong(length * g, (at) => frame(at / g), true);
    return done;
  };
  const round = (
    center: Point,
    radius: number,
    start: number,
    turn: number,
    fitted: boolean,
    stretch = 1,
    marked = true,
  ): boolean => {
    // A negative turn runs clockwise, and its pattern runs that way from `start`.
    const way = turn < 0 ? -1 : 1;
    const along = (t: number) => {
      const angle = rad(start) + (way * t) / radius;
      return place(center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle));
    };
    // The pattern is fitted to the straight pieces the arc is cut into, and drawn along the arc.
    const length = radius * rad(Math.abs(turn));
    const pieces = piecesLength(radius, rad(Math.abs(turn)), chord);
    const k = pieces > 0 ? length / pieces : 1;
    if (marked) {
      const frame = arcFrame(center, radius, rad(start), rad(turn), length, chord);
      markAlong(pieces, (at) => frame(at * k), fitted, stretch);
    }
    const shape = rounded(radius, matrix);
    const sweep = way > 0 ? shape.sweep : 1 - shape.sweep;
    return cut(
      pieces,
      (a, b) => {
        const [from, to] = [a * k, b * k];
        // SVG draws no arc between two equal points, so a dot is a line of no length.
        if (to === from) return `M ${along(from)} L ${along(to)}`;
        const arc = `A ${fmt(shape.rx)} ${fmt(shape.ry)} ${fmt(shape.turn)}`;
        // A dash of a full turn ends where it starts, so it is drawn as two halves.
        if ((to - from) / radius > Math.PI && along(from) === along(to)) {
          return `M ${along(from)} ${arc} 0 ${sweep} ${along((from + to) / 2)} ${arc} 0 ${sweep} ${along(to)}`;
        }
        const large = (to - from) / radius > Math.PI ? 1 : 0;
        return `M ${along(from)} ${arc} ${large} ${sweep} ${along(to)}`;
      },
      fitted,
      stretch,
    );
  };
  let ok: boolean;
  switch (e.kind) {
    case "line":
      ok = straight(e.from, e.to);
      break;
    case "polyline": {
      const plan = planOf(e, known);
      // A polyline with a side whose width changes along it starts the pattern again at each
      // vertex whatever its flag says, as the leading CAD app does.
      const tapered = plan?.parts.some(({ side }) => side.startWidth !== side.endWidth) ?? false;
      if (e.linetypeGeneration === true && !tapered) {
        const course = courseOf(e, plan, known).map((piece) => {
          const { arc } = piece;
          const local = arc ? piecesLength(arc.radius, Math.abs(arc.sweep), chord) : piece.length;
          const g = arc ? 1 : gauge(piece.side.from, piece.side.to, piece.length);
          return { ...piece, local, length: local * g, gauge: g };
        });
        if (course.length === 0) return undefined;
        const ends: number[] = [];
        let length = 0;
        for (const piece of course) ends.push((length += piece.length));
        if (length / total > MAX_DASHES) return undefined;
        // Around a closed polyline the pattern goes a whole number of times, stretched alike,
        // and the course starts at its second point.
        const patterns = Math.round(length / total);
        if (e.closed && patterns < 1) return undefined;
        const stretch = e.closed ? length / (patterns * total) : 1;
        /** The piece that holds `at` along the course, and how far into it. */
        const locate = (at: number): readonly [number, number] => {
          // The first piece that ends at or past `at`, found by halving.
          let [lo, hi] = [0, course.length - 1];
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (at > ends[mid]!) lo = mid + 1;
            else hi = mid;
          }
          return [lo, at - (ends[lo]! - course[lo]!.length)];
        };
        const strokes = out;
        const piece = (i: number, from: number, to: number): string => {
          const { side, arc, length: l } = course[i]!;
          if (isWide(side)) {
            wide?.fills.push(bandPiece(side, arc, from / l, to / l, place, matrix));
            return "";
          }
          return pieceTrace(side, arc, from / l, to / l, place, matrix);
        };
        cut(
          length,
          (from, to) => {
            const [i] = locate(from);
            const [j] = locate(to);
            const drawn: string[] = [];
            // Whether the last piece drawn was a line, which the next runs on from.
            let joined = false;
            for (let k = i; k <= j; k++) {
              const start = ends[k]! - course[k]!.length;
              const a = Math.max(from, start) - start;
              const b = Math.min(to, ends[k]!) - start;
              const traced = piece(k, a, Math.max(a, b));
              if (traced === "") joined = false;
              else {
                drawn.push(joined ? traced.replace(/^M \S+ \S+ /, "") : traced);
                joined = true;
              }
            }
            return drawn.join(" ");
          },
          !e.closed,
          stretch,
        );
        out = strokes.filter((d) => d !== "");
        // An open course that ends on a wide straight side ends in the thinnest line across it.
        const end = course.at(-1)!;
        if (!e.closed && isWide(end.side) && !end.arc && length >= total * (1 - 1e-9)) {
          const ended = bandPiece(end.side, undefined, 1, 1, place, matrix).split(" L ");
          const across = `${ended[0]!} L ${ended[2]!}`;
          size += across.length + 1;
          wide?.ends.push(across);
        }
        markAlong(
          length,
          (at) => {
            const [i, into] = locate(at);
            const { side, arc, local, gauge: g } = course[i]!;
            return sideFrame(side, arc, local, chord)(into / g);
          },
          !e.closed,
          stretch,
        );
        ok = true;
        break;
      }
      if (plan) {
        // A side the pattern is too fine for draws the whole polyline solid.
        if (plan.longest / total > MAX_DASHES) return undefined;
        const strokes = out;
        for (const { side, arc, fit } of plan.parts) {
          if (size > room) break;
          if (!isWide(side)) {
            if (!arc) straight(side.from, side.to, true);
            else {
              // An arc is cut the way the polyline runs, clockwise or not.
              round(arc.center, arc.radius, degrees(arc.start), degrees(arc.sweep), true, 1, false);
              const pieces = piecesLength(arc.radius, Math.abs(arc.sweep), chord);
              markAlong(pieces, sideFrame(side, arc, pieces, chord), true);
            }
            continue;
          }
          // Each dash of a wide side is filled, square at both ends, fitted to the side as drawn.
          out = [];
          const g = arc ? 1 : gauge(side.from, side.to, fit);
          const drawn = fit * g;
          const band = (from: number, to: number) =>
            bandPiece(side, arc, from / drawn, to / drawn, place, matrix);
          // A side too fine for its pattern as it is drawn is filled whole.
          if (!cut(drawn, band, true)) dash(band, 0, drawn);
          const frame = sideFrame(side, arc, fit, chord);
          markAlong(drawn, (at) => frame(at / g), true);
          if (out.length > 0) wide?.fills.push(out.join(" "));
          out = strokes;
          // A straight side cut into dashes ends in the thinnest line across its end, and so does
          // an arc whose width changes, at the end it reaches counterclockwise.
          const tapered = side.startWidth !== side.endWidth;
          if ((!arc || tapered) && fit >= total * (1 - 1e-9)) {
            const t = !arc || arc.sweep > 0 ? 1 : 0;
            const ended = bandPiece(side, arc, t, t, place, matrix).split(" L ");
            const across = arc
              ? `${ended[0]!} L ${ended[ended.length / 2]!}`
              : `${ended[0]!} L ${ended[2]!}`;
            size += across.length + 1;
            wide?.ends.push(across);
          }
        }
        ok = true;
        break;
      }
      const { points, ends, longest } = sidesOf(e.points, known);
      const [first, last] = [points[0], points.at(-1)];
      // The side that closes it, NaN when there is none.
      const closing =
        e.closed && first && last ? Math.hypot(first[0] - last[0], first[1] - last[1]) : NaN;
      // A side the pattern is too fine for draws the whole polyline solid.
      if ((closing > longest ? closing : longest) / total > MAX_DASHES) return undefined;
      for (const end of ends) {
        if (size > room) break;
        straight(points[end - 1]!, points[end]!, true);
      }
      if (closing > 0) straight(last!, first!, true);
      ok = true;
      break;
    }
    case "point":
      return undefined;
    case "circle": {
      // A circle holds the whole number of patterns nearest its length, each stretched or
      // shrunk alike to go round it exactly, from a dash at its angle 0. One shorter than its
      // pattern is solid.
      const around = piecesLength(e.radius, 2 * Math.PI, chord);
      if (!(around >= total)) return undefined;
      ok = round(e.center, e.radius, 0, 360, false, around / (Math.round(around / total) * total));
      break;
    }
    case "arc":
      ok = round(e.center, e.radius, e.startAngle, sweep(e.startAngle, e.endAngle), true);
      break;
    case "ellipse":
    case "spline": {
      // A curve's pattern runs along its whole length: fitted as a line's is, or, for one that
      // closes, as a circle's is, from its start.
      const curve = curveOf(e, known);
      if (!curve) return undefined;
      const flat = flatOf(curve);
      const closed = flat.closed;
      // Under an insert the pattern runs along the curve as it plots, so the curve is placed first
      // and measured there, in the block's units the pattern is shrunk to.
      const grown = matrix ? Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2])) : 1;
      // A matrix that turns, mirrors and scales alike keeps the curve's lengths in the block's
      // units, so only the points a dash writes are placed. Any other places the whole curve,
      // which a curve drawn again pays for.
      const [a, b, c, d] = matrix ?? [1, 0, 0, 1];
      const alike = (x: number, y: number) => Math.abs(x - y) <= 1e-12 * grown;
      const similar = (alike(a, d) && alike(b, -c)) || (alike(a, -d) && alike(b, c));
      let points: readonly Point[] = flat.points;
      let lengths: readonly number[] = flat.lengths;
      if (matrix && !similar) {
        known.readAgain([flat.points]);
        const placed = flat.points.map((p) => mapPoint(matrix, p));
        const measured = [0];
        for (let i = 1; i < placed.length; i++) {
          const [p, q] = [placed[i - 1]!, placed[i]!];
          measured.push(measured[i - 1]! + Math.hypot(q[0] - p[0], q[1] - p[1]) / grown);
        }
        [points, lengths] = [placed, measured];
      }
      const put = (p: Point): string => {
        const [x, y] = matrix && similar ? mapPoint(matrix, p) : p;
        return `${fmt(x)} ${fmt(y)}`;
      };
      const length = lengths[lengths.length - 1]!;
      const along = (from: number, to: number): string => {
        const at = (t: number, i: number): Point => {
          const [a, b] = [points[i]!, points[i + 1] ?? points[i]!];
          const span = lengths[i + 1]! - lengths[i]!;
          const f = span > 0 ? (t - lengths[i]!) / span : 0;
          return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        };
        // The step that holds `t`: the last whose length is at most `t`.
        const step = (t: number): number => {
          let [lo, hi] = [0, lengths.length - 2];
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (lengths[mid]! <= t) lo = mid;
            else hi = mid - 1;
          }
          return lo;
        };
        const [i, j] = [step(from), step(to)];
        const drawn = [`M ${put(at(from, i))}`];
        for (let k = i + 1; k <= j; k++) drawn.push(`L ${put(points[k]!)}`);
        drawn.push(`L ${put(at(to, j))}`);
        return drawn.join(" ");
      };
      if (!(length > 0) || !(grown > 0)) return undefined;
      if (!closed) ok = cut(length, along, true);
      else {
        if (!(length >= total)) return undefined;
        ok = cut(length, along, false, length / (Math.round(length / total) * total));
      }
      break;
    }
  }
  return ok && (out.length > 0 || (wide?.fills.length ?? 0) > 0) ? out.join(" ") : undefined;
}

/** A style's font alone: the leading CAD app draws a linetype's text in neither its width nor its slant. */
function fontOnly(style: TextStyle | undefined): TextStyle | undefined {
  return style === undefined ? undefined : { name: style.name, font: style.font };
}

/** Where the texts and shapes of a pen's linetype go, when it has any: drawn in its pen, with no mark. */
function lettersOf(pen: Pen, look: Look): Letters | undefined {
  if (!pen.dashes?.marks?.length) return undefined;
  const stroked = `stroke="${pen.color}"${look.stroke(pen.lineweight)}`;
  return {
    out: [],
    text: (t, style) => textToSvg(t, style, pen, "", undefined, false),
    shape: (d) => `<path d="${d}" ${stroked}/>`,
  };
}

/**
 * Where the texts and shapes of a linetype go, and how each is drawn: a text as the entity's own
 * text, and a shape's outlines as the path `d`, in the entity's pen and never dashed.
 */
interface Letters {
  readonly out: string[];
  readonly text: (t: Text, style: TextStyle | undefined) => string;
  readonly shape: (d: string) => string;
}

/**
 * Where along a stretch of `length` each mark of a pattern is drawn, from the stretch's start.
 * A fitted stretch draws them in each of its whole patterns, from where its first dash's pattern
 * would start, one at the end of the pattern at the end of each and at the end of the stretch,
 * and one shorter than its pattern none. One that is not fitted draws them in each
 * time its stretched pattern goes along it.
 */
function* markSpots(
  length: number,
  dashes: Dashes,
  fitted: boolean,
  stretch: number,
): Generator<{ readonly s: number; readonly mark: ScaledMark }> {
  const { marks, total, lengths } = dashes;
  if (marks === undefined || !(total > 0) || length / total > MAX_DASHES) return;
  if (fitted) {
    if (length < total * (1 - 1e-9)) return;
    // Each pattern starts with its own first dash, after the last dash the first run starts with.
    const lead = dashes.lead;
    const count = Math.floor(length / total + 1e-9);
    const start = (length + lead - count * total) / 2 - lead;
    for (let k = 0; k < count; k++)
      for (const mark of marks) yield { s: start + k * total + (mark.end ? total : mark.at), mark };
    // A mark at the end of the pattern comes once more at the end of the stretch.
    for (const mark of marks) if (mark.end) yield { s: length, mark };
    return;
  }
  const count = Math.round(length / (total * stretch));
  // Round a closed course, a mark at the end of the pattern comes at the end of each but the last,
  // where the course closes.
  for (let k = 0; k < count; k++) {
    for (const mark of marks) {
      if (mark.end && k === count - 1) continue;
      yield { s: (k * total + (mark.end ? total : mark.at)) * stretch, mark };
    }
  }
}

/**
 * A point of a side `length` long, `s` along it from its start, and the way it runs there, in
 * the side's own coordinates. Past either end of a straight side it runs on along it.
 */
function sideFrame(
  side: Pick<PolylineSide, "from" | "to">,
  arc: SideArc | undefined,
  length: number,
  chord = 0,
): (s: number) => readonly [Point, Point] {
  if (!arc) {
    const [dx, dy] = [(side.to[0] - side.from[0]) / length, (side.to[1] - side.from[1]) / length];
    return (s) => [
      [side.from[0] + dx * s, side.from[1] + dy * s],
      [dx, dy],
    ];
  }
  return arcFrame(arc.center, arc.radius, arc.start, arc.sweep, length, chord);
}

/** How many straight pieces the leading CAD app cuts an arc turning `sweep` radians into. */
function pieceCount(radius: number, sweep: number, chord: number): number {
  const most = chord > 0 && chord < radius ? 2 * Math.acos(1 - chord / radius) : Math.PI;
  const step = Math.min(most, (2 * Math.PI) / 32);
  const count = Math.ceil(sweep / step - 1e-9);
  return Number.isFinite(count) ? Math.max(1, Math.min(MAX_DASHES, count)) : 1;
}

/** How long those pieces are together, which a pattern is fitted to. The arc's own length with no chord. */
function piecesLength(radius: number, sweep: number, chord: number): number {
  if (!(chord > 0)) return radius * sweep;
  const count = pieceCount(radius, sweep, chord);
  return 2 * radius * count * Math.sin(sweep / (2 * count));
}

/**
 * A point of an arc `length` long, `s` along it from its start, and the way it runs there: on
 * the straight pieces the leading CAD app cuts it into, of equal turns from its start, each
 * straying at most `chord` from it, and a whole circle into 32 at least.
 */
function arcFrame(
  center: Point,
  radius: number,
  start: number,
  sweep: number,
  length: number,
  chord: number,
): (s: number) => readonly [Point, Point] {
  const pieces = pieceCount(radius, Math.abs(sweep), chord);
  const at = (k: number): Point => {
    const angle = start + (sweep * k) / pieces;
    return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
  };
  return (s) => {
    const t = Math.min(Math.max((s / length) * pieces, 0), pieces);
    const k = Math.min(pieces - 1, Math.floor(t));
    const [a, b] = [at(k), at(k + 1)];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(dx, dy);
    const u = t - k;
    return [
      [a[0] + dx * u, a[1] + dy * u],
      l > 0 ? [dx / l, dy / l] : [-Math.sin(start), Math.cos(start)],
    ];
  };
}

/**
 * The sides of a polyline that have a length, in order, as one course for a pattern that runs on
 * past each vertex. A closed one's course starts at its second point, where the leading CAD app
 * starts it.
 */
function courseOf(
  e: Polyline,
  plan: Plan | undefined,
  known: Known,
): { readonly side: PolylineSide; readonly arc: SideArc | undefined; readonly length: number }[] {
  let course: { side: PolylineSide; arc: SideArc | undefined; length: number }[];
  if (plan) {
    course = plan.parts.map(({ side, arc }) => ({ side, arc, length: sideLength(side, arc) }));
  } else {
    const { points, ends } = sidesOf(e.points, known);
    const straight = (from: Point, to: Point) => ({
      side: { from, to, bulge: 0, startWidth: 0, endWidth: 0 },
      arc: undefined,
      length: Math.hypot(to[0] - from[0], to[1] - from[1]),
    });
    course = ends.map((end) => straight(points[end - 1]!, points[end]!));
    const [first, last] = [points[0], points.at(-1)];
    if (e.closed && first && last) {
      const closing = straight(last, first);
      if (closing.length > 0) course.push(closing);
    }
  }
  if (e.closed && course.length > 1) course = [...course.slice(1), course[0]!];
  return course.filter((piece) => piece.length > 0);
}

/** The path of a side of no width from `t0` to `t1` of the way along it, where `matrix` puts it. */
function pieceTrace(
  side: PolylineSide,
  arc: SideArc | undefined,
  t0: number,
  t1: number,
  place: (x: number, y: number) => string,
  matrix: Matrix | undefined,
): string {
  if (!arc) {
    const at = (t: number) =>
      place(
        side.from[0] + (side.to[0] - side.from[0]) * t,
        side.from[1] + (side.to[1] - side.from[1]) * t,
      );
    return `M ${at(t0)} L ${at(t1)}`;
  }
  const at = (t: number) => {
    const [x, y] = arcPoint(arc, t);
    return place(x, y);
  };
  if (t1 === t0) return `M ${at(t0)} L ${at(t1)}`;
  const round = rounded(arc.radius, matrix);
  const flag = arc.sweep > 0 ? round.sweep : 1 - round.sweep;
  const a = `A ${fmt(round.rx)} ${fmt(round.ry)} ${fmt(round.turn)} 0 ${flag}`;
  // An arc of more than half a turn is drawn as two halves.
  if (Math.abs(arc.sweep * (t1 - t0)) > Math.PI) {
    return `M ${at(t0)} ${a} ${at((t0 + t1) / 2)} ${a} ${at(t1)}`;
  }
  return `M ${at(t0)} ${a} ${at(t1)}`;
}

/**
 * A linetype's text at a point of its line where the line runs along `t`, both in the entity's
 * own coordinates, drawn where `matrix` puts it. Its offset is along the line and to its left as
 * the line is drawn, and an upright text turns half a turn about the middle of its box where the
 * line runs leftward in its own coordinates. A shape is drawn from its file's outlines, from the
 * same point, turned and scaled alike.
 */
function letterAt(
  m: ScaledMark,
  p: Point,
  t: Point,
  matrix: Matrix | undefined,
  letters: Letters,
): string | undefined {
  const mark = m.mark;
  if (m.shape !== undefined && "shape" in mark) return shapeAt(m, m.shape, p, t, matrix, letters);
  if (!("text" in mark) || typeof mark.text !== "string") return undefined;
  const [px, py] = matrix ? mapPoint(matrix, p) : p;
  let [tx, ty] = matrix
    ? [matrix[0] * t[0] + matrix[2] * t[1], matrix[1] * t[0] + matrix[3] * t[1]]
    : t;
  const along = Math.hypot(tx, ty);
  if (!(along > 0)) return undefined;
  [tx, ty] = [tx / along, ty / along];
  const offset = mark.offset;
  const [ox, oy] = offset === undefined ? [0, 0] : [offset[0], offset[1]];
  const k = m.size;
  let x = px + (ox * tx - oy * ty) * k;
  let y = py + (ox * ty + oy * tx) * k;
  const height = mark.height * k;
  const orient = mark.orient ?? "relative";
  let rotation = (orient === "absolute" ? 0 : degrees(Math.atan2(ty, tx))) + (mark.rotation ?? 0);
  const text: Text = { kind: "text", layer: "0", at: [x, y], height, value: mark.text, rotation };
  if (orient === "upright") {
    const local = ((degrees(Math.atan2(t[1], t[0])) % 360) + 360) % 360;
    if (local > 90 + 1e-9 && local < 270 - 1e-9) {
      const laid = layoutText(inStyle(text, m.style));
      const trueType = fontInfo(m.style?.font ?? STANDARD_FONT)?.pitchAndFamily !== undefined;
      const w = trueType ? laid.advances : laid.end - laid.start;
      const r = rad(rotation);
      x += w * Math.cos(r) - height * Math.sin(r);
      y += w * Math.sin(r) + height * Math.cos(r);
      rotation += 180;
    }
  }
  return letters.text({ ...text, at: [x, y], rotation }, m.style);
}

/** A linetype's shape at a point of its line, as `letterAt` places a text, as one path. */
function shapeAt(
  m: ScaledMark,
  shape: ShapeDefinition,
  p: Point,
  t: Point,
  matrix: Matrix | undefined,
  letters: Letters,
): string | undefined {
  const mark = m.mark as LinetypeShape;
  if (shape.outlines.length === 0) return undefined;
  const [px, py] = matrix ? mapPoint(matrix, p) : p;
  let [tx, ty] = matrix
    ? [matrix[0] * t[0] + matrix[2] * t[1], matrix[1] * t[0] + matrix[3] * t[1]]
    : t;
  const along = Math.hypot(tx, ty);
  if (!(along > 0)) return undefined;
  [tx, ty] = [tx / along, ty / along];
  const [ox, oy] = mark.offset === undefined ? [0, 0] : [mark.offset[0], mark.offset[1]];
  const k = m.size;
  const x = px + (ox * tx - oy * ty) * k;
  const y = py + (ox * ty + oy * tx) * k;
  const orient = mark.orient ?? "relative";
  let rotation = (orient === "absolute" ? 0 : Math.atan2(ty, tx)) + rad(mark.rotation ?? 0);
  if (orient === "upright") {
    const local = ((degrees(Math.atan2(t[1], t[0])) % 360) + 360) % 360;
    if (local > 90 + 1e-9 && local < 270 - 1e-9) rotation += Math.PI;
  }
  const size = mark.scale * k;
  const [c, s] = [Math.cos(rotation) * size, Math.sin(rotation) * size];
  const place = ([u, v]: Point): string => `${fmt(x + u * c - v * s)} ${fmt(y + u * s + v * c)}`;
  const parts: string[] = [];
  for (const { points, bulges } of shape.outlines) {
    parts.push(`M ${place(points[0]!)}`);
    for (let i = 1; i < points.length; i++) {
      const bulge = bulges?.[i - 1] ?? 0;
      if (bulge === 0) {
        parts.push(`L ${place(points[i]!)}`);
        continue;
      }
      const [a, b] = [points[i - 1]!, points[i]!];
      const turn = 4 * Math.atan(Math.abs(bulge));
      const radius =
        (Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.abs(size)) / (2 * Math.sin(turn / 2));
      const large = turn > Math.PI ? 1 : 0;
      parts.push(`A ${fmt(radius)} ${fmt(radius)} 0 ${large} ${bulge > 0 ? 1 : 0} ${place(b)}`);
    }
  }
  return letters.shape(parts.join(" "));
}

/**
 * The path of the filled piece of a side from `t0` to `t1` of the way along it, square to the
 * side at both ends, where `matrix` puts it: its left edge from `t0` to `t1`, then its right edge
 * back. The width changes along it from the side's start width to its end width.
 */
function bandPiece(
  side: PolylineSide,
  arc: SideArc | undefined,
  t0: number,
  t1: number,
  place: (x: number, y: number) => string,
  matrix: Matrix | undefined,
): string {
  const half = (t: number): number => (side.startWidth + (side.endWidth - side.startWidth) * t) / 2;
  if (!arc) {
    const [dx, dy] = [side.to[0] - side.from[0], side.to[1] - side.from[1]];
    const length = Math.hypot(dx, dy);
    const [nx, ny] = [-dy / length, dx / length];
    const edge = (t: number, h: number): string =>
      place(side.from[0] + dx * t + nx * h, side.from[1] + dy * t + ny * h);
    return `M ${edge(t0, half(t0))} L ${edge(t1, half(t1))} L ${edge(t1, -half(t1))} L ${edge(t0, -half(t0))}`;
  }
  // The left of an arc that turns counterclockwise is toward its center.
  const inward = arc.sweep > 0 ? 1 : -1;
  const point = (t: number, h: number): string => {
    const [x, y] = arcPoint(arc, t, arc.radius + h);
    return place(x, y);
  };
  if (side.startWidth === side.endWidth) {
    const h = side.startWidth / 2;
    /** The edge `offset` off the middle from `from` to `to` of the way along, in arcs of at most half a turn. */
    const edge = (offset: number, from: number, to: number): string => {
      const round = rounded(Math.abs(arc.radius + offset), matrix);
      // sweep-flag 1 is counterclockwise in local coordinates, which a mirroring matrix turns.
      const ccw = arc.sweep > 0 === to > from;
      const flag = ccw ? round.sweep : 1 - round.sweep;
      const a = `A ${fmt(round.rx)} ${fmt(round.ry)} ${fmt(round.turn)} 0 ${flag}`;
      return Math.abs(arc.sweep * (to - from)) > Math.PI
        ? `${a} ${point((from + to) / 2, offset)} ${a} ${point(to, offset)}`
        : `${a} ${point(to, offset)}`;
    };
    const [left, right] = [-inward * h, inward * h];
    return `M ${point(t0, left)} ${edge(left, t0, t1)} L ${point(t1, right)} ${edge(right, t1, t0)}`;
  }
  // An edge whose width changes along the arc is drawn in chords of at most 5 degrees.
  const count = Math.max(2, Math.ceil((Math.abs(arc.sweep) * (t1 - t0)) / (Math.PI / 36)));
  const along = (h: (t: number) => number, from: number, to: number): string[] =>
    Array.from({ length: count + 1 }, (_, k) => {
      const t = from + ((to - from) * k) / count;
      return point(t, h(t));
    });
  const left = along((t) => -inward * half(t), t0, t1);
  const right = along((t) => inward * half(t), t1, t0);
  return `M ${[...left, ...right].join(" L ")}`;
}

/**
 * A polyline with an arc or a width: each wide side filled, with its joins, and each run of
 * sides of width 0 as one path, straight or along its arcs. With dashes, each dash of a wide side
 * is filled on its own. Several elements are a group, which `mark` is on.
 */
function polylineToSvg(
  e: Polyline,
  plan: Plan,
  mark: string,
  pen: Pen,
  look: Look,
  matrix: Matrix | undefined,
  room: number,
  known: Known,
): string {
  const place = (px: number, py: number): string => {
    const [mx, my] = matrix ? mapPoint(matrix, [px, py]) : [px, py];
    return `${fmt(mx)} ${fmt(my)}`;
  };
  const stroked = `stroke="${pen.color}"${look.stroke(pen.lineweight)}`;
  const fill = `fill="${pen.color}" stroke="none"`;
  const parts: string[] = [];
  const dashed = pen.dashes
    ? { fills: [] as string[], ends: [] as string[], d: undefined as string | undefined }
    : undefined;
  const letters = lettersOf(pen, look);
  if (pen.dashes && dashed)
    dashed.d = dashedPath(e, pen.dashes, matrix, room, known, dashed, letters, look.chord);
  if (dashed && (dashed.d !== undefined || dashed.fills.length > 0)) {
    const cap = pen.dashes?.dot ? ` stroke-linecap="round"` : "";
    if (dashed.d) parts.push(`<path d="${dashed.d}"${cap} ${stroked}/>`);
    for (const d of dashed.fills) parts.push(`<path d="${d}" ${fill}/>`);
    if (dashed.ends.length > 0) {
      parts.push(`<path d="${dashed.ends.join(" ")}" stroke="${pen.color}"${look.stroke(0)}/>`);
    }
    parts.push(...(letters?.out ?? []));
  } else {
    let run: string[] = [];
    let used = 0;
    const flush = (): void => {
      if (run.length > 0) parts.push(`<path d="${run.join(" ")}" ${stroked}/>`);
      run = [];
    };
    for (const { side, arc, band } of plan.parts) {
      if (used > room) break;
      if (band) {
        flush();
        const d = band.arc
          ? bandPiece(side, band.arc, 0, 1, place, matrix)
          : `M ${[band.startLeft, band.endLeft, band.endRight, band.startRight].map(([x, y]) => place(x, y)).join(" L ")}`;
        parts.push(`<path d="${d}" ${fill}/>`);
        used += d.length;
        continue;
      }
      if (run.length === 0) run.push(`M ${place(...side.from)}`);
      if (!arc) run.push(`L ${place(...side.to)}`);
      else {
        const round = rounded(arc.radius, matrix);
        const flag = arc.sweep > 0 ? round.sweep : 1 - round.sweep;
        const a = `A ${fmt(round.rx)} ${fmt(round.ry)} ${fmt(round.turn)} 0 ${flag}`;
        // An arc of more than half a turn is drawn as two halves, so that no arc of the path
        // ends where it starts, which SVG would draw as nothing.
        if (Math.abs(arc.sweep) > Math.PI) run.push(`${a} ${place(...arcPoint(arc, 0.5))}`);
        run.push(`${a} ${place(...side.to)}`);
      }
      used += run.at(-1)!.length;
    }
    flush();
  }
  if (parts.length === 0) return `<g ${mark}/>`;
  if (parts.length === 1) return parts[0]!.replace(/\/>$/, ` ${mark}/>`);
  return `<g ${mark}>\n${look.indent}  ${parts.join(`\n${look.indent}  `)}\n${look.indent}</g>`;
}

function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * The sides of a list of points that have a length, read once into `known`. A side whose length
 * is 0, or not a number, draws no dash.
 */
function sidesOf(list: unknown, known: Known): Sides {
  const found = typeof list === "object" && list !== null ? known.sides.get(list) : undefined;
  if (found) return found;
  const points = filled(list) as readonly Point[];
  const ends: number[] = [];
  let longest = 0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1]!, points[i]!];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(length > 0)) continue;
    ends.push(i);
    if (length > longest) longest = length;
  }
  const sides = { points, ends, longest };
  if (typeof list === "object" && list !== null) known.sides.set(list, sides);
  return sides;
}

function rad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function esc(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}
