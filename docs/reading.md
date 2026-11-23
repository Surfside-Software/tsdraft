# Reading drawing files

`readDXF(input, options)` reads an ASCII DXF of any version and gives a `DrawingRead`, the read
model. It takes the file as a string, as its bytes in a `Uint8Array`, such as a `Buffer` from
`fs.readFileSync`, or as its bytes in an `AsyncIterable<Uint8Array>`, such as a stream from
`fs.createReadStream`. A stream it reads as the bytes arrive: it never holds the whole file, so a
DXF of several hundred megabytes reads in seconds.

```ts
import { createReadStream } from "node:fs";
import { readDXF } from "tsdraft";

const read = await readDXF(createReadStream("plan.dxf"));
read.layouts.map((l) => [l.name, l.viewports.map((v) => v.ratio)]);

// With `geometry`, what model space and each layout draws as well.
const drawn = await readDXF(createReadStream("plan.dxf"), { geometry: true });
drawn.model.entities?.filter((e) => e.kind === "text").map((t) => [t.at, t.value]);
```

## Text

From the R2007 format, `AC1021`, on, a DXF's text is UTF-8. Before it, the text is in the
code page `$DWGCODEPAGE` names, such as `ANSI_1252`, and the reader decodes it in that code
page. `encoding` says which it used. A string given to `readDXF` is text already, so it is read
as it is, whatever its header says, and its `sha256` is that of its UTF-8 bytes.

Each string then holds what the leading CAD app holds after reading the same file. A caret and a
space is a caret, and a caret before a letter is a control character, so `^J` is a line feed. Beyond
the carets, that app decodes two escapes: `\U+XXXX`, a character by its code, but for `\U+0000`, and
`\M+NXXXX`, a character of one of the five code pages of East Asia by its two bytes, where the
platform's `TextDecoder` has that code page. It decodes them in passes, left to right, and a pass
does not read again what it made:

- The value of a `TEXT`, an attribute and an attribute definition, with its tag and its prompt,
  goes through two passes: `\U+XXXX` in the first, and `\U+XXXX` and `\M+NXXXX` in the second.
  So `\U+005CU+00B0` is held as `°`, and `\U+005CU+005CU+00B0` as `\U+00B0`.
- The value of an `MTEXT`, a dimension's text, and a multileader's note and its block's labels go
  through one pass of both.
- A name, such as a layer's, and an xref's path go through one pass of `\U+XXXX`.

tsdraft's own DXF escapes what the leading CAD app would decode, so a read of it gives every text as
the drawing has it.

## The read model

The model is format 1, `READ_FORMAT`, and is not settled. Until it is, a release may change its
fields and what a reader of another format gives, below.

A `DrawingRead` is not a `Drawing`, and nothing writes it back to a file. It holds what a file
states and keeps each object's handle, and it keeps going past what it does not understand:

- `sha256` and `bytes` of the file, its `version`, and `header`: `$INSUNITS`, `$MEASUREMENT`,
  `$LTSCALE`, `$PSLTSCALE`, `$MSLTSCALE`, `$DIMSCALE`, `$PDMODE`, `$PDSIZE` and the current
  styles. `pointStyleOf` gives the point style the last two plot as.
- The tables: `layers` with their state, `linetypes`, each with the `marks` it draws as a
  `Linetype` holds them, a text's `style` by name and its `height` times its style's fixed height,
  a shape by its `glyph` number and its `file`, `textStyles` and `dimensionStyles`, each
  style with whether it is annotative, and a dimension style with the units it writes lengths
  in, where its text goes, how it writes a fraction, its lineweights and its arrowheads' block. Two entries of one name are both kept, in the order of the file.
- `tableStyles`: each table style the file's dictionary of them, `ACAD_TABLESTYLE`, names, in the
  dictionary's order, by its name there: its `horizontalMargin` and `verticalMargin`, and a cell
  style for its `title`, its `header` and its `data` rows. A cell style has its `textStyle`, its
  `textHeight`, its `alignment`, 1 to 3 along the top from the left, 4 to 6 the middle and 7 to 9
  the bottom, its text's `color`, 0 for ByBlock, its `fill` where its cells are filled, and its
  borders' `lineweight`, -2 for ByBlock. A field a style leaves out is the leading CAD app's own.
- `blocks`: each with its base point, its attribute definitions and its entities, below. What
  else a block draws is counted under `other` by kind, such as `HATCH` or `LWPOLYLINE in 3D`,
  and so is what stands in another plane than the block's. An entity the file marks invisible,
  group 60, draws nothing and is counted under `invisible`: a dynamic block's states each keep
  the entities of every state, with those of the others marked so, and an insert reads as the
  block it names: the definition, for the state the definition shows, or a `*U` block for
  another, which draws the state it shows. An attribute or attribute definition hidden that way
  is `invisible`, as one whose own flag hides it is, and a space counts such a definition under
  `other`. The blocks keep `BLOCK_ITEMS`, 400,000 items in all, counted as below, and count what
  comes past that under `past the limit`.
  The pictures the leading CAD app makes for dimensions and tables, the blocks named `*D` or `*T`
  and a number, are kept by a read with `geometry` alone.
- `xrefs`: each with its name, its path as the file holds it, and whether it is an overlay.
- `images`: each image definition of the file's dictionary of them, with its name, its path as
  the file holds it, the pixels it states, whether it is loaded, and how many images name it. One
  no image uses is kept, as CAD programs keep it through a save and a purge.
- `underlays`: each PDF definition of the file's dictionary of them, with its name, its path as the
  file holds it, its page, and how many underlays name it, one no underlay uses among them.
  `underlayFrame` is `false` where the file says underlays' frames neither show nor plot, and
  `"screen"` where they show and do not plot.
- `layouts`: each with its paper, its plotter, its plot style table, its plot's rotation, its
  viewports and its inserts. A viewport has its rectangle on the paper, the center and height
  of the model space it shows, `ratio`, which is paper units per model unit, its twist, and
  the layers frozen in it alone. The viewport each layout keeps for its whole paper is left
  out. An insert has its point, scale, rotation and layer, and whether it sets each attribute.
- `fields`: the field codes of `MTEXT` that the file's name, the layout's name and the date
  come from, `\AcVar Filename`, `\AcVar ctab` or a DIESEL expression that reads `CTAB`, and
  `\AcVar Date`, with the `MTEXT`'s point, height and width. `otherFields` counts the other
  codes by kind.
- For model space and each layout, a `census`: entities by layer and kind, how many set their
  own color, linetype or lineweight, and the lineweights they set; each text's kind, layer,
  style, point and height, with the heights an `MTEXT` sets inside its text with `\H`; each
  dimension's layer, style, point and whether it overrides its style; and each insert's block,
  layer, point and scale. Each of the three lists stops at `CENSUS_LIMIT`, 200,000, and
  `capped` says so. The counts are whole.
- With `geometry`, `entities` for model space and each layout: what it draws, in the order of
  the file, and `other` beside it for what it leaves out, counted as a block's is.
- `opensAt`: the tab the file opens on, `layout` or none for the model tab, and the center,
  height and width of the view it shows there: model space's view, or the view of its paper a
  layout keeps.
- `unread`: entities and objects of a kind the reader has no reading of, such as `OLE2FRAME`,
  a proxy or an object of a vertical product, counted by kind, and records it could not place.

A read without `geometry` keeps no text of model space or of a layout and no attribute's value.
The texts of a block's definition are kept, since a title block's labels belong to it.

### Entities

A space and a block hold one type, `ReadEntity`, of the kinds tsdraft's writers write, and the old
leader:

- `line`, `circle` and `arc`, and `polyline` for a lightweight polyline or a 2D one, open or
  closed, with `bulges`, one for each side, when a side is an arc, and `width`, one width for
  every side, or `widths`, each side's width at its start and its end, when a side is wide, as
  a `Polyline` holds them, and `linetypeGeneration` when its pattern runs on past its vertices.
  A 2D polyline's vertex with no width of its own has the polyline's.
- `text`: a text of one line, with its `value`.
- `insert`: its block, by name and by the handle of its record in `blockHandle`, its point,
  scale and rotation, `tags`, and with `geometry` its `attributes`: each a text with its `tag`
  and its `value` where the file places it, and `invisible` for one that does not show. An
  attribute of paragraph text has its `paragraph` too, below, and its `value` is the paragraph's.
  An insert with columns and rows is counted under `other`.
- `mtext`: a paragraph text with its point, height, width, attachment, rotation, from its
  direction or else from group 50 in degrees, style,
  value, its formatting codes kept, `lineSpacing`, its line spacing factor, 1 where the file
  states none, `lineSpacingStyle`, `"at-least"` or `"exactly"`, and its `columns`, as a
  paragraph's, with `width` then each column's. Heights one by one are those of the columns the
  text reaches. `layoutMtext` and
  `measureMtext` lay it out as tsdraft lays out a paragraph: [Paragraphs](paragraphs.md#reading).
- `dimension`: a linear or aligned dimension, with its two points, the point where its dimension
  line meets its second extension line, its direction, the middle of its text, what it measures,
  its text and the words below its line, which the file holds after `\X`, its style and the
  block of its picture.
- `radial-dimension`: a radius, a diameter or a jogged radius dimension, its `type`, with its
  center, the point of the circle or arc its line meets, a jogged one's start and jog, the
  middle of its text, `placed` where the file holds the text where it was placed, what it
  measures, its text, its style and the block of its picture. A file holds a diameter's far
  point, and the center is halfway to the point.
- `arc-length-dimension`: an arc length dimension, with the `center`, `radius`, `startAngle` and
  `endAngle` of the arc it measures, a point its own arc passes through, `at`, the middle of its
  text, `placed`, `partial` where it measures part of the arc, what it measures, its text, its style
  and the block of its picture.
- `ordinate-dimension`: an ordinate dimension, with its `axis`, `"x"` or `"y"`, the `origin` it
  measures from, its `feature`, its `leaderEnd`, the middle of its text, `textAt`, `placed`, what it
  measures, its text, its style and the block of its picture. One drawn in a turned coordinate
  system is counted under `other`.
- `angular-dimension`: an angular dimension, its `type`, `"three-point"` with its `vertex` and
  a point of each line, `from` and `to`, or `"two-line"` with its `first` and `second` lines, each
  two points; a point its arc passes through, `at`, the middle of its text, `placed`, the angle it
  measures in degrees, its text, its style and the block of its picture.
- `multileader`: a note or a block, with its `style`, `textHeight` and `arrowSize`. `roots` holds
  each root in the file's order, one with no shafts among them: the point `at` where its shafts
  meet, its landing's `direction` and length, and its `shafts`, each from its tip. `shafts`, `at`,
  `direction` and `landing` repeat the first root's, and one with no root has no shafts, its
  note's point and no landing. `shaft` says how its shafts are drawn: `straight`, `curved` through
  their points, or `none`. Its note is `text`, with `\P` between lines, held at `textAt` by the
  point `textAttachment` names, as an `MTEXT`'s attachment, wrapping at `width`, or 0 where it
  does not, in `textStyle`. `attachments` says where a landing meets each side of the note,
  `vertical` that its landings meet the note's top or bottom, `frame` that a frame goes around the
  note, and `mask` that a mask is behind it: the drawing's background, or the color index `color`,
  over the note's box grown by `offsetFactor` times its height less one. A block as its content
  has `text` `""`, `textAt` at the block, and `block`: its `name`, `at`, `scale`, `rotation` in
  degrees, and `attributes`, the value each of its labels gives, by the tag of the attribute
  definition it fills. A label whose definition the read does not hold is left out, and at most
  1,000 are read. One whose note or block leaves the plane is counted under `other`.
- `leader`: the old leader, with its dimension `style`, its `points` from its tip as the file
  holds them, `shaft`, `straight` or `curved`, whether it draws an `arrowhead`, and `note`, the
  handle of the entity that is its note, where it has one. The leading CAD app leaves group 71 out
  where it draws an arrowhead, and group 73 where it has no note. One in another plane is counted
  under `other`.
- `solid`: three or four corners, filled, as a dimension draws an arrowhead.
- `image`: a raster image, with its definition's `path` and the handle of the `definition`, the
  `pixels` it states, its lower-left corner `at`, and `u` and `v`, the vectors of one of its pixels
  along its bottom and up its side, which a mirrored or slanted image has too. `clip` is its clip
  boundary, unless the file holds the whole image's with its clip off and not inverted, in the
  world's coordinates: two opposite corners of a rectangle along its sides, as the file holds them,
  or a polygon without its first point again. `invertClip`, `transparent`, `hidden` for one the
  file says not to show and `unclipped` for one it says not to clip say so, and `brightness`,
  `contrast` and `fade` are left out at 50, 50 and 0. An image out of the plane is counted under
  `other`.
- `underlay`: a page of a PDF, with its definition's `path` and `page` and the handle of the
  `definition`, its lower-left corner `at`, its `scale` across and up, which takes an inch of the
  page to drawing units, and its `rotation` from 0 up to 360. `clip` is its clip boundary where the
  file holds one, in the world's coordinates: a rectangle's top-left and bottom-right corners along
  the page, as CAD programs save them, or a polygon. `invertClip`, `monochrome`, `hidden` for one
  the file says not to show and `unclipped` for one whose clip it says not to use say so, and
  `fade` and `contrast` are left out at 0 and 100. A file without them means 25 and 75. It holds
  no page size, which only the PDF gives. An underlay out of the plane is counted under `other`.
- `hatch`: its `pattern`, such as `SOLID` or `ANSI31`, whether it is `solid`, its island `style`,
  `normal`, `outer` or `ignore`, `associative` where the file ties it to what it bounds, and its
  `loops`, each its `points`, its `bulges` where a side is an arc, and its `flags` as the file
  holds them: 1 external, 2 a polyline, 4 derived, 8 a text's box, 16 outermost. A loop of lines
  and arcs is read as points and bulges, a whole circle as two half circles. CAD programs fill a
  hatch of style `normal` by the parity of all its loops, one of style `outer` by the parity of
  those marked external or outermost, and one of style `ignore` by the external ones. A hatch
  bounded by an ellipse or a spline is counted under `other`, as is one out of the plane. One that
  is not solid holds its `patternType`, 0 for user-defined lines, named `_U`, 1 for a pattern CAD
  programs ship and 2 for one of a file, its `patternAngle`, its `patternScale`, which is the
  spacing of user-defined lines, `crossed` for user-defined lines crossed by as many more, and
  `patternLines`, each `{ angle, base, offset, dashes? }` as the file holds it: placed in the
  drawing, with the pattern's angle added, the base point scaled, turned and moved to the origin,
  and the offset and dashes scaled, the offset turned to the line. [Patterns](fills.md#patterns)
  says how a firm's patterns are read back this way. A hatch with a gradient holds `gradient`, left
  out where group 450 is 0: its `name` as the file holds it, such as `LINEAR`, a name tsdraft does
  not know included, its `angle` in degrees, `centered` where group 461 is 0, the first two
  `colors`, each group 421 as `0xRRGGBB`, and, where it has one color, its `tint` as single
  precision holds it. To build a `Hatch.gradient` from one, find the name whose `GRADIENT_NAMES`
  entry is the file's `name`, and take each color apart as `[c >> 16, (c >> 8) & 255, c & 255]`; a
  name with no entry is one tsdraft does not write. A hatch seen from below reads its gradient's
  angle as 180 less the file's, as a pattern line's is; where that gradient is not centered, the
  angle and `centered: false` do not give its mirror image, because its shift does not mirror with
  the angle.
- `wipeout`: its `points` in the world's coordinates, without the first again at the end.
- `point`: its `at`, and its `rotation`, the turn of its figure counterclockwise from 0 up to 360,
  which the file holds the other way round in group 50.
- `ellipse`: its `center` and `majorAxis`, which the file holds in the world's coordinates, its
  `ratio`, and for an arc its `startParameter` and `endParameter` in degrees, as `Ellipse` holds
  them. One the file holds seen from below runs its parameters the other way round, and is read as
  the ellipse it draws seen from above: its arc from s to e is the arc from 360 less e to 360 less
  s. One whose ratio is outside 0 to 1, or whose axis has no length, is counted under
  `unread.malformed`, and one out of the plane under `other`.
- `spline`: its `degree`, `knots`, `controlPoints` and, for a rational one, `weights`, as the file
  holds them; `closed` and `periodic` from its flags; and where the file holds them its
  `fitPoints`, `startTangent`, `endTangent`, `fitTolerance` and the `knotSpacing` its flags give.
  One closed by its first fit point again at its end is `closed`, with that point once in
  `fitPoints`. One whose counts disagree with its groups, whose degree is not a whole number from
  1 to 11, or whose knots do not fit its control points is counted under `unread.malformed`, and
  one with a point off the plane under `other`.
- `table`: its `style`, where the dictionary of table styles names it, its upper left corner
  `at`, the `direction` its rows run, one unit long, the height of each of its `rows` from the top
  and the width of each of its `columns` from the left, and whether its first row is a `title`
  and its next a `header`, as its style and its own groups say. `cells` holds each cell that
  starts a span or stands alone, in reading order: its `row` and `column` from 0 at the top left,
  its `rowSpan` and `columnSpan`, its `text` with a paragraph's codes or its `block` by name, with
  `blockScale` where the block is not scaled to fit the cell, and what it changes of its row's
  cell style where its flags say so: `alignment`, `textHeight`, its text's `color` and its
  `fill`. `block` and `blockHandle` name the block of its picture, which CAD programs show and
  plot, and which a read with `geometry` keeps among `blocks`. A table is read from its own
  groups, which every file holds; the objects of its dictionary, which hold the same content
  again, are not read. A table of more than 1,000 columns or 100,000 cells, the core's
  limits, or of more rows or items than the read may still keep, is counted under `other`, and
  one whose rows, columns or cells are not as many as it says under `unread.malformed`. One out
  of the plane is counted under `other`.
- An `mtext` with a background holds `mask`: its `offsetFactor`, and its `color` or `trueColor`
  where it is not in the drawing's background.
- `3dsolid`, `region` and `body`, which CAD programs keep as modeler data: their `edges`, in the
  order the data holds them, in the world's coordinates and in 3D, each a `line` from one point to
  another, an `ellipse` with its `center`, `normal`, `majorAxis`, `ratio` and, for an arc of one,
  its `startParameter` and `endParameter` in degrees, or a `spline` cut to the edge, with its
  `degree`, `knots`, `controlPoints` and `weights`. An edge on no curve, such as a cone's apex,
  and a seam, where a face meets itself, are left out, as CAD programs show neither. A solid with
  no body has no edges. `edgesUnread` counts the edges on a curve the reader does not follow, and
  `dataUnread` says the reader does not read the data at all, which a file of 2013 or later keeps
  apart from the entity. `satEdges` and `sabEdges` read the data's text and binary forms, and
  `decipherSat` the cipher a file before 2013 keeps the text in.
  `edgesInPlan` turns one into the lines, circles, arcs, ellipses and splines it shows from above,
  with its pen, for a drawing that `toSVG` and `toPDF` draw: a circle seen at an angle is an
  ellipse, one seen edge on a line, and an edge that shows as one point, such as a vertical line,
  is left out. CAD programs also draw lines along a solid's curved faces, which tsdraft does not
  draw yet. Adding the result to a drawing you write gives plain linework: neither writer writes
  a solid.

`header.wipeoutFrame` is the file's dictionary variable `WIPEOUTFRAME`, which CAD programs read of
whether wipeouts' frames show: 0 neither shown nor plotted, 1 both, 2 shown and not plotted. A
file without it shows and plots them.

With `geometry`, a space, a layout or a block whose file holds a sort table has `drawOrder`: the
handles of its entities in the order CAD programs draw them, by each one's sort handle, or its own
handle where the table gives none. Without a sort table they draw in the order of the file, the
order of `entities`.

Each keeps the pen it sets for itself, each part left out when it is ByLayer: `color`, an index
with 0 for ByBlock, and with a true color the index CAD programs match it to; `trueColor` as
`0xRRGGBB`; `colorBook`, the `book` and the `name` of a color of a color book, whose true color
`trueColor` holds; `alpha`, how opaque it is from 0 to 255 with 255 opaque, or `"ByBlock"`, whose
percent of transparency is `Math.round(100 - alpha / 2.55)`; `linetype`, `lineweight` in hundredths
of a millimeter with -2 for ByBlock and -3 for the default, and `linetypeScale`. A file may hold an
alpha no percent gives, which is read as it is, and below 25 gives a percent over 90.

A text, an attribute and an attribute definition say where they are and how they are justified:
`align` and `valign` as a `Text` has them, or `aligned`, `fit` or `middle`; `alignAt`, the point
a justified text is justified to; and `at`, where the text starts to draw, the left end of its
baseline. `stored` is the first point as the file stores it, and `startFrom` says where `at` came
from:

- `file`: the point the file stores. A DXF that the leading CAD app writes stores where a justified
  text starts apart from its alignment point.
- `widths`: worked out from `alignAt` with `layoutText`, for a justified text whose file stores
  its alignment point as its start too, as tsdraft's DXF does. That is done where the layout is
  exact: the style's font is one of `FONTS`, every character is in its widths, the text holds no
  `%%`, and a centered or right-justified text neither starts nor ends with a space.
- `alignment`: `alignAt` itself, for such a text whose layout is not exact. Its start is not
  known.

`backward` and `upsideDown` say a text is drawn mirrored along its baseline or across it. A text
seen from below reads backward.

An attribute and an attribute definition of paragraph text, which the leading CAD app holds as a
text of one line with no value and a paragraph text after it, have `paragraph`, the paragraph
that app draws in the text's place, as an `mtext` holds one: its `at`, in the world's coordinates,
`height`, `width`, `attachment`, `rotation`, the direction of its lines, `style`, `lineSpacing`
and `lineSpacingStyle`, and `mirrored` for one seen from below, as an insert that mirrors its
block holds it, whose lines run along `rotation` with their tops to its right. The value of the
attribute, and the `default` of the definition, are the paragraph's, with its codes. Its text
keeps its place, justified by the attachment. One whose paragraph lies in another plane is
counted under `other`.

### What a read keeps

What the spaces draw counts against one budget, `GEOMETRY_ITEMS`, 400,000 items, and the blocks
against `BLOCK_ITEMS`. An entity is one item, and each of its points, each bulge and pair of
widths of a polyline's sides, each attribute and tag, and each 32 characters of its names and its
text one more. What comes past a budget is counted under `past the limit` in its space's or
block's `other`. A read of a DXF of more than 500 MB that
reaches `GEOMETRY_ITEMS` and every census list answers in about 110 MB of JSON, within the
128 MB the command takes.

Points and angles are in the world's coordinates: an entity drawn seen from below, as a
mirrored block's arcs and inserts are, is turned into them. An entity in another plane is counted
under `other` by kind, and one with a number that is not finite under `unread.malformed`. A file
older than the R2000 format (AC1015) has one paper space and no layouts, and its paper space reads as
the layout `Layout1`, as the leading CAD app opens it. Every object keyed by names from the file,
such as a census's `layers`, has no prototype, so a layer named `constructor` is a key like any
other.

### Reading what a layout shows

A detail file can hold far more than `GEOMETRY_ITEMS` in model space, where each sheet shows one
detail. `only` reads it as the sheets show it:

```ts
const read = await readDXF(file, { geometry: true, only: { layouts: ["S-7"] } });
read.model.other["outside what was read"]; // what model space holds that S-7 does not show
```

`only.layouts` names layouts of the file, compared as the leading CAD app compares a layout's name,
without regard to case. Each keeps its paper
whole, and model space keeps each entity whose box meets the window of one of its viewports: the
viewport's rectangle taken to model space at its ratio about its view's center and turned by its
twist, which `viewportWindow` gives. `only.areas` gives parts of model space as two corners each,
such as what a sheet of another file shows of this one through an xref, and model space keeps what
they meet as well. A layout's own view of its paper is no window. The boxes are never smaller than
what the entity draws, with a text's slant and width from its style and an arrowhead's size, and
each window is widened by a fiftieth of its size, so a read by layout
keeps all a layout shows, and some it does not: a viewport's clip and its frozen layers are not
applied, and a viewport that is off counts. An entity whose box the read cannot tell, such as an
insert of an xref, is kept.

A layout `only` does not name keeps its census, its viewports and its inserts, and no
`entities`. Model space counts what it left out under `outside what was read`, the constant
`OUTSIDE_THE_READ`, and `read.only` gives the layouts as the file spells them and each area with
its lower corner first. The census and the blocks stay whole. A DXF lists its layouts after its
entities, so a read with `only` reads the file twice: a stream once as it arrives, holding a copy
of its bytes for the second pass. A name the file has no layout of, `Model`, an `only` that names nothing, an area that is not
two finite corners, or more than `MOST_WINDOWS`, 1,024, windows and areas in all is a `ReadError`.
Without `geometry`, `only` changes nothing.

`readDXF` throws a `ReadError` for a file it cannot read at all: a binary DXF, a group code
that is not an integer, or a file that ends between a code and its value. A record whose kind,
layer, block name or tag is longer than the 2,049 characters a DXF value holds is counted under
`unread.malformed`.

## The picture of a read file

`toSVG(read, options)` draws a `DrawingRead` read with `geometry` as the leading CAD app shows the
file: model space, or with `layout` the sheet as it plots, with its viewports, their scale, twist
and frozen layers, at the layout's plot style table where tsdraft has it and at `acad.ctb` where
the layout names none. It takes the options a drawing's picture takes, and two more: `xrefs`, the
read each xref stands for, by its name, drawn with the states of its layers the host holds as
`XREF|LAYER`; and `pageSizes`, the size in inches of each page the underlays show, by path and
page, as `pdfPageSize` reads it.

Each kind the readers keep is drawn by the code that draws a drawing's:

- A dimension and a table are drawn from the block of their picture, which is what the leading CAD
  app shows and plots. One with no such block draws nothing.
- A multileader is drawn from its own points, its landing and sizes, with the arrowheads of
  `leaderPicture`; an old leader from its points, with its dimension style's arrow size.
- A text starts where that app starts it, `at`. A text justified to `fit` or `aligned` is fitted
  between its two points. A text in a font tsdraft does not have is measured and drawn in the
  nearest font of `FONTS`, as `nearestFont` picks it.
- An insert draws its block and each attribute that shows, where the file places it. A constant
  attribute draws in every insert of its block.
- A solid draws as a filled outline, a hatch with the lines of its pattern as the file holds
  them, and a 3D solid, region or body as `edgesInPlan` gives its edges.
- An entity's own linetype scale, a layer's true color and a paper tsdraft does not list are
  drawn as the file holds them.

`readPicture(read, options)` draws the same picture and gives, beside `svg`:

- `notes`: each text style whose font tsdraft does not have, with the font drawn in its place;
  what draws nothing, counted by kind, which holds what the read counts under a space's or a
  block's `other` and under `unread.entities`; and what draws only nearly, counted by what, such
  as a mirrored text or an image a file slants.
- `pieces` and `defs`: the picture in pieces, which `joinPicture(pieces, defs)` joins into `svg`.
  Each space it draws, a layout's paper and model space through each of its viewports or alone,
  is a `PictureRun` of fragments, one for each entity at the top of the space that shows, in the
  order the leading CAD app draws them: the `drawOrder` the file holds, then the rest in the
  file's order. A fragment has its entity's `index` among the space's `entities`, its `handle`,
  its `svg` and the ids of the definitions it uses, such as an image's picture or a gradient.
  Each id a fragment makes starts from its viewport and its entity's handle, and an image's
  comes from its file, so a fragment kept from one picture joins with fragments of another.

`pictureDrawing(read)` gives the `Drawing` the picture draws, where each of its entities came
from, the handle of each and the notes. It holds what a `Drawing` cannot, such as a paper tsdraft
does not list, where `toSVG` alone reads it, and it is for pictures and for the checks of text:
`toDXF` of it is not the file.

## What a sheet shows

Three questions are answered from a read with `geometry`, so code can find what to change in a
firm's sheet without a CAD program:

```ts
import { nearPoint, sheetShows, xrefAreas } from "tsdraft";

const sheet = await readDXF(createReadStream("A-102.dxf"), { geometry: true });
const model = await readDXF(createReadStream("FLOOR PLAN.dxf"), { geometry: true });
const xrefs = { "FLOOR PLAN": model };

// The sheet's paper, and what each viewport that is on shows of model space.
sheetShows(sheet, "A-102", { xrefs })?.entities.filter((e) => e.text?.startsWith("NOTE"));
// What is within a quarter inch of a point on the paper, nearest first.
nearPoint(sheet, [12.5, 8], { sheet: "A-102", within: 0.25, xrefs })?.entities[0]?.handle;
// The parts of the model the sheet shows, in the model's coordinates.
xrefAreas(sheet, "A-102", "FLOOR PLAN");
```

`sheetShows(read, layout, { xrefs })` gives the entities of the layout's paper, then for each
viewport that is on the entities of model space it shows. Inserts are followed through their
blocks, and through each xref whose read `xrefs` gives by the xref's name, or as
`{ read, xrefs }` with the reads of its own attachments. What lies on a layer that is off, frozen,
frozen in that viewport or set not to plot is left out, and an xref's layer is in the state the
host holds for it as `XREF|LAYER`, as CAD programs show it. So is what lies outside the
viewport's rectangle, or outside the outline that clips it, `clipBy`, and what lies outside an
insert's clip, `clip`. Each entity comes with its handle in the file that holds it, the handles of
the inserts it was reached through, the xrefs, its kind, its layer as the sheet names it, its
color after ByLayer and ByBlock, the viewport, its box on the paper, and for a text its value.
`spaceShows(read, { layout?, xrefs })` gives what model space or a layout's paper draws, each box
in the space's own coordinates.

`nearPoint(read, at, { sheet | layout, within, xrefs })` gives the entities whose box comes
within `within` of a point, nearest first, and of two at one distance the smaller box first. What
the sheet or space shows is worked out and filed in a grid once for each read, so each question
after the first costs about what it finds. `xrefAreas(read, layout, xref)` gives, for each
viewport that is on and each insert of the xref at the top of model space, the box of what the
viewport shows in the xref's own coordinates, cut to the insert's clip.

Each walk stops at `QUESTION_LIMITS`, 100,000 entities and 4,000,000 steps through inserts, and
then says `capped`. A box is the box the core's extents give, from `measureText` for a text, so
it is the box the picture draws.

## Readers of other formats

A package that reads another format names its reader in its `package.json`:

```json
{ "tsdraft": { "readers": { ".dwg": "./dist/read.js" } } }
```

The module exports `readDrawingFile(chunks, name, options)`, of the type `ReadDrawingFile`. It
takes the file's bytes as an `AsyncIterable<Uint8Array>`, its name without folders and the
`ReadOptions` `readDXF` takes, and gives a promise of a `DrawingRead` with the same fields
`readDXF` fills. A reader of another format reads `only` as `readDXF` does with `partFilter`,
which takes a read of the file without geometry and the `only` it was given, and says which
layouts to keep and which entities of model space. `checkDrawingRead(value)` lists what is wrong with an answer as plain data, with
the path of each field, and is empty for a sound one. A reader gives the `format` it was built
for. The command still takes format 0, which a reader built for an older tsdraft gives, and
renames a mark's `shape` to `glyph` and a text style's `shapes` to `glyphFile` before it checks
the answer; it skips an answer in any other format. The library imports no reader. The
`tsdraft` command finds readers and runs each read within limits, as
[the command's page](command.md#reading-drawing-files) says.
