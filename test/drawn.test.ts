import assert from "node:assert/strict";
import { test } from "node:test";
import { insertAttributeHandle } from "../src/blocks.ts";
import {
  BUILT_IN_STANDARD,
  createDrawing,
  DASHED,
  defineStandard,
  DrawingBuilder,
  DrawingError,
  idHandle,
  toDXF,
  toJSON,
  type Drawing,
  type Insert,
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
  d.layout("C-1", (sheet) => {
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
  // A text's style is its role's, and the drawing defines none of its own.
  refused(
    // @ts-expect-error: under a standard a drawing defines no text style.
    () => d.textStyle({ name: "NOTES", font: "romans.shx" }),
    "text-style-outside-standard",
    /^Under a standard a text's style comes from its role, and a drawing defines no text style of its own/,
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
  d.layout("C-2", (sheet) => {
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
  // Every paper is in inches, so a standard in millimetres has no sheet format yet.
  refused(
    () => createDrawing({ standard: millimetres }).layout("A", () => {}),
    "sheet-format-outside-standard",
    /^Layout "A": The standard "mm" version 1 has no defaultSheetFormat/,
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
  d.layout("C-1", (sheet) => {
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
      d.attribute("T", [0, 0], viewed ? { role: "label" } : { role: "note" }),
    );
    d.insert("CORNER", [0, 0], viewed ? { view: plan } : { scale: 2 });
    d.text([0, 0], "A", viewed ? { role: "label", view: plan } : { role: "note", view: plan });
  }
  const drawing = d.build();
  assert.deepEqual(
    drawing.entities.map((e) => (e.kind === "insert" ? e.scale : e.kind === "text" && e.height)),
    [[10, 10], 1.25, [2, 2], 0.9375],
  );
  assert.deepEqual(
    drawing.blocks?.map((b) => b.attributes?.[0]?.height),
    [undefined, 0.125, 0.09375],
  );
  // A branch without a role is a compile error with the builder's message.
  const flag = d.build().layers.length > 0;
  refused(
    // @ts-expect-error: under a standard a text names a role.
    () => d.text([0, 0], "A", flag ? { height: 1 } : { role: "label", view: plan }),
    "text-style-outside-standard",
    /^Under a standard a text names a role of the standard/,
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

/** A title block's block of two fields over an xref, drawn in inches without a standard. */
function fieldsOverBorder(): Drawing {
  const d = createDrawing({ units: "in" });
  d.textStyle({ name: "FIELDS", font: "Arial" });
  d.block("FIELDS", {}, () => {
    d.attribute("NUMBER", [33, 1], { value: "-", height: 0.25, style: "FIELDS" });
    d.attribute("TITLE", [29.5, 2], { value: "-", height: 0.1875, style: "FIELDS" });
  });
  return d.build();
}

/** A standard whose title block is a firm's border as an xref, with its fields over it. */
const firm = defineStandard({
  id: "firm",
  version: "1",
  extends: BUILT_IN_STANDARD,
  defaultSheetFormat: "firm",
  titleBlocks: {
    firm: {
      paper: "ARCH D",
      xref: { name: "BORDER", path: "border.dwg" },
      block: fieldsOverBorder(),
      blockName: "FIELDS",
      layer: "G-ANNO-TTLB",
      drawingArea: [0.5, 0.5, 35.5, 23.5],
      fields: { NUMBER: { fills: "number" }, TITLE: { fills: "title" } },
    },
  },
  sheetFormats: { firm: { paper: "ARCH D", titleBlock: "firm", zones: { views: [1, 3, 35, 23] } } },
});

/** A standard of a file per sheet, whose xref title block AutoCAD fills from the names. */
const perFile = defineStandard({
  id: "per-file",
  version: "1",
  extends: BUILT_IN_STANDARD,
  sheetFiles: "sheet-per-file",
  titleBlocks: {
    named: {
      paper: "ARCH D",
      xref: { name: "TITLE", path: "../setup/title.dwg" },
      layer: "G-ANNO-TTLB",
      drawingArea: [0.5, 0.5, 35.5, 23.5],
      fields: {
        NUMBER: { fills: "number", source: "fileName" },
        TITLE: { fills: "title", source: "layoutName" },
        DATE: { fills: "date", source: "currentDate" },
      },
    },
  },
  sheetFormats: { named: { paper: "ARCH D", titleBlock: "named" } },
});

test("a layout is on a sheet format of the standard, laid out by its zones", () => {
  const d = createDrawing({ units: "ft", standard });
  d.layout("C-101", (sheet) => {
    assert.equal(sheet.paper, "ARCH D");
    assert.deepEqual(sheet.drawingArea, {
      left: 0.5,
      bottom: 0.5,
      right: 35.5,
      top: 23.5,
      width: 35,
      height: 23,
    });
    // A zone is found in any case.
    assert.deepEqual(sheet.zone("VIEWS"), sheet.zone("views"));
    assert.deepEqual(sheet.zone("notes"), {
      left: 28.5,
      bottom: 3.5,
      right: 35.5,
      top: 23.5,
      width: 7,
      height: 20,
    });
    refused(
      () => sheet.zone("legend"),
      "layout",
      /^The sheet format "arch-d" has no zone "legend". Its zones are views, viewTitles and notes$/,
    );
  });
  d.layout("C-102", { sheetFormat: "arch-d" }, () => {});
  refused(
    // @ts-expect-error: a sheet format gives the paper.
    () => d.layout("C-103", { paper: "ARCH D" }, () => {}),
    "sheet-format-outside-standard",
    /^Layout "C-103": Under a standard a layout's paper and plot style table come from its sheet format/,
  );
  refused(
    // @ts-expect-error: the standard has no sheet format arch-e.
    () => d.layout("C-103", { sheetFormat: "arch-e" }, () => {}),
    "sheet-format-outside-standard",
    /^Layout "C-103": Sheet format "arch-e" is not a sheet format of the standard "acme" version 2026.1. Add it/,
  );
  // Without a standard a layout names its paper, and no sheet format.
  const plain = createDrawing({ units: "ft" });
  refused(
    () => plain.layout("A", (() => {}) as never),
    "layout",
    /^Layout "A": A layout of a drawing without a standard names its paper/,
  );
  refused(
    // @ts-expect-error: a sheet format is a standard's.
    () => plain.layout("A", { paper: "ARCH D", sheetFormat: "arch-d" }, () => {}),
    "sheet-format-outside-standard",
    /^Layout "A": sheetFormat names a sheet format of the drawing's standard/,
  );
  plain.layout("A", { paper: "ARCH D" }, (sheet) => {
    assert.equal(sheet.drawingArea, undefined);
    refused(
      // @ts-expect-error: a zone is a standard's.
      () => sheet.zone("views"),
      "layout",
      /^A zone is a part of the layout's sheet format/,
    );
    for (const place of [
      // @ts-expect-error: a title block is a standard's.
      () => sheet.titleBlock({ title: "A" }),
      // @ts-expect-error: a title block is a standard's.
      () => sheet.titleBlock(),
    ]) {
      refused(
        place,
        "layout",
        /^titleBlock\(\) places the title block of the layout's sheet format/,
      );
    }
  });
  // draw is the last argument, and a function.
  const draw = (): void => {};
  for (const call of [
    // @ts-expect-error: a layout has its draw.
    () => plain.layout("B", { paper: "ARCH D" }),
    // @ts-expect-error: a layout has its draw.
    () => d.layout("C-104", { sheetFormat: "arch-d" }),
    // @ts-expect-error: nothing follows draw.
    () => d.layout("C-104", draw, draw),
    // @ts-expect-error: draw is a function.
    () => d.layout("C-104", {}, "draw"),
  ]) {
    refused(
      call,
      "layout",
      /^Layout "(B|C-104)": layout\(\) takes the function that draws the sheet last, and nothing after it/,
    );
  }
  // Options of undefined are none.
  d.layout("C-104", undefined, (sheet) => assert.equal(sheet.paper, "ARCH D"));
  // A layout whose name only AUDIT takes for another's is refused under a standard.
  d.layout("STRAßE", () => {});
  refused(
    () => d.layout("STRASSE", () => {}),
    "duplicate-layout",
    /^Layout "STRASSE": AutoCAD's AUDIT takes this name and that of the layout "STRAßE" for one/,
  );
  plain.layout("STRAßE", { paper: "ARCH D" }, () => {});
  plain.layout("STRASSE", { paper: "ARCH D" }, () => {});
});

test("the title block is the standard's, filled from the sheet, the drawing and the builder", () => {
  const d = createDrawing({
    units: "ft",
    standard,
    fields: { project: "LOT 12", date: "2026-11-13", drawnBy: "AB", checkedBy: "CD" },
  });
  const plan = d.view("plan", { scale: "1in-10ft" });
  const detail = d.view("detail", { scale: "1in-20ft" });
  const lot = d.view("lot", { scale: "1in-10ft" });
  d.layout("C-101", (sheet) => {
    // Placed before the viewports, it gets their scale when draw returns.
    sheet.titleBlock({ title: "SITE PLAN" });
    refused(() => sheet.titleBlock(), "layout", /^A layout has one title block/);
    d.layer("G-ANNO-NPLT", () => {
      sheet.viewport([1, 3], 10, 10, { view: plan, center: [0, 0] });
      sheet.viewport([12, 3], 10, 10, { view: lot, center: [0, 0] });
    });
  });
  d.layout("C-102", (sheet) => {
    sheet.titleBlock({ title: "DETAILS", scale: "AS SHOWN" });
    d.layer("G-ANNO-NPLT", () => sheet.viewport([1, 3], 10, 10, { view: detail, center: [0, 0] }));
  });
  d.layout("C-103", (sheet) => {
    sheet.titleBlock({ number: "C-103", title: "PLANS" });
    d.layer("G-ANNO-NPLT", () => {
      sheet.viewport([1, 3], 10, 10, { view: d.view("a", { scale: "1in-10ft" }), center: [0, 0] });
      sheet.viewport([12, 3], 10, 10, { view: d.view("b", { scale: "1in-20ft" }), center: [0, 0] });
    });
  });
  const drawing = d.build();
  const inserts = drawing.layouts!.map((layout) => layout.entities[0]);
  assert.deepEqual(inserts[0], {
    kind: "insert",
    layer: "G-ANNO-TTLB",
    block: "TITLE BLOCK",
    at: [0, 0],
    id: "C-101.title-block",
    attributes: {
      PROJECT: "LOT 12",
      TITLE: "SITE PLAN",
      DATE: "2026-11-13",
      SCALE: `1" = 10'`,
      DRAWN: "AB",
      CHECKED: "CD",
      SHEET: "C-101",
    },
  });
  assert.equal((inserts[1] as Insert).attributes?.SCALE, "AS SHOWN");
  assert.equal((inserts[2] as Insert).attributes?.SCALE, "AS NOTED");
  // The title block's definitions enter the drawing once, under their own names.
  assert.deepEqual(
    drawing.blocks?.map((b) => b.name),
    ["TITLE BLOCK"],
  );
  assert.deepEqual(drawing.blocks?.[0], BUILT_IN_STANDARD.titleBlocks.plain.block!.blocks![0]);
  assert.deepEqual(drawing.textStyles, [{ name: "TITLE BLOCK", font: "Arial" }]);
  refused(() => d.block("Title Block", {}, () => {}), "duplicate-block", /already has a block/);
  // One drawing: the number is the layout's name, and the drawing's fields give none.
  d.layout("C-104", (sheet) =>
    refused(
      () => sheet.titleBlock({ number: "C-105" }),
      "layout",
      /^Under sheetFiles "one-drawing" a sheet's number is its layout's name, "C-104", and this one is "C-105"/,
    ),
  );
  refused(
    () => createDrawing({ standard, fields: { number: "C-1" } }),
    "layout",
    /^Under sheetFiles "one-drawing" a sheet's number is its layout's name/,
  );
  refused(
    () => createDrawing({ standard, fields: { projet: "X" } }),
    "standard",
    /^fields has no field "projet"/,
  );
  d.layout("C-105", (sheet) =>
    refused(
      () => sheet.titleBlock({ REVISION: "A" }),
      "layout",
      /^The title block "plain" has no field "REVISION"/,
    ),
  );
  refused(
    // @ts-expect-error: fields fill a standard's title blocks.
    () => createDrawing({ fields: { title: "A" } }),
    "standard",
    /^fields fills the title blocks of the drawing's standard, and this drawing has none/,
  );
  // A block of the title block's name is refused before it is placed too.
  const before = createDrawing({ units: "ft", standard });
  before.block("TITLE BLOCK", {}, () => {});
  before.layout("C-1", (sheet) =>
    refused(
      () => sheet.titleBlock(),
      "duplicate-block",
      /^The title block "plain" holds the block "TITLE BLOCK", and the drawing has a block "TITLE BLOCK" that AutoCAD takes for it, with another definition/,
    ),
  );
});

test("the title block's insert holds the handles of its attributes", () => {
  // Found by hashing the attribute handles of the title block inserts of 10^7 layouts and
  // searching ids against them.
  const handle = insertAttributeHandle("S6980407.title-block", "SCALE");
  assert.equal(handle, "1B30312DFF4658");
  assert.equal(idHandle("t74230822"), handle);
  const after = createDrawing({ units: "ft", standard });
  after.layout("S6980407", (sheet) => sheet.titleBlock());
  refused(
    () => after.line([0, 0], [1, 0], { id: "t74230822" }),
    "id-handle",
    /the attribute "SCALE" of the insert "S6980407.title-block"/,
  );
  const before = createDrawing({ units: "ft", standard });
  before.line([0, 0], [1, 0], { id: "t74230822" });
  before.layout("S6980407", (sheet) => {
    refused(() => sheet.titleBlock(), "id-handle", /the id "t74230822"/);
    // The refused title block left nothing on the layout, so it can be placed again.
    assert.throws(() => sheet.titleBlock(), /the id "t74230822"/);
  });
  assert.deepEqual(before.build().layouts![0]!.entities, []);
});

/**
 * A standard of a file per sheet whose title block's block inserts a block of an attribute with
 * the id "S6980407.title-block", and draws on a layer with fields by discipline.
 */
const nested = defineStandard({
  id: "nested",
  version: "1",
  extends: BUILT_IN_STANDARD,
  sheetFiles: "sheet-per-file",
  defaultSheetFormat: "nested",
  layers: { "TB-CIVIL": { color: 7, byDiscipline: { C: { color: 3 } } } },
  titleBlocks: {
    nested: {
      paper: "ARCH D",
      block: (() => {
        const d = createDrawing({ units: "in" });
        d.layer("TB-CIVIL");
        d.block("SCALE BOX", {}, () =>
          d.attribute("SCALE", [33, 0.5], { value: "-", height: 0.1 }),
        );
        d.block("FIELDS", {}, () => {
          d.attribute("NUMBER", [33, 1], { value: "-", height: 0.25 });
          d.insert("SCALE BOX", [0, 0], { id: "S6980407.title-block" });
          d.layer("TB-CIVIL", () => d.line([0.5, 0.5], [35.5, 0.5]));
        });
        return d.build();
      })(),
      blockName: "FIELDS",
      layer: "C-PROP",
      drawingArea: [0.5, 0.5, 35.5, 23.5],
      fields: { NUMBER: { fills: "number" } },
    },
  },
  sheetFormats: { nested: { paper: "ARCH D", titleBlock: "nested" } },
});

test("an insert with an id in a title block's block holds the handles of its attributes", () => {
  assert.equal(insertAttributeHandle("S6980407.title-block", "SCALE"), idHandle("t74230822"));
  const sheet = () =>
    createDrawing({ units: "ft", standard: nested, discipline: "C", fields: { number: "A-1" } });
  const after = sheet();
  after.layout("A-1", (s) => s.titleBlock());
  refused(
    () => after.line([0, 0], [1, 0], { id: "t74230822" }),
    "id-handle",
    /the attribute "SCALE" of the insert "S6980407.title-block"/,
  );
  toDXF(after.build());
  const before = sheet();
  before.line([0, 0], [1, 0], { id: "t74230822" });
  before.layout("A-1", (s) => refused(() => s.titleBlock(), "id-handle", /the id "t74230822"/));
  toDXF(before.build());
});

test("a title block refused for a layer it draws on takes no layer or linetype", () => {
  const d = createDrawing({ units: "ft", standard: nested, fields: { number: "A-1" } });
  d.layout("A-1", (s) =>
    refused(
      () => s.titleBlock(),
      "standard",
      /^Layer "TB-CIVIL" has fields of its own in the discipline C/,
    ),
  );
  const left = d.build();
  assert.deepEqual(
    [left.layers.map((l) => l.name), left.linetypes, left.blocks, left.textStyles],
    [["0"], [], undefined, undefined],
  );
});

test("a firm's border is an xref under the block of the fields, shared by every layout", () => {
  const d = createDrawing({ units: "ft", standard: firm });
  for (const [name, title] of [
    ["A-101", "FIRST FLOOR"],
    ["A-102", "SECOND FLOOR"],
  ] as const) {
    d.layout(name, (sheet) => {
      sheet.titleBlock({ title });
      assert.deepEqual(sheet.zone("views").width, 34);
    });
  }
  const drawing = d.build();
  assert.deepEqual(drawing.xrefs, [{ name: "BORDER", path: "border.dwg" }]);
  assert.deepEqual(
    drawing.layouts!.map((layout) =>
      layout.entities.map((e) => [e.id, (e as Insert).block, (e as Insert).attributes]),
    ),
    [
      [
        ["A-101.border", "BORDER", undefined],
        ["A-101.title-block", "FIELDS", { NUMBER: "A-101", TITLE: "FIRST FLOOR" }],
      ],
      [
        ["A-102.border", "BORDER", undefined],
        ["A-102.title-block", "FIELDS", { NUMBER: "A-102", TITLE: "SECOND FLOOR" }],
      ],
    ],
  );
  assert.deepEqual(drawing.textStyles, [{ name: "FIELDS", font: "Arial" }]);
  // A title block refused for a block of its name leaves nothing of it in the drawing.
  const taken = createDrawing({ units: "ft", standard: firm });
  taken.block("FIELDS", {}, () => {});
  taken.layout("A-101", (sheet) =>
    refused(() => sheet.titleBlock(), "duplicate-block", /holds the block "FIELDS"/),
  );
  const left = taken.build();
  assert.deepEqual(
    [left.blocks?.map((b) => b.name), left.textStyles, left.xrefs, left.layouts![0]!.entities],
    [["FIELDS"], undefined, undefined, []],
  );
  // A layout whose name is no id has inserts with none.
  const spaced = createDrawing({ units: "ft", standard: firm });
  spaced.layout("A 101", (sheet) => sheet.titleBlock());
  assert.deepEqual(
    spaced.build().layouts![0]!.entities.map((e) => e.id),
    [undefined, undefined],
  );
});

test("under sheet-per-file a drawing is one sheet, with a number that names its file", () => {
  const sheet = (number?: string) => {
    const d = createDrawing({
      units: "ft",
      standard: perFile,
      ...(number ? { fields: { number } } : {}),
    });
    return d;
  };
  const d = sheet("C-101");
  d.layout("SITE PLAN", { sheetFormat: "named" }, (page) =>
    page.titleBlock({ title: "SITE PLAN" }),
  );
  const drawing = d.build();
  // AutoCAD fills every field from the names: the builder writes the xref alone.
  assert.deepEqual(
    drawing.layouts![0]!.entities.map((e) => [e.id, (e as Insert).block]),
    [[undefined, "TITLE"]],
  );
  refused(
    () => d.layout("DETAILS", { sheetFormat: "named" }, () => {}),
    "sheet-per-file",
    /^Layout "DETAILS": Under sheetFiles "sheet-per-file" a drawing is one sheet, with one layout/,
  );
  refused(
    () => sheet().layout("SITE PLAN", { sheetFormat: "named" }, () => {}),
    "sheet-per-file",
    /^Under sheetFiles "sheet-per-file" a sheet has a number, which names its file/,
  );
  sheet()
    .layout("SITE PLAN", { sheetFormat: "named" }, (page) => page.titleBlock({ number: "C-102" }))
    .build();
  for (const [number, problem] of [
    ["CON", /Windows keeps for a device/],
    ["lpt1.dwg", /Windows keeps for a device/],
    ["C-101.", /cannot end with a space or a dot/],
    ["C/101", /cannot hold/],
    ["x".repeat(65), /has 1 to 64 characters/],
  ] as const) {
    refused(() => sheet(number), "sheet-per-file", problem);
  }
  sheet().layout("SITE PLAN", { sheetFormat: "named" }, (page) => {
    refused(
      () => page.titleBlock({ number: "C-1", title: "SITE" }),
      "layout",
      /^The title block's field "TITLE" reads the layout's name, "SITE PLAN", which AutoCAD writes in it/,
    );
    refused(
      () => page.titleBlock({ number: "C-1", date: "2026-11-13" }),
      "layout",
      /^The title block's field "DATE" holds the date AutoCAD opens or plots the sheet/,
    );
    page.titleBlock({ number: "C-1", title: "SITE PLAN" });
  });
  createDrawing({
    units: "ft",
    standard: perFile,
    fields: { number: "C-1", title: "SITE" },
  }).layout("SITE PLAN", { sheetFormat: "named" }, (page) =>
    refused(
      () => page.titleBlock(),
      "layout",
      /^The title block's field "TITLE" reads the layout's name, "SITE PLAN"/,
    ),
  );
  // A model drawing has no layout, and needs no number.
  createDrawing({ units: "ft", standard: perFile, discipline: "C" }).build();
});

test("under a standard a text names a role, and the drawing defines no text style", () => {
  const d = createDrawing({ units: "ft", standard });
  d.layout("C-1", () => {
    refused(
      // @ts-expect-error: a text names a role.
      () => d.text([0, 0], "A", { height: 0.1 }),
      "text-style-outside-standard",
      /^Under a standard a text names a role of the standard/,
    );
    refused(
      () => d.text([0, 0], "A"),
      "text-style-outside-standard",
      /^Under a standard a text names a role of the standard/,
    );
  });
  d.block("B", {}, () =>
    refused(
      // @ts-expect-error: an attribute names a role too.
      () => d.attribute("T", [0, 0], { style: "Standard" }),
      "text-style-outside-standard",
      /^Under a standard a text names a role/,
    ),
  );
});
