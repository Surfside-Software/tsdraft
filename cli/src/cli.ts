#!/usr/bin/env node
// The tsdraft command. `render` builds a drawing file once and prints a BuildState as JSON;
// `dev` serves a live preview that rebuilds on every save.
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Builder } from "./build.ts";
import { render } from "./render.ts";
import type { WriteOptions } from "./write.ts";

// A drawing file is TypeScript, which Node runs by stripping its types: from 22.18, or 23.6.
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);

if (major < 22 || (major === 22 && minor < 18) || (major === 23 && minor < 6)) {
  process.stderr.write(
    `tsdraft needs Node 22.18 or later to run a drawing file. This is Node ${process.versions.node}.\n`,
  );
  process.exit(1);
}

const HELP = `Usage:
  tsdraft render <file> [--out <dir>] [--width <px>] [--timeout <ms>] [--pdf]
                        [--drawing-json] [--draw-no-plot]
                        [--view <x0,y0,x1,y1> [--layout <name>]]
  tsdraft dev <file> [--port <n>] [--timeout <ms>] [--draw-no-plot]
  For a DXF, a DWG or an edit file, either takes [--reader <package or folder>]
  tsdraft shows <drawing file> [--sheet <layout> | --layout <layout>]
                [--near <x,y> [--within <d>]] [--xref <name>=<file>]... [--reader <package>]
  tsdraft write <edit file>... [--out <dir>] [--root <dir>] [--reader <package>]
  tsdraft mcp
  tsdraft feedback --kind <kind> --subject <subject> [--expected <text>]
                   [--actual <text>] [--workaround <text>]
  tsdraft feedback mode [on | off]
  tsdraft feedback list [--json]

A drawing file is a TypeScript module whose default export is a Drawing, or a
function that returns one. It may also be a DXF, or a DWG that a reader the
project installs reads: its pictures are the file as the leading CAD app shows
it, model space and each layout as it plots, read with geometry, and the JSON's
read-picture warnings say what they could not draw as the file holds it.

An edit file, whose default export is editDrawing(...), is drawn as the file it
edits will plot after the edit, with a second picture of what the edit changes:
what it does not reach faint, what it erases dashed in red, and what it moves or
stretches dashed in amber where it was and drawn where it goes. The JSON's edit
gives each statement with its call and its box, and lintEdit's errors exit 2. A
file whose SHA-256 is not the edit's is drawn as it is, with an edit-hash error.

render  Builds the file once, writes <name>.svg and <name>.png to --out (default:
        an out folder beside the file), and prints the result as JSON. Exits 0
        when it built with no lint errors, 2 when lint reported errors, and 1
        when the build failed before lint could report or a picture could not be
        written. Without the optional PNG renderer it
        writes the SVG, gives the reason as outputs.pngError and exits as above.
        Read the pictures at the paths in outputs. A picture this run did not
        write is removed from the default out folder, and left alone in --out.
        A drawing with layouts also gets <name>.layout-<layout>.svg and .png for
        each, the sheet as it plots, listed in outputs.layouts. An edit file also
        gets <name>.changes.svg and .png, and <name>.layout-<layout>.changes.svg
        and .png, listed in outputs.changes.
        With --pdf it also plots the sheets: <name>.pdf, the set, a page for each
        layout in order, as outputs.pdf, and <name>.layout-<layout>.pdf for each
        sheet alone, as outputs.layouts[].pdf.
        With --drawing-json it also writes <name>.drawing.json, the whole drawing
        as toJSON writes it, which fromJSON reads back, as outputs.drawingJson.
shows   Reads a DXF, or a file of another format through its reader, and prints
        as JSON what it shows: with --sheet, the layout's paper and what each
        viewport that is on shows of model space, through inserts and xrefs, with
        each box on the paper; with --layout, the layout's paper alone; else model
        space. With --near, only what comes within --within of the point, nearest
        first. Each entity comes with its handle, the inserts it was reached
        through, its kind, layer, color, box and text. An xref is followed only
        where --xref gives its file. A file is read once for each hash of its bytes,
        and the read is kept in the project's node_modules/.cache/tsdraft.
dev     Serves a live preview on localhost that rebuilds on every save of the
        file or a file it imports. Also serves /state.json, which with
        ?after=<build> waits for a newer build, /drawing.svg, /drawing.png?width=,
        /drawing.pdf, the set, and /events. Add layout=<name> to a picture's URL
        for a layout's sheet, and for an edit file changes=1 for the picture of
        what it changes.

mcp     Serves the command as an MCP server on stdin and stdout, for an agent
        whose harness speaks MCP, such as \`claude mcp add tsdraft -- npx tsdraft mcp\`.
        Its tool render builds a file as render does and answers with a short
        brief of the build and the pictures as images; execute runs a JavaScript
        program over builds and reads, and answers with only what it returns.

feedback  Files a report of where tsdraft got in an agent's way, for its
        maintainer. Off unless the user turns it on with mode on, or
        TSDRAFT_FEEDBACK=on, which wins over the saved mode. With it on, only a
        report's id, kind, subject and tsdraft version leave the machine; its
        texts never do. --kind is bug, confusing, missing_capability,
        wrong_docs or other. --subject is a command, an MCP tool (render,
        execute), a part of the library (lint, toSVG, toDXF, standard, edit,
        read, measureText) or general. --expected, --actual and --workaround,
        at most 300 characters each, stay in the copy saved in
        TSDRAFT_FEEDBACK_DIR or tsdraft's state folder. DO_NOT_TRACK,
        TSDRAFT_TELEMETRY=0 and CI stop the send and keep the copy. A report is
        sent once, when it is filed, and what became of the send is recorded in
        its copy. list prints the saved reports.
        What is sent, and what never is: https://github.com/Surfside-Software/tsdraft/blob/main/docs/command.md#agent-feedback

write   Makes the edited copy of the file each edit file names, and prints the
        job as JSON. An edit file is a TypeScript module whose default export is
        editDrawing({ file, sha256, name }, ...). A copy goes to the source's
        path from the job's root under --out (default: an out folder beside the
        edit files), only once the checks of every job pass on it: read back,
        structure, before and after, lint and the changed sheets. The root is
        --root, or the deepest folder that holds every source and every sheet
        the edits name. A source whose SHA-256 is not the edit's is refused; a
        lock beside it is a warning, and an edit lintEdit gives an error for is
        refused, with each error in files[].diagnostics. It never writes a
        source's own path. Exits
        0 when every copy was written, and 2 when any was not, with the reason
        in files[].reason. A .dwg needs an installed package that edits it, or
        --reader.

--width    PNG width in pixels. Default 1600.
--view     With render, draws one rectangle and nothing else, as <name>.view.svg
           and .png, listed in outputs.view: from its lower-left corner x0,y0
           to its upper-right x1,y1, in drawing units of model space. Use it to
           read small text, and give it the bounds of a diagnostic. It limits
           only the pictures: --drawing-json still writes the whole drawing.
--layout   With --view, the rectangle is on this layout's sheet, in paper units.
--pdf      With render, plots the sheets to PDF as well, as listed above.
--drawing-json  With render, writes the drawing of a drawing file as JSON as
           well, as listed above, with every path and text it holds. The same
           drawing gives the same bytes. None is written, and one from an earlier
           run is removed, when the build reports an error, when the drawing
           holds a value that is not plain data or names a file by an absolute
           path or one outside the project, when its JSON does not read back as
           the same bytes, and for a DXF, a DWG or an edit file:
           outputs.drawingJsonError says why.
--draw-no-plot  Draws the layers that do not plot too. The pictures leave them
           out by default, as a plot does.
--reader   The package that reads a DWG, an edit file's among them, by its name in
           the project or the path to its folder, when the project names none or
           more than one.
--port     Default 4610. When it is taken and no port was given, a free one.
--timeout  How long a build may run. Default 10000. The build of a DXF or a
           DWG takes at least 150000, as long as its read may take.

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

// A rectangle or a point often starts with a negative number, which parseArgs takes for an option
// unless it is written --view=-1,...: join --view or --near and a value that starts with a number
// into one argument.
const JOINED = new Set(["--view", "--near"]);

const args = process.argv
  .slice(2)
  .flatMap((arg, i, all) =>
    JOINED.has(arg) && /^-?[\d.]/.test(all[i + 1] ?? "")
      ? []
      : JOINED.has(all[i - 1] ?? "") && /^-?[\d.]/.test(arg)
        ? [`${all[i - 1]}=${arg}`]
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
      pdf: { type: "boolean" },
      "drawing-json": { type: "boolean" },
      view: { type: "string" },
      layout: { type: "string" },
      sheet: { type: "string" },
      near: { type: "string" },
      within: { type: "string" },
      xref: { type: "string", multiple: true },
      root: { type: "string" },
      reader: { type: "string" },
      kind: { type: "string" },
      subject: { type: "string" },
      expected: { type: "string" },
      actual: { type: "string" },
      workaround: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
} catch (error) {
  // SAFETY: parseArgs refuses an argument with a TypeError that says why.
  usage((error as Error).message);
}

const { positionals, values } = parsed;

const [command, target] = positionals;

if (values.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

if (!command || !["render", "dev", "shows", "write", "mcp", "feedback"].includes(command)) {
  usage("Give a command: render, dev, shows, write, mcp or feedback.");
}

const FEEDBACK_FLAGS = ["kind", "subject", "expected", "actual", "workaround", "json"] as const;

if (command === "feedback") {
  const other = Object.keys(values).find((flag) => !FEEDBACK_FLAGS.some((f) => f === flag));

  if (other !== undefined) usage(`--${other} does not go with feedback.`);

  const [action, value, ...more] = positionals.slice(1);

  const reportFlag = ["kind", "subject", "expected", "actual", "workaround"].find((flag) =>
    Object.hasOwn(values, flag),
  );

  if (action !== undefined && reportFlag !== undefined) {
    usage(`--${reportFlag} goes with a report: tsdraft feedback --kind … --subject ….`);
  }

  if (values.json !== undefined && action !== "list") usage("--json goes with list.");

  // The mode alone is read here: with feedback off, nothing more of it is loaded.
  const { configFile, feedbackMode, MODES, OFF_MESSAGE, setFeedbackMode } =
    await import("./feedback-mode.ts");

  if (action === "mode") {
    if (more.length > 0) usage("Give one mode: on or off.");
    const mode = value === undefined ? undefined : MODES.find((m) => m === value);

    if (value !== undefined && mode === undefined) {
      usage(`A mode is on or off, not ${JSON.stringify(value)}.`);
    }

    const file = mode === undefined ? configFile() : setFeedbackMode(mode);
    const now = feedbackMode();
    const overridden = mode !== undefined && now.mode !== mode;

    process.stdout.write(
      `${JSON.stringify(
        {
          ...now,
          file,
          ...(overridden && {
            note: `TSDRAFT_FEEDBACK is set, and it wins: the mode in effect is ${now.mode}.`,
          }),
        },
        null,
        2,
      )}\n`,
    );

    process.exit(0);
  }

  if (action !== undefined && action !== "list") {
    usage(`feedback has no ${JSON.stringify(action)}: give a report, mode or list.`);
  }

  const setting = feedbackMode();

  // A report needs feedback on; the saved copies may be listed at any time.
  if (action === undefined && setting.mode === "off") {
    process.stderr.write(`${setting.problem ?? OFF_MESSAGE}\n`);
    process.exit(1);
  }

  const { feedbackCommand, FeedbackUsage } = await import("./feedback.ts");

  let code;

  try {
    code = await feedbackCommand(positionals.slice(1), values);
  } catch (error) {
    if (error instanceof FeedbackUsage) usage(error.message);
    throw error;
  }

  process.exit(code);
}

for (const flag of FEEDBACK_FLAGS) {
  if (values[flag] !== undefined) usage(`--${flag} goes with feedback.`);
}

if (values["drawing-json"] && command !== "render") usage("--drawing-json goes with render.");

if (command === "mcp") {
  if (positionals.length > 1 || Object.keys(values).length > 0) usage("mcp takes nothing more.");
  const { serve } = await import("./mcp.ts");
  await serve();
  process.exit(0);
}

if (command === "write") {
  const edits = positionals.slice(1);

  if (edits.length === 0) usage("Give an edit file.");
  const { findReaders, ReaderRefusal } = await import("./readers.ts");
  const { writeEdits } = await import("./write.ts");
  let readers;

  try {
    readers = findReaders({ cwd: process.cwd(), inputs: edits, reader: values.reader });
  } catch (error) {
    if (!(error instanceof ReaderRefusal)) throw error;
    usage(error.message);
  }

  const timeout = number(values.timeout, "--timeout");

  const options: WriteOptions = {
    readers,
    out: values.out,
    root: values.root,
    reader: values.reader,
    cwd: process.cwd(),
  };

  if (timeout !== undefined) options.limits = { timeoutMs: timeout };

  const job = await writeEdits(
    edits.map((edit) => realpath(resolve(edit))),
    options,
  );

  process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
  process.exit(job.files.every((f) => f.written) ? 0 : 2);
}

if (values.root !== undefined) usage("--root goes with write.");

if (!target) usage("Give a drawing file.");

if (command === "shows") {
  if (values.sheet !== undefined && values.layout !== undefined) {
    usage("--sheet asks about a whole sheet, and --layout about its paper alone: give one.");
  }

  if (values.within !== undefined && values.near === undefined) usage("--within goes with --near.");
  const xrefs: Record<string, string> = {};

  for (const given of values.xref ?? []) {
    const at = given.indexOf("=");

    if (at <= 0 || at === given.length - 1) usage(`--xref ${given}: give <name>=<file>.`);
    xrefs[given.slice(0, at)] = resolve(given.slice(at + 1));
  }

  const near = values.near === undefined ? undefined : point(values.near);
  const { shows } = await import("./shows.ts");
  const { ReaderRefusal } = await import("./readers.ts");

  const answered = await shows({
    file: resolve(target),
    xrefs,
    ...(values.sheet !== undefined && { sheet: values.sheet }),
    ...(values.layout !== undefined && { layout: values.layout }),
    ...(near !== undefined && { near }),
    ...(values.within !== undefined && { within: distance(values.within) }),
    ...(values.reader !== undefined && { reader: values.reader }),
  }).catch((cause: unknown) => {
    if (cause instanceof ReaderRefusal) usage(cause.message);
    throw cause;
  });

  process.stdout.write(`${JSON.stringify(answered.json, null, 2)}\n`);
  process.exit(answered.code);
}

for (const flag of ["sheet", "near", "within", "xref"] as const) {
  if (values[flag] !== undefined) usage(`--${flag} goes with shows.`);
}

// Node reports real paths in stacks and to the import hooks, so the build works with the real
// path of the file, and so of its project, to place errors and watch imports through a symlink.
const file = realpath(resolve(target));
const timeout = number(values.timeout, "--timeout") ?? 10_000;

if (values.view !== undefined && command !== "render") usage("--view goes with render.");

if (values.layout !== undefined && values.view === undefined) usage("--layout goes with --view.");

if (values.pdf && command !== "render") usage("--pdf goes with render.");

if (values.pdf && values.view !== undefined)
  usage("--pdf plots whole sheets, and --view draws one rectangle.");

if (values.pdf && values["draw-no-plot"]) {
  usage("--pdf plots the sheets as they plot, and --draw-no-plot draws layers a plot leaves out.");
}

if (command === "dev") {
  const { dev } = await import("./dev.ts");
  await dev(file, {
    port: number(values.port, "--port"),
    timeout,
    drawNoPlot: values["draw-no-plot"] === true,
    ...(values.reader !== undefined && { reader: values.reader }),
  });
} else {
  const width = number(values.width, "--width") ?? 1600;
  const view = values.view === undefined ? undefined : rectangle(values.view);

  const builder = new Builder({
    timeout,
    warm: false,
    drawNoPlot: values["draw-no-plot"] === true,
    drawingJson: values["drawing-json"] === true,
    ...(values.reader !== undefined && { reader: values.reader }),
    view:
      view && (values.layout === undefined ? { box: view } : { box: view, layout: values.layout }),
  });

  const { state, code } = await render(file, {
    builder,
    closeBuilder: true,
    width,
    pdf: values.pdf === true,
    drawingJson: values["drawing-json"] === true,
    ...(values.out !== undefined && { out: values.out }),
    ...(view !== undefined && { view }),
  });

  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
  process.exitCode = code;
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

/** The point `--near` names: two numbers with a comma between. */
function point(value: string): [number, number] {
  const parts = value.split(",").map((part) => (part.trim() === "" ? NaN : Number(part)));

  if (parts.length !== 2 || !parts.every(Number.isFinite)) {
    usage(`--near must be x,y, not ${JSON.stringify(value)}`);
  }

  return [parts[0]!, parts[1]!];
}

function distance(value: string): number {
  const n = Number(value);

  if (!Number.isFinite(n) || n < 0)
    usage(`--within must be a distance of 0 or more, not ${JSON.stringify(value)}`);

  return n;
}

function number(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);

  if (!Number.isInteger(n) || n <= 0) {
    usage(`${flag} must be a positive whole number, not ${JSON.stringify(value)}`);
  }

  return n;
}
