import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FONTS } from "tsdraft";
import { familyName, findFaces, pngFonts, SHIPPED, type Face } from "../src/fonts.ts";
import { pngUnavailable, RendererCrashed, toPNG } from "../src/png.ts";

test(
  "a renderer whose process cannot start gives each picture the reason, and the command lives",
  { skip: pngUnavailable() ?? false },
  async () => {
    const node = process.execPath;
    // `fork` starts the renderer with this program.
    process.execPath = "/nowhere/node";
    try {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>`;
      for (const outcome of await Promise.allSettled([toPNG(svg, 10), toPNG(svg, 10)])) {
        assert.equal(outcome.status, "rejected");
        const { reason } = outcome as PromiseRejectedResult;
        assert.ok(reason instanceof RendererCrashed);
        assert.match(reason.message, /^No PNG: the renderer's process could not start \(.*ENOENT/);
      }
    } finally {
      process.execPath = node;
    }
    const { png } = await toPNG(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>`, 10);
    assert.equal(png.subarray(1, 4).toString(), "PNG");
  },
);

test(
  "a picture the renderer answers it cannot draw gets the reason, and the next one is drawn",
  { skip: pngUnavailable() ?? false },
  async () => {
    // One unit wide at a place where single precision cannot tell its two sides apart.
    const far =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="100000000 -1 1 1">` +
      `<line x1="100000000" y1="0" x2="100000001" y2="-1" stroke="#000"/></svg>`;
    await assert.rejects(toPNG(far, 10), (error: Error) => {
      assert.ok(error instanceof RendererCrashed);
      assert.match(error.message, /^No PNG: the renderer @resvg\/resvg-js could not draw this/);
      return true;
    });
    const { png } = await toPNG(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>`, 10);
    assert.equal(png.subarray(1, 4).toString(), "PNG");
  },
);

test("a font file is a face of the font only when it names itself so", () => {
  const dir = mkdtempSync(join(tmpdir(), "tsdraft-fonts-"));
  const shipped = readFileSync(SHIPPED.file);
  assert.equal(familyName(shipped), "JetBrains Mono");
  assert.equal(familyName(shipped.subarray(0, 40)), undefined);
  // Files under the names of Arial and of a font made to its widths, which hold another font.
  mkdirSync(join(dir, "deeper"));
  writeFileSync(join(dir, "arial.ttf"), shipped);
  writeFileSync(join(dir, "deeper", "LiberationSans-Regular.ttf"), shipped);
  const none = findFaces([dir, join(dir, "missing")]);
  assert.equal(none.size, 0);
  const svg = (family: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 12"><text y="10" font-size="10" ` +
    `font-family="${family.replaceAll('"', "&quot;")}" fill="#fff">WIDTH</text></svg>`;
  const [arialText, timesText] = [svg(FONTS.Arial.family), svg(FONTS["Times New Roman"].family)];
  assert.deepEqual(pngFonts(["Arial", "romans.shx"], arialText, none), [
    { font: "Arial", face: "JetBrains Mono", sameWidths: false },
    { font: "romans.shx", face: "JetBrains Mono", sameWidths: false },
  ]);
  const arial = { family: FONTS.Arial.family, face: "Liberation Sans", file: "/fonts/a.ttf" };
  const times = { family: FONTS["Times New Roman"].family, face: "Times New Roman", file: "/t" };
  const both = new Map<string, Face>([
    ["Arial", arial],
    ["Times New Roman", times],
  ]);
  assert.deepEqual(pngFonts(["Arial"], arialText, both), [
    { font: "Arial", face: "Liberation Sans", sameWidths: true },
  ]);
  // The pictures set Times New Roman wider than it plots, in its own letters too.
  assert.deepEqual(pngFonts(["Times New Roman"], timesText, both), [
    { font: "Times New Roman", face: "Times New Roman", sameWidths: false },
  ]);
});

test(
  "the face the JSON names for Arial is the face the PNG is in",
  { skip: pngUnavailable() ?? false },
  async () => {
    const svg = (family: string): string =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 12"><text y="10" font-size="10" ` +
      `font-family="${family.replaceAll('"', "&quot;")}" fill="#fff">WIDTH</text></svg>`;
    const arial = svg(FONTS.Arial.family);
    // The same text in a family no machine has a face for is in the renderer's own typeface.
    const [inArial, inOwn] = await Promise.all([toPNG(arial, 240), toPNG(svg("monospace"), 240)]);
    const [named] = pngFonts(["Arial"], arial);
    assert.equal(named!.face !== SHIPPED.face, !inArial.png.equals(inOwn.png));
  },
);
