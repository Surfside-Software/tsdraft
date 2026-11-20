import assert from "node:assert/strict";
import { test } from "node:test";
import {
  arrowheadHandles,
  createDrawing,
  dimensionPicture,
  dimensionPictureHandles,
  dimensionStyleHandle,
  DrawingError,
  FONT_METRICS,
  FONT_METRICS_RANGES,
  FONTS,
  fromJSON,
  inspectText,
  measureText,
  readDXF,
  fromPaper,
  layoutDimensionText,
  idHandle,
  lint,
  toDXF,
  toJSON,
  toSVG,
  type DimensionStyle,
  type Drawing,
  type Entity,
} from "../src/index.ts";
import { angleNumber, arrowRoom, measurementText, WIDEST_CHARACTERS } from "../src/dimensions.ts";
import { toDXFR2018 } from "../src/dxf-r2018.ts";
import { extents } from "../src/extents.ts";

const rule = (name: string) => (thrown: unknown) =>
  thrown instanceof DrawingError && thrown.diagnostics[0]?.rule === name;

/** Sizes in drawing units, so that a picture's numbers are easy to read. */
const sizes = {
  textHeight: 1,
  arrowSize: 1,
  extensionOffset: 0.5,
  extensionBeyond: 1,
  textGap: 0.5,
  precision: 2,
} as const;
const arrows: DimensionStyle = { name: "ARROWS", ...sizes };
const ticks: DimensionStyle = { name: "TICKS", ...sizes, arrowhead: "architectural-tick" };

/** A drawing with a style of each arrowhead, and what `draw` draws. */
function drawing(draw?: (d: ReturnType<typeof createDrawing>) => void): Drawing {
  const d = createDrawing({ units: "ft" });
  d.textStyle({ name: "NOTES", font: "Arial" });
  d.dimensionStyle({ ...sizes, name: "ARROWS" });
  d.dimensionStyle({ ...sizes, name: "TICKS", arrowhead: "architectural-tick" });
  draw?.(d);
  return d.build();
}

const rules = (value: Drawing): string[] => lint(value).map((d) => d.rule);

/** Each record of a DXF whose group 0 is `type`, as its codes and values from the next line on. */
function records(dxf: string, type: string): string[][] {
  const lines = dxf.split("\r\n");
  const found: string[][] = [];
  for (let i = 1; i < lines.length; i += 2) {
    if (lines[i - 1]!.trim() !== "0" || lines[i] !== type) continue;
    let end = i + 1;
    while (end < lines.length && lines[end]!.trim() !== "0") end += 2;
    found.push(lines.slice(i + 1, end));
  }
  return found;
}

/** The first value of a group in a record `records` gave. */
function value(record: string[], code: number): string | undefined {
  const at = record.findIndex((line, i) => i % 2 === 0 && Number(line) === code);
  return at < 0 ? undefined : record[at + 1];
}
const near = (got: readonly number[], want: readonly number[]): void => {
  assert.equal(got.length, want.length);
  got.forEach((value, i) => assert.ok(Math.abs(value - want[i]!) < 5e-7, `${got} is not ${want}`));
};

test("a measurement is written as the leading CAD app writes it: half up, with a little given to a length just under the half", () => {
  const at = (precision: number, more: Partial<DimensionStyle> = {}) => ({ precision, ...more });
  const feet = (precision: number, more: Partial<DimensionStyle> = {}) =>
    at(precision, { units: "architectural", ...more });
  // The length times the measurement scale, rounded half up to the precision, with the zeros
  // the style leaves out, between its prefix and its suffix.
  const strings: [length: number, style: ReturnType<typeof at>, text: string][] = [
    [52, at(1), "52.0"],
    [0.04, at(1), "0.0"],
    [0.05, at(1), "0.1"],
    [9.95, at(1), "10.0"],
    [52.15, at(1), "52.2"],
    [0.25, at(1), "0.3"],
    [1234.5678, at(1), "1234.6"],
    [1.005, at(2), "1.01"],
    [2.675, at(2), "2.68"],
    [0.5, at(0), "1"],
    [0.4, at(0), "0"],
    [2.5, at(0), "3"],
    [0.000000005, at(8), "0.00000001"],
    [1234567.125, at(7), "1234567.1250000"],
    // A tie a computer holds as a little less is taken as the tie at every size.
    [1234567.15, at(1), "1234567.2"],
    [2500000.15, at(1), "2500000.2"],
    [5000000.05, at(1), "5000000.1"],
    [12345678.125, at(2), "12345678.13"],
    // A length a ten-billionth of itself under the half is taken as on it, and one further is not.
    [0.05 - 4.4e-12, at(1), "0.1"],
    [0.05 - 5.6e-12, at(1), "0.0"],
    [52.15 - 8e-11, at(1), "52.2"],
    [52.15 - 1.02e-10, at(1), "52.1"],
    // From 1 up, the allowance grows by one and a half units in the 16th significant digit:
    // 17 units in the last place under 123456.5 is taken as on it and 32 is not, and 1 unit
    // under 7654321.5 is and 4 are not.
    [123456.5 - 17 * 2 ** -36, at(0), "123457"],
    [123456.5 - 32 * 2 ** -36, at(0), "123456"],
    [7654321.5 - 2 ** -30, at(0), "7654322"],
    [7654321.5 - 4 * 2 ** -30, at(0), "7654321"],
    [0.5, at(2, { suppressZeros: "leading" }), ".50"],
    [0.000001, at(1, { suppressZeros: "leading" }), ".0"],
    [52, at(2, { suppressZeros: "trailing" }), "52"],
    [52.5, at(2, { suppressZeros: "trailing" }), "52.5"],
    [0.5, at(2, { suppressZeros: "both" }), ".5"],
    [0.0004, at(2, { suppressZeros: "both" }), "0"],
    [52.04, at(1, { measurementScale: 12 }), "624.5"],
    [0.25, at(4, { measurementScale: 0.001 }), "0.0003"],
    [52, at(1, { suffix: "'" }), "52.0'"],
    [52, at(1, { prefix: "L=", suffix: " ft" }), "L=52.0 ft"],
    // Architectural units: feet, a hyphen, inches and the fraction in lowest terms, rounded to
    // the least fraction of the precision, half up.
    [49.4375, feet(4), `4'-1 7/16"`],
    [49.40625, feet(4), `4'-1 7/16"`],
    [42, feet(4), `3'-6"`],
    [47.97, feet(4), `4'-0"`],
    [11.99, feet(4), `1'-0"`],
    [6, feet(4), `6"`],
    [0.5, feet(4), `1/2"`],
    [48.5, feet(4), `4'-0 1/2"`],
    [1200.5, feet(4), `100'-0 1/2"`],
    [49.4375, feet(0), `4'-1"`],
    [0.25, feet(1), `1/2"`],
    [4.125, feet(8), `4 1/8"`],
    // A drawing in feet writes inches with a measurement scale of 12.
    [4.12, feet(4, { measurementScale: 12 }), `4'-1 7/16"`],
    [48, feet(4, { feetInchZeros: "feet" }), `4'`],
    [6, feet(4, { feetInchZeros: "feet" }), `0'-6"`],
    [0.5, feet(4, { feetInchZeros: "both" }), `0'-0 1/2"`],
    [48, feet(4, { feetInchZeros: "neither" }), `4'`],
    [6, feet(4, { feetInchZeros: "neither" }), `6"`],
    [42, feet(4, { prefix: "(", suffix: ")" }), `(3'-6")`],
  ];
  for (const [length, style, text] of strings) {
    assert.equal(measurementText(length, style), text, `${length} at ${JSON.stringify(style)}`);
  }
  // The style the leading CAD app measures with: architectural units, the fraction on the line, and
  // the zeros of feet and inches. The dimension holds no text of its own.
  const architectural = createDrawing({ units: "in" })
    .dimensionStyle({ name: "ARCH", ...sizes, units: "architectural", precision: 4 })
    .linearDimension([0, 0], [49.4375, 0], [0, 5], { style: "ARCH" })
    .build();
  const dxf = toDXF(architectural);
  const arch = records(dxf, "DIMSTYLE").find((r) => value(r, 2) === "ARCH")!;
  assert.deepEqual(
    [277, 276, 78, 271].map((code) => value(arch, code)?.trim()),
    ["4", "2", "3", "4"],
  );
  assert.equal(value(records(dxf, "DIMENSION")[0]!, 1), undefined);
  assert.equal(
    value(records(dxf, "MTEXT")[0]!, 1),
    `\\A1;4'-1 7/16"`,
    "the picture writes what the leading CAD app draws",
  );
  // A dimension's own text takes the measurement at its first `<>`, and at no other.
  assert.equal(measurementText(42, feet(4), "<> CLR"), `3'-6" CLR`);
  assert.equal(measurementText(52, at(1, { suffix: "'" }), "<> TYP"), "52.0' TYP");
  assert.equal(measurementText(52, at(1), "<><>"), "52.0<>");
  assert.equal(measurementText(52, at(1), "VARIES"), "VARIES");
});

test("a dimension is drawn where the leading CAD app draws it", () => {
  // Along X, 10 long, with its dimension line 4 above: each extension line starts the offset
  // from its point and runs the length past the dimension line, and the text sits one gap above
  // the middle of the line.
  const along = dimensionPicture(
    {
      kind: "linear-dimension",
      layer: "0",
      style: "ARROWS",
      from: [0, 0],
      to: [10, 0],
      line: [3, 4],
    },
    arrows,
  );
  assert.equal(along.measurement, 10);
  assert.deepEqual(along.definitionPoint, [10, 4]);
  assert.deepEqual(along.extensionLines, [
    [
      [0, 0.5],
      [0, 5],
    ],
    [
      [10, 0.5],
      [10, 5],
    ],
  ]);
  assert.deepEqual(along.dimensionLine, [
    [1, 4],
    [9, 4],
  ]);
  near(along.arrowheads.flat(2), [
    0,
    4,
    1,
    4 + 1 / 6,
    1,
    4 - 1 / 6,
    10,
    4,
    9,
    4 + 1 / 6,
    9,
    4 - 1 / 6,
  ]);
  assert.deepEqual(along.label, {
    value: "10.00",
    at: [5, 4.5],
    height: 1,
    rotation: 0,
    direction: [1, 0],
  });

  // A tick's dimension line runs one arrow size past each extension line.
  const ticked = dimensionPicture(
    {
      kind: "linear-dimension",
      layer: "0",
      style: "TICKS",
      from: [0, 0],
      to: [10, 0],
      line: [0, 4],
    },
    ticks,
  );
  assert.deepEqual(ticked.dimensionLine, [
    [-1, 4],
    [11, 4],
  ]);
  // Its stroke runs from one corner of a square of the arrow size to the other, 0.15 wide.
  const [first] = ticked.arrowheads;
  near([(first![0]![0] + first![3]![0]) / 2, (first![0]![1] + first![3]![1]) / 2], [-0.5, 3.5]);
  near([(first![1]![0] + first![2]![0]) / 2, (first![1]![1] + first![2]![1]) / 2], [0.5, 4.5]);
  near([Math.hypot(first![0]![0] - first![3]![0], first![0]![1] - first![3]![1])], [0.15]);

  // At 30 degrees, with paper sizes and a scale of 10: the leading CAD app's own numbers.
  const turned = dimensionPicture(
    {
      kind: "linear-dimension",
      layer: "0",
      style: "T",
      from: [0, 0],
      to: [30, 40],
      line: [-10, 30],
      angle: 30,
    },
    {
      name: "T",
      textHeight: 3 / 32,
      arrowhead: "architectural-tick",
      arrowSize: 1 / 16,
      extensionOffset: 1 / 16,
      extensionBeyond: 1 / 16,
      textGap: 1 / 16,
      scale: 10,
      precision: 1,
      suffix: "'",
    },
  );
  near(turned.definitionPoint, [24.330127, 49.820508]);
  near(
    turned.extensionLines.flat(2),
    [-0.3125, 0.541266, -15.802881, 27.371393, 29.6875, 40.541266, 24.017627, 50.361774],
  );
  near(turned.dimensionLine.flat(), [-16.031647, 26.517627, 24.871393, 50.133008]);
  assert.equal(turned.label.value, "46.0'");
  assert.equal(turned.label.rotation, 30);
});

test("the text of a dimension reads from below or from the right, above its line as it reads", () => {
  const picture = (angle: number) =>
    dimensionPicture(
      {
        kind: "linear-dimension",
        layer: "0",
        style: "ARROWS",
        from: [0, 0],
        to: [10 * Math.cos((angle * Math.PI) / 180), 10 * Math.sin((angle * Math.PI) / 180)],
        line: [0, 0],
        angle,
      },
      arrows,
    ).label;
  // The angle the leading CAD app turned the text by, for each angle a dimension measured along.
  for (const [angle, reads] of [
    [0, 0],
    [89, 89],
    [90, 90],
    [91, -89],
    [180, 0],
    [269, 89],
    [270, 90],
    [271, -89],
    [330, -30],
  ] as const) {
    assert.equal(picture(angle).rotation, reads, `along ${angle}`);
  }
  near(picture(90).at, [-0.5, 5]);
  near(picture(270).at, [-0.5, -5]);
  // An aligned dimension stands off to the left of the way from its first point to its second.
  const aligned = dimensionPicture(
    {
      kind: "aligned-dimension",
      layer: "0",
      style: "ARROWS",
      from: [0, 0],
      to: [30, 40],
      offset: 17,
    },
    arrows,
  );
  near(aligned.definitionPoint, [16.4, 50.2]);
  assert.equal(aligned.measurement, 50);
});

// Each `@ts-expect-error` proves the compiler rejects the literal, and the `assert.throws`
// around it that the same mistake is caught when the code runs.
test("a dimension style is checked as literals and when the code runs", () => {
  const d = createDrawing({ units: "ft" });
  const style = { name: "S", ...sizes } as const;
  // @ts-expect-error: the leading CAD app discards a drawing over such a name.
  assert.throws(() => d.dimensionStyle({ ...style, name: "A/B" }), /cannot contain/);
  // @ts-expect-error: the leading CAD app keeps its own Standard and skips a second.
  assert.throws(() => d.dimensionStyle({ ...style, name: "standard" }), /cannot be defined/);
  assert.throws(() => d.dimensionStyle({ ...style, name: "a".repeat(256) }), /DIMSTYLE command/);
  // @ts-expect-error: AUDIT reports a text height of 0.
  assert.throws(() => d.dimensionStyle({ ...style, textHeight: 0 }), /greater than 0/);
  // @ts-expect-error: AUDIT reports a negative arrow size.
  assert.throws(() => d.dimensionStyle({ ...style, arrowSize: -1 }), /less than 0/);
  // @ts-expect-error: and a negative offset.
  assert.throws(() => d.dimensionStyle({ ...style, extensionOffset: -0.1 }), /less than 0/);
  // @ts-expect-error: and a negative length past the dimension line.
  assert.throws(() => d.dimensionStyle({ ...style, extensionBeyond: -0.1 }), /less than 0/);
  // @ts-expect-error: the leading CAD app draws a box around the text for a negative gap.
  assert.throws(() => d.dimensionStyle({ ...style, textGap: -0.1 }), /box around the text/);
  // @ts-expect-error: the leading CAD app works a scale of 0 out for itself.
  assert.throws(() => d.dimensionStyle({ ...style, scale: 0 }), /works out from a viewport/);
  // @ts-expect-error: AUDIT reports a measurement scale of 0.
  assert.throws(() => d.dimensionStyle({ ...style, measurementScale: 0 }), /measurement scale/);
  // @ts-expect-error: a negative one is for layouts alone.
  assert.throws(() => d.dimensionStyle({ ...style, measurementScale: -2 }), /only to a dimension/);
  // @ts-expect-error: AUDIT reports a precision of 9.
  assert.throws(() => d.dimensionStyle({ ...style, precision: 9 }), /from 0 to 8/);
  // @ts-expect-error: or one that is no whole number.
  assert.throws(() => d.dimensionStyle({ ...style, precision: 1.5 }), /from 0 to 8/);
  // @ts-expect-error: the arrowheads are a closed list.
  assert.throws(() => d.dimensionStyle({ ...style, arrowhead: "dot" }), /one of ARROWHEADS/);
  // @ts-expect-error: the leading CAD app reads a backslash as formatting.
  assert.throws(() => d.dimensionStyle({ ...style, suffix: "\\P" }), /formatting/);
  // @ts-expect-error: and braces.
  assert.throws(() => d.dimensionStyle({ ...style, prefix: "{" }), /formatting/);
  // @ts-expect-error: the leading CAD app puts the measurement at the first <>.
  assert.throws(() => d.dimensionStyle({ ...style, prefix: "a<>" }), /place of the measurement/);
  assert.throws(
    // @ts-expect-error: the zeros to leave out are a closed list.
    () => d.dimensionStyle({ ...style, suppressZeros: "all" }),
    /"leading", "trailing" or "both"/,
  );
  // @ts-expect-error: the units are a closed list.
  assert.throws(() => d.dimensionStyle({ ...style, units: "metric" }), /"decimal" or/);
  assert.throws(
    // @ts-expect-error: and the zeros of feet and inches.
    () => d.dimensionStyle({ ...style, units: "architectural", feetInchZeros: "all" }),
    /"inches", "feet", "both" or "neither"/,
  );
  // Each kind of units has its own zeros.
  assert.throws(
    // @ts-expect-error: a style in feet and inches leaves out no zeros of a decimal.
    () => d.dimensionStyle({ ...style, units: "architectural", suppressZeros: "leading" }),
    /feetInchZeros for one in "architectural" units/,
  );
  // @ts-expect-error: and a style in decimal units writes no zeros of feet and inches.
  assert.throws(() => d.dimensionStyle({ ...style, feetInchZeros: "both" }), /suppressZeros is/);
  assert.throws(
    () => d.dimensionStyle({ ...style, textStyle: "NOPE" }),
    rule("undefined-text-style"),
  );
  // Sizes of 0 are the leading CAD app's to draw: no arrowhead, and lines that touch.
  d.dimensionStyle({ ...style, arrowSize: 0, extensionOffset: 0, extensionBeyond: 0, textGap: 0 });
  assert.throws(() => d.dimensionStyle(style), rule("duplicate-dimension-style"));
  assert.throws(() => d.dimensionStyle({ ...style, name: "s" }), /keeps the first/);
  d.dimensionStyle({ ...style, name: "strasse" });
  assert.throws(() => d.dimensionStyle({ ...style, name: "straße" }), /duplicate name/);

  const r12 = createDrawing({ dxf: "R12" });
  // @ts-expect-error: R12 drawings have no dimensions.
  assert.throws(() => r12.dimensionStyle(style), /no dimensions to R12/);
  assert.throws(
    // @ts-expect-error: nor a dimension.
    () => r12.linearDimension([0, 0], [1, 0], [0, 1], { style: "S" }),
    /no dimensions to R12/,
  );
});

test("a dimension is checked when it is drawn, and lint finds the same in a drawing built by hand", () => {
  const made = drawing((d) => {
    const from = [0, 0] as const;
    const draw = (options: object) =>
      d.linearDimension(from, [20, 0], [0, 5], options as { style: "TICKS" });
    assert.throws(() => draw({ style: "NOPE" }), rule("undefined-dimension-style"));
    // @ts-expect-error: tsdraft draws no dimension in the leading CAD app's own style.
    assert.throws(() => d.linearDimension(from, [20, 0], [0, 5], { style: "Standard" }), /own/);
    assert.throws(() => draw({}), /must be a string/);
    assert.throws(
      // @ts-expect-error: the leading CAD app draws a dimension whose text is a space with no text.
      () => d.linearDimension(from, [20, 0], [0, 5], { style: "TICKS", text: " " }),
      /empty or all spaces/,
    );
    assert.throws(
      // @ts-expect-error: the leading CAD app reads a backslash as formatting.
      () => d.linearDimension(from, [20, 0], [0, 5], { style: "TICKS", text: "A\\PB" }),
      /formatting/,
    );
    assert.throws(() => draw({ style: "TICKS", text: "<> []" }), /alternate units/);
    assert.throws(() => draw({ style: "TICKS", along: "z" }), /"x", "y" or an angle/);
    assert.throws(() => draw({ style: "TICKS", along: 1e20 }), /from -360 to 360 degrees/);
    assert.throws(() => draw({ style: "TICKS", along: 360.5 }), /from -360 to 360 degrees/);
    // Two points that are as far along the direction measured, and two that are one point.
    assert.throws(
      () => d.linearDimension(from, [0, 20], [0, 5], { style: "TICKS" }),
      /measures nothing/,
    );
    assert.throws(
      () => d.alignedDimension(from, [0.0000001, 0], 5, { style: "TICKS" }),
      /has no length/,
    );
    assert.throws(
      () => d.linearDimension(from, [2e8, 0], [0, 5], { style: "TICKS" }),
      /16 digits of a measurement/,
    );
    // 15 digits at the style's precision, and no more: the leading CAD app works the 16th out itself.
    d.dimensionStyle({ ...sizes, name: "EIGHT", arrowhead: "architectural-tick", precision: 8 });
    assert.throws(
      () => d.linearDimension(from, [12345678, 0], [0, 5], { style: "EIGHT" }),
      /16 digits at a precision of 8/,
    );
    d.linearDimension(from, [1234567, 0], [0, 5], { style: "EIGHT" });
    // Closed filled arrowheads need room for the text, whatever its font: four characters of a
    // measurement, at most 1.1 high each, and a gap on each side. A tick is drawn the same
    // either way.
    assert.throws(
      () => d.linearDimension(from, [5.4, 0], [0, 5], { style: "ARROWS" }),
      /may not fit between its extension lines: it measures 5.4.*may need 5.4/,
    );
    d.linearDimension(from, [5.5, 0], [0, 5], { style: "ARROWS", id: "fits" });
    d.linearDimension(from, [0.5, 0], [0, 5], { style: "ticks" });
    assert.throws(
      () => d.block("B", {}, () => d.linearDimension(from, [20, 0], [0, 5], { style: "TICKS" })),
      /cannot be in a block/,
    );
    // A call that throws leaves the builder as it was: the id and the block's name are free.
    assert.throws(
      () => d.linearDimension(from, [0, 20], [0, 5], { style: "TICKS", id: "again" }),
      /measures nothing/,
    );
    d.alignedDimension(from, [20, 0], -5, { style: "TICKS", id: "again", text: "<> TYP" });
    d.block("B", {}, () => d.line([0, 0], [1, 0]));
    // @ts-expect-error: the leading CAD app draws the architectural tick with the block of this name.
    assert.throws(() => d.block("_archtick", {}, () => {}), /ticks of a dimension/);
  });
  assert.deepEqual(lint(made), []);
  assert.deepEqual(lint(fromJSON(toJSON(made))), []);

  const fits = made.entities.find((e) => e.id === "fits") as Entity & { kind: "linear-dimension" };
  const withEntities = (...entities: unknown[]): Drawing =>
    ({ ...made, entities }) as unknown as Drawing;
  assert.deepEqual(rules(withEntities({ ...fits, style: "NOPE" })), ["undefined-dimension-style"]);
  assert.deepEqual(rules(withEntities({ ...fits, style: null })), ["undefined-dimension-style"]);
  assert.deepEqual(rules(withEntities({ ...fits, to: [5.4, 0] })), ["dimension"]);
  assert.deepEqual(rules(withEntities({ ...fits, angle: 400 })), ["dimension"]);
  assert.deepEqual(rules(withEntities({ ...fits, to: [0, 0] })), ["dimension"]);
  assert.deepEqual(rules(withEntities({ ...fits, text: "  " })), ["dimension"]);
  assert.deepEqual(rules(withEntities({ ...fits, text: 5 })), ["dimension"]);
  assert.deepEqual(rules(withEntities({ ...fits, angle: Infinity })), ["geometry"]);
  assert.deepEqual(rules(withEntities({ ...fits, style: "TICKS", text: "%%c<>" })), ["text"]);
  assert.deepEqual(
    rules({ ...made, blocks: [{ name: "B", entities: [{ ...fits, id: "in-block" }] }] }),
    ["dimension"],
  );
  assert.deepEqual(rules({ ...made, dxf: "R12", textStyles: [], blocks: [] }), [
    "dimension-style",
    "dimension-style",
    "dimension-style",
    "dimension",
    "dimension",
    "dimension",
    "dimension",
  ]);
  const withStyles = (...dimensionStyles: unknown[]): Drawing =>
    ({ ...made, entities: [], dimensionStyles }) as unknown as Drawing;
  assert.deepEqual(rules(withStyles({ ...arrows, textHeight: -1 })), ["dimension-style"]);
  assert.deepEqual(rules(withStyles({ ...arrows, precision: null })), ["dimension-style"]);
  assert.deepEqual(rules(withStyles({ ...arrows, textStyle: "NOPE" })), ["undefined-text-style"]);
  assert.deepEqual(rules(withStyles(arrows, { ...arrows, name: "arrows" })), [
    "duplicate-dimension-style",
  ]);
  assert.deepEqual(rules(withStyles({ ...arrows, suffix: "%%d" })), ["text"]);
});

test("closed arrowheads need room for the widest the text can be, and for the lean of a slanted style", () => {
  const view = { ratio: 120, units: "ft" } as const;
  const d = createDrawing({ units: "ft" });
  d.textStyle({ name: "NOTES", font: "Arial" });
  d.textStyle({ name: "LEANING", font: "Arial", obliqueAngle: 85 });
  const plan = {
    textHeight: 3 / 32,
    arrowSize: 1 / 8,
    extensionOffset: 1 / 16,
    extensionBeyond: 1 / 8,
    textGap: 1 / 16,
    scale: fromPaper(1, "in", view),
  };
  d.dimensionStyle({ ...plan, name: "PLAN", textStyle: "NOTES", precision: 1, suffix: "'" });
  d.dimensionStyle({ ...plan, name: "LEAN", textStyle: "LEANING", precision: 0 });
  // "6.0'" at 1" = 10': four characters of a measurement, 1.1 of the height each at most.
  d.linearDimension([0, 0], [6, 0], [0, -5], { style: "PLAN" });
  assert.throws(
    () => d.linearDimension([0, 10], [3.75, 10], [0, 5], { style: "PLAN" }),
    /may not fit/,
  );
  // One character at 85 degrees leans 11.4 times the height: past the room upright text needs.
  d.dimensionStyle({ ...plan, name: "UPRIGHT", textStyle: "NOTES", precision: 0 });
  d.linearDimension([0, 20], [5, 20], [0, 15], { style: "UPRIGHT" });
  assert.throws(
    () => d.linearDimension([0, 30], [5, 30], [0, 25], { style: "LEAN" }),
    /may not fit/,
  );
  d.linearDimension([0, 40], [15, 40], [0, 35], { style: "LEAN" });
  assert.deepEqual(lint(d.build()), []);
});

test("closed arrowheads need room for the wider text, and a stacked fraction for its longer part", () => {
  const d = createDrawing({ units: "in" });
  const stacked = {
    textHeight: 3 / 32,
    arrowSize: 1 / 8,
    extensionOffset: 1 / 16,
    extensionBeyond: 1 / 8,
    textGap: 1 / 16,
    scale: 12,
    units: "architectural",
    precision: 4,
    fraction: "stacked",
  } as const;
  d.dimensionStyle({ ...stacked, name: "STACKED" });
  d.linearDimension([0, 0], [7.4375, 0], [0, 5], { style: "STACKED" });
  assert.throws(
    () => d.linearDimension([0, 10], [6.4375, 10], [0, 15], { style: "STACKED" }),
    /its text, "6 7\/16\\"", and its arrowheads may need 6\.45\b/,
  );
  assert.throws(
    () =>
      d.linearDimension([0, 20], [7.4375, 20], [0, 25], { style: "STACKED", textBelow: "TO STUD" }),
    /its text, "TO STUD"/,
  );
  // A text centered in the line breaks it, and needs the arrowheads' room as well as its own.
  d.dimensionStyle({ ...stacked, name: "CENTERED", textPlacement: "centered" });
  d.linearDimension([0, 30], [6.5, 30], [0, 35], { style: "STACKED" });
  assert.throws(
    () => d.linearDimension([0, 40], [6.5, 40], [0, 45], { style: "CENTERED" }),
    /may need 8\.2125\b/,
  );
  // A narrow font does not narrow a diagonal stack's gap, so the room is the text as laid out too.
  d.textStyle({ name: "NARROW", font: "Courier New", widthFactor: 0.15 });
  d.dimensionStyle({
    ...stacked,
    name: "NARROW",
    textStyle: "NARROW",
    textHeight: 1,
    scale: 1,
    measurementScale: 0.7,
    feetInchZeros: "neither",
    fraction: "diagonal",
    textPlacement: "centered",
  });
  assert.throws(
    () => d.linearDimension([0, 50], [1.06, 50], [0, 52], { style: "NARROW" }),
    /its text, "3\/4\\"", and its arrowheads may need 1\.065897/,
  );
});

test("a dimension's stack is lowered until its bar or its slash's middle is half a height up, never raised", () => {
  // As the leading CAD app plots `\\A1;` before a stack: sheet dimension-looks of cad-plots.ts.
  const laid = (stack: string, size: number, font: "Arial" | "Times New Roman" = "Arial") => {
    const value = `\\A1;4{\\H${size}x;\\S${stack};}`;
    const { lines, strokes } = layoutDimensionText({ value, height: 1, font, at: [0, 0] });
    const { from, to } = strokes[0]!;
    const { baseline, runs } = lines[0]!;
    return { middle: (from[1] + to[1]) / 2 - baseline, below: runs.at(-1)!.baseline - baseline };
  };
  assert.ok(Math.abs(laid("1/2", 1).middle - 0.5) < 1e-9);
  assert.ok(Math.abs(laid("1#2", 1).middle - 0.5) < 1e-9);
  // A small one whose slash's middle is lower stays on the line (case STACK-100.03125-1-0.5-TR).
  assert.ok(laid("1#32", 0.5, "Times New Roman").middle < 0.5);
  assert.equal(laid("1#32", 0.5, "Times New Roman").below, 0);
});

test("every number a dimension draws is under 1e100, and its angle is less than a turn either way", () => {
  const d = createDrawing({ units: "ft" });
  const tick = { ...sizes, arrowhead: "architectural-tick" } as const;
  // Each size times the scale is drawn, and must be under 1e100 as a coordinate must.
  assert.throws(
    () => d.dimensionStyle({ ...tick, name: "HUGE", textHeight: 1e99, scale: 1e99 }),
    /textHeight: times the scale it is 9\.9+e\+197.*under 1e100/,
  );
  const huge = { ...ticks, name: "HUGE", textHeight: 1e99, scale: 1e99 };
  assert.deepEqual(
    lint({ ...drawing(), dimensionStyles: [huge] }).map((x) => x.rule),
    ["dimension-style"],
  );
  d.dimensionStyle({ ...tick, name: "TICKS" });
  // A dimension line far off its points.
  assert.throws(
    () => d.alignedDimension([0, 9e99], [1, 9e99], 9e99, { style: "TICKS" }),
    /under 1e100/,
  );
  // Two angles a turn apart are one angle, kept as the one less than a turn.
  d.linearDimension([0, 0], [3, 4], [0, 9], { style: "TICKS", along: -90, id: "down" });
  d.linearDimension([0, 0], [3, 4], [0, 9], { style: "TICKS", along: 270, id: "around" });
  const [down, around] = d.build().entities as (Entity & { kind: "linear-dimension" })[];
  assert.deepEqual([down!.angle, around!.angle], [270, 270]);
  const ticksStyle = d.build().dimensionStyles![0]!;
  const picture = (angle: number) => dimensionPicture({ ...down!, angle }, ticksStyle);
  assert.deepEqual(picture(-90), picture(270));
  assert.equal(picture(-90).label.rotation, 90);
  const dxf = toDXF(d.build());
  assert.deepEqual(
    records(dxf, "DIMENSION").map((r) => value(r, 50)),
    ["270", "270"],
  );
});

test("the limits on digits look at the number as it is written", () => {
  const tick = { ...sizes, arrowhead: "architectural-tick" } as const;
  const d = createDrawing({ units: "ft" });
  d.dimensionStyle({ ...tick, name: "EIGHT", precision: 8 });
  d.dimensionStyle({ ...tick, name: "MILLI", precision: 7, measurementScale: 0.001 });
  // 9,999,999.9999999982 rounds up to 16 digits at a precision of 8, and 99,999,999.99999998
  // rounds up to 100,000,000 at a precision of 7.
  assert.throws(
    () => d.alignedDimension([0, 0], [9999999.999999, 4.468136], 5, { style: "EIGHT" }),
    /it reads 10000000\.00000000, which is 16 digits/,
  );
  assert.throws(
    () => d.linearDimension([0, 0], [99999999999.99998, 0], [0, 5], { style: "MILLI" }),
    /it reads 100000000\.0000000, and the leading CAD app writes 16 digits/,
  );
  d.alignedDimension([0, 0], [9999999.99999, 0], 5, { style: "EIGHT" });
  const built = d.build();
  const by = (style: string, to: readonly [number, number]): Drawing => ({
    ...built,
    entities: [{ kind: "aligned-dimension", layer: "0", style, from: [0, 0], to, offset: 5 }],
  });
  assert.deepEqual(rules(by("EIGHT", [9999999.999999, 4.468136])), ["dimension"]);
  assert.deepEqual(rules(by("MILLI", [99999999999.99998, 0])), ["dimension"]);
});

test("no size of a dimension's picture is written as 0", () => {
  const tick = { ...sizes, arrowhead: "architectural-tick" } as const;
  const d = createDrawing({ units: "ft" });
  // A text height or an arrow size that the scale makes smaller than the 6 decimals written.
  const tiny = { ...tick, name: "TINY", textHeight: 0.001, scale: 0.0001 };
  assert.throws(() => d.dimensionStyle(tiny), /textHeight: .*written as 0/);
  assert.throws(
    () => d.dimensionStyle({ ...tiny, textHeight: 1, arrowSize: 0.001 }),
    /arrowSize: .*written as 0/,
  );
  d.dimensionStyle({ ...tiny, textHeight: 10, arrowSize: 0 });
  assert.deepEqual(
    lint({ ...drawing(), dimensionStyles: [tiny] }).map((x) => x.rule),
    ["dimension-style"],
  );
});

test("an id with the handle of a picture is refused, by the builder and by lint", () => {
  // Found by hashing the picture keys of 10^8 dimensions with ids and searching ids against
  // them: the id q28229819 has the handle of the second arrowhead of the picture of the
  // dimension with the id p10162956. The builder's branch for an id with a handle of its own
  // dimension's picture has no test: no such id is known, and a search would need the hash to
  // meet itself, about nine chances in 2^52 for each id tried.
  const handle = dimensionPictureHandles({ id: "p10162956", index: 0 }).arrowheads[1];
  assert.equal(handle, "1D1C0933FD693E");
  assert.equal(idHandle("q28229819"), handle);
  const picture = drawing((d) => {
    d.linearDimension([0, 0], [10, 0], [0, 5], { style: "TICKS", id: "p10162956" });
    assert.throws(() => d.line([0, 0], [1, 0], { id: "q28229819" }), rule("id-handle"));
  });
  drawing((d) => {
    d.line([0, 0], [1, 0], { id: "q28229819" });
    assert.throws(
      () => d.linearDimension([0, 0], [10, 0], [0, 5], { style: "TICKS", id: "p10162956" }),
      /the picture of the dimension "p10162956" .*the id "q28229819"/,
    );
  });
  const both = {
    ...picture,
    entities: [
      { kind: "line", layer: "0", from: [0, 0], to: [1, 0], id: "q28229819" },
      ...picture.entities,
    ],
  } as Drawing;
  assert.deepEqual(rules(both), ["id-handle"]);
  assert.match(lint(both)[0]!.message, /picture of the dimension "p10162956"/);
});

test("the room for a closed arrow's text holds the text as measureText measures it, in every font", () => {
  const codes = FONT_METRICS_RANGES.flatMap(([from, to]) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i),
  );
  /** The widest a character is laid out in any font: its advance, and what its ink adds. */
  const widest = (code: number): number =>
    Math.max(
      ...Object.values(FONT_METRICS).map((m) => {
        const i = codes.indexOf(code);
        return m.advances[i]! + Math.max(0, m.tails[i]!) + Math.max(0, -m.heads[i]!);
      }),
    );
  for (const [character, width] of Object.entries(WIDEST_CHARACTERS)) {
    const measured = widest(character.charCodeAt(0));
    assert.ok(
      width >= measured && width < measured + 0.001,
      `${character}: ${width} for ${measured}`,
    );
  }
  // Every other character is given 2, which no character of any font reaches.
  assert.ok(codes.every((code) => widest(code) < 2));
  // So a text the room holds never measures longer than it, upright or leaned.
  const style: DimensionStyle = { ...arrows, arrowSize: 0.000001, textGap: 0 };
  for (const font of Object.keys(FONTS)) {
    for (const obliqueAngle of [0, 30, -85]) {
      for (const value of ["0.5", "123.4'", '-9.9"', "10 000.25"]) {
        const xs = measureText({ value, height: 1, font, obliqueAngle }).corners.map((c) => c[0]);
        const room = arrowRoom(style, value, { name: "T", font, obliqueAngle })!;
        assert.ok(Math.max(...xs) - Math.min(...xs) <= room + 1e-9, `${value} in ${font}`);
      }
    }
  }
});

test("inspectText takes a dimension's text for a text, where its picture puts it", () => {
  const made = drawing((d) => {
    d.layer("DIMS", { color: 1 }, () => {
      d.linearDimension([0, 0], [52, 0], [0, -10], { style: "TICKS", id: "width" });
    });
    // A note over the text of the dimension, which is centered above its line at 26, -9.5.
    d.text([26, -9], "OVER", { height: 1, align: "center" });
  });
  const warnings = inspectText(made);
  assert.deepEqual(
    warnings.map((w) => [w.rule, w.entity, w.other?.entity]),
    [["text-overlaps-text", 1, 0]],
  );
  assert.deepEqual(inspectText({ ...made, entities: made.entities.slice(0, 1) }), []);
  // Of two styles with one name, the text is boxed with the one the picture is drawn with.
  const styles = made.dimensionStyles!;
  const small = { ...styles.find((s) => s.name === "TICKS")!, textHeight: 0.001 };
  const twice = { ...made, dimensionStyles: [small, ...styles] };
  assert.equal(inspectText(twice).length, 1);
});

test("a dimension is written with its style, its points and the block of its picture", () => {
  const made = drawing((d) => {
    d.layer("DIMS", { color: 1 }, () => {
      d.linearDimension([0, 0], [52, 0], [0, -10], { style: "TICKS", id: "width" });
      d.alignedDimension([0, 0], [30, 40], 17, { style: "ARROWS", text: "<> TYP" });
    });
  });
  const dxf = toDXF(made);
  // The handles come from the names: these are the ones the names give in every drawing.
  assert.equal(dimensionStyleHandle("TICK-10"), "110BB0D17D57F0");
  assert.equal(dimensionStyleHandle("tick-10"), dimensionStyleHandle("TICK-10"));
  assert.deepEqual(arrowheadHandles("architectural-tick"), {
    record: "1734B2917AE0E0",
    stroke: "14E5BEA813236B",
  });
  assert.equal(arrowheadHandles("closed-filled"), undefined);
  assert.throws(() => dimensionStyleHandle("A/B"), RangeError);
  const width = dimensionPictureHandles({ id: "Width", index: 7 });
  assert.deepEqual(width, {
    record: "1FBB5810ACBFE7",
    begin: "1C18A7F085AC4F",
    end: "1285EAC5CE8524",
    extensionLines: ["17272C5F0BF9D0", "17262C5F0BE62D"],
    dimensionLine: "14E64A214426A5",
    arrowheads: ["14D80EF3992A9B", "14DB0EF39935B2"],
    text: "12C57C2A4861EF",
    dimensionLines: ["14E64A214426A5", "1A23E71AA31D32", "1A22E71AA31F7D", "1A25E71AA31254"],
    leader: ["1C6E99C485049E", "1C7199C48501B7"],
    belowText: "1A5AD40549288F",
    dimensionArcs: ["1FAB45DF867869", "1FAC45DF867AA4", "1FAD45DF867CF3"],
  });
  assert.equal(dimensionPictureHandles({ index: 1 }).record, "16DCBD6115A74B");
  assert.equal(dimensionPictureHandles({ index: 0, layout: "a-101" }).record, "1D645DAA891E34");
  assert.throws(() => dimensionPictureHandles({ id: "a b", index: 0 }), RangeError);
  assert.throws(() => dimensionPictureHandles({ index: -1 }), RangeError);
  assert.throws(() => dimensionPictureHandles({ index: 0, layout: "Model" }), RangeError);

  const [linear, aligned] = records(dxf, "DIMENSION");
  assert.deepEqual(linear!.slice(0, 2), ["5", idHandle("width")]);
  assert.equal(value(linear!, 2), "*D1");
  // What it reads, with 15 digits: 50 for the aligned one from 0, 0 to 30, 40.
  assert.deepEqual([value(linear!, 42), value(aligned!, 42)], ["52", "50"]);
  assert.equal(value(aligned!, 2), "*D2");
  assert.ok(dxf.includes(`\r\n105\r\n${dimensionStyleHandle("TICKS")}\r\n`));
  assert.ok(dxf.includes("\r\n1\r\n<> TYP\r\n"));
  // Each picture is an anonymous block of its own, on the dimension's layer.
  const pictures = records(dxf, "BLOCK").filter((r) => value(r, 2)?.startsWith("*D"));
  assert.deepEqual(
    pictures.map((r) => [value(r, 5), value(r, 70)]),
    [
      [width.begin, "1"],
      [dimensionPictureHandles({ index: 1 }).begin, "1"],
    ],
  );
  const held = (owner: string): string[][] =>
    ["LINE", "INSERT", "SOLID", "MTEXT"].flatMap((type) =>
      records(dxf, type)
        .filter((r) => value(r, 330) === owner)
        .map((r) => [type, ...r]),
    );
  const tickPicture = held(width.record);
  assert.deepEqual(
    tickPicture.map((r) => [r[0], value(r.slice(1), 5), value(r.slice(1), 8)]),
    [
      ["LINE", width.extensionLines[0], "DIMS"],
      ["LINE", width.extensionLines[1], "DIMS"],
      ["LINE", width.dimensionLine, "DIMS"],
      ["INSERT", width.arrowheads[0], "DIMS"],
      ["INSERT", width.arrowheads[1], "DIMS"],
      ["MTEXT", width.text, "DIMS"],
    ],
  );
  const [first, second] = tickPicture.filter((r) => r[0] === "INSERT").map((r) => r.slice(1));
  assert.deepEqual(
    [value(first!, 2), value(first!, 10), value(first!, 41), value(first!, 50)],
    ["_ArchTick", "0", "1", "180"],
  );
  assert.equal(value(second!, 50), undefined);
  const text = tickPicture.find((r) => r[0] === "MTEXT")!.slice(1);
  assert.deepEqual(
    [value(text, 1), value(text, 7), value(text, 71), value(text, 10), value(text, 20)],
    ["\\A1;52.00", "Standard", "5", "26", "-9"],
  );
  const arrowPicture = held(dimensionPictureHandles({ index: 1 }).record);
  assert.deepEqual(
    arrowPicture.map((r) => r[0]),
    ["LINE", "LINE", "LINE", "SOLID", "SOLID", "MTEXT"],
  );
  assert.equal(value(arrowPicture.at(-1)!.slice(1), 1), "\\A1;50.00 TYP");
  // A drawing whose styles draw no tick holds no block for one.
  const plain = toDXF({ ...made, dimensionStyles: [arrows], entities: [] });
  assert.ok(!plain.includes("_ArchTick"));
  assert.ok(!plain.includes("*D"));
  // A text longer than a group holds goes in groups of 250 characters, the last in group 1.
  const long = toDXF(
    drawing((d) =>
      d.linearDimension([0, 0], [9, 0], [0, -1], { style: "TICKS", text: "A".repeat(600) }),
    ),
  );
  const mtext = long.slice(long.indexOf("\r\nMTEXT\r\n"));
  assert.deepEqual(
    [...mtext.matchAll(/\r\n([13])\r\n(A*|\\A1;A*)(?=\r\n)/g)]
      .slice(0, 3)
      .map((m) => [m[1], m[2]!.length]),
    [
      ["3", 250],
      ["3", 250],
      ["1", 104],
    ],
  );
});

test("toSVG draws a dimension's lines, arrowheads and text, and the extents take it in", () => {
  const made = drawing((d) => {
    d.layer("DIMS", { color: 1 }, () => {
      d.linearDimension([0, 0], [52, 0], [0, -10], { style: "TICKS", id: "width" });
    });
  });
  const svg = toSVG(made);
  const group =
    /<g data-layer="DIMS" data-entity="0" data-id="width" data-dimension="52.00">([\s\S]*?)<\/g>/.exec(
      svg,
    );
  assert.ok(group);
  assert.equal(group[1]!.match(/data-part="extension-line"/g)?.length, 2);
  assert.equal(group[1]!.match(/data-part="dimension-line"/g)?.length, 1);
  assert.equal(group[1]!.match(/<polygon [^>]*data-part="arrowhead"/g)?.length, 2);
  // The paragraph its block holds, centered on the middle of the dimension line one gap above it:
  // an SHX text drawn from where its strokes start, as long as it plots.
  assert.match(group[1]!, /<g data-part="text" data-paragraph="\\A1;52\.00">/);
  assert.match(
    group[1]!,
    /<text transform="translate\(24\.166667 -9\.5\) [^"]*" [^>]*textLength="3\.666667"[^>]*data-part="text">52\.00<\/text>/,
  );
  assert.match(group[1]!, /x1="-1" y1="-10" x2="53" y2="-10"/);
  // From the end of the dimension line past the first extension line to the top of the text.
  const box = extents(
    made.entities,
    made.textStyles,
    [],
    undefined,
    undefined,
    undefined,
    made.dimensionStyles,
  );
  near([box[0], box[1], box[2]], [-1, -11, 53]);
  assert.ok(box[3] >= -8.5);
  // A dimension in a style the drawing does not have draws nothing, and hangs nothing.
  const lost = toSVG({ ...made, dimensionStyles: [] });
  assert.match(lost, /<g data-layer="DIMS" data-entity="0" data-id="width"\/>/);
  // Through a viewport the sizes are the style's, at the view's scale.
  const d = createDrawing({ units: "ft" });
  d.dimensionStyle({
    ...sizes,
    name: "VIEW",
    textHeight: 0.1,
    arrowSize: 0.1,
    extensionOffset: 0.05,
    extensionBeyond: 0.1,
    textGap: 0.05,
    scale: fromPaper(1, "in", { ratio: 120, units: "ft" }),
    arrowhead: "architectural-tick",
  });
  d.linearDimension([0, 0], [50, 0], [0, -10], { style: "VIEW" });
  d.layout("A", { paper: "ARCH D" }, (sheet) =>
    sheet.viewport([1, 1], 20, 10, { center: [25, 0], ratio: 120 }),
  );
  const sheet = toSVG(d.build(), { layout: "A" });
  assert.match(sheet, /data-dimension="50\.00"/);
  assert.match(sheet, /font-size="[\d.]+"[^>]*data-part="text">50\.00</);
});

test("two text styles lint refuses for their names are still written with a handle each", () => {
  const dxf = toDXFR2018({
    format: 0,
    units: "ft",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    textStyles: [
      { name: "NOTES", font: "Arial" },
      { name: "notes", font: "txt.shx" },
    ],
    entities: [],
  });
  const lines = dxf.split(/\r?\n/);
  const handles = lines.filter((_, i) => i % 2 === 1 && lines[i - 1]!.trim() === "5");
  assert.ok(handles.length > 10);
  assert.equal(new Set(handles).size, handles.length);
});

test("what a style sets of how its dimensions look is checked as literals and when the code runs", () => {
  const d = createDrawing({ units: "ft" });
  const style = { name: "S", ...sizes } as const;
  const feet = { ...style, units: "architectural", precision: 4 } as const;
  // @ts-expect-error: a decimal measurement has no fraction to stack.
  assert.throws(() => d.dimensionStyle({ ...style, fraction: "stacked" }), /architectural/);
  // @ts-expect-error: and none to size.
  assert.throws(() => d.dimensionStyle({ ...style, fractionScale: 0.75 }), /architectural/);
  // @ts-expect-error: the leading CAD app stacks across or diagonally, or not at all.
  assert.throws(() => d.dimensionStyle({ ...feet, fraction: "tall" }), /fraction must be/);
  assert.throws(
    () => d.dimensionStyle({ ...feet, fraction: "stacked", fractionScale: 0.1 }),
    /0\.25/,
  );
  assert.throws(() => d.dimensionStyle({ ...feet, fractionScale: 0.75 }), /sizes a fraction/);
  // @ts-expect-error: the text is above the line or centered in it.
  assert.throws(() => d.dimensionStyle({ ...style, textPlacement: "below" }), /textPlacement/);
  // @ts-expect-error: a short text stays inside or moves out on a leader.
  assert.throws(() => d.dimensionStyle({ ...style, textFit: "beside" }), /textFit/);
  assert.throws(() => d.dimensionStyle({ ...style, dimensionLineweight: 0.33 }), /lineweight/);
  assert.throws(
    () => d.dimensionStyle({ ...style, textFit: "leader", textPlacement: "centered" }),
    /closed filled arrowheads/,
  );
  d.dimensionStyle({ ...feet, fraction: "inline", fractionScale: 1 });
  // A text centered in a line needs its width and two gaps between the extension lines, whatever
  // the ticks reach past them.
  d.dimensionStyle({ ...style, name: "C", arrowhead: "oblique", textPlacement: "centered" });
  assert.throws(
    () => d.linearDimension([0, 0], [6, 0], [0, 2], { style: "C", text: "VERIFY" }),
    /centered in its line/,
  );
  d.linearDimension([0, 0], [7, 0], [0, 2], { style: "C", text: "VERIFY" });
});

test("a stacked fraction, words below the line and a text moved out are drawn and read back", async () => {
  const style = { ...sizes, textHeight: 0.125, arrowSize: 0.125, textGap: 0.0625 } as const;
  const feet = { units: "architectural", precision: 4, measurementScale: 12 } as const;
  assert.equal(
    measurementText(4.119792, { ...feet, fraction: "stacked", fractionScale: 0.75 }),
    `4'-1{\\H0.75x;\\S7/16;}"`,
  );
  assert.equal(
    measurementText(4.119792, { ...feet, fraction: "diagonal" }),
    `4'-1{\\H1x;\\S7#16;}"`,
  );
  const d = createDrawing({ units: "ft" });
  d.textStyle({ name: "NOTES", font: "Arial" });
  d.dimensionStyle({
    ...style,
    name: "S",
    textStyle: "NOTES",
    arrowhead: "oblique",
    textFit: "leader",
  });
  d.linearDimension([0, 0], [10, 0], [0, 2], { style: "S", textBelow: "WINDOW HEAD HT." });
  d.linearDimension([0, 5], [0.1, 5], [0, 7], { style: "S", id: "short" });
  const drawing = d.build();
  const [below, short] = drawing.entities.map((e) =>
    dimensionPicture(e as never, drawing.dimensionStyles![0]!, drawing.textStyles![0]),
  );
  // The words stand a gap under the line, and the file holds the line's middle for the text.
  assert.equal(below!.below?.label.value, "WINDOW HEAD HT.");
  assert.ok(below!.below!.middle[1] < 2 && below!.textMiddle[1] > 2);
  assert.deepEqual(below!.textPoint, [5, 2]);
  // A text with no room moves out on a leader of two lines from the middle of the dimension line.
  assert.equal(short!.leader.length, 2);
  assert.deepEqual(short!.leader[0]![0], [0.05, 7]);
  const dxf = toDXF(drawing);
  assert.ok(dxf.includes("\r\n1\r\n<>\\XWINDOW HEAD HT.\r\n"));
  const read = await readDXF(dxf, { geometry: true });
  const [first] = read.model.entities as readonly {
    readonly text?: string;
    readonly textBelow?: string;
  }[];
  assert.deepEqual([first!.text, first!.textBelow], [undefined, "WINDOW HEAD HT."]);
  assert.equal(read.dimensionStyles.find((s) => s.name === "S")?.textMove, 1);
  assert.equal(read.dimensionStyles.find((s) => s.name === "S")?.arrowheadBlock, "_Oblique");
});

test("a radius, a diameter and a jogged radius dimension are built, written and read back", async () => {
  const d = createDrawing({ units: "in" });
  d.dimensionStyle({ ...sizes, name: "S" });
  d.dimensionStyle({ ...sizes, name: "JOG", jogAngle: 30 });
  d.radiusDimension([0, 0], [3, 4], { style: "S", id: "r" });
  d.diameterDimension([10, 0], [10, 2], { style: "S", text: "<> TYP.", textFromCenter: 1 });
  d.joggedRadiusDimension([0, 0], [30, 40], [20, 20], [24, 30], { style: "JOG" });
  const drawing = d.build();
  assert.deepEqual(lint(drawing), []);
  assert.deepEqual(fromJSON(toJSON(drawing)), drawing);
  const read = await readDXF(toDXF(drawing), { geometry: true });
  const radial = (read.model.entities ?? []).filter((e) => e.kind === "radial-dimension");
  assert.deepEqual(
    radial.map((e) => [e.type, e.center, e.point, e.measurement]),
    [
      ["radius", [0, 0], [3, 4], 5],
      ["diameter", [10, 0], [10, 2], 4],
      ["jogged-radius", [0, 0], [30, 40], 50],
    ],
  );
  assert.equal(radial[1]!.text, "<> TYP.");
  assert.equal(radial[1]!.placed, true);
  assert.deepEqual(
    [radial[2]!.start, radial[2]!.jog],
    [
      [20, 20],
      [24, 30],
    ],
  );
  // The leading CAD app writes R and the diameter sign before the measurement itself.
  const style = drawing.dimensionStyles![0]!;
  assert.equal(dimensionPicture(drawing.entities[0] as never, style).label.value, "R5.00");
});

test("a radial dimension is refused where the leading CAD app would draw what tsdraft does not", () => {
  const d = createDrawing({ units: "in" });
  d.dimensionStyle({ ...sizes, name: "S" });
  d.dimensionStyle({ ...sizes, name: "PRE", prefix: "L=" });
  // A style's prefix may stand in place of the R the app writes.
  assert.throws(
    () => d.radiusDimension([0, 0], [3, 4], { style: "PRE" }),
    /its style has a prefix/,
  );
  assert.throws(() => d.radiusDimension([0, 0], [0, 0.0000001], { style: "S" }), /no radius/);
  assert.throws(
    () => d.dimensionStyle({ ...sizes, name: "STEEP", jogAngle: 95 }),
    /jogAngle must be a number of degrees from 5 to 90/,
  );
  assert.throws(
    () => d.radiusDimension([0, 0], [3, 4], { style: "S", textFromCenter: Number.NaN }),
    /textFromCenter/,
  );
  // A jog so near the arc that its last stretch cannot hold the text.
  assert.throws(
    () => d.joggedRadiusDimension([0, 0], [120, 0], [118, 0.5], [119.7, 0.1], { style: "S" }),
    /shorter than its text/,
  );
});

test("an angular dimension is built, written and read back, its arc's point picking the angle", async () => {
  const d = createDrawing({ units: "in" });
  d.dimensionStyle({ ...sizes, name: "S" });
  d.angularDimension([0, 0], [2, 0], [0, 2], [3, 3], { style: "S", id: "a" });
  // Its point on the far side of the vertex picks the rest of the turn.
  d.angularDimension([0, 0], [2, 0], [0, 2], [-3, -3], { style: "S", text: "<> TYP." });
  const drawing = d.build();
  assert.deepEqual(lint(drawing), []);
  assert.deepEqual(fromJSON(toJSON(drawing)), drawing);
  const style = drawing.dimensionStyles![0]!;
  assert.deepEqual(
    drawing.entities.map((e) => dimensionPicture(e as never, style).label.value),
    ["90°", "270° TYP."],
  );
  const read = await readDXF(toDXF(drawing), { geometry: true });
  const angular = (read.model.entities ?? []).filter((e) => e.kind === "angular-dimension");
  assert.deepEqual(
    angular.map((e) => [e.type, e.vertex, e.from, e.to, e.at, Math.round(e.measurement!)]),
    [
      ["three-point", [0, 0], [2, 0], [0, 2], [3, 3], 90],
      ["three-point", [0, 0], [2, 0], [0, 2], [-3, -3], 270],
    ],
  );
  // An angle too large for degrees reads as no angle.
  const huge = toDXF(drawing).replace("42\r\n1.5707963267949\r\n", "42\r\n1e308\r\n");
  const hugeRead = await readDXF(huge, { geometry: true });
  assert.equal((hugeRead.model.entities![0] as { measurement?: number }).measurement, undefined);
});

test("an angle is written in each unit and precision as the leading CAD app writes it", () => {
  const at = (degrees: number, style: Parameters<typeof angleNumber>[1]): string =>
    angleNumber((degrees * Math.PI) / 180, style);
  const dms = { angleUnits: "degrees-minutes-seconds" } as const;
  // Each from a case the app drew, of the angle its points make.
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 8].map((places) => at(123.456705888, { ...dms, anglePrecision: places })),
    [
      "123°",
      "123°27'",
      "123°27'",
      `123°27'24"`,
      `123°27'24"`,
      `123°27'24.1"`,
      `123°27'24.14"`,
      `123°27'24.1412"`,
    ],
  );
  // Rounding carries into the minutes and the degrees.
  assert.equal(at(45.999993816, { ...dms, anglePrecision: 5 }), `46°0'0.0"`);
  assert.equal(at(45.999993816, { ...dms, anglePrecision: 6 }), `45°59'59.98"`);
  assert.equal(at(123.456705888, { anglePrecision: 2 }), "123.46°");
  assert.equal(at(89.995007537, { anglePrecision: 2 }), "90.00°");
  assert.equal(at(45.000007829, { angleUnits: "grads", anglePrecision: 2 }), "50.00g");
  assert.equal(at(20.000009666, { angleUnits: "radians", anglePrecision: 3 }), "0.349r");
  assert.deepEqual(
    (["leading", "trailing", "both"] as const).map((zeros) =>
      at(0.5, { anglePrecision: 2, suppressAngleZeros: zeros }),
    ),
    [".50°", "0.5°", ".5°"],
  );
});

test("an angular dimension is refused where the leading CAD app would draw what tsdraft does not", () => {
  const d = createDrawing({ units: "in" });
  d.dimensionStyle({ ...sizes, name: "S" });
  d.dimensionStyle({ ...sizes, name: "OUT", textFit: "leader" });
  assert.throws(
    () => d.angularDimension([0, 0], [0, 0], [0, 2], [3, 3], { style: "S" }),
    /no direction/,
  );
  assert.throws(
    () => d.angularDimension([0, 0], [2, 0], [0, 2], [0, 0], { style: "S" }),
    /no radius/,
  );
  assert.throws(
    () => d.angularDimension([0, 0], [2, 0], [4, 0], [3, 3], { style: "S" }),
    /no angle/,
  );
  // The arc through one of its points, whose extension line runs either way by a rounding.
  assert.throws(
    () => d.angularDimension([0, 0], [2, 0], [0, 2], [1.2, 1.6], { style: "S" }),
    /passes through one of its two points/,
  );
  // The arc's point on one of the lines, where a rounding picks the angle or the rest of the turn.
  assert.throws(
    () => d.angularDimension([1.1, 2.3], [1.2, 2.37], [1.03, 2.4], [1.3, 2.44], { style: "S" }),
    /on one of its two lines/,
  );
  // A centered text that leaves the arc no room each side, with no marks to turn.
  d.dimensionStyle({ ...sizes, name: "BARE", arrowSize: 0, textPlacement: "centered" });
  assert.throws(
    () => d.angularDimension([0, 0], [2, 0], [2, 0.05], [1, 0.01], { style: "BARE" }),
    /too short for its text "centered"/,
  );
  // The rest of the turn, its centered text and arrowheads too wide for each half of it.
  d.dimensionStyle({
    ...sizes,
    name: "WIDE",
    textPlacement: "centered",
    textHeight: 0.25,
    textGap: 0.1,
    extensionOffset: 0,
    extensionBeyond: 0,
  });
  assert.throws(
    () => d.angularDimension([0, 0], [2, 0], [2, -0.2], [-0.55, 0], { style: "WIDE" }),
    /too short for its text "centered"/,
  );
  // An arc of all but a whole turn, which its 6 decimals write with one angle at both ends.
  d.dimensionStyle({ ...sizes, name: "THIN", arrowSize: 0 });
  assert.throws(
    () => d.angularDimension([0, 0], [1000, 0], [1000, 0.000007], [-2000, 0], { style: "THIN" }),
    /all but a whole turn/,
  );
  // Closed arrowheads longer than the arc is wide.
  assert.throws(
    () => d.angularDimension([0, 0], [2, 0], [0, 2], [0.04, 0.04], { style: "S" }),
    /as long as its arc is wide/,
  );
  // A text too wide for the arc, which "leader" moves outside.
  assert.throws(
    () => d.angularDimension([0, 0], [2, 0], [2, 0.1], [0.5, 0.01], { style: "OUT" }),
    /too short for its text/,
  );
  assert.throws(
    () => d.dimensionStyle({ ...sizes, name: "BAD", anglePrecision: 9 }),
    /anglePrecision must be a whole number from 0 to 8/,
  );
});

test("a style's text mask is kept by the builder, written, plotted and boxed", () => {
  const masked = (textMask?: boolean | { color: number }) => {
    const d = createDrawing({ units: "ft" });
    d.textStyle({ name: "NOTES", font: "Arial" });
    d.dimensionStyle({ ...sizes, name: "MASKED", ...(textMask === undefined ? {} : { textMask }) });
    d.linearDimension([0, 0], [100, 0], [50, 20], { style: "MASKED" });
    return d.build();
  };
  assert.deepEqual(masked(true).dimensionStyles?.[0]?.textMask, true);
  assert.deepEqual(masked({ color: 3 }).dimensionStyles?.[0]?.textMask, { color: 3 });
  assert.equal(masked(false).dimensionStyles?.[0]?.textMask, undefined);
  assert.match(toDXF(masked(true)), /\r\n *69\r\n *1\r\n/);
  assert.match(toSVG(masked(true)), /data-part="mask"/);
  assert.doesNotMatch(toSVG(masked()), /data-part="mask"/);
  // The mask grows the text's box by a quarter of its height each side, past the dimension's top.
  const top = (drawing: Drawing) =>
    extents(
      drawing.entities,
      drawing.textStyles,
      [],
      undefined,
      undefined,
      undefined,
      drawing.dimensionStyles,
    )[3];
  assert.ok(top(masked(true)) > top(masked()), `${top(masked(true))} ${top(masked())}`);
});
