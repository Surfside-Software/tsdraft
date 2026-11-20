// What a leader needs worked out: the keys of the handles of a leader style, of the dictionary
// that holds the styles and of an arrowhead's block, the sizes a leader is drawn with, and the
// shafts, arrowheads, landing and lines of its note that the leading CAD app draws.
import {
  DEFAULT_LEADER_ARROWHEAD,
  leaderArrowheadInfo,
  LEADER_ARROWHEADS,
  STANDARD_LEADER_STYLE,
  type LeaderArrowhead,
  type LeaderArrowheadInfo,
  type LeaderArrowheadStroke,
} from "./arrowheads.ts";
import { blockHandles } from "./blocks.ts";
import { maskOf } from "./fills.ts";
import { arrowheadEntityHandle } from "./dimensions.ts";
import type {
  Block,
  Drawing,
  Entity,
  Insert,
  Leader,
  LeaderAttachment,
  LeaderSide,
  LeaderStyle,
  LeaderVerticalAttachment,
  Paragraph,
  Point,
  TextStyle,
} from "./drawing.ts";
import { written } from "./format.ts";
import { keyHandle } from "./handles.ts";
import { layerKey } from "./layers.ts";
import { layoutParagraph, paragraphInStyle, placer } from "./paragraphs.ts";
import {
  LEADER_ATTACHMENTS,
  LEADER_SHAFT_LENGTH,
  leaderStyleNameProblem,
  pictureNumberProblem,
} from "./rules.ts";
import { filled, Strings } from "./shape.ts";

/** The shortest line of a note that `leaderRepeats` tells apart by its value. */
const LONG = 256;

/**
 * For the leaders of one call, what reading a leader again costs when it shares its list of
 * shafts, a shaft, its note, its block's values or a line of `LONG` characters or more with a
 * leader read before, as a drawing made in code may: a unit for each shaft, each point, each line,
 * tag and value, and one for each 32 characters a line, tag or value holds. 0 for a leader that shares none, whose lists the drawing holds.
 */
export function leaderRepeats(): (leader: Leader) => number {
  const lists = new WeakMap<object, { readonly cost: number; readonly shares: boolean }>();
  const shafts = new WeakSet<object>();
  const lines = new Strings<true>();
  /** What a list costs, worked out once, and whether it was read before or shares an item. */
  const read = (list: unknown, item: (value: unknown) => [number, boolean]): [number, boolean] => {
    if (typeof list !== "object" || list === null) return [0, false];
    const known = lists.get(list);
    if (known) return [known.cost, true];
    let cost = 0;
    let shares = false;
    for (const value of filled(list)) {
      const [more, again] = item(value);
      cost += more;
      shares ||= again;
    }
    lists.set(list, { cost, shares });
    return [cost, shares];
  };
  const shaft = (value: unknown): [number, boolean] => {
    if (typeof value !== "object" || value === null) return [1, false];
    const again = shafts.has(value);
    shafts.add(value);
    return [1 + (Array.isArray(value) ? value.length : 0), again];
  };
  const line = (value: unknown): [number, boolean] => {
    if (typeof value !== "string") return [1, false];
    // A line that took the place of another of its length counts as read before.
    const long = value.length >= LONG;
    const again = long && (lines.get(value) !== undefined || lines.clashes(value));
    if (long) lines.set(value, true);
    return [1 + Math.floor(value.length / 32), again];
  };
  // The values of a block in place of the note, by their tags, read once for each object: each
  // tag and value costs as a line does.
  const sets = new WeakMap<object, { readonly cost: number; readonly shares: boolean }>();
  const valuesOf = (set: unknown): [number, boolean] => {
    if (typeof set !== "object" || set === null) return [0, false];
    const known = sets.get(set);
    if (known) return [known.cost, true];
    let cost = 0;
    let shares = false;
    for (const [tag, value] of Object.entries(set)) {
      const [ofTag, sharedTag] = line(tag);
      const [ofValue, sharedValue] = line(value);
      cost += ofTag + ofValue;
      shares ||= sharedTag || sharedValue;
    }
    sets.set(set, { cost, shares });
    return [cost, shares];
  };
  return (leader) => {
    const [ofShafts, sharedShafts] = read(leader.shafts, shaft);
    const [ofFar, sharedFar] = read(leader.farShafts, shaft);
    const [ofText, sharedText] = read(leader.text, line);
    const [ofValues, sharedValues] = valuesOf(leader.attributes);
    return sharedShafts || sharedFar || sharedText || sharedValues
      ? ofShafts + ofFar + ofText + ofValues
      : 0;
  };
}

/**
 * A leader style's name as its handle is keyed: A to Z in lower case and nothing else changed,
 * as `idKey` treats an id. No table that can grow is part of this, and it must never change.
 */
function leaderStyleKey(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** `leaderStyleHandle` for a name the leader style rules have passed. */
export function validLeaderStyleHandle(name: string): string {
  return keyHandle(`leader-style:${leaderStyleKey(name)}`);
}

/**
 * The handle of a leader style in an R2018 drawing. It comes from the style's name with A to Z
 * in lower case, so the style keeps it when the drawing around it changes. `Standard`, the leading
 * CAD app's own style, which the writers add beside a drawing's own,
 * has the handle of its name too.
 *
 * @throws RangeError when `name` is not a valid name for a leader style.
 */
export function leaderStyleHandle(name: string): string {
  const problem = leaderStyleNameProblem(name);
  if (problem !== undefined) throw new RangeError(problem);
  return validLeaderStyleHandle(name);
}

/**
 * The handle of the dictionary that holds a drawing's leader styles, `ACAD_MLEADERSTYLE`, in an
 * R2018 drawing that has one. No id holds `:`, so no entity can take it.
 */
export function leaderStyleDictionaryHandle(): string {
  return keyHandle("dictionary:acad_mleaderstyle");
}

/** The name of the dictionary of leader styles, as the leading CAD app names it. */
export const LEADER_STYLE_DICTIONARY = "ACAD_MLEADERSTYLE";

/**
 * The handles of the block the leading CAD app draws a leader's arrowhead with, in an R2018
 * drawing: the block's record, the two objects that open and close its definition in a DXF, and
 * each entity it holds. They come from the block's name, so they are the same in every drawing: the
 * first entity has the key a dimension's arrowhead has, `arrowhead:NAME`, and each after it
 * `arrowhead:NAME/N`. Undefined for an arrowhead that has no block.
 *
 * @throws RangeError when `arrowhead` is not one of `LEADER_ARROWHEADS`.
 */
export function leaderArrowheadHandles(arrowhead: LeaderArrowhead):
  | {
      readonly record: string;
      readonly begin: string;
      readonly end: string;
      readonly strokes: readonly string[];
    }
  | undefined {
  const info = leaderArrowheadInfo(arrowhead);
  if (info === undefined) {
    throw new RangeError(
      `A leader's arrowhead must be one of ${Object.keys(LEADER_ARROWHEADS).join(", ")}`,
    );
  }
  if (info.block === undefined) return undefined;
  const block = info.block;
  return {
    ...blockHandles(block),
    strokes: (info.strokes ?? []).map((_, i) =>
      i === 0 ? arrowheadEntityHandle(block) : keyHandle(`arrowhead:${leaderStyleKey(block)}/${i}`),
    ),
  };
}

/** The arrowheads with a block that the drawing's leader styles use, each once. */
export function leaderArrowheadsWithBlocks(styles: readonly LeaderStyle[] | undefined): {
  readonly arrowhead: LeaderArrowhead;
  readonly block: string;
  readonly strokes: readonly LeaderArrowheadStroke[];
}[] {
  const used = new Map<string, LeaderArrowhead>();
  for (const style of styles ?? []) {
    const arrowhead = (style.arrowhead ?? DEFAULT_LEADER_ARROWHEAD) as LeaderArrowhead;
    const block = leaderArrowheadInfo(arrowhead)?.block;
    if (block !== undefined && !used.has(block)) used.set(block, arrowhead);
  }
  return [...used].map(([block, arrowhead]) => ({
    arrowhead,
    block,
    strokes: leaderArrowheadInfo(arrowhead)!.strokes ?? [],
  }));
}

/**
 * The leader style a leader of this name is in: the first whose name the leading CAD app would take
 * for the same, so `notes` finds `NOTES`. `Standard` is in no drawing's list.
 */
export function findLeaderStyle(
  drawing: Pick<Drawing, "leaderStyles">,
  name: string,
): LeaderStyle | undefined {
  const key = layerKey(name);
  return drawing.leaderStyles?.find((style) => layerKey(style.name) === key);
}

/** How many leaders a drawing has: those of model space and of every layout. A block holds none. */
export function leaderCount(drawing: Pick<Drawing, "entities" | "layouts">): number {
  let count = 0;
  for (const entities of [drawing.entities, ...(drawing.layouts ?? []).map((l) => l.entities)]) {
    for (const e of entities) if (e.kind === "leader") count++;
  }
  return count;
}

/**
 * The leading CAD app's own leader style, `Standard`, as the writers write it beside a drawing's
 * own: its sizes and its arrowhead are the ones that app gives the
 * style in a new drawing in inches.
 */
export const STANDARD_LEADER_STYLE_SIZES: LeaderStyle = {
  name: STANDARD_LEADER_STYLE,
  textHeight: 0.18,
  arrowSize: 0.18,
  landing: 0.36,
  gap: 0.09,
};

/** The sizes a leader is drawn with, in the units of its space, as the writers write them. */
export interface LeaderSizes {
  readonly textHeight: number;
  readonly arrowSize: number;
  readonly landing: number;
  readonly gap: number;
}

/**
 * The sizes a leader is drawn with, in the units of its space: its own where it has them, and
 * its style's where not, each times the style's scale. The writers write each with 6 decimals,
 * so each is taken as written.
 */
export function leaderSizes(
  leader: Pick<Leader, "textHeight" | "arrowSize" | "landing" | "gap">,
  style: LeaderStyle,
): LeaderSizes {
  const scale = written(style.scale ?? 1);
  const size = (own: number | undefined, styles: number): number =>
    written(written(own ?? styles) * scale);
  return {
    textHeight: size(leader.textHeight, style.textHeight),
    arrowSize: size(leader.arrowSize, style.arrowSize),
    landing: size(leader.landing, style.landing),
    gap: size(leader.gap, style.gap),
  };
}

/** Where the landing of a leader in this style meets the side of its note. */
export function leaderAttachment(
  leader: Pick<Leader, "attachment">,
  style: Pick<LeaderStyle, "attachment">,
): LeaderAttachment {
  return leader.attachment ?? style.attachment ?? "first-line";
}

/**
 * The bits a multileader holds for each property it sets itself, in place of its style's. A
 * multileader that the leading CAD app's MLEADER command draws has the three of
 * `LEADER_OWN_ALWAYS`.
 */
const OWN = {
  shaft: 1 << 0,
  gap: 1 << 5,
  landing: 1 << 7,
  arrowSize: 1 << 9,
  textStyle: 1 << 11,
  leftAttachment: 1 << 12,
  textHeight: 1 << 16,
  frame: 1 << 17,
  rightAttachment: 1 << 25,
  /** Set on every multileader whose note is above or below its point, as the CAD app's command sets it. */
  vertical: 1 << 26,
  direction: 1 << 27,
  topAttachment: 1 << 28,
  bottomAttachment: 1 << 29,
} as const;

/** The bits every multileader the writers write holds: its content, its text's alignment, and its text. */
const LEADER_OWN_ALWAYS = (1 << 10) | (1 << 14) | (1 << 18);
/** The bits every multileader whose content is a block holds: its content, the block, its scale and its rotation. */
const BLOCK_OWN_ALWAYS = (1 << 10) | (1 << 19) | (1 << 21) | (1 << 22);

/**
 * The flags of the properties a multileader sets itself, as the writers write them: the three
 * every one holds, and one for each size, text style and attachment the leader has of its own.
 * A leader's own attachment sets the attachment of both sides.
 */
export function leaderOwnFlags(
  leader: Pick<
    Leader,
    | "textStyle"
    | "textHeight"
    | "arrowSize"
    | "landing"
    | "gap"
    | "attachment"
    | "frame"
    | "side"
    | "verticalAttachment"
    | "width"
    | "shaft"
    | "block"
    | "text"
  >,
  style?: Pick<LeaderStyle, "direction" | "block">,
): number {
  let flags = leaderBlock(leader, style) === undefined ? LEADER_OWN_ALWAYS : BLOCK_OWN_ALWAYS;
  if (leader.gap !== undefined) flags |= OWN.gap;
  if (leader.landing !== undefined) flags |= OWN.landing;
  if (leader.arrowSize !== undefined) flags |= OWN.arrowSize;
  if (leader.textStyle !== undefined) flags |= OWN.textStyle;
  if (leader.textHeight !== undefined) flags |= OWN.textHeight;
  if (leader.attachment !== undefined) flags |= OWN.leftAttachment | OWN.rightAttachment;
  if (leader.frame !== undefined) flags |= OWN.frame;
  if (leader.shaft !== undefined) flags |= OWN.shaft;
  if (leader.verticalAttachment !== undefined) flags |= OWN.topAttachment | OWN.bottomAttachment;
  const vertical = leader.side === "above" || leader.side === "below";
  if (leader.side !== undefined && vertical !== (style?.direction === "vertical")) {
    flags |= OWN.direction;
  }
  if (
    leader.width === undefined &&
    (vertical || (leader.side === undefined && style?.direction === "vertical"))
  ) {
    flags |= OWN.vertical;
  }
  return flags;
}

/** How a multileader and its style number where the landing meets the side of the note. */
export function attachmentCode(attachment: LeaderAttachment): number {
  const code = LEADER_ATTACHMENTS.indexOf(attachment);
  return code < 0 ? 1 : code;
}

/** How a multileader and its style number where the landing meets a note above or below it. */
export function verticalAttachmentCode(attachment: LeaderVerticalAttachment): 9 | 10 {
  return attachment === "line" ? 10 : 9;
}

/**
 * The justification a multileader holds of its own, group 179, which its MTEXT's attachment, the
 * picture's `noteAttachment`, need not be: 1 left, 3 right, 8 and 2 for a note above and below,
 * and 1 for a note that wraps, as the leading CAD app holds one whose box was drawn.
 */
export function noteAttachmentPoint(side: LeaderSide, wraps: boolean): 1 | 2 | 3 | 8 {
  // A note that wraps holds it as the leading CAD app holds one whose box was drawn.
  if (wraps) return 1;
  return side === "right" ? 1 : side === "left" ? 3 : side === "above" ? 8 : 2;
}

/** One line of a leader's note, as the leading CAD app draws it. */
export interface LeaderLine {
  readonly value: string;
  /** Where its first character is placed, on its baseline. */
  readonly at: Point;
  readonly align: "left";
  /** The height of its capitals, in the units of the leader's space. */
  readonly height: number;
}

/** What the leading CAD app draws for a leader's arrowhead, where it draws it. */
export interface LeaderArrowheadDrawn {
  /** A filled triangle: the tip, then the two corners of its base. Empty but for a filled arrowhead. */
  readonly filled: readonly Point[];
  readonly lines: readonly (readonly [Point, Point])[];
  /** Each filled disk, by its center and radius. */
  readonly disks: readonly { readonly center: Point; readonly radius: number }[];
  /** Where the arrowhead's block goes and how it turns, for one with a block. */
  readonly insert?: { readonly at: Point; readonly rotation: number; readonly scale: number };
}

/**
 * What the leading CAD app draws for a leader, in the coordinates of the leader's space, with every
 * number of the leader and of its style taken as the writers write it, and the numbers a file
 * holds for it.
 */
export interface LeaderPicture {
  readonly sizes: LeaderSizes;
  readonly side: LeaderSide;
  readonly attachment: LeaderAttachment;
  readonly verticalAttachment: LeaderVerticalAttachment;
  /** True when the landing meets the note's top or bottom: a note above or below `at`. */
  readonly vertical: boolean;
  /** Where the shafts meet and the landing starts: `at`, as written. */
  readonly connection: Point;
  /**
   * Along X, the way the landing runs: 1 to the right, -1 to the left. For a note above, 1, and
   * below, -1, as the file holds it.
   */
  readonly direction: 1 | -1;
  /** Each shaft as the leading CAD app draws it: from where its arrowhead leaves it, through its bends, to `connection`. */
  readonly shafts: readonly (readonly Point[])[];
  /** Each shaft's arrowhead. None for an arrow size of 0. */
  readonly arrowheads: readonly LeaderArrowheadDrawn[];
  /** The landing, or undefined for a landing of 0, a note above or below, and curved shafts. */
  readonly landing?: readonly [Point, Point];
  /** Where the shafts of a second root on the note's far side meet, and the way its landing runs. */
  readonly farConnection?: Point;
  readonly farDirection?: 1 | -1;
  /** The second root's landing, as `landing` is the first's. */
  readonly farLanding?: readonly [Point, Point];
  /** True for shafts drawn as curves, each a list of points close enough to plot as the curve. */
  readonly curved: boolean;
  /**
   * The note: a paragraph of its lines joined by `\P`, held at `location` by the top left of its
   * box for a note on the right, the top right on the left, and the top center above or below.
   */
  readonly note: Paragraph;
  /** How the note is held at `location`: 1 top left, 2 top center, 3 top right, as an MTEXT. */
  readonly noteAttachment: 1 | 2 | 3;
  /** Where the note is held. */
  readonly location: Point;
  /** Where the file says the note's content starts: past the landing, before the note on the left. */
  readonly contentBase: Point;
  /** The note's box, `[left, bottom, right, top]`: its widest line across, its lines down. */
  readonly box: readonly [number, number, number, number];
  /** Each line its attachment draws under or over the note. */
  readonly underlines: readonly (readonly [Point, Point])[];
  /** The frame around the note, its lower left corner first and counterclockwise. */
  readonly frame?: readonly [Point, Point, Point, Point];
  /** The mask behind the note, its lower left corner first and counterclockwise, and its color: the background unless given. */
  readonly mask?: {
    readonly corners: readonly [Point, Point, Point, Point];
    readonly color?: number;
    /** How far it reaches past the note: its factor of the text height, less one, each side. */
    readonly factor: number;
  };
  /** The block in place of the note, as an insert of it, with its attributes. */
  readonly block?: Insert;
  /** Each line of the note, from the top, by its first run. */
  readonly lines: readonly LeaderLine[];
}

const RADIANS = Math.PI / 180;
/** How far below a line's baseline an attachment's underline runs, in text heights. */
const UNDERLINE = 0.2;
/** How far below the top of the note the first line's underline runs, in text heights. */
const FIRST_UNDERLINE = 1.2;

/** A block's own outline, as a block in place of a leader's note is placed by it. */
interface Outline {
  /** Its box, `[left, bottom, right, top]`, from its base point, or undefined when it draws nothing. */
  readonly box: readonly [number, number, number, number] | undefined;
  /** Where it crosses the level line through its base point: the least and the greatest X. */
  readonly crossing: readonly [number, number] | undefined;
}

const outlines = new WeakMap<object, Outline>();

/** An affine map of a point, `[a, b, c, d, e, f]`: x' = a x + c y + e, y' = b x + d y + f. */
type Affine = readonly [number, number, number, number, number, number];

const compose = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** A number of a block's data, or NaN for any other value, which the outline leaves out. */
const num = (value: unknown): number => (typeof value === "number" ? value : Number.NaN);

/** How many blocks deep the outline follows the inserts a block holds. */
const OUTLINE_DEPTH = 8;

/**
 * The outline of a block's lines, polylines, circles and arcs, and of the blocks it inserts, up to
 * `OUTLINE_DEPTH` deep, worked out once for each block: their box, and where they cross
 * the level line through the base point. Text takes no part, nor anything past the first
 * `OUTLINE_ITEMS` read at any depth.
 */
function outlineOf(block: Block, findBlock?: (name: string) => Block | undefined): Outline {
  const entities = block.entities as unknown;
  if (typeof entities !== "object" || entities === null)
    return { box: undefined, crossing: undefined };
  const known = outlines.get(block);
  if (known) return known;
  let box: [number, number, number, number] | undefined;
  let crossing: [number, number] | undefined;
  const add = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    box = box
      ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)]
      : [x, y, x, y];
  };
  const cross = (x: number): void => {
    if (!Number.isFinite(x)) return;
    crossing = crossing ? [Math.min(crossing[0], x), Math.max(crossing[1], x)] : [x, x];
  };
  const segment = (a: Point, b: Point): void => {
    add(a[0], a[1]);
    add(b[0], b[1]);
    if ((a[1] <= 0 && b[1] >= 0) || (a[1] >= 0 && b[1] <= 0)) {
      if (a[1] === b[1]) {
        cross(a[0]);
        cross(b[0]);
      } else cross(a[0] + ((b[0] - a[0]) * -a[1]) / (b[1] - a[1]));
    }
  };
  let read = 0;
  const open = new Set<Block>();
  const walk = (inner: Block, m: Affine, depth: number): void => {
    const map = (p: unknown): Point =>
      Array.isArray(p)
        ? [m[0] * num(p[0]) + m[2] * num(p[1]) + m[4], m[1] * num(p[0]) + m[3] * num(p[1]) + m[5]]
        : [Number.NaN, Number.NaN];
    // An arc as short chords, close enough to place a block by.
    const round = (center: unknown, r: number, from = 0, to = 360): void => {
      if (!Array.isArray(center)) return;
      const sweep = (((to - from) % 360) + 360) % 360 || 360;
      const steps = 64;
      let last: Point | undefined;
      for (let i = 0; i <= steps; i++) {
        const t = ((from + (sweep * i) / steps) * Math.PI) / 180;
        const p = map([num(center[0]) + r * Math.cos(t), num(center[1]) + r * Math.sin(t)]);
        if (last) segment(last, p);
        last = p;
      }
    };
    // A side with a bulge as the arc it is: a quarter of its turn's tangent, counterclockwise when above 0.
    const bulged = (a: unknown, b: unknown, bulge: number): void => {
      if (!Array.isArray(a) || !Array.isArray(b)) return;
      const [ax, ay, bx, by] = [num(a[0]), num(a[1]), num(b[0]), num(b[1])];
      const turn = 4 * Math.atan(bulge);
      const [dx, dy] = [bx - ax, by - ay];
      const chord = Math.hypot(dx, dy);
      if (!(chord > 0)) return;
      // The center is off the chord's middle, to its left, by half the chord times cot(turn / 2).
      const off = ((1 - bulge * bulge) / (2 * bulge)) * (chord / 2);
      const [cx, cy] = [(ax + bx) / 2 - (dy / chord) * off, (ay + by) / 2 + (dx / chord) * off];
      const r = Math.hypot(ax - cx, ay - cy);
      const from = Math.atan2(ay - cy, ax - cx);
      const steps = 32;
      let last = map([ax, ay]);
      for (let i = 1; i <= steps; i++) {
        const t = from + (turn * i) / steps;
        const p = map([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
        segment(last, p);
        last = p;
      }
    };
    open.add(inner);
    for (const e of filled(inner.entities as readonly Entity[])) {
      if (++read > OUTLINE_ITEMS) break;
      if (typeof e !== "object" || e === null) continue;
      if (e.kind === "line") segment(map(e.from), map(e.to));
      else if (e.kind === "polyline") {
        const points = filled(e.points).slice(0, OUTLINE_ITEMS);
        const bulges = filled(e.bulges);
        read += points.length;
        const sides = e.closed && points.length > 2 ? points.length : points.length - 1;
        for (let i = 0; i < sides; i++) {
          const [a, b] = [points[i]!, points[(i + 1) % points.length]!];
          const bulge = num(bulges[i] ?? 0);
          if (!bulge || !Number.isFinite(bulge)) segment(map(a), map(b));
          else bulged(a, b, bulge);
        }
      } else if (e.kind === "circle") round(e.center, num(e.radius));
      else if (e.kind === "arc") round(e.center, num(e.radius), num(e.startAngle), num(e.endAngle));
      else if (e.kind === "insert" && depth < OUTLINE_DEPTH && typeof e.block === "string") {
        const nested = findBlock?.(e.block);
        if (nested === undefined || open.has(nested)) continue;
        const [sx, sy] = Array.isArray(e.scale) ? e.scale : [1, 1];
        const turn = ((num(e.rotation ?? 0) || 0) * Math.PI) / 180;
        const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
        const [bx, by] = Array.isArray(nested.base) ? nested.base : [0, 0];
        const [ax, ay] = Array.isArray(e.at) ? e.at : [0, 0];
        // Its block's base point to its point, scaled and turned.
        const placed: Affine = [
          cos * num(sx),
          sin * num(sx),
          -sin * num(sy),
          cos * num(sy),
          num(ax) - (cos * num(sx) * num(bx) - sin * num(sy) * num(by)),
          num(ay) - (sin * num(sx) * num(bx) + cos * num(sy) * num(by)),
        ];
        walk(nested, compose(m, placed), depth + 1);
      }
    }
    open.delete(inner);
  };
  const [bx, by] = Array.isArray(block.base) ? block.base : [0, 0];
  walk(block, [1, 0, 0, 1, -num(bx), -num(by)], 0);
  const outline = { box, crossing };
  outlines.set(block, outline);
  return outline;
}

/** How many entities of a block, and points of a polyline, the outline reads. */
const OUTLINE_ITEMS = 4096;

/** How many straight pieces each span of a curved shaft is drawn with. */
const CURVE_PIECES = 32;

/**
 * A curved shaft as the leading CAD app draws one, as points close enough to plot as the curve:
 * the cubic through `fit` with knots spaced by the distance between its points, which leaves its
 * first point along `start` and meets its last along `end`, each a unit vector and each its
 * derivative there. Two points of the fit at one place count once.
 */
export function curveThrough(fit: readonly Point[], start: Point, end: Point): Point[] {
  const q: Point[] = [];
  for (const p of fit) {
    const last = q[q.length - 1];
    if (last === undefined || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0) q.push(p);
  }
  if (q.length < 2) return [...q];
  const n = q.length - 1;
  const u = [0];
  for (let k = 1; k <= n; k++)
    u.push(u[k - 1]! + Math.hypot(q[k]![0] - q[k - 1]![0], q[k]![1] - q[k - 1]![1]));
  const total = u[n]!;
  // The knots: four at each end, and each inner point's distance along the fit.
  const knots = [0, 0, 0, 0, ...u.slice(1, n), total, total, total, total];
  // The control points: the ends, the two that set the derivatives there, and the rest solved
  // so that the curve passes through each inner point, a system of three diagonals.
  const p: Point[] = Array.from({ length: n + 3 }, (): Point => [0, 0]);
  p[0] = q[0]!;
  p[1] = [q[0]![0] + (knots[4]! / 3) * start[0], q[0]![1] + (knots[4]! / 3) * start[1]];
  p[n + 2] = q[n]!;
  p[n + 1] = [
    q[n]![0] - ((total - knots[n + 2]!) / 3) * end[0],
    q[n]![1] - ((total - knots[n + 2]!) / 3) * end[1],
  ];
  if (n > 1) {
    // Row k, for the inner point k, holds the weights of control points k, k + 1 and k + 2.
    const rows = [];
    for (let k = 1; k < n; k++) rows.push(basisAt(knots, k + 3, u[k]!));
    const unknown = n - 1;
    const a = rows.map((r) => r[0]);
    const b = rows.map((r) => r[1]);
    const c = rows.map((r) => r[2]);
    const dx = rows.map((_, i) => q[i + 1]![0]);
    const dy = rows.map((_, i) => q[i + 1]![1]);
    // The known control points move to the right side.
    dx[0]! -= a[0]! * p[1]![0];
    dy[0]! -= a[0]! * p[1]![1];
    dx[unknown - 1]! -= c[unknown - 1]! * p[n + 1]![0];
    dy[unknown - 1]! -= c[unknown - 1]! * p[n + 1]![1];
    for (let i = 1; i < unknown; i++) {
      const m = a[i]! / b[i - 1]!;
      b[i]! -= m * c[i - 1]!;
      dx[i]! -= m * dx[i - 1]!;
      dy[i]! -= m * dy[i - 1]!;
    }
    const xs: number[] = Array.from({ length: unknown }, () => 0);
    const ys: number[] = Array.from({ length: unknown }, () => 0);
    xs[unknown - 1] = dx[unknown - 1]! / b[unknown - 1]!;
    ys[unknown - 1] = dy[unknown - 1]! / b[unknown - 1]!;
    for (let i = unknown - 2; i >= 0; i--) {
      xs[i] = (dx[i]! - c[i]! * xs[i + 1]!) / b[i]!;
      ys[i] = (dy[i]! - c[i]! * ys[i + 1]!) / b[i]!;
    }
    for (let i = 0; i < unknown; i++) p[i + 2] = [xs[i]!, ys[i]!];
  }
  // Each span cut into pieces, by de Boor's evaluation.
  const out: Point[] = [q[0]!];
  for (let span = 3; span < n + 3; span++) {
    const [from, to] = [knots[span]!, knots[span + 1]!];
    if (!(to > from)) continue;
    for (let i = 1; i <= CURVE_PIECES; i++) {
      const t = from + ((to - from) * i) / CURVE_PIECES;
      const d: Point[] = [p[span - 3]!, p[span - 2]!, p[span - 1]!, p[span]!];
      for (let r = 1; r <= 3; r++) {
        for (let j = 3; j >= r; j--) {
          const left = knots[span - 3 + j]!;
          const right = knots[span + 1 + j - r]!;
          const alpha = right > left ? (t - left) / (right - left) : 0;
          d[j] = [
            (1 - alpha) * d[j - 1]![0] + alpha * d[j]![0],
            (1 - alpha) * d[j - 1]![1] + alpha * d[j]![1],
          ];
        }
      }
      out.push(i === CURVE_PIECES && span === n + 2 ? q[n]! : d[3]!);
    }
  }
  return out;
}

/**
 * The three cubic B-spline weights not 0 at the knot `knots[span]`, which `t` is: of control
 * points span - 3, span - 2 and span - 1.
 */
function basisAt(knots: readonly number[], span: number, t: number): [number, number, number] {
  const left = [0, 0, 0, 0];
  const right = [0, 0, 0, 0];
  const n = [1, 0, 0, 0];
  for (let j = 1; j <= 3; j++) {
    left[j] = t - knots[span + 1 - j]!;
    right[j] = knots[span + j]! - t;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const denominator = right[r + 1]! + left[j - r]!;
      const temp = denominator === 0 ? 0 : n[r]! / denominator;
      n[r] = saved + right[r + 1]! * temp;
      saved = left[j - r]! * temp;
    }
    n[j] = saved;
  }
  // At a knot, the weight of control point span is 0.
  return [n[0]!, n[1]!, n[2]!];
}

/**
 * The side of `at` a leader's note is on: its own, or else, in a horizontal style, the side away
 * from the first shaft's last point before `at`, right when `at` is not to the left of it, and in
 * a vertical one, above when `at` is not below it, as written. A list is read up to its first
 * empty slot.
 */
export function leaderSide(
  leader: Pick<Leader, "side" | "at" | "shafts">,
  style?: Pick<LeaderStyle, "direction">,
): LeaderSide {
  if (leader.side !== undefined) return leader.side;
  const shaft = filled(filled(leader.shafts)[0]);
  const before = shaft[shaft.length - 1];
  if (style?.direction === "vertical") {
    return before === undefined || written(leader.at[1]) >= written(before[1]) ? "above" : "below";
  }
  return before === undefined || written(leader.at[0]) >= written(before[0]) ? "right" : "left";
}

/** Where the landing of a leader in this style meets a note above or below it. */
export function leaderVerticalAttachment(
  leader: Pick<Leader, "verticalAttachment">,
  style: Pick<LeaderStyle, "verticalAttachment">,
): LeaderVerticalAttachment {
  return leader.verticalAttachment ?? style.verticalAttachment ?? "center";
}

/**
 * The block a leader holds in place of a note: its own, or its style's for a leader with no note
 * of its own, or undefined for a leader whose content is its note.
 */
export function leaderBlock(
  leader: Pick<Leader, "block" | "text">,
  style: Pick<LeaderStyle, "block"> | undefined,
): unknown {
  return leader.block ?? (leader.text === undefined ? style?.block : undefined);
}

/** The note of a leader as the paragraph it is laid out as, before it is placed. */
export function leaderNote(
  leader: Pick<Leader, "text" | "width" | "layer">,
  sizes: LeaderSizes,
  scale: number,
  textStyleName: string | undefined,
  attachment?: LeaderAttachment,
): Omit<Paragraph, "at" | "align"> {
  const width = leader.width === undefined ? undefined : written(written(leader.width) * scale);
  // A note underlined line by line holds the code that underlines it, as the leading CAD app's does.
  const underlined = attachment === "underline-all" ? "\\L" : "";
  return {
    kind: "paragraph",
    layer: leader.layer,
    value: underlined + filled(leader.text).join("\\P"),
    height: sizes.textHeight,
    rotation: 0,
    ...(width === undefined ? {} : { width }),
    ...(textStyleName === undefined ? {} : { style: textStyleName }),
  };
}

/**
 * What the leading CAD app draws for a leader in a style, for a leader and a style the rules have
 * passed. Each shaft runs from its tip through its bends to `at`, and the arrowhead at its tip
 * points along the shaft's first segment: that app stops the shaft one arrow size short of the tip,
 * and the arrowhead draws the rest, but for the arrowhead `"none"`, whose shaft runs to the tip.
 * The landing runs level from `at`, as long as the leader's landing, to the side the note is on.
 * The note is a paragraph laid out by `layoutParagraph`, its lines set by their ink: a gap past the
 * landing's end, justified left on the right and right on the left, as high as its attachment
 * puts it; or a gap above or below `at`, centered on it. Each list is read up to its first empty
 * slot.
 *
 * @param textStyle - The text style of the leader's note, unless it is `Standard`.
 */
export function leaderPicture(
  leader: Leader,
  style: LeaderStyle,
  textStyle?: TextStyle,
  findBlock?: (name: string) => Block | undefined,
): LeaderPicture {
  const sizes = leaderSizes(leader, style);
  const side = leaderSide(leader, style);
  const attachment = leaderAttachment(leader, style);
  const verticalAttachment = leaderVerticalAttachment(leader, style);
  const vertical = side === "above" || side === "below";
  const direction = side === "right" || side === "above" ? 1 : -1;
  const point = (p: Point): Point => [written(p[0]), written(p[1])];
  const connection = point(leader.at);
  // An arrowhead the rules refuse is drawn as the default.
  const info: LeaderArrowheadInfo =
    leaderArrowheadInfo(style.arrowhead ?? DEFAULT_LEADER_ARROWHEAD) ??
    LEADER_ARROWHEADS[DEFAULT_LEADER_ARROWHEAD];
  const size = sizes.arrowSize;

  const shafts: Point[][] = [];
  const arrowheads: LeaderArrowheadDrawn[] = [];
  const curved = (leader.shaft ?? style.shaft) === "curved";
  /**
   * Draws each shaft of a root from its tip to `end`: straight through its bends, or as a curve
   * through them that meets `end` level, along `level`.
   */
  const draw = (list: unknown, end: Point, level: number): void => {
    for (const shaft of filled(list)) {
      const listed = filled(shaft);
      // A shaft with no tip, which the rules refuse, draws nothing.
      if (listed.length === 0) continue;
      const points = [...(listed as readonly Point[]).map(point), end];
      const [tip, next] = [points[0]!, points[1]!];
      const length = Math.hypot(tip[0] - next[0], tip[1] - next[1]);
      // The way the arrowhead points: from the shaft's next point to its tip.
      const along: Point =
        length > 0 ? [(tip[0] - next[0]) / length, (tip[1] - next[1]) / length] : [1, 0];
      const across: Point = [-along[1], along[0]];
      const place = ([x, y]: readonly [number, number]): Point => [
        tip[0] + (along[0] * x + across[0] * y) * size,
        tip[1] + (along[1] * x + across[1] * y) * size,
      ];
      // A curve whose first stretch is shorter than the arrowhead has no room for one, and runs to
      // its tip. A straight shaft keeps its arrowhead, as no case has shown otherwise.
      const room = size > 0 && (!curved || length >= size);
      if (room) {
        const drawn: {
          filled: Point[];
          lines: [Point, Point][];
          disks: { center: Point; radius: number }[];
        } = { filled: [], lines: [], disks: [] };
        if (info.block === undefined) {
          drawn.filled.push(tip, place([-1, 1 / 6]), place([-1, -1 / 6]));
        }
        for (const stroke of info.strokes ?? []) {
          if (stroke.kind === "line") drawn.lines.push([place(stroke.from), place(stroke.to)]);
          else {
            // Two half circles about the middle of its two points, as wide as its width.
            const [a, b] = [stroke.points[0]!, stroke.points[1]!];
            const radius = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 + stroke.width / 2;
            drawn.disks.push({
              center: place([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]),
              radius: radius * size,
            });
          }
        }
        const turned = (((Math.atan2(along[1], along[0]) / RADIANS) % 360) + 360) % 360;
        arrowheads.push({
          ...drawn,
          ...(info.block === undefined
            ? {}
            : { insert: { at: tip, rotation: turned, scale: size } }),
        });
      }
      const start: Point = info.toTip || !room ? tip : place([-1, 0]);
      shafts.push(
        curved
          ? curveThrough([start, ...points.slice(1)], [-along[0], -along[1]], [level, 0])
          : [start, ...points.slice(1)],
      );
    }
  };
  const h = sizes.textHeight;
  // A vertical note that wraps is held by its top left, as the leading CAD app holds one whose
  // box was drawn.
  const wraps = leader.width !== undefined;
  const noteAttachment = vertical ? (wraps ? 1 : 2) : side === "right" ? 1 : 3;
  const align = noteAttachment === 1 ? "left" : noteAttachment === 2 ? "center" : "right";
  const unplaced = leaderNote(
    leader,
    sizes,
    written(style.scale ?? 1),
    leader.textStyle ?? style.textStyle,
    vertical ? undefined : attachment,
  );
  // A style whose font or width the rules refuse is laid out as `Standard`'s.
  const layout = layoutParagraph(
    paragraphInStyle({ ...unplaced, at: [0, 0], align }, textStyle ?? {}),
  );
  const lines = layout.lines;
  const [, bottom, , top0] = layout.frame;
  // How far the note reaches across: its widest line's ink.
  let wide = 0;
  for (const line of lines) wide = Math.max(wide, line.end - line.start);
  const lastBaseline = lines[lines.length - 1]?.baseline ?? -h;
  // The height the leading CAD app takes a line of the note to have: its capitals, and how far
  // the last line's letters reach below its baseline.
  const line = h + Math.max(0, lastBaseline - bottom);

  // A block in place of the note: its outline meets the landing's end, level with `at`.
  const content = leaderBlock(leader, style);
  const found = typeof content === "string" ? findBlock?.(content) : undefined;
  let held:
    | {
        readonly insert: Insert;
        readonly box: readonly [number, number, number, number];
        /** Where its outline starts along the landing's line. */
        readonly start: number;
      }
    | undefined;
  if (found !== undefined) {
    const outline = outlineOf(found, findBlock);
    const s = written(style.blockScale ?? 1) * written(style.scale ?? 1);
    const end = connection[0] + direction * sizes.landing;
    const ext = outline.box ?? [0, 0, 0, 0];
    const byInsertion = style.blockConnection === "insertion" && outline.crossing !== undefined;
    const [near, far] = byInsertion ? outline.crossing! : [ext[0], ext[2]];
    const x = end - (side === "left" ? far : near) * s;
    const y = byInsertion ? connection[1] : connection[1] - ((ext[1] + ext[3]) / 2) * s;
    const attributes = leader.attributes;
    held = {
      insert: {
        kind: "insert",
        layer: leader.layer,
        block: found.name,
        at: point([x, y]),
        ...(s === 1 ? {} : { scale: [s, s] as const }),
        ...(attributes === undefined ? {} : { attributes }),
      },
      box: [x + ext[0] * s, y + ext[1] * s, x + ext[2] * s, y + ext[3] * s],
      start: x + near * s,
    };
  }
  let location: Point;
  let contentBase: Point;
  const underlines: [Point, Point][] = [];
  const landing: readonly [Point, Point] | undefined =
    !vertical && !curved && sizes.landing > 0
      ? [connection, [connection[0] + direction * sizes.landing, connection[1]]]
      : undefined;
  if (vertical) {
    const x = connection[0] - (noteAttachment === 1 ? wide / 2 : 0);
    if (side === "above") {
      location = [x, connection[1] + sizes.gap - bottom];
      contentBase = connection;
    } else {
      location = [x, connection[1] - sizes.gap];
      contentBase = [connection[0], location[1] + bottom - sizes.gap];
    }
    if (verticalAttachment === "line") {
      underlines.push([
        [connection[0] - wide / 2, connection[1]],
        [connection[0] + wide / 2, connection[1]],
      ]);
    }
  } else {
    const x = connection[0] + direction * (sizes.landing + sizes.gap);
    // How far the top of the note is above `at`, for each attachment.
    const above: Record<LeaderAttachment, number> = {
      "top-of-first": 0,
      "first-line": line / 2,
      middle: -bottom / 2,
      "last-line": -bottom - line / 2,
      "bottom-of-last": -bottom,
      "underline-last": -lastBaseline + UNDERLINE * h,
      "underline-first": FIRST_UNDERLINE * h,
      "bottom-of-first": line,
      "underline-all": FIRST_UNDERLINE * h,
    };
    location = [x, connection[1] + above[attachment]];
    contentBase =
      side === "right"
        ? [connection[0] + direction * sizes.landing, connection[1]]
        : [x - wide - sizes.gap, connection[1]];
    const from = connection[0] + direction * sizes.landing;
    const far = x + direction * wide;
    // The landing runs on under the line it meets, but not into a frame: to the note's far side,
    // or to the end of the far root's landing.
    if (attachment.startsWith("underline") && !(leader.frame ?? style.frame ?? false)) {
      const reach =
        filled(leader.farShafts).length > 0 ? far + direction * (sizes.gap + sizes.landing) : far;
      underlines.push([
        [from, connection[1]],
        [reach, connection[1]],
      ]);
    }
  }

  if (held) {
    location = held.insert.at;
    contentBase = [held.start, connection[1]];
    underlines.length = 0;
  }
  // Every point the file holds, as the writers write it.
  location = point(location);
  contentBase = point(contentBase);
  // A second root on the note's far side: past its far edge on the side, or above or below it.
  const farListed = filled(leader.farShafts);
  let far: { connection: Point; direction: 1 | -1 } | undefined;
  if (farListed.length > 0) {
    if (vertical) {
      const top = location[1] + top0;
      far =
        side === "above"
          ? { connection: point([connection[0], top + sizes.gap]), direction: -1 }
          : {
              connection: point([connection[0], location[1] + bottom - sizes.gap]),
              direction: 1,
            };
    } else if (held) {
      // A block's far side meets its landing with no gap.
      const edge = side === "right" ? held.box[2] : held.box[0];
      far = {
        connection: point([edge + direction * sizes.landing, connection[1]]),
        direction: side === "right" ? -1 : 1,
      };
    } else {
      const edge = side === "right" ? location[0] + wide : location[0] - wide;
      far = {
        connection: point([edge + direction * (sizes.gap + sizes.landing), connection[1]]),
        direction: side === "right" ? -1 : 1,
      };
    }
  }
  // A curved shaft ends where the landing would, and meets it level; no landing is drawn.
  const landingEnd = (from: Point, way: 1 | -1): Point =>
    vertical ? from : [from[0] + way * sizes.landing, from[1]];
  draw(leader.shafts, curved ? landingEnd(connection, direction) : connection, direction);
  if (far) {
    draw(
      farListed,
      curved ? landingEnd(far.connection, far.direction) : far.connection,
      far.direction,
    );
  }
  const farLanding: readonly [Point, Point] | undefined =
    far && !vertical && !curved && sizes.landing > 0
      ? [far.connection, [far.connection[0] + far.direction * sizes.landing, far.connection[1]]]
      : undefined;
  const note: Paragraph = { ...unplaced, ...(held ? { value: "" } : {}), at: location, align };
  const place = placer(note);
  const left = noteAttachment === 1 ? 0 : noteAttachment === 2 ? -wide / 2 : -wide;
  const box: [number, number, number, number] = held
    ? [...held.box]
    : [location[0] + left, location[1] + bottom, location[0] + left + wide, location[1] + top0];
  const grown = (by: number): [Point, Point, Point, Point] => [
    [box[0] - by, box[1] - by],
    [box[2] + by, box[1] - by],
    [box[2] + by, box[3] + by],
    [box[0] - by, box[3] + by],
  ];
  // A block in place of the note has no frame.
  const framed = held === undefined && (leader.frame ?? style.frame) === true;
  const mask = maskOf(leader.mask);
  const masked = (m: { readonly color?: number; readonly offsetFactor: number }) => ({
    corners: grown((m.offsetFactor - 1) * h),
    ...(m.color === undefined ? {} : { color: m.color }),
    factor: m.offsetFactor,
  });
  return {
    sizes,
    side,
    attachment,
    verticalAttachment,
    vertical,
    connection,
    direction,
    shafts,
    arrowheads,
    ...(landing === undefined ? {} : { landing }),
    ...(far === undefined ? {} : { farConnection: far.connection, farDirection: far.direction }),
    ...(farLanding === undefined ? {} : { farLanding }),
    curved,
    note,
    noteAttachment,
    location,
    contentBase,
    box,
    underlines,
    ...(framed ? { frame: grown(sizes.gap) } : {}),
    ...(mask === undefined ? {} : { mask: masked(mask) }),
    ...(held ? { block: held.insert } : {}),
    lines: (held ? [] : lines).map((line) => ({
      value: line.value,
      at: place(line.runs[0]?.x ?? line.start, line.baseline),
      align: "left" as const,
      height: h,
    })),
  };
}

/**
 * Returns what is wrong with what a leader draws in its style, or undefined, for a leader and a
 * style the rules have passed one by one: every number of its picture must be under 1e100.
 *
 * @param textStyle - The text style of the leader's note, unless it is `Standard`.
 */
export function leaderDrawnProblem(
  leader: Leader,
  style: LeaderStyle,
  textStyle: TextStyle | undefined,
  findBlock?: (name: string) => Block | undefined,
): string | undefined {
  const picture = leaderPicture(leader, style, textStyle, findBlock);
  const far = picture.farConnection;
  if (far !== undefined) {
    for (const shaft of filled(leader.farShafts)) {
      const listed = filled(shaft) as readonly Point[];
      const [tip, next = far] = listed;
      if (
        tip !== undefined &&
        written(tip[0]) === written(next[0]) &&
        written(tip[1]) === written(next[1])
      ) {
        return LEADER_SHAFT_LENGTH;
      }
    }
  }
  const numbers = [
    ...picture.shafts.flat(2),
    ...picture.arrowheads.flatMap((a) => [
      ...a.filled.flat(),
      ...a.lines.flat(2),
      ...a.disks.flatMap((d) => [...d.center, d.radius]),
    ]),
    ...(picture.landing ?? []).flat(),
    ...(picture.farLanding ?? []).flat(),
    ...(picture.farConnection ?? []),
    ...picture.location,
    ...picture.contentBase,
    ...picture.box,
    ...picture.underlines.flat(2),
    ...picture.lines.flatMap((line) => line.at),
  ];
  for (const value of numbers) {
    const tooLarge = pictureNumberProblem(value);
    if (tooLarge) return tooLarge;
  }
  return undefined;
}
