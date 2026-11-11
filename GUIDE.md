# A guide for agents

This page is for an agent that has not used tsdraft before. It covers the setup, the loop to
work in, what the command prints, and what tsdraft cannot draw yet.

## What tsdraft is for

tsdraft writes 2D CAD drawings from TypeScript. You write a drawing file, a program that calls
a builder, and tsdraft exports the drawing as DXF for a CAD program. The `tsdraft` command
shows you the drawing as a picture and as JSON in a fraction of a second, with no CAD program,
so you can check your work after every edit.

Both are in one npm package, `tsdraft`: the library, which is the builder, `lint`, `toDXF` and
`toSVG`, and the `tsdraft` command.

## Setup

The command needs Node 22.18 or later, because Node runs the drawing file by stripping its
types. It has been run on Linux only.

```sh
npm init -y
npm pkg set type=module
npm i -D tsdraft
```

The project's `package.json` must say `"type": "module"`, or the drawing file must be named
`.mts`. `npm init` writes `"type": "commonjs"`, and Node then refuses the file's `import`.

## A drawing file

A drawing file is a TypeScript module whose default export is a drawing, or a function that
returns one. Save this as `plan.ts`:

```ts
import { createDrawing, DASHED, fromPaper } from "tsdraft";

// The sheet plots at 1" = 10', a ratio of 120, and the drawing is in feet.
const view = { ratio: 120, units: "ft" } as const;
const note = fromPaper(3 / 32, "in", view); // text 3/32" high on paper

const d = createDrawing({ units: "ft", linetypeScale: fromPaper(1 / 2, "in", view) });

d.layer("C-PROP", { color: 7, lineweight: 0.5 }, () => {
  d.rect([0, 0], 100, 140, { id: "lot" });
  d.text([2, -3], "LOT 12", { height: note });
});
d.layer("C-SETB", { color: 8, linetype: DASHED }, () => {
  d.rect([7.5, 25], 85, 95, { id: "setbacks" });
});
d.layer("A-BLDG", { color: 4, lineweight: 0.7 }, () => {
  d.rect([24, 30], 52, 44, { id: "house" });
  d.line([50, 30], [50, 30], { id: "walk" });
});

export default d.build();
```

Coordinates are in drawing units with Y pointing up. Angles are in degrees, counterclockwise
from +X. A layer's color is an AutoCAD Color Index number from 1 to 255, and a lineweight is in
millimetres. Entities drawn inside a `layer()` callback go on that layer. The builder draws
`line`, `polyline`, `rect`, `circle`, `arc` and `text`.

Give an entity an `id` when you will want to find it again: 1 to 64 letters, digits, `.`, `-`
and `_`, each used once in a drawing. A diagnostic about the entity carries the id.

## The loop

1. Write or edit the drawing file.
2. Run `npx tsdraft render plan.ts`. It prints one JSON object and writes the files named in
   its `outputs`, an SVG and a PNG in an `out` folder beside the file. Open a picture by its
   path in `outputs`, never by a name you expect: when a run writes no picture, `outputs` has
   `null` for it. That run also clears the old picture from `out`, but not from a folder you
   named with `--out`.
3. Read the JSON. If `ok` is false, fix `error.file` at `error.line`. If `diagnostics` is not
   empty, fix each one, errors first.
4. Look at the PNG at `outputs.png`. The JSON says whether the drawing breaks a rule. Only the
   picture shows whether it is the drawing you meant. When `outputs.png` is `null`,
   `outputs.pngError` says why, and `outputs.svg` is the same picture.
5. Repeat from step 1.

`render` exits 0 when the drawing built with no lint errors, 2 when `lint` reported errors,
and 1 when the build failed before `lint` could report or a file could not be written. Stdout holds only the JSON. `--out <dir>` changes the folder and
`--width <px>` the PNG's width, which is 1600 by default.

The picture is the drawing as it plots, on a dark background. A layer that is off, frozen or
set not to plot is left out, and `--draw-no-plot` draws the layers that do not plot too.

The PNG renderer, `@resvg/resvg-js`, is an optional dependency that npm installs by default.
Where it is missing, after an install with `--omit=optional` or on a machine it has no build
for, `render` still writes the SVG and exits as above, and the JSON has `"png": null` with the
reason in `pngError`. `npm i -D @resvg/resvg-js` adds it.

When a person is watching, run `npx tsdraft dev plan.ts` and give them the address it prints,
`http://127.0.0.1:4610` unless that port is taken. The page redraws each time the file, or a
file it imports, is saved. The same server answers you without a browser:
`/state.json?after=<build>&session=<session>` waits for a build newer than the one you last
read and returns the same JSON, and `/drawing.png?width=<px>` is the picture. The command runs
until it is stopped, so start it in the background.
[docs/command.md](https://github.com/Surfside-Software/tsdraft/blob/main/docs/command.md) has
the details.

## What the JSON holds

`render` printed this for the file above, shortened here:

```json
{
  "schema": 2,
  "ok": true,
  "build": 1,
  "file": "/work/plan.ts",
  "drawing": {
    "units": "ft",
    "dxf": "R2018",
    "extents": { "min": [0, -3], "max": [100, 140] },
    "counts": { "layers": 4, "entities": 5, "blocks": 0, "xrefs": 0, "errors": 0, "warnings": 1 },
    "layers": [
      {
        "name": "C-SETB",
        "color": 8,
        "linetype": "DASHED",
        "lineweight": "Default",
        "off": false,
        "frozen": false,
        "plot": true,
        "entities": 1
      }
    ],
    "blocks": [],
    "inserts": [],
    "xrefs": []
  },
  "diagnostics": [
    {
      "rule": "zero-length",
      "severity": "warning",
      "message": "line #4: the line has no length",
      "entity": 4,
      "id": "walk",
      "call": { "file": "/work/plan.ts", "line": 18, "column": 5 },
      "kind": "line",
      "layer": "A-BLDG",
      "bounds": { "min": [50, 30], "max": [50, 30] }
    }
  ],
  "error": null,
  "outputs": { "svg": "/work/out/plan.svg", "png": "/work/out/plan.png", "pngError": null }
}
```

- `ok` says whether the file ran and gave a drawing. Lint errors do not make it false, so read
  `drawing.counts.errors` or the exit code as well.
- `drawing.extents` is the box around everything drawn, in drawing units. Use it to check the
  drawing's size against what you meant.
- `drawing.layers` lists every layer with its color, linetype, lineweight, state and the
  number of entities on it. Layer `0` is in every drawing.
- `drawing.blocks` lists every block with the number of entities it holds, the tags of its
  attributes and how many inserts place it. `drawing.inserts` lists every insert in model
  space: its `entity` index, `block`, `layer`, `id`, `at`, `scale`, `rotation`, and the value
  it shows for each attribute. An insert is one entity, whatever its block holds.
- `drawing.xrefs` lists every xref with its `name`, its `path`, how many `inserts` place it,
  `shown` and `units`. `shown` says whether the pictures drew the drawing your file exports
  under that name. The command cannot tell whether that drawing is what the file at `path`
  holds, and the two can differ. When `shown` is false you are not seeing the xref at all, and
  neither are the extents. `units` is the units of the drawing you gave, or `null`: where it
  differs from `drawing.units`, each insert needs a scale.
- `diagnostics` is what `lint` found. An error stops `toDXF` from writing the file. A warning
  does not. An error about the shape of a value, such as a field of the wrong type, gives
  `item`, the path of the item that holds it, such as `entities[3]`.
- `drawing.omitted` lists the `item` of everything the pictures, the extents and the lists
  leave out, because the drawing could not be drawn with it. A problem of an entity left out,
  by itself or with its block or list, has no `kind`, `layer` or `bounds`. `drawing.counts` still counts the whole drawing.
  Without `omitted`, you are seeing all of it.
- `error` is why a build failed: its `message`, and the `file`, `line` and `column` of your
  code.

To act on a diagnostic, open `call.file` at `call.line`. That is the builder call that drew the
entity, so it is the line to change. `id` is the id you gave the entity, and `entity` is its
index in the drawing. In the output above, line 18 of `plan.ts` draws a line from a point to
the same point: give it a second point, or delete it. When a helper function drew the entity,
`call` is the line inside the helper.

When a builder call breaks a rule, the build fails at that call. `ok` is false, `error` has the
message and the line, and `diagnostics` holds that one problem with its `rule` and `call`.

## Sizing text with `fromPaper`

A drawing is in real units, such as feet, and it plots at a scale. Text that should plot 3/32
inch high at 1" = 10' has to be 0.9375 ft high in the drawing. `fromPaper` does that sum:

```ts
const view = { ratio: 120, units: "ft" } as const; // 1" = 10' is 1:120
const note = fromPaper(3 / 32, "in", view); // 0.9375
```

The first two arguments are a length on paper, in `"in"` or `"mm"`. `ratio` is the scale as a
plain ratio and `units` is the drawing's units. Size every text height, symbol, gap between a
line and its label, and the linetype scale this way, from one `view`, and never as a bare
number of drawing units. Then the annotation keeps its plotted size when the scale changes.

## The file to copy

[`examples/site-plan.ts`](https://github.com/Surfside-Software/tsdraft/blob/main/examples/site-plan.ts)
in the tsdraft repository is a whole sheet: a permit-style site plan at 1" = 10' with property
lines, setbacks, a building, dimension strings, labels, notes and a legend, laid out for a
landscape ARCH D sheet, 24 by 36 inches. The sheet is a parameter, and every block is placed
from it. Start a new drawing from it. It is not in the npm package. Copy it and
[`examples/lib/drafting.ts`](https://github.com/Surfside-Software/tsdraft/blob/main/examples/lib/drafting.ts),
keeping `drafting.ts` in a `lib` folder beside it. Change two import strings to `"tsdraft"`:
`"../src/index.ts"` in `site-plan.ts`, and `"../../src/index.ts"` in `lib/drafting.ts`.

Its parameters come first and every position is worked out from them. Its dimension strings and
arrowheads are functions in `drafting.ts` that draw lines and text. Its symbols are blocks.

## Blocks

Draw a symbol that repeats once, as a block, and place it with inserts:

```ts
d.block("TREE", {}, () => {
  d.circle([0, 0], 1);
  d.attribute("TAG", [0, 1.2], { value: "T-0", height: 0.3, align: "center" });
});
d.layer("V-TREE", { color: 3 }, () => {
  d.insert("TREE", [15, 112], { scale: 5, attributes: { TAG: "T-1" } });
});
```

- A block's coordinates are its own. `{ base: [x, y] }` names the point an insert puts at its
  `at`, `[0, 0]` unless given.
- Draw a block's entities on layer `0`, which is where they go unless a `layer()` call inside
  the block says otherwise. They then draw as the layer of each insert does.
- `scale` is a number, or `[x, y]`. A negative scale mirrors. `rotation` is in degrees.
- An insert on a layer that is frozen or does not plot draws nothing of its block.
- An attribute is a text each insert sets by its tag. A tag is in capitals. An insert that
  sets none shows the default.
- A block is defined before it is inserted, and once.
- An insert cannot have a linetype, a lineweight or a color of its own. It draws as its layer
  does, and so does what its block holds on layer `0`.

The pictures draw each insert as what its block draws. The example sheet draws its trees,
property corners, north arrow and view title this way, with the view title's text and scale as
attributes.

## Xrefs

Reference another drawing's DWG file and place it as you place a block. CAD loads the file
each time it opens the drawing:

```ts
d.xref("BASE", "base.dwg");
d.layer("X-BASE", { color: 8 }, () => d.insert("BASE", [0, 0]));
```

- The path leads from the folder the drawing's file is written to: `"base.dwg"`,
  `"../civil/base.dwg"`. An absolute path, an empty one, a `.dxf`, a path that ends in a dot,
  and a path with any of `* ? < > | : "` are errors.
- The file must be a DWG. tsdraft cannot check that it is there. When it is not, CAD opens
  the drawing and draws the path as a small text at each insert, unless a file of the same
  name is in the drawing's own folder: it loads that one, and says nothing of the change.
- CAD draws the insert at the scale you give, whatever units the two drawings are in. A base
  in feet under a drawing in inches needs `{ scale: 12 }`.
- Layer `0` of the referenced file draws as the insert's layer does, and its other layers as
  themselves.
- Place every xref at least once. `lint` warns of one that no insert places, which CAD drops.

The command opens no DWG, so the pictures leave an xref out unless the drawing file gives the
drawing it stands for. When that drawing is a tsdraft file too, import it and export it under
the xref's name:

```ts
import base from "./base.ts";

export const xrefs = { BASE: base };
export default d.build();
```

The command checks each drawing you give as it checks yours. One with a `lint` error is not
drawn: `shown` is false, and each error is a diagnostic that names the `xref`.

Read `drawing.xrefs` in the JSON before you trust a picture of a drawing with xrefs. A picture
with `shown: true` shows the drawing you exported, which is only as current as the DWG file CAD
will load is: write that file again from the same drawing when it changes.
[docs/xrefs.md](https://github.com/Surfside-Software/tsdraft/blob/main/docs/xrefs.md) has the
rest.

## Rules as compile errors

tsdraft holds a drawing to the rules AutoCAD enforces. AutoCAD discards a whole file over one
bad layer name. A value written as a literal is checked by the TypeScript compiler, and the
error message says what is wrong:

```ts
d.layer("A/WALL", { color: 4 });
// error TS2345: Argument of type '"A/WALL"' is not assignable to parameter of type
// '"Layer names cannot contain < > / \\ \" : ; ? * | = ` ^ , or line breaks"'.
```

`tsdraft render` does not run the compiler. Node strips the types and runs the file, the
builder throws the same message at the same call, and the JSON reports it. To see compile
errors before running, install `typescript` and `@types/node`, add this `tsconfig.json`, and
run `npx tsc`:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "types": ["node"]
  },
  "include": ["*.ts"]
}
```

Use only TypeScript that can be erased: no enums, namespaces or parameter properties. Import
your own files with their `.ts` extension. The rules are listed in
[docs/rules.md](https://github.com/Surfside-Software/tsdraft/blob/main/docs/rules.md).

## Writing the DXF

The drawing file only exports the drawing. Write the DXF from a second file, and run it with
`node write.ts`:

```ts
import { writeFileSync } from "node:fs";
import { toDXF } from "tsdraft";
import drawing from "./plan.ts";

writeFileSync("plan.dxf", toDXF(drawing));
```

`toDXF` throws a `DrawingError` that lists the problems when the drawing has lint errors.

## What tsdraft cannot draw yet

- Dimension objects, leaders, hatches and fills. The example sheet draws its dimensions from
  lines and text, so in CAD they are plain lines and text.
- A block read from another file. A block is drawn in the drawing that inserts it. An xref
  references a whole DWG file, as an overlay, and the pictures draw it only from a drawing you
  give.
- Attributes of more than one line, and attributes that are hidden or constant.
- Paper space: layouts, viewports, a border or a title block. Everything is in model space, and
  a drawing has one scale, which is the `view` you pass to `fromPaper`.
- Multiline text. A text is a single line. It takes a text style with a font, and `align` and
  `valign` to justify it to its point, as the example sheet does.
- Ellipses, splines, and curved segments in a polyline.
- A color on a single entity. Color comes from the layer.
- DWG files. tsdraft writes DXF.
- An existing drawing. tsdraft does not read DXF or DWG.

When a drawing needs one of these, say so. Do not imitate it with something that will mislead
whoever opens the file, except where the example sheet shows the way, as it does for
dimensions.
