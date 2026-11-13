# Standards

A standard is a firm's CAD standard as data: its layers, pens, linetypes, text roles, scales,
dimension styles, title blocks and sheet formats. A drawing drawn to a standard names its
entries, and takes every property from them: a layer its color, linetype, pen and plot flag, a
text its style and plotted height, a dimension its style, a layout its paper and title block.
The builder refuses what the standard lacks, `lint` holds a drawing to it, and the `tsdraft`
command checks a drawing file against the standard it exports.

AutoCAD opens a drawing that breaks its standard, and `toDXF` writes one: the rules of a
standard are a firm's, not AutoCAD's. The rules that are AutoCAD's, such as a layer name it
refuses, hold in a standard too.

## A standard of your own

Start from the built-in standard, and add what a drawing needs that it lacks:

```ts
import { BUILT_IN_STANDARD, createDrawing, defineStandard } from "tsdraft";

export const standard = defineStandard({
  id: "acme",
  version: "2026.1",
  extends: BUILT_IN_STANDARD,
  disciplines: { A: { title: "Architectural" } },
  layers: {
    "A-WALL": { color: 2, pen: "bold", discipline: "A" },
    "C-ROAD-CNTR": null,
  },
  textRoles: { note: { font: "romans.shx", height: 0.1 } },
});

const d = createDrawing({ units: "ft", standard });
d.layer("A-WALL", () => d.rect([24, 30], 52, 44));

export default d.build();
```

The child's entries are added to its parent's, an entry of the same name replaces the parent's
whole, and `null` removes one. Export the standard beside the drawing, so that
[the command](#the-command) holds the drawing to it.
[`examples/site-plan.ts`](../examples/site-plan.ts) is a whole sheet drawn this way, to a
standard that adds the layer `V-TREE` to the built-in one.

## `defineStandard`

`defineStandard(document, options?)` checks a standard's document, resolves it against its
parent and returns a `Standard`: plain, frozen data, with every default filled in, no
`$schema`, `extends` or `null`, each title block's drawings as `Drawing` objects, its `hash`,
and `chain`, the id, version and hash of each parent from the nearest.

- A problem in the document throws a `DrawingError` whose diagnostics have the rule `standard`
  and an `item`, the path of the problem, such as `layers["A-WALL"].pen`. Its message lists the
  first 10.
- The document is a TypeScript literal, or the value `JSON.parse` gives for a standard kept as
  JSON. A literal mistake is a compile error with the runtime check's message: a layer name
  AutoCAD refuses, a color outside 1 to 255, a lineweight AutoCAD does not have, a font not in
  `FONTS`, a paper not in `PAPERS`, and a discipline, pen, linetype, role, dimension style, title
  block or sheet format that the standard and its parent do not have.
- The compiler compares names exactly, and the runtime check as AutoCAD compares them: `"c-prop"`
  is a compile error for a standard that spells it `C-PROP`, and the runtime takes it. The
  `Standard` spells every name as its entry does.
- In TypeScript, `extends` is a `Standard`. A string `extends`, and a title block's `block` or
  `preview` given as a string, are looked up in `options.files`, by the string exactly as the
  document writes it: a `Standard` for `extends`, and the value `JSON.parse` gives for a drawing.
  `"tsdraft/standard.json"` and `"tsdraft/title-blocks/plain-arch-d.json"` need no entry. The
  library reads no file.
- `hash` is the SHA-256 of what the standard states for a check. Its `id`, `version` and
  `title`, a discipline's `title`, and the `description` of a pen, a layer, a text role and a
  dimension style are not part of it. A linetype's `description` is, since it is what AutoCAD's
  `LINETYPE` command shows for the linetype. A `Standard` with `hash` and `chain` left out is a
  document with no `extends` that resolves to the same standard, with the same hash, so a
  standard written in TypeScript can be kept as JSON.
- A `Standard` made by another copy of tsdraft is read again as data, and refused unless its
  hash is its content's, by `defineStandard`'s `extends`, by `createDrawing` and by `lint`.

The package ships `standard.schema.json`, a JSON Schema for the document before it is
resolved, and `standard.json`, the built-in standard resolved, which `"tsdraft/standard.json"`
names. Give a standard kept as JSON a `$schema` of
`https://cdn.jsdelivr.net/npm/tsdraft@<version>/standard.schema.json`, and an editor completes
and checks it. What the schema cannot say, such as a name that refers to another entry, two names
AutoCAD takes for one, or a box inside another, `defineStandard` checks.

## The document

A standard is one JSON object. Every length on paper is in its `paperUnits`. A lineweight is one
of AutoCAD's millimetre values, in a standard in inches too. A ratio is a plain number, such as
`120` for 1" = 10'.

| Field                   | What it holds                                                                  | Default                    |
| ----------------------- | ------------------------------------------------------------------------------ | -------------------------- |
| `$schema`               | The JSON Schema of the document                                                | none                       |
| `id`                    | 1 to 128 letters, digits, `.`, `-`, `_`, `@` and `/`, so a package name is one | required                   |
| `version`               | 1 to 64 characters                                                             | required                   |
| `title`                 | For people                                                                     | the `id`                   |
| `extends`               | The parent                                                                     | none                       |
| `paperUnits`            | `"in"` or `"mm"`. A child keeps its parent's                                   | required without `extends` |
| `minTextHeight`         | The least height a text may plot at, in paper units                            | required without `extends` |
| `linetypeScale`         | A dash plots its pattern's length times this, at every scale                   | `1`                        |
| `plotStyle`             | The plot style table of each layout, one of `PLOT_STYLE_TABLES`                | `"monochrome.ctb"`         |
| `sheetFiles`            | `"one-drawing"` or `"sheet-per-file"`                                          | `"one-drawing"`            |
| `defaultSheetFormat`    | The sheet format of a layout that names none                                   | none                       |
| `defaultDimensionStyle` | The dimension style of a dimension that names none                             | none                       |
| `disciplines` and on    | The sections below, each an object of entries by name                          | `{}`                       |

A field the document does not define is an error, at every level. Each object of the document
may hold `$comment`, a string for people, which `defineStandard` drops. An object of entries by
name, such as `layers`, has no `$comment`: a key there is a name.

`id` and `version` contain no control character and nothing above U+FFFF. The ids of
disciplines, pens, text roles, scales, dimension styles, title blocks, sheet formats and zones
have 1 to 64 letters, digits, `.`, `-` and `_`, the characters every AutoCAD name takes, since
an id ends up in one, and two of one section that differ only in case are an error. A layer's or
a linetype's name follows AutoCAD's rules for a layer name in R2018, and two that AutoCAD's
`AUDIT` takes for one are an error: AutoCAD would merge their entries. Layer `0` is in no
standard.

### Sections

**`disciplines`**: `"C": { "title": "Civil" }`. A discipline groups the entries a firm keeps for
one kind of drawing. An entry with no `discipline` belongs to every one.

**`pens`**: `"heavy": { "lineweight": 0.7 }`. A named lineweight, with an optional
`description`.

**`linetypes`**: `"DASHED": { "description": "Dashed __ __", "pattern": [0.5, -0.25] }`. A
pattern is in paper units before `linetypeScale`: AutoCAD sizes a dash on the paper in every
viewport, so a dash plots `pattern` times `linetypeScale` long at every scale. `Continuous` is in
every standard and is never listed.

**`layers`**: `"C-PROP": { "color": 7, "linetype": "PHANTOM", "pen": "heavy", "discipline":
"C" }`. `color` is an AutoCAD Color Index from 1 to 255 and is required. `linetype` names a
linetype of the standard and defaults to `Continuous`. `pen` names a pen, and without one the
layer has AutoCAD's `Default` lineweight. `plot` defaults to `true`. A layer's off, frozen and
locked states are the drawing's to set.

**`textRoles`**: `"note": { "font": "Arial", "height": 0.09375 }`, with `widthFactor` and
`obliqueAngle` optional. `font` is one of `FONTS`. `height` is the plotted height of a capital,
at least `minTextHeight`. The role's text style is its id in capitals, `NOTE`, so no role is
named `standard`: AutoCAD takes `STANDARD` for the text style `Standard` that every drawing has.

**`scales`**: `"1in-10ft": { "label": "1\" = 10'", "ratio": 120 }`. `label` is how the scale
is written, at most 64 characters, and `ratio` is above 0.

**`dimensionStyles`**: `role` names the text role of a dimension's text, `arrowhead`,
`arrowSize`, `extensionOffset`, `extensionBeyond` and `textGap` are paper sizes, and `writing`
says how a length is written in each unit of a drawing, with `precision`, `prefix`, `suffix`,
`suppressZeros` and `measurementScale`. A drawing in a unit `writing` does not list draws no
dimension in that style. The AutoCAD style is the id in capitals, `DIMS` on a layout, and with
a scale's id after it in model space: `DIMS-1in-10ft`. No dimension style is named `standard`,
and two names among every style at every scale that AutoCAD takes for one are an error.

**`titleBlocks`**: a title block tsdraft draws as a block, or a firm's own drawing attached as an
xref, with the fields a sheet fills, its `drawingArea` and its `box`. [Title
blocks](title-blocks.md#the-title-block-of-a-standard) has both forms, the fields and where
their values come from.

**`sheetFormats`**: `"arch-d": { "paper": "ARCH D", "titleBlock": "plain", "zones": { "views":
[0.5, 2, 27.5, 23.5] } }`. A sheet format gives a layout its paper, its title block, its plot
style table when `plotStyle` gives one of its own, and its zones: named boxes inside the title
block's drawing area that the code lays the sheet out by. A box is `[left, bottom, right, top]`.
Every paper of `PAPERS` is in inches, so a standard in millimetres has no sheet format.

`layers`, `textRoles` and `dimensionStyles` entries of a standard whose `sheetFiles` is
`"sheet-per-file"` may hold `byDiscipline`, fields that replace the entry's own in the drawings
of a discipline. Each discipline's drawing is a file of its own there, attached by xref, and
AutoCAD keeps each one's layers apart. In one drawing a layer name has one set of properties, so
`defineStandard` refuses `byDiscipline` under `"one-drawing"`.

### `extends` and `null`

- A standard extends at most one parent: a `Standard` in TypeScript, and in JSON a path from
  the document's own file or a package specifier.
- A child's entry replaces the parent's entry of that name whole, under the parent's spelling:
  a child's `c-prop` replaces `C-PROP` and keeps `C-PROP`. The fields that are not sections
  replace the parent's, apart from `paperUnits`, which a child keeps.
- `null` removes the parent's entry of that name. A `null` that removes nothing is an error, and
  so is an entry that names one removed, such as a layer whose pen a child removed.
- A child that removes the entry its parent's `defaultSheetFormat` or `defaultDimensionStyle`
  names sets its own.
- A cycle of `extends` is an error.

## The built-in standard

`BUILT_IN_STANDARD` has the id `tsdraft` and the version `1`. Its version goes up when what it
states changes, and the CHANGELOG says so. Its layer names follow the layer name format of the
National CAD Standard.

| Setting                 | Value                              |
| ----------------------- | ---------------------------------- |
| `paperUnits`            | `in`                               |
| `minTextHeight`         | 0.0625                             |
| `linetypeScale`         | 0.5                                |
| `plotStyle`             | `monochrome.ctb`                   |
| `defaultSheetFormat`    | `arch-d`                           |
| `defaultDimensionStyle` | `dims`                             |
| `disciplines`           | `G` General, `C` Civil, `V` Survey |

| Pen      | Lineweight, mm |
| -------- | -------------- |
| `heavy`  | 0.7            |
| `bold`   | 0.5            |
| `medium` | 0.35           |
| `light`  | 0.25           |
| `fine`   | 0.18           |

| Layer         | Color | Linetype   | Pen      | Plots |
| ------------- | ----- | ---------- | -------- | ----- |
| `C-PROP`      | 7     | PHANTOM    | `heavy`  | yes   |
| `C-PROP-ADJC` | 8     | PHANTOM    | `fine`   | yes   |
| `C-PROP-MONU` | 7     | Continuous | `light`  | yes   |
| `C-SETB`      | 1     | DASHED     | `light`  | yes   |
| `C-BLDG`      | 5     | Continuous | `heavy`  | yes   |
| `C-PAVE`      | 8     | Continuous | `medium` | yes   |
| `C-ROAD-CNTR` | 8     | CENTER     | `fine`   | yes   |
| `C-ANNO-DIMS` | 8     | Continuous | `fine`   | yes   |
| `C-ANNO-TEXT` | 7     | Continuous | `light`  | yes   |
| `C-ANNO-SYMB` | 7     | Continuous | `medium` | yes   |
| `C-ANNO-TITL` | 7     | Continuous | `bold`   | yes   |
| `G-ANNO-TTLB` | 7     | Continuous | `medium` | yes   |
| `G-ANNO-NPLT` | 8     | Continuous | none     | no    |

The `C-` layers are of the discipline `C` and the `G-` layers of `G`. The linetypes are the six
the library exports: `DASHED`, `HIDDEN`, `CENTER`, `PHANTOM`, `DASHDOT` and `DOT`. The text
roles are `note` and `dimension`, 3/32 in, `label`, 1/8 in, `heading`, 3/16 in, and `title`,
1/4 in, each in Arial. The scales are `1in-10ft` to `1in-100ft`, labelled `1" = 10'` and so on,
and `1-8in-1ft` to `3in-1ft`, labelled `1/8" = 1'-0"` and so on. The dimension style `dims`
writes feet to a tenth with `'`, inches whole with `"`, and millimetres whole. The title block
`plain` and the sheet format `arch-d`, on ARCH D, are in [Title
blocks](title-blocks.md#the-title-block-of-a-standard).

## Drawing to a standard

`createDrawing({ standard })` draws to a standard. The drawing is R2018, its linetype scale is
the standard's, and `fields` holds the values of title block fields the drawing's sheets share.
`discipline` names the drawing's discipline, under `"sheet-per-file"`, which an entry with
`byDiscipline` needs. A drawing without a standard is built as it was before standards.

- **Layers.** `d.layer(name, draw)` names a layer of the standard, and the layer takes the
  standard's color, linetype, pen and plot flag. `d.layer(name, { off, frozen, locked }, draw)`
  sets the states, which are the drawing's. A layer enters the drawing when it is first named.
- **Pens.** An entity's `pen` names a pen of the standard. Its `lineweight` may be `"ByLayer"` or
  `"ByBlock"` and nothing else.
- **Text.** `text()` and `attribute()` take `role` in place of `height` and `style`, and every text
  names one. On a layout and in a block a text plots at its role's height. In model space it names
  a `view` too, and is drawn at the height that plots at the role's height at the view's scale.
  `measureText({ value, ...standard.textRoles.label }).length` is how long it plots.
- **Views.** `const plan = d.view("plan", { scale: "1in-10ft" })` declares a view at a scale of
  the standard. `plan.paper(length)` turns a length on paper into drawing units at its scale. One
  viewport shows it, `sheet.viewport(corner, width, height, { view: plan, center })`, and takes
  its id and ratio.
- **Inserts.** An insert in model space of a block drawn in paper units, such as a symbol whose
  texts have roles, names the view, `d.insert(name, at, { view: plan })`, and is scaled to plot
  at its size. An insert of any other block takes `scale`.
- **Dimensions.** A dimension names a dimension style of the standard by its id, or is in
  `defaultDimensionStyle`, and in model space names its view. The builder defines the AutoCAD
  style on first use, with the standard's sizes, its role's text style and height, the
  `writing` of the drawing's units, and the view's scale.
- **Layouts.** `d.layout(name, { sheetFormat }, draw)` is on a sheet format of the standard, and
  `d.layout(name, draw)` on `defaultSheetFormat`. `sheet.zone(name)` gives a zone and
  `sheet.titleBlock(fields)` places the title block and fills its fields: see [Title
  blocks](title-blocks.md#the-title-block-of-a-standard).

### What the builder refuses

Each is a compile error for a literal, and a `DrawingError` with the call at run time. A message
about a name the standard lacks says how to add it: `Layer "A-WALL" is not a layer of the
standard "acme" version 2026.1. Add it to the standard, as layers: { "A-WALL": { color: 7 } } in
defineStandard, or use one of its layers`.

| Call                                                                                       | Rule                               |
| ------------------------------------------------------------------------------------------ | ---------------------------------- |
| `layer()` with a name the standard lacks, or `layer("0")`                                  | `layer-outside-standard`           |
| `layer()` with `color`, `linetype`, `lineweight` or `plot`                                 | `layer-differs-from-standard`      |
| `linetype()`, or a linetype the standard lacks                                             | `linetype-outside-standard`        |
| A numeric `lineweight`, or a pen the standard lacks                                        | `pen-outside-standard`             |
| `textStyle()`, a text's `height` or `style`, or a text without a `role`                    | `text-style-outside-standard`      |
| A role the standard lacks, a text of model space with no view, or one elsewhere with one   | `role`                             |
| An insert in model space of a block whose texts have roles without `view`, or with `scale` | `role`                             |
| `view()` at a scale the standard lacks                                                     | `scale-outside-standard`           |
| A viewport with `ratio`, or with a view this drawing did not declare                       | `viewport`                         |
| `dimensionStyle()`, or a dimension style the standard lacks                                | `dimension-style-outside-standard` |
| A dimension in a unit its style's `writing` lacks                                          | `dimension-style`                  |
| A layout with `paper` or `plotStyle`, or a sheet format the standard lacks                 | `sheet-format-outside-standard`    |
| A layout whose name AutoCAD's `AUDIT` takes for another layout's                           | `duplicate-layout`                 |
| A title block's block or text style the drawing has with another definition                | `duplicate-block`                  |
| `createDrawing` with `linetypeScale` or for R12, or a discipline under `"one-drawing"`     | `standard`                         |
| A second layout, or a sheet without a number, under `"sheet-per-file"`                     | `sheet-per-file`                   |

An entity drawn outside any `layer()` is on layer `0`. The builder takes it, since in a block
that is where it belongs, and `lint` reports one of model space or of a layout.

## `lint` and the standard

`lint(drawing, { standard })` holds a drawing to its standard after AutoCAD's rules, as the
builder does at each call, so a drawing built by other code or read from JSON is held to it too.
It takes the standard as plain data from any copy of tsdraft, checks it, and works out its hash
again: a standard that does not check is one `standard` error. Without `standard` it checks none
of this. `discipline` names the drawing's discipline, and without it an entry with
`byDiscipline` is checked in none of its forms, which `discipline-unknown` warns of.
[Rules](rules.md#a-drawings-standard) lists what it reports.

`toDXF` calls `lint` without a standard, so it writes a drawing that breaks its standard.

## The command

A drawing file exports its standard beside its drawing:

```ts
export { standard };
export default d.build();
```

`tsdraft render` and `tsdraft dev` pass the export to `lint` with the drawing, in the copy of
tsdraft the drawing imports. A rule of the standard that the drawing breaks is a diagnostic as
any other: its errors give exit code 2, and its warnings change nothing. A file that exports no
standard is held to none, even when its drawing was built to one.

- `drawing.standard` in the JSON gives the export's `id`, `version` and `hash`, and `checked`,
  which is true when `lint` held the drawing to it. It is `null` when the file exports no
  standard, or exports a value that is not one, which `lint`'s `standard` error describes.
- `standard-unchecked` is a warning of the command's own: the copy of tsdraft the drawing
  imports is from before standards, so the drawing was not held to the export. `checked` is then
  false. Update tsdraft.
- The page of `tsdraft dev` shows the standard's id and version beside the file's name, and "not
  checked" when `checked` is false.
- A title block of the xref form stands for a firm's drawing the command does not open. When the
  command checked the standard and found no error, and the file's `xrefs` export gives no
  drawing for its xref, the pictures draw the title block's `preview` in its place, and the
  xref's `shown` is true. A drawing the `xrefs` export gives,
  by any case of the xref's name, is drawn instead.
