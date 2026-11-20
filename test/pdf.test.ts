import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { deflateSync, inflateSync } from "node:zlib";
import { createDrawing, pdfFace, svgToPDF, toPDF, toSVG } from "../src/index.ts";
import { readTrueType, type TrueType } from "../src/truetype.ts";
import exampleSheet from "../examples/site-plan.ts";
import set, { xrefs } from "../examples/plan-set/set.ts";

const latin1 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("latin1");

/** Each object's offset in the cross-reference table points at that object. */
function holdsTogether(pdf: string): void {
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)?.[1]);
  const table = pdf.slice(start);
  const rows = [...table.matchAll(/^(\d{10}) 00000 n $/gm)].map(([, at]) => Number(at));
  assert.equal(Number(/\/Size (\d+)/.exec(table)?.[1]), rows.length + 1);
  rows.forEach((at, i) => assert.ok(pdf.startsWith(`${i + 1} 0 obj\n`, at), `object ${i + 1}`));
}

test("a sheet plots on its paper, with its pens, layers, clip and text", () => {
  const d = createDrawing({ units: "ft" });
  d.textStyle({ name: "NOTE", font: "Arial" });
  d.layer("WALL", { color: 1, lineweight: 0.5 }, () => d.line([0, 0], [100, 0]));
  d.layer("VIEW", { plot: false });
  d.layout("A-1", { paper: "ANSI B" }, (sheet) => {
    d.layer("VIEW", {}, () => sheet.viewport([1, 1], 15, 9, { center: [50, 0], ratio: 120 }));
    d.text([1, 10.5], "NOTE", { height: 0.25, style: "NOTE" });
  });
  const pdf = latin1(toPDF(d.build()));
  holdsTogether(pdf);
  assert.match(pdf, /\/MediaBox \[0 0 1224 792\]/);
  // The view of model space, clipped to the viewport, with the wall 10 inches long at 1" = 10'
  // across the middle of it, 0.5 mm wide in black.
  assert.match(pdf, /^q\n72 72 m\n1152 72 l\n1152 720 l\n72 720 l\nh W n$/m);
  assert.match(pdf, /\/OC \/oc\d+ BDC\n0 0 0 RG\n1\.417 w\n252 396 m\n972 396 l\nS/);
  assert.match(pdf, /<< \/Type \/OCG \/Name <FEFF00570041004C004C> >>/);
  // The note in Helvetica, with Arial's widths, a quarter inch to its capitals, unstretched.
  assert.match(pdf, /\/BaseFont \/Helvetica .*\/Widths \[277\.\d+ /);
  assert.match(pdf, /\/F\d+ 25\.139665 Tf\n1 0 0 1 72 756 Tm\n100 Tz\n<4E4F5445> Tj/);
  // The viewport on a layer that does not plot has no border, and the same drawing the same bytes.
  assert.doesNotMatch(pdf, /<FEFF0056004900450057>|^0 w$/m);
  assert.equal(pdf, latin1(toPDF(d.build())));
});

test("the example sheet and the permit set plot every element of their pictures", () => {
  holdsTogether(latin1(toPDF(exampleSheet)));
  const plotted = toPDF(set, { xrefs, deflate: (bytes) => deflateSync(bytes) });
  const text = latin1(plotted);
  holdsTogether(text);
  // The pages are the sheets in order, each with its label.
  const labels = [...text.matchAll(/\d+ << \/P <FEFF([0-9A-F]+)> >>/g)].map(([, hex]) =>
    String.fromCharCode(...hex!.match(/.{4}/g)!.map((code) => Number.parseInt(code, 16))),
  );
  assert.deepEqual(
    labels,
    set.layouts!.map((layout) => layout.name),
  );
  const first = /\/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/.exec(text)!;
  const at = first.index + first[0].length;
  const content = inflateSync(plotted.subarray(at, at + Number(first[1]))).toString("latin1");
  assert.match(content, /^1 J\n1 j\n/);
});

test("svgToPDF refuses what toSVG does not draw of a layout", () => {
  const d = createDrawing().line([0, 0], [1, 1]).build();
  assert.throws(
    () => svgToPDF([toSVG(d)]),
    /a picture of format null, where this copy of tsdraft reads format 1/,
  );
  assert.throws(() => svgToPDF([]), RangeError);
  const sheet = toSVG(exampleSheet, { layout: exampleSheet.layouts![0]!.name });
  for (const changed of [
    sheet.replace("<line ", "<image "),
    sheet.replace("<line ", '<line opacity="0.5" '),
    sheet.replace(/ d="M ([-\d.]+)/, ' d="Q $1'),
    sheet.replace("</svg>", ""),
    `${sheet}</g>`,
    sheet.replace(/<\/g>\n<\/svg>/, "</svg>\n</svg>"),
    sheet.replace(/<clipPath id="([^"]+)">/, '<clipPath id="$1" transform="rotate(5)">'),
  ]) {
    assert.throws(() => svgToPDF([changed]), RangeError);
  }
});

test("a page sets the thinnest pen 0 wide, turns ARCH E as the plotter holds it, and says what it lacks", () => {
  const d = createDrawing({ units: "in" });
  d.textStyle({ name: "NOTE", font: "Arial" });
  d.layer("HAIR", { lineweight: 0 });
  d.layout("E", { paper: "ARCH E" }, () => {
    d.layer("HAIR", {}, () => d.line([1, 1], [2, 1]));
    d.text([1, 2], "A ≥ B ∅", { height: 0.25, style: "NOTE" });
  });
  const missing: [string, string, number][] = [];
  const pdf = latin1(toPDF(d.build(), { missing: (...said) => missing.push(said), title: "E" }));
  holdsTogether(pdf);
  // The medium is upright, 36 by 48 inches, and the layout's point (1, 1) is at (1, 47) on it.
  assert.match(pdf, /\/MediaBox \[0 0 2592 3456\] \/Rotate 270/);
  assert.match(pdf, /^0 w\n72 3384 m\n72 3312 l\nS$/m);
  // The diameter sign, which the font lacks, is plotted as Ø, as the leading CAD app plots it.
  assert.match(pdf, /<41203F204220D8> Tj/);
  assert.deepEqual(missing, [["E", "≥", 0]]);
  assert.match(pdf, /\/Title <FEFF0045>/);
  assert.match(pdf, /\/ID \[<[0-9A-F]{32}> <[0-9A-F]{32}>\]/);
  // A list of sheets of drawings of their own plots each in turn.
  const two = latin1(
    toPDF([
      { drawing: d.build(), layout: "E" },
      { drawing: d.build(), layout: "E" },
    ]),
  );
  assert.equal(two.match(/\/Type \/Page /g)?.length, 2);
  assert.throws(() => toPDF([]), RangeError);
  assert.throws(() => toPDF([null as never]), RangeError);
  assert.throws(() => toPDF([{ layout: "E" } as never]), RangeError);
});

test("a curve strays from its arc by at most a thousandth of an inch on the paper", () => {
  const d = createDrawing({ units: "ft" });
  d.layer("VIEW", { plot: false });
  d.circle([0, 0], 2000);
  d.layout("A", { paper: "ANSI B" }, (sheet) => {
    d.layer("VIEW", {}, () => sheet.viewport([1, 1], 15, 9, { center: [2000, 0], ratio: 120 }));
  });
  const content = latin1(toPDF(d.build()));
  // The circle is 200 inches round on the paper, about (8.5 - 200, 5.5) inches.
  const [cx, cy, r] = [(8.5 - 200) * 72, 5.5 * 72, 200 * 72];
  const path = /^([-\d.]+) ([-\d.]+) m\n((?:[-\d. ]+ c\n)+)h$/m.exec(content)!;
  let at = [Number(path[1]), Number(path[2])];
  let curves = 0;
  for (const line of path[3]!.trim().split("\n")) {
    const [x1, y1, x2, y2, x, y] = line.split(" ").map(Number) as number[];
    // A curve meets its arc at its ends and its middle, and strays most a fifth of the way in.
    for (const t of [0.1, 0.2, 0.3, 0.7, 0.8, 0.9]) {
      const u = 1 - t;
      const along = (p0: number, p1: number, p2: number, p3: number) =>
        u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
      const point = [along(at[0]!, x1!, x2!, x!), along(at[1]!, y1!, y2!, y!)] as const;
      assert.ok(Math.abs(Math.hypot(point[0] - cx, point[1] - cy) - r) <= 0.072);
    }
    at = [x!, y!];
    curves++;
  }
  assert.ok(curves > 4);
});

test("a text seen through a view at any scale keeps its size on the page", () => {
  const d = createDrawing({ units: "in" });
  d.textStyle({ name: "NOTE", font: "Arial" });
  d.layer("VIEW", { plot: false });
  // A text 2e8 inches high at a ratio of 1e9 is 0.2 inch high on the paper.
  d.text([0, 0], "FAR", { height: 2e8, style: "NOTE" });
  d.layout("A", { paper: "ANSI A" }, (sheet) => {
    d.layer("VIEW", {}, () => sheet.viewport([1, 1], 9, 6.5, { center: [0, 0], ratio: 1e9 }));
  });
  assert.match(latin1(toPDF(d.build())), /\/F\d+ 20\.111732 Tf\n1 0 0 1 [\d.]+ [\d.]+ Tm/);
});

/** A stream of a PDF written without `deflate`, by its object's number. */
function stream(pdf: string, object: string): Uint8Array {
  const head = new RegExp(`\\n${object} 0 obj\\n<< /Length (\\d+)[^\\n]*>>\\nstream\\n`).exec(pdf)!;
  const at = head.index + head[0].length;
  return new Uint8Array(Buffer.from(pdf.slice(at, at + Number(head[1])), "latin1"));
}

/** A TrueType program's tables, and the bytes of each glyph by its number. */
function program(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = new Map<string, number>();
  for (let i = 0; i < view.getUint16(4); i++) {
    const entry = 12 + 16 * i;
    tables.set(String.fromCharCode(...bytes.subarray(entry, entry + 4)), view.getUint32(entry + 8));
  }
  const long = view.getInt16(tables.get("head")! + 50) === 1;
  const loca = tables.get("loca")!;
  const start = (g: number) =>
    long ? view.getUint32(loca + 4 * g) : 2 * view.getUint16(loca + 2 * g);
  const glyf = tables.get("glyf")!;
  return {
    advance: (g: number) => view.getUint16(tables.get("hmtx")! + 4 * g),
    glyph: (g: number) => bytes.subarray(glyf + start(g), glyf + start(g + 1)),
  };
}

/**
 * True when glyph `a` of one program draws what glyph `b` of the other does: the same bytes, or
 * for a composite the same bytes but its parts' numbers, and parts that draw the same.
 */
function sameGlyph(
  one: ReturnType<typeof program>,
  a: number,
  other: ReturnType<typeof program>,
  b: number,
): boolean {
  const [x, y] = [one.glyph(a), other.glyph(b)];
  if (x.length < 10 || new DataView(x.buffer, x.byteOffset).getInt16(0) >= 0) {
    return Buffer.from(x).equals(Buffer.from(y.subarray(0, x.length)));
  }
  const [vx, vy] = [x, y].map((g) => new DataView(g.buffer, g.byteOffset, g.byteLength));
  let p = 10;
  let flags: number;
  do {
    flags = vx!.getUint16(p);
    if (!sameGlyph(one, vx!.getUint16(p + 2), other, vy!.getUint16(p + 2))) return false;
    if (vx!.getUint16(p) !== vy!.getUint16(p)) return false;
    p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
  } while (flags & 0x20);
  return true;
}

test("a TrueType font given a file is embedded, cut to the characters set, each in its own glyph", () => {
  // A Node `Buffer`, as the command reads a file.
  const file = readFileSync(
    new URL("../cli/assets/fonts/JetBrainsMono-Regular.ttf", import.meta.url),
  );
  const before = Buffer.from(file);
  const d = createDrawing({ units: "in" });
  d.textStyle({ name: "NOTE", font: "Arial" });
  d.layout("A", { paper: "ANSI A" }, () => {
    d.text([1, 2], "45° ±½ Ø ℄", { height: 0.25, style: "NOTE" });
    d.text([1, 1.5], "ÉÀÇ àéü ĀŁ≥Δ", { height: 0.25, style: "NOTE" });
    d.text([1, 1], "TXT", { height: 0.25 });
  });
  const missing: [string, string, number][] = [];
  const plot = () =>
    latin1(toPDF(d.build(), { fonts: { Arial: file }, missing: (...said) => missing.push(said) }));
  const pdf = plot();
  holdsTogether(pdf);
  assert.equal(pdfFace("Arial", file), "JetBrainsMono-Regular");
  assert.equal(pdfFace("Arial"), "Helvetica");
  assert.equal(pdfFace("txt.shx", file), "Courier");
  const name = /\/BaseFont \/([A-Z]{6}\+JetBrainsMono-Regular) \/Encoding \/Identity-H/.exec(
    pdf,
  )?.[1];
  assert.ok(name, "the font is embedded under the name of a subset");
  // Each character has a code of its own, from 1; the one the font lacks is set as `?` and said.
  // The size makes the file's capitals, 0.73 of its em, as tall as the text.
  assert.match(
    pdf,
    /\/F\d+ 24\.657534 Tf\n1 0 0 1 72 144 Tm\n[\d.]+ Tz\n<0001000200030004000500060004000700040008> Tj/,
  );
  assert.deepEqual(missing, [["A", "℄", 0]]);
  // Each code leads, through the map of glyphs, to the glyph of its character in the file, and
  // as wide: a composite's parts too.
  const font = readTrueType(new Uint8Array(file)) as TrueType;
  const [original, subset] = [
    program(new Uint8Array(file)),
    program(stream(pdf, /\/FontFile2 (\d+)/.exec(pdf)![1]!)),
  ];
  const glyphs = stream(pdf, /\/CIDToGIDMap (\d+)/.exec(pdf)![1]!);
  const unicode = Buffer.from(stream(pdf, /\/ToUnicode (\d+)/.exec(pdf)![1]!)).toString("latin1");
  let composites = 0;
  for (const [, code, character] of unicode.matchAll(/<([0-9A-F]{4})> <([0-9A-F]{4})>/g)) {
    const at = Number.parseInt(code!, 16);
    const to = (glyphs[2 * at]! << 8) | glyphs[2 * at + 1]!;
    const from = font.glyph(Number.parseInt(character!, 16));
    assert.ok(sameGlyph(original, from, subset, to), `the glyph of U+${character}`);
    assert.equal(subset.advance(to), original.advance(from));
    if (
      new DataView(original.glyph(from).buffer, original.glyph(from).byteOffset).getInt16(0) < 0
    ) {
      composites++;
    }
  }
  assert.ok(composites >= 5);
  // The program holds those glyphs alone, an SHX font keeps its standard face, the same files
  // give the same bytes, and the file given is as it was.
  const length = Number(/\/Length1 (\d+)/.exec(pdf)?.[1]);
  assert.ok(length > 0 && length < file.length / 20);
  assert.match(pdf, /\/BaseFont \/Courier /);
  assert.equal(plot(), pdf);
  assert.ok(file.equals(before));
});
