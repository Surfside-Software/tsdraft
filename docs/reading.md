# Reading drawing files

`readDXF(input, options)` reads an ASCII DXF of any version and gives a `DrawingRead`, the read
model. It takes the file as a string or as its bytes in an `AsyncIterable<Uint8Array>`, such as a
stream from `fs.createReadStream`, and reads them as they arrive: it never holds the whole file,
so a DXF of several hundred megabytes reads in seconds.

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

From AutoCAD 2007's format, `AC1021`, on, a DXF's text is UTF-8. Before it, the text is in the
code page `$DWGCODEPAGE` names, such as `ANSI_1252`, and the reader decodes it in that code
page. `encoding` says which it used. A string given to `readDXF` is text already, so it is read
as it is, whatever its header says, and its `sha256` is that of its UTF-8 bytes.

Each string then holds what AutoCAD holds after reading the same file. A caret and a space is a
caret, and a caret before a letter is a control character, so `^J` is a line feed. Past that,
AutoCAD decodes two escapes: `\U+XXXX`, a character by its code, but for `\U+0000`, and
`\M+NXXXX`, a character of one of the five code pages of East Asia by its two bytes, where the
platform's `TextDecoder` has that code page. It decodes them in passes, left to right, and a pass
does not read again what it made:

- The value of a `TEXT`, an attribute and an attribute definition, with its tag and its prompt,
  goes through two passes: `\U+XXXX` in the first, and `\U+XXXX` and `\M+NXXXX` in the second.
  So `\U+005CU+00B0` is held as `°`, and `\U+005CU+005CU+00B0` as `\U+00B0`.
- The value of an `MTEXT`, a dimension's text and a multileader's note goes through one pass of
  both.
- A name, such as a layer's, and an xref's path go through one pass of `\U+XXXX`.

tsdraft's own DXF escapes what AutoCAD would decode, so a read of it gives every text as the
drawing has it.

## The read model

The model is format 0, `READ_FORMAT`, and is not settled. Until it is, a release may change its
fields and what a reader of another format gives, below.

A `DrawingRead` is not a `Drawing`, and nothing writes it back to a file. It holds what a file
states and keeps each object's handle, and it keeps going past what it does not understand:

- `sha256` and `bytes` of the file, its `version`, and `header`: `$INSUNITS`, `$MEASUREMENT`,
  `$LTSCALE`, `$PSLTSCALE`, `$MSLTSCALE`, `$DIMSCALE` and the current styles.
- The tables: `layers` with their state, `linetypes`, `textStyles` and `dimensionStyles`, each
  style with whether it is annotative, and a dimension style with the units it writes lengths
  in. Two entries of one name are both kept, in the order of the file.
- `blocks`: each with its base point, its attribute definitions and its entities, below. What
  else a block draws is counted under `other` by kind, such as `HATCH` or `LWPOLYLINE with arcs`,
  and so is what stands in another plane than the block's. The blocks keep `BLOCK_ITEMS`,
  400,000 items in all, counted as below, and count what comes past that under `past the limit`.
  The pictures AutoCAD makes for dimensions, the blocks named `*D` and a number, are kept by a
  read with `geometry` alone.
- `xrefs`: each with its name, its path as the file holds it, and whether it is an overlay.
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

A space and a block hold one type, `ReadEntity`, of the kinds tsdraft's writers write:

- `line`, `circle` and `arc`, and `polyline` for a polyline of straight segments, open or
  closed. A polyline with an arc or a width is counted under `other`.
- `text`: a text of one line, with its `value`.
- `insert`: its block, by name and by the handle of its record in `blockHandle`, its point,
  scale and rotation, `tags`, and with `geometry` its `attributes`: each a text with its `tag`
  and its `value` where the file places it, and `invisible` for one that does not show. An
  insert with columns and rows is counted under `other`.
- `mtext`: a paragraph text with its point, height, width, attachment, rotation, style and
  value, its formatting codes kept. It is not laid out.
- `dimension`: a linear or aligned dimension, with its two points, the point where its dimension
  line meets its second extension line, its direction, the middle of its text, what it measures,
  its text, its style and the block of its picture. The other kinds of dimension are counted
  under `other`.
- `multileader`: one with straight shafts, one root and a note, with its style, each shaft from
  its tip, the point where the shafts meet, the landing's direction and length, its note, where
  the note is held, and the note's height and style. Any other is counted under `other`.
- `solid`: three or four corners, filled, as a dimension draws an arrowhead.

Each keeps the pen it sets for itself, each part left out when it is ByLayer: `color`, an index
with 0 for ByBlock, `trueColor` as `0xRRGGBB`, `linetype`, `lineweight` in hundredths of a
millimeter with -2 for ByBlock and -3 for the default, and `linetypeScale`.

A text, an attribute and an attribute definition say where they are and how they are justified:
`align` and `valign` as a `Text` has them, or `aligned`, `fit` or `middle`; `alignAt`, the point
a justified text is justified to; and `at`, where the text starts to draw, the left end of its
baseline. `stored` is the first point as the file stores it, and `startFrom` says where `at` came
from:

- `file`: the point the file stores. AutoCAD's own DXF stores where a justified text starts apart
  from its alignment point.
- `widths`: worked out from `alignAt` with `layoutText`, for a justified text whose file stores
  its alignment point as its start too, as tsdraft's DXF does. That is done where the layout is
  exact: the style's font is one of `FONTS`, every character is in its widths, the text holds no
  `%%`, and a centered or right-justified text neither starts nor ends with a space.
- `alignment`: `alignAt` itself, for such a text whose layout is not exact. Its start is not
  known.

`backward` and `upsideDown` say a text is drawn mirrored along its baseline or across it. A text
seen from below reads backward.

### What a read keeps

What the spaces draw counts against one budget, `GEOMETRY_ITEMS`, 400,000 items, and the blocks
against `BLOCK_ITEMS`. An entity is one item, and each of its points, each attribute and tag, and
each 32 characters of its names and its text one more. What comes past a budget is counted
under `past the limit` in its space's or block's `other`. A read of a DXF of more than 500 MB that
reaches `GEOMETRY_ITEMS` and every census list answers in about 110 MB of JSON, within the
128 MB the command takes.

Points and angles are in the world's coordinates: an entity drawn seen from below, as a
mirrored block's arcs and inserts are, is turned into them. An entity in another plane is counted
under `other` by kind, and one with a number that is not finite under `unread.malformed`. A file
older than AutoCAD 2000's format has one paper space and no layouts, and its paper space reads as
the layout `Layout1`, as AutoCAD opens it. Every object keyed by names from the file, such as a
census's `layers`, has no prototype, so a layer named `constructor` is a key like any other.

`readDXF` throws a `ReadError` for a file it cannot read at all: a binary DXF, a group code
that is not an integer, or a file that ends between a code and its value. A record whose kind,
layer, block name or tag is longer than the 2,049 characters a DXF value holds is counted under
`unread.malformed`.

## Readers of other formats

A package that reads another format names its reader in its `package.json`:

```json
{ "tsdraft": { "readers": { ".dwg": "./dist/read.js" } } }
```

The module exports `readDrawingFile(chunks, name, options)`, of the type `ReadDrawingFile`. It
takes the file's bytes as an `AsyncIterable<Uint8Array>`, its name without folders and the
`ReadOptions` `readDXF` takes, and gives a promise of a `DrawingRead` with the same fields
`readDXF` fills. `checkDrawingRead(value)` lists what is wrong with an answer as plain data, with
the path of each field, and is empty for a sound one. The library imports no reader. The
`tsdraft` command finds readers and runs each read within limits, as
[the command's page](command.md#reading-drawing-files) says.
