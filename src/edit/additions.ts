// The plan of an edit's additions, which both writers and `editedRead` follow. Each space's
// additions are drawn as a drawing of their own over the file's definitions and written by the
// core's DXF writer. Each record of that drawing is then the file's record of the same name, or
// new: an entity, a block, a table record or an object the additions need, which takes a handle
// counted from the file's `HANDSEED`. The order of the handles is fixed, so the edited read and
// both writers give each record the same one: the spaces' entities first, then the blocks, then
// the table records, then the objects.
import type {
  Block,
  DimensionStyle,
  Drawing,
  Entity,
  Layer,
  LeaderStyle,
  Linetype,
  TableStyle,
  TextStyle,
} from "../drawing.ts";
import { toDXF } from "../dxf.ts";
import { canonical } from "../json.ts";
import { idKey } from "../rules.ts";
import { readDrawing } from "../shape.ts";
import { layerKey } from "../layers.ts";
import { isString } from "../guards.ts";
import type { DrawingRead } from "../read/model.ts";
import { fileTables, STANDARD_STAND_IN, type FileTables } from "./file-tables.ts";
import { EditError, type Edit } from "./model.ts";
import { placeId } from "./replaced.ts";

/** A record of the drawing the additions of a space are written as. */
export interface DrawnRecord {
  readonly kind: string;
  readonly section: string;
  /** Group 5, or 105 for a dimension style. */
  readonly handle: string | undefined;
  readonly groups: readonly (readonly [code: number, value: string])[];
}

/** The groups of a DXF the core's writer wrote, record by record. */
export function drawnRecords(text: string): DrawnRecord[] {
  const lines = text.split(/\r?\n/);
  const out: DrawnRecord[] = [];
  let section = "";
  let kind = "";
  let groups: [number, string][] | undefined;

  const close = (): void => {
    if (groups === undefined) return;
    const handle = groups.find(([c]) => c === (kind === "DIMSTYLE" ? 105 : 5))?.[1];
    out.push({ kind, section, handle: handle?.toUpperCase(), groups });
    groups = undefined;
  };

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    const value = lines[i + 1]!;

    if (code === 0) {
      close();
      kind = value.trim();

      if (kind === "SECTION" || kind === "ENDSEC" || kind === "EOF") {
        if (kind !== "SECTION") section = "";
        continue;
      }

      groups = [[0, kind]];
    } else if (groups === undefined) {
      if (code === 2 && section === "") section = value.trim();
    } else groups.push([code, value]);
  }

  close();

  return out;
}

/** Whether two records hold the same, but for their handles and what they refer to. */
function sameContent(a: DrawnRecord, b: DrawnRecord): boolean {
  const content = (r: DrawnRecord): string =>
    JSON.stringify(r.groups.filter(([code]) => code !== 5 && code !== 105 && !refersBy(code)));

  return content(a) === content(b);
}

/** True for a group code whose value is a handle of another record. */
export const refersBy = (code: number): boolean =>
  code === 330 ||
  (code >= 320 && code <= 369) ||
  (code >= 390 && code <= 399) ||
  code === 480 ||
  code === 481 ||
  code === 1005;

/** What a writer can tell of the file it adds to. */
export interface AdditionsFile {
  /** The file's `$HANDSEED`. */
  readonly handseed: bigint;
  /** The handle of the file's record of a table, by its `layerKey`, or of the table for `""`. */
  record(table: string, name: string): string | undefined;
  /** The handle of the block record of model space, or of a layout by name. */
  space(layout: string | undefined): string | undefined;
  /** The handle of the named object dictionary. */
  readonly root: string | undefined;
  /** A dictionary's entries, by name as the file holds it. */
  entries(dictionary: string): ReadonlyMap<string, string> | undefined;
  /** The DXF names of the file's classes. */
  readonly classes: ReadonlySet<string>;
}

/** A record of the additions' drawing the file takes, with the handle it takes. */
export interface Transplant {
  /** The space whose drawing holds it, by its place in `AdditionsPlan.spaces`. */
  readonly space: number;
  readonly record: DrawnRecord;
  /** Its handle in the file. */
  readonly handle: string;
  readonly phase: "entity" | "block" | "table" | "object";
  /** For an entity, its place among the space's additions. */
  readonly addition?: number;
  /** The handle of the earlier addition it is written over, in its place. */
  readonly replaces?: string;
}

/**
 * A change to one of the file's records that a new one needs. An entry may also go to a dictionary
 * an earlier space adds, and an insert to the list of a block an earlier space adds, which the
 * writers make before writing it.
 */
export type Patch =
  | {
      readonly kind: "entry";
      readonly dictionary: string;
      readonly name: string;
      readonly handle: string;
      /** Group 360 for an entry its dictionary owns hard, 350 otherwise. */
      readonly code: 350 | 360;
    }
  | {
      /** A handle added to a list of the record, in a 102 group such as `{ACAD_REACTORS`. */
      readonly kind: "list";
      readonly record: string;
      readonly list: string;
      readonly code: number;
      readonly handle: string;
    }
  | { readonly kind: "count"; readonly table: string; readonly by: number };

/** One space's additions as a drawing of their own, and that drawing's records. */
export interface DrawnSpace {
  /** The layout's name, or undefined for model space. */
  readonly layout: string | undefined;
  readonly drawing: Drawing;
  readonly text: string;
  readonly records: readonly DrawnRecord[];
  /** Each handle of the drawing's records, by the handle the file gives it. */
  readonly handles: ReadonlyMap<string, string>;
  /** Each name an anonymous block of the drawing takes in the file. */
  readonly names: ReadonlyMap<string, string>;
}

export interface AdditionsPlan {
  readonly spaces: readonly DrawnSpace[];
  /** What the file takes, in the order of their handles. */
  readonly transplants: readonly Transplant[];
  readonly patches: readonly Patch[];
  /** The classes the file lacks, as the drawings' `CLASS` records. */
  readonly classes: readonly DrawnRecord[];
  /** The file's `$HANDSEED` after the additions. */
  readonly handseed: bigint;
  /** The mark of each entity added to a space, by its handle. */
  readonly marked: ReadonlyMap<string, { readonly id: string }>;
}

/** The kinds of table record, each of a table of its own name. */
const TABLE_KINDS: ReadonlySet<string> = new Set([
  "LAYER",
  "LTYPE",
  "STYLE",
  "DIMSTYLE",
  "APPID",
  "BLOCK_RECORD",
  "VPORT",
  "VIEW",
  "UCS",
]);

/** The kinds of object a read lists by handle. */
const LISTED_OBJECTS: ReadonlySet<string> = new Set(["MLEADERSTYLE", "TABLESTYLE"]);

/** The order table records take handles in, those the read names first. */
const TABLE_ORDER = ["LAYER", "LTYPE", "STYLE", "DIMSTYLE"];

/** The names of the file's `Standard` styles' stand-in, by `layerKey`, to the file's name. */
const standIn = (name: string): string =>
  layerKey(name).startsWith(layerKey(STANDARD_STAND_IN)) ? "Standard" : name;

const hexOf = (n: bigint): string => n.toString(16).toUpperCase();

/** The name of a record of a table, group 2. */
const nameOf = (r: DrawnRecord): string => r.groups.find(([c]) => c === 2)?.[1].trim() ?? "";

/** The first group of a code, outside 102 groups and extended data. */
function first(r: DrawnRecord, code: number): string | undefined {
  let braces = false;

  for (const [c, v] of r.groups) {
    if (c === 1001) return undefined;

    if (c === 102) braces = v.trim().startsWith("{");
    else if (!braces && c === code) return v.trim();
  }

  return undefined;
}

/** The definitions a space's additions name, from the file's and the edit's, and nothing else. */
function used(
  entities: readonly Entity[],
  tables: FileTables,
  defined: Edit["additions"],
): Omit<Drawing, "format" | "units" | "dxf" | "entities"> {
  const pick = <T extends { readonly name: string }>(
    file: readonly T[],
    own: readonly T[] | undefined,
  ): Map<string, T> => {
    const m = new Map<string, T>();

    for (const item of [...file, ...(own ?? [])]) m.set(layerKey(item.name), item);

    return m;
  };

  const d = defined?.definitions;

  const all = {
    layers: pick<Layer>(tables.layers, d?.layers),
    linetypes: pick<Linetype>(tables.linetypes, d?.linetypes),
    textStyles: pick<TextStyle>(tables.textStyles, d?.textStyles),
    dimensionStyles: pick<DimensionStyle>(tables.dimensionStyles, d?.dimensionStyles),
    leaderStyles: pick<LeaderStyle>(tables.leaderStyles, d?.leaderStyles),
    tableStyles: pick<TableStyle>(tables.tableStyles, d?.tableStyles),
    blocks: pick<Block>(tables.blocks, d?.blocks),
  };

  const want = {
    layers: new Set<string>(["0"]),
    linetypes: new Set<string>(),
    textStyles: new Set<string>(),
    dimensionStyles: new Set<string>(),
    leaderStyles: new Set<string>(),
    tableStyles: new Set<string>(),
    blocks: new Set<string>(),
  };

  const textStyle = (name: string | undefined): void => {
    if (name !== undefined) want.textStyles.add(layerKey(name));
  };

  // The entities of the blocks named and not yet walked: a list, as blocks may nest deep.
  const pending: (readonly Entity[])[] = [];

  const block = (name: string): void => {
    const key = layerKey(name);

    if (want.blocks.has(key)) return;
    want.blocks.add(key);
    const b = all.blocks.get(key);

    for (const a of b?.attributes ?? []) {
      want.layers.add(layerKey(a.layer));
      textStyle(a.style);
    }

    pending.push(b?.entities ?? []);
  };

  const walkAll = (list: readonly Entity[]): void => {
    walk(list);

    for (let next = pending.pop(); next !== undefined; next = pending.pop()) walk(next);
  };

  function walk(list: readonly Entity[]): void {
    for (const e of list) {
      want.layers.add(layerKey(e.layer));

      if ("linetype" in e && isString(e.linetype)) want.linetypes.add(layerKey(e.linetype));

      switch (e.kind) {
        case "text":
        case "paragraph":
          textStyle(e.style);
          break;
        case "insert":
          block(e.block);
          break;
        case "leader":
          want.leaderStyles.add(layerKey(e.style));

          if (e.block !== undefined) block(e.block);
          break;
        case "table":
          want.tableStyles.add(layerKey(e.style));
          break;
        case "linear-dimension":
        case "aligned-dimension":
        case "radius-dimension":
        case "diameter-dimension":
        case "jogged-radius-dimension":
        case "angular-dimension":
        case "arc-length-dimension":
        case "ordinate-dimension":
          want.dimensionStyles.add(layerKey(e.style));
          break;
        default:
          break;
      }
    }
  }

  walkAll(entities);

  for (const key of want.dimensionStyles) textStyle(all.dimensionStyles.get(key)?.textStyle);

  for (const key of want.leaderStyles) {
    const s = all.leaderStyles.get(key);
    textStyle(s?.textStyle);

    if (s?.block !== undefined) {
      block(s.block);
      walkAll([]);
    }
  }

  for (const key of want.tableStyles) textStyle(all.tableStyles.get(key)?.textStyle);

  for (const key of want.layers) {
    const l = all.layers.get(key)?.linetype;

    if (l !== undefined) want.linetypes.add(layerKey(l));
  }

  const keep = <T>(m: Map<string, T>, keys: ReadonlySet<string>): T[] =>
    [...m].flatMap(([k, v]) => (keys.has(k) ? [v] : []));

  return {
    layers: keep(all.layers, want.layers),
    linetypes: keep(all.linetypes, want.linetypes),
    textStyles: keep(all.textStyles, want.textStyles),
    dimensionStyles: keep(all.dimensionStyles, want.dimensionStyles),
    leaderStyles: keep(all.leaderStyles, want.leaderStyles),
    tableStyles: keep(all.tableStyles, want.tableStyles),
    blocks: keep(all.blocks, want.blocks),
    ...(d?.patterns !== undefined && { patterns: d.patterns }),
  };
}

/** An entity with the file's own `Standard` style named by its stand-in, as the drawing holds it. */
function withStandIns(e: Entity, tables: FileTables): Entity {
  if (!("style" in e) || !isString(e.style) || layerKey(e.style) !== "standard") return e;

  if (e.kind === "text" || e.kind === "paragraph") return e;
  let table = "dimensionStyles";

  if (e.kind === "leader") table = "leaderStyles";
  else if (e.kind === "table") table = "tableStyles";
  const alias = tables.aliases.get(`${table}:standard`);

  return alias === undefined ? e : { ...e, style: alias };
}

/** The drawing each space's additions are written as: model space first, then each layout. */
export function drawnSpaces(read: DrawingRead, edit: Edit): Drawing[] {
  const a = edit.additions;

  if (a === undefined) return [];
  const tables = fileTables(read);
  const out: Drawing[] = [];
  const units = INSUNITS.get(read.header.insunits ?? 0) ?? edit.units ?? "in";

  // Each list holds a drawing's entities, and the definitions a drawing's, as `fromJSON` holds
  // them: an edit from JSON may hold anything.
  const problems: string[] = [];
  readDrawing(
    {
      format: 0,
      units: "in",
      dxf: "R2018",
      layers: [],
      ...a.definitions,
      entities: [...a.model, ...Object.values(a.layouts).flat()],
    },
    "additions",
    problems,
  );

  if (problems.length > 0)
    throw new EditError(`The additions are malformed: ${problems.slice(0, 5).join("; ")}`);

  // A name the file holds is the file's, which the builder defines none of: an edit from JSON
  // that defines one otherwise would draw what the file does not.
  const d = a.definitions;

  for (const [what, file, own] of [
    ["layer", tables.layers, d?.layers],
    ["linetype", tables.linetypes, d?.linetypes],
    ["text style", tables.textStyles, d?.textStyles],
    ["dimension style", tables.dimensionStyles, d?.dimensionStyles],
    ["leader style", tables.leaderStyles, d?.leaderStyles],
    ["table style", tables.tableStyles, d?.tableStyles],
    ["block", tables.blocks, d?.blocks],
  ] as const) {
    const held = new Map<string, { readonly name: string }>(file.map((x) => [layerKey(x.name), x]));

    for (const x of own ?? []) {
      const theirs = held.get(layerKey(x.name));

      if (theirs !== undefined && canonical(theirs) !== canonical(x))
        throw new EditError(
          `The additions define the ${what} ${JSON.stringify(x.name)}, which the file holds otherwise: an edit uses the file's`,
        );
    }
  }

  // An id names one addition in all the spaces, as a mark and the record name it.
  const ids = new Set<string>();

  // An image or an underlay names a file outside the drawing, which no check of the additions has
  // opened yet: in a space, or in a block the additions define.
  for (const e of [
    ...a.model,
    ...Object.values(a.layouts).flat(),
    ...(a.definitions?.blocks ?? []).flatMap((b) => b.entities),
  ])
    if (e.kind === "image" || e.kind === "underlay")
      throw new EditError(
        `The addition ${e.id ?? `an ${e.kind}`} is an ${e.kind}, which tsdraft does not add to a firm's file yet`,
      );

  for (const e of [...a.model, ...Object.values(a.layouts).flat()]) {
    if (e.id === undefined) continue;

    if (e.id.startsWith("@"))
      throw new EditError(
        `The addition's id ${JSON.stringify(e.id)} starts with @, as tsdraft names an addition by its place: give another`,
      );
    const key = idKey(e.id);

    if (ids.has(key))
      throw new EditError(
        `The additions hold the id ${JSON.stringify(e.id)} twice: an id names one`,
      );
    ids.add(key);
  }

  const add = (entities: readonly Entity[], layout: string | undefined): void => {
    if (entities.length === 0) return;
    const own = entities.map((e) => withStandIns(e, tables));

    const paper = read.layouts.find(
      (l) => layout !== undefined && layerKey(l.name) === layerKey(layout),
    );

    out.push({
      format: 0,
      units: layout === undefined ? units : paper?.paperUnits === 1 ? "mm" : "in",
      dxf: "R2018",
      entities: own,
      ...used(own, tables, a),
    });
    layouts.push(layout);
  };

  const layouts: (string | undefined)[] = [];
  add(a.model, undefined);

  for (const name in a.layouts) add(a.layouts[name] ?? [], name);
  spaceNames.set(out, layouts);

  return out;
}

/** The layout of each drawing `drawnSpaces` gave, or undefined for model space. */
const spaceNames = new WeakMap<readonly Drawing[], readonly (string | undefined)[]>();

const INSUNITS = new Map<number, Drawing["units"]>([
  [1, "in"],
  [2, "ft"],
  [4, "mm"],
  [5, "cm"],
  [6, "m"],
]);

/**
 * The path of names by which a drawing's dictionaries name each object, from the root down, as
 * `ACAD_MLEADERSTYLE/NOTES`, in capitals as the leading CAD app compares them.
 */
function namedPaths(records: readonly DrawnRecord[]): Map<string, string> {
  const byHandle = new Map(records.flatMap((r) => (r.handle === undefined ? [] : [[r.handle, r]])));
  const root = records.find((r) => r.section === "OBJECTS" && r.kind === "DICTIONARY");
  const out = new Map<string, string>();
  const queue: [string, string][] = root?.handle === undefined ? [] : [[root.handle, ""]];

  for (let q = 0; q < queue.length && q < records.length; q++) {
    const [handle, path] = queue[q]!;
    const d = byHandle.get(handle);

    if (d === undefined || (d.kind !== "DICTIONARY" && d.kind !== "ACDBDICTIONARYWDFLT")) continue;

    for (let i = 0; i + 1 < d.groups.length; i++) {
      const [code, name] = d.groups[i]!;
      const [nextCode, value] = d.groups[i + 1]!;
      const h = value.trim().toUpperCase();

      if (code !== 3 || (nextCode !== 350 && nextCode !== 360) || out.has(h)) continue;
      const at = `${path}/${standIn(name).toUpperCase()}`;
      out.set(h, at);
      queue.push([h, at]);
    }
  }

  return out;
}

/** The anonymous block names the file holds, by their letter, the highest number of each. */
function anonymousHigh(read: DrawingRead): Map<string, number> {
  const high = new Map<string, number>();

  for (const b of read.blocks) {
    const m = /^\*([A-Za-z])(\d{1,9})$/.exec(b.name);

    if (m) {
      const letter = m[1]!.toUpperCase();
      high.set(letter, Math.max(high.get(letter) ?? 0, Number(m[2])));
    }
  }

  return high;
}

/**
 * The plan of an edit's additions in a file: what each space's drawing writes, which of its
 * records the file takes and with what handle, and what of the file's own records changes.
 */
export function planAdditions(
  read: DrawingRead,
  edit: Edit,
  file: AdditionsFile,
  reuse: ReadonlyMap<string, string> = new Map(),
): AdditionsPlan {
  const drawings = drawnSpaces(read, edit);
  const layouts = spaceNames.get(drawings) ?? [];
  const high = anonymousHigh(read);
  let seed = file.handseed;
  const next = (): string => hexOf(seed++);

  // What earlier spaces made new, by table and name, so a later space takes the same record.
  const madeByName = new Map<string, string>();
  const transplants: Transplant[] = [];
  const patches: Patch[] = [];
  const classes: DrawnRecord[] = [];
  const classNames = new Set(file.classes);
  const marked = new Map<string, { readonly id: string }>();

  interface Working {
    readonly layout: string | undefined;
    readonly drawing: Drawing;
    readonly text: string;
    readonly records: DrawnRecord[];
    readonly byHandle: Map<string, DrawnRecord>;
    readonly handles: Map<string, string>;
    readonly names: Map<string, string>;
    /** The records the file takes, by phase, before their handles are given. */
    readonly entities: DrawnRecord[];
    readonly blocks: DrawnRecord[][];
    readonly tables: DrawnRecord[];
    readonly objects: DrawnRecord[];
    readonly owners: Map<string, string>;
  }

  const spaces: Working[] = drawings.map((drawing, s) => {
    let text: string;

    try {
      text = toDXF(drawing);
    } catch (error) {
      throw new EditError(
        `The additions ${layouts[s] === undefined ? "of model space" : `of the layout ${JSON.stringify(layouts[s])}`} cannot be written: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const records = drawnRecords(text);
    const byHandle = new Map<string, DrawnRecord>();
    const owners = new Map<string, string>();

    for (const r of records)
      if (r.handle !== undefined) {
        byHandle.set(r.handle, r);
        const o = first(r, 330);

        if (o !== undefined) owners.set(r.handle, o.toUpperCase());
      }

    return {
      layout: layouts[s],
      drawing,
      text,
      records,
      byHandle,
      handles: new Map(),
      names: new Map(),
      entities: [],
      blocks: [],
      tables: [],
      objects: [],
      owners,
    };
  });

  for (const w of spaces) {
    const target = file.space(w.layout);

    if (target === undefined)
      throw new EditError(
        w.layout === undefined
          ? "The file has no model space"
          : `The file has no layout ${JSON.stringify(w.layout)}`,
      );

    // The table records: the file's of each name, or new.
    const blockRecords = new Map<string, DrawnRecord>();
    const newBlocks = new Set<string>();

    for (const r of w.records) {
      if (r.section !== "TABLES" || r.handle === undefined) continue;

      if (r.kind === "TABLE") {
        const own = file.record(nameOf(r), "");

        if (own !== undefined) w.handles.set(r.handle, own);
        continue;
      }

      const table = TABLE_KINDS.has(r.kind) ? r.kind : undefined;

      if (table === undefined) continue;
      const name = nameOf(r);

      if (table === "BLOCK_RECORD") {
        blockRecords.set(r.handle, r);
        const key = layerKey(name);

        if (key === "*model_space") w.handles.set(r.handle, target);
        else if (key.startsWith("*paper_space")) continue;
        else if (/^\*[a-z]\d+$/.test(key)) newBlocks.add(r.handle);
        else {
          const own = file.record("BLOCK_RECORD", key) ?? madeByName.get(`BLOCK_RECORD:${key}`);

          if (own !== undefined) w.handles.set(r.handle, own);
          else newBlocks.add(r.handle);
        }

        continue;
      }

      const key = layerKey(standIn(name));
      const own = file.record(table, key) ?? madeByName.get(`${table}:${key}`);

      if (own !== undefined) w.handles.set(r.handle, own);
      else w.tables.push(r);
    }

    // The anonymous blocks take names the file does not hold.
    for (const h of newBlocks) {
      const name = nameOf(blockRecords.get(h)!);
      const m = /^\*([A-Za-z])\d+$/.exec(name);

      if (m) {
        const letter = m[1]!.toUpperCase();
        const n = (high.get(letter) ?? 0) + 1;
        high.set(letter, n);
        w.names.set(layerKey(name), `*${letter}${n}`);
      }
    }

    // The blocks: each new block record with its BLOCK, entities and ENDBLK, in their order.
    let current: DrawnRecord[] | undefined;

    for (const r of w.records) {
      if (r.section !== "BLOCKS") continue;

      if (r.kind === "BLOCK") {
        const owner = w.owners.get(r.handle ?? "");
        current =
          owner !== undefined && newBlocks.has(owner) ? [blockRecords.get(owner)!] : undefined;

        if (current) w.blocks.push(current);
      }

      current?.push(r);

      if (r.kind === "ENDBLK") current = undefined;
    }

    // The entities of model space, which are the space's additions, with what follows each.
    for (const r of w.records)
      if (r.section === "ENTITIES" && r.handle !== undefined) w.entities.push(r);

    // The objects: the file's of each name in its dictionaries, from the root down.
    const root = w.records.find((r) => r.section === "OBJECTS" && r.kind === "DICTIONARY");

    if (root?.handle !== undefined && file.root !== undefined) {
      const queue: [string, string][] = [[root.handle, file.root]];

      while (queue.length > 0) {
        const [mine, theirs] = queue.shift()!;
        w.handles.set(mine, theirs);
        const d = w.byHandle.get(mine);
        const entries = file.entries(theirs);

        if (
          (d?.kind !== "DICTIONARY" && d?.kind !== "ACDBDICTIONARYWDFLT") ||
          entries === undefined
        )
          continue;

        for (let i = 0; i + 1 < d.groups.length; i++) {
          const [code, value] = d.groups[i]!;
          const [nextCode, handle] = d.groups[i + 1]!;

          if (code !== 3 || (nextCode !== 350 && nextCode !== 360)) continue;
          const name = standIn(value);
          const own = [...entries].find(([k]) => layerKey(k) === layerKey(name))?.[1];

          if (own !== undefined && !w.handles.has(handle.toUpperCase()))
            queue.push([handle.toUpperCase(), own]);
        }
      }
    }
  }

  // What the new records need of the drawings' objects that the file lacks.
  for (const w of spaces) {
    const needed = new Set<string>();
    const queue: DrawnRecord[] = [...w.entities, ...w.blocks.flat(), ...w.tables];

    for (const r of queue) if (r.handle !== undefined) needed.add(r.handle);

    for (let q = 0; q < queue.length; q++) {
      for (const [code, value] of queue[q]!.groups) {
        if (!refersBy(code)) continue;
        const h = value.trim().toUpperCase();

        if (h === "0" || w.handles.has(h) || needed.has(h)) continue;
        const r = w.byHandle.get(h);

        if (r === undefined) continue;

        if (r.section === "OBJECTS") {
          needed.add(h);
          w.objects.push(r);
          queue.push(r);
        }
      }
    }
  }

  // The handles, in the order of their phases across the spaces.
  spaces.forEach((w, s) => {
    let addition = -1;

    // The place of the entity an addition replaces, which its records take.
    let replaces: string | undefined;

    for (const r of w.entities) {
      const main = r.kind !== "ATTRIB" && r.kind !== "SEQEND";

      if (main) addition++;
      const entity = w.drawing.entities[addition];
      const id = entity?.id ?? placeId(w.layout, addition);

      if (main) replaces = reuse.get(idKey(id));
      const handle = main && replaces !== undefined ? replaces : next();
      w.handles.set(r.handle!, handle);
      transplants.push({
        space: s,
        record: r,
        handle,
        phase: "entity",
        addition,
        ...(replaces !== undefined && { replaces }),
      });

      if (main) marked.set(handle, { id });
    }
  });

  spaces.forEach((w, s) => {
    for (const block of w.blocks) {
      const name = layerKey(nameOf(block[0]!));
      const made = madeByName.get(`BLOCK_RECORD:${name}`);

      if (made !== undefined) {
        // An earlier space made it: this one's records are that one's.
        w.handles.set(block[0]!.handle!, made);
        continue;
      }

      for (const r of block) {
        const handle = next();
        w.handles.set(r.handle!, handle);
        transplants.push({ space: s, record: r, handle, phase: "block" });
      }

      if (!name.startsWith("*"))
        madeByName.set(`BLOCK_RECORD:${name}`, w.handles.get(block[0]!.handle!)!);
    }
  });

  const counts = new Map<string, number>();

  for (const table of [...TABLE_ORDER, "APPID", "BLOCK_RECORD", "VPORT", "VIEW", "UCS"])
    spaces.forEach((w, s) => {
      for (const r of w.tables) {
        if (r.kind !== table) continue;
        const key = `${table}:${layerKey(standIn(nameOf(r)))}`;
        const made = madeByName.get(key);

        if (made !== undefined) {
          w.handles.set(r.handle!, made);
          continue;
        }

        const handle = next();
        w.handles.set(r.handle!, handle);
        madeByName.set(key, handle);
        transplants.push({ space: s, record: r, handle, phase: "table" });
        counts.set(table, (counts.get(table) ?? 0) + 1);
      }
    });

  // A block record is counted in its table too.
  for (const t of transplants)
    if (t.record.kind === "BLOCK_RECORD")
      counts.set("BLOCK_RECORD", (counts.get("BLOCK_RECORD") ?? 0) + 1);

  for (const [table, by] of counts) patches.push({ kind: "count", table, by });

  // The objects a read lists, its styles, take their handles first, so the edited read, which
  // does not know every dictionary of the file, gives them as the writers do.
  const listedFirst = (r: DrawnRecord): number => (LISTED_OBJECTS.has(r.kind) ? 0 : 1);

  // Each object made, by its handle, to hold another space's of its name to.
  const madeRecords = new Map<string, DrawnRecord>();

  spaces.forEach((w, s) => {
    const paths = namedPaths(w.records);
    const kept: DrawnRecord[] = [];

    for (const r of w.objects.toSorted((a, b) => listedFirst(a) - listedFirst(b))) {
      // An object a dictionary names, such as a new leader style, is one for all the spaces.
      const path = paths.get(r.handle!);
      const made = path === undefined ? undefined : madeByName.get(`OBJECT:${path}`);

      if (made !== undefined) {
        const first = madeRecords.get(made)!;

        // A dictionary takes the entries of each space; another object is the same in all.
        if (!r.kind.includes("DICTIONARY") && !sameContent(first, r))
          throw new EditError(
            `The additions of two spaces define the ${r.kind} ${path} otherwise: define it once, the same in both`,
          );
        w.handles.set(r.handle!, made);
        continue;
      }

      const handle = next();
      w.handles.set(r.handle!, handle);
      transplants.push({ space: s, record: r, handle, phase: "object" });
      madeRecords.set(handle, r);
      kept.push(r);

      if (path !== undefined) madeByName.set(`OBJECT:${path}`, handle);
    }

    w.objects.splice(0, w.objects.length, ...kept);
  });

  // The file's records that name a new one: a dictionary's entries, and lists in 102 groups.
  spaces.forEach((w, s) => {
    const added = new Set(w.objects.map((r) => r.handle!));

    for (const r of w.records) {
      if (r.handle === undefined) continue;
      const own = w.handles.get(r.handle);

      // A record a space adds is written whole from that space. A dictionary an earlier space
      // added takes this space's entries, as a dictionary of the file's does.
      if (own === undefined || transplants.some((t) => t.handle === own && t.space === s)) continue;
      const isNew = transplants.some((t) => t.handle === own);

      if (r.kind === "DICTIONARY" || r.kind === "ACDBDICTIONARYWDFLT")
        for (let i = 0; i + 1 < r.groups.length; i++) {
          const [code, value] = r.groups[i]!;
          const [nextCode, handle] = r.groups[i + 1]!;
          const h = handle.toUpperCase();

          if (code === 3 && (nextCode === 350 || nextCode === 360) && added.has(h))
            patches.push({
              kind: "entry",
              dictionary: own,
              name: value,
              handle: w.handles.get(h)!,
              code: nextCode,
            });
        }

      if (isNew) continue;
      let list: string | undefined;

      for (const [code, value] of r.groups) {
        if (code === 102) list = value.trim().startsWith("{") ? value.trim() : undefined;
        else if (list !== undefined && refersBy(code)) {
          const h = value.trim().toUpperCase();
          const t = w.handles.get(h);

          if (t !== undefined && transplants.some((x) => x.handle === t && x.space === s))
            patches.push({ kind: "list", record: own, list, code, handle: t });
        }
      }
    }
  });

  // Each new insert of a block the file holds joins the block record's list of its inserts.
  for (const t of transplants) {
    if (t.record.kind !== "INSERT") continue;
    const name = first(t.record, 2);
    const block = name === undefined ? undefined : file.record("BLOCK_RECORD", layerKey(name));

    // A block the additions define lists its inserts as the drawing wrote it, and those of the
    // other spaces that insert it.
    if (block !== undefined && !transplants.some((x) => x.handle === block))
      patches.push({ kind: "list", record: block, list: "{BLKREFS", code: 331, handle: t.handle });
    else if (block === undefined && name !== undefined) {
      const w = spaces[t.space]!;

      const drawn = w.records.find(
        (r) => r.kind === "BLOCK_RECORD" && layerKey(first(r, 2) ?? "") === layerKey(name),
      );

      const own = drawn?.handle === undefined ? undefined : w.handles.get(drawn.handle);
      const made = transplants.find((x) => x.handle === own);

      if (own !== undefined && made !== undefined && made.space !== t.space)
        patches.push({ kind: "list", record: own, list: "{BLKREFS", code: 331, handle: t.handle });
    }
  }

  for (const w of spaces)
    for (const r of w.records)
      if (r.section === "CLASSES" && r.kind === "CLASS") {
        const name = first(r, 1);

        if (name !== undefined && !classNames.has(name)) {
          classNames.add(name);
          classes.push(r);
        }
      }

  return {
    spaces: spaces.map((w) => ({
      layout: w.layout,
      drawing: w.drawing,
      text: w.text,
      records: w.records,
      handles: w.handles,
      names: w.names,
    })),
    transplants,
    patches,
    classes,
    handseed: seed,
    marked,
  };
}

/** Where the edit's record goes: the mark's application, the dictionary `TSDRAFT` and its entry. */
export interface RecordPlan {
  readonly appid: string;
  readonly appidNew: boolean;
  readonly dictionary: string;
  readonly dictionaryNew: boolean;
  readonly xrecord: string;
  readonly xrecordNew: boolean;
  /** The file's `$HANDSEED` after the additions and the record. */
  readonly handseed: bigint;
}

/**
 * The handles of the mark's application, `TSDRAFT`, of the dictionary of the same name in the named
 * object dictionary and of the edit's record in it: the file's where it holds each, and new ones,
 * after every other addition's, where it does not.
 */
export function planRecord(plan: AdditionsPlan, file: AdditionsFile, name: string): RecordPlan {
  let seed = plan.handseed;
  const next = (): string => hexOf(seed++);
  const ownAppid = file.record("APPID", "tsdraft");
  const appid = ownAppid ?? next();
  const rootEntries = file.root === undefined ? undefined : file.entries(file.root);
  const ownDictionary = [...(rootEntries ?? [])].find(([k]) => k === "TSDRAFT")?.[1];
  const dictionary = ownDictionary ?? next();

  const ownRecord =
    ownDictionary === undefined ? undefined : file.entries(ownDictionary)?.get(name);

  const xrecord = ownRecord ?? next();

  return {
    appid,
    appidNew: ownAppid === undefined,
    dictionary,
    dictionaryNew: ownDictionary === undefined,
    xrecord,
    xrecordNew: ownRecord === undefined,
    handseed: seed,
  };
}
