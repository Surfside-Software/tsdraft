# Editing a firm's drawing

An edit changes a drawing file a firm already has, and keeps the rest of it as the file holds it.
It names the file by its path and by the SHA-256 of the bytes it was planned on, so it is never
made on other bytes, and it is written to an edited copy, never over the firm's file.

This version erases, moves, changes, stretches, sets a polyline's vertices and adds:
`e.erase(...handles)`, `e.move(handles, transform)`, `e.change(handle, changes)`,
`e.layer(name, changes)`, `e.viewport(handle, changes)`, `e.stretch(handles, { window, by })`,
`e.vertices(handle, { points, bulges })`, `e.model(draw)` and `e.layout(name, draw)`. Later
versions build on this footing.

## The edit file

An edit file is a TypeScript module whose default export is `editDrawing`'s:

```ts
// rev-1.edit.ts
import { editDrawing } from "tsdraft";

export default editDrawing({
  file: "../1_Model/FLOOR PLAN.dxf",
  sha256: "9c1f…", // the file's, as `DrawingRead.sha256` gives it
  name: "rev-1",
});
```

- `file` is the path from the edit file.
- `sha256` is the hash of the bytes the edit was planned on.
- `name` holds 1 to 64 letters, digits, `-` and `_`.
- `sheets` names the sheets that show a model file through an xref, by their paths from the edit
  file. `units` gives the units of a file whose `$INSUNITS` is 0, and `standard` the standard that
  judges what an edit adds.

A second argument, `(e, read) => { ... }`, states the edit. `read` is the file's read with
geometry, read only when the function first uses it. The function may run more than once, such as
once to find what it reads and once with the read, so it must give the same edit each time and
change nothing outside it.

`editDrawing` returns an `EditFile`, `{ source, build }`, and `build(read)` gives the `Edit`: a
value that goes through JSON as a `Drawing` does, so a process or a service can take one with the
file's bytes. `checkEdit(value)` says what is wrong with a value meant as one, as
`checkDrawingRead` does for a read, and stays bounded on any value. `EDIT_FORMAT` is 0, and like
the read model it is not settled.

## Erase and move

```ts
export default editDrawing(
  { file: "../1_Model/FLOOR PLAN.dxf", sha256: "9c1f…", name: "rev-1" },
  (e) => {
    e.erase("436D8", "436D9");
    e.move(["4360A", "4360C"], { by: [0, -14.25] });
    e.move(["4361E"], { about: [1204, 880], rotate: 90, scale: 0.5 });
  },
);
```

A handle is the hexadecimal digits the read gives, in any case. `e.erase(...handles)` erases each
entity with what it owns: an insert's attributes, a 2D polyline's vertices, a dimension's or a
table's picture, its extension dictionary, an image's reactor and a text's fields. Each reference
to what goes is taken out: from a group's list, which is kept when it is left empty, from a sort
table, from another object's reactors, from a block's list of its inserts and from the list of
fields. An `OLE2FRAME` a space's `unread` lists may be erased, and nothing else of a kind the
reader does not read.

`e.move(handles, transform)` scales each entity by `scale` and turns it by `rotate` degrees
counterclockwise, both about `about`, then moves it by `by`. A turn or a scale names `about`. Every
point, angle and size of the entity moves: an insert with its attributes, a 2D polyline with its
vertices, a dimension with its picture, moved only, a multileader, a hatch with its loops and its pattern, an
image and a wipeout with their vectors, and a viewport on its paper, moved only, with the entity
that clips it. An entity of a named block the file inserts once is erased or moved in its block's
definition, in the block's coordinates, with the warning `edit-block-definition`.

`lintEdit(edit, read)` gives the refusals the read can tell, and never throws: a handle two
statements reach, one the read does not hold or keeps outside `only`, a move of one out of what
`only` keeps, `edit-only`, an attribute or a picture's
entity named alone, an entity of a block inserted more than once, of an anonymous block or of an
xref, a 3D solid, a region or a body, a turn or a scale of a dimension, since the leading CAD
app draws its picture again, a scale of a table or of paragraph text whose codes set a height of its own, a turn or a
scale of an old leader with its note,
an old leader and its note apart, and a turn or a scale of a viewport. An entity on a locked layer is erased or moved with the
warning `edit-locked-layer`. The writers refuse besides what only the file's records tell: a move
of what an associative dimension or hatch names, or of the dimension or hatch, apart from the
other; an erasure of what an associative dimension names, the dimension kept; a reference to what
goes that no rule takes out; a dynamic block's definition; and a handle the file holds twice.

## Stretch and vertices

```ts
e.stretch(["4361F", "4360A"], {
  window: [
    [82960, 156080],
    [83660, 156100],
  ],
  by: [0, -14.25],
});
e.vertices("1035F0F", {
  points: [
    [24297, 98179.4],
    [24297, 97720.5],
    [23658.2, 97720.5],
  ],
});
```

`e.stretch(handles, { window, by })` stretches each entity it names as the leading CAD app's
`STRETCH` does by a crossing window. `window` is two opposite corners, and a point on its edge is
inside. What the window holds of an entity it does not name stays as it is.

- A line, a light or a 2D polyline and a 2D solid: each point inside moves by `by`. A side of a
  polyline whose one end moves keeps its arc's height, so its bulge is worked out again. Widths
  stay.
- An arc whose one end is inside: that end moves, and the arc keeps its height. Its ends are
  worked out from its angles, so an end within the rounding of its sine and cosine of the edge is
  on it.
- An insert with its attributes, paragraph text, a circle and a point move whole when the point
  they are placed by is inside. A justified text moves by its alignment point, a text on the left
  by its start, and an aligned or fitted one by either of its two points.
- A hatch tied to its boundary, a polyline its loop copies: both are stretched by the same
  statement, point by point. A loop the window leaves as it is keeps its boundary as it is, so the
  outer edge of a hatch with a hole stretches and the hole stays. A hatch with no boundary is left as it is unless the window holds
  it whole, as the leading CAD app leaves it, with the warning `edit-stretch-unchanged`.
- An entity whose points are all inside moves as `e.move` moves it, a dimension with its picture.
  One with no point inside is left as it is, with the warning `edit-stretch-unchanged`.

A stretch refuses, with `edit-stretch`: a dimension with some of its points inside, whose picture
would be drawn again; an arc whose middle is inside and one end is not; an ellipse, a spline, a
multileader, an old leader, a table, an image, a wipeout and an underlay; a viewport; and a side
of a polyline, a hatch's loop or a 2D solid that would come to nothing. The entity that clips a
viewport moves only with its viewport, so a stretch or vertices of it is refused with
`edit-part`. The writers refuse a stretch in part of what an associative dimension names, unless
the edit erases the dimension, and in part of an arc, a hatch or a 2D solid not seen from above.

`e.vertices(handle, { points, bulges })` sets a light or a 2D polyline's points, in the world's
coordinates. `bulges` gives one for each side, as the read gives them: an open polyline's one
fewer than its points. Without it each side keeps its bulge, and its widths stay. A light
polyline may take another number of points: then a polyline with arcs needs `bulges`, and one
with widths of each side is refused. It refuses, with `edit-vertices`: another number of points
for a 2D polyline, whose vertex records would be added or erased; a closed polyline's last point
that repeats its first; bulges of another number than its sides; and anything that is not a
polyline. The writers refuse a fitted 2D polyline, and the boundary of an associative hatch or what
an associative dimension names, unless the edit erases the hatch or the dimension.

A stretch and a vertices statement reach what they name, and what a move would take with it, so
one handle in two statements is refused, as for every other statement.

`editedRead(read, edit)` is the read of the file after the edit: what it erases left out of its
space, its census and its lists, what it moves moved, what it gives new points as the edit leaves
it, what it changes changed, with the census of each layer and the fields a whole value takes
out, and what it adds added, with its marks and the edit's record. The objects an erased entity
owns that
the read counts and does not list, and the fields it counts by their code, it leaves as the
source's.

## Change a text, a pen, a layer and a viewport

```ts
export default editDrawing(
  { file: "../2_Sheets/TITLE BLOCK.dwg", sha256: "9c1f…", name: "rev-1" },
  (e) => {
    e.change("126DD", { text: { replace: ["2021", "2026"] } });
    e.change("126CA", { text: "100 MAIN STREET\\PSPRINGFIELD", width: 2.7 });
    e.change("1270A", { text: "11.19.2026" });
    e.change("4361E", { layer: "A-GLAZ-IDEN", color: 1, lineweight: 35 });
    e.change("436A0", { attributes: { SHEET: "C-3", ADDRESS: { replace: ["NORTH", "SOUTH"] } } });
    e.layer("SURVEY|TOPO", { frozen: true });
    e.layer("SURVEY|EOP", { color: 250 });
    e.viewport("2C41", { center: [1204.5, 880], ratio: 1 / 240, freeze: ["SURVEY|TEXT"] });
  },
);
```

`e.change(handle, changes)` changes an entity in place. It keeps its handle, its record, its style
and every format its text does not replace.

- `text` is a whole value, with its codes, or `{ replace: [from, to] }`. In a single-line text
  or a single-line attribute, `from` is found in the value as held, `%%` codes as written, once
  and only once. In paragraph text, and an attribute of paragraph text, `from` is found in the
  characters as the paragraph reads, codes left out and each `\P` a line's end, once and only
  once. `to` takes the format in force at the first character it replaces, written with `\`, `{`
  and `}` escaped and each line's end as `\P`. A group or a stack inside the replaced part goes
  with it, and a code that would change the characters after it is refused. A whole value of
  paragraph text is refused where `parseParagraph` does not lay it out.
- A text that shows a field takes a whole value only: the field goes with its objects, and the
  text holds the value, as a CAD program's conversion of a field to text leaves it. A replacement
  in one is refused, since the field writes its own value back over it.
- `height` is a text's height or paragraph text's, and `width` the width paragraph text wraps at.
  Both keep the text's point and its attachment. Paragraph text of one column takes the width as
  its own and its column's; one of two or more columns, or one whose text the new width would
  flow into a second column, is refused. An aligned text's height its two points set.
- A justified single-line text whose value or height changes starts where the widths of its
  font's characters put it, and an aligned or a fitted one takes the height or the width factor
  that keeps it between its points. Where the widths do not give it exactly, such as a value with
  `%%` codes or a TrueType text justified Middle, a DXF keeps the start it holds, which a CAD
  program works out again when it reads the file, and a DWG, which stores the start a CAD
  program draws from, refuses the change.
- `attributes` changes an insert's attributes by tag, each as `text` is.
- `layer`, `color` (1 to 255, 0 for ByBlock, 256 for ByLayer), `trueColor` (0xRRGGBB, with the
  nearest index beside it), `linetype` (one the file holds, `ByLayer` or `ByBlock`), `lineweight`
  (in hundredths of a millimetre, as the read gives it, or `ByLayer`, `ByBlock` or `Default`)
  and `linetypeScale` set the entity's own pen. A 2D polyline's vertices take it with it. The
  layer and the linetype must be the file's: an edit adds none yet.

`e.layer(name, changes)` changes a layer of the file's table: `on`, `frozen`, `locked`, `plot`,
`color`, `trueColor`, `linetype` and `lineweight`. A host changes an xref's layer, `XREF|LAYER`,
in its own record, marked as the host's override so a reload of the xref keeps it, and sets
`$VISRETAIN` to 1, without which a host keeps no change of an xref's layer. A DWG host whose
`VISRETAIN` is 0 holds no record of an xref's layers, and such a change is refused there. A
change of an xref layer's linetype is not made yet.

`e.viewport(handle, changes)` re-aims a viewport: `center` is the point of model space at its
middle, `ratio` its scale in paper units to drawing units, `twist` its view turned in degrees.
`on` turns it on or off, and `freeze` and `thaw` list layers to freeze in it alone and to thaw.

`lintEdit` refuses besides: a change of a kind that holds no text or no width, a `from` found
nowhere or more than once, a layer, linetype or attribute tag the file lacks, a change of an
entity of a block the file inserts more than once, and a viewport re-aimed out of what the read
with `only` keeps. A change on a locked layer is made with the warning `edit-locked-layer`, and
one of a block inserted once with `edit-block-definition`.

## Additions

```ts
export default editDrawing(
  { file: "../1_Model/FLOOR PLAN.dxf", sha256: "9c1f…", name: "rev-1" },
  (e) => {
    e.model((d) => {
      d.layer("NOTES", () =>
        d.text([1204.5, 880], "NEW WINDOW G", { height: 4.5, style: "ROMANS" }),
      );
      d.layer("DIMENSIONS", () =>
        d.linearDimension([1200, 860], [1236, 860], [0, 850], { style: "DETAILS", id: "g-width" }),
      );
    });
    e.layout("FLOOR PLAN", (sheet) =>
      sheet.layer("REV-1", { color: 6 }, () => sheet.rect([20, 2], 3, 2)),
    );
  },
);
```

`e.model(draw)` gives the drawing builder over the file's own layers, linetypes, text, dimension,
multileader and table styles and blocks, in the file's units, `$INSUNITS`, or the edit's `units`
for a file of none. `e.layout(name, draw)` gives it on the paper of one of the file's layouts, in
the layout's own units; `ReadLayout.plotScale` says what it plots at. A name the file holds is the
file's, found as the leading CAD app finds it: an addition uses it as the file defines it, the edit
writes none, and another definition of it is refused with the rule `file-definition`. A layer of the
file named with no options is the file's; one named with other properties is refused. A name the
file lacks is defined by the edit. The file's own `Standard` multileader, dimension and table styles
are named `Standard`. Under a standard, a text role's and a leader style's `styleName` names the
firm's style: in an edit of a file that holds it, the addition draws in it, and a new drawing that
draws to a `styleName` of `Standard` is refused. Every addition names its layer.

An entity takes its own `linetypeScale`, group 48, and a dimension its own `scale`, `DIMSCALE`,
which the writers write as the dimension's override of its style's, the extended data `ACAD`,
`DSTYLE`. A dimension style's `lineExtension`, `DIMDLE`, is how far a tick's dimension line runs
past each extension line; it defaults to the arrow size.

Each addition's handle is counted from the file's `$HANDSEED`, in a fixed order: the spaces'
entities first, then the blocks they need, then the table records, then the objects, so the same
file and edit give the same handles. Each entity added, and each table record and named block the
edit defines, carries a mark, extended data under the application `TSDRAFT`: the mark's format, 1,
the edit's name, the addition's id, or `@model/3` for the fourth of model space with none and
`@layout/Sheet1/3` for one of a layout, the handle it was written with, and a hash of what it held, `markHash`. The file keeps a record of each
edit's additions, an `XRECORD` of the edit's name in the dictionary `TSDRAFT` of the named object
dictionary: group 70 the mark's format, then each id, group 1, and its handle, group 2. Both readers
give an entity's `mark` and the file's `edits`. An id is compared without regard to case, and one the edit gives may not start with `@`.

`markUnchanged(entity)` is true of an entity whose mark holds its own handle and whose hash matches
what it holds: it is still the one the edit wrote. A copy a person makes with the leading CAD app's
`COPY`, `MIRROR` or `ARRAY` carries the mark with another's handle, and a move or any other change
makes the hash differ; a save of the file in that app keeps every mark unchanged, in both formats.

### A later edit of the same name

An edit planned on a file that holds an earlier edit's record of the same name replaces that edit's
additions:

- an addition whose id the record holds and whose entity is unchanged is written over it, in its
  place and with its handle, where the kind is the same; of another kind, the old one is erased and
  the new one takes a new handle, with the warning `edit-id-kind-changed`;
- an unchanged addition whose id the new edit drops is erased, and an edit that adds nothing erases
  them all;
- an addition whose entity a person changed is refused, `edit-mark-changed`, until the edit erases
  that entity by handle or gives the addition another id, and one whose entity a person erased,
  `edit-mark-erased`, until it gives another id;
- an addition a read with `only` leaves out is refused, `edit-only`: read the part that holds it.

An edit of another name leaves them alone, and may erase or move one by handle as it would any
entity. `replacement(read, edit)` says what an edit makes of an earlier one's additions.

`lintEdit` refuses an addition the writers cannot make: additions that do not hold a drawing's shape
or hold more than 100,000 items, a file with no `$HANDSEED`, a style of the file tsdraft does not
draw in, such as one whose arrowhead it does not draw, a linear or aligned dimension at an angle in a
style that keeps its text level, a radial dimension whose text is placed along it in such a style,
a justified text in the file's `Standard` when its font is not the one tsdraft measures
`Standard` in, an id used twice across the spaces, a definition of a name the file holds other than
the file's, and an image or an underlay, which an edit does not add yet. It warns of an addition on a layer that is off, frozen, set not to plot, `Defpoints`
or `0`, or that a viewport of the file freezes.

## The preview

`tsdraft render` and `tsdraft dev` take an edit file as they take a drawing file, and draw the file
it edits as it will plot after the edit, from `editedRead(read, edit)`: model space and each
layout, at the sheet's own pens, with the xrefs found beside the file. A second picture, the
picture of changes, draws every entity the edit does not reach faint, each it erases dashed in red
where it was, each it moves, stretches or changes dashed in amber where it was and at full strength
where it goes, and each it adds at full strength. A change of a layer draws every picture again.
`dev` toggles between the two with the Changes button or the C key, and serves the second at
`/drawing.svg?changes=1`. The JSON's `edit` gives each statement with its call, its handles and
its box in model space and on each sheet, and `lintEdit`'s diagnostics come with the others, each
with the call of its statement. A statement `lintEdit` gives an error for is left out of the
pictures, as `editedRead` leaves it out. A file whose SHA-256 is not the edit's is drawn as it is.

`dev` keeps the read of the file and its pictures in a process of its own, as fragments, one for
each entity, and joins them after each save, leaving out what the edit erases and drawing again
only what it moves, so a save is drawn in a time in proportion to the picture, not to the read.
`editPreview`, `changesPicture` and `statementPlace` are the core's parts of it.

## The copy

`editDXF(bytes, edit, read)` makes the edited copy of a DXF of the 2018 format, `AC1032`. Each
record the edit does not change is copied as the file holds it, line ends included, so an edit that
changes nothing gives the file back byte for byte. It throws only an `EditError`:

- for bytes whose SHA-256 is not the edit's, or a `read` of other bytes;
- for a file of another format, a binary DXF, or one past the most records a document lists;
- for a statement or an addition `lintEdit` refuses, or one the file's records refuse, with
  `statement` the place of a statement in the edit.

Additions are written by the core's DXF writer at its six decimals, each space's as a drawing of
its own, and each of its records is the file's of the same name or new: entities before the end of
their space, a block at the end of `BLOCKS`, a table record before its table's end with the table's
count raised, an object at the end of `OBJECTS`, named in its dictionary, and a class at the end of
`CLASSES`. A new insert of the file's block joins the block's list of its inserts, and `$HANDSEED`
is raised past every handle added.

A record an erasure leaves out is left out with its line ends. A record a move changes keeps every
group but the values of its points, angles and sizes, each written in the fewest digits that read
back as the same number; one the file leaves out at its default, such as an insert's rotation, is
written where the edit changes it.

An editor of another format, such as DWG, is a package, as a reader is: it names its module in
its `package.json` under `"tsdraft": { "editors": { ".dwg": "./dist/edit.js" } }`, beside its
reader, and the module exports `editor`, a `FileEditor`: its read with geometry, its edit, its
structure check, its records by key and what each record links to, its owner and the handles it
refers to. `dxfEditor` is the core's own. Its `read` gives a `DrawingRead` in the read format of the tsdraft it
runs with, `READ_FORMAT`, which is 1: the command takes a read in format 0 from a reader built for
an older tsdraft, but uses an editor's read as it is.

## The checks of every job

`checkEditedCopy(editor, source, read, edit, written)` runs the checks a copy passes before a write
leaves it, each against the source as it was, so a defect the firm's file already had is told from
a new one:

| Check          | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read-back`    | The written file reads, with no more of `unread.malformed` than the source                                                                                                                                                                                                                                                                                                                                                                                          |
| `structure`    | The structure check finds no defect the source does not hold. `own` counts the source's                                                                                                                                                                                                                                                                                                                                                                             |
| `before-after` | Every record the edit does not reach is the source's, byte for byte, in its place. A record is gone only where the edit erases it or what owns it, and changes only where the edit moves it or what owns it, takes references to what it erases out of it, or gains references to what it adds. A new record takes a handle from the source's `$HANDSEED` on, and the header changes in its seed alone. The written file reads as `editedRead` says, to nine digits |
| `lint`         | `lintEdit`'s errors, those of the additions among them                                                                                                                                                                                                                                                                                                                                                                                                              |
| `sheets`       | The sheets whose picture the edit changes, drawn as they plot. None yet                                                                                                                                                                                                                                                                                                                                                                                             |

`dxfStructure(bytes)` is the structure check of a DXF, as the leading CAD app's `AUDIT` would find a
fault: every handle once and below `$HANDSEED`, every owner and pointer, groups 330 to 369, 390 to
399, 480 and 481, naming a record, every layer naming its plot style, every entity's layer,
linetype and text or dimension style a record of its table, and a block's list of its inserts,
where the file keeps one, naming each of them. A defect names handles and names, never offsets, so
the defects of a file and of its copy compare. It never throws: groups that do not read are one
defect, `unreadable`.

## `tsdraft write`

`tsdraft write <edit file>... [--out <dir>] [--root <dir>]` makes the edited copy of each file the
edit files name, as one job, and prints the job as JSON. For each edit file:

1. It loads the edit file and finds the file it names.
2. It looks for a lock beside the file: one named as it with `.dwl` or `.dwl2` for its extension,
   in any case. A lock is a warning, since a copy writes nothing of the firm's.
3. It checks the file's SHA-256 against the edit's. Another is refused: the file changed after
   the edit was planned.
4. It reads the file and makes the edit. An edit `lintEdit` gives an error for is refused, and
   its JSON gives each error with the call of its statement in `diagnostics`.
5. It makes the copy and runs the checks of every job on what it made, in a
   process of its own, under the limits below.
6. It writes the copy to a temporary file in the folder it goes to, checks that the bytes on the
   disk are the ones the checks passed, and renames it to the source's path from the job's root,
   under `--out`, `out/` beside the edit files by default. The root is `--root`, or else the
   deepest folder that holds every source of the job and every sheet the edits name, so an edited
   sheet's relative path to an edited model holds among the copies.

A copy that fails a check is not written, and its JSON says which check and why. It never writes a
source's own path or a sheet's, by any path to it, and refuses two edits of one file in one job. It
keeps a record, `.tsdraft-write.json` in the out folder, of each copy it wrote and its SHA-256, and
replaces a file at a copy's path only when the record names it with the bytes it holds: so a second
run replaces its own copies, and never a file it did not make or a copy a person changed. It exits 0 when every copy was
written and 2 when any was not. A `.dwg` needs an installed package that edits it, found as a
reader is ([Which reader](command.md#which-reader)), or `--reader`.

| Limit of one edit's process                   | Default |
| --------------------------------------------- | ------- |
| The process's heap, as `--max-old-space-size` | 4096 MB |
| The time until it answers                     | 300 s   |
| The size of the file it writes                | 1 GB    |

The process runs under `prlimit --core=1:1 --cpu=<seconds> --` where there is one, as a read's
does.
