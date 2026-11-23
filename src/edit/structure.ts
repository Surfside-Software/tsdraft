// The structure check of a DXF, as the leading CAD app's AUDIT would find a fault: every handle
// once and below `$HANDSEED`, every owner and pointer naming a record, every layer with its plot
// style, every entity's layer, linetype and style a record of its table, and each style's and
// block's list of what uses it. A defect is named by handles and names, never by offsets, so the
// defects of a file and of its edited copy compare, and a copy adds none of its own.
import { layerKey } from "../layers.ts";
import { GroupReader } from "../read/groups.ts";
import { Strings } from "../shape.ts";

/** A fault the check finds. Two defects with the same `rule` and `detail` are one. */
export interface StructureDefect {
  readonly rule: string;
  readonly detail: string;
}

/** The most defects a check lists; past them it counts. */
export const MOST_DEFECTS = 10_000;

/** The defects of a file, the first `MOST_DEFECTS` of them, and how many there were. */
export interface StructureReport {
  readonly defects: readonly StructureDefect[];
  readonly count: number;
}

/** True for a group code whose value must name a record: owners and pointers. */
const mustResolve = (code: number): boolean =>
  (code >= 330 && code <= 369) || (code >= 390 && code <= 399) || code === 480 || code === 481;

const HANDLE = /^[0-9A-Fa-f]{1,16}$/;

/** A handle as its digits, in capitals and with no leading zero. */
const canonical = (value: string): string => value.replace(/^0+(?=.)/, "").toUpperCase();

/**
 * A name as a defect quotes it: whole up to 200 characters, and past them its start and its
 * length, so a defect's key stays short whatever the file holds.
 */
const quoted = (name: string): string =>
  name.length <= 200 ? name : `${name.slice(0, 200)}… (${name.length} characters)`;

const below = (handle: string, seed: string): boolean =>
  handle.length !== seed.length ? handle.length < seed.length : handle < seed;

/** The kinds whose group 7 names a text style. */
const TEXT_KINDS: ReadonlySet<string> = new Set(["TEXT", "MTEXT", "ATTRIB", "ATTDEF"]);

class Defects {
  readonly list: StructureDefect[] = [];
  readonly seen = new Set<string>();
  count = 0;
  add(rule: string, detail: string): void {
    const key = `${rule}\n${detail}`;

    if (this.seen.has(key)) return;
    this.count++;

    if (this.list.length < MOST_DEFECTS) {
      this.seen.add(key);
      this.list.push({ rule, detail });
    }
  }
}

interface Held {
  kind: string;
  section: string;
  handle: string | undefined;
  owner: string | undefined;
  name: string | undefined;
  layer: string | undefined;
  linetype: string | undefined;
  style: string | undefined;
  dimensionStyle: string | undefined;
  plotStyle: boolean;
  group: string | undefined;
  embedded: boolean;
  xdata: boolean;
}

const fresh = (kind: string, section: string): Held => ({
  kind,
  section,
  handle: undefined,
  owner: undefined,
  name: undefined,
  layer: undefined,
  linetype: undefined,
  style: undefined,
  dimensionStyle: undefined,
  plotStyle: false,
  group: undefined,
  embedded: false,
  xdata: false,
});

/**
 * The structure check of a DXF: its defects, each named by the handles and names it is about.
 * Never throws: a file whose groups do not read is one defect, `unreadable`.
 */
export function dxfStructure(bytes: Uint8Array): StructureReport {
  const defects = new Defects();
  /** Each handle's kind, and how many records hold it. */
  const kinds = new Map<string, string>();
  const twice = new Set<string>();

  // Names come from the file, so they are keyed as `Strings` keys them (docs/agents/bounded.md).
  const names = new Map([
    ["LAYER", new Strings<true>()],
    ["LTYPE", new Strings<true>()],
    ["STYLE", new Strings<true>()],
    ["DIMSTYLE", new Strings<true>()],
  ]);

  const has = (table: string, name: string): boolean =>
    names.get(table)!.get(layerKey(name)) !== undefined;

  /** References whose record is not yet known: from, code, to. */
  const pending: string[] = [];
  /** The handle of each record that names an entity by group 331 in `{BLKREFS`, by block name. */
  const blockRefs = new Map<string, Set<string>>();
  const blockHandles = new Strings<string>();
  /** Each insert's handle, by the block it names, and the names in the order first met. */
  const inserts = new Strings<string[]>();
  const insertNames: string[] = [];
  let seed: string | undefined;
  let section = "";
  let sectionNext = false;
  let table = "";
  let headerName = "";
  let record: Held = fresh("", "");

  const close = (): void => {
    const r = record;

    if (r.handle !== undefined) {
      if (kinds.has(r.handle)) twice.add(r.handle);
      else kinds.set(r.handle, r.kind);
    }

    if (r.section === "TABLES" && r.kind === table && names.has(table) && r.name !== undefined)
      names.get(table)!.set(layerKey(r.name), true);

    if (r.kind === "LAYER" && r.section === "TABLES" && !r.plotStyle)
      defects.add(
        "layer-plot-style",
        `the layer ${quoted(r.name ?? "?")} (${r.handle ?? "?"}) names no plot style`,
      );

    if (r.kind === "BLOCK_RECORD" && r.name !== undefined && r.handle !== undefined)
      blockHandles.set(layerKey(r.name), r.handle);

    if (r.kind === "INSERT" && r.name !== undefined && r.handle !== undefined) {
      const key = layerKey(r.name);
      let list = inserts.get(key);

      if (list === undefined) {
        inserts.set(key, (list = []));
        insertNames.push(key);
      }

      list.push(r.handle);
    }

    if (r.section === "ENTITIES" || r.section === "BLOCKS") {
      const at = `the ${quoted(r.kind)} ${r.handle ?? "?"}`;

      if (r.layer !== undefined && !has("LAYER", r.layer))
        defects.add(
          "entity-layer",
          `${at} is on the layer ${quoted(r.layer)}, which the file lacks`,
        );

      if (
        r.linetype !== undefined &&
        !/^by(layer|block)$/i.test(r.linetype) &&
        !has("LTYPE", r.linetype)
      )
        defects.add(
          "entity-linetype",
          `${at} names the linetype ${quoted(r.linetype)}, which the file lacks`,
        );

      if (r.style !== undefined && TEXT_KINDS.has(r.kind) && !has("STYLE", r.style))
        defects.add(
          "entity-style",
          `${at} names the text style ${quoted(r.style)}, which the file lacks`,
        );

      if (
        r.dimensionStyle !== undefined &&
        r.kind === "DIMENSION" &&
        !has("DIMSTYLE", r.dimensionStyle)
      )
        defects.add(
          "entity-style",
          `${at} names the dimension style ${quoted(r.dimensionStyle)}, which the file lacks`,
        );
    }
  };

  const group = (code: number, value: string): void => {
    const trimmed = value.trim();

    if (code === 0) {
      close();
      record = fresh(trimmed, section);

      if (trimmed === "SECTION") sectionNext = true;
      else if (trimmed === "ENDSEC") section = "";
      else if (trimmed === "ENDTAB") table = "";

      return;
    }

    if (sectionNext && code === 2) {
      sectionNext = false;
      section = trimmed.toUpperCase();

      return;
    }

    if (section === "HEADER") {
      if (code === 9) headerName = trimmed;
      else if (headerName === "$HANDSEED" && code === 5 && HANDLE.test(trimmed))
        seed = canonical(trimmed);
      else if (mustResolve(code) && HANDLE.test(trimmed) && canonical(trimmed) !== "0")
        pending.push(`the header's ${quoted(headerName)}`, String(code), canonical(trimmed));

      return;
    }

    const r = record;

    if (r.kind === "TABLE" && code === 2) {
      table = trimmed.toUpperCase();

      return;
    }

    if (code === 102) {
      r.group = trimmed.startsWith("{") ? trimmed.toUpperCase() : undefined;

      return;
    }

    if (code === 101) r.embedded = true;

    if (code === 1001) r.xdata = true;
    const own = r.kind === "DIMSTYLE" ? code === 105 : code === 5;

    if (own && r.handle === undefined && !r.xdata) {
      if (HANDLE.test(trimmed)) r.handle = canonical(trimmed);

      return;
    }

    if (r.xdata || r.embedded) return;

    if (mustResolve(code) && HANDLE.test(trimmed)) {
      const to = canonical(trimmed);

      if (to === "0") return;

      if (code === 330 && r.group === undefined && r.owner === undefined) r.owner = to;

      if (code === 390 && r.kind === "LAYER") r.plotStyle = true;

      // A block's list of its inserts, which a pointer of its own names too.
      if (code === 331 && r.group === "{BLKREFS" && r.kind === "BLOCK_RECORD") {
        const key = r.handle ?? "";
        const set = blockRefs.get(key) ?? new Set<string>();
        set.add(to);
        blockRefs.set(key, set);
      }

      // The table of dimension styles lists its records by soft pointers, group 340, and the
      // leading CAD app's own save keeps one to a style it dropped, which its `AUDIT` passes.
      if (code === 340 && r.kind === "TABLE" && table === "DIMSTYLE") return;
      pending.push(`the ${quoted(r.kind)} ${r.handle ?? "?"}`, String(code), to);

      return;
    }

    if (r.group !== undefined) return;

    switch (code) {
      case 2:
        r.name ??= value;
        break;
      case 3:
        r.dimensionStyle ??= value;
        break;
      case 6:
        r.linetype ??= value;
        break;
      case 7:
        r.style ??= value;
        break;
      case 8:
        r.layer ??= value;
        break;
    }
  };

  try {
    const reader = new GroupReader(group);
    reader.push(bytes);
    reader.end();
    close();
  } catch (error) {
    defects.add(
      "unreadable",
      `the file's groups do not read: ${error instanceof Error ? error.message : String(error)}`,
    );

    return { defects: defects.list, count: defects.count };
  }

  for (const handle of twice) defects.add("handle-twice", `the handle ${handle} is held twice`);

  if (seed === undefined) defects.add("handle-seed", "the header has no $HANDSEED");
  else
    for (const handle of kinds.keys())
      if (!below(handle, seed))
        defects.add("handle-past-seed", `the handle ${handle} is not below $HANDSEED ${seed}`);

  for (let i = 0; i < pending.length; i += 3) {
    if (!kinds.has(pending[i + 2]!))
      defects.add(
        "reference",
        `${pending[i]!}'s group ${pending[i + 1]!} names ${pending[i + 2]!}, which no record holds`,
      );
  }

  // A block's record that keeps a list of the inserts of it keeps every one.
  for (const block of insertNames) {
    // A long name another took the place of in `inserts` has no list there.
    const list = inserts.get(block);

    if (list === undefined) continue;
    const record = blockHandles.get(block);
    const refs = record === undefined ? undefined : blockRefs.get(record);

    if (refs === undefined) continue;

    for (const insert of list)
      if (!refs.has(insert))
        defects.add(
          "insert-list",
          `the block ${record}'s list of its inserts leaves out ${insert}`,
        );
  }

  for (const [record, refs] of blockRefs)
    for (const insert of refs)
      if (kinds.has(insert) && !["INSERT", "ACAD_TABLE"].includes(kinds.get(insert)!))
        defects.add(
          "insert-list",
          `the block ${record}'s list of its inserts names the ${quoted(kinds.get(insert)!)} ${insert}`,
        );

  return { defects: defects.list, count: defects.count };
}

/** The defects of `after` that `before` does not hold. */
export function newDefects(before: StructureReport, after: StructureReport): StructureDefect[] {
  const held = new Set(before.defects.map((d) => `${d.rule}\n${d.detail}`));

  return after.defects.filter((d) => !held.has(`${d.rule}\n${d.detail}`));
}
