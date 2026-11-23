// An edit's additions in a firm's DXF: each record the plan takes from the additions' drawings
// written into its place, its handles the file's, and what of the file's own records names it:
// a dictionary's entries, a list in a 102 group, a table's count and `$HANDSEED`.
import type { DxfDocument } from "../read/document.ts";
import {
  refersBy,
  type AdditionsFile,
  type AdditionsPlan,
  type DrawnRecord,
  type DrawnSpace,
  type Patch,
  type RecordPlan,
} from "./additions.ts";
import { groupsOf, shortest, type HeldGroup } from "./dxf-groups.ts";
import { MARK_FORMAT, markGroups, type Marks } from "./marks.ts";
import { EditError } from "./model.ts";
import { layerKey } from "../layers.ts";

/** What the additions make of the file: records to put before others, and records changed. */
export interface AddedRecords {
  /** Text to write before record `i`, by `i`, in the order it is to be written. */
  readonly before: ReadonlyMap<number, string>;
  /** Groups to replace in record `i`: its whole text again. */
  readonly patched: ReadonlyMap<number, string>;
}

/** The file's own records, as the plan asks of them. */
export function dxfAdditionsFile(
  bytes: Uint8Array,
  doc: DxfDocument,
): AdditionsFile & {
  readonly groups: (i: number) => HeldGroup[];
  readonly index: ReadonlyMap<string, number>;
} {
  const kind = (i: number): string => doc.names[doc.kinds[i]!] ?? "";
  const section = (i: number): string => doc.names[doc.sections[i]!] ?? "";
  const held = new Map<number, HeldGroup[]>();

  const groups = (i: number): HeldGroup[] => {
    let g = held.get(i);

    if (g === undefined) {
      const start = doc.starts[i]!;
      g = groupsOf(bytes, start, start + doc.length(i));

      if (g === undefined)
        throw new EditError(
          `The record ${doc.handle(i) ?? `at byte ${start}`} does not read as groups`,
        );
      held.set(i, g);
    }

    return g;
  };

  const value = (i: number, code: number): string | undefined =>
    groups(i)
      .find((g) => g.code === code)
      ?.value.trim();

  const records = new Map<string, string>();
  const tables = new Map<string, string>();
  const index = new Map<string, number>();
  const layouts = new Map<string, string>();
  const classes = new Set<string>();
  let root: string | undefined;

  for (let i = 0; i < doc.count; i++) {
    const h = doc.handle(i)?.toUpperCase();

    if (h !== undefined && !index.has(h)) index.set(h, i);
    const k = kind(i);
    const s = section(i);

    if (s === "CLASSES" && k === "CLASS") {
      const name = value(i, 1);

      if (name !== undefined) classes.add(name);
    } else if (s === "TABLES" && h !== undefined) {
      const name = value(i, 2) ?? "";

      if (k === "TABLE") tables.set(name, h);
      else if (!records.has(`${k}:${layerKey(name)}`)) records.set(`${k}:${layerKey(name)}`, h);
    } else if (s === "OBJECTS" && h !== undefined) {
      if (k === "DICTIONARY" && root === undefined) root = h;

      if (k === "LAYOUT") {
        // The layout's name is the group 1 of its subclass AcDbLayout, past its page setup's, and
        // its block record the group 330 after it.
        const g = groups(i);
        const at = g.findIndex((x) => x.code === 100 && x.value.trim() === "AcDbLayout");

        const name = g
          .slice(at + 1)
          .find((x) => x.code === 1)
          ?.value.trim();

        const block = g
          .slice(at + 1)
          .find((x) => x.code === 330)
          ?.value.trim();

        if (at >= 0 && name !== undefined && block !== undefined)
          layouts.set(layerKey(name), block.toUpperCase());
      }
    }
  }

  const header = doc.header().find((v) => v.name === "$HANDSEED");
  let handseed = 0n;

  if (header) {
    const text = new TextDecoder("latin1").decode(
      bytes.subarray(header.start, header.start + header.length),
    );

    const m = /\n\s*5\r?\n\s*([0-9A-Fa-f]{1,16})/.exec(text);

    if (m) handseed = BigInt(`0x${m[1]}`);
  }

  return {
    handseed,
    record: (table, name) => (name === "" ? tables.get(table) : records.get(`${table}:${name}`)),
    space: (layout) =>
      layout === undefined
        ? records.get("BLOCK_RECORD:*model_space")
        : layouts.get(layerKey(layout)),
    root,
    entries(dictionary) {
      const i = index.get(dictionary.toUpperCase());

      if (i === undefined || (kind(i) !== "DICTIONARY" && kind(i) !== "ACDBDICTIONARYWDFLT"))
        return undefined;
      const out = new Map<string, string>();
      const g = groups(i);

      for (let k = 0; k + 1 < g.length; k++)
        if (g[k]!.code === 3 && (g[k + 1]!.code === 350 || g[k + 1]!.code === 360))
          out.set(g[k]!.value, g[k + 1]!.value.trim().toUpperCase());

      return out;
    },
    classes,
    groups,
    index,
  };
}

/** A group as the leading CAD app writes one: its code right-aligned in three columns. */
const line = (code: number, value: string, eol: string): string =>
  `${String(code).padStart(3)}${eol}${value}${eol}`;

/** A record of an additions' drawing in the file's terms: its handles and names the file's. */
function inFile(
  r: DrawnRecord,
  space: DrawnSpace,
  paper: boolean,
  eol: string,
  mark: readonly (readonly [number, string])[] | undefined,
  start?: readonly [number, number],
): string {
  let out = "";
  const named = (v: string): string => space.names.get(layerKey(v.trim())) ?? v;

  for (const [code, value] of r.groups) {
    let v = value;

    if (code === 5 || code === 105 || refersBy(code)) {
      const h = value.trim().toUpperCase();

      if (h !== "0") {
        const own = space.handles.get(h);

        if (own === undefined)
          throw new EditError(
            `An addition's ${r.kind} names the record ${h} of its drawing, which the plan gives no handle`,
          );
        v = own;
      }
    } else if (code === 2 || code === 3) {
      // A block's name, which an anonymous block takes anew, and a style's stand-in name.
      v = named(value);

      if (code === 3 && r.kind.endsWith("DIMENSION") && /^TSDRAFT-FILE-STANDARD/i.test(v.trim()))
        v = "Standard";
    }

    // A justified text's start, worked out from its font's widths, as in a DWG.
    if (start !== undefined && (code === 10 || code === 20))
      v = shortest(start[code === 10 ? 0 : 1]);
    out += line(code, v, eol);

    // An entity on paper: group 67 after its subclass AcDbEntity.
    if (paper && code === 100 && value.trim() === "AcDbEntity") out += line(67, "1", eol);
  }

  for (const [code, value] of mark ?? []) out += line(code, value, eol);

  return out;
}

/**
 * The records an edit's additions write into a DXF of the 2018 format, and the file's records
 * they change, as text to put before each record and text in place of others.
 */
export function addedRecords(
  bytes: Uint8Array,
  doc: DxfDocument,
  file: ReturnType<typeof dxfAdditionsFile>,
  plan: AdditionsPlan,
  marks: Marks,
  starts: ReadonlyMap<string, readonly [number, number]>,
  base: ReadonlyMap<number, Uint8Array> = new Map(),
): AddedRecords {
  const kind = (i: number): string => doc.names[doc.kinds[i]!] ?? "";
  const section = (i: number): string => doc.names[doc.sections[i]!] ?? "";
  const first = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 64)));
  const eol = first.includes("\r\n") ? "\r\n" : "\n";

  // Where each section ends, and where each table and each block ends.
  const endOf = new Map<string, number>();
  const endtab = new Map<string, number>();
  const endblk = new Map<string, number>();
  let table: string | undefined;
  let block: string | undefined;

  for (let i = 0; i < doc.count; i++) {
    const k = kind(i);
    const s = section(i);

    if (k === "ENDSEC") endOf.set(doc.names[doc.sections[i - 1] ?? 0] ?? "", i);
    else if (s === "TABLES" && k === "TABLE")
      table = file
        .groups(i)
        .find((g) => g.code === 2)
        ?.value.trim();
    else if (s === "TABLES" && k === "ENDTAB" && table !== undefined) endtab.set(table, i);
    else if (s === "BLOCKS" && k === "BLOCK")
      block = file
        .groups(i)
        .find((g) => g.code === 330)
        ?.value.trim()
        .toUpperCase();
    else if (s === "BLOCKS" && k === "ENDBLK" && block !== undefined) endblk.set(block, i);
  }

  const before = new Map<number, string>();

  const put = (at: number | undefined, text: string, what: string): void => {
    if (at === undefined) throw new EditError(`The file has no place for ${what}`);
    before.set(at, (before.get(at) ?? "") + text);
  };

  // The block record of the layout model space or `*Paper_Space` draws in the section ENTITIES.
  const paperSpace = file.record("BLOCK_RECORD", "*paper_space");

  // The entries one space adds to a dictionary another space adds.
  const made = new Set(plan.transplants.map((t) => t.handle.toUpperCase()));

  const entriesOf = new Map<string, Extract<Patch, { kind: "entry" }>[]>();

  for (const p of plan.patches)
    if (p.kind === "entry" && made.has(p.dictionary.toUpperCase()))
      entriesOf.set(p.dictionary.toUpperCase(), [
        ...(entriesOf.get(p.dictionary.toUpperCase()) ?? []),
        p,
      ]);

  for (const t of plan.transplants) {
    const space = plan.spaces[t.space]!;
    const mark = marks.get(t.handle);

    if (t.phase === "entity") {
      const target = file.space(space.layout)!;
      const paper = space.layout !== undefined;

      const text = inFile(
        t.record,
        space,
        paper,
        eol,
        mark && markGroups(mark),
        starts.get(t.handle),
      );

      if (t.replaces !== undefined)
        put(file.index.get(t.replaces.toUpperCase()), text, `the place of ${t.replaces}`);
      else if (!paper || target === paperSpace)
        put(endOf.get("ENTITIES"), text, "model space's entities");
      else put(endblk.get(target), text, `the layout ${space.layout}'s entities`);
    } else if (t.phase === "block") {
      const text = inFile(t.record, space, false, eol, mark && markGroups(mark));

      if (t.record.kind === "BLOCK_RECORD") put(endtab.get("BLOCK_RECORD"), text, "a block record");
      else put(endOf.get("BLOCKS"), text, "a block");
    } else if (t.phase === "table") {
      const table = t.record.kind;
      put(
        endtab.get(table),
        inFile(t.record, space, false, eol, mark && markGroups(mark)),
        `a ${table}`,
      );
    } else {
      const text = (entriesOf.get(t.handle.toUpperCase()) ?? []).reduce(
        (r, p) => withEntry(r, p.name, p.code, p.handle, eol),
        inFile(t.record, space, false, eol, undefined),
      );

      put(endOf.get("OBJECTS"), text, "an object");
    }
  }

  for (const r of plan.classes)
    put(endOf.get("CLASSES"), inFile(r, plan.spaces[0]!, false, eol, undefined), "a class");

  // The file's records the additions name.
  const patched = new Map<number, string>();

  const text = (i: number): string => {
    const own = patched.get(i);

    if (own !== undefined) return own;
    const start = doc.starts[i]!;

    return new TextDecoder("utf-8").decode(
      base.get(i) ?? bytes.subarray(start, start + doc.length(i)),
    );
  };

  for (const p of plan.patches) {
    if (p.kind === "count") {
      const i = file.index.get(file.record(p.table, "") ?? "");

      if (i === undefined) throw new EditError(`The file has no table ${p.table}`);
      patched.set(i, withCount(text(i), p.by, eol));
    } else if (p.kind === "entry") {
      if (made.has(p.dictionary.toUpperCase())) continue;
      const i = file.index.get(p.dictionary.toUpperCase());

      if (i === undefined) throw new EditError(`The file has no dictionary ${p.dictionary}`);
      patched.set(i, withEntry(text(i), p.name, p.code, p.handle, eol));
    } else {
      // A record the additions make lists its inserts as the drawing wrote it, which is none.
      if (made.has(p.record.toUpperCase())) continue;
      const i = file.index.get(p.record.toUpperCase());

      if (i === undefined) throw new EditError(`The file has no record ${p.record}`);
      const was = text(i);
      const listed = withListed(was, p.list, p.code, p.handle, eol);

      if (listed !== was) patched.set(i, listed);
    }
  }

  return { before, patched };
}

/**
 * A dictionary's record with an entry added: after its last entry, and before an empty one, as a
 * reader reads a list to its first empty slot, its extended data and a default entry's 340.
 */
function withEntry(
  record: string,
  name: string,
  code: number,
  handle: string,
  eol: string,
): string {
  const lines = record.split(eol);
  let at = -1;

  for (let k = 0; k + 3 < lines.length; k += 2) {
    const c = lines[k]!.trim();

    if (c === "1001") break;

    if (c !== "3") continue;
    const next = lines[k + 2]!.trim();

    if (next !== "350" && next !== "360") continue;

    if (lines[k + 1] === "" || lines[k + 3]!.trim() === "0") {
      at = k;
      break;
    }

    at = k + 4;
  }

  if (at < 0) {
    const data = lines.findIndex((l, k) => k % 2 === 0 && l.trim() === "1001");
    at = data >= 0 ? data : lines.length - (lines.at(-1) === "" ? 1 : 0);
  }

  lines.splice(at, 0, String(3).padStart(3), name, String(code).padStart(3), handle);

  return lines.join(eol);
}

/** A table's record with its count, group 70, raised. */
function withCount(record: string, by: number, eol: string): string {
  const lines = record.split(eol);

  for (let k = 0; k + 1 < lines.length; k += 2)
    if (lines[k]!.trim() === "70") {
      const n = Number(lines[k + 1]!.trim());
      lines[k + 1] = lines[k + 1]!.replace(/\d+/, String(n + by));

      return lines.join(eol);
    }

  return record;
}

/** A record with a handle added at the end of its 102 group `list`, which it makes if it lacks. */
function withListed(
  record: string,
  list: string,
  code: number,
  handle: string,
  eol: string,
): string {
  const lines = record.split(eol);
  let open = -1;

  for (let k = 0; k + 1 < lines.length; k += 2) {
    const c = lines[k]!.trim();
    const v = lines[k + 1]!.trim();

    if (c === "102" && v === list) open = k;
    else if (open >= 0 && c === "102" && v === "}") {
      lines.splice(k, 0, String(code).padStart(3), handle);

      return lines.join(eol);
    }
  }

  // No such list: a block record's after its layout, group 340, as the leading CAD app writes
  // it, and any other's after the handle, where a record's 102 groups are.
  const at = (c: string): number => {
    for (let k = 0; k + 1 < lines.length; k += 2) if (lines[k]!.trim() === c) return k;

    return -1;
  };

  // A block record that keeps no list of its inserts keeps none: the file's own say whether it does.
  if (list === "{BLKREFS") return record;
  const after = Math.max(at("5"), at("105"));

  if (after >= 0) {
    lines.splice(after + 2, 0, "102", list, String(code).padStart(3), handle, "102", "}");

    return lines.join(eol);
  }

  return record;
}

/**
 * The edit's record in a DXF: the application `TSDRAFT` in its table, the dictionary `TSDRAFT` in
 * the named object dictionary, and in it the `XRECORD` of the edit's name, of the mark's format
 * and each addition's id and handle, as the leading CAD app writes such objects.
 */
export function addRecord(
  bytes: Uint8Array,
  doc: DxfDocument,
  file: ReturnType<typeof dxfAdditionsFile>,
  records: AddedRecords,
  record: RecordPlan,
  name: string,
  additions: readonly { readonly id: string; readonly handle: string }[],
  base: ReadonlyMap<number, Uint8Array> = new Map(),
): AddedRecords {
  const before = new Map(records.before);
  const patched = new Map(records.patched);
  const first = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 64)));
  const eol = first.includes("\r\n") ? "\r\n" : "\n";
  const kind = (i: number): string => doc.names[doc.kinds[i]!] ?? "";
  const section = (i: number): string => doc.names[doc.sections[i]!] ?? "";

  const text = (i: number): string => {
    const own = patched.get(i);

    if (own !== undefined) return own;
    const start = doc.starts[i]!;

    return new TextDecoder("utf-8").decode(
      base.get(i) ?? bytes.subarray(start, start + doc.length(i)),
    );
  };

  const put = (at: number | undefined, t: string, what: string): void => {
    if (at === undefined) throw new EditError(`The file has no place for ${what}`);
    before.set(at, (before.get(at) ?? "") + t);
  };

  let endtab: number | undefined;
  let endObjects: number | undefined;
  let table = "";

  for (let i = 0; i < doc.count; i++) {
    const k = kind(i);

    if (section(i) === "TABLES" && k === "TABLE")
      table =
        file
          .groups(i)
          .find((g) => g.code === 2)
          ?.value.trim() ?? "";
    else if (k === "ENDTAB" && table === "APPID") endtab = i;
    else if (k === "ENDSEC" && section(i - 1) === "OBJECTS") endObjects = i;
  }

  const appidTable = file.record("APPID", "");
  const root = file.root;

  if (appidTable === undefined || root === undefined)
    throw new EditError("The file has no table of applications or no named object dictionary");

  if (record.appidNew) {
    put(
      endtab,
      line(0, "APPID", eol) +
        line(5, record.appid, eol) +
        line(330, appidTable, eol) +
        line(100, "AcDbSymbolTableRecord", eol) +
        line(100, "AcDbRegAppTableRecord", eol) +
        line(2, "TSDRAFT", eol) +
        line(70, "     0", eol),
      "the mark's application",
    );
    const i = file.index.get(appidTable);

    if (i !== undefined) patched.set(i, withCount(text(i), 1, eol));
  }

  const xrecord =
    line(0, "XRECORD", eol) +
    line(5, record.xrecord, eol) +
    line(102, "{ACAD_REACTORS", eol) +
    line(330, record.dictionary, eol) +
    line(102, "}", eol) +
    line(330, record.dictionary, eol) +
    line(100, "AcDbXrecord", eol) +
    line(280, "     1", eol) +
    line(70, `     ${MARK_FORMAT}`, eol) +
    additions.map((a) => line(1, a.id, eol) + line(2, a.handle, eol)).join("");

  if (record.dictionaryNew) {
    put(
      endObjects,
      line(0, "DICTIONARY", eol) +
        line(5, record.dictionary, eol) +
        line(102, "{ACAD_REACTORS", eol) +
        line(330, root, eol) +
        line(102, "}", eol) +
        line(330, root, eol) +
        line(100, "AcDbDictionary", eol) +
        line(281, "     1", eol) +
        line(3, name, eol) +
        line(350, record.xrecord, eol),
      "the edits' dictionary",
    );
    const i = file.index.get(root.toUpperCase());

    if (i !== undefined) patched.set(i, withEntry(text(i), "TSDRAFT", 350, record.dictionary, eol));
  } else if (record.xrecordNew) {
    const i = file.index.get(record.dictionary.toUpperCase());

    if (i !== undefined) patched.set(i, withEntry(text(i), name, 350, record.xrecord, eol));
  }

  if (record.xrecordNew) put(endObjects, xrecord, "the edit's record");
  else {
    const i = file.index.get(record.xrecord.toUpperCase());

    if (i === undefined) throw new EditError(`The file has no record ${record.xrecord}`);
    patched.set(i, xrecord);
  }

  return { before, patched };
}

/** The header with `$HANDSEED` written again, or undefined for a file whose header names none. */
export function withHandseed(
  bytes: Uint8Array,
  doc: DxfDocument,
  seed: bigint,
): { readonly start: number; readonly end: number; readonly text: string } | undefined {
  const v = doc.header().find((x) => x.name === "$HANDSEED");

  if (v === undefined) return undefined;
  const text = new TextDecoder("latin1").decode(bytes.subarray(v.start, v.start + v.length));
  const m = /(\n\s*5\r?\n)(\s*)([0-9A-Fa-f]{1,16})/.exec(text);

  if (!m) return undefined;
  const at = m.index + m[1]!.length + m[2]!.length;

  return {
    start: v.start + at,
    end: v.start + at + m[3]!.length,
    text: seed.toString(16).toUpperCase(),
  };
}
