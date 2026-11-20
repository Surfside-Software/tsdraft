// The rules a drawing must follow for the leading CAD app to open its DXF. Each rule exists
// twice: as a type, so a literal mistake is an error in the editor, and as a
// runtime check, for values the compiler can't see. The messages are shared.
//
// That app discards the whole drawing over most names that break the name rules.
import type { XrefProblem } from "./blocks.ts";
import type { DxfVersion, Point, Units } from "./drawing.ts";
import type { PaperUnit } from "./paper.ts";
import { paperInfo, PLOT_STYLE_TABLES, type Paper, type PlotStyleTable } from "./papers.ts";
import {
  ARROWHEAD_BLOCKS,
  arrowheadInfo,
  DEFAULT_ARROWHEAD,
  DIMENSION_FRACTIONS,
  DIMENSION_TEXT_FITS,
  DIMENSION_RADIAL_TEXTS,
  DIMENSION_ANGLE_UNITS,
  MAX_ANGLE_PRECISION,
  JOG_ANGLE,
  DIMENSION_TEXT_PLACEMENTS,
  DIMENSION_UNITS,
  FEET_INCH_ZEROS,
  MAX_PRECISION,
  leaderArrowheadInfo,
  STANDARD_DIMENSION_STYLE,
  STANDARD_LEADER_STYLE,
  ZERO_SUPPRESSIONS,
  type Arrowhead,
  type LeaderArrowhead,
} from "./arrowheads.ts";
import { isPaperUnit, isUnits, modelLength } from "./units.ts";
import { isTooLarge, written, writtenAngle } from "./format.ts";
import { fontInfo, STANDARD_TEXT_STYLE, type Font } from "./fonts.ts";
import {
  parseParagraph,
  PARAGRAPH_CONTROL,
  PARAGRAPH_ASTRAL,
  PARAGRAPH_NESTING,
  PARAGRAPH_NEVER_CLOSED,
  PARAGRAPH_NEVER_OPENED,
  PARAGRAPH_PRIVATE_USE,
  PARAGRAPH_SHX_DIAMETER,
  PARAGRAPH_STACK_LINED,
  PARAGRAPH_STACK_PART,
  PARAGRAPH_STACK_SEPARATOR,
  PARAGRAPH_SPACING_AT_LEAST,
  PARAGRAPH_TAB_KIND,
  PARAGRAPH_TOO_DEEP,
  PARAGRAPH_TRAILING,
  type BoldFont,
  type ParsedParagraph,
  type paragraphFontOption,
  type paragraphFontOptionTwice,
  type paragraphItalic,
  type paragraphNoSemicolon,
  type paragraphNotLaidOut,
  type paragraphCodeArgument,
  type paragraphPropertyUnknown,
  type paragraphShxBold,
  type paragraphUnknownCode,
  type paragraphUnknownFont,
} from "./paragraph-codes.ts";
import { BUILT_IN_LINETYPES, builtInLinetype, LINEWEIGHTS, patternLength } from "./linetypes.ts";
import {
  layerAuditKey,
  layerKey,
  layoutNameKey,
  rejectedNameCharacter,
  type REJECTED_COPTIC,
  type REJECTED_FORMAT,
  type REJECTED_GEORGIAN,
  type REJECTED_GLAGOLITIC,
  type REJECTED_LETTERLIKE,
  type REJECTED_PRIVATE,
} from "./layers.ts";

// The leading CAD app holds layer names, linetype names and text style names to the same rules, so
// each rule has a message for each kind of name.
const LAYER_NAMES = {
  empty: "Layer names cannot be empty",
  chars: 'Layer names cannot contain < > / \\ " : ; ? * | = ` ^ , or line breaks',
  rejected:
    "Layer names cannot contain a character the leading CAD app rejects or replaces in names, such as a zero-width space or the ohm sign U+2126. docs/layer-names.md in the tsdraft repository lists them",
  edge: "Layer names cannot start or end with a space",
  length: "Layer names cannot be longer than 255 characters",
} as const;
const LINETYPE_NAMES = {
  empty: "Linetype names cannot be empty",
  chars: 'Linetype names cannot contain < > / \\ " : ; ? * | = ` ^ , or line breaks',
  rejected:
    "Linetype names cannot contain a character the leading CAD app rejects or replaces in names, such as a zero-width space or the ohm sign U+2126. docs/layer-names.md in the tsdraft repository lists them",
  edge: "Linetype names cannot start or end with a space",
  length: "Linetype names cannot be longer than 255 characters",
} as const;
const TEXT_STYLE_NAMES = {
  empty: "Text style names cannot be empty",
  chars: 'Text style names cannot contain < > / \\ " : ; ? * | = ` ^ , or line breaks',
  rejected:
    "Text style names cannot contain a character the leading CAD app rejects or replaces in names, such as a zero-width space or the ohm sign U+2126. docs/layer-names.md in the tsdraft repository lists them",
  edge: "Text style names cannot start or end with a space",
  length: "Text style names cannot be longer than 255 characters",
} as const;
const BLOCK_NAMES = {
  empty: "Block names cannot be empty",
  chars:
    'Block names cannot contain < > / \\ " : ; ? * | = ` ^ , or line breaks. The leading CAD app keeps names that start with * for the blocks it makes itself, and its AUDIT reports any other block of such a name',
  rejected:
    "Block names cannot contain a character the leading CAD app rejects or replaces in names, such as a zero-width space or the ohm sign U+2126. docs/layer-names.md in the tsdraft repository lists them",
  edge: "Block names cannot start or end with a space",
  length:
    "Block names cannot be longer than 255 characters. The leading CAD app's BLOCK command refuses a longer name",
} as const;
const DIMENSION_STYLE_NAMES = {
  empty: "Dimension style names cannot be empty",
  chars: 'Dimension style names cannot contain < > / \\ " : ; ? * | = ` ^ , or line breaks',
  rejected:
    "Dimension style names cannot contain a character the leading CAD app rejects or replaces in names, such as a zero-width space or the ohm sign U+2126. docs/layer-names.md in the tsdraft repository lists them",
  edge: "Dimension style names cannot start or end with a space",
  length:
    "Dimension style names cannot be longer than 255 characters. The leading CAD app's DIMSTYLE command refuses a longer name",
} as const;
const LEADER_STYLE_NAMES = {
  empty: "Leader style names cannot be empty",
  chars: 'Leader style names cannot contain < > / \\ " : ; ? * | = ` ^ , or line breaks',
  rejected:
    "Leader style names cannot contain a character the leading CAD app rejects or replaces in names, such as a zero-width space or the ohm sign U+2126. docs/layer-names.md in the tsdraft repository lists them",
  edge: "Leader style names cannot start or end with a space",
  length:
    "Leader style names cannot be longer than 255 characters, as dimension style names cannot",
} as const;
type NameMessages =
  | typeof LAYER_NAMES
  | typeof LINETYPE_NAMES
  | typeof TEXT_STYLE_NAMES
  | typeof BLOCK_NAMES
  | typeof DIMENSION_STYLE_NAMES
  | typeof LEADER_STYLE_NAMES;
const NAME_R12_CHARS =
  'R12 layer names can only use letters, digits, $, - and _. Use DXF version "R2018" for other characters';
const NAME_R12_LENGTH =
  'R12 layer names cannot be longer than 31 characters. Use DXF version "R2018" for longer names';
const COLOR = "A layer color must be a color index, an integer from 1 to 255";
const POSITIVE = "This value must be greater than 0";
const WRITTEN_AS_ZERO =
  "This value is written as 0, because tsdraft writes 6 decimals. Use 0.000001 or more";
const TOO_LARGE =
  "This value must be under 1e100, because the leading CAD app reads only two exponent digits from DXF and would take 1e+100 for 1e+10";
const PAPER_LENGTH = "The paper length must be greater than 0";
const RATIO = "The ratio must be greater than 0";
const ARC_LOST =
  "An arc of nearly a full turn cannot be written: its angles are the same once rounded to 6 decimals, so the leading CAD app would hold an arc of no length. Draw a circle instead";
const TEXT_CONTROL = "Text must be a single line with no control characters";
const TEXT_PRIVATE_USE =
  "Text cannot contain the private-use characters U+E800 to U+E8FF, because the leading CAD app replaces them when it reads DXF";
const R12_LINETYPES =
  'R12 drawings have no linetypes but Continuous, and no linetype scale. Use DXF version "R2018" for linetypes';
const R12_LINEWEIGHTS = 'R12 drawings have no lineweights. Use DXF version "R2018" for lineweights';
const R12_ENTITY_STYLE =
  'R12 entities take no linetype or lineweight of their own. Use DXF version "R2018" for an entity linetype or lineweight';
const R12_LAYER_STATES =
  'tsdraft writes no layer states to R12 drawings. Use DXF version "R2018" for layers that are off, frozen, locked or not plotted';
const R12_BLOCKS =
  'tsdraft writes no blocks to R12 drawings. Use DXF version "R2018" for blocks, inserts and attributes';
const R12_XREFS = 'tsdraft writes no xrefs to R12 drawings. Use DXF version "R2018" for an xref';
const R12_LAYOUTS =
  'tsdraft writes no layouts to R12 drawings. Use DXF version "R2018" for a layout';
const R12_DIMENSIONS =
  'tsdraft writes no dimensions to R12 drawings. Use DXF version "R2018" for a dimension';
const R12_LEADERS =
  'tsdraft writes no leaders to R12 drawings. Use DXF version "R2018" for a leader';
const R12_PARAGRAPHS =
  'tsdraft writes no paragraphs to R12 drawings. Use DXF version "R2018" for a paragraph';
const LINE_SPACING = "A paragraph's line spacing is a factor from 0.25 to 4";
const R12_IMAGES = 'tsdraft writes no images to R12 drawings. Use DXF version "R2018" for an image';
const R12_HATCHES =
  'tsdraft writes no hatches or wipeouts to R12 drawings. Use DXF version "R2018" for a fill';
const IMAGE_PATH_EMPTY = "An image's path cannot be empty. The leading CAD app finds no file by it";
const IMAGE_PATH_ABSOLUTE =
  'An image\'s path must start from the folder of the drawing\'s file, as "aerial.png" and "../images/aerial.png" do, and cannot start with /, \\ or a drive such as C:. The leading CAD app looks for the file of an absolute path in that folder alone, and on another machine finds none';
const IMAGE_PATH_CHARS =
  "An image's path cannot hold * ? < > | : or \". The leading CAD app finds no file whose name holds one of them";
const IMAGE_PATH_LENGTH =
  "An image's path cannot be longer than 32,000 characters. The leading CAD app finds no file by a path that comes to more than 32,767 characters with the folder of the drawing";
const IMAGE_PATH_MULTIBYTE =
  "An image's path cannot hold a backslash before M+, a digit from 1 to 5 and four hex digits, such as \\M+10041. The leading CAD app reads those as one character, and looks for another file. Write / there";
const IMAGE_PIXELS =
  "An image's pixels are its file's width and height in pixels, each a whole number from 1 to 2,147,483,647, which rasterSize reads from the file. The leading CAD app draws the file's own pixels at the size each has in the drawing, so pixels other than the file's plot it at the wrong size";
const IMAGE_CLIP_POINTS =
  "An image's clip is two opposite corners of a rectangle along its sides, or a polygon of at least 3 points";
const IMAGE_CLIP_RECTANGLE =
  "An image's clip of two corners must have its corners apart along the image's width and up its height, as written: it is a rectangle along the image's sides, and one of no width or height shows nothing";
const IMAGE_CLIP_POLYGON =
  "An image's clip of a polygon needs at least 3 points that differ, as written";
const IMAGE_INVERT_CLIP =
  "invertClip needs a clip: it shows the image outside the clip, and with no clip there is no outside";
const IMAGE_PIXELS_DIFFER =
  "Two images of one file must give it the same pixels: the file is written once, as one definition, with its pixels";
const R12_POLYLINES =
  'tsdraft writes no arcs or widths of a polyline to R12 drawings. Use DXF version "R2018" for a polyline with bulges or a width';
const POLYLINE_WIDTH =
  "A polyline's width cannot be less than 0. The leading CAD app reads a negative width of every side as 0, and keeps a negative width of one side with no AUDIT error";
const DONUT_HOLE = "A donut's hole cannot be less than 0 across";
const ARROWHEAD_BLOCK =
  "Block names cannot be _ArchTick, _Oblique, _Open, _Dot or _None, in any case of their letters. The leading CAD app draws the ticks of a dimension and the arrowheads of a leader with the blocks of those names";
const STANDARD_DIMENSION_STYLE_DEFINED =
  'The dimension style "Standard" is in every drawing and cannot be defined. The leading CAD app keeps the first style of a name and skips a second';
const STANDARD_DIMENSION_STYLE_USED =
  'tsdraft draws no dimension in the dimension style "Standard", which is the leading CAD app\'s own. Define a style with dimensionStyle() and name it';
const ARROWHEAD = 'An arrowhead must be one of ARROWHEADS: "closed-filled" or "architectural-tick"';
const NOT_NEGATIVE =
  "This value cannot be less than 0. The leading CAD app's AUDIT reports a dimension style with a negative size";
const TEXT_GAP =
  "The gap cannot be less than 0. The leading CAD app draws a box around the text of a dimension whose style has a negative gap";
const DIMENSION_SCALE =
  "The scale must be greater than 0. The leading CAD app takes a scale of 0 for one it works out from a viewport, and its AUDIT reports a negative one";
const MEASUREMENT_SCALE =
  "The measurement scale must be greater than 0. The leading CAD app's AUDIT reports a scale of 0, and that app applies a negative one only to a dimension on a layout";
const PRECISION =
  "A precision is a whole number from 0 to 8: the decimals of a measurement, or in architectural units the least fraction of an inch, 1 over 2 to that power. The leading CAD app's AUDIT reports a dimension style with any other";
const ZERO_SUPPRESSION = 'suppressZeros must be "leading", "trailing" or "both"';
const DIMENSION_UNITS_MESSAGE = 'units must be "decimal" or "architectural"';
const FEET_INCH_ZEROS_MESSAGE = 'feetInchZeros must be "inches", "feet", "both" or "neither"';
const DIMENSION_FRACTION_MESSAGE = 'fraction must be "inline", "stacked" or "diagonal"';
const FRACTION_SCALE_MESSAGE =
  "fractionScale must be a number from 0.25 to 1: the height of a stacked fraction as a share of the text's";
const FRACTION_OF_UNITS =
  'fraction and fractionScale are for a style in "architectural" units, which writes a fraction of an inch';
const FRACTION_SCALE_INLINE =
  'fractionScale sizes a fraction that is "stacked" or "diagonal". A fraction on the line is as high as the text';
const TEXT_PLACEMENT_MESSAGE = 'textPlacement must be "above" or "centered"';
const TEXT_FIT_MESSAGE = 'textFit must be "inside" or "leader"';
const RADIAL_TEXT_MESSAGE = 'radialText must be "aligned" or "horizontal"';
const JOG_ANGLE_MESSAGE = "jogAngle must be a number of degrees from 5 to 90";
const ANGLE_UNITS_MESSAGE =
  'angleUnits must be "degrees", "degrees-minutes-seconds", "grads" or "radians"';
const ANGLE_PRECISION_MESSAGE = `anglePrecision must be a whole number from 0 to ${MAX_ANGLE_PRECISION}`;
const ANGLE_ZEROS_MESSAGE = 'suppressAngleZeros must be "leading", "trailing" or "both"';
const ZEROS_OF_UNITS =
  'suppressZeros is for a style in decimal units, and feetInchZeros for one in "architectural" units, which writes feet and inches';
const DIMENSION_FORMATTING =
  "The prefix, the suffix and the text of a dimension cannot contain \\ { or }. The leading CAD app reads them as the formatting of the text";
const PREFIX_MEASUREMENT =
  "A prefix cannot contain <>, which the leading CAD app takes for the place of the measurement";
const DIMENSION_TEXT_BLANK =
  "A dimension's text cannot be empty or all spaces. The leading CAD app draws a dimension whose text is a space with no text. Leave the text out to draw the measurement";
const DIMENSION_TEXT_ALTERNATE =
  "A dimension's text cannot contain [] beside <>. The leading CAD app writes the measurement a second time for it, in alternate units";
const LAYOUT_NAME_EMPTY =
  "A layout's name cannot be empty. The leading CAD app's commands take an empty answer for the current layout, so none of them can name such a layout";
const LAYOUT_NAME_CHARS =
  "A layout's name cannot contain < > / \\ \" : ; ? * | , = or `. The leading CAD app's LAYOUT command refuses a name with one of them, and that app opens a file that holds such a layout without a word";
const LAYOUT_NAME_EDGE =
  "A layout's name cannot start or end with a space. The leading CAD app's -PLOT command finds no layout by such a name";
const LAYOUT_NAME_LENGTH =
  "A layout's name cannot be longer than 255 characters. The leading CAD app's LAYOUT command refuses a longer name";
const LAYOUT_NAME_MODEL =
  "A layout cannot be named Model, in any case of its letters. The leading CAD app keeps that name for the model tab: it discards a drawing whose layout is named MODEL, takes a layout named model for the model tab's own and loses its sheet, and never finishes opening a drawing with a second layout named Model";
const PAPER =
  'A paper must be one of PAPERS, the full-bleed sizes of the leading CAD app\'s DWG To PDF.pc3, such as "ARCH D", each laid out landscape. A page setup names its paper as the plotter does, and that app plots nothing for a layout whose paper the plotter knows neither by its name nor by its size';
const PLOT_STYLE =
  'A plot style table must be "monochrome.ctb", "acad.ctb", "Grayscale.ctb" or "DWF Virtual Pens.ctb", which the leading CAD app installs. That app plots a layout whose plot style table it does not have with no table, each pen in its own color';
const SHEET_NUMBER_LENGTH = "A sheet number has 1 to 64 characters";
const SHEET_NUMBER_CHARS =
  'A sheet number cannot hold < > : " / \\ | ? *, a control character or a character above U+FFFF. Windows names no file with one of them';
const SHEET_NUMBER_END =
  "A sheet number cannot end with a space or a dot. Windows drops them from the end of a file's name, so the file would not have the number's name";
const SHEET_NUMBER_DEVICE =
  "A sheet number cannot be a name Windows keeps for a device: CON, PRN, AUX, NUL, COM1 to COM9 or LPT1 to LPT9, in any case and with any extension. Windows opens the device in place of a file of that name";
const XREF_PATH_EMPTY =
  "An xref's path cannot be empty. The leading CAD app then looks for a DWG file named as the xref is";
const XREF_PATH_DXF =
  "An xref's path cannot end in .dxf. The leading CAD app loads only a DWG file as an xref: it reports that it is unable to load a DXF, and draws nothing for it";
const XREF_PATH_ABSOLUTE =
  'An xref\'s path must start from the folder of the drawing\'s file, as "base.dwg" and "../survey/base.dwg" do, and cannot start with /, \\ or a drive such as C:. The leading CAD app takes an absolute path, and where that folder is missing, as on another machine, it loads a file of the same name from the drawing\'s folder when there is one and reports the xref as loaded';
const XREF_PATH_LENGTH =
  "An xref's path cannot be longer than 32,000 characters. The leading CAD app finds no file by a path that comes to more than 32,767 characters with the folder of the drawing";
const XREF_PATH_CHARS =
  "An xref's path cannot hold * ? < > | : or \". The leading CAD app finds no file whose name holds one of them. It does read a path wrapped in a pair of quotes as the path inside, and tsdraft wants that path written without them";
const XREF_PATH_DOT =
  "An xref's path cannot end in a dot. The leading CAD app adds .dwg after the dot, so for base. it looks for base..dwg and finds no file";
const XREF_PATH_MULTIBYTE =
  "An xref's path cannot hold a backslash before M+, a digit from 1 to 5 and four hex digits, such as \\M+10041. Once the leading CAD app has saved the drawing it reads those as one character, and looks for another file. Write / there";
const SCALE_ZERO =
  "A scale cannot be 0, or be written as 0, as tsdraft's 6 decimals write a scale under 0.0000005. The leading CAD app reads a scale of 0 as 1";
const TAG_EMPTY =
  "An attribute's tag cannot be empty. The leading CAD app's AUDIT reports an attribute with an empty tag";
const TAG_LOWER =
  "An attribute's tag cannot hold a lower-case letter a to z. The leading CAD app's ATTDEF command holds a tag in capitals, and its -ATTEDIT command finds no attribute whose tag has a lower-case letter";
const R12_TEXT =
  'tsdraft writes no text styles and no text justification to R12 drawings. Use DXF version "R2018" for a text style or a justified text';
const STANDARD_STYLE =
  "The text style Standard is in every drawing, with the font txt.shx, and cannot be defined. The leading CAD app keeps the first style of a name and skips a second";
const FONT =
  'A font must be one of FONTS, the fonts the 2025 release of the leading CAD app or Windows installs: an SHX font by its file name, such as "txt.shx", or a TrueType font by its typeface, such as "Arial". That app draws text in a font it does not have in another font, and its AUDIT reports nothing';
const OBLIQUE =
  "An oblique angle must be from -85 to 85 degrees. The leading CAD app's AUDIT reports a text style or a text slanted further";
const WIDTH_FACTOR =
  "A width factor must be from 0.01 to 100, the range the leading CAD app's STYLE command takes. That app's AUDIT reports a text style with a width factor of 0 or less, of 0.0001 or of 1000000";
const LINEWEIGHT =
  "A lineweight must be one of the leading CAD app's, in millimetres: 0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2 or 2.11";
const LAYER_LINEWEIGHT = `${LINEWEIGHT}, or "Default"`;
const ENTITY_LINEWEIGHT = `${LINEWEIGHT}, or "ByLayer", "ByBlock" or "Default"`;
const FROZEN_CURRENT =
  'Layer "0" cannot be frozen: it is the current layer, and the leading CAD app does not freeze the current layer';
const LAYER_LINETYPE =
  "A layer's linetype cannot be ByLayer or ByBlock. The leading CAD app's AUDIT reports a layer with either";
const BUILT_IN =
  "Continuous, ByLayer and ByBlock are in every drawing and cannot be defined. The leading CAD app keeps its own and drops the definition";
const PATTERN_COUNT =
  "A linetype pattern has 2 to 12 lengths, or none for a solid line. The leading CAD app's AUDIT reports a pattern of one length, and that app discards a drawing with a pattern of more than 12";
const PATTERN_WRITTEN_AS_ZERO =
  "A dash or gap of this length is written as 0, because tsdraft writes 6 decimals, and would draw as a dot. Use 0 for a dot, or a length of 0.000001 or more";
const PATTERN_TOTAL =
  "A linetype pattern's lengths, added up without their signs, must be under 1e100. The total is written too, and the leading CAD app reads only two exponent digits from DXF";
const PATTERN_TYPE = "A linetype's pattern must be an array of finite numbers";
const DESCRIPTION_LENGTH =
  "A linetype description cannot be longer than 249 characters, because the leading CAD app cuts it there when it reads DXF";
const ID_EMPTY = "An id cannot be empty";
const ID_CHARS = "An id can only use the letters A to Z and a to z, digits, ., - and _";
const ID_LENGTH = "An id cannot be longer than 64 characters";
const TEXT_PERCENT =
  'The leading CAD app reads "%%" in text as the start of a control code: it draws "%%d" as a degree sign and "%%%" as one percent sign. The text is stored as written';

type ForbiddenChar =
  | "<"
  | ">"
  | "/"
  | "\\"
  | '"'
  | ":"
  | ";"
  | "?"
  | "*"
  | "|"
  | "="
  | "`"
  | "^"
  | ","
  | "\n"
  | "\r"
  | "\t";

type Chars<S extends string, Found = never> = S extends `${infer C}${infer Rest}`
  ? Chars<Rest, Found | C>
  : Found;
type R12Char = Chars<"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$_-">;
type RejectedChar =
  | Chars<typeof REJECTED_FORMAT>
  | Chars<typeof REJECTED_LETTERLIKE>
  | Chars<typeof REJECTED_GLAGOLITIC>
  | Chars<typeof REJECTED_COPTIC>
  | Chars<typeof REJECTED_GEORGIAN>
  | Chars<typeof REJECTED_PRIVATE>;

/** Walks the name one character at a time, counting, so it can check both the characters and the length. */
type R12Name<
  N extends string,
  Rest extends string = N,
  Count extends 0[] = [],
> = Count["length"] extends 32
  ? typeof NAME_R12_LENGTH
  : Rest extends `${infer C}${infer Tail}`
    ? C extends R12Char
      ? R12Name<N, Tail, [...Count, 0]>
      : typeof NAME_R12_CHARS
    : N;

/** Resolves to `Valid` when `N` passes the rules layer and linetype names share, and to the message otherwise. */
type NameCheck<N extends string, M extends NameMessages, Valid> = N extends ""
  ? M["empty"]
  : N extends `${string}${ForbiddenChar}${string}`
    ? M["chars"]
    : N extends `${string}${RejectedChar}${string}`
      ? M["rejected"]
      : N extends ` ${string}` | `${string} `
        ? M["edge"]
        : Valid;

/**
 * Resolves to `N` when it is a valid layer name for DXF version `V`, and to the
 * error message otherwise, so the compiler reports the reason. Names that are
 * not literals pass the compiler and are checked when the code runs.
 */
export type LayerName<N extends string, V extends DxfVersion> = string extends N
  ? N
  : NameCheck<N, typeof LAYER_NAMES, V extends "R12" ? R12Name<N> : N>;

/**
 * Resolves to `N` when it is a valid name for a linetype to be used by, and to
 * the error message otherwise. The leading CAD app holds linetype names to the rules of
 * layer names, apart from R12's, since R12 drawings have no linetypes.
 */
export type LinetypeName<N extends string> = string extends N
  ? N
  : NameCheck<N, typeof LINETYPE_NAMES, N>;

type IdChar = Exclude<R12Char, "$"> | ".";

/** Walks the id one character at a time, counting, as `R12Name` walks a layer name. */
type IdCheck<
  I extends string,
  Rest extends string = I,
  Count extends 0[] = [],
> = Count["length"] extends 65
  ? typeof ID_LENGTH
  : Rest extends `${infer C}${infer Tail}`
    ? C extends IdChar
      ? IdCheck<I, Tail, [...Count, 0]>
      : typeof ID_CHARS
    : I;

/**
 * Resolves to `I` when it is a valid entity id, and to the error message otherwise: 1 to 64
 * characters, each a letter A to Z or a to z, a digit, `.`, `-` or `_`. An id that is not a
 * literal, such as `` `door-${n}` ``, passes the compiler: the first branch takes every type
 * that is not a union of literals. It is checked when the code runs, as is whether the drawing
 * already has the id.
 */
export type EntityId<I extends string> =
  {} extends Record<I, never> ? I : I extends "" ? typeof ID_EMPTY : IdCheck<I>;

type Enumerate<N extends number, A extends number[] = []> = A["length"] extends N
  ? A[number]
  : Enumerate<N, [...A, A["length"]]>;

/** A number in the color index CAD programs share: an integer from 1 to 255. */
export type Aci = Exclude<Enumerate<256>, 0>;

/** Resolves to `C` when it is a valid layer color, and to the error message otherwise. */
export type LayerColor<C extends number> = number extends C ? C : C extends Aci ? C : typeof COLOR;

/**
 * True for a number the writers round to 0, given as the compiler prints it.
 * A number under 0.000001 prints in exponent form, such as `4e-7`, and those
 * under 0.0000005 round to 0. `5e-7` itself is stored a little below a half,
 * so it rounds down too.
 */
type WrittenAsZero<S extends string> = S extends `${infer Mantissa}e-${infer Exponent}`
  ? Exponent extends "7"
    ? Mantissa extends "5"
      ? true
      : Mantissa extends `${5 | 6 | 7 | 8 | 9}${string}`
        ? false
        : true
    : true
  : false;

type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

/**
 * Resolves to `N` when it is a size the writers can keep, and to the error
 * message otherwise: `N` must be greater than 0, must not round to 0 at the
 * 6 decimals tsdraft writes, and must be under 1e100, where the compiler
 * prints a third exponent digit as the writers do.
 */
export type Positive<N extends number> = number extends N
  ? N
  : `${N}` extends `-${string}` | "0"
    ? typeof POSITIVE
    : WrittenAsZero<`${N}`> extends true
      ? typeof WRITTEN_AS_ZERO
      : `${N}` extends `${string}e+${Digit}${Digit}${Digit}`
        ? typeof TOO_LARGE
        : N;

/**
 * Resolves to `N` when it is greater than 0, and to `Message` otherwise. For a
 * number that is worked with before anything is written, where `Positive`
 * would refuse a small value for the 6 decimals.
 */
type AboveZero<N extends number, Message extends string> = number extends N
  ? N
  : `${N}` extends `-${string}` | "0"
    ? Message
    : N;

/** Resolves to `N` when it is a length on paper, and to the error message otherwise. */
export type PaperLength<N extends number> = AboveZero<N, typeof PAPER_LENGTH>;

/** Resolves to `N` when it is a scale ratio, and to the error message otherwise. */
export type Ratio<N extends number> = AboveZero<N, typeof RATIO>;

type BuiltInName = Lowercase<(typeof BUILT_IN_LINETYPES)[number]>;

/**
 * Resolves to `N` when it is a valid name for a new linetype, and to the error
 * message otherwise: a name that is valid to use, and not one of the linetypes
 * every drawing has.
 */
export type NewLinetypeName<N extends string> = string extends N
  ? N
  : Lowercase<N> extends BuiltInName
    ? typeof BUILT_IN
    : LinetypeName<N>;

/** Resolves to `N` when it is a valid linetype for a layer, and to the error message otherwise. */
export type LayerLinetypeName<N extends string> = string extends N
  ? N
  : Lowercase<N> extends "bylayer" | "byblock"
    ? typeof LAYER_LINETYPE
    : LinetypeName<N>;

type Unsigned<S extends string> = S extends `-${infer A}` ? A : S;

/**
 * Resolves to `N` when it is a valid name for a text style to be used by, and to the error
 * message otherwise. The leading CAD app holds text style names to the rules of layer names.
 */
export type TextStyleName<N extends string> = string extends N
  ? N
  : NameCheck<N, typeof TEXT_STYLE_NAMES, N>;

/**
 * Resolves to `N` when it is a valid name for a new text style, and to the error message
 * otherwise: a name that is valid to use, and not `Standard`, which every drawing has.
 */
export type NewTextStyleName<N extends string> = string extends N
  ? N
  : Lowercase<N> extends Lowercase<typeof STANDARD_TEXT_STYLE>
    ? typeof STANDARD_STYLE
    : TextStyleName<N>;

/**
 * Resolves to `N` when it is a valid block name, and to the error message otherwise. The leading
 * CAD app holds block names to the rules of layer names. Whether the drawing has the block, and
 * whether it has another that that app takes for the same, is checked when the code runs.
 */
export type BlockName<N extends string> = string extends N
  ? N
  : Lowercase<N> extends Lowercase<TickBlock>
    ? typeof ARROWHEAD_BLOCK
    : NameCheck<N, typeof BLOCK_NAMES, N>;

/** The blocks the leading CAD app draws arrowheads with. */
type TickBlock = "_ArchTick" | "_Oblique" | "_Open" | "_Dot" | "_None";

/**
 * Resolves to `N` when it is a valid name for a dimension style to be used by, and to the error
 * message otherwise. The leading CAD app holds dimension style names to the rules of layer names.
 * `Standard` is no style tsdraft draws a dimension in.
 */
export type DimensionStyleName<N extends string> = string extends N
  ? N
  : Lowercase<N> extends Lowercase<typeof STANDARD_DIMENSION_STYLE>
    ? typeof STANDARD_DIMENSION_STYLE_USED
    : NameCheck<N, typeof DIMENSION_STYLE_NAMES, N>;

/**
 * Resolves to `N` when it is a valid name for a new dimension style, and to the error message
 * otherwise: a name that is valid to use, and not `Standard`, which every drawing has.
 */
export type NewDimensionStyleName<N extends string> = string extends N
  ? N
  : Lowercase<N> extends Lowercase<typeof STANDARD_DIMENSION_STYLE>
    ? typeof STANDARD_DIMENSION_STYLE_DEFINED
    : NameCheck<N, typeof DIMENSION_STYLE_NAMES, N>;

/** Resolves to `A` when it is one of `ARROWHEADS`, and to the error message otherwise. */
export type ArrowheadOf<A extends string> = string extends A
  ? A
  : A extends Arrowhead
    ? A
    : typeof ARROWHEAD;

/**
 * Resolves to `N` when it is a size of a dimension style that may be 0, and to the error message
 * otherwise: `N` must not be less than 0, and must be under 1e100.
 */
export type NotNegative<
  N extends number,
  Message extends string = typeof NOT_NEGATIVE,
> = number extends N
  ? N
  : `${N}` extends `-${string}`
    ? Message
    : `${N}` extends `${string}e+${Digit}${Digit}${Digit}`
      ? typeof TOO_LARGE
      : N;

/** Resolves to `N` when it is a gap between a dimension's text and its line, and to the error message otherwise. */
export type TextGap<N extends number> = NotNegative<N, typeof TEXT_GAP>;

/**
 * Resolves to `N` when it is a scale a dimension style can have, and to `Message` otherwise:
 * greater than 0, not written as 0, and under 1e100.
 */
type StyleScale<N extends number, Message extends string> = number extends N
  ? N
  : `${N}` extends `-${string}` | "0"
    ? Message
    : Positive<N>;

/** Resolves to `N` when it is the overall scale of a dimension style, and to the error message otherwise. */
export type DimensionScale<N extends number> = StyleScale<N, typeof DIMENSION_SCALE>;

/** Resolves to `N` when it is the measurement scale of a dimension style, and to the error message otherwise. */
export type MeasurementScale<N extends number> = StyleScale<N, typeof MEASUREMENT_SCALE>;

/** Resolves to `P` when it is a precision the leading CAD app has, and to the error message otherwise. */
export type Precision<P extends number> = number extends P
  ? P
  : P extends Enumerate<9>
    ? P
    : typeof PRECISION;

/** Resolves to `Z` when it is a `suppressZeros`, and to the error message otherwise. */
export type ZeroSuppressionOf<Z extends string> = string extends Z
  ? Z
  : Z extends (typeof ZERO_SUPPRESSIONS)[number]
    ? Z
    : typeof ZERO_SUPPRESSION;

/** Resolves to `U` when it is a dimension style's `units`, and to the error message otherwise. */
export type DimensionUnitsOf<U extends string> = string extends U
  ? U
  : U extends (typeof DIMENSION_UNITS)[number]
    ? U
    : typeof DIMENSION_UNITS_MESSAGE;

/** Resolves to `Z` when it is a `feetInchZeros`, and to the error message otherwise. */
export type FeetInchZerosOf<Z extends string> = string extends Z
  ? Z
  : Z extends (typeof FEET_INCH_ZEROS)[number]
    ? Z
    : typeof FEET_INCH_ZEROS_MESSAGE;

/**
 * The zeros a style in the units `U` may leave out in decimal units: none in architectural
 * units, which resolves to the error message.
 */
export type SuppressZerosIn<U> = [U] extends ["architectural"]
  ? typeof ZEROS_OF_UNITS
  : (typeof ZERO_SUPPRESSIONS)[number];

/**
 * The zeros a style in the units `U` may write in feet and inches: none in decimal units, which
 * resolves to the error message.
 */
export type FeetInchZerosIn<U> = [U] extends ["decimal"]
  ? typeof ZEROS_OF_UNITS
  : (typeof FEET_INCH_ZEROS)[number];

/** Resolves to `N` when the leading CAD app takes it as the name of a dimension style, and to the error message otherwise. */
export type DimensionStyleNameOf<N extends string> = string extends N
  ? N
  : NameCheck<N, typeof DIMENSION_STYLE_NAMES, N>;

/**
 * Resolves to `S` when it is a suffix a dimension style can have, and to the error message
 * otherwise: no `\`, `{` or `}`, and no character a text cannot hold.
 */
export type DimensionAffix<S extends string> = string extends S
  ? S
  : S extends `${string}${"\\" | "{" | "}"}${string}`
    ? typeof DIMENSION_FORMATTING
    : Description<S>;

/** Resolves to `S` when it is a prefix a dimension style can have: a suffix with no `<>`. */
export type DimensionPrefix<S extends string> = string extends S
  ? S
  : S extends `${string}<>${string}`
    ? typeof PREFIX_MEASUREMENT
    : DimensionAffix<S>;

/**
 * Resolves to `T` when it is a text a dimension can have in place of its measurement, and to
 * the error message otherwise: not empty, not all spaces, and with no `\`, `{` or `}`. A text
 * with both `<>` and `[]` is refused when the code runs.
 */
export type DimensionText<T extends string> = string extends T
  ? T
  : Blank<T> extends true
    ? typeof DIMENSION_TEXT_BLANK
    : DimensionAffix<T>;

/** True for a string of nothing but spaces. */
type Blank<T extends string> = T extends ""
  ? true
  : T extends ` ${infer Rest}`
    ? Blank<Rest>
    : false;

/**
 * Resolves to `T` when it is a valid attribute tag, and to the error message otherwise: a
 * tag has at least one character, no lower-case letter a to z, and no character that a text
 * cannot hold.
 */
export type AttributeTag<T extends string> = string extends T
  ? T
  : T extends ""
    ? typeof TAG_EMPTY
    : T extends `${string}${LowerLetter}${string}`
      ? typeof TAG_LOWER
      : Description<T>;

type LowerLetter = Chars<"abcdefghijklmnopqrstuvwxyz">;

/**
 * Resolves to `P` when it is a path an xref can have, and to the error message otherwise: a
 * path is not empty, starts from the folder of the drawing's file, does not end in `.dxf` or
 * in a dot, and holds no `* ? < > | :`, no multibyte escape, no character a text cannot
 * hold, and no `"`: the leading CAD app reads a path wrapped in a pair of quotes, and tsdraft wants
 * it written without them. Its length is checked when the code runs.
 */
export type XrefPath<P extends string> = string extends P
  ? P
  : P extends ""
    ? typeof XREF_PATH_EMPTY
    : P extends `/${string}` | `\\${string}`
      ? typeof XREF_PATH_ABSOLUTE
      : Lowercase<P> extends `${LowerLetter}:${string}`
        ? typeof XREF_PATH_ABSOLUTE
        : P extends `${string}${Chars<'*?<>|:"'>}${string}`
          ? typeof XREF_PATH_CHARS
          : Lowercase<P> extends `${string}.dxf`
            ? typeof XREF_PATH_DXF
            : TrailingDot<Lowercase<P>> extends true
              ? typeof XREF_PATH_DOT
              : HasMultibyteEscape<Lowercase<P>> extends true
                ? typeof XREF_PATH_MULTIBYTE
                : Description<P>;

/**
 * Resolves to `P` when it is a path an image can have, and to the error message otherwise: a path
 * is not empty, starts from the folder of the drawing's file, and holds no `* ? < > | : "`, no
 * multibyte escape and no character a text cannot hold. Its length is checked when the code runs.
 */
export type ImagePath<P extends string> = string extends P
  ? P
  : P extends ""
    ? typeof IMAGE_PATH_EMPTY
    : P extends `/${string}` | `\\${string}`
      ? typeof IMAGE_PATH_ABSOLUTE
      : Lowercase<P> extends `${LowerLetter}:${string}`
        ? typeof IMAGE_PATH_ABSOLUTE
        : P extends `${string}${Chars<'*?<>|:"'>}${string}`
          ? typeof IMAGE_PATH_CHARS
          : HasMultibyteEscape<Lowercase<P>> extends true
            ? typeof IMAGE_PATH_MULTIBYTE
            : Description<P>;

/**
 * Resolves to `N` when it is a name a layout can have, and to the error message otherwise: a
 * name is not empty, is not `Model` in any case, holds none of `< > / \ " : ; ? * | , =` and
 * the backtick, no character a text cannot hold, and no space at either end. Its length, and
 * whether the drawing has another layout the leading CAD app takes for the same, are checked when
 * the code runs.
 */
export type LayoutName<N extends string> = string extends N
  ? N
  : N extends ""
    ? typeof LAYOUT_NAME_EMPTY
    : Lowercase<N> extends "model"
      ? typeof LAYOUT_NAME_MODEL
      : N extends `${string}${Chars<'<>/\\":;?*|,=`'>}${string}`
        ? typeof LAYOUT_NAME_CHARS
        : N extends ` ${string}` | `${string} `
          ? typeof LAYOUT_NAME_EDGE
          : Description<N>;

/** Resolves to `P` when it is one of `PAPERS`, and to the error message otherwise. */
export type PaperOf<P extends string> = string extends P ? P : P extends Paper ? P : typeof PAPER;

/** Resolves to `P` when it is one of `PLOT_STYLE_TABLES`, and to the error message otherwise. */
export type PlotStyleOf<P extends string> = string extends P
  ? P
  : P extends PlotStyleTable
    ? P
    : typeof PLOT_STYLE;

/** True for a path in lower case that ends in a dot other than the one after `.dwg`. */
type TrailingDot<I extends string> = I extends `${string}.`
  ? I extends `${string}.dwg.`
    ? false
    : true
  : false;

type Hex = Chars<"0123456789abcdef">;

/** True when a string in lower case holds a backslash, `m+`, a digit from 1 to 5 and four hex digits. */
type HasMultibyteEscape<P extends string> = P extends `${string}\\m+${infer After}`
  ? After extends `${"1" | "2" | "3" | "4" | "5"}${infer A}${infer B}${infer C}${infer D}${string}`
    ? [A, B, C, D] extends [Hex, Hex, Hex, Hex]
      ? true
      : HasMultibyteEscape<After>
    : HasMultibyteEscape<After>
  : false;

/**
 * Resolves to `N` when it is a scale an insert can have, and to the error message otherwise:
 * `N` must not be 0, must not round to 0 at the 6 decimals tsdraft writes, and must be under
 * 1e100 in size.
 */
type ScaleFactor<N extends number> = number extends N
  ? N
  : Unsigned<`${N}`> extends "0"
    ? typeof SCALE_ZERO
    : WrittenAsZero<Unsigned<`${N}`>> extends true
      ? typeof SCALE_ZERO
      : `${N}` extends `${string}e+${Digit}${Digit}${Digit}`
        ? typeof TOO_LARGE
        : N;

/**
 * Resolves to `S` when it is a scale for an insert, one number for both axes or `[x, y]`, and
 * to the error message otherwise. The false branch is never taken: it is there so that the
 * compiler infers `S` from a tuple as it does from a number.
 */
export type InsertScale<S extends number | readonly [number, number]> = [S] extends [
  number | readonly [number, number],
]
  ? CheckedScale<S>
  : S;

type CheckedScale<S> = S extends number
  ? ScaleFactor<S>
  : S extends readonly [infer X extends number, infer Y extends number]
    ? [ScaleFactor<X>] extends [X]
      ? [ScaleFactor<Y>] extends [Y]
        ? S
        : ScaleFactor<Y>
      : ScaleFactor<X>
    : S;

/** Resolves to `F` when it is one of `FONTS`, and to the error message otherwise. */
export type FontOf<F extends string> = string extends F ? F : F extends Font ? F : typeof FONT;

/**
 * Resolves to `N` when it is a width factor that is written as 0.01 to 100, and to the error
 * message otherwise. The writers keep 6 decimals, so 0.0099996 is written as 0.01 and
 * 100.0000004 as 100, and both pass, as they do when the code runs. The compiler prints a
 * number under 0.000001, or of 1e21 or more, in exponent form.
 */
export type WidthFactor<N extends number> = number extends N
  ? N
  : `${N}` extends
        | `${Exclude<Enumerate<100>, 0>}`
        | `${Exclude<Enumerate<100>, 0>}.${string}`
        | "100"
        | `100.000000${RoundsDown}${string}`
        | "100.0000005"
        | `0.009999${6 | 7 | 8 | 9}${string}`
        | `0.0099995${Digit}${string}`
    ? N
    : `${N}` extends `0.00${string}`
      ? typeof WIDTH_FACTOR
      : `${N}` extends `0.${string}`
        ? N
        : typeof WIDTH_FACTOR;

/** A seventh decimal that leaves the six before it as they are. */
type RoundsDown = 0 | 1 | 2 | 3 | 4;

/**
 * Resolves to `N` when it is an oblique angle that is written as -85 to 85 degrees, and to the
 * error message otherwise. An angle such as 85.0000004 is written as 85 and passes, as it does
 * when the code runs. The compiler prints a number under 0.000001 in size in exponent form.
 */
export type ObliqueAngle<N extends number> = number extends N
  ? N
  : Unsigned<`${N}`> extends
        | `${Enumerate<86>}`
        | `${Enumerate<85>}.${string}`
        | `85.000000${RoundsDown}${string}`
        | "85.0000005"
        | `${string}e-${string}`
    ? N
    : typeof OBLIQUE;

/**
 * The message for each literal pattern length the writers cannot keep: one
 * written as 0 that is not 0, or one of 1e100 or more in size.
 */
type LengthProblem<N extends number> = N extends unknown
  ? number extends N
    ? never
    : Unsigned<`${N}`> extends "0"
      ? never
      : WrittenAsZero<Unsigned<`${N}`>> extends true
        ? typeof PATTERN_WRITTEN_AS_ZERO
        : Unsigned<`${N}`> extends `${string}e+${Digit}${Digit}${Digit}`
          ? typeof TOO_LARGE
          : never
  : never;

/** The message for the first length of `P` with a problem, in the order `linetypeProblem` checks them. */
type FirstLengthProblem<P extends readonly number[]> = P extends readonly [
  infer N extends number,
  ...infer Rest extends readonly number[],
]
  ? [LengthProblem<N>] extends [never]
    ? FirstLengthProblem<Rest>
    : LengthProblem<N>
  : never;

/**
 * Resolves to `P` when it is a pattern the leading CAD app accepts, and to the error
 * message otherwise. A pattern that is not a tuple, and the total of the
 * lengths, which the compiler cannot add, are checked when the code runs.
 */
export type Pattern<P extends readonly number[]> = number extends P["length"]
  ? P
  : P["length"] extends 0 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
    ? [FirstLengthProblem<P>] extends [never]
      ? P
      : FirstLengthProblem<P>
    : typeof PATTERN_COUNT;

type ControlChar =
  Chars<"\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u0009\u000a\u000b\u000c\u000d\u000e\u000f\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001a\u001b\u001c\u001d\u001e\u001f\u007f">;

/**
 * Resolves to `D` when it is a linetype description the leading CAD app keeps, and to the
 * error message otherwise. Its length, and characters above U+FFFF, are checked
 * when the code runs.
 */
export type Description<D extends string> = string extends D
  ? D
  : D extends `${string}${ControlChar}${string}`
    ? typeof TEXT_CONTROL
    : D extends `${string}${Chars<typeof REJECTED_PRIVATE>}${string}`
      ? typeof TEXT_PRIVATE_USE
      : D;

/** A lineweight the leading CAD app offers, in millimetres. */
export type LineweightMm =
  | 0
  | 0.05
  | 0.09
  | 0.13
  | 0.15
  | 0.18
  | 0.2
  | 0.25
  | 0.3
  | 0.35
  | 0.4
  | 0.5
  | 0.53
  | 0.6
  | 0.7
  | 0.8
  | 0.9
  | 1
  | 1.06
  | 1.2
  | 1.4
  | 1.58
  | 2
  | 2.11;

/** Resolves to `W` when it is one of the leading CAD app's lineweights, and to the error message otherwise. */
export type LineweightOf<W extends number> = number extends W
  ? W
  : W extends LineweightMm
    ? W
    : typeof LINEWEIGHT;

/** The message for each feature an R12 drawing cannot have, as a type. */
export type R12Linetypes = typeof R12_LINETYPES;
export type R12Lineweights = typeof R12_LINEWEIGHTS;
export type R12EntityStyle = typeof R12_ENTITY_STYLE;
export type R12LayerStates = typeof R12_LAYER_STATES;
export type FrozenCurrent = typeof FROZEN_CURRENT;
export type R12Text = typeof R12_TEXT;
export type R12Blocks = typeof R12_BLOCKS;
export type R12Xrefs = typeof R12_XREFS;
export type R12Layouts = typeof R12_LAYOUTS;
export type R12Dimensions = typeof R12_DIMENSIONS;
export type R12Leaders = typeof R12_LEADERS;
export type R12Polylines = typeof R12_POLYLINES;
export type R12Paragraphs = typeof R12_PARAGRAPHS;
export type R12Images = typeof R12_IMAGES;

/** Resolves to `N` when it is a width a polyline can have, and to the error message otherwise. */
export type PolylineWidth<N extends number> = NotNegative<N, typeof POLYLINE_WIDTH>;

/** Resolves to `N` when it is a donut's hole, and to the error message otherwise. */
export type DonutHole<N extends number> = NotNegative<N, typeof DONUT_HOLE>;

/**
 * Resolves to `N` when it is a line spacing factor a paragraph can have, from 0.25 to 4, and to
 * the error message otherwise.
 */
export type LineSpacing<N extends number> = number extends N
  ? N
  : `${N}` extends
        | `0.${"0" | "1"}${string}`
        | `0.2${"0" | "1" | "2" | "3" | "4"}${string}`
        | `0.${"0" | "1" | "2"}`
        | `-${string}`
        | `${string}e${string}`
        | "0"
    ? typeof LINE_SPACING
    : `${N}` extends `0.${string}` | `${"1" | "2" | "3"}` | `${"1" | "2" | "3"}.${string}` | "4"
      ? N
      : typeof LINE_SPACING;

/** A digit of a hexadecimal number, in either case. */
type HexDigit = Chars<"0123456789abcdefABCDEF">;

/**
 * The first of `\`, `{`, `}` and `%` in `S`, and what follows it, or `undefined` for none: a
 * delimiter is the first when what comes before it holds none of the others.
 */
type ParagraphStep<S extends string> = S extends `${infer A}\\${infer R}`
  ? A extends `${string}${"{" | "}" | "%"}${string}`
    ? ParagraphBrace<S>
    : ["\\", R]
  : ParagraphBrace<S>;

type ParagraphBrace<S extends string> = S extends `${infer A}{${infer R}`
  ? A extends `${string}${"}" | "%" | "\\"}${string}`
    ? ParagraphClose<S>
    : ["{", R]
  : ParagraphClose<S>;

type ParagraphClose<S extends string> = S extends `${infer A}}${infer R}`
  ? A extends `${string}${"%" | "\\" | "{"}${string}`
    ? ParagraphPercent<S>
    : ["}", R]
  : ParagraphPercent<S>;

type ParagraphPercent<S extends string> = S extends `${string}%${infer R}` ? ["%", R] : undefined;

/** The codes of a paragraph that draw a character, and need nothing after them. */
type ParagraphPlainCode = "P" | "N" | "~" | "\\" | "{" | "}" | "o";

/** The codes that set what the characters after them are and end with a `;`. */
type ParagraphEndedCode = "H" | "W" | "Q" | "A" | "C";

/** True for all zeros. */
type AllZeros<S extends string> = S extends `0${infer R}`
  ? R extends ""
    ? true
    : AllZeros<R>
  : false;

/** True for one to `M` digits, as many as `Most` holds. */
type FewDigits<
  S extends string,
  Most extends 0[],
  K extends 0[] = [0],
> = S extends `${Digit}${infer R}`
  ? R extends ""
    ? true
    : K["length"] extends Most["length"]
      ? false
      : FewDigits<R, Most, [...K, 0]>
  : false;

type Fifteen = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
type SixtyFour = [...Fifteen, ...Fifteen, ...Fifteen, ...Fifteen, 0, 0, 0, 0];

/** True for nothing, or a point and digits. */
type Fraction<S extends string> = S extends ""
  ? true
  : S extends `.${infer F}`
    ? AllDigits<F>
    : false;

/** True for a number of at most 15 digits before its point and 64 after, above 0, as `\H` and `\W` take. */
type CodeAmount<S extends string> = S extends `${infer I}.${infer F}`
  ? FewDigits<I, Fifteen> extends true
    ? FewDigits<F, SixtyFour> extends true
      ? AllZeros<`${I}${F}`> extends true
        ? false
        : true
      : false
    : false
  : FewDigits<S, Fifteen> extends true
    ? AllZeros<S> extends true
      ? false
      : true
    : false;

type Below85 =
  | Digit
  | `${"1" | "2" | "3" | "4" | "5" | "6" | "7"}${Digit}`
  | `8${"0" | "1" | "2" | "3" | "4"}`;

/** True for an angle from -85 to 85, as `\Q` takes. */
type CodeOblique<S extends string> = S extends `-${infer R}` ? CodeOblique85<R> : CodeOblique85<S>;
type CodeOblique85<S extends string> = S extends `${infer I}.${infer F}`
  ? FewDigits<F, SixtyFour> extends true
    ? I extends Below85
      ? true
      : I extends "85"
        ? AllZeros<F>
        : false
    : false
  : S extends Below85 | "85"
    ? true
    : false;

type Below258 =
  | Digit
  | `${"1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"}${Digit}`
  | `1${Digit}${Digit}`
  | `2${"0" | "1" | "2" | "3" | "4"}${Digit}`
  | `25${"0" | "1" | "2" | "3" | "4" | "5" | "6" | "7"}`;

/** True for the argument code `C` takes, as `ARGUMENTS` in `src/paragraph-codes.ts` reads it. */
type CodeArgument<C extends ParagraphEndedCode, S extends string> = C extends "H"
  ? S extends `${infer A}x`
    ? CodeAmount<A>
    : CodeAmount<S>
  : C extends "W"
    ? CodeAmount<S>
    : C extends "Q"
      ? CodeOblique<S>
      : C extends "A"
        ? S extends "0" | "1" | "2"
          ? true
          : false
        : S extends Below258
          ? true
          : false;

/**
 * Whether the characters are underlined, `L`, struck through, `K`, both or neither, as the codes
 * `\L`, `\l`, `\K` and `\k` set it and each `}` puts it back.
 */
type Lined = "" | "L" | "K" | "LK";

/**
 * The format the walk keeps of the characters, as each `{` saves it and its `}` puts it back:
 * their lines, and whether a `\f` or `\F` has set them in an SHX font.
 */
interface Format {
  readonly lined: Lined;
  readonly shx: boolean;
}

/** The format of a value's first character. */
interface PlainFormat extends Format {
  readonly lined: "";
  readonly shx: false;
}

/** What `\L`, `\l`, `\K` and `\k` make of `F`. */
type Relined<F extends Lined, C extends "L" | "l" | "K" | "k"> = C extends "L"
  ? F extends "K" | "LK"
    ? "LK"
    : "L"
  : C extends "l"
    ? F extends "K" | "LK"
      ? "K"
      : ""
    : C extends "K"
      ? F extends "L" | "LK"
        ? "LK"
        : "K"
      : F extends "L" | "LK"
        ? "L"
        : "";

/**
 * Resolves to `T` when it is a value a paragraph can be given, and to the error message
 * otherwise: no control character but a line feed, which is a paragraph break, and no character a
 * text cannot hold, and the codes `parseParagraph` reads, each as tsdraft lays it out, with `%%c`
 * refused in an SHX font that a `\f` or `\F` names. Two checks are left to the code when it
 * runs: `%%c` in the paragraph's own font, which only the style knows, and a character above
 * U+FFFF, since TypeScript reads a template literal type by code points and never splits the
 * surrogate pair that holds one, so no pattern of a type can find it.
 */
export type ParagraphValue<T extends string> = string extends T
  ? T
  : T extends `${string}${Exclude<ControlChar, "\n" | "\t">}${string}`
    ? typeof PARAGRAPH_CONTROL
    : T extends `${string}${Chars<typeof REJECTED_PRIVATE>}${string}`
      ? typeof PARAGRAPH_PRIVATE_USE
      : ParagraphCodes<T, T, [], [], PlainFormat>;

/**
 * The most steps the walk of a literal value takes. A value that needs more passes as it is, and
 * is checked when the code runs, so the compiler never gives up on a long one.
 */
type ParagraphTypeSteps = 250;

/**
 * Walks `S`, the rest of the value `T`, from one special character to the next, with what each
 * open brace saved in `D`, a mark in `N` for each step, and the format of the characters in `F`.
 */
type ParagraphCodes<
  T extends string,
  S extends string,
  D extends Format[],
  N extends 0[],
  F extends Format,
> = N["length"] extends ParagraphTypeSteps
  ? T
  : ParagraphStep<S> extends [infer M, infer R extends string]
    ? M extends "{"
      ? D["length"] extends typeof PARAGRAPH_NESTING
        ? typeof PARAGRAPH_TOO_DEEP
        : ParagraphCodes<T, R, [...D, F], [...N, 0], F>
      : M extends "}"
        ? D extends [...infer E extends Format[], infer Saved extends Format]
          ? ParagraphCodes<T, R, E, [...N, 0], Saved>
          : typeof PARAGRAPH_NEVER_OPENED
        : M extends "%"
          ? R extends `%${"c" | "C"}${infer After}`
            ? F["shx"] extends true
              ? typeof PARAGRAPH_SHX_DIAMETER
              : ParagraphCodes<T, After, D, [...N, 0], F>
            : R extends `%${"d" | "D" | "p" | "P"}${infer After}`
              ? ParagraphCodes<T, After, D, [...N, 0], F>
              : ParagraphCodes<T, R, D, [...N, 0], F>
          : ParagraphCode<T, R, D, N, F>
    : D extends []
      ? T
      : typeof PARAGRAPH_NEVER_CLOSED;

/** Reads the code after a backslash, `R` and what follows it. */
type ParagraphCode<
  T extends string,
  R extends string,
  D extends Format[],
  N extends 0[],
  F extends Format,
> = R extends `${infer C}${infer After}`
  ? C extends ParagraphPlainCode
    ? ParagraphCodes<T, After, D, [...N, 0], F>
    : C extends "L" | "l" | "K" | "k"
      ? ParagraphCodes<T, After, D, [...N, 0], { lined: Relined<F["lined"], C>; shx: F["shx"] }>
      : C extends "f" | "F"
        ? After extends `${infer Body};${infer Next}`
          ? ParagraphFont<T, C, Body, Next, D, N, F>
          : ReturnType<typeof paragraphNoSemicolon<C>>
        : C extends "S"
          ? ParagraphStack<T, After, D, false, N, F, "", true>
          : C extends "p"
            ? After extends `${infer Body};${infer Next}`
              ? ParagraphProperties<
                  Body extends `x${infer Rest}` ? Rest : Body,
                  "option",
                  [...N, 0]
                > extends true
                ? ParagraphCodes<T, Next, D, [...N, 0], F>
                : ParagraphProperties<
                    Body extends `x${infer Rest}` ? Rest : Body,
                    "option",
                    [...N, 0]
                  >
              : ReturnType<typeof paragraphNoSemicolon<C>>
            : C extends "T" | "c"
              ? After extends `${string};${string}`
                ? ReturnType<typeof paragraphNotLaidOut<C>>
                : ReturnType<typeof paragraphNoSemicolon<C>>
              : C extends ParagraphEndedCode
                ? After extends `${infer Argument};${infer Next}`
                  ? CodeArgument<C, Argument> extends true
                    ? ParagraphCodes<T, Next, D, [...N, 0], F>
                    : ReturnType<typeof paragraphCodeArgument<C>>
                  : ReturnType<typeof paragraphNoSemicolon<C>>
                : C extends "X" | "O"
                  ? ReturnType<typeof paragraphNotLaidOut<C>>
                  : C extends "U" | "u"
                    ? After extends `+${infer H1}${infer H2}${infer H3}${infer H4}${infer Next}`
                      ? [H1, H2, H3, H4] extends [HexDigit, HexDigit, HexDigit, HexDigit]
                        ? ParagraphUnicode<T, Lowercase<`${H1}${H2}${H3}${H4}`>, Next, D, N, F>
                        : ReturnType<typeof paragraphUnknownCode<C>>
                      : ReturnType<typeof paragraphUnknownCode<C>>
                    : C extends "M" | "m"
                      ? After extends `+${"1" | "2" | "3" | "4" | "5"}${infer H1}${infer H2}${infer H3}${infer H4}${string}`
                        ? [H1, H2, H3, H4] extends [HexDigit, HexDigit, HexDigit, HexDigit]
                          ? ReturnType<typeof paragraphNotLaidOut<C>>
                          : ReturnType<typeof paragraphUnknownCode<C>>
                        : ReturnType<typeof paragraphUnknownCode<C>>
                      : ReturnType<typeof paragraphUnknownCode<C>>
  : typeof PARAGRAPH_TRAILING;

/**
 * Where the walk of a `\p` code's options stands: before an option, where a number starts, after
 * its sign, after its point with no digit yet, among its digits, or among a tab stop's, where a
 * comma may start another stop.
 */
type PropertyState = "option" | "number" | "signed" | "point" | "digits" | "decimals";

/**
 * True for the options of a `\p` code after its `x`, as `readProperties` in
 * `src/paragraph-codes.ts` reads them, and the message otherwise, which quotes an option by its
 * letter and the character after it, `O`. `Stops` is true inside a list of tab stops. Past the
 * walk's steps it gives up and leaves the rest to the runtime check.
 */
type ParagraphProperties<
  S extends string,
  State extends PropertyState,
  N extends 0[],
  O extends string = "",
  Stops extends boolean = false,
> = N["length"] extends ParagraphTypeSteps
  ? true
  : State extends "option"
    ? S extends `${infer C}${infer R}`
      ? C extends ","
        ? ParagraphProperties<R, "option", [...N, 0]>
        : C extends "i" | "l" | "r" | "b" | "a"
          ? ParagraphProperties<R, "number", [...N, 0], PropertyOption<S>>
          : C extends "q"
            ? R extends `${"l" | "c" | "r" | "j" | "d"}${infer After}`
              ? ParagraphProperties<After, "option", [...N, 0]>
              : ReturnType<typeof paragraphPropertyUnknown<PropertyOption<S>>>
            : C extends "s"
              ? R extends `${"m" | "e"}${infer After}`
                ? ParagraphProperties<After, "number", [...N, 0], PropertyOption<S>>
                : R extends `a${string}`
                  ? typeof PARAGRAPH_SPACING_AT_LEAST
                  : ReturnType<typeof paragraphPropertyUnknown<PropertyOption<S>>>
              : C extends "t"
                ? R extends `z${infer After}`
                  ? ParagraphProperties<After, "option", [...N, 0]>
                  : R extends `${"r" | "c" | "d"}${string}`
                    ? typeof PARAGRAPH_TAB_KIND
                    : ParagraphProperties<R, "number", [...N, 0], PropertyOption<S>, true>
                : ReturnType<typeof paragraphPropertyUnknown<PropertyOption<S>>>
      : true
    : State extends "number" | "signed" | "point"
      ? S extends `${infer C}${infer R}`
        ? C extends Digit
          ? ParagraphProperties<
              R,
              State extends "point" ? "decimals" : "digits",
              [...N, 0],
              O,
              Stops
            >
          : [State, C] extends ["number", "-"]
            ? ParagraphProperties<R, "signed", [...N, 0], O, Stops>
            : [State, C] extends ["number" | "signed", "."]
              ? ParagraphProperties<R, "point", [...N, 0], O, Stops>
              : ReturnType<typeof paragraphPropertyUnknown<O>>
        : ReturnType<typeof paragraphPropertyUnknown<O>>
      : S extends `${Digit}${infer R}`
        ? ParagraphProperties<R, State, [...N, 0], O, Stops>
        : [State, S] extends ["digits", `.${infer R}`]
          ? ParagraphProperties<R, "decimals", [...N, 0], O, Stops>
          : Stops extends true
            ? S extends `,${infer R}`
              ? R extends `${"r" | "c" | "d"}${string}`
                ? typeof PARAGRAPH_TAB_KIND
                : R extends `${Digit | "." | "-"}${string}`
                  ? ParagraphProperties<R, "number", [...N, 0], O, true>
                  : ParagraphProperties<S, "option", [...N, 0]>
              : ParagraphProperties<S, "option", [...N, 0]>
            : ParagraphProperties<S, "option", [...N, 0]>;

/**
 * The option a message quotes: its letter and the character after it, as the builder holds them, a
 * line feed as the `\P` it becomes.
 */
type PropertyOption<S extends string> = S extends `\n${string}`
  ? "\\P"
  : S extends `${infer A}${infer B}${string}`
    ? `${A}${B extends "\n" ? "\\" : B}`
    : S;

/** A `\U+XXXX` code, with its four digits in lower case. */
type ParagraphUnicode<
  T extends string,
  X extends string,
  Next extends string,
  D extends Format[],
  N extends 0[],
  F extends Format,
> = X extends `00${"0" | "1"}${string}` | "007f"
  ? typeof PARAGRAPH_CONTROL
  : X extends `d${"8" | "9" | "a" | "b" | "c" | "d" | "e" | "f"}${string}`
    ? typeof PARAGRAPH_ASTRAL
    : X extends `e8${string}`
      ? typeof PARAGRAPH_PRIVATE_USE
      : ParagraphCodes<T, Next, D, [...N, 0], F>;

/** A `\f` or `\F` code: a font of `FONTS`, then its options. */
type ParagraphFont<
  T extends string,
  C extends "f" | "F",
  Body extends string,
  Next extends string,
  D extends Format[],
  N extends 0[],
  F extends Format,
> = Body extends `${infer Name}|${infer Options}`
  ? Name extends Font
    ? ParagraphFontOptions<T, C, Name, Options, Next, D, [...N, 0], InFont<F, Name>>
    : ReturnType<typeof paragraphUnknownFont<C, Name>>
  : Body extends Font
    ? ParagraphCodes<T, Next, D, [...N, 0], InFont<F, Body>>
    : ReturnType<typeof paragraphUnknownFont<C, Body>>;

/** `F` in the font `Name`, which is an SHX font when it has no bold face. */
type InFont<F extends Format, Name extends Font> = {
  lined: F["lined"];
  shx: Name extends BoldFont ? false : true;
};

/** The options of a font code, with the letters of those given so far in `Given`. */
type ParagraphFontOptions<
  T extends string,
  C extends "f" | "F",
  Name extends Font,
  O extends string,
  Next extends string,
  D extends Format[],
  N extends 0[],
  F extends Format,
  Given extends string = never,
> = N["length"] extends ParagraphTypeSteps
  ? T
  : O extends `${infer First}|${infer More}`
    ? ParagraphFontOnce<C, Name, First, Given> extends true
      ? ParagraphFontOptions<T, C, Name, More, Next, D, [...N, 0], F, Given | OptionLetter<First>>
      : ParagraphFontOnce<C, Name, First, Given>
    : ParagraphFontOnce<C, Name, O, Given> extends true
      ? ParagraphCodes<T, Next, D, [...N, 0], F>
      : ParagraphFontOnce<C, Name, O, Given>;

/** The letter of a font option. */
type OptionLetter<O extends string> = O extends `${infer L}${string}` ? L : never;

/** True for an option a font may have whose letter `Given` does not hold, and the message otherwise. */
type ParagraphFontOnce<
  C extends string,
  Name extends Font,
  O extends string,
  Given extends string,
> =
  ParagraphFontOption<C, Name, O> extends true
    ? O extends `${Given}${string}`
      ? ReturnType<typeof paragraphFontOptionTwice<C, OptionLetter<O>>>
      : true
    : ParagraphFontOption<C, Name, O>;

/**
 * True for one or more digits, as `isNumbered` in `src/paragraph-codes.ts` reads a font option's
 * number. Past 64 it gives up and leaves the rest to the runtime check.
 */
type AllDigits<S extends string, K extends 0[] = []> = K["length"] extends 64
  ? true
  : S extends `${Digit}${infer R}`
    ? R extends ""
      ? true
      : AllDigits<R, [...K, 0]>
    : false;

/** True for an option a font may have, and the message otherwise. */
type ParagraphFontOption<C extends string, Name extends Font, O extends string> = O extends
  | "b0"
  | "i0"
  ? true
  : O extends `${"c" | "p"}${infer Count}`
    ? AllDigits<Count> extends true
      ? true
      : ReturnType<typeof paragraphFontOption<C, O>>
    : O extends "b1"
      ? Name extends BoldFont
        ? true
        : ReturnType<typeof paragraphShxBold<C, Name>>
      : O extends "i1"
        ? ReturnType<typeof paragraphItalic<C>>
        : ReturnType<typeof paragraphFontOption<C, O>>;

/** A digit or a capital, which a stacked part may hold. */
type Tall = Chars<"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ">;

/**
 * What a stacked part holds so far: nothing, `""`; spaces only, `"s"`; signs only, `"o"`; digits or
 * capitals with signs or not, `"t"`; or something it may not hold, `"x"`.
 */
type PartHolds = "" | "s" | "o" | "t" | "x";

/** What a part holds after the character `C`. */
type PartStep<P extends PartHolds, C extends string> = C extends " "
  ? P extends "" | "s"
    ? "s"
    : "x"
  : C extends Tall
    ? P extends "" | "o" | "t"
      ? "t"
      : "x"
    : C extends "." | "," | "+" | "-"
      ? P extends "" | "o"
        ? "o"
        : P extends "t"
          ? "t"
          : "x"
      : "x";

/**
 * A `\S` code from after its letter: its parts, divided by the first `/`, `#` or `^`, up to its
 * `;`, with what the part being read holds in `P` and whether the top part may be stacked in
 * `Top`. It is refused in underlined or struck-through characters.
 */
type ParagraphStack<
  T extends string,
  S extends string,
  D extends Format[],
  Divided extends boolean,
  N extends 0[],
  F extends Format,
  P extends PartHolds,
  Top extends boolean,
> = N["length"] extends ParagraphTypeSteps
  ? T
  : S extends `\\${infer C}${infer R}`
    ? ParagraphStack<T, R, D, Divided, [...N, 0], F, PartStep<P, C>, Top>
    : S extends `;${infer R}`
      ? Divided extends true
        ? F["lined"] extends ""
          ? [Top, P extends "" | "s" | "t" ? true : false] extends [true, true]
            ? ParagraphCodes<T, R, D, [...N, 0], F>
            : typeof PARAGRAPH_STACK_PART
          : typeof PARAGRAPH_STACK_LINED
        : typeof PARAGRAPH_STACK_SEPARATOR
      : S extends `${"/" | "#" | "^"}${infer R}`
        ? Divided extends true
          ? ParagraphStack<T, R, D, true, [...N, 0], F, "x", Top>
          : ParagraphStack<T, R, D, true, [...N, 0], F, "", P extends "" | "s" | "t" ? true : false>
        : S extends `${infer C}${infer R}`
          ? ParagraphStack<T, R, D, Divided, [...N, 0], F, PartStep<P, C>, Top>
          : ReturnType<typeof paragraphNoSemicolon<"S">>;

/** Returns what is wrong with a layer name for a DXF version, or undefined when it is valid. */
export function layerNameProblem(name: string, version: DxfVersion): string | undefined {
  const problem = nameProblem(name, LAYER_NAMES);
  if (problem) return problem;
  if (version === "R12") {
    if (!/^[A-Za-z0-9$_-]+$/.test(name)) return NAME_R12_CHARS;
    if (name.length > 31) return NAME_R12_LENGTH;
  }
  return undefined;
}

/**
 * Returns what is wrong with a linetype name, or undefined when it is valid.
 * The name may be one of the linetypes every drawing has.
 */
export function linetypeNameProblem(name: string): string | undefined {
  return nameProblem(name, LINETYPE_NAMES);
}

function nameProblem(name: string, messages: NameMessages): string | undefined {
  if (name.length === 0) return messages.empty;
  if (/[<>/\\":;?*|=`^,]/.test(name) || hasControl(name) || hasAstral(name)) return messages.chars;
  const rejected = rejectedNameCharacter(name);
  if (rejected !== undefined) return `${messages.rejected}. This name has ${codePoint(rejected)}`;
  // Only the ASCII space: the leading CAD app takes a no-break space or any other at either end.
  if (name.startsWith(" ") || name.endsWith(" ")) return messages.edge;
  if (name.length > 255) return messages.length;
  return undefined;
}

/**
 * Returns what is wrong with a drawing that has both names as layers, or
 * undefined when the two can stand together. The leading CAD app looks layers up one way
 * and its AUDIT compares their names another, so some pairs of names are two
 * layers to that app and one duplicate name to AUDIT: `ΟΔΟΣ` and `οδος`,
 * `straße` and `strasse`, a composed é and a decomposed one, and a name with
 * and without a soft hyphen. `layerAuditKey` lists the kinds this covers,
 * which are not all that AUDIT reports. Names that are one layer to that app
 * are not this function's concern. The rule compares two names, so it has no
 * type.
 *
 * @param name - The name of the layer being checked.
 * @param other - The name of another layer in the drawing.
 * @param kind - Whether the names are of layers, of linetypes or of text styles, which that app
 *   compares alike.
 * @returns The problem, or undefined.
 */
export function layerTwinProblem(
  name: string,
  other: string,
  kind: "layer" | "linetype" | "text style" = "layer",
): string | undefined {
  if (layerKey(name) === layerKey(other) || layerAuditKey(name) !== layerAuditKey(other)) {
    return undefined;
  }
  return `The leading CAD app keeps this ${kind} and ${JSON.stringify(other)} as two ${kind}s, but its AUDIT reports them as one duplicate name`;
}

/**
 * Returns what is wrong with a linetype definition, or undefined when it is
 * valid. It takes `unknown`s so that `lint` can report a drawing built by hand
 * with a field of the wrong type.
 */
export function linetypeProblem(
  name: unknown,
  description: unknown,
  pattern: unknown,
): string | undefined {
  if (typeof name !== "string") return "A linetype's name must be a string";
  const nameError = linetypeNameProblem(name);
  if (nameError) return nameError;
  if (builtInLinetype(name)) return BUILT_IN;
  if (typeof description !== "string") return "A linetype's description must be a string";
  const descriptionError = textProblem(description);
  if (descriptionError) return `its description: ${descriptionError}`;
  if (description.length > 249) return DESCRIPTION_LENGTH;
  if (!Array.isArray(pattern) || !(pattern instanceof Array)) return PATTERN_TYPE;
  if (pattern.length === 1 || pattern.length > 12) return PATTERN_COUNT;
  for (const length of pattern as unknown[]) {
    if (typeof length !== "number" || !Number.isFinite(length)) return PATTERN_TYPE;
    if (length !== 0 && written(length) === 0) return `its pattern: ${PATTERN_WRITTEN_AS_ZERO}`;
    const problem = magnitudeProblem(length);
    if (problem) return `its pattern: ${problem}`;
  }
  // The writers write the total of the lengths as they write each one, rounded.
  if (isTooLarge(patternLength((pattern as number[]).map(written)))) {
    return `its pattern: ${PATTERN_TOTAL}`;
  }
  return undefined;
}

/**
 * Returns what is wrong with a layer or an entity that names a linetype the
 * drawing does not have. The rule depends on the drawing, so it has no type.
 */
export function undefinedLinetypeProblem(name: string): string {
  return `Linetype ${JSON.stringify(name)} is not defined, and the leading CAD app discards a drawing that uses a linetype it does not have`;
}

/** Returns what is wrong with the linetype a layer names, or undefined when it can be a layer's. */
export function layerLinetypeProblem(name: string): string | undefined {
  const builtInName = builtInLinetype(name);
  return builtInName === "ByLayer" || builtInName === "ByBlock" ? LAYER_LINETYPE : undefined;
}

/**
 * Returns what is wrong with a lineweight, or undefined when it is valid. A
 * layer's lineweight may also be "Default", and an entity's "ByLayer",
 * "ByBlock" or "Default". The leading CAD app discards a drawing with an entity of any
 * other lineweight, and gives a layer of another lineweight the default.
 *
 * @param value - The lineweight, in millimetres or by name.
 * @param of - Whose lineweight it is.
 * @returns The problem, or undefined.
 */
export function lineweightProblem(value: unknown, of: "layer" | "entity"): string | undefined {
  if (value === "Default" || (of === "entity" && (value === "ByLayer" || value === "ByBlock"))) {
    return undefined;
  }
  if (typeof value === "number" && (LINEWEIGHTS as readonly number[]).includes(value))
    return undefined;
  return of === "layer" ? LAYER_LINEWEIGHT : ENTITY_LINEWEIGHT;
}

/**
 * Returns what is wrong with a layer's states, or undefined when the leading CAD app takes
 * them. tsdraft writes layer "0" as the current layer, and that app's AUDIT
 * reports a drawing whose current layer is frozen.
 */
export function layerStateProblem(name: string, frozen: boolean | undefined): string | undefined {
  return frozen && name === "0" ? FROZEN_CURRENT : undefined;
}

/** Returns what is wrong with the value of a layer's `off`, `frozen`, `locked` or `plot`. */
export function layerFlagProblem(state: string, value: unknown): string | undefined {
  return value === undefined || typeof value === "boolean"
    ? undefined
    : `${state} must be true or false`;
}

/**
 * Returns what is wrong with the global linetype scale, or undefined when it is
 * valid. The leading CAD app reads a scale of 0 or less, or one written as 0, as 1.
 */
export function linetypeScaleProblem(value: number): string | undefined {
  if (!Number.isFinite(value)) return "This value must be a finite number";
  return sizeProblem(value);
}

/** The R12 message for a feature, for `lint` and the builder. */
export const R12_ONLY = {
  linetypes: R12_LINETYPES,
  lineweights: R12_LINEWEIGHTS,
  layerStates: R12_LAYER_STATES,
  entityStyle: R12_ENTITY_STYLE,
  text: R12_TEXT,
  blocks: R12_BLOCKS,
  xrefs: R12_XREFS,
  layouts: R12_LAYOUTS,
  dimensions: R12_DIMENSIONS,
  leaders: R12_LEADERS,
  polylines: R12_POLYLINES,
  paragraphs: R12_PARAGRAPHS,
  images: R12_IMAGES,
  hatches: R12_HATCHES,
} as const;

/** What is wrong with a hatch with no loop. */
export const HATCH_NO_LOOPS = "a hatch needs at least one loop";

/** What is wrong with a loop of too few points. */
export const HATCH_LOOP_POINTS =
  "a loop needs at least 3 points, or 2 joined by an arc, so that it closes around an area";

/** What is wrong with a wipeout of too few points. */
export const WIPEOUT_POINTS = "a wipeout needs at least 3 points";

/** What is wrong with a wipeout whose polygon has no area as written. */
export const WIPEOUT_FLAT =
  "a wipeout's points must not lie on one line once rounded to the 6 decimals tsdraft writes: the leading CAD app hides nothing behind it";

/** What is wrong with a wipeout whose sides cross. */
export const WIPEOUT_CROSSES =
  "a wipeout's sides must not cross each other: the leading CAD app hides nothing behind one that does. Give its corners in order around it";

/** What is wrong with a value of `wipeoutFrame`. */
export const WIPEOUT_FRAME = "wipeoutFrame must be true or false";

/** What is wrong with a dimension style's mask. */
export const DIMENSION_TEXT_MASK =
  "textMask must be true, false, or { color }: a color index from 1 to 256, where 256 is the layer's";

/** Returns what is wrong with a dimension style's mask, or undefined. */
export function dimensionTextMaskProblem(value: unknown): string | undefined {
  if (typeof value === "boolean") return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return DIMENSION_TEXT_MASK;
  const m = value as Record<string, unknown>;
  for (const key of Object.keys(m)) if (key !== "color") return DIMENSION_TEXT_MASK;
  return Number.isInteger(m.color) && (m.color as number) >= 1 && (m.color as number) <= 256
    ? undefined
    : DIMENSION_TEXT_MASK;
}

/** What is wrong with a donut's hole, of `inside` across, or undefined. */
export function donutHoleProblem(inside: unknown): string | undefined {
  return notNegativeProblem(inside, DONUT_HOLE);
}

/**
 * What is wrong with the bulges and the widths of a polyline of `sides` sides, or undefined for
 * each that is sound. It takes `unknown`s so that `lint` can report a drawing built by hand. A
 * bulge and a width are judged as written: a width written as 0 is 0, and a bulge written as 0
 * is a straight side.
 */
export function polylineSidesProblems(
  sides: number,
  bulges: unknown,
  width: unknown,
  widths: unknown,
): string[] {
  const out: string[] = [];
  const counted = (list: readonly unknown[], what: string): boolean => {
    if (list.length === sides) return true;
    out.push(
      `its ${what} must have one for each side, ${sides}, and it has ${list.length}. A closed polyline has a side for each point, and an open one a side fewer`,
    );
    return false;
  };
  if (bulges !== undefined) {
    if (!Array.isArray(bulges)) out.push("its bulges must be an array of numbers");
    else if (counted(bulges, "bulges")) {
      for (let i = 0; i < bulges.length; i++) {
        const bulge: unknown = bulges[i];
        const problem =
          typeof bulge !== "number" || !Number.isFinite(bulge)
            ? "must be a finite number"
            : magnitudeProblem(bulge);
        if (!problem) continue;
        out.push(`its bulge ${i}: ${problem}`);
        break;
      }
    }
  }
  if (width !== undefined && widths !== undefined) {
    out.push("it has a width and widths for each side: give one or the other");
  }
  if (width !== undefined) {
    const problem = notNegativeProblem(width, POLYLINE_WIDTH);
    if (problem) out.push(`its width: ${problem}`);
  }
  if (widths !== undefined) {
    if (!Array.isArray(widths)) out.push("its widths must be an array of pairs of numbers");
    else if (counted(widths, "widths")) {
      for (let i = 0; i < widths.length; i++) {
        const pair: unknown = widths[i];
        const problem =
          !Array.isArray(pair) || pair.length !== 2
            ? "must be a pair of numbers, [start, end]"
            : (notNegativeProblem(pair[0], POLYLINE_WIDTH) ??
              notNegativeProblem(pair[1], POLYLINE_WIDTH));
        if (!problem) continue;
        out.push(`its widths ${i}: ${problem}`);
        break;
      }
    }
  }
  return out;
}

/** How a text is justified across its line, and up and down it. The first of each is the default. */
export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export const TEXT_VERTICAL_ALIGNS = ["baseline", "bottom", "middle", "top"] as const;

/**
 * Returns what is wrong with a text style name, or undefined when it is valid.
 * The name may be `Standard`.
 */
export function textStyleNameProblem(name: string): string | undefined {
  return nameProblem(name, TEXT_STYLE_NAMES);
}

/** True for `Standard`, the text style every drawing has, in any case. */
export function isStandardTextStyle(name: string): boolean {
  return layerKey(name) === layerKey(STANDARD_TEXT_STYLE);
}

/**
 * Returns what is wrong with a text style definition, or undefined when it is
 * valid. It takes `unknown`s so that `lint` can report a drawing built by hand
 * with a field of the wrong type.
 *
 * @param name - The style's name.
 * @param font - One of `FONTS`.
 * @param widthFactor - How wide each character is drawn, as a share of its own width.
 * @param obliqueAngle - The slant of each character, in degrees to the right.
 * @returns The problem, or undefined.
 */
export function textStyleProblem(
  name: unknown,
  font: unknown,
  widthFactor: unknown = 1,
  obliqueAngle: unknown = 0,
): string | undefined {
  if (typeof name !== "string") return "A text style's name must be a string";
  const nameError = textStyleNameProblem(name);
  if (nameError) return nameError;
  if (isStandardTextStyle(name)) return STANDARD_STYLE;
  return fontProblem(font) ?? widthFactorProblem(widthFactor) ?? obliqueAngleProblem(obliqueAngle);
}

/** Returns what is wrong with a font, or undefined when it is one of `FONTS`. Its type is `FontOf`. */
export function fontProblem(font: unknown): string | undefined {
  return typeof font === "string" && fontInfo(font) ? undefined : FONT;
}

/** Returns what is wrong with a width factor, or undefined. Its type is `WidthFactor`. */
export function widthFactorProblem(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "widthFactor must be a finite number";
  }
  // Judged as written, as every number is.
  return written(value) < 0.01 || written(value) > 100 ? WIDTH_FACTOR : undefined;
}

/** Returns what is wrong with an oblique angle, or undefined. Its type is `ObliqueAngle`. */
export function obliqueAngleProblem(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "obliqueAngle must be a finite number";
  }
  // Judged as written: 85.0000001 is written as 85.
  return Math.abs(written(value)) > 85 ? OBLIQUE : undefined;
}

/**
 * Returns what is wrong with a lineweight in millimetres, or undefined when it is one of
 * the leading CAD app's. Its type is `LineweightOf`.
 */
export function lineweightValueProblem(value: unknown): string | undefined {
  return typeof value === "number" && (LINEWEIGHTS as readonly number[]).includes(value)
    ? undefined
    : LINEWEIGHT;
}

/** Returns what is wrong with a scale ratio, or undefined. Its type is `Ratio`. */
export function ratioProblem(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "The ratio must be a finite number";
  }
  return value > 0 ? magnitudeProblem(value) : RATIO;
}

/**
 * Returns what is wrong with a text that names a text style the drawing does
 * not have. The rule depends on the drawing, so it has no type.
 */
export function undefinedTextStyleProblem(name: string): string {
  return `Text style ${JSON.stringify(name)} is not defined. The leading CAD app puts a text that names a style it does not have in Standard, and reports nothing`;
}

/**
 * Returns what is wrong with a text's `align` or `valign`, or undefined when it
 * is one of the values of that field.
 */
export function textAlignProblem(field: "align" | "valign", value: unknown): string | undefined {
  const values: readonly string[] = field === "align" ? TEXT_ALIGNS : TEXT_VERTICAL_ALIGNS;
  return values.includes(value as string)
    ? undefined
    : `${field} must be ${values
        .map((v) => JSON.stringify(v))
        .join(", ")
        .replace(/, ([^,]*)$/, " or $1")}`;
}

/** How a paragraph is justified across its box, and up and down it, and how its lines are spaced. The first of each is the default. */
export const PARAGRAPH_ALIGNS = ["left", "center", "right"] as const;
export const PARAGRAPH_VERTICAL_ALIGNS = ["top", "middle", "bottom"] as const;
export const LINE_SPACING_STYLES = ["at-least", "exactly"] as const;

/** The least and the most line spacing factor the leading CAD app takes. */
export const LINE_SPACING_RANGE = [0.25, 4] as const;

/** Returns what is wrong with a paragraph's `align`, `valign` or `lineSpacingStyle`, or undefined. */
export function paragraphChoiceProblem(
  field: "align" | "valign" | "lineSpacingStyle",
  value: unknown,
): string | undefined {
  const values: readonly string[] =
    field === "align"
      ? PARAGRAPH_ALIGNS
      : field === "valign"
        ? PARAGRAPH_VERTICAL_ALIGNS
        : LINE_SPACING_STYLES;
  return values.includes(value as string)
    ? undefined
    : `${field} must be ${values
        .map((v) => JSON.stringify(v))
        .join(", ")
        .replace(/, ([^,]*)$/, " or $1")}`;
}

/**
 * Returns what is wrong with a paragraph's line spacing factor, or undefined. The factor as given
 * is held to the range, as the type holds it, so none that passes rounds out of it when written.
 */
export function lineSpacingProblem(value: unknown): string | undefined {
  return typeof value === "number" &&
    value >= LINE_SPACING_RANGE[0] &&
    value <= LINE_SPACING_RANGE[1]
    ? undefined
    : LINE_SPACING;
}

/** The most columns a paragraph has, and the most heights it gives one by one. */
export const PARAGRAPH_COLUMNS_MOST = 1000;

/** The message for a paragraph's columns that are not as `ParagraphColumns` gives them. */
export const PARAGRAPH_COLUMNS =
  "A paragraph's columns are { height, count?, gutter? } or { heights, gutter? }, in drawing units: a height above 0 as written, a whole count from 1 to 1000, from 1 to 1000 heights above 0 as written, and a gutter of 0 or more";

/** The message for columns wider than a file holds. */
export const PARAGRAPH_COLUMNS_WIDE =
  "A paragraph's columns, their widths and gutters, are too wide to write: as many as the count gives, or 1000 of them without one";

/** The message for columns on a paragraph with no width. */
export const PARAGRAPH_COLUMNS_WIDTH =
  "A paragraph with columns needs a width, which each of its columns is as wide as";

/** The warning for a `\N` in a paragraph with no columns. */
export const PARAGRAPH_COLUMN_BREAK =
  "The paragraph code \\N starts the next column, and this paragraph has no columns: it breaks the line, as \\P does";

/** A number above 0 as the writers write it, and not too large to write. */
const writtenPositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && written(value) > 0 && !isTooLarge(value);

const COLUMN_FIELDS = new Set(["height", "heights", "count", "gutter"]);

/**
 * Returns what is wrong with a paragraph's columns apart from its width, or undefined. It reads a
 * list of heights by its items alone, and stops at the first field it does not know.
 */
export function paragraphColumnsShapeProblem(columns: unknown): string | undefined {
  if (typeof columns !== "object" || columns === null || Array.isArray(columns)) {
    return PARAGRAPH_COLUMNS;
  }
  for (const key in columns) if (!COLUMN_FIELDS.has(key)) return PARAGRAPH_COLUMNS;
  const { height, heights, count, gutter } = columns as Record<string, unknown>;
  if (
    gutter !== undefined &&
    !(
      typeof gutter === "number" &&
      Number.isFinite(gutter) &&
      written(gutter) >= 0 &&
      !isTooLarge(gutter)
    )
  ) {
    return PARAGRAPH_COLUMNS;
  }
  if (heights !== undefined) {
    if (height !== undefined || count !== undefined || !Array.isArray(heights)) {
      return PARAGRAPH_COLUMNS;
    }
    const list = heights as readonly unknown[];
    if (list.length < 1 || list.length > PARAGRAPH_COLUMNS_MOST) return PARAGRAPH_COLUMNS;
    for (let i = 0; i < list.length; i++) if (!writtenPositive(list[i])) return PARAGRAPH_COLUMNS;
    return undefined;
  }
  if (!writtenPositive(height)) return PARAGRAPH_COLUMNS;
  if (
    count !== undefined &&
    !(
      Number.isInteger(count) &&
      (count as number) >= 1 &&
      (count as number) <= PARAGRAPH_COLUMNS_MOST
    )
  ) {
    return PARAGRAPH_COLUMNS;
  }
  return undefined;
}

/**
 * Returns what is wrong with a paragraph's columns beside its width, or undefined: their shape,
 * no width, and columns too wide to write, as many as static ones give or as dynamic ones may
 * take, at the gutter given or the one of `height`.
 */
export function paragraphColumnsProblem(
  columns: unknown,
  width: unknown,
  height: unknown = 0,
): string | undefined {
  return (
    paragraphColumnsShapeProblem(columns) ?? paragraphColumnsSizeProblem(columns, width, height)
  );
}

/** What is wrong with columns of a sound shape beside the paragraph's width, or undefined. */
export function paragraphColumnsSizeProblem(
  columns: unknown,
  width: unknown,
  height: unknown,
): string | undefined {
  if (!positiveNumber(width)) return PARAGRAPH_COLUMNS_WIDTH;
  const c = columns as { readonly count?: number; readonly gutter?: number };
  const gutter =
    c.gutter ?? 5 * (typeof height === "number" && Number.isFinite(height) ? height : 0);
  const count = c.count ?? PARAGRAPH_COLUMNS_MOST;
  return isTooLarge(count * ((width as number) + gutter)) ? PARAGRAPH_COLUMNS_WIDE : undefined;
}

const positiveNumber = (value: unknown): boolean =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * Returns what is wrong with a paragraph's value in its style's font, or undefined: a code
 * tsdraft does not know or does not lay out, a brace that is never closed or never opened, a code
 * with no `;` to end it, a font that is not one of `FONTS`, italic, bold or `%%c` in an SHX font,
 * braces nested past `PARAGRAPH_NESTING`, a control character, and the characters a text cannot
 * hold.
 */
export function paragraphValueProblem(value: unknown, font: unknown): string | undefined {
  if (typeof value !== "string") return "A paragraph's value must be a string";
  return paragraphProblemIn(parseParagraph(value), font);
}

/**
 * What `paragraphValueProblem` gives for a value already read, in its style's font. A font that
 * is not one of `FONTS` has an error of its own, and is not checked here.
 */
export function paragraphProblemIn(
  parsed: Pick<ParsedParagraph, "problem" | "ownDiameter">,
  font: unknown,
): string | undefined {
  if (parsed.problem !== undefined) return parsed.problem;
  const shx = typeof font === "string" && fontInfo(font)?.file.endsWith(".shx") === true;
  return parsed.ownDiameter && shx ? PARAGRAPH_SHX_DIAMETER : undefined;
}

/** Returns what is wrong with a layer color, or undefined when it is valid. */
export function layerColorProblem(color: number): string | undefined {
  return Number.isInteger(color) && color >= 1 && color <= 255 ? undefined : COLOR;
}

/**
 * Returns what is wrong with a radius, a text height or a rectangle size, or
 * undefined when it is valid. A size that is written as 0 is refused like 0
 * itself: the leading CAD app gives text of height 0 the drawing's default text height,
 * and a circle of radius 0 is a point. A size of 1e100 or more is refused
 * too, as `magnitudeProblem` explains.
 *
 * @param value - The size, which must be a finite number.
 * @returns The problem, or undefined.
 */
export function sizeProblem(value: number): string | undefined {
  if (!(value > 0)) return POSITIVE;
  return written(value) === 0 ? WRITTEN_AS_ZERO : magnitudeProblem(value);
}

/**
 * Returns what is wrong with a paper length, the ratio it plots at, or the
 * length in drawing units they give, or undefined when the result can be
 * written. The result is a size, so it is held to the limits of `sizeProblem`.
 *
 * @param length - The length on paper, which must be a finite number.
 * @param ratio - The scale ratio, which must be a finite number.
 * @param result - The length in drawing units.
 * @returns The problem, or undefined.
 */
export function paperLengthProblem(
  length: number,
  ratio: number,
  result: number,
): string | undefined {
  if (!(length > 0)) return PAPER_LENGTH;
  if (!(ratio > 0)) return RATIO;
  if (written(result) === 0) {
    return `The result, ${result} drawing units, is written as 0, because tsdraft writes 6 decimals. Use a longer paper length or a larger ratio`;
  }
  if (isTooLarge(result)) {
    return "The result is 1e100 drawing units or more, and the leading CAD app reads only two exponent digits from DXF. Use a shorter paper length or a smaller ratio";
  }
  return undefined;
}

/**
 * Returns what is wrong with the size of a number a drawing holds, or
 * undefined when the leading CAD app can read it. This goes for every number that is
 * written: coordinates, sizes and text rotation. Only sizes can be checked as
 * literals, through `Positive`, because points and rotations have no literal
 * types.
 *
 * @param value - The number, which must be finite.
 * @returns The problem, or undefined.
 */
export function magnitudeProblem(value: number): string | undefined {
  return isTooLarge(value) ? TOO_LARGE : undefined;
}

/**
 * Returns what is wrong with an arc's angles once they are rounded for
 * writing, or undefined when the arc can be written. The leading CAD app holds an arc
 * whose start and end angles are equal as an arc of no length, so an arc that
 * is all but a full circle would vanish. The compiler cannot subtract two
 * literals, so this rule has no type.
 *
 * @param startAngle - The start angle in degrees, from 0 up to 360.
 * @param endAngle - The end angle in degrees, from 0 up to 360.
 * @returns The problem, or undefined.
 */
export function arcProblem(startAngle: number, endAngle: number): string | undefined {
  return roundsToOneAngle(startAngle, endAngle) && !isShortArc(startAngle, endAngle)
    ? ARC_LOST
    : undefined;
}

/**
 * True for an arc so short that its angles are the same once rounded, which
 * is written as an arc of no length. That is within rounding of what was
 * drawn, so it is worth a warning and not an error.
 *
 * @param startAngle - The start angle in degrees, from 0 up to 360.
 * @param endAngle - The end angle in degrees, from 0 up to 360.
 * @returns Whether the arc is written with no length.
 */
export function arcIsWrittenAsPoint(startAngle: number, endAngle: number): boolean {
  return roundsToOneAngle(startAngle, endAngle) && isShortArc(startAngle, endAngle);
}

/**
 * Returns what is wrong with an entity id, or undefined when it is valid. It takes `unknown` so
 * that `lint` can report a drawing built by hand with an id of the wrong type.
 */
export function idProblem(id: unknown): string | undefined {
  if (typeof id !== "string") return "An id must be a string";
  if (id.length === 0) return ID_EMPTY;
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return ID_CHARS;
  return id.length > 64 ? ID_LENGTH : undefined;
}

/**
 * The form two ids are compared in: `Door-1` and `door-1` are one id. `idHandle` hashes what
 * this returns, so it must never change.
 */
export function idKey(id: string): string {
  return id.toLowerCase();
}

/**
 * Returns what is wrong with a second entity that has an id the drawing already has. The rule
 * depends on the drawing, so it has no type.
 *
 * @param id - The id of the second entity.
 * @param first - The id as the first entity spells it.
 */
export function duplicateIdProblem(id: string, first: string): string {
  const spelled = first === id ? "" : `, as ${JSON.stringify(first)}`;
  return `The id ${JSON.stringify(id)} is already used${spelled}. An id names one entity, and ids are compared without regard to case`;
}

/**
 * Returns what is wrong with an entity whose id gives the handle another id already gave.
 * `idHandle` in `handles.ts` works a handle out from each id, and the leading CAD app discards a
 * drawing in which two objects have one handle. The rule depends on the drawing, so it has no type.
 *
 * @param id - The id of the second entity.
 * @param first - The id that gave the handle first.
 * @param handle - The handle both ids give.
 */
export function idHandleProblem(id: string, first: string, handle: string): string {
  return `The ids ${JSON.stringify(first)} and ${JSON.stringify(id)} give the same handle, ${handle}. An entity's handle comes from its id, and the leading CAD app discards a drawing in which two objects have one handle. Change this id`;
}

/**
 * Returns what is wrong with an object whose key gives the handle another key already gave.
 * A block's own objects take their handles from its name, an attribute definition from its
 * block and tag, and the attributes of an insert that has an id from the id and the tag, as
 * an entity takes its handle from its id. The leading CAD app discards a drawing in which two
 * objects have one handle. The rule depends on the drawing, so it has no type.
 *
 * @param what - What the second object is, such as `the block "TREE"`.
 * @param first - What the first object is.
 * @param handle - The handle both give.
 */
export function handleProblem(what: string, first: string, handle: string): string {
  return `${what} and ${first} give the same handle, ${handle}. The leading CAD app discards a drawing in which two objects have one handle. Rename one of them`;
}

/**
 * Returns what is wrong with a block name, or undefined when it is valid. The leading CAD app
 * discards a drawing over a block name that breaks the rules of layer names.
 */
export function blockNameProblem(name: unknown): string | undefined {
  if (typeof name !== "string") return "A block's name must be a string";
  const problem = nameProblem(name, BLOCK_NAMES);
  if (problem) return problem;
  // The leading CAD app draws an arrowhead with whatever block has its name.
  return ARROWHEAD_BLOCKS.some((block) => layerKey(block) === layerKey(name))
    ? ARROWHEAD_BLOCK
    : undefined;
}

/**
 * Returns what is wrong with a drawing that has both names as blocks, or undefined when the two
 * can stand together. The leading CAD app takes two block names for one where it would call two
 * layer names duplicates: `TREE` and `tree`, `straße` and `strasse`, a composed é and a decomposed
 * one. It then keeps one block, puts the entities of both in it, and reports nothing.
 * `layerAuditKey` lists the kinds of pair this covers. The rule compares two names, so it has
 * no type.
 *
 * @param name - The name of the block being checked.
 * @param other - The name of another block in the drawing.
 */
export function blockTwinProblem(name: string, other: string): string | undefined {
  if (layerAuditKey(name) !== layerAuditKey(other)) return undefined;
  const spelled = name === other ? "" : `, as ${JSON.stringify(other)}`;
  return `The drawing already has a block of this name${spelled}. The leading CAD app takes the two for one block, puts the entities of both in it and reports nothing`;
}

/**
 * Returns what is wrong with an xref whose name the leading CAD app takes for the name of a block
 * or of another xref of the drawing, as `blockTwinProblem` says of two blocks. An xref is a block
 * to that app, and the two share their names.
 *
 * @param name - The name being checked: an xref's, or a block's when `kind` is `"xref"`.
 * @param other - The name the drawing already has.
 * @param kind - What has that name already.
 */
export function xrefTwinProblem(name: string, other: string, kind: "block" | "xref"): string {
  const spelled = name === other ? "" : `, as ${JSON.stringify(other)}`;
  return `The drawing already has ${kind === "xref" ? "an xref" : "a block"} of this name${spelled}. An xref is a block to the leading CAD app, which takes the two names for one: it discards a drawing with two such names that differ in case, and makes one xref of any other two and reports nothing`;
}

/**
 * Returns what is wrong with an xref's path, or undefined when it is valid. It takes `unknown`
 * so that `lint` can report a drawing built by hand with a path of the wrong type.
 */
export function xrefPathProblem(path: unknown): string | undefined {
  if (typeof path !== "string") return "An xref's path must be a string";
  if (path.length === 0) return XREF_PATH_EMPTY;
  if (/^(?:[/\\]|[A-Za-z]:)/.test(path)) return XREF_PATH_ABSOLUTE;
  if (/[*?<>|:"]/.test(path)) return XREF_PATH_CHARS;
  if (/\.dxf$/i.test(path)) return XREF_PATH_DXF;
  if (/\.$/.test(path) && !/\.dwg\.$/i.test(path)) return XREF_PATH_DOT;
  if (path.length > 32000) return XREF_PATH_LENGTH;
  if (/\\[Mm]\+[1-5][0-9A-Fa-f]{4}/.test(path)) return XREF_PATH_MULTIBYTE;
  return textProblem(path);
}

/** Returns what is wrong with an image's path, or undefined when it is valid. */
export function imagePathProblem(path: unknown): string | undefined {
  if (typeof path !== "string") return "An image's path must be a string";
  if (path.length === 0) return IMAGE_PATH_EMPTY;
  if (/^(?:[/\\]|[A-Za-z]:)/.test(path)) return IMAGE_PATH_ABSOLUTE;
  if (/[*?<>|:"]/.test(path)) return IMAGE_PATH_CHARS;
  if (path.length > 32000) return IMAGE_PATH_LENGTH;
  if (/\\[Mm]\+[1-5][0-9A-Fa-f]{4}/.test(path)) return IMAGE_PATH_MULTIBYTE;
  return textProblem(path);
}

/** The most pixels an image's side may have: PNG's own most. */
export const IMAGE_SIDE = 2_147_483_647;

/** Returns what is wrong with an image's pixels, or undefined when they are valid. */
export function imagePixelsProblem(pixels: unknown): string | undefined {
  // A plain array of two, with no key but its indexes and its length.
  if (!Array.isArray(pixels) || pixels.length !== 2 || Reflect.ownKeys(pixels).length !== 3)
    return IMAGE_PIXELS;
  // Each side read as a plain value, without a getter or the array's iterator.
  const side = (i: number) => {
    const item = Object.getOwnPropertyDescriptor(pixels, i);
    const n: unknown = item && "value" in item ? item.value : undefined;
    return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= IMAGE_SIDE;
  };
  return side(0) && side(1) ? undefined : IMAGE_PIXELS;
}

/**
 * Returns what is wrong with an image's clip, or undefined when it is valid. It is judged in the
 * image's own axes, the vectors of one of its pixels `u` and `v`, from its corner `at`, with its
 * points as written.
 */
export function imageClipProblem(
  clip: unknown,
  at: readonly [number, number],
  u: readonly [number, number],
  v: readonly [number, number],
): string | undefined {
  if (!Array.isArray(clip) || clip.length < 2) return IMAGE_CLIP_POINTS;
  if (Reflect.ownKeys(clip).length !== clip.length + 1) {
    return "An image's clip must be a plain array of points, with no key but its indexes";
  }
  const written2: (readonly [number, number])[] = [];
  // Read by index as plain values, so an empty slot or a getter is a point that is missing.
  const item = (list: unknown[], i: number): unknown => {
    const found = Object.getOwnPropertyDescriptor(list, i);
    return found && "value" in found ? found.value : undefined;
  };
  for (let i = 0; i < clip.length; i++) {
    const point = item(clip, i);
    const [x, y]: unknown[] =
      Array.isArray(point) && point.length === 2 && Reflect.ownKeys(point).length === 3
        ? [item(point, 0), item(point, 1)]
        : [];
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return "Each point of an image's clip must be a point, [x, y], of finite numbers";
    }
    const problem = magnitudeProblem(x) ?? magnitudeProblem(y);
    if (problem) return problem;
    written2.push([written(x), written(y)]);
  }
  if (written2.length === 2) {
    const det = u[0] * v[1] - u[1] * v[0];
    const along = ([x, y]: readonly [number, number]) => {
      const [dx, dy] = [x - at[0], y - at[1]];
      return [(dx * v[1] - dy * v[0]) / det, (u[0] * dy - u[1] * dx) / det] as const;
    };
    const [a, b] = [along(written2[0]!), along(written2[1]!)];
    // Apart by a millionth of a pixel at least, which the 15 digits a clip is written with keep.
    const apart = (p: number, q: number) =>
      Math.abs(p - q) > 1e-6 * Math.max(1, Math.abs(p), Math.abs(q));
    return apart(a[0], b[0]) && apart(a[1], b[1]) ? undefined : IMAGE_CLIP_RECTANGLE;
  }
  const distinct = new Set(written2.map(([x, y]) => `${x},${y}`));
  return distinct.size >= 3 ? undefined : IMAGE_CLIP_POLYGON;
}

/** The most points an image's clip may have. */
export const IMAGE_CLIP_MOST = 10_000;

/** What is wrong with a clip of more points than `IMAGE_CLIP_MOST`. */
export const IMAGE_CLIP_MOST_PROBLEM = `An image's clip has at most ${IMAGE_CLIP_MOST} points`;

/** What is wrong with `invertClip` on an image with no clip. */
export const IMAGE_INVERT_WITHOUT_CLIP = IMAGE_INVERT_CLIP;

/** What is wrong with two images of one file that give it other pixels. */
export const IMAGE_PIXELS_SAME = IMAGE_PIXELS_DIFFER;

/** The fields of a block that an xref cannot have, since its file holds what it draws. */
export const XREF_REFUSED_FIELDS = ["entities", "base", "attributes"] as const;

/**
 * Returns what is wrong with an xref that has a field of a block. An xref draws what its file
 * holds: the entities, the base point and the attribute definitions are the file's.
 */
export function xrefFieldProblem(field: (typeof XREF_REFUSED_FIELDS)[number]): string {
  const what = {
    entities: "entities of its own. It draws what its file holds",
    base: "a base point. Its base point is the one its file has",
    attributes:
      "attribute definitions. A block of the drawing has them, and an xref draws what its file holds",
  }[field];
  return `An xref cannot have ${what}`;
}

/** What is wrong with an insert of an xref that sets attributes. */
export const XREF_ATTRIBUTES =
  "An insert of an xref cannot set attributes. An insert gives a value to an attribute its block defines, and an xref defines none in this drawing";

/**
 * The most drawings a chain of references is drawn through in a picture: the drawing given for
 * an xref, the drawing given for one of its attachments, and so on down.
 */
export const XREF_DEPTH = 16;

/** The most names the drawings given for xrefs are looked through for, in one picture. */
export const XREF_LOOKS = 4096;

/** What is wrong with `xrefs` given to `lint` that is no object. */
export const XREFS_GIVEN =
  "xrefs must be an object that gives, for an xref's name, a Drawing or { drawing, xrefs }";

/** The names of a chain of xrefs, each cut to the 255 characters a block's name may have. */
function chainOf(chain: readonly string[]): string {
  return chain
    .map((name) => JSON.stringify(name.length > 255 ? `${name.slice(0, 255)}…` : name))
    .join(" > ");
}

/**
 * Why the drawing given in `xrefs` for the last xref of a chain is not drawn, the chain running
 * from an xref of the drawing down through the attachments of the drawings given.
 */
export function xrefChainProblem(kind: XrefProblem["kind"], chain: readonly string[]): string {
  const at = `Xref ${chainOf(chain)}`;
  const last = chainOf(chain.slice(-1));
  const above = chainOf(chain.slice(-2, -1));
  switch (kind) {
    case "overlay":
      return `${at}: ${last} is an overlay of the drawing given for ${above}, and the leading CAD app draws no overlay of a referenced drawing, so the drawing given for it is not drawn`;
    case "cycle":
      return `${at}: a circular reference. The drawing given for ${last} is drawn above it on this chain already, and the leading CAD app breaks the circle there, so it is not drawn again`;
    case "deep":
      return `${at}: a chain of references is drawn ${XREF_DEPTH} drawings down and no further, so the drawing given for ${last} is not drawn`;
    case "many":
      return `The drawings given in xrefs name more than ${XREF_LOOKS} xrefs inside referenced drawings, past which tsdraft draws none of them: only the drawings given for this drawing's own xrefs are drawn`;
    case "shape":
      return `${at}: the value given for ${last} is neither a Drawing nor { drawing, xrefs }, so nothing is drawn for it`;
  }
}

/** The warning for an xref that no insert places. */
export const XREF_UNPLACED =
  "No insert places this xref. The leading CAD app purges an xref that nothing references when it opens the drawing";

/**
 * Returns what is wrong with an insert that names a block the drawing does not have. The rule
 * depends on the drawing, so it has no type.
 */
export function undefinedBlockProblem(name: string): string {
  return `Block ${JSON.stringify(name)} is not defined. The leading CAD app's AUDIT reports an insert of a block the drawing does not have, and that app cannot save the drawing as DXF`;
}

/**
 * Returns what is wrong with a block that holds an insert of itself, directly or through the
 * blocks it inserts. The rule depends on the drawing, so it has no type.
 *
 * @param path - The blocks from the one that holds the insert round to itself.
 */
export function blockCycleProblem(path: readonly string[]): string {
  const through =
    path.length > 2
      ? `, through ${path
          .slice(1, -1)
          .map((name) => JSON.stringify(name))
          .join(" and ")}`
      : "";
  return `Block ${JSON.stringify(path[0])} holds an insert of itself${through}. The leading CAD app's AUDIT reports such blocks as self referencing`;
}

/**
 * Returns what is wrong with one of an insert's scales, or undefined when it is valid.
 *
 * @param value - The scale along X or along Y.
 */
export function scaleProblem(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "A scale must be a finite number";
  }
  return written(value) === 0 ? SCALE_ZERO : magnitudeProblem(value);
}

/**
 * Returns what is wrong with an attribute's tag, or undefined when it is valid. It takes
 * `unknown` so that `lint` can report a drawing built by hand with a tag of the wrong type.
 */
export function attributeTagProblem(tag: unknown): string | undefined {
  if (typeof tag !== "string") return "An attribute's tag must be a string";
  if (tag.length === 0) return TAG_EMPTY;
  if (/[a-z]/.test(tag)) return TAG_LOWER;
  return textProblem(tag);
}

/**
 * Returns what is wrong with the text an insert makes of an attribute definition, or
 * undefined when the leading CAD app takes it. An insert that scales its block unevenly widens or
 * narrows each attribute and slants it, and that app's AUDIT reports an attribute slanted by more
 * than 85 degrees as it reports a text, and one whose width factor is 750000. The width factor is
 * held to the range of a text style's, and the attribute's point to the size of any point. The rule depends on the insert and its
 * block, so it has no type.
 *
 * @param tag - The attribute's tag.
 * @param placed - The attribute as `placeAttribute` gives it.
 * @param quoted - The tag as JSON, for a caller that checks one tag for many inserts. It is
 *   read only for a problem.
 */
export function placedAttributeProblem(
  tag: string,
  placed: {
    readonly at: readonly [number, number];
    readonly height: number;
    readonly widthFactor: number;
    readonly obliqueAngle: number;
  },
  quoted?: string,
): string | undefined {
  const name = (): string => quoted ?? JSON.stringify(tag);
  const about = (): string => `its scale makes the attribute ${name()}`;
  if (!placed.at.every(Number.isFinite)) return `it puts the attribute ${name()} at no point`;
  const far = magnitudeProblem(placed.at[0]) ?? magnitudeProblem(placed.at[1]);
  if (far) return `it puts the attribute ${name()} at ${placed.at.join(", ")}. ${far}`;
  if (![placed.height, placed.widthFactor, placed.obliqueAngle].every(Number.isFinite)) {
    return `${about()} a text of no size`;
  }
  const height = sizeProblem(placed.height);
  if (height) return `${about()} ${placed.height} high. ${height}`;
  if (Math.abs(written(placed.obliqueAngle)) > 85) {
    return `${about()} slant by ${written(placed.obliqueAngle)} degrees. ${OBLIQUE}. Scale the insert more evenly`;
  }
  if (written(placed.widthFactor) < 0.01 || written(placed.widthFactor) > 100) {
    return `${about()} ${written(placed.widthFactor)} times as wide as its font draws it. ${WIDTH_FACTOR}, and an attribute with one of 750000. Scale the insert more evenly`;
  }
  return undefined;
}

/**
 * Returns what is wrong with a second attribute definition of a block that has the tag of an
 * earlier one. An insert sets an attribute by its tag, and the tag gives the definition its
 * handle, so two definitions of one tag would have one handle, and the leading CAD app discards a
 * drawing in which two objects have one handle. The rule depends on the block, so it has no type.
 */
export function duplicateAttributeProblem(tag: string): string {
  return `The block already has an attribute with the tag ${JSON.stringify(tag)}. An insert sets an attribute by its tag, and the tag gives the definition its handle: the leading CAD app discards a drawing in which two objects have one handle`;
}

/** What an insert's `attributes` must be. */
export const ATTRIBUTES_SHAPE = "attributes must be an object of values by tag";

/**
 * Returns what is wrong with an insert that sets an attribute its block does not define. An
 * attribute's place, height and style come from its definition, so there is nothing to write
 * the value with. The rule depends on the drawing, so it has no type.
 */
export function undefinedAttributeProblem(tag: string, block: string): string {
  return `Block ${JSON.stringify(block)} has no attribute with the tag ${JSON.stringify(tag)}. An attribute's place, height and style come from its definition, so this value would not be written`;
}

/** Returns what is wrong with a drawing's format version, or undefined when tsdraft reads it. */
export function formatProblem(format: unknown): string | undefined {
  // Negative zero is refused: it would be written as -0, and so change the drawing's JSON.
  if (Object.is(format, 0)) return undefined;
  return format === undefined
    ? "The drawing has no format version. A Drawing has format: 0"
    : `Unknown Drawing format ${shown(format)}. This version of tsdraft reads format 0`;
}

/** A value of any type for a message: a string quoted, a number as it is, anything else by kind. */
export function shown(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return String(value);
  }
  return Array.isArray(value) ? "an array" : `a value of type ${typeof value}`;
}

/** Returns what is wrong with a single-line text value, or undefined when it is valid. */
export function textProblem(value: string): string | undefined {
  if (hasControl(value)) return TEXT_CONTROL;
  if (hasAstral(value)) {
    return "Text cannot contain emoji or other characters above U+FFFF, because the leading CAD app cannot read them from DXF";
  }
  if (/[\ue800-\ue8ff]/.test(value)) return TEXT_PRIVATE_USE;
  return undefined;
}

/**
 * Returns a warning for text that the leading CAD app stores as written but draws
 * differently, or undefined when it draws what it stores.
 *
 * @param value - The text value.
 * @returns The warning, or undefined.
 */
export function textWarning(value: string): string | undefined {
  return value.includes("%%") ? TEXT_PERCENT : undefined;
}

function roundsToOneAngle(startAngle: number, endAngle: number): boolean {
  return writtenAngle(startAngle) === writtenAngle(endAngle);
}

/** True when the counterclockwise sweep from start to end is half a turn or less. */
function isShortArc(startAngle: number, endAngle: number): boolean {
  return (((endAngle - startAngle) % 360) + 360) % 360 <= 180;
}

function codePoint(character: string): string {
  return `U+${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
}

function hasControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** True when the string has a character above U+FFFF, which JavaScript stores as a surrogate pair. */
function hasAstral(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdfff) return true;
  }
  return false;
}

/**
 * Returns what is wrong with a layout's name, or undefined when it is valid. It takes `unknown`
 * so that `lint` can report a drawing built by hand with a name of the wrong type.
 */
export function layoutNameProblem(name: unknown): string | undefined {
  if (typeof name !== "string") return "A layout's name must be a string";
  if (name.length === 0) return LAYOUT_NAME_EMPTY;
  if (layoutNameKey(name) === "model") return LAYOUT_NAME_MODEL;
  if (/[<>/\\":;?*|,=`]/.test(name)) return LAYOUT_NAME_CHARS;
  if (name.startsWith(" ") || name.endsWith(" ")) return LAYOUT_NAME_EDGE;
  if (name.length > 255) return LAYOUT_NAME_LENGTH;
  return textProblem(name);
}

/**
 * Returns what is wrong with a drawing that has two layouts of these names, or undefined when
 * the two can stand together. The leading CAD app takes two layout names for one when they differ
 * only in the case of letters it folds, which `layoutNameKey` holds: `Sheet` and `SHEET`, `É1` and
 * `é1`. It then keeps one of the two layouts under the name, and its AUDIT reports the other as
 * missing from the dictionary of layouts. The rule compares two names, so it has no type.
 *
 * @param name - The name of the layout being checked.
 * @param other - The name of another layout of the drawing.
 */
export function layoutTwinProblem(name: string, other: string): string | undefined {
  if (layoutNameKey(name) !== layoutNameKey(other)) return undefined;
  const spelled = name === other ? "" : `, as ${JSON.stringify(other)}`;
  return `The drawing already has a layout of this name${spelled}. The leading CAD app takes the two for one layout, keeps one, and its AUDIT reports the other as missing from the dictionary of layouts`;
}

/**
 * Returns what is wrong with a sheet number, which names a sheet's file, or undefined when a file
 * of Windows can have it as its name: `<number>.dwg`.
 */
export function sheetNumberProblem(number: unknown): string | undefined {
  if (typeof number !== "string") return "A sheet number is a string";
  if (number.length < 1 || number.length > 64) return SHEET_NUMBER_LENGTH;
  for (let i = 0; i < number.length; i++) {
    const code = number.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || (code >= 0xd800 && code <= 0xdfff)) {
      return SHEET_NUMBER_CHARS;
    }
  }
  if (/[<>:"/\\|?*]/.test(number)) return SHEET_NUMBER_CHARS;
  if (/[ .]$/.test(number)) return SHEET_NUMBER_END;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(number)) return SHEET_NUMBER_DEVICE;
  return undefined;
}

/**
 * Returns what is wrong with a layout's paper, or undefined when it is one of `PAPERS`. It
 * takes `unknown` so that `lint` can report a drawing built by hand.
 */
export function paperProblem(paper: unknown): string | undefined {
  return typeof paper === "string" && paperInfo(paper) !== undefined ? undefined : PAPER;
}

/**
 * Returns what is wrong with a layout's plot style table, or undefined when it is one of
 * `PLOT_STYLE_TABLES`. It takes `unknown` so that `lint` can report a drawing built by hand.
 * The type of the option is the list itself, so the rule needs no type of its own.
 */
export function plotStyleProblem(table: unknown): string | undefined {
  return PLOT_STYLE_TABLES.includes(table as PlotStyleTable) ? undefined : PLOT_STYLE;
}

/** What a viewport must be, for a drawing built without the builder. */
export const VIEWPORT_SHAPE =
  "a viewport must be an object with a layer, a corner, a width, a height, a center and a ratio";

const FROZEN_LAYERS = "its frozenLayers must be a list of the names of layers";

/** The cosine and sine of a twist in degrees, exactly 1 and 0 for no twist. */
export function turning(twist: number): readonly [cos: number, sin: number] {
  if (twist === 0) return [1, 0];
  const turn = (twist * Math.PI) / 180;
  return [Math.cos(turn), Math.sin(turn)];
}

/**
 * The middle of a viewport's view as a file holds it, in the view's own coordinates: the
 * center turned by the twist about the origin, each number as written.
 *
 * @param twist - The twist in degrees, as written.
 */
export function twistedCenter(center: Point, twist: number): Point {
  const [x, y] = [written(center[0]), written(center[1])];
  if (twist === 0) return [x, y];
  const [cos, sin] = turning(twist);
  return [written(x * cos - y * sin), written(x * sin + y * cos)];
}

/**
 * The problem with a layer a viewport freezes that the drawing does not have. A file holds each
 * frozen layer as a pointer to the drawing's own layer, so a name with no layer cannot be written.
 */
export function frozenLayerAbsent(name: string): string {
  return `it freezes layer ${shown(name)}, which is not defined. Define the layer before the viewport that freezes it`;
}

/**
 * Returns what is wrong with a viewport, or undefined when it can be written: its corner and
 * its center are points, its width and its height are sizes, and its ratio is greater than 0
 * and gives a view the leading CAD app can hold. A file holds the height of model space the
 * viewport shows, in drawing units, where a scale would be, so that height is held to the rules of
 * any size: it is not written as 0 and is under 1e100. A twist is under a turn either way, and the
 * frozen layers a list of names, which `lint` holds to the drawing's layers. It takes
 * `unknown` so that `lint` can report a drawing built by hand. The ratio has the type `Ratio`.
 *
 * @param viewport - The viewport, with or without its layer and id, which are not judged.
 * @param paperUnits - The units of the paper of the viewport's layout.
 * @param units - The drawing's units.
 */
export function viewportProblem(
  viewport: unknown,
  paperUnits: PaperUnit,
  units: Units,
): string | undefined {
  if (typeof viewport !== "object" || viewport === null || Array.isArray(viewport)) {
    return VIEWPORT_SHAPE;
  }
  if (!isPaperUnit(paperUnits)) return `The paper unit must be "in" or "mm"`;
  if (!isUnits(units)) return `Unknown units: ${JSON.stringify(units)}`;
  const { corner, width, height, center, ratio, frozenLayers, twist } = viewport as Record<
    string,
    unknown
  >;
  if (twist !== undefined) {
    // The DXF holds degrees and the DWG radians, which part past a turn.
    if (typeof twist !== "number" || !(Math.abs(twist) < 360)) {
      return "its twist must be a number of degrees more than -360 and less than 360";
    }
  }
  if (frozenLayers !== undefined) {
    const names = Array.isArray(frozenLayers) ? (frozenLayers as unknown[]) : undefined;
    // Each slot is read by its index, so an empty one is a name that is not a string.
    for (let i = 0; names && i < names.length; i++) {
      if (typeof names[i] !== "string") return FROZEN_LAYERS;
    }
    if (!names) return FROZEN_LAYERS;
  }
  for (const [label, point] of [
    ["corner", corner],
    ["center", center],
  ] as const) {
    // Each of the two is read by its index: `every` passes over an empty slot.
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      !Number.isFinite(point[0]) ||
      !Number.isFinite(point[1])
    ) {
      return `its ${label} must be a point of finite numbers, [x, y]`;
    }
    const far = magnitudeProblem(point[0] as number) ?? magnitudeProblem(point[1] as number);
    if (far) return `its ${label}: ${far}`;
  }
  const turned = twistedCenter(center as Point, written((twist as number | undefined) ?? 0));
  const far = magnitudeProblem(turned[0]) ?? magnitudeProblem(turned[1]);
  if (far) return `its center, turned by its twist as a file holds it: ${far}`;
  for (const [label, size] of [
    ["width", width],
    ["height", height],
  ] as const) {
    if (typeof size !== "number" || !Number.isFinite(size)) {
      return `${label} must be a finite number`;
    }
    const problem = sizeProblem(size);
    if (problem) return `${label}: ${problem}`;
  }
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) {
    return "The ratio must be a finite number";
  }
  if (!(ratio > 0)) return RATIO;
  const viewHeight = modelLength(written(height as number), paperUnits, ratio, units);
  if (!Number.isFinite(viewHeight) || isTooLarge(viewHeight)) {
    return `At the ratio ${ratio} the viewport shows 1e100 drawing units or more, and the leading CAD app reads only two exponent digits from DXF. Use a smaller ratio`;
  }
  if (written(viewHeight) === 0) {
    return `At the ratio ${ratio} the viewport shows ${viewHeight} drawing units up and down, which is written as 0, because tsdraft writes 6 decimals. Use a larger ratio`;
  }
  return undefined;
}

/**
 * The warning for a viewport whose rectangle reaches past its layout's paper. The leading CAD app
 * plots a layout as far as its paper goes.
 *
 * @returns The warning, or undefined when the rectangle is on the paper.
 */
export function viewportOffPaperWarning(
  rectangle: readonly [minX: number, minY: number, maxX: number, maxY: number],
  paper: { readonly width: number; readonly height: number },
): string | undefined {
  const [minX, minY, maxX, maxY] = rectangle;
  return minX < 0 || minY < 0 || maxX > paper.width || maxY > paper.height
    ? `the viewport reaches from ${minX}, ${minY} to ${maxX}, ${maxY}, past the paper, which is ${paper.width} by ${paper.height}. The leading CAD app plots a layout as far as its paper goes`
    : undefined;
}

/**
 * The warning for a viewport that frames a part of model space where nothing is drawn. A turned
 * view is named by its rectangle, its size in drawing units about its center, and its twist.
 */
export function viewportEmptyWarning(
  box: readonly [minX: number, minY: number, maxX: number, maxY: number],
  turned?: {
    readonly width: number;
    readonly height: number;
    readonly center: Point;
    readonly twist: number;
  },
): string {
  if (turned && turned.twist !== 0) {
    const { width, height, center, twist } = turned;
    return `the viewport shows none of the drawing: nothing in model space reaches into the rectangle it shows, ${written(width)} by ${written(height)} about ${written(center[0])}, ${written(center[1])}, turned ${twist} degrees`;
  }
  return `the viewport shows none of the drawing: nothing in model space lies in the box it shows, from ${written(box[0])}, ${written(box[1])} to ${written(box[2])}, ${written(box[3])}`;
}

/**
 * Returns what is wrong with the name a dimension names its style by, or undefined when it is
 * valid. `Standard` is a valid name, of a style tsdraft draws no dimension in.
 */
export function dimensionStyleNameProblem(name: unknown): string | undefined {
  if (typeof name !== "string") return "A dimension style's name must be a string";
  return nameProblem(name, DIMENSION_STYLE_NAMES);
}

/** True for `Standard`, the dimension style every drawing has, in any case. */
export function isStandardDimensionStyle(name: string): boolean {
  return layerKey(name) === layerKey(STANDARD_DIMENSION_STYLE);
}

/**
 * Returns what is wrong with a size of a dimension style that may be 0, or undefined when it is
 * valid: the arrow size, and how far an extension line starts from its point and runs past the
 * dimension line.
 */
export function notNegativeProblem(
  value: unknown,
  message: string = NOT_NEGATIVE,
): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return "must be a finite number";
  // Judged as written: a size that is written as 0 is 0.
  return written(value) < 0 ? message : magnitudeProblem(value);
}

/** Returns what is wrong with the gap of a dimension's text, or undefined. Its type is `TextGap`. */
export function textGapProblem(value: unknown): string | undefined {
  return notNegativeProblem(value, TEXT_GAP);
}

/** Returns what is wrong with one of a dimension style's two scales, or undefined. */
function styleScaleProblem(value: unknown, message: string): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return "must be a finite number";
  return value > 0 ? sizeProblem(value) : message;
}

/** Returns what is wrong with a measurement scale, or undefined. Its type is `MeasurementScale`. */
export function measurementScaleProblem(value: unknown): string | undefined {
  return styleScaleProblem(value, MEASUREMENT_SCALE);
}

/** Returns what is wrong with an arrowhead, or undefined when it is one of `ARROWHEADS`. */
export function arrowheadProblem(value: unknown): string | undefined {
  return arrowheadInfo(value) ? undefined : ARROWHEAD;
}

/** Returns what is wrong with a precision, or undefined. Its type is `Precision`. */
export function precisionProblem(value: unknown): string | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_PRECISION
    ? undefined
    : PRECISION;
}

/** Returns what is wrong with a `suppressZeros`, or undefined. */
export function zeroSuppressionProblem(value: unknown): string | undefined {
  return (ZERO_SUPPRESSIONS as readonly unknown[]).includes(value) ? undefined : ZERO_SUPPRESSION;
}

/** Returns what is wrong with a dimension style's `units`, or undefined. */
export function dimensionUnitsProblem(value: unknown): string | undefined {
  return (DIMENSION_UNITS as readonly unknown[]).includes(value)
    ? undefined
    : DIMENSION_UNITS_MESSAGE;
}

/** Returns what is wrong with a `feetInchZeros`, or undefined. */
export function feetInchZerosProblem(value: unknown): string | undefined {
  return (FEET_INCH_ZEROS as readonly unknown[]).includes(value)
    ? undefined
    : FEET_INCH_ZEROS_MESSAGE;
}

/**
 * Returns what is wrong with the zeros a style leaves out, for its units, or undefined:
 * `suppressZeros` is for decimal units and `feetInchZeros` for architectural ones.
 */
export function zerosOfUnitsProblem(
  units: unknown,
  suppressZeros: unknown,
  feetInchZeros: unknown,
): string | undefined {
  const architectural = units === "architectural";
  return (architectural ? suppressZeros : feetInchZeros) === undefined ? undefined : ZEROS_OF_UNITS;
}

/**
 * Returns what is wrong with a prefix, a suffix or a dimension's own text as a string the leading
 * CAD app draws as it is, or undefined: it is a text, with none of the characters that app reads as
 * formatting. Its type, for a suffix, is `DimensionAffix`.
 */
export function plainDimensionText(value: unknown): string | undefined {
  if (typeof value !== "string") return "must be a string";
  return textProblem(value) ?? (/[\\{}]/.test(value) ? DIMENSION_FORMATTING : undefined);
}

/** Returns what is wrong with a dimension style's prefix, or undefined. Its type is `DimensionPrefix`. */
export function dimensionPrefixProblem(value: unknown): string | undefined {
  if (typeof value === "string" && value.includes("<>")) return PREFIX_MEASUREMENT;
  return plainDimensionText(value);
}

/**
 * Returns what is wrong with a dimension style, or undefined when it is valid. It takes a value
 * of any shape, so that `lint` can report a drawing built by hand. Whether the drawing has the
 * style's text style is the caller's to check, since it depends on the drawing.
 *
 * The leading CAD app's AUDIT reports a style whose text height is 0 or less, whose arrow size or
 * either extension line length is less than 0, whose scale is less than 0, whose measurement scale
 * is 0, or whose precision is not a whole number from 0 to 8. It draws a box around the text for a
 * gap less than 0, works a scale of 0 out from a viewport, and applies a measurement scale
 * less than 0 on a layout alone.
 */
export function dimensionStyleProblem(style: unknown): string | undefined {
  if (typeof style !== "object" || style === null || Array.isArray(style)) {
    return "A dimension style must be an object with a name and its sizes";
  }
  const s = style as Record<string, unknown>;
  const nameError = dimensionStyleNameProblem(s.name);
  if (nameError) return nameError;
  if (isStandardDimensionStyle(s.name as string)) return STANDARD_DIMENSION_STYLE_DEFINED;
  if (s.textStyle !== undefined) {
    if (typeof s.textStyle !== "string") return "textStyle: a text style is named by a string";
    const problem = textStyleNameProblem(s.textStyle);
    if (problem) return `textStyle: ${problem}`;
  }
  if (typeof s.textHeight !== "number" || !Number.isFinite(s.textHeight)) {
    return "textHeight must be a finite number";
  }
  const height = sizeProblem(s.textHeight);
  if (height) return `textHeight: ${height}`;
  if (s.arrowhead !== undefined && arrowheadProblem(s.arrowhead)) return ARROWHEAD;
  for (const field of ["arrowSize", "extensionOffset", "extensionBeyond"] as const) {
    const problem = notNegativeProblem(s[field]);
    if (problem) return `${field}: ${problem}`;
  }
  const gap = textGapProblem(s.textGap);
  if (gap) return `textGap: ${gap}`;
  if (s.scale !== undefined) {
    const problem = styleScaleProblem(s.scale, DIMENSION_SCALE);
    if (problem) return `scale: ${problem}`;
  }
  // A picture draws each size times the scale.
  const scale = s.scale === undefined ? 1 : written(s.scale as number);
  for (const field of [
    "textHeight",
    "arrowSize",
    "extensionOffset",
    "extensionBeyond",
    "textGap",
  ] as const) {
    const scaled = written(s[field] as number) * scale;
    if (!(Math.abs(scaled) < 1e100)) {
      return `${field}: times the scale it is ${scaled}, and the leading CAD app reads only two exponent digits from DXF, so every size of a picture must be under 1e100. Use a smaller size or scale`;
    }
  }
  // The picture writes the text's height and an arrowhead's size with 6 decimals.
  for (const field of ["textHeight", "arrowSize"] as const) {
    const size = written(s[field] as number);
    if (size > 0 && written(size * scale) === 0) {
      return `${field}: times the scale it is ${size * scale}, which is written as 0 with the 6 decimals tsdraft writes, so the picture of a dimension would draw ${field === "textHeight" ? "its text" : "its arrowheads"} with no size. Use a larger size or scale${field === "arrowSize" ? ", or an arrow size of 0" : ""}`;
    }
  }
  const precision = precisionProblem(s.precision);
  if (precision) return precision;
  for (const field of ["prefix", "suffix"] as const) {
    if (s[field] === undefined) continue;
    const problem = plainDimensionText(s[field]);
    if (problem) return `${field}: ${problem}`;
  }
  if (typeof s.prefix === "string" && s.prefix.includes("<>")) return PREFIX_MEASUREMENT;
  if (s.units !== undefined) {
    const problem = dimensionUnitsProblem(s.units);
    if (problem) return problem;
  }
  if (s.suppressZeros !== undefined) {
    const problem = zeroSuppressionProblem(s.suppressZeros);
    if (problem) return problem;
  }
  if (s.feetInchZeros !== undefined) {
    const problem = feetInchZerosProblem(s.feetInchZeros);
    if (problem) return problem;
  }
  const zeros = zerosOfUnitsProblem(s.units, s.suppressZeros, s.feetInchZeros);
  if (zeros) return zeros;
  if (s.measurementScale !== undefined) {
    const problem = measurementScaleProblem(s.measurementScale);
    if (problem) return `measurementScale: ${problem}`;
  }
  return dimensionStyleLookProblem(s);
}

/** Returns what is wrong with a dimension style's `fraction`, or undefined. */
export function fractionProblem(value: unknown): string | undefined {
  return (DIMENSION_FRACTIONS as readonly unknown[]).includes(value)
    ? undefined
    : DIMENSION_FRACTION_MESSAGE;
}

/** Returns what is wrong with a dimension style's `fractionScale`, or undefined. */
export function fractionScaleProblem(value: unknown): string | undefined {
  return typeof value === "number" && written(value) >= 0.25 && written(value) <= 1
    ? undefined
    : FRACTION_SCALE_MESSAGE;
}

/** Returns what is wrong with a dimension style's `textPlacement`, or undefined. */
export function textPlacementProblem(value: unknown): string | undefined {
  return (DIMENSION_TEXT_PLACEMENTS as readonly unknown[]).includes(value)
    ? undefined
    : TEXT_PLACEMENT_MESSAGE;
}

/** Returns what is wrong with a dimension style's `textFit`, or undefined. */
export function textFitProblem(value: unknown): string | undefined {
  return (DIMENSION_TEXT_FITS as readonly unknown[]).includes(value) ? undefined : TEXT_FIT_MESSAGE;
}

/** Returns what is wrong with a dimension style's `radialText`, or undefined. */
export function radialTextProblem(value: unknown): string | undefined {
  return (DIMENSION_RADIAL_TEXTS as readonly unknown[]).includes(value)
    ? undefined
    : RADIAL_TEXT_MESSAGE;
}

/** Returns what is wrong with a dimension style's `angleUnits`, or undefined. */
export function angleUnitsProblem(value: unknown): string | undefined {
  return (DIMENSION_ANGLE_UNITS as readonly unknown[]).includes(value)
    ? undefined
    : ANGLE_UNITS_MESSAGE;
}

/** Returns what is wrong with a dimension style's `anglePrecision`, or undefined. */
export function anglePrecisionProblem(value: unknown): string | undefined {
  return Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= MAX_ANGLE_PRECISION
    ? undefined
    : ANGLE_PRECISION_MESSAGE;
}

/** Returns what is wrong with a dimension style's `suppressAngleZeros`, or undefined. */
export function angleZerosProblem(value: unknown): string | undefined {
  return (ZERO_SUPPRESSIONS as readonly unknown[]).includes(value)
    ? undefined
    : ANGLE_ZEROS_MESSAGE;
}

/** Returns what is wrong with a dimension style's `jogAngle`, or undefined. */
export function jogAngleProblem(value: unknown): string | undefined {
  return typeof value === "number" &&
    written(value) >= JOG_ANGLE.least &&
    written(value) <= JOG_ANGLE.most
    ? undefined
    : JOG_ANGLE_MESSAGE;
}

/**
 * Returns what is wrong with what a dimension style sets of how its dimensions look, or undefined:
 * its fraction and the fraction's height, where its text goes and its lineweights.
 */
export function dimensionStyleLookProblem(s: Record<string, unknown>): string | undefined {
  if (s.fraction !== undefined) {
    const problem = fractionProblem(s.fraction);
    if (problem) return problem;
  }
  if (s.fractionScale !== undefined) {
    const problem = fractionScaleProblem(s.fractionScale);
    if (problem) return problem;
  }
  // A fraction on the line, at the text's own height, is what every style writes.
  const stacked = s.fraction !== undefined && s.fraction !== "inline";
  const scaled = s.fractionScale !== undefined && written(s.fractionScale as number) !== 1;
  if ((stacked || scaled) && s.units !== "architectural") return FRACTION_OF_UNITS;
  if (scaled && !stacked) return FRACTION_SCALE_INLINE;
  if (s.textPlacement !== undefined) {
    const problem = textPlacementProblem(s.textPlacement);
    if (problem) return problem;
  }
  if (s.textFit !== undefined) {
    const problem = textFitProblem(s.textFit);
    if (problem) return problem;
  }
  if (
    s.textFit === "leader" &&
    s.textPlacement === "centered" &&
    (s.arrowhead ?? DEFAULT_ARROWHEAD) === "closed-filled"
  )
    return LEADER_CENTERED_ARROWS;
  if (s.radialText !== undefined) {
    const problem = radialTextProblem(s.radialText);
    if (problem) return problem;
  }
  if (s.jogAngle !== undefined) {
    const problem = jogAngleProblem(s.jogAngle);
    if (problem) return problem;
  }
  for (const [field, problemOf] of [
    ["angleUnits", angleUnitsProblem],
    ["anglePrecision", anglePrecisionProblem],
    ["suppressAngleZeros", angleZerosProblem],
  ] as const) {
    const problem = s[field] === undefined ? undefined : problemOf(s[field]);
    if (problem) return problem;
  }
  if (s.textMask !== undefined) {
    const problem = dimensionTextMaskProblem(s.textMask);
    if (problem) return problem;
  }
  for (const field of ["dimensionLineweight", "extensionLineweight"] as const) {
    const value = s[field];
    if (value === undefined) continue;
    if (typeof value === "number" && (LINEWEIGHTS as readonly number[]).includes(value)) continue;
    return `${field}: ${LINEWEIGHT}`;
  }
  return undefined;
}

/**
 * Returns the warning for a prefix or a suffix the leading CAD app stores as written and draws
 * differently, as `textWarning` gives one for a text, or undefined.
 */
export function dimensionStyleWarning(style: {
  readonly prefix?: unknown;
  readonly suffix?: unknown;
}): string | undefined {
  for (const field of ["prefix", "suffix"] as const) {
    const value = style[field];
    const warning = typeof value === "string" ? textWarning(value) : undefined;
    if (warning) return `${field}: ${warning}`;
  }
  return undefined;
}

/**
 * Returns what is wrong with a drawing that has two dimension styles of these names, or
 * undefined when the two can stand together. The leading CAD app keeps the first of two names that
 * differ only in case and skips the second, and its AUDIT reports two names it takes for one in the
 * other ways `layerAuditKey` lists, such as `strasse` and `straße`. The rule compares two
 * names, so it has no type.
 */
export function dimensionStyleTwinProblem(name: string, other: string): string | undefined {
  if (layerAuditKey(name) !== layerAuditKey(other)) return undefined;
  if (layerKey(name) === layerKey(other)) {
    return "The drawing already has a dimension style of this name. CAD ignores case in dimension style names and keeps the first";
  }
  return `The drawing already has a dimension style of this name, as ${JSON.stringify(other)}. The leading CAD app's AUDIT reports a duplicate name in the dimension style table`;
}

/**
 * Returns what is wrong with a dimension style whose text style the drawing does not have. The
 * rule depends on the drawing, so it has no type.
 */
export function undefinedDimensionTextStyleProblem(name: string): string {
  return `Text style ${JSON.stringify(name)} is not defined. A dimension style holds its text style by its handle, and the leading CAD app's AUDIT reports one that leads to no style`;
}

/**
 * Returns what is wrong with a dimension that names a dimension style the drawing does not
 * define. The rule depends on the drawing, so it has no type.
 */
export function undefinedDimensionStyleProblem(name: string): string {
  return isStandardDimensionStyle(name)
    ? STANDARD_DIMENSION_STYLE_USED
    : `Dimension style ${JSON.stringify(name)} is not defined. The leading CAD app discards a drawing with a dimension in a style it does not have`;
}

/** Returns what is wrong with a dimension's own text, or undefined when the leading CAD app draws it as it is. */
export function dimensionTextProblem(text: unknown): string | undefined {
  if (typeof text !== "string") return "its text must be a string";
  if (text.trim() === "" && !/[^ ]/.test(text)) return DIMENSION_TEXT_BLANK;
  const problem = plainDimensionText(text);
  if (problem) return problem;
  return text.includes("<>") && text.includes("[]") ? DIMENSION_TEXT_ALTERNATE : undefined;
}

/** What is wrong with words below a dimension's line whose text moves out on a leader. */
export const DIMENSION_LEADER_BELOW =
  "its text does not fit between its extension lines and moves out on a leader, and where words below the line then go is not laid out yet, so tsdraft refuses it. Give it more room, or leave textBelow out";
/** What is wrong with a text that moves out on a leader beside arrowheads larger than it. */
export const DIMENSION_LEADER_ARROWS =
  "its style moves a text that does not fit out on a leader, and its arrowheads are twice as long as its text is high or longer, where the leading CAD app may keep the text and move the arrowheads instead, which is not laid out yet, so tsdraft refuses it. Use a smaller arrow size";
/** What is wrong with a text centered in a dimension line it is wider than. */
export const DIMENSION_CENTERED_WIDE =
  "its text, centered in its line, needs more room than the line has between its extension lines, and where the line's pieces then go is not laid out yet, so tsdraft refuses it. Give it more room, a smaller text, or the text above the line";
/** What is wrong with a style whose closed arrowheads may turn outward round a text it moves out. */
const LEADER_CENTERED_ARROWS =
  'textFit "leader" with closed filled arrowheads and the text "centered" turns the arrowheads outward where tsdraft does not know the room they need, which is not laid out yet, so tsdraft refuses it. Use a tick, or the text "above"';

/** What is wrong with a radius or a diameter dimension in a style with a prefix. */
export const RADIAL_PREFIX =
  "its style has a prefix, which the leading CAD app may put in place of the R or the diameter sign it writes before a radius or a diameter, and which is not laid out yet, so tsdraft refuses it. Use a style without a prefix, or put the words in text";
/** What is wrong with a placed text in a style that levels a radial dimension's text. */
export const RADIAL_PLACED_LEVEL =
  'its text is placed along its line in a style with radialText "horizontal", and where the leading CAD app levels a placed text is not laid out yet, so tsdraft refuses it. Leave textFromCenter out, or use a style with radialText "aligned"';
/** What is wrong with a radial dimension whose text is centered where that is not laid out. */
export const RADIAL_CENTERED =
  'its style centers its text in its line, and where the leading CAD app breaks the line of a jogged radius dimension, or of one whose text is placed, is not laid out yet, so tsdraft refuses it. Use a style with the text "above"';
/** What is wrong with a jogged radius dimension whose last stretch is shorter than its text. */
export const RADIAL_JOG_SHORT =
  "its jog leaves the stretch from the jog to the arc shorter than its text and a gap each side, and where the leading CAD app then puts the text is not laid out yet, so tsdraft refuses it. Move the jog toward the center";
/** What is wrong with a radius or a diameter dimension that measures nothing. */
export const RADIAL_NO_RADIUS =
  "its point is its center once they are written with the 6 decimals tsdraft writes, so it has no radius";

/** An angular dimension with a line of no length. */
export const ANGULAR_NO_SIDE =
  "its vertex is one of its two points once they are written with the 6 decimals tsdraft writes, so that line has no direction";

/** An angular dimension whose arc has no radius. */
export const ANGULAR_NO_ARC =
  "its arc's point is its vertex once they are written with the 6 decimals tsdraft writes, so the arc has no radius";

/** An angular dimension whose arc passes through one of its points. */
export const ANGULAR_ARC_ON_POINT =
  "its arc passes through one of its two points, where the leading CAD app runs that point's extension line toward the vertex or away from it by a rounding, which is not laid out yet, so tsdraft refuses it. Move the arc's point nearer the vertex or further from it";

/** An angular dimension whose arc, or a piece of it, is all but a whole turn. */
export const ANGULAR_ARC_LOST =
  "its arc, or a piece of it, runs all but a whole turn, so its two angles are one once they are written with the 6 decimals tsdraft writes, and the leading CAD app draws such an arc as nothing";

/** An angular dimension whose closed arrowheads are longer than its arc is wide. */
export const ANGULAR_ARROWS_LONG =
  "its closed arrowheads are as long as its arc is wide or longer, which is not laid out yet, so tsdraft refuses it. Move the arc's point further from the vertex, or use a smaller arrow size";

/** An angular dimension whose arc's point lies on one of its lines. */
export const ANGULAR_ARC_ON_LINE =
  "its arc's point is on one of its two lines, where the leading CAD app takes the angle between them or the rest of the turn by a rounding, which is not laid out yet, so tsdraft refuses it. Move the arc's point into the angle it measures";

/** An angular dimension whose centered text leaves its arc no room each side. */
export const ANGULAR_CENTERED_SHORT =
  'its arc is too short for its text "centered" in it and its arrowheads, where the leading CAD app may turn the arrowheads outward, which is not laid out yet, so tsdraft refuses it. Move the arc\'s point further from the vertex, or put the text "above"';

/** An angular dimension whose text would move out on a leader. */
export const ANGULAR_TEXT_OUT =
  'its arc is too short for its text, which the style\'s textFit "leader" moves outside, and that is not laid out yet, so tsdraft refuses it. Move the arc\'s point further from the vertex, or use textFit "inside"';

/** An angular dimension with words below and its text centered in its arc. */
export const ANGULAR_CENTERED_BELOW =
  'its words below the arc with its text "centered" in the arc is not laid out yet, so tsdraft refuses it';

/** An angular dimension whose two lines run one way. */
export const ANGULAR_NO_ANGLE =
  "its two lines run the same way once their points are written with the 6 decimals tsdraft writes, so there is no angle between them";

/** What is wrong with a dimension in a block. */
export const DIMENSION_IN_BLOCK =
  "a dimension cannot be in a block. The leading CAD app draws nothing for a dimension inside a block when it opens the file, so an insert of the block would show nothing of it. Draw it in model space or on a layout";

/** The measurement from which the leading CAD app has too few digits for every decimal. */
const MEASUREMENT_LIMIT = 1e8;

/**
 * The most digits a measurement may be written with, before and after its point. The leading CAD
 * app writes 16, and works the 16th out from its own arithmetic on the points.
 */
const MEASUREMENT_DIGITS = 15;

/** How many digits a number from 1 up has before its point, and 0 for a smaller one. */
export function integerDigits(value: number): number {
  if (!(value >= 1) || !Number.isFinite(value)) return 0;
  let digits = Math.floor(Math.log10(value)) + 1;
  if (10 ** (digits - 1) > value) digits--;
  if (10 ** digits <= value) digits++;
  return digits;
}

/** The most degrees either way a linear dimension may measure along. */
const DIMENSION_TURN = 360;

/**
 * Returns what is wrong with the angle a linear dimension measures along, or undefined. It is
 * tsdraft's own rule: an angle beyond a turn either way is refused, so that every angle tsdraft
 * takes is turned into the same direction a turn less than it gives, with no loss.
 */
export function dimensionAngleProblem(angle: unknown): string | undefined {
  if (typeof angle !== "number" || !Number.isFinite(angle)) {
    return "The angle a dimension measures along must be a finite number of degrees";
  }
  return Math.abs(written(angle)) > DIMENSION_TURN
    ? `The angle a dimension measures along must be from -360 to 360 degrees, not ${written(angle)}. tsdraft takes no angle of more than a turn, so that one direction has one angle less than a turn. Give the same direction less a whole number of turns`
    : undefined;
}

/**
 * Returns what is wrong with a number of a dimension's picture, or undefined: every number a
 * writer works out for what a dimension draws must be under 1e100, as a coordinate must.
 */
export function pictureNumberProblem(value: number): string | undefined {
  return Number.isFinite(value) && Math.abs(value) < 1e100
    ? undefined
    : `what it draws reaches ${value}, and the leading CAD app reads only two exponent digits from DXF, so every number of a picture must be under 1e100. Use smaller points, sizes or a smaller scale`;
}

/**
 * Returns what is wrong with what a dimension measures, or undefined when the leading CAD app draws
 * it as tsdraft does. The rule depends on the dimension's points and its style, so it has no type.
 *
 * A dimension must measure something as it is written: that app draws one that measures nothing
 * with the text 0 and its arrowheads turned outward. What it writes, the measurement times the
 * style's measurement scale rounded to the style's precision, must be under 100,000,000:
 * that app writes 16 digits of a measurement, so it drops decimals of a larger one at a
 * precision of 8, and writes 1e16 as `1.0E+16`. It must have no more than 15 digits: that app
 * writes the 16th from its own arithmetic on the points, so it wrote 99,999,999.5 at a
 * precision of 8 as `99999999.50000002`. Both are judged on the number as it is rounded, since
 * 9,999,999.999999999 at a precision of 8 is written `10000000.00000000`. And one with closed
 * filled arrowheads must have room for them, as `room` says.
 *
 * @param measurement - What the dimension measures, in drawing units, as `dimensionMeasure`
 *   gives it.
 * @param scaled - The measurement times the style's measurement scale.
 * @param rounded - That rounded to the style's precision with every decimal, before any zero
 *   is left out, as `roundedMeasurement` gives it.
 * @param aligned - True for an aligned dimension.
 * @param text - The text that app draws for it.
 * @param room - The least it must measure for its arrowheads to stay between its extension
 *   lines, as `arrowRoom` gives it, or undefined when its picture does not depend on that.
 */
export function dimensionMeasureProblem(
  measurement: number,
  scaled: number,
  rounded: string,
  aligned: boolean,
  text: string,
  room: number | undefined,
): string | undefined {
  if (!Number.isFinite(measurement) || !Number.isFinite(scaled)) {
    return "it measures no finite length";
  }
  if (written(measurement) === 0) {
    return aligned
      ? "it has no length: its two points are one point once they are written with the 6 decimals tsdraft writes. The leading CAD app draws such a dimension with the text 0 and its arrowheads turned outward"
      : "it measures nothing: its two points are as far along the direction it measures, once they are written with the 6 decimals tsdraft writes. The leading CAD app draws such a dimension with the text 0 and its arrowheads turned outward";
  }
  const [whole = "", decimals = ""] = rounded.split(".");
  if (!(Number(whole) < MEASUREMENT_LIMIT)) {
    return `it reads ${rounded}, and the leading CAD app writes 16 digits of a measurement: from 100,000,000 up it drops decimals at a precision of 8, and it writes 1e16 as 1.0E+16. Use a smaller measurement scale`;
  }
  const digits = whole.replace(/^0+/, "").length + decimals.length;
  if (digits > MEASUREMENT_DIGITS) {
    return `it reads ${rounded}, which is ${digits} digits at a precision of ${decimals.length}. The leading CAD app works out the 16th digit of a measurement from its own arithmetic on the points, so it may end in another digit: it writes 99,999,999.5 at a precision of 8 as 99999999.50000002. Use a smaller precision or measurement scale`;
  }
  if (room !== undefined && measurement <= room) return arrowRoomProblem(measurement, text, room);
  return undefined;
}

/**
 * What is wrong with a dimension that measures no more than its closed filled arrowheads and its
 * text need, as `arrowRoom` gives the room.
 */
export function arrowRoomProblem(measurement: number, text: string, room: number): string {
  return `its text may not fit between its extension lines: it measures ${written(measurement)}, and its text, ${JSON.stringify(text)}, and its arrowheads may need ${written(room)}. The leading CAD app then turns closed filled arrowheads outward, by the width of the text in its font, which tsdraft does not hold. Give it more room, a smaller text or arrow size, or the arrowhead "architectural-tick", which is drawn the same either way`;
}

// Leaders.

const STANDARD_LEADER_STYLE_DEFINED =
  "The leader style \"Standard\" is the leading CAD app's own, which tsdraft writes beside a drawing's leader styles, and cannot be defined. That app keeps the first style of a name and skips a second";
const STANDARD_LEADER_STYLE_USED =
  'tsdraft draws no leader in the leader style "Standard", which is the leading CAD app\'s own. Define a style with leaderStyle() and name it';
const LEADER_ARROWHEAD =
  'A leader\'s arrowhead must be one of LEADER_ARROWHEADS: "closed-filled", "open", "dot" or "none"';
const LEADER_SIZE =
  "This value cannot be less than 0. A leader's arrow size, landing and gap are lengths, and 0 draws none";
const LEADER_SCALE = "The scale must be greater than 0. It multiplies every size of the style";
const LEADER_FORMATTING =
  "A leader's text cannot contain \\ { or }. The leading CAD app reads them as the formatting of the note";
const LEADER_TEXT_BLANK =
  "A leader's note needs a line that is not empty or all spaces. tsdraft draws no leader without a note";
const LEADER_TEXT_LINES =
  "A leader's text is a string, one line, or an array of the lines of its note from the top";
const LEADER_SHAFTS =
  "A leader needs a shaft: to is a point, the tip of its one shaft, or a list of shafts, each its tip or its tip and the points it bends at on its way to the landing";
export const LEADER_SHAFT_LENGTH =
  "The tip of a shaft and the point after it are one point once they are written with the 6 decimals tsdraft writes, which leaves the leading CAD app no direction to point the arrowhead in. Move the tip, or the point after it";
/**
 * Where a leader's landing meets the side of its note, in the order the leading CAD app numbers
 * them: the top of the first line, the middle of the first line, which is that app's own choice,
 * the middle of the note, the middle of the last line, the bottom of the last line, the bottom of
 * the last line with the landing drawn on under it, the bottom of the first line with the landing
 * under it, the bottom of the first line, and the bottom of the first line with every line
 * underlined.
 */
export const LEADER_ATTACHMENTS = [
  "top-of-first",
  "first-line",
  "middle",
  "last-line",
  "bottom-of-last",
  "underline-last",
  "underline-first",
  "bottom-of-first",
  "underline-all",
] as const;

/** Which side of the point where its shafts meet a leader's note is on. */
export const LEADER_SIDES = ["left", "right", "above", "below"] as const;

/** Whether a style's landings meet the side of its notes, or their top or bottom. */
export const LEADER_DIRECTIONS = ["horizontal", "vertical"] as const;

/**
 * Where a landing meets a note above or below it: at the middle of its bottom or top, or there
 * with a line as wide as the note.
 */
export const LEADER_VERTICAL_ATTACHMENTS = ["center", "line"] as const;

/** How a leader's shafts run through their points: straight, or as a curve. */
export const LEADER_SHAFT_KINDS = ["straight", "curved"] as const;

/** How a block in place of a leader's note meets its landing: by its extents or its insertion point. */
export const LEADER_BLOCK_CONNECTIONS = ["extents", "insertion"] as const;

const LEADER_ATTACHMENT = `attachment must be one of LEADER_ATTACHMENTS: ${LEADER_ATTACHMENTS.map((a) => JSON.stringify(a)).join(", ")}`;
const LEADER_SIDE = 'side must be "left", "right", "above" or "below"';
const LEADER_DIRECTION = 'direction must be "horizontal" or "vertical"';
const LEADER_VERTICAL_ATTACHMENT = 'verticalAttachment must be "center" or "line"';
const LEADER_SHAFT_KIND = 'shaft must be "straight" or "curved"';
const LEADER_FRAME = "frame must be true or false";
const LEADER_WIDTH =
  "width must be greater than 0. It is the width the note wraps at; leave it out for a note that does not wrap";
const TEXT_MASK =
  "mask must be true, false, or { color?, offsetFactor? }: a color index from 1 to 256, where 256 is the layer's, and a factor of the text height from 1 to 5";

/** What is wrong with a leader in a block. */
export const LEADER_IN_BLOCK =
  "a leader cannot be in a block. tsdraft writes a leader in model space or on a layout, where a drafter moves it as one. Draw it there";

/**
 * Resolves to `N` when it is a valid name for a leader style to be used by, and to the error
 * message otherwise. The leading CAD app holds leader style names to the rules of layer names.
 * `Standard` is no style tsdraft draws a leader in.
 */
export type LeaderStyleName<N extends string> = string extends N
  ? N
  : Lowercase<N> extends Lowercase<typeof STANDARD_LEADER_STYLE>
    ? typeof STANDARD_LEADER_STYLE_USED
    : NameCheck<N, typeof LEADER_STYLE_NAMES, N>;

/**
 * Resolves to `N` when it is a valid name for a new leader style, and to the error message
 * otherwise: a name that is valid to use, and not `Standard`, the leading CAD app's own.
 */
export type NewLeaderStyleName<N extends string> = string extends N
  ? N
  : Lowercase<N> extends Lowercase<typeof STANDARD_LEADER_STYLE>
    ? typeof STANDARD_LEADER_STYLE_DEFINED
    : NameCheck<N, typeof LEADER_STYLE_NAMES, N>;

/** Resolves to `A` when it is one of `LEADER_ARROWHEADS`, and to the error message otherwise. */
export type LeaderArrowheadOf<A extends string> = string extends A
  ? A
  : A extends LeaderArrowhead
    ? A
    : typeof LEADER_ARROWHEAD;

/** Resolves to `N` when it is an arrow size, a landing or a gap of a leader, and to the message otherwise. */
export type LeaderSize<N extends number> = NotNegative<N, typeof LEADER_SIZE>;

/** Resolves to `T` when it names a shaft, and to the error message for a list of none. */
export type LeaderTargetsOf<T> = T extends readonly never[] ? typeof LEADER_SHAFTS : T;

/** Resolves to `N` when it is the scale of a leader style, and to the error message otherwise. */
export type LeaderScale<N extends number> = StyleScale<N, typeof LEADER_SCALE>;

/** Resolves to `L` when it is a line a leader's note can have, and to the error message otherwise. */
type LeaderLine<L extends string> = string extends L
  ? L
  : L extends `${string}${"\\" | "{" | "}"}${string}`
    ? typeof LEADER_FORMATTING
    : Description<L>;

/**
 * Resolves to `T` when it is the text of a leader's note, one line or a list of lines, and to the
 * error message otherwise: no line holds `\`, `{` or `}`, or a character a text cannot hold, and
 * a note of literal lines has one that is not blank. `T` has no constraint, so that the compiler
 * infers a list of literal lines as one.
 */
export type LeaderText<T> = T extends readonly string[]
  ? number extends T["length"]
    ? T
    : [LinesProblem<T>] extends [never]
      ? AllBlank<T> extends true
        ? typeof LEADER_TEXT_BLANK
        : T
      : LinesProblem<T>
  : T extends string
    ? Blank<T> extends true
      ? typeof LEADER_TEXT_BLANK
      : LeaderLine<T>
    : typeof LEADER_TEXT_LINES;

/** The message for the first of a list of literal lines that a note cannot hold, or `never`. */
type LinesProblem<T extends readonly string[]> = T extends readonly [
  infer F extends string,
  ...infer R extends readonly string[],
]
  ? [LeaderLine<F>] extends [F]
    ? LinesProblem<R>
    : LeaderLine<F>
  : never;

/** True for a list of literal lines that are each empty or all spaces. */
type AllBlank<T extends readonly string[]> = T extends readonly [
  infer F extends string,
  ...infer R extends readonly string[],
]
  ? string extends F
    ? false
    : Blank<F> extends true
      ? AllBlank<R>
      : false
  : true;

/**
 * Returns what is wrong with the name a leader names its style by, or undefined when it is
 * valid. `Standard` is a valid name, of a style tsdraft draws no leader in.
 */
export function leaderStyleNameProblem(name: unknown): string | undefined {
  if (typeof name !== "string") return "A leader style's name must be a string";
  return nameProblem(name, LEADER_STYLE_NAMES);
}

/** True for `Standard`, the leading CAD app's own leader style, in any case. */
export function isStandardLeaderStyle(name: string): boolean {
  return layerKey(name) === layerKey(STANDARD_LEADER_STYLE);
}

/** Returns what is wrong with an arrowhead of a leader, or undefined when it is one of `LEADER_ARROWHEADS`. */
export function leaderArrowheadProblem(value: unknown): string | undefined {
  return leaderArrowheadInfo(value) ? undefined : LEADER_ARROWHEAD;
}

/** Returns what is wrong with an arrow size, a landing or a gap of a leader, or undefined. Its type is `LeaderSize`. */
export function leaderSizeProblem(value: unknown): string | undefined {
  return notNegativeProblem(value, LEADER_SIZE);
}

/** Returns what is wrong with a leader's attachment, or undefined. */
export function leaderAttachmentProblem(value: unknown): string | undefined {
  return (LEADER_ATTACHMENTS as readonly unknown[]).includes(value) ? undefined : LEADER_ATTACHMENT;
}

/** Returns what is wrong with a leader's side, or undefined. */
export function leaderSideProblem(value: unknown): string | undefined {
  return (LEADER_SIDES as readonly unknown[]).includes(value) ? undefined : LEADER_SIDE;
}

/** Returns what is wrong with a leader style's direction, or undefined. */
export function leaderDirectionProblem(value: unknown): string | undefined {
  return (LEADER_DIRECTIONS as readonly unknown[]).includes(value) ? undefined : LEADER_DIRECTION;
}

/** Returns what is wrong with a leader's vertical attachment, or undefined. */
export function leaderVerticalAttachmentProblem(value: unknown): string | undefined {
  return (LEADER_VERTICAL_ATTACHMENTS as readonly unknown[]).includes(value)
    ? undefined
    : LEADER_VERTICAL_ATTACHMENT;
}

/** Returns what is wrong with a leader's kind of shaft, or undefined. */
export function leaderShaftKindProblem(value: unknown): string | undefined {
  return (LEADER_SHAFT_KINDS as readonly unknown[]).includes(value) ? undefined : LEADER_SHAFT_KIND;
}

/** What is wrong with a mask on a paragraph in columns. */
export const PARAGRAPH_MASK_COLUMNS =
  "a paragraph in columns takes no mask yet: tsdraft would draw one mask across the columns and the gaps between them. Give the mask to a paragraph without columns";

/** Returns what is wrong with a mask behind a leader's note or a paragraph, or undefined. */
export function textMaskProblem(value: unknown): string | undefined {
  if (typeof value === "boolean") return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return TEXT_MASK;
  const m = value as Record<string, unknown>;
  for (const key of Object.keys(m)) if (key !== "color" && key !== "offsetFactor") return TEXT_MASK;
  if (
    m.color !== undefined &&
    !(Number.isInteger(m.color) && (m.color as number) >= 1 && (m.color as number) <= 256)
  ) {
    return TEXT_MASK;
  }
  if (
    m.offsetFactor !== undefined &&
    !(
      typeof m.offsetFactor === "number" &&
      written(m.offsetFactor) >= 1 &&
      written(m.offsetFactor) <= 5
    )
  ) {
    return TEXT_MASK;
  }
  return undefined;
}

/** The fields of a leader that only a note has, which a leader whose content is a block may not set. */
const NOTE_ONLY = [
  "text",
  "attachment",
  "verticalAttachment",
  "width",
  "frame",
  "mask",
  "textStyle",
  "textHeight",
] as const;

/**
 * Returns what is wrong with a leader whose content is a block, or undefined: it sets none of
 * what only a note has, and its attributes are strings by their tags.
 */
export function leaderBlockContentProblem(leader: object): string | undefined {
  const l = leader as Readonly<Record<string, unknown>>;
  for (const field of NOTE_ONLY) {
    if (l[field] !== undefined) {
      return `${field}: a leader whose content is a block has no note to give it to. Leave it out, or give the leader a note instead`;
    }
  }
  const set = l.attributes;
  if (set === undefined) return undefined;
  if (typeof set !== "object" || set === null || Array.isArray(set)) {
    return "attributes must be an object of values by their tags";
  }
  for (const value of Object.values(set)) {
    if (typeof value !== "string") return "each value of attributes must be a string";
    const problem = textProblem(value);
    if (problem) return `attributes: ${problem}`;
  }
  return undefined;
}

/** Returns what is wrong with a leader's width, or undefined: a finite length greater than 0. */
export function leaderWidthProblem(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value) && written(value) > 0
    ? magnitudeProblem(value)
    : LEADER_WIDTH;
}

/**
 * Returns what is wrong with sizes a leader is drawn with, times the scale of its style, or
 * undefined: each must be under 1e100, and a text height or an arrow size above 0 must not be
 * written as 0.
 */
function leaderScaledProblem(
  sizes: Readonly<Record<string, unknown>>,
  scale: number,
): string | undefined {
  for (const field of ["textHeight", "arrowSize", "landing", "gap", "width"] as const) {
    if (sizes[field] === undefined) continue;
    const size = written(sizes[field] as number);
    const scaled = size * scale;
    if (!(Math.abs(scaled) < 1e100)) {
      return `${field}: times the scale it is ${scaled}, and the leading CAD app reads only two exponent digits from DXF, so every size of a leader must be under 1e100. Use a smaller size or scale`;
    }
    if (field !== "landing" && field !== "gap" && size > 0 && written(scaled) === 0) {
      return `${field}: times the scale it is ${scaled}, which is written as 0 with the 6 decimals tsdraft writes. Use a larger size or scale${field === "arrowSize" ? ", or an arrow size of 0" : ""}`;
    }
  }
  return undefined;
}

/**
 * Returns what is wrong with a leader style, or undefined when it is valid. It takes a value of
 * any shape, so that `lint` can report a drawing built by hand. Whether the drawing has the
 * style's text style is the caller's to check, since it depends on the drawing.
 */
export function leaderStyleProblem(style: unknown): string | undefined {
  if (typeof style !== "object" || style === null || Array.isArray(style)) {
    return "A leader style must be an object with a name and its sizes";
  }
  const s = style as Record<string, unknown>;
  const nameError = leaderStyleNameProblem(s.name);
  if (nameError) return nameError;
  if (isStandardLeaderStyle(s.name as string)) return STANDARD_LEADER_STYLE_DEFINED;
  if (s.textStyle !== undefined) {
    if (typeof s.textStyle !== "string") return "textStyle: a text style is named by a string";
    const problem = textStyleNameProblem(s.textStyle);
    if (problem) return `textStyle: ${problem}`;
  }
  if (typeof s.textHeight !== "number" || !Number.isFinite(s.textHeight)) {
    return "textHeight must be a finite number";
  }
  const height = sizeProblem(s.textHeight);
  if (height) return `textHeight: ${height}`;
  if (s.arrowhead !== undefined && leaderArrowheadProblem(s.arrowhead)) return LEADER_ARROWHEAD;
  for (const field of ["arrowSize", "landing", "gap"] as const) {
    const problem = leaderSizeProblem(s[field]);
    if (problem) return `${field}: ${problem}`;
  }
  if (s.attachment !== undefined) {
    const problem = leaderAttachmentProblem(s.attachment);
    if (problem) return problem;
  }
  if (s.direction !== undefined) {
    const problem = leaderDirectionProblem(s.direction);
    if (problem) return problem;
  }
  if (s.verticalAttachment !== undefined) {
    const problem = leaderVerticalAttachmentProblem(s.verticalAttachment);
    if (problem) return problem;
  }
  if (s.frame !== undefined && typeof s.frame !== "boolean") return LEADER_FRAME;
  if (s.shaft !== undefined) {
    const problem = leaderShaftKindProblem(s.shaft);
    if (problem) return problem;
  }
  if (s.block !== undefined) {
    if (typeof s.block !== "string") return "block: a block is named by a string";
    const problem = blockNameProblem(s.block);
    if (problem) return `block: ${problem}`;
  }
  if (
    s.blockConnection !== undefined &&
    !(LEADER_BLOCK_CONNECTIONS as readonly unknown[]).includes(s.blockConnection)
  ) {
    return 'blockConnection must be "extents" or "insertion"';
  }
  if (s.blockScale !== undefined) {
    const problem = styleScaleProblem(s.blockScale, LEADER_SCALE);
    if (problem) return `blockScale: ${problem}`;
  }
  if (s.scale !== undefined) {
    const problem = styleScaleProblem(s.scale, LEADER_SCALE);
    if (problem) return `scale: ${problem}`;
  }
  return leaderScaledProblem(s, s.scale === undefined ? 1 : written(s.scale as number));
}

/**
 * Returns what is wrong with a drawing that has two leader styles of these names, or undefined
 * when the two can stand together, as `dimensionStyleTwinProblem` says of dimension styles.
 */
export function leaderStyleTwinProblem(name: string, other: string): string | undefined {
  if (layerAuditKey(name) !== layerAuditKey(other)) return undefined;
  if (layerKey(name) === layerKey(other)) {
    return "The drawing already has a leader style of this name. CAD ignores case in leader style names and keeps the first";
  }
  return `The drawing already has a leader style of this name, as ${JSON.stringify(other)}. tsdraft holds leader style names to the rules of dimension style names, which the leading CAD app's AUDIT takes for one name`;
}

/**
 * Returns what is wrong with a leader style or a leader whose text style the drawing does not
 * have. The rule depends on the drawing, so it has no type.
 */
export function undefinedLeaderTextStyleProblem(name: string): string {
  return `Text style ${JSON.stringify(name)} is not defined. A leader and its style hold their text style by its handle, which would lead to no style`;
}

/**
 * Returns what is wrong with a leader that names a leader style the drawing does not define.
 * The rule depends on the drawing, so it has no type.
 */
export function undefinedLeaderStyleProblem(name: string): string {
  return isStandardLeaderStyle(name)
    ? STANDARD_LEADER_STYLE_USED
    : `Leader style ${JSON.stringify(name)} is not defined. A leader holds its style by its handle, which would lead to no style`;
}

/**
 * Returns what is wrong with a line of a leader's note, or undefined when the leading CAD app draws
 * it as it is: a text, with none of the characters that app reads as formatting.
 */
export function leaderLineProblem(value: unknown): string | undefined {
  if (typeof value !== "string") return "each line of a leader's note must be a string";
  return textProblem(value) ?? (/[\\{}]/.test(value) ? LEADER_FORMATTING : undefined);
}

/**
 * Returns what is wrong with the lines of a leader's note, or undefined: a list of lines, each
 * as `leaderLineProblem` holds it, of which one is not blank.
 */
export function leaderTextProblem(text: unknown): string | undefined {
  if (!Array.isArray(text)) return LEADER_TEXT_LINES;
  for (const line of text as readonly unknown[]) {
    const problem = leaderLineProblem(line);
    if (problem) return problem;
  }
  return (text as readonly string[]).some((line) => /[^ ]/.test(line))
    ? undefined
    : LEADER_TEXT_BLANK;
}

/**
 * Returns what is wrong with a leader's shafts as data, or undefined: a list of at least one
 * shaft, each a list of finite points that starts with the tip, whose first segment has a length
 * as written. `at` is where every shaft ends.
 */
export function leaderShaftsProblem(
  shafts: unknown,
  at: readonly [number, number],
): string | undefined {
  if (!Array.isArray(shafts) || shafts.length === 0) return LEADER_SHAFTS;
  for (const shaft of shafts as readonly unknown[]) {
    if (!Array.isArray(shaft) || shaft.length === 0) return LEADER_SHAFTS;
    for (const point of shaft as readonly unknown[]) {
      const [x, y]: unknown[] = Array.isArray(point) ? point : [];
      if (
        !Array.isArray(point) ||
        point.length !== 2 ||
        typeof x !== "number" ||
        typeof y !== "number" ||
        !Number.isFinite(x) ||
        !Number.isFinite(y)
      ) {
        return "each point of a shaft must be [x, y], two finite numbers";
      }
      const far = magnitudeProblem(point[0] as number) ?? magnitudeProblem(point[1] as number);
      if (far) return `a point of a shaft: ${far}`;
    }
    const [tip, next = at] = shaft as readonly (readonly [number, number])[];
    if (written(tip![0]) === written(next[0]) && written(tip![1]) === written(next[1])) {
      return LEADER_SHAFT_LENGTH;
    }
  }
  return undefined;
}

/**
 * Returns what is wrong with a leader's own sizes, side and attachment, or undefined, with the
 * scale of its style. `textStyle` is checked by name: whether the drawing has it is the caller's
 * to check.
 */
export function leaderOwnProblem(given: object, scale: number): string | undefined {
  const leader = given as Readonly<Record<string, unknown>>;
  if (leader.side !== undefined) {
    const problem = leaderSideProblem(leader.side);
    if (problem) return problem;
  }
  if (leader.attachment !== undefined) {
    const problem = leaderAttachmentProblem(leader.attachment);
    if (problem) return problem;
  }
  if (leader.verticalAttachment !== undefined) {
    const problem = leaderVerticalAttachmentProblem(leader.verticalAttachment);
    if (problem) return problem;
  }
  if (leader.frame !== undefined && typeof leader.frame !== "boolean") return LEADER_FRAME;
  if (leader.shaft !== undefined) {
    const problem = leaderShaftKindProblem(leader.shaft);
    if (problem) return problem;
  }
  if (leader.mask !== undefined) {
    const problem = textMaskProblem(leader.mask);
    if (problem) return problem;
  }
  if (leader.width !== undefined) {
    const problem = leaderWidthProblem(leader.width);
    if (problem) return `width: ${problem}`;
  }
  if (leader.farShafts !== undefined) {
    // The far root's point comes from the note, so a shaft of one point is held to it once drawn.
    const problem = leaderShaftsProblem(leader.farShafts, [Number.NaN, Number.NaN]);
    if (problem) return `farShafts: ${problem}`;
  }
  if (leader.textStyle !== undefined) {
    if (typeof leader.textStyle !== "string") return "textStyle: a text style is named by a string";
    const problem = textStyleNameProblem(leader.textStyle);
    if (problem) return `textStyle: ${problem}`;
  }
  if (leader.textHeight !== undefined) {
    if (typeof leader.textHeight !== "number" || !Number.isFinite(leader.textHeight)) {
      return "textHeight must be a finite number";
    }
    const problem = sizeProblem(leader.textHeight);
    if (problem) return `textHeight: ${problem}`;
  }
  for (const field of ["arrowSize", "landing", "gap"] as const) {
    if (leader[field] === undefined) continue;
    const problem = leaderSizeProblem(leader[field]);
    if (problem) return `${field}: ${problem}`;
  }
  return leaderScaledProblem(leader, scale);
}
