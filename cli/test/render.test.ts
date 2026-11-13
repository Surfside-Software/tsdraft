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
import { after, test } from "node:test";
import { BUILT_IN_STANDARD } from "tsdraft";
import type { BuildState } from "../src/state.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

// Each test makes its folders in this one, which is removed when the file's tests end.
const temp = mkdtempSync(join(tmpdir(), "tsdraft-render-"));
after(() => rmSync(temp, { recursive: true, force: true }));
const tempDir = (): string => mkdtempSync(join(temp, "case-"));

function render(file: string, ...args: string[]): { state: BuildState; status: number | null } {
  const run = spawnSync(process.execPath, [join(root, "src/cli.ts"), "render", file, ...args], {
    encoding: "utf8",
  });
  return { state: JSON.parse(run.stdout) as BuildState, status: run.status };
}

test("render writes the example's SVG and PNG and prints its state", () => {
  const out = tempDir();
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
  // The street's name hangs below the lot, with what its font draws below the baseline.
  assert.deepEqual(state.drawing?.extents, { min: [-10, -18.833333], max: [110, 140] });
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
  assert.deepEqual(thrown.state.outputs, {
    svg: null,
    png: null,
    pngError: null,
    pngFonts: [],
    layouts: [],
    view: null,
  });
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

  const broken = join(realpathSync(tempDir()), "broken.ts");
  writeFileSync(broken, "const a = 1;\nconst b = (;\nexport default a;\n");
  const syntax = render(broken).state.error!;
  assert.deepEqual(
    [syntax.name, syntax.code, syntax.file, syntax.line, syntax.column],
    ["SyntaxError", "ERR_INVALID_TYPESCRIPT_SYNTAX", broken, 2, 12],
  );
});

test("a build that fails leaves no picture from an earlier run in the default folder", () => {
  const dir = realpathSync(tempDir());
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
  assert.deepEqual(render(plan).state.outputs, {
    svg: null,
    png: null,
    pngError: null,
    pngFonts: [],
    layouts: [],
    view: null,
  });
  assert.deepEqual([existsSync(outputs.svg!), existsSync(outputs.png!)], [false, false]);
});

test("the state says which blocks a drawing has and where each is inserted", () => {
  const dir = realpathSync(tempDir());
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
    layouts: 0,
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
  const dir = realpathSync(tempDir());
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
  // An item lint reports that cannot be drawn is left out. The rest is drawn, and all is counted.
  const dot = { kind: "line", layer: "0", from: [2, 2], to: [2, 2] };
  const entities = [{ kind: "wedge" }, ...base.entities, dot];
  writeFileSync(
    plan,
    `export default ${JSON.stringify({ ...base, entities, blocks: [{}], xrefs: [null] })};\n`,
  );
  const partly = render(plan);
  assert.equal(partly.status, 2);
  assert.deepEqual(partly.state.drawing?.omitted, ["blocks[0]", "entities[0]", "xrefs[0]"]);
  assert.deepEqual(
    [partly.state.ok, partly.state.drawing?.counts, partly.state.drawing?.extents],
    [
      true,
      { layers: 1, entities: 3, blocks: 1, xrefs: 1, layouts: 0, errors: 4, warnings: 1 },
      { min: [0, 0], max: [10, 4] },
    ],
  );
  assert.deepEqual(
    partly.state.diagnostics.map((d) => [d.item ?? d.entity, d.kind]),
    [
      ["blocks[0]", undefined],
      ["blocks[0]", undefined],
      ["xrefs[0]", undefined],
      ["entities[0]", undefined],
      [2, "line"],
    ],
  );

  file("export const xrefs = { BASE: 5 };");
  assert.match(render(plan).state.error!.message, /The export `xrefs` must be an object/);
});

test("a drawing file Node reads as CommonJS says how to make it a module", () => {
  const dir = realpathSync(tempDir());
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "commonjs" }));
  writeFileSync(join(dir, "plan.ts"), readFileSync(join(root, "test/fixtures/warns.ts")));
  const { error } = render(join(dir, "plan.ts")).state;
  assert.match(error!.message, /Set "type": "module" in the project's package\.json/);
  assert.equal(error!.line, 2);
});

test("a drawing is checked and drawn by its project's copy of tsdraft", () => {
  const dir = realpathSync(tempDir());
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
  const out = tempDir();
  const [warning] = render(file, "--out", out).state.diagnostics;
  assert.equal(warning?.rule, "zero-length");
  assert.equal(warning?.id, "stub");
  assert.deepEqual(warning?.call, { file, line: 6, column: 3 });
});

test("a throw in an imported helper is placed in the helper", () => {
  const dir = realpathSync(tempDir());
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
      // Saved by a rename, as one change: a write in place is a truncate and then a write, which
      // a busy machine can report far enough apart that each starts a build.
      const edit = join(dir, "lot.ts.new");
      writeFileSync(edit, `${source}\n// an edit\n`);
      renameSync(edit, file);
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

test("a drawing with a layout gets a picture of its sheet, and the state says what each viewport shows", () => {
  const dir = realpathSync(tempDir());
  const plan = join(dir, "plan.ts");
  const drawing = {
    format: 0,
    units: "ft",
    dxf: "R2018",
    layers: [
      { name: "0", color: 7 },
      { name: "VIEW", color: 4, plot: false },
    ],
    entities: [{ kind: "line", layer: "0", from: [100, 100], to: [200, 100] }],
    textStyles: [{ name: "TITLE", font: "Arial" }],
    xrefs: [{ name: "BORDER", path: "border.dwg" }],
    blocks: [
      {
        name: "TITLE BLOCK",
        entities: [],
        attributes: [
          { tag: "SHEET", value: "-", layer: "0", at: [1, 1], height: 0.25, rotation: 0 },
          {
            tag: "DATE",
            value: "-",
            layer: "0",
            at: [1, 2],
            height: 0.25,
            rotation: 0,
            style: "TITLE",
          },
        ],
      },
    ],
    layouts: [
      {
        name: "A-101 plan",
        paper: "ARCH D",
        viewports: [
          // On the layer VIEW, named in another case: its border does not plot.
          {
            id: "plan",
            layer: "view",
            corner: [1, 1],
            width: 34,
            height: 22,
            center: [170, 110],
            ratio: 120,
          },
          // Past the paper, and over a part of model space with nothing in it.
          { layer: "0", corner: [30, 20], width: 10, height: 2, center: [900, 900], ratio: 12 },
        ],
        entities: [{ kind: "line", layer: "NOPE", from: [0, 0], to: [36, 24] }],
      },
      {
        name: "Fields",
        paper: "ANSI B",
        viewports: [],
        // The title block, found whatever the case of its name, with one field set.
        entities: [
          {
            kind: "insert",
            layer: "0",
            block: "title block",
            at: [2, 3],
            attributes: { SHEET: "A-102" },
          },
          { kind: "insert", layer: "0", block: "BORDER", at: [0, 0] },
        ],
      },
    ],
  };
  writeFileSync(plan, `export default ${JSON.stringify(drawing)};\n`);
  const { state, status } = render(plan, "--width", "400");
  assert.equal(status, 2);
  assert.equal(state.drawing?.counts.layouts, 2);
  assert.deepEqual(state.drawing?.layouts, [
    {
      name: "A-101 plan",
      paper: "ARCH D",
      paperUnits: "in",
      width: 36,
      height: 24,
      plotStyle: "monochrome.ctb",
      entities: 1,
      inserts: [],
      dimensions: [],
      viewports: [
        {
          id: "plan",
          layer: "view",
          border: false,
          rectangle: { min: [1, 1], max: [35, 23] },
          ratio: 120,
          center: [170, 110],
          shows: { min: [0, 0], max: [340, 220] },
        },
        {
          id: null,
          layer: "0",
          border: true,
          rectangle: { min: [30, 20], max: [40, 22] },
          ratio: 12,
          center: [900, 900],
          shows: { min: [895, 899], max: [905, 901] },
        },
      ],
    },
    {
      name: "Fields",
      paper: "ANSI B",
      paperUnits: "in",
      width: 17,
      height: 11,
      plotStyle: "monochrome.ctb",
      entities: 2,
      viewports: [],
      dimensions: [],
      inserts: [
        {
          entity: 0,
          block: "title block",
          xref: false,
          layer: "0",
          id: null,
          at: [2, 3],
          scale: [1, 1],
          rotation: 0,
          attributes: { SHEET: "A-102", DATE: "-" },
        },
        {
          entity: 1,
          block: "BORDER",
          xref: true,
          layer: "0",
          id: null,
          at: [0, 0],
          scale: [1, 1],
          rotation: 0,
          attributes: {},
        },
      ],
    },
  ]);
  // The block and the xref are each placed once, on a layout.
  assert.deepEqual(state.drawing?.blocks, [
    { name: "TITLE BLOCK", entities: 0, attributes: ["SHEET", "DATE"], inserts: 1 },
  ]);
  assert.deepEqual(state.drawing?.xrefs, [
    { name: "BORDER", path: "border.dwg", inserts: 1, shown: false, units: null },
  ]);
  // Model space has no text. The sheet has text in both fonts, and the PNG sets an SHX font
  // in the renderer's own face.
  assert.deepEqual(state.outputs.pngFonts, []);
  const fonts = state.outputs.layouts[1]!.pngFonts;
  assert.deepEqual(fonts[1], { font: "txt.shx", face: "JetBrains Mono" });
  assert.deepEqual([fonts.length, fonts[0]?.font], [2, "Arial"]);
  // A diagnostic on a layout is boxed on the sheet: the entity, and the viewport's rectangle.
  assert.deepEqual(
    state.diagnostics.map((d) => [d.rule, d.severity, d.layout, d.entity ?? d.viewport, d.bounds]),
    [
      ["undefined-layer", "error", "A-101 plan", 0, { min: [0, 0], max: [36, 24] }],
      ["viewport", "warning", "A-101 plan", 1, { min: [30, 20], max: [40, 22] }],
      ["viewport", "warning", "A-101 plan", 1, { min: [30, 20], max: [40, 22] }],
    ],
  );
  // Each layout is drawn as a sheet of its paper, the one with a lint error too.
  assert.deepEqual(
    state.outputs.layouts.map((made) => made.name),
    ["A-101 plan", "Fields"],
  );
  const [, sheet] = state.outputs.layouts;
  assert.equal(sheet?.svg, join(dir, "out", "plan.layout-Fields.svg"));
  assert.match(readFileSync(sheet!.svg, "utf8"), /viewBox="0 -11 17 11" data-layout="Fields"/);
  assert.ok(sheet?.png && existsSync(sheet.png));
  // A layout the drawing no longer has leaves no picture behind.
  writeFileSync(plan, `export default ${JSON.stringify({ ...drawing, layouts: [] })};\n`);
  assert.deepEqual(render(plan).state.outputs.layouts, []);
  assert.equal(existsSync(sheet!.svg), false);
});

test("the state lists each dimension with the number it measures and the text AutoCAD draws", () => {
  const dir = realpathSync(tempDir());
  const plan = join(dir, "plan.ts");
  const drawing = {
    format: 0,
    units: "ft",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    dimensionStyles: [
      {
        name: "TICK",
        textHeight: 1,
        arrowhead: "architectural-tick",
        arrowSize: 1,
        extensionOffset: 0.5,
        extensionBeyond: 1,
        textGap: 0.5,
        precision: 1,
        suffix: "'",
      },
    ],
    entities: [
      { kind: "line", layer: "0", from: [0, 0], to: [30, 40] },
      {
        kind: "linear-dimension",
        layer: "0",
        id: "span",
        style: "TICK",
        from: [0, 0],
        to: [30, 40],
        line: [0, -10],
      },
      // A style that is not defined: lint refuses it, and it measures nothing here.
      {
        kind: "linear-dimension",
        layer: "0",
        style: "NONE",
        from: [0, 0],
        to: [9, 0],
        line: [0, 5],
      },
    ],
    layouts: [
      {
        name: "A-101",
        paper: "ANSI B",
        viewports: [],
        entities: [
          {
            kind: "aligned-dimension",
            layer: "0",
            style: "tick",
            from: [1, 1],
            to: [4, 5],
            offset: 2,
            text: "<> ON PAPER",
          },
        ],
      },
    ],
  };
  writeFileSync(plan, `export default ${JSON.stringify(drawing)};\n`);
  const { state, status } = render(plan, "--width", "400");
  assert.equal(status, 2);
  assert.deepEqual(state.drawing?.dimensions, [
    {
      entity: 1,
      id: "span",
      layer: "0",
      kind: "linear",
      style: "TICK",
      measurement: 30,
      text: "30.0'",
    },
    {
      entity: 2,
      id: null,
      layer: "0",
      kind: "linear",
      style: "NONE",
      measurement: null,
      text: null,
    },
  ]);
  assert.deepEqual(state.drawing?.layouts[0]?.dimensions, [
    {
      entity: 0,
      id: null,
      layer: "0",
      kind: "aligned",
      style: "tick",
      measurement: 5,
      text: "5.0' ON PAPER",
    },
  ]);
});

test("a malformed layout is reported and left out, and the rest of the drawing is drawn", () => {
  const dir = realpathSync(tempDir());
  const plan = join(dir, "plan.ts");
  const view = { layer: "0", corner: [1, 1], width: 10, height: 8, center: [5, 0], ratio: 12 };
  const line = { kind: "line", layer: "0", from: [0, 0], to: [10, 0] };
  const drawing = {
    format: 0,
    units: "ft",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    entities: [line],
    layouts: [
      null,
      {
        name: "Kept",
        paper: "ANSI B",
        viewports: [{ ...view, ratio: "x" }, view],
        entities: [null, line],
      },
      { name: "No paper", paper: 5, viewports: [], entities: [] },
    ],
  };
  writeFileSync(plan, `export default ${JSON.stringify(drawing)};\n`);
  const { state, status } = render(plan, "--width", "300");
  assert.deepEqual([status, state.ok, state.drawing?.counts.layouts], [2, true, 3]);
  assert.deepEqual(
    state.diagnostics.map((d) => [d.rule, d.item]),
    [
      ["layout", "layouts[0]"],
      ["viewport", "layouts[1].viewports[0]"],
      ["format", "layouts[1].entities[0]"],
      ["layout", "layouts[2]"],
    ],
  );
  assert.deepEqual(state.drawing?.omitted, [
    "layouts[0]",
    "layouts[1].entities[0]",
    "layouts[1].viewports[0]",
    "layouts[2]",
  ]);
  // The layout that can be read keeps its sound viewport, and its line keeps its index.
  assert.deepEqual(
    state.drawing?.layouts.map((l) => [l.name, l.viewports.length, l.entities]),
    [["Kept", 1, 2]],
  );
  const [sheet] = state.outputs.layouts;
  assert.deepEqual([state.outputs.layouts.length, sheet?.name], [1, "Kept"]);
  const svg = readFileSync(sheet!.svg, "utf8");
  assert.match(svg, /data-viewport="0"/);
  assert.match(svg, /<line x1="0" y1="0" x2="10" y2="0" [^>]*data-entity="1"\/>/);
});

test("render warns of text that plots badly, after lint's diagnostics and with exit 0", () => {
  const out = tempDir();
  const crowded = join(root, "test/fixtures/crowded.ts");
  const { state, status } = render(crowded, "--out", out);
  assert.equal(status, 0);
  assert.equal(state.schema, 3);
  assert.deepEqual(state.drawing?.counts.errors, 0);
  assert.deepEqual(state.drawing?.counts.warnings, 3);
  assert.equal(typeof state.timings.inspect, "number");
  const [past, over, off] = state.diagnostics;
  // Each names the entity of its space that draws the text, and brings its own box.
  assert.deepEqual(
    { ...past, message: undefined },
    {
      rule: "text-leaves-boundary",
      severity: "warning",
      message: undefined,
      entity: 1,
      id: "note",
      layer: "0",
      kind: "text",
      bounds: { min: [1, 6], max: [17.833333, 6.5] },
      other: { entity: 0, id: "border" },
      call: { file: crowded, line: 8, column: 3 },
    },
  );
  assert.match(past!.message, /^Text "THIS NOTE IS TOO LONG FOR ITS SHEET" starts inside/);
  assert.deepEqual(
    [over!.rule, over!.entity, over!.id, over!.kind, over!.other, over!.bounds],
    ["text-overlaps-text", 3, "over", "text", { entity: 2 }, { min: [1, 2], max: [3.5, 2.7] }],
  );
  // On the sheet, the attribute of an insert: the insert's index, with the attribute's tag.
  assert.deepEqual(
    [off!.rule, off!.layout, off!.entity, off!.attribute, off!.id, off!.kind, off!.block],
    ["text-off-paper", "S-1", 0, "MARK", "tag", "insert", undefined],
  );
  assert.deepEqual(off!.bounds, { min: [10.8, 8], max: [11.133333, 8.25] });
});

test("render warns where the drawing breaks the file's export intent, with exit 0", () => {
  const out = tempDir();
  const file = join(root, "test/fixtures/setback.ts");
  const { state, status } = render(file, "--out", out);
  assert.equal(status, 0);
  assert.deepEqual(state.drawing?.counts.errors, 0);
  assert.deepEqual(state.drawing?.counts.warnings, 1);
  assert.equal(typeof state.timings.intent, "number");
  const [warning] = state.diagnostics;
  assert.deepEqual(
    { ...warning, message: undefined },
    {
      rule: "footprint-in-setback",
      severity: "warning",
      message: undefined,
      item: "setbacks[0]",
      entity: 1,
      id: "house",
      layer: "C-BLDG",
      call: { file, line: 8, column: 41 },
      side: 0,
      required: 25,
      provided: 15,
      bounds: { min: [0, -25], max: [50, 40] },
      other: { entity: 0, id: "lot" },
      kind: "polyline",
    },
  );
  assert.match(warning!.message, /^Footprint "house" is 15 from side 0 of property line "lot"/);
});

test("an intent that the drawing's copy of tsdraft cannot check is warned of, never passed over", () => {
  const dir = realpathSync(tempDir());
  writeFileSync(join(dir, "package.json"), '{ "type": "module" }\n');
  const library = join(dir, "node_modules/tsdraft");
  mkdirSync(library, { recursive: true });
  writeFileSync(
    join(library, "package.json"),
    '{ "name": "tsdraft", "type": "module", "exports": "./index.js" }\n',
  );
  /** A stand-in for tsdraft, with the `checkIntent` given or none. */
  const stub = (checkIntent: string) =>
    writeFileSync(
      join(library, "index.js"),
      `export const drawing = { format: 0, units: "ft", dxf: "R2018", layers: [], entities: [] };
export const createDrawing = () => {};
export const toDXF = () => "";
export const lint = () => [];
export const toSVG = () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>';
${checkIntent}`,
    );
  writeFileSync(
    join(dir, "plan.ts"),
    'import { drawing } from "tsdraft";\nexport default drawing;\nexport const intent = { setbacks: [] };\n',
  );
  const warned = () => {
    const { state, status } = render(join(dir, "plan.ts"));
    assert.equal(status, 0);
    return state.diagnostics.map((d) => [d.rule, d.message]);
  };
  stub("");
  assert.deepEqual(warned(), [
    [
      "intent-unchecked",
      "The copy of tsdraft this drawing imports has no checkIntent, so the export `intent` was not checked. Update it",
    ],
  ]);
  stub('export const checkIntent = () => { throw new Error("no room"); };\n');
  assert.deepEqual(warned(), [
    [
      "intent-unchecked",
      "checkIntent stopped with an error, so the export `intent` was not checked: no room",
    ],
  ]);
});

test("lint holds the drawing to the file's export `standard`, whose errors exit 2", () =>
  inScratch(async (dir) => {
    const file = join(dir, "wall.ts");
    const write = (exported: string) =>
      writeFileSync(
        file,
        `import { BUILT_IN_STANDARD as standard, createDrawing } from "tsdraft";
const d = createDrawing({ units: "ft" });
d.layer("A-WALL", { color: 2 }, () => d.rect([0, 0], 10, 10));
export default d.build();
${exported}\n`,
      );
    write("export { standard };");
    const held = render(file, "--out", join(dir, "out"));
    assert.equal(held.status, 2);
    const { id, version, hash } = BUILT_IN_STANDARD;
    assert.deepEqual(held.state.drawing?.standard, { id, version, hash, checked: true });
    assert.ok(held.state.diagnostics.some((d) => d.rule === "layer-outside-standard"));
    write("");
    const alone = render(file, "--out", join(dir, "out"));
    assert.deepEqual(
      [alone.status, alone.state.drawing?.standard, alone.state.diagnostics],
      [0, null, []],
    );

    const example = render(join(root, "../examples/site-plan.ts"), "--out", join(dir, "out"));
    assert.equal(example.status, 0);
    assert.deepEqual(example.state.diagnostics, []);
    assert.deepEqual(
      [example.state.drawing?.standard?.id, example.state.drawing?.standard?.checked],
      ["site-plan-example", true],
    );
  }));

test("a standard that the drawing's copy of tsdraft cannot check is warned of, never passed over", () => {
  const dir = realpathSync(tempDir());
  writeFileSync(join(dir, "package.json"), '{ "type": "module" }\n');
  const library = join(dir, "node_modules/tsdraft");
  mkdirSync(library, { recursive: true });
  writeFileSync(
    join(library, "package.json"),
    '{ "name": "tsdraft", "type": "module", "exports": "./index.js" }\n',
  );
  // A copy from before standards: its lint would take the export and check nothing of it.
  writeFileSync(
    join(library, "index.js"),
    `export const drawing = { format: 0, units: "ft", dxf: "R2018", layers: [], entities: [] };
export const createDrawing = () => {};
export const toDXF = () => "";
export const lint = (d, options) =>
  options?.standard ? [{ rule: "layer", severity: "error", message: "given a standard" }] : [];
export const toSVG = () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>';\n`,
  );
  writeFileSync(
    join(dir, "plan.ts"),
    `import { drawing } from "tsdraft";
export default drawing;
export const standard = { id: "acme", version: "2026.1", hash: "0d1f" };\n`,
  );
  const { state, status } = render(join(dir, "plan.ts"));
  assert.equal(status, 0);
  assert.deepEqual(state.drawing?.standard, {
    id: "acme",
    version: "2026.1",
    hash: "0d1f",
    checked: false,
  });
  assert.deepEqual(
    state.diagnostics.map((d) => [d.rule, d.severity, d.message]),
    [
      [
        "standard-unchecked",
        "warning",
        "The copy of tsdraft this drawing imports is from before standards and has no defineStandard, so the drawing was not checked against the export `standard`. Update it",
      ],
    ],
  );
});

test("the pictures draw a title block's preview for its border, unless `xrefs` gives the border", () =>
  inScratch(async (dir) => {
    const file = join(dir, "sheet.ts");
    const write = (exported: string) =>
      writeFileSync(
        file,
        `import { BUILT_IN_STANDARD, createDrawing, defineStandard } from "tsdraft";
const drawn = (layer: string) => {
  const b = createDrawing({ units: "in" });
  b.layer(layer, { color: 1 }, () => b.rect([0.5, 0.5], 35, 23));
  return b.build();
};
export const standard = defineStandard({
  id: "firm",
  version: "1",
  extends: BUILT_IN_STANDARD,
  defaultSheetFormat: "firm",
  titleBlocks: {
    firm: {
      paper: "ARCH D",
      xref: { name: "BORDER", path: "border.dwg" },
      preview: drawn("PREVIEW"),
      layer: "G-ANNO-TTLB",
      drawingArea: [0.5, 0.5, 35.5, 23.5],
      fields: {},
    },
  },
  sheetFormats: { firm: { paper: "ARCH D", titleBlock: "firm" } },
});
const d = createDrawing({ units: "ft", standard });
d.layout("A-101", (sheet) => sheet.titleBlock());
export default d.build();
${exported}\n`,
      );
    const sheet = (exported: string) => {
      write(exported);
      const { state, status } = render(file, "--out", join(dir, "out"));
      assert.equal(status, 0);
      const layers = readFileSync(state.outputs.layouts[0]!.svg, "utf8").matchAll(
        /data-layer="([^"]*)"/g,
      );
      return { xrefs: state.drawing?.xrefs, layers: new Set([...layers].map((m) => m[1])) };
    };
    const preview = sheet("");
    assert.deepEqual(preview.xrefs, [
      { name: "BORDER", path: "border.dwg", inserts: 1, shown: true, units: "in" },
    ]);
    assert.ok(preview.layers.has("BORDER|PREVIEW"));
    // The file's own drawing for the xref, by any case of its name, is drawn in its place.
    const given = sheet('export const xrefs = { border: drawn("GIVEN") };');
    assert.ok(given.layers.has("BORDER|GIVEN") && !given.layers.has("BORDER|PREVIEW"));
  }));

test("a getter in the export `standard` never runs: lint's error stands, with exit 2", () =>
  inScratch(async (dir) => {
    const file = join(dir, "wall.ts");
    const { id, version, hash } = BUILT_IN_STANDARD;
    for (const [field, body] of [
      ["titleBlocks", 'throw new Error("read")'],
      ["titleBlocks", "for (;;);"],
      ["id", 'throw new Error("read")'],
      ["hash", "for (;;);"],
    ] as const) {
      writeFileSync(
        file,
        `import { BUILT_IN_STANDARD, createDrawing } from "tsdraft";
export default createDrawing({ units: "ft" }).build();
export const standard = { ...BUILT_IN_STANDARD };
Object.defineProperty(standard, "${field}", { get() { ${body} }, enumerable: true });\n`,
      );
      // A getter that ran would loop until the timeout, a failed build with exit 1.
      const { state, status } = render(file, "--out", join(dir, "out"), "--timeout", "5000");
      assert.deepEqual(
        [status, state.drawing?.standard, state.diagnostics.map((d) => [d.rule, d.severity])],
        [
          2,
          field === "titleBlocks" ? { id, version, hash, checked: true } : null,
          [["standard", "error"]],
        ],
        `${field}: ${body}`,
      );
    }
  }));

test("a refused standard gives no preview, and a proxy is never asked: exit 2, not a timeout", () =>
  inScratch(async (dir) => {
    const file = join(dir, "wall.ts");
    const { id, version, hash } = BUILT_IN_STANDARD;
    const looping = "{ for (;;); }";
    for (const [name, standard, summary] of [
      [
        "a getter in a preview",
        `{ ...BUILT_IN_STANDARD, titleBlocks: { firm: { xref: { name: "BORDER", path: "border.dwg" },
  preview: { ...createDrawing({ units: "in" }).build(), entities: [Object.defineProperty({}, "kind", { get() ${looping}, enumerable: true })] } } } }`,
        { id, version, hash, checked: true },
      ],
      [
        "a proxy",
        `new Proxy({ ...BUILT_IN_STANDARD }, { getPrototypeOf() { return Date.prototype; }, getOwnPropertyDescriptor() ${looping} })`,
        null,
      ],
    ] as const) {
      writeFileSync(
        file,
        `import { BUILT_IN_STANDARD, createDrawing } from "tsdraft";
const d = createDrawing({ units: "ft" });
d.xref("BORDER", "border.dwg");
export default d.build();
export const standard = ${standard};\n`,
      );
      const { state, status } = render(file, "--out", join(dir, "out"), "--timeout", "5000");
      assert.equal(status, 2, name);
      assert.deepEqual(state.drawing?.standard, summary, name);
      assert.ok(
        state.diagnostics.some((d) => d.rule === "standard" && d.severity === "error"),
        name,
      );
    }
  }));

test("render --view draws one rectangle of model space or of a layout, and nothing else", () => {
  const out = tempDir();
  const crowded = join(root, "test/fixtures/crowded.ts");
  // The end of the note, where it passes the border: the box of its warning, cut down.
  const model = render(crowded, "--out", out, "--view", "8,5.5,18.5,7", "--width", "700");
  assert.equal(model.status, 0);
  assert.equal(model.state.diagnostics.length, 3);
  const { view, ...others } = model.state.outputs;
  assert.deepEqual(others, { svg: null, png: null, pngError: null, pngFonts: [], layouts: [] });
  assert.deepEqual(view, {
    layout: null,
    box: { min: [8, 5.5], max: [18.5, 7] },
    svg: join(out, "crowded.view.svg"),
    png: join(out, "crowded.view.png"),
    pngError: null,
    pngFonts: [{ font: "txt.shx", face: "JetBrains Mono" }],
  });
  // The picture is the rectangle itself, with no margin around it.
  assert.match(readFileSync(view!.svg, "utf8"), /^<svg [^>]*viewBox="8 -7 10.5 1.5">/);
  const png = readFileSync(view!.png!);
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [700, 100]);
  assert.ok(!existsSync(join(out, "crowded.svg")) && !existsSync(join(out, "crowded.png")));

  // A rectangle that starts with a negative number, given as the next argument.
  const negative = render(crowded, "--out", out, "--view", "-1,-1,18.5,7", "--width", "700");
  assert.equal(negative.status, 0);
  assert.deepEqual(negative.state.outputs.view?.box, { min: [-1, -1], max: [18.5, 7] });

  // A corner of the sheet that misses its viewport: the tag is drawn, and no view.
  const sheet = render(crowded, "--out", out, "--layout", "S-1", "--view=10,7.5,11,8.5");
  assert.equal(sheet.status, 0);
  assert.equal(sheet.state.outputs.view?.layout, "S-1");
  const svg = readFileSync(sheet.state.outputs.view!.svg, "utf8");
  assert.match(svg, /viewBox="10 -8.5 1 1" data-layout="S-1"/);
  assert.match(svg, /<g data-viewport="0" data-id="plan"\/>/);
  assert.doesNotMatch(svg, /clip/);
  assert.match(svg, /data-id="tag"/);
  assert.equal(readFileSync(sheet.state.outputs.view!.png!).readUInt32BE(16), 1600);

  // A layout the drawing does not have fails the build, and the flags are checked first.
  const missing = render(crowded, "--out", out, "--view", "0,0,1,1", "--layout", "S-9");
  assert.equal(missing.status, 1);
  assert.match(missing.state.error!.message, /no layout named "S-9"/);
  assert.equal(missing.state.outputs.view, null);
  for (const args of [
    ["render", crowded, "--view", "0,0,1"],
    ["render", crowded, "--view", "0,0,0,1"],
    ["render", crowded, "--view", "a,0,1,1"],
    ["render", crowded, "--layout", "S-1"],
    ["dev", crowded, "--view", "0,0,1,1"],
  ]) {
    const run = spawnSync(process.execPath, [join(root, "src/cli.ts"), ...args], {
      encoding: "utf8",
    });
    assert.deepEqual([run.status, run.stdout], [64, ""], args.join(" "));
    assert.match(run.stderr, /^--(view|layout) /);
  }
});

test("in the default folder a view replaces the whole pictures, and they replace it", () => {
  mkdirSync(join(root, "examples/out"), { recursive: true });
  const scratch = mkdtempSync(join(root, "examples/out/test-"));
  const file = join(scratch, "crowded.ts");
  writeFileSync(file, readFileSync(join(root, "test/fixtures/crowded.ts")));
  const names = ["crowded.svg", "crowded.png", "crowded.layout-S-1.svg", "crowded.layout-S-1.png"];
  const views = ["crowded.view.svg", "crowded.view.png"];
  const there = (list: readonly string[]) => list.map((n) => existsSync(join(scratch, "out", n)));
  try {
    assert.equal(render(file).status, 0);
    assert.deepEqual([...there(names), ...there(views)], [true, true, true, true, false, false]);
    assert.equal(render(file, "--view", "0,0,5,5").status, 0);
    assert.deepEqual([...there(names), ...there(views)], [false, false, false, false, true, true]);
    assert.equal(render(file).status, 0);
    assert.deepEqual([...there(names), ...there(views)], [true, true, true, true, false, false]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

const prlimit = spawnSync("prlimit", ["--version"]).status === 0;

// A core limit of one byte keeps the kernel from writing a dump of the renderer's process.
test(
  "render says which picture the renderer died on, and gives the rest",
  { skip: prlimit ? false : "needs prlimit, to keep the renderer's abort from leaving a core" },
  () => {
    const dir = tempDir();
    const library = pathToFileURL(join(root, "../dist/index.js")).href;
    // A clipped group whose only element is far outside the picture, which resvg aborts on.
    const aborts =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><clipPath id="c">` +
      `<rect width="5" height="5"/></clipPath><g clip-path="url(#c)">` +
      `<line x1="1000" y1="1000" x2="1001" y2="1001" stroke="#000000"/></g></svg>`;
    writeFileSync(
      join(dir, "kit.ts"),
      `export * from ${JSON.stringify(library)};
import { toSVG as draw } from ${JSON.stringify(library)};
export const toSVG: typeof draw = (drawing, options) =>
  options?.layout === "BAD" ? ${JSON.stringify(aborts)} : draw(drawing, options);
`,
    );
    const file = join(dir, "sheets.ts");
    writeFileSync(
      file,
      `import { createDrawing } from "./kit.ts";
const d = createDrawing();
d.line([0, 0], [10, 10]);
for (const name of ["BAD", "GOOD"]) d.layout(name, { paper: "ANSI A" }, () => d.line([1, 1], [5, 5]));
export default d.build();
`,
    );
    const run = spawnSync(
      "prlimit",
      ["--core=1:1", "--", process.execPath, join(root, "src/cli.ts"), "render", file],
      { encoding: "utf8", timeout: 60_000 },
    );
    const state = JSON.parse(run.stdout) as BuildState;
    assert.equal(run.status, 0);
    assert.equal(state.ok, true);
    assert.equal(state.outputs.pngError, null);
    assert.ok(existsSync(state.outputs.png!));
    const [bad, good] = state.outputs.layouts;
    assert.match(bad!.pngError!, /^No PNG: the renderer @resvg\/resvg-js stopped while it drew/);
    assert.equal(bad!.png, null);
    assert.ok(existsSync(bad!.svg));
    assert.equal(good!.pngError, null);
    assert.ok(existsSync(good!.png!));
  },
);
