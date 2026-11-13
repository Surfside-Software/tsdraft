# Title blocks

A title block is the part of a sheet that says what the sheet is: its number and title, the
project, the date, the scale, who drew and checked it, with room for revisions and a seal. In
a drawing it is a [block](blocks.md) whose fields are attributes, inserted on a
[layout](layouts.md). In CAD each field stays an attribute, whose value AutoCAD's `-ATTEDIT`
command changes.

There are two ways to give a sheet one:

- Draw the border and the title block in code, as one block with an attribute for each field.
- Put a firm's own border under the sheet as an [xref](xrefs.md), and write the sheet's fields
  over it as a block of attributes.

Both are written to R2018 drawings only.

## A title block drawn in code

The block is drawn in inches, in the sheet's own coordinates, so it is inserted on the layout
at `[0, 0]`. Each field is an attribute definition. The insert gives each its value.

```ts
import { createDrawing, toDXF, toSVG } from "tsdraft";

const d = createDrawing({ units: "ft" });
d.textStyle({ name: "TITLE", font: "Arial" });
d.layer("G-ANNO-TTLB", { color: 7, lineweight: 0.35 });
d.layer("G-ANNO-NPLT", { color: 8, plot: false });
d.layer("C-PROP", { color: 2, lineweight: 0.5 }, () => d.rect([0, 0], 100, 140));

// An ARCH D sheet is 36 by 24 inches. The border is half an inch inside the paper.
d.block("TITLE BLOCK", {}, () => {
  d.rect([0.5, 0.5], 35, 23, { lineweight: 0.7 });
  d.rect([29.5, 0.5], 6, 2, { lineweight: 0.7 });
  d.line([29.5, 1.5], [35.5, 1.5]);
  d.text([29.6, 2.3], "SHEET TITLE", { height: 1 / 16, style: "TITLE" });
  d.attribute("TITLE", [29.6, 1.7], {
    value: "-",
    prompt: "Sheet title",
    height: 3 / 16,
    style: "TITLE",
  });
  d.text([29.6, 1.3], "SHEET", { height: 1 / 16, style: "TITLE" });
  d.attribute("SHEET", [35.3, 0.7], {
    value: "-",
    prompt: "Sheet number",
    height: 3 / 8,
    style: "TITLE",
    align: "right",
  });
});

d.layout("C-101", { paper: "ARCH D" }, (sheet) => {
  d.layer("G-ANNO-TTLB", {}, () =>
    d.insert("TITLE BLOCK", [0, 0], {
      id: "title-block",
      attributes: { TITLE: "SITE PLAN", SHEET: sheet.name },
    }),
  );
  d.layer("G-ANNO-NPLT", {}, () =>
    sheet.viewport([1, 3], 34, 20, { center: [50, 70], ratio: 120, id: "plan" }),
  );
});

const drawing = d.build();
toDXF(drawing);
toSVG(drawing, { layout: "C-101" }); // the sheet, with its fields filled
```

- A field the insert does not set shows its definition's `value`. Give a definition a value
  that reads as empty, such as `-`, so a missing field shows on the sheet.
- The lines and texts of the block are on layer `0`, so they draw on the layer of the insert,
  in its color and lineweight. An entity with a lineweight of its own keeps it.
- An attribute is placed and justified as a text is. A field that must end at the right edge of
  its box is `align: "right"` at that edge, and stays there whatever its value.
- Give the insert an `id`. Its attributes then keep their handles when the drawing around them
  changes: see [Handles](blocks.md#handles).
- The values are the ones in the code. A field changed in CAD is written over by the next
  export from the code.
- A tag names one field of the whole drawing where it can: a second block with a tag `TITLE`
  is told from the first only by its block's name.

The built-in standard's title block `plain` is a fuller one: a border and a title block with
seven fields, a table for revisions and an area for a seal, which
[`examples/site-plan.ts`](../examples/site-plan.ts) places from its standard, as the next
section but one says.

### The edge of the paper

The papers are full bleed: the plotter keeps no margin clear. Keep the border inside the paper
all the same. AutoCAD plots a line that lies on the left, the bottom or the right edge of the
paper with half its width off the page, and plots no line that lies on the top edge. The
example's border is half an inch inside the paper on every side.

## A firm's border under a sheet

A firm that has its title block as a drawing keeps it. The border is a DWG file, the sheet
references it on its layout, and the fields of the sheet are a block of attributes whose
definitions sit where the border's boxes are.

```ts
import { createDrawing, toDXF, toSVG } from "tsdraft";

// border.ts: stands for the firm's border, border.dwg, in the preview. The file itself is
// drawn in model space, in inches, with its lower-left corner at 0, 0.
const b = createDrawing({ units: "in" });
b.textStyle({ name: "FIRM", font: "Arial" });
b.layer("TB-HEAVY", { color: 1, lineweight: 0.7 });
b.rect([0.5, 0.5], 35, 23);
b.layer("TB-HEAVY", {}, () => b.rect([29.5, 0.5], 6, 2).line([29.5, 1.5], [35.5, 1.5]));
b.text([29.6, 2.2], "FIRM NAME", { height: 0.2, style: "FIRM" });
const border = b.build();

// sheet.ts: a sheet in the folder of border.dwg.
const d = createDrawing({ units: "ft" });
d.textStyle({ name: "TITLE", font: "Arial" });
d.layer("X-BORD", { color: 7, lineweight: 0.35 });
d.layer("G-ANNO-TTLB", { color: 7 });
d.layer("G-ANNO-NPLT", { color: 8, plot: false });
d.layer("C-PROP", { color: 2, lineweight: 0.5 }, () => d.rect([0, 0], 100, 140));

d.xref("BORDER", "border.dwg");
// The sheet's fields, each where the border has a box for it.
d.block("SHEET FIELDS", {}, () => {
  d.attribute("TITLE", [29.6, 1.7], { value: "-", height: 3 / 16, style: "TITLE" });
  d.attribute("SHEET", [35.3, 0.7], { value: "-", height: 3 / 8, style: "TITLE", align: "right" });
});

d.layout("C-101", { paper: "ARCH D" }, (sheet) => {
  // The border, on the paper at a scale of 1: an inch of the border is an inch of paper.
  d.layer("X-BORD", {}, () => d.insert("BORDER", [0, 0], { id: "border" }));
  d.layer("G-ANNO-TTLB", {}, () =>
    d.insert("SHEET FIELDS", [0, 0], {
      id: "fields",
      attributes: { TITLE: "SITE PLAN", SHEET: sheet.name },
    }),
  );
  d.layer("G-ANNO-NPLT", {}, () =>
    sheet.viewport([1, 3], 34, 20, { center: [50, 70], ratio: 120, id: "plan" }),
  );
});

const drawing = d.build();
toDXF(drawing); // holds the path "border.dwg" and the fields, and nothing of the border
toSVG(drawing, { layout: "C-101", xrefs: { BORDER: border } }); // the sheet over the border
```

AutoCAD loads `border.dwg` each time it opens the sheet, draws it on the layout under the
fields, and plots both. The fields stay attributes of the sheet.
An xref that only a layout places is placed: AutoCAD does not purge it.

### What the border's file may hold

- **Its border in model space.** AutoCAD draws the model space of a referenced file and
  nothing of its layouts. A firm whose title block sits on a layout of its template writes it
  out once to a DWG of its own, with the border in model space.
- **Its lower-left corner where the insert puts it.** With the border's corner at `0, 0` in its
  file, the insert is at `[0, 0]` on the layout.
- **Paper units.** A border for a paper in inches is drawn in inches, and is inserted at a
  scale of 1. AutoCAD draws an insert at the scale the file gives it, whatever the units of
  the two drawings, so the border is its own size on the paper under a drawing in feet. A
  border drawn in other units than the paper's needs the scale between them in the insert.
- **Layers of its own.** What the border has on layer `0` draws in the color and lineweight of
  the layer its insert is on. What it has on another layer draws as that layer of its file,
  which the sheet lists as `BORDER|TB-HEAVY`.
- **Its own text and attributes.** They plot as the border's file has them: an attribute of a
  block in the border shows the value it has there, on every sheet that references the border.
  So what differs from sheet to sheet belongs in the sheet's own fields.
- **No xrefs of its own.** tsdraft writes an xref as an overlay, and AutoCAD loads an overlay
  for the drawing that references it and not for a drawing that references that one. A logo
  the border references as a drawing does not reach the sheet. The border holds its logo
  itself.
- **Fonts the plotting machine has.** AutoCAD draws the border's text in the fonts its file
  names, and in another font where the machine lacks one.

The border has to be a DWG file, by a path from the folder of the sheet's file:
[Xrefs](xrefs.md) has the rules for the path, and what AutoCAD does when the file is missing.

### What a drafter meets in CAD

- **Attaching the border by hand scales it.** AutoCAD's own attach command works a scale out
  from the units of the two drawings. Attached by hand to a layout of a drawing in feet, a
  border drawn in inches comes in at 1/12 of its size, and needs a scale of 12 there. The
  insert tsdraft writes has the scale the code gives it, 1 unless it says otherwise, and
  AutoCAD leaves it as it is.
- **The fields are edited in the sheet.** AutoCAD's `-ATTEDIT` command changes a field's
  value, and the drawing keeps it when it is saved. The next export from the code writes the
  code's values again.

## The title block of a standard

A standard names its title blocks, and its sheet formats, each of which gives a sheet its paper,
its plot style table, its title block and its zones. Drawn to a standard, a layout is on a sheet
format, and `sheet.titleBlock()` places the title block and fills its fields:

```ts
import { BUILT_IN_STANDARD, createDrawing } from "tsdraft";

const d = createDrawing({
  units: "ft",
  standard: BUILT_IN_STANDARD,
  fields: { project: "RESIDENCE AT LOT 12", date: "2026-11-13", drawnBy: "AB", checkedBy: "CD" },
});
const plan = d.view("plan", { scale: "1in-10ft" });
d.layer("C-PROP", () => d.rect([0, 0], 100, 140));

d.layout("C-101", { sheetFormat: "arch-d" }, (sheet) => {
  sheet.titleBlock({ title: "SITE PLAN" });
  const views = sheet.zone("views");
  d.layer("G-ANNO-NPLT", () =>
    sheet.viewport([views.left, views.bottom], views.width, views.height, {
      view: plan,
      center: [50, 70],
    }),
  );
});
```

- `layout(name, { sheetFormat }, draw)` names the sheet format, and `layout(name, draw)` is on
  the standard's `defaultSheetFormat`. A layout of a standard takes no `paper` and no
  `plotStyle`: the sheet format gives them.
- `sheet.drawingArea` is the part of the paper inside the border, and `sheet.zone(name)` a box of
  it that the sheet format names, such as `views`, each as `{ left, bottom, right, top, width,
  height }` in paper units.
- `sheet.titleBlock(fields)` places the title block once on its layout, on the title block's
  layer. A title block that tsdraft draws is a block, inserted at `[0, 0]`. A firm's own is its
  drawing as an xref, inserted at its point, and the block of the sheet's fields goes over it
  when the title block has one. The block's insert has the id `<layout name>.title-block` and
  the xref's `<layout name>.border`, when that is a valid id, and none otherwise.
- A field is filled from `fields` given to `titleBlock()`, then from `createDrawing`'s `fields`,
  then by the builder: the number is the layout's name, as below, and the scale is the label of
  the one scale the layout's viewports show, or `AS NOTED` when they show more than one. The
  builder writes the scale when the layout's `draw` returns, so a title block placed before the
  viewports gets it. A key of `fields` is what a field fills, such as `title` or `drawnBy`, or the
  tag of a field that fills none of them.
- The title block's block, every block it inserts and every text style they use enter the
  drawing under their own names, once however many layouts place it. A drawing that has a block
  or a text style of one of those names with another definition is refused, and so is a later
  `block()` of the name. The builder renames none: a block's handles come from its name, and a
  renamed block would move the handles that a drawing referencing this one holds. When one of
  them is refused none of them enters, and a refused `titleBlock()` places nothing on the layout.
- What the block draws is on layer `0`, which draws as the insert's layer does, or on layers of
  the standard, with the standard's properties.

A field's `source` says where its value comes from: an attribute of the block, which tsdraft
writes, or a field of the firm's drawing that AutoCAD fills in the sheet, from the sheet's file
name, its layout's name, or the date it opens or plots the sheet. tsdraft writes nothing for
the last three.

### One drawing, or a file per sheet

A standard's `sheetFiles` says how a firm keeps its sheets.

**`"one-drawing"`**, the default, keeps a set's sheets as the layouts of one drawing.

- A sheet's number is its layout's name, which is unique in the drawing, and the builder writes it
  in the field that fills `number`. `createDrawing`'s `fields` give no number, which would be every
  sheet's, and a number given to `titleBlock()` is the layout's name.
- No field reads the file's name or the layout's name: each field the sheet fills is an attribute,
  which the builder writes over the firm's drawing. One drawing has one file name, which such a
  field would show on every sheet. A field that reads `CTAB`, the layout's name, plots each
  layout's own name, with `-PLOT` and with `-PUBLISH`, since AutoCAD works it out as it plots each
  one. But under one drawing the layouts' names are the sheets' numbers, so such a field in the
  title's place would plot the number there.

**`"sheet-per-file"`** keeps each sheet as a drawing of its own, with one layout, which
references the firm's title block and the model drawings as xrefs.

- A drawing has one layout, a sheet, or none, a model drawing. A second layout is refused.
- A sheet has a number, from `createDrawing`'s `fields` or from `titleBlock()`. It names the
  sheet's file, so it has 1 to 64 characters, none of `< > : " / \ | ? *`, no control character
  and nothing above U+FFFF, no space or dot at its end, and is not a name Windows keeps for a
  device: `CON`, `PRN`, `AUX`, `NUL`, `COM1` to `COM9` or `LPT1` to `LPT9`, in any case and with
  any extension. Windows names no file with such a character, drops a space or a dot from the end
  of a name, and opens the device for a file of a device's name.
- Save a sheet as `<number>.dwg`, or `<number>.dxf`. AutoCAD fills a field that reads the file's
  name from the name the file has, so a sheet saved under another name shows that name as its
  number, and AutoCAD says nothing.
- A field that reads the layout's name shows the layout's name, and `titleBlock()` refuses
  another value for it. A field of the date AutoCAD opens or plots the sheet takes no value.

### A firm's title block as an xref

A title block of the xref form names the firm's drawing by a path from each sheet's file, as
`d.xref` takes one. Its file holds to the rules of
[What the border's file may hold](#what-the-borders-file-may-hold). Its `preview`, a `Drawing`
that stands for the file, is what the pictures draw in its place: give it to `toSVG` as the
drawing of the xref, `toSVG(drawing, { layout, xrefs: { BORDER: titleBlock.preview } })`, and to
the command in the drawing file's `xrefs` export.

## The preview

`toSVG(drawing, { layout })` draws an insert on a sheet with its attributes, each with the
insert's value. It draws a border that is an xref when it is given a drawing for it, as the
example above does, and leaves it out otherwise.

The [`tsdraft` command](command.md) lists each layout's inserts in `drawing.layouts`, with the
value of every attribute, so the fields of a title block can be read without the picture. For
the pictures it draws the border from the drawing file's `xrefs` export:

```ts
export const xrefs = { BORDER: border };
export default drawing;
```

Whether a field fits its box is a matter of how long its value plots. `measureText` gives
that length before the value is drawn: see [Text](text.md#how-long-a-text-is). The pictures
draw every text as long as it plots, in any font, so a value that fits its box in the PNG
fits it on paper. Draw a field's box as a closed polyline, as `rect` does, and the command
warns with `text-leaves-boundary` when a value runs past it, naming the insert and the
attribute's tag. `tsdraft render <file> --layout <name> --view x0,y0,x1,y1` draws the title
block alone, large enough to read: see [The tsdraft command](command.md#a-closer-look).
