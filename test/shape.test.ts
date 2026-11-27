import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fromJSON, lint, toJSON } from "../src/index.ts";
import {
  errors,
  full,
  HOLE,
  kinds,
  r12,
  replaced,
  SHARES,
  type Path,
  type Swept,
} from "./shape-sweep.ts";
import { dataOf, wrong } from "./values.ts";

test("the drawings the sweep replaces the values of have nothing for lint to report", () => {
  for (const drawing of [full, r12]) assert.deepEqual(lint(fromJSON(toJSON(drawing))), []);
});

// A share with no file would leave its cases out with nothing said.
test("each share of the sweep has its test file", () => {
  const files = readdirSync(join(import.meta.dirname, "shape-sweep"));
  const expected = Array.from({ length: SHARES }, (_, index) => `share-${index + 1}.test.ts`);
  assert.deepEqual(files.sort(), expected.sort());
});

test("a field nobody knows inside an object is reported, and the rest of the entity still read", () => {
  const hatch = {
    kind: "hatch",
    layer: "0",
    loops: [
      {
        points: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
        foo: 1,
      },
    ],
  };

  const drawing = {
    format: 0,
    units: "in",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    entities: [{ ...hatch, color: 999 }],
  };

  assert.deepEqual(
    lint(wrong(drawing)).map((d) => [d.rule, d.item]),
    [
      ["format", undefined],
      ["entity-color", undefined],
    ],
  );
});

test("a value of the wrong shape is reported in these words, once", () => {
  const cases: [path: Path, value: Swept, expected: string[]][] = [
    [["units"], 1n, ["units: Unknown units: a value of type bigint"]],
    [
      ["xrefs", 0, "name"],
      { toString: 0 },
      [
        "xref: Xref a value of type object: A block's name must be a string",
        `undefined-block: insert #24: Block "BASE" is not defined. The leading CAD app's AUDIT reports an insert of a block the drawing does not have, and that app cannot save the drawing as DXF`,
      ],
    ],
    [
      ["entities", 1],
      HOLE,
      ["format: entities has no item at index 1. An array cannot have empty slots"],
    ],
    [
      ["entities", 1, "points"],
      new Array(200000),
      ["format: entities[1].points has no item at index 0. An array cannot have empty slots"],
    ],
    [["blocks", 1, "base"], "x", ["block: blocks[1].base must be a point, [x, y]"]],
    [
      ["blocks", 1, "attributes", 0, "height"],
      "x",
      ["attribute: blocks[1].attributes[0].height must be a number"],
    ],
    [
      ["textStyles", 0, "obliqueAngle"],
      null,
      ['text-style: Text style "NOTES": obliqueAngle must be a finite number'],
    ],
    [
      ["blocks", 1, "attributes"],
      [{ ...full.blocks[1].attributes[0], height: "x" }, full.blocks[1].attributes[0]],
      [
        "attribute: blocks[1].attributes[0].height must be a number",
        'duplicate-attribute: Block "TREE", attribute "TAG": The block already has an attribute with the tag "TAG". An insert sets an attribute by its tag, and the tag gives the definition its handle: the leading CAD app discards a drawing in which two objects have one handle',
      ],
    ],
    [
      ["entities", 4],
      { ...kinds.text, Scale: [1, 1], weight: 0.25, neight: 1, ltype: "DD", valu: "T" },
      [
        'format: entities[4]: unknown field "Scale"',
        'format: entities[4]: unknown field "weight"',
        'format: entities[4]: unknown field "neight". Did you mean "height"?',
        'format: entities[4]: unknown field "ltype". Did you mean "linetype"?',
        'format: entities[4]: unknown field "valu". Did you mean "value"?',
      ],
    ],
    [
      ["textStyles", 0],
      { ...full.textStyles[0], line: 1 },
      ['text-style: textStyles[0]: unknown field "line"'],
    ],
    [
      ["layers", 1],
      { name: "WALL", color: 1, colour: 1, clor: 1, linetyep: "DD" },
      [
        'format: layers[1]: unknown field "colour". Did you mean "color"?',
        'format: layers[1]: unknown field "clor". Did you mean "color"?',
        'format: layers[1]: unknown field "linetyep". Did you mean "linetype"?',
      ],
    ],
    [
      ["entities", 0],
      { ...kinds.line, lineWeight: 0.25, weight: 0.25, layers: "0", thickness: 2 },
      [
        'format: entities[0]: unknown field "lineWeight". Did you mean "lineweight"?',
        'format: entities[0]: unknown field "weight". Did you mean "lineweight"?',
        'format: entities[0]: unknown field "layers". Did you mean "layer"?',
        'format: entities[0]: unknown field "thickness"',
      ],
    ],
    [
      ["layouts", 0],
      HOLE,
      ["layout: layouts has no item at index 0. An array cannot have empty slots"],
    ],
    [
      ["layouts", 0, "viewports", 0, "ratio"],
      "x",
      ['viewport: viewport #0 of layout "C-101": The ratio must be a finite number'],
    ],
    [
      ["layouts", 0, "entities", 0, "from"],
      5,
      ["format: layouts[0].entities[0].from must be a point, [x, y]"],
    ],
    // A viewport has no scale and no point named `at`, which other objects have: no hint.
    [
      ["layouts", 0, "viewports", 0],
      { ...dataOf(full.layouts[0].viewports[0]), scale: 2, at: [0, 0], centre: [0, 0], widht: 2 },
      [
        'viewport: layouts[0].viewports[0]: unknown field "scale"',
        'viewport: layouts[0].viewports[0]: unknown field "at"',
        'viewport: layouts[0].viewports[0]: unknown field "centre". Did you mean "center"?',
        'viewport: layouts[0].viewports[0]: unknown field "widht". Did you mean "width"?',
      ],
    ],
    [
      ["layouts", 1],
      {
        ...dataOf(full.layouts[1]),
        papr: "ANSI B",
        plotstyle: "acad.ctb",
        viewport: [],
        units: "in",
      },
      [
        'layout: layouts[1]: unknown field "papr". Did you mean "paper"?',
        'layout: layouts[1]: unknown field "plotstyle". Did you mean "plotStyle"?',
        'layout: layouts[1]: unknown field "viewport". Did you mean "viewports"?',
        'layout: layouts[1]: unknown field "units"',
      ],
    ],
  ];

  for (const [path, value, expected] of cases) {
    const found = errors(wrong(replaced(full, path, value)));

    assert.deepEqual(
      found.map((d) => `${d.rule}: ${d.message}`),
      expected,
      path.join("."),
    );
  }
});
