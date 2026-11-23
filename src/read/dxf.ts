// `readDXF`: the read model of an ASCII DXF, read as its bytes arrive. It keeps the tables, the
// blocks, the xrefs, the layouts and the fields, counts what each space draws and, when asked,
// keeps what each space draws.
import type { Point } from "../drawing.ts";
import { nearestFont, type Font } from "../fonts.ts";
import { isString } from "../guards.ts";
import { layerKey } from "../layers.ts";
import { layoutText } from "../measure.ts";
import { DxfDocumentReader, type DxfDocument } from "./document.ts";
import {
  attributeCost,
  attributeOf,
  attributeParts,
  baseOf,
  brokenNumber,
  costOf,
  handleAt,
  imageInWorld,
  underlayInWorld,
  MAX_TAGS,
  nameCost,
  placementOf,
  readingOf,
  sidesOf,
  type LeaderNames,
  type Later,
  type PendingStart,
} from "./entities.ts";
import { GroupReader, textTwice, unescaped } from "./groups.ts";
import { MARK_APP, recordAdditions } from "./mark.ts";
import { TableGroups, tableStyleOf, type TableStyleHeld } from "./table.ts";
import { OUTSIDE_THE_READ, ownBlocks, partFilter, type PartFilter } from "./part.ts";
import {
  add,
  facing,
  first,
  inGroup,
  inSubclass,
  map,
  name,
  num,
  ownerOf,
  placed,
  point,
  xdata,
  type Facing,
  type Rec,
} from "./records.ts";
import {
  BLOCK_ITEMS,
  CENSUS_LIMIT,
  GEOMETRY_ITEMS,
  READ_FORMAT,
  type DrawingRead,
  type ReadAttribute,
  type ReadAttributeDefinition,
  type ReadBlock,
  type ReadCensus,
  type ReadCensusDimension,
  type ReadCensusInsert,
  type ReadCensusText,
  type ReadDimensionStyle,
  type ReadUnreadEntity,
  type ReadEntity,
  type ReadEntityBase,
  type ReadField,
  type ReadHeader,
  type ReadImage,
  type ReadImageDefinition,
  type ReadUnderlay,
  type ReadUnderlayDefinition,
  type ReadInsert,
  type ReadLayer,
  type ReadLayerCensus,
  type ReadLayout,
  type ReadLeaderStyle,
  type ReadLinetype,
  type ReadLinetypeMark,
  type ReadMultileader,
  type ReadOptions,
  type ReadTable,
  type ReadTableStyle,
  type ReadTextStyle,
  type ReadView,
  type ReadViewport,
  type ReadXref,
} from "./model.ts";

/**
 * Reads an ASCII DXF of any version: from a string, from its bytes, or from its bytes as they
 * arrive. Given a stream, it never holds the whole file, but for a read with `only`, which reads the file twice and holds a copy of
 * a stream's bytes for the second pass. It throws a `ReadError` for a file it cannot read at all,
 * such as a binary DXF or one whose groups are out of step, and reads everything else, counting
 * what it did not understand. With `geometry`, it keeps what model space and each layout draws
 * too, and with `only` what the layouts and areas it names show.
 */
export function readDXF(
  input: string | Uint8Array | AsyncIterable<Uint8Array>,
  options: ReadOptions = {},
): Promise<DrawingRead> {
  return readDXFWithin(input, options, READ_LIMITS);
}

/** The read of a DXF held whole, in the caller's turn: what an edit reads of its additions. */
export function readDXFNow(input: string | Uint8Array, options: ReadOptions = {}): DrawingRead {
  return once(input, options, READ_LIMITS, undefined).read;
}

/** The most a read keeps of each list, which `readDXFWithin` takes so a test can reach each. */
export interface ReadLimits {
  /** The most texts, dimensions, inserts and viewports a space lists, and fields in all. */
  readonly census: number;
  /** The most items the blocks keep in all. */
  readonly blockItems: number;
  /** The most items what the spaces draw keeps in all. */
  readonly geometryItems: number;
}

export const READ_LIMITS: ReadLimits = {
  census: CENSUS_LIMIT,
  blockItems: BLOCK_ITEMS,
  geometryItems: GEOMETRY_ITEMS,
};

/**
 * `readDXF` within the limits given. Bytes given as one `Uint8Array` are read before it
 * returns, so the whole read runs in the caller's turn.
 */
export async function readDXFWithin(
  input: string | AsyncIterable<Uint8Array> | Uint8Array,
  options: ReadOptions,
  limits: ReadLimits,
): Promise<DrawingRead> {
  return (await reading(input, options, limits, undefined)).read;
}

/**
 * The read of a file given as bytes, and its document: where each record of the file is, which
 * the read's handles name.
 */
export async function readDXFDocument(
  input: AsyncIterable<Uint8Array> | Uint8Array,
  options: ReadOptions = {},
): Promise<{ readonly read: DrawingRead; readonly document: DxfDocument }> {
  const document = new DxfDocumentReader();
  const { read } = await reading(input, options, READ_LIMITS, document);

  return { read, document: document.end() };
}

async function reading(
  input: string | AsyncIterable<Uint8Array> | Uint8Array,
  options: ReadOptions,
  limits: ReadLimits,
  document: DxfDocumentReader | undefined,
): Promise<{ read: DrawingRead }> {
  const part = options.geometry === true && options.only !== undefined;

  // Bytes or a string are read in the caller's turn, with no wait between the passes.
  if (isString(input) || input instanceof Uint8Array)
    return {
      read: part
        ? byPart(input, options, limits, document)
        : once(input, options, limits, document).read,
    };

  if (!part) {
    const fed = feeder(options, limits, document);

    for await (const chunk of input) fed.push(chunk);

    return { read: fed.end().read };
  }

  // The first pass reads the stream as it arrives, and a copy of each piece is held for the
  // second, since a stream may hand the same buffer over again.
  const fed = feeder(firstPass(options), limits, undefined);
  const chunks: Uint8Array[] = [];

  for await (const chunk of input) {
    // A copy of its own, since a Node buffer's `slice` shares its memory, and the first pass may
    // hold a piece until the next arrives.
    const copy = new Uint8Array(chunk);
    fed.push(copy);
    chunks.push(copy);
  }

  return { read: second(fed.end(), chunks, options, limits, document) };
}

/**
 * A read with `only`. A DXF lists its layouts after the entities of model space, so the file is
 * read once for its layouts and blocks, and then again keeping what they show.
 */
function byPart(
  input: string | Uint8Array,
  options: ReadOptions,
  limits: ReadLimits,
  document: DxfDocumentReader | undefined,
): DrawingRead {
  return second(
    once(input, firstPass(options), limits, undefined),
    input,
    options,
    limits,
    document,
  );
}

/** The options of the first pass of a read with `only`: no geometry, and the blocks named. */
const firstPass = (options: ReadOptions): ReadOptions => ({
  geometry: false,
  ...(options.blocks !== undefined && { blocks: options.blocks }),
});

/** The second pass of a read with `only`, from the first's read and reader. */
function second(
  first: Reading,
  input: string | Uint8Array | readonly Uint8Array[],
  options: ReadOptions,
  limits: ReadLimits,
  document: DxfDocumentReader | undefined,
): DrawingRead {
  // The leading CAD app's DXF numbers a layout's own view of its paper 1 only on the layout it
  // opens on, so the first viewport of each other paper space, its own, is no window.
  const own = first.reader.ownViewports;

  const read = {
    ...first.read,
    layouts: first.read.layouts.map((l) => ({
      ...l,
      viewports: l.viewports.filter((v) => v.handle === undefined || !own.has(v.handle)),
    })),
  };

  const filter = partFilter(read, options.only!);
  const papers = new Set<string>();

  for (const [name, space] of first.reader.layoutSpaces)
    if (filter.keepsLayout(name)) papers.add(space);

  return once(input, options, limits, document, { filter, papers }).read;
}

/** One reading of a file held whole, from start to end. */
function once(
  input: string | Uint8Array | readonly Uint8Array[],
  options: ReadOptions,
  limits: ReadLimits,
  document: DxfDocumentReader | undefined,
  part?: PartKept,
): Reading {
  const fed = feeder(options, limits, document, part, isString(input));

  if (isString(input)) {
    // A string is text already: its UTF-8 bytes are read, whatever its header says.
    const encoder = new TextEncoder();

    for (let i = 0; i < input.length;) {
      let end = Math.min(i + (1 << 20), input.length);
      // A piece never ends between the two halves of a surrogate pair.
      const last = input.charCodeAt(end - 1);

      if (end < input.length && last >= 0xd800 && last <= 0xdbff) end--;
      fed.push(encoder.encode(input.slice(i, end)));
      i = end;
    }
  } else if (input instanceof Uint8Array) fed.push(input);
  else for (const chunk of input) fed.push(chunk);

  return fed.end();
}

/** A read of a file and the reader that made it, which a second pass of `only` asks again. */
interface Reading {
  readonly read: DrawingRead;
  readonly reader: DxfReader;
}

/** What takes the bytes of a file a piece at a time, and gives the read once they end. */
interface Feeder {
  push(chunk: Uint8Array): void;
  end(): Reading;
}

/** A reader fed the bytes of a file a piece at a time, and the read once they end. */
function feeder(
  options: ReadOptions,
  limits: ReadLimits,
  document: DxfDocumentReader | undefined,
  part?: PartKept,
  text = false,
): Feeder {
  const reader = new DxfReader(options, limits, part);
  const groups = new GroupReader((code, value) => reader.group(code, value), text);

  return {
    push(chunk) {
      document?.push(chunk);
      groups.push(chunk);
    },
    end() {
      const { sha256, bytes } = groups.end();

      return { read: reader.finish(sha256, bytes, groups), reader };
    },
  };
}

/** Groups no reading needs and that can be long: binary data, and long xdata strings. */
const DROPPED = new Set([310, 311, 1004]);

/** The most fields the walks from every MTEXT look at in all. */
const FIELD_WORK = 1_000_000;

/** The most heights of one MTEXT's text that are kept. */
const MAX_INLINE_HEIGHTS = 64;

/** The most groups one record keeps. */
const MAX_GROUPS = 1_000_000;

const ALL: ReadonlySet<number> = new Set();
const NOTHING: ReadonlySet<number> = new Set();

/** What the census of a space reads of an entity it only counts. */
// 102 too, so that the owner is told from the handles of an application's group.
const CENSUS: ReadonlySet<number> = new Set([5, 6, 8, 60, 62, 67, 102, 330, 370, 420]);

/** What a block reads of an entity of a kind it counts: whether it shows. */
const VISIBILITY: ReadonlySet<number> = new Set([60]);

/** The kinds a block's definition reads whole, and a space's with `geometry`. */
const BLOCK_READS = new Set([
  "3DSOLID",
  "ACAD_TABLE",
  "ARC",
  "ATTDEF",
  "ATTRIB",
  "BODY",
  "CIRCLE",
  "DIMENSION",
  "ELLIPSE",
  "HATCH",
  "IMAGE",
  "INSERT",
  "LARGE_RADIAL_DIMENSION",
  "ARC_DIMENSION",
  "LEADER",
  "LINE",
  "LWPOLYLINE",
  "MTEXT",
  "MULTILEADER",
  "PDFUNDERLAY",
  "POINT",
  "POLYLINE",
  "REGION",
  "SEQEND",
  "SOLID",
  "SPLINE",
  "TEXT",
  "VERTEX",
  "VIEWPORT",
  "WIPEOUT",
]);

/** The kinds a space reads whole without `geometry`. */
const SPACE_READS = new Set([
  "ATTRIB",
  "DIMENSION",
  "IMAGE",
  "INSERT",
  "LARGE_RADIAL_DIMENSION",
  "ARC_DIMENSION",
  "MTEXT",
  "PDFUNDERLAY",
  "POLYLINE",
  "SEQEND",
  "TEXT",
  "VIEWPORT",
]);

const HANDLE = /^[0-9A-Fa-f]{1,16}$/;

/** Two handles' order as numbers: by their digits once leading zeros are left out. */
function handleOrder(a: string, b: string): number {
  const [x, y] = [a.replace(/^0+/, ""), b.replace(/^0+/, "")];

  return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0);
}

/**
 * The handles of a space's entities in the order the leading CAD app draws them by its sort table:
 * by each one's sort handle, or its own where the table gives none, and in the order of the file
 * between two of one sort handle.
 */
function sortedOrder(
  entities: readonly ReadEntity[],
  table: ReadonlyMap<string, string>,
): readonly string[] {
  const keyed: { handle: string; sort: string; at: number }[] = [];
  entities.forEach((e, at) => {
    if (e.handle === undefined) return;
    const own = e.handle.toUpperCase();
    keyed.push({ handle: e.handle, sort: table.get(own) ?? own, at });
  });
  keyed.sort((a, b) => handleOrder(a.sort, b.sort) || a.at - b.at);

  return keyed.map((k) => k.handle);
}

/** Object kinds every file holds and that say nothing the read model keeps. */
const HOUSEKEEPING = new Set([
  "ACDBDETAILVIEWSTYLE",
  "ACDBDICTIONARYWDFLT",
  "ACDBPLACEHOLDER",
  "ACDBSECTIONVIEWSTYLE",
  "CELLSTYLEMAP",
  "DICTIONARYVAR",
  "FIELDLIST",
  "IMAGEDEF_REACTOR",
  "MATERIAL",
  "MLEADERSTYLE",
  "MLINESTYLE",
  "PLOTSETTINGS",
  "RASTERVARIABLES",
  "SCALE",
  "SUN",
  "TABLECONTENT",
  "TABLEGEOMETRY",
  "VISUALSTYLE",
  "WIPEOUTVARIABLES",
  "XRECORD",
]);

/** The entity kinds the reader reads, and the records that belong to one of them. */
const READ_ENTITIES = BLOCK_READS;

/** Whether xdata of `AcadAnnotative` marks the object annotative. */
function annotative(r: Rec): boolean {
  const data = xdata(r, "AcadAnnotative");
  const flags = data.values.filter((_, i) => data.codes[i] === 1070);

  return flags[1]?.trim() === "1";
}

/** The heights an MTEXT's text sets with `\H`, from the height the MTEXT starts at. */
export function inlineHeights(text: string, height: number): number[] {
  const out: number[] = [];
  let current = height;
  // A `{` opens a scope whose formats a `}` ends; `\\`, `\{` and `\}` are characters.
  const outer: number[] = [];

  for (const match of text.matchAll(/\\[\\{}]|\{|\}|\\H([0-9.+\-eE]+)(x?);/g)) {
    const token = match[0];

    if (token === "{") outer.push(current);
    else if (token === "}") current = outer.pop() ?? current;
    else if (match[1] !== undefined) {
      const n = Number(match[1]);
      const next = match[2] ? current * n : n;

      if (!Number.isFinite(next) || next <= 0) continue;
      current = next;
      out.push(current);

      if (out.length >= MAX_INLINE_HEIGHTS) break;
    }
  }

  return out;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** A dimension style as it is read, before the text style and the block it names are known. */
type DimensionStyleDraft = Mutable<ReadDimensionStyle> & {
  textStyleHandle?: string;
  arrowheadHandle?: string;
};

/** Fields of a dimension style a DXF leaves out at their default, with their group and default. */
const DIMENSION_DEFAULTS: readonly (readonly [DimensionNumber, number, number])[] = [
  ["extensionOffset", 42, 0.0625],
  ["extensionBeyond", 44, 0.18],
  ["textGap", 147, 0.09],
  ["lineExtension", 46, 0],
  ["zeros", 78, 0],
  ["textLevelInside", 73, 1],
  ["textLevelOutside", 74, 1],
  ["lineInside", 172, 0],
];

/** The fields of a dimension style that hold a number. */
type DimensionNumber = {
  [K in keyof ReadDimensionStyle]-?: NonNullable<ReadDimensionStyle[K]> extends number ? K : never;
}[keyof ReadDimensionStyle];

interface LayerRow extends Mutable<ReadLayerCensus> {
  kinds: Record<string, number>;
  lineweights: Record<string, number>;
}

class Census {
  readonly layers: Record<string, LayerRow> = map();
  readonly texts: ReadCensusText[] = [];
  readonly dimensions: ReadCensusDimension[] = [];
  readonly inserts: ReadCensusInsert[] = [];
  readonly counts = { texts: 0, dimensions: 0, inserts: 0 };
  capped = false;
  readonly #limit: number;

  constructor(limit: number) {
    this.#limit = limit;
  }

  count(r: Rec, layer: string): void {
    let row = this.layers[layer];

    if (!row) {
      row = { kinds: map(), ownColor: 0, ownLinetype: 0, ownLineweight: 0, lineweights: map() };
      this.layers[layer] = row;
    }

    add(row.kinds, r.type);
    const color = num(r, 62);

    if ((color !== undefined && color !== 256) || first(r, 420) !== undefined) row.ownColor++;
    const linetype = first(r, 6);

    if (linetype !== undefined && linetype.trim().toUpperCase() !== "BYLAYER") row.ownLinetype++;
    const weight = num(r, 370);

    if (weight !== undefined && weight !== -1) {
      row.ownLineweight++;
      add(row.lineweights, String(weight));
    }
  }

  list<T>(items: T[], kind: keyof Census["counts"], item: () => T): void {
    this.counts[kind]++;

    if (items.length < this.#limit) items.push(item());
    else this.capped = true;
  }

  done(): ReadCensus {
    return {
      layers: this.layers,
      texts: this.texts,
      dimensions: this.dimensions,
      inserts: this.inserts,
      counts: this.counts,
      capped: this.capped,
    };
  }
}

/** What a read with `only` keeps: the filter of model space, and the paper spaces, by their blocks in capitals. */
interface PartKept {
  readonly filter: PartFilter;
  readonly papers: ReadonlySet<string>;
}

/** Where the entities a reading keeps go: a block's definition, or a space read with geometry. */
interface Target {
  entities: ReadEntity[];
  other: Record<string, number>;
  /** True for a block, whose items count against `blockItems`. */
  block: boolean;
  /** True for a block `ReadOptions.blocks` names, which keeps its items in a room of its own. */
  ownRoom?: boolean;
}

/** What a space holds while the reader is in it. */
interface Space extends Target {
  census: Census;
  unread: ReadUnreadEntity[];
  viewports: (ReadViewport & { id: number | undefined })[];
  inserts: ReadInsert[];
}

/** A space's target, as a block's is not. */
const isSpace = (target: Target): target is Space => !target.block;

interface BlockDraft extends Target {
  handle: string | undefined;
  name: string;
  base: Point;
  anonymous: boolean;
  attributeDefinitions: ReadAttributeDefinition[];
}

interface PendingMtext {
  handle: string | undefined;
  dictionary: string;
  at: Point;
  height: number;
  width: number;
  layer: string;
  space: string | undefined;
  block: string | undefined;
}

interface LayoutDraft {
  /** The space's block in capitals, for a layout no LAYOUT object states. */
  space?: string;
  handle: string | undefined;
  name: string;
  tab: number;
  blockRecord: string | undefined;
  media?: string;
  plotter?: string;
  paperSize?: readonly [number, number];
  paperUnits?: number;
  plotScale?: number;
  plotStyleTable?: string;
  plotRotation: number;
}

const MODEL = "*MODEL_SPACE";

/** The header variables the read model holds, and the one that says which tab a file opens on. */
const HEADER = new Set([
  "$INSUNITS",
  "$MEASUREMENT",
  "$LTSCALE",
  "$PSLTSCALE",
  "$MSLTSCALE",
  "$DIMSCALE",
  "$PDMODE",
  "$PDSIZE",
  "$DIMSTYLE",
  "$TEXTSTYLE",
  "$CLAYER",
  "$TILEMODE",
  "$ACADVER",
  "$HANDSEED",
]);

/** An insert whose attributes follow it, up to its `SEQEND`. */
interface InsertOwner {
  readonly kind: "insert";
  readonly insert: ReadInsert & { tags: Record<string, boolean> };
  /** Whether a space's census and its list of inserts list it. */
  readonly place: boolean;
  /** Whether its target keeps it. */
  readonly keep: boolean;
  /** How many tags it has, and its attributes when the read keeps them. */
  tags: number;
  readonly attributes: ReadAttribute[] | undefined;
  /** What it costs so far, and whether its attributes went past what its target may keep. */
  cost: number;
  over: boolean;
  /** The starts its attributes leave to work out, once it is kept. */
  readonly starts: PendingStart[];
  /** Its extension dictionary, which may hold its clip. */
  readonly dictionary: string | undefined;
}

/** A multileader whose styles and block are named by handle, until the file is read. */
interface PendingLeader extends LeaderNames {
  readonly entity: ReadMultileader;
  /** Where it was kept, which its names are charged to. */
  readonly target?: Target;
}

/** A table whose style is named by handle, until the file is read. */
interface PendingTable {
  readonly entity: ReadTable;
  readonly target: Target;
  readonly style: string | undefined;
  readonly noTitle: boolean | undefined;
  readonly noHeader: boolean | undefined;
}

/** A polyline whose vertices follow it, up to its `SEQEND`. */
interface PolylineOwner {
  readonly kind: "polyline";
  readonly rec: Rec;
  points: Point[];
  /** The bulge and the widths each vertex gives the side from it to the next. */
  bulges: number[];
  widths: [number, number][];
  /** The widths of a vertex that gives none, the polyline's own. */
  readonly widthsAt: readonly [number, number];
  over: boolean;
  broken: boolean;
  readonly face: Facing;
}

/** The longest name a map of the file's names is keyed by: the most a DXF string holds. */
const LONGEST_NAME = 2049;

/** What one record leaves to work out at the end, until it is kept. */
interface Staged {
  starts: PendingStart[];
  leaders: PendingLeader[];
}

/**
 * True for an entity the file marks invisible, group 60, which draws nothing. A dynamic block's
 * record holds the entities of every state, with those of the states it does not show marked so.
 */
const hidden = (r: Rec): boolean => num(r, 60) === 1;

class DxfReader {
  #section = "";
  #variable = "";
  #rec: Rec | undefined;
  readonly #geometry: boolean;
  readonly #limits: ReadLimits;
  /** With `only`: what model space keeps, and the paper spaces kept, by their blocks in capitals. */
  readonly #part: PartKept | undefined;
  /** Each layout's space, by its block in capitals, keyed by the layout's name. */
  readonly layoutSpaces = new Map<string, string>();
  /** The handle of each paper space's first viewport where the file does not number it 1. */
  readonly ownViewports = new Set<string>();

  readonly header: Record<string, string> = map();
  readonly layers: ReadLayer[] = [];
  readonly linetypes: ReadLinetype[] = [];
  /** The marks of each linetype that has them, by its index, whose styles are named last. */
  readonly #marked: [number, PendingMark[]][] = [];
  /** Each style's name and file, by its handle, for the marks of linetypes. */
  readonly #stylesByHandle = new Map<string, { name: string; file: string; height: number }>();
  readonly textStyles: ReadTextStyle[] = [];
  readonly dimensionStyles: DimensionStyleDraft[] = [];
  /** Each block record's name, by its handle. */
  readonly blockRecords = new Map<string, string>();
  readonly blocks: BlockDraft[] = [];
  readonly xrefs: ReadXref[] = [];
  readonly spaces = new Map<string, Space>();
  readonly layouts: LayoutDraft[] = [];
  readonly mtexts: PendingMtext[] = [];
  /**
   * The entries `ACAD_FIELD`, `TEXT`, `ACAD_FILTER` and `SPATIAL` of each dictionary that has one,
   * by its handle.
   */
  readonly dictionaries = new Map<string, Record<string, string>>();
  /** Each insert with an extension dictionary, which may hold its clip. */
  readonly #clipped: { insert: { clip?: ReadInsert["clip"] }; dictionary: string }[] = [];
  /** The outline of each spatial filter, in its block's coordinates, by its handle. */
  readonly #spatialFilters = new Map<string, Point[]>();

  readonly fieldObjects = new Map<
    string,
    { evaluator: string; code: string; children: string[] }
  >();
  /** The dictionary of leader styles, which the root dictionary names. */
  #leaderStyleDictionary: string | undefined;
  /** Each leader style's name, by its handle. */
  readonly leaderStyles = new Map<string, string>();
  /** The dictionary `TSDRAFT` of the named object dictionary, its entries, and their records. */
  #editDictionary: string | undefined;
  #rootDictionary: string | undefined;
  readonly #editEntries: (readonly [name: string, handle: string])[] = [];
  readonly #editRecords = new Map<string, ReturnType<typeof recordAdditions>>();
  /** Each multileader style's sizes, by its handle, and the handles of what it names. */
  readonly #leaderStyleObjects = new Map<
    string,
    {
      readonly textStyleHandle: string | undefined;
      readonly arrowheadHandle: string | undefined;
      readonly style: Omit<ReadLeaderStyle, "handle" | "name" | "textStyle" | "arrowheadBlock">;
    }
  >();
  /** The dictionary of table styles, which the root dictionary names, and its entries in its order. */
  #tableStyleDictionary: string | undefined;
  readonly #tableStyleEntries: (readonly [name: string, handle: string])[] = [];
  /** Each table style read, by its handle in capitals. */
  readonly #tableStyleObjects = new Map<string, TableStyleHeld>();
  /** The groups of the table read now, from its `AcDbTable` on, and whether they have begun. */
  #table: TableGroups | undefined;
  #inTable = false;
  readonly #tables: PendingTable[] = [];
  /** The view of the first `*Active` record of the viewport table. */
  #activeView: Omit<ReadView, "layout"> | undefined;
  readonly unread = {
    entities: map<number>(),
    objects: map<number>(),
    malformed: map<number>(),
  };

  /** Where entities go now: a space, by its block's name in capitals, or a block. */
  #space: Space | undefined;
  #spaceName: string | undefined;
  #block: BlockDraft | undefined;
  #inDimensionPicture = false;
  /** An insert or a polyline whose following records are its own, up to its SEQEND. */
  #owner: InsertOwner | PolylineOwner | undefined;

  #keep: ReadonlySet<number> = NOTHING;
  /** True for a file of R12's format or older, as its `$ACADVER` says. */
  #r12 = false;
  #blockItems = 0;
  #geometryItems = 0;
  /** The blocks `ReadOptions.blocks` names, and the items they keep in their own room. */
  readonly #ownBlocks: ReadonlySet<string>;
  #ownItems = 0;
  /** MTEXTs with a dictionary, and fields, past the limit of either list. */
  #fieldsPast = 0;
  #overflow = false;
  /**
   * The texts whose start is worked out, and the multileaders whose styles are named, at the end:
   * those of entities kept alone. What one record leaves waits in `#staged` until it is kept.
   */
  readonly #starts: PendingStart[] = [];
  readonly #leaders: PendingLeader[] = [];
  readonly #staged: Staged = {
    starts: [],
    leaders: [],
  };
  /** The images kept, to finish once the definitions are read. */
  readonly #images: ReadImage[] = [];
  /** How many images name each definition, by its handle. */
  readonly #imageUses = new Map<string, number>();
  /** The handle of the dictionary of image definitions, from the root dictionary. */
  #imageDictionary: string | undefined;
  /** The underlays kept, to finish once the definitions are read. */
  readonly #underlays: ReadUnderlay[] = [];
  /** How many underlays name each definition, by its handle. */
  readonly #underlayUses = new Map<string, number>();
  /** The handle of the dictionary of PDF definitions, from the root dictionary. */
  #underlayDictionary: string | undefined;
  /** The dictionary's entries, in its order: each definition's name and handle. */
  readonly #underlayEntries: (readonly [name: string, handle: string])[] = [];
  /** Each PDF definition, by its handle. */
  readonly #underlayDefinitions = new Map<
    string,
    { readonly path: string; readonly page: string }
  >();
  /** The variable PDFFRAME's handle in the dictionary of variables. */
  #pdfFrameVariable: string | undefined;
  /** The dictionary of the drawing's variables, and the variable WIPEOUTFRAME's handle in it. */
  #variableDictionary: string | undefined;
  #wipeoutFrameVariable: string | undefined;
  /** The value of each DICTIONARYVAR read, by its handle, up to the census's limit. */
  readonly #variables = new Map<string, string>();
  /**
   * Each sort table, by the handle of the block record it orders, with each entity's sort
   * handle, up to as many entries as the geometry's items.
   */
  readonly #sortTables = new Map<string, Map<string, string>>();
  #sortEntries = 0;
  /** The dictionary's entries, in its order: each definition's name and handle. */
  readonly #imageEntries: (readonly [name: string, handle: string])[] = [];
  /** Each image definition, by its handle. */
  readonly #imageDefinitions = new Map<
    string,
    { readonly path: string; readonly pixels: readonly [number, number]; readonly loaded: boolean }
  >();
  readonly #later: Later = {
    start: (pending) => this.#staged.starts.push(pending),
    leader: (entity, names) => this.#staged.leaders.push({ entity, ...names }),
  };

  /**
   * What the record read last left to finish, kept when its entity is kept in `target`, and
   * else dropped.
   */
  #settle(kept: boolean, target?: Target): PendingStart[] {
    const { starts, leaders } = this.#staged;
    this.#staged.starts = [];
    this.#staged.leaders = [];

    if (kept) {
      for (const pending of leaders) this.#leaders.push({ ...pending, ...(target && { target }) });

      return starts;
    }

    return [];
  }

  constructor(options: ReadOptions, limits: ReadLimits, part?: PartKept) {
    this.#geometry = options.geometry === true;
    this.#part = this.#geometry ? part : undefined;
    this.#limits = limits;
    this.#ownBlocks = ownBlocks(options.blocks);
  }

  group(code: number, value: string): void {
    if (code === 0) {
      this.#end();
      this.#table = undefined;
      this.#inTable = false;

      if (value === "SECTION") this.#section = "?";
      else if (value === "ENDSEC") this.#section = "";
      else if (value === "EOF") this.#section = "";
      else {
        this.#rec = { type: value, codes: [], values: [] };
        this.#keep = this.#keepFor(value);
      }

      return;
    }

    if (this.#section === "?") {
      if (code === 2) this.#section = value.trim().toUpperCase();

      return;
    }

    if (this.#section === "HEADER") {
      if (code === 9) this.#variable = value.trim().toUpperCase();
      else if (HEADER.has(this.#variable) && !(this.#variable in this.header)) {
        this.header[this.#variable] = value;

        if (this.#variable === "$ACADVER") this.#r12 = value.trim().toUpperCase() <= "AC1009";
      }

      return;
    }

    const r = this.#rec;

    // A table's own groups are read as they arrive, and its record keeps those before them.
    if (r?.type === "ACAD_TABLE") {
      if (this.#inTable) return this.#table?.group(code, value);

      if (code === 100 && value.trim() === "AcDbTable") {
        this.#inTable = true;
        const room = this.#tableRoom();

        if (room !== undefined) this.#table = new TableGroups(room, this.#limits.geometryItems);

        return;
      }
    }

    const keep = this.#keep;

    if (!r || keep === NOTHING || DROPPED.has(code) || (keep !== ALL && !keep.has(code))) return;

    if (r.codes.length >= MAX_GROUPS) {
      this.#overflow = true;

      return;
    }

    r.codes.push(code);
    r.values.push(value);
  }

  /** The groups of a record of this kind that a reading needs, here. */
  #keepFor(type: string): ReadonlySet<number> {
    const inSpace = (): ReadonlySet<number> =>
      this.#geometry
        ? BLOCK_READS.has(type)
          ? ALL
          : CENSUS
        : SPACE_READS.has(type)
          ? ALL
          : type === "VERTEX"
            ? NOTHING
            : CENSUS;

    switch (this.#section) {
      case "TABLES":
        return ALL;
      case "OBJECTS":
        return type === "DICTIONARY" ||
          type === "FIELD" ||
          type === "LAYOUT" ||
          type === "IMAGEDEF" ||
          type === "PDFDEFINITION" ||
          type === "DICTIONARYVAR" ||
          type === "SORTENTSTABLE" ||
          type === "TABLESTYLE" ||
          type === "MLEADERSTYLE" ||
          type === "XRECORD" ||
          type === "SPATIAL_FILTER"
          ? ALL
          : NOTHING;
      case "BLOCKS":
        if (type === "BLOCK" || type === "ENDBLK") return ALL;

        if (this.#inDimensionPicture) return NOTHING;

        if (this.#block) return BLOCK_READS.has(type) ? ALL : VISIBILITY;

        return inSpace();
      case "ENTITIES":
        return inSpace();
      default:
        return NOTHING;
    }
  }

  #end(): void {
    const r = this.#rec;
    this.#rec = undefined;

    if (!r) return;

    // The file's names key the counts, and no name a DXF can hold is so long.
    if (r.type.length > LONGEST_NAME) {
      this.#overflow = false;
      add(this.unread.malformed, `a record whose kind is longer than ${LONGEST_NAME} characters`);

      return;
    }

    if (this.#overflow) {
      this.#overflow = false;
      add(this.unread.malformed, `${r.type} of more than ${MAX_GROUPS} groups`);

      if (r.type !== "BLOCK" && r.type !== "ENDBLK") return;
    }

    switch (this.#section) {
      case "TABLES":
        return this.#tableRecord(r);
      case "BLOCKS":
        return this.#blockRecord(r);
      case "ENTITIES":
        return this.#entitiesRecord(r);
      case "OBJECTS":
        return this.#object(r);
      case "CLASSES":
      case "THUMBNAILIMAGE":
      case "ACDSDATA":
        return;
      default:
        add(this.unread.malformed, r.type);
    }
  }

  #tableRecord(r: Rec): void {
    const handle = handleAt(r, 5) ?? handleAt(r, 105);
    const recordName = name(r, 2) ?? "";
    const flags = num(r, 70) ?? 0;

    switch (r.type) {
      case "LAYER": {
        const color = num(r, 62);
        const trueColor = num(r, 420);
        const plot = num(r, 290);
        this.layers.push({
          handle,
          name: recordName,
          ...(color !== undefined && { color: Math.abs(color) }),
          ...(trueColor !== undefined && { trueColor }),
          ...(first(r, 6) !== undefined && { linetype: name(r, 6)! }),
          ...(num(r, 370) !== undefined && { lineweight: num(r, 370)! }),
          on: color === undefined || color >= 0,
          frozen: (flags & 1) !== 0,
          locked: (flags & 4) !== 0,
          plot: plot !== 0,
          xref: (flags & 16) !== 0 || recordName.includes("|"),
        });

        return;
      }

      case "LTYPE": {
        const pattern: number[] = [];
        let complex = false;
        // Each mark's groups follow the 49 and 74 of its length, its style by its handle, which
        // the styles' table, after this one, names.
        const marks: PendingMark[] = [];
        let mark: PendingMark | undefined;

        for (let i = 0; i < r.codes.length; i++) {
          const [code, value] = [r.codes[i], r.values[i]!];

          if (code === 49) {
            const length = Number(value);
            mark = undefined;

            if (!Number.isFinite(length)) continue;
            pattern.push(length);
          } else if (code === 74 && pattern.length > 0) {
            const flags = Number(value);

            if (flags !== 0) complex = true;

            if ((flags & 6) === 0 || !Number.isFinite(flags)) continue;
            mark = { after: pattern.length - 1, flags, values: new Map() };
            marks.push(mark);
          } else if (mark !== undefined && MARK_CODES.has(code!)) {
            if (!mark.values.has(code!)) mark.values.set(code!, value);
          }
        }

        const description = name(r, 3);

        const linetype = {
          handle,
          name: recordName,
          ...(description !== undefined && { description }),
          pattern,
          complex,
        };

        this.linetypes.push(linetype);

        if (marks.length > 0) this.#marked.push([this.linetypes.length - 1, marks]);

        return;
      }

      case "STYLE": {
        if (handle !== undefined)
          this.#stylesByHandle.set(normalHandle(handle), {
            name: recordName,
            file: name(r, 3) ?? "",
            height: num(r, 40) ?? 0,
          });

        // A style with flag 1 holds a shape file; one with no name is the font of a complex
        // linetype's shapes.
        if (recordName === "" && (flags & 1) !== 0) return;
        const family = first(xdata(r, "ACAD"), 1000);
        this.textStyles.push({
          handle,
          name: recordName,
          ...(first(r, 3) !== undefined && { font: name(r, 3)! }),
          ...(Boolean(first(r, 4)) && { bigFont: name(r, 4)! }),
          ...(family !== undefined && family !== "" && { family: unescaped(family) }),
          ...(num(r, 40) !== undefined && { height: num(r, 40)! }),
          ...(num(r, 41) !== undefined && { widthFactor: num(r, 41)! }),
          ...(num(r, 50) !== undefined && { oblique: num(r, 50)! }),
          annotative: annotative(r),
          glyphFile: (flags & 1) !== 0,
        });

        return;
      }

      case "DIMSTYLE": {
        const fields: [DimensionNumber, number][] = [
          ["scale", 40],
          ["textHeight", 140],
          ["arrowSize", 41],
          ["lengthUnits", 277],
          ["precision", 271],
          ["lengthFactor", 144],
          ["textVertical", 77],
          ["textInside", 174],
          ["textMove", 279],
          ["fraction", 276],
          ["fractionScale", 146],
          ["dimensionLineweight", 371],
          ["extensionLineweight", 372],
        ];

        const style: DimensionStyleDraft = { handle, name: recordName, annotative: annotative(r) };

        for (const [field, code] of fields) {
          const n = num(r, code);

          if (n !== undefined) style[field] = n;
        }

        // A DXF leaves out each of these at the value its record takes by default, which the
        // DWG holds.
        for (const [field, code, plain] of DIMENSION_DEFAULTS) style[field] = num(r, code) ?? plain;

        const suffix = name(r, 3);

        if (suffix !== undefined && suffix !== "") style.suffix = suffix;
        const textStyle = handleAt(r, 340);

        if (textStyle !== undefined) style.textStyleHandle = textStyle;
        const arrowhead = handleAt(r, 342);

        if (arrowhead !== undefined) style.arrowheadHandle = arrowhead;
        // DIMTFILL, and DIMTFILLCLR after it, a 70 of its own past the record's flags.
        const fill = r.codes.indexOf(69);

        if (fill >= 0) {
          const n = Number(r.values[fill]);

          if (Number.isFinite(n) && n !== 0) style.textFill = n;
          const color = r.codes.indexOf(70, fill);
          const index = color < 0 ? NaN : Number(r.values[color]);

          if (n === 2 && Number.isFinite(index)) style.textFillColor = index;
        }

        this.dimensionStyles.push(style);

        return;
      }

      case "BLOCK_RECORD":
        if (handle !== undefined) this.blockRecords.set(handle, recordName);

        return;
      case "VPORT":
        // The first `*Active` record is the view model space opens at.
        if (recordName.toUpperCase() === "*ACTIVE" && this.#activeView === undefined) {
          this.#activeView = activeView(r);
        }

        return;
      default:
        return;
    }
  }

  #blockRecord(r: Rec): void {
    if (r.type === "BLOCK") {
      this.#closeOwner();
      const blockName = name(r, 2) ?? name(r, 3) ?? "";
      const flags = num(r, 70) ?? 0;
      const upper = blockName.toUpperCase();
      this.#block = undefined;
      this.#space = undefined;
      this.#inDimensionPicture = false;

      if (blockName.length > LONGEST_NAME) {
        add(this.unread.malformed, `BLOCK with a name longer than ${LONGEST_NAME} characters`);
        this.#inDimensionPicture = true;
      } else if (upper === MODEL || upper.startsWith("*PAPER_SPACE")) {
        this.#spaceName = upper;
        this.#space = this.#spaceFor(upper);
      } else if ((flags & 4) !== 0) {
        this.xrefs.push({
          handle: ownerOf(r),
          name: blockName,
          path: name(r, 1) ?? "",
          overlay: (flags & 8) !== 0,
        });
        // An xref's block holds nothing of its own in the host.
        this.#inDimensionPicture = true;
      } else if (!this.#geometry && /^\*[DT]\d*$/i.test(blockName)) {
        this.#inDimensionPicture = true;
      } else {
        const handle = ownerOf(r);

        this.#block = {
          handle,
          name: blockName,
          base: point(r, 10),
          anonymous: (flags & 1) !== 0 || blockName.startsWith("*"),
          attributeDefinitions: [],
          entities: [],
          other: map(),
          block: true,
          ...(handle !== undefined &&
            this.#ownBlocks.has(handle.replace(/^0+(?=.)/, "").toUpperCase()) && { ownRoom: true }),
        };
        this.blocks.push(this.#block);
      }

      return;
    }

    if (r.type === "ENDBLK") {
      this.#closeOwner();
      this.#block = undefined;
      this.#space = undefined;
      this.#spaceName = undefined;
      this.#inDimensionPicture = false;

      return;
    }

    if (this.#inDimensionPicture) {
      if (!READ_ENTITIES.has(r.type)) add(this.unread.entities, r.type);

      return;
    }

    this.#entity(r);
  }

  #entitiesRecord(r: Rec): void {
    this.#block = undefined;
    const owner = ownerOf(r);
    const ownerName = owner === undefined ? undefined : this.blockRecords.get(owner);

    const spaceName =
      ownerName !== undefined && ownerName.toUpperCase().startsWith("*PAPER_SPACE")
        ? ownerName.toUpperCase()
        : num(r, 67) === 1
          ? "*PAPER_SPACE"
          : MODEL;

    // The records that follow an insert or a polyline are its own, whatever their owner says.
    if (!(this.#owner && (r.type === "ATTRIB" || r.type === "VERTEX" || r.type === "SEQEND"))) {
      this.#closeOwner();
      this.#spaceName = spaceName;
      this.#space = this.#spaceFor(spaceName);
    }

    this.#entity(r);
  }

  #spaceFor(spaceName: string): Space {
    let space = this.spaces.get(spaceName);

    if (!space) {
      space = {
        census: new Census(this.#limits.census),
        viewports: [],
        inserts: [],
        entities: [],
        other: map(),
        unread: [],
        block: false,
      };
      this.spaces.set(spaceName, space);
    }

    return space;
  }

  /**
   * How many items the table whose groups arrive now may hold: what its block or the spaces may
   * still keep, or undefined where the read keeps no table. The space of a table of the section
   * `ENTITIES` is known at its end, and every space shares one budget.
   */
  #tableRoom(): number | undefined {
    if (this.#section === "ENTITIES")
      return this.#geometry ? this.#limits.geometryItems - this.#geometryItems : undefined;

    if (this.#section !== "BLOCKS" || this.#inDimensionPicture) return undefined;
    const target = this.#target();

    return target === undefined ? undefined : this.#room(target);
  }

  /** Where the entity read now is kept: its block, or its space when the read keeps geometry. */
  #target(): Target | undefined {
    return this.#block ?? (this.#geometry && this.#keepsSpace() ? this.#space : undefined);
  }

  /** False for a paper space a read with `only` does not keep. */
  #keepsSpace(name = this.#spaceName): boolean {
    return !this.#part || name === MODEL || this.#part.papers.has(name ?? "");
  }

  /** True when a read with `only` leaves an entity of model space out. */
  #outside(target: Target, entity: ReadEntity): boolean {
    return (
      this.#part !== undefined &&
      target === this.spaces.get(MODEL) &&
      !this.#part.filter.keeps(entity)
    );
  }

  /** How many more items a target may keep. */
  #room(target: Target): number {
    if (!target.block) return this.#limits.geometryItems - this.#geometryItems;
    const running = this.#limits.blockItems - this.#blockItems;

    // A block named apart may take what either room has left, until its entity's cost is known.
    return target.ownRoom ? Math.max(running, this.#limits.blockItems - this.#ownItems) : running;
  }

  /**
   * Whether an entity of `cost` fits the room its target keeps it in. One of a block named apart
   * that its own room cannot take still spends the running total where it would without the
   * option, so every other block is kept as it would be.
   */
  #fits(target: Target, cost: number): boolean {
    if (!target.ownRoom) return cost <= this.#room(target);

    if (cost <= this.#limits.blockItems - this.#ownItems) return true;

    if (cost <= this.#limits.blockItems - this.#blockItems) this.#blockItems += cost;

    return false;
  }

  /** Spends `cost` items of the room `target` keeps them in. */
  #spend(target: Target, cost: number): void {
    if (!target.block) this.#geometryItems += cost;
    else {
      // A block named apart spends the running total as it would without the option, so every
      // other block is kept as it would be.
      if (target.ownRoom) this.#ownItems += cost;

      if (!target.ownRoom || cost <= this.#limits.blockItems - this.#blockItems)
        this.#blockItems += cost;
    }
  }

  /**
   * Keeps an entity in its target, within the target's limit, or counts it as past the limit.
   * True when it is kept.
   */
  #kept(target: Target, entity: ReadEntity, cost = costOf(entity)): boolean {
    if (this.#outside(target, entity)) {
      add(target.other, OUTSIDE_THE_READ);

      return false;
    }

    if (!this.#fits(target, cost)) {
      add(target.other, "past the limit");

      return false;
    }

    this.#spend(target, cost);
    target.entities.push(entity);

    return true;
  }

  /** An entity of the current space or block. */
  #entity(r: Rec): void {
    if (this.#owner) {
      if (this.#owner.kind === "insert" && r.type === "ATTRIB") {
        return this.#attribute(r, this.#owner);
      }

      if (this.#owner.kind === "polyline" && r.type === "VERTEX") {
        return this.#vertex(r, this.#owner);
      }

      this.#closeOwner();

      if (r.type === "SEQEND") return;
    }

    if (r.type === "ATTRIB" || r.type === "VERTEX" || r.type === "SEQEND") {
      add(this.unread.malformed, r.type);

      return;
    }

    const layer = name(r, 8) ?? "0";

    if (layer.length > LONGEST_NAME) {
      add(this.unread.malformed, `${r.type} on a layer longer than ${LONGEST_NAME} characters`);

      return;
    }

    if (!READ_ENTITIES.has(r.type)) add(this.unread.entities, r.type);
    const handle = handleAt(r, 5);
    const space = this.#space;
    space?.census.count(r, layer);
    const block = this.#block;
    const target = this.#target();

    // A line, an MTEXT and a multileader hold their points in the world's coordinates already.
    const face =
      r.type === "LINE" || r.type === "MTEXT" || r.type === "MULTILEADER" ? 1 : facing(r);

    this.#census(r, layer, handle, face);

    switch (r.type) {
      case "POLYLINE":
        this.#owner = {
          kind: "polyline",
          rec: r,
          points: [],
          bulges: [],
          widths: [],
          widthsAt: [num(r, 40) ?? 0, num(r, 41) ?? 0],
          over: false,
          broken: brokenNumber(r),
          face,
        };

        return;
      case "INSERT": {
        const insert = { ...insertOf(r, baseOf(r, layer, handle), face), tags: map<boolean>() };
        // A space lists an insert in any plane, as its census does; a block keeps it flat.
        const place = face !== 0 || !block;
        let keep = target !== undefined;

        if (target && hidden(r)) {
          add(target.other, "invisible");
          keep = false;
        } else if (target && face === 0) {
          add(target.other, "INSERT in 3D");
          keep = false;
        } else if (target && ((num(r, 70) ?? 1) > 1 || (num(r, 71) ?? 1) > 1)) {
          add(target.other, "INSERT with columns and rows");
          keep = false;
        } else if (target && brokenNumber(r)) {
          add(this.unread.malformed, "INSERT with a number that is not finite");
          keep = false;
        }

        const owner = {
          kind: "insert" as const,
          insert,
          place,
          keep,
          tags: 0,
          attributes: keep && this.#geometry ? [] : undefined,
          dictionary: inGroup(r, "{ACAD_XDICTIONARY", 360),
          cost: costOf(insert),
          over: false,
          starts: [],
        };

        if (num(r, 66) === 1) this.#owner = owner;
        else this.#placeInsert(owner);

        return;
      }

      case "ATTDEF": {
        // A space keeps no attribute definition, but counts one that does not show.
        if (!block) return target && hidden(r) ? add(target.other, "invisible") : undefined;

        if (face === 0) {
          add(block.other, "ATTDEF in 3D");

          return;
        }

        if (brokenNumber(r)) {
          add(this.unread.malformed, "ATTDEF with a number that is not finite");

          return;
        }

        const { text, paragraph } = attributeParts(r);

        if (paragraph === null) {
          add(block.other, "ATTDEF of paragraph text in 3D");

          return;
        }

        const flags = num(text, 70) ?? 0;
        const prompt = name(text, 3) === undefined ? undefined : textTwice(first(text, 3)!);
        const value = paragraph ? paragraph.value : textTwice(first(text, 1) ?? "");
        const tag = textTwice(first(text, 2) ?? "");

        const cost =
          4 +
          (paragraph ? 2 + nameCost(paragraph.paragraph.style) : 0) +
          Math.floor((tag.length + value.length + (prompt?.length ?? 0)) / 32);

        if (!this.#fits(block, cost)) {
          add(block.other, "past the limit");

          return;
        }

        this.#spend(block, cost);
        const { placement, pending } = placementOf(text, face, value, 74);

        const definition = {
          handle,
          ...placement,
          tag,
          ...(prompt !== undefined && { prompt }),
          default: value,
          layer,
          invisible: (flags & 1) !== 0 || hidden(r),
          constant: (flags & 2) !== 0,
          ...(paragraph && { paragraph: paragraph.paragraph }),
        };

        if (pending && !paragraph) this.#starts.push({ ...pending, placement: definition });
        block.attributeDefinitions.push(definition);

        return;
      }

      case "ACAD_TABLE":
        return this.#tableEntity(r, layer, handle, face, target);
      case "VIEWPORT": {
        if (!space) {
          if (block) add(block.other, "VIEWPORT");

          return;
        }

        const read = viewport(r, handle, layer);

        if (read === undefined)
          add(this.unread.malformed, "VIEWPORT with a number past the doubles");
        else if (space.viewports.length < this.#limits.census) space.viewports.push(read);
        else space.census.capped = true;

        return;
      }
    }

    // How many images name each definition, whatever the read keeps of them, for as many
    // definitions as the census holds.
    if (r.type === "IMAGE") {
      const definition = handleAt(r, 340);
      const uses = definition === undefined ? undefined : this.#imageUses.get(definition);

      if (uses !== undefined) this.#imageUses.set(definition!, uses + 1);
      else if (definition !== undefined && this.#imageUses.size < this.#limits.census)
        this.#imageUses.set(definition, 1);
    }

    if (r.type === "PDFUNDERLAY") {
      const definition = handleAt(r, 340);
      const uses = definition === undefined ? undefined : this.#underlayUses.get(definition);

      if (uses !== undefined) this.#underlayUses.set(definition!, uses + 1);
      else if (definition !== undefined && this.#underlayUses.size < this.#limits.census)
        this.#underlayUses.set(definition, 1);
    }

    if (!target) return;

    if (hidden(r)) return add(target.other, "invisible");
    const reading = readingOf(r, baseOf(r, layer, handle), face, this.#later, this.#r12);
    const kept = reading !== undefined && "entity" in reading && this.#kept(target, reading.entity);

    if (kept && reading.entity.kind === "image") this.#images.push(reading.entity);

    if (kept && reading.entity.kind === "underlay") this.#underlays.push(reading.entity);

    for (const pending of this.#settle(kept, target)) this.#starts.push(pending);

    if (reading === undefined) {
      if (isSpace(target) && !READ_ENTITIES.has(r.type) && handle !== undefined)
        this.#unreadEntity(target, r, handle, layer);
      else add(target.other, r.type);
    } else if ("other" in reading) add(target.other, reading.other);
    else if ("malformed" in reading) add(this.unread.malformed, reading.malformed);
  }

  /** An entity of a kind the reader does not read, listed in its space within the limit. */
  #unreadEntity(space: Space, r: Rec, handle: string, layer: string): void {
    const kind = r.type;
    const cost = 3 + nameCost(kind) + nameCost(layer);

    if (cost > this.#room(space)) {
      add(space.other, "past the limit");

      return;
    }

    this.#geometryItems += cost;
    add(space.other, kind);
    // An OLE frame's corners, upper left and lower right, in the world's coordinates.
    const a = kind === "OLE2FRAME" ? point(r, 10) : undefined;
    const b = kind === "OLE2FRAME" ? point(r, 11) : undefined;
    const box = a && b && [...a, ...b].every(Number.isFinite) ? ([a, b] as const) : undefined;
    space.unread.push({ handle, kind, layer, ...(box && { box }) });
  }

  /** A table, whose style and rows of title and header are named once the file is read. */
  #tableEntity(
    r: Rec,
    layer: string,
    handle: string | undefined,
    face: Facing,
    target: Target | undefined,
  ): void {
    const groups = this.#table;
    this.#table = undefined;

    if (!target) return;

    if (hidden(r)) return add(target.other, "invisible");

    if (face !== 1)
      return add(target.other, face === 0 ? "ACAD_TABLE in 3D" : "ACAD_TABLE seen from below");

    if (brokenNumber(r) || groups === undefined) {
      const why = groups === undefined ? "with no AcDbTable" : "with a number that is not finite";

      return add(this.unread.malformed, `ACAD_TABLE ${why}`);
    }

    const read = groups.end(
      (record) => this.blockRecords.get(record) ?? this.blockRecords.get(record.toUpperCase()),
    );

    if ("other" in read) return add(target.other, read.other);

    if ("malformed" in read) return add(this.unread.malformed, read.malformed);
    const { styleHandle, blockHandle, noTitle, noHeader, ...parts } = read.table;
    const block = name(r, 2);

    const entity: ReadTable = {
      ...baseOf(r, layer, handle),
      kind: "table",
      at: point(r, 10),
      ...parts,
      title: false,
      header: false,
      ...(block !== undefined && block !== "" && { block }),
      ...(blockHandle !== undefined && { blockHandle }),
    };

    if (this.#kept(target, entity))
      this.#tables.push({ entity, target, style: styleHandle, noTitle, noHeader });
  }

  /** What a space's census lists of a text, an `MTEXT` or a dimension, and the fields' MTEXTs. */
  #census(r: Rec, layer: string, handle: string | undefined, face: Facing): void {
    const space = this.#space;
    const block = this.#block;

    switch (r.type) {
      case "TEXT": {
        if (!space) return;
        const at = placed(point(r, 10), face);
        const height = num(r, 40) ?? 0;
        const style = name(r, 7) ?? "Standard";
        space.census.list(space.census.texts, "texts", () => ({
          handle,
          kind: "TEXT" as const,
          layer,
          style,
          at,
          height,
        }));

        return;
      }

      case "MTEXT": {
        const height = num(r, 40) ?? 0;
        const at = point(r, 10);

        if (space) {
          const style = name(r, 7) ?? "Standard";
          let text = "";

          for (let i = 0; i < r.codes.length; i++) {
            if (r.codes[i] === 3 || r.codes[i] === 1) text += r.values[i];
          }

          const heights = text.includes("\\H") ? inlineHeights(text, height) : [];
          space.census.list(space.census.texts, "texts", () => ({
            handle,
            kind: "MTEXT" as const,
            layer,
            style,
            at,
            height,
            ...(heights.length > 0 && { inlineHeights: heights }),
          }));
        }

        const dictionary = inGroup(r, "{ACAD_XDICTIONARY", 360);

        // An annotative MTEXT has a dictionary too, so the list stops at the limit.
        if (dictionary !== undefined && this.mtexts.length >= this.#limits.census) {
          this.#fieldsPast++;
        } else if (dictionary !== undefined) {
          this.mtexts.push({
            handle,
            dictionary,
            at,
            height,
            width: num(r, 41) ?? 0,
            layer,
            space: this.#spaceName,
            block: block?.name,
          });
        }

        return;
      }

      case "DIMENSION":
      case "LARGE_RADIAL_DIMENSION":
      case "ARC_DIMENSION": {
        if (!space) return;
        const style = name(r, 3) ?? "Standard";
        const dstyle = xdata(r, "ACAD");
        const overrides = dstyle.values.some((v, i) => dstyle.codes[i] === 1000 && v === "DSTYLE");
        space.census.list(space.census.dimensions, "dimensions", () => ({
          handle,
          layer,
          style,
          at: first(r, 11) !== undefined ? placed(point(r, 11), face) : point(r, 10),
          overrides,
        }));

        return;
      }
    }
  }

  /** An attribute of the insert whose records these are. */
  #attribute(r: Rec, owner: InsertOwner): void {
    const tag = first(r, 2) === undefined ? undefined : textTwice(first(r, 2)!);

    if (tag !== undefined && tag.length > LONGEST_NAME) {
      add(this.unread.malformed, `ATTRIB with a tag longer than ${LONGEST_NAME} characters`);

      return;
    }

    if (tag !== undefined && (tag in owner.insert.tags || owner.tags < MAX_TAGS)) {
      if (!(tag in owner.insert.tags)) {
        owner.tags++;
        owner.cost += 1 + Math.floor(tag.length / 32);
      }

      const { text, paragraph } = attributeParts(r);
      owner.insert.tags[tag] = paragraph ? paragraph.value !== "" : (first(text, 1) ?? "") !== "";
    }

    const target = this.#target();

    if (!owner.attributes || owner.over || !target) return;

    if (owner.attributes.length >= MAX_TAGS) {
      add(target.other, "past the limit");

      return;
    }

    const read = attributeOf(r, baseOf(r, name(r, 8) ?? "0", handleAt(r, 5)), this.#later);
    let pushed = false;

    if ("malformed" in read) add(this.unread.malformed, read.malformed);
    else if ("other" in read) add(target.other, read.other);
    else {
      owner.cost += attributeCost(read);

      // An insert whose attributes cannot fit what its target has left is counted, whole.
      if (owner.cost > this.#room(target)) owner.over = true;
      else {
        owner.attributes.push(read);
        pushed = true;
      }
    }

    for (const pending of this.#settle(pushed)) owner.starts.push(pending);
  }

  /** A vertex of the polyline whose records these are. */
  #vertex(r: Rec, owner: PolylineOwner): void {
    const flags = num(r, 70) ?? 0;
    const target = this.#target();

    if (brokenNumber(r)) owner.broken = true;

    // A spline's frame point is not a point of the polyline.
    if ((flags & 16) === 0 && target && !owner.over) {
      // A polyline that cannot fit what its target may still keep holds no more points, nor
      // the bulge and the pair of widths of each.
      if (owner.points.length >= this.#room(target)) {
        owner.over = true;
        owner.points = [];
        owner.bulges = [];
        owner.widths = [];
      } else {
        owner.points.push(point(r, 10));
        owner.bulges.push(num(r, 42) ?? 0);
        // A vertex with no width of its own has the polyline's.
        owner.widths.push([num(r, 40) ?? owner.widthsAt[0], num(r, 41) ?? owner.widthsAt[1]]);
      }
    }
  }

  #placeInsert(owner: InsertOwner): void {
    const target = this.#target();
    const { insert } = owner;

    if (owner.keep && target) {
      if (owner.over)
        add(target.other, this.#outside(target, insert) ? OUTSIDE_THE_READ : "past the limit");
      else {
        const kept = owner.attributes ? { ...insert, attributes: owner.attributes } : insert;

        if (this.#kept(target, kept)) {
          for (const pending of owner.starts) this.#starts.push(pending);
          const { dictionary } = owner;

          if (dictionary !== undefined && this.#clipped.length < this.#limits.census) {
            this.#clipped.push({ insert: kept, dictionary });
          }
        }
      }
    }

    const space = this.#space;

    if (!space || !owner.place || this.#block) return;
    space.census.list(space.census.inserts, "inserts", () => ({
      handle: insert.handle,
      layer: insert.layer,
      block: insert.block,
      at: insert.at,
      scale: insert.scale,
    }));

    if (this.#spaceName !== MODEL && space.inserts.length < this.#limits.census) {
      // Without geometry a read keeps no text, a color book's names among it.
      const { colorBook: _book, ...kept } = insert;
      space.inserts.push(this.#geometry ? insert : kept);
    }
  }

  #closeOwner(): void {
    const owner = this.#owner;
    this.#owner = undefined;

    if (!owner) return;

    if (owner.kind === "insert") {
      this.#placeInsert(owner);

      return;
    }

    const target = this.#target();

    if (!target) return;
    const r = owner.rec;
    const flags = num(r, 70) ?? 0;

    // 8 is a 3D polyline, 16 a mesh and 64 a face mesh.
    if (hidden(r)) add(target.other, "invisible");
    else if ((flags & (8 | 16 | 64)) !== 0 || owner.face === 0) add(target.other, "POLYLINE in 3D");
    else if (owner.broken) add(this.unread.malformed, "POLYLINE with a number that is not finite");
    else if (owner.over) add(target.other, "past the limit");
    else {
      const closed = (flags & 1) !== 0;
      this.#kept(target, {
        ...baseOf(r, name(r, 8) ?? "0", handleAt(r, 5)),
        kind: "polyline",
        points: owner.face === -1 ? owner.points.map((p) => placed(p, -1)) : owner.points,
        closed,
        ...sidesOf(owner.points.length, closed, owner.bulges, owner.widths, 0, owner.face),
        ...((flags & 128) !== 0 && { linetypeGeneration: true }),
        heavy: true,
      });
    }
  }

  #object(r: Rec): void {
    switch (r.type) {
      case "DICTIONARY": {
        const handle = handleAt(r, 5);

        if (handle === undefined) return;
        // The first dictionary of the section is the named object dictionary.
        this.#rootDictionary ??= handle;
        let entries: Record<string, string> | undefined;
        // The dictionary of leader styles names each by its name.
        const styles = handle === this.#leaderStyleDictionary;

        for (let i = 0; i < r.codes.length; i++) {
          if (r.codes[i] !== 3) continue;
          const key = r.values[i]!;
          const next = r.codes[i + 1];

          if (next !== 350 && next !== 360) continue;
          const value = r.values[i + 1]!;

          // An entry keys a map by the handle it holds, which is 1 to 16 hexadecimal digits.
          if (!/^[0-9A-Fa-f]{1,16}$/.test(value)) continue;

          // The dictionary of table styles names each by its name, whatever the name is.
          if (handle === this.#tableStyleDictionary) {
            if (key.length <= LONGEST_NAME && this.#tableStyleEntries.length < this.#limits.census)
              this.#tableStyleEntries.push([unescaped(key), value]);
          } else if (
            key === "ACAD_FIELD" ||
            key === "TEXT" ||
            key === "ACAD_FILTER" ||
            key === "SPATIAL"
          ) {
            entries ??= {};
            entries[key] = value;
          } else if (handle === this.#editDictionary) {
            if (this.#editEntries.length < this.#limits.census)
              this.#editEntries.push([unescaped(key), value.toUpperCase()]);
          } else if (key === MARK_APP && handle === this.#rootDictionary)
            this.#editDictionary ??= value.toUpperCase();
          else if (key === "ACAD_MLEADERSTYLE") this.#leaderStyleDictionary ??= value;
          else if (key === "ACAD_TABLESTYLE") this.#tableStyleDictionary ??= value;
          else if (key === "ACAD_IMAGE_DICT") this.#imageDictionary ??= value;
          else if (key === "ACAD_PDFDEFINITIONS") this.#underlayDictionary ??= value;
          else if (handle === this.#variableDictionary && key === "PDFFRAME")
            this.#pdfFrameVariable ??= value;
          else if (
            handle === this.#underlayDictionary &&
            key.length <= LONGEST_NAME &&
            this.#underlayEntries.length < this.#limits.census
          )
            this.#underlayEntries.push([unescaped(key), value]);
          else if (key === "AcDbVariableDictionary") this.#variableDictionary ??= value;
          else if (handle === this.#variableDictionary && key === "WIPEOUTFRAME")
            this.#wipeoutFrameVariable ??= value;
          else if (
            handle === this.#imageDictionary &&
            key.length <= LONGEST_NAME &&
            this.#imageEntries.length < this.#limits.census
          ) {
            this.#imageEntries.push([unescaped(key), value]);
          } else if (styles && key.length <= LONGEST_NAME && !this.leaderStyles.has(value)) {
            this.leaderStyles.set(value, unescaped(key));
          }
        }

        if (entries && this.dictionaries.size < 2 * this.#limits.census) {
          this.dictionaries.set(handle, entries);
        }

        return;
      }

      case "DICTIONARYVAR": {
        const handle = handleAt(r, 5);
        const value = first(inSubclass(r, "DictionaryVariables"), 1);

        if (handle === undefined || value === undefined) return;

        if (this.#variables.size < this.#limits.census) this.#variables.set(handle, value);

        return;
      }

      case "SORTENTSTABLE": {
        // The block record it orders, the 330 after its subclass.
        const table = inSubclass(r, "AcDbSortentsTable");
        const at = table.codes.indexOf(330);
        const named = at < 0 ? undefined : table.values[at]!.trim();
        const owner = named !== undefined && HANDLE.test(named) ? named.toUpperCase() : undefined;

        // One no block record of the file holds is not read, and counted, as readDWG counts it.
        if (
          owner === undefined ||
          !(this.blockRecords.has(owner) || this.blockRecords.has(named!))
        ) {
          add(this.unread.objects, r.type);

          return;
        }

        let entries = this.#sortTables.get(owner);

        if (entries === undefined) {
          if (this.#sortTables.size >= this.#limits.census) return;
          this.#sortTables.set(owner, (entries = new Map()));
        }

        for (let i = 0; i + 1 < table.codes.length; i++) {
          if (table.codes[i] !== 331 || table.codes[i + 1] !== 5) continue;
          const [entity, sort] = [table.values[i]!.trim(), table.values[i + 1]!.trim()];

          if (!HANDLE.test(entity) || !HANDLE.test(sort)) continue;

          if (this.#sortEntries >= this.#limits.geometryItems) break;
          this.#sortEntries++;
          entries.set(entity.toUpperCase(), sort.toUpperCase());
        }

        return;
      }

      case "XRECORD": {
        const handle = handleAt(r, 5)?.toUpperCase();
        const owner = ownerOf(r)?.toUpperCase();

        if (handle === undefined || owner === undefined || owner !== this.#editDictionary) return;

        if (this.#editRecords.size < this.#limits.census)
          this.#editRecords.set(
            handle,
            recordAdditions(r.codes.map((code, i) => ({ code, value: r.values[i] }))),
          );

        return;
      }

      case "MLEADERSTYLE": {
        const handle = handleAt(r, 5);

        if (handle === undefined || this.#leaderStyleObjects.size >= this.#limits.census) return;
        const key = handle.toUpperCase();
        const at = (code: number, plain: number): number => num(r, code) ?? plain;

        if (!this.#leaderStyleObjects.has(key))
          this.#leaderStyleObjects.set(key, {
            textStyleHandle: handleAt(r, 342),
            arrowheadHandle: handleAt(r, 341),
            style: {
              textHeight: at(45, 0.18),
              arrowSize: at(44, 0.18),
              landing: at(43, 0.36),
              gap: at(42, 0.09),
              scale: at(142, 1),
              attachment: at(174, 1),
              frame: at(292, 0) !== 0,
              direction: at(271, 0),
            },
          });

        return;
      }

      case "TABLESTYLE": {
        const handle = handleAt(r, 5);

        if (handle === undefined || this.#tableStyleObjects.size >= this.#limits.census) return;
        const key = handle.toUpperCase();

        if (!this.#tableStyleObjects.has(key)) this.#tableStyleObjects.set(key, tableStyleOf(r));

        return;
      }

      case "IMAGEDEF": {
        const handle = handleAt(r, 5);

        if (handle === undefined || this.#imageDefinitions.size >= this.#limits.census) return;
        const definition = inSubclass(r, "AcDbRasterImageDef");
        this.#imageDefinitions.set(handle, {
          path: name(definition, 1) ?? "",
          pixels: [num(definition, 10) ?? 0, num(definition, 20) ?? 0],
          loaded: (num(definition, 280) ?? 1) !== 0,
        });

        return;
      }

      case "PDFDEFINITION": {
        const handle = handleAt(r, 5);

        if (handle === undefined || this.#underlayDefinitions.size >= this.#limits.census) return;
        const definition = inSubclass(r, "AcDbUnderlayDefinition");
        this.#underlayDefinitions.set(handle, {
          path: name(definition, 1) ?? "",
          page: name(definition, 2) ?? "",
        });

        return;
      }

      case "SPATIAL_FILTER": {
        const handle = handleAt(r, 5);
        const outline = spatialOutline(inSubclass(r, "AcDbSpatialFilter"));

        if (handle !== undefined && outline && this.#spatialFilters.size < this.#limits.census) {
          this.#spatialFilters.set(handle, outline);
        }

        return;
      }

      case "FIELD": {
        const handle = handleAt(r, 5);

        if (handle === undefined) return;
        const field = inSubclass(r, "AcDbField");
        let code = "";
        const children: string[] = [];

        for (let i = 0; i < field.codes.length; i++) {
          if (field.codes[i] === 2 || field.codes[i] === 3) code += field.values[i];

          if (field.codes[i] === 360 && /^[0-9A-Fa-f]{1,16}$/.test(field.values[i]!)) {
            children.push(field.values[i]!);
          }
        }

        if (this.fieldObjects.size >= this.#limits.census) this.#fieldsPast++;
        else this.fieldObjects.set(handle, { evaluator: first(field, 1) ?? "", code, children });

        return;
      }

      case "LAYOUT": {
        const plot = inSubclass(r, "AcDbPlotSettings");
        const layout = inSubclass(r, "AcDbLayout");
        const width = num(plot, 44);
        const height = num(plot, 45);
        const [paperUnits, drawingUnits] = [num(plot, 142), num(plot, 143)];

        const plotScale =
          paperUnits !== undefined && drawingUnits !== undefined && drawingUnits > 0
            ? paperUnits / drawingUnits
            : undefined;

        this.layouts.push({
          handle: handleAt(r, 5),
          name: name(layout, 1) ?? "",
          tab: num(layout, 71) ?? 0,
          blockRecord: first(layout, 330),
          ...(first(plot, 4) !== undefined && { media: name(plot, 4)! }),
          ...(first(plot, 2) !== undefined && { plotter: name(plot, 2)! }),
          ...(width !== undefined && height !== undefined && { paperSize: [width, height] }),
          ...(num(plot, 72) !== undefined && { paperUnits: num(plot, 72)! }),
          ...(plotScale !== undefined && Number.isFinite(plotScale) && { plotScale }),
          ...(Boolean(first(plot, 7)) && { plotStyleTable: name(plot, 7)! }),
          plotRotation: num(plot, 73) ?? 0,
        });

        return;
      }

      default:
        if (!HOUSEKEEPING.has(r.type)) add(this.unread.objects, r.type);
    }
  }

  finish(sha256: string, bytes: number, groups: GroupReader): DrawingRead {
    this.#end();
    this.#closeOwner();
    const h = this.header;

    const numberOf = (key: string): number | undefined => {
      const value = h[key];
      const n = Number(value);

      return value !== undefined && value.trim() !== "" && Number.isFinite(n) ? n : undefined;
    };

    const header: Record<string, string | number> = {};

    for (const [field, key] of [
      ["insunits", "$INSUNITS"],
      ["measurement", "$MEASUREMENT"],
      ["ltscale", "$LTSCALE"],
      ["psltscale", "$PSLTSCALE"],
      ["msltscale", "$MSLTSCALE"],
      ["dimscale", "$DIMSCALE"],
      ["pdmode", "$PDMODE"],
      ["pdsize", "$PDSIZE"],
    ] as const) {
      const n = numberOf(key);

      if (n !== undefined) header[field] = n;
    }

    if (h.$DIMSTYLE !== undefined) header.dimstyle = unescaped(h.$DIMSTYLE);

    if (h.$TEXTSTYLE !== undefined) header.textstyle = unescaped(h.$TEXTSTYLE);
    const seed = h.$HANDSEED?.trim();

    if (seed !== undefined && /^[0-9A-Fa-f]{1,16}$/.test(seed))
      header.handseed = seed.replace(/^0+(?=.)/, "").toUpperCase();

    if (h.$CLAYER !== undefined) header.clayer = unescaped(h.$CLAYER);

    const frame =
      this.#wipeoutFrameVariable === undefined
        ? undefined
        : Number(this.#variables.get(this.#wipeoutFrameVariable));

    if (frame !== undefined && Number.isInteger(frame)) header.wipeoutFrame = frame;

    const layerNames = new Map<string, string>();

    for (const layer of this.layers) {
      if (layer.handle !== undefined) layerNames.set(layer.handle, layer.name);
    }

    const styleNames = new Map<string, string>();

    for (const style of this.textStyles) {
      if (style.handle !== undefined) styleNames.set(style.handle, style.name);
    }

    const dimensionStyles = this.dimensionStyles.map(
      ({ textStyleHandle, arrowheadHandle, ...style }) => {
        const textStyle =
          textStyleHandle === undefined ? undefined : styleNames.get(textStyleHandle);

        const arrowheadBlock =
          arrowheadHandle === undefined ? undefined : this.blockRecords.get(arrowheadHandle);

        return {
          ...style,
          ...(textStyle !== undefined && { textStyle }),
          ...(arrowheadBlock !== undefined && arrowheadBlock !== "" && { arrowheadBlock }),
        };
      },
    );

    this.#startsOfTexts();
    this.#leaderStyles(styleNames);
    const tableStyles = this.#tableStyles();
    this.#blockHandles();

    // Each insert's clip, through its extension dictionary's `ACAD_FILTER` and `SPATIAL`.
    for (const { insert, dictionary } of this.#clipped) {
      const filters = this.dictionaries.get(dictionary)?.ACAD_FILTER;
      const spatial = filters === undefined ? undefined : this.dictionaries.get(filters)?.SPATIAL;
      const outline = spatial === undefined ? undefined : this.#spatialFilters.get(spatial);

      if (outline) insert.clip = { outline };
    }

    // A file before the R2000 format (AC1015) has one paper space and no LAYOUT: the leading CAD
    // app opens it as the layout `Layout1`.
    if (this.layouts.length === 0 && this.spaces.has("*PAPER_SPACE")) {
      this.layouts.push({
        space: "*PAPER_SPACE",
        handle: undefined,
        name: "Layout1",
        tab: 1,
        blockRecord: undefined,
        plotRotation: 0,
      });
    }

    const spaceOf = (draft: LayoutDraft): string =>
      draft.space ??
      (draft.blockRecord === undefined
        ? ""
        : (this.blockRecords.get(draft.blockRecord) ?? "")
      ).toUpperCase();

    // The handle of each block's record by its name in capitals, and the order of what a space
    // or a block draws, when the file holds a sort table for it.
    const recordOf = new Map<string, string>();

    for (const [handle, recordName] of this.blockRecords) {
      if (recordName.length <= LONGEST_NAME && !recordOf.has(recordName.toUpperCase()))
        recordOf.set(recordName.toUpperCase(), handle.toUpperCase());
    }

    // A block's entities are read with geometry and without, and a space's with it alone.
    const order = (
      entities: readonly ReadEntity[] | undefined,
      recordName: string,
    ): readonly string[] | undefined => {
      if (entities === undefined) return undefined;
      const record = recordOf.get(recordName.toUpperCase());
      const table = record === undefined ? undefined : this.#sortTables.get(record);

      return table === undefined ? undefined : sortedOrder(entities, table);
    };

    /** A space's draw order as a field of its read, which a read without geometry leaves out. */
    const ordered = (
      entities: readonly ReadEntity[] | undefined,
      recordName: string,
    ): { drawOrder?: readonly string[] } => {
      const sorted = this.#geometry ? order(entities, recordName) : undefined;

      return sorted === undefined ? {} : { drawOrder: sorted };
    };

    const layouts: ReadLayout[] = [];

    for (const draft of this.layouts.toSorted((a, b) => a.tab - b.tab)) {
      const recordName = spaceOf(draft);

      if (recordName === MODEL || draft.name.toUpperCase() === "MODEL") continue;
      const space = this.spaces.get(recordName);
      const { handle, name: layoutName, tab, blockRecord: _, space: _space, ...rest } = draft;

      if (!this.layoutSpaces.has(layoutName)) this.layoutSpaces.set(layoutName, recordName);
      const first = space?.viewports[0];

      if (first?.handle !== undefined && (first.id === undefined || first.id === 0))
        this.ownViewports.add(first.handle);
      const drawn = this.#geometry && this.#keepsSpace(recordName);
      layouts.push({
        handle,
        name: layoutName,
        tab,
        ...rest,
        viewports: (space?.viewports ?? [])
          .filter((v) => v.id !== 1)
          .map(({ id: _id, frozenLayers, ...v }) => ({
            ...v,
            frozenLayers: frozenLayers.map((h) => layerNames.get(h) ?? h),
          })),
        inserts: space?.inserts ?? [],
        census: (space?.census ?? new Census(0)).done(),
        ...(drawn && {
          entities: space?.entities ?? [],
          other: space?.other ?? map<number>(),
          ...(space && space.unread.length > 0 && { unread: space.unread }),
        }),
        ...(drawn && ordered(space?.entities, recordName)),
      });
    }

    // The first layout of each space, by the space's block in capitals.
    const layoutBySpace = new Map<string, string>();

    for (const draft of this.layouts) {
      const spaceName = spaceOf(draft);

      if (!layoutBySpace.has(spaceName)) layoutBySpace.set(spaceName, draft.name);
    }

    for (const spaceName of this.spaces.keys()) {
      if (spaceName !== MODEL && !layoutBySpace.has(spaceName)) {
        add(this.unread.malformed, "paper space with no layout");
      }
    }

    const layoutOf = (spaceName: string | undefined): string | undefined =>
      spaceName === undefined || spaceName === MODEL ? undefined : layoutBySpace.get(spaceName);

    const model = this.spaces.get(MODEL);
    const opensAt = this.#opensAt(this.layouts, spaceOf);

    const fields: ReadField[] = [];
    const otherFields: Record<string, number> = map();
    const reached = new Set<string>();
    // Each MTEXT walks its own fields, and many may share them, so the walks share one budget
    // of fields looked at, and the fields kept stop at the limit.
    let work = FIELD_WORK;
    // True once any walk was cut short, so a field not reached may be one an MTEXT shows.
    let exhausted = false;

    for (const mtext of this.mtexts) {
      const fieldDictionary = this.dictionaries.get(mtext.dictionary)?.ACAD_FIELD;

      const top =
        fieldDictionary === undefined ? undefined : this.dictionaries.get(fieldDictionary)?.TEXT;

      if (top === undefined) continue;

      if (work <= 0) {
        this.#fieldsPast++;
        exhausted = true;
        continue;
      }

      const seen = new Set<string>();
      const stack = [top];
      let cut = false;

      while (stack.length > 0 && work > 0) {
        const handle = stack.pop()!;

        // A field is read once, however many MTEXTs reach it: it is kept for the first.
        if (seen.has(handle) || reached.has(handle)) continue;
        work--;
        seen.add(handle);
        reached.add(handle);
        const field = this.fieldObjects.get(handle);

        if (!field) continue;

        if (field.evaluator !== "_text") {
          const kind = fieldKind(field.code);

          if (kind === undefined) add(otherFields, field.code === "" ? "empty" : "other");
          else if (!kept(field.code)) add(otherFields, kind);
          else if (fields.length >= this.#limits.census) this.#fieldsPast++;
          else {
            const layout = layoutOf(mtext.space);
            fields.push({
              handle,
              code: field.code,
              text: {
                handle: mtext.handle,
                at: mtext.at,
                height: mtext.height,
                width: mtext.width,
                layer: mtext.layer,
                ...(layout !== undefined && { layout }),
                ...(mtext.block !== undefined && { block: mtext.block }),
              },
            });
          }
        }

        if (field.children.length > 0 && field.children.length >= work) cut = true;
        work -= field.children.length;

        for (let k = field.children.length - 1; k >= 0 && work > 0; k--) {
          stack.push(field.children[k]!);
        }
      }

      if (stack.length > 0 || cut) {
        this.#fieldsPast++;
        exhausted = true;
      }
    }

    // A field of a TEXT or an attribute, or one nothing reaches, is counted, not read.
    for (const [handle, field] of this.fieldObjects) {
      // Once the budget ran out, a field not reached may be one an MTEXT shows.
      if (!reached.has(handle) && field.evaluator !== "_text") {
        add(otherFields, exhausted ? "past the limit" : "not on an MTEXT");
      }
    }

    if (this.#fieldsPast > 0) add(otherFields, "past the limit", this.#fieldsPast);

    for (const image of this.#images) {
      const definition =
        image.definition === undefined ? undefined : this.#imageDefinitions.get(image.definition);

      imageInWorld(image, definition?.path);
    }

    for (const underlay of this.#underlays) {
      const definition =
        underlay.definition === undefined
          ? undefined
          : this.#underlayDefinitions.get(underlay.definition);

      underlayInWorld(underlay, definition);
    }

    const underlaysListed = new Set<string>();
    const underlays: ReadUnderlayDefinition[] = [];

    const listUnderlay = (handle: string, name: string): void => {
      const definition = this.#underlayDefinitions.get(handle);

      if (definition === undefined || underlaysListed.has(handle)) return;
      underlaysListed.add(handle);
      underlays.push({
        handle,
        name,
        ...definition,
        underlays: this.#underlayUses.get(handle) ?? 0,
      });
    };

    for (const [name, handle] of this.#underlayEntries) listUnderlay(handle, name);

    for (const handle of this.#underlayDefinitions.keys()) listUnderlay(handle, "");

    const pdfFrame =
      this.#pdfFrameVariable === undefined
        ? undefined
        : Number(this.#variables.get(this.#pdfFrameVariable));

    // The dictionary's definitions in its order, then any it does not list.
    const listed = new Set<string>();
    const images: ReadImageDefinition[] = [];

    const listDefinition = (handle: string, name: string): void => {
      const definition = this.#imageDefinitions.get(handle);

      if (definition === undefined || listed.has(handle)) return;
      listed.add(handle);
      images.push({ handle, name, ...definition, images: this.#imageUses.get(handle) ?? 0 });
    };

    for (const [name, handle] of this.#imageEntries) listDefinition(handle, name);

    for (const handle of this.#imageDefinitions.keys()) listDefinition(handle, "");

    return {
      format: READ_FORMAT,
      sha256,
      bytes,
      images,
      underlays,
      ...(pdfFrame === 0 && { underlayFrame: false as const }),
      ...(pdfFrame === 2 && { underlayFrame: "screen" as const }),
      tableStyles,
      ...(groups.version !== undefined && { version: groups.version }),
      ...(groups.codepage !== undefined && { codepage: groups.codepage }),
      encoding: groups.encoding,
      // SAFETY: each field set is one of ReadHeader's, a number or for the styles a string.
      header: header as ReadHeader,
      layers: this.layers,
      linetypes: withMarks(this.linetypes, this.#marked, this.#stylesByHandle),
      textStyles: this.textStyles,
      dimensionStyles,
      leaderStyles: this.#leaderStylesRead(styleNames),
      edits: this.#editEntries.flatMap(([name, handle]) => {
        const additions = this.#editRecords.get(handle);

        return additions === undefined ? [] : [{ name, handle, additions }];
      }),
      blocks: this.blocks.map((draft): ReadBlock => {
        const { block: _, ownRoom: _own, ...block } = draft;
        const sorted = order(block.entities, block.name);

        return sorted === undefined ? block : { ...block, drawOrder: sorted };
      }),
      xrefs: this.xrefs,
      model: {
        census: (model?.census ?? new Census(0)).done(),
        ...(this.#geometry && {
          entities: model?.entities ?? [],
          other: model?.other ?? map<number>(),
          ...(model && model.unread.length > 0 && { unread: model.unread }),
        }),
        ...ordered(model?.entities, MODEL),
      },
      layouts,
      fields,
      otherFields,
      unread: this.unread,
      ...(opensAt !== undefined && { opensAt }),
      ...(this.#part && { only: this.#part.filter.part }),
      ...(this.#ownBlocks.size > 0 && { blocksAsked: [...this.#ownBlocks] }),
    };
  }

  /**
   * The view the file opens at: model space's `*Active` view when `$TILEMODE` is 1 or missing,
   * and otherwise the view of its paper the layout in `*Paper_Space` keeps in its first viewport.
   */
  #opensAt(
    layouts: readonly LayoutDraft[],
    spaceOf: (draft: LayoutDraft) => string,
  ): ReadView | undefined {
    const tilemode = Number(this.header.$TILEMODE ?? "1");

    if (tilemode !== 0) return this.#activeView;
    const draft = layouts.find((d) => spaceOf(d) === "*PAPER_SPACE");
    const sheet = this.spaces.get("*PAPER_SPACE")?.viewports.find((v) => v.id === 1);

    if (draft === undefined || sheet === undefined) return undefined;
    const width = sheet.height > 0 ? (sheet.viewHeight * sheet.width) / sheet.height : 0;

    if (!Number.isFinite(width)) return undefined;

    return { layout: draft.name, center: sheet.viewCenter, height: sheet.viewHeight, width };
  }

  /**
   * Works out where each justified text starts whose file holds its alignment point as its first
   * point, from tsdraft's widths of its font's characters, where they give it exactly.
   */
  #startsOfTexts(): void {
    if (this.#starts.length === 0) return;
    const fonts = new Map<string, { readonly font: Font; readonly exact: boolean }>();

    for (const style of this.textStyles) {
      if (style.name.length > LONGEST_NAME) continue;
      const key = layerKey(style.name);

      if (!fonts.has(key)) fonts.set(key, nearestFont(style.family ?? style.font ?? ""));
    }

    for (const { placement, value, own, rotation, face, flags } of this.#starts) {
      const { align = "left", valign = "baseline" } = placement;

      if (align !== "left" && align !== "center" && align !== "right") continue;

      // A text mirrored in its own coordinates is placed by a rule the widths do not hold.
      if ((flags & 6) !== 0 || placement.style.length > LONGEST_NAME) continue;
      const font = fonts.get(layerKey(placement.style));

      if (!font?.exact) continue;

      const layout = layoutText({
        value,
        height: placement.height,
        font: font.font,
        widthFactor: placement.widthFactor ?? 1,
        align,
        valign,
      });

      if (layout.approximate) continue;
      const [along, up] = [layout.end - layout.advance, layout.baseline];
      const turn = (rotation * Math.PI) / 180;

      const start: Point = [
        own[0] + along * Math.cos(turn) - up * Math.sin(turn),
        own[1] + along * Math.sin(turn) + up * Math.cos(turn),
      ];

      if (!Number.isFinite(start[0]) || !Number.isFinite(start[1])) continue;
      placement.at = placed(start, face);
      placement.startFrom = "widths";
    }
  }

  /**
   * Names each multileader's style, its note's style and its block, which the file names by
   * handle, and keys its block's labels by the tags of the definitions they fill, which the blocks
   * read hold. The names are charged to the budget the leader was kept in, and a leader they do
   * not fit is counted as past the limit and left out.
   */
  #leaderStyles(styleNames: ReadonlyMap<string, string>): void {
    const left = new Set<ReadEntity>();
    const targets = new Set<Target>();
    let tags: Map<string, string> | undefined;

    for (const { entity, style, textStyle, block, target } of this.#leaders) {
      const named = style === undefined ? undefined : this.leaderStyles.get(style);
      const note = (textStyle === undefined ? undefined : styleNames.get(textStyle)) ?? "Standard";
      const blockName = block === undefined ? "" : (this.blockRecords.get(block) ?? "");
      let cost = nameCost(named) + nameCost(note) - nameCost(entity.textStyle);

      if (entity.block) cost += nameCost(blockName) - nameCost(entity.block.name);
      const held = entity.block?.attributes;
      let attributes: Record<string, string> | undefined;

      if (held) {
        tags ??= this.#definitionTags();

        for (const definition in held) {
          const tag = tags.get(definition);

          if (tag === undefined || tag.length > LONGEST_NAME || (attributes && tag in attributes))
            continue;
          attributes ??= map<string>();
          attributes[tag] = held[definition]!;
          cost += nameCost(tag) - nameCost(definition);
        }
      }

      if (target && !this.#fits(target, cost)) {
        add(target.other, "past the limit");
        left.add(entity);
        targets.add(target);
        continue;
      }

      if (target) this.#spend(target, cost);
      // SAFETY: the reader made the entity, and finishes it here before the read is given out.
      const mutable = entity as { style?: string; textStyle: string; block?: object };

      if (named !== undefined) mutable.style = named;
      mutable.textStyle = note;

      if (entity.block) {
        const { attributes: _, ...rest } = entity.block;
        mutable.block = { ...rest, name: blockName, ...(attributes && { attributes }) };
      }
    }

    for (const target of targets) target.entities = target.entities.filter((e) => !left.has(e));
  }

  /** The multileader styles the dictionary of them names, in its order, with their sizes. */
  #leaderStylesRead(styleNames: ReadonlyMap<string, string>): ReadLeaderStyle[] {
    const out: ReadLeaderStyle[] = [];

    for (const [handle, name] of this.leaderStyles) {
      const held = this.#leaderStyleObjects.get(handle.toUpperCase());

      if (held === undefined) continue;

      const textStyle =
        held.textStyleHandle === undefined ? undefined : styleNames.get(held.textStyleHandle);

      const arrowhead =
        held.arrowheadHandle === undefined
          ? undefined
          : this.blockRecords.get(held.arrowheadHandle);

      out.push({
        handle,
        name,
        ...(textStyle !== undefined && { textStyle }),
        ...(arrowhead !== undefined && { arrowheadBlock: arrowhead }),
        ...held.style,
      });
    }

    return out;
  }

  /**
   * The table styles the dictionary of them names, in its order, and the style of each table and
   * whether its first rows are a title and a header, from its style and its own groups. A style's
   * name is charged to the budget its table was kept in, and a table it does not fit is counted as
   * past the limit and left out.
   */
  #tableStyles(): ReadTableStyle[] {
    const styles: ReadTableStyle[] = [];
    const named = new Map<string, { readonly name: string; readonly held: TableStyleHeld }>();

    for (const [styleName, handle] of this.#tableStyleEntries) {
      const key = handle.toUpperCase();
      const held = this.#tableStyleObjects.get(key);

      if (held === undefined || named.has(key)) continue;
      named.set(key, { name: styleName, held });
      styles.push({ handle, name: styleName, ...held.style });
    }

    const left = new Set<ReadEntity>();
    const targets = new Set<Target>();

    for (const { entity, target, style, noTitle, noHeader } of this.#tables) {
      const found = style === undefined ? undefined : named.get(style.toUpperCase());
      const cost = nameCost(found?.name);

      if (!this.#fits(target, cost)) {
        add(target.other, "past the limit");
        left.add(entity);
        targets.add(target);
        continue;
      }

      this.#spend(target, cost);
      const rows = entity.rows.length;
      const title = !(noTitle ?? found?.held.noTitle ?? false) && rows > 0;
      const header = !(noHeader ?? found?.held.noHeader ?? false) && rows > (title ? 1 : 0);
      // SAFETY: the reader made the table, and finishes it here before the read is given out.
      const mutable = entity as { style?: string; title: boolean; header: boolean };

      if (found !== undefined) mutable.style = found.name;
      mutable.title = title;
      mutable.header = header;
    }

    for (const target of targets) target.entities = target.entities.filter((e) => !left.has(e));

    return styles;
  }

  /** The tag of each attribute definition the blocks read hold, by its handle in capitals. */
  #definitionTags(): Map<string, string> {
    const tags = new Map<string, string>();

    for (const block of this.blocks)
      for (const { handle, tag } of block.attributeDefinitions)
        if (handle !== undefined && !tags.has(handle.toUpperCase()))
          tags.set(handle.toUpperCase(), tag);

    return tags;
  }

  /** Gives each insert and dimension the handle of its block's record, found as the leading CAD app finds it. */
  #blockHandles(): void {
    const records = new Map<string, string>();

    for (const [handle, recordName] of this.blockRecords) {
      if (recordName.length > LONGEST_NAME) continue;
      const key = layerKey(recordName);

      if (!records.has(key)) records.set(key, handle);
    }

    if (records.size === 0) return;

    const named = (entities: readonly ReadEntity[]): void => {
      for (const entity of entities) {
        if (
          entity.kind !== "insert" &&
          entity.kind !== "dimension" &&
          entity.kind !== "radial-dimension" &&
          entity.kind !== "angular-dimension" &&
          entity.kind !== "arc-length-dimension" &&
          entity.kind !== "ordinate-dimension" &&
          !(entity.kind === "table" && entity.blockHandle === undefined)
        )
          continue;
        const block = entity.block;

        if (block === undefined || block.length > LONGEST_NAME) continue;
        const handle = records.get(layerKey(block));

        if (handle === undefined) continue;
        // SAFETY: the reader made the entity, and finishes it here before the read is given out.
        (entity as { blockHandle?: string }).blockHandle = handle;
      }
    };

    for (const block of this.blocks) named(block.entities);

    for (const space of this.spaces.values()) {
      named(space.entities);
      named(space.inserts);
    }
  }
}

/**
 * An insert from its record. Seen from below, its X mirrors and it turns the other way, so its
 * X scale is negated and its rotation too.
 */
function insertOf(r: Rec, base: ReadEntityBase, face: Facing): Omit<ReadInsert, "tags"> {
  const rotation = num(r, 50) ?? 0;
  const sx = num(r, 41) ?? 1;

  return {
    ...base,
    kind: "insert",
    block: name(r, 2) ?? "",
    at: placed(point(r, 10), face),
    scale: [face === -1 ? -sx : sx, num(r, 42) ?? 1],
    rotation: face === -1 ? ((-rotation % 360) + 360) % 360 : rotation,
  };
}

function viewport(
  r: Rec,
  handle: string | undefined,
  layer: string,
): (ReadViewport & { id: number | undefined }) | undefined {
  const height = num(r, 41) ?? 0;
  const viewHeight = num(r, 45) ?? 0;
  const twist = num(r, 51) ?? 0;
  const [cx, cy] = point(r, 12);
  const [tx, ty] = point(r, 17);
  // The view's center is in the coordinates of its display, which turn with its twist and
  // start at its target.
  const t = (-twist * Math.PI) / 180;

  const viewCenter: Point = [
    tx + cx * Math.cos(t) - cy * Math.sin(t),
    ty + cx * Math.sin(t) + cy * Math.cos(t),
  ];

  // Bit 17 of group 90 turns a viewport off. Group 68 is 0 for one that is off, and may be 0 for a
  // viewport of a layout that is not current, so it decides only where group 90 is missing.
  const status = num(r, 90);
  const frozenLayers: string[] = [];

  for (let i = 0; i < r.codes.length; i++) {
    if (r.codes[i] === 331) frozenLayers.push(r.values[i]!);
  }

  const direction = [num(r, 16) ?? 0, num(r, 26) ?? 0, num(r, 36) ?? 1];
  const ratio = viewHeight > 0 ? height / viewHeight : 0;

  // Numbers near the largest double can sum or divide to Infinity, which no answer holds.
  if (![...viewCenter, ratio].every(Number.isFinite)) return undefined;

  return {
    id: num(r, 69),
    handle,
    layer,
    center: point(r, 10),
    width: num(r, 40) ?? 0,
    height,
    viewCenter,
    viewHeight,
    ratio,
    twist,
    on: status === undefined ? (num(r, 68) ?? 1) !== 0 : (status & 0x20000) === 0,
    frozenLayers,
    turnedView: direction[0] !== 0 || direction[1] !== 0 || direction[2]! <= 0,
    // Bit 16 of group 90 clips the viewport by the entity group 340 names.
    ...(status !== undefined &&
      (status & 0x10000) !== 0 &&
      handleAt(r, 340) !== undefined && { clipBy: handleAt(r, 340)! }),
  };
}

/** The most points of a clip's outline kept. A longer one clips nothing. */
const CLIP_POINTS = 4096;

/**
 * The outline of a spatial filter in the coordinates of the block its insert places: its
 * points, two for a rectangle's corners, on the plane its normal and origin give, taken through
 * the inverse of the insert's matrix the filter holds. Undefined for a filter in another plane, or
 * one whose numbers do not read.
 */
function spatialOutline(r: Rec): Point[] | undefined {
  // Group 71 is 0 for a clip turned off, which clips nothing.
  if (num(r, 71) === 0) return undefined;
  const count = num(r, 70) ?? 0;
  const normal = [num(r, 210) ?? 0, num(r, 220) ?? 0, num(r, 230) ?? 1];

  if (normal[0] !== 0 || normal[1] !== 0 || !(normal[2]! > 0)) return undefined;
  const [ox, oy] = point(r, 11);
  const points: Point[] = [];
  const numbers: number[] = [];

  for (let i = 0; i < r.codes.length; i++) {
    if (r.codes[i] === 10 && points.length < CLIP_POINTS) {
      points.push([
        Number(r.values[i]) + ox,
        (r.codes[i + 1] === 20 ? Number(r.values[i + 1]) : 0) + oy,
      ]);
    } else if (r.codes[i] === 40) numbers.push(Number(r.values[i]));
  }

  if (points.length !== count || count < 2) return undefined;
  // The front clip's distance comes before the two matrices when group 72 is 1.
  const at = num(r, 72) === 1 ? 1 : 0;
  const m = numbers.slice(at, at + 12);

  const toBlock = (p: Point): Point =>
    m.length === 12
      ? [m[0]! * p[0] + m[1]! * p[1] + m[3]!, m[4]! * p[0] + m[5]! * p[1] + m[7]!]
      : p;

  const [a, b] = points;
  const corners: Point[] = count === 2 ? [a!, [b![0], a![1]], b!, [a![0], b![1]]] : points;
  const outline = corners.map(toBlock);

  return outline.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)) ? outline : undefined;
}

/** The view of a `*Active` record of the viewport table, from its center, target and twist. */
function activeView(r: Rec): Omit<ReadView, "layout"> | undefined {
  const height = num(r, 40) ?? 0;
  const width = height * (num(r, 41) ?? 1);
  const twist = num(r, 51) ?? 0;
  const [cx, cy] = point(r, 12);
  const [tx, ty] = point(r, 17);
  const t = (-twist * Math.PI) / 180;

  const center: Point = [
    tx + cx * Math.cos(t) - cy * Math.sin(t),
    ty + cx * Math.sin(t) + cy * Math.cos(t),
  ];

  return [...center, width].every(Number.isFinite) ? { center, height, width } : undefined;
}

/** The kind of a field's code, such as `\AcVar Filename` or `\AcDiesel`. */
function fieldKind(code: string): string | undefined {
  const match = /^\s*\\(\w+)(?:\s+([A-Za-z_][\w.]*))?/.exec(code);

  if (!match) return undefined;

  return match[1]!.toLowerCase() === "acvar" && match[2]
    ? `\\${match[1]} ${match[2]}`
    : `\\${match[1]}`;
}

/** True for a code the learner maps: the file's name, the layout's name, or today's date. */
function kept(code: string): boolean {
  if (/^\s*\\AcVar\s+(Filename|ctab|Date)\b/i.test(code)) return true;

  return /^\s*\\AcDiesel\b/i.test(code) && /\bctab\b/i.test(code);
}

/** A linetype's mark as its groups give it, before the styles' table names its style. */
interface PendingMark {
  readonly after: number;
  readonly flags: number;
  readonly values: Map<number, string>;
}

/** What a linetype's text height is multiplied by: a style's fixed height, or 1 for none. */
const fixed = (height: number): number => (Number.isFinite(height) && height > 0 ? height : 1);

/** A handle as a key: its digits in capitals. */
const normalHandle = (handle: string): string => handle.trim().toUpperCase();

/** The groups of a mark after its 74: shape number, style, scale, rotation, offsets, text. */
const MARK_CODES = new Set([75, 340, 46, 50, 44, 45, 9]);

/**
 * The linetypes with their marks, each text's style and each shape's file named from the style
 * its handle finds. A mark whose numbers are not finite, or whose style is not found, is left out.
 * A text is as high as its style's fixed height times its own, as the leading CAD app draws it.
 */
function withMarks(
  linetypes: readonly ReadLinetype[],
  marked: readonly (readonly [number, readonly PendingMark[]])[],
  styles: ReadonlyMap<string, { name: string; file: string; height: number }>,
): ReadLinetype[] {
  const out = [...linetypes];

  for (const [index, pending] of marked) {
    const marks: ReadLinetypeMark[] = [];

    for (const m of pending) {
      const number = (code: number, fallback: number): number => {
        const v = m.values.get(code);

        return v === undefined ? fallback : Number(v);
      };

      const [size, rotation, x, y] = [number(46, 1), number(50, 0), number(44, 0), number(45, 0)];

      if (![size, rotation, x, y].every(Number.isFinite)) continue;
      const style = styles.get(normalHandle(m.values.get(340) ?? ""));

      if (style === undefined) continue;

      const orient: "absolute" | "upright" | undefined =
        (m.flags & 1) !== 0 ? "absolute" : (m.flags & 8) !== 0 ? "upright" : undefined;

      const common = {
        after: m.after,
        ...(rotation !== 0 && { rotation }),
        ...(orient !== undefined && { orient }),
        ...((x !== 0 || y !== 0) && { offset: [x, y] as const }),
      };

      if ((m.flags & 2) !== 0) {
        const text = unescaped(m.values.get(9) ?? "");
        marks.push({ ...common, text, style: style.name, height: size * fixed(style.height) });
      } else {
        const glyph = number(75, 0);

        if (!Number.isInteger(glyph)) continue;
        marks.push({ ...common, glyph, file: style.file, scale: size });
      }
    }

    if (marks.length > 0) out[index] = { ...out[index]!, marks };
  }

  return out;
}
