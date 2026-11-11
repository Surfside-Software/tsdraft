#!/usr/bin/env node
// The tsdraft command. `render` builds a drawing file once and prints a BuildState as JSON;
// `dev` serves a live preview that rebuilds on every save.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Builder, projectRoot, round, toState } from "./build.ts";
import { faces, pngFonts } from "./fonts.ts";
import { pngUnavailable, RendererCrashed, startRenderer, toPNG } from "./png.ts";
import type { BuildError, BuildState, LayoutOutput } from "./state.ts";

// A drawing file is TypeScript, which Node runs by stripping its types: from 22.18, or 23.6.
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18) || (major === 23 && minor < 6)) {
  process.stderr.write(
    `tsdraft needs Node 22.18 or later to run a drawing file. This is Node ${process.versions.node}.\n`,
  );
  process.exit(1);
}

const HELP = `Usage:
  tsdraft render <file> [--out <dir>] [--width <px>] [--timeout <ms>]
                        [--draw-no-plot] [--view <x0,y0,x1,y1> [--layout <name>]]
  tsdraft dev <file> [--port <n>] [--timeout <ms>] [--draw-no-plot]

A drawing file is a TypeScript module whose default export is a Drawing, or a
function that returns one.

render  Builds the file once, writes <name>.svg and <name>.png to --out (default:
        an out folder beside the file), and prints the result as JSON. Exits 0
        when it built with no lint errors, 2 when lint reported errors, and 1
        when the build failed before lint could report or a picture could not be
        written. Without the optional PNG renderer it
        writes the SVG, gives the reason as outputs.pngError and exits as above.
        Read the pictures at the paths in outputs. A picture this run did not
        write is removed from the default out folder, and left alone in --out.
        A drawing with layouts also gets <name>.layout-<layout>.svg and .png for
        each, the sheet as it plots, listed in outputs.layouts.
dev     Serves a live preview on localhost that rebuilds on every save of the
        file or a file it imports. Also serves /state.json, which with
        ?after=<build> waits for a newer build, /drawing.svg, /drawing.png?width=
        and /events. Add layout=<name> to a picture's URL for a layout's sheet.

--width    PNG width in pixels. Default 1600.
--view     With render, draws one rectangle and nothing else, as <name>.view.svg
           and .png, listed in outputs.view: from its lower-left corner x0,y0
           to its upper-right x1,y1, in drawing units of model space. Use it to
           read small text, and give it the bounds of a diagnostic.
--layout   With --view, the rectangle is on this layout's sheet, in paper units.
--draw-no-plot  Draws the layers that do not plot too. The pictures leave them
           out by default, as a plot does.
--port     Default 4610. When it is taken and no port was given, a free one.
--timeout  How long a build may run. Default 10000.

Misuse prints this to stderr and exits 64, so stdout holds only JSON.

GUIDE.md in this package tells an agent how to work with tsdraft:
https://github.com/Surfside-Software/tsdraft/blob/main/GUIDE.md
`;

/** The exit code for a command used wrongly, as in sysexits.h. */
const USAGE = 64;

function usage(problem: string): never {
  process.stderr.write(`${problem}\n\n${HELP}`);
  process.exit(USAGE);
}

// A rectangle often starts with a negative number, which parseArgs takes for an option unless it
// is written --view=-1,...: join --view and a value that starts with a number into one argument.
const args = process.argv
  .slice(2)
  .flatMap((arg, i, all) =>
    arg === "--view" && /^-?[\d.]/.test(all[i + 1] ?? "")
      ? []
      : all[i - 1] === "--view" && /^-?[\d.]/.test(arg)
        ? [`--view=${arg}`]
        : [arg],
  );

let parsed;
try {
  parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      width: { type: "string" },
      port: { type: "string" },
      timeout: { type: "string" },
      "draw-no-plot": { type: "boolean" },
      view: { type: "string" },
      layout: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
} catch (error) {
  usage((error as Error).message);
}
const { positionals, values } = parsed;

const [command, target] = positionals;
if (values.help) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (!command || !["render", "dev"].includes(command)) usage("Give a command: render or dev.");
if (!target) usage("Give a drawing file.");

// Node reports real paths in stacks and to the import hooks, so the build works with the real
// path of the file, and so of its project, to place errors and watch imports through a symlink.
const file = realpath(resolve(target));
const timeout = number(values.timeout, "--timeout") ?? 10_000;
if (values.view !== undefined && command !== "render") usage("--view goes with render.");
if (values.layout !== undefined && values.view === undefined) usage("--layout goes with --view.");

if (command === "dev") {
  const { dev } = await import("./dev.ts");
  await dev(file, {
    port: number(values.port, "--port"),
    timeout,
    drawNoPlot: values["draw-no-plot"] === true,
  });
} else {
  const width = number(values.width, "--width") ?? 1600;
  const view = values.view === undefined ? undefined : rectangle(values.view);
  const builder = new Builder({
    timeout,
    warm: false,
    drawNoPlot: values["draw-no-plot"] === true,
    view: view && { box: view, ...(values.layout === undefined ? {} : { layout: values.layout }) },
  });
  // The renderer's process starts while the drawing is built.
  startRenderer();
  let pngMs: number | undefined;
  const building = builder.build(file, projectRoot(file));
  // The machine's fonts are looked for while the drawing is built.
  faces();
  const outcome = (await building)!;
  const layouts: { -readonly [K in keyof LayoutOutput]: LayoutOutput[K] }[] = [];
  /**
   * Draws a picture's PNG and writes it. When the renderer dies on the picture, gives the
   * reason, and the rest of the run goes on: the SVG is written, and so is every other picture.
   */
  const drawPng = async (svg: string, to: string): Promise<string | null> => {
    const t = performance.now();
    try {
      const { png } = await toPNG(svg, width);
      writeFileSync(to, png);
      return null;
    } catch (error) {
      if (!(error instanceof RendererCrashed)) throw error;
      process.stderr.write(`tsdraft: ${error.message}.\n`);
      return error.message;
    } finally {
      pngMs = (pngMs ?? 0) + performance.now() - t;
    }
  };
  const outputs: { -readonly [K in keyof BuildState["outputs"]]: BuildState["outputs"][K] } = {
    svg: null,
    png: null,
    pngError: null,
    pngFonts: [],
    layouts,
    view: null,
  };
  let failed: BuildError | null = null;
  const dir = resolve(values.out ?? join(file, "..", "out"));
  const name = basename(file, extname(file));
  let path = dir;
  try {
    if (outcome.ok && outcome.view && view) {
      // A view is the one picture of its run.
      mkdirSync(dir, { recursive: true });
      path = join(dir, `${name}.view.svg`);
      writeFileSync(path, outcome.view.svg);
      const unavailable = pngUnavailable();
      const made = {
        layout: outcome.view.layout,
        box: { min: [view[0], view[1]], max: [view[2], view[3]] },
        svg: path,
        png: null as string | null,
        pngError: unavailable,
        pngFonts: pngFonts(outcome.view.fonts, outcome.view.svg),
      } as const;
      outputs.view = made;
      if (unavailable === null) {
        path = join(dir, `${name}.view.png`);
        const pngError = await drawPng(outcome.view.svg, path);
        outputs.view = { ...made, pngError, png: pngError === null ? path : null };
      } else {
        process.stderr.write(`tsdraft: ${unavailable}.\n`);
      }
    } else if (outcome.ok && outcome.svg) {
      mkdirSync(dir, { recursive: true });
      path = join(dir, `${name}.svg`);
      writeFileSync(path, outcome.svg);
      outputs.svg = path;
      outputs.pngFonts = pngFonts(outcome.fonts, outcome.svg);
      // Without the optional renderer the drawing still built: the JSON says why no PNG.
      const unavailable = pngUnavailable();
      outputs.pngError = unavailable;
      if (outputs.pngError === null) {
        path = join(dir, `${name}.png`);
        outputs.pngError = await drawPng(outcome.svg, path);
        if (outputs.pngError === null) outputs.png = path;
      } else {
        process.stderr.write(`tsdraft: ${outputs.pngError}.\n`);
      }
      // Each layout's sheet, beside the picture of model space.
      const taken = new Set<string>();
      for (const sheet of outcome.layouts) {
        const stem = layoutFile(name, sheet.name, taken);
        path = join(dir, `${stem}.svg`);
        writeFileSync(path, sheet.svg);
        const made = {
          name: sheet.name,
          svg: path,
          png: null as string | null,
          pngError: unavailable,
          pngFonts: pngFonts(sheet.fonts, sheet.svg),
        };
        if (unavailable === null) {
          path = join(dir, `${stem}.png`);
          made.pngError = await drawPng(sheet.svg, path);
          if (made.pngError === null) made.png = path;
        }
        layouts.push(made);
      }
    }
  } catch (error) {
    failed = outputError(`Could not write ${path}`, error);
  }
  // A picture this run did not write is not left behind from an earlier run, where it would
  // pass for the drawing as it is now. Only in the default folder, which is this command's: a
  // file in a folder the user named may be theirs.
  for (const [kind, written] of Object.entries({
    svg: outputs.svg,
    png: outputs.png,
    "view.svg": outputs.view?.svg ?? null,
    "view.png": outputs.view?.png ?? null,
  })) {
    if (written !== null || values.out !== undefined) continue;
    const old = join(dir, `${name}.${kind}`);
    try {
      rmSync(old, { force: true });
    } catch (error) {
      if (outcome.ok) failed ??= outputError(`Could not remove the old ${old}`, error);
    }
  }
  // The same for the picture of a layout the drawing no longer has.
  if (values.out === undefined && existsSync(dir)) {
    const kept = new Set(layouts.flatMap((made) => [made.svg, made.png]));
    for (const entry of readdirSync(dir)) {
      const old = join(dir, entry);
      if (!entry.startsWith(`${name}.layout-`) || !/\.(svg|png)$/.test(entry) || kept.has(old)) {
        continue;
      }
      try {
        rmSync(old, { force: true });
      } catch (error) {
        if (outcome.ok) failed ??= outputError(`Could not remove the old ${old}`, error);
      }
    }
  }
  const state = toState(outcome, randomUUID().slice(0, 8), 1, file, outcome.ok ? 1 : null, outputs);
  const timings = pngMs === undefined ? state.timings : { ...state.timings, png: round(pngMs) };
  const result: BuildState = failed
    ? { ...state, ok: false, error: failed, timings }
    : { ...state, timings };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const errors = state.drawing?.counts.errors ?? 0;
  process.exitCode = outcome.linted || (result.ok && errors > 0) ? 2 : result.ok ? 0 : 1;
}

/**
 * The name of a layout's pictures, without an extension: the drawing file's name, `.layout-`
 * and the layout's name with every character a file name may not hold as `_`. A second layout
 * that comes to the same name has a number after it.
 */
function layoutFile(name: string, layout: string, taken: Set<string>): string {
  const safe = layout.replaceAll(/[^A-Za-z0-9._-]/g, "_");
  let stem = `${name}.layout-${safe}`;
  for (let n = 2; taken.has(stem.toLowerCase()); n++) stem = `${name}.layout-${safe}-${n}`;
  taken.add(stem.toLowerCase());
  return stem;
}

function outputError(what: string, error: unknown): BuildError {
  const e = error as NodeJS.ErrnoException;
  return {
    name: "Output",
    message: `${what}: ${e.message}`,
    code: typeof e.code === "string" ? e.code : null,
    file: null,
    line: null,
    column: null,
    stack: e.stack ?? "",
  };
}

function realpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    // Missing: the build reports it.
    return path;
  }
}

/** The rectangle `--view` names: four numbers with commas between, the second corner above the first. */
function rectangle(value: string): [number, number, number, number] {
  const parts = value.split(",").map((part) => (part.trim() === "" ? NaN : Number(part)));
  const [x0 = NaN, y0 = NaN, x1 = NaN, y1 = NaN] = parts;
  if (parts.length !== 4 || !parts.every(Number.isFinite) || !(x1 > x0 && y1 > y0)) {
    usage(
      `--view must be x0,y0,x1,y1, the lower-left and the upper-right corner of a rectangle, not ${JSON.stringify(value)}`,
    );
  }
  return [x0, y0, x1, y1];
}

function number(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    usage(`${flag} must be a positive whole number, not ${JSON.stringify(value)}`);
  }
  return n;
}
