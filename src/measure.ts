// How long a text plots and where its box lies. This is the one measure of a text: the
// extents, `toSVG` and `inspectText` all take it from here.
import type { Point, TextAlign, TextVerticalAlign } from "./drawing.ts";
import { FONT_METRICS, FONT_METRICS_RANGES, type FontMetrics } from "./font-metrics.ts";
import { STANDARD_FONT } from "./fonts.ts";

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

/** What AutoCAD draws for a control code, each as one character. */
const CODES: Readonly<Record<string, string>> = { d: "°", p: "±", c: "Ø" };

/** A text's value with the degree, plus-or-minus and diameter codes as the characters they draw. */
export function drawnValue(value: string): string {
  return value.includes("%%")
    ? value.replace(/%%([dpc])/gi, (_, c: string) => CODES[c.toLowerCase()]!)
    : value;
}

/** Where a character's numbers are in a font's tables, or -1 for one they do not hold. */
function tableIndex(code: number): number {
  let before = 0;
  for (const [first, last] of FONT_METRICS_RANGES) {
    if (code >= first && code <= last) return before + code - first;
    before += last - first + 1;
  }
  return -1;
}

const UNKNOWN = tableIndex("?".charCodeAt(0));

/** A text before it is turned and moved to its point: X along its baseline, Y up it. */
export interface TextLayout {
  /** Where the text starts and ends to draw along its baseline, from its point. */
  readonly start: number;
  readonly end: number;
  /** How far the baseline is above the point. */
  readonly baseline: number;
  /** How far along the text the top of a capital lies from its foot. */
  readonly lean: number;
  readonly descent: number;
  readonly approximate: boolean;
}

/**
 * Lays a text out about its point. Its length is the advances of its characters and what the
 * last one adds or takes off, from where the first starts to draw. A centered text has its
 * point half way between where it starts and ends to draw, and a right-justified one where it
 * ends. Up the text, the point of a top-justified text is one height above the baseline, of a
 * middle one half a height, and of a bottom one as far below it as the font reaches.
 */
export function layoutText(text: TextToMeasure): TextLayout {
  const known: FontMetrics | undefined = Object.hasOwn(FONT_METRICS, text.font ?? STANDARD_FONT)
    ? FONT_METRICS[text.font ?? STANDARD_FONT]
    : undefined;
  const metrics = known ?? FONT_METRICS[STANDARD_FONT]!;
  const value = drawnValue(text.value);
  // A centered or right-justified text placed by a space at either end may plot elsewhere.
  let approximate =
    known === undefined ||
    text.value.includes("%%") ||
    ((text.align === "center" || text.align === "right") && /^[ \u00a0]|[ \u00a0]$/.test(value));
  let width = 0;
  let head: number | undefined;
  let tail = 0;
  // By character, so that one outside the Basic Multilingual Plane counts once.
  for (const character of value) {
    let index = tableIndex(character.codePointAt(0)!);
    if (index < 0) {
      index = UNKNOWN;
      approximate = true;
    }
    head ??= metrics.heads[index]!;
    width += metrics.advances[index]!;
    tail = metrics.tails[index]!;
  }
  const along = text.height * (text.widthFactor ?? 1);
  const [from, to] = [(head ?? 0) * along, (width + tail) * along];
  // The text's first point, which its first character is drawn from.
  const first = text.align === "center" ? -(from + to) / 2 : text.align === "right" ? -to : 0;
  // A text is slanted after it is widened, so the width factor does not widen the lean.
  const lean = Math.tan(((text.obliqueAngle ?? 0) * Math.PI) / 180) * text.height;
  return {
    start: first + from,
    end: first + to,
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
  const { start, end, baseline, lean, descent, approximate } = layoutText(text);
  const turn = ((text.rotation ?? 0) * Math.PI) / 180;
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
