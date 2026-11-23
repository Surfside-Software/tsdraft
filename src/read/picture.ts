// The picture of a read file: a `DrawingRead` as the `Drawing` `toSVG` draws, so that a firm's
// sheet is drawn with the code, the pens and the plot style tables every drawing is drawn with.
// Each kind the readers keep becomes the kinds of a `Drawing` that draw it as the leading CAD app
// does: a dimension and a table their picture's block, a text from where that app starts it, an
// insert's attributes where the file places them. What a read counts and does not keep draws
// nothing, and the notes count it.
import type { XrefDrawings } from "../blocks.ts";
import { drawnPicture, type PictureParts, type SvgOptions } from "../svg.ts";
import { checkDrawingRead } from "./check.ts";
import type {
  AttributeDefinition,
  Block,
  Drawing,
  Entity,
  HatchPattern,
  Image,
  Layer,
  Layout,
  Leader,
  LeaderStyle,
  Linetype,
  LinetypeMark,
  Paragraph,
  Point,
  Text,
  TextStyle,
  Units,
  Viewport,
} from "../drawing.ts";
import { matchedIndex } from "../colors.ts";
import { nearestFont, FONTS } from "../fonts.ts";
import { isObjectOrArray } from "../guards.ts";
import { layerKey } from "../layers.ts";
import { measureText } from "../measure.ts";
import { paperInfo, PAPERS, PLOT_STYLE_TABLES, type PaperInfo } from "../papers.ts";
import { pointStyleOf } from "../points.ts";
import { imageFrame } from "../images.ts";
import { leaderPicture } from "../leaders.ts";
import { LEADER_ATTACHMENTS } from "../rules.ts";
import {
  CELL_TEXT,
  IMAGE_FADE,
  MODEL_DASHES,
  LAYER_TRUE_COLOR,
  OWN_LINETYPE_SCALE,
  READ_PAPER,
  READ_SOURCES,
  type PicturePiece,
  type ReadSource,
  type ReadSources,
} from "../picture-marks.ts";
import { modelLength } from "../units.ts";
import type {
  DrawingRead,
  ReadAttribute,
  ReadAttributeParagraph,
  ReadEntity,
  ReadEntityBase,
  ReadHatch,
  ReadLayer,
  ReadLayout,
  ReadMultileader,
  ReadTextPlacement,
  ReadTextStyle,
  ReadViewport,
} from "./model.ts";
import { edgesInPlan, penOf } from "./plan.ts";

/** What the picture of a read file could not draw as the file holds it. */
export interface ReadPictureNotes {
  /**
   * Each text style whose font tsdraft does not have, with the font of `FONTS` its texts are
   * measured and drawn in, which `nearestFont` picks.
   */
  readonly fonts: readonly {
    readonly style: string;
    readonly font: string;
    readonly drawnIn: string;
  }[];
  /**
   * What draws nothing, counted by kind: what the read counts under a space's `other` or under
   * `unread`, and what it keeps and the picture cannot draw, such as a dimension with no block of
   * its picture.
   */
  readonly notDrawn: Readonly<Record<string, number>>;
  /** What draws only nearly as the leading CAD app draws it, counted by what. */
  readonly approximate: Readonly<Record<string, number>>;
}

/** What `pictureDrawing` gives: the drawing, where each of its entities came from, and the notes. */
export interface PictureDrawing {
  readonly drawing: Drawing;
  readonly sources: ReadSources;
  readonly notes: ReadPictureNotes;
  /**
   * The handle of the read entity each entity of the drawing was made from, in its spaces and its
   * blocks alike, and in the drawings of its xrefs, where the read entity has one: an attribute
   * drawn as a text is its attribute's. A handle of an xref's entity is one of the xref's file.
   */
  readonly handles: WeakMap<object, string>;
  /** The drawings of the xrefs given, as `toSVG`'s `xrefs` takes them. */
  readonly xrefs: XrefDrawings;
}

/** What `pictureDrawing` reads beside the read. */
export interface PictureDrawingOptions {
  /** The size in inches of each page the underlays show, by path and page, as `pdfPageSize` reads it. */
  readonly pageSizes?: UnderlayPageSizes;
  /**
   * The read each xref stands for, by the xref's name, or `{ read, xrefs }` with the reads its
   * own attachments stand for. Each is drawn with the states of its layers the host holds as
   * `XREF|LAYER`, as the leading CAD app shows it.
   */
  readonly xrefs?: XrefReads;
}

/** The reads xrefs stand for, by the xref's name. */
export type XrefReads = Readonly<
  Record<
    string,
    | DrawingRead
    | {
        readonly read: DrawingRead;
        readonly xrefs?: XrefReads;
        /** The bytes of each raster file its images show, by path, as `SvgOptions.images`. */
        readonly images?: Readonly<Record<string, Uint8Array>>;
      }
  >
>;

/** The size in inches of each page of the PDF files the read's underlays show, by path and page. */
export type UnderlayPageSizes = Readonly<
  Record<string, Readonly<Record<string, readonly [width: number, height: number]>>>
>;

/** What `toSVG` and `readPicture` take to draw a read, as `SvgOptions` and the reads of its xrefs. */
export interface ReadSvgOptions extends Omit<SvgOptions, "xrefs"> {
  /** The read each xref stands for, by the xref's name, drawn with the host's states of its layers. */
  readonly xrefs?: XrefReads;
  /**
   * The size in inches of each page the underlays show, by path and page, as `pdfPageSize` reads
   * it. An underlay whose page's size is not here draws nothing, and the notes say so.
   */
  readonly pageSizes?: UnderlayPageSizes;
}

/** The picture of a read file, what it could not draw as the file holds it, and its pieces. */
export interface ReadPicture {
  readonly svg: string;
  readonly notes: ReadPictureNotes;
  /**
   * The picture in pieces, which `joinPicture` joins into `svg`: its own text, the definitions,
   * and for each space it draws one fragment for each entity at the top of the space that shows,
   * in the order the leading CAD app draws them. A fragment holds what was made from its entity,
   * an insert's attributes among it, and its ids are its own: an edit keeps the fragments of what
   * it does not reach and joins them with those it draws again.
   */
  readonly pieces: readonly PicturePiece[];
  /** Each definition a fragment uses, such as an image's picture or a gradient, by its id. */
  readonly defs: Readonly<Record<string, string>>;
}

/**
 * The picture of a read file: what `toSVG` draws of a `DrawingRead` read with `geometry`, with its
 * notes and its fragments. A layout is drawn as it plots, with its viewports and at its own plot
 * style table where tsdraft has it, and model space as the leading CAD app shows it. Each kind the
 * read keeps is drawn as tsdraft draws a `Drawing`'s: a dimension and a table from the block of
 * their picture, a multileader from its own points with the arrowheads of `leaderPicture`, a text
 * from where that app starts it, and a text in a font tsdraft does not have in the nearest of
 * `FONTS`. What the read counts and does not keep draws nothing, and `notes` counts it.
 *
 * @throws RangeError when `read` is not a `DrawingRead`, as `checkDrawingRead` says, and as
 *   `toSVG` throws for a drawing.
 */
export function readPicture(read: DrawingRead, options: ReadSvgOptions = {}): ReadPicture {
  return readPictureWithin(read, options);
}

/** `readPicture` with at most `most` entities walked, as `svgWithin` takes it. */
export function readPictureWithin(
  read: DrawingRead,
  options: ReadSvgOptions,
  most?: number,
): ReadPicture {
  const problems = checkDrawingRead(read);

  if (problems.length > 0) {
    throw new RangeError(`The read is not a DrawingRead: ${problems.slice(0, 3).join("; ")}`);
  }

  const { xrefs: given, pageSizes, ...rest } = options;

  const made = pictureDrawing(read, {
    ...(given !== undefined && { xrefs: given }),
    ...(pageSizes !== undefined && { pageSizes }),
  });

  const parts: PictureParts = {};

  // SAFETY: `pictureDrawing` gives the xrefs as drawings that `SvgOptions` takes, and the sources
  // under a key only `svgWithin` reads.
  const svg = drawnPicture(
    made.drawing,
    { ...rest, xrefs: made.xrefs, [READ_SOURCES]: made.sources } as SvgOptions,
    parts,
    most,
  );

  return { svg, notes: made.notes, pieces: parts.pieces ?? [], defs: parts.defs ?? {} };
}

const UNITS = new Map<number, Units>([
  [1, "in"],
  [2, "ft"],
  [4, "mm"],
  [5, "cm"],
  [6, "m"],
]);

/** A name no file's name can be, to tell the styles and patterns the picture makes apart. */
const MADE = "\u0001";

/**
 * A handle as the readers make one: 1 to 16 hexadecimal digits. Only such a handle keys a map or
 * scopes an id; another, which a reader of another format may give, is passed over.
 */
const handleOf = (handle: string | undefined): string | undefined =>
  handle !== undefined && /^[0-9A-Fa-f]{1,16}$/.test(handle) ? handle : undefined;

/** The longest value a DXF holds, and so the longest name the readers make. */
const NAME_MOST = 2049;

/**
 * A name as the maps of a picture key it: `layerKey`'s, and for a name longer than a reader makes,
 * one of its length and its start, so that no map is keyed by a string V8 hashes by its length.
 */
const nameKey = (name: string): string =>
  name.length > NAME_MOST
    ? `${MADE}${name.length}${MADE}${layerKey(name.slice(0, 64))}${MADE}${layerKey(name.slice(-64))}`
    : layerKey(name);

/** A name as the picture's drawing holds it: as the file does, or a key for one too long. */
const drawnName = (name: string): string => (name.length > NAME_MOST ? nameKey(name) : name);

/** A counter of names, with no prototype, so any name is a key. */
const counter = (): Record<string, number> => Object.create(null);

/**
 * The read as a `Drawing` that `toSVG` draws as the leading CAD app shows the file, with the
 * source of each top-level entity, in the order the app draws each space.
 */
export function pictureDrawing(
  read: DrawingRead,
  options: PictureDrawingOptions = {},
): PictureDrawing {
  return drawingOf(read, options, new WeakMap(), {
    made: new WeakMap(),
    open: new Set(),
    count: 0,
    cuts: 0,
  });
}

/** The xrefs a picture has converted, each once whatever shares it, and those being converted. */
interface XrefWalk {
  readonly made: WeakMap<object, PictureDrawing>;
  readonly open: Set<object>;
  count: number;
  /** How many cycles the walk has cut. */
  cuts: number;
}

/** The most xref drawings one picture converts. */
const XREFS_MADE = 256;

/** `pictureDrawing`, with the handle of each entity made, its xrefs' among them, in `handles`. */
function drawingOf(
  read: DrawingRead,
  options: PictureDrawingOptions,
  handles: WeakMap<object, string>,
  walk: XrefWalk,
  nested = false,
): PictureDrawing {
  const pageSizes = options.pageSizes ?? {};

  const mark = <E extends Entity>(made: E, handle: string | undefined): E => {
    if (handle !== undefined) handles.set(made, handle);

    return made;
  };

  const notDrawn = counter();
  const approximate = counter();

  const count = (to: Record<string, number>, what: string, n = 1): void => {
    to[what] = (to[what] ?? 0) + n;
  };

  for (const [kind, n] of Object.entries(read.unread.entities)) count(notDrawn, kind, n);

  // The text styles, each in the font of `FONTS` nearest its own.
  const fonts: { style: string; font: string; drawnIn: string }[] = [];
  const readStyles = new Map<string, ReadTextStyle>();
  const textStyles = new Map<string, TextStyle>();

  for (const style of read.textStyles) {
    const key = nameKey(style.name);

    if (readStyles.has(key)) continue;
    readStyles.set(key, style);
    const named = style.font !== undefined && style.font !== "" ? style.font : style.family;

    const near =
      named === undefined || named === "" ? { font: "txt.shx", exact: true } : nearestFont(named);

    if (!near.exact) fonts.push({ style: style.name, font: named!, drawnIn: near.font });
    textStyles.set(key, {
      name: drawnName(style.name),
      font: near.font,
      ...(style.widthFactor !== undefined &&
        style.widthFactor !== 1 && { widthFactor: style.widthFactor }),
      ...(style.oblique !== undefined && style.oblique !== 0 && { obliqueAngle: style.oblique }),
    });
  }

  const fontOf = (style: string): string => textStyles.get(nameKey(style))?.font ?? "txt.shx";

  /** The style a text of its own width factor and slant is drawn in: its own, or one made for it. */
  const styleFor = (style: string, widthFactor = 1, oblique = 0): string => {
    const base = textStyles.get(nameKey(style));
    const font = base?.font ?? "txt.shx";

    if ((base?.widthFactor ?? 1) === widthFactor && (base?.obliqueAngle ?? 0) === oblique) {
      return base?.name ?? drawnName(style);
    }

    const name = `${drawnName(style)}${MADE}${widthFactor}${MADE}${oblique}`;
    const key = nameKey(name);

    if (!textStyles.has(key)) {
      textStyles.set(key, {
        name,
        font,
        ...(widthFactor !== 1 && { widthFactor }),
        ...(oblique !== 0 && { obliqueAngle: oblique }),
      });
    }

    return name;
  };

  // The blocks, each by a name of its own: two anonymous records of one name stay apart by handle.
  const blockNames = new Map<string, string>();
  const taken = new Set<string>();

  for (const block of read.blocks) {
    let name = drawnName(block.name);
    const handle = handleOf(block.handle);

    if (taken.has(nameKey(name))) name = `${drawnName(block.name)}${MADE}${handle ?? taken.size}`;
    taken.add(nameKey(name));

    if (handle !== undefined) blockNames.set(handle, name);

    if (!blockNames.has(`${MADE}${nameKey(block.name)}`)) {
      blockNames.set(`${MADE}${nameKey(block.name)}`, name);
    }
  }

  const blockOf = (name: string, handle: string | undefined): string =>
    (handleOf(handle) !== undefined ? blockNames.get(handle!) : undefined) ??
    blockNames.get(`${MADE}${nameKey(name)}`) ??
    drawnName(name);

  const patterns: HatchPattern[] = [];
  const readLayers = new Map<string, ReadLayer>();

  for (const layer of read.layers) {
    if (!readLayers.has(nameKey(layer.name))) readLayers.set(nameKey(layer.name), layer);
  }

  const definitions = new Map(
    read.images.flatMap((d) => (handleOf(d.handle) === undefined ? [] : [[d.handle!, d] as const])),
  );

  /** The blocks the picture makes, beside the file's. */
  const madeBlocks: Block[] = [];
  /** The blocks a multileader holds as content, which keep their attribute definitions. */
  const contents = new Map<string, { readonly name: string; readonly content: string }>();

  const contentBlock = (name: string): string => {
    let made = contents.get(nameKey(name));

    if (made === undefined)
      contents.set(nameKey(name), (made = { name, content: `${name}${MADE}content` }));

    return made.content;
  };

  /** What fits a multileader's block to the file once the blocks are made. */
  const fitted: ((findBlock: (name: string) => Block | undefined) => void)[] = [];
  const leaderStyles: LeaderStyle[] = [];
  const dimensionStyles = new Map(read.dimensionStyles.map((s) => [nameKey(s.name), s]));

  /** A text of one line as the leading CAD app draws it: from where it starts. */
  const textOf = (
    t: ReadTextPlacement & ReadEntityBase,
    value: string,
    id: string | undefined,
  ): Text | undefined => {
    const pen = penOf(t);
    let height = t.height;
    let widthFactor = t.widthFactor ?? 1;
    let rotation = t.rotation;

    if ((t.align === "fit" || t.align === "aligned") && t.alignAt !== undefined) {
      // Fitted between its two points: wider for `fit`, taller too for `aligned`.
      const span = Math.hypot(t.alignAt[0] - t.stored[0], t.alignAt[1] - t.stored[1]);

      const natural = measureText({
        value,
        height,
        font: fontOf(t.style),
        widthFactor,
        obliqueAngle: t.oblique ?? 0,
      }).length;

      if (span > 0 && natural > 0) {
        rotation =
          (Math.atan2(t.alignAt[1] - t.stored[1], t.alignAt[0] - t.stored[0]) * 180) / Math.PI;

        if (t.align === "fit") widthFactor *= span / natural;
        else height *= span / natural;
      }

      return {
        kind: "text",
        ...pen,
        ...(id !== undefined && { id }),
        at: t.stored,
        height,
        value,
        rotation,
        style: styleFor(t.style, widthFactor, t.oblique ?? 0),
      };
    }

    const style = styleFor(t.style, widthFactor, t.oblique ?? 0);

    if (t.startFrom === "alignment" && t.alignAt !== undefined) {
      // Its start is not known: it is justified to its alignment point.
      count(approximate, "a text justified to its alignment point");
      const middle = t.align === "middle";

      return {
        kind: "text",
        ...pen,
        ...(id !== undefined && { id }),
        at: t.alignAt,
        height,
        value,
        rotation,
        style,
        ...(t.align !== undefined && {
          align: middle ? "center" : t.align === "right" ? "right" : "center",
        }),
        ...(middle
          ? { valign: "middle" as const }
          : t.valign !== undefined && { valign: t.valign }),
      };
    }

    return {
      kind: "text",
      ...pen,
      ...(id !== undefined && { id }),
      at: t.at,
      height,
      value,
      rotation,
      style,
    };
  };

  /**
   * A text as `textOf` draws it, and one drawn backward or upside down as the leading CAD app draws
   * it: upright in a block of its own, placed mirrored about its start and its baseline.
   */
  const drawnText = (
    t: ReadTextPlacement & ReadEntityBase,
    value: string,
    id: string | undefined,
  ): Entity | undefined => {
    if (!t.backward && !t.upsideDown) return textOf(t, value, id);
    // A text fitted between two points spans them: upright along X from 0 to their distance, its
    // insert turned to them, at the first point, or at the second when it runs backward.
    const fitted = (t.align === "fit" || t.align === "aligned") && t.alignAt !== undefined;
    const span = fitted ? Math.hypot(t.alignAt![0] - t.stored[0], t.alignAt![1] - t.stored[1]) : 0;

    const placed = fitted
      ? {
          at: t.backward ? t.alignAt! : t.stored,
          rotation:
            (Math.atan2(t.alignAt![1] - t.stored[1], t.alignAt![0] - t.stored[0]) * 180) / Math.PI,
        }
      : { at: t.at, rotation: t.rotation };

    const upright = textOf(
      {
        ...t,
        at: [0, 0],
        stored: [0, 0],
        ...(fitted && { alignAt: [span, 0] satisfies Point }),
        rotation: 0,
        startFrom: "file",
        backward: false,
        upsideDown: false,
      },
      value,
      undefined,
    );

    if (upright === undefined) return undefined;
    const name = `${MADE}mirrored ${madeBlocks.length}`;
    madeBlocks.push({ name, entities: [upright] });
    const pen = penOf(t);

    return {
      kind: "insert",
      layer: t.layer,
      ...(pen.color !== undefined && { color: pen.color }),
      ...(pen.transparency !== undefined && { transparency: pen.transparency }),
      ...(id !== undefined && { id }),
      block: name,
      at: placed.at,
      scale: [t.backward ? -1 : 1, t.upsideDown ? -1 : 1],
      rotation: placed.rotation,
    };
  };

  /** Paragraph text, from the point of its box its attachment names. */
  const paragraphOf = (
    p: Pick<
      ReadAttributeParagraph,
      | "at"
      | "height"
      | "width"
      | "attachment"
      | "rotation"
      | "style"
      | "lineSpacing"
      | "lineSpacingStyle"
      | "mirrored"
    >,
    base: ReadEntityBase,
    value: string,
    id: string | undefined,
    extra: Partial<Pick<Paragraph, "columns" | "mask">> = {},
  ): Entity => {
    if (p.mirrored) {
      // Seen from below, as a mirrored insert holds it: the paragraph upright in a block of its
      // own, placed mirrored, its lines along `rotation` with their tops to their right.
      const name = `${MADE}mirrored ${madeBlocks.length}`;

      const upright = paragraphOf(
        { ...p, at: [0, 0], rotation: 0, mirrored: false },
        base,
        value,
        undefined,
        extra,
      );

      madeBlocks.push({ name, entities: [upright] });
      const pen = penOf(base);

      return {
        kind: "insert",
        layer: base.layer,
        ...(pen.color !== undefined && { color: pen.color }),
        ...(pen.transparency !== undefined && { transparency: pen.transparency }),
        ...(id !== undefined && { id }),
        block: name,
        at: p.at,
        scale: [-1, 1],
        rotation: p.rotation - 180,
      };
    }

    const a = p.attachment >= 1 && p.attachment <= 9 ? p.attachment - 1 : 0;
    const align = (["left", "center", "right"] as const)[a % 3]!;
    const valign = (["top", "middle", "bottom"] as const)[Math.floor(a / 3)]!;

    return {
      kind: "paragraph",
      ...penOf(base),
      ...(id !== undefined && { id }),
      at: p.at,
      height: p.height,
      value,
      rotation: p.rotation,
      ...(p.width > 0 && { width: p.width }),
      style: drawnName(p.style),
      ...(align !== "left" && { align }),
      ...(valign !== "top" && { valign }),
      ...(p.lineSpacing !== 1 && { lineSpacing: p.lineSpacing }),
      ...(p.lineSpacingStyle !== "at-least" && { lineSpacingStyle: p.lineSpacingStyle }),
      ...extra,
    };
  };

  /** An insert's attributes that show, each where the file places it. */
  const attributesOf = (
    attributes: readonly ReadAttribute[] | undefined,
    insert: ReadEntityBase,
  ): Entity[] => {
    const out: Entity[] = [];

    for (const held of attributes ?? []) {
      if (held.invisible) continue;
      // An attribute on layer 0 draws on its insert's layer, as its block's entities do, and one
      // ByBlock in its insert's color.
      const { color, trueColor, ...rest } = held;
      // ByBlock is the insert's color, and for an insert ByLayer its layer's.
      const byBlock = color === 0;
      const insertLayer = readLayers.get(nameKey(insert.layer));

      const own = !byBlock
        ? { color, trueColor }
        : insert.color !== undefined || insert.trueColor !== undefined
          ? insert
          : { color: insertLayer?.color, trueColor: insertLayer?.trueColor };

      const a: ReadAttribute = {
        ...rest,
        layer: held.layer === "0" ? insert.layer : held.layer,
        ...(own.color !== undefined && own.color !== 0 && { color: own.color }),
        ...(own.trueColor !== undefined && { trueColor: own.trueColor }),
      };

      if (a.paragraph !== undefined) {
        out.push(mark(paragraphOf(a.paragraph, a, a.value, undefined), a.handle));
      } else {
        const text = drawnText(a, a.value, undefined);

        if (text) out.push(mark(text, a.handle));
      }
    }

    return out;
  };

  /** A multileader as a leader of a style made for it, from its own points and sizes. */
  const multileaderOf = (e: ReadMultileader, id: string | undefined): Entity | undefined => {
    const first = e.roots[0];

    // A note with no leader, such as the notes under a schedule, is its paragraph alone.
    if (first === undefined && e.block === undefined && e.text !== "") {
      if (e.frame) count(approximate, "a multileader's frame with no root");

      return paragraphOf(
        {
          at: e.textAt,
          height: e.textHeight,
          width: e.width,
          attachment: e.textAttachment,
          rotation: 0,
          style: e.textStyle,
          lineSpacing: 1,
          lineSpacingStyle: "at-least",
        },
        e,
        e.text,
        id,
        { ...(e.mask !== undefined && { mask: e.mask }) },
      );
    }

    if (first === undefined) {
      count(notDrawn, "a multileader with no root");

      return undefined;
    }

    const vertical = e.vertical === true;
    const [dx, dy] = first.direction;
    // A vertical multileader's direction runs along X too: 1 for a note above, -1 below.
    const ahead = dx !== 0 ? dx >= 0 : dy >= 0;
    const side = vertical ? (ahead ? "above" : "below") : ahead ? "right" : "left";
    const along = vertical ? [0, ahead ? 1 : -1] : [ahead ? 1 : -1, 0];
    const content = e.block?.at ?? e.textAt;
    const reach = (content[0] - first.at[0]) * along[0]! + (content[1] - first.at[1]) * along[1]!;
    const gap = e.block !== undefined ? 0 : Math.max(0, reach - first.landing);
    const attachment = (code: number) => LEADER_ATTACHMENTS[code] ?? LEADER_ATTACHMENTS[1]!;
    const name = `${MADE}multileader ${leaderStyles.length}`;

    const style: LeaderStyle = {
      name,
      textStyle: drawnName(e.textStyle),
      textHeight: e.textHeight,
      arrowSize: e.arrowSize,
      landing: first.landing,
      gap,
      attachment: attachment(side === "left" ? e.attachments.right : e.attachments.left),
      ...(vertical && { direction: "vertical" as const }),
      ...(vertical && {
        verticalAttachment:
          (side === "above" ? e.attachments.bottom : e.attachments.top) === 10 ? "line" : "center",
      }),
      ...(e.frame && { frame: true }),
      ...(e.shaft === "curved" && { shaft: "curved" as const }),
      ...(e.block !== undefined && {
        block: contentBlock(blockOf(e.block.name, undefined)),
        blockScale: e.block.scale,
      }),
    };

    if (e.block !== undefined && e.block.rotation !== 0)
      count(approximate, "a multileader's block turned");
    const second = e.roots[1];

    const leader: Leader = {
      kind: "leader",
      ...penOf(e),
      ...(id !== undefined && { id }),
      style: name,
      ...(e.block === undefined && { text: [e.text] }),
      ...(e.block?.attributes !== undefined && { attributes: e.block.attributes }),
      at: first.at,
      shafts: e.shaft === "none" ? [] : first.shafts,
      side,
      ...(e.width > 0 && { width: e.width }),
      ...(e.mask !== undefined && {
        mask: {
          offsetFactor: e.mask.offsetFactor,
          ...(e.mask.color !== undefined && { color: e.mask.color }),
        },
      }),
      ...(second !== undefined && e.shaft !== "none" && { farShafts: second.shafts }),
    };

    // The note goes where the file holds it: placed once, it moves along the landing by how far
    // that is from where it was placed.
    if (e.block === undefined) {
      const placed = leaderPicture(leader, style, textStyles.get(nameKey(e.textStyle)));

      const off =
        (e.textAt[0] - placed.location[0]) * along[0]! +
        (e.textAt[1] - placed.location[1]) * along[1]!;

      if (Number.isFinite(off)) leaderStyles.push({ ...style, gap: Math.max(0, gap + off) });
      else leaderStyles.push(style);
    } else {
      // The block goes where the file holds it, once the blocks are made: by the way it meets
      // its landing that puts it nearest, moved along the landing the rest of the way.
      const at = leaderStyles.push(style) - 1;
      const target = e.block.at;
      fitted.push((findBlock) => {
        let best: { style: LeaderStyle; miss: number } | undefined;

        for (const blockConnection of ["extents", "insertion"] as const) {
          const tried = { ...style, blockConnection };
          const placed = leaderPicture(leader, tried, undefined, findBlock).block?.at;

          if (placed === undefined) continue;
          const off = (target[0] - placed[0]) * along[0]! + (target[1] - placed[1]) * along[1]!;
          const moved = { ...tried, gap: Math.max(0, tried.gap + off) };
          const now = leaderPicture(leader, moved, undefined, findBlock).block?.at ?? placed;
          const miss = Math.hypot(target[0] - now[0], target[1] - now[1]);

          if (Number.isFinite(miss) && (best === undefined || miss < best.miss)) {
            best = { style: moved, miss };
          }
        }

        if (best !== undefined) leaderStyles[at] = best.style;
      });
    }

    return leader;
  };

  /** Each entity of the kinds of a `Drawing` that draws a read entity, or none, with its handle. */
  const entitiesOf = (e: ReadEntity, id: string | undefined, top: boolean): Entity[] => {
    const made = madeOf(e, id, top).map((m) => {
      // A name longer than a reader makes is drawn by a short one of the picture's.
      const { layer } = m;
      const linetype = "linetype" in m ? m.linetype : undefined;

      if (layer.length <= NAME_MOST && (linetype === undefined || linetype.length <= NAME_MOST)) {
        return m;
      }

      // SAFETY: the copy is the entity, of its own kind, with its names short.
      return {
        ...m,
        layer: drawnName(layer),
        ...(linetype !== undefined && { linetype: drawnName(linetype) }),
      } as Entity;
    });

    if (e.handle !== undefined) for (const m of made) if (!handles.has(m)) handles.set(m, e.handle);

    return made;
  };

  const madeOf = (e: ReadEntity, id: string | undefined, top: boolean): Entity[] => {
    const pen = penOf(e);

    const own = (x: Entity): Entity =>
      e.linetypeScale !== undefined && e.linetypeScale !== 1
        ? Object.assign({ ...x }, { [OWN_LINETYPE_SCALE]: e.linetypeScale })
        : x;

    const named = id === undefined ? {} : { id };

    switch (e.kind) {
      case "line":
        return [own({ kind: "line", ...pen, ...named, from: e.from, to: e.to })];
      case "polyline":
        return [
          own({
            kind: "polyline",
            ...pen,
            ...named,
            points: e.points,
            closed: e.closed,
            ...(e.bulges !== undefined && { bulges: e.bulges }),
            ...(e.width !== undefined && { width: e.width }),
            ...(e.widths !== undefined && { widths: e.widths }),
            ...(e.linetypeGeneration && { linetypeGeneration: true }),
          }),
        ];
      case "circle":
        return [own({ kind: "circle", ...pen, ...named, center: e.center, radius: e.radius })];
      case "arc":
        return [
          own({
            kind: "arc",
            ...pen,
            ...named,
            center: e.center,
            radius: e.radius,
            startAngle: e.start,
            endAngle: e.end,
          }),
        ];
      case "point":
        return [
          {
            kind: "point",
            ...pen,
            ...named,
            at: e.at,
            ...(e.rotation !== undefined && { rotation: e.rotation }),
          },
        ];
      case "ellipse":
        return [
          own({
            kind: "ellipse",
            ...pen,
            ...named,
            center: e.center,
            majorAxis: e.majorAxis,
            ratio: e.ratio,
            ...(e.startParameter !== undefined && {
              startParameter: e.startParameter,
              endParameter: e.endParameter,
            }),
          }),
        ];
      case "spline":
        if (e.controlPoints.length > 0) {
          // Drawn as its knots and points give it: a closed one the file holds repeats its first
          // point at its end.
          return [
            own({
              kind: "spline",
              ...pen,
              ...named,
              controlPoints: e.controlPoints,
              degree: e.degree,
              knots: e.knots,
              ...(e.weights !== undefined && { weights: e.weights }),
            }),
          ];
        }

        if (e.fitPoints === undefined || e.fitPoints.length < 2) {
          count(notDrawn, "a spline with no points");

          return [];
        }

        return [
          own({
            kind: "spline",
            ...pen,
            ...named,
            fitPoints: e.fitPoints,
            ...(e.closed
              ? { closed: true }
              : {
                  ...(e.startTangent !== undefined && { startTangent: e.startTangent }),
                  ...(e.endTangent !== undefined && { endTangent: e.endTangent }),
                }),
          }),
        ];
      case "text": {
        const text = drawnText(e, e.value, id);

        return text ? [own(text)] : [];
      }

      case "mtext":
        return [
          paragraphOf(e, e, e.value, id, {
            ...(e.columns !== undefined && { columns: e.columns }),
            ...(e.mask !== undefined && {
              mask:
                e.mask.color === undefined && e.mask.trueColor === undefined
                  ? { offsetFactor: e.mask.offsetFactor }
                  : {
                      offsetFactor: e.mask.offsetFactor,
                      // A mask holds an index; a true color's is the nearest index.
                      color:
                        e.mask.trueColor !== undefined
                          ? matchedIndex([
                              (e.mask.trueColor >> 16) & 255,
                              (e.mask.trueColor >> 8) & 255,
                              e.mask.trueColor & 255,
                            ])
                          : e.mask.color!,
                    },
            }),
          }),
        ];
      case "insert": {
        const insert: Entity = {
          kind: "insert",
          layer: e.layer,
          ...(pen.color !== undefined && { color: pen.color }),
          ...(pen.transparency !== undefined && { transparency: pen.transparency }),
          ...named,
          block: blockOf(e.block, e.blockHandle),
          at: e.at,
          scale: e.scale,
          rotation: e.rotation,
        };

        return [insert, ...attributesOf(e.attributes, e)];
      }

      case "dimension":
      case "radial-dimension":
      case "angular-dimension":
      case "ordinate-dimension":
      case "arc-length-dimension":
      case "table": {
        // Drawn as the leading CAD app shows it: the block of its picture.
        if (e.block === undefined) {
          count(notDrawn, `a ${e.kind} with no block of its picture`);

          return [];
        }

        return [
          {
            kind: "insert",
            layer: e.layer,
            ...(pen.color !== undefined && { color: pen.color }),
            ...(pen.transparency !== undefined && { transparency: pen.transparency }),
            ...named,
            block: blockOf(e.block, e.blockHandle),
            // A dimension's block is in the world's coordinates; a table's is turned in the
            // world, from its corner.
            at: e.kind === "table" ? e.at : [0, 0],
          },
        ];
      }

      case "multileader": {
        const leader = multileaderOf(e, id);

        return leader === undefined ? [] : [leader];
      }

      case "leader": {
        if (e.points.length < 2) {
          count(notDrawn, "a leader of fewer than two points");

          return [];
        }

        const style = dimensionStyles.get(nameKey(e.style));
        const scale = style?.scale !== undefined && style.scale > 0 ? style.scale : 1;
        // A leader's arrowhead is its style's DIMLDRBLK, which the read does not keep: the
        // default, closed and filled.
        const arrowhead = "closed-filled";
        const name = `${MADE}leader ${leaderStyles.length}`;
        leaderStyles.push({
          name,
          textHeight: 1,
          arrowhead,
          arrowSize: e.arrowhead ? (style?.arrowSize ?? 0.18) * scale : 0,
          landing: 0,
          gap: 0,
          ...(e.shaft === "curved" && { shaft: "curved" as const }),
        });

        return [
          {
            kind: "leader",
            ...penOf(e),
            ...named,
            style: name,
            at: e.points[e.points.length - 1]!,
            shafts: [e.points.slice(0, -1)],
          },
        ];
      }

      case "solid":
        return [
          {
            kind: "hatch",
            ...pen,
            ...named,
            loops: [
              {
                points: e.points.filter(
                  (p, i) => i === 0 || p[0] !== e.points[i - 1]![0] || p[1] !== e.points[i - 1]![1],
                ),
              },
            ],
          },
        ];
      case "image": {
        const [u, v] = [e.u, e.v];
        const across = Math.hypot(u[0], u[1]);
        const up = Math.hypot(v[0], v[1]);

        if (!(across > 0 && up > 0)) {
          count(notDrawn, "an image of no size");

          return [];
        }

        // A `Drawing`'s image is square, with its side to the left of its bottom. One the file
        // mirrors is drawn as such an image in a block of its own, placed mirrored.
        const cross = (u[0] * v[1] - u[1] * v[0]) / (across * up);
        const mirrored = cross < 0;

        if (Math.abs(Math.abs(cross) - 1) > 1e-9) count(approximate, "an image slanted");

        if ((e.brightness ?? 50) !== 50 || (e.contrast ?? 50) !== 50)
          count(approximate, "an image's brightness or contrast");
        const turn = Math.atan2(u[1], u[0]);
        const [cos, sin] = [Math.cos(turn), Math.sin(turn)];

        // From the world into the block: back from `at`, turned back, and mirrored up and down.
        const inBlock = (p: Point): Point => {
          const [x, y] = [p[0] - e.at[0], p[1] - e.at[1]];

          return [x * cos + y * sin, -(-x * sin + y * cos)];
        };

        const rotation = (turn * 180) / Math.PI;

        const image: Image = {
          kind: "image",
          ...pen,
          ...(!mirrored && named),
          path: e.path,
          pixels: e.pixels,
          at: mirrored ? [0, 0] : e.at,
          width: across * e.pixels[0],
          height: up * e.pixels[1],
          ...(!mirrored && rotation !== 0 && { rotation }),
          ...(e.clip !== undefined &&
            !e.unclipped && { clip: mirrored ? e.clip.map(inBlock) : e.clip }),
          ...(e.invertClip && { invertClip: true }),
          ...(e.transparent && { transparent: true }),
          ...(e.fade !== undefined && e.fade > 0 && { [IMAGE_FADE]: e.fade }),
        };

        // One the file hides, or whose definition is not loaded, shows its frame alone.
        const definition =
          handleOf(e.definition) === undefined ? undefined : definitions.get(e.definition!);

        const shown: Entity =
          e.hidden || definition?.loaded === false
            ? {
                kind: "polyline",
                ...pen,
                ...(!mirrored && named),
                points: imageFrame(image),
                closed: true,
              }
            : image;

        if (!mirrored) return [shown];
        const name = `${MADE}mirrored ${madeBlocks.length}`;
        madeBlocks.push({ name, entities: [shown] });

        return [
          {
            kind: "insert",
            layer: e.layer,
            ...(pen.color !== undefined && { color: pen.color }),
            ...(pen.transparency !== undefined && { transparency: pen.transparency }),
            ...named,
            block: name,
            at: e.at,
            scale: [1, -1],
            ...(rotation !== 0 && { rotation }),
          },
        ];
      }

      case "underlay": {
        const size = Object.hasOwn(pageSizes, e.path)
          ? Object.hasOwn(pageSizes[e.path]!, e.page)
            ? pageSizes[e.path]![e.page]
            : undefined
          : undefined;

        if (size === undefined) {
          count(notDrawn, "an underlay whose page's size is not given");

          return [];
        }

        // A `Drawing`'s underlay has one scale. One the file scales two ways is drawn at its
        // first in a block of its own, placed stretched by the second over the first.
        const [sx, sy] = e.scale;
        const stretched = sx !== sy && sx !== 0 && Number.isFinite(sy / sx);
        const turn = (e.rotation * Math.PI) / 180;
        const [cos, sin] = [Math.cos(turn), Math.sin(turn)];

        const inBlock = (p: Point): Point => {
          const [x, y] = [p[0] - e.at[0], p[1] - e.at[1]];

          return [x * cos + y * sin, ((-x * sin + y * cos) * sx) / sy];
        };

        const underlay: Entity = {
          kind: "underlay",
          ...pen,
          ...(!stretched && named),
          path: e.path,
          page: e.page,
          pageSize: size,
          at: stretched ? [0, 0] : e.at,
          scale: sx,
          ...(!stretched && e.rotation !== 0 && { rotation: e.rotation }),
          ...(e.clip !== undefined &&
            !e.unclipped && { clip: stretched ? e.clip.map(inBlock) : e.clip }),
          ...(e.invertClip && { invertClip: true }),
          ...(e.fade !== undefined && { fade: e.fade }),
          ...(e.contrast !== undefined && { contrast: e.contrast }),
          ...(e.monochrome && { monochrome: true }),
          ...(e.hidden && { on: false }),
        };

        if (!stretched) return [underlay];
        const name = `${MADE}stretched ${madeBlocks.length}`;
        madeBlocks.push({ name, entities: [underlay] });

        return [
          {
            kind: "insert",
            layer: e.layer,
            ...(pen.color !== undefined && { color: pen.color }),
            ...(pen.transparency !== undefined && { transparency: pen.transparency }),
            ...named,
            block: name,
            at: e.at,
            scale: [1, sy / sx],
            ...(e.rotation !== 0 && { rotation: e.rotation }),
          },
        ];
      }

      case "hatch":
        return [own(hatchOf(e, pen, named))];
      case "wipeout":
        return [{ kind: "wipeout", ...pen, ...named, points: e.points }];
      case "3dsolid":
      case "region":
      case "body":
        if (e.dataUnread) count(notDrawn, `a ${e.kind} whose data is not read`);
        else if (e.edgesUnread)
          count(approximate, `the edges of a ${e.kind} not read`, e.edgesUnread);

        return edgesInPlan(e).map((edge) => (id === undefined || !top ? edge : { ...edge, id }));
    }
  };

  const hatchOf = (e: ReadHatch, pen: ReturnType<typeof penOf>, named: { id?: string }): Entity => {
    // The leading CAD app fills by the parity of the loops its style counts.
    const loops = e.loops
      .filter((loop) => countedLoop(e.style, loop.flags))
      .map((loop) => ({
        points: loop.points,
        ...(loop.bulges !== undefined && { bulges: loop.bulges }),
      }));

    const shown =
      loops.length > 0
        ? loops
        : e.loops.map((l) => ({ points: l.points, ...(l.bulges && { bulges: l.bulges }) }));

    const base = { kind: "hatch" as const, ...pen, ...named, loops: shown };

    if (e.gradient !== undefined) {
      const name = e.gradient.name.toUpperCase();
      const inverted = name.startsWith("INV");
      const bare = (inverted ? name.slice(3) : name).toLowerCase();
      const kinds = ["linear", "cylinder", "spherical", "hemispherical", "curved"] as const;
      const known = kinds.find((k) => k === bare);
      const kind = known ?? "linear";

      if (known === undefined) count(approximate, "a gradient of a name tsdraft does not know");
      const rgb = (n: number) => [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
      const [a = 0x0000ff, b = 0xffffff] = e.gradient.colors;

      return {
        ...base,
        gradient: {
          name: inverted && kind !== "linear" ? (`inverted-${kind}` as const) : kind,
          ...(e.gradient.angle !== 0 && { angle: e.gradient.angle }),
          ...(!e.gradient.centered && { centered: false }),
          ...(e.gradient.tint !== undefined && e.gradient.colors.length < 2
            ? { color: rgb(a), tint: e.gradient.tint }
            : { colors: [rgb(a), rgb(b)] as const }),
        },
      };
    }

    if (e.solid || e.patternLines === undefined) return base;
    // The lines of its pattern, as the file holds them placed in the world, are the pattern.
    const name = `${MADE}pattern ${patterns.length}`;
    patterns.push({
      name,
      lines: e.patternLines.map((line) => {
        const t = (-line.angle * Math.PI) / 180;
        const [ox, oy] = line.offset;

        return {
          angle: line.angle,
          base: line.base,
          offset: [
            ox * Math.cos(t) - oy * Math.sin(t),
            ox * Math.sin(t) + oy * Math.cos(t),
          ] satisfies Point,
          ...(line.dashes !== undefined && { dashes: line.dashes }),
        };
      }),
    });

    return { ...base, pattern: { name } };
  };

  /** A space's entities in the order the leading CAD app draws them, and where each came from. */
  const space = (
    entities: readonly ReadEntity[] | undefined,
    order: readonly string[] | undefined,
    other: Readonly<Record<string, number>> | undefined,
  ): SpaceMade => {
    for (const [kind, n] of Object.entries(other ?? {})) count(notDrawn, kind, n);
    const list = entities ?? [];
    let indexes = list.map((_, i) => i);

    if (order !== undefined && order.length > 0) {
      const at = new Map<string, number>();
      list.forEach((e, i) => {
        const handle = handleOf(e.handle);

        if (handle !== undefined && !at.has(handle)) at.set(handle, i);
      });
      const placed = new Set<number>();
      const sorted: number[] = [];

      for (const handle of order) {
        const i = handleOf(handle) === undefined ? undefined : at.get(handle);

        if (i !== undefined && !placed.has(i)) {
          placed.add(i);
          sorted.push(i);
        }
      }

      indexes = [...sorted, ...indexes.filter((i) => !placed.has(i))];
    }

    const out: Entity[] = [];
    const sources: ReadSource[] = [];

    for (const i of indexes) {
      const e = list[i]!;
      const source: ReadSource = { index: i, ...(e.handle !== undefined && { handle: e.handle }) };
      const id = handleOf(e.handle);

      for (const made of entitiesOf(e, id, true)) {
        out.push(made);
        sources.push(source);
      }
    }

    return { entities: out, sources };
  };

  // The blocks of tables' pictures, whose paragraphs are the text of cells.
  const cellBlocks = new Set<string>();

  for (const list of [
    read.model.entities,
    ...read.layouts.map((l) => l.entities),
    ...read.blocks.map((b) => b.entities),
  ]) {
    for (const e of list ?? []) {
      if (e.kind === "table" && e.block !== undefined)
        cellBlocks.add(blockOf(e.block, e.blockHandle));
    }
  }

  const blocks: Block[] = read.blocks.map((block) => {
    const entities: Entity[] = [];
    let order = block.entities.map((_, i) => i);

    if (block.drawOrder !== undefined && block.drawOrder.length > 0) {
      const at = new Map<string, number>();
      block.entities.forEach((e, i) => {
        const handle = handleOf(e.handle);

        if (handle !== undefined && !at.has(handle)) at.set(handle, i);
      });
      const seen = new Set<number>();
      const sorted: number[] = [];

      for (const h of block.drawOrder) {
        const i = handleOf(h) === undefined ? undefined : at.get(h);

        if (i !== undefined && !seen.has(i)) {
          seen.add(i);
          sorted.push(i);
        }
      }

      order = [...sorted, ...order.filter((i) => !seen.has(i))];
    }

    const cells = cellBlocks.has(blockOf(block.name, block.handle));

    for (const i of order) {
      for (const made of entitiesOf(block.entities[i]!, undefined, false)) {
        entities.push(
          cells && made.kind === "paragraph" ? Object.assign(made, { [CELL_TEXT]: true }) : made,
        );
      }
    }

    for (const [kind, n] of Object.entries(block.other)) count(notDrawn, `${kind} in a block`, n);

    // A constant attribute draws in every insert; the others draw as each insert places them.
    for (const definition of block.attributeDefinitions) {
      if (!definition.constant || definition.invisible) continue;
      const value = definition.default ?? "";

      if (definition.paragraph !== undefined) {
        entities.push(paragraphOf(definition.paragraph, definition, value, undefined));
      } else {
        const text = drawnText(definition, value, undefined);

        if (text) entities.push(text);
      }
    }

    return {
      name: blockOf(block.name, block.handle),
      base: block.base,
      entities,
    };
  });

  const model = space(read.model.entities, read.model.drawOrder, read.model.other);
  const units = UNITS.get(read.header.insunits ?? 1) ?? "in";
  const layoutSources: ReadSource[][] = [];

  const layouts: Layout[] = read.layouts.map((layout) => {
    // A layout the read kept nothing of, as a read without geometry or one by other layouts
    // leaves it, is not read, which is not empty.
    if (layout.entities === undefined) count(notDrawn, "a layout the read did not read");
    const drawn = space(layout.entities, layout.drawOrder, layout.other);
    layoutSources.push(drawn.sources);

    return layoutOf(layout, drawn.entities, units, (what) => count(approximate, what));
  });

  // A multileader's block keeps its attribute definitions, whose values the leader sets.
  const readBlocks = new Map(read.blocks.map((b) => [blockOf(b.name, b.handle), b]));
  const builtBlocks = new Map(blocks.map((b) => [nameKey(b.name), b]));

  for (const { name, content } of contents.values()) {
    const block = builtBlocks.get(nameKey(name));
    const held = readBlocks.get(name);

    if (block === undefined || held === undefined) continue;

    const attributes = held.attributeDefinitions
      .filter((d) => !d.constant && !d.invisible)
      .map((d): AttributeDefinition => {
        if (d.paragraph !== undefined) {
          const p = paragraphOf(d.paragraph, d, d.default ?? "", undefined);

          if (p.kind === "paragraph") {
            const { kind: _kind, layer: _layer, value: _value, ...rest } = p;

            return {
              ...rest,
              kind: "paragraph",
              tag: d.tag,
              value: d.default ?? "",
              layer: d.layer,
            };
          }
        }

        const t = textOf(d, d.default ?? "", undefined)!;

        return {
          tag: d.tag,
          value: d.default ?? "",
          layer: d.layer,
          at: t.at,
          height: t.height,
          rotation: t.rotation,
          ...(t.style !== undefined && { style: t.style }),
          ...(t.align !== undefined && { align: t.align }),
          ...(t.valign !== undefined && { valign: t.valign }),
        };
      });

    madeBlocks.push({ ...block, name: content, attributes });
  }

  const allBlocks = new Map([...blocks, ...madeBlocks].map((b) => [nameKey(b.name), b]));

  for (const fit of fitted) fit((name) => allBlocks.get(nameKey(name)));

  const layers: Layer[] = read.layers.map((layer) => ({
    name: drawnName(layer.name),
    color: layer.color ?? 7,
    ...(layer.linetype !== undefined && { linetype: drawnName(layer.linetype) }),
    ...(layer.lineweight !== undefined &&
      layer.lineweight >= 0 && { lineweight: layer.lineweight / 100 }),
    ...(!layer.on && { off: true }),
    ...(layer.frozen && { frozen: true }),
    ...(!layer.plot && { plot: false }),
    ...(layer.trueColor !== undefined && { [LAYER_TRUE_COLOR]: layer.trueColor }),
  }));

  const linetypes: Linetype[] = read.linetypes.map((linetype) => ({
    name: drawnName(linetype.name),
    description: linetype.description ?? "",
    pattern: linetype.pattern,
    ...(linetype.marks !== undefined && {
      marks: linetype.marks.map((mark): LinetypeMark =>
        "text" in mark
          ? {
              after: mark.after,
              ...(mark.rotation !== undefined && { rotation: mark.rotation }),
              ...(mark.orient !== undefined && { orient: mark.orient }),
              ...(mark.offset !== undefined && { offset: mark.offset }),
              text: mark.text,
              style: drawnName(mark.style),
              height: mark.height,
            }
          : {
              after: mark.after,
              ...(mark.rotation !== undefined && { rotation: mark.rotation }),
              ...(mark.orient !== undefined && { orient: mark.orient }),
              ...(mark.offset !== undefined && { offset: mark.offset }),
              glyph: mark.glyph,
              file: mark.file,
              scale: mark.scale,
            },
      ),
    }),
  }));

  // An xref with no read given draws nothing where it is placed.
  for (const xref of read.xrefs) {
    if ((!nested || !xref.overlay) && !Object.hasOwn(options.xrefs ?? {}, xref.name)) {
      count(notDrawn, "an xref whose drawing is not given");
    }
  }

  // Each xref given, with its layers as the host holds them.
  const xrefs: Record<
    string,
    | Drawing
    | { drawing: Drawing; xrefs?: XrefDrawings; images?: Readonly<Record<string, Uint8Array>> }
  > = {};

  // An xref's overlays are not loaded where the xref is: only its attachments are drawn.
  const listed = new Set(
    read.xrefs.filter((x) => !nested || !x.overlay).map((x) => nameKey(x.name)),
  );

  for (const [name, given] of Object.entries(options.xrefs ?? {})) {
    // Only the xrefs the file lists are drawn, as the leading CAD app loads them.
    if (!isObjectOrArray(given) || !listed.has(nameKey(name))) continue;

    // SAFETY: an xref given with no `read` of its own is given as its read alone.
    const { read: of, xrefs: below } =
      "read" in given && isObjectOrArray(given.read) && "format" in given.read
        ? given
        : { read: given as DrawingRead, xrefs: undefined };

    // An xref that holds itself draws nothing the second time, as the leading CAD app draws it;
    // one many hold is converted once.
    if (walk.open.has(given)) {
      count(notDrawn, "an xref that holds itself");
      walk.cuts++;
      continue;
    }

    let made = walk.made.get(given);

    if (made === undefined) {
      if (++walk.count > XREFS_MADE) {
        count(notDrawn, "an xref past the most a picture converts");
        continue;
      }

      walk.open.add(given);
      const cuts = walk.cuts;
      // An entity of an xref keeps its handle in the xref's file.
      made = drawingOf(
        of,
        { pageSizes, ...(below !== undefined && { xrefs: below }) },
        handles,
        walk,
        true,
      );
      walk.open.delete(given);

      // One that cut a cycle is drawn again where it is reached another way.
      if (walk.cuts === cuts) walk.made.set(given, made);
    }

    // What the xref's picture could not draw is the host's to say.
    for (const [what, n] of Object.entries(made.notes.notDrawn)) count(notDrawn, what, n);

    for (const [what, n] of Object.entries(made.notes.approximate)) count(approximate, what, n);

    for (const font of made.notes.fonts) {
      if (!fonts.some((f) => f.style === font.style && f.font === font.font)) fonts.push(font);
    }

    const prefix = nameKey(`${name}|`);
    const host = new Map<string, (typeof read.layers)[number]>();

    for (const layer of read.layers) {
      const key = nameKey(layer.name);

      if (key.startsWith(prefix)) host.set(key.slice(prefix.length), layer);
    }

    const layered: Drawing = {
      ...made.drawing,
      layers: made.drawing.layers.map((layer) => {
        const held = host.get(nameKey(layer.name));

        if (held === undefined) return layer;
        const { off: _off, frozen: _frozen, plot: _plot, ...rest } = layer;

        // The host's color wins, its true color with it.
        const trueColor =
          held.color !== undefined || held.trueColor !== undefined
            ? held.trueColor
            : // SAFETY: the xref's drawing is the picture's own, which sets `LAYER_TRUE_COLOR` on a
              // layer of a true color.
              (layer as { [LAYER_TRUE_COLOR]?: number })[LAYER_TRUE_COLOR];

        return {
          ...rest,
          [LAYER_TRUE_COLOR]: trueColor,
          color: held.color ?? layer.color,
          ...(held.linetype !== undefined && { linetype: held.linetype.replace(/^.*\|/, "") }),
          ...(held.lineweight !== undefined &&
            held.lineweight >= 0 && { lineweight: held.lineweight / 100 }),
          ...(!held.on && { off: true }),
          ...(held.frozen && { frozen: true }),
          ...(!held.plot && { plot: false }),
        };
      }),
    };

    // Its sources go with it, so its picture keeps a fragment for each of its entities.
    Object.assign(layered, { [READ_SOURCES]: made.sources });
    const images = "read" in given && "images" in given ? given.images : undefined;
    xrefs[drawnName(name)] =
      Object.keys(made.xrefs).length > 0 || images !== undefined
        ? {
            drawing: layered,
            ...(Object.keys(made.xrefs).length > 0 && { xrefs: made.xrefs }),
            ...(images !== undefined && { images }),
          }
        : layered;
  }

  const header = read.header;

  const drawing: Drawing = {
    format: 0,
    units,
    dxf: "R2018",
    layers,
    entities: model.entities,
    linetypes,
    ...(header.ltscale !== undefined && { linetypeScale: header.ltscale }),
    textStyles: [...textStyles.values()],
    blocks: [...blocks, ...madeBlocks],
    xrefs: read.xrefs.map((x) => ({ name: drawnName(x.name), path: x.path, attach: !x.overlay })),
    layouts,
    leaderStyles,
    patterns,
    ...(read.underlayFrame !== undefined && { underlayFrame: read.underlayFrame }),
    ...(header.wipeoutFrame !== undefined && { wipeoutFrame: header.wipeoutFrame !== 0 }),
    ...((header.pdmode !== undefined || header.pdsize !== undefined) && {
      pointStyle: pointStyleOf(header.pdmode, header.pdsize),
    }),
    ...(header.psltscale === 0 && { [MODEL_DASHES]: true }),
  };

  return {
    drawing,
    sources: { model: model.sources, layouts: layoutSources },
    notes: { fonts, notDrawn, approximate },
    handles,
    xrefs,
  };
}

/** A read layout as a `Drawing`'s, on its own paper. */
function layoutOf(
  layout: ReadLayout,
  entities: Entity[],
  units: Units,
  approximate: (what: string) => void,
): Layout {
  const paper = paperOf(layout);

  const viewports = layout.viewports
    .filter((v) => v.on)
    .flatMap((v): Viewport[] => {
      if (v.turnedView) {
        approximate("a viewport that looks along another direction");
      }

      const view = viewportOf(v, paper, units);

      return view === undefined ? [] : [view];
    });

  const table =
    layout.plotStyleTable === undefined || layout.plotStyleTable === ""
      ? "acad.ctb"
      : PLOT_STYLE_TABLES.find((t) => t.toLowerCase() === layout.plotStyleTable!.toLowerCase());

  if (table === undefined) approximate("a plot style table tsdraft does not have");

  // SAFETY: a paper not of `PAPERS` is the read's own, which `READ_PAPER` gives `svgWithin`.
  return {
    name: layout.name,
    paper: paper.name,
    plotStyle: table ?? "monochrome.ctb",
    viewports,
    entities,
    [READ_PAPER]: paper.info,
  } as Layout;
}

/** A paper of a read layout: the name a `Layout` gives it, and its size and medium. */
interface ReadPaper {
  readonly name: string;
  readonly info: PaperInfo;
}

/**
 * Whether the leading CAD app fills by a loop of a hatch of a style: by every loop, by the outer
 * ones and the outermost, or by the outermost alone.
 */
function countedLoop(style: ReadHatch["style"], flags: number): boolean {
  switch (style) {
    case "normal":
      return true;
    case "outer":
      return (flags & 17) !== 0;
    default:
      return (flags & 1) !== 0;
  }
}

/** The entities a space of the read makes, and the source in the read of each. */
interface SpaceMade {
  entities: Entity[];
  sources: ReadSource[];
}

/** The paper of a read layout: one of `PAPERS` where its media is one's, else its own size. */
function paperOf(layout: ReadLayout): ReadPaper {
  const units = layout.paperUnits === 1 ? "mm" : "in";

  // A paper of `PAPERS` where the page setup names its media in its units.
  const known = Object.entries(PAPERS).find(
    ([, info]) => info.media === layout.media && info.units === units,
  );

  if (known !== undefined) return { name: known[0], info: paperInfo(known[0])! };
  const [w, h] = layout.paperSize ?? [279.4, 215.9];
  const per = units === "mm" ? 1 : 1 / 25.4;
  const turned = layout.plotRotation % 2 === 1;
  const [width, height] = turned ? [h * per, w * per] : [w * per, h * per];

  return {
    name: layout.media ?? "",
    info: {
      media: layout.media ?? "",
      units,
      width,
      height,
      medium: { width: w * per, height: h * per, rotation: turned ? 1 : 0 },
      printable: [0, 0, width, height],
    },
  };
}

/** A read viewport as a `Drawing`'s: its ratio in model units to a paper unit. */
function viewportOf(
  v: ReadViewport,
  paper: { info: PaperInfo },
  units: Units,
): Viewport | undefined {
  if (!(v.ratio > 0) || !(v.width > 0) || !(v.height > 0)) return undefined;
  // `modelLength` is in proportion to the ratio, so one unit of ratio gives the factor.
  const one = modelLength(v.height, paper.info.units, 1, units);

  if (!(one > 0)) return undefined;
  const ratio = v.height / v.ratio / one;
  const twist = ((v.twist % 360) + 360) % 360;

  return {
    ...(v.handle !== undefined && { id: `vp${v.handle}` }),
    layer: drawnName(v.layer),
    corner: [v.center[0] - v.width / 2, v.center[1] - v.height / 2],
    width: v.width,
    height: v.height,
    center: v.viewCenter,
    ratio,
    ...(v.frozenLayers.length > 0 && { frozenLayers: v.frozenLayers.map(drawnName) }),
    ...(twist !== 0 && { twist: twist > 180 ? twist - 360 : twist }),
  };
}

/** True for a font of `FONTS`. */
export const isKnownFont = (font: string): boolean => Object.hasOwn(FONTS, font);
