import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDrawing,
  FONT_METRICS,
  FONT_METRICS_RANGES,
  FONTS,
  measureText,
  type Point,
} from "../src/index.ts";
import { extents } from "../src/extents.ts";

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
const same = (corners: readonly Point[], expected: readonly Point[]): void => {
  corners.forEach(([x, y], i) => {
    const [ex, ey] = expected[i]!;
    assert.ok(near(x, ex) && near(y, ey), `corner ${i}: ${x}, ${y}, not ${ex}, ${ey}`);
  });
};

test("the width table holds every font, with a number for each character of its ranges", () => {
  assert.deepEqual(Object.keys(FONT_METRICS), Object.keys(FONTS));
  const count = FONT_METRICS_RANGES.reduce((sum, [first, last]) => sum + last - first + 1, 0);
  assert.equal(count, 191);
  for (const [font, metrics] of Object.entries(FONT_METRICS)) {
    for (const table of [metrics.advances, metrics.tails, metrics.heads]) {
      assert.equal(table.length, count, font);
      assert.ok(table.every(Number.isFinite), font);
    }
    assert.ok(metrics.below > 0 && metrics.below < 1, font);
  }
});

test("a text is as long as its characters' advances, less what its last one leaves blank", () => {
  // In txt.shx a capital is one height from the next, and its strokes two thirds of that.
  assert.ok(near(measureText({ value: "HELLO", height: 1 }).length, 5 - 1 / 3));
  assert.ok(near(measureText({ value: "HELLO", height: 0.125 }).length, (5 - 1 / 3) / 8));
  assert.ok(near(measureText({ value: "H H", height: 2, widthFactor: 0.5 }).length, 3 - 1 / 3));
  assert.equal(measureText({ value: "", height: 1 }).length, 0);
  // Each font has its own widths, by the character's place in the table's two ranges.
  const at = (c: string): number =>
    c.charCodeAt(0) < 0x7f ? c.charCodeAt(0) - 0x20 : 95 + c.charCodeAt(0) - 0xa0;
  for (const [font, metrics] of Object.entries(FONT_METRICS)) {
    const value = "Aé 1";
    const advances = [...value].reduce((sum, c) => sum + metrics.advances[at(c)]!, 0);
    const expected = advances + metrics.tails[at("1")]! - metrics.heads[at("A")]!;
    const measured = measureText({ value, height: 3, font });
    assert.ok(near(measured.length, expected * 3), font);
    assert.ok(near(measured.descent, metrics.below * 3), font);
    assert.equal(measured.approximate, false, font);
  }
  // Arial is narrower than txt.shx, and monotxt.shx moves on one height for every character.
  const length = (font: string): number =>
    measureText({ value: "ILLINOIS", height: 1, font }).length;
  assert.ok(length("Arial") < length("txt.shx"));
  const mono = FONT_METRICS["monotxt.shx"]!;
  assert.ok(near(length("monotxt.shx"), 8 + mono.tails[at("S")]! - mono.heads[at("I")]!));
});

test("a character outside the table is as wide as a question mark, and a code is one character", () => {
  const length = (value: string): number => measureText({ value, height: 1 }).length;
  const kanji = measureText({ value: "A日B", height: 1 });
  assert.ok(near(kanji.length, length("A?B")));
  assert.equal(kanji.approximate, true);
  // A character beyond U+FFFF is two code units of a string, and one character.
  assert.ok(near(length("A\u{1F600}B"), length("A?B")));
  for (const [code, drawn] of [
    ["45%%d", "45°"],
    ["%%P0.5", "±0.5"],
    ["%%c12", "Ø12"],
  ] as const) {
    const measured = measureText({ value: code, height: 1 });
    assert.ok(near(measured.length, length(drawn)), code);
    assert.equal(measured.approximate, true, code);
  }
  // Any other code is measured as written, and still called an estimate.
  assert.equal(measureText({ value: "100%%%", height: 1 }).approximate, true);
  assert.equal(measureText({ value: "x", height: 1, font: "nofont.shx" }).approximate, true);
  assert.equal(measureText({ value: "x", height: 1, font: "toString" }).approximate, true);
});

test("a text's box follows its justification, with one rule for its baseline", () => {
  const text = { value: "HELLO", height: 3 } as const;
  const long = 3 * (5 - 1 / 3);
  const below = FONT_METRICS["txt.shx"]!.below * 3;
  const box = (x: number, y: number): Point[] => [
    [x, y],
    [x + long, y],
    [x + long, y + 3],
    [x, y + 3],
  ];
  same(measureText({ ...text, at: [10, 20] }).corners, box(10, 20));
  same(measureText({ ...text, at: [10, 20], align: "center" }).corners, box(10 - long / 2, 20));
  same(measureText({ ...text, at: [10, 20], align: "right" }).corners, box(10 - long, 20));
  same(measureText({ ...text, at: [10, 20], valign: "top" }).corners, box(10, 17));
  same(measureText({ ...text, at: [10, 20], valign: "middle" }).corners, box(10, 18.5));
  // A text on its bottom stands as far above its point as its font draws below the baseline.
  same(measureText({ ...text, at: [10, 20], valign: "bottom" }).corners, box(10, 20 + below));
  assert.ok(near(measureText(text).descent, below));
  // A space at either end of a centered or right-justified text makes its place an estimate.
  const estimate = (value: string, align: "left" | "center" | "right" = "left"): boolean =>
    measureText({ value, height: 1, align }).approximate;
  assert.deepEqual(
    [estimate("A B", "center"), estimate("A ", "center"), estimate("\u00a0A", "right")],
    [false, true, true],
  );
  assert.equal(estimate(" A "), false);
});

test("a text's box is turned about its point and leans with its oblique angle", () => {
  const text = { value: "HELLO", height: 3, at: [10, 20] } as const;
  const long = 3 * (5 - 1 / 3);
  same(measureText({ ...text, rotation: 90 }).corners, [
    [10, 20],
    [10, 20 + long],
    [7, 20 + long],
    [7, 20],
  ]);
  // Right-justified and turned half way round, it runs on from its point upside down.
  same(measureText({ ...text, rotation: 180, align: "right" }).corners, [
    [10 + long, 20],
    [10, 20],
    [10, 17],
    [10 + long, 17],
  ]);
  // The top lies one height further along at 45 degrees, whatever the width factor.
  const leaned = measureText({ ...text, obliqueAngle: 45, widthFactor: 2 });
  assert.ok(near(leaned.length, 2 * long));
  same(leaned.corners, [
    [10, 20],
    [10 + 2 * long, 20],
    [13 + 2 * long, 23],
    [13, 23],
  ]);
});

test("the extents hold a text's box and what its font draws below the baseline", () => {
  const d = createDrawing();
  d.textStyle({ name: "A", font: "Arial", widthFactor: 1.5 });
  d.text([4, 5], "Baggage", { height: 2, style: "A", align: "center", rotation: 30 });
  const drawing = d.build();
  const { corners, descent } = measureText({
    value: "Baggage",
    height: 2,
    font: "Arial",
    widthFactor: 1.5,
    at: [4, 5],
    align: "center",
    rotation: 30,
  });
  // Below each end of the baseline, straight down the turned text.
  const down: Point = [Math.sin(Math.PI / 6) * descent, -Math.cos(Math.PI / 6) * descent];
  const points = [
    ...corners,
    ...corners.slice(0, 2).map(([x, y]): Point => [x + down[0], y + down[1]]),
  ];
  const expected = [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ];
  extents(drawing.entities, drawing.textStyles).forEach((n, i) => assert.ok(near(n, expected[i]!)));
});
