import assert from "node:assert/strict";
import { test } from "node:test";
import { createDrawing, DrawingError, lint, toDXF, type Drawing } from "../src/index.ts";

// Each `@ts-expect-error` below proves the compiler rejects the literal. The
// `assert.throws` around it proves the same mistake is caught when the code runs.
test("literal mistakes are compile errors and runtime errors", () => {
  const r12 = createDrawing();
  const r2018 = createDrawing({ dxf: "R2018" });

  // @ts-expect-error: R12 layer names cannot contain spaces.
  assert.throws(() => r12.layer("A WALL"), /R12 layer names can only use/);
  // @ts-expect-error: R12 layer names cannot contain dots.
  assert.throws(() => r12.layer("A.WALL"), /R12 layer names can only use/);
  // @ts-expect-error: 32 characters is one too many for R12.
  assert.throws(() => r12.layer("A2345678901234567890123456789012"), /31 characters/);
  r12.layer("A234567890123456789012345678901");
  r12.layer("a-WALL_$1");

  r2018.layer("A WALL");
  r2018.layer("CAFÉ 日本 #1 (new).v2");
  r2018.layer("A2345678901234567890123456789012");
  // @ts-expect-error: no DXF version allows a comma.
  assert.throws(() => r2018.layer("A,B"), /cannot contain/);
  // @ts-expect-error: a caret starts an escape in DXF.
  assert.throws(() => r2018.layer("A^B"), /cannot contain/);
  // @ts-expect-error: a line break would inject records into the file.
  assert.throws(() => r2018.layer("A\r\n0\r\nEOF"), /cannot contain/);
  // @ts-expect-error: AutoCAD rejects a leading space.
  assert.throws(() => r2018.layer(" A"), /start or end/);
  // @ts-expect-error: AutoCAD rejects a trailing space.
  assert.throws(() => r2018.layer("A "), /start or end/);
  // @ts-expect-error: a name is required.
  assert.throws(() => r2018.layer(""), /empty/);

  // @ts-expect-error: colors run from 1 to 255.
  assert.throws(() => r2018.layer("X", { color: 0 }), /Color Index/);
  // @ts-expect-error: colors run from 1 to 255.
  assert.throws(() => r2018.layer("X", { color: 256 }), /Color Index/);
  // @ts-expect-error: colors are integers.
  assert.throws(() => r2018.layer("X", { color: 1.5 }), /Color Index/);
  r2018.layer("X", { color: 255 });

  // @ts-expect-error: a radius must be positive.
  assert.throws(() => r2018.circle([0, 0], -1), /radius/);
  // @ts-expect-error: a radius must be positive.
  assert.throws(() => r2018.arc([0, 0], 0, 0, 90), /radius/);
  // @ts-expect-error: a rectangle needs a height.
  assert.throws(() => r2018.rect([0, 0], 5, 0), /height/);
  // @ts-expect-error: text needs a height.
  assert.throws(() => r2018.text([0, 0], "x", { height: 0 }), /height/);
});

test("values the compiler cannot see are checked when the code runs", () => {
  const name: string = ["A", "WALL"].join(" ");
  const color: number = 300;
  assert.throws(() => createDrawing().layer(name), /R12 layer names can only use/);
  createDrawing({ dxf: "R2018" }).layer(name);
  assert.throws(() => createDrawing().layer("X", { color }), /Color Index/);
  assert.throws(() => createDrawing().text([0, 0], "two\nlines"), /single line/);
  assert.throws(() => createDrawing().text([0, 0], "a\u0000b"), /control characters/);
  assert.throws(() => createDrawing().text([0, 0], "smile 😀"), /emoji/);
  // @ts-expect-error: unknown units are a compile error too.
  assert.throws(() => createDrawing({ units: "yd" }), /Unknown units/);
  // @ts-expect-error: unknown DXF versions are a compile error too.
  assert.throws(() => createDrawing({ dxf: "R14" }), /Unsupported DXF version/);
});

test("lint checks a drawing against another DXF version", () => {
  const b = createDrawing({ dxf: "R2018" });
  b.layer("A WALL", { color: 1 }, () => {
    b.line([0, 0], [10, 0]);
  });
  const d = b.build();

  assert.deepEqual(lint(d), []);
  const [problem, ...rest] = lint(d, { version: "R12" });
  assert.deepEqual(rest, []);
  assert.equal(problem?.rule, "layer-name");
  assert.equal(problem?.severity, "error");
  assert.equal(problem?.layer, "A WALL");
  assert.match(problem?.message ?? "", /R12 layer names can only use/);

  assert.match(toDXF(d), /AC1032/);
  assert.throws(
    () => toDXF(d, { version: "R12" }),
    (e) => e instanceof DrawingError && e.diagnostics.length === 1 && /A WALL/.test(e.message),
  );
});

test("lint checks a drawing that was not made with the builder", () => {
  const d: Drawing = {
    units: "ft",
    dxf: "R2018",
    layers: [
      { name: "0", color: 7 },
      { name: "wall", color: 1 },
      { name: "WALL", color: 300 },
    ],
    entities: [
      { kind: "line", layer: "wall", from: [0, 0], to: [0, 0] },
      { kind: "line", layer: "missing", from: [0, 0], to: [1, 0] },
      { kind: "arc", layer: "0", center: [0, 0], radius: 1, startAngle: -90, endAngle: 450 },
      { kind: "circle", layer: "0", center: [0, 0], radius: 0 },
      { kind: "text", layer: "0", at: [0, 0], height: 1, rotation: 0, value: "😀" },
    ],
  };
  const found = lint(d).map((p) => `${p.severity} ${p.rule} ${p.entity ?? p.layer}`);
  assert.deepEqual(found, [
    "error layer-color WALL",
    "error duplicate-layer WALL",
    "warning zero-length 0",
    "error undefined-layer 1",
    "error geometry 2",
    "error geometry 3",
    "error text 4",
  ]);
  assert.throws(() => toDXF(d), DrawingError);
});

test("warnings do not stop an export", () => {
  const d = createDrawing().line([1, 1], [1, 1]).build();
  assert.deepEqual(
    lint(d).map((p) => p.severity),
    ["warning"],
  );
  assert.match(toDXF(d), /LINE/);
});
