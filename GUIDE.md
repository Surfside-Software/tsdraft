# A guide for agents

This page is for an agent that has not used tsdraft before. It covers the setup, the loop to
work in, what the command prints, and what tsdraft cannot draw yet.

## What tsdraft is for

tsdraft writes 2D CAD drawings from TypeScript. You write a drawing file, a program that calls
a builder, and tsdraft exports the drawing as DXF for a CAD program. The `tsdraft` command
shows you the drawing as a picture and as JSON in a fraction of a second, with no CAD program,
so you can check your work after every edit.

Both are in one npm package, `tsdraft`: the library, which is the builder, `lint`, `toDXF` and
`toSVG`, and the `tsdraft` command.

## Setup

The command needs Node 22.18 or later, because Node runs the drawing file by stripping its
types. It has been run on Linux only.

```sh
npm init -y
npm pkg set type=module
npm i -D tsdraft
```

The project's `package.json` must say `"type": "module"`, or the drawing file must be named
`.mts`. `npm init` writes `"type": "commonjs"`, and Node then refuses the file's `import`.

## A drawing file

A drawing file is a TypeScript module whose default export is a drawing, or a function that
returns one. Save this as `plan.ts`:

```ts
import { createDrawing, DASHED, fromPaper } from "tsdraft";

// The sheet plots at 1" = 10', a ratio of 120, and the drawing is in feet.
const view = { ratio: 120, units: "ft" } as const;
const note = fromPaper(3 / 32, "in", view); // text 3/32" high on paper

const d = createDrawing({ units: "ft", linetypeScale: fromPaper(1 / 2, "in", view) });

d.layer("C-PROP", { color: 7, lineweight: 0.5 }, () => {
  d.rect([0, 0], 100, 140, { id: "lot" });
  d.text([2, -3], "LOT 12", { height: note });
});
d.layer("C-SETB", { color: 8, linetype: DASHED }, () => {
  d.rect([7.5, 25], 85, 95, { id: "setbacks" });
});
d.layer("A-BLDG", { color: 4, lineweight: 0.7 }, () => {
  d.rect([24, 30], 52, 44, { id: "house" });
  d.line([50, 30], [50, 30], { id: "walk" });
});

export default d.build();
```

Coordinates are in drawing units with Y pointing up. Angles are in degrees, counterclockwise
from +X. A layer's color is a number from 1 to 255 in the color index CAD programs share, and a
lineweight is in millimetres. Entities drawn inside a `layer()` callback go on that layer. The
builder draws `line`, `polyline`, `rect`, `circle`, `arc`, `ellipse`, `spline`, `text` and
dimensions. A polyline
takes `bulges` to make a side an arc, `width` or `widths` to draw its sides wide, and `radius`
to round its corners; `cloud` draws a revision cloud around an outline, which crosses nothing
inside it, and `donut` a filled ring or dot. [docs/polylines.md](docs/polylines.md) has them.
`ellipse` draws an ellipse or an arc of one by its center, the end of its major axis and the
ratio of its axes; `spline` draws the cubic CAD programs fit through fit points, for a top of
bank, a tree line or a contour, and `controlSpline` a spline by its control points.
[docs/curves.md](https://github.com/Surfside-Software/tsdraft/blob/main/docs/curves.md) has them.
`point` marks a location, which plots as the figure `createDrawing`'s `pointStyle` gives every
point. [docs/points.md](https://github.com/Surfside-Software/tsdraft/blob/main/docs/points.md) has it.
`image` draws a PNG or a JPEG at a width in drawing units, with the file's `pixels`, which
`rasterSize` reads, and an optional `clip`; the command reads the file from the drawing file's
folder for the pictures, and warns of one that is missing.
[docs/images.md](https://github.com/Surfside-Software/tsdraft/blob/main/docs/images.md) has them.
`underlay` places a page of a PDF, such as an architect's plan, by its path, its `page` and its
`pageSize` in inches, which `pdfPageSize` reads, at one drawing unit to an inch of the page times
`scale`; the command draws it from `<file>.page<N>.png` beside the PDF and gives the `pdftocairo`
command that draws one.
[docs/underlays.md](https://github.com/Surfside-Software/tsdraft/blob/main/docs/underlays.md) has
them.
`hatch` fills one outline, or a list of loops `{ points, bulges? }` where a loop inside another is
a hole, solid in the layer's color, or with `pattern` draws a pattern `patterns()` added from the
firm's pattern file, or lines `spacing` apart, or with `gradient` runs from one color to another; `wipeout` hides what is drawn before it behind a polygon; and
a paragraph's `mask: true` hides what is drawn before it behind its text. Draw a fill before the
lines over it.
[docs/fills.md](https://github.com/Surfside-Software/tsdraft/blob/main/docs/fills.md) has them.

Give an entity an `id` when you will want to find it again: 1 to 64 letters, digits, `.`, `-`
and `_`, each used once in a drawing. A diagnostic about the entity carries the id.

## The loop

1. Write or edit the drawing file.
2. Run `npx tsdraft render plan.ts`. It prints one JSON object and writes the files named in
   its `outputs`, an SVG and a PNG in an `out` folder beside the file. Open a picture by its
   path in `outputs`, never by a name you expect: when a run writes no picture, `outputs` has
   `null` for it. That run also clears the old picture from `out`, but not from a folder you
   named with `--out`.
3. Read the JSON. If `ok` is false, fix `error.file` at `error.line`. If `diagnostics` is not
   empty, fix each one, errors first. A warning whose rule starts with `text-` is about a
   text as it plots: it lies over another text, it runs past the border, cell or room it
   starts in, or it runs off the paper. See [Fitting text](#fitting-text-with-measuretext).
   A `footprint-` warning says a building crosses a setback: see
   [Checking intent](#checking-intent).
4. Look at the PNG at `outputs.png`, and at each sheet's in `outputs.layouts`. The JSON says
   whether the drawing breaks a rule. Only the picture shows whether it is the drawing you
   meant. When `outputs.png` is `null`, `outputs.pngError` says why, and `outputs.svg` is the
   same picture.
5. Look closer. A whole ARCH D sheet at 1600 pixels draws 3/32 inch text 4 pixels high, too
   small to read. `npx tsdraft render plan.ts --view 29,0.5,35.5,3.5 --layout C-101` draws
   that rectangle of the sheet alone, from its lower-left corner to its upper-right in paper
   units, and without `--layout` a rectangle of model space in drawing units. The picture is
   at `outputs.view.png`. Read the title block and the notes this way, and give `--view` the
   `bounds` of each warning, a little larger, to see what it is about.
6. Repeat from step 1.

`render` exits 0 when the drawing built with no lint errors, 2 when `lint` reported errors,
and 1 when the build failed before `lint` could report or a file could not be written. Stdout holds only the JSON. `--out <dir>` changes the folder and
`--width <px>` the PNG's width, which is 1600 by default.

The picture is the drawing as it plots, on a dark background. A layer that is off, frozen or
set not to plot is left out, and `--draw-no-plot` draws the layers that do not plot too.

The PNG renderer, `@resvg/resvg-js`, is an optional dependency that npm installs by default.
Where it is missing, after an install with `--omit=optional` or on a machine it has no build
for, `render` still writes the SVG and exits as above, and the JSON has `"png": null` with the
reason in `pngError`. `npm i -D @resvg/resvg-js` adds it. Each entry of `outputs.layouts` has
a `pngError` of its own: a picture the renderer stops on has no PNG, and its SVG is there.

A text is as long in the pictures as it plots, in every font, and in the PNG its capitals are
as tall. So a text that fits its space in the PNG fits it on the plot, and one that runs past
a line there runs past it on paper. Only the shapes of the letters may differ: the PNG sets an
SHX font, such as the `txt.shx` of the `Standard` style, in a typeface of its own, and
`outputs.pngFonts` names the typeface of each font.

When a person is watching, run `npx tsdraft dev plan.ts` and give them the address it prints,
`http://127.0.0.1:4610` unless that port is taken. The page redraws each time the file, or a
file it imports, is saved. The same server answers you without a browser:
`/state.json?after=<build>&session=<session>` waits for a build newer than the one you last
read and returns the same JSON, and `/drawing.png?width=<px>` is the picture. The command runs
until it is stopped, so start it in the background.

To hand over the sheets, run `npx tsdraft render plan.ts --pdf`: it writes the set as
`plan.pdf`, a page for each layout in order, and each sheet as `plan.layout-<layout>.pdf`, at
the paths in `outputs.pdf` and `outputs.layouts[].pdf`. Each page is the sheet the PNG shows,
with each TrueType font embedded from the file the PNG is set in. `outputs.layouts[].pdfFonts`
names it, and says `Helvetica`, `Times-Roman` or `Courier` where the machine has no file.

### Through MCP

Where the harness speaks MCP, `tsdraft mcp` gives the same loop as two tools, and saves the
tokens a whole JSON costs. `render` answers with a brief, the errors and warnings at the calls
that made them, and the pictures as images, so step 3 and step 4 are one call. `execute` runs a
JavaScript program over a build or a read file and answers with only what it returns, such as
`return (await render("plan.ts")).drawing.inserts.filter((i) => i.block === "DOOR").length`.
[The MCP server](docs/command.md#the-mcp-server) has both.

## What the JSON holds

`render` printed this for the file above, shortened here to what you read first:

```json
{
  "schema": 3,
  "ok": true,
  "drawing": {
    "units": "ft",
    "extents": { "min": [0, -3.3125], "max": [100, 140] },
    "counts": { "layers": 4, "entities": 5, "layouts": 0, "errors": 0, "warnings": 1 }
  },
  "diagnostics": [
    {
      "rule": "zero-length",
      "severity": "warning",
      "message": "line #4: the line has no length",
      "entity": 4,
      "id": "walk",
      "call": { "file": "/work/plan.ts", "line": 18, "column": 5 },
      "kind": "line",
      "layer": "A-BLDG",
      "bounds": { "min": [50, 30], "max": [50, 30] }
    }
  ],
  "error": null,
  "outputs": { "svg": "/work/out/plan.svg", "png": "/work/out/plan.png", "layouts": [] }
}
```

- `ok` says whether the file ran and gave a drawing. Lint errors do not make it false, so read
  `drawing.counts.errors` or the exit code as well.
- `drawing.extents` is the box around everything drawn, in drawing units. Check the drawing's
  size against what you meant.
- `drawing.layers`, `blocks`, `inserts`, `dimensions`, `xrefs` and `layouts` list what the
  drawing holds. An insert has the value of each attribute, and a dimension its `text`. An xref has `shown`: when it is false, the
  pictures do not draw the xref at all. A layout has each viewport with `shows`, the box of
  model space it frames, to compare with `drawing.extents`, and its own `inserts`, which is
  where to read the fields of a title block.
- `outputs.svg` and `outputs.png` are model space. `outputs.layouts` has a picture of each
  sheet as it plots.
- `diagnostics` is what `lint` found, and after it the warnings about text as it plots and
  about [intent](#checking-intent). An
  error stops `toDXF` from writing the file. A warning does not. A `text-` warning has
  `bounds`, the box of the text on its picture, and `other`, the text it lies over or the
  closed polyline it runs past. For a text inside a block, `entity` is the insert, and
  `attribute` the tag when the text is one of its attributes. An error about the shape of a
  value gives `item`, such as `entities[3]`.
  `drawing.omitted`, when it is there, lists what the pictures leave out because the drawing
  could not be drawn with it.
- `error` is why a build failed: its `message`, and the `file`, `line` and `column` of your
  code.

[docs/command.md](https://github.com/Surfside-Software/tsdraft/blob/main/docs/command.md)
describes every field.

To act on a diagnostic, open `call.file` at `call.line`. That is the builder call that drew the
entity, so it is the line to change. `id` is the id you gave the entity, and `entity` is its
index in the drawing. In the output above, line 18 of `plan.ts` draws a line from a point to
the same point: give it a second point, or delete it. When a helper function drew the entity,
`call` is the line inside the helper.

When a builder call breaks a rule, the build fails at that call. `ok` is false, `error` has the
message and the line, and `diagnostics` holds that one problem with its `rule` and `call`.

## Sizing text with `fromPaper`

A drawing is in real units, such as feet, and it plots at a scale. Text that should plot 3/32
inch high at 1" = 10' has to be 0.9375 ft high in the drawing. `fromPaper` does that sum:

```ts
const view = { ratio: 120, units: "ft" } as const; // 1" = 10' is 1:120
const note = fromPaper(3 / 32, "in", view); // 0.9375
```

The first two arguments are a length on paper, in `"in"` or `"mm"`. `ratio` is the scale as a
plain ratio and `units` is the drawing's units. Size every text height, symbol, gap between a
line and its label, and the linetype scale this way, from one `view`, and never as a bare
number of drawing units. Then the annotation keeps its plotted size when the scale changes.

This is for model space. What you draw on a layout is in paper units already: see
[Layouts](#layouts).

## Fitting text with `measureText`

Never guess how long a text is. `measureText` gives the length it plots at, from the widths of
its font's characters:

```ts
import { measureText } from "tsdraft";

measureText({ value: "GENERAL NOTES", height: 0.125 }).length; // 1.583 in txt.shx
measureText({ value: "GENERAL NOTES", height: 0.125, font: "Arial" }).length; // 1.485
```

`font` is the font of the text's style, and `txt.shx`, the font of `Standard`, when left out.
A capital of `txt.shx` takes a whole text height of the line, far more than most screen fonts
do, so a note sized by eye runs long. Pass the style's `widthFactor` too when it has one, and
check that a value fits its cell before you draw it.

A note of more than one line is a paragraph, which wraps at its width and which a drafter edits
as one. Never break a note into texts of one line:

```ts
import { layoutParagraph, list, underline } from "tsdraft";

const notes = list([`${underline("VERIFY")} ALL DIMENSIONS IN THE FIELD.`, "DO NOT SCALE."]);
d.paragraph(notes, {
  at: [1, 20], // the upper left corner of its box
  width: 4,
  height: 0.1,
});
layoutParagraph({ value: notes, height: 0.1, width: 4 }).lines.length; // how many lines it takes
```

A line feed starts a new paragraph. `list` writes numbered or lettered notes in two levels, each
hanging under its mark as CAD programs set a list, and `paragraphFormat` a paragraph's indents,
tab stops, justification and spacing. `columns: { count: 2, height: 6 }` flows the notes into
columns side by side, each `width` wide. `measureParagraph` gives its lines and its box, from the
widths `measureText` uses, and the box's `corners` give its height and its bottom. `inspectText`
checks each line as a text. `underline`, `bold`, `stack`, `superscript` and `subscript` write the
codes for what they name, and `plain(text)` escapes text from elsewhere. The codes `\H`, `\W`,
`\Q`, `\A` and `\C` change the height, width, slant, place and color of the characters after them,
and `lint` refuses a code tsdraft does not lay out, such as `\T`, and names it.
[docs/paragraphs.md](https://github.com/Surfside-Software/tsdraft/blob/main/docs/paragraphs.md)
has the codes.

Space the lines of a column of texts one and a half text heights apart or more. Given `at`, `align`, `valign` and
`rotation` as well, `measureText` returns `corners`, the box the text's capitals fill, which
is the box the `text-` warnings and their `bounds` use. A character outside Latin-1 is measured
as a `?`, and the result then has `approximate: true`.

## Drawing to a standard

A standard is a firm's layers, pens, text roles, scales, dimension styles and title blocks as
data. Extend the built-in one with what your drawing needs, and export it beside the drawing:

```ts
import { BUILT_IN_STANDARD, createDrawing, defineStandard } from "tsdraft";

export const standard = defineStandard({
  id: "my-firm",
  version: "1",
  extends: BUILT_IN_STANDARD,
  layers: { "A-WALL": { color: 2, pen: "bold" } },
});

const d = createDrawing({ units: "ft", standard });
d.layer("A-WALL", () => d.rect([24, 30], 52, 44));
export default d.build();
```

`d.layer(name, draw)` names a layer of the standard, which gives its color, linetype, pen and
plot flag, and an entity's `pen` names one of the standard's pens. A layer, role or scale the
standard lacks is a compile error, and the builder throws the same message, which says how to add
it to `defineStandard`. Add it there; never draw around the standard.

The command holds the drawing to the exported standard with `lint`: its errors are diagnostics
and give exit code 2, and `drawing.standard` names it.
[docs/standard.md](https://github.com/Surfside-Software/tsdraft/blob/main/docs/standard.md) has
the built-in standard and the rest.

## The file to copy

[`examples/site-plan.ts`](https://github.com/Surfside-Software/tsdraft/blob/main/examples/site-plan.ts)
in the tsdraft repository is a whole sheet: a permit-style site plan at 1" = 10' with property
lines, setbacks, a building, dimensions, leaders, labels and a revision cloud in model space,
and on a landscape
ARCH D layout, 36 by 24 inches, its border, a title block whose fields are attributes, notes,
a legend, the view's title and a graphic scale. Start a new drawing from it. It is not in the npm package. Copy it and
change its import string `"../src/index.ts"` to `"tsdraft"`.

Its parameters come first and every position is worked out from them. Its columns are laid
out with `measureText`, and each general note is a paragraph that wraps at the width of the
column of notes. Its symbols are blocks.

It is drawn to a standard of its own, which extends `BUILT_IN_STANDARD` with the layers
`V-TREE` and `C-ANNO-REVS`, as the section above shows, and a leader style. A text names a `role` of the standard,
which gives its text style and the height it plots at. The plan is a view at one of the
standard's scales, `const plan = d.view("plan", { scale: "1in-10ft" })`, and what model space
draws to be read in it names the view: `d.text(at, "LOT 27", { role: "label", view: plan })`,
`d.insert("PROPERTY CORNER", at, { view: plan })` for a symbol drawn in inches,
`d.linearDimension(from, to, line, { view: plan })` in the standard's dimension style, and
`d.leader(text, { view: plan, at, to })` in its leader style. The viewport shows the view, as
`sheet.viewport(corner, width, height, { view: plan, center })`, and `plan.paper(inches)` turns a
gap on paper into drawing units. On the sheet and in a block, a text with a role is at the role's
height and names no view. Under a standard every text names a role: a `height`, a `style` and
`textStyle()` are refused. `sitePlan("1in-20ft")` draws the sheet at 1" = 20'.

Each drawing on a sheet is a view of its own, with a viewport of its own, even two at one scale,
such as a south and an east elevation. A viewport shows everything model space draws inside its
window, so draw each view in a part of model space of its own, far enough from the others that no
viewport takes in another's drawing. The command warns `viewport-shows-other-view` of a note, a
symbol, a dimension or a leader that a viewport of another view shows at the same scale; at
another scale, the checks of scale report it as an error.

Its layout is on a sheet format of the standard, `d.layout("C-101", { sheetFormat: "arch-d" },
(sheet) => …)`, which gives the paper, the title block and the zones the sheet is laid out by:
`sheet.zone("views")` is the box the viewport fills, as `{ left, bottom, right, top, width,
height }`. `sheet.titleBlock({ title: "SITE PLAN" })` places the border and the title block
and fills its fields: the project, the date and who drew and checked it come from
`createDrawing({ standard, fields: { project, date, drawnBy, checkedBy } })`, the number is the
layout's name and the scale is the viewport's.

## Checking intent

Export `intent` beside the drawing, and each build checks that every footprint keeps out of
its setbacks. It names closed polylines of model space by their ids:

```ts
export const intent: Intent = {
  setbacks: [{ property: "lot", footprints: ["house"], distance: [25, 7.5, 20, 7.5] }],
};
```

`distance` is in drawing units: one setback for every side, or one for each side in the order
of the property line's points. For a `rect` drawn from the lot's front left corner, that is the
front, the right side, the rear and the left side. A `footprint-in-setback` warning gives the
`side`, its `required` setback and the distance `provided`. `intent-unchecked` means part of
the intent was not checked, and says why, such as an outline that crosses itself.
[docs/intent.md](https://github.com/Surfside-Software/tsdraft/blob/main/docs/intent.md) has
the rest.

## Dimensions

Define a dimension style, then dimension between two points:

```ts
d.dimensionStyle({
  name: "PLAN",
  textHeight: 3 / 32,
  arrowhead: "architectural-tick",
  arrowSize: 1 / 16,
  extensionOffset: 1 / 16,
  extensionBeyond: 1 / 8,
  textGap: 1 / 16,
  scale: fromPaper(1, "in", view),
  precision: 1,
  suffix: "'",
});
d.linearDimension([24, 30], [76, 30], [0, 20], { style: "PLAN" });
```

- The sizes are the sizes that plot, and `scale` carries the view. On a layout, leave it out.
- The third point is on the dimension line. `along: "y"` measures up.
  `alignedDimension(from, to, offset, options)` measures along the two points.
- CAD writes the measurement. `text: "<> TYP"` adds to it.
- `units: "architectural"` writes feet and inches, as `4'-1 7/16"`, from a length in inches
  times `measurementScale`, so give a drawing in feet `measurementScale: 12`. `precision` is
  then the least fraction: 4 for 1/16". `fraction: "stacked"` stacks the fraction, at
  `fractionScale` of the text's height. Never write feet and inches as a dimension's `text`.
- `textBelow: "WINDOW HEAD HT."` writes words under the line. `textPlacement: "centered"` puts
  the text in a break of the line, `textFit: "leader"` moves a text with no room out on a
  leader, `arrowhead: "oblique"` draws a thin tick, and `dimensionLineweight` and
  `extensionLineweight` set the pens.
- `radiusDimension(center, point, options)`, `diameterDimension(center, point, options)` and
  `joggedRadiusDimension(center, point, start, jog, options)` dimension circles and arcs; CAD
  writes the R and the diameter sign. `textFromCenter` places the text along the line, and a
  style's `radialText: "horizontal"` levels it.
- `angularDimension(vertex, from, to, at, options)` dimensions the angle at `vertex` between the
  lines to `from` and `to`, its arc through `at`, which picks the angle. A style's `angleUnits`,
  `anglePrecision` and `suppressAngleZeros` write it, as `37°15'30"` in
  `"degrees-minutes-seconds"`.
- `arcLengthDimension(center, radius, startAngle, endAngle, at, options)` dimensions the length of
  an arc, as `arc` takes it, with its own arc through `at`; a style's `arcSymbol` puts the arc
  symbol `"before"` the text, `"above"` it, or `"none"`.
- `ordinateDimension(feature, leaderEnd, { axis, origin })` gives the X (`axis: "x"`) or the Y of
  `feature` from `origin`, `[0, 0]` unless given, on a leader to `leaderEnd`, which jogs where the
  end is off the feature's line.
- Never draw a dimension from lines and text.
  [docs/dimensions.md](https://github.com/Surfside-Software/tsdraft/blob/main/docs/dimensions.md)
  has the rest.

## Leaders

Define a leader style, then point a note at what it names:

```ts
d.leaderStyle({
  name: "NOTE",
  textStyle: "NOTES",
  textHeight: 3 / 32,
  arrowSize: 1 / 8,
  landing: 1 / 8,
  gap: 1 / 16,
  scale: fromPaper(1, "in", view),
});
d.leader(["EXISTING TREE", "TO REMAIN"], { style: "NOTE", at: [62, 38], to: [52, 26] });
```

- The sizes are the sizes that plot, and `scale` carries the view, as for a dimension style.
- `at` is where the shafts meet. `to` is a point, or a list with a shaft for each item: a point,
  or a list of points from the tip through each bend. The note goes on the side away from the
  first shaft unless `side` says otherwise.
- A string is a one-line note, and an array its paragraphs from the top. `width` wraps them.
- `arrowhead` is `"closed-filled"`, `"open"`, `"dot"` or `"none"`, and `attachment` is where the
  landing meets the note, one of `LEADER_ATTACHMENTS`, such as `"first-line"` or
  `"underline-last"`. A style with `direction: "vertical"` puts the note above or below its point.
- `frame: true` draws a frame around the note, and `mask: true` hides what is behind it.
- `shaft: "curved"` draws each shaft as a curve, `toFarSide` adds shafts from the note's other
  side, and `d.leader({ block: "TAG", attributes: { NUM: "3" } }, options)` points a block, such
  as a keynote bubble, at what it names.
- Never draw a leader from lines and text.
  [docs/leaders.md](https://github.com/Surfside-Software/tsdraft/blob/main/docs/leaders.md)
  has the rest.

## Tables

Define a table style, then draw a schedule as one table:

```ts
d.tableStyle({
  name: "SCHEDULE",
  textStyle: "NOTES",
  textHeight: 0.1,
  title: { textHeight: 0.15 },
});
d.table({
  style: "SCHEDULE",
  at: [1, 22],
  columns: [0.6, 0.8, 0.8, 2.4],
  title: "DOOR SCHEDULE",
  header: ["MARK", { text: "SIZE", columnSpan: 2 }, null, "NOTES"],
  rows: [["D1", "3'-0\"", "7'-0\"", "SOLID CORE"]],
});
```

- Each row holds a cell for each column. A cell is a string, or an object with `text`, or with a
  `block` in place of a text, and its own `columnSpan`, `rowSpan`, `align`, `valign`,
  `textHeight`, `color` and `fill`. A cell another spans is `null`.
- Rows grow to fit their text, which wraps at the column's width; `rowHeights` sets the least
  height of each data row. `measureTable` gives the size a table takes, for what goes below it.
- A `fill` makes a cell a color swatch, and a `block` a symbol in a legend.
- Never draw a schedule from lines and text.
  [docs/tables.md](https://github.com/Surfside-Software/tsdraft/blob/main/docs/tables.md) has
  the rest.

## Blocks

Draw a symbol that repeats once, as a block, and place it with inserts:

```ts
d.block("TREE", {}, () => {
  d.circle([0, 0], 1);
  d.attribute("TAG", [0, 1.2], { value: "T-0", height: 0.3, align: "center" });
});
d.layer("V-TREE", { color: 3 }, () => {
  d.insert("TREE", [15, 112], { scale: 5, attributes: { TAG: "T-1" } });
});
```

- A block's coordinates are its own. `{ base: [x, y] }` names the point an insert puts at its
  `at`, `[0, 0]` unless given.
- Draw a block's entities on layer `0`, which is where they go unless a `layer()` call inside
  the block says otherwise. They then draw as the layer of each insert does.
- `scale` is a number, or `[x, y]`. A negative scale mirrors. `rotation` is in degrees.
- An insert on a layer that is frozen or does not plot draws nothing of its block.
- An attribute is a text each insert sets by its tag. A tag is in capitals. An insert that
  sets none shows the default.
- A block is defined before it is inserted, and once.
- An insert cannot have a linetype, a lineweight or a color of its own. It draws as its layer
  does, and so does what its block holds on layer `0`.

The example sheet draws its trees, property corners, north arrow and view title this way.

## Layouts

A layout is a sheet of paper: CAD shows it as a tab and plots it as one page. A drawing has
two spaces, and each thing goes in one of them:

- **Model space** holds what is real, at its real size: the site, the building, and the
  annotation that is read in the plan, such as dimensions and labels. Size that annotation
  with `fromPaper` for the ratio of the viewport that shows it.
- **The layout** holds what belongs to the paper, in inches: the border, the title block, the
  notes, the legend, each view's title, the north arrow and the graphic scale. A text there
  has the height it plots at.

A viewport on the layout shows model space at a scale. Never draw the sheet in model space,
scaled up around the plan: a drafter who opens the file finds the notes many times their
size, and no sheet to plot.

```ts
d.layer("G-ANNO-NPLT", { color: 8, plot: false });
d.layout("C-101", { paper: "ARCH D" }, (sheet) => {
  d.rect([0.5, 0.5], sheet.width - 1, sheet.height - 1);
  d.text([1, 1], "SITE PLAN", { height: 0.25 });
  d.layer("G-ANNO-NPLT", {}, () =>
    sheet.viewport([1, 2], 26, 21, { center: [50, 70], ratio: 120, id: "plan" }),
  );
});
```

- Inside `layout`, every length is on the paper, in the paper's units: inches for every paper
  tsdraft has. A text 1/8 inch high has `height: 0.125`. `sheet.width` and `sheet.height` are
  the paper's size, and its lower-left corner is `[0, 0]`.
- The papers are `ARCH A` to `ARCH E` and `ANSI A` to `ANSI D`, each landscape and full
  bleed. `ARCH D` is 36 by 24, and `ARCH E` 48 by 36.
- `sheet.viewport(corner, width, height, { center, ratio })` shows model space in a rectangle
  on the paper. `center` is the model point at its middle. `ratio` is the one you give
  `fromPaper`: 120 is 1" = 10'. `frozenLayers` names layers that show nothing in that viewport
  alone, such as the annotation of another scale, and `twist` turns its view in degrees
  counterclockwise.
- Put a viewport on a layer that does not plot, unless you want its border on the sheet. The
  view plots either way.
- In a drawing with a layout, `linetypeScale` is a length of paper: dashes plot as long as the
  pattern times it, in every viewport. The picture of model space draws the same dashes that
  many drawing units long, often too short to see, so judge linetypes on the sheet's picture.
- Letter a pipe with its linetype, not with texts beside it: `parseLinetypes(text)` reads the
  firm's linetype file, a linetype's `marks` draw its letters at each repeat of its pattern, and a
  polyline drawn with `linetypeGeneration: true` runs the pattern on past its vertices, so short
  runs between bends still get their letters. The letters' text style must be one of the drawing's.
- A fence's circles or batt insulation's loops are shapes of the firm's shape file. Copy the file
  beside the drawing: the command reads it there, and `toSVG`, `toPDF` and `lint` take its bytes
  as `shx`. Without it the plot leaves a gap where each shape goes, and `lint` warns
  `linetype-shape`.
- The sheet plots in black with `monochrome.ctb`. Pass `plotStyle: "acad.ctb"` to plot each
  layer in its color, or `"Grayscale.ctb"` in grays. `PLOT_STYLE_TABLES` lists them.
- Define blocks outside `layout`, and insert them inside it. An `id` is unique across model
  space, blocks and every layout.
- A title block is a block with an attribute for each field, and a firm's own border is an
  xref on the layout:
  [docs/title-blocks.md](https://github.com/Surfside-Software/tsdraft/blob/main/docs/title-blocks.md).
  Keep a border inside the paper: on its left, bottom or right edge the leading CAD app plots a line
  with half its width off the page, and on its top edge not at all.

Look at the sheet's picture, in `outputs.layouts`, and not only at model space, and read its
title block and notes with `--view` and `--layout`. Read
`drawing.layouts` to check that each viewport `shows` the part of the model you meant.
`lint` warns of a viewport that reaches past the paper and of one that shows nothing.
[docs/layouts.md](https://github.com/Surfside-Software/tsdraft/blob/main/docs/layouts.md) has
the rest.

## Xrefs

Reference another drawing's DWG file and place it as you place a block. CAD loads the file
each time it opens the drawing:

```ts
d.xref("BASE", "base.dwg");
d.layer("X-BASE", { color: 8 }, () => d.insert("BASE", [0, 0]));
```

- The path leads from the folder the drawing's file is written to: `"base.dwg"`,
  `"../civil/base.dwg"`. An absolute path, an empty one, a `.dxf`, a path that ends in a dot,
  and a path with any of `* ? < > | : "` are errors.
- The file must be a DWG. tsdraft cannot check that it is there. When it is not, CAD opens
  the drawing and draws the path as a small text at each insert, unless a file of the same
  name is in the drawing's own folder: it loads that one, and says nothing of the change.
- CAD draws the insert at the scale you give, whatever units the two drawings are in. A base
  in feet under a drawing in inches needs `{ scale: 12 }`.
- Layer `0` of the referenced file draws as the insert's layer does, and its other layers as
  themselves.
- Place every xref at least once. `lint` warns of one that no insert places, which CAD drops.
- An xref is an overlay unless you write `d.xref("BASE", "base.dwg", { attach: true })`. A
  drawing that references yours draws your attachments too, and never your overlays.

The command opens no DWG, so the pictures leave an xref out unless the drawing file gives the
drawing it stands for. When that drawing is a tsdraft file too, import it and export it under
the xref's name:

```ts
import base from "./base.ts";

export const xrefs = { BASE: base };
export default d.build();
```

The command checks each drawing you give as it checks yours. One with a `lint` error is not
drawn: `shown` is false, and each error is a diagnostic that names the `xref`.

To draw what a referenced drawing attaches, give it as `{ drawing, xrefs }`, with the drawings
of its own xrefs. Its attachments are drawn and its overlays are not, as CAD draws them, and
`drawing.xrefs[].xrefs` lists them with their own `shown`:

```ts
export const xrefs = { MODEL: { drawing: model, xrefs: { SURVEY: survey } } };
```

Read `drawing.xrefs` in the JSON before you trust a picture of a drawing with xrefs. A picture
with `shown: true` shows the drawing you exported, which is only as current as the DWG file CAD
will load is: write that file again from the same drawing when it changes.
[docs/xrefs.md](https://github.com/Surfside-Software/tsdraft/blob/main/docs/xrefs.md) has the
rest.

## Rules as compile errors

tsdraft holds a drawing to the rules the leading CAD app enforces. That app discards a whole file
over one bad layer name. A value written as a literal is checked by the TypeScript compiler, and the
error message says what is wrong:

```ts
d.layer("A/WALL", { color: 4 });
// error TS2345: Argument of type '"A/WALL"' is not assignable to parameter of type
// '"Layer names cannot contain < > / \\ \" : ; ? * | = ` ^ , or line breaks"'.
```

`tsdraft render` does not run the compiler. Node strips the types and runs the file, the
builder throws the same message at the same call, and the JSON reports it. To see compile
errors before running, install `typescript` and `@types/node`, add this `tsconfig.json`, and
run `npx tsc`:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "types": ["node"]
  },
  "include": ["*.ts"]
}
```

Use only TypeScript that can be erased: no enums, namespaces or parameter properties. Import
your own files with their `.ts` extension. The rules are listed in
[docs/rules.md](https://github.com/Surfside-Software/tsdraft/blob/main/docs/rules.md).

A point is a pair, `readonly [x, y]`. Written straight into a call, `[0, 0]` is one, but held in
a variable first it becomes `number[]`, which the compiler refuses as a point. Hold the options
with `satisfies` and the type they go to, or a lone point with `as const`, rather than casting:

```ts
const schedule = { style: "SCHEDULE", at: [1, 20], columns: [2, 4], rows } satisfies TableOptions;
d.table(schedule);
const center = [10, 5] as const;
d.circle(center, 2);
```

## Writing the DXF

The drawing file only exports the drawing. Write the DXF from a second file, and run it with
`node write.ts`:

```ts
import { writeFileSync } from "node:fs";
import { toDXF } from "tsdraft";
import drawing from "./plan.ts";

writeFileSync("plan.dxf", toDXF(drawing));
```

`toDXF` throws a `DrawingError` that lists the problems when the drawing has lint errors.

## What a firm's sheet shows

To find what to change in a firm's sheet, ask before you look through its files by hand.
`tsdraft shows` reads the sheet, and each xref you give it, and prints what the sheet shows: its
paper, and what each viewport that is on shows of the model, with the layers the sheet freezes,
turns off or does not plot left out, and the viewport's and the xref's clips applied. Each entity
comes with its handle, the inserts it was reached through, its layer as the sheet names it, its
box on the paper and its text.

```sh
tsdraft shows A-102.dwg --sheet A-102 --xref "FLOOR PLAN=../1_Model/FLOOR PLAN.dwg"
tsdraft shows A-102.dwg --sheet A-102 --near 12.5,8 --within 0.25 --xref "FLOOR PLAN=../1_Model/FLOOR PLAN.dwg"
```

A file is read once for each hash of its bytes, and the read is kept, so the second question is
fast. In code, `sheetShows`, `nearPoint` and `xrefAreas` answer the same from a read, as
[docs/reading.md](docs/reading.md#what-a-sheet-shows) says. A DWG needs a reader package
installed beside tsdraft.

## What tsdraft cannot draw yet

- A block read from another file. A block is drawn in the drawing that inserts it. An xref
  references a whole DWG file, as an overlay, and the pictures draw it only from a drawing you
  give.
- Attributes of more than one line, and attributes that are hidden or constant.
- A viewport that is turned, that is not a rectangle, or that freezes layers of its own. A
  viewport is a locked rectangle that shows every layer at one scale.
- A paper outside the list in the section on layouts, a paper in portrait, and a page setup
  for another plotter.
- The spacing of characters inside a paragraph, `\T`, and an overline, `\O`.
- A color of a color book. A color of an entity is an index or a true color: see
  [docs/colors.md](docs/colors.md), and an entity's transparency [docs/transparency.md](docs/transparency.md).
- DWG files. tsdraft writes DXF.
- An existing drawing as a background to draw a new drawing on. `readDXF` reads a DXF's tables,
  blocks, layouts and a census of what it draws, and with `geometry` what each space draws, as
  [docs/reading.md](docs/reading.md) says, but a new drawing takes nothing from a read, and
  tsdraft does not read DWG. To change a firm's DXF, write an edit file instead:
  `npx tsdraft write rev-1.edit.ts` writes an edited copy once its checks pass, and never writes
  over the firm's file, as [docs/editing.md](docs/editing.md) says.

When a drawing needs one of these, say so. Do not imitate it with something that will mislead
whoever opens the file.
