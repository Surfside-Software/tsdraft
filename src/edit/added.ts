// What an edit's additions are in the file's read: each added entity as the readers read it, in the
// file's handles and names, with its mark; each definition the file lacks; and the record of the
// edit. Both writers take the marks from here, and `editedRead` the rest.
import type {
  DrawingRead,
  ReadBlock,
  ReadCensus,
  ReadDimensionStyle,
  ReadLeaderStyle,
  ReadTableStyle,
  ReadEntity,
  ReadLayer,
  ReadLinetype,
  ReadMark,
  ReadTextPlacement,
  ReadTextStyle,
} from "../read/model.ts";
import type { Point } from "../drawing.ts";
import { readDXFNow } from "../read/dxf.ts";
import { layerKey } from "../layers.ts";
import { isKeyed, isString } from "../guards.ts";
import { sha256Text } from "../sha256.ts";
import {
  planAdditions,
  type AdditionsFile,
  type AdditionsPlan,
  type DrawnSpace,
} from "./additions.ts";
import { STANDARD_STAND_IN } from "./file-tables.ts";
import { MARK_FORMAT, markHash } from "./marks.ts";
import type { Edit } from "./model.ts";
import { replacement, type Replacement } from "./replaced.ts";

/** One space's additions, as the read of the edited file holds them. */
export interface AddedSpace {
  /** The layout's name, or undefined for model space. */
  readonly layout: string | undefined;
  readonly entities: readonly ReadEntity[];
  readonly census: ReadCensus;
}

export interface Added {
  readonly plan: AdditionsPlan;
  /** What the edit makes of an earlier edit's additions of its name. */
  readonly replaced: Replacement;
  readonly spaces: readonly AddedSpace[];
  /** The mark of each record the additions write that carries one, by its handle. */
  readonly marks: ReadonlyMap<string, ReadMark>;
  /** The definitions the file lacks, as the read holds them. */
  readonly layers: readonly ReadLayer[];
  readonly linetypes: readonly ReadLinetype[];
  readonly textStyles: readonly ReadTextStyle[];
  readonly dimensionStyles: readonly ReadDimensionStyle[];
  readonly leaderStyles: readonly ReadLeaderStyle[];
  readonly tableStyles: readonly ReadTableStyle[];
  readonly blocks: readonly ReadBlock[];
  /** The record of the edit: each marked addition's id and handle, in the order written. */
  readonly record: readonly { readonly id: string; readonly handle: string }[];
}

/** A handle of a space's drawing as the file holds it, or as it was for one the file takes none of. */
const handleIn = (space: DrawnSpace, h: string | undefined): string | undefined =>
  h === undefined ? undefined : (space.handles.get(h.toUpperCase()) ?? h);

/** A read value with its handles and names the file's: what the space's drawing names, mapped. */
function inFile<T>(value: T, space: DrawnSpace, depth = 0): T {
  if (depth > 32 || !isKeyed(value)) return value;

  if (Array.isArray(value)) {
    // SAFETY: the list is mapped item by item, each to a value of its own type.
    return value.map((v) => inFile(v, space, depth + 1)) as T;
  }

  // SAFETY: each field is the same field of the same value, its handle or name the file's.
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => {
      if (isString(v) && (key === "handle" || key.endsWith("Handle")))
        return [key, handleIn(space, v)];

      if (isString(v) && (key === "style" || key === "textStyle") && standIn(v))
        return [key, "Standard"];

      if (isString(v) && (key === "block" || key === "name"))
        return [key, space.names.get(layerKey(v)) ?? v];

      return [key, inFile(v, space, depth + 1)];
    }),
  ) as T;
}

/**
 * A justified text, or an insert's attribute, as the copy stores it: where it starts, worked out
 * from the widths of its font, as a writer of another format works it out, in both formats.
 */
function started(e: ReadEntity): ReadEntity {
  const start = <T extends ReadTextPlacement>(t: T): T =>
    t.startFrom === "widths" ? { ...t, startFrom: "file", stored: t.at } : t;

  if (e.kind === "text") return start(e);

  if (e.kind === "insert" && e.attributes !== undefined)
    return { ...e, attributes: e.attributes.map((a) => start(a)) };

  return e;
}

/** The start each justified text and attribute of the additions takes, by its handle. */
export function startsOf(added: Added): Map<string, Point> {
  const out = new Map<string, Point>();

  for (const space of added.spaces)
    for (const e of space.entities) {
      if (e.kind === "text" && e.handle !== undefined && e.alignAt !== undefined)
        out.set(e.handle, e.at);

      if (e.kind === "insert")
        for (const a of e.attributes ?? [])
          if (a.handle !== undefined && a.alignAt !== undefined) out.set(a.handle, a.at);
    }

  return out;
}

const standIn = (name: string): boolean => layerKey(name).startsWith(layerKey(STANDARD_STAND_IN));

/** A census of a space's additions in the file's terms. */
const censusIn = (census: ReadCensus, space: DrawnSpace): ReadCensus => inFile(census, space);

/** The hash of a table record or a block as the read holds it, less its handle. */
const recordHash = (record: {
  readonly handle?: string | undefined;
  readonly name: string;
}): string => {
  const { handle: _, ...rest } = record;

  return sha256Text(JSON.stringify(rest)).slice(0, 32);
};

/** An edit's additions in the file's read, by the plan both writers follow. */
export function addedOf(read: DrawingRead, edit: Edit, file: AdditionsFile): Added {
  const replaced = replacement(read, edit);
  const plan = planAdditions(read, edit, file, replaced.reuse);
  const marks = new Map<string, ReadMark>();
  const record: { id: string; handle: string }[] = [];
  const taken = new Set(plan.transplants.map((t) => t.handle));
  const layers: ReadLayer[] = [];
  const linetypes: ReadLinetype[] = [];
  const textStyles: ReadTextStyle[] = [];
  const dimensionStyles: ReadDimensionStyle[] = [];
  const leaderStyles: ReadLeaderStyle[] = [];
  const listed = new Set<string>();
  const tableStyles: ReadTableStyle[] = [];
  const blocks: ReadBlock[] = [];
  const spaces: AddedSpace[] = [];

  const mark = (handle: string, id: string, hash: string): ReadMark => {
    const m: ReadMark = { format: MARK_FORMAT, name: edit.name, id, handle, hash };
    marks.set(handle, m);
    record.push({ id, handle });

    return m;
  };

  plan.spaces.forEach((space) => {
    const w = readDXFNow(space.text, { geometry: true });
    const entities: ReadEntity[] = [];

    for (const e of w.model.entities ?? []) {
      const own = started(inFile(e, space));
      const handle = own.handle;
      const marked = handle === undefined ? undefined : plan.marked.get(handle);

      entities.push(
        marked === undefined || handle === undefined
          ? own
          : { ...own, mark: mark(handle, marked.id, markHash(own)) },
      );
    }

    // A census lists a justified text where it starts, as the copy stores it.
    const at = new Map(
      entities.flatMap((e) =>
        e.kind === "text" && e.handle !== undefined ? [[e.handle, e.at]] : [],
      ),
    );

    const census = censusIn(w.model.census, space);
    spaces.push({
      layout: space.layout,
      entities,
      census: {
        ...census,
        texts: census.texts.map((t) => {
          const start = t.handle === undefined ? undefined : at.get(t.handle);

          return start === undefined ? t : { ...t, at: start };
        }),
      },
    });

    const isNew = (h: string | undefined): h is string => {
      const own = handleIn(space, h);

      return own !== undefined && taken.has(own) && !marks.has(own);
    };

    const definition = <T extends { readonly handle?: string | undefined; readonly name: string }>(
      list: readonly T[],
      table: string,
      into: T[],
      marked = true,
    ): void => {
      for (const item of list)
        if (isNew(item.handle)) {
          const own = inFile(item, space);

          // A definition two spaces need is the first's.
          if (listed.has(own.handle!)) continue;
          listed.add(own.handle!);

          // A table record is marked; an object, such as a style a dictionary names, is listed.
          if (marked) mark(own.handle!, `@${table}/${own.name}`, recordHash(own));
          into.push(own);
        }
    };

    definition(w.layers, "layers", layers);
    definition(w.linetypes, "linetypes", linetypes);
    definition(w.textStyles, "textStyles", textStyles);
    definition(w.dimensionStyles, "dimensionStyles", dimensionStyles);
    definition(w.leaderStyles ?? [], "leaderStyles", leaderStyles, false);
    definition(w.tableStyles, "tableStyles", tableStyles, false);

    for (const b of w.blocks)
      if (isNew(b.handle)) {
        const own = inFile(b, space);

        // A block the additions define is marked; an anonymous one is a picture of one of them.
        if (!own.anonymous)
          mark(own.handle!, `@blocks/${own.name}`, recordHash({ name: own.name }));
        blocks.push(own);
      }
  });

  return {
    plan,
    replaced,
    spaces,
    marks,
    layers,
    linetypes,
    textStyles,
    dimensionStyles,
    leaderStyles,
    tableStyles,
    blocks,
    record,
  };
}

/**
 * What the read tells of the file the additions go into: its seed, the names its tables hold, and
 * its layouts. A record the read does not list, such as an application's, is taken to be absent;
 * the plan gives such records their handles last, so none of the handles the read shows moves.
 */
export function readAdditionsFile(read: DrawingRead): AdditionsFile {
  const records = new Map<string, string>();

  const put = (table: string, name: string, handle: string | undefined): void => {
    records.set(`${table}:${layerKey(name)}`, handle ?? "?");
  };

  for (const l of read.layers) put("LAYER", l.name, l.handle);

  for (const name of ["ByLayer", "ByBlock", "Continuous"]) put("LTYPE", name, undefined);

  for (const l of read.linetypes) put("LTYPE", l.name, l.handle);
  put("STYLE", "Standard", undefined);

  for (const s of read.textStyles) put("STYLE", s.name, s.handle);
  put("DIMSTYLE", "Standard", undefined);

  for (const s of read.dimensionStyles) put("DIMSTYLE", s.name, s.handle);

  for (const b of read.blocks) if (!b.anonymous) put("BLOCK_RECORD", b.name, b.handle);

  for (const x of read.xrefs) put("BLOCK_RECORD", x.name, x.handle);
  put("APPID", "ACAD", undefined);
  put("VPORT", "*Active", undefined);

  for (const name of [
    "LAYER",
    "LTYPE",
    "STYLE",
    "DIMSTYLE",
    "APPID",
    "BLOCK_RECORD",
    "VPORT",
    "VIEW",
    "UCS",
  ])
    records.set(`${name}:`, "?");

  const seed = read.header.handseed;

  return {
    handseed: seed === undefined ? 0n : BigInt(`0x${seed}`),
    record: (table, name) => records.get(`${table}:${name}`),
    space: (layout) =>
      layout === undefined
        ? "?"
        : read.layouts.some((l) => layerKey(l.name) === layerKey(layout))
          ? "?"
          : undefined,
    // The dictionaries of styles, which the read lists by name and handle; no other.
    root: "?ROOT",
    entries: (dictionary) => {
      // A file whose read lists none of a kind holds no dictionary of them, as far as it tells.
      if (dictionary === "?ROOT")
        return new Map([
          ...((read.leaderStyles ?? []).length > 0
            ? [["ACAD_MLEADERSTYLE", "?MLEADERSTYLE"] as const]
            : []),
          ...(read.tableStyles.length > 0 ? [["ACAD_TABLESTYLE", "?TABLESTYLE"] as const] : []),
        ]);

      const lists = new Map<string, readonly { name: string; handle?: string | undefined }[]>([
        ["?MLEADERSTYLE", read.leaderStyles ?? []],
        ["?TABLESTYLE", read.tableStyles],
      ]);

      const list = lists.get(dictionary);

      return list && new Map(list.map((x) => [x.name, x.handle ?? "?"]));
    },
    classes: new Set(),
  };
}
