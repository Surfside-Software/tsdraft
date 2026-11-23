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
  /**
   * For a TrueType font, its bold face: the file Windows installs it as, and the top of its own
   * capital `A` where it is not the regular face's. The leading CAD app makes the bold face's own
   * `A` as tall as the text's height.
   */
  readonly bold?: { readonly file: string; readonly capHeight?: number };
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
    bold: { file: "arialbd.ttf" },
  },
  Calibri: {
    file: "calibri.ttf",
    pitchAndFamily: 34,
    family: "Calibri, Carlito, sans-serif",
    capHeight: 0.6348,
    bold: { file: "calibrib.ttf" },
  },
  Consolas: {
    file: "consola.ttf",
    pitchAndFamily: 49,
    family: "Consolas, monospace",
    capHeight: 0.638,
    bold: { file: "consolab.ttf" },
  },
  "Courier New": {
    file: "cour.ttf",
    pitchAndFamily: 49,
    family: '"Courier New", Courier, monospace',
    capHeight: 0.571,
    bold: { file: "courbd.ttf", capHeight: 0.5923 },
  },
  Georgia: {
    file: "georgia.ttf",
    pitchAndFamily: 18,
    family: "Georgia, serif",
    capHeight: 0.7026,
    bold: { file: "georgiab.ttf" },
  },
  "Segoe UI": {
    file: "segoeui.ttf",
    pitchAndFamily: 34,
    family: '"Segoe UI", sans-serif',
    capHeight: 0.7,
    bold: { file: "segoeuib.ttf" },
  },
  Tahoma: {
    file: "tahoma.ttf",
    pitchAndFamily: 34,
    family: "Tahoma, sans-serif",
    capHeight: 0.727,
    bold: { file: "tahomabd.ttf" },
  },
  "Times New Roman": {
    file: "times.ttf",
    pitchAndFamily: 18,
    family: '"Times New Roman", Times, serif',
    capHeight: 0.6772,
    bold: { file: "timesbd.ttf", capHeight: 0.6758 },
  },
  "Trebuchet MS": {
    file: "trebuc.ttf",
    pitchAndFamily: 34,
    family: '"Trebuchet MS", sans-serif',
    capHeight: 0.7251,
    bold: { file: "trebucbd.ttf" },
  },
  Verdana: {
    file: "verdana.ttf",
    pitchAndFamily: 34,
    family: "Verdana, sans-serif",
    capHeight: 0.727,
    bold: { file: "verdanab.ttf" },
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
  return isFont(name) ? FONTS[name] : undefined;
}

/** Whether a name is a font's of `FONTS`, as a caller in plain JavaScript may give any value. */
export function isFont(name: string): name is Font {
  return typeof name === "string" && name.length <= LONGEST_FONT && Object.hasOwn(FONTS, name);
}

/**
 * The top of a TrueType font's capital `A` as a share of its size, in its bold face for `bold`,
 * which the leading CAD app makes as tall as a text's height. Undefined for an SHX font.
 */
export function capHeightOf(font: string, bold = false): number | undefined {
  const info = fontInfo(font);

  return (bold ? info?.bold?.capHeight : undefined) ?? info?.capHeight;
}

/** Each font of `FONTS` by its name, its file and its file without the extension, in lower case. */
const FONT_NAMES: ReadonlyMap<string, Font> = new Map(
  // SAFETY: FONTS is a literal whose own keys are the fonts and whose values their FontInfo.
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

/** The font of `FONTS` a text measures in, and whether it is the font the text names. */
export interface NearestFont {
  readonly font: Font;
  readonly exact: boolean;
}

/**
 * The font of `FONTS` a text set in `named` measures in: the font itself when `named` is one,
 * by its name or its file, in any case and with or without its folder and extension. A font
 * tsdraft does not have, such as a firm's SHX font or another TrueType family, measures in the
 * font of `FONTS` whose name it starts with, such as `romans.shx` for `romans2.shx` or `Arial` for
 * `Arial Narrow`, or else in `Arial`. `exact` is false for those.
 */
export function nearestFont(named: string): NearestFont {
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
