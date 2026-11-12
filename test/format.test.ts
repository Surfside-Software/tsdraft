import assert from "node:assert/strict";
import { test } from "node:test";
import { callerInStack, parseStack } from "../src/callsite.ts";
import {
  createDrawing,
  DASHED,
  DrawingError,
  fromJSON,
  lint,
  toDXF,
  toJSON,
  toSVG,
  type Diagnostic,
  type Drawing,
} from "../src/index.ts";

function sample(): Drawing {
  const d = createDrawing({ units: "ft", linetypeScale: 2 });
  d.layer("A-WALL", { color: 1, linetype: DASHED, lineweight: 0.5, locked: true }, () => {
    d.line([0, 0], [10, -0], { id: "wall.north" });
    d.rect([0, 0], 10, 5, { lineweight: 0.7 });
    d.circle([5, 2.5], 1 / 3, { linetype: "Continuous" });
    d.arc([5, 2.5], 2, 350, 10);
    d.text([1, 1], 'ROOM "A" é', { height: 0.5, rotation: 30, id: "room-A_1" });
  });
  d.textStyle({ name: "NOTES", font: "Arial", widthFactor: 0.9, obliqueAngle: 10 });
  d.text([2, 2], "NOTE", { style: "NOTES", align: "right", valign: "top" });
  return d.build();
}

/** What `fromJSON` refuses the value for. */
function refusal(value: unknown): readonly Diagnostic[] {
  try {
    fromJSON(value);
  } catch (thrown) {
    assert.ok(thrown instanceof DrawingError);
    return thrown.diagnostics;
  }
  return assert.fail("fromJSON took the value");
}

const kinds = ` An entity's kind is "line", "polyline", "circle", "arc", "text", "insert", "linear-dimension" or "aligned-dimension"`;

test("a drawing goes to JSON and back unchanged", () => {
  const drawing = sample();
  const read = fromJSON(toJSON(drawing));
  assert.deepEqual(read, drawing);
  assert.equal(toDXF(read), toDXF(drawing));
  // An already parsed value is checked the same, and is itself the drawing.
  const value: unknown = JSON.parse(toJSON(drawing));
  assert.equal(fromJSON(value), value);
});

test("the JSON is canonical: sorted keys, whole numbers, negative zero and no white space", () => {
  const line = { kind: "line", layer: "0", from: [0, -0], to: [1e21, 0.1 + 0.2] } as const;
  const drawing: Drawing = {
    units: "mm",
    layers: [{ name: "0", color: 7 }],
    entities: [line],
    format: 0,
    dxf: "R2018",
  };
  assert.equal(
    toJSON(drawing),
    '{"dxf":"R2018","entities":[{"from":[0,-0],"kind":"line","layer":"0","to":[1e+21,0.30000000000000004]}],' +
      '"format":0,"layers":[{"color":7,"name":"0"}],"units":"mm"}',
  );
  const reordered: Drawing = {
    format: 0,
    dxf: "R2018",
    entities: [{ to: line.to, from: line.from, layer: "0", kind: "line" }],
    layers: [{ color: 7, name: "0" }],
    units: "mm",
  };
  assert.equal(toJSON(reordered), toJSON(drawing));
  assert.throws(() => toJSON({ ...drawing, linetypeScale: NaN }), /NaN cannot be written/);
});

test("fromJSON names what it does not know, and runs lint", () => {
  const base = JSON.parse(toJSON(sample())) as Record<string, unknown[]>;
  assert.deepEqual(refusal({ ...base, format: 1 }), [
    {
      rule: "format",
      severity: "error",
      message: "Unknown Drawing format 1. This version of tsdraft reads format 0",
    },
  ]);
  const messages = (value: unknown): string[] =>
    refusal(value).map((d) => `${d.rule}: ${d.message}`);
  assert.deepEqual(
    messages({
      ...base,
      title: "Plan",
      layers: [{ name: "0", color: 7, colour: 1 }],
      entities: [
        { ...(base.entities![0] as object), layer: "0", thickness: 2 },
        { kind: "ellipse", layer: "0" },
        { kind: "circle", layer: "0", center: [0, 0, 0] },
      ],
    }),
    [
      'format: entities[0]: unknown field "thickness"',
      `format: entities[1]: unknown entity kind "ellipse".${kinds}`,
      'format: entities[2]: the field "radius" is missing',
      "format: entities[2].center must be a point, [x, y]",
      'format: layers[0]: unknown field "colour". Did you mean "color"?',
      'format: The drawing: unknown field "title"',
    ],
  );
  // A drawing of the right shape still has to pass every rule the builder holds it to.
  assert.deepEqual(messages({ ...base, layers: [{ name: "0", color: 7 }] }).slice(0, 1), [
    'undefined-layer: line #0: layer "A-WALL" is not defined',
  ]);
  assert.match(messages("{")[0]!, /^format: The JSON cannot be parsed/);

  // What only a value that did not come from JSON text can hold is refused the same way.
  const line = { kind: "line", layer: "0", from: [0, 0], to: [1, 0] };
  const polyline = { kind: "polyline", layer: "0", closed: false };
  const withEntity = (entity: object): object => ({ ...base, layers: [], entities: [entity] });
  const unknownFormat = (shown: string): string =>
    `format: Unknown Drawing format ${shown}. This version of tsdraft reads format 0`;
  const gapped: number[][] = [[0, 0]];
  gapped[2] = [1, 1];
  const plain = "must be a plain object, with no getter, setter or hidden field";
  const noKeys = (at: string): string => `format: ${at} must have no key but its indexes`;
  const getter = {
    enumerable: true,
    get: (): never => assert.fail("fromJSON read a getter"),
  };
  const refusals: [value: unknown, first: string][] = [
    [
      // oxlint-disable-next-line unicorn/no-new-array
      { ...base, entities: new Array(1e9) },
      "format: entities has no item at index 0. An array cannot have empty slots",
    ],
    [
      withEntity({ ...polyline, points: gapped }),
      "format: entities[0].points has no item at index 1. An array cannot have empty slots",
    ],
    [Object.create(base), `format: The drawing ${plain}`],
    [withEntity(Object.create(line)), `format: entities[0] ${plain}`],
    [{ ...base, entities: Object.setPrototypeOf([], null) }, "format: entities must be an array"],
    [{ ...base, layers: Object.assign([], { map: 0 }) }, noKeys("layers")],
    [{ ...base, entities: Object.assign([], { forEach: null }) }, noKeys("entities")],
    [
      withEntity(Object.defineProperty({ ...line }, "layer", getter)),
      `format: entities[0] ${plain}`,
    ],
    [
      { ...base, entities: Object.defineProperty([], 0, getter) },
      "format: entities[0] must be a plain value, not a getter or setter",
    ],
    [
      withEntity({ ...line, from: Object.defineProperty([0, 0], 1, getter) }),
      "format: entities[0].from must be a point, [x, y]",
    ],
    [
      withEntity({ ...line, thickness: undefined }),
      'format: entities[0]: unknown field "thickness"',
    ],
    [{ ...base, format: 1n }, unknownFormat("a value of type bigint")],
    [
      withEntity({ ...line, kind: 1n }),
      `format: entities[0]: unknown entity kind a value of type bigint.${kinds}`,
    ],
    [{ ...base, format: -0 }, unknownFormat("-0")],
  ];
  for (const [value, first] of refusals) assert.equal(messages(value)[0], first);
});

test("a diagnostic carries the entity's id and the call that drew it", () => {
  const d = createDrawing({ recordCalls: true });
  d.line([1, 1], [1, 1], { id: "stub" });
  const drawing = d.build();
  const [warning] = lint(drawing);
  assert.equal(warning?.rule, "zero-length");
  assert.equal(warning?.id, "stub");
  assert.match(warning?.call?.file ?? "", /test\/format\.test\.ts$/);
  assert.ok(warning!.call!.line > 1 && warning!.call!.column > 1);
  // The call is kept beside the drawing: it is not in the JSON, and a drawing read back has none.
  assert.doesNotMatch(toJSON(drawing), /format\.test/);
  assert.equal(lint(fromJSON(toJSON(drawing)))[0]?.call, undefined);
  // Calls are recorded only when asked for.
  assert.equal(lint(createDrawing().line([1, 1], [1, 1]).build())[0]?.call, undefined);

  // The builder's own error has the same fields, whether or not calls are recorded.
  const radius: number = -1;
  assert.throws(
    () => createDrawing().circle([0, 0], radius, { id: "hole" }),
    (thrown: unknown) => {
      assert.ok(thrown instanceof DrawingError);
      assert.equal(thrown.message, "radius: This value must be greater than 0");
      const [problem] = thrown.diagnostics;
      assert.deepEqual([problem?.rule, problem?.id], ["geometry", "hole"]);
      assert.match(problem?.call?.file ?? "", /test\/format\.test\.ts$/);
      return true;
    },
  );
  const color: number = 300;
  assert.throws(
    () => createDrawing().layer("A", { color }),
    (thrown: unknown) =>
      thrown instanceof DrawingError &&
      thrown.diagnostics[0]?.layer === "A" &&
      thrown.diagnostics[0]?.call !== undefined,
  );

  // Where the engine has no Error.captureStackTrace, the same calls are read from an error's
  // stack, for an entity drawn, an entity refused and a layer refused.
  const calls = () => {
    const b = createDrawing({ recordCalls: true });
    const thrown = (draw: () => unknown) => {
      try {
        draw();
      } catch (error) {
        return (error as DrawingError).diagnostics[0]?.call;
      }
      return assert.fail("the call was taken");
    };
    return [
      lint(b.line([1, 1], [1, 1]).build())[0]?.call,
      thrown(() => b.circle([0, 0], radius)),
      thrown(() => b.layer("A", { color })),
    ];
  };
  const withCapture = calls();
  const errors = Error as { captureStackTrace?: unknown };
  const capture = errors.captureStackTrace;
  errors.captureStackTrace = undefined;
  try {
    assert.deepEqual(calls(), withCapture);
  } finally {
    errors.captureStackTrace = capture;
  }
  assert.ok(withCapture.every((call) => call?.file.endsWith("test/format.test.ts")));

  // Each engine's way of writing a stack frame is read.
  const at = { file: "http://localhost:5173/src/plan.ts", line: 12, column: 5 };
  assert.deepEqual(parseStack(`Error\n    at draw (${at.file}:12:5)`), [at]);
  assert.deepEqual(parseStack(`Error\n    at ${at.file}:12:5`), [at]);
  assert.deepEqual(parseStack(`draw@${at.file}:12:5\n@${at.file}:40:1`)[0], at);
  assert.deepEqual(parseStack("Error"), []);

  // A whole stack from an engine that left the builder method's own frame out, where the call
  // was made in a layer() callback: the caller is found by file. In a bundle, where every frame
  // is in one file, there is no location.
  const lib = "http://localhost:5173/node_modules/tsdraft/dist";
  const stack = (callsite: string, builder: string): string =>
    [
      `holdCall@${callsite}:40:30`,
      `#add@${builder}:700:36`,
      `@${at.file}:12:5`,
      `layer@${builder}:470:9`,
      `module code@${at.file}:11:3`,
    ].join("\n");
  assert.deepEqual(callerInStack(stack(`${lib}/callsite.js`, `${lib}/drawing.js`)), at);
  assert.equal(callerInStack(stack(at.file, at.file)), undefined);
});

test("SVG marks an entity with its id", () => {
  const svg = toSVG(sample());
  assert.match(svg, /data-entity="0" data-id="wall\.north"/);
  assert.equal(svg.match(/data-id=/g)?.length, 2);
});
