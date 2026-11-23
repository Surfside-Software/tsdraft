# Changelog

## Unreleased

- `readDXF` takes the file's bytes as one `Uint8Array`, such as a `Buffer` from `fs.readFileSync`,
  as `readDWG` does.
- The picture of a read file. `toSVG` draws a `DrawingRead` read with `geometry` as the leading
  CAD app shows the file: model space, or a layout as it plots, with every kind the readers keep.
  A dimension and a table draw from the block of their picture, a multileader from its own
  points, a text from where that app starts it, in the nearest font of `FONTS` where tsdraft lacks
  its own. `readPicture` gives the picture with notes of what it could not draw as the file holds
  it, and in fragments, one for each entity at the top of a space, which `joinPicture` joins.
  `pictureDrawing` gives the `Drawing` it draws.
- `tsdraft render` and `tsdraft dev` draw a DXF, and a DWG through a reader the project installs
  or `--reader` names, as they draw a drawing file.
- `sheetShows`, `spaceShows` and `nearPoint` answer what a sheet of a read file shows, what a space
  draws and what is near a point: through inserts and the xrefs whose reads are given, with each
  layer's state as the sheet holds it, `XREF|LAYER` among them, each viewport's frozen layers,
  its outline or the entity that clips it, and an insert's clip. `xrefAreas` gives the parts of
  an xref's model a host's layout shows.
- Both `ReadViewport.clipBy`, the handle of the entity that clips a viewport, and
  `ReadInsert.clip`, the outline of an insert's spatial filter in its block's coordinates, are
  read from a DXF.
- `tsdraft shows` prints what a sheet of a drawing file shows, or what is near a point, as JSON.
- The command keeps each read of a drawing file, one for each hash of the file's bytes, its
  reader and what is read, in memory and in the project's `node_modules/.cache/tsdraft`.
- `eachDrawn` can give each placement the inserts the walk came through.
- `ReadOptions.only` reads a file as named layouts show it: each layout's paper whole, and of
  model space what its viewports' windows meet, or areas of model space given as two corners. A
  detail file whose model space holds far more than `GEOMETRY_ITEMS` reads whole one sheet at a
  time. What model space leaves out is counted under `outside what was read`, a layout not named
  keeps no `entities`, and `DrawingRead.only` gives back what the read kept. `viewportWindow` gives
  the corners in model space of what a viewport shows, and `partFilter` is how a reader of another
  format reads `only` as `readDXF` does.

## 0.5.4

This release has breaking changes, though its number is a patch's. A project that depends on
`^0.5.0` gets them on its next install. Most are new members of unions that code may switch over
in full. It adds every 2D kind of entity CAD programs draw that tsdraft lacked, and the DWG
reader's formats from 2004 to 2013.

- Breaking: `LintRule` gained `entity-color`, `entity-transparency`, `paragraph`, `image`,
  `underlay`, `hatch`, `hatch-pattern`, `hatch-gradient`, `duplicate-hatch-pattern`, `wipeout`,
  `table`, `table-style`, `duplicate-table-style`, `undefined-table-style` and `linetype-shape`.
  Code that switches over every rule needs them.
- Breaking: `Entity` gained `PointEntity`, `Ellipse`, `Spline`, `Paragraph`, `RadiusDimension`,
  `DiameterDimension`, `JoggedRadiusDimension`, `AngularDimension`, `ArcLengthDimension`,
  `OrdinateDimension`, `Image`, `Underlay`, `Hatch`, `Wipeout` and `Table`. Code that switches
  over every kind needs them.
- Breaking: `ReadEntity` gained `point`, `ellipse`, `spline`, `mtext`, `dimension`,
  `radial-dimension`, `angular-dimension`, `arc-length-dimension`, `ordinate-dimension`,
  `multileader`, `leader`, `solid`, `image`, `underlay`, `hatch`, `wipeout`, `table` and the
  modeler kinds `3dsolid`, `region` and `body`, which a block now keeps where it counted them
  under `other`, and `unread.entities` no longer counts a `MULTILEADER` or a `SOLID`. Code that
  switches over every kind needs them.
- Breaking: a text, an attribute definition and an attribute have `at`, where the text starts to
  draw, beside `stored`, `alignAt`, `align`, `valign`, `startFrom`, its width factor and oblique
  angle, and `backward` and `upsideDown`. For a justified text of tsdraft's own DXF, `at` was its
  alignment point and is now its start. A text of a block seen from below is read as backward,
  where it was counted.
- The built-in standard is version 3, with the leader style `notes`, so a drawing to it writes
  that style.

- 3D solids, regions and bodies are read. `readDXF` and `readDWG` read each as a `3dsolid`,
  `region` or `body` with its `edges` in 3D, from the modeler data a file before 2013 holds in the
  entity, as text or binary; a file of 2013 or later keeps the data apart from the entity, and a
  read of one says `dataUnread` until a later release reads it. `edgesInPlan` turns a read solid
  into the lines, arcs, ellipses and splines it shows from above, which `toSVG` and `toPDF` draw.
  `satEdges`, `sabEdges` and `decipherSat` read the data on its own. Neither writer writes a
  solid, and the lines CAD programs draw along curved faces are not drawn yet.
- `readDWG` reads drawings saved in the 2004, 2007, 2010 and 2013 formats as well as 2018's, into
  the same read model, as CAD programs read them when they open the file: a 2004 file's text in its
  code page, each `\U+XXXX` in it as its character, a table of the 2004 or 2007 format as one of
  the later formats, and what a newer format holds that an older one cannot, such as attributes of
  paragraph text, paragraph text in columns, a strike-through, an image's inverted clip and a
  multileader's attachments, from the data an older save keeps for it. A read names the file's
  `version`, and for 2004 its `codepage`.
- An entity's own transparency, in R2018 drawings. Every entity but a table takes
  `transparency`: a whole percent from 0 to 90, `"ByLayer"`, the default, or `"ByBlock"`, which
  an entity of a block takes from its insert. `toDXF` writes it in group 440 as CAD programs store
  it, and a dimension's picture holds every part transparent ByBlock. `toSVG` and `toPDF` draw
  every entity opaque, as CAD programs plot the page setups tsdraft writes, and with
  `plotTransparency: true` each entity at its transparency, composed first so its overlapping
  parts are no darker, in a group with an `opacity` and a PDF transparency group. `lint` and the
  builder refuse any other value under the rule `entity-transparency`, a transparency on a table,
  a percent on an entity of a block a leader places, and one in an R12 drawing. `readDXF` and
  `readDWG` read it as `alpha`, from 0 to 255, or `"ByBlock"`. A block a leader places holds
  every entity ByBlock, as CAD programs read it, and the writers write it so; the leader draws
  it opaque.
- Points, in R2018 drawings. `d.point(at, { rotation })` marks a location, and
  `createDrawing({ pointStyle })` gives the figure every point plots as: a dot, nothing, a +, a ×
  or a tick, with a circle or a square around it, at a `size` in drawing units or a `{ percent }`
  of half the view it is seen in, as CAD programs plot it. `toDXF` writes each point and the style
  as `$PDMODE` and `$PDSIZE`, and `toSVG` and `toPDF` draw the figure in the thinnest line, solid,
  turned with the point, and under an insert placed as the block's lines are. The extents hold a
  point's location. `readDXF` reads points and the two header variables, and `pointStyleOf` gives
  the style they plot as. `lint` and the builder refuse a figure that is not one of the five, a
  size not above 0, a rotation outside 0 to 360, and a point or a point style in an R12 drawing.

- Linetypes with shapes: a fence with its circles along it, and batt insulation. `parseShapes`
  reads a firm's compiled shape file (`.shx`) into each shape's outlines, and `toSVG`, `toPDF`
  and `lint` take the files' bytes as `shapes`, found by name as CAD programs find them, without
  regard to case and with or without `.shx`. The plot draws each shape where it draws a text,
  turned and scaled alike, in the line's pen, and a shape of a negative scale turned half a turn;
  `lint` warns `linetype-shape` only of a shape it cannot draw from the files given.
  `parseLinetypes(text, { shapes })` numbers a shape given by its name. The `tsdraft` command
  reads each shape file from the drawing file's folder. A pattern that ends with a dash is now
  fitted to its own first dash, which runs on from that last one, and a pattern of dashes alone
  draws its marks along a solid line, as CAD programs plot them.

- PDF underlays, in R2018 drawings: an architect's plan under a sheet. `d.underlay(path, at,
  options)` places a page of a PDF by its path from the drawing's folder, its `page` and its
  `pageSize` in inches, which `pdfPageSize` reads, at one drawing unit to an inch of the page
  times `scale`, turned by `rotation`, with a `clip` of a rectangle or a polygon, `invertClip`,
  `fade`, `contrast`, `monochrome` and `on`. `underlayFrame` on the drawing shows and plots every
  underlay's frame, hides it, or with `"screen"` shows it and does not plot it. Both writers write
  each page once as a definition every underlay of it shares, and `readDXF` and `readDWG` read
  underlays back and list every definition in `underlays`, which every read now holds, so a reader
  the command runs answers with it too. `toSVG` and `toPDF` draw an underlay from a picture of its
  page given as `underlays`, in its fade, contrast and monochrome and in its own colors whatever
  the plot style, and write that the file is missing where no picture is given, as CAD programs
  do. The `tsdraft` command reads each page's picture from `<file>.page<N>.png` beside its PDF and
  gives the `pdftocairo` command that draws one. `lint` and the builder refuse, under the rule
  `underlay`, a path, page, page size, scale, fade, contrast or clip that cannot be written.
- Tables, in R2018 drawings. `d.tableStyle(style)` defines a table style: the text style and
  height of its cells, its margins, and the cell style of its title, header and data rows, each
  with its own text style, height, alignment, text color, fill and border lineweight.
  `d.table(options)` draws a table at its upper left corner: `columns` gives each column's width,
  `title` a cell across them all, `header` and `rows` a cell for each column, each a string or an
  object with `text`, a `block` scaled to fit or by `blockScale`, `columnSpan` and `rowSpan`, and
  its own `align`, `valign`, `textHeight`, `color` and `fill`; a cell another spans is `null`.
  Both writers write one table entity and its style as CAD programs hold them, so a drafter adds
  a row, resizes a column and edits a cell, with the picture CAD programs draw for it: text
  wrapped at its column, a word too long for it broken, each row as tall as its cells need,
  fills, borders and blocks. Each style lists its tables, so a change to the style in a CAD
  program reaches them. `toSVG`, `toPDF` and `inspectText` draw and check it as it plots, and
  `measureTable` gives the size it takes. `readDXF` and `readDWG` read a table's rows, columns and
  cells and each table style into `tableStyles`, which every read now holds, so a reader the
  command runs answers with it too. `lint` and the builder refuse, under the rules
  `table-style`, `duplicate-table-style`, `undefined-table-style` and `table`, a style or a table
  that cannot be written, a row of the wrong length, a span past the table or over another cell, a
  `null` that nothing spans, a block its fit would scale to 0, a table in a block and more than
  100,000 cells. `tableBox` gives the box of what a table draws, its cells' blocks included.

- Linetypes with text, in R2018 drawings: a pipe with its letters along it. A linetype's `marks`
  draw a text, such as `W`, at the end of a length of its pattern, by `after`, in one of the
  drawing's text styles, turned with the line, from the X axis, or `upright` so it reads from the
  left, and moved by `offset` along the line and to its left. `parseLinetypes(text)` reads a firm's
  linetype file. A polyline's `linetypeGeneration` runs the pattern on past its vertices as one
  stretch, so a side shorter than the pattern is not drawn solid without its letters. Both
  writers write them, `readDXF` and `readDWG` read them back, and `toSVG` and `toPDF` draw the
  letters where CAD programs plot them: with each whole pattern, along the side they land on, at
  the size of the paper in a viewport or an insert. A linetype's shapes are written and read as
  their numbers in a shape file.

- Ellipses and splines, in R2018 drawings. `d.ellipse(center, majorAxis, ratio)` draws an
  ellipse, or an arc of one with `startParameter` and `endParameter`. `d.spline(fitPoints)` draws
  the cubic CAD programs fit through the points, with `startTangent`, `endTangent` or `closed`,
  and `d.controlSpline(controlPoints)` a B-spline of its `degree`, from 1 to 11, `knots`, which
  default to clamped uniform ones, and `weights`, or periodic with `closed`. `toDXF` writes each
  as CAD programs save it, a spline through fit points with the knots and control points
  `fitSpline` gives and one by control points clamped, and `toSVG` and `toPDF` draw them, with
  dashes along the whole curve. The extents hold the curve, not its control points. `readDXF`
  reads both. `lint` and the builder refuse a ratio outside 0 to 1, an axis of no length, one
  parameter without the other, fewer than 2 fit points or two side by side that are one, a
  tangent of no direction or on a closed spline, a degree out of range, too few control points,
  knots of the wrong count or that decrease, weights not above 0, and more than 32,767 knots.
  `ellipsePoint`, `ellipseBox`, `splinePoint`, `splineBox`, `fitSpline` and `clamped` give their
  geometry.
- An entity's own color, in R2018 drawings. Every entity but a table, an insert, a dimension and a
  leader included, takes `color`: an index from 1 to 255, `"ByLayer"`, the default, `"ByBlock"`, or a
  true color `[red, green, blue]`. `toDXF` writes an index in group 62, and a true color in
  group 420 with the index the leading CAD app matches it to in group 62. `toSVG` and `toPDF` plot an index
  through the layout's plot style table and a true color as it is under each table, and an
  entity of a block set ByBlock in its insert's color. A paragraph's `\c` code sets a true color,
  with its blue first, and `\C0;` and `\C256;` plot ByBlock and in the layer's color. `lint` and
  the builder refuse any other color under the rule `entity-color`, and a color in an R12
  drawing. `readDXF` and `readDWG` read a color of a color book as `colorBook`, with its true
  color in `trueColor`.
- Solid fills, wipeouts and masks, in R2018 drawings. `d.hatch(boundary)` fills the area inside
  one outline, or inside a list of loops `{ points, bulges? }`, solid in its layer's color: the
  area inside an odd number of loops is filled, so a loop inside another is a hole, whichever
  way each runs, as CAD programs fill one. `d.wipeout(points)` draws a polygon in the paper's
  color, which hides what is drawn before it, with its frame in its pen unless
  `Drawing.wipeoutFrame` is `false`. A paragraph's `mask` hides what is drawn before it behind its
  box grown by `offsetFactor`, and a dimension style's `textMask` masks every dimension's text, its
  box grown by a quarter of the text's height. Both writers write each as CAD programs hold it, and
  `toSVG` and `toPDF` draw it where it plots. `lint` and the builder refuse a hatch with no loop
  or a loop of fewer than 3 points, or 2 joined by an arc; a wipeout of fewer than 3 points, on
  one line or with sides that cross; and a mask of another shape. `LeaderMask` is now
  `TextMask`, which a leader's and a paragraph's mask share.
- Hatch patterns, in R2018 drawings. tsdraft has no patterns of its own: `parsePatterns(text)`
  reads a firm's pattern file, and `d.patterns()` adds its patterns, or definitions given as data,
  to the drawing's `patterns`. A hatch's `pattern` names one, with its `scale`, `angle` and
  `origin`, or draws lines of its own `spacing` apart at its `angle`, `crossed` by as many more.
  `toDXF` writes the lines each hatch draws, and `toSVG` and `toPDF` draw them and their dashes cut
  to its loops, as CAD programs plot them. `readDXF` and `readDWG` read a hatch's `patternType`,
  `patternAngle`, `patternScale`, `crossed` and `patternLines`, so a firm's patterns can be read
  back from its drawings. `lint` and the builder refuse, under the rule `hatch-pattern`, a hatch
  that names a pattern the drawing does not have, a scale or spacing not greater than 0, a
  pattern's definition that cannot be written, and a hatch whose pattern would draw more than
  1,000,000 lines across its loops; two patterns of one name are a `duplicate-hatch-pattern`.
- Gradient hatches, in R2018 drawings. A hatch's `gradient` fills it from one color to another:
  `linear`, `cylinder`, `spherical`, `hemispherical` or `curved`, or the `inverted-` form of the
  last four, turned by `angle` and moved off the middle unless `centered`, with two `colors` or one
  `color` and its `tint`. A color is an `Rgb`, `[red, green, blue]`, each a whole number from 0
  to 255. Both writers write it as CAD programs hold it, black as `[0, 0, 1]`, which a file can
  hold, and `toSVG` and `toPDF` draw it as CAD programs plot it, in its own colors whatever the plot
  style table: a `linearGradient` or `radialGradient`, and a shading. `gradientPicture` gives what
  a gradient draws. `readDXF` and `readDWG` read a hatch's `gradient`. `lint` and the builder
  refuse, under the rule `hatch-gradient`, a gradient with a pattern, a name of another kind, a
  field it does not know, an angle that is not a finite number under 1e100, a color that is not
  three whole numbers from 0 to 255 and a tint outside 0 to 1. `toSVG`'s pictures
  of layouts are now of format 2, which `svgToPDF` reads.
- `readDXF` and `readDWG` read a hatch, its loops of polylines or of lines and arcs as points and
  bulges, its pattern and its island style; a wipeout; an `MTEXT`'s background mask; the order a
  file's sort table draws a space or a block in, `drawOrder`; and whether wipeouts' frames show,
  `header.wipeoutFrame`.

- Attributes of paragraph text. `d.attribute(tag, at, { kind: "paragraph", width, ... })` defines
  one, as CAD programs' multiple-line attributes: its value and each insert's hold the codes of
  paragraph text, checked as a paragraph's value is, wrap at its width and break at each line
  feed, and its box is placed by `align`, `valign`, `lineSpacing` and `lineSpacingStyle` as a
  paragraph's is. `AttributeDefinition` is `TextAttributeDefinition` or
  `ParagraphAttributeDefinition`, told apart by `kind`. Each insert holds the attribute as CAD
  programs' own insert does: at its height in the insert, wrapped at the width times the same
  share, and, where the insert scales its block unevenly, with its characters widened by a code
  of the attribute's width factor before its value, in place of the style's. `placeAttribute`
  gives that paragraph in `paragraph`, `attributeParagraph` the `Paragraph` drawn, and
  `attributeTextStart` where the attribute's text of no value starts, which CAD programs hold
  with it and keep from a DXF. The R2018 DXF writes it, `readDXF` reads it back as `ReadAttributeParagraph`, and `toSVG`, `toPDF`,
  `inspectText`, the extents and `lint` lay it out where CAD programs plot it. `lint` and the
  builder refuse a width, a line spacing or a style of paragraph text on a definition of one
  line, and R12 holds no blocks.
- A leaned line of paragraph text wraps a word as CAD programs do: as if its ink reached twice its
  last character's lean further, whatever its width factor. A line in a style with an oblique
  angle, or after `\Q`, may wrap a word earlier than before.
- `lint` no longer throws on an attribute definition whose value is not a string when an insert
  of its block sets no value for it.

- Leaders' notes, as CAD programs draw them. A note is laid out as paragraph text is, each line
  set by the ink of its letters, so its lines move where they plot by up to a quarter of their
  height from where earlier versions drew them. `attachment` takes every place CAD programs
  attach a landing, `LEADER_ATTACHMENTS`: `"top-of-first"`, `"first-line"`, `"middle"`,
  `"last-line"`, `"bottom-of-last"`, `"underline-last"`, `"underline-first"`, `"bottom-of-first"`
  and `"underline-all"`, which underline the line they meet by running the landing on under it.
  The middle of a line runs from its top as far down as its capitals and the last line's letters
  below the baseline, as CAD programs measure it, so `"first-line"` and `"last-line"` notes sit a
  little higher than before. A leader style's `direction: "vertical"` puts the note above or
  below its point, `side` takes `"above"` and `"below"`, and `verticalAttachment` is `"center"` or
  `"line"`, a line as wide as the note through the point. A leader's `width` wraps its note, each
  item of its text a paragraph; `frame` on a style or a leader draws a frame one gap outside the
  note; and a leader's `mask` hides what is drawn before it behind its note, `true` for the
  drawing's background or `{ color, offsetFactor }`. Both writers write each of these as the
  multileader CAD programs make, and `toSVG` and `toPDF` draw them where they plot. `lint` and
  the builder refuse a width not greater than 0, a mask of another shape, and a value of
  `attachment`, `side`, `direction` or `verticalAttachment` not in its list.
- Leaders with two roots, curved shafts and a block in place of the note. `toFarSide` gives the
  shafts of a second root on the note's far side, whose point tsdraft works out from the note as
  CAD programs do. `shaft: "curved"`, on a style or a leader, draws each shaft as the cubic CAD
  programs draw through its tip, its bends and the end of its landing. `d.leader({ block,
  attributes }, options)` holds a block of the drawing in place of the note, such as a keynote
  bubble; a style may name the `block`, and `blockConnection` and `blockScale` say how it meets
  the landing and how large it is. `Leader.text` is optional, since a leader whose content is a
  block has none, and `leaderPicture` takes a fourth argument that finds a block by its name.
  `lint` and the builder refuse a block the drawing lacks, a leader whose content is a block
  that sets an option only a note has, and far shafts that are no shafts.
- The built-in standard, version 3, has the leader style `notes`, its `defaultLeaderStyle`: the
  role `note`, a closed filled arrow 1/8 inch long, a landing of 1/8 and a gap of 1/16. A
  standard's leader style takes a `direction`, a `verticalAttachment`, a `frame` and a `shaft`.
- `readDXF` and `readDWG` read a multileader whole: each of its roots, its kind of shaft, the
  attachment of each side, its note's width and where it is held, its frame, its mask, and a
  block in place of its note with its attributes; and the old `LEADER`, as the read model's
  `leader`.

- Paragraph text lays out the codes that change the characters after them, as the leading CAD
  app does: `\H` a height in drawing units or, with `x`, times the last; `\W` a width factor and
  `\Q` an oblique angle, each in the place of the style's; `\A` the characters on the baseline,
  centered on the line's tallest run, or at its top; and `\C` a color by its index, which moves
  nothing. A line's spacing grows with its tallest run. `lint`, the builder and a literal value's
  type refuse a number a code does not take, with one grammar for each. Each run of a laid-out
  line gives its `widthFactor`, `obliqueAngle` and `color`, which the preview draws it in, and
  `RunFormat` gains `height`, `widthFactor`, `obliqueAngle` and `color`. `\T`, the spacing of the
  characters, `\c`, a true color, and `\O`, an overline, are still refused.

- Raster images, in R2018 drawings: `d.image(path, at, { pixels, width })` draws a PNG or a JPEG
  with its lower-left corner at `at`, `width` drawing units wide, and `height`, `rotation`,
  `clip`, `invertClip` and `transparent` where given; its height defaults to the file's
  proportions. `path` starts from the drawing file's folder and the writers write it with `\`.
  `pixels` are the file's, which the new `rasterSize` reads from a PNG's or a JPEG's header, and
  two images of one file must give it the same. `clip` is two corners of a rectangle along the
  image's sides, or a polygon of three points or more, in the drawing's coordinates, and may reach
  past the image. Both writers write each file once as an image definition, with its reactor, the
  dictionary of images and the drawing's image variables, and the four classes counted, without
  which CAD programs draw nothing of an image. `imageFrame: false` on a drawing hides every
  image's frame. `lint` and the builder refuse an image in an R12 drawing, an empty or absolute
  path or one with `* ? < > | : "`, pixels that are not two whole numbers from 1 to 2^31-1, a
  width or height not greater than 0, a clip of fewer than 2 points or more than 10,000, a
  rectangle of no size along the image's sides, a polygon of fewer than 3 points that differ,
  and `invertClip` with no clip; a literal path is a compile error. `toSVG` and `toPDF` take the
  files' bytes as `images`, by the image's path as the drawing gives it, and draw each image as
  CAD programs plot it: the file's pixels mapped onto its corners, cut to its clip, opaque unless
  it is `transparent`, then its frame, its outline or its clip's, in its pen. The picture holds
  each file once, a JPEG without its EXIF and a PNG that plots opaque without its transparency
  up to 4,194,304 pixels, and the PDF holds a JPEG and a PNG of no transparency
  to show as their own data and decodes any other PNG. An image whose file is not given is its
  frame with its path inside it, and one whose file has other pixels is refused with a
  `RangeError`. An xref's images take their files from `{ drawing, images }` among `xrefs`,
  never from the sheet's. `tsdraft render` and `tsdraft dev` read each image's file from the drawing file's
  folder, warn of one missing, and report an error for one of other pixels. `readDXF` reads each
  image, with `u` and `v`, the vectors of one of its pixels, and its clip in the world's
  coordinates, and lists the file's image definitions in `images`, with how many images name each,
  one that none names among them. The example sheet has a vicinity map above its key plan.
  [docs/images.md](docs/images.md) describes them.
- `pdfPageSize(bytes, page)` reads a PDF page's size in inches, the first part of PDF underlays,
  which are coming: the page's CropBox cut to its MediaBox, from the page tree where the page has
  none, times its `UserUnit`, and turned where its `Rotate` is 90 or 270. `page` is its number from
  1, as `"2"` or `2`. It reads cross-reference tables and streams, incremental updates, object
  streams and FlateDecode with or without a predictor, scans a file whose cross-reference is broken,
  and gives undefined for anything else, never a throw. [Underlays](docs/underlays.md) has the
  rules.
- Ordinate dimensions: `ordinateDimension(feature, leaderEnd, { axis, origin })` gives the X or the
  Y of a feature from an origin, `[0, 0]` unless given, without its sign, on a leader to
  `leaderEnd` with its text beyond, drawn as the leading CAD app draws it: the leader jogs where
  the end is off the feature's line, except by no more than 1e-10 of the feature's X or Y in the
  drawing, which it draws straight. `toDXF` writes them, and `readDXF` reads them as `ordinate-dimension`.
- Arc length dimensions: `arcLengthDimension(center, radius, startAngle, endAngle, at, options)`
  measures the length of an arc, as `arc` takes it, with its own arc through `at`, drawn as the
  leading CAD app draws it: from a right angle up about the center with extension lines along radii,
  and under one with extension lines parallel to the arc's bisector. A dimension style's
  `arcSymbol` puts the arc symbol `"before"` the text, `"above"` it, or `"none"`. `toDXF` writes
  them, and `readDXF` reads them as `arc-length-dimension`.
- Angular dimensions: `angularDimension(vertex, from, to, at, options)` measures the angle at
  `vertex` between the lines to `from` and `to`, its arc through `at`, which picks the angle as the
  leading CAD app does: the one between the lines that holds `at`, or the rest of the turn. Drawn as
  that app draws them, with the text above the arc or centered in it, words below as a second
  line, and the marks turned outward where a centered text leaves them no room. A dimension style's
  `angleUnits` (`"degrees"`, `"degrees-minutes-seconds"`, `"grads"` or `"radians"`),
  `anglePrecision` and `suppressAngleZeros` write the angle. `toDXF` writes them, and `readDXF`
  reads them as `angular-dimension`, by three points or by two lines, with the angle in degrees.
- Radius, diameter and jogged radius dimensions: `radiusDimension(center, point, options)`,
  `diameterDimension(center, point, options)` and `joggedRadiusDimension(center, point, start,
  jog, options)`, drawn as the leading CAD app draws them, with the R and the diameter sign it
  writes before the measurement. The text stands outside the circle past the arrowhead, or along
  the line where `textFromCenter` places it. A dimension style's `radialText: "horizontal"` levels
  their text, and `jogAngle` sets the jog's angle. `toDXF` writes them, and `readDXF` reads them
  as `radial-dimension`. The font tables hold the diameter sign, with the advance a paragraph
  gives it in a font that lacks it; every other number is as it was. `toPDF` plots the diameter
  sign as Ø in a font that lacks it, as the leading CAD app plots it.
- Columns in paragraph text. `columns: { count, height }` flows a paragraph's lines through that
  many columns, the last taking what the others leave; `{ height }` through as many as the text
  takes; and `{ heights }` through a column of each height, then one for the rest. Each column is
  the paragraph's `width` wide and `gutter` apart, five heights by default, and `\N` in the value
  starts the next column. `layoutParagraph` lays them out where the leading CAD app plots them: a
  line starts the next column when its box reaches below the height, and the attachment places
  each column on its own. Its layout gives each line's `column` and each column's box in
  `columns`, and `measureParagraph` each line's column. `lint` and the builder refuse columns that
  are not one of those, and `lint` warns of a `\N` in a paragraph without columns. Both writers
  write columns as the leading CAD app saves them, and `readDXF` reads them back with each
  column's width. A distributed line wider than its room is no longer squeezed, and stands
  centered. `ParagraphColumns`, `ParagraphColumnsHeld`, `paragraphColumnsHeld` and
  `paragraphGutter` are new.
- What a dimension style sets of how its dimensions look. In architectural units, `fraction`
  stacks the fraction of an inch over a bar, `"stacked"`, or beside a slash, `"diagonal"`, at
  `fractionScale` of the text's height, as `4'-1` and a stacked `7/16`. `textPlacement:
  "centered"` puts the text in a break of the dimension line, and `textFit: "leader"` moves a text
  with no room between the extension lines out on a leader. `dimensionLineweight` and
  `extensionLineweight` set the pens of the dimension line and of the extension lines, and the
  arrowhead `"oblique"` is a thin tick. A dimension's `textBelow` writes words under its line, as
  `WINDOW HEAD HT.` under `6'-8"`. `dimensionPicture` draws each as the leading CAD app does: the
  text's box from the top of its tallest letter or stack to the foot of its lowest, ticks that
  turn outward where the text does not fit, the line in pieces, and the leader. It takes the
  dimension style's text style. `lint` and the builder refuse a value outside each field's list,
  a stacked fraction outside architectural units, and what is not laid out yet: a text centered
  in a line it is wider than, words below a text that moves out, a leader beside arrowheads twice
  the text's height, and closed filled arrowheads round a centered text with a leader.
  `readDXF` reads a dimension's words below into `textBelow`, and a dimension style's
  `textVertical`, `textInside`, `textMove`, `fraction`, `fractionScale`, lineweights and
  arrowheads' block. The built-in standard, version 2, adds the dimension style `arrows`, with
  closed filled arrows and the text centered, and a standard's dimension style takes the new
  fields, with `fraction` and `fractionScale` in its writing.
- A stacked part of a paragraph stands by its own ink, top less bottom, as the leading CAD app sets
  it, from the font tables' new column `stackTops`: a 7 over a 16 stands lower than a capital.
  A slash stack stands its top part on its bottom part's ink, and its gap is not widened with
  the letters. Every other number of the tables is as it was.
- Lists, tab stops and a paragraph's own format in paragraph text. `list(items, options)` writes a
  numbered or lettered list in two levels, each item hanging under its mark as CAD programs write
  one, and `paragraphFormat(properties)` a `\p` code: a paragraph's first-line, left and right
  indents, tab stops, justification left, centered, right, justified or distributed, room before
  and after it, and its own line spacing, by a factor or exactly. A value may hold a tab and
  `\p` codes, in heights after `x` and in drawing units without, as a firm's drawing holds them;
  a code sets the paragraph it stands in and each after it until another changes it.
  `layoutParagraph` lays them out as the leading CAD app does: indents, tab stops from the left
  of the box and every four heights past the last, the next letter's ink on its stop and the words
  after it wrapped as a line that starts there, justified lines grown at each space and
  distributed ones at each gap, each word and space or letter then a run of its own, and the
  spacing, the room and the box of a paragraph's own. `lint` and the builder refuse a `\p` option they do not
  know, a tab stop that aligns by its right, its center or a decimal point, and spacing at least
  a size, `sa`, as the type of a literal value does. Both writers write a tab, as `^I` in DXF,
  and `readDXF` reads it back. `ParagraphPiece` gains a `properties` piece, which
  `ParagraphProperties` describes. The example sheet's general notes are one numbered list.
- `readDXF` leaves out of a block's and a space's `entities` an entity the file marks invisible,
  group 60, and counts it under `other` as `invisible`. A dynamic block's definition and each `*U`
  block that holds one of its states keep the entities of every state, with those of the states
  it does not show marked invisible, so an insert of one now reads as the state it shows. An
  attribute or attribute definition marked so is `invisible`, as one whose own flag hides it is,
  and a space counts such a definition under `other`.
- Paragraph text, in R2018 drawings: `d.paragraph(value, options)` draws one text whose lines wrap
  at `width` and break at each line feed, held as an `MTEXT` that a CAD user edits as one. Its
  box is placed by `at`, the point `align` and `valign` name, its upper left corner by default,
  and it takes a `height`, a `rotation`, a `style`, a `lineSpacing` factor from 0.25 to 4 and a
  `lineSpacingStyle`, and under a standard a `role` and a `view`, as a text does. Its value holds
  the inline codes of an `MTEXT`: underline, strike-through, bold in a TrueType font, stacked
  fractions, slash stacks and tolerances, a superscript and a subscript, `%%d`, `%%p`, `%%c`,
  `\U+XXXX` and the escapes; `underline`, `bold`, `stack`, `superscript`, `subscript` and `plain`
  write them, and `parseParagraph` reads them. `lint` and the builder refuse a value with a brace
  never closed, a code it does not know or does not lay out yet, such as a tab, a list's indents,
  columns, a change of height or an overline, a stacked part of lower-case letters, a stack in
  underlined text, a font that is not one of `FONTS`, italic, bold in an SHX font, a font option
  other than `b0`, `b1`, `i0`, and `c` or `p` with digits, or one given twice, and a paragraph in
  an R12 drawing; a literal value with one of these is a compile error. They also refuse `%%c` in
  an SHX font, which draws a diameter sign of its own that is not laid out yet; a literal value's
  type refuses it in a font a `\f` or `\F` code sets, and leaves a character above U+FFFF to them.
  `layoutParagraph` and `measureParagraph` lay a paragraph out as the leading CAD app does: each
  line set by the ink of its first and last letters, broken where the next word's ink would pass
  the width, spaced by what its letters and stacks reach, with each run, bold face, underline,
  bar and stack part where that app draws it, from the font tables' new columns and the numbers as
  the writers write them. The extents, `toSVG`, `toPDF` and `inspectText` take a paragraph's lines
  and its box from them, and a long value many paragraphs share is laid out once in each of its
  settings. A paragraph's rotation is taken within a turn and to 6 decimals, and
  `paragraphDirection` gives the one direction both writers write and its layout is placed by.
  `FONTS` names
  each TrueType font's bold file, `capHeightOf` gives the height of a face's capital `A`, `toPDF`
  sets a bold run in the file `fonts` gives under the font's name and ` Bold`, and `tsdraft render`
  and `tsdraft dev` find the bold files as they find the regular ones. `readDXF` reads an
  `MTEXT`'s line spacing as `lineSpacing` and `lineSpacingStyle`, and its group 50 in degrees, and
  `layoutMtext` and `measureMtext` lay a read one out. [docs/paragraphs.md](docs/paragraphs.md)
  describes them.
- `toSVG` draws a text in a TrueType font from its first point, held to its characters' advances,
  and `toPDF` sets it at 100 `Tz` there, as the leading CAD app plots it: a text that ended in a
  letter whose ink passes its advance, as an `f` does, was stretched to its ink. `layoutText`
  gives the advances alone as `advances`.
- `measureText` turns a text by its rotation as the writers write it, to 6 decimals, so a tall
  text turned by less than a millionth of a degree is measured as the file draws it.
- `FONT_METRICS` holds, for each character of each font, where its ink starts and ends, how far
  it reaches above and below the baseline, the room each font leaves after a stack, and for each
  TrueType font its bold face's own numbers.
- The example sheet's general notes are paragraphs that wrap at the width of its column of notes.
- Attachments, and the xrefs of a referenced drawing in the preview and the plot.
  `d.xref(name, path, { attach: true })` writes an attachment, which a drawing that references
  this one draws too, where an xref is an overlay by default, and `Xref` holds `attach`. `toSVG`
  and `toPDF` take a drawing in `xrefs` as `{ drawing, xrefs }`, with the drawings its own xrefs
  stand for, and draw its attachments, and none of its overlays, as the leading CAD app draws
  them, 16 drawings down at most, `XREF_DEPTH`; a drawing given alone draws no xref of
  its own, as before. A circular reference is broken where the chain would draw a drawing it
  already draws, and past 4,096 names given inside referenced drawings none is drawn.
  `lint(drawing, { xrefs })` warns of each drawing given there that is not drawn, and why, and
  `drawnXrefs(drawing, xrefs)` gives what a picture draws of them. `inspectText` takes the same
  `xrefs`, and checks the texts of the drawings given for the drawing's own xrefs, not of their
  attachments. `tsdraft render` and
  `tsdraft dev` take the same in the export `xrefs`, lint each drawing given that they draw, at
  any depth, and `drawing.xrefs` gives each xref's `attach` and, for one shown, the `xrefs` of
  the drawing drawn for it. [docs/xrefs.md](docs/xrefs.md) describes them.
- Polyline arcs and widths, in R2018 drawings. A `Polyline` holds `bulges`, one for each side,
  where 0 is straight and 1 a half circle, and `width`, one width for every side, or `widths`,
  the width at each side's start and end. `d.polyline(points, closed, options)` takes all three,
  and `radius`, which rounds each corner with an arc tangent to both sides, as a bar's hook is
  bent; `d.rect` takes `radius` too. `d.cloud(outline, { arc })` draws a revision cloud along an
  outline, one closed polyline of arcs that each turn 110 degrees and bulge out of it, so a cloud
  drawn around a note crosses none of it; an outline with a notch narrower than an arc bulges is
  refused. `d.donut(center, outside, { inside })` draws a filled
  ring, or a dot. `bulgeThrough(from, through, to)` gives the bulge of the arc through a point,
  and `polylineBox` the box a polyline covers. `toDXF` writes them, `readDXF` reads them from a
  lightweight polyline and from a 2D one, and `lint` refuses a list of bulges or widths that does
  not have one for each side, a bulge or a width that is not a number, a negative width, `width`
  and `widths` together, and either in an R12 drawing. `toSVG`, `toPDF` and `tsdraft render` draw
  a side of width 0 with its pen and fill a wide one with no pen, as the leading CAD app plots
  them: two straight sides meet in a miter up to a turn of 151 degrees, a straight side meets an
  arc along the line from the arc's center, two arcs each end square, and each dash of a wide
  side is filled. `checkIntent` leaves a footprint or a property line with an arc unchecked, and
  says so. [docs/polylines.md](docs/polylines.md) describes them.
- The example sheet has a revision cloud around the driveway, with a delta, on the layer
  `C-ANNO-REVS` of its standard, and its north arrow's head is one polyline that widens from its
  tip, which CAD programs fill.
- The README lists a viewport's own frozen layers and its twist with what tsdraft draws, and no
  longer with what it does not have yet.
- The README and the package's description name what tsdraft does now: plotting to PDF,
  reading DXF, leaders and standards. The README says any release before 1.0 can break code,
  and lists what tsdraft does not draw yet.
- Docs, comments, error messages and the package's keywords describe CAD programs without naming
  a vendor. A rule one program holds is said of "the leading CAD app".
- Fonts in a PDF. `toPDF(drawing, { fonts })` takes the TrueType file of each font by its name,
  such as `{ Arial: bytes }`, and embeds it cut to the letters the pages use, so every
  character, `°`, `±`, `½` and `≥` included, plots in the font's own letters. A text in an SHX
  font, or in a font with no file, is set in Helvetica, Times or Courier, which no PDF embeds.
  `pdfFace(font, file)` names the face a font is set in.
- `tsdraft render --pdf` and `tsdraft dev` embed the file the machine has for each TrueType
  font, the one the PNG is set in, and `pdfFonts` names it: `ArialMT`, or `LiberationSans` for a
  font made to Arial's widths, where it named `Helvetica`.
- The outdoor kitchen example, `examples/outdoor-kitchen.ts`, draws its dimensions with
  `linearDimension`, in feet and inches with architectural ticks, and its notes with `d.leader`. Its
  helpers that drew them from lines and text, `dimensionChain`, `dimension`, `leader` and
  `textWidth`, are gone from `examples/lib/drafting.ts`.
- A viewport's own frozen layers, and its twist, in R2018 drawings. `sheet.viewport(…)` takes
  `frozenLayers`, the layers that show nothing in that viewport alone, and `twist`, which turns
  its view in degrees counterclockwise, and `Viewport` holds both. `toDXF` writes them, and
  `toSVG`, `toPDF` and `tsdraft render` draw the viewport without its frozen layers and with its
  view turned. The builder and `lint` refuse a frozen layer the drawing does not have, as
  `undefined-layer`, and a twist of a turn or more either way. `viewportView` gives a
  view's `twist` and `displayCenter`, and the `box` of a turned view is the box around the turned
  rectangle. [docs/layouts.md](docs/layouts.md) describes them.
- `readDXF` reads a viewport's frozen layers from group 331, where the leading CAD app writes them,
  in place of group 341.
- Under a standard, `lint`'s checks of the height a text plots at in a viewport leave out what
  the viewport freezes. They no longer stop for a drawing with a malformed leader style, which
  `lint` reports on its own.
- The example sheet has a key plan: a second viewport at 1" = 40', turned 30 degrees, which
  freezes the plan's annotation and the lines that run to the plan's edges, beside a narrower
  plan. Its title block's scale reads AS NOTED.

What changes for a read of a DXF, whose model is format 0 and not settled:

- `readDXF(input, { geometry: true })` keeps what model space and each layout draws, in
  `entities` beside each space's census, with `other` for what it leaves out, and the attributes
  of each insert. A read without it keeps what it kept. `readDrawingFile` takes the same
  `ReadOptions` as a third argument.
- An entity keeps the color, true color, linetype, lineweight and linetype scale it sets itself,
  an insert and a dimension name their block's record by `blockHandle`, and `opensAt` gives the
  tab and the view a file opens at. `GEOMETRY_ITEMS`, 400,000, bounds what the spaces keep.
- A string holds what the leading CAD app holds after reading the file: a caret and a space is a
  caret, `^J` a line feed, a text's `\U+XXXX` is decoded twice and `\M+NXXXX` once, and an `MTEXT`'s
  once. A name with a caret read as two characters before.
- An entity with a number that is not finite, and a record whose kind, layer, block name or tag
  is longer than a DXF value holds, is counted under `unread.malformed`.

## 0.5.3

This release has breaking changes, though its number is a patch's. A project that depends on
`^0.5.0` gets them on its next install. A drawing without a standard, a leader style or a turned
insert writes the same DXF as before, unless its inserts reach more blocks through nesting than
its extents walk, about half a million and 16 for each entity it holds.

- Breaking: `LintRule` gained `standard`, `discipline-unknown`, `layer-outside-standard`,
  `layer-differs-from-standard`, `linetype-outside-standard`, `linetype-differs-from-standard`,
  `pen-outside-standard`, `role`, `scale-outside-standard`, `text-style-outside-standard`,
  `text-style-differs-from-standard`, `dimension-style-outside-standard`,
  `dimension-style-differs-from-standard`, `sheet-format-outside-standard`,
  `sheet-format-ambiguous`, `sheet-per-file`, `height-below-standard`, `height-off-role`,
  `dimension-off-scale`, `viewport-outside-drawing-area`, `title-block-missing`,
  `title-block-differs-from-standard`, `title-block-field-unset`, `title-block-field-overflow`,
  `standard-check-capped`, `check-capped`, `leader-style`, `duplicate-leader-style`,
  `undefined-leader-style`, `leader`, `leader-style-outside-standard`,
  `leader-style-differs-from-standard` and `leader-off-scale`. Code that switches over every
  rule needs them.
- Breaking: past its limit, 500,000 units of work and 16 more for each entity and attribute
  definition the drawing holds, `lint` ends with the warning `check-capped`, which says where it
  stopped, and `toDXF` and `fromJSON` refuse a drawing with it, as they refuse an error. A
  drawing reaches it only when it draws millions of entities through its blocks or shares far
  more than it holds.
- Breaking: a drawing with a block named `_Open`, `_Dot` or `_None`, in any case of their
  letters, is refused. CAD draws a leader's arrowheads with the blocks of those names.
- Breaking: `Paper` gained `"ARCH E"`, `PlotStyleTable` gained `"Grayscale.ctb"` and
  `"DWF Virtual Pens.ctb"`, and `PaperInfo` gained `medium`. Code that switches over every
  paper or table needs them.
- Breaking: `TextOptions`, `AttributeOptions` and `InsertOptions` are type aliases now, not
  interfaces, so a declaration that merges into one stops compiling. An interface that extends
  one still compiles.
- Breaking: `toSVG` fits a dash pattern to each line, side of a polyline and arc: it holds as
  many whole patterns as fit, and its first and last dash are each half of the pattern's first
  dash and of what is left over. A pattern that starts with a dot has a dot at each end, and
  what is left over lengthens the gaps beside them. A circle holds the whole number of patterns
  nearest its length, stretched alike to go round it from a dash at its angle 0. One shorter
  than its pattern is solid. A dash of an entity in a block is as long whatever the insert's
  scale, where it grew with the insert. Dashes started at the start of each stretch before, so
  the pictures of dashed lines change.
- Breaking: a picture of a layout ends and joins its lines round, as a plotted pen does, and is
  stamped with its format, `data-picture`, the font of each text, `data-font`, and the lines
  drawn as the thinnest the printer draws, `data-thinnest`.
- Breaking: in the example, `sitePlan(scale)` takes a scale of the example's standard, such as
  `"1in-20ft"`, in place of a ratio.

Standards, which are new:

- A standard describes a firm's drawings: its disciplines, pens, linetypes, layers, text roles,
  scales, dimension and leader styles, title blocks and sheet formats, as one JSON document or
  as a TypeScript literal. `defineStandard(document, { files })` checks one and returns it
  resolved and frozen, with every default filled in. A literal mistake is a compile error with
  the message the check gives when the code runs, such as a layer name AutoCAD refuses or a pen
  the standard does not have. At run time a name is compared as AutoCAD compares it, so `c-prop`
  finds `C-PROP`. A problem is a `DrawingError` with the rule `standard` and its path, such as
  `layers["A-WALL"].pen`.
- `extends` takes a parent. A child's entry replaces its parent's whole, and `null` removes one.
  The library reads no file: a string `extends`, or a title block's drawing given as a string,
  is looked up in `files`.
- Each standard has a `hash`, the SHA-256 of what it states for a check: descriptions, comments,
  its id and version, a default written out and a name written in another case leave it as it
  is. `chain` gives each parent's id, version and hash.
- `BUILT_IN_STANDARD`, version 1, holds layers in the National CAD Standard's format, five pens,
  the six linetypes, five text roles, the engineering and architectural scales, a dimension
  style in decimal units and one in feet and inches, `feet-inches`, to the nearest 1/16", and a
  plain ARCH D title block. The package ships it as `tsdraft/standard.json`, and the standard's
  JSON Schema as `tsdraft/standard.schema.json`.
- `createDrawing({ standard })` draws to a standard, and the builder refuses what the standard
  does not give, as a compile error for a literal with the message it throws when the code
  runs. A message about a missing name says how to add it. `d.layer(name, draw)` names a layer
  of the standard, which gives its color, linetype, lineweight and plot flag, and an entity's
  `pen` gives it that pen's lineweight. The linetype scale is the standard's, and the drawing is
  R2018. `createDrawing({ standard, discipline })` names the discipline whose fields a layer
  with `byDiscipline` takes.
- Under a standard, every text and attribute names a `role`, which gives its text style and the
  height it plots at, and in model space the `view` it is read in. `d.view(id, { scale })`
  declares a view at a scale of the standard and returns a `View`, whose `paper(length)` turns a
  length on paper into drawing units. `sheet.viewport(corner, width, height, { view, center })`
  shows a view, and `insert(name, at, { view })` scales a symbol drawn in paper units to plot at
  its size. A dimension or a leader names a style of the standard by its id, and the drawing
  gets the style on first use with the standard's sizes: `DIMS-1in-10ft` for the style `dims` in
  a view at `1in-10ft`, and `DIMS` on a layout.
- `d.layout(name, { sheetFormat }, draw)` puts a layout on a sheet format of the standard, which
  gives its paper and its plot style table, and `d.layout(name, draw)` on the standard's
  `defaultSheetFormat`. The sheet has `drawingArea`, the part of the paper inside the border, and
  `zone(name)`, a zone of the sheet format, each a `Zone` in paper units.
  `sheet.titleBlock(fields)` places the title block: a block tsdraft draws, or the firm's own
  drawing attached as an xref with the block of the sheet's fields over it. A field is filled
  from the `fields` given to `titleBlock()`, then from `createDrawing({ fields })`, then by the
  builder, which gives the sheet's number and its scale. `sheetFiles` says whether a set is one
  drawing or a file per sheet. [docs/title-blocks.md](docs/title-blocks.md) describes both.
- `lint(drawing, { standard, discipline })` holds a drawing to its standard as the builder does,
  so a drawing made by other code or read from JSON is held to it too, under the builder's rule
  names. It also checks what only the whole drawing shows: a layer, linetype, text style or
  dimension style whose values are not the standard's, a layout's plot style table, a viewport
  past its drawing area or into the title block, a title block that is not the standard's, a
  text that plots at another height than its role's or below the standard's least height, and a
  dimension shown at another ratio than its style's. Warnings say when a layout has no title
  block, or a field is unset or runs past its box. `lint` takes the standard as plain data and
  works out its hash again, and a standard that does not check is one `standard` error. Without
  `standard`, `lint` reports what it did before. [docs/rules.md](docs/rules.md) lists each rule.
- `tsdraft render` and `tsdraft dev` check a drawing file's export `standard` with `lint` on each
  build. A rule of the standard that the drawing breaks is a diagnostic, and its errors give exit
  code 2. `drawing.standard` in the JSON gives the standard's `id`, `version` and `hash`, and
  `checked`, and the page of `tsdraft dev` shows its id and version. When the project's copy of
  tsdraft is from before standards, the build warns with `standard-unchecked`. A title block
  attached as an xref is drawn from its `preview` unless the file's `xrefs` export gives a
  drawing for it. `schema` stays 3.
- A drawing without a standard is built, linted and written as before. `d.layer(name, draw)` is
  a new form for every drawing, the same as `d.layer(name, {}, draw)`, and `layout()` takes its
  `draw` last, with options of `undefined` taken as none. `DrawingBuilder`, `DrawingOptions`,
  `EntityOptions`, `TextOptions`, `AttributeOptions`, `InsertOptions` and `Sheet` gain type
  parameters with defaults. [docs/standard.md](docs/standard.md) describes standards, and
  GUIDE.md shows how to extend the built-in one.

Plotting:

- `toPDF(drawing, { layouts, xrefs, deflate })` plots a drawing's layouts to one PDF, a page for
  each, in the drawing's order or the order of `layouts`: a sheet alone, or the set. Each page is
  the picture `toSVG` draws of the sheet: the paper at its size, each viewport at its scale and
  clipped to its rectangle, each pen in the color its plot style table gives it and as wide as
  its lineweight, with round ends, each layer a layer of the PDF, and each text where it plots in
  Helvetica, Times or Courier, as high and as long as it plots. `svgToPDF` plots pictures
  `toSVG` drew of layouts, for a set whose sheets are files of their own. The same drawing gives
  the same bytes. [docs/plotting.md](docs/plotting.md) describes it.
- `tsdraft render --pdf` writes the set and each sheet as PDFs, listed as `outputs.pdf` and
  `outputs.layouts[].pdf`, and `tsdraft dev` serves them at `/drawing.pdf` and links them on its
  page.
- `PLOT_STYLE_TABLES`, now exported, lists two more tables. `Grayscale.ctb` plots each color in a
  gray of its own and 7 in black. `DWF Virtual Pens.ctb` plots each color in its pen's own
  color, which is not always the index's, and every line 0.254 mm wide, whatever its
  lineweight, a viewport's border too. `toSVG` draws a sheet in the colors and widths its table
  plots.
- `PAPERS` has `"ARCH E"`, 48 by 36 on its layout. `DWG To PDF.pc3` holds that paper upright, so
  its page setup stores the paper as the plotter holds it, which `PaperInfo.medium` gives, and
  turns the plot a quarter turn onto it. The PDF shows the page 48 by 36, with the drawing
  upright. A drawing on any other paper is written as before.

Dimensions and leaders:

- Feet and inches. A dimension style with `units: "architectural"` takes a length times its
  `measurementScale` as inches and writes `4'-1 7/16"`. Its `precision` is the least fraction of
  an inch, 1 over 2 to that power, so 4 writes sixteenths. `feetInchZeros` says which zeros it
  writes: `"inches"`, the default, writes `4'-0"` and `6"`; `"feet"` writes `4'` and `0'-6"`;
  `"both"` writes both zeros and `"neither"` writes neither. The dimension holds no text of its
  own, so CAD measures it again in feet and inches when its points move, and a `text` such as
  `"<> CLR."` adds words to what it measures. The fraction is on the line. `suppressZeros` stays
  for decimal units, and a style has only the zeros of its own units.
- A standard's dimension style can take the names a firm's drawings already give it:
  `layoutName` on a layout, and `scaleNames`, by a scale's id, in model space. A dimension placed
  in the firm's drawing is then drawn by the firm's own definition of that style there.
  `defineStandard` refuses a name that CAD would take for another style of the standard, and the
  name `Standard`.
- Leaders, in R2018 drawings. `d.leaderStyle(definition)` defines a style with a text style, a
  text height, an arrowhead (`"closed-filled"`, `"open"`, `"dot"` or `"none"`), an arrow size, a
  landing, a gap, an attachment to the note's first or last line, and a scale.
  `d.leader(text, { style, at, to })` points a note of one line, or of the lines of an array, at
  one or more shafts that meet at `at`, each straight or bending through points of its own. The
  note goes on the side away from the first shaft unless `side` says otherwise, and a leader may
  set its own text style, text height, arrow size, landing, gap and attachment. Each is a
  multileader in the file, which a drafter edits with CAD's multileader commands. A leader goes
  in model space or on a layout, and not in a block. [docs/leaders.md](docs/leaders.md)
  describes them.
- `toSVG`, a drawing's extents and `inspectText` draw, measure and inspect each leader as CAD
  draws it. `leaderPicture(leader, style, textStyle)` gives what that is, and `leaderSizes`,
  `leaderSide`, `leaderAttachment`, `leaderOwnFlags` and `findLeaderStyle` the parts of it.
  `leaderArrowheadInfo` and `DEFAULT_LEADER_ARROWHEAD` say what each arrowhead is, and
  `leaderCount(drawing)` how many leaders a drawing has. `lineSpacing(height)` is the distance
  between the lines of a note.
- Handles: `leaderStyleHandle(name)`, `leaderStyleDictionaryHandle()` and
  `leaderArrowheadHandles(arrowhead)`, from names, as a dimension style's are.
- A standard lists leader styles in `leaderStyles`, each with a role and its sizes on paper, and
  names one in `defaultLeaderStyle`. Under a standard a leader names the style by its id, and in
  model space the view it is read in. The builder defines `NOTES-1in-10ft` for the style `notes`
  in a view at `1in-10ft`, and `NOTES` on a layout. `lint` holds each line of a leader's note to
  its role's height and to the least height, as it does a text.

Reading:

- `readDXF(input)` reads a DXF, given as a string or as its bytes in an
  `AsyncIterable<Uint8Array>`, as the bytes arrive and without holding the whole file. It gives
  a `DrawingRead`: the file's SHA-256, version and header, its layers, linetypes, text styles and
  dimension styles, its blocks with their attribute definitions and their lines, polylines,
  circles, arcs, texts and inserts, its xrefs, each layout with its paper, plot style table,
  viewports and inserts, the fields of its `MTEXT`, a census of what each space draws, and counts
  of what it did not understand. It keeps no text of model space or a layout. Text is decoded as
  UTF-8 from the 2007 format on and by `$DWGCODEPAGE` before it. A binary DXF is refused with a
  `ReadError`. [docs/reading.md](docs/reading.md) describes the model, and what it gains next.
- A package can add a reader of another format by naming it in its `package.json` under
  `"tsdraft": { "readers": { ".dwg": "./dist/read.js" } }`, with a module that exports
  `readDrawingFile(chunks, name)`. `checkDrawingRead(value)` lists what is wrong with a reader's
  answer. The `tsdraft` command finds the readers of the project whose tsdraft is running, and
  reads each file in a process of its own, within the limits
  [docs/command.md](docs/command.md#reading-drawing-files) gives. No command reads a file yet.

Bounded on any data:

- `lint`, `inspectText`, `toSVG` and `toDXF` take time in proportion to what a drawing holds, not
  to what it draws, whatever data they are given. Blocks may nest to any depth: a chain of 20,000
  blocks no longer overflows the stack, and no longer gives a viewport a false warning that it
  shows none of the drawing. Every list is read up to its first empty slot, where `lint` reports
  it, so a list such as `new Array(2 ** 32 - 1)` no longer hangs any of them.
- The extents take in the box of what each block's own entities draw, in the block's
  coordinates, where the inserts on the way put the box's corners. An insert that is not turned
  counts for what it draws, as before. A turned one may count for a little more, so `$EXTMAX` and
  `$EXTMIN` in the DXF and the frame `toSVG` gives model space can be larger, and they never
  leave out what is drawn. A block placed many times costs one read of it: a block of 800,000
  entities placed twice is boxed as fast as one placed once. Past the blocks the extents walk,
  an insert counts for the box of all its block draws, widened by what rounding can move a
  number on the way, which can move the last decimal the DXF writes. `lint` works the extents
  out as `toDXF` does, so `toDXF` refuses nothing `lint` passed.
- A list, an object or a long string that a drawing made in code shares among many places is
  read once by the extents, `toSVG` and `inspectText`. `lint` pays again for each place it reads
  it, as `toDXF` writes it again for each, and so it does for a string of 256 characters or more
  that many entities, definitions or values share, since `lint` quotes and `toDXF` writes it
  again for each. It also pays for the attributes each insert places past its first 64, an
  attribute definition's value by its length for each insert that repeats it, what each
  dimension reads from its style, and each block of a cycle. Its `check-capped` message names
  the lists that many places share. An object of the wrong shape that many places share, such as
  one with a long field name nobody knows or a long `kind`, is reported where it is first met,
  and not read again. Once `lint` or `inspectText` stops, it reads no entity past there. With a
  standard, the checks of layers, pens and text styles pay for a shared list and each error they
  give from it, and end with `standard-check-capped`.
- `inspectText` walks only what it checks: a text with something to draw, a dimension, a closed
  polyline, an attribute, and the inserts that lead to one. It pays for a text by its length
  before it reads it, and for each character of the texts, tags and layout names a warning
  quotes, so a drawing whose warnings would quote more text than it checks ends with
  `text-check-capped`, which now says where it stopped.
- `toSVG` throws a `RangeError` that names the insert or the viewport it stopped at when a
  picture would be longer than 500,000,000 characters, near the most a JavaScript string holds,
  or when its inserts would reach more than 2,000,000 blocks and entities that draw nothing, such
  as those on a layer that is off. Draw a part of such a drawing with `view`. A layout that holds
  more than about 120,000 entities no longer overflows the stack.
- A text is measured by its own value, height, point and justification, and by its style's font,
  width factor and oblique angle alone. A text style that holds other fields, which `lint`
  reports as an error, no longer changes how its texts measure.
- An item of a block's `attributes` that is not an object, such as `undefined` or a value beside
  an empty slot, draws nothing in the extents, `toSVG` and `inspectText`, where they threw a
  `TypeError`. `lint` reports it, as before.
- `lint` finds the field that a long unknown field name may be meant for without comparing it
  letter by letter with each field, which took seconds for a name of millions of characters.
- The library reads a `Proxy` as the data its traps give, calling them in proportion to what it
  reads. A trap that throws or never returns does so inside the call.
  [docs/rules.md](docs/rules.md), [docs/blocks.md](docs/blocks.md) and
  [docs/text.md](docs/text.md) state the limits.

The examples:

- `examples/plan-set` is a permit set for a made-up two-story house on a Florida canal lot: 15
  sheets on ARCH D, from the cover with the sheet index and code data through the site plan,
  floor and roof plans, elevations, sections, schedules, foundation and framing plans,
  structural details, and mechanical, electrical and plumbing sheets. It is one drawing with a
  layout for each sheet, and every sheet reads one house model, `model/house.ts`. The firm's
  border is a drawing of its own, placed on each layout as an xref, with the sheet's fields as
  the attributes of a block over it. Its leader notes are leaders, and its dimensions measure
  themselves in feet and inches. `node examples/plan-set/set.ts` writes the set's DXF, the
  border's DXF and an SVG of each sheet to `examples/out/plan-set/`. The project, owner, address
  and firm are fictional, and the set is an illustration, not a design to build from.
- The example sheet draws its layers, pens, text, symbols and dimensions from a standard of its
  own, which extends the built-in one with `V-TREE`, on the built-in sheet format `arch-d` with
  the standard's title block. It dimensions its building's west wall in feet and inches, and has
  two leaders, one with two shafts.

## 0.5.2

Every R2018 DXF changes by one value, group 340 of the dimension style `Standard`; nothing
else a drawing writes changes. The rest is new.

- `checkIntent(drawing, intent)` checks a drawing against what it is meant to hold to, given
  as data beside it, and returns warnings. Its one check is setbacks: `intent.setbacks` names
  a property line and its footprints by their ids, as closed polylines of model space, with
  one setback for every side or one for each side in the order of the property line's points.
  `footprint-in-setback` warns of a footprint nearer a side than its setback, with the `side`,
  the `required` setback and the distance `provided`, measured in drawing units from the side
  itself to the footprint's outline, from the points as the drawing holds them and with a
  tolerance for the arithmetic alone. `footprint-off-property` warns of a footprint not wholly
  inside its property line, and `intent-unchecked` says what part of the intent could not be
  checked and why, such as an id that names nothing, a field it does not know or an outline
  that crosses or touches itself, worked out exactly for the doubles held, so a lot with a
  hole is not checked. A point that repeats the one before it is the same corner. Each warning
  about a setback gives `item`, its path in the intent, such as `setbacks[0]`. The work and
  the number of warnings are bounded. It never changes what `lint` reports or what `toDXF`
  writes. [docs/intent.md](docs/intent.md) describes it.
- `tsdraft render` and `tsdraft dev` check a drawing file's export `intent` on each build and
  put the warnings in `diagnostics` after those of `inspectText`, with `item`, `side`,
  `required` and `provided` where they apply. They never change the exit code, and
  `timings.intent` gives the time the check took. `schema` stays 3. The example sheet exports
  the setbacks of its residence, and its lot and residence have the ids `lot` and
  `residence`.
- The dimension style `Standard`, which every R2018 DXF holds, names the text style
  `Standard`. It named none, and AutoCAD draws no text for a dimension in a style with no
  text style: once `Standard` was made current, a dimension a drafter drew in it with
  `DIMLINEAR` had no text. That one value, group 340 of the style, is new in every R2018 DXF.

## 0.5.1

This release has breaking changes, though its number is a patch's. A project that depends on
`^0.5.0` gets them on its next install:

- Breaking: `LintRule` gained `layout`, `duplicate-layout`, `viewport`, `dimension-style`,
  `duplicate-dimension-style`, `undefined-dimension-style` and `dimension`. Code that switches
  over every rule needs them.
- Breaking: a drawing with a block named `_ArchTick`, in any case of its letters, is refused.
- Breaking: the `tsdraft` command's JSON has `schema` 3, and an entry of `pngFonts` has no
  `sameWidths`.
- Breaking: `toSVG` writes each `<text>` differently: with a `textLength`, with no
  `text-anchor`, and with an SHX text sized as a TrueType text is. Times New Roman, Georgia,
  Trebuchet MS and Calibri are drawn smaller, and `FONTS[font].capHeight` moves for them. A
  drawing's extents move for every drawing with a text, and with them the `viewBox`,
  `$EXTMIN`, `$EXTMAX` and the view a DXF opens on.
- Breaking: `sitePlan(ratio)` in the example returns where the parts of the sheet lie on the
  paper, and the view title's attributes are tagged `VIEW_TITLE` and `VIEW_SCALE`.

The rest:

- Linear and aligned dimensions, in R2018 drawings. `d.linearDimension(from, to, line,
  { style })` measures between two points along X, along Y with `along: "y"`, or along an
  angle, with its dimension line through `line`. `d.alignedDimension(from, to, offset,
  { style })` measures along the two points. Each is a dimension in the file, which AutoCAD
  measures again when its points move, and takes a `text` in which `<>` stands for the
  measurement, and an `id`. A dimension goes in model space or on a layout. The angle of a
  linear dimension is from -360 to 360, and is kept as the one from 0 up to 360 that gives the
  same direction. [docs/dimensions.md](docs/dimensions.md) describes all of it.
- The file holds each dimension's picture in a block of its own, as AutoCAD draws it: its
  extension lines, its dimension line, its arrowheads and its text. AutoCAD shows that
  picture, and so does a drawing that attaches the file as an xref or inserts it as a block,
  where AutoCAD draws nothing for a dimension that has none. AutoCAD draws a new picture when
  the dimension changes. `dimensionPictureHandles({ id, layout, index })` gives the handles of
  the block and of what it holds, which come from the dimension's id, or from its place for one
  without an id.
- `d.dimensionStyle({ name, textStyle, textHeight, arrowhead, arrowSize, extensionOffset,
  extensionBeyond, textGap, scale, precision, prefix, suffix, suppressZeros,
  measurementScale })` defines the style a dimension names. Its sizes are the sizes that
  plot, and `scale` multiplies them for the view, as `fromPaper(1, "in", view)` gives it.
  `ARROWHEADS` lists the two arrowheads, `"closed-filled"` and `"architectural-tick"`. The
  text is above the dimension line, between the extension lines, and the measurement is a
  decimal number.
- `toSVG` draws each dimension as AutoCAD does, in model space, through a viewport and on a
  sheet, with the string AutoCAD writes, and a drawing's extents take dimensions in.
  `dimensionPicture(dimension, style)` gives the lines, the arrowheads, the string and its
  place, `findDimensionStyle(drawing, name)` the style, and `dimensionAngle(dimension)` the
  angle a linear dimension measures along, from 0 up to 360. A measurement is rounded half up,
  and a value a little under the half is taken as on it: within a ten-billionth of itself
  under 1, and from 1 up within a ten-billionth and one and a half units in the 16th
  significant digit, so 1234567.15 is written `1234567.2`, as AutoCAD writes it. The command's JSON lists each
  dimension under `drawing.dimensions` and under a layout's `dimensions`, with its `id`, the
  `measurement` and the `text`. `inspectText` takes a dimension's text for a text where its
  picture puts it, so it warns of a text over it.
- New rules, each a compile error for a literal where it can be, an error at the builder's
  call, and a `lint` error under `dimension-style`, `duplicate-dimension-style`,
  `undefined-dimension-style` or `dimension`. A style's name follows a layer's rules, and no
  two styles have names AutoCAD takes for one. `Standard` is neither defined nor named. A
  style's text style is defined, its text height is greater than 0, its arrow size, extension
  lengths and gap are 0 or more, its scales are greater than 0 and its precision is a whole
  number from 0 to 8: AutoCAD's `AUDIT` reports most of the others, and draws a box around
  the text for a negative gap. A prefix, a suffix and a dimension's text have none of `\`,
  `{` and `}`, which AutoCAD reads as formatting. A dimension names a style the drawing
  defines, since AutoCAD discards a drawing with one that does not. It measures something,
  writes a number under 100,000,000 with no more than 15 digits once rounded, since
  AutoCAD works the 16th out from its own arithmetic, and with closed filled arrowheads has
  room for the widest its text can be in any font, and for the lean of a slanted style, since
  AutoCAD turns the arrowheads outward by the width of the text in its font. Every size of a
  style times its scale, and every number a dimension draws, is under 1e100, and a text
  height or an arrow size other than 0 times the scale is not written as 0. A linear
  dimension measures along an angle from -360 to 360. It is not in a block, where AutoCAD
  draws nothing for it. An R12 drawing with a dimension is refused.
- A block cannot be named `_ArchTick`, in any case of its letters. AutoCAD draws a
  dimension's architectural tick with the block of that name. A drawing that has such a
  block is now refused.
- `Drawing` gains `dimensionStyles`, and its entities the kinds `"linear-dimension"` and
  `"aligned-dimension"`. `toJSON` and `fromJSON` carry them. A drawing with no dimension has
  the DXF, the JSON and the SVG it had.
- `dimensionStyleHandle(name)` gives the handle of a dimension style, which comes from its
  name, and `arrowheadHandles(arrowhead)` those of an arrowhead's block.
- The example sheet, `examples/site-plan.ts`, draws its dimensions as dimensions, in a style
  with the scale of its view.
- `measureText` gives the length a text plots at and the box its capitals fill, from its
  value, height, font, width factor, oblique angle, point, rotation and justification:
  `measureText({ value: "GENERAL NOTES", height: 0.125 }).length`. It reads `FONT_METRICS`,
  also exported, which holds the widths of each font's characters from U+0020 to U+007E and
  U+00A0 to U+00FF. Any other character is taken to be as wide as `?`, `%%d`, `%%p` and
  `%%c` count as the one character each draws, and the result then has `approximate: true`.
  Lay out columns and break lines with it: a capital of `txt.shx` moves a text on by its whole
  height, not by the 0.6 of it a screen's monospaced font takes.
  [docs/text.md](docs/text.md#how-long-a-text-is) has the rest.
- `toSVG` draws every text as long as it plots. A `<text>` starts where `measureText` starts
  it and has a `textLength` with `lengthAdjust="spacingAndGlyphs"`, so a renderer draws it to
  that length in whatever typeface it has, and `xml:space="preserve"`, so its spaces are
  kept. It has no `text-anchor` any more: a centered or right-justified text is moved back
  along its line in its `transform`. An SHX text was drawn at a font size equal to its height,
  which made its capitals about 0.7 of that: it is now sized as a TrueType text is, so that
  its capitals are the text's height in a font whose capitals are 0.7 of its size. Each
  `<text>` has that height in `data-height`. `%%d`, `%%p` and `%%c` are drawn as the degree,
  plus-or-minus and diameter signs AutoCAD draws for them.
- A drawing's extents take a text's box from `measureText`, in place of 0.6 of its height for
  each character, and count what its font draws below the baseline. The `viewBox` of `toSVG`,
  `$EXTMIN` and `$EXTMAX` and the view a DXF opens on move for every drawing with a text.
  Nothing else in a DXF changes.
- `inspectText(drawing)` warns about text that plots badly, which no rule of the file forbids:
  `text-overlaps-text` for two texts that lie over each other, `text-leaves-boundary` for a
  text that starts inside a closed polyline and runs past it, such as a note past the sheet's
  border or a value out of its cell, and `text-off-paper` for a text that runs off a layout's
  paper. Each warning has the box of the text as it plots and names the other text or the
  polyline. A text inside a block is named by its insert, and by its tag when it is an
  attribute. `lint` and `toDXF` are as they were.
  [docs/text.md](docs/text.md#text-as-it-plots) has the rest.
- `toSVG(drawing, { view: [x0, y0, x1, y1] })` draws one rectangle of model space, or of a
  layout with `layout`, in place of the whole. A layout's viewports are cut to it.
- `tsdraft render <file> --view x0,y0,x1,y1 [--layout <name>]` writes that one rectangle as
  `<name>.view.svg` and `<name>.view.png`, listed in `outputs.view`, and no other picture. Use
  it to read small text: a whole ARCH D sheet at 1600 px draws a 3/32 inch note 4 px high.
- The `tsdraft` command's JSON has `schema` 3. `diagnostics` holds the warnings of
  `inspectText` after what `lint` reported, each with its `bounds` and with `other`, and they
  do not change the exit code. `outputs` has `view`, which is `null` without `--view`. An entry
  of `pngFonts` has `font` and `face` and no `sameWidths`: a text is now as long in a PNG as it
  plots in every typeface, and its capitals are as tall, because the renderer sizes each text
  by the cap height of the typeface it draws it in, read from the font's file. `timings` has
  `inspect`.
- The example sheet lays out its columns and line breaks with `measureText`, and `textWidth`
  in `examples/lib/drafting.ts` takes a font in place of a width per character.
- A drawing's extents take in the lean of a slanted text. AutoCAD draws the top of a text
  whose style has an oblique angle further along the text by its height times the tangent
  of the angle, and what it draws below the baseline further back. The extents left that
  out, so the `viewBox` of `toSVG`, `$EXTMIN` and `$EXTMAX` and the view a DXF opens on cut
  the lean off, and `lint` warned that a viewport shows none of the drawing when a slanted
  text leaned into it. Those numbers move for a drawing with a slanted text, and for no
  other.
- `toSVG` slants a text after it widens it, as AutoCAD does. It widened the lean by the
  style's width factor, so a text with both an oblique angle and a width factor other than
  1 leaned too far or not far enough. Its `transform` now has `skewX` before `scale`.
- `toSVG` draws Times New Roman, Georgia, Trebuchet MS and Calibri at the size AutoCAD does.
  AutoCAD makes a font's capital `A` as tall as the text's height, and tsdraft sized these
  four by a lower capital, so their text was 2.3%, 1.4%, 1.4% and 0.4% too large. The
  `font-size` of a text in one of them moves, and so does `FONTS[font].capHeight`. The other
  six TrueType fonts were within 0.05%, and stay as they were.
- Layouts, in R2018 drawings. `d.layout(name, { paper, plotStyle }, draw)` adds a sheet of
  paper that AutoCAD shows as a tab and plots as one page, and what `draw` draws goes on it,
  in paper units: lines, circles, arcs, polylines, texts and inserts of blocks and of xrefs.
  `draw` is given the sheet, and `sheet.viewport(corner, width, height, { center, ratio, id })`
  shows model space on it in a locked rectangle, at the ratio `fromPaper` takes. A drawing
  has any number of layouts and opens on the first. Each has a page setup: `DWG To PDF.pc3`,
  its paper, the layout at 1:1, lineweights plotted, and `monochrome.ctb` or `acad.ctb`.
  [docs/layouts.md](docs/layouts.md) describes all of it.
- `PAPERS` lists the papers a layout may have, with the name AutoCAD stores for each, its
  size and the part of it that prints: `ARCH A` to `ARCH D` and `ANSI A` to `ANSI D`, full
  bleed and landscape.
- New rules, each a compile error for a literal, an error at the builder's call, and a `lint`
  error under `layout`, `duplicate-layout` or `viewport`: a layout's name is not empty, not
  `Model`, at most 255 characters, with none of `< > / \ " : ; ? * | , =` and the backtick
  and no space at either end, as AutoCAD's `LAYOUT` command holds one; no two layouts have
  names AutoCAD takes for one, since its `AUDIT` then reports a layout as missing; a paper is
  one of `PAPERS` and a plot style table one of the two; a viewport has a size and a ratio
  greater than 0; a layout is not defined inside a block or a layout, nor a block inside a
  layout. `lint` warns of a viewport that reaches past the paper and of one that shows none
  of the drawing. An R12 drawing with a layout is refused.
- `toSVG(drawing, { layout: name })` draws a sheet as it plots: the paper, each viewport's
  view of model space at its scale and clipped to its rectangle, and what is on the sheet,
  with every line as wide as its lineweight and the colors its plot style table plots.
  Without `layout`, `toSVG` draws model space as before.
- `viewportView` gives the box of model space a viewport shows and its scale, and
  `layoutHandles` the handles of a layout's own objects, which come from its name. A viewport or an entity of a sheet with an id has the handle `idHandle`
  gives.
- `Drawing` gains `layouts`, each a `name`, a `paper`, `viewports` and `entities`. `toJSON`
  and `fromJSON` carry them. A drawing with no layout has the DXF, the JSON and the SVG it
  had before. `Diagnostic` gains `layout` and `viewport`.
- `lint` reports a layout, a viewport or an entity of a sheet that does not have its shape, as
  it reports any other value: under `layout`, `viewport` or `format`, with the path to the
  value, a hint for a field nobody knows, and `item`, such as `layouts[0].viewports[1]`. The
  command leaves such an item out of the pictures and lists it in `drawing.omitted`: a layout
  whole, or one viewport or one entity of it.
- `tsdraft render` and `tsdraft dev` draw each layout as well as model space. The JSON gains
  `drawing.layouts`, with each layout's paper and size and each viewport's rectangle, ratio,
  center and the box of model space it shows, `drawing.counts.layouts`, and
  `outputs.layouts`, a picture of each sheet. `render` writes `<name>.layout-<layout>.svg`
  and `.png`. The page of `dev` has a tab for each layout and opens on the first. `schema`
  stays 2: no field changed its meaning.
- The command draws PNGs in a process of its own, so a fault in the renderer no longer ends
  the command. The picture the renderer stopped on has `"png": null` and a `pngError` that
  says so, `outputs.pngError` for model space and the `pngError` of its entry in
  `outputs.layouts` for a sheet. Every other picture, the diagnostics and the exit code are
  as they would have been. The same holds when the renderer's process cannot start.
- Fixed: the extents of a text turned by an angle that is not a multiple of 90 degrees left
  out its far corner, the one above the end of its line. A drawing whose outermost entity is
  such a text, or an insert that turns one, now has an `$EXTMIN` and `$EXTMAX` that reach
  that corner, opens zoomed to a slightly larger view, and has a slightly larger `viewBox`
  in `toSVG`. Nothing else in its files changes.
- The example sheet is laid out in two spaces. Model space holds the site at its true size,
  with the bearings, dimensions and labels that are read in the plan. The layout `C-101`, on
  `ARCH D`, holds the sheet in inches: the border, a title block, the column of notes, the
  legend, the view's title, the north arrow and the graphic scale, and one viewport that
  shows the plan at 1" = 10'. Its linetype scale is a length of paper, 1/2, because AutoCAD
  sizes dashes on the paper in a viewport. `sitePlan(ratio)` now returns where the parts of
  the sheet lie on the paper and what its viewport shows, in place of the three rectangles
  in drawing units.
- The example's title block is a block, `TITLE BLOCK`, with an attribute for each field: the
  project, the sheet's title and number, the date, the scale, and who drew and checked it,
  beside a table for revisions and an area for a seal. The insert on the layout gives each
  field its value, and AutoCAD's `-ATTEDIT` changes one. The view title's attributes are now
  tagged `VIEW_TITLE` and `VIEW_SCALE`, so no tag names two fields of the sheet. [docs/title-blocks.md](docs/title-blocks.md)
  shows how to draw one, and how to put a firm's own border under a sheet as an xref on its
  layout, with the sheet's fields over it and what the border's file may hold.
- `tsdraft render` and `tsdraft dev`: each layout of `drawing.layouts` gains `inserts`, the
  inserts on its sheet with the value of each attribute, so the fields of a title block are
  in the JSON. The `inserts` count of a block and of an xref now counts inserts on layouts.
- A PNG from the command sets a TrueType font in its own letters where the machine has the
  font, or one made to its widths: Liberation Sans for Arial, Liberation Serif for Times New
  Roman, Liberation Mono for Courier New. Before, every text was in the renderer's own
  monospaced typeface, wider than it plots. `outputs.pngFonts`, and the `pngFonts` of each
  entry of `outputs.layouts`, say which typeface the PNG sets each font of the picture in,
  and whether a text in it is as wide as it plots. An SHX font never is. `schema` stays 2.
- `tsdraft dev` redraws sooner after a save, in about half the time for the example sheet
  and less for a small drawing, when the drawing imports the tsdraft the command is part of.
  A process that waits for a save now loads that library ahead, and a build uses it only
  after the library's files are checked against the disk. A drawing that imports another
  copy of tsdraft builds as before. Each build still runs in a process of its own and reads
  the drawing file and its imports as saved. The JSON, the pictures, the diagnostics and
  the exit codes are unchanged, and so is `tsdraft render`.
  [docs/command.md](docs/command.md#speed) has the details and the memory this takes.

## 0.5.0

- `lint` takes any plain data and never throws. It threw a `TypeError` for a drawing written
  by hand with a list that is not an array, a `null` layer or entity, or a field of the wrong
  type, such as a line with `from: 5`, and reported nothing for an entity of an unknown `kind`,
  a `dxf` that is not a version, or a list with an empty slot. Each is now an error with the
  path to the value, such as `entities[3].from must be a point, [x, y]`, in the words
  `fromJSON` uses, and the message for an unknown `kind` lists the kinds. So `toDXF` refuses
  such a drawing with a `DrawingError`. The rule is `format`, or `linetype`, `text-style`,
  `block` or `attribute` for a value in that list.
- A wrong type in a geometry field now reports under `format` with its path, where it reported
  under `geometry`: a `radius`, `height`, `rotation` or angle that is not a number, and a point
  such as `[1, "x"]`. A missing one says the field is missing. A number that is `NaN` or too
  large still reports under `geometry`.
- `lint` reports a field no object of its type has, such as `colour` on a layer or `thickness`
  on an entity, which the writers would drop. The message names the field it is closest to:
  `layers[1]: unknown field "colour". Did you mean "color"?` A field of another kind of
  object, such as `scale` on a text, gets no hint. `fromJSON` gives the same hint.
- A diagnostic about the shape of a value has `item`, the path of the item that holds it, such
  as `entities[3]` or `blocks[0]`. A diagnostic's `linetype`, `textStyle` and `block` are set
  only when the name is a string, and a message shows a value that is not a string by its
  type.
- `toSVG` draws dashes at a scale of 1 when the drawing's `linetypeScale` is not a positive
  finite number, as AutoCAD reads a scale of 0 or less as 1. With a negative scale and a dashed
  linetype it never finished, and ran out of memory.
- `tsdraft render` and `tsdraft dev` give these diagnostics where the build failed with none.
  When the drawing cannot be drawn with an item `lint` reports, the pictures show the rest,
  and `drawing.omitted` in the JSON lists what they leave out.
- An R2018 DXF has `$XEDIT` 0 in its header. A DWG that AutoCAD saves from the file keeps the
  setting, so a drawing that references that DWG cannot edit it in place and lose the edit
  when the file is written again. Setting `XEDIT` to 1 and saving allows the edit, in a file
  you no longer write from a script. Every R2018 DXF changes by this one variable. An R12 DXF
  does not state it, so AutoCAD opens one with `XEDIT` 1, and a DWG saved from it can still be
  edited in place.
- Xrefs, in R2018 drawings. `d.xref(name, path)` references another drawing's DWG file, and
  `d.insert(name, at, options)` places it as it places a block, with a scale, a rotation and
  an id, any number of times. AutoCAD loads the file each time it opens the drawing. The path
  leads from the folder of the drawing's file, and the xref is written as an overlay.
  [docs/xrefs.md](docs/xrefs.md) describes all of it.
- New rules, each a compile error for a literal, an error at the builder's call, and a `lint`
  error under `xref`: an xref's name is a block name that no block and no other xref has,
  since AutoCAD discards a drawing with two such names or makes one xref of them; its path is
  not empty, does not end in `.dxf` or in a dot, is not absolute, holds none of
  `* ? < > | : "`, no `\M+` escape and no character a text cannot hold, and is at most 32,000
  characters; an xref has no entities, base point
  or attribute definitions; and an insert of one sets no attributes. `lint` warns of an xref
  that no insert places, which AutoCAD purges. An R12 drawing with an xref is refused.
- `toSVG` takes the drawings that xrefs stand for, as `toSVG(drawing, { xrefs: { BASE: base } })`,
  and draws each where its inserts put it, on its own layers. An xref with no drawing given
  draws nothing. `findXref` gives the xref an insert places.
- `Drawing` gains `xrefs`, each a `name` and a `path`. `toJSON` and `fromJSON` carry them. A
  drawing with no xref has the DXF, the JSON and the SVG it had before. `Diagnostic` gains
  `xref`.
- `tsdraft render` and `tsdraft dev` report `drawing.xrefs`, with whether the pictures show
  each one and the units of the drawing given for it, and `drawing.counts.xrefs`. A drawing
  file's named export `xrefs` gives the drawings to draw. Each is checked by `lint`, and one
  with an error is reported and not drawn.
- `lint` reports a drawing whose `blocks` or `xrefs` is not an array.

- Blocks, inserts and attributes, in R2018 drawings. `d.block(name, options, draw)` defines a
  block from what `draw` draws, with a base point. `d.insert(block, at, options)` places one,
  with a scale along X and along Y, a rotation, an id and a value for each attribute it sets.
  `d.attribute(tag, at, options)` adds an attribute definition to the block being drawn: a
  tag, a prompt, a default value, and the height, rotation, style and justification of a
  text. A block may hold inserts of blocks defined before it. AutoCAD holds an insert's
  attributes as attributes, which a drafter edits there. [docs/blocks.md](docs/blocks.md)
  describes all of it.
- An entity on layer `0` of a block draws as the layer of each insert does, and an entity on
  any other layer as its own, as in AutoCAD. An insert on a frozen layer draws nothing, and
  neither does one on a layer that does not plot.
- New rules, each a compile error for a literal, an error at the builder's call, and a `lint`
  error: block names follow the rules of layer names; no two blocks have names AutoCAD takes
  for one, since it would put the entities of both in one block and report nothing; an insert
  names a defined block; a block holds no insert of itself; a scale is not 0, which AutoCAD
  reads as 1; a tag is not empty and is in capitals; a block has one definition for a tag; an
  insert sets only tags its block defines; and an uneven scale may not slant or widen an
  attribute past what AutoCAD's `AUDIT` takes. The rules are `block`, `duplicate-block`,
  `undefined-block`, `block-cycle`, `attribute`, `duplicate-attribute` and
  `undefined-attribute`. An R12 drawing with a block is refused.
- A block's own objects, its attribute definitions, and the attributes of an insert that has
  an id take handles from their names, so they keep them when the drawing around them
  changes. `blockHandle`, `attributeDefinitionHandle`, `attributeHandle` and
  `attributesEndHandle` give them, and `findBlock` gives the block an insert places. Ids are unique across the whole drawing, in blocks and out.
- `toSVG` draws an insert as a group with its block's entities where the insert puts them, and
  its attributes as text, and the extents take inserts in. `placeAttribute` gives the text an
  insert makes of an attribute definition.
- `Drawing` gains `blocks`, and the entity kind `"insert"`. `toJSON` and `fromJSON` carry
  them. A drawing with no block has the DXF and the JSON it had before. `Diagnostic` gains
  `block` and `attribute`.
- `tsdraft render` and `tsdraft dev` report `drawing.blocks`, `drawing.inserts` and
  `drawing.counts.blocks`.
- The example sheet draws its trees, property corners, north arrow and view title as blocks,
  with the view title's text and scale as attributes.

- The example sheet, `examples/site-plan.ts`, is laid out as a landscape ARCH D
  sheet. The sheet, 24 by 36 inches and landscape, with a 1/2 inch margin, is a
  parameter, and its rectangle and drawing area are worked out in drawing units
  through `fromPaper`. The plan is centered in the left 27 inches of the
  drawing area, with the north arrow, view title and graphic scale under it at
  the lower left. A column 7 inches wide at the right holds the site data,
  general notes, legend and abbreviations. The lower right corner, 6 1/2 by 3
  inches, is kept clear for a title block. The sheet holds the plan at 1" = 10'
  and at 1" = 20'. At a larger scale the plan is taller than the sheet.
  `sitePlan(ratio)` builds the sheet at a ratio, and the picture in
  `examples/README.md` is framed on the sheet.
- The package now has a command, `tsdraft`. `npx tsdraft render <file>` builds a drawing
  file once, writes its SVG and PNG, and prints the build as JSON with what `lint` found.
  `npx tsdraft dev <file>` serves a live preview that redraws on every save, and the same JSON
  and pictures over HTTP. The command needs Node 22.18 or later, which runs the drawing file by
  stripping its types, and says so on an older Node. The library still needs Node 22.
  [docs/command.md](docs/command.md) describes it.
- [GUIDE.md](GUIDE.md), which ships in the package, tells an agent how to work with tsdraft.
- The package has one dependency, `@resvg/resvg-js`, which draws the command's PNG. It is
  optional and the library never loads it. Without it the command still writes the SVG and the
  JSON, and `outputs.pngError` in the JSON says why there is no PNG.
- The library is unchanged: `import "tsdraft"` loads no Node module and nothing of the command.
- An entity's id gives its handle in an R2018 DXF. AutoCAD names an object by
  its handle, and a dimension that another drawing puts on an entity through
  an xref holds that handle and nothing else. An entity with an id now keeps
  its handle when entities, layers, linetypes and text styles are added,
  removed or reordered, and when the entity itself changes. A dimension on
  the ends of a line or the quadrants of a circle then follows the entity
  when it moves and the xref is reloaded. An entity with no id is numbered in
  file order as before, and a drawing in which no entity has an id is written
  byte for byte as before. Giving an id to an entity that had none moves its
  handle once. [docs/format.md](docs/format.md#an-id-gives-a-handle) has the
  formula.
- `idHandle(id)` returns the handle an id gives, as DXF writes it, and throws
  on a string that is not a valid id. What it returns for an id will not
  change in any later version.
- New rule `id-handle`, a builder error and a `lint` error: two ids that give
  one handle. AutoCAD discards a drawing in which two objects have one handle.
  Among a million ids the chance is about 1 in 10,000, and the message names
  both ids.
- Text styles. `d.textStyle({ name, font, widthFactor, obliqueAngle })` defines
  one, and a text names it in `style` or is given the definition in its place.
  `Standard` is in every drawing, with the font `txt.shx`. A style has no height
  of its own, so each text keeps its height. R2018 only.
- Fonts. `FONTS` lists the fonts a style may have, by the name AutoCAD stores:
  an SHX font by its file name, a TrueType font by its typeface. It holds
  eleven SHX fonts that AutoCAD 2025 installs, such as `txt.shx`, `romans.shx`
  and `isocp.shx`, and ten TrueType fonts that Windows installs, such as
  `Arial`, `Calibri` and `Times New Roman`. [docs/text.md](docs/text.md) lists
  them. A font outside the list is a compile error as a literal, a builder
  error and a `lint` error, because AutoCAD draws text in a font it does not
  have in another font, and its `AUDIT` reports nothing.
- New rules for text styles, each a builder error and a `lint` error, and a
  compile error where the literal shows it. A style name follows the rules of
  a layer name: AutoCAD discards a drawing over a name it refuses, and its
  `AUDIT` reports two names it takes for one. `Standard` cannot be defined:
  AutoCAD keeps the first style of a name. A width factor is from 0.01 to 100,
  the range AutoCAD's `STYLE` command takes: `AUDIT` reports a style with a
  width factor of 0 or less, of 0.0001 or of 1000000. An oblique angle is from
  -85 to 85 degrees: `AUDIT` reports a style or a text slanted further. A text
  names a style the drawing defines: AutoCAD puts a text in a
  style it does not have in `Standard`, and reports nothing.
- Justification. A text takes `align`, `"left"`, `"center"` or `"right"`, and
  `valign`, `"baseline"`, `"bottom"`, `"middle"` or `"top"`, and `at` is then
  the point it is justified to. R2018 only.
- `toSVG` anchors a text at its justification point, draws its style's width
  factor and oblique angle, and sets a CSS font family for its font, ending in
  a generic family. A TrueType text is drawn at the size that makes its
  capitals the text's height. The extents `toSVG` frames, and the ones
  `toDXF` writes, follow a text's justification and its style's width factor.
- Breaking: `LintRule` gained `text-style`, `duplicate-text-style`,
  `undefined-text-style` and `text-align`, and a `Diagnostic` about a style's
  definition names it in `textStyle`.
- A `Drawing` has `textStyles`, and a text has `style`, `align` and `valign`,
  each left out at its default. `toJSON` and `fromJSON` carry them. A drawing
  that uses none of them is written to JSON and DXF as before.
- `examples/site-plan.ts` draws its text in a text style with the font Arial,
  and justifies centered and right-aligned text where it used to place it from
  an estimated width.
- [docs/text.md](docs/text.md) describes styles, fonts and justification.
- `toSVG` draws a layer in the color AutoCAD plots its index in, for every index
  from 1 to 255. It knew 1 to 6 and drew the rest in `currentColor`. Index 7
  stays `currentColor`: it is black on paper and white on a dark screen.
- Breaking: `toSVG` leaves out a layer whose `plot` is false, as it leaves out
  one that is off or frozen, so the picture is the drawing as it plots.
  `toSVG(drawing, { drawNoPlot: true })` draws those layers too.

## 0.4.0

- `fromPaper(length, "in" | "mm", { ratio, units })` turns a length on paper
  into drawing units, to size text, symbols and dashes by how large they plot:
  `fromPaper(3 / 32, "in", { ratio: 96, units: "ft" })` is 0.75. A wrong unit,
  and a length or ratio of 0 or less, are compile errors as literals and thrown
  errors otherwise. A result that would be written as 0, or is 1e100 or more,
  throws.
- `examples/site-plan.ts` is now the example sheet: a permit-style site plan for
  an ARCH D sheet at 1" = 10', with property lines, setbacks, a building
  footprint, dimensions, labels, site data, notes and a legend. Every text
  height and annotation offset comes from `fromPaper`. Its default export is the drawing.
- Breaking: a `Drawing` has `format: 0`, its format version, which is separate
  from `dxf`. The builder sets it. A drawing written by hand needs it, and
  `lint` reports one without it under the new rule `format`. Format 0 carries
  no promise of stability.
- Breaking: `LintRule` gained `format`, `id` and `duplicate-id`. Code that
  switches over every rule, or uses `Record<LintRule, …>`, needs the three.
- `toJSON(drawing)` writes a drawing as canonical JSON: the same drawing gives
  the same string, whatever order its keys were set in.
- `fromJSON(json)` reads a drawing from a JSON string or a parsed value. It
  refuses a format version, a field or an entity kind it does not know, naming
  each, then runs `lint`, and throws a `DrawingError`.
- Entities take an `id` in their options: 1 to 64 letters, digits, `.`, `-` and
  `_`. A malformed id and a second entity with the same id are builder errors
  and `lint` errors, under the new rules `id` and `duplicate-id`. `toSVG` writes
  the id as `data-id`.
- A `Diagnostic` about an entity carries its `id`, and `call`, the file, line
  and column of the call that drew it, when the drawing was built with
  `createDrawing({ recordCalls: true })`. Setting
  `globalThis.TSDRAFT_RECORD_CALLS = true` before a drawing's code runs turns
  recording on for every builder that does not set the option, which is how a
  tool that runs drawing files asks for it.
- The builder's `layer`, `linetype` and entity methods now throw a
  `DrawingError` with the same message as before. Its diagnostic has the rule,
  the `id` and the `call` that broke it.
- [docs/format.md](docs/format.md) describes all of the above.

## 0.3.0

- Breaking: `createDrawing()` now targets DXF R2018. Pass `{ dxf: "R12" }` for
  R12, which gets no new features.
- Linetypes. `d.linetype({ name, description, pattern })` defines one, with
  dashes as positive lengths, gaps as negative ones and dots as 0. `DASHED`,
  `HIDDEN`, `CENTER`, `PHANTOM`, `DASHDOT` and `DOT` are exported with the
  patterns AutoCAD loads from its `acad.lin`. `Continuous`, `ByLayer` and
  `ByBlock` are in every drawing. `createDrawing({ linetypeScale })` sets
  `$LTSCALE`.
- Lineweights in millimetres, from AutoCAD's 24.
- Layers take a `linetype`, a `lineweight`, and `off`, `frozen`, `locked` and
  `plot`. Entities take a `linetype` and a `lineweight` of their own, and draw
  ByLayer otherwise, as before.
- `toSVG` draws dashes and pen weights, and leaves out layers that are off or
  frozen. Its `strokeWidth` is now the width of a 0.25 mm line.
- `toSVG` marks each entity's element with `data-entity`, its index in
  `drawing.entities`, beside `data-layer`.
- New rules, each a builder error and a `lint` error, and a compile error where
  the literal shows it:
  - a lineweight outside AutoCAD's list, which makes AutoCAD discard the drawing
    when an entity has it;
  - a linetype the drawing does not define, which makes AutoCAD discard it;
  - a pattern of one length, which `AUDIT` reports, or more than 12, which makes
    AutoCAD discard the drawing;
  - a pattern length that is not 0 but is written as 0, which would turn a dash
    or a gap into a dot, and a pattern whose lengths add up to 1e100 or more,
    because the total is written too;
  - defining `Continuous`, `ByLayer` or `ByBlock`, a layer whose linetype is
    `ByLayer` or `ByBlock`, and freezing layer `0`, which is the current layer;
  - a linetype scale of 0 or less, or one written as 0, which AutoCAD reads as
    1, and a description over 249 characters, where AutoCAD cuts it;
  - linetype names follow the rules of layer names, which AutoCAD holds them to,
    and a name that `AUDIT` would report as a duplicate of `Continuous`,
    `ByLayer` or `ByBlock`, such as one with a soft hyphen in it;
  - a description with a control character, an emoji or a private-use
    character from U+E800 to U+E8FF, as for text;
  - an R12 drawing that defines a linetype, sets a linetype scale, or gives a
    layer a linetype other than `Continuous`, a lineweight or a state, and an R12
    entity with a linetype or lineweight of its own. Each message says to use
    R2018.
- A layer or an entity can be given a definition in place of a linetype name.
  It is checked as `linetype()` checks one, and is defined if the drawing does
  not have the name. If the drawing has the name with another pattern or
  description, the builder throws: change a linetype with `linetype()`.
- `lint` has the rules `linetype`, `duplicate-linetype`, `undefined-linetype`,
  `lineweight` and `layer-state`, and a diagnostic names its `linetype`.

## 0.2.2

- Fixed: AutoCAD keeps two layers such as `straße` and `STRASSE` apart, but its
  `AUDIT` reports them as a duplicate name. `lint` now reports the second layer
  as a duplicate, and the builder throws at the `layer()` call. It does so for
  these kinds of pair, in either letter case and inside longer names:
  - a letter and the letters it stands for, such as `ß` and `ss`, `æ` and `ae`,
    `œ` and `oe`, `ĳ` and `ij`, `ﬁ` and `fi`, `ǆ` and `dž`, and `þ` and `th`;
  - a composed character and its decomposed form, such as `é`;
  - a name with a soft hyphen inside it or in front of it and the same name
    without.

  This is not all that `AUDIT` reports. The README lists what is covered and
  what is left out.

- When an entity names its layer by the other spelling of such a pair, the
  undefined-layer error now says which declared layer AutoCAD does not take it
  for. AutoCAD adds a layer for the entity, and `AUDIT` reports a duplicate name.

## 0.2.1

- Fixed: text holding `\U+XXXX` or `\M+NXXXX` came out in AutoCAD as the
  character those escapes stand for, so `\U+00B0` became a degree sign and
  `\U+000A` put a line feed inside a single-line text. Both DXF versions now
  write such a backslash so that AutoCAD holds the text as the drawing has it
  when it opens the file. AutoCAD decodes the text after all once it has saved
  the drawing itself and opened it again: `\M+NXXXX` after a save as DWG, and
  `\U+XXXX` too after a save as DXF.
- Fixed: a size too small for the 6 decimals tsdraft writes was written as 0.
  AutoCAD gave such a text its default height, and held such a circle or arc
  with radius 0. A radius, text height or rectangle size that would be written
  as 0 is now an error, in the compiler for a literal and when the code runs.
  `rect()` also throws when a side is lost because two corners round together.
- Fixed: AutoCAD reads only two exponent digits from DXF, so it took a number
  written as `1e+100` for `1e+10`, with no `AUDIT` error. A coordinate, size or
  text rotation of 1e100 or more is now an error, in the compiler for a size
  written as a literal and when the code runs. The R2018 writer also caps the
  extents and the view height it works out, which could pass 1e100 for a
  drawing whose own numbers are all smaller.
- Fixed: an arc within 0.000001 degrees of a full turn was written with equal
  angles, which AutoCAD holds as an arc of no length. It is now an error. An arc
  angle that rounds up to 360 is written as 0.
- Fixed: `toDXF` wrote layer `0` wherever the drawing listed it, and `AUDIT`
  reported "Layer zero name found at incorrect index" when another layer came
  first. Layer `0` is now written first.
- Fixed: `lint` matched layer names with JavaScript's `toLowerCase()`, which
  AutoCAD does not use. It accepted an entity on `οδος` for a layer `ΟΔΟΣ`,
  where AutoCAD makes a second layer. `lint` and the builder now compare names
  as AutoCAD does. The README lists the pairs that differ.
- Fixed: two layers such as `ΟΔΟΣ` and `οδος`, which AutoCAD keeps apart but
  its `AUDIT` reports as a duplicate name, are now an error.
- Fixed: AutoCAD discarded a drawing whose layer name had a zero-width space,
  another invisible formatting character, a letterlike symbol such as the ohm
  sign U+2126, or a Glagolitic, Coptic, Tifinagh, Georgian Supplement, Latin
  Extended-C or Ethiopic Extended letter. Those names are now errors, in the
  compiler for a literal and when the code runs. The README lists them.
- Fixed: `lint` threw a `RangeError` on a polyline of about 100,000 points or
  more.
- Fixed: a layer name that starts or ends with a no-break space, or another
  space outside ASCII, threw when the code ran, though the compiler accepted
  the literal and AutoCAD accepts the name. Only an ASCII space is refused now.
- Fixed: AutoCAD replaced the private-use characters U+E800 to U+E8FF in text
  and layer names. They are now errors.
- Fixed: `toSVG` drew nothing for an arc so close to a full turn that its ends
  rounded to one point, and ignored a layer's color when an entity spelled the
  layer's name in another case.
- Changed: a `DrawingError` message starts "The drawing has 3 problems:" and no
  longer names DXF, because code other than `toDXF` uses it to refuse a drawing.
- Changed: `lint` messages for a bad radius or height read "radius: This value
  must be greater than 0", the wording the compiler uses for a literal.
- `lint` warns about a polyline or an arc with no length, as it does for a line,
  and about a line, polyline or arc that loses its length to rounding.
- `lint` warns about text that contains `%%`, which AutoCAD stores as written
  but draws as a control code: `%%d` is drawn as a degree sign.

## 0.2.0

0.1.1 was never published, so its changes ship here too.

- `createDrawing({ dxf: "R2018" })` targets AC1032, the DXF version AutoCAD has
  used since 2018. It writes handles, owner links, the standard tables, model
  and paper space blocks, plot styles and `$INSUNITS`. R12 stays the default.
  `toDXF(drawing)` writes the drawing's version, and
  `toDXF(drawing, { version })` writes another.
- Layer names, layer colors, radii, text heights and rectangle sizes written as
  literals are checked by the compiler. The same checks run when the code runs.
- `lint(drawing, { version })` returns every problem in a drawing. `toDXF`
  throws a `DrawingError` listing the errors instead of writing a file AutoCAD
  would reject.
- Fixed: AutoCAD discarded R12 drawings whose layer names had spaces, dots or
  other punctuation, or more than 31 characters. Those names are now errors in
  an R12 drawing and allowed in an R2018 drawing.
- Fixed: a layer name containing a line break wrote extra records into the
  file. Commas, carets and leading or trailing spaces are rejected too.
- Fixed: AutoCAD discarded any drawing with a `^` in its text. A caret is now
  escaped.
- Fixed: R12 text outside ASCII came out garbled. It is now written as
  `\U+XXXX` escapes.
- Fixed: arc angles outside 0 to 360 failed `AUDIT`. Angles are now stored from
  0 up to 360.
- Fixed: `wall` and `WALL` were two layers, and AutoCAD kept only the first.
  They are now one layer.
- Text with control characters, or with emoji and other characters above
  U+FFFF, is rejected, because AutoCAD cannot read it.
- Unknown units, and rectangle sizes of 0 or less, are rejected.
- Breaking: a `Drawing` now has a required `dxf` field, and R12 layer names
  AutoCAD rejects now throw (see above).
- Published from GitHub Actions through npm trusted publishing, with a
  provenance attestation linking the package to its source commit.
- `tsdraft/package.json` can be imported or resolved.
- The package now includes this changelog.

## 0.1.0

First release.

- `createDrawing()` builds a drawing with layers (AutoCAD Color Index colors),
  lines, polylines, rectangles, circles, arcs and single-line text.
- `toDXF()` writes ASCII DXF R12 (AC1009) with layer and linetype tables.
- `toSVG()` writes an SVG preview with model Y pointing up.
