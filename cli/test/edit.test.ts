// The preview of an edit file: `render` and `dev` draw the firm's file as it will plot after the
// edit, a second picture of what the edit changes, and each statement with its call and its box.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createDrawing, readDXF, toDXF } from "tsdraft";
import type { BuildState } from "../src/state.ts";
import { inScratch } from "./scratch.ts";

const root = join(import.meta.dirname, "..");

/** A plan of a wall, a tag and a note, and a sheet that shows it through a viewport. */
async function plan(dir: string) {
  const d = createDrawing({ units: "ft" });
  d.layer("A-WALL", { color: 1 }).layer("A-ANNO", { color: 3 });
  d.layer("A-WALL", {}, () => d.rect([0, 0], 100, 60));
  d.layer("A-ANNO", {}, () => {
    d.text([10, 50], "TAG", { height: 2 });
    d.circle([50, 30], 5);
  });
  d.layout("Sheet", { paper: "ARCH D" }, (s) => {
    s.viewport([2, 2], 20, 16, { center: [50, 30], ratio: 120 });
  });
  const bytes = new TextEncoder().encode(toDXF(d.build()));
  writeFileSync(join(dir, "plan.dxf"), bytes);
  const read = await readDXF(bytes, { geometry: true });
  const [wall, tag, circle] = (read.model.entities ?? []).map((e) => e.handle!);

  return { sha: createHash("sha256").update(bytes).digest("hex"), wall, tag, circle };
}

/** An edit file of plan.dxf, its statements on the lines after the first. */
const editFile = (sha256: string, ...statements: string[]) =>
  [
    `import { editDrawing } from "tsdraft";`,
    `export default editDrawing({ file: "./plan.dxf", sha256: ${JSON.stringify(sha256)}, name: "rev-1" }, (e) => {`,
    ...statements.map((s) => `  ${s}`),
    `});`,
  ].join("\n");

function run(...args: string[]) {
  const done = spawnSync(process.execPath, [join(root, "src/cli.ts"), ...args], {
    encoding: "utf8",
    timeout: 120_000,
  });

  return { status: done.status, json: JSON.parse(done.stdout) };
}

const render = (file: string, out: string) => {
  const { status, json } = run("render", file, "--out", out, "--width", "400");

  // SAFETY: the command writes its state as the JSON of a BuildState.
  return { status, state: json as BuildState };
};

test("render draws an edit file's source after the edit, and a picture of what it changes", () =>
  inScratch(async (dir) => {
    const { sha, wall, tag, circle } = await plan(dir);
    const file = join(dir, "rev-1.edit.ts");
    writeFileSync(
      file,
      editFile(
        sha,
        `e.erase(${JSON.stringify(tag)});`,
        `e.move(["${circle}"], { by: [20, 0] });`,
        `e.change("${wall}", { color: 5 });`,
      ),
    );
    const { status, state } = render(file, dir);
    assert.equal(status, 0, JSON.stringify(state.error ?? state.diagnostics));
    const edited = readFileSync(state.outputs.svg!, "utf8");
    assert.doesNotMatch(edited, new RegExp(`data-id="${tag}"`));
    assert.match(edited, /<circle cx="70" cy="30"/);
    const changes = state.outputs.changes!;
    assert.equal(changes.svg, join(dir, "rev-1.edit.changes.svg"));
    assert.equal(changes.png, join(dir, "rev-1.edit.changes.png"));
    const marked = readFileSync(changes.svg!, "utf8");

    for (const mark of ["erased", "moved-from", "moved"])
      assert.match(marked, new RegExp(`data-change="${mark}"`));
    assert.deepEqual(
      changes.layouts.map((l) => [l.name, l.svg]),
      [["Sheet", join(dir, "rev-1.edit.layout-Sheet.changes.svg")]],
    );
    assert.match(readFileSync(changes.layouts[0]!.svg, "utf8"), /data-change="moved"/);
    const { edit } = state;
    // The changed wall is drawn again, as the moved circle is.
    assert.deepEqual(
      [edit?.source, edit?.applied, edit?.erased, edit?.moved],
      [join(dir, "plan.dxf"), true, 1, 2],
    );
    assert.deepEqual(
      edit?.statements.map((s) => [s.kind, s.handles, s.call?.file, s.call?.line]),
      [
        ["erase", [tag], file, 3],
        ["move", [circle], file, 4],
        ["change", [wall], file, 5],
      ],
    );
    // The move's box holds the circle where it was and where it goes, and so does its sheet's.
    assert.deepEqual(edit?.statements[1]!.box, { min: [45, 25], max: [75, 35] });
    assert.equal(edit?.statements[1]!.layouts[0]?.name, "Sheet");
    // A change's box is its entity's, so `--view` goes to it.
    assert.deepEqual(edit?.statements[2]!.box, { min: [0, 0], max: [100, 60] });
  }));

test("an edit planned on other bytes is an error, and the pictures draw the file as it is", () =>
  inScratch(async (dir) => {
    const { tag } = await plan(dir);
    const file = join(dir, "stale.edit.ts");
    writeFileSync(file, editFile("0".repeat(64), `e.erase(${JSON.stringify(tag)});`));
    const { status, state } = render(file, dir);
    assert.equal(status, 2);
    assert.equal(state.ok, true);
    assert.equal(state.edit?.applied, false);
    const [hash] = state.diagnostics;
    assert.equal(hash?.rule, "edit-hash");
    assert.match(hash!.message, /draw it as it is, without the edit/);
    assert.match(readFileSync(state.outputs.svg!, "utf8"), new RegExp(`data-id="${tag}"`));
  }));

test("lintEdit's errors come with their calls, and write refuses the edit, naming them", () =>
  inScratch(async (dir) => {
    const { sha, tag } = await plan(dir);
    const file = join(dir, "missing.edit.ts");
    writeFileSync(file, editFile(sha, `e.erase(${JSON.stringify(tag)});`, `e.erase("FFFFF");`));
    const { status, state } = render(file, dir);
    assert.equal(status, 2);
    const missing = state.diagnostics.find((d) => d.rule === "edit-missing");
    assert.deepEqual(
      [missing?.severity, missing?.statement, missing?.handle, missing?.call?.line],
      ["error", 1, "FFFFF", 4],
    );
    // The statement that applies is drawn.
    assert.equal(state.edit?.erased, 1);
    const written = run("write", file, "--out", join(dir, "out"));
    assert.equal(written.status, 2);
    const [result] = written.json.files;
    assert.equal(result.written, false);
    assert.match(result.reason, /^lintEdit gives an error for the edit, the first edit-missing/);
    assert.deepEqual(
      result.diagnostics.map((d: { rule: string; call?: { line: number } }) => [
        d.rule,
        d.call?.line,
      ]),
      [["edit-missing", 4]],
    );
  }));

test("dev serves the picture of an edit's changes at ?changes=1, drawn when asked for", () =>
  inScratch(async (dir) => {
    const { sha, tag } = await plan(dir);
    const file = join(dir, "rev-1.edit.ts");
    writeFileSync(file, editFile(sha, `e.erase(${JSON.stringify(tag)});`));

    const server = spawn(process.execPath, [join(root, "src/cli.ts"), "dev", file], {
      stdio: ["ignore", "pipe", "inherit"],
    });

    try {
      const base = await new Promise<string>((resolve) =>
        server.stdout.on("data", (b: Buffer) => {
          const url = /http:\/\/\S+/.exec(b.toString())?.[0];

          if (url) resolve(url);
        }),
      );

      // SAFETY: the server answers state.json with the JSON of a BuildState.
      const state = (await (await fetch(`${base}/state.json?after=0`)).json()) as BuildState;
      assert.equal(state.ok, true, JSON.stringify(state.error));
      const at = `${base}/drawing.svg?session=${state.session}&build=${state.build}`;
      assert.equal(state.outputs.changes?.svg, `${at}&changes=1`);
      assert.equal(state.outputs.changes?.layouts[0]?.svg, `${at}&layout=Sheet&changes=1`);
      const changes = await (await fetch(state.outputs.changes!.svg!)).text();
      assert.match(changes, /data-change="erased"/);
      const sheet = await fetch(state.outputs.changes!.layouts[0]!.svg);
      assert.equal(sheet.status, 200);
      const edited = await (await fetch(state.outputs.svg!)).text();
      assert.doesNotMatch(edited, /data-change=/);
    } finally {
      server.kill();
    }
  }));
