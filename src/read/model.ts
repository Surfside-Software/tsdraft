// The read model: what a reader of a drawing file gives. It is not a `Drawing`. It holds what a
// drawing file states about its tables, its blocks, its xrefs and its layouts, and a census of
// what each space draws, and is never written back.
import type { Point } from "../drawing.ts";

/** The format of a `DrawingRead`. A reader gives the format it was built for. */
export const READ_FORMAT = 0;

/**
 * What a reader read from one drawing file. Its size grows with the file's tables, and with
 * its entities only up to the limit of each list: `CENSUS_LIMIT` for a space's census, its
 * viewports and its inserts and for the fields, `BLOCK_ITEMS` for the blocks, 64 heights for
 * one `MTEXT` and 1,000 tags for one insert. Every object keyed by names from the file,
 * such as a census's `layers`, has no prototype, so any name is a key.
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
  /** Each block that is not a space, an xref or the picture of a dimension. */
  readonly blocks: readonly ReadBlock[];
  readonly xrefs: readonly ReadXref[];
  /** Model space: its census. */
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

/** An attribute definition of a block. */
export interface ReadAttributeDefinition {
  readonly handle?: string | undefined;
  readonly tag: string;
  readonly prompt?: string;
  readonly default?: string;
  readonly at: Point;
  readonly height?: number;
  readonly style: string;
  readonly layer: string;
  readonly invisible: boolean;
  readonly constant: boolean;
}

interface ReadEntityBase {
  readonly handle?: string | undefined;
  readonly layer: string;
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

export interface ReadText extends ReadEntityBase {
  readonly kind: "text";
  /** The first alignment point, group 10. */
  readonly at: Point;
  readonly height: number;
  readonly value: string;
  readonly rotation: number;
  /** Its text style, `Standard` when the file names none. */
  readonly style: string;
}

export interface ReadInsert extends ReadEntityBase {
  readonly kind: "insert";
  readonly block: string;
  readonly at: Point;
  readonly scale: readonly [x: number, y: number];
  readonly rotation: number;
  /** Whether the insert sets each attribute, by its tag: true when its value is not empty. */
  readonly tags: Readonly<Record<string, boolean>>;
}

/** What a block's definition holds of the kinds the core has. */
export type ReadEntity = ReadLine | ReadPolyline | ReadCircle | ReadArc | ReadText | ReadInsert;

export interface ReadBlock {
  /** The handle of the block's record, which an insert's block record points to. */
  readonly handle?: string | undefined;
  readonly name: string;
  readonly base: Point;
  /** True for a block AutoCAD names itself, such as a dynamic block's state, `*U12`. */
  readonly anonymous: boolean;
  readonly attributeDefinitions: readonly ReadAttributeDefinition[];
  /** Its lines, polylines of straight segments, circles, arcs, texts and inserts. */
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
  /** Its inserts of blocks and of xrefs, up to `CENSUS_LIMIT`, as its census lists them. */
  readonly inserts: readonly ReadInsert[];
  readonly census: ReadCensus;
}

/** Model space. */
export interface ReadSpace {
  readonly census: ReadCensus;
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

/** The most entities, and points of polylines, the definitions of a file's blocks keep in all. */
export const BLOCK_ITEMS = 400_000;

/**
 * What a package that reads drawing files exports from the module its `package.json` names
 * under `"tsdraft": { "readers": { ".dwg": "./dist/read.js" } }`. It takes the file's bytes as
 * they arrive and its name without folders.
 */
export type ReadDrawingFile = (
  chunks: AsyncIterable<Uint8Array>,
  name: string,
) => Promise<DrawingRead>;
