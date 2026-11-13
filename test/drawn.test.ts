import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILT_IN_STANDARD,
  createDrawing,
  DASHED,
  defineStandard,
  DrawingBuilder,
  DrawingError,
  toJSON,
  type LintRule,
} from "../src/index.ts";

const standard = defineStandard({
  id: "acme",
  version: "2026.1",
  extends: BUILT_IN_STANDARD,
  layers: { "V-TREE": { color: 3, pen: "fine", discipline: "V" } },
  pens: { hair: { lineweight: 0 } },
});

/** Asserts that `draw` throws a `DrawingError` of `rule` whose message matches `message`. */
function refused(draw: () => unknown, rule: LintRule, message: RegExp): void {
  assert.throws(draw, (thrown) => {
    assert.ok(thrown instanceof DrawingError);
    assert.equal(thrown.diagnostics[0]?.rule, rule);
    assert.match(thrown.message, message);
    return true;
  });
}

// Each `@ts-expect-error` proves the compiler refuses the literal, and the `refused` around it
// that the builder refuses the same mistake when the code runs.
test("under a standard the builder refuses what the standard does not give", () => {
  const d = createDrawing({ units: "ft", standard });
  refused(
    // @ts-expect-error: the standard has no layer A-WALL.
    () => d.layer("A-WALL", () => {}),
    "layer-outside-standard",
    /^Layer "A-WALL" is not a layer of the standard "acme" version 2026.1. Add it to the standard, as layers: \{ "A-WALL": \{ color: 7 \} \} in defineStandard, or use one of its layers$/,
  );
  // @ts-expect-error: layer 0 is in no standard.
  refused(() => d.layer("0"), "layer-outside-standard", /^Layer "0" is in every drawing/);
  // @ts-expect-error: AutoCAD refuses the name, which no standard can hold either.
  refused(() => d.layer("A,B"), "layer-name", /cannot contain/);
  refused(
    // @ts-expect-error: the standard gives the layer's color.
    () => d.layer("C-PROP", { color: 3 }),
    "layer-differs-from-standard",
    /^Layer "C-PROP": Under a standard a layer's color, linetype, lineweight and plot flag are the standard's/,
  );
  // @ts-expect-error: the standard gives the layer's plot flag.
  refused(() => d.layer("C-PROP", { plot: false }), "layer-differs-from-standard", /plot flag/);
  refused(
    // @ts-expect-error: the standard has no pen "hairline".
    () => d.line([0, 0], [1, 0], { pen: "hairline" }),
    "pen-outside-standard",
    /^Pen "hairline" is not a pen of the standard "acme" version 2026.1/,
  );
  refused(
    // @ts-expect-error: a lineweight comes from a pen.
    () => d.line([0, 0], [1, 0], { lineweight: 0.5 }),
    "pen-outside-standard",
    /comes from a pen of the standard.*The standard's pens are bold 0.5, fine 0.18, hair 0, heavy 0.7, light 0.25 and medium 0.35 mm$/,
  );
  refused(
    // @ts-expect-error: the standard has no linetype ZIGZAG.
    () => d.line([0, 0], [1, 0], { linetype: "ZIGZAG" }),
    "linetype-outside-standard",
    /^Linetype "ZIGZAG" is not a linetype of the standard "acme" version 2026.1/,
  );
  refused(
    // @ts-expect-error: a drawing drawn to a standard defines no linetype.
    () => d.line([0, 0], [1, 0], { linetype: DASHED }),
    "linetype-outside-standard",
    /defines none of its own/,
  );
  // @ts-expect-error: a drawing drawn to a standard defines no linetype.
  refused(() => d.linetype(DASHED), "linetype-outside-standard", /defines none of its own/);
  refused(
    // @ts-expect-error: the linetype scale is the standard's.
    () => createDrawing({ standard, linetypeScale: 2 }),
    "standard",
    /^Under a standard the linetype scale is the standard's/,
  );
  // @ts-expect-error: a drawing drawn to a standard is R2018.
  refused(() => createDrawing({ standard, dxf: "R12" }), "standard", /is R2018/);
  refused(
    // @ts-expect-error: the standard has no discipline Q.
    () => createDrawing({ standard, discipline: "Q" }),
    "standard",
    /^Discipline "Q" is not a discipline of the standard "acme" version 2026.1/,
  );
  refused(
    // @ts-expect-error: the constructor checks the discipline as createDrawing does.
    () => new DrawingBuilder({ standard, discipline: "Q" }),
    "standard",
    /^Discipline "Q" is not a discipline/,
  );
  // @ts-expect-error: a discipline is the standard's.
  refused(() => createDrawing({ discipline: "C" }), "standard", /this drawing has none/);
  refused(
    // @ts-expect-error: a pen is the standard's.
    () => createDrawing().line([0, 0], [1, 0], { pen: "heavy" }),
    "pen-outside-standard",
    /this drawing has none/,
  );

  // What only the code that runs can see.
  refused(
    () => d.line([0, 0], [1, 0], { pen: "heavy", lineweight: "ByLayer" }),
    "pen-outside-standard",
    /a pen or a lineweight, not both/,
  );
  refused(
    () => createDrawing({ standard, discipline: "C" }),
    "standard",
    /^Under sheetFiles "one-drawing" a drawing names no discipline/,
  );
  refused(
    () => createDrawing({ standard: { ...standard, linetypeScale: 2 } }),
    "standard",
    /must be a Standard that defineStandard made/,
  );
});

test("a layer of a standard has the standard's properties and the drawing's states", () => {
  const d = createDrawing({ units: "ft", standard });
  // The compiler compares names exactly, and the builder finds one in any case, as AutoCAD does.
  const [prop, dashed]: string[] = ["c-prop", "dashed"];
  d.layer(prop!, { locked: true }, () => d.line([0, 0], [10, 0]));
  d.layer("V-TREE", () => {
    d.circle([0, 0], 1, { pen: "heavy", linetype: dashed! });
    d.line([0, 0], [1, 0], { pen: "hair" });
  });
  d.layer("G-ANNO-NPLT", () => d.line([0, 0], [1, 0], { lineweight: "ByBlock" }));
  const drawing = d.build();
  assert.equal(drawing.linetypeScale, 0.5);
  assert.deepEqual(drawing.layers.slice(1), [
    { name: "C-PROP", color: 7, linetype: "PHANTOM", lineweight: 0.7, locked: true },
    { name: "V-TREE", color: 3, lineweight: 0.18 },
    { name: "G-ANNO-NPLT", color: 8, plot: false },
  ]);
  // A linetype enters the drawing when a layer or an entity first names it.
  assert.deepEqual(
    drawing.linetypes?.map((l) => l.name),
    ["PHANTOM", "DASHED"],
  );
  assert.deepEqual(drawing.linetypes?.[1], {
    name: "DASHED",
    description: DASHED.description,
    pattern: DASHED.pattern,
  });
  assert.deepEqual(drawing.entities, [
    { kind: "line", layer: "C-PROP", from: [0, 0], to: [10, 0] },
    {
      kind: "circle",
      layer: "V-TREE",
      center: [0, 0],
      radius: 1,
      linetype: "DASHED",
      lineweight: 0.7,
    },
    { kind: "line", layer: "V-TREE", from: [0, 0], to: [1, 0], lineweight: 0 },
    { kind: "line", layer: "G-ANNO-NPLT", from: [0, 0], to: [1, 0], lineweight: "ByBlock" },
  ]);
  // A standard as data, from another copy of tsdraft, is taken when it checks.
  const copy = createDrawing({ units: "ft", standard: JSON.parse(JSON.stringify(standard)) });
  copy.layer("C-PROP", { locked: true }, () => copy.line([0, 0], [10, 0]));
  assert.deepEqual(copy.build().layers[1], drawing.layers[1]);
});

test("a layer with fields by discipline takes the drawing's discipline", () => {
  const shared = defineStandard({
    id: "acme",
    version: "1",
    extends: BUILT_IN_STANDARD,
    sheetFiles: "sheet-per-file",
    layers: { TEXT: { color: 7, pen: "light", byDiscipline: { C: { color: 3, pen: "fine" } } } },
  });
  const layer = (discipline?: "C" | "V") =>
    createDrawing({ standard: shared, ...(discipline ? { discipline } : {}) })
      .layer("TEXT")
      .build().layers[1];
  assert.deepEqual(layer("C"), { name: "TEXT", color: 3, lineweight: 0.18 });
  assert.deepEqual(layer("V"), { name: "TEXT", color: 7, lineweight: 0.25 });
  refused(
    () => layer(),
    "standard",
    /^Layer "TEXT" has fields of its own in the discipline C of the standard, so a drawing that uses it names its discipline/,
  );
});

test("layer(name, draw) draws on the layer, with or without a standard", () => {
  const plain = createDrawing();
  plain.layer("A", { color: 2 });
  plain.layer("A", () => plain.line([0, 0], [1, 0]));
  const options = createDrawing();
  options.layer("A", { color: 2 });
  options.layer("A", {}, () => options.line([0, 0], [1, 0]));
  assert.equal(toJSON(plain.build()), toJSON(options.build()));
});
