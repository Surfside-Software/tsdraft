// `tsdraft/png`, the library's PNG writer, against the command's own PNG.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import lot from "../examples/lot.ts";
import { pngUnavailable } from "../src/png.ts";
import { createDrawing } from "tsdraft";
import { PngTooLarge, toPNG } from "../src/png-api.ts";
import { inScratch } from "./scratch.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const noRenderer = { skip: pngUnavailable() ?? false };

/** The PNG `tsdraft render` writes for a drawing file, 800 pixels wide. */
function rendered(file: string, out: string): Buffer {
  const args = [join(root, "src/cli.ts"), "render", file, "--out", out, "--width", "800"];
  const run = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);

  return readFileSync(join(out, `${basename(file, ".ts")}.png`));
}

test("toPNG gives the bytes tsdraft render writes for the same drawing", noRenderer, () =>
  inScratch(async (dir) => {
    // A point sized by the picture's height, which the margin must not change.
    const points = join(dir, "points.ts");
    writeFileSync(
      points,
      `import { createDrawing } from "tsdraft";
export default createDrawing({ pointStyle: { figure: "cross", size: { percent: 25 } } })
  .point([0, 0]).point([40, 10]).line([0, 0], [40, 10]).build();
`,
    );
    const pointsDrawing = (await import(pathToFileURL(points).href)).default;

    for (const [file, drawing] of [
      [join(root, "examples/lot.ts"), lot],
      [points, pointsDrawing],
    ]) {
      const png = await toPNG(drawing, { width: 800 });
      assert.ok(png instanceof Uint8Array && !Buffer.isBuffer(png));
      assert.deepEqual(Buffer.from(png), rendered(file, dir), file);
    }
  }),
);

test("toPNG rejects a picture too tall for any width with a PngTooLarge", noRenderer, async () => {
  const upright = createDrawing().line([0, 0], [0, 100]).build();
  await assert.rejects(toPNG(upright, { margin: 0 }), PngTooLarge);
});

test("toPNG refuses a width that is not a whole number of pixels", async () => {
  for (const width of [0, 12.5, Number.NaN]) {
    await assert.rejects(toPNG(lot, { width }), RangeError);
  }
});

test("a script that calls toPNG once ends by itself", noRenderer, () =>
  inScratch((dir) => {
    const script = join(dir, "once.ts");
    writeFileSync(
      script,
      `import { createDrawing } from "tsdraft";
import { toPNG } from ${JSON.stringify(pathToFileURL(join(root, "src/png-api.ts")).href)};
const png = await toPNG(createDrawing().line([0, 0], [10, 10]).build(), { width: 64 });
process.stdout.write(String(png.length));
`,
    );

    const run = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 30_000 });
    assert.equal(run.signal, null, "it ended before the time limit");
    assert.equal(run.status, 0, run.stderr);
    assert.ok(Number(run.stdout) > 0);
  }),
);

test(
  "a renderer that cannot start rejects with a RendererCrashed, and the next call draws",
  noRenderer,
  () =>
    inScratch((dir) => {
      const script = join(dir, "start.ts");
      const api = JSON.stringify(pathToFileURL(join(root, "src/png-api.ts")).href);
      writeFileSync(
        script,
        `import { createDrawing } from "tsdraft";
import { RendererCrashed, toPNG } from ${api};
const drawing = createDrawing().line([0, 0], [10, 10]).build();
// No program to start, so the renderer's process cannot start.
const node = process.execPath;
process.execPath = "";
const first = await toPNG(drawing, { width: 64 }).catch((error) => error);
process.execPath = node;
const second = await toPNG(drawing, { width: 64 });
process.stdout.write(String(first instanceof RendererCrashed && second.length > 0));
`,
      );

      const run = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 30_000 });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout, "true");
    }),
);
