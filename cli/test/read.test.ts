// Reading drawing files: the finding of readers, and each read in a process of its own within
// its limits.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createDrawing, toDXF } from "tsdraft";
import { readDrawingFile, readDrawingFiles } from "../src/read.ts";
import { findReaders, OWN_FOLDER, readerFor, ReaderRefusal } from "../src/readers.ts";

const fixtures = fileURLToPath(new URL("fixtures/read/", import.meta.url));
const readerA = join(fixtures, "reader-a");
const readerB = join(fixtures, "reader-b");

const temp = realpathSync(mkdtempSync(join(tmpdir(), "tsdraft-read-")));

after(() => rmSync(temp, { recursive: true, force: true }));

const tempDir = (): string => mkdtempSync(join(temp, "case-"));

/** A folder whose package.json lists tsdraft and each package, linked in its node_modules. */
function project(dir: string, packages: Record<string, string>, tsdraft = OWN_FOLDER): string {
  const names = ["tsdraft", ...Object.keys(packages)];
  const dependencies = Object.fromEntries(names.map((name) => [name, "*"]));
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "a-project", dependencies }));

  for (const [name, folder] of Object.entries({ ...packages, tsdraft })) {
    symlinkSync(folder, join(dir, "node_modules", name), "dir");
  }

  return dir;
}

/** A file of `bytes` bytes. */
function file(name: string, bytes = 100): string {
  const path = join(tempDir(), name);
  writeFileSync(path, Buffer.alloc(bytes, 7));

  return path;
}

const reader = (folder: string) => findReaders({ cwd: temp, inputs: [], reader: folder });
const [a] = reader(readerA).packages;

test("the readers are the dependencies of the project whose tsdraft is the one running", () => {
  const dir = project(tempDir(), {
    "reader-a": readerA,
    escapes: join(fixtures, "escapes"),
  });

  const cwd = join(dir, "drawings/sheets");
  mkdirSync(cwd, { recursive: true });
  const readers = findReaders({ cwd, inputs: [] });
  assert.equal(readers.project, dir);
  // A package whose reader lies outside it names none.
  assert.deepEqual(
    readers.packages.map(({ name }) => name),
    ["reader-a"],
  );
  assert.deepEqual(readerFor(readers, ".DWG"), {
    name: "reader-a",
    version: "1.0.0",
    folder: realpathSync(readerA),
    modules: {
      ".dwg": realpathSync(join(readerA, "read.js")),
      ".dwt": realpathSync(join(readerA, "read.js")),
    },
    editors: {},
  });
  assert.equal(readerFor(readers, ".pdf"), null);
  assert.equal(readerFor(readers, ".dxf"), null);
});

test("two readers of one extension are refused, and --reader picks one", () => {
  const dir = project(tempDir(), { "reader-a": readerA, "reader-b": readerB });
  const readers = findReaders({ cwd: dir, inputs: [] });
  assert.throws(
    () => readerFor(readers, ".dwg"),
    (error) =>
      error instanceof ReaderRefusal &&
      error.message ===
        "2 packages read .dwg files: reader-a, reader-b. Pick one with --reader <package>",
  );
  assert.equal(readerFor(readers, ".dwt")?.name, "reader-a");

  const picked = (reader: string) =>
    findReaders({ cwd: dir, inputs: [], reader }).packages.map(({ name }) => name);

  assert.deepEqual(picked("reader-b"), ["reader-b"]);
  assert.deepEqual(picked("./node_modules/reader-a"), ["reader-a"]);
  assert.throws(() => picked("reader-c"), /^ReaderRefusal: --reader reader-c: no such package$/);
  assert.throws(() => picked("./node_modules/tsdraft"), /names no reader/);
  // A manifest whose field is not an object names no reader either.
  const nulled = join(tempDir(), "nulled");
  mkdirSync(nulled);
  writeFileSync(join(nulled, "package.json"), JSON.stringify({ name: "nulled", tsdraft: null }));
  assert.throws(
    () => picked(nulled),
    (e: Error) => e instanceof ReaderRefusal && /names no reader/.test(e.message),
  );
});

test("a folder that lists tsdraft and resolves another copy stops the walk", () => {
  const outer = project(tempDir(), { "reader-a": readerA });
  const copy = join(outer, "copy");
  mkdirSync(copy);
  writeFileSync(join(copy, "package.json"), JSON.stringify({ name: "tsdraft" }));
  const inner = project(join(outer, "inner"), { "reader-a": readerA }, copy);
  assert.deepEqual(findReaders({ cwd: inner, inputs: [] }), { project: null, packages: [] });
  // With no project, --reader takes a path and not a name.
  assert.throws(
    () => findReaders({ cwd: inner, inputs: [], reader: "reader-a" }),
    /no project here has this tsdraft installed/,
  );
  const named = findReaders({ cwd: inner, inputs: [], reader: "./node_modules/reader-a" });
  assert.deepEqual(
    named.packages.map(({ name }) => name),
    ["reader-a"],
  );
});

test("a project inside an input path is not used", () => {
  const dir = project(tempDir(), { "reader-a": readerA });
  mkdirSync(join(dir, "drawings"));

  for (const inputs of [[dir], [dirname(dir)], ["."]]) {
    assert.deepEqual(findReaders({ cwd: dir, inputs }), { project: null, packages: [] });
  }

  assert.equal(findReaders({ cwd: dir, inputs: ["drawings"] }).project, dir);
});

test("a dependency that resolves inside an input path is not a reader", () => {
  const dir = project(tempDir(), { "reader-a": readerA });
  assert.deepEqual(findReaders({ cwd: dir, inputs: [readerA] }), { project: dir, packages: [] });
});

test("render never takes a reader from the folder of the drawing it was given", () => {
  const planted = project(tempDir(), { "reader-a": readerA });
  writeFileSync(join(planted, "plan.dwg"), Buffer.alloc(100, 7));
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const out = tempDir();

  const run = spawnSync(
    process.execPath,
    [cli, "render", join(planted, "plan.dwg"), "--out", out],
    { cwd: tempDir(), encoding: "utf8", timeout: 120_000 },
  );

  assert.equal(run.status, 1, run.stderr);
  assert.match(JSON.parse(run.stdout).error.message, /no installed reader reads plan\.dwg/);
});

const sha256 = (bytes: number) => createHash("sha256").update(Buffer.alloc(bytes, 7)).digest("hex");

test("a read comes back checked, with the reader that read it", async () => {
  const result = await readDrawingFile(file("good.dwg", 1000), a!);
  assert.ok("read" in result, JSON.stringify(result));
  assert.deepEqual([result.read.bytes, result.read.sha256], [1000, sha256(1000)]);
  assert.deepEqual(result.reader, { name: "reader-a", version: "1.0.0" });
  // What a reader prints goes nowhere near its answer.
  assert.ok("read" in (await readDrawingFile(file("prints.dwg"), a!)));
});

test("a read in format 0 comes back in the current format, and one with format 1's fields or a later format is refused", async () => {
  const old = await readDrawingFile(file("old-names.dwg"), a!);
  assert.ok("read" in old, JSON.stringify(old));
  assert.equal(old.read.format, 1);
  // Each object it renames keeps no prototype, as every object of an answer.
  assert.deepEqual(old.read.linetypes[0]?.marks, [
    Object.assign(Object.create(null), { after: 0, glyph: 132, file: "ltypeshp.shx", scale: 0.1 }),
  ]);
  assert.equal(old.read.textStyles[0]?.glyphFile, true);
  assert.ok(!("shapes" in old.read.textStyles[0]!));
  assert.ok("read" in (await readDrawingFile(file("current.dwg"), a!)));

  // A field of format 1 in a read that says format 0 is refused, beside its old name or alone.
  for (const [name, field] of [
    ["both-mark.dwg", "a linetype mark's glyph"],
    ["glyph-mark.dwg", "a linetype mark's glyph"],
    ["glyph-style.dwg", "a text style's glyphFile"],
  ] as const) {
    const mixed = await readDrawingFile(file(name), a!);
    assert.equal(
      "skipped" in mixed && mixed.skipped,
      `the reader's answer is malformed: it gives read format 0 and names ${field}, which is read format 1's`,
    );
  }

  const later = await readDrawingFile(file("later.dwg"), a!);
  assert.equal(
    "skipped" in later && later.skipped,
    "the reader gives read format 99, and this tsdraft reads format 1, and format 0 from older readers",
  );
});

test("a read that fails is skipped with the reason, and the next file is read", async () => {
  const files = [
    "throws.dwg",
    "malformed.dwg",
    "wrong-sha256.dwg",
    "wrong-bytes.dwg",
    "silent.dwg",
    "busy.dwg",
    "big.dwg",
    "good.dwg",
    "a.pdf",
  ];

  const results = await readDrawingFiles(
    [
      ...files.map((name) => ({ file: file(name, name === "big.dwg" ? 2000 : 100), reader: a! })),
      { file: file("plan.dwg"), reader: null },
    ],
    { timeoutMs: 2000, maxFileBytes: 1000 },
  );

  const outcomes = results.map((result) => ("read" in result ? "read" : result.skipped));
  assert.deepEqual(outcomes, [
    // The reader gets the file's name, never its path.
    "the reader threw: cannot read throws.dwg",
    outcomes[1],
    // The right shape, with another file's hash or size.
    "the reader's answer is malformed: its size or SHA-256 is not the file's",
    "the reader's answer is malformed: its size or SHA-256 is not the file's",
    "the read took longer than 2 s, and was ended",
    "the read took longer than 2 s, and was ended",
    "the file is 2000 bytes, over the limit of 1000 bytes",
    "read",
    "reader-a does not read a.pdf",
    "no installed reader reads plan.dwg",
  ]);
  assert.match(outcomes[1]!, /^the reader's answer is malformed: /);
  const big = await readDrawingFile(file("good.dwg"), a!, { maxAnswerBytes: 100 });
  assert.equal(
    "skipped" in big && big.skipped,
    "the reader's answer is over the limit of 100 bytes",
  );
});

test("at most two reads run at once, across callers", async () => {
  const held = (names: string[]) =>
    readDrawingFiles(names.map((name) => ({ file: file(name), reader: a! })));

  const results = await Promise.all([held(["held-1.dwg", "held-2.dwg"]), held(["held-3.dwg"])]);

  const steps = results.flat().flatMap((result) => {
    const times = /^the reader threw: (\d+) (\d+)$/.exec("skipped" in result ? result.skipped : "");
    assert.ok(times, JSON.stringify(result));

    return [
      [Number(times[1]), 1],
      [Number(times[2]), -1],
    ];
  });

  // A read that ends as another starts is not counted with it.
  steps.sort(([t, step], [u, other]) => t! - u! || step! - other!);
  let now = 0;
  let most = 0;

  for (const [, step] of steps) most = Math.max(most, (now += step!));
  assert.equal(most, 2);
});

const prlimit = spawnSync("prlimit", ["--version"]).status === 0;

// A core limit of one byte keeps the kernel from writing a dump of the process V8 aborts.
test(
  "a reader that holds ever more memory is ended at its heap, with no core",
  { skip: prlimit ? false : "needs prlimit, to keep the abort from leaving a core" },
  async () => {
    const result = await readDrawingFile(file("greedy.dwg"), a!, { maxMemoryMb: 64 });
    assert.equal(
      "skipped" in result && result.skipped,
      "the reading process ran out of memory, over its heap of 64 MB",
    );
  },
);

const permission = process.allowedNodeEnvironmentFlags.has("--permission");

test(
  "a reader may not write files, and may import tsdraft through pnpm's link",
  { skip: permission ? false : "needs Node's permission model" },
  async () => {
    const name = `writes-${process.pid}.dwg`;
    const result = await readDrawingFile(file(name), a!);
    assert.match(
      "skipped" in result ? result.skipped : "",
      /^the reader threw: .*--allow-fs-write/,
    );
    assert.equal(existsSync(join(tmpdir(), `${name}.written`)), false);

    // pnpm's layout: the package in its own folder of the store, and its dependencies as links
    // beside it.
    const store = join(tempDir(), "node_modules/.pnpm/reader-a@1.0.0/node_modules");
    cpSync(readerA, join(store, "reader-a"), { recursive: true });
    symlinkSync(OWN_FOLDER, join(store, "tsdraft"), "dir");
    const [installed] = reader(join(store, "reader-a")).packages;
    const imported = await readDrawingFile(file("imports.dwg"), installed!);
    assert.ok("read" in imported, JSON.stringify(imported));
  },
);

test(
  "a reader may not start a process or a worker, or read outside the two packages",
  { skip: permission ? false : "needs Node's permission model" },
  async () => {
    const outside = `reads-outside-${process.pid}.dwg`;
    writeFileSync(join(tmpdir(), `${outside}.txt`), "outside");

    try {
      const results = await readDrawingFiles(
        ["spawns.dwg", "starts-worker.dwg", outside].map((name) => ({
          file: file(name),
          reader: a!,
        })),
      );

      assert.deepEqual(
        results.map((result) =>
          "skipped" in result
            ? /^the reader threw: .*(--allow-[a-z-]+)/.exec(result.skipped)?.[1]
            : "read",
        ),
        ["--allow-child-process", "--allow-worker", "--allow-fs-read"],
      );
    } finally {
      rmSync(join(tmpdir(), `${outside}.txt`), { force: true });
    }
  },
);

/** Whether a process is running, and not a zombie. */
function running(pid: number): boolean {
  try {
    return !/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return false;
  }
}

test(
  "a command ended by SIGTERM ends its reads, and then ends by SIGTERM",
  { skip: process.platform === "linux" ? false : "finds the reading process in /proc" },
  async () => {
    const script = [
      `import { readDrawingFile } from ${JSON.stringify(fileURLToPath(new URL("../src/read.ts", import.meta.url)))};`,
      `import { findReaders } from ${JSON.stringify(fileURLToPath(new URL("../src/readers.ts", import.meta.url)))};`,
      `const [reader] = findReaders({ cwd: process.cwd(), inputs: [], reader: process.argv[1] }).packages;`,
      `await readDrawingFile(process.argv[2], reader, { timeoutMs: 60_000 });`,
    ].join("\n");

    const command = spawn(
      process.execPath,
      ["--input-type=module", "-e", script, readerA, file("busy.dwg")],
      { cwd: temp, stdio: "ignore" },
    );

    const exited = once(command, "exit");
    const children = `/proc/${command.pid}/task/${command.pid}/children`;
    let child = 0;

    try {
      while (!child) {
        await delay(20);
        child = Number(readFileSync(children, "utf8").trim().split(" ")[0]);
      }

      // A busy reader never runs its process's own check on its parent.
      await delay(500);
      command.kill("SIGTERM");
      assert.deepEqual(await exited, [null, "SIGTERM"]);

      for (let tries = 0; running(child) && tries < 100; tries++) await delay(20);
      assert.equal(running(child), false);
    } finally {
      command.kill("SIGKILL");

      if (child && running(child)) process.kill(child, "SIGKILL");
    }
  },
);

test("the core reads a DXF in a process of its own", async () => {
  const d = createDrawing({ units: "ft" });
  d.layer("WALLS", { color: 3 }, () => d.line([0, 0], [10, 0]));
  const path = join(tempDir(), "plan.dxf");
  writeFileSync(path, toDXF(d.build()));
  const result = await readDrawingFile(path, null);
  assert.ok("read" in result, JSON.stringify(result));
  assert.equal(result.reader.name, "tsdraft");
  assert.ok(result.read.layers.some((layer) => layer.name === "WALLS"));
  // The answer's maps have no prototype, as readDXF's own have.
  assert.equal(Object.getPrototypeOf(result.read.model.census.layers), null);
  assert.equal(result.read.model.census.layers["constructor"], undefined);
});

test("shows says when an xref given lies deeper than it follows", async () => {
  const { shows } = await import("../src/shows.ts");
  const dir = tempDir();
  const xrefs: Record<string, string> = {};

  // Each file attaches the next, 17 deep.
  for (let i = 0; i <= 17; i++) {
    const d = createDrawing({ units: "ft" });
    d.line([0, 0], [1, 0]);

    if (i < 17) {
      const name = `X${i + 1}`;
      d.xref(name, `x${i + 1}.dwg`, { attach: true }).insert(name, [0, 0]);
    }

    writeFileSync(join(dir, `x${i}.dxf`), toDXF(d.build()));

    if (i > 0) xrefs[`X${i}`] = join(dir, `x${i}.dxf`);
  }

  const { json } = await shows({ file: join(dir, "x0.dxf"), xrefs });
  // SAFETY: shows answers with an object, which has xrefsCapped when it stopped short.
  assert.equal((json as { xrefsCapped?: boolean }).xrefsCapped, true);
});
