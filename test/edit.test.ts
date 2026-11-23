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
  readDXF,
  toDXF,
  type DrawingRead,
  type Edit,
} from "../src/index.ts";
import { BINARY } from "../src/read/groups.ts";
import { sha256 } from "../src/sha256.ts";
import { within } from "./time-limit.ts";

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
const readOf = (bytes: Uint8Array) => ({ sha256: sha256(bytes) }) as DrawingRead;

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
    editOf(bytes, { statements: [{ kind: "erase", handles: ["1F"] }] }),
    /no erase statement/,
  );
  const added = editOf(bytes, {
    additions: {
      model: [{ kind: "line", from: [0, 0], to: [1, 1], layer: "0" }] as never,
      layouts: {},
      definitions: {},
    },
  });
  refused(bytes, added, /no addition/);
  refused(bytes, { ...editOf(bytes), name: "" }, /malformed/);
  assert.throws(
    () => editDXF(bytes, editOf(bytes), { sha256: "1".repeat(64) } as DrawingRead),
    /read given is of other bytes/,
  );
});

test("checkEdit names what is wrong with a value meant as an edit, and an Edit goes through JSON", () => {
  const bytes = bytesOf("x");
  const good = editOf(bytes, { sheets: ["../A-101.dwg"] });
  assert.deepEqual(checkEdit(JSON.parse(JSON.stringify(good))), []);
  assert.deepEqual(checkEdit(null), ["the edit is not an object"]);
  assert.match(checkEdit({ ...good, format: 1 }).join(), /format is not 0/);
  assert.match(checkEdit({ ...good, sha256: "ABC" }).join(), /sha256/);
  assert.match(checkEdit({ ...good, name: "a b" }).join(), /name/);
  assert.match(checkEdit({ ...good, units: "yd" }).join(), /units/);
  assert.match(checkEdit({ ...good, statements: [{ kind: "explode" }] }).join(), /statement 0/);
  assert.match(
    checkEdit({ ...good, statements: [{ kind: "erase", handles: ["XYZ"] }] }).join(),
    /hexadecimal/,
  );
  assert.match(
    checkEdit({ ...good, additions: { model: [], layouts: { A: null }, definitions: {} } }).join(),
    /layout "A" is not a list/,
  );
  // A list's own properties are data, never called.
  assert.match(
    checkEdit({ ...good, sheets: Object.assign(["a"], { every: 0 }), statements: [] }).join(),
    /^$/,
  );
  // A list past the edit's limits is refused before it is walked.
  assert.match(
    checkEdit({ ...good, statements: { length: 1e9 } }).join(),
    /statements is not a list/,
  );
});

test("editDrawing builds the edit, and reads the file only when its function asks", () => {
  let loaded = 0;
  const load = () => {
    loaded++;
    return { sha256: "a".repeat(64), model: { census: {} } } as unknown as DrawingRead;
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
