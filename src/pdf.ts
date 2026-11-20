// A drawing's layouts as a PDF: a page for each sheet, made from the picture `toSVG` draws of
// it. `toSVG` holds every rule of what a sheet plots, so this file decides nothing about the
// drawing: it turns the elements of that picture into the operators of a page.
import type { XrefDrawings } from "./blocks.ts";
import type { Drawing } from "./drawing.ts";
import { FONT_METRICS, FONT_METRICS_RANGES, type FontMetrics } from "./font-metrics.ts";
import { FONTS, fontInfo, type Font, capHeightOf } from "./fonts.ts";
import { paperInfo } from "./papers.ts";
import { Sha256 } from "./sha256.ts";
import { filled } from "./shape.ts";
import { SHEET_PICTURE, toSVG } from "./svg.ts";
import { readTrueType, type TrueType } from "./truetype.ts";

export interface PdfOptions {
  /** The layouts to plot, in this order. Defaults to every layout, in the drawing's order. */
  readonly layouts?: readonly string[];
  /**
   * The drawing each xref stands for, by the xref's name, as `toSVG` takes them, with the
   * drawings its attachments stand for when given as `{ drawing, xrefs }`. An xref with no
   * drawing given plots nothing.
   */
  readonly xrefs?: XrefDrawings;
  /**
   * Compresses each page's content: a function that gives the zlib form of its bytes, such as
   * Node's `zlib.deflateSync`. Without it the content is written as it is.
   */
  readonly deflate?: (bytes: Uint8Array) => Uint8Array;
  /**
   * The TrueType file of each font the texts are set in, by the font's name in `FONTS`, such as
   * `{ Arial: bytes }`: the font's own file, or one made to its widths. The PDF embeds each, cut
   * to the letters it uses. A run of a paragraph in bold is set in the file of its font's bold
   * face, by the font's name and ` Bold`, such as `{ "Arial Bold": bytes }`, which `boldFontKey`
   * gives. A text in a font with no file here, or with a file `pdfFace` does
   * not take, and a text in an SHX font, is set in a standard face that is not embedded.
   */
  readonly fonts?: Readonly<Record<string, Uint8Array>>;
  /**
   * Told, for each page that has any, the characters of its texts that the page's faces lack,
   * which it sets as `?`: a character the embedded font has no glyph for, or one outside
   * Windows-1252, such as `≥`, in a standard face. `page` counts from 0, which tells two sheets
   * of one name apart in a list of sheets.
   */
  readonly missing?: (layout: string, characters: string, page: number) => void;
  /** The document's title, which a viewer shows in place of the file's name. */
  readonly title?: string;
}

/** One sheet of a set whose sheets are drawings of their own. */
export interface PdfSheet {
  readonly drawing: Drawing;
  /** The name of the layout of `drawing` that is the sheet. */
  readonly layout: string;
  /** The drawing each xref of `drawing` stands for, by name, as `toSVG` takes them. */
  readonly xrefs?: XrefDrawings;
}

/**
 * Plots a drawing's layouts as one PDF, a page for each, in the order of `options.layouts` or
 * of the drawing. Each page is the layout's paper at its size, and shows what `toSVG` draws of
 * the layout: each viewport's view at its scale, clipped to its rectangle, every line in the
 * color the layout's plot style table plots it in and as wide as its lineweight, with round
 * ends, and each text where it plots, as high and as long. One sheet is
 * `toPDF(drawing, { layouts: [name] })`. `lint` is not run: a page shows what the picture shows.
 *
 * The same drawing and options always give the same bytes.
 *
 * @throws RangeError when the drawing has no layout, when it has no layout of a name in
 *   `options.layouts`, and when `toSVG` refuses to draw a sheet.
 */
export function toPDF(drawing: Drawing, options?: PdfOptions): Uint8Array;
/**
 * Plots a set whose sheets are drawings of their own as one PDF, a page for each sheet in
 * order, each plotted as `toPDF` plots a layout.
 *
 * @throws RangeError when `sheets` is empty, and as `toPDF` throws for a sheet.
 */
export function toPDF(
  sheets: readonly PdfSheet[],
  options?: Omit<PdfOptions, "layouts" | "xrefs">,
): Uint8Array;
export function toPDF(given: Drawing | readonly PdfSheet[], options: PdfOptions = {}): Uint8Array {
  // A list is read up to its first empty slot, as every list of the library is.
  const sheets: readonly PdfSheet[] = Array.isArray(given)
    ? filled(given as readonly PdfSheet[])
    : (options.layouts === undefined
        ? filled((given as Drawing).layouts).map((layout) => layout?.name)
        : filled(options.layouts)
      ).map((layout) => ({
        drawing: given as Drawing,
        layout: layout!,
        ...(options.xrefs ? { xrefs: options.xrefs } : {}),
      }));
  if (sheets.length === 0) throw new RangeError("There is no layout to plot");
  sheets.forEach((sheet, i) => {
    if (
      typeof sheet !== "object" ||
      sheet === null ||
      typeof sheet.layout !== "string" ||
      typeof sheet.drawing !== "object" ||
      sheet.drawing === null
    ) {
      throw new RangeError(`Sheet ${i} to plot is not a drawing and the name of its layout`);
    }
  });
  const pdf = new PdfWriter(options);
  for (const { drawing, layout, xrefs } of sheets) {
    pdf.page(toSVG(drawing, xrefs ? { layout, xrefs } : { layout }));
  }
  return pdf.finish();
}

/**
 * A PDF with a page for each picture, in order, as `toPDF` plots it. Each must be a picture this
 * copy of tsdraft's `toSVG` drew of a layout, or one of a copy whose pictures of layouts have
 * the same format, which their `data-picture` gives.
 *
 * @throws RangeError when a picture is not such a picture, naming the first element or
 *   attribute it does not draw, so that no page leaves something out unsaid.
 */
export function svgToPDF(
  pictures: readonly string[],
  options: Omit<PdfOptions, "layouts" | "xrefs"> = {},
): Uint8Array {
  if (pictures.length === 0) throw new RangeError("A PDF needs at least one picture");
  const pdf = new PdfWriter(options);
  for (const picture of pictures) pdf.page(picture);
  return pdf.finish();
}

/** A map of the plane, as SVG's `matrix(a b c d e f)` and a PDF's `cm` hold one. */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** The map that applies `inner` and then `outer`. */
function compose(outer: Matrix, inner: Matrix): Matrix {
  return [
    outer[0] * inner[0] + outer[2] * inner[1],
    outer[1] * inner[0] + outer[3] * inner[1],
    outer[0] * inner[2] + outer[2] * inner[3],
    outer[1] * inner[2] + outer[3] * inner[3],
    outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
    outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** How much a map scales a length, for a map that scales both ways alike. */
function scaleOf(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

/** The most a map stretches a length, whatever way it points: its largest singular value. */
function stretchOf(m: Matrix): number {
  const [a, b, c, d] = m;
  const half = (a * a + b * b + c * c + d * d) / 2;
  const gap = Math.hypot((a * a + b * b - c * c - d * d) / 2, a * c + b * d);
  return Math.sqrt(half + gap);
}

/**
 * A number as a page writes it, with at most `decimals` decimals and never an exponent, which
 * PDF does not read. A number 10^15 or more from 0 is refused: a point that far off the page
 * cannot be written to the precision of one on it.
 */
function real(value: number, decimals: number): string {
  if (!(Math.abs(value) < 1e15)) {
    throw new RangeError(`svgToPDF cannot write ${value}: a page holds numbers under 10^15`);
  }
  let text = value.toFixed(decimals);
  if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
  return text === "-0" ? "0" : text;
}

/** A coordinate or a width of a page, in points: three decimals, which is 1/72,000 inch. */
function num(value: number): string {
  return real(value, 3);
}

/** A transform list as SVG writes it, as one matrix. */
function transformOf(list: string, where: string): Matrix {
  let m = IDENTITY;
  // Read with a cursor, each function and the space around it in turn, so a long list costs
  // what it holds; anything between two that is not space is refused.
  const pattern = /\s*([a-zA-Z]+)\(([^)]*)\)\s*/y;
  while (pattern.lastIndex < list.length) {
    const match = pattern.exec(list);
    if (!match || match[2]!.trim() === "") {
      throw refuse(`the transform ${JSON.stringify(list)}`, where);
    }
    const [name, args] = [
      match[1]!,
      match[2]!
        .trim()
        .split(/[\s,]+/)
        .map(Number),
    ];
    if (!args.every(Number.isFinite)) throw refuse(`the transform ${match[0].trim()}`, where);
    const [a = 0, b, c, d, e, f] = args;
    let step: Matrix;
    if (name === "translate" && args.length <= 2) step = [1, 0, 0, 1, a, b ?? 0];
    else if (name === "scale" && args.length <= 2) step = [a, 0, 0, b ?? a, 0, 0];
    else if (name === "rotate" && (args.length === 1 || args.length === 3)) {
      const r = (a * Math.PI) / 180;
      const turn: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
      const [cx, cy] = [b ?? 0, c ?? 0];
      step = compose([1, 0, 0, 1, cx, cy], compose(turn, [1, 0, 0, 1, -cx, -cy]));
    } else if (name === "skewX" && args.length === 1) {
      step = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0];
    } else if (name === "matrix" && args.length === 6) step = [a, b!, c!, d!, e!, f!];
    else throw refuse(`the transform ${match[0].trim()}`, where);
    m = compose(m, step);
  }
  return m;
}

function refuse(what: string, where: string): RangeError {
  return new RangeError(
    `svgToPDF draws only what toSVG draws of a layout, and not ${what}, in ${where}`,
  );
}

/** The elements `toSVG` writes in a picture of a layout. */
const ELEMENTS = new Set([
  "svg",
  "g",
  "clipPath",
  "rect",
  "line",
  "polyline",
  "polygon",
  "circle",
  "ellipse",
  "path",
  "text",
]);

/** The attributes it writes on them, apart from `data-` ones, which say what an element is. */
const ATTRIBUTES = new Set([
  "xmlns",
  "viewBox",
  "transform",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "visibility",
  "clip-path",
  "id",
  "x",
  "y",
  "width",
  "height",
  "x1",
  "y1",
  "x2",
  "y2",
  "points",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "font-size",
  "font-family",
  "textLength",
  "lengthAdjust",
  "xml:space",
  "font-weight",
]);

/**
 * Text with the four entities `toSVG` escapes with, and the line feed and the tab it writes as
 * `&#10;` and `&#9;`, in their place. Any other `&` is refused.
 */
function unescape(text: string, where: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(amp;|lt;|gt;|quot;|#10;|#9;)?/g, (_, name: string | undefined) => {
    if (name === undefined) throw refuse("an & that is not one toSVG writes", where);
    return (
      { "amp;": "&", "lt;": "<", "gt;": ">", "quot;": '"', "#10;": "\n", "#9;": "\t" } as const
    )[name as "amp;"];
  });
}

/** One of the three faces every PDF reader has without a file, as a font of the page. */
interface Face {
  readonly name:
    | "Helvetica"
    | "Times-Roman"
    | "Courier"
    | "Helvetica-Bold"
    | "Times-Bold"
    | "Courier-Bold";
  /** The font whose widths it is given, which has the same advances. */
  readonly widthsOf: Font;
  /** The height of a capital as a share of the size, as the font it has the widths of has it. */
  readonly capHeight: number;
  /** The height of the face's own capitals, which sets the size of a text in another font. */
  readonly ownCapHeight: number;
  readonly flags: number;
  readonly box: string;
  readonly ascent: number;
  readonly descent: number;
  readonly stem: number;
}

const FACES = {
  sans: {
    name: "Helvetica",
    widthsOf: "Arial",
    capHeight: FONTS.Arial.capHeight,
    ownCapHeight: 0.718,
    flags: 32,
    box: "-166 -225 1000 931",
    ascent: 718,
    descent: -207,
    stem: 88,
  },
  serif: {
    name: "Times-Roman",
    widthsOf: "Times New Roman",
    capHeight: FONTS["Times New Roman"].capHeight,
    ownCapHeight: 0.662,
    flags: 34,
    box: "-168 -218 1000 898",
    ascent: 683,
    descent: -217,
    stem: 84,
  },
  mono: {
    name: "Courier",
    widthsOf: "Courier New",
    capHeight: FONTS["Courier New"].capHeight,
    ownCapHeight: 0.571,
    flags: 33,
    box: "-23 -250 715 805",
    ascent: 629,
    descent: -157,
    stem: 51,
  },
  sansBold: {
    name: "Helvetica-Bold",
    widthsOf: "Arial",
    capHeight: FONTS.Arial.capHeight,
    ownCapHeight: 0.718,
    flags: 262176,
    box: "-170 -228 1003 962",
    ascent: 718,
    descent: -207,
    stem: 140,
  },
  serifBold: {
    name: "Times-Bold",
    widthsOf: "Times New Roman",
    capHeight: FONTS["Times New Roman"].bold.capHeight,
    ownCapHeight: 0.676,
    flags: 262178,
    box: "-168 -218 1000 935",
    ascent: 683,
    descent: -217,
    stem: 139,
  },
  monoBold: {
    name: "Courier-Bold",
    widthsOf: "Courier New",
    capHeight: FONTS["Courier New"].bold.capHeight,
    ownCapHeight: 0.562,
    flags: 262177,
    box: "-113 -250 749 801",
    ascent: 629,
    descent: -157,
    stem: 106,
  },
} as const satisfies Record<string, Face>;

/**
 * The face a text in each font of `FONTS` is set in: the one with the same advances for Arial,
 * Times New Roman and Courier New, and the one of the font's generic family for any other.
 */
const FACE_OF_FONT: ReadonlyMap<string, Face> = new Map(
  Object.entries(FONTS).map(([font, info]) => {
    const generic = info.family.split(",").at(-1)!.trim();
    const face =
      font === "Arial"
        ? FACES.sans
        : font === "Times New Roman"
          ? FACES.serif
          : font === "Courier New"
            ? FACES.mono
            : generic === "serif"
              ? FACES.serif
              : generic === "monospace"
                ? FACES.mono
                : FACES.sans;
    return [font, face];
  }),
);

/** The bold face of each standard face, which has its widths: tsdraft measures bold as regular. */
const BOLD_OF: ReadonlyMap<Face, Face> = new Map<Face, Face>([
  [FACES.sans, FACES.sansBold],
  [FACES.serif, FACES.serifBold],
  [FACES.mono, FACES.monoBold],
]);

/** The key in `fonts` of the bold face of a font: its name and ` Bold`, such as `Arial Bold`. */
export function boldFontKey(font: string): string {
  return `${font} Bold`;
}

/**
 * The face a PDF of tsdraft's sets a text in, for the font its style names, or its bold face for a
 * run of a paragraph a code sets in bold. With `file`, the
 * TrueType file given for the font in `fonts`, it is the PostScript name of the file's font,
 * which the PDF embeds, when the font is a TrueType font of `FONTS` and the file one the PDF can
 * embed. Otherwise it is `Helvetica`, `Times-Roman` or `Courier`, which no PDF embeds: Arial,
 * Times New Roman and Courier New are set in the face with their widths, and every other font in
 * the face of its kind, stretched to the length the text plots. A font that is not one of
 * `FONTS` is set in Courier, as the picture draws it in the font of `Standard`.
 */
export function pdfFace(font: string, file?: Uint8Array, bold = false): string {
  const read = file === undefined ? undefined : embeddable(font, file);
  return read === undefined ? standIn(font, bold).name : read.name;
}

/** The standard face a font is set in when it is not embedded, in bold or not. */
function standIn(font: string | undefined, bold = false): Face {
  const face =
    (typeof font === "string" && Object.hasOwn(FONTS, font) ? FACE_OF_FONT.get(font) : undefined) ??
    FACES.mono;
  return bold ? BOLD_OF.get(face)! : face;
}

/** The font of a file, when it is a TrueType font for a TrueType font of `FONTS` a PDF can embed. */
function embeddable(font: string, file: unknown): TrueType | undefined {
  if (fontInfo(font)?.capHeight === undefined || !(file instanceof Uint8Array)) return undefined;
  const read = readTrueType(file);
  return typeof read === "string" ? undefined : read;
}

/** The characters Windows-1252 puts at 0x80 to 0x9F, by their code there. */
const WIN_ANSI_HIGH: Readonly<Record<number, number>> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

const QUESTION = 0x3f;

/** A control character, which no face sets: U+0000 to U+001F and U+007F to U+009F. */
function control(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/** A character's code in Windows-1252, the encoding of the page's fonts, or `?` for one it lacks. */
function winAnsi(code: number): number {
  if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return code;
  return WIN_ANSI_HIGH[code] ?? QUESTION;
}

/**
 * The advance of each code from 32 to 255 in a face, in thousandths of its size: the advance of
 * the character in the font it stands for, as `measureText` measures it. A character the font's
 * table lacks is as wide as `?`, as `measureText` takes it to be.
 */
function faceWidths(face: Face): number[] {
  const metrics: FontMetrics = FONT_METRICS[face.widthsOf]!;
  const index = (code: number): number => {
    let before = 0;
    for (const [first, last] of FONT_METRICS_RANGES) {
      if (code >= first && code <= last) return before + code - first;
      before += last - first + 1;
    }
    return -1;
  };
  const unknown = metrics.advances[index(QUESTION)]!;
  const widths: number[] = [];
  for (let code = 32; code <= 255; code++) {
    const at = index(code);
    const advance = at < 0 ? unknown : metrics.advances[at]!;
    widths.push(Math.round(advance * face.capHeight * 1_000_000) / 1000);
  }
  return widths;
}

/** A string as a PDF holds a text string: UTF-16 with its byte order mark, in hex. */
function textString(value: string): string {
  let hex = "<FEFF";
  for (let i = 0; i < value.length; i++) {
    hex += value.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  }
  return `${hex}>`;
}

/** The most bytes a page's content is written in, before it is compressed. */
const MAX_PAGE = 1_000_000_000;

/** The most bytes a PDF is written in. */
const MAX_FILE = 2_000_000_000;

/**
 * The most a cubic curve of a page may stray from the arc it stands for, in points: 1/1000 inch.
 */
const CURVE_ERROR = 0.072;

/** The most characters of a text shown by one operator. */
const TEXT_PIECE = 32_768;

/** The most cubic curves one arc is drawn with. */
const MAX_CURVES = 4096;

/** The most characters one embedded font sets, beside `?`, since a code is two bytes. */
const MAX_CODES = 65_000;

/**
 * A TrueType font a PDF embeds, cut to the characters its pages set in it. Each character gets
 * a code of its own, from 1, in the order the pages meet it, so a reader that copies a text
 * gets its characters back, even two that share a glyph.
 */
class Embedded {
  readonly font: TrueType;
  /** The height of the text as a share of its size: the font's capitals. */
  readonly capital: number;
  readonly object: number;
  readonly codes = new Map<string, number>();
  /** The glyph of each code, at the code less 1. */
  readonly glyphs: number[] = [];

  constructor(font: TrueType, capital: number, object: number) {
    this.font = font;
    this.capital = capital;
    this.object = object;
  }

  /**
   * The code of a character, given one when it is first set. A character the font has no glyph
   * for, and a control character, is added to `missing` and set as `?`, as `measureText`
   * measures it, or as the font's empty glyph, code 0, when it has no `?` either.
   */
  code(character: string, missing: Set<string>): number {
    const known = this.codes.get(character);
    if (known !== undefined) return known;
    const point = character.codePointAt(0)!;
    const glyph = control(point) ? 0 : this.font.glyph(point);
    if (glyph !== 0 && (this.codes.size < MAX_CODES || character === "?")) {
      this.glyphs.push(glyph);
      this.codes.set(character, this.glyphs.length);
      return this.glyphs.length;
    }
    missing.add(character);
    if (character === "?") return 0;
    return this.codes.get("?") ?? (this.font.glyph(QUESTION) === 0 ? 0 : this.code("?", missing));
  }
}

/** The six capitals that name a subset of a font, from a hash of the subset's bytes. */
function subsetTag(program: Uint8Array): string {
  const hex = new Sha256().update(program).digest();
  let tag = "";
  for (let i = 0; i < 6; i++) {
    tag += String.fromCharCode(65 + (Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16) % 26));
  }
  return tag;
}

/** A map from codes to the characters they set, as a PDF's `ToUnicode` CMap holds one. */
function toUnicode(codes: ReadonlyMap<string, number>): string {
  const hex = (value: number) => value.toString(16).padStart(4, "0").toUpperCase();
  const lines = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
  ];
  const entries = [...codes];
  // A CMap holds at most 100 entries in each block.
  for (let at = 0; at < entries.length; at += 100) {
    const block = entries.slice(at, at + 100);
    lines.push(`${block.length} beginbfchar`);
    for (const [character, code] of block) {
      let units = "";
      for (let i = 0; i < character.length; i++) units += hex(character.charCodeAt(i));
      lines.push(`<${hex(code)}> <${units}>`);
    }
    lines.push("endbfchar");
  }
  lines.push("endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end");
  return `${lines.join("\n")}\n`;
}

/** Bytes of ASCII text, which is all a PDF's structure and content hold here. */
function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** Content written in pieces, joined into bytes now and then, so no string grows too long. */
class Content {
  private readonly chunks: Uint8Array[] = [];
  private lines: string[] = [];
  /** The characters added and not yet joined into bytes. */
  pending = 0;
  length = 0;

  /** Adds a line, and throws once the page would pass `MAX_PAGE`. */
  add(line: string): void {
    this.lines.push(line);
    this.pending += line.length + 1;
    if (this.pending > 1 << 20) this.flush();
    if (this.length + this.pending > MAX_PAGE) {
      throw new RangeError(`A page would be longer than svgToPDF writes, ${MAX_PAGE} bytes`);
    }
  }

  private flush(): void {
    if (this.lines.length === 0) return;
    const bytes = ascii(`${this.lines.join("\n")}\n`);
    this.chunks.push(bytes);
    this.length += bytes.length;
    this.lines = [];
    this.pending = 0;
  }

  bytes(): Uint8Array {
    this.flush();
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}

/** What an element of the picture inherits from the groups around it. */
interface Inherited {
  readonly matrix: Matrix;
  readonly stroke: string | undefined;
  readonly fill: string | undefined;
  readonly strokeWidth: number;
  readonly layer: string | undefined;
  /** True when the group around it opened a `q` that its end closes. */
  readonly saved: boolean;
}

/** A color as `#rrggbb`, as three parts from 0 to 1, or undefined for `none`. */
function colorOf(value: string | undefined, where: string): string | undefined {
  if (value === undefined || value === "none") return undefined;
  // `toSVG` draws an index a table has no color for in `currentColor`, which a page plots black.
  if (value === "currentColor") return "0 0 0";
  const hex = /^#([0-9a-fA-F]{6})$/.exec(value)?.[1];
  if (hex === undefined) throw refuse(`the color ${JSON.stringify(value)}`, where);
  return [0, 2, 4]
    .map((at) => String(Math.round((Number.parseInt(hex.slice(at, at + 2), 16) / 255) * 1e4) / 1e4))
    .join(" ");
}

/** A path as the points of its pieces, each straight or a cubic curve, in the element's space. */
type Piece =
  | { readonly kind: "move"; readonly to: readonly [number, number] }
  | { readonly kind: "line"; readonly to: readonly [number, number] }
  | {
      readonly kind: "curve";
      readonly c1: readonly [number, number];
      readonly c2: readonly [number, number];
      readonly to: readonly [number, number];
    }
  | { readonly kind: "close" };

/**
 * The cubic curves of an arc of an ellipse about `center`, with radii `rx` and `ry`, the first
 * turned `phi` radians, from angle `from` through `sweep` radians: at most a quarter turn each,
 * and short enough that none strays from the arc by more than `CURVE_ERROR`, less what rounding
 * a point to the page's three decimals can move it, on a page that draws one unit `scale`
 * points long. A quarter turn of a circle of radius `r` strays by at most 0.000273 r, and a
 * shorter arc by that times the sixth power of its share of a quarter turn.
 *
 * @throws RangeError when the arc needs more than `MAX_CURVES` curves for that.
 */
function ellipseCurves(
  center: readonly [number, number],
  rx: number,
  ry: number,
  phi: number,
  from: number,
  sweep: number,
  scale: number,
): Piece[] {
  // `scale` is the most the page's map stretches a length, whatever way it points.
  const reach = Math.max(Math.abs(rx), Math.abs(ry)) * scale * 0.000273;
  const room = CURVE_ERROR - 0.001;
  const turn = (Math.PI / 2) * Math.min(1, (room / reach) ** (1 / 6));
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / (turn > 0 ? turn : Math.PI / 2) - 1e-9));
  if (!(count <= MAX_CURVES)) {
    throw new RangeError(
      `An arc of radius ${Math.max(Math.abs(rx), Math.abs(ry)) * scale} points needs more than ${MAX_CURVES} curves to stay within ${CURVE_ERROR} points of it`,
    );
  }
  const step = sweep / count;
  const k = (4 / 3) * Math.tan(step / 4);
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const at = (x: number, y: number): [number, number] => [
    center[0] + rx * x * cos - ry * y * sin,
    center[1] + rx * x * sin + ry * y * cos,
  ];
  const pieces: Piece[] = [];
  for (let i = 0; i < count; i++) {
    const [a, b] = [from + step * i, from + step * (i + 1)];
    pieces.push({
      kind: "curve",
      c1: at(Math.cos(a) - k * Math.sin(a), Math.sin(a) + k * Math.cos(a)),
      c2: at(Math.cos(b) + k * Math.sin(b), Math.sin(b) - k * Math.cos(b)),
      to: at(Math.cos(b), Math.sin(b)),
    });
  }
  return pieces;
}

/**
 * The curves of an arc of a path, from SVG's endpoint form: from `p0` to `p1` on an ellipse of
 * radii `rx`, `ry` turned `turn` degrees, the larger of the two arcs when `large`, drawn with
 * increasing angle when `sweep`. Radii too small to reach are scaled up, as SVG scales them.
 */
function arcCurves(
  p0: readonly [number, number],
  p1: readonly [number, number],
  rx: number,
  ry: number,
  turn: number,
  large: boolean,
  sweep: boolean,
  scale: number,
): Piece[] {
  if (p0[0] === p1[0] && p0[1] === p1[1]) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return [{ kind: "line", to: p1 }];
  const phi = (turn * Math.PI) / 180;
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const [dx, dy] = [(p0[0] - p1[0]) / 2, (p0[1] - p1[1]) / 2];
  const [x1, y1] = [cos * dx + sin * dy, -sin * dx + cos * dy];
  const reach = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (reach > 1) {
    rx *= Math.sqrt(reach);
    ry *= Math.sqrt(reach);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const root = Math.sqrt(Math.max(0, numerator / denominator)) * (large === sweep ? -1 : 1);
  const [cx1, cy1] = [(root * rx * y1) / ry, (-root * ry * x1) / rx];
  const center: [number, number] = [
    cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2,
    sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2,
  ];
  const angle = (ux: number, uy: number, vx: number, vy: number): number =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const [ux, uy] = [(x1 - cx1) / rx, (y1 - cy1) / ry];
  const [vx, vy] = [(-x1 - cx1) / rx, (-y1 - cy1) / ry];
  const from = angle(1, 0, ux, uy);
  let delta = angle(ux, uy, vx, vy);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const pieces = ellipseCurves(center, rx, ry, phi, from, delta, scale);
  // The last curve ends exactly at the point the path names.
  const last = pieces.at(-1);
  if (last?.kind === "curve") pieces[pieces.length - 1] = { ...last, to: p1 };
  return pieces;
}

/**
 * The pieces of a path's `d`, which `toSVG` writes with `M`, `L` and `A` alone, on a page that
 * draws one unit `scale` points long.
 */
function pathPieces(d: string, where: string, scale: number): Piece[] {
  const tokens = d.trim().split(/[\s,]+/);
  const pieces: Piece[] = [];
  let at: [number, number] = [0, 0];
  let i = 0;
  const numbers = (count: number): number[] => {
    const out = tokens.slice(i, i + count).map(Number);
    if (out.length !== count || !out.every(Number.isFinite)) throw refuse(`the path ${d}`, where);
    i += count;
    return out;
  };
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === "M" || command === "L") {
      const [x, y] = numbers(2) as [number, number];
      at = [x, y];
      pieces.push({ kind: command === "M" ? "move" : "line", to: at });
    } else if (command === "A") {
      const [rx, ry, turn, large, sweep, x, y] = numbers(7) as number[];
      const to: [number, number] = [x!, y!];
      pieces.push(...arcCurves(at, to, rx!, ry!, turn!, large === 1, sweep === 1, scale));
      at = to;
    } else throw refuse(`the path command ${JSON.stringify(command)}`, where);
  }
  return pieces;
}

/** The numbers of a `points` attribute as pairs. */
function pointsOf(value: string, where: string): [number, number][] {
  const numbers =
    value.trim() === ""
      ? []
      : value
          .trim()
          .split(/[\s,]+/)
          .map(Number);
  if (numbers.length % 2 !== 0 || !numbers.every(Number.isFinite)) {
    throw refuse(`the points ${JSON.stringify(value)}`, where);
  }
  const out: [number, number][] = [];
  for (let i = 0; i < numbers.length; i += 2) out.push([numbers[i]!, numbers[i + 1]!]);
  return out;
}

/** Writes a PDF one page at a time, and its fonts, layers and bookmarks at the end. */
class PdfWriter {
  private readonly parts: Uint8Array[] = [];
  private offset = 0;
  /** The byte offset of each object, by its number, from 1. */
  private readonly offsets: number[] = [];
  private next = 1;
  private readonly catalog = this.reserve();
  private readonly tree = this.reserve();
  private readonly pages: { readonly object: number; readonly name: string }[] = [];
  /** The object of each face used, and of each layer, by name. */
  private readonly faces = new Map<Face, number>();
  private readonly layers = new Map<string, number>();
  private readonly widths = new Map<Face, number[]>();
  /**
   * Each font of `FONTS` whose file the PDF embeds, by its name or `boldFontKey` of it, or null for
   * one it sets in a face.
   */
  private readonly embedded = new Map<string, Embedded | null>();

  private readonly deflate: PdfOptions["deflate"];
  private readonly missing: PdfOptions["missing"];
  private readonly files: PdfOptions["fonts"];
  private readonly title: string | undefined;
  /** The hash of every byte written, from which the file's id comes. */
  private readonly hash = new Sha256();

  constructor({ deflate, missing, title, fonts }: Omit<PdfOptions, "layouts" | "xrefs">) {
    this.deflate = deflate;
    this.missing = missing;
    this.files = typeof fonts === "object" && fonts !== null ? fonts : undefined;
    this.title = typeof title === "string" ? title : undefined;
    // A comment of bytes above 127 on the second line tells a reader the file is binary.
    this.write(ascii("%PDF-1.7\n"));
    this.write(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  }

  private reserve(): number {
    return this.next++;
  }

  private write(bytes: Uint8Array): void {
    if (this.offset + bytes.length > MAX_FILE) {
      throw new RangeError(
        `The PDF would be longer than svgToPDF writes, ${MAX_FILE} bytes, at page ${this.pages.length + 1}`,
      );
    }
    this.parts.push(bytes);
    this.offset += bytes.length;
    this.hash.update(bytes);
  }

  /** Writes an object with the number reserved for it. */
  private object(number: number, body: string, stream?: Uint8Array): void {
    this.offsets[number] = this.offset;
    if (stream === undefined) {
      this.write(ascii(`${number} 0 obj\n${body}\nendobj\n`));
      return;
    }
    this.write(ascii(`${number} 0 obj\n${body}\nstream\n`));
    this.write(stream);
    this.write(ascii("\nendstream\nendobj\n"));
  }

  private faceObject(face: Face): number {
    let number = this.faces.get(face);
    if (number === undefined) this.faces.set(face, (number = this.reserve()));
    return number;
  }

  /**
   * The font a text in `font` is embedded in, in its bold face for `bold`, read from its file
   * once, or null for none.
   */
  private embeddedOf(font: string, bold: boolean): Embedded | null {
    const named = bold ? boldFontKey(font) : font;
    let found = this.embedded.get(named);
    if (found === undefined) {
      const own = capHeightOf(font, bold);
      const file =
        this.files !== undefined && own !== undefined && Object.hasOwn(this.files, named)
          ? this.files[named]
          : undefined;
      const read = file === undefined ? undefined : embeddable(font, file);
      // The leading CAD app makes the capital `A` of a font as tall as the text, by the number
      // `FONTS` holds for the font's own file. A file that stands in is sized by the cap height it
      // states, as the command's PNG sizes it, so the preview and the plot agree.
      const capital = read?.family === font ? own : (read?.capHeight ?? own);
      found =
        read === undefined || capital === undefined
          ? null
          : new Embedded(read, capital, this.reserve());
      this.embedded.set(named, found);
    }
    return found;
  }

  /** Writes an embedded font, cut to the glyphs of the characters its pages set. */
  private embed(embedded: Embedded): void {
    const { font } = embedded;
    // The glyphs of the subset: the empty glyph first, then each glyph set, once.
    const order = [0];
    const place = new Map<number, number>([[0, 0]]);
    for (const glyph of embedded.glyphs) {
      if (!place.has(glyph)) {
        place.set(glyph, order.length);
        order.push(glyph);
      }
    }
    const program = font.subset(order);
    const name = `${subsetTag(program)}+${font.name}`;
    const per = 1000 / font.unitsPerEm;
    const [descendant, descriptor, file, unicode, glyphMap, list] = [1, 2, 3, 4, 5, 6].map(() =>
      this.reserve(),
    ) as [number, number, number, number, number, number];
    const glyphs = [0, ...embedded.glyphs];
    const widths = glyphs.map((glyph) => real(font.advance(glyph) * per, 3));
    this.object(
      embedded.object,
      `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${descendant} 0 R] /ToUnicode ${unicode} 0 R >>`,
    );
    this.object(
      descendant,
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW ${widths[0]} /W ${list} 0 R /CIDToGIDMap ${glyphMap} 0 R >>`,
    );
    // The advance of each code, from code 0, in thousandths of the size.
    this.object(list, `[0 [${widths.join(" ")}]]`);
    const box = font.box.map((value) => Math.round(value * per)).join(" ");
    this.object(
      descriptor,
      `<< /Type /FontDescriptor /FontName /${name} /Flags 4 /FontBBox [${box}] /ItalicAngle ${real(font.italicAngle, 3)} /Ascent ${Math.round(font.ascent * per)} /Descent ${Math.round(font.descent * per)} /CapHeight ${Math.round(embedded.capital * 1000)} /StemV 80 /FontFile2 ${file} 0 R >>`,
    );
    this.stream(file, program, ` /Length1 ${program.length}`);
    this.stream(unicode, ascii(toUnicode(embedded.codes)));
    // Each code's glyph in the subset, two bytes each, from code 0.
    const map = new Uint8Array(2 * glyphs.length);
    glyphs.forEach((glyph, code) => {
      const at = place.get(glyph)!;
      map[2 * code] = at >> 8;
      map[2 * code + 1] = at & 0xff;
    });
    this.stream(glyphMap, map);
  }

  /** Writes a stream object, compressed with `deflate` when there is one. */
  private stream(number: number, bytes: Uint8Array, entries = ""): void {
    const data = this.deflate ? this.deflate(bytes) : bytes;
    this.object(
      number,
      `<< /Length ${data.length}${this.deflate ? " /Filter /FlateDecode" : ""}${entries} >>`,
      data,
    );
  }

  private widthsOf(face: Face): number[] {
    let widths = this.widths.get(face);
    if (!widths) this.widths.set(face, (widths = faceWidths(face)));
    return widths;
  }

  private layerObject(name: string): number {
    let number = this.layers.get(name);
    if (number === undefined) this.layers.set(name, (number = this.reserve()));
    return number;
  }

  /** Adds a page drawn from a picture `toSVG` made of a layout. */
  page(svg: string): void {
    const content = new Content();
    const fonts = new Map<Face | Embedded, string>();
    const missing = new Set<string>();
    const marks = new Map<string, string>();
    const page = this.pages.length + 1;
    const where = (tag: string) => `the element <${tag}> of picture ${page}`;
    let paper:
      | { name: string; layout: string; size: [number, number]; rotate: boolean }
      | undefined;
    const stack: Inherited[] = [];
    /** The tag of each group open, the root's first, and whether the root has closed. */
    const names: ("svg" | "g")[] = [];
    let ended = false;
    const clips = new Map<string, { x: number; y: number; width: number; height: number }>();
    /** The clip path being read, whose rectangles are kept and not drawn. */
    let inClip: string | undefined;
    /** The layer of the marked content open, and the pen last set at this depth of `q`. */
    let open: string | undefined;
    let pen: { stroke?: string; fill?: string; width?: string } = {};
    const pens: (typeof pen)[] = [];
    const close = (): void => {
      if (open !== undefined) content.add("EMC");
      open = undefined;
    };
    const mark = (layer: string | undefined): void => {
      if (layer === open) return;
      close();
      if (layer === undefined) return;
      let key = marks.get(layer);
      if (key === undefined) marks.set(layer, (key = `oc${this.layerObject(layer)}`));
      content.add(`/OC /${key} BDC`);
      open = layer;
    };
    /** Writes the operators of a path through `m`, and paints it. */
    const paint = (
      pieces: readonly Piece[],
      m: Matrix,
      state: { stroke: string | undefined; fill: string | undefined; width: number },
    ): void => {
      if (state.stroke === undefined && state.fill === undefined) return;
      if (state.stroke !== undefined && state.stroke !== pen.stroke) {
        content.add(`${state.stroke} RG`);
        pen.stroke = state.stroke;
      }
      if (state.fill !== undefined && state.fill !== pen.fill) {
        content.add(`${state.fill} rg`);
        pen.fill = state.fill;
      }
      const width = num(state.width);
      if (state.stroke !== undefined && width !== pen.width) {
        content.add(`${width} w`);
        pen.width = width;
      }
      if (pieces.length === 0) return;
      // Each piece is a line of its own, so no string grows with the path.
      const p = (point: readonly [number, number]) =>
        apply(m, point[0], point[1]).map(num).join(" ");
      for (const piece of pieces) {
        if (piece.kind === "move") content.add(`${p(piece.to)} m`);
        else if (piece.kind === "line") content.add(`${p(piece.to)} l`);
        else if (piece.kind === "curve") {
          content.add(`${p(piece.c1)} ${p(piece.c2)} ${p(piece.to)} c`);
        } else content.add("h");
      }
      content.add(state.fill === undefined ? "S" : state.stroke === undefined ? "f" : "B");
    };

    // Sticky, so each match starts where the last ended: what it cannot read is refused, never
    // skipped, and no match is looked for further on.
    const tags = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/y;
    let text: { element: Record<string, string>; inherited: Inherited; value: string } | undefined;
    for (;;) {
      const from = tags.lastIndex;
      const match = tags.exec(svg);
      if (!match) {
        if (from < svg.length)
          throw refuse(`what it reads at character ${from}`, `picture ${page}`);
        break;
      }
      const [, closing, tag, attributeText, selfClosing, between] = match;
      if (tag === undefined) {
        if (text) text.value += unescape(between ?? "", `picture ${page}`);
        else if ((between ?? "").trim() !== "")
          throw refuse("text outside a text element", `picture ${page}`);
        continue;
      }
      if (!ELEMENTS.has(tag)) throw refuse(`the element <${tag}>`, `picture ${page}`);
      // A text holds its value and nothing else, every end closes the element open, and
      // nothing follows the end of the picture.
      const ends =
        tag === "text"
          ? text !== undefined
          : text === undefined &&
            (tag === "clipPath"
              ? inClip !== undefined
              : inClip === undefined && names.at(-1) === tag);
      if (
        ended ||
        (closing && (!ends || attributeText!.trim() !== "")) ||
        (!closing && text !== undefined)
      ) {
        throw refuse(`<${closing}${tag}> where it is`, `picture ${page}`);
      }
      if (closing) {
        if (tag === "text" && text) {
          const set = this.text(
            text.element,
            text.inherited,
            text.value,
            fonts,
            missing,
            where(tag),
          );
          if (set) {
            mark(text.inherited.layer);
            if (set.fill !== pen.fill) {
              content.add(`${set.fill} rg`);
              pen.fill = set.fill;
            }
            for (const operator of set.operators) content.add(operator);
          }
          text = undefined;
        } else if (tag === "clipPath") inClip = undefined;
        else if (tag === "g" || tag === "svg") {
          names.pop();
          ended = names.length === 0;
          if (stack.pop()?.saved) {
            close();
            content.add("Q");
            pen = pens.pop() ?? {};
          }
        }
        continue;
      }
      const element: Record<string, string> = {};
      for (const [, name, value] of attributeText!.matchAll(/([\w:-]+)="([^"]*)"/g)) {
        if (!ATTRIBUTES.has(name!) && !name!.startsWith("data-")) {
          throw refuse(`the attribute ${name}`, where(tag));
        }
        element[name!] = unescape(value!, where(tag));
      }
      const number = (name: string): number => {
        const value = Number(element[name]);
        if (element[name] === undefined || !Number.isFinite(value)) {
          throw refuse(`the ${name} ${JSON.stringify(element[name])}`, where(tag));
        }
        return value;
      };
      if (tag === "svg") {
        const box = (element.viewBox ?? "").trim().split(/\s+/).map(Number);
        const info =
          element["data-paper"] === undefined ? undefined : paperInfo(element["data-paper"]);
        if (element["data-picture"] !== String(SHEET_PICTURE)) {
          throw refuse(
            `a picture of format ${JSON.stringify(element["data-picture"] ?? null)}, where this copy of tsdraft reads format ${SHEET_PICTURE}`,
            `picture ${page}`,
          );
        }
        if (
          stack.length > 0 ||
          paper ||
          element["data-layout"] === undefined ||
          !info ||
          box.length !== 4 ||
          !box.every(Number.isFinite) ||
          !(box[2]! > 0 && box[3]! > 0)
        ) {
          throw refuse("a picture that is not one of a layout", `picture ${page}`);
        }
        // Paper units to points, with Y turned up and the picture's top-left corner at the
        // page's top-left corner. A paper the plotter holds upright is its medium, turned a
        // quarter turn for a viewer to show it as the layout is.
        const k = info.units === "in" ? 72 : 72 / 25.4;
        const [x, y, w, h] = box as [number, number, number, number];
        const upright = info.medium.rotation === 1;
        paper = {
          name: element["data-paper"]!,
          layout: element["data-layout"],
          size: upright ? [h * k, w * k] : [w * k, h * k],
          rotate: upright,
        };
        const flat: Matrix = [k, 0, 0, -k, -x * k, (y + h) * k];
        stack.push({
          matrix: upright ? compose([0, -1, 1, 0, 0, w * k], flat) : flat,
          stroke: undefined,
          fill: undefined,
          strokeWidth: 1,
          layer: undefined,
          saved: false,
        });
        // Every pen of a plot ends and joins round.
        content.add("1 J\n1 j");
        if (selfClosing) {
          stack.pop();
          ended = true;
        } else names.push("svg");
        continue;
      }
      const parent = stack.at(-1);
      if (!parent) throw refuse(`<${tag}> outside the picture`, `picture ${page}`);
      if (inClip !== undefined) {
        if (tag !== "rect") throw refuse(`<${tag}> in a clip path`, where(tag));
        // A clip is a rectangle of the group's space, and nothing turns or moves it.
        const extra = Object.keys(element).find(
          (name) => !["x", "y", "width", "height"].includes(name),
        );
        if (extra !== undefined) throw refuse(`the attribute ${extra} of a clip`, where(tag));
        clips.set(inClip, {
          x: number("x"),
          y: number("y"),
          width: number("width"),
          height: number("height"),
        });
        continue;
      }
      if (tag === "clipPath") {
        if (element.id === undefined) throw refuse("a clip path with no id", where(tag));
        const extra = Object.keys(element).find((name) => name !== "id");
        if (extra !== undefined) throw refuse(`the attribute ${extra} of a clip path`, where(tag));
        inClip = element.id;
        if (selfClosing) inClip = undefined;
        continue;
      }
      const matrix =
        element.transform === undefined
          ? parent.matrix
          : compose(parent.matrix, transformOf(element.transform, where(tag)));
      const width =
        element["stroke-width"] === undefined ? parent.strokeWidth : number("stroke-width");
      const inherited: Inherited = {
        matrix,
        stroke: element.stroke === undefined ? parent.stroke : element.stroke,
        fill: element.fill === undefined ? parent.fill : element.fill,
        strokeWidth: width,
        layer: element["data-layer"] ?? parent.layer,
        saved: false,
      };
      if (tag === "g") {
        if (selfClosing) continue;
        let saved = false;
        const clip = element["clip-path"];
        if (clip !== undefined) {
          const id = /^url\(#([^)]+)\)$/.exec(clip)?.[1];
          const rect = id === undefined ? undefined : clips.get(id);
          if (!rect) throw refuse(`the clip ${JSON.stringify(clip)}`, where(tag));
          close();
          pens.push(pen);
          pen = { ...pen };
          const corners = [
            [rect.x, rect.y],
            [rect.x + rect.width, rect.y],
            [rect.x + rect.width, rect.y + rect.height],
            [rect.x, rect.y + rect.height],
          ].map(([cx, cy]) => apply(matrix, cx!, cy!).map(num).join(" "));
          content.add(
            `q\n${corners[0]} m\n${corners[1]} l\n${corners[2]} l\n${corners[3]} l\nh W n`,
          );
          saved = true;
        }
        stack.push({ ...inherited, saved });
        names.push("g");
        continue;
      }
      if (tag === "text") {
        if (selfClosing) continue;
        text = { element, inherited, value: "" };
        continue;
      }
      if (!selfClosing) throw refuse(`<${tag}> with something inside it`, where(tag));
      // The hidden rectangle of a view, and the white of the paper, put no ink on the page.
      if (element.visibility === "hidden" || element["data-paper-sheet"] !== undefined) continue;
      const stroke = colorOf(inherited.stroke, where(tag));
      const fill = colorOf(inherited.fill, where(tag));
      // The thinnest line, which `toSVG` marks, plots 0 wide: the thinnest the printer draws.
      const thinnest = element["data-thinnest"] !== undefined;
      const state = { stroke, fill, width: thinnest ? 0 : width * scaleOf(inherited.matrix) };
      mark(inherited.layer);
      let pieces: Piece[];
      switch (tag) {
        case "line":
          pieces = [
            { kind: "move", to: [number("x1"), number("y1")] },
            { kind: "line", to: [number("x2"), number("y2")] },
          ];
          break;
        case "polyline":
        case "polygon": {
          const points = pointsOf(element.points ?? "", where(tag));
          pieces = points.map((to, i) => ({ kind: i === 0 ? "move" : "line", to }));
          if (tag === "polygon" && points.length > 0) pieces.push({ kind: "close" });
          break;
        }
        case "rect": {
          const [x, y, w, h] = [number("x"), number("y"), number("width"), number("height")];
          pieces = [
            { kind: "move", to: [x, y] },
            { kind: "line", to: [x + w, y] },
            { kind: "line", to: [x + w, y + h] },
            { kind: "line", to: [x, y + h] },
            { kind: "close" },
          ];
          break;
        }
        case "circle":
        case "ellipse": {
          const center: [number, number] = [number("cx"), number("cy")];
          const [rx, ry] =
            tag === "circle" ? [number("r"), number("r")] : [number("rx"), number("ry")];
          const curves = ellipseCurves(
            center,
            rx,
            ry,
            0,
            0,
            2 * Math.PI,
            stretchOf(inherited.matrix),
          );
          pieces = [
            { kind: "move", to: [center[0] + rx, center[1]] },
            ...curves,
            { kind: "close" },
          ];
          break;
        }
        case "path":
          pieces = pathPieces(element.d ?? "", where(tag), stretchOf(inherited.matrix));
          break;
        default:
          throw refuse(`<${tag}> as a shape`, where(tag));
      }
      paint(pieces, inherited.matrix, state);
    }
    if (!paper || stack.length > 0 || text || inClip !== undefined) {
      throw refuse("a picture that ends before its last element closes", `picture ${page}`);
    }
    close();
    if (content.length + content.pending > MAX_PAGE) {
      throw new RangeError(
        `The page of picture ${page} would be longer than svgToPDF writes, ${MAX_PAGE} bytes`,
      );
    }
    const contentObject = this.reserve();
    const pageObject = this.reserve();
    const raw = content.bytes();
    const stream = this.deflate ? this.deflate(raw) : raw;
    this.object(
      contentObject,
      `<< /Length ${stream.length}${this.deflate ? " /Filter /FlateDecode" : ""} >>`,
      stream,
    );
    const fontList = [...fonts].map(
      ([face, key]) => `/${key} ${"codes" in face ? face.object : this.faceObject(face)} 0 R`,
    );
    const layerList = [...marks].map(([layer, key]) => `/${key} ${this.layers.get(layer)} 0 R`);
    const resources = [
      fontList.length > 0 ? `/Font << ${fontList.join(" ")} >>` : "",
      layerList.length > 0 ? `/Properties << ${layerList.join(" ")} >>` : "",
    ]
      .filter(Boolean)
      .join(" ");
    this.object(
      pageObject,
      `<< /Type /Page /Parent ${this.tree} 0 R /MediaBox [0 0 ${num(paper.size[0])} ${num(paper.size[1])}]${paper.rotate ? " /Rotate 270" : ""} /Resources << ${resources} >> /Contents ${contentObject} 0 R >>`,
    );
    this.pages.push({ object: pageObject, name: paper.layout });
    if (missing.size > 0) this.missing?.(paper.layout, [...missing].join(""), page - 1);
  }

  /**
   * The operators that set a text: its face and size, its place and turn, and the stretch that
   * holds it to its length. Undefined for a text that shows nothing.
   */
  private text(
    element: Record<string, string>,
    inherited: Inherited,
    value: string,
    fonts: Map<Face | Embedded, string>,
    missing: Set<string>,
    where: string,
  ): { fill: string; operators: readonly string[] } | undefined {
    const fill = colorOf(inherited.fill, where);
    if (fill === undefined) return undefined;
    const font = element["data-font"];
    const height = Number(element["data-height"]);
    if (font === undefined || !(height > 0) || !Number.isFinite(height)) {
      throw refuse(
        `a text in the font ${JSON.stringify(font)} of height ${JSON.stringify(element["data-height"])}`,
        where,
      );
    }
    const weight = element["font-weight"];
    if (weight !== undefined && weight !== "bold") {
      throw refuse(`the font-weight ${JSON.stringify(weight)}`, where);
    }
    const bold = weight === "bold";
    const embedded = this.embeddedOf(font, bold);
    // A font that is not one of `FONTS` is drawn as `toSVG` draws it, in the font of `Standard`.
    const face = standIn(font, bold);
    let codes: number[];
    let natural: number;
    let size: number;
    if (embedded) {
      codes = [];
      let advance = 0;
      for (const character of value) {
        const code = embedded.code(character, missing);
        codes.push(code);
        advance += embedded.font.advance(code === 0 ? 0 : embedded.glyphs[code - 1]!);
      }
      size = height / embedded.capital;
      natural = (advance / embedded.font.unitsPerEm) * size;
    } else {
      codes = [];
      for (const character of value) {
        const code = winAnsi(character.codePointAt(0)!);
        if (code === QUESTION && character !== "?") missing.add(character);
        codes.push(code);
      }
      // The face's capitals are as tall as the text's height: by the cap height of the font the
      // face has the widths of, and by its own for any other font.
      size = height / (font === face.widthsOf ? face.capHeight : face.ownCapHeight);
      const widths = this.widthsOf(face);
      natural = codes.reduce((sum, code) => sum + widths[code - 32]!, 0) * (size / 1000);
    }
    if (codes.length === 0) return undefined;
    const used = embedded ?? face;
    let key = fonts.get(used);
    if (key === undefined) {
      fonts.set(used, (key = `F${embedded ? embedded.object : this.faceObject(face)}`));
    }
    const held = Number(element.textLength);
    const stretch =
      element.textLength !== undefined && held > 0 && natural > 0 ? (held / natural) * 100 : 100;
    // SVG sets a letter with Y down, and a page with Y up. The map's scale goes into the size,
    // in points, so the matrix written holds numbers near 1 whatever scale a view has.
    const m = compose(inherited.matrix, [1, 0, 0, -1, 0, 0]);
    const k = stretchOf(m);
    if (k === 0) return undefined;
    if (!Number.isFinite(k)) throw refuse(`a text under a map that stretches it by ${k}`, where);
    const matrix = m.map((part, i) => (i < 4 ? real(part / k, 9) : num(part)));
    // A long text is shown in pieces, each from where the last ended, so no string grows with it.
    const digits = embedded ? 4 : 2;
    const shown: string[] = [];
    for (let at = 0; at < codes.length; at += TEXT_PIECE) {
      const piece = codes.slice(at, at + TEXT_PIECE);
      shown.push(
        `<${piece.map((code) => code.toString(16).padStart(digits, "0").toUpperCase()).join("")}> Tj`,
      );
    }
    const operators = [
      "BT",
      `/${key} ${real(size * k, 6)} Tf`,
      `${matrix.join(" ")} Tm`,
      `${num(stretch)} Tz`,
      ...shown,
      "ET",
    ];
    return { fill, operators };
  }

  /** Writes the fonts, the layers, the bookmarks, the page tree and the catalog. */
  finish(): Uint8Array {
    for (const embedded of this.embedded.values()) if (embedded) this.embed(embedded);
    for (const [face, number] of this.faces) {
      const descriptor = this.reserve();
      this.object(
        number,
        `<< /Type /Font /Subtype /Type1 /BaseFont /${face.name} /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 255 /Widths [${this.widthsOf(face).join(" ")}] /FontDescriptor ${descriptor} 0 R >>`,
      );
      this.object(
        descriptor,
        `<< /Type /FontDescriptor /FontName /${face.name} /Flags ${face.flags} /FontBBox [${face.box}] /ItalicAngle 0 /Ascent ${face.ascent} /Descent ${face.descent} /CapHeight ${Math.round(face.capHeight * 1000)} /StemV ${face.stem} >>`,
      );
    }
    const layers = [...this.layers].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [name, number] of layers) {
      this.object(number, `<< /Type /OCG /Name ${textString(name)} >>`);
    }
    // A bookmark for each sheet, by its layout's name.
    const outlines = this.reserve();
    const items = this.pages.map(() => this.reserve());
    this.pages.forEach((page, i) => {
      const links = [
        i > 0 ? `/Prev ${items[i - 1]} 0 R` : "",
        i + 1 < items.length ? `/Next ${items[i + 1]} 0 R` : "",
      ].join(" ");
      this.object(
        items[i]!,
        `<< /Title ${textString(page.name)} /Parent ${outlines} 0 R ${links} /Dest [${page.object} 0 R /Fit] >>`,
      );
    });
    this.object(
      outlines,
      `<< /Type /Outlines /First ${items[0]} 0 R /Last ${items.at(-1)} 0 R /Count ${items.length} >>`,
    );
    this.object(
      this.tree,
      `<< /Type /Pages /Kids [${this.pages.map((page) => `${page.object} 0 R`).join(" ")}] /Count ${this.pages.length} >>`,
    );
    const groups = layers.map(([, number]) => `${number} 0 R`).join(" ");
    const labels = this.pages.map((page, i) => `${i} << /P ${textString(page.name)} >>`).join(" ");
    const optional =
      layers.length > 0
        ? ` /OCProperties << /OCGs [${groups}] /D << /Order [${groups}] /OFF [] >> >>`
        : "";
    this.object(
      this.catalog,
      `<< /Type /Catalog /Pages ${this.tree} 0 R /Outlines ${outlines} 0 R /PageLabels << /Nums [${labels}] >>${optional} >>`,
    );
    const info = this.reserve();
    const title = this.title === undefined ? "" : ` /Title ${textString(this.title)}`;
    this.object(info, `<< /Producer (tsdraft)${title} >>`);
    // The file's id comes from what it holds, so the same pages give the same bytes.
    const id = this.hash.digest().slice(0, 32).toUpperCase();
    const start = this.offset;
    const rows = [`xref\n0 ${this.next}\n0000000000 65535 f \n`];
    for (let number = 1; number < this.next; number++) {
      rows.push(`${String(this.offsets[number]).padStart(10, "0")} 00000 n \n`);
    }
    this.write(ascii(rows.join("")));
    this.write(
      ascii(
        `trailer\n<< /Size ${this.next} /Root ${this.catalog} 0 R /Info ${info} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${start}\n%%EOF\n`,
      ),
    );
    const out = new Uint8Array(this.offset);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}
