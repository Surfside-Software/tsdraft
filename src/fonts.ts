// The fonts a text style may name. This is the one list: `lint`, the writers and `toSVG` all
// read it.

/** What tsdraft knows of a font. */
export interface FontInfo {
  /** The font file the leading CAD app stores for a style of this font. */
  readonly file: string;
  /**
   * For a TrueType font, the pitch and family number the leading CAD app stores beside the
   * typeface. Missing for an SHX font.
   */
  readonly pitchAndFamily?: number;
  /** The CSS `font-family` that `toSVG` draws the font with, ending in a generic family. */
  readonly family: string;
  /**
   * For a TrueType font, the top of its capital `A` as a share of the font's size. The leading CAD
   * app draws a text so that this `A` is as tall as the text's height, so `toSVG` draws the font
   * this much larger. It is not always the cap height a font states: the `A` of Times New
   * Roman is taller than its `H`.
   */
  readonly capHeight?: number;
}

/**
 * Every font a text style may have, by the name a style gives it, which is the name the leading CAD
 * app stores: the file name for an SHX font, the typeface for a TrueType font. The SHX fonts are
 * drafting alphabets that the 2025 release of that app installs, and the TrueType fonts come with
 * Windows. The list is closed because that app draws text in a font it does not have in another
 * font, and its `AUDIT` reports nothing.
 */
export const FONTS = {
  "txt.shx": { file: "txt.shx", family: "monospace" },
  "monotxt.shx": { file: "monotxt.shx", family: "monospace" },
  "simplex.shx": { file: "simplex.shx", family: "sans-serif" },
  "romans.shx": { file: "romans.shx", family: "sans-serif" },
  "romand.shx": { file: "romand.shx", family: "sans-serif" },
  "romanc.shx": { file: "romanc.shx", family: "serif" },
  "romant.shx": { file: "romant.shx", family: "serif" },
  "complex.shx": { file: "complex.shx", family: "serif" },
  "italic.shx": { file: "italic.shx", family: "sans-serif" },
  "isocp.shx": { file: "isocp.shx", family: "sans-serif" },
  "isoct.shx": { file: "isoct.shx", family: "sans-serif" },
  Arial: {
    file: "arial.ttf",
    pitchAndFamily: 34,
    family: "Arial, Helvetica, sans-serif",
    capHeight: 0.716,
  },
  Calibri: {
    file: "calibri.ttf",
    pitchAndFamily: 34,
    family: "Calibri, Carlito, sans-serif",
    capHeight: 0.6348,
  },
  Consolas: {
    file: "consola.ttf",
    pitchAndFamily: 49,
    family: "Consolas, monospace",
    capHeight: 0.638,
  },
  "Courier New": {
    file: "cour.ttf",
    pitchAndFamily: 49,
    family: '"Courier New", Courier, monospace',
    capHeight: 0.571,
  },
  Georgia: { file: "georgia.ttf", pitchAndFamily: 18, family: "Georgia, serif", capHeight: 0.7026 },
  "Segoe UI": {
    file: "segoeui.ttf",
    pitchAndFamily: 34,
    family: '"Segoe UI", sans-serif',
    capHeight: 0.7,
  },
  Tahoma: {
    file: "tahoma.ttf",
    pitchAndFamily: 34,
    family: "Tahoma, sans-serif",
    capHeight: 0.727,
  },
  "Times New Roman": {
    file: "times.ttf",
    pitchAndFamily: 18,
    family: '"Times New Roman", Times, serif',
    capHeight: 0.6772,
  },
  "Trebuchet MS": {
    file: "trebuc.ttf",
    pitchAndFamily: 34,
    family: '"Trebuchet MS", sans-serif',
    capHeight: 0.7251,
  },
  Verdana: {
    file: "verdana.ttf",
    pitchAndFamily: 34,
    family: "Verdana, sans-serif",
    capHeight: 0.727,
  },
} as const satisfies Readonly<Record<string, FontInfo>>;

/** The name of a font a text style may have. */
export type Font = keyof typeof FONTS;

/** The text style every drawing has, in the spelling the leading CAD app gives it. Its font is `txt.shx`. */
export const STANDARD_TEXT_STYLE = "Standard";

/** The font of the `Standard` text style. */
export const STANDARD_FONT: Font = "txt.shx";

/** The length of the longest name in `FONTS`. */
const LONGEST_FONT = Math.max(...Object.keys(FONTS).map((name) => name.length));

/**
 * What tsdraft knows of a font, or undefined for a name that is not in `FONTS`. A name longer than
 * any font's is not looked up, since looking up a long name can take time in proportion to it.
 */
export function fontInfo(name: string): FontInfo | undefined {
  return typeof name === "string" && name.length <= LONGEST_FONT && Object.hasOwn(FONTS, name)
    ? FONTS[name as Font]
    : undefined;
}

/** Each font of `FONTS` by its name, its file and its file without the extension, in lower case. */
const FONT_NAMES: ReadonlyMap<string, Font> = new Map(
  (Object.entries(FONTS) as [Font, FontInfo][]).flatMap(([font, info]) => [
    [font.toLowerCase(), font],
    [info.file.toLowerCase(), font],
    [info.file.toLowerCase().replace(/\.(shx|ttf)$/, ""), font],
  ]),
);

/** The longest key of `FONT_NAMES`. */
const LONGEST_FONT_NAME = Math.max(...[...FONT_NAMES.keys()].map((key) => key.length));

/** The start of each name a font of `FONTS` may go by, longest first, such as `romans` or `times`. */
const FONT_STEMS: readonly (readonly [string, Font])[] = [...FONT_NAMES]
  .map(([key, font]) => [key.replace(/\.(shx|ttf)$/, "").split(" ")[0]!, font] as const)
  .sort((a, b) => b[0].length - a[0].length);

/**
 * The font of `FONTS` a text set in `named` measures in: the font itself when `named` is one,
 * by its name or its file, in any case and with or without its folder and extension. A font
 * tsdraft does not have, such as a firm's SHX font or another TrueType family, measures in the
 * font of `FONTS` whose name it starts with, such as `romans.shx` for `romans2.shx` or `Arial` for
 * `Arial Narrow`, or else in `Arial`. `exact` is false for those.
 */
export function nearestFont(named: string): { readonly font: Font; readonly exact: boolean } {
  const key = named
    .trim()
    .replace(/^.*[\\/]/, "")
    .toLowerCase();
  const font = key.length <= LONGEST_FONT_NAME ? FONT_NAMES.get(key) : undefined;
  if (font !== undefined) return { font, exact: true };
  const bare = key.replace(/\.[a-z0-9]{3}$/, "");
  const stem = FONT_STEMS.find(([start]) => bare.startsWith(start));
  return { font: stem?.[1] ?? "Arial", exact: false };
}
