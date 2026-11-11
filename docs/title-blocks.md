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

[`examples/site-plan.ts`](../examples/site-plan.ts) has a fuller one: `titleBlock` there draws
a border and a title block with seven fields, a table for revisions and an area for a seal.

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

Whether a field fits its box is a matter of the width of its letters. A PNG from the command
has a text as wide as it plots only where `sameWidths` is true for its font in `pngFonts`: see
[The tsdraft command](command.md#fonts-in-a-png).
