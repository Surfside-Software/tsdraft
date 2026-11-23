import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import {
  createDrawing,
  lint,
  readDXF,
  toDXF,
  toPDF,
  toSVG,
  fromPage,
  toPage,
  underlayColor,
  underlayDefinitions,
  underlayVectors,
  type Drawing,
  type Entity,
  type Layout,
  type Underlay,
} from "../src/index.ts";
import { storedPng } from "../src/raster.ts";
import { pictureFits } from "../src/underlays.ts";
import { dataOf, ofKind, wrong, type Data } from "./values.ts";

/** A page's picture: `w` by `h` pixels, a black square on a clear ground in its lower-left quarter. */
function page(w: number, h: number): Uint8Array {
  const samples = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < w / 2 && y >= h / 2) samples[(y * w + x) * 4 + 3] = 255;
    }
  }

  return storedPng(w, h, 4, samples);
}

const base = (entities: Entity[], more: Partial<Drawing> = {}): Drawing => ({
  format: 0,
  units: "in",
  dxf: "R2018",
  layers: [{ name: "0", color: 7 }],
  entities,
  ...more,
});

const underlay = (more: Partial<Underlay> = {}): Underlay => ({
  kind: "underlay",
  layer: "0",
  path: "arch.pdf",
  pageSize: [11, 8.5],
  at: [0, 0],
  ...more,
});

test("an underlay's rules are compile errors and runtime errors", () => {
  const d = createDrawing({ units: "in" });
  // @ts-expect-error an absolute path finds no file on another machine
  assert.throws(() => d.underlay("C:/plans/arch.pdf", [0, 0], { pageSize: [11, 8.5] }), /folder/);
  assert.throws(() => d.underlay("arch.pdf", [0, 0], { pageSize: [11, 0] }), /pageSize/);
  assert.throws(() => d.underlay("arch.pdf", [0, 0], { pageSize: [11, 8.5], page: "0" }), /page/);
  assert.throws(() => d.underlay("arch.pdf", [0, 0], { pageSize: [11, 8.5], fade: 81 }), /fade/);
  assert.throws(
    () => d.underlay("arch.pdf", [0, 0], { pageSize: [11, 8.5], contrast: 19 }),
    /contrast/,
  );
  assert.throws(
    () => d.underlay("arch.pdf", [0, 0], { pageSize: [11, 8.5], invertClip: true }),
    /invertClip needs a clip/,
  );
  assert.throws(
    () =>
      d.underlay("arch.pdf", [0, 0], {
        pageSize: [11, 8.5],
        clip: [
          [1, 1],
          [1, 3],
        ],
      }),
    /page's sides/,
  );
  const r12 = createDrawing({ units: "in", dxf: "R12" });
  // @ts-expect-error tsdraft writes no underlays to R12
  assert.throws(() => r12.underlay("arch.pdf", [0, 0], { pageSize: [11, 8.5] }), /R12/);

  const errors = lint(base([underlay({ fade: 90, page: "x" })])).filter(
    (e) => e.severity === "error",
  );

  assert.deepEqual(
    errors.map((e) => e.rule),
    ["underlay", "underlay"],
  );
});

test("toDXF writes an underlay as the leading CAD app saves one, and readDXF reads it back", async () => {
  const d = createDrawing({ units: "in" })
    .underlay("refs/arch.pdf", [1, 2], {
      page: "2",
      pageSize: [17, 11],
      scale: 0.25,
      rotation: -45,
      clip: [
        [1.5, 2.5],
        [3, 2],
      ],
      fade: 30,
      contrast: 60,
      monochrome: true,
    })
    .underlay("refs\\arch.pdf", [10, 2], { page: "2", pageSize: [17, 11] })
    .build();

  const framed: Drawing = { ...d, underlayFrame: "screen" };
  const dxf = toDXF(framed);
  assert.match(dxf, /\r\nPDFUNDERLAY\r\n/);
  // One definition for both paths of one page.
  assert.equal(dxf.match(/\r\nPDFDEFINITION\r\n/g)?.length, 2);
  assert.match(dxf, /\r\n3\r\narch - 2\r\n/);
  assert.match(dxf, /\r\n1\r\nrefs\\arch\.pdf\r\n2\r\n2\r\n/);
  assert.match(dxf, /\r\n3\r\nPDFFRAME\r\n/);
  const read = await readDXF(dxf, { geometry: true });
  const found = (read.model.entities ?? []).flatMap((e) => (e.kind === "underlay" ? [e] : []));
  assert.equal(found.length, 2);
  const [first] = found;
  assert.equal(first!.path, "refs\\arch.pdf");
  assert.equal(first!.page, "2");
  assert.deepEqual(first!.scale, [0.25, 0.25]);
  assert.equal(first!.rotation, 315);
  assert.equal(first!.fade, 30);
  assert.equal(first!.contrast, 60);
  assert.equal(first!.monochrome, true);
  // A rectangle comes back as its top-left and bottom-right corners along the page.
  const made = ofKind(d.entities[0], "underlay");
  const [u, v] = underlayVectors(made);
  const [p, q] = made.clip!.map((point) => toPage(made.at, u, v, point));

  const want = [
    fromPage(made.at, u, v, [Math.min(p![0], q![0]), Math.max(p![1], q![1])]),
    fromPage(made.at, u, v, [Math.max(p![0], q![0]), Math.min(p![1], q![1])]),
  ];

  first!.clip!.forEach((point, i) => {
    assert.ok(Math.abs(point[0] - want[i]![0]) < 1e-6 && Math.abs(point[1] - want[i]![1]) < 1e-6);
  });
  assert.equal(read.underlays.length, 1);
  assert.equal(read.underlays[0]!.underlays, 2);
  assert.equal(read.underlayFrame, "screen");
});

test("pages are named by their file and page, and a file of another folder takes a number", () => {
  const names = underlayDefinitions([
    underlay({ path: "a/arch.pdf" }),
    underlay({ path: "a\\arch.pdf" }),
    underlay({ path: "a/arch.pdf", page: "2" }),
    underlay({ path: "b/arch.pdf" }),
  ]).map((d) => d.name);

  assert.deepEqual(names, ["arch - 1", "arch - 2", "arch (2) - 1"]);
});

test("the plot draws a page given, its frame by the drawing's setting, and a page not given as missing", () => {
  const pictures = { "arch.pdf": { "1": page(110, 85) } };
  const shown = toSVG(base([underlay()]), { underlays: pictures });
  assert.match(shown, /<use href="#tsdraft-image-0"/);
  assert.match(shown, /<path d="M 0 0 L 11 0 L 11 8\.5/);
  const screen = toSVG(base([underlay()], { underlayFrame: "screen" }), { underlays: pictures });
  assert.doesNotMatch(screen, /<path d="M 0 0 L 11 0/);
  const off = toSVG(base([underlay({ on: false })]), { underlays: pictures });
  assert.doesNotMatch(off, /<use/);
  assert.match(off, /<path d="M 0 0 L 11 0/);
  const missing = toSVG(base([underlay()]));
  assert.match(missing, />Missing or invalid reference</);
  assert.match(missing, />File: arch\.pdf</);
  assert.match(missing, />Sheet: 1</);
  assert.doesNotMatch(missing, /<path d="M 0 0 L 11 0/);
  assert.throws(
    () => toSVG(base([underlay()]), { underlays: { "arch.pdf": { "1": page(100, 100) } } }),
    RangeError,
  );
  const sheet: Layout = { name: "S", paper: "ANSI A", viewports: [], entities: [underlay()] };

  const pdf = toPDF(base([], { layouts: [sheet] }), {
    underlays: pictures,
    deflate: (b) => new Uint8Array(deflateSync(b)),
  });

  assert.ok(pdf.length > 0);
});

test("fade, contrast and monochrome give the colors the leading CAD app plots", () => {
  const plain = { fade: 0, contrast: 100, monochrome: false };
  assert.deepEqual(underlayColor([255, 0, 0], plain), [255, 0, 0]);
  assert.deepEqual(underlayColor([0, 0, 0], { ...plain, fade: 50 }), [128, 128, 128]);
  assert.deepEqual(underlayColor([255, 0, 0], { ...plain, monochrome: true }), [128, 128, 128]);
  // Contrast draws lightness toward a gray a little below the middle, keeping hue.
  const [r, g, b] = underlayColor([255, 0, 0], { ...plain, contrast: 20 });
  assert.ok(r > 225 && r < 240 && g === 0 && b === 0);
  const pictures = { "arch.pdf": { "1": page(110, 85) } };
  const plainSvg = toSVG(base([underlay()]), { underlays: pictures });
  const faded = toSVG(base([underlay({ fade: 40 })]), { underlays: pictures });
  assert.notEqual(plainSvg.match(/base64,[^"]*/)![0], faded.match(/base64,[^"]*/)![0]);
});

test("lint and the plot stay whole on underlays of hostile fields", () => {
  const hostile: Data[] = [
    { pageSize: [1e99, 1e99], scale: 1e99 },
    { pageSize: [1e-7, 1e-7] },
    { pageSize: "big" },
    { pageSize: [11, 8.5], clip: Array.from({ length: 20_000 }, (_, i) => [i, i % 7]) },
    { pageSize: [11, 8.5], clip: [[0, 0]] },
    { pageSize: [11, 8.5], clip: "none", invertClip: 1 },
    { pageSize: [11, 8.5], scale: -1, rotation: Infinity, fade: 0.5, contrast: 1e9 },
    { pageSize: [11, 8.5], page: "1".repeat(100_000), path: "a".repeat(40_000) },
    { pageSize: [11, 8.5], scale: 0 },
    { pageSize: [11, 8.5], fade: { toString: 1, valueOf: 2 }, contrast: [] },
  ];

  for (const fields of hostile) {
    const drawing = base([wrong({ ...dataOf(underlay()), ...fields })]);
    const found = lint(drawing);
    assert.ok(
      found.some((d) => d.severity === "error"),
      JSON.stringify(fields).slice(0, 80),
    );
    assert.throws(() => toDXF(drawing));

    // The plot draws what it can and leaves out what it cannot, never throwing but a RangeError.
    try {
      toSVG(drawing, { underlays: { "arch.pdf": { "1": page(11, 9) } } });
    } catch (error) {
      assert.ok(error instanceof RangeError, String(error));
    }
  }

  // A picture that is no PNG, and pages given in the wrong shape of option, draw as missing.
  for (const underlays of [
    { "arch.pdf": { "1": new Uint8Array([1, 2, 3]) } },
    { "arch.pdf": 5 },
    7,
  ]) {
    // SAFETY: pages given in the wrong shape of option on purpose, which the plot draws as missing.
    const svg = toSVG(base([underlay()]), { underlays } as never);

    assert.match(svg, /Missing or invalid reference/);
  }
});

test("a picture fits its page when one resolution draws both sides within a pixel", () => {
  // A tall schedule at 150 pixels an inch: 1237.5 by 5400, rounded up.
  assert.ok(pictureFits(1238, 5400, [8.25, 36]));
  assert.ok(pictureFits(110, 85, [11, 8.5]));
  // A4 upright, whose width at 150 pixels an inch is 1240.2, rounded up.
  assert.ok(pictureFits(1241, 1754, [595.276 / 72, 841.89 / 72]));
  assert.ok(!pictureFits(100, 100, [11, 8.5]));
  assert.ok(!pictureFits(1238, 5420, [8.25, 36]));
});

test("a view that reaches only the missing file's lines draws them", () => {
  const path = "Reference Drawings/Architect - Level 1 Revision 2026-11-21 and Previous Issues.pdf";
  const svg = toSVG(base([underlay({ path })]), { view: [12, 0.28, 12.5, 0.65] });
  assert.match(svg, /Previous Issues/);
});

test("readDXF refuses a clip the scale puts past the doubles", async () => {
  const d = createDrawing({ units: "in" })
    .underlay("arch.pdf", [0, 0], {
      pageSize: [11, 8.5],
      clip: [
        [1, 1],
        [5, 5],
      ],
    })
    .build();

  const written = toDXF(d);
  const at = written.indexOf("\r\nAcDbUnderlayReference\r\n");

  const dxf =
    written.slice(0, at) +
    written.slice(at).replace("\r\n280\r\n", "\r\n41\r\n1e308\r\n42\r\n1e308\r\n280\r\n");

  const read = await readDXF(dxf, { geometry: true });
  assert.equal((read.model.entities ?? []).filter((e) => e.kind === "underlay").length, 0);
  assert.ok(JSON.stringify(read.unread).includes("PDFUNDERLAY whose clip is past the doubles"));
});
