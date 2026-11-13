# Layouts

A layout is a sheet: a piece of paper of a named size, with what is drawn on it and the
viewports that show the model on it at a scale. AutoCAD shows each layout as a tab beside the
model tab, and plots it as one page. Layouts are written to R2018 drawings only.

```ts
import { createDrawing, toDXF, toSVG } from "tsdraft";

const d = createDrawing({ units: "ft" });
d.layer("C-PROP", { color: 2, lineweight: 0.5 }, () => d.rect([0, 0], 100, 140));
d.layer("G-ANNO-NPLT", { color: 8, plot: false });

d.layout("C-101", { paper: "ARCH D" }, (sheet) => {
  // On the sheet, lengths are inches of paper from its lower-left corner.
  d.rect([0.5, 0.5], sheet.width - 1, sheet.height - 1, { lineweight: 0.7 });
  d.text([1, 1], "SITE PLAN", { height: 0.25 });
  // The model at 1" = 10', in a viewport whose border does not plot.
  d.layer("G-ANNO-NPLT", {}, () =>
    sheet.viewport([1, 2], 26, 21, { center: [50, 70], ratio: 120, id: "plan" }),
  );
});

const drawing = d.build();
toDXF(drawing); // opens on the sheet, ready to plot
toSVG(drawing, { layout: "C-101" }); // the sheet as it plots
```

## A layout

`d.layout(name, { paper, plotStyle }, draw)` adds a sheet. Everything drawn inside `draw` goes
on the sheet and not in model space. The current layer starts as `"0"`, and `d.layer(...)`
puts entities on a layer as it does anywhere.

- A drawing has any number of layouts. Their tabs are in the order they were added, and
  AutoCAD opens the drawing on the first.
- A layout is added once, and not inside a block or another layout. A block is defined
  outside `draw`, and inserted inside it.
- When `draw` throws, the layout is not added, and its name, its ids and what it drew are
  free again. A layer, a linetype, a text style or an xref that `draw` defined stays, as it
  belongs to the drawing.
- `draw` is given the sheet: `sheet.name`, `sheet.paper`, `sheet.units`, `sheet.width` and
  `sheet.height`, so that what is drawn can be placed from the paper's size.

### Paper

`paper` is one of `PAPERS`. Each is a size that AutoCAD's `DWG To PDF.pc3` offers as full
bleed, with no margin the plotter keeps clear, and a layout of each is landscape, with the
longer side across.

| Paper    | Inches    |
| -------- | --------- |
| `ARCH A` | 12 by 9   |
| `ARCH B` | 18 by 12  |
| `ARCH C` | 24 by 18  |
| `ARCH D` | 36 by 24  |
| `ARCH E` | 48 by 36  |
| `ANSI A` | 11 by 8.5 |
| `ANSI B` | 17 by 11  |
| `ANSI C` | 22 by 17  |
| `ANSI D` | 34 by 22  |

The plotter holds `ARCH E` upright, as `ARCH_full_bleed_E_(36.00_x_48.00_Inches)`, 36 wide
and 48 tall. Its page setup stores that size and turns the plot a quarter turn onto it, as
AutoCAD's own landscape page setup on that paper does, and the PDF shows the page landscape,
48 by 36, with the drawing upright. `PaperInfo.medium` holds the size as the plotter holds it
and the turn.

The paper's units are the units of the sheet: on these, an inch. The sheet's lower-left corner
is `[0, 0]`. Sizes drawn on a sheet are the sizes they plot at, so a text 1/8 inch high has a
height of `0.125`, whatever the drawing's own units are.

The list is closed because a page setup names its paper by the name the plotter gives it,
such as `ARCH_full_bleed_D_(36.00_x_24.00_Inches)`. AutoCAD plots a layout whose paper the
plotter does not know by name on a paper of the same size when it has one, and plots nothing
otherwise.

### The page setup

Every layout has the same page setup, apart from its paper and its plot style table:

| Setting          | Value                                        |
| ---------------- | -------------------------------------------- |
| Plotter          | `DWG To PDF.pc3`                             |
| What to plot     | The layout                                   |
| Scale            | 1:1                                          |
| Plot style table | One of `PLOT_STYLE_TABLES`                   |
| Lineweights      | Plotted, each line as wide as its lineweight |
| Orientation      | Landscape                                    |

`plotStyle` is one of `PLOT_STYLE_TABLES`, the color-dependent tables AutoCAD installs. Each
plots a line as wide as its lineweight, apart from `DWF Virtual Pens.ctb`:

| Table                  | Colors                                                           |
| ---------------------- | ---------------------------------------------------------------- |
| `monochrome.ctb`       | Every color in black. The default                                |
| `acad.ctb`             | Each color in its own, and 7 in black                            |
| `Grayscale.ctb`        | Each color in a gray of its own, and 7 in black                  |
| `DWF Virtual Pens.ctb` | Each color in the color of its pen, and every line 0.254 mm wide |

A pen of `DWF Virtual Pens.ctb` has a color of its own, which is near its index's but not
always the same: 9 plots as `#c0c0c0`, and 12 as `#a50000`. The table also gives every pen one
lineweight, so a line plots 0.254 mm wide whatever its own lineweight, and so does a viewport's
border. `toSVG` draws a sheet in the colors and widths its table plots. AutoCAD plots a layout
whose plot style table it does not have with no table, each pen in its own color.

### Names

A layout's name is on its tab. tsdraft holds a name to these rules, and each says what
AutoCAD does with a name that breaks it:

- It is not empty, and has at most 255 characters. AutoCAD's `LAYOUT` command refuses a
  longer name, and its `-PLOT` takes an empty answer for the current layout, so it cannot name
  a layout that has no name.
- It holds none of `< > / \ " : ; ? * | , =` and the backtick, and no control character.
  AutoCAD opens a file with such a name without a word, and its own command refuses to give a
  layout that name.
- It does not start or end with a space. AutoCAD's `-PLOT` command finds no layout by such a
  name.
- It is not `Model`, in any case of its letters. That name is the model tab's. AutoCAD
  discards a drawing whose layout is named `MODEL`, takes a layout named `model` for the model
  tab's own and loses its sheet, and never finishes opening a drawing with a second layout
  named `Model`.
- No two layouts have names that differ only in the case of their letters: `Sheet` and
  `SHEET`, `É1` and `é1`. AutoCAD takes the two for one layout, keeps one, and its `AUDIT`
  reports the other as missing from the dictionary of layouts. It folds the letters of a table
  of its own, which is not the one it folds layer names by: it has Ÿ and leaves out letters
  added to Unicode since about 2008, so `Ꭰ1` and `ꭰ1` are two layouts. It keeps `straße` and
  `STRASSE` apart, and a composed é and a decomposed one.

## A viewport

`sheet.viewport(corner, width, height, { center, ratio, id })` adds a viewport: a rectangle on
the paper, from its lower-left `corner`, that shows model space.

- `center` is the point of model space at the middle of the rectangle, in drawing units.
- `ratio` is how many times larger the model is than its plot, as [`fromPaper`](../README.md)
  takes it: 120 for 1" = 10', 96 for 1/8" = 1'-0", 50 for 1:50. It is a ratio of lengths, so
  it means the same in every pair of units: at 50 an inch of paper shows 50 inches of the
  model, which is 1270 in a drawing in millimetres.
- `id` names the viewport as an entity's `id` names an entity. No entity and no other viewport
  of the drawing may have it.
- The viewport is locked against zooming, as AutoCAD's `MVIEW` leaves one that it locks.

A file holds no scale for a viewport. It holds the rectangle's height and the height of model
space the viewport shows, and AutoCAD takes the first over the second for the scale. tsdraft
works that height out from the ratio and both units. `viewportView(viewport, paperUnits,
units)` gives it, with the box of model space the viewport shows.

### The border

A viewport is on the current layer, and that layer decides its border alone:

| The viewport's layer | The border  | The view |
| -------------------- | ----------- | -------- |
| On, thawed, plots    | Plotted     | Plotted  |
| Off                  | Not plotted | Plotted  |
| Frozen               | Not plotted | Plotted  |
| Set not to plot      | Not plotted | Plotted  |

AutoCAD plots a border as its thinnest line, whatever lineweight the layer has. Offices keep
viewports on a layer that does not plot. tsdraft has no such layer of its own: put the
viewport on one, as the example above does.

### Linetypes on a sheet

AutoCAD sizes dashes on the paper in every viewport: a dash is as long on the sheet as its
pattern times the drawing's `linetypeScale`, whatever the viewport's scale. `DASHED` at a
linetype scale of 0.5 plots a 1/4 inch dash at 1" = 10' and at 1" = 20' alike. So in a drawing
that has a layout, `linetypeScale` is a length of paper.

On the model tab the same dashes are that many drawing units long: a quarter of a foot across
a plan 100 feet wide, which reads as a solid line. The picture of model space, `toSVG` with no
`layout`, shows them that way too. Judge linetypes on the picture of the layout.

## What is drawn on a sheet

Lines, circles, arcs, polylines, texts and inserts of blocks and of xrefs are drawn on a sheet
as they are in model space, with the same options and the same rules.

- An insert on a sheet carries its attributes, so a title block is a block with attribute
  definitions, inserted on the sheet. [Title blocks](title-blocks.md) has one, and a firm's
  own border placed under a sheet as an xref.
- A block is defined once and inserted wherever it is needed: a symbol of the plan is inserted
  in model space at the plan's scale, and on the sheet, in its legend, at the size it plots.
- What belongs to the paper is drawn on the sheet: the border, the title block, notes,
  legends, each view's title and its graphic scale. What is read in the plan, such as a
  dimension or a label, is drawn in model space and sized with `fromPaper` for the viewport's
  ratio.
- AutoCAD plots a layout as far as its paper goes. It plots a line that lies on the left, the
  bottom or the right edge of the paper with half its width off the page, and no line that
  lies on the top edge. Keep a border inside the paper.

An `id` is unique in the whole drawing: model space, every block and every layout share one
set of ids.

## The preview

`toSVG(drawing, { layout: name })` draws a sheet as it plots:

- The picture is the paper, in paper units, as a white sheet.
- Each viewport is a group with its index in `data-viewport`. It holds model space at the
  viewport's scale, clipped to the part of its rectangle that can be seen: the part on the
  paper and in the picture. Its first element is that part as a hidden rectangle, which draws
  nothing. A viewport that shows nothing there, or has no such part, is an empty group with
  no clip.
- A viewport `lint` reports an error for is drawn as its border alone.
- Every line is as wide as its lineweight on the paper, inside a viewport too, and dashes are
  as long as they plot. Under `DWF Virtual Pens.ctb` every line is 0.254 mm wide.
- Colors are the ones the plot style table plots: black for `monochrome.ctb`.
- A viewport's border is drawn, as the thinnest line or 0.254 mm wide under
  `DWF Virtual Pens.ctb`, when its layer is on, thawed and set to plot. With `drawNoPlot` it
  is drawn on a layer that does not plot too.

Without `layout`, `toSVG` draws model space as it always has.

## What lint reports

Beside the rules above, `lint` warns of what it can see of a view:

- A viewport that reaches past the paper. AutoCAD plots a layout as far as its paper goes.
- A viewport that shows none of the drawing: nothing in model space lies in the box it shows.

A viewport whose ratio is 0 or less, or whose size is, is an error.

## Handles

A layout's own objects take their handles from its name, with A to Z in lower case, as a
block's do: the layout, the record of its block, the two objects that open and close that
block in a DXF, and the viewport AutoCAD keeps for the sheet as a whole. `layoutHandles(name)`
gives them. A viewport or an entity of a sheet that has an `id` takes `idHandle(id)`. So a
layout keeps its handles when the drawing around it changes.

## What a file holds

For a drawing with a layout, tsdraft writes the dictionary of layouts, a layout for the model
tab, and for each layout its page setup, a block for its sheet and, first in that block, the
viewport AutoCAD keeps for the sheet as a whole. AutoCAD discards a drawing whose layouts lack
the model tab's, and one whose layout has a viewport with no such first viewport before it.
`$TILEMODE` is 0, which opens the drawing on its first layout.

A drawing with no layout is written as it was before layouts: AutoCAD gives it the two empty
layouts it gives any drawing.
