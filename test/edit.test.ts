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

test("an edit refuses a stale hash, another format, a binary DXF and a statement it does not make", () => {
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
  refused(
    bytes,
    editOf(bytes, { statements: [{ kind: "layer", name: "0", changes: { on: false } }] }),
    /no layer statement/,
  );

  const added = editOf(bytes, {
    additions: {
      model: [{ kind: "line", from: [0, 0], to: [1, 1], layer: "0" }],
      layouts: {},
      definitions: {},
    },
  });

  refused(bytes, added, /no addition/);

  // A list the definitions inherit is walked, as `checkEdit` walks it.
  const inherited = editOf(bytes, {
    additions: {
      model: [],
      layouts: {},
      definitions: Object.create({ textStyles: [{ name: "NOTE", font: "Arial" }] }),
    },
  });

  refused(bytes, inherited, /no addition/);
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
      ["sheets", true],
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
