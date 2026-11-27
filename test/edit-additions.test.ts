// Additions to a firm's file: the builder over the file's names, the mark, handles from the seed,
// the edit's record, and a later edit of the same name.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CENSUS_LIMIT,
  checkEditedCopy,
  BUILT_IN_STANDARD,
  createDrawing,
  defineStandard,
  dxfEditor,
  editDrawing,
  editDXF,
  editedRead,
  EditError,
  lintEdit,
  markOf,
  markUnchanged,
  readDXF,
  recordAdditions,
  replacement,
  toDXF,
  type DrawingRead,
  type EditBuilder,
} from "../src/index.ts";

/** A firm's file: a layer, a text style and a line of its own. */
function firmFile(): Uint8Array {
  const d = createDrawing({ units: "in" });
  d.textStyle({ name: "ROMANS", font: "romans.shx" });
  d.layer("A-NOTE", { color: 2 }, () => d.line([0, 0], [100, 0]));
  d.layer("A-OFF", { color: 3, off: true });

  return new TextEncoder().encode(toDXF(d.build()));
}

const geometry = (bytes: Uint8Array): Promise<DrawingRead> => readDXF(bytes, { geometry: true });

/** The copy an edit of `name` makes, held to the checks of every job. */
async function edited(bytes: Uint8Array, name: string, draw: (e: EditBuilder) => void) {
  const read = await geometry(bytes);
  const edit = editDrawing({ file: "firm.dxf", sha256: read.sha256, name }, draw).build(read);
  const errors = lintEdit(edit, read).filter((d) => d.severity === "error");

  if (errors.length > 0) return { errors, read, edit, out: undefined };
  const out = editDXF(bytes, edit, read);

  const failed = (await checkEditedCopy(dxfEditor, bytes, read, edit, out)).filter(
    (c) => !c.passed,
  );

  assert.deepEqual(failed, []);

  return { errors, read, edit, out };
}

const added = (read: DrawingRead) =>
  (read.model.entities ?? []).filter((e) => e.mark !== undefined);

test("an addition is the builder's entity in the file's names, marked, with a handle from the seed, and the record lists it", async () => {
  const bytes = firmFile();

  const { read, edit, out } = await edited(bytes, "rev-1", (e) =>
    e.model((d) => {
      d.layer("A-NOTE", () => d.text([0, 10], "NOTE", { height: 2, style: "ROMANS", id: "note" }));
      d.layer("A-REVS", { color: 6 }, () => d.line([0, 0], [5, 5]));
    }),
  );

  const back = await geometry(out!);
  const seed = BigInt(`0x${read.header.handseed}`);
  const marked = added(back);

  assert.deepEqual(
    marked.map((e) => [e.kind, e.layer, e.mark!.id]),
    [
      ["text", "A-NOTE", "note"],
      ["line", "A-REVS", "@model/1"],
    ],
  );

  for (const e of marked) {
    assert.ok(BigInt(`0x${e.handle}`) >= seed);
    assert.ok(markUnchanged(e));
  }

  assert.equal(marked[0]!.kind === "text" && marked[0]!.style, "ROMANS");
  assert.deepEqual(back.layers.find((l) => l.name === "A-REVS")?.color, 6);
  assert.deepEqual(back.edits, [
    {
      name: "rev-1",
      handle: back.edits?.[0]?.handle,
      additions: [
        { id: "note", handle: marked[0]!.handle },
        { id: "@model/1", handle: marked[1]!.handle },
        { id: "@layers/A-REVS", handle: back.layers.find((l) => l.name === "A-REVS")!.handle },
      ],
    },
  ]);
  assert.deepEqual(
    added(editedRead(read, edit)).map((e) => e.handle),
    marked.map((e) => e.handle),
  );
});

test("an edit's record is found where the file writes its handles in lower case", async () => {
  const { out } = await edited(firmFile(), "rev-1", (e) =>
    e.model((d) => d.layer("A-NOTE", () => d.line([0, 0], [5, 5]))),
  );

  const text = new TextDecoder().decode(out!);
  const own = /\r\n *3\r\nTSDRAFT\r\n *350\r\n([0-9A-F]+)\r\n/.exec(text)![1]!;

  const lower = text.replace(
    new RegExp(`(\\r\\n *(?:5|330|350)\\r\\n)${own}\\r\\n`, "g"),
    "$1abcdef\r\n",
  );

  assert.notEqual(lower, text);
  assert.deepEqual((await geometry(new TextEncoder().encode(lower))).edits?.[0]?.name, "rev-1");
});

test("a name the file holds is the file's: another definition of it is refused", async () => {
  const read = await geometry(firmFile());

  for (const draw of [
    (e: EditBuilder) => e.model((d) => d.layer("A-NOTE", { color: 5 })),
    (e: EditBuilder) => e.model((d) => d.textStyle({ name: "romans", font: "Arial" })),
  ])
    assert.throws(
      () => editDrawing({ file: "firm.dxf", sha256: read.sha256, name: "rev-1" }, draw).build(read),
      /is the file's/,
    );
});

test("a later edit of the same name writes an unchanged addition over itself, erases one it drops, and stops at one a person changed", async () => {
  const first = await edited(firmFile(), "rev-1", (e) =>
    e.model((d) =>
      d.layer("A-NOTE", () => {
        d.line([0, 5], [10, 5], { id: "kept" });
        d.circle([3, 3], 1, { id: "dropped" });
      }),
    ),
  );

  const one = added(await geometry(first.out!));

  const second = await edited(first.out!, "rev-1", (e) =>
    e.model((d) => d.layer("A-NOTE", () => d.line([0, 6], [12, 6], { id: "kept" }))),
  );

  const back = await geometry(second.out!);
  const two = added(back);

  assert.deepEqual(
    two.map((e) => [e.handle, e.mark!.id]),
    [[one[0]!.handle, "kept"]],
  );
  assert.deepEqual(two[0]!.kind === "line" && two[0]!.to, [12, 6]);
  assert.equal(
    back.model.entities!.some((e) => e.handle === one[1]!.handle),
    false,
  );

  // A person moves it, by an edit of another name.
  const moved = await edited(second.out!, "person", (e) =>
    e.move([two[0]!.handle!], { by: [1, 0] }),
  );

  const third = await edited(moved.out!, "rev-1", (e) =>
    e.model((d) => d.layer("A-NOTE", () => d.line([0, 7], [9, 7], { id: "kept" }))),
  );

  assert.deepEqual(
    third.errors.map((d) => d.rule),
    ["edit-mark-changed"],
  );
  assert.throws(() => editDXF(moved.out!, third.edit, third.read), EditError);
});

test("additions need a $HANDSEED above every handle of the file", async () => {
  const text = new TextDecoder().decode(firmFile());
  const line = (e: EditBuilder) => e.model((d) => d.layer("A-NOTE", () => d.line([0, 0], [1, 1])));

  for (const bytes of [
    text.replace(/9\r\n\$HANDSEED\r\n5\r\n[0-9A-F]+\r\n/, ""),
    text.replace(/(\$HANDSEED\r\n5\r\n)[0-9A-F]+/, "$11"),
  ].map((t) => new TextEncoder().encode(t))) {
    const read = await geometry(bytes);

    const edit = editDrawing({ file: "firm.dxf", sha256: read.sha256, name: "rev-1" }, line).build(
      read,
    );

    assert.ok(
      lintEdit(edit, read).some((d) => d.severity === "error" && /\$HANDSEED/.test(d.message)),
    );
    assert.throws(() => editDXF(bytes, edit, read), EditError);
    assert.deepEqual(editedRead(read, edit), read);
    // The writer reads the file's own handles, past what a read lists.
    const told = { ...read, header: { ...read.header, handseed: "FFFFF" } };
    assert.throws(() => editDXF(bytes, edit, told), /is not above its handle|no \$HANDSEED/);
  }
});

test("additions with a change of an xref's layer write both $VISRETAIN and $HANDSEED", async () => {
  const text = new TextDecoder()
    .decode(firmFile())
    .replace(
      /(2\r\n)A-OFF(\r\n[^]*?390\r\n[0-9A-F]+\r\n)/,
      "$1BASE|OFF$21001\r\nAcXRefLayerPropertyOverride\r\n1071\r\n0\r\n",
    )
    .replace(/(\$ACADVER\r\n1\r\nAC1032\r\n)/, "$19\r\n$$VISRETAIN\r\n70\r\n0\r\n");

  const source = new TextEncoder().encode(text);

  const { out, read, edit } = await edited(source, "rev-1", (e) => {
    e.layer("BASE|OFF", { color: 4 });
    e.model((d) => d.layer("A-NOTE", () => d.line([0, 0], [1, 1])));
  });

  const back = await geometry(out!);
  const seed = BigInt(`0x${back.header.handseed}`);
  assert.ok(added(back).every((e) => BigInt(`0x${e.handle}`) < seed));
  const written = new TextDecoder().decode(out);
  assert.match(written, /\$VISRETAIN\r\n70\r\n1\r\n/);
  // Any other change of the header fails the checks, one the read reads nothing of too.
  const xedit = new TextEncoder().encode(written.replace(/(\$XEDIT\r\n290\r\n)0/, "$11"));
  const checks = await checkEditedCopy(dxfEditor, source, read, edit, xedit);
  assert.match(
    checks.find((c) => c.check === "before-after")!.problems.join(),
    /the header changed past its \$HANDSEED/,
  );
});

test("a record the additions change is written again only from UTF-8", async () => {
  const bytes = firmFile();
  const at = new TextDecoder().decode(bytes).indexOf("3\r\nACAD_GROUP\r\n") + 13;
  const latin1 = new Uint8Array([...bytes.subarray(0, at), 0xe9, ...bytes.subarray(at)]);
  const read = await geometry(latin1);

  const edit = editDrawing({ file: "firm.dxf", sha256: read.sha256, name: "rev-1" }, (e) =>
    e.model((d) => d.layer("A-NOTE", () => d.line([0, 0], [1, 1]))),
  ).build(read);

  assert.throws(() => editDXF(latin1, edit, read), /is not UTF-8/);
});

test("an addition to a space whose census lists its limit leaves the list at its limit", async () => {
  const bytes = firmFile();
  const whole = await geometry(bytes);

  const text = {
    handle: "FFFFF",
    kind: "TEXT" as const,
    layer: "0",
    style: "Standard",
    at: [0, 0] as const,
    height: 1,
  };

  const texts = Array.from({ length: CENSUS_LIMIT }, () => text);
  const read = { ...whole, model: { ...whole.model, census: { ...whole.model.census, texts } } };

  const edit = editDrawing({ file: "firm.dxf", sha256: read.sha256, name: "rev-1" }, (e) =>
    e.model((d) => d.layer("A-NOTE", () => d.text([0, 0], "NOTE", { height: 1 }))),
  ).build(read);

  const census = editedRead(read, edit).model.census;
  assert.deepEqual([census.texts.length, census.capped], [CENSUS_LIMIT, true]);
});

test("a later edit takes each handle of an earlier one's record once, for the id its mark holds", async () => {
  const two = (e: EditBuilder) =>
    e.model((d) =>
      d.layer("A-NOTE", () => {
        d.line([0, 5], [10, 5], { id: "a" });
        d.line([0, 6], [10, 6], { id: "b" });
      }),
    );

  const first = await edited(firmFile(), "rev-1", two);
  const read = await geometry(first.out!);
  const [record] = read.edits!;
  const a = record!.additions.find((x) => x.id === "a")!.handle;

  const tampered = {
    ...read,
    edits: [
      {
        ...record!,
        additions: [
          { id: "a", handle: a },
          { id: "b", handle: a },
        ],
      },
    ],
  };

  const edit = editDrawing({ file: "firm.dxf", sha256: read.sha256, name: "rev-1" }, two).build(
    tampered,
  );

  assert.deepEqual([...replacement(tampered, edit).reuse.values()], [a]);
});

test("an addition on a layer that is off is a warning", async () => {
  const bytes = firmFile();
  const read = await geometry(bytes);

  const edit = editDrawing({ file: "firm.dxf", sha256: read.sha256, name: "rev-1" }, (e) =>
    e.model((d) => d.layer("A-OFF", () => d.line([0, 0], [1, 1]))),
  ).build(read);

  assert.deepEqual(
    lintEdit(edit, read).map((d) => [d.rule, d.severity]),
    [["edit-addition-layer", "warning"]],
  );
});

test("a role's styleName names the firm's style, and Standard is a firm's file's alone", () => {
  const standard = defineStandard({
    id: "firm",
    version: "1",
    extends: BUILT_IN_STANDARD,
    layers: { "A-NOTE": { color: 2, pen: "light" } },
    textRoles: {
      firm: { font: "Arial", height: 0.1, styleName: "ROMANS" },
      plain: { font: "Arial", height: 0.1, styleName: "Standard" },
    },
  });

  const sheet = (role: "firm" | "plain") => {
    const d = createDrawing({ standard, units: "in" });
    d.layout("S", {}, () => d.layer("A-NOTE", () => d.text([1, 1], "X", { role })));

    return d.build();
  };

  assert.deepEqual(sheet("firm").textStyles, [{ name: "ROMANS", font: "Arial" }]);
  assert.throws(() => sheet("plain"), /only an edit of a firm's file draws in it/);
});

/** A firm's file with two layouts, a block and its insert, and a leader style of its own. */
function sheets(): Uint8Array {
  const d = createDrawing({ units: "in" });
  d.layer("A-NOTE", { color: 2 }, () => d.line([0, 0], [100, 0]));
  d.block("TREE", {}, () => d.circle([0, 0], 2));
  d.layer("A-NOTE", () => d.insert("TREE", [5, 5]));
  d.layout("Sheet1", { paper: "ANSI B" }, () => {});
  d.layout("Sheet2", { paper: "ANSI B" }, () => {});

  return new TextEncoder().encode(toDXF(d.build()));
}

test("an id names one addition in all the spaces", async () => {
  const { errors } = await edited(sheets(), "rev", (e) => {
    e.model((m) => m.layer("A-NOTE", () => m.text([0, 10], "A", { height: 2, id: "x" })));
    e.layout("Sheet1", (p) =>
      p.layer("A-NOTE", () => p.text([1, 1], "B", { height: 0.1, id: "x" })),
    );
  });

  assert.deepEqual(
    errors.map((d) => d.rule),
    ["edit-addition"],
  );
});

test("an addition moved to another space by a later edit takes a new handle, and the old one goes", async () => {
  const first = await edited(sheets(), "rev", (e) =>
    e.model((m) => m.layer("A-NOTE", () => m.text([0, 10], "A", { height: 2, id: "x" }))),
  );

  const was = added(await geometry(first.out!))[0]!.handle;

  const second = await edited(first.out!, "rev", (e) =>
    e.layout("Sheet2", (p) =>
      p.layer("A-NOTE", () => p.text([1, 1], "A", { height: 0.1, id: "x" })),
    ),
  );

  const back = await geometry(second.out!);
  const sheet = back.layouts.find((l) => l.name === "Sheet2")!;
  assert.equal(added(back).length, 0);
  assert.notEqual(sheet.entities!.find((e) => e.mark?.id === "x")?.handle, was);
});

test("a leader style two spaces add is one, an insert of a block with no list of inserts adds none, and a later edit of an insert takes its block's list as the erasure left it", async () => {
  // A later edit uses the style as the file holds it then, and defines none.
  const draw = (define: boolean) => (e: EditBuilder) => {
    const style = { name: "NOTES", textHeight: 0.1, arrowSize: 0.1, landing: 0.2, gap: 0.05 };
    e.model((m) => {
      if (define) m.leaderStyle(style);
      m.layer("A-NOTE", () => {
        m.leader("M", { style: "NOTES", at: [10, 10], to: [5, 5] });
        m.insert("TREE", [20, 20], { id: "t1" });
      });
    });
    e.layout("Sheet1", (p) => {
      if (define) p.leaderStyle(style);
      p.layer("A-NOTE", () => p.leader("P", { style: "NOTES", at: [3, 3], to: [2, 2] }));
    });
  };

  const first = await edited(sheets(), "rev", draw(true));
  const back = await geometry(first.out!);
  assert.deepEqual((back.leaderStyles ?? []).filter((s) => s.name === "NOTES").length, 1);
  await edited(first.out!, "rev", draw(false));
});

test("two leader styles two spaces add, in a file with no dictionary of them, are both named in the one dictionary", async () => {
  const style = { textHeight: 0.1, arrowSize: 0.1, landing: 0.2, gap: 0.05 };

  const { out } = await edited(sheets(), "rev", (e) => {
    e.model((m) => {
      m.leaderStyle({ name: "NOTES", ...style });
      m.layer("A-NOTE", () => m.leader("M", { style: "NOTES", at: [10, 10], to: [5, 5] }));
    });
    e.layout("Sheet1", (p) => {
      p.leaderStyle({ name: "TAGS", ...style });
      p.layer("A-NOTE", () => p.leader("P", { style: "TAGS", at: [3, 3], to: [2, 2] }));
    });
  });

  const names = ((await geometry(out!)).leaderStyles ?? []).map((s) => s.name);
  assert.deepEqual(
    ["NOTES", "TAGS"].filter((n) => names.includes(n)),
    ["NOTES", "TAGS"],
  );
});

test("an image is refused among the additions", async () => {
  const { errors } = await edited(sheets(), "rev", (e) =>
    e.model((m) =>
      m.layer("A-NOTE", () => m.image("aerial.png", [0, 0], { pixels: [40, 30], width: 4 })),
    ),
  );

  assert.deepEqual(
    errors.map((d) => d.rule),
    ["edit-addition"],
  );
});

test("an addition with no id on a layout named layers is erased by an edit of its name that adds nothing", async () => {
  const d = createDrawing({ units: "in" });
  d.layer("A-NOTE", { color: 2 }, () => d.line([0, 0], [100, 0]));
  d.layout("layers", { paper: "ANSI B" }, () => {});
  const bytes = new TextEncoder().encode(toDXF(d.build()));

  const one = await edited(bytes, "rev", (e) =>
    e.layout("layers", (p) => p.layer("A-NOTE", () => p.line([1, 1], [2, 2]))),
  );

  const two = await edited(one.out!, "rev", (e) => e.model(() => {}));
  const back = await geometry(two.out!);

  assert.deepEqual(
    back.layouts.flatMap((l) => (l.entities ?? []).filter((e) => e.mark !== undefined)),
    [],
  );
});

test("a style of the file in a font tsdraft does not hold takes a paragraph, and refuses what tsdraft would lay out in it", async () => {
  const d = createDrawing({ units: "in" });
  d.textStyle({ name: "TB-TITLE", font: "Arial" });
  d.textStyle({ name: "CAPS", font: "romans.shx" });
  d.dimensionStyle({
    name: "TB-DIMS",
    textStyle: "TB-TITLE",
    textHeight: 2,
    arrowhead: "closed-filled",
    arrowSize: 1,
    extensionOffset: 0.5,
    extensionBeyond: 1,
    textGap: 0.5,
    scale: 1,
    precision: 1,
  });
  d.block("TAG", {}, () =>
    d.attribute("NO", [0, 0], { value: "1", height: 2, style: "TB-TITLE", align: "center" }),
  );
  d.layer("A-NOTE", { color: 2 }, () => d.line([0, 0], [100, 0]));

  // The file names Baskerville Old Face, and romans.shx in capitals, as an older file may.
  const bytes = new TextEncoder().encode(
    toDXF(d.build())
      .replace("\r\n3\r\narial.ttf\r\n", "\r\n3\r\nBASKVILL.TTF\r\n")
      .replace("\r\n1000\r\nArial\r\n", "\r\n1000\r\nBaskerville Old Face\r\n")
      .replace("\r\n3\r\nromans.shx\r\n", "\r\n3\r\nROMANS.SHX\r\n"),
  );

  const { errors, out } = await edited(bytes, "rev-1", (e) =>
    e.model((d) =>
      d.layer("A-NOTE", () => {
        d.paragraph("{\\LNOTE:}", { at: [0, 10], height: 2, style: "TB-TITLE", id: "head" });
        d.text([0, 20], "CAPS", { height: 2, style: "CAPS", align: "center", id: "caps" });
      }),
    ),
  );

  assert.deepEqual(errors, []);
  const back = await geometry(out!);

  assert.equal(back.textStyles.find((s) => s.name === "TB-TITLE")?.family, "Baskerville Old Face");
  const head = added(back).find((e) => e.mark?.id === "head");

  assert.equal(head?.kind === "mtext" && head.style, "TB-TITLE");

  type Builder = Parameters<Parameters<EditBuilder["model"]>[0]>[0];

  const refused = async (draw: (d: Builder) => void): Promise<string> =>
    (await edited(bytes, "rev-1", (e) => e.model((d) => d.layer("A-NOTE", () => draw(d)))))
      .errors[0]?.message ?? "";

  assert.match(
    await refused((d) =>
      d.text([0, 10], "NOTE", { height: 2, style: "TB-TITLE", align: "center" }),
    ),
    /justified text in the file's TB-TITLE/,
  );
  assert.match(
    await refused((d) => d.insert("TAG", [0, 0], { attributes: { NO: "WIDE VALUE" } })),
    /laid out by tsdraft in the file's text style TB-TITLE/,
  );
  assert.match(
    await refused((d) => d.linearDimension([0, 0], [8, 0], [0, -5], { style: "TB-DIMS" })),
    /laid out by tsdraft in the file's text style TB-TITLE/,
  );
  assert.match(
    await refused((d) => d.radiusDimension([0, 0], [3, 4], { style: "TB-DIMS" })),
    /laid out by tsdraft in the file's text style TB-TITLE/,
  );
  // A style and a block the edit defines itself are held to the same.
  assert.match(
    await refused((d) => {
      d.dimensionStyle({
        name: "NEW-DIMS",
        textStyle: "TB-TITLE",
        textHeight: 2,
        arrowhead: "closed-filled",
        arrowSize: 1,
        extensionOffset: 0.5,
        extensionBeyond: 1,
        textGap: 0.5,
        scale: 1,
        precision: 1,
      });
      d.linearDimension([0, 0], [8, 0], [0, -5], { style: "NEW-DIMS" });
    }),
    /laid out by tsdraft in the file's text style TB-TITLE/,
  );
  assert.match(
    await refused((d) => {
      d.block("SIGN", {}, () =>
        d.text([0, 0], "SIGN", { height: 2, style: "TB-TITLE", align: "center" }),
      );
      d.insert("SIGN", [0, 0]);
    }),
    /block SIGN the edit adds holds a justified text laid out by tsdraft in the file's text style TB-TITLE/,
  );
});

test("a mark is five strings of its format, and a record's addition an id and a handle", () => {
  const hash = "0123456789abcdef0123456789abcdef";
  assert.deepEqual(markOf(["1", "rev-1", "note", "1A3", hash]), {
    format: "1",
    name: "rev-1",
    id: "note",
    handle: "1A3",
    hash,
  });

  for (const values of [
    [1, undefined, {}, 255, null],
    ["1", "rev-1", "note", "1A3", hash, "more"],
    ["2", "rev-1", "note", "1A3", hash],
    ["1", "rev-1", "", "1A3", hash],
    ["1", "rev-1", "note", "", hash],
    ["1", "rev-1", "note", "not a handle", hash],
  ])
    assert.equal(markOf(values), undefined, JSON.stringify(values));

  const g = (code: number, value: string | number) => ({ code, value });
  assert.deepEqual(
    recordAdditions([
      g(1, "a"),
      g(2, " 01a3"),
      g(2, "1F"),
      g(1, "b"),
      g(2, ""),
      g(1, "c"),
      g(2, 7),
    ]),
    [{ id: "a", handle: "1A3" }],
  );
});
