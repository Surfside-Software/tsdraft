// The read model: what a reader of a drawing file gives. It is not a `Drawing`. It holds what a
// drawing file states about its tables, its blocks, its xrefs and its layouts, a census of what
// each space draws and, for a read that asks for it, what each space draws, and is never
// written back.
import type { ParagraphColumns } from "../paragraphs.ts";
import type { Point } from "../drawing.ts";
import type { KnotSpacing } from "../curves.ts";

/** The format of a `DrawingRead`. A reader gives the format it was built for. */
export const READ_FORMAT = 0;

/**
 * What a reader read from one drawing file. Its size grows with the file's tables, and with
 * its entities only up to the limit of each list: `CENSUS_LIMIT` for a space's census, its
 * viewports and its inserts and for the fields, `BLOCK_ITEMS` for the blocks, `GEOMETRY_ITEMS`
 * for what the spaces draw, 64 heights for one `MTEXT` and 1,000 tags for one insert. Every
 * object keyed by names from the file, such as a census's `layers`, has no prototype, so any
 * name is a key.
 */
export interface DrawingRead {
  readonly format: typeof READ_FORMAT;
  /** The SHA-256 of the file's bytes, as 64 lower-case hexadecimal digits. */
  readonly sha256: string;
  /** How many bytes the file holds. */
  readonly bytes: number;
  /** `$ACADVER`, such as `AC1032`, when the file states it. */
  readonly version?: string;
  /** `$DWGCODEPAGE`, such as `ANSI_1252`, when the file states it. */
  readonly codepage?: string;
  /**
   * The encoding the reader decoded the file's text with: a WHATWG label, or `ibm437` or
   * `ibm850` for the two DOS code pages.
   */
  readonly encoding: string;
  readonly header: ReadHeader;
  readonly layers: readonly ReadLayer[];
  readonly linetypes: readonly ReadLinetype[];
  readonly textStyles: readonly ReadTextStyle[];
  readonly dimensionStyles: readonly ReadDimensionStyle[];
  /**
   * Each block that is not a space or an xref. The pictures of dimensions, the blocks `*D` and a
   * number, are kept by a read with `geometry` alone.
   */
  readonly blocks: readonly ReadBlock[];
  readonly xrefs: readonly ReadXref[];
  /**
   * Each image definition of the file's dictionary of them, in the order of the dictionary, those
   * no image uses among them: the leading CAD app keeps one through a save and a purge.
   */
  readonly images: readonly ReadImageDefinition[];
  /** Model space: its census, and with `geometry` what it draws. */
  readonly model: ReadSpace;
  /** Each layout of paper space, in the order of its tab. */
  readonly layouts: readonly ReadLayout[];
  /** Each field of an `MTEXT`, of model space, a layout or a block. */
  readonly fields: readonly ReadField[];
  /**
   * Field codes that are not kept, counted by kind, such as `\AcVar SaveDate`, with `not on an
   * MTEXT` for a field of a text or an attribute and `past the limit` for those past
   * `CENSUS_LIMIT`.
   */
  readonly otherFields: Readonly<Record<string, number>>;
  /** What the reader did not understand, counted by kind. */
  readonly unread: ReadUnread;
  /** The tab the file opens on and the view it shows there, when the file states one. */
  readonly opensAt?: ReadView;
}

/** What a reader reads. */
export interface ReadOptions {
  /**
   * True to read what model space and each layout draws, into their `entities`, and the
   * attributes of each insert. Without it a space holds its census alone.
   */
  readonly geometry?: boolean;
}

/** The view a file opens at: a piece of model space, or of a layout's paper. */
export interface ReadView {
  /** The layout it opens on, or none for the model tab. */
  readonly layout?: string;
  /** The point at the middle of the view. */
  readonly center: Point;
  /** How tall and how wide a piece of the space it shows. */
  readonly height: number;
  readonly width: number;
}

/** Header variables, each when the file states it. */
export interface ReadHeader {
  /** `$INSUNITS`: 1 inches, 2 feet, 4 millimeters, 5 centimeters, 6 meters, and others. */
  readonly insunits?: number;
  /** `$MEASUREMENT`: 0 English, 1 metric. */
  readonly measurement?: number;
  readonly ltscale?: number;
  readonly psltscale?: number;
  readonly msltscale?: number;
  readonly dimscale?: number;
  /** `$DIMSTYLE`, the current dimension style. */
  readonly dimstyle?: string;
  /** `$TEXTSTYLE`, the current text style. */
  readonly textstyle?: string;
  /**
   * The dictionary variable `WIPEOUTFRAME`, which the leading CAD app reads of whether wipeouts'
   * frames show: 0 neither shown nor plotted, 1 both, 2 shown and not plotted. A file without it
   * shows and plots them.
   */
  readonly wipeoutFrame?: number;
}

/** A layer of the file's table, with its state as the file holds it. */
export interface ReadLayer {
  readonly handle?: string | undefined;
  readonly name: string;
  /** The color index, 1 to 255, even when the layer is off. */
  readonly color?: number;
  /** A true color as 0xRRGGBB, when the layer has one. */
  readonly trueColor?: number;
  readonly linetype?: string;
  /** In hundredths of a millimeter, or -3 for the default. */
  readonly lineweight?: number;
  readonly on: boolean;
  readonly frozen: boolean;
  readonly locked: boolean;
  readonly plot: boolean;
  /** True for a layer of an xref, named `XREF|LAYER`. */
  readonly xref: boolean;
}

export interface ReadLinetype {
  readonly handle?: string | undefined;
  readonly name: string;
  readonly description?: string;
  /** Each element's length: a dash when positive, a gap when negative, a dot when 0. */
  readonly pattern: readonly number[];
  /** True when an element holds a text or a shape. */
  readonly complex: boolean;
}

export interface ReadTextStyle {
  readonly handle?: string | undefined;
  readonly name: string;
  /** The font file, such as `arial.ttf` or `romans.shx`. */
  readonly font?: string;
  readonly bigFont?: string;
  /** The TrueType family the style names, when it names one. */
  readonly family?: string;
  /** The height every text of the style takes, or 0 when each sets its own. */
  readonly height?: number;
  readonly widthFactor?: number;
  /** Degrees. */
  readonly oblique?: number;
  readonly annotative: boolean;
  /** True for a style that holds a shape file and no font. */
  readonly shapes: boolean;
}

export interface ReadDimensionStyle {
  readonly handle?: string | undefined;
  readonly name: string;
  readonly annotative: boolean;
  /** `DIMSCALE`, the overall scale. */
  readonly scale?: number;
  /** `DIMTXT`, the height of its text before the overall scale. */
  readonly textHeight?: number;
  /** `DIMASZ`. */
  readonly arrowSize?: number;
  /** The text style `DIMTXSTY` names. */
  readonly textStyle?: string;
  /**
   * `DIMLUNIT`, the units it writes lengths in: 1 scientific, 2 decimal, 3 engineering, 4
   * architectural, 5 fractional, 6 the system's.
   */
  readonly lengthUnits?: number;
  /** `DIMDEC`. */
  readonly precision?: number;
  /** `DIMLFAC`, which multiplies every length it writes. */
  readonly lengthFactor?: number;
  /** `DIMPOST`. */
  readonly suffix?: string;
  /** `DIMTAD`: 0 centers the text in a break of the dimension line, 1 puts it above. */
  readonly textVertical?: number;
  /** `DIMTIX`: 1 keeps the text between the extension lines whatever fits. */
  readonly textInside?: number;
  /** `DIMTMOVE`: 1 hangs a text that does not fit on a leader. */
  readonly textMove?: number;
  /** `DIMFRAC`: 0 stacks a fraction across a bar, 1 diagonally, and 2 writes it on the line. */
  readonly fraction?: number;
  /** `DIMTFAC`: the height of a stacked fraction as a share of the text's. */
  readonly fractionScale?: number;
  /** `DIMLWD`, the dimension line's lineweight as group 370 holds one: -2 ByBlock. */
  readonly dimensionLineweight?: number;
  /** `DIMLWE`, the extension lines' lineweight, likewise. */
  readonly extensionLineweight?: number;
  /** The block `DIMBLK` draws each arrowhead with, such as `_ArchTick`. Missing for closed filled. */
  readonly arrowheadBlock?: string;
  /** `DIMTFILL`: 0 no mask behind the text, 1 one in the drawing's background, 2 one in `textFillColor`. */
  readonly textFill?: number;
  /** `DIMTFILLCLR`, the color index of the mask, for a `textFill` of 2. */
  readonly textFillColor?: number;
}

/** An attribute definition of a block, placed as a text is. */
export interface ReadAttributeDefinition extends ReadTextPlacement {
  readonly handle?: string | undefined;
  readonly tag: string;
  readonly prompt?: string;
  /** Of one of paragraph text, its paragraph's value, with its codes. */
  readonly default?: string;
  readonly layer: string;
  readonly invisible: boolean;
  readonly constant: boolean;
  /** The paragraph of a definition of paragraph text, which the leading CAD app draws. */
  readonly paragraph?: ReadAttributeParagraph;
}

/**
 * The paragraph text an attribute or a definition of more than one line holds, which the leading
 * CAD app draws in the place of its text: an MTEXT of its own, whose value is the attribute's.
 */
export interface ReadAttributeParagraph {
  /** The point of its box that `attachment` names, in the world's coordinates. */
  readonly at: Point;
  /** The height its text starts at. */
  readonly height: number;
  /** The width it wraps at, or 0 when it does not wrap. */
  readonly width: number;
  /** 1 top left, 2 top center, 3 top right, 4 to 6 the middle, 7 to 9 the bottom. */
  readonly attachment: number;
  /** The direction of its lines, in degrees counterclockwise. */
  readonly rotation: number;
  /** Its text style, `Standard` when the file names none. */
  readonly style: string;
  /** The factor of its line spacing, 1 when the file states none. */
  readonly lineSpacing: number;
  readonly lineSpacingStyle: "at-least" | "exactly";
  /**
   * True when it is seen from below, as an insert that mirrors its block holds it: its lines run
   * along `rotation` with their tops to its right.
   */
  readonly mirrored?: boolean;
}

/**
 * What every entity keeps: its handle, its layer, and the pen it sets for itself. Each part of
 * the pen is left out when it is the default, ByLayer.
 */
export interface ReadEntityBase {
  readonly handle?: string | undefined;
  readonly layer: string;
  /** Group 62: a color index from 1 to 255, or 0 for ByBlock. */
  readonly color?: number;
  /** Group 420: a true color as 0xRRGGBB. */
  readonly trueColor?: number;
  /** Group 6: a linetype's name, or `ByBlock`. */
  readonly linetype?: string;
  /** Group 370: hundredths of a millimeter, or -2 for ByBlock and -3 for the default. */
  readonly lineweight?: number;
  /** Group 48: the entity's own linetype scale. Left out at 1. */
  readonly linetypeScale?: number;
}

/**
 * Where a text, an attribute or an attribute definition is, and how it is justified, in the
 * world's coordinates.
 */
export interface ReadTextPlacement {
  /** Where the leading CAD app starts to draw the text: the left end of its baseline. */
  readonly at: Point;
  /**
   * Where `at` comes from: `file`, the point the file stores; `widths`, worked out from
   * `alignAt` with tsdraft's widths of the font's characters, for a justified text whose file
   * stores its alignment point as its start; and `alignment`, `alignAt` itself, for such a text
   * whose start the widths do not give.
   */
  readonly startFrom: "file" | "widths" | "alignment";
  /** The first point as the file stores it. */
  readonly stored: Point;
  /** The point a justified text is justified to. Missing for a text on the left of its baseline. */
  readonly alignAt?: Point;
  readonly height: number;
  /** Degrees counterclockwise. */
  readonly rotation: number;
  /** Its text style, `Standard` when the file names none. */
  readonly style: string;
  /**
   * Where `alignAt` is along its line, as a `Text` has it, or `aligned` and `fit`, which fit the
   * text between its two points, and `middle`, which centers it both ways. Left out for `left`.
   */
  readonly align?: "center" | "right" | "aligned" | "middle" | "fit";
  /** Where `alignAt` is up and down its line, as a `Text` has it. Left out for `baseline`. */
  readonly valign?: "bottom" | "middle" | "top";
  /** Left out at 1. */
  readonly widthFactor?: number;
  /** Degrees to the right. Left out at 0. */
  readonly oblique?: number;
  /** True when it is drawn mirrored along its baseline, reading backward. */
  readonly backward?: boolean;
  /** True when it is drawn mirrored across its baseline. */
  readonly upsideDown?: boolean;
}

export interface ReadLine extends ReadEntityBase {
  readonly kind: "line";
  readonly from: Point;
  readonly to: Point;
}

/**
 * A polyline in its plane: a lightweight one, or a 2D one with its vertices. Its sides are
 * straight or arcs, and may be wide, as a `Polyline`'s are.
 */
export interface ReadPolyline extends ReadEntityBase {
  readonly kind: "polyline";
  readonly points: readonly Point[];
  readonly closed: boolean;
  /**
   * The bulge of each side, one for each, as a `Polyline` holds them, in the world's coordinates:
   * greater than 0 for an arc that turns counterclockwise. Left out when every side is straight.
   */
  readonly bulges?: readonly number[];
  /** The width of every side. Left out at 0, and when the file gives each side its own. */
  readonly width?: number;
  /** The width at the start and the end of each side, one pair for each. Left out when none is not 0. */
  readonly widths?: readonly (readonly [start: number, end: number])[];
}

export interface ReadCircle extends ReadEntityBase {
  readonly kind: "circle";
  readonly center: Point;
  readonly radius: number;
}

export interface ReadArc extends ReadEntityBase {
  readonly kind: "arc";
  readonly center: Point;
  readonly radius: number;
  /** Degrees counterclockwise. */
  readonly start: number;
  readonly end: number;
}

/** A text of one line. */
export interface ReadText extends ReadEntityBase, ReadTextPlacement {
  readonly kind: "text";
  /** As the leading CAD app holds it, with `%%d` and the other codes as they are written. */
  readonly value: string;
}

/** An attribute of an insert, where the file places it. */
export interface ReadAttribute extends ReadEntityBase, ReadTextPlacement {
  readonly tag: string;
  /** Of one of paragraph text, its paragraph's value, with its codes. */
  readonly value: string;
  /** True for an attribute that does not show. */
  readonly invisible?: boolean;
  /** The paragraph of an attribute of paragraph text, which the leading CAD app draws. */
  readonly paragraph?: ReadAttributeParagraph;
}

export interface ReadInsert extends ReadEntityBase {
  readonly kind: "insert";
  readonly block: string;
  /** The handle of the block's record. */
  readonly blockHandle?: string;
  readonly at: Point;
  readonly scale: readonly [x: number, y: number];
  readonly rotation: number;
  /** Whether the insert sets each attribute, by its tag: true when its value is not empty. */
  readonly tags: Readonly<Record<string, boolean>>;
  /** Each attribute, in the order of the file, when the read asked for geometry. */
  readonly attributes?: readonly ReadAttribute[];
}

/**
 * A paragraph text. Its value keeps its formatting codes, such as `\P` between paragraphs, and
 * `layoutMtext` lays it out.
 */
export interface ReadMtext extends ReadEntityBase {
  readonly kind: "mtext";
  /** The point of its box that `attachment` names. */
  readonly at: Point;
  /** The height its text starts at. */
  readonly height: number;
  /** The width it wraps at, or 0 when it does not wrap. */
  readonly width: number;
  /** 1 top left, 2 top center, 3 top right, 4 to 6 the middle, 7 to 9 the bottom. */
  readonly attachment: number;
  /** Degrees counterclockwise. */
  readonly rotation: number;
  /** Its text style, `Standard` when the file names none. */
  readonly style: string;
  /** As the leading CAD app holds it. */
  readonly value: string;
  /** The factor of its line spacing, 1 when the file states none. */
  readonly lineSpacing: number;
  /** How its line spacing is taken: as the least, or exactly. */
  readonly lineSpacingStyle: "at-least" | "exactly";
  /**
   * Its columns, each `width` wide, as a paragraph's: a count for static ones, none for dynamic
   * ones, and heights for dynamic ones of a height each, up to the first of 0.
   */
  readonly columns?: ParagraphColumns;
  /**
   * The mask behind it, over its box grown by `offsetFactor` times its height less one: in the
   * drawing's background where `color` and `trueColor` are left out, or in a color of its own.
   */
  readonly mask?: ReadMask;
}

/** A text's background mask, as an MTEXT holds it. */
export interface ReadMask {
  /** Group 63: a color index, when the mask is not in the drawing's background. */
  readonly color?: number;
  /** Group 421: a true color as 0xRRGGBB, when it is not in the background. */
  readonly trueColor?: number;
  /** Group 45. */
  readonly offsetFactor: number;
}

/**
 * A dimension's text as a file holds it, cut at its first `\\X` into what it draws over its line
 * and below it. A text of `<>` alone over the line is the measurement, and is left out.
 */
export function dimensionTextParts(held: string): {
  readonly text?: string;
  readonly textBelow?: string;
} {
  const at = held.indexOf("\\X");
  if (at < 0) return held === "" ? {} : { text: held };
  const text = held.slice(0, at);
  return { ...(text !== "<>" && { text }), textBelow: held.slice(at + 2) };
}

/** A linear or an aligned dimension. */
export interface ReadDimension extends ReadEntityBase {
  readonly kind: "dimension";
  /** `linear`, which measures along `angle`, or `aligned`, which measures along its points. */
  readonly type: "linear" | "aligned";
  /** The two points it measures between, which its extension lines start at. */
  readonly from: Point;
  readonly to: Point;
  /** The point where its dimension line meets its second extension line. */
  readonly line: Point;
  /** Degrees: the direction a linear dimension measures along. Left out at 0. */
  readonly angle?: number;
  /** The middle of its text. */
  readonly textAt: Point;
  /**
   * What it measures, as the file states it: 1 where a file after R12 leaves it out, as the leading
   * CAD app does for 1, and -1 where that app has not worked it out. Missing from an R12 file.
   */
  readonly measurement?: number;
  /** The text it draws in place of its measurement, where `<>` stands for it. */
  readonly text?: string;
  /** The words it draws below its line, which the file holds after `\\X` in its text. */
  readonly textBelow?: string;
  /** Its dimension style, `Standard` when the file names none. */
  readonly style: string;
  /** The block of its picture, `*D` and a number, when it has one. */
  readonly block?: string;
  /** The handle of that block's record. */
  readonly blockHandle?: string;
}

/** A radius, a diameter or a jogged radius dimension. */
export interface ReadRadialDimension extends ReadEntityBase {
  readonly kind: "radial-dimension";
  readonly type: "radius" | "diameter" | "jogged-radius";
  /** The center of the circle or arc it measures. */
  readonly center: Point;
  /** The point of the circle or arc its line meets. */
  readonly point: Point;
  /** A jogged radius dimension's: where its line starts, and the middle of its jog. */
  readonly start?: Point;
  readonly jog?: Point;
  /** The middle of its text. */
  readonly textAt: Point;
  /** True where the file holds its text where it was placed, not where the leading CAD app puts it. */
  readonly placed?: boolean;
  /** What it measures, as the file states it, as `ReadDimension`'s. */
  readonly measurement?: number;
  readonly text?: string;
  readonly textBelow?: string;
  readonly style: string;
  readonly block?: string;
  readonly blockHandle?: string;
}

/**
 * An angular dimension: by three points, its vertex and a point of each line, or by two lines,
 * each by two points, which need not meet.
 */
export interface ReadAngularDimension extends ReadEntityBase {
  readonly kind: "angular-dimension";
  readonly type: "three-point" | "two-line";
  /** By three points: where the lines meet, and a point of each. */
  readonly vertex?: Point;
  readonly from?: Point;
  readonly to?: Point;
  /** By two lines: each line, by two of its points. */
  readonly first?: readonly [Point, Point];
  readonly second?: readonly [Point, Point];
  /** A point its arc passes through. */
  readonly at: Point;
  /** The middle of its text. */
  readonly textAt: Point;
  /** True where the file holds its text where it was placed, not where the leading CAD app puts it. */
  readonly placed?: boolean;
  /** The angle it measures, in degrees, as the file states it; -1 where the file says -1. */
  readonly measurement?: number;
  readonly text?: string;
  readonly textBelow?: string;
  readonly style: string;
  readonly block?: string;
  readonly blockHandle?: string;
}

/**
 * An arc length dimension: the length of the arc about `center` of `radius` from `startAngle` to
 * `endAngle`, counterclockwise in degrees, as the file holds the arc.
 */
export interface ReadArcLengthDimension extends ReadEntityBase {
  readonly kind: "arc-length-dimension";
  readonly center: Point;
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
  /** A point its own arc passes through. */
  readonly at: Point;
  /** The middle of its text. */
  readonly textAt: Point;
  /** True where the file holds its text where it was placed, not where the leading CAD app puts it. */
  readonly placed?: boolean;
  /** True where it measures part of the arc, from points of its own. */
  readonly partial?: boolean;
  /** What it measures, as the file states it, as `ReadDimension`'s. */
  readonly measurement?: number;
  readonly text?: string;
  readonly textBelow?: string;
  readonly style: string;
  readonly block?: string;
  readonly blockHandle?: string;
}

/** One root of a multileader: where some of its shafts meet, and the landing from there. */
export interface ReadLeaderRoot {
  /** Where its shafts meet and its landing starts. */
  readonly at: Point;
  /** The way its landing runs from `at`, one unit long. */
  readonly direction: Point;
  /** How long its landing is. */
  readonly landing: number;
  /** Each shaft: its tip, then each point it bends at on its way to `at`. */
  readonly shafts: readonly (readonly Point[])[];
}

/**
 * A multileader: a note or a block, with shafts from one root, or from two on either side of it.
 * `shafts`, `at`, `direction` and `landing` are its first root's, and for one with no root none,
 * `textAt` and no landing.
 */
export interface ReadMultileader extends ReadEntityBase {
  readonly kind: "multileader";
  /** Its leader style, when the file's dictionary of leader styles names it. */
  readonly style?: string;
  /** Each shaft of its first root: its tip, then each point it bends at on its way to `at`. */
  readonly shafts: readonly (readonly Point[])[];
  /** Where its first root's shafts meet and its landing starts. */
  readonly at: Point;
  /** The way the first root's landing runs from `at`, one unit long. */
  readonly direction: Point;
  /** How long the first root's landing is. */
  readonly landing: number;
  /** Each root, the first among them, in the order of the file. */
  readonly roots: readonly ReadLeaderRoot[];
  /** How its shafts are drawn: straight, as a curve through their points, or not at all. */
  readonly shaft: "straight" | "curved" | "none";
  /** Its note as the leading CAD app holds it, with `\P` between lines, or `""` for a block. */
  readonly text: string;
  /** The point of the note's box that `textAttachment` names, or a block's `at`. */
  readonly textAt: Point;
  /** Where `textAt` is on the note's box: 1 top left, 2 top center, 3 top right, as an MTEXT's. */
  readonly textAttachment: number;
  /** The width the note wraps at, or 0 when it does not wrap. */
  readonly width: number;
  /** The height of the note's text. */
  readonly textHeight: number;
  /** The note's text style. */
  readonly textStyle: string;
  /** The length of an arrowhead. */
  readonly arrowSize: number;
  /**
   * Where a landing meets the note, by the side of the note it meets: 0 to 8 at its left or right,
   * from the top of its first line to an underline of every line, and 9, at the middle, or 10,
   * with a line as wide as the note, at its top or bottom.
   */
  readonly attachments: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
  /** True when its landings meet the note at its top or bottom, not its sides. */
  readonly vertical?: true;
  /** True for a frame around the note. */
  readonly frame?: true;
  /**
   * The mask behind the note: the drawing's background, or a color index, over the note's box
   * grown by `offsetFactor` times its text height less one.
   */
  readonly mask?: { readonly offsetFactor: number; readonly color?: number };
  /** The block that is its content in place of a note, where it is placed, and its tags' values. */
  readonly block?: {
    readonly name: string;
    readonly at: Point;
    readonly scale: number;
    /** Degrees counterclockwise. */
    readonly rotation: number;
    readonly attributes?: Readonly<Record<string, string>>;
  };
}

/** The old leader: a line of points from its arrowhead, its note an entity of its own. */
export interface ReadLeader extends ReadEntityBase {
  readonly kind: "leader";
  /** Its dimension style, whose sizes it is drawn with. */
  readonly style: string;
  /** Its points from its tip. */
  readonly points: readonly Point[];
  /** How it runs through its points: straight, or as a curve. */
  readonly shaft: "straight" | "curved";
  /** True when it draws an arrowhead at its tip. */
  readonly arrowhead: boolean;
  /** The handle of its note, an `MTEXT`, a tolerance or an insert, when it has one. */
  readonly note?: string;
}

/** A filled outline of three or four corners, as a dimension draws an arrowhead. */
export interface ReadSolid extends ReadEntityBase {
  readonly kind: "solid";
  /** Its corners in the order of its outline. Its last two are one point for a triangle. */
  readonly points: readonly Point[];
}

/**
 * A raster image, as the file places it: its lower-left corner and the vectors of one of its
 * pixels along its bottom and up its side, which a mirrored or slanted image has too.
 */
export interface ReadImage extends ReadEntityBase {
  readonly kind: "image";
  /** The path of its definition as the file holds it, or `""` when it names none. */
  readonly path: string;
  /** The handle of its definition, when it names one. */
  readonly definition?: string;
  /** The pixels the image states, group 13. */
  readonly pixels: readonly [width: number, height: number];
  readonly at: Point;
  /** The vector of one pixel along the image's bottom edge, and up its side. */
  readonly u: Point;
  readonly v: Point;
  /**
   * The clip's boundary, in the world's coordinates: two opposite corners of a rectangle along the
   * image's sides, or a polygon, without its first point again at its end. Left out when the file
   * holds the whole image's boundary with the clip off and not inverted, as the leading CAD app
   * saves an image it does not clip; `unclipped` says when the image is shown whole anyway.
   */
  readonly clip?: readonly Point[];
  /** True when the image shows outside its clip, and the clip is a hole. */
  readonly invertClip?: boolean;
  /** True when the transparent pixels of a PNG show what is behind. */
  readonly transparent?: boolean;
  /** True when the file says not to show the image, which then shows its frame alone. */
  readonly hidden?: boolean;
  /**
   * True when the file says not to clip the image, so it all shows, whatever `clip` says. Its
   * frame still follows `clip`.
   */
  readonly unclipped?: boolean;
  /** Group 281, from 0 to 100. Left out at 50. */
  readonly brightness?: number;
  /** Group 282, from 0 to 100. Left out at 50. */
  readonly contrast?: number;
  /** Group 283, from 0 to 100. Left out at 0. */
  readonly fade?: number;
}

/** A loop of a hatch, as a closed polyline holds its points and the bulge of each side. */
export interface ReadHatchLoop {
  readonly points: readonly Point[];
  /** Left out when every side is straight. */
  readonly bulges?: readonly number[];
  /**
   * Group 92, as the file holds it: 1 external, 2 a polyline, 4 derived from what it bounds, 8 a
   * text's box, 16 outermost.
   */
  readonly flags: number;
}

/**
 * A hatch: its loops, its pattern and how it takes islands. The leading CAD app fills one of style
 * `normal` by the parity of all its loops around a point; one of style `outer` by the parity of
 * its loops marked external or outermost alone, and one of style `ignore` by its external ones.
 */
export interface ReadHatch extends ReadEntityBase {
  readonly kind: "hatch";
  /** Group 2, such as `SOLID` or `ANSI31`. */
  readonly pattern: string;
  /** True for a solid fill, group 70. */
  readonly solid: boolean;
  /** Group 75. */
  readonly style: "normal" | "outer" | "ignore";
  /** True when the file ties it to the entities it bounds, group 71. */
  readonly associative?: true;
  /**
   * Its loops, in the order of the file, each a polyline or a loop of lines and arcs read as one.
   * A hatch with a loop of an ellipse or a spline is counted instead.
   */
  readonly loops: readonly ReadHatchLoop[];
  /** Group 76 of one that is not solid: 0 user-defined lines, 1 a pattern the app ships, 2 a pattern of a file. */
  readonly patternType?: number;
  /** Group 52: the pattern's angle, in degrees, as the file holds it: not mirrored for a hatch seen from below, though its lines are. */
  readonly patternAngle?: number;
  /** Group 41: the pattern's scale, or the user-defined lines' spacing. */
  readonly patternScale?: number;
  /** Group 77: true for user-defined lines crossed by as many more. */
  readonly crossed?: true;
  /**
   * The lines its pattern draws, as the file holds them: in the world's coordinates, each angle
   * with the pattern's added, its base point placed and its offset turned to the line, its dashes
   * scaled. A firm's patterns can be read back from its drawings this way.
   */
  readonly patternLines?: readonly ReadPatternLine[];
  /** Its gradient, groups 450 to 470. Left out when group 450 is 0. */
  readonly gradient?: ReadGradient;
}

/** A hatch's gradient, as the file holds it. */
export interface ReadGradient {
  /** Group 470, such as `LINEAR`, a name tsdraft does not know included. */
  readonly name: string;
  /** Group 460, in degrees counterclockwise. */
  readonly angle: number;
  /** True when group 461 is 0. */
  readonly centered: boolean;
  /**
   * Group 421 of its first two colors, each `0xRRGGBB`. The leading CAD app plots the first two
   * whatever the count, and from blue to white with fewer.
   */
  readonly colors: readonly number[];
  /** Group 462, as single precision holds it, where group 452 says one color and its tint. */
  readonly tint?: number;
}

/**
 * A gradient's angle in degrees, with 12 significant digits, from its radians: a DXF holds them as
 * written, and a DWG as the leading CAD app parsed them, which can differ in the last bit.
 */
export const gradientDegrees = (radians: number): number =>
  Number((radians * (180 / Math.PI)).toPrecision(12));

/** A line of a hatch's pattern, as `ReadHatch.patternLines` holds it. */
export interface ReadPatternLine {
  readonly angle: number;
  readonly base: Point;
  readonly offset: Point;
  /** Left out for a solid line. */
  readonly dashes?: readonly number[];
}

/** A wipeout: its polygon in the world's coordinates, without its first point again at its end. */
export interface ReadWipeout extends ReadEntityBase {
  readonly kind: "wipeout";
  readonly points: readonly Point[];
}

/**
 * An ellipse, or an arc of one, as `Ellipse` holds it: in the world's coordinates, with its
 * parameters in degrees counterclockwise. One the file holds seen from below, which runs its
 * parameters clockwise, is read as the ellipse it draws seen from above.
 */
export interface ReadEllipse extends ReadEntityBase {
  readonly kind: "ellipse";
  readonly center: Point;
  readonly majorAxis: Point;
  readonly ratio: number;
  /** For an arc, from 0 up to 360. Left out, with `endParameter`, for a whole ellipse. */
  readonly startParameter?: number;
  readonly endParameter?: number;
}

/**
 * A spline as the file holds it: its B-spline, and the fit points and what the fit took where the
 * file holds them. A spline through fit points that the file closes by repeating its first fit
 * point is `closed`, and its fit points leave the repeat out.
 */
export interface ReadSpline extends ReadEntityBase {
  readonly kind: "spline";
  readonly degree: number;
  readonly knots: readonly number[];
  /** In the world's coordinates, as the file holds them. None for one held by fit points alone. */
  readonly controlPoints: readonly Point[];
  /** One for each control point, for a rational spline. */
  readonly weights?: readonly number[];
  /** Group 70's closed bit, or for fit points, a first point repeated at the end. */
  readonly closed: boolean;
  /** Group 70's periodic bit, where it is set. */
  readonly periodic?: true;
  readonly fitPoints?: readonly Point[];
  readonly startTangent?: Point;
  readonly endTangent?: Point;
  readonly fitTolerance?: number;
  /** How the knots of a fit are spaced, where the file says. */
  readonly knotSpacing?: KnotSpacing;
}

/** What a space or a block draws, of the kinds the writers write. */
export type ReadEntity =
  | ReadLine
  | ReadPolyline
  | ReadCircle
  | ReadArc
  | ReadEllipse
  | ReadSpline
  | ReadText
  | ReadInsert
  | ReadMtext
  | ReadDimension
  | ReadRadialDimension
  | ReadAngularDimension
  | ReadArcLengthDimension
  | ReadMultileader
  | ReadLeader
  | ReadSolid
  | ReadImage
  | ReadHatch
  | ReadWipeout;

export interface ReadBlock {
  /** The handle of the block's record, which an insert's block record points to. */
  readonly handle?: string | undefined;
  readonly name: string;
  readonly base: Point;
  /** True for a block the leading CAD app names itself, such as a dynamic block's state, `*U12`. */
  readonly anonymous: boolean;
  readonly attributeDefinitions: readonly ReadAttributeDefinition[];
  /** What it draws of the kinds `ReadEntity` holds, in the order of the file. */
  readonly entities: readonly ReadEntity[];
  /** The order the leading CAD app draws them in, as `ReadSpace.drawOrder` says. */
  readonly drawOrder?: readonly string[];
  /**
   * What else it draws, counted by kind, such as `HATCH` or a polyline with an arc, and under
   * `past the limit` what it holds past `BLOCK_ITEMS`.
   */
  readonly other: Readonly<Record<string, number>>;
}

export interface ReadXref {
  /** The handle of the xref's block record. */
  readonly handle?: string | undefined;
  readonly name: string;
  /** The path as the file holds it, relative or absolute. */
  readonly path: string;
  readonly overlay: boolean;
}

/** An image definition: the file an image shows. */
export interface ReadImageDefinition {
  readonly handle?: string | undefined;
  /** Its name in the dictionary of image definitions. */
  readonly name: string;
  /** The path as the file holds it, relative or absolute. */
  readonly path: string;
  /** The pixels it states the file has. */
  readonly pixels: readonly [width: number, height: number];
  /** False when the file marks it not loaded, which the leading CAD app draws as a frame alone. */
  readonly loaded: boolean;
  /** How many images of the file name it. */
  readonly images: number;
}

export interface ReadViewport {
  readonly handle?: string | undefined;
  readonly layer: string;
  /** The center of its rectangle on the paper. */
  readonly center: Point;
  readonly width: number;
  readonly height: number;
  /** The point of model space at its center. */
  readonly viewCenter: Point;
  /** How tall a piece of model space it shows. */
  readonly viewHeight: number;
  /** Paper units per model unit: `height / viewHeight`. 0 when the view has no height. */
  readonly ratio: number;
  /** Degrees the view is turned. */
  readonly twist: number;
  /** False when the viewport is off. */
  readonly on: boolean;
  /** The layers frozen in this viewport alone, by name. */
  readonly frozenLayers: readonly string[];
  /** True when the view looks along another direction than straight down. */
  readonly turnedView: boolean;
}

export interface ReadLayout {
  readonly handle?: string | undefined;
  readonly name: string;
  readonly tab: number;
  /** The paper's name as the plotter gives it, such as `ARCH_D_(36.00_x_24.00_Inches)`. */
  readonly media?: string;
  /** The plotter's configuration, such as `DWG To PDF.pc3`. */
  readonly plotter?: string;
  /** The paper's size in millimeters, as the file states it. */
  readonly paperSize?: readonly [width: number, height: number];
  /** 0 inches, 1 millimeters, 2 pixels. */
  readonly paperUnits?: number;
  /** The plot style table, such as `monochrome.ctb`. */
  readonly plotStyleTable?: string;
  /** Quarter turns of the plot: 0 to 3. */
  readonly plotRotation: number;
  /** Each viewport but the one that is the layout's own view of its paper. */
  readonly viewports: readonly ReadViewport[];
  /**
   * Its inserts of blocks and of xrefs, up to `CENSUS_LIMIT`, as its census lists them, without
   * their attributes.
   */
  readonly inserts: readonly ReadInsert[];
  readonly census: ReadCensus;
  /** With `geometry`, what it draws on its paper, as model space's are. Its viewports are above. */
  readonly entities?: readonly ReadEntity[];
  /** With `geometry`, the order the leading CAD app draws them in, as `ReadSpace.drawOrder` says. */
  readonly drawOrder?: readonly string[];
  readonly other?: Readonly<Record<string, number>>;
}

/** Model space. */
export interface ReadSpace {
  readonly census: ReadCensus;
  /** With `geometry`, what it draws, in the order of the file. */
  readonly entities?: readonly ReadEntity[];
  /**
   * With `geometry`, and when the file holds a sort table for the space, the handles of
   * `entities` in the order the leading CAD app draws them: by each one's sort handle, its own
   * handle where the table gives none. Without a table it draws them in the order of the file.
   */
  readonly drawOrder?: readonly string[];
  /**
   * With `geometry`, what it draws that `entities` leaves out, counted by kind: a kind it does not
   * read, such as `HATCH`, one in another plane, such as `CIRCLE in 3D`, and under `past the
   * limit` what came past `GEOMETRY_ITEMS`.
   */
  readonly other?: Readonly<Record<string, number>>;
}

/** A field of an `MTEXT`, with the code the learner maps. */
export interface ReadField {
  /** The `FIELD` object's handle. */
  readonly handle?: string | undefined;
  /**
   * The field's code, such as `\AcVar Filename \f "%fn2"`, `\AcVar ctab`, `\AcVar Date` or a
   * DIESEL expression that reads `CTAB`.
   */
  readonly code: string;
  /** The `MTEXT` that shows it. */
  readonly text: {
    readonly handle?: string | undefined;
    readonly at: Point;
    readonly height: number;
    readonly width: number;
    readonly layer: string;
    /** The layout it is on, `undefined` for model space and `block` for a block. */
    readonly layout?: string;
    readonly block?: string;
  };
}

/** What a space draws, counted, and the texts, dimensions and inserts it holds. */
export interface ReadCensus {
  /** Counts by layer. */
  readonly layers: Readonly<Record<string, ReadLayerCensus>>;
  readonly texts: readonly ReadCensusText[];
  readonly dimensions: readonly ReadCensusDimension[];
  readonly inserts: readonly ReadCensusInsert[];
  /** How many of each there are, kept or not. */
  readonly counts: {
    readonly texts: number;
    readonly dimensions: number;
    readonly inserts: number;
  };
  /**
   * True when a list stopped at `CENSUS_LIMIT` items and holds fewer than its count, the list of
   * a layout's viewports and of its inserts among them. The counts by layer are whole.
   */
  readonly capped: boolean;
}

export interface ReadLayerCensus {
  /** Entities by their DXF kind, such as `LINE` or `HATCH`. */
  readonly kinds: Readonly<Record<string, number>>;
  /** Entities that set their own color, linetype or lineweight. */
  readonly ownColor: number;
  readonly ownLinetype: number;
  readonly ownLineweight: number;
  /** The lineweights entities set, in hundredths of a millimeter, with how many set each. */
  readonly lineweights: Readonly<Record<string, number>>;
}

export interface ReadCensusText {
  readonly handle?: string | undefined;
  readonly kind: "TEXT" | "MTEXT";
  readonly layer: string;
  readonly style: string;
  readonly at: Point;
  readonly height: number;
  /** The heights an `MTEXT` sets inside its text with `\H`, worked out to drawing units. */
  readonly inlineHeights?: readonly number[];
}

export interface ReadCensusDimension {
  readonly handle?: string | undefined;
  readonly layer: string;
  readonly style: string;
  /** Where its text is. */
  readonly at: Point;
  /** True when it overrides a setting of its style. */
  readonly overrides: boolean;
}

export interface ReadCensusInsert {
  readonly handle?: string | undefined;
  readonly layer: string;
  readonly block: string;
  readonly at: Point;
  readonly scale: readonly [x: number, y: number];
}

/** What the reader did not understand. */
export interface ReadUnread {
  /** Entities of a kind the reader has no reading of, such as `OLE2FRAME` or `AEC_WALL`. */
  readonly entities: Readonly<Record<string, number>>;
  /** Objects of a kind the reader has no reading of, such as `ACAD_PROXY_OBJECT`. */
  readonly objects: Readonly<Record<string, number>>;
  /** Records the reader could not place, such as an entity outside any section, by kind. */
  readonly malformed: Readonly<Record<string, number>>;
}

/** The most texts, dimensions or inserts a census lists for one space. */
export const CENSUS_LIMIT = 200_000;

/**
 * The most items the definitions of a file's blocks keep in all: an entity is one, and each of
 * its points, each attribute and tag and each 32 characters of its names and its text one more.
 */
export const BLOCK_ITEMS = 400_000;

/** The most items, counted as `BLOCK_ITEMS` counts them, that what the spaces draw keeps in all. */
export const GEOMETRY_ITEMS = 400_000;

/**
 * What a package that reads drawing files exports from the module its `package.json` names
 * under `"tsdraft": { "readers": { ".dwg": "./dist/read.js" } }`. It takes the file's bytes as
 * they arrive, its name without folders, and what to read, as `readDXF` takes it.
 */
export type ReadDrawingFile = (
  chunks: AsyncIterable<Uint8Array>,
  name: string,
  options?: ReadOptions,
) => Promise<DrawingRead>;
