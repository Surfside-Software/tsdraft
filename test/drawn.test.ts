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
  type Standard,
} from "../src/index.ts";

const standard = defineStandard({
  id: "acme",
  version: "2026.1",
  extends: BUILT_IN_STANDARD,
  layers: { "V-TREE": { color: 3, pen: "fine", discipline: "V" } },
  pens: { hair: { lineweight: 0 } },
});

/** The sizes of a dimension style, which a drawing drawn to a standard may not define. */
const DIMENSION_STYLE = {
  textHeight: 0.1,
  arrowSize: 0,
  extensionOffset: 0,
  extensionBeyond: 0,
  textGap: 0,
  precision: 0,
} as const;

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

test("under a standard the builder refuses a role, a view or a dimension style it does not give", () => {
  const d = createDrawing({ units: "ft", standard });
  const plan = d.view("plan", { scale: "1in-10ft" });
  refused(
    // @ts-expect-error: the standard has no role caption.
    () => d.text([0, 0], "A", { role: "caption", view: plan }),
    "role",
    /^Role "caption" is not a text role of the standard "acme" version 2026.1. Add it to the standard, as textRoles: \{ "caption": \{ font: "Arial", height: 0.125 \} \} in defineStandard, or use one of its roles$/,
  );
  // @ts-expect-error: a role gives the height.
  refused(() => d.text([0, 0], "A", { role: "note", view: plan, height: 1 }), "role", /height/);
  // @ts-expect-error: a role gives the text style.
  refused(() => d.text([0, 0], "A", { role: "note", view: plan, style: "X" }), "role", /style/);
  refused(
    // @ts-expect-error: the standard has no scale 1in-25ft.
    () => d.view("other", { scale: "1in-25ft" }),
    "scale-outside-standard",
    /^Scale "1in-25ft" is not a scale of the standard "acme" version 2026.1/,
  );
  refused(
    // @ts-expect-error: the dimension styles are the standard's.
    () => d.dimensionStyle({ name: "D", ...DIMENSION_STYLE }),
    "dimension-style-outside-standard",
    /defines none of its own/,
  );
  refused(
    // @ts-expect-error: the standard has no dimension style ticks.
    () => d.linearDimension([0, 0], [10, 0], [0, 5], { style: "ticks", view: plan }),
    "dimension-style-outside-standard",
    /^Dimension style "ticks" is not a dimension style of the standard "acme" version 2026.1/,
  );
  d.block("CORNER", {}, () => d.circle([0, 0], 1 / 16));
  refused(
    // @ts-expect-error: the view gives the insert's scale.
    () => d.insert("CORNER", [0, 0], { view: plan, scale: 2 }),
    "role",
    /^An insert with a view is scaled by the view/,
  );
  d.layout("C-1", { paper: "ARCH D" }, (sheet) => {
    refused(
      // @ts-expect-error: the view gives the viewport's ratio.
      () => sheet.viewport([1, 1], 10, 10, { view: plan, center: [0, 0], ratio: 120 }),
      "viewport",
      /^Under a standard a viewport shows a view/,
    );
    refused(
      // @ts-expect-error: the view gives the viewport's id.
      () => sheet.viewport([1, 1], 10, 10, { view: plan, center: [0, 0], id: "other" }),
      "viewport",
      /has the view's id/,
    );
  });
  // Each member of a union of styles is checked, also where the standard may be any.
  const anyStandard: DrawingBuilder<"R2018", number, Standard> = d;
  const reserved = Number("1") === 1;
  refused(
    () =>
      anyStandard.linearDimension([0, 0], [10, 0], [0, 5], {
        // @ts-expect-error: no standard holds a dimension style named standard.
        style: reserved ? "Standard" : "dims",
        view: plan,
      }),
    "dimension-style-outside-standard",
    /^Dimension style "Standard" is in no standard: its name in AutoCAD would be STANDARD, which AutoCAD takes for the dimension style Standard that every drawing has. Use one of the standard's dimension styles$/,
  );
  assert.throws(
    // @ts-expect-error: a length on paper is greater than 0.
    () => plan.paper(0),
    (thrown) => {
      assert.ok(thrown instanceof DrawingError);
      assert.equal(thrown.diagnostics[0]?.rule, "geometry");
      assert.equal(thrown.message, "The paper length must be greater than 0");
      assert.match(thrown.diagnostics[0]?.call?.file ?? "", /test\/drawn\.test\.ts$/);
      return true;
    },
  );
  const plain = createDrawing();
  // @ts-expect-error: a role is the standard's.
  refused(() => plain.text([0, 0], "A", { role: "note" }), "role", /this drawing has none/);
  // @ts-expect-error: a view is at a scale of the standard.
  refused(() => plain.view("plan", { scale: "1in-10ft" }), "scale-outside-standard", /has none/);

  // What only the code that runs can see.
  refused(() => d.text([0, 0], "A", { role: "note" }), "role", /names the view it is read in/);
  refused(() => d.text([0, 0], "A", { view: plan }), "role", /Give it a role too/);
  refused(
    () => d.block("B", {}, () => d.text([0, 0], "A", { role: "note", view: plan })),
    "role",
    /^A text in a block or on a layout is drawn in paper units/,
  );
  const elsewhere = createDrawing({ units: "ft", standard }).view("plan", { scale: "1in-10ft" });
  refused(
    () => d.text([0, 0], "A", { role: "note", view: elsewhere }),
    "role",
    /^The view "plan" is not a view of this drawing/,
  );
  refused(() => d.view("PLAN", { scale: "1in-20ft" }), "duplicate-id", /already used/);
  // A role's text style is the standard's, before the role is used and after.
  refused(
    () => d.textStyle({ name: "Dimension", font: "romans.shx" }),
    "text-style",
    /^Text style "Dimension" is the text style of the role "dimension" of the standard "acme" version 2026.1, which gives its font, width factor and oblique angle. Give the style another name, or change the role in the standard$/,
  );
  d.text([0, 0], "A", { role: "note", view: plan });
  refused(
    () => d.textStyle({ name: "NOTE", font: "romans.shx" }),
    "text-style",
    /^Text style "NOTE" is the text style of the role "note"/,
  );
  refused(
    () => d.linearDimension([0, 0], [10, 0], [0, 5], { style: null as never, view: plan }),
    "dimension-style-outside-standard",
    /named by a string/,
  );
  refused(
    () => d.linearDimension([0, 0], [10, 0], [0, 5], {}),
    "dimension-style",
    /^A dimension of model space under a standard names the view/,
  );
  d.layout("C-2", { paper: "ARCH D" }, (sheet) => {
    sheet.viewport([1, 1], 10, 10, { view: plan, center: [0, 0] });
    refused(
      () => sheet.viewport([12, 1], 10, 10, { view: plan, center: [0, 0] }),
      "duplicate-id",
      /^The id "plan" is already used/,
    );
    refused(
      () => d.linearDimension([0, 0], [1, 0], [0, 1], { view: plan }),
      "dimension-style",
      /^A dimension on a layout is drawn in paper units/,
    );
    refused(() => d.insert("CORNER", [0, 0], { view: plan }), "role", /names no view/);
  });
  const metres = createDrawing({ units: "m", standard });
  refused(
    () =>
      metres.linearDimension([0, 0], [1, 0], [0, 1], {
        view: metres.view("v", { scale: "1in-10ft" }),
      }),
    "dimension-style",
    /^The dimension style "dims" of the standard "acme" version 2026.1 has no writing for "m"/,
  );
  const tiny = defineStandard({
    id: "tiny",
    version: "1",
    extends: BUILT_IN_STANDARD,
    scales: { tiny: { label: "tiny", ratio: 1e-9 } },
  });
  const small = createDrawing({ units: "ft", standard: tiny });
  refused(
    () => small.text([0, 0], "A", { role: "note", view: small.view("v", { scale: "tiny" }) }),
    "geometry",
    /^height: .*written as 0/,
  );
  const millimetres = defineStandard({
    id: "mm",
    version: "1",
    paperUnits: "mm",
    minTextHeight: 2,
  });
  refused(
    () => createDrawing({ standard: millimetres }).layout("A", { paper: "ARCH D" }, () => {}),
    "layout",
    /is in in, and the standard "mm" version 1 has its paper units in mm/,
  );
  refused(
    () => createDrawing({ standard: millimetres }).linearDimension([0, 0], [1, 0], [0, 1], {}),
    "dimension-style-outside-standard",
    /^The standard "mm" version 1 has no defaultDimensionStyle/,
  );
});

test("a role and a view size a text, a symbol and a dimension where each is drawn", () => {
  const d = createDrawing({ units: "ft", standard });
  const plan = d.view("plan", { scale: "1in-10ft" });
  const detail = d.view("detail", { scale: "1in-10ft" });
  assert.deepEqual(
    { ...plan, paper: plan.paper(1) },
    { id: "plan", scale: "1in-10ft", label: "1\" = 10'", ratio: 120, paper: 10 },
  );
  d.block("CORNER", {}, () => d.circle([0, 0], 1 / 16));
  d.block("TAG", {}, () => d.attribute("NO", [0, 0], { role: "label", value: "1" }));
  // A block that inserts a block with role texts holds them too.
  d.block("TAGGED", {}, () => d.insert("TAG", [0, 0]));
  d.text([0, 0], "LOT", { role: "label", view: plan, id: "lot" });
  d.insert("CORNER", [0, 0], { view: plan });
  d.insert("TAGGED", [0, 0], { view: detail });
  refused(() => d.insert("TAGGED", [0, 0]), "role", /^Block "TAGGED" holds texts with roles/);
  d.linearDimension([0, 0], [10, 0], [0, 5], { view: plan });
  // The compiler compares the id exactly, and the builder finds it in any case.
  const [upper]: string[] = ["DIMS"];
  d.linearDimension([0, 0], [10, 0], [0, 5], { view: detail, style: upper! });
  d.layout("C-1", { paper: "ARCH D" }, (sheet) => {
    sheet.viewport([1, 1], 10, 10, { view: plan, center: [0, 0] });
    d.text([1, 12], "PLAN", { role: "title" });
    d.linearDimension([1, 13], [3, 13], [1, 14], {});
  });
  const drawing = d.build();
  assert.deepEqual(drawing.entities.slice(0, 3), [
    {
      kind: "text",
      layer: "0",
      at: [0, 0],
      value: "LOT",
      height: 1.25,
      rotation: 0,
      style: "LABEL",
      id: "lot",
    },
    { kind: "insert", layer: "0", block: "CORNER", at: [0, 0], scale: [10, 10] },
    { kind: "insert", layer: "0", block: "TAGGED", at: [0, 0], scale: [10, 10] },
  ]);
  assert.deepEqual(drawing.blocks?.[1]?.attributes?.[0]?.height, 0.125);
  const [page] = drawing.layouts!;
  assert.deepEqual(page!.viewports[0], {
    id: "plan",
    layer: "0",
    corner: [1, 1],
    width: 10,
    height: 10,
    center: [0, 0],
    ratio: 120,
  });
  assert.deepEqual(page!.entities[0], {
    kind: "text",
    layer: "0",
    at: [1, 12],
    value: "PLAN",
    height: 0.25,
    rotation: 0,
    style: "TITLE",
  });
  // Each role's text style enters the drawing when the role is first used, with its font.
  assert.deepEqual(drawing.textStyles, [
    { name: "LABEL", font: "Arial" },
    { name: "DIMENSION", font: "Arial" },
    { name: "TITLE", font: "Arial" },
  ]);
  // Two views at one scale share a style. On a layout the style has no scale, and writes inches.
  const style = {
    textStyle: "DIMENSION",
    textHeight: 0.09375,
    arrowhead: "architectural-tick",
    arrowSize: 0.125,
    extensionOffset: 0.0625,
    extensionBeyond: 0.125,
    textGap: 0.0625,
  };
  assert.deepEqual(drawing.dimensionStyles, [
    { name: "DIMS-1in-10ft", ...style, scale: 10, precision: 1, suffix: "'" },
    { name: "DIMS", ...style, precision: 0, suffix: '"' },
  ]);
  assert.deepEqual(
    [...drawing.entities, ...page!.entities].flatMap((e) =>
      e.kind === "linear-dimension" ? [e.style] : [],
    ),
    ["DIMS-1in-10ft", "DIMS-1in-10ft", "DIMS"],
  );
});

test("each branch of a conditional is checked as written", () => {
  const d = createDrawing({ units: "ft", standard });
  const plan = d.view("plan", { scale: "1in-10ft" });
  d.block("CORNER", {}, () => d.circle([0, 0], 1 / 16));
  for (const viewed of [true, false]) {
    d.block(viewed ? "A" : "B", {}, () =>
      d.attribute("T", [0, 0], viewed ? { role: "label" } : { height: 0.1 }),
    );
    d.insert("CORNER", [0, 0], viewed ? { view: plan } : { scale: 2 });
    d.text([0, 0], "A", viewed ? { role: "label", view: plan } : { height: 1 });
  }
  const drawing = d.build();
  assert.deepEqual(
    drawing.entities.map((e) => (e.kind === "insert" ? e.scale : e.kind === "text" && e.height)),
    [[10, 10], 1.25, [2, 2], 1],
  );
  assert.deepEqual(
    drawing.blocks?.map((b) => b.attributes?.[0]?.height),
    [undefined, 0.125, 0.1],
  );
});

test("a role and a dimension style with fields by discipline take the drawing's discipline", () => {
  const shared = defineStandard({
    id: "acme",
    version: "1",
    extends: BUILT_IN_STANDARD,
    sheetFiles: "sheet-per-file",
    textRoles: {
      note: { font: "Arial", height: 0.1, byDiscipline: { C: { font: "romans.shx" } } },
    },
    dimensionStyles: {
      dims: {
        role: "dimension",
        arrowhead: "architectural-tick",
        arrowSize: 0.125,
        extensionOffset: 0.0625,
        extensionBeyond: 0.125,
        textGap: 0.0625,
        writing: { ft: { precision: 1 } },
        byDiscipline: { C: { arrowSize: 0.25 } },
      },
    },
  });
  const drawn = (discipline?: "C" | "V") => {
    const d = createDrawing({
      units: "ft",
      standard: shared,
      ...(discipline ? { discipline } : {}),
    });
    d.block("B", {}, () => d.text([0, 0], "A", { role: "note" }));
    const plan = d.view("plan", { scale: "1in-10ft" });
    d.alignedDimension([0, 0], [10, 0], 5, { view: plan });
    return d.build();
  };
  const civil = drawn("C");
  assert.deepEqual(civil.textStyles?.[0], { name: "NOTE", font: "romans.shx" });
  assert.equal(civil.dimensionStyles?.[0]?.arrowSize, 0.25);
  const survey = drawn("V");
  assert.deepEqual(survey.textStyles?.[0], { name: "NOTE", font: "Arial" });
  assert.equal(survey.dimensionStyles?.[0]?.arrowSize, 0.125);
  refused(
    () => drawn(),
    "standard",
    /^Text role "note" has fields of its own in the discipline C of the standard/,
  );
});
