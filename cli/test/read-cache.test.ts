// The read cache: a file is read once for each hash of its bytes, reader and options, and a kept
// read is checked before it is used.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createDrawing, toDXF } from "tsdraft";
import { type CachedRead, ReadCache } from "../src/read-cache.ts";

const temp = realpathSync(mkdtempSync(join(tmpdir(), "tsdraft-read-cache-")));

after(() => rmSync(temp, { recursive: true, force: true }));

function dxf(text: string): string {
  const d = createDrawing({ units: "ft" });
  d.text([0, 0], text, { height: 1 });

  return toDXF(d.build());
}

/**
 * Reads until a read comes from where it is looked for, at most three times. The key holds the
 * core's build, whose files another test may touch while this one runs, so a read again may miss
 * under a new key, and the read after it finds the new key.
 */
async function readFrom(from: "memory" | "disk", read: () => Promise<CachedRead>) {
  let done = await read();

  for (let tries = 1; tries < 3 && !("read" in done && done.from === from); tries++)
    done = await read();

  return done;
}

/** Writes a file with a time well in the past, as a file saved a while ago has. */
function save(path: string, text: string, secondsAgo = 60): void {
  writeFileSync(path, text);
  const then = Date.now() / 1000 - secondsAgo;
  utimesSync(path, then, then);
}

test("a file is read once, kept in memory and on disk, and read again when it changes", async () => {
  const folder = join(temp, "cache-a");
  const file = join(temp, "a.dxf");
  save(file, dxf("FIRST"));
  const cache = new ReadCache(folder);
  const first = await cache.read(file, null);
  assert.ok("read" in first && first.from === "file");
  const again = await readFrom("memory", () => cache.read(file, null));
  assert.ok("read" in again && again.from === "memory");
  assert.equal(JSON.stringify(again.read), JSON.stringify(first.read));
  // With geometry it is another read.
  const drawn = await cache.read(file, null, {}, { geometry: true });
  assert.ok("read" in drawn && drawn.from === "file" && drawn.read.model.entities?.length === 1);

  // A restart finds it on disk without reading the file.
  const restarted = await readFrom("disk", () => new ReadCache(folder).read(file, null));
  assert.ok("read" in restarted && restarted.from === "disk");
  assert.equal(JSON.stringify(restarted.read), JSON.stringify(first.read));

  // A save changes the size or the time, and the file is hashed and read again.
  save(file, dxf("SECOND"), 30);
  const changed = await cache.read(file, null, {}, { geometry: true });
  assert.ok("read" in changed && changed.from === "file");
  assert.notEqual(changed.read.sha256, first.read.sha256);
});

test("a read by layout reaches the reading process and is kept apart from the whole read", async () => {
  const d = createDrawing({ units: "in" });
  d.line([0, 0], [1, 0]);
  d.line([100, 0], [101, 0]);
  d.layout("A", { paper: "ARCH D" }, (page) =>
    page.viewport([1, 1], 4, 4, { center: [0, 0], ratio: 1 }),
  );
  const file = join(temp, "part.dxf");
  save(file, toDXF(d.build()));
  const cache = new ReadCache(join(temp, "cache-part"));
  const whole = await cache.read(file, null, {}, { geometry: true });
  const part = await cache.read(file, null, {}, { geometry: true, only: { layouts: ["A"] } });
  assert.ok("read" in whole && "read" in part && part.from === "file");
  assert.equal(whole.read.model.entities?.length, 2);
  assert.equal(part.read.model.entities?.length, 1);
  assert.equal(JSON.stringify(part.read.only), JSON.stringify({ layouts: ["A"] }));

  const again = await readFrom("memory", () =>
    cache.read(file, null, {}, { geometry: true, only: { layouts: ["A"] } }),
  );

  assert.ok("read" in again && again.from === "memory");
});

test("a kept read that is not the file's is thrown away and the file read again", async () => {
  const folder = join(temp, "cache-b");
  const file = join(temp, "b.dxf");
  save(file, dxf("KEPT"));
  const first = await new ReadCache(folder).read(file, null);
  assert.ok("read" in first);

  for (const tampered of [
    '{"format":0}',
    "not json",
    JSON.stringify({ ...first.read, bytes: 1 }),
  ]) {
    // Every kept read, since the key holds the core's build, whose files another test may touch
    // while this one runs, and a read again may be kept under a new key.
    for (const kept of readdirSync(folder).filter((name) => name.endsWith(".json")))
      writeFileSync(join(folder, kept), tampered);
    const read = await new ReadCache(folder).read(file, null);
    assert.ok("read" in read && read.from === "file", tampered.slice(0, 20));
    assert.equal(JSON.stringify(read.read), JSON.stringify(first.read));
  }
});

test("a file saved within the clock's tick is hashed again at each read", async () => {
  const file = join(temp, "c.dxf");
  writeFileSync(file, dxf("NOW"));
  const cache = new ReadCache(null);
  assert.ok("read" in (await cache.read(file, null)));
  // Same size, same time, other bytes: only a hash tells them apart.
  const { mtime } = statSync(file);
  writeFileSync(file, dxf("NEW"));
  utimesSync(file, mtime, mtime);
  const read = await cache.read(file, null);
  assert.ok("read" in read && read.from === "file");
});

test("a rewrite that keeps the size and puts the time back is read again", async () => {
  const folder = join(temp, "cache-d");
  const file = join(temp, "d.dxf");
  save(file, dxf("CAT"));
  const cache = new ReadCache(folder);
  assert.ok("read" in (await cache.read(file, null, {}, { geometry: true })));
  const { mtime } = statSync(file);
  writeFileSync(file, dxf("DOG"));
  utimesSync(file, mtime, mtime);

  for (const again of [cache, new ReadCache(folder)]) {
    const read = await again.read(file, null, {}, { geometry: true });
    assert.ok("read" in read && read.from !== "memory");
    const text = read.read.model.entities?.find((e) => e.kind === "text");
    assert.equal(text?.kind === "text" ? text.value : undefined, "DOG");
  }
});

test("a file over the size limit is refused, kept or not, and a kept read that is a folder is read again", async () => {
  const folder = join(temp, "cache-e");
  const file = join(temp, "e.dxf");
  save(file, dxf("BIG"));
  const cache = new ReadCache(folder);
  assert.ok("read" in (await cache.read(file, null)));
  const refused = await cache.read(file, null, { maxFileBytes: 1 });
  assert.ok("skipped" in refused && /over the limit/.test(refused.skipped));
  const [kept] = readdirSync(folder).filter((name) => name.endsWith(".json"));
  rmSync(join(folder, kept!));
  mkdirSync(join(folder, kept!));
  const read = await new ReadCache(folder).read(file, null);
  assert.ok("read" in read && read.from === "file");
});

test("a reader whose deep file changes in place, with its version kept, reads again", async () => {
  // An installed reader that names its file's encoding after what a module it imports says.
  const folder = join(temp, "node_modules", "label-reader");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "package.json"),
    JSON.stringify({
      name: "label-reader",
      version: "1.0.0",
      type: "module",
      tsdraft: { readers: { ".dwg": "./read.js" } },
    }),
  );
  writeFileSync(join(folder, "label.js"), 'export const label = "utf-8";\n');
  writeFileSync(
    join(folder, "read.js"),
    `import { createHash } from "node:crypto";
import { label } from "./label.js";
export async function readDrawingFile(chunks) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of chunks) { hash.update(chunk); bytes += chunk.length; }
  const census = { layers: {}, texts: [], dimensions: [], inserts: [],
    counts: { texts: 0, dimensions: 0, inserts: 0 }, capped: false };
  return { format: 0, sha256: hash.digest("hex"), bytes, encoding: label, header: {}, layers: [],
    linetypes: [], textStyles: [], dimensionStyles: [], tableStyles: [], blocks: [], xrefs: [],
    images: [], underlays: [], model: { census }, layouts: [], fields: [], otherFields: {},
    unread: { entities: {}, objects: {}, malformed: {} } };
}
`,
  );

  const reader = {
    name: "label-reader",
    version: "1.0.0",
    folder: realpathSync(folder),
    modules: { ".dwg": realpathSync(join(folder, "read.js")) },
  };

  const file = join(temp, "f.dwg");
  save(file, "a drawing");
  const cache = join(temp, "cache-f");
  const first = await new ReadCache(cache).read(file, reader);
  assert.ok("read" in first && first.read.encoding === "utf-8");
  writeFileSync(join(folder, "label.js"), 'export const label = "ibm437";\n');
  // The fingerprint of a reader is taken anew after a second.
  await new Promise((done) => setTimeout(done, 1_100));
  const again = await new ReadCache(cache).read(file, reader);
  assert.ok("read" in again && again.from === "file" && again.read.encoding === "ibm437");
});
