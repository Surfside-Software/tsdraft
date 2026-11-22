# Underlays

An underlay is a page of a PDF placed under a sheet: an architect's floor plan under an
engineer's, or a survey under a site plan. The drawing holds the file's path, the page and its
size, and nothing of what the page shows. CAD programs draw the page from the file each time they
open the drawing. In the file it is a `PDFUNDERLAY`, with the page's definition, a
`PDFDEFINITION`, which every underlay of that page shares.

Underlays are R2018 only. The builder and `lint` refuse one in an R12 drawing.

## Drawing one

`d.underlay(path, at, options)` places a page of the file at `path` with the lower-left corner of
the page at `at`. At scale 1 the page is one drawing unit to an inch of the page, whatever the
drawing's units, as CAD programs place it, so a 36 by 24 inch sheet under a plan drawn in feet at
1/4" = 1'-0" takes `scale: 48`. `pageSize` is the page's own width and height in inches, which
`pdfPageSize` reads from the file:

```ts
import { readFileSync } from "node:fs";
import { createDrawing, pdfPageSize } from "tsdraft";

const pageSize = pdfPageSize(readFileSync("arch/A-101.pdf"), 2)!;
const d = createDrawing({ units: "ft" });
d.layer("X-ARCH", { color: 8 }, () => {
  d.underlay("arch/A-101.pdf", [0, 0], { page: "2", pageSize, scale: 48, fade: 50 });
});
```

`path` starts from the folder of the drawing's file, with `\` or `/` between folders, as an
image's does, and the writers write it with `\`. An absolute path is refused. `page` is the page's
number from 1, as a string, and defaults to `"1"`.

`rotation` turns the page about its lower-left corner, in degrees counterclockwise. In a block, an
insert's scale and rotation place it as they place the rest of the block.

Each page is written once, as one definition that every underlay of it names, with `\` and `/`
taken as one. The definition is named by the file's name without its extension, `-` and the
page, such as `A-101 - 2`, with a number in brackets after the file's name where a file of another
folder took the name first.

## How it plots

- `clip` hides what lies outside two corners of a rectangle along the page's sides, or a polygon,
  in the drawing's coordinates. `invertClip: true` shows the page outside the clip instead.
- `fade`, a whole number from 0 to 80, mixes each color toward white by that share.
- `contrast`, a whole number from 20 to 100, draws each color's lightness toward a middle gray,
  keeping its hue: 100, the default, leaves it as it is.
- `monochrome: true` plots each color as the gray of its lightness.
- `on: false` shows its frame alone.

The page plots in its own colors whatever the plot style table, and what the page leaves
unpainted shows what is drawn before it. A page with a painted white ground hides it.

Each underlay has a frame: the page's outline, or its clip's, drawn in the underlay's layer,
color and lineweight. `underlayFrame` on the drawing sets it for every underlay: `true`, the
default, shows and plots it; `false` neither; `"screen"` shows it in a CAD program and does not
plot it. `toSVG`, `toPDF` and the preview are plots, so they draw no frame for `"screen"`.

## Plotting

tsdraft draws no PDF. `toSVG` and `toPDF` draw an underlay from a picture of its page the caller
gives as `underlays`, by the underlay's path exactly as the drawing gives it and then by its page:
a PNG of the page with a clear background, such as `pdftocairo` draws:

```sh
pdftocairo -png -transp -cropbox -r 150 -f 2 -l 2 -singlefile arch/A-101.pdf arch/A-101.pdf.page2
```

```ts
const page2 = new Uint8Array(readFileSync("arch/A-101.pdf.page2.png"));
toPDF(drawing, { underlays: { "arch/A-101.pdf": { "2": page2 } }, deflate: zlib.deflateSync });
```

The picture must have the page's shape, to a pixel, or `toSVG` throws a `RangeError`. 150 to 300
pixels an inch is plenty: CAD programs plot an underlay as a picture of 400 pixels an inch, and a
picture of more than 100,000,000 pixels is drawn as a page not given. The picture is held in the
SVG once for each page and set of colors, and in the PDF once. A page in a fade, contrast or
monochrome is held in the SVG uncompressed, about 5⅓ characters a pixel, against the length
`toSVG` writes: draw such pages at 150 pixels an inch where a sheet has several.

An underlay whose page is not given is drawn as CAD programs draw one whose file they cannot
find: three lines at its insertion point, `Missing or invalid reference`, the file and the page,
a fifth of an inch high at scale 1, and no frame.

`tsdraft render` and `tsdraft dev` read each page's picture from beside its PDF, named
`<file>.page<N>.png`, and warn of one that is missing with the command that draws it. Where the
PDF is there, a `pageSize` that is not the page's is an error, and a page the PDF does not have
is drawn as missing. An underlay of an xref is drawn as missing.

## A page's size

`pdfPageSize(bytes, page)` gives a page's width and height in inches, across and down as a viewer
shows the page, or undefined. `page` is the page's number from 1, as a number or as a string such
as `"2"`. Any other value, and a page past the file's last, gives undefined.

- The CropBox, cut to the MediaBox. With no CropBox, or one that misses the MediaBox, the
  MediaBox.
- A page that has no box of its own takes it from the page tree above it, the nearest first, as a
  PDF reader does. So does `/Rotate`. An entry that is null counts as none. Pages are counted in the
  tree's order, whatever a stale `/Count` says.
- Points over 72, times the page's `/UserUnit` where it has one. A `/UserUnit` that is not a
  positive number counts as 1.
- A `/Rotate` of 90 or 270, or -90, turns the page a quarter turn, so the width and the height
  change places. One that is not a multiple of 90 counts as 0.

It reads cross-reference tables and streams, files that have both, the updates a program appends
to a file it saves, the newest winning, and objects packed inside object streams, compressed with
FlateDecode with or without a PNG predictor. Where the cross-reference is broken it finds the objects by scanning the
file for their headers, as viewers do. An encrypted file reads when its pages are outside object
streams. A file's bytes are untrusted: `pdfPageSize` never throws, and its work stays in
proportion to the file.

## Reading

`readDXF` and `readDWG` read each underlay as the file places it: its path and page, its corner,
its scale across and up, its turn from 0 up to 360, its clip in the drawing's coordinates, and its
fade, contrast, monochrome and whether it shows. `underlays` lists every definition of the file,
those no underlay uses among them, which CAD programs keep through a save and a purge, and
`underlayFrame` says when the frames do not plot. A read underlay holds no page size.

## What lint refuses

- A path that is empty, absolute, longer than 32,000 characters, or that holds `* ? < > | : "`, a
  multibyte escape or a character a text cannot hold.
- A page that is not a string of digits from `"1"`.
- A `pageSize` that is not two numbers above 0 as written, and a scale that is not above 0 as
  written.
- A fade that is not a whole number from 0 to 80, or a contrast from 20 to 100.
- A clip of fewer than 2 points or more than 10,000, a rectangle of no width or no height along the
  page, a polygon of fewer than 3 points that differ, and `invertClip` with no clip.
- An underlay in an R12 drawing.
