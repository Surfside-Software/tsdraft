# Changelog

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
