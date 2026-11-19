// The inline codes of a paragraph's value, as the DXF Reference gives them for MTEXT: what each
// one draws, read in one pass, and what tsdraft refuses to write. The layout and the writers read
// a value through `parseParagraph`.
import { fontInfo, FONTS, type Font } from "./fonts.ts";

/** How deep a paragraph's braces may nest. */
export const PARAGRAPH_NESTING = 16;

/** The longest name a message quotes whole. */
const QUOTED = 64;

export const PARAGRAPH_CONTROL =
  "A paragraph's value holds no control characters. paragraph() takes a line feed as a paragraph break and holds it as \\P, and tabs are not laid out yet";
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
  p: "sets the indents, tab stops and alignment of a paragraph",
  H: "sets the height of the characters after it",
  W: "sets the width factor of the characters after it",
  Q: "sets the oblique angle of the characters after it",
  T: "sets the spacing of the characters after it",
  A: "sets where the characters after it sit up and down the line",
  C: "sets the color of the characters after it",
  c: "sets the true color of the characters after it",
  N: "starts a new column",
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
  return `The paragraph code \\${code} sets bold in "${quoted(name) as N}", an SHX font, which has no bold`;
}

export function paragraphFontOption<C extends string, O extends string>(
  code: C,
  option: O,
): `The paragraph code \\${C} has the option "${O}", which tsdraft does not know: a font takes b0 or b1 for bold, i0, and c and p with a number` {
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
}

/** A piece of a paragraph, in the order it is drawn. */
export type ParagraphPiece =
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
  | { readonly kind: "break" };

export interface ParsedParagraph {
  readonly pieces: readonly ParagraphPiece[];
  /**
   * The first code or character of the value that tsdraft refuses to write, or undefined. The
   * pieces are still read past it: a code it does not lay out draws nothing, and `\N` and `\X`
   * break the line.
   */
  readonly problem: string | undefined;
  /**
   * True when it holds a `%%c` in the paragraph's own font, which `paragraphValueProblem` refuses
   * when that font is an SHX font. One in an SHX font a `\f` code set is a `problem`.
   */
  readonly ownDiameter: boolean;
}

const PLAIN: RunFormat = {
  underline: false,
  overline: false,
  strikeThrough: false,
  bold: false,
  font: undefined,
};

/**
 * What `%%` and the letter after it draw. A paragraph has no other: `%%` before any other
 * character is drawn as it is, and so is `%%%`.
 */
const PERCENT_CODES: Readonly<Record<string, string>> = {
  d: "°",
  D: "°",
  p: "±",
  P: "±",
  c: "Ø",
  C: "Ø",
};

/** The codes that switch a line on or off: `\L` underline, `\O` overline, `\K` strike-through. */
const TOGGLES: Readonly<Record<string, readonly [keyof RunFormat, boolean]>> = {
  L: ["underline", true],
  l: ["underline", false],
  O: ["overline", true],
  o: ["overline", false],
  K: ["strikeThrough", true],
  k: ["strikeThrough", false],
};

/** The codes tsdraft does not lay out that end with a `;`. */
const ENDED = new Set(["p", "H", "W", "Q", "T", "A", "C", "c"]);

function isHex(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

/** The value of four hex digits at `at`, or -1 when they are not four hex digits. */
function hexAt(value: string, at: number): number {
  if (at + 4 > value.length) return -1;
  for (let k = at; k < at + 4; k++) if (!isHex(value.charCodeAt(k))) return -1;
  return parseInt(value.slice(at, at + 4), 16);
}

/** What is wrong with a character a paragraph holds, or undefined. */
function characterProblem(code: number): string | undefined {
  if (code < 0x20 || code === 0x7f) return PARAGRAPH_CONTROL;
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
    a.font === b.font
  );
}

/**
 * Reads a paragraph's value in one pass, in time and memory in proportion to its length, with a
 * stack of its own for its braces that holds at most `PARAGRAPH_NESTING` formats: a brace past
 * that is counted and changes nothing. It never throws, and reads any string: what it refuses
 * is `problem`, the first it met.
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
      const drawn = PERCENT_CODES[value[i + 2] ?? ""];
      if (drawn !== undefined) {
        run += drawn;
        if (drawn === "Ø") diameter = true;
        i += 3;
        continue;
      }
    }
    const wrong = characterProblem(c);
    if (wrong) fail(wrong);
    // A pair of surrogates is one character above U+FFFF.
    const pair =
      c >= 0xd800 &&
      c <= 0xdbff &&
      value.charCodeAt(i + 1) >= 0xdc00 &&
      value.charCodeAt(i + 1) <= 0xdfff;
    // A control character draws nothing.
    if (!(c < 0x20 || c === 0x7f)) run += pair ? value.slice(i, i + 2) : character;
    i += pair ? 2 : 1;
  }
  flush();
  if (saved.length > 0 || deeper > 0) fail(PARAGRAPH_NEVER_CLOSED);
  return { pieces, problem, ownDiameter };

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
      case "X":
        fail(paragraphNotLaidOut(letter));
        flush();
        pieces.push({ kind: "break" });
        return at + 1;
      case "f":
      case "F":
        return font(letter, at + 1);
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
    const toggle = TOGGLES[letter];
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
      fail(paragraphNotLaidOut(letter as NotLaidOutCode));
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
    const known = fontInfo(name) ? (name as Font) : undefined;
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
      } else if (character === "%" && value[k + 1] === "%" && PERCENT_CODES[value[k + 2] ?? ""]) {
        taken = PERCENT_CODES[value[k + 2]!]!;
        k += 3;
      } else k++;
      const wrong = characterProblem(taken.charCodeAt(0));
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
