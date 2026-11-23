import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDrawing,
  DrawingError,
  fromJSON,
  lint,
  parseLinetypes,
  parseShx,
  toJSON,
  toSVG,
  type Drawing,
} from "../src/index.ts";
import { dataOf, wrong, type Data, type Field } from "./values.ts";

/** A compiled shape file of the given shapes: number, name and codes, as a compiler writes it. */
function shxBytes(glyphs: readonly [number, string, readonly number[]][], kind = "shapes 1.0") {
  const bytes: number[] = [...`Test-86 ${kind}\r\n\x1a`].map((c) => c.charCodeAt(0));
  const u16 = (v: number) => bytes.push(v & 255, v >> 8);
  const numbers = glyphs.map(([n]) => n);
  u16(Math.min(...numbers));
  u16(Math.max(...numbers));
  u16(glyphs.length);

  for (const [n, name, codes] of glyphs) {
    u16(n);
    u16(name.length + 1 + codes.length);
  }

  for (const [, name, codes] of glyphs)
    bytes.push(...[...name].map((c) => c.charCodeAt(0)), 0, ...codes.map((c) => c & 255));
  bytes.push(...[..."EOF"].map((c) => c.charCodeAt(0)));

  return new Uint8Array(bytes);
}

const round = (points: readonly (readonly [number, number])[]) =>
  points.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);

test("parseShx draws each code as the leading CAD app plots it", () => {
  const { glyphs } = parseShx(
    shxBytes([
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

  const [pen, pop, vert, frac, dot] = glyphs;
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

test("parseShx refuses what is not a shape file of its kind, and a shape that draws itself", () => {
  for (const [bytes, message] of [
    [shxBytes([[1, "A", [0x10, 0]]], "unifont 1.0"), /unifont kind/],
    [shxBytes([[1, "A", [0x10, 0]]], "shapes 1.1"), /only shapes 1.0/],
    [
      shxBytes([
        [1, "A", [7, 2, 0]],
        [2, "B", [7, 1, 0]],
      ]),
      /draws itself/,
    ],
    [shxBytes([[1, "A", [6, 0]]]), /never pushed/],
    [shxBytes([[1, "A", [0x10]]]), /end before a 0/],
    [new Uint8Array([1, 2, 3]), /not a compiled shape file/],
  ] as const) {
    assert.throws(
      () => parseShx(bytes),
      (e: Error) => e instanceof RangeError && message.test(e.message),
    );
  }
});

const FENCE = shxBytes([[133, "CIRC1", [10, 1, -0x40, 0]]]);

function fence(): Drawing {
  const d = createDrawing({ units: "in" });
  d.linetype({
    name: "FENCE",
    pattern: [0.25, -0.1, -0.1, 1],
    marks: [{ after: 1, glyph: 133, file: "fence.shx", scale: 0.1, offset: [-0.1, 0] }],
  });
  d.line([0, 0], [2.6, 0], { linetype: "FENCE" });

  return d.build();
}

test("a linetype's shape is drawn from its file, found as the CAD app finds it, and a gap without", () => {
  const drawn = toSVG(fence(), { shx: { FENCE: FENCE } });
  assert.match(drawn, / A 0\.1 0\.1 0 0 0 /);
  assert.doesNotMatch(toSVG(fence()), / A 0\.1 /);

  const warned = (shx?: Record<string, Uint8Array>) =>
    lint(fence(), shx ? { shx } : {}).filter((d) => d.rule === "linetype-shape").length;

  assert.equal(warned(), 1);
  assert.equal(warned({ "Fence.SHX": FENCE }), 0);
  assert.equal(warned({ "fence.shx": shxBytes([[1, "OTHER", [0x10, 0]]]) }), 1);
});

test("fromJSON refuses a drawing saved before the SHX names, and says the mark's field is glyph", () => {
  const saved = toJSON(fence());
  const older = saved.replace('"glyph":133', '"shape":133');
  assert.notEqual(older, saved);

  const refused = (json: string | Data) => {
    try {
      fromJSON(json);
    } catch (thrown) {
      assert.ok(thrown instanceof DrawingError);

      return thrown.diagnostics.map((d) => d.message);
    }

    assert.fail("fromJSON read it");
  };

  const parsed: Data = JSON.parse(older);

  for (const json of [older, parsed]) {
    assert.deepEqual(refused(json), ['linetypes[0].marks[0]: "shape" is now "glyph"']);
  }

  // A mark that gives both is refused as any field nobody knows.
  const both = saved.replace('"glyph":133', '"glyph":133,"shape":133');
  assert.match(refused(both)[0] ?? "", /linetypes\[0\]\.marks\[0\]: unknown field "shape"/);
});

test("fromJSON refuses an empty slot or a getter in linetypes or marks where its walk meets it", () => {
  const drawing = (linetypes: Field): Data => ({ ...dataOf(fence()), linetypes });
  const marked = (marks: Field) => drawing([{ name: "M", description: "", pattern: [1], marks }]);
  const getter: Field[] = [];

  Object.defineProperty(getter, 0, {
    enumerable: true,
    get: () => {
      throw new Error("read");
    },
  });

  for (const [value, message] of [
    [drawing(new Array(2 ** 32 - 1)), "linetypes has no item at index 0"],
    [marked(new Array(2 ** 32 - 1)), "linetypes[0].marks has no item at index 0"],
    [drawing(getter), "linetypes[0] must be a plain value, not a getter or setter"],
    [marked(getter), "linetypes[0].marks[0] must be a plain value, not a getter or setter"],
  ] as const) {
    assert.throws(
      () => fromJSON(value),
      (thrown) => thrown instanceof DrawingError && thrown.message.includes(message),
    );
  }
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
  assert.equal(named?.marks?.[0] && "glyph" in named.marks[0] && named.marks[0].glyph, "circ1");
  const [numbered] = parseLinetypes(text, { shx: { "fence.shx": FENCE } });
  assert.equal(
    numbered?.marks?.[0] && "glyph" in numbered.marks[0] && numbered.marks[0].glyph,
    133,
  );
  assert.throws(
    () => parseLinetypes(text, { shx: { "fence.shx": shxBytes([[1, "BOX", [0x10, 0]]]) } }),
    /line 2 of the linetype file: the shape file fence has no shape circ1/,
  );
});

test("a shape file whose shapes draw a shape many times over is refused, and quickly", () => {
  // Each of three shapes draws the next 600 times: 216 million calls unbounded.
  const fan = (next: number) => Array.from({ length: 600 }, () => [7, next]).flat();
  const started = performance.now();
  assert.throws(
    () =>
      parseShx(
        shxBytes([
          [1, "A", [...fan(2), 0]],
          [2, "B", [...fan(3), 0]],
          [3, "C", [...fan(4), 0]],
          [4, "D", [0]],
        ]),
      ),
    /more than 5000000 codes/,
  );
  assert.ok(performance.now() - started < 5000);
  assert.equal(parseLinetypes("*X\nA,1,-1\n", wrong(null)).length, 1);
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
  // About 4.3 million codes: one file is within SHX_STEPS, two copies are not.
  const calls = (next: number) => Array.from({ length: 1200 }, () => [7, next]).flat();

  const big = shxBytes([
    [1, "A", [...calls(2), 0]],
    [2, "B", [...calls(3), 0]],
    [3, "C", [0]],
  ]);

  const text = "*L0\nA,1,[A,f0],-1\n*L1\nA,1,[A,f1],-1\n";
  assert.equal(parseLinetypes(text, { shx: { f0: big } }).length, 2);
  assert.throws(
    () => parseLinetypes(text, { shx: { f0: big, f1: new Uint8Array(big) } }),
    /line 4 of the linetype file: the shape file f1 does not read: .*more than 5000000 codes/,
  );
});

test("hostile shape inputs are refused with RangeError, and one file under two names is read once", () => {
  assert.throws(() => parseShx(new Proxy(FENCE, {})), RangeError);

  const throwing = Object.defineProperty({}, "fence", {
    enumerable: true,
    get: () => {
      throw null;
    },
  });

  assert.throws(() => toSVG(fence(), { shx: throwing }), RangeError);
  assert.throws(() => parseLinetypes("*X\nA,1,-1\n", { shx: throwing }), RangeError);
  assert.ok(lint(fence(), { shx: throwing }).some((d) => d.rule === "linetype-shape"));
  // About 4.3 million codes, within SHX_STEPS once: both names draw from the one read.
  const calls = (next: number) => Array.from({ length: 1200 }, () => [7, next]).flat();

  const big = shxBytes([
    [133, "CIRC1", [10, 1, -0x40 & 255, 0]],
    [1, "A", [...calls(2), 0]],
    [2, "B", [...calls(3), 0]],
    [3, "C", [0]],
  ]);

  assert.equal(
    lint(fence(), { shx: { fence: big, "./fence": big } }).filter(
      (d) => d.rule === "linetype-shape",
    ).length,
    0,
  );
});

test("a file of many shapes given under many names is tabled once", () => {
  const many = shxBytes(Array.from({ length: 20000 }, (_, i) => [i + 1, `S${i}`, [0x10, 0]]));
  const names = Array.from({ length: 2000 }, (_, i) => `f${i}`);
  const shx = Object.fromEntries(names.map((n) => [n, many]));
  const started = performance.now();
  const d = createDrawing({ units: "in" });

  for (const [i, n] of names.entries())
    d.linetype({
      name: `L${i}`,
      pattern: [1, -1],
      marks: [{ after: 0, glyph: 1, file: n, scale: 0.1 }],
    });
  d.line([0, 0], [3, 0], { linetype: "L0" });
  const drawing = d.build();
  assert.equal(lint(drawing, { shx }).filter((x) => x.rule === "linetype-shape").length, 0);
  toSVG(drawing, { shx });
  parseLinetypes(names.map((n) => `*${n}\nA,1,[S1,${n}],-1\n`).join(""), { shx });
  assert.ok(performance.now() - started < 10000);
});
