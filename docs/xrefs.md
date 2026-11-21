# Xrefs

An xref, or external reference, is another drawing's DWG file that the leading CAD app loads each
time it opens yours, and draws wherever you place it. A sheet puts a civil base, a survey or a
border under its own work this way: the other file stays one file, and every sheet that references
it shows it as it is now. Xrefs are written to R2018 drawings only.

A drawing holds the path of the file and nothing of what the file draws.

```ts
import { createDrawing, toDXF, toSVG } from "tsdraft";

// base.ts: the drawing other sheets reference. It is exported to base.dwg.
const b = createDrawing({ units: "ft" });
b.layer("C-PROP", { color: 2 }, () => b.rect([0, 0], 75, 120));
b.layer("C-BLDG", { color: 1 }, () => b.rect([20, 30], 35, 50, { id: "footprint" }));
const base = b.build();

// sheet.ts: a sheet in the same folder, which draws its notes over the base.
const d = createDrawing({ units: "ft" });
d.xref("BASE", "base.dwg");
d.layer("X-BASE", { color: 8 }, () => d.insert("BASE", [0, 0], { id: "base" }));
d.layer("C-ANNO", { color: 7 }, () => d.text([20, 85], "PROPOSED HOUSE", { height: 2 }));
const sheet = d.build();

toDXF(sheet); // holds the path "base.dwg", and one insert of it
toSVG(sheet, { xrefs: { BASE: base } }); // draws the base under the notes
```

## Referencing a file

`d.xref(name, path)` references a file under a name.

- `name` is a block name, and an insert places the xref by it. No block and no other xref of
  the drawing may have it. It need not be the file's name.
- `path` leads from the folder of your drawing's file to the DWG file. The leading CAD app resolves
  it each time it opens the drawing, so the two files keep their places to each other.
- An xref has no entities, no base point and no attribute definitions of its own. Its file
  has them.

An xref is an overlay unless you attach it:

```ts
d.xref("SURVEY", "survey.dwg"); // an overlay
d.xref("BASE", "base.dwg", { attach: true }); // an attachment
```

The leading CAD app loads an overlay for the drawing that references it and not for a third
drawing that references that one, so two drawings can overlay each other. It loads an
attachment for every drawing above it too: a sheet that references a model draws the base the
model attaches, and not the survey the model overlays. Attach what every sheet of a model must
show, and overlay what only the model needs.

The leading CAD app draws the model space of the file and nothing of its layouts.

## Placing an xref

`d.insert(name, at, options)` places an xref as it places a block: on the current layer, with
a `scale`, a `rotation` and an `id`. An xref can be placed any number of times, in model
space, inside a block and on a layout. An insert of an xref cannot set `attributes`.

Place each xref at least once. The leading CAD app purges an xref that nothing references when it
opens the drawing, and `lint` warns of one. An insert on a layout counts: a border that only a
sheet places is loaded. [Title blocks](title-blocks.md) shows a firm's border placed that
way, and what its file may hold.

### Units

The leading CAD app draws an insert at the scale the file gives it, whatever units the two drawings
are in. Its own attach command works a scale out from the two drawings' units once, when a
drafter attaches a file. An insert that is already in the file is left as it is. So when the
units differ, write the scale: a base in feet under a sheet in inches is

```ts
d.insert("BASE", [0, 0], { scale: 12 });
```

## The path

A path is as the leading CAD app stores it. That app takes all of these:

- `base.dwg`, `./base.dwg`, `sub/base.dwg` and `../survey/base.dwg`, with `/` or `\` between
  folders. Windows compares the names without regard to case.
- Spaces, and letters outside ASCII: `ref dir/é 図.dwg`.
- A path with no `.dwg` at the end, to which the leading CAD app adds it: `base` finds `base.dwg`.
- A path far longer than 260 characters.
- A dot after `.dwg`.

`lint` and the builder refuse these:

- An empty path. The leading CAD app then looks for a DWG file named as the xref is.
- A path that ends in `.dxf`. The leading CAD app loads only a DWG file as an xref: it reports that
  it is unable to load a DXF, and draws nothing for it.
- An absolute path: one that starts with `/` or `\`, or with a drive such as `C:`. The leading CAD
  app takes one. The refusal is tsdraft's own, because a drawing that is written as code is built
  on one machine and opened on another. Where the folder is missing, that app loads a file of
  the same name from your drawing's folder when there is one, and reports the xref as loaded.
- Any of `* ? < > | :` or `"`. The leading CAD app finds no file whose name holds one of them. It
  does read a path wrapped in a pair of quotes as the path inside, and tsdraft wants that path
  written without them: the refusal of the pair is tsdraft's own.
- A path that ends in a dot, unless the dot follows `.dwg`. The leading CAD app adds `.dwg` after
  the dot, so for `base.` it looks for `base..dwg` and finds no file.
- A backslash before `M+`, a digit from 1 to 5 and four hex digits, such as `sub\M+10041`.
  Once the leading CAD app has saved the drawing it reads those as one character, and looks for
  another file. Write `/` there.
- A control character, a private-use character from U+E800 to U+E8FF, or a character above
  U+FFFF. The leading CAD app finds no file by a path with a tab, replaces the private-use
  characters when it saves the drawing, and cannot read a character above U+FFFF from DXF.
- A path longer than 32,000 characters. The leading CAD app finds no file by a path that comes to
  more than 32,767 characters with the folder of the drawing.

## A missing file

`lint` cannot see a file system, so it does not know whether the path leads to a file.

When the leading CAD app finds no file at the path, it looks for a file of the same name in the
folder of your drawing and loads that one if it is there. It does so for any path: `gone\base.dwg`,
whose folder is missing, loads a `base.dwg` that lies beside your drawing. It reports the xref
as loaded and says nothing of where the file came from, so a drafter can be looking at
another file than the one the path names. Keep no stray copy of a referenced file beside the
drawing.

When there is no such file either, the leading CAD app still opens your drawing, and its `AUDIT`
finds no error. It says that the file cannot be found, naming the file and not its folders, and
draws a small text at each insert in place of the file: `Xref` and the path as you wrote it.

A DXF cannot be referenced, so the file an xref names has to be a DWG. `toDXF` writes DXF, so
a drawing built with tsdraft has to be saved as a DWG, in CAD for one, before another drawing
can reference it.

`toDXF` writes `$XEDIT` 0 in an R2018 drawing, and the leading CAD app keeps the setting in the DWG
it saves. A drawing that references that DWG then cannot edit it in place: that app's `-REFEDIT`
answers that the xref is not editable. A script that writes the file again would overwrite
such an edit. The setting stops only editing in place: an edit saved by opening the DWG itself
is overwritten just the same. To allow editing in place in a file you no longer write from a
script, set `XEDIT` to 1 in that file and save it.

An R12 DXF does not state `$XEDIT`, so the leading CAD app opens it with `XEDIT` 1, and a DWG saved
from it can be edited in place. Write a drawing that another drawing references as R2018.

## Names

An xref's name follows the [rules of block names](blocks.md#names), and shares the blocks'
names: a drawing cannot have a block `TREE` and an xref `tree`, or two xrefs `BASE` and
`base`. The leading CAD app discards a drawing with two such names that differ only in case. It
takes `straße` and `strasse` for one too, makes one xref of the two, and reports nothing.

The leading CAD app names each layer of a loaded xref with the xref's name, a bar and the layer's
name, such as `BASE|C-BLDG`. A block name cannot hold a bar, so an xref's name cannot either.

## Layers

The leading CAD app draws an insert of an xref as it draws an insert of a block.

- An entity on layer `0` of the file draws as the layer of the insert does, in its color,
  linetype and lineweight.
- An entity on any other layer draws as that layer of the file does. A layer that is off or
  frozen in the file, or set not to plot, is the same in your drawing.
- An insert on a layer that is off hides what the file holds on layer `0`. An insert on a
  frozen layer hides all of it, and an insert on a layer that does not plot plots none of it.
- Dashes are scaled by your drawing's linetype scale, not the file's.

## Handles

An xref's block record takes its handle from its name, as a block's does: `blockHandle(name)`.
An insert with an id has the handle `idHandle(id)`. A drawing that has an xref has a
`$HANDSEED` of `20000000000000`. See [Handles](blocks.md#handles).

## Cycles

Two drawings that reference each other cannot be seen from one of them, so `lint` of a drawing
alone has no rule for it. With overlays the leading CAD app loads the other drawing and not
that drawing's own overlays, and reports nothing. Two drawings that attach each other make a
circular reference, which that app breaks where it would load a drawing a second time, and
reports. `lint` with the drawings given, below, reports it too.

## The preview

`toSVG` opens no file. It draws an xref when you give it the drawing the xref stands for:

```ts
toSVG(sheet, { xrefs: { BASE: base } });
```

- Each insert of the xref is a group, `<g data-entity data-layer data-block data-xref>`, with
  the path in `data-xref`. It holds the model space of the drawing you gave, where the insert
  puts it, by the layer rules above. An element on a layer of the referenced drawing has
  `data-layer="BASE|C-BLDG"`, as the leading CAD app names that layer.
- The extents take in the box of what each insert draws, as they do for a block.
- An xref with no drawing given draws nothing: its group is empty, and the extents leave it
  out.
- The xrefs of a drawing you gave alone are not drawn.

### Nested xrefs

Give a drawing as `{ drawing, xrefs }` to draw what it attaches, with the drawings its own
xrefs stand for, and so on down:

```ts
toSVG(sheet, {
  xrefs: { MODEL: { drawing: model, xrefs: { BASE: base, SURVEY: survey } } },
});
```

- An attachment of the model draws its drawing inside the model's group, where the model's
  insert puts it. An element on one of its layers has `data-layer="BASE|C-BLDG"`, by the
  attachment's own name.
- An overlay of the model draws nothing, though a drawing is given for it, as the leading CAD app
  loads no overlay of a referenced drawing.
- A drawing that the chain above already draws, your own included, is a circular reference. It
  is not drawn again there, as the leading CAD app breaks the circle there.
- A chain is drawn `XREF_DEPTH`, 16, drawings down, and no further.
- Past 4,096 names given inside referenced drawings, none of them is drawn: only the drawings
  given for your drawing's own xrefs are.
- `toPDF` takes the same `xrefs`. `inspectText` takes them too, and checks the texts of the
  drawings given for your drawing's own xrefs, not of what those attach.
- `drawnXrefs(sheet, xrefs)` gives what the picture draws of what you gave, in the same form.

`lint(sheet, { xrefs })` warns of each drawing given that is not drawn for one of these reasons,
with the chain of names, such as `Xref "MODEL" > "SURVEY"`, and the first name in `xref`. It does
not check the drawings given: lint each on its own.

`findXref(drawing, name)` returns the xref an insert of a name places.

In a drawing file for the `tsdraft` command, export the drawings beside the default export:

```ts
import base from "./base.ts";

export const xrefs = { BASE: base };
export default d.build();
```

Give a drawing as `{ drawing, xrefs }` there too, to draw what it attaches.

The pictures then draw the base, and `drawing.xrefs` in the JSON says so with `shown: true`,
beside the `units` of the drawing you gave, and its own xrefs in `xrefs`. `shown` is about the
pictures: the command does not read DWG files, so it cannot tell whether the drawing you
exported is what the file at the path holds. It runs `lint` on each drawing you give that it
draws, at any depth, and one with an error is reported and not drawn. See
[The tsdraft command](command.md).
