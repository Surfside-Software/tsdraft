// Warm library calls on the permit set. Run with pnpm bench:io.
import drawing, { xrefs } from "../examples/plan-set/set.ts";
import { readDXF, toDXF, toSVG } from "../src/index.ts";

async function measure(name: string, run: () => unknown): Promise<void> {
  await run();
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    await run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.log(`${name}: ${times[2]!.toFixed(1)} ms (median of 5)`);
}

const dxf = toDXF(drawing);
await measure("Write DXF", () => toDXF(drawing));
await measure("Read DXF with geometry", () => readDXF(dxf, { geometry: true }));
await measure("Draw model space and all sheets as SVG", () => {
  toSVG(drawing, { xrefs });
  for (const sheet of drawing.layouts ?? []) toSVG(drawing, { xrefs, layout: sheet.name });
});
