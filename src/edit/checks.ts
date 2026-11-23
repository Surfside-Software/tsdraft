// The checks of every job, which an edited file passes before a write leaves it: read back,
// structure, before and after, lint and the changed sheets. Each compares with the source as it
// was, so a defect the firm's file already had is told from a new one.
import type { DrawingRead } from "../read/model.ts";
import { DxfDocumentReader } from "../read/document.ts";
import { readDXFDocument } from "../read/dxf.ts";
import { editDXF } from "./dxf.ts";
import type { Edit } from "./model.ts";
import { dxfStructure, newDefects, type StructureReport } from "./structure.ts";

/**
 * What a format's editor gives the checks: its read with geometry, its edit, its structure check,
 * and its records by key, a handle or a place, so a copy's records are held to the source's.
 */
export interface FileEditor {
  read(bytes: Uint8Array): Promise<DrawingRead>;
  edit(bytes: Uint8Array, edit: Edit, read: DrawingRead): Uint8Array;
  structure(bytes: Uint8Array): StructureReport;
  records(bytes: Uint8Array): ReadonlyMap<string, Uint8Array>;
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
}

/** The most problems one check lists. */
const MOST_PROBLEMS = 50;

/** The editor of the 2018 format's DXF, in the core. */
export const dxfEditor: FileEditor = {
  read: async (bytes) => (await readDXFDocument(bytes, { geometry: true })).read,
  edit: editDXF,
  structure: dxfStructure,
  records(bytes) {
    // A record keyed by its handle, or by its place among the records with none.
    const out = new Map<string, Uint8Array>();
    const reader = new DxfDocumentReader();
    reader.push(bytes);
    const document = reader.end();
    let unhandled = 0;
    for (let i = 0; i < document.count; i++) {
      const start = document.starts[i]!;
      const handle = document.handle(i);
      const key = handle === undefined ? `#${unhandled++}` : handle;
      out.set(
        out.has(key) ? `${key}#${i}` : key,
        bytes.subarray(start, start + document.length(i)),
      );
    }
    return out;
  },
};

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

/** The first place two reads differ, as a path, or undefined when they agree. */
export function firstDifference(a: unknown, b: unknown, at = "read"): string | undefined {
  const stack: [unknown, unknown, string][] = [[a, b, at]];
  while (stack.length > 0) {
    const [x, y, path] = stack.pop()!;
    if (Object.is(x, y)) continue;
    if (typeof x !== "object" || typeof y !== "object" || x === null || y === null)
      return `${path}: ${String(x)} and ${String(y)}`;
    if (Array.isArray(x) !== Array.isArray(y)) return `${path}: a list and not a list`;
    const xs = Object.keys(x);
    const ys = Object.keys(y);
    if (xs.length !== ys.length) return `${path}: ${xs.length} and ${ys.length} items`;
    for (let i = xs.length - 1; i >= 0; i--) {
      const key = xs[i]!;
      if (!Object.hasOwn(y, key)) return `${path}.${key}: held by one alone`;
      stack.push([
        (x as Record<string, unknown>)[key],
        (y as Record<string, unknown>)[key],
        `${path}.${key}`,
      ]);
    }
  }
  return undefined;
}

/**
 * A read as the file's content, without what names its bytes, and without what it could not
 * read, which the read back holds to no more than the source's: a copy leaves out what the
 * source holds twice or in no record, which it counts as malformed.
 */
const content = (read: DrawingRead): object => {
  const { sha256: _sha, bytes: _bytes, unread, ...rest } = read;
  return { ...rest, unread: { ...unread, malformed: {} } };
};

/**
 * Runs the checks of every job on a file an edit wrote, against its source and the source's read
 * with geometry. The edit states no statement yet, so its read after the edit is the source's.
 */
export async function checkEditedCopy(
  editor: FileEditor,
  source: Uint8Array,
  read: DrawingRead,
  edit: Edit,
  written: Uint8Array,
): Promise<EditCheck[]> {
  const checks: EditCheck[] = [];
  const add = (check: EditCheckName, problems: string[], own?: number): void => {
    checks.push({
      check,
      passed: problems.length === 0,
      problems: problems.slice(0, MOST_PROBLEMS),
      ...(own !== undefined && { own }),
    });
  };

  let back: DrawingRead | undefined;
  try {
    back = await editor.read(written);
    add(
      "read-back",
      moreOf(read.unread.malformed, back.unread.malformed).map((p) => `malformed ${p}`),
    );
  } catch (error) {
    add("read-back", [`the written file does not read: ${(error as Error).message}`]);
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
  for (const [key, bytes] of was) {
    const copy = now.get(key);
    if (copy === undefined)
      problems.push(`the record ${key} is gone, and the edit does not erase it`);
    else if (!sameBytes(bytes, copy))
      problems.push(`the record ${key} changed, and the edit does not change it`);
    if (problems.length >= MOST_PROBLEMS) break;
  }
  for (const key of now.keys()) {
    if (problems.length >= MOST_PROBLEMS) break;
    if (!was.has(key)) problems.push(`the record ${key} is new, and the edit adds nothing`);
  }
  // The records both hold come in the same order: a record keeps its place.
  const order = (from: ReadonlyMap<string, Uint8Array>, other: ReadonlyMap<string, Uint8Array>) => {
    const keys: string[] = [];
    for (const key of from.keys()) if (other.has(key)) keys.push(key);
    return keys;
  };
  const sourceOrder = order(was, now);
  const copyOrder = order(now, was);
  const moved = sourceOrder.findIndex((key, i) => copyOrder[i] !== key);
  if (moved >= 0 && problems.length < MOST_PROBLEMS)
    problems.push(
      `the record ${sourceOrder[moved]} is not in its place, and the edit moves nothing`,
    );
  if (back !== undefined && edit.statements.length === 0) {
    const difference = firstDifference(content(read), content(back));
    if (difference !== undefined) problems.push(`the written file reads otherwise: ${difference}`);
  }
  add("before-after", problems);
  add("lint", []);
  add("sheets", []);
  return checks;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
