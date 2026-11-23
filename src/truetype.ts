// A TrueType font file, read to be embedded in a PDF and cut to the glyphs the PDF uses. The
// file is untrusted input: every offset and count is held to the bytes before it is read, each
// glyph is read once, and a font whose glyphs are built of each other in a cycle is refused.

/** A TrueType font a PDF can embed, read from its file. */
export interface TrueType {
  /** The font's PostScript name, cut to the characters a PDF name may hold. */
  readonly name: string;
  /** The family name the file gives itself: name 1 of its `name` table, in English. */
  readonly family: string | undefined;
  readonly unitsPerEm: number;
  /** The box around every glyph, in font units: x min, y min, x max, y max. */
  readonly box: readonly [number, number, number, number];
  readonly ascent: number;
  readonly descent: number;
  /** The slant of its upright strokes, in degrees counterclockwise from vertical. */
  readonly italicAngle: number;
  /**
   * The height of its capitals that its `OS/2` table states, as a share of the em, or undefined
   * for a font that states none.
   */
  readonly capHeight: number | undefined;
  /** The glyph of a character, by its code point: 0 for one the font lacks. */
  glyph(code: number): number;
  /** How far a glyph moves the pen, in font units. */
  advance(glyph: number): number;
  /**
   * A font program of the glyphs given, which must start with glyph 0 and hold none twice: the
   * glyph at index `i` of `glyphs` is glyph `i` of the program. The glyphs a composite glyph is
   * built of follow them. It holds the tables a PDF reader needs to draw the glyphs, and no
   * map from characters, since the PDF gives each glyph by its number.
   */
  subset(glyphs: readonly number[]): Uint8Array;
}

/** The deepest a composite glyph may nest others. Fonts nest two or three deep. */
const MAX_DEPTH = 16;

/** Thrown inside `readTrueType` for a file it does not take, with the reason. */
class Refused extends Error {}

/** A table's place in the file. */
interface Table {
  readonly at: number;
  readonly length: number;
}

/**
 * Reads a TrueType font file for embedding, or says why a PDF cannot embed it: it is not a
 * TrueType font, a table runs past the end of the file or holds counts its bytes cannot, a glyph
 * is malformed or built of itself, or its licence bits forbid embedding it or cutting it to a
 * subset. Every glyph is read once here, so that a file it takes can always be cut.
 */
export function readTrueType(bytes: Uint8Array): TrueType | string {
  if (!(bytes instanceof Uint8Array)) return "it is not the bytes of a file";

  try {
    return read(bytes);
  } catch (error) {
    if (error instanceof Refused) return error.message;

    // A read past the end of the view, which the checks below are meant to make impossible.
    if (error instanceof RangeError) return "it is shorter than its tables say";
    throw error;
  }
}

function read(bytes: Uint8Array): TrueType {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // A copy of its own of bytes of the file, since `slice` on a subclass of `Uint8Array`, such as
  // Node's, can share the file's memory.
  const copy = (from: number, to: number): Uint8Array => {
    const out = new Uint8Array(to - from);
    out.set(bytes.subarray(from, to));

    return out;
  };

  const size = bytes.byteLength;
  const u16 = (at: number): number => view.getUint16(at);
  const i16 = (at: number): number => view.getInt16(at);
  const u32 = (at: number): number => view.getUint32(at);

  if (size < 12) throw new Refused("it is too short to be a font");
  const version = u32(0);

  if (version === 0x4f54544f) throw new Refused("its outlines are PostScript, not TrueType");

  if (version === 0x74746366) throw new Refused("it is a collection of fonts");

  if (version !== 0x00010000 && version !== 0x74727565) {
    throw new Refused("it is not a TrueType font");
  }

  const count = u16(4);

  if (12 + count * 16 > size) throw new Refused("its list of tables runs past the end of the file");
  const tables = new Map<string, Table>();

  for (let i = 0; i < count; i++) {
    const entry = 12 + i * 16;
    const tag = String.fromCharCode(...bytes.subarray(entry, entry + 4));

    if (!tables.has(tag)) tables.set(tag, { at: u32(entry + 8), length: u32(entry + 12) });
  }

  /** The table of a tag, at least `least` bytes long and inside the file, or undefined. */
  const optional = (tag: string, least = 0): Table | undefined => {
    const table = tables.get(tag);

    if (table === undefined) return undefined;

    if (table.at > size || table.length > size - table.at) {
      throw new Refused(`its table ${tag} runs past the end of the file`);
    }

    if (table.length < least) throw new Refused(`its table ${tag} is too short`);

    return table;
  };

  const required = (tag: string, least = 0): Table => {
    const table = optional(tag, least);

    if (table === undefined) throw new Refused(`it has no table ${tag}`);

    return table;
  };

  const head = required("head", 54);
  const unitsPerEm = u16(head.at + 18);

  if (unitsPerEm < 16 || unitsPerEm > 16384) {
    throw new Refused(`its em of ${unitsPerEm} units is not one TrueType allows`);
  }

  const box: [number, number, number, number] = [
    i16(head.at + 36),
    i16(head.at + 38),
    i16(head.at + 40),
    i16(head.at + 42),
  ];

  const longOffsets = i16(head.at + 50);

  if (longOffsets !== 0 && longOffsets !== 1) {
    throw new Refused("its table head names no known form of glyph offsets");
  }

  const hhea = required("hhea", 36);
  const maxp = required("maxp", 6);
  const glyphs = u16(maxp.at + 4);

  if (glyphs === 0) throw new Refused("it has no glyph");
  const metrics = u16(hhea.at + 34);

  if (metrics === 0 || metrics > glyphs) {
    throw new Refused("its table hhea counts more metrics than it has glyphs, or none");
  }

  const hmtx = required("hmtx", 4 * metrics + 2 * (glyphs - metrics));
  const loca = required("loca", (glyphs + 1) * (longOffsets ? 4 : 2));
  const glyf = required("glyf");
  // The tables of a font's hinting, which its glyphs' instructions call.
  const hinting: (readonly [string, Table])[] = [];

  for (const tag of ["cvt ", "fpgm", "prep"]) {
    const table = optional(tag);

    if (table !== undefined) hinting.push([tag, table]);
  }

  // Each glyph's bytes, and where in them a composite names the glyphs it is built of.
  const starts = new Uint32Array(glyphs + 1);

  for (let g = 0; g <= glyphs; g++) {
    starts[g] = longOffsets ? u32(loca.at + 4 * g) : 2 * u16(loca.at + 2 * g);
  }

  const parts = new Map<number, number[]>();

  for (let g = 0; g < glyphs; g++) {
    const [start, end] = [starts[g]!, starts[g + 1]!];

    if (end < start || end > glyf.length) {
      throw new Refused(`its glyph ${g} lies outside its table glyf`);
    }

    if (end === start) continue;
    const named = readGlyph(view, glyf.at + start, end - start, glyphs, g);

    if (named.length > 0) parts.set(g, named);
  }

  composedDepth(view, parts);

  // The licence bits of `OS/2`: an installable, editable or preview font may be embedded, a
  // restricted one may not, nor one that allows bitmaps alone or forbids a subset.
  const os2 = optional("OS/2");

  if (os2 !== undefined && os2.length >= 10) {
    const permits = u16(os2.at + 8);

    if ((permits & 0x2) !== 0 && (permits & 0xc) === 0) {
      throw new Refused("its licence restricts it from being embedded");
    }

    if ((permits & 0x200) !== 0)
      throw new Refused("its licence lets it be embedded as bitmaps alone");

    if ((permits & 0x100) !== 0) throw new Refused("its licence forbids a subset of it");
  }

  const post = optional("post");

  const italicAngle =
    post !== undefined && post.length >= 8 ? view.getInt32(post.at + 4) / 65536 : 0;

  const glyph = characterMap(view, required("cmap", 4), glyphs);
  const names = readNames(view, optional("name"));
  // `OS/2` states the height of the capitals from its version 2.
  const stated = os2 !== undefined && os2.length >= 90 && u16(os2.at) >= 2 ? i16(os2.at + 88) : 0;
  const lastAdvance = u16(hmtx.at + 4 * (metrics - 1));

  const advance = (g: number): number =>
    g >= 0 && g < metrics ? u16(hmtx.at + 4 * g) : g < glyphs ? lastAdvance : 0;

  const bearing = (g: number): number =>
    g < metrics ? i16(hmtx.at + 4 * g + 2) : i16(hmtx.at + 4 * metrics + 2 * (g - metrics));

  return {
    name: names.postScript ?? fromFamily(names.family),
    family: names.family,
    unitsPerEm,
    box,
    ascent: i16(hhea.at + 4),
    descent: i16(hhea.at + 6),
    italicAngle: Number.isFinite(italicAngle) ? italicAngle : 0,
    capHeight: stated > 0 ? stated / unitsPerEm : undefined,
    glyph,
    advance,
    subset(wanted) {
      const order = [...wanted];

      if (order[0] !== 0) throw new RangeError("A subset starts with glyph 0");
      const index = new Map<number, number>();
      order.forEach((g, i) => {
        if (!Number.isInteger(g) || g < 0 || g >= glyphs || index.has(g)) {
          throw new RangeError(`A subset cannot hold glyph ${g} of a font of ${glyphs} glyphs`);
        }

        index.set(g, i);
      });

      // The glyphs a composite is built of join the subset, each once.
      for (let i = 0; i < order.length; i++) {
        for (const at of parts.get(order[i]!) ?? []) {
          const part = u16(at);

          if (!index.has(part)) {
            index.set(part, order.length);
            order.push(part);
          }
        }
      }

      const pieces: Uint8Array[] = [];
      const offsets: number[] = [0];
      let length = 0;

      for (const g of order) {
        const [start, end] = [starts[g]!, starts[g + 1]!];
        const data = copy(glyf.at + start, glyf.at + end);

        // A composite names its parts by their new numbers.
        for (const at of parts.get(g) ?? []) {
          const part = index.get(u16(at))!;
          const there = at - glyf.at - start;
          data[there] = part >> 8;
          data[there + 1] = part & 0xff;
        }

        const padded = (data.length + 3) & ~3;
        pieces.push(data);

        if (padded > data.length) pieces.push(new Uint8Array(padded - data.length));
        length += padded;
        offsets.push(length);
      }

      const glyfOut = join(pieces, length);
      const locaOut = new Uint8Array(4 * offsets.length);
      const locaView = new DataView(locaOut.buffer);
      offsets.forEach((offset, i) => locaView.setUint32(4 * i, offset));
      const hmtxOut = new Uint8Array(4 * order.length);
      const hmtxView = new DataView(hmtxOut.buffer);
      order.forEach((g, i) => {
        hmtxView.setUint16(4 * i, advance(g));
        hmtxView.setInt16(4 * i + 2, bearing(g));
      });
      const headOut = copy(head.at, head.at + 54);
      const headView = new DataView(headOut.buffer);
      headView.setUint32(8, 0);
      headView.setInt16(50, 1);
      const hheaOut = copy(hhea.at, hhea.at + 36);
      new DataView(hheaOut.buffer).setUint16(34, order.length);
      const maxpOut = copy(maxp.at, maxp.at + maxp.length);
      new DataView(maxpOut.buffer).setUint16(4, order.length);

      return sfnt([
        ["glyf", glyfOut],
        ["head", headOut],
        ["hhea", hheaOut],
        ["hmtx", hmtxOut],
        ["loca", locaOut],
        ["maxp", maxpOut],
        ...hinting.map(([tag, table]) => [tag, copy(table.at, table.at + table.length)] as const),
      ]);
    },
  };
}

/**
 * Checks one glyph's bytes, and gives where in the file's bytes a composite names each glyph it
 * is built of: none for a simple glyph.
 */
function readGlyph(
  view: DataView,
  at: number,
  length: number,
  glyphs: number,
  g: number,
): number[] {
  const end = at + length;

  const short = (): never => {
    throw new Refused(`its glyph ${g} is shorter than what it holds`);
  };

  if (length < 10) short();
  const contours = view.getInt16(at);
  let p = at + 10;

  if (contours >= 0) {
    if (p + 2 * contours + 2 > end) short();
    // Each contour ends at a point after the last one's end.
    let points = 0;

    for (let c = 0; c < contours; c++, p += 2) {
      const last = view.getUint16(p);

      if (last < points) throw new Refused(`its glyph ${g} has contours that end out of order`);
      points = last + 1;
    }

    p += 2 + view.getUint16(p);
    // The flags, each for a point or repeated for several, then each point's two coordinates,
    // each one byte, two or none as its flag says.
    let [xBytes, yBytes, read] = [0, 0, 0];

    while (read < points) {
      if (p >= end) short();
      const flag = view.getUint8(p++);
      let times = 1;

      if (flag & 0x08) {
        if (p >= end) short();
        times += view.getUint8(p++);
      }

      times = Math.min(times, points - read);
      read += times;
      xBytes += times * (flag & 0x02 ? 1 : flag & 0x10 ? 0 : 2);
      yBytes += times * (flag & 0x04 ? 1 : flag & 0x20 ? 0 : 2);
    }

    if (p + xBytes + yBytes > end) short();

    return [];
  }

  const named: number[] = [];
  let flags: number;
  let instructions = false;

  do {
    if (p + 4 > end) short();
    flags = view.getUint16(p);
    const part = view.getUint16(p + 2);

    if (part >= glyphs) throw new Refused(`its glyph ${g} is built of a glyph it does not have`);
    named.push(p + 2);
    p += 4 + (flags & 0x01 ? 4 : 2);
    p += flags & 0x08 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0;
    instructions ||= (flags & 0x100) !== 0;

    if (p > end) short();
  } while (flags & 0x20);

  if (instructions) {
    if (p + 2 > end) short();

    if (p + 2 + view.getUint16(p) > end) short();
  }

  return named;
}

/**
 * Refuses a font whose composite glyphs are built of each other in a cycle, or nest deeper than
 * `MAX_DEPTH`: a reader drawing one would never finish or would give up. Each composite is
 * walked once, with a stack of its own.
 */
function composedDepth(view: DataView, parts: ReadonlyMap<number, readonly number[]>): void {
  const depth = new Map<number, number>();
  const open = new Set<number>();

  for (const root of parts.keys()) {
    if (depth.has(root)) continue;
    const stack: { glyph: number; next: number }[] = [{ glyph: root, next: 0 }];
    open.add(root);

    while (stack.length > 0) {
      const top = stack.at(-1)!;
      const named = parts.get(top.glyph) ?? [];

      if (top.next < named.length) {
        const part = view.getUint16(named[top.next++]!);

        if (open.has(part)) {
          throw new Refused(`its glyph ${part} is built of itself`);
        }

        if (!depth.has(part) && parts.has(part)) {
          open.add(part);
          stack.push({ glyph: part, next: 0 });
        }

        continue;
      }

      let deepest = 0;

      for (const at of named) deepest = Math.max(deepest, depth.get(view.getUint16(at)) ?? 0);

      if (deepest + 1 > MAX_DEPTH) {
        throw new Refused(`its glyph ${top.glyph} nests other glyphs deeper than ${MAX_DEPTH}`);
      }

      depth.set(top.glyph, deepest + 1);
      open.delete(top.glyph);
      stack.pop();
    }
  }
}

/**
 * The map from characters to glyphs: the Unicode subtable of `cmap` for every plane, format 12,
 * or for the first, format 4. A lookup reads a few entries found by halving, and gives 0 for a
 * character the map lacks or a glyph the font does not have.
 */
function characterMap(view: DataView, cmap: Table, glyphs: number): (code: number) => number {
  const end = cmap.at + cmap.length;
  const subtables = view.getUint16(cmap.at + 2);

  if (4 + 8 * subtables > cmap.length) throw new Refused("its table cmap runs past its end");
  let best: { at: number; format: number; rank: number } | undefined;

  for (let i = 0; i < subtables; i++) {
    const entry = cmap.at + 4 + 8 * i;

    const [platform, encoding, offset] = [
      view.getUint16(entry),
      view.getUint16(entry + 2),
      view.getUint32(entry + 4),
    ];

    if (offset + 2 > cmap.length) continue;
    const format = view.getUint16(cmap.at + offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    const rank = !unicode ? 0 : format === 12 ? 2 : format === 4 ? 1 : 0;

    if (rank > (best?.rank ?? 0)) best = { at: cmap.at + offset, format, rank };
  }

  if (best === undefined) throw new Refused("it maps no Unicode character to a glyph");
  const at = best.at;
  const found = (g: number): number => (g < glyphs ? g : 0);

  if (best.format === 12) {
    if (at + 16 > end) throw new Refused("its table cmap runs past its end");
    const groups = view.getUint32(at + 12);

    if (groups > (end - at - 16) / 12)
      throw new Refused("its table cmap counts more than it holds");

    return (code) => {
      let [low, high] = [0, groups - 1];

      while (low <= high) {
        const middle = (low + high) >>> 1;
        const group = at + 16 + 12 * middle;

        if (code < view.getUint32(group)) high = middle - 1;
        else if (code > view.getUint32(group + 4)) low = middle + 1;
        else return found(view.getUint32(group + 8) + code - view.getUint32(group));
      }

      return 0;
    };
  }

  if (at + 14 > end) throw new Refused("its table cmap runs past its end");
  const twice = view.getUint16(at + 6);
  const segments = twice >> 1;

  if (segments === 0 || twice % 2 !== 0 || at + 16 + 4 * twice > end) {
    throw new Refused("its table cmap counts more than it holds");
  }

  const [ends, starts, deltas, ranges] = [
    at + 14,
    at + 16 + twice,
    at + 16 + 2 * twice,
    at + 16 + 3 * twice,
  ];

  return (code) => {
    if (!(code >= 0 && code <= 0xffff)) return 0;
    let [low, high] = [0, segments - 1];

    while (low < high) {
      const middle = (low + high) >>> 1;

      if (view.getUint16(ends + 2 * middle) < code) low = middle + 1;
      else high = middle;
    }

    const start = view.getUint16(starts + 2 * low);

    if (view.getUint16(ends + 2 * low) < code || start > code) return 0;
    const delta = view.getUint16(deltas + 2 * low);
    const range = view.getUint16(ranges + 2 * low);

    if (range === 0) return found((code + delta) & 0xffff);
    const there = ranges + 2 * low + range + 2 * (code - start);

    if (there + 2 > end) return 0;
    const g = view.getUint16(there);

    return g === 0 ? 0 : found((g + delta) & 0xffff);
  };
}

/** A font's family and PostScript names, each undefined where its `name` table has none. */
interface FontNames {
  family: string | undefined;
  postScript: string | undefined;
}

/**
 * The family and PostScript names of the `name` table, each undefined where it has none. It
 * finds the records first and decodes at most two strings, so a table of many records that
 * share one long string costs no more than its records.
 */
function readNames(view: DataView, name: Table | undefined): FontNames {
  if (name === undefined || name.length < 6) return { family: undefined, postScript: undefined };
  const count = view.getUint16(name.at + 2);
  const strings = name.at + view.getUint16(name.at + 4);
  const end = name.at + name.length;
  // The family as the command finds a file by it: Windows' name, in United States English or
  // failing that the first, and the PostScript name from Windows or the Macintosh.
  let family: number | undefined;
  let postScript: number | undefined;

  for (let i = 0; i < count && name.at + 6 + 12 * (i + 1) <= end; i++) {
    const record = name.at + 6 + 12 * i;
    const [platform, language, id] = [0, 4, 6].map((at) => view.getUint16(record + at));

    if (strings + view.getUint16(record + 10) + view.getUint16(record + 8) > end) continue;

    if (id === 6 && (platform === 3 || platform === 1)) postScript ??= record;
    else if (id === 1 && platform === 3 && (family === undefined || language === 0x409)) {
      if (family === undefined || view.getUint16(family + 4) !== 0x409) family = record;
    }
  }

  const text = (record: number | undefined): string | undefined => {
    if (record === undefined) return undefined;
    const [length, at] = [view.getUint16(record + 8), strings + view.getUint16(record + 10)];
    let out = "";

    if (view.getUint16(record) === 3) {
      for (let k = 0; k + 1 < length; k += 2) out += String.fromCharCode(view.getUint16(at + k));
    } else {
      for (let k = 0; k < length; k++) out += String.fromCharCode(view.getUint8(at + k));
    }

    return out;
  };

  return { family: text(family), postScript: pdfName(text(postScript) ?? "") };
}

/** A name cut to what a PDF name and a PostScript font name may hold, or undefined if empty. */
function pdfName(text: string): string | undefined {
  const kept = text.replace(/[^\x21-\x7e]|[()<>[\]{}/%#]/g, "").slice(0, 63);

  return kept === "" ? undefined : kept;
}

function fromFamily(family: string | undefined): string {
  return pdfName(family ?? "") ?? "Font";
}

function join(pieces: readonly Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let at = 0;

  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }

  return out;
}

/** The sum of a table's bytes as 32-bit words, the last padded with zeros. */
function checksum(data: Uint8Array): number {
  let sum = 0;

  for (let i = 0; i < data.length; i += 4) {
    sum =
      (sum +
        ((data[i]! << 24) |
          ((data[i + 1] ?? 0) << 16) |
          ((data[i + 2] ?? 0) << 8) |
          (data[i + 3] ?? 0))) >>>
      0;
  }

  return sum;
}

/** A font file of the tables given, in the order of their tags, with their checksums. */
function sfnt(tables: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const sorted = [...tables].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const count = sorted.length;
  const power = 2 ** Math.floor(Math.log2(count));
  let length = 12 + 16 * count;

  const places = sorted.map(([, data]) => {
    const at = length;
    length += (data.length + 3) & ~3;

    return at;
  });

  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, count);
  view.setUint16(6, power * 16);
  view.setUint16(8, Math.log2(power));
  view.setUint16(10, count * 16 - power * 16);
  sorted.forEach(([tag, data], i) => {
    const entry = 12 + 16 * i;

    for (let k = 0; k < 4; k++) out[entry + k] = tag.charCodeAt(k);
    view.setUint32(entry + 4, checksum(data));
    view.setUint32(entry + 8, places[i]!);
    view.setUint32(entry + 12, data.length);
    out.set(data, places[i]!);
  });
  // The whole file sums to 0xB1B0AFBA once `head` holds the difference.
  const head = places[sorted.findIndex(([tag]) => tag === "head")]!;
  view.setUint32(head + 8, (0xb1b0afba - checksum(out)) >>> 0);

  return out;
}
