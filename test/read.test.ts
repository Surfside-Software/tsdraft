import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { test } from "node:test";
import sheet from "../examples/site-plan.ts";
import {
  CENSUS_LIMIT,
  checkDrawingRead,
  createDrawing,
  leaderCount,
  readDXF,
  ReadError,
  toDXF,
} from "../src/index.ts";
import { inlineHeights } from "../src/read/dxf.ts";
import { Sha256 } from "../src/sha256.ts";

const encoder = new TextEncoder();

/** A value as plain data, as JSON gives it: the read model's maps have no prototype. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

async function* chunks(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}

/** A DXF of groups, as `[code, value]` pairs, one per line pair, with CRLF as AutoCAD writes. */
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
  // A multileader is counted, and has no reading of its own yet.
  assert.deepEqual(plain(read.unread), {
    entities: { MULTILEADER: leaderCount(sheet) },
    objects: {},
    malformed: {},
  });

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
});

test("readDXF decodes text by $DWGCODEPAGE before AutoCAD 2007's format, and as UTF-8 after", async () => {
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
        [0, "HATCH"],
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
    kinds: { MTEXT: 1, HATCH: 1, OLE2FRAME: 1 },
    ownColor: 1,
    ownLinetype: 0,
    ownLineweight: 1,
    lineweights: { "35": 1 },
  });
  assert.deepEqual(plain(read.unread.entities), { HATCH: 1, OLE2FRAME: 1 });
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

test(
  "readDXF reads a file of more than 500 MB within the limits of a read",
  { timeout: 130_000 },
  () => {
    // The read runs as the command runs one: in a process with a heap of 2 GB, for 120 s.
    const script = join(import.meta.dirname, "read-large.ts");
    // Under prlimit, as the command runs it, an abort leaves no core.
    const node = [process.execPath, "--max-old-space-size=2048", script];
    const prlimit = spawnSync("prlimit", ["--version"]).status === 0;
    const [command, ...args] = prlimit ? ["prlimit", "--core=1:1", "--", ...node] : node;
    const run = spawnSync(command!, args, {
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(run.signal, null, "the read ran past 120 s or was killed");
    assert.equal(run.status, 0, run.stderr);
    const { bytes, capped, heap, answer } = JSON.parse(run.stdout) as Record<string, number>;
    assert.ok(bytes! > 500e6);
    assert.equal(capped, true);
    assert.ok(heap! < 1024 ** 3, `the heap reached ${Math.round(heap! / 1e6)} MB`);
    // The command takes an answer of up to 128 MB of JSON.
    assert.ok(answer! < 128 * 1024 ** 2, `the answer is ${Math.round(answer! / 1e6)} MB`);
  },
);

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

test("readDXF takes any layer name, places mirrored entities in the world, and skips a broken vertex", async () => {
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
  ]);
  assert.deepEqual(plain(block?.other), { "CIRCLE in 3D": 1, "TEXT seen from below": 1 });
  assert.deepEqual(plain(read.unread.malformed), {
    "LWPOLYLINE with a point that is not a number": 1,
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

test("readDXF keeps a polyline with widths of 0, and counts one with widths", async () => {
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
  assert.equal(read.blocks[0]?.entities.length, 1);
  assert.deepEqual(plain(read.blocks[0]?.other), { "LWPOLYLINE with widths": 1 });
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
