// Where each handle an edit can name is in a read, and what each statement reaches: its handles
// and what they take with them, an insert's attributes, a dimension's or a table's picture and a
// viewport's clip. `lintEdit`, `editedRead` and the preview read the same index.
import type {
  DrawingRead,
  ReadBlock,
  ReadEntity,
  ReadUnreadEntity,
  ReadViewport,
} from "../read/model.ts";
import { isString } from "../guards.ts";
import { canonicalHandle, type Edit, type EditStatement } from "./model.ts";

/** Where an entity is: model space, a layout's paper by its name, or a block by its name. */
export type EditSpace =
  | { readonly kind: "model" }
  | { readonly kind: "layout"; readonly name: string }
  | { readonly kind: "block"; readonly name: string };

/** A handle the read holds, and what it is. */
export type Located =
  | { readonly kind: "entity"; readonly space: EditSpace; readonly entity: ReadEntity }
  | { readonly kind: "attribute"; readonly space: EditSpace; readonly insert: string }
  | { readonly kind: "viewport"; readonly layout: string; readonly viewport: ReadViewport }
  | { readonly kind: "unread"; readonly space: EditSpace; readonly unread: ReadUnreadEntity }
  | { readonly kind: "picture"; readonly block: string; readonly of: string };

export interface ReadIndex {
  readonly byHandle: ReadonlyMap<string, Located>;
  /** Each block by its name as the file holds it. */
  readonly blocks: ReadonlyMap<string, ReadBlock>;
  /** Each block's record by its handle. */
  readonly blocksByHandle: ReadonlyMap<string, ReadBlock>;
  /** How many inserts of each block the read's spaces and blocks hold, by the block's name. */
  readonly inserts: ReadonlyMap<string, number>;
  /** The blocks another block's definition inserts, by name. */
  readonly insertsInBlocks: ReadonlySet<string>;
  /** Each viewport's clip entity, by the clip's handle, and the viewport's. */
  readonly clips: ReadonlyMap<string, string>;
}

const indexes = new WeakMap<DrawingRead, ReadIndex>();

const handleOf = (h: string | undefined): string | undefined =>
  h === undefined ? undefined : canonicalHandle(h);

/** The picture block of a dimension or a table, by the handle of its record. */
const pictureOf = (e: ReadEntity): string | undefined =>
  "blockHandle" in e && isString(e.blockHandle) && e.kind !== "insert" ? e.blockHandle : undefined;

/** The index of a read's handles, made once for each read. */
export function indexRead(read: DrawingRead): ReadIndex {
  const held = indexes.get(read);

  if (held) return held;
  const byHandle = new Map<string, Located>();
  const blocks = new Map<string, ReadBlock>();
  const blocksByHandle = new Map<string, ReadBlock>();
  const inserts = new Map<string, number>();
  const insertsInBlocks = new Set<string>();
  const clips = new Map<string, string>();

  const set = (h: string | undefined, at: Located): void => {
    const key = handleOf(h);

    if (key !== undefined && !byHandle.has(key)) byHandle.set(key, at);
  };

  const entities = (list: readonly ReadEntity[] | undefined, space: EditSpace): void => {
    for (const entity of list ?? []) {
      set(entity.handle, { kind: "entity", space, entity });

      if (entity.kind === "insert") {
        inserts.set(entity.block, (inserts.get(entity.block) ?? 0) + 1);

        if (space.kind === "block") insertsInBlocks.add(entity.block);
        const insert = handleOf(entity.handle);

        if (insert !== undefined)
          for (const a of entity.attributes ?? [])
            set(a.handle, { kind: "attribute", space, insert });
      }
    }
  };

  const unread = (list: readonly ReadUnreadEntity[] | undefined, space: EditSpace): void => {
    for (const u of list ?? []) set(u.handle, { kind: "unread", space, unread: u });
  };

  entities(read.model.entities, { kind: "model" });
  unread(read.model.unread, { kind: "model" });

  for (const layout of read.layouts) {
    const space: EditSpace = { kind: "layout", name: layout.name };
    entities(layout.entities, space);
    unread(layout.unread, space);

    for (const viewport of layout.viewports) {
      set(viewport.handle, { kind: "viewport", layout: layout.name, viewport });
      const h = handleOf(viewport.handle);

      if (h !== undefined && viewport.clipBy !== undefined)
        clips.set(canonicalHandle(viewport.clipBy), h);
    }
  }

  for (const block of read.blocks) {
    blocks.set(block.name, block);
    const h = handleOf(block.handle);

    if (h !== undefined) blocksByHandle.set(h, block);
  }

  // A picture's entities are its dimension's or its table's; any other block's are its own.
  const pictures = new Map<string, string>();

  for (const at of byHandle.values()) {
    if (at.kind !== "entity") continue;
    const picture = pictureOf(at.entity);
    const of = handleOf(at.entity.handle);

    if (picture !== undefined && of !== undefined) pictures.set(canonicalHandle(picture), of);
  }

  for (const block of read.blocks) {
    const h = handleOf(block.handle);
    const of = h === undefined ? undefined : pictures.get(h);

    if (of === undefined) entities(block.entities, { kind: "block", name: block.name });
    else
      for (const e of block.entities) {
        set(e.handle, { kind: "picture", block: block.name, of });

        // An arrowhead's block, which a dimension's picture inserts.
        if (e.kind === "insert") {
          inserts.set(e.block, (inserts.get(e.block) ?? 0) + 1);
          insertsInBlocks.add(e.block);
        }
      }
  }

  const index = { byHandle, blocks, blocksByHandle, inserts, insertsInBlocks, clips };
  indexes.set(read, index);

  return index;
}

/** The handles a statement names and what each takes with it, in the order it names them. */
export function reachOf(index: ReadIndex, statement: EditStatement): string[] {
  const out: string[] = [];
  const names = statement.kind === "erase" || statement.kind === "move" ? statement.handles : [];

  // A handle named twice is reached once, and what it takes with it once.
  for (const handle of new Set(names.map(canonicalHandle))) {
    out.push(handle);
    const at = index.byHandle.get(handle);

    if (at?.kind === "entity") {
      const e = at.entity;

      if (e.kind === "insert")
        for (const a of e.attributes ?? []) if (a.handle) out.push(canonicalHandle(a.handle));
      // A table's picture is in the table's own coordinates, and moves with it as it stands; a
      // dimension's is in the world's.
      const picture = statement.kind === "move" && e.kind === "table" ? undefined : pictureOf(e);

      const block =
        picture === undefined ? undefined : index.blocksByHandle.get(canonicalHandle(picture));

      for (const p of block?.entities ?? []) if (p.handle) out.push(canonicalHandle(p.handle));
    } else if (at?.kind === "viewport" && at.viewport.clipBy !== undefined) {
      out.push(canonicalHandle(at.viewport.clipBy));
    }
  }

  return out;
}

/** What an edit erases and what it moves, by handle, with each statement's place. */
export interface EditReach {
  /** Each erased handle, what an erasure takes with it among them, by its statement. */
  readonly erased: ReadonlyMap<string, number>;
  /** Each moved handle, what moves with it among them, by its statement. */
  readonly moved: ReadonlyMap<string, number>;
  /** Each handle two statements reach, with the two. */
  readonly twice: readonly (readonly [handle: string, first: number, second: number])[];
}

export function editReach(edit: Edit, index: ReadIndex): EditReach {
  const erased = new Map<string, number>();
  const moved = new Map<string, number>();
  const twice: [string, number, number][] = [];
  edit.statements.forEach((statement, i) => {
    const into = statement.kind === "erase" ? erased : moved;

    for (const h of new Set(reachOf(index, statement))) {
      const first = erased.get(h) ?? moved.get(h);

      if (first !== undefined) twice.push([h, first, i]);
      else into.set(h, i);
    }
  });

  return { erased, moved, twice };
}
