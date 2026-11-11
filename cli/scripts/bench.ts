// Measures the loop: `tsdraft render` from start to exit, and in `tsdraft dev` the time from
// saving a drawing file to this script receiving the server's build event with the new SVG, not
// to the page painting it. Saves come once with a pause that lets the spare child finish
// starting, and once back to back, the next save as soon as the last build arrives. Runs on
// examples/lot.ts, on a generated drawing of 5,000 entities, a fifth of them texts, and on the example sheet. Each
// time is a median, and each line of `dev` says where a build's time went: its steps, `rest`
// for what the steps leave of the build, and `around` for the time outside it, which is the
// watch, the wait for the save to settle and the push. The machine's load average and its
// number of cores are beside each drawing, since a busy machine is slower. Run with `pnpm bench`.
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, loadavg } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = `${root}src/cli.ts`;
const dir = `${root}examples/out/bench`;
mkdirSync(dir, { recursive: true });

const small = `${dir}/small.ts`;
copyFileSync(`${root}examples/lot.ts`, small);
const large = `${dir}/large.ts`;
writeFileSync(
  large,
  `import { createDrawing } from "tsdraft";
const d = createDrawing({ units: "ft", dxf: "R2018" });
// 1,000 lots of 5 entities each.
for (let row = 0; row < 25; row++) {
  for (let col = 0; col < 40; col++) {
    const x = col * 60;
    const y = row * 120;
    d.layer("C-PROP", { color: 7 }, () => d.rect([x, y], 50, 110));
    d.layer("A-BLDG", { color: 4 }, () => d.rect([x + 10, y + 30], 30, 40));
    d.layer("C-PAVE", { color: 8 }, () => d.line([x + 25, y], [x + 25, y + 30]));
    d.layer("V-TREE", { color: 3 }, () => d.circle([x + 25, y + 95], 6));
    d.layer("C-ANNO", { color: 7 }, () => d.text([x + 2, y + 2], \`LOT \${row * 40 + col + 1}\`, { height: 3 }));
  }
}
export default d.build();
`,
);

// The example sheet: model space and a layout, so two pictures a build.
// It is copied with its helpers, importing the library by name as the other two do.
const sheet = `${dir}/site-plan.ts`;
mkdirSync(`${dir}/lib`, { recursive: true });
for (const file of ["site-plan.ts", "lib/drafting.ts"]) {
  const source = readFileSync(`${root}../examples/${file}`, "utf8");
  writeFileSync(`${dir}/${file}`, source.replace(/"(\.\.\/)+src\/index\.ts"/, '"tsdraft"'));
}

const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

function benchRender(file: string, runs: number) {
  const walls: number[] = [];
  let state: { ms: number; timings: Record<string, number>; drawing: { counts: object } } | null =
    null;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    state = JSON.parse(execFileSync(process.execPath, [cli, "render", file], { encoding: "utf8" }));
    walls.push(performance.now() - t);
  }
  return { wall: median(walls), last: state! };
}

async function benchDev(file: string, edits: number, pause: number) {
  const server = spawn(process.execPath, [cli, "dev", file, "--port", "4699"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve) =>
    server.stdout.on("data", (b: Buffer) => b.toString().includes("http") && resolve()),
  );
  const response = await fetch("http://127.0.0.1:4699/events");
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const nextBuild = async (): Promise<{
    state: { build: number; ms: number; ok: boolean; timings: Record<string, number> };
  }> => {
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (block.startsWith("event: build")) return JSON.parse(block.split("data: ")[1]!);
        continue;
      }
      const { value } = await reader.read();
      buffer += decoder.decode(value, { stream: true });
    }
  };
  await nextBuild();
  // Let the waiting children start and warm up, as they would between saves.
  await new Promise((r) => setTimeout(r, 300));
  const source = readFileSync(file, "utf8");
  const served: number[] = [];
  const builds: number[] = [];
  const steps: Record<string, number[]> = { start: [], load: [], lint: [], svg: [], rest: [] };
  for (let i = 0; i < edits; i++) {
    const t = performance.now();
    writeFileSync(file, `${source}\n// edit ${i}\n`);
    const event = await nextBuild();
    served.push(performance.now() - t);
    builds.push(event.state.ms);
    let rest = event.state.ms;
    for (const step of ["start", "load", "lint", "svg"]) {
      steps[step]!.push(event.state.timings[step] ?? 0);
      rest -= event.state.timings[step] ?? 0;
    }
    steps.rest!.push(rest);
    await new Promise((r) => setTimeout(r, pause));
  }
  server.kill();
  writeFileSync(file, source);
  const [total, build] = [median(served), median(builds)];
  const parts = Object.entries(steps).map(([step, ms]) => `${step} ${median(ms).toFixed(1)}`);
  return `${total.toFixed(0)} ms (build ${build} ms: ${parts.join(", ")}; around ${(total - build).toFixed(0)} ms)`;
}

for (const [name, file] of [
  ["examples/lot.ts", small],
  ["5,000 entities", large],
  ["examples/site-plan.ts", sheet],
] as const) {
  const render = benchRender(file, 5);
  const paused = await benchDev(file, 10, 300);
  const backToBack = await benchDev(file, 10, 0);
  console.log(
    `${name}: ${JSON.stringify(render.last.drawing.counts)}, load average ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores\n` +
      `  render, start to exit: ${render.wall.toFixed(0)} ms (build ${render.last.ms} ms, ` +
      `${JSON.stringify(render.last.timings)})\n` +
      `  dev, save to SVG pushed, 300 ms between saves: ${paused}\n` +
      `  dev, save to SVG pushed, back to back: ${backToBack}`,
  );
}
