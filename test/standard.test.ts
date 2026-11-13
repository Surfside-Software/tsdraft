import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  BUILT_IN_STANDARD,
  createDrawing,
  defineStandard,
  DrawingError,
  lint,
  type Drawing,
  type DrawingBuilder,
  type Standard,
  type StandardDocument,
  type Units,
} from "../src/index.ts";
import { dimensionPrefixProblem, plainDimensionText, xrefPathProblem } from "../src/rules.ts";
import { sha256, sha256Text } from "../src/sha256.ts";
import { BUILT_IN_DOCUMENT } from "../src/standard/default.ts";
import { VERSION } from "../src/version.ts";
import {
  builtInDocument,
  packageVersion,
  schemaUrl,
  versionSource,
} from "../scripts/standard-files.ts";
import { standardSchema } from "../src/standard/shape.ts";

const base = { id: "t", version: "1", extends: BUILT_IN_STANDARD } as const;
const alone = { id: "t", version: "1", paperUnits: "in", minTextHeight: 0.0625 } as const;
const shared = { ...base, sheetFiles: "sheet-per-file" } as const;

/** The problems `defineStandard` finds in a document, as `item: message`. */
function problems(document: unknown, files?: Record<string, unknown>): string[] {
  try {
    defineStandard(document as never, files ? { files } : {});
  } catch (thrown) {
    assert.ok(thrown instanceof DrawingError);
    for (const d of thrown.diagnostics) assert.equal(d.rule, "standard");
    return thrown.diagnostics.map((d) => (d.item ? `${d.item}: ${d.message}` : d.message));
  }
  return [];
}

/** A title block's drawing, drawn by `draw`. */
function fragment(draw: (d: DrawingBuilder) => void, units: Units = "in"): Drawing {
  const d = createDrawing({ units });
  draw(d);
  return d.build();
}

// Each `@ts-expect-error` below proves the compiler rejects the literal. The `assert.throws`
// around it proves the same mistake is caught, with the same message, when the code runs.
test("literal mistakes in a standard are compile errors and runtime errors", () => {
  const style = {
    arrowSize: 0.1,
    extensionOffset: 0.1,
    extensionBeyond: 0.1,
    textGap: 0.1,
  } as const;
  const block = { paper: "ARCH D", layer: "G-ANNO-TTLB", drawingArea: [1, 1, 2, 2] } as const;
  const xref = { name: "BORDER", path: "border.dwg" } as const;
  const sheet = { paper: "ARCH D", titleBlock: "plain" } as const;
  const role = { font: "Arial", height: 0.1 } as const;
  const throws = assert.throws;

  // @ts-expect-error: AutoCAD refuses a comma in a layer name.
  throws(() => defineStandard({ ...base, layers: { "A,B": { color: 1 } } }), /cannot contain/);
  // @ts-expect-error: layer 0 is in every drawing.
  throws(() => defineStandard({ ...base, layers: { "0": { color: 1 } } }), /Layer "0" is in/);
  // @ts-expect-error: colors run from 1 to 255.
  throws(() => defineStandard({ ...base, layers: { A: { color: 0 } } }), /Color Index/);
  // @ts-expect-error: colors are integers.
  throws(() => defineStandard({ ...base, layers: { A: { color: 1.5 } } }), /Color Index/);
  // @ts-expect-error: 0.33 mm is not one of AutoCAD's lineweights.
  throws(() => defineStandard({ ...base, pens: { p: { lineweight: 0.33 } } }), /AutoCAD's, in/);
  // @ts-expect-error: a font must be one of FONTS.
  throws(() => defineStandard({ ...base, textRoles: { r: { ...role, font: "Ariel" } } }), /FONTS/);
  throws(
    // @ts-expect-error: a paper must be one of PAPERS.
    () => defineStandard({ ...base, sheetFormats: { s: { ...sheet, paper: "A9" } } }),
    /PAPERS/,
  );

  // A name the standard and its parent do not have.
  throws(
    // @ts-expect-error: the standard has no discipline X.
    () => defineStandard({ ...base, layers: { A: { color: 1, discipline: "X" } } }),
    /^DrawingError: The standard has 1 problem:\n- layers\["A"\]\.discipline: Discipline "X" is not a discipline of the standard\. Add it to disciplines, or name one of its disciplines$/,
  );
  throws(
    // @ts-expect-error: the standard has no pen thick.
    () => defineStandard({ ...base, layers: { A: { color: 1, pen: "thick" } } }),
    /Pen "thick"/,
  );
  throws(
    // @ts-expect-error: the standard has no linetype DASHY.
    () => defineStandard({ ...base, layers: { A: { color: 1, linetype: "DASHY" } } }),
    /Linetype "DASHY" is not a linetype of the standard/,
  );
  throws(
    // @ts-expect-error: ByLayer is no linetype of a standard.
    () => defineStandard({ ...base, layers: { A: { color: 1, linetype: "ByLayer" } } }),
    /Linetype "ByLayer"/,
  );
  throws(
    // @ts-expect-error: the standard has no text role callout.
    () => defineStandard({ ...base, dimensionStyles: { d: { ...style, role: "callout" } } }),
    /Text role "callout" is not a text role/,
  );
  throws(
    // @ts-expect-error: the standard has no dimension style tick.
    () => defineStandard({ ...base, defaultDimensionStyle: "tick" }),
    /Dimension style "tick"/,
  );
  throws(
    // @ts-expect-error: the standard has no title block firm.
    () => defineStandard({ ...base, sheetFormats: { s: { ...sheet, titleBlock: "firm" } } }),
    /Title block "firm" is not a title block/,
  );
  // @ts-expect-error: the standard has no sheet format arch-e.
  throws(() => defineStandard({ ...base, defaultSheetFormat: "arch-e" }), /Sheet format "arch-e"/);
  throws(
    // @ts-expect-error: the standard has no layer A-TTLB.
    () => defineStandard({ ...base, titleBlocks: { t: { ...block, xref, layer: "A-TTLB" } } }),
    /Layer "A-TTLB" is not a layer/,
  );
  throws(
    () =>
      // @ts-expect-error: a child that removes a pen cannot name it.
      defineStandard({ ...base, pens: { fine: null }, layers: { A: { color: 1, pen: "fine" } } }),
    /Pen "fine"/,
  );
  throws(
    // @ts-expect-error: byDiscipline is by the standard's disciplines.
    () => defineStandard({ ...shared, layers: { A: { color: 1, byDiscipline: { X: {} } } } }),
    /Discipline "X"/,
  );

  throws(
    // @ts-expect-error: Continuous is in every standard.
    () => defineStandard({ ...base, linetypes: { continuous: { pattern: [] } } }),
    /Continuous, ByLayer and ByBlock/,
  );
  // @ts-expect-error: a pattern of one length.
  throws(() => defineStandard({ ...base, linetypes: { ONE: { pattern: [1] } } }), /2 to 12/);
  // @ts-expect-error: an id holds letters, digits, ., - and _.
  throws(() => defineStandard({ ...base, pens: { "a b": { lineweight: 0.5 } } }), /An id can/);
  throws(
    // @ts-expect-error: a role named standard would have the text style STANDARD.
    () => defineStandard({ ...base, textRoles: { Standard: role } }),
    /A text role cannot be named standard/,
  );
  throws(
    // @ts-expect-error: a dimension style named standard would be AutoCAD's own.
    () => defineStandard({ ...base, dimensionStyles: { standard: { ...style, role: "note" } } }),
    /A dimension style cannot be named standard/,
  );
  // @ts-expect-error: the least height a text plots at is above 0.
  throws(() => defineStandard({ ...base, minTextHeight: 0 }), /greater than 0/);
  // @ts-expect-error: the linetype scale is above 0.
  throws(() => defineStandard({ ...base, linetypeScale: -1 }), /greater than 0/);
  // @ts-expect-error: a role's height is above 0.
  throws(() => defineStandard({ ...base, textRoles: { r: { ...role, height: -1 } } }), /than 0/);
  throws(
    // @ts-expect-error: a width factor runs from 0.01 to 100.
    () => defineStandard({ ...base, textRoles: { r: { ...role, widthFactor: 0 } } }),
    /A width factor must be/,
  );
  throws(
    // @ts-expect-error: an oblique angle runs from -85 to 85 degrees.
    () => defineStandard({ ...base, textRoles: { r: { ...role, obliqueAngle: 90 } } }),
    /An oblique angle must be/,
  );
  throws(
    // @ts-expect-error: a ratio is above 0.
    () => defineStandard({ ...base, scales: { s: { label: "1:1", ratio: 0 } } }),
    /The ratio must be greater than 0/,
  );
  // @ts-expect-error: paper units are inches or millimetres.
  throws(() => defineStandard({ ...alone, paperUnits: "cm" }), /paperUnits must be "in" or "mm"/);
  // @ts-expect-error: sheets are one drawing, or a file each.
  throws(() => defineStandard({ ...base, sheetFiles: "many" }), /sheetFiles must be/);
  // @ts-expect-error: a plot style table must be one AutoCAD installs.
  throws(() => defineStandard({ ...base, plotStyle: "pens.ctb" }), /plot style table must be/);
  throws(
    // @ts-expect-error: a sheet format's own plot style table too.
    () => defineStandard({ ...base, sheetFormats: { s: { ...sheet, plotStyle: "pens.ctb" } } }),
    /plot style table must be/,
  );
  throws(
    () =>
      defineStandard({
        ...base,
        // @ts-expect-error: a zone's name is an id.
        sheetFormats: { s: { ...sheet, zones: { "a b": [1, 1, 2, 2] } } },
      }),
    /An id can only use/,
  );

  throws(
    () =>
      defineStandard({
        ...base,
        // @ts-expect-error: an arrowhead is one of ARROWHEADS.
        dimensionStyles: { d: { ...style, role: "note", arrowhead: "dot" } },
      }),
    /ARROWHEADS/,
  );
  throws(
    () =>
      defineStandard({
        ...base,
        // @ts-expect-error: AUDIT reports a dimension style with a negative size.
        dimensionStyles: { d: { ...style, role: "note", arrowSize: -1 } },
      }),
    /This value cannot be less than 0/,
  );
  throws(
    () =>
      // @ts-expect-error: AutoCAD draws a box around a text whose gap is negative.
      defineStandard({ ...base, dimensionStyles: { d: { ...style, role: "note", textGap: -1 } } }),
    /The gap cannot be less than 0/,
  );
  throws(
    () =>
      defineStandard({
        ...base,
        // @ts-expect-error: a precision runs from 0 to 8.
        dimensionStyles: { d: { ...style, role: "note", writing: { ft: { precision: 9 } } } },
      }),
    /A precision is a whole number/,
  );
  throws(
    () =>
      defineStandard({
        ...base,
        dimensionStyles: {
          d: {
            ...style,
            role: "note",
            writing: {
              ft: {
                precision: 1,
                // @ts-expect-error: a prefix cannot hold the place of the measurement.
                prefix: "<>",
                // @ts-expect-error: AutoCAD reads a brace as formatting.
                suffix: "{",
                // @ts-expect-error: a measurement scale is above 0.
                measurementScale: 0,
                // @ts-expect-error: decimal is the one way tsdraft writes a length.
                units: "fractional",
                // @ts-expect-error: the zeros left out are leading, trailing or both.
                suppressZeros: "bogus",
              },
            },
          },
        },
      }),
    (thrown: DrawingError) =>
      /A prefix cannot contain <>/.test(thrown.message) &&
      /AutoCAD reads them as the formatting/.test(thrown.message) &&
      /The measurement scale must be greater than 0/.test(thrown.message) &&
      /units must be "decimal"/.test(thrown.message) &&
      /suppressZeros must be "leading", "trailing" or "both"/.test(thrown.message),
  );

  throws(
    () =>
      // @ts-expect-error: a tag holds no lower-case letter.
      defineStandard({ ...base, titleBlocks: { t: { ...block, xref, fields: { Sheet: {} } } } }),
    /An attribute's tag cannot hold a lower-case letter/,
  );
  throws(
    () =>
      defineStandard({
        ...base,
        titleBlocks: {
          t: {
            ...block,
            xref,
            // @ts-expect-error: fills is one of what a sheet fills, and a source is one of four.
            fields: { N: { fills: "numbr" }, D: { source: "file" } },
          },
        },
      }),
    (thrown: DrawingError) =>
      /fills must be "number"/.test(thrown.message) && /source must be/.test(thrown.message),
  );
  throws(
    () =>
      defineStandard({
        ...base,
        // @ts-expect-error: AutoCAD draws an architectural tick with the block _ArchTick.
        titleBlocks: { t: { ...block, xref: { ...xref, name: "_ArchTick" } } },
      }),
    /_ArchTick/,
  );
  throws(
    () =>
      defineStandard({
        ...base,
        // @ts-expect-error: an xref's path starts from the folder of the drawing's file.
        titleBlocks: { t: { ...block, xref: { ...xref, path: "/b.dwg" } } },
      }),
    /must start from the folder/,
  );
});

test("values the compiler cannot see are checked when the code runs, and names fold as AutoCAD folds them", () => {
  const name: string = ["A", "B"].join(",");
  assert.throws(
    () => defineStandard({ ...base, layers: { [name]: { color: 1 } } }),
    /cannot contain/,
  );
  // The compiler compares names exactly; AutoCAD takes "HEAVY" for "heavy" and "c-prop" for
  // "C-PROP", and so does the runtime, which keeps the name as the standard spells it.
  const folded = defineStandard({ ...base, layers: { A: { color: 1, pen: "HEAVY" as string } } });
  assert.equal(folded.layers.A.pen, "heavy");
  // @ts-expect-error: the compiler holds a literal to the standard's spelling.
  defineStandard({ ...base, layers: { A: { color: 1, pen: "HEAVY" } } });
  assert.deepEqual(problems({ ...base, layers: { A: { color: 1, linetype: "continuous" } } }), []);
  assert.deepEqual(problems({ ...base, layers: { A: { color: 1, linetype: "phantom" } } }), []);
});

test("a child replaces an entry whole under its parent's spelling, and null removes one", () => {
  const child = defineStandard({
    id: "acme",
    version: "2026.1",
    extends: BUILT_IN_STANDARD,
    disciplines: { A: { title: "Architectural" } },
    layers: {
      "A-WALL": { color: 2, pen: "bold", discipline: "A" },
      "C-ROAD-CNTR": null,
      "c-prop": { color: 3 },
    },
  });
  assert.deepEqual(child.layers["C-PROP"], { color: 3, linetype: "Continuous", plot: true });
  assert.ok(!("c-prop" in child.layers) && !("C-ROAD-CNTR" in child.layers));
  // @ts-expect-error: the removed layer is not in the child's type.
  void child.layers["C-ROAD-CNTR"];
  assert.equal(child.layers["A-WALL"].color, 2);
  assert.deepEqual(child.chain, [{ id: "tsdraft", version: "1", hash: BUILT_IN_STANDARD.hash }]);
  assert.equal(child.title, "acme");
  assert.equal(child.minTextHeight, BUILT_IN_STANDARD.minTextHeight);
  assert.ok(
    Object.isFrozen(child) &&
      Object.isFrozen(child.layers) &&
      Object.isFrozen(child.layers["A-WALL"]),
  );
  // Entries are listed by layerKey of their names.
  assert.deepEqual(Object.keys(child.layers).slice(0, 3), ["A-WALL", "C-ANNO-DIMS", "C-ANNO-SYMB"]);

  assert.deepEqual(problems({ ...base, pens: { thin: null } }), [
    `pens["thin"]: null removes the parent's entry of this name, and the parent has no pen of this name`,
  ]);
  // An inherited entry that names a removed one is an error, which says the parent wrote it.
  const fine = (layer: string) =>
    `layers["${layer}"].pen: Pen "fine", which the parent's layer names, is not a pen of the standard. Add it to pens, or name one of its pens`;
  assert.deepEqual(problems({ ...base, pens: { fine: null } }).toSorted(), [
    fine("C-ANNO-DIMS"),
    fine("C-PROP-ADJC"),
    fine("C-ROAD-CNTR"),
  ]);
  assert.match(
    problems({ ...base, layers: { X: { color: 1 }, x: { color: 2 } } })[0]!,
    /^layers\["x"\]: The standard already has a layer of this name, as "X"/,
  );
  assert.match(
    problems({ ...base, layers: { straße: { color: 1 }, strasse: { color: 2 } } })[0]!,
    /AUDIT reports them as one duplicate name/,
  );
  assert.match(
    problems({ ...base, pens: { Thin: { lineweight: 0.2 }, thin: { lineweight: 0.2 } } })[0]!,
    /compared without regard to case/,
  );
  const zones = { views: [1, 1, 2, 2], VIEWS: [1, 1, 2, 2] };
  assert.deepEqual(
    problems({ ...base, sheetFormats: { s: { paper: "ARCH D", titleBlock: "plain", zones } } }),
    [
      `sheetFormats["s"].zones["VIEWS"]: The sheet format already has a zone of this id, as "views". Ids are compared without regard to case`,
    ],
  );
  assert.deepEqual(
    problems({ ...shared, layers: { A: { color: 1, byDiscipline: { C: { color: 2 }, c: {} } } } }),
    [
      `layers["A"].byDiscipline["c"]: byDiscipline already has a discipline of this id, as "C". Ids are compared without regard to case`,
    ],
  );
  assert.deepEqual(problems({ ...base, dimensionStyles: { dims: null } }), [
    `defaultDimensionStyle: Dimension style "dims", the parent's defaultDimensionStyle, is not a dimension style of the standard. Set defaultDimensionStyle to one of its dimension styles`,
  ]);
  assert.deepEqual(problems({ ...base, paperUnits: "mm" }), [
    `paperUnits: A standard keeps its parent's paperUnits, "in"`,
  ]);
  assert.deepEqual(problems({ id: "t", version: "1" }), [
    `paperUnits: A standard that extends nothing must have the field "paperUnits"`,
    `minTextHeight: A standard that extends nothing must have the field "minTextHeight"`,
  ]);
  assert.deepEqual(problems({ ...base, id: "tsdraft" }), [
    `extends: The standard "tsdraft" version "1" extends itself`,
  ]);
  assert.match(
    problems({ ...base, minTextHeight: 0.1 })[0]!,
    /textRoles\["dimension"\]\.height: A text role's height, 0.09375, is below the standard's minTextHeight, 0.1/,
  );
});

test("a standard's type names only entries it has, and names that are not literals are strings", () => {
  // AutoCAD takes ΟΣ for οσ, though Lowercase makes it ος, with a final sigma.
  const greek = defineStandard({ ...alone, layers: { ΟΣ: { color: 1 }, ΟΣΑ: { color: 1 } } });
  const child = defineStandard({ id: "c", version: "1", extends: greek, layers: { οσ: null } });
  assert.deepEqual(Object.keys(child.layers), ["ΟΣΑ"]);
  // @ts-expect-error: the child removed the layer.
  void child.layers["ΟΣ"];
  // The type takes ÿ for Ÿ, which AutoCAD keeps apart, so it names neither.
  const upper = defineStandard({ ...alone, layers: { Ÿ: { color: 1 } } });
  const lower = defineStandard({
    id: "c",
    version: "1",
    extends: upper,
    layers: { Ÿ: null, ÿ: { color: 2 } },
  });
  assert.deepEqual(Object.keys(lower.layers), ["ÿ"]);
  // @ts-expect-error: the child removed Ÿ.
  void lower.layers.Ÿ;

  // An entry that may be null or left out may be gone, so the type leaves its name out.
  const entry = { color: 3 } as NonNullable<StandardDocument["layers"]>[string];
  const maybe = defineStandard({ ...base, layers: { B: entry } });
  // @ts-expect-error: B may be gone.
  void maybe.layers.B;
  const optional: { A?: { color: 1 }; C: { color: 1 } } = { C: { color: 1 } };
  const left = defineStandard({ ...base, layers: optional });
  assert.equal(left.layers.C.color, 1);
  // @ts-expect-error: A may be left out.
  void left.layers.A;
  // A section that is one of two literals names only what each of them leaves in place.
  const parent = defineStandard({ ...alone, layers: { A: { color: 1 }, Q: { color: 1 } } });
  const either = (removes: boolean) =>
    defineStandard({
      id: "c",
      version: "1",
      extends: parent,
      layers: removes ? { A: null } : { B: { color: 1 } },
    });
  assert.deepEqual(Object.keys(either(true).layers), ["Q"]);
  assert.equal(either(false).layers.Q.color, 1);
  // @ts-expect-error: B is gone when the first literal is taken.
  void either(false).layers.B;
  const removal: { readonly A: null } = { A: null };
  const addition: { readonly B: { readonly color: 1 } } = { B: { color: 1 } };
  const one = (removes: boolean) =>
    defineStandard({
      id: "c",
      version: "1",
      extends: parent,
      layers: removes ? removal : addition,
    });
  assert.equal(one(false).layers.Q.color, 1);
  // @ts-expect-error: the first section removes A.
  void one(false).layers.A;
  // A value typed as a document has names of type string.
  const doc: StandardDocument = { ...base, layers: { A: { color: 1 }, "C-PROP": null } };
  const typed = defineStandard(doc);
  assert.equal(typed.layers["A"]?.color, 1);
  assert.equal(typed.layers["C-PROP"], undefined);
});

test("a standard reads only its own fields, and drops what is for people", () => {
  assert.deepEqual(problems({ ...base, layers: { A: { color: 1, colour: 2 } } }), [
    `layers["A"].colour: "colour" is not a field of a layer in tsdraft ${VERSION}`,
  ]);
  const later = { ...base, $schema: schemaUrl("99.0.0"), layers: { A: { color: 1, hue: 2 } } };
  assert.deepEqual(problems(later), [
    `layers["A"].hue: "hue" is not a field of a layer in tsdraft ${VERSION}. This standard was written for tsdraft 99.0.0: update tsdraft`,
  ]);
  const commented = defineStandard({
    ...base,
    $comment: "Question 1",
    layers: { A: { color: 1, $comment: "x" } },
  });
  assert.deepEqual(commented.layers.A, { color: 1, linetype: "Continuous", plot: true });
  assert.ok(!("$comment" in commented));
  // A title block's drawing takes only the fields of a Drawing.
  const drawing = { ...fragment(() => {}), $comment: "x" };
  const tb = {
    paper: "ARCH D",
    layer: "G-ANNO-TTLB",
    drawingArea: [1, 1, 2, 2],
    block: drawing,
    blockName: "B",
  };
  assert.match(
    problems({ ...base, titleBlocks: { t: tb } }).join("\n"),
    /titleBlocks\["t"\]\.block: The drawing: unknown field "\$comment"/,
  );
});

test("a string names a standard or a drawing in files, and the library reads no file", () => {
  const acme = defineStandard({ ...base, id: "acme", layers: { "A-WALL": { color: 2 } } });
  const child = defineStandard(
    { id: "job", version: "1", extends: "./acme.json" },
    { files: { "./acme.json": acme } },
  );
  assert.equal(child.layers["A-WALL"].color, 2);
  const builtIn = defineStandard({ id: "job", version: "1", extends: "tsdraft/standard.json" });
  assert.equal(builtIn.chain[0]?.hash, BUILT_IN_STANDARD.hash);
  assert.deepEqual(problems({ id: "job", version: "1", extends: "./acme.json" }), [
    `extends: "./acme.json" is not in options.files. The library reads no file: pass the standard it names as files["./acme.json"]`,
  ]);
  // A standard from another copy of tsdraft is plain data, and its hash must be its content's.
  const copied = JSON.parse(JSON.stringify(acme)) as Standard;
  assert.equal(
    defineStandard({ id: "job", version: "1", extends: copied }).chain[0]?.hash,
    acme.hash,
  );
  const changed = { ...copied, minTextHeight: 0.07 };
  assert.match(
    problems({ id: "job", version: "1", extends: changed })[0]!,
    /^extends: The parent is not a standard/,
  );

  const border = fragment((d) => d.block("B", {}, () => d.line([0, 0], [1, 1])));
  const tb = {
    paper: "ARCH D",
    layer: "G-ANNO-TTLB",
    drawingArea: [1, 1, 2, 2],
    block: "./b.json",
    blockName: "B",
  };
  const named = defineStandard(
    { ...base, titleBlocks: { t: tb } },
    { files: { "./b.json": JSON.parse(JSON.stringify(border)) } },
  );
  assert.deepEqual(named.titleBlocks.t.block, border);
  assert.match(
    problems({ ...base, titleBlocks: { t: tb } })[0]!,
    /^titleBlocks\["t"\]\.block: "\.\/b\.json" is not in options\.files/,
  );
  const plain = defineStandard({
    ...base,
    titleBlocks: {
      p: {
        ...tb,
        block: "tsdraft/title-blocks/plain-arch-d.json",
        blockName: "TITLE BLOCK",
        drawingArea: [0.5, 0.5, 35.5, 23.5],
      },
    },
  });
  assert.equal(plain.titleBlocks.p.block, BUILT_IN_STANDARD.titleBlocks.plain.block);
});

test("how a firm keeps its sheets decides where a title block's fields come from", () => {
  const area = {
    paper: "ARCH D",
    layer: "G-ANNO-TTLB",
    drawingArea: [0.5, 0.5, 35.5, 23.5],
  } as const;
  const xref = { name: "BORDER", path: "xref/border.dwg" } as const;
  const named = {
    NUMBER: { fills: "number", source: "fileName" },
    TITLE: { fills: "title", source: "layoutName" },
  } as const;
  assert.deepEqual(
    problems({ ...shared, titleBlocks: { firm: { ...area, xref, fields: named } } }),
    [],
  );
  assert.deepEqual(
    problems({ ...base, titleBlocks: { firm: { ...area, xref, fields: named } } }).map(
      (p) => p.split(": ")[0],
    ),
    [`titleBlocks["firm"].fields["NUMBER"].source`, `titleBlocks["firm"].fields["TITLE"].source`],
  );
  assert.match(
    problems({ ...base, titleBlocks: { firm: { ...area, xref, fields: named } } })[0]!,
    /one drawing has one file name/i,
  );
  assert.match(
    problems({
      ...base,
      titleBlocks: { firm: { ...area, xref, fields: { D: { source: "currentDate" } } } },
    }).join(),
    /^$/,
  );
  // A field that AutoCAD fills is a field of the xref's drawing.
  const plain = BUILT_IN_STANDARD.titleBlocks.plain;
  const own = { ...area, block: plain.block, blockName: "TITLE BLOCK" };
  assert.match(
    problems({
      ...shared,
      titleBlocks: { t: { ...own, fields: { D: { source: "currentDate" } } } },
    })[0]!,
    /this title block has no xref/,
  );
  // A field that is an attribute is written in the block's attribute of its tag.
  assert.match(
    problems({ ...base, titleBlocks: { t: { ...area, xref, fields: { N: {} } } } })[0]!,
    /this title block has no block/,
  );
  assert.match(
    problems({ ...base, titleBlocks: { t: { ...own, fields: { N: {} } } } })[0]!,
    /has no attribute with the tag "N"/,
  );
  assert.deepEqual(
    problems({
      ...base,
      titleBlocks: { t: { ...own, xref, fields: { SHEET: { fills: "number" } } } },
    }),
    [],
  );

  // byDiscipline holds where each discipline's model is a drawing of its own.
  const by = { layers: { TEXT: { color: 7, byDiscipline: { C: { color: 3, pen: "fine" } } } } };
  const sheets = defineStandard({ ...shared, ...by });
  assert.deepEqual(sheets.layers.TEXT.byDiscipline, { C: { color: 3, pen: "fine" } });
  assert.match(
    problems({ ...base, ...by })[0]!,
    /^layers\["TEXT"\]\.byDiscipline: byDiscipline holds only under sheetFiles "sheet-per-file"/,
  );
  assert.match(
    problems({
      ...shared,
      layers: { TEXT: { color: 7, discipline: "C", byDiscipline: { V: { color: 3 } } } },
    })[0]!,
    /An entry of one discipline has one set of fields/,
  );
  assert.match(
    problems({
      ...shared,
      layers: { TEXT: { color: 7, byDiscipline: { C: { pen: "thin" } } } },
    })[0]!,
    /^layers\["TEXT"\]\.byDiscipline\["C"\]\.pen: Pen "thin"/,
  );
});

test("a title block's names are one definition each in a drawing", () => {
  const area = {
    paper: "ARCH D",
    layer: "G-ANNO-TTLB",
    drawingArea: [0.5, 0.5, 35.5, 23.5],
  } as const;
  const plain = BUILT_IN_STANDARD.titleBlocks.plain;
  // The same block and text style in two title blocks are one copy in a drawing.
  assert.deepEqual(
    problems({
      ...base,
      titleBlocks: { again: { ...area, block: plain.block, blockName: "TITLE BLOCK" } },
    }),
    [],
  );
  const other = fragment((d) => {
    d.textStyle({ name: "TITLE BLOCK", font: "Times New Roman" });
    d.block("TITLE BLOCK", {}, () => d.text([1, 1], "X", { height: 0.1, style: "TITLE BLOCK" }));
  });
  const clash = problems({
    ...base,
    titleBlocks: { other: { ...area, block: other, blockName: "title block" } },
  });
  assert.deepEqual(clash, [
    `titleBlocks["other"].block: The title blocks "plain" and "other" both hold a block "TITLE BLOCK", with different definitions. A drawing holds one block of a name: give one of them another name`,
    `titleBlocks["other"].block: The title blocks "plain" and "other" both hold a text style "TITLE BLOCK", with different definitions. A drawing holds one text style of a name: give one of them another name`,
  ]);
  const titled = fragment((d) => {
    d.textStyle({ name: "Title", font: "Arial" });
    d.block("SHEET", {}, () => d.text([1, 1], "X", { height: 0.1, style: "Title" }));
  });
  assert.match(
    problems({ ...base, titleBlocks: { t: { ...area, block: titled, blockName: "SHEET" } } })[0]!,
    /text style "Title" has the name of the text style of the role "title"/,
  );
  const xref = { ...area, xref: { name: "TITLE BLOCK", path: "tb.dwg" } };
  assert.match(
    problems({ ...base, titleBlocks: { t: xref } })[0]!,
    /The xref "TITLE BLOCK" has the name of the block "TITLE BLOCK" of the title block "plain"/,
  );
  const border = (path: string) => ({ ...area, xref: { name: "BORDER", path } });
  assert.deepEqual(
    problems({ ...base, titleBlocks: { a: border("b.dwg"), b: border("b.dwg") } }),
    [],
  );
  assert.match(
    problems({ ...base, titleBlocks: { a: border("b.dwg"), b: border("c.dwg") } })[0]!,
    /both have an xref "BORDER", at different paths/,
  );

  const on = (layer: string) =>
    fragment((d) =>
      d.block("B", {}, () => d.layer(layer, { color: 1 }, () => d.line([0, 0], [1, 1]))),
    );
  const tb = (block: object) => ({
    ...base,
    titleBlocks: { t: { ...area, block, blockName: "B" } },
  });
  assert.deepEqual(problems(tb(on("G-ANNO-TTLB"))), []);
  assert.match(
    problems(tb(on("X-RED")))[0]!,
    /draws on the layer "X-RED", which is not a layer of the standard/,
  );
  const dashed = fragment((d) =>
    d.linetype({ name: "DASHED", pattern: [1, -1] }).block("B", {}, () => d.line([0, 0], [1, 1])),
  );
  assert.match(
    problems(tb(dashed))[0]!,
    /defines the linetype "DASHED" otherwise than the standard does/,
  );
  const sheet = fragment((d) =>
    d.block("B", {}, () => d.line([0, 0], [1, 1])).layout("L", { paper: "ARCH D" }, () => {}),
  );
  assert.match(problems(tb(sheet))[0]!, /cannot hold a layout/);
  const feet = fragment((d) => d.block("B", {}, () => d.line([0, 0], [1, 1])), "ft");
  assert.match(
    problems(tb(feet))[0]!,
    /The drawing is in "ft", and the standard's paperUnits are "in"/,
  );
  const unnamed = { ...base, titleBlocks: { t: { ...area, block: on("0"), blockName: "C" } } };
  assert.match(
    problems(unnamed)[0]!,
    /The title block's drawing has no block "C", which blockName names/,
  );
});

test("boxes lie inside the boxes that hold them, and AutoCAD's names of dimension styles are distinct", () => {
  const area = {
    paper: "ARCH D",
    layer: "G-ANNO-TTLB",
    xref: { name: "B", path: "b.dwg" },
  } as const;
  assert.match(
    problems({ ...base, titleBlocks: { t: { ...area, drawingArea: [0, 0, 40, 24] } } })[0]!,
    /drawingArea: The box reaches past the paper, \[0, 0, 36, 24\]/,
  );
  assert.match(
    problems({ ...base, titleBlocks: { t: { ...area, drawingArea: [2, 2, 1, 3] } } })[0]!,
    /with left less than right/,
  );
  assert.match(
    problems({
      ...base,
      titleBlocks: { t: { ...area, drawingArea: [1, 1, 35, 23], box: [30, 0, 35, 3] } },
    })[0]!,
    /\.box: The box reaches past the drawing area/,
  );
  const format = { paper: "ARCH D", titleBlock: "plain" } as const;
  assert.match(
    problems({ ...base, sheetFormats: { s: { ...format, zones: { z: [0, 0, 1, 1] } } } })[0]!,
    /zones\["z"\]: The box reaches past the title block's drawing area/,
  );
  assert.match(
    problems({ ...base, sheetFormats: { s: { ...format, paper: "ARCH C" } } })[0]!,
    /The sheet format's paper, "ARCH C", is not its title block's, "ARCH D"/,
  );
  const style = {
    role: "note",
    arrowSize: 0.1,
    extensionOffset: 0.1,
    extensionBeyond: 0.1,
    textGap: 0.1,
  };
  const twins = {
    ...alone,
    textRoles: { note: { font: "Arial", height: 0.1 } },
    scales: { "b-c": { label: "1", ratio: 1 }, c: { label: "2", ratio: 2 } },
    dimensionStyles: { a: style, "a-b": style },
  };
  assert.match(
    problems(twins)[0]!,
    /The dimension style "a-b" at the scale "c" and the dimension style "a" at the scale "b-c" have names that AutoCAD takes for one dimension style/,
  );
});

test("the hash is what the merged document states for a check", () => {
  const child = defineStandard({ ...base, id: "acme", layers: { "A-WALL": { color: 2 } } });
  // Flattened into one document, a standard keeps its hash.
  const { hash, chain: _, ...flat } = child;
  assert.equal(defineStandard(flat as never).hash, hash);
  const again = (fields: object) =>
    defineStandard({ ...base, id: "acme", layers: { "A-WALL": { color: 2, ...fields } } } as never)
      .hash;
  // Text for people, provenance and a default given or not leave it as it is.
  assert.equal(again({ description: "Walls", $comment: "x" }), hash);
  assert.equal(again({ plot: true, linetype: "CONTINUOUS" }), hash);
  assert.equal(
    defineStandard({
      ...base,
      id: "other",
      version: "9",
      title: "Other",
      layers: { "A-WALL": { color: 2 } },
    }).hash,
    hash,
  );
  // A rule, a discipline and a linetype's description change it.
  assert.notEqual(again({ color: 3 }), hash);
  assert.notEqual(again({ discipline: "G" }), hash);
  const described = (description: string) =>
    defineStandard({ ...base, linetypes: { DASHED: { description, pattern: [0.5, -0.25] } } }).hash;
  assert.notEqual(described("Dashes"), described("Dashed __ __ __"));
  assert.equal(described(BUILT_IN_STANDARD.linetypes.DASHED.description), BUILT_IN_STANDARD.hash);
  // So does anything in a title block's drawing.
  const plain = BUILT_IN_STANDARD.titleBlocks.plain;
  const moved = {
    ...plain.block!,
    blocks: plain.block!.blocks!.map((b) => ({ ...b, base: [0, 1] as const })),
  };
  assert.notEqual(
    defineStandard({ ...base, titleBlocks: { plain: { ...plain, block: moved } } }).hash,
    BUILT_IN_STANDARD.hash,
  );

  // The JSON the package ships is a document that resolves to the built-in standard.
  const json = JSON.parse(readFileSync(join(import.meta.dirname, "..", "standard.json"), "utf8"));
  assert.equal(defineStandard(json).hash, BUILT_IN_STANDARD.hash);
  // The library makes the built-in standard without the checks, which its document passes, and
  // with the hash it has. A change to what it states needs a new version, which the CHANGELOG
  // gives, and then the hash in src/standard/define.ts.
  const checked = defineStandard(BUILT_IN_DOCUMENT as never);
  assert.equal(JSON.stringify(checked), JSON.stringify(BUILT_IN_STANDARD));
  assert.deepEqual(lint(BUILT_IN_STANDARD.titleBlocks.plain.block!), []);
  assert.equal(BUILT_IN_STANDARD.version, "1");
});

test("SHA-256 gives the digests of FIPS 180-4 and of node:crypto", () => {
  assert.equal(sha256Text(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(
    sha256Text("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  for (const length of [55, 56, 63, 64, 65, 1000]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
    assert.equal(sha256(bytes), createHash("sha256").update(bytes).digest("hex"));
  }
  const text = "ÉΣ日本\u{1F600}\ud800";
  assert.equal(sha256Text(text), createHash("sha256").update(text).digest("hex"));
});

test("the schema refuses the prefixes, suffixes and xref paths the runtime refuses", () => {
  type Rule = { readonly pattern: string; readonly maxLength?: number };
  const defs = standardSchema(VERSION).$defs as Record<
    string,
    { readonly properties: Record<string, Rule> }
  >;
  const agree = (rule: Rule, problem: (value: string) => string | undefined, values: string[]) => {
    for (const flags of ["", "u"]) {
      const pattern = new RegExp(rule.pattern, flags);
      for (const value of values) {
        const schema = pattern.test(value) && [...value].length <= (rule.maxLength ?? Infinity);
        assert.equal(
          schema,
          problem(value) === undefined,
          `${JSON.stringify(value)}, flags "${flags}"`,
        );
      }
    }
  };
  const text = ["", "Ø", "a\u0007", "\ue800", "\ud800", "😀", "\\P", "{", "}", "a\u007f"];
  const prefixes = [...text, "R=", "<>", "a<>b", "<"];
  agree(defs.writing!.properties.prefix!, dimensionPrefixProblem, prefixes);
  agree(defs.writing!.properties.suffix!, plainDimensionText, [...text, "'", "<>"]);
  const paths = ["b.dwg", "dir/b.dwg", "dir\\b.dwg", "b.dwg.", "B.DWG.", "Ø.dwg", "", "b.dxf"];
  paths.push("B.DXF", "b.", "b..", "/b.dwg", "\\b.dwg", "c:b.dwg", "a*b", 'a"b', "x\\M+12345");
  paths.push("x\\m+62345", "a\u0001", "\ue800", "😀", "x".repeat(32000), "x".repeat(32001));
  agree(defs.xref!.properties.path!, xrefPathProblem, paths);
});

test("the files the package ships are the ones the script writes", () => {
  const root = join(import.meta.dirname, "..");
  const version = packageVersion();
  const read = (name: string) => JSON.stringify(JSON.parse(readFileSync(join(root, name), "utf8")));
  const fix = "Run `pnpm standard:files` and commit what it writes";
  assert.equal(read("standard.json"), JSON.stringify(builtInDocument(version)), fix);
  assert.equal(read("standard.schema.json"), JSON.stringify(standardSchema(version)), fix);
  assert.equal(readFileSync(join(root, "src", "version.ts"), "utf8"), versionSource(version), fix);
  assert.equal(VERSION, version);
});
