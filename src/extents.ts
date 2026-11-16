import {
  attributeText,
  blocksByKey,
  compose,
  insertMatrix,
  lookupCost,
  type LayerRef,
  type Matrix,
  type Referenced,
} from "./blocks.ts";
import { dimensionPicture, type Dimension } from "./dimensions.ts";
import type {
  AttributeDefinition,
  Block,
  DimensionStyle,
  Entity,
  Insert,
  Point,
  Text,
  TextStyle,
} from "./drawing.ts";
import { layerKey, layerKeys } from "./layers.ts";
import { inStyle, measureText } from "./measure.ts";
import { filled } from "./shape.ts";

type Bounds = [number, number, number, number];

/**
 * The most work one boxer does again for what a drawing repeats: each attribute an insert places
 * past its first `FREE`, one more for each 32 characters of a definition's value it repeats and
 * of what a dimension reads from its style, and a block of a cycle worked out again for another
 * way in, a unit and one more for each 8 points it maps. The walks of placements count against a
 * limit of the same size of their own, past which a placement maps an outline.
 */
const MAX_WORK = 4_000_000;

/** The attributes each insert places free of the limit, and the units each placement walks. */
const FREE = 64;

/** The most points the outline of all a block draws keeps. */
const MOST_POINTS = 1024;

/** Twice the rounding of one step of arithmetic on doubles. */
const ROUNDING = 2 ** -52;

/**
 * Approximate extents. Arcs use their full circle. A text counts for the box `measureText`
 * gives it, its capitals as long as the text plots, justified, turned and leaned as it is,
 * and for what its font draws below the baseline. An insert counts for what its block draws where the
 * insert puts it, with a circle or an arc under an uneven scale as the box around its circle.
 * An insert of an xref counts for the drawing given for it in `xrefs`, and for nothing without
 * one. A dimension counts for its lines, its arrowheads and its text, when `dimensionStyles`
 * holds its style.
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
  most = MAX_WORK,
): [number, number, number, number] {
  const boxOf = boxer(textStyles, blocks, isHidden, isFrozen, xrefs, dimensionStyles, most);
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
  /**
   * The outline of what its own entities draw, in its coordinates, worked out when it is mapped
   * a second time: the first time, its entities are mapped one by one.
   */
  own: readonly Point[] | undefined;
  /** True once its own entities have been mapped. */
  met: boolean;
  /** The inserts it holds that draw anything. */
  children: readonly Child[];
  filled: boolean;
  /**
   * The units a walk of what its inserts draw takes, its own entities left out, or Infinity when
   * it reaches a cycle.
   */
  below: number | undefined;
}

/** An insert inside a block, and where it puts its own block. */
interface Child {
  readonly held: Held;
  /** From the inserted block's coordinates to the block's that holds the insert. */
  readonly matrix: Matrix;
  /** The outline of the insert's attributes, in the inserted block's coordinates. */
  readonly attributes: readonly Point[];
}

/**
 * The outline of everything a block draws, through all its inserts, in its coordinates, with
 * the largest size a number reached on the way and how deep the inserts went.
 */
interface Flat {
  readonly points: readonly Point[];
  readonly size: number;
  readonly depth: number;
  /** True when an outline on the way kept fewer points than it bounds. */
  readonly rough: boolean;
}

/**
 * A function that gives the box `extents` gives for some entities of one drawing, or
 * undefined when they draw nothing. The drawing's blocks and text styles are read once, and
 * each block's outline once for each drawing it is in and whether its layer `0` is hidden, so
 * the function can be asked for each entity of a large drawing in turn, and a block inserted
 * many times costs little more than once.
 *
 * A placement maps the outline of each block its walk enters with the matrix the walk gives it,
 * as `eachDrawn` composes them, so its box is the walk's to the last bit. The first placement of
 * a block at the top of a space maps its own entities one by one, as the walk does, and its
 * outline is worked out only when it is mapped again, so a large block or xref placed once costs
 * what reading it does. A walk counts a unit for each block and each 8 points of an outline.
 * Through a cycle, and once the walks of a boxer pass `most` units beyond the first `FREE` of
 * each, a placement maps the outline of all its block draws instead, at most `MOST_POINTS`
 * points, and widens the box by what rounding can move a number on the way.
 */
export function boxer(
  textStyles: readonly TextStyle[] = [],
  blocks: readonly Block[] = [],
  isHidden: (layer: LayerRef) => boolean = () => false,
  isFrozen: (layer: LayerRef) => boolean = () => false,
  xrefs?: ReadonlyMap<string, Referenced>,
  dimensionStyles: readonly DimensionStyle[] = [],
  most = MAX_WORK,
): Boxer {
  const key = layerKeys();
  interface Names {
    readonly textStyles: ReadonlyMap<string, TextStyle>;
    readonly dimensionStyles: ReadonlyMap<string, DimensionStyle>;
    /** Counts the drawings, from 0 for the drawing itself. */
    readonly index: number;
  }
  const namesOf = (
    text: readonly TextStyle[] | undefined,
    dimensions: readonly DimensionStyle[] | undefined,
    index: number,
  ): Names => ({
    textStyles: new Map(filled(text).map((t) => [layerKey(t.name), t])),
    dimensionStyles: new Map(filled(dimensions).map((style) => [layerKey(style.name), style])),
    index,
  });
  const own = namesOf(textStyles, dimensionStyles, 0);
  // The names of each referenced drawing, worked out when one of its entities is first met.
  const referenced = new Map<Referenced, Names>();
  const byDrawing = new Map<Referenced["drawing"], Names>();
  const names = (from: Referenced | undefined): Names => {
    if (from === undefined) return own;
    let found = referenced.get(from);
    if (!found) {
      found = byDrawing.get(from.drawing);
      if (!found) {
        const { textStyles, dimensionStyles } = from.drawing;
        found = namesOf(textStyles, dimensionStyles, byDrawing.size + 1);
        byDrawing.set(from.drawing, found);
      }
      referenced.set(from, found);
    }
    return found;
  };
  const layerOf = (name: string, inside: Referenced | undefined): LayerRef =>
    inside ? { name, of: inside } : { name };

  let work = 0;
  let walks = 0;
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

  const include = (into: Bounds, x: number, y: number): void => {
    into[0] = Math.min(into[0], x);
    into[1] = Math.min(into[1], y);
    into[2] = Math.max(into[2], x);
    into[3] = Math.max(into[3], y);
  };
  /** Adds each point, where `m` puts it, to `into`, as `mapPoint` works it out. */
  const mapInto = (into: Bounds, points: readonly Point[], m: Matrix): void => {
    const [a, b, c, d, e, f] = m;
    for (const [x, y] of points) include(into, a * x + c * y + e, b * x + d * y + f);
  };
  type Add = (x: number, y: number) => void;
  /**
   * The points that an entity that is no insert draws through, given to `add`. `placed` is true
   * inside an insert, where the box of a circle may turn, so all four of its corners count.
   */
  const shape = (e: Exclude<Entity, Insert>, placed: boolean, from: Names, add: Add): void => {
    switch (e.kind) {
      case "line":
        add(...e.from);
        add(...e.to);
        break;
      case "polyline":
        for (const p of filled(e.points)) add(...p);
        break;
      case "circle":
      case "arc":
        add(e.center[0] - e.radius, e.center[1] - e.radius);
        add(e.center[0] + e.radius, e.center[1] + e.radius);
        if (placed) {
          add(e.center[0] - e.radius, e.center[1] + e.radius);
          add(e.center[0] + e.radius, e.center[1] - e.radius);
        }
        break;
      case "text": {
        const style = e.style === undefined ? undefined : from.textStyles.get(key(e.style));
        const { corners, descent } = measureText(inStyle(e, style));
        const [c0, c1, c2, c3] = corners;
        for (const [x, y] of corners) add(x, y);
        // What a font draws below the baseline follows the lean of the box's ends.
        const below = descent / e.height || 0;
        add(c0[0] - (c3[0] - c0[0]) * below, c0[1] - (c3[1] - c0[1]) * below);
        add(c1[0] - (c2[0] - c1[0]) * below, c1[1] - (c2[1] - c1[1]) * below);
        break;
      }
      case "linear-dimension":
      case "aligned-dimension":
        dimension(e, placed, from, add);
        break;
    }
  };
  /** What a dimension draws: its lines, its arrowheads, and its text as any text is boxed. */
  const dimension = (e: Dimension, placed: boolean, from: Names, add: Add): void => {
    const style = from.dimensionStyles.get(key(e.style));
    if (style === undefined) return;
    // Its style's prefix and suffix are read for each dimension that has the style.
    const reads = (style.prefix?.length ?? 0) + (style.suffix?.length ?? 0) + (e.text?.length ?? 0);
    const cost = Math.floor(reads / 32);
    if (cost > 0 && !spend(cost)) return;
    const picture = dimensionPicture(e, style);
    for (const line of [...picture.extensionLines, picture.dimensionLine]) {
      add(...line[0]);
      add(...line[1]);
    }
    for (const arrowhead of picture.arrowheads) for (const corner of arrowhead) add(...corner);
    const { label } = picture;
    const text: Text = {
      kind: "text",
      layer: e.layer,
      at: label.at,
      height: label.height,
      value: label.value,
      rotation: label.rotation,
      align: "center",
      ...(label.style === undefined ? {} : { style: label.style }),
    };
    shape(text, placed, from, add);
  };

  /** The attribute definitions of each block, read once. */
  const definitions = new Map<Block, readonly AttributeDefinition[]>();
  const definitionsOf = (block: Block): readonly AttributeDefinition[] => {
    let found = definitions.get(block);
    if (!found) definitions.set(block, (found = filled(block.attributes)));
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
        (repeated ? Math.floor(value.value.length / 32) : 0);
      if (cost > 0 && !spend(cost)) return false;
      const layer = definition.layer;
      const hidden = layer === "0" ? held.hidden : isHidden(layerOf(layer, held.inside));
      if (!hidden) shape(value, true, from, add);
    }
    return true;
  };

  /** Each block in each drawing, by the drawing and whether its layer `0` is hidden. */
  const helds = new Map<Block | Referenced, Held[]>();
  const heldOf = (
    held: Block | Referenced,
    block: Block | undefined,
    inside: Referenced | undefined,
    inner: ReadonlyMap<string, Block>,
    hidden: boolean,
  ): Held => {
    const slot = names(inside).index * 2 + (hidden ? 1 : 0);
    let all = helds.get(held);
    if (!all) helds.set(held, (all = []));
    return (all[slot] ??= {
      held,
      block,
      inside,
      inner,
      hidden,
      own: undefined,
      met: false,
      children: [],
      filled: false,
      below: undefined,
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
    const xref = block || inside ? undefined : xrefs?.get(name);
    const held = block ?? xref;
    if (!held) return undefined;
    const hidden = zero ? within.hidden : isHidden(layer);
    return heldOf(held, block, xref ?? inside, xref ? xref.blocks : within.inner, hidden);
  };
  /** Gives `add` the points of what a block's own entities draw, in its coordinates. */
  const ownPoints = (held: Held, add: Add): void => {
    const items = held.block ? held.block.entities : (held.held as Referenced).drawing.entities;
    const from = names(held.inside);
    for (const item of filled(Array.isArray(items) ? items : [])) {
      if (item.kind === "insert") continue;
      const layer = item.layer;
      const hidden = layer === "0" ? held.hidden : isHidden(layerOf(layer, held.inside));
      if (!hidden) shape(item, true, from, add);
    }
  };
  /** The outline of what a block's own entities draw, worked out once. */
  const ownOf = (held: Held): readonly Point[] => {
    if (held.own) return held.own;
    const own = gathering();
    ownPoints(held, own.add);
    held.met = true;
    return (held.own = own.outline());
  };
  /**
   * Adds what a block's own entities draw where `m` puts them to `into`: one by one the first
   * time, as a walk of them does, and through their outline after that.
   */
  const mapOwn = (into: Bounds, held: Held, m: Matrix): void => {
    if (held.own || held.met) mapInto(into, ownOf(held), m);
    else {
      held.met = true;
      const [a, b, c, d, e, f] = m;
      ownPoints(held, (x, y) => include(into, a * x + c * y + e, b * x + d * y + f));
    }
  };
  /** Reads the inserts a block holds, once. */
  const fill = (held: Held): void => {
    if (held.filled) return;
    held.filled = true;
    const items = held.block ? held.block.entities : (held.held as Referenced).drawing.entities;
    const children: Child[] = [];
    for (const item of filled(Array.isArray(items) ? items : [])) {
      if (item.kind !== "insert") continue;
      const inner = placedBy(item, held, false);
      if (!inner) continue;
      const placed = gathering();
      attributes(item, inner, placed.add);
      children.push({
        held: inner,
        matrix: insertMatrix(item, inner.block?.base),
        attributes: placed.outline(),
      });
    }
    held.children = children;
  };

  /**
   * The units a walk of what a block's inserts draw takes, worked out once a block. A block it
   * enters counts the units of its outline.
   */
  const belowOf = (start: Held): number => {
    if (start.below !== undefined) return start.below;
    interface Counting {
      readonly held: Held;
      next: number;
      sum: number;
    }
    const open = new Set<Held>();
    const stack: Counting[] = [];
    const enter = (held: Held): void => {
      fill(held);
      open.add(held);
      stack.push({ held, next: 0, sum: 0 });
    };
    enter(start);
    while (stack.length > 0) {
      const frame = stack.at(-1)!;
      const { children } = frame.held;
      if (frame.next < children.length) {
        const child = children[frame.next++]!;
        frame.sum += units(child.attributes);
        if (open.has(child.held)) frame.sum = Infinity;
        else {
          frame.sum += units(ownOf(child.held));
          if (child.held.below !== undefined) frame.sum += child.held.below;
          else enter(child.held);
        }
        continue;
      }
      stack.pop();
      open.delete(frame.held);
      frame.held.below = frame.sum;
      const parent = stack.at(-1);
      if (parent) parent.sum += frame.sum;
    }
    return start.below!;
  };
  /** Adds what the inserts of a block draw where `matrix` puts it to `into`, walking them. */
  const walk = (start: Held, matrix: Matrix, into: Bounds): void => {
    const stack: [Held, Matrix][] = [[start, matrix]];
    while (stack.length > 0) {
      const [held, m] = stack.pop()!;
      if (held !== start) mapInto(into, ownOf(held), m);
      for (const child of held.children) {
        const inner = compose(m, child.matrix);
        mapInto(into, child.attributes, inner);
        stack.push([child.held, inner]);
      }
    }
  };

  /** The outline of each block, where no block it holds was open on the way in. */
  const flats = new Map<Held, Flat>();
  /** The outline of a block of a cycle placed at the top of a space, where no block is open. */
  const tops = new Map<Held, Flat>();
  /** The blocks whose outline has been worked out, so that working one out again is paid for. */
  const worked = new Set<Held>();
  /**
   * The outline of what a block draws at the top of a space. A block of a cycle skips an insert
   * of a block that is open, as `eachDrawn` does, so its outline is kept only for the way in it
   * was worked out on. Undefined when the limit stopped it.
   */
  const flatOf = (start: Held): Flat | undefined => {
    const known = flats.get(start) ?? tops.get(start);
    if (known) return known;
    interface Gathering {
      readonly held: Held;
      readonly again: boolean;
      next: number;
      points: Point[];
      /** How many outlines its points came from: one is an outline still. */
      sources: number;
      rough: boolean;
      size: number;
      depth: number;
      /** The least index of an open block it skipped an insert of. */
      relied: number;
      waiting: Child | undefined;
    }
    const open = new Map<Block | Referenced, number>();
    const stack: Gathering[] = [];
    const enter = (held: Held): boolean => {
      fill(held);
      const own = ownOf(held);
      const again = worked.has(held);
      if (again && !spend(units(own))) return false;
      open.set(held.held, stack.length);
      stack.push({
        held,
        again,
        next: 0,
        points: [...own],
        sources: own.length > 0 ? 1 : 0,
        rough: false,
        size: sizeOf(own),
        depth: 0,
        relied: Infinity,
        waiting: undefined,
      });
      return true;
    };
    const add = (
      into: Gathering,
      points: readonly Point[],
      m: Matrix,
      size: number,
      depth: number,
    ) => {
      const [a, b, c, d, e, f] = m;
      for (const [x, y] of points) into.points.push([a * x + c * y + e, b * x + d * y + f]);
      if (into.points.length > 4 * MOST_POINTS) {
        into.points = outline(into.points, MOST_POINTS);
        into.sources = 1;
        into.rough ||= ROUGH.has(into.points);
      }
      if (points.length > 0) {
        into.sources++;
        into.size = Math.max(into.size, stretch(m) * size + reach(m));
        into.depth = Math.max(into.depth, depth);
      }
    };
    if (!enter(start)) return undefined;
    while (stack.length > 0) {
      const frame = stack.at(-1)!;
      const { children } = frame.held;
      if (frame.next < children.length) {
        const child = children[frame.next++]!;
        const at = open.get(child.held.held);
        if (at !== undefined) {
          frame.relied = Math.min(frame.relied, at);
          continue;
        }
        const inner = flats.get(child.held);
        if (frame.again && !spend(units(child.attributes) + (inner ? units(inner.points) : 0))) {
          return undefined;
        }
        add(frame, child.attributes, child.matrix, sizeOf(child.attributes), 1);
        if (inner) add(frame, inner.points, child.matrix, inner.size, inner.depth + 1);
        else {
          frame.waiting = child;
          if (!enter(child.held)) return undefined;
        }
        continue;
      }
      stack.pop();
      open.delete(frame.held.held);
      worked.add(frame.held);
      // A map of the plane takes an outline to an outline.
      const points =
        frame.sources > 1 || frame.points.length > MOST_POINTS
          ? outline(frame.points, MOST_POINTS)
          : frame.points;
      const flat: Flat = {
        points,
        size: frame.size,
        depth: frame.depth,
        rough: frame.rough || ROUGH.has(points),
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
      add(parent, flat.points, child.matrix, flat.size, flat.depth + 1);
    }
    return undefined;
  };

  /**
   * Adds what a block draws where `matrix` puts it at the top of a space to `into`. The first
   * time a block's own entities are mapped is the work of reading them, so a walk counts their
   * outline only after that.
   */
  const place = (held: Held, matrix: Matrix, into: Bounds): void => {
    const below = belowOf(held);
    const walked = (held.own || held.met ? units(ownOf(held)) : 0) + below;
    if (walked <= FREE || walks + walked <= most) {
      if (walked > FREE) walks += walked;
      mapOwn(into, held, matrix);
      walk(held, matrix, into);
      return;
    }
    const flat = flatOf(held);
    if (!flat) return;
    const box = empty();
    mapInto(box, flat.points, matrix);
    if (box[0] === Infinity) return;
    // The walk composes the matrices before it maps a point, so rounding on the way can move
    // its numbers from these. Each step moves a number by at most a rounding of the largest
    // size on the way, for the outline and for the walk alike. So a box from here is not the
    // walk's to the last bit: it holds the walk's, and is at most this slack larger.
    const slack =
      flat.depth > 0 || flat.rough
        ? ROUNDING * (6 * flat.depth + 9) * (stretch(matrix) * flat.size + reach(matrix))
        : 0;
    include(into, box[0] - slack, box[1] - slack);
    include(into, box[2] + slack, box[3] + slack);
  };

  const ownBlocks = blocks.length > 0 || xrefs?.size ? blocksByKey(blocks) : undefined;
  const top = { inside: undefined, inner: ownBlocks ?? new Map<string, Block>(), hidden: false };
  const fn = (entities: readonly Entity[]): [number, number, number, number] | undefined => {
    const box = empty();
    for (const e of filled(entities)) {
      if (over) break;
      boxing = e;
      if (e.kind !== "insert") {
        shape(e, false, own, (x, y) => include(box, x, y));
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
  return fn as Boxer;
}

function empty(): Bounds {
  return [Infinity, Infinity, -Infinity, -Infinity];
}

/** Points given one at a time, kept to what their outline needs as they come. */
function gathering(): { add: (x: number, y: number) => void; outline: () => Point[] } {
  let points: Point[] = [];
  let room = 4 * MOST_POINTS;
  return {
    add: (x, y) => {
      points.push([x, y]);
      if (points.length > room) {
        points = outline(points);
        room = Math.max(room, 2 * points.length);
      }
    },
    outline: () => outline(points),
  };
}

/** The outlines that keep fewer points than they bound, so a map of them may round lower. */
const ROUGH = new WeakSet<readonly Point[]>();

/** The units of mapping some points: one, and one for each 8. */
function units(points: readonly Point[]): number {
  return 1 + Math.ceil(points.length / 8);
}

/** The largest size of a number of some points. */
function sizeOf(points: readonly Point[]): number {
  let size = 0;
  for (const [x, y] of points) size = Math.max(size, Math.abs(x), Math.abs(y));
  return size;
}

/** How much a matrix's turn and scale can make a number larger. */
function stretch(m: Matrix): number {
  return Math.max(Math.abs(m[0]) + Math.abs(m[2]), Math.abs(m[1]) + Math.abs(m[3]));
}

/** The larger of a matrix's moves. */
function reach(m: Matrix): number {
  return Math.max(Math.abs(m[4]), Math.abs(m[5]));
}

/**
 * The points of `points` that bound them in every direction: those on their convex hull or
 * within a hair of it, so that a map of the plane takes the box of these to the box of them all
 * to the last bit, as a walk works each out. Past `most` it keeps the hull's corners alone, and
 * past that again the corners of their box, and the outline is `ROUGH`.
 */
function outline(points: Point[], most = Infinity): Point[] {
  if (points.length <= 4) return points;
  const finite: Point[] = [];
  // A number that is not finite draws nothing a box can hold; a few of them are kept as given.
  const odd: Point[] = [];
  for (const p of points) {
    if (Number.isFinite(p[0]) && Number.isFinite(p[1])) finite.push(p);
    else if (odd.length < 4) odd.push(p);
  }
  finite.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const sorted: Point[] = [];
  let size = 0;
  for (const p of finite) {
    const last = sorted.at(-1);
    if (last && Object.is(last[0], p[0]) && Object.is(last[1], p[1])) continue;
    sorted.push(p);
    size = Math.max(size, Math.abs(p[0]), Math.abs(p[1]));
  }
  if (sorted.length > 2) {
    const hair = size * 1e-12;
    const near = chain(
      sorted,
      (o, a, b) => turn(o, a, b) < -hair * Math.hypot(b[0] - o[0], b[1] - o[1]),
    );
    if (near.length <= most) return [...near, ...odd];
    const hull = chain(sorted, (o, a, b) => turn(o, a, b) <= 0);
    if (hull.length <= most) return rough([...hull, ...odd]);
    const [x0, y0, x1, y1] = sorted.reduce<Bounds>((box, [x, y]) => {
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
      return box;
    }, empty());
    return rough([[x0, y0], [x1, y0], [x1, y1], [x0, y1], ...odd]);
  }
  return [...sorted, ...odd];
}

function rough(points: Point[]): Point[] {
  ROUGH.add(points);
  return points;
}

/** Twice the area of the triangle `o`, `a`, `b`, above 0 when it turns counterclockwise. */
function turn(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/**
 * The lower and the upper chain of a hull of points sorted by x and then y, dropping a point
 * `a` between `o` and `b` when `drop` says it lies inside.
 */
function chain(sorted: readonly Point[], drop: (o: Point, a: Point, b: Point) => boolean): Point[] {
  const half = (from: number, to: number, step: number): Point[] => {
    const out: Point[] = [];
    for (let i = from; i !== to; i += step) {
      const p = sorted[i]!;
      while (out.length >= 2 && drop(out.at(-2)!, out.at(-1)!, p)) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(0, sorted.length, 1), ...half(sorted.length - 1, -1, -1)];
}
