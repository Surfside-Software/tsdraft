# The Drawing format

A `Drawing` is plain data: its units, layers, linetypes, text styles and entities, with no
methods. `lint`,
`toDXF` and `toSVG` all read it, and it can be saved as JSON and read back.

```ts
import { createDrawing, fromJSON, toDXF, toJSON } from "tsdraft";

const d = createDrawing({ units: "ft" });
d.layer("A-WALL", { color: 1 }, () => d.line([0, 0], [10, 0], { id: "wall-north" }));
const drawing = d.build();

const json = toJSON(drawing);
// {"dxf":"R2018","entities":[{"from":[0,0],"id":"wall-north","kind":"line","layer":"A-WALL","to":[10,0]}],"format":0,…}
const read = fromJSON(json);
toDXF(read) === toDXF(drawing); // true
```

## Format 0

Every drawing has `format: 0`. The format version says how the `Drawing` object is laid out. It
is separate from `dxf`, the DXF version the drawing is written for.

Format 0 carries no promise of stability. A later version of tsdraft may add, rename or remove
fields without reading drawings saved by this one, so save the code that builds a drawing, and
treat its JSON as a copy made by one version of tsdraft for the same version to read. A stable
format with a version above 0 comes once a drawing with blocks and layouts can be saved and
read back.

A drawing lists its text styles in `textStyles`, and leaves the field out when it has none but
`Standard`. A text has `style`, `align` and `valign` only where they differ from `"Standard"`,
`"left"` and `"baseline"`, so a drawing that uses none of them has the JSON it had before they
existed.

A drawing lists its blocks in `blocks`, and leaves the field out when it has none. A block has
a `name`, its `entities`, and where they differ from their defaults a `base` point and its
`attributes`: each a `tag`, a `value`, a `layer` and the fields of a text, with a `prompt`
where it is not the tag. An insert is an entity of kind `"insert"`, in `drawing.entities` or in
a block's `entities`, with its `layer`, `block` and `at`, and `scale` as `[x, y]`, `rotation`
and `attributes`, an object of values by tag, only where they are set. It has no linetype or
lineweight. A drawing with no block has the JSON it had before blocks existed.
[Blocks](blocks.md) describes them.

A drawing lists the files it references in `xrefs`, and leaves the field out when it has none.
An xref has a `name` and a `path`, and nothing else. An insert places one by naming it in
`block`, as it names a block. A drawing with no xref has the JSON it had before xrefs existed.
[Xrefs](xrefs.md) describes them.

A drawing lists its sheets in `layouts`, and leaves the field out when it has none. A layout
has a `name`, a `paper`, its `viewports` and its `entities`, which are the same kinds as model
space's, and a `plotStyle` where it is not `"monochrome.ctb"`. A viewport has a `layer`, a
`corner`, a `width` and a `height` on the paper, the `center` of its view in model space and
its `ratio`, and an `id` where it has one. A drawing with no layout has the JSON it had before
layouts existed. [Layouts](layouts.md) describes them.

A drawing lists its dimension styles in `dimensionStyles`, and leaves the field out when it
has none. A style has a `name`, a `textHeight`, an `arrowSize`, an `extensionOffset`, an
`extensionBeyond`, a `textGap` and a `precision`, and where they are set a `textStyle`, an
`arrowhead`, a `scale`, a `prefix`, a `suffix`, `suppressZeros` and a `measurementScale`. A
dimension is an entity of kind `"linear-dimension"` or `"aligned-dimension"`, in
`drawing.entities` or in a layout's `entities`, with its `layer`, `style`, `from` and `to`,
and a `text` where it has one. A linear one has `line`, a point of its dimension line, and an
`angle` where it does not measure along X, from -360 to 360; the builder keeps it from 0 up to 360. An aligned one has `offset`. Neither has a
linetype or a lineweight. A drawing with no dimension has the JSON it had before dimensions
existed. [Dimensions](dimensions.md) describes them.

A drawing written by hand needs `format: 0` too. `lint` reports a drawing without it, or with
another version, under the rule `format`, and `toDXF` refuses to write it. `lint` takes any
plain data and never throws: a list that is not an array, an entity of an unknown `kind`, a
missing field, a field of the wrong type and a field it does not know are each an error, with
the path to the value as `fromJSON` gives it.

## Ids

An entity may have an `id`, set through the options of the call that draws it:

```ts
d.circle([5, 5], 2, { id: "column-A1" });
```

An id is a name for one entity that stays the same while the code around it changes, which the
entity's index in `drawing.entities` does not. A diagnostic about the entity carries it, and
`toSVG` writes it on the entity's element as `data-id`, beside `data-entity`.

- An id has 1 to 64 characters: the letters A to Z and a to z, digits, `.`, `-` and `_`.
- No two entities of a drawing share an id. Ids are compared without regard to case, so
  `Door-1` and `door-1` are the same id, and each is kept as it was written.
- Ids are optional. An entity without one gets none.

A wrong literal id is a compile error. The builder checks every id when the code runs, and
`lint` reports them under the rules `id` and `duplicate-id`. The DXF writers do not write ids.

### An id gives a handle

In an R2018 DXF every object has a handle, a number that is unique in the drawing and written
in hexadecimal. AutoCAD names an object by its handle. When another drawing attaches yours as
an xref and someone dimensions one of your entities there, the dimension holds that entity's
handle and nothing else about it.

An entity with an id gets a handle that comes from the id alone:

```ts
import { idHandle } from "tsdraft";

idHandle("column-A1"); // "1C53484D4C9BAB"
```

- The entity keeps that handle when other entities, layers, linetypes and text styles are
  added, removed or reordered, and when the entity itself changes. That much is guaranteed.
- What another drawing has tied to the handle is AutoCAD's to place. A dimension on the ends
  of a line or the quadrants of a circle follows the entity when it moves and the xref is
  reloaded. That is not promised when the entity becomes another kind of entity, or when a
  polyline gains, loses or reorders vertices.
- An entity with no id gets the next handle counted up from 1, after the tables. Add a layer
  or an entity in front of it and it has another handle. AutoCAD then leaves a dimension that
  was on it where it stood, or ties it to whichever object has the old handle now, and reports
  neither.
- Renaming an id gives the entity another handle. Changing only its capitals does not:
  `Door-1` and `door-1` give one handle, as they are one id.
- Giving an id to an entity that had none moves its handle once, from the counted one to the
  id's. Whatever another drawing had tied to the entity is lost at that moment.
- In a drawing in which no entity has an id, every handle is counted, and `$HANDSEED` is the
  next one.

The handle is worked out like this. Let `h` be the 64-bit FNV-1a hash of the ASCII bytes of
the id in lower case, with the offset basis `cbf29ce484222325` and the prime `100000001b3`.
The handle is

```text
2^52 + ((h AND (2^52 - 1)) XOR (h >> 52))
```

For `column-A1`, `h` is the hash of `column-a1` and the handle is `1C53484D4C9BAB`. What
`idHandle` returns for an id will not change in any later version of tsdraft, because another
drawing may hold the handle. `idHandle` throws on a string that is not a valid id.

A block's own objects, its attribute definitions and the attributes of an insert that has an
id take handles from their names in the same way: see [Handles](blocks.md#handles). So do a
dimension style and the block of a dimension's picture: see [Handles](dimensions.md#handles).

Handles from ids lie from `10000000000000` to `1FFFFFFFFFFFFF`, far above the counted ones,
and a drawing that has ids has a `$HANDSEED` of `20000000000000`. AutoCAD numbers the objects
it adds from the seed up, so they stay clear of every handle an id can give.

Two ids can give one handle, though among a million ids the chance is about 1 in 10,000.
AutoCAD discards a drawing in which two objects have one handle, so the builder refuses the
second id and `lint` reports it under the rule `id-handle`, naming both. Change one of them.

The R12 writer writes no handles. The rule holds for a drawing made for R12 all the same,
because `toDXF` can write any drawing as R2018.

## toJSON

`toJSON(drawing)` returns the drawing as canonical JSON, so that equal drawings give the same
string:

- no white space;
- the keys of every object sorted by UTF-16 code unit, whatever order they were set in;
- each number in the shortest form that reads back as the same number, as `JSON.stringify`
  writes it, except that negative zero is written `-0`;
- a field whose value is `undefined` left out.

It writes the drawing as it is and does not run `lint`. It throws when the drawing holds a value
JSON cannot, such as `NaN`.

## fromJSON

`fromJSON(json)` takes a JSON string, or the value `JSON.parse` gives, and returns the
`Drawing`. A value that passes is returned as it is, not copied. It throws a `DrawingError`
whose `diagnostics` name every problem:

- a `format` it does not know, which is anything but the number 0;
- a field it does not know, at any level, such as `entities[3]: unknown field "thickness"`;
- an entity `kind` it does not know;
- a missing field, or a value of the wrong type;
- in a value that did not come from JSON text: an object that is not a plain object, a field
  that is inherited, hidden, or a getter or setter, and an array with an empty slot, with a key
  that is not an index, or without the methods of `Array`;
- every error `lint` finds, so a drawing that was read has passed each check the builder makes.

All but the last have the rule `format`. Nothing is dropped or defaulted. A drawing that went
through `toJSON` and `fromJSON` gives the same DXF, and equals the original with every field
whose value is `undefined` removed, since `toJSON` leaves those out.

When a key is repeated in JSON text, the last value is kept, as `JSON.parse` does. So
`{"format":1,"format":0, …}` is read as format 0.

## What a diagnostic carries

A `Diagnostic` from `lint` has a `rule`, a `severity` and a `message`. One about an entity also
has:

- `entity`, the entity's index in `drawing.entities`, or in the entities of `block` or of
  `layout`;
- `block`, the name of the block the entity is in, when it is in one;
- `layout`, the name of the layout the entity is on, when it is on one;
- `id`, the entity's id, when it has one;
- `call`, the line that called the builder method that drew the entity, as
  `{ file, line, column }`, when the
  builder recorded it.

```ts
const d = createDrawing({ recordCalls: true });
d.line([1, 1], [1, 1], { id: "stub" });
lint(d.build());
// [{ rule: "zero-length", severity: "warning", message: "line #0: the line has no length",
//    entity: 0, id: "stub", call: { file: "file:///home/you/plan.ts", line: 2, column: 3 } }]
```

Recording the call of every entity more than doubles the time the builder takes, so it is off
unless `createDrawing({ recordCalls: true })` asks for it. A tool that runs drawing files can
ask for it in every drawing by setting `globalThis.TSDRAFT_RECORD_CALLS = true` before the
files run. The option, when given, wins.

A diagnostic about a block's definition has `block`, and one about an attribute definition has
`block` and `attribute`, its tag. One about a layout has `layout`, and one about a viewport has
`layout`, `viewport`, its index in the layout's viewports, and its `id` when it has one.

The builder's `layer`, `linetype`, `textStyle`, `block`, `attribute`, `layout`, `viewport` and entity methods throw a `DrawingError` when a call breaks a
rule. Its message is the problem, and its one diagnostic has the `rule`, the `id` or the `layer`
the call named, and the `call` that threw. That location costs nothing until a call fails, so it
is always there.

`call` is the line that called `d.line()` or another builder method. When a helper function or
a package draws the entity, `call` is the line inside that helper or package, not the line of
your code that called it.

`call` is read from the JavaScript engine's stack: through `Error.captureStackTrace` where the
engine has it, and from the `stack` of a new error otherwise. `file` is what the stack names: a
`file://` URL for an ES module in Node, a path for CommonJS, and a URL in a browser. `call` is
left out whenever the engine gives no usable stack, or the caller's line cannot be told apart
from tsdraft's own. A location is never a guess.

The calls are kept beside the drawing and are not part of its data, because they hold paths of
the machine it was built on. They are not in `toJSON`, a drawing read by `fromJSON` has none,
and a copy of `drawing.entities` loses them.
