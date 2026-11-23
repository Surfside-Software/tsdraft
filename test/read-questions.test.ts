// What a sheet of a read file shows, and what is near a point: a model of eight stacked plans,
// and a sheet for each that shows its own plan through an xref.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDrawing,
  nearPoint,
  readDXF,
  sheetShows,
  spaceShows,
  toDXF,
  xrefAreas,
  type Drawing,
} from "../src/index.ts";

const PLANS = 8;

/** Eight plans, each a rectangle, its name and a note, stacked 200 feet apart. */
function model(): Drawing {
  const d = createDrawing({ units: "ft" });
  d.layer("A-WALL", { color: 1 }).layer("A-ANNO", { color: 3 }).layer("A-NOTE", { color: 4 });
  for (let i = 1; i <= PLANS; i++) {
    const y = 200 * (i - 1);
    d.layer("A-WALL", {}, () => d.rect([0, y], 100, 60));
    d.layer("A-ANNO", {}, () => d.text([5, y + 50], `PLAN ${i}`, { height: 2 }));
    d.layer("A-NOTE", {}, () => d.text([80, y + 5], `NOTE ${i}`, { height: 2 }));
  }
  return d.build();
}

/** A sheet that attaches the model and shows plan `i` at 1" = 10', the layer `frozen` frozen. */
function sheet(i: number, frozen?: string): Drawing {
  const d = createDrawing({ units: "ft" });
  d.xref("MODEL", "model.dwg", { attach: true });
  d.layer("X-MODEL", { color: 8 }, () => d.insert("MODEL", [0, 0]));
  d.layer("SHEET", { color: 7 });
  d.layout(`Sheet ${i}`, { paper: "ARCH D" }, (s) => {
    d.layer("SHEET", {}, () => d.text([1, 1], `SHEET ${i}`, { height: 0.25 }));
    s.viewport([2, 2], 10, 8, {
      center: [50, 200 * (i - 1) + 30],
      ratio: 120,
      ...(frozen ? { frozenLayers: [frozen] } : {}),
    });
  });
  return d.build();
}

const texts = (shown: { entities: readonly { text?: string }[] }) =>
  shown.entities.flatMap((e) => (e.text === undefined ? [] : [e.text])).sort();

test("each sheet shows its own plan of eight stacked ones, through the xref", async () => {
  const modelRead = await readDXF(toDXF(model()), { geometry: true });
  for (let i = 1; i <= PLANS; i++) {
    const read = await readDXF(toDXF(sheet(i)), { geometry: true });
    const shown = sheetShows(read, `Sheet ${i}`, { xrefs: { MODEL: modelRead } })!;
    assert.equal(shown.capped, false);
    assert.deepEqual(texts(shown), [`NOTE ${i}`, `PLAN ${i}`, `SHEET ${i}`]);
    const plan = shown.entities.find((e) => e.text === `PLAN ${i}`)!;
    assert.deepEqual(plan.xrefs, ["MODEL"]);
    // Its handle is the model's own.
    assert.ok(modelRead.model.entities?.some((e) => e.handle === plan.handle));
    assert.equal(plan.layer, "MODEL|A-ANNO");
    assert.equal(plan.viewport, 0);
    assert.equal(plan.through.length, 1);
    // On the paper: 5 feet in from the viewport's left, at 1" = 10', is half an inch in.
    assert.ok(Math.abs(plan.box[0] - 2.5) < 1e-6, String(plan.box));
    // The part of the model the sheet shows: 100 by 80 feet about the plan's middle.
    const [area] = xrefAreas(read, `Sheet ${i}`, "MODEL");
    const y = 200 * (i - 1) + 30;
    assert.deepEqual(
      area?.flat().map((n) => Math.round(n)),
      [0, y - 40, 100, y + 40],
    );
  }
  // Without the model's read, a sheet shows its paper alone.
  const alone = sheetShows(await readDXF(toDXF(sheet(3)), { geometry: true }), "Sheet 3")!;
  assert.deepEqual(texts(alone), ["SHEET 3"]);
});

test("near a point of a sheet finds what it shows there, nearest first", async () => {
  const modelRead = await readDXF(toDXF(model()), { geometry: true });
  const read = await readDXF(toDXF(sheet(5)), { geometry: true });
  const near = nearPoint(read, [2.6, 8.1], {
    sheet: "Sheet 5",
    within: 0.5,
    xrefs: { MODEL: modelRead },
  })!;
  assert.equal(near.entities[0]?.text, "PLAN 5");
  assert.ok(near.entities.every((e) => e.distance <= 0.5));
  assert.ok(!near.entities.some((e) => e.text === "NOTE 5"));
});

test("an insert's clip is its own file's, though another file has an insert of its handle", async () => {
  // The host's insert of the model and the model's insert of a block share a handle.
  const m = createDrawing({ units: "ft" });
  m.block("TAG", {}, () => m.line([0, 0], [1, 0]));
  m.text([5, 50], "PLAN 1", { height: 2 });
  m.insert("TAG", [500, 500]);
  const base = await readDXF(toDXF(m.build()), { geometry: true });
  const read = await readDXF(toDXF(sheet(1)), { geometry: true });
  const host = read.model.entities!.find((e) => e.kind === "insert")!;
  const tag = base.model.entities!.find((e) => e.kind === "insert")!;
  const clip = {
    outline: [
      [500, 500],
      [501, 500],
      [501, 501],
      [500, 501],
    ] as [number, number][],
  };
  const clipped = {
    ...base,
    model: {
      ...base.model,
      entities: base.model.entities!.map((e) =>
        e === tag ? { ...e, handle: host.handle!, clip } : e,
      ),
    },
  };
  const shown = sheetShows(read, "Sheet 1", { xrefs: { MODEL: clipped } })!;
  assert.deepEqual(texts(shown), ["PLAN 1", "SHEET 1"]);
});

test("in a turned view a line is held to the viewport by its path, and boxed on the paper by it", async () => {
  const d = createDrawing({ units: "in" });
  d.line([8, 0], [0, 8]);
  d.line([0, 0], [2, 2]);
  d.layout("Sheet", { paper: "ARCH D" }, (s) => {
    s.viewport([1, 1], 10, 10, { center: [0, 0], ratio: 1, twist: 45 });
  });
  const read = await readDXF(toDXF(d.build()), { geometry: true });
  const shown = sheetShows(read, "Sheet")!.entities.filter((e) => e.kind === "line");
  // The first runs to a paper Y of 11.66, past the viewport's top at 11.
  assert.equal(shown.length, 1);
  const [x0, , x1] = shown[0]!.box;
  assert.ok(Math.abs(x1 - x0) < 1e-9, String(shown[0]!.box));
});

test("near a point answers within the limits of each question", async () => {
  const d = createDrawing({ units: "ft" });
  d.line([0, 0], [1, 0]);
  d.line([0, 0.5], [1, 0.5]);
  const read = await readDXF(toDXF(d.build()), { geometry: true });
  const one = nearPoint(read, [0.5, 0.25], { within: 1, limits: { entities: 1 } })!;
  assert.deepEqual([one.entities.length, one.capped], [1, true]);
  const both = nearPoint(read, [0.5, 0.25], { within: 1, limits: { entities: 10 } })!;
  assert.deepEqual([both.entities.length, both.capped], [2, false]);
});

test("a walk that stops while it maps a clip shows nothing the clip hides", async () => {
  const d = createDrawing({ units: "ft" });
  d.block("TAG", {}, () => {
    d.text([50, 50], "OUTSIDE", { height: 1 });
    d.text([0, 0], "INSIDE", { height: 1 });
  });
  d.insert("TAG", [0, 0]);
  const base = await readDXF(toDXF(d.build()), { geometry: true });
  const clip = {
    outline: [
      [-1, -1],
      [5, -1],
      [5, 5],
      [-1, 5],
    ] as [number, number][],
  };
  const read = {
    ...base,
    model: {
      ...base.model,
      entities: base.model.entities!.map((e) => (e.kind === "insert" ? { ...e, clip } : e)),
    },
  };
  assert.deepEqual(texts(spaceShows(read)!), ["INSIDE"]);
  for (const work of [3, 4, 5, 6]) {
    const shown = spaceShows(read, { limits: { work } })!;
    assert.ok(!texts(shown).includes("OUTSIDE"), String(work));
  }
});

test("a closed polyline round a viewport's view shows nothing in it", async () => {
  const d = createDrawing({ units: "in" });
  d.polyline(
    [
      [-100, -100],
      [100, -100],
      [100, 100],
      [-100, 100],
    ],
    true,
  );
  d.layout("Sheet", { paper: "ARCH D" }, (s) => {
    s.viewport([1, 1], 10, 2, { center: [0, 0], ratio: 1, twist: 45 });
  });
  const read = await readDXF(toDXF(d.build()), { geometry: true });
  assert.deepEqual(sheetShows(read, "Sheet")!.entities, []);
});

test("xrefAreas takes a turned view back through a turned insert, and cuts it to the clip", async () => {
  const d = createDrawing({ units: "in" });
  d.xref("MODEL", "model.dwg", { attach: true });
  d.insert("MODEL", [0, 0], { rotation: 45 });
  d.layout("Sheet", { paper: "ARCH D" }, (s) => {
    s.viewport([1, 1], 10, 2, { center: [0, 0], ratio: 1, twist: -45 });
  });
  const read = await readDXF(toDXF(d.build()), { geometry: true });
  const [area] = xrefAreas(read, "Sheet", "MODEL");
  assert.deepEqual(
    area?.flat().map((n) => Math.round(n)),
    [-5, -1, 5, 1],
  );
  const clip = {
    outline: [
      [0, 3],
      [1, 3],
      [1, 4],
      [0, 4],
    ] as [number, number][],
  };
  const clipped = {
    ...read,
    model: {
      ...read.model,
      entities: read.model.entities!.map((e) => (e.kind === "insert" ? { ...e, clip } : e)),
    },
  };
  assert.deepEqual(xrefAreas(clipped, "Sheet", "MODEL"), []);
});
