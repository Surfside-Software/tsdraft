// A later edit of the same name: what it makes of the additions an earlier one wrote, by the record
// the file keeps of that edit and the mark of each entity. An addition whose id the record holds and
// whose entity is unchanged is written over it, in place and with its handle where the kind is the
// same; one the new edit drops is erased; and one a person changed or erased stops the edit until
// it erases that entity or gives its addition another id.
import type { Entity } from "../drawing.ts";
import type { DrawingRead, ReadEntity } from "../read/model.ts";
import { layerKey } from "../layers.ts";
import { idKey } from "../rules.ts";
import { markUnchanged } from "./marks.ts";
import { addsNothing, canonicalHandle, type Edit } from "./model.ts";

/** A problem of a later edit with an earlier one's additions, as `lintEdit` reports it. */
export interface ReplacementProblem {
  readonly rule: "edit-mark-changed" | "edit-mark-erased" | "edit-only";
  readonly id: string;
  readonly handle: string;
  readonly message: string;
}

export interface Replacement {
  /**
   * Each id, as `idKey` folds it, whose new addition takes the handle of the unchanged entity it
   * replaces.
   */
  readonly reuse: ReadonlyMap<string, string>;
  /** The handles of the earlier additions the edit takes out: replaced by another kind, or dropped. */
  readonly erase: readonly string[];
  /** Where each replaced entity was: its space, `""` for model space, and its place there. */
  readonly places: ReadonlyMap<string, { readonly space: string; readonly index: number }>;
  readonly problems: readonly ReplacementProblem[];
  /** The ids whose kind changed, which take a new handle. */
  readonly kindChanged: readonly string[];
}

const NONE: Replacement = {
  reuse: new Map(),
  erase: [],
  places: new Map(),
  problems: [],
  kindChanged: [],
};

/** The kind the read gives an entity the builder draws. */
export function readKind(e: Entity): string {
  switch (e.kind) {
    case "paragraph":
      return "mtext";
    case "leader":
      return "multileader";
    case "linear-dimension":
    case "aligned-dimension":
      return "dimension";
    case "radius-dimension":
    case "diameter-dimension":
    case "jogged-radius-dimension":
      return "radial-dimension";
    default:
      return e.kind;
  }
}

/**
 * The id of an addition that names none, by its place: `@model/<n>`, or `@layout/<name>/<n>` on a
 * layout, which no definition's id, `@layers/<name>` or `@blocks/<name>`, can be, as a name of the
 * file holds no `/`.
 */
export function placeId(layout: string | undefined, index: number): string {
  return layout === undefined ? `@model/${index}` : `@layout/${layout}/${index}`;
}

const PLACE = /^@(?:model|layout\/[^/]+)\/\d+$/;

/** The ids of an edit's additions, as the marks name them: an entity's id or its place. */
export function additionIds(
  edit: Edit,
): Map<string, { readonly entity: Entity; readonly space: string }> {
  const out = new Map<string, { readonly entity: Entity; readonly space: string }>();
  const a = edit.additions;

  if (a === undefined) return out;

  const put = (list: readonly Entity[], space: string): void =>
    list.forEach((e, i) =>
      out.set(e.id ?? placeId(space === "" ? undefined : space, i), { entity: e, space }),
    );

  put(a.model, "");

  for (const name in a.layouts) put(a.layouts[name] ?? [], name);

  return out;
}

/**
 * Whether an edit writes additions: it adds some, or the file holds an earlier edit's of its name,
 * which it replaces, with none when it adds none.
 */
export function writesAdditions(read: DrawingRead, edit: Edit): boolean {
  return (
    !addsNothing(edit) ||
    (read.edits ?? []).some((r) => r.name === edit.name && r.additions.length > 0)
  );
}

/** What a later edit of an earlier one's name makes of its additions. */
export function replacement(read: DrawingRead, edit: Edit): Replacement {
  const record = read.edits?.find((r) => r.name === edit.name);

  if (record === undefined || record.additions.length === 0) return NONE;
  const entities = new Map<string, { e: ReadEntity; space: string; index: number }>();

  const add = (list: readonly ReadEntity[] | undefined, space: string): void =>
    list?.forEach((e, index) => {
      if (e.handle !== undefined) entities.set(canonicalHandle(e.handle), { e, space, index });
    });

  add(read.model.entities, "");

  for (const l of read.layouts) add(l.entities, l.name);
  // Ids as the additions compare them, without regard to case.
  const ids = new Map([...additionIds(edit)].map(([id, a]) => [idKey(id), a]));

  const erasedByStatement = new Set(
    edit.statements.flatMap((s) => (s.kind === "erase" ? s.handles.map(canonicalHandle) : [])),
  );

  const reuse = new Map<string, string>();
  const erase: string[] = [];
  const places = new Map<string, { space: string; index: number }>();
  const problems: ReplacementProblem[] = [];
  const kindChanged: string[] = [];

  const seen = new Set<string>();

  for (const { id, handle: given } of record.additions) {
    // A definition the edit added is the file's now, and an addition uses it as the file's.
    if (id.startsWith("@") && !PLACE.test(id)) continue;
    const handle = canonicalHandle(given);
    const found = entities.get(handle);
    const next = ids.get(idKey(id));

    // The entity is still this addition's: unchanged, and marked with the edit's name and the id.
    const unchanged =
      found !== undefined &&
      markUnchanged(found.e) &&
      found.e.mark?.name === edit.name &&
      idKey(found.e.mark.id) === idKey(id);

    // A record that lists one handle twice gives it to the first id alone.
    if (erasedByStatement.has(handle) || seen.has(handle)) continue;
    seen.add(handle);

    // A read with `only` may leave it out: what it is, the edit cannot tell.
    if (found === undefined && read.only !== undefined) {
      problems.push({
        rule: "edit-only",
        id,
        handle,
        message: `The addition ${id} of the edit ${edit.name}, ${handle}, is not in what the edit's read keeps: read the part of the file that holds it`,
      });
      continue;
    }

    if (found === undefined) {
      if (next !== undefined)
        problems.push({
          rule: "edit-mark-erased",
          id,
          handle,
          message: `The addition ${id} of the edit ${edit.name} was ${handle}, which a person erased. Give the addition another id`,
        });
      continue;
    }

    if (!unchanged) {
      if (next !== undefined)
        problems.push({
          rule: "edit-mark-changed",
          id,
          handle,
          message: `The addition ${id} of the edit ${edit.name} is ${handle}, which a person changed. Erase ${handle} in this edit, or give the addition another id`,
        });
      continue;
    }

    if (next === undefined) erase.push(handle);
    // An addition takes the handle it replaces in the same space, and of the same kind.
    else if (
      readKind(next.entity) === found.e.kind &&
      layerKey(next.space) === layerKey(found.space)
    ) {
      reuse.set(idKey(id), handle);
      places.set(handle, { space: found.space, index: found.index });
    } else {
      erase.push(handle);
      kindChanged.push(id);
    }
  }

  return { reuse, erase, places, problems, kindChanged };
}

/**
 * The edit as its writers make it: its statements, and an erasure of each earlier addition it
 * replaces or drops, which takes with it what that one owns.
 */
export function withReplacement(edit: Edit, r: Replacement): Edit {
  const handles = [...r.erase, ...r.reuse.values()];

  if (handles.length === 0) return edit;

  return { ...edit, statements: [...edit.statements, { kind: "erase", handles }] };
}
