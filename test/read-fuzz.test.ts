import assert from "node:assert/strict";
import { test } from "node:test";
import { READ_LIMITS, readDXFWithin } from "../src/read/dxf.ts";
import { fuzz, seedFiles } from "./read-fuzz.ts";
import { within } from "./time-limit.ts";

test("readDXF gives a sound read or a ReadError for each bent file, within its time", async () => {
  const files = seedFiles();

  for (const seed of [1, 2]) {
    const found = await fuzz(files, seed, 50);
    assert.deepEqual(
      found.map(({ run, problem }) => `seed ${seed} run ${run}: ${problem.slice(0, 300)}`),
      [],
    );
  }
});

test("readDXF stays linear in names longer than a DXF holds", async () => {
  // Many names of one length past 16,383 characters, which V8 hashes by their length alone.
  const long = (i: number): string => "N".repeat(17_000) + String(i).padStart(5, "0");
  const lines = ["  0", "SECTION", "  2", "ENTITIES"];

  for (let i = 0; i < 1500; i++) {
    lines.push("  0", "LINE", "  8", long(i), " 10", "0", " 20", "0", " 11", "1", " 21", "1");
  }

  lines.push("  0", "INSERT", "  8", "0", "  2", "B", " 66", "1");

  for (let i = 0; i < 1000; i++)
    lines.push("  0", "ATTRIB", "  8", "0", "  2", long(i), "  1", "v");
  lines.push("  0", "SEQEND");
  lines.push("  0", "ENDSEC", "  0", "EOF", "");
  const bytes = new TextEncoder().encode(lines.join("\n"));
  const read = await within(5_000, () => readDXFWithin(bytes, { geometry: true }, READ_LIMITS));
  assert.deepEqual(JSON.parse(JSON.stringify(read.unread.malformed)), {
    "LINE on a layer longer than 2049 characters": 1500,
    "ATTRIB with a tag longer than 2049 characters": 1000,
  });
});

test("readDXF stays linear in long values where a dictionary holds a handle", async () => {
  const long = (i: number): string => "N".repeat(17_000) + String(i).padStart(5, "0");
  const lines = ["  0", "SECTION", "  2", "ENTITIES"];

  // MTEXTs whose fields lead, through their dictionaries, to such values, and a dictionary of
  // leader styles that holds them.
  for (let i = 0; i < 2000; i++) {
    const [text, outer] = [(0x10000 + i).toString(16), (0x20000 + i).toString(16)];
    lines.push("  0", "MTEXT", "  5", text, "102", "{ACAD_XDICTIONARY", "360", outer, "102", "}");
    lines.push("  8", "0", " 10", "0", " 20", "0", " 40", "1", "  1", "x");
  }

  lines.push("  0", "ENDSEC", "  0", "SECTION", "  2", "OBJECTS");
  lines.push("  0", "DICTIONARY", "  5", "A", "  3", "ACAD_MLEADERSTYLE", "350", "B");
  lines.push("  0", "DICTIONARY", "  5", "B");

  for (let i = 0; i < 2000; i++) lines.push("  3", `S${i}`, "350", long(i));

  for (let i = 0; i < 2000; i++) {
    const [outer, inner] = [(0x20000 + i).toString(16), (0x30000 + i).toString(16)];
    lines.push("  0", "DICTIONARY", "  5", outer, "  3", "ACAD_FIELD", "360", inner);
    lines.push("  0", "DICTIONARY", "  5", inner, "  3", "TEXT", "360", long(i));
  }

  lines.push("  0", "ENDSEC", "  0", "EOF", "");
  const bytes = new TextEncoder().encode(lines.join("\n"));
  const read = await within(4_000, () => readDXFWithin(bytes, { geometry: true }, READ_LIMITS));
  assert.equal(read.model.entities!.length, 2000);
  assert.deepEqual(read.fields, []);
});

test("readDXF reads a header's value once, however many entities follow", async () => {
  const lines = [
    "  0",
    "SECTION",
    "  2",
    "HEADER",
    "  9",
    "$ACADVER",
    "  1",
    "x".repeat(1_000_000),
  ];

  lines.push("  0", "ENDSEC", "  0", "SECTION", "  2", "ENTITIES");

  for (let i = 0; i < 50_000; i++) lines.push("  0", "LINE", "  8", "0", " 10", "0", " 20", "0");
  lines.push("  0", "ENDSEC", "  0", "EOF", "");
  const bytes = new TextEncoder().encode(lines.join("\n"));
  const read = await within(2_000, () => readDXFWithin(bytes, { geometry: true }, READ_LIMITS));
  assert.equal(read.model.entities!.length, 50_000);
});

test("an image whose clip the world's coordinates cannot hold is malformed", async () => {
  // Found by the long pass from seed 2212: a clip point of 1e308 pixels, scaled into the world.
  const lines = ["  0", "SECTION", "  2", "ENTITIES", "  0", "IMAGE", "  8", "0"];
  lines.push("100", "AcDbRasterImage", " 10", "0", " 20", "0", " 11", "2", " 21", "0");
  lines.push(" 12", "0", " 22", "2", " 13", "10", " 23", "10", " 71", "2", " 91", "3");
  lines.push(" 14", "6", " 24", "1e308", " 14", "8", " 24", "-1e308", " 14", "7", " 24", "5");
  lines.push("280", "1", "  0", "ENDSEC", "  0", "EOF", "");
  const read = await readDXFWithin(lines.join("\n"), { geometry: true }, READ_LIMITS);
  assert.deepEqual(JSON.parse(JSON.stringify(read.unread.malformed)), {
    "IMAGE whose clip is past the doubles": 1,
  });
});
