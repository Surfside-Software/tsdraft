import assert from "node:assert/strict";
import { test } from "node:test";
import sheet, { images } from "../examples/site-plan.ts";
import { isString } from "../src/guards.ts";
import { timeLimit, within } from "./time-limit.ts";
import { dataOf, wrong } from "./values.ts";
import {
  createDrawing,
  joinPicture,
  readDXF,
  readPicture,
  svgToPDF,
  toDXF,
  toSVG,
  type DrawingRead,
  type PicturePiece,
  type PictureRun,
  type Point,
} from "../src/index.ts";

const read = await readDXF(toDXF(sheet), { geometry: true });

/** Xrefs given as reads, each with the reads of its own, which may hold the xref again. */
interface Pool {
  [name: string]: { read: DrawingRead; xrefs: Pool };
}

const runsOf = (pieces: readonly PicturePiece[]): PictureRun[] =>
  pieces.filter((p): p is PictureRun => !isString(p) && p.kind === "fragments");

test("a read's picture joins back from its fragments, one for each entity that shows", () => {
  for (const layout of [undefined, ...read.layouts.map((l) => l.name)]) {
    const options = { images, ...(layout !== undefined && { layout }) };
    const picture = readPicture(read, options);
    assert.equal(joinPicture(picture.pieces, picture.defs), picture.svg);
    assert.equal(toSVG(read, options), picture.svg);

    for (const run of runsOf(picture.pieces)) {
      // An entity's fragment holds all that was made of it: an insert and its attributes are one.
      const handles = run.fragments.map((f) => f.handle);
      assert.equal(new Set(handles).size, handles.length, `${layout} ${run.space} ${run.viewport}`);
      assert.ok(handles.every((h) => h !== undefined));
    }
  }

  const sheetRuns = runsOf(readPicture(read, { images, layout: "C-101" }).pieces);
  assert.deepEqual(
    sheetRuns.map((run) => [run.space, run.viewport]),
    [
      ["model", 0],
      ["model", 1],
      ["paper", undefined],
    ],
  );
  // The paper's fragments are in the order of the layout's entities, and each shows.
  const paper = sheetRuns[2]!;
  assert.deepEqual(
    paper.fragments.map((f) => f.index),
    read.layouts[0]!.entities!.map((_, i) => i),
  );
});

test("a fragment's ids are its own, so it keeps whatever is drawn around it", async () => {
  const d = createDrawing({ units: "ft" });
  d.layer("FILL", { color: 3 });

  const loop = (x: number) => ({
    points: [
      [x, 0],
      [x + 10, 0],
      [x + 10, 10],
      [x, 10],
    ] satisfies Point[],
  });

  const gradient = {
    name: "linear",
    colors: [
      [255, 0, 0],
      [0, 0, 255],
    ],
  } as const;

  d.hatch([loop(0)], { gradient });
  d.hatch([loop(20)], { gradient });
  const both = await readDXF(toDXF(d.build()), { geometry: true });
  const picture = readPicture(both);
  const [first, second] = runsOf(picture.pieces)[0]!.fragments;
  assert.equal(first!.defs.length, 1);
  assert.match(first!.defs[0]!, new RegExp(`^tsdraft-gradient-h${first!.handle}-`));

  // Drawn without the first, the second's fragment is the same.
  const alone: DrawingRead = {
    ...both,
    model: { ...both.model, entities: both.model.entities!.slice(1) },
  };

  const again = runsOf(readPicture(alone).pieces)[0]!.fragments[0]!;
  assert.equal(
    again.svg!.replaceAll(/data-entity="\d+"/g, ""),
    second!.svg!.replaceAll(/data-entity="\d+"/g, ""),
  );
  assert.deepEqual(again.defs, second!.defs);
});

test("an xref at the top of a space is a run of its own, a fragment for each of its entities", () => {
  // A host whose model space overlays the example's as the xref BASE, which a sheet shows.
  const host: DrawingRead = {
    ...read,
    xrefs: [{ name: "BASE", path: "base.dwg", overlay: true }],
    model: {
      ...read.model,
      entities: [
        {
          kind: "insert",
          handle: "F00",
          layer: "0",
          block: "BASE",
          at: [0, 0],
          scale: [1, 1],
          rotation: 0,
          tags: {},
        },
      ],
      drawOrder: [],
    },
  };

  for (const layout of [undefined, "C-101"]) {
    const picture = readPicture(host, { images, xrefs: { BASE: read }, ...(layout && { layout }) });
    assert.equal(joinPicture(picture.pieces, picture.defs), picture.svg);
    const run = runsOf(picture.pieces)[0]!;
    assert.equal(run.fragments[0]!.handle, "F00");
    const xref = run.fragments[0]!.run!;
    assert.equal(xref.xref, "BASE");
    // Each of the xref's entities that shows, by its handle in the xref's file.
    const handles = xref.fragments.map((f) => f.handle);
    assert.ok(handles.length > 50, `${handles.length}`);
    assert.equal(new Set(handles).size, handles.length);
    assert.ok(handles.every((h) => read.model.entities!.some((e) => e.handle === h)));
  }
});

test("the notes count what a read keeps and the picture cannot draw as the file holds it", () => {
  const firm: DrawingRead = {
    ...read,
    textStyles: read.textStyles.map((s) =>
      s.name === "Standard" ? { ...s, font: "romans2.shx" } : s,
    ),
    model: { ...read.model, other: { OLE2FRAME: 2 } },
  };

  const { notes } = readPicture(firm);
  assert.deepEqual(notes.fonts, [
    { style: "Standard", font: "romans2.shx", drawnIn: "romans.shx" },
  ]);
  assert.equal(notes.notDrawn["OLE2FRAME"], 2);
});

test("a value that is not a read is refused with a RangeError", () => {
  assert.throws(
    () => readPicture(wrong<DrawingRead>({ ...dataOf(read), layers: 5 })),
    (error) => error instanceof RangeError && /not a DrawingRead/.test(error.message),
  );
});

test("an xref whose drawing is not given is counted, as it draws nothing", () => {
  const host: DrawingRead = { ...read, xrefs: [{ name: "BASE", path: "base.dwg", overlay: true }] };
  assert.equal(readPicture(host).notes.notDrawn["an xref whose drawing is not given"], 1);
  assert.equal(
    readPicture(host, { xrefs: { BASE: read } }).notes.notDrawn[
      "an xref whose drawing is not given"
    ],
    undefined,
  );
});

test("an old leader's arrowhead is closed and filled, whatever its style's DIMBLK", () => {
  const leader = {
    kind: "leader",
    handle: "F01",
    layer: "0",
    style: "Standard",
    points: [
      [0, 0],
      [5, 5],
      [8, 5],
    ],
    shaft: "straight",
    arrowhead: true,
  } as const;

  const dotted: DrawingRead = {
    ...read,
    dimensionStyles: [{ name: "Standard", annotative: false, arrowheadBlock: "_Dot" }],
    model: { ...read.model, entities: [leader], drawOrder: [] },
  };

  const svg = readPicture(dotted).svg;
  assert.doesNotMatch(svg, /<circle[^>]*data-part="arrowhead"/);
  assert.match(svg, /data-part="arrowhead"/);
});

test("a handle the readers do not make keys nothing and scopes no id", () => {
  // Hatches whose handles are long and of one length, which V8 hashes by their length alone, and
  // one whose handle holds markup.
  const long = (i: number) => "A".repeat(19_992) + String(i).padStart(8, "0");
  const base = read.model.entities!.find((e) => e.kind === "polyline")!;

  const hatch = (handle: string) => ({
    kind: "hatch" as const,
    handle,
    layer: base.layer,
    pattern: "SOLID",
    solid: true,
    style: "normal" as const,
    loops: [
      {
        points: [
          [0, 0],
          [1, 0],
          [1, 1],
        ] satisfies Point[],
        flags: 1,
      },
    ],
    gradient: { name: "LINEAR", angle: 0, centered: true, colors: [0xff0000, 0x0000ff] },
  });

  const entities = [
    ...Array.from({ length: 2000 }, (_, i) => hatch(long(i))),
    hatch('1"/><script>x</script>'),
  ];

  const hostile: DrawingRead = {
    ...read,
    model: { ...read.model, entities, drawOrder: [long(0), long(1)] },
  };

  const picture = within(timeLimit(4000), () => readPicture(hostile));
  assert.doesNotMatch(picture.svg, /<script/);
  assert.equal(joinPicture(picture.pieces, picture.defs), picture.svg);
});

test("xrefs given as a cycle, or shared by many, are converted once and draw", () => {
  const host: DrawingRead = { ...read, xrefs: [{ name: "BASE", path: "base.dwg", overlay: true }] };
  const xrefs: Pool = {};
  xrefs["BASE"] = { read: host, xrefs };
  assert.match(readPicture(host, { xrefs }).svg, /^<svg /);
  let shared: Pool = {};

  for (let i = 0; i < 24; i++) {
    const node = { read: host, xrefs: shared };
    shared = { BASE: node, OTHER: node };
  }

  within(timeLimit(2000), () => readPicture(host, { xrefs: shared }));
});

test("a viewport freezes an xref's layer by the name its host holds it by", () => {
  const sheet = read.layouts[0]!;

  const host: DrawingRead = {
    ...read,
    xrefs: [{ name: "BASE", path: "base.dwg", overlay: true }],
    model: {
      ...read.model,
      entities: [
        {
          kind: "insert",
          handle: "F00",
          layer: "0",
          block: "BASE",
          at: [0, 0],
          scale: [1, 1],
          rotation: 0,
          tags: {},
        },
      ],
      drawOrder: [],
    },
    layouts: [
      {
        ...sheet,
        viewports: sheet.viewports.map((v) => ({
          ...v,
          frozenLayers: read.layers.map((l) => `BASE|${l.name}`),
        })),
        entities: [],
      },
    ],
  };

  const svg = readPicture(host, { layout: sheet.name, xrefs: { BASE: read } }).svg;
  assert.doesNotMatch(svg, /data-layer="BASE\|/);
});

test("an xref's own attachment draws from the reads given, and a mirrored fitted text spans its points", () => {
  const insertOf = (block: string) =>
    ({
      kind: "insert",
      handle: "F0" + block.length,
      layer: "0",
      block,
      at: [0, 0],
      scale: [1, 1],
      rotation: 0,
      tags: {},
    }) as const;

  const base: DrawingRead = {
    ...read,
    xrefs: [{ name: "SURVEY", path: "survey.dwg", overlay: false }],
    model: { ...read.model, entities: [insertOf("SURVEY")], drawOrder: [] },
  };

  const host: DrawingRead = {
    ...read,
    xrefs: [{ name: "BASE", path: "base.dwg", overlay: false }],
    model: { ...read.model, entities: [insertOf("BASE")], drawOrder: [] },
  };

  const pool: Pool = {};
  pool["BASE"] = { read: base, xrefs: pool };
  pool["SURVEY"] = { read, xrefs: pool };
  assert.match(readPicture(host, { xrefs: pool }).svg, /data-layer="SURVEY\|/);
  assert.equal(
    readPicture(host, { xrefs: { BASE: base } }).notes.notDrawn[
      "an xref whose drawing is not given"
    ],
    1,
  );

  const text = {
    kind: "text",
    handle: "F10",
    layer: "0",
    value: "EXIT",
    at: [1000, 1000],
    stored: [1000, 1000],
    alignAt: [1010, 1000],
    align: "fit",
    startFrom: "file",
    height: 1,
    rotation: 0,
    style: "Standard",
  } as const;

  const drawnWith = (backward: boolean) =>
    readPicture(
      { ...read, model: { ...read.model, entities: [{ ...text, backward }], drawOrder: [] } },
      { margin: 0 },
    ).svg;

  const box = (svg: string) => /viewBox="([^"]+)"/.exec(svg)![1];
  assert.equal(box(drawnWith(true)), box(drawnWith(false)));
});

test("a faded image, clipped or not, is drawn faded and plots", () => {
  const faded: DrawingRead = {
    ...read,
    layouts: read.layouts.map((l) => ({
      ...l,
      entities: l.entities!.map((e) =>
        e.kind === "image"
          ? { ...e, fade: 50, clip: [e.at, [e.at[0] + 1, e.at[1] + 1]] satisfies Point[] }
          : e,
      ),
    })),
  };

  const sheet = readPicture(faded, { images, layout: "C-101" }).svg;
  assert.match(sheet, /<g opacity="0\.50196"><g clip-path=/);
  assert.ok(svgToPDF([sheet]).length > 1000);
});

test("an xref draws its own images, given beside its read", () => {
  const host: DrawingRead = {
    ...read,
    xrefs: [{ name: "BASE", path: "base.dwg", overlay: true }],
    layouts: read.layouts.map((l) => ({
      ...l,
      entities: [
        {
          kind: "insert",
          handle: "F00",
          layer: "0",
          block: "BASE",
          at: [0, 0],
          scale: [1, 1],
          rotation: 0,
          tags: {},
        },
      ],
    })),
  };

  const sheetOnly: DrawingRead = {
    ...read,
    model: { ...read.model, entities: read.layouts[0]!.entities!, drawOrder: [] },
  };

  const without = readPicture(host, { layout: "C-101", xrefs: { BASE: sheetOnly } }).svg;

  const withImages = readPicture(host, {
    layout: "C-101",
    xrefs: { BASE: { read: sheetOnly, images } },
  }).svg;

  assert.doesNotMatch(without, /data:image\/png/);
  assert.match(withImages, /data:image\/png/);
});
