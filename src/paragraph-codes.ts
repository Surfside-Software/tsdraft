// The inline codes of a paragraph's value, as the DXF Reference gives them for MTEXT: what each
// one draws, read in one pass, and what tsdraft refuses to write. The layout and the writers read
// a value through `parseParagraph`.
import { FONTS, isFont, type Font } from "./fonts.ts";
import { isString } from "./guards.ts";

/** How deep a paragraph's braces may nest. */
export const PARAGRAPH_NESTING = 16;

/** The longest name a message quotes whole. */
const QUOTED = 64;

export const PARAGRAPH_CONTROL =
  "A paragraph's value holds no control characters but a tab, written as itself. paragraph() takes a line feed as a paragraph break and holds it as \\P";

export const PARAGRAPH_ASTRAL =
  "A paragraph cannot hold emoji or other characters above U+FFFF, because the leading CAD app cannot read them from DXF";

export const PARAGRAPH_PRIVATE_USE =
  "A paragraph cannot hold the private-use characters U+E800 to U+E8FF, because the leading CAD app replaces them when it reads DXF";

export const PARAGRAPH_NEVER_CLOSED =
  "A { in the paragraph is never closed by a }. Write \\{ for a brace";

export const PARAGRAPH_NEVER_OPENED = "A } in the paragraph closes no {. Write \\} for a brace";
export const PARAGRAPH_TOO_DEEP = `The paragraph's braces nest more than ${PARAGRAPH_NESTING} deep`;

export const PARAGRAPH_TRAILING =
  "The paragraph ends with a \\, which starts a code. Write \\\\ for a backslash";

export const PARAGRAPH_STACK_SEPARATOR =
  "The paragraph code \\S stacks two parts, and needs a /, # or ^ between them";

export const PARAGRAPH_STACK_LINED =
  "A stack in underlined or struck-through characters is not laid out yet, so tsdraft refuses it";

export const PARAGRAPH_SHX_DIAMETER =
  "A paragraph's %%c in an SHX font draws a diameter sign of its own, narrower than Ø, which is not laid out yet, so tsdraft refuses it. Set it in a TrueType font, or write Ø";

export const PARAGRAPH_STACK_PART =
  "A stacked part of a paragraph holds digits or capitals, with . , + or - beside them, or only spaces, or nothing: where the tops of other characters stack is not laid out yet, so tsdraft refuses it";

/** What each code a paragraph may hold but tsdraft does not lay out yet does. */
export const PARAGRAPH_NOT_LAID_OUT = {
  T: "sets the spacing of the characters after it",
  X: "starts the part of a dimension's text below its line",
  M: "holds a character of a code page",
  m: "holds a character of a code page",
  O: "draws a line over the characters after it",
} as const;

export type NotLaidOutCode = keyof typeof PARAGRAPH_NOT_LAID_OUT;

export function paragraphNotLaidOut<C extends NotLaidOutCode>(
  code: C,
): `The paragraph code \\${C}, which ${(typeof PARAGRAPH_NOT_LAID_OUT)[C]}, is not laid out yet, so tsdraft refuses it` {
  return `The paragraph code \\${code}, which ${PARAGRAPH_NOT_LAID_OUT[code]}, is not laid out yet, so tsdraft refuses it`;
}

export function paragraphPropertyUnknown<O extends string>(
  option: O,
): `The paragraph code \\p has the option "${O}", which tsdraft does not know: it takes i, l, r, b and a with a number, t with numbers or z, q with l, c, r, j or d, and s with m or e and a number` {
  // SAFETY: the message's type holds the text as given, and `quoted` gives it back but for one
  // so long that it is cut, which the type cannot say.
  return `The paragraph code \\p has the option "${quoted(option) as O}", which tsdraft does not know: it takes i, l, r, b and a with a number, t with numbers or z, q with l, c, r, j or d, and s with m or e and a number`;
}

export const PARAGRAPH_SPACING_AT_LEAST =
  "The paragraph code \\p sets its lines at least a size apart, sa, which is not laid out yet, so tsdraft refuses it. Give sm and a factor, or se and the size exactly";

export const PARAGRAPH_TAB_KIND =
  "The paragraph code \\p sets a tab stop that aligns text by its right, its center or a decimal point, which is not laid out yet, so tsdraft refuses it. Give the stop as a number alone";

export function paragraphUnknownCode<C extends string>(
  code: C,
): `The paragraph code \\${C} is not one tsdraft knows. Write \\\\ for a backslash` {
  return `The paragraph code \\${code} is not one tsdraft knows. Write \\\\ for a backslash`;
}

export function paragraphNoSemicolon<C extends string>(
  code: C,
): `The paragraph code \\${C} has no ; to end it` {
  return `The paragraph code \\${code} has no ; to end it`;
}

export function paragraphUnknownFont<C extends string, N extends string>(
  code: C,
  name: N,
): `The paragraph code \\${C} names the font "${N}", which is not one of FONTS` {
  // SAFETY: the message's type holds the text as given, and `quoted` gives it back but for one
  // so long that it is cut, which the type cannot say.
  return `The paragraph code \\${code} names the font "${quoted(name) as N}", which is not one of FONTS`;
}

export function paragraphItalic<C extends string>(
  code: C,
): `The paragraph code \\${C} sets italic, and tsdraft has no widths for italic letters` {
  return `The paragraph code \\${code} sets italic, and tsdraft has no widths for italic letters`;
}

export function paragraphShxBold<C extends string, N extends string>(
  code: C,
  name: N,
): `The paragraph code \\${C} sets bold in "${N}", an SHX font, which has no bold` {
  // SAFETY: the message's type holds the text as given, and `quoted` gives it back but for one
  // so long that it is cut, which the type cannot say.
  return `The paragraph code \\${code} sets bold in "${quoted(name) as N}", an SHX font, which has no bold`;
}

export function paragraphFontOption<C extends string, O extends string>(
  code: C,
  option: O,
): `The paragraph code \\${C} has the option "${O}", which tsdraft does not know: a font takes b0 or b1 for bold, i0, and c and p with a number` {
  // SAFETY: the message's type holds the text as given, and `quoted` gives it back but for one
  // so long that it is cut, which the type cannot say.
  return `The paragraph code \\${code} has the option "${quoted(option) as O}", which tsdraft does not know: a font takes b0 or b1 for bold, i0, and c and p with a number`;
}

export function paragraphFontOptionTwice<C extends string, L extends string>(
  code: C,
  letter: L,
): `The paragraph code \\${C} gives its option ${L} twice. Give each of b, i, c and p once` {
  return `The paragraph code \\${code} gives its option ${letter} twice. Give each of b, i, c and p once`;
}

/** A name for a message: the first `QUOTED` characters of a long one. */
function quoted(name: string): string {
  return name.length > QUOTED ? `${name.slice(0, QUOTED)}...` : name;
}

/** The format of a run of a paragraph's characters, which its codes set. */
export interface RunFormat {
  readonly underline: boolean;
  readonly overline: boolean;
  readonly strikeThrough: boolean;
  readonly bold: boolean;
  /** The font of `FONTS` a `\f` or `\F` code set, or undefined for the paragraph's own. */
  readonly font: Font | undefined;
  /** The height as a share of the paragraph's, which `\H` with an `x` sets. */
  readonly size: number;
  /**
   * The height in drawing units a `\H` without an `x` set, times what each `\H` with one after it
   * gives, or undefined where none did, for the paragraph's times `size`.
   */
  readonly height: number | undefined;
  /** The width factor `\W` sets, or undefined for the style's. */
  readonly widthFactor: number | undefined;
  /** The oblique angle in degrees `\Q` sets, or undefined for the style's. */
  readonly obliqueAngle: number | undefined;
  /** Where the characters and stacks sit up and down the line, `\A`: 0 on it, 1 centered, 2 at its top. */
  readonly align: 0 | 1 | 2;
  /**
   * The color a `\C` code sets by its index, 0 to 257, or a `\c` code as a true color, `TRUE_COLOR`
   * plus 0xRRGGBB; undefined for the entity's.
   */
  readonly color: number | undefined;
}

/** How a paragraph's lines stand across its box, as a `\pq` code sets it. */
export type ParagraphJustification = "left" | "center" | "right" | "justified" | "distributed";

/**
 * What a `\p` code sets of the paragraph it is in, each number in heights of the paragraph's
 * text. What it leaves out stays as it was.
 */
export interface ParagraphProperties {
  /** `i`: where the first line starts, from `left`. */
  readonly indent?: number;
  /** `l`: where every line but the first starts, from the left of the box. */
  readonly left?: number;
  /** `r`: how far short of the right of the box the lines stop. */
  readonly right?: number;
  /** `t`: where each tab stops, from the left of the box, as given; `tz` gives none. */
  readonly tabs?: readonly number[];
  /** `q`. */
  readonly justification?: ParagraphJustification;
  /** `b` and `a`: the room before and after the paragraph. */
  readonly before?: number;
  readonly after?: number;
  /** `s`: the spacing of its lines, `m` a factor of the paragraph's own and `e` exactly. */
  readonly spacing?: { readonly style: "m" | "e"; readonly value: number };
  /** True for `x`: the numbers are in heights of the text, and otherwise in drawing units. */
  readonly heights?: boolean;
}

/** A piece of a paragraph, in the order it is drawn. */
export type ParagraphPiece =
  /** What a `\p` code sets, where it stands. */
  | { readonly kind: "properties"; readonly properties: ParagraphProperties }
  /**
   * Characters drawn in one format, with no break among them. `diameter` is true when they hold
   * a diameter sign written `%%c`, which an SHX font draws as a sign of its own.
   */
  | {
      readonly kind: "characters";
      readonly value: string;
      readonly format: RunFormat;
      readonly diameter: boolean;
    }
  /** Two parts stacked, as a fraction, a superscript or a subscript. */
  | {
      readonly kind: "stack";
      readonly top: string;
      readonly bottom: string;
      /** `/` stacks the parts over a bar, `#` beside a slash, and `^` with no bar. */
      readonly separator: "/" | "#" | "^";
      readonly format: RunFormat;
    }
  /** A paragraph break, `\P`. */
  /** `\P`, or `\N`, which also starts the next column: `column` true. */
  | { readonly kind: "break"; readonly column?: boolean };

export interface ParsedParagraph {
  readonly pieces: readonly ParagraphPiece[];
  /**
   * The first code or character of the value that tsdraft refuses to write, or undefined. The
   * pieces are still read past it: a code it does not lay out draws nothing, and `\X` breaks
   * the line.
   */
  readonly problem: string | undefined;
  /**
   * True when it holds a `%%c` in the paragraph's own font, which `paragraphValueProblem` refuses
   * when that font is an SHX font. One in an SHX font a `\f` code set is a `problem`.
   */
  readonly ownDiameter: boolean;
  /** True when it holds a `\N`, which starts the next column. */
  readonly columnBreak: boolean;
}

const PLAIN: RunFormat = {
  underline: false,
  overline: false,
  strikeThrough: false,
  bold: false,
  font: undefined,
  size: 1,
  height: undefined,
  widthFactor: undefined,
  obliqueAngle: undefined,
  align: 0,
  color: undefined,
};

/**
 * What `%%` and the letter after it draw. A paragraph has no other: `%%` before any other
 * character is drawn as it is, and so is `%%%`.
 */
export const PERCENT_CODES: ReadonlyMap<string, string> = new Map([
  ["d", "°"],
  ["D", "°"],
  ["p", "±"],
  ["P", "±"],
  ["c", "Ø"],
  ["C", "Ø"],
]);

/** The codes that switch a line on or off: `\L` underline, `\O` overline, `\K` strike-through. */
const TOGGLES: ReadonlyMap<string, readonly [keyof RunFormat, boolean]> = new Map([
  ["L", ["underline", true]],
  ["l", ["underline", false]],
  ["O", ["overline", true]],
  ["o", ["overline", false]],
  ["K", ["strikeThrough", true]],
  ["k", ["strikeThrough", false]],
]);

/** The codes tsdraft does not lay out that end with a `;`. */
const ENDED = new Set(["H", "W", "Q", "T", "A", "C", "c"]);

/**
 * The argument each code before a `;` takes, as its type in `src/rules.ts` reads it: a number of
 * at most 15 digits before its point and 64 after it, above 0, for `\H`, which may end in `x`,
 * and `\W`; an angle from -85 to 85 for `\Q`; 0, 1 or 2 for `\A`; and 0 to 257 for `\C`.
 */
const ARGUMENTS: ReadonlyMap<string, RegExp> = new Map([
  ["H", /^\d{1,15}(?:\.\d{1,64})?x?$/],
  ["W", /^\d{1,15}(?:\.\d{1,64})?$/],
  ["Q", /^-?(?:(?:\d|[1-7]\d|8[0-4])(?:\.\d{1,64})?|85(?:\.0{1,64})?)$/],
  ["A", /^[012]$/],
  ["C", /^(?:\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-7])$/],
  ["c", /^\d{1,8}$/],
]);

/**
 * What each code before a `;` sets of the characters after it, from an argument it takes. `\C`
 * sets a color, which moves nothing but starts a run. A height or width factor of 0 is no argument.
 */
/** What a code before a `;` sets of a run's format from its argument, or undefined for none. */
interface CodeSets {
  readonly [code: string]: (argument: string, format: RunFormat) => RunFormat | undefined;
}

const CODE_SETS: CodeSets = {
  H: (argument, format) => {
    const times = argument.endsWith("x");
    const n = Number(times ? argument.slice(0, -1) : argument);

    if (!(n > 0)) return undefined;

    if (!times) return { ...format, height: n, size: 1 };

    return format.height === undefined
      ? { ...format, size: format.size * n }
      : { ...format, height: format.height * n };
  },
  W: (argument, format) =>
    Number(argument) > 0 ? { ...format, widthFactor: Number(argument) } : undefined,
  Q: (argument, format) => ({ ...format, obliqueAngle: Number(argument) }),
  // SAFETY: ARGUMENTS takes only 0, 1 or 2 for `\A`.
  A: (argument, format) => ({ ...format, align: Number(argument) as 0 | 1 | 2 }),
  C: (argument, format) => ({ ...format, color: Number(argument) }),
  // A true color, with its blue first: 255 is red.
  c: (argument, format) => {
    const bgr = Number(argument);

    if (bgr > 0xffffff) return undefined;
    const rgb = ((bgr & 0xff) << 16) | (bgr & 0xff00) | ((bgr >> 16) & 0xff);

    return { ...format, color: TRUE_COLOR + rgb };
  },
};

/** What a run's color holds for a true color: this, plus the color as 0xRRGGBB. */
export const TRUE_COLOR = 0x1000000;

/** The codes before a `;` that take an argument, and what each takes. */
export const PARAGRAPH_CODE_ARGUMENTS = {
  H: "a height above 0, in drawing units, or with an x after it a factor of the height before it",
  W: "a width factor above 0",
  Q: "an oblique angle in degrees, from -85 to 85",
  A: "0, 1 or 2: on the baseline, centered or at the top",
  C: "a color number from 0 to 257",
  c: "a true color, a whole number from 0 to 16777215 with its blue first",
} as const;

export type ArgumentCode = keyof typeof PARAGRAPH_CODE_ARGUMENTS;

export function paragraphCodeArgument<C extends ArgumentCode>(
  code: C,
): `The paragraph code \\${C} takes ${(typeof PARAGRAPH_CODE_ARGUMENTS)[C]}, and a ; after it` {
  return `The paragraph code \\${code} takes ${PARAGRAPH_CODE_ARGUMENTS[code]}, and a ; after it`;
}

function isHex(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

/** The value of four hex digits at `at`, or -1 when they are not four hex digits. */
function hexAt(value: string, at: number): number {
  if (at + 4 > value.length) return -1;

  for (let k = at; k < at + 4; k++) if (!isHex(value.charCodeAt(k))) return -1;

  return parseInt(value.slice(at, at + 4), 16);
}

/** A tab, which a paragraph's characters may hold, and a stacked part may not. */
const TAB = 9;

/** What is wrong with a character a paragraph holds, or undefined. */
function characterProblem(code: number, tab = false): string | undefined {
  if ((code < 0x20 && !(tab && code === TAB)) || code === 0x7f) return PARAGRAPH_CONTROL;

  if (code >= 0xd800 && code <= 0xdfff) return PARAGRAPH_ASTRAL;

  if (code >= 0xe800 && code <= 0xe8ff) return PARAGRAPH_PRIVATE_USE;

  return undefined;
}

function sameFormat(a: RunFormat, b: RunFormat): boolean {
  return (
    a.underline === b.underline &&
    a.overline === b.overline &&
    a.strikeThrough === b.strikeThrough &&
    a.bold === b.bold &&
    a.font === b.font &&
    a.size === b.size &&
    a.height === b.height &&
    a.widthFactor === b.widthFactor &&
    a.obliqueAngle === b.obliqueAngle &&
    a.align === b.align &&
    a.color === b.color
  );
}

/**
 * Reads a paragraph's value in one pass, in time and memory in proportion to its length, with a
 * stack of its own for its braces that holds at most `PARAGRAPH_NESTING` formats: a brace past
 * that is counted and changes nothing. It never throws, and reads any string: what it refuses
 * is `problem`, the first it met. The text of a dimension's picture is read alike.
 */
export function parseParagraph(value: string): ParsedParagraph {
  const pieces: ParagraphPiece[] = [];
  let problem: string | undefined;

  const fail = (message: string): void => {
    problem ??= message;
  };

  const saved: RunFormat[] = [];
  let deeper = 0;
  let format = PLAIN;
  let run = "";
  let diameter = false;
  let ownDiameter = false;
  let columnBreak = false;

  const flush = (): void => {
    if (diameter) {
      if (format.font === undefined) ownDiameter = true;
      else if (FONTS[format.font].file.endsWith(".shx")) fail(PARAGRAPH_SHX_DIAMETER);
    }

    if (run.length > 0) pieces.push({ kind: "characters", value: run, format, diameter });
    run = "";
    diameter = false;
  };

  const set = (next: RunFormat): void => {
    if (sameFormat(next, format)) return;
    flush();
    format = next;
  };

  const n = value.length;
  let i = 0;

  while (i < n) {
    const c = value.charCodeAt(i);
    const character = value[i]!;

    if (character === "\\") {
      i = code(i + 1);
      continue;
    }

    if (character === "{") {
      if (saved.length < PARAGRAPH_NESTING) saved.push(format);
      else {
        deeper++;
        fail(PARAGRAPH_TOO_DEEP);
      }

      i++;
      continue;
    }

    if (character === "}") {
      if (deeper > 0) deeper--;
      else if (saved.length > 0) set(saved.pop()!);
      else fail(PARAGRAPH_NEVER_OPENED);
      i++;
      continue;
    }

    if (character === "%" && value[i + 1] === "%") {
      const drawn = PERCENT_CODES.get(value[i + 2] ?? "");

      if (drawn !== undefined) {
        run += drawn;

        if (drawn === "Ø") diameter = true;
        i += 3;
        continue;
      }
    }

    const wrong = characterProblem(c, true);

    if (wrong) fail(wrong);

    // A pair of surrogates is one character above U+FFFF.
    const pair =
      c >= 0xd800 &&
      c <= 0xdbff &&
      value.charCodeAt(i + 1) >= 0xdc00 &&
      value.charCodeAt(i + 1) <= 0xdfff;

    // A control character but a tab draws nothing.
    if (!((c < 0x20 && c !== TAB) || c === 0x7f)) run += pair ? value.slice(i, i + 2) : character;
    i += pair ? 2 : 1;
  }

  flush();

  if (saved.length > 0 || deeper > 0) fail(PARAGRAPH_NEVER_CLOSED);

  return { pieces, problem, ownDiameter, columnBreak };

  /** Reads the code after a backslash at `at`, and gives where the value goes on after it. */
  function code(at: number): number {
    if (at >= n) {
      fail(PARAGRAPH_TRAILING);

      return n;
    }

    const letter = value[at]!;

    switch (letter) {
      case "P":
        flush();
        pieces.push({ kind: "break" });

        return at + 1;
      case "~":
        run += "\u00a0";

        return at + 1;
      case "\\":
      case "{":
      case "}":
        run += letter;

        return at + 1;
      case "N":
        flush();
        columnBreak = true;
        pieces.push({ kind: "break", column: true });

        return at + 1;
      case "X":
        fail(paragraphNotLaidOut(letter));
        flush();
        pieces.push({ kind: "break" });

        return at + 1;
      case "f":
      case "F":
        return font(letter, at + 1);
      case "p": {
        const end = value.indexOf(";", at + 1);

        if (end < 0) {
          fail(paragraphNoSemicolon(letter));

          return n;
        }

        const read = readProperties(value.slice(at + 1, end));

        if (read.problem) fail(read.problem);
        flush();
        pieces.push({ kind: "properties", properties: read.properties });

        return end + 1;
      }

      case "S":
        return stack(at + 1);
      case "U":
      case "u": {
        const unicode = value[at + 1] === "+" ? hexAt(value, at + 2) : -1;

        if (unicode < 0) break;
        const wrong = characterProblem(unicode);

        if (wrong) fail(wrong);
        else run += String.fromCharCode(unicode);

        return at + 6;
      }

      case "M":
      case "m": {
        const digit = value.charCodeAt(at + 2);

        if (value[at + 1] !== "+" || digit < 49 || digit > 53 || hexAt(value, at + 3) < 0) break;
        fail(paragraphNotLaidOut(letter));

        return at + 7;
      }
    }

    const toggle = TOGGLES.get(letter);

    if (toggle) {
      if (letter === "O") fail(paragraphNotLaidOut(letter));
      set({ ...format, [toggle[0]]: toggle[1] });

      return at + 1;
    }

    if (ENDED.has(letter)) {
      const end = value.indexOf(";", at + 1);

      if (end < 0) {
        fail(paragraphNoSemicolon(letter));

        return n;
      }

      if (letter === "T") {
        fail(paragraphNotLaidOut(letter));

        return end + 1;
      }

      const argument = value.slice(at + 1, end);

      const set1 = ARGUMENTS.get(letter)!.test(argument)
        ? CODE_SETS[letter]!(argument, format)
        : undefined;

      if (set1 === undefined) {
        // SAFETY: each code of ENDED but `\T`, which ends above, is one of PARAGRAPH_CODE_ARGUMENTS.
        fail(paragraphCodeArgument(letter as ArgumentCode));
      } else set(set1);

      return end + 1;
    }

    fail(paragraphUnknownCode(letter));

    return at + 1;
  }

  /** Reads a `\f` or `\F` code from after its letter, up to its `;`. */
  function font(letter: "f" | "F", at: number): number {
    const end = value.indexOf(";", at);

    if (end < 0) {
      fail(paragraphNoSemicolon(letter));

      return n;
    }

    const parts = value.slice(at, end).split("|");
    const name = parts[0]!;
    const known = isFont(name) ? name : undefined;

    if (!known) fail(paragraphUnknownFont(letter, name));
    let bold = false;
    /** The letters of the options given so far, a bit each. */
    let given = 0;

    for (let k = 1; k < parts.length; k++) {
      const option = parts[k]!;

      if (option === "b1") {
        bold = true;

        if (known && FONTS[known].file.endsWith(".shx")) fail(paragraphShxBold(letter, name));
      } else if (option === "i1") fail(paragraphItalic(letter));
      else if (option !== "b0" && option !== "i0" && !isNumbered(option)) {
        fail(paragraphFontOption(letter, option));
        continue;
      }

      // SAFETY: an option that comes here is b0, b1, i0 or i1, or c or p and a number.
      const bit = OPTION_BITS[option[0] as "b" | "i" | "c" | "p"];

      if (given & bit) fail(paragraphFontOptionTwice(letter, option[0]!));
      given |= bit;
    }

    set({ ...format, font: known ?? format.font, bold });

    return end + 1;
  }

  /**
   * Reads a `\S` code from after its letter, up to its first `;` that no backslash escapes. A
   * backslash takes the character after it as it is, and the first `/`, `#` or `^` no backslash
   * escapes divides the two parts.
   */
  function stack(at: number): number {
    let top = "";
    let bottom = "";
    let separator: "/" | "#" | "^" | undefined;
    let k = at;

    while (k < n) {
      const character = value[k]!;

      if (character === ";") break;
      let taken = character;

      if (character === "\\" && k + 1 < n) {
        taken = value[k + 1]!;
        k += 2;
      } else if (
        separator === undefined &&
        (character === "/" || character === "#" || character === "^")
      ) {
        separator = character;
        k++;
        continue;
      } else if (
        character === "%" &&
        value[k + 1] === "%" &&
        PERCENT_CODES.get(value[k + 2] ?? "")
      ) {
        taken = PERCENT_CODES.get(value[k + 2]!)!;
        k += 3;
      } else k++;
      // A tab is a character a stacked part may not hold, which `stackable` refuses.
      const wrong = characterProblem(taken.charCodeAt(0), true);

      if (wrong) fail(wrong);

      if (separator === undefined) top += taken;
      else bottom += taken;
    }

    if (k >= n) {
      fail(paragraphNoSemicolon("S"));

      return n;
    }

    if (separator === undefined) {
      fail(PARAGRAPH_STACK_SEPARATOR);
      run += top;

      return k + 1;
    }

    if (format.underline || format.strikeThrough) fail(PARAGRAPH_STACK_LINED);
    else if (!stackable(top) || !stackable(bottom)) fail(PARAGRAPH_STACK_PART);
    flush();
    pieces.push({ kind: "stack", top, bottom, separator, format });

    return k + 1;
  }
}

/** The justification each letter of a `\pq` code names. */
const JUSTIFICATIONS: ReadonlyMap<string, ParagraphJustification> = new Map([
  ["l", "left"],
  ["c", "center"],
  ["r", "right"],
  ["j", "justified"],
  ["d", "distributed"],
]);

/** A number of a `\p` code: a sign, then digits with a point among them or before them. */
const PROPERTY_NUMBER = /-?(?:\d+(?:\.\d*)?|\.\d+)/y;

/** The properties a `\p` code sets, and what is wrong with it, or undefined. */
export interface PropertiesRead {
  readonly properties: ParagraphProperties;
  readonly problem: string | undefined;
}

/**
 * Reads what a `\p` code sets, from the text between `\p` and its `;`: an `x` first, then
 * options one after another, a comma between them or not. Each takes a letter and what follows
 * it: `i`, `l`, `r`, `b` and `a` a number, `q` one of `l`, `c`, `r`, `j` and `d`, `s` one of
 * `m`, `e` and `a` and a number, and `t` `z` or numbers with a comma between each. It reads in
 * one pass and never throws.
 */
export function readProperties(body: string): PropertiesRead {
  const out: { -readonly [K in keyof ParagraphProperties]: ParagraphProperties[K] } = {};
  let problem: string | undefined;
  const n = body.length;
  let k = 0;

  if (body.startsWith("x")) {
    out.heights = true;
    k = 1;
  }

  const number = (): number | undefined => {
    PROPERTY_NUMBER.lastIndex = k;
    const found = PROPERTY_NUMBER.exec(body);

    if (!found) return undefined;
    k += found[0].length;
    const read = Number(found[0]);

    return Number.isFinite(read) ? read : undefined;
  };

  while (k < n && problem === undefined) {
    const from = k;
    const letter = body[k++]!;

    if (letter === ",") continue;
    let ok = true;

    switch (letter) {
      case "i":
      case "l":
      case "r":
      case "b":
      case "a": {
        const read = number();

        if (read === undefined) ok = false;
        else {
          const field = ({ i: "indent", l: "left", r: "right", b: "before", a: "after" } as const)[
            letter
          ];

          out[field] = read;
        }

        break;
      }

      case "q": {
        const justification = JUSTIFICATIONS.get(body[k] ?? "");

        if (justification === undefined) ok = false;
        else {
          out.justification = justification;
          k++;
        }

        break;
      }

      case "s": {
        const style = body[k];

        if (style === "a") {
          problem = PARAGRAPH_SPACING_AT_LEAST;
          break;
        }

        if (style !== "m" && style !== "e") {
          ok = false;
          break;
        }

        k++;
        const read = number();

        if (read === undefined) ok = false;
        else out.spacing = { style, value: read };
        break;
      }

      case "t": {
        if (body[k] === "z") {
          k++;
          out.tabs = [];
          break;
        }

        if (body[k] === "r" || body[k] === "c" || body[k] === "d") {
          problem = PARAGRAPH_TAB_KIND;
          break;
        }

        const tabs: number[] = [];
        let read = number();

        if (read === undefined) {
          ok = false;
          break;
        }

        tabs.push(read);

        // A comma before a number gives another stop; before a letter, another option.
        while (body[k] === ",") {
          const next = body[k + 1] ?? "";

          if (next === "r" || next === "c" || next === "d") {
            problem = PARAGRAPH_TAB_KIND;
            break;
          }

          if (!/[-.0-9]/.test(next)) break;
          k++;
          read = number();

          if (read === undefined) {
            ok = false;
            break;
          }

          tabs.push(read);
        }

        out.tabs = tabs;
        break;
      }

      default:
        ok = false;
    }

    if (!ok) problem = paragraphPropertyUnknown(body.slice(from, from + 2));
  }

  return { properties: out, problem };
}

/**
 * True for a part of a stack whose ink's top and bottom the font tables hold: digits or capitals,
 * which reach a capital's height and stand on the baseline, with `.`, `,`, `+` or `-` beside
 * them, which reach no higher; or only spaces; or nothing.
 */
function stackable(part: string): boolean {
  let spaces = 0;
  let tall = false;

  for (let k = 0; k < part.length; k++) {
    const code = part.charCodeAt(k);

    if (code === 32) spaces++;
    else if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90)) tall = true;
    else if (code !== 46 && code !== 44 && code !== 43 && code !== 45) return false;
  }

  return spaces === part.length || (tall && spaces === 0);
}

/** A bit for each letter a font code's option starts with. */
const OPTION_BITS = { b: 1, i: 2, c: 4, p: 8 } as const;

/**
 * True for a font option of a letter `c` or `p` and one or more digits, which tsdraft passes by.
 * `ParagraphFontOption` in `src/rules.ts` is the same grammar.
 */
function isNumbered(option: string): boolean {
  if (option.length < 2 || (option[0] !== "c" && option[0] !== "p")) return false;

  for (let k = 1; k < option.length; k++) {
    const digit = option.charCodeAt(k);

    if (digit < 48 || digit > 57) return false;
  }

  return true;
}

/**
 * Text for a paragraph that draws as it is written: a backslash and a brace escaped, and the
 * second percent sign of a `%%d`, `%%p` or `%%c` written as `\U+0025`, so it starts no code. A
 * line feed stays a paragraph break.
 *
 * ```ts
 * d.paragraph(`${plain(owner)} SHALL VERIFY`, { at: [0, 0] });
 * ```
 */
export function plain(text: string): string {
  const escaped = text.replace(/[\\{}]/g, (character) => `\\${character}`);

  return escaped.replace(/%%(?=[dDpPcC])/g, "%\\U+0025");
}

/** Text underlined. */
export function underline(text: string): string {
  return `{\\L${text}}`;
}

/** The fonts of `FONTS` that have a bold face: the TrueType fonts. */
export type BoldFont = {
  [K in Font]: (typeof FONTS)[K] extends { readonly pitchAndFamily: number } ? K : never;
}[Font];

/**
 * Text in the bold face of a TrueType font of `FONTS`, which it is then set in, and measured by
 * the bold face's own widths.
 */
export function bold(text: string, font: BoldFont): string {
  return `{\\f${font}|b1;${text}}`;
}

/** Escapes what would end a part of a stack early. */
function part(text: string): string {
  return text.replace(/[\\;/#^]/g, (character) => `\\${character}`);
}

/**
 * Two parts stacked: over a level bar for `"/"`, the default, beside a slash for `"#"`, and with
 * no bar for `"^"`, as a tolerance is written. Each part holds digits or capitals, with `.`, `,`,
 * `+` or `-` beside them.
 *
 * ```ts
 * d.paragraph(`3${stack("1", "2")}" GAP`, { at: [0, 0] });
 * ```
 */
export function stack(top: string, bottom: string, separator: "/" | "#" | "^" = "/"): string {
  return `\\S${part(top)}${separator}${part(bottom)};`;
}

/** Text set above the line, as an exponent is: `\S2^ ;`. It holds digits or capitals. */
export function superscript(text: string): string {
  return `\\S${part(text)}^ ;`;
}

/** Text set at the foot of the line, under room for a top part, as an index is: `\S^2;`. */
export function subscript(text: string): string {
  return `\\S^${part(text)};`;
}

/** A number of a `\p` code as its grammar reads it: up to 6 decimals, never with an exponent. */
function propertyNumber(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e15) {
    throw new RangeError(`A paragraph's format takes numbers below 1e15, not ${value}`);
  }

  const rounded = Math.round(value * 1e6) / 1e6;

  return rounded === 0 ? "0" : String(rounded);
}

/** The letter `q` takes for each justification. */
const JUSTIFICATION_LETTERS: Readonly<Record<ParagraphJustification, string>> = {
  left: "l",
  center: "c",
  right: "r",
  justified: "j",
  distributed: "d",
};

/**
 * A `\p` code that sets what `properties` gives of the paragraph it starts and of each after it,
 * in heights of the text: written with `x`. `tabs: []` sets no stops, `tz`.
 *
 * ```ts
 * d.paragraph(`${paragraphFormat({ justification: "center" })}TITLE`, { at: [0, 0], width: 4 });
 * ```
 */
export function paragraphFormat(properties: Omit<ParagraphProperties, "heights">): string {
  const options: string[] = [];

  const add = (letter: string, value: number | undefined): void => {
    if (value !== undefined) options.push(`${letter}${propertyNumber(value)}`);
  };

  add("i", properties.indent);
  add("l", properties.left);
  add("r", properties.right);

  if (properties.tabs) {
    options.push(
      properties.tabs.length === 0 ? "tz" : `t${properties.tabs.map(propertyNumber).join(",")}`,
    );
  }

  if (properties.justification) options.push(`q${JUSTIFICATION_LETTERS[properties.justification]}`);
  add("b", properties.before);
  add("a", properties.after);

  if (properties.spacing) add(`s${properties.spacing.style}`, properties.spacing.value);

  return `\\px${options.join(",")};`;
}

/** How a list marks its items, by its first: `"1."`, `"1)"`, `"A."` or `"a."`. */
export type ListMarks = "1." | "1)" | "A." | "a.";

/** An item of a list, with the items of the level under it. */
export interface ListItem {
  readonly text: string;
  readonly items?: readonly string[];
}

/** The mark of the item `n`, from 1: a number, or letters from A to Z, then AA, AB and on. */
function mark(marks: ListMarks, n: number): string {
  if (marks === "1." || marks === "1)") return `${n}${marks[1]}`;
  let letters = "";

  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) {
    letters = String.fromCharCode(65 + ((k - 1) % 26)) + letters;
  }

  return `${marks === "a." ? letters.toLowerCase() : letters}.`;
}

/**
 * A numbered or lettered list in two levels, as the leading CAD app writes one: each item a
 * paragraph of its own, its mark, a tab and its text, under a hanging indent of `indent` heights,
 * 3 by default, and each item of the level under it indented as far again. The items are joined
 * by `\P`, so the value lays out alike in `d.paragraph` and in `layoutParagraph`. What follows a list in the same paragraph value keeps its indents and tab stops
 * until `paragraphFormat({ indent: 0, left: 0, tabs: [] })` sets them back.
 *
 * ```ts
 * d.paragraph(`GENERAL NOTES\\P${list(["VERIFY ALL DIMENSIONS.", { text: "DO NOT SCALE.", items: ["SEE A-101."] }])}`, {
 *   at: [0, 0],
 *   width: 4,
 * });
 * ```
 */
export function list(
  items: readonly (string | ListItem)[],
  options: {
    readonly marks?: ListMarks;
    readonly subMarks?: ListMarks;
    readonly indent?: number;
  } = {},
): string {
  const { marks = "1.", subMarks = "A.", indent = 3 } = options;

  const level = (depth: number): string =>
    paragraphFormat({ indent: -indent, left: indent * depth, tabs: [indent * depth] });

  const out: string[] = [];
  items.forEach((item, i) => {
    const { text, items: under = [] } = isString(item) ? { text: item } : item;
    out.push(`${level(1)}${mark(marks, i + 1)}\t${text}`);
    under.forEach((sub, k) => out.push(`${level(2)}${mark(subMarks, k + 1)}\t${sub}`));
  });

  return out.join("\\P");
}
