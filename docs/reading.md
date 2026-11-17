# Reading drawing files

`readDXF(input)` reads an ASCII DXF of any version and gives a `DrawingRead`, the read model.
It takes the file as a string or as its bytes in an `AsyncIterable<Uint8Array>`, such as a
stream from `fs.createReadStream`, and reads them as they arrive: it never
holds the whole file, so a DXF of several hundred megabytes reads in seconds.

```ts
import { createReadStream } from "node:fs";
import { readDXF } from "tsdraft";

const read = await readDXF(createReadStream("plan.dxf"));
read.layouts.map((l) => [l.name, l.viewports.map((v) => v.ratio)]);
```

## Text

From AutoCAD 2007's format, `AC1021`, on, a DXF's text is UTF-8. Before it, the text is in the
code page `$DWGCODEPAGE` names, such as `ANSI_1252`, and the reader decodes it in that code
page, with the `\U+XXXX` escapes worked out. `encoding` says which it used. A string given to
`readDXF` is text already, so it is read as it is, whatever its header says, and its `sha256` is
that of its UTF-8 bytes.

## The read model

The model is format 0, `READ_FORMAT`, and is not settled. It holds what learning a standard
from a file needs, and it has no geometry or text of model space or of a layout yet. Until it
does, a release may change its fields and what a reader of another format gives, below.

What it gains next: the entities of model space and of each layout, the color, linetype and
lineweight an entity sets for itself, a text's justification, the values of an insert's
attributes, the dimensions and multileaders tsdraft writes, and the view a file opens at. A read
will ask for them with an option, and one that does not ask will keep what it keeps today. A
reader of another format takes the same option and fills the same fields.

A `DrawingRead` is not a `Drawing`, and nothing writes it back to a file. It holds what a file
states and keeps each object's handle, and it keeps going past what it does not understand:

- `sha256` and `bytes` of the file, its `version`, and `header`: `$INSUNITS`, `$MEASUREMENT`,
  `$LTSCALE`, `$PSLTSCALE`, `$MSLTSCALE`, `$DIMSCALE` and the current styles.
- The tables: `layers` with their state, `linetypes`, `textStyles` and `dimensionStyles`, each
  style with whether it is annotative, and a dimension style with the units it writes lengths
  in. Two entries of one name are both kept, in the order of the file.
- `blocks`: each with its base point, its attribute definitions, and its lines, polylines of
  straight segments, circles, arcs, texts and inserts. What else a block draws is counted under
  `other` by kind, such as `HATCH` or `LWPOLYLINE with arcs`, and so is what stands in another
  plane than the block's. The blocks keep `BLOCK_ITEMS`, 400,000, entities and points of
  polylines in all, and count what comes past that under `past the limit`. The pictures AutoCAD makes for
  dimensions, the blocks named `*D` and a number, are left out.
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
- `unread`: entities and objects of a kind the reader has no reading of, such as `OLE2FRAME`,
  a proxy or an object of a vertical product, counted by kind, and records it could not place.

It keeps no text of model space or of a layout and no attribute's value. The texts of a block's
definition are kept, since a title block's labels belong to it. So the model's size grows with
the file's tables and blocks, and with its entities only up to the census's limits.

Points and angles are in the world's coordinates: an entity drawn seen from below, as a
mirrored block's arcs and inserts are, is turned into them. A text of a block seen from below
reads backwards, which no rotation gives, so it is counted under `other`. A file older than AutoCAD 2000's
format has one paper space and no layouts, and its paper space reads as the layout `Layout1`,
as AutoCAD opens it. Every object keyed by names from the file, such as a census's `layers`, has
no prototype, so a layer named `constructor` is a key like any other.

`readDXF` throws a `ReadError` for a file it cannot read at all: a binary DXF, a group code
that is not an integer, or a file that ends between a code and its value.

## Readers of other formats

A package that reads another format names its reader in its `package.json`:

```json
{ "tsdraft": { "readers": { ".dwg": "./dist/read.js" } } }
```

The module exports `readDrawingFile(chunks, name)`, of the type `ReadDrawingFile`. It takes the
file's bytes as an `AsyncIterable<Uint8Array>` and its name without folders, and gives a promise
of a `DrawingRead`. `checkDrawingRead(value)` lists what is wrong with an answer as plain data,
with the path of each field, and is empty for a sound one. The library imports no reader. The
`tsdraft` command finds readers and runs each read within limits, as
[the command's page](command.md#reading-drawing-files) says.
