// The fonts a text style may name. This is the one list: `lint`, the writers and `toSVG` all
// read it.

/** What tsdraft knows of a font. */
export interface FontInfo {
  /** The font file AutoCAD stores for a style of this font. */
  readonly file: string;
  /**
   * For a TrueType font, the pitch and family number AutoCAD stores beside the typeface.
   * Missing for an SHX font.
   */
  readonly pitchAndFamily?: number;
  /** The CSS `font-family` that `toSVG` draws the font with, ending in a generic family. */
  readonly family: string;
  /**
   * For a TrueType font, the top of its capital `A` as a share of the font's size. AutoCAD
   * draws a text so that this `A` is as tall as the text's height, so `toSVG` draws the font
   * this much larger. It is not always the cap height a font states: the `A` of Times New
   * Roman is taller than its `H`.
   */
  readonly capHeight?: number;
}

/**
 * Every font a text style may have, by the name a style gives it, which is the name AutoCAD
 * stores: the file name for an SHX font, the typeface for a TrueType font. The SHX fonts are
 * drafting alphabets that AutoCAD 2025 installs, and the TrueType fonts come with Windows. The
 * list is closed because AutoCAD draws text in a font it does not have in another font, and its
 * `AUDIT` reports nothing.
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

/** The text style every drawing has, in the spelling AutoCAD gives it. Its font is `txt.shx`. */
export const STANDARD_TEXT_STYLE = "Standard";

/** The font of the `Standard` text style. */
export const STANDARD_FONT: Font = "txt.shx";

/** What tsdraft knows of a font, or undefined for a name that is not in `FONTS`. */
export function fontInfo(name: string): FontInfo | undefined {
  return Object.hasOwn(FONTS, name) ? FONTS[name as Font] : undefined;
}
