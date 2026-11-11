import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";
import { Script } from "node:vm";
import { without } from "../cli/src/omit.ts";
import {
  fromJSON,
  lint,
  toDXF,
  toJSON,
  toSVG,
  type AttributeDefinition,
  type Block,
  type Diagnostic,
  type Drawing,
  type Entity,
  type Layer,
  type Linetype,
  type TextStyle,
  type Xref,
} from "../src/index.ts";

const styled = { linetype: "DD", lineweight: 0.25 } as const;
const justified = { style: "NOTES", align: "center", valign: "middle" } as const;

/** Each kind of entity with every field it can have: a field left out is a compile error. */
const kinds: { readonly [K in Entity["kind"]]: Required<Extract<Entity, { kind: K }>> } = {
  line: { kind: "line", layer: "WALL", from: [0, 0], to: [10, 0], id: "a", ...styled },
  polyline: {
    kind: "polyline",
    layer: "0",
    points: [
      [0, 0],
      [10, 0],
      [10, 5],
    ],
    closed: true,
    id: "b",
    ...styled,
  },
  circle: { kind: "circle", layer: "0", center: [5, 5], radius: 2, id: "c", ...styled },
  arc: {
    kind: "arc",
    layer: "0",
    center: [5, 5],
    radius: 3,
    startAngle: 0,
    endAngle: 90,
    id: "d",
    ...styled,
  },
  text: {
    kind: "text",
    layer: "0",
    at: [0, 4],
    height: 1,
    rotation: 0,
    value: "T-0",
    id: "e",
    ...styled,
    ...justified,
  },
  insert: {
    kind: "insert",
    layer: "0",
    block: "TREE",
    at: [20, 0],
    id: "f",
    scale: [2, 2],
    rotation: 30,
    attributes: { TAG: "T-1" },
  },
};

/** One of everything an R2018 drawing can hold, with every field of every object. */
const full: Required<Drawing> & {
  readonly linetypes: readonly [Required<Linetype>];
  readonly textStyles: readonly [Required<TextStyle>];
  readonly layers: readonly [Layer, Required<Layer>];
  readonly blocks: readonly [
    Block,
    Required<Block> & { readonly attributes: readonly [Required<AttributeDefinition>] },
  ];
  readonly xrefs: readonly [Required<Xref>];
} = {
  format: 0,
  units: "ft",
  dxf: "R2018",
  linetypeScale: 2,
  linetypes: [{ name: "DD", description: "Dash dot", pattern: [0.5, -0.25, 0, -0.25] }],
  textStyles: [{ name: "NOTES", font: "Arial", widthFactor: 0.9, obliqueAngle: 10 }],
  layers: [
    { name: "0", color: 7 },
    {
      name: "WALL",
      color: 1,
      linetype: "DD",
      lineweight: 0.5,
      off: false,
      frozen: false,
      locked: true,
      plot: false,
    },
  ],
  blocks: [
    { name: "LEAF", entities: [{ kind: "circle", layer: "0", center: [0, 0], radius: 1 }] },
    {
      name: "TREE",
      base: [1, 2],
      attributes: [
        {
          tag: "TAG",
          prompt: "Tree tag",
          value: "T-0",
          layer: "0",
          at: [0, 4],
          height: 1,
          rotation: 0,
          ...justified,
        },
      ],
      entities: [
        { kind: "arc", layer: "0", center: [0, 0], radius: 3, startAngle: 0, endAngle: 90 },
        { kind: "insert", layer: "0", block: "LEAF", at: [1, 1] },
      ],
    },
  ],
  xrefs: [{ name: "BASE", path: "base.dwg" }],
  entities: [...Object.values(kinds), { kind: "insert", layer: "0", block: "BASE", at: [0, 0] }],
};

/** What an R12 drawing can hold. */
const r12: Drawing = {
  format: 0,
  units: "ft",
  dxf: "R12",
  layers: [{ name: "0", color: 7 }],
  entities: [
    { kind: "line", layer: "0", from: [0, 0], to: [10, 0], id: "a" },
    { ...kinds.polyline, linetype: "ByLayer", lineweight: "ByLayer" },
    { kind: "circle", layer: "0", center: [5, 5], radius: 2 },
    { kind: "arc", layer: "0", center: [5, 5], radius: 3, startAngle: 0, endAngle: 90 },
    { kind: "text", layer: "0", at: [0, 4], height: 1, rotation: 0, value: "T-0" },
  ],
};

type Path = readonly (string | number)[];

/** Every path to a value in `value`, at every depth. */
function paths(value: unknown, at: Path = []): Path[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.keys(value).flatMap((key) => {
    const step = [...at, Array.isArray(value) ? Number(key) : key];
    return [step, ...paths((value as Record<string, unknown>)[key], step)];
  });
}

const HOLE = Symbol("an empty slot");

/** A copy of `drawing` with the value at `path` replaced, or its slot emptied for `HOLE`. */
function replaced(drawing: unknown, path: Path, value: unknown): unknown {
  if (path.length === 0) return value;
  const copy = structuredClone(drawing) as Record<string | number, unknown>;
  let parent = copy;
  for (const step of path.slice(0, -1)) parent = parent[step] as typeof parent;
  if (value === HOLE) delete parent[path.at(-1)!];
  else parent[path.at(-1)!] = value;
  return copy;
}

const at = (drawing: unknown, path: Path): unknown =>
  path.reduce((value, step) => (value as Record<string | number, unknown>)[step], drawing);

const circular: Record<string, unknown> = {};
circular.self = circular;
const wrong = [undefined, null, 5, "x", {}, [], 1n, circular, { toString: 0 }];

/** The values to put in place of the one at `path`. */
function replacements(drawing: unknown, path: Path): unknown[] {
  const parent = at(drawing, path.slice(0, -1));
  const value = at(drawing, path);
  return [
    ...wrong,
    ...(Array.isArray(value) ? [[null], new Array(2)] : []),
    ...(typeof value === "number" ? [0, -1, NaN, Infinity] : []),
    ...(Array.isArray(parent) ? [HOLE] : []),
    // The same value with a field nobody knows.
    ...(typeof value === "object" && !Array.isArray(value) ? [{ ...value, zz: 1 }] : []),
  ];
}

const errors = (drawing: Drawing, version?: "R12" | "R2018") =>
  lint(drawing, version ? { version } : {}).filter((d) => d.severity === "error");

/** Runs `toSVG` and stops it after a second, so a drawing that never finishes fails the test. */
const draw = new Script("drawn = toSVG(drawing)");
Object.assign(globalThis, { toSVG });

/** What `toSVG` does with a drawing: the error it throws, or undefined when it draws it. */
function drawn(drawing: Drawing): unknown {
  Object.assign(globalThis, { drawing });
  try {
    draw.runInThisContext({ timeout: 1000 });
    return undefined;
  } catch (thrown) {
    return thrown;
  }
}

const hung = (thrown: unknown): boolean =>
  (thrown as { code?: unknown } | null)?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT";

/**
 * Says what `lint` does wrong with a value: it must return, `toSVG` must return or throw in a
 * second, a value `lint` reports no error for must be one the writers, `toSVG` and `fromJSON`
 * take, and a drawing it reports an error for must be one `toSVG` draws, at least once the
 * items the errors name are left out.
 */
function failure(value: unknown): string | undefined {
  const drawing = value as Drawing;
  let found: Diagnostic[];
  try {
    for (const version of ["R12", "R2018"] as const) errors(drawing, version);
    found = errors(drawing);
  } catch (thrown) {
    return `lint threw ${String(thrown)}`;
  }
  const refused = drawn(drawing);
  if (hung(refused)) return "toSVG does not finish";
  if (found.length > 0) {
    // The command asks for a drawing with a list of layers and one of entities before it lints.
    if (!Array.isArray(drawing?.layers) || !Array.isArray(drawing.entities)) return undefined;
    if (refused === undefined) return undefined;
    const rest = drawn(without(drawing, new Set(found.flatMap((d) => d.item ?? []))));
    return rest === undefined
      ? undefined
      : `it cannot be drawn without what lint names: ${String(rest).split("\n", 1)[0]}`;
  }
  try {
    if (refused !== undefined) throw refused;
    toDXF(drawing);
    fromJSON(toJSON(drawing));
    fromJSON(structuredClone(value));
  } catch (thrown) {
    return `lint reports no error, and then: ${String(thrown).split("\n", 1)[0]}`;
  }
  return undefined;
}

test("lint returns for every value of the wrong type, with an error for what cannot be written", () => {
  const failures: string[] = [];
  for (const drawing of [full, r12]) {
    assert.deepEqual(lint(fromJSON(toJSON(drawing))), []);
    for (const path of [[], ...paths(drawing)]) {
      for (const value of replacements(drawing, path)) {
        const found = failure(replaced(drawing, path, value));
        const shown = inspect(value, { depth: 0, breakLength: Infinity });
        if (found) failures.push(`${drawing.dxf} ${path.join(".")} = ${shown}: ${found}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("a value of the wrong shape is reported in these words, once", () => {
  const cases: [path: Path, value: unknown, expected: string[]][] = [
    [["units"], 1n, ["units: Unknown units: a value of type bigint"]],
    [
      ["xrefs", 0, "name"],
      { toString: 0 },
      [
        "xref: Xref a value of type object: A block's name must be a string",
        `undefined-block: insert #6: Block "BASE" is not defined. AutoCAD's AUDIT reports an insert of a block the drawing does not have, and AutoCAD cannot save the drawing as DXF`,
      ],
    ],
    [
      ["entities", 1],
      HOLE,
      ["format: entities has no item at index 1. An array cannot have empty slots"],
    ],
    [
      ["entities", 1, "points"],
      new Array(200000),
      ["format: entities[1].points has no item at index 0. An array cannot have empty slots"],
    ],
    [["blocks", 1, "base"], "x", ["block: blocks[1].base must be a point, [x, y]"]],
    [
      ["blocks", 1, "attributes", 0, "height"],
      "x",
      ["attribute: blocks[1].attributes[0].height must be a number"],
    ],
    [
      ["textStyles", 0, "obliqueAngle"],
      null,
      ['text-style: Text style "NOTES": obliqueAngle must be a finite number'],
    ],
    [
      ["blocks", 1, "attributes"],
      [{ ...full.blocks[1].attributes[0], height: "x" }, full.blocks[1].attributes[0]],
      [
        "attribute: blocks[1].attributes[0].height must be a number",
        'duplicate-attribute: Block "TREE", attribute "TAG": The block already has an attribute with the tag "TAG". An insert sets an attribute by its tag, and the tag gives the definition its handle: AutoCAD discards a drawing in which two objects have one handle',
      ],
    ],
    [
      ["entities", 4],
      { ...kinds.text, Scale: [1, 1], weight: 0.25, neight: 1, ltype: "DD", valu: "T" },
      [
        'format: entities[4]: unknown field "Scale"',
        'format: entities[4]: unknown field "weight"',
        'format: entities[4]: unknown field "neight". Did you mean "height"?',
        'format: entities[4]: unknown field "ltype". Did you mean "linetype"?',
        'format: entities[4]: unknown field "valu". Did you mean "value"?',
      ],
    ],
    [
      ["textStyles", 0],
      { ...full.textStyles[0], line: 1 },
      ['text-style: textStyles[0]: unknown field "line"'],
    ],
    [
      ["layers", 1],
      { name: "WALL", color: 1, colour: 1, clor: 1, linetyep: "DD" },
      [
        'format: layers[1]: unknown field "colour". Did you mean "color"?',
        'format: layers[1]: unknown field "clor". Did you mean "color"?',
        'format: layers[1]: unknown field "linetyep". Did you mean "linetype"?',
      ],
    ],
    [
      ["entities", 0],
      { ...kinds.line, lineWeight: 0.25, weight: 0.25, layers: "0", thickness: 2 },
      [
        'format: entities[0]: unknown field "lineWeight". Did you mean "lineweight"?',
        'format: entities[0]: unknown field "weight". Did you mean "lineweight"?',
        'format: entities[0]: unknown field "layers". Did you mean "layer"?',
        'format: entities[0]: unknown field "thickness"',
      ],
    ],
  ];
  for (const [path, value, expected] of cases) {
    const found = errors(replaced(full, path, value) as Drawing);
    assert.deepEqual(
      found.map((d) => `${d.rule}: ${d.message}`),
      expected,
      path.join("."),
    );
  }
});
