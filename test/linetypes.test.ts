import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDrawing,
  lint,
  parseLinetypes,
  readDXF,
  toDXF,
  toSVG,
  type Drawing,
  type LinetypeDefinition,
} from "../src/index.ts";
import { MARK_GLYPH_NAME, MARKS_ORDER } from "../src/rules.ts";
import { wrong } from "./values.ts";

const WATER: LinetypeDefinition = {
  name: "WATER",
  description: "Water ---- W ----",
  pattern: [0.75, -0.1, -0.1],
  marks: [{ after: 1, text: "W", style: "LT", height: 0.1, offset: [-0.035, -0.05] }],
};

function pipe(length: number, linetypeGeneration?: boolean): Drawing {
  const d = createDrawing({ units: "in" });
  d.textStyle({ name: "LT", font: "Arial" });
  d.linetype(WATER);
  d.polyline(
    [
      [0, 0],
      [length / 2, 0],
      [length / 2, length / 2],
    ],
    false,
    linetypeGeneration === undefined
      ? { linetype: WATER }
      : { linetype: WATER, linetypeGeneration },
  );

  return d.build();
}

const letters = (svg: string): number => (svg.match(/<text[^>]*>W<\/text>/g) ?? []).length;

test("a pipe's letters run on past each vertex only with linetype generation", () => {
  // Sides of 0.9 are shorter than the pattern, 0.95, so each is drawn solid without its letters.
  assert.equal(letters(toSVG(pipe(1.8))), 0);
  assert.equal(letters(toSVG(pipe(1.8, true))), 1);
  // A polyline whose width changes along a side starts the pattern on each side whatever its flag.
  const d = createDrawing({ units: "in" });
  d.textStyle({ name: "LT", font: "Arial" });
  d.linetype(WATER);

  const points = [
    [0, 0],
    [0.9, 0],
    [0.9, 0.9],
  ] as const;

  d.polyline(points, false, {
    linetype: WATER,
    linetypeGeneration: true,
    widths: [
      [0, 0.05],
      [0.05, 0],
    ],
  });
  assert.equal(letters(toSVG(d.build())), 0);
});

test("marks and linetype generation are written and read back", async () => {
  const read = await readDXF(toDXF(pipe(4, true)), { geometry: true });
  const linetype = read.linetypes.find((t) => t.name === "WATER");
  assert.deepEqual(linetype?.marks, [
    { after: 1, offset: [-0.035, -0.05], text: "W", style: "LT", height: 0.1 },
  ]);
  const polyline = read.model.entities?.find((e) => e.kind === "polyline");
  assert.equal(polyline?.kind === "polyline" && polyline.linetypeGeneration, true);
});

test("a mark's rules hold in the type and when the code runs", () => {
  const d = createDrawing({ units: "in" });
  assert.throws(
    () =>
      d.linetype({
        name: "BAD",
        pattern: [1, -0.1],
        // @ts-expect-error orient is relative, absolute or upright
        marks: [{ after: 1, text: "X", height: 0.1, orient: "sideways" }],
      }),
    /orient must be one of/,
  );
  assert.throws(
    () =>
      d.linetype({
        name: "TWICE",
        pattern: [1, -0.1, -0.1],
        marks: [
          { after: 1, text: "X", height: 0.1 },
          { after: 1, text: "Y", height: 0.1 },
        ],
      }),
    new RegExp(MARKS_ORDER),
  );
  // A shape by its name needs its shape file to number it.
  assert.throws(
    () =>
      d.linetype({
        name: "FENCE",
        pattern: [1, -0.1],
        marks: [{ after: 1, glyph: "CIRC1", file: "shapes.shx", scale: 0.1 }],
      }),
    (e: Error) => e.message.includes(MARK_GLYPH_NAME),
  );
});

test("lint finds a mark's text style, and warns of shapes it plots as gaps", () => {
  const drawing: Drawing = {
    format: 0,
    units: "in",
    dxf: "R2018",
    layers: [{ name: "F", color: 7, linetype: "FENCE" }],
    linetypes: [
      {
        name: "FENCE",
        description: "",
        pattern: [1, -0.1, -0.1],
        marks: [
          { after: 1, text: "F", style: "NONE", height: 0.1 },
          { after: 2, glyph: 133, file: "shapes.shx", scale: 0.1 },
        ],
      },
    ],
    entities: [],
  };

  const rules = lint(drawing).map((d) => `${d.rule} ${d.severity}`);
  assert.ok(rules.includes("undefined-text-style error"));
  assert.ok(rules.includes("linetype-shape warning"));
});

test("parseLinetypes reads a linetype file's texts and shapes, each after its length", () => {
  const [gas, fence] = parseLinetypes(
    [
      ";; a firm's linetypes",
      "*GAS,Gas line ---- GAS ----",
      'A,.5,-.2,["G,A;S",STANDARD,S=.1,U=0.0,X=-0.1,Y=-.05],-.25 ; the gas main',
      "*FENCE,Fence ---O---",
      "A,.25,-.1,[CIRC1,shapes.shx,x=-.1,s=.1,r=1.5708r],-.1,1",
    ].join("\r\n"),
  );

  assert.deepEqual(gas, {
    name: "GAS",
    description: "Gas line ---- GAS ----",
    pattern: [0.5, -0.2, -0.25],
    marks: [
      {
        after: 1,
        orient: "upright",
        offset: [-0.1, -0.05],
        text: "G,A;S",
        style: "STANDARD",
        height: 0.1,
      },
    ],
  });
  const glyphMark = fence?.marks?.[0];
  assert.ok(
    glyphMark &&
      "glyph" in glyphMark &&
      glyphMark.glyph === "CIRC1" &&
      glyphMark.file === "shapes.shx",
  );
  assert.ok(Math.abs((glyphMark.rotation ?? 0) - 90) < 1e-3);

  for (const [text, message] of [
    ["A,1,-1", /before any \*NAME/],
    ['*X\nA,["T",S],1', /comes after the length/],
    ['*X\nA,1,["T",S,Q=1]', /not one of S, R, A, U, X and Y/],
    ['*X\nA,1,["T,S', /left open/],
    ["*X", /has no pattern/],
    ["*X\nB,1", /starts with A/],
  ] as const) {
    assert.throws(() => parseLinetypes(text), message);
  }
});

test("a picture skips a linetype that is no object with a name", () => {
  const dashed = { name: "DASH", description: "", pattern: [1, -1] };

  const drawing = (linetypes: NonNullable<Drawing["linetypes"]>): Drawing => ({
    format: 0,
    units: "mm",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    linetypes,
    entities: [{ kind: "line", layer: "0", from: [0, 0], to: [20, 0], linetype: "DASH" }],
  });

  const odd = wrong<NonNullable<Drawing["linetypes"]>>([null, 5, {}, dashed]);

  assert.equal(toSVG(drawing(odd)), toSVG(drawing([dashed])));
});

test("a dashed arc of no radius draws no NaN", () => {
  const svg = toSVG({
    format: 0,
    units: "mm",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    linetypes: [{ name: "DASH", description: "", pattern: [1, -1] }],
    entities: [
      {
        kind: "arc",
        layer: "0",
        center: [5, 5],
        radius: 0,
        startAngle: 0,
        endAngle: 90,
        linetype: "DASH",
      },
    ],
  });

  assert.doesNotMatch(svg, /NaN/);
});
