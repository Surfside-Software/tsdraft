import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blockHandle,
  createDrawing,
  DrawingError,
  findXref,
  fromJSON,
  idHandle,
  lint,
  toDXF,
  toJSON,
  toSVG,
  type Drawing,
  type Entity,
  type Xref,
} from "../src/index.ts";

/** A sheet that references a base drawing twice, once scaled and turned under an id. */
function host(): Drawing {
  const d = createDrawing({ units: "ft" });
  d.layer("X-BASE", { color: 1 });
  d.xref("BASE", "..\\base\\base.dwg");
  d.layer("X-BASE", {}, () => {
    d.insert("base", [0, 0]);
    d.insert("BASE", [50, 5], { scale: [2, 3], rotation: 30, id: "second" });
  });
  return d.build();
}

/** The drawing the sheet references: a line on layer 0, a wall, a hidden note and a symbol. */
function base(): Drawing {
  const d = createDrawing({ units: "ft", linetypeScale: 10 });
  d.layer("WALL", { color: 5, lineweight: 0.5 }).layer("NOTE", { color: 3, off: true });
  d.block("POST", {}, () => d.circle([0, 0], 1));
  d.line([0, 0], [10, 0]);
  d.layer("WALL", {}, () => d.line([0, 0], [0, 10]).insert("POST", [10, 10]));
  d.layer("NOTE", {}, () => d.text([1, 1], "hidden", { height: 1 }));
  return d.build();
}

const rule = (name: string) => (thrown: unknown) =>
  thrown instanceof DrawingError && thrown.diagnostics[0]?.rule === name;

const withXrefs = (xrefs: readonly unknown[], entities: readonly Entity[] = []): Drawing => ({
  format: 0,
  units: "in",
  dxf: "R2018",
  layers: [{ name: "0", color: 7 }],
  entities,
  xrefs: xrefs as readonly Xref[],
});
const placed: Entity = { kind: "insert", layer: "0", block: "BASE", at: [0, 0] };
const messages = (drawing: Drawing): string[] =>
  lint(drawing).map((d) => `${d.severity} ${d.rule}: ${d.message}`);

// Each `@ts-expect-error` proves the compiler rejects the literal, and the `assert.throws`
// around it that the same mistake is caught when the code runs.
test("an xref's name and path are checked as literals and when the code runs", () => {
  const d = createDrawing();
  // @ts-expect-error a name follows the block name rules, so no bar
  assert.throws(() => d.xref("BASE|WALL", "base.dwg"), rule("xref"));
  // @ts-expect-error an empty path
  assert.throws(() => d.xref("A", ""), /cannot be empty/);
  // @ts-expect-error a path from a drive
  assert.throws(() => d.xref("A", "C:\\jobs\\base.dwg"), /must start from the folder/);
  // @ts-expect-error a path from the root
  assert.throws(() => d.xref("A", "/jobs/base.dwg"), /must start from the folder/);
  // @ts-expect-error a path from a server
  assert.throws(() => d.xref("A", "\\\\server\\jobs\\base.dwg"), /must start from the folder/);
  // @ts-expect-error a DXF
  assert.throws(() => d.xref("A", "base.DXF"), /cannot end in \.dxf/);
  // @ts-expect-error a star
  assert.throws(() => d.xref("A", "ba*e.dwg"), /finds no file whose name holds one of them/);
  // @ts-expect-error a dot at the end
  assert.throws(() => d.xref("A", "sub/base."), /looks for base\.\.dwg/);
  // @ts-expect-error a quote, which tsdraft refuses in a pair around the path too
  assert.throws(() => d.xref("A", '"base.dwg"'), /written without them/);
  for (const character of '?<>|:"') {
    assert.throws(() => d.xref("A", `ba${character}se.dwg`), /finds no file whose name holds/);
  }
  // @ts-expect-error a multibyte escape
  assert.throws(() => d.xref("A", "sub\\m+1005Cx\\base.dwg"), /Write \/ there/);
  // @ts-expect-error a control character
  assert.throws(() => d.xref("A", "ba\tse.dwg"), rule("xref"));
  assert.throws(() => d.xref("A", `${"a/".repeat(16000)}b.dwg`), /32,000 characters/);
  assert.throws(() => d.xref("A", 5 as unknown as string), /must be a string/);
  // What AutoCAD loads: folders either way, spaces, other letters, no extension, a `\U+`, a
  // dot after `.dwg`.
  d.xref("OK 1", "./a b/é 図.dwg").xref("OK 2", "..\\..\\base");
  d.xref("OK 4", "sub\\U+0041\\M+base.dwg").xref("OK 5", "sub./base.DWG.");
  const r12 = createDrawing({ dxf: "R12" });
  // @ts-expect-error R12 has no xrefs
  assert.throws(() => r12.xref("A", "base.dwg"), /no xrefs to R12/);
});

test("the builder refuses what an xref cannot be or have, at the call", () => {
  const d = createDrawing();
  d.block("TREE", {}, () => d.circle([0, 0], 1));
  d.xref("BASE", "base.dwg");
  assert.throws(() => d.xref("tree", "tree.dwg"), /already has a block of this name, as "TREE"/);
  assert.throws(() => d.xref("base", "other.dwg"), /already has an xref of this name, as "BASE"/);
  assert.throws(() => d.block("Base", {}, () => {}), rule("duplicate-block"));
  // A block whose draw throws leaves nothing behind: its name, its handles and its ids.
  const failing = () => {
    d.line([0, 0], [1, 0], { id: "kept" }).attribute("TAG", [0, 0]);
    d.xref("STAYS", "stays.dwg");
    throw new Error("stop");
  };
  assert.throws(() => d.block("AGAIN", {}, failing), /stop/);
  d.block("AGAIN", {}, () => d.line([0, 0], [1, 0], { id: "kept" }).attribute("TAG", [0, 0]));
  // An xref that draw defined before it threw belongs to the drawing, and stays.
  assert.throws(() => d.xref("stays", "s.dwg"), /already has an xref of this name, as "STAYS"/);
  // A block's name is taken while it is drawn.
  assert.throws(
    () => d.block("straße", {}, () => d.xref("strasse", "s.dwg")),
    /block of this name/,
  );
  assert.throws(
    () => d.insert("BASE", [0, 0], { attributes: { TAG: "1" } }),
    /cannot set attributes/,
  );
  assert.throws(
    () => d.insert("BASE", [0, 0], { attributes: null as unknown as Record<string, string> }),
    rule("undefined-attribute"),
  );
  assert.throws(() => d.insert("SURVEY", [0, 0]), /Define it with block\(\) or xref\(\) first/);
  const inserts = ["BASE", "STAYS"].map((block) => ({ ...placed, block }));
  assert.deepEqual(lint({ ...d.build(), entities: inserts }), []);
});

test("lint reports each xref rule in a drawing built another way", () => {
  assert.deepEqual(lint(withXrefs([{ name: "BASE", path: "base.dwg" }], [placed])), []);
  const twin = {
    ...withXrefs([{ name: "tree", path: "t.dwg" }]),
    blocks: [{ name: "TREE", entities: [] }],
  };
  assert.match(
    messages(twin)[0]!,
    /^error duplicate-block: Xref "tree": .* a block of this name, as "TREE"/,
  );
  for (const xrefs of [5, {}, null]) {
    assert.deepEqual(messages(withXrefs(xrefs as never)), ["error xref: xrefs must be an array"]);
  }
  assert.deepEqual(messages({ ...withXrefs([]), blocks: 5 as never }), [
    "error block: blocks must be an array",
  ]);
  const found = messages(
    withXrefs(
      [
        null,
        { name: 5, path: "a.dwg" },
        { name: "A", path: null },
        { name: "B", path: "C:/b.dwg" },
        { name: "b", path: "b.dwg" },
        { name: "C", path: "c.dwg", entities: [], base: [0, 0], attributes: [] },
        { name: "BASE", path: "base.dwg" },
      ],
      [
        { ...placed, attributes: { TAG: "1" } },
        { ...placed, block: "A", attributes: null as never },
      ],
    ),
  );
  for (const expected of [
    /^error xref: Xref undefined: an xref must be an object/,
    /^error xref: Xref 5: A block's name must be a string/,
    /^error xref: Xref "A": An xref's path must be a string/,
    /^error xref: Xref "B": An xref's path must start from the folder/,
    /^error duplicate-block: Xref "b": The drawing already has an xref of this name, as "B"/,
    /^error xref: Xref "C": An xref cannot have entities of its own/,
    /^error xref: Xref "C": An xref cannot have a base point/,
    /^error xref: Xref "C": An xref cannot have attribute definitions/,
    /^error undefined-attribute: insert #0: An insert of an xref cannot set attributes/,
    /^error undefined-attribute: insert #1: attributes must be an object/,
    /^warning xref: Xref "B": No insert places this xref\. AutoCAD purges/,
  ]) {
    assert.ok(
      found.some((message) => expected.test(message)),
      `${expected} in\n${found.join("\n")}`,
    );
  }
  const r12 = lint({ ...host(), dxf: "R12" }).map((d) => d.rule);
  assert.ok(r12.includes("xref") && r12.includes("block"));
});

test("R2018 DXF holds an xref as a block with a path, and its inserts", () => {
  const drawing = host();
  const groups = toDXF(drawing).split("\r\n");
  const records: string[][] = [];
  for (let i = 0; i + 1 < groups.length; i += 2) {
    if (groups[i] === "0") records.push([]);
    records.at(-1)?.push(`${groups[i]}=${groups[i + 1]}`);
  }
  const of = (type: string) => records.filter((r) => r[0] === `0=${type}` && r.includes("2=BASE"));
  const record = blockHandle("BASE");
  assert.deepEqual(of("BLOCK_RECORD")[0]?.slice(1, 2), [`5=${record}`]);
  const [block] = of("BLOCK");
  // 12 is an xref that is an overlay, and a path is escaped for one pass of AutoCAD's reader.
  assert.ok(block?.includes("70=12") && block.includes(`330=${record}`));
  assert.equal(block?.at(-1), "1=..\\base\\base.dwg");
  const inserts = of("INSERT");
  assert.equal(inserts.length, 2);
  assert.ok(inserts[1]?.includes(`5=${idHandle("second")}`) && inserts[1].includes("41=2"));
  const handles = records.flatMap((r) => r.filter((g) => /^(5|105)=/.test(g)));
  assert.equal(new Set(handles).size, handles.length);
  // An xref's record has a handle from its name, so the seed is above every such handle.
  const escaped = createDrawing().xref("A", "sub\\U+0041\\a.dwg").insert("A", [0, 0]).build();
  assert.match(toDXF(escaped), /\$HANDSEED\r\n5\r\n20000000000000\r\n/);
  assert.match(toDXF(escaped), /\r\n1\r\nsub\\U\+005CU\+0041\\a\.dwg\r\n/);
});

test("a drawing with xrefs goes to JSON and back, and the parser says why an xref has no entities", () => {
  const drawing = host();
  assert.deepEqual(fromJSON(toJSON(drawing)), drawing);
  assert.deepEqual(findXref(drawing, "base"), { name: "BASE", path: "..\\base\\base.dwg" });
  const broken = JSON.parse(toJSON(drawing)) as { xrefs: Record<string, unknown>[] };
  broken.xrefs[0]!.entities = [];
  broken.xrefs[0]!.attach = true;
  assert.throws(
    () => fromJSON(broken),
    (thrown: unknown) =>
      thrown instanceof DrawingError &&
      /xrefs\[0\]: An xref cannot have entities of its own/.test(thrown.message) &&
      /xrefs\[0\]: unknown field "attach"/.test(thrown.message),
  );
});

test("SVG draws the drawing given for an xref where each insert puts it, as AutoCAD draws a loaded xref", () => {
  const drawing = host();
  const alone = toSVG(drawing);
  // With no drawing given the group is empty, and the extents are those of a drawing of nothing.
  assert.match(alone, /viewBox="-0\.02 -1\.02 1\.04 1\.04"/);
  assert.equal(alone.match(/<g [^>]*data-xref="\.\.\\base\\base\.dwg"><\/g>/g)?.length, 2);
  assert.equal(toSVG(drawing, { xrefs: { OTHER: base() } }), alone);

  const svg = toSVG(drawing, { xrefs: { base: base() }, margin: 0 });
  const [first, second] = svg.split("<g data-layer").slice(1) as [string, string];
  // Layer 0 of the referenced drawing draws as the insert's layer, in its red.
  assert.match(
    first,
    /<line x1="0" y1="0" x2="10" y2="0" stroke="#ff0000" [^>]*data-layer="X-BASE"\/>/,
  );
  // Its other layers are its own: blue and 0.5 mm wide, through a block of its own too.
  assert.match(
    first,
    /<line x1="0" y1="0" x2="0" y2="10" stroke="#0000ff" stroke-width="2" [^>]*data-layer="BASE\|WALL"\/>/,
  );
  assert.match(
    first,
    /<circle cx="10" cy="10" r="1" stroke="#0000ff"[^>]*data-layer="BASE\|WALL"\/>/,
  );
  // A layer that is off in the referenced drawing is off here.
  assert.doesNotMatch(svg, /hidden/);
  // The second insert is scaled 2 by 3 and turned 30 degrees about 50, 5.
  assert.match(second, /<line x1="50" y1="5" x2="67\.320508" y2="15" /);
  assert.match(svg, /viewBox="0 -44\.578838 67\.320508 44\.578838"/);

  // A frozen layer hides the whole of an insert on it, and an off layer only what is on layer 0.
  const state = (layer: object) =>
    toSVG(
      {
        ...drawing,
        layers: drawing.layers.map((l) => (l.name === "X-BASE" ? { ...l, ...layer } : l)),
      },
      { xrefs: { BASE: base() } },
    );
  assert.doesNotMatch(state({ frozen: true }), /<line|<circle/);
  assert.doesNotMatch(state({ plot: false }), /<line|<circle/);
  assert.doesNotMatch(state({ off: true }), /data-layer="X-BASE"\/>/);
  assert.match(state({ off: true }), /data-layer="BASE\|WALL"/);

  // Dashes are scaled by this drawing's linetype scale, and not by the referenced drawing's.
  const dashed = createDrawing({ linetypeScale: 3 });
  dashed.line([0, 0], [10, 0], { linetype: { name: "D", pattern: [1, -1] } });
  const scaled = { ...drawing, linetypeScale: 2 };
  assert.match(
    toSVG(scaled, { xrefs: { BASE: dashed.build() } }),
    /d="M 0 0 L 2 0 M 4 0 L 6 0 M 8 0 L 10 0"/,
  );

  // A referenced drawing's own xrefs are not drawn, so two that reference each other end.
  const loop = createDrawing().xref("BASE", "host.dwg").insert("BASE", [0, 0]).line([0, 0], [1, 1]);
  assert.equal(toSVG(drawing, { xrefs: { BASE: loop.build() } }).match(/<line/g)?.length, 2);
});
