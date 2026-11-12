# Dimensions

A dimension measures the distance between two points and writes it beside a dimension line.
In the file it is a dimension and not lines and text: AutoCAD measures it again when its
points move, and a drafter edits it with the dimension commands. tsdraft draws two kinds,
linear and aligned, in R2018 drawings only.

```ts
const d = createDrawing({ units: "ft" });
d.layer("A-WALL", { color: 7 });
d.layer("A-ANNO-DIMS", { color: 1, lineweight: 0.18 });
d.textStyle({ name: "NOTES", font: "Arial" });

d.dimensionStyle({
  name: "PLAN-10",
  textStyle: "NOTES",
  textHeight: 3 / 32,
  arrowhead: "architectural-tick",
  arrowSize: 1 / 16,
  extensionOffset: 1 / 16,
  extensionBeyond: 1 / 8,
  textGap: 1 / 16,
  scale: fromPaper(1, "in", { ratio: 120, units: "ft" }),
  precision: 1,
  suffix: "'",
});

d.layer("A-WALL", {}, () => d.rect([0, 0], 52, 30, { id: "walls" }));
d.layer("A-ANNO-DIMS", {}, () => {
  d.linearDimension([0, 0], [52, 0], [0, -10], { style: "PLAN-10", id: "width" }); // 52.0'
  d.linearDimension([52, 0], [52, 30], [62, 0], { style: "PLAN-10", along: "y" }); // 30.0'
  d.alignedDimension([0, 0], [52, 30], 12, { style: "PLAN-10", text: "<> DIAG" }); // 60.0' DIAG
});
```

## A dimension style

Every dimension names a dimension style, which says how it is drawn and how it writes what it
measures. `d.dimensionStyle(definition)` defines one. A style is defined once, under a name
no other style has, and before the first dimension that names it.

| Field              | What it sets                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `name`             | The style's name, held to the rules of a layer's name, and at most 255 characters.             |
| `textStyle`        | The text style of the text. `"Standard"` unless given.                                         |
| `textHeight`       | The height of the text. Greater than 0.                                                        |
| `arrowhead`        | `"closed-filled"`, the default, or `"architectural-tick"`. `ARROWHEADS` lists them.            |
| `arrowSize`        | The length of an arrowhead. 0 draws none.                                                      |
| `extensionOffset`  | How far from its point an extension line starts.                                               |
| `extensionBeyond`  | How far an extension line runs past the dimension line.                                        |
| `textGap`          | The gap between the dimension line and the text above it.                                      |
| `scale`            | What every size above is multiplied by. 1 unless given.                                        |
| `precision`        | The decimals of a measurement, a whole number from 0 to 8.                                     |
| `prefix`, `suffix` | Written before and after each measurement.                                                     |
| `suppressZeros`    | `"leading"` writes 0.5 as `.5`, `"trailing"` writes 52.50 as `52.5`, `"both"` does both.       |
| `measurementScale` | What a length is multiplied by before it is written: 12 writes feet as inches. 1 unless given. |

### Sizes and the scale

Give the sizes as they plot, and let `scale` carry the view. A dimension in model space that a
viewport shows at a ratio of 120 takes `scale: fromPaper(1, "in", { ratio: 120, units: "ft" })`,
which is 10: a text height of 3/32 is then 0.9375 feet in the model and plots 3/32 of an inch
high. A dimension on a layout is in paper units already, so its style has no scale. A drawing
shown at two ratios needs a style for each, the same but for the scale.

AutoCAD holds the sizes and the scale as two things, as the style does, and multiplies them
when it draws.

### How a dimension is drawn

Where a style has no field, every dimension is drawn one way:

- The text is above the dimension line, in the middle between the extension lines, and reads
  along the line. It is turned to read from the bottom or from the right of the sheet.
- The dimension line runs from one extension line to the other.
- A closed filled arrowhead is as long as `arrowSize` and a third as wide, with its tip on the
  extension line. An architectural tick is a stroke at 45 degrees through the end of the
  dimension line, and the dimension line runs one arrow size past each extension line.
- The measurement is in decimal units of the drawing, times `measurementScale`.

### What a dimension needs room for

AutoCAD moves closed filled arrowheads outside the extension lines when the text and the
arrowheads do not fit between them, and it decides that from the width of the text in its
font. tsdraft gives the text room for the widest it can be in any font of `FONTS`, so `lint`
refuses a dimension with closed filled arrowheads that measures no more than

```text
max(2 × arrowSize, widths × textHeight × widthFactor + lean) + 2 × textGap
```

each size times the style's scale. `widths` adds up a width for each character of the text:
1.1 for a figure, a point, an apostrophe, a quotation mark and a space, 1.104 for `9`, 1.239
for a hyphen, and 2 for any other character. `widthFactor` is the text style's, and `lean` is
`textHeight × |tan(obliqueAngle)|` for a slanted text style. At 1" = 10' with the sizes in the
example above and closed filled arrowheads, a dimension of `6.0'` has room and one of `3.8'`
does not. A dimension with ticks, or with an arrow size of 0, is drawn the same whether its
text fits or not, so it may be as short as it likes: its text then lies over the extension
lines.

## The two kinds

`d.linearDimension(from, to, line, options)` measures the distance from `from` to `to` along
one direction: along X unless `options.along` is `"y"` or an angle in degrees counterclockwise
from +X, from -360 to 360. The dimension keeps the angle as the one from 0 up to 360 that gives
the same direction, so -90 and 270 are one dimension. The dimension line passes through
`line`, and an extension line runs to it from each point.

`d.alignedDimension(from, to, offset, options)` measures the distance between the two points,
with its dimension line parallel to the line between them: `offset` to the left of the way
from `from` to `to`, or to the right for an offset less than 0.

Both take `style`, the name of the dimension style, and optionally:

- `text`, a text to draw in place of the measurement. `<>` in it stands for the measurement
  as the style writes it, so `"<> TYP"` adds to it and `"VARIES"` replaces it. Only the first
  `<>` is the measurement.
- `id`, as any entity takes one: see [Ids](format.md#ids).

A dimension is on the current layer, and is drawn in that layer's color and lineweight. It
takes no linetype or lineweight of its own. It goes in model space or on a
[layout](layouts.md), and not in a block.

## How a measurement is written

A measurement is the length between the points as the file holds them, with 6 decimals,
times the style's `measurementScale`. It is rounded half up to the style's `precision`, so
2.25 is written `2.3` at a precision of 1, with the zeros `suppressZeros` names left out,
between the `prefix` and the `suffix`.

A computer holds most halves as a little less than they are, as it holds 52.15 or 1234567.15.
AutoCAD takes a value a little under the half as on it, and so does tsdraft: under 1, a value
within a ten-billionth of itself under the half, and from 1 up, within a ten-billionth and
one and a half units in the 16th significant digit. So 52.15 is written `52.2` at a precision
of 1, 1234567.15 is written `1234567.2`, and 5000000.05 is written `5000000.1`. A value that
lies a few units in its last digit from that edge may be rounded the other way by AutoCAD: its
own arithmetic moves the value it holds by about that much.

The file holds the string in the dimension's picture, and AutoCAD writes it again when the
dimension's points move. The preview and the command give the string the picture holds.

`dimensionPicture(dimension, style)` gives what AutoCAD draws for a dimension: its
`measurement` in drawing units, its `label` with the string as `value`, where it is and how it
is turned, the two extension lines, the dimension line, the arrowheads, and the entities the
file's picture draws the arrowheads with.
`findDimensionStyle(drawing, name)` gives the style a dimension names.

## The preview

`toSVG` draws each dimension as AutoCAD does, in model space, through a viewport and on a
sheet, in its layer's color and lineweight. A dimension is a `<g>` with `data-layer`,
`data-entity`, `data-id` and `data-dimension`, the string it reads. Its children have a
`data-part`: `extension-line`, `dimension-line`, `arrowhead` or `text`. A drawing's extents
take its dimensions in, text included.

`inspectText` takes a dimension's text for a text where the picture puts it, measured as
`measureText` measures any text, so it warns of a text that plots over it. A dimension's text
that its room holds never measures longer than that room in any font.

The `tsdraft` command lists each dimension in its JSON, with its id, the number it measures
and the string it reads: see [The JSON](command.md#the-json).

## What lint reports

Each of these is an error, at the builder's call and in `lint`. The rule is `dimension-style`,
`duplicate-dimension-style`, `undefined-dimension-style` or `dimension`.

- A style's name follows the rules of a layer's name. AutoCAD discards a drawing over a
  character it refuses in a name, and its `DIMSTYLE` command refuses a name of more than 255
  characters.
- No two styles have names AutoCAD takes for one. It keeps the first of two that differ only
  in case, and its `AUDIT` reports a duplicate for two such as `strasse` and `straße`.
- `Standard` is not defined and not named. Every drawing has that style, with AutoCAD's own
  values, and AutoCAD skips a second style of the name.
- A style's text style is one the drawing defines. A style holds it by its handle, and
  AutoCAD's `AUDIT` reports one that leads to no style.
- A text height is greater than 0. The arrow size and both extension lengths are 0 or more.
  AutoCAD's `AUDIT` reports a style that breaks either.
- The gap is 0 or more. AutoCAD draws a box around the text of a style with a negative gap.
- The scale is greater than 0. AutoCAD works a scale of 0 out from a viewport, and its `AUDIT`
  reports a negative one.
- The measurement scale is greater than 0. AutoCAD's `AUDIT` reports 0, and AutoCAD applies a
  negative one only on a layout.
- The precision is a whole number from 0 to 8. AutoCAD's `AUDIT` reports any other.
- An arrowhead is one of `ARROWHEADS`.
- A prefix, a suffix and a dimension's text have none of `\`, `{` and `}`, which AutoCAD reads
  as the formatting of the text, and are single lines as any text is. A prefix has no `<>`.
- A dimension's text is not empty or all spaces: AutoCAD draws such a dimension with no text.
  It has no `[]` beside `<>`: AutoCAD writes the measurement a second time for it, in
  alternate units.
- A dimension names a style the drawing defines. AutoCAD discards a drawing with a dimension
  in a style it does not have.
- A dimension measures something once its points are written with 6 decimals. AutoCAD draws
  one that measures nothing with the text 0 and its arrowheads turned outward.
- What a dimension writes, rounded to the style's precision, is under 100,000,000 and has no
  more than 15 digits: 9,999,999.9999999982 at a precision of 8 is written
  `10000000.00000000`, which has 16. AutoCAD writes 16 digits of a measurement, so it drops decimals from
  100,000,000 on at a precision of 8, and it works the 16th digit out from its own arithmetic
  on the points: it writes 99,999,999.5 at a precision of 8 as `99999999.50000002`.
- Every number a dimension draws is under 1e100: each size of its style times the scale, and
  each point of its picture. AutoCAD reads only two exponent digits from DXF.
- The text height times the scale, and an arrow size other than 0 times the scale, is not
  written as 0 with the 6 decimals tsdraft writes. The picture would draw the text or the
  arrowheads with no size.
- A linear dimension measures along an angle from -360 to 360. This is tsdraft's own rule: an
  angle beyond a turn is refused, so that one direction has one angle.
- A dimension with closed filled arrowheads has the room given above.
- A dimension is not in a block. AutoCAD draws nothing for a dimension inside a block when it
  opens the file, so an insert of the block would show nothing of it.
- No block is named `_ArchTick`, in any case of its letters. AutoCAD draws the architectural
  tick with the block of that name, so a block of yours would be drawn as the tick.
- An R12 drawing has no dimensions.

`lint` warns of a prefix, a suffix or a text with `%%`, which AutoCAD reads as the start of a
control code, as it does in any text.

## Handles

A dimension style takes its handle from its name, with A to Z in lower case, so it keeps the
handle when the drawing around it changes. `dimensionStyleHandle(name)` gives it. A dimension
that has an `id` takes `idHandle(id)`, as any entity does. The block of the architectural
tick takes the handles its name gives a block, and `arrowheadHandles("architectural-tick")`
gives its record's and its stroke's.

The block of each dimension's picture, and each line, arrowhead and text in it, take handles
from the dimension's id, so a dimension with an id keeps them when the drawing around it
changes. A dimension without an id takes them from its place: its layout and its index among
the entities there. `dimensionPictureHandles({ id, layout, index })` gives them. Two names
that give one handle are refused as two ids are. What each of these returns will not change in
a later version of tsdraft.

## What a file holds

For a drawing with a dimension, tsdraft writes each dimension style to the dimension style
table, the block `_ArchTick` when a style has ticks, and each dimension with its points, its
style, its text, what it reads, and the block of its picture.

The picture is what AutoCAD draws for the dimension, as AutoCAD writes it: the two extension
lines, the dimension line, two filled triangles or two inserts of `_ArchTick`, and the text,
each on the dimension's layer and in the dimension's color. AutoCAD shows the picture the file
holds when it opens the drawing, and when another drawing attaches the file as an xref or
inserts it as a block. It draws a new picture when the dimension's points or style change. A
program that draws a dimension from its block, as most programs that read DXF do, shows the
same picture.

Without the picture, AutoCAD would draw a dimension when it first shows it: on opening the
file for model space and the first layout, and for a later layout when that layout is first
shown or plotted. It draws nothing for a dimension in the block of another drawing, so an xref
or an insert of the file would show none, and a program that only draws a dimension's block
would show none either.

Every R2018 drawing holds the dimension style `Standard`, with AutoCAD's own values and the
text style `Standard`. AutoCAD draws no text for a dimension in a style that names no text
style, so without it a dimension a drafter adds in `Standard` would have none. A drawing with
no dimension style holds nothing else for dimensions.

## What is not drawn yet

Leaders, and angular, radial, diameter and ordinate dimensions. Tolerances and alternate
units. Feet and inches, fractions and the other unit formats: a measurement is a decimal
number. A dimension tied to an entity, which follows it when it moves: a dimension's points
are the ones the code gives it.
