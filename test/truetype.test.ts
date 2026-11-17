import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readTrueType, type TrueType } from "../src/truetype.ts";

/** The command's own font, under the OFL, with composite glyphs. */
const shipped = new Uint8Array(
  readFileSync(new URL("../cli/assets/fonts/JetBrainsMono-Regular.ttf", import.meta.url)),
);

/** Where each table of a font starts, and the start of each glyph in `glyf`. */
function layout(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = new Map<string, { entry: number; at: number; length: number }>();
  for (let i = 0; i < view.getUint16(4); i++) {
    const entry = 12 + 16 * i;
    tables.set(String.fromCharCode(...bytes.subarray(entry, entry + 4)), {
      entry,
      at: view.getUint32(entry + 8),
      length: view.getUint32(entry + 12),
    });
  }
  const [head, loca, glyf] = ["head", "loca", "glyf"].map((tag) => tables.get(tag)!);
  const long = view.getInt16(head!.at + 50) === 1;
  const glyph = (g: number): number =>
    glyf!.at + (long ? view.getUint32(loca!.at + 4 * g) : 2 * view.getUint16(loca!.at + 2 * g));
  return { view, tables, glyph };
}

const read = (bytes: Uint8Array): TrueType => {
  const font = readTrueType(bytes);
  assert.ok(typeof font !== "string", font as string);
  return font;
};

test("a subset holds the glyphs asked for and each composite's parts, renumbered", () => {
  // A Node `Buffer`, as a command reads a file, is cut from a copy and left as it was.
  const file = readFileSync(
    new URL("../cli/assets/fonts/JetBrainsMono-Regular.ttf", import.meta.url),
  );
  const font = read(file);
  const asked = [0, ...new Set([..."AÉ°±½"].map((c) => font.glyph(c.codePointAt(0)!)))];
  assert.ok(!asked.slice(1).includes(0));
  const subset = font.subset(asked);
  const { view, tables, glyph } = layout(subset);
  // É is built of others, which follow the glyphs asked for, and names them by their new numbers.
  const glyphs = view.getUint16(tables.get("maxp")!.at + 4);
  assert.ok(glyphs > asked.length);
  const accented = glyph(asked.indexOf(font.glyph(0xc9)));
  assert.ok(view.getInt16(accented) < 0);
  assert.ok(view.getUint16(accented + 12) < glyphs);
  // Each glyph keeps its advance, and the file sums as TrueType says.
  const hmtx = tables.get("hmtx")!.at;
  asked.forEach((g, i) => assert.equal(view.getUint16(hmtx + 4 * i), font.advance(g)));
  let sum = 0;
  for (let i = 0; i < subset.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
  assert.equal(sum, 0xb1b0afba);
  assert.ok(subset.length < shipped.length / 20);
  assert.equal(view.getUint16(tables.get("hhea")!.at + 34), glyphs);
  assert.equal(view.getInt16(tables.get("head")!.at + 50), 1);
  assert.equal(tables.get("loca")!.length, 4 * (glyphs + 1));
  assert.ok(file.equals(shipped));
  assert.deepEqual(font.subset(asked), subset);
  assert.throws(() => font.subset([1]), RangeError);
  assert.throws(() => font.subset([0, 1, 1]), RangeError);
});

test("a font file is refused, never thrown on: cut short, counts past its tables, glyphs built of themselves", () => {
  const { view, glyph } = layout(shipped);
  const font = read(shipped);
  // Two accented capitals, each built of others: one is made to be built of the other, and back.
  const [a, b] = [font.glyph(0xc9), font.glyph(0xc8)];
  const cycle = shipped.slice();
  const cycled = new DataView(cycle.buffer);
  cycled.setUint16(glyph(a) + 12, b);
  cycled.setUint16(glyph(b) + 12, a);
  assert.match(readTrueType(cycle) as string, /is built of itself/);
  // A chain of composites, each built of the next, deeper than a reader follows.
  const composites: number[] = [];
  for (let g = 0; composites.length < 20; g++) {
    if (glyph(g + 1) > glyph(g) && view.getInt16(glyph(g)) < 0) composites.push(g);
  }
  const deep = shipped.slice();
  composites.slice(0, -1).forEach((g, i) => {
    new DataView(deep.buffer).setUint16(glyph(g) + 12, composites[i + 1]!);
  });
  assert.match(readTrueType(deep) as string, /deeper than 16/);
  // A glyph whose first contour ends after its second, which a reader cannot draw.
  const capital = glyph(font.glyph(0x41));
  assert.ok(view.getInt16(capital) === 2);
  const disordered = shipped.slice();
  new DataView(disordered.buffer).setUint16(capital + 10, view.getUint16(capital + 12) + 1);
  assert.match(readTrueType(disordered) as string, /contours that end out of order/);
  // Cut short, and with bytes changed at random: a reason or a font, which cuts without a throw.
  let seed = 7;
  const random = (n: number): number => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return Math.floor((seed / 2 ** 32) * n);
  };
  for (let i = 0; i < 400; i++) {
    const bytes = i < 100 ? shipped.slice(0, random(shipped.length)) : shipped.slice();
    const changed = new DataView(bytes.buffer);
    for (let k = 0; i >= 100 && k < 4; k++) {
      const at = random(bytes.length - 4);
      if (k % 2) changed.setUint32(at, random(2 ** 32));
      else changed.setUint16(at, 0xffff);
    }
    const found = readTrueType(bytes);
    if (typeof found !== "string") {
      const glyphs = [0, ...new Set([..."AÉ°"].map((c) => found.glyph(c.codePointAt(0)!)))];
      assert.ok(found.subset(glyphs.filter((g, j) => j === 0 || g !== 0)) instanceof Uint8Array);
    }
  }
});
