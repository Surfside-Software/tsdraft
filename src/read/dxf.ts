// `readDXF`: the read model of an ASCII DXF, read as its bytes arrive. It keeps the tables, the
// blocks, the xrefs, the layouts and the fields, and counts what each space draws.
import type { Point } from "../drawing.ts";
import { GroupReader, unescaped } from "./groups.ts";
import {
  BLOCK_ITEMS,
  CENSUS_LIMIT,
  READ_FORMAT,
  type DrawingRead,
  type ReadAttributeDefinition,
  type ReadBlock,
  type ReadCensus,
  type ReadCensusDimension,
  type ReadCensusInsert,
  type ReadCensusText,
  type ReadDimensionStyle,
  type ReadEntity,
  type ReadField,
  type ReadHeader,
  type ReadInsert,
  type ReadLayer,
  type ReadLayerCensus,
  type ReadLayout,
  type ReadLinetype,
  type ReadTextStyle,
  type ReadViewport,
  type ReadXref,
} from "./model.ts";

/**
 * Reads an ASCII DXF of any version: from a string, or from its bytes as they arrive. It never
 * holds the whole file. It throws a `ReadError` for a file it cannot read at all, such as a
 * binary DXF or one whose groups are out of step, and reads everything else, counting what it
 * did not understand.
 */
export async function readDXF(input: string | AsyncIterable<Uint8Array>): Promise<DrawingRead> {
  const reader = new DxfReader();
  const text = typeof input === "string";
  const groups = new GroupReader((code, value) => reader.group(code, value), text);
  if (typeof input === "string") {
    // A string is text already: its UTF-8 bytes are read, whatever its header says.
    const encoder = new TextEncoder();
    for (let i = 0; i < input.length;) {
      let end = Math.min(i + (1 << 20), input.length);
      // A piece never ends between the two halves of a surrogate pair.
      const last = input.charCodeAt(end - 1);
      if (end < input.length && last >= 0xd800 && last <= 0xdbff) end--;
      groups.push(encoder.encode(input.slice(i, end)));
      i = end;
    }
  } else {
    for await (const chunk of input) groups.push(chunk);
  }
  const { sha256, bytes } = groups.end();
  return reader.finish(sha256, bytes, groups);
}

/** One record: its kind, from group 0, and its groups after that. */
interface Rec {
  type: string;
  codes: number[];
  values: string[];
}

/** Groups no reading needs and that can be long: binary data, and long xdata strings. */
const DROPPED = new Set([310, 311, 1004]);

/** The most fields the walks from every MTEXT look at in all. */
const FIELD_WORK = 1_000_000;

/** The most heights of one MTEXT's text that are kept. */
const MAX_INLINE_HEIGHTS = 64;

/** The most tags of one insert that are kept. */
const MAX_TAGS = 1000;

/** The most groups one record keeps. */
const MAX_GROUPS = 1_000_000;

const ALL: ReadonlySet<number> = new Set();
const NOTHING: ReadonlySet<number> = new Set();
/** What the census of a space reads of an entity it only counts. */
// 102 too, so that the owner is told from the handles of an application's group.
const CENSUS: ReadonlySet<number> = new Set([5, 6, 8, 62, 67, 102, 330, 370, 420]);
/** The kinds a block's definition reads whole. */
const BLOCK_READS = new Set([
  "ARC",
  "ATTDEF",
  "ATTRIB",
  "CIRCLE",
  "INSERT",
  "LINE",
  "LWPOLYLINE",
  "MTEXT",
  "POLYLINE",
  "SEQEND",
  "TEXT",
  "VERTEX",
]);
/** The kinds a space reads whole. */
const SPACE_READS = new Set([
  "ATTRIB",
  "DIMENSION",
  "INSERT",
  "MTEXT",
  "POLYLINE",
  "SEQEND",
  "TEXT",
  "VIEWPORT",
]);

/** Object kinds every file holds and that say nothing the read model keeps. */
const HOUSEKEEPING = new Set([
  "ACDBDETAILVIEWSTYLE",
  "ACDBDICTIONARYWDFLT",
  "ACDBPLACEHOLDER",
  "ACDBSECTIONVIEWSTYLE",
  "CELLSTYLEMAP",
  "DICTIONARYVAR",
  "FIELDLIST",
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
const READ_ENTITIES = new Set([
  "ARC",
  "ATTDEF",
  "ATTRIB",
  "CIRCLE",
  "DIMENSION",
  "INSERT",
  "LINE",
  "LWPOLYLINE",
  "MTEXT",
  "POLYLINE",
  "SEQEND",
  "TEXT",
  "VERTEX",
  "VIEWPORT",
]);

const first = (r: Rec, code: number): string | undefined => {
  const i = r.codes.indexOf(code);
  return i < 0 ? undefined : r.values[i];
};

const num = (r: Rec, code: number): number | undefined => {
  const value = first(r, code);
  if (value === undefined) return undefined;
  const n = Number(value);
  return value.trim() !== "" && Number.isFinite(n) ? n : undefined;
};

const point = (r: Rec, x: number): Point => [num(r, x) ?? 0, num(r, x + 10) ?? 0];

/**
 * How an entity's own coordinates lie in the world, from its extrusion, groups 210 to 230: 1 as
 * they are, -1 seen from below, which mirrors X, and 0 for any other direction.
 */
function facing(r: Rec): 1 | -1 | 0 {
  const x = num(r, 210) ?? 0;
  const y = num(r, 220) ?? 0;
  const z = num(r, 230) ?? 1;
  if (Math.abs(x) > 1e-9 || Math.abs(y) > 1e-9 || z === 0) return 0;
  return z > 0 ? 1 : -1;
}

/** A point of an entity's own coordinates, in the world's, for an entity that faces up or down. */
const placed = (p: Point, face: 1 | -1 | 0): Point => (face === -1 ? [-p[0], p[1]] : p);

/** An angle of an entity's own coordinates in the world's, in degrees. */
const turned = (angle: number, face: 1 | -1 | 0): number =>
  face === -1 ? (((180 - angle) % 360) + 360) % 360 : angle;

const name = (r: Rec, code: number): string | undefined => {
  const value = first(r, code);
  return value === undefined ? undefined : unescaped(value);
};

/** Each value of `code` after the subclass marker `subclass` (group 100) and before the next. */
function inSubclass(r: Rec, subclass: string): Rec {
  const out: Rec = { type: r.type, codes: [], values: [] };
  let inside = false;
  for (let i = 0; i < r.codes.length; i++) {
    if (r.codes[i] === 100) inside = r.values[i] === subclass;
    else if (inside) {
      out.codes.push(r.codes[i]!);
      out.values.push(r.values[i]!);
    }
  }
  return out;
}

/** The values of an application's xdata: what follows its 1001 group, up to the next. */
function xdata(r: Rec, app: string): Rec {
  const out: Rec = { type: r.type, codes: [], values: [] };
  let inside = false;
  for (let i = 0; i < r.codes.length; i++) {
    if (r.codes[i] === 1001) inside = r.values[i]!.toUpperCase() === app.toUpperCase();
    else if (inside) {
      out.codes.push(r.codes[i]!);
      out.values.push(r.values[i]!);
    }
  }
  return out;
}

/**
 * The handle of a record's owner: its first group 330 outside the groups an application opens
 * with 102, such as `{ACAD_REACTORS`, which hold handles of other objects.
 */
function ownerOf(r: Rec): string | undefined {
  let inside = false;
  for (let i = 0; i < r.codes.length; i++) {
    if (r.codes[i] === 102) inside = r.values[i]!.startsWith("{");
    else if (!inside && r.codes[i] === 330) return r.values[i];
  }
  return undefined;
}

/** The handle a 102 group `{NAME` opens, through its 360 or 330 group. */
function inGroup(r: Rec, group: string, code: number): string | undefined {
  let inside = false;
  for (let i = 0; i < r.codes.length; i++) {
    if (r.codes[i] === 102) inside = r.values[i] === group;
    else if (inside && r.codes[i] === code) return r.values[i];
  }
  return undefined;
}

/** Whether xdata of `AcadAnnotative` marks the object annotative. */
function annotative(r: Rec): boolean {
  const data = xdata(r, "AcadAnnotative");
  const flags = data.values.filter((_, i) => data.codes[i] === 1070);
  return flags[1]?.trim() === "1";
}

/**
 * An object keyed by names from the file. It has no prototype, so a name such as `constructor`
 * or `__proto__` is a key like any other.
 */
const map = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

const add = (counts: Record<string, number>, key: string, n = 1): void => {
  counts[key] = (counts[key] ?? 0) + n;
};

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
    if (items.length < CENSUS_LIMIT) items.push(item());
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

/** What a space or a block holds while the reader is in it. */
interface Space {
  census: Census;
  viewports: (ReadViewport & { id: number | undefined })[];
  inserts: ReadInsert[];
}

interface BlockDraft {
  handle: string | undefined;
  name: string;
  base: Point;
  anonymous: boolean;
  attributeDefinitions: ReadAttributeDefinition[];
  entities: ReadEntity[];
  other: Record<string, number>;
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

class DxfReader {
  #section = "";
  #variable = "";
  #rec: Rec | undefined;

  readonly header: Record<string, string> = map();
  readonly layers: ReadLayer[] = [];
  readonly linetypes: ReadLinetype[] = [];
  readonly textStyles: ReadTextStyle[] = [];
  readonly dimensionStyles: (ReadDimensionStyle & { textStyleHandle?: string })[] = [];
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
  #owner:
    | {
        kind: "insert";
        insert: ReadInsert & { tags: Record<string, boolean> };
        place: boolean;
        tags: number;
      }
    | {
        kind: "polyline";
        rec: Rec;
        points: Point[];
        arcs: boolean;
        wide: boolean;
        over: boolean;
        face: 1 | -1 | 0;
      }
    | undefined;

  #keep: ReadonlySet<number> = NOTHING;
  #blockItems = 0;
  /** MTEXTs with a dictionary, and fields, past the limit of either list. */
  #fieldsPast = 0;
  #overflow = false;

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
      else if (!(this.#variable in this.header)) this.header[this.#variable] = value;
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
    switch (this.#section) {
      case "TABLES":
        return ALL;
      case "OBJECTS":
        return type === "DICTIONARY" || type === "FIELD" || type === "LAYOUT" ? ALL : NOTHING;
      case "BLOCKS":
        if (type === "BLOCK" || type === "ENDBLK") return ALL;
        if (this.#inDimensionPicture) return NOTHING;
        if (this.#block) return BLOCK_READS.has(type) ? ALL : NOTHING;
        return SPACE_READS.has(type) ? ALL : type === "VERTEX" ? NOTHING : CENSUS;
      case "ENTITIES":
        return SPACE_READS.has(type) ? ALL : type === "VERTEX" ? NOTHING : CENSUS;
      default:
        return NOTHING;
    }
  }

  #end(): void {
    const r = this.#rec;
    this.#rec = undefined;
    if (!r) return;
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
    const handle = first(r, 5) ?? first(r, 105);
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
        ];
        const style: Record<string, unknown> = { handle, name: recordName };
        style.annotative = annotative(r);
        for (const [field, code] of fields) {
          const n = num(r, code);
          if (n !== undefined) style[field] = n;
        }
        const suffix = name(r, 3);
        if (suffix !== undefined && suffix !== "") style.suffix = suffix;
        const textStyle = first(r, 340);
        if (textStyle !== undefined) style.textStyleHandle = textStyle;
        this.dimensionStyles.push(style as unknown as ReadDimensionStyle);
        return;
      }
      case "BLOCK_RECORD":
        if (handle !== undefined) this.blockRecords.set(handle, recordName);
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
      if (upper === MODEL || upper.startsWith("*PAPER_SPACE")) {
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
      } else if (/^\*D\d*$/i.test(blockName)) {
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
      space = { census: new Census(), viewports: [], inserts: [] };
      this.spaces.set(spaceName, space);
    }
    return space;
  }

  /** An entity of the current space or block. */
  #entity(r: Rec): void {
    if (this.#owner) {
      if (this.#owner.kind === "insert" && r.type === "ATTRIB") {
        const tag = name(r, 2);
        const owner = this.#owner;
        if (tag !== undefined && (tag in owner.insert.tags || owner.tags < MAX_TAGS)) {
          if (!(tag in owner.insert.tags)) owner.tags++;
          owner.insert.tags[tag] = (first(r, 1) ?? "") !== "";
        }
        return;
      }
      if (this.#owner.kind === "polyline" && r.type === "VERTEX") {
        const flags = num(r, 70) ?? 0;
        // A spline's frame point is not a point of the polyline.
        if ((flags & 16) === 0 && this.#block && !this.#owner.over) {
          // A polyline that cannot fit what the blocks may still keep holds no more points.
          if (this.#blockItems + this.#owner.points.length >= BLOCK_ITEMS) {
            this.#owner.over = true;
            this.#owner.points = [];
          } else this.#owner.points.push(point(r, 10));
        }
        if ((num(r, 42) ?? 0) !== 0) this.#owner.arcs = true;
        if ((num(r, 40) ?? 0) !== 0 || (num(r, 41) ?? 0) !== 0) this.#owner.wide = true;
        return;
      }
      this.#closeOwner();
      if (r.type === "SEQEND") return;
    }
    if (r.type === "ATTRIB" || r.type === "VERTEX" || r.type === "SEQEND") {
      add(this.unread.malformed, r.type);
      return;
    }
    if (!READ_ENTITIES.has(r.type)) add(this.unread.entities, r.type);
    const layer = name(r, 8) ?? "0";
    const handle = first(r, 5);
    const space = this.#space;
    space?.census.count(r, layer);
    const block = this.#block;
    // LINE, MTEXT and a dimension's definition point are in the world's coordinates already.
    const face = r.type === "LINE" || r.type === "MTEXT" ? 1 : facing(r);
    // A block keeps no entity that stands in another plane; a polyline is judged at its end.
    const flat = face !== 0 || !block || r.type === "POLYLINE";
    if (!flat && r.type !== "INSERT") {
      if (BLOCK_READS.has(r.type)) add(block!.other, `${r.type} in 3D`);
      return;
    }

    switch (r.type) {
      case "LINE":
        this.#inBlock(block, { kind: "line", handle, layer, from: point(r, 10), to: point(r, 11) });
        return;
      case "CIRCLE":
        this.#inBlock(block, {
          kind: "circle",
          handle,
          layer,
          center: placed(point(r, 10), face),
          radius: num(r, 40) ?? 0,
        });
        return;
      case "ARC":
        // Seen from below, an arc runs the other way: its end is the world's start.
        this.#inBlock(block, {
          kind: "arc",
          handle,
          layer,
          center: placed(point(r, 10), face),
          radius: num(r, 40) ?? 0,
          start: turned(num(r, face === -1 ? 51 : 50) ?? 0, face),
          end: turned(num(r, face === -1 ? 50 : 51) ?? 0, face),
        });
        return;
      case "LWPOLYLINE": {
        if (!block) return;
        const points: Point[] = [];
        let arcs = false;
        let x: number | undefined;
        let broken = false;
        let wide = (num(r, 43) ?? 0) !== 0;
        for (let i = 0; i < r.codes.length; i++) {
          const code = r.codes[i];
          if (code === 10) x = Number(r.values[i]);
          else if (code === 20 && x !== undefined) {
            const y = Number(r.values[i]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) broken = true;
            points.push(placed([x, y], face));
            x = undefined;
          } else if (code === 42 && Number(r.values[i]) !== 0) arcs = true;
          else if ((code === 40 || code === 41) && Number(r.values[i]) !== 0) wide = true;
        }
        if (broken) {
          add(this.unread.malformed, "LWPOLYLINE with a point that is not a number");
          return;
        }
        if (arcs || wide) {
          add(block.other, arcs ? "LWPOLYLINE with arcs" : "LWPOLYLINE with widths");
          return;
        }
        this.#inBlock(block, {
          kind: "polyline",
          handle,
          layer,
          points,
          closed: ((num(r, 70) ?? 0) & 1) !== 0,
        });
        return;
      }
      case "POLYLINE":
        this.#owner = {
          kind: "polyline",
          rec: r,
          points: [],
          arcs: false,
          wide: (num(r, 40) ?? 0) !== 0 || (num(r, 41) ?? 0) !== 0,
          over: false,
          face,
        };
        return;
      case "TEXT": {
        const height = num(r, 40) ?? 0;
        const at = placed(point(r, 10), face);
        const style = name(r, 7) ?? "Standard";
        // A text seen from below reads backwards, which no rotation gives: it is counted.
        if (face === -1 && block) add(block.other, "TEXT seen from below");
        else {
          this.#inBlock(block, {
            kind: "text",
            handle,
            layer,
            at,
            height,
            value: name(r, 1) ?? "",
            rotation: num(r, 50) ?? 0,
            style,
          });
        }
        if (space) {
          space.census.list(space.census.texts, "texts", () => ({
            handle,
            kind: "TEXT" as const,
            layer,
            style,
            at,
            height,
          }));
        }
        return;
      }
      case "MTEXT": {
        const height = num(r, 40) ?? 0;
        const at = point(r, 10);
        const style = name(r, 7) ?? "Standard";
        if (block) add(block.other, "MTEXT");
        if (space) {
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
        if (dictionary !== undefined && this.mtexts.length >= CENSUS_LIMIT) this.#fieldsPast++;
        else if (dictionary !== undefined) {
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
      case "INSERT": {
        const insert = { ...insertOf(r, layer, handle, face), tags: map<boolean>() };
        if (!flat) add(block!.other, "INSERT in 3D");
        if (num(r, 66) === 1) this.#owner = { kind: "insert", insert, place: flat, tags: 0 };
        else if (flat) this.#placeInsert(insert);
        return;
      }
      case "ATTDEF": {
        if (!block) return;
        const flags = num(r, 70) ?? 0;
        const style = name(r, 7) ?? "Standard";
        const prompt = name(r, 3);
        if (this.#blockItems >= BLOCK_ITEMS) {
          add(block.other, "past the limit");
          return;
        }
        this.#blockItems++;
        block.attributeDefinitions.push({
          handle,
          tag: name(r, 2) ?? "",
          ...(prompt !== undefined && { prompt }),
          default: name(r, 1) ?? "",
          at: placed(point(r, 10), face),
          ...(num(r, 40) !== undefined && { height: num(r, 40)! }),
          style,
          layer,
          invisible: (flags & 1) !== 0,
          constant: (flags & 2) !== 0,
        });
        return;
      }
      case "DIMENSION": {
        if (block) add(block.other, "DIMENSION");
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
      case "VIEWPORT": {
        if (!space) {
          if (block) add(block.other, "VIEWPORT");
          return;
        }
        const read = viewport(r, handle, layer);
        if (read === undefined)
          add(this.unread.malformed, "VIEWPORT with a number past the doubles");
        else if (space.viewports.length < CENSUS_LIMIT) space.viewports.push(read);
        else space.census.capped = true;
        return;
      }
      default:
        if (block) add(block.other, r.type);
    }
  }

  /**
   * Keeps an entity of a block's definition, up to `BLOCK_ITEMS` in all, a polyline counting
   * its points. What comes past it is counted in the block's `other`.
   */
  #inBlock(block: BlockDraft | undefined, entity: ReadEntity): void {
    if (!block) return;
    const size = entity.kind === "polyline" ? Math.max(1, entity.points.length) : 1;
    if (this.#blockItems + size > BLOCK_ITEMS) {
      add(block.other, "past the limit");
      return;
    }
    this.#blockItems += size;
    block.entities.push(entity);
  }

  #placeInsert(insert: ReadInsert): void {
    this.#inBlock(this.#block, insert);
    const space = this.#space;
    if (!space) return;
    space.census.list(space.census.inserts, "inserts", () => ({
      handle: insert.handle,
      layer: insert.layer,
      block: insert.block,
      at: insert.at,
      scale: insert.scale,
    }));
    if (this.#spaceName !== MODEL && space.inserts.length < CENSUS_LIMIT)
      space.inserts.push(insert);
  }

  #closeOwner(): void {
    const owner = this.#owner;
    this.#owner = undefined;
    if (!owner) return;
    if (owner.kind === "insert") {
      if (owner.place) this.#placeInsert(owner.insert);
      return;
    }
    const block = this.#block;
    if (!block) return;
    const flags = num(owner.rec, 70) ?? 0;
    // 8 is a 3D polyline, 16 a mesh and 64 a face mesh.
    if ((flags & (8 | 16 | 64)) !== 0 || owner.face === 0) add(block.other, "POLYLINE in 3D");
    else if (owner.arcs) add(block.other, "POLYLINE with arcs");
    else if (owner.wide) add(block.other, "POLYLINE with widths");
    else if (owner.over) add(block.other, "past the limit");
    else {
      this.#inBlock(block, {
        kind: "polyline",
        handle: first(owner.rec, 5),
        layer: name(owner.rec, 8) ?? "0",
        points: owner.face === -1 ? owner.points.map((p) => placed(p, -1)) : owner.points,
        closed: (flags & 1) !== 0,
      });
    }
  }

  #object(r: Rec): void {
    switch (r.type) {
      case "DICTIONARY": {
        const handle = first(r, 5);
        if (handle === undefined) return;
        let entries: Record<string, string> | undefined;
        for (let i = 0; i < r.codes.length; i++) {
          if (r.codes[i] !== 3) continue;
          const key = r.values[i]!;
          const next = r.codes[i + 1];
          if ((key === "ACAD_FIELD" || key === "TEXT") && (next === 350 || next === 360)) {
            entries ??= {};
            entries[key] = r.values[i + 1]!;
          }
        }
        if (entries && this.dictionaries.size < 2 * CENSUS_LIMIT) {
          this.dictionaries.set(handle, entries);
        }
        return;
      }
      case "FIELD": {
        const handle = first(r, 5);
        if (handle === undefined) return;
        const field = inSubclass(r, "AcDbField");
        let code = "";
        const children: string[] = [];
        for (let i = 0; i < field.codes.length; i++) {
          if (field.codes[i] === 2 || field.codes[i] === 3) code += field.values[i];
          if (field.codes[i] === 360) children.push(field.values[i]!);
        }
        if (this.fieldObjects.size >= CENSUS_LIMIT) this.#fieldsPast++;
        else this.fieldObjects.set(handle, { evaluator: first(field, 1) ?? "", code, children });
        return;
      }
      case "LAYOUT": {
        const plot = inSubclass(r, "AcDbPlotSettings");
        const layout = inSubclass(r, "AcDbLayout");
        const width = num(plot, 44);
        const height = num(plot, 45);
        this.layouts.push({
          handle: first(r, 5),
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

    const layerNames = new Map<string, string>();
    for (const layer of this.layers) {
      if (layer.handle !== undefined) layerNames.set(layer.handle, layer.name);
    }
    const styleNames = new Map<string, string>();
    for (const style of this.textStyles) {
      if (style.handle !== undefined) styleNames.set(style.handle, style.name);
    }
    const dimensionStyles = this.dimensionStyles.map(({ textStyleHandle, ...style }) => {
      const textStyle = textStyleHandle === undefined ? undefined : styleNames.get(textStyleHandle);
      return textStyle === undefined ? style : { ...style, textStyle };
    });

    // A file before AutoCAD 2000's format has one paper space and no LAYOUT: AutoCAD opens it
    // as the layout `Layout1`.
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
        census: (space?.census ?? new Census()).done(),
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
          else if (fields.length >= CENSUS_LIMIT) this.#fieldsPast++;
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

    return {
      format: READ_FORMAT,
      sha256,
      bytes,
      ...(groups.version !== undefined && { version: groups.version }),
      ...(groups.codepage !== undefined && { codepage: groups.codepage }),
      encoding: groups.encoding,
      header: header as ReadHeader,
      layers: this.layers,
      linetypes: this.linetypes,
      textStyles: this.textStyles,
      dimensionStyles,
      blocks: this.blocks as ReadBlock[],
      xrefs: this.xrefs,
      model: { census: (this.spaces.get(MODEL)?.census ?? new Census()).done() },
      layouts,
      fields,
      otherFields,
      unread: this.unread,
    };
  }
}

/**
 * An insert from its record. Seen from below, its X mirrors and it turns the other way, so its
 * X scale is negated and its rotation too.
 */
function insertOf(
  r: Rec,
  layer: string,
  handle: string | undefined,
  face: 1 | -1 | 0,
): Omit<ReadInsert, "tags"> {
  const rotation = num(r, 50) ?? 0;
  const sx = num(r, 41) ?? 1;
  return {
    kind: "insert",
    handle,
    layer,
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
    if (r.codes[i] === 341) frozenLayers.push(r.values[i]!);
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
