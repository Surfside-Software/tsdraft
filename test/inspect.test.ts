import assert from "node:assert/strict";
import { test } from "node:test";
import { createDrawing, inspectText, measureText, type Drawing } from "../src/index.ts";

/** Each warning as its rule, its text and what it names beside it. */
const found = (drawing: Drawing, options?: Parameters<typeof inspectText>[1]) =>
  inspectText(drawing, options).map((w) => [
    w.rule,
    w.attribute ?? w.entity,
    w.other?.attribute ?? w.other?.id ?? w.other?.entity,
  ]);

test("two texts that plot over each other get one warning, on the later one", () => {
  const d = createDrawing();
  d.text([0, 0], "FIRST FLOOR", { height: 1 });
  d.text([4, 0.5], "PLAN", { height: 1, id: "plan" });
  // Turned across both.
  d.text([3, -2], "GRID", { height: 1, rotation: 90 });
  const [warning, crossing] = inspectText(d.build());
  assert.deepEqual(
    [warning!.rule, warning!.severity, warning!.entity, warning!.id, warning!.other],
    ["text-overlaps-text", "warning", 1, "plan", { entity: 0 }],
  );
  assert.match(warning!.message, /^Text "PLAN" plots over text "FIRST FLOOR"\. /);
  // The box holds both texts, from the start of the first to its end and up to the second's top.
  const { length } = measureText({ value: "FIRST FLOOR", height: 1 });
  assert.deepEqual(warning!.bounds, { min: [0, 0], max: [Number(length.toFixed(6)), 1.5] });
  // The earliest text it crosses is the one named.
  assert.deepEqual([crossing!.entity, crossing!.other], [2, { entity: 0 }]);
  assert.equal(inspectText(d.build()).length, 2);
});

test("texts that only come near each other are not warned about", () => {
  const d = createDrawing();
  // Notes at the usual spacing, a tail of one line over the capitals of the next.
  d.text([0, 3], "1. Paging gypsy jugs", { height: 1 });
  d.text([0, 1.5], "2. SECOND NOTE", { height: 1 });
  d.text([0, 0], "3. THIRD NOTE", { height: 1 });
  // An underline, a text that starts where another ends, and one that touches by a hair.
  d.line([0, -0.2], [12, -0.2]);
  const { length } = measureText({ value: "3. THIRD NOTE", height: 1 });
  d.text([length, 0], "ON", { height: 1 });
  d.text([0, 3.95], "HAIR", { height: 1 });
  // A text with nothing to draw, over another.
  d.text([0, 0], "   ", { height: 1 });
  d.text([0, 0], "", { height: 1 });
  // Two turned texts side by side, whose upright boxes overlap.
  d.text([20, 0], "ALONG A WALL", { height: 1, rotation: 45 });
  d.text([22, 0], "ALONG A WALL", { height: 1, rotation: 45 });
  assert.deepEqual(found(d.build()), []);
});

test("a text on a layer that does not draw is left out, as toSVG leaves it out", () => {
  const d = createDrawing();
  d.text([0, 0], "SHOWN", { height: 1 });
  d.layer("OFF", { color: 1, off: true }, () => d.text([0, 0], "OFF", { height: 1 }));
  d.layer("FROZEN", { color: 1, frozen: true }, () => d.text([0, 0], "FROZEN", { height: 1 }));
  d.layer("NOPLOT", { color: 1, plot: false }, () => d.text([0, 0], "NOPLOT", { height: 1 }));
  assert.deepEqual(found(d.build()), []);
  assert.deepEqual(found(d.build(), { drawNoPlot: true }), [["text-overlaps-text", 3, 0]]);
});

test("a note of a cover sheet that runs past the border it starts in is warned about", () => {
  // The cover sheet's frame, in inches: the trim line, the border and the title strip's line.
  const cover = (lines: readonly string[]): Drawing => {
    const d = createDrawing({ units: "in" });
    d.rect([0, 0], 36, 24, { id: "trim" });
    d.rect([1.5, 0.5], 34, 23, { id: "border" });
    d.line([32.5, 0.5], [32.5, 23.5]);
    lines.forEach((line, i) => d.text([17.5, 21.55 - i * 0.32], line, { height: 3 / 16 }));
    return d.build();
  };
  // The notes were broken for 0.6 of the height per character, 127 to a line.
  const long = "1. " + "ALL WORK SHALL CONFORM TO THE CODE. ".repeat(4).slice(0, 122);
  assert.equal(long.length, 125);
  const [warning, ...rest] = inspectText(cover([long, "SHORT SECOND."]));
  assert.deepEqual(rest, []);
  assert.deepEqual(
    [warning!.rule, warning!.entity, warning!.other],
    ["text-leaves-boundary", 3, { entity: 1, id: "border" }],
  );
  assert.match(warning!.message, /starts inside a closed polyline and runs past it\./);
  // The line plots more than 23 inches long, from 17.5 to past the border at 35.5.
  assert.ok(warning!.bounds!.max[0] > 40);
  assert.deepEqual(warning!.bounds!.min, [17.5, 21.55]);

  // Broken by the length the text plots at, the notes stay inside.
  const lines: string[] = [];
  for (const word of long.split(" ")) {
    const longer = lines.length > 0 ? `${lines.at(-1)} ${word}` : word;
    if (lines.length > 0 && measureText({ value: longer, height: 3 / 16 }).length <= 32 - 17.5) {
      lines[lines.length - 1] = longer;
    } else lines.push(word);
  }
  assert.ok(lines.length > 1);
  assert.deepEqual(found(cover(lines)), []);
});

test("the boundary is the smallest closed polyline around the text's point, concave or not", () => {
  const d = createDrawing();
  d.rect([0, 0], 100, 100, { id: "sheet" });
  d.rect([10, 10], 5, 2, { id: "cell" });
  // In the cell, and out of it, though well inside the sheet.
  d.text([10.5, 10.5], "FITS", { height: 1 });
  d.text([10.5, 10.5], "DOES NOT FIT", { height: 1, id: "wide" });
  // A point on the outline is inside it. This one starts on the cell's left side.
  d.text([10, 10.5], "ON THE LINE AND OUT", { height: 1, id: "edge" });
  // Past the outline by less than a tenth of the height.
  d.rect([30, 10], 4.05 - 1 / 3, 2);
  d.text([30, 10.5], "ABCD", { height: 1 });
  // A room shaped like a U. A label across the gap between its arms has all four corners in
  // the room.
  d.polyline(
    [
      [50, 0],
      [70, 0],
      [70, 20],
      [62, 20],
      [62, 5],
      [58, 5],
      [58, 20],
      [50, 20],
    ],
    true,
    { id: "room" },
  );
  d.text([51, 2], "LOW IN THE ROOM", { height: 1 });
  d.text([51, 10], "ACROSS THE GAP", { height: 1, id: "gap" });
  // An open polyline and a text outside every outline bound nothing.
  d.polyline(
    [
      [200, 0],
      [201, 0],
      [201, 1],
    ],
    false,
  );
  d.text([200.5, 0.2], "LONG ENOUGH TO LEAVE", { height: 1 });
  const warnings = inspectText(d.build()).filter((w) => w.rule === "text-leaves-boundary");
  assert.deepEqual(
    warnings.map((w) => [w.id, w.other?.id]),
    [
      ["wide", "cell"],
      ["edge", "cell"],
      ["gap", "room"],
    ],
  );
});

test("an insert's texts and outlines count where it puts them, each named by its insert", () => {
  const d = createDrawing();
  d.block("FIELD", {}, () => {
    d.rect([0, 0], 6, 1);
    d.text([0.2, 0.6], "NAME", { height: 0.2 });
    d.attribute("VALUE", [0.2, 0.2], { value: "", height: 0.25 });
    d.attribute("NOTE", [0.2, 0.2], { value: "", height: 0.25 });
  });
  d.insert("FIELD", [0, 0], { attributes: { VALUE: "SHORT" } });
  d.insert("FIELD", [0, 5], {
    id: "long",
    scale: [2, 2],
    rotation: 90,
    attributes: { VALUE: "A VALUE TOO LONG FOR ITS FIELD" },
  });
  d.insert("FIELD", [20, 0], { attributes: { VALUE: "TWICE", NOTE: "TWICE" } });
  const warnings = inspectText(d.build());
  assert.deepEqual(
    warnings.map((w) => [w.rule, w.entity, w.attribute, w.id, w.other]),
    [
      ["text-leaves-boundary", 1, "VALUE", "long", { entity: 1, id: "long" }],
      ["text-overlaps-text", 2, "NOTE", undefined, { entity: 2, attribute: "VALUE" }],
    ],
  );
  assert.match(warnings[0]!.message, /^Attribute "VALUE" "A VALUE TOO LONG FOR ITS FIELD" starts/);
  // The box is where the turned insert draws the attribute: up from its point at -0.4, 5.4.
  assert.deepEqual(warnings[0]!.bounds!.min, [-0.9, 5.4]);
  assert.equal(warnings[0]!.bounds!.max[0], -0.4);
});

test("a text off the paper of a layout is warned about, and each space is checked by itself", () => {
  const d = createDrawing({ units: "ft" });
  d.text([0, 0], "MODEL", { height: 1 });
  d.text([-500, 0], "FAR FROM ANY PAPER", { height: 1 });
  d.layout("A-1", { paper: "ARCH D" }, (sheet) => {
    sheet.viewport([1, 1], 20, 20, { center: [0, 0], ratio: 12 });
    // Over where the viewport shows the model's text, which is no overlap on the paper.
    d.text([11, 11], "SHEET", { height: 0.25 });
    d.text([33, 23.9], "OFF THE TOP", { height: 0.25, id: "top" });
    d.text([34, 12], "OFF THE SIDE", { height: 0.25, id: "side" });
    // A lean of a third of the height over the edge is past the tolerance.
    d.text([35.9, 2], "I", {
      height: 1,
      style: { name: "LEAN", font: "txt.shx", obliqueAngle: 30 },
    });
    d.text([35, 5], "IN", { height: 0.25 });
  });
  const warnings = inspectText(d.build());
  assert.deepEqual(
    warnings.map((w) => [w.rule, w.layout, w.entity, w.id]),
    [
      ["text-off-paper", "A-1", 1, "top"],
      ["text-off-paper", "A-1", 2, "side"],
      ["text-off-paper", "A-1", 3, undefined],
    ],
  );
  assert.match(warnings[0]!.message, /runs off the paper of layout "A-1", which is 36 by 24$/);
});

/** The rules of the warnings a drawing gets, and how long `inspectText` took over it. */
const timed = (drawing: Drawing) => {
  const started = performance.now();
  const rules = inspectText(drawing).map((w) => w.rule);
  return { rules, ms: performance.now() - started };
};

test("texts piled on one spot are checked up to a limit, and it says so once", () => {
  const d = createDrawing();
  for (let i = 0; i < 20_000; i++) d.text([0, 0], "SAME PLACE", { height: 1 });
  const { rules, ms } = timed(d.build());
  assert.ok(ms < 1000, `${ms} ms`);
  assert.equal(rules.at(-1), "text-check-capped");
  assert.equal(rules.filter((rule) => rule === "text-check-capped").length, 1);
});

test("a contour of a few hundred points with thousands of texts in it is checked in full", () => {
  const d = createDrawing();
  const contour = Array.from({ length: 300 }, (_, i): [number, number] => {
    const turn = (i / 300) * 2 * Math.PI;
    return [1000 * Math.cos(turn), 1000 * Math.sin(turn)];
  });
  d.polyline(contour, true);
  for (let i = 0; i < 3000; i++) {
    d.text([(i % 60) * 20 - 600, Math.floor(i / 60) * 2 - 50], "IN", { height: 1 });
  }
  const { rules, ms } = timed(d.build());
  assert.ok(ms < 1000, `${ms} ms`);
  assert.deepEqual(rules, []);
});

test("texts in one outline of many points are checked up to a limit, and it says so", () => {
  const d = createDrawing();
  const circle = Array.from({ length: 20_000 }, (_, i): [number, number] => {
    const turn = (i / 20_000) * 2 * Math.PI;
    return [1000 * Math.cos(turn), 1000 * Math.sin(turn)];
  });
  d.polyline(circle, true);
  for (let i = 0; i < 5000; i++) {
    d.text([(i % 70) * 20 - 700, Math.floor(i / 70) * 2 - 70], "IN", { height: 1 });
  }
  const { rules, ms } = timed(d.build());
  assert.ok(ms < 1000, `${ms} ms`);
  assert.deepEqual(rules, ["text-check-capped"]);
});
