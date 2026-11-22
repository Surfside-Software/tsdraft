import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDrawing,
  lint,
  pointStyleOf,
  readDXF,
  toDXF,
  toSVG,
  type Drawing,
  type PointStyle,
} from "../src/index.ts";
import { extents } from "../src/extents.ts";
import { readProblems } from "./read-agreement.ts";

import { recordFields } from "./dxf-groups.ts";

const header = (dxf: string, name: string): string | undefined => {
  const lines = dxf.split("\r\n");
  const at = lines.indexOf(name);
  return at < 0 ? undefined : lines[at + 2];
};

/** Each path of a point's figure in an SVG, as its numbers. */
function figure(svg: string): number[][] {
  return [...svg.matchAll(/<path d="([^"]+)"[^>]*data-part="figure"/g)].map((m) =>
    m[1]!
      .split(/[ MLA]+/)
      .filter((t) => t !== "")
      .map(Number),
  );
}

const sheet = (style: PointStyle, draw: (d: ReturnType<typeof createDrawing>) => void): Drawing => {
  const d = createDrawing({ pointStyle: style });
  d.layout("A", { paper: "ANSI B" }, () => draw(d));
  return d.build();
};

test("toDXF writes a point and the point style as the leading CAD app saves them", () => {
  const d = createDrawing({ pointStyle: { figure: "cross", circle: true, size: { percent: 10 } } });
  d.point([1, 2]);
  d.point([3, 4], { rotation: 30 });
  const dxf = toDXF(d.build());
  assert.deepEqual(recordFields(dxf, "POINT", "AcDbPoint"), ["10=1", "20=2", "30=0"]);
  // The file holds the angle the figure turns clockwise by.
  assert.deepEqual(recordFields(dxf, "POINT", "AcDbPoint", 1), ["10=3", "20=4", "30=0", "50=330"]);
  assert.equal(header(dxf, "$PDMODE"), "35");
  assert.equal(header(dxf, "$PDSIZE"), "-10");
  assert.equal(header(toDXF(createDrawing().build()), "$PDMODE"), undefined);
});

test("pointStyleOf reads PDMODE and PDSIZE as the leading CAD app plots them", () => {
  assert.deepEqual(pointStyleOf(35, -10), {
    figure: "cross",
    circle: true,
    size: { percent: 10 },
  });
  assert.deepEqual(pointStyleOf(100, 0.25), {
    figure: "tick",
    circle: true,
    square: true,
    size: 0.25,
  });
  // A mode the app does not offer plots as a dot, and a size of 0 as 5% of the view.
  assert.deepEqual(pointStyleOf(5, 0), { figure: "dot", size: { percent: 5 } });
  assert.deepEqual(pointStyleOf(131), { figure: "dot", size: { percent: 5 } });
  assert.deepEqual(pointStyleOf(), { figure: "dot", size: { percent: 5 } });
});

test("the builder and lint refuse a point style and a point the file cannot hold", () => {
  assert.throws(() => createDrawing({ pointStyle: { figure: "star" as "dot" } }), /figure must be/);
  assert.throws(() => createDrawing({ pointStyle: { figure: "plus", size: -1 as 1 } }), /size/);
  assert.throws(
    () => createDrawing({ pointStyle: { figure: "plus", size: { percent: 0 as 1 } } }),
    /percent/,
  );
  assert.throws(() => createDrawing({ dxf: "R12", pointStyle: { figure: "plus" } }), /R12/);
  assert.throws(() => createDrawing({ dxf: "R12" }).point([0, 0]), /R12/);
  assert.equal(createDrawing().point([0, 0], { rotation: -30 }).build().entities[0]!.kind, "point");
  assert.deepEqual(createDrawing().point([0, 0], { rotation: 390 }).build().entities[0], {
    kind: "point",
    layer: "0",
    at: [0, 0],
    rotation: 30,
  });

  const built = createDrawing().point([1, 1]).build();
  const messages = (drawing: Drawing) => lint(drawing).map((d) => d.message);
  assert.deepEqual(messages({ ...built, pointStyle: { figure: "plus", size: 1e100 as 1 } }), [
    "pointStyle's size: This value must be under 1e100, because the leading CAD app reads only two exponent digits from DXF and would take 1e+100 for 1e+10",
  ]);
  assert.ok(
    messages({ ...built, entities: [{ kind: "point", layer: "0", at: [0, 0], rotation: 360 }] })
      .join()
      .includes("rotation must be from 0 up to 360"),
  );
  assert.ok(
    messages({ ...built, dxf: "R12" })
      .join()
      .includes("no points to R12"),
  );
});

test("readDXF reads a point and the point style back as they were drawn", async () => {
  const d = createDrawing({ pointStyle: { figure: "plus", square: true, size: 0.5 } });
  d.point([1, 2]);
  d.point([3, 4], { rotation: 12.345678 });
  const built = d.build();
  const read = await readDXF(toDXF(built), { geometry: true });
  assert.deepEqual(readProblems(built, read, "tsdraft"), []);
  assert.deepEqual([read.header.pdmode, read.header.pdsize], [66, 0.5]);
  assert.deepEqual(pointStyleOf(read.header.pdmode, read.header.pdsize), built.pointStyle);
});

test("a point's figure is its style's size, or a share of half the view it is seen in", () => {
  const style: PointStyle = { figure: "plus", size: 0.25 };
  assert.deepEqual(
    figure(
      toSVG(
        sheet(style, (d) => d.point([2, 3])),
        { layout: "A" },
      ),
    ),
    [
      [1.75, 3, 2.25, 3],
      [2, 2.75, 2, 3.25],
    ],
  );
  // 10% of half the 11-inch sheet, and turned 90 degrees.
  const relative = sheet({ figure: "tick", size: { percent: 10 } }, (d) =>
    d.point([2, 3], { rotation: 90 }),
  );
  const [x0, y0, x1, y1] = figure(toSVG(relative, { layout: "A" }))[0]!;
  assert.deepEqual([x0, y0], [2, 3]);
  assert.ok(Math.abs(x1! - (2 - 0.275)) < 1e-6 && Math.abs(y1! - 3) < 1e-6);
});

test("under an insert a sized figure scales with it and a relative one does not", () => {
  const draw = (style: PointStyle) => {
    const d = createDrawing({ pointStyle: style });
    d.block("MARK", {}, () => d.point([0, 0]));
    d.layout("A", { paper: "ANSI B" }, () => d.insert("MARK", [2, 3], { scale: 2 }));
    return figure(toSVG(d.build(), { layout: "A" }));
  };
  // The tick runs from the point up half the size, in the block's units, scaled by 2.
  assert.deepEqual(draw({ figure: "tick", size: 0.25 }), [[2, 3, 2, 3.25]]);
  const [, , , top] = draw({ figure: "tick", size: { percent: 10 } })[0]!;
  assert.ok(Math.abs(top! - (3 + 0.275)) < 1e-6, String(top));
});

test("a dot alone plots a device pixel wide through a viewport, and the thinnest line on paper", () => {
  const d = createDrawing();
  d.point([5, 5]);
  d.layout("A", { paper: "ANSI B" }, (sheet) => {
    d.point([1, 1]);
    sheet.viewport([2, 2], 4, 4, { center: [5, 5], ratio: 2 });
  });
  const svg = toSVG(d.build(), { layout: "A" });
  const strokes = [...svg.matchAll(/<path [^>]*data-part="figure"[^>]*>/g)].map((m) => m[0]);
  assert.equal(strokes.length, 2);
  assert.ok(strokes.some((s) => s.includes("data-thinnest")));
  // 1/600 inch on the sheet, in model units at a ratio of 2.
  assert.ok(
    strokes.some((s) => /stroke-width="0\.00333333/.test(s)),
    strokes.join("\n"),
  );
});

test("a point counts in the extents at its point alone", () => {
  const d = createDrawing({ pointStyle: { figure: "plus", circle: true, size: 10 } });
  d.point([1, 2]);
  d.point([3, 5]);
  assert.deepEqual(extents(d.build().entities), [1, 2, 3, 5]);
});

test("a figure that reaches into a view is drawn, from an insert and in a cropped sheet", () => {
  const count = (svg: string) => (svg.match(/data-part="figure"/g) ?? []).length;
  const d = createDrawing({ pointStyle: { figure: "plus", size: 1 } });
  d.block("MARK", {}, () => d.point([0, 0]));
  // Its arm, 2 long under the scale, reaches the viewport's edge at x = 7 from 5.75.
  d.insert("MARK", [7.75, 6], { scale: 2 });
  d.layout("A", { paper: "ANSI B" }, (s) => s.viewport([1, 1], 4, 4, { center: [5, 5], ratio: 1 }));
  assert.equal(count(toSVG(d.build(), { layout: "A" })), 2);

  // A quarter of half the viewport's 8, whatever part of the sheet the picture shows.
  const r = createDrawing({ pointStyle: { figure: "plus", size: { percent: 25 } } });
  r.point([5, 4.8]);
  r.layout("A", { paper: "ANSI B" }, (s) =>
    s.viewport([2, 2], 10, 8, { center: [5, 4], ratio: 1 }),
  );
  assert.equal(count(toSVG(r.build(), { layout: "A", view: [2, 2, 12, 6] })), 2);
});

test("a point or a point style lint refuses is no throw for the writers", () => {
  const built = createDrawing().build();
  const broken = { ...built, entities: [{ kind: "point", layer: "0", at: null }] } as never;
  assert.doesNotThrow(() => toSVG(broken));
  const odd = { figure: "plus", metadata: 0n } as unknown as PointStyle;
  assert.deepEqual(
    lint({ ...built, pointStyle: odd }).map((d) => d.message),
    ['pointStyle has a field it does not know, "metadata"'],
  );
  assert.throws(() => createDrawing({ pointStyle: odd }), /does not know/);
  // The builder keeps a copy of the style, not the object it was given.
  const size = { percent: 5 };
  const style = createDrawing({ pointStyle: { figure: "plus", size } }).build().pointStyle!;
  assert.notEqual(style.size, size);
});

test("hostile points, styles and block chains are no throw and no runaway work", () => {
  const built = createDrawing().build();
  for (const at of [
    [0n, 0],
    [{}, 0],
  ]) {
    const svg = toSVG({ ...built, entities: [{ kind: "point", layer: "0", at }] } as never);
    assert.ok(!svg.includes("NaN"));
  }
  const listed = { figure: "plus", size: Object.assign(Array(1), { percent: 5 }) };
  assert.equal(lint({ ...built, pointStyle: listed } as never).length, 1);
  const [long] = lint({
    ...built,
    pointStyle: { figure: "plus", ["\0".repeat(100_000)]: 1 },
  } as never);
  assert.ok(long!.message.length < 400, long!.message.slice(0, 200));

  // A chain of blocks deeper than the call stack, and a frozen insert whose scale is no number.
  const blocks = Array.from({ length: 10_000 }, (_, i) => ({
    name: `B${i}`,
    base: [0, 0],
    entities: [
      i === 9_999
        ? { kind: "point", layer: "0", at: [0, 0] }
        : { kind: "insert", layer: "0", block: `B${i + 1}`, at: [0, 0] },
    ],
  }));
  const odd = {
    kind: "insert",
    layer: "OFF",
    block: "B9999",
    at: [0, 0],
    scale: [Object.create(null), 1],
  };
  const deep = {
    ...built,
    layers: [...built.layers, { name: "OFF", frozen: true }],
    blocks,
    entities: [
      { kind: "line", layer: "0", from: [0, 0], to: [1, 1] },
      odd,
      { kind: "insert", layer: "0", block: "B0", at: [50, 50] },
    ],
  } as never;
  assert.doesNotThrow(() => toSVG(deep, { view: [0, 0, 1, 1] }));

  // Many inserts of one long name work out its key once.
  const name = "N".repeat(100_000);
  const many = {
    ...built,
    blocks: [{ name, base: [0, 0], entities: [{ kind: "point", layer: "0", at: [0, 0] }] }],
    entities: Array.from({ length: 2_000 }, () => ({
      kind: "insert",
      layer: "0",
      block: name,
      at: [50, 50],
    })),
  } as never;
  const start = performance.now();
  toSVG(many, { view: [0, 0, 1, 1] });
  assert.ok(performance.now() - start < 3_000);
});
