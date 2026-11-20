// `readDXF`: the read model of an ASCII DXF, read as its bytes arrive. It keeps the tables, the
// blocks, the xrefs, the layouts and the fields, counts what each space draws and, when asked,
// keeps what each space draws.
import type { Point } from "../drawing.ts";
import { nearestFont, type Font } from "../fonts.ts";
import { layerKey } from "../layers.ts";
import { layoutText } from "../measure.ts";
import { DxfDocumentReader, type DxfDocument } from "./document.ts";
import {
  attributeCost,
  attributeOf,
  baseOf,
  brokenNumber,
  costOf,
  handleAt,
  imageInWorld,
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
  type ReadEntity,
  type ReadEntityBase,
  type ReadField,
  type ReadHeader,
  type ReadImage,
  type ReadImageDefinition,
  type ReadInsert,
  type ReadLayer,
  type ReadLayerCensus,
  type ReadLayout,
  type ReadLinetype,
  type ReadMultileader,
  type ReadOptions,
  type ReadTextStyle,
  type ReadView,
  type ReadViewport,
  type ReadXref,
} from "./model.ts";

/**
 * Reads an ASCII DXF of any version: from a string, or from its bytes as they arrive. It never
 * holds the whole file. It throws a `ReadError` for a file it cannot read at all, such as a
 * binary DXF or one whose groups are out of step, and reads everything else, counting what it
 * did not understand. With `geometry`, it keeps what model space and each layout draws too.
 */
export function readDXF(
  input: string | AsyncIterable<Uint8Array>,
  options: ReadOptions = {},
): Promise<DrawingRead> {
  return readDXFWithin(input, options, READ_LIMITS);
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
  const reader = new DxfReader(options, limits);
  const text = typeof input === "string";
  const groups = new GroupReader((code, value) => reader.group(code, value), text);
  const push = (chunk: Uint8Array): void => {
    document?.push(chunk);
    groups.push(chunk);
  };
  if (typeof input === "string") {
    // A string is text already: its UTF-8 bytes are read, whatever its header says.
    const encoder = new TextEncoder();
    for (let i = 0; i < input.length;) {
      let end = Math.min(i + (1 << 20), input.length);
      // A piece never ends between the two halves of a surrogate pair.
      const last = input.charCodeAt(end - 1);
      if (end < input.length && last >= 0xd800 && last <= 0xdbff) end--;
      push(encoder.encode(input.slice(i, end)));
      i = end;
    }
  } else if (input instanceof Uint8Array) {
    push(input);
  } else {
    for await (const chunk of input) push(chunk);
  }
  const { sha256, bytes } = groups.end();
  return { read: reader.finish(sha256, bytes, groups) };
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
  "ARC",
  "ATTDEF",
  "ATTRIB",
  "CIRCLE",
  "DIMENSION",
  "HATCH",
  "IMAGE",
  "INSERT",
  "LARGE_RADIAL_DIMENSION",
  "LEADER",
  "LINE",
  "LWPOLYLINE",
  "MTEXT",
  "MULTILEADER",
  "POLYLINE",
  "SEQEND",
  "SOLID",
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
  "MTEXT",
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
  "TABLESTYLE",
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

/** Where the entities a reading keeps go: a block's definition, or a space read with geometry. */
interface Target {
  entities: ReadEntity[];
  other: Record<string, number>;
  /** True for a block, whose items count against `blockItems`. */
  block: boolean;
}

/** What a space holds while the reader is in it. */
interface Space extends Target {
  census: Census;
  viewports: (ReadViewport & { id: number | undefined })[];
  inserts: ReadInsert[];
}

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
  "$DIMSTYLE",
  "$TEXTSTYLE",
  "$TILEMODE",
  "$ACADVER",
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
}

/** A multileader whose styles and block are named by handle, until the file is read. */
interface PendingLeader extends LeaderNames {
  readonly entity: ReadMultileader;
  /** Where it was kept, which its names are charged to. */
  readonly target?: Target;
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

  readonly header: Record<string, string> = map();
  readonly layers: ReadLayer[] = [];
  readonly linetypes: ReadLinetype[] = [];
  readonly textStyles: ReadTextStyle[] = [];
  readonly dimensionStyles: (ReadDimensionStyle & {
    textStyleHandle?: string;
    arrowheadHandle?: string;
  })[] = [];
  /** Each block record's name, by its handle. */
  readonly blockRecords = new Map<string, string>();
  readonly blocks: BlockDraft[] = [];
  readonly xrefs: ReadXref[] = [];
  readonly spaces = new Map<string, Space>();
  readonly layouts: LayoutDraft[] = [];
  readonly mtexts: PendingMtext[] = [];
  /** The entries `ACAD_FIELD` and `TEXT` of each dictionary that has one, by its handle. */
  readonly dictionaries = new Map<string, Record<string, string>>();
  readonly fieldObjects = new Map<
    string,
    { evaluator: string; code: string; children: string[] }
  >();
  /** The dictionary of leader styles, which the root dictionary names. */
  #leaderStyleDictionary: string | undefined;
  /** Each leader style's name, by its handle. */
  readonly leaderStyles = new Map<string, string>();
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
  /** MTEXTs with a dictionary, and fields, past the limit of either list. */
  #fieldsPast = 0;
  #overflow = false;
  /**
   * The texts whose start is worked out, and the multileaders whose styles are named, at the end:
   * those of entities kept alone. What one record leaves waits in `#staged` until it is kept.
   */
  readonly #starts: PendingStart[] = [];
  readonly #leaders: PendingLeader[] = [];
  readonly #staged: { starts: PendingStart[]; leaders: PendingLeader[] } = {
    starts: [],
    leaders: [],
  };
  /** The images kept, to finish once the definitions are read. */
  readonly #images: ReadImage[] = [];
  /** How many images name each definition, by its handle. */
  readonly #imageUses = new Map<string, number>();
  /** The handle of the dictionary of image definitions, from the root dictionary. */
  #imageDictionary: string | undefined;
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

  constructor(options: ReadOptions, limits: ReadLimits) {
    this.#geometry = options.geometry === true;
    this.#limits = limits;
  }

  group(code: number, value: string): void {
    if (code === 0) {
      this.#end();
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
          type === "DICTIONARYVAR" ||
          type === "SORTENTSTABLE"
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
        for (let i = 0; i < r.codes.length; i++) {
          if (r.codes[i] === 49) pattern.push(Number(r.values[i]));
          if (r.codes[i] === 74 && Number(r.values[i]) !== 0) complex = true;
        }
        const description = name(r, 3);
        this.linetypes.push({
          handle,
          name: recordName,
          ...(description !== undefined && { description }),
          pattern: pattern.filter(Number.isFinite),
          complex,
        });
        return;
      }
      case "STYLE": {
        // A style with flag 1 holds a shape file; one with no name is the font of a complex
        // linetype's shapes.
        if (recordName === "" && (flags & 1) !== 0) return;
        const family = first(xdata(r, "ACAD"), 1000);
        this.textStyles.push({
          handle,
          name: recordName,
          ...(first(r, 3) !== undefined && { font: name(r, 3)! }),
          ...(first(r, 4) ? { bigFont: name(r, 4)! } : {}),
          ...(family !== undefined && family !== "" && { family: unescaped(family) }),
          ...(num(r, 40) !== undefined && { height: num(r, 40)! }),
          ...(num(r, 41) !== undefined && { widthFactor: num(r, 41)! }),
          ...(num(r, 50) !== undefined && { oblique: num(r, 50)! }),
          annotative: annotative(r),
          shapes: (flags & 1) !== 0,
        });
        return;
      }
      case "DIMSTYLE": {
        const fields: [keyof ReadDimensionStyle, number][] = [
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
        const style: Record<string, unknown> = { handle, name: recordName };
        style.annotative = annotative(r);
        for (const [field, code] of fields) {
          const n = num(r, code);
          if (n !== undefined) style[field] = n;
        }
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
        this.dimensionStyles.push(style as unknown as ReadDimensionStyle);
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
      } else if (!this.#geometry && /^\*D\d*$/i.test(blockName)) {
        this.#inDimensionPicture = true;
      } else {
        this.#block = {
          handle: ownerOf(r),
          name: blockName,
          base: point(r, 10),
          anonymous: (flags & 1) !== 0 || blockName.startsWith("*"),
          attributeDefinitions: [],
          entities: [],
          other: map(),
          block: true,
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
        block: false,
      };
      this.spaces.set(spaceName, space);
    }
    return space;
  }

  /** Where the entity read now is kept: its block, or its space when the read keeps geometry. */
  #target(): Target | undefined {
    return this.#block ?? (this.#geometry ? this.#space : undefined);
  }

  /** How many more items a target may keep. */
  #room(target: Target): number {
    return target.block
      ? this.#limits.blockItems - this.#blockItems
      : this.#limits.geometryItems - this.#geometryItems;
  }

  /**
   * Keeps an entity in its target, within the target's limit, or counts it as past the limit.
   * True when it is kept.
   */
  #kept(target: Target, entity: ReadEntity, cost = costOf(entity)): boolean {
    if (cost > this.#room(target)) {
      add(target.other, "past the limit");
      return false;
    }
    if (target.block) this.#blockItems += cost;
    else this.#geometryItems += cost;
    target.entities.push(entity);
    return true;
  }

  /** An entity of the current space or block. */
  #entity(r: Rec): void {
    if (this.#owner) {
      if (this.#owner.kind === "insert" && r.type === "ATTRIB") return this.#attribute(r);
      if (this.#owner.kind === "polyline" && r.type === "VERTEX") return this.#vertex(r);
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
        const flags = num(r, 70) ?? 0;
        const prompt = name(r, 3) === undefined ? undefined : textTwice(first(r, 3)!);
        const value = textTwice(first(r, 1) ?? "");
        const tag = textTwice(first(r, 2) ?? "");
        const cost = 4 + Math.floor((tag.length + value.length + (prompt?.length ?? 0)) / 32);
        if (cost > this.#room(block)) {
          add(block.other, "past the limit");
          return;
        }
        this.#blockItems += cost;
        const { placement, pending } = placementOf(r, face, value, 74);
        const definition = {
          handle,
          ...placement,
          tag,
          ...(prompt !== undefined && { prompt }),
          default: value,
          layer,
          invisible: (flags & 1) !== 0 || hidden(r),
          constant: (flags & 2) !== 0,
        };
        if (pending) this.#starts.push({ ...pending, placement: definition });
        block.attributeDefinitions.push(definition);
        return;
      }
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
    if (!target) return;
    if (hidden(r)) return add(target.other, "invisible");
    const reading = readingOf(r, baseOf(r, layer, handle), face, this.#later, this.#r12);
    const kept = reading !== undefined && "entity" in reading && this.#kept(target, reading.entity);
    if (kept && reading.entity.kind === "image") this.#images.push(reading.entity);
    for (const pending of this.#settle(kept, target)) this.#starts.push(pending);
    if (reading === undefined) add(target.other, r.type);
    else if ("other" in reading) add(target.other, reading.other);
    else if ("malformed" in reading) add(this.unread.malformed, reading.malformed);
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
      case "LARGE_RADIAL_DIMENSION": {
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
  #attribute(r: Rec): void {
    const owner = this.#owner as InsertOwner;
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
      owner.insert.tags[tag] = (first(r, 1) ?? "") !== "";
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
  #vertex(r: Rec): void {
    const owner = this.#owner as PolylineOwner;
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
      if (owner.over) add(target.other, "past the limit");
      else {
        const kept = owner.attributes ? { ...insert, attributes: owner.attributes } : insert;
        if (this.#kept(target, kept))
          for (const pending of owner.starts) this.#starts.push(pending);
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
    if (this.#spaceName !== MODEL && space.inserts.length < this.#limits.census)
      space.inserts.push(insert);
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
      });
    }
  }

  #object(r: Rec): void {
    switch (r.type) {
      case "DICTIONARY": {
        const handle = handleAt(r, 5);
        if (handle === undefined) return;
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
          if (key === "ACAD_FIELD" || key === "TEXT") {
            entries ??= {};
            entries[key] = value;
          } else if (key === "ACAD_MLEADERSTYLE") this.#leaderStyleDictionary ??= value;
          else if (key === "ACAD_IMAGE_DICT") this.#imageDictionary ??= value;
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
        this.layouts.push({
          handle: handleAt(r, 5),
          name: name(layout, 1) ?? "",
          tab: num(layout, 71) ?? 0,
          blockRecord: first(layout, 330),
          ...(first(plot, 4) !== undefined && { media: name(plot, 4)! }),
          ...(first(plot, 2) !== undefined && { plotter: name(plot, 2)! }),
          ...(width !== undefined && height !== undefined && { paperSize: [width, height] }),
          ...(num(plot, 72) !== undefined && { paperUnits: num(plot, 72)! }),
          ...(first(plot, 7) ? { plotStyleTable: name(plot, 7)! } : {}),
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
    const header: Record<string, unknown> = {};
    for (const [field, key] of [
      ["insunits", "$INSUNITS"],
      ["measurement", "$MEASUREMENT"],
      ["ltscale", "$LTSCALE"],
      ["psltscale", "$PSLTSCALE"],
      ["msltscale", "$MSLTSCALE"],
      ["dimscale", "$DIMSCALE"],
    ] as const) {
      const n = numberOf(key);
      if (n !== undefined) header[field] = n;
    }
    if (h.$DIMSTYLE !== undefined) header.dimstyle = unescaped(h.$DIMSTYLE);
    if (h.$TEXTSTYLE !== undefined) header.textstyle = unescaped(h.$TEXTSTYLE);
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
    this.#blockHandles();

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
        ...(this.#geometry && {
          entities: space?.entities ?? [],
          other: space?.other ?? map<number>(),
        }),
        ...ordered(space?.entities, recordName),
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
      ...(groups.version !== undefined && { version: groups.version }),
      ...(groups.codepage !== undefined && { codepage: groups.codepage }),
      encoding: groups.encoding,
      header: header as ReadHeader,
      layers: this.layers,
      linetypes: this.linetypes,
      textStyles: this.textStyles,
      dimensionStyles,
      blocks: this.blocks.map((draft): ReadBlock => {
        const { block: _, ...block } = draft;
        const sorted = order(block.entities, block.name);
        return sorted === undefined ? block : { ...block, drawOrder: sorted };
      }),
      xrefs: this.xrefs,
      model: {
        census: (model?.census ?? new Census(0)).done(),
        ...(this.#geometry && {
          entities: model?.entities ?? [],
          other: model?.other ?? map<number>(),
        }),
        ...ordered(model?.entities, MODEL),
      },
      layouts,
      fields,
      otherFields,
      unread: this.unread,
      ...(opensAt !== undefined && { opensAt }),
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
      if (target && cost > this.#room(target)) {
        add(target.other, "past the limit");
        left.add(entity);
        targets.add(target);
        continue;
      }
      if (target?.block) this.#blockItems += cost;
      else if (target) this.#geometryItems += cost;
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
          entity.kind !== "angular-dimension"
        )
          continue;
        const block = entity.block;
        if (block === undefined || block.length > LONGEST_NAME) continue;
        const handle = records.get(layerKey(block));
        if (handle !== undefined) (entity as { blockHandle?: string }).blockHandle = handle;
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
  };
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
