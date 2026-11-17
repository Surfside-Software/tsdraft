// A reader for the tests. What it does depends on the start of the file's name.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

export async function readDrawingFile(chunks, name) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of chunks) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  if (name.startsWith("throws")) throw new Error(`cannot read ${name}`);
  if (name.startsWith("silent")) return new Promise(() => setInterval(() => {}, 1_000));
  if (name.startsWith("busy")) for (;;) bytes++;
  // Holds its process for half a second, and throws the times it held it from and to.
  if (name.startsWith("held")) {
    const from = Date.now();
    await new Promise((go) => setTimeout(go, 500));
    throw new Error(`${from} ${Date.now()}`);
  }
  if (name.startsWith("greedy")) {
    const held = [];
    for (;;) held.push(Array.from({ length: 1_000 }, (_, i) => i + bytes));
  }
  if (name.startsWith("malformed")) return { format: 0, sha256: "nope" };
  if (name.startsWith("writes")) writeFileSync(join(tmpdir(), `${name}.written`), "written");
  if (name.startsWith("spawns")) spawn("true");
  if (name.startsWith("starts-worker")) new Worker("", { eval: true });
  if (name.startsWith("reads-outside")) readFileSync(join(tmpdir(), `${name}.txt`));
  if (name.startsWith("prints"))
    for (let i = 0; i < 10_000; i++) console.log("a reader that prints");
  // Where pnpm installed this package, tsdraft is a link beside it.
  if (name.startsWith("imports")) await import("tsdraft");
  return {
    format: 0,
    sha256: name.startsWith("wrong-sha256") ? "0".repeat(64) : hash.digest("hex"),
    bytes: name.startsWith("wrong-bytes") ? bytes + 1 : bytes,
    encoding: "utf-8",
    header: {},
    layers: [],
    linetypes: [],
    textStyles: [],
    dimensionStyles: [],
    blocks: [],
    xrefs: [],
    model: {
      census: {
        layers: {},
        texts: [],
        dimensions: [],
        inserts: [],
        counts: { texts: 0, dimensions: 0, inserts: 0 },
        capped: false,
      },
    },
    layouts: [],
    fields: [],
    otherFields: {},
    unread: { entities: {}, objects: {}, malformed: {} },
  };
}
