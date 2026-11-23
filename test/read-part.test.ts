import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkDrawingRead,
  createDrawing,
  OUTSIDE_THE_READ,
  partFilter,
  readDXF,
  ReadError,
  toDXF,
  viewportWindow,
  type DrawingRead,
  type ReadEntity,
  type ReadPart,
} from "../src/index.ts";
import { PART_AREA, partDrawing } from "./part-drawing.ts";
import { wrong } from "./values.ts";

const layers = (read: DrawingRead): string[] => read.model.entities!.map((e) => e.layer);

test("a read by layout keeps of model space what the layouts' windows and the areas meet", async () => {
  const dxf = toDXF(partDrawing());
  const whole = await readDXF(dxf, { geometry: true });

  const read = await readDXF(dxf, {
    geometry: true,
    only: { layouts: ["a", "B"], areas: [PART_AREA] },
  });

  assert.deepEqual(checkDrawingRead(JSON.parse(JSON.stringify(read))), []);
  const inside = layers(whole).filter((l) => l.startsWith("IN-"));
  assert.deepEqual(layers(read), inside);
  assert.equal(read.model.other![OUTSIDE_THE_READ], layers(whole).length - inside.length);
  // The layouts as the file spells them, and the area with its lower corner first.
  assert.deepEqual(read.only, {
    layouts: ["A", "B"],
    areas: [
      [
        [290, 290],
        [300, 300],
      ],
    ],
  });
  // A layout not named keeps its census and no entities.
  const c = read.layouts.find((l) => l.name === "C")!;
  assert.equal(c.entities, undefined);
  assert.equal(Object.keys(c.census.layers).length > 0, true);

  for (const name of ["A", "B"])
    assert.equal(read.layouts.find((l) => l.name === name)!.entities!.length, 1);
  // The census and the blocks stay whole.
  assert.deepEqual(read.model.census, whole.model.census);
  assert.deepEqual(read.blocks, whole.blocks);
});

test("a read by areas alone keeps no layout's paper", async () => {
  const read = await readDXF(toDXF(partDrawing()), {
    geometry: true,
    only: { areas: [PART_AREA] },
  });

  assert.deepEqual(layers(read), ["IN-AREA"]);
  assert.ok(read.layouts.every((l) => l.entities === undefined));
});

test("a read by layout refuses a name the file lacks, Model, an empty part, an area not of two finite corners and too many", async () => {
  const dxf = toDXF(partDrawing());

  for (const [only, message] of [
    [{ layouts: ["D"] }, /no layout named "D"; it has "A", "B", "C"/],
    [{ layouts: ["model"] }, /names `Model`/],
    [{}, /names no layout and no area/],
    [{ layouts: [], areas: [] }, /names no layout and no area/],
    [
      {
        areas: [
          [
            [0, 0],
            [Number.NaN, 1],
          ],
        ],
      },
      /not two corners/,
    ],
    [{ areas: [[[0, 0]]] }, /not two corners/],
    [{ layouts: "A" }, /each as a list/],
    [{ areas: Array.from({ length: 1025 }, () => PART_AREA) }, /more than 1024/],
  ] as const)
    await assert.rejects(
      readDXF(dxf, { geometry: true, only: wrong<ReadPart>(only) }),
      (e) => e instanceof ReadError && message.test(e.message),
    );
  // Without geometry `only` changes nothing.
  const plain = await readDXF(dxf, { only: { layouts: ["D"] } });
  assert.equal(plain.only, undefined);
});

test("a viewport's window is its rectangle at its ratio, turned by its twist", () => {
  const base = {
    layer: "0",
    center: [0, 0] as const,
    viewCenter: [10, 20] as const,
    on: true,
    frozenLayers: [],
    turnedView: false,
  };

  assert.deepEqual(
    viewportWindow({ ...base, width: 4, height: 2, viewHeight: 4, ratio: 0.5, twist: 0 }),
    [
      [6, 18],
      [14, 18],
      [14, 22],
      [6, 22],
    ],
  );

  // A quarter turn counterclockwise of the view turns the window clockwise in model space.
  const turned = viewportWindow({
    ...base,
    width: 4,
    height: 2,
    viewHeight: 2,
    ratio: 1,
    twist: 90,
  })!;

  const near = (p: readonly number[], q: readonly number[]) =>
    assert.ok(Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!) < 1e-12, `${p} is not ${q}`);

  near(turned[0], [9, 22]);
  near(turned[1], [9, 18]);
  assert.equal(
    viewportWindow({ ...base, width: 4, height: 2, viewHeight: 0, ratio: 0, twist: 0 }),
    undefined,
  );
});

test("paragraph text that its codes enlarge reaches as far as they make it", async () => {
  const read = await readDXF(toDXF(partDrawing()), {});
  const { keeps } = partFilter(read, { layouts: ["A"] });

  const mtext = (value: string): ReadEntity => ({
    kind: "mtext",
    layer: "0",
    at: [20, 50],
    height: 0.5,
    width: 0,
    attachment: 1,
    rotation: 0,
    style: "Standard",
    value,
    lineSpacing: 1,
    lineSpacingStyle: "at-least",
  });

  // Twenty characters at a height of 0.5 start 25 left of the window, and reach it only when ten
  // times taller.
  assert.equal(keeps(mtext("TWENTY CHARACTERS AB")), false);
  assert.equal(keeps(mtext("\\H10x;TWENTY CHARACTERS AB")), true);
  assert.equal(keeps(mtext("\\H5;TWENTY CHARACTERS AB")), true);
  assert.equal(keeps(mtext("\\W10;TWENTY CHARACTERS AB")), true);
});

test("a read by layout keeps what it cannot box: an insert of a block that counts a kind, and a spline by fit points alone", async () => {
  const read = await readDXF(toDXF(partDrawing()), {});

  const counting = {
    ...read,
    blocks: [
      ...read.blocks,
      {
        handle: "F00",
        name: "COUNTS",
        base: [0, 0] as const,
        anonymous: false,
        attributeDefinitions: [],
        entities: [{ kind: "line", layer: "0", from: [0, 0], to: [0.5, 0] } satisfies ReadEntity],
        other: { "3DFACE": 1 },
      },
    ],
  };

  const { keeps } = partFilter(counting, { layouts: ["A"] });

  const insert = (block: string): ReadEntity => ({
    kind: "insert",
    layer: "0",
    block,
    at: [0, 0],
    scale: [1, 1],
    rotation: 0,
    tags: {},
  });

  assert.equal(keeps(insert("COUNTS")), true);
  assert.equal(keeps(insert("BOX")), false);

  const spline = (controlPoints: [number, number][]): ReadEntity => ({
    kind: "spline",
    layer: "0",
    degree: 3,
    knots: [],
    controlPoints,
    closed: false,
    fitPoints: [
      [44, 45],
      [56, 45],
    ],
  });

  assert.equal(keeps(spline([])), true);
  assert.equal(
    keeps(
      spline([
        [44, 45],
        [44, 44],
        [56, 44],
        [56, 45],
      ]),
    ),
    false,
  );
  // A paragraph of many columns is boxed without spreading its heights into one call, and so many
  // reach the window.
  const heights = Array.from({ length: 300_000 }, () => 1);
  assert.equal(
    keeps({
      kind: "mtext",
      layer: "0",
      at: [500, 500],
      height: 1,
      width: 1,
      attachment: 1,
      rotation: 0,
      style: "Standard",
      value: "X",
      lineSpacing: 1,
      lineSpacingStyle: "at-least",
      columns: { heights },
    }),
    true,
  );
});

test("a read by layout takes no window from a layout's own view of its paper, numbered 0 as the CAD app's DXF numbers it off the layout it opens on", async () => {
  const d = createDrawing({ units: "in" });
  d.line([4, 5], [6, 5]);

  for (const name of ["A", "B"])
    d.layout(name, { paper: "ARCH D" }, (page) =>
      page.viewport([1, 1], 2, 2, { center: [100, 100], ratio: 1 }),
    );
  const dxf = toDXF(d.build());
  // B's paper space is in BLOCKS: its viewports' group 69 made 0.
  const at = dxf.indexOf("*Paper_Space0");

  const renumbered =
    dxf.slice(0, at) + dxf.slice(at).replaceAll(/\n69\r\n[12]\r\n/g, "\n69\r\n0\r\n");

  assert.notEqual(renumbered, dxf);
  const read = await readDXF(renumbered, { geometry: true, only: { layouts: ["B"] } });
  assert.deepEqual(read.model.entities, []);
});

test("a read by layout tells layouts apart by their names as the CAD app does", async () => {
  const d = createDrawing({ units: "in" });
  d.layer("MODEL0", {}, () => d.line([-0.5, 0], [0.5, 0]));
  d.layer("MODEL1", {}, () => d.line([99.5, 0], [100.5, 0]));
  d.layout("Straße", { paper: "ARCH D" }, (page) =>
    page.viewport([1, 1], 2, 2, { center: [0, 0], ratio: 1 }),
  );
  d.layout("Strasse", { paper: "ARCH D" }, (page) =>
    page.viewport([1, 1], 2, 2, { center: [100, 0], ratio: 1 }),
  );
  const read = await readDXF(toDXF(d.build()), { geometry: true, only: { layouts: ["Straße"] } });
  assert.deepEqual(read.only?.layouts, ["Straße"]);
  assert.deepEqual(layers(read), ["MODEL0"]);
});

test("a read by layout keeps a slanted text and an arrowhead that reach into a window", async () => {
  const d = createDrawing();
  d.textStyle({ name: "LEAN", font: "Arial", obliqueAngle: 85 });
  d.text([-5, 0], "M", { height: 1, style: "LEAN" });
  d.block("TAG", {}, () => d.text([0, 0], "M", { height: 1, style: "LEAN" }));
  d.insert("TAG", [-5, 0]);
  d.layout("S", { paper: "ARCH D" }, (page) =>
    page.viewport([1, 1], 1, 1, { center: [0, 0.5], ratio: 1 }),
  );
  const read = await readDXF(toDXF(d.build()), { geometry: true, only: { layouts: ["S"] } });
  assert.equal(read.model.entities!.length, 2);
});

test("a read by layout of a stream holds a copy of each piece, and refuses a bad stream as it arrives", async () => {
  const text = toDXF(partDrawing());
  const bytes = new TextEncoder().encode(text);
  const only = { layouts: ["A"] };

  // One buffer handed over again and again, as a reader of a socket may.
  // A Buffer too, whose `slice` shares its memory.
  for (const buffer of [new Uint8Array(4096), new Uint8Array(64), Buffer.alloc(4096)])
    assert.deepEqual(
      await readDXF(reused(buffer), { geometry: true, only }),
      await readDXF(text, { geometry: true, only }),
    );

  async function* reused(buffer: Uint8Array): AsyncGenerator<Uint8Array> {
    for (let i = 0; i < bytes.length; i += buffer.length) {
      const piece = bytes.subarray(i, i + buffer.length);
      buffer.set(piece);
      yield buffer.subarray(0, piece.length);
    }
  }

  // A group code that is not a number, refused before the stream is pulled again.
  async function* broken(): AsyncGenerator<Uint8Array> {
    yield new TextEncoder().encode(
      "0\r\nSECTION\r\n2\r\nHEADER\r\n9\r\n$ACADVER\r\n1\r\nAC1032\r\n9\r\n$DWGCODEPAGE\r\n3\r\nANSI_1252\r\n0\r\nENDSEC\r\nCODE\r\nVALUE\r\n",
    );
    throw new Error("pulled again");
  }

  await assert.rejects(readDXF(broken(), { geometry: true, only }), ReadError);
  await assert.rejects(readDXF(text, { geometry: true, only: wrong<ReadPart>(null) }), ReadError);
});

test("a read by layout keeps an old leader of an annotative style, which draws at a scale the read does not hold", async () => {
  const read = await readDXF(toDXF(partDrawing()), {});

  const styled = (annotative: boolean): DrawingRead => ({
    ...read,
    dimensionStyles: [{ name: "NOTES", annotative, scale: 1, arrowSize: 0.125 }],
  });

  const leader: ReadEntity = {
    kind: "leader",
    layer: "0",
    style: "NOTES",
    points: [
      [40, 12],
      [25, 12],
    ],
    shaft: "straight",
    arrowhead: true,
  };

  const area = {
    areas: [
      [
        [0, 0],
        [24, 24],
      ],
    ] as const,
  };

  assert.equal(partFilter(styled(true), area).keeps(leader), true);
  assert.equal(partFilter(styled(false), area).keeps(leader), false);
});

test("paragraph text that its tracking spreads reaches as far as it makes it", async () => {
  const read = await readDXF(toDXF(partDrawing()), {});
  const { keeps } = partFilter(read, { layouts: ["A"] });

  const mtext = (value: string): ReadEntity => ({
    kind: "mtext",
    layer: "0",
    at: [20, 50],
    height: 0.5,
    width: 0,
    attachment: 1,
    rotation: 0,
    style: "Standard",
    value,
    lineSpacing: 1,
    lineSpacingStyle: "at-least",
  });

  // A line of wide letters that does not wrap, spread four times, starts 25 left of the window.
  assert.equal(keeps(mtext("WWWWWWWWWWWWWWWWWWWW")), false);
  assert.equal(keeps(mtext("\\T4;WWWWWWWWWWWWWWWW")), true);
});
