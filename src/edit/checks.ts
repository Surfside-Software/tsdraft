// The checks of every job, which an edited file passes before a write leaves it: read back,
// structure, before and after and lint, each of one file. The fifth, the changed sheets, draws the
// job's sheets with every copy in place, so the command runs it once the copies are made. Each
// compares with the source as it was, so a defect the firm's file already had is told from a new
// one.
import { isKeyed, isNumber, isString, type Json } from "../guards.ts";
import type { DrawingRead, ReadPart } from "../read/model.ts";
import { DxfDocumentReader, type DxfDocument } from "../read/document.ts";
import { readDXFDocument } from "../read/dxf.ts";
import { MOST_OWN_BLOCKS } from "../read/part.ts";
import { editDXF } from "./dxf.ts";
import type { Edit } from "./model.ts";
import { replacement, withReplacement, writesAdditions } from "./replaced.ts";
import { editedRead } from "./edited.ts";
import { lintEdit } from "./lint.ts";
import { canonicalHandle, handleNumber } from "./model.ts";
import { layerNamed } from "./changed.ts";
import { editReach, indexRead, ownPicture } from "./reach.ts";
import { dxfStructure, newDefects, type StructureReport } from "./structure.ts";

/**
 * What a format's editor gives the checks: its read with geometry, its edit, its structure check,
 * and its records by key, a handle or a place, so a copy's records are held to the source's.
 */
export interface FileEditor {
  /**
   * The file's read with geometry, of the part `only` names, with the blocks `blocks` names kept
   * apart, as `ReadOptions` takes both.
   */
  read(bytes: Uint8Array, only?: ReadPart, blocks?: readonly string[]): Promise<DrawingRead>;
  edit(bytes: Uint8Array, edit: Edit, read: DrawingRead): Uint8Array;
  structure(bytes: Uint8Array): StructureReport;
  records(bytes: Uint8Array): ReadonlyMap<string, Uint8Array>;
  /**
   * Each record's owner and the handles it refers to, by the keys `records` gives, so the check
   * holds a record an erasure changed to the source's less what it took out.
   */
  links(bytes: Uint8Array): ReadonlyMap<string, RecordLinks>;
  /**
   * The file's header as text, with the handle seed left out, which additions alone change of it,
   * and `$VISRETAIN` with it where `visretain` is true, which a change of an xref's layer sets: the
   * check holds a copy's header to the source's but for those.
   */
  headerWithoutSeed?(bytes: Uint8Array, visretain?: boolean): string;
}

/** What a record names: its owner, and every handle it refers to, its owner's among them. */
export interface RecordLinks {
  readonly owner?: string;
  readonly references: readonly string[];
  /** Its kind, such as `TABLE` or `BLOCK_RECORD`, where the editor tells it. */
  readonly kind?: string;
  /** A dictionary's entries, each name's handle, so the check finds a text's fields. */
  readonly entries?: Readonly<Record<string, string>>;
}

/** The module an editor's package names under `"tsdraft": { "editors": { ".dwg": ... } }`. */
export interface EditorModule {
  readonly editor: FileEditor;
}

export type EditCheckName = "read-back" | "structure" | "before-after" | "lint" | "sheets";

/** One check's result: what it found new, and for the structure check what the source held. */
export interface EditCheck {
  readonly check: EditCheckName;
  readonly passed: boolean;
  readonly problems: readonly string[];
  /** How many defects the source holds, which the copy keeps as the file's own. */
  readonly own?: number;
  /**
   * Before and after: each block the copy's read counts past its limit, such as one an edit adds to
   * a file read in part, by handle with its count of entities. The count is held to the edit's;
   * the geometry is not compared.
   */
  readonly notCompared?: readonly string[];
  /** The changed sheets: each layout drawn as it plots after the edit, as a PNG and a PDF. */
  readonly sheets?: readonly EditSheet[];
}

/** A sheet the changed sheets' check drew. */
export interface EditSheet {
  /** The sheet's file, by its path in the project. */
  readonly file: string;
  readonly layout: string;
  /** The pictures written, by their paths. */
  readonly png: string;
  readonly pdf: string;
}

/**
 * The records the additions change without naming anything new: a table's count, and the header
 * and the class list a seed and a class are written into, by their kind or key.
 */
const ADDED_TO: ReadonlySet<string> = new Set([
  "TABLE",
  "#0",
  "section AcDb:Header",
  "section AcDb:Classes",
  "section AcDb:AuxHeader",
]);

/** The most problems one check lists. */
const MOST_PROBLEMS = 50;

/**
 * Each record's key: its handle, or its place among the records with none, and a record that
 * holds a handle an earlier one holds too, the handle and which repeat it is, so an erasure of
 * other records moves no key.
 */
function keysOf(document: DxfDocument, bytes: Uint8Array): string[] {
  const keys: string[] = [];
  const seen = new Map<string, number>();
  let unhandled = 0;

  for (let i = 0; i < document.count; i++) {
    const handle = document.handle(i);

    // A class by its name, so one an addition writes moves no other record's key.
    if (handle === undefined && document.names[document.kinds[i]!] === "CLASS") {
      const start = document.starts[i]!;

      const text = new TextDecoder("latin1").decode(
        bytes.subarray(start, start + Math.min(document.length(i), 4096)),
      );

      keys.push(`CLASS:${/\n\s*1\r?\n([^\r\n]*)/.exec(text)?.[1]?.trim() ?? i}`);
      continue;
    }

    if (handle === undefined) {
      keys.push(`#${unhandled++}`);
      continue;
    }

    const n = seen.get(handle) ?? 0;
    seen.set(handle, n + 1);
    keys.push(n === 0 ? handle : `${handle}#${n}`);
  }

  return keys;
}

/** The editor of the 2018 format's DXF, in the core. */
export const dxfEditor: FileEditor = {
  read: async (bytes, only, blocks) =>
    (
      await readDXFDocument(bytes, {
        geometry: true,
        ...(only !== undefined && { only }),
        ...(blocks !== undefined && { blocks }),
      })
    ).read,
  edit: editDXF,
  structure: dxfStructure,
  headerWithoutSeed(bytes, visretain = false) {
    const reader = new DxfDocumentReader();
    reader.push(bytes);
    const document = reader.end();

    for (let i = 0; i < document.count; i++) {
      const start = document.starts[i]!;

      const text = new TextDecoder("latin1").decode(
        bytes.subarray(start, start + document.length(i)),
      );

      if (/^\s*0\r?\n\s*SECTION\r?\n\s*2\r?\n\s*HEADER\r?\n/.test(text)) {
        const seedless = text.replace(/(\n\s*9\r?\n\$HANDSEED\r?\n\s*5\r?\n)[^\r\n]*/, "$1");

        return visretain
          ? seedless.replace(/(\$VISRETAIN\r?\n\s*70\r?\n)[^\r\n]*/, "$1")
          : seedless;
      }
    }

    return "";
  },
  records(bytes) {
    // A record keyed by its handle, or by its place among the records with none.
    const out = new Map<string, Uint8Array>();
    const reader = new DxfDocumentReader();
    reader.push(bytes);
    const document = reader.end();
    const keys = keysOf(document, bytes);

    for (let i = 0; i < document.count; i++) {
      const start = document.starts[i]!;
      out.set(keys[i]!, bytes.subarray(start, start + document.length(i)));
    }

    return out;
  },
  links(bytes) {
    const out = new Map<string, RecordLinks>();
    const reader = new DxfDocumentReader();
    reader.push(bytes);
    const document = reader.end();
    const keys = keysOf(document, bytes);

    const names = dictionaryNames(bytes, document);

    for (let i = 0; i < document.count; i++) {
      const owner = document.owner(i);
      const entries = names.get(i);
      out.set(keys[i]!, {
        ...(owner !== undefined && { owner }),
        references: document.references(i).map((r) => r.handle),
        kind: document.names[document.kinds[i]!] ?? "",
        ...(entries !== undefined && { entries }),
      });
    }

    return out;
  },
};

/** Each dictionary's entries, each name's handle, by the record's place. */
function dictionaryNames(
  bytes: Uint8Array,
  document: DxfDocument,
): Map<number, Record<string, string>> {
  const out = new Map<number, Record<string, string>>();
  const kind = document.names.indexOf("DICTIONARY");

  if (kind < 0) return out;
  const latin1 = new TextDecoder("latin1");

  for (let i = 0; i < document.count; i++) {
    if (document.kinds[i] !== kind) continue;
    const start = document.starts[i]!;
    const lines = latin1.decode(bytes.subarray(start, start + document.length(i))).split(/\r?\n/);
    const entries: Record<string, string> = {};

    for (let k = 0; k + 3 < lines.length; k += 2)
      if (lines[k]!.trim() === "3" && ["350", "360"].includes(lines[k + 2]!.trim()))
        entries[lines[k + 1]!] = lines[k + 3]!.trim();
    out.set(i, entries);
  }

  return out;
}

/** True when two records' bytes differ only in the header variable `$VISRETAIN`'s value. */
function sameButVisretain(a: Uint8Array, b: Uint8Array): boolean {
  const latin1 = new TextDecoder("latin1");

  const without = (bytes: Uint8Array): string =>
    latin1.decode(bytes).replace(/(\$VISRETAIN\r?\n\s*70\r?\n)[^\r\n]*/, "$1");

  return without(a) === without(b);
}

/** Each count of `after` above `before`'s, as `kind: before → after`. */
function moreOf(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): string[] {
  const out: string[] = [];

  for (const kind in after) {
    const was = before[kind] ?? 0;

    if (after[kind]! > was) out.push(`${kind}: ${was} → ${after[kind]}`);
  }

  return out;
}

/** A read as the file's content, as `content` gives it. */
type ReadContent = Omit<DrawingRead, "sha256" | "bytes">;

/** A read as the checks hold a copy's to its source's, as `content` below gives it. */
type CopyContent = Omit<ReadContent, "otherFields">;

/** The first place two reads, or their JSON, differ, as a path, or undefined when they agree. */
export function firstDifference(
  a: ReadContent | Json,
  b: ReadContent | Json,
  at = "read",
): string | undefined {
  const stack: [unknown, unknown, string][] = [[a, b, at]];

  while (stack.length > 0) {
    const [x, y, path] = stack.pop()!;

    if (Object.is(x, y)) continue;

    if (!isKeyed(x) || !isKeyed(y)) return `${path}: ${String(x)} and ${String(y)}`;

    if (Array.isArray(x) !== Array.isArray(y)) return `${path}: a list and not a list`;
    // The keys alone first: a value is read only once both hold its key.
    const xs = Object.keys(x);
    const ys = Object.keys(y);

    if (xs.length !== ys.length) return `${path}: ${xs.length} and ${ys.length} items`;

    for (let i = xs.length - 1; i >= 0; i--) {
      const key = xs[i]!;

      if (!Object.hasOwn(y, key)) return `${path}.${key}: held by one alone`;
      stack.push([x[key], y[key], `${path}.${key}`]);
    }
  }

  return undefined;
}

/** True when two numbers agree to about nine digits, as two writers' arithmetic may. */
const close = (x: number, y: number): boolean =>
  Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));

/** The first place two reads differ past `close`, as a path, or undefined when they agree. */
/** The read's angles in degrees, which two reads may hold a whole turn apart. */
const ANGLES: ReadonlySet<string> = new Set([
  "angle",
  "rotation",
  "patternAngle",
  "startAngle",
  "endAngle",
  "textRotation",
  "twist",
]);

/** Two angles in degrees the same within `close`, less whole turns. */
const sameAngle = (x: number, y: number): boolean => {
  const d = (((x - y) % 360) + 360) % 360;

  return Math.min(d, 360 - d) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
};

export function firstDifferenceNear(
  a: CopyContent,
  b: CopyContent,
  at = "read",
): string | undefined {
  const stack: [unknown, unknown, string][] = [[a, b, at]];

  while (stack.length > 0) {
    const [x, y, path] = stack.pop()!;

    if (Object.is(x, y)) continue;

    if (isNumber(x) && isNumber(y)) {
      if (close(x, y)) continue;

      if (ANGLES.has(path.slice(path.lastIndexOf(".") + 1)) && sameAngle(x, y)) continue;

      return `${path}: ${x} and ${y}`;
    }

    if (!isKeyed(x) || !isKeyed(y)) return `${path}: ${String(x)} and ${String(y)}`;

    if (Array.isArray(x) !== Array.isArray(y)) return `${path}: a list and not a list`;
    const xs = Object.keys(x);
    const ys = Object.keys(y);

    if (xs.length !== ys.length) return `${path}: ${xs.length} and ${ys.length} items`;

    for (let i = xs.length - 1; i >= 0; i--) {
      const key = xs[i]!;

      if (!Object.hasOwn(y, key)) return `${path}.${key}: held by one alone`;
      stack.push([x[key], y[key], `${path}.${key}`]);
    }
  }

  return undefined;
}

/**
 * A read as the file's content, without what names its bytes, and without what it counts but
 * does not list, which the read back holds to no more than the source's: what the source holds
 * twice or in no record, which a copy leaves out, and the objects and fields an erased entity
 * owns of a kind the reader does not read, which the read cannot name.
 */
const content = (read: DrawingRead): CopyContent => {
  const {
    sha256: _sha,
    bytes: _bytes,
    unread,
    otherFields: _fields,
    blocksAsked: _asked,
    ...rest
  } = read;

  // The seed and the handle of an edit's record depend on records the read does not list, such as
  // an application's; the structure check holds every handle below the seed.
  const { handseed: _seed, ...header } = rest.header;

  return {
    ...rest,
    header,
    edits: (rest.edits ?? []).map(({ handle: _h, ...e }) => e),
    unread: { ...unread, malformed: {}, objects: {} },
  };
};

/** The edited read held to the copy's limit, and the blocks it holds to a count alone. */
interface WithinLimit {
  readonly read: DrawingRead;
  readonly notCompared: readonly string[];
}

/**
 * The edited read as the copy's read gives it where that read stopped at its limit of items: a
 * block the copy's read counts past the limit, with none of its entities, holds none when it counts
 * as many as the edit gives it, and is named in `notCompared`. A file that reads only in part
 * spends the limit on the blocks the source holds, so a block an addition makes, a dimension's
 * picture, comes after it.
 */
function withinLimit(after: DrawingRead, back: DrawingRead): WithinLimit {
  const counted = new Map<string, number>();

  for (const b of back.blocks) {
    const past = b.other["past the limit"];

    if (past !== undefined && b.entities.length === 0 && isString(b.handle))
      counted.set(canonicalHandle(b.handle), past);
  }

  const notCompared: string[] = [];

  if (counted.size === 0) return { read: after, notCompared };

  const blocks = after.blocks.map((b) => {
    if (!isString(b.handle) || counted.get(canonicalHandle(b.handle)) !== b.entities.length)
      return b;
    notCompared.push(`${b.handle}, ${b.entities.length} entities`);

    return { ...b, entities: [], other: { ...b.other, "past the limit": b.entities.length } };
  });

  return { read: { ...after, blocks }, notCompared };
}

/**
 * What an edit may change in a file's records: the records it erases with what goes with them, by
 * ownership or as an erased dimension's or table's picture, and the records it moves.
 */
function allowed(read: DrawingRead, edit: Edit, links: ReadonlyMap<string, RecordLinks>) {
  const index = indexRead(read);
  const reach = editReach(edit, index);
  const gone = new Set(reach.erased.keys());

  for (const h of reach.erased.keys()) {
    const at = index.byHandle.get(h);

    const own = at?.kind === "entity" ? ownPicture(index, at.entity) : undefined;

    if (own !== undefined) gone.add(own);
  }

  const children = new Map<string, string[]>();

  for (const [key, l] of links) {
    if (l.owner === undefined) continue;
    const owner = canonicalHandle(l.owner);
    const list = children.get(owner);

    if (list) list.push(key);
    else children.set(owner, [key]);
  }

  const queue = [...gone];

  for (let q = 0; q < queue.length; q++)
    for (const child of children.get(queue[q]!) ?? [])
      if (!gone.has(child)) {
        gone.add(child);
        queue.push(child);
      }

  // A moved dimension's or table's picture moves whole, what the read leaves out of it among it.
  const pictures = new Set<string>();

  for (const h of reach.moved.keys()) {
    const at = index.byHandle.get(h);

    if (at?.kind === "entity" && at.entity.kind !== "insert" && "blockHandle" in at.entity) {
      const b = at.entity.blockHandle;

      if (isString(b)) pictures.add(canonicalHandle(b));
    }
  }

  // What a change reaches: its entity, the attributes it names and a viewport, and a layer's record.
  const changed = new Set<string>();
  let visretain = false;

  for (const k of reach.changed.keys()) {
    if (!k.startsWith("layer:")) {
      changed.add(k);
      continue;
    }
  }

  // A whole value takes out the fields of its text: its extension dictionary's `ACAD_FIELD`.
  const wholes = new Set<string>();

  for (const s of edit.statements) {
    if (s.kind === "layer") {
      const layer = layerNamed(read, s.name);

      if (layer?.handle !== undefined) changed.add(canonicalHandle(layer.handle));
      visretain ||= layer?.xref === true;
    }

    if (s.kind !== "change") continue;
    const h = canonicalHandle(s.handle);

    if (isString(s.changes.text)) wholes.add(h);
    const at = index.byHandle.get(h);

    for (const tag in s.changes.attributes ?? {})
      if (
        isString(s.changes.attributes![tag]) &&
        at?.kind === "entity" &&
        at.entity.kind === "insert"
      )
        for (const a of at.entity.attributes ?? [])
          if (a.handle !== undefined && a.tag.toUpperCase() === tag.toUpperCase())
            wholes.add(canonicalHandle(a.handle));
  }

  if (wholes.size > 0) {
    const fields: string[] = [];

    for (const l of links.values()) {
      const f = l.entries?.["ACAD_FIELD"];

      if (f !== undefined && l.owner !== undefined && wholes.has(canonicalHandle(l.owner)))
        fields.push(canonicalHandle(f));
    }

    for (let q = 0; q < fields.length; q++) {
      gone.add(fields[q]!);

      for (const child of children.get(fields[q]!) ?? []) if (!gone.has(child)) fields.push(child);
    }
  }

  return { gone, moved: new Set(reach.moved.keys()), pictures, changed, visretain };
}

/** Each count of `after` above `before`'s, as `kind: before → after`, past a key's place. */
const countsAbove = (
  what: string,
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): string[] => moreOf(before, after).map((p) => `${what} ${p}`);

/**
 * Runs the checks of every job on a file an edit wrote, against its source and the source's read
 * with geometry: the copy reads back, holds no new structure defect, keeps every record the edit
 * does not reach byte for byte and in its place, changes the records an erasure reaches only by
 * the references it takes out, and reads as `editedRead` says.
 */
export async function checkEditedCopy(
  editor: FileEditor,
  source: Uint8Array,
  read: DrawingRead,
  edit: Edit,
  written: Uint8Array,
): Promise<EditCheck[]> {
  const checks: EditCheck[] = [];

  const add = (
    check: EditCheckName,
    problems: string[],
    own?: number,
    notCompared?: readonly string[],
  ): void => {
    checks.push({
      check,
      passed: problems.length === 0,
      problems: problems.slice(0, MOST_PROBLEMS),
      ...(own !== undefined && { own }),
      ...(notCompared !== undefined && notCompared.length > 0 && { notCompared }),
    });
  };

  let back: DrawingRead | undefined;
  const edited = editedRead(read, edit);
  const apart = addedBlocks(read, edited);

  try {
    back = await editor.read(written, edit.only, apart.length > 0 ? apart : undefined);
    add(
      "read-back",
      moreOf(read.unread.malformed, back.unread.malformed).map((p) => `malformed ${p}`),
    );
  } catch (error) {
    add("read-back", [
      `the written file does not read: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }

  const before = editor.structure(source);
  const after = editor.structure(written);
  const added = newDefects(before, after).map((d) => `${d.rule}: ${d.detail}`);

  if (after.count > before.count && added.length === 0)
    added.push(`${after.count - before.count} defects more than the source's`);
  add("structure", added, before.count);

  const problems: string[] = [];
  const was = editor.records(source);
  const now = editor.records(written);
  const wasLinks = editor.links(source);
  const nowLinks = editor.links(written);
  // A later edit of the same name erases the earlier additions it replaces or drops, and writes
  // each it replaces again under its handle.
  const replaced = writesAdditions(read, edit) ? replacement(read, edit) : undefined;
  const may = allowed(read, replaced ? withReplacement(edit, replaced) : edit, wasLinks);
  const rewritten = new Set([...(replaced?.reuse.values() ?? [])].map(canonicalHandle));
  // The record of the edit's name, which a later edit writes again.
  const record = read.edits?.find((e) => e.name === edit.name)?.handle;

  if (replaced !== undefined && record !== undefined) rewritten.add(canonicalHandle(record));

  // A record a moved one owns moves with it, as a 2D polyline's vertices do, and so does each
  // record of a moved picture.
  const moves = (key: string): boolean => {
    if (may.moved.has(key) || may.changed.has(key)) return true;
    const owner = wasLinks.get(key)?.owner;

    if (owner === undefined) return false;
    const o = canonicalHandle(owner);

    return may.moved.has(o) || may.pictures.has(o) || may.changed.has(o);
  };

  const adds = writesAdditions(read, edit);
  const seed = read.header.handseed === undefined ? undefined : handleNumber(read.header.handseed);

  // A handle the additions gave: from the source's seed on.
  const fromSeed = (h: string): boolean => {
    const n = adds && seed !== undefined ? handleNumber(h) : undefined;

    return n !== undefined && seed !== undefined && n >= seed;
  };

  for (const [key, bytes] of was) {
    if (problems.length >= MOST_PROBLEMS) break;
    const copy = now.get(key);

    if (copy === undefined) {
      if (!may.gone.has(key))
        problems.push(`the record ${key} is gone, and the edit does not erase it`);
    } else if (may.gone.has(key)) {
      if (!rewritten.has(key)) problems.push(`the record ${key} is kept, and the edit erases it`);
    } else if (
      !sameBytes(bytes, copy) &&
      !moves(key) &&
      !(may.visretain && key.startsWith("#") && sameButVisretain(bytes, copy))
    ) {
      // A record an erasure reaches holds the source's references less what the erasure took,
      // and one the additions name holds them with what they added.
      // A record written again under its handle is named as it was.
      const again = (h: string): boolean => rewritten.has(canonicalHandle(h));
      const from = (wasLinks.get(key)?.references ?? []).filter((h) => !again(h));

      const to = (nowLinks.get(key)?.references ?? []).filter(
        (h) => !fromSeed(canonicalHandle(h)) && !again(h),
      );

      const gained = (nowLinks.get(key)?.references.length ?? 0) > to.length;
      const less = from.filter((h) => !may.gone.has(canonicalHandle(h)));
      const same = less.length === to.length && less.every((h, i) => h === to[i]);

      const counted =
        adds &&
        (ADDED_TO.has(key) || ADDED_TO.has(wasLinks.get(key)?.kind ?? "") || rewritten.has(key));

      if (!same || (less.length === from.length && !gained && !counted))
        problems.push(`the record ${key} changed, and the edit does not change it`);
    }
  }

  // The header but for its seed, and its `$VISRETAIN` where a change of an xref's layer sets it.
  if (
    adds &&
    editor.headerWithoutSeed !== undefined &&
    editor.headerWithoutSeed(source, may.visretain) !==
      editor.headerWithoutSeed(written, may.visretain)
  )
    problems.push("the header changed past its $HANDSEED, and the edit does not change it");

  for (const key of now.keys()) {
    if (problems.length >= MOST_PROBLEMS) break;

    if (!was.has(key) && !fromSeed(key) && !(adds && key.startsWith("CLASS:")))
      problems.push(
        adds
          ? `the record ${key} is new, and its handle is not one the additions give`
          : `the record ${key} is new, and the edit adds nothing`,
      );
  }

  // The records both hold come in the same order: a record keeps its place.
  const order = (from: ReadonlyMap<string, Uint8Array>, other: ReadonlyMap<string, Uint8Array>) => {
    const keys: string[] = [];

    for (const key of from.keys()) if (other.has(key)) keys.push(key);

    return keys;
  };

  // A record written again under its handle may be written last, as a DWG's are.
  const sourceOrder = order(was, now).filter((k) => !rewritten.has(k));
  const copyOrder = order(now, was).filter((k) => !rewritten.has(k));
  const moved = sourceOrder.findIndex((key, i) => copyOrder[i] !== key);

  if (moved >= 0 && problems.length < MOST_PROBLEMS)
    problems.push(`the record ${sourceOrder[moved]} is not in its place`);

  const notCompared: string[] = [];

  if (back !== undefined) {
    const limited = withinLimit(edited, back);
    notCompared.push(...limited.notCompared);
    const difference = firstDifferenceNear(content(limited.read), content(back));

    if (difference !== undefined)
      problems.push(`the written file reads otherwise than the edit says: ${difference}`);
    problems.push(...countsAbove("unread object", read.unread.objects, back.unread.objects));
    problems.push(...countsAbove("field", read.otherFields, back.otherFields));
  }

  add("before-after", problems, undefined, notCompared);
  add(
    "lint",
    lintEdit(edit, read)
      .filter((d) => d.severity === "error")
      .map((d) => d.message),
  );

  return checks;
}

/**
 * The handles of the blocks an edited read holds and its source's does not, the blocks an edit
 * adds, which a read of the copy keeps apart (`ReadOptions.blocks`): at most `MOST_OWN_BLOCKS`.
 */
export function addedBlocks(read: DrawingRead, edited: DrawingRead): string[] {
  if (edited === read) return [];
  const had = new Set<string>();

  for (const b of read.blocks) if (isString(b.handle)) had.add(canonicalHandle(b.handle));
  const out: string[] = [];

  for (const b of edited.blocks) {
    if (out.length >= MOST_OWN_BLOCKS) break;

    if (isString(b.handle) && !had.has(canonicalHandle(b.handle)))
      out.push(canonicalHandle(b.handle));
  }

  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;

  return true;
}
