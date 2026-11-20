import {
  attributeText,
  blocksByKey,
  compose,
  insertMatrix,
  isDefinition,
  lookupCost,
  type LayerRef,
  type Matrix,
  type Referenced,
} from "./blocks.ts";
import { imageCorners, imageDrawable, imageFrame } from "./images.ts";
import { dimensionPicture, pictureTexts, type Dimension } from "./dimensions.ts";
import type {
  AttributeDefinition,
  Block,
  DimensionStyle,
  Entity,
  Insert,
  Leader,
  LeaderStyle,
  Point,
  Polyline,
  Text,
  TextStyle,
} from "./drawing.ts";
import { layerKey, layerKeys } from "./layers.ts";
import { hasArcsOrWidths, mayCurve, polylineBox, PolylineMemo } from "./polylines.ts";
import { leaderPicture, leaderRepeats } from "./leaders.ts";
import { inStyle, measurer } from "./measure.ts";
import {
  layoutDimensionText,
  measured,
  paragraphInStyle,
  paragraphMeasurer,
} from "./paragraphs.ts";
import { filled } from "./shape.ts";

type Bounds = [number, number, number, number];

/**
 * The most work one boxer does again for what a drawing repeats: each attribute an insert places
 * past its first `FREE`, one more for each 256 characters of a tag it looks up among an insert's
 * values, one for each 32 characters up to `LONG` of a definition's value it repeats and for
 * each 32 characters of what a dimension reads from its style, one and one more for each 8
 * entities or inserts of a list it reads again for another block or drawing that holds it, a block
 * of a cycle worked out again for another way in, a unit and two more for each insert it holds.
 * The walks of placements count against `walking`, a limit of their own, and a placement whose
 * box had a number leave the range of doubles on the way, and whose walk does not fit in what is
 * left of it, ends the boxer's work.
 */
const MAX_WORK = 4_000_000;

/** The attributes each insert places free of the limit. */
const FREE = 64;

/** Twice the rounding of one step of arithmetic on doubles. */
const ROUNDING = 2 ** -52;

/** The least normal double. A product nearer 0 has lost the precision `ROUNDING` counts on. */
const NORMAL = 2 ** -1022;

/** The fewest points of a polyline whose box a boxer works out once, however many hold them. */
const SHARED = 64;

/** The longest value whose length is paid for: a `Measurer` reads a longer one once. */
const LONG = 256;

/**
 * Approximate extents. Arcs use their full circle, and a polyline counts for its points, the
 * arcs of its sides and its wide sides with their joins. A text counts for the box `measureText`
 * gives it, its capitals as long as the text plots, justified, turned and leaned as it is,
 * and for what its font draws below the baseline, and a paragraph for the box of all it draws,
 * as `measureParagraph` gives it. An insert counts for the box of what its block
 * draws, in the block's coordinates, where the insert puts the box's corners, so a turned insert
 * may count for more than it draws. An insert of an xref counts for the drawing given for it in
 * `xrefs`, and for nothing without one. A dimension counts for its lines, its arrowheads and its
 * text, when `dimensionStyles` holds its style, and a leader for its shafts, its arrowheads, its
 * landing and each line of its note, when `leaderStyles` holds its style.
 *
 * @param isHidden - True for a layer whose entities are left out, wherever they are drawn.
 * @param isFrozen - True for a layer that hides the whole of an insert on it: a frozen layer,
 *   and in a plot a layer that does not plot.
 * @param xrefs - The drawing of each xref, as `referencedByKey` gives them.
 * @param most - The work they do again for what the drawing repeats, as `boxer` counts it.
 * @throws RangeError when the drawing repeats more than that.
 */
export function extents(
  entities: readonly Entity[],
  textStyles: readonly TextStyle[] = [],
  blocks: readonly Block[] = [],
  isHidden: (layer: LayerRef) => boolean = () => false,
  isFrozen: (layer: LayerRef) => boolean = () => false,
  xrefs?: ReadonlyMap<string, Referenced>,
  dimensionStyles: readonly DimensionStyle[] = [],
  leaderStyles: readonly LeaderStyle[] = [],
  most = MAX_WORK,
): [number, number, number, number] {
  const boxOf = boxer(
    textStyles,
    blocks,
    isHidden,
    isFrozen,
    xrefs,
    dimensionStyles,
    leaderStyles,
    most,
  );
  const box = boxOf(entities);
  const at = boxOf.capped;
  if (at) {
    throw new RangeError(
      `The extents take more work than ${most} units: they stopped at ${at.kind} #${entities.indexOf(at)}`,
    );
  }
  return box ?? [0, 0, 1, 1];
}

/**
 * Gives the box `extents` gives for some entities of one drawing, or undefined when they draw
 * nothing.
 */
export interface Boxer {
  (entities: readonly Entity[]): [number, number, number, number] | undefined;
  /**
   * The entity it was boxing when its work reached its limit, after which no box it gives can
   * be relied on. Undefined while every box holds all it should.
   */
  readonly capped: Entity | undefined;
  /** The work it has done against its limit. */
  readonly spent: number;
  /**
   * The least a walk of an insert at the top of a space with `eachDrawn` spends: a unit for each
   * block it enters and one for each insert it reads there, which nothing it draws gives back.
   * 0 through a cycle, where the walk skips a block that is open.
   */
  walkCost(insert: Insert): number;
}

/** A block in one drawing, with its layer `"0"` hidden or not, and what it holds there. */
interface Held {
  readonly held: Block | Referenced;
  readonly block: Block | undefined;
  /** The referenced drawing whose names the block's entities use. */
  readonly inside: Referenced | undefined;
  /** The blocks its inserts find theirs among. */
  readonly inner: ReadonlyMap<string, Block>;
  /** Whether the layer its entities on layer `"0"` draw on is hidden. */
  readonly hidden: boolean;
  /** The inserts it holds that draw anything. */
  children: readonly Child[];
  /** How many inserts it holds, which a walk reads. */
  inserts: number;
  filled: boolean;
  /** The box of what its entities that are no insert draw, once read. */
  own: Bounds | undefined;
}

/** An insert inside a block, and where it puts its own block. */
interface Child {
  readonly held: Held;
  /** From the inserted block's coordinates to the block's that holds the insert. */
  readonly matrix: Matrix;
  /** The box of the insert's attributes, in the inserted block's coordinates. */
  readonly attributes: Bounds;
}

/**
 * The box of everything a block draws, through all its inserts, in its coordinates, with the
 * largest size a number reached on the way and how deep the inserts went.
 */
interface Flat {
  readonly box: Bounds;
  readonly size: number;
  readonly depth: number;
  /** True when a number on the way overflowed or underflowed, which the slack does not cover. */
  readonly rough: boolean;
}

/**
 * A function that gives the box `extents` gives for some entities of one drawing, or
 * undefined when they draw nothing. The drawing's blocks and text styles are read once, and
 * each block's box once for each drawing it is in and whether its layer `0` is hidden, so the
 * function can be asked for each entity of a large drawing in turn, and a block inserted many
 * times costs little more than once. What many places share is read once: the box of a list of
 * entities, of a polyline's points, of a leader and of a long value, and the inserts of a list.
 *
 * A placement walks the blocks its block inserts, with their matrices composed as `eachDrawn`
 * composes them, and maps the corners of each block's own box: its box holds a walk's to the
 * last bit, and is the walk's where no insert is turned. Each walk enters its first `FREE`
 * blocks free, and the walks of all placements `most` more. Past that, a placement maps the
 * corners of the box of all its block draws, which holds what each block inside it draws where
 * its insert puts that block's box, and widens it by what rounding can move a number on the way,
 * so a box is never smaller than a walk's. Where a number on the way overflowed or a product
 * underflowed, which the slack does not cover, it walks the blocks at a unit each.
 */
export function boxer(
  textStyles: readonly TextStyle[] = [],
  blocks: readonly Block[] = [],
  isHidden: (layer: LayerRef) => boolean = () => false,
  isFrozen: (layer: LayerRef) => boolean = () => false,
  xrefs?: ReadonlyMap<string, Referenced>,
  dimensionStyles: readonly DimensionStyle[] = [],
  leaderStyles: readonly LeaderStyle[] = [],
  most = MAX_WORK,
  walking = most,
): Boxer {
  const key = layerKeys();
  const { measure, again: readAgain } = measurer();
  const paragraphs = paragraphMeasurer();
  interface Names {
    readonly textStyles: ReadonlyMap<string, TextStyle>;
    readonly dimensionStyles: ReadonlyMap<string, DimensionStyle>;
    readonly leaderStyles: ReadonlyMap<string, LeaderStyle>;
    /** The blocks a leader's content names. */
    readonly blocks: ReadonlyMap<string, Block>;
  }
  const namesOf = (
    text: readonly TextStyle[] | undefined,
    dimensions: readonly DimensionStyle[] | undefined,
    leaders: readonly LeaderStyle[] | undefined,
    blocks: readonly Block[] | undefined,
  ): Names => ({
    textStyles: new Map(filled(text).map((t) => [layerKey(t.name), t])),
    dimensionStyles: new Map(filled(dimensions).map((style) => [layerKey(style.name), style])),
    leaderStyles: new Map(filled(leaders).map((style) => [layerKey(style.name), style])),
    blocks: new Map(filled(blocks).map((block) => [layerKey(block.name), block])),
  });
  const own = namesOf(textStyles, dimensionStyles, leaderStyles, blocks);
  // The names of each referenced drawing, worked out when one of its entities is first met.
  const referenced = new Map<Referenced, Names>();
  const byDrawing = new Map<Referenced["drawing"], Names>();
  const names = (from: Referenced | undefined): Names => {
    if (from === undefined) return own;
    let found = referenced.get(from);
    if (!found) {
      found = byDrawing.get(from.drawing);
      if (!found) {
        const { textStyles, dimensionStyles, leaderStyles, blocks } = from.drawing;
        found = namesOf(textStyles, dimensionStyles, leaderStyles, blocks);
        byDrawing.set(from.drawing, found);
      }
      referenced.set(from, found);
    }
    return found;
  };
  const layerOf = (name: string, inside: Referenced | undefined): LayerRef =>
    inside ? { name, of: inside } : { name };

  let work = 0;
  let over = false;
  let capped: Entity | undefined;
  let boxing: Entity | undefined;
  /** Counts the cost of a step, and says whether there is room left to take it. */
  const spend = (cost: number): boolean => {
    if (over) return false;
    work += cost;
    if (work <= most) return true;
    over = true;
    capped = boxing;
    return false;
  };
  /** Ends the boxer's work, as reaching its limit does. */
  const stop = (): void => {
    if (over) return;
    over = true;
    capped = boxing;
  };

  type Add = (x: number, y: number) => void;
  /** The points that bound what an entity that is no insert draws, given to `add`. */
  const shape = (e: Exclude<Entity, Insert>, from: Names, add: Add): void => {
    switch (e.kind) {
      case "line":
        add(...e.from);
        add(...e.to);
        break;
      case "polyline": {
        const box = curvedBox(e) ?? pointsBox(e.points);
        if (box[0] === Infinity) break;
        add(box[0], box[1]);
        add(box[2], box[3]);
        break;
      }
      case "circle":
      case "arc":
        add(e.center[0] - e.radius, e.center[1] - e.radius);
        add(e.center[0] + e.radius, e.center[1] + e.radius);
        break;
      case "text": {
        // A long value that took the place of another of its length is read again, and paid for.
        const again = typeof e.value === "string" && readAgain(e.value);
        if (again && !spend(Math.floor(e.value.length / 32))) break;
        const style = e.style === undefined ? undefined : from.textStyles.get(key(e.style));
        const { corners, descent } = measure(inStyle(e, style));
        const [c0, c1, c2, c3] = corners;
        for (const [x, y] of corners) add(x, y);
        // What a font draws below the baseline follows the lean of the box's ends.
        const below = descent / e.height || 0;
        add(c0[0] - (c3[0] - c0[0]) * below, c0[1] - (c3[1] - c0[1]) * below);
        add(c1[0] - (c2[0] - c1[0]) * below, c1[1] - (c2[1] - c1[1]) * below);
        break;
      }
      case "paragraph": {
        const style = e.style === undefined ? undefined : from.textStyles.get(key(e.style));
        const paragraph = paragraphInStyle(e, style);
        // A long value laid out again is paid for first; a box already kept is mapped alone.
        const again = paragraphs.boxAgain(paragraph);
        if (again > 0 && !spend(again)) break;
        for (const [x, y] of paragraphs.box(paragraph) ?? []) add(x, y);
        break;
      }
      case "linear-dimension":
      case "aligned-dimension":
      case "radius-dimension":
      case "diameter-dimension":
      case "jogged-radius-dimension":
        dimension(e, from, add);
        break;
      case "leader": {
        const box = leaderBox(e, from);
        if (box[0] === Infinity) break;
        add(box[0], box[1]);
        add(box[2], box[3]);
        break;
      }
      case "image": {
        // The image, and the frame of a clip that reaches past it: a rectangle's four corners
        // along the image's sides, or a polygon's points. One the plots cannot draw has none.
        if (!imageDrawable(e, clipsChecked)) break;
        for (const [x, y] of imageCorners(e)) add(x, y);
        if (e.clip === undefined) break;
        if (e.clip.length === 2) {
          for (const [x, y] of imageFrame(e)) add(x, y);
          break;
        }
        const box = pointsBox(e.clip);
        if (box[0] === Infinity) break;
        add(box[0], box[1]);
        add(box[2], box[3]);
        break;
      }
    }
  };
  /** The box of a list of points, worked out once for a long list however many hold it. */
  const pointBoxes = new WeakMap<object, Bounds>();
  /** Whether each clip an image gives can be drawn, read once however many images share it. */
  const clipsChecked = new WeakMap<object, boolean>();
  const pointsBox = (points: readonly Point[]): Bounds => {
    const long = Array.isArray(points) && points.length >= SHARED;
    const known = long ? pointBoxes.get(points) : undefined;
    if (known) return known;
    const box = empty();
    for (const p of filled(points)) include(box, ...p);
    if (long) pointBoxes.set(points, box);
    return box;
  };
  /**
   * The box of a polyline with an arc or a width, or undefined for one with neither, worked out
   * once for every polyline that holds the same lists: its points, its arcs and its filled sides.
   * A long list read again for another polyline is paid for, as `lint` pays for it.
   */
  const curvedBoxes = new PolylineMemo<Bounds | null>();
  const curvedLists = new WeakSet<object>();
  const curvedBox = (e: Polyline): Bounds | undefined => {
    if (!mayCurve(e)) return undefined;
    const known = curvedBoxes.get(e);
    if (known !== undefined) return known ?? undefined;
    /**
     * Pays for reading long lists again, a unit for each `per` items, and says whether there was
     * room to.
     */
    const paid = (lists: readonly unknown[], per: number): boolean => {
      let cost = 0;
      for (const list of lists) {
        if (!Array.isArray(list) || list.length < SHARED) continue;
        if (curvedLists.has(list)) cost += Math.floor(list.length / per);
        else curvedLists.add(list);
      }
      return cost === 0 || spend(cost);
    };
    // Telling whether it has an arc or a width reads its bulges and widths. Boxing it reads its
    // points and works out each side's arc, filled shape and join, which costs more for each.
    if (!paid([e.bulges, e.widths], 8)) return empty();
    if (!hasArcsOrWidths(e)) {
      curvedBoxes.set(e, null);
      return undefined;
    }
    if (!paid([e.points], 2)) return empty();
    const box = empty();
    const found = polylineBox(e);
    if (found) {
      include(box, found[0], found[1]);
      include(box, found[2], found[3]);
    }
    curvedBoxes.set(e, box);
    return box;
  };
  /** What a dimension draws: its lines, its arrowheads, and its text as any text is boxed. */
  const dimension = (e: Dimension, from: Names, add: Add): void => {
    const style = from.dimensionStyles.get(key(e.style));
    if (style === undefined) return;
    // Its style's prefix and suffix are read for each dimension that has the style.
    const reads =
      (style.prefix?.length ?? 0) +
      (style.suffix?.length ?? 0) +
      (e.text?.length ?? 0) +
      (e.textBelow?.length ?? 0);
    // The label is put together for each dimension, so it is paid for by its whole length.
    const cost = Math.floor(reads / 32);
    if (cost > 0 && !spend(cost)) return;
    const font =
      style.textStyle === undefined ? undefined : from.textStyles.get(key(style.textStyle));
    const picture = dimensionPicture(e, style, font);
    for (const line of [...picture.extensionLines, ...picture.dimensionLines, ...picture.leader]) {
      add(...line[0]);
      add(...line[1]);
    }
    for (const arrowhead of picture.arrowheads) for (const corner of arrowhead) add(...corner);
    // Each text by the box of what it draws, as its block's paragraph lays it out.
    for (const text of pictureTexts(picture, font)) {
      for (const corner of measured(text, layoutDimensionText(text)).corners ?? []) add(...corner);
    }
  };
  /**
   * The box of what a leader draws, worked out once for each drawing: its shafts, its
   * arrowheads, its landing, and each line of its note as any text is boxed.
   */
  const leaderBoxes = new WeakMap<Leader, Map<Names, Bounds>>();
  const repeats = leaderRepeats();
  const leaderBox = (e: Leader, from: Names): Bounds => {
    let byNames = leaderBoxes.get(e);
    if (!byNames) leaderBoxes.set(e, (byNames = new Map()));
    const known = byNames.get(from);
    if (known) return known;
    const box = empty();
    byNames.set(from, box);
    // A leader that shares its shafts or its note with another is read again, and paid for.
    const again = repeats(e);
    if (again > 0 && !spend(again)) return box;
    const add: Add = (x, y) => include(box, x, y);
    const style = from.leaderStyles.get(key(e.style));
    if (style === undefined) return box;
    const named = e.textStyle ?? style.textStyle;
    const textStyle = named === undefined ? undefined : from.textStyles.get(key(named));
    const picture = leaderPicture(e, style, textStyle, (name) => from.blocks.get(key(name)));
    for (const shaft of picture.shafts) for (const p of shaft) add(...p);
    for (const arrowhead of picture.arrowheads) {
      for (const p of arrowhead.filled) add(...p);
      for (const [a, b] of arrowhead.lines) {
        add(...a);
        add(...b);
      }
      for (const { center, radius } of arrowhead.disks) {
        add(center[0] - radius, center[1] - radius);
        add(center[0] + radius, center[1] + radius);
      }
    }
    for (const p of [...(picture.landing ?? []), ...(picture.farLanding ?? [])]) add(...p);
    for (const [a, b] of picture.underlines) {
      add(...a);
      add(...b);
    }
    for (const p of picture.frame ?? []) add(...p);
    for (const p of picture.mask?.corners ?? []) add(...p);
    // A block in place of the note: the box of its outline, as the picture places it.
    if (picture.block !== undefined) {
      add(picture.box[0], picture.box[1]);
      add(picture.box[2], picture.box[3]);
    }
    shape(picture.note, from, add);
    return box;
  };

  /** The attribute definitions of a list, read once, leaving out any item that is no object. */
  const definitions = new WeakMap<object, readonly AttributeDefinition[]>();
  const definitionsOf = (block: Block): readonly AttributeDefinition[] => {
    const list: unknown = block.attributes;
    if (!Array.isArray(list)) return [];
    let found = definitions.get(list);
    if (!found) definitions.set(list, (found = filled(list).filter(isDefinition)));
    return found;
  };
  /**
   * Gives `add` the points of the attributes an insert places, in its block's coordinates, the
   * first `FREE` of them free of the limit. A value the insert holds is read once for each time
   * the insert is, so only a definition's value, which each insert without one repeats, is paid
   * for by its length. False when the limit stopped it.
   */
  const attributes = (insert: Insert, held: Held, add: Add): boolean => {
    if (!held.block) return true;
    const from = names(held.inside);
    const listed = definitionsOf(held.block);
    const set = insert.attributes;
    for (let i = 0; i < listed.length; i++) {
      const definition = listed[i]!;
      const value = attributeText(insert, definition);
      const repeated = set === undefined || !Object.hasOwn(set, definition.tag);
      const cost =
        (i < FREE ? 0 : 1) +
        lookupCost(insert, definition) +
        (repeated ? Math.floor(Math.min(value.value.length, LONG) / 32) : 0);
      if (cost > 0 && !spend(cost)) return false;
      const layer = definition.layer;
      const hidden = layer === "0" ? held.hidden : isHidden(layerOf(layer, held.inside));
      if (!hidden) shape(value, from, add);
    }
    return true;
  };

  /**
   * The places a block is held in, from 1: each referenced drawing with the drawings given for
   * its attachments, which two places that give one drawing may give apart. The drawing itself
   * is 0.
   */
  const places = new Map<Referenced["drawing"], Map<Referenced["xrefs"], number>>();
  let counted = 0;
  const placeOf = (inside: Referenced | undefined): number => {
    if (inside === undefined) return 0;
    let byXrefs = places.get(inside.drawing);
    if (!byXrefs) places.set(inside.drawing, (byXrefs = new Map()));
    let place = byXrefs.get(inside.xrefs);
    if (place === undefined) byXrefs.set(inside.xrefs, (place = ++counted));
    return place;
  };
  /** Each block in each place, by the place and whether its layer `0` is hidden. */
  const helds = new Map<Block | Referenced, Held[]>();
  const heldOf = (
    held: Block | Referenced,
    block: Block | undefined,
    inside: Referenced | undefined,
    inner: ReadonlyMap<string, Block>,
    hidden: boolean,
  ): Held => {
    const slot = placeOf(inside) * 2 + (hidden ? 1 : 0);
    let all = helds.get(held);
    if (!all) helds.set(held, (all = []));
    return (all[slot] ??= {
      held,
      block,
      inside,
      inner,
      hidden,
      children: [],
      inserts: 0,
      filled: false,
      own: undefined,
    });
  };
  /**
   * The block an insert places, as `eachDrawn` finds it, inside `within` or at the top of a
   * space. Undefined when it draws nothing.
   */
  const placedBy = (
    insert: Insert,
    within: Pick<Held, "inside" | "inner" | "hidden">,
    top: boolean,
  ): Held | undefined => {
    const { inside } = within;
    // An insert on layer "0" of a block draws on the layer its block's entities on "0" draw
    // on, which is not frozen.
    const zero = insert.layer === "0" && !top;
    const layer = layerOf(insert.layer, inside);
    if (!zero && isFrozen(layer)) return undefined;
    const name = key(insert.block);
    const block = within.inner.get(name);
    const xref = block ? undefined : (inside ? inside.xrefs : xrefs)?.get(name);
    const held = block ?? xref;
    if (!held) return undefined;
    const hidden = zero ? within.hidden : isHidden(layer);
    return heldOf(held, block, xref ?? inside, xref ? xref.blocks : within.inner, hidden);
  };
  /** The entities a block holds, or an xref's model space. */
  const listOf = (held: Held): readonly Entity[] => {
    const items = held.block ? held.block.entities : (held.held as Referenced).drawing.entities;
    return Array.isArray(items) ? items : [];
  };
  /**
   * The box of what the entities of a list that are no insert draw, in its coordinates, read
   * once for each drawing and whether its layer `0` is hidden, however many blocks hold it.
   */
  const owns = new WeakMap<object, Map<Referenced | undefined, Bounds[]>>();
  const ownOf = (held: Held): Bounds => (held.own ??= readOwn(held));
  const readOwn = (held: Held): Bounds => {
    const list = listOf(held);
    let byInside = owns.get(list);
    if (!byInside) owns.set(list, (byInside = new Map()));
    let slots = byInside.get(held.inside);
    if (!slots) byInside.set(held.inside, (slots = []));
    const slot = held.hidden ? 1 : 0;
    const known = slots[slot];
    if (known) return known;
    const box = empty();
    // A list that another drawing holds too, such as one drawing given for many xrefs, is read
    // again for each, and paid for.
    if (byInside.size > 1 && !spend(1 + Math.floor(list.length / 8))) return (slots[slot] = box);
    const from = names(held.inside);
    const add: Add = (x, y) => include(box, x, y);
    for (const item of filled(list)) {
      if (over) break;
      if (item.kind === "insert") continue;
      const layer = item.layer;
      const hidden = layer === "0" ? held.hidden : isHidden(layerOf(layer, held.inside));
      if (!hidden) shape(item, from, add);
    }
    return (slots[slot] = box);
  };
  /** The inserts of a list, found once, and the block or xref and the place that first read them. */
  const insertLists = new WeakMap<
    object,
    { inserts: readonly Insert[]; by: Block | Referenced; place: number }
  >();
  /** Reads the inserts a block holds, once, and pays for a list read for another block or place. */
  const fill = (held: Held): void => {
    if (held.filled) return;
    held.filled = true;
    const list = listOf(held);
    const place = placeOf(held.inside);
    let found = insertLists.get(list);
    if (!found) {
      const inserts = filled(list).filter((item): item is Insert => item.kind === "insert");
      insertLists.set(list, (found = { inserts, by: held.held, place }));
    }
    const { inserts } = found;
    held.inserts = inserts.length;
    if ((found.by !== held.held || found.place !== place) && inserts.length > 0) {
      if (!spend(1 + Math.floor(inserts.length / 8))) return;
    }
    const children: Child[] = [];
    for (const item of inserts) {
      const inner = placedBy(item, held, false);
      if (!inner) continue;
      const box = empty();
      attributes(item, inner, (x, y) => include(box, x, y));
      children.push({
        held: inner,
        matrix: insertMatrix(item, inner.block?.base),
        attributes: box,
      });
    }
    held.children = children;
  };

  /** The box of each block, where no block it holds was open on the way in. */
  const flats = new Map<Held, Flat>();
  /** The box of a block of a cycle placed at the top of a space, where no block is open. */
  const tops = new Map<Held, Flat>();
  /** The blocks whose box has been worked out, so that working one out again is paid for. */
  const worked = new Set<Held>();
  /**
   * The box of what a block draws at the top of a space. A block of a cycle skips an insert of
   * a block that is open, as `eachDrawn` does, so its box is kept only for the way in it was
   * worked out on. Undefined when the limit stopped it.
   */
  const flatOf = (start: Held): Flat | undefined => {
    const known = flats.get(start) ?? tops.get(start);
    if (known) return known;
    interface Gathering {
      readonly held: Held;
      readonly again: boolean;
      next: number;
      readonly box: Bounds;
      size: number;
      depth: number;
      rough: boolean;
      /** The least index of an open block it skipped an insert of. */
      relied: number;
      waiting: Child | undefined;
    }
    const open = new Map<Block | Referenced, number>();
    const stack: Gathering[] = [];
    const enter = (held: Held): boolean => {
      fill(held);
      const box = ownOf(held);
      const again = worked.has(held);
      if (again && !spend(1)) return false;
      open.set(held.held, stack.length);
      stack.push({
        held,
        again,
        next: 0,
        box: [...box],
        size: sizeOf(box),
        depth: 0,
        rough: false,
        relied: Infinity,
        waiting: undefined,
      });
      return true;
    };
    const add = (
      into: Gathering,
      box: Bounds,
      m: Matrix,
      size: number,
      depth: number,
      rough = false,
    ) => {
      if (box[0] === Infinity) return;
      if (!mapBox(into.box, box, m) || rough) into.rough = true;
      into.size = Math.max(into.size, stretch(m) * size + reach(m));
      into.depth = Math.max(into.depth, depth);
    };
    if (!enter(start)) return undefined;
    while (stack.length > 0) {
      const frame = stack.at(-1)!;
      const { children } = frame.held;
      if (frame.next < children.length) {
        const child = children[frame.next++]!;
        // A block worked out again pays for each insert it reads, one it skips as open too.
        if (frame.again && !spend(1)) return undefined;
        const at = open.get(child.held.held);
        if (at !== undefined) {
          // An insert of the block in itself is skipped on every way in, and relies on nothing.
          if (at !== stack.length - 1) frame.relied = Math.min(frame.relied, at);
          continue;
        }
        if (frame.again && !spend(1)) return undefined;
        add(frame, child.attributes, child.matrix, sizeOf(child.attributes), 1);
        const inner = flats.get(child.held);
        if (inner) add(frame, inner.box, child.matrix, inner.size, inner.depth + 1, inner.rough);
        else {
          frame.waiting = child;
          if (!enter(child.held)) return undefined;
        }
        continue;
      }
      stack.pop();
      open.delete(frame.held.held);
      worked.add(frame.held);
      const flat: Flat = {
        box: frame.box,
        size: frame.size,
        depth: frame.depth,
        rough: frame.rough || !Number.isFinite(frame.size),
      };
      const index = stack.length;
      if (frame.relied === Infinity) flats.set(frame.held, flat);
      else if (index === 0) tops.set(frame.held, flat);
      const parent = stack.at(-1);
      if (!parent) return flat;
      // What it drew depends on a block open above it, so it is worked out again elsewhere.
      if (frame.relied < index) parent.relied = Math.min(parent.relied, frame.relied);
      const child = parent.waiting!;
      parent.waiting = undefined;
      add(parent, flat.box, child.matrix, flat.size, flat.depth + 1, flat.rough);
    }
    return undefined;
  };

  /** What a walk keeps while it walks, which no walk starts inside another. */
  const walkOpen = new Set<Block | Referenced>();
  const walkStack: { held: Held; m: Matrix; next: number }[] = [];
  /** Enters a block on a walk, and leaves it at once when it inserts nothing. */
  const walkInto = (held: Held, m: Matrix, into: Bounds): void => {
    fill(held);
    const box = ownOf(held);
    if (box[0] !== Infinity) mapCorners(into, box, m);
    if (held.children.length === 0) return;
    walkOpen.add(held.held);
    walkStack.push({ held, m, next: 0 });
  };
  /**
   * Adds what a block draws where `matrix` puts it to `into`, through a walk of the blocks it
   * inserts with their matrices composed as `eachDrawn` composes them, so each block's own box
   * is mapped as a walk maps each point of it. It asks `pay` for a unit for each block it enters
   * and each insert it reads there, and is false when `pay` said no.
   */
  const walkPlace = (
    start: Held,
    matrix: Matrix,
    into: Bounds,
    pay: (units: number) => boolean,
  ): boolean => {
    const open = walkOpen;
    const stack = walkStack;
    open.clear();
    stack.length = 0;
    if (!pay(1)) return false;
    walkInto(start, matrix, into);
    while (stack.length > 0) {
      const at = stack.at(-1)!;
      const { children } = at.held;
      if (at.next < children.length) {
        const child = children[at.next++]!;
        // Each insert it reads is paid for, one it skips as open too.
        if (!pay(1)) return false;
        if (open.has(child.held.held)) continue;
        const m = compose(at.m, child.matrix);
        if (child.attributes[0] !== Infinity) mapCorners(into, child.attributes, m);
        if (!pay(1)) return false;
        walkInto(child.held, m, into);
        continue;
      }
      stack.pop();
      open.delete(at.held.held);
    }
    return true;
  };

  /** The blocks the walks of placements have entered past the first `FREE` of each. */
  let walks = 0;
  /**
   * How many blocks a walk of a block enters, worked out once for each block from what its
   * inserts enter, or Infinity through a cycle.
   */
  const counts = new Map<Held, number>();
  /** The least a walk of each block of a tree with no cycle spends, as `walkCost` says. */
  const costs = new Map<Held, number>();
  const countOf = (start: Held): number => {
    const known = counts.get(start);
    if (known !== undefined) return known;
    // A block is open by itself, as `eachDrawn` takes it, whatever drawing it is reached through.
    const open = new Set<Block | Referenced>();
    const stack: { held: Held; next: number; sum: number; cost: number }[] = [];
    const enter = (held: Held): void => {
      fill(held);
      open.add(held.held);
      stack.push({ held, next: 0, sum: 1, cost: 1 + held.inserts });
    };
    enter(start);
    while (stack.length > 0) {
      const frame = stack.at(-1)!;
      const { children } = frame.held;
      if (frame.next < children.length) {
        const child = children[frame.next++]!;
        const below = counts.get(child.held);
        if (open.has(child.held.held)) frame.sum = Infinity;
        else if (below !== undefined) {
          frame.sum += below;
          frame.cost += costs.get(child.held) ?? 0;
        } else enter(child.held);
        continue;
      }
      stack.pop();
      open.delete(frame.held.held);
      counts.set(frame.held, frame.sum);
      costs.set(frame.held, frame.sum === Infinity ? 0 : frame.cost);
      const parent = stack.at(-1);
      if (parent) {
        parent.sum += frame.sum;
        parent.cost += frame.cost;
      }
    }
    return counts.get(start)!;
  };

  /**
   * Adds what a block draws where `matrix` puts it at the top of a space to `into`. A placement
   * walks the blocks it inserts, which gives the walk's box to the last bit where no insert is
   * turned: the first `FREE` blocks of each walk are free, and the walks take `most` more in all.
   * Past that, a placement maps the corners of the box of all its block draws.
   */
  const place = (held: Held, matrix: Matrix, into: Bounds): void => {
    const blocks = countOf(held);
    if (blocks <= FREE || walks + blocks - FREE <= walking) {
      walks += Math.max(0, blocks - FREE);
      walkPlace(held, matrix, into, () => true);
      return;
    }
    const flat = flatOf(held);
    if (!flat || flat.box[0] === Infinity) return;
    const box = empty();
    const sound = mapBox(box, flat.box, matrix);
    // A walk composes the matrices before it maps a point, so rounding on the way can move its
    // numbers from these. Each step moves a number by at most a rounding of the largest size on
    // the way, for the box and for the walk alike, so the box is widened by that. A block that
    // inserts nothing is mapped as a walk maps it, and the corner of its box that each side
    // takes rounds no nearer than any point inside.
    const slack =
      flat.depth > 0
        ? ROUNDING * (6 * flat.depth + 9) * (stretch(matrix) * flat.size + reach(matrix))
        : 0;
    // A number that overflowed or underflowed on the way is out of the slack's reach, so the
    // blocks are walked within the walks left, and past them the boxer stops.
    if (flat.rough || !sound || !Number.isFinite(slack)) {
      let free = FREE;
      const walked = walkPlace(held, matrix, into, (units) => {
        if (free >= units) free -= units;
        else if (walks + units <= walking) walks += units;
        else return false;
        return true;
      });
      if (!walked) stop();
      return;
    }
    include(into, box[0] - slack, box[1] - slack);
    include(into, box[2] + slack, box[3] + slack);
  };

  const ownBlocks = blocks.length > 0 || xrefs?.size ? blocksByKey(blocks) : undefined;
  const top = { inside: undefined, inner: ownBlocks ?? new Map<string, Block>(), hidden: false };
  const fn = (entities: readonly Entity[]): [number, number, number, number] | undefined => {
    const box = empty();
    const add: Add = (x, y) => include(box, x, y);
    for (const e of filled(entities)) {
      if (over) break;
      boxing = e;
      if (e.kind !== "insert") {
        shape(e, own, add);
        continue;
      }
      if (!ownBlocks) continue;
      const held = placedBy(e, top, true);
      if (!held) continue;
      const matrix = insertMatrix(e, held.block?.base);
      place(held, matrix, box);
      const [a, b, c, d, x0, y0] = matrix;
      attributes(e, held, (x, y) => include(box, a * x + c * y + x0, b * x + d * y + y0));
    }
    boxing = undefined;
    return box[0] === Infinity ? undefined : box;
  };
  Object.defineProperty(fn, "capped", { get: () => capped });
  Object.defineProperty(fn, "spent", { get: () => work });
  Object.defineProperty(fn, "walkCost", {
    value: (insert: Insert): number => {
      boxing = insert;
      const held = ownBlocks && placedBy(insert, top, true);
      const cost = held && countOf(held) !== Infinity ? costs.get(held)! : 0;
      boxing = undefined;
      return cost;
    },
  });
  return fn as Boxer;
}

function empty(): Bounds {
  return [Infinity, Infinity, -Infinity, -Infinity];
}

function include(into: Bounds, x: number, y: number): void {
  into[0] = Math.min(into[0], x);
  into[1] = Math.min(into[1], y);
  into[2] = Math.max(into[2], x);
  into[3] = Math.max(into[3], y);
}

/**
 * Adds the corners of a box, where `m` puts them as `mapPoint` works it out, to `into`. False
 * when a box and a matrix of finite numbers gave a number that overflowed, or a product that
 * underflowed.
 */
function mapBox(into: Bounds, box: Bounds, m: Matrix): boolean {
  const [a, b, c, d, e, f] = m;
  const [x0, y0, x1, y1] = box;
  const [ax0, ax1, bx0, bx1] = [a * x0, a * x1, b * x0, b * x1];
  const [cy0, cy1, dy0, dy1] = [c * y0, c * y1, d * y0, d * y1];
  const corners = [
    ax0 + cy0 + e,
    bx0 + dy0 + f,
    ax0 + cy1 + e,
    bx0 + dy1 + f,
    ax1 + cy0 + e,
    bx1 + dy0 + f,
    ax1 + cy1 + e,
    bx1 + dy1 + f,
  ];
  for (let i = 0; i < 8; i += 2) include(into, corners[i]!, corners[i + 1]!);
  const sound =
    corners.every(Number.isFinite) &&
    kept(a, x0, ax0) &&
    kept(a, x1, ax1) &&
    kept(b, x0, bx0) &&
    kept(b, x1, bx1) &&
    kept(c, y0, cy0) &&
    kept(c, y1, cy1) &&
    kept(d, y0, dy0) &&
    kept(d, y1, dy1);
  return sound || ![...box, ...m].every(Number.isFinite);
}

/** Adds the corners of a box, where `m` puts them as `mapBox` works them out, to `into`. */
function mapCorners(into: Bounds, box: Bounds, m: Matrix): void {
  const [a, b, c, d, e, f] = m;
  const [x0, y0, x1, y1] = box;
  const [ax0, ax1, bx0, bx1] = [a * x0, a * x1, b * x0, b * x1];
  const [cy0, cy1, dy0, dy1] = [c * y0, c * y1, d * y0, d * y1];
  include(into, ax0 + cy0 + e, bx0 + dy0 + f);
  include(into, ax0 + cy1 + e, bx0 + dy1 + f);
  include(into, ax1 + cy0 + e, bx1 + dy0 + f);
  include(into, ax1 + cy1 + e, bx1 + dy1 + f);
}

/** False for a product of two numbers that overflowed or lost precision near 0. */
function kept(p: number, q: number, product: number): boolean {
  if (product === 0) return p === 0 || q === 0;
  return Math.abs(product) >= NORMAL && Number.isFinite(product);
}

/** The largest size of a number of a box, or 0 for a box of nothing. */
function sizeOf(box: Bounds): number {
  if (box[0] === Infinity) return 0;
  return Math.max(Math.abs(box[0]), Math.abs(box[1]), Math.abs(box[2]), Math.abs(box[3]));
}

/** How much a matrix's turn and scale can make a number larger. */
function stretch(m: Matrix): number {
  return Math.max(Math.abs(m[0]) + Math.abs(m[2]), Math.abs(m[1]) + Math.abs(m[3]));
}

/** The larger of a matrix's moves. */
function reach(m: Matrix): number {
  return Math.max(Math.abs(m[4]), Math.abs(m[5]));
}
