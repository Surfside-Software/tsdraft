// What an edit changes, as its preview shows it: a picture from the fragments of the file's picture
// kept from before the edit, with what the edit does not reach faint, what it erases dashed where
// it was, and what it moves dashed where it was and at full strength where it goes; and where each
// statement is, in model space and on each sheet, from the boxes of what a sheet shows.
import { mapPoint, type Matrix } from "../blocks.ts";
import type { Point } from "../drawing.ts";
import type { Box } from "../inspect.ts";
import { isString } from "../guards.ts";
import {
  joinPicture,
  type PictureFragment,
  type PicturePiece,
  type PictureRun,
} from "../picture-marks.ts";
import { runKey, runsOf, type PictureInPieces } from "../read/kept.ts";
import type { DrawingRead, ReadCensus, ReadEntity, ReadViewport } from "../read/model.ts";
import { sheetShows, spaceShows, viewportToPaper } from "../read/questions.ts";
import { editedRead } from "./edited.ts";
import { canonicalHandle, type Edit, type EditStatement } from "./model.ts";
import { editReach, indexRead } from "./reach.ts";
import { transformOf } from "./stretch.ts";

/** What an edit changes in a picture, for `changesPicture`. */
export interface PictureChanges {
  /**
   * The xref the edit is in, by the name its insert names, as `PictureChange.xref`. Without it the
   * edit is in the picture's own file.
   */
  readonly xref?: string;
  /** The handles, as the read gives them, of the entities it erases. */
  readonly erased?: ReadonlySet<string>;
  /** The handles, as the read gives them, of the entities it moves. */
  readonly moved?: ReadonlySet<string>;
  /** The picture of the moved entities where they go, as `PictureChange.drawn` holds it. */
  readonly drawn?: PictureInPieces;
  /**
   * The read of the file the edit is in, whose boxes size the dashes: each a twelfth of its
   * entity's larger side, in its space's units. Without it nothing is dashed.
   */
  readonly read?: DrawingRead;
}

/** What the edit does not reach is drawn in this. */
const FAINT_GROUP = '<g opacity="0.3">';

/**
 * The colors of what is erased and of where what moves was, which win over each element's own.
 * A text is filled in them, and anything else outlined.
 */
const STYLE =
  "\n  <style>.tsdraft-erased *,.tsdraft-moved-from *{fill:none}" +
  ".tsdraft-erased *{stroke:#e5484d}.tsdraft-erased text{fill:#e5484d;stroke:none}" +
  ".tsdraft-moved-from *{stroke:#f5a524}.tsdraft-moved-from text{fill:#f5a524;stroke:none}</style>";

const round = (n: number): number => Number(n.toPrecision(6));

/**
 * The picture of what an edit changes, from the fragments of the picture kept from before it, as
 * `readPicture` gives them, with the same options: each entity the edit does not reach drawn
 * faint, each it erases dashed where it was, each it moves dashed where it was and at full
 * strength where `drawn` draws it, over the rest of its space. Its cost is in proportion to the
 * fragments of the picture and of `drawn`.
 */
export function changesPicture(kept: PictureInPieces, change: PictureChanges): string {
  const erased = change.erased ?? new Set<string>();
  const moved = change.moved ?? new Set<string>();
  const sizes = change.read ? sizesOf(change.read) : undefined;

  const dashes = (handle: string | undefined): string => {
    const size = handle === undefined ? undefined : sizes?.get(canonicalHandle(handle));

    return size === undefined || !(size > 0)
      ? ""
      : ` stroke-dasharray="${round(size / 12)} ${round(size / 24)}"`;
  };

  /** The group a fragment is drawn in: as erased, as where a moved one was, or faint. */
  const markOf = (f: PictureFragment): string => {
    const h = f.handle;

    if (h !== undefined && erased.has(h))
      return `<g class="tsdraft-erased"${dashes(h)} data-change="erased">`;

    if (h !== undefined && moved.has(h))
      return `<g class="tsdraft-moved-from"${dashes(h)} data-change="moved-from">`;

    return FAINT_GROUP;
  };

  const wrap = (f: PictureFragment, start: string): PictureFragment => {
    if (f.run !== undefined) {
      const run = f.run;

      return {
        ...f,
        run: {
          ...run,
          open: start + run.open,
          close: `${run.close}</g>`,
          empty: `${start}${run.empty}</g>`,
        },
      };
    }

    return f.svg ? { ...f, svg: `${start}${f.svg}</g>` } : f;
  };

  const drawnRuns = change.drawn ? runsOf(change.drawn.pieces) : new Map<string, PictureRun>();

  /** A run with each fragment marked, and the moved drawn where they go after the rest. */
  const marked = (run: PictureRun, drawn: PictureRun | undefined): PictureRun => {
    const fragments = run.fragments.map((f) => wrap(f, markOf(f)));

    for (const f of drawn?.fragments ?? [])
      if (f.handle !== undefined && moved.has(f.handle))
        fragments.push(f.svg ? { ...f, svg: `<g data-change="moved">${f.svg}</g>` } : f);

    return { ...run, fragments };
  };

  const { xref } = change;
  const pieces: PicturePiece[] = [];

  for (const piece of kept.pieces) {
    if (isString(piece)) pieces.push(piece);
    else if (piece.kind === "defs") pieces.push(piece, STYLE);
    else if (xref === undefined) pieces.push(marked(piece, drawnRuns.get(runKey(piece))));
    else {
      const key = runKey(piece);

      const fragments = piece.fragments.map((f) =>
        f.run?.xref === xref
          ? {
              ...f,
              run: marked(f.run, drawnRuns.get(`${key}|${xref}|${f.handle ?? `#${f.index}`}`)),
            }
          : wrap(f, FAINT_GROUP),
      );

      pieces.push({ ...piece, fragments });
    }
  }

  const defs = change.drawn ? { ...kept.defs, ...change.drawn.defs } : kept.defs;

  return joinPicture(pieces, defs);
}

/** Where a statement is: in model space, and on each sheet that shows it. */
export interface EditPlace {
  /** The box of what it reaches in model space, before the edit and after it. */
  readonly model?: Box;
  /**
   * The box of what it reaches on each sheet, in paper units, by the layout's name: of the
   * layout's paper, and of model space as each viewport shows it, before the edit and after it.
   */
  readonly layouts: readonly { readonly layout: string; readonly box: Box }[];
}

/** The boxes of a read's entities at the top of each space, by handle, worked out once. */
interface Places {
  readonly model: ReadonlyMap<string, Box>;
  readonly layouts: readonly {
    readonly name: string;
    readonly viewports: readonly ReadViewport[];
    /** Its paper's entities, on the paper. */
    readonly paper: ReadonlyMap<string, Box>;
    /** Model space's, on the paper, through each viewport that shows them. */
    readonly shown: ReadonlyMap<string, ReadonlyMap<number, Box>>;
  }[];
}

const places = new WeakMap<DrawingRead, Places>();

const union = (a: Box | undefined, b: Box): Box =>
  a === undefined
    ? b
    : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

/** The box of a box's corners mapped. */
function mapped(map: (p: Point) => Point, [x0, y0, x1, y1]: Box): Box {
  let box: Box | undefined;

  for (const corner of [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ] satisfies Point[]) {
    const [x, y] = map(corner);
    box = union(box, [x, y, x, y]);
  }

  return box!;
}

/** The handle of the entity at the top of its space that a shown entity was reached from. */
const topOf = (e: { readonly handle?: string; readonly through: readonly string[] }) => {
  const h = e.through[0] ?? e.handle;

  return h === undefined ? undefined : canonicalHandle(h);
};

function placesOf(read: DrawingRead): Places {
  const held = places.get(read);

  if (held) return held;
  const model = new Map<string, Box>();

  for (const e of spaceShows(read)?.entities ?? []) {
    const h = topOf(e);

    if (h !== undefined && e.xrefs.length === 0) model.set(h, union(model.get(h), e.box));
  }

  const layouts: Places["layouts"][number][] = [];
  const names = new Set<string>();

  for (const layout of read.layouts) {
    if (layout.entities === undefined || names.has(layout.name)) continue;
    names.add(layout.name);
    const paper = new Map<string, Box>();
    const shown = new Map<string, Map<number, Box>>();

    for (const e of sheetShows(read, layout.name)?.entities ?? []) {
      const h = topOf(e);

      if (h === undefined || e.xrefs.length > 0) continue;

      if (e.viewport === undefined) paper.set(h, union(paper.get(h), e.box));
      else {
        let by = shown.get(h);

        if (!by) shown.set(h, (by = new Map()));
        by.set(e.viewport, union(by.get(e.viewport), e.box));
      }
    }

    layouts.push({ name: layout.name, viewports: layout.viewports, paper, shown });
  }

  const made = { model, layouts };
  places.set(read, made);

  return made;
}

/** The larger side of the box of each entity at the top of a space, in its space's units. */
const sizesKept = new WeakMap<DrawingRead, Map<string, number>>();

function sizesOf(read: DrawingRead): Map<string, number> {
  const held = sizesKept.get(read);

  if (held) return held;
  const p = placesOf(read);
  const sizes = new Map<string, number>();
  sizesKept.set(read, sizes);

  const add = (boxes: ReadonlyMap<string, Box>) => {
    for (const [h, [x0, y0, x1, y1]] of boxes)
      if (!sizes.has(h)) sizes.set(h, Math.max(x1 - x0, y1 - y0));
  };

  add(p.model);

  for (const layout of p.layouts) add(layout.paper);

  return sizes;
}

/**
 * Where a statement of an edit of the read's file is: the box of the entities it names, in model
 * space and on each sheet that shows them, with an insert's whole picture, and for a move where
 * they were and where they go, its turn and scale taken by the corners of the box. What draws
 * nothing, on a layer that is off, frozen or does not plot, has no box, and a statement of
 * another kind has none. The boxes of the read are worked out once, as `sheetShows` gives them.
 */
export function statementPlace(read: DrawingRead, statement: EditStatement): EditPlace {
  if (
    statement.kind !== "erase" &&
    statement.kind !== "move" &&
    statement.kind !== "stretch" &&
    statement.kind !== "vertices"
  )
    return { layouts: [] };
  const p = placesOf(read);

  // A stretch's box is where its entities were and where they would go moved whole.
  const t = transformOf(statement);

  const handles =
    statement.kind === "vertices"
      ? [canonicalHandle(statement.handle)]
      : statement.handles.map(canonicalHandle);

  const both = (box: Box): Box => (t === undefined ? box : union(box, mapped(t.point, box)));
  let model: Box | undefined;

  for (const h of handles) {
    const box = p.model.get(h);

    if (box) model = union(model, both(box));
  }

  if (statement.kind === "vertices" && model !== undefined)
    for (const [x, y] of statement.points) model = union(model, [x, y, x, y]);

  const layouts: { layout: string; box: Box }[] = [];

  for (const layout of p.layouts) {
    let box: Box | undefined;

    for (const h of handles) {
      const own = layout.paper.get(h);

      if (own) box = union(box, both(own));

      for (const [viewport, shown] of layout.shown.get(h) ?? []) {
        box = union(box, shown);
        const before = p.model.get(h);
        const v = layout.viewports[viewport];

        if (t === undefined || before === undefined || v === undefined) continue;
        const toPaper: Matrix = viewportToPaper(v);
        box = union(
          box,
          mapped((q) => mapPoint(toPaper, q), mapped(t.point, before)),
        );
      }
    }

    if (box) layouts.push({ layout: layout.name, box });
  }

  return { ...(model && { model }), layouts };
}

const NO_CENSUS: ReadCensus = {
  layers: {},
  texts: [],
  dimensions: [],
  inserts: [],
  counts: { texts: 0, dimensions: 0, inserts: 0 },
  capped: false,
};

/** What a preview draws of an edit, for `editedPicture` and `changesPicture`. */
export interface EditPreview {
  /** The read after the edit, as `editedRead` gives it. */
  readonly edited: DrawingRead;
  /** The handles, as the read gives them, of the entities at the top of a space it erases. */
  readonly erased: ReadonlySet<string>;
  /** The same of those it moves and changes, each drawn where it is after the edit. */
  readonly moved: ReadonlySet<string>;
  /**
   * The edited read with only the entities it moves at the top of each space: its picture, with
   * the options of the kept one, is the `drawn` of `editedPicture` and `changesPicture`.
   */
  readonly drawn: DrawingRead;
  /** The names of the blocks the inserts it moves place, which `drawn` needs the xrefs of. */
  readonly blocks: ReadonlySet<string>;
  /**
   * The layouts whose viewports it erases, moves or changes, whose pictures the kept fragments do not
   * hold: each is drawn again whole from `edited`.
   */
  readonly redrawn: ReadonlySet<string>;
  /**
   * True when it reaches an entity of a block's definition, which each insert of the block draws,
   * or a layer: every picture is drawn again whole from `edited`.
   */
  readonly whole: boolean;
}

/**
 * What a preview draws of an edit of the read's file: the read after it, what it erases and what
 * it moves at the top of each space, which `editedRead` made, and the read of what it moves. Its
 * cost is a pass over the spaces the edit reaches, on top of `editedRead`'s.
 */
export function editPreview(read: DrawingRead, edit: Edit): EditPreview {
  const edited = editedRead(read, edit);

  const none: EditPreview = {
    edited,
    erased: new Set(),
    moved: new Set(),
    drawn: edited,
    blocks: new Set(),
    redrawn: new Set(),
    whole: false,
  };

  if (edited === read) return none;
  const index = indexRead(read);
  const reach = editReach(edit, index);
  const redrawn = new Set<string>();
  let whole = false;
  // What it reaches at the top of each space, by the space, with the entity as it was.
  const reached = new Map<string, Map<string, ReadEntity>>();

  // A layer's change changes every picture that draws on the layer: each is drawn again whole.
  for (const h of reach.changed.keys()) if (h.startsWith("layer:")) whole = true;

  for (const h of [...reach.erased.keys(), ...reach.moved.keys(), ...reach.changed.keys()]) {
    const at = index.byHandle.get(h);

    if (at?.kind === "viewport") redrawn.add(at.layout);

    if (at?.kind !== "entity") continue;

    if (at.space.kind === "block") {
      whole = true;
      continue;
    }

    const space = at.space.kind === "model" ? "" : at.space.name;
    let by = reached.get(space);

    if (!by) reached.set(space, (by = new Map()));

    if (at.entity.handle !== undefined) by.set(at.entity.handle, at.entity);
  }

  const erased = new Set<string>();
  const moved = new Set<string>();
  const blocks = new Set<string>();

  /** The entities of an edited space it moves, and its erased and moved noted. */
  const movedIn = (space: string, entities: readonly ReadEntity[]): ReadEntity[] => {
    const by = reached.get(space);

    if (by === undefined) return [];
    const present = new Set<string>();
    const out: ReadEntity[] = [];

    for (const e of entities) {
      if (e.handle === undefined) continue;
      const before = by.get(e.handle);

      if (before === undefined) continue;
      present.add(e.handle);

      if (before === e) continue;
      moved.add(e.handle);

      if (e.kind === "insert") blocks.add(e.block);
      out.push(e);
    }

    for (const h of by.keys()) if (!present.has(h)) erased.add(h);

    return out;
  };

  // The picture reads no census, and a census in proportion to the file would cost its check.
  const drawn: DrawingRead = {
    ...edited,
    model:
      edited.model.entities === undefined
        ? edited.model
        : { ...edited.model, census: NO_CENSUS, entities: movedIn("", edited.model.entities) },
    layouts: edited.layouts.map((l) =>
      l.entities === undefined
        ? l
        : { ...l, census: NO_CENSUS, entities: movedIn(l.name, l.entities) },
    ),
  };

  return { edited, erased, moved, drawn, blocks, redrawn, whole };
}
