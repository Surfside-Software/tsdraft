import assert from "node:assert/strict";
import { test } from "node:test";
import { checkIntent, createDrawing, type Drawing, type Intent, type Point } from "../src/index.ts";
import sheet, { intent as sheetIntent } from "../examples/site-plan.ts";

/** Each warning as its rule, the side or the id it names, and the distance it measured. */
const found = (drawing: Drawing, intent: Intent) =>
  checkIntent(drawing, intent).map((w) => [
    w.rule,
    w.side ?? w.id,
    w.provided === undefined ? undefined : Number(w.provided.toFixed(6)),
  ]);

/** A drawing of a lot and footprints, each a closed polyline with its id. */
function site(outlines: Readonly<Record<string, readonly Point[]>>): Drawing {
  const d = createDrawing();
  for (const [id, points] of Object.entries(outlines)) d.polyline(points, true, { id });
  return d.build();
}

/** A rectangle from its lower-left corner to its upper-right, counterclockwise. */
const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** A circle as a polygon of `n` corners. */
const circle = (r: number, n: number, center: Point = [0, 0]): Point[] =>
  Array.from({ length: n }, (_, i): Point => [
    center[0] + r * Math.cos((2 * Math.PI * i) / n),
    center[1] + r * Math.sin((2 * Math.PI * i) / n),
  ]);

/** Points turned about the origin by `angle` radians, then moved to `origin`. */
const turned = (points: readonly Point[], angle: number, origin: Point): Point[] =>
  points.map(([x, y]): Point => [
    origin[0] + x * Math.cos(angle) - y * Math.sin(angle),
    origin[1] + x * Math.sin(angle) + y * Math.cos(angle),
  ]);

/** The angles the rounding tests turn a lot by: 199 steps of 0.0137 radians. */
const ANGLES = Array.from({ length: 199 }, (_, k) => (k + 1) * 0.0137);

/** The drawing with the entity of an id moved by `by`. */
function moved(drawing: Drawing, id: string, by: Point): Drawing {
  const entities = drawing.entities.map((e) =>
    e.id === id && e.kind === "polyline"
      ? { ...e, points: e.points.map(([x, y]): Point => [x + by[0], y + by[1]]) }
      : e,
  );
  return { ...drawing, entities };
}

test("the example's residence keeps out of its setbacks, and moved into two it is warned of twice", () => {
  assert.deepEqual(checkIntent(sheet, sheetIntent), []);
  // 12 ft toward the street and 20 ft to the left: 18 ft from the front, 4 ft from the side.
  const [front, left] = checkIntent(moved(sheet, "residence", [-20, -12]), sheetIntent);
  const residence = sheet.entities.findIndex((e) => e.id === "residence");
  assert.deepEqual(
    { ...front, message: undefined, call: undefined },
    {
      rule: "footprint-in-setback",
      severity: "warning",
      message: undefined,
      item: "setbacks[0]",
      entity: residence,
      id: "residence",
      layer: "C-BLDG",
      call: undefined,
      side: 0,
      required: 25,
      provided: 18,
      // The nearest points, at the corner of the garage, and the setback around them.
      bounds: { min: [9, -25], max: [59, 43] },
      other: { entity: 0, id: "lot" },
    },
  );
  assert.equal(
    front!.message,
    'Footprint "residence" is 18 from side 0 of property line "lot", from [0, 0] to [100, 0], whose setback is 25. Move the footprint back from that side or make it smaller',
  );
  assert.deepEqual([left!.side, left!.required, left!.provided], [3, 7.5, 4]);
});

test("a setback is measured from the side itself, so a footprint past the end of a side keeps clear of it", () => {
  // An L-shaped lot. Side 2 is the top of its right wing and side 3 the inner side of its left.
  const lot: Point[] = [
    [0, 0],
    [100, 0],
    [100, 60],
    [50, 60],
    [50, 140],
    [0, 140],
  ];
  // 5 from the line of side 3, but beyond its end, 15.8 from the side.
  const clear = rect(55, 10, 90, 45);
  // 8 below side 2, and 9.43 from the inner corner, which ends side 3.
  const near = rect(55, 10, 90, 52);
  const setbacks = [{ property: "lot", footprints: ["clear", "near"], distance: 10 }];
  assert.deepEqual(found(site({ lot, clear, near }), { setbacks }), [
    ["footprint-in-setback", 2, 8],
    ["footprint-in-setback", 3, 9.433981],
  ]);
});

test("a footprint across its property line or outside it is off the property, and one on it touches", () => {
  const d = createDrawing();
  d.rect([0, 0], 100, 140, { id: "lot" });
  d.rect([-10, 50], 30, 20, { id: "across" });
  d.rect([200, 0], 10, 10, { id: "outside" });
  d.rect([0, 50], 20, 20, { id: "on" });
  const footprints = ["across", "outside", "on"];
  const drawing = d.build();
  assert.deepEqual(found(drawing, { setbacks: [{ property: "lot", footprints, distance: 5 }] }), [
    ["footprint-off-property", "across", undefined],
    ["footprint-off-property", "outside", undefined],
    ["footprint-in-setback", 3, 0],
  ]);
  const [, , on] = checkIntent(drawing, {
    setbacks: [{ property: "lot", footprints, distance: 5 }],
  });
  assert.match(on!.message, /^Footprint "on" touches side 3 of property line "lot"/);
  // A setback of 0 lets a footprint touch the line, and never lets it cross.
  assert.deepEqual(
    found(drawing, { setbacks: [{ property: "lot", footprints, distance: 0 }] }).map((w) => w[0]),
    ["footprint-off-property", "footprint-off-property"],
  );
});

test("a footprint whose sides run through the lot's corners is off it where it fills a corner the lot lacks", () => {
  const l: Point[] = [
    [0, 0],
    [100, 0],
    [100, 60],
    [50, 60],
    [50, 140],
    [0, 140],
  ];
  // Its long side runs from one corner of the L to another, across the corner the L lacks.
  const corner: Point[] = [
    [50, 60],
    [100, 60],
    [50, 140],
  ];
  // The L's upright arm itself, which shares three of its sides and two of its corners.
  const arm: Point[] = [
    [0, 0],
    [50, 0],
    [50, 140],
    [0, 140],
  ];
  const u: Point[] = [
    [0, 0],
    [30, 0],
    [30, 30],
    [20, 30],
    [20, 10],
    [10, 10],
    [10, 30],
    [0, 30],
  ];
  // Its top lies along the tops of both arms of the U, and across the gap between them.
  const bridge: Point[] = [
    [5, 5],
    [25, 5],
    [25, 30],
    [5, 30],
  ];
  const check = (lot: Point[], footprint: Point[], distance: number) =>
    found(site({ lot, footprint }), {
      setbacks: [{ property: "lot", footprints: ["footprint"], distance }],
    });
  assert.deepEqual(check(l, corner, 0), [["footprint-off-property", "footprint", undefined]]);
  assert.deepEqual(check(l, arm, 0), []);
  assert.deepEqual(check(u, bridge, 0), [["footprint-off-property", "footprint", undefined]]);
  assert.deepEqual(check(u, bridge, 1), [["footprint-off-property", "footprint", undefined]]);
  // A notch off the middle of the bridge, turned, where no side meets another exactly.
  const notched: Point[] = [
    [0, 0],
    [30, 0],
    [30, 30],
    [22, 30],
    [22, 10],
    [20, 10],
    [20, 30],
    [0, 30],
  ];
  for (const origin of [
    [0, 0],
    [612345, 512345],
  ] as const) {
    for (const angle of ANGLES) {
      for (const distance of [0, 1]) {
        assert.deepEqual(
          check(turned(notched, angle, origin), turned(bridge, angle, origin), distance),
          [["footprint-off-property", "footprint", undefined]],
          `at ${angle} from ${origin}, setback ${distance}`,
        );
      }
    }
  }
});

test("a footprint on its setback line passes at any angle up to 1e8 from the origin, and one short of it by a millionth warns", () => {
  const offsets = { front: 25, side: 7.5, rear: 20 };
  const distance = [offsets.front, offsets.side, offsets.rear, offsets.side];
  for (const origin of [
    [0, 0],
    [612345, 512345],
    [1e8, 1e8],
  ] as const) {
    for (const angle of ANGLES) {
      const place = ([x, y]: Point): Point => turned([[x, y]], angle, origin)[0]!;
      const footprint = (rear: number): Point[] =>
        (
          [
            [offsets.side, offsets.front],
            [100 - offsets.side, offsets.front],
            [100 - offsets.side, 140 - rear],
            [offsets.side, 140 - rear],
          ] as Point[]
        ).map(place);
      const lot = (
        [
          [0, 0],
          [100, 0],
          [100, 140],
          [0, 140],
        ] as Point[]
      ).map(place);
      const setbacks = [{ property: "lot", footprints: ["footprint"], distance }];
      const on = found(site({ lot, footprint: footprint(offsets.rear) }), { setbacks });
      assert.deepEqual(on, [], `at ${angle} from ${origin}`);
      const short = found(site({ lot, footprint: footprint(offsets.rear - 1e-6) }), { setbacks });
      assert.deepEqual(
        short,
        [["footprint-in-setback", 2, 19.999999]],
        `at ${angle} from ${origin}`,
      );
      // At 1e8 a double's spacing is 2^-26: a shortfall past the tolerance and twice that warns.
      if (origin[0] !== 1e8) continue;
      const past = found(site({ lot, footprint: footprint(offsets.rear - 5.3e-7) }), { setbacks });
      assert.deepEqual(
        past.map((w) => w[0]),
        ["footprint-in-setback"],
        `at ${angle}`,
      );
    }
  }
});

test("a footprint short of its setback by less than the sixth decimal shows warns, with the distance in full", () => {
  const lot: Point[] = [
    [0, 0],
    [100, 0],
    [100, 100],
  ];
  const footprint: Point[] = [
    [50, 10],
    [60, 10],
    [60, 40],
    [50, 40],
  ];
  // Its corner at [50, 40] is 7.071067811865475 from the long side, as measured.
  const drawing = site({ lot, footprint });
  const check = (setback: number) =>
    checkIntent(drawing, {
      setbacks: [{ property: "lot", footprints: ["footprint"], distance: [0, 0, setback] }],
    });
  const [short, more] = check(7.071068);
  assert.equal(more, undefined);
  assert.deepEqual(
    [short!.side, short!.required, short!.provided],
    [2, 7.071068, 7.071067811865475],
  );
  assert.match(short!.message, / is 7\.07106781186547\d* from side 2 /);
  assert.deepEqual(check(7.071067), []);
});

test("what cannot be checked is warned of with the reason, and the rest is checked", () => {
  const d = createDrawing();
  d.rect([0, 0], 100, 140, { id: "lot" });
  d.rect([10, 10], 20, 20, { id: "shed" });
  d.polyline(
    [
      [40, 40],
      [60, 40],
      [60, 60],
    ],
    false,
    { id: "open" },
  );
  d.line([0, 0], [10, 0], { id: "edge" });
  const drawing = d.build();
  const intent = {
    setbacks: [
      { property: "lot", footprints: ["shed"], distance: [5, 5, 5] },
      { property: "edge", footprints: ["open", "missing"], distance: -1 },
      { property: "lot", footprints: [], distance: 5 },
      { property: "LOT", footprint: ["shed"], footprints: ["shed", "open"], distance: 15 },
      // An empty slot, which `every` would pass over.
      // oxlint-disable-next-line no-sparse-arrays
      { property: "lot", footprints: ["shed"], distance: [15, , 15, 15] },
    ],
    setback: [],
  };
  assert.deepEqual(
    checkIntent(drawing, intent as Intent).map((w) => [w.rule, w.item, w.message]),
    [
      [
        "intent-unchecked",
        undefined,
        'The intent has no field "setback". Its one field is setbacks',
      ],
      [
        "intent-unchecked",
        "setbacks[0]",
        'Setback 0 gives 3 distances for property line "lot", which has 4 sides. Give one distance, or one for each side in the order of its points',
      ],
      [
        "intent-unchecked",
        "setbacks[1]",
        'Setback 1 names property line "edge", which is an entity of kind "line", not a closed polyline',
      ],
      [
        "intent-unchecked",
        "setbacks[1]",
        "Setback 1's distance must be a number of 0 or more, in drawing units, or an array of one for each side of the property line",
      ],
      [
        "intent-unchecked",
        "setbacks[1]",
        'Setback 1 names footprint "open", which is an open polyline, not a closed polyline',
      ],
      [
        "intent-unchecked",
        "setbacks[1]",
        'Setback 1 names footprint "missing", and no entity of model space has that id',
      ],
      [
        "intent-unchecked",
        "setbacks[2]",
        "Setback 2's footprints must be an array of one or more ids of closed polylines",
      ],
      [
        "intent-unchecked",
        "setbacks[3]",
        'Setback 3 has no field "footprint". Its fields are property, footprints and distance',
      ],
      [
        "intent-unchecked",
        "setbacks[3]",
        'Setback 3 names footprint "open", which is an open polyline, not a closed polyline',
      ],
      [
        "footprint-in-setback",
        "setbacks[3]",
        'Footprint "shed" is 10 from side 0 of property line "lot", from [0, 0] to [100, 0], whose setback is 15. Move the footprint back from that side or make it smaller',
      ],
      [
        "footprint-in-setback",
        "setbacks[3]",
        'Footprint "shed" is 10 from side 3 of property line "lot", from [0, 140] to [0, 0], whose setback is 15. Move the footprint back from that side or make it smaller',
      ],
      [
        "intent-unchecked",
        "setbacks[4]",
        "Setback 4's distance must be a number of 0 or more, in drawing units, or an array of one for each side of the property line",
      ],
    ],
  );
  assert.deepEqual(found(drawing, null as unknown as Intent), [
    ["intent-unchecked", undefined, undefined],
  ]);
});

test("each outline is read once and paid for first, and past 200 warnings the check stops", () => {
  const square: Point[] = [
    [-10, -10],
    [10, -10],
    [10, 10],
    [-10, 10],
  ];
  const drawing = site({ lot: circle(100, 10_000), house: circle(95, 10_000), small: square });
  // One footprint named 500 times is one footprint, too large to check, and the small one is
  // checked.
  const footprints = [...Array.from({ length: 500 }, () => "house"), "small"];
  assert.deepEqual(found(drawing, { setbacks: [{ property: "lot", footprints, distance: 10 }] }), [
    ["intent-unchecked", "house", undefined],
  ]);
  // A setback over and over, each past what is left to check.
  const setbacks = Array.from({ length: 2000 }, () => ({
    property: "lot",
    footprints: Array.from({ length: 50 }, () => "house"),
    distance: 10,
  }));
  const warnings = checkIntent(drawing, { setbacks });
  assert.equal(warnings.length, 201);
  assert.deepEqual(
    warnings.slice(0, 2).map((w) => w.item),
    ["setbacks[0]", "setbacks[1]"],
  );
  assert.match(warnings[200]!.message, /^checkIntent stopped after 200 warnings/);
});

test("a lot or a footprint whose outline crosses or touches itself is not checked, and says so", () => {
  // A lot around a hole, drawn as one outline that goes in to the hole and back.
  const holed: Point[] = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
    [0, 0],
    [40, 40],
    [40, 60],
    [60, 60],
    [60, 40],
    [40, 40],
    [0, 0],
  ];
  const crossed: Point[] = [
    [30, 30],
    [50, 50],
    [50, 30],
    [30, 50],
  ];
  // A last point that repeats the first is the same corner, so the square has four sides.
  const square: Point[] = [...rect(0, 0, 100, 100), [0, 0]];
  const over = rect(20, 20, 80, 80);
  const drawing = site({ holed, crossed, square, over });
  const [hole] = checkIntent(drawing, {
    setbacks: [{ property: "holed", footprints: ["over"], distance: 0 }],
  });
  assert.equal(hole!.rule, "intent-unchecked");
  assert.match(
    hole!.message,
    /^Setback 0 names property line "holed", whose outline crosses or touches itself\. /,
  );
  assert.deepEqual(
    found(drawing, {
      setbacks: [{ property: "square", footprints: ["over", "crossed"], distance: [5, 5, 5, 5] }],
    }),
    [["intent-unchecked", "crossed", undefined]],
  );
});

test("a property line's points are read a few times, however many setbacks name it", () => {
  const n = 1000;
  let reads = 0;
  const points = new Proxy(circle(100, n), {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  const drawing: Drawing = {
    ...createDrawing().build(),
    entities: [{ kind: "polyline", layer: "0", id: "lot", closed: true, points }],
  };
  const setbacks = Array.from({ length: 199 }, () => ({
    property: "lot",
    footprints: ["missing"],
    distance: 0,
  }));
  assert.equal(checkIntent(drawing, { setbacks }).length, 199);
  assert.ok(reads <= 3 * n, `${reads} reads of ${n} points`);
});

test("what is more than the check takes is one warning for each setback, which leaves room for the rest", () => {
  const outlines: Record<string, Point[]> = { lot: circle(1000, 800) };
  for (let i = 0; i < 2000; i++) {
    outlines[`f${i}`] = circle(1, 3, [(i % 40) * 20 - 400, Math.floor(i / 40) * 15 - 400]);
  }
  const footprints = Object.keys(outlines).filter((id) => id !== "lot");
  const warnings = checkIntent(site(outlines), {
    setbacks: [{ property: "lot", footprints, distance: 0 }],
  });
  assert.deepEqual(
    warnings.map((w) => w.rule),
    ["intent-unchecked"],
  );
  assert.match(
    warnings[0]!.message,
    /^Setback 0: footprint "f\d+" held against property line "lot" and \d+ more were not checked\. checkIntent does 4,000,000 steps of work in one call, and .+ took \d+% of them$/,
  );
});

test("an intent with more unknown fields than the check warns of stops with a warning that says so", () => {
  const fields = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`field${i}`, 0]));
  const warnings = checkIntent(site({ lot: rect(0, 0, 10, 10) }), fields as Intent);
  assert.equal(warnings.length, 201);
  assert.match(warnings[200]!.message, /^checkIntent stopped after 200 warnings/);
});

test("a lot a trillion from the origin has its area, and its setbacks are measured as near it", () => {
  const at = 1e12;
  const lot = rect(at, at, at + 100, at + 140);
  const setbacks = [{ property: "lot", footprints: ["footprint"], distance: [25, 7.5, 20, 7.5] }];
  const on = rect(at + 7.5, at + 25, at + 92.5, at + 120);
  assert.deepEqual(found(site({ lot, footprint: on }), { setbacks }), []);
  const short = rect(at + 7.5, at + 25, at + 92.5, at + 121);
  assert.deepEqual(found(site({ lot, footprint: short }), { setbacks }), [
    ["footprint-in-setback", 2, 19],
  ]);
});

test("an acute corner whose two sides nearly meet is a corner, judged exactly for the doubles held", () => {
  // The turn at [100, 100.1] is 25/2^45: no side touches another, though doubles round it to 0.
  const lot: Point[] = [
    [0, 0],
    [100, 100.1],
    [50, 50.050000000000004],
    [0, 100],
  ];
  const footprint = rect(1, 60, 10, 70);
  const setbacks = [{ property: "lot", footprints: ["footprint"], distance: 0 }];
  assert.deepEqual(found(site({ lot, footprint }), { setbacks }), []);
});

test("a point that repeats the one before it is the same corner and makes no side", () => {
  const footprint = rect(5, 5, 25, 25);
  const setbacks = [{ property: "lot", footprints: ["footprint"], distance: [1, 1, 1, 1] }];
  const repeated: Point[] = [
    [0, 0],
    [30, 0],
    [30, 0],
    [30, 30],
    [0, 30],
  ];
  assert.deepEqual(found(site({ lot: repeated, footprint }), { setbacks }), []);
  const closedTwice: Point[] = [...rect(0, 0, 30, 30), [0, 0], [0, 0]];
  assert.deepEqual(found(site({ lot: closedTwice, footprint }), { setbacks }), []);
});

test("what the work of a call could not take names the work, and what took most of it", () => {
  const drawing = site({ lot: circle(1000, 150_000), footprint: rect(-1, -1, 1, 1) });
  const setbacks = Array.from({ length: 2 }, () => ({
    property: "lot",
    footprints: ["footprint"],
    distance: 1,
  }));
  const warnings = checkIntent(drawing, { setbacks });
  assert.deepEqual(
    warnings.map((w) => w.message.replace(/\d+% of/, "N% of")),
    [0, 1].map(
      (n) =>
        `Setback ${n}: the outline of property line "lot" and 1 more were not checked. checkIntent does 4,000,000 steps of work in one call, and the outline of property line "lot" took N% of them`,
    ),
  );
  // An outline larger than all of that says so.
  const huge = site({ lot: circle(1000, 250_000), footprint: rect(-1, -1, 1, 1) });
  assert.match(
    checkIntent(huge, { setbacks: setbacks.slice(0, 1) })[0]!.message,
    /^Setback 0: the outline of property line "lot" was not checked\. By itself it is more than the 4,000,000 steps of work checkIntent does in one call$/,
  );
});
