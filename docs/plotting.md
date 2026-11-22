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
- `xrefs` gives the drawing each xref stands for, by the xref's name, as `toSVG` takes them: a
  `Drawing`, or `{ drawing, xrefs }` with the drawings its own xrefs stand for, so that it plots
  its attachments. An xref with no drawing given plots nothing.
- `deflate` compresses each page: a function that gives the zlib form of its bytes, such as
  Node's `zlib.deflateSync`. The library imports nothing, so without it the pages are written as
  they are, and the file is several times larger. It is called as the PDF is written, so it
  cannot be an asynchronous one, such as a browser's `CompressionStream`.
- `plotTransparency` draws each entity at its transparency, as CAD programs plot it when told to
  plot transparency always. Without it every entity plots opaque, as they plot the page setups
  tsdraft writes. [Transparency](transparency.md) says how.
- `fonts` gives the TrueType file of each font the texts are set in, by its name in `FONTS`, as
  [Text](#text) says. The PDF embeds each, cut to the letters it uses.
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
  an xref places on such a layer. A drawing an xref places plots its attachments, from the
  drawings given with it, and not its overlays, as [Nested xrefs](xrefs.md#nested-xrefs) says:
  a drawing's overlays are its own. A viewport leaves out the layers frozen in it alone, and turns its view
  by its twist, as [Frozen layers and a twist](layouts.md#frozen-layers-and-a-twist) says.
- A curve strays from its arc by at most 1/1000 inch on the paper.
- A dash pattern is sized on the paper and fitted to each line, side of a polyline, arc and
  circle, as [Linetypes on a sheet](layouts.md#linetypes-on-a-sheet) says, and along the whole
  of an ellipse or a spline, as [How it plots](curves.md#how-it-plots) says.
- An ellipse, an arc of one and a spline of degree 3 or less are drawn exactly; a rational spline
  or one of a higher degree in 32 straight steps to each span of its knots.
- A line of lineweight 0 plots as the thinnest line the printer draws, as a viewport's border
  does.
- A wide side of a polyline is filled, at its width whatever its pen, with its joins and its
  dashes as [How it plots](polylines.md#how-it-plots) says.
- An image is drawn from its file's bytes, given as `images`, clipped to its clip, with its frame
  in its pen, and the PDF holds each file once, as [Plotting](images.md#plotting) says.
- A hatch is filled by the parity of its loops, or draws its pattern's lines and dashes cut to
  them, a wipeout and a mask in the paper's white or a mask's color, each over what is drawn
  before it, as [Fills, wipeouts and masks](fills.md) says.
- Each layer is a layer of the PDF too, by the name the picture gives it, `XREF|LAYER` for a
  layer of an xref, so a PDF viewer lists the layers and can hide one.
- Each page has a bookmark and a page label with its layout's name.

## Text

A text plots where `measureText` puts it, with its capitals as tall as its height and its
length the length it plots.

`fonts` gives the TrueType file of each font the texts are set in, by the font's name in
`FONTS`:

```ts
const fonts = { Arial: readFileSync("arial.ttf"), "Times New Roman": readFileSync("times.ttf") };
writeFileSync("set.pdf", toPDF(drawing, { xrefs, deflate, fonts }));
```

A bold run of a paragraph is set in the file given under its font's name and ` Bold`, which
`boldFontKey` gives: `{ "Arial Bold": readFileSync("arialbd.ttf") }`. `FONTS` names each bold
file.

The PDF embeds each file, cut to the glyphs of the characters its pages set, so every character
plots in the letters of the file: `°`, `±`, `½` and `≥` as `A` does. A set embeds each font once,
for all its pages. The file may be the font's own, or one made to its widths, such as Liberation
Sans for Arial. A text in the font's own file is set at the size that makes the capital `A` of the
file as tall as the text's height, as CAD sets the font; in another file, at the size that makes
the cap height the file states as tall, as the command's PNG sets it. Either way it is stretched to the length it plots. A
character the file has no glyph for, and a control character, is set as `?`, and `missing` is
told.

A file is embedded when it is a TrueType font with `glyf` outlines whose licence bits allow it
to be embedded and cut to a subset. One that is not, such as a font with PostScript outlines, a
collection, a file cut short or a font whose glyphs are built of each other in a loop, is not
embedded, and its font is set as if no file were given. The same files give the same bytes.

A text in an SHX font, and in a TrueType font with no file, is set in one of the three faces
every PDF reader has without a font file, which the PDF does not embed, so the letters are the
reader's own shapes of those faces:

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

In those faces a character outside Windows-1252, such as `≥`, is set as `?`, which
`measureText` takes its width to be, and `missing` is told. The characters Windows-1252 has
from 0x80 to 0x9F, such as `–` and `“`, are set as themselves, each as wide as `?`, which is how
`measureText` measures them.

`pdfFace(font, file)` names the face a font is set in: with the file `fonts` gives for it, the
PostScript name of the file's font, such as `ArialMT`, when the PDF embeds it, and `Helvetica`,
`Times-Roman` or `Courier` otherwise.

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

`svgToPDF(pictures, options)` plots pictures
`toSVG` drew of layouts, a page each, as `toPDF` does: the command uses it to plot the pictures
it already holds. A picture says its format in its `data-picture`, and `svgToPDF` takes only
the format of its own copy of tsdraft. It throws a `RangeError` that names the first element,
attribute or format it does not draw, so a page never leaves something out unsaid.

## The command

`tsdraft render plan.ts --pdf` writes `plan.pdf`, the set, and `plan.layout-<layout>.pdf` for
each sheet, beside the pictures, and lists them in `outputs.pdf` and `outputs.layouts[].pdf`,
with each sheet's faces in `pdfFonts` and the characters its faces lack in `pdfMissing`. It
embeds the file the PNG sets each TrueType font in: the font's own from the operating system's
font folders, or Liberation Sans, Serif or Mono for Arial, Times New Roman and Courier New. A
font the machine has no file for is set in a standard face, and `pdfFonts` says which.
`tsdraft dev` serves the set at `/drawing.pdf` and a sheet at `/drawing.pdf?layout=<name>`, and
its page links both. Neither plots pictures drawn with `--draw-no-plot`, nor those of a build
that left out what `lint` refused. [The command](command.md) has the rest.
