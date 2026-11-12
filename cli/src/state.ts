// The JSON that `tsdraft render` prints and `tsdraft dev` serves as /state.json. Agents program
// against it, so a change here is a change to the interface.
import type { Diagnostic, DxfVersion, Entity, PaperUnit, TextWarning, Units } from "tsdraft";

/** The result of one build of a drawing file. */
export interface BuildState {
  /** The shape of this object. It goes up when a field changes meaning or goes away. */
  readonly schema: 3;
  /**
   * Whether the file ran and its default export gave a drawing. Lint errors do not make it false.
   * `render` also reports false when it could not write the SVG or PNG, with `error.name`
   * `Output`; then `drawing` and `diagnostics` still describe the drawing.
   */
  readonly ok: boolean;
  /**
   * Counts builds since the command started. `render` always reports 1. In `tsdraft dev` a number
   * can be skipped: a build that read a file changed while it ran is thrown away and run again.
   */
  readonly build: number;
  /**
   * Changes each time the command starts, so a `build` number from before a restart is not
   * mistaken for one after it.
   */
  readonly session: string;
  /**
   * In `tsdraft dev`, the number the next build will have while one is queued or running, which
   * means this state is about to be replaced; `null` when this is the latest. Always `null` from
   * `render`.
   */
  readonly pending: number | null;
  /**
   * The build whose drawing `outputs` point at. Equal to `build` when `ok`. After a failed build
   * in `tsdraft dev`, it is the last build that worked, whose drawing stays on screen; `null`
   * when none has.
   */
  readonly shownBuild: number | null;
  /** Absolute path of the drawing file, with symlinks resolved. */
  readonly file: string;
  /** When the build finished, as an ISO 8601 time. */
  readonly finishedAt: string;
  /** Milliseconds from the start of the build to the SVG being ready, or to the failure. */
  readonly ms: number;
  /** Where those milliseconds went. Missing steps did not run. */
  readonly timings: Timings;
  /** What the drawing holds. `null` when the build failed. */
  readonly drawing: DrawingSummary | null;
  /**
   * What `lint` reports for the drawing, errors first, and after it what `inspectText` warns of
   * in the text as it plots: a rule that starts with `text-`. When the file threw a
   * `DrawingError`, as `toDXF` and the builder do, its diagnostics, without `kind` and
   * `bounds`. When the build failed because the drawing could not be drawn even without what
   * `lint` reported, what `lint` reported, without `kind` and `bounds`. Otherwise empty when
   * the build failed.
   */
  readonly diagnostics: readonly BuildDiagnostic[];
  /** Why the build failed. `null` when `ok`. */
  readonly error: BuildError | null;
  /**
   * The pictures. `render` gives file paths. `dev` gives URLs of the drawing on screen, which
   * after a failed build is the last good one, naming its session and build so that a picture
   * from another is refused. `null` when there is none. `pngError` says why there is no PNG
   * beside an SVG: the PNG renderer is an optional dependency, and it is not installed or has no
   * build for this machine, or the renderer stopped on this picture or could not draw it. The build is
   * still `ok`, and the other pictures are made. Otherwise `pngError` is `null`.
   *
   * `svg` and `png` are model space. `layouts` has a picture of each layout as it plots, in the
   * order of `drawing.layouts`, and is empty for a drawing with none.
   *
   * `pngFonts` says which typeface the PNG sets each font of the picture in. In any typeface a
   * text is as long in the pictures as it plots, and in the PNG its capitals are as tall.
   *
   * `view` is the one picture of a `render --view` run, which writes no other: `svg`, `png`
   * and `layouts` are then `null` and empty. It is `null` in every other run.
   */
  readonly outputs: {
    readonly svg: string | null;
    readonly png: string | null;
    readonly pngError: string | null;
    readonly pngFonts: readonly PngFont[];
    readonly layouts: readonly LayoutOutput[];
    readonly view: ViewOutput | null;
  };
  /** What the drawing file printed to stdout and stderr, cut to its last 8,000 characters. */
  readonly log: string;
}

/** The pictures of one layout: its sheet as it plots, in paper units. */
export interface LayoutOutput {
  /** The layout's name, as `drawing.layouts` has it. */
  readonly name: string;
  readonly svg: string;
  /** `null` when there is no PNG, for the reason `pngError` gives. */
  readonly png: string | null;
  /**
   * Why this sheet has no PNG: the reason `outputs.pngError` gives for every picture, or that
   * the renderer stopped on this one. `null` when it has a PNG.
   */
  readonly pngError: string | null;
  /** The typeface this sheet's PNG sets each of its fonts in. */
  readonly pngFonts: readonly PngFont[];
}

/** The picture of one rectangle of model space or of a layout, which `render --view` asks for. */
export interface ViewOutput {
  /** The layout the rectangle is on, or `null` for one of model space. */
  readonly layout: string | null;
  /** The rectangle: in drawing units in model space, in paper units on a layout. */
  readonly box: Box;
  readonly svg: string;
  /** `null` when there is no PNG, for the reason `pngError` gives. */
  readonly png: string | null;
  readonly pngError: string | null;
  readonly pngFonts: readonly PngFont[];
}

/**
 * The typeface a PNG sets a font in. The PNG renderer has one typeface of its own, a
 * monospaced one, and reads the machine's font folders for more: a TrueType font is set in
 * its own file when the machine has it, or in a font made to its widths, such as Liberation
 * Sans for Arial. An SHX font, and a TrueType font the machine has neither for, is set in the
 * renderer's own. Whatever the typeface, a text is as long in the PNG as it plots and its
 * capitals are as tall: only the shapes of its letters differ.
 */
export interface PngFont {
  /**
   * A font of the drawing, as a text style names it, that text in the picture is set in. Two
   * SHX fonts that `toSVG` sets in one font family are both listed when either is drawn.
   */
  readonly font: string;
  /** The family name of the typeface the PNG sets it in. */
  readonly face: string;
}

/**
 * A lint diagnostic. For an entity problem, `layer` is the layer the entity names, `kind` and
 * `bounds` say what and where it is, `id` is the entity's id when it has one, and `call` is the
 * call in the drawing's code that drew it. For a problem the builder threw, `call` is the call
 * that threw. The `file` of a `call` is an absolute path, as `error.file` is.
 *
 * With `block`, the problem is in that block: `entity` then counts the block's entities, and
 * `bounds` is in the block's own coordinates.
 *
 * With `item`, the problem is the shape of a value, such as a field of the wrong type, and
 * `item` is the path of the item that holds it. A problem of an entity that `drawing.omitted`
 * leaves out, by itself or with its block or list, has no `kind`, `layer` or `bounds`, since
 * the entity was not drawn.
 *
 * With `xref`, the problem is in that xref, or in the drawing the file gives for it: an error
 * `lint` finds there is reported once for each, with its rule, and that xref is not drawn.
 *
 * With `layout`, the problem is on that layout: `entity` then counts the layout's entities,
 * `viewport` its viewports, and `bounds` is on the sheet, in paper units. A viewport has no
 * `kind`.
 *
 * A warning of `inspectText` has a rule that starts with `text-`. Its `entity` is the entity of
 * model space, or of `layout`, that draws the text: the text itself, the dimension whose text it
 * is, or the insert whose block holds it, with the tag in `attribute` when it is one of the
 * insert's attributes. `kind` and
 * `layer` are that entity's, and `block` is never set. `bounds` is the box of the text as it
 * plots, turned and justified, and of both texts when two overlap, in the coordinates of its
 * picture: pass it to `render --view`. `other` names the other text of an overlap, or the
 * closed polyline the text runs past, the same way.
 */
export interface BuildDiagnostic extends Omit<Diagnostic, "rule"> {
  readonly rule: Diagnostic["rule"] | TextWarning["rule"];
  readonly kind?: Entity["kind"];
  /** The box around the entity, in drawing units, worked out as `extents` is. */
  readonly bounds?: Box;
  readonly other?: TextWarning["other"];
}

export interface Box {
  readonly min: readonly [x: number, y: number];
  readonly max: readonly [x: number, y: number];
}

export interface Timings {
  /** Starting the child process that runs the file, up to its first line of work. */
  readonly start?: number;
  /** Importing the drawing file and calling its default export. */
  readonly load?: number;
  readonly lint?: number;
  /** Looking at the text as it plots, for the warnings whose rule starts with `text-`. */
  readonly inspect?: number;
  readonly svg?: number;
  /** Rasterizing the PNG, when one was asked for. Not counted in `ms`. */
  readonly png?: number;
}

export interface DrawingSummary {
  readonly units: Units;
  readonly dxf: DxfVersion;
  /**
   * The smallest box around the entities on layers that are on, thawed and set to plot, in
   * drawing units, as `toSVG` works it out. A build that draws the layers that do not plot
   * counts their entities too. It is approximate: an arc counts as its whole circle. A text
   * counts for the box `measureText` gives it, and for what its font draws below the baseline.
   */
  readonly extents: Box;
  /** Counted in the drawing as it is, whatever `omitted` leaves out of the lists and pictures. */
  readonly counts: {
    readonly layers: number;
    /** The entities of model space. An insert is one entity, whatever its block holds. */
    readonly entities: number;
    readonly blocks: number;
    readonly xrefs: number;
    readonly layouts: number;
    readonly errors: number;
    readonly warnings: number;
  };
  /**
   * The paths of what the pictures, the extents and the lists below leave out, because `lint`
   * reported that it cannot be read and `toSVG` could not draw the drawing with it: an entity,
   * such as `entities[3]` or `blocks[0].entities[1]`, an entry of another list, such as
   * `blocks[0]` or `layouts[0]`, a viewport or an entity of a layout, such as
   * `layouts[0].viewports[1]`, or a whole list, such as `xrefs`. Each is the `item` of a
   * diagnostic. Missing when nothing is left out.
   */
  readonly omitted?: readonly string[];
  /** Each layer in the drawing's order, with the number of entities that name it exactly. */
  readonly layers: readonly LayerSummary[];
  /** Each block in the drawing's order. Empty for a drawing with none. */
  readonly blocks: readonly BlockSummary[];
  /** Each insert in model space, in the drawing's order. Empty for a drawing with none. */
  readonly inserts: readonly InsertSummary[];
  /**
   * Each dimension in model space, in the drawing's order, with what it measures and the text
   * it is drawn with. Empty for a drawing with none.
   */
  readonly dimensions: readonly DimensionSummary[];
  /** Each xref in the drawing's order. Empty for a drawing with none. */
  readonly xrefs: readonly XrefSummary[];
  /** Each layout in the order of its tab. Empty for a drawing with none. */
  readonly layouts: readonly LayoutSummary[];
}

/** A layout: a sheet of paper, with what is drawn on it and the viewports that show the model. */
export interface LayoutSummary {
  readonly name: string;
  /** The paper's name, such as `ARCH D`. */
  readonly paper: string;
  /** The units of the paper and of everything on the sheet. */
  readonly paperUnits: PaperUnit;
  /** The sheet's size in paper units. Its lower-left corner is 0, 0. */
  readonly width: number;
  readonly height: number;
  /** The plot style table the layout plots with. */
  readonly plotStyle: string;
  /** How many entities are drawn on the sheet. An insert is one entity. */
  readonly entities: number;
  readonly viewports: readonly ViewportSummary[];
  /**
   * Each insert on the sheet, in order, with the value of each attribute: a title block's
   * fields are here. `entity` is the insert's index in the layout's entities, and `at` is on
   * the sheet, in paper units.
   */
  readonly inserts: readonly InsertSummary[];
  /** Each dimension on the sheet, in order. What one measures is in paper units. */
  readonly dimensions: readonly DimensionSummary[];
}

/** A dimension: what it measures between its two points, and the text it is drawn with. */
export interface DimensionSummary {
  /**
   * The dimension's index among the entities of its space, model space's or its layout's,
   * which its group in that picture's SVG has in `data-entity`.
   */
  readonly entity: number;
  /** The dimension's id, or `null`. */
  readonly id: string | null;
  readonly layer: string;
  /** `linear` measures along one direction, and `aligned` from point to point. */
  readonly kind: "linear" | "aligned";
  /** The dimension style as the dimension names it. */
  readonly style: string;
  /**
   * The length it measures, in the units of its space, before its style's measurement scale.
   * `null` when it cannot be worked out: its style is not defined, or the copy of tsdraft
   * the drawing loaded is from before dimensions.
   */
  readonly measurement: number | null;
  /**
   * The text CAD draws for it: the measurement as its style writes it, with its prefix and
   * suffix, or the dimension's own text. `null` where `measurement` is.
   */
  readonly text: string | null;
}

/** A viewport: a rectangle on a sheet that shows model space at a scale. */
export interface ViewportSummary {
  /** The viewport's id, or `null`. */
  readonly id: string | null;
  /** The layer of its border. */
  readonly layer: string;
  /** Whether the border plots: its layer is on, thawed and set to plot. The view plots either way. */
  readonly border: boolean;
  /** The rectangle on the sheet, in paper units. */
  readonly rectangle: Box;
  /** How many times larger the model is than its plot: 120 is 1" = 10'. */
  readonly ratio: number;
  /** The point of model space at the middle of the rectangle, in drawing units. */
  readonly center: readonly [x: number, y: number];
  /**
   * The box of model space the viewport shows, in drawing units. What lies outside it is cut
   * off: compare it with `drawing.extents`.
   */
  readonly shows: Box;
}

/** An xref: another drawing's DWG file, which CAD loads and draws where each insert puts it. */
export interface XrefSummary {
  readonly name: string;
  /** The path of the DWG file, from the folder of the file this drawing is written to. */
  readonly path: string;
  /** How many inserts place the xref, in model space, in blocks and on layouts. */
  readonly inserts: number;
  /**
   * Whether the pictures draw a drawing for the xref. The command opens no DWG file: it draws
   * the drawing that the drawing file's `xrefs` export gives under the xref's name, when that
   * drawing has no lint error. It cannot tell whether that drawing is what the file at `path`
   * holds, so `true` says what the pictures drew and not what CAD will load. When this is
   * false, the pictures and the extents have nothing of the xref, and CAD will still draw it.
   */
  readonly shown: boolean;
  /**
   * The units of the drawing given for the xref, or `null` when none is given. CAD draws an
   * insert at the scale it has, whatever the units, so where these differ from
   * `drawing.units` each insert needs the scale between the two.
   */
  readonly units: Units | null;
}

export interface BlockSummary {
  readonly name: string;
  /** How many entities the block holds. An insert of another block is one of them. */
  readonly entities: number;
  /** The tag of each attribute definition, in order. */
  readonly attributes: readonly string[];
  /** How many inserts place the block, in model space, in other blocks and on layouts. */
  readonly inserts: number;
}

export interface InsertSummary {
  /**
   * The insert's index among the entities of its space, model space's or its layout's, which
   * its group in that picture's SVG has in `data-entity`.
   */
  readonly entity: number;
  /** The block or the xref as the insert names it. */
  readonly block: string;
  /** True when the insert places an xref, which `drawing.xrefs` lists, and not a block. */
  readonly xref: boolean;
  readonly layer: string;
  /** The insert's id, or `null`. */
  readonly id: string | null;
  /** Where the block's base point is. */
  readonly at: readonly [x: number, y: number];
  readonly scale: readonly [x: number, y: number];
  /** Degrees counterclockwise. */
  readonly rotation: number;
  /**
   * The value the insert shows for each attribute of its block, by tag: its own, or the
   * definition's default. Empty when the block has no attributes or is not defined.
   */
  readonly attributes: Readonly<Record<string, string>>;
}

export interface LayerSummary {
  readonly name: string;
  /** AutoCAD Color Index. */
  readonly color: number;
  /** The linetype its entities draw with ByLayer. */
  readonly linetype: string;
  /** The lineweight its entities draw with ByLayer, in millimetres. */
  readonly lineweight: number | "Default";
  /** An off or frozen layer's entities are left out of the pictures and the extents. */
  readonly off: boolean;
  readonly frozen: boolean;
  /**
   * False for a layer that does not plot. Its entities are left out too, unless the build was
   * asked to draw such layers.
   */
  readonly plot: boolean;
  readonly entities: number;
}

export interface BuildError {
  /**
   * `Error`, `SyntaxError`, `Timeout` when the file ran too long, `Exit` when its process died,
   * `Output` when `render` could not write a picture.
   */
  readonly name: string;
  readonly message: string;
  /** Node's error code, such as `ERR_INVALID_TYPESCRIPT_SYNTAX`, when it has one. */
  readonly code: string | null;
  /**
   * Where to fix it: the innermost line of the stack that is in a file of the project, outside
   * node_modules. A throw inside tsdraft lands on the call that led to it. `null` when the error
   * points at no file of the project.
   */
  readonly file: string | null;
  readonly line: number | null;
  readonly column: number | null;
  /** The error's stack as Node printed it, or `""`. */
  readonly stack: string;
}
