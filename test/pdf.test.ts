import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync, inflateSync } from "node:zlib";
import { createDrawing, svgToPDF, toPDF, toSVG } from "../src/index.ts";
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
    d.text([1, 2], "A ≥ B", { height: 0.25, style: "NOTE" });
  });
  const missing: [string, string, number][] = [];
  const pdf = latin1(toPDF(d.build(), { missing: (...said) => missing.push(said), title: "E" }));
  holdsTogether(pdf);
  // The medium is upright, 36 by 48 inches, and the layout's point (1, 1) is at (1, 47) on it.
  assert.match(pdf, /\/MediaBox \[0 0 2592 3456\] \/Rotate 270/);
  assert.match(pdf, /^0 w\n72 3384 m\n72 3312 l\nS$/m);
  assert.match(pdf, /<41203F2042> Tj/);
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
