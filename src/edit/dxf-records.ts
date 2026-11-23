// The records an edit of a DXF reaches: what an erasure takes with it, by ownership and by the
// records that follow an insert or a polyline, and each reference to what it takes, made by the
// rules of the erasure's table or refused; and what a move takes with it.
import { isString } from "../guards.ts";
import { layerKey } from "../layers.ts";
import type { DxfDocument } from "../read/document.ts";
import type { DrawingRead } from "../read/model.ts";
import { changeSplices, type ChangeRecords } from "./dxf-changes.ts";
import { groupsOf, leftOut, numberAs, spliced, type HeldGroup, type Splice } from "./dxf-groups.ts";
import { moveRecord } from "./dxf-move.ts";
import { canonicalHandle, EditError, type Edit } from "./model.ts";
import { applied, type Applied } from "./transform.ts";

/** What the edit made of each record: left out, or its bytes made again. */
export interface RecordEdits {
  readonly erased: ReadonlySet<number>;
  readonly patched: ReadonlyMap<number, Uint8Array>;
}

interface Records {
  readonly bytes: Uint8Array;
  readonly doc: DxfDocument;
  readonly byHandle: ReadonlyMap<string, number>;
  /** The handles more than one record holds. */
  readonly twice: ReadonlySet<string>;
  /** Each record's place among the names of `doc`: its kind and section. */
  kind(i: number): string;
  section(i: number): string;
  groups(i: number): HeldGroup[];
}

function recordsOf(bytes: Uint8Array, doc: DxfDocument): Records {
  const byHandle = new Map<string, number>();
  const twice = new Set<string>();

  for (let i = 0; i < doc.count; i++) {
    const h = doc.handle(i);

    if (h === undefined) continue;
    const key = canonicalHandle(h);

    if (byHandle.has(key)) twice.add(key);
    else byHandle.set(key, i);
  }

  const held = new Map<number, HeldGroup[]>();

  return {
    bytes,
    doc,
    byHandle,
    twice,
    kind: (i) => doc.names[doc.kinds[i]!] ?? "",
    section: (i) => doc.names[doc.sections[i]!] ?? "",
    groups(i) {
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
    },
  };
}

/** The value of a record's first group of a code outside its braces and extended data. */
function firstOf(groups: readonly HeldGroup[], code: number): string | undefined {
  let braces = false;

  for (const g of groups) {
    if (g.code === 1001) return undefined;

    if (g.code === 102) braces = g.value.trim().startsWith("{");
    else if (!braces && g.code === code) return g.value.trim();
  }

  return undefined;
}

/** The handle of the entry `name` of the dictionary of record `i`, or undefined. */
function dictionaryEntry(r: Records, i: number, name: string): string | undefined {
  const groups = r.groups(i);

  for (let k = 0; k + 1 < groups.length; k++)
    if (groups[k]!.code === 3 && groups[k]!.value.trim() === name) {
      const next = groups[k + 1]!;

      if (next.code === 350 || next.code === 360) return next.value.trim();
    }

  return undefined;
}

/** The records that follow an insert with attributes or a 2D polyline, its own up to its SEQEND. */
function followers(r: Records, i: number): number[] {
  const kind = r.kind(i);

  if (kind !== "INSERT" && kind !== "POLYLINE") return [];

  if (kind === "INSERT" && Number(firstOf(r.groups(i), 66) ?? 0) !== 1) return [];
  const out: number[] = [];

  for (let j = i + 1; j < r.doc.count; j++) {
    const k = r.kind(j);

    if (k !== "ATTRIB" && k !== "VERTEX" && k !== "SEQEND") break;
    out.push(j);

    if (k === "SEQEND") break;
  }

  return out;
}

/** Each block record by its name, as the leading CAD app compares names. */
function blockRecords(r: Records): Map<string, number> {
  const out = new Map<string, number>();

  for (let i = 0; i < r.doc.count; i++)
    if (r.kind(i) === "BLOCK_RECORD" && r.section(i) === "TABLES") {
      const name = firstOf(r.groups(i), 2);

      if (name !== undefined) out.set(layerKey(name), i);
    }

  return out;
}

/**
 * How many times the file inserts each block, by name: every INSERT record, in a space, a block or
 * a picture and inside or outside a read's part, a block in rows and columns once for each.
 */
function insertCounts(r: Records): Map<string, number> {
  const out = new Map<string, number>();

  for (let i = 0; i < r.doc.count; i++) {
    if (r.kind(i) !== "INSERT") continue;
    const groups = r.groups(i);
    const name = firstOf(groups, 2);

    if (name === undefined) continue;

    const times =
      Math.max(1, Number(firstOf(groups, 70) ?? 1)) * Math.max(1, Number(firstOf(groups, 71) ?? 1));

    out.set(layerKey(name), (out.get(layerKey(name)) ?? 0) + (Number.isFinite(times) ? times : 2));
  }

  return out;
}

/** The block record of a dimension's or a table's picture, which it alone names. */
function pictureOf(r: Records, i: number, blocks: () => Map<string, number>): number | undefined {
  const kind = r.kind(i);

  if (!["DIMENSION", "ARC_DIMENSION", "LARGE_RADIAL_DIMENSION", "ACAD_TABLE"].includes(kind))
    return undefined;
  const name = firstOf(r.groups(i), 2);

  return name === undefined || !/^\*[DT]/i.test(name) ? undefined : blocks().get(layerKey(name));
}

/** The records owned by each record, by the owner's place. */
function ownedBy(r: Records): Map<number, number[]> {
  const out = new Map<number, number[]>();

  for (let i = 0; i < r.doc.count; i++) {
    const owner = r.doc.owner(i);

    if (owner === undefined) continue;
    const o = r.byHandle.get(canonicalHandle(owner));

    if (o === undefined || o === i) continue;
    const list = out.get(o);

    if (list) list.push(i);
    else out.set(o, [i]);
  }

  return out;
}

const handleOf = (r: Records, i: number): string => {
  const h = r.doc.handle(i);

  return h === undefined ? `the ${r.kind(i)} at byte ${r.doc.starts[i]}` : canonicalHandle(h);
};

/** True for a block record of a dynamic block's definition. */
function dynamic(r: Records, record: number): boolean {
  const groups = r.groups(record);

  if (groups.some((g) => g.code === 1001 && g.value.trim() === "AcDbDynamicBlockGUID")) return true;
  const xdict = groups.findIndex((g) => g.code === 102 && g.value.trim() === "{ACAD_XDICTIONARY");
  const h = xdict >= 0 ? groups[xdict + 1]?.value.trim() : undefined;
  const d = h === undefined ? undefined : r.byHandle.get(canonicalHandle(h));

  return (
    d !== undefined &&
    r.groups(d).some((g) => g.code === 3 && g.value.trim() === "ACAD_ENHANCEDBLOCK")
  );
}

/**
 * What an edit makes of each record of a DXF: each erased record with what it takes, and each
 * record it changes made again. Throws an `EditError` naming the statement for a reference to
 * what an erasure takes that no rule makes, and for a record a move cannot make.
 */
export function recordEdits(
  bytes: Uint8Array,
  doc: DxfDocument,
  edit: Edit,
  read: DrawingRead,
): RecordEdits {
  const r = recordsOf(bytes, doc);
  let blocks: Map<string, number> | undefined;
  const blocksOf = (): Map<string, number> => (blocks ??= blockRecords(r));
  let inserts: Map<string, number> | undefined;
  const insertsOf = (): Map<string, number> => (inserts ??= insertCounts(r));
  let owned: Map<number, number[]> | undefined;
  const ownedOf = (): Map<number, number[]> => (owned ??= ownedBy(r));
  const erased = new Map<number, number>();
  const moved = new Map<number, number>();
  const transforms: (Applied | undefined)[] = [];

  const named = (h: string, statement: number): number => {
    const i = r.byHandle.get(canonicalHandle(h));

    if (i === undefined) throw new EditError(`The file holds no record ${h}`, statement);

    if (r.twice.has(canonicalHandle(h)))
      throw new EditError(
        `The file holds ${h} in more than one record, so no edit names it`,
        statement,
      );

    if (r.section(i) === "BLOCKS") {
      const owner = doc.owner(i);
      const record = owner === undefined ? undefined : r.byHandle.get(canonicalHandle(owner));

      if (record === undefined)
        throw new EditError(`${h} is in a block whose record the file lacks`, statement);

      if (dynamic(r, record))
        throw new EditError(
          `${h} is of a dynamic block's definition, which no edit changes`,
          statement,
        );
      // The read may not see every insert: one in a dimension's picture, or outside its part.
      const name = firstOf(r.groups(record), 2) ?? "";
      const times = insertsOf().get(layerKey(name)) ?? 0;

      if (times > 1)
        throw new EditError(
          `${h} is of the block ${JSON.stringify(name)}, which the file inserts ${times} times: changing it would change every insert of it`,
          statement,
        );
    }

    return i;
  };

  edit.statements.forEach((s, statement) => {
    if (s.kind !== "erase" && s.kind !== "move") return;
    const into = s.kind === "erase" ? erased : moved;
    transforms[statement] = s.kind === "move" ? applied(s.transform) : undefined;

    const take = (i: number): void => {
      const own = doc.handle(i);

      if (own !== undefined && r.twice.has(canonicalHandle(own)))
        throw new EditError(
          `The file holds ${canonicalHandle(own)} in more than one record, so no edit reaches it`,
          statement,
        );
      const was = erased.get(i) ?? moved.get(i);

      if (was !== undefined && was !== statement)
        throw new EditError(
          `Statements ${was} and ${statement} both reach ${handleOf(r, i)}`,
          statement,
        );
      into.set(i, statement);
    };

    for (const h of new Set(s.handles.map(canonicalHandle))) {
      const i = named(h, statement);
      take(i);

      for (const f of followers(r, i)) take(f);
      const picture = pictureOf(r, i, blocksOf);

      if (s.kind === "erase") {
        if (picture !== undefined) take(picture);
      } else {
        // A table's picture is in the table's own coordinates, and moves with it as it stands.
        if (picture !== undefined && r.kind(i) !== "ACAD_TABLE")
          for (const p of ownedOf().get(picture) ?? [])
            if (r.section(p) === "BLOCKS" && !["BLOCK", "ENDBLK"].includes(r.kind(p))) take(p);

        if (r.kind(i) === "VIEWPORT") {
          const clip = firstOf(r.groups(i), 340);

          const c =
            clip === undefined || /^0+$/.test(clip)
              ? undefined
              : r.byHandle.get(canonicalHandle(clip));

          // The clip moves whole, a 2D polyline with its vertices.
          if (c !== undefined) for (const k of [c, ...followers(r, c)]) take(k);
        }
      }
    }
  });

  // Each change: its records' splices, and the fields a whole value takes out, erased.
  const records: ChangeRecords = {
    bytes,
    doc,
    byHandle: r.byHandle,
    kind: r.kind,
    section: r.section,
    groups: (i) => r.groups(i),
    named,
    followers: (i) => followers(r, i),
    dictionaryEntry: (i, name) => dictionaryEntry(r, i, name),
  };

  const changes = changeSplices(records, edit, read);

  for (const [i, statement] of changes.erased) {
    if (erased.has(i) || moved.has(i))
      throw new EditError(
        `${handleOf(r, i)} is reached by statement ${erased.get(i) ?? moved.get(i)} and by ${statement}`,
        statement,
      );
    erased.set(i, statement);
  }

  // What an erasure owns goes with it, at any depth.
  const queue = [...erased.keys()];

  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    const statement = erased.get(i)!;

    for (const child of [...(ownedOf().get(i) ?? []), ...followers(r, i)]) {
      if (erased.has(child)) continue;
      const own = doc.handle(child);

      if (own !== undefined && r.twice.has(canonicalHandle(own)))
        throw new EditError(
          `The file holds ${canonicalHandle(own)} in more than one record, so no edit erases it`,
          statement,
        );

      if (moved.has(child))
        throw new EditError(
          `${handleOf(r, child)} is moved by statement ${moved.get(child)} and erased with ${handleOf(r, i)}`,
          statement,
        );
      erased.set(child, statement);
      queue.push(child);
    }
  }

  const gone = new Set<string>();

  for (const i of erased.keys()) {
    const h = doc.handle(i);

    if (h !== undefined) gone.add(canonicalHandle(h));
  }

  const splices = new Map<number, Splice[]>(changes.splices);

  const add = (i: number, list: readonly Splice[]): void => {
    if (list.length === 0) return;
    const held = splices.get(i);

    if (held) held.push(...list);
    else splices.set(i, [...list]);
  };

  // Each reference to what goes, from what stays.
  if (gone.size > 0)
    for (let j = 0; j < doc.count; j++) {
      if (erased.has(j)) continue;
      const refs = doc.references(j);

      if (!refs.some((ref) => gone.has(canonicalHandle(ref.handle)))) continue;
      add(j, referencesOut(r, j, gone, erased));
    }

  // Each moved record's points, angles and sizes.
  for (const [i, statement] of moved) {
    // A vertex is in its polyline's coordinates.
    const owner = r.kind(i) === "VERTEX" ? doc.owner(i) : undefined;
    const polyline = owner === undefined ? undefined : r.byHandle.get(canonicalHandle(owner));

    let made: ReturnType<typeof moveRecord>;

    try {
      made = moveRecord(
        r.kind(i),
        r.groups(i),
        transforms[statement]!,
        polyline === undefined ? undefined : r.groups(polyline),
      );
    } catch (error) {
      if (!(error instanceof EditError) || error.statement !== undefined) throw error;
      throw new EditError(`${handleOf(r, i)}: ${error.message}`, statement);
    }

    if (isString(made)) throw new EditError(`${handleOf(r, i)}: ${made}`, statement);
    add(i, made);
    associations(r, i, statement, moved, erased);
  }

  const patched = new Map<number, Uint8Array>();

  for (const [i, list] of splices) {
    const start = doc.starts[i]!;
    patched.set(i, spliced(bytes, start, start + doc.length(i), list));
  }

  return { erased: new Set(erased.keys()), patched };
}

/** The splices that take what goes out of record `j`, or an `EditError` for one no rule takes. */
function referencesOut(
  r: Records,
  j: number,
  gone: ReadonlySet<string>,
  erased: ReadonlyMap<number, number>,
): Splice[] {
  const kind = r.kind(j);
  const groups = r.groups(j);
  const out: Splice[] = [];
  let braces: string | undefined;
  let inData = false;
  let fieldCount: HeldGroup | undefined;
  let fieldsOut = 0;

  for (let k = 0; k < groups.length; k++) {
    const g = groups[k]!;

    if (g.code === 1001) inData = true;

    if (g.code === 102) {
      const v = g.value.trim();
      braces = v.startsWith("{") ? v.toUpperCase() : undefined;
      continue;
    }

    if (kind === "FIELDLIST" && g.code === 90 && fieldCount === undefined && braces === undefined)
      fieldCount = g;
    const value = g.value.trim();

    if (!/^[0-9A-Fa-f]{1,16}$/.test(value) || !gone.has(canonicalHandle(value))) continue;

    if (
      !(
        (g.code >= 320 && g.code <= 369) ||
        (g.code >= 390 && g.code <= 399) ||
        g.code === 480 ||
        g.code === 481 ||
        g.code === 1005
      )
    )
      continue;
    const by = erased.get(r.byHandle.get(canonicalHandle(value)) ?? -1);

    const refuse = (why: string): never => {
      throw new EditError(
        `${handleOf(r, j)}, a ${kind}, ${why} ${canonicalHandle(value)}, which the edit erases`,
        by,
      );
    };

    if (inData) refuse("names in its extended data");

    if (kind === "DIMASSOC") {
      const dictionary = r.doc.owner(j);
      const d = dictionary === undefined ? undefined : r.byHandle.get(canonicalHandle(dictionary));
      const dimension = d === undefined ? undefined : r.doc.owner(d);
      throw new EditError(
        `${canonicalHandle(value)} is named by the associative dimension ${dimension === undefined ? "of the DIMASSOC " + handleOf(r, j) : canonicalHandle(dimension)}: erase the dimension in the same edit, or leave ${canonicalHandle(value)}`,
        by,
      );
    }

    if (braces === "{ACAD_REACTORS" && g.code === 330) out.push(leftOut(g));
    else if (braces === undefined && kind === "DICTIONARY" && (g.code === 350 || g.code === 360)) {
      // An entry of a dictionary, its name and its object, as a field's goes from its text's.
      const entry = groups[k - 1];

      if (entry?.code !== 3) refuse("names as a dictionary's object without its name");
      out.push(leftOut(entry!), leftOut(g));
    } else if (braces === "{BLKREFS" && g.code === 331 && kind === "BLOCK_RECORD")
      out.push(leftOut(g));
    else if (braces !== undefined) refuse(`names in its ${braces} group`);
    else if (kind === "GROUP" && g.code === 340) out.push(leftOut(g));
    else if (kind === "SORTENTSTABLE" && g.code === 331) {
      out.push(leftOut(g));
      const sort = groups[k + 1];

      if (sort?.code === 5) {
        out.push(leftOut(sort));
        k++;
      }
    } else if (kind === "SORTENTSTABLE" && g.code === 5) {
      // A sort handle of an erased entity whose pair keeps another entity: the pair goes with it.
      const entity = groups[k - 1];

      if (entity?.code !== 331) refuse("names as a sort handle");
    } else if (kind === "FIELDLIST" && g.code === 330) {
      out.push(leftOut(g));
      fieldsOut++;
    } else if (kind === "LEADER" && g.code === 340) refuse("names as its note");
    else if (kind === "HATCH" && g.code === 330) refuse("is bounded by");
    else refuse(`names by its group ${g.code}`);
  }

  if (fieldsOut > 0 && fieldCount !== undefined)
    out.push(numberAs(fieldCount, Number(fieldCount.value) - fieldsOut));

  return out;
}

/**
 * Refuses a move that would part an associative dimension or hatch from what it names: each
 * moves only with the other, in the same statement, or with the other erased.
 */
function associations(
  r: Records,
  i: number,
  statement: number,
  moved: ReadonlyMap<number, number>,
  erased: ReadonlyMap<number, number>,
): void {
  const groups = r.groups(i);

  const together = (h: string): boolean => {
    const j = r.byHandle.get(canonicalHandle(h));

    return j !== undefined && (moved.get(j) === statement || erased.has(j));
  };

  let braces: string | undefined;

  for (const g of groups) {
    if (g.code === 1001) break;

    if (g.code === 102) {
      const v = g.value.trim();
      braces = v.startsWith("{") ? v.toUpperCase() : undefined;
      continue;
    }

    if (braces !== "{ACAD_REACTORS" || g.code !== 330) continue;
    const j = r.byHandle.get(canonicalHandle(g.value.trim()));

    if (j === undefined) continue;
    const kind = r.kind(j);

    if (kind === "DIMASSOC") {
      // The dimension is the owner of the dictionary that owns its DIMASSOC.
      const dictionary = r.doc.owner(j);
      const d = dictionary === undefined ? undefined : r.byHandle.get(canonicalHandle(dictionary));
      const dimension = d === undefined ? undefined : r.doc.owner(d);

      if (dimension === undefined || !together(dimension))
        throw new EditError(
          `${handleOf(r, i)} is named by the associative dimension ${dimension ?? "?"}: move both in one statement, by a move alone, or erase the dimension`,
          statement,
        );
    } else if (kind === "HATCH" && !together(r.doc.handle(j)!)) {
      throw new EditError(
        `${handleOf(r, i)} bounds the associative hatch ${handleOf(r, j)}, which moves only with it`,
        statement,
      );
    }
  }

  const kind = r.kind(i);

  if (kind === "HATCH" && Number(firstOf(groups, 71) ?? 0) === 1) {
    let inHatch = false;

    for (const g of groups) {
      if (g.code === 1001) break;

      if (g.code === 100) inHatch = g.value.trim() === "AcDbHatch";

      if (inHatch && g.code === 330 && !together(g.value.trim()))
        throw new EditError(
          `${handleOf(r, i)} is an associative hatch whose boundary ${canonicalHandle(g.value.trim())} moves only with it`,
          statement,
        );
    }
  }

  if (["DIMENSION", "ARC_DIMENSION", "LARGE_RADIAL_DIMENSION"].includes(kind)) {
    const xdict = groups.findIndex((g) => g.code === 102 && g.value.trim() === "{ACAD_XDICTIONARY");
    const h = xdict >= 0 ? groups[xdict + 1]?.value.trim() : undefined;
    const d = h === undefined ? undefined : r.byHandle.get(canonicalHandle(h));

    if (d === undefined) return;
    const dg = r.groups(d);

    for (let k = 0; k + 1 < dg.length; k++) {
      if (dg[k]!.code !== 3 || dg[k]!.value.trim() !== "ACAD_DIMASSOC") continue;
      const a = r.byHandle.get(canonicalHandle(dg[k + 1]!.value.trim()));

      if (a === undefined) continue;

      for (const g of r.groups(a))
        if (g.code === 331 && !together(g.value.trim()))
          throw new EditError(
            `${handleOf(r, i)} is an associative dimension of ${canonicalHandle(g.value.trim())}, which moves only with it`,
            statement,
          );
    }
  }
}
