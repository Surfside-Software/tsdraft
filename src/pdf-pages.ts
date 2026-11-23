// Reads a page's size from a PDF's bytes, for an underlay. A PDF is untrusted input: every offset
// and count is held to the bytes before it is read, the work is held to a budget in proportion to
// them, and nothing here recurses.
import { inflateCounted } from "./raster.ts";
import { isNumber, isString } from "./guards.ts";

/** The most bytes the streams of one file inflate to, all together. */
const INFLATE_LIMIT = 64 * 2 ** 20;

/** The most objects one call reads. */
const OBJECTS = 1_000_000;

/** The deepest page tree, and the deepest nesting of arrays and dictionaries, read. */
const DEPTH = 256;

/** The most objects the scan for `N G obj` finds when the cross-reference is broken. */
const SCANNED = 2 ** 18;

/** How far a chain of references to references, or of streams' lengths, is followed. */
const HOPS = 8;

/**
 * A PDF page's size in inches, across and down as a viewer shows it: what the drawing holds of an
 * underlay of the page, as `rasterSize` reads an image's pixels. `page` is the page's number from
 * 1, as a string such as `"2"` or a number. Undefined for any other `page`, a page past the
 * file's last, and a file it cannot read.
 *
 * The size is the page's CropBox cut to its MediaBox, or the MediaBox where the page has no
 * CropBox or one that misses it, each inherited from the page tree when the page has none. It is
 * in points over 72, times the page's `/UserUnit`, turned a quarter turn where the page's
 * `/Rotate`, also inherited, is 90 or 270. A `/Rotate` that is not a multiple of 90 counts as 0,
 * and a `/UserUnit` that is not a positive number as 1, as viewers read them.
 *
 * It reads cross-reference tables and streams, incremental updates, objects in object streams,
 * and streams compressed with FlateDecode, with or without a PNG predictor; a stream it must read
 * in any other filter gives undefined. Where the cross-reference is broken it scans the file for
 * its objects, as viewers do. An encrypted file reads where its pages and boxes are outside
 * object streams. The work is in proportion to the bytes: the streams inflate to 64 MB at most,
 * the scan finds 262,144 objects at most, and a page tree deeper than 256 or one that loops
 * gives undefined. It never throws.
 */
export function pdfPageSize(
  bytes: Uint8Array,
  page: string | number,
): readonly [width: number, height: number] | undefined {
  // A caller in plain JavaScript may give a page of another type.
  const wanted = isNumber(page)
    ? page
    : isString(page) && /^[1-9][0-9]{0,14}$/.test(page)
      ? Number(page)
      : NaN;

  if (!Number.isSafeInteger(wanted) || wanted < 1 || !(bytes instanceof Uint8Array)) {
    return undefined;
  }

  if (indexOf(bytes, PDF_HEADER, 0, Math.min(bytes.length, 1024)) < 0) return undefined;
  const fromTable = attempt(bytes, wanted, false);

  if (fromTable.size !== undefined || !fromTable.broken) return fromTable.size;

  return attempt(bytes, wanted, true).size;
}

/** A page's size, when one read found it, and whether the file was found broken. */
interface Attempt {
  size: readonly [number, number] | undefined;
  broken: boolean;
}

function attempt(bytes: Uint8Array, wanted: number, scan: boolean): Attempt {
  const file = new PdfFile(bytes);

  try {
    if (scan ? file.scan() : file.readTable()) {
      return { size: pageSize(file, wanted), broken: file.broken };
    }
  } catch (stop) {
    if (stop !== STOP) throw stop;
  }

  return { size: undefined, broken: file.broken };
}

/** Thrown inside to end a read that ran out of its budget; caught by `attempt`. */
const STOP: unique symbol = Symbol("stop");

// The values of a file. A string's content is never needed, so a string is `TEXT`.
interface Name {
  readonly name: string;
}

interface Ref {
  readonly ref: number;
  readonly gen: number;
}

interface Dict {
  readonly dict: Partial<Record<Key, Value>>;
}

const TEXT = { text: true } as const;

type Value = number | boolean | null | Name | Ref | Dict | typeof TEXT | Value[];

/** The keys this reader reads. A dictionary keeps no other, so no key of the file is hashed. */
const KEYS = [
  "BitsPerComponent",
  "Colors",
  "Columns",
  "Count",
  "CropBox",
  "DecodeParms",
  "Encrypt",
  "Filter",
  "First",
  "Index",
  "Kids",
  "Length",
  "MediaBox",
  "N",
  "Pages",
  "Predictor",
  "Prev",
  "Root",
  "Rotate",
  "Size",
  "Type",
  "UserUnit",
  "W",
  "XRefStm",
] as const;

type Key = (typeof KEYS)[number];

const KEY_NAMES: ReadonlySet<string> = new Set(KEYS);

const isKey = (name: string): name is Key => KEY_NAMES.has(name);

const isName = (v: Value | undefined): v is Name =>
  typeof v === "object" && v !== null && "name" in v;

const isRef = (v: Value | undefined): v is Ref => typeof v === "object" && v !== null && "ref" in v;

const isDict = (v: Value | undefined): v is Dict =>
  typeof v === "object" && v !== null && "dict" in v;

const isInt = (v: Value | undefined): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** An object as the file holds it: its value, and where its stream's bytes start if it has one. */
interface Obj {
  readonly value: Value;
  readonly stream?: { readonly data: Uint8Array; readonly at: number };
  /** Its generation, from the cross-reference; unknown for one the scan found. */
  readonly gen?: number;
}

/** Where an object is, and its generation; `free` where the newest section marks it free. */
type Entry =
  | { readonly at: number; readonly gen: number }
  | { readonly within: number; readonly index: number; readonly gen: 0 }
  | { readonly free: true };

interface ObjectStream {
  readonly data: Uint8Array;
  readonly first: number;
  readonly numbers: number[];
  readonly offsets: number[];
}

const PDF_HEADER = bytesOf("%PDF-");
const STARTXREF = bytesOf("startxref");
const ENDSTREAM = bytesOf("endstream");

function bytesOf(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

function indexOf(bytes: Uint8Array, word: Uint8Array, from: number, to: number): number {
  outer: for (let i = from; i + word.length <= to; i++) {
    for (let k = 0; k < word.length; k++) if (bytes[i + k] !== word[k]) continue outer;

    return i;
  }

  return -1;
}

const WHITE = (c: number): boolean =>
  c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;

const DELIMITER = (c: number): boolean =>
  c === 0x28 ||
  c === 0x29 ||
  c === 0x3c ||
  c === 0x3e ||
  c === 0x5b ||
  c === 0x5d ||
  c === 0x7b ||
  c === 0x7d ||
  c === 0x2f ||
  c === 0x25;

const REGULAR = (c: number): boolean => !WHITE(c) && !DELIMITER(c);
const DIGIT = (c: number): boolean => c >= 0x30 && c <= 0x39;

/** What a token is. */
const TOKEN = {
  end: 0,
  number: 1,
  name: 2,
  word: 3,
  open: 4,
  close: 5,
  dict: 6,
  undict: 7,
  text: 8,
} as const;

/** Spends the work of a read. Every byte a token or a scan passes costs one. */
class Budget {
  spent = 0;
  inflated = 0;
  readonly #base: number;
  constructor(length: number) {
    this.#base = length;
  }
  spend(n: number): void {
    this.spent += n;

    if (this.spent > 4 * (this.#base + this.inflated) + 2 ** 20) throw STOP;
  }
}

/** Reads the tokens of `data` from `at`, charging `budget`. */
class Lexer {
  readonly data: Uint8Array;
  readonly budget: Budget;
  at: number;
  kind: number = TOKEN.end;
  start = 0;
  number = 0;
  constructor(data: Uint8Array, at: number, budget: Budget) {
    this.data = data;
    this.at = at;
    this.budget = budget;
  }

  next(): number {
    const { data } = this;
    const from = Math.min(this.at, data.length);
    let at = from;

    for (;;) {
      while (at < data.length && WHITE(data[at]!)) at++;

      if (data[at] !== 0x25) break;

      while (at < data.length && data[at] !== 10 && data[at] !== 13) at++;
    }

    this.start = at;
    const c = data[at];
    let kind: number;

    if (c === undefined) kind = TOKEN.end;
    else if (c === 0x2f) {
      at++;

      while (at < data.length && REGULAR(data[at]!)) at++;
      kind = TOKEN.name;
    } else if (c === 0x5b || c === 0x5d) {
      at++;
      kind = c === 0x5b ? TOKEN.open : TOKEN.close;
    } else if ((c === 0x3c || c === 0x3e) && data[at + 1] === c) {
      at += 2;
      kind = c === 0x3c ? TOKEN.dict : TOKEN.undict;
    } else if (c === 0x3c) {
      while (at < data.length && data[at] !== 0x3e) at++;
      kind = at < data.length ? TOKEN.text : TOKEN.end;
      at++;
    } else if (c === 0x28) {
      let depth = 0;

      for (; at < data.length; at++) {
        const b = data[at];

        if (b === 0x5c) at++;
        else if (b === 0x28) depth++;
        else if (b === 0x29 && --depth === 0) break;
      }

      kind = at < data.length ? TOKEN.text : TOKEN.end;
      at++;
    } else if (DIGIT(c) || c === 0x2b || c === 0x2d || c === 0x2e) {
      while (at < data.length && REGULAR(data[at]!)) at++;
      this.number = at - this.start <= 64 ? Number(latin1(data, this.start, at)) : NaN;
      kind = Number.isFinite(this.number) ? TOKEN.number : TOKEN.word;
    } else {
      at++;

      while (at < data.length && REGULAR(data[at]!)) at++;
      kind = TOKEN.word;
    }

    this.at = Math.min(at, data.length);
    this.budget.spend(this.at - from + 1);
    this.kind = kind;

    return kind;
  }

  /** Whether the token just read is the keyword `word`. */
  is(word: string): boolean {
    if (this.kind !== TOKEN.word || this.at - this.start !== word.length) return false;

    for (let i = 0; i < word.length; i++) {
      if (this.data[this.start + i] !== word.charCodeAt(i)) return false;
    }

    return true;
  }

  /** The name just read, with its `#xx` codes, or "" for one longer than a PDF name may be. */
  name(): string {
    const { data } = this;

    if (this.at - this.start > 128) return "";
    let name = "";

    for (let i = this.start + 1; i < this.at; i++) {
      const hex = data[i] === 0x23 ? Number.parseInt(latin1(data, i + 1, i + 3), 16) : NaN;

      if (Number.isInteger(hex) && i + 2 < this.at) {
        name += String.fromCharCode(hex);
        i += 2;
      } else name += String.fromCharCode(data[i]!);
    }

    return name;
  }

  /**
   * The value that starts at the next token, read without recursion, or undefined where the
   * bytes hold none. A number followed by another and `R` is a reference.
   */
  value(): Value | undefined {
    const stack: { items: Value[]; dict: boolean }[] = [];

    for (;;) {
      let value: Value;
      const kind = this.next();

      if (kind === TOKEN.number) {
        value = this.number;

        if (stack.length === 0 && isInt(value)) {
          const back = this.at;
          const gen = this.next() === TOKEN.number ? this.number : -1;

          if (isInt(gen) && this.next() === TOKEN.word && this.is("R")) {
            value = { ref: value, gen };
          } else this.at = back;
        }
      } else if (kind === TOKEN.name) value = { name: this.name() };
      else if (kind === TOKEN.text) value = TEXT;
      else if (kind === TOKEN.open || kind === TOKEN.dict) {
        if (stack.length >= DEPTH) return undefined;
        stack.push({ items: [], dict: kind === TOKEN.dict });
        continue;
      } else if (kind === TOKEN.close || kind === TOKEN.undict) {
        const top = stack.pop();

        if (top === undefined || top.dict !== (kind === TOKEN.undict)) return undefined;

        if (top.dict) {
          if (top.items.length % 2 !== 0) return undefined;
          const dict: Partial<Record<Key, Value>> = {};

          for (let i = 0; i < top.items.length; i += 2) {
            const key = top.items[i];

            if (!isName(key)) return undefined;

            if (isKey(key.name)) dict[key.name] = top.items[i + 1]!;
          }

          value = { dict };
        } else value = top.items;
      } else if (kind === TOKEN.word && this.is("R") && stack.length > 0) {
        const items = stack[stack.length - 1]!.items;
        const [n, g] = items.slice(-2);

        if (items.length < 2 || !isInt(n) || !isInt(g)) return undefined;
        items.length -= 2;
        value = { ref: n, gen: g };
      } else if (kind === TOKEN.word && this.is("true")) value = true;
      else if (kind === TOKEN.word && this.is("false")) value = false;
      else if (kind === TOKEN.word && this.is("null")) value = null;
      else return undefined;

      if (stack.length === 0) return value;
      stack[stack.length - 1]!.items.push(value);
    }
  }
}

function latin1(data: Uint8Array, from: number, to: number): string {
  let text = "";

  for (let i = from; i < to && i < data.length; i++) text += String.fromCharCode(data[i]!);

  return text;
}

/** A section of the cross-reference: a table's rows in the file, or a stream's rows. */
interface Section {
  /**
   * Each run of rows, by its first object's number: that number, its count and its first row.
   * Where runs overlap, an object is looked for in the last that starts at or before it.
   */
  readonly runs: number[];
  /** A table's rows lie in the file; a stream's in its bytes, `widths` wide. */
  readonly rows: Uint8Array | undefined;
  readonly widths: readonly [number, number, number];
  /** Whether only its entries of objects in object streams count, as in a scan. */
  readonly streamsOnly: boolean;
  /** A hybrid file's `/XRefStm`, read before its table, whose free rows leave the table's. */
  readonly hybrid?: boolean;
}

/** A PDF's objects, found through its cross-reference or by a scan of its bytes. */
class PdfFile {
  readonly bytes: Uint8Array;
  readonly budget: Budget;
  /** Set when an object the file points to is not where it says, or the table cannot be read. */
  broken = false;
  encrypted = false;
  root: Value | undefined;
  readonly #sections: Section[] = [];
  readonly #scanned = new Map<number, number>();
  readonly #objects = new Map<number, Obj | null>();
  readonly #streams = new Map<number, ObjectStream | null>();
  #ends: number[] | undefined;
  #read = 0;
  #depth = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.budget = new Budget(bytes.length);
  }

  lexer(at: number, data: Uint8Array = this.bytes): Lexer {
    return new Lexer(data, at, this.budget);
  }

  /** Reads the cross-reference from `startxref` back through each `/Prev`. */
  readTable(): boolean {
    const { bytes } = this;
    const from = Math.max(0, bytes.length - 4096);
    this.budget.spend(bytes.length - from);
    let found = -1;

    for (let i = bytes.length - STARTXREF.length; i >= from && found < 0; i--) {
      if (indexOf(bytes, STARTXREF, i, i + STARTXREF.length) === i) found = i;
    }

    const lexer = this.lexer(found + STARTXREF.length);

    if (found < 0 || lexer.next() !== TOKEN.number || !isInt(lexer.number)) {
      this.broken = true;

      return false;
    }

    const seen: number[] = [];
    let at: number | undefined = lexer.number;

    while (at !== undefined) {
      if (seen.includes(at) || seen.length >= 1024) break;
      seen.push(at);
      const trailer = this.#section(at);

      if (trailer === undefined) {
        this.broken = true;

        return false;
      }

      this.root ??= trailer.Root;

      if (trailer.Encrypt !== undefined) this.encrypted = true;
      const hybrid = trailer.XRefStm;

      if (isInt(hybrid) && !seen.includes(hybrid)) {
        seen.push(hybrid);

        if (this.#section(hybrid) === undefined) this.broken = true;
        else {
          // A hybrid table marks free what its stream puts in object streams, so the stream
          // comes first.
          const stream = this.#sections.pop()!;
          this.#sections.splice(this.#sections.length - 1, 0, { ...stream, hybrid: true });
        }
      }

      at = isInt(trailer.Prev) ? trailer.Prev : undefined;
    }

    if (this.root === undefined) this.broken = true;

    return this.root !== undefined;
  }

  /** Reads the section at `at`, a table or a stream, and gives its trailer. */
  #section(at: number): Partial<Record<Key, Value>> | undefined {
    if (at >= this.bytes.length) return undefined;
    const lexer = this.lexer(at);
    lexer.next();

    if (lexer.is("xref")) {
      const runs: number[] = [];

      for (;;) {
        const kind = lexer.next();

        if (kind === TOKEN.word && lexer.is("trailer")) break;
        const start = lexer.number;

        if (kind !== TOKEN.number || !isInt(start) || lexer.next() !== TOKEN.number)
          return undefined;
        const count = lexer.number;

        if (!isInt(count)) return undefined;
        let row = lexer.at;

        while (row < this.bytes.length && WHITE(this.bytes[row]!)) row++;
        runs.push(start, count, row);
        this.budget.spend(3);
        lexer.at = row + 20 * count;
      }

      const trailer = lexer.value();

      if (!isDict(trailer)) return undefined;
      this.#sections.push({
        runs: this.#sorted(runs),
        rows: undefined,
        widths: [0, 0, 0],
        streamsOnly: false,
      });

      return trailer.dict;
    }

    const obj = this.#parse(at, undefined);
    const section = obj === undefined ? undefined : this.#streamSection(obj, false);

    if (section === undefined || !isDict(obj?.value)) return undefined;
    this.#sections.push(section);

    return obj.value.dict;
  }

  /** A cross-reference stream's rows, read from its dictionary's direct values. */
  #streamSection(obj: Obj, streamsOnly: boolean): Section | undefined {
    if (!isDict(obj.value) || obj.stream === undefined) return undefined;
    const d = obj.value.dict;

    if (!isName(d.Type) || d.Type.name !== "XRef" || !Array.isArray(d.W) || d.W.length !== 3) {
      return undefined;
    }

    const widths = d.W.map((w) => (isInt(w) && w <= 8 ? w : -1));

    if (widths.includes(-1) || widths[0]! + widths[1]! + widths[2]! === 0) return undefined;
    const index = d.Index ?? (isInt(d.Size) ? [0, d.Size] : undefined);

    if (!Array.isArray(index) || index.length % 2 !== 0) return undefined;
    const rows = this.streamBytes(obj, true);

    if (rows === undefined) return undefined;
    const runs: number[] = [];
    let row = 0;

    for (let i = 0; i < index.length; i += 2) {
      const [start, count] = [index[i], index[i + 1]];

      if (!isInt(start) || !isInt(count)) return undefined;
      runs.push(start, count, row);
      row += count;
    }

    this.budget.spend(index.length);

    return {
      runs: this.#sorted(runs),
      rows,
      widths: [widths[0]!, widths[1]!, widths[2]!],
      streamsOnly,
    };
  }

  /** Runs of three numbers, sorted by the first. */
  #sorted(runs: number[]): number[] {
    const order = Array.from({ length: runs.length / 3 }, (_, i) => i);
    this.budget.spend(order.length * (1 + Math.log2(1 + order.length)));
    order.sort((a, b) => runs[3 * a]! - runs[3 * b]!);

    return order.flatMap((i) => [runs[3 * i]!, runs[3 * i + 1]!, runs[3 * i + 2]!]);
  }

  /**
   * Finds the objects by their `N G obj` headers, the last of each number winning, when the
   * cross-reference cannot be read. Objects in object streams are found through the
   * cross-reference streams the scan finds, and the catalog through the last trailer, the last
   * cross-reference stream or the last catalog that names one.
   */
  scan(): boolean {
    const { bytes } = this;
    this.budget.spend(bytes.length);
    const trailers: number[] = [];
    const xrefs: number[] = [];
    const catalogs: number[] = [];
    let header = -1;

    for (let i = 0; i < bytes.length; i++) {
      const c = bytes[i]!;

      if (c === 0x6f && this.#word(i, "obj") && i > 0 && WHITE(bytes[i - 1]!)) {
        const at = headerAt(bytes, i);

        if (at === undefined) continue;
        header = at.start;

        if (this.#scanned.has(at.number) || this.#scanned.size < SCANNED) {
          this.#scanned.set(at.number, at.start);
        }
      } else if (c === 0x74 && this.#word(i, "trailer")) trailers.push(i + 7);
      else if (c === 0x2f && this.#word(i + 1, "XRef")) once(xrefs, header);
      else if (c === 0x2f && this.#word(i + 1, "Catalog")) once(catalogs, header);
      else if (c === 0x2f && this.#word(i + 1, "Encrypt")) this.encrypted = true;
    }

    for (const at of xrefs.reverse()) {
      const obj = this.#parse(at, undefined);
      const section = obj === undefined ? undefined : this.#streamSection(obj, true);

      if (section === undefined || !isDict(obj?.value)) continue;
      this.#sections.push(section);
      this.root ??= obj.value.dict.Root;
    }

    for (const at of trailers.reverse()) {
      if (this.root !== undefined) break;
      const trailer = this.lexer(at).value();

      if (isDict(trailer) && trailer.dict.Root !== undefined) this.root = trailer.dict.Root;
    }

    for (const at of catalogs.reverse()) {
      if (this.root !== undefined) break;
      const obj = this.#parse(at, undefined);

      if (isDict(obj?.value) && obj.value.dict.Pages !== undefined) this.root = obj.value;
    }

    return this.root !== undefined;
  }

  /** Whether the bytes at `i` are `word`, with no regular character after it. */
  #word(i: number, word: string): boolean {
    const { bytes } = this;

    for (let k = 0; k < word.length; k++) if (bytes[i + k] !== word.charCodeAt(k)) return false;
    const after = bytes[i + word.length];

    return after === undefined || !REGULAR(after);
  }

  /** Where object `n` is, from the newest section that has it. */
  #entry(n: number): Entry | undefined {
    const scanned = this.#scanned.get(n);

    if (scanned !== undefined) return { at: scanned, gen: -1 };

    for (const section of this.#sections) {
      const { runs, rows, widths } = section;
      let [lo, hi] = [0, runs.length / 3];

      while (lo < hi) {
        const mid = (lo + hi) >>> 1;

        if (runs[3 * mid]! <= n) lo = mid + 1;
        else hi = mid;
      }

      this.budget.spend(1 + Math.log2(1 + lo));

      for (let i = 3 * (lo - 1); i >= 0; i = -1) {
        const [start, count, first] = [runs[i]!, runs[i + 1]!, runs[i + 2]!];

        if (n >= start + count) break;

        if (rows === undefined) {
          const lexer = this.lexer(first + 20 * (n - start));
          const at = lexer.next() === TOKEN.number ? lexer.number : -1;
          const gen = lexer.next() === TOKEN.number ? lexer.number : -1;
          const ok = isInt(gen) && lexer.next() === TOKEN.word;

          if (!ok || !isInt(at) || !(lexer.is("n") || lexer.is("f"))) {
            this.broken = true;

            return undefined;
          }

          // A free entry hides what older sections held of the number.
          return lexer.is("n") ? { at, gen } : { free: true };
        }

        const width = widths[0] + widths[1] + widths[2];
        const row = (first + n - start) * width;

        if (row + width > rows.length) break;

        const field = (from: number, w: number): number => {
          let v = 0;

          for (let k = 0; k < w; k++) v = v * 256 + rows[row + from + k]!;

          return v;
        };

        const type = widths[0] === 0 ? 1 : field(0, widths[0]);
        const [a, b] = [field(widths[0], widths[1]), field(widths[0] + widths[1], widths[2])];

        if (type === 0 && !section.streamsOnly && !section.hybrid) return { free: true };

        if (type === 1 && !section.streamsOnly) return { at: a, gen: b };

        if (type === 2) return { within: a, index: b, gen: 0 };
        break;
      }
    }

    return undefined;
  }

  /**
   * Object `n` of generation `gen`, or undefined where the file has none it can read, where the
   * newest section marks it free, or where it is of another generation: a reference to any of
   * those is null.
   */
  object(n: number, gen = 0): Obj | undefined {
    let cached = this.#objects.get(n);

    if (cached === undefined) {
      if (++this.#read > OBJECTS) throw STOP;
      this.#objects.set(n, null);
      const entry = this.#entry(n);
      let obj: Obj | undefined;

      if (entry === undefined) this.broken = true;
      // A free entry or one of another generation is null, and a sign of a table off by a row,
      // which the scan reads past if the page is not found.
      else if ("free" in entry) this.broken = true;
      else if ("at" in entry) {
        obj = this.#parse(entry.at, n);

        if (obj !== undefined && entry.gen >= 0) obj = { ...obj, gen: entry.gen };
      } else if (!this.encrypted) obj = this.#fromStream(n, entry.within, entry.index);
      cached = obj ?? null;
      this.#objects.set(n, cached);
    }

    if (cached === null) return undefined;

    if (cached.gen === undefined || cached.gen === gen) return cached;
    this.broken = true;

    return undefined;
  }

  /** The object whose `N G obj` header is at `at`, which must be object `n` when it is given. */
  #parse(at: number, n: number | undefined): Obj | undefined {
    const lexer = this.lexer(at);
    const number = lexer.next() === TOKEN.number ? lexer.number : -1;

    if (
      at >= this.bytes.length ||
      !isInt(number) ||
      (n !== undefined && number !== n) ||
      lexer.next() !== TOKEN.number ||
      lexer.next() !== TOKEN.word ||
      !lexer.is("obj")
    ) {
      this.broken = true;

      return undefined;
    }

    const value = lexer.value();

    if (value === undefined) {
      this.broken = true;

      return undefined;
    }

    const after = lexer.at;

    if (!isDict(value) || lexer.next() !== TOKEN.word || !lexer.is("stream")) {
      lexer.at = after;

      return { value };
    }

    let start = lexer.at;

    if (this.bytes[start] === 13) start++;

    if (this.bytes[start] === 10) start++;

    return { value, stream: { data: this.bytes, at: start } };
  }

  /** Object `n` at `index` of the object stream `within`. */
  #fromStream(n: number, within: number, index: number): Obj | undefined {
    let stream = this.#streams.get(within);

    if (stream === undefined) {
      this.#streams.set(within, null);
      const entry = this.#entry(within);
      const obj = entry !== undefined && "at" in entry ? this.#parse(entry.at, within) : undefined;

      const d: Partial<Record<Key, Value>> =
        obj !== undefined && isDict(obj.value) ? obj.value.dict : {};

      // Each stream's numbers may be references into other streams: a chain is followed as far
      // as a chain of references is.
      if (this.#depth >= HOPS) return undefined;
      this.#depth++;
      let count: Value | undefined;
      let first: Value | undefined;

      try {
        [count, first] = [this.resolve(d.N), this.resolve(d.First)];
      } finally {
        this.#depth--;
      }

      const type = d.Type;
      const isStream = isName(type) && type.name === "ObjStm";
      const data = obj !== undefined && isStream ? this.streamBytes(obj) : undefined;

      if (data === undefined || !isInt(count) || !isInt(first) || first > data.length) {
        return undefined;
      }

      const lexer = this.lexer(0, data.subarray(0, first));
      const numbers: number[] = [];
      const offsets: number[] = [];

      while (numbers.length < count) {
        if (lexer.next() !== TOKEN.number || !isInt(lexer.number)) break;
        const number = lexer.number;

        if (lexer.next() !== TOKEN.number || !isInt(lexer.number)) break;
        numbers.push(number);
        offsets.push(lexer.number);
      }

      stream = { data, first, numbers, offsets };
      this.#streams.set(within, stream);
    }

    if (stream === null || stream === undefined) return undefined;
    let i = stream.numbers[index] === n ? index : -1;

    if (i < 0) {
      this.budget.spend(stream.numbers.length);
      i = stream.numbers.indexOf(n);
    }

    if (i < 0) return undefined;
    const value = this.lexer(stream.first + stream.offsets[i]!, stream.data).value();

    return value === undefined ? undefined : { value };
  }

  /**
   * A stream's bytes, decoded, or undefined for a filter other than FlateDecode. A
   * cross-reference stream's dictionary is read `direct`, by its own values only, since the
   * objects its references name are found through it.
   */
  streamBytes(obj: Obj, direct = false): Uint8Array | undefined {
    if (obj.stream === undefined || !isDict(obj.value) || this.#depth >= HOPS) return undefined;
    const d = obj.value.dict;
    const { data, at } = obj.stream;
    this.#depth++;

    try {
      return this.#decode(d, data, at, direct);
    } finally {
      this.#depth--;
    }
  }

  #decode(
    d: Partial<Record<Key, Value>>,
    data: Uint8Array,
    at: number,
    direct: boolean,
  ): Uint8Array | undefined {
    const get = (v: Value | undefined): Value | undefined =>
      direct ? (isRef(v) ? undefined : v) : this.resolve(v);

    const length = get(d.Length);
    let end = isInt(length) ? at + length : -1;

    if (end < 0 || end > data.length || !this.#endsStream(end)) {
      end = this.#endstream(at);

      if (end < 0) return undefined;

      if (data[end - 1] === 10) end--;

      if (data[end - 1] === 13) end--;
    }

    const raw = data.subarray(at, Math.max(at, end));
    const filters = single(get(d.Filter));

    if (filters === null) return raw;
    const filter = get(filters);

    if (!isName(filter) || filter.name !== "FlateDecode") return undefined;
    const limit = INFLATE_LIMIT - this.budget.inflated;

    if (limit <= 0) return undefined;
    // Inflating reads its input, which streams that overlap would read again for nothing.
    this.budget.spend(raw.length);
    const { bytes: out, written } = inflateCounted(raw, limit);
    this.budget.inflated += written;

    if (out === undefined) return undefined;
    const parms = get(single(get(d.DecodeParms)) ?? undefined);
    const p = isDict(parms) ? parms.dict : {};
    const predictor = get(p.Predictor) ?? 1;

    if (predictor === 1) return out;

    if (!isNumber(predictor) || predictor < 10 || predictor > 15) return undefined;

    const [colors, bits, columns] = [
      get(p.Colors) ?? 1,
      get(p.BitsPerComponent) ?? 8,
      get(p.Columns) ?? 1,
    ];

    return unpredict(out, colors, bits, columns);
  }

  /** Whether `endstream` follows `at`, after the line's end. */
  #endsStream(at: number): boolean {
    const lexer = this.lexer(at);

    return lexer.next() === TOKEN.word && lexer.is("endstream");
  }

  /** Where the first `endstream` at or after `at` starts, found from one scan of the file. */
  #endstream(at: number): number {
    if (this.#ends === undefined) {
      this.budget.spend(this.bytes.length);
      this.#ends = [];

      for (let i = indexOf(this.bytes, ENDSTREAM, 0, this.bytes.length); i >= 0;) {
        this.#ends.push(i);
        i = indexOf(this.bytes, ENDSTREAM, i + 1, this.bytes.length);
      }
    }

    const ends = this.#ends;
    let [lo, hi] = [0, ends.length];

    while (lo < hi) {
      const mid = (lo + hi) >>> 1;

      if (ends[mid]! < at) lo = mid + 1;
      else hi = mid;
    }

    return ends[lo] ?? -1;
  }

  /** The value `v` refers to, following a chain of references a few deep. */
  resolve(v: Value | undefined): Value | undefined {
    for (let hops = 0; isRef(v); hops++) {
      if (hops >= HOPS) return undefined;
      v = this.object(v.ref, v.gen)?.value;
    }

    return v;
  }
}

/** Adds the object at `at` to `list` unless it ends the list already. */
function once(list: number[], at: number): void {
  if (at >= 0 && list[list.length - 1] !== at) list.push(at);
}

/** The one element of a one-element array, the value itself, or null for none. */
function single(v: Value | undefined): Value | undefined {
  if (v === undefined || v === null) return null;

  if (!Array.isArray(v)) return v;

  if (v.length === 0) return null;

  return v.length === 1 ? v[0] : undefined;
}

/** The header `N G obj` whose `obj` is at `i`: the object's number and where the header starts. */
function headerAt(bytes: Uint8Array, i: number): { number: number; start: number } | undefined {
  let j = i - 1;

  const skip = (test: (c: number) => boolean, most: number): number => {
    const from = j;

    while (j >= 0 && from - j < most && test(bytes[j]!)) j--;

    return from - j;
  };

  if (skip(WHITE, 8) === 0 || skip(DIGIT, 6) === 0 || skip(WHITE, 8) === 0) return undefined;
  const end = j + 1;

  if (skip(DIGIT, 11) === 0 || (j >= 0 && REGULAR(bytes[j]!))) return undefined;
  const number = Number(latin1(bytes, j + 1, end));

  return Number.isSafeInteger(number) ? { number, start: j + 1 } : undefined;
}

/** A stream's bytes with its PNG predictor undone, row by row. */
function unpredict(
  data: Uint8Array,
  colors: Value | undefined,
  bits: Value | undefined,
  columns: Value | undefined,
): Uint8Array | undefined {
  if (!isInt(colors) || colors < 1 || colors > 32 || !isInt(columns) || columns < 1)
    return undefined;

  if (bits !== 1 && bits !== 2 && bits !== 4 && bits !== 8 && bits !== 16) return undefined;
  const pixel = Math.max(1, Math.ceil((colors * bits) / 8));
  const width = Math.ceil((colors * bits * columns) / 8);

  if (width + 1 > data.length) return new Uint8Array(0);
  const rows = Math.floor(data.length / (width + 1));
  const out = new Uint8Array(rows * width);

  for (let r = 0; r < rows; r++) {
    const filter = data[r * (width + 1)]!;
    const from = r * (width + 1) + 1;
    const at = r * width;

    for (let x = 0; x < width; x++) {
      const raw = data[from + x]!;
      const left = x >= pixel ? out[at + x - pixel]! : 0;
      const up = r > 0 ? out[at - width + x]! : 0;
      const corner = r > 0 && x >= pixel ? out[at - width + x - pixel]! : 0;
      let v: number;

      if (filter === 0) v = raw;
      else if (filter === 1) v = raw + left;
      else if (filter === 2) v = raw + up;
      else if (filter === 3) v = raw + ((left + up) >>> 1);
      else if (filter === 4) {
        const p = left + up - corner;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
        v = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : corner);
      } else return undefined;
      out[at + x] = v & 255;
    }
  }

  return out;
}

/** A box `[x0 y0 x1 y1]` in points, put in order, or undefined where it is not four numbers. */
function boxOf(file: PdfFile, v: Value | undefined): [number, number, number, number] | undefined {
  const box = file.resolve(v);

  if (!Array.isArray(box) || box.length !== 4) return undefined;
  const [a, b, c, d] = box.map((x) => file.resolve(x));
  const finite = (x: Value | undefined): x is number => typeof x === "number" && Number.isFinite(x);

  if (!finite(a) || !finite(b) || !finite(c) || !finite(d)) return undefined;

  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

/**
 * Walks the page tree in order, counting its pages, to page `wanted`, and carries down the boxes
 * and the turn each node on the way gives its pages. It trusts no `/Count`, which a file edited in
 * place may hold stale, follows no `/Parent`, and enters no node twice. An entry that is null is
 * none, so a page takes its parent's.
 */
function pageSize(file: PdfFile, wanted: number): readonly [number, number] | undefined {
  const catalog = file.resolve(file.root);

  if (!isDict(catalog)) return undefined;

  interface Inherited {
    media?: Value;
    crop?: Value;
    rotate?: Value;
  }

  const given = (v: Value | undefined): v is Value => v !== undefined && file.resolve(v) != null;
  const entered = new Set<number>();
  const rootRef = catalog.dict.Pages;

  if (isRef(rootRef)) entered.add(rootRef.ref);
  // A frame for each node on the way down: its kids and the next to enter, so the walk holds no
  // more than the depth of the tree and reads a kid only when it comes to it.
  const frames: { kids: Value[]; next: number; inherited: Inherited }[] = [];
  let left = wanted;
  let node: Value | undefined = file.resolve(rootRef);
  let above: Inherited = {};

  for (;;) {
    if (node !== undefined) {
      if (!isDict(node)) {
        file.broken = true;

        return undefined;
      }

      const d: Partial<Record<Key, Value>> = node.dict;

      const inherited: Inherited = { ...above };

      if (given(d.MediaBox)) inherited.media = d.MediaBox;

      if (given(d.CropBox)) inherited.crop = d.CropBox;

      if (given(d.Rotate)) inherited.rotate = d.Rotate;

      const kind = file.resolve(d.Type);
      const isNode = isName(kind) ? kind.name === "Pages" : d.Kids !== undefined;

      if (!isNode) {
        if (--left === 0) return sizeOf(file, d, inherited);
      } else {
        const kids = file.resolve(d.Kids);

        if (!Array.isArray(kids)) {
          file.broken = true;

          return undefined;
        }

        if (frames.length >= DEPTH) return undefined;
        file.budget.spend(kids.length);
        frames.push({ kids, next: 0, inherited });
      }

      node = undefined;
    }

    const top = frames[frames.length - 1];

    if (top === undefined) return undefined;

    if (top.next >= top.kids.length) {
      frames.pop();
      continue;
    }

    const kid = top.kids[top.next++];

    if (isRef(kid)) {
      if (entered.has(kid.ref)) return undefined;
      entered.add(kid.ref);
    }

    node = file.resolve(kid);

    if (node === undefined || node === null) {
      file.broken = true;

      return undefined;
    }

    above = top.inherited;
  }
}

function sizeOf(
  file: PdfFile,
  page: Partial<Record<Key, Value>>,
  inherited: { media?: Value; crop?: Value; rotate?: Value },
): readonly [number, number] | undefined {
  const media = boxOf(file, inherited.media);

  if (media === undefined) return undefined;
  const crop = boxOf(file, inherited.crop);
  let [x0, y0, x1, y1] = media;

  if (crop !== undefined) {
    const cut: [number, number, number, number] = [
      Math.max(x0, crop[0]),
      Math.max(y0, crop[1]),
      Math.min(x1, crop[2]),
      Math.min(y1, crop[3]),
    ];

    if (cut[2] > cut[0] && cut[3] > cut[1]) [x0, y0, x1, y1] = cut;
  }

  const unit = file.resolve(page.UserUnit);
  const scale = isNumber(unit) && Number.isFinite(unit) && unit > 0 ? unit : 1;
  const rotate = file.resolve(inherited.rotate);

  const turn = isNumber(rotate) && Number.isInteger(rotate) && rotate % 90 === 0 ? rotate : 0;

  const [w, h] = [((x1 - x0) / 72) * scale, ((y1 - y0) / 72) * scale];
  const size: [number, number] = Math.abs(turn % 180) === 90 ? [h, w] : [w, h];

  return size.every((x) => Number.isFinite(x) && x > 0) ? size : undefined;
}
