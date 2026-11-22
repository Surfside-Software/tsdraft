# Images, underlays, hatches and masks

Rules for agents who change images, PDF underlays, hatches, gradients, wipeouts or masks.
[AGENTS.md](../../AGENTS.md) has the rules that hold for every change.

- `src/images.ts` is the one place of where an image's pixels go, its clip as the file holds it
  and its frame: the writers, the plots, the extents and the readers all take an image from it.
  A file is keyed by its path with `exactKey`, never `Strings`, since a lost key writes a file
  twice. A file's bytes are untrusted input: `src/raster.ts` reads them as `src/truetype.ts` reads
  a font, and decodes a PNG only up to `RASTER_PIXELS`. A browser drops the colors of a pixel of
  no alpha, which the leading CAD app plots for an image not marked transparent, so `toSVG` holds
  such a PNG again without its transparency, up to `OPAQUE_PIXELS`; past them it holds the file
  as it is and marks the `<use>` `data-opaque`, which `toPDF` reads. That is the one place the
  preview and the plot part. A PNG the plot must decode and cannot is drawn by neither, as a file
  not given.
- `src/underlays.ts` is the one place of where an underlay's page goes, its clip as the file holds
  it, its frame, its colors and its definitions: the writers, the plots, the extents and the
  readers all take an underlay from it. A page is one drawing unit to an inch of it at scale 1,
  whatever the units. `src/` draws no PDF: `toSVG` draws a page from the PNG the caller gives in
  `underlays`, its colors changed by `underlayColor` and held again in stored deflate blocks, and
  `pdfPageSize` in `src/pdf-pages.ts` reads only a page's size, from untrusted bytes. The DXF
  leaves out a scale of 1, as the leading CAD app saves it, and always writes the contrast and the
  fade: that app saves no contrast of 75 and no fade of 25, but reads a file without them as other
  values, so a reader takes a file without them as 75 and 25 and the writers never leave them out.
- `src/fills.ts` is the one place of what a hatch, a wipeout and a text's mask draw: a hatch's loops
  and their sides, filled by parity, which the writers make the leading CAD app's rule too by island
  style normal and polyline loops; a wipeout's square picture of one pixel and its clip; a mask's box
  and factor, a paragraph's and a dimension style's. The writers, `toSVG`, the extents, `lint` and
  the readers take them from it. The wipeout frame is the dictionary variable `WIPEOUTFRAME`, which is
  what that app reads, beside `WIPEOUTVARIABLES`, which it does not. A hatch is drawn as one path
  with `fill-rule="evenodd"`, which `toPDF` writes as `f*`. tsdraft ships no hatch pattern: a
  firm's pattern file gives them. A hatch finds its pattern by `layerKey` of its name, the first of
  a name, and `patternDrawnProblem` is the one check of what its lines draw, which `lint`, the
  builder and `toSVG` share: a pattern that would draw more than `HATCH_LINES` lines across the
  box of its loops, or place a number of 1e100 or more, is refused, and `toSVG` draws none of its
  lines. A gradient is `gradientPicture`, from its loops and numbers as written: colors along a
  line or out from a point in a frame mapped onto the hatch, which `toSVG` writes as a
  `linearGradient` or `radialGradient` in the picture's definitions and `toPDF` as a shading in the
  loops' clip. It plots in its own colors whatever the plot style table, and black is written as
  `0,0,1`, since the leading CAD app reads a 421 of 0 as no color.
