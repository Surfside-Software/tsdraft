// `editedRead`: the read a file holds after an edit, as its readers would read the edited copy:
// what the edit erases left out of its space, its census and its lists, and what it moves moved.
// It is total and bounded: a statement it cannot make, which `lintEdit` refuses, changes nothing.
import { CENSUS_LIMIT } from "../read/model.ts";
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
import { inlineHeights } from "../read/dxf.ts";
import { layerKey } from "../layers.ts";
import { changedEntity, changedLayer, changedViewport } from "./changed.ts";
import {
  checkEdit,
  canonicalHandle,
  EditError,
  type Edit,
  type EntityChanges,
  type LayerChanges,
  type ViewportChanges,
} from "./model.ts";
import { addedOf, readAdditionsFile, type Added, type AddedSpace } from "./added.ts";
import { withReplacement, writesAdditions } from "./replaced.ts";
import { handleProblem } from "./lint.ts";
import {
  entityChangeProblems,
  layerChangeProblems,
  viewportChangeProblems,
} from "./lint-change.ts";
import { movedEntity, movedViewport } from "./moved.ts";
import { editReach, indexRead, ownPicture, type ReadIndex } from "./reach.ts";
import { stretchPlan, transformOf } from "./stretch.ts";
import type { Applied } from "./transform.ts";

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

/** What the edit does to each handle it reaches: left out, moved by a transform, or changed. */
interface Plan {
  readonly erased: ReadonlySet<string>;
  readonly moved: ReadonlyMap<string, Applied>;
  /** Each entity given new points, as it is after the edit. */
  readonly repointed: ReadonlyMap<string, ReadEntity>;
  readonly changed: ReadonlyMap<string, EntityChanges>;
  readonly viewports: ReadonlyMap<string, ViewportChanges>;
  readonly read: DrawingRead;
  readonly index: ReadIndex;
}

/** An entity after the change the plan makes of it, or the entity as it is. */
function changedOf(plan: Plan, e: ReadEntity): ReadEntity {
  const c = plan.changed.get(key(e.handle) ?? "");

  if (c === undefined) return e;
  const made = changedEntity(e, c, plan.read);

  return "problem" in made ? e : made;
}

const takes = (plan: Plan, h: string | undefined): "erased" | Applied | undefined => {
  const k = key(h);

  if (k === undefined) return undefined;

  if (plan.erased.has(k)) return "erased";

  return plan.moved.get(k);
};

/** The entity as the edit leaves it, or undefined where the edit does not change it. */
function placedOf(plan: Plan, e: ReadEntity): ReadEntity | undefined {
  const k = key(e.handle);
  const repointed = k === undefined ? undefined : plan.repointed.get(k);

  if (repointed !== undefined) return repointed;
  const what = takes(plan, e.handle);

  return what === undefined || what === "erased" ? undefined : movedEntity(e, what);
}

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

/** A layer's counts with one more entity of it. */
function moreOne(row: ReadLayerCensus | undefined, e: ReadEntity): ReadLayerCensus {
  const kind = fileKind(e);
  const kinds = { ...row?.kinds, [kind]: (row?.kinds[kind] ?? 0) + 1 };
  const lineweights = { ...row?.lineweights };
  const weight = e.lineweight;
  const ownWeight = weight !== undefined && weight !== -1;

  if (ownWeight) lineweights[String(weight)] = (lineweights[String(weight)] ?? 0) + 1;
  const ownColor = (e.color !== undefined && e.color !== 256) || e.trueColor !== undefined;
  const ownLinetype = e.linetype !== undefined && e.linetype.toUpperCase() !== "BYLAYER";

  return {
    kinds,
    ownColor: (row?.ownColor ?? 0) + (ownColor ? 1 : 0),
    ownLinetype: (row?.ownLinetype ?? 0) + (ownLinetype ? 1 : 0),
    ownLineweight: (row?.ownLineweight ?? 0) + (ownWeight ? 1 : 0),
    lineweights,
  };
}

/** The count of a census each kind of entity counts in. */
const CENSUS_COUNTS = new Map<string, keyof ReadCensus["counts"]>([
  ["text", "texts"],
  ["mtext", "texts"],
  ["dimension", "dimensions"],
  ["radial-dimension", "dimensions"],
  ["angular-dimension", "dimensions"],
  ["ordinate-dimension", "dimensions"],
  ["arc-length-dimension", "dimensions"],
  ["insert", "inserts"],
]);

/** A space's census with its erased entities left out and its moved ones moved. */
function census(c: ReadCensus, entities: readonly ReadEntity[], plan: Plan): ReadCensus {
  let layers: Record<string, ReadLayerCensus> | undefined;
  const moved = new Map<string, ReadEntity>();
  const counts = { ...c.counts };

  for (const e of entities) {
    const what = takes(plan, e.handle);

    if (what === undefined) {
      const after = changedOf(plan, e);

      if (after === e) continue;
      // A changed entity's pen counts on the layer it is on after the change.
      layers ??= { ...c.layers };
      const row = layers[e.layer];

      if (row !== undefined) {
        const less = lessOne(row, e);

        if (Object.keys(less.kinds).length === 0) delete layers[e.layer];
        else layers[e.layer] = less;
      }

      layers[after.layer] = moreOne(layers[after.layer], after);
      moved.set(key(e.handle)!, after);
      continue;
    }

    if (what === "erased") {
      // Counted here, as a census's list may stop before the entity.
      const count = CENSUS_COUNTS.get(e.kind);

      if (count !== undefined) counts[count]--;
      layers ??= { ...c.layers };
      const row = layers[e.layer];

      if (row === undefined) continue;
      const less = lessOne(row, e);

      if (Object.keys(less.kinds).length === 0) delete layers[e.layer];
      else layers[e.layer] = less;
    } else moved.set(key(e.handle)!, movedEntity(e, what));
  }

  if (layers === undefined && moved.size === 0) return c;
  const gone = (h: string | undefined): boolean => takes(plan, h) === "erased";

  const texts = c.texts
    .filter((t) => !gone(t.handle))
    .map((t) => {
      const m = moved.get(key(t.handle) ?? "");

      if (m === undefined) return t;

      if (m.kind === "text") return { ...t, layer: m.layer, at: m.stored, height: m.height };

      if (m.kind !== "mtext") return t;
      const s = plan.moved.get(key(t.handle)!);

      if (s === undefined) {
        // A changed paragraph's heights of its own, worked out from its value again.
        const { inlineHeights: _, ...rest } = t;
        const heights = m.value.includes("\\H") ? inlineHeights(m.value, m.height) : [];

        return {
          ...rest,
          layer: m.layer,
          height: m.height,
          ...(heights.length > 0 && { inlineHeights: heights }),
        };
      }

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
    .filter((d) => !gone(d.handle))
    .map((d) => {
      const m = moved.get(key(d.handle) ?? "");

      if (m === undefined) return d;

      return "textAt" in m ? { ...d, layer: m.layer, at: m.textAt } : { ...d, layer: m.layer };
    });

  const inserts = c.inserts
    .filter((i) => !gone(i.handle))
    .map((i) => {
      const m = moved.get(key(i.handle) ?? "");

      return m?.kind === "insert" ? { ...i, layer: m.layer, at: m.at, scale: m.scale } : i;
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
    const now = takes(plan, e.handle) === "erased" ? undefined : placedOf(plan, e);

    if (takes(plan, e.handle) === "erased") changed = true;
    else if (now !== undefined) {
      kept.push(now);
      changed = true;
    } else {
      const after = changedOf(plan, e);
      kept.push(after);
      changed ||= after !== e;
    }
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
    const c = plan.viewports.get(key(v.handle) ?? "");

    if (c !== undefined) {
      viewportsChanged = true;

      return changedViewport(v, c, plan.read);
    }

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

      if (what === undefined) {
        const c = plan.changed.get(key(i.handle) ?? "");

        if (c === undefined) return i;
        const { attributes: _, ...pen } = c;
        const after = changedEntity(i, pen, plan.read);

        if ("problem" in after || after.kind !== "insert") return i;
        insertsChanged = true;

        return after;
      }

      if (what === "erased") return i;
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
      const now = takes(plan, e.handle) === "erased" ? undefined : placedOf(plan, e);

      if (takes(plan, e.handle) === "erased") changed = true;
      else if (now !== undefined) {
        entities.push(now);
        changed = true;
      } else {
        const after = changedOf(plan, e);
        entities.push(after);
        changed ||= after !== e;
      }
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
  if (checkEdit(edit).length > 0) return read;

  if (!writesAdditions(read, edit)) return statementsRead(read, edit);
  let added: Added;

  try {
    added = addedOf(read, edit, readAdditionsFile(read));
  } catch (error) {
    // An addition the writers refuse, which `lintEdit` reports, is left out.
    if (error instanceof EditError) return statementsRead(read, edit);
    throw error;
  }

  const stated = statementsRead(read, withReplacement(edit, added.replaced));

  return withAdditions(stated, edit, added, read);
}

/**
 * A list of what `was` holds, after an edit made `now` of it: each item `now` keeps where it was,
 * each of `placed` in the place of the one of its handle, and each other of `added` last.
 */
function inPlace<T>(
  was: readonly T[],
  now: readonly T[],
  added: readonly T[],
  handleOf: (item: T) => string | undefined,
  placed: ReadonlySet<string>,
): T[] {
  const key = (item: T): string | undefined => {
    const h = handleOf(item);

    return h === undefined ? undefined : canonicalHandle(h);
  };

  const kept = new Map<string, T>();
  const unkeyed: T[] = [];

  for (const item of now) {
    const k = key(item);

    if (k === undefined) unkeyed.push(item);
    else kept.set(k, item);
  }

  const replacing = new Map<string, T>();
  const last: T[] = [];

  for (const item of added) {
    const k = key(item);

    if (k !== undefined && placed.has(k)) replacing.set(k, item);
    else last.push(item);
  }

  if (replacing.size === 0) return [...now, ...last];
  const out: T[] = [];

  for (const item of was) {
    const k = key(item);

    if (k === undefined) continue;
    const put = replacing.get(k) ?? kept.get(k);

    if (put !== undefined) out.push(put);
    kept.delete(k);
  }

  // What the edit kept that the source did not hold where this walk sees it, in its order.
  return [...out, ...kept.values(), ...unkeyed, ...last];
}

/** The counts of a census and of another added to it, and the lists of both, the first first. */
function censusPlus(a: ReadCensus, b: ReadCensus): ReadCensus {
  const layers = new Map<string, ReadLayerCensus>(Object.entries(a.layers));

  for (const [name, row] of Object.entries(b.layers)) {
    const was = layers.get(name);

    if (was === undefined) {
      layers.set(name, row);
      continue;
    }

    const kinds = { ...was.kinds };

    for (const [k, n] of Object.entries(row.kinds)) kinds[k] = (kinds[k] ?? 0) + n;
    const lineweights = { ...was.lineweights };

    for (const [k, n] of Object.entries(row.lineweights))
      lineweights[k] = (lineweights[k] ?? 0) + n;
    layers.set(name, {
      kinds,
      ownColor: was.ownColor + row.ownColor,
      ownLinetype: was.ownLinetype + row.ownLinetype,
      ownLineweight: was.ownLineweight + row.ownLineweight,
      lineweights,
    });
  }

  const room = (list: readonly unknown[]): number => Math.max(0, CENSUS_LIMIT - list.length);

  return {
    layers: Object.fromEntries(layers),
    texts: [...a.texts, ...b.texts.slice(0, room(a.texts))],
    dimensions: [...a.dimensions, ...b.dimensions.slice(0, room(a.dimensions))],
    inserts: [...a.inserts, ...b.inserts.slice(0, room(a.inserts))],
    counts: {
      texts: a.counts.texts + b.counts.texts,
      dimensions: a.counts.dimensions + b.counts.dimensions,
      inserts: a.counts.inserts + b.counts.inserts,
    },
    capped:
      a.capped ||
      b.capped ||
      a.texts.length + b.texts.length > CENSUS_LIMIT ||
      a.dimensions.length + b.dimensions.length > CENSUS_LIMIT ||
      a.inserts.length + b.inserts.length > CENSUS_LIMIT,
  };
}

/**
 * A space with an edit's additions drawn last in it, but for each that replaces an earlier one,
 * which takes its place. `was` is the space as the source held it.
 */
function spacePlus<S extends ReadSpace>(
  s: S,
  was: S,
  added: AddedSpace | undefined,
  placed: ReadonlySet<string>,
): S {
  if (added === undefined) return s;
  const handles = added.entities.flatMap((e) => (e.handle === undefined ? [] : [e.handle]));
  const census = censusPlus(s.census, added.census);

  const byHandle = <T extends { readonly handle?: string | undefined }>(
    from: readonly T[],
    now: readonly T[],
    more: readonly T[],
  ): T[] => inPlace(from, now, more, (x) => x.handle, placed);

  // A census lists no more than its limit, as a reader of the edited file would.
  const listed = <T extends { readonly handle?: string | undefined }>(
    from: readonly T[],
    now: readonly T[],
    more: readonly T[],
  ): T[] => byHandle(from, now, more).slice(0, CENSUS_LIMIT);

  return {
    ...s,
    census: {
      ...census,
      texts: listed(was.census.texts, s.census.texts, added.census.texts),
      dimensions: listed(was.census.dimensions, s.census.dimensions, added.census.dimensions),
      inserts: listed(was.census.inserts, s.census.inserts, added.census.inserts),
    },
    ...(s.entities !== undefined && {
      entities: byHandle(was.entities ?? [], s.entities, added.entities),
    }),
    ...(s.drawOrder !== undefined && {
      drawOrder: inPlace(was.drawOrder ?? [], s.drawOrder, handles, (h) => h, placed),
    }),
  };
}

/** The read with an edit's additions: in their spaces, their definitions and the edit's record. */
function withAdditions(
  read: DrawingRead,
  edit: Edit,
  added: Added,
  source: DrawingRead,
): DrawingRead {
  const placed = new Set([...added.replaced.reuse.values()].map(canonicalHandle));

  const of = (layout: string | undefined): AddedSpace | undefined =>
    added.spaces.find(
      (s) =>
        (s.layout === undefined) === (layout === undefined) &&
        (layout === undefined || layerKey(s.layout!) === layerKey(layout)),
    );

  const record = { name: edit.name, additions: added.record };
  const kept = (read.edits ?? []).filter((e) => e.name !== edit.name);
  const old = read.edits?.find((e) => e.name === edit.name);

  return {
    ...read,
    header: { ...read.header, handseed: added.plan.handseed.toString(16).toUpperCase() },
    layers: [...read.layers, ...added.layers],
    linetypes: [...read.linetypes, ...added.linetypes],
    textStyles: [...read.textStyles, ...added.textStyles],
    dimensionStyles: [...read.dimensionStyles, ...added.dimensionStyles],
    ...((read.leaderStyles !== undefined || added.leaderStyles.length > 0) && {
      leaderStyles: [...(read.leaderStyles ?? []), ...added.leaderStyles],
    }),
    tableStyles: [...read.tableStyles, ...added.tableStyles],
    blocks: [...read.blocks, ...added.blocks],
    model: spacePlus(read.model, source.model, of(undefined), placed),
    layouts: read.layouts.map((l, i) => {
      const a = of(l.name);

      if (a === undefined) return l;
      const plus = spacePlus(l, source.layouts[i] ?? l, a, placed);

      const inserts = a.entities.flatMap((e) =>
        e.kind === "insert" ? [(({ attributes: _, ...rest }) => rest)(e)] : [],
      );

      return { ...plus, inserts: [...l.inserts, ...inserts] };
    }),
    edits: [...kept, old?.handle === undefined ? record : { ...record, handle: old.handle }],
  };
}

/** The read with the edit's statements made: what it erases left out and what it moves moved. */
function statementsRead(read: DrawingRead, edit: Edit): DrawingRead {
  if (edit.statements.length === 0) return read;
  const index = indexRead(read);
  const reach = editReach(edit, index);
  const erased = new Set<string>();
  const moved = new Map<string, Applied>();

  const transforms = edit.statements.map(transformOf);

  const points = stretchPlan(edit, index);
  const repointed = new Map<string, ReadEntity>();

  // The handles a statement names that it reaches, with what they take: an error leaves one out.
  // A stretch reaches what it moves whole; what it gives new points is repointed alone.
  const named = new Set<string>();
  edit.statements.forEach((s, i) => {
    if (s.kind !== "erase" && s.kind !== "move" && s.kind !== "stretch" && s.kind !== "vertices")
      return;

    for (const k of new Set(
      (s.kind === "vertices" ? [s.handle] : s.handles).map(canonicalHandle),
    )) {
      if (handleProblem(read, index, edit, i, k)?.severity === "error") continue;
      const repointedAt = points.repointed.get(k);

      if (repointedAt?.statement === i) repointed.set(k, repointedAt.entity);
      else if (s.kind !== "stretch" || points.moved.get(k) === i) named.add(`${i}:${k}`);
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
    if (!twice.has(h) && applies(h, i) && transforms[i] !== undefined) moved.set(h, transforms[i]!);

  for (const h of twice) repointed.delete(h);

  // The changes `lintEdit` finds nothing wrong with.
  const changed = new Map<string, EntityChanges>();
  const viewports = new Map<string, ViewportChanges>();
  const layers = new Map<string, LayerChanges>();
  edit.statements.forEach((s, i) => {
    if (s.kind === "layer") {
      const k = `layer:${layerKey(s.name)}`;

      if (!twice.has(k) && layerChangeProblems(read, s).length === 0)
        layers.set(layerKey(s.name), s.changes);

      return;
    }

    if (s.kind !== "change" && s.kind !== "viewport") return;
    const h = canonicalHandle(s.handle);

    if (twice.has(h)) return;

    if (s.kind === "viewport") {
      if (viewportChangeProblems(read, index, s, "").length === 0) viewports.set(h, s.changes);

      return;
    }

    if (handleProblem(read, index, edit, i, h)?.severity === "error") return;
    const at = index.byHandle.get(h);

    if (at?.kind !== "entity") return;

    if (entityChangeProblems(read, at.entity, s).every((p) => p.severity !== "error"))
      changed.set(h, s.changes);
  });

  if (
    erased.size === 0 &&
    moved.size === 0 &&
    repointed.size === 0 &&
    changed.size === 0 &&
    viewports.size === 0 &&
    layers.size === 0
  )
    return read;
  const plan: Plan = { erased, moved, repointed, changed, viewports, read, index };

  // The picture of an erased dimension or table goes with it.
  const gonePictures = new Set<string>();

  for (const h of erased) {
    const at = index.byHandle.get(h);

    const own = at?.kind === "entity" ? ownPicture(index, at.entity) : undefined;

    if (own !== undefined) gonePictures.add(own);
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

  // A field goes with its text, and with a whole value given to it.
  const fields = read.fields
    .filter((f) => takes(plan, f.text.handle) !== "erased")
    .filter((f) => !isString(changed.get(key(f.text.handle) ?? "")?.text))
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
    layers: read.layers.map((l) => {
      const c = layers.get(layerKey(l.name));

      return c === undefined ? l : changedLayer(l, c, read);
    }),
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
