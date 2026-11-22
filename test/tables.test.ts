// Tables (docs/tables.md): the rules the reviews of the first tables proved, each with the
// smallest drawing that shows it.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDrawing,
  inspectText,
  lint,
  readDXF,
  toDXF,
  toSVG,
  type Drawing,
} from "../src/index.ts";
import { referencedByKey } from "../src/blocks.ts";
import { extents } from "../src/extents.ts";
import { TABLE_COLOR } from "../src/rules.ts";
import { tableCost, tableRepeats } from "../src/tables.ts";
import { within } from "./time-limit.ts";

const boxOf = (d: Drawing, xrefs?: Parameters<typeof referencedByKey>[1]) =>
  extents(
    d.entities,
    d.textStyles,
    d.blocks,
    undefined,
    undefined,
    xrefs && referencedByKey(d, xrefs),
    undefined,
    undefined,
    undefined,
    d.tableStyles,
  );

/** A drawing whose one table holds the block `TAG`, a circle of radius 10, at a scale of 1. */
function tagged(): Drawing {
  const d = createDrawing({ units: "in" });
  d.block("TAG", {}, () => d.circle([0, 0], 10));
  d.tableStyle({ name: "S", textHeight: 1 });
  d.table({ style: "S", at: [0, 0], columns: [4], rows: [[{ block: "TAG", blockScale: 1 }]] });
  return d.build();
}

test("a referenced drawing's table draws and boxes the block in each of its cells", () => {
  const source = tagged();
  const host = createDrawing({ units: "in" });
  host.xref("BASE", "base.dwg");
  host.insert("BASE", [100, 0]);
  const drawn = host.build();
  const circles = (svg: string) => svg.match(/<(circle|ellipse)\b/g)?.length ?? 0;
  assert.equal(circles(toSVG(source)), 1);
  assert.equal(circles(toSVG(drawn, { xrefs: { BASE: source } })), 1);
  const own = boxOf(source);
  const placed = boxOf(drawn, { BASE: source });
  assert.deepEqual(
    placed.map((v, i) => v - (i % 2 === 0 ? 100 : 0)),
    own,
  );
  assert.ok(own[0] < 0 && own[2] > 4, "the block reaches past its column");
});

test("a referenced drawing's table draws one block in two cells twice", () => {
  const d = createDrawing({ units: "in" });
  d.block("TAG", {}, () => d.circle([0, 0], 1));
  d.tableStyle({ name: "S", textHeight: 1 });
  d.table({
    style: "S",
    at: [0, 0],
    columns: [4, 4],
    rows: [[{ block: "TAG" }, { block: "TAG" }]],
  });
  const host = createDrawing({ units: "in" });
  host.xref("BASE", "base.dwg");
  host.insert("BASE", [100, 0]);
  const svg = toSVG(host.build(), { xrefs: { BASE: d.build() } });
  assert.equal(svg.match(/<(circle|ellipse)\b/g)?.length ?? 0, 2);
});

test("a table's box holds what a cell's block draws through an xref", () => {
  const far = createDrawing({ units: "in" });
  far.circle([1000, 0], 2);
  const d = createDrawing({ units: "in" });
  d.xref("FAR", "far.dwg", { attach: true });
  d.block("TAG", {}, () => d.insert("FAR", [0, 0]));
  d.tableStyle({ name: "S", textHeight: 1 });
  d.table({ style: "S", at: [0, 0], columns: [4], rows: [[{ block: "TAG", blockScale: 1 }]] });
  const schedule = d.build();
  const given = { FAR: far.build() };
  // The block draws nothing of its own, so it sits at its cell's top center, as the writers put it.
  assert.ok(Math.abs(boxOf(schedule, given)[2] - 1004) < 1e-6);
  // Referenced at x 100, the view held on the far circle draws it.
  const host = createDrawing({ units: "in" });
  host.xref("BASE", "base.dwg");
  host.insert("BASE", [100, 0]);
  const svg = toSVG(host.build(), {
    xrefs: { BASE: { drawing: schedule, xrefs: given } },
    view: [1095, -10, 1110, 10],
  });
  assert.equal(svg.match(/<(circle|ellipse)\b/g)?.length ?? 0, 1);
});

test("the extents box a table's blocks once, however many places draw the table", () => {
  const d = createDrawing({ units: "in" });
  d.block("TAG", {}, () => d.circle([0, 0], 1));
  d.tableStyle({ name: "S", textHeight: 1 });
  d.table({
    style: "S",
    at: [0, 0],
    columns: Array(1000).fill(4),
    rows: Array.from({ length: 50 }, () => Array(1000).fill({ block: "TAG" })),
  });
  const one = d.build();
  const many = { ...one, entities: Array(3000).fill(one.entities[0]) };
  assert.deepEqual(
    within(2000, () => boxOf(many)),
    boxOf(one),
  );
});

test("lint refuses a cell's block that its fit would write at a scale of 0", () => {
  const d = createDrawing({ units: "in" });
  d.block("ROAD", {}, () => d.line([0, 0], [1e8, 0]));
  d.tableStyle({ name: "S", textHeight: 1 });
  d.table({ style: "S", at: [0, 0], columns: [4], rows: [[{ block: "ROAD" }]] });
  const found = lint(d.build()).filter((x) => x.rule === "table");
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /ROAD.*scale cannot be 0/);
});

test("a table of no columns costs nothing to read, however many rows it has", () => {
  const table = {
    kind: "table",
    layer: "0",
    style: "S",
    at: [0, 0],
    columns: [],
    rows: Array(2_000_000).fill([]),
  } as never;
  within(1000, () => {
    assert.equal(tableCost(table), 0);
    assert.equal(tableRepeats()(table), 0);
  });
});

test("a table's text keeps a caret, and a style may be named TEXT", async () => {
  const d = createDrawing({ units: "in" });
  d.tableStyle({ name: "TEXT", textHeight: 1 });
  d.table({ style: "TEXT", at: [0, 0], columns: [8], rows: [["REV^A"]] });
  const read = await readDXF(toDXF(d.build()), { geometry: true });
  const table = (read.model.entities ?? []).find((e) => e.kind === "table");
  assert.equal(table?.kind === "table" && table.style, "TEXT");
  assert.equal(table?.kind === "table" && table.cells[0]?.text, "REV^A");
  assert.ok(read.tableStyles.some((s) => s.name === "TEXT"));
});

test("a row that names the Standard text style keeps it", async () => {
  const d = createDrawing({ units: "in" });
  d.textStyle({ name: "Body", font: "Arial" });
  d.tableStyle({
    name: "Schedule",
    textHeight: 1,
    textStyle: "Body",
    header: { textStyle: "Standard" },
  });
  d.table({ style: "Schedule", at: [0, 0], columns: [4], header: ["H"], rows: [["A"]] });
  const read = await readDXF(toDXF(d.build()), { geometry: true });
  assert.equal(read.tableStyles.find((s) => s.name === "Schedule")?.header.textStyle, "Standard");
});

test("a fitted block fits by each side it has a size along, from its base", () => {
  // A line fits along its length.
  const line = createDrawing({ units: "in" });
  line.block("L", {}, () => line.line([0, 0], [100, 0]));
  line.tableStyle({ name: "S", textHeight: 1 });
  line.table({ style: "S", at: [0, 0], columns: [4], rows: [[{ block: "L" }]] });
  const fitted = boxOf(line.build());
  assert.ok(fitted[0] >= -1e-9 && fitted[2] <= 4 + 1e-9, JSON.stringify(fitted));
  // A block whose base is away from what it draws is placed by what it draws.
  const based = createDrawing({ units: "in" });
  based.block("B", { base: [10, 0] }, () =>
    based.polyline(
      [
        [10, 0],
        [11, 0],
        [11, 1],
      ],
      false,
    ),
  );
  based.tableStyle({ name: "S", textHeight: 1 });
  based.table({ style: "S", at: [0, 0], columns: [4], rows: [[{ block: "B", blockScale: 1 }]] });
  assert.ok(boxOf(based.build())[0] >= -1e-9);
});

test("a fitted block fits by all it draws, a layer that does not plot included", () => {
  const d = createDrawing({ units: "in" });
  d.layer("CON", { color: 1, plot: false });
  d.block("B", {}, () => {
    d.line([0, 0], [1, 1]);
    d.layer("CON", {}, () => d.line([0, 0], [100, 100]));
  });
  d.tableStyle({ name: "S", textHeight: 1 });
  d.table({ style: "S", at: [0, 0], columns: [4], rows: [[{ block: "B" }]] });
  // The unit line is drawn at the scale that fits the 100-unit one, which does not plot.
  const svg = toSVG(d.build());
  const drawn = svg.slice(svg.indexOf('data-block="B"')).match(/x1="([-0-9.]+)".*?x2="([-0-9.]+)"/);
  assert.ok(drawn);
  assert.ok(Number(drawn[2]) - Number(drawn[1]) < 0.1, drawn[0]);
});

test("the builder holds a cell's text to its row's font", () => {
  const d = createDrawing({ units: "in" });
  d.textStyle({ name: "SHX", font: "romans.shx" });
  d.tableStyle({ name: "S", textHeight: 1, textStyle: "SHX" });
  assert.throws(() => d.table({ style: "S", at: [0, 0], columns: [4], rows: [["%%c"]] }));
});

test("a table whose style the drawing lacks draws nothing and throws nothing", () => {
  const drawing = {
    format: 0,
    units: "in",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    entities: [{ kind: "table", layer: "0", at: [0, 0], columns: [1], rows: [["A"]] }],
  } as never;
  assert.doesNotThrow(() => toSVG(drawing));
  assert.doesNotThrow(() => inspectText(drawing));
});

test("a table takes no color of its own, from the builder or from lint", () => {
  const d = createDrawing({ units: "in" });
  d.tableStyle({ name: "S", textHeight: 1 });
  const table = { style: "S", at: [0, 0], columns: [4], rows: [[{ text: "A" }]] } as const;
  // @ts-expect-error: its style and its cells give its colors.
  assert.throws(() => d.table({ ...table, color: 1 }), /A table has no color of its own/);
  d.table({ ...table, color: "ByLayer" });
  const built = d.build();
  const colored = { ...built, entities: [{ ...built.entities[0]!, color: 3 }] } as Drawing;
  assert.deepEqual(
    lint(colored).map((p) => [p.rule, p.message]),
    [["entity-color", `table #0: ${TABLE_COLOR}`]],
  );
});
