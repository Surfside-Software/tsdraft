import assert from "node:assert/strict";
import { test } from "node:test";
import { createDrawing, sweep } from "../src/index.ts";

test("layer() scopes entities and restores the previous layer", () => {
  const d = createDrawing().layer("A-WALL", { color: 1 }).build();
  assert.deepEqual(
    d.layers.map((l) => l.name),
    ["0", "A-WALL"],
  );

  const b = createDrawing();
  b.layer("A-WALL", { color: 1 }, () => {
    b.line([0, 0], [10, 0]);
  });
  b.circle([0, 0], 1);
  const [wall, circle] = b.build().entities;
  assert.equal(wall?.layer, "A-WALL");
  assert.equal(circle?.layer, "0");
});

test("rect() makes a closed four-point polyline", () => {
  const [rect] = createDrawing().rect([1, 2], 3, 4).build().entities;
  assert.deepEqual(rect, {
    kind: "polyline",
    layer: "0",
    closed: true,
    points: [
      [1, 2],
      [4, 2],
      [4, 6],
      [1, 6],
    ],
  });
});

test("rejects bad geometry", () => {
  const b = createDrawing();
  const zero: number = 0;
  assert.throws(() => b.circle([0, 0], zero), /radius/);
  assert.throws(() => b.line([0, Number.NaN], [1, 1]), /finite/);
  assert.throws(() => b.arc([0, 0], 1, 90, 450), /differ/);
  assert.throws(() => b.polyline([[0, 0]]), /at least 2/);
  assert.throws(() => b.rect([0, 0], zero, 5), /width/);
});

test("arc angles are stored from 0 up to 360", () => {
  const arcs = createDrawing().arc([0, 0], 1, -90, 450.5).arc([0, 0], 1, 350, 370).build().entities;
  assert.deepEqual(
    arcs.map((a) => a.kind === "arc" && [a.startAngle, a.endAngle]),
    [
      [270, 90.5],
      [350, 10],
    ],
  );
  assert.throws(() => createDrawing().arc([0, 0], 1, 0, 360), /differ/);
});

test("layer names ignore case and keep the first spelling", () => {
  const b = createDrawing();
  b.layer("wall", { color: 1 });
  b.layer("WALL", { color: 2 }, () => {
    b.line([0, 0], [1, 0]);
  });
  const d = b.build();
  assert.deepEqual(d.layers, [
    { name: "0", color: 7 },
    { name: "wall", color: 2 },
  ]);
  assert.equal(d.entities[0]?.layer, "wall");
});

test("sweep() measures counterclockwise", () => {
  assert.equal(sweep(0, 90), 90);
  assert.equal(sweep(270, 90), 180);
  assert.equal(sweep(90, 0), 270);
});
