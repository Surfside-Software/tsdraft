// The changed sheets: `tsdraft write` draws each layout whose picture an edit changes, with every
// copy of the job in place of its source, as a PNG and a PDF beside the copies. An xref may name only
// a DWG, so the DWG package's tests draw a sheet through its xref.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createDrawing, readDXF, toDXF } from "tsdraft";
import { inScratch } from "./scratch.ts";

const root = join(import.meta.dirname, "..");

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** A plan with a wall and a tag, and its own layout, which shows it through a viewport. */
async function project(dir: string) {
  const d = createDrawing({ units: "ft" });
  d.layer("A-WALL", { color: 1 }).layer("A-ANNO", { color: 3 });
  d.layer("A-WALL", {}, () => d.rect([0, 0], 100, 60));
  d.layer("A-ANNO", {}, () => d.text([10, 50], "TAG", { height: 2 }));
  d.layout("Sheet", { paper: "ARCH D" }, (l) => {
    l.viewport([2, 2], 20, 16, { center: [50, 30], ratio: 120 });
  });
  const plan = toDXF(d.build());
  writeFileSync(join(dir, "plan.dxf"), plan);
  const read = await readDXF(plan, { geometry: true });
  const tag = read.model.entities!.find((e) => e.kind === "text")!.handle!;

  return { plan: sha256(plan), tag };
}

/** An edit file of plan.dxf that names `sheets`, its statements in its body. */
const editFile = (sha: string, sheets: readonly string[], ...statements: string[]) =>
  [
    `import { editDrawing } from "tsdraft";`,
    `export default editDrawing({ file: "./plan.dxf", sha256: ${JSON.stringify(sha)}, name: "rev-1", sheets: ${JSON.stringify(sheets)} }, (e) => {`,
    ...statements.map((s) => `  ${s}`),
    `});`,
  ].join("\n");

function run(cwd: string, ...args: string[]) {
  const done = spawnSync(process.execPath, [join(root, "src/cli.ts"), ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });

  return { status: done.status, json: done.stdout ? JSON.parse(done.stdout) : undefined };
}

interface Check {
  check: string;
  passed: boolean;
  problems: string[];
  sheets?: { file: string; layout: string; png: string; pdf: string }[];
}

const sheetsCheck = (job: { files: { checks?: Check[] }[] }) =>
  job.files[0]!.checks!.find((c) => c.check === "sheets")!;

test("write draws a layout an edit changes as a PNG and a PDF, and takes it away once it does not", () =>
  inScratch(async (dir) => {
    const { plan, tag } = await project(dir);
    writeFileSync(join(dir, "rev-1.edit.ts"), editFile(plan, [], `e.erase("${tag}");`));
    const { status, json } = run(dir, "write", "rev-1.edit.ts");
    assert.equal(status, 0, JSON.stringify(json));
    const check = sheetsCheck(json);
    assert.equal(check.passed, true);
    assert.deepEqual(
      check.sheets!.map((s) => [s.file, s.layout]),
      [[join(dir, "plan.dxf"), "Sheet"]],
    );
    const [drawn] = check.sheets!;
    assert.equal(drawn!.png, join(dir, "out/plan.layout-Sheet.png"));
    assert.equal(drawn!.pdf, join(dir, "out/plan.layout-Sheet.pdf"));
    assert.deepEqual([...readFileSync(drawn!.png).subarray(1, 4)], [0x50, 0x4e, 0x47]);
    assert.equal(readFileSync(drawn!.pdf, "latin1").slice(0, 5), "%PDF-");
    const record = JSON.parse(readFileSync(join(dir, "out/.tsdraft-write.json"), "utf8"));
    assert.deepEqual(record.pictures["plan.layout-Sheet.png"], {
      sha256: sha256(readFileSync(drawn!.png)),
      sheet: join(dir, "plan.dxf"),
    });
    assert.equal(record.copies["plan.dxf"], sha256(readFileSync(join(dir, "out/plan.dxf"))));

    // An edit that changes nothing draws no sheet, and the earlier picture goes.
    writeFileSync(join(dir, "rev-1.edit.ts"), editFile(plan, []));
    const again = run(dir, "write", "rev-1.edit.ts");
    assert.equal(again.status, 0, JSON.stringify(again.json));
    assert.equal(sheetsCheck(again.json).sheets, undefined);
    assert.equal(existsSync(drawn!.png), false);
    assert.equal(existsSync(drawn!.pdf), false);
    const after = JSON.parse(readFileSync(join(dir, "out/.tsdraft-write.json"), "utf8"));
    assert.equal(after.pictures, undefined);
  }));

test("write fails a sheet it cannot draw, and writes no copy", () =>
  inScratch(async (dir) => {
    const { plan, tag } = await project(dir);

    writeFileSync(join(dir, "rev-1.edit.ts"), editFile(plan, ["A-102.dxf"], `e.erase("${tag}");`));

    const { status, json } = run(dir, "write", "rev-1.edit.ts");
    assert.equal(status, 2);
    const [file] = json.files;
    assert.equal(file.written, false);
    assert.match(file.reason, /failed the check sheets/);
    const check = sheetsCheck(json);
    assert.equal(check.passed, false);
    assert.match(check.problems.join("\n"), /A-102\.dxf/);
    assert.equal(existsSync(join(dir, "out/plan.dxf")), false);
    // No temporary copy is left behind.
    const left = existsSync(join(dir, "out")) ? readdirSync(join(dir, "out")) : [];
    assert.deepEqual(left, existsSync(join(dir, "out")) ? [".tsdraft-write.json"] : []);
  }));

test("a write takes away only its own files' pictures, though another file's name starts as theirs", () =>
  inScratch(async (dir) => {
    const { plan, tag } = await project(dir);
    // A second drawing named so that its pictures start as plan.dxf's do.
    const other = readFileSync(join(dir, "plan.dxf"));
    writeFileSync(join(dir, "plan.layout-Detail.dxf"), other);

    writeFileSync(
      join(dir, "other.edit.ts"),
      editFile(plan, [], `e.erase("${tag}");`).replace("./plan.dxf", "./plan.layout-Detail.dxf"),
    );

    const first = run(dir, "write", "other.edit.ts");
    assert.equal(first.status, 0, JSON.stringify(first.json));
    const [kept] = sheetsCheck(first.json).sheets!;
    writeFileSync(join(dir, "rev-1.edit.ts"), editFile(plan, []));
    const second = run(dir, "write", "rev-1.edit.ts");
    assert.equal(second.status, 0, JSON.stringify(second.json));
    assert.equal(existsSync(kept!.png), true);
    assert.equal(existsSync(kept!.pdf), true);
  }));

test("a write whose record cannot be written fails the sheets' check and says so", () =>
  inScratch(async (dir) => {
    const { plan, tag } = await project(dir);
    mkdirSync(join(dir, "out/.tsdraft-write.json"), { recursive: true });
    writeFileSync(join(dir, "rev-1.edit.ts"), editFile(plan, [], `e.erase("${tag}");`));
    const { status, json } = run(dir, "write", "rev-1.edit.ts");
    assert.equal(status, 2);
    assert.match(sheetsCheck(json).problems.join("\n"), /record could not be written/);
    assert.equal(existsSync(join(dir, "out/plan.dxf")), false);
    assert.deepEqual(readdirSync(join(dir, "out")), [".tsdraft-write.json"]);
  }));

test("a sheet an edit names that attaches no xref of its file fails the sheets' check", () =>
  inScratch(async (dir) => {
    const { plan, tag } = await project(dir);
    writeFileSync(join(dir, "A-101.dxf"), readFileSync(join(dir, "plan.dxf")));
    writeFileSync(join(dir, "rev-1.edit.ts"), editFile(plan, ["A-101.dxf"], `e.erase("${tag}");`));
    const { status, json } = run(dir, "write", "rev-1.edit.ts");
    assert.equal(status, 2);
    assert.match(sheetsCheck(json).problems.join("\n"), /A-101\.dxf attaches no xref/);
  }));
