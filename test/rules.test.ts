import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDrawing,
  dimensionPicture,
  findDimensionStyle,
  DASHED,
  DrawingBuilder,
  DrawingError,
  fromJSON,
  fromPaper,
  HIDDEN,
  inspectText,
  lint,
  measureText,
  toDXF,
  toJSON,
  toSVG,
  viewportView,
  type Drawing,
  type Entity,
  type HatchGradient,
  type HatchOptions,
  type HatchPattern,
  type HatchPatternOf,
  type Point,
  type Text,
} from "../src/index.ts";
import sheet, { sitePlan, type Box } from "../examples/site-plan.ts";
import { blocksByKey, eachDrawn, mapPoint } from "../src/blocks.ts";
import { extents } from "../src/extents.ts";
import { leaderBlockKeys } from "../src/leader-walks.ts";
import { isString } from "../src/guards.ts";
import { layerAuditKey } from "../src/layers.ts";
import { within } from "./time-limit.ts";
import { dataOf, hasKey, ofKind, wrong, type Data, type Field } from "./values.ts";

// Each `@ts-expect-error` below proves the compiler rejects the literal. The
// `assert.throws` around it proves the same mistake is caught when the code runs.
test("literal mistakes are compile errors and runtime errors", () => {
  const r12 = createDrawing({ dxf: "R12" });
  const r2018 = createDrawing();

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
  // @ts-expect-error: the leading CAD app rejects a leading space.
  assert.throws(() => r2018.layer(" A"), /start or end/);
  // @ts-expect-error: the leading CAD app rejects a trailing space.
  assert.throws(() => r2018.layer("A "), /start or end/);
  // @ts-expect-error: a name is required.
  assert.throws(() => r2018.layer(""), /empty/);

  // @ts-expect-error: colors run from 1 to 255.
  assert.throws(() => r2018.layer("X", { color: 0 }), /color index/);
  // @ts-expect-error: colors run from 1 to 255.
  assert.throws(() => r2018.layer("X", { color: 256 }), /color index/);
  // @ts-expect-error: colors are integers.
  assert.throws(() => r2018.layer("X", { color: 1.5 }), /color index/);
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
  // @ts-expect-error: the leading CAD app gives text of height 0 its default height.
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

  // The leading CAD app reads two exponent digits from DXF, so it would take 1e+100 for 1e+10.
  // @ts-expect-error: a radius of 1e100 would be read as 10000000000.
  assert.throws(() => r2018.circle([0, 0], 1e100), /radius: .*under 1e100/);
  // @ts-expect-error: the same for any number that prints with three exponent digits.
  assert.throws(() => r2018.text([0, 0], "x", { height: 1.5e300 }), /height: .*under 1e100/);
  // @ts-expect-error: and for a rectangle's sides.
  assert.throws(() => r2018.rect([0, 0], 5, 2.5e101), /height: .*under 1e100/);
  r2018.circle([0, 0], 9.999999e99);
  r2018.circle([0, 0], 1e99);
  r2018.text([0, 0], "x", { height: 1e21 });

  // @ts-expect-error: the leading CAD app discards a drawing over an ohm sign in a layer name.
  assert.throws(() => r2018.layer("10 k\u2126"), /CAD app rejects.*This name has U\+2126/);
  // @ts-expect-error: and over a zero-width space, which no one can see.
  assert.throws(() => r2018.layer("A\u200bB"), /CAD app rejects.*This name has U\+200B/);
  // @ts-expect-error: and over Coptic letters.
  assert.throws(() => r2018.layer("\u2c80\u2c81"), /the leading CAD app rejects/);
  // @ts-expect-error: the leading CAD app replaces these private-use characters.
  assert.throws(() => r2018.layer("A\ue8ffB"), /the leading CAD app rejects or replaces/);
  // @ts-expect-error: the R12 rule comes second, so the message is the one for the character.
  assert.throws(() => r12.layer("\u2126"), /the leading CAD app rejects/);
  // The leading CAD app refuses only the ASCII space at the ends of a name.
  r2018.layer("\u00a0A\u3000");
  r2018.layer("10 k\u03a9");
  r2018.layer("A\u00a0B \ue7ff\ue900 \u2116");
});

test("values the compiler cannot see are checked when the code runs", () => {
  const name: string = ["A", "WALL"].join(" ");
  const color: number = 300;
  assert.throws(() => createDrawing({ dxf: "R12" }).layer(name), /R12 layer names can only use/);
  createDrawing().layer(name);
  assert.throws(() => createDrawing().layer("X", { color }), /color index/);
  assert.throws(() => createDrawing().text([0, 0], "two\nlines"), /single line/);
  assert.throws(() => createDrawing().text([0, 0], "a\u0000b"), /control characters/);
  assert.throws(() => createDrawing().text([0, 0], "smile 😀"), /emoji/);
  assert.throws(() => createDrawing().text([0, 0], "a\ue800b"), /private-use/);
  const huge: number = 1e100;
  assert.throws(() => createDrawing().circle([0, 0], huge), /radius: .*under 1e100/);
  assert.throws(() => createDrawing().line([0, 0], [huge, 0]), /x: .*under 1e100/);
  assert.throws(
    () =>
      createDrawing().polyline([
        [0, 0],
        [0, -huge],
      ]),
    /y: .*under 1e100/,
  );
  assert.throws(() => createDrawing().text([0, 0], "x", { rotation: huge }), /rotation: .*under/);
  assert.throws(() => createDrawing().rect([9e99, 0], 9e99, 1), /x: .*under 1e100/);
  // An arc's angles are brought into 0 to 360 before they are stored, so their size is no matter.
  const [arc] = createDrawing().arc([0, 0], 1, huge, 90).build().entities;
  assert.ok(arc?.kind === "arc" && arc.startAngle >= 0 && arc.startAngle < 360);
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
    format: 0,
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
  // All but a full circle: both angles are written as 180, which the leading CAD app holds as no arc at all.
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
    format: 0,
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

test("layer names are compared the way the leading CAD app compares them", () => {
  const drawing = (layers: string[], used: string[]): Drawing => ({
    format: 0,
    units: "in",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }, ...layers.map((name) => ({ name, color: 1 }))],
    entities: used.map((layer) => ({ kind: "line", layer, from: [0, 0], to: [1, 1] })),
  });

  const found = (d: Drawing) => lint(d).map((p) => `${p.rule} ${p.entity ?? p.layer}`);

  // The leading CAD app puts each of these lines on the declared layer.
  const declared = ["MixedCase", "CAFÉ", "ΑΒΓ", "Слой", "ǄURO", "ＡＢＣ"];
  assert.deepEqual(
    found(drawing(declared, ["mixedcase", "café", "αβγ", "СЛОЙ", "ǆuro", "ａｂｃ"])),
    [],
  );
  // The leading CAD app makes a new layer for each of these, because its table does not pair the letters.
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

  // One layer to the leading CAD app, which keeps only the first.
  assert.deepEqual(found(drawing(["ΑΒΓ", "αβγ", "Αβγ"], [])), [
    "duplicate-layer αβγ",
    "duplicate-layer Αβγ",
  ]);
  // Two layers to the leading CAD app, and one duplicate name to its AUDIT.
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
  assert.match(twins[0]?.message ?? "", /"οδος": The leading CAD app keeps this layer and "ΟΔΟΣ"/);
  // Neither the leading CAD app nor its AUDIT takes these for the same.
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

test("lint handles text the leading CAD app would change or draw differently", () => {
  const d: Drawing = {
    format: 0,
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
    format: 0,
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

test("lint refuses a number the leading CAD app would misread", () => {
  const d: Drawing = {
    format: 0,
    units: "in",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    entities: [
      { kind: "line", layer: "0", from: [0, 0], to: [1e100, 1] },
      {
        kind: "polyline",
        layer: "0",
        points: [
          [0, 0],
          [1, -1e100],
        ],
        closed: false,
      },
      { kind: "circle", layer: "0", center: [0, 1.5e300], radius: 1 },
      { kind: "circle", layer: "0", center: [0, 0], radius: 1e100 },
      { kind: "arc", layer: "0", center: [-1e100, 0], radius: 1e101, startAngle: 0, endAngle: 90 },
      { kind: "text", layer: "0", at: [0, 0], height: 1e100, rotation: 0, value: "x" },
      { kind: "text", layer: "0", at: [0, 0], height: 1, rotation: 1e100, value: "x" },
      // Under 1e100 everything is written as the leading CAD app reads it.
      { kind: "line", layer: "0", from: [0, 9e99], to: [3, -9e99] },
      { kind: "circle", layer: "0", center: [9.999999e99, 0], radius: 9.999999999999998e99 },
    ],
  };

  assert.deepEqual(
    lint(d).map((p) => `${p.severity} ${p.entity} ${p.message.replace(/, because.*/, "")}`),
    [
      "error 0 line #0: its points: This value must be under 1e100",
      "error 1 polyline #1: its points: This value must be under 1e100",
      "error 2 circle #2: its center: This value must be under 1e100",
      "error 3 circle #3: radius: This value must be under 1e100",
      "error 4 arc #4: its center: This value must be under 1e100",
      "error 4 arc #4: radius: This value must be under 1e100",
      "error 5 text #5: height: This value must be under 1e100",
      "error 6 text #6: its position and rotation: This value must be under 1e100",
    ],
  );
  assert.throws(() => toDXF(d), DrawingError);
  assert.throws(() => toDXF(d, { version: "R12" }), DrawingError);
});

test("lint refuses layer names that AUDIT would report as duplicates", () => {
  const drawing = (layers: string[], used: string[] = []): Drawing => ({
    format: 0,
    units: "in",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }, ...layers.map((name) => ({ name, color: 1 }))],
    entities: used.map((layer) => ({ kind: "line", layer, from: [0, 0], to: [1, 1] })),
  });

  const duplicates = (layers: string[]) =>
    lint(drawing(layers)).map((p) => `${p.severity} ${p.rule} ${p.layer}`);

  const softHyphen = "\u00ad";

  // A letter and the letters it stands for, in either letter case and inside longer names.
  for (const [name, other] of [
    ["straße", "strasse"],
    ["Hauptstraße 12", "HAUPTSTRASSE 12"],
    ["Maßstab", "Massstab"],
    ["æ", "ae"],
    ["Cæsar", "CAESAR"],
    ["Œuvre", "oeuvre"],
    ["Ĳssel", "ijssel"],
    ["ﬁre wall", "FIRE WALL"],
    ["ǆ", "DŽ"],
    ["ǅ", "dž"],
    ["Þórr", "thórr"],
    // A composed character and its decomposed form, whatever the order of the marks.
    ["café", "cafe\u0301"],
    ["CAFÉ", "cafe\u0301"],
    ["\u1ead", "a\u0302\u0323"],
    ["a\u0323\u0302", "a\u0302\u0323"],
    // A soft hyphen inside a name or in front of it.
    [`co${softHyphen}op`, "coop"],
    [`${softHyphen}Co${softHyphen}${softHyphen}op`, "coop"],
    // Two names that both end with one are compared like any others.
    [`co${softHyphen}op${softHyphen}`, `coop${softHyphen}`],
    [`Straße${softHyphen}`, `STRASSE${softHyphen}`],
    // The kinds together.
    [`Haupt${softHyphen}straße`, "HAUPTSTRASSE"],
    ["ǽ", "ae\u0301"],
  ] as const) {
    assert.deepEqual(duplicates([name, other]), [`error duplicate-layer ${other}`], name);
    assert.deepEqual(duplicates([other, name]), [`error duplicate-layer ${name}`], other);
  }

  const [problem] = lint(drawing(["straße", "STRASSE"]));
  assert.equal(
    problem?.message,
    'Layer "STRASSE": The leading CAD app keeps this layer and "straße" as two layers, but its AUDIT reports them as one duplicate name',
  );

  // AUDIT reports none of these, so they are no error.
  for (const [name, other] of [
    ["Maßstab", "Masstab"],
    ["ß", "sz"],
    ["ǆ", "dz"],
    ["ö", "oe"],
    ["ø", "oe"],
    ["cafe", "café"],
    ["한", "\u1112\u1161\u11ab"],
    ["\u09cb", "\u09c7\u09be"],
    // A soft hyphen between a letter and its accent is not ignored, and neither is one at the end.
    ["É", `E${softHyphen}\u0301`],
    [`coop${softHyphen}`, "coop"],
    ["co-op", "coop"],
  ] as const) {
    assert.deepEqual(duplicates([name, other]), [], name);
  }

  // A long run of soft hyphens before an accent is read once, in a name of any length.
  const run = `${softHyphen.repeat(200_000)}\u0301`;
  assert.equal(
    within(1000, () => layerAuditKey(run)),
    run,
  );

  // An entity on the other spelling is on no declared layer: the leading CAD app would add one for it.
  const strays = lint(drawing(["straße", "café"], ["STRASSE", "cafe\u0301", "strase"]));
  assert.deepEqual(
    strays.map((p) => `${p.severity} ${p.rule} ${p.entity}`),
    ["error undefined-layer 0", "error undefined-layer 1", "error undefined-layer 2"],
  );
  assert.equal(
    strays[0]?.message,
    'line #0: layer "STRASSE" is not defined. The leading CAD app does not take it for layer "straße": it would add a layer, and its AUDIT would report a duplicate name',
  );
  assert.equal(strays[2]?.message, 'line #2: layer "strase" is not defined');

  const b = createDrawing({ dxf: "R2018" });
  b.layer("Hauptstraße");
  assert.throws(() => b.layer("HAUPTSTRASSE"), /AUDIT reports them as one duplicate name/);
  assert.throws(() => b.layer(`Haupt${softHyphen}straße`), /AUDIT reports them as one duplicate/);
  b.layer("Hauptstrase");
});

test("linetype, lineweight and layer state mistakes are compile errors and runtime errors", () => {
  const r12 = createDrawing({ dxf: "R12" });
  const d = createDrawing();

  // @ts-expect-error: R12 drawings have no linetypes.
  assert.throws(() => r12.linetype(DASHED), /R12 drawings have no linetypes/);
  // @ts-expect-error: nor a linetype on a layer or an entity.
  assert.throws(() => r12.layer("A", { linetype: "DASHED" }), /R12 drawings have no linetypes/);
  // @ts-expect-error: nor an entity linetype other than ByLayer.
  assert.throws(() => r12.line([0, 0], [1, 1], { linetype: "Continuous" }), /R12 entities take no/);
  // @ts-expect-error: nor an entity lineweight.
  assert.throws(() => r12.circle([0, 0], 1, { lineweight: 0.5 }), /R12 entities take no/);
  // @ts-expect-error: nor layer states.
  assert.throws(() => r12.layer("A", { frozen: true }), /no layer states to R12/);
  // @ts-expect-error: nor a linetype scale.
  assert.throws(() => createDrawing({ dxf: "R12", linetypeScale: 2 }), /linetype scale/);
  r12.layer("A", { linetype: "CONTINUOUS", lineweight: "Default", off: false, plot: true });
  r12.line([0, 0], [1, 1], { linetype: "ByLayer", lineweight: "ByLayer" });

  // @ts-expect-error: the leading CAD app discards a drawing with an entity of another lineweight.
  assert.throws(() => d.line([0, 0], [1, 1], { lineweight: 0.33 }), /one of the leading CAD app's/);
  // @ts-expect-error: and gives a layer of another lineweight the default.
  assert.throws(() => d.layer("A", { lineweight: 2.5 }), /one of the leading CAD app's/);
  // @ts-expect-error: a layer's lineweight cannot be ByLayer.
  assert.throws(() => d.layer("A", { lineweight: "ByLayer" }), /or "Default"$/);
  // @ts-expect-error: the leading CAD app does not freeze the current layer.
  assert.throws(() => d.layer("0", { frozen: true }), /current layer/);
  // @ts-expect-error: AUDIT reports a layer whose linetype is ByLayer.
  assert.throws(() => d.layer("A", { linetype: "ByLayer" }), /cannot be ByLayer or ByBlock/);
  // @ts-expect-error: a linetype name follows the rules of layer names.
  assert.throws(() => d.line([0, 0], [1, 1], { linetype: "A,B" }), /Linetype names cannot/);
  // @ts-expect-error: Continuous, ByLayer and ByBlock cannot be defined.
  assert.throws(() => d.linetype({ name: "CONTINUOUS", pattern: [1, -1] }), /in every drawing/);
  // @ts-expect-error: AUDIT reports a pattern of one length.
  assert.throws(() => d.linetype({ name: "ONE", pattern: [1] }), /2 to 12 lengths/);
  const thirteen = [1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1] as const;
  // @ts-expect-error: the leading CAD app discards a drawing with a pattern of 13.
  assert.throws(() => d.linetype({ name: "LONG", pattern: thirteen }), /2 to 12/);
  // @ts-expect-error: the linetype scale is a size.
  assert.throws(() => createDrawing({ linetypeScale: 0 }), /linetypeScale: .*greater than 0/);
  // @ts-expect-error: and the leading CAD app reads one written as 0 as 1.
  assert.throws(() => createDrawing({ linetypeScale: 1e-7 }), /linetypeScale: .*written as 0/);
  // @ts-expect-error: the constructor checks it the same way.
  assert.throws(() => new DrawingBuilder({ linetypeScale: 0 }), /linetypeScale: .*greater than 0/);
  // @ts-expect-error: a dash written as 0 would draw as a dot.
  assert.throws(() => d.linetype({ name: "T", pattern: [4e-7, -1] }), /pattern: .*written as 0/);
  // @ts-expect-error: and so would a gap.
  assert.throws(() => d.linetype({ name: "T", pattern: [1, -0.0000004] }), /written as 0/);
  // @ts-expect-error: the leading CAD app reads two exponent digits from DXF.
  assert.throws(() => d.linetype({ name: "T", pattern: [1e100, -1] }), /pattern: .*under 1e100/);
  // @ts-expect-error: with two problems, the first length's is the one reported.
  assert.throws(() => d.linetype({ name: "T", pattern: [1e-7, 1e100] }), /pattern: .*written as 0/);
  // @ts-expect-error: a description is a single line.
  assert.throws(() => d.linetype({ name: "T", pattern: [], description: "a\nb" }), /single line/);
  // @ts-expect-error: with none of the private-use characters the leading CAD app replaces.
  assert.throws(() => d.linetype({ name: "T", pattern: [], description: "\ue800" }), /private-use/);
  // @ts-expect-error: a definition given to a layer is checked as linetype() checks one.
  assert.throws(() => d.layer("A", { linetype: { name: "Continuous", pattern: [] } }), /in every/);
  // @ts-expect-error: and so is one given to an entity.
  assert.throws(() => d.line([0, 0], [1, 1], { linetype: { name: "T", pattern: [1] } }), /2 to 12/);
  const dashed: boolean = false;
  assert.throws(
    // @ts-expect-error: and so is one in a conditional with a name.
    () => d.line([0, 0], [1, 1], { linetype: dashed ? "DASHED" : { name: "T", pattern: [1] } }),
    /2 to 12/,
  );

  d.linetype({ name: "Fence", pattern: [1, -0.5, 0, -0.5] });
  d.linetype({ name: "SOLID2", pattern: [] });
  d.layer("0", { off: true, locked: true, plot: false, linetype: "fence", lineweight: 0.3 });
  d.layer("B", { linetype: HIDDEN, lineweight: 2.11 }, () => {
    d.line([0, 0], [1, 1], { linetype: "ByBlock", lineweight: "Default" });
    d.text([0, 0], "x", { linetype: DASHED, lineweight: 0 });
  });
  const built = d.build();
  assert.deepEqual(
    built.linetypes?.map((t) => t.name),
    ["Fence", "SOLID2", "HIDDEN", "DASHED"],
  );
  assert.deepEqual(built.layers[0], {
    name: "0",
    color: 7,
    off: true,
    locked: true,
    plot: false,
    linetype: "Fence",
    lineweight: 0.3,
  });
  assert.deepEqual(lint(built), []);
});

test("an entity's transparency is a whole percent from 0 to 90, ByLayer or ByBlock", () => {
  const d = createDrawing();
  const r12 = createDrawing({ dxf: "R12" });
  d.block("B", {}, () => d.circle([0, 0], 1, { transparency: "ByBlock" }));
  d.tableStyle({ name: "S", textHeight: 1 });
  const table = { style: "S", at: [0, 0], columns: [4], rows: [[{ text: "A" }]] } as const;
  assert.throws(() => d.line([0, 0], [1, 1], { transparency: 0.5 }), /50 for half, not 0\.5/);
  assert.throws(() => d.line([0, 0], [1, 1], { transparency: 91 }), /from 0 to 90/);
  assert.throws(() => d.line([0, 0], [1, 1], { transparency: -1 }), /from 0 to 90/);
  // @ts-expect-error: a transparency is a number or one of two names.
  assert.throws(() => d.line([0, 0], [1, 1], { transparency: "50%" }), /from 0 to 90/);
  // @ts-expect-error: an R12 entity takes its layer's.
  assert.throws(() => r12.line([0, 0], [1, 1], { transparency: 50 }), /R12 entities take no/);
  r12.line([0, 0], [1, 1], { transparency: "ByLayer" });
  // @ts-expect-error: a table's grid plots opaque in CAD programs.
  assert.throws(() => d.table({ ...table, transparency: 50 }), /A table has no transparency/);
  d.table({ ...table, transparency: "ByLayer" });

  d.line([0, 0], [1, 1], { transparency: 0 });
  d.line([0, 0], [1, 1], { transparency: 90 });
  d.line([0, 0], [1, 1], { transparency: "ByLayer" });
  d.insert("B", [0, 0], { transparency: "ByBlock" });
  d.hatch(
    [
      {
        points: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      },
    ],
    { transparency: 50 },
  );
  const built = d.build();
  assert.deepEqual(
    built.entities.map((e) => e.transparency),
    [undefined, 0, 90, undefined, "ByBlock", 50],
  );
  assert.deepEqual(lint(built), []);

  const faded = {
    ...built,
    entities: [wrong<Entity>({ ...dataOf(built.entities[1]!), transparency: 0.5 })],
  };

  assert.deepEqual(
    lint(faded).map((p) => p.rule),
    ["entity-transparency"],
  );
});

test("the blocks leaders place are found reading a list many layouts share once", () => {
  let reads = 0;

  const lines = new Proxy(
    Array.from({ length: 1000 }, () => ({ kind: "line", layer: "0", from: [0, 0], to: [1, 1] })),
    {
      get: (target, key) => {
        if (isString(key) && /^\d+$/.test(key)) reads++;

        return hasKey(target, key) ? target[key] : undefined;
      },
    },
  );

  const layouts = Array.from({ length: 1000 }, (_, i) => ({ name: `S${i}`, entities: lines }));
  assert.equal(leaderBlockKeys({ entities: [], layouts }).size, 0);
  assert.equal(reads, 1000);
});

test("a block a leader places takes no percent of its own, which CAD programs drop", () => {
  const d = createDrawing({ units: "in" });
  d.leaderStyle({ name: "NOTES", textHeight: 0.1, arrowSize: 0.12, landing: 0.2, gap: 0.05 });
  d.block("FADED", {}, () => d.circle([0, 0], 1, { transparency: 0 }));
  d.block("TAG", {}, () => {
    d.circle([0, 0], 1, { transparency: "ByBlock" });
    d.line([0, 0], [1, 0], { transparency: "ByLayer" });
    d.insert("FADED", [0, 0]);
    d.attribute("NO", [0, -1], { value: "1", height: 0.1 });
  });
  const leader = { style: "NOTES", at: [3, 3], to: [2, 2] } as const;
  assert.throws(
    () => d.leader({ block: "FADED" }, leader),
    /CAD programs make every entity of a block a leader places transparent ByBlock/,
  );
  // An insert in it may place a block with one: CAD programs keep that.
  d.leader({ block: "TAG" }, leader);
  d.insert("FADED", [5, 5]);
  const built = d.build();
  assert.deepEqual(lint(built), []);
  // Its file holds all it draws ByBlock, and its attribute definition, as CAD programs read it.
  const dxf = toDXF(built);

  const block = (name: string): string => {
    const at = dxf.indexOf(`AcDbBlockBegin\r\n2\r\n${name}\r\n`);

    return dxf.slice(at, dxf.indexOf("ENDBLK", at));
  };

  assert.equal(block("TAG").match(/\r\n440\r\n16777216\r\n/g)?.length, 4);
  assert.match(block("FADED"), /\r\n440\r\n33554687\r\n/);

  const placed: Drawing = {
    ...built,
    entities: [...built.entities, { ...ofKind(built.entities[0], "leader"), block: "FADED" }],
  };

  assert.deepEqual(
    lint(placed).map((p) => [p.rule, p.block]),
    [["entity-transparency", "FADED"]],
  );
});

test("entity color mistakes are compile errors and runtime errors", () => {
  const r12 = createDrawing({ dxf: "R12" });
  const d = createDrawing();
  d.block("B", {}, () => d.circle([0, 0], 1));
  d.dimensionStyle({
    name: "DIMS",
    textHeight: 1,
    arrowSize: 1,
    extensionOffset: 0.5,
    extensionBeyond: 1,
    textGap: 0.5,
    precision: 2,
  });
  d.leaderStyle({ name: "NOTES", textHeight: 0.1, arrowSize: 0.12, landing: 0.2, gap: 0.05 });

  // @ts-expect-error: no color has index 0.
  assert.throws(() => d.line([0, 0], [1, 1], { color: 0 }), /An entity's color is/);
  // @ts-expect-error: nor 256.
  assert.throws(() => d.circle([0, 0], 1, { color: 256 }), /An entity's color is/);
  // @ts-expect-error: an index is a whole number.
  assert.throws(() => d.insert("B", [0, 0], { color: 1.5 }), /An entity's color is/);
  // @ts-expect-error: a channel is at most 255.
  assert.throws(() => d.line([0, 0], [1, 1], { color: [256, 0, 0] }), /An entity's color is/);
  // @ts-expect-error: a true color has three channels.
  assert.throws(() => d.line([0, 0], [1, 1], { color: [1, 2] }), /An entity's color is/);
  // @ts-expect-error: an R12 entity takes its layer's color.
  assert.throws(() => r12.line([0, 0], [1, 1], { color: 1 }), /R12 entities take no color/);
  r12.line([0, 0], [1, 1], { color: "ByLayer" });

  const fit: Point[] = [
    [0, 0],
    [1, 1],
    [2, 0],
  ];

  const control: Point[] = [
    [0, 0],
    [1, 1],
    [2, 0],
    [3, 1],
  ];

  // @ts-expect-error: a curve's color is checked as any entity's.
  assert.throws(() => d.ellipse([0, 0], [2, 0], 0.5, { color: 0 }), /An entity's color is/);
  // @ts-expect-error: a spline's too.
  assert.throws(() => d.spline(fit, { color: [1, 2, 300] }), /An entity's color is/);
  // @ts-expect-error: and one by control points.
  assert.throws(() => d.controlSpline(control, { color: 256 }), /An entity's color is/);
  const colored = createDrawing();
  colored.ellipse([0, 0], [2, 0], 0.5, { color: 3 });
  colored.spline(fit, { color: [1, 2, 3] });
  colored.controlSpline(control, { color: "ByBlock" });
  const curveColors = colored.build().entities.map((e) => e.color);
  assert.deepEqual(curveColors, [3, [1, 2, 3], "ByBlock"]);

  d.line([0, 0], [1, 1], { color: 1 });
  d.line([0, 0], [1, 1], { color: "ByBlock" });
  d.line([0, 0], [1, 1], { color: "ByLayer" });
  d.line([0, 0], [1, 1], { color: [10, 200, 30] });
  d.insert("B", [0, 0], { color: 255 });
  d.linearDimension([0, 0], [10, 0], [5, 2], { style: "DIMS", color: [0, 0, 255] });
  d.leader("NOTE", { style: "NOTES", at: [4, 4], to: [2, 2], color: "ByBlock" });
  const ordinate = { style: "DIMS", axis: "x" } as const;
  // @ts-expect-error: an ordinate dimension's color is checked as any dimension's.
  assert.throws(() => d.ordinateDimension([1, 1], [1, 4], { ...ordinate, color: 0 }), /color is/);
  d.ordinateDimension([1, 1], [1, 4], { ...ordinate, color: 4 });
  const built = d.build();
  assert.deepEqual(
    built.entities.map((e) => e.color),
    [1, "ByBlock", undefined, [10, 200, 30], 255, [0, 0, 255], "ByBlock", 4],
  );
  assert.deepEqual(lint(built), []);
});

test("linetype mistakes the compiler cannot see are checked when the code runs", () => {
  const d = createDrawing();
  const weight: number = 0.33;
  const name: string = "NOPE";
  const pattern: number[] = [1];
  assert.throws(() => d.line([0, 0], [1, 1], { lineweight: weight }), /CAD app's, in/);
  assert.throws(() => d.line([0, 0], [1, 1], { linetype: name }), /"NOPE" is not defined/);
  assert.throws(() => d.linetype({ name: "P", pattern }), /2 to 12 lengths/);
  assert.throws(
    () => d.linetype({ name: "D", pattern: [1, -1], description: "x".repeat(250) }),
    /249/,
  );
  d.linetype({ name: "ΟΔΟΣ", pattern: [1, -1] });
  // A final sigma is no capital sigma to the leading CAD app, but its AUDIT calls the two one name.
  assert.throws(() => d.linetype({ name: "οδος", pattern: [1, -1] }), /AUDIT reports them as one/);
  assert.throws(() => d.line([0, 0], [1, 1], { linetype: "οδος" }), /not defined/);
  // The total of the lengths is written too, and the compiler cannot add.
  assert.throws(() => d.linetype({ name: "T", pattern: [9e99, -9e99] }), /added up/);
  // AUDIT reports a twin of a built-in linetype as a duplicate.
  assert.throws(
    () => d.linetype({ name: "Conti\u00adnuous", pattern: [1, -1] }),
    /and "Continuous" as two linetypes/,
  );
  // A definition given to a layer or an entity must match the drawing's of that name.
  const fence = { name: "fence", pattern: [1, -1] };
  d.linetype({ name: "FENCE", pattern: [1, -1] }).line([0, 0], [1, 1], { linetype: fence });
  assert.throws(
    () => d.line([0, 0], [1, 1], { linetype: { ...fence, pattern: [2, -1] } }),
    /another pattern or description/,
  );
  assert.throws(
    () => d.layer("A", { linetype: { ...fence, description: "x" } }),
    /another pattern or description/,
  );
});

test("lint checks the linetypes, lineweights and layer states of a drawing", () => {
  const drawing: Drawing = {
    format: 0,
    units: "in",
    dxf: "R2018",
    linetypeScale: -1,
    linetypes: [
      { name: "DASHED", description: "", pattern: [0.5, -0.25] },
      { name: "dashed", description: "", pattern: [1, -1] },
      { name: "ByLayer", description: "", pattern: [1, -1] },
      { name: "ONE", description: "", pattern: [1] },
    ],
    layers: [
      { name: "0", color: 7, frozen: true },
      { name: "A", color: 1, linetype: "NOPE", lineweight: 0.33 },
      { name: "B", color: 1, linetype: "ByBlock" },
    ],
    entities: [
      { kind: "line", layer: "A", from: [0, 0], to: [1, 1], linetype: "MISSING" },
      { kind: "line", layer: "A", from: [0, 0], to: [1, 1], lineweight: 2.12 },
      { kind: "line", layer: "A", from: [0, 0], to: [1, 1], linetype: "dashed", lineweight: 2.11 },
    ],
  };

  assert.deepEqual(
    lint(drawing).map((p) => `${p.rule} ${p.linetype ?? p.layer ?? p.entity ?? ""}`),
    [
      "linetype ",
      "duplicate-linetype dashed",
      "linetype ByLayer",
      "linetype ONE",
      "layer-state 0",
      "undefined-linetype A",
      "lineweight A",
      "linetype B",
      "undefined-linetype 0",
      "lineweight 1",
    ],
  );
  assert.match(lint(drawing)[8]?.message ?? "", /discards a drawing that uses a linetype/);

  const r12: Drawing = {
    ...drawing,
    dxf: "R12",
    linetypeScale: 1,
    linetypes: [{ name: "DASHED", description: "", pattern: [0.5, -0.25] }],
    layers: [{ name: "0", color: 7, off: true, lineweight: "Default", linetype: "Continuous" }],
    entities: [{ kind: "line", layer: "0", from: [0, 0], to: [1, 1], lineweight: 0.5 }],
  };

  assert.deepEqual(
    lint(r12).map((p) => `${p.rule} ${p.message.replace(/\. Use.*/, "")}`),
    [
      'linetype Linetype "DASHED": R12 drawings have no linetypes but Continuous, and no linetype scale',
      'layer-state Layer "0": tsdraft writes no layer states to R12 drawings',
      "lineweight line #0: R12 entities take no linetype or lineweight of their own",
    ],
  );

  // lint reports the new rules, and fields of the wrong type in a drawing built by hand.
  const odd = wrong<Drawing>({
    format: 0,
    units: "in",
    dxf: "R2018",
    linetypes: [
      { name: "TOTAL", description: "", pattern: [9e99, -9e99] },
      { name: "TINY", description: "", pattern: [1, -4e-7] },
      { name: "Conti\u00adnuous", description: "", pattern: [1, -1] },
      { name: "NO DESCRIPTION", pattern: [1, -1] },
      { name: "NOT AN ARRAY", description: "", pattern: "1,-1" },
      { name: 7, description: "", pattern: [] },
    ],
    layers: [{ name: "0", color: 7, off: "yes", linetype: 5, lineweight: "thick" }],
    entities: [
      { kind: "line", layer: "0", from: [0, 0], to: [1, 1], linetype: 3, lineweight: null },
    ],
  });

  assert.deepEqual(
    lint(odd).map((p) => p.message),
    [
      `Linetype "TOTAL": its pattern: A linetype pattern's lengths, added up without their signs, must be under 1e100. The total is written too, and the leading CAD app reads only two exponent digits from DXF`,
      'Linetype "TINY": its pattern: A dash or gap of this length is written as 0, because tsdraft writes 6 decimals, and would draw as a dot. Use 0 for a dot, or a length of 0.000001 or more',
      'Linetype "Conti\u00adnuous": The leading CAD app keeps this linetype and "Continuous" as two linetypes, but its AUDIT reports them as one duplicate name',
      `Linetype "NO DESCRIPTION": A linetype's description must be a string`,
      `Linetype "NOT AN ARRAY": A linetype's pattern must be an array of finite numbers`,
      "Linetype 7: A linetype's name must be a string",
      'Layer "0": a linetype is named by a string',
      'Layer "0": A lineweight must be one of the leading CAD app\'s, in millimetres: 0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2 or 2.11, or "Default"',
      'Layer "0": off must be true or false',
      "line #0: a linetype is named by a string",
      'line #0: A lineweight must be one of the leading CAD app\'s, in millimetres: 0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2 or 2.11, or "ByLayer", "ByBlock" or "Default"',
    ],
  );
});

test("text style and justification mistakes are compile errors and runtime errors", () => {
  const r12 = createDrawing({ dxf: "R12" });
  const d = createDrawing();

  // @ts-expect-error: R12 drawings get no text styles.
  assert.throws(() => r12.textStyle({ name: "NOTES", font: "Arial" }), /no text styles/);
  // @ts-expect-error: nor a text in a style other than Standard.
  assert.throws(() => r12.text([0, 0], "x", { style: "NOTES" }), /no text styles/);
  // @ts-expect-error: nor a style given in place.
  assert.throws(() => r12.text([0, 0], "x", { style: { name: "N", font: "Arial" } }), /R12/);
  // @ts-expect-error: nor a justified text.
  assert.throws(() => r12.text([0, 0], "x", { align: "center" }), /no text justification/);
  // @ts-expect-error: up and down as well.
  assert.throws(() => r12.text([0, 0], "x", { valign: "top" }), /no text justification/);
  r12.text([0, 0], "x", { style: "Standard", align: "left", valign: "baseline" });

  // @ts-expect-error: the leading CAD app draws a font it does not have in another font.
  assert.throws(() => d.textStyle({ name: "A", font: "Comic Sans MS" }), /one of FONTS/);
  // @ts-expect-error: an SHX font goes by its file name.
  assert.throws(() => d.textStyle({ name: "A", font: "txt" }), /one of FONTS/);
  // @ts-expect-error: Standard is in every drawing.
  assert.throws(() => d.textStyle({ name: "STANDARD", font: "Arial" }), /cannot be defined/);
  // @ts-expect-error: a style name follows the rules of layer names.
  assert.throws(() => d.textStyle({ name: "A/B", font: "Arial" }), /Text style names cannot/);
  // @ts-expect-error: AUDIT reports a width factor of 0 or less.
  assert.throws(() => d.textStyle({ name: "A", font: "Arial", widthFactor: 0 }), /0\.01 to 100/);
  // @ts-expect-error: or one far from 1.
  assert.throws(() => d.textStyle({ name: "A", font: "Arial", widthFactor: 0.009 }), /0\.01 to/);
  // @ts-expect-error: either way.
  assert.throws(() => d.textStyle({ name: "A", font: "Arial", widthFactor: 100.5 }), /0\.01 to/);
  // A limit is judged as the number is written, with 6 decimals, by the compiler too.
  d.textStyle({ name: "EDGES", font: "Arial", widthFactor: 0.0099996, obliqueAngle: 85.0000004 });
  d.textStyle({ name: "EDGES", font: "Arial", widthFactor: 100.0000004, obliqueAngle: -85 });
  assert.throws(
    // @ts-expect-error: written as 0.009999.
    () => d.textStyle({ name: "A", font: "Arial", widthFactor: 0.0099994 }),
    /0\.01 to/,
  );
  assert.throws(
    // @ts-expect-error: written as 100.000001.
    () => d.textStyle({ name: "A", font: "Arial", widthFactor: 100.0000006 }),
    /to 100/,
  );
  assert.throws(
    // @ts-expect-error: written as 85.000001.
    () => d.textStyle({ name: "A", font: "Arial", obliqueAngle: 85.0000006 }),
    /-85 to 85/,
  );
  d.textStyle({ name: "EDGES", font: "Arial", widthFactor: 100 });
  // @ts-expect-error: an oblique angle stays within 85 degrees.
  assert.throws(() => d.textStyle({ name: "A", font: "Arial", obliqueAngle: 85.5 }), /-85 to 85/);
  // @ts-expect-error: on either side.
  assert.throws(() => d.textStyle({ name: "A", font: "Arial", obliqueAngle: -90 }), /-85 to 85/);
  // @ts-expect-error: a text names a style by a valid name.
  assert.throws(() => d.text([0, 0], "x", { style: "A,B" }), /Text style names cannot/);
  // @ts-expect-error: a style given in place is checked as textStyle() checks one.
  assert.throws(() => d.text([0, 0], "x", { style: { name: "A", font: "Nope" } }), /one of FONTS/);
  // @ts-expect-error: "middle" is a place up and down the line, not along it.
  assert.throws(() => d.text([0, 0], "x", { align: "middle" }), /align must be "left", "center"/);
  // @ts-expect-error: and "center" is along it.
  assert.throws(() => d.text([0, 0], "x", { valign: "center" }), /valign must be "baseline"/);

  // What the compiler cannot see.
  const font: string = "Papyrus";
  assert.throws(() => d.textStyle({ name: "A", font }), /one of FONTS/);
  const missing: string = "MISSING";
  assert.throws(
    () => d.text([0, 0], "x", { style: missing, id: "t" }),
    (thrown) => {
      assert.ok(thrown instanceof DrawingError);
      const [found] = thrown.diagnostics;
      assert.equal(found?.rule, "undefined-text-style");
      assert.equal(found?.id, "t");
      assert.match(
        thrown.message,
        /"MISSING" is not defined\. The leading CAD app puts .* in Standard.* Define it with textStyle\(\) first/,
      );

      return true;
    },
  );
  assert.throws(
    () =>
      d.textStyle({ name: "strasse", font: "Arial" }).textStyle({ name: "straße", font: "Arial" }),
    /duplicate name/,
  );

  d.textStyle({ name: "Notes", font: "Arial", widthFactor: 0.9, obliqueAngle: -85 });
  // A style given in place must be the one the drawing has.
  assert.throws(
    () => d.text([0, 0], "x", { style: { name: "NOTES", font: "txt.shx" } }),
    /another font/,
  );
  d.text([1, 2], "x", { style: "NOTES", align: "center", valign: "middle" });
  d.text([1, 2], "x", { style: "standard", align: "left", valign: "baseline" });
  d.text([1, 2], "x", {
    style: { name: "TITLE", font: "txt.shx", widthFactor: 1, obliqueAngle: 0 },
  });
  const drawing = d.build();
  // Defaults are left out, and a style keeps its first spelling.
  assert.deepEqual(drawing.textStyles?.slice(-2), [
    { name: "Notes", font: "Arial", widthFactor: 0.9, obliqueAngle: -85 },
    { name: "TITLE", font: "txt.shx" },
  ]);
  assert.deepEqual(drawing.entities, [
    {
      kind: "text",
      layer: "0",
      at: [1, 2],
      value: "x",
      height: 0.125,
      rotation: 0,
      style: "Notes",
      align: "center",
      valign: "middle",
    },
    { kind: "text", layer: "0", at: [1, 2], value: "x", height: 0.125, rotation: 0 },
    {
      kind: "text",
      layer: "0",
      at: [1, 2],
      value: "x",
      height: 0.125,
      rotation: 0,
      style: "TITLE",
    },
  ]);
  assert.deepEqual(lint(drawing), []);
  // A drawing with no text style of its own has no `textStyles`, as before there were any.
  assert.ok(!("textStyles" in createDrawing().text([0, 0], "x").build()));
});

test("lint checks the text styles and justification of a drawing", () => {
  const text = {
    kind: "text",
    layer: "0",
    at: [0, 0],
    value: "x",
    height: 1,
    rotation: 0,
  } as const;

  const byHand = {
    format: 0,
    units: "in",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    textStyles: [
      { name: "NOTES", font: "Arial" },
      { name: "notes", font: "Arial" },
      { name: "Standard", font: "Arial" },
      { name: "FONT", font: "Wingdings" },
      { name: "WIDE", font: "Arial", widthFactor: -1 },
      { name: "LEAN", font: "Arial", obliqueAngle: 86 },
      { name: "strasse", font: "Arial" },
      { name: "straße", font: "Arial" },
    ],
    entities: [
      { ...text, style: "notes", align: "right", valign: "top" },
      { ...text, style: "MISSING" },
      { ...text, align: "fit" },
      { ...text, valign: "center" },
    ],
  };

  const drawing = wrong<Drawing>(byHand);

  assert.deepEqual(
    lint(drawing).map((p) => `${p.rule} ${p.textStyle ?? p.entity}`),
    [
      "duplicate-text-style notes",
      "text-style Standard",
      "text-style FONT",
      "text-style WIDE",
      "text-style LEAN",
      "duplicate-text-style straße",
      "undefined-text-style 1",
      "text-align 2",
      "text-align 3",
    ],
  );

  // An R12 drawing takes none of it but the defaults.
  const r12 = wrong<Drawing>({
    ...byHand,
    textStyles: [{ name: "NOTES", font: "Arial" }],
    entities: [
      { ...text, style: "STANDARD", align: "left", valign: "baseline" },
      { ...text, style: "NOTES" },
      { ...text, align: "center" },
    ],
  });

  assert.deepEqual(
    lint(r12, { version: "R12" }).map((p) => `${p.rule} ${p.textStyle ?? p.entity}`),
    ["text-style NOTES", "text-style 1", "text-align 2"],
  );
  assert.throws(() => toDXF(r12, { version: "R12" }), DrawingError);
});

test("fromPaper turns a plotted length into drawing units", () => {
  assert.equal(fromPaper(3 / 32, "in", { ratio: 96, units: "ft" }), 0.75);
  assert.equal(fromPaper(3 / 32, "in", { ratio: 96, units: "in" }), 9);
  assert.equal(fromPaper(2.5, "mm", { ratio: 50, units: "m" }), 0.125);
  assert.equal(fromPaper(2.5, "mm", { ratio: 100, units: "cm" }), 25);
  assert.equal(fromPaper(0.1, "in", { ratio: 100, units: "mm" }), 254);
  assert.equal(fromPaper(25.4, "mm", { ratio: 240, units: "ft" }), 20);

  const feet = { ratio: 96, units: "ft" } as const;
  // @ts-expect-error: a paper length is "in" or "mm".
  assert.throws(() => fromPaper(1, "ft", feet), /^Error: The paper unit must be "in" or "mm"/);
  // @ts-expect-error: the drawing's units are one of tsdraft's.
  assert.throws(() => fromPaper(1, "in", { ratio: 96, units: "yd" }), /Unknown units/);
  // @ts-expect-error: a ratio of 0 plots nothing.
  assert.throws(() => fromPaper(1, "in", { ratio: 0, units: "ft" }), /^Error: The ratio must/);
  // @ts-expect-error: a paper length must be positive.
  assert.throws(() => fromPaper(-1, "in", feet), /^Error: The paper length must be greater/);

  const nan: number = Number.NaN;
  assert.throws(() => fromPaper(nan, "in", feet), /paper length must be a finite/);
  assert.throws(() => fromPaper(1, "in", { ratio: nan, units: "ft" }), /ratio must be a finite/);
  assert.throws(
    () => fromPaper(1e-7, "in", { ratio: 1, units: "ft" }),
    /written as 0.*Use a longer paper length or a larger ratio$/,
  );
  assert.throws(() => fromPaper(1e60, "mm", { ratio: 1e60, units: "mm" }), /1e100 drawing units/);
});

test("the example sheet builds with no lint diagnostics and no warning about its text", () => {
  assert.deepEqual(lint(sheet), []);
  assert.deepEqual(inspectText(sheet), []);
});

// A text's box as it plots in the example's font.
function textBox(e: Text): [left: number, bottom: number, right: number, top: number] {
  const corners = measureText({ ...e, font: "Arial" }).corners;
  const [xs, ys] = [corners.map((c) => c[0]), corners.map((c) => c[1])];

  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

for (const [scale, ratio] of [
  ["1in-10ft", 120],
  ["1in-20ft", 240],
] as const) {
  test(`the example sheet at ${scale} is laid out in its two spaces`, () => {
    const { drawing, layout, drawingArea, titleBlock, fields, viewport, view, keyPlan } =
      sitePlan(scale);

    const [page] = drawing.layouts!;
    assert.equal(page!.name, layout);
    const sides = (box: Box) => [box.left, box.bottom, box.right, box.top];
    assert.deepEqual(sides(drawingArea), [0.5, 0.5, 35.5, 23.5]);
    assert.deepEqual(sides(titleBlock), [29, 0.5, 35.5, 3.5]);
    assert.deepEqual(sides(viewport), [0.5, 2, 20.5, 23.5]);
    assert.deepEqual(sides(keyPlan), [21, 2, 27.5, 8.5]);
    // The viewport shows `view` of model space, which is its rectangle at the ratio.
    const [shown] = page!.viewports;
    const seen = viewportView(shown!, "in", drawing.units);
    assert.deepEqual(
      seen.box,
      sides(view).map((n) => Number(n.toFixed(6))),
    );
    assert.equal(seen.width / (view.right - view.left), 12 / ratio);

    const slack = 1e-9;
    const { blocks, textStyles } = drawing;

    const inside = (box: readonly number[], outer: Box) =>
      box[0]! >= outer.left - slack &&
      box[2]! <= outer.right + slack &&
      box[1]! >= outer.bottom - slack &&
      box[3]! <= outer.top + slack;

    const overlap = (a: readonly number[], b: readonly number[]) =>
      a[2]! > b[0]! + slack &&
      a[0]! < b[2]! - slack &&
      a[3]! > b[1]! + slack &&
      a[1]! < b[3]! - slack;

    // Model space is the site at its true size, and all of it shows in the viewport.
    const lot = drawing.entities.find((e) => e.layer === "C-PROP");
    assert.deepEqual(lot?.kind === "polyline" && lot.points[2], [100, 140]);

    const boxOf = (entities: readonly Entity[]) =>
      extents(
        entities,
        textStyles,
        blocks,
        undefined,
        undefined,
        undefined,
        drawing.dimensionStyles,
      );

    assert.ok(inside(boxOf(drawing.entities), view));

    // The sheet is in inches, inside the border. Only the title block is in its own space, and
    // nothing but the viewport is over the plan.
    assert.ok(inside(boxOf(page!.entities), drawingArea));
    const [border, ...rest] = page!.entities;
    assert.ok(border?.kind === "insert" && border.block === "TITLE BLOCK");

    for (const entity of rest) {
      const box = boxOf([entity]);
      const what = `${entity.kind} on ${entity.layer}`;
      assert.ok(!overlap(box, sides(titleBlock)), `${what} is in the title block's space`);
      assert.ok(!overlap(box, sides(viewport)), `${what} is over the viewport`);
      assert.ok(!overlap(box, sides(keyPlan)), `${what} is over the key plan`);
    }

    // Every text of a space, the ones its inserts draw among them, attributes too. The
    // example's inserts scale both ways alike and are not turned.
    const textsOf = (entities: readonly Entity[]): Text[] => {
      const texts: Text[] = [];

      for (const entity of entities) {
        eachDrawn(
          entity,
          blocksByKey(blocks),
          () => false,
          (drawn, { matrix }) => {
            if (drawn.kind === "linear-dimension" || drawn.kind === "aligned-dimension") {
              // A dimension's text, as tsdraft draws it: centered on the middle of its baseline.
              const style = findDimensionStyle(drawing, drawn.style)!;
              const { label } = dimensionPicture(drawn, style);
              texts.push({ ...label, kind: "text", layer: drawn.layer, align: "center" });

              return;
            }

            if (drawn.kind !== "text") return;
            const scale = matrix ? matrix[0] : 1;
            const at = matrix ? mapPoint(matrix, drawn.at) : drawn.at;
            texts.push({ ...drawn, at, height: drawn.height * scale });
          },
        );
      }

      return texts;
    };

    const onPaper = textsOf(page!.entities);

    // A text is the size it plots at in both spaces: 3/32 inch for a note of the plan, which
    // is `ratio` times that in model space, and for a number of the graphic scale.
    const height = (texts: readonly Text[], value: string) =>
      texts.find((t) => t.value === value)!.height;

    assert.equal(height(textsOf(drawing.entities), "EDGE OF PAVEMENT"), (3 / 32) * (ratio / 12));
    assert.equal(height(onPaper, "FEET"), 3 / 32);

    for (const texts of [textsOf(drawing.entities), onPaper]) {
      texts.forEach((a, i) => {
        for (const b of texts.slice(i + 1)) {
          assert.ok(!overlap(textBox(a), textBox(b)), `"${a.value}" overlaps "${b.value}"`);
        }
      });
    }

    // Each field of the title block has a value of its own, inside its box.
    const values = ofKind(border, "insert").attributes!;
    assert.deepEqual(Object.keys(values).sort(), Object.keys(fields).sort());
    assert.equal(values.SHEET, layout);
    // The sheet shows the plan and the key plan at two scales.
    assert.equal(values.SCALE, "AS NOTED");

    for (const [tag, box] of Object.entries(fields)) {
      const text = onPaper.find((t) => t.value === values[tag]);
      assert.ok(text && inside(textBox(text), box), `the field ${tag} is outside its box`);
    }
  });
}

test("entity ids are checked as literals, when the code runs, and by lint", () => {
  const d = createDrawing();
  d.line([0, 0], [1, 0], { id: "Door-1" });

  // An id that is not a literal passes the compiler and is checked when the code runs.
  for (const n of [1, 2]) d.rect([0, 0], 1, 1, { id: `${"a".repeat(59)}.${n}_9` });
  // @ts-expect-error: an id cannot be empty.
  assert.throws(() => d.line([0, 0], [1, 0], { id: "" }), /cannot be empty/);
  // @ts-expect-error: an id has no spaces.
  assert.throws(() => d.circle([0, 0], 1, { id: "door 1" }), /can only use/);
  // @ts-expect-error: an id has no dollar sign, which a layer name may have.
  assert.throws(() => d.text([0, 0], "x", { id: "door$1" }), /can only use/);
  const tooLong = "a234567890a234567890a234567890a234567890a234567890a23456789012345";
  // @ts-expect-error: 65 characters is one too many.
  assert.throws(() => d.arc([0, 0], 1, 0, 90, { id: tooLong }), /longer than 64/);
  // Whether the drawing has the id already is known only when the code runs.
  assert.throws(
    () => d.line([0, 0], [1, 0], { id: "door-1" }),
    (thrown) =>
      thrown instanceof DrawingError &&
      thrown.diagnostics[0]?.rule === "duplicate-id" &&
      /"door-1" is already used, as "Door-1"/.test(thrown.message),
  );
  assert.equal(d.build().entities.length, 3);

  const [first, second] = d.build().entities;

  const byHand: Drawing = {
    ...d.build(),
    entities: [first!, second!, { ...first!, id: "DOOR-1" }, { ...first!, id: "é" }],
  };

  assert.deepEqual(
    lint(byHand).map((x) => [x.rule, x.entity, x.id]),
    [
      ["duplicate-id", 2, "DOOR-1"],
      ["id", 3, "é"],
    ],
  );
  assert.throws(() => toDXF(byHand), DrawingError);
  // A drawing with no format version, or another one, is refused too.
  const { format: _, ...unversioned } = d.build();

  for (const other of [dataOf(unversioned), { ...dataOf(unversioned), format: 1 }]) {
    assert.deepEqual(
      lint(wrong(other)).map((x) => x.rule),
      ["format"],
    );
  }
});

test("two ids that give one handle are refused by the builder and by lint", () => {
  const d = createDrawing();
  d.line([0, 0], [1, 0], { id: "wall-18709862" });
  // Which ids share a handle is known only when the code runs.
  assert.throws(
    () => d.line([0, 1], [1, 1], { id: "Wall-121406389" }),
    (thrown) =>
      thrown instanceof DrawingError &&
      thrown.diagnostics[0]?.rule === "id-handle" &&
      thrown.diagnostics[0].id === "Wall-121406389" &&
      /"wall-18709862" and "Wall-121406389" give the same handle, 1152F0C91847EA/.test(
        thrown.message,
      ),
  );
  const [first] = d.build().entities;

  const byHand: Drawing = {
    ...d.build(),
    entities: [first!, { ...first!, id: "wall-121406389" }, { ...first!, id: "wall-1" }],
  };

  assert.deepEqual(
    lint(byHand).map((x) => [x.rule, x.entity, x.id]),
    [["id-handle", 1, "wall-121406389"]],
  );
  assert.throws(() => toDXF(byHand), DrawingError);
});

test("the extents hold a slanted text's lean, which its width factor does not widen", () => {
  // The leading CAD app draws the top of this text one height further along it, at a width factor of 2.
  const box = (obliqueAngle: 45 | -45) => {
    const d = createDrawing();
    d.textStyle({ name: "S", font: "txt.shx", widthFactor: 2, obliqueAngle });
    d.text([10, 20], "H", { height: 1, style: "S" });
    const drawing = d.build();

    return extents(drawing.entities, drawing.textStyles).map((n) => Number(n.toFixed(9)));
  };

  // The text is two thirds of its height long, twice over. What it draws below its baseline,
  // a third of its height, leans back.
  assert.deepEqual(box(45), [9.666666667, 19.666666667, 12.333333333, 21]);
  assert.deepEqual(box(-45), [9, 19.666666667, 11.666666667, 21]);
});

test("the extents of a turned text reach its far corner", () => {
  const d = createDrawing();
  d.text([0, 0], "AB", { height: 2, rotation: 45 });
  const drawing = d.build();
  const [left, , , top] = extents(drawing.entities, drawing.textStyles);
  const along = measureText({ value: "AB", height: 2 }).length;
  // The box holds the corner above the text's end, one height up from the end of its line.
  assert.ok(Math.abs(top - (along + 2) / Math.SQRT2) < 1e-9);
  assert.ok(Math.abs(left + 2 / Math.SQRT2) < 1e-9);
});

test("a polyline's width, radius and arcs, a cloud's arc and a donut's hole are checked twice", () => {
  const d = createDrawing();
  const r12 = createDrawing({ dxf: "R12" });

  const corner: Point[] = [
    [0, 0],
    [1, 0],
    [1, 1],
  ];

  // @ts-expect-error: a width cannot be less than 0.
  assert.throws(() => d.polyline(corner, false, { width: -1 }), /width cannot be less than 0/);
  // @ts-expect-error: a radius must be greater than 0.
  assert.throws(() => d.polyline(corner, false, { radius: 0 }), /greater than 0/);
  // @ts-expect-error: a radius must be greater than 0.
  assert.throws(() => d.rect([0, 0], 2, 2, { radius: -1 }), /greater than 0/);
  // @ts-expect-error: a cloud's arc must be greater than 0.
  assert.throws(() => d.cloud(corner, { arc: 0 }), /greater than 0/);
  // @ts-expect-error: a donut's hole cannot be less than 0 across.
  assert.throws(() => d.donut([0, 0], 1, { inside: -0.5 }), /hole cannot be less than 0/);
  // @ts-expect-error: R12 holds no arc of a polyline.
  assert.throws(() => r12.polyline(corner, false, { bulges: [0, 1] }), /no arcs or widths/);
  // @ts-expect-error: R12 holds no width.
  assert.throws(() => r12.polyline(corner, false, { width: 1 }), /no arcs or widths/);
  // @ts-expect-error: R12 holds no cloud, which is a polyline of arcs.
  assert.throws(() => r12.cloud(corner, { arc: 1 }), /no arcs or widths/);
  // @ts-expect-error: R12 holds no donut, which is a polyline of arcs.
  assert.throws(() => r12.donut([0, 0], 1), /no arcs or widths/);
});

test("a paragraph's height, width, line spacing and codes are checked twice", () => {
  const d = createDrawing();
  const r12 = createDrawing({ dxf: "R12" });
  const at: Point = [0, 0];
  // @ts-expect-error: a height must be greater than 0.
  assert.throws(() => d.paragraph("NOTE", { at, height: 0 }), /greater than 0/);
  // @ts-expect-error: a width must be greater than 0.
  assert.throws(() => d.paragraph("NOTE", { at, width: -1 }), /greater than 0/);
  // @ts-expect-error: a width that rounds to 0 is written as 0, which wraps nothing.
  assert.throws(() => d.paragraph("NOTE", { at, width: 1e-7 }), /written as 0/);
  // @ts-expect-error: the leading CAD app takes a line spacing from 0.25 to 4.
  assert.throws(() => d.paragraph("NOTE", { at, lineSpacing: 0.2 }), /from 0.25 to 4/);
  // @ts-expect-error: the leading CAD app takes a line spacing from 0.25 to 4.
  assert.throws(() => d.paragraph("NOTE", { at, lineSpacing: 4.5 }), /from 0.25 to 4/);
  // @ts-expect-error: a factor is held to the range as given, so none rounds into it when written.
  assert.throws(() => d.paragraph("NOTE", { at, lineSpacing: 0.2499999 }), /from 0.25 to 4/);
  // @ts-expect-error: nor out of it.
  assert.throws(() => d.paragraph("NOTE", { at, lineSpacing: 4.0000004 }), /from 0.25 to 4/);
  d.paragraph("NOTE", { at, lineSpacing: 0.25 }).paragraph("NOTE", { at, lineSpacing: 4 });
  // @ts-expect-error: a brace is never closed.
  assert.throws(() => d.paragraph("{\\LNOTE", { at }), /never closed/);
  // @ts-expect-error: a brace closes nothing.
  assert.throws(() => d.paragraph("NOTE}", { at }), /closes no \{/);
  d.paragraph("\\H2x;NOTE\\W0.8;\\Q15;\\A1;\\C1;\\c255;", { at });
  // @ts-expect-error: a true color is a whole number.
  assert.throws(() => d.paragraph("\\c-1;NOTE", { at }), /code \\c takes a true color/);
  assert.throws(
    () =>
      // @ts-expect-error: more than 64 digits after the point.
      d.paragraph("\\W1.00000000000000000000000000000000000000000000000000000000000000001;NOTE", {
        at,
      }),
    /code \\W takes a width factor above 0/,
  );
  // @ts-expect-error: a height of 0.
  assert.throws(() => d.paragraph("\\H0x;NOTE", { at }), /code \\H takes a height above 0/);
  // @ts-expect-error: the spacing of the characters is not laid out yet.
  assert.throws(() => d.paragraph("\\T1.5;NOTE", { at }), /code \\T, which sets the spacing/);
  d.paragraph("\\pxi-3,l3,t3;1.\tNOTE", { at });
  // @ts-expect-error: a tab stop that aligns by its right is not laid out yet.
  assert.throws(() => d.paragraph("\\pxtr3;1.\tNOTE", { at }), /aligns text by its right/);
  // @ts-expect-error: nor is spacing at least a size.
  assert.throws(() => d.paragraph("\\psa1;NOTE", { at }), /at least a size apart/);
  // @ts-expect-error: an option \p does not know.
  assert.throws(() => d.paragraph("\\pz3;NOTE", { at }), /option "z3"/);
  d.paragraph("ONE\\NTWO", { at, width: 2, columns: { count: 2, height: 1 } });
  assert.throws(
    // @ts-expect-error: a height and heights both.
    () => d.paragraph("ONE", { at, width: 2, columns: { height: 1, heights: [1] } }),
    /\{ heights, gutter\? \}/,
  );
  assert.throws(
    // @ts-expect-error: a count with heights.
    () => d.paragraph("ONE", { at, width: 2, columns: { heights: [1], count: 2 } }),
    /\{ heights, gutter\? \}/,
  );
  assert.throws(() => d.paragraph("ONE", { at, columns: { height: 1 } }), /needs a width/);
  // @ts-expect-error: a code tsdraft does not know.
  assert.throws(() => d.paragraph("\\ZNOTE", { at }), /code \\Z is not one tsdraft knows/);
  // @ts-expect-error: a font with no ; to end it.
  assert.throws(() => d.paragraph("\\fArial|b1NOTE", { at }), /no ; to end it/);
  // @ts-expect-error: a font that is not one of FONTS.
  assert.throws(() => d.paragraph("\\fHelvetica;NOTE", { at }), /not one of FONTS/);
  // @ts-expect-error: tsdraft has no widths for italic.
  assert.throws(() => d.paragraph("\\fArial|b0|i1;NOTE", { at }), /sets italic/);
  // @ts-expect-error: a font's option has digits alone after its letter, as the parser reads it.
  assert.throws(() => d.paragraph("\\fArial|c-1;NOTE", { at }), /option "c-1"/);
  // @ts-expect-error: and gives each option once.
  assert.throws(() => d.paragraph("\\fArial|b1|b0;NOTE", { at }), /option b twice/);
  d.paragraph("\\fArial|b0|c01|p34;NOTE", { at });
  // @ts-expect-error: an SHX font has no bold.
  assert.throws(() => d.paragraph("\\ftxt.shx|b1;NOTE", { at }), /SHX font, which has no bold/);
  // @ts-expect-error: a stack needs a divider.
  assert.throws(() => d.paragraph("3\\S12;", { at }), /needs a \/, # or \^/);
  // @ts-expect-error: nor is an overline.
  assert.throws(() => d.paragraph("\\ONOTE", { at }), /code \\O, which draws a line over/);
  // @ts-expect-error: nor is a stacked part of letters whose tops the tables do not hold.
  assert.throws(() => d.paragraph("\\Sx/y;", { at }), /stacked part/);
  // @ts-expect-error: nor is a stack in underlined text.
  assert.throws(() => d.paragraph("{\\L1\\S1/2;}", { at }), /stack in underlined/);
  // @ts-expect-error: and a slash after the divider is a character of the bottom part.
  assert.throws(() => d.paragraph("\\S1/2/3;", { at }), /stacked part/);
  const deep = "{{{{{{{{{{{{{{{{{x}}}}}}}}}}}}}}}}}";
  // @ts-expect-error: braces nest at most 16 deep.
  assert.throws(() => d.paragraph(deep, { at }), /nest more than 16 deep/);
  // An SHX font draws %%c as a sign of its own, which is not laid out yet. The type does not know
  // the style's font.
  assert.throws(() => d.paragraph("%%c6", { at }), /%%c in an SHX font/);
  d.textStyle({ name: "NOTES", font: "Arial" });
  // @ts-expect-error: but it knows one a code names, as far as its group reaches.
  assert.throws(() => d.paragraph("\\fromans.shx;%%c6", { at }), /%%c in an SHX font/);
  // @ts-expect-error: a group inside it in another font closes back to the SHX one.
  assert.throws(() => d.paragraph("\\Fromans.shx;{\\fArial;x}%%C6", { at }), /%%c in an SHX/);
  d.paragraph("{\\fromans.shx;x}%%c6 {\\fromans.shx;{\\fArial;%%c6}}", { at, style: "NOTES" });
  // @ts-expect-error: a backslash before a line feed would escape the paragraph break.
  assert.throws(() => d.paragraph("A\\\nB", { at }), /code \\\n is not one tsdraft knows/);
  d.paragraph("A\\\\\nB", { at, style: "NOTES" });

  // A line feed is a paragraph break, and the codes tsdraft lays out pass.
  const laid =
    "{\\fArial|b1;NOTES}\n1. {\\LALL} WORK\\~%%d %%c %%% 100%% \\S1/2; \\S+0.01^-0.02; \\S2^ ; \\S^2; \\U+00B0 \\\\";

  d.paragraph(laid, { at, width: 2, style: "NOTES" });
  // @ts-expect-error: R12 holds no paragraph.
  assert.throws(() => r12.paragraph("NOTE", { at }), /no paragraphs to R12/);
});

test("hatch patterns and a hatch's pattern are checked by the builder and by lint", () => {
  const file = "*STRIPES, Dashed stripes\n45, 0,0, 0,0.25, 0.5,-0.25\n*STRIPES\n0, 0,0, 0,1\n";

  const box: Point[] = [
    [0, 0],
    [8, 0],
    [8, 4],
    [0, 4],
  ];

  const d = createDrawing({ units: "in" }).patterns(file);
  d.hatch(box, { pattern: { name: "stripes", scale: 2, angle: 30, origin: [1, 1] } });
  d.hatch(box, { pattern: { spacing: 0.5, crossed: true } });
  const built = d.build();
  // The first of a name in one file is added, and a hatch holds the name as the drawing has it.
  assert.deepEqual(built.patterns, [
    {
      name: "STRIPES",
      description: "Dashed stripes",
      lines: [{ angle: 45, base: [0, 0], offset: [0, 0.25], dashes: [0.5, -0.25] }],
    },
  ]);
  assert.deepEqual(built.entities[0], {
    kind: "hatch",
    layer: "0",
    loops: [{ points: box }],
    pattern: { name: "STRIPES", scale: 2, angle: 30, origin: [1, 1] },
  });
  assert.deepEqual(lint(built), []);
  assert.deepEqual(fromJSON(toJSON(built)), built);
  assert.equal("patterns" in createDrawing().build(), false);
  // A later call replaces a pattern of the name, and keeps its spelling.
  d.patterns([{ name: "Stripes", lines: [{ angle: 0, base: [0, 0], offset: [0, 1] }] }]);
  assert.deepEqual(d.build().patterns, [
    { name: "STRIPES", lines: [{ angle: 0, base: [0, 0], offset: [0, 1] }] },
  ]);

  // The builder refuses what lint refuses, in its words.
  const hatched = (pattern: Field, patterns = built.patterns): Drawing => {
    const entities = [
      wrong<Entity>({ kind: "hatch", layer: "0", loops: [{ points: box }], pattern }),
    ];

    return patterns ? { ...built, patterns, entities } : { ...built, entities };
  };

  const both = (pattern: Field, expected: RegExp) => {
    assert.throws(() => d.hatch(box, { pattern: wrong<HatchPatternOf>(pattern) }), expected);
    const found = lint(hatched(pattern)).map((x) => `${x.rule}: ${x.message}`);
    assert.equal(found.length, 1, found.join("\n"));
    assert.match(found[0]!, /^hatch-pattern: hatch #0: /);
    assert.match(found[0]!, expected);
  };

  both({ name: "BRICK" }, /"BRICK" is not defined\. tsdraft has no patterns of its own/);
  both({ spacing: 0 }, /spacing must be a finite number greater than 0/);
  both({ name: "STRIPES", scale: 1e-7 }, /scale: This value is written as 0/);
  both({ name: "STRIPES", spacing: 1 }, /a name or a spacing, not both/);
  both({ name: "STRIPES", crossed: true }, /crossed is for lines of the hatch's own/);
  both({ spacing: 1, origin: [0, NaN] }, /origin must be a point/);
  both({ spacing: 1, scale: 2 }, /scale is for a pattern by its name/);
  both({ spacing: 1, zz: 1 }, /attern must be \{ name, scale\?/);
  // The literal mistakes are compile errors too.
  // @ts-expect-error: a spacing is greater than 0.
  assert.throws(() => d.hatch(box, { pattern: { spacing: -1 } }), /greater than 0/);
  // @ts-expect-error: and is not written as 0.
  assert.throws(() => d.hatch(box, { pattern: { name: "STRIPES", scale: 1e-7 } }), /written as 0/);
  // @ts-expect-error: a pattern has a name or a spacing.
  assert.throws(() => d.hatch(box, { pattern: { name: "STRIPES", spacing: 1 } }), /not both/);
  // @ts-expect-error: crossed goes with a spacing, and a scale with a name.
  assert.throws(() => d.hatch(box, { pattern: { spacing: 1, scale: 2 } }), /scale is for/);
  both({ spacing: 1e-6 }, /draws 4,000,001 lines .*more than the 1,000,000 tsdraft draws/);

  // A line's base point at 10, scaled by 1e99, is placed at 1e100.
  const big = [
    {
      name: "BIG",
      lines: [{ angle: 0, base: [10, 0] satisfies Point, offset: [0, 1] satisfies Point }],
    },
  ];

  const placed = { name: "BIG", scale: 1e99 };
  assert.throws(
    () => createDrawing().patterns(big).hatch(box, { pattern: placed }),
    /1e100 or more/,
  );
  assert.match(lint(hatched(placed, big))[0]!.message, /1e100 or more/);
  assert.deepEqual(lint(hatched({ name: "BIG", scale: 9e98 }, big)), []);
  assert.match(lint(hatched({ name: "BRICK" }))[0]!.message, /through parsePatterns into/);
  assert.throws(() => d.hatch(box, { pattern: { name: "BRICK" } }), /with patterns\(\) first/);

  // A definition of the drawing's patterns, by the builder and by lint.
  const defined = (patterns: Field[]) =>
    lint(hatched({ name: "STRIPES" }, wrong(patterns))).map((x) => `${x.rule}: ${x.message}`);

  const line = { angle: 0, base: [0, 0], offset: [0, 1] };

  for (const [pattern, expected] of [
    [{ name: "", lines: [line] }, /Hatch pattern names cannot be empty/],
    [{ name: "A*", lines: [line] }, /Hatch pattern names cannot contain/],
    [{ name: "STRIPES", lines: [] }, /needs at least one line/],
    [{ name: "STRIPES", lines: [{ ...line, offset: [1, 1e-7] }] }, /line 0: its offset across/],
    [{ name: "STRIPES", lines: [{ ...line, dashes: [0, 0] }] }, /line 0: its dashes cannot all/],
    [{ name: "STRIPES", lines: [{ ...line, angle: Infinity }] }, /line 0: its angle must be/],
    [{ name: "STRIPES", lines: [{ ...line, base: [1e100, 0] }] }, /line 0: its base: .*1e100/],
  ] as const) {
    assert.throws(() => d.patterns([wrong<HatchPattern>(pattern)]), expected);
    const found = defined([pattern]);
    assert.ok(
      found.length >= 1 && found.every((x) => x.startsWith("hatch-pattern: ")),
      String(found),
    );
    assert.match(found[0]!, expected);
  }

  // Of two of a name, a hatch takes the first.
  assert.deepEqual(defined([built.patterns![0], { ...built.patterns![0], name: "stripes" }]), [
    'duplicate-hatch-pattern: Hatch pattern "stripes" is defined twice. A hatch finds its pattern by name whatever the case of its letters, as CAD programs do, and takes the first',
  ]);
  // A pattern file a line of which cannot be read, and R12, which has no hatches.
  assert.throws(() => d.patterns("45, 0,0, 0,1"), /line 1 of the pattern file: a line before/);
  assert.throws(
    () => createDrawing({ dxf: "R12" }).patterns(file),
    /no hatches or wipeouts to R12/,
  );
  assert.match(
    lint({ ...hatched(undefined), dxf: "R12", entities: [] })[0]!.message,
    /^patterns: /,
  );
});

test("a hatch's pattern named SOLID is refused: a solid hatch has none", () => {
  const d = createDrawing({ units: "in" });
  d.patterns("*SOLID, Solid fill\n45, 0,0, 0,.125\n");
  assert.throws(
    () =>
      d.hatch(
        [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
        { pattern: { name: "Solid" } },
      ),
    /SOLID is the name/,
  );
});

test("an attribute of paragraph text and each insert's value of it are checked as a paragraph", () => {
  const d = createDrawing();
  const at: Point = [0, 0];
  d.textStyle({ name: "HAND", font: "romans.shx" });
  d.block("NOTE", {}, () => {
    d.attribute("NOTE", at, { kind: "paragraph", value: "ONE\nTWO \LTHREE\l", width: 2 });
    d.attribute("HAND", at, { kind: "paragraph", style: "HAND", valign: "bottom" });
    // @ts-expect-error: a brace is never closed.
    assert.throws(() => d.attribute("A", at, { kind: "paragraph", value: "{\LA" }), /never closed/);
    // @ts-expect-error: a width must be greater than 0.
    assert.throws(() => d.attribute("B", at, { kind: "paragraph", width: 0 }), /greater than 0/);
    assert.throws(
      // @ts-expect-error: the leading CAD app takes a line spacing from 0.25 to 4.
      () => d.attribute("C", at, { kind: "paragraph", lineSpacing: 5 }),
      /from 0.25 to 4/,
    );
    // @ts-expect-error: a paragraph is not set on its baseline.
    assert.throws(() => d.attribute("D", at, { kind: "paragraph", valign: "baseline" }), /valign/);
    // @ts-expect-error: nor is a width one of a line of text's.
    assert.throws(() => d.attribute("E", at, { width: 2 }), Error);
    // Nor beside a field a line of text has, nor in options held apart from the call.
    // @ts-expect-error: a width beside a value.
    assert.throws(() => d.attribute("F", at, { value: "x", width: 2 }), /width belongs/);
    // @ts-expect-error: a line spacing beside a prompt.
    assert.throws(() => d.attribute("G", at, { prompt: "p", lineSpacing: 2 }), /lineSpacing/);
    const options = { kind: "text" as const, width: 12 };
    // @ts-expect-error: a width on options of one line.
    assert.throws(() => d.attribute("H", at, options), /width belongs/);
  });
  d.insert("NOTE", [0, 0], { attributes: { NOTE: "A\nB", HAND: "%%d" } });
  assert.deepEqual(d.build().entities[0], {
    kind: "insert",
    layer: "0",
    block: "NOTE",
    at: [0, 0],
    attributes: { NOTE: "A\\PB", HAND: "%%d" },
  });
  // An insert's value is read in the definition's font, which the type does not know.
  assert.throws(
    () => d.insert("NOTE", [0, 0], { attributes: { HAND: "%%c6" } }),
    /attribute "HAND": .*%%c in an SHX font/,
  );
  assert.throws(
    () => d.insert("NOTE", [0, 0], { attributes: { NOTE: "{x" } }),
    /attribute "NOTE": .*never closed/,
  );
  // lint holds a drawing written by hand to the same rules, and R12, which holds no block.
  const drawing = d.build();
  const block = drawing.blocks![0]!;
  const definition = block.attributes![0]!;

  const insert = dataOf(drawing.entities[0]!);

  const broken = (changed: Data, values?: Record<string, string>) =>
    lint({
      ...drawing,
      blocks: [
        {
          ...block,
          attributes: [wrong({ ...dataOf(definition), ...changed }), block.attributes![1]!],
        },
      ],
      entities: [wrong(values ? { ...insert, attributes: values } : insert)],
    }).map((diagnostic) => diagnostic.message);

  assert.deepEqual(broken({}), []);
  assert.match(broken({ value: "\\Zx" }).join(), /code \\Z is not one tsdraft knows/);
  assert.match(broken({ width: -1 }).join(), /width: .*greater than 0/);
  assert.match(broken({ align: "fit" }).join(), /align must be/);
  assert.match(broken({ kind: "lines" }).join(), /kind must be "text" or "paragraph"/);
  assert.match(
    broken({ kind: "text" }).join(),
    /width belongs to an attribute definition of paragraph text/,
  );
  assert.match(broken({}, { NOTE: "{x" }).join(), /attribute "NOTE": .*never closed/);
  assert.match(
    lint({ ...drawing, dxf: "R12" })
      .map((x) => x.message)
      .join(),
    /no blocks to R12/,
  );
  // An insert that scales its block so unevenly that its width factor leaves the range is refused.
  assert.throws(() => d.insert("NOTE", [0, 0], { scale: [1000, 0.001] }), /times as wide/);
});

test("a hatch's gradient is checked by the builder and by lint", () => {
  const box: Point[] = [
    [0, 0],
    [8, 0],
    [8, 4],
    [0, 4],
  ];

  const d = createDrawing({ units: "in" });
  d.hatch(box, {
    gradient: {
      name: "linear",
      angle: 30,
      colors: [
        [200, 40, 30],
        [20, 90, 180],
      ],
    },
  });
  d.hatch(box, {
    gradient: { name: "inverted-spherical", centered: false, color: [0, 0, 0], tint: 0.5 },
  });
  const built = d.build();
  assert.deepEqual(built.entities[1], {
    kind: "hatch",
    layer: "0",
    loops: [{ points: box }],
    gradient: { name: "inverted-spherical", centered: false, color: [0, 0, 0], tint: 0.5 },
  });
  assert.deepEqual(lint(built), []);
  assert.deepEqual(fromJSON(toJSON(built)), built);

  const shaded = (gradient: Field, pattern?: Field): Drawing => {
    const hatch: Data = { kind: "hatch", layer: "0", loops: [{ points: box }], gradient };

    if (pattern) hatch.pattern = pattern;

    return { ...built, entities: [wrong(hatch)] };
  };

  const both = (gradient: Field, expected: RegExp) => {
    assert.throws(() => d.hatch(box, { gradient: wrong<HatchGradient>(gradient) }), expected);
    const found = lint(shaded(gradient)).map((x) => `${x.rule}: ${x.message}`);
    assert.equal(found.length, 1, found.join("\n"));
    assert.match(found[0]!, /^hatch-gradient: hatch #0: /);
    assert.match(found[0]!, expected);
  };

  both(
    {
      name: "radial",
      colors: [
        [0, 0, 0],
        [1, 1, 1],
      ],
    },
    /name must be one of "linear"/,
  );
  both(
    {
      name: "linear",
      colors: [
        [0, 0, 256],
        [1, 1, 1],
      ],
    },
    /whole number from 0 to 255/,
  );
  both(
    {
      name: "linear",
      colors: [
        [0, 0.5, 0],
        [1, 1, 1],
      ],
    },
    /whole number from 0 to 255/,
  );
  both({ name: "linear", color: [0, 0, 0], tint: 1.5 }, /tint must be a number from 0/);
  both({ name: "linear", color: [0, 0, 0] }, /radient must be \{ name/);
  both(
    {
      name: "linear",
      colors: [
        [0, 0, 0],
        [1, 1, 1],
      ],
      tint: 0.5,
    },
    /radient must be \{ name/,
  );
  both({ name: "linear", angle: NaN, color: [0, 0, 0], tint: 0 }, /angle must be a finite number/);
  both(
    { name: "linear", centered: 1, color: [0, 0, 0], tint: 0 },
    /centered must be true or false/,
  );
  const found = lint(shaded({ name: "linear", color: [0, 0, 0], tint: 0 }, { spacing: 1 }));
  assert.deepEqual(
    found.map((x) => x.rule),
    ["hatch-gradient"],
  );
  // The literal mistakes are compile errors too.
  assert.throws(
    () =>
      d.hatch(box, {
        // @ts-expect-error: a channel is a whole number from 0 to 255.
        gradient: {
          name: "linear",
          colors: [
            [0, 0, 300],
            [0, 0, 0],
          ],
        },
      }),
    /0 to 255/,
  );
  assert.throws(
    () =>
      d.hatch(box, {
        // @ts-expect-error: and a tint from 0 to 1.
        gradient: { name: "linear", color: [0, 0, 0], tint: 2 },
      }),
    /tint/,
  );
  assert.throws(
    () =>
      d.hatch(box, {
        gradient: { name: "linear", color: [0, 0, 0], tint: 0 },
        // @ts-expect-error: a gradient never goes with a pattern.
        pattern: { spacing: 1 },
      }),
    /not both/,
  );
  assert.throws(
    () =>
      d.hatch(box, {
        // @ts-expect-error: and is one of nine.
        gradient: { name: "radial", color: [0, 0, 0], tint: 0 },
      }),
    /one of/,
  );
  assert.throws(
    () =>
      d.hatch(box, {
        // @ts-expect-error: a field it does not know.
        gradient: { name: "linear", color: [0, 0, 0], tint: 1, tnit: 0 },
      }),
    /radient must be \{ name/,
  );
  assert.throws(
    () =>
      d.hatch(box, {
        // @ts-expect-error: an angle of 1e100 or more.
        gradient: { name: "linear", angle: 1e100, color: [0, 0, 0], tint: 1 },
      }),
    /angle: .*1e100/,
  );
  // A member of a union is checked as a literal is.
  const large = (huge: boolean): 0 | 1e100 => (huge ? 1e100 : 0);
  assert.throws(
    () =>
      d.hatch(box, {
        // @ts-expect-error: one member's angle is 1e100.
        gradient: { name: "linear", angle: large(true), color: [0, 0, 0], tint: 1 },
      }),
    /angle: .*1e100/,
  );

  const either = (odd: boolean) =>
    odd
      ? ({ name: "linear", color: [0, 0, 0], tint: 1, tnit: 0 } as const)
      : ({ name: "linear", color: [0, 0, 0], tint: 1 } as const);

  assert.throws(
    () =>
      d.hatch(box, {
        // @ts-expect-error: one member has a field a gradient does not.
        gradient: either(true),
      }),
    /radient must be \{ name/,
  );
  assert.throws(
    () =>
      createDrawing({ dxf: "R12" }).hatch(
        box,
        wrong<HatchOptions<"R12">>({ gradient: { name: "linear", color: [0, 0, 0], tint: 0 } }),
      ),
    /R2018/,
  );
});

test("ellipses and splines are checked by the builder and by lint", () => {
  const d = createDrawing();

  const zigzag: Point[] = [
    [0, 0],
    [1, 2],
    [2, 0],
  ];

  // Literals the compiler reads.
  const three = [
    [0, 0],
    [1, 2],
    [2, 0],
  ] as const;

  const twice = [
    [0, 0],
    [1, 1],
    [1, 1],
  ] as const;

  // @ts-expect-error: a ratio is above 0.
  assert.throws(() => d.ellipse([0, 0], [2, 0], 0), /ratio/);
  // @ts-expect-error: a ratio is at most 1.
  assert.throws(() => d.ellipse([0, 0], [2, 0], 1.5), /ratio/);
  // @ts-expect-error: a ratio written as 0.
  assert.throws(() => d.ellipse([0, 0], [2, 0], 4e-7), /ratio/);
  d.ellipse([0, 0], [2, 0], 1.0000004);
  assert.throws(() => d.ellipse([0, 0], [4e-7, 0], 0.5), /major axis/);
  assert.throws(() => d.ellipse([0, 0], [2, 0], 0.5, { startParameter: 10 }), /together/);
  assert.throws(
    () => d.ellipse([0, 0], [2, 0], 0.5, { startParameter: 10, endParameter: 370.0000001 }),
    /must differ/,
  );

  // @ts-expect-error: a spline passes through 2 points or more.
  assert.throws(() => d.spline([[0, 0]]), /at least 2/);
  // @ts-expect-error: two points side by side are one.
  assert.throws(() => d.spline(twice), /side by side/);
  assert.throws(
    () =>
      d.spline([
        [0, 0],
        [1, 1],
        [1.0000001, 1],
      ]),
    /side by side/,
  );
  // @ts-expect-error: a tangent of no direction.
  assert.throws(() => d.spline(zigzag, { startTangent: [0, 0] }), /no direction/);
  // @ts-expect-error: a closed spline takes no tangent.
  assert.throws(() => d.spline(zigzag, { closed: true, endTangent: [1, 0] }), /closed spline/);
  assert.throws(() => d.spline(zigzag.slice(0, 2), { closed: true }), /3 when it is closed/);

  // @ts-expect-error: a degree from 1 to SPLINE_DEGREE_MOST.
  assert.throws(() => d.controlSpline(zigzag, { degree: 12 }), /degree/);
  // @ts-expect-error: a cubic needs 4 control points.
  assert.throws(() => d.controlSpline(three), /one more control point/);
  // @ts-expect-error: 3 control points of degree 2 take 6 knots.
  assert.throws(() => d.controlSpline(three, { degree: 2, knots: [0, 0, 0, 1, 1] }), /knots/);
  // @ts-expect-error: one weight for each control point.
  assert.throws(() => d.controlSpline(three, { degree: 2, weights: [1, 1] }), /weight/);
  // @ts-expect-error: a weight above 0.
  assert.throws(() => d.controlSpline(three, { degree: 2, weights: [1, -1, 1] }), /weight/);
  assert.throws(
    () => d.controlSpline(zigzag, { degree: 2, knots: [0, 0, 0, 2, 1, 1] }),
    /never decrease/,
  );
  assert.throws(
    () => d.controlSpline(zigzag, { degree: 2, knots: [0, 0, 0, 0, 0, 0] }),
    /never decrease/,
  );
  // Closed without knots, its first control points come again, with uniform knots.
  d.controlSpline(zigzag, { degree: 2, closed: true });
  const closed = d.build().entities.at(-1)!;
  assert.ok(closed.kind === "spline" && !("fitPoints" in closed));
  assert.deepEqual(closed.knots, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(closed.controlPoints.length, 5);

  // lint holds a drawing made another way to the same rules, and R12 to none of them.
  const one = (entity: Data, dxf: "R12" | "R2018" = "R2018") =>
    lint({ ...createDrawing().build(), dxf, entities: [wrong({ layer: "0", ...entity })] }).map(
      (x) => `${x.rule}: ${x.message}`,
    );

  assert.deepEqual(one({ kind: "ellipse", center: [0, 0], majorAxis: [1, 0], ratio: 2 }), [
    "geometry: ellipse #0: an ellipse's ratio, its minor radius over its major, must be above 0 and at most 1 once rounded to the 6 decimals tsdraft writes",
  ]);
  assert.match(
    one({
      kind: "ellipse",
      center: [0, 0],
      majorAxis: [1, 0],
      ratio: 1,
      startParameter: 400,
      endParameter: 3,
    })[0]!,
    /from 0 up to 360/,
  );
  assert.match(
    one({ kind: "spline", fitPoints: zigzag, startTangent: [0, 1], closed: true })[0]!,
    /closed spline takes no tangents/,
  );
  assert.match(
    one({
      kind: "spline",
      controlPoints: zigzag,
      degree: 2,
      knots: [0, 0, 0, 1, 1, 1],
      weights: [1, 0, 1],
    })[0]!,
    /weight/,
  );
  assert.match(
    one({ kind: "spline", controlPoints: zigzag, degree: 2.5, knots: [0, 0, 0, 1, 1, 1] })[0]!,
    /degree is a whole number/,
  );
  assert.match(
    one({
      kind: "spline",
      fitPoints: [
        [0, 0],
        [9e99, 0],
        [0, 1e-6],
        [-9e99, 0],
      ],
    })[0]!,
    /fitted through its points/,
  );
  assert.match(
    one({ kind: "ellipse", center: [0, 0], majorAxis: [1, 0], ratio: 0.5 }, "R12")[0]!,
    /no ellipses or splines to R12/,
  );
  assert.throws(() => createDrawing({ dxf: "R12" }).spline(zigzag), /no ellipses or splines/);
  // Clamped knots make an open curve, which a closed spline's flag would not close.
  assert.throws(
    () =>
      d.controlSpline(
        [
          [10, 0],
          [20, 15],
          [50, 15],
          [60, 0],
        ],
        { closed: true, knots: [0, 0, 0, 0, 1, 1, 1, 1] },
      ),
    /end where it starts/,
  );
  d.controlSpline(
    [
      [10, 0],
      [20, 15],
      [50, 15],
      [60, 0],
    ],
    { closed: true },
  );
  // Knots that differ by less than the 16 digits tsdraft writes would print as one.
  const b = 1 + Number.EPSILON;
  assert.throws(
    () =>
      d.controlSpline(
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        { knots: [1, 1, 1, 1, b, b, b, b] },
      ),
    /16 digits/,
  );
  assert.throws(
    () =>
      d.controlSpline(
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        { knots: [0, 0, 0, 0, 1e-21, 1e-21, 1e-21, 1e-21] },
      ),
    /16 digits/,
  );
  // A knot repeated inside, as the leading CAD app's own splines hold one, is kept.
  d.controlSpline(
    [
      [0, 0],
      [1, 2],
      [2, 0],
      [3, 2],
      [4, 0],
      [5, 2],
    ],
    { knots: [0, 0, 0, 0, 1, 1, 2, 2, 2, 2] },
  );
  // A polygon closes with a corner, and a small closed outline far from the origin closes too.
  d.controlSpline(
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    { closed: true, degree: 1 },
  );
  d.controlSpline(
    Array.from({ length: 7 }, (_, i): Point => [
      612345.25 + 0.5 * Math.cos(i * 0.9),
      1298765.5 + 0.35 * Math.sin(i * 0.9),
    ]),
    { closed: true },
  );
});
