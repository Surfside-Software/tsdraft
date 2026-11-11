// Reads a PNG the renderer made, for the tests that measure what it drew.
import { inflateSync } from "node:zlib";

export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** How bright the pixel is, from 0 to 255: its red. */
  readonly at: (x: number, y: number) => number;
}

/** Decodes a PNG of 8-bit RGBA, which is what the renderer writes. */
export function decode(png: Uint8Array): Pixels {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const [width, height] = [view.getUint32(16), view.getUint32(20)];
  if (png[24] !== 8 || png[25] !== 6) throw new Error("The PNG is not 8-bit RGBA");
  const data: Uint8Array[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    if (type === "IDAT") data.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * 4;
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[y * stride + i - 4]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + i]! : 0;
      const c = i >= 4 && y > 0 ? out[(y - 1) * stride + i - 4]! : 0;
      const [pa, pb, pc] = [Math.abs(b - c), Math.abs(a - c), Math.abs(a + b - 2 * c)];
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const predicted = [0, a, b, (a + b) >> 1, paeth][filter]!;
      out[y * stride + i] = (raw[y * (stride + 1) + 1 + i]! + predicted) & 255;
    }
  }
  return { width, height, at: (x, y) => out[y * stride + x * 4]! };
}

/** The box of the pixels brighter than half way, as `[left, top, right, bottom]` in pixels. */
export function ink({ width, height, at }: Pixels): [number, number, number, number] {
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (at(x, y) < 128) continue;
      left = Math.min(left, x);
      right = Math.max(right, x + 1);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + 1);
    }
  }
  return [left, top, right, bottom];
}
