import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attributeDefinitionHandle,
  attributeHandle,
  attributesEndHandle,
  blockHandle,
  createDrawing,
  DrawingError,
  fromJSON,
  idHandle,
  inspectText,
  lint,
  attributeParagraph,
  placeAttribute,
  toDXF,
  toJSON,
  toSVG,
  type AttributeOptions,
  type Block,
  type Drawing,
  type Entity,
  type Insert,
  type Layer,
} from "../src/index.ts";
import { boxer, extents } from "../src/extents.ts";
import { inspectWithin } from "../src/inspect.ts";
import { dataOf, ofKind, wrong, type Data } from "./values.ts";

/** A tree with a tag, inserted three ways, and a block that holds an insert of it. */
function sample(): Drawing {
  const d = createDrawing({ units: "ft" });
  d.layer("SYMB", { color: 1 }).layer("PLNT", { color: 3 });
  d.block("TREE", {}, () => {
    d.layer("SYMB", {}, () => d.circle([0, 0], 3, { id: "canopy" }));
    d.line([-4, 0], [4, 0]);
    d.attribute("TAG", [0, 4], { value: "T-0", prompt: "Tree tag", height: 1 });
    d.attribute("SPECIES", [0, 0], {
      value: "OAK",
      height: 0.5,
      rotation: 15,
      style: { name: "NOTES", font: "Arial", widthFactor: 0.8, obliqueAngle: 10 },
      align: "center",
      valign: "middle",
    });
  });
  d.block("GROVE", { base: [1, 2] }, () => d.insert("TREE", [5, 0]).line([0, 0], [10, 0]));
  d.layer("PLNT", {}, () => {
    d.insert("TREE", [10, 10], { attributes: { TAG: "T-1" }, id: "tree-1" });
    d.insert("tree", [30, 10], { scale: [2, 0.5], rotation: 30 });
    d.insert("GROVE", [10, 40], { scale: 1.5, rotation: 90 });
  });

  return d.build();
}

const rule =
  (name: string) =>
  (thrown: unknown): thrown is DrawingError =>
    thrown instanceof DrawingError && thrown.diagnostics[0]?.rule === name;

const line: Entity = { kind: "line", layer: "0", from: [0, 0], to: [1, 0] };

const insert = (block: string, more: Partial<Insert> = {}): Insert => ({
  kind: "insert",
  layer: "0",
  block,
  at: [0, 0],
  ...more,
});

const withBlocks = (blocks: readonly Block[], entities: readonly Entity[] = []): Drawing => ({
  format: 0,
  units: "in",
  dxf: "R2018",
  layers: [{ name: "0", color: 7 }],
  entities,
  blocks,
});

const rules = (drawing: Drawing): string[] => lint(drawing).map((d) => d.rule);

// Each `@ts-expect-error` proves the compiler rejects the literal, and the `assert.throws`
// around it that the same mistake is caught when the code runs.
test("block names, attribute tags and insert scales are checked as literals and when the code runs", () => {
  const d = createDrawing();
  const draw = () => d.line([0, 0], [1, 0]);
  // @ts-expect-error: the leading CAD app keeps names with a star for its own blocks.
  assert.throws(() => d.block("*U1", {}, draw), /Block names cannot contain/);
  // @ts-expect-error: a block name cannot be empty.
  assert.throws(() => d.block("", {}, draw), /cannot be empty/);
  // @ts-expect-error: a block name cannot end with a space.
  assert.throws(() => d.block("A ", {}, draw), /start or end with a space/);
  assert.throws(() => d.block("a".repeat(256), {}, draw), /longer than 255 characters/);
  d.block("A", {}, () => {
    // @ts-expect-error: the leading CAD app holds a tag in capitals.
    assert.throws(() => d.attribute("tag", [0, 0]), /lower-case letter/);
    // @ts-expect-error: a tag cannot be empty.
    assert.throws(() => d.attribute("", [0, 0]), /cannot be empty/);
    d.attribute("TWO WORDS", [0, 0]);
    assert.throws(() => d.attribute("TWO WORDS", [0, 1]), rule("duplicate-attribute"));
    // @ts-expect-error: a height of 0 is a text's default height to the leading CAD app.
    assert.throws(() => d.attribute("H", [0, 0], { height: 0 }), /greater than 0/);
    draw();
  });
  // @ts-expect-error: the leading CAD app reads a scale of 0 as 1.
  assert.throws(() => d.insert("A", [0, 0], { scale: 0 }), /reads a scale of 0 as 1/);
  // @ts-expect-error: either scale.
  assert.throws(() => d.insert("A", [0, 0], { scale: [1, 0] }), /reads a scale of 0 as 1/);
  // @ts-expect-error: a scale that is written as 0.
  assert.throws(() => d.insert("A", [0, 0], { scale: 0.0000004 }), /written as 0/);
  // @ts-expect-error: a block is named as a layer is.
  assert.throws(() => d.insert("A/B", [0, 0]), /Block names cannot contain/);
  d.insert("a", [0, 0], { scale: [-1, 2], rotation: 90, attributes: { "TWO WORDS": "set" } });

  const r12 = createDrawing({ dxf: "R12" });
  // @ts-expect-error: R12 drawings have no blocks.
  assert.throws(() => r12.block("A", {}, draw), /no blocks to R12 drawings/);
  // @ts-expect-error: nor inserts.
  assert.throws(() => r12.insert("A", [0, 0]), /no blocks to R12 drawings/);
  // @ts-expect-error: nor attributes.
  assert.throws(() => r12.attribute("A", [0, 0]), /no blocks to R12 drawings/);
  assert.deepEqual(rules(d.build()), []);
  assert.deepEqual(rules({ ...d.build(), dxf: "R12" }), ["block", "block"]);
});

test("the builder refuses what a drawing's blocks cannot be, at the call", () => {
  const d = createDrawing();
  d.block("TREE", {}, () => {
    d.attribute("TAG", [0, 0], { value: "T-0" });
    assert.throws(() => d.block("INNER", {}, () => {}), /cannot be defined inside another/);
    // A block cannot hold an insert of itself.
    assert.throws(() => d.insert("tree", [0, 0]), rule("block-cycle"));
  });
  assert.throws(() => d.attribute("TAG", [0, 0]), /belongs to a block/);
  // The leading CAD app takes these names for the block it has, and would put the entities of both in it.
  assert.throws(() => d.block("tree", {}, () => {}), rule("duplicate-block"));
  d.block("straße", {}, () => {});
  assert.throws(() => d.block("STRASSE", {}, () => {}), rule("duplicate-block"));
  assert.throws(() => d.insert("NOPE", [0, 0]), rule("undefined-block"));
  assert.throws(
    () => d.insert("TREE", [0, 0], { attributes: { SPECIES: "OAK" } }),
    rule("undefined-attribute"),
  );
  assert.throws(() => d.insert("TREE", [0, 0], { attributes: { TAG: "a\nb" } }), rule("text"));
  // A refused insert keeps none of the handles of its attributes, so it can be placed again.
  assert.throws(
    () => d.insert("TREE", [0, 0], wrong<{ id: "T1" }>({ id: "T1", linetype: "NOPE" })),
    /NOPE/,
  );
  d.insert("TREE", [0, 0], { id: "T1" });
  // An id names one entity of the drawing, in a block or out of one.
  d.block("B", {}, () => d.line([0, 0], [1, 0], { id: "edge" }));
  assert.throws(() => d.line([0, 0], [1, 0], { id: "Edge" }), rule("duplicate-id"));
  // An uneven scale slants and widens an attribute past what the leading CAD app's AUDIT takes.
  assert.throws(() => d.insert("TREE", [0, 0], { scale: [1000, 0.001] }), /times as wide/);
  // A slant past 85 degrees, with a width factor the leading CAD app takes.
  d.block("SLANTED", {}, () =>
    d.attribute("A", [0, 0], { style: { name: "S", font: "Arial", obliqueAngle: 60 } }),
  );
  assert.throws(() => d.insert("SLANTED", [0, 0], { scale: [1, 0.1] }), /slant by 86\.69/);
  d.insert("SLANTED", [0, 0], { scale: [1, 0.2] });
  // An attribute an insert would put past what the leading CAD app reads.
  d.block("FAR", {}, () => d.attribute("A", [1e99, 0]));
  assert.throws(() => d.insert("FAR", [0, 0], { scale: 1000000 }), /puts the attribute "A" at/);
  assert.equal(d.build().entities.length, 2);
  const far = { ...d.build(), entities: [insert("FAR", { scale: [1000000, 1000000] })] };
  assert.deepEqual(rules(far), ["geometry"]);
});

test("lint reports each block rule in a drawing built another way", () => {
  const tag = { tag: "A", value: "v", layer: "0", at: [0, 0], height: 1, rotation: 0 } as const;

  const one = (block: Partial<Block>, entities: readonly Entity[] = []) =>
    rules(withBlocks([{ name: "T", entities: [line], ...block }], entities));

  assert.deepEqual(one({ name: "A*B" }), ["block"]);
  assert.deepEqual(one({ base: [Number.NaN, 0] }), ["block"]);
  assert.deepEqual(one({ attributes: [{ ...tag, tag: "" }] }), ["attribute"]);
  assert.deepEqual(one({ attributes: [{ ...tag, tag: "lower" }] }), ["attribute"]);
  assert.deepEqual(one({ attributes: [tag, tag] }), ["duplicate-attribute"]);
  assert.deepEqual(one({ attributes: [{ ...tag, layer: "NOPE" }] }), ["undefined-layer"]);
  assert.deepEqual(one({ attributes: [{ ...tag, style: "NOPE" }] }), ["undefined-text-style"]);
  assert.deepEqual(one({ attributes: [{ ...tag, height: 0 }] }), ["geometry"]);
  assert.deepEqual(one({}, [insert("NOPE")]), ["undefined-block"]);
  assert.deepEqual(one({}, [insert("T", { scale: [0, 1] })]), ["geometry"]);
  assert.deepEqual(one({}, [insert("T", { attributes: { A: "set" } })]), ["undefined-attribute"]);
  const notAnObject = insert("T", { attributes: wrong("AB") });
  assert.deepEqual(one({}, [notAnObject]), ["undefined-attribute"]);
  const nothing = insert("T", { attributes: wrong(null) });
  assert.deepEqual(one({ attributes: [tag] }, [nothing]), ["undefined-attribute"]);
  assert.deepEqual(one({ attributes: [tag] }, [insert("T", { scale: [1, 0.001] })]), ["geometry"]);
  assert.deepEqual(
    rules(
      withBlocks([
        { name: "T", entities: [line] },
        { name: "t", entities: [line] },
        { name: "straße", entities: [line] },
        { name: "STRASSE", entities: [line] },
      ]),
    ),
    ["duplicate-block", "duplicate-block"],
  );

  // A block that holds itself, and two that hold each other.
  const cycles = lint(
    withBlocks([
      { name: "SELF", entities: [insert("self")] },
      { name: "A", entities: [insert("B")] },
      { name: "B", entities: [line, insert("A")] },
      { name: "USER", entities: [insert("A")] },
    ]),
  );

  assert.deepEqual(
    cycles.map((d) => [d.rule, d.block]),
    [
      ["block-cycle", "SELF"],
      ["block-cycle", "A"],
      ["block-cycle", "B"],
    ],
  );
  assert.match(cycles[1]!.message, /"A" holds an insert of itself, through "B"/);

  // An entity in a block is named by its block and its place in it.
  const [inside] = lint(
    withBlocks([{ name: "T", entities: [line, { ...line, layer: "NOPE", id: "x" }] }]),
  );

  assert.deepEqual(
    [inside?.rule, inside?.block, inside?.entity, inside?.id],
    ["undefined-layer", "T", 1, "x"],
  );
  assert.throws(() => toDXF(withBlocks([], [insert("NOPE")])), DrawingError);
});

test("R2018 DXF holds blocks, inserts and attributes with handles that resolve", () => {
  const drawing = sample();
  const dxf = toDXF(drawing);

  const p = dxf
    .trimEnd()
    .split("\r\n")
    .reduce<[number, string][]>(
      (out, value, i, all) => (i % 2 === 0 ? [...out, [Number(value), all[i + 1]!]] : out),
      [],
    );

  const handles = p.filter(([c]) => c === 5 || c === 105).map(([, v]) => v);
  assert.equal(new Set(handles).size, handles.length, "handles are unique");

  for (const [code, value] of p.slice(p.findIndex(([c, v]) => c === 0 && v === "ENDSEC"))) {
    if (code === 330 || code === 340 || code === 350 || code === 390) {
      assert.ok(value === "0" || handles.includes(value), `${code} ${value} resolves`);
    }
  }

  const of = (type: string) => p.filter(([c, v]) => c === 0 && v === type);
  assert.deepEqual(
    [of("BLOCK"), of("INSERT"), of("ATTDEF"), of("ATTRIB"), of("SEQEND")].map((r) => r.length),
    [4, 4, 2, 6, 3],
  );

  // A block's objects and an insert with an id take handles from their names.
  for (const handle of [
    blockHandle("TREE"),
    attributeDefinitionHandle("tree", "TAG"),
    idHandle("canopy"),
    idHandle("tree-1"),
    attributeHandle("Tree-1", "TAG"),
    attributesEndHandle("tree-1"),
  ]) {
    assert.ok(handles.includes(handle), handle);
  }

  // A handle's key has A to Z in lower case and nothing else changed.
  assert.equal(blockHandle("Tree"), blockHandle("TREE"));
  assert.notEqual(blockHandle("É"), blockHandle("é"));
  assert.notEqual(attributeDefinitionHandle("A", "É"), attributeDefinitionHandle("A", "é"));
  // Each refuses what the builder refuses, so no two arguments make one key.
  assert.throws(() => blockHandle("A/B"), RangeError);
  assert.throws(() => attributeDefinitionHandle("A/B", "C"), RangeError);
  assert.throws(() => attributeDefinitionHandle("A", "b/c"), RangeError);
  assert.throws(() => attributeHandle("door 1", "A"), RangeError);
  assert.throws(() => attributeHandle("door-1", ""), RangeError);
  assert.throws(() => attributesEndHandle("a/b"), RangeError);
  // The same drawing with more in front of everything keeps them all.
  const more = createDrawing({ units: "ft" });
  more.layer("NEW", { color: 2 }, () => more.line([0, 0], [1, 1]));
  more.block("FIRST", {}, () => more.line([0, 0], [1, 1]));

  const later = toDXF({
    ...drawing,
    layers: [...more.build().layers, ...drawing.layers.slice(1)],
    blocks: [...more.build().blocks!, ...drawing.blocks!],
    entities: [...more.build().entities, ...drawing.entities.toReversed()],
  });

  const named = (text: string) =>
    [...text.matchAll(/\r\n5\r\n(1[0-9A-F]{13})\r\n/g)].map((m) => m[1]).sort();

  assert.equal(named(dxf).length, 13);
  assert.deepEqual(
    named(later).filter((h) => named(dxf).includes(h!)),
    named(dxf),
  );
  // A mirrored insert holds its attributes in the plane seen from behind.
  const mirrored = toDXF({ ...drawing, entities: [insert("TREE", { scale: [-1, 1] })] });
  assert.equal(mirrored.split("\r\n230\r\n-1\r\n").length - 1, 2);
});

test("an insert gives an attribute the text the leading CAD app holds for it", () => {
  const [tree] = sample().blocks!;
  const [, species] = tree!.attributes!;
  const style = sample().textStyles![0];

  const near = (actual: number, expected: number) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

  // What the leading CAD app made of this definition in an insert scaled 2 by 0.5 and turned 30 degrees.
  const uneven = placeAttribute(
    species!,
    style,
    insert("TREE", { at: [30, 10], scale: [2, 0.5], rotation: 30 }),
    undefined,
  );

  near(uneven.height, 0.2582402930448833);
  near(uneven.rotation, 33.83236398596441);
  near(uneven.widthFactor, 2.999038105676658);
  near(uneven.obliqueAngle, 344.5446323905713 - 360);
  assert.deepEqual([uneven.at, uneven.mirrored, uneven.value], [[30, 10], false, "OAK"]);

  // A mirrored insert: X runs the other way, and the text keeps its own shape.
  const mirrored = placeAttribute(
    species!,
    style,
    insert("TREE", { at: [50, 10], scale: [-1, 1], attributes: { SPECIES: "ELM" } }),
    [0, 0],
  );

  near(mirrored.rotation, 15);
  near(mirrored.widthFactor, 0.8);
  near(mirrored.obliqueAngle, 10);
  assert.deepEqual([mirrored.at, mirrored.mirrored, mirrored.value], [[-50, 10], true, "ELM"]);
});

test("an insert gives an attribute of paragraph text the paragraph the leading CAD app holds for it", () => {
  const style = { name: "SLANT", font: "Arial", widthFactor: 0.8, obliqueAngle: 10 };

  const definition = {
    kind: "paragraph",
    tag: "NB",
    value: "ONE TWO THREE FOUR FIVE SIX",
    layer: "0",
    at: [1, 1],
    height: 0.2,
    rotation: 15,
    style: "SLANT",
    width: 2.5,
    align: "center",
    valign: "middle",
    lineSpacing: 1.5,
    lineSpacingStyle: "exactly",
  } as const;

  const near = (actual: number, expected: number) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

  // What the leading CAD app's -INSERT made of this definition: scaled 2 and turned 30, its
  // height and width twice the definition's, turned with it, and its value as it is.
  const even = placeAttribute(
    definition,
    style,
    insert("B", { at: [20, 20], scale: [2, 2], rotation: 30 }),
    undefined,
  );

  near(even.at[0], 20.73205080756888);
  near(even.at[1], 22.73205080756888);
  near(even.height, 0.4);
  near(even.rotation, 45);
  near(even.paragraph!.width!, 5);
  assert.equal(even.paragraph!.value, definition.value);

  // Scaled 2 by 0.5: its height as a text's, its width the same share of the definition's, and
  // its characters at the text's own width factor, to four decimals, without the style's.
  const uneven = placeAttribute(
    definition,
    style,
    insert("B", { at: [40, 20], scale: [2, 0.5] }),
    [0, 0],
  );

  near(uneven.height, 0.1032961172179533);
  near(uneven.rotation, 3.832363985964412);
  near(uneven.widthFactor, 3.748797632095823);
  near(uneven.obliqueAngle, 316.8476102659945 - 360);
  near(uneven.paragraph!.width!, 1.291201465224416);
  assert.equal(uneven.paragraph!.value, `\\W3.7488;${definition.value}`);

  // Mirrored: placed where X runs the other way, as a text of one line is.
  const mirrored = placeAttribute(
    definition,
    style,
    insert("B", { at: [60, 20], scale: [-1, 1] }),
    [0, 0],
  );

  assert.deepEqual([mirrored.at, mirrored.mirrored], [[-59, 21], true]);
  near(mirrored.rotation, 15);
  const paragraph = attributeParagraph(mirrored)!;
  const round = (v: number) => Math.round(v * 1e9) / 1e9;
  assert.deepEqual(
    {
      ...paragraph,
      at: paragraph.at.map(round),
      width: round(paragraph.width!),
      height: round(paragraph.height),
    },
    {
      kind: "paragraph",
      layer: "0",
      style: "SLANT",
      width: 2.5,
      align: "center",
      valign: "middle",
      lineSpacing: 1.5,
      lineSpacingStyle: "exactly",
      at: [-59, 21],
      height: 0.2,
      rotation: mirrored.rotation,
      value: definition.value,
    },
  );
  // The picture and the extents take each where its insert holds it: the uneven one wraps at
  // its narrower width into more lines, and the mirrored one reads backward.
  const d = createDrawing({ units: "in" });
  d.textStyle(style);
  d.block("B", {}, () =>
    d.attribute("NB", [1, 1], wrong<AttributeOptions>({ ...dataOf(definition), tag: undefined })),
  );
  d.insert("B", [0, 0])
    .insert("B", [10, 0], { scale: [2, 0.5] })
    .insert("B", [20, 0], { scale: [-1, 1] });
  const drawing = d.build();
  assert.deepEqual(lint(drawing), []);
  const svg = toSVG(drawing);
  assert.match(svg, /scale\(3\.7488 1\)/);
  assert.match(svg, /matrix\(-1 0 0 1 0 0\)/);

  const [plain, narrow, backward] = drawing.entities.map((e) =>
    extents([e], drawing.textStyles, drawing.blocks)!,
  );

  // Each is centered on its point, the definition's (1, 1) where the insert puts it.
  for (const [box, x] of [
    [plain!, 1],
    [narrow!, 12],
    [backward!, 19],
  ] as const) {
    assert.ok(Math.abs((box[0] + box[2]) / 2 - x) < 0.1, `${box} about ${x}`);
  }

  assert.ok(narrow![3] - narrow![1] > plain![3] - plain![1]);
});

test("a drawing with blocks goes to JSON and back, and the parser knows each new field", () => {
  const drawing = sample();
  const json = toJSON(drawing);
  assert.deepEqual(fromJSON(json), drawing);
  assert.equal(toDXF(fromJSON(json)), toDXF(drawing));

  const refused = (change: (value: Drawing & { blocks: Block[] }) => void): string => {
    const value = JSON.parse(json);
    change(value);

    try {
      fromJSON(value);
    } catch (thrown) {
      assert.ok(thrown instanceof DrawingError);

      return thrown.message;
    }

    return "taken";
  };

  assert.match(
    refused((v) => Object.assign(v.blocks[0]!, { color: 1 })),
    /blocks\[0\]: unknown field "color"/,
  );
  assert.match(
    refused((v) => Object.assign(v.blocks[0]!.attributes![0]!, { tag: 1 })),
    /blocks\[0\]\.attributes\[0\]\.tag must be a string/,
  );
  assert.match(
    refused((v) => Object.assign(v.entities[0]!, { attributes: { TAG: 1 } })),
    /entities\[0\]\.attributes\["TAG"\] must be a string/,
  );
  assert.match(
    refused((v) => Object.assign(v.entities[0]!, { linetype: "ByBlock" })),
    /unknown field "linetype"/,
  );
  assert.match(
    refused((v) => Object.assign(v.entities[0]!, { block: "NOPE" })),
    /Block "NOPE" is not defined/,
  );
});

test("SVG draws an insert's block where the insert puts it, on the layers the leading CAD app draws it on", () => {
  const drawing = sample();
  const svg = toSVG(drawing);
  const [first, second] = svg.split("</g>");
  // The first insert: a group with the block's entities and its attributes as text.
  assert.match(first!, /<g data-layer="PLNT" data-entity="0" data-id="tree-1" data-block="TREE">/);
  // An entity on a layer of its own draws as that layer does, and one on layer 0 as the insert's.
  assert.match(first!, /<circle cx="10" cy="10" r="3" stroke="#ff0000"[^>]* data-layer="SYMB"\/>/);
  assert.match(
    first!,
    /<line x1="6" y1="10" x2="14" y2="10" stroke="#00ff00"[^>]* data-layer="PLNT"\/>/,
  );
  assert.match(first!, /fill="#00ff00"[^>]*>T-1<\/text>/);
  // A centered attribute starts half its length before its point.
  assert.match(first!, /rotate\(-15\) translate\(-0.590041 0.25\) skewX\(-10\)[^>]*>OAK<\/text>/);
  // An uneven scale makes an ellipse of the circle, turned with the insert.
  assert.match(second!, /<ellipse cx="30" cy="10" rx="6" ry="1.5" transform="rotate\(30 30 10\)"/);
  assert.match(second!, /<text transform="matrix\(1.73205080757 1 -0.25 0.433012701892 30 10\) /);
  // The extents take in what each insert draws.
  const [minX, minY, maxX, maxY] = extents(drawing.entities, drawing.textStyles, drawing.blocks);
  assert.ok(minX < 7.01 && minY < 6.5 && maxX > 36.9 && maxY > 53.4, `${[minX, minY, maxX, maxY]}`);

  // An insert on a layer that is off hides what it holds on layer 0, and on a frozen layer
  // all of it.
  const states = (layer: Partial<Layer>): string =>
    toSVG({
      ...drawing,
      layers: drawing.layers.map((l) => (l.name === "PLNT" ? { ...l, ...layer } : l)),
    });

  assert.ok(!states({ off: true }).includes("<line") && states({ off: true }).includes("<circle"));
  assert.ok(!states({ frozen: true }).includes("<circle"));
  // An insert on a layer that does not plot draws nothing, whatever layers its block uses.
  assert.ok(!states({ plot: false }).includes("<circle"));

  const all = toSVG(
    { ...drawing, layers: drawing.layers.map((l) => ({ ...l, plot: l.name !== "PLNT" })) },
    { drawNoPlot: true },
  );

  assert.ok(all.includes("<circle"));
  // A block that holds itself draws nothing, and does not hang.
  const cyclic = toSVG(withBlocks([{ name: "A", entities: [insert("A")] }], [insert("A")]));
  assert.match(cyclic, /<g data-layer="0" data-entity="0" data-block="A"><\/g>/);
});

test("an attribute of one line has no paragraph, and a \\N in one of paragraph text is warned of", () => {
  const d = createDrawing({ units: "in" });
  d.block("B", {}, () => {
    d.attribute("ONE", [0, 0], { value: "A" });
    d.attribute("NOTE", [0, 1], { kind: "paragraph", value: "A\\NB", width: 2 });
  });
  d.insert("B", [0, 0], { attributes: { NOTE: "C\\ND" } });
  const drawing = d.build();
  const one = drawing.blocks![0]!.attributes![0]!;
  const insert = ofKind(drawing.entities[0], "insert");
  assert.equal(attributeParagraph(placeAttribute(one, undefined, insert, undefined)), undefined);
  const breaks = lint(drawing).filter((w) => w.message.includes("\\N starts the next column"));
  assert.deepEqual(
    breaks.map((w) => w.severity),
    ["warning", "warning"],
  );
});

test("an attribute of paragraph text of the wrong shape is drawn as none, and uneven inserts pay", () => {
  const d = createDrawing({ units: "in" });
  d.block("B", {}, () => d.attribute("A", [0, 0], { kind: "paragraph", width: 2 }));
  d.insert("B", [0, 0], { scale: [2, 1] });
  const built = d.build();
  const block = built.blocks![0]!;
  const definition = block.attributes![0]!;

  const placed = ofKind(built.entities[0], "insert");

  const withDefinition = (changed: Data, insert: Data = {}): Drawing => ({
    ...built,
    blocks: [{ ...block, attributes: [wrong({ ...dataOf(definition), ...changed })] }],
    entities: [wrong({ ...dataOf(placed), ...insert })],
  });

  // A value that is no string, of the definition or of an insert, is an error and no throw.
  const odd = { toString: null };

  for (const drawing of [
    withDefinition({ value: odd }),
    withDefinition({}, { attributes: { A: odd } }),
  ]) {
    assert.ok(lint(drawing).some((w) => w.severity === "error"));
  }

  // A width that is no number is laid out as none by the preview and the checks.
  const wide = withDefinition({ width: "12" });
  assert.ok(lint(wide).some((w) => w.severity === "error"));
  toSVG(wide);
  inspectText(wide);
  // An insert of a scale of 0, which `lint` refuses, places no paragraph.
  assert.doesNotMatch(toSVG(withDefinition({}, { scale: [0, 2] })), /NaN|Infinity/);

  // Nor does an entity of a block that is no object, or an insert that names its block with none.
  const odder: Drawing = {
    ...built,
    blocks: [{ ...block, entities: [wrong(null), wrong({ ...dataOf(placed), block: null })] }],
  };

  assert.ok(lint(odder).some((w) => w.severity === "error"));
  toSVG(odder);
  // An insert that scales its block unevenly makes a value the drawing does not hold, which pays
  // its length the first time it is laid out, as a long value laid out again does; inserts of
  // one scale share it, and a box kept is mapped alone.
  // Codes alone but a character, so that what it costs is its layout and no check of its lines.
  const shared = { A: "\\L\\l".repeat(5000) + "X" };

  const inserts = (scale: (i: number) => [number, number]) =>
    Array.from({ length: 20 }, (_, i): Insert => ({
      ...placed,

      at: [i * 100, 0],
      scale: scale(i),
      attributes: shared,
    }));

  const scales = inserts((i) => [2 + i / 10, 1]);
  const one = inserts(() => [2, 1]);

  const capped = (entities: Insert[]) => {
    const box = boxer([], [block], undefined, undefined, undefined, [], [], 100_000);
    box(entities);

    return box.capped !== undefined;
  };

  assert.deepEqual([capped(scales), capped(one)], [true, false]);

  const checked = (entities: Insert[]) =>
    inspectWithin({ ...built, entities }, {}, 400_000).some((w) => w.rule === "text-check-capped");

  assert.deepEqual([checked(scales), checked(one)], [true, false]);
});

test("a text in a block scaled far down stays where its block's lines put it", () => {
  const d = createDrawing({ units: "ft" });
  d.block("FAR", {}, () => {
    d.line([100_000, 0], [100_001, 0]);
    d.text([100_000, 0], "A", { height: 2.5 });
  });

  d.insert("FAR", [0, 0], { scale: [1 / 304.8, 1 / 304.8] });
  const svg = toSVG(d.build());
  const x1 = Number(/<line x1="([^"]+)"/.exec(svg)![1]);

  const [a, , , , e] = /matrix\(([^)]+)\) translate\(100000 0\)/
    .exec(svg)![1]!
    .split(" ")
    .map(Number);

  assert.ok(Math.abs(a! * 100_000 + e! - x1) < 1e-5, `${a! * 100_000 + e!} and ${x1}`);
});

test("an entity with a NaN leaves the others' extents as they are", () => {
  const line: Entity = { kind: "line", layer: "0", from: [0, 0], to: [10, 5] };
  const bad: Entity = { kind: "line", layer: "0", from: [Number.NaN, 0], to: [1, 1] };
  assert.deepEqual(extents([line, bad]), extents([line]));
});
