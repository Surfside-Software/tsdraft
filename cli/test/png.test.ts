import assert from "node:assert/strict";
import { test } from "node:test";
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
