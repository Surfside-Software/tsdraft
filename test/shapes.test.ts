import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDrawing,
  lint,
  parseLinetypes,
  parseShapes,
  toSVG,
  type Drawing,
} from "../src/index.ts";

/** A compiled shape file of the given shapes: number, name and codes, as a compiler writes it. */
function shapeFile(shapes: readonly [number, string, readonly number[]][], kind = "shapes 1.0") {
  const bytes: number[] = [...`Test-86 ${kind}\r\n\x1a`].map((c) => c.charCodeAt(0));
  const u16 = (v: number) => bytes.push(v & 255, v >> 8);
  const numbers = shapes.map(([n]) => n);
  u16(Math.min(...numbers));
  u16(Math.max(...numbers));
  u16(shapes.length);
  for (const [n, name, codes] of shapes) {
    u16(n);
    u16(name.length + 1 + codes.length);
  }
  for (const [, name, codes] of shapes)
    bytes.push(...[...name].map((c) => c.charCodeAt(0)), 0, ...codes.map((c) => c & 255));
  bytes.push(...[..."EOF"].map((c) => c.charCodeAt(0)));
  return new Uint8Array(bytes);
}

const round = (points: readonly (readonly [number, number])[]) =>
  points.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);

test("parseShapes draws each code as the leading CAD app plots it", () => {
  const { shapes } = parseShapes(
    shapeFile([
      // Up 4, pen up, back down, pen down, east 4: the pen-up move draws nothing.
      [1, "PEN", [0x44, 2, 0x4c, 1, 0x40, 0]],
      // A pop moves the pen back without drawing; a subshape goes on from where it ends.
      [2, "POP", [5, 0x44, 0x40, 6, 7, 1, 0]],
      // Code 14 skips its whole next command outside vertical text.
      [3, "VERT", [14, 8, -2, -3, 0x40, 0]],
      // A clockwise fractional arc, its offsets turned the way it runs.
      [4, "FRAC", [11, 56, 28, 0, 3, 0x92, 0]],
      // A pen-down move of no length draws nothing.
      [5, "DOT", [8, 0, 0, 0]],
    ]),
  );
  const [pen, pop, vert, frac, dot] = shapes;
  assert.deepEqual(
    pen!.outlines.map((o) => round(o.points)),
    [
      [
        [0, 0],
        [0, 4],
      ],
      [
        [0, 0],
        [4, 0],
      ],
    ],
  );
  assert.deepEqual(
    pop!.outlines.map((o) => round(o.points)),
    [
      [
        [0, 0],
        [0, 4],
        [4, 4],
      ],
      [
        [0, 0],
        [0, 4],
      ],
      [
        [0, 0],
        [4, 0],
      ],
    ],
  );
  assert.deepEqual(
    vert!.outlines.map((o) => round(o.points)),
    [
      [
        [0, 0],
        [4, 0],
      ],
    ],
  );
  // From 45° less 56/256 of an octant, clockwise to 0° less 28/256 of one, about a center 3 away.
  const [start, end] = [(Math.PI / 4) * (1 - 56 / 256), (-Math.PI / 4) * (28 / 256)];
  const center = [-3 * Math.cos(start), -3 * Math.sin(start)];
  assert.deepEqual(
    round(frac!.outlines[0]!.points)[1],
    round([[center[0]! + 3 * Math.cos(end), center[1]! + 3 * Math.sin(end)]])[0],
  );
  assert.ok(frac!.outlines[0]!.bulges![0]! < 0);
  assert.deepEqual(dot!.outlines, []);
});

test("parseShapes refuses what is not a shape file of its kind, and a shape that draws itself", () => {
  for (const [bytes, message] of [
    [shapeFile([[1, "A", [0x10, 0]]], "unifont 1.0"), /unifont kind/],
    [shapeFile([[1, "A", [0x10, 0]]], "shapes 1.1"), /only shapes 1.0/],
    [
      shapeFile([
        [1, "A", [7, 2, 0]],
        [2, "B", [7, 1, 0]],
      ]),
      /draws itself/,
    ],
    [shapeFile([[1, "A", [6, 0]]]), /never pushed/],
    [shapeFile([[1, "A", [0x10]]]), /end before a 0/],
    [new Uint8Array([1, 2, 3]), /not a compiled shape file/],
  ] as const) {
    assert.throws(
      () => parseShapes(bytes),
      (e: Error) => e instanceof RangeError && message.test(e.message),
    );
  }
});

const FENCE = shapeFile([[133, "CIRC1", [10, 1, -0x40, 0]]]);

function fence(): Drawing {
  const d = createDrawing({ units: "in" });
  d.linetype({
    name: "FENCE",
    pattern: [0.25, -0.1, -0.1, 1],
    marks: [{ after: 1, shape: 133, file: "fence.shx", scale: 0.1, offset: [-0.1, 0] }],
  });
  d.line([0, 0], [2.6, 0], { linetype: "FENCE" });
  return d.build();
}

test("a linetype's shape is drawn from its file, found as the CAD app finds it, and a gap without", () => {
  const drawn = toSVG(fence(), { shapes: { FENCE: FENCE } });
  assert.match(drawn, / A 0\.1 0\.1 0 0 0 /);
  assert.doesNotMatch(toSVG(fence()), / A 0\.1 /);
  const warned = (shapes?: Record<string, Uint8Array>) =>
    lint(fence(), shapes ? { shapes } : {}).filter((d) => d.rule === "linetype-shape").length;
  assert.equal(warned(), 1);
  assert.equal(warned({ "Fence.SHX": FENCE }), 0);
  assert.equal(warned({ "fence.shx": shapeFile([[1, "OTHER", [0x10, 0]]]) }), 1);
});

test("a pattern that ends with a dash is fitted to its own first dash", () => {
  // 2.6 holds one pattern of 1.45: its first and last dashes are each (0.25 + 2.6 - 1.45) / 2.
  const d = createDrawing({ units: "in" });
  d.linetype({ name: "LONG", pattern: [0.25, -0.1, -0.1, 1] });
  d.line([0, 0], [2.6, 0], { linetype: "LONG" });
  const path = /d="([^"]+)"/.exec(toSVG(d.build(), { margin: 0 }))?.[1] ?? "";
  const xs = [...path.matchAll(/[ML] (-?[\d.]+) /g)].map((m) => Number(m[1]));
  assert.deepEqual(xs, [0, 0.7, 0.9, 1.9, 1.9, 2.6]);
});

test("parseLinetypes numbers a shape by its name in the file given, in any case", () => {
  const text = "*FENCE,Fence\nA,.25,-.1,[circ1,fence,s=.1,x=-.1],-.1,1\n";
  const [named] = parseLinetypes(text);
  assert.equal(named?.marks?.[0] && "shape" in named.marks[0] && named.marks[0].shape, "circ1");
  const [numbered] = parseLinetypes(text, { shapes: { "fence.shx": FENCE } });
  assert.equal(
    numbered?.marks?.[0] && "shape" in numbered.marks[0] && numbered.marks[0].shape,
    133,
  );
  assert.throws(
    () => parseLinetypes(text, { shapes: { "fence.shx": shapeFile([[1, "BOX", [0x10, 0]]]) } }),
    /line 2 of the linetype file: the shape file fence has no shape circ1/,
  );
});

test("a shape file whose shapes draw a shape many times over is refused, and quickly", () => {
  // Each of three shapes draws the next 600 times: 216 million calls unbounded.
  const fan = (next: number) => Array.from({ length: 600 }, () => [7, next]).flat();
  const started = performance.now();
  assert.throws(
    () =>
      parseShapes(
        shapeFile([
          [1, "A", [...fan(2), 0]],
          [2, "B", [...fan(3), 0]],
          [3, "C", [...fan(4), 0]],
          [4, "D", [0]],
        ]),
      ),
    /more than 5000000 codes/,
  );
  assert.ok(performance.now() - started < 5000);
  assert.equal(parseLinetypes("*X\nA,1,-1\n", null as never).length, 1);
});

test("a polyline's clockwise arc is cut the way the polyline runs", () => {
  const d = createDrawing({ units: "in" });
  d.linetype({ name: "ASYM", pattern: [1, -1, 2, -2, 3] });
  d.polyline(
    [
      [0, 0],
      [6, 0],
    ],
    false,
    { linetype: "ASYM", bulges: [-1] },
  );
  // Its first dash, (1 + 3π - 9) / 2 long, starts where the polyline does.
  const path = /d="([^"]+)"/.exec(toSVG(d.build(), { margin: 0 }))?.[1] ?? "";
  assert.match(path, /^M 0 0 A 3 3 0 0 0 /);
});

test("parseLinetypes reads the files it is given within one budget, whatever their names", () => {
  // About 4.3 million codes: one file is within SHAPE_STEPS, two copies are not.
  const calls = (next: number) => Array.from({ length: 1200 }, () => [7, next]).flat();
  const big = shapeFile([
    [1, "A", [...calls(2), 0]],
    [2, "B", [...calls(3), 0]],
    [3, "C", [0]],
  ]);
  const text = "*L0\nA,1,[A,f0],-1\n*L1\nA,1,[A,f1],-1\n";
  assert.equal(parseLinetypes(text, { shapes: { f0: big } }).length, 2);
  assert.throws(
    () => parseLinetypes(text, { shapes: { f0: big, f1: new Uint8Array(big) } }),
    /line 4 of the linetype file: the shape file f1 does not read: .*more than 5000000 codes/,
  );
});

test("hostile shape inputs are refused with RangeError, and one file under two names is read once", () => {
  assert.throws(() => parseShapes(new Proxy(FENCE, {})), RangeError);
  const throwing = Object.defineProperty({}, "fence", {
    enumerable: true,
    get: () => {
      throw null;
    },
  });
  assert.throws(() => toSVG(fence(), { shapes: throwing }), RangeError);
  assert.throws(() => parseLinetypes("*X\nA,1,-1\n", { shapes: throwing }), RangeError);
  assert.ok(lint(fence(), { shapes: throwing }).some((d) => d.rule === "linetype-shape"));
  // About 4.3 million codes, within SHAPE_STEPS once: both names draw from the one read.
  const calls = (next: number) => Array.from({ length: 1200 }, () => [7, next]).flat();
  const big = shapeFile([
    [133, "CIRC1", [10, 1, -0x40 & 255, 0]],
    [1, "A", [...calls(2), 0]],
    [2, "B", [...calls(3), 0]],
    [3, "C", [0]],
  ]);
  assert.equal(
    lint(fence(), { shapes: { fence: big, "./fence": big } }).filter(
      (d) => d.rule === "linetype-shape",
    ).length,
    0,
  );
});

test("a file of many shapes given under many names is tabled once", () => {
  const many = shapeFile(Array.from({ length: 20000 }, (_, i) => [i + 1, `S${i}`, [0x10, 0]]));
  const names = Array.from({ length: 2000 }, (_, i) => `f${i}`);
  const shapes = Object.fromEntries(names.map((n) => [n, many]));
  const started = performance.now();
  const d = createDrawing({ units: "in" });
  for (const [i, n] of names.entries())
    d.linetype({
      name: `L${i}`,
      pattern: [1, -1],
      marks: [{ after: 0, shape: 1, file: n, scale: 0.1 }],
    });
  d.line([0, 0], [3, 0], { linetype: "L0" });
  const drawing = d.build();
  assert.equal(lint(drawing, { shapes }).filter((x) => x.rule === "linetype-shape").length, 0);
  toSVG(drawing, { shapes });
  parseLinetypes(names.map((n) => `*${n}\nA,1,[S1,${n}],-1\n`).join(""), { shapes });
  assert.ok(performance.now() - started < 10000);
});
