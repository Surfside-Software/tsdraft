// `editedRead`: the read a file holds after an edit, as its readers would read the edited copy:
// what the edit erases left out of its space, its census and its lists, and what it moves moved.
// It is total and bounded: a statement it cannot make, which `lintEdit` refuses, changes nothing.
import type {
  DrawingRead,
  ReadBlock,
  ReadCensus,
  ReadEntity,
  ReadField,
  ReadInsert,
  ReadLayerCensus,
  ReadLayout,
  ReadSpace,
  ReadUnreadEntity,
  ReadViewport,
} from "../read/model.ts";
import { isString } from "../guards.ts";
import { checkEdit, canonicalHandle, type Edit } from "./model.ts";
import { handleProblem } from "./lint.ts";
import { movedEntity, movedViewport } from "./moved.ts";
import { editReach, indexRead, type ReadIndex } from "./reach.ts";
import { applied, type Applied } from "./transform.ts";

/** The kind a census counts an entity of the read under, as its file names it. */
export function fileKind(e: ReadEntity): string {
  switch (e.kind) {
    case "polyline":
      return e.heavy ? "POLYLINE" : "LWPOLYLINE";
    case "dimension":
    case "angular-dimension":
    case "ordinate-dimension":
      return "DIMENSION";
    case "radial-dimension":
      return e.type === "jogged-radius" ? "LARGE_RADIAL_DIMENSION" : "DIMENSION";
    case "arc-length-dimension":
      return "ARC_DIMENSION";
    case "underlay":
      return "PDFUNDERLAY";
    case "table":
      return "ACAD_TABLE";
    case "3dsolid":
      return "3DSOLID";
    default:
      return e.kind.toUpperCase();
  }
}

const key = (h: string | undefined): string | undefined =>
  h === undefined ? undefined : canonicalHandle(h);

/** What the edit does to each handle it reaches: left out, or moved by a transform. */
interface Plan {
  readonly erased: ReadonlySet<string>;
  readonly moved: ReadonlyMap<string, Applied>;
  readonly index: ReadIndex;
}

const takes = (plan: Plan, h: string | undefined): "erased" | Applied | undefined => {
  const k = key(h);

  if (k === undefined) return undefined;

  if (plan.erased.has(k)) return "erased";

  return plan.moved.get(k);
};

/** A layer's counts less one entity of it. */
function lessOne(row: ReadLayerCensus, e: ReadEntity): ReadLayerCensus {
  const kind = fileKind(e);
  const kinds = { ...row.kinds };

  if ((kinds[kind] ?? 0) > 1) kinds[kind]!--;
  else delete kinds[kind];
  const lineweights = { ...row.lineweights };
  const weight = e.lineweight;
  const ownWeight = weight !== undefined && weight !== -1;

  if (ownWeight) {
    const w = String(weight);

    if ((lineweights[w] ?? 0) > 1) lineweights[w]!--;
    else delete lineweights[w];
  }

  const ownColor = (e.color !== undefined && e.color !== 256) || e.trueColor !== undefined;
  const ownLinetype = e.linetype !== undefined && e.linetype.toUpperCase() !== "BYLAYER";

  return {
    kinds,
    ownColor: row.ownColor - (ownColor ? 1 : 0),
    ownLinetype: row.ownLinetype - (ownLinetype ? 1 : 0),
    ownLineweight: row.ownLineweight - (ownWeight ? 1 : 0),
    lineweights,
  };
}

/** A space's census with its erased entities left out and its moved ones moved. */
function census(c: ReadCensus, entities: readonly ReadEntity[], plan: Plan): ReadCensus {
  let layers: Record<string, ReadLayerCensus> | undefined;
  const moved = new Map<string, ReadEntity>();

  for (const e of entities) {
    const what = takes(plan, e.handle);

    if (what === undefined) continue;

    if (what === "erased") {
      layers ??= { ...c.layers };
      const row = layers[e.layer];

      if (row === undefined) continue;
      const less = lessOne(row, e);

      if (Object.keys(less.kinds).length === 0) delete layers[e.layer];
      else layers[e.layer] = less;
    } else moved.set(key(e.handle)!, movedEntity(e, what));
  }

  if (layers === undefined && moved.size === 0) return c;
  const counts = { ...c.counts };

  const gone = (h: string | undefined, kind: keyof typeof counts): boolean => {
    if (takes(plan, h) !== "erased") return false;
    counts[kind]--;

    return true;
  };

  const texts = c.texts
    .filter((t) => !gone(t.handle, "texts"))
    .map((t) => {
      const m = moved.get(key(t.handle) ?? "");

      if (m === undefined) return t;

      if (m.kind === "text") return { ...t, at: m.stored, height: m.height };

      if (m.kind !== "mtext") return t;
      const s = plan.moved.get(key(t.handle)!)!;

      return {
        ...t,
        at: m.at,
        height: m.height,
        ...(t.inlineHeights !== undefined && {
          inlineHeights: t.inlineHeights.map((h) => s.size(h)),
        }),
      };
    });

  const dimensions = c.dimensions
    .filter((d) => !gone(d.handle, "dimensions"))
    .map((d) => {
      const m = moved.get(key(d.handle) ?? "");

      return m !== undefined && "textAt" in m ? { ...d, at: m.textAt } : d;
    });

  const inserts = c.inserts
    .filter((i) => !gone(i.handle, "inserts"))
    .map((i) => {
      const m = moved.get(key(i.handle) ?? "");

      return m?.kind === "insert" ? { ...i, at: m.at, scale: m.scale } : i;
    });

  return { ...c, layers: layers ?? c.layers, texts, dimensions, inserts, counts };
}

/** A census less the unread entities an edit erases, each counted under its kind on its layer. */
function unreadCensus(c: ReadCensus, gone: readonly ReadUnreadEntity[]): ReadCensus {
  if (gone.length === 0) return c;
  const layers = { ...c.layers };

  for (const u of gone) {
    const row = layers[u.layer];

    if (row === undefined) continue;
    const kinds = { ...row.kinds };

    if ((kinds[u.kind] ?? 0) > 1) kinds[u.kind]!--;
    else delete kinds[u.kind];

    if (Object.keys(kinds).length === 0) delete layers[u.layer];
    else layers[u.layer] = { ...row, kinds };
  }

  return { ...c, layers };
}

/**
 * A space's entities, its draw order and its unread list, after the edit. A layout is a space with
 * fields of its own, which the copy keeps, as `rest` holds them.
 */
function space(s: ReadLayout, plan: Plan): ReadLayout;
function space(s: ReadSpace, plan: Plan): ReadSpace;
function space(s: ReadSpace, plan: Plan): ReadSpace {
  const entities = s.entities;

  if (entities === undefined) return s;
  const kept: ReadEntity[] = [];
  let changed = false;

  for (const e of entities) {
    const what = takes(plan, e.handle);

    if (what === "erased") changed = true;
    else if (what !== undefined) {
      kept.push(movedEntity(e, what));
      changed = true;
    } else kept.push(e);
  }

  let other = s.other;
  let unread = s.unread;
  const gone: ReadUnreadEntity[] = [];

  if (s.unread?.some((u) => takes(plan, u.handle) === "erased")) {
    const counts = { ...other };
    unread = s.unread.filter((u) => {
      if (takes(plan, u.handle) !== "erased") return true;
      gone.push(u);

      if ((counts[u.kind] ?? 0) > 1) counts[u.kind]!--;
      else delete counts[u.kind];

      return false;
    });
    other = counts;
    changed = true;
  }

  if (!changed) return s;
  const order = s.drawOrder?.filter((h) => takes(plan, h) !== "erased");
  const { unread: _, ...rest } = s;

  return {
    ...rest,
    census: unreadCensus(census(s.census, entities, plan), gone),
    entities: kept,
    ...(order !== undefined && { drawOrder: order }),
    ...(other !== undefined && { other }),
    ...(unread !== undefined && unread.length > 0 && { unread }),
  };
}

/** A layout after the edit: its paper's entities, its viewports and its inserts. */
function layout(l: ReadLayout, plan: Plan): ReadLayout {
  const edited = space(l, plan);
  let viewportsChanged = false;

  const viewports = l.viewports.map((v): ReadViewport => {
    const what = takes(plan, v.handle);

    if (what === undefined || what === "erased") return v;
    viewportsChanged = true;

    return movedViewport(v, what);
  });

  let insertsChanged = false;

  const inserts = l.inserts
    .filter((i) => {
      const gone = takes(plan, i.handle) === "erased";
      insertsChanged ||= gone;

      return !gone;
    })
    .map((i): ReadInsert => {
      const what = takes(plan, i.handle);

      if (what === undefined || what === "erased") return i;
      insertsChanged = true;

      // SAFETY: movedEntity gives back an entity of the kind it is given.
      return movedEntity(i, what) as ReadInsert;
    });

  if (edited === l && !viewportsChanged && !insertsChanged) return l;

  return {
    ...edited,
    viewports: viewportsChanged ? viewports : l.viewports,
    inserts: insertsChanged ? inserts : l.inserts,
  };
}

/** The blocks after the edit: an erased picture left out, and the entities it reaches. */
function blocks(
  list: readonly ReadBlock[],
  plan: Plan,
  gonePictures: ReadonlySet<string>,
): ReadBlock[] {
  const out: ReadBlock[] = [];

  for (const b of list) {
    const h = key(b.handle);

    if (h !== undefined && gonePictures.has(h)) continue;
    let changed = false;
    const entities: ReadEntity[] = [];

    for (const e of b.entities) {
      const what = takes(plan, e.handle);

      if (what === "erased") changed = true;
      else if (what !== undefined) {
        entities.push(movedEntity(e, what));
        changed = true;
      } else entities.push(e);
    }

    if (!changed) out.push(b);
    else {
      const order = b.drawOrder?.filter((x) => takes(plan, x) !== "erased");
      out.push({ ...b, entities, ...(order !== undefined && { drawOrder: order }) });
    }
  }

  return out;
}

/**
 * The read the file holds after the edit, as both readers would read the copy the writers make of
 * it: what it erases and what that takes with it left out, what it moves, turns and scales
 * moved, with the census, the draw order and each list that names them made to match. It needs
 * the read with geometry the edit was planned on. A statement that does not apply, which
 * `lintEdit` refuses, is left out: so is an edit that is not one.
 */
export function editedRead(read: DrawingRead, edit: Edit): DrawingRead {
  if (checkEdit(edit).length > 0 || edit.statements.length === 0) return read;
  const index = indexRead(read);
  const reach = editReach(edit, index);
  const erased = new Set<string>();
  const moved = new Map<string, Applied>();

  const transforms = edit.statements.map((s) =>
    s.kind === "move" ? applied(s.transform) : undefined,
  );

  // The handles a statement names that it reaches, with what they take: an error leaves one out.
  const named = new Set<string>();
  edit.statements.forEach((s, i) => {
    if (s.kind !== "erase" && s.kind !== "move") return;

    for (const k of new Set(s.handles.map(canonicalHandle))) {
      if (handleProblem(read, index, edit, i, k)?.severity !== "error") named.add(`${i}:${k}`);
    }
  });

  const applies = (h: string, i: number): boolean => {
    if (named.has(`${i}:${h}`)) return true;
    const at = index.byHandle.get(h);

    if (at?.kind === "attribute") return named.has(`${i}:${at.insert}`);

    if (at?.kind === "picture") return named.has(`${i}:${at.of}`);
    const viewport = index.clips.get(h);

    return viewport !== undefined && named.has(`${i}:${viewport}`);
  };

  const twice = new Set(reach.twice.map(([h]) => h));

  for (const [h, i] of reach.erased) if (!twice.has(h) && applies(h, i)) erased.add(h);

  for (const [h, i] of reach.moved)
    if (!twice.has(h) && applies(h, i)) moved.set(h, transforms[i]!);

  if (erased.size === 0 && moved.size === 0) return read;
  const plan: Plan = { erased, moved, index };

  // The picture of an erased dimension or table goes with it.
  const gonePictures = new Set<string>();

  for (const h of erased) {
    const at = index.byHandle.get(h);

    if (at?.kind === "entity" && at.entity.kind !== "insert" && "blockHandle" in at.entity) {
      const b = at.entity.blockHandle;

      if (isString(b)) gonePictures.add(canonicalHandle(b));
    }
  }

  // Each definition's count of what names it, less what the edit erases.
  const imageUses = new Map<string, number>();
  const underlayUses = new Map<string, number>();

  for (const h of erased) {
    const at = index.byHandle.get(h);

    if (at?.kind !== "entity") continue;
    const e = at.entity;

    const d =
      (e.kind === "image" || e.kind === "underlay") && e.definition !== undefined
        ? canonicalHandle(e.definition)
        : undefined;

    if (d === undefined) continue;
    const uses = e.kind === "image" ? imageUses : underlayUses;
    uses.set(d, (uses.get(d) ?? 0) + 1);
  }

  let unreadEntities = read.unread.entities;

  for (const h of erased) {
    const at = index.byHandle.get(h);

    if (at?.kind !== "unread") continue;
    const counts = { ...unreadEntities };
    const kind = at.unread.kind;

    if ((counts[kind] ?? 0) > 1) counts[kind]!--;
    else delete counts[kind];
    unreadEntities = counts;
  }

  const fields = read.fields
    .filter((f) => takes(plan, f.text.handle) !== "erased")
    .map((f): ReadField => {
      const what = takes(plan, f.text.handle);

      if (what === undefined || what === "erased") return f;

      return {
        ...f,
        text: {
          ...f.text,
          at: what.point(f.text.at),
          height: what.size(f.text.height),
          width: what.size(f.text.width),
        },
      };
    });

  return {
    ...read,
    model: space(read.model, plan),
    layouts: read.layouts.map((l) => layout(l, plan)),
    blocks: blocks(read.blocks, plan, gonePictures),
    images: read.images.map((d) => {
      const n = imageUses.get(key(d.handle) ?? "");

      return n === undefined ? d : { ...d, images: d.images - n };
    }),
    underlays: read.underlays.map((d) => {
      const n = underlayUses.get(key(d.handle) ?? "");

      return n === undefined ? d : { ...d, underlays: d.underlays - n };
    }),
    fields,
    unread: { ...read.unread, entities: unreadEntities },
  };
}
