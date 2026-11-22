// Raster files, for an image's plot: what a PNG or a JPEG holds, read from its bytes. A raster
// file is untrusted input: every length and count is held to the bytes before it is read, a
// decode is held to the samples the header gives, and a file that is not read is answered with
// undefined, never a throw.

/** What a raster file is, from its header. */
export type RasterInfo = PngInfo | JpegInfo;

export interface PngInfo {
  readonly kind: "png";
  readonly width: number;
  readonly height: number;
  /** 1, 2, 4, 8 or 16. */
  readonly depth: number;
  /** 0 gray, 2 RGB, 3 a palette, 4 gray and alpha, 6 RGB and alpha. */
  readonly color: number;
  readonly interlaced: boolean;
  /** RGB of each palette entry, for a palette. */
  readonly palette: Uint8Array | undefined;
  /** The tRNS chunk's bytes, when the file has one. */
  readonly transparency: Uint8Array | undefined;
  /** The IDAT chunks' bytes, one zlib stream. */
  readonly data: Uint8Array;
}

export interface JpegInfo {
  readonly kind: "jpeg";
  readonly width: number;
  readonly height: number;
  /** 1 gray, 3 YCbCr or RGB, 4 CMYK. */
  readonly components: number;
  /** True when an Adobe marker says the file's CMYK is stored inverted, as Adobe's are. */
  readonly inverted: boolean;
}

/** The most pixels an image's plot decodes, so a hostile header cannot ask for more memory. */
export const RASTER_PIXELS = 100_000_000;

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const SAMPLES: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

const u32 = (b: Uint8Array, at: number): number =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const u16 = (b: Uint8Array, at: number): number => (b[at]! << 8) | b[at + 1]!;

/** What a PNG or a JPEG file holds, or undefined for any other bytes and for a broken file. */
export function rasterInfo(bytes: Uint8Array): RasterInfo | undefined {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return pngInfo(bytes);
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegInfo(bytes);
  return undefined;
}

/**
 * A raster file's size in pixels, across and down, from its header: what an image's `pixels`
 * is. Undefined for a file that is not a PNG or a JPEG, or is broken.
 */
export function rasterSize(bytes: Uint8Array): [width: number, height: number] | undefined {
  const info = rasterInfo(bytes);
  return info === undefined ? undefined : [info.width, info.height];
}

function pngInfo(bytes: Uint8Array): PngInfo | undefined {
  let at = 8;
  let header: Uint8Array | undefined;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const data: Uint8Array[] = [];
  let length = 0;
  while (at + 8 <= bytes.length) {
    const size = u32(bytes, at);
    const type = String.fromCharCode(
      bytes[at + 4]!,
      bytes[at + 5]!,
      bytes[at + 6]!,
      bytes[at + 7]!,
    );
    const from = at + 8;
    if (size > bytes.length - from - 4) return undefined;
    const body = bytes.subarray(from, from + size);
    if (type === "IHDR") header = body;
    else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") {
      data.push(body);
      length += size;
    } else if (type === "IEND") break;
    at = from + size + 4;
  }
  if (header === undefined || header.length < 13 || data.length === 0) return undefined;
  const [width, height] = [u32(header, 0), u32(header, 4)];
  const [depth, color, compression, filter, interlace] = [
    header[8]!,
    header[9]!,
    header[10]!,
    header[11]!,
    header[12]!,
  ];
  if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff) return undefined;
  if (!DEPTHS[color]?.includes(depth) || compression !== 0 || filter !== 0 || interlace > 1) {
    return undefined;
  }
  if (color === 3 && (palette === undefined || palette.length % 3 !== 0 || palette.length === 0)) {
    return undefined;
  }
  const joined = new Uint8Array(length);
  let to = 0;
  for (const part of data) {
    joined.set(part, to);
    to += part.length;
  }
  return {
    kind: "png",
    width,
    height,
    depth,
    color,
    interlaced: interlace === 1,
    palette: color === 3 ? palette : undefined,
    transparency,
    data: joined,
  };
}

function jpegInfo(bytes: Uint8Array): JpegInfo | undefined {
  let at = 2;
  let inverted = false;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1]!;
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    const size = u16(bytes, at + 2);
    if (size < 2 || at + 2 + size > bytes.length) return undefined;
    // APP14, Adobe's, says whether its CMYK is stored inverted.
    if (
      marker === 0xee &&
      size >= 7 &&
      String.fromCharCode(...bytes.subarray(at + 4, at + 9)) === "Adobe"
    ) {
      inverted = true;
    }
    // A start of frame of any kind but the three that are not frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (size < 8) return undefined;
      const [height, width, components] = [u16(bytes, at + 5), u16(bytes, at + 7), bytes[at + 9]!];
      if (width === 0 || height === 0 || ![1, 3, 4].includes(components)) return undefined;
      return { kind: "jpeg", width, height, components, inverted };
    }
    if (marker === 0xda || marker === 0xd9) return undefined;
    at += 2 + size;
  }
  return undefined;
}

// Inflate, RFC 1950 and 1951: the zlib stream of a PNG's data.

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DISTANCE_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** A canonical Huffman code: the count of codes of each length, and the symbols in order. */
interface Huffman {
  readonly counts: Uint16Array;
  readonly symbols: Uint16Array;
}

function huffman(lengths: ArrayLike<number>, n: number): Huffman | undefined {
  const counts = new Uint16Array(16);
  for (let i = 0; i < n; i++) counts[lengths[i]!]!++;
  counts[0] = 0;
  let left = 1;
  for (let len = 1; len < 16; len++) {
    left = left * 2 - counts[len]!;
    if (left < 0) return undefined;
  }
  const offsets = new Uint16Array(16);
  for (let len = 1; len < 15; len++) offsets[len + 1] = offsets[len]! + counts[len]!;
  const symbols = new Uint16Array(n);
  for (let i = 0; i < n; i++) if (lengths[i] !== 0) symbols[offsets[lengths[i]!]!++] = i;
  return { counts, symbols };
}

class Inflater {
  #at = 0;
  #bit = 0;
  #bits = 0;
  #out: Uint8Array;
  #length = 0;
  failed = false;
  readonly input: Uint8Array;
  readonly limit: number;
  constructor(input: Uint8Array, limit: number) {
    this.input = input;
    this.limit = limit;
    this.#out = new Uint8Array(Math.min(limit, Math.max(1024, input.length * 4)));
  }

  get written(): number {
    return this.#length;
  }

  bits(n: number): number {
    while (this.#bits < n) {
      if (this.#at >= this.input.length) {
        this.failed = true;
        return 0;
      }
      this.#bit |= this.input[this.#at++]! << this.#bits;
      this.#bits += 8;
    }
    const value = this.#bit & ((1 << n) - 1);
    this.#bit >>>= n;
    this.#bits -= n;
    return value;
  }

  decode(code: Huffman): number {
    let value = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      value |= this.bits(1);
      if (this.failed) return -1;
      const count = code.counts[len]!;
      if (value - count < first) return code.symbols[index + (value - first)]!;
      index += count;
      first = (first + count) << 1;
      value <<= 1;
    }
    this.failed = true;
    return -1;
  }

  push(byte: number): boolean {
    if (this.#length >= this.limit) {
      this.failed = true;
      return false;
    }
    if (this.#length === this.#out.length) {
      const grown = new Uint8Array(Math.min(this.limit, this.#out.length * 2));
      grown.set(this.#out);
      this.#out = grown;
    }
    this.#out[this.#length++] = byte;
    return true;
  }

  copy(distance: number, length: number): boolean {
    if (distance > this.#length) {
      this.failed = true;
      return false;
    }
    for (let i = 0; i < length; i++)
      if (!this.push(this.#out[this.#length - distance]!)) return false;
    return true;
  }

  stored(): boolean {
    this.#bit = 0;
    this.#bits = 0;
    if (this.#at + 4 > this.input.length) return false;
    const length = this.input[this.#at]! | (this.input[this.#at + 1]! << 8);
    const check = this.input[this.#at + 2]! | (this.input[this.#at + 3]! << 8);
    this.#at += 4;
    if ((length ^ 0xffff) !== check || this.#at + length > this.input.length) return false;
    for (let i = 0; i < length; i++) if (!this.push(this.input[this.#at++]!)) return false;
    return true;
  }

  block(lengths: Huffman, distances: Huffman): boolean {
    for (;;) {
      const symbol = this.decode(lengths);
      if (symbol < 0) return false;
      if (symbol < 256) {
        if (!this.push(symbol)) return false;
      } else if (symbol === 256) return true;
      else {
        const s = symbol - 257;
        if (s >= 29) return false;
        const length = LENGTH_BASE[s]! + this.bits(LENGTH_EXTRA[s]!);
        const d = this.decode(distances);
        if (d < 0 || d >= 30) return false;
        const distance = DISTANCE_BASE[d]! + this.bits(DISTANCE_EXTRA[d]!);
        if (this.failed || !this.copy(distance, length)) return false;
      }
    }
  }

  dynamic(): boolean {
    const [nlen, ndist, ncode] = [this.bits(5) + 257, this.bits(5) + 1, this.bits(4) + 4];
    if (this.failed || nlen > 286 || ndist > 30) return false;
    const lengths = new Uint8Array(320);
    for (let i = 0; i < ncode; i++) lengths[CODE_ORDER[i]!] = this.bits(3);
    const code = huffman(lengths, 19);
    if (code === undefined) return false;
    lengths.fill(0);
    let i = 0;
    while (i < nlen + ndist) {
      const symbol = this.decode(code);
      if (symbol < 0) return false;
      if (symbol < 16) lengths[i++] = symbol;
      else {
        let repeat = 0;
        let value = 0;
        if (symbol === 16) {
          if (i === 0) return false;
          value = lengths[i - 1]!;
          repeat = 3 + this.bits(2);
        } else if (symbol === 17) repeat = 3 + this.bits(3);
        else repeat = 11 + this.bits(7);
        if (this.failed || i + repeat > nlen + ndist) return false;
        while (repeat-- > 0) lengths[i++] = value;
      }
    }
    if (lengths[256] === 0) return false;
    const literal = huffman(lengths, nlen);
    const distance = huffman(lengths.subarray(nlen), ndist);
    if (literal === undefined || distance === undefined) return false;
    return this.block(literal, distance);
  }

  run(): Uint8Array | undefined {
    const [cmf, flg] = [this.input[0] ?? 0, this.input[1] ?? 0];
    if ((cmf & 15) !== 8 || ((cmf << 8) | flg) % 31 !== 0 || (flg & 32) !== 0) return undefined;
    this.#at = 2;
    const fixed = new Uint8Array(288);
    fixed.fill(8, 0, 144);
    fixed.fill(9, 144, 256);
    fixed.fill(7, 256, 280);
    fixed.fill(8, 280, 288);
    const fixedLengths = huffman(fixed, 288)!;
    const fixedDistances = huffman(new Uint8Array(30).fill(5), 30)!;
    for (;;) {
      const last = this.bits(1);
      const type = this.bits(2);
      if (this.failed) return undefined;
      const ok =
        type === 0
          ? this.stored()
          : type === 1
            ? this.block(fixedLengths, fixedDistances)
            : type === 2
              ? this.dynamic()
              : false;
      if (!ok || this.failed) return undefined;
      if (last === 1) break;
    }
    return this.#out.subarray(0, this.#length);
  }
}

/** The bytes of a zlib stream, or undefined when it is broken or holds more than `limit`. */
export function inflate(bytes: Uint8Array, limit: number): Uint8Array | undefined {
  return new Inflater(bytes, limit).run();
}

/** As `inflate`, with the count of bytes it wrote before it ended, broken or not. */
export function inflateCounted(
  bytes: Uint8Array,
  limit: number,
): { readonly bytes: Uint8Array | undefined; readonly written: number } {
  const inflater = new Inflater(bytes, limit);
  const out = inflater.run();
  return { bytes: out, written: inflater.written };
}

/** A PNG's pixels at 8 bits a sample, rows from the top, in its own samples: gray, RGB and alpha. */
export interface PngPixels {
  readonly width: number;
  readonly height: number;
  /** 1 gray, 2 gray and alpha, 3 RGB, 4 RGB and alpha: a palette is given as RGB, or RGBA with tRNS. */
  readonly channels: number;
  readonly samples: Uint8Array;
}

const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/**
 * A PNG's pixels, decoded: undone of its filters and its interlace, each sample at 8 bits, a
 * palette looked up, and the alpha of tRNS added. Undefined for a file broken or larger than
 * `RASTER_PIXELS`.
 */
export function pngPixels(info: PngInfo): PngPixels | undefined {
  const { width, height, depth, color } = info;
  if (width * height > RASTER_PIXELS) return undefined;
  const samples = SAMPLES[color]!;
  const bits = samples * depth;
  const passes = info.interlaced
    ? ADAM7.map(([x0, y0, dx, dy]) => ({
        x0,
        y0,
        dx,
        dy,
        w: Math.ceil((width - x0) / dx),
        h: Math.ceil((height - y0) / dy),
      })).filter((p) => p.w > 0 && p.h > 0)
    : [{ x0: 0, y0: 0, dx: 1, dy: 1, w: width, h: height }];
  const total = passes.reduce((sum, p) => sum + p.h * (Math.ceil((p.w * bits) / 8) + 1), 0);
  const raw = inflate(info.data, total);
  if (raw === undefined || raw.length < total) return undefined;
  const tRNS = info.transparency;
  const alpha = color === 4 || color === 6 || tRNS !== undefined;
  const channels = color === 0 ? (alpha ? 2 : 1) : color === 4 ? 2 : alpha ? 4 : 3;
  const out = new Uint8Array(width * height * channels);
  const bpp = Math.max(1, bits >> 3);
  let at = 0;
  for (const pass of passes) {
    const stride = Math.ceil((pass.w * bits) / 8);
    let previous = new Uint8Array(stride);
    for (let y = 0; y < pass.h; y++) {
      const type = raw[at]!;
      const row = raw.slice(at + 1, at + 1 + stride);
      at += stride + 1;
      if (type > 4) return undefined;
      for (let i = 0; i < stride; i++) {
        const left = i >= bpp ? row[i - bpp]! : 0;
        const up = previous[i]!;
        const corner = i >= bpp ? previous[i - bpp]! : 0;
        if (type === 1) row[i] = (row[i]! + left) & 255;
        else if (type === 2) row[i] = (row[i]! + up) & 255;
        else if (type === 3) row[i] = (row[i]! + ((left + up) >> 1)) & 255;
        else if (type === 4) {
          const p = left + up - corner;
          const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
          row[i] = (row[i]! + (pa <= pb && pa <= pc ? left : pb <= pc ? up : corner)) & 255;
        }
      }
      previous = row;
      for (let x = 0; x < pass.w; x++) {
        // A sample as the file holds it, and at 8 bits.
        const held = (k: number): number => {
          if (depth === 8) return row[x * samples + k]!;
          if (depth === 16)
            return (row[(x * samples + k) * 2]! << 8) | row[(x * samples + k) * 2 + 1]!;
          const index = (x * samples + k) * depth;
          return (row[index >> 3]! >> (8 - depth - (index & 7))) & ((1 << depth) - 1);
        };
        const sample = (k: number): number => {
          if (depth === 8 || color === 3) return held(k);
          if (depth === 16) return held(k) >> 8;
          return Math.round((held(k) * 255) / ((1 << depth) - 1));
        };
        const to = ((pass.y0 + y * pass.dy) * width + pass.x0 + x * pass.dx) * channels;
        if (color === 3) {
          const index = sample(0);
          const palette = info.palette!;
          if (index * 3 + 2 >= palette.length) return undefined;
          out[to] = palette[index * 3]!;
          out[to + 1] = palette[index * 3 + 1]!;
          out[to + 2] = palette[index * 3 + 2]!;
          if (alpha) out[to + 3] = index < tRNS!.length ? tRNS![index]! : 255;
        } else if (color === 0 || color === 4) {
          out[to] = sample(0);
          if (color === 4) out[to + 1] = sample(1);
          else if (alpha) {
            const key = tRNS!.length >= 2 ? u16(tRNS!, 0) : -1;
            out[to + 1] = held(0) === key ? 0 : 255;
          }
        } else {
          out[to] = sample(0);
          out[to + 1] = sample(1);
          out[to + 2] = sample(2);
          if (color === 6) out[to + 3] = sample(3);
          else if (alpha) {
            const key =
              tRNS!.length >= 6 ? [u16(tRNS!, 0), u16(tRNS!, 2), u16(tRNS!, 4)] : [-1, -1, -1];
            out[to + 3] = [held(0), held(1), held(2)].every((v, k) => v === key[k]) ? 0 : 255;
          }
        }
      }
    }
  }
  return { width, height, channels, samples: out };
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_CODES = Uint8Array.from(BASE64, (c) => c.charCodeAt(0));

/** Bytes in base 64, as a data URL holds them. */
export function base64(bytes: Uint8Array): string {
  // Written as bytes and read as text once, so the text is one flat string: built from pieces,
  // a long one takes many times its length in memory.
  const out = new Uint8Array(base64Length(bytes.length));
  let to = 0;
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out[to++] = BASE64_CODES[(n >> 18) & 63]!;
    out[to++] = BASE64_CODES[(n >> 12) & 63]!;
    out[to++] = b === undefined ? 61 : BASE64_CODES[(n >> 6) & 63]!;
    out[to++] = c === undefined ? 61 : BASE64_CODES[n & 63]!;
  }
  return new TextDecoder().decode(out);
}

/** The characters `base64` writes for `bytes` bytes. */
export function base64Length(bytes: number): number {
  return 4 * Math.ceil(bytes / 3);
}

/**
 * Whether a plot must decode a PNG's pixels to draw it: one with transparency, or interlaced. A
 * PDF holds any other as its own data.
 */
export function plotDecodes(info: PngInfo): boolean {
  return info.interlaced || info.color === 4 || info.color === 6 || info.transparency !== undefined;
}

/** The bytes of base 64, or undefined for text that is not. */
export function fromBase64(text: string): Uint8Array | undefined {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return undefined;
  const pad = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let at = 0;
  for (let i = 0; i < text.length; i += 4) {
    const n =
      (BASE64.indexOf(text[i]!) << 18) |
      (BASE64.indexOf(text[i + 1]!) << 12) |
      ((text[i + 2] === "=" ? 0 : BASE64.indexOf(text[i + 2]!)) << 6) |
      (text[i + 3] === "=" ? 0 : BASE64.indexOf(text[i + 3]!));
    for (const byte of [(n >> 16) & 255, (n >> 8) & 255, n & 255])
      if (at < out.length) out[at++] = byte;
  }
  return out;
}

/**
 * A JPEG without its EXIF segments. The leading CAD app plots a JPEG as its pixels are stored,
 * whatever orientation its EXIF gives, and a browser turns one by it: without them the two agree.
 */
export function withoutExif(bytes: Uint8Array): Uint8Array {
  const keep: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  let dropped = false;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1]!;
    // The image's data starts at the start of a scan, and nothing after it is a segment.
    if (marker === 0xda || marker === 0xd9) break;
    const size = u16(bytes, at + 2);
    if (size < 2 || at + 2 + size > bytes.length) return bytes;
    const exif =
      marker === 0xe1 &&
      size >= 8 &&
      String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === "Exif";
    if (exif) dropped = true;
    else keep.push(bytes.subarray(at, at + 2 + size));
    at += 2 + size;
  }
  if (!dropped) return bytes;
  keep.push(bytes.subarray(at));
  const out = new Uint8Array(keep.reduce((sum, part) => sum + part.length, 0));
  let to = 0;
  for (const part of keep) {
    out.set(part, to);
    to += part.length;
  }
  return out;
}

/** True when a PNG holds transparency: an alpha channel, or a tRNS chunk. */
export function hasAlpha(info: RasterInfo): boolean {
  return (
    info.kind === "png" && (info.color === 4 || info.color === 6 || info.transparency !== undefined)
  );
}

/** The CRC of PNG's chunks, of each byte. */
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** True when a PNG's data is stored without compression, as `opaquePng` writes it. */
export function uncompressed(info: PngInfo): boolean {
  // The zlib header's two bytes, then the first block's type in bits 1 and 2: 0 is stored.
  return info.data.length > 2 && (info.data[2]! & 6) === 0;
}

/**
 * A PNG's pixels with its transparency left out, as an image not marked transparent plots them:
 * the file without its tRNS chunk, or one of an alpha channel decoded and written again, its
 * colors at 8 bits, in deflate's stored blocks, which need no compressor. Undefined for a file
 * that does not decode.
 */
export function opaquePng(info: PngInfo, bytes: Uint8Array): Uint8Array | undefined {
  if (info.color !== 4 && info.color !== 6) {
    if (info.transparency === undefined) return bytes;
    // Every chunk but tRNS, as the file holds it; rasterInfo held each to the bytes.
    const kept: Uint8Array[] = [bytes.subarray(0, 8)];
    for (let at = 8; at + 8 <= bytes.length;) {
      const size = u32(bytes, at);
      const end = Math.min(bytes.length, at + 12 + size);
      const type = String.fromCharCode(
        bytes[at + 4]!,
        bytes[at + 5]!,
        bytes[at + 6]!,
        bytes[at + 7]!,
      );
      if (type !== "tRNS") kept.push(bytes.subarray(at, end));
      if (type === "IEND") break;
      at = end;
    }
    return concat(kept);
  }
  const pixels = pngPixels(info);
  if (pixels === undefined) return undefined;
  const { width, height, channels, samples } = pixels;
  const colors = channels >= 3 ? 3 : 1;
  const kept = new Uint8Array(width * height * colors);
  for (let i = 0; i < width * height; i++) {
    for (let k = 0; k < colors; k++) kept[i * colors + k] = samples[i * channels + k]!;
  }
  return storedPng(width, height, colors, kept);
}

/**
 * A PNG of 8-bit samples, `channels` to a pixel: 1 gray, 2 gray and alpha, 3 RGB, 4 RGB and alpha,
 * rows from the top, written in deflate's stored blocks, which need no compressor.
 */
export function storedPng(
  width: number,
  height: number,
  channels: 1 | 2 | 3 | 4,
  samples: Uint8Array,
): Uint8Array {
  const row = width * channels + 1;
  const raw = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) {
    // Filter 0 on every row: the samples as they are.
    raw.set(samples.subarray(y * width * channels, (y + 1) * width * channels), y * row + 1);
  }
  const blocks = Math.max(1, Math.ceil(raw.length / 65_535));
  const zlib = new Uint8Array(2 + raw.length + 5 * blocks + 4);
  zlib.set([0x78, 0x01]);
  let to = 2;
  for (let n = 0; n < blocks; n++) {
    const part = raw.subarray(n * 65_535, (n + 1) * 65_535);
    zlib.set([n === blocks - 1 ? 1 : 0, part.length & 255, part.length >> 8], to);
    zlib.set([~part.length & 255, (~part.length >> 8) & 255], to + 3);
    zlib.set(part, to + 5);
    to += 5 + part.length;
  }
  // Adler-32 of the data, its two sums kept under 65,521 every 5,552 bytes.
  let [a, b] = [1, 0];
  for (let i = 0; i < raw.length;) {
    const end = Math.min(raw.length, i + 5552);
    for (; i < end; i++) {
      a += raw[i]!;
      b += a;
    }
    a %= 65_521;
    b %= 65_521;
  }
  zlib.set([b >> 8, b & 255, a >> 8, a & 255], to);
  const header = new Uint8Array(13);
  header.set([width >>> 24, (width >>> 16) & 255, (width >>> 8) & 255, width & 255]);
  header.set([height >>> 24, (height >>> 16) & 255, (height >>> 8) & 255, height & 255], 4);
  header.set([8, ({ 1: 0, 2: 4, 3: 2, 4: 6 } as const)[channels], 0, 0, 0], 8);
  return concat([
    new Uint8Array(PNG_SIGNATURE),
    chunk("IHDR", header),
    chunk("IDAT", zlib),
    chunk("IEND", new Uint8Array()),
  ]);
}

/** A PNG chunk: its length, its type, its data and the CRC of the type and the data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const length = data.length;
  out.set([length >>> 24, (length >>> 16) & 255, (length >>> 8) & 255, length & 255]);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  let c = 0xffffffff;
  for (let i = 4; i < 8 + length; i++) c = CRC_TABLE[(c ^ out[i]!) & 255]! ^ (c >>> 8);
  c = (c ^ 0xffffffff) >>> 0;
  out.set([c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255], 8 + length);
  return out;
}

/** The parts one after another. */
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let to = 0;
  for (const part of parts) {
    out.set(part, to);
    to += part.length;
  }
  return out;
}
