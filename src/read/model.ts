// The read model: what a reader of a drawing file gives. It is not a `Drawing`. It holds what a
// drawing file states about its tables, its blocks, its xrefs and its layouts, a census of what
// each space draws and, for a read that asks for it, what each space draws, and is never
// written back.
import type { Point } from "../drawing.ts";

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
}

/** An attribute definition of a block, placed as a text is. */
export interface ReadAttributeDefinition extends ReadTextPlacement {
  readonly handle?: string | undefined;
  readonly tag: string;
  readonly prompt?: string;
  readonly default?: string;
  readonly layer: string;
  readonly invisible: boolean;
  readonly constant: boolean;
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
  /** Where AutoCAD starts to draw the text: the left end of its baseline. */
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

/** A polyline of straight segments. */
export interface ReadPolyline extends ReadEntityBase {
  readonly kind: "polyline";
  readonly points: readonly Point[];
  readonly closed: boolean;
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
  /** As AutoCAD holds it, with `%%d` and the other codes as they are written. */
  readonly value: string;
}

/** An attribute of an insert, where the file places it. */
export interface ReadAttribute extends ReadEntityBase, ReadTextPlacement {
  readonly tag: string;
  readonly value: string;
  /** True for an attribute that does not show. */
  readonly invisible?: boolean;
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
 * it is not laid out.
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
  /** As AutoCAD holds it. */
  readonly value: string;
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
   * What it measures, as the file states it: 1 where a file after R12 leaves it out, as AutoCAD
   * does for 1, and -1 where AutoCAD has not worked it out. Missing from an R12 file.
   */
  readonly measurement?: number;
  /** The text it draws in place of its measurement, where `<>` stands for it. */
  readonly text?: string;
  /** Its dimension style, `Standard` when the file names none. */
  readonly style: string;
  /** The block of its picture, `*D` and a number, when it has one. */
  readonly block?: string;
  /** The handle of that block's record. */
  readonly blockHandle?: string;
}

/** A multileader with one note and straight shafts that meet at one landing. */
export interface ReadMultileader extends ReadEntityBase {
  readonly kind: "multileader";
  /** Its leader style, when the file's dictionary of leader styles names it. */
  readonly style?: string;
  /** Each shaft: its tip, then each point it bends at on its way to `at`. */
  readonly shafts: readonly (readonly Point[])[];
  /** Where the shafts meet and the landing starts. */
  readonly at: Point;
  /** The way the landing runs from `at`, one unit long. */
  readonly direction: Point;
  /** How long the landing is. */
  readonly landing: number;
  /** Its note as AutoCAD holds it, with `\P` between lines. */
  readonly text: string;
  /** The corner of the note's box that holds it. */
  readonly textAt: Point;
  /** The height of the note's text. */
  readonly textHeight: number;
  /** The note's text style. */
  readonly textStyle: string;
  /** The length of an arrowhead. */
  readonly arrowSize: number;
}

/** A filled outline of three or four corners, as a dimension draws an arrowhead. */
export interface ReadSolid extends ReadEntityBase {
  readonly kind: "solid";
  /** Its corners in the order of its outline. Its last two are one point for a triangle. */
  readonly points: readonly Point[];
}

/** What a space or a block draws, of the kinds the writers write. */
export type ReadEntity =
  | ReadLine
  | ReadPolyline
  | ReadCircle
  | ReadArc
  | ReadText
  | ReadInsert
  | ReadMtext
  | ReadDimension
  | ReadMultileader
  | ReadSolid;

export interface ReadBlock {
  /** The handle of the block's record, which an insert's block record points to. */
  readonly handle?: string | undefined;
  readonly name: string;
  readonly base: Point;
  /** True for a block AutoCAD names itself, such as a dynamic block's state, `*U12`. */
  readonly anonymous: boolean;
  readonly attributeDefinitions: readonly ReadAttributeDefinition[];
  /** What it draws of the kinds `ReadEntity` holds, in the order of the file. */
  readonly entities: readonly ReadEntity[];
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
  readonly other?: Readonly<Record<string, number>>;
}

/** Model space. */
export interface ReadSpace {
  readonly census: ReadCensus;
  /** With `geometry`, what it draws, in the order of the file. */
  readonly entities?: readonly ReadEntity[];
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
