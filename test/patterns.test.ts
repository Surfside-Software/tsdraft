import assert from "node:assert/strict";
import { test } from "node:test";
import { createDrawing, readDXF, toDXF, toSVG, type Drawing, type Point } from "../src/index.ts";
import { lintWithin } from "../src/lint.ts";
import { svgWithin } from "../src/svg.ts";
import { timeLimit } from "./time-limit.ts";

/** How many strokes a hatch's pattern draws in the plot. */
function strokes(loops: { points: Point[]; bulges?: number[] }[], pattern: object): number {
  const d = createDrawing({ units: "in" });
  d.hatch(loops, { pattern } as never);
  const found = /<path d="([^"]*)"[^>]*data-hatch/.exec(toSVG(d.build()));
  return found ? (found[1]!.match(/M /g) ?? []).length : 0;
}

test("a pattern is cut to the loops as the file holds them, far from the origin and on an arc", () => {
  // Seven lines inside, none on the edges, however far the hatch lies from the origin.
  const far: Point[] = [
    [1e9, 0],
    [1e9 + 10, 0],
    [1e9 + 10, 2],
    [1e9, 2],
  ];
  assert.equal(strokes([{ points: far }], { spacing: 0.25 }), 7);
  // The top edge is written at 7, where a line runs along it and draws nothing.
  const rounded: Point[] = [
    [1, 6],
    [5, 6],
    [5, 7.0000004],
    [1, 7.0000004],
  ];
  assert.equal(strokes([{ points: rounded }], { spacing: 1 }), 0);
  // A thin rectangle as far from the origin as near it.
  const thin = (x: number): Point[] => [
    [x, 0],
    [x + 10, 0],
    [x + 10, 0.000006],
    [x, 0.000006],
  ];
  assert.equal(strokes([{ points: thin(0) }], { spacing: 0.000001 }), 5);
  assert.equal(strokes([{ points: thin(1e9) }], { spacing: 0.000001 }), 5);
  // A line that only touches a circle draws nothing there: only the diameter is drawn.
  const unit: Point[] = [
    [-1, 0],
    [1, 0],
  ];
  assert.equal(strokes([{ points: unit, bulges: [1, 1] }], { spacing: 1 }), 1);
  // A line just under a circle's top crosses it, and draws its short chord.
  const circle: Point[] = [
    [11, 5.98],
    [15, 6.02],
  ];
  assert.equal(
    strokes([{ points: circle, bulges: [1, 1] }], { spacing: 0.2, origin: [0, 8.00004] }),
    21,
  );
});

test("a pattern's lines that do not follow their counts make the hatch malformed", async () => {
  const d = createDrawing({ units: "in" });
  d.hatch(
    [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    { pattern: { spacing: 0.1, crossed: true } },
  );
  const dxf = toDXF(d.build());
  const at = dxf.lastIndexOf("AcDbHatch");
  for (const [from, to] of [
    ["78\r\n2\r\n", "78\r\n3\r\n"],
    ["78\r\n2\r\n", "78\r\n1\r\n"],
    ["79\r\n0\r\n", "79\r\n2\r\n"],
    ["79\r\n0\r\n", "79\r\n0\r\n49\r\n1\r\n"],
  ] as const) {
    const bent = dxf.slice(0, at) + dxf.slice(at).replace(from, to);
    assert.notEqual(bent, dxf);
    const read = await readDXF(bent, { geometry: true });
    assert.deepEqual(JSON.parse(JSON.stringify(read.unread.malformed)), {
      "HATCH whose pattern lines do not follow their counts": 1,
    });
  }
});

test("a pattern whose lines would be written as 1e+100 is refused, and its repeats are paid for", () => {
  const square: Point[] = [
    [0, 0],
    [1, 0],
    [1, 1],
  ];
  const huge: Drawing = {
    ...createDrawing({ units: "in" }).build(),
    patterns: [
      {
        name: "HUGE",
        lines: [{ angle: 0, base: [0, 0], offset: [0, 1], dashes: [9.999999999999998e99, -1] }],
      },
    ],
    entities: [
      { kind: "hatch", layer: "0", loops: [{ points: square }], pattern: { name: "HUGE" } },
    ],
  };
  assert.throws(() => toDXF(huge), /1e100/);
  // One family of 32,767 dashes that 1,000 hatches name: lint pays for each hatch's.
  const dashes = Array.from({ length: 32_767 }, (_, i) => (i % 2 === 0 ? 1 : -1));
  const many: Drawing = {
    ...huge,
    patterns: [{ name: "LONG", lines: [{ angle: 0, base: [0, 0], offset: [0, 1], dashes }] }],
    entities: Array.from({ length: 1000 }, () => ({
      kind: "hatch" as const,
      layer: "0",
      loops: [{ points: square }],
      pattern: { name: "LONG" },
    })),
  };
  assert.ok(lintWithin(many, {}, 100_000).some((found) => found.rule === "check-capped"));
});

test("a line that crosses a thousand holes is cut in time", () => {
  const holes = Array.from({ length: 1024 }, (_, i) => ({
    points: [
      [2 * i + 1, 0],
      [2 * i + 2, 0],
      [2 * i + 2, 0.5],
      [2 * i + 1, 0.5],
    ] as Point[],
  }));
  const d = createDrawing({ units: "in" });
  d.hatch(
    [
      {
        points: [
          [0, -1],
          [2050, -1],
          [2050, 1],
          [0, 1],
        ],
      },
      ...holes,
    ],
    { pattern: { spacing: 0.25 } },
  );
  const started = performance.now();
  const found = (() => {
    try {
      return svgWithin(d.build(), {}, 20_000);
    } catch (error) {
      return error;
    }
  })();
  assert.ok(typeof found === "string" || found instanceof RangeError, String(found));
  assert.ok(performance.now() - started < timeLimit(2000));
});

test("holes along an edge the lines run on are cut in time", () => {
  // Each triangle's base lies on the outline's bottom edge, which a line runs along whole.
  const count = 32_000;
  const width = 2 * count + 2;
  const holes = Array.from({ length: count }, (_, i) => ({
    points: [
      [2 * i + 1, 0],
      [2 * i + 2, 0],
      [2 * i + 1.5, 0.5],
    ] as Point[],
  }));
  const drawing: Drawing = {
    ...createDrawing({ units: "in" }).build(),
    entities: [
      {
        kind: "hatch",
        layer: "0",
        loops: [
          {
            points: [
              [0, 0],
              [width, 0],
              [width, 3],
              [0, 3],
            ],
          },
          ...holes,
        ],
        pattern: { spacing: 1 },
      },
    ],
  };
  const started = performance.now();
  toSVG(drawing);
  assert.ok(performance.now() - started < timeLimit(2000));
});
