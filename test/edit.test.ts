// The edit of a firm's DXF with no statements: the copy comes back byte for byte, what an edit
// refuses is refused, and the structure check finds each rule broken.
import assert from "node:assert/strict";
import { test } from "node:test";
import kitchen from "../examples/outdoor-kitchen.ts";
import sheet from "../examples/site-plan.ts";
import {
  checkEdit,
  checkEditedCopy,
  createDrawing,
  dxfEditor,
  dxfStructure,
  editDrawing,
  editDXF,
  editedRead,
  EditError,
  lintEdit,
  readDXF,
  statementCall,
  toDXF,
  type DrawingRead,
  type Edit,
  type EditBuilder,
  type EditStatement,
  type ReadPart,
  type Transform,
} from "../src/index.ts";
import { BINARY } from "../src/read/groups.ts";
import { sha256 } from "../src/sha256.ts";
import { within } from "./time-limit.ts";
import { dataOf, wrong } from "./values.ts";

const encoder = new TextEncoder();
const bytesOf = (text: string): Uint8Array => encoder.encode(text);

const editOf = (bytes: Uint8Array, more: Partial<Edit> = {}): Edit => ({
  format: 0,
  file: "plan.dxf",
  sha256: sha256(bytes),
  name: "rev-1",
  statements: [],
  ...more,
});

/** A read that holds only the hash of its bytes, which is all an edit reads of it. */
const readOf = (bytes: Uint8Array): DrawingRead => wrong({ sha256: sha256(bytes) });

test("an edit with no statements writes a DXF of the 2018 format back byte for byte", async () => {
  for (const drawing of [sheet, kitchen]) {
    const bytes = bytesOf(toDXF(drawing));
    const read = await readDXF(new TextDecoder().decode(bytes));
    assert.deepEqual(editDXF(bytes, editOf(bytes), read), bytes);
  }
});

test("an edit refuses a stale hash, another format, a binary DXF and additions without a read", () => {
  const bytes = bytesOf(toDXF(sheet));

  const refused = (b: Uint8Array, edit: Edit, pattern: RegExp) =>
    assert.throws(
      () => editDXF(b, edit, readOf(b)),
      (e: Error) => e instanceof EditError && pattern.test(e.message),
    );

  refused(
    bytes,
    { ...editOf(bytes), sha256: "0".repeat(64) },
    /changed after the edit was planned/,
  );
  const r12 = createDrawing({ units: "ft" });
  r12.line([0, 0], [1, 1]);
  const old = bytesOf(toDXF(r12.build(), { version: "R12" }));
  refused(old, editOf(old), /format AC1009/);

  // A comment between `$ACADVER` and its value is no value.
  const commented = (version: string, comment: string) =>
    bytesOf(
      toDXF(sheet).replace(
        /(\$ACADVER\r\n)(\s*1\r\n)AC1032/,
        `$1999\r\n${comment}\r\n$2${version}`,
      ),
    );

  const note = commented("AC1032", "project note");
  assert.deepEqual(editDXF(note, editOf(note), readOf(note)), note);
  const older = commented("AC1015", "AC1032");
  refused(older, editOf(older), /format AC1015/);
  const binary = bytesOf(`${BINARY}\r\n\x1a\x00`);
  refused(binary, editOf(binary), /binary DXF/);

  const added = editOf(bytes, {
    additions: {
      model: [{ kind: "line", from: [0, 0], to: [1, 1], layer: "0" }],
      layouts: {},
      definitions: {},
    },
  });

  // An addition needs the read of the file with geometry, which this read is not.
  refused(bytes, added, /could not be checked/);

  // A list the definitions inherit is walked, as `checkEdit` walks it.
  const inherited = editOf(bytes, {
    additions: {
      model: [],
      layouts: {},
      definitions: Object.create({ textStyles: [{ name: "NOTE", font: "Arial" }] }),
    },
  });

  refused(bytes, inherited, /could not be checked/);
  refused(bytes, { ...editOf(bytes), name: "" }, /malformed/);
  assert.throws(
    () => editDXF(bytes, editOf(bytes), wrong({ sha256: "1".repeat(64) })),
    /read given is of other bytes/,
  );
});

test("checkEdit names what is wrong with a value meant as an edit, and an Edit goes through JSON", () => {
  const bytes = bytesOf("x");
  const good = editOf(bytes, { sheets: ["../A-101.dwg"] });
  const data = dataOf(good);
  assert.deepEqual(checkEdit(JSON.parse(JSON.stringify(good))), []);
  assert.deepEqual(checkEdit(null), ["the edit is not an object"]);
  assert.match(checkEdit(wrong({ ...data, format: 1 })).join(), /format is not 0/);
  assert.match(checkEdit(wrong({ ...data, sha256: "ABC" })).join(), /sha256/);
  assert.match(checkEdit(wrong({ ...data, name: "a b" })).join(), /name/);
  assert.match(checkEdit(wrong({ ...data, units: "yd" })).join(), /units/);
  assert.match(
    checkEdit(wrong({ ...data, statements: [{ kind: "explode" }] })).join(),
    /statement 0/,
  );
  assert.match(
    checkEdit(wrong({ ...data, statements: [{ kind: "erase", handles: ["XYZ"] }] })).join(),
    /hexadecimal/,
  );
  assert.match(
    checkEdit(
      wrong({ ...data, additions: { model: [], layouts: { A: null }, definitions: {} } }),
    ).join(),
    /layout "A" is not a list/,
  );

  for (const additions of [
    { model: [null], layouts: {}, definitions: {} },
    { model: [], layouts: { A: [7] }, definitions: {} },
  ])
    assert.match(checkEdit(wrong({ ...data, additions })).join(), /an item that is no object/);
  // A list's own properties are data, never called.
  assert.match(
    checkEdit(
      wrong({ ...data, sheets: Object.assign(["a"], { every: 0 }), statements: [] }),
    ).join(),
    /^$/,
  );
  // A list past the edit's limits is refused before it is walked.
  assert.match(
    checkEdit(wrong({ ...data, statements: { length: 1e9 } })).join(),
    /statements is not a list/,
  );
});

test("editDrawing builds the edit, and reads the file only when its function asks", () => {
  let loaded = 0;

  const load = () => {
    loaded++;

    return wrong<DrawingRead>({ sha256: "a".repeat(64), model: { census: {} } });
  };

  const quiet = editDrawing({ file: "../plan.dxf", sha256: "A".repeat(64), name: "rev-1" });
  assert.deepEqual(quiet.build(load), {
    format: 0,
    file: "../plan.dxf",
    sha256: "a".repeat(64),
    name: "rev-1",
    statements: [],
  });
  assert.equal(loaded, 0);

  const reading = editDrawing(
    { file: "plan.dxf", sha256: "a".repeat(64), name: "r" },
    (_e, read) => {
      assert.equal(read.sha256, "a".repeat(64));
    },
  );

  reading.build(load);
  reading.build(load);
  assert.equal(loaded, 2);
});

/** A DXF without the first group of a code in the first record of a kind. */
function withoutGroup(text: string, kind: string, code: number): Uint8Array {
  const lines = text.split("\r\n");
  let inKind = false;

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const c = Number(lines[i]);

    if (c === 0) inKind = lines[i + 1] === kind;
    else if (inKind && c === code) {
      lines.splice(i, 2);

      return bytesOf(lines.join("\r\n"));
    }
  }

  throw new Error(`no group ${code} in a ${kind}`);
}

/** A DXF with one group's value made another, by the groups' text. */
function bent(text: string, from: RegExp, to: string): Uint8Array {
  assert.match(text, from);

  return bytesOf(text.replace(from, to));
}

test("the structure check finds no defect in what toDXF writes, and finds each rule broken", () => {
  const text = toDXF(sheet);
  assert.deepEqual(dxfStructure(bytesOf(text)), { defects: [], count: 0 });
  const rules = (bytes: Uint8Array) => dxfStructure(bytes).defects.map((d) => d.rule);
  // A layer with no plot style.
  assert.ok(rules(withoutGroup(text, "LAYER", 390)).includes("layer-plot-style"));
  // A pointer to no record.
  assert.ok(rules(bent(text, /(\r\n390\r\n)[0-9A-F]+/, "$1FFFFF")).includes("reference"));
  // A handle held twice, and one past the seed.
  const seed = /\$HANDSEED\r\n\s*5\r\n([0-9A-F]+)/.exec(text)![1]!;
  assert.ok(
    rules(bent(text, /(\$HANDSEED\r\n\s*5\r\n)[0-9A-F]+/, "$110")).includes("handle-past-seed"),
  );
  const handles = [...text.matchAll(/\r\n\s*5\r\n([0-9A-F]+)\r\n/g)].map((m) => m[1]!);
  assert.ok(handles.length > 2 && seed.length > 0);
  assert.ok(
    rules(
      bytesOf(text.replace(`\r\n5\r\n${handles[3]}\r\n`, `\r\n5\r\n${handles[2]}\r\n`)),
    ).includes("handle-twice"),
  );
  // The table of dimension styles may name a style it no longer holds, as the leading CAD app's own
  // save of a file that defined one twice does.
  assert.deepEqual(
    rules(bent(text, /(AcDbDimStyleTable\r\n71\r\n\d+\r\n340\r\n)[0-9A-F]+/, "$1FFFFFF")),
    [],
  );
  // An entity on a layer the file lacks.
  assert.ok(
    rules(bent(text, /(AcDbEntity\r\n\s*8\r\n)[^\r]+/, "$1NO SUCH LAYER")).includes("entity-layer"),
  );
  // Groups that do not read are one defect, and the check never throws.
  assert.deepEqual(rules(bytesOf("  0\r\nSECTION\r\nnot a code\r\nx\r\n")), ["unreadable"]);
});

test("the structure check stays linear on many long names that differ only at their ends", () => {
  // 2,000 lines, each on a layer of its own of 17,000 characters, past what V8 hashes whole.
  const base = "N".repeat(17_000 - 8);

  const lines = Array.from(
    { length: 2000 },
    (_, i) =>
      `  0\r\nLINE\r\n  5\r\n${(0x100 + i).toString(16).toUpperCase()}\r\n  8\r\n${base}${String(i).padStart(8, "0")}\r\n`,
  );

  const text = `  0\r\nSECTION\r\n  2\r\nHEADER\r\n  9\r\n$HANDSEED\r\n  5\r\nFFFF\r\n  0\r\nENDSEC\r\n  0\r\nSECTION\r\n  2\r\nENTITIES\r\n${lines.join("")}  0\r\nENDSEC\r\n  0\r\nEOF\r\n`;
  const report = within(3000, () => dxfStructure(bytesOf(text)));
  assert.equal(report.count, 2000);
  assert.ok(report.defects.every((d) => d.detail.length < 400));
});

test("the checks of every job pass on the copy, and a changed record fails before and after", async () => {
  const bytes = bytesOf(toDXF(sheet));
  const read = await dxfEditor.read(bytes);
  const edit = editOf(bytes);
  const copy = editDXF(bytes, edit, read);
  const checks = await checkEditedCopy(dxfEditor, bytes, read, edit, copy);
  assert.deepEqual(
    checks.map((c) => [c.check, c.passed]),
    [
      ["read-back", true],
      ["structure", true],
      ["before-after", true],
      ["lint", true],
    ],
  );
  const text = new TextDecoder().decode(bytes);
  const changed = bytesOf(text.replace(/(AcDbEntity\r\n\s*8\r\n)([^\r]+)/, "$1$2X"));
  const failed = await checkEditedCopy(dxfEditor, bytes, read, edit, changed);
  const after = failed.find((c) => c.check === "before-after")!;
  assert.equal(after.passed, false);
  assert.match(after.problems.join("\n"), /changed, and the edit does not change it/);
  assert.equal(failed.find((c) => c.check === "structure")!.passed, false);
  // Two records that change places fail it too.
  const records = text.split(/(?=\r\n0\r\nLAYER\r\n)/);
  assert.ok(records.length > 3);
  [records[1], records[2]] = [records[2]!, records[1]!];
  const swapped = await checkEditedCopy(dxfEditor, bytes, read, edit, bytesOf(records.join("")));
  assert.match(
    swapped.find((c) => c.check === "before-after")!.problems.join("\n"),
    /is not in its place/,
  );
});

test("the builder's erase and move make statements with their calls, and refuse what is not one", () => {
  // SAFETY: the edits below never read the read, so a stand-in with only its hash does.
  const read = { sha256: "a".repeat(64) } as DrawingRead;

  const file = editDrawing({ file: "plan.dxf", sha256: "a".repeat(64), name: "r" }, (e) => {
    e.erase("436d8", "00436D9");
    e.move(["4360A"], { by: [0, -14.25] });
  });

  const edit = file.build(read);
  assert.deepEqual(edit.statements, [
    { kind: "erase", handles: ["436D8", "436D9"] },
    { kind: "move", handles: ["4360A"], transform: { by: [0, -14.25] } },
  ]);
  assert.match(statementCall(edit, 1)?.file ?? "", /edit\.test\.ts$/);
  assert.deepEqual(checkEdit(JSON.parse(JSON.stringify(edit))), []);

  const refused = (body: (e: EditBuilder) => void, pattern: RegExp) =>
    assert.throws(
      () => editDrawing({ file: "p.dxf", sha256: "a".repeat(64), name: "r" }, body).build(read),
      (e: Error) => e instanceof EditError && pattern.test(e.message),
    );

  refused((e) => e.erase("XYZ"), /not a handle/);
  // A turn or a scale about the origin would throw a firm's entity off its sheet.
  refused((e) => e.move(["1F"], { rotate: 90 }), /give it about/);
  refused((e) => e.move(["1F"], { scale: 0 }), /scale/);
  refused((e) => e.move(["1F"], { by: [Number.NaN, 0] }), /by/);
});

test("each entity of a drawing erased, moved, turned and scaled reads back as editedRead says", async () => {
  const transforms: Transform[] = [
    { by: [1234.5678901234567, -98.76543210987654] },
    { about: [3.25, -7.5], rotate: 37.5 },
    { about: [3.25, -7.5], rotate: 90, scale: 2.5, by: [1, 2] },
  ];

  let made = 0;

  for (const drawing of [sheet, kitchen]) {
    const bytes = bytesOf(toDXF(drawing));
    const read = await dxfEditor.read(bytes);
    // One entity of each kind, in each space.
    const seen = new Set<string>();
    const handles: string[] = [];

    for (const [space, list] of [
      read.model.entities!,
      ...read.layouts.map((l) => l.entities ?? []),
    ].entries())
      for (const e of list)
        if (e.handle !== undefined && !seen.has(`${space}:${e.kind}`)) {
          seen.add(`${space}:${e.kind}`);
          handles.push(e.handle);
        }

    for (const h of handles) {
      const statements: EditStatement[] = [
        { kind: "erase", handles: [h] },
        ...transforms.map((transform) => ({ kind: "move" as const, handles: [h], transform })),
      ];

      for (const statement of statements) {
        const edit = editOf(bytes, { statements: [statement] });

        if (lintEdit(edit, read).some((d) => d.severity === "error")) continue;
        const copy = editDXF(bytes, edit, read);

        const failed = (await checkEditedCopy(dxfEditor, bytes, read, edit, copy)).filter(
          (c) => !c.passed,
        );

        assert.deepEqual(failed, [], `${h} ${JSON.stringify(statement)}`);
        made++;
      }
    }
  }

  assert.ok(made > 40);
});

test("lintEdit refuses what the read tells it cannot make, and warns of a locked layer and a block", async () => {
  const d = createDrawing({ units: "ft" });
  d.layer("LOCKED", { locked: true }, () => d.line([0, 0], [1, 0]));
  d.block("ONCE", {}, () => d.circle([0, 0], 1));
  d.block("TWICE", {}, () => d.line([0, 0], [1, 1]));
  d.insert("ONCE", [5, 5]);
  d.insert("TWICE", [10, 5]);
  d.insert("TWICE", [15, 5]);
  d.dimensionStyle({
    name: "D",
    textHeight: 0.1,
    arrowSize: 0.1,
    extensionOffset: 0,
    extensionBeyond: 0,
    textGap: 0,
    precision: 0,
  });
  d.linearDimension([0, 0], [10, 0], [0, 2], { style: "D" });
  const bytes = bytesOf(toDXF(d.build()));
  const read = await dxfEditor.read(bytes);
  const of = (kind: string) => read.model.entities!.find((e) => e.kind === kind)!.handle!;

  const blockEntity = (name: string) =>
    read.blocks.find((b) => b.name === name)!.entities[0]!.handle!;

  const rules = (...statements: EditStatement[]) =>
    lintEdit(editOf(bytes, { statements }), read).map((x) => `${x.severity} ${x.rule}`);

  assert.deepEqual(rules({ kind: "erase", handles: [of("line")] }), ["warning edit-locked-layer"]);
  assert.deepEqual(rules({ kind: "erase", handles: ["FFFFF"] }), ["error edit-missing"]);
  assert.deepEqual(
    rules(
      { kind: "erase", handles: [of("line")] },
      { kind: "move", handles: [of("line")], transform: { by: [1, 0] } },
    ),
    ["error edit-twice", "warning edit-locked-layer", "warning edit-locked-layer"],
  );
  assert.deepEqual(rules({ kind: "erase", handles: [blockEntity("ONCE")] }), [
    "warning edit-block-definition",
  ]);
  assert.deepEqual(rules({ kind: "erase", handles: [blockEntity("TWICE")] }), ["error edit-block"]);
  assert.deepEqual(
    rules({ kind: "move", handles: [of("dimension")], transform: { about: [0, 0], scale: 2 } }),
    ["error edit-transform"],
  );
  const picture = read.blocks.find((b) => b.name.startsWith("*D"))!.entities[0]!.handle!;
  assert.deepEqual(rules({ kind: "erase", handles: [picture] }), ["error edit-part"]);
  // A malformed edit past the limit is still an error.
  const malformed = wrong<Edit>({ ...dataOf(editOf(bytes)), format: 9 });
  assert.deepEqual(
    lintEdit(malformed, read, { most: 0 }).map((x) => `${x.severity} ${x.rule}`),
    ["error edit-limit"],
  );
});

test("a dimension whose picture another names too is erased without the picture, and refused a move", async () => {
  const d = createDrawing({ units: "ft" });
  d.dimensionStyle({
    name: "D",
    textHeight: 0.1,
    arrowSize: 0.1,
    extensionOffset: 0,
    extensionBeyond: 0,
    textGap: 0,
    precision: 0,
  });
  d.linearDimension([0, 0], [10, 0], [0, 2], { style: "D" });
  d.linearDimension([0, 5], [10, 5], [0, 7], { style: "D" });
  const text = toDXF(d.build());
  const entities = text.indexOf("ENTITIES");
  const names = [...text.slice(entities).matchAll(/\r\n2\r\n(\*D\d+)\r\n/g)];
  assert.equal(names.length, 2);
  const at = entities + names[1]!.index! + 5;

  const bytes = bytesOf(
    `${text.slice(0, at)}${names[0]![1]}${text.slice(at + names[1]![1]!.length)}`,
  );

  const read = await dxfEditor.read(bytes);
  const [first, second] = read.model.entities!.filter((e) => e.kind === "dimension");
  const picture = read.blocks.find((b) => b.name === names[0]![1])!;

  const erase = editOf(bytes, { statements: [{ kind: "erase", handles: [first!.handle!] }] });
  assert.deepEqual(lintEdit(erase, read), []);
  const copy = editDXF(bytes, erase, read);
  const back = await dxfEditor.read(copy);
  assert.deepEqual(back.blocks.find((b) => b.name === picture.name)?.entities, picture.entities);
  assert.ok(back.model.entities!.some((e) => e.handle === second!.handle));
  assert.ok((await checkEditedCopy(dxfEditor, bytes, read, erase, copy)).every((c) => c.passed));

  const move = editOf(bytes, {
    statements: [{ kind: "move", handles: [first!.handle!], transform: { by: [1, 0] } }],
  });

  assert.deepEqual(
    lintEdit(move, read).map((x) => `${x.severity} ${x.rule}`),
    ["error edit-part"],
  );
  assert.throws(() => editDXF(bytes, move, read), EditError);

  // The picture of a dimension in a block's definition is that dimension's too.
  const one = await dxfEditor.read(bytesOf(text));
  const dimension = one.model.entities!.find((e) => e.kind === "dimension")!;

  const block = {
    handle: "FFFF0",
    name: "B",
    base: [0, 0] as const,
    anonymous: false,
    attributeDefinitions: [],
    entities: [dimension],
    other: {},
  };

  const nested = {
    ...one,
    model: { ...one.model, entities: one.model.entities!.filter((e) => e !== dimension) },
    blocks: [...one.blocks, block],
  };

  const own = nested.blocks.find(
    (b) => b.handle === (dimension.kind === "dimension" && dimension.blockHandle),
  )!;

  const part = editOf(bytesOf(text), {
    statements: [{ kind: "erase", handles: [own.entities[0]!.handle!] }],
  });

  assert.deepEqual(
    lintEdit(part, nested).map((x) => `${x.severity} ${x.rule}`),
    ["error edit-part"],
  );
});

test("a block's definition is refused an edit where a read that leaves inserts out shows one", async () => {
  const d = createDrawing({ units: "ft" });
  d.block("ONCE", {}, () => d.circle([0, 0], 1));
  d.insert("ONCE", [5, 5]);
  d.insert("ONCE", [500, 500]);
  const bytes = bytesOf(toDXF(d.build()));

  const read = await readDXF(bytes, {
    geometry: true,
    only: {
      areas: [
        [
          [0, 0],
          [10, 10],
        ],
      ],
    },
  });

  assert.equal(read.model.entities!.filter((e) => e.kind === "insert").length, 1);
  const circle = read.blocks.find((b) => b.name === "ONCE")!.entities[0]!.handle!;
  const edit = editOf(bytes, { statements: [{ kind: "erase", handles: [circle] }] });
  assert.deepEqual(
    lintEdit(edit, read).map((x) => `${x.severity} ${x.rule}`),
    ["error edit-block"],
  );

  // A block of an xref, by its name in another case or one its file holds, is refused too.
  const one = createDrawing({ units: "ft" });
  one.block("ONCE", {}, () => one.circle([0, 0], 1));
  one.insert("ONCE", [5, 5]);
  const text = toDXF(one.build());

  for (const [file, xrefs] of [
    [text, [{ name: "once", path: "once.dwg", overlay: false }]],
    [text.replaceAll("ONCE", "BASE|ONCE"), []],
  ] as const) {
    const b = bytesOf(file);
    const r = { ...(await readDXF(b, { geometry: true })), xrefs };
    const h = r.blocks.find((x) => x.name.endsWith("ONCE"))!.entities[0]!.handle!;
    assert.match(
      lintEdit(editOf(b, { statements: [{ kind: "erase", handles: [h] }] }), r)
        .map((x) => `${x.severity} ${x.rule} ${x.message}`)
        .join(),
      /^error edit-block .*an xref/,
    );
  }
});

test("an erased text past where a census's list stops is taken out of its count", async () => {
  const d = createDrawing({ units: "ft" });
  d.text([0, 0], "A", { height: 1 });
  d.text([0, 5], "B", { height: 1 });
  const bytes = bytesOf(toDXF(d.build()));
  const whole = await readDXF(bytes, { geometry: true });

  const census = {
    ...whole.model.census,
    texts: whole.model.census.texts.slice(0, 1),
    capped: true,
  };

  const read = { ...whole, model: { ...whole.model, census } };
  const last = read.model.entities!.at(-1)!.handle!;
  const edit = editOf(bytes, { statements: [{ kind: "erase", handles: [last] }] });
  assert.equal(editedRead(read, edit).model.census.counts.texts, 1);
});

test("a move out of a read's area, a comment between a point's numbers and a scale of a height of its own", async () => {
  const d = createDrawing({ units: "ft" });
  d.line([0, 0], [1, 0]);
  d.paragraph("{\\H3;LARGE} small", { at: [5, 5], height: 1 });
  d.paragraph("Literal: \\\\H3;", { at: [5, 8], height: 1 });
  // A comment between the line's start X and its Y, which a reader skips.
  const text = toDXF(d.build()).replace("AcDbLine\r\n10\r\n0\r\n", "$&999\r\nnote\r\n");
  assert.ok(text.includes("999\r\nnote"));
  const bytes = bytesOf(text);

  const only: ReadPart = {
    areas: [
      [
        [-10, -10],
        [10, 10],
      ],
    ],
  };

  const read = await dxfEditor.read(bytes, only);
  const line = read.model.entities!.find((e) => e.kind === "line")!.handle!;
  const mtext = read.model.entities!.find((e) => e.kind === "mtext")!.handle!;

  const moved = editOf(bytes, {
    only,
    statements: [{ kind: "move", handles: [line], transform: { by: [2, 3] } }],
  });

  const checks = await checkEditedCopy(dxfEditor, bytes, read, moved, editDXF(bytes, moved, read));
  assert.deepEqual(
    checks.filter((c) => !c.passed).map((c) => c.problems[0]),
    [],
  );

  // Out of the read's area, where the checks would not see it, the move is refused.
  const out = editOf(bytes, {
    only,
    statements: [{ kind: "move", handles: [line], transform: { by: [100, 0] } }],
  });

  assert.deepEqual(
    lintEdit(out, read).map((x) => x.rule),
    ["edit-only"],
  );
  assert.throws(() => editDXF(bytes, out, read), EditError);

  const scaled = editOf(bytes, {
    only,
    statements: [{ kind: "move", handles: [mtext], transform: { scale: 2, about: [0, 0] } }],
  });

  assert.deepEqual(
    lintEdit(scaled, read).map((x) => x.rule),
    ["edit-transform"],
  );

  // `\\` is a backslash, so `\\H3;` is text, and a scale of it is made.
  const literal = read.model.entities!.find(
    (e) => e.kind === "mtext" && e.value.startsWith("Literal"),
  )!.handle!;

  const escaped = editOf(bytes, {
    only,
    statements: [{ kind: "move", handles: [literal], transform: { scale: 2, about: [5, 8] } }],
  });

  assert.deepEqual(lintEdit(escaped, read), []);
});
