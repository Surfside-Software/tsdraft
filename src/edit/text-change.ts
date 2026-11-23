// A text changed in place: the value a `TextChange` makes of a single-line text's value or a
// paragraph's, keeping every code it does not replace, and where a justified text starts after its
// value or its height changes. `lintEdit`, `editedRead` and both writers make the same value.
import { nearestFont } from "../fonts.ts";
import { isString } from "../guards.ts";
import { layerKey } from "../layers.ts";
import { layoutText } from "../measure.ts";
import { parseParagraph, PERCENT_CODES } from "../paragraph-codes.ts";
import type { Point } from "../drawing.ts";
import type { ReadTextPlacement, ReadTextStyle } from "../read/model.ts";
import type { TextChange } from "./model.ts";

/** A piece of a paragraph's value: characters as it reads, or a code that draws none. */
interface Token {
  /** What it reads as: a character, a stack's parts, or empty for a code. */
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** For a code: a brace, or a code that changes the characters after it until its group ends. */
  readonly code?: "open" | "close" | "lasting";
}

/** The codes that change the characters after them until their group ends. */
const LASTING = new Set([
  "f",
  "F",
  "H",
  "C",
  "c",
  "Q",
  "W",
  "T",
  "A",
  "p",
  "L",
  "l",
  "O",
  "o",
  "K",
  "k",
]);

/** The codes of these letters end at a `;`. */
const ENDED = new Set(["f", "F", "H", "C", "c", "Q", "W", "T", "A", "p"]);

/**
 * A paragraph's value as it reads, piece by piece: each character with where it is held, `\P`
 * and `\N` each as a line's end, a stack as its parts with its separator, and the codes that draw
 * nothing between.
 */
function tokens(value: string): Token[] {
  const out: Token[] = [];
  const n = value.length;
  let i = 0;

  while (i < n) {
    const c = value[i]!;

    if (c === "{" || c === "}") {
      out.push({ text: "", start: i, end: i + 1, code: c === "{" ? "open" : "close" });
      i++;
      continue;
    }

    // A `%%` code reads as what it draws.
    const drawn =
      c === "%" && value[i + 1] === "%" ? PERCENT_CODES.get(value[i + 2] ?? "") : undefined;

    if (drawn !== undefined) {
      out.push({ text: drawn, start: i, end: i + 3 });
      i += 3;
      continue;
    }

    if (c !== "\\" || i + 1 >= n) {
      out.push({ text: c, start: i, end: i + 1 });
      i++;
      continue;
    }

    const letter = value[i + 1]!;

    if (letter === "P" || letter === "N") {
      out.push({ text: "\n", start: i, end: i + 2 });
      i += 2;
    } else if (letter === "~") {
      out.push({ text: " ", start: i, end: i + 2 });
      i += 2;
    } else if (letter === "\\" || letter === "{" || letter === "}") {
      out.push({ text: letter, start: i, end: i + 2 });
      i += 2;
    } else if (
      (letter === "U" || letter === "u") &&
      value[i + 2] === "+" &&
      /^[0-9A-Fa-f]{4}$/.test(value.slice(i + 3, i + 7))
    ) {
      out.push({
        text: String.fromCharCode(Number.parseInt(value.slice(i + 3, i + 7), 16)),
        start: i,
        end: i + 7,
      });
      i += 7;
    } else if (letter === "S") {
      // A stack reads as its two parts with its separator, and is replaced whole or not at all.
      let k = i + 2;
      let text = "";

      while (k < n && value[k] !== ";") {
        if (value[k] === "\\" && k + 1 < n) {
          text += value[k + 1];
          k += 2;
        } else text += value[k++];
      }

      out.push({ text, start: i, end: Math.min(n, k + 1) });
      i = Math.min(n, k + 1);
    } else if (ENDED.has(letter)) {
      const end = value.indexOf(";", i + 2);
      const stop = end < 0 ? n : end + 1;
      out.push({ text: "", start: i, end: stop, code: "lasting" });
      i = stop;
    } else if (LASTING.has(letter)) {
      out.push({ text: "", start: i, end: i + 2, code: "lasting" });
      i += 2;
    } else {
      out.push({ text: "", start: i, end: i + 2 });
      i += 2;
    }
  }

  return out;
}

/** Whether a paragraph holds a column break, `\N`. */
export function breaksColumn(value: string): boolean {
  return tokens(value).some((t) => value.slice(t.start, t.end) === "\\N");
}

/** How a paragraph reads, codes left out and each `\P` a line's end. */
export function paragraphReads(value: string): string {
  return tokens(value)
    .map((t) => t.text)
    .join("");
}

/** Every place `from` is in `text`, up to two. */
function places(text: string, from: string): number[] {
  const out: number[] = [];
  let at = text.indexOf(from);

  while (at >= 0 && out.length < 2) {
    out.push(at);
    at = text.indexOf(from, at + 1);
  }

  return out;
}

/** A replacement as a paragraph holds it: `\`, `{` and `}` escaped, and each line's end `\P`. */
export const paragraphText = (to: string): string =>
  to.replaceAll("\\", "\\\\").replaceAll("{", "\\{").replaceAll("}", "\\}").replaceAll("\n", "\\P");

/**
 * True for what a value cannot hold: a control character but a tab, and half of a pair of
 * surrogates, which no file's encoding writes.
 */
const controls = (value: string): boolean =>
  /[\u0000-\u0008\u000a-\u001f\u007f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(
    value,
  );

/**
 * The value a change makes of a single-line text's value, `%%` codes as written, or why it cannot:
 * `from` is found once and only once.
 */
export function changedLine(value: string, change: TextChange): string | { problem: string } {
  if (isString(change)) {
    if (controls(change))
      return {
        problem: "a single-line text cannot hold a line's end or another control character",
      };

    return change;
  }

  const [from, to] = change.replace;

  if (controls(to))
    return { problem: "a single-line text cannot hold a line's end or another control character" };
  const found = places(value, from);

  if (found.length !== 1)
    return {
      problem: `${JSON.stringify(from.slice(0, 64))} is found ${found.length === 0 ? "nowhere" : "more than once"} in ${JSON.stringify(value.slice(0, 64))}: a replacement is made in one place`,
    };

  const made = value.slice(0, found[0]) + to + value.slice(found[0]! + from.length);

  return controls(made) ? { problem: "the replacement would split a pair of surrogates" } : made;
}

/**
 * The value a change makes of a paragraph's value, or why it cannot. A whole value is taken with
 * its codes, and refused where `parseParagraph` does not lay it out. A replacement finds `from` in
 * the characters as the paragraph reads, once and only once; `to` takes the format in force at the
 * first character it replaces. A code that opens and closes inside the replaced part goes with it,
 * and one that would change the characters after it is refused.
 */
export function changedParagraph(value: string, change: TextChange): string | { problem: string } {
  if (isString(change)) {
    if (controls(change))
      return {
        problem:
          "a paragraph's value holds no line's end, other control character but a tab, or half of a pair of surrogates: write \\P for a line's end",
      };
    const problem = parseParagraph(change).problem;

    return problem === undefined ? change : { problem: `the new value: ${problem}` };
  }

  const [from, to] = change.replace;

  if (controls(to.replaceAll("\n", "")))
    return { problem: "the replacement holds a control character or half of a pair of surrogates" };
  const list = tokens(value);
  const reads = list.map((t) => t.text).join("");
  const found = places(reads, from);

  if (found.length !== 1)
    return {
      problem: `${JSON.stringify(from.slice(0, 64))} is found ${found.length === 0 ? "nowhere" : "more than once"} in the paragraph as it reads: a replacement is made in one place`,
    };
  const first = found[0]!;
  const last = first + from.length;
  // The tokens the replaced characters are in, by where each one's text starts.
  let at = 0;
  let a = -1;
  let b = -1;

  for (let k = 0; k < list.length; k++) {
    const t = list[k]!;

    if (t.text === "") continue;
    const end = at + t.text.length;

    if (a < 0 && end > first) {
      if (at !== first)
        return {
          problem: "the replacement starts inside a stacked fraction: replace the stack whole",
        };
      a = k;
    }

    if (a >= 0 && end >= last) {
      if (end !== last)
        return {
          problem: "the replacement ends inside a stacked fraction: replace the stack whole",
        };
      b = k;
      break;
    }

    at = end;
  }

  // The codes between: a brace opened inside closes inside, and a lasting code is inside a group.
  let depth = 0;

  for (let k = a; k <= b; k++) {
    const code = list[k]!.code;

    if (code === "open") depth++;
    else if (code === "close") {
      if (depth === 0)
        return { problem: "the replacement takes a } that closes a group opened before it" };
      depth--;
    } else if (code === "lasting" && depth === 0)
      return {
        problem: `the replaced part holds the code ${JSON.stringify(value.slice(list[k]!.start, Math.min(list[k]!.end, list[k]!.start + 16)))}, which changes the characters after it`,
      };
  }

  // The braces right after it that close the groups it opened go with it.
  let close = b;

  while (depth > 0 && list[close + 1]?.text === "" && list[close + 1]?.code === "close") {
    close++;
    depth--;
  }

  if (depth !== 0) return { problem: "the replacement takes a { whose group goes on after it" };
  const start = list[a]!.start;
  const end = list[close]!.end;

  const made = value.slice(0, start) + paragraphText(to) + value.slice(end);

  return controls(made.replaceAll("\t", ""))
    ? { problem: "the replacement would split a pair of surrogates" }
    : made;
}

/** A text's placement as a change leaves it: its first point, its height and its width factor. */
export interface Placed {
  readonly stored: Point;
  readonly height: number;
  readonly widthFactor: number;
}

/** The text style of a read by its name, as the leading CAD app compares names. */
export function styleOf(styles: readonly ReadTextStyle[], name: string): ReadTextStyle | undefined {
  const key = layerKey(name);

  return styles.find((s) => layerKey(s.name) === key);
}

/**
 * Where a single-line text starts after its value or its height changes, with the height of an
 * aligned one and the width factor of a fitted one, worked out from the widths of its font's
 * characters, or undefined where they do not give it exactly. A text on the left of its baseline
 * keeps its point.
 */
export function placedText(
  text: ReadTextPlacement,
  value: string,
  height: number,
  styles: readonly ReadTextStyle[],
): Placed | undefined {
  const widthFactor = text.widthFactor ?? 1;
  const { align = "left", valign = "baseline" } = text;

  if (align === "left" && valign === "baseline")
    return { stored: text.stored, height, widthFactor };

  if (text.backward === true || text.upsideDown === true || text.alignAt === undefined)
    return undefined;
  const style = styleOf(styles, text.style);

  if (style === undefined) return undefined;
  const font = nearestFont(style.family ?? style.font ?? "");

  if (!font.exact) return undefined;
  const turn = (text.rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)];

  if (align === "aligned" || align === "fit") {
    // Between its first point, which it keeps, and its alignment point.
    const unit = layoutText({
      value,
      height: 1,
      font: font.font,
      widthFactor: 1,
      align: "left",
      valign: "baseline",
    });

    if (unit.approximate || !(unit.advance > 0)) return undefined;
    const length = Math.hypot(text.alignAt[0] - text.stored[0], text.alignAt[1] - text.stored[1]);

    return align === "aligned"
      ? { stored: text.stored, height: length / (unit.advance * widthFactor), widthFactor }
      : { stored: text.stored, height, widthFactor: length / (unit.advance * height) };
  }

  // Middle, in an SHX font, is centered both ways as middle-center is; a TrueType font's sits by its ink.
  if (align === "middle" && !font.font.endsWith(".shx")) return undefined;

  const layout =
    align === "middle"
      ? layoutText({
          value,
          height,
          font: font.font,
          widthFactor,
          align: "center",
          valign: "middle",
        })
      : layoutText({ value, height, font: font.font, widthFactor, align, valign });

  if (layout.approximate) return undefined;
  const [along, up] = [layout.end - layout.advance, layout.baseline];

  const stored: Point = [
    text.alignAt[0] + along * cos - up * sin,
    text.alignAt[1] + along * sin + up * cos,
  ];

  return Number.isFinite(stored[0]) && Number.isFinite(stored[1])
    ? { stored, height, widthFactor }
    : undefined;
}
