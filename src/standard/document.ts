// A standard as a document, before `extends` and `null` are resolved, and as a `Standard`, after.
// The document's types are as wide as a JSON import gives them: `defineStandard` checks each
// literal through `CheckDocument`, and every value when the code runs.
import type { Arrowhead, ZERO_SUPPRESSIONS } from "../arrowheads.ts";
import type { Drawing, Point, Units } from "../drawing.ts";
import type { Font } from "../fonts.ts";
import type { PaperUnit } from "../paper.ts";
import type { Paper, PlotStyleTable } from "../papers.ts";

/** A rectangle on the paper, `[left, bottom, right, top]`, as `PaperInfo.printable` is. */
export type Box = readonly [left: number, bottom: number, right: number, top: number];

/** How a firm keeps its sheets: as layouts of one drawing, or each as a file of its own. */
export type SheetFiles = "one-drawing" | "sheet-per-file";

/** What a sheet fills a title block's field with. */
export type TitleBlockFill =
  | "number"
  | "title"
  | "project"
  | "date"
  | "scale"
  | "drawnBy"
  | "checkedBy";

/**
 * Where a title block's field gets its value: an attribute the builder sets, or a field of the
 * xref's drawing that AutoCAD fills with the sheet's file name, its layout's name or the date.
 */
export type FieldSource = "attribute" | "fileName" | "layoutName" | "currentDate";

/** The sections of a standard, each an object of entries by name. */
export const SECTIONS = [
  "disciplines",
  "pens",
  "linetypes",
  "layers",
  "textRoles",
  "scales",
  "dimensionStyles",
  "titleBlocks",
  "sheetFormats",
] as const;

export type Section = (typeof SECTIONS)[number];

interface Commented {
  /** For people. No rule reads it, and `defineStandard` drops it. */
  readonly $comment?: string;
}

/** A section of a document: an entry by name, or `null`, which removes the parent's entry. */
type Entries<E> = { readonly [name: string]: E | null };

/** A standard as JSON, or as a TypeScript literal given to `defineStandard`. */
export interface StandardDocument extends Commented {
  /** The JSON Schema of the document. */
  readonly $schema?: string;
  /** 1 to 128 letters, digits, `.`, `-`, `_`, `@` and `/`, so a package name is one. */
  readonly id: string;
  readonly version: string;
  /** For people. Defaults to the `id`. */
  readonly title?: string;
  /**
   * The parent: a `Standard`, or a string that `options.files` gives the standard for.
   * `"tsdraft/standard.json"` is `BUILT_IN_STANDARD`.
   */
  readonly extends?: string | Standard;
  /** The unit of every length on paper. Required without `extends`, and a child keeps its parent's. */
  readonly paperUnits?: string;
  /** The least height a text may plot at, in paper units. Required without `extends`. */
  readonly minTextHeight?: number;
  /** A dash plots its pattern's length times this. Defaults to 1. */
  readonly linetypeScale?: number;
  /** One of `PLOT_STYLE_TABLES`. Defaults to `"monochrome.ctb"`. */
  readonly plotStyle?: string;
  /** `"one-drawing"`, the default, or `"sheet-per-file"`. */
  readonly sheetFiles?: string;
  readonly defaultSheetFormat?: string;
  readonly defaultDimensionStyle?: string;
  readonly disciplines?: Entries<DisciplineDocument>;
  readonly pens?: Entries<PenDocument>;
  readonly linetypes?: Entries<LinetypeDocument>;
  readonly layers?: Entries<LayerDocument>;
  readonly textRoles?: Entries<TextRoleDocument>;
  readonly scales?: Entries<ScaleDocument>;
  readonly dimensionStyles?: Entries<DimensionStyleDocument>;
  readonly titleBlocks?: Entries<TitleBlockDocument>;
  readonly sheetFormats?: Entries<SheetFormatDocument>;
}

export interface DisciplineDocument extends Commented {
  readonly title: string;
}

export interface PenDocument extends Commented {
  /** One of AutoCAD's lineweights, in millimetres. */
  readonly lineweight: number;
  readonly description?: string;
}

export interface LinetypeDocument extends Commented {
  readonly description?: string;
  /** Dashes and gaps in paper units, before `linetypeScale`, as `Linetype.pattern` holds them. */
  readonly pattern: readonly number[];
}

export interface LayerFieldsDocument extends Commented {
  /** An AutoCAD Color Index from 1 to 255. */
  readonly color?: number;
  /** A linetype of the standard, or `Continuous`, the default. */
  readonly linetype?: string;
  /** A pen of the standard. Without one the layer has AutoCAD's lineweight `Default`. */
  readonly pen?: string;
  /** Defaults to true. */
  readonly plot?: boolean;
  readonly description?: string;
}

export interface LayerDocument extends LayerFieldsDocument {
  readonly color: number;
  /** The discipline the layer belongs to. A layer without one belongs to every discipline. */
  readonly discipline?: string;
  /** Fields that replace the layer's own in a discipline's drawings, under `sheet-per-file`. */
  readonly byDiscipline?: { readonly [discipline: string]: LayerFieldsDocument };
}

export interface TextRoleFieldsDocument extends Commented {
  /** One of `FONTS`, as AutoCAD stores it. */
  readonly font?: string;
  /** The plotted height of a capital, in paper units, at least `minTextHeight`. */
  readonly height?: number;
  readonly widthFactor?: number;
  readonly obliqueAngle?: number;
  readonly description?: string;
}

export interface TextRoleDocument extends TextRoleFieldsDocument {
  readonly font: string;
  readonly height: number;
  readonly discipline?: string;
  readonly byDiscipline?: { readonly [discipline: string]: TextRoleFieldsDocument };
}

export interface ScaleDocument extends Commented {
  /** The name AutoCAD's scale list gives the scale, such as `1" = 10'`. */
  readonly label: string;
  /** Drawing lengths per paper length, such as 120 for 1" = 10'. */
  readonly ratio: number;
  readonly discipline?: string;
}

/** How a dimension style writes a length in one unit of a drawing. */
export interface WritingDocument extends Commented {
  /** `"decimal"`, the default, which is the one way tsdraft writes a length. */
  readonly units?: string;
  readonly precision: number;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly suppressZeros?: string;
  readonly measurementScale?: number;
}

export interface DimensionStyleFieldsDocument extends Commented {
  /** The text role of the dimension's text, which gives its text style and height. */
  readonly role?: string;
  readonly arrowhead?: string;
  readonly arrowSize?: number;
  readonly extensionOffset?: number;
  readonly extensionBeyond?: number;
  readonly textGap?: number;
  readonly writing?: { readonly [U in Units]?: WritingDocument };
  readonly description?: string;
}

export interface DimensionStyleDocument extends DimensionStyleFieldsDocument {
  readonly role: string;
  readonly arrowSize: number;
  readonly extensionOffset: number;
  readonly extensionBeyond: number;
  readonly textGap: number;
  readonly discipline?: string;
  readonly byDiscipline?: { readonly [discipline: string]: DimensionStyleFieldsDocument };
}

export interface TitleBlockFieldDocument extends Commented {
  readonly fills?: string;
  /** With a box, `lint` warns of a value that runs past it. */
  readonly box?: readonly number[];
  /** `"attribute"`, the default, `"fileName"`, `"layoutName"` or `"currentDate"`. */
  readonly source?: string;
}

export interface XrefDocument extends Commented {
  readonly name: string;
  /** The path as each sheet's file sees it, as `d.xref` takes it. */
  readonly path: string;
  /** Where the xref is inserted on the paper. Defaults to `[0, 0]`. */
  readonly at?: readonly number[];
}

export interface TitleBlockDocument extends Commented {
  /** One of `PAPERS`. */
  readonly paper: string;
  /** A `Drawing` that holds the block `blockName`, inline, or a string `options.files` gives it for. */
  readonly block?: string | object;
  readonly blockName?: string;
  /** The firm's own drawing, referenced as an overlay. */
  readonly xref?: XrefDocument;
  /** A `Drawing` the pictures draw in place of the xref, given as `block` is. */
  readonly preview?: string | object;
  /** A layer of the standard, which the title block is inserted on. */
  readonly layer: string;
  /** The part of the paper inside the border. */
  readonly drawingArea: readonly number[];
  /** The title block's own rectangle inside the drawing area, which no viewport may reach into. */
  readonly box?: readonly number[];
  /** The fields a sheet fills, by tag. */
  readonly fields?: { readonly [tag: string]: TitleBlockFieldDocument };
}

export interface SheetFormatDocument extends Commented {
  /** One of `PAPERS`, which is its title block's paper. */
  readonly paper: string;
  readonly titleBlock: string;
  /** The sheet format's own plot style table, in place of the standard's. */
  readonly plotStyle?: string;
  /** Named boxes inside the title block's drawing area, which the code lays the sheet out by. */
  readonly zones?: { readonly [zone: string]: readonly number[] };
  readonly discipline?: string;
}

/** The names of the entries of each section of a standard. */
export type StandardNames = { readonly [S in Section]: string };

/** A parent of a standard, nearest first. */
export interface StandardLink {
  readonly id: string;
  readonly version: string;
  readonly hash: string;
}

export interface StandardDiscipline {
  readonly title: string;
}

export interface StandardPen {
  readonly lineweight: number;
  readonly description?: string;
}

export interface StandardLinetype {
  readonly description: string;
  readonly pattern: readonly number[];
}

export interface StandardLayerFields {
  readonly color?: number;
  readonly linetype?: string;
  readonly pen?: string;
  readonly plot?: boolean;
  readonly description?: string;
}

export interface StandardLayer {
  readonly color: number;
  readonly linetype: string;
  readonly pen?: string;
  readonly plot: boolean;
  readonly discipline?: string;
  readonly description?: string;
  readonly byDiscipline?: { readonly [discipline: string]: StandardLayerFields };
}

export interface StandardTextRoleFields {
  readonly font?: Font;
  readonly height?: number;
  readonly widthFactor?: number;
  readonly obliqueAngle?: number;
  readonly description?: string;
}

export interface StandardTextRole {
  readonly font: Font;
  readonly height: number;
  readonly widthFactor: number;
  readonly obliqueAngle: number;
  readonly discipline?: string;
  readonly description?: string;
  readonly byDiscipline?: { readonly [discipline: string]: StandardTextRoleFields };
}

export interface StandardScale {
  readonly label: string;
  readonly ratio: number;
  readonly discipline?: string;
}

export interface StandardWriting {
  readonly units: "decimal";
  readonly precision: number;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly suppressZeros?: (typeof ZERO_SUPPRESSIONS)[number];
  readonly measurementScale: number;
}

export interface StandardDimensionStyleFields {
  readonly role?: string;
  readonly arrowhead?: Arrowhead;
  readonly arrowSize?: number;
  readonly extensionOffset?: number;
  readonly extensionBeyond?: number;
  readonly textGap?: number;
  readonly writing?: { readonly [U in Units]?: StandardWriting };
  readonly description?: string;
}

export interface StandardDimensionStyle {
  readonly role: string;
  readonly arrowhead: Arrowhead;
  readonly arrowSize: number;
  readonly extensionOffset: number;
  readonly extensionBeyond: number;
  readonly textGap: number;
  readonly writing: { readonly [U in Units]?: StandardWriting };
  readonly discipline?: string;
  readonly description?: string;
  readonly byDiscipline?: { readonly [discipline: string]: StandardDimensionStyleFields };
}

export interface StandardTitleBlockField {
  readonly fills?: TitleBlockFill;
  readonly box?: Box;
  readonly source: FieldSource;
}

export interface StandardXref {
  readonly name: string;
  readonly path: string;
  readonly at: Point;
}

export interface StandardTitleBlock {
  readonly paper: Paper;
  readonly block?: Drawing;
  readonly blockName?: string;
  readonly xref?: StandardXref;
  readonly preview?: Drawing;
  readonly layer: string;
  readonly drawingArea: Box;
  readonly box?: Box;
  readonly fields: { readonly [tag: string]: StandardTitleBlockField };
}

export interface StandardSheetFormat {
  readonly paper: Paper;
  readonly titleBlock: string;
  readonly plotStyle?: PlotStyleTable;
  readonly zones: { readonly [zone: string]: Box };
  readonly discipline?: string;
}

/**
 * A standard: the document resolved, with no `$schema`, `extends` or `null`, every default filled
 * in and every title block's drawings as `Drawing` objects, with its `hash` and `chain`. It is
 * plain, frozen data. Its type carries the names of its entries, `N`, and its id `I` and version
 * `R`, as literal types.
 *
 * Left without `hash` and `chain`, it is a document with no `extends` that resolves to the same
 * standard, with the same hash.
 */
export type Standard<
  N extends StandardNames = StandardNames,
  I extends string = string,
  R extends string = string,
> = {
  readonly id: I;
  readonly version: R;
  readonly title: string;
  readonly paperUnits: PaperUnit;
  readonly minTextHeight: number;
  readonly linetypeScale: number;
  readonly plotStyle: PlotStyleTable;
  readonly sheetFiles: SheetFiles;
  readonly defaultSheetFormat?: N["sheetFormats"];
  readonly defaultDimensionStyle?: N["dimensionStyles"];
  readonly disciplines: { readonly [K in N["disciplines"]]: StandardDiscipline };
  readonly pens: { readonly [K in N["pens"]]: StandardPen };
  readonly linetypes: { readonly [K in N["linetypes"]]: StandardLinetype };
  readonly layers: { readonly [K in N["layers"]]: StandardLayer };
  readonly textRoles: { readonly [K in N["textRoles"]]: StandardTextRole };
  readonly scales: { readonly [K in N["scales"]]: StandardScale };
  readonly dimensionStyles: { readonly [K in N["dimensionStyles"]]: StandardDimensionStyle };
  readonly titleBlocks: { readonly [K in N["titleBlocks"]]: StandardTitleBlock };
  readonly sheetFormats: { readonly [K in N["sheetFormats"]]: StandardSheetFormat };
  /** The SHA-256 of what the standard states for a check. */
  readonly hash: string;
  /** The id, version and hash of each parent, nearest first. */
  readonly chain: readonly StandardLink[];
};

export interface StandardOptions<F = Readonly<Record<string, unknown>>> {
  /**
   * What a string in the document names, by the string exactly as the document writes it: a
   * `Standard` for `extends`, and the value `JSON.parse` gives for a title block's `block` or
   * `preview`. `"tsdraft/standard.json"` and `"tsdraft/title-blocks/plain-arch-d.json"` need
   * no entry. The library reads no file.
   */
  readonly files?: F;
}
