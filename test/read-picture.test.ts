import assert from "node:assert/strict";
import { test } from "node:test";
import sheet, { images } from "../examples/site-plan.ts";
import { isString } from "../src/guards.ts";
import { timeLimit, within } from "./time-limit.ts";
import { dataOf, wrong, type Field } from "./values.ts";
import {
  createDrawing,
  joinPicture,
  pictureDrawing,
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

test("an xref is given by its name in any case, under any name, and only as a read", () => {
  const notGiven = (r: DrawingRead, xrefs: Field) => ({
    ...pictureDrawing(r, { xrefs: wrong(xrefs) }).notes.notDrawn,
  });

  const host: DrawingRead = {
    ...read,
    xrefs: [{ name: "Base", path: "base.dwg", overlay: false }],
  };

  assert.deepEqual(notGiven(host, { BASE: dataOf(read) }), {});

  const proto: DrawingRead = {
    ...read,
    xrefs: [{ name: "__proto__", path: "p.dwg", overlay: false }],
  };

  const given = JSON.parse(`{"__proto__": ${JSON.stringify(read)}}`);
  const made = pictureDrawing(proto, { xrefs: given });

  assert.ok(Object.hasOwn(made.xrefs, "__proto__"));
  assert.equal(Object.getPrototypeOf(made.xrefs), null);

  assert.deepEqual(notGiven(host, { Base: { ...dataOf(read), unread: undefined } }), {
    "an xref whose read is not a DrawingRead": 1,
  });
});

test("a viewport takes its id from its handle only where the handle is hexadecimal", () => {
  const layout = read.layouts[0]!;
  const viewport = layout.viewports[0]!;

  const odd: DrawingRead = {
    ...read,
    layouts: [{ ...layout, viewports: [{ ...viewport, handle: '1"x' }] }, ...read.layouts.slice(1)],
  };

  const options = { images, layout: layout.name };

  assert.match(readPicture(read, options).svg, new RegExp(`data-id="vp${viewport.handle}"`));
  assert.doesNotMatch(readPicture(odd, options).svg, /data-id="vp1/);
});

test("a solid's spline edge of a degree past the most a spline has is counted, as it draws nothing", () => {
  const knots = [...Array<number>(13).fill(0), ...Array<number>(13).fill(1)];

  const controlPoints = Array.from({ length: 13 }, (_, i): [number, number, number] => [
    i,
    i % 2,
    0,
  ]);

  const solid: DrawingRead = {
    ...read,
    model: {
      ...read.model,
      entities: [
        {
          kind: "3dsolid",
          handle: "F01",
          layer: "0",
          edges: [{ kind: "spline", degree: 12, knots, controlPoints }],
        },
      ],
      drawOrder: [],
    },
  };

  assert.equal(readPicture(solid).notes.notDrawn["a spline edge of a degree over 11"], 1);
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

test("a multileader with no root draws its note where the file places it", () => {
  // A schedule's notes, held as a multileader of no leader, as in a firm's floor plan.
  const note = {
    kind: "multileader",
    handle: "F02",
    layer: "0",
    style: "Standard",
    shafts: [],
    at: [0, 0],
    direction: [1, 0],
    landing: 0,
    roots: [],
    shaft: "straight",
    text: "NOTES:\\P1.\tFIELD VERIFY",
    textAt: [10, 20],
    textAttachment: 1,
    width: 50,
    textHeight: 2,
    textStyle: "Standard",
    arrowSize: 2,
    attachments: { left: 1, right: 1, top: 9, bottom: 9 },
  } as const;

  const noted: DrawingRead = {
    ...read,
    model: { ...read.model, entities: [note], drawOrder: [] },
  };

  const picture = readPicture(noted);
  assert.match(picture.svg, /NOTES:/);
  assert.match(picture.svg, /FIELD VERIFY/);
  assert.equal(picture.notes.notDrawn["a multileader with no root"], undefined);
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
