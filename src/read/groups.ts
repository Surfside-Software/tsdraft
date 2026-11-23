// The groups of an ASCII DXF, from its bytes as they arrive. A group is two lines: an integer
// code, then a value. Text is UTF-8 from the R2007 format, AC1021, on, and in the code page
// `$DWGCODEPAGE` names before it, so the bytes wait until the header has said which.
import { Sha256 } from "../sha256.ts";

/** Thrown for a file the reader cannot read at all, such as a binary DXF. */
export class ReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadError";
  }
}

/** The WHATWG label of each code page the leading CAD app names, past the ones that are `windows-NNNN`. */
const CODE_PAGES: ReadonlyMap<string, string> = new Map([
  ["ANSI_874", "windows-874"],
  ["ANSI_932", "shift_jis"],
  ["ANSI_936", "gbk"],
  ["ANSI_949", "euc-kr"],
  ["ANSI_950", "big5"],
  ["DOS437", "ibm437"],
  ["DOS850", "ibm850"],
  ["ISO8859_1", "iso-8859-1"],
  ["ISO8859_2", "iso-8859-2"],
  ["ISO8859_5", "iso-8859-5"],
  ["ISO8859_7", "iso-8859-7"],
  ["ISO8859_9", "windows-1254"],
  ["UTF8", "utf-8"],
]);

/**
 * The characters of bytes 0x80 to 0xFF in the two DOS code pages, which no `TextDecoder` has.
 * Bytes below 0x80 are ASCII in both.
 */
const DOS: ReadonlyMap<string, string> = new Map([
  [
    "ibm437",
    "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0",
  ],
  [
    "ibm850",
    "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00ad±‗¾¶§÷¸°¨·¹³²■\u00a0",
  ],
]);

interface Decoder {
  decode(bytes?: Uint8Array, options?: { stream?: boolean }): string;
}

/** A decoder of a single-byte code page from its upper half. */
function singleByte(upper: string): Decoder {
  return {
    decode(bytes = new Uint8Array()) {
      let text = "";

      for (let i = 0; i < bytes.length; i += 8192) {
        const piece = bytes.subarray(i, i + 8192);
        let part = "";

        for (const byte of piece)
          part += byte < 0x80 ? String.fromCharCode(byte) : upper[byte - 0x80];
        text += part;
      }

      return text;
    },
  };
}

const decoderOf = (label: string): Decoder => {
  const upper = DOS.get(label);

  return upper !== undefined ? singleByte(upper) : new TextDecoder(label);
};

/** The encoding of a file's text, from its `$ACADVER` and `$DWGCODEPAGE`. */
export function encodingOf(version: string | undefined, codepage: string | undefined): string {
  if (version === undefined || version.toUpperCase() >= "AC1021") return "utf-8";
  const page = (codepage ?? "").toUpperCase();
  const windows = /^ANSI_(125\d)$/.exec(page);
  const label = windows ? `windows-${windows[1]}` : (CODE_PAGES.get(page) ?? "windows-1252");

  try {
    decoderOf(label);

    return label;
  } catch {
    return "windows-1252";
  }
}

/** How many bytes may wait for the header to name the encoding. */
const HEADER_WAIT = 16 * 1024 * 1024;

const BINARY = "AutoCAD Binary DXF";

/** The longest line read. A DXF's lines are short: a string value holds at most 2,049. */
const MAX_LINE = 1 << 20;

/** What a read of the whole input gives once it ends: its SHA-256 and its length in bytes. */
export interface ReadEnd {
  readonly sha256: string;
  readonly bytes: number;
}

/**
 * Splits a DXF into groups and hands each to `group`. Feed it the bytes with `push`, then call
 * `end`. It hashes every byte, and holds at most a line of text besides the bytes that wait for
 * the header.
 */
export class GroupReader {
  readonly #group: (code: number, value: string) => void;
  readonly #hash = new Sha256();
  #bytes = 0;
  #waiting: Uint8Array[] | undefined = [];
  #scanned = "";
  #searched = 0;
  #decoder: Decoder | undefined;
  #carry = "";
  #code: string | undefined;
  #line = 0;
  #ended = false;
  version: string | undefined;
  codepage: string | undefined;
  encoding = "utf-8";

  readonly #text8: boolean;

  /** With `utf8`, the bytes are UTF-8 whatever the header says, as a string's are. */
  constructor(group: (code: number, value: string) => void, utf8 = false) {
    this.#group = group;
    this.#text8 = utf8;
  }

  push(chunk: Uint8Array): void {
    this.#bytes += chunk.length;
    this.#hash.update(chunk);

    if (this.#waiting) {
      this.#waiting.push(chunk);
      this.#scanned += latin1(chunk);

      if (this.#scanned.startsWith(BINARY)) {
        throw new ReadError(
          "This is a binary DXF, which tsdraft does not read. Save it as an ASCII DXF",
        );
      }

      if (!this.#headerSaid() && this.#scanned.length < HEADER_WAIT) return;
      this.#start();
    } else if (!this.#ended) this.#text(this.#decoder!.decode(chunk, { stream: true }));
  }

  /** Ends the input. Returns the SHA-256 and the length of what was read. */
  end(): ReadEnd {
    if (this.#waiting) {
      if (this.#scanned.startsWith(BINARY)) {
        throw new ReadError(
          "This is a binary DXF, which tsdraft does not read. Save it as an ASCII DXF",
        );
      }

      this.#headerSaid();
      this.#start();
    }

    this.#text(this.#decoder!.decode());

    if (this.#carry !== "") this.#text("\n");

    if (this.#code !== undefined && this.#code.trim() !== "") {
      throw new ReadError(
        `The file ends after group code ${JSON.stringify(this.#code.trim().slice(0, 80))}, with no value`,
      );
    }

    return { sha256: this.#hash.digest(), bytes: this.#bytes };
  }

  /** True once the header has given its version and code page, or has ended without them. */
  #headerSaid(): boolean {
    // Each search starts a little before the text it has not seen, so the whole is read once.
    const text = this.#scanned.slice(Math.max(0, this.#searched - 64));
    this.#searched = this.#scanned.length;
    this.version ??= /\$ACADVER\r?\n *1\r?\n([^\r\n]*)\r?\n/.exec(text)?.[1]?.trim();
    this.codepage ??= /\$DWGCODEPAGE\r?\n *3\r?\n([^\r\n]*)\r?\n/.exec(text)?.[1]?.trim();

    return (
      (this.version !== undefined && this.codepage !== undefined) ||
      /\n *0\r?\nENDSEC\r?\n/.test(text)
    );
  }

  #start(): void {
    this.encoding = this.#text8 ? "utf-8" : encodingOf(this.version, this.codepage);
    this.#decoder = decoderOf(this.encoding);
    const waiting = this.#waiting!;
    this.#waiting = undefined;
    this.#scanned = "";

    for (const chunk of waiting) this.#text(this.#decoder.decode(chunk, { stream: true }));
  }

  #tooLong(line: number): never {
    throw new ReadError(`Line ${line} is longer than ${MAX_LINE} characters`);
  }

  #text(text: string): void {
    if (this.#ended) return;

    // Text with no line end only grows the line it is in, so the line is split once.
    if (!text.includes("\n")) {
      this.#carry += text;

      if (this.#carry.length > MAX_LINE) this.#tooLong(this.#line + 1);

      return;
    }

    const lines = (this.#carry + text).split("\n");
    this.#carry = lines.pop()!;

    for (let line of lines) {
      this.#line++;

      if (line.length > MAX_LINE) this.#tooLong(this.#line);

      if (line.endsWith("\r")) line = line.slice(0, -1);

      if (this.#code === undefined) {
        this.#code = line;
        continue;
      }

      if (!/^\s*-?\d{1,6}\s*$/.test(this.#code)) {
        throw new ReadError(
          `Line ${this.#line - 1} should hold a group code, an integer, and holds something else`,
        );
      }

      const code = Number(this.#code);
      this.#code = undefined;
      this.#group(code, line);

      // What follows the end, such as the ^Z an old program wrote, is no part of the file.
      if (code === 0 && line.trim() === "EOF") {
        this.#ended = true;

        return;
      }
    }

    if (this.#carry.length > MAX_LINE) this.#tooLong(this.#line + 1);
  }
}

/** `String.fromCharCode` called with each byte of an array as an argument. */
interface FromBytes {
  apply(thisArg: undefined, bytes: Uint8Array): string;
}

const fromBytes: FromBytes = String.fromCharCode;

function latin1(bytes: Uint8Array): string {
  let text = "";

  for (let i = 0; i < bytes.length; i += 8192) {
    text += fromBytes.apply(undefined, bytes.subarray(i, i + 8192));
  }

  return text;
}

/**
 * A value with its carets worked out: a caret and a space is a caret, and a caret before a
 * character from `@` on is the control character 64 below it, so `^J` is a line feed.
 */
export function carets(value: string): string {
  if (!value.includes("^")) return value;

  return value.replace(/\^([\s\S])/g, (whole, c: string) => {
    if (c === " ") return "^";
    const code = c.charCodeAt(0);

    return code >= 0x40 && code < 0x80 ? String.fromCharCode(code - 0x40) : whole;
  });
}

/** The decoder of each code page `\M+NXXXX` names by its digit N, or none where there is none. */
const MULTIBYTE: Record<string, Decoder | null | undefined> = {};
const MULTIBYTE_LABELS = ["", "shift_jis", "big5", "euc-kr", "", "gbk"];

/** The character `\M+NXXXX` stands for, or undefined when it stands for none. */
function multibyte(page: number, hex: string): string | undefined {
  const code = Number.parseInt(hex, 16);
  const [high, low] = [code >> 8, code & 0xff];

  if (code === 0) return undefined;

  if (high === 0 && low < 0x80) return String.fromCharCode(low);
  let decoder = MULTIBYTE[page];

  if (decoder === undefined) {
    try {
      decoder = MULTIBYTE_LABELS[page]
        ? new TextDecoder(MULTIBYTE_LABELS[page], { fatal: true })
        : null;
    } catch {
      decoder = null;
    }

    MULTIBYTE[page] = decoder;
  }

  if (decoder === null) return undefined;

  try {
    const text = decoder.decode(new Uint8Array(high === 0 ? [low] : [high, low]));

    return [...text].length === 1 ? text : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One pass of the leading CAD app's escapes over a value, left to right, reading nothing a pass
 * makes again: `\U+XXXX` becomes its character, but for `\U+0000`, and half of a surrogate pair
 * becomes U+FFFD; with `multibyte`, `\M+NXXXX` becomes the character of code page N it stands
 * for, where the platform has that code page.
 */
function pass(value: string, withMultibyte: boolean): string {
  const pattern = withMultibyte
    ? /\\[Uu]\+([0-9A-Fa-f]{4})|\\[Mm]\+([1-5])([0-9A-Fa-f]{4})/g
    : /\\[Uu]\+([0-9A-Fa-f]{4})/g;

  return value.replace(pattern, (whole, hex?: string, page?: string, bytes?: string) => {
    if (hex !== undefined) {
      const code = Number.parseInt(hex, 16);

      if (code === 0) return whole;

      return code >= 0xd800 && code <= 0xdfff ? "\ufffd" : String.fromCharCode(code);
    }

    return multibyte(Number(page), bytes!) ?? whole;
  });
}

const escaped = (value: string): boolean => /\\[UuMm]\+/.test(value);

/**
 * A name or a path as the leading CAD app holds it from a DXF: its carets worked out, then one pass
 * of `\U+XXXX`, which a file before the R2007 format uses for a character its code page lacks.
 */
export function unescaped(value: string): string {
  const plain = carets(value);

  return escaped(plain) ? pass(plain, false) : plain;
}

/**
 * The value of an `MTEXT`, a dimension's text or a multileader's note as the leading CAD app holds
 * it from a DXF: its carets worked out, then one pass of `\U+XXXX` and `\M+NXXXX` together.
 */
export function textOnce(value: string): string {
  const plain = carets(value);

  return escaped(plain) ? pass(plain, true) : plain;
}

/**
 * The value of a `TEXT`, an attribute or an attribute definition as the leading CAD app holds it
 * from a DXF: its carets worked out, then a pass of `\U+XXXX`, then a pass of `\U+XXXX` and
 * `\M+NXXXX` together. What the first pass makes is read by the second,
 * and nothing is read a third time.
 */
export function textTwice(value: string): string {
  const plain = carets(value);

  return escaped(plain) ? pass(pass(plain, false), true) : plain;
}

/** How a binary DXF starts. */
export { BINARY };
