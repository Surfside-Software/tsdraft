// What a leader needs worked out: the keys of the handles of a leader style, of the dictionary
// that holds the styles and of an arrowhead's block, the sizes a leader is drawn with, and the
// shafts, arrowheads, landing and lines of its note that AutoCAD draws.
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
import { arrowheadEntityHandle } from "./dimensions.ts";
import type {
  Drawing,
  Leader,
  LeaderAttachment,
  LeaderSide,
  LeaderStyle,
  Point,
  TextStyle,
} from "./drawing.ts";
import { written } from "./format.ts";
import { keyHandle } from "./handles.ts";
import { layerKey } from "./layers.ts";
import { lineSpacing, measureText } from "./measure.ts";
import { leaderStyleNameProblem, pictureNumberProblem } from "./rules.ts";
import { filled } from "./shape.ts";

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
 * in lower case, so the style keeps it when the drawing around it changes. `Standard`, AutoCAD's
 * own style, which the writers add beside a drawing's own, has the handle of its name too.
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

/** The name of the dictionary of leader styles, as AutoCAD names it. */
export const LEADER_STYLE_DICTIONARY = "ACAD_MLEADERSTYLE";

/**
 * The handles of the block AutoCAD draws a leader's arrowhead with, in an R2018 drawing: the
 * block's record, the two objects that open and close its definition in a DXF, and each entity
 * it holds. They come from the block's name, so they are the same in every drawing: the first
 * entity has the key a dimension's arrowhead has, `arrowhead:NAME`, and each after it
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
 * The leader style a leader of this name is in: the first whose name AutoCAD would take for the
 * same, so `notes` finds `NOTES`. `Standard` is in no drawing's list.
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
 * AutoCAD's own leader style, `Standard`, as the writers write it beside a drawing's own: its
 * sizes and its arrowhead are the ones AutoCAD gives the style in a new drawing in inches.
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

/**
 * The side of `at` a leader's note is on: its own, or else the side away from the first shaft's
 * last point before `at`, right when `at` is not to the left of it, as written. A list is read up
 * to its first empty slot.
 */
export function leaderSide(leader: Pick<Leader, "side" | "at" | "shafts">): LeaderSide {
  if (leader.side !== undefined) return leader.side;
  const shaft = filled(filled(leader.shafts)[0]);
  const before = shaft[shaft.length - 1];
  return before === undefined || written(leader.at[0]) >= written(before[0]) ? "right" : "left";
}

/** Which line of the note the landing of a leader in this style meets. */
export function leaderAttachment(
  leader: Pick<Leader, "attachment">,
  style: Pick<LeaderStyle, "attachment">,
): LeaderAttachment {
  return leader.attachment ?? style.attachment ?? "first-line";
}

/**
 * The bits a multileader holds for each property it sets itself, in place of its style's. A
 * multileader that AutoCAD's MLEADER command draws has the three of `LEADER_OWN_ALWAYS`.
 */
const OWN = {
  gap: 1 << 5,
  landing: 1 << 7,
  arrowSize: 1 << 9,
  textStyle: 1 << 11,
  leftAttachment: 1 << 12,
  textHeight: 1 << 16,
  rightAttachment: 1 << 25,
} as const;

/** The bits every multileader the writers write holds: its content, its text's alignment, and its text. */
const LEADER_OWN_ALWAYS = (1 << 10) | (1 << 14) | (1 << 18);

/**
 * The flags of the properties a multileader sets itself, as the writers write them: the three
 * every one holds, and one for each size, text style and attachment the leader has of its own.
 * A leader's own attachment sets the attachment of both sides.
 */
export function leaderOwnFlags(
  leader: Pick<Leader, "textStyle" | "textHeight" | "arrowSize" | "landing" | "gap" | "attachment">,
): number {
  let flags = LEADER_OWN_ALWAYS;
  if (leader.gap !== undefined) flags |= OWN.gap;
  if (leader.landing !== undefined) flags |= OWN.landing;
  if (leader.arrowSize !== undefined) flags |= OWN.arrowSize;
  if (leader.textStyle !== undefined) flags |= OWN.textStyle;
  if (leader.textHeight !== undefined) flags |= OWN.textHeight;
  if (leader.attachment !== undefined) flags |= OWN.leftAttachment | OWN.rightAttachment;
  return flags;
}

/** How a multileader and its style name the line of the note the landing meets. */
export function attachmentCode(attachment: LeaderAttachment): 1 | 3 {
  return attachment === "first-line" ? 1 : 3;
}

/** One line of a leader's note, as AutoCAD draws it. */
export interface LeaderLine {
  readonly value: string;
  /** The end of its baseline it is justified to: the left end, or the right end. */
  readonly at: Point;
  readonly align: "left" | "right";
  /** The height of its capitals, in the units of the leader's space. */
  readonly height: number;
}

/** What AutoCAD draws for a leader's arrowhead, where it draws it. */
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
 * What AutoCAD draws for a leader, in the coordinates of the leader's space, with every number of
 * the leader and of its style taken as the writers write it, and the numbers a file holds for it.
 */
export interface LeaderPicture {
  readonly sizes: LeaderSizes;
  readonly side: LeaderSide;
  readonly attachment: LeaderAttachment;
  /** Where the shafts meet and the landing starts: `at`, as written. */
  readonly connection: Point;
  /** Along X, the way the landing runs: 1 to the right, -1 to the left. */
  readonly direction: 1 | -1;
  /** Each shaft as AutoCAD draws it: from where its arrowhead leaves it, through its bends, to `connection`. */
  readonly shafts: readonly (readonly Point[])[];
  /** Each shaft's arrowhead. None for an arrow size of 0. */
  readonly arrowheads: readonly LeaderArrowheadDrawn[];
  /** The landing, or undefined for a landing of 0. */
  readonly landing?: readonly [Point, Point];
  /**
   * The corner of the note's box the landing side holds it by, at the top of its first line's
   * capitals: its left for a note on the right, and its right for a note on the left.
   */
  readonly location: Point;
  /** The left end of the note, its gap before it, at the height the landing meets the note. */
  readonly contentBase: Point;
  /** Each line of the note, from the top. */
  readonly lines: readonly LeaderLine[];
}

const RADIANS = Math.PI / 180;

/**
 * What AutoCAD draws for a leader in a style, for a leader and a style the rules have passed.
 * Each shaft runs from its tip through its bends to `at`, and the arrowhead at its tip points
 * along the shaft's first segment: AutoCAD stops the shaft one arrow size short of the tip, and
 * the arrowhead draws the rest, but for the arrowhead `"none"`, whose shaft runs to the tip. The
 * landing runs level from `at`, as long as the leader's landing, to the side the note is on. The
 * note starts a gap past the landing's end, justified left on the right and right on the left,
 * with the middle of its first line's capitals, or of its last line's, level with `at`, and its
 * lines `lineSpacing` apart. Each list is read up to its first empty slot.
 *
 * @param textStyle - The text style of the leader's note, unless it is `Standard`.
 */
export function leaderPicture(
  leader: Leader,
  style: LeaderStyle,
  textStyle?: TextStyle,
): LeaderPicture {
  const sizes = leaderSizes(leader, style);
  const side = leaderSide(leader);
  const attachment = leaderAttachment(leader, style);
  const direction = side === "right" ? 1 : -1;
  const point = (p: Point): Point => [written(p[0]), written(p[1])];
  const connection = point(leader.at);
  // An arrowhead the rules refuse is drawn as the default.
  const info: LeaderArrowheadInfo =
    leaderArrowheadInfo(style.arrowhead ?? DEFAULT_LEADER_ARROWHEAD) ??
    LEADER_ARROWHEADS[DEFAULT_LEADER_ARROWHEAD];
  const size = sizes.arrowSize;

  const shafts: Point[][] = [];
  const arrowheads: LeaderArrowheadDrawn[] = [];
  for (const shaft of filled(leader.shafts)) {
    const listed = filled(shaft);
    // A shaft with no tip, which the rules refuse, draws nothing.
    if (listed.length === 0) continue;
    const points = [...listed.map(point), connection];
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
    if (size > 0) {
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
        ...(info.block === undefined ? {} : { insert: { at: tip, rotation: turned, scale: size } }),
      });
    }
    const start: Point = info.toTip || !(size > 0) ? tip : place([-1, 0]);
    shafts.push([start, ...points.slice(1)]);
  }

  const landing: readonly [Point, Point] | undefined =
    sizes.landing > 0
      ? [connection, [connection[0] + direction * sizes.landing, connection[1]]]
      : undefined;

  const height = sizes.textHeight;
  const pitch = lineSpacing(height);
  const text = filled(leader.text);
  const count = text.length;
  // The middle of the capitals of the line the landing meets is level with `at`.
  const top = connection[1] + height / 2 + (attachment === "last-line" ? (count - 1) * pitch : 0);
  const x = connection[0] + direction * (sizes.landing + sizes.gap);
  const location: Point = [x, top];
  const align = side === "right" ? "left" : "right";
  const lines = text.map((value, k): LeaderLine => ({
    value,
    at: [x, top - height - k * pitch],
    align,
    height,
  }));
  let width = 0;
  for (const line of lines) {
    // A style whose font or width the rules refuse is measured as `Standard`'s.
    const measured = measureText({
      value: line.value,
      height,
      ...(typeof textStyle?.font === "string" ? { font: textStyle.font } : {}),
      ...(typeof textStyle?.widthFactor === "number" ? { widthFactor: textStyle.widthFactor } : {}),
    });
    width = Math.max(width, measured.length);
  }
  const left = side === "right" ? x : x - width;
  return {
    sizes,
    side,
    attachment,
    connection,
    direction,
    shafts,
    arrowheads,
    ...(landing === undefined ? {} : { landing }),
    location,
    contentBase: [left - sizes.gap, connection[1]],
    lines,
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
): string | undefined {
  const picture = leaderPicture(leader, style, textStyle);
  const numbers = [
    ...picture.shafts.flat(2),
    ...picture.arrowheads.flatMap((a) => [
      ...a.filled.flat(),
      ...a.lines.flat(2),
      ...a.disks.flatMap((d) => [...d.center, d.radius]),
    ]),
    ...(picture.landing ?? []).flat(),
    ...picture.location,
    ...picture.contentBase,
    ...picture.lines.flatMap((line) => line.at),
  ];
  for (const value of numbers) {
    const tooLarge = pictureNumberProblem(value);
    if (tooLarge) return tooLarge;
  }
  return undefined;
}
