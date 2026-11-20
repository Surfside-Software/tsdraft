// Where the leading CAD app sets the lines and the runs of a paragraph, and the box it fills. This
// is the one layout of a paragraph: the extents, `toSVG`, `inspectText`, the writers and the
// reader all take a paragraph's lines and its box from here.
import type { LineSpacingStyle, ParagraphAlign, ParagraphVerticalAlign, Point } from "./drawing.ts";
import { FONT_METRICS, type FontMetrics } from "./font-metrics.ts";
import { capHeightOf, fontInfo, STANDARD_FONT } from "./fonts.ts";
import { fontMetrics, tableIndex, UNKNOWN } from "./measure.ts";
import { parseParagraph, type ParsedParagraph, type RunFormat } from "./paragraph-codes.ts";
import { LINE_SPACING_RANGE } from "./rules.ts";
import { fifteenDigits, written } from "./format.ts";
import { Strings } from "./shape.ts";

// The rules of a paragraph's layout, every one of them, in heights h of the paragraph, read from
// the columns of `src/font-metrics.ts`:
// - A run is characters of one font, face and format. Its characters are set by their advances.
//   The next run starts where the last one's advances end, or where its last character's ink
//   ends, `rights`, where that is further.
// - A line starts at the left of its first character's ink, `lefts`, and ends at the right of its
//   last character's ink, `rights`. It keeps the spaces it starts with, and drops those it ends
//   with and those where it wraps. Left alignment puts its start on the point, right its end, and
//   center the middle of the two: the width moves no line.
// - A line breaks only at an ASCII space, and only to keep the next word inside the width: the
//   word stays when the line's advances up to its first character, from the line's first point,
//   plus its ink, from the left of its first character's ink to the right of its last one's, come
//   to no more than the width and `SLACK`. In a word that holds a stack, the characters after its
//   last stack stand for it, or the stack where it ends the word. A line's first word stays, wider
//   than the width or not.
// - At-least spacing gives each line a slot of the factor times A + D + h/3 from its top, and the
//   next line its top where the slot ends. A is the most its characters' `tops` or its stacks
//   reach above its baseline, and at least h; D is h/3, or 0 where a stack reaches highest. Its
//   first line's top is the top of the box, and the box ends below the last baseline by the most
//   its last line's characters reach below it, `bottoms`.
// - Exact spacing sets the first baseline h below the top of the box, each next one 5h/3 times
//   the factor below it, and the bottom of the box h/3 below the last.
// - The style's width factor scales everything along a line. Its oblique angle moves where a line
//   starts by its first character's bottom times the angle's tangent, and where it ends by its A
//   times it. It is measured for a TrueType font, and an estimate for an SHX font.
// - An underline runs along a run from its first point to where its advances end, `UNDERLINE_SHX`
//   below the baseline in an SHX font and the font's descent, `below`, in a TrueType font; a
//   strike-through `STRIKE_THROUGH` above it. An overline, refused, is drawn `OVERLINE` above it.
// - A bold run is in its font's bold face, whose numbers are its own.
// - A stack's top part has its ink's top at the stack's top and its baseline `STACK_GAP` above a
//   bar, and the bottom part its ink `STACK_GAP` below the bar and its baseline on the line's. The
//   bar is as long as the wider part's ink, from the end of the advances before the stack, and each
//   part is centered on it by its ink. `^` sets both parts' ink from that start, with no bar. `#`
//   sets the top part's baseline a digit's top above the line's, the top part's ink
//   from the start and the bottom part's `SLASH_GAP` after it, and a slash `SLASH_LENGTH` long at
//   `SLASH_ANGLE` between the two at the bottom part's top. A part of spaces is as wide as they
//   are and reaches neither up nor down, and an empty part has no ink. The next character's first
//   point is `afterStack` past the stack's ink. A part's ink is measured from the left of its
//   first character's ink as `lefts` holds it, never before its first point.
// - `%%c` in an SHX font is a sign of its own, measured as `Ø`, and an estimate, which `lint`
//   refuses. So is a stack in
//   a TrueType font but those of `STACKS_MEASURED`, and one whose part of spaces is the wider.
// - A line that ends in a stack and drops the spaces after it is placed by its first point and not
//   by the left of its first character's ink, at any attachment.
/** How far past the width a word may reach and stay: the tables' rounding, and no more. */
const SLACK = 1e-9;
const UNDERLINE_SHX = 0.2;
const STRIKE_THROUGH = 0.5;
const OVERLINE = 1.2;
/** The room a stack leaves between its bar and each part. */
const STACK_GAP = 1 / 6;
const SLASH_GAP = 1 / 3;
const SLASH_LENGTH = 2;
const SLASH_ANGLE = 55;
/**
 * The TrueType fonts whose stacks are measured. In another, a digit or a capital may stand lower
 * than its capital A, which the tables do not hold.
 */
const STACKS_MEASURED: ReadonlySet<string> = new Set(["Arial"]);
/** D, and what a slot of at-least spacing holds beyond A and D. */
const AT_LEAST_BELOW = 1 / 3;
const EXACT_PITCH = 5 / 3;
const EXACT_BELOW = 1 / 3;

/** A paragraph to lay out. A `Paragraph` and its `TextStyle` spread into one object are one. */
export interface ParagraphToMeasure {
  /** The value, with its codes. */
  readonly value: string;
  /** The height of a capital. */
  readonly height: number;
  /** The width its lines wrap at. Missing, or 0 or less, breaks lines only at `\P`. */
  readonly width?: number;
  /** One of `FONTS`. Defaults to `txt.shx`. */
  readonly font?: string;
  /** Defaults to 1. */
  readonly widthFactor?: number;
  /** Degrees to the right. Defaults to 0. */
  readonly obliqueAngle?: number;
  /** The point of the box `align` and `valign` name. Defaults to `[0, 0]`. */
  readonly at?: Point;
  /** Degrees counterclockwise. Defaults to 0. */
  readonly rotation?: number;
  /** Defaults to `"left"`. */
  readonly align?: ParagraphAlign;
  /** Defaults to `"top"`. */
  readonly valign?: ParagraphVerticalAlign;
  /** A factor of the spacing of a text's lines, from 0.25 to 4. Defaults to 1. */
  readonly lineSpacing?: number;
  /** Defaults to `"at-least"`. */
  readonly lineSpacingStyle?: LineSpacingStyle;
}

/** A run of characters a paragraph draws in one font and one format, as a text is drawn. */
export interface ParagraphRun {
  /** The characters it draws. */
  readonly value: string;
  /** Its first point, along the line from `at`, where its first character is placed. */
  readonly x: number;
  /** Its baseline, up from `at`. */
  readonly baseline: number;
  /** The height of its capitals. */
  readonly height: number;
  /** The font it is drawn in: the style's, or one a `\f` or `\F` code set. */
  readonly font: string;
  /** True for a run in its font's bold face. */
  readonly bold: boolean;
  /** How far its characters' advances take it along the line from its first point. */
  readonly advance: number;
  /** Where it starts and ends to draw along the line from `at`, as `layoutText` gives a text. */
  readonly start: number;
  readonly end: number;
}

/** A line a paragraph draws that is no letter: an underline, an overline, a strike-through or a stack's bar or slash. */
export interface ParagraphStroke {
  readonly kind: "underline" | "overline" | "strike-through" | "bar";
  /** From `at`, along the line and up it. */
  readonly from: Point;
  readonly to: Point;
}

/** One line of a paragraph. */
export interface ParagraphLine {
  /** What it draws: its characters in order, and each stack as its parts either side of its divider. */
  readonly value: string;
  readonly runs: readonly ParagraphRun[];
  /** Its baseline, up from `at`. */
  readonly baseline: number;
  /**
   * Where its ink starts and ends along the line from `at`, upright: from the left of its first
   * character's ink to the right of its last one's. Both 0 for a line with nothing.
   */
  readonly start: number;
  readonly end: number;
  /** How far above its baseline it reaches: its A, which sets where it sits under at-least spacing. */
  readonly top: number;
}

/** A paragraph before it is turned and moved to its point: X along its lines, Y up them, from `at`. */
export interface ParagraphLayout {
  readonly lines: readonly ParagraphLine[];
  readonly strokes: readonly ParagraphStroke[];
  /**
   * The box `align` and `valign` place it by, `[left, bottom, right, top]`: from the first line's
   * top to the bottom of the last line's ink, or to where exact spacing ends it, and as wide as
   * the width from the point `align` names, or as the widest line without one.
   */
  readonly frame: readonly [number, number, number, number];
  /**
   * The box of all it draws, its letters with what they reach below the baseline and their lean,
   * and its strokes: `[left, bottom, right, top]`. Undefined when it draws nothing.
   */
  readonly ink: readonly [number, number, number, number] | undefined;
  /** How far along a letter its lean takes its top, for each height of it. */
  readonly lean: number;
  readonly widthFactor: number;
  readonly obliqueAngle: number;
  /**
   * True for an estimate: the value holds a code tsdraft does not lay out or a character its
   * tables do not hold, a font is not one of `FONTS`, an SHX font is slanted or draws `%%c`.
   */
  readonly approximate: boolean;
  /** The first code or character of the value that tsdraft refuses to write, or undefined. */
  readonly problem: string | undefined;
}

/** A paragraph where it plots, as `measureParagraph` gives it. */
export interface ParagraphMeasure {
  /**
   * The box of all it draws, turned as it is: its lower left, lower right, upper right and upper
   * left corners. Undefined when it draws nothing.
   */
  readonly corners: readonly [Point, Point, Point, Point] | undefined;
  /** The box `align` and `valign` place it by, turned, in the same order. */
  readonly frame: readonly [Point, Point, Point, Point];
  /**
   * Each line that draws a character, as `measureText` gives a text: the start and the end of
   * its baseline, then the end and the start of the line along its top, leaned as it is.
   */
  readonly lines: readonly {
    readonly value: string;
    readonly corners: readonly [Point, Point, Point, Point];
  }[];
  readonly approximate: boolean;
}

/** The numbers of a face of a font, at height 1 and width factor 1. */
interface Face {
  readonly font: string;
  readonly bold: boolean;
  readonly shx: boolean;
  readonly advances: readonly number[];
  readonly lefts: readonly number[];
  readonly rights: readonly number[];
  readonly tops: readonly number[];
  readonly bottoms: readonly number[];
  /**
   * How far a stack's top stands above its top part's baseline for each character alone, where
   * the tables hold it: for a regular face.
   */
  readonly stackTops: readonly number[] | undefined;
  /** Where a text starts and ends to draw, as `layoutText` reads them: 0 for a bold face. */
  readonly heads: readonly number[] | undefined;
  readonly tails: readonly number[] | undefined;
  /** How far below the baseline its underline lies. */
  readonly underline: number;
  readonly afterStack: number;
  /** How far below the baseline a text of it reaches. */
  readonly below: number;
  /** One unit of a TrueType font's design grid, in heights: how far its space reaches below the baseline. */
  readonly unit: number;
}

/** A face of a font of `FONT_METRICS`, regular or bold. */
function faceOf(font: string, metrics: FontMetrics, bold: boolean): Face {
  const info = fontInfo(font);
  const shx = info?.file.endsWith(".shx") ?? true;
  const own = bold ? metrics.bold : undefined;
  // The bold face's numbers are in heights of its own capital A, and its descent in the regular's.
  const scale = own ? (capHeightOf(font) ?? 1) / (capHeightOf(font, true) ?? 1) : 1;
  return {
    font,
    bold: own !== undefined,
    shx,
    advances: own?.advances ?? metrics.advances,
    lefts: own?.lefts ?? metrics.lefts,
    rights: own?.rights ?? metrics.rights,
    tops: own?.tops ?? metrics.tops,
    bottoms: own?.bottoms ?? metrics.bottoms,
    stackTops: own ? undefined : metrics.stackTops,
    heads: own ? undefined : metrics.heads,
    tails: own ? undefined : metrics.tails,
    underline: shx ? UNDERLINE_SHX : metrics.below * scale,
    afterStack: metrics.afterStack,
    below: metrics.below * scale,
    // The fonts of `FONTS` have 2,048 units to the em.
    unit: 1 / ((capHeightOf(font) ?? 1) * 2048),
  };
}

/** Characters with a space the line does not break at as a space, which is how it is drawn. */
function nonBreaking(value: string): string {
  return value.replaceAll("\u00a0", " ");
}

/** A number that is finite, or `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Where a character's numbers are in the tables, and whether they hold its own. */
function indexOf(character: string): number {
  return tableIndex(character.codePointAt(0)!);
}

/** A part of a stack, measured at height 1: its ink's width, top and bottom, and its first left. */
interface Part {
  readonly value: string;
  /** How wide its ink is: from `left` to the right of its last character's ink. */
  readonly ink: number;
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
  readonly odd: boolean;
}

function partOf(value: string, face: Face): Part {
  let advance = 0;
  let ink = 0;
  let left: number | undefined;
  let top = 0;
  let bottom = 0;
  let odd = false;
  for (const character of value) {
    let index = indexOf(character);
    if (index < 0) {
      index = UNKNOWN;
      odd = true;
    }
    left ??= face.lefts[index]!;
    ink = advance + face.rights[index]!;
    // A space reaches neither up nor down: a part of spaces only stands as wide as they are. A
    // stacked character reaches its own ink's top, which may be below a capital's.
    if (character !== " ") {
      const below = face.bottoms[index]!;
      top = Math.max(top, face.stackTops ? face.stackTops[index]! + below : face.tops[index]!);
      bottom = Math.min(bottom, below);
    }
    advance += face.advances[index]!;
  }
  return { value, ink: ink - (left ?? 0), left: left ?? 0, top, bottom, odd };
}

/**
 * A stack laid out about its start on the baseline, in drawing units: its parts' first points and
 * baselines, its bar or slash, how far its ink reaches along and up and down, and the advance it
 * takes, to the next character's first point.
 */
interface StackShape {
  readonly parts: readonly {
    readonly value: string;
    readonly x: number;
    readonly up: number;
    /** How far its ink reaches above its baseline, in heights. */
    readonly top: number;
  }[];
  readonly stroke: readonly [Point, Point] | undefined;
  readonly ink: number;
  readonly top: number;
  readonly bottom: number;
  readonly advance: number;
  /** The height its parts are drawn at. */
  readonly size: number;
}

function stackShape(
  top: Part,
  bottom: Part,
  separator: "/" | "#" | "^",
  face: Face,
  size: number,
  widthFactor: number,
): StackShape {
  const across = size * widthFactor;
  const parts: StackShape["parts"][number][] = [];
  let stroke: [Point, Point] | undefined;
  let ink: number;
  let rise: number;
  if (separator === "#") {
    // The top part's baseline at a digit's top, and the slash's middle at the bottom part's ink
    // top, or a digit's where it has none.
    const digit = face.tops[indexOf("0")]!;
    // The top part stands on the bottom part's ink, as tall as it is from top to bottom.
    const up = (bottom.top > bottom.bottom ? bottom.top - bottom.bottom : digit) * size;
    // The gap after the top part is not widened or narrowed with the letters.
    const after = top.ink * across + SLASH_GAP * size;
    parts.push({ value: top.value, x: -top.left * across, up, top: top.top });
    parts.push({ value: bottom.value, x: after - bottom.left * across, up: 0, top: bottom.top });
    const middle: Point = [
      top.ink * across + (SLASH_GAP / 2) * size,
      (bottom.top > 0 ? bottom.top : digit) * size,
    ];
    const turn = (SLASH_ANGLE * Math.PI) / 180;
    const half: Point = [
      ((Math.cos(turn) * SLASH_LENGTH) / 2) * across,
      ((Math.sin(turn) * SLASH_LENGTH) / 2) * size,
    ];
    stroke = [
      [middle[0] - half[0], middle[1] - half[1]],
      [middle[0] + half[0], middle[1] + half[1]],
    ];
    ink = after + bottom.ink * across;
    rise = up + (top.top - top.bottom) * size;
  } else {
    const wide = Math.max(top.ink, bottom.ink);
    const bar = (bottom.top - bottom.bottom + STACK_GAP) * size;
    const up = bar + STACK_GAP * size;
    const centered = separator === "/";
    const offset = (part: Part) => (centered ? ((wide - part.ink) / 2) * across : 0);
    parts.push({ value: top.value, x: offset(top) - top.left * across, up, top: top.top });
    parts.push({
      value: bottom.value,
      x: offset(bottom) - bottom.left * across,
      up: 0,
      top: bottom.top,
    });
    if (centered) {
      stroke = [
        [0, bar],
        [wide * across, bar],
      ];
    }
    ink = wide * across;
    rise = up + (top.top - top.bottom) * size;
  }
  return {
    parts,
    stroke,
    ink,
    top: rise,
    bottom: bottom.bottom * size,
    advance: ink + face.afterStack * across,
    size,
  };
}

/** A stack moved down the line by `by`. */
function lowered(shape: StackShape, by: number): StackShape {
  const down = (p: Point): Point => [p[0], p[1] - by];
  return {
    ...shape,
    parts: shape.parts.map((part) => ({ ...part, up: part.up - by })),
    stroke: shape.stroke && [down(shape.stroke[0]), down(shape.stroke[1])],
    top: shape.top - by,
    bottom: shape.bottom - by,
  };
}

/**
 * A run of a line as it is built. Its value is the stretches in `head`, if any, and then the
 * stretch of `source` from `from` to `to`, which grows while the run's characters follow on in
 * one string.
 */
interface Built {
  readonly kind: "run";
  head: string[] | undefined;
  source: string;
  from: number;
  to: number;
  readonly x: number;
  readonly face: Face;
  readonly format: RunFormat;
  /** Its advances so far, and where its last character's first point is. */
  advance: number;
  last: number;
  lastIndex: number;
  top: number;
  bottom: number;
}

/** What a line holds as it is built, in drawing units from its first point. */
interface Line {
  readonly items: (
    | Built
    | {
        readonly kind: "stack";
        readonly x: number;
        readonly shape: StackShape;
        readonly face: Face;
        readonly value: string;
      }
  )[];
  /** True when it ends in a stack and the spaces after the stack were dropped. */
  spaced: boolean;
}

/** Where the next character of a line goes, and what it continues. */
interface Pen {
  /** Where the next character's first point is, if it continues the run. */
  x: number;
  /** The run the next character continues, by its key, or undefined after a stack or at the start. */
  key: string | undefined;
  /** Where the last character's ink ends. */
  ink: number;
}

/** A word's characters of one format, the stretch of `source` from `from` to `to`, or a stack. */
type WordPart =
  | {
      kind: "characters";
      source: string;
      from: number;
      to: number;
      face: Face;
      key: string;
      format: RunFormat;
    }
  | {
      readonly kind: "stack";
      readonly shape: StackShape;
      readonly face: Face;
      readonly value: string;
    };

/** The parts of a word or of the spaces before it, kept from word to word to be used again. */
interface Parts {
  readonly items: WordPart[];
  count: number;
}

/** The value of a run as built, as one flat string. */
function valueOf(run: Built): string {
  const last = run.source.slice(run.from, run.to);
  return run.head === undefined ? last : [...run.head, last].join("");
}

/**
 * Lays a paragraph out about its point, in time in proportion to its value: its lines broken at
 * its width and at each `\P`, each run of each line where it draws, and its strokes. It reads any
 * value and never throws.
 */
export function layoutParagraph(paragraph: ParagraphToMeasure): ParagraphLayout {
  return layOut(settingsOf(paragraph), parseParagraph(paragraph.value));
}

/**
 * Lays out the text of a dimension's picture as `layoutParagraph` lays out a paragraph, with the
 * codes such a text holds: `\A1;`, which centers its stacks, and `\H` with a factor, which sizes
 * a fraction.
 */
export function layoutDimensionText(paragraph: ParagraphToMeasure): ParagraphLayout {
  return layOut(
    { ...settingsOf(paragraph), dimension: true },
    parseParagraph(paragraph.value, true),
  );
}

/** The text of a dimension's picture where it plots, as `measureParagraph` gives a paragraph. */
export function measureDimensionText(paragraph: ParagraphToMeasure): ParagraphMeasure {
  return measured(paragraph, layoutDimensionText(paragraph));
}

/** What a paragraph's layout reads of it apart from its value, with each number as written. */
interface Settings {
  readonly height: number;
  readonly widthFactor: number;
  readonly obliqueAngle: number;
  /** The width, or 0 for none. */
  readonly width: number;
  readonly factor: number;
  readonly exactly: boolean;
  /** The font of `FONTS`, or undefined for one that is not, which is measured as `txt.shx`. */
  readonly font: string | undefined;
  readonly align: ParagraphAlign | undefined;
  readonly valign: ParagraphVerticalAlign | undefined;
  /**
   * True for the text of a dimension's picture, whose box ends below the last line's characters
   * and below where a stack sets its lowest part, and not at a stacked part's ink.
   */
  readonly dimension?: boolean;
}

/** A paragraph's settings, from its numbers as the writers write them, as a file holds them. */
function settingsOf(paragraph: ParagraphToMeasure): Settings {
  const chosen = written(finite(paragraph.lineSpacing, 1));
  const font = paragraph.font ?? STANDARD_FONT;
  const align = paragraph.align;
  const valign = paragraph.valign;
  return {
    height: Math.max(written(finite(paragraph.height, 0)), 0),
    widthFactor: written(finite(paragraph.widthFactor, 1)),
    obliqueAngle: written(finite(paragraph.obliqueAngle, 0)),
    width: Math.max(written(finite(paragraph.width, 0)), 0),
    factor: chosen >= LINE_SPACING_RANGE[0] && chosen <= LINE_SPACING_RANGE[1] ? chosen : 1,
    exactly: paragraph.lineSpacingStyle === "exactly",
    font: fontMetrics(font).known ? font : undefined,
    align: align === "center" || align === "right" ? align : undefined,
    valign: valign === "middle" || valign === "bottom" ? valign : undefined,
  };
}

function layOut(settings: Settings, parsed: ParsedParagraph): ParagraphLayout {
  const { height, widthFactor, obliqueAngle, factor, exactly } = settings;
  const along = height * widthFactor;
  const own = fontMetrics(settings.font);
  const ownFont = settings.font ?? STANDARD_FONT;
  const given = settings.width;
  const wrapAt = given > 0 ? given + SLACK * height : Infinity;
  const tangent = Math.tan((obliqueAngle * Math.PI) / 180);
  const lean = Number.isFinite(tangent) ? tangent : 0;
  let approximate = settings.font === undefined || parsed.problem !== undefined;

  // The faces of the call, by font and weight. A paragraph names at most the fonts of `FONTS`.
  const faces = new Map<string, Face>();
  const faceFor = (format: RunFormat): Face => {
    const font = format.font ?? ownFont;
    const metrics = font === ownFont ? own.metrics : FONT_METRICS[font]!;
    const bold = format.bold && metrics.bold !== undefined;
    const key = `${font}|${bold}`;
    let face = faces.get(key);
    if (!face) faces.set(key, (face = faceOf(font, metrics, bold)));
    return face;
  };
  const keyOf = (format: RunFormat, face: Face): string =>
    `${face.font}|${face.bold}|${format.underline}|${format.overline}|${format.strikeThrough}`;

  const lines: Line[] = [];
  let line: Line = { items: [], spaced: false };
  lines.push(line);
  const pen: Pen = { x: 0, key: undefined, ink: 0 };
  const word: Parts = { items: [], count: 0 };
  const spaces: Parts = { items: [], count: 0 };
  let words = 0;

  /**
   * Places parts from where `pen` is, and moves `pen` on past them. With `into`, it adds them to
   * that line. It gives how far the last of them reach for the break: the last characters' ink
   * less the left of the first of them, or the last stack's ink; spaces have no part in it.
   */
  const place = (parts: Parts, pen: Pen, into?: Line): number => {
    let { x, key, ink } = pen;
    let reach = x;
    let left: number | undefined;
    for (let p = 0; p < parts.count; p++) {
      const part = parts.items[p]!;
      if (part.kind === "stack") {
        if (into) {
          into.items.push({
            kind: "stack",
            x,
            shape: part.shape,
            face: part.face,
            value: part.value,
          });
        }
        reach = x + part.shape.ink;
        x += part.shape.advance;
        ink = reach;
        key = undefined;
        left = undefined;
        continue;
      }
      const { face } = part;
      let run: Built | undefined;
      if (key !== part.key) {
        // A new run starts where the last one's advances end, or its ink where that is further.
        if (key !== undefined && ink > x) x = ink;
        key = part.key;
        if (into) {
          run = {
            kind: "run",
            head: undefined,
            source: part.source,
            from: part.from,
            to: part.from,
            x,
            face,
            format: part.format,
            advance: 0,
            last: x,
            lastIndex: 0,
            top: 0,
            bottom: 0,
          };
          into.items.push(run);
        }
      } else if (into) {
        const last = into.items[into.items.length - 1];
        run = last?.kind === "run" ? last : undefined;
      }
      const { source: value, to } = part;
      for (let k = part.from; k < to; k++) {
        const code = value.charCodeAt(k);
        let index = tableIndex(value.codePointAt(k)!);
        if (index < 0) index = UNKNOWN;
        ink = x + face.rights[index]! * along;
        if (code !== 32) {
          left ??= face.lefts[index]! * along;
          reach = ink - left;
        }
        if (run) {
          run.last = x;
          run.lastIndex = index;
          if (face.tops[index]! > run.top) run.top = face.tops[index]!;
          if (face.bottoms[index]! < run.bottom) run.bottom = face.bottoms[index]!;
        }
        x += face.advances[index]! * along;
        // A pair of surrogates is one character.
        if (code >= 0xd800 && code <= 0xdbff && k + 1 < to && value.charCodeAt(k + 1) >= 0xdc00)
          k++;
      }
      if (run) {
        // The run holds the part's characters, as one stretch where they follow on.
        if (run.source !== value || run.to !== part.from) {
          if (run.to > run.from) (run.head ??= []).push(run.source.slice(run.from, run.to));
          run.source = value;
          run.from = part.from;
        }
        run.to = to;
        run.advance = x - run.x;
      }
    }
    pen.x = x;
    pen.key = key;
    pen.ink = ink;
    return reach;
  };

  /** Drops the spaces a line ends with. */
  const endLine = (): void => {
    if (spaces.count > 0 && line.items[line.items.length - 1]?.kind === "stack") line.spaced = true;
    spaces.count = 0;
  };
  const trial: Pen = { x: 0, key: undefined, ink: 0 };
  const endWord = (): void => {
    if (word.count === 0) return;
    trial.x = pen.x;
    trial.key = pen.key;
    trial.ink = pen.ink;
    place(spaces, trial);
    if (words > 0 && place(word, trial) > wrapAt) {
      endLine();
      line = { items: [], spaced: false };
      lines.push(line);
      pen.x = 0;
      pen.key = undefined;
      pen.ink = 0;
    } else place(spaces, pen, line);
    place(word, pen, line);
    words++;
    word.count = 0;
    spaces.count = 0;
  };
  /**
   * Appends the stretch of `source` from `from` to `to`, of one run's format, to a list of parts:
   * to its last part where that follows on in the same format, or in a part kept from before.
   */
  const append = (
    into: Parts,
    source: string,
    from: number,
    to: number,
    format: RunFormat,
    face: Face,
    key: string,
  ): void => {
    const last = into.count > 0 ? into.items[into.count - 1] : undefined;
    if (
      last?.kind === "characters" &&
      last.key === key &&
      last.source === source &&
      last.to === from
    ) {
      last.to = to;
      return;
    }
    const kept = into.items[into.count];
    if (kept?.kind === "characters") {
      kept.source = source;
      kept.from = from;
      kept.to = to;
      kept.face = face;
      kept.key = key;
      kept.format = format;
    } else into.items[into.count] = { kind: "characters", source, from, to, face, key, format };
    into.count++;
  };

  for (const piece of parsed.pieces) {
    if (piece.kind === "break") {
      endWord();
      endLine();
      line = { items: [], spaced: false };
      lines.push(line);
      pen.x = 0;
      pen.key = undefined;
      pen.ink = 0;
      words = 0;
      continue;
    }
    const face = faceFor(piece.format);
    if (piece.kind === "stack") {
      const top = partOf(piece.top, face);
      const bottom = partOf(piece.bottom, face);
      if (top.odd || bottom.odd || !(face.shx || STACKS_MEASURED.has(face.font)))
        approximate = true;
      // How wide a part of spaces stands is measured only where the other part is wider.
      const blank = (part: Part) => part.value.length > 0 && part.top === 0 && part.bottom === 0;
      if ((blank(top) && top.ink > bottom.ink) || (blank(bottom) && bottom.ink > top.ink)) {
        approximate = true;
      }
      const stacked = stackShape(
        top,
        bottom,
        piece.separator,
        face,
        height * piece.format.size,
        widthFactor,
      );
      // A centered stack's bar, or the middle of its slash, is half a height above the line.
      let shape = stacked;
      if (piece.format.align !== 0) {
        const stroke = stacked.stroke;
        if (piece.format.align === 1 && stroke !== undefined && piece.separator !== "^") {
          shape = lowered(stacked, Math.max(0, (stroke[0][1] + stroke[1][1]) / 2 - height / 2));
        } else approximate = true;
      }
      const value = `${piece.top}${piece.separator}${piece.bottom}`;
      word.items[word.count++] = { kind: "stack", shape, face, value };
      continue;
    }
    if (face.shx && piece.diameter) approximate = true;
    // Characters at a size of their own are not laid out yet.
    if (piece.format.size !== 1) approximate = true;
    const { format } = piece;
    const key = keyOf(format, face);
    let from = 0;
    // A space the line does not break at is drawn as a space.
    const value = nonBreaking(piece.value);
    const breaking = piece.value;
    for (let k = 0; k < value.length; k++) {
      if (breaking.charCodeAt(k) === 32) {
        if (k > from) append(word, value, from, k, format, face, key);
        endWord();
        append(spaces, value, k, k + 1, format, face, key);
        from = k + 1;
      } else if (tableIndex(value.codePointAt(k)!) < 0) {
        approximate = true;
      }
    }
    if (value.length > from) append(word, value, from, value.length, format, face, key);
  }
  endWord();
  endLine();

  if (lean !== 0 && [...faces.values()].some((face) => face.shx)) approximate = true;

  // Each line's ink along it, upright and leaned, and how far it reaches up and down.
  const measured = lines.map((built) => {
    let up = 0;
    let stackUp = 0;
    let down = 0;
    let start: number | undefined;
    /** How far the lean moves where the line starts: by its first character's bottom. */
    let startLean = 0;
    let end = 0;
    // What the box of a dimension's text takes below the baseline: how far its characters reach,
    // and how far below the line a stack sets its lowest part's baseline.
    let runDown = 0;
    let drop = 0;
    for (const item of built.items) {
      if (item.kind === "stack") {
        stackUp = Math.max(stackUp, item.shape.top);
        down = Math.min(down, item.shape.bottom);
        for (const part of item.shape.parts) drop = Math.max(drop, -part.up);
        start ??= item.x;
        end = item.x + item.shape.ink;
        continue;
      }
      const run = item;
      up = Math.max(up, (run.format.overline ? Math.max(run.top, OVERLINE) : run.top) * height);
      down = Math.min(down, run.bottom * height);
      runDown = Math.min(
        runDown,
        run.bottom * height,
        settings.dimension && !run.face.shx && valueOf(run).includes(" ")
          ? -run.face.unit * height
          : 0,
      );
      if (start === undefined) {
        let index = tableIndex(
          (run.head?.[0] ?? run.source.slice(run.from, run.to)).codePointAt(0) ?? 32,
        );
        if (index < 0) index = UNKNOWN;
        start = run.x + run.face.lefts[index]! * along;
        startLean = lean * run.face.bottoms[index]! * height;
      }
      end = run.last + run.face.rights[run.lastIndex]! * along;
    }
    const empty = start === undefined;
    // A line's A is at least a capital's height, and D a third of it unless a stack reaches highest.
    const top = empty ? height : Math.max(up, stackUp);
    // A line that ends in a stack and dropped spaces after it is placed by its first point and
    // not by its ink: the left of its first character's ink further on, at any attachment.
    const first = built.items[0];
    const shift = built.spaced && first?.kind === "run" ? (start ?? 0) - first.x : 0;
    return {
      built,
      top,
      below: stackUp > up ? 0 : AT_LEAST_BELOW * height,
      // A dimension's box reaches where a stack sets its lowest part only when the stack reaches highest.
      down: settings.dimension ? runDown - (stackUp > up ? drop : 0) : down,
      start: start ?? 0,
      end,
      leanedStart: (start ?? 0) + startLean - shift,
      leanedEnd: empty ? 0 : end + lean * top - shift,
    };
  });

  // Down the box: each line's baseline from its top.
  const baselines: number[] = [];
  let boxHeight: number;
  if (exactly) {
    measured.forEach((_, k) => baselines.push(-height - k * EXACT_PITCH * factor * height));
    boxHeight = -baselines[baselines.length - 1]! + EXACT_BELOW * height;
  } else {
    let top = 0;
    for (const m of measured) {
      baselines.push(top - m.top);
      top -= factor * (m.top + m.below + AT_LEAST_BELOW * height);
    }
    const last = measured[measured.length - 1]!;
    boxHeight = -(baselines[baselines.length - 1]! + last.down);
  }
  const { align, valign } = settings;
  const boxTop = valign === "middle" ? boxHeight / 2 : valign === "bottom" ? boxHeight : 0;

  const ink: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const include = (x: number, y: number): void => {
    if (x < ink[0]) ink[0] = x;
    if (y < ink[1]) ink[1] = y;
    if (x > ink[2]) ink[2] = x;
    if (y > ink[3]) ink[3] = y;
  };
  const strokes: ParagraphStroke[] = [];
  const stroke = (kind: ParagraphStroke["kind"], from: Point, to: Point): void => {
    strokes.push({ kind, from, to });
    include(...from);
    include(...to);
  };
  let widest = 0;
  const laid = measured.map((m, k): ParagraphLine => {
    const baseline = boxTop + baselines[k]!;
    const offset =
      align === "center"
        ? -(m.leanedStart + m.leanedEnd) / 2
        : align === "right"
          ? -m.leanedEnd
          : -m.leanedStart;
    const runs: ParagraphRun[] = [];
    /** The value of the line's one run or stack, and those of all once it has more, joined flat. */
    let value = "";
    let values: string[] | undefined;
    const add = (part: string): void => {
      if (values) values.push(part);
      else if (value === "") value = part;
      else values = [value, part];
    };
    /** Adds a run of `value` in `face` at its first point `x`, of `size`, with its baseline at `base`. */
    const run = (value: string, x: number, base: number, size: number, face: Face, top: number) => {
      if (value === "") return;
      let advance = 0;
      let head: number | undefined;
      let tail = 0;
      for (const character of value) {
        let index = indexOf(character);
        if (index < 0) index = UNKNOWN;
        head ??= face.heads?.[index] ?? 0;
        advance += face.advances[index]!;
        tail = face.tails?.[index] ?? 0;
      }
      const scale = size * widthFactor;
      const drawn: ParagraphRun = {
        value,
        x,
        baseline: base,
        height: size,
        font: face.font,
        bold: face.bold,
        advance: advance * scale,
        start: x + (head ?? 0) * scale,
        end: x + (advance + tail) * scale,
      };
      runs.push(drawn);
      const below = face.below * size;
      const reach = Math.max(top, 1) * size;
      const from = Math.min(drawn.start, x);
      const to = Math.max(drawn.end, x + drawn.advance);
      include(from - lean * below, base - below);
      include(to + lean * reach, base + reach);
      include(from + lean * reach, base + reach);
      include(to - lean * below, base - below);
    };
    for (const item of m.built.items) {
      if (item.kind === "stack") {
        add(item.value);
        const at = item.x + offset;
        for (const part of item.shape.parts) {
          run(part.value, at + part.x, baseline + part.up, item.shape.size, item.face, part.top);
        }
        const drawnStroke = item.shape.stroke;
        if (drawnStroke) {
          const [[x0, y0], [x1, y1]] = drawnStroke;
          stroke("bar", [at + x0, baseline + y0], [at + x1, baseline + y1]);
        }
        continue;
      }
      const built = item;
      const x = built.x + offset;
      const drawn = valueOf(built);
      add(drawn);
      run(drawn, x, baseline, height, built.face, built.top);
      const { underline, overline, strikeThrough } = built.format;
      const across = (kind: ParagraphStroke["kind"], up: number): void =>
        stroke(kind, [x, baseline + up], [x + built.advance, baseline + up]);
      if (underline) across("underline", -built.face.underline * height);
      if (overline) across("overline", OVERLINE * height);
      if (strikeThrough) across("strike-through", STRIKE_THROUGH * height);
    }
    widest = Math.max(widest, m.end - m.start);
    return {
      value: values ? values.join("") : value,
      runs,
      baseline,
      start: m.built.items.length === 0 ? 0 : m.start + offset,
      end: m.built.items.length === 0 ? 0 : m.end + offset,
      top: m.top,
    };
  });

  const frameWidth = given > 0 ? given : widest;
  const left = align === "center" ? -frameWidth / 2 : align === "right" ? -frameWidth : 0;
  return {
    lines: laid,
    strokes,
    frame: [left, boxTop - boxHeight, left + frameWidth, boxTop],
    ink: ink[0] === Infinity ? undefined : ink,
    lean,
    widthFactor,
    obliqueAngle,
    approximate,
    problem: parsed.problem,
  };
}

/** The corners of a box of a layout where `place` puts them: lower left, lower right, upper right, upper left. */
function corners(
  place: (along: number, up: number) => Point,
  [x0, y0, x1, y1]: readonly [number, number, number, number],
): [Point, Point, Point, Point] {
  return [place(x0, y0), place(x1, y0), place(x1, y1), place(x0, y1)];
}

/** A paragraph's measure from its layout, in time in proportion to its lines. */
export function measured(paragraph: ParagraphToMeasure, layout: ParagraphLayout): ParagraphMeasure {
  const place = placer(paragraph);
  const box = (b: readonly [number, number, number, number]) => corners(place, b);
  const lines: { value: string; corners: [Point, Point, Point, Point] }[] = [];
  for (const line of layout.lines) {
    if (line.runs.length === 0) continue;
    const lean = layout.lean * line.top;
    lines.push({
      value: line.value,
      corners: [
        place(line.start, line.baseline),
        place(line.end, line.baseline),
        place(line.end + lean, line.baseline + line.top),
        place(line.start + lean, line.baseline + line.top),
      ],
    });
  }
  return {
    corners: layout.ink && box(layout.ink),
    frame: box(layout.frame),
    lines,
    approximate: layout.approximate,
  };
}

/**
 * A paragraph's rotation in degrees as its direction is worked out from it: reduced to a turn,
 * from 0 up to 360 as a reader gives an angle back, then rounded as written, with 0 for one that
 * rounds to 360. So one direction has one rotation, and a read of the file gives it back.
 */
export function paragraphTurn(rotation: number | undefined): number {
  const turned = written(((finite(rotation, 0) % 360) + 360) % 360);
  return turned === 360 ? 0 : turned;
}

/**
 * The direction a paragraph's lines run in, from `paragraphTurn`: the cosine and the sine as the
 * DXF writes them, groups 11 and 21, with 15 significant digits, and `[1, 0]` for no turn, which
 * the writers leave out. Both writers and the placement of its layout take it from here.
 */
export function paragraphDirection(rotation: number | undefined): readonly [number, number] {
  const degrees = paragraphTurn(rotation);
  if (degrees === 0) return [1, 0];
  const turn = (degrees * Math.PI) / 180;
  return [Number(fifteenDigits(Math.cos(turn))), Number(fifteenDigits(Math.sin(turn)))];
}

/** Where a point of a paragraph's layout is in the drawing: turned to its direction and moved to `at`. */
export function placer(
  paragraph: Pick<ParagraphToMeasure, "at" | "rotation">,
): (along: number, up: number) => Point {
  const [cos, sin] = paragraphDirection(paragraph.rotation);
  const [x, y] = paragraph.at ?? [0, 0];
  return (along, up) => [x + along * cos - up * sin, y + along * sin + up * cos];
}

/**
 * Measures a paragraph as it plots: the box of all it draws, the box it is placed by, and each
 * line that draws a character, where its width, its justification, its rotation and its style's
 * font, width factor and oblique angle put them, by the rules at the top of this module.
 *
 * ```ts
 * measureParagraph({ value: "ALL WORK SHALL COMPLY", height: 0.1, width: 1.5 }).lines.length;
 * ```
 */
export function measureParagraph(paragraph: ParagraphToMeasure): ParagraphMeasure {
  return measured(paragraph, layoutParagraph(paragraph));
}

/** The shortest value a `ParagraphMeasurer` lays out only once in each of its settings. */
const LONG = 256;

/** A box `[left, bottom, right, top]` of a layout, or undefined for one that draws nothing. */
type Ink = ParagraphLayout["ink"];

/**
 * `layoutParagraph` and the box `measureParagraph` gives, for the paragraphs of one call, which
 * may share their values.
 */
export interface ParagraphMeasurer {
  /** Lays it out, keeping the last layout of each long value. */
  layout(paragraph: ParagraphToMeasure): ParagraphLayout;
  /**
   * The corners of the box of all it draws, as `measureParagraph` gives them, keeping only that
   * box of each layout of a long value, so that each place after the first costs a constant.
   */
  box(paragraph: ParagraphToMeasure): ParagraphMeasure["corners"];
  /**
   * What `layout` costs before it lays a paragraph out, in characters of its value: 0 for a value
   * shorter than `LONG`, one laid out for the first time or a layout it keeps, and the value's
   * length for a long value laid out before in other settings, or one that took the place of
   * another of its length, as `Strings` keeps them. A layout reads each character many times
   * over, so it is priced at the whole length. The caller pays it before it calls `layout`.
   */
  again(paragraph: ParagraphToMeasure): number;
  /** What `box` costs before it lays a paragraph out, as `again` gives it for `layout`. */
  boxAgain(paragraph: ParagraphToMeasure): number;
}

/** A key of a paragraph's settings. */
function keyOf(settings: Settings): string {
  return JSON.stringify(settings);
}

/**
 * Lays out as `layoutParagraph` does, and lays each value of `LONG` characters or more out once
 * in each of its settings, keeping only what a caller asks for: the box of each layout, or the
 * last layout. What it does again for a long value it reports first, through `again` and
 * `boxAgain`, for the caller to pay. It holds those values until it is dropped, so make one for
 * a call.
 */
export function paragraphMeasurer(): ParagraphMeasurer {
  interface Kept {
    boxes: Map<string, Ink> | undefined;
    last: { readonly key: string; readonly layout: ParagraphLayout } | undefined;
  }
  const kept = new Strings<Kept>();
  const long = (value: unknown): value is string =>
    typeof value === "string" && value.length >= LONG;
  /** What laying a long value out again costs, unless `has` finds what it keeps. */
  const cost = (paragraph: ParagraphToMeasure, has: (found: Kept, key: string) => boolean) => {
    const value = paragraph.value;
    if (!long(value)) return 0;
    const found = kept.get(value);
    const again =
      kept.clashes(value) || (found !== undefined && !has(found, keyOf(settingsOf(paragraph))));
    return again ? value.length : 0;
  };
  const entry = (value: string): Kept => {
    let found = kept.get(value);
    if (!found) kept.set(value, (found = { boxes: undefined, last: undefined }));
    return found;
  };
  const layout = (paragraph: ParagraphToMeasure): ParagraphLayout => {
    const value = paragraph.value;
    if (!long(value)) return layoutParagraph(paragraph);
    const settings = settingsOf(paragraph);
    const key = keyOf(settings);
    const found = entry(value);
    if (found.last?.key !== key) {
      found.last = { key, layout: layOut(settings, parseParagraph(value)) };
    }
    return found.last.layout;
  };
  const box = (paragraph: ParagraphToMeasure): ParagraphMeasure["corners"] => {
    const value = paragraph.value;
    let ink: Ink;
    if (!long(value)) ink = layoutParagraph(paragraph).ink;
    else {
      const settings = settingsOf(paragraph);
      const key = keyOf(settings);
      const found = entry(value);
      found.boxes ??= new Map();
      if (found.boxes.has(key)) ink = found.boxes.get(key);
      else found.boxes.set(key, (ink = layOut(settings, parseParagraph(value)).ink));
    }
    return ink && corners(placer(paragraph), ink);
  };
  return {
    layout,
    box,
    again: (paragraph) => cost(paragraph, (found, key) => found.last?.key === key),
    boxAgain: (paragraph) => cost(paragraph, (found, key) => found.boxes?.has(key) ?? false),
  };
}

/** The fields of a paragraph its layout reads that a `TextStyle` holds. */
const STYLED = ["font", "widthFactor", "obliqueAngle"] as const;

/** The fields of a paragraph its layout reads that only the paragraph holds. */
const OWN = [
  "value",
  "height",
  "width",
  "at",
  "rotation",
  "align",
  "valign",
  "lineSpacing",
  "lineSpacingStyle",
] as const;

/**
 * A paragraph in its style, as `measureParagraph` takes it: the font, the width factor and the
 * oblique angle from the style where it has them, and the rest from the paragraph. Only those
 * fields are read.
 */
export function paragraphInStyle(
  paragraph: ParagraphToMeasure,
  style: object | undefined,
): ParagraphToMeasure {
  const out: Record<string, unknown> = {};
  const from = paragraph as unknown as Record<string, unknown>;
  for (const field of OWN) out[field] = from[field];
  for (const field of STYLED) {
    out[field] =
      typeof style === "object" && style !== null && Object.hasOwn(style, field)
        ? (style as Record<string, unknown>)[field]
        : from[field];
  }
  return out as unknown as ParagraphToMeasure;
}

/**
 * The attachment an MTEXT holds for a paragraph's `align` and `valign`: 1 to 3 along the top,
 * left to right, 4 to 6 along the middle and 7 to 9 along the bottom.
 */
export function paragraphAttachment(
  paragraph: Pick<ParagraphToMeasure, "align" | "valign">,
): number {
  const across = paragraph.align === "center" ? 1 : paragraph.align === "right" ? 2 : 0;
  const down = paragraph.valign === "middle" ? 1 : paragraph.valign === "bottom" ? 2 : 0;
  return 1 + across + 3 * down;
}

/** The `align` and `valign` of an MTEXT's attachment, 1 to 9, or undefined for any other number. */
export function attachmentPlace(
  attachment: number,
): { readonly align: ParagraphAlign; readonly valign: ParagraphVerticalAlign } | undefined {
  if (!Number.isInteger(attachment) || attachment < 1 || attachment > 9) return undefined;
  const aligns = ["left", "center", "right"] as const;
  const valigns = ["top", "middle", "bottom"] as const;
  return {
    align: aligns[(attachment - 1) % 3]!,
    valign: valigns[Math.floor((attachment - 1) / 3)]!,
  };
}

/** How an MTEXT holds a paragraph's line spacing style: 1 for at least, 2 for exactly. */
export function lineSpacingStyleCode(
  paragraph: Pick<ParagraphToMeasure, "lineSpacingStyle">,
): 1 | 2 {
  return paragraph.lineSpacingStyle === "exactly" ? 2 : 1;
}
