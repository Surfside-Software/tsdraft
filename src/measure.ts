// How long a text plots, where its box lies and how far apart the lines of a text of several
// lines are. This is the one measure of a text: the extents, `toSVG` and `inspectText` all take
// it from here.
import type { Point, TextAlign, TextVerticalAlign } from "./drawing.ts";
import { FONT_METRICS, FONT_METRICS_RANGES, type FontMetrics } from "./font-metrics.ts";
import { fontInfo, STANDARD_FONT } from "./fonts.ts";
import { written } from "./format.ts";
import { Strings } from "./shape.ts";

/** A text to measure. A `Text` and its `TextStyle` spread into one object are one. */
export interface TextToMeasure {
  readonly value: string;
  /** The height of a capital. */
  readonly height: number;
  /** One of `FONTS`. Defaults to `txt.shx`, the font of the `Standard` style. */
  readonly font?: string;
  /** Defaults to 1. */
  readonly widthFactor?: number;
  /** Degrees to the right. Defaults to 0. */
  readonly obliqueAngle?: number;
  /** The point `align` and `valign` justify the text to. Defaults to `[0, 0]`. */
  readonly at?: Point;
  /** Degrees counterclockwise. Defaults to 0. */
  readonly rotation?: number;
  /** Defaults to `"left"`. */
  readonly align?: TextAlign;
  /** Defaults to `"baseline"`. */
  readonly valign?: TextVerticalAlign;
}

/** Where a text plots, as `measureText` gives it. */
export interface TextMeasure {
  /** How long the text is along its baseline, from where it starts to draw to where it ends. */
  readonly length: number;
  /**
   * The box its capitals fill, turned as the text is: the start and the end of the baseline,
   * then the end and the start of the line along the top of a capital. An oblique angle
   * leans the box as it leans the letters.
   */
  readonly corners: readonly [Point, Point, Point, Point];
  /**
   * How far below the baseline the font's letters reach, as the tail of a "g" does. In a
   * slanted text they reach as far back along it in proportion.
   */
  readonly descent: number;
  /**
   * True for an estimate: the text has a character outside U+0020 to U+007E and U+00A0 to
   * U+00FF, which is taken to be as wide as "?", or it holds "%%", or its font is not one of
   * `FONTS`, or it is centered or right-justified and starts or ends with a space.
   */
  readonly approximate: boolean;
}

/** What the leading CAD app draws for a control code, each as one character. */
const CODES: Readonly<Record<string, string>> = { d: "°", p: "±", c: "Ø" };

/** A text's value with the degree, plus-or-minus and diameter codes as the characters they draw. */
export function drawnValue(value: string): string {
  return value.includes("%%")
    ? value.replace(/%%([dpc])/gi, (_, c: string) => CODES[c.toLowerCase()]!)
    : value;
}

/** Where a character's numbers are in a font's tables, or -1 for one they do not hold. */
export function tableIndex(code: number): number {
  let before = 0;
  for (const [first, last] of FONT_METRICS_RANGES) {
    if (code >= first && code <= last) return before + code - first;
    before += last - first + 1;
  }
  return -1;
}

/** Where the numbers of "?" are, which stand for a character the tables do not hold. */
export const UNKNOWN = tableIndex("?".charCodeAt(0));

/**
 * The numbers of a font, and whether they are its own: a font that is not one of `FONTS` is
 * measured in `txt.shx`.
 */
export function fontMetrics(font: string | undefined): {
  readonly metrics: FontMetrics;
  readonly known: boolean;
} {
  const name = font ?? STANDARD_FONT;
  const known = fontInfo(name) !== undefined && Object.hasOwn(FONT_METRICS, name);
  return { metrics: known ? FONT_METRICS[name]! : FONT_METRICS[STANDARD_FONT]!, known };
}

/** A text before it is turned and moved to its point: X along its baseline, Y up it. */
export interface TextLayout {
  /** Where the text starts and ends to draw along its baseline, from its point. */
  readonly start: number;
  readonly end: number;
  /**
   * How far from its first point the text ends to draw: the advances of its characters and what
   * the last one adds or takes off. Its first point is `end - advance` along it from its point.
   */
  readonly advance: number;
  /**
   * How far its characters' advances alone take it from its first point: what a TrueType font's
   * glyphs span as the leading CAD app plots them.
   */
  readonly advances: number;
  /** How far the baseline is above the point. */
  readonly baseline: number;
  /** How far along the text the top of a capital lies from its foot. */
  readonly lean: number;
  readonly descent: number;
  readonly approximate: boolean;
}

/** What a text's value gives its layout in one font, read character by character. */
interface Read {
  /** How far the first character starts to draw from where it is placed, at height 1. */
  readonly head: number | undefined;
  /** The advances of the characters and what the last one adds, at height 1. */
  readonly width: number;
  /** The advances of the characters alone, at height 1. */
  readonly advances: number;
  /** True when it holds `%%` or a character the font's numbers do not cover. */
  readonly odd: boolean;
  /** True when it starts or ends with a space as it is drawn. */
  readonly spaced: boolean;
}

function read(value: string, metrics: FontMetrics): Read {
  const drawn = drawnValue(value);
  let odd = value.includes("%%");
  let width = 0;
  let head: number | undefined;
  let tail = 0;
  // By character, so that one outside the Basic Multilingual Plane counts once.
  for (const character of drawn) {
    let index = tableIndex(character.codePointAt(0)!);
    if (index < 0) {
      index = UNKNOWN;
      odd = true;
    }
    head ??= metrics.heads[index]!;
    width += metrics.advances[index]!;
    tail = metrics.tails[index]!;
  }
  return {
    head,
    width: width + tail,
    advances: width,
    odd,
    spaced: /^[ \u00a0]|[ \u00a0]$/.test(drawn),
  };
}

/**
 * Lays a text out about its point. Its length is the advances of its characters and what the
 * last one adds or takes off, from where the first starts to draw. A centered text has its
 * point half way between where it starts and ends to draw, and a right-justified one where it
 * ends. Up the text, the point of a top-justified text is one height above the baseline, of a
 * middle one half a height, and of a bottom one as far below it as the font reaches.
 */
export function layoutText(text: TextToMeasure): TextLayout {
  return layOut(text, read);
}

function layOut(
  text: TextToMeasure,
  reading: (value: string, metrics: FontMetrics) => Read,
): TextLayout {
  const { metrics, known } = fontMetrics(text.font);
  const { head, width, advances, odd, spaced } = reading(text.value, metrics);
  // A centered or right-justified text placed by a space at either end may plot elsewhere.
  const approximate =
    !known || odd || ((text.align === "center" || text.align === "right") && spaced);
  const along = text.height * (text.widthFactor ?? 1);
  const [from, to] = [(head ?? 0) * along, width * along];
  // The text's first point, which its first character is drawn from.
  const first = text.align === "center" ? -(from + to) / 2 : text.align === "right" ? -to : 0;
  // A text is slanted after it is widened, so the width factor does not widen the lean.
  const lean = Math.tan(((text.obliqueAngle ?? 0) * Math.PI) / 180) * text.height;
  return {
    start: first + from,
    end: first + to,
    advance: to,
    advances: advances * along,
    baseline:
      text.valign === "top"
        ? -text.height
        : text.valign === "middle"
          ? -text.height / 2
          : text.valign === "bottom"
            ? metrics.below * text.height
            : 0,
    lean: Number.isFinite(lean) ? lean : 0,
    descent: metrics.below * text.height,
    approximate,
  };
}

/** The shortest value a `Measurer` reads only once. */
const LONG = 256;

/** `layoutText` and `measureText` for the texts of one call, which may share their values. */
export interface Measurer {
  layout(text: TextToMeasure): TextLayout;
  measure(text: TextToMeasure): TextMeasure;
  /**
   * True when measuring a value would read it again: a long one that took the place of another
   * of its length, as `Strings` keeps them. The caller pays for it by its length.
   */
  again(value: string): boolean;
}

/**
 * Measures as `measureText` does, and reads each value of `LONG` characters or more once for
 * each font, so that texts and attributes that share one long string cost what one does. It
 * holds those values until it is dropped, so make one for a call.
 */
export function measurer(): Measurer {
  const reads = new Strings<Map<FontMetrics, Read>>();
  const reading = (value: string, metrics: FontMetrics): Read => {
    if (value.length < LONG) return read(value, metrics);
    let fonts = reads.get(value);
    if (!fonts) reads.set(value, (fonts = new Map()));
    let found = fonts.get(metrics);
    if (!found) fonts.set(metrics, (found = read(value, metrics)));
    return found;
  };
  const layout = (text: TextToMeasure): TextLayout => layOut(text, reading);
  return {
    layout,
    measure: (text) => placed(text, layout(text)),
    again: (value) => value.length >= LONG && reads.clashes(value),
  };
}

/** The fields of a text `measureText` reads that a `TextStyle` holds. */
const STYLED = ["font", "widthFactor", "obliqueAngle"] as const;

/** The fields of a text `measureText` reads that only the text holds. */
const OWN = ["value", "height", "at", "rotation", "align", "valign"] as const;

/**
 * A text in its style, as `measureText` takes it: the font, the width factor and the oblique
 * angle from the style where it has them, as `{ ...text, ...style }` gives them, and the rest
 * from the text, since a style holds no value, height, place or justification. Only those fields
 * are read, so a text placed many times costs the same whatever else the two hold.
 */
export function inStyle(text: TextToMeasure, style: object | undefined): TextToMeasure {
  if (typeof style !== "object" || style === null) return text;
  const out: Record<string, unknown> = {};
  const from = text as unknown as Record<string, unknown>;
  for (const field of OWN) out[field] = from[field];
  for (const field of STYLED) {
    out[field] = Object.hasOwn(style, field)
      ? (style as Record<string, unknown>)[field]
      : from[field];
  }
  return out as unknown as TextToMeasure;
}

/**
 * How far apart the leading CAD app sets the lines of a text of several lines, such as a leader's
 * note, from one baseline to the next: 5/3 of the height of a capital. A line whose letters reach
 * above a capital or below the baseline pushes the next line that much further, as the round
 * letters of a TrueType font do by about a fiftieth of the height,
 * and a letter with a tail by more.
 *
 * ```ts
 * lineSpacing(0.09375); // 0.15625: a note 3/32" tall sets its lines 5/32" apart
 * ```
 */
export function lineSpacing(height: number): number {
  return (height * 5) / 3;
}

/**
 * Measures a text as it plots: its length, and the box of its capitals where its
 * justification, its rotation and its style's width factor and oblique angle put it. The
 * widths are those of the font's characters from U+0020 to U+007E and U+00A0 to U+00FF. Any
 * other character is taken to be as wide as "?", and `%%d`, `%%p` and `%%c` count as the one
 * character each draws: `approximate` is then true. Kerning is not counted.
 *
 * ```ts
 * measureText({ value: "GENERAL NOTES", height: 0.125 }).length; // in txt.shx
 * measureText({ value: "GENERAL NOTES", height: 0.125, font: "Arial", widthFactor: 0.9 });
 * ```
 */
export function measureText(text: TextToMeasure): TextMeasure {
  return placed(text, layoutText(text));
}

/** A text's measure from its layout. */
function placed(text: TextToMeasure, layout: TextLayout): TextMeasure {
  const { start, end, baseline, lean, descent, approximate } = layout;
  // Turned by its rotation as the writers write it, group 50 with 6 decimals, which leave a whole
  // number as it is.
  const rotation = text.rotation ?? 0;
  const turn = ((Number.isInteger(rotation) ? rotation : written(rotation)) * Math.PI) / 180;
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
  const [x, y] = text.at ?? [0, 0];
  const place = (along: number, up: number): Point => [
    x + along * cos - up * sin,
    y + along * sin + up * cos,
  ];
  const top = baseline + text.height;
  return {
    length: end - start,
    corners: [
      place(start, baseline),
      place(end, baseline),
      place(end + lean, top),
      place(start + lean, top),
    ],
    descent,
    approximate,
  };
}
