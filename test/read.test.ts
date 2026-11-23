import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { test } from "node:test";
import kitchen from "../examples/outdoor-kitchen.ts";
import sheet from "../examples/site-plan.ts";
import {
  CENSUS_LIMIT,
  checkDrawingRead,
  createDrawing,
  leaderCount,
  readDXF,
  ReadError,
  toDXF,
  type ReadEntity,
} from "../src/index.ts";
import { costOf } from "../src/read/entities.ts";
import { inlineHeights, READ_LIMITS, readDXFDocument, readDXFWithin } from "../src/read/dxf.ts";
import { Sha256 } from "../src/sha256.ts";
import { readProblems } from "./read-agreement.ts";

const encoder = new TextEncoder();

/** A value as plain data, as JSON gives it: the read model's maps have no prototype. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

async function* chunks(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}

/** A DXF of groups, as `[code, value]` pairs, one per line pair, with CRLF as the leading CAD app writes. */
const dxf = (groups: readonly (readonly [number, string | number])[]): string =>
  groups.map(([code, value]) => `${String(code).padStart(3)}\r\n${value}\r\n`).join("");

const section = (
  name: string,
  ...records: (readonly (readonly [number, string | number])[])[]
): (readonly [number, string | number])[] => [
  [0, "SECTION"],
  [2, name],
  ...records.flat(),
  [0, "ENDSEC"],
];

test("readDXF reads what toDXF writes of the example sheet", async () => {
  const text = toDXF(sheet);
  const bytes = encoder.encode(text);
  const read = await readDXF(chunks(bytes, 4096));

  assert.deepEqual(checkDrawingRead(JSON.parse(JSON.stringify(read))), []);
  assert.equal(read.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(read.bytes, bytes.length);
  assert.equal(read.version, "AC1032");
  assert.equal(read.encoding, "utf-8");
  assert.equal(read.header.insunits, 2);
  assert.deepEqual(await readDXF(bytes), read);

  for (const layer of sheet.layers) {
    const got = read.layers.find((l) => l.name === layer.name);
    assert.ok(got, layer.name);
    assert.equal(got.plot, layer.plot !== false, layer.name);
  }
  for (const style of sheet.textStyles ?? []) {
    assert.ok(
      read.textStyles.some((s) => s.name === style.name),
      style.name,
    );
  }
  assert.ok(read.dimensionStyles.some((s) => s.name === "DIMS-1in-10ft" && s.scale === 10));

  const layout = sheet.layouts![0]!;
  assert.deepEqual(
    read.layouts.map((l) => l.name),
    [layout.name],
  );
  const [got] = read.layouts;
  assert.equal(got!.plotStyleTable, "monochrome.ctb");
  assert.equal(got!.viewports.length, layout.viewports.length);
  const viewport = layout.viewports[0]!;
  assert.ok(Math.abs(got!.viewports[0]!.ratio - 12 / viewport.ratio) < 1e-9);
  assert.deepEqual(got!.viewports[0]!.viewCenter, viewport.center);

  const titleBlock = got!.inserts.find((i) => i.block === "TITLE BLOCK");
  assert.ok(titleBlock);
  assert.ok(Object.values(titleBlock.tags).every(Boolean));
  const definition = read.blocks.find((b) => b.name === "TITLE BLOCK");
  assert.ok(
    definition && definition.attributeDefinitions.length === Object.keys(titleBlock.tags).length,
  );
  assert.ok(definition.entities.some((e) => e.kind === "text" && e.value !== ""));

  const model = sheet.entities.length;
  const counted = Object.values(read.model.census.layers)
    .flatMap((row) => Object.values(row.kinds))
    .reduce((a, b) => a + b, 0);
  assert.equal(counted, model);
  assert.equal(read.model.census.layers["C-ANNO-TEXT"]?.kinds.MULTILEADER, leaderCount(sheet));
  assert.deepEqual(plain(read.unread), { entities: {}, objects: {}, malformed: {} });
  // Without geometry a space holds its census alone, and no text of it is kept.
  assert.equal(read.model.entities, undefined);
  assert.ok(!JSON.stringify(read.layouts).includes("RESIDENCE AT LOT 12"));

  // The same file read from a string, or a byte at a time, reads the same.
  assert.deepEqual(await readDXF(text), read);
  assert.deepEqual(
    await readDXF(chunks(bytes.subarray(0, 300_000), 1)),
    await readDXF(chunks(bytes.subarray(0, 300_000), 65536)),
  );
});

test("readDXF reads an R12 file", async () => {
  const d = createDrawing({ units: "ft" });
  d.layer("C-PROP", { color: 3 }, () => d.line([0, 0], [10, 0]));
  const read = await readDXF(chunks(encoder.encode(toDXF(d.build(), { version: "R12" })), 4096));
  assert.equal(read.version, "AC1009");
  assert.equal(read.encoding, "windows-1252");
  assert.ok(read.layers.length > 0);
  assert.deepEqual(checkDrawingRead(read), []);
  // An R12 dimension holds no measurement, where a later file leaves out one of 1.
  const dimension = (version: string) =>
    readDXF(
      dxf([
        ...section("HEADER", [
          [9, "$ACADVER"],
          [1, version],
        ]),
        ...section("ENTITIES", [
          [0, "DIMENSION"],
          [8, "0"],
          [70, 0],
        ]),
        [0, "EOF"],
      ]),
      { geometry: true },
    );
  const measured = async (version: string) => {
    const [e] = (await dimension(version)).model.entities!;
    return e?.kind === "dimension" ? e.measurement : "none";
  };
  assert.equal(await measured("AC1009"), undefined);
  assert.equal(await measured("AC1032"), 1);
});

test("readDXF decodes text by $DWGCODEPAGE before the R2007 format, and as UTF-8 after", async () => {
  const file = (version: string, codepage: string, layer: Uint8Array): Uint8Array => {
    const head = encoder.encode(
      dxf([
        ...section("HEADER", [
          [9, "$ACADVER"],
          [1, version],
          [9, "$DWGCODEPAGE"],
          [3, codepage],
        ]),
        [0, "SECTION"],
        [2, "TABLES"],
        [0, "TABLE"],
        [2, "LAYER"],
        [0, "LAYER"],
        [5, "10"],
      ]) + "  2\r\n",
    );
    const tail = encoder.encode(
      "\r\n" +
        dxf([
          [70, 0],
          [0, "ENDTAB"],
          [0, "ENDSEC"],
          [0, "EOF"],
        ]),
    );
    return new Uint8Array([...head, ...layer, ...tail]);
  };
  const latin = await readDXF(chunks(file("AC1018", "ANSI_1252", new Uint8Array([0x43, 0xe9])), 7));
  assert.equal(latin.encoding, "windows-1252");
  assert.equal(latin.layers[0]?.name, "Cé");
  const greek = await readDXF(chunks(file("AC1015", "ANSI_1253", new Uint8Array([0xe1])), 3));
  assert.equal(greek.layers[0]?.name, "α");
  const utf8 = await readDXF(chunks(file("AC1032", "ANSI_1252", encoder.encode("Cé")), 5));
  assert.equal(utf8.encoding, "utf-8");
  assert.equal(utf8.layers[0]?.name, "Cé");
  const escaped = await readDXF(
    chunks(file("AC1015", "ANSI_1252", encoder.encode("A\\U+00B0")), 64),
  );
  assert.equal(escaped.layers[0]?.name, "A°");
});

test("readDXF refuses a binary DXF and groups out of step", async () => {
  await assert.rejects(
    readDXF(chunks(encoder.encode("AutoCAD Binary DXF\r\n\x1a\0rest"), 4)),
    (error) => error instanceof ReadError && /binary DXF/.test(error.message),
  );
  await assert.rejects(readDXF("  0\nSECTION\nHEADER\n  9\n"), ReadError);
  await assert.rejects(readDXF("  0\nSECTION\n  2"), /ends after group code "2"/);
  await assert.rejects(readDXF("  0\nSECTION\n  2\nHEADER\n  0\n"), /ends after group code "0"/);
  await assert.rejects(readDXF("1e1\nA\n"), /should hold a group code/);
  await assert.rejects(readDXF("0x0\nA\n"), /should hold a group code/);
  // A line too long is refused whether it arrives in one piece or in many.
  const long = encoder.encode(`999\n${"x".repeat(2 ** 21)}\n  0\nEOF\n`);
  for (const size of [long.length, 65536]) {
    await assert.rejects(readDXF(chunks(long, size)), /longer than/);
  }
  // What follows EOF is no part of the file, however it arrives.
  const after = encoder.encode(`  0\nEOF\n${"x".repeat(2 ** 20 + 1)}`);
  for (const size of [after.length, 65536]) {
    assert.equal((await readDXF(chunks(after, size))).bytes, after.length);
  }
});

/** A model space whose `MTEXT` shows a field, with what the reader does not know beside it. */
function fieldsFile(): string {
  return dxf([
    ...section("HEADER", [
      [9, "$ACADVER"],
      [1, "AC1032"],
    ]),
    ...section(
      "ENTITIES",
      [
        [0, "MTEXT"],
        [5, "A1"],
        [102, "{ACAD_XDICTIONARY"],
        [360, "D1"],
        [102, "}"],
        [8, "NOTES"],
        [62, 1],
        [370, 35],
        [10, 1],
        [20, 2],
        [40, 0.1],
        [41, 3],
        [3, "\\H0.2;big \\H1.5x;bigger \\\\H9; "],
        [1, "%<\\_FldIdx 0>%"],
      ],
      [
        [0, "SPLINE"],
        [5, "A2"],
        [8, "NOTES"],
      ],
      [
        [0, "OLE2FRAME"],
        [8, "NOTES"],
        [310, "00FF"],
      ],
    ),
    ...section(
      "OBJECTS",
      [
        [0, "DICTIONARY"],
        [5, "D1"],
        [3, "ACAD_FIELD"],
        [360, "D2"],
      ],
      [
        [0, "DICTIONARY"],
        [5, "D2"],
        [3, "TEXT"],
        [360, "F1"],
      ],
      [
        [0, "FIELD"],
        [5, "F1"],
        [100, "AcDbField"],
        [1, "_text"],
        [2, "%<\\_FldIdx 0>% %<\\_FldIdx 1>%"],
        [90, 2],
        [360, "F2"],
        [360, "F3"],
      ],
      [
        [0, "FIELD"],
        [5, "F2"],
        [100, "AcDbField"],
        [1, "AcVar"],
        [2, '\\AcVar Filename \\f "%fn2"'],
      ],
      [
        [0, "FIELD"],
        [5, "F3"],
        [100, "AcDbField"],
        [1, "AcVar"],
        [2, "\\AcVar SaveDate"],
      ],
      [[0, "ACAD_PROXY_OBJECT"]],
    ),
    [0, "EOF"],
  ]);
}

test("readDXF keeps fields, the heights MTEXT sets, and counts what it does not know", async () => {
  const read = await readDXF(fieldsFile());
  assert.deepEqual(checkDrawingRead(read), []);
  assert.deepEqual(
    read.fields.map((f) => [f.code, f.text.handle, f.text.width]),
    [['\\AcVar Filename \\f "%fn2"', "A1", 3]],
  );
  assert.deepEqual(plain(read.otherFields), { "\\AcVar SaveDate": 1 });
  const [text] = read.model.census.texts;
  assert.deepEqual(text?.inlineHeights, [0.2, 0.30000000000000004]);
  assert.deepEqual(plain(read.model.census.layers.NOTES), {
    kinds: { MTEXT: 1, SPLINE: 1, OLE2FRAME: 1 },
    ownColor: 1,
    ownLinetype: 0,
    ownLineweight: 1,
    lineweights: { "35": 1 },
  });
  assert.deepEqual(plain(read.unread.entities), { OLE2FRAME: 1 });
  assert.deepEqual(plain(read.unread.objects), { ACAD_PROXY_OBJECT: 1 });
  // No text value of model space is kept.
  assert.ok(!JSON.stringify(read).includes("big"));
});

test("readDXF lists at most CENSUS_LIMIT texts of a space and counts the rest", async () => {
  const d = createDrawing({ units: "ft" });
  d.text([0, 0], "A", { height: 1 });
  const text = toDXF(d.build());
  // The section holds the one text, so its groups are the text's record.
  const start = text.indexOf("\nENTITIES\r\n") + "\nENTITIES\r\n".length;
  const end = text.indexOf("\n0\r\nENDSEC\r\n", start) + 1;
  const record = text.slice(start, end);
  const n = CENSUS_LIMIT + 5;
  async function* many(): AsyncGenerator<Uint8Array> {
    yield encoder.encode(text.slice(0, start));
    const batch = encoder.encode(record.repeat(10_000));
    for (let i = 0; i < n; i += 10_000) {
      yield i + 10_000 <= n ? batch : encoder.encode(record.repeat(n - i));
    }
    yield encoder.encode(text.slice(end));
  }
  const read = await readDXF(many());
  assert.equal(read.model.census.counts.texts, n);
  assert.equal(read.model.census.texts.length, CENSUS_LIMIT);
  assert.equal(read.model.census.capped, true);
  assert.equal(read.model.census.layers["0"]?.kinds.TEXT, n);
});

test("checkDrawingRead names what is wrong with an answer", async () => {
  const read = (await readDXF(fieldsFile())) as unknown as Record<string, unknown>;
  assert.deepEqual(checkDrawingRead({ ...read, format: 1 }), [
    "format is 1, and this version of tsdraft reads format 0",
  ]);
  assert.deepEqual(checkDrawingRead({ ...read, layers: [{ name: 3 }] }).slice(0, 2), [
    "layers[0].name must be a string",
    "layers[0].on is missing",
  ]);
  assert.deepEqual(checkDrawingRead({ ...read, extra: 1 }), ['"extra" is not a field']);
  assert.equal(checkDrawingRead(null)[0], "the read must be a plain object");
  assert.equal(checkDrawingRead({ ...read, blocks: Array.from({ length: 100 }) }).length, 20);
});

test("Sha256 gives the same digest whatever the chunks", () => {
  const bytes = new Uint8Array(1000).map((_, i) => (i * 7) & 255);
  const whole = createHash("sha256").update(bytes).digest("hex");
  for (const size of [1, 55, 56, 63, 64, 65, 999]) {
    const hash = new Sha256();
    for (let i = 0; i < bytes.length; i += size) hash.update(bytes.subarray(i, i + size));
    assert.equal(hash.digest(), whole, String(size));
  }
});

for (const geometry of [false, true]) {
  test(
    `readDXF reads a file of more than 500 MB within the limits of a read${geometry ? ", with geometry" : ""}`,
    { timeout: 130_000 },
    () => {
      // The read runs as the command runs one: in a process with a heap of 2 GB, for 120 s.
      const script = join(import.meta.dirname, "read-large.ts");
      // Under prlimit, as the command runs it, an abort leaves no core.
      const node = [
        process.execPath,
        "--max-old-space-size=2048",
        script,
        ...(geometry ? ["--geometry"] : []),
      ];
      const prlimit = spawnSync("prlimit", ["--version"]).status === 0;
      const [command, ...args] = prlimit ? ["prlimit", "--core=1:1", "--", ...node] : node;
      const run = spawnSync(command!, args, {
        encoding: "utf8",
        timeout: 120_000,
      });
      assert.equal(run.signal, null, "the read ran past 120 s or was killed");
      assert.equal(run.status, 0, run.stderr);
      const { bytes, capped, heap, answer, kept, past } = JSON.parse(run.stdout) as Record<
        string,
        number
      >;
      assert.ok(bytes! > 500e6);
      assert.equal(capped, true);
      // With geometry, model space keeps what GEOMETRY_ITEMS holds and counts the rest.
      assert.equal(kept! > 0 && past! > 0, geometry);
      assert.ok(heap! < 1024 ** 3, `the heap reached ${Math.round(heap! / 1e6)} MB`);
      // The command takes an answer of up to 128 MB of JSON.
      assert.ok(answer! < 128 * 1024 ** 2, `the answer is ${Math.round(answer! / 1e6)} MB`);
    },
  );
}

test("readDXF reads a string as UTF-8 whatever its header says", async () => {
  const text = dxf([
    ...section("HEADER", [
      [9, "$ACADVER"],
      [1, "AC1015"],
      [9, "$DWGCODEPAGE"],
      [3, "ANSI_1252"],
    ]),
    ...section(
      "TABLES",
      [
        [0, "TABLE"],
        [2, "LAYER"],
      ],
      [
        [0, "LAYER"],
        [2, "Café"],
        [70, 0],
      ],
      [[0, "ENDTAB"]],
    ),
    [0, "EOF"],
  ]);
  const read = await readDXF(text);
  assert.equal(read.encoding, "utf-8");
  assert.equal(read.layers[0]?.name, "Café");
  // A piece of the string never ends inside a surrogate pair.
  const long = "999\r\n" + "x".repeat((1 << 20) - 6) + "😀\r\n" + text;
  const both = await readDXF(long);
  assert.equal(both.sha256, createHash("sha256").update(long).digest("hex"));
});

test("readDXF takes any layer name, places mirrored entities in the world, and skips a broken number", async () => {
  const read = await readDXF(
    dxf([
      ...section(
        "BLOCKS",
        [
          [0, "BLOCK"],
          [2, "B"],
          [70, 0],
          [10, 0],
          [20, 0],
        ],
        [
          [0, "ARC"],
          [8, "constructor"],
          [10, 5],
          [20, 0],
          [40, 1],
          [50, 0],
          [51, 90],
          [230, -1],
        ],
        [
          [0, "INSERT"],
          [8, "__proto__"],
          [2, "C"],
          [10, 2],
          [20, 3],
          [41, 2],
          [50, 30],
          [230, -1],
        ],
        [
          [0, "LWPOLYLINE"],
          [8, "0"],
          [10, 0],
          [20, 0],
          [10, "1.#QNAN"],
          [20, 1],
        ],
        [
          [0, "CIRCLE"],
          [8, "0"],
          [10, 0],
          [20, 0],
          [40, 1],
          [210, 1],
          [230, 0],
        ],
        [
          [0, "TEXT"],
          [8, "0"],
          [10, 2],
          [20, 3],
          [40, 1],
          [1, "A"],
          [230, -1],
        ],
        [[0, "ENDBLK"]],
      ),
      ...section("ENTITIES", [
        [0, "LINE"],
        [8, "toString"],
        [10, 0],
        [20, 0],
        [11, 1],
        [21, 1],
      ]),
      [0, "EOF"],
    ]),
  );
  assert.deepEqual(checkDrawingRead(read), []);
  const [block] = read.blocks;
  assert.deepEqual(plain(block?.entities), [
    { kind: "arc", layer: "constructor", center: [-5, 0], radius: 1, start: 90, end: 180 },
    {
      kind: "insert",
      layer: "__proto__",
      block: "C",
      at: [-2, 3],
      scale: [-2, 1],
      rotation: 330,
      tags: {},
    },
    // Seen from below, a text reads backward and turns the other way.
    {
      kind: "text",
      layer: "0",
      at: [-2, 3],
      startFrom: "file",
      stored: [-2, 3],
      height: 1,
      rotation: 0,
      style: "Standard",
      backward: true,
      value: "A",
    },
  ]);
  assert.deepEqual(plain(block?.other), { "CIRCLE in 3D": 1 });
  assert.deepEqual(plain(read.unread.malformed), {
    "LWPOLYLINE with a number that is not finite": 1,
  });
  assert.equal(
    Object.getOwnPropertyDescriptor(read.model.census.layers, "toString")?.value.kinds.LINE,
    1,
  );
});

test("readDXF reads the paper space of an R12 file as the layout Layout1", async () => {
  const read = await readDXF(
    dxf([
      ...section("HEADER", [
        [9, "$ACADVER"],
        [1, "AC1009"],
      ]),
      ...section(
        "ENTITIES",
        [
          [0, "VIEWPORT"],
          [8, "0"],
          [67, 1],
          [10, 5],
          [20, 4],
          [40, 10],
          [41, 8],
          [68, 1],
          [69, 2],
        ],
        [
          [0, "TEXT"],
          [8, "0"],
          [67, 1],
          [10, 1],
          [20, 1],
          [40, 0.2],
          [1, "A"],
        ],
      ),
      [0, "EOF"],
    ]),
  );
  assert.deepEqual(
    read.layouts.map((l) => [l.name, l.viewports.length, l.census.counts.texts]),
    [["Layout1", 1, 1]],
  );
  assert.deepEqual(plain(read.unread.malformed), {});
});

test("readDXF finds an entity's owner outside its reactors", async () => {
  const read = await readDXF(
    dxf([
      ...section(
        "TABLES",
        [
          [0, "TABLE"],
          [2, "BLOCK_RECORD"],
        ],
        [
          [0, "BLOCK_RECORD"],
          [5, "A"],
          [2, "*Paper_Space"],
        ],
        [
          [0, "BLOCK_RECORD"],
          [5, "B"],
          [2, "*Paper_Space0"],
        ],
        [[0, "ENDTAB"]],
      ),
      ...section(
        "ENTITIES",
        [
          [0, "TEXT"],
          [5, "T"],
          [102, "{ACAD_REACTORS"],
          [330, "A"],
          [102, "}"],
          [330, "B"],
          [67, 1],
          [8, "0"],
          [40, 1],
          [1, "X"],
        ],
        [
          [0, "LINE"],
          [102, "{ACAD_REACTORS"],
          [330, "A"],
          [102, "}"],
          [330, "B"],
          [67, 1],
          [8, "0"],
        ],
      ),
      ...section(
        "OBJECTS",
        ...["A", "B"].map((record, i) => [
          [0, "LAYOUT"] as const,
          [5, `L${i}`] as const,
          [100, "AcDbLayout"] as const,
          [1, `S${i}`] as const,
          [71, i + 1] as const,
          [330, record] as const,
        ]),
      ),
      [0, "EOF"],
    ]),
  );
  assert.deepEqual(
    read.layouts.map((l) => [l.name, l.census.counts.texts, Object.keys(l.census.layers)]),
    [
      ["S0", 0, []],
      ["S1", 1, ["0"]],
    ],
  );
});

test("readDXF decodes the DOS code pages, and keeps MTEXT heights to their scopes", async () => {
  for (const page of ["DOS437", "DOS850"]) {
    const head = encoder.encode(
      dxf([
        ...section("HEADER", [
          [9, "$ACADVER"],
          [1, "AC1015"],
          [9, "$DWGCODEPAGE"],
          [3, page],
        ]),
        [0, "SECTION"],
        [2, "TABLES"],
        [0, "LAYER"],
      ]) + "  2\r\nCaf",
    );
    const tail = encoder.encode(
      "\r\n" +
        dxf([
          [0, "ENDSEC"],
          [0, "EOF"],
        ]),
    );
    const read = await readDXF(chunks(new Uint8Array([...head, 0x82, ...tail]), 16));
    assert.equal(read.layers[0]?.name, "Café", page);
  }
  assert.deepEqual(inlineHeights("{\\H2x;A}{\\H2x;B}\\{\\H3;", 1), [2, 2, 3]);
  assert.deepEqual(inlineHeights("\\H1e308x;\\H2x;\\H0.5;", 1), [1e308, 0.5]);
});

test("readDXF reads the widths of a polyline's sides, and leaves out widths of 0", async () => {
  const polyline = (widths: [number, number | string][]) => [
    [0, "LWPOLYLINE"] as const,
    [8, "0"] as const,
    [10, 0] as const,
    [20, 0] as const,
    ...widths,
    [10, 1] as const,
    [20, 0] as const,
  ];
  const read = await readDXF(
    dxf([
      ...section(
        "BLOCKS",
        [
          [0, "BLOCK"],
          [2, "B"],
        ],
        polyline([
          [40, 0],
          [41, 0],
        ]),
        polyline([[41, 0.5]]),
        [[0, "ENDBLK"]],
      ),
      [0, "EOF"],
    ]),
  );
  const [zero, wide] = read.blocks[0]?.entities ?? [];
  assert.equal(zero?.kind === "polyline" && zero.widths, undefined);
  assert.deepEqual(wide?.kind === "polyline" && wide.widths, [[0, 0.5]]);
  assert.deepEqual(plain(read.blocks[0]?.other), {});
});

test("readDXF counts an entity the file marks invisible, in a block and in a space, and hides such an attribute", async () => {
  const hidden = (type: string): (readonly [number, string | number])[] => [
    [0, type],
    [8, "0"],
    [60, 1],
    [10, 0],
    [20, 0],
    [11, 1],
    [21, 0],
  ];
  const read = await readDXF(
    dxf([
      ...section(
        "BLOCKS",
        [
          [0, "BLOCK"],
          [2, "B"],
        ],
        hidden("LINE"),
        hidden("HATCH"),
        [[0, "ENDBLK"]],
      ),
      ...section(
        "ENTITIES",
        hidden("LINE"),
        [
          [0, "INSERT"],
          [8, "0"],
          [60, 1],
          [2, "B"],
        ],
        [
          [0, "INSERT"],
          [8, "0"],
          [2, "B"],
          [66, 1],
        ],
        [
          [0, "ATTRIB"],
          [8, "0"],
          [60, 1],
          [10, 0],
          [20, 0],
          [40, 1],
          [1, "V"],
          [2, "TAG"],
          [70, 0],
        ],
        [[0, "SEQEND"]],
        [
          [0, "ATTDEF"],
          [8, "0"],
          [60, 1],
          [10, 0],
          [20, 0],
          [40, 1],
          [1, ""],
          [2, "TAG"],
          [70, 0],
        ],
      ),
      [0, "EOF"],
    ]),
    { geometry: true },
  );
  assert.deepEqual(read.blocks[0]?.entities, []);
  assert.deepEqual(plain(read.blocks[0]?.other), { invisible: 2 });
  const [insert] = read.model.entities ?? [];
  assert.equal(insert?.kind === "insert" && insert.attributes?.[0]?.invisible, true);
  assert.equal(read.model.entities?.length, 1);
  assert.deepEqual(plain(read.model.other), { invisible: 3 });
  assert.deepEqual(plain(read.model.census.layers["0"]?.kinds), { LINE: 1, INSERT: 2, ATTDEF: 1 });
});

test("checkDrawingRead takes no hole or getter for a value", async () => {
  const read = (await readDXF(fieldsFile())) as unknown as Record<string, unknown>;
  const text = (read.model as { census: { texts: Record<string, unknown>[] } }).census.texts[0]!;
  const holed = { ...text, at: new Array(2) };
  const got = { ...text, at: [1, 2] };
  Object.defineProperty(got.at, 0, {
    get() {
      throw new Error("read");
    },
  });
  const extra = Object.assign([1, 2], { toJSON: () => "" });
  for (const at of [holed, got, { ...text, at: extra }]) {
    const model = { census: { ...(read.model as { census: object }).census, texts: [at] } };
    assert.deepEqual(checkDrawingRead({ ...read, model }), [
      "model.census.texts[0].at must be two finite numbers",
    ]);
  }
});

test("readDXF stops at EOF, keeps a field once, and leaves out a viewport past the doubles", async () => {
  const fields = fieldsFile().replace(/  0\r\nEOF\r\n$/, "");
  const twice = fields.replace(
    "  0\r\nSECTION\r\n  2\r\nOBJECTS",
    dxf([
      [0, "MTEXT"],
      [5, "A3"],
      [102, "{ACAD_XDICTIONARY"],
      [360, "D1"],
      [102, "}"],
      [8, "0"],
      [10, 0],
      [20, 0],
      [40, 1],
      [1, "x"],
      [0, "ENDSEC"],
    ]) + "  0\r\nSECTION\r\n  2\r\nOBJECTS",
  );
  const read = await readDXF(
    twice.replace("  0\r\nENDSEC\r\n  0\r\nENDSEC", "  0\r\nENDSEC") + "  0\r\nEOF\r\n\x1a",
  );
  assert.equal(read.fields.length, 1);
  const viewport = await readDXF(
    dxf([
      ...section("ENTITIES", [
        [0, "VIEWPORT"],
        [8, "0"],
        [67, 1],
        [41, 1e300],
        [45, 1e-300],
      ]),
      [0, "EOF"],
    ]) + "\x1a",
  );
  assert.deepEqual(plain(viewport.unread.malformed), {
    "VIEWPORT with a number past the doubles": 1,
  });
  assert.deepEqual(viewport.layouts[0]?.viewports, []);
});

test("readDXF with geometry gives back every entity of both examples", async () => {
  for (const drawing of [sheet, kitchen]) {
    const read = await readDXF(chunks(encoder.encode(toDXF(drawing)), 65536), { geometry: true });
    assert.deepEqual(checkDrawingRead(plain(read)), []);
    assert.deepEqual(readProblems(drawing, read, "tsdraft"), []);
  }
  const read = await readDXF(toDXF(sheet), { geometry: true });
  // Each dimension names the block of its picture, which a read with geometry keeps.
  const dimensions = read.model.entities!.filter((e) => e.kind === "dimension");
  assert.equal(dimensions.length, 7);
  for (const dimension of dimensions) {
    const picture = read.blocks.find((b) => b.handle === dimension.blockHandle);
    assert.equal(picture?.name, dimension.block);
    const kinds = new Set(picture!.entities.map((e) => e.kind));
    assert.ok(kinds.has("line") && kinds.has("mtext"), [...kinds].join());
  }
  assert.deepEqual(read.opensAt, { layout: "C-101", center: [18, 12], height: 26.4, width: 42.24 });
});

test("readDXF with geometry reads each table as its Table, with its style and its picture", async () => {
  const d = createDrawing({ units: "in" });
  d.textStyle({ name: "ARIALS", font: "Arial" });
  d.block("TAG", {}, () => d.circle([0, 0], 0.2));
  d.tableStyle({ name: "PLAIN", textHeight: 0.18, title: { textHeight: 0.25 } });
  d.tableStyle({
    name: "SCHED",
    textStyle: "ARIALS",
    textHeight: 0.1,
    horizontalMargin: 0.05,
    header: { fill: 8, lineweight: 0.35, color: 5 },
    data: { align: "left", valign: "middle" },
  });
  d.table({
    style: "PLAIN",
    at: [1, 10],
    columns: [0.6, 1.1, 1.6],
    title: "DOOR SCHEDULE",
    header: ["MARK", { text: "SIZE", columnSpan: 2 }, null],
    rows: [
      [{ text: "D1", rowSpan: 2 }, { block: "TAG" }, { block: "TAG", blockScale: 0.5 }],
      [
        null,
        { text: "{\\C1;RED}", fill: 3, color: 2 },
        { text: "", textHeight: 0.3, align: "right" },
      ],
    ],
    rowHeights: [0.5, null],
  });
  d.table({ style: "SCHED", at: [6, 10], rotation: 30, columns: [1, 1], rows: [["A", "B"]] });
  d.layout("SHEET", { paper: "ANSI B" }, () => {
    d.table({ style: "SCHED", at: [1, 8], columns: [2], title: "LONE", header: ["H"], rows: [] });
  });
  const drawing = d.build();
  const read = await readDXF(toDXF(drawing), { geometry: true });
  assert.deepEqual(checkDrawingRead(plain(read)), []);
  assert.deepEqual(readProblems(drawing, read, "tsdraft"), []);
  assert.deepEqual(
    read.tableStyles.map((s) => s.name),
    ["Standard", "PLAIN", "SCHED"],
  );
  // Without geometry no table is kept, and neither is its picture.
  const plainRead = await readDXF(toDXF(drawing));
  assert.equal(plainRead.blocks.filter((b) => b.name.startsWith("*T")).length, 0);
  assert.equal(plainRead.tableStyles.length, 3);
});

test("readDXF counts a table past the core's limits or a read's, and never lists it", async () => {
  type Pairs = (readonly [number, string | number])[];
  const cell = (text: string): Pairs => [
    [171, 1],
    [175, 1],
    [176, 1],
    [91, 0],
    [301, "CELL_VALUE"],
    [1, text],
    [304, "ACVALUE_END"],
  ];
  const table = (rows: number, columns: number, cells: Pairs = [], heights = rows): Pairs => [
    [0, "ACAD_TABLE"],
    [8, "0"],
    [100, "AcDbBlockReference"],
    [2, "*T1"],
    [100, "AcDbTable"],
    [280, 0],
    [91, rows],
    [92, columns],
    ...Array.from({ length: heights }, (): [number, number] => [141, 0.3]),
    ...Array.from({ length: Math.min(columns, 2000) }, (): [number, number] => [142, 1]),
    ...cells,
  ];
  const read = await readDXFWithin(
    dxf([
      ...section(
        "ENTITIES",
        table(1, 1001),
        table(400, 400, [], 0),
        table(2000, 0),
        table(2, 1, cell("ONE")),
        table(1, 1, cell("X".repeat(32 * 1100))),
        table(1, 1, cell("A")),
      ),
      [0, "EOF"],
    ]),
    { geometry: true },
    { ...READ_LIMITS, geometryItems: 1000 },
  );
  assert.deepEqual(plain(read.model.other), {
    "ACAD_TABLE of more than 1000 columns": 1,
    "ACAD_TABLE of more than 100000 cells": 1,
    "ACAD_TABLE of more than 1000 rows": 1,
    "past the limit": 1,
  });
  assert.deepEqual(plain(read.unread.malformed), {
    "ACAD_TABLE whose rows, columns or cells are not as many as it says": 1,
  });
  assert.deepEqual(plain(read.model.entities), [
    {
      layer: "0",
      kind: "table",
      at: [0, 0],
      direction: [1, 0],
      rows: [0.3],
      columns: [1],
      title: true,
      header: false,
      cells: [{ row: 0, column: 0, rowSpan: 1, columnSpan: 1, text: "A" }],
      block: "*T1",
    },
  ]);
});

test("readDXF gives back a text that holds the leading CAD app's escapes as toDXF wrote it", async () => {
  const d = createDrawing({ units: "in" });
  d.leaderStyle({ name: "NOTE", textHeight: 0.125, arrowSize: 0.125, landing: 0.125, gap: 0.0625 });
  const values = ["\\U+00B0", "\\M+18140", "a^b ^J", "\\U+005CU+00B0", "%%d \\P", "\\\\U+0041"];
  values.forEach((value, i) => d.text([0, i], value, { height: 0.1 }));
  // A leader's note holds no backslash, so it holds no escape but a caret's.
  d.leader(["a^b", "%%d ^J"], { style: "NOTE", at: [5, 5], to: [0, 0] });
  const drawing = d.build();
  const read = await readDXF(toDXF(drawing), { geometry: true });
  assert.deepEqual(readProblems(drawing, read, "tsdraft"), []);
});

test("readDXF holds a text as the leading CAD app does from a DXF", async () => {
  const record = (type: string, value: string): (readonly [number, string | number])[] => [
    [0, type],
    [8, "0"],
    [10, 0],
    [20, 0],
    [40, 1],
    [1, value],
  ];
  // A text is decoded twice, with \M+NXXXX in the second pass; a paragraph text once.
  const cases: [string, string, string][] = [
    ["TEXT", "\\U+005CU+00B0", "°"],
    ["TEXT", "\\U+005CU+005CU+00B0", "\\U+00B0"],
    ["TEXT", "\\U+005CM+18140", "　"],
    ["TEXT", "\\M+1ABCD", "\\M+1ABCD"],
    ["TEXT", "\\U+0000\\U+0041", "\\U+0000A"],
    ["TEXT", "\\U+D800x", "�x"],
    ["TEXT", "a^ b^J", "a^b\n"],
    ["TEXT", "\\M+28140 \\M+3B0A1 \\M+58140", " 가 丂"],
    // A code page the platform has no decoder for leaves its escape, but for ASCII.
    ["TEXT", "\\M+4005C \\M+4A140", "\\ \\M+4A140"],
    ["MTEXT", "\\U+005CU+00B0", "\\U+00B0"],
    ["MTEXT", "\\M+1005CM+18140", "\\M+18140"],
  ];
  const read = await readDXF(
    dxf([...section("ENTITIES", ...cases.map(([type, value]) => record(type, value))), [0, "EOF"]]),
    { geometry: true },
  );
  assert.deepEqual(
    read.model.entities!.map((e) => (e.kind === "text" || e.kind === "mtext" ? e.value : e.kind)),
    cases.map(([, , held]) => held),
  );
});

test("readDXF works a justified text's start out from the widths where they are exact", async () => {
  const d = createDrawing({ units: "in" });
  d.textStyle({ name: "A", font: "Arial" });
  d.textStyle({ name: "R", font: "romans.shx", widthFactor: 0.8 });
  d.text([100, 0], "~", { height: 2, style: "A", align: "right" });
  d.text([100, 15], "X", { height: 2, style: "A", align: "center", valign: "middle" });
  d.text([100, 20], "~", { height: 2, style: "R", align: "right" });
  d.text([100, 30], "!~¡ÿ", { height: 2, style: "R", align: "right", valign: "top" });
  // A space at an end, a control code, or a character outside the widths: no exact layout.
  d.text([100, 40], " X", { height: 2, align: "center" });
  d.text([100, 50], "%%d", { height: 2, align: "right" });
  d.text([100, 60], "日本", { height: 2, align: "right" });
  d.text([100, 70], "LEFT", { height: 2 });
  const read = await readDXF(toDXF(d.build()), { geometry: true });
  const texts = read.model.entities!.filter((e) => e.kind === "text");
  // Where a right-justified or centered text starts in each font, as it plots.
  const starts: [number, number][] = [
    [98.36834924965893, 0],
    [99.06821282401091, 14],
    [98.32380952380953, 20],
    [95.2, 28],
  ];
  starts.forEach(([x, y], i) => {
    assert.equal(texts[i]!.startFrom, "widths");
    assert.ok(Math.hypot(texts[i]!.at[0] - x, texts[i]!.at[1] - y) < 1e-9, `${texts[i]!.at}`);
  });
  for (const text of texts.slice(4, 7)) {
    assert.equal(text.startFrom, "alignment");
    assert.deepEqual(text.at, text.alignAt);
  }
  assert.equal(texts[7]!.startFrom, "file");
  // A file that holds the start apart from the alignment point, as the leading CAD app's does, gives it.
  const saved = await readDXF(
    dxf([
      ...section("ENTITIES", [
        [0, "TEXT"],
        [8, "0"],
        [10, 86.814461],
        [20, 49],
        [40, 1],
        [1, "WWWWWWWWWW"],
        [72, 2],
        [11, 100],
        [21, 50],
        [100, "AcDbText"],
        [73, 3],
      ]),
      [0, "EOF"],
    ]),
    { geometry: true },
  );
  assert.deepEqual(plain(saved.model.entities), [
    {
      kind: "text",
      layer: "0",
      at: [86.814461, 49],
      startFrom: "file",
      stored: [86.814461, 49],
      alignAt: [100, 50],
      height: 1,
      rotation: 0,
      style: "Standard",
      align: "right",
      valign: "top",
      value: "WWWWWWWWWW",
    },
  ]);
});

test("readDXF keeps the pen an entity sets itself, and counts what it reads only in part", async () => {
  const line = (more: (readonly [number, string | number])[]) =>
    [[0, "LINE"], [8, "A"], ...more, [10, 0], [20, 0], [11, 1], [21, 1]] as const;
  const read = await readDXF(
    dxf([
      ...section("HEADER", [
        [9, "$TILEMODE"],
        [70, 1],
      ]),
      ...section("TABLES", [
        [0, "TABLE"],
        [2, "VPORT"],
        [0, "VPORT"],
        [2, "*Active"],
        [12, 5],
        [22, 6],
        [17, 1],
        [27, 1],
        [40, 10],
        [41, 1.5],
        [0, "ENDTAB"],
      ]),
      ...section(
        "ENTITIES",
        line([
          [6, "DASHED"],
          [62, 0],
          [420, 0xff0000],
          [370, 35],
          [48, 2.5],
        ]),
        line([
          [6, "BYLAYER"],
          [62, 256],
          [370, -1],
          [48, 1],
        ]),
        // An ordinate drawn in a turned coordinate system.
        [
          [0, "DIMENSION"],
          [8, "A"],
          [70, 38],
          [51, 330],
        ],
        [
          [0, "MULTILEADER"],
          [8, "A"],
          [300, "CONTEXT_DATA{"],
          [290, 1],
          [11, 1],
          [21, 0],
          [31, 0],
          [301, "}"],
        ],
        [
          [0, "LINE"],
          [8, "A"],
          [10, "1e999"],
        ],
        // The leading CAD app leaves out a measurement of 1, and a rotation may be any number. It
        // reads an MTEXT's group 50 as degrees.
        [
          [0, "DIMENSION"],
          [8, "A"],
          [70, 32],
        ],
        [
          [0, "MTEXT"],
          [8, "A"],
          [50, "1e308"],
          [1, "M"],
        ],
        [
          [0, "MTEXT"],
          [8, "A"],
          [50, "390"],
          [1, "M"],
        ],
      ),
      [0, "EOF"],
    ]),
    { geometry: true },
  );
  assert.deepEqual(checkDrawingRead(plain(read)), []);
  const [own, plainLine, dimension, mtext, turned] = read.model.entities!;
  assert.equal(dimension?.kind === "dimension" && dimension.measurement, 1);
  assert.ok(mtext?.kind === "mtext" && mtext.rotation >= 0 && mtext.rotation < 360);
  assert.equal(turned?.kind === "mtext" && turned.rotation, 30);
  assert.deepEqual(
    [own?.linetype, own?.color, own?.trueColor, own?.lineweight, own?.linetypeScale],
    ["DASHED", 0, 0xff0000, 35, 2.5],
  );
  assert.deepEqual(Object.keys(plain(plainLine) as object).sort(), ["from", "kind", "layer", "to"]);
  assert.deepEqual(plain(read.model.other), {
    "DIMENSION ordinate in a turned coordinate system": 1,
    "MULTILEADER in 3D": 1,
  });
  assert.deepEqual(plain(read.unread.malformed), { "LINE with a number that is not finite": 1 });
  assert.deepEqual(read.opensAt, { center: [6, 7], height: 10, width: 15 });
});

test("readDXF keeps what the spaces draw within GEOMETRY_ITEMS and counts the rest", async () => {
  const items = 400;
  const read = await readDXFWithin(
    toDXF(kitchen),
    { geometry: true },
    { ...READ_LIMITS, geometryItems: items },
  );
  const cost = (entities: readonly ReadEntity[]) => entities.reduce((sum, e) => sum + costOf(e), 0);
  const kept = read.model.entities!;
  assert.ok(kept.length > 0 && cost(kept) <= items, `${cost(kept)}`);
  assert.equal(kept.length + read.model.other!["past the limit"]!, kitchen.entities.length);
  // The census counts every entity whatever the geometry keeps.
  const counted = Object.values(read.model.census.layers)
    .flatMap((row) => Object.values(row.kinds))
    .reduce((a, b) => a + b, 0);
  assert.equal(counted, kitchen.entities.length);
  // A multileader's styles are named once the file is read, and charged then: one that no
  // longer fits is left out.
  const d = createDrawing({ units: "in" });
  const style = "S".repeat(200);
  d.leaderStyle({ name: style, textHeight: 0.125, arrowSize: 0.125, landing: 0.125, gap: 0.0625 });
  d.leader("NOTE", { style, at: [5, 5], to: [0, 0] });
  const file = toDXF(d.build());
  const whole = (await readDXF(file, { geometry: true })).model.entities!;
  assert.equal(whole[0]?.kind === "multileader" && whole[0].style, style);
  const full = costOf(whole[0]!);
  for (const [most, kept] of [
    [full, 1],
    [full - 1, 0],
  ] as const) {
    const read = await readDXFWithin(
      file,
      { geometry: true },
      { ...READ_LIMITS, geometryItems: most },
    );
    assert.equal(read.model.entities!.length, kept, `${most}`);
    assert.equal(read.model.other!["past the limit"] ?? 0, 1 - kept);
  }

  // The blocks keep BLOCK_ITEMS of their own.
  const blocked = await readDXFWithin(toDXF(sheet), {}, { ...READ_LIMITS, blockItems: 30 });
  assert.ok(cost(blocked.blocks.flatMap((b) => b.entities)) <= 30);
  assert.ok(blocked.blocks.some((b) => (b.other["past the limit"] ?? 0) > 0));
});

test("A DXF comes back byte for byte from its document", async () => {
  const r12 = createDrawing({ units: "ft" });
  r12.layer("C-PROP", { color: 3 }, () => r12.text([0, 0], "A", { height: 1 }));
  const files = [
    toDXF(sheet),
    toDXF(kitchen),
    toDXF(r12.build(), { version: "R12" }),
    // A byte order mark, a comment before the first record, line ends of both kinds and what
    // an old program wrote after the end.
    `﻿999\r\nmade by hand\r\n  0\nSECTION\n  2\r\nENTITIES\n  0\nLINE\n  5\n1A\n330\n1F\n  8\n0\n  0\nENDSEC\n  0\nEOF\n\x1a`,
  ];
  for (const file of files) {
    const bytes = encoder.encode(file);
    const { read, document } = await readDXFDocument(chunks(bytes, 4093));
    assert.equal(document.bytes, bytes.length);
    assert.equal(document.capped, false);
    const copy = new Uint8Array(bytes.length);
    for (let i = 0; i < document.count; i++) {
      const start = document.starts[i]!;
      copy.set(bytes.subarray(start, start + document.length(i)), start);
      if (i > 0) assert.equal(start, document.starts[i - 1]! + document.length(i - 1));
    }
    assert.deepEqual(copy, bytes);
    // Each record starts at the group 0 that names its kind.
    const latin1 = new TextDecoder("latin1");
    for (let i = 0; i < document.count; i++) {
      const kind = document.names[document.kinds[i]!]!;
      if (i === 0 && kind === "") continue;
      const [code, value] = latin1
        .decode(bytes.subarray(document.starts[i]!, document.starts[i]! + 256))
        .split("\n");
      assert.equal(code!.trim(), "0", `record ${i}`);
      assert.equal(value!.replace(/\r$/, ""), kind, `record ${i}`);
    }
    // Each entity the read keeps is a record of the document under its handle.
    const handles = new Map<string, number>();
    for (let i = 0; i < document.count; i++) {
      const handle = document.handle(i);
      if (handle !== undefined) handles.set(handle, i);
    }
    for (const e of read.model.census.texts) {
      if (e.handle === undefined) continue;
      const i = handles.get(e.handle.toUpperCase());
      assert.equal(document.names[document.kinds[i!]!], e.kind, e.handle);
    }
  }
  const { document } = await readDXFDocument(encoder.encode(toDXF(sheet)));
  const seed = document.header().find((v) => v.name === "$HANDSEED")!;
  const text = toDXF(sheet);
  assert.match(
    text.slice(seed.start, seed.start + seed.length),
    /^9\r\n\$HANDSEED\r\n5\r\n\w+\r\n$/,
  );
  // A record names its owner, and the handles it refers to with the group that holds each.
  const layer = [...Array(document.count).keys()].find(
    (i) => document.names[document.kinds[i]!] === "LAYER",
  )!;
  const table = document.owner(layer)!;
  assert.ok(document.references(layer).some((r) => r.code === 330 && r.handle === table));
  assert.ok(document.references(layer).some((r) => r.code === 390));
  assert.equal(document.names[document.sections[layer]!], "TABLES");
});

test("a hatch with a group that is not a number is counted, not read as NaN", async () => {
  const d = createDrawing({ units: "in" });
  d.hatch([
    [0, 0],
    [1, 0],
    [1, 1],
  ]);
  d.hatch(
    [
      [2, 0],
      [3, 0],
      [3, 1],
    ],
    { pattern: { spacing: 0.1 } },
  );
  const dxf = toDXF(d.build());
  // The first hatch's loop flags, and the second's pattern type.
  const second = dxf.lastIndexOf("AcDbHatch");
  for (const bent of [
    dxf.replace("91\r\n1\r\n92\r\n2\r\n", "91\r\n1\r\n92\r\nx\r\n"),
    dxf.slice(0, second) + dxf.slice(second).replace("76\r\n0\r\n", "76\r\n1e999\r\n"),
  ]) {
    assert.notEqual(bent, dxf);
    const read = await readDXF(bent, { geometry: true });
    assert.deepEqual(plain(read.unread.malformed), { "HATCH with a number that is not finite": 1 });
  }
});

test("a definition of paragraph text pays for its style's name against the block's items", async () => {
  const d = createDrawing({ units: "in" });
  const style = "A" + "X".repeat(199);
  d.textStyle({ name: style, font: "Arial" });
  d.block("B", {}, () => d.attribute("A", [0, 0], { kind: "paragraph", value: "A", style }));
  const read = await readDXFWithin(toDXF(d.build()), {}, { ...READ_LIMITS, blockItems: 8 });
  const block = read.blocks.find((b) => b.name === "B")!;
  assert.equal(block.attributeDefinitions.length, 0);
  assert.equal(block.other["past the limit"], 1);
});

test("a gradient whose angle or tint is past the doubles once read is counted, not read as Infinity", async () => {
  const d = createDrawing({ units: "in" });
  d.hatch(
    [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    {
      gradient: {
        name: "linear",
        colors: [
          [0, 0, 255],
          [255, 255, 0],
        ],
      },
    },
  );
  d.hatch(
    [
      [2, 0],
      [3, 0],
      [3, 1],
    ],
    { gradient: { name: "linear", color: [0, 0, 255], tint: 0.5 } },
  );
  const dxf = toDXF(d.build());
  // The first's angle in radians, past the doubles in degrees, and the second's tint, past
  // single precision.
  const bent = dxf
    .replace(/\r\n460\r\n[^\r]*\r\n/, "\r\n460\r\n1e307\r\n")
    .replace(/\r\n462\r\n0\.5\r\n/, "\r\n462\r\n1e39\r\n");
  assert.ok(bent.includes("\r\n460\r\n1e307\r\n") && bent.includes("\r\n462\r\n1e39\r\n"));
  const read = await readDXF(bent, { geometry: true });
  assert.deepEqual(plain(read.unread.malformed), { "HATCH with a number past the doubles": 2 });
});
