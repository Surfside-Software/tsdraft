// Where an insert puts its block: the matrix that places the block's entities, the text each
// attribute of an insert is, and a walk over everything a drawing draws through its inserts.
import { alphaOf, entityTransparencyProblem } from "./transparency.ts";
import type {
  AttributeDefinition,
  Block,
  Drawing,
  Entity,
  Insert,
  Paragraph,
  ParagraphAttributeDefinition,
  Point,
  Rgb,
  Text,
  TextStyle,
  Xref,
} from "./drawing.ts";
import { isRgb } from "./colors.ts";
import { keyHandle } from "./handles.ts";
import { layerKey } from "./layers.ts";
import { STANDARD_FONT } from "./fonts.ts";
import { readableFifteenDigits, written } from "./format.ts";
import { layoutText } from "./measure.ts";
import {
  attributeTagProblem,
  blockNameProblem,
  idKey,
  idProblem,
  XREF_DEPTH,
  XREF_LOOKS,
} from "./rules.ts";
import { filled } from "./shape.ts";
import { isKeyed, isNumber, isObjectOrArray, isString } from "./guards.ts";

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

/** The handles of a block's record and of the two objects that open and close its definition. */
export interface BlockHandles {
  record: string;
  begin: string;
  end: string;
}

/**
 * The handles of a block's record and of the two objects that open and close its definition
 * in a DXF, for a name the block rules have passed.
 */
export function blockHandles(name: string): BlockHandles {
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
  /** For a definition of paragraph text, the paragraph the leading CAD app holds for it. */
  readonly paragraph?: PlacedAttributeParagraph;
}

/**
 * The paragraph an insert makes of a definition of paragraph text, placed at the attribute's
 * `at` and turned by its `rotation`, in the definition's text style. An insert that scales its
 * block unevenly sets the paragraph at its height in the insert, wraps it at the definition's
 * width times the share of its height that is left, and sets its characters at the attribute's
 * width factor, to four decimals, by a code before its value, in the place of the style's: the
 * leading CAD app slants none of them by the insert, and keeps the style's oblique angle.
 */
export interface PlacedAttributeParagraph {
  /** The width its lines wrap at, or undefined for none. */
  readonly width: number | undefined;
  /** The value as it is laid out, after the code of an uneven scale. */
  readonly value: string;
  /** True for an insert that scales its block unevenly. */
  readonly uneven: boolean;
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
  // A definition of paragraph text holds a text of no width factor or slant of its own: its
  // paragraph is drawn in its style's.
  const own = definition.kind === "paragraph" ? undefined : style;
  const widthFactor = written(own?.widthFactor ?? 1);
  const obliqueAngle = written(own?.obliqueAngle ?? 0);
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

  const placed = {
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

  if (definition.kind !== "paragraph") return placed;
  const uneven = Math.abs(written(sx)) !== Math.abs(written(sy));
  // A value or a width of the wrong type, which `lint` reports, is laid out as none.
  const given: unknown = definition.width;
  const width = isNumber(given) ? written(given) * rise : undefined;
  const text = isString(value) ? value : "";

  return {
    ...placed,
    paragraph: {
      width,
      value: uneven ? `\\W${placed.widthFactor.toFixed(4)};${text}` : text,
      uneven,
    },
  };
}

/**
 * True for a definition of paragraph text and an insert whose numbers `placeAttribute` can place.
 * A walk draws nothing of any other, which `lint` reports.
 */
export function placeable(definition: AttributeDefinition, insert: Insert): boolean {
  // A definition or an insert made by hand may hold a value of any type in any field.
  const point = (value: unknown): value is readonly [number, number] =>
    Array.isArray(value) && isNumber(value[0]) && isNumber(value[1]);

  return (
    point(definition.at) &&
    isNumber(definition.height) &&
    isNumber(definition.rotation) &&
    point(insert.at) &&
    (insert.scale === undefined ||
      (point(insert.scale) && written(insert.scale[0]) !== 0 && written(insert.scale[1]) !== 0)) &&
    (insert.rotation === undefined || isNumber(insert.rotation))
  );
}

/**
 * The paragraph an insert draws for a definition of paragraph text, in the insert's own
 * coordinates, or for a mirrored insert in the coordinates `placeAttribute` gives, where X runs
 * the other way. It reads the fields a paragraph has, so each placement costs the same whatever
 * else the definition holds.
 */
export function attributeParagraph(placed: PlacedAttribute): Paragraph | undefined {
  if (!placed.paragraph) return undefined;
  // A definition made by hand may hold any of these fields, which the paragraph keeps as it is.
  const from: GivenFields = placed.definition;
  const own = (field: (typeof PARAGRAPH_FIELDS)[number]) => Object.hasOwn(from, field);
  const { width } = placed.paragraph;

  const paragraph = {
    kind: "paragraph",
    ...(own("layer") && { layer: from.layer }),
    ...(own("style") && { style: from.style }),
    // A width the definition holds keeps its place, and the placed one's value.
    ...(own("width") && width !== undefined && { width }),
    ...(own("align") && { align: from.align }),
    ...(own("valign") && { valign: from.valign }),
    ...(own("lineSpacing") && { lineSpacing: from.lineSpacing }),
    ...(own("lineSpacingStyle") && { lineSpacingStyle: from.lineSpacingStyle }),
    at: placed.at,
    height: placed.height,
    rotation: placed.rotation,
    value: placed.paragraph.value,
    ...(!own("width") && width !== undefined && { width }),
  };

  // SAFETY: only a definition of paragraph text is placed with `paragraph`, and each field is
  // its own, as the paragraph it draws holds it.
  return paragraph as Paragraph;
}

/**
 * Where the text of a definition of paragraph text starts, or with `placed` the text of an
 * insert's attribute of one, in the coordinates `placeAttribute` gives, as the writers write it:
 * with 15 significant digits, and under 1e100, which the leading CAD app reads. That app holds
 * the text where a text of no value starts, worked out from the attribute's point as written,
 * and keeps that point from a DXF: the height below the point at the top, half of it in the
 * middle, and the font's descent above it at the bottom.
 *
 * @param style - The definition's text style, unless it is `Standard`.
 */
export function attributeTextStart(
  definition: ParagraphAttributeDefinition,
  style: TextStyle | undefined,
  placed?: PlacedAttribute,
): Point {
  const at = placed?.at ?? definition.at;
  const height = written(placed?.height ?? definition.height);
  const turn = written(placed?.rotation ?? definition.rotation) / (180 / Math.PI);
  const valign = definition.valign ?? "top";
  const up = layoutText({ value: "", height, font: style?.font ?? STANDARD_FONT, valign }).baseline;
  // Each part of the sum is under 1e100, but the sum need not be.
  const held = (n: number): number => Number(readableFifteenDigits(n));

  return [held(written(at[0]) - up * Math.sin(turn)), held(written(at[1]) + up * Math.cos(turn))];
}

/** The fields of a paragraph that a definition of paragraph text gives the one an insert draws. */
const PARAGRAPH_FIELDS = [
  "layer",
  "style",
  "width",
  "align",
  "valign",
  "lineSpacing",
  "lineSpacingStyle",
] as const;

/** The matrix that takes a mirrored attribute's coordinates, where X runs the other way, to the insert's. */
export const MIRRORED: Matrix = [-1, 0, 0, 1, 0, 0];

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

  return insert.attributes !== undefined && isString(tag) ? Math.floor(tag.length / 256) : 0;
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

/** True for an item of a list of entities that is an object, which a walk reads as an entity. */
function isEntity(item: unknown): item is Entity {
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
  // A definition made by hand may hold a text's own fields too, which the text keeps as it is.
  const from: GivenFields = definition;
  const own = (field: (typeof DRAWN_FIELDS)[number]) => Object.hasOwn(from, field);

  const text = {
    kind: "text",
    ...(own("id") && { id: from.id }),
    ...(own("layer") && { layer: from.layer }),
    ...(own("linetype") && { linetype: from.linetype }),
    ...(own("lineweight") && { lineweight: from.lineweight }),
    ...(own("at") && { at: from.at }),
    ...(own("height") && { height: from.height }),
    ...(own("rotation") && { rotation: from.rotation }),
    ...(own("style") && { style: from.style }),
    ...(own("align") && { align: from.align }),
    ...(own("valign") && { valign: from.valign }),
    value: attributeValue(insert, definition),
  };

  // SAFETY: each field is the definition's own, as the text it draws holds it.
  return text as Text;
}

/**
 * The fields of a text or a paragraph that an attribute definition made by hand may hold, each
 * as it gives it.
 */
interface GivenFields {
  readonly id?: unknown;
  readonly layer?: unknown;
  readonly linetype?: unknown;
  readonly lineweight?: unknown;
  readonly at?: unknown;
  readonly height?: unknown;
  readonly rotation?: unknown;
  readonly style?: unknown;
  readonly width?: unknown;
  readonly align?: unknown;
  readonly valign?: unknown;
  readonly lineSpacing?: unknown;
  readonly lineSpacingStyle?: unknown;
}

/**
 * The drawing an xref stands for, with the drawings its own xrefs stand for, by their names in
 * it. Only its attachments are drawn: the leading CAD app loads no overlay of a referenced
 * drawing.
 */
export interface XrefDrawing {
  readonly drawing: Drawing;
  readonly xrefs?: XrefDrawings;
  /**
   * The bytes of each raster file the drawing's images show, by the image's path as the drawing
   * gives it, which starts from the drawing's own folder. Without it, its images are drawn as
   * images whose files are missing.
   */
  readonly images?: Readonly<Record<string, Uint8Array>>;
}

/**
 * The drawing each xref stands for, by the xref's name: a `Drawing`, which draws none of its
 * own xrefs, or an `XrefDrawing`, which gives the drawings its attachments stand for.
 */
export type XrefDrawings = Readonly<Record<string, Drawing | XrefDrawing>>;

/** The most problems `referencedTree` names: past them it counts them. */
const XREF_PROBLEMS = 64;

/** A drawing that an xref stands for, under the xref's name in the drawing that references it. */
export interface Referenced {
  readonly name: string;
  readonly drawing: Drawing;
  /** The drawing's blocks, as `blocksByKey` gives them. */
  readonly blocks: ReadonlyMap<string, Block>;
  /** The drawings its attachments stand for, by `layerKey` of each xref's name. */
  readonly xrefs: ReadonlyMap<string, Referenced>;
  /** The files of its images, as its `XrefDrawing` gives them. */
  readonly images?: unknown;
}

/** A layer by its name: one of the drawing's own, or one of a drawing it references. */
export interface LayerRef {
  readonly name: string;
  /** The referenced drawing whose layer it is. Undefined for a layer of the drawing itself. */
  readonly of?: Referenced;
}

/**
 * Why a drawing given for an xref is not drawn: it stands for an overlay of a referenced
 * drawing, for a drawing the chain above it already draws, past `XREF_DEPTH` drawings down, or
 * it is neither a `Drawing` nor an `XrefDrawing`; or, with no chain, the names given inside
 * referenced drawings passed `XREF_LOOKS`, so no drawing below the drawing's own xrefs is drawn.
 */
export interface XrefProblem {
  readonly kind: "overlay" | "cycle" | "deep" | "many" | "shape";
  /** The names of the xrefs from one of the drawing's own down to the one not drawn. */
  readonly chain: readonly string[];
}

const NO_XREFS: ReadonlyMap<string, Referenced> = new Map();
const NO_VALUES: ReadonlyMap<string, readonly [name: string, value: unknown]> = new Map();
const NO_BLOCKS: ReadonlyMap<string, Block> = new Map();

/**
 * The longest name of a block, and so of an xref. A longer name names no xref the walk can find,
 * and is never a key of its maps, since V8 hashes a long string by its length alone.
 */
const LONGEST_NAME = 255;

/** The fields every drawing has, as a value given for an xref holds them before they are checked. */
interface DrawingFields {
  readonly layers?: unknown;
  readonly entities?: unknown;
  readonly units?: unknown;
}

/** The fields of an `XrefDrawing`, as a value given for an xref holds them before they are checked. */
interface XrefFields {
  readonly drawing?: unknown;
  readonly xrefs?: unknown;
  readonly images?: unknown;
}

/** True for a value with what every drawing has: a list of layers and of entities, and units. */
function drawingLike(value: unknown): value is Drawing {
  if (!isObjectOrArray(value)) return false;
  const { layers, entities, units }: DrawingFields = value;

  return Array.isArray(layers) && Array.isArray(entities) && isString(units);
}

/**
 * What a picture of `drawing` draws of the drawings given in `xrefs`: each drawing given for
 * one of its xrefs, and below it each drawing given for an attachment, as `toSVG` follows them,
 * by the xref's name. A drawing that draws none of its own xrefs is given alone. Giving the
 * result, or the result with drawings left out, draws the same, less what was left out.
 */
export function drawnXrefs(drawing: Drawing, xrefs: XrefDrawings | undefined): XrefDrawings {
  const out = (tree: ReadonlyMap<string, Referenced>): Record<string, Drawing | XrefDrawing> =>
    Object.fromEntries(
      [...tree.values()].map((r) => [
        r.name,
        r.xrefs.size > 0 || r.images !== undefined ? given(r) : r.drawing,
      ]),
    );

  const given = (r: Referenced): XrefDrawing => {
    const held: XrefDrawing =
      r.xrefs.size > 0 ? { drawing: r.drawing, xrefs: out(r.xrefs) } : { drawing: r.drawing };

    // SAFETY: the images given for a drawing are an object, which the pictures read each value
    // of as a file's bytes or as none.
    return r.images === undefined
      ? held
      : { ...held, images: r.images as Readonly<Record<string, Uint8Array>> };
  };

  return out(referencedTree(drawing, xrefs, () => NO_BLOCKS).xrefs);
}

/**
 * The drawings to draw for the xrefs of `drawing`, by `layerKey` of each xref's name, from
 * drawings given by name. A name that matches no xref of the drawing is left out.
 */
export function referencedByKey(
  drawing: Pick<Drawing, "xrefs">,
  given: XrefDrawings | undefined,
): Map<string, Referenced> {
  return referencedTree(drawing, given).xrefs;
}

/** The drawings to draw for a drawing's xrefs, and why any drawing given is not drawn. */
export interface ReferencedTree {
  readonly xrefs: Map<string, Referenced>;
  /** The first `XREF_PROBLEMS` problems. */
  readonly problems: XrefProblem[];
  /** How many more there were. */
  readonly unreported: number;
  /** How many of those were values that are no drawing. */
  readonly unreportedNonDrawings: number;
}

/**
 * The drawings to draw for the xrefs of `drawing`, as `referencedByKey` gives them, and why
 * any drawing given is not drawn. Inside a referenced drawing it follows an attachment and
 * never an overlay, as the leading CAD app loads one. A drawing already on the chain above,
 * `drawing` itself included, is a circular reference, which that app breaks, and is not drawn
 * again. It follows a chain `XREF_DEPTH` drawings down. Past `XREF_LOOKS` names looked for
 * inside referenced drawings it follows none: so a picture given a part of what was given cuts
 * nothing that the whole did not. It reads each object given, each list of xrefs and each
 * referenced drawing's blocks once.
 *
 * @param blocksOf - The blocks of a referenced drawing, `blocksByKey` unless they are not wanted.
 */
export function referencedTree(
  drawing: Pick<Drawing, "xrefs">,
  given: XrefDrawings | undefined,
  blocksOf: (drawing: Drawing) => ReadonlyMap<string, Block> = (d) => blocksByKey(d.blocks),
): ReferencedTree {
  const top = new Map<string, Referenced>();
  const problems: XrefProblem[] = [];
  let unreported = 0;
  /** How many of those past the first `XREF_PROBLEMS` are of the drawing's own xrefs. */
  let outside = 0;
  /** How many of those are values that are no drawing, of any xref and of the drawing's own. */
  let nonDrawings = 0;
  let outsideNonDrawings = 0;

  const note = (kind: XrefProblem["kind"], chain: readonly string[]): void => {
    if (problems.length < XREF_PROBLEMS) problems.push({ kind, chain });
    else {
      unreported++;

      if (kind === "shape") nonDrawings++;

      if (chain.length === 1) outside++;

      if (chain.length === 1 && kind === "shape") outsideNonDrawings++;
    }
  };

  if (given === undefined) return { xrefs: top, problems, unreported, unreportedNonDrawings: 0 };
  /** The values of an object given, by the key of each name, the last of a key kept. */
  const values = new WeakMap<object, ReadonlyMap<string, readonly [string, unknown]>>();

  const valuesOf = (open: Open): ReadonlyMap<string, readonly [string, unknown]> => {
    const from = open.given;

    if (!isKeyed(from)) return NO_VALUES;
    let found = values.get(from);

    if (!found) {
      const read = new Map<string, readonly [string, unknown]>();

      // A name too long to be an xref's is passed over before its value is read.
      for (const name of Object.keys(from)) {
        if (name.length > LONGEST_NAME) continue;
        read.set(layerKey(name), [name, from[name]]);
      }

      values.set(from, (found = read));
    }

    return found;
  };

  /**
   * The xrefs of a drawing, by key, the first of a key kept, as `findXref` finds them, read once
   * for each list, which copies of a drawing may share.
   */
  const xrefLists = new WeakMap<object, ReadonlyMap<string, Xref>>();

  const xrefsOf = (of: Pick<Drawing, "xrefs">): ReadonlyMap<string, Xref> => {
    // A drawing made by hand may give xrefs of any type, and any item in its list.
    const list = of.xrefs;

    if (!isObjectOrArray(list)) return new Map();
    let found = xrefLists.get(list);

    if (!found) {
      const read = new Map<string, Xref>();

      for (const xref of filled(list)) {
        const name: unknown = xref?.name;

        if (!isString(name) || name.length > LONGEST_NAME) continue;
        const key = layerKey(name);

        if (!read.has(key)) read.set(key, xref);
      }

      xrefLists.set(list, (found = read));
    }

    return found;
  };

  const blocks = new WeakMap<object, ReadonlyMap<string, Block>>();

  /** A drawing given, and the drawings its xrefs stand for, still to look through. */
  interface Open {
    readonly drawing: Pick<Drawing, "xrefs">;
    readonly given: unknown;
    readonly into: Map<string, Referenced>;
    readonly chain: readonly string[];
    /** The drawings above it, from `drawing` itself down. */
    readonly above: readonly object[];
  }

  const queue: Open[] = [{ drawing, given, into: top, chain: [], above: [drawing] }];
  let looks = 0;

  for (let at = 0; at < queue.length; at++) {
    const open = queue[at]!;
    const inside = open.chain.length > 0;
    const given = valuesOf(open);

    if (given.size === 0) continue;
    const listed = xrefsOf(open.drawing);

    for (const [key, [, value]] of given) {
      // The drawing's own xrefs are read once. What a referenced drawing is given may be shared
      // by many, so each name looked for there counts, and past the limit none is drawn.
      if (inside && ++looks > XREF_LOOKS) {
        for (const [name, referenced] of top) top.set(name, { ...referenced, xrefs: NO_XREFS });
        const outer = problems.filter((problem) => problem.chain.length === 1);

        return {
          xrefs: top,
          problems: [...outer, { kind: "many", chain: [] }],
          unreported: outside,
          unreportedNonDrawings: outsideNonDrawings,
        };
      }

      const xref = listed.get(key);

      if (xref === undefined || value === undefined) continue;
      const chain = [...open.chain, xref.name];

      // An xref of the drawing itself is drawn whatever it is, and one inside another only
      // when it is attached.
      if (inside && xref.attach !== true) {
        note("overlay", chain);
        continue;
      }

      const nested: XrefFields | undefined =
        isObjectOrArray(value) && "drawing" in value ? value : undefined;

      const found = nested ? nested.drawing : value;
      const inner = nested?.xrefs;
      const files = nested?.images;

      if (
        !drawingLike(found) ||
        (inner !== undefined && !isObjectOrArray(inner)) ||
        (files !== undefined && !isObjectOrArray(files))
      ) {
        note("shape", chain);
        continue;
      }

      if (open.above.includes(found)) {
        note("cycle", chain);
        continue;
      }

      if (chain.length > XREF_DEPTH) {
        note("deep", chain);
        continue;
      }

      const referenced = found;
      let held = blocks.get(referenced);

      if (!held) blocks.set(referenced, (held = blocksOf(referenced)));
      const into = inner === undefined ? undefined : new Map<string, Referenced>();

      const placed: Referenced = {
        name: xref.name,
        drawing: referenced,
        blocks: held,
        xrefs: into ?? NO_XREFS,
      };

      open.into.set(key, files === undefined ? placed : { ...placed, images: files });

      if (into) {
        queue.push({
          drawing: referenced,
          given: inner,
          into,
          chain,
          above: [...open.above, found],
        });
      }
    }
  }

  return { xrefs: top, problems, unreported, unreportedNonDrawings: nonDrawings };
}

/** The color of an insert that its entities set ByBlock take: its own, or its layer's. */
export type BlockColor = { readonly color: number | Rgb } | { readonly layer: LayerRef };

/**
 * The color an insert gives what its block sets ByBlock: its own index or true color, its layer's
 * when it is ByLayer, and the color of the insert that holds it when it is ByBlock.
 */
function insertColor(
  insert: Insert,
  layer: LayerRef,
  outer: BlockColor | undefined,
): BlockColor | undefined {
  const color: unknown = insert.color;

  if (color === "ByBlock") return outer;

  if (isNumber(color) || isRgb(color)) return { color };

  return { layer };
}

/**
 * The opacity an insert gives what its block sets ByBlock: its own, that of the insert that holds
 * it when it is ByBlock, and opaque when it is ByLayer, since a layer has no transparency.
 */
function insertAlpha(insert: Insert, outer: number | undefined): number | undefined {
  const own: unknown = insert.transparency;

  if (own === "ByBlock") return outer;

  return entityTransparencyProblem(own) === undefined && isNumber(own) ? alphaOf(own) : undefined;
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
  /**
   * The color an entity set `"ByBlock"` takes: the color of the insert that holds it, or its
   * layer's where the insert is ByLayer. Undefined in model space, where ByBlock draws as index 7.
   */
  readonly byBlock?: BlockColor | undefined;
  /**
   * The opacity, from 0 to 255, an entity set `"ByBlock"` takes: that of the insert that holds it.
   * Undefined in model space, where ByBlock draws opaque.
   */
  readonly byBlockAlpha?: number | undefined;
  /**
   * True in a block a leader places, which holds every entity ByBlock whatever it sets, as the
   * leading CAD app reads it.
   */
  readonly byBlockHeld?: boolean;
  /** For the text of an insert's attribute, the attribute's tag. */
  readonly attribute?: string;
  /**
   * The inserts the walk came through, the outermost first, each with the matrix of its
   * block's coordinates: given when `eachDrawn` is asked for them.
   */
  readonly inserts?: readonly { readonly insert: Insert; readonly matrix: Matrix }[];
  /**
   * True for an attribute of paragraph text an insert scales unevenly, whose value, with the code
   * before it, is no string the drawing holds: whatever lays it out pays as `made` says.
   */
  readonly made?: boolean;
}

/** A block the walk of an insert is in, and how far it has read it. */
interface Entered {
  readonly insert: Insert;
  readonly held: Block | Referenced;
  readonly items: readonly Entity[];
  readonly definitions: readonly AttributeDefinition[];
  readonly matrix: Matrix;
  /** The matrix of the space the insert is in, which an attribute of paragraph text is drawn with. */
  readonly outer: Matrix | undefined;
  /** The block's base point. */
  readonly base: Point | undefined;
  readonly layer: LayerRef;
  /** The color what the block sets ByBlock takes, and its opacity. */
  readonly byBlock: BlockColor | undefined;
  readonly byBlockAlpha: number | undefined;
  readonly byBlockHeld: boolean;
  readonly inside: Referenced | undefined;
  /** The blocks its inserts find theirs among. */
  readonly inner: ReadonlyMap<string, Block>;
  /** The next item to read: an entity until `entities` is false, then an attribute definition. */
  next: number;
  entities: boolean;
  /** The inserts the last item drawn holds, as `holding` gives them, and the next to enter. */
  queued?: { readonly inserts: readonly Insert[]; next: number } | undefined;
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
 * block, and any other on its own layer of the referenced drawing. Inside a referenced drawing an
 * insert of one of its attachments draws the drawing `referencedTree` gives for it, the same way,
 * and one of its overlays draws nothing, as that app loads no overlay of a referenced drawing. An
 * xref with no drawing given draws nothing. Each definition of paragraph text is drawn as the
 * paragraph `attributeParagraph` gives, in the coordinates of the space its insert is in.
 *
 * @param isFrozen - True for a layer that hides everything an insert on it draws: a frozen
 *   layer, and in a plot a layer that does not plot.
 * @param xrefs - The drawing of each xref, as `referencedByKey` gives them.
 * @param spend - Asked for 1 before the walk enters a block and before it reads each item of
 *   one. The walk ends when it says no.
 * @param key - `layerKey`, which the walk finds a block by.
 * @param holding - The inserts an entity a referenced drawing holds draws after itself, in that
 *   drawing's coordinates, as a table draws the block of each of its cells. Each is entered as
 *   any insert of that drawing is.
 * @param top - Told the index of each entity of the insert's own block or drawing as the walk
 *   reaches it, before what it draws.
 * @param withInserts - Gives each placement the inserts the walk came through, as `inserts`.
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
  holding?: (entity: Exclude<Entity, Insert>, placement: Placement) => readonly Insert[],
  heldByBlock?: (from: Referenced | undefined) => ReadonlySet<string>,
  top?: (index: number) => void,
  withInserts = false,
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
    byBlock: BlockColor | undefined,
    byBlockAlpha: number | undefined,
    byBlockHeld = false,
  ): boolean => {
    // An insert made by hand may name its block with a value of any type, and draws nothing.
    const named: unknown = insert.block;

    if (isFrozen(layer) || !isString(named)) return true;
    const name = key(named);
    const block = within.get(name);
    const referenced = block ? undefined : (from ? from.xrefs : xrefs)?.get(name);
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
      outer,
      base: block?.base,
      layer,
      byBlock: insertColor(insert, layer, byBlock),
      // An insert in a block a leader places is ByBlock, whatever it sets.
      byBlockAlpha: byBlockHeld ? byBlockAlpha : insertAlpha(insert, byBlockAlpha),
      byBlockHeld: block !== undefined && heldByBlock?.(from).has(name) === true,
      // What the insert holds names the layers, linetypes and text styles of this drawing.
      inside: referenced ?? from,
      inner: referenced ? referenced.blocks : within,
      next: 0,
      entities: true,
    });

    return true;
  };

  if (!enter(entity, blocks, undefined, undefined, { name: entity.layer }, undefined, undefined)) {
    return false;
  }

  // The inserts the walk is in, kept for the placements only when asked for.
  type Chain = readonly { readonly insert: Insert; readonly matrix: Matrix }[];

  let chain: Chain = [];
  let chainOf: Entered | undefined;

  const through = (at: Entered): Pick<Placement, "inserts"> => {
    if (!withInserts) return {};

    if (chainOf !== at) {
      chainOf = at;
      chain = stack.map(({ insert, matrix }) => ({ insert, matrix }));
    }

    return { inserts: chain };
  };

  while (stack.length > 0) {
    const at = stack.at(-1)!;
    const { inside } = at;

    const layerOf = (name: string): LayerRef =>
      name === "0" ? at.layer : inside ? { name, of: inside } : { name };

    // One at a time, so two that place one block do not find it open.
    if (at.queued !== undefined && at.queued.next < at.queued.inserts.length) {
      const insert = at.queued.inserts[at.queued.next++]!;

      if (
        !enter(
          insert,
          at.inner,
          inside,
          at.matrix,
          layerOf(insert.layer),
          at.byBlock,
          at.byBlockAlpha,
          at.byBlockHeld,
        )
      ) {
        return false;
      }

      continue;
    }

    if (at.entities && !holds(at.items, at.next)) [at.entities, at.next] = [false, 0];

    if (at.entities) {
      const item: unknown = at.items[at.next++];

      if (!spend(1)) return false;

      // Each entity the insert's own block or drawing holds starts with its index.
      if (stack.length === 1) top?.(at.next - 1);

      // An item that is no object, which `lint` reports, draws nothing.
      if (!isEntity(item)) continue;

      if (item.kind !== "insert") {
        const matrix = at.matrix;
        const layer = layerOf(item.layer);
        const { byBlock, byBlockAlpha } = at;

        const plain: Placement = {
          matrix,
          layer,
          insertLayer: at.layer,
          from: inside,
          byBlock,
          byBlockAlpha,
          ...through(at),
        };

        const placement: Placement = at.byBlockHeld ? { ...plain, byBlockHeld: true } : plain;

        draw(item, placement);

        if (inside !== undefined && holding !== undefined) {
          const inserts = holding(item, placement);
          at.queued = inserts.length > 0 ? { inserts, next: 0 } : undefined;
        }
      } else if (
        !enter(
          item,
          at.inner,
          inside,
          at.matrix,
          layerOf(item.layer),
          at.byBlock,
          at.byBlockAlpha,
          at.byBlockHeld,
        )
      ) {
        return false;
      }

      continue;
    }

    if (holds(at.definitions, at.next)) {
      const definition: unknown = at.definitions[at.next++];

      if (!isDefinition(definition)) {
        if (!spend(1)) return false;
        continue;
      }

      if (!spend(1 + lookupCost(at.insert, definition))) return false;

      if (definition.kind === "paragraph") {
        if (!placeable(definition, at.insert)) continue;
        const placed = placeAttribute(definition, undefined, at.insert, at.base);

        const flip = placed.mirrored
          ? at.outer
            ? compose(at.outer, MIRRORED)
            : MIRRORED
          : undefined;

        draw(attributeParagraph(placed)!, {
          matrix: flip ?? at.outer,
          layer: layerOf(definition.layer),
          insertLayer: at.layer,
          from: inside,
          byBlock: at.byBlock,
          byBlockAlpha: at.byBlockAlpha,
          attribute: definition.tag,
          made: placed.paragraph!.uneven,
          ...through(at),
        });
        continue;
      }

      draw(attributeText(at.insert, definition), {
        matrix: at.matrix,
        layer: layerOf(definition.layer),
        insertLayer: at.layer,
        from: inside,
        byBlock: at.byBlock,
        byBlockAlpha: at.byBlockAlpha,
        attribute: definition.tag,
        ...through(at),
      });
      continue;
    }

    open.delete(at.held);
    stack.pop();
  }

  return true;
}
