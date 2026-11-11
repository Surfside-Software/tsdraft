# The `tsdraft` command

The `tsdraft` command comes with the package. It shows you a drawing within a fraction of a
second of saving its file, with no CAD program. `tsdraft render` builds a drawing file once and
gives its SVG, its PNG and a JSON object with what `lint` found. `tsdraft dev` serves a live
preview. [GUIDE.md](../GUIDE.md) is the short version of this page, written for an agent.

```sh
npm i -D tsdraft
npx tsdraft render plan.ts
npx tsdraft dev plan.ts
```

The command needs Node 22.18 or later, because Node runs the drawing file by stripping its
types, and it says so on an older Node. The library itself runs on Node 22. The command has
been run on Linux only, not on macOS or Windows.

The project's `package.json` must say `"type": "module"`, or the drawing file must be named
`.mts`. `npm init` writes `"type": "commonjs"`, and Node then refuses the file's `import`.

## A drawing file

A TypeScript module whose default export is a `Drawing`, or a function that returns one, sync or
async. Copy [`cli/examples/lot.ts`](../cli/examples/lot.ts):

```ts
import { createDrawing, PHANTOM } from "tsdraft";
const d = createDrawing({ units: "ft", linetypeScale: 4 });
d.layer("C-PROP", { color: 7, linetype: PHANTOM, lineweight: 0.35 }, () =>
  d.rect([0, 0], 100, 140),
);
export default d.build();
```

Each build runs the file in a new child process, so a crash cannot take the command down and
every build sees the code as it is now. A build that runs longer than `--timeout`, 10 s by default, fails.

## Commands

`tsdraft render <file> [--out <dir>] [--width <px>] [--draw-no-plot]` builds once, runs `lint`,
writes `<name>.svg` and a `<name>.png` 1600 px wide to `out/` beside the file, and prints one
JSON object. It exits 0 when the drawing built with no lint errors, 2 when it has lint errors,
and 1 when the build failed or a picture could not be written. Wrong usage prints help to stderr
and exits 64, so stdout only ever holds the JSON. Read the pictures at the paths in `outputs`. A
picture this run does not write, because the build failed or there is no PNG renderer, is
removed from the default `out/` folder, so a file there is never from an earlier run. In a
folder named with `--out` the command removes nothing: a `<name>.svg` or `<name>.png` it did not
write this run stays as it was, and `outputs` gives `null` for it. The pictures show the drawing
as it plots: a layer that does not plot is left out, as one that is off or frozen is, and
`--draw-no-plot` draws those layers too. `tsdraft dev` takes the same flag. The colors are the
ones a plot gives each pen, so the darkest pens are faint on the dark preview.

`tsdraft dev <file> [--port <n>]` serves a live preview at `http://127.0.0.1:4610`, or the next
free port when that one is taken. It rebuilds when you save the file or any file it imports,
inside the project or not, including one it tried to import before you created it, a workspace
package linked into `node_modules`, and where a symlink it imported through points,
including a package's link in `node_modules`.
Packages installed under `node_modules` are not watched, and neither are files the drawing reads
with `fs`. The page draws linetypes, pen weights and text styles as `toSVG` does, with each text justified to its point and in its style's font where the browser has it. A PNG draws every font in the one font it carries, JetBrains Mono. The page has pan and zoom, layer
toggles and the diagnostics, and marks a layer the drawing has off, frozen or set not to plot, whose
entities are not drawn. Each diagnostic shows the call that drew its entity. Click a diagnostic to find its entity. While a build runs, the status reads
"building N…". When a build fails, the page dims the last good drawing and shows the error. For an agent without a browser it serves:

| Path                                 | What it is                                                                |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `/state.json`                        | The same JSON `render` prints, for the latest finished build              |
| `/state.json?after=<n>`              | The same, once a build newer than `n` has finished and none is due        |
| `/drawing.svg?session=<s>&build=<n>` | The drawing on screen; 409 when build `n` of session `s` is not on screen |
| `/drawing.png?width=<px>`            | The same, as a PNG, rasterized only when asked for                        |
| `/events`                            | Server-Sent Events: `hello`, then `start` and `build` per build           |

Each response has an `x-tsdraft-session` header, and each state or picture an `x-tsdraft-build`
header that gives the build it came from. A PNG is at most
16 million pixels; a wider request is narrowed, and `x-tsdraft-width` gives the width used.

## The JSON

`BuildState` in [`cli/src/state.ts`](../cli/src/state.ts) documents each field. A failed build, trimmed:

```json
{
  "ok": false,
  "build": 4,
  "shownBuild": 3,
  "error": {
    "name": "SyntaxError",
    "message": "Expected ',', got ';'",
    "file": "/work/lot.ts",
    "line": 36,
    "column": 24
  }
}
```

When it builds, `drawing` gives the units, the extents, counts of layers, entities, errors and
warnings, and each layer. `diagnostics` holds what `lint` returned, errors first, each with its
`rule`, `severity` and `message`. A layer problem names its `layer`. An entity problem gives the
`entity` index, its `kind`, its `layer`, and `bounds`, its box in drawing units. It also gives
the entity's `id` when it has one, and `call`, the call in the drawing's code that drew the
entity: an absolute path, a line and a column, which is where to fix it. The command turns on
the builder's `recordCalls` for every drawing it runs.

```json
{
  "rule": "zero-length",
  "severity": "warning",
  "message": "line #1: the line has no length",
  "entity": 1,
  "id": "walk",
  "call": { "file": "/home/you/site/lot.ts", "line": 31, "column": 5 },
  "kind": "line",
  "layer": "C-PAVE",
  "bounds": { "min": [30, 40], "max": [30, 40] }
}
```

When a builder call breaks a rule, the build fails, and `diagnostics` holds that one problem
with its `rule` and the `call` that threw.

`error.file` and `error.line` point at the innermost line of your project's code in the stack:
the line of a helper when the helper threw, and your call when tsdraft threw. A diagnostic's
`call` does not skip to your project's code. It is the line that called the builder method,
which is inside a helper function or a package when one of those drew the entity.

In `tsdraft dev`, `session` changes each time the server starts, and `pending` is the number of
the build that is queued or running, or `null` when the state is the latest.

## The loop

1. Note `build` and `session` from the last state you read.
2. Edit the drawing file, or any file it imports.
3. With `tsdraft dev`, fetch `/state.json?after=<build>&session=<session>`. It answers once a
   build that started after your save has finished and no other is due, so the state, the
   diagnostics and the drawing all come from your edit. A 202 means no newer build finished in
   time: when `pending` is set a build is still due or running, so ask again; when it is `null`
   the server saw no change to any file it watches, which can mean the save was to a file the
   drawing reads with `fs` or from `node_modules`. Without `tsdraft dev`, run `tsdraft render`.
4. If `ok` is false, fix `error.file` at `error.line`. If `diagnostics` is not empty, fix each
   one, starting with the errors.
5. Look at `outputs.png` to check that the drawing looks right, and go back to step 1. Its URL
   names the session and the build, so a picture from another build, or from before a restart,
   is refused rather than mixed up with this state.

`?after=` waits up to the build timeout plus 5 s; `&timeout=<ms>` changes that, up to 120 s. A
plain `/state.json` right after a save may still show the old build, with `pending` set.

## Without the PNG renderer

The PNG is drawn by `@resvg/resvg-js`, an optional dependency of tsdraft that npm installs by
default. It is the package's only dependency, and the library never loads it. It is missing
after an install with `--omit=optional`, and on a machine it has no build for. Then:

- `tsdraft render` still writes the SVG and prints the JSON, with `"png": null` in `outputs`
  and the reason in `outputs.pngError`. `ok` stays true and the exit code is the one the drawing
  earns, 0 or 2, because the drawing built. It also prints the reason to stderr.
- `tsdraft dev` prints the reason to stderr when it starts, still serves the page, the state
  and the SVG, gives the same `outputs`, and answers `/drawing.png` with 501 and the reason.

The reason says which it is: the renderer is not installed, with the command that installs it,
or it is installed and has no build that loads on this platform.

`npm i -D @resvg/resvg-js` in the project adds the renderer. When it is installed, `pngError`
is `null`. A PNG that could not be written for another reason, such as a folder that cannot be
written to, is a failure as before: `ok` is false, `error.name` is `Output`, and the exit code
is 1.

## Which copy of the library builds a drawing

A drawing is checked and drawn by the copy of tsdraft its own file imports. The command looks
at what the drawing file itself imports, in two passes:

1. An import that is the library by its package: the entry of a package named `tsdraft`,
   reached by name, as source, or through an import alias. By name, that is the copy in the
   project's `node_modules`.
2. With none of those, an import that exports all of `createDrawing`, `lint`, `toSVG` and
   `toDXF`. That is a copy kept under another name, such as an alias to `./source/index.js`, or
   a kit that passes the library on.

A module of your own that exports a `lint` or a `toSVG` is never taken for the library, and
neither is a package that carries a copy of its own and loads it first.

In a project that installed tsdraft, the copy its drawing imports is also the copy the command
came from. Run from another install, such as a global one, the command still uses the project's
copy for `lint` and `toSVG`, so the drawing is held to the rules of the version the project
chose.

A drawing file that imports `tsdraft` in a project with no copy fails, because Node cannot find
the import. When neither pass finds the library among the file's own imports, the command
takes, in order:

1. the one copy the build loaded, when a helper the file imports built the drawing;
2. the project's copy, the one the file would get by importing `tsdraft` by name. This settles a
   build that loaded several copies, and one that loaded none;
3. the first copy the build loaded, when it loaded several and the project has none;
4. the library the command was installed with.

## Speed

In a checkout of the repository, `pnpm bench` measures the loop: from writing the file
to the benchmark receiving the server's `build` event with the new SVG, not to the page
painting it. On the example that takes about 40 ms when the saves are some time apart, as an
agent's are, and about 50 ms when each save follows the last build at once, because the next
build then waits for a new process to finish starting. For 3,000 entities both are about 90 ms.
`render` takes about 190 ms from start to exit on the example, PNG included.
