import assert from "node:assert/strict";
import { test } from "node:test";
import { createDrawing, DrawingError, lint, toDXF, toSVG, type Drawing } from "../src/index.ts";

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

  // tsdraft writes 6 decimals, so a size under 0.0000005 would be written as 0.
  // @ts-expect-error: AutoCAD gives text of height 0 its default height.
  assert.throws(() => r2018.text([0, 0], "x", { height: 4e-7 }), /height: .*written as 0/);
  // @ts-expect-error: the same number written out in full.
  assert.throws(() => r2018.circle([0, 0], 0.0000004), /radius: .*written as 0/);
  // @ts-expect-error: 5e-7 is stored a little under a half, so it rounds down.
  assert.throws(() => r2018.arc([0, 0], 5e-7, 0, 90), /radius: .*written as 0/);
  // @ts-expect-error: a width far below what is written.
  assert.throws(() => r2018.rect([0, 0], 1e-12, 5), /width: .*written as 0/);
  // @ts-expect-error: a height just under the half.
  assert.throws(() => r2018.rect([0, 0], 5, 4.999e-7), /height: .*written as 0/);
  r2018.circle([0, 0], 5.001e-7);
  r2018.circle([0, 0], 6e-7);
  r2018.text([0, 0], "x", { height: 0.000001 });
  r2018.rect([0, 0], 1e21, 9.5e-7);

  // @ts-expect-error: AutoCAD discards a drawing over an ohm sign in a layer name.
  assert.throws(() => r2018.layer("10 k\u2126"), /AutoCAD rejects.*This name has U\+2126/);
  // @ts-expect-error: and over a zero-width space, which no one can see.
  assert.throws(() => r2018.layer("A\u200bB"), /AutoCAD rejects.*This name has U\+200B/);
  // @ts-expect-error: and over Coptic letters.
  assert.throws(() => r2018.layer("\u2c80\u2c81"), /AutoCAD rejects/);
  // @ts-expect-error: AutoCAD replaces these private-use characters.
  assert.throws(() => r2018.layer("A\ue8ffB"), /AutoCAD rejects or replaces/);
  // @ts-expect-error: the R12 rule comes second, so the message is the one for the character.
  assert.throws(() => r12.layer("\u2126"), /AutoCAD rejects/);
  // AutoCAD refuses only the ASCII space at the ends of a name.
  r2018.layer("\u00a0A\u3000");
  r2018.layer("10 k\u03a9");
  r2018.layer("A\u00a0B \ue7ff\ue900 \u2116");
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
  assert.throws(() => createDrawing().text([0, 0], "a\ue800b"), /private-use/);
  const tiny: number = 4e-7;
  assert.throws(() => createDrawing().circle([0, 0], tiny), /radius: .*written as 0/);
  assert.throws(
    () => createDrawing().text([0, 0], "x", { height: tiny }),
    /height: .*written as 0/,
  );
  const ohm: string = String.fromCharCode(0x2126);
  assert.throws(() => createDrawing({ dxf: "R2018" }).layer(ohm), /This name has U\+2126/);
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

test("sizes, lines and arcs that rounding would collapse", () => {
  const b = createDrawing();
  // Each side is big enough alone, but the far corner rounds onto the near one.
  assert.throws(() => b.rect([0.0000006, 0], 0.0000006, 5), /width: .*x = 0.000001/);
  assert.throws(() => b.rect([0, 1e17], 5, 1), /height: .*y = 100000000000000000/);
  // All but a full circle: both angles are written as 180, which AutoCAD holds as no arc at all.
  assert.throws(() => b.arc([0, 0], 1, 180.0000004, 180), /nearly a full turn/);
  assert.throws(() => b.arc([0, 0], 1, 0, 359.9999996), /nearly a full turn/);
  assert.throws(() => b.arc([0, 0], 1, 0.0000004, 0), /nearly a full turn/);
  b.arc([0, 0], 1, 0, 359.999999);

  // These lose their length to rounding, which is close to what was drawn: a warning each.
  b.arc([0, 0], 1, 180, 180.0000004);
  b.arc([0, 0], 1, 359.9999996, 0.0000004);
  b.line([1, 1], [1.0000001, 1]);
  b.polyline([
    [2, 2],
    [2.0000004, 2],
    [2, 1.9999996],
  ]);
  b.polyline([
    [3, 3],
    [3, 3],
  ]);
  // These do not: one point is written apart from the others.
  b.line([1, 1], [1.0000005, 1]);
  b.polyline([
    [2, 2],
    [2, 2],
    [2.000001, 2],
  ]);
  const d = b.build();
  assert.deepEqual(
    lint(d).map((p) => `${p.severity} ${p.rule} ${p.message}`),
    [
      "warning zero-length arc #1: the arc has no length once it is rounded to the 6 decimals tsdraft writes",
      "warning zero-length arc #2: the arc has no length once it is rounded to the 6 decimals tsdraft writes",
      "warning zero-length line #3: the line has no length once it is rounded to the 6 decimals tsdraft writes",
      "warning zero-length polyline #4: the polyline has no length once it is rounded to the 6 decimals tsdraft writes",
      "warning zero-length polyline #5: the polyline has no length",
    ],
  );
  assert.match(toDXF(d), /ARC/);

  const byHand: Drawing = {
    units: "in",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    entities: [
      { kind: "text", layer: "0", at: [0, 0], height: 4e-7, rotation: 0, value: "x" },
      { kind: "circle", layer: "0", center: [0, 0], radius: 4e-7 },
      { kind: "arc", layer: "0", center: [0, 0], radius: 4e-7, startAngle: 0, endAngle: 90 },
      {
        kind: "arc",
        layer: "0",
        center: [0, 0],
        radius: 1,
        startAngle: 180.0000004,
        endAngle: 180,
      },
      { kind: "text", layer: "0", at: [0, 0], height: Number.NaN, rotation: 0, value: "x" },
    ],
  };
  assert.deepEqual(
    lint(byHand).map((p) => `${p.severity} ${p.rule} ${p.entity}`),
    [
      "error geometry 0",
      "error geometry 1",
      "error geometry 2",
      "error geometry 3",
      "error geometry 4",
    ],
  );
  assert.match(lint(byHand)[0]?.message ?? "", /^text #0: height: This value is written as 0/);
  assert.match(lint(byHand)[4]?.message ?? "", /^text #4: height: This value must be finite/);
  assert.throws(() => toDXF(byHand), DrawingError);
});

test("layer names are compared the way AutoCAD compares them", () => {
  const drawing = (layers: string[], used: string[]): Drawing => ({
    units: "in",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }, ...layers.map((name) => ({ name, color: 1 }))],
    entities: used.map((layer) => ({ kind: "line", layer, from: [0, 0], to: [1, 1] })),
  });
  const found = (d: Drawing) => lint(d).map((p) => `${p.rule} ${p.entity ?? p.layer}`);

  // AutoCAD puts each of these lines on the declared layer.
  const declared = ["MixedCase", "CAFÉ", "ΑΒΓ", "Слой", "ǄURO", "ＡＢＣ"];
  assert.deepEqual(
    found(drawing(declared, ["mixedcase", "café", "αβγ", "СЛОЙ", "ǆuro", "ａｂｃ"])),
    [],
  );
  // AutoCAD makes a new layer for each of these, because its table does not pair the letters.
  assert.deepEqual(
    found(
      drawing(
        ["ΟΔΟΣ", "STRASSE", "TITLE", "ŸVES", "ǅ", "İ", "ᲐᲑ"],
        ["οδος", "οδοσ", "straße", "tıtle", "ÿves", "ǆ", "i", "აბ"],
      ),
    ),
    [
      "undefined-layer 0",
      "undefined-layer 2",
      "undefined-layer 3",
      "undefined-layer 4",
      "undefined-layer 5",
      "undefined-layer 6",
      "undefined-layer 7",
    ],
  );

  // One layer to AutoCAD, which keeps only the first.
  assert.deepEqual(found(drawing(["ΑΒΓ", "αβγ", "Αβγ"], [])), [
    "duplicate-layer αβγ",
    "duplicate-layer Αβγ",
  ]);
  // Two layers to AutoCAD, and one duplicate name to its AUDIT.
  const twins = lint(drawing(["ΟΔΟΣ", "οδος", "ŸVES", "ÿves", "ǅ", "ǆ", "STRAẞE", "straße"], []));
  assert.deepEqual(
    twins.map((p) => `${p.severity} ${p.rule} ${p.layer}`),
    [
      "error duplicate-layer οδος",
      "error duplicate-layer ÿves",
      "error duplicate-layer ǆ",
      "error duplicate-layer straße",
    ],
  );
  assert.match(twins[0]?.message ?? "", /"οδος": AutoCAD keeps this layer and "ΟΔΟΣ" as two/);
  // Neither AutoCAD nor its AUDIT takes these for the same.
  assert.deepEqual(found(drawing(["µm", "μm", "TITLE", "tıtle", "ᲐᲑ", "აბ"], [])), []);

  const b = createDrawing({ dxf: "R2018" });
  b.layer("ΟΔΟΣ", { color: 1 });
  b.layer("οδοσ", { color: 2 }, () => {
    b.line([0, 0], [1, 1]);
  });
  assert.throws(() => b.layer("οδος"), /AUDIT reports them as one duplicate name/);
  assert.deepEqual(b.build().layers, [
    { name: "0", color: 7 },
    { name: "ΟΔΟΣ", color: 2 },
  ]);
  assert.equal(b.build().entities[0]?.layer, "ΟΔΟΣ");
});

test("lint handles text AutoCAD would change or draw differently", () => {
  const d: Drawing = {
    units: "in",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    entities: [
      { kind: "text", layer: "0", at: [0, 0], height: 1, rotation: 0, value: "\\U+00B0 kept" },
      { kind: "text", layer: "0", at: [0, 0], height: 1, rotation: 0, value: "45%%d" },
      { kind: "text", layer: "0", at: [0, 0], height: 1, rotation: 0, value: "100% of 5%" },
      { kind: "text", layer: "0", at: [0, 0], height: 1, rotation: 0, value: "a\ue800b" },
    ],
  };
  assert.deepEqual(
    lint(d).map((p) => `${p.severity} ${p.rule} ${p.entity}`),
    ["warning text 1", "error text 3"],
  );
  assert.match(lint(d)[0]?.message ?? "", /draws "%%d" as a degree sign/);
});

test("lint takes a polyline too long to pass as arguments", () => {
  const points = Array.from({ length: 250_000 }, (_, i): [number, number] => [i, i % 7]);
  const d: Drawing = {
    units: "in",
    dxf: "R12",
    layers: [{ name: "0", color: 7 }],
    entities: [{ kind: "polyline", layer: "0", points, closed: false }],
  };
  assert.deepEqual(lint(d), []);
  assert.equal(toDXF(d).match(/VERTEX/g)?.length, points.length);
  assert.match(toDXF(d, { version: "R2018" }), /\r\n90\r\n250000\r\n/);
  assert.match(toSVG(d), /<polyline points="0,0 1,1 /);
  const broken: Drawing = {
    ...d,
    entities: [
      { kind: "polyline", layer: "0", points: [...points, [0, Number.NaN]], closed: false },
    ],
  };
  assert.deepEqual(
    lint(broken).map((p) => p.message),
    ["polyline #0: its points must be finite numbers"],
  );
});

test("a DrawingError names no file format", () => {
  const one = new DrawingError([{ rule: "text", severity: "error", message: "text #0: bad" }]);
  assert.equal(one.message, "The drawing has 1 problem:\n- text #0: bad");
  assert.equal(one.name, "DrawingError");
  const many = new DrawingError(
    Array.from({ length: 12 }, (_, i) => ({
      rule: "geometry" as const,
      severity: "error" as const,
      message: `circle #${i}: bad`,
    })),
  );
  assert.match(many.message, /^The drawing has 12 problems:\n- circle #0: bad\n/);
  assert.match(many.message, /\n- and 2 more$/);
  assert.equal(many.diagnostics.length, 12);
  assert.doesNotMatch(many.message, /DXF/);
});
