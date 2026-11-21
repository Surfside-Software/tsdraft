# Underlays

An underlay is a PDF placed under a sheet: an architect's floor plan under an engineer's, or a
survey under a site plan. CAD programs draw the page from the file each time they open the
drawing, as they draw an image's file. Underlays themselves are coming. The first part is here:
`pdfPageSize`, which reads the size the drawing will hold of each, as `rasterSize` reads an image's
pixels.

## A page's size

`pdfPageSize(bytes, page)` gives a page's width and height in inches, across and down as a viewer
shows the page, or undefined:

```ts
import { readFileSync } from "node:fs";
import { pdfPageSize } from "tsdraft";

const size = pdfPageSize(readFileSync("A-101.pdf"), 2); // [36, 24]
```

CAD programs place an underlay with the lower-left corner of the page's box at the insertion
point, so at scale 1 a page is that many drawing units across and up, one to an inch of the page.

`page` is the page's number from 1, as a number or as a string such as `"2"`, the way a drawing
file names the page. Any other value, and a page past the file's last, gives undefined.

The size is the page's box as a viewer shows it:

- The CropBox, cut to the MediaBox. With no CropBox, or one that misses the MediaBox, the
  MediaBox.
- A page that has no box of its own takes it from the page tree above it, the nearest first, as
  a PDF reader does. So does `/Rotate`.
- Points over 72, times the page's `/UserUnit` where it has one. A `/UserUnit` that is not a
  positive number counts as 1.
- A `/Rotate` of 90 or 270, or -90, turns the page a quarter turn, so the width and the height
  change places. One that is not a multiple of 90 counts as 0.

## The files it reads

It reads a PDF's cross-reference tables and its cross-reference streams, the updates a program
appends to a file it saves, the newest winning, and objects packed inside object streams. A box,
each number in it, a page tree's `/Kids` and `/Count`, and `/Rotate` may each be given by
reference. A stream it must read, such as a cross-reference stream, may be compressed with
FlateDecode, with or without a PNG predictor; one in any other filter gives undefined.

Where the cross-reference is broken, as when a file was edited by hand or cut short, it finds the
objects by scanning the file for their headers, as viewers do.

An encrypted file reads when its pages are outside object streams, since encryption covers strings
and streams and leaves the numbers of a box as they are. One whose pages are packed in object
streams gives undefined.

A file's bytes are untrusted, and `pdfPageSize` never throws. It returns undefined for anything it
cannot read, and its work stays in proportion to the file: the streams of one file inflate to 64 MB
at most, a broken file's scan finds 262,144 objects at most, and a page tree deeper than 256 or one
that loops back on itself gives undefined.
