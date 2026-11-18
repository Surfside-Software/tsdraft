import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Script } from "node:vm";
import sheet, { standard } from "../examples/site-plan.ts";
import {
  createDrawing,
  DrawingError,
  fromJSON,
  inspectText,
  lint,
  toDXF,
  toSVG,
  type Block,
  type Drawing,
  type Entity,
  type Insert,
  type Point,
} from "../src/index.ts";
import { blocksByKey, eachDrawn, mapPoint, referencedByKey, type LayerRef } from "../src/blocks.ts";
import { boxer, extents } from "../src/extents.ts";
import { written } from "../src/format.ts";
import { inspectWithin } from "../src/inspect.ts";
import { lintWithin, type Diagnostic } from "../src/lint.ts";
import { lintStandard } from "../src/standard/lint.ts";
import { measureText } from "../src/measure.ts";
import { Strings } from "../src/shape.ts";
import { svgToPDF } from "../src/pdf.ts";
import { svgWithin } from "../src/svg.ts";
import { toDXFR2018 } from "../src/dxf-r2018.ts";
import { timeLimit } from "./time-limit.ts";

/** The command's own font, given to the PDF as the file of every TrueType font, to embed. */
const shipped = new Uint8Array(
  readFileSync(new URL("../cli/assets/fonts/JetBrainsMono-Regular.ttf", import.meta.url)),
);
const embedded = { Arial: shipped, Calibri: shipped, "Times New Roman": shipped };

const running = new Script("running()");
/** What `fn` gives, stopped after `ms`, so a run that never ends fails. */
const within = <T>(ms: number, fn: () => T): T => {
  Object.assign(globalThis, { running: fn });
  return running.runInThisContext({ timeout: timeLimit(ms) }) as T;
};
/** What `fn` gives or throws, stopped after `ms`. */
const settled = (ms: number, fn: () => unknown): unknown =>
  within(ms, () => {
    try {
      return fn();
    } catch (thrown) {
      return thrown;
    }
  });

/** Blocks that each insert the one below `width` times, `depth` deep, with `leaf` at the bottom. */
function nested(leaf: Entity, depth: number, width: number, prefix = "B") {
  const blocks: Block[] = [{ name: `${prefix}0`, base: [0, 0], entities: [leaf] }];
  for (let i = 1; i < depth; i++) {
    const insert: Insert = { kind: "insert", layer: "0", block: `${prefix}${i - 1}`, at: [0, 0] };
    blocks.push({
      name: `${prefix}${i}`,
      base: [0, 0],
      entities: Array.from({ length: width }, (_, j) => ({ ...insert, at: [j, 0] as Point })),
    });
  }
  const top: Insert = { kind: "insert", layer: "0", block: `${prefix}${depth - 1}`, at: [0, 0] };
  return { blocks, top };
}
const line: Entity = { kind: "line", layer: "0", from: [0, 0], to: [1, 1] };
const text = (value: string): Entity => ({
  kind: "text",
  layer: "0",
  at: [0, 0],
  height: 1,
  value,
  rotation: 0,
});
/** The example sheet with blocks and inserts added to model space. */
const withModel = ({ blocks, top }: { blocks: Block[]; top: Insert }): Drawing => ({
  ...sheet,
  blocks: [...sheet.blocks!, ...blocks],
  entities: [...sheet.entities, top],
});

test("blocks nested to draw millions of entities cost what the drawing holds", () => {
  // 25 blocks that each insert the one below twice draw the line 2^24 times.
  const lines = withModel(nested(line, 25, 2));
  assert.deepEqual(
    within(2000, () => lint(lines)),
    [],
  );
  assert.deepEqual(
    within(2000, () => lint(lines, { standard }).map((d) => d.rule)),
    ["layer-outside-standard"],
  );
  assert.equal(typeof within(2000, () => toDXF(lines)), "string");
  const tree = nested(line, 25, 2);
  assert.deepEqual(
    within(2000, () => extents([tree.top], [], tree.blocks).map(written)),
    [0, 0, 25, 1],
  );
  assert.deepEqual(
    within(2000, () => inspectText(lines)),
    [],
  );
  // A text at the bottom is looked at in each of its places, up to the limit.
  const texts = withModel(nested(text("A".repeat(100_000)), 25, 2));
  assert.deepEqual(
    within(2000, () => lint(texts)),
    [],
  );
  const warnings = within(2000, () => inspectText(texts));
  assert.deepEqual(
    warnings.map((w) => w.rule),
    ["text-check-capped"],
  );
  // The insert comes after the sheet's own entities.
  const top = `insert #${sheet.entities.length} of model space`;
  assert.ok(warnings[0]!.message.includes(`stopped short at ${top}`));
  // A picture of them all is refused, with where it stopped.
  for (const draw of [() => toSVG(lines), () => svgWithin(lines, { layout: "C-101" }, 20_000)]) {
    const thrown = settled(2000, draw);
    assert.ok(thrown instanceof RangeError);
    assert.ok(thrown.message.includes(`it stopped at ${top}`));
  }
});

test("a chain of blocks deeper than the stack is followed to its end", () => {
  const chain = nested(line, 12_000, 1);
  const drawing = withModel(chain);
  assert.deepEqual(
    within(3000, () => lint(drawing)),
    [],
  );
  assert.deepEqual(
    within(2000, () => extents([chain.top], [], chain.blocks).map(written)),
    [0, 0, 1, 1],
  );
  assert.deepEqual(
    within(2000, () => inspectText(drawing)),
    [],
  );
  assert.match(
    within(2000, () => toSVG(drawing)),
    /data-block="B11999"/,
  );
  // A chain whose last block inserts its first is a cycle: each of its blocks is an error.
  (chain.blocks[0]!.entities as Entity[]).push({
    kind: "insert",
    layer: "0",
    block: "B11999",
    at: [0, 0],
  });
  const found = within(3000, () => lint(withModel(chain)));
  assert.equal(found.filter((d) => d.rule === "block-cycle").length, 12_000);
  assert.match(found.at(-1)!.message, /^lint stopped .* at the cycle of block "B\d+"/);
});

test("lint pays for what inserts repeat, and toDXF refuses what it stopped short of", () => {
  const block: Block = {
    name: "POINT",
    entities: [],
    attributes: Array.from({ length: 600 }, (_, i) => ({
      tag: `T${i}`,
      value: "V",
      layer: "0",
      at: [0, i] as Point,
      height: 1,
      rotation: 0,
    })),
  };
  const points: Drawing = {
    ...createDrawing({ units: "ft" }).build(),
    blocks: [block],
    entities: Array.from({ length: 1000 }, (_, i) => ({
      kind: "insert",
      layer: "0",
      block: "POINT",
      at: [i, 0] as Point,
      id: `p${i}`,
    })),
  };
  const thrown = settled(2000, () => toDXF(points));
  assert.ok(thrown instanceof DrawingError);
  assert.deepEqual(
    thrown.diagnostics.map((d) => [d.rule, d.severity]),
    [["check-capped", "warning"]],
  );
  assert.match(thrown.diagnostics[0]!.message, /at insert #\d+ of model space/);
  // The same drawing with fewer inserts is checked in full.
  const fewer = { ...points, entities: points.entities.slice(0, 100) };
  assert.deepEqual(
    within(2000, () => lint(fewer)),
    [],
  );
});

test("every walk stops at the first empty slot of a list", () => {
  // oxlint-disable-next-line unicorn/no-new-array
  const slots = () => new Array(2 ** 32 - 1);
  const layout = sheet.layouts![0]!;
  const hole: Insert = { kind: "insert", layer: "0", block: "HOLED", at: [0, 0] };
  const holed = (block: Partial<Block>): Drawing => ({
    ...sheet,
    blocks: [...sheet.blocks!, { name: "HOLED", entities: [], ...block }],
    entities: [...sheet.entities, hole],
  });
  for (const drawing of [
    { ...sheet, layers: slots() },
    { ...sheet, entities: slots() },
    { ...sheet, blocks: slots() },
    { ...sheet, textStyles: slots() },
    { ...sheet, linetypes: slots() },
    { ...sheet, dimensionStyles: slots() },
    { ...sheet, xrefs: slots() },
    { ...sheet, layouts: slots() },
    holed({ entities: slots() }),
    holed({ attributes: slots() }),
    // oxlint-disable-next-line no-sparse-arrays
    holed({ attributes: [undefined, , undefined] as never }),
    holed({ attributes: [null, 1, "A"] as never }),
    { ...sheet, layouts: [{ ...layout, entities: slots() }] },
    { ...sheet, layouts: [{ ...layout, viewports: slots() }] },
    {
      ...sheet,
      entities: [
        ...sheet.entities,
        { kind: "polyline", layer: "0", points: slots(), closed: true },
      ],
    },
    {
      ...sheet,
      linetypes: [...sheet.linetypes!, { name: "HOLE", description: "", pattern: slots() }],
    },
  ] as Drawing[]) {
    assert.ok(within(1000, () => lint(drawing)).length > 0);
    for (const fn of [
      () => inspectText(drawing),
      () => toSVG(drawing),
      () => toSVG(drawing, { layout: "C-101" }),
      () => extents(drawing.entities, drawing.textStyles, drawing.blocks),
    ]) {
      const result = settled(1000, fn);
      assert.ok(!(result instanceof Error) || result instanceof RangeError, String(result));
    }
  }
});

/** The extents of some entities as a walk of every insert finds them, point by point. */
function walkedExtents(
  entities: readonly Entity[],
  blocks: readonly Block[],
  isHidden: (layer: LayerRef) => boolean,
  isFrozen: (layer: LayerRef) => boolean,
): number[] {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const shape = (e: Exclude<Entity, Insert>, matrix?: readonly number[]) => {
    const add = (x: number, y: number) => {
      const [px, py] = matrix ? mapPoint(matrix as never, [x, y]) : [x, y];
      box[0] = Math.min(box[0]!, px);
      box[1] = Math.min(box[1]!, py);
      box[2] = Math.max(box[2]!, px);
      box[3] = Math.max(box[3]!, py);
    };
    if (e.kind === "line") [e.from, e.to].forEach((p) => add(...p));
    if (e.kind === "polyline") e.points.forEach((p) => add(...p));
    if (e.kind === "circle") {
      for (const [i, j] of [
        [-1, -1],
        [1, 1],
        ...(matrix
          ? [
              [-1, 1],
              [1, -1],
            ]
          : []),
      ] as const) {
        add(e.center[0] + i * e.radius, e.center[1] + j * e.radius);
      }
    }
    if (e.kind === "text") {
      const { corners, descent } = measureText(e);
      const [c0, c1, c2, c3] = corners;
      corners.forEach((p) => add(...p));
      const below = descent / e.height || 0;
      add(c0[0] - (c3[0] - c0[0]) * below, c0[1] - (c3[1] - c0[1]) * below);
      add(c1[0] - (c2[0] - c1[0]) * below, c1[1] - (c2[1] - c1[1]) * below);
    }
  };
  const byKey = blocksByKey(blocks);
  for (const e of entities) {
    if (e.kind !== "insert") shape(e);
    else {
      eachDrawn(e, byKey, isFrozen, (drawn, { matrix, layer }) => {
        if (!isHidden(layer)) shape(drawn, matrix);
      });
    }
  }
  return box;
}

/** Numbers from 0 up to 1, the same from one seed on every run. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** True when `outer` holds all of `inner`. */
const holds = (outer: readonly number[], inner: readonly number[]): boolean =>
  outer[0]! <= inner[0]! &&
  outer[1]! <= inner[1]! &&
  outer[2]! >= inner[2]! &&
  outer[3]! >= inner[3]!;

test("a block's box holds a walk's, and is a walk's where no insert is turned", () => {
  const random = seeded(7);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const point = (): Point => [random() * 100 - 50, random() * 100 - 50];
  const none = [Infinity, Infinity, -Infinity, -Infinity];
  for (let n = 0; n < 300; n++) {
    const off = random() < 0.5;
    const cold = random() < 0.5;
    const hidden = (layer: LayerRef) => off && layer.name === "H";
    const frozen = (layer: LayerRef) => cold && layer.name === "F";
    // Moves that cancel on the way down, and a cycle with inserts of its blocks from outside.
    const far = random() < 0.2;
    const cyclic = random() < 0.15;
    const level = random() < 0.4;
    const turn = (...angles: number[]): number => (level ? 0 : pick([...angles, random() * 360]));
    const blocks: Block[] = [];
    const depth = 1 + Math.floor(random() * 5);
    for (let i = 0; i < depth; i++) {
      const entities: Entity[] = [];
      for (let k = 0; k < 1 + Math.floor(random() * 4); k++) {
        const layer = pick(["0", "A", "H", "F"]);
        entities.push(
          pick<() => Entity>([
            () => ({ kind: "line", layer, from: point(), to: point() }),
            () => ({ kind: "circle", layer, center: point(), radius: 1 + random() * 9 }),
            () => ({ ...(text(pick(["AB", "gjq", "WIDE TEXT"])) as Text), layer, at: point() }),
            () => ({ kind: "polyline", layer, points: [point(), point(), point()], closed: true }),
          ])(),
        );
      }
      for (let k = 0; i > 0 && k < 1 + Math.floor(random() * 3); k++) {
        entities.push({
          kind: "insert",
          layer: pick(["0", "A", "H", "F"]),
          block: `B${Math.floor(random() * i)}`,
          at: far
            ? [(i % 2 === 0 ? 1e16 : -1e16) + random(), 0]
            : [random() * 200 - 100, random() * 200 - 100],
          rotation: turn(0, 90, 180, -90),
          scale: pick<[number, number]>([
            [1, 1],
            [2, 2],
            [-1, 1],
            [0.37, 1.9],
          ]),
          ...(random() < 0.3 ? { attributes: { T: "SET" } } : {}),
        });
      }
      if (cyclic && i === 0 && depth > 1) {
        entities.push({ kind: "insert", layer: "0", block: `B${depth - 1}`, at: point() });
      }
      blocks.push({
        name: `B${i}`,
        base: [random() * 10, random() * 10],
        entities,
        ...(random() < 0.3
          ? {
              attributes: [
                {
                  tag: "T",
                  value: "DEFAULT",
                  layer: pick(["0", "A", "H"]),
                  at: point(),
                  height: 2,
                  rotation: 30,
                },
              ],
            }
          : {}),
      });
    }
    const top: Entity[] = Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({
      kind: "insert",
      layer: pick(["0", "A", "H", "F"]),
      block: cyclic ? `B${Math.floor(random() * depth)}` : `B${depth - 1}`,
      at: [random() * 1000, random() * 1000],
      rotation: turn(0, 90),
      scale: pick<[number, number]>([
        [1, 1],
        [3, -3],
        [0.5, 0.25],
      ]),
    }));
    const expected = walkedExtents(top, blocks, hidden, frozen);
    const found = boxer([], blocks, hidden, frozen)(top) ?? none;
    assert.ok(holds(found, expected), `drawing ${n}: ${found} for ${expected}`);
    // A walk of the blocks with their matrices composed is a walk's, through a cycle too.
    if (level) assert.deepEqual(found.map(written), expected.map(written), `drawing ${n}`);
    // A turned box is larger than what it holds by no more than its own size at each level.
    if (!far && expected[0] !== Infinity) {
      const reach = 2 ** (depth + 1) * (expected[2]! - expected[0]! + expected[3]! - expected[1]!);
      const grown = [-reach, -reach, reach, reach].map((d, i) => expected[i]! + d);
      assert.ok(holds(grown, found), `drawing ${n}: ${found} for ${expected}`);
    }
    // With no walks left past each placement's first 64 blocks, a placement maps the box of
    // all its block draws, widened by what rounding can move a number on the way.
    if (!cyclic) {
      const unpaid = boxer([], blocks, hidden, frozen, undefined, [], [], 0)(top) ?? none;
      assert.ok(holds(unpaid, expected), `drawing ${n}: ${unpaid} for ${expected}`);
      if (level && !far) {
        assert.deepEqual(unpaid.map(written), expected.map(written), `drawing ${n}`);
      }
    }
  }
});

test("large ordinary drawings get the boxes a walk of every insert gives", () => {
  const symbol: Block = {
    name: "SYM",
    base: [0, 0],
    entities: [
      { kind: "line", layer: "0", from: [0, 0], to: [4, 0] },
      { kind: "circle", layer: "0", center: [2, 1], radius: 1 },
      { ...(text("A1") as Text), at: [0, 2], height: 0.5 },
      {
        kind: "polyline",
        layer: "0",
        points: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
        closed: true,
      },
    ],
  };
  // Each insert turned its own way, which no limit makes looser.
  const turned: Insert[] = Array.from({ length: 3000 }, (_, i) => ({
    kind: "insert",
    layer: "0",
    block: "SYM",
    at: [(i % 50) * 10.25, Math.floor(i / 50) * 10.5],
    rotation: (i * 0.137) % 360,
  }));
  const never = () => false;
  const walked = walkedExtents(turned, [symbol], never, never);
  assert.deepEqual(boxer([], [symbol], never, never, undefined, [], [], 0)(turned), walked);
  const drawing: Drawing = {
    ...createDrawing({ units: "ft" }).build(),
    blocks: [symbol],
    entities: turned,
  };
  const [x0, y0, x1, y1] = walked as [number, number, number, number];
  const margin = Math.max(x1 - x0, y1 - y0, 1) * 0.02;
  assert.ok(
    svgWithin(drawing, {}, 20_000).includes(
      `viewBox="${[x0 - margin, -(y1 + margin), x1 - x0 + margin * 2, y1 - y0 + margin * 2].map((v) => String(written(v))).join(" ")}"`,
    ),
  );
  // Attributes an insert places from its block are work the drawing holds, not a repeat.
  const tag: Block = {
    name: "TAG",
    base: [0, 0],
    entities: [{ kind: "circle", layer: "0", center: [0, 0], radius: 0.5 }],
    attributes: Array.from({ length: 20 }, (_, i) => ({
      tag: `T${i}`,
      value: "V",
      layer: "0",
      at: [1, i * 0.6] as Point,
      height: 0.5,
      rotation: 0,
    })),
  };
  const tags: Drawing = {
    ...drawing,
    blocks: [tag],
    entities: Array.from({ length: 1000 }, (_, i) => ({
      kind: "insert",
      layer: "0",
      block: "TAG",
      id: `p${i}`,
      at: [(i % 50) * 12.5, Math.floor(i / 50) * 15] as Point,
      rotation: (i * 0.29) % 360,
      attributes: { T0: `P${i}` },
    })),
  };
  assert.deepEqual(lintWithin(tags, {}, 0), []);
  assert.deepEqual(
    boxer([], [tag], never, never, undefined, [], [], 0)(tags.entities),
    walkedExtents(tags.entities, [tag], never, never),
  );
});

test("what a drawing repeats costs only what the checks and the picture make of it", () => {
  const base = createDrawing({ units: "ft" }).build();
  const lines = (count: number, layer = "0"): Entity[] =>
    Array.from({ length: count }, (_, i) => ({
      kind: "line",
      layer,
      from: [i * 0.01, 0],
      to: [i * 0.01, 1],
    }));
  const placed = (block: string, count: number, extra: Partial<Insert> = {}): Insert[] =>
    Array.from({ length: count }, (_, i) => ({
      kind: "insert",
      layer: "0",
      block,
      at: [(i % 40) * 5, Math.floor(i / 40) * 5],
      ...extra,
    }));
  // inspectText walks what it checks: a block of 200 lines and one label costs two steps.
  const labelled: Drawing = {
    ...base,
    blocks: [{ name: "WC", base: [0, 0], entities: [...lines(200), text("WC-1")] }],
    entities: placed("WC", 1000),
  };
  assert.deepEqual(inspectWithin(labelled, {}, 200_000), []);
  // A survey given as an xref is walked once free of the limit, as its own model space would be.
  const survey: Drawing = {
    ...base,
    entities: Array.from({ length: 20_000 }, (_, i) => ({
      ...(text(String(i)) as Text),
      at: [(i % 200) * 10, Math.floor(i / 200) * 10] as Point,
    })),
  };
  const host: Drawing = {
    ...base,
    xrefs: [{ name: "SURVEY", path: "survey.dwg" }],
    entities: [{ kind: "insert", layer: "0", block: "SURVEY", at: [0, 0] }],
  };
  const options = { xrefs: { SURVEY: survey } };
  assert.deepEqual(inspectWithin(host, options, 200_000), inspectWithin(host, options, Infinity));
  // A value an insert holds is read once for each time the insert is: only a definition's,
  // which each insert without one repeats, is paid for by its length.
  const valued = (values: boolean): Drawing => ({
    ...base,
    blocks: [
      {
        name: "EQ",
        base: [0, 0],
        entities: lines(1),
        attributes: Array.from({ length: 20 }, (_, i) => ({
          tag: `A${i}`,
          value: "D".repeat(66),
          layer: "0",
          at: [0, -i] as Point,
          height: 0.4,
          rotation: 0,
        })),
      },
    ],
    entities: placed(
      "EQ",
      100,
      values
        ? {
            attributes: Object.fromEntries(
              Array.from({ length: 20 }, (_, i) => [`A${i}`, "V".repeat(66)]),
            ),
          }
        : {},
    ),
  });
  assert.deepEqual(lintWithin(valued(true), {}, 0), []);
  assert.deepEqual(
    lintWithin(valued(false), {}, 0).map((d) => d.rule),
    ["check-capped"],
  );
  // toSVG counts what it draws against the characters, and walks a limit of what draws nothing.
  const floors = (layer: string): Drawing => ({
    ...base,
    layers: [...base.layers, { name: "OFF", color: 1, off: true }],
    blocks: [{ name: "FLOOR", base: [0, 0], entities: lines(200, layer) }],
    entities: placed("FLOOR", 150),
  });
  assert.equal(svgWithin(floors("0"), {}, 20_000), svgWithin(floors("0"), {}, Infinity));
  const hidden = settled(1000, () => svgWithin(floors("OFF"), {}, 20_000));
  assert.ok(hidden instanceof RangeError);
  assert.match(hidden.message, /that draw nothing.*it stopped at insert #99 of model space/);
  // The elements of an insert are joined as they are made, each on a line of its own.
  const one: Drawing = {
    ...base,
    blocks: [{ name: "BIG", base: [0, 0], entities: lines(2500) }],
    entities: placed("BIG", 1),
  };
  const group = svgWithin(one, {}, 20_000).split("\n").slice(3, -4);
  assert.equal(group.length, 2500);
  assert.ok(group.every((element) => /^ {6}<line [^\n<]*\/>$/.test(element)));
  // A sheet of many viewports looks through model space for each, the first 64 free.
  const sheet70 = (entities: Entity[]): Drawing => ({
    ...base,
    entities: lines(2000),
    layouts: [
      {
        name: "S-1",
        paper: "ARCH D",
        entities,
        viewports: Array.from({ length: 70 }, (_, i) => ({
          layer: "0",
          corner: [1 + (i % 10) * 3, 1 + Math.floor(i / 10) * 3] as Point,
          width: 2,
          height: 2,
          center: [i * 0.2, 0.5] as Point,
          ratio: 1,
        })),
      },
    ],
  });
  assert.equal(
    svgWithin(sheet70([]), { layout: "S-1" }, 1000),
    svgWithin(sheet70([]), { layout: "S-1" }, Infinity),
  );
  // A sheet may hold more entities than a call takes arguments.
  assert.equal(typeof toSVG(sheet70(lines(200_000)), { layout: "S-1" }), "string");
});

test("a cycle's box holds what each way in draws", () => {
  const blocks: Block[] = [
    {
      name: "A",
      base: [0, 0],
      entities: [
        { kind: "line", layer: "0", from: [0, 0], to: [1, 0] },
        { kind: "insert", layer: "0", block: "B", at: [100, 0] },
      ],
    },
    {
      name: "B",
      base: [0, 0],
      entities: [
        { kind: "line", layer: "0", from: [0, 0], to: [1, 0] },
        { kind: "insert", layer: "0", block: "A", at: [100, 0] },
      ],
    },
  ];
  const top: Insert[] = [
    { kind: "insert", layer: "0", block: "A", at: [0, 0] },
    { kind: "insert", layer: "0", block: "B", at: [1000, 0] },
  ];
  assert.deepEqual(extents(top, [], blocks).map(written), [0, 0, 1101, 0]);
  const never = () => false;
  assert.ok(holds(extents(top, [], blocks), walkedExtents(top, blocks, never, never)));
});

test("moves that cancel through nested inserts never lose what they draw", () => {
  const blocks: Block[] = [
    { name: "B0", base: [0, 0], entities: [line] },
    {
      name: "B1",
      base: [0, 0],
      entities: [{ kind: "insert", layer: "0", block: "B0", at: [-1e16, 0] }],
    },
    {
      name: "B2",
      base: [0, 0],
      entities: [{ kind: "insert", layer: "0", block: "B1", at: [1e16, 0] }],
    },
  ];
  const top: Insert = { kind: "insert", layer: "0", block: "B2", at: [0, 0] };
  // The box of B1 rounds the line away at 1e16, and is widened by what rounding can lose.
  const box = extents([top], [], blocks);
  assert.ok(holds(box, [0, 0, 1, 1]), String(box));
  assert.ok(holds([-200, -200, 200, 200], box), String(box));
});

test("a limit that is reached is never silent", () => {
  const definitions = (count: number, value = "V") =>
    Array.from({ length: count }, (_, i) => ({
      tag: `T${i}`,
      value,
      layer: "0",
      at: [0, i] as Point,
      height: 1,
      rotation: 0,
    }));
  const many: Block = {
    name: "MANY",
    base: [0, 0],
    entities: [{ ...(text("W".repeat(100_000)) as Text), at: [100, 100] }],
    attributes: definitions(2000),
  };
  const at = (x: number, block = "MANY"): Insert => ({
    kind: "insert",
    layer: "0",
    block,
    at: [x, 0],
  });
  // What a block holds is read once and costs nothing against the limit.
  const plain = { ...many, attributes: [] };
  const once = boxer([], [plain], undefined, undefined, undefined, [], [], 0);
  const never = () => false;
  assert.deepEqual(once([at(0)]), walkedExtents([at(0)], [plain], never, never));
  assert.equal(once.capped, undefined);
  // Each attribute an insert places past its first 64 is work done again for each insert.
  const repeated = Array.from({ length: 300 }, (_, i) => at(i * 1e6));
  const thrown = settled(1000, () =>
    extents(repeated, [], [many], undefined, undefined, undefined, [], [], 100_000),
  );
  assert.ok(thrown instanceof RangeError);
  assert.match(thrown.message, /stopped at insert #\d+/);
  // lint counts the extents of model space against its own limit: what an insert places past
  // its first 64 attributes is paid for by the checks and again by the box.
  const placing: Block = {
    name: "PLACING",
    base: [0, 0],
    entities: [],
    attributes: definitions(128),
  };
  const drawing: Drawing = {
    ...sheet,
    blocks: [...sheet.blocks!, placing],
    entities: [...sheet.entities, ...Array.from({ length: 300 }, (_, i) => at(i, "PLACING"))],
  };
  const found = within(1000, () => lintWithin(drawing, {}, 30_000));
  assert.match(
    found.at(-1)!.message,
    /in the box of what model space draws; a problem past there may be unreported/,
  );
  // The DXF writer works the extents out within lint's limit and refuses what it stops on.
  const refused = settled(1000, () =>
    toDXFR2018({
      ...createDrawing({ units: "ft" }).build(),
      blocks: [many],
      entities: Array.from({ length: 300 }, (_, i) => at(i)),
    }),
  );
  assert.ok(refused instanceof DrawingError);
  assert.deepEqual(
    refused.diagnostics.map((d) => d.rule),
    ["check-capped"],
  );
  // lint boxes what the layouts place too, as the writer does, so it says where the writer stops.
  const sheets = (block: Block): Drawing => ({
    ...createDrawing({ units: "ft" }).build(),
    blocks: [block],
    layouts: Array.from({ length: 300 }, (_, i) => ({
      name: `S-${i}`,
      paper: "ARCH D",
      entities: [at(0, block.name)],
      viewports: [],
    })),
  });
  assert.match(
    within(1000, () => lintWithin(sheets(placing), {}, 30_000)).at(-1)!.message,
    /in the box of what layout "S-\d+" draws/,
  );
  assert.ok(settled(1000, () => toDXFR2018(sheets(many))) instanceof DrawingError);
});

test("repeated work stops at the limit, and once a limit is reached no more is done", () => {
  // A long text at the bottom of a tree is paid for by its length before it is looked at, and
  // a blank one is never walked.
  for (const value of ["A" + " ".repeat(1_000_000), " ".repeat(1_000_000)]) {
    const tree = nested(text(value), 21, 2);
    const drawing = {
      ...createDrawing({ units: "ft" }).build(),
      blocks: tree.blocks,
      entities: [tree.top],
    };
    assert.deepEqual(
      within(1000, () => inspectText(drawing).map((w) => w.rule)),
      value.trim() === "" ? [] : ["text-check-capped"],
    );
  }
  // The definitions of a block are read once, however many inserts place them.
  const many = 40_000;
  const tagged: Block = {
    name: "P",
    base: [0, 0],
    entities: [],
    attributes: Array.from({ length: many }, (_, i) => ({
      tag: `T${i}`,
      value: "V",
      layer: "0",
      at: [0, i] as Point,
      height: 1,
      rotation: 0,
    })),
  };
  const placed = Array.from({ length: many }, (_, i): Insert => ({
    kind: "insert",
    layer: "0",
    block: "P",
    at: [i, 0],
  }));
  const box = boxer([], [tagged], undefined, undefined, undefined, [], [], 0);
  within(300, () => box(placed));
  assert.equal(box.capped, placed[0]);
  // A dashed line is cut only as far as the picture has room for.
  const zigzag: Drawing = {
    ...createDrawing({ units: "ft" }).build(),
    linetypes: [{ name: "FINE", description: "", pattern: [1, -1] }],
    entities: [
      {
        kind: "polyline",
        layer: "0",
        linetype: "FINE",
        closed: false,
        points: Array.from({ length: 3000 }, (_, i): Point => [i * 100, i % 2 === 0 ? 0 : 19_000]),
      },
    ],
  };
  const cut = settled(1000, () => svgWithin(zigzag, {}, 20_000));
  assert.ok(cut instanceof RangeError);
  assert.match(cut.message, /longer than toSVG writes/);
  // Every character a picture writes counts: the groups of inserts and their names too.
  for (const name of ["N", "N".repeat(10_000)]) {
    const named: Drawing = {
      ...createDrawing({ units: "ft" }).build(),
      blocks: [{ name, base: [0, 0], entities: [] }],
      entities: Array.from({ length: 100 }, (): Insert => ({
        kind: "insert",
        layer: "0",
        block: name,
        at: [0, 0],
      })),
    };
    const picture = settled(1000, () => svgWithin(named, {}, 1000));
    assert.ok(picture instanceof RangeError || (picture as string).length <= 250_000);
    assert.equal(typeof picture === "string", name.length === 1);
  }
});

test("what each insert, line or block of a cycle reads again is worked out once", () => {
  const base = createDrawing({ units: "ft" }).build();
  // A tag of 4,000,000 characters is quoted once, not for each of 4,000 inserts.
  const tag = "T".repeat(4_000_000);
  const tagged: Drawing = {
    ...base,
    blocks: [
      {
        name: "B",
        base: [0, 0],
        entities: [],
        attributes: [{ tag, value: "V", layer: "0", at: [0, 0], height: 1, rotation: 0 }],
      },
    ],
    entities: Array.from({ length: 4000 }, (_, i) => ({
      kind: "insert",
      layer: "0",
      block: "B",
      at: [i, 0],
    })),
  };
  assert.deepEqual(
    within(1000, () => lintWithin(tagged, {}, 0)),
    [],
  );
  // A pattern of 16,000 lengths is scaled once for 16,000 lines that each draw one dash.
  const pattern = Array.from({ length: 16_000 }, (_, i) => (i % 2 === 0 ? 1 + (i % 7) : -1));
  const dashed: Drawing = {
    ...base,
    linetypes: [{ name: "LONG", description: "", pattern }],
    entities: Array.from({ length: 16_000 }, (_, i) => ({
      kind: "line",
      layer: "0",
      linetype: "LONG",
      from: [0, i],
      to: [0.5, i],
    })),
  };
  assert.equal(typeof within(1000, () => svgWithin(dashed, {}, 20_000)), "string");
  // The way back through a ring of 60,000 blocks is put together in one pass.
  const count = 60_000;
  const ring: Drawing = {
    ...base,
    blocks: Array.from({ length: count }, (_, i) => ({
      name: `R${i}`,
      base: [0, 0],
      entities: [{ kind: "insert", layer: "0", block: `R${(i + 1) % count}`, at: [0, 0] }],
    })),
  };
  const found = within(2500, () => lint(ring));
  assert.equal(found.filter((d) => d.rule === "block-cycle").length, count);
});

test("what an entity holds is read once, however many times it is drawn", () => {
  const base = createDrawing({ units: "ft" }).build();
  const placed = (block: string, count: number): Insert[] =>
    Array.from({ length: count }, (_, i) => ({ kind: "insert", layer: "0", block, at: [i, 0] }));
  // A dashed polyline whose sides but one have no length draws one short path for each insert.
  const points: Point[] = [...Array.from({ length: 100_000 }, (): Point => [0, 0]), [0.5, 0]];
  const coincident: Drawing = {
    ...base,
    linetypes: [{ name: "DASHED", description: "", pattern: [0.25, -0.125] }],
    blocks: [
      {
        name: "P",
        base: [0, 0],
        entities: [{ kind: "polyline", layer: "0", linetype: "DASHED", points, closed: false }],
      },
    ],
    entities: placed("P", 1000),
  };
  assert.equal(
    within(1000, () => svgWithin(coincident, {}, 10_000)),
    svgWithin(coincident, {}, Infinity),
  );
  // A text style holds no value, height or place, so a text is measured by its own.
  const styled = (style: object): Drawing => ({
    ...base,
    textStyles: [{ name: "S", font: "txt.shx", ...style }],
    blocks: [{ name: "T", base: [0, 0], entities: [{ ...(text("A") as Text), style: "S" }] }],
    entities: placed("T", 1000),
  });
  const stray = styled({ value: "W".repeat(1_000_000), height: 50, at: [9, 9], align: "right" });
  const clean = styled({});
  assert.equal(
    within(1000, () => svgWithin(stray, {}, 20_000)),
    svgWithin(clean, {}, 20_000),
  );
  assert.deepEqual(
    within(1000, () => inspectWithin(stray, {}, 0)),
    inspectWithin(clean, {}, 0),
  );
  // The standard's checks measure each text the same way.
  const name = sheet.textStyles![0]!.name;
  const underStandard = (style: object): Drawing => ({
    ...sheet,
    textStyles: sheet.textStyles!.map((s, i) => (i === 0 ? { ...s, ...style } : s)),
    blocks: [
      ...sheet.blocks!,
      { name: "T", base: [0, 0], entities: [{ ...(text("A") as Text), style: name }] },
    ],
    entities: [...sheet.entities, ...placed("T", 1000)],
  });
  const rules = (drawing: Drawing) =>
    lint(drawing, { standard }).filter((d) => d.rule !== "text-style");
  assert.deepEqual(
    within(1000, () => rules(underStandard({ value: "W".repeat(1_000_000) }))),
    rules(underStandard({})),
  );
  // A name longer than any font's or arrowhead's is not looked up, and a long tag is paid for
  // each time an insert's values are searched for it.
  const huge = () => "N".repeat(10_000_000);
  const font: Drawing = { ...styled({ font: huge() }), entities: placed("T", 4000) };
  within(1000, () => svgWithin(font, {}, 20_000));
  within(1000, () => inspectWithin(font, {}, 0));
  const arrowed: Drawing = {
    ...base,
    dimensionStyles: [
      {
        name: "D",
        textHeight: 1,
        arrowSize: 1,
        extensionOffset: 0.1,
        extensionBeyond: 0.1,
        textGap: 0.1,
        precision: 2,
        arrowhead: huge() as never,
      },
    ],
    entities: Array.from({ length: 4000 }, (_, i) => ({
      kind: "aligned-dimension",
      layer: "0",
      style: "D",
      from: [0, i * 5],
      to: [10, i * 5],
      offset: 2,
    })),
  };
  for (const call of [
    () => svgWithin(arrowed, {}, 20_000),
    () => inspectWithin(arrowed, {}, 0),
    () => lint(arrowed),
  ]) {
    settled(1000, call);
  }
  const values = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`K${i}`, "V"]));
  const tag = huge();
  const searched: Drawing = {
    ...base,
    blocks: [
      {
        name: "B",
        base: [0, 0],
        entities: [],
        attributes: [{ tag, value: "V", layer: "0", at: [0, 0], height: 1, rotation: 0 }],
      },
    ],
    entities: placed("B", 4000).map((insert) => ({ ...insert, attributes: values })),
  };
  for (const call of [
    () => svgWithin(searched, {}, 20_000),
    () => inspectWithin(searched, {}, 0),
    () => extents(searched.entities, [], searched.blocks),
  ]) {
    settled(1000, call);
  }
  // The checks name the insert a text is drawn by when they stop at it.
  const piled: Drawing = {
    ...base,
    blocks: [{ name: "T", base: [0, 0], entities: [text("AAAA")] }],
    entities: [line, ...Array.from({ length: 200 }, () => placed("T", 1)[0]!)],
  };
  assert.match(
    inspectWithin(piled, {}, 2000).at(-1)!.message,
    /stopped short at insert #\d+ of model space/,
  );
  // A large block or xref is boxed once however many times it is placed: the box holds the
  // walk's, and is the walk's where the insert is not turned.
  const big: Block = {
    name: "BIG",
    base: [0, 0],
    entities: Array.from({ length: 20_000 }, (_, i): Entity => {
      const [x, y] = [(i % 200) * 6, Math.floor(i / 200) * 6];
      return i % 2 === 0
        ? { kind: "line", layer: "0", from: [x, y], to: [x + 1, y + 0.3] }
        : { ...(text(String(i)) as Text), at: [x, y + 0.6], height: 0.4 };
    }),
  };
  const never = () => false;
  for (const count of [1, 2, 10]) {
    const top = Array.from({ length: count }, (_, i): Insert => ({
      kind: "insert",
      layer: "0",
      block: "BIG",
      at: [i * 7000, 0],
      rotation: i * 7.3,
    }));
    const walked = walkedExtents(top, [big], never, never);
    const box = boxer([], [big])(top)!;
    if (count === 1) assert.deepEqual(box, walked);
    else assert.ok(holds(box, walked));
    const host = { ...base, xrefs: [{ name: "BIG", path: "big.dwg" }] };
    const xrefs = referencedByKey(host, { BIG: { ...base, entities: big.entities } });
    assert.deepEqual(boxer([], [], never, never, xrefs)(top), box);
  }
});

test("what many places share is read once, or paid for each time it is read again", () => {
  const base = createDrawing({ units: "ft" }).build();
  const blocks = (count: number, entities: () => Entity[]): Block[] =>
    Array.from({ length: count }, (_, i) => ({
      name: `B${i}`,
      base: [0, 0],
      entities: entities(),
    }));
  const placing = (list: readonly Block[]): Insert[] =>
    list.map((block, i) => ({ kind: "insert", layer: "0", block: block.name, at: [i * 3, 0] }));
  const drawn = (list: Block[], entities: Entity[] = placing(list)): Drawing => ({
    ...base,
    blocks: list,
    entities,
  });
  /** Counts the items read of the lists `counted` makes. */
  let reads = 0;
  const counted = <T>(list: T[]): T[] =>
    new Proxy(list, { get: (t, k, r) => (typeof k === "string" && reads++, Reflect.get(t, k, r)) });
  type Lists = { ring: Point[]; lines: Entity[] };
  const lists = (): Lists => ({
    ring: Array.from({ length: 40_000 }, (_, i): Point => [Math.cos(i), Math.sin(i)]),
    lines: Array.from({ length: 40_000 }, (_, i): Entity => ({ ...line, from: [i, 0] })),
  });
  const long = "W".repeat(1_000_000);
  const polyline = (points: Point[]): Entity => ({
    kind: "polyline",
    layer: "0",
    points,
    closed: true,
  });
  const tagged: Block = {
    name: "TAG",
    base: [0, 0],
    entities: [line],
    attributes: [{ tag: "T", value: "V", layer: "0", at: [0, 0], height: 1, rotation: 0 }],
  };
  const values = {
    T: long,
    ...Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`K${i}`, "V"])),
  };
  const shared: [string, (lists: Lists) => Drawing][] = [
    ["a list of points in 400 polylines", ({ ring }) => drawn(blocks(400, () => [polyline(ring)]))],
    ["a list of entities in 400 blocks", ({ lines }) => drawn(blocks(400, () => lines))],
    [
      "a polyline 1,000 times in model space",
      ({ ring }) =>
        drawn(
          [],
          Array.from({ length: 1000 }, () => polyline(ring)),
        ),
    ],
    [
      "a long value in 1,000 texts",
      () =>
        drawn(
          [],
          Array.from({ length: 1000 }, (_, i) => ({ ...(text(long) as Text), at: [0, i * 2] })),
        ),
    ],
    ["a long value in 1,000 blocks", () => drawn(blocks(1000, () => [text(long)]))],
    [
      "the values of 1,000 inserts",
      () =>
        drawn(
          [tagged],
          Array.from({ length: 1000 }, (_, i) => ({
            kind: "insert",
            layer: "0",
            block: "TAG",
            at: [i * 1e3, 0],
            attributes: values,
          })),
        ),
    ],
  ];
  const plain = lists();
  const watched = lists();
  const reading = { ring: counted(watched.ring), lines: counted(watched.lines) };
  for (const [name, make] of shared) {
    // The extents, the picture and the text checks read it once, so no limit is reached.
    const counting = make(reading);
    reads = 0;
    const box = boxer([], counting.blocks, undefined, undefined, undefined, [], [], 0);
    assert.ok(
      within(1000, () => box(counting.entities)),
      name,
    );
    assert.equal(box.capped, undefined, name);
    assert.ok(reads < 400_000, `${name}: ${reads} reads`);
    const drawing = make(plain);
    const warnings = within(1000, () => inspectWithin(drawing, {}, 0));
    assert.ok(
      warnings.every((w) => w.rule === "text-check-capped"),
      name,
    );
    settled(1000, () => svgWithin(drawing, {}, 20_000));
    // lint reads it again for each place, and pays for that.
    const found = within(1000, () => lintWithin(drawing, {}, 0));
    assert.ok(found.length < 2000, `${name}: ${found.length}`);
    if (!name.includes("long value")) assert.equal(found.at(-1)!.rule, "check-capped", name);
  }
});

test("a list of frozen layers many viewports share, and model space walked again for each set, are paid for", () => {
  const d = createDrawing({ units: "ft" });
  for (let i = 0; i < 100; i++) d.layer(`L${i}`, {}, () => d.line([i, 0], [i, 1]));
  const base = d.build();
  const viewport = { layer: "0", width: 1, height: 1, ratio: 12 } as const;
  // Each item read of the list counts, so that a pass that reads it again unpaid shows.
  let reads = 0;
  const shared: string[] = new Proxy(
    Array.from({ length: 20_000 }, () => "0"),
    { get: (t, k, r) => (typeof k === "string" && reads++, Reflect.get(t, k, r)) },
  );
  /** The items `check` reads of the shared list. */
  const readBy = (check: () => unknown): number => {
    reads = 0;
    try {
      check();
    } catch {
      // A walk that stops at its limit throws a RangeError, which the asserts below expect.
    }
    return reads;
  };
  const sharedBy = (count: number): Drawing => ({
    ...base,
    layouts: [
      {
        name: "A",
        paper: "ARCH D",
        entities: [],
        viewports: Array.from({ length: count }, () => ({
          ...viewport,
          corner: [0, 0] as const,
          center: [0, 0] as const,
          frozenLayers: shared,
        })),
      },
    ],
  });
  const sharing = sharedBy(100);
  assert.ok(lintWithin(sharing, {}, 10).some((x) => x.rule === "check-capped"));
  // The first viewport reads the list free, and the others read it no more unpaid.
  const once = readBy(() => lintWithin(sharedBy(1), {}, 10));
  assert.ok(readBy(() => lintWithin(sharing, {}, 10)) < 1.01 * once);
  const drawn = readBy(() => svgWithin(sharedBy(1), { layout: "A" }, 100));
  assert.ok(readBy(() => svgWithin(sharing, { layout: "A" }, 100)) < 1.01 * drawn);
  assert.deepEqual(
    lintWithin(sharing, {}, 1_000_000).filter((x) => x.severity === "error"),
    [],
  );
  assert.throws(() => svgWithin(sharing, { layout: "A" }, 100), RangeError);
  svgWithin(sharing, { layout: "A" }, 100_000);

  // Under a standard, 20,000 lines and 100 viewports that each freeze another layer.
  const lines = Array.from({ length: 20_000 }, (_, i): Entity => ({
    kind: "line",
    layer: "C-PROP",
    from: [i, 0],
    to: [i, 1],
  }));
  const [page] = sheet.layouts!;
  const plan = page!.viewports[0]!;
  const layers = sheet.layers.map((l) => l.name);
  const each: Drawing = {
    ...sheet,
    entities: [...sheet.entities, ...lines],
    layouts: [
      {
        ...page!,
        viewports: Array.from({ length: 100 }, (_, i) => ({
          ...plan,
          frozenLayers: [layers[i % layers.length]!, layers[(i * 7 + 3) % layers.length]!],
        })),
      },
    ],
  };
  const out: Diagnostic[] = [];
  lintStandard(each, standard, undefined, undefined, out, 1000);
  assert.ok(out.some((x) => x.rule === "standard-check-capped"));
  // Under a standard, the shared list is paid for before each pass reads it again.
  const onSheet = (count: number): Drawing => ({
    ...sheet,
    layouts: [
      {
        ...page!,
        viewports: Array.from({ length: count }, () => ({ ...plan, frozenLayers: shared })),
      },
    ],
  });
  const standardOnce = readBy(() =>
    lintStandard(onSheet(1), standard, undefined, undefined, [], 1000),
  );
  assert.ok(
    readBy(() => lintStandard(onSheet(100), standard, undefined, undefined, [], 1000)) <
      1.01 * standardOnce,
  );
  // Core lint pays for it too where each viewport reports an error first, here its id, which
  // all of them repeat, or an id that is no id.
  for (const id of ["plan", "no id"]) {
    const reported = (count: number): Drawing => {
      const drawing = onSheet(count);
      const [layout] = drawing.layouts!;
      return {
        ...drawing,
        layouts: [{ ...layout!, viewports: layout!.viewports.map((v) => ({ ...v, id })) }],
      };
    };
    assert.ok(
      readBy(() => lintWithin(reported(100), {}, 10)) <
        1.01 * readBy(() => lintWithin(reported(2), {}, 10)),
    );
  }
  // And so it is when one viewport is in the list many times.
  const one = { ...plan, frozenLayers: shared };
  const repeated = (count: number): Drawing => ({
    ...sheet,
    layouts: [{ ...page!, viewports: Array.from({ length: count }, () => one) }],
  });
  for (const check of [
    (drawing: Drawing) => lintStandard(drawing, standard, undefined, undefined, [], 1000),
    (drawing: Drawing) => lintWithin(drawing, {}, 10),
    (drawing: Drawing) => svgWithin(drawing, { layout: page!.name }, 100),
  ]) {
    // Past the first two, more of it is read no more.
    assert.ok(readBy(() => check(repeated(100))) < 1.01 * readBy(() => check(repeated(2))));
  }
});

test("numbers that leave the range of doubles on the way are walked, so the box holds the walk's", () => {
  const scaled = (block: string, s: number): Insert => ({
    kind: "insert",
    layer: "0",
    block,
    at: [0, 0],
    scale: [s, s],
  });
  const never = () => false;
  // Boxed from the inside, the line overflows at 1e360 and underflows below the least double,
  // where the walk's composed matrices keep it.
  for (const [leaf, scales] of [
    [
      [1e90, 1e90],
      [1e90, 1e90, 1e90, ...Array.from({ length: 45 }, () => 1e-6)],
    ],
    [
      [Number.MIN_VALUE, Number.MIN_VALUE],
      [0.5, 2],
    ],
  ] as const) {
    const blocks: Block[] = [
      { name: "B0", base: [0, 0], entities: [{ ...line, from: [0, 0], to: leaf as Point }] },
    ];
    scales.forEach((s, i) => {
      blocks.push({ name: `B${i + 1}`, base: [0, 0], entities: [scaled(`B${i}`, s)] });
    });
    const top = [scaled(`B${scales.length}`, 1)];
    const box = extents(top, [], blocks);
    assert.ok(box.every(Number.isFinite), String(box));
    assert.ok(holds(box, walkedExtents(top, blocks, never, never)), String(box));
    const dxf = toDXF({ ...createDrawing({ units: "ft" }).build(), blocks, entities: top });
    assert.ok(!dxf.includes("NaN"));
  }
  // A block that inserts itself is boxed once for any way in, through thousands of blocks.
  const self: Block = {
    name: "A",
    base: [0, 0],
    entities: [...Array.from({ length: 8000 }, () => scaled("A", 1)), line],
  };
  const through = [scaled("A", 1)];
  const parents = Array.from({ length: 8000 }, (_, i): Block => ({
    name: `P${i}`,
    base: [0, 0],
    entities: through,
  }));
  const selfBox = boxer([], [self, ...parents], undefined, undefined, undefined, [], [], 100_000);
  within(300, () => selfBox(parents.map((p) => scaled(p.name, 1))));
  // The walk of a block that inserts itself thousands of times pays for each insert it reads.
  const cyclic: Block[] = [
    {
      name: "A",
      base: [0, 0],
      entities: [...Array.from({ length: 8000 }, () => scaled("A", 1)), scaled("B", 0.5)],
    },
    { name: "B", base: [0, 0], entities: [{ ...line, to: [Number.MIN_VALUE, Number.MIN_VALUE] }] },
  ];
  const placed = boxer([], cyclic, undefined, undefined, undefined, [], [], 100_000);
  within(1000, () => placed(Array.from({ length: 8000 }, () => scaled("A", 2))));
  assert.ok(placed.capped);
});

test("toDXF refuses nothing lint passed, and toSVG refuses only what its walk would", () => {
  const base = createDrawing({ units: "ft" }).build();
  const at = (block: string, x = 0): Insert => ({ kind: "insert", layer: "0", block, at: [x, 0] });
  // A tree past the walks, beside a line that underflows on the way, as a placement walks it.
  const tree: Block[] = [{ name: "T0", base: [0, 0], entities: [line] }];
  for (let i = 1; i <= 20; i++)
    tree.push({ name: `T${i}`, base: [0, 0], entities: [at(`T${i - 1}`), at(`T${i - 1}`, 1)] });
  const drawing: Drawing = {
    ...base,
    blocks: [
      ...tree,
      { name: "Q", base: [0, 0], entities: [{ ...line, to: [1e-310, 1] }] },
      { name: "P", base: [0, 0], entities: [at("Q"), at("T19"), at("T18")] },
    ],
    entities: [at("P", 100)],
  };
  const found = within(2000, () => lint(drawing));
  const refused = settled(2000, () => toDXF(drawing));
  assert.equal(
    refused instanceof DrawingError,
    found.some((d) => d.rule === "check-capped"),
  );
  // A drawing given as its own xref: the walk skips the block it is in, and so does its cost.
  const blocks: Block[] = [{ name: "A", base: [0, 0], entities: [at("X"), at("T0")] }];
  for (let i = 0; i < 14; i++)
    blocks.push({ name: `T${i}`, base: [0, 0], entities: [at(`T${i + 1}`), at(`T${i + 1}`, 1)] });
  blocks.push({ name: "T14", base: [0, 0], entities: [line] });
  const host: Drawing = {
    ...base,
    blocks,
    xrefs: [{ name: "X", path: "x.dwg" }],
    entities: [at("A")],
  };
  assert.equal(
    typeof within(1000, () => svgWithin(host, { xrefs: { X: host } }, 100_000)),
    "string",
  );
});

test("what many places share is paid for through every field that reads it", () => {
  const base = createDrawing({ units: "ft" }).build();
  const long = "K".repeat(100_000);
  const insert = (block: string, i: number, extra: object = {}): Insert => ({
    kind: "insert",
    layer: "0",
    block,
    at: [i, 0],
    ...extra,
  });
  const definitions = Array.from({ length: 1000 }, (_, i) => ({
    tag: `T${i}`,
    value: "V",
    layer: "0",
    at: [0, 0] as Point,
    height: 1,
    rotation: 0,
  }));
  const blocks = Array.from({ length: 400 }, (_, i): Block => ({
    name: `B${i}`,
    base: [0, 0],
    entities: [line],
    attributes: definitions,
  }));
  const shown = (found: readonly { message: string }[]) =>
    found.reduce((sum, d) => sum + d.message.length, 0);
  // A list of definitions in 400 blocks, read for the text checks and under a standard.
  const defined: Drawing = { ...base, blocks, entities: blocks.map((b, i) => insert(b.name, i)) };
  within(1000, () => inspectWithin(defined, {}, 0));
  const ruled = within(2000, () => lintWithin(defined, { standard }, 0));
  assert.ok(shown(ruled) < 40_000_000, `${shown(ruled)} characters`);
  assert.ok(ruled.some((d) => d.rule === "standard-check-capped"));
  // One definition with 5,000 fields nobody knows, 500 times in one list.
  const odd = {
    ...definitions[0]!,
    ...Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`x${i}`, i])),
  };
  const repeated: Drawing = {
    ...base,
    blocks: [{ name: "ODD", base: [0, 0], entities: [], attributes: Array(500).fill(odd) }],
  };
  const reported = within(1000, () => lintWithin(repeated, {}, 0));
  assert.ok(reported.length < 20_000, `${reported.length} diagnostics`);
  assert.equal(reported.at(-1)!.rule, "check-capped");
  // One long name, tag or prefix that 400 entities share.
  const xref = { ...base, xrefs: [{ name: "X", path: "x.dwg" }] };
  const values = Object.fromEntries(Array.from({ length: 40_000 }, (_, i) => [`T${i}`, "V"]));
  for (const drawing of [
    { ...base, entities: Array.from({ length: 400 }, (_, i) => insert(long, i)) },
    {
      ...base,
      entities: Array.from({ length: 400 }, (_, i) => ({ ...line, layer: long, from: [i, 0] })),
    },
    {
      ...base,
      entities: Array.from({ length: 400 }, (_, i) =>
        insert("B0", i, { attributes: { [long]: "V" } }),
      ),
      blocks: [blocks[0]!],
    },
    {
      ...xref,
      entities: Array.from({ length: 400 }, (_, i) => insert("X", i, { attributes: values })),
    },
  ] as Drawing[]) {
    const found = within(2000, () => lintWithin(drawing, {}, 0));
    assert.ok(shown(found) < 1_000_000, `${shown(found)} characters`);
    assert.equal(found.at(-1)!.rule, "check-capped");
  }
  // An unknown field or a kind with a long name, quoted in each message the object gives.
  const z = "z".repeat(30_000);
  for (const odd of [
    { ...line, [z]: true },
    { ...line, kind: z },
  ]) {
    const entities = Array(400).fill(odd) as Entity[];
    const found = within(1000, () => lintWithin({ ...base, entities }, {}, 10_000));
    assert.ok(shown(found) < 400_000, `${shown(found)} characters`);
  }
  // The field a long unknown key is meant for is found without comparing each letter with each
  // field's.
  const key = "q".repeat(2_000_000);
  within(400, () => lintWithin({ ...base, entities: [{ ...line, [key]: 1 }] as Entity[] }, {}, 0));
  // Inserts that share one object of 8,000 values are not read for them again past the limit.
  const many = Object.fromEntries(Array.from({ length: 8000 }, (_, i) => [`T${i}`, "V"]));
  const sharing = Array.from({ length: 8000 }, (_, i) => insert("X", i, { attributes: many }));
  within(1000, () => lintWithin({ ...xref, entities: sharing }, {}, 0));
  const prefixed: Drawing = {
    ...base,
    dimensionStyles: [{ ...sheet.dimensionStyles![0]!, name: "D", prefix: long }],
    entities: Array.from({ length: 400 }, (_, i) => ({
      kind: "aligned-dimension",
      layer: "0",
      style: "D",
      from: [0, i * 5],
      to: [10 + i, i * 5],
      offset: 2,
    })),
  };
  const box = boxer([], [], undefined, undefined, undefined, prefixed.dimensionStyles, [], 8000);
  within(300, () => box(prefixed.entities));
  assert.ok(box.capped);
  // One drawing given for 400 xrefs is boxed again for each, and paid for.
  const source: Drawing = {
    ...base,
    entities: Array.from({ length: 40_000 }, (_, i): Entity => ({ ...line, from: [i, 0] })),
  };
  const host = {
    ...base,
    xrefs: Array.from({ length: 400 }, (_, i) => ({ name: `X${i}`, path: "x.dwg" })),
  };
  const xrefs = referencedByKey(host, Object.fromEntries(host.xrefs.map((x) => [x.name, source])));
  const placed = boxer([], [], undefined, undefined, xrefs, [], [], 0);
  within(300, () => placed(host.xrefs.map((x, i) => insert(x.name, i))));
  assert.ok(placed.capped);
});

test("an object that is not sound is reported once, and past the limit nothing more is read", () => {
  const base = createDrawing({ units: "ft" }).build();
  const shown = (found: readonly { message: string }[]) =>
    found.reduce((sum, d) => sum + d.message.length, 0);
  // One entity whose kind is 4,000,000 letters long, at 2,000 places, is quoted where it is
  // first met.
  const kind = { kind: "k".repeat(4_000_000), layer: "0" } as unknown as Entity;
  const quoted = within(1000, () => lint({ ...base, entities: Array(2000).fill(kind) }));
  assert.ok(shown(quoted) < 5_000_000, `${shown(quoted)} characters`);
  // Entities of their own that share one long field name nobody knows, or one long kind, pay for
  // each message that quotes it.
  const long = "q".repeat(1_000_000);
  for (const odd of [{ [long]: 1 }, { kind: long }]) {
    const entities = Array.from({ length: 400 }, (_, i): unknown => ({
      ...line,
      from: [i, 0],
      ...odd,
    }));
    const found = within(1000, () => lint({ ...base, entities: entities as Entity[] }));
    assert.ok(shown(found) < 40_000_000, `${shown(found)} characters`);
    assert.equal(found.at(-1)!.rule, "check-capped");
  }
  // One with 4,000 fields nobody knows, at 2,000 places, is not read again.
  const fields = Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`x${i}`, i]));
  const keyed = { ...line, ...fields } as Entity;
  within(300, () => lintWithin({ ...base, entities: Array(2000).fill(keyed) }, {}, 0));
  // Past the limit, a viewport with 4,000 fields nobody knows that 10,000 places share is asked
  // about once, after 2,000 texts that share a long value have stopped the checks.
  const value = "q".repeat(300_000);
  const said = Array.from({ length: 2000 }, (_, i): Entity => ({
    ...(text(value) as Text),
    at: [i, 0],
  }));
  const viewport = {
    layer: "0",
    corner: [1, 1],
    width: 34,
    height: 22,
    center: [170, 110],
    ratio: 120,
    ...fields,
  };
  const viewed = {
    ...base,
    entities: said,
    layouts: [
      { name: "A-101", paper: "ARCH D", viewports: Array(10_000).fill(viewport), entities: [] },
    ],
  } as unknown as Drawing;
  assert.equal(within(1000, () => lint(viewed)).at(-1)!.rule, "check-capped");
  // A drawing read from JSON that `lint` checks only part of is refused, as `toDXF` refuses it,
  // since an error past where it stopped would go unreported.
  const read = JSON.stringify({
    ...base,
    entities: [...said.slice(0, 100), { ...line, layer: "nope" }],
  });
  assert.throws(
    () => fromJSON(read),
    (thrown: unknown) =>
      thrown instanceof DrawingError && thrown.diagnostics.some((d) => d.rule === "check-capped"),
  );
  // Blocks that share one list of inserts of a long name are not read again for cycles once the
  // checks have stopped, here at the field nobody knows.
  const inserts = Array(80).fill({
    ...line,
    kind: "insert",
    block: "z".repeat(100_000),
    at: [0, 0],
  });
  const scanned = {
    ...base,
    extra: true,
    blocks: Array.from({ length: 40 }, (_, i) => ({
      name: `B${i}`,
      base: [0, 0],
      entities: inserts,
    })),
  } as unknown as Drawing;
  within(300, () => lintWithin(scanned, {}, 0));
  // Leaders whose notes take turns between two long strings that agree but near their end are
  // compared only until the checks stop.
  const a = "a".repeat(1_000_000);
  const b = `${a.slice(0, -30)}b${a.slice(-29)}`;
  const leaders: Drawing = {
    ...base,
    leaderStyles: [{ name: "L", textHeight: 1, arrowSize: 1, landing: 1, gap: 1 }],
    entities: Array.from({ length: 2000 }, (_, i): Entity => ({
      kind: "leader",
      layer: "0",
      style: "L",
      at: [0, 0],
      shafts: [
        [
          [0, 0],
          [1, 1],
        ],
      ],
      text: [i % 2 ? b : a],
    })),
  };
  const { get } = Strings.prototype;
  let lookups = 0;
  Strings.prototype.get = function (this: Strings<unknown>, key: string) {
    if (key.length === a.length) lookups++;
    return get.call(this, key);
  };
  try {
    const runs: (() => readonly { rule: string }[])[] = [
      () => lintWithin(leaders, {}, 0),
      () => inspectWithin(leaders, {}, 0),
    ];
    for (const run of runs) {
      lookups = 0;
      const found = within(1000, run);
      assert.match(found.at(-1)!.rule, /check-capped/);
      assert.ok(lookups < 100, `${lookups} lookups`);
    }
  } finally {
    Strings.prototype.get = get;
  }
});

test("long strings of one length are told apart, and one that takes another's place is paid for", () => {
  // V8 hashes a string over 16,383 characters by its length alone. Distinct values of one length
  // are read once each, as ordinary text is.
  const distinct = Array.from(
    { length: 2000 },
    (_, i) => "W".repeat(20_000) + String(i).padStart(6, "0"),
  );
  // Two that agree but past the characters a table keys them by take each other's place.
  const stem = "W".repeat(20_000);
  const twins = [0, 1].map((i) => `${stem.slice(0, 19_970)}${i}${stem.slice(19_971)}`);
  const texts = (value: (i: number) => string): Entity[] =>
    Array.from({ length: 2000 }, (_, i) => ({ ...(text(value(i)) as Text), at: [0, i * 2] }));
  const capped = (entities: Entity[]) => {
    const box = boxer([], [], undefined, undefined, undefined, [], [], 100_000);
    within(2000, () => box(entities));
    return box.capped !== undefined;
  };
  assert.equal(capped(texts((i) => distinct[i]!)), false);
  assert.equal(capped(texts(() => stem)), false);
  assert.equal(capped(texts((i) => twins[i % 2]!)), true);
  const drawing = (entities: Entity[], blocks: Block[] = []): Drawing => ({
    ...createDrawing({ units: "ft" }).build(),
    blocks,
    entities,
  });
  // Blank values are told apart the same way: one shared by many blocks is read once, and two
  // that take each other's place are paid for.
  const blank = " ".repeat(100_000);
  const blankTwins = [0, 1].map(
    (i) => `${blank.slice(0, 99_970)}${i ? "\u00a0" : " "}${blank.slice(99_971)}`,
  );
  const holding = Array.from({ length: 1000 }, (_, i): Block => ({
    name: `B${i}`,
    base: [0, 0],
    entities: [text(blank)],
  }));
  const warned = within(1000, () => inspectWithin(drawing([], holding), {}, 0));
  assert.ok(!warned.some((w) => w.rule === "text-check-capped"));
  const twinned = within(1000, () =>
    inspectWithin(drawing(texts((i) => blankTwins[i % 2]!)), {}, 1000),
  );
  assert.equal(twinned.at(-1)!.rule, "text-check-capped");
  // Past the limit no value is looked up, which would compare it with another.
  const wide = " ".repeat(1_000_000);
  const wideTwins = [0, 1].map(
    (i) => `${wide.slice(0, 999_970)}${i ? "\u00a0" : " "}${wide.slice(999_971)}`,
  );
  const pairs = Array.from({ length: 2000 }, (_, i): Block => ({
    name: `C${i}`,
    base: [0, 0],
    entities: [text(wideTwins[i % 2]!)],
  }));
  within(150, () => inspectWithin(drawing([], pairs), {}, 0));
  assert.ok(
    !within(2000, () => lint(drawing(texts((i) => distinct[i]!)))).some(
      (d) => d.rule === "check-capped",
    ),
  );
  assert.equal(
    within(2000, () => lintWithin(drawing(texts((i) => twins[i % 2]!)), {}, 100_000)).at(-1)!.rule,
    "check-capped",
  );
});

test("a text warning pays for the texts and tags it quotes", () => {
  const value = "W".repeat(10_000);
  // Each text overlaps the one before it, so each but the first is warned about.
  const chain = (texts: (i: number) => Entity): Drawing => ({
    ...createDrawing({ units: "ft" }).build(),
    entities: Array.from({ length: 1000 }, (_, i) => texts(i)),
  });
  for (const drawing of [
    chain((i) => ({ ...(text(value) as Text), at: [i * 7000, 0] })),
    chain((i) => ({ ...(text(`${i}${value}`) as Text), at: [i * 7000, 0] })),
  ]) {
    const found = within(1000, () => inspectWithin(drawing, {}, 100_000));
    assert.equal(found.at(-1)!.rule, "text-check-capped");
    const quoted = found.reduce((sum, w) => sum + w.message.length, 0);
    assert.ok(quoted < 200_000, `${quoted} characters`);
    assert.ok(found.length > 2);
  }
});

test("a proxy is read as the data its traps give, with each trap called a bounded number of times", () => {
  let traps = 0;
  /** A proxy over `value` and all it holds, which forwards and counts each trap. */
  const wrap = <T>(value: T, seen = new WeakMap<object, unknown>()): T => {
    if (typeof value !== "object" || value === null) return value;
    if (seen.has(value)) return seen.get(value) as T;
    const proxy = new Proxy(value, {
      get: (t, k, r) => (traps++, wrap(Reflect.get(t, k, r), seen)),
      getOwnPropertyDescriptor: (t, k) => {
        traps++;
        const field = Reflect.getOwnPropertyDescriptor(t, k);
        return field && "value" in field ? { ...field, value: wrap(field.value, seen) } : field;
      },
      ownKeys: (t) => (traps++, Reflect.ownKeys(t)),
      has: (t, k) => (traps++, Reflect.has(t, k)),
      getPrototypeOf: (t) => (traps++, Reflect.getPrototypeOf(t)),
    });
    seen.set(value, proxy);
    return proxy;
  };
  const values = (value: unknown): number =>
    typeof value === "object" && value !== null
      ? Object.values(value).reduce<number>((n, v) => n + values(v), 1)
      : 1;
  const drawing = structuredClone(sheet);
  const document = structuredClone(standard);
  const most = 64 * (values(drawing) + values(document));
  const calls: [string, (d: Drawing) => unknown][] = [
    ["lint", (d) => lint(d, { standard: d === drawing ? document : wrap(document) })],
    ["inspectText", (d) => inspectText(d)],
    ["toSVG", (d) => toSVG(d)],
    ["toSVG of the layout", (d) => toSVG(d, { layout: "C-101" })],
  ];
  for (const [name, call] of calls) {
    traps = 0;
    assert.deepEqual(
      within(1000, () => call(wrap(drawing))),
      call(drawing),
      name,
    );
    assert.ok(traps <= most, `${name}: ${traps} traps for ${most}`);
  }
  // A proxy is read in proportion to what it reports: an array that reports 2^32 - 1 sound lines
  // is read to its end, within the limits. Data that its traps make up as it is read, with no
  // end, is refused where its shape is wrong.
  const endless = (): object =>
    new Proxy(
      {},
      {
        get: () => endless(),
        ownKeys: () => ["a"],
        getOwnPropertyDescriptor: () => ({
          value: endless(),
          enumerable: true,
          configurable: true,
          writable: true,
        }),
      },
    );
  assert.ok(within(1000, () => lint(endless() as Drawing)).length > 0);
  assert.deepEqual(
    within(1000, () => lint(drawing, { standard: endless() as never }).map((d) => d.rule)),
    ["standard"],
  );
});

type Text = Extract<Entity, { kind: "text" }>;

test("lint, inspectText, extents and toSVG stay bounded on any drawing, and lint never throws", () => {
  const random = seeded(11);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const long = "W".repeat(100_000);
  type Data = Record<string, unknown>;
  const copies = (list: unknown): Data[] =>
    ((list as readonly Data[] | undefined) ?? []).map((item) => ({ ...item }));
  const leader = (fields: Data): Entity =>
    ({
      kind: "leader",
      layer: "0",
      style: sheet.leaderStyles![0]!.name,
      text: ["N"],
      at: [10, 10],
      shafts: [[[0, 0]]],
      ...fields,
    }) as unknown as Entity;
  for (let n = 0; n < 16; n++) {
    const blocks = copies(sheet.blocks);
    const layout: Data = {
      ...sheet.layouts![0]!,
      entities: copies(sheet.layouts![0]!.entities),
      viewports: copies(sheet.layouts![0]!.viewports),
    };
    const drawing: Data = {
      ...sheet,
      layers: copies(sheet.layers),
      linetypes: copies(sheet.linetypes),
      textStyles: copies(sheet.textStyles),
      dimensionStyles: copies(sheet.dimensionStyles),
      leaderStyles: copies(sheet.leaderStyles),
      entities: copies(sheet.entities),
      blocks,
      layouts: [layout],
    };
    // Blocks nested deep and wide, or a chain past the stack, which may insert its own top.
    const [depth, width] = pick([
      [20 + Math.floor(random() * 20), pick([2, 3])],
      [7000, 1],
      [3, 300],
    ]);
    const leaf = pick<Entity>([
      line,
      text(pick(["A", long, " ".repeat(100_000)])),
      { ...(text("A") as Text), layer: long },
      { ...(text("A") as Text), style: "HEADING" },
      { kind: "insert", layer: "0", block: `T${depth - 1}`, at: [0, 0] },
      // A leader with a long note, a note of many lines, many shafts, or a long text style.
      leader({ text: [long] }),
      leader({ text: Array.from({ length: 20_000 }, (_, i) => (i % 2 === 0 ? "" : "N")) }),
      leader({
        shafts: Array.from({ length: 2000 }, () =>
          Array.from({ length: 10 }, (_, i) => [i + 1, -i]),
        ),
      }),
      leader({ textStyle: long }),
    ]);
    const tree = nested(leaf, depth, width, "T");
    // Many lines that no check reads beside one label.
    if (random() < 0.3) {
      const bottom = tree.blocks[0] as { entities: readonly Entity[] };
      bottom.entities = [...bottom.entities, ...Array.from({ length: 200 }, () => line), text("L")];
    }
    // A text style and an attribute definition with many fields nobody knows, read for each
    // placement.
    const fields = (): Data =>
      Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`x${i}`, i]));
    if (leaf.kind === "text" && leaf.style !== undefined) {
      const styles = drawing.textStyles as Data[];
      // And the fields of a text, which a style does not have, or a long font name.
      const texts = random() < 0.5 ? { value: "W".repeat(1_000_000), height: 1e6 } : {};
      const font = random() < 0.3 ? { font: "F".repeat(1_000_000) } : {};
      styles[0] = { ...styles[0], ...fields(), ...texts, ...font };
    }
    // Moves that cancel from one level to the next.
    if (random() < 0.25) {
      tree.blocks.forEach((block, i) => {
        const shift = i % 2 === 0 ? 1e16 : -1e16;
        (block as { entities: readonly Entity[] }).entities = block.entities.map((e, j) =>
          e.kind === "insert" ? { ...e, at: [shift + j, 0] } : e,
        );
      });
    }
    // A long line cut into fine dashes, in the leaf and in model space.
    if (random() < 0.3) {
      (drawing.linetypes as Data[]).push({ name: "FINE", description: "", pattern: [1, -1] });
      const zigzag = {
        kind: "polyline",
        layer: "0",
        linetype: "FINE",
        closed: false,
        points: Array.from({ length: 100 }, (_, i) => [i * 100, i % 2 === 0 ? 0 : 19_000]),
      };
      (tree.blocks[0]!.entities as unknown as Data[]).push(zigzag);
      (drawing.entities as Data[]).push(zigzag);
    }
    // A dashed polyline of many sides with no length, and one that draws.
    if (random() < 0.3) {
      (drawing.linetypes as Data[]).push({ name: "DOTS", description: "", pattern: [0.25, -0.1] });
      const still = {
        kind: "polyline",
        layer: "0",
        linetype: "DOTS",
        closed: random() < 0.5,
        points: [...Array.from({ length: 20_000 }, () => [0, 0]), [0.5, 0]],
      };
      (tree.blocks[0]!.entities as unknown as Data[]).push(still);
      (drawing.entities as Data[]).push(still);
      // And a leader on a dotted layer whose shaft holds as many points that do not move.
      (drawing.layers as Data[]).push({ name: "DOTTED", color: 7, linetype: "DOTS" });
      const pointed = leader({
        layer: "DOTTED",
        shafts: [[[5, 5], ...Array.from({ length: 20_000 }, () => [0, 0])]],
      });
      (tree.blocks[0]!.entities as unknown as Entity[]).push(pointed);
      (drawing.entities as Entity[]).push(pointed);
    }
    // A large block placed once.
    if (random() < 0.2) {
      blocks.push({
        name: "HUGE",
        base: [0, 0],
        entities: Array.from({ length: 30_000 }, (_, i) => ({
          kind: "line",
          layer: "0",
          from: [i, 0],
          to: [i, 1],
        })),
      });
      (drawing.entities as Data[]).push({ kind: "insert", layer: "0", block: "HUGE", at: [0, 0] });
    }
    // A pattern of many lengths, each scaled for the lines that draw with it.
    if (random() < 0.3) {
      const pattern = Array.from({ length: 20_000 }, (_, i) => (i % 2 === 0 ? 1 + (i % 7) : -1));
      (drawing.linetypes as Data[]).push({ name: "LONG", description: "", pattern });
      const short = { ...line, linetype: "LONG" };
      (tree.blocks[0]!.entities as unknown as Data[]).push(short);
      (drawing.entities as Data[]).push(...Array.from({ length: 6000 }, () => short));
    }
    // A ring of many blocks, each inserting the next.
    if (random() < 0.2) {
      const ring = 10_000;
      blocks.push(
        ...Array.from({ length: ring }, (_, i) => ({
          name: `R${i}`,
          base: [0, 0],
          entities: [{ kind: "insert", layer: "0", block: `R${(i + 1) % ring}`, at: [0, 0] }],
        })),
      );
      (drawing.entities as Data[]).push({ kind: "insert", layer: "0", block: "R0", at: [0, 0] });
    }
    // Inserts from outside of the blocks of a cycle.
    if (leaf.kind === "insert") {
      (drawing.entities as Data[]).push({ ...tree.top, block: `T${Math.floor(depth / 2)}` });
    }
    if (random() < 0.4) {
      (tree.blocks[0] as { attributes?: unknown }).attributes = Array.from(
        { length: pick([1, 100, 300]) },
        (_, i) => ({
          tag: i === 0 && random() < 0.5 ? "T".repeat(2_000_000) : `A${i}`,
          value: pick(["V", long]),
          layer: "0",
          at: [0, 0] as Point,
          height: 1,
          rotation: 0,
          ...(i === 0 && random() < 0.2 ? fields() : {}),
        }),
      );
    }
    blocks.push(...(tree.blocks as unknown as Data[]));
    // Values each insert holds, long or not.
    const values = random() < 0.3 ? { A0: pick(["V", long]), A1: long } : undefined;
    const inserts = Array.from({ length: pick([1, 300]) }, (_, i) => ({
      ...tree.top,
      at: [i, 0],
      ...(random() < 0.5 ? { id: `I${i}` } : {}),
      ...(values ? { attributes: values } : {}),
      rotation: random() * 360,
    }));
    (random() < 0.5 ? (drawing.entities as Data[]) : (layout.entities as Data[])).push(...inserts);
    // One list of points, one list of entities and one long value that many places share.
    if (random() < 0.3) {
      const points = Array.from({ length: 20_000 }, (_, i): Point => [i % 7, i % 5]);
      const outline = { kind: "polyline", layer: "0", points, closed: true };
      const list = [outline, { ...outline }, { ...(text(long) as Text), at: [3, 3] }];
      const count = pick([100, 400]);
      blocks.push(
        ...Array.from({ length: count }, (_, i) => ({
          name: `S${i}`,
          base: [0, 0],
          entities: random() < 0.5 ? list : [{ ...outline }, text(long)],
        })),
      );
      (pick([drawing, layout]).entities as Data[]).push(
        ...Array.from({ length: count }, (_, i) => ({
          kind: "insert",
          layer: "0",
          block: `S${i}`,
          at: [i * 10, 0],
        })),
        ...Array.from({ length: 100 }, () => pick<Data>([outline, list[2]!])),
      );
    }
    // A dimension style whose prefix every dimension reads.
    if (random() < 0.3) (drawing.dimensionStyles as Data[])[0]!.prefix = long;
    if (random() < 0.2) (drawing.dimensionStyles as Data[])[0]!.arrowhead = "A".repeat(1_000_000);
    // A leader style whose arrowhead or text style every leader reads.
    if (random() < 0.2) {
      const style = (drawing.leaderStyles as Data[])[0]!;
      if (random() < 0.5) style.arrowhead = "A".repeat(1_000_000);
      else style.textStyle = long;
    }
    // A list that is all empty slots, has a hole, or holds one item many times.
    if (random() < 0.5) {
      const noted = (drawing.entities as Data[]).find((e) => e.kind === "leader")!;
      const lists: [Data, string][] = [
        ...[
          "layers",
          "linetypes",
          "textStyles",
          "dimensionStyles",
          "leaderStyles",
          "blocks",
          "entities",
        ].map((field) => [drawing, field] as [Data, string]),
        [noted, "text"],
        [noted, "shafts"],
        [layout, "entities"],
        [layout, "viewports"],
        [blocks[0]!, "entities"],
        [blocks[0]!, "attributes"],
      ];
      const [owner, field] = pick(lists);
      const list = owner[field] as unknown[] | undefined;
      const item = list?.[0];
      const holed = [item, item, item];
      delete holed[1];
      owner[field] = pick([
        // oxlint-disable-next-line unicorn/no-new-array
        () => new Array(2 ** 32 - 1),
        () => holed,
        () => Array.from({ length: 500 }, () => item),
      ])();
    }

    const d = drawing as unknown as Drawing;
    const fns: [string, () => unknown][] = [
      ["lint", () => lintWithin(d, {}, 20_000)],
      ["inspectText", () => inspectWithin(d, {}, 200_000)],
      [
        "extents",
        () =>
          boxer(
            d.textStyles,
            d.blocks,
            undefined,
            undefined,
            undefined,
            d.dimensionStyles,
            d.leaderStyles,
            20_000,
          )(d.entities),
      ],
      ["toSVG", () => svgWithin(d, {}, 20_000)],
      ["toSVG of the layout", () => svgWithin(d, { layout: "C-101" }, 20_000)],
      [
        "the PDF of the layout",
        () => {
          let picture: string;
          try {
            picture = svgWithin(d, { layout: "C-101" }, 20_000);
          } catch {
            return undefined;
          }
          return svgToPDF([picture], { fonts: embedded });
        },
      ],
    ];
    for (const [name, fn] of fns) {
      let result: unknown;
      try {
        result = settled(1000, fn);
      } catch (thrown) {
        assert.fail(`case ${n}, ${name}: ${String((thrown as Error)?.message ?? thrown)}`);
      }
      // What stops at a limit says so with a RangeError, and nothing else is thrown.
      assert.ok(
        !(result instanceof Error) || result instanceof RangeError,
        `case ${n}, ${name}: ${String(result)}`,
      );
      // The PDF reads every picture toSVG draws: it refuses only a point too far off its page.
      if (name === "the PDF of the layout" && !(result instanceof Uint8Array)) {
        assert.ok(
          result === undefined ||
            (result instanceof RangeError && /numbers under 10\^15/.test(result.message)),
          `case ${n}: the PDF of the layout gave ${String(result)}`,
        );
      }
      if (name === "lint") {
        assert.ok(Array.isArray(result), `case ${n}: lint threw ${String(result)}`);
        assert.ok(
          result.every(
            (x: { rule: unknown; message: unknown }) =>
              typeof x.rule === "string" && typeof x.message === "string",
          ),
        );
      }
    }
  }
});

test("a chain of references ends however the drawings given share, circle or nest", () => {
  const random = seeded(23);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  /** A drawing that attaches, or now and then overlays, each name, placed once each. */
  const link = (names: readonly string[], own: readonly Entity[]): Drawing => ({
    format: 0,
    units: "ft",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    entities: [
      ...own,
      ...names.map((name, i): Entity => ({ kind: "insert", layer: "0", block: name, at: [i, 0] })),
    ],
    xrefs: names.map((name) => ({ name, path: `${name}.dwg`, attach: random() < 0.9 })),
  });
  for (let n = 0; n < 12; n++) {
    const names = Array.from({ length: pick([1, 2, 8, 64]) }, (_, i) => `X${i}`);
    const depth = pick([3, 17, 40, 2000]);
    const own = random() < 0.3 ? Array.from({ length: 20_000 }, () => line) : [line, text("A")];
    // Each level gives one value for every name, shared, which a walk of every path would follow
    // names ** depth times.
    let below: unknown = link([], own);
    const levels: Record<string, unknown>[] = [];
    for (let i = 0; i < depth; i++) {
      const given: Record<string, unknown> = Object.fromEntries(names.map((name) => [name, below]));
      levels.push(given);
      below = { drawing: link(names, own), xrefs: given };
    }
    // The values circle back to the top.
    if (random() < 0.5) levels[0]![names[0]!] = below;
    // A value that is no drawing, or whose xrefs are none.
    if (random() < 0.4) {
      levels[depth - 1]![names[0]!] = pick<unknown>([
        5,
        null,
        [],
        { drawing: 5 },
        { drawing: link([], own), xrefs: "X" },
      ]);
    }
    const host = link(names, []);
    const options = { xrefs: Object.fromEntries(names.map((name) => [name, below])) as never };
    const fns: [string, () => unknown][] = [
      ["lint", () => lintWithin(host, options, 20_000)],
      ["inspectText", () => inspectWithin(host, options, 200_000)],
      [
        "extents",
        () =>
          boxer(
            [],
            [],
            undefined,
            undefined,
            referencedByKey(host, options.xrefs),
            [],
            [],
            20_000,
          )(host.entities),
      ],
      ["toSVG", () => svgWithin(host, options, 20_000)],
    ];
    for (const [name, fn] of fns) {
      const result = settled(2000, fn);
      assert.ok(
        !(result instanceof Error) || result instanceof RangeError,
        `case ${n}, ${name}: ${String(result)}`,
      );
      if (name === "lint")
        assert.ok(Array.isArray(result), `case ${n}: lint threw ${String(result)}`);
    }
  }
  // Long names that differ only at their ends, given and declared, which no map of lint's
  // reading of what is given is keyed by.
  const tail = (i: number) => `${"L".repeat(20_000)}${i}`;
  const longs = Array.from({ length: 2000 }, (_, i) => tail(i));
  const holder = link(longs, [line]);
  const given = Object.fromEntries(longs.map((name) => [name, holder]));
  const deepXrefs = { X: { drawing: holder, xrefs: given } } as never;
  assert.ok(Array.isArray(within(1000, () => lint(link(["X"], []), { xrefs: deepXrefs }))));
  // One model at many places, each giving its attachment, whose block places it 1,000 times: the
  // block's inserts read again at each place are paid for.
  const many = Array.from({ length: 1000 }, (_, i): Entity => ({
    kind: "insert",
    layer: "0",
    block: "IN",
    at: [i, 0],
  }));
  const placing: Drawing = {
    ...link(["IN"], []),
    entities: [{ kind: "insert", layer: "0", block: "HOLD", at: [0, 0] }],
    blocks: [{ name: "HOLD", entities: many }],
  };
  const places = Array.from({ length: 48 }, (_, i) => `P${i}`);
  const placed = Object.fromEntries(
    places.map((name) => [name, { drawing: placing, xrefs: { IN: link([], [line]) } }]),
  ) as never;
  const paid = settled(1000, () => svgWithin(link(places, []), { xrefs: placed }, 5000));
  assert.ok(paid instanceof RangeError && /extents/.test(paid.message), String(paid));
  // Copies of one drawing with many xrefs, one list shared, under many names: the list is
  // read once, and not at all where nothing is given inside the drawing.
  const declared = link(
    Array.from({ length: 4096 }, (_, i) => `D${i}`),
    [line],
  );
  const hosts = Array.from({ length: 256 }, (_, i) => `H${i}`);
  const host = link(hosts, []);
  for (const inner of [{}, { D0: link([], [line]) }]) {
    const xrefs = Object.fromEntries(
      hosts.map((name) => [name, { drawing: { ...declared }, xrefs: inner }]),
    ) as never;
    assert.ok(Array.isArray(within(1000, () => lint(host, { xrefs }))));
    const drawn = settled(1000, () => svgWithin(host, { xrefs }, 20_000));
    assert.ok(typeof drawn === "string" || drawn instanceof RangeError, String(drawn));
  }
});
