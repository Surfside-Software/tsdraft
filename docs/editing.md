# Editing a firm's drawing

An edit changes a drawing file a firm already has, and keeps the rest of it as the file holds it.
It names the file by its path and by the SHA-256 of the bytes it was planned on, so it is never
made on other bytes, and it is written to an edited copy, never over the firm's file.

This version makes the copy and its checks: an edit states no change yet, and an edited copy is
the file as it was. The statements that erase, move, change and add come in later versions, on
this footing.

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

## The copy

`editDXF(bytes, edit, read)` makes the edited copy of a DXF of the 2018 format, `AC1032`. Each
record the edit does not change is copied as the file holds it, line ends included, so an edit that
changes nothing gives the file back byte for byte. It throws only an `EditError`:

- for bytes whose SHA-256 is not the edit's, or a `read` of other bytes;
- for a file of another format, a binary DXF, or one past the most records a document lists;
- for a statement or an addition this version does not make, with `statement` its place in the
  edit.

An editor of another format, such as DWG, is a package, as a reader is: it names its module in
its `package.json` under `"tsdraft": { "editors": { ".dwg": "./dist/edit.js" } }`, beside its
reader, and the module exports `editor`, a `FileEditor`: its read with geometry, its edit, its
structure check and its records by key. `dxfEditor` is the core's own. Its `read` gives a
`DrawingRead` in the read format of the tsdraft it runs with, `READ_FORMAT`, which is 1: the
command takes a read in format 0 from a reader built for an older tsdraft, but uses an editor's
read as it is.

## The checks of every job

`checkEditedCopy(editor, source, read, edit, written)` runs the checks a copy passes before a write
leaves it, each against the source as it was, so a defect the firm's file already had is told from
a new one:

| Check          | What it holds                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `read-back`    | The written file reads, with no more of `unread.malformed` than the source                                                                    |
| `structure`    | The structure check finds no defect the source does not hold. `own` counts the source's                                                       |
| `before-after` | Every record the edit does not reach is the source's, byte for byte, none is gone or new, and the written file reads as the edit says it does |
| `lint`         | What the edit adds, against its standard. Nothing yet                                                                                         |
| `sheets`       | The sheets whose picture the edit changes, drawn as they plot. None yet                                                                       |

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
4. It reads the file, makes the edit and runs the checks of every job on what it made, in a
   process of its own, under the limits below.
5. It writes the copy to a temporary file in the folder it goes to, checks that the bytes on the
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
