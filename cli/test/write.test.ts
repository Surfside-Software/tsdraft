// `tsdraft write`: an edited copy of each file the edit files name, under the out folder at the
// source's path from the job's root, written only once the checks of every job pass; a stale hash
// refused, a lock beside the source a warning, and the source never written.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import sheet from "../../examples/site-plan.ts";
import { toDXF } from "../../src/index.ts";
import { inScratch } from "./scratch.ts";

const root = join(import.meta.dirname, "..");

function write(cwd: string, ...args: string[]) {
  const run = spawnSync(process.execPath, [join(root, "src/cli.ts"), "write", ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });
  return {
    status: run.status,
    stderr: run.stderr,
    job: run.stdout ? JSON.parse(run.stdout) : undefined,
  };
}

const editFile = (file: string, sha256: string, name = "rev-1") =>
  `import { editDrawing } from "tsdraft";\n` +
  `export default editDrawing({ file: ${JSON.stringify(file)}, sha256: ${JSON.stringify(sha256)}, name: ${JSON.stringify(name)} });\n`;

test("write makes the edited copy of a DXF under out, at its path from the root, and leaves the source", async () => {
  await inScratch((dir) => {
    const bytes = Buffer.from(toDXF(sheet));
    const sha = createHash("sha256").update(bytes).digest("hex");
    mkdirSync(join(dir, "project/1_Model"), { recursive: true });
    mkdirSync(join(dir, "project/edits"), { recursive: true });
    const source = join(dir, "project/1_Model/PLAN.dxf");
    writeFileSync(source, bytes);
    writeFileSync(join(dir, "project/edits/rev-1.edit.ts"), editFile("../1_Model/PLAN.dxf", sha));
    const { status, job } = write(join(dir, "project/edits"), "rev-1.edit.ts");
    assert.equal(status, 0, JSON.stringify(job));
    const [file] = job.files;
    assert.equal(file.written, true);
    assert.equal(job.root, join(dir, "project/1_Model"));
    assert.equal(file.copy, join(dir, "project/edits/out/PLAN.dxf"));
    assert.deepEqual(readFileSync(file.copy), bytes);
    assert.deepEqual(readFileSync(source), bytes);
    assert.deepEqual(
      file.checks.map((c: { check: string; passed: boolean }) => [c.check, c.passed]),
      [
        ["read-back", true],
        ["structure", true],
        ["before-after", true],
        ["lint", true],
        ["sheets", true],
      ],
    );
    // No temporary file is left beside the copy, and the record names the copy it wrote.
    assert.deepEqual(readdirSync(join(dir, "project/edits/out")).sort(), [
      ".tsdraft-write.json",
      "PLAN.dxf",
    ]);
    // A second run replaces its own copy; a copy a person changed, or a file it did not make,
    // it never replaces.
    assert.equal(write(join(dir, "project/edits"), "rev-1.edit.ts").status, 0);
    writeFileSync(file.copy, "a person's change");
    const changed = write(join(dir, "project/edits"), "rev-1.edit.ts");
    assert.equal(changed.status, 2);
    assert.match(changed.job.files[0].reason, /changed since a write made it/);
    assert.equal(readFileSync(file.copy, "utf8"), "a person's change");
    mkdirSync(join(dir, "elsewhere"));
    writeFileSync(join(dir, "elsewhere/PLAN.dxf"), "a firm's other drawing");
    const foreign = write(
      join(dir, "project/edits"),
      "rev-1.edit.ts",
      "--out",
      join(dir, "elsewhere"),
    );
    assert.equal(foreign.status, 2);
    assert.match(foreign.job.files[0].reason, /a write did not make/);
    assert.equal(readFileSync(join(dir, "elsewhere/PLAN.dxf"), "utf8"), "a firm's other drawing");
    // With --root and --out, the copy keeps the source's folders under the root.
    const again = write(
      join(dir, "project/edits"),
      "rev-1.edit.ts",
      "--root",
      join(dir, "project"),
      "--out",
      join(dir, "copies"),
    );
    assert.equal(again.status, 0);
    assert.equal(again.job.files[0].copy, join(dir, "copies/1_Model/PLAN.dxf"));
  });
});

test("write refuses a stale hash and writes nothing, and a lock is a warning", async () => {
  await inScratch((dir) => {
    const bytes = Buffer.from(toDXF(sheet));
    writeFileSync(join(dir, "PLAN.dxf"), bytes);
    writeFileSync(join(dir, "stale.edit.ts"), editFile("PLAN.dxf", "0".repeat(64)));
    const stale = write(dir, "stale.edit.ts");
    assert.equal(stale.status, 2);
    assert.equal(stale.job.files[0].written, false);
    assert.match(stale.job.files[0].reason, /changed after the edit was planned/);
    assert.equal(existsSync(join(dir, "out")), false);
    // A lock in any case beside the source.
    writeFileSync(join(dir, "plan.DWL"), "");
    const sha = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(join(dir, "locked.edit.ts"), editFile("PLAN.dxf", sha));
    const locked = write(dir, "locked.edit.ts", "--out", join(dir, "copies"));
    assert.equal(locked.status, 0);
    assert.match(locked.job.files[0].warnings[0], /plan\.DWL beside the file/);
  });
});

test("write refuses an edit file that is not one, a second edit of a file, and a DWG with no editor", async () => {
  await inScratch((dir) => {
    const bytes = Buffer.from(toDXF(sheet));
    const sha = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(join(dir, "PLAN.dxf"), bytes);
    writeFileSync(join(dir, "PLAN.dwg"), bytes);
    writeFileSync(join(dir, "a.edit.ts"), editFile("PLAN.dxf", sha, "a"));
    writeFileSync(join(dir, "b.edit.ts"), editFile("PLAN.dxf", sha, "b"));
    writeFileSync(join(dir, "c.edit.ts"), editFile("PLAN.dwg", sha, "c"));
    writeFileSync(join(dir, "d.edit.ts"), "export default 42;\n");
    const { status, job } = write(
      dir,
      "a.edit.ts",
      "b.edit.ts",
      "c.edit.ts",
      "d.edit.ts",
      "--out",
      join(dir, "copies"),
    );
    assert.equal(status, 2);
    const [a, b, c, d] = job.files;
    assert.equal(a.written, true);
    assert.match(b.reason, /edits the same file/);
    assert.match(c.reason, /No installed package edits \.dwg files/);
    assert.match(d.reason, /must be an edit file/);
  });
});

test("write never replaces the source through a link to its folder, and edits many files in turn", async () => {
  await inScratch((dir) => {
    const bytes = Buffer.from(toDXF(sheet));
    const sha = createHash("sha256").update(bytes).digest("hex");
    mkdirSync(join(dir, "job/1_Model"), { recursive: true });
    mkdirSync(join(dir, "job/edits"), { recursive: true });
    const source = join(dir, "job/1_Model/PLAN.dxf");
    writeFileSync(source, bytes);
    const before = statSync(source).ino;
    symlinkSync(join(dir, "job/1_Model"), join(dir, "link"));
    writeFileSync(join(dir, "job/edits/e.edit.ts"), editFile("../1_Model/PLAN.dxf", sha));
    const linked = write(join(dir, "job/edits"), "e.edit.ts", "--out", join(dir, "link"));
    assert.equal(linked.status, 2);
    assert.match(linked.job.files[0].reason, /is the source itself/);
    assert.equal(statSync(source).ino, before);
    assert.deepEqual(readFileSync(source), bytes);
    // A copy that would land on another source of the job.
    mkdirSync(join(dir, "job/1_Model/staging"));
    const other = join(dir, "job/1_Model/staging/PLAN.dxf");
    writeFileSync(other, bytes);
    const otherBefore = statSync(other).ino;
    writeFileSync(
      join(dir, "job/edits/s.edit.ts"),
      editFile("../1_Model/staging/PLAN.dxf", sha, "s"),
    );
    const staged = write(
      join(dir, "job/edits"),
      "e.edit.ts",
      "s.edit.ts",
      "--out",
      join(dir, "job/1_Model/staging"),
    );
    assert.equal(staged.status, 2);
    assert.match(staged.job.files[0].reason, /a file of the job, which a write never replaces/);
    assert.equal(statSync(other).ino, otherBefore);
    // Twelve edit files of twelve sources, each written.
    const edits: string[] = [];
    for (let i = 0; i < 12; i++) {
      writeFileSync(join(dir, `job/1_Model/P${i}.dxf`), bytes);
      writeFileSync(
        join(dir, `job/edits/p${i}.edit.ts`),
        editFile(`../1_Model/P${i}.dxf`, sha, `p${i}`),
      );
      edits.push(`p${i}.edit.ts`);
    }
    const many = write(join(dir, "job/edits"), ...edits, "--out", join(dir, "many"));
    assert.equal(many.status, 0);
    assert.equal(many.job.files.filter((f: { written: boolean }) => f.written).length, 12);
    assert.deepEqual(
      readdirSync(join(dir, "many")).sort(),
      [".tsdraft-write.json", ...edits.map((_, i) => `P${i}.dxf`)].sort(),
    );
  });
});

test("write refuses an edit file that names other sheets when loaded again, and keeps its deadline", async () => {
  await inScratch((dir) => {
    const bytes = Buffer.from(toDXF(sheet));
    const sha = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(join(dir, "PLAN.dxf"), bytes);
    writeFileSync(join(dir, "A-101.dxf"), bytes);
    // Each load names another sheet, by a count kept on the disk.
    writeFileSync(
      join(dir, "shifty.edit.ts"),
      `import { existsSync, writeFileSync } from "node:fs";\n` +
        `import { editDrawing } from "tsdraft";\n` +
        `const mark = new URL("./loaded", import.meta.url);\n` +
        `const again = existsSync(mark);\n` +
        `writeFileSync(mark, "");\n` +
        `export default editDrawing({ file: "PLAN.dxf", sha256: ${JSON.stringify(sha)}, name: "s", sheets: again ? ["copies/A-101.dxf"] : ["A-101.dxf"] });\n`,
    );
    const shifty = write(dir, "shifty.edit.ts", "--out", join(dir, "copies"));
    assert.equal(shifty.status, 2);
    assert.match(shifty.job.files[0].reason, /named other files the second time/);
    // A helper the edit file starts holds its pipes open; the deadline ends the edit all the same.
    writeFileSync(
      join(dir, "slow.edit.ts"),
      `import { spawn } from "node:child_process";\n` +
        `import { editDrawing } from "tsdraft";\n` +
        `spawn(process.execPath, ["-e", "setTimeout(() => {}, 8000)"], { stdio: "inherit" });\n` +
        `await new Promise((go) => setTimeout(go, 8000));\n` +
        `export default editDrawing({ file: "PLAN.dxf", sha256: ${JSON.stringify(sha)}, name: "slow" });\n`,
    );
    const started = Date.now();
    const slow = write(dir, "slow.edit.ts", "--timeout", "1000", "--out", join(dir, "slow"));
    assert.equal(slow.status, 2);
    assert.match(slow.job.files[0].reason, /took longer than 1 s/);
    assert.ok(Date.now() - started < 6000, `${Date.now() - started} ms`);
  });
});

test("write needs an edit file, and its options go with it", () => {
  const run = spawnSync(process.execPath, [join(root, "src/cli.ts"), "write"], {
    encoding: "utf8",
  });
  assert.equal(run.status, 64);
  assert.match(run.stderr, /Give an edit file/);
  const misuse = spawnSync(
    process.execPath,
    [join(root, "src/cli.ts"), "render", "x.ts", "--root", "."],
    { encoding: "utf8" },
  );
  assert.equal(misuse.status, 64);
});
