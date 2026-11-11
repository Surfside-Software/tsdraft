#!/usr/bin/env node
// The tsdraft command. `render` builds a drawing file once and prints a BuildState as JSON;
// `dev` serves a live preview that rebuilds on every save.
import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Builder, projectRoot, round, toState } from "./build.ts";
import { pngUnavailable, toPNG } from "./png.ts";
import type { BuildError, BuildState } from "./state.ts";

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
                        [--draw-no-plot]
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
dev     Serves a live preview on localhost that rebuilds on every save of the
        file or a file it imports. Also serves /state.json, which with
        ?after=<build> waits for a newer build, /drawing.svg, /drawing.png?width=
        and /events.

--width    PNG width in pixels. Default 1600.
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

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string" },
      width: { type: "string" },
      port: { type: "string" },
      timeout: { type: "string" },
      "draw-no-plot": { type: "boolean" },
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

if (command === "dev") {
  const { dev } = await import("./dev.ts");
  await dev(file, {
    port: number(values.port, "--port"),
    timeout,
    drawNoPlot: values["draw-no-plot"] === true,
  });
} else {
  const width = number(values.width, "--width") ?? 1600;
  const builder = new Builder({
    timeout,
    warm: false,
    drawNoPlot: values["draw-no-plot"] === true,
  });
  const outcome = (await builder.build(file, projectRoot(file)))!;
  const outputs: { svg: string | null; png: string | null; pngError: string | null } = {
    svg: null,
    png: null,
    pngError: null,
  };
  let pngMs: number | undefined;
  let failed: BuildError | null = null;
  const dir = resolve(values.out ?? join(file, "..", "out"));
  const name = basename(file, extname(file));
  let path = dir;
  try {
    if (outcome.ok && outcome.svg) {
      mkdirSync(dir, { recursive: true });
      path = join(dir, `${name}.svg`);
      writeFileSync(path, outcome.svg);
      outputs.svg = path;
      // Without the optional renderer the drawing still built: the JSON says why no PNG.
      outputs.pngError = pngUnavailable();
      if (outputs.pngError === null) {
        path = join(dir, `${name}.png`);
        const t = performance.now();
        const { png } = await toPNG(outcome.svg, width);
        pngMs = performance.now() - t;
        writeFileSync(path, png);
        outputs.png = path;
      } else {
        process.stderr.write(`tsdraft: ${outputs.pngError}.\n`);
      }
    }
  } catch (error) {
    failed = outputError(`Could not write ${path}`, error);
  }
  // A picture this run did not write is not left behind from an earlier run, where it would
  // pass for the drawing as it is now. Only in the default folder, which is this command's: a
  // file in a folder the user named may be theirs.
  for (const [kind, written] of Object.entries({ svg: outputs.svg, png: outputs.png })) {
    if (written !== null || values.out !== undefined) continue;
    const old = join(dir, `${name}.${kind}`);
    try {
      rmSync(old, { force: true });
    } catch (error) {
      if (outcome.ok) failed ??= outputError(`Could not remove the old ${old}`, error);
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

function number(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    usage(`${flag} must be a positive whole number, not ${JSON.stringify(value)}`);
  }
  return n;
}
