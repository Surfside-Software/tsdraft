# The plot to PDF

Rules for agents who change `toPDF`, `svgToPDF` or the TrueType reader. [AGENTS.md](../../AGENTS.md)
has the rules that hold for every change.

- `src/pdf.ts` plots layouts to PDF from the pictures `toSVG` draws of them, and decides
  nothing about a drawing: every rule of what a sheet plots stays in `toSVG`, so the preview
  and the plot cannot part. It reads the closed set of elements and attributes `toSVG` writes
  for a layout, and refuses any other with a `RangeError` that names it, so a new element in
  `toSVG` is drawn in the PDF in the same pull request or fails `test/pdf.test.ts`. It reads
  each picture once, with a sticky pattern that refuses what it cannot read, and writes in
  proportion to it. Each point is mapped to the page and written in points with three
  decimals, never with an exponent. A text in a TrueType font whose file the caller passes in
  `fonts` is set in that file, embedded as a subset; any other in Helvetica, Times or Courier
  with widths from `src/font-metrics.ts`. Either way it is stretched with `Tz` to the length
  `toSVG` holds it to. The library has no zlib, so a caller passes `deflate`. The same pictures give the same bytes. A picture of
  a layout says its format in `data-picture`, `SHEET_PICTURE` in `src/svg.ts`, and `svgToPDF`
  reads no other: raise it in the pull request that changes what an element or an attribute of
  such a picture means, since the closed list catches a new one and not a changed one.
- `src/truetype.ts` reads a TrueType file for `toPDF` and cuts it to a subset. A font file is
  untrusted input: every offset and count is held to the bytes before it is read, each glyph is
  read once when the file is, and a file it does not take is refused with the reason as a
  string, never a throw. A composite glyph built of itself, or nested deeper than 16, is refused,
  so cutting a font it took always ends. `test/truetype.test.ts` mutates the shipped font from a
  seed.
