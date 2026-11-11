import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDrawing, FONTS, measureText, toSVG, type Font } from "tsdraft";
import {
  capHeight,
  faces,
  familyName,
  findFaces,
  pngFonts,
  shippedCap,
  SHIPPED,
  type Face,
} from "../src/fonts.ts";
import { pngUnavailable, RendererCrashed, toPNG } from "../src/png.ts";
import { decode, ink } from "./pixels.ts";

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
  // The file states how tall its capitals are, which sizes a text set in it.
  assert.equal(capHeight(shipped), 0.73);
  assert.equal(shippedCap(), 0.73);
  assert.equal(capHeight(shipped.subarray(0, 40)), undefined);
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
    { font: "Arial", face: "JetBrains Mono" },
    { font: "romans.shx", face: "JetBrains Mono" },
  ]);
  const arial = { ...FONTS.Arial, face: "Liberation Sans", file: "/fonts/a.ttf" };
  const times = { ...FONTS["Times New Roman"], face: "Times New Roman", file: "/t" };
  const both = new Map<string, Face>([
    ["Arial", arial],
    ["Times New Roman", times],
  ]);
  assert.deepEqual(pngFonts(["Arial"], arialText, both), [
    { font: "Arial", face: "Liberation Sans" },
  ]);
  assert.deepEqual(pngFonts(["Times New Roman"], timesText, both), [
    { font: "Times New Roman", face: "Times New Roman" },
  ]);
});

/** Pixels to a drawing unit in the pictures below, which are 60 units wide. */
const SCALE = 50;

/**
 * Draws one text in the strip from 0, 0 to 60, 6 and gives the box of its ink in drawing
 * units, as `[left, bottom, right, top]`.
 */
async function drawn(
  value: string,
  options: { font?: Font; widthFactor?: number; align?: "left" | "center" | "right" },
  known?: ReadonlyMap<string, Face>,
): Promise<[number, number, number, number]> {
  const d = createDrawing();
  const { font = "txt.shx", widthFactor = 1, align = "left" } = options;
  d.text([30, 2], value, { height: 1, align, style: { name: "S", font, widthFactor } });
  const svg = toSVG(d.build(), { view: [0, 0, 60, 6] });
  const { png } = await toPNG(svg, 60 * SCALE, known);
  const [left, top, right, bottom] = ink(decode(png));
  return [left / SCALE, 6 - bottom / SCALE, right / SCALE, 6 - top / SCALE];
}

test(
  "a txt.shx text is as long and as tall in the PNG as measureText says it plots",
  { skip: pngUnavailable() ?? false },
  async () => {
    // Capitals with flat tops and feet, which start and end with an upright.
    const value = "HIT THE LINE H";
    for (const widthFactor of [1, 0.6, 1.5]) {
      for (const align of ["left", "center", "right"] as const) {
        const what = `${align} at ${widthFactor}`;
        const { corners, length } = measureText({
          value,
          height: 1,
          at: [30, 2],
          widthFactor,
          align,
        });
        const [left, bottom, right, top] = await drawn(value, { widthFactor, align });
        // The stand-in's letters sit inside their cells, so its ink ends within a fifth of a
        // character of where the text does, and never outside it.
        const slack = (0.2 * length) / value.length + 1 / SCALE;
        assert.ok(left >= corners[0][0] - 1 / SCALE && left <= corners[0][0] + slack, what);
        assert.ok(right <= corners[1][0] + 1 / SCALE && right >= corners[1][0] - slack, what);
        // Its capitals stand on the baseline and are the text's height.
        assert.ok(Math.abs(bottom - 2) <= 1.5 / SCALE, `${what}: bottom ${bottom}`);
        assert.ok(Math.abs(top - 3) <= 1.5 / SCALE, `${what}: top ${top}`);
      }
    }
  },
);

test("the PNG keeps a text's spaces", { skip: pngUnavailable() ?? false }, async () => {
  const d = createDrawing();
  d.text([2, 2], "H      H", { height: 1 });
  const { png } = await toPNG(toSVG(d.build(), { view: [0, 0, 40, 6] }), 40 * SCALE);
  const pixels = decode(png);
  const [left, , right] = ink(pixels);
  // Two uprights seven characters apart, with nothing between them.
  assert.ok((right - left) / SCALE > 7);
  for (let x = left + 1.2 * SCALE; x < right - 1.2 * SCALE; x++) {
    for (let y = 0; y < pixels.height; y++) assert.ok(pixels.at(Math.round(x), y) < 128);
  }
});

test(
  "a text is as tall as it plots in whichever face draws it",
  { skip: pngUnavailable() ?? false },
  async () => {
    const value = "HIT THE LINE H";
    const { corners, length } = measureText({ value, height: 1, font: "Arial", at: [30, 2] });
    const check = ([left, bottom, right, top]: number[], what: string): void => {
      const slack = (0.2 * length) / value.length + 1 / SCALE;
      assert.ok(left! >= corners[0][0] - 1 / SCALE && left! <= corners[0][0] + slack, what);
      assert.ok(right! <= corners[1][0] + 1 / SCALE && right! >= corners[1][0] - slack, what);
      assert.ok(Math.abs(bottom! - 2) <= 1.5 / SCALE, `${what}: bottom ${bottom}`);
      assert.ok(Math.abs(top! - 3) <= 1.5 / SCALE, `${what}: top ${top}`);
    };
    // With no face for Arial, the renderer's own stands in, whose capitals are taller for
    // their size than Arial's.
    check(await drawn(value, { font: "Arial" }, new Map()), "the shipped face");
    // The machine's face for Arial, when it has one: Arial itself, or a font made to its widths.
    const own = faces().get("Arial");
    if (own) check(await drawn(value, { font: "Arial" }), own.face);
    // A face that says its capitals are half as tall as they are is drawn twice too tall.
    const wrong = new Map([["Arial", { ...FONTS.Arial, ...SHIPPED, capHeight: 0.73 / 2 }]]);
    const [, bottom, , top] = await drawn(value, { font: "Arial" }, wrong);
    assert.ok(Math.abs(top - bottom - 2) <= 3 / SCALE);
  },
);

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
