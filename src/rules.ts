// The rules a drawing must follow for AutoCAD to open its DXF. Each rule exists
// twice: as a type, so a literal mistake is an error in the editor, and as a
// runtime check, for values the compiler can't see. The messages are shared.
//
// AutoCAD discards the whole drawing over most names that break the name rules.
import type { DxfVersion, Units } from "./drawing.ts";
import type { PaperUnit } from "./paper.ts";
import { paperInfo, PLOT_STYLE_TABLES, type Paper, type PlotStyleTable } from "./papers.ts";
import {
  arrowheadInfo,
  ARROWHEADS,
  MAX_PRECISION,
  STANDARD_DIMENSION_STYLE,
  ZERO_SUPPRESSIONS,
  type Arrowhead,
} from "./arrowheads.ts";
import { isPaperUnit, isUnits, modelLength } from "./units.ts";
import { isTooLarge, written, writtenAngle } from "./format.ts";
import { fontInfo, STANDARD_TEXT_STYLE, type Font } from "./fonts.ts";
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

// AutoCAD holds layer names, linetype names and text style names to the same rules, so each
// rule has a message for each kind of name.
const LAYER_NAMES = {
  empty: "Layer names cannot be empty",
  chars: 'Layer names cannot contain < > / \\ " : ; ? * | = ` ^ , or line breaks',
  rejected:
    "Layer names cannot contain a character AutoCAD rejects or replaces in names, such as a zero-width space or the ohm sign U+2126. docs/layer-names.md in the tsdraft repository lists them",
  edge: "Layer names cannot start or end with a space",
  length: "Layer names cannot be longer than 255 characters",
} as const;
const LINETYPE_NAMES = {
  empty: "Linetype names cannot be empty",
  chars: 'Linetype names cannot contain < > / \\ " : ; ? * | = ` ^ , or line breaks',
  rejected:
    "Linetype names cannot contain a character AutoCAD rejects or replaces in names, such as a zero-width space or the ohm sign U+2126. docs/layer-names.md in the tsdraft repository lists them",
  edge: "Linetype names cannot start or end with a space",
  length: "Linetype names cannot be longer than 255 characters",
} as const;
const TEXT_STYLE_NAMES = {
  empty: "Text style names cannot be empty",
  chars: 'Text style names cannot contain < > / \\ " : ; ? * | = ` ^ , or line breaks',
  rejected:
    "Text style names cannot contain a character AutoCAD rejects or replaces in names, such as a zero-width space or the ohm sign U+2126. docs/layer-names.md in the tsdraft repository lists them",
  edge: "Text style names cannot start or end with a space",
  length: "Text style names cannot be longer than 255 characters",
} as const;
const BLOCK_NAMES = {
  empty: "Block names cannot be empty",
  chars:
    'Block names cannot contain < > / \\ " : ; ? * | = ` ^ , or line breaks. AutoCAD keeps names that start with * for the blocks it makes itself, and its AUDIT reports any other block of such a name',
  rejected:
    "Block names cannot contain a character AutoCAD rejects or replaces in names, such as a zero-width space or the ohm sign U+2126. docs/layer-names.md in the tsdraft repository lists them",
  edge: "Block names cannot start or end with a space",
  length:
    "Block names cannot be longer than 255 characters. AutoCAD's BLOCK command refuses a longer name",
} as const;
const DIMENSION_STYLE_NAMES = {
  empty: "Dimension style names cannot be empty",
  chars: 'Dimension style names cannot contain < > / \\ " : ; ? * | = ` ^ , or line breaks',
  rejected:
    "Dimension style names cannot contain a character AutoCAD rejects or replaces in names, such as a zero-width space or the ohm sign U+2126. docs/layer-names.md in the tsdraft repository lists them",
  edge: "Dimension style names cannot start or end with a space",
  length:
    "Dimension style names cannot be longer than 255 characters. AutoCAD's DIMSTYLE command refuses a longer name",
} as const;
type NameMessages =
  | typeof LAYER_NAMES
  | typeof LINETYPE_NAMES
  | typeof TEXT_STYLE_NAMES
  | typeof BLOCK_NAMES
  | typeof DIMENSION_STYLE_NAMES;
const NAME_R12_CHARS =
  'R12 layer names can only use letters, digits, $, - and _. Use DXF version "R2018" for other characters';
const NAME_R12_LENGTH =
  'R12 layer names cannot be longer than 31 characters. Use DXF version "R2018" for longer names';
const COLOR = "A layer color must be an AutoCAD Color Index integer from 1 to 255";
const POSITIVE = "This value must be greater than 0";
const WRITTEN_AS_ZERO =
  "This value is written as 0, because tsdraft writes 6 decimals. Use 0.000001 or more";
const TOO_LARGE =
  "This value must be under 1e100, because AutoCAD reads only two exponent digits from DXF and would take 1e+100 for 1e+10";
const PAPER_LENGTH = "The paper length must be greater than 0";
const RATIO = "The ratio must be greater than 0";
const ARC_LOST =
  "An arc of nearly a full turn cannot be written: its angles are the same once rounded to 6 decimals, so AutoCAD would hold an arc of no length. Draw a circle instead";
const TEXT_CONTROL = "Text must be a single line with no control characters";
const TEXT_PRIVATE_USE =
  "Text cannot contain the private-use characters U+E800 to U+E8FF, because AutoCAD replaces them when it reads DXF";
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
const ARROWHEAD_BLOCK =
  "Block names cannot be _ArchTick, in any case of its letters. AutoCAD draws the architectural tick of a dimension with the block of that name";
const STANDARD_DIMENSION_STYLE_DEFINED =
  'The dimension style "Standard" is in every drawing and cannot be defined. AutoCAD keeps the first style of a name and skips a second';
const STANDARD_DIMENSION_STYLE_USED =
  'tsdraft draws no dimension in the dimension style "Standard", which is AutoCAD\'s own. Define a style with dimensionStyle() and name it';
const ARROWHEAD = 'An arrowhead must be one of ARROWHEADS: "closed-filled" or "architectural-tick"';
const NOT_NEGATIVE =
  "This value cannot be less than 0. AutoCAD's AUDIT reports a dimension style with a negative size";
const TEXT_GAP =
  "The gap cannot be less than 0. AutoCAD draws a box around the text of a dimension whose style has a negative gap";
const DIMENSION_SCALE =
  "The scale must be greater than 0. AutoCAD takes a scale of 0 for one it works out from a viewport, and its AUDIT reports a negative one";
const MEASUREMENT_SCALE =
  "The measurement scale must be greater than 0. AutoCAD's AUDIT reports a scale of 0, and AutoCAD applies a negative one only to a dimension on a layout";
const PRECISION =
  "A precision is a whole number of decimals from 0 to 8. AutoCAD's AUDIT reports a dimension style with any other";
const ZERO_SUPPRESSION = 'suppressZeros must be "leading", "trailing" or "both"';
const DIMENSION_FORMATTING =
  "The prefix, the suffix and the text of a dimension cannot contain \\ { or }. AutoCAD reads them as the formatting of the text";
const PREFIX_MEASUREMENT =
  "A prefix cannot contain <>, which AutoCAD takes for the place of the measurement";
const DIMENSION_TEXT_BLANK =
  "A dimension's text cannot be empty or all spaces. AutoCAD draws a dimension whose text is a space with no text. Leave the text out to draw the measurement";
const DIMENSION_TEXT_ALTERNATE =
  "A dimension's text cannot contain [] beside <>. AutoCAD writes the measurement a second time for it, in alternate units";
const LAYOUT_NAME_EMPTY =
  "A layout's name cannot be empty. AutoCAD's commands take an empty answer for the current layout, so none of them can name such a layout";
const LAYOUT_NAME_CHARS =
  "A layout's name cannot contain < > / \\ \" : ; ? * | , = or `. AutoCAD's LAYOUT command refuses a name with one of them, and AutoCAD opens a file that holds such a layout without a word";
const LAYOUT_NAME_EDGE =
  "A layout's name cannot start or end with a space. AutoCAD's -PLOT command finds no layout by such a name";
const LAYOUT_NAME_LENGTH =
  "A layout's name cannot be longer than 255 characters. AutoCAD's LAYOUT command refuses a longer name";
const LAYOUT_NAME_MODEL =
  "A layout cannot be named Model, in any case of its letters. AutoCAD keeps that name for the model tab: it discards a drawing whose layout is named MODEL, takes a layout named model for the model tab's own and loses its sheet, and never finishes opening a drawing with a second layout named Model";
const PAPER =
  'A paper must be one of PAPERS, the full-bleed landscape sizes of AutoCAD\'s DWG To PDF.pc3, such as "ARCH D". A page setup names its paper as the plotter does, and AutoCAD plots nothing for a layout whose paper the plotter knows neither by its name nor by its size';
const PLOT_STYLE =
  'A plot style table must be "monochrome.ctb" or "acad.ctb", which AutoCAD installs. AutoCAD plots a layout whose plot style table it does not have with no table, each pen in its own color';
const XREF_PATH_EMPTY =
  "An xref's path cannot be empty. AutoCAD then looks for a DWG file named as the xref is";
const XREF_PATH_DXF =
  "An xref's path cannot end in .dxf. AutoCAD loads only a DWG file as an xref: it reports that it is unable to load a DXF, and draws nothing for it";
const XREF_PATH_ABSOLUTE =
  'An xref\'s path must start from the folder of the drawing\'s file, as "base.dwg" and "../survey/base.dwg" do, and cannot start with /, \\ or a drive such as C:. AutoCAD takes an absolute path, and where that folder is missing, as on another machine, it loads a file of the same name from the drawing\'s folder when there is one and reports the xref as loaded';
const XREF_PATH_LENGTH =
  "An xref's path cannot be longer than 32,000 characters. AutoCAD finds no file by a path that comes to more than 32,767 characters with the folder of the drawing";
const XREF_PATH_CHARS =
  "An xref's path cannot hold * ? < > | : or \". AutoCAD finds no file whose name holds one of them. It does read a path wrapped in a pair of quotes as the path inside, and tsdraft wants that path written without them";
const XREF_PATH_DOT =
  "An xref's path cannot end in a dot. AutoCAD adds .dwg after the dot, so for base. it looks for base..dwg and finds no file";
const XREF_PATH_MULTIBYTE =
  "An xref's path cannot hold a backslash before M+, a digit from 1 to 5 and four hex digits, such as \\M+10041. Once AutoCAD has saved the drawing it reads those as one character, and looks for another file. Write / there";
const SCALE_ZERO =
  "A scale cannot be 0, or be written as 0, as tsdraft's 6 decimals write a scale under 0.0000005. AutoCAD reads a scale of 0 as 1";
const TAG_EMPTY =
  "An attribute's tag cannot be empty. AutoCAD's AUDIT reports an attribute with an empty tag";
const TAG_LOWER =
  "An attribute's tag cannot hold a lower-case letter a to z. AutoCAD's ATTDEF command holds a tag in capitals, and its -ATTEDIT command finds no attribute whose tag has a lower-case letter";
const R12_TEXT =
  'tsdraft writes no text styles and no text justification to R12 drawings. Use DXF version "R2018" for a text style or a justified text';
const STANDARD_STYLE =
  "The text style Standard is in every drawing, with the font txt.shx, and cannot be defined. AutoCAD keeps the first style of a name and skips a second";
const FONT =
  'A font must be one of FONTS, the fonts AutoCAD 2025 or Windows installs: an SHX font by its file name, such as "txt.shx", or a TrueType font by its typeface, such as "Arial". AutoCAD draws text in a font it does not have in another font, and its AUDIT reports nothing';
const OBLIQUE =
  "An oblique angle must be from -85 to 85 degrees. AutoCAD's AUDIT reports a text style or a text slanted further";
const WIDTH_FACTOR =
  "A width factor must be from 0.01 to 100, the range AutoCAD's STYLE command takes. AutoCAD's AUDIT reports a text style with a width factor of 0 or less, of 0.0001 or of 1000000";
const LINEWEIGHT =
  "A lineweight must be one of AutoCAD's, in millimetres: 0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2 or 2.11";
const LAYER_LINEWEIGHT = `${LINEWEIGHT}, or "Default"`;
const ENTITY_LINEWEIGHT = `${LINEWEIGHT}, or "ByLayer", "ByBlock" or "Default"`;
const FROZEN_CURRENT =
  'Layer "0" cannot be frozen: it is the current layer, and AutoCAD does not freeze the current layer';
const LAYER_LINETYPE =
  "A layer's linetype cannot be ByLayer or ByBlock. AutoCAD's AUDIT reports a layer with either";
const BUILT_IN =
  "Continuous, ByLayer and ByBlock are in every drawing and cannot be defined. AutoCAD keeps its own and drops the definition";
const PATTERN_COUNT =
  "A linetype pattern has 2 to 12 lengths, or none for a solid line. AutoCAD's AUDIT reports a pattern of one length, and AutoCAD discards a drawing with a pattern of more than 12";
const PATTERN_WRITTEN_AS_ZERO =
  "A dash or gap of this length is written as 0, because tsdraft writes 6 decimals, and would draw as a dot. Use 0 for a dot, or a length of 0.000001 or more";
const PATTERN_TOTAL =
  "A linetype pattern's lengths, added up without their signs, must be under 1e100. The total is written too, and AutoCAD reads only two exponent digits from DXF";
const PATTERN_TYPE = "A linetype's pattern must be an array of finite numbers";
const DESCRIPTION_LENGTH =
  "A linetype description cannot be longer than 249 characters, because AutoCAD cuts it there when it reads DXF";
const ID_EMPTY = "An id cannot be empty";
const ID_CHARS = "An id can only use the letters A to Z and a to z, digits, ., - and _";
const ID_LENGTH = "An id cannot be longer than 64 characters";
const TEXT_PERCENT =
  'AutoCAD reads "%%" in text as the start of a control code: it draws "%%d" as a degree sign and "%%%" as one percent sign. The text is stored as written';

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
 * the error message otherwise. AutoCAD holds linetype names to the rules of
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

/** AutoCAD Color Index: an integer from 1 to 255. */
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
 * message otherwise. AutoCAD holds text style names to the rules of layer names.
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
 * Resolves to `N` when it is a valid block name, and to the error message otherwise. AutoCAD
 * holds block names to the rules of layer names. Whether the drawing has the block, and
 * whether it has another that AutoCAD takes for the same, is checked when the code runs.
 */
export type BlockName<N extends string> = string extends N
  ? N
  : Lowercase<N> extends Lowercase<TickBlock>
    ? typeof ARROWHEAD_BLOCK
    : NameCheck<N, typeof BLOCK_NAMES, N>;

/** The block of the one arrowhead that has a block. */
type TickBlock = (typeof ARROWHEADS)["architectural-tick"]["block"];

/**
 * Resolves to `N` when it is a valid name for a dimension style to be used by, and to the error
 * message otherwise. AutoCAD holds dimension style names to the rules of layer names. `Standard`
 * is no style tsdraft draws a dimension in.
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

/** Resolves to `P` when it is a precision AutoCAD has, and to the error message otherwise. */
export type Precision<P extends number> = number extends P
  ? P
  : P extends Enumerate<9>
    ? P
    : typeof PRECISION;

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
 * hold, and no `"`: AutoCAD reads a path wrapped in a pair of quotes, and tsdraft wants it
 * written without them. Its length is checked when the code runs.
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
 * Resolves to `N` when it is a name a layout can have, and to the error message otherwise: a
 * name is not empty, is not `Model` in any case, holds none of `< > / \ " : ; ? * | , =` and
 * the backtick, no character a text cannot hold, and no space at either end. Its length, and
 * whether the drawing has another layout AutoCAD takes for the same, are checked when the code
 * runs.
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
 * Resolves to `P` when it is a pattern AutoCAD accepts, and to the error
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
 * Resolves to `D` when it is a linetype description AutoCAD keeps, and to the
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

/** A lineweight AutoCAD offers, in millimetres. */
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

/** Resolves to `W` when it is one of AutoCAD's lineweights, and to the error message otherwise. */
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
  // Only the ASCII space: AutoCAD takes a no-break space or any other at either end.
  if (name.startsWith(" ") || name.endsWith(" ")) return messages.edge;
  if (name.length > 255) return messages.length;
  return undefined;
}

/**
 * Returns what is wrong with a drawing that has both names as layers, or
 * undefined when the two can stand together. AutoCAD looks layers up one way
 * and its AUDIT compares their names another, so some pairs of names are two
 * layers to AutoCAD and one duplicate name to AUDIT: `ΟΔΟΣ` and `οδος`,
 * `straße` and `strasse`, a composed é and a decomposed one, and a name with
 * and without a soft hyphen. `layerAuditKey` lists the kinds this covers,
 * which are not all that AUDIT reports. Names that are one layer to AutoCAD
 * are not this function's concern. The rule compares two names, so it has no
 * type.
 *
 * @param name - The name of the layer being checked.
 * @param other - The name of another layer in the drawing.
 * @param kind - Whether the names are of layers, of linetypes or of text styles, which AutoCAD
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
  return `AutoCAD keeps this ${kind} and ${JSON.stringify(other)} as two ${kind}s, but its AUDIT reports them as one duplicate name`;
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
  return `Linetype ${JSON.stringify(name)} is not defined, and AutoCAD discards a drawing that uses a linetype it does not have`;
}

/** Returns what is wrong with the linetype a layer names, or undefined when it can be a layer's. */
export function layerLinetypeProblem(name: string): string | undefined {
  const builtInName = builtInLinetype(name);
  return builtInName === "ByLayer" || builtInName === "ByBlock" ? LAYER_LINETYPE : undefined;
}

/**
 * Returns what is wrong with a lineweight, or undefined when it is valid. A
 * layer's lineweight may also be "Default", and an entity's "ByLayer",
 * "ByBlock" or "Default". AutoCAD discards a drawing with an entity of any
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
 * Returns what is wrong with a layer's states, or undefined when AutoCAD takes
 * them. tsdraft writes layer "0" as the current layer, and AutoCAD's AUDIT
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
 * valid. AutoCAD reads a scale of 0 or less, or one written as 0, as 1.
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
} as const;

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
  if (typeof font !== "string" || !fontInfo(font)) return FONT;
  if (typeof widthFactor !== "number" || !Number.isFinite(widthFactor)) {
    return "widthFactor must be a finite number";
  }
  // Judged as written, as every number is.
  if (written(widthFactor) < 0.01 || written(widthFactor) > 100) return WIDTH_FACTOR;
  if (typeof obliqueAngle !== "number" || !Number.isFinite(obliqueAngle)) {
    return "obliqueAngle must be a finite number";
  }
  // Judged as written: 85.0000001 is written as 85.
  return Math.abs(written(obliqueAngle)) > 85 ? OBLIQUE : undefined;
}

/**
 * Returns what is wrong with a text that names a text style the drawing does
 * not have. The rule depends on the drawing, so it has no type.
 */
export function undefinedTextStyleProblem(name: string): string {
  return `Text style ${JSON.stringify(name)} is not defined. AutoCAD puts a text that names a style it does not have in Standard, and reports nothing`;
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

/** Returns what is wrong with a layer color, or undefined when it is valid. */
export function layerColorProblem(color: number): string | undefined {
  return Number.isInteger(color) && color >= 1 && color <= 255 ? undefined : COLOR;
}

/**
 * Returns what is wrong with a radius, a text height or a rectangle size, or
 * undefined when it is valid. A size that is written as 0 is refused like 0
 * itself: AutoCAD gives text of height 0 the drawing's default text height,
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
    return "The result is 1e100 drawing units or more, and AutoCAD reads only two exponent digits from DXF. Use a shorter paper length or a smaller ratio";
  }
  return undefined;
}

/**
 * Returns what is wrong with the size of a number a drawing holds, or
 * undefined when AutoCAD can read it. This goes for every number that is
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
 * writing, or undefined when the arc can be written. AutoCAD holds an arc
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
 * `idHandle` in `handles.ts` works a handle out from each id, and AutoCAD discards a drawing in
 * which two objects have one handle. The rule depends on the drawing, so it has no type.
 *
 * @param id - The id of the second entity.
 * @param first - The id that gave the handle first.
 * @param handle - The handle both ids give.
 */
export function idHandleProblem(id: string, first: string, handle: string): string {
  return `The ids ${JSON.stringify(first)} and ${JSON.stringify(id)} give the same handle, ${handle}. An entity's handle comes from its id, and AutoCAD discards a drawing in which two objects have one handle. Change this id`;
}

/**
 * Returns what is wrong with an object whose key gives the handle another key already gave.
 * A block's own objects take their handles from its name, an attribute definition from its
 * block and tag, and the attributes of an insert that has an id from the id and the tag, as
 * an entity takes its handle from its id. AutoCAD discards a drawing in which two objects have
 * one handle. The rule depends on the drawing, so it has no type.
 *
 * @param what - What the second object is, such as `the block "TREE"`.
 * @param first - What the first object is.
 * @param handle - The handle both give.
 */
export function handleProblem(what: string, first: string, handle: string): string {
  return `${what} and ${first} give the same handle, ${handle}. AutoCAD discards a drawing in which two objects have one handle. Rename one of them`;
}

/**
 * Returns what is wrong with a block name, or undefined when it is valid. AutoCAD discards a
 * drawing over a block name that breaks the rules of layer names.
 */
export function blockNameProblem(name: unknown): string | undefined {
  if (typeof name !== "string") return "A block's name must be a string";
  const problem = nameProblem(name, BLOCK_NAMES);
  if (problem) return problem;
  // AutoCAD draws an arrowhead with whatever block has its name.
  return layerKey(name) === layerKey(ARROWHEADS["architectural-tick"].block)
    ? ARROWHEAD_BLOCK
    : undefined;
}

/**
 * Returns what is wrong with a drawing that has both names as blocks, or undefined when the two
 * can stand together. AutoCAD takes two block names for one where it would call two layer
 * names duplicates: `TREE` and `tree`, `straße` and `strasse`, a composed é and a decomposed
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
  return `The drawing already has a block of this name${spelled}. AutoCAD takes the two for one block, puts the entities of both in it and reports nothing`;
}

/**
 * Returns what is wrong with an xref whose name AutoCAD takes for the name of a block or of
 * another xref of the drawing, as `blockTwinProblem` says of two blocks. An xref is a block to
 * AutoCAD, and the two share their names.
 *
 * @param name - The name being checked: an xref's, or a block's when `kind` is `"xref"`.
 * @param other - The name the drawing already has.
 * @param kind - What has that name already.
 */
export function xrefTwinProblem(name: string, other: string, kind: "block" | "xref"): string {
  const spelled = name === other ? "" : `, as ${JSON.stringify(other)}`;
  return `The drawing already has ${kind === "xref" ? "an xref" : "a block"} of this name${spelled}. An xref is a block to AutoCAD, which takes the two names for one: it discards a drawing with two such names that differ in case, and makes one xref of any other two and reports nothing`;
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

/** The warning for an xref that no insert places. */
export const XREF_UNPLACED =
  "No insert places this xref. AutoCAD purges an xref that nothing references when it opens the drawing";

/**
 * Returns what is wrong with an insert that names a block the drawing does not have. The rule
 * depends on the drawing, so it has no type.
 */
export function undefinedBlockProblem(name: string): string {
  return `Block ${JSON.stringify(name)} is not defined. AutoCAD's AUDIT reports an insert of a block the drawing does not have, and AutoCAD cannot save the drawing as DXF`;
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
  return `Block ${JSON.stringify(path[0])} holds an insert of itself${through}. AutoCAD's AUDIT reports such blocks as self referencing`;
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
 * undefined when AutoCAD takes it. An insert that scales its block unevenly widens or narrows
 * each attribute and slants it, and AutoCAD's AUDIT reports an attribute slanted by more than
 * 85 degrees as it reports a text, and one whose width factor is 750000. The width factor is
 * held to the range of a text style's, and the attribute's point to the size of any point. The rule depends on the insert and its
 * block, so it has no type.
 *
 * @param tag - The attribute's tag.
 * @param placed - The attribute as `placeAttribute` gives it.
 */
export function placedAttributeProblem(
  tag: string,
  placed: {
    readonly at: readonly [number, number];
    readonly height: number;
    readonly widthFactor: number;
    readonly obliqueAngle: number;
  },
): string | undefined {
  const about = `its scale makes the attribute ${JSON.stringify(tag)}`;
  if (!placed.at.every(Number.isFinite))
    return `it puts the attribute ${JSON.stringify(tag)} at no point`;
  const far = magnitudeProblem(placed.at[0]) ?? magnitudeProblem(placed.at[1]);
  if (far) return `it puts the attribute ${JSON.stringify(tag)} at ${placed.at.join(", ")}. ${far}`;
  if (![placed.height, placed.widthFactor, placed.obliqueAngle].every(Number.isFinite)) {
    return `${about} a text of no size`;
  }
  const height = sizeProblem(placed.height);
  if (height) return `${about} ${placed.height} high. ${height}`;
  if (Math.abs(written(placed.obliqueAngle)) > 85) {
    return `${about} slant by ${written(placed.obliqueAngle)} degrees. ${OBLIQUE}. Scale the insert more evenly`;
  }
  if (written(placed.widthFactor) < 0.01 || written(placed.widthFactor) > 100) {
    return `${about} ${written(placed.widthFactor)} times as wide as its font draws it. ${WIDTH_FACTOR}, and an attribute with one of 750000. Scale the insert more evenly`;
  }
  return undefined;
}

/**
 * Returns what is wrong with a second attribute definition of a block that has the tag of an
 * earlier one. An insert sets an attribute by its tag, and the tag gives the definition its
 * handle, so two definitions of one tag would have one handle, and AutoCAD discards a drawing
 * in which two objects have one handle. The rule depends on the block, so it has no type.
 */
export function duplicateAttributeProblem(tag: string): string {
  return `The block already has an attribute with the tag ${JSON.stringify(tag)}. An insert sets an attribute by its tag, and the tag gives the definition its handle: AutoCAD discards a drawing in which two objects have one handle`;
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
    return "Text cannot contain emoji or other characters above U+FFFF, because AutoCAD cannot read them from DXF";
  }
  if (/[\ue800-\ue8ff]/.test(value)) return TEXT_PRIVATE_USE;
  return undefined;
}

/**
 * Returns a warning for text that AutoCAD stores as written but draws
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
 * the two can stand together. AutoCAD takes two layout names for one when they differ only in
 * the case of letters it folds, which `layoutNameKey` holds: `Sheet` and `SHEET`, `É1` and
 * `é1`. It then keeps one of the two layouts under the name, and its AUDIT reports the other as
 * missing from the dictionary of layouts. The rule compares two names, so it has no type.
 *
 * @param name - The name of the layout being checked.
 * @param other - The name of another layout of the drawing.
 */
export function layoutTwinProblem(name: string, other: string): string | undefined {
  if (layoutNameKey(name) !== layoutNameKey(other)) return undefined;
  const spelled = name === other ? "" : `, as ${JSON.stringify(other)}`;
  return `The drawing already has a layout of this name${spelled}. AutoCAD takes the two for one layout, keeps one, and its AUDIT reports the other as missing from the dictionary of layouts`;
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

/**
 * Returns what is wrong with a viewport, or undefined when it can be written: its corner and
 * its center are points, its width and its height are sizes, and its ratio is greater than 0
 * and gives a view AutoCAD can hold. A file holds the height of model space the viewport
 * shows, in drawing units, where a scale would be, so that height is held to the rules of any
 * size: it is not written as 0 and is under 1e100. It takes `unknown` so that `lint` can
 * report a drawing built by hand. The ratio has the type `Ratio`.
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
  const { corner, width, height, center, ratio } = viewport as Record<string, unknown>;
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
    return `At the ratio ${ratio} the viewport shows 1e100 drawing units or more, and AutoCAD reads only two exponent digits from DXF. Use a smaller ratio`;
  }
  if (written(viewHeight) === 0) {
    return `At the ratio ${ratio} the viewport shows ${viewHeight} drawing units up and down, which is written as 0, because tsdraft writes 6 decimals. Use a larger ratio`;
  }
  return undefined;
}

/**
 * The warning for a viewport whose rectangle reaches past its layout's paper. AutoCAD plots a
 * layout as far as its paper goes.
 *
 * @returns The warning, or undefined when the rectangle is on the paper.
 */
export function viewportOffPaperWarning(
  rectangle: readonly [minX: number, minY: number, maxX: number, maxY: number],
  paper: { readonly width: number; readonly height: number },
): string | undefined {
  const [minX, minY, maxX, maxY] = rectangle;
  return minX < 0 || minY < 0 || maxX > paper.width || maxY > paper.height
    ? `the viewport reaches from ${minX}, ${minY} to ${maxX}, ${maxY}, past the paper, which is ${paper.width} by ${paper.height}. AutoCAD plots a layout as far as its paper goes`
    : undefined;
}

/** The warning for a viewport that frames a part of model space where nothing is drawn. */
export function viewportEmptyWarning(
  box: readonly [minX: number, minY: number, maxX: number, maxY: number],
): string {
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
function notNegativeProblem(value: unknown, message: string = NOT_NEGATIVE): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return "must be a finite number";
  // Judged as written: a size that is written as 0 is 0.
  return written(value) < 0 ? message : magnitudeProblem(value);
}

/** Returns what is wrong with one of a dimension style's two scales, or undefined. */
function styleScaleProblem(value: unknown, message: string): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return "must be a finite number";
  return value > 0 ? sizeProblem(value) : message;
}

/**
 * Returns what is wrong with a prefix, a suffix or a dimension's own text as a string AutoCAD
 * draws as it is, or undefined: it is a text, with none of the characters AutoCAD reads as
 * formatting.
 */
function plainDimensionText(value: unknown): string | undefined {
  if (typeof value !== "string") return "must be a string";
  return textProblem(value) ?? (/[\\{}]/.test(value) ? DIMENSION_FORMATTING : undefined);
}

/**
 * Returns what is wrong with a dimension style, or undefined when it is valid. It takes a value
 * of any shape, so that `lint` can report a drawing built by hand. Whether the drawing has the
 * style's text style is the caller's to check, since it depends on the drawing.
 *
 * AutoCAD's AUDIT reports a style whose text height is 0 or less, whose arrow size or either
 * extension line length is less than 0, whose scale is less than 0, whose measurement scale is
 * 0, or whose precision is not a whole number from 0 to 8. It draws a box around the text for a
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
  if (s.arrowhead !== undefined && !arrowheadInfo(s.arrowhead)) return ARROWHEAD;
  for (const field of ["arrowSize", "extensionOffset", "extensionBeyond"] as const) {
    const problem = notNegativeProblem(s[field]);
    if (problem) return `${field}: ${problem}`;
  }
  const gap = notNegativeProblem(s.textGap, TEXT_GAP);
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
      return `${field}: times the scale it is ${scaled}, and AutoCAD reads only two exponent digits from DXF, so every size of a picture must be under 1e100. Use a smaller size or scale`;
    }
  }
  // The picture writes the text's height and an arrowhead's size with 6 decimals.
  for (const field of ["textHeight", "arrowSize"] as const) {
    const size = written(s[field] as number);
    if (size > 0 && written(size * scale) === 0) {
      return `${field}: times the scale it is ${size * scale}, which is written as 0 with the 6 decimals tsdraft writes, so the picture of a dimension would draw ${field === "textHeight" ? "its text" : "its arrowheads"} with no size. Use a larger size or scale${field === "arrowSize" ? ", or an arrow size of 0" : ""}`;
    }
  }
  const precision = s.precision;
  if (
    typeof precision !== "number" ||
    !Number.isInteger(precision) ||
    precision < 0 ||
    precision > MAX_PRECISION
  ) {
    return PRECISION;
  }
  for (const field of ["prefix", "suffix"] as const) {
    if (s[field] === undefined) continue;
    const problem = plainDimensionText(s[field]);
    if (problem) return `${field}: ${problem}`;
  }
  if (typeof s.prefix === "string" && s.prefix.includes("<>")) return PREFIX_MEASUREMENT;
  if (
    s.suppressZeros !== undefined &&
    !(ZERO_SUPPRESSIONS as readonly unknown[]).includes(s.suppressZeros)
  ) {
    return ZERO_SUPPRESSION;
  }
  if (s.measurementScale !== undefined) {
    const problem = styleScaleProblem(s.measurementScale, MEASUREMENT_SCALE);
    if (problem) return `measurementScale: ${problem}`;
  }
  return undefined;
}

/**
 * Returns the warning for a prefix or a suffix AutoCAD stores as written and draws differently,
 * as `textWarning` gives one for a text, or undefined.
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
 * undefined when the two can stand together. AutoCAD keeps the first of two names that differ
 * only in case and skips the second, and its AUDIT reports two names it takes for one in the
 * other ways `layerAuditKey` lists, such as `strasse` and `straße`. The rule compares two
 * names, so it has no type.
 */
export function dimensionStyleTwinProblem(name: string, other: string): string | undefined {
  if (layerAuditKey(name) !== layerAuditKey(other)) return undefined;
  if (layerKey(name) === layerKey(other)) {
    return "The drawing already has a dimension style of this name. CAD ignores case in dimension style names and keeps the first";
  }
  return `The drawing already has a dimension style of this name, as ${JSON.stringify(other)}. AutoCAD's AUDIT reports a duplicate name in the dimension style table`;
}

/**
 * Returns what is wrong with a dimension style whose text style the drawing does not have. The
 * rule depends on the drawing, so it has no type.
 */
export function undefinedDimensionTextStyleProblem(name: string): string {
  return `Text style ${JSON.stringify(name)} is not defined. A dimension style holds its text style by its handle, and AutoCAD's AUDIT reports one that leads to no style`;
}

/**
 * Returns what is wrong with a dimension that names a dimension style the drawing does not
 * define. The rule depends on the drawing, so it has no type.
 */
export function undefinedDimensionStyleProblem(name: string): string {
  return isStandardDimensionStyle(name)
    ? STANDARD_DIMENSION_STYLE_USED
    : `Dimension style ${JSON.stringify(name)} is not defined. AutoCAD discards a drawing with a dimension in a style it does not have`;
}

/** Returns what is wrong with a dimension's own text, or undefined when AutoCAD draws it as it is. */
export function dimensionTextProblem(text: unknown): string | undefined {
  if (typeof text !== "string") return "its text must be a string";
  if (text.trim() === "" && !/[^ ]/.test(text)) return DIMENSION_TEXT_BLANK;
  const problem = plainDimensionText(text);
  if (problem) return problem;
  return text.includes("<>") && text.includes("[]") ? DIMENSION_TEXT_ALTERNATE : undefined;
}

/** What is wrong with a dimension in a block. */
export const DIMENSION_IN_BLOCK =
  "a dimension cannot be in a block. AutoCAD draws nothing for a dimension inside a block when it opens the file, so an insert of the block would show nothing of it. Draw it in model space or on a layout";

/** The measurement from which AutoCAD has too few digits for every decimal. */
const MEASUREMENT_LIMIT = 1e8;

/**
 * The most digits a measurement may be written with, before and after its point. AutoCAD writes
 * 16, and works the 16th out from its own arithmetic on the points.
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
    : `what it draws reaches ${value}, and AutoCAD reads only two exponent digits from DXF, so every number of a picture must be under 1e100. Use smaller points, sizes or a smaller scale`;
}

/**
 * Returns what is wrong with what a dimension measures, or undefined when AutoCAD draws it as
 * tsdraft does. The rule depends on the dimension's points and its style, so it has no type.
 *
 * A dimension must measure something as it is written: AutoCAD draws one that measures nothing
 * with the text 0 and its arrowheads turned outward. What it writes, the measurement times the
 * style's measurement scale rounded to the style's precision, must be under 100,000,000:
 * AutoCAD writes 16 digits of a measurement, so it drops decimals of a larger one at a
 * precision of 8, and writes 1e16 as `1.0E+16`. It must have no more than 15 digits: AutoCAD
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
 * @param text - The text AutoCAD draws for it.
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
      ? "it has no length: its two points are one point once they are written with the 6 decimals tsdraft writes. AutoCAD draws such a dimension with the text 0 and its arrowheads turned outward"
      : "it measures nothing: its two points are as far along the direction it measures, once they are written with the 6 decimals tsdraft writes. AutoCAD draws such a dimension with the text 0 and its arrowheads turned outward";
  }
  const [whole = "", decimals = ""] = rounded.split(".");
  if (!(Number(whole) < MEASUREMENT_LIMIT)) {
    return `it reads ${rounded}, and AutoCAD writes 16 digits of a measurement: from 100,000,000 up it drops decimals at a precision of 8, and it writes 1e16 as 1.0E+16. Use a smaller measurement scale`;
  }
  const digits = whole.replace(/^0+/, "").length + decimals.length;
  if (digits > MEASUREMENT_DIGITS) {
    return `it reads ${rounded}, which is ${digits} digits at a precision of ${decimals.length}. AutoCAD works out the 16th digit of a measurement from its own arithmetic on the points, so it may end in another digit: it writes 99,999,999.5 at a precision of 8 as 99999999.50000002. Use a smaller precision or measurement scale`;
  }
  if (room !== undefined && measurement <= room) {
    return `its text may not fit between its extension lines: it measures ${written(measurement)}, and its text, ${JSON.stringify(text)}, and its arrowheads may need ${written(room)}. AutoCAD then turns closed filled arrowheads outward, by the width of the text in its font, which tsdraft does not hold. Give it more room, a smaller text or arrow size, or the arrowhead "architectural-tick", which is drawn the same either way`;
  }
  return undefined;
}
