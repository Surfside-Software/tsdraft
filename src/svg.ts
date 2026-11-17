import {
  blocksByKey,
  eachDrawn,
  mapPoint,
  referencedByKey,
  type LayerRef,
  type Matrix,
  type Referenced,
} from "./blocks.ts";
import { dimensionPicture, type Dimension } from "./dimensions.ts";
import {
  sweep,
  type DimensionStyle,
  type Drawing,
  type Entity,
  type Insert,
  type Layer,
  type Leader,
  type LeaderStyle,
  type Line,
  type Point,
  type Text,
  type TextStyle,
  type Viewport,
} from "./drawing.ts";
import { boxer, type Boxer } from "./extents.ts";
import { fontInfo, STANDARD_FONT } from "./fonts.ts";
import { fmt, written } from "./format.ts";
import { layerKey, layerKeys } from "./layers.ts";
import { findLayout, validViewportView } from "./layouts.ts";
import { leaderPicture, type LeaderPicture } from "./leaders.ts";
import { builtInLinetype, LINEWEIGHTS, lineweightCode } from "./linetypes.ts";
import { drawnValue, inStyle, layoutText } from "./measure.ts";
import { DEFAULT_PLOT_STYLE_TABLE, paperInfo } from "./papers.ts";
import { shown as quoted, viewportProblem } from "./rules.ts";
import { filled } from "./shape.ts";
import { isUnits } from "./units.ts";

/**
 * The color AutoCAD plots each ACI index in, from 1 to 255, ten to a row. The entry for index
 * 7 is not used: 7 is black on paper and white on a dark screen, so it draws in currentColor.
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

/** AutoCAD draws a lineweight of "Default" at its LWDEFAULT, 0.25 mm. */
const DEFAULT_LINEWEIGHT = 25;

/**
 * The height of a capital, as a share of the font size, in the screen font that stands in for
 * an SHX font. The fonts themselves are not read, and a screen's own font may differ a little.
 */
const SCREEN_CAP_HEIGHT = 0.7;

/**
 * The most dashes one entity is cut into. AutoCAD draws a line solid when its pattern is too
 * fine to show, and so does the preview.
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

/** The viewports of a picture that look through model space free of `MAX_WALKED`. */
const FREE_VIEWS = 64;

/** How many elements of an insert are joined into one string as they are made. */
const JOINED = 1024;

/**
 * The format of a picture of a layout, which `svgToPDF` reads: it goes up whenever an element or
 * an attribute of such a picture changes what it means.
 */
export const SHEET_PICTURE = 1;

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
   * The drawing each xref stands for, by the xref's name. An insert of an xref draws the model
   * space of the drawing given here, and nothing when none is given.
   */
  readonly xrefs?: Readonly<Record<string, Drawing>>;
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
}

/** How an entity is drawn. */
interface Pen {
  readonly color: string;
  /** Undefined for a solid line. */
  readonly dashes: Dashes | undefined;
  /** In hundredths of a millimetre. */
  readonly lineweight: number;
}

/** A dash pattern scaled for a space, worked out once for each entity drawn with it. */
interface Dashes {
  /** Dash, gap, dash, ... in drawing units, starting with a dash. */
  readonly lengths: readonly number[];
  /** What they add up to. */
  readonly total: number;
  /** True when one has no length: a dot, which draws as a round cap. */
  readonly dot: boolean;
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
 * Renders a preview SVG of the drawing as it plots. Model Y points up, so the drawing group
 * flips Y. Entities on layers that are off, frozen or set not to plot are left out, and each
 * layer draws in the color AutoCAD plots its index in. Dashed lines are cut into their dashes,
 * scaled by the drawing's linetype scale, and each line is as wide as its lineweight. A text
 * starts where `measureText` says it plots and is held to the length it plots with
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
 * no file, so it draws the drawing given for the xref in `options.xrefs`, as AutoCAD draws a
 * loaded xref: an entity on layer `0` there draws as the insert's layer does, and any other as
 * its own layer of the referenced drawing does, in that layer's color, linetype, lineweight
 * and state, with `data-layer` naming it as AutoCAD does, `XREF|LAYER`. Dashes are scaled by
 * this drawing's linetype scale. The group is empty for an xref with no drawing given.
 *
 * With `options.layout`, the picture is that layout as AutoCAD plots it, in paper units: a
 * white sheet the size of its paper, each viewport as a group with its index in
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
  const boxOf = (entities: readonly Entity[], at: (e: Entity) => string) => {
    boxes ??= boxer(
      drawing.textStyles,
      drawing.blocks,
      hidden,
      frozen,
      xrefs,
      drawing.dimensionStyles,
      drawing.leaderStyles,
      most,
    );
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
    const picture = leaderPicture(e, style, textStyle);
    pictures.set(e, { style, textStyle, picture });
    return picture;
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
    if (e.kind === "leader") {
      const tables = tablesOf(from);
      const style = tables.leaderStyles.get(key(e.style));
      const named = e.textStyle ?? style?.textStyle;
      const textStyle = named === undefined ? undefined : tables.textStyles.get(key(named));
      const picture = style === undefined ? undefined : pictureOf(e, style, textStyle);
      return leaderToSvg(e, picture, textStyle, mark, drawnPen, look, matrix, room, sides);
    }
    if (e.kind !== "linear-dimension" && e.kind !== "aligned-dimension") {
      return entityToSvg(e, mark, drawnPen, look, styleOf(e, from), matrix, room, sides);
    }
    const tables = tablesOf(from);
    const style = tables.dimensionStyles.get(key(e.style));
    const textStyle =
      style?.textStyle === undefined ? undefined : tables.textStyles.get(key(style.textStyle));
    return dimensionToSvg(e, style, textStyle, mark, drawnPen, look, matrix, room);
  };

  /** The sides of each list of points a pattern cuts, read once for the picture. */
  const sides = new WeakMap<object, Sides>();

  /** Each pattern scaled for each space, worked out when first drawn with. */
  const scaled = new Map<readonly number[], Map<number, Dashes>>();
  const dashesOf = (pattern: readonly number[], scale: number, where: () => string): Dashes => {
    let byScale = scaled.get(pattern);
    if (!byScale) scaled.set(pattern, (byScale = new Map()));
    let found = byScale.get(scale);
    if (!found) {
      // A pattern AutoCAD takes has at most 12 lengths, but one given as data may hold any number.
      if (!spend(Math.floor(pattern.length / 32))) refuse(where());
      const lengths = pattern.map((length) => length * scale);
      found = { lengths, total: lengths.reduce((a, b) => a + b, 0), dot: lengths.includes(0) };
      byScale.set(scale, found);
    }
    return found;
  };

  /**
   * The pen of an entity that draws on `on`. `insertLayer` is the layer of the insert that
   * holds it, whose linetype and lineweight an entity set to ByBlock takes. `from` is the
   * referenced drawing the entity is in, whose linetypes it names. `where` names the entity of
   * the space it is drawn for.
   */
  const pen = (
    look: Look,
    e: Pick<Line, "linetype" | "lineweight">,
    on: LayerRef,
    where: () => string,
    insertLayer?: LayerRef,
    from?: Referenced,
    placed = 1,
  ): Pen => {
    const layer: Layer | undefined = layerOf(on);
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
      color: look.color(layer?.color ?? 7),
      // A pattern keeps its length whatever size an insert draws its entity at, so it is cut in
      // the block's own units shrunk by the insert's scale.
      dashes:
        pattern && Number.isFinite(look.dashScale / placed) && placed > 0
          ? dashesOf(pattern, look.dashScale / placed, where)
          : undefined,
      lineweight: code < 0 ? DEFAULT_LINEWEIGHT : code,
    };
  };

  /**
   * The entities of a space that are drawn, each with its index among them. What an insert
   * holds is judged entity by entity, unless the insert's own layer is frozen.
   */
  const shownOf = (entities: readonly Entity[]): [number, Entity][] =>
    [...filled(entities).entries()].filter(([, e]) =>
      e.kind === "insert" ? !frozen({ name: e.layer }) : !hidden({ name: e.layer }),
    );

  /**
   * An element for each entity that is drawn, as `look` draws it, in the space `space` names.
   * Each counts with the line it is written on, set in by `look.indent`.
   */
  const elements = (shown: readonly [number, Entity][], look: Look, space: string): string[] => {
    const marks = (e: Entity, index: number): string =>
      `data-layer="${esc(e.layer)}" data-entity="${index}"${e.id === undefined ? "" : ` data-id="${esc(e.id)}"`}`;
    const line = look.indent.length + 1;
    return shown.map(([i, e]) => {
      const where = () => entityAt(i, e, space);
      if (e.kind !== "insert") {
        const element = drawn(e, marks(e, i), pen(look, styled(e), { name: e.layer }, where), look);
        if (!write(element.length + line)) refuse(where());
        return element;
      }
      const between = `\n${look.indent}  `;
      // An element is made of many small strings, so every `JOINED` of them are joined into one,
      // which holds no more than its characters, with what joins them as the group joins them.
      const joined: string[] = [];
      let parts: string[] = [];
      const walked = eachDrawn(
        e,
        blocks,
        frozen,
        (held, at) => {
          if (hidden(at.layer)) return;
          // AutoCAD names a layer of an xref by the xref's name, a bar and the layer's.
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
          );
          const part = drawn(held, mark, heldPen, look, at.from, at.matrix);
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
    | { shown: [number, Entity]; box: readonly [number, number, number, number]; slack: number }[]
    | undefined;
  /** How many times model space has been looked through. */
  let views = 0;
  /**
   * The entities of model space that may reach into a rectangle of it, `[x0, y0, x1, y1]`, with
   * a pen that reaches `pen` past an entity's box. The test errs on the side of drawing.
   */
  const reaching = (rect: readonly number[], pen: number, where: string): [number, Entity][] => {
    if (!boxed) {
      boxed = shownOf(drawing.entities).flatMap((shown) => {
        const box = boxOf([shown[1]], (e) => entityAt(shown[0], e, "model space"));
        if (!box) return [];
        const lettered =
          shown[1].kind === "text" ||
          shown[1].kind === "insert" ||
          shown[1].kind === "linear-dimension" ||
          shown[1].kind === "aligned-dimension" ||
          shown[1].kind === "leader";
        const slack = lettered ? Math.max(box[2] - box[0], box[3] - box[1]) : 0;
        return [{ shown, box, slack }];
      });
    }
    if (++views > FREE_VIEWS && !spend(Math.floor(boxed.length / 64))) refuse(where);
    return boxed
      .filter(({ box: b, slack }) => {
        const by = pen + slack;
        return (
          b[0] - by <= rect[2]! &&
          b[2] + by >= rect[0]! &&
          b[1] - by <= rect[3]! &&
          b[3] + by >= rect[1]!
        );
      })
      .map(({ shown }) => shown);
  };

  // AutoCAD scales the dashes of a referenced drawing by the linetype scale of the drawing
  // that references it.
  // AutoCAD reads a scale of 0 or less as 1, and so is one that is not a finite number here.
  const stated = drawing.linetypeScale ?? 1;
  const linetypeScale = stated > 0 && Number.isFinite(stated) ? stated : 1;
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
    const plotted = (scale: number, indent: string): Look => ({
      color,
      dashScale: linetypeScale / scale,
      indent,
      stroke: (lineweight) =>
        pen !== undefined || lineweight === DEFAULT_LINEWEIGHT
          ? ""
          : ` stroke-width="${precise((Math.max(lineweight, 5) * perHundredth) / scale)}"${lineweight === 0 ? THINNEST : ""}`,
    });
    const onPaper = plotted(1, "    ");
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
    filled(layout.viewports).forEach((viewport, index) => {
      const at = `viewport #${index} of ${space}`;
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
      // Model space is placed so that the view's center lies at the middle of the rectangle.
      // The scale is written in full: six decimals leave a drawing in millimetres at 1:1000,
      // whose scale is 0.0000393701, two digits.
      const place = `translate(${fmt(view.paperCenter[0])} ${fmt(view.paperCenter[1])}) scale(${precise(view.scale)}) translate(${fmt(-view.center[0])} ${fmt(-view.center[1])})`;
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
      // The same rectangle in model space.
      const shows = seen.map(
        (at, i) => view.center[i % 2]! + (at - view.paperCenter[i % 2]!) / view.scale,
      );
      // Only what may reach into it is drawn: an entity's box, which for an arc is its
      // circle's, with the widest pen there is and the slack of its letters around it.
      const widest = (LINEWEIGHTS.at(-1)! * 100 * perHundredth) / view.scale;
      const near = visible ? reaching(shows, widest, at) : [];
      const inside = elements(near, plotted(view.scale, "        "), `model space in ${at}`);
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
      // AutoCAD plots a viewport's border as its thinnest line, and only when its layer plots.
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
    return [...head, ...parts.map((part) => `    ${part}`), ...tail].join("\n");
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
      )
    : all;
  // On a screen each layer draws in its own color, and every line keeps its width in pixels
  // however far the picture is zoomed.
  const onScreen: Look = {
    color: aciColor,
    dashScale: linetypeScale,
    indent: "    ",
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
  return [...head, `    ${body}`, ...tail].join("\n");
}

/**
 * A number with 12 significant digits, for a scale or a width that six decimals would cut
 * short. SVG reads the exponent a very small one is printed with.
 */
function precise(value: number): string {
  return String(Number(value.toPrecision(12)));
}

/** How a space is drawn: on a screen, or as it plots on paper. */
interface Look {
  /** The color of an ACI index. */
  readonly color: (index: number) => string;
  /** What a linetype's pattern is multiplied by, to give dashes in the space's own units. */
  readonly dashScale: number;
  /** The attributes that set an element's stroke width, for a lineweight in hundredths of a millimetre. */
  readonly stroke: (lineweight: number) => string;
  /** The white space before an element, which what an insert holds is set in from. */
  readonly indent: string;
}

/** What a drawing's entities name: its layers, its dash patterns and its text styles. */
interface Tables {
  /** Keyed as AutoCAD looks layers up, so an entity on `wall` takes the color of layer `WALL`. */
  readonly layers: ReadonlyMap<string, Layer>;
  readonly patterns: ReadonlyMap<string, number[] | undefined>;
  readonly textStyles: ReadonlyMap<string, TextStyle>;
  readonly dimensionStyles: ReadonlyMap<string, DimensionStyle>;
  readonly leaderStyles: ReadonlyMap<string, LeaderStyle>;
}

function tablesFor(drawing: Drawing): Tables {
  return {
    layers: new Map(filled(drawing.layers).map((l) => [layerKey(l.name), l])),
    patterns: new Map(
      filled(drawing.linetypes).map((t) => [layerKey(t.name), alternating(filled(t.pattern))]),
    ),
    textStyles: new Map(filled(drawing.textStyles).map((t) => [layerKey(t.name), t])),
    dimensionStyles: new Map(filled(drawing.dimensionStyles).map((t) => [layerKey(t.name), t])),
    leaderStyles: new Map(filled(drawing.leaderStyles).map((t) => [layerKey(t.name), t])),
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
    e.kind === "text" && e.style !== undefined
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
type Shape = Exclude<Drawn, Dimension | Leader>;

/** The linetype and the lineweight an entity has of its own. A dimension and a leader draw ByLayer. */
function styled(e: Drawn): Pick<Line, "linetype" | "lineweight"> {
  return e.kind === "linear-dimension" || e.kind === "aligned-dimension" || e.kind === "leader"
    ? {}
    : e;
}

/**
 * A leader as a group: its shafts and its landing, which take the dashes of its pen, its
 * arrowheads, and each line of its note. A filled arrowhead and a dot are filled. A leader whose
 * style the drawing does not have, and so has no picture, is an empty group.
 */
function leaderToSvg(
  e: Leader,
  picture: LeaderPicture | undefined,
  textStyle: TextStyle | undefined,
  mark: string,
  pen: Pen,
  look: Look,
  matrix: Matrix | undefined,
  room: number,
  sides: WeakMap<object, Sides>,
): string {
  if (picture === undefined) return `<g ${mark}/>`;
  const at = (p: Point): Point => (matrix ? mapPoint(matrix, p) : p);
  const parts: string[] = [];
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
  for (const shaft of picture.shafts) {
    shape("shaft", { kind: "polyline", layer: e.layer, points: shaft, closed: false });
  }
  if (picture.landing) {
    shape("landing", {
      kind: "line",
      layer: e.layer,
      from: picture.landing[0],
      to: picture.landing[1],
    });
  }
  for (const arrowhead of picture.arrowheads) {
    if (arrowhead.filled.length > 0) {
      add(
        () =>
          `<polygon points="${points(arrowhead.filled)}" fill="${pen.color}" stroke="none" data-part="arrowhead"/>`,
      );
    }
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
  }
  for (const line of picture.lines) {
    const text: Text = {
      kind: "text",
      layer: e.layer,
      at: line.at,
      height: line.height,
      value: line.value,
      rotation: 0,
      ...(line.align === "right" ? { align: "right" as const } : {}),
    };
    add((left) => entityToSvg(text, `data-part="text"`, pen, look, textStyle, matrix, left));
  }
  return `<g ${mark} data-leader="${filled(e.text).map(esc).join("&#10;")}">\n${look.indent}  ${parts.join(`\n${look.indent}  `)}\n${look.indent}</g>`;
}

/**
 * A dimension as a group: its extension lines and its dimension line, which take the dashes
 * of its pen, its arrowheads, filled, and its text. A dimension whose style the drawing does
 * not have is an empty group.
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
  const picture = dimensionPicture(e, style);
  const at = (p: Point): Point => (matrix ? mapPoint(matrix, p) : p);
  const line = (part: string, [from, to]: readonly [Point, Point]): string =>
    entityToSvg(
      { kind: "line", layer: e.layer, from, to },
      `data-part="${part}"`,
      pen,
      look,
      undefined,
      matrix,
      room,
    );
  const { label } = picture;
  const text: Text = {
    kind: "text",
    layer: e.layer,
    at: label.at,
    height: label.height,
    value: label.value,
    rotation: label.rotation,
    align: "center",
  };
  const parts = [
    ...picture.extensionLines.map((ends) => line("extension-line", ends)),
    line("dimension-line", picture.dimensionLine),
    ...picture.arrowheads.map((corners) => {
      const points = corners
        .map(at)
        .map(([x, y]) => `${fmt(x)},${fmt(y)}`)
        .join(" ");
      return `<polygon points="${points}" fill="${pen.color}" stroke="none" data-part="arrowhead"/>`;
    }),
    entityToSvg(text, `data-part="text"`, pen, look, textStyle, matrix, room),
  ];
  return `<g ${mark} data-dimension="${esc(label.value)}">\n${look.indent}  ${parts.join(`\n${look.indent}  `)}\n${look.indent}</g>`;
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
  sides = new WeakMap<object, Sides>(),
): string {
  // A lineweight of 0 draws as the thinnest line, as in AutoCAD.
  const s = `stroke="${pen.color}"${look.stroke(pen.lineweight)} ${mark}`;
  const at = (p: Point): Point => (matrix ? mapPoint(matrix, p) : p);
  if (e.kind !== "text" && pen.dashes) {
    const d = dashedPath(e, pen.dashes, matrix, room, sides);
    // A pattern with a dot draws it as a round cap on a path of no length.
    const cap = pen.dashes.dot ? ` stroke-linecap="round"` : "";
    if (d !== undefined) return `<path d="${d}"${cap} ${s}/>`;
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
    case "text": {
      // Undo the group's Y flip so the text reads upright, then apply CAD rotation.
      let t = `translate(${fmt(e.at[0])} ${fmt(e.at[1])}) scale(1 -1)${e.rotation ? ` rotate(${fmt(-e.rotation)})` : ""}`;
      // An insert's matrix is applied last, so it comes first.
      if (matrix) t = `matrix(${matrix.map(fmt).join(" ")}) ${t}`;
      const font = fontInfo(style?.font ?? STANDARD_FONT);
      const width = style?.widthFactor ?? 1;
      const oblique = style?.obliqueAngle ?? 0;
      // The text is drawn from where it starts to plot, on its baseline, before the style
      // widens or slants it, and held to the length it plots.
      const { start, end, baseline } = layoutText(inStyle(e, style));
      if (written(start) !== 0 || written(baseline) !== 0) {
        t += ` translate(${fmt(start)} ${fmt(-baseline)})`;
      }
      // AutoCAD slants a text after it widens it, so the width factor does not widen the lean.
      // The transform applied last comes first.
      if (oblique !== 0) t += ` skewX(${fmt(-oblique)})`;
      if (width !== 1) t += ` scale(${fmt(width)} 1)`;
      // A text's height is the height of its capitals, which a font draws smaller than its size.
      const size = e.height / (font?.capHeight ?? SCREEN_CAP_HEIGHT);
      const length = written((end - start) / width);
      const held = length > 0 ? ` textLength="${length}" lengthAdjust="spacingAndGlyphs"` : "";
      const family = font?.family ?? "monospace";
      // The font by its name in `FONTS`, and empty for a font that is not one of them.
      const named = font ? (style?.font ?? STANDARD_FONT) : "";
      return `<text transform="${t}" font-size="${fmt(size)}" font-family="${esc(family)}" data-height="${fmt(e.height)}"${held} xml:space="preserve" fill="${pen.color}" stroke="none" data-font="${esc(named)}" ${mark}>${esc(drawnValue(e.value))}</text>`;
    }
  }
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
function alternating(pattern: readonly number[]): number[] | undefined {
  const first = pattern.findIndex((length) => length >= 0);
  if (first < 0) return undefined;
  const runs: number[] = [];
  // A dot is a dash of no length. Runs alternate dash, gap, so an odd index is a gap.
  for (const length of [...pattern.slice(first), ...pattern.slice(0, first)]) {
    if (runs.length % 2 === (length < 0 ? 0 : 1)) runs[runs.length - 1]! += Math.abs(length);
    else runs.push(Math.abs(length));
  }
  if (runs.length < 2) return undefined;
  if (runs.length % 2 === 1) runs[0]! += runs.pop()!;
  return runs.reduce((a, b) => a + b, 0) > 0 ? runs : undefined;
}

/**
 * An entity cut into the dashes of its pattern, as path data, or undefined when the pattern
 * is too fine for the entity and it draws solid. A polyline starts the pattern again at each
 * vertex, as AutoCAD does unless told otherwise. The cuts are made in the entity's own
 * coordinates, with the pattern shrunk by the insert's scale, and then placed by `matrix`, so a
 * dash is as long whatever size an insert draws its entity at.
 * Once the path is longer than `room` characters it stops, and is longer than the room. A
 * polyline's sides are read once a list of points, into `known`, so a placement does work only
 * for the sides it draws: one with no length draws nothing.
 */
function dashedPath(
  e: Exclude<Shape, { kind: "text" }>,
  { lengths: dashes, total }: Dashes,
  matrix: Matrix | undefined,
  room: number,
  known: WeakMap<object, Sides>,
): string | undefined {
  // Dashes that add up to no length would never reach the end of a stretch.
  if (!(total > 0)) return undefined;
  const place = (px: number, py: number): string => {
    const [mx, my] = matrix ? mapPoint(matrix, [px, py]) : [px, py];
    return `${fmt(mx)} ${fmt(my)}`;
  };
  const out: string[] = [];
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
    let i = 0;
    let at = 0;
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
      const end = (length + first - k * total) / 2;
      dash(draw, 0, dotted ? 0 : end);
      [i, at, last] = [1, end, length - end];
    }
    // The pattern ends where the last dash starts, or where the stretch ends, to within what
    // rounding moves a number.
    const stop = last - total * stretch * 1e-9;
    for (; at < stop && size <= room; i = (i + 1) % dashes.length) {
      if (i % 2 === 0) dash(draw, at, Math.min(at + dashes[i]! * stretch, last));
      at += dashes[i]! * stretch;
    }
    // A fitted stretch ends with its last dash, or a dot at its end.
    if (fitted && size <= room) dash(draw, dotted ? length : last, length);
    return true;
  };
  const straight = (a: Point, b: Point): boolean => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const along = (t: number) =>
      place(a[0] + ((b[0] - a[0]) * t) / length, a[1] + ((b[1] - a[1]) * t) / length);
    return length === 0 || cut(length, (from, to) => `M ${along(from)} L ${along(to)}`, true);
  };
  const round = (
    center: Point,
    radius: number,
    start: number,
    turn: number,
    fitted: boolean,
    stretch = 1,
  ): boolean => {
    const along = (t: number) => {
      const angle = rad(start) + t / radius;
      return place(center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle));
    };
    const shape = rounded(radius, matrix);
    return cut(
      radius * rad(turn),
      (from, to) => {
        // SVG draws no arc between two equal points, so a dot is a line of no length.
        if (to === from) return `M ${along(from)} L ${along(to)}`;
        const arc = `A ${fmt(shape.rx)} ${fmt(shape.ry)} ${fmt(shape.turn)}`;
        // A dash of a full turn ends where it starts, so it is drawn as two halves.
        if ((to - from) / radius > Math.PI && along(from) === along(to)) {
          return `M ${along(from)} ${arc} 0 ${shape.sweep} ${along((from + to) / 2)} ${arc} 0 ${shape.sweep} ${along(to)}`;
        }
        const large = (to - from) / radius > Math.PI ? 1 : 0;
        return `M ${along(from)} ${arc} ${large} ${shape.sweep} ${along(to)}`;
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
      const { points, ends, longest } = sidesOf(e.points, known);
      const [first, last] = [points[0], points.at(-1)];
      // The side that closes it, NaN when there is none.
      const closing =
        e.closed && first && last ? Math.hypot(first[0] - last[0], first[1] - last[1]) : NaN;
      // A side the pattern is too fine for draws the whole polyline solid.
      if ((closing > longest ? closing : longest) / total > MAX_DASHES) return undefined;
      for (const end of ends) {
        if (size > room) break;
        straight(points[end - 1]!, points[end]!);
      }
      if (closing > 0) straight(last!, first!);
      ok = true;
      break;
    }
    case "circle": {
      // A circle holds the whole number of patterns nearest its length, each stretched or
      // shrunk alike to go round it exactly, from a dash at its angle 0. One shorter than its
      // pattern is solid.
      const around = 2 * Math.PI * e.radius;
      if (!(around >= total)) return undefined;
      ok = round(e.center, e.radius, 0, 360, false, around / (Math.round(around / total) * total));
      break;
    }
    case "arc":
      ok = round(e.center, e.radius, e.startAngle, sweep(e.startAngle, e.endAngle), true);
      break;
  }
  return ok && out.length > 0 ? out.join(" ") : undefined;
}

/**
 * The sides of a list of points that have a length, read once into `known`. A side whose length
 * is 0, or not a number, draws no dash.
 */
function sidesOf(list: unknown, known: WeakMap<object, Sides>): Sides {
  const found = typeof list === "object" && list !== null ? known.get(list) : undefined;
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
  if (typeof list === "object" && list !== null) known.set(list, sides);
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
