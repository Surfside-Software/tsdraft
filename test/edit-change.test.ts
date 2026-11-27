// A text changed in place keeps every code it does not replace, and refuses a replacement that
// would change the characters after it; a change the read can tell is wrong is refused by lintEdit.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changedParagraph,
  createDrawing,
  editDXF,
  editedRead,
  EditError,
  lintEdit,
  readDXF,
  toDXF,
  type Edit,
  type EditStatement,
} from "../src/index.ts";
import { placedText } from "../src/edit/text-change.ts";
import { isString } from "../src/guards.ts";
import { sha256 } from "../src/sha256.ts";
import { wrong } from "./values.ts";

test("a replacement in paragraph text takes the format in force where it starts, and keeps the rest", () => {
  const value = "Plain {\\fArial|b1|i0|c0|p34;BOLD WORDS} and {\\H1.5x;BIG} 1\\S1/2; INCH\\PNEXT";
  assert.equal(
    changedParagraph(value, { replace: ["BOLD WORDS", "OTHER {WORDS}"] }),
    "Plain {\\fArial|b1|i0|c0|p34;OTHER \\{WORDS\\}} and {\\H1.5x;BIG} 1\\S1/2; INCH\\PNEXT",
  );
  // Found as the paragraph reads: a line's end is \P, and a stack replaced whole goes with it.
  assert.equal(
    changedParagraph(value, { replace: ["INCH\nNEXT", "IN"] }),
    value.replace("INCH\\PNEXT", "IN"),
  );
  assert.equal(
    changedParagraph(value, { replace: ["11/2 INCH", "2 INCH"] }),
    value.replace("1\\S1/2; INCH", "2 INCH"),
  );
  // A group opened and closed inside the replaced part goes with it.
  assert.equal(
    changedParagraph(value, { replace: ["and BIG", "AND"] }),
    "Plain {\\fArial|b1|i0|c0|p34;BOLD WORDS} AND 1\\S1/2; INCH\\PNEXT",
  );

  const refused = (from: string, why: RegExp): void => {
    const made = changedParagraph(value, { replace: [from, "X"] });
    assert.ok(!isString(made) && why.test(made.problem), `${from}: ${JSON.stringify(made)}`);
  };

  refused("WORDS and", /closes a group opened before it/);
  refused("1/", /inside a stacked fraction/);
  refused("and {", /found nowhere/);
  refused("N", /more than once/);
  refused("and B", /\{ whose group goes on after it/);
  // A `%%` code reads as what it draws, and the replacement makes none.
  assert.equal(changedParagraph("A 90%%d NOTE", { replace: ["90°", "45°"] }), "A 45° NOTE");

  for (const [text, from, to] of [
    ["A 90 NOTE", "90", "45%%d"],
    ["A 90%d NOTE", "90", "45%"],
  ] as const) {
    const made = changedParagraph(text, { replace: [from, to] });
    assert.ok(!isString(made) && /make a %% code/.test(made.problem), JSON.stringify(made));
  }

  // A code that changes what comes after it, outside a group the replacement holds whole.
  const lasting = changedParagraph("A \\H2x;B C", { replace: ["A B", "X"] });
  assert.ok(!isString(lasting) && /changes the characters after it/.test(lasting.problem));
});

/** A DXF of a text, paragraph text in two columns, and a layer, read with geometry. */
async function sample() {
  const d = createDrawing({ units: "ft" });
  d.layer("A-NOTE", { color: 3 });
  d.text([0, 0], "SHEET 1", { height: 1 });
  d.paragraph("A NOTE THAT RUNS ON\\PAND ON", {
    at: [0, 10],
    height: 1,
    width: 10,
    columns: { count: 2, height: 2, gutter: 1 },
  });
  d.paragraph("ONE COLUMN", { at: [0, 30], height: 1, width: 10, columns: { height: 3 } });
  const bytes = new TextEncoder().encode(toDXF(d.build()));
  const read = await readDXF(new TextDecoder().decode(bytes), { geometry: true });

  const handle = (kind: string): string =>
    read.model.entities!.find((e) => e.kind === kind)!.handle!;

  const column = read.model.entities!.find((e) => e.kind === "mtext" && e.value === "ONE COLUMN")!;

  return { bytes, read, text: handle("text"), paragraph: handle("mtext"), column: column.handle! };
}

const editOf = (bytes: Uint8Array, statements: EditStatement[]): Edit => ({
  format: 0,
  file: "plan.dxf",
  sha256: sha256(bytes),
  name: "rev-1",
  statements,
});

test("lintEdit refuses a change the read can tell is wrong, and the DXF writer refuses it too", async () => {
  const { bytes, read, text, paragraph, column } = await sample();

  const refused = (statements: EditStatement[], rule: string, why: RegExp): void => {
    const edit = editOf(bytes, statements);
    const found = lintEdit(edit, read).filter((d) => d.severity === "error");
    assert.ok(
      found.some((d) => d.rule === rule && why.test(d.message)),
      JSON.stringify(found),
    );
    assert.throws(() => editDXF(bytes, edit, read), EditError);
    // What it cannot make, editedRead leaves out.
    assert.equal(editedRead(read, edit), read);
  };

  refused(
    [{ kind: "change", handle: text, changes: { layer: "NONE" } }],
    "edit-change",
    /no layer "NONE"/,
  );
  refused(
    [{ kind: "change", handle: text, changes: { text: { replace: ["X", "Y"] } } }],
    "edit-change",
    /found nowhere/,
  );
  refused(
    [{ kind: "change", handle: text, changes: { width: 4 } }],
    "edit-change",
    /only of paragraph text/,
  );
  refused(
    [{ kind: "change", handle: paragraph, changes: { width: 4 } }],
    "edit-change",
    /two or more columns/,
  );
  refused(
    [{ kind: "layer", name: "NONE", changes: { on: false } }],
    "edit-layer",
    /no layer "NONE"/,
  );
  refused([{ kind: "layer", name: "0", changes: { frozen: true } }], "edit-layer", /current layer/);
  refused(
    [{ kind: "layer", name: "A-NOTE", changes: { linetype: "ByLayer" } }],
    "edit-layer",
    /not ByLayer/,
  );
  // One column of a height of its own, which a longer value would flow into a second.
  refused(
    [
      {
        kind: "change",
        handle: column,
        changes: { text: Array(8).fill("A LONGER NOTE").join("\\P") },
      },
    ],
    "edit-change",
    /into a second column/,
  );
  refused(
    [{ kind: "change", handle: column, changes: { text: "ONE\\NTWO" } }],
    "edit-change",
    /column break/,
  );

  // A host's own entity is not put on a layer its xref owns.
  const host = {
    ...read,
    layers: [...read.layers, { ...read.layers[0]!, name: "BASE|WALL", xref: true }],
  };

  const onXref = editOf(bytes, [{ kind: "change", handle: text, changes: { layer: "BASE|WALL" } }]);
  assert.ok(
    lintEdit(onXref, host).some(
      (d) => d.severity === "error" && /a layer of an xref/.test(d.message),
    ),
  );
  assert.throws(() => editDXF(bytes, onXref, host), EditError);
  refused(
    [
      { kind: "change", handle: text, changes: { color: 1 } },
      { kind: "erase", handles: [text] },
    ],
    "edit-twice",
    /both reach/,
  );
});

test("a change of a text, its pen and its layer reads back as editedRead says", async () => {
  const { bytes, read, text } = await sample();

  const edit = editOf(bytes, [
    {
      kind: "change",
      handle: text,
      changes: {
        text: { replace: ["1", "12"] },
        height: 2,
        layer: "A-NOTE",
        trueColor: 0x406080,
        lineweight: 35,
      },
    },
    { kind: "layer", name: "A-NOTE", changes: { frozen: true, lineweight: "Default" } },
  ]);

  const back = await readDXF(new TextDecoder().decode(editDXF(bytes, edit, read)), {
    geometry: true,
  });

  const after = editedRead(read, edit);
  const of = (r: typeof read) => r.model.entities!.find((e) => e.handle === text);
  assert.deepEqual(of(back), of(after));
  assert.deepEqual(back.layers, after.layers);
  assert.deepEqual(of(back), {
    ...of(read)!,
    value: "SHEET 12",
    height: 2,
    layer: "A-NOTE",
    color: 157,
    trueColor: 0x406080,
    lineweight: 35,
  });
});

test("a changed text keeps its carets, and one seen from below is not placed again", async () => {
  const d = createDrawing({ units: "ft" });
  d.text([0, 0], "PITCH 1^B AT 2", { height: 1 });
  d.paragraph("NOTE A^B", { at: [0, 10], height: 1, width: 10 });
  d.text([10, 5], "LOT 12", { height: 1, align: "right" });
  const dxf = toDXF(d.build());
  const bytes = new TextEncoder().encode(dxf);
  const read = await readDXF(dxf, { geometry: true });

  const of = (kind: string, value: string) =>
    read.model.entities!.find((e) => e.kind === kind && "value" in e && e.value === value)!.handle!;

  const edit = editOf(bytes, [
    {
      kind: "change",
      handle: of("text", "PITCH 1^B AT 2"),
      changes: { text: { replace: ["2", "3^C"] } },
    },
    {
      kind: "change",
      handle: of("mtext", "NOTE A^B"),
      changes: { text: { replace: ["NOTE", "N"] } },
    },
  ]);

  const back = await readDXF(new TextDecoder().decode(editDXF(bytes, edit, read)), {
    geometry: true,
  });

  const values = (r: typeof read) =>
    r.model.entities!.flatMap((e) => ("value" in e && isString(e.value) ? [e.value] : []));

  assert.deepEqual(values(back), values(editedRead(read, edit)));
  assert.ok(values(back).includes("PITCH 1^B AT 3^C") && values(back).includes("N A^B"));

  // The right-justified text turned to face down, its own X the world's -X, reading forward.
  const lot = of("text", "LOT 12");
  const at = dxf.indexOf("LOT 12");
  const record = dxf.slice(dxf.lastIndexOf("TEXT", at), dxf.indexOf("AcDbText", at));

  const flipped = dxf.replace(
    record,
    record
      .replace("\r\n10\r\n10\r\n", "\r\n10\r\n-10\r\n")
      .replace("\r\n11\r\n10\r\n", "\r\n11\r\n-10\r\n")
      .replace(
        "\r\n72\r\n2\r\n",
        "\r\n72\r\n2\r\n71\r\n2\r\n210\r\n0\r\n220\r\n0\r\n230\r\n-1\r\n",
      ),
  );

  assert.notEqual(flipped, dxf);
  const flippedBytes = new TextEncoder().encode(flipped);
  const flippedRead = await readDXF(flipped, { geometry: true });
  assert.throws(
    () =>
      editDXF(
        flippedBytes,
        editOf(flippedBytes, [{ kind: "change", handle: lot, changes: { text: "LOT 123456" } }]),
        flippedRead,
      ),
    (e: Error) => e instanceof EditError && /seen from below/.test(e.message),
  );
});

test("a replacement that would split a pair of surrogates is refused", () => {
  assert.ok(!isString(changedParagraph("A\u{1F600}B", { replace: ["\ud83d", "X"] })));
});

test("a pen set to ByLayer with a linetype added in its place leaves the color out", async () => {
  const d = createDrawing({ units: "ft" });
  d.line([0, 0], [1, 0], { color: 1 });
  const bytes = new TextEncoder().encode(toDXF(d.build()));
  const read = await readDXF(bytes, { geometry: true });
  const line = read.model.entities![0]!;

  const edit = editOf(bytes, [
    { kind: "change", handle: line.handle!, changes: { color: 256, linetype: "ByBlock" } },
  ]);

  const back = await readDXF(editDXF(bytes, edit, read), { geometry: true });
  const after = back.model.entities![0]!;
  assert.deepEqual([after.color, after.linetype], [undefined, "ByBlock"]);
});

test("a viewport's frozen layers are the ones it freezes after the edit", async () => {
  const d = createDrawing({ units: "ft" });

  for (const name of ["A", "B", "C"]) d.layer(name, { color: 2 });
  d.layer("VIEW", { color: 4, plot: false });
  d.layout("S", { paper: "ARCH B" }, (page) =>
    d.layer("VIEW", () =>
      page.viewport([1, 1], 7, 10, { center: [5, 2.5], ratio: 12, frozenLayers: ["A", "B"] }),
    ),
  );
  const bytes = new TextEncoder().encode(toDXF(d.build()));
  const read = await readDXF(bytes, { geometry: true });
  const viewport = read.layouts[0]!.viewports.find((v) => v.frozenLayers.length > 0)!;

  const frozen = async (freeze: string[], thaw: string[]): Promise<readonly string[]> => {
    const edit = editOf(bytes, [
      { kind: "viewport", handle: viewport.handle!, changes: { freeze, thaw } },
    ]);

    const back = await readDXF(editDXF(bytes, edit, read), { geometry: true });

    return back.layouts[0]!.viewports.find((v) => v.handle === viewport.handle)!.frozenLayers;
  };

  assert.deepEqual(await frozen([], ["A"]), ["B"]);
  assert.deepEqual(await frozen(["C"], []), ["A", "B", "C"]);
});

test("an aligned or fit text whose two points are one takes no size", () => {
  const styles = [{ name: "Standard", font: "txt.shx" }];

  for (const align of ["aligned", "fit"] as const) {
    const text = {
      at: [0, 0] as const,
      startFrom: "file" as const,
      stored: [0, 0] as const,
      alignAt: [0, 0] as const,
      height: 1,
      rotation: 0,
      style: "Standard",
      align,
    };

    assert.equal(placedText(text, "AB", 1, wrong(styles)), undefined);
    assert.ok(placedText({ ...text, alignAt: [4, 0] }, "AB", 1, wrong(styles)) !== undefined);
  }
});
