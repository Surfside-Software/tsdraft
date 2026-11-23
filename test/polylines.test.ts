import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bulgeThrough,
  checkIntent,
  createDrawing,
  DrawingError,
  lint,
  polylineBox,
  readDXF,
  toDXF,
  toPDF,
  toSVG,
  type Drawing,
  type Point,
  type Polyline,
} from "../src/index.ts";
import { wrong, type Data } from "./values.ts";
import { polylineBands, polylineSides, sideArc } from "../src/polylines.ts";
import { svgWithin } from "../src/svg.ts";

const near = (a: number, b: number, tolerance = 1e-9): boolean => Math.abs(a - b) <= tolerance;

const nearPoint = (a: Point, b: Point, tolerance = 1e-9): boolean =>
  near(a[0], b[0], tolerance) && near(a[1], b[1], tolerance);

/** The polylines a drawing holds in model space. */
const polylines = (drawing: Drawing): Polyline[] =>
  drawing.entities.filter((e): e is Polyline => e.kind === "polyline");

test("bulgeThrough gives the arc that passes through the middle point", () => {
  // A positive bulge turns counterclockwise, which bulges to the right of the way it runs.
  assert.ok(near(bulgeThrough([0, 0], [1, -1], [2, 0]), 1));
  assert.ok(near(bulgeThrough([0, 0], [1, 1], [2, 0]), -1));
  assert.equal(bulgeThrough([0, 0], [1, 0], [2, 0]), 0);
  const through: Point = [3, 4];
  const arc = sideArc([0, 0], [7, 1], bulgeThrough([0, 0], through, [7, 1]))!;
  assert.ok(near(Math.hypot(through[0] - arc.center[0], through[1] - arc.center[1]), arc.radius));
  assert.throws(() => bulgeThrough([0, 0], [3, 0], [2, 0]), /on one line/);
  assert.throws(() => bulgeThrough([0, 0], [0, 0], [2, 0]), /three different points/);
});

test("a radius rounds each corner with an arc tangent to both sides, and refuses one too large", () => {
  const d = createDrawing();
  d.polyline(
    [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
    false,
    { radius: 2, width: 0.5 },
  );
  d.rect([20, 0], 6, 4, { radius: 2 });
  const [hook, rect] = polylines(d.build());

  const corners: Point[] = [
    [0, 0],
    [8, 0],
    [10, 2],
    [10, 10],
  ];

  assert.ok(
    hook!.points.every((p, i) => nearPoint(p, corners[i]!)),
    `${hook!.points}`,
  );
  assert.ok(near(hook!.bulges![1]!, Math.tan(Math.PI / 8)));
  assert.deepEqual([hook!.bulges![0], hook!.bulges![2], hook!.width], [0, 0, 0.5]);
  // Sides of the rectangle that the arcs use up leave no straight side between them.
  assert.equal(rect!.points.length, 6);
  assert.equal(rect!.bulges!.filter((bulge) => bulge !== 0).length, 4);
  assert.throws(
    () =>
      d.polyline(
        [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
        false,
        { radius: 2 },
      ),
    /need 2 of the side between them, which is 1 long/,
  );
  assert.throws(
    () =>
      d.polyline(
        [
          [0, 0],
          [5, 0],
          [5, 5],
        ],
        false,
        { radius: 1, bulges: [0, 0] },
      ),
    /takes no bulges or widths/,
  );
});

test("a cloud's arcs turn 110 degrees, bulge out of its outline, and stay beside their stretch", () => {
  const square: Point[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];

  const d = createDrawing();
  d.cloud(square, { arc: 2.4 });
  d.cloud([...square].reverse(), { arc: 2.4 });
  const [counterclockwise, clockwise] = polylines(d.build());
  assert.equal(counterclockwise!.points.length, 16);
  assert.ok(counterclockwise!.bulges!.every((b) => near(b, Math.tan((27.5 * Math.PI) / 180))));
  assert.ok(clockwise!.bulges!.every((b) => near(b, -Math.tan((27.5 * Math.PI) / 180))));

  for (const cloud of [counterclockwise!, clockwise!]) {
    for (const side of polylineSides(cloud)) {
      const arc = sideArc(side.from, side.to, side.bulge)!;

      const [x, y] = [
        arc.center[0] + arc.radius * Math.cos(arc.start + arc.sweep / 2),
        arc.center[1] + arc.radius * Math.sin(arc.start + arc.sweep / 2),
      ];

      assert.ok(x < 0 || x > 10 || y < 0 || y > 10, `the arc from ${side.from} bulges out`);
    }
  }

  assert.throws(() => d.cloud(square, { arc: 0.001 }), /would have 40000 arcs/);
  assert.throws(
    () =>
      d.cloud(
        [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        { arc: 1 },
      ),
    /must enclose an area/,
  );
});

test("a donut is two half circles as wide as its ring, and a dot has no hole", () => {
  const d = createDrawing();
  d.donut([5, 5], 2, { inside: 1 });
  d.donut([0, 0], 0.5);
  const [ring, dot] = polylines(d.build());
  assert.deepEqual(ring, {
    kind: "polyline",
    layer: "0",
    points: [
      [4.25, 5],
      [5.75, 5],
    ],
    closed: true,
    bulges: [1, 1],
    width: 0.5,
  });
  assert.deepEqual(
    [dot!.points, dot!.width],
    [
      [
        [-0.125, 0],
        [0.125, 0],
      ],
      0.25,
    ],
  );
  assert.throws(() => d.donut([0, 0], 1, { inside: 1 }), /less across than the donut/);
});

test("lint reports a malformed bulge or width, and an R12 drawing that has one", () => {
  const drawing = (fields: Data, dxf: "R12" | "R2018" = "R2018"): Drawing => ({
    format: 0,
    units: "in",
    dxf,
    layers: [{ name: "0", color: 7 }],
    entities: [
      wrong<Polyline>({
        kind: "polyline",
        layer: "0",
        points: [
          [0, 0],
          [10, 0],
          [10, 5],
        ],
        closed: false,
        ...fields,
      }),
    ],
  });

  const problems = (fields: Data, dxf?: "R12" | "R2018") =>
    lint(drawing(fields, dxf)).map((d) => `${d.rule}: ${d.message}`);

  assert.deepEqual(problems({ bulges: [0.5, 0, 1] }), [
    "geometry: polyline #0: its bulges must have one for each side, 2, and it has 3. A closed polyline has a side for each point, and an open one a side fewer",
  ]);
  assert.match(problems({ bulges: [0, Number.NaN] })[0]!, /its bulge 1: must be a finite number/);
  assert.match(problems({ bulges: [0, 1e100] })[0]!, /its bulge 1: This value must be under 1e100/);
  assert.match(problems({ width: -1 })[0]!, /its width: A polyline's width cannot be less than 0/);
  assert.match(
    problems({
      width: 1,
      widths: [
        [1, 1],
        [1, 1],
      ],
    })[0]!,
    /give one or the other/,
  );
  assert.match(
    problems({
      widths: [
        [1, 1],
        [0, -2],
      ],
    })[0]!,
    /its widths 1: A polyline's width/,
  );
  assert.match(problems({ widths: [[1, 1]] })[0]!, /its widths must have one for each side, 2/);
  assert.deepEqual(problems({ bulges: [0, 0.5], width: 0.1, widths: undefined }), []);
  assert.match(problems({ bulges: [0, 0.5] }, "R12")[0]!, /no arcs or widths of a polyline to R12/);
});

/** A polyline along +X to `[1, 0]` and on, turned `turn` degrees there, as `turn` gives an arc. */
function turned(turn: number, arc: boolean): Polyline {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const chord = radians(arc ? turn + 15 : turn);

  const polyline: Polyline = {
    kind: "polyline",
    layer: "0",
    points: [
      [0, 0],
      [1, 0],
      [1 + Math.cos(chord), Math.sin(chord)],
    ],
    closed: false,
    width: 0.1,
  };

  return arc ? { ...polyline, bulges: [0, Math.tan(radians(30) / 4)] } : polyline;
}

test("wide sides join as the leading CAD app plots them: a miter to 151.04 degrees, an arc's line to 75.96", () => {
  const ends = (e: Polyline): Point[] => {
    const [first] = polylineBands(polylineSides(e), e.closed);

    return [first!.endLeft, first!.endRight];
  };

  // Square ends are a half width from the point, square to the first side.
  const square: Point[] = [
    [1, 0.05],
    [1, -0.05],
  ];

  // A miter at a turn of 150 degrees and of 151.0, and none at 151.1.
  const miter = ends(turned(150, false));
  assert.ok(
    near(Math.hypot(miter[0]![0] - 1, miter[0]![1]), 0.05 / Math.cos((75 * Math.PI) / 180), 1e-5),
  );
  assert.ok(!nearPoint(ends(turned(151, false))[1]!, square[1]!));
  assert.deepEqual(ends(turned(151.1, false)), square);

  // A straight side meets an arc on the arc's line through the point at 75 and 105 degrees, and
  // ends square at 76 and 104.
  for (const turn of [75, 105]) {
    const [left] = ends(turned(turn, true));
    // The bulge is taken as written, to 6 decimals.
    assert.ok(near(left![0], 1 - 0.05 * Math.tan((turn * Math.PI) / 180), 1e-5), `${turn}`);
  }

  for (const turn of [76, 104]) assert.deepEqual(ends(turned(turn, true)), square, `${turn}`);
});

test("toDXF writes each side's bulge and widths, and readDXF gives them back", async () => {
  const d = createDrawing();
  d.polyline(
    [
      [0, 0],
      [10, 0],
      [10, 5],
    ],
    true,
    {
      bulges: [0, 0.5, -1],
      widths: [
        [0, 1],
        [1, 1],
        [0.5, 0],
      ],
    },
  );
  d.donut([20, 0], 2);
  const drawing = d.build();
  const dxf = toDXF(drawing);
  const lines = dxf.split(/\r?\n/).map((line) => line.trim());
  const pairs: string[] = [];

  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push(`${lines[i]} ${lines[i + 1]}`);
  const start = pairs.indexOf("0 LWPOLYLINE");
  const end = pairs.indexOf("0 LWPOLYLINE", start + 1);
  assert.deepEqual(pairs.slice(pairs.indexOf("90 3", start), end), [
    "90 3",
    "70 1",
    "10 0",
    "20 0",
    "40 0",
    "41 1",
    "10 10",
    "20 0",
    "40 1",
    "41 1",
    "42 0.5",
    "10 10",
    "20 5",
    "40 0.5",
    "41 0",
    "42 -1",
  ]);
  const read = await readDXF(dxf, { geometry: true });
  const [wide, donut] = read.model.entities ?? [];
  assert.deepEqual(wide?.kind === "polyline" && [wide.bulges, wide.widths, wide.width], [
    [0, 0.5, -1],
    [
      [0, 1],
      [1, 1],
      [0.5, 0],
    ],
    undefined,
  ]);
  assert.deepEqual(donut?.kind === "polyline" && [donut.bulges, donut.width], [[1, 1], 1]);
});

test("a polyline's box holds its arcs and its widths, and the picture fills a wide side", () => {
  const half: Polyline = {
    kind: "polyline",
    layer: "0",
    points: [
      [0, 0],
      [2, 0],
    ],
    closed: false,
    bulges: [1],
  };

  const boxed = (e: Polyline, box: readonly number[]): boolean =>
    polylineBox(e)!.every((value, i) => near(value, box[i]!, 1e-12));

  assert.ok(boxed(half, [0, -1, 2, 0]));
  assert.ok(boxed({ ...half, width: 0.5 }, [-0.25, -1.25, 2.25, 0]));
  const d = createDrawing();
  d.polyline(half.points, false, { bulges: [1] });
  d.polyline(
    [
      [0, 2],
      [4, 2],
    ],
    false,
    { width: 0.5 },
  );
  d.layout("SHEET", { paper: "ANSI B" }, () => d.donut([2, 2], 1));
  const drawing = d.build();
  const svg = toSVG(drawing);
  assert.match(svg, /<path d="M 0 0 A 1 1 0 0 1 2 0" /);
  assert.match(
    svg,
    /<path d="M 0 2.25 L 4 2.25 L 4 1.75 L 0 1.75" fill="currentColor" stroke="none" /,
  );
  // The plot takes each element the picture draws of them.
  assert.ok(toPDF(drawing).length > 0);
});

test("checkIntent does not take a footprint with an arc for its outline", () => {
  const d = createDrawing();
  d.rect([0, 0], 100, 100, { id: "lot" });
  d.rect([30, 30], 40, 40, { id: "house", radius: 5 });

  const [warning] = checkIntent(d.build(), {
    setbacks: [{ property: "lot", footprints: ["house"], distance: 10 }],
  });

  assert.equal(warning?.rule, "intent-unchecked");
  assert.match(warning?.message ?? "", /a side that is an arc/);
});

test("each join reads the sides' own edges, so a short jog keeps both miters", () => {
  const jog: Polyline = {
    kind: "polyline",
    layer: "0",
    points: [
      [0, 0],
      [10, 0],
      [10, 1],
      [20, 1],
    ],
    closed: false,
    width: 2,
  };

  const [, middle, last] = polylineBands(polylineSides(jog), false);
  assert.deepEqual(
    [middle!.startLeft, middle!.endLeft, last!.startLeft],
    [
      [9, 1],
      [9, 2],
      [9, 2],
    ],
  );
});

test("a radius that fits as written is taken, and a cloud that would cross its outline is not", () => {
  const d = createDrawing();
  d.rect([0, 0], 0.9999999, 2, { radius: 0.5 });

  const notched: Point[] = [
    [0, 0],
    [12, 0],
    [12, 10],
    [7, 10],
    [7, 2],
    [5, 2],
    [5, 10],
    [0, 10],
  ];

  assert.throws(() => d.cloud(notched, { arc: 8 }), /reaches across the outline/);
  d.cloud(notched, { arc: 1 });
});

test("a dashed wide arc too long for its pattern draws the whole polyline solid", () => {
  const d = createDrawing();
  d.linetype({ name: "FINE", description: "", pattern: [0.05, -0.05] });
  d.polyline(
    [
      [0, 0],
      [636, 0],
      [650, 0],
    ],
    false,
    { bulges: [1, 0], width: 2, linetype: "FINE" },
  );
  const svg = toSVG(d.build());
  // Two filled sides and no dash: the arc's outer edge holds more than 10,000 patterns.
  assert.equal(svg.match(/fill="currentColor" stroke="none"/g)?.length, 2);
});

test("readDXF takes a point's bulge and widths in any order up to the next point", async () => {
  const dxf = [
    "0",
    "SECTION",
    "2",
    "ENTITIES",
    "0",
    "LWPOLYLINE",
    "8",
    "0",
    "90",
    "2",
    "70",
    "0",
    "10",
    "0",
    "42",
    "1",
    "40",
    "2",
    "41",
    "3",
    "20",
    "0",
    "10",
    "10",
    "20",
    "0",
    "0",
    "ENDSEC",
    "0",
    "EOF",
    "",
  ].join("\n");

  const [read] = (await readDXF(dxf, { geometry: true })).model.entities ?? [];
  assert.deepEqual(read?.kind === "polyline" && [read.bulges, read.widths], [[1], [[2, 3]]]);
});

test("the box holds where a dash ends square, and an arc is worked out from its points as written", () => {
  const joined: Polyline = {
    kind: "polyline",
    layer: "0",
    points: [
      [0, 0],
      [4, 0],
      [0, -4],
    ],
    closed: false,
    widths: [
      [0.5, 0.5],
      [1, 1],
    ],
  };

  assert.ok(polylineBox(joined)![3] >= 0.5 * Math.SQRT1_2 - 1e-12);

  // The second point is written as 0.000001, which makes the arc nearly a whole circle, 0.5
  // across.
  const tiny: Polyline = {
    kind: "polyline",
    layer: "0",
    points: [
      [0, 0],
      [0.0000006, 0],
    ],
    closed: false,
    bulges: [1e6],
  };

  assert.ok(near(polylineBox(tiny)![1], -0.5, 1e-6));
});

test("a cloud far from the origin is as a cloud at it, and arcs that meet keep one point as written", () => {
  const d = createDrawing();

  const square = (at: number): Point[] => [
    [at, at],
    [at + 1.1, at],
    [at + 1.1, at + 1.1],
    [at, at + 1.1],
  ];

  d.cloud(square(0), { arc: 0.22 });
  d.cloud(square(10_000_000), { arc: 0.22 });
  const [near0, far] = polylines(d.build());
  assert.deepEqual(far!.bulges, near0!.bulges);
  d.cloud(
    [
      [0, 0],
      [10, 1],
      [10, 8],
      [0, 8],
    ],
    { arc: 3 },
  );

  // A turned lot, at the origin and at a survey's coordinates, with several arcs on each side,
  // whose points between its corners are written off its slanted sides.
  for (const [x, y] of [
    [0, 0],
    [512345.67, 2876543.21],
  ]) {
    const lot: Point[] = [
      [0, 0],
      [37.3, 11.2],
      [30.1, 40.7],
      [-5.4, 28.9],
    ];

    d.cloud(
      lot.map(([px, py]): Point => [px + x!, py + y!]),
      { arc: 3 },
    );
  }

  // Arcs that meet exactly, or end a unit of the last decimal past each other as written, keep one
  // point where they meet, wherever the slot is: no side runs back.
  d.rect([0.0000004, 0], 1, 2, { radius: 0.5000002 });
  d.rect([897104.048729, 623613.643646], 16.362579, 2.210141, { radius: 2.210141 / 2 });

  for (const slot of polylines(d.build()).slice(-2)) {
    assert.equal(slot.bulges!.filter((bulge) => bulge !== 0).length, 4);
    assert.equal(slot.points.length, 6);
  }

  assert.throws(() => d.rect([0, 0], 1, 2, { radius: 0.6 }), /need 1.2 of the side/);
  assert.throws(() => d.donut([0, 0], 1, { inside: 0.9999991 }), /too small for the 6 decimals/);
  assert.throws(() => d.donut([0, 0], 0.0000024), /too small for the 6 decimals/);
});

test("toSVG pays for a long list that one polyline after another reads again", () => {
  // One list of points that draws nothing, each side of no length, which two polylines share.
  const points = Array.from({ length: 1000 }, (): Point => [1, 1]);

  const wide = (width: number): Polyline => ({
    kind: "polyline",
    layer: "0",
    points,
    closed: false,
    width,
  });

  const sheet = (entities: Polyline[]): Drawing => ({
    format: 0,
    units: "in",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    entities: [],
    layouts: [{ name: "SHEET", paper: "ANSI B", viewports: [], entities }],
  });

  assert.ok(svgWithin(sheet([wide(0.1)]), { layout: "SHEET" }, 20).length > 0);
  assert.throws(
    () => svgWithin(sheet([wide(0.1), wide(0.2)]), { layout: "SHEET" }, 20),
    /stopped at entity #1 of layout "SHEET"/,
  );
});

test("an arc of more than half a turn is drawn in two halves, so none vanishes", () => {
  const d = createDrawing();
  d.block("RING", {}, () =>
    d.polyline(
      [
        [0, 0],
        [0.000001, 0],
      ],
      false,
      { bulges: [1e6], width: 0.1 },
    ),
  );
  d.insert("RING", [0, 0], { scale: 0.1 });

  const ring = toSVG(d.build())
    .split("\n")
    .find((line) => line.includes('fill="currentColor"'))!;

  // Each edge of the band is two arcs.
  assert.equal(ring.match(/ A /g)?.length, 4);
});

test("readDXF gives a 2D polyline's vertex with no widths the polyline's own", async () => {
  const dxf = [
    ["0", "SECTION"],
    ["2", "ENTITIES"],
    ["0", "POLYLINE"],
    ["8", "0"],
    ["66", "1"],
    ["70", "0"],
    ["40", "0.5"],
    ["41", "0.25"],
    ["0", "VERTEX"],
    ["8", "0"],
    ["10", "0"],
    ["20", "0"],
    ["42", "1"],
    ["0", "VERTEX"],
    ["8", "0"],
    ["10", "10"],
    ["20", "0"],
    ["40", "2"],
    ["0", "VERTEX"],
    ["8", "0"],
    ["10", "20"],
    ["20", "0"],
    ["0", "SEQEND"],
    ["0", "ENDSEC"],
    ["0", "EOF"],
  ]
    .flat()
    .join("\n");

  const [read] = (await readDXF(dxf, { geometry: true })).model.entities ?? [];
  assert.deepEqual(read?.kind === "polyline" && [read.bulges, read.widths], [
    [1, 0],
    [
      [0.5, 0.25],
      [2, 0.25],
    ],
  ]);
});

test("lint stops where toDXF would, on polylines whose boxes pay for a list read again", () => {
  const points = Array.from({ length: 11_000 }, (_, i): Point => [i, i % 2]);

  const drawing: Drawing = {
    format: 0,
    units: "in",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    entities: Array.from({ length: 100 }, (_, k): Polyline => ({
      kind: "polyline",
      layer: "0",
      points,
      closed: false,
      width: k + 1,
    })),
  };

  const capped = lint(drawing).filter((d) => d.rule === "check-capped");
  assert.equal(capped.length, 1);
  assert.throws(
    () => toDXF(drawing),
    (thrown) =>
      thrown instanceof DrawingError && thrown.diagnostics.some((d) => d.rule === "check-capped"),
  );
});

test("a side of a polyline too fine for its pattern as an uneven insert draws it is drawn solid", () => {
  const drawing = wrong<Drawing>({
    format: 0,
    units: "in",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    linetypes: [{ name: "FINE", description: "", pattern: [0.05, -0.05] }],
    blocks: [
      {
        name: "B",
        entities: [
          {
            kind: "polyline",
            layer: "0",
            linetype: "FINE",
            points: [
              [0, 0],
              [480, 0],
              [480, 1],
            ],
            closed: false,
            width: 1,
          },
        ],
      },
    ],
    entities: [{ kind: "insert", layer: "0", block: "B", at: [0, 0], scale: [4, 1] }],
  });

  // The long side, 1,920 long as drawn and too fine to dash, is filled whole beside the short one.s dashes.
  assert.ok(/<path d="M 0 0\.5 L 1920 0\.5 L 1920 -0\.5 L 0 -0\.5"/.test(toSVG(drawing)));
});
