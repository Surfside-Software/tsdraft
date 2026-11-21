# Colors

An entity draws in its layer's color unless it has a color of its own. `color` takes four kinds of
value:

- An index from 1 to 255 of the color index CAD programs share. 7 is black on paper.
- `"ByLayer"`, the layer's color, which is the default and is left out of the drawing.
- `"ByBlock"`, the color of the insert that places the entity's block.
- A true color, `[red, green, blue]`, each a whole number from 0 to 255.

```ts
const d = createDrawing({ units: "ft" });
d.layer("C-PAVE", { color: 7 }, () => {
  d.line([0, 0], [100, 0]);
  // The existing sidewalk, gray among the black.
  d.line([0, -5], [100, -5], { color: [128, 128, 128] });
});
```

Every entity but a table takes a color: lines, polylines, circles, arcs, ellipses, splines, texts,
paragraphs, hatches, wipeouts, images, inserts, dimensions and leaders. A table's style and its cells
give its colors, and the builder and `lint` refuse a color of its own. A dimension draws every part in its color, its text and
arrowheads included, and so does a leader. A wipeout's color is its frame's; it still hides what is
behind it in the paper's color.

Colors are R2018 only. The builder and `lint` refuse a color but `"ByLayer"` in an R12 drawing.

## How a color plots

A plot style table decides how an index plots: `monochrome.ctb` plots every index black,
`Grayscale.ctb` each in a gray of its own, `acad.ctb` each in its color. A true color plots as it
is under each of those tables, `monochrome.ctb` included, in the leading CAD app's plot. So an entity that must plot gray on a sheet that
plots black takes a true gray, such as `[128, 128, 128]`; an index 8 plots black there.

## ByBlock

An entity of a block set `"ByBlock"` takes the color of the insert that places the block: its own
color, its layer's when the insert is ByLayer, and the color of the insert around it when the
insert is ByBlock too. An entity on layer `"0"` of a block that is ByLayer draws in the insert's
layer's color, not in the insert's own color. An entity ByBlock outside any block draws as index 7.

```ts
d.block("VALVE", {}, () => {
  d.layer("0", {}, () => d.circle([0, 0], 0.5, { color: "ByBlock" }));
});
d.layer("C-WATR", { color: 5 }, () => {
  d.insert("VALVE", [10, 10]); // blue, its layer's color
  d.insert("VALVE", [20, 10], { color: 1 }); // red
});
```

## In a paragraph

A paragraph's `\C` code colors the characters after it by an index: `\C1;` red, `\C0;` ByBlock and
`\C256;` ByLayer, the layer's color, not the paragraph's own. `\c` gives a true color as one number,
with its blue first: `\c255;` is red, `\c16711680;` blue, and `\c65280;` green.

```ts
d.paragraph("EXISTING {\\C1;TO BE REMOVED}", { at: [0, 0], height: 0.125 });
```

## In the file

The DXF holds an index in group 62, with 0 for ByBlock, and a true color in group 420 as
`0xRRGGBB` with an index beside it in group 62: the one the leading CAD app matches the true color to,
which tsdraft writes as they do. A drawing read back gives both, as [Reading](reading.md) says.
