// Packs tsdraft the way `npm publish` would and checks the tarball three ways. As a library: its
// files are unpacked into a throwaway consumer, which type-checks and runs code that imports
// "tsdraft", and scripts/library-alone.ts shows that the library loads nothing of Node's and
// nothing of the command's. As a command: npm installs the tarball into an empty project outside
// the repo, and the installed `tsdraft` renders a drawing and serves the live preview. And once
// more with npm told to leave out optional packages, where there is no PNG renderer. The unit
// tests run the source, so this is the check that covers what is published. The install with the
// renderer needs the npm registry, or a cache that has the renderer.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildState } from "../cli/src/state.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const tmp = realpathSync(mkdtempSync(join(tmpdir(), "tsdraft-smoke-")));
const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

/** `promise`, or a failure when it has not settled in `ms`. */
function within<T>(ms: number, what: string, promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms} ms`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

try {
  // npm pack runs `prepack`, which builds dist/ and cli/dist/ first.
  const [pack] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", tmp], root)) as {
    filename: string;
    files: { path: string }[];
  }[];
  assert.ok(pack, "npm pack produced a tarball");
  const tarball = join(tmp, pack.filename);
  const files = pack.files.map((f) => f.path).sort();
  for (const required of [
    "CHANGELOG.md",
    "GUIDE.md",
    "LICENSE",
    "README.md",
    "package.json",
    "dist/index.js",
    "dist/index.d.ts",
    "cli/dist/cli.js",
    "cli/dist/worker.js",
    "cli/assets/page.html",
    "cli/assets/mark.svg",
    "cli/assets/fonts/JetBrainsMono-Regular.ttf",
    "cli/assets/fonts/OFL.txt",
  ]) {
    assert.ok(files.includes(required), `tarball contains ${required}`);
  }
  const stray = files.filter(
    (f) =>
      !/^(LICENSE|README\.md|GUIDE\.md|CHANGELOG\.md|package\.json|dist\/[\w-]+\.(js|d\.ts)|cli\/dist\/[\w-]+\.js|cli\/assets\/.+)$/.test(
        f,
      ),
  );
  assert.deepEqual(stray, [], "tarball contains only dist/, cli/ and package metadata");

  const consumer = join(tmp, "consumer");
  const installed = join(consumer, "node_modules", "tsdraft");
  mkdirSync(installed, { recursive: true });
  run("tar", ["-xzf", tarball, "-C", installed, "--strip-components=1"], root);

  // The library is what `import "tsdraft"` loads. It must run where there is no Node.
  process.stdout.write(
    run(
      process.execPath,
      [
        "--experimental-vm-modules",
        "--disallow-code-generation-from-strings",
        "--disable-warning=ExperimentalWarning",
        join(root, "scripts", "library-alone.ts"),
        join(installed, "dist"),
      ],
      root,
    ),
  );

  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module" }),
  );
  writeFileSync(
    join(consumer, "main.ts"),
    [
      `import { createDrawing, lint, toDXF, toSVG, type Drawing } from "tsdraft";`,
      `const d: Drawing = createDrawing({ units: "ft" }).layer("A", { color: 1 }, () => {}).rect([0, 0], 10, 5).build();`,
      `if (lint(d).length > 0) throw new Error("unexpected lint problems");`,
      `// The published types must still reject a bad literal, and the code must still throw.`,
      `let threw = false;`,
      `try {`,
      `  // @ts-expect-error: R12 layer names cannot contain spaces.`,
      `  createDrawing({ dxf: "R12" }).layer("A WALL");`,
      `} catch {`,
      `  threw = true;`,
      `}`,
      `if (!threw) throw new Error("a bad layer name was accepted");`,
      `createDrawing().layer("A WALL");`,
      `// @ts-expect-error: 0.33 mm is not one of AutoCAD's lineweights.`,
      `const lineweight = () => createDrawing().line([0, 0], [1, 1], { lineweight: 0.33 });`,
      `try { lineweight(); threw = false; } catch { threw = true; }`,
      `if (!threw) throw new Error("a bad lineweight was accepted");`,
      `const dxf: string = toDXF(d);`,
      `const svg: string = toSVG(d);`,
      `if (!dxf.endsWith("EOF\\r\\n") || !svg.startsWith("<svg")) throw new Error("unexpected output");`,
      `console.log("consumer ok");`,
      ``,
    ].join("\n"),
  );

  // Type-check the consumer with both module resolution modes that consumers use.
  const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
  for (const [mode, options] of [
    ["nodenext", { module: "nodenext", moduleResolution: "nodenext" }],
    ["bundler", { module: "preserve", moduleResolution: "bundler" }],
  ] as const) {
    const config = `tsconfig.${mode}.json`;
    writeFileSync(
      join(consumer, config),
      JSON.stringify({
        compilerOptions: { ...options, strict: true, noEmit: true, skipLibCheck: false, types: [] },
        files: ["main.ts"],
      }),
    );
    run(process.execPath, [tsc, "-p", config], consumer);
  }

  // Run it. The consumer's own .ts is type-stripped; tsdraft itself is plain dist/ JavaScript.
  assert.equal(run(process.execPath, ["main.ts"], consumer).trim(), "consumer ok");

  // Tools read "tsdraft/package.json"; the exports map must allow it.
  const resolved = run(
    process.execPath,
    ["--input-type=module", "-e", `console.log(import.meta.resolve("tsdraft/package.json"))`],
    consumer,
  );
  assert.match(resolved.trim(), /node_modules\/tsdraft\/package\.json$/);

  /** An empty project with the tarball installed by npm, and a drawing that has one warning. */
  const project = (name: string, ...flags: string[]): { dir: string; bin: string } => {
    const dir = join(tmp, name);
    mkdirSync(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ private: true, type: "module" }));
    // A warm npm cache is enough: the registry is asked only for what the cache lacks.
    run(
      "npm",
      ["install", "--no-audit", "--no-fund", "--prefer-offline", "-D", ...flags, tarball],
      dir,
    );
    writeFileSync(
      join(dir, "plan.ts"),
      [
        `import { createDrawing, type Drawing } from "tsdraft";`,
        `const d = createDrawing({ units: "ft" });`,
        `d.layer("C-PROP", { color: 7 }, () => d.rect([0, 0], 100, 140));`,
        `d.line([30, 40], [30, 40], { id: "walk" });`,
        `const drawing: Drawing = d.build();`,
        `export default drawing;`,
        ``,
      ].join("\n"),
    );
    return { dir, bin: join(dir, "node_modules", ".bin", "tsdraft") };
  };

  /** Runs the installed `tsdraft render` on the project's drawing. */
  const render = (at: { dir: string; bin: string }) => {
    const done = spawnSync(at.bin, ["render", "plan.ts", "--width", "800"], {
      cwd: at.dir,
      encoding: "utf8",
    });
    assert.equal(done.status, 0, done.stderr);
    const state = JSON.parse(done.stdout) as BuildState;
    assert.equal(state.ok, true);
    assert.deepEqual(state.drawing?.counts, {
      layers: 2,
      entities: 2,
      blocks: 0,
      xrefs: 0,
      layouts: 0,
      errors: 0,
      warnings: 1,
    });
    const [warning] = state.diagnostics;
    assert.equal(warning?.id, "walk");
    assert.deepEqual(warning?.call, { file: join(at.dir, "plan.ts"), line: 4, column: 3 });
    assert.equal(state.outputs.svg, join(at.dir, "out", "plan.svg"));
    assert.match(readFileSync(state.outputs.svg, "utf8"), /^<svg /);
    return { state, stderr: done.stderr };
  };

  /** Runs the installed `tsdraft dev` for the length of `use`, then stops it. */
  const withDev = async (
    at: { dir: string; bin: string },
    use: (base: string, state: BuildState) => Promise<void>,
  ) => {
    const server = spawn(at.bin, ["dev", "plan.ts"], {
      cwd: at.dir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
    let out = "";
    let failure: unknown;
    try {
      const listening = new Promise<string>((resolve, reject) => {
        server.stdout.on("data", (chunk: Buffer) => {
          const url = /http:\/\/[\d.]+:\d+/.exec((out += chunk.toString()))?.[0];
          if (url) resolve(url);
        });
        server.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()));
        void exited.then(() => reject(new Error(`tsdraft dev ended before it listened: ${out}`)));
      });
      const base = await within(15_000, "tsdraft dev starting", listening);
      const state = (await (await fetch(`${base}/state.json?after=0`)).json()) as BuildState;
      assert.equal(state.ok, true);
      assert.equal(state.diagnostics[0]?.id, "walk");
      const picture = await fetch(state.outputs.svg!);
      assert.equal(picture.status, 200);
      assert.match(await picture.text(), /^<svg /);
      assert.match(await (await fetch(base)).text(), /<title>/, "the dev page is in the package");
      assert.equal((await fetch(`${base}/mark.svg`)).status, 200);
      await use(base, state);
    } catch (error) {
      failure = error;
    }
    server.kill();
    const stopped = await within(5_000, "tsdraft dev stopping", exited).then(
      () => true,
      () => server.kill("SIGKILL") && false,
    );
    if (failure) throw failure;
    assert.ok(stopped, "tsdraft dev stopped within 5 s of being asked to");
  };

  // As npm installs it by default, with the optional PNG renderer.
  const full = project("project");
  const drawn = render(full).state;
  assert.equal(drawn.outputs.pngError, null);
  const png = readFileSync(drawn.outputs.png!);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 800, "the PNG is as wide as asked");
  await withDev(full, async (base, state) => {
    assert.equal(state.outputs.pngError, null);
    const live = await fetch(`${base}/drawing.png?width=400`);
    assert.equal(live.headers.get("content-type"), "image/png");
  });

  // Without it, the drawing still builds, the SVG is written, and the JSON says why no PNG.
  const lean = project("project-no-png", "--omit=optional");
  assert.ok(
    !existsSync(join(lean.dir, "node_modules", "@resvg", "resvg-js")),
    "no renderer is installed",
  );
  // A PNG from an earlier run must not pass for this one's.
  mkdirSync(join(lean.dir, "out"));
  writeFileSync(join(lean.dir, "out", "plan.png"), "an old picture");
  const { state: plain, stderr } = render(lean);
  assert.equal(plain.outputs.png, null);
  assert.match(plain.outputs.pngError!, /is not installed\. Install it with "npm i -D /);
  assert.match(stderr, /No PNG/);
  assert.ok(!existsSync(join(lean.dir, "out", "plan.png")));
  await withDev(lean, async (base, state) => {
    assert.equal(state.outputs.png, null);
    assert.match(state.outputs.pngError!, /^No PNG/);
    const refused = await fetch(`${base}/drawing.png`);
    assert.equal(refused.status, 501);
    assert.equal(refused.headers.get("content-type"), "text/plain");
  });

  const kb = (statSync(tarball).size / 1024).toFixed(0);
  console.log(`package smoke test passed: ${pack.filename}, ${files.length} files, ${kb} kB`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
