# The Drawing format

A `Drawing` is plain data: its units, layers, linetypes and entities, with no methods. `lint`,
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

A drawing written by hand needs `format: 0` too. `lint` reports a drawing without it, or with
another version, under the rule `format`, and `toDXF` refuses to write it.

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

- `entity`, the entity's index in `drawing.entities`;
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

The builder's `layer`, `linetype` and entity methods throw a `DrawingError` when a call breaks a
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
