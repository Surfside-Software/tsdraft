// The document of a DXF: where each record of the file is, in bytes, with its kind, its section,
// its handle, its owner and the handles it refers to, and where each header variable is. A
// record runs from its group 0 to the next, so the records copied in order give the file back.
// It holds offsets and no bytes of the file, and reads the bytes as they arrive.

/** The most records, references, names and header variables a document lists. */
const MOST_RECORDS = 1 << 22;
const MOST_REFERENCES = 1 << 23;
const MOST_NAMES = 1 << 16;

/** How many bytes of a line are read: enough for a group code, a kind, a name or a handle. */
const HEAD = 64;

export interface DxfDocument {
  /** The file's length in bytes. */
  readonly bytes: number;
  /** How many records it lists. */
  readonly count: number;
  /**
   * Where each record starts, in bytes. They run back to back from 0 to `bytes`. Bytes before
   * the first group 0 are a record of no kind.
   */
  readonly starts: Float64Array;
  /** Each record's kind, from its group 0, and its section, as places in `names`. */
  readonly kinds: Uint16Array;
  readonly sections: Uint16Array;
  /** The kinds, sections and header variables' names, each once. */
  readonly names: readonly string[];
  /**
   * True when the file holds more records, references, names or header variables than a
   * document lists. Such a document lists the file's first part, and no edit takes it.
   */
  readonly capped: boolean;
  /** How long record `i` is, in bytes. */
  length(i: number): number;
  /** Record `i`'s handle, group 5 or 105 for a dimension style, as hexadecimal digits. */
  handle(i: number): string | undefined;
  /** The handle of record `i`'s owner: its first group 330 outside the groups 102 opens. */
  owner(i: number): string | undefined;
  /** Each handle record `i` refers to, with the group code that holds it, in the file's order. */
  references(i: number): { readonly code: number; readonly handle: string }[];
  /** Each header variable: its name, such as `$HANDSEED`, and where its groups are. */
  header(): { readonly name: string; readonly start: number; readonly length: number }[];
}

/** True for a group code whose value the DXF Reference gives as a handle of another object. */
const refersBy = (code: number): boolean =>
  (code >= 320 && code <= 369) ||
  (code >= 390 && code <= 399) ||
  code === 480 ||
  code === 481 ||
  code === 1005;

/** A handle's two halves, or undefined for a value that is not 1 to 16 hexadecimal digits. */
function halves(value: string): [high: number, low: number] | undefined {
  if (!/^[0-9A-Fa-f]{1,16}$/.test(value)) return undefined;
  return [
    value.length > 8 ? Number.parseInt(value.slice(0, -8), 16) : 0,
    Number.parseInt(value.slice(-8), 16),
  ];
}

const hex = (high: number, low: number): string =>
  high === 0
    ? low.toString(16).toUpperCase()
    : high.toString(16).toUpperCase() + low.toString(16).toUpperCase().padStart(8, "0");

/** A typed array twice as long, holding what `array` holds. */
function grown<T extends Float64Array | Uint32Array | Uint16Array | Uint8Array>(array: T): T {
  const next = new (array.constructor as new (length: number) => T)(array.length * 2);
  next.set(array);
  return next;
}

export class DxfDocumentReader {
  #bytes = 0;
  /** The current line: where it starts, its first bytes, and whether it holds a value. */
  #lineStart = 0;
  #head: number[] = [];
  #value = false;
  #code = Number.NaN;
  #codeStart = 0;
  #ended = false;
  #capped = false;

  #count = 0;
  #starts = new Float64Array(1024);
  #kinds = new Uint16Array(1024);
  #sections = new Uint16Array(1024);
  /** Bit 1: a handle; bit 2: an owner. */
  #has = new Uint8Array(1024);
  #handles = new Uint32Array(2048);
  #owners = new Uint32Array(2048);
  #firstReference = new Uint32Array(1025);
  #referenceCount = 0;
  #referenceCodes = new Uint16Array(1024);
  #references = new Uint32Array(2048);
  /** The names, from the empty one, which is a record's kind and section where it has none. */
  readonly #names: string[] = [""];
  readonly #nameIndex = new Map<string, number>([["", 0]]);
  readonly #header: { name: string; start: number; length: number }[] = [];

  #section = 0;
  #sectionNext = false;
  #inGroup = false;

  /** Reads more of the file. */
  push(chunk: Uint8Array): void {
    let at = 0;
    while (at < chunk.length) {
      const end = chunk.indexOf(10, at);
      const stop = end < 0 ? chunk.length : end;
      for (let i = at; i < stop && this.#head.length < HEAD; i++) this.#head.push(chunk[i]!);
      if (end < 0) break;
      this.#line(this.#bytes + end + 1);
      at = end + 1;
    }
    this.#bytes += chunk.length;
  }

  /** Ends the file and gives its document. */
  end(): DxfDocument {
    if (this.#head.length > 0) this.#line(this.#bytes);
    if (this.#count === 0) this.#record(0, "");
    this.#closeVariable(this.#bytes);
    this.#firstReference[this.#count] = this.#referenceCount;
    const count = this.#count;
    const starts = this.#starts.slice(0, count);
    const bytes = this.#bytes;
    const has = this.#has;
    const handles = this.#handles;
    const owners = this.#owners;
    const firstReference = this.#firstReference;
    const codes = this.#referenceCodes;
    const references = this.#references;
    const header = this.#header;
    return {
      bytes,
      count,
      starts,
      kinds: this.#kinds.slice(0, count),
      sections: this.#sections.slice(0, count),
      names: this.#names,
      capped: this.#capped,
      length: (i) => (i + 1 < count ? starts[i + 1]! : bytes) - starts[i]!,
      handle: (i) => ((has[i]! & 1) !== 0 ? hex(handles[2 * i]!, handles[2 * i + 1]!) : undefined),
      owner: (i) => ((has[i]! & 2) !== 0 ? hex(owners[2 * i]!, owners[2 * i + 1]!) : undefined),
      references: (i) => {
        const out: { code: number; handle: string }[] = [];
        for (let k = firstReference[i]!; k < firstReference[i + 1]!; k++) {
          out.push({ code: codes[k]!, handle: hex(references[2 * k]!, references[2 * k + 1]!) });
        }
        return out;
      },
      header: () => header.map((variable) => ({ ...variable })),
    };
  }

  /** A line ends before `next`, where the next line starts. */
  #line(next: number): void {
    const head = this.#head;
    const start = this.#lineStart;
    this.#head = [];
    this.#lineStart = next;
    if (this.#ended || this.#capped) return;
    // A byte order mark at the start of the file is no part of its first group code.
    const from = start === 0 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
    let text = "";
    for (let i = from; i < head.length; i++) text += String.fromCharCode(head[i]!);
    if (text.endsWith("\r")) text = text.slice(0, -1);
    if (!this.#value) {
      this.#code = /^\s*-?\d{1,6}\s*$/.test(text) ? Number(text) : Number.NaN;
      this.#codeStart = start;
      this.#value = true;
      return;
    }
    this.#value = false;
    this.#group(this.#code, text, this.#codeStart);
  }

  #name(value: string): number {
    let index = this.#nameIndex.get(value);
    if (index === undefined) {
      if (this.#names.length >= MOST_NAMES) {
        this.#capped = true;
        return 0;
      }
      index = this.#names.length;
      this.#names.push(value);
      this.#nameIndex.set(value, index);
    }
    return index;
  }

  #record(start: number, kind: string): void {
    if (this.#count >= MOST_RECORDS) {
      this.#capped = true;
      return;
    }
    if (this.#count === this.#starts.length) {
      this.#starts = grown(this.#starts);
      this.#kinds = grown(this.#kinds);
      this.#sections = grown(this.#sections);
      this.#has = grown(this.#has);
      this.#handles = grown(this.#handles);
      this.#owners = grown(this.#owners);
      const first = new Uint32Array(this.#starts.length + 1);
      first.set(this.#firstReference);
      this.#firstReference = first;
    }
    const i = this.#count++;
    this.#starts[i] = start;
    this.#kinds[i] = this.#name(kind);
    this.#sections[i] = this.#section;
    this.#firstReference[i] = this.#referenceCount;
    this.#inGroup = false;
  }

  #closeVariable(end: number): void {
    const last = this.#header.at(-1);
    if (last && last.length < 0) last.length = end - last.start;
  }

  #group(code: number, value: string, start: number): void {
    const trimmed = value.trim();
    if (code === 0) {
      // Bytes before the first group 0 are a record of their own.
      if (this.#count === 0 && start > 0) this.#record(0, "");
      if (value === "ENDSEC") this.#closeVariable(start);
      this.#record(start, value);
      if (value === "SECTION") this.#sectionNext = true;
      else if (value === "ENDSEC") this.#section = this.#name("");
      else if (trimmed === "EOF") this.#ended = true;
      return;
    }
    if (this.#count === 0 || Number.isNaN(code)) return;
    const i = this.#count - 1;
    if (this.#sectionNext && code === 2) {
      this.#sectionNext = false;
      this.#section = this.#name(trimmed.toUpperCase());
      this.#sections[i] = this.#section;
      return;
    }
    const header = this.#names[this.#section] === "HEADER";
    if (header && code === 9) {
      this.#closeVariable(start);
      if (this.#header.length >= MOST_NAMES) this.#capped = true;
      else this.#header.push({ name: trimmed, start, length: -1 });
      return;
    }
    if (code === 102) {
      this.#inGroup = trimmed.startsWith("{");
      return;
    }
    const kind = this.#names[this.#kinds[i]!];
    const own = !header && (kind === "DIMSTYLE" ? code === 105 : code === 5);
    if (own && (this.#has[i]! & 1) === 0) {
      const parts = halves(trimmed);
      if (parts) {
        this.#has[i] = this.#has[i]! | 1;
        [this.#handles[2 * i], this.#handles[2 * i + 1]] = parts;
      }
      return;
    }
    if (!refersBy(code)) return;
    const parts = halves(trimmed);
    if (!parts) return;
    if (code === 330 && !this.#inGroup && (this.#has[i]! & 2) === 0) {
      this.#has[i] = this.#has[i]! | 2;
      [this.#owners[2 * i], this.#owners[2 * i + 1]] = parts;
    }
    if (this.#referenceCount >= MOST_REFERENCES) {
      this.#capped = true;
      return;
    }
    if (this.#referenceCount === this.#referenceCodes.length) {
      this.#referenceCodes = grown(this.#referenceCodes);
      this.#references = grown(this.#references);
    }
    const k = this.#referenceCount++;
    this.#referenceCodes[k] = code;
    [this.#references[2 * k], this.#references[2 * k + 1]] = parts;
  }
}
