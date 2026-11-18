// Where an insert puts its block: the matrix that places the block's entities, the text each
// attribute of an insert is, and a walk over everything a drawing draws through its inserts.
import type {
  AttributeDefinition,
  Block,
  Drawing,
  Entity,
  Insert,
  Point,
  Text,
  TextStyle,
  Xref,
} from "./drawing.ts";
import { keyHandle } from "./handles.ts";
import { layerKey } from "./layers.ts";
import { written } from "./format.ts";
import { attributeTagProblem, blockNameProblem, idKey, idProblem } from "./rules.ts";
import { filled } from "./shape.ts";

/** A map of the plane: `x' = a x + c y + e` and `y' = b x + d y + f`. */
export type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

/**
 * A block's name as its handles are keyed: A to Z in lower case and nothing else changed, as
 * `idKey` treats an id. Two names with one key are one block to the leading CAD app, so the
 * duplicate rule refuses the second. No table that can grow is part of
 * this, and it must never change.
 */
function blockKey(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/**
 * The handles of a block's record and of the two objects that open and close its definition
 * in a DXF, for a name the block rules have passed.
 */
export function blockHandles(name: string): { record: string; begin: string; end: string } {
  const key = blockKey(name);
  return {
    record: keyHandle(`block:${key}`),
    begin: keyHandle(`block-begin:${key}`),
    end: keyHandle(`block-end:${key}`),
  };
}

/**
 * The handle of an attribute definition, for a name and a tag the rules have passed. A block
 * name holds no `/`, so the key is read one way only. The tag is taken as written: a block may
 * hold any two tags that differ at all.
 */
export function definitionHandle(block: string, tag: string): string {
  return keyHandle(`attdef:${blockKey(block)}/${tag}`);
}

/** The handle of an insert's attribute, for an id and a tag the rules have passed. */
export function insertAttributeHandle(insertId: string, tag: string): string {
  return keyHandle(`attrib:${idKey(insertId)}/${tag}`);
}

/** The handle of the object that ends an insert's attributes, for an id the rules have passed. */
export function insertEndHandle(insertId: string): string {
  return keyHandle(`attrib-end:${idKey(insertId)}`);
}

function valid(...problems: (string | undefined)[]): void {
  const problem = problems.find((p) => p !== undefined);
  if (problem !== undefined) throw new RangeError(problem);
}

/**
 * The handle of a block's record in an R2018 drawing. It comes from the block's name with A
 * to Z in lower case, so the block keeps it when the drawing around it changes.
 *
 * @throws RangeError when `name` is not a valid block name.
 */
export function blockHandle(name: string): string {
  valid(blockNameProblem(name));
  return blockHandles(name).record;
}

/**
 * The handle of a block's attribute definition, from the block's name and the tag.
 *
 * @throws RangeError when `block` is not a valid block name or `tag` not a valid tag.
 */
export function attributeDefinitionHandle(block: string, tag: string): string {
  valid(blockNameProblem(block), attributeTagProblem(tag));
  return definitionHandle(block, tag);
}

/**
 * The handle of the attribute with this tag on the insert with this id.
 *
 * @throws RangeError when `insertId` is not a valid id or `tag` not a valid tag.
 */
export function attributeHandle(insertId: string, tag: string): string {
  valid(idProblem(insertId), attributeTagProblem(tag));
  return insertAttributeHandle(insertId, tag);
}

/**
 * The handle of the object that closes the attributes of the insert with this id.
 *
 * @throws RangeError when `insertId` is not a valid id.
 */
export function attributesEndHandle(insertId: string): string {
  valid(idProblem(insertId));
  return insertEndHandle(insertId);
}

/**
 * The block an insert of this name places: the first whose name the leading CAD app's layer table
 * would take for the same, so `tree` finds `TREE`.
 */
export function findBlock(drawing: Pick<Drawing, "blocks">, name: string): Block | undefined {
  const key = layerKey(name);
  return filled(drawing.blocks).find((block) => layerKey(block.name) === key);
}

/**
 * The xref an insert of this name places, found as `findBlock` finds a block. A drawing has no
 * block and xref of one name, so at most one of the two finds something.
 */
export function findXref(drawing: Pick<Drawing, "xrefs">, name: string): Xref | undefined {
  const key = layerKey(name);
  return filled(drawing.xrefs).find((xref) => layerKey(xref.name) === key);
}

/** The matrix that takes a block's coordinates to where an insert puts them. */
export function insertMatrix(
  insert: Pick<Insert, "at" | "scale" | "rotation">,
  base: Point = [0, 0],
): Matrix {
  const [sx, sy] = insert.scale ?? [1, 1];
  const turn = ((insert.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const [a, b, c, d] = [sx * cos, sx * sin, -sy * sin, sy * cos];
  return [
    a,
    b,
    c,
    d,
    insert.at[0] - a * base[0] - c * base[1],
    insert.at[1] - b * base[0] - d * base[1],
  ];
}

/** The matrix that applies `inner` and then `outer`. */
export function compose(outer: Matrix, inner: Matrix): Matrix {
  const [a, b, c, d, e, f] = outer;
  return [
    a * inner[0] + c * inner[1],
    b * inner[0] + d * inner[1],
    a * inner[2] + c * inner[3],
    b * inner[2] + d * inner[3],
    a * inner[4] + c * inner[5] + e,
    b * inner[4] + d * inner[5] + f,
  ];
}

export function mapPoint(m: Matrix, p: Point): Point {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** An attribute of an insert, as the text the leading CAD app holds for it. */
export interface PlacedAttribute {
  readonly tag: string;
  readonly value: string;
  /**
   * The layer the attribute is stored on, which is its definition's. The leading CAD app's INSERT
   * leaves an attribute on layer `"0"` when its definition is there, and draws it as the insert's
   * layer draws.
   */
  readonly layer: string;
  /**
   * The point the text is justified to. For a mirrored insert it is in the coordinates
   * the leading CAD app holds a mirrored text in, where X runs the other way.
   */
  readonly at: Point;
  readonly height: number;
  /** Degrees counterclockwise. */
  readonly rotation: number;
  readonly widthFactor: number;
  /** Degrees to the right. */
  readonly obliqueAngle: number;
  /** True for an insert with one negative scale, which the leading CAD app holds with an extrusion of 0, 0, -1. */
  readonly mirrored: boolean;
  readonly definition: AttributeDefinition;
}

/**
 * What an insert makes of an attribute definition. The leading CAD app holds each attribute of an
 * insert as a text in the insert's own coordinates, with the height, rotation, width factor and
 * oblique angle that the insert's scale and rotation give the definition's. Every number is taken
 * as the writers write it, with 6 decimals, so the attribute lies where the file's insert, block
 * and definition put it.
 *
 * @param style - The definition's text style, unless it is `Standard`.
 */
export function placeAttribute(
  definition: AttributeDefinition,
  style: TextStyle | undefined,
  insert: Insert,
  base: Point | undefined,
): PlacedAttribute {
  const value = attributeValue(insert, definition);
  const [sx, sy] = insert.scale ?? [1, 1];
  // Only the numbers that place it are read, however many fields the insert has.
  const matrix = insertMatrix(
    {
      at: [written(insert.at[0]), written(insert.at[1])],
      scale: [written(sx), written(sy)],
      rotation: written(insert.rotation ?? 0),
    },
    base && [written(base[0]), written(base[1])],
  );
  const [x, y] = [written(definition.at[0]), written(definition.at[1])];
  const mirrored = matrix[0] * matrix[3] - matrix[1] * matrix[2] < 0;
  const [a, b, c, d, e, f] = mirrored
    ? [-matrix[0], matrix[1], -matrix[2], matrix[3], -matrix[4], matrix[5]]
    : matrix;
  const at: Point = [a * x + c * y + e, b * x + d * y + f];
  const widthFactor = written(style?.widthFactor ?? 1);
  const obliqueAngle = written(style?.obliqueAngle ?? 0);
  const height = written(definition.height);
  const turn = (written(definition.rotation) * Math.PI) / 180;
  const slant = Math.tan((obliqueAngle * Math.PI) / 180);
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
  // The text's baseline, one unit long, and its slanted upright, one height tall.
  const along: Point = [a * cos + c * sin, b * cos + d * sin];
  const up: Point = [
    a * (slant * cos - sin) + c * (slant * sin + cos),
    b * (slant * cos - sin) + d * (slant * sin + cos),
  ];
  const length = Math.hypot(along[0], along[1]);
  const rise = (along[0] * up[1] - along[1] * up[0]) / length;
  const run = (along[0] * up[0] + along[1] * up[1]) / length;
  return {
    tag: definition.tag,
    value,
    layer: definition.layer,
    at,
    mirrored,
    definition,
    height: height * rise,
    rotation: (Math.atan2(along[1], along[0]) * 180) / Math.PI,
    widthFactor: (widthFactor * length) / rise,
    obliqueAngle: (Math.atan2(run, rise) * 180) / Math.PI,
  };
}

/** The value an insert gives an attribute: its own for the tag, or the definition's default. */
export function attributeValue(insert: Insert, definition: AttributeDefinition): string {
  const set = insert.attributes;
  return set !== undefined && Object.hasOwn(set, definition.tag)
    ? set[definition.tag]!
    : definition.value;
}

/**
 * The units of looking an attribute's tag up among the values an insert holds, one for each 256
 * characters of the tag, since a lookup by a long name may take time in proportion to its length.
 */
export function lookupCost(insert: Insert, definition: AttributeDefinition): number {
  const tag: unknown = definition.tag;
  return insert.attributes !== undefined && typeof tag === "string"
    ? Math.floor(tag.length / 256)
    : 0;
}

/** The blocks of a drawing by name, as the leading CAD app looks a block up. */
export function blocksByKey(blocks: readonly Block[] | undefined): Map<string, Block> {
  const out = new Map<string, Block>();
  // The first of a name is the block, as it is for a layer.
  for (const block of filled(blocks)) {
    const key = layerKey(block.name);
    if (!out.has(key)) out.set(key, block);
  }
  return out;
}

/**
 * True for an item of a block's `attributes` that a walk reads as a definition: an object. Any
 * other item draws nothing, where `lint` reports it.
 */
export function isDefinition(item: unknown): item is AttributeDefinition {
  return typeof item === "object" && item !== null;
}

/** The fields of a text that an attribute definition gives the text an insert draws for it. */
const DRAWN_FIELDS = [
  "id",
  "layer",
  "linetype",
  "lineweight",
  "at",
  "height",
  "rotation",
  "style",
  "align",
  "valign",
] as const;

/**
 * An attribute definition as the text an insert draws for it, in the block's coordinates. It
 * reads the fields a text has, so each placement costs the same whatever else the definition
 * holds.
 */
export function attributeText(insert: Insert, definition: AttributeDefinition): Text {
  const text: Record<string, unknown> = { kind: "text" };
  const given = definition as unknown as Readonly<Record<string, unknown>>;
  for (const field of DRAWN_FIELDS) {
    if (Object.hasOwn(given, field)) text[field] = given[field];
  }
  text["value"] = attributeValue(insert, definition);
  return text as unknown as Text;
}

/** A drawing that an xref stands for, under the xref's name in the drawing that references it. */
export interface Referenced {
  readonly name: string;
  readonly drawing: Drawing;
  /** The drawing's blocks, as `blocksByKey` gives them. */
  readonly blocks: ReadonlyMap<string, Block>;
}

/** A layer by its name: one of the drawing's own, or one of a drawing it references. */
export interface LayerRef {
  readonly name: string;
  /** The referenced drawing whose layer it is. Undefined for a layer of the drawing itself. */
  readonly of?: Referenced;
}

/**
 * The drawings to draw for the xrefs of `drawing`, by `layerKey` of each xref's name, from
 * drawings given by name. A name that matches no xref of the drawing is left out.
 */
export function referencedByKey(
  drawing: Pick<Drawing, "xrefs">,
  given: Readonly<Record<string, Drawing>> | undefined,
): Map<string, Referenced> {
  const out = new Map<string, Referenced>();
  if (given === undefined) return out;
  const byKey = new Map(Object.keys(given).map((name) => [layerKey(name), given[name]!]));
  for (const xref of filled(drawing.xrefs)) {
    const key = layerKey(xref.name);
    const found = byKey.get(key);
    if (found !== undefined && !out.has(key)) {
      out.set(key, { name: xref.name, drawing: found, blocks: blocksByKey(found.blocks) });
    }
  }
  return out;
}

/** Where one entity is drawn. */
export interface Placement {
  /** The matrix from the entity's coordinates to the drawing's, or undefined in model space. */
  readonly matrix: Matrix | undefined;
  /** The layer the entity draws on: its own, or its insert's for an entity on layer `"0"`. */
  readonly layer: LayerRef;
  /**
   * The layer that the insert holding the entity draws on, which gives an entity its
   * `"ByBlock"` linetype and lineweight. Undefined in model space.
   */
  readonly insertLayer: LayerRef | undefined;
  /**
   * The referenced drawing the entity is in, whose linetypes and text styles are the ones it
   * names. Undefined for an entity of the drawing itself.
   */
  readonly from: Referenced | undefined;
  /** For the text of an insert's attribute, the attribute's tag. */
  readonly attribute?: string;
}

/** A block the walk of an insert is in, and how far it has read it. */
interface Entered {
  readonly insert: Insert;
  readonly held: Block | Referenced;
  readonly items: readonly Entity[];
  readonly definitions: readonly AttributeDefinition[];
  readonly matrix: Matrix;
  readonly layer: LayerRef;
  readonly inside: Referenced | undefined;
  /** The blocks its inserts find theirs among. */
  readonly inner: ReadonlyMap<string, Block>;
  /** The next item to read: an entity until `entities` is false, then an attribute definition. */
  next: number;
  entities: boolean;
}

/** True for an index of a list that holds an item, which is not an empty slot or past its end. */
function holds(list: readonly unknown[], index: number): boolean {
  return index < list.length && (index in list || list[index] !== undefined);
}

/**
 * Calls `draw` for everything an entity draws: the entity itself, or for an insert each entity
 * of its block and each of its attributes as a text, through every insert inside, in that
 * order. An insert of a block the drawing does not have, of a block that holds itself, or on a
 * layer `isFrozen` takes draws nothing, and the walk does not enter it. A list is read up to its
 * first empty slot. The walk keeps its own stack, so blocks nested any depth are walked.
 *
 * An insert of an xref draws the model space of the drawing given for it, as the leading CAD app
 * draws a loaded xref: an entity on layer `"0"` there draws as the insert's layer does, as in a
 * block, and any other on its own layer of the referenced drawing. The xrefs of a referenced
 * drawing are not drawn, as that app loads no overlay of an overlay. An xref with no drawing given
 * draws nothing.
 *
 * @param isFrozen - True for a layer that hides everything an insert on it draws: a frozen
 *   layer, and in a plot a layer that does not plot.
 * @param xrefs - The drawing of each xref, as `referencedByKey` gives them.
 * @param spend - Asked for 1 before the walk enters a block and before it reads each item of
 *   one. The walk ends when it says no.
 * @param key - `layerKey`, which the walk finds a block by.
 * @returns False when `spend` ended the walk.
 */
export function eachDrawn(
  entity: Entity,
  blocks: ReadonlyMap<string, Block>,
  isFrozen: (layer: LayerRef) => boolean,
  draw: (entity: Exclude<Entity, Insert>, placement: Placement) => void,
  xrefs?: ReadonlyMap<string, Referenced>,
  spend: (cost: number) => boolean = () => true,
  key: (name: string) => string = layerKey,
): boolean {
  if (entity.kind !== "insert") {
    draw(entity, {
      matrix: undefined,
      layer: { name: entity.layer },
      insertLayer: undefined,
      from: undefined,
    });
    return true;
  }
  const open = new Set<Block | Referenced>();
  const stack: Entered[] = [];
  /** Enters the block of an insert, when it draws anything. False when `spend` says no. */
  const enter = (
    insert: Insert,
    within: ReadonlyMap<string, Block>,
    from: Referenced | undefined,
    outer: Matrix | undefined,
    layer: LayerRef,
  ): boolean => {
    if (isFrozen(layer)) return true;
    const name = key(insert.block);
    const block = within.get(name);
    const referenced = block || from ? undefined : xrefs?.get(name);
    const held = block ?? referenced;
    if (!held || open.has(held)) return true;
    if (!spend(1)) return false;
    open.add(held);
    const own = insertMatrix(insert, block?.base);
    const items = block ? block.entities : referenced!.drawing.entities;
    const definitions = block?.attributes ?? [];
    stack.push({
      insert,
      held,
      items: Array.isArray(items) ? items : [],
      definitions: Array.isArray(definitions) ? definitions : [],
      matrix: outer ? compose(outer, own) : own,
      layer,
      // What the insert holds names the layers, linetypes and text styles of this drawing.
      inside: referenced ?? from,
      inner: referenced ? referenced.blocks : within,
      next: 0,
      entities: true,
    });
    return true;
  };
  if (!enter(entity, blocks, undefined, undefined, { name: entity.layer })) return false;
  while (stack.length > 0) {
    const at = stack.at(-1)!;
    const { inside } = at;
    const layerOf = (name: string): LayerRef =>
      name === "0" ? at.layer : inside ? { name, of: inside } : { name };
    if (at.entities && !holds(at.items, at.next)) [at.entities, at.next] = [false, 0];
    if (at.entities) {
      const item = at.items[at.next++]!;
      if (!spend(1)) return false;
      if (item.kind !== "insert") {
        draw(item, {
          matrix: at.matrix,
          layer: layerOf(item.layer),
          insertLayer: at.layer,
          from: inside,
        });
      } else if (!enter(item, at.inner, inside, at.matrix, layerOf(item.layer))) return false;
      continue;
    }
    if (holds(at.definitions, at.next)) {
      const definition: unknown = at.definitions[at.next++];
      if (!isDefinition(definition)) {
        if (!spend(1)) return false;
        continue;
      }
      if (!spend(1 + lookupCost(at.insert, definition))) return false;
      draw(attributeText(at.insert, definition), {
        matrix: at.matrix,
        layer: layerOf(definition.layer),
        insertLayer: at.layer,
        from: inside,
        attribute: definition.tag,
      });
      continue;
    }
    open.delete(at.held);
    stack.pop();
  }
  return true;
}
