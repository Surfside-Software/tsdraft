# Dimensions

A dimension measures the distance between two points and writes it beside a dimension line.
In the file it is a dimension and not lines and text: the leading CAD app measures it again when its
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

| Field                 | What it sets                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `name`                | The style's name, held to the rules of a layer's name, and at most 255 characters.              |
| `textStyle`           | The text style of the text. `"Standard"` unless given.                                          |
| `textHeight`          | The height of the text. Greater than 0.                                                         |
| `arrowhead`           | `"closed-filled"`, the default, `"architectural-tick"` or `"oblique"`. `ARROWHEADS` lists them. |
| `arrowSize`           | The length of an arrowhead. 0 draws none.                                                       |
| `extensionOffset`     | How far from its point an extension line starts.                                                |
| `extensionBeyond`     | How far an extension line runs past the dimension line.                                         |
| `textGap`             | The gap between the dimension line and the text above it.                                       |
| `scale`               | What every size above is multiplied by. 1 unless given.                                         |
| `units`               | `"decimal"`, the default, or `"architectural"`, which writes feet and inches: `4'-1 7/16"`.     |
| `precision`           | A whole number from 0 to 8: the decimals, or in feet and inches the least fraction, 1/2^n.      |
| `prefix`, `suffix`    | Written before and after each measurement.                                                      |
| `suppressZeros`       | Decimal units: `"leading"` writes 0.5 as `.5`, `"trailing"` 52.50 as `52.5`, `"both"` both.     |
| `feetInchZeros`       | Feet and inches: which zeros are written. `"inches"` unless given: see below.                   |
| `measurementScale`    | What a length is multiplied by before it is written: 12 writes feet as inches. 1 unless given.  |
| `fraction`            | Feet and inches: `"inline"`, the default, as `4'-1 7/16"`, `"stacked"` or `"diagonal"`.         |
| `fractionScale`       | A stacked fraction's height as a share of the text's, from 0.25 to 1. 1 unless given.           |
| `textPlacement`       | `"above"` the dimension line, the default, or `"centered"` in a break of it.                    |
| `textFit`             | A text with no room between the extension lines: `"inside"` them, the default, or `"leader"`.   |
| `dimensionLineweight` | The lineweight of the dimension line, its arrowheads and a leader, in millimetres.              |
| `extensionLineweight` | The lineweight of the extension lines, in millimetres.                                          |

### Sizes and the scale

Give the sizes as they plot, and let `scale` carry the view. A dimension in model space that a
viewport shows at a ratio of 120 takes `scale: fromPaper(1, "in", { ratio: 120, units: "ft" })`,
which is 10: a text height of 3/32 is then 0.9375 feet in the model and plots 3/32 of an inch
high. A dimension on a layout is in paper units already, so its style has no scale. A drawing
shown at two ratios needs a style for each, the same but for the scale.

The leading CAD app holds the sizes and the scale as two things, as the style does, and multiplies
them when it draws.

### How a dimension is drawn

- The text is in the middle between the extension lines and reads along the line, turned to
  read from the bottom or from the right of the sheet. Above the line, its box stands one gap
  off it; `textPlacement: "centered"` puts the middle of its box on the line, which breaks a gap
  either side of it. The box is the box of the text as the leading CAD app sets it: from the top
  of its tallest letter or stack to the foot of its lowest letter.
- The dimension line runs from one extension line to the other.
- A closed filled arrowhead is as long as `arrowSize` and a third as wide, with its tip on the
  extension line. An architectural tick is a heavy stroke at 45 degrees through the end of the
  dimension line, and an oblique tick the same stroke as thin as the dimension line; with
  either, the dimension line runs one arrow size past each extension line.
- The measurement is in decimal units of the drawing, or in feet and inches, times
  `measurementScale`, with the fraction on the line unless `fraction` stacks it.
- The dimension line, its arrowheads and a leader take `dimensionLineweight`, and the
  extension lines `extensionLineweight`. Without them, each takes the dimension's own: its
  layer's.

### What a dimension needs room for

The leading CAD app moves closed filled arrowheads outside the extension lines when the text and the
arrowheads do not fit between them, and it decides that from the width of the text in its
font. tsdraft gives the text room for the widest it can be in any font of `FONTS`, so `lint`
refuses a dimension with closed filled arrowheads that measures no more than

```text
text above the line:     max(2 × arrowSize, text) + 2 × textGap
text centered in a break: text + 2 × arrowSize + 2 × textGap
text = widths × textHeight × widthFactor + lean
```

each size times the style's scale. The text is the wider of the words above the line and below
it, with a stacked fraction counted as its longer part and a diagonal one as its two parts and a
slash. `lint` also takes the text as tsdraft lays it out in its font, where that is wider: a narrow
font does not narrow the gap of a diagonal stack. `widths` adds up a width for each character of the text:
1.1 for a figure, a point, an apostrophe, a quotation mark and a space, 1.104 for `9`, 1.239
for a hyphen and a slash, and 2 for any other character. `widthFactor` is the text style's, and `lean` is
`textHeight × |tan(obliqueAngle)|` for a slanted text style. At 1" = 10' with the sizes in the
example above and closed filled arrowheads, a dimension of `6.0'` has room and one of `3.8'`
does not. A dimension with ticks, or with an arrow size of 0, may be as short as it likes. Ticks turn
outward when the text does not fit: above the line, when the text is wider than the line less
two gaps; centered in it, when the line is shorter than the text and two arrow sizes. The
dimension line then breaks at each tick.

### A text that does not fit

With `textFit: "leader"`, a text that is wider than the line less two gaps moves out on a
leader, as the leading CAD app moves it: from the middle of the dimension line, away from the
points, to an elbow past the reach of the extension lines and a gap and a half, leaning toward
where the text reads, then along a landing to the text. Above the line the text stands a gap
over a landing as long as it and a gap either side; centered, it follows a landing two gaps
long. The ticks stay inward unless the line is shorter than two gaps. `lint` refuses what is
not laid out yet: words below the line of a text that moves out, arrowheads twice the text's
height or longer in such a style, and closed filled arrowheads with the text centered.

## The kinds

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
- `textBelow`, words under the dimension line, opposite the text: `{ textBelow: "WINDOW HEAD
  HT." }` writes the measurement over the line and the words under it. The first `<>` of
  `text` and `textBelow` together is the measurement. With words below, a centered text stands a
  gap above the line too, and the line breaks for the wider of the two.
- `id`, as any entity takes one: see [Ids](format.md#ids).

A dimension is on the current layer, and is drawn in that layer's color and lineweight, or in a
`color` of its own, as [Colors](colors.md) says. It takes no linetype or lineweight of its own. It goes in model space or on a
[layout](layouts.md), and not in a block.

### Radius, diameter and jogged radius

`d.radiusDimension(center, point, options)` measures the radius of a circle or an arc: the
distance from `center` to `point`, a point of the circle its line meets. The leading CAD app writes
an R before the measurement, and `<>` in `text` stands for both: `"<> TYP."` reads `R2.50 TYP.`.
Its line runs from the center through `point`. The line to the center is always drawn.

`d.diameterDimension(center, point, options)` measures twice that, read with a diameter sign:
`∅5.00`. Its line runs across the circle through the center, with an arrowhead at `point` and
one at the point opposite, and its text stands at `point`'s end.

The text of both stands outside the circle, past the arrowhead, which points in at the circle
from outside, unless `options.textFromCenter` places it: the distance of the middle of the text
from the center along the line, inside the circle, outside it, or past the center for less than 0. The leading CAD app keeps a placed text two arrow sizes and a gap clear of the circle. Inside,
the arrowhead points out at the circle, and the line runs from beyond the text to it.

`d.joggedRadiusDimension(center, point, start, jog, options)` measures the radius of an arc
whose center is too far off to draw to. Its line starts at `start`, standing in for the center,
crosses over at a jog centered on `jog`, and runs on toward the center to `point`, with the
arrowhead pointing out at the arc and the text along the last stretch, inside the arc.

A dimension style sets two things of these kinds alone:

- `radialText: "horizontal"` levels their text: outside a circle on a short level landing, and
  across a jogged one's line, which breaks round it. `"aligned"`, the default, keeps it along the
  line. Linear and aligned dimensions take no notice of it.
- `jogAngle`, the angle of the jog to the line, in degrees from 5 to 90. Defaults to 45.

`lint` refuses a style with a `prefix` for them, which the leading CAD app may put in place of its R
or its diameter sign; a placed text in a style that levels the text or centers it in the line; a
jogged one in a style that centers its text; and a radius of 0.

### Angular

`d.angularDimension(vertex, from, to, at, options)` measures the angle at `vertex` between the line
to `from` and the line to `to`. Its arc runs about the vertex through `at`, and `at` picks the
angle, as the leading CAD app picks it: the angle between the two lines that holds `at`, or the rest
of the turn when `at` is on the other side, so the order of `from` and `to` means nothing.

```ts
d.angularDimension([0, 0], [10, 0], [0, 10], [6, 6], { style: "DIMS" }); // 90°
d.angularDimension([0, 0], [10, 0], [0, 10], [-6, -6], { style: "DIMS" }); // 270°
```

Each extension line runs along its line, from the style's offset off its point toward the arc, to
the style's length past the arc: out from the vertex when the arc is beyond the point, and in
toward it when the arc is nearer. The arc runs between the arrowheads, each a chord of the arrow
size long, or between the ticks. The text stands at the middle of the arc, turned along it to read
upright: a gap above it, or centered in a break of it. Words below make a second line of the one
text, which stands on the arc, `90°` over the arc and `MIN.` under it.

Where a centered text and its gaps leave the marks no room on the arc, the marks turn outward, each
with a tail an arrow size long past it, and the arc runs whole under the text. A closed arrowhead
also turns outward so for a style whose text fit is `"leader"`. A text above the arc stays put,
and so do its marks, as short as the arc is.

A dimension style sets how its angles are written:

- `angleUnits`: `"degrees"`, the default, as `45.5°`; `"degrees-minutes-seconds"`, as `45°30'`;
  `"grads"`, as `50.56g`; or `"radians"`, as `0.79r`.
- `anglePrecision`, the decimals, from 0, the default, to 8. In degrees, minutes and seconds it
  picks the parts, and the zeros are always written:

  | `anglePrecision` | 0      | 1 and 2   | 3 and 4      | 5              | 8                 |
  | ---------------- | ------ | --------- | ------------ | -------------- | ----------------- |
  | 123.4567°        | `123°` | `123°27'` | `123°27'24"` | `123°27'24.1"` | `123°27'24.1412"` |

- `suppressAngleZeros`, the zeros an angle leaves out, as `suppressZeros` does for a length:
  `"leading"` writes 0.50° as `.50°`, `"trailing"` as `0.5°`, and `"both"` as `.5°`.

An angle is rounded half up as a length is, and carries: 45.99999° is `46°0'0.0"` at a precision of 5. The style's `prefix` and `suffix` stand around it, and its `measurementScale` takes no part.

`lint` refuses an angular dimension whose vertex is one of its points, whose arc's point is its
vertex, or whose lines run one way; one whose arc's point is on one of its lines, where the leading
CAD app takes the angle or the rest of the turn by a rounding; one whose arc passes through one of
its points, where that app runs the point's extension line either way by a rounding; one whose
text is too wide for its arc in a style whose text fit is `"leader"`, which that app moves outside;
one whose centered text leaves its arc no room each side; one whose closed arrowheads are as long
as its arc is wide; one whose arc runs all but a whole turn, which its 6 decimals write with one
angle at both ends; and words below in a style that centers its text.

### Arc length

`d.arcLengthDimension(center, radius, startAngle, endAngle, at, options)` measures the length of the
arc about `center` of `radius`, counterclockwise from `startAngle` to `endAngle` in degrees, as
`d.arc` takes them, with its own arc through `at`. The measurement is written as a length is, in the
style's units.

```ts
d.arc([0, 0], 10, 30, 120);
d.arcLengthDimension([0, 0], 10, 30, 120, [0, 13], { style: "DIMS" }); // ⌒15.71
```

From a right angle up, its own arc runs about the center through `at`, and its extension lines run
along radii. Under one, its extension lines run parallel to the arc's bisector, and its own arc runs
about the center through `at`, which must be outside the arc. The marks, the text and its break are
an angular dimension's, with the text on the arc's bisector.

A dimension style's `arcSymbol` says where the arc symbol goes: `"before"` the text, the default, a
half circle as high as the text; `"above"` it, an arc over the text; or `"none"`. A centered text
leaves room on its arc for the symbol before it, on both sides of the text, and its break reaches
past the symbol.

`lint` refuses an arc length dimension that measures no arc, whose radius is 0 or less, whose point
is its center or on the arc, or that is inside an arc under a right angle, where the leading CAD
app's own arc stops short of an extension line; one whose centered text leaves its own arc no room
each side; one whose measurement takes more digits than a length's writing holds; and words below
with the arc symbol.

### Ordinate

`d.ordinateDimension(feature, leaderEnd, options)` gives the distance from `options.origin`, or from
`[0, 0]`, to `feature` along X when `options.axis` is `"x"` and along Y when it is `"y"`, on a
leader from near `feature` to `leaderEnd`, with its text beyond. The distance has no sign, so a
feature on either side of the origin reads alike, and one at the origin reads 0.

```ts
const datum = { style: "DIMS", origin: [4, 16] } as const;
d.ordinateDimension([7, 13], [7, 17.5], { ...datum, axis: "x" }); // 3.00
d.ordinateDimension([7, 7.5], [2.5, 8.25], { ...datum, axis: "y" }); // 8.50
```

An X ordinate's leader runs along Y and a Y ordinate's along X, from the style's offset off the
feature to `leaderEnd`, then on past it under the text. The text stands a gap beyond the end, reads
along the leader and stands a gap above it, or on it in a style that centers its text, where the
leader stops at the end. Words below stand under the leader. A leader whose end is off the
feature's line jogs across: from twice the arrow size along it, or from four arrow sizes short of
the end where that is further, to two arrow sizes short of the end. A leader that ends level with
its feature runs back, down or to the left. The leader takes the style's `extensionLineweight`,
and no arrowhead.

The leading CAD app draws a jog straight, as one line from the feature's side to the end's, where
the end is across by no more than 1e-10 of the feature's X, for an X ordinate, or its Y, as the
drawing holds it and not as measured from `origin`, taken as the difference of the two numbers that
app holds for them once it has read the file: a jog of a hundred-thousandth at an X of a million is
a straight line, and so is a jog of a millionth at 100,000. That app reads a decimal in a way of its
own, which can come out a unit in the last place from the nearest number, so at exactly 1e-10 of
the coordinate the difference comes out a hair to one side or the other: 0.00001 at 100,000 and
0.000007 at 70,000 are a hair more, and are drawn, and 0.0001 at 1,000,000 and 0.000003 at 30,000 a
hair less, and are straight. The same reading decides whether the end is level with the feature:
that app holds 1,000,000,000,000 and 1,000,000,000,000.0001 as one number, so a leader that ends
that far along runs back, and one that also ends there across has no leader. tsdraft lays the
leader out in the numbers that app holds.

`lint` refuses an ordinate dimension whose axis is neither `"x"` nor `"y"`, whose leader ends at
its feature, or whose measurement takes more digits than a length's writing holds, and warns of
one whose leader runs further across than along, which is most often an ordinate given the
other axis.

## How a measurement is written

A measurement is the length between the points as the file holds them, with 6 decimals,
times the style's `measurementScale`. It is rounded half up to the style's `precision`, so
2.25 is written `2.3` at a precision of 1, with the zeros `suppressZeros` names left out,
between the `prefix` and the `suffix`.

A computer holds most halves as a little less than they are, as it holds 52.15 or 1234567.15.
The leading CAD app takes a value a little under the half as on it, and so does tsdraft: under 1, a
value within a ten-billionth of itself under the half, and from 1 up, within a ten-billionth and
one and a half units in the 16th significant digit. So 52.15 is written `52.2` at a precision
of 1, 1234567.15 is written `1234567.2`, and 5000000.05 is written `5000000.1`. A value that
lies a few units in its last digit from that edge may be rounded the other way by that app: its
own arithmetic moves the value it holds by about that much.

### Feet and inches

A style with `units: "architectural"` takes a length times its `measurementScale` as inches,
rounds it half up to the least fraction its `precision` gives, 1 over 2 to that power, and
writes feet, a hyphen, inches, and the fraction in lowest terms after a space, with the inch
mark: 49.4375 is `4'-1 7/16"` at a precision of 4, and `4'-1"` at 0. A drawing in inches leaves
`measurementScale` at 1, and a drawing in feet gives it 12.

`fraction: "stacked"` stacks the fraction over a bar and `"diagonal"` beside a slash, right after
the inches, at `fractionScale` of the text's height: `4'-1` and a stacked `7/16`. A stacked part
stands by its own ink, as the leading CAD app sets it, so a 7 over 16 stands a little lower than
a 1 over 16.

`feetInchZeros` says which zeros are written:

| `feetInchZeros`      | 48      | 6       | 0.5         |
| -------------------- | ------- | ------- | ----------- |
| `"inches"` (default) | `4'-0"` | `6"`    | `1/2"`      |
| `"feet"`             | `4'`    | `0'-6"` | `0'-0 1/2"` |
| `"both"`             | `4'-0"` | `0'-6"` | `0'-0 1/2"` |
| `"neither"`          | `4'`    | `6"`    | `1/2"`      |

A fraction keeps the zero inches before it when the feet are written: 48.5 is `4'-0 1/2"`.
The dimension holds no text of its own, so the leading CAD app measures it in feet and inches when
its points move, and the prefix, the suffix and a dimension's `text` with `<>` work as they do for
a decimal measurement: `"<> CLR."` reads `3'-6" CLR.`.

The file holds the string in the dimension's picture, and the leading CAD app writes it again when
the dimension's points move. The preview and the command give the string the picture holds.

`dimensionPicture(dimension, style)` gives what the leading CAD app draws for a dimension: its
`measurement` in drawing units, its `label` with the string as `value`, where it is and how it
is turned, the two extension lines, the dimension line, the arrowheads, and the entities the
file's picture draws the arrowheads with.
`findDimensionStyle(drawing, name)` gives the style a dimension names.

## The preview

`toSVG` draws each dimension as the leading CAD app does, in model space, through a viewport and on
a sheet, in its layer's color and lineweight. A dimension is a `<g>` with `data-layer`,
`data-entity`, `data-id` and `data-dimension`, the string it reads. Its children have a
`data-part`: `extension-line`, `dimension-line`, `leader`, `arrowhead` or `text`, and each text
is a paragraph group as [paragraphs](paragraphs.md) are drawn, stacks included. A drawing's
extents take its dimensions in, text included.

`inspectText` takes each line of a dimension's texts for a text where the picture puts it, so
it warns of a text that plots over it.

The `tsdraft` command lists each dimension in its JSON, with its id, the number it measures
and the string it reads: see [The JSON](command.md#the-json).

## What lint reports

Each of these is an error, at the builder's call and in `lint`. The rule is `dimension-style`,
`duplicate-dimension-style`, `undefined-dimension-style` or `dimension`.

- A style's name follows the rules of a layer's name. The leading CAD app discards a drawing over a
  character it refuses in a name, and its `DIMSTYLE` command refuses a name of more than 255
  characters.
- No two styles have names the leading CAD app takes for one. It keeps the first of two that differ
  only in case, and its `AUDIT` reports a duplicate for two such as `strasse` and `straße`.
- `Standard` is not defined and not named. Every drawing has that style, with the leading CAD app's
  own values, and that app skips a second style of the name.
- A style's text style is one the drawing defines. A style holds it by its handle, and
  the leading CAD app's `AUDIT` reports one that leads to no style.
- A text height is greater than 0. The arrow size and both extension lengths are 0 or more.
  The leading CAD app's `AUDIT` reports a style that breaks either.
- The gap is 0 or more. The leading CAD app draws a box around the text of a style with a negative
  gap.
- The scale is greater than 0. The leading CAD app works a scale of 0 out from a viewport, and its
  `AUDIT` reports a negative one.
- The measurement scale is greater than 0. The leading CAD app's `AUDIT` reports 0, and that app
  applies a negative one only on a layout.
- The precision is a whole number from 0 to 8. The leading CAD app's `AUDIT` reports any other.
- `units` is `"decimal"` or `"architectural"`. `suppressZeros` is for a style in decimal units
  and `feetInchZeros` for one in architectural units, and a style has only its own.
- `fraction` is one of `DIMENSION_FRACTIONS`, `textPlacement` one of
  `DIMENSION_TEXT_PLACEMENTS` and `textFit` one of `DIMENSION_TEXT_FITS`. A stacked fraction
  and its `fractionScale`, from 0.25 to 1, are for a style in architectural units, and a
  `fractionScale` for a fraction that is stacked. A lineweight is one of `LINEWEIGHTS`.
- An arrowhead is one of `ARROWHEADS`.
- A prefix, a suffix and a dimension's text have none of `\`, `{` and `}`, which the leading CAD app
  reads as the formatting of the text, and are single lines as any text is. A prefix has no `<>`.
- A dimension's text is not empty or all spaces: the leading CAD app draws such a dimension with no
  text. It has no `[]` beside `<>`: that app writes the measurement a second time for it, in
  alternate units.
- A dimension names a style the drawing defines. The leading CAD app discards a drawing with a
  dimension in a style it does not have.
- A dimension measures something once its points are written with 6 decimals. The leading CAD app
  draws one that measures nothing with the text 0 and its arrowheads turned outward.
- What a dimension writes, rounded to the style's precision, is under 100,000,000 and has no
  more than 15 digits: 9,999,999.9999999982 at a precision of 8 is written
  `10000000.00000000`, which has 16. The leading CAD app writes 16 digits of a measurement, so it
  drops decimals from 100,000,000 on at a precision of 8, and it works the 16th digit out from its
  own arithmetic on the points: it writes 99,999,999.5 at a precision of 8 as `99999999.50000002`.
- Every number a dimension draws is under 1e100: each size of its style times the scale, and
  each point of its picture. The leading CAD app reads only two exponent digits from DXF.
- The text height times the scale, and an arrow size other than 0 times the scale, is not
  written as 0 with the 6 decimals tsdraft writes. The picture would draw the text or the
  arrowheads with no size.
- A linear dimension measures along an angle from -360 to 360. This is tsdraft's own rule: an
  angle beyond a turn is refused, so that one direction has one angle.
- A dimension with closed filled arrowheads has the room given above.
- A text centered in its line has the room of its width and two gaps there, unless it moves
  out on a leader. Where its pieces then go is not laid out yet.
- What [A text that does not fit](#a-text-that-does-not-fit) says is not laid out yet.
- A dimension is not in a block. The leading CAD app draws nothing for a dimension inside a block
  when it opens the file, so an insert of the block would show nothing of it.
- No block is named `_ArchTick` or `_Oblique`, in any case of its letters. The leading CAD app
  draws the ticks with the blocks of those names, so a block of yours would be drawn as a tick.
- An R12 drawing has no dimensions.

`lint` warns of a prefix, a suffix or a text with `%%`, which the leading CAD app reads as the start
of a control code, as it does in any text.

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

The picture is what the leading CAD app draws for the dimension, as that app writes it: the two
extension lines, the dimension line in one piece or more, the leader to a text moved out, two
filled triangles or two inserts of `_ArchTick` or `_Oblique`, and each text as a paragraph, each
on the dimension's layer and in the dimension's color. A dimension with words below holds its
text and them as one, `<>\XWINDOW HEAD HT.`, as that app does. That app shows the picture the
file holds when it opens the drawing, and when another drawing attaches the file as an xref or
inserts it as a block. It draws a new picture when the dimension's points or style change. A
program that draws a dimension from its block, as most programs that read DXF do, shows the
same picture.

Without the picture, the leading CAD app would draw a dimension when it first shows it: on opening
the file for model space and the first layout, and for a later layout when that layout is first
shown or plotted. It draws nothing for a dimension in the block of another drawing, so an xref
or an insert of the file would show none, and a program that only draws a dimension's block
would show none either.

Every R2018 drawing holds the dimension style `Standard`, with the leading CAD app's own values and
the text style `Standard`. That app draws no text for a dimension in a style that names no text
style, so without it a dimension a drafter adds in `Standard` would have none. A drawing with
no dimension style holds nothing else for dimensions.

## What is not drawn yet

An ordinate dimension in a turned coordinate system or with a text a drafter placed, an arc length
dimension of part of an arc or with a leader, or inside an arc under a right angle, an angular
dimension by two lines, and an angular dimension's
level text or text a drafter placed. A radial dimension's center mark, which the leading
CAD app draws only without the line to the center, and a level text placed along its line. Tolerances and alternate
units, and the unit formats but decimal and feet and inches. The other fits of a text, such as
moving the arrowheads first, and a text a drafter placed. A dimension tied to an entity, which
follows it when it moves: a dimension's points are the ones the code gives it.
