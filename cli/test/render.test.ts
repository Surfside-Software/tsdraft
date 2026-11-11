// `tsdraft render` is the interface agents program against, so these run the command itself.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import type { BuildState } from "../src/state.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

function render(file: string, ...args: string[]): { state: BuildState; status: number | null } {
  const run = spawnSync(process.execPath, [join(root, "src/cli.ts"), "render", file, ...args], {
    encoding: "utf8",
  });
  return { state: JSON.parse(run.stdout) as BuildState, status: run.status };
}

test("render writes the example's SVG and PNG and prints its state", () => {
  const out = mkdtempSync(join(tmpdir(), "tsdraft-render-"));
  const { state, status } = render(join(root, "examples/lot.ts"), "--out", out, "--width", "800");
  assert.equal(status, 0);
  assert.deepEqual(Object.keys(state).sort(), [
    "build",
    "diagnostics",
    "drawing",
    "error",
    "file",
    "finishedAt",
    "log",
    "ms",
    "ok",
    "outputs",
    "pending",
    "schema",
    "session",
    "shownBuild",
    "timings",
  ]);
  assert.equal(state.ok, true);
  assert.equal(state.error, null);
  assert.deepEqual(state.diagnostics, []);
  assert.equal(state.drawing?.units, "ft");
  assert.deepEqual(state.drawing?.extents, { min: [-10, -18], max: [110, 140] });
  assert.equal(state.drawing?.counts.entities, 9);
  assert.deepEqual(
    state.drawing?.layers.find((l) => l.name === "C-PROP"),
    {
      name: "C-PROP",
      color: 7,
      linetype: "PHANTOM",
      lineweight: 0.35,
      off: false,
      frozen: false,
      plot: true,
      entities: 2,
    },
  );

  assert.equal(state.outputs.svg, join(out, "lot.svg"));
  assert.match(readFileSync(state.outputs.svg!, "utf8"), /^<svg [^>]*viewBox=/);
  const png = readFileSync(state.outputs.png!);
  assert.equal(png.toString("latin1", 1, 4), "PNG");
  assert.equal(png.readUInt32BE(16), 800);
  assert.ok(png.readUInt32BE(20) > 800, "the lot is taller than it is wide");
  assert.ok(png.length > 5_000, `a ${png.length}-byte PNG has too little drawn in it`);
});

test("a file that throws gives the error, its file and line, and a non-zero exit", () => {
  const thrower = join(root, "test/fixtures/throws.ts");
  const thrown = render(thrower);
  assert.equal(thrown.status, 1);
  assert.equal(thrown.state.ok, false);
  assert.equal(thrown.state.drawing, null);
  assert.deepEqual(thrown.state.outputs, { svg: null, png: null, pngError: null });
  assert.match(thrown.state.error!.message, /^radius: /);
  assert.equal(thrown.state.error!.file, thrower);
  assert.equal(thrown.state.error!.line, 7);
  // The builder's error is a diagnostic too, with its rule and the call that threw.
  assert.deepEqual(thrown.state.diagnostics, [
    {
      rule: "geometry",
      severity: "error",
      message: thrown.state.error!.message,
      call: { file: thrower, line: 7, column: 3 },
    },
  ]);

  // The library's own source is inside this repository's project, and is still not the user's code.
  mkdirSync(join(root, "examples/out"), { recursive: true });
  const scratch = mkdtempSync(join(root, "examples/out/test-"));
  const source = join(scratch, "source.ts");
  writeFileSync(
    source,
    `import { createDrawing } from ${JSON.stringify(pathToFileURL(join(root, "../src/index.ts")).href)};
const weight: number = 0.33;
export default createDrawing().line([0, 0], [1, 1], { lineweight: weight as 0.5 }).build();\n`,
  );
  const placed = render(source).state.error!;
  rmSync(scratch, { recursive: true, force: true });
  assert.deepEqual([placed.file, placed.line], [source, 3]);

  const broken = join(realpathSync(mkdtempSync(join(tmpdir(), "tsdraft-render-"))), "broken.ts");
  writeFileSync(broken, "const a = 1;\nconst b = (;\nexport default a;\n");
  const syntax = render(broken).state.error!;
  assert.deepEqual(
    [syntax.name, syntax.code, syntax.file, syntax.line, syntax.column],
    ["SyntaxError", "ERR_INVALID_TYPESCRIPT_SYNTAX", broken, 2, 12],
  );
});

test("a build that fails leaves no picture from an earlier run in the default folder", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "tsdraft-render-")));
  const plan = join(dir, "plan.ts");
  writeFileSync(
    plan,
    `export default { format: 0, units: "ft", dxf: "R2018", layers: [{ name: "0", color: 7 }],
  entities: [{ kind: "line", layer: "0", from: [0, 0], to: [1, 0] }] };\n`,
  );
  const { outputs } = render(plan).state;
  assert.deepEqual([existsSync(outputs.svg!), existsSync(outputs.png!)], [true, true]);
  // In a folder the user named, a picture this run did not write may be theirs, and stays.
  const theirs = join(dir, "kept");
  mkdirSync(theirs);
  writeFileSync(join(theirs, "plan.svg"), "theirs");
  writeFileSync(plan, "export default 1;\n");
  assert.deepEqual(render(plan, "--out", theirs).state.outputs.svg, null);
  assert.equal(readFileSync(join(theirs, "plan.svg"), "utf8"), "theirs");
  assert.deepEqual(render(plan).state.outputs, { svg: null, png: null, pngError: null });
  assert.deepEqual([existsSync(outputs.svg!), existsSync(outputs.png!)], [false, false]);
});

test("the state says which blocks a drawing has and where each is inserted", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "tsdraft-render-")));
  const plan = join(dir, "plan.ts");
  const text = { layer: "0", at: [0, 2], height: 1, rotation: 0 };
  const drawing = {
    format: 0,
    units: "ft",
    dxf: "R2018",
    layers: [
      { name: "0", color: 7 },
      { name: "L-PLNT", color: 3 },
    ],
    blocks: [
      {
        name: "TREE",
        entities: [
          { kind: "circle", layer: "0", center: [0, 0], radius: 3 },
          { kind: "circle", layer: "NOPE", center: [1, 0], radius: 1 },
        ],
        attributes: [
          { ...text, tag: "TAG", value: "T-0" },
          { ...text, tag: "SPECIES", value: "OAK", at: [0, -2] },
        ],
      },
      { name: "GROVE", entities: [{ kind: "insert", layer: "0", block: "TREE", at: [5, 0] }] },
      { name: "Ÿ", entities: [], attributes: [{ ...text, tag: "A", value: "v" }] },
    ],
    entities: [
      { kind: "line", layer: "0", from: [0, 0], to: [1, 0] },
      {
        kind: "insert",
        layer: "L-PLNT",
        block: "tree",
        at: [10, 20],
        scale: [2, 2],
        rotation: 90,
        id: "tree-1",
        attributes: { TAG: "T-1" },
      },
      { kind: "insert", layer: "0", block: "GROVE", at: [40, 0] },
      // AutoCAD's layer table keeps these two letters apart, so this insert finds no block.
      { kind: "insert", layer: "0", block: "ÿ", at: [0, 0] },
    ],
  };
  writeFileSync(plan, `export default ${JSON.stringify(drawing)};\n`);
  const { state } = render(plan);
  assert.deepEqual(state.drawing?.counts, {
    layers: 2,
    entities: 4,
    blocks: 3,
    xrefs: 0,
    errors: 2,
    warnings: 0,
  });
  assert.deepEqual(state.drawing?.blocks, [
    { name: "TREE", entities: 2, attributes: ["TAG", "SPECIES"], inserts: 2 },
    { name: "GROVE", entities: 1, attributes: [], inserts: 1 },
    { name: "Ÿ", entities: 0, attributes: ["A"], inserts: 0 },
  ]);
  assert.deepEqual(state.drawing?.inserts, [
    {
      entity: 1,
      block: "tree",
      xref: false,
      layer: "L-PLNT",
      id: "tree-1",
      at: [10, 20],
      scale: [2, 2],
      rotation: 90,
      attributes: { TAG: "T-1", SPECIES: "OAK" },
    },
    {
      entity: 2,
      block: "GROVE",
      xref: false,
      layer: "0",
      id: null,
      at: [40, 0],
      scale: [1, 1],
      rotation: 0,
      attributes: {},
    },
    {
      entity: 3,
      block: "ÿ",
      xref: false,
      layer: "0",
      id: null,
      at: [0, 0],
      scale: [1, 1],
      rotation: 0,
      attributes: {},
    },
  ]);
  // The extents take in what the inserts draw, and a problem inside a block names the block.
  assert.deepEqual(state.drawing?.extents, { min: [0, -3], max: [48, 26] });
  const [inside, unfound] = state.diagnostics;
  assert.deepEqual([unfound?.rule, unfound?.entity], ["undefined-block", 3]);
  assert.deepEqual(
    [inside?.rule, inside?.block, inside?.entity, inside?.kind, inside?.bounds],
    ["undefined-layer", "TREE", 1, "circle", { min: [0, -1], max: [2, 1] }],
  );
});

test("the state lists each xref, and the pictures draw the ones the file gives a drawing for", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "tsdraft-render-")));
  const base = {
    format: 0,
    units: "ft",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    entities: [{ kind: "line", layer: "0", from: [0, 0], to: [10, 4] }],
  };
  const insert = { kind: "insert", layer: "0", at: [100, 0] };
  const sheet = {
    ...base,
    entities: [
      { ...insert, block: "base" },
      { ...insert, block: "SURVEY", id: "survey" },
    ],
    blocks: [{ name: "HOLDER", entities: [{ ...insert, block: "BASE" }] }],
    xrefs: [
      { name: "BASE", path: "../civil/base.dwg" },
      { name: "SURVEY", path: "survey.dwg" },
      { name: "SPARE", path: "spare.dwg" },
    ],
  };
  const plan = join(dir, "plan.ts");
  const file = (xrefs: string): void =>
    writeFileSync(plan, `${xrefs}\nexport default ${JSON.stringify(sheet)};\n`);

  file(`export const xrefs = { base: ${JSON.stringify(base)} };`);
  const { state } = render(plan);
  assert.equal(state.drawing?.counts.xrefs, 3);
  assert.deepEqual(state.drawing?.xrefs, [
    { name: "BASE", path: "../civil/base.dwg", inserts: 2, shown: true, units: "ft" },
    { name: "SURVEY", path: "survey.dwg", inserts: 1, shown: false, units: null },
    { name: "SPARE", path: "spare.dwg", inserts: 0, shown: false, units: null },
  ]);
  assert.deepEqual(
    state.drawing?.inserts.map((i) => [i.block, i.xref]),
    [
      ["base", true],
      ["SURVEY", true],
    ],
  );
  // The extents are those of the one xref that is drawn, and lint warns of the one not placed.
  assert.deepEqual(state.drawing?.extents, { min: [100, 0], max: [110, 4] });
  assert.deepEqual(
    state.diagnostics.map((d) => [d.rule, d.severity, d.xref]),
    [["xref", "warning", "SPARE"]],
  );

  // A drawing given for an xref is checked too. One with an error is reported and not drawn.
  const circle = { kind: "circle", layer: "0", center: [0, 0], radius: -5, id: "bad" };
  file(
    `export const xrefs = { BASE: ${JSON.stringify({ ...base, units: "in", entities: [circle] })} };`,
  );
  const broken = render(plan);
  assert.equal(broken.status, 2);
  assert.deepEqual(broken.state.drawing?.xrefs[0], {
    ...state.drawing?.xrefs[0],
    shown: false,
    units: "in",
  });
  const [error] = broken.state.diagnostics;
  assert.deepEqual(
    [error?.rule, error?.severity, error?.xref, error?.id],
    ["geometry", "error", "BASE", "bad"],
  );
  assert.match(
    error!.message,
    /^Xref "BASE": the drawing given for it has an error, so it is not drawn\. circle #0/,
  );
  assert.deepEqual(broken.state.drawing?.extents, { min: [0, 0], max: [1, 1] });

  file("");
  assert.deepEqual(
    render(plan).state.drawing?.xrefs.map((x) => x.shown),
    [false, false, false],
  );
  // A list that is not one is lint's to report, and the rest of the drawing is still drawn.
  writeFileSync(plan, `export default ${JSON.stringify({ ...base, blocks: null, xrefs: 5 })};\n`);
  const malformed = render(plan);
  assert.equal(malformed.status, 2);
  assert.deepEqual(
    malformed.state.diagnostics.map((d) => d.message),
    ["blocks must be an array", "xrefs must be an array"],
  );
  assert.deepEqual(malformed.state.drawing?.extents, { min: [0, 0], max: [10, 4] });

  file("export const xrefs = { BASE: 5 };");
  assert.match(render(plan).state.error!.message, /The export `xrefs` must be an object/);
});

test("a drawing file Node reads as CommonJS says how to make it a module", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "tsdraft-render-")));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "commonjs" }));
  writeFileSync(join(dir, "plan.ts"), readFileSync(join(root, "test/fixtures/warns.ts")));
  const { error } = render(join(dir, "plan.ts")).state;
  assert.match(error!.message, /Set "type": "module" in the project's package\.json/);
  assert.equal(error!.line, 2);
});

test("a drawing is checked and drawn by its project's copy of tsdraft", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "tsdraft-render-")));
  /** A stand-in for tsdraft that says who it is in its warning and in the size it draws. */
  const stub = (folder: string, who: string, size: number) => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "package.json"),
      '{ "name": "tsdraft", "type": "module", "exports": "./index.js" }\n',
    );
    writeFileSync(
      join(folder, "index.js"),
      `export const drawing = { format: 0, units: "ft", dxf: "R2018", layers: [], entities: [] };
export const createDrawing = () => {};
export const toDXF = () => "";
export const lint = () => [{ rule: "format", severity: "warning", message: "${who}" }];
export const toSVG = () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"></svg>';
`,
    );
  };
  writeFileSync(join(dir, "package.json"), '{ "type": "module" }\n');
  stub(join(dir, "node_modules/tsdraft"), "the project's", 7);
  // A helper package with a copy of its own, which it loads before the drawing loads the project's.
  const helper = join(dir, "node_modules/helper");
  stub(join(helper, "node_modules/tsdraft"), "the helper's", 777);
  writeFileSync(join(helper, "package.json"), '{ "type": "module", "exports": "./index.js" }\n');
  writeFileSync(join(helper, "index.js"), 'export { drawing } from "tsdraft";\n');
  const by = (source: string) => {
    writeFileSync(join(dir, "plan.ts"), source);
    const { state, status } = render(join(dir, "plan.ts"));
    assert.equal(status, 0);
    return [state.diagnostics[0]?.message, state.drawing?.extents.max[0]];
  };

  // Not the command's own library, and not a copy a helper loaded first.
  const own = 'import "helper";\nimport { drawing } from "tsdraft";\nexport default drawing;\n';
  assert.deepEqual(by(own), ["the project's", 7]);
  // The file imports none itself: the one copy the build loaded made the drawing.
  assert.deepEqual(by('export { drawing as default } from "helper";\n'), ["the helper's", 777]);
  // Nor the copy inside a kit that passes the library on, imported before the file's own.
  const kit = join(dir, "node_modules/kit");
  stub(join(kit, "node_modules/tsdraft"), "the kit's", 555);
  writeFileSync(join(kit, "package.json"), '{ "type": "module", "exports": "./index.js" }\n');
  writeFileSync(join(kit, "index.js"), 'export * from "tsdraft";\n');
  assert.deepEqual(by(`import "kit";\n${own}`), ["the project's", 7]);
  // Nor a module of the user's that has a lint and a toSVG of its own.
  writeFileSync(
    join(dir, "labels.ts"),
    `export const lint = () => [{ rule: "format", severity: "warning", message: "the labels'" }];
export const toSVG = () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 3"></svg>';\n`,
  );
  assert.deepEqual(by(`import "./labels.ts";\n${own}`), ["the project's", 7]);
  // A file that imports only that module, and no tsdraft, gets the project's copy.
  const literal = '{ format: 0, units: "ft", dxf: "R2018", layers: [], entities: [] }';
  assert.deepEqual(by(`import "./labels.ts";\nexport default ${literal};\n`), ["the project's", 7]);
  // The file's own import through an alias, to a copy kept in the project under another name.
  stub(join(dir, "source"), "the aliased", 77);
  rmSync(join(dir, "source/package.json"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "type": "module", "imports": { "#cad": "./source/index.js" } }\n',
  );
  const alias = 'import "helper";\nimport { drawing } from "#cad";\nexport default drawing;\n';
  assert.deepEqual(by(alias), ["the aliased", 77]);
  assert.deepEqual(by(`import "./labels.ts";\n${alias}`), ["the aliased", 77]);
  // Several loaded and none imported by the file itself: the project's.
  writeFileSync(join(dir, "other.ts"), 'export { drawing } from "tsdraft";\n');
  const several = 'import "helper";\nexport { drawing as default } from "./other.ts";\n';
  assert.deepEqual(by(several), ["the project's", 7]);
});

test("a diagnostic gives the entity's id and the call that drew it", () => {
  const file = join(root, "test/fixtures/warns.ts");
  const out = mkdtempSync(join(tmpdir(), "tsdraft-render-"));
  const [warning] = render(file, "--out", out).state.diagnostics;
  assert.equal(warning?.rule, "zero-length");
  assert.equal(warning?.id, "stub");
  assert.deepEqual(warning?.call, { file, line: 6, column: 3 });
});

test("a throw in an imported helper is placed in the helper", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "tsdraft-render-")));
  writeFileSync(
    join(dir, "helper.ts"),
    'export function lot() {\n  throw new Error("no lot");\n}\n',
  );
  writeFileSync(
    join(dir, "drawing.ts"),
    'import { lot } from "./helper.ts";\nexport default lot();\n',
  );
  const { error } = render(join(dir, "drawing.ts")).state;
  assert.deepEqual(
    [error!.message, error!.file, error!.line],
    ["no lot", join(dir, "helper.ts"), 2],
  );
});

/** Runs `tsdraft dev` on a file for the length of `use`, and gives it the server's address. */
async function withDev(file: string, use: (base: string) => Promise<void>): Promise<void> {
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
    await use(base);
  } finally {
    server.kill();
  }
}

/** A folder under examples/out, removed after `use`. A project in it links tsdraft itself. */
async function inScratch(use: (dir: string) => Promise<void>): Promise<void> {
  mkdirSync(join(root, "examples/out"), { recursive: true });
  const dir = mkdtempSync(join(root, "examples/out/test-"));
  try {
    await use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("dev answers /state.json?after=<n> with the first build newer than n", () =>
  inScratch(async (dir) => {
    const file = join(dir, "lot.ts");
    const source = readFileSync(join(root, "examples/lot.ts"), "utf8");
    writeFileSync(file, source);
    await withDev(file, async (base) => {
      const first = (await (await fetch(`${base}/state.json?after=0`)).json()) as BuildState;
      assert.deepEqual([first.build, first.ok, first.pending], [1, true, null]);
      writeFileSync(file, `${source}\n// an edit\n`);
      const next = await fetch(`${base}/state.json?after=1&session=${first.session}`);
      const state = (await next.json()) as BuildState;
      assert.equal(next.status, 200);
      assert.equal(next.headers.get("x-tsdraft-session"), first.session);
      assert.deepEqual([state.build, state.ok, state.pending], [2, true, null]);
      assert.equal(state.outputs.svg, `${base}/drawing.svg?session=${first.session}&build=2`);
    });
  }));

test("dev rebuilds when a file outside the project that the drawing imports changes", () =>
  inScratch(async (dir) => {
    mkdirSync(join(dir, "project/node_modules"), { recursive: true });
    mkdirSync(join(dir, "shared"));
    writeFileSync(join(dir, "project/package.json"), "{}\n");
    symlinkSync(join(root, ".."), join(dir, "project/node_modules/tsdraft"));
    const helper = join(dir, "shared/helper.ts");
    writeFileSync(helper, "export const width = 10;\n");
    const file = join(dir, "project/drawing.ts");
    writeFileSync(
      file,
      'import { createDrawing } from "tsdraft";\nimport { width } from "../shared/helper.ts";\n' +
        "const d = createDrawing();\nd.line([0, 0], [width, 0]);\nexport default d.build();\n",
    );
    await withDev(file, async (base) => {
      const first = (await (await fetch(`${base}/state.json?after=0`)).json()) as BuildState;
      assert.deepEqual(first.drawing?.extents.max, [10, 0]);
      writeFileSync(helper, "export const width = 20;\n");
      const next = await fetch(`${base}/state.json?after=1&session=${first.session}`);
      const state = (await next.json()) as BuildState;
      assert.equal(next.status, 200);
      assert.deepEqual(
        [state.build, state.pending, state.drawing?.extents.max],
        [2, null, [20, 0]],
      );
    });
  }));

test("dev rebuilds when a package link in node_modules is pointed at another folder", () =>
  inScratch(async (dir) => {
    for (const [name, width] of [
      ["a", 10],
      ["b", 20],
    ] as const) {
      mkdirSync(join(dir, name));
      writeFileSync(
        join(dir, name, "package.json"),
        '{ "type": "module", "exports": "./index.js" }\n',
      );
      writeFileSync(join(dir, name, "index.js"), `export const width = ${width};\n`);
    }
    mkdirSync(join(dir, "project/node_modules"), { recursive: true });
    writeFileSync(join(dir, "project/package.json"), "{}\n");
    symlinkSync(join(root, ".."), join(dir, "project/node_modules/tsdraft"));
    const link = join(dir, "project/node_modules/shape");
    symlinkSync("../../a", link);
    const file = join(dir, "project/drawing.ts");
    writeFileSync(
      file,
      'import { createDrawing } from "tsdraft";\nimport { width } from "shape";\n' +
        "const d = createDrawing();\nd.line([0, 0], [width, 0]);\nexport default d.build();\n",
    );
    await withDev(file, async (base) => {
      const first = (await (await fetch(`${base}/state.json?after=0`)).json()) as BuildState;
      assert.deepEqual(first.drawing?.extents.max, [10, 0]);
      symlinkSync("../../b", `${link}.new`);
      renameSync(`${link}.new`, link);
      const next = await fetch(`${base}/state.json?after=1&session=${first.session}`);
      const state = (await next.json()) as BuildState;
      assert.equal(next.status, 200);
      assert.deepEqual(
        [state.build, state.pending, state.drawing?.extents.max],
        [2, null, [20, 0]],
      );
    });
  }));
