# Plotting

tsdraft plots a drawing's sheets to PDF itself, with no CAD program: a PDF for each sheet and
one for the set.

```ts
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { toPDF } from "tsdraft";

const deflate = (bytes: Uint8Array) => deflateSync(bytes);
writeFileSync("set.pdf", toPDF(drawing, { xrefs, deflate })); // every layout, in order
writeFileSync("A-101.pdf", toPDF(drawing, { layouts: ["A-101"], xrefs, deflate }));
```

`toPDF(drawing, options)` gives the bytes of a PDF with a page for each layout:

- `layouts` names the layouts to plot, in the order of the pages. Without it, every layout is
  plotted in the drawing's order, which is the order of its tabs.
- `xrefs` gives the drawing each xref stands for, by the xref's name, as `toSVG` takes them. An
  xref with no drawing given plots nothing.
- `deflate` compresses each page: a function that gives the zlib form of its bytes, such as
  Node's `zlib.deflateSync`. The library imports nothing, so without it the pages are written as
  they are, and the file is several times larger. It is called as the PDF is written, so it
  cannot be an asynchronous one, such as a browser's `CompressionStream`.
- `missing` is told, for each sheet that has any, its layout's name, the characters of its texts
  that the PDF's faces lack, which the page sets as `?`, and its page, counted from 0.
- `title` is the document's title, which a viewer shows in place of the file's name.

The same drawing and options give the same bytes, with the same `deflate`: the file holds no
date, and its id is a hash of what it holds. `toPDF` does not run `lint`: a page shows what the
picture of the sheet shows. A name in `layouts` that the drawing has no layout of throws a
`RangeError`, and so does an empty list of layouts or a drawing with none. A page whose content
would pass 1,000,000,000 bytes, or a file that would pass 2,000,000,000, throws a `RangeError`
that names the page.

## What a page holds

A page is the picture `toSVG(drawing, { layout })` draws of the sheet, so a sheet plots as the
preview shows it:

- The page is the layout's paper at its size: ARCH D is 36 by 24 inches. ARCH E, which the
  plotter holds upright, is a page 36 by 48 inches turned a quarter turn, `/Rotate 270`, so a
  viewer shows it as it is on the layout, 48 wide.
- Each viewport shows model space at its scale, clipped to its rectangle and to the paper. A
  viewport's border plots as the thinnest line the printer draws, and only when its layer is
  on, thawed and set to plot.
- Every line plots in the color the layout's plot style table gives its pen, black under
  `monochrome.ctb`, and as wide as its lineweight on the paper, with round ends and joins.
  `DWF Virtual Pens.ctb` plots every line 0.254 mm wide.
- A layer that is off, frozen or set not to plot is left out, and so is everything an insert or
  an xref places on such a layer. An xref of a drawing an xref places is not drawn: a drawing's
  overlays are its own.
- A curve strays from its arc by at most 1/1000 inch on the paper.
- A dash pattern is sized on the paper and fitted to each line, side of a polyline, arc and
  circle, as [Linetypes on a sheet](layouts.md#linetypes-on-a-sheet) says.
- A line of lineweight 0 plots as the thinnest line the printer draws, as a viewport's border
  does.
- Each layer is a layer of the PDF too, by the name the picture gives it, `XREF|LAYER` for a
  layer of an xref, so a PDF viewer lists the layers and can hide one.
- Each page has a bookmark and a page label with its layout's name.

## Text

A text plots where `measureText` puts it, with its capitals as tall as its height and its
length the length it plots. The PDF embeds no font: it sets each text in one of the three faces
every PDF reader has without a font file, so the letters are the reader's own shapes of those
faces:

| A style's font                                                                        | The face    |
| ------------------------------------------------------------------------------------- | ----------- |
| Arial, Calibri, Segoe UI, Tahoma, Trebuchet MS, Verdana, and the sans-serif SHX fonts | Helvetica   |
| Times New Roman, Georgia, `romanc.shx`, `romant.shx` and `complex.shx`                | Times-Roman |
| Courier New, Consolas, `txt.shx` and `monotxt.shx`                                    | Courier     |

Helvetica has Arial's widths, Times has Times New Roman's and Courier has Courier New's, so a
text in one of those three fonts plots letter for letter as long as the font sets it, at the
size the font is set at. A text in any other font is set in the face of its kind, with the
face's capitals as tall as the text's height, and stretched to its length: it covers the same
space with letters of another shape. A font that is not one of `FONTS` is set in Courier, as
the picture draws it in the font of `Standard`.

A character outside Windows-1252, such as `≥`, is not in the faces: the page sets it as `?`,
which `measureText` takes its width to be, and `missing` is told. The characters Windows-1252
has from 0x80 to 0x9F, such as `–` and `“`, are set as themselves, each as wide as `?`, which
is how `measureText` measures them.

## A set of files

A firm that keeps each sheet in a file of its own plots the set from a list of its sheets, in
the order of the set:

```ts
const sheets = [
  { drawing: siteDrawing, layout: "C-101", xrefs },
  { drawing: planDrawing, layout: "A-101", xrefs },
];
writeFileSync("set.pdf", toPDF(sheets, { deflate }));
```

`pdfFace(font)` names the face a font is set in. `svgToPDF(pictures, options)` plots pictures
`toSVG` drew of layouts, a page each, as `toPDF` does: the command uses it to plot the pictures
it already holds. A picture says its format in its `data-picture`, and `svgToPDF` takes only
the format of its own copy of tsdraft. It throws a `RangeError` that names the first element,
attribute or format it does not draw, so a page never leaves something out unsaid.

## The command

`tsdraft render plan.ts --pdf` writes `plan.pdf`, the set, and `plan.layout-<layout>.pdf` for
each sheet, beside the pictures, and lists them in `outputs.pdf` and `outputs.layouts[].pdf`,
with each sheet's faces in `pdfFonts` and the characters its faces lack in `pdfMissing`.
`tsdraft dev` serves the set at `/drawing.pdf` and a sheet at `/drawing.pdf?layout=<name>`, and
its page links both. Neither plots pictures drawn with `--draw-no-plot`, nor those of a build
that left out what `lint` refused. [The command](command.md) has the rest.
