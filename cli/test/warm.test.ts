// The build that follows another runs in a process that loaded the library ahead, when the
// library is the command's own package's. These count what a build reads and compare what it
// answers, since neither depends on how fast the machine is. None asserts a time.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { Builder, type Outcome } from "../src/build.ts";
import { librarySteps } from "../src/warmup.ts";

const root = join(fileURLToPath(new URL("..", import.meta.url)), ".");
const built = join(root, "../dist");

/** Builds a file `times` times, each once the waiting processes have warmed up. */
async function builds(
  file: string,
  times: number,
  between?: (n: number) => void,
  builder = new Builder({ timeout: 30_000, warm: true }),
) {
  const outcomes: Outcome[] = [];
  try {
    for (let n = 0; n < times; n++) {
      await settled(builder);
      between?.(n);
      outcomes.push((await builder.build(file, root))!);
    }
  } finally {
    builder.close();
  }
  return outcomes;
}

/**
 * Waits for the spares to warm up. Each warm-up ends by its deadline, so a wait that does not
 * end is a broken rule, and fails the test rather than holding it open.
 */
function settled(builder: Builder): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const stuck = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The spares never finished warming up")), 30_000);
  });
  return Promise.race([builder.warmed(), stuck]).finally(() => clearTimeout(timer));
}

/** A file's answer from a process that waited and warmed up, and from one just started. */
async function warmAndCold(file: string): Promise<[warm: Outcome, cold: Outcome]> {
  const waiting = new Builder({ timeout: 30_000, warm: true });
  const fresh = new Builder({ timeout: 30_000, warm: false });
  try {
    await waiting.build(join(root, "examples/lot.ts"), root);
    await settled(waiting);
    return [(await waiting.build(file, root))!, (await fresh.build(file, root))!];
  } finally {
    waiting.close();
  }
}

/** What a build answers, without the times and the count of what it read. */
const answer = ({ ms: _ms, timings: _timings, modules: _modules, files, ...rest }: Outcome) => ({
  ...rest,
  files: [...files].sort(),
});

async function inScratch(use: (dir: string) => Promise<void>): Promise<void> {
  mkdirSync(join(root, "examples/out"), { recursive: true });
  const dir = mkdtempSync(join(root, "examples/out/test-"));
  try {
    await use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const LOT =
  'import { createDrawing } from "tsdraft";\nconst d = createDrawing({ units: "ft" });\n' +
  'd.layer("A", { color: 1 }, () => d.line([0, 0], [1, 1]));\nexport default d.build();\n';

/**
 * A library that passes on the built one from `from`, with a `toSVG` of its own given as the
 * body of a function of `draw` and `given`.
 */
const passedOn = (from: string, toSVG: string, more = "") =>
  `${more}import { toSVG as draw } from "${from}";\nexport * from "${from}";\n` +
  `export const toSVG = (...given) => {${toSVG}};\n`;

/**
 * A copy of the command with a library of its own in `dir`, so that a test can change the
 * library the command takes for its own package's. Its `toSVG` prints, and marks the picture
 * with what `dist/mark.js` exports. Gives the copy's `Builder` and a drawing file.
 */
async function ownCommand(dir: string, toSVG?: string) {
  cpSync(join(root, "src"), join(dir, "cli/src"), { recursive: true });
  cpSync(built, join(dir, "dist"), { recursive: true });
  renameSync(join(dir, "dist/index.js"), join(dir, "dist/library.js"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "tsdraft", "type": "module", "exports": "./dist/index.js" }',
  );
  writeFileSync(
    join(dir, "dist/index.js"),
    passedOn(
      "./library.js",
      toSVG ??
        'console.log("drawing"); return draw(...given).replace("<svg ", `<svg data-copy="${MARK}" `);',
      'import { MARK } from "./mark.js";\n',
    ),
  );
  const mark = (value: string, more = "", file = "dist/mark.js") =>
    writeFileSync(join(dir, file), `${more}export const MARK = "${value}";\n`);
  mark("aaaa");
  const file = join(dir, "lot.ts");
  writeFileSync(file, LOT);
  const copy = (await import(pathToFileURL(join(dir, "cli/src/build.ts")).href)) as {
    Builder: typeof Builder;
  };
  return { Builder: copy.Builder, file, mark };
}

// A warm-up swallows a step's error, so a step broken by a change to the library would only make
// builds slower.
test("each step of the library's warm-up runs, and its sheets lint clean", async () => {
  const results = librarySteps(await import("tsdraft")).map((step) => step());
  assert.deepEqual(results.filter(Array.isArray), [[], []]);
});

test("a build after another reads the drawing's files alone, and answers as the first did", async () => {
  const [cold, warm] = await builds(join(root, "../examples/site-plan.ts"), 2);
  assert.equal(cold!.ok, true);
  assert.equal(cold!.modules.ahead, 0);
  assert.ok(cold!.modules.read > 2, "the first build reads the library");
  // The sheet and its helpers: the library is neither read nor run again.
  assert.equal(warm!.modules.read, 2);
  assert.ok(warm!.modules.ahead > 0);
  assert.deepEqual(answer(warm!), answer(cold!));
});

test("a drawing that throws, and one lint refuses, answer warm as they do cold", () =>
  inScratch(async (dir) => {
    const refused = join(dir, "refused.ts");
    writeFileSync(
      refused,
      'import { lint } from "tsdraft";\nvoid lint;\nexport default { units: "ft", dxf: "R2018", ' +
        'layers: [{ name: "A", color: 1 }], entities: [\n' +
        '  { kind: "circle", layer: "A", center: [0, 0], radius: -1 },\n' +
        '  { kind: "line", layer: "A", from: [0, 0], to: [4, 4] },\n] };\n',
    );
    const linted = await warmAndCold(refused);
    const thrown = await warmAndCold(join(root, "test/fixtures/throws.ts"));
    for (const [warm, cold] of [linted, thrown]) {
      assert.ok(warm.modules.ahead > 0);
      assert.equal(cold.modules.ahead, 0);
      assert.deepEqual(answer(warm), answer(cold));
    }
    assert.equal(linted[0].diagnostics[0]?.severity, "error");
    assert.equal(thrown[0].error?.line, 7);
  }));

test("another copy of the library is never loaded ahead, and each build runs it as the first did", () =>
  inScratch(async (dir) => {
    const copy = join(dir, "node_modules/tsdraft");
    mkdirSync(copy, { recursive: true });
    writeFileSync(join(dir, "package.json"), '{ "type": "module" }');
    writeFileSync(
      join(copy, "package.json"),
      '{ "name": "tsdraft", "type": "module", "exports": "./index.js" }',
    );
    // It counts its calls and prints once: a call made ahead of a build would show in both.
    writeFileSync(
      join(copy, "index.js"),
      passedOn(
        pathToFileURL(join(built, "index.js")).href,
        'if (++calls === 1) console.log("the first call"); ' +
          'return draw(...given).replace("<svg ", `<svg data-call="${calls}" `);',
        "let calls = 0;\n",
      ),
    );
    const file = join(dir, "lot.ts");
    writeFileSync(file, LOT);
    const [first, second, third] = await builds(file, 3);
    assert.match(first!.svg!, /data-call="1"/);
    assert.equal(first!.log, "the first call");
    for (const later of [second!, third!]) {
      assert.equal(later.modules.ahead, 0);
      assert.deepEqual(answer(later), answer(first!));
    }
  }));

test("the command's own library, changed since a waiting process loaded it, is read again", () =>
  inScratch(async (dir) => {
    const own = await ownCommand(dir);
    const outcomes = await builds(
      own.file,
      8,
      (n) => {
        if (n === 2) own.mark("bbbb");
        if (n === 4) own.mark("cccc", 'import "node:os";\n');
        if (n === 6) own.mark("dddd");
      },
      new own.Builder({ timeout: 30_000, warm: true }),
    );
    const drawn = outcomes.map((o) => /data-copy="(\w+)"/.exec(o.svg!)?.[1]);
    assert.deepEqual(drawn, ["aaaa", "aaaa", "bbbb", "bbbb", "cccc", "cccc", "dddd", "dddd"]);
    // Warm wherever the library is as the waiting process loaded it, and holds to its own
    // files: not after a change, and not while it loads a part of Node.
    assert.deepEqual(
      outcomes.map((o) => o.modules.ahead > 0),
      [false, true, false, true, false, false, false, true],
    );
    // What the library printed while a process warmed up is in no build's log.
    for (const outcome of outcomes) assert.equal(outcome.log, outcomes[0]!.log);
    assert.match(outcomes[0]!.log, /^drawing(\ndrawing)*$/);
  }));

test("a link in the command's own library that is pointed elsewhere is followed again", () =>
  inScratch(async (dir) => {
    const own = await ownCommand(dir);
    own.mark("aaaa", "", "dist/one.js");
    own.mark("bbbb", "", "dist/two.js");
    const point = (to: string) => {
      rmSync(join(dir, "dist/mark.js"));
      symlinkSync(to, join(dir, "dist/mark.js"));
    };
    point("one.js");
    const outcomes = await builds(
      own.file,
      4,
      (n) => n === 2 && point("two.js"),
      new own.Builder({ timeout: 30_000, warm: true }),
    );
    const drawn = outcomes.map((o) => /data-copy="(\w+)"/.exec(o.svg!)?.[1]);
    assert.deepEqual(drawn, ["aaaa", "aaaa", "bbbb", "bbbb"]);
    assert.deepEqual(
      outcomes.map((o) => o.modules.ahead > 0),
      [false, true, false, true],
    );
  }));

test("a warm-up that does not end costs no build, and its library is not loaded ahead again", () =>
  inScratch(async (dir) => {
    // It never returns for the sheet a waiting process draws, which has this layer.
    const own = await ownCommand(
      dir,
      'while (given[0].layers.some((layer) => layer.name === "C-SETB")); return draw(...given);',
    );
    const builder = new own.Builder({ timeout: 30_000, warm: true, warmDeadline: 300 });
    try {
      const first = await builder.build(own.file, root);
      // At once: the process it is given may be the one that will not end.
      const second = await builder.build(own.file, root);
      await settled(builder);
      const third = await builder.build(own.file, root);
      assert.deepEqual([first!.ok, second!.ok, third!.ok], [true, true, true]);
      assert.equal(third!.modules.ahead, 0);
    } finally {
      builder.close();
    }
  }));

test("what a drawing leaves in a global or in the library does not reach the next build", () =>
  inScratch(async (dir) => {
    const file = join(dir, "counts.ts");
    writeFileSync(
      file,
      `import { createDrawing, FONTS } from "tsdraft";
const seen = [globalThis, FONTS].map((held: { builds?: number }) => (held.builds = (held.builds ?? 0) + 1));
const d = createDrawing({ units: "ft" });
d.layer("A", { color: 1 }, () => d.text([0, 0], \`BUILDS \${seen.join(" AND ")}\`, { height: 1 }));
export default d.build();
`,
    );
    const [first, second] = await builds(file, 2);
    assert.match(first!.svg!, /BUILDS 1 AND 1</);
    assert.ok(second!.modules.ahead > 0);
    assert.equal(second!.svg, first!.svg);
  }));

test("a build's log is whole, however much the drawing writes before it answers", () =>
  inScratch(async (dir) => {
    const file = join(dir, "loud.ts");
    writeFileSync(file, `console.log("x".repeat(300_000));\n${LOT}console.log("THE END");\n`);
    for (const outcome of await builds(file, 2)) {
      assert.equal(outcome.ok, true);
      assert.match(outcome.log, /^x{7000,}\nTHE END$/);
    }
  }));

test("a drawing that replaces process.stdout.write builds, and its log is what it wrote", () =>
  inScratch(async (dir) => {
    const silent = join(dir, "silent.ts");
    writeFileSync(silent, `process.stdout.write = () => true;\n${LOT}`);
    const run = spawnSync(process.execPath, [join(root, "src/cli.ts"), "render", silent], {
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(run.status, 0);
    assert.equal((JSON.parse(run.stdout) as { ok: boolean }).ok, true);

    const prefixed = join(dir, "prefixed.ts");
    writeFileSync(
      prefixed,
      `const write = process.stdout.write;
process.stdout.write = ((chunk: string, ...rest: never[]) =>
  write.call(process.stdout, \`[p] \${chunk}\`, ...rest)) as typeof write;
console.log("hello");
${LOT}`,
    );
    const [warm, cold] = await warmAndCold(prefixed);
    assert.ok(warm.modules.ahead > 0);
    assert.deepEqual([warm.log, cold.log], ["[p] hello", "[p] hello"]);

    // A drawing that replaces the streams themselves, ends one or corks one still builds.
    for (const [name, code] of [
      [
        "replaced",
        'process.on("uncaughtException", () => {});\nObject.defineProperty(process, "stdout", { value: { write: () => true, end: () => {} } });',
      ],
      ["ended", "process.stdout.end();"],
      ["corked", "process.stdout.cork();"],
    ]) {
      const file = join(dir, `${name}.ts`);
      writeFileSync(file, `${code}\n${LOT}`);
      const [warmed, fresh] = await warmAndCold(file);
      assert.deepEqual([warmed.ok, fresh.ok], [true, true], name);
      assert.doesNotMatch(warmed.log + fresh.log, /leave|ERR_STREAM/, name);
    }
  }));

test("a file of the command's own library that leads outside its folder is never run ahead", () =>
  inScratch(async (dir) => {
    const own = await ownCommand(dir);
    const loads = join(dir, "loads.txt");
    writeFileSync(
      join(dir, "outside.js"),
      `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(loads)}, "loaded\\n");\n` +
        'export const MARK = "aaaa";\n',
    );
    rmSync(join(dir, "dist/mark.js"));
    symlinkSync(join(dir, "outside.js"), join(dir, "dist/mark.js"));
    const builder = new own.Builder({ timeout: 30_000, warm: true });
    const outcomes = await builds(own.file, 2, undefined, builder);
    assert.deepEqual(
      outcomes.map((o) => [o.ok, o.modules.ahead]),
      [
        [true, 0],
        [true, 0],
      ],
    );
    // Once for each build, which read it cold, and never for a warm-up.
    assert.equal(readFileSync(loads, "utf8"), "loaded\nloaded\n");
  }));

test("a library whose folder was gone when a warm-up tried it is loaded ahead once it is back", () =>
  inScratch(async (dir) => {
    const own = await ownCommand(dir);
    const [dist, away] = [join(dir, "dist"), join(dir, "dist-away")];
    const outcomes = await builds(
      own.file,
      5,
      (n) => {
        if (n === 2) renameSync(dist, away);
        if (n === 3) renameSync(away, dist);
      },
      new own.Builder({ timeout: 30_000, warm: true }),
    );
    assert.deepEqual(
      outcomes.map((o) => [o.ok, o.modules.ahead > 0]),
      [
        [true, false],
        [true, true],
        [false, false],
        [true, false],
        [true, true],
      ],
    );
  }));

test("a library that missed the warm-up's deadline once is tried again after the next build", () =>
  inScratch(async (dir) => {
    // Its warm-up does not end until the file `open` exists, outside the library's folder.
    const open = join(dir, "open");
    const own = await ownCommand(
      dir,
      `const { existsSync } = process.getBuiltinModule("node:fs");
if (given[0].layers.some((layer) => layer.name === "C-SETB")) while (!existsSync(${JSON.stringify(open)}));
return draw(...given);`,
    );
    const outcomes = await builds(
      own.file,
      3,
      // The first warm-up has missed its deadline by now.
      (n) => n === 1 && writeFileSync(open, ""),
      new own.Builder({ timeout: 30_000, warm: true }),
    );
    assert.deepEqual(
      outcomes.map((o) => [o.ok, o.modules.ahead > 0]),
      [
        [true, false],
        [true, false],
        [true, true],
      ],
    );
  }));

const prlimit = spawnSync("prlimit", ["--version"]).status === 0;

test(
  "a warm-up that never ends does not outlive the command",
  { skip: prlimit ? false : "needs prlimit, to keep the killed command from leaving a core" },
  () =>
    inScratch(async (dir) => {
      const own = await ownCommand(
        dir,
        'while (given[0].layers.some((layer) => layer.name === "C-SETB")); return draw(...given);',
      );
      const parent = join(dir, "parent.mjs");
      const builder = pathToFileURL(join(dir, "cli/src/build.ts")).href;
      // A deadline far off, so that only the parent's going can end the warm-up in time.
      writeFileSync(
        parent,
        `import { Builder } from ${JSON.stringify(builder)};
const builder = new Builder({ timeout: 30_000, warm: true, warmDeadline: 60_000 });
await builder.build(${JSON.stringify(own.file)}, ${JSON.stringify(root)});
setTimeout(() => console.log("looping"), 1_500);
setInterval(() => {}, 1_000);
`,
      );
      const command = spawn("prlimit", ["--core=1:1", "--", process.execPath, parent], {
        stdio: ["ignore", "pipe", "inherit"],
      });
      await new Promise<void>((resolve) =>
        command.stdout.on("data", (b: Buffer) => b.toString().includes("looping") && resolve()),
      );
      const children = spawnSync("ps", ["-o", "pid=", "--ppid", String(command.pid)], {
        encoding: "utf8",
      })
        .stdout.split("\n")
        .filter((line) => line.trim() !== "")
        .map(Number);
      assert.equal(children.length, 2);
      command.kill("SIGKILL");
      const alive = (pid: number) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      const until = Date.now() + 3_000;
      while (children.some(alive) && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const left = children.filter(alive);
      for (const pid of left) process.kill(pid, "SIGKILL");
      assert.deepEqual(left, []);
    }),
);
