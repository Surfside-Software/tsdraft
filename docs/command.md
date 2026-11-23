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

A file may also export `intent`, what the drawing is meant to hold to, such as the setbacks a
footprint keeps out of, which each build checks: see [Checks of intent](intent.md). And it may
export `standard`, the firm's standard the drawing is drawn to, which each build holds it to:
see [Standards](standard.md#the-command).

Each build runs the file in a new child process, so a crash cannot take the command down and
every build sees the code as it is now. A build that runs longer than `--timeout`, 10 s by default, fails.

## Commands

`tsdraft render <file> [--out <dir>] [--width <px>] [--draw-no-plot] [--pdf]` builds once, runs `lint`,
with the file's export `standard` when it has one,
`inspectText` and, for a file that exports `intent`, `checkIntent`, writes `<name>.svg` and a `<name>.png` 1600 px wide to `out/` beside the
file, and prints one JSON object. With `--view`, it writes one rectangle of the drawing and
no other picture: see [A closer look](#a-closer-look). It exits 0 when the drawing built with no lint errors, 2 when `lint` reported
errors, and 1 when the build failed before `lint` could report or a picture could not be
written. Wrong usage prints help to stderr
and exits 64, so stdout only ever holds the JSON. Read the pictures at the paths in `outputs`. A
picture this run does not write, because the build failed or there is no PNG renderer, is
removed from the default `out/` folder, so a file there is never from an earlier run. In a
folder named with `--out` the command removes nothing: a `<name>.svg` or `<name>.png` it did not
write this run stays as it was, and `outputs` gives `null` for it. The pictures show the drawing
as it plots: a layer that does not plot is left out, as one that is off or frozen is, and
`--draw-no-plot` draws those layers too. `tsdraft dev` takes the same flag. The colors are the
ones a plot gives each pen, so the darkest pens are faint on the dark preview.

`render` and `dev` take a DXF, or a DWG a reader reads, as they take a drawing file: they read it
with geometry, within the limits of [Reading drawing files](#reading-drawing-files), and draw
model space and each layout as [the picture of a read file](reading.md#the-picture-of-a-read-file)
draws them, with the images, the pages of the underlays and the shape files the file names from
its own folder. `--reader <package or folder>` names the reader of a DWG where the project names
none or more than one. Their `read-picture` warnings say what the pictures could not draw as the
file holds it. A build of such a file may take as long as its read, at least 150 s.

`render` and `dev` take an edit file, whose default export is `editDrawing(...)`, as they take a
drawing file: they draw the file it edits as it will plot after the edit, model space and each
layout, as they draw a DXF, from the read the file will hold, `editedRead`'s. The file is read
through [the read cache](#the-read-cache), with the edit's `only`, and drawn at its own pens, with
the xrefs, images and pages found beside it. A file of another format needs its reader, not its
editor. The edit of a model file draws through each sheet its `sheets` names as well, with the
edited read in place of the sheet's xref of the file: each such entry of `outputs.layouts` is named
`<sheet's file name>/<layout>` and gives the sheet's `file`. A second picture of each, the picture of changes, draws every entity the edit does not
reach faint, each it erases dashed in red where it was, and each it moves or stretches dashed in
amber where it was and at full strength where it goes. `render` writes it as `<name>.changes.svg` and `.png`, and
`<name>.layout-<layout>.changes.svg` and `.png` for each of the file's own sheets, in
`outputs.changes`. `lintEdit`'s
diagnostics come first in `diagnostics`, and its errors give exit code 2. A file whose SHA-256 is
not the edit's is drawn as it is, without the edit, with an `edit-hash` error that says so. See
[Editing a firm's drawing](editing.md#the-preview).

With `--pdf`, `render` also plots the sheets of a drawing with layouts: `<name>.layout-<layout>.pdf`,
each sheet alone, in `outputs.layouts[].pdf`, and `<name>.pdf`, the set, with a page for each
layout in order, in `outputs.pdf`. Each is made from the picture of its sheet, as
[Plotting](plotting.md) says, so it is the sheet the PNG shows. A PDF embeds the file the PNG
sets each TrueType font in, cut to the letters it uses. Each sheet gives the face each of its
fonts is set in, in `pdfFonts`: the PostScript name of the file embedded, such as `ArialMT` or
`LiberationSans`, or `Helvetica`, `Times-Roman` or `Courier`, which nothing embeds, for an SHX
font and a TrueType font the machine has no file for. `pdfMissing` has the characters those faces
lack, which it sets as `?`. A sheet that cannot be plotted has `null` there and the reason in `pdfError`,
the set is then not plotted either, and the run goes on with its exit code as it would be. A
build that left out what `lint` refused, which `drawing.omitted` lists, is not plotted. Each
plot runs in a process of its own, one at a time, which ends at two minutes. `--pdf` does not go with `--view`
or `--draw-no-plot`, and without it every PDF is `null`.

`tsdraft dev <file> [--port <n>]` serves a live preview at `http://127.0.0.1:4610`, or the next
free port when that one is taken. It rebuilds when you save the file or any file it imports,
inside the project or not, including one it tried to import before you created it, a workspace
package linked into `node_modules`, and where a symlink it imported through points,
including a package's link in `node_modules`.
Packages installed under `node_modules` are not watched, and neither are files the drawing reads
with `fs`. The page draws linetypes, pen weights and text styles as `toSVG` does, with each text as long as it plots and in its style's font where the browser has it. The browser picks the typeface there, so the height of a text's letters is approximate on the page, and exact in a PNG: see [Fonts in a PNG](#fonts-in-a-png). The page has pan and zoom, layer
toggles and the diagnostics, and marks a layer the drawing has off, frozen or set not to plot, whose
entities are not drawn. Each diagnostic shows the call that drew its entity. Click a diagnostic to find its entity. While a build runs, the status reads
"building N…". When a build fails, the page dims the last good drawing and shows the error. For an agent without a browser it serves:

| Path                                 | What it is                                                                |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `/state.json`                        | The same JSON `render` prints, for the latest finished build              |
| `/state.json?after=<n>`              | The same, once a build newer than `n` has finished and none is due        |
| `/drawing.svg?session=<s>&build=<n>` | The drawing on screen; 409 when build `n` of session `s` is not on screen |
| `/drawing.png?width=<px>`            | The same, as a PNG, rasterized only when asked for                        |
| `/drawing.svg?layout=<name>`         | The sheet of a layout as it plots. The PNG takes `layout` too             |
| `/drawing.pdf`                       | The set: a page for each layout, in order, made when asked for            |
| `/drawing.pdf?layout=<name>`         | The sheet of that layout alone, as a PDF                                  |
| `/drawing.svg?changes=1`             | For an edit file, the picture of changes, drawn when asked for            |
| `/events`                            | Server-Sent Events: `hello`, then `start` and `build` per build           |

Each response has an `x-tsdraft-session` header, and each state or picture an `x-tsdraft-build`
header that gives the build it came from. The page links the PDF of the sheet on screen and of
the set, and `/state.json` gives their URLs in `outputs.pdf` and `outputs.layouts[].pdf`. A PNG is at most
16 million pixels; a wider request is narrowed, and `x-tsdraft-width` gives the width used.

`tsdraft shows <drawing file> [--sheet <layout> | --layout <layout>] [--near <x,y> [--within <d>]]
[--xref <name>=<file>]... [--reader <package>]` reads a DXF, or a file of another format through
its reader, and prints as JSON what it shows, as
[What a sheet shows](reading.md#what-a-sheet-shows) says: with `--sheet`, the layout's paper and
what each viewport that is on shows of model space, each box on the paper; with `--layout`, the
layout's paper alone; with neither, model space. With `--near`, only what comes within `--within`
of the point, nearest first, with its `distance`. An xref is followed only where `--xref` gives
its file, at any depth by the xref's name, and inside an xref only its attachments, as CAD
programs load no overlay of a referenced drawing. At most 64 reads of xrefs are given, counting
each place a file is attached at, and past them the JSON says `xrefsCapped`. The JSON gives the file, its reader, `from`, which is
`memory`, `disk` or `file` for where its read came from, the xrefs followed, `skipped` for an
xref's file that could not be read, the `entities` and `capped`. It exits 0 with an answer, 1 for
a file that could not be read or a layout the file does not have, and 64 for wrong usage.

```sh
tsdraft shows A-102.dwg --sheet A-102 --xref "FLOOR PLAN=../1_Model/FLOOR PLAN.dwg"
tsdraft shows A-102.dwg --sheet A-102 --near 12.5,8 --within 0.25 --xref "FLOOR PLAN=../1_Model/FLOOR PLAN.dwg"
```

## A closer look

A whole sheet in one picture leaves its text too small to read: on an ARCH D sheet 1600 px
wide, a note 3/32 inch high is 4 px high. `--view` draws one rectangle of the drawing at the
full width:

```sh
tsdraft render plan.ts --view 20,30,80,70                  # model space, in drawing units
tsdraft render plan.ts --layout C-101 --view 29,0.5,35.5,3.5   # a sheet, in paper units
```

The four numbers are the rectangle's lower-left corner and its upper-right, `x0,y0,x1,y1`.
Without `--layout` it is a rectangle of model space, and with it one of that layout's sheet.
Write `--view=-5,0,10,10` when the first number is negative. The run writes
`<name>.view.svg` and `<name>.view.png`, with no margin around the rectangle, and its JSON has
them in `outputs.view`, with the `layout` and the `box`. It draws no other picture:
`outputs.svg` and `outputs.png` are `null` and `outputs.layouts` is empty, and in the default
`out/` folder the whole pictures of an earlier run are removed, as a later run without
`--view` removes the view's. The rest of the JSON is as in any run. A viewport is drawn where
the rectangle shows it, and a rectangle that misses every viewport shows the sheet's own
entities alone. A layout the drawing does not have fails the build, with exit code 1.

Give `--view` the `bounds` of a diagnostic, a little larger, to see what the diagnostic is
about, and read a sheet's title block and notes with it. `tsdraft dev` has no such flag: its
page pans and zooms.

## Images

The pictures and the PDF draw each image from its file, which the command reads from the folder
of the drawing file by the image's path, `\` and `/` alike, once a build, up to 1 GB in all. A
file that is missing, or is not a PNG or a JPEG, gives an `image` warning, and the pictures draw
the image's frame with its path inside it, as a CAD program draws an image whose file it cannot
find. A file whose pixels are not the ones the image gives it is an `image` error, and its frame is
drawn the same way. An xref's images are read from the folder of its file, which its path starts
from the drawing file's. `tsdraft dev` builds again when an image's file changes.
[Images](images.md#plotting) has what a picture holds of one.

The pictures and the PDF draw each underlay from a picture of its page, `<file>.page<N>.png`
beside its PDF, which the command reads once a build. A PDF that is missing gives an `underlay`
warning, and a page with no picture one that gives the `pdftocairo` command that draws it; the
pictures then write that the file is missing, as a CAD program does. A `pageSize` that is not the
page's in the PDF, and a picture not of the page's shape, are `underlay` errors. `tsdraft dev`
builds again when a PDF or a picture changes. [Underlays](underlays.md#plotting) has the rest.

## The JSON

`BuildState` in [`cli/src/state.ts`](../cli/src/state.ts) documents each field, and `schema`,
now 3, goes up when one changes its meaning or goes away. A failed build, trimmed:

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

When it builds, `drawing` gives the units, the extents, counts of layers, entities, blocks,
xrefs, layouts, errors and warnings, and each layer. `drawing.standard` gives the `id`,
`version` and `hash` of the standard the file exports, and `checked`, which is true when `lint`
held the drawing to it, or is `null` when the file exports none. `drawing.blocks` gives each block's name, how many entities
it holds, the tags of its attributes and how many inserts place it. `drawing.inserts` gives each
insert in model space: its `entity` index, `block`, `layer`, `id`, `at`, `scale`, `rotation` and
the value it shows for each attribute, and `xref`, which is true for an insert of an xref.
`drawing.dimensions` gives each
dimension in model space: its `entity` index, `id`, `layer`, `kind`, which is `linear`,
`aligned`, `radius`, `diameter`, `jogged-radius`, `angular`, `arc-length` or `ordinate`, `style`,
`measurement`, the length it measures in drawing units or an angular one's angle in degrees, and
`text`, the string the leading CAD app draws for it. The last two are `null` for a dimension whose
style the drawing does not define. A layout's `dimensions` lists those on its sheet in the same way.
`drawing.xrefs` gives each xref's `name`, its `path`, whether it is an `attach`ment or an
overlay, how many `inserts` place it, in model space, in blocks and on layouts, `shown`, `units`
and `xrefs`. The command opens no DWG file. It draws an xref when
the drawing file has a named export `xrefs`, an object that gives a `Drawing` under the xref's
name, such as `export const xrefs = { BASE: base }`. `shown` says that the pictures drew that
drawing. Given as `{ drawing, xrefs }`, such as
`export const xrefs = { MODEL: { drawing: model, xrefs: { SURVEY: survey } } }`, a drawing's own
attachments are drawn too, from the drawings its `xrefs` gives, and so on down, and its
overlays are not, as CAD loads them. An xref's `xrefs` then lists the xrefs of the drawing drawn
for it, each in the same way, and is empty when it is not shown. There `inserts` counts only
what the drawing's model space reaches, directly or through its blocks, since CAD draws nothing
else of a referenced drawing. `lint` warns, with the `xref`
under which it is, of a drawing given that is not drawn: an overlay inside a referenced
drawing, a circular reference, which CAD breaks, or a chain more than `XREF_DEPTH`, 16,
drawings down. The command cannot tell whether it is what the file at `path` holds, so `shown` is
about the pictures and not about what CAD will load. When `xrefs` gives no drawing for an xref
that is the border of a title block of the file's `standard`, and the command checked the
standard and found no error, the pictures draw the title block's `preview` in its place, and `shown` is true. `units` is the units of the drawing drawn,
or `null` when there is none: where they differ from the drawing's own, each insert needs the
scale between the two. The command runs `lint` on each drawing it is given that it draws, at
any depth. One with an error is not drawn, its `shown` is false, and each error is in `diagnostics` with the
`xref` of the drawing it is under and the chain of xrefs in its message, counted in
`counts.errors`. An xref that is not shown is left out of the pictures
and of `drawing.extents`. `drawing.layouts` gives each layout: its `name`, its `paper`, its `paperUnits`, `width` and
`height`, its `plotStyle`, how many `entities` are on its sheet, and each viewport, with its
`id`, its `layer`, whether its `border` plots, its `rectangle` on the sheet, its `ratio`, the
`center` of its view and `shows`, the box of model space it frames. What lies outside `shows`
is cut off, so compare it with `drawing.extents`. A layout's `inserts` lists each insert on
its sheet as `drawing.inserts` lists those of model space, with `entity` as its index among
the sheet's entities, `at` on the sheet in paper units, and the value it shows for each
attribute. The fields of a title block are read there: the insert of the title block, and
under `attributes` the value of each field by its tag. `outputs.layouts` gives a picture of each
sheet as it plots, an SVG and a PNG, under the layout's `name`, with a `pngError` that is
`null` or says why that sheet has no PNG. `render` writes them beside
the others as `<name>.layout-<layout>.svg` and `.png`, with every character of the layout's
name that a file name may not hold as `_`. `outputs.svg` and `outputs.png` are model space,
whether the drawing has a layout or not. A layout with a lint error is drawn as model space
is, unless it cannot be read: see `item` and `drawing.omitted` below. The page of
`tsdraft dev` has a tab for model space and one for each layout, and opens on the first
layout, as CAD does. A diagnostic on a layout names the `layout`, counts `entity` on its sheet
or gives the `viewport`'s index, and gives `bounds` on the sheet, in paper units. A sheet's
picture is in paper units, with every line as wide as its lineweight. A PNG of it keeps those
widths, and widens them all alike only where the default pen would be under a pixel.
A diagnostic about an entity inside a block names the
`block`, counts `entity` in it, and gives `bounds` in the block's coordinates. `diagnostics` holds what `lint` returned, errors first, each with its
`rule`, `severity` and `message`. A layer problem names its `layer`. An entity problem gives the
`entity` index, its `kind`, its `layer`, and `bounds`, its box in drawing units. It also gives
the entity's `id` when it has one, and `call`, the call in the drawing's code that drew the
entity: an absolute path, a line and a column, which is where to fix it. The command turns on
the builder's `recordCalls` for every drawing it runs.

For a file that exports `standard`, what `lint` returned holds the rules of the standard too,
which [Rules](rules.md#a-drawings-standard) lists: an error there gives exit code 2 as any
other. After them comes `standard-unchecked`, a warning of the command's own, when the copy of
tsdraft the drawing imports is from before standards and has no `defineStandard`: the drawing
was not held to the export, and `drawing.standard.checked` is false. It never changes the exit
code.

After what `lint` returned come the warnings of `inspectText`, about text as it plots: a rule
of `text-overlaps-text`, `text-leaves-boundary` or `text-off-paper`, which
[Text](text.md#text-as-it-plots) describes. They never change the exit code, and
`drawing.counts.warnings` counts them. Each has `bounds`, the box of the text as it plots,
turned and justified, or of both texts of an overlap, in the coordinates of its picture: model
space's, or the sheet's when it names a `layout`. `entity` is the index of the entity of that
space that draws the text. For a text inside a block it is the insert, with the tag in
`attribute` when the text is one of the insert's attributes, and `block` is never set, so two
inserts of one block give two warnings that can be told apart. `kind` and `layer` are that
entity's. `other` names, the same way, the other text of an overlap or the closed polyline
the text runs past. A drawing loaded with a copy of tsdraft from before `inspectText` has no
such warnings.

After them, for a file that exports `intent`, come the warnings of `checkIntent`: a rule of
`footprint-in-setback`, `footprint-off-property` or `intent-unchecked`, which
[Checks of intent](intent.md) describes. They never change the exit code either, and
`drawing.counts.warnings` counts them. `entity` is the footprint's index in model space, or
that of the entity an id names, with its `kind`, `layer`, `id` and `call`, `other` is the
property line, and `item` is the path in the intent of what the warning is about, such as
`setbacks[0]`, where the `item` of a lint error is a path in the drawing. A footprint warning
has `bounds` in drawing units, and `footprint-in-setback` has `side`, `required` and
`provided`. A copy of tsdraft that has no `checkIntent`, or whose `checkIntent` throws, gives
one `intent-unchecked` warning that says so.

A problem with the shape of a value, such as an entity of an unknown kind or a field of the
wrong type, gives `item`, the path of the item that holds the value: `entities[3]`,
`blocks[0]`, `blocks[0].attributes[1]`, `layouts[0]`, `layouts[0].viewports[1]`,
`layouts[0].entities[2]`, or a whole list, such as `xrefs`. A list with an empty slot is such
an item, whole. A layout whose paper is none of `PAPERS` is such an item too, and so is a
viewport whose size or ratio gives it no view, since neither can be drawn.

When the drawing cannot be drawn with such an item in it, the command draws the rest.
`drawing.omitted` then lists the `item` of everything the pictures, `drawing.extents` and the
lists of layers, blocks, inserts, dimensions, xrefs and layouts leave out, and `drawing.counts` still
counts the drawing as it is. A layout that cannot be read is left out whole, with its picture
in `outputs.layouts`. A viewport that cannot be read is left out of its layout, which keeps
the rest, and an entity of a sheet is left out as one of model space is, so the others keep
their indexes. A problem of an entity that was left out, by itself or with its block or
its list, has no `kind`, `layer` or `bounds`, since the entity was not drawn; any other entity
problem has all three, with an `item` or without. Without `omitted`, nothing is left out. If the rest cannot be drawn either,
the build fails: `ok` is false, `drawing` is `null`, `diagnostics` holds what `lint` reported,
and the exit code is 2.

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

For an edit file, `edit` gives the `source` it edits, the edit's `name` and `sha256`, `read`, the
SHA-256 of the file as it is, `applied`, false when the two differ, how many entities the
pictures draw `erased` and `moved`, and each of its `statements`: its `kind`, the `call` that made
it, the `handles` it names, and its `box` in model space and on each sheet in `layouts`, where it
was and, for a move, where it goes, which `--view` takes. A change's box is its entity's before
the change. `lintEdit`'s diagnostics have a rule that starts
with `edit-`, the `statement` and the `call` that made it, the `handle`, and `bounds` where the
handle's entity draws. Any other drawing file has no `edit`, and `outputs.changes` is `null`.

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
   one, starting with the errors. For a `text-` warning, run `tsdraft render` with `--view` on
   its `bounds` to see the text.
5. Look at `outputs.png` to check that the drawing looks right, and go back to step 1. Its URL
   names the session and the build, so a picture from another build, or from before a restart,
   is refused rather than mixed up with this state.

`?after=` waits up to the build timeout plus 5 s; `&timeout=<ms>` changes that, up to 120 s. A
plain `/state.json` right after a save may still show the old build, with `pending` set.

## Fonts in a PNG

`toSVG` holds each text to the length it plots at, whatever typeface draws it, and sets it in
a font family for its style's font. A browser that shows the SVG draws it in that font when
the machine has it. The PNG renderer reads no font the system knows by name. It has one
typeface of its own, JetBrains Mono, and it looks in the machine's font folders for a file to
set each TrueType font in:

- the font's own file, such as `arial.ttf`, or
- a font made to its widths, whose letters each take the room of the font's own: Liberation
  Sans for Arial, Liberation Serif for Times New Roman and Liberation Mono for Courier New.

Beside each, it looks for the file of its bold, such as `arialbd.ttf`, the name `FONTS` gives
it, or `LiberationSans-Bold.ttf`, for the bold runs of paragraphs, and a PDF embeds it too.

A file counts only when the family name inside it is the one expected. An SHX font, and a
TrueType font the machine has neither file for, is set in JetBrains Mono.

In every case the text is as long in the PNG as it plots, from the same start to the same end,
with its spaces, and its capitals are as tall as the text's height: the renderer sizes each
text by the cap height of the typeface it draws it in, which the command reads from the font's
file. So what fits in the PNG fits on the plot, and what runs past a line there runs past it
on paper. What differs is the shape of the letters, and with it how far a single letter sits
from the ends of its text, by a fraction of a character.

`outputs.pngFonts` says which typeface the PNG of model space sets each font of its text in,
and each entry of `outputs.layouts`, and `outputs.view`, has a `pngFonts` of its own:

```json
"pngFonts": [
  { "font": "Arial", "face": "Liberation Sans" },
  { "font": "romans.shx", "face": "JetBrains Mono" }
]
```

`font` is a font of the drawing, as a text style names it, or of a drawing given for an xref.
`face` is the family name of the typeface the PNG sets it in, taken from the font files the
renderer is given for that picture. Two SHX fonts that `toSVG` sets in one font family are
both listed when either is drawn. The command looks for the files once, when it starts.

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

## When the renderer stops on a picture

The renderer draws in a process of its own, which the command starts and `tsdraft dev` keeps.
A fault in the renderer ends that process and not the command:

- `tsdraft render` gives the picture it stopped on `"png": null` and a `pngError` that says the
  renderer stopped while it drew this picture. A picture the renderer answers it cannot draw
  gets the same, with that answer. For model space that is `outputs.pngError`, and
  for a layout the `pngError` of its entry in `outputs.layouts`. The SVG of that picture, every
  other picture, the diagnostics and the exit code are as they would have been. It also prints
  the reason to stderr.
- `tsdraft dev` answers `/drawing.png` for that picture with 500 and the reason, and draws the
  next picture in a new process.

When the renderer's process cannot start at all, each picture has a `pngError` that says so,
and the rest is the same.

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

## Writing an edited copy

`tsdraft write <edit file>... [--out <dir>] [--root <dir>] [--reader <package>]` makes the edited
copy of the file each edit file names, runs the checks of every job on it, and writes it only
when they pass. The last check draws each sheet whose picture the job changes as a PNG and a PDF
beside the copies, and lists them in the check's `sheets`. [Editing a firm's drawing](editing.md#tsdraft-write) says how, and gives its
limits. It finds the editor of a file of another format in the package that reads it, by the
rules below, where that package names an editor too.

## Reading drawing files

`tsdraft shows` and `tsdraft write` read drawing files. It reads a DXF with the library's `readDXF`, and a file of
another format, such as a DWG, with a reader: a package that names one in its `package.json`, as
[Reading drawing files](reading.md#readers-of-other-formats) says. The rules below hold for every
command that reads one.

### Which reader

Readers come from one project: the nearest folder, from the folder the command runs in upward,
whose `package.json` lists `tsdraft` in `dependencies` or `devDependencies`, and from which Node
resolves `tsdraft` to the very copy that is running, compared by real path. In a pnpm or npm
workspace that is the workspace's package. A folder that lists tsdraft and resolves another copy,
or none, ends the search with no project. A folder inside a file or folder the command was given
to read is passed over, so a folder of drawings never supplies a reader.

From the project, the command looks at each package in `dependencies` and `devDependencies`, and
keeps those that name a reader for the file's extension with a module inside the package. It
reads no other `package.json`.

- One package that reads an extension is used.
- Two or more are refused, with a message that names them and says to pick one with `--reader`.
- `--reader <package>` names a package resolved from the project, or a path to a package's
  folder, and it is the only reader used. With no project, as in a global install, it takes a
  path.

Each file read gives the reader's package name and version, or tsdraft's for a DXF.

### The limits of a read

Each file is read in a Node process of its own, which gets the file's bytes on its stdin and its
name without folders, never its path, and ends when it has answered. At most two run at once.

| Limit                                         | Default |
| --------------------------------------------- | ------- |
| The file's size, checked before it is read    | 1 GB    |
| The process's heap, as `--max-old-space-size` | 2048 MB |
| The time until it answers                     | 120 s   |
| The size of its answer, as JSON               | 128 MB  |

The process runs under `prlimit --core=1:1 --cpu=<seconds> --` where there is one, so an abort
leaves no core dump, and a process the command has lost ends once it has used its time limit
and 30 seconds more of CPU. Where there is no `prlimit`, as on macOS, nothing but the command
ends a reading process, so one the command has lost while it loops runs until it is ended by
hand. A command ended by SIGINT or SIGTERM ends its reading processes first. The answer comes
back with no prototype on any of its objects, as `readDXF` gives its maps. Its answer is checked as plain data with `checkDrawingRead`, and its `bytes` and `sha256`
must be the file's. A file that breaks a limit, makes the reader throw, ends the process or
gives a malformed answer is skipped with the reason, and the next file is read.

### The read cache

A file is read once for each SHA-256 of its bytes, the reader and its version, tsdraft's version,
and what is read.
The read is kept in memory for as long as the command runs, and on disk in the project's
`node_modules/.cache/tsdraft/reads`, or the user's cache folder where there is no project, so a
second command reads none of it again. A file is watched by its size, its time and its inode,
and hashed again only when one of them changes, or when it was saved within two seconds of being
read, which a clock's tick may hide. A reader, or tsdraft, outside a `node_modules` folder, as in
a checkout, is told apart by its files' sizes and times as well as its version. A kept read is checked as a
reader's answer is, `checkDrawingRead` and the file's size and hash, and one that fails is
removed and the file read again. The folder keeps the 64 reads used last, within 2 GB.

### What the limits do not enforce

The heap's limit holds what JavaScript holds, not what native code allocates. Where Node has its
permission model, the process runs under it, with read access to tsdraft's package and the
reader's alone:

| Node   | The reading process may not                                                                  |
| ------ | -------------------------------------------------------------------------------------------- |
| 22, 24 | write a file, start a process or a worker, load a native addon, or read outside the packages |
| 26     | do any of those, or reach the network                                                        |

On Node 22 and 24 nothing stops a reader from opening a network connection. Node calls its
permission model a seat belt for trusted code, not a boundary against malicious code: a reader is
code you chose to install, as any dependency is, and these limits hold its mistakes. Under the
model a reader can import the files of its own package and `tsdraft`, and nothing else, so a
reader bundles its dependencies.

## Speed

In a checkout of the repository, `pnpm bench` measures the loop: from writing the file
to the benchmark receiving the server's `build` event with the new SVG, not to the page
painting it. It prints where the time of a build went, and the machine's load average.

Each build runs in a process of its own, so that no build can change the next. While it waits
for a save, `tsdraft dev` keeps two such processes ready. When your drawing imports the
tsdraft that the command itself is part of, which is the usual case, the first has loaded that
library and run it once on a small drawing of its own, and once on a small drawing to a standard
of its own, which it made with `defineStandard` from the built-in one. It has read nothing of
your drawing.
When you save, the command checks that every file of the library is on disk as that process
loaded it. If so the process builds, and only your drawing file and what it imports are read
and run. If not, the build runs in the second process, which has started and loaded nothing,
so a build never uses a library that has changed since. A drawing that imports another copy
of tsdraft, such as a second one in its project, always builds in a process that loaded
nothing of it.

The two waiting processes hold about 180 MB between them, as `ps` counts it, for as long as
`tsdraft dev` runs.

How fast a build is depends on how busy the machine is, so `pnpm bench` prints the load
average and the number of cores beside each drawing. The aim for the example sheet,
`examples/site-plan.ts`, is that its two pictures arrive well under 100 ms after the save when
the saves are some time apart, as an agent's are, and under 150 ms when each save follows the
last build at once, on a machine that is not busy: one whose load average is at most half its
cores.

On a machine of 16 cores that was busy, the sheet missed the first half of that aim, taking
85 to 90 ms with the saves apart, and met the second, staying under 150 ms back to back. In
each pair below, the first number is with a waiting process that has loaded the library, and
the second is a build in a process that has loaded nothing, as the first build is, at the same
load:

| Load average | Sheet, saves apart | Sheet, back to back | `examples/lot.ts`, saves apart |
| ------------ | ------------------ | ------------------- | ------------------------------ |
| 13 to 15     | 90 and 181 ms      | 126 and 167 ms      | 38 and 87 ms                   |
| about 9      | 85 and 181 ms      | 104 and 165 ms      | 36 and 83 ms                   |

For 3,000 entities, where drawing takes most of the time, the two are about 165 and 190 ms at
a load of 9. The first build, the first after the library changed, and every build with
another copy of tsdraft are the second number.

`render` builds once, in a new process, and takes about 330 ms from start to exit on
`examples/lot.ts`, PNG included.

The bench's generated drawing has 5,000 entities, a fifth of them texts, so it takes longer than
the 3,000 above. `timings` in the JSON says where a build's time went: `inspect`, the look at the
text as it plots, takes about as long as `lint` does, and `intent`, the check of the file's
export `intent`, is there when the file has one.
