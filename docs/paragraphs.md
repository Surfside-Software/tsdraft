# Paragraphs

A paragraph is one text whose lines wrap at a width and break at each line feed. In the file it
is an `MTEXT`, which a CAD user selects, moves and edits as one: a general note, a callout of
several lines, a block of specifications. A text, `d.text`, is one line and never wraps.

Paragraphs are R2018 only. The builder's types make one a compile error in an R12 drawing, and
`lint` refuses one there.

## Placing a paragraph

```ts
d.paragraph("ALL WORK SHALL COMPLY WITH THE CODES IN FORCE.", {
  at: [1, 20],
  width: 4,
  height: 0.1,
});
```

`at` is a point of the paragraph's box, which `align` and `valign` name: `"left"`, `"center"` or
`"right"` across it, and `"top"`, `"middle"` or `"bottom"` up and down it. The defaults put `at`
at the box's upper left corner. `align` also sets each line in the box: flush left, centered or
flush right.

- `width` is the width the lines wrap at. Without it, the lines break only at line feeds, and
  the box is as wide as the widest line.
- `height` is the height of a capital, 0.125 by default, as a text's is.
- `rotation` turns the paragraph about `at`, in degrees counterclockwise. It is taken within a
  turn, from 0 up to 360, and to 6 decimals, as the writers write it: `paragraphDirection` gives
  the direction its lines run in, which both writers write and its layout is placed by.
- `style` is a text style of the drawing, or a definition of one, as a text's is.
- `lineSpacing` is a factor of the spacing of the lines, from 0.25 to 4, 1 by default.
  `lineSpacingStyle` is `"at-least"`, the default, or `"exactly"`.

### Columns

```ts
d.paragraph(notes, { at: [1, 20], width: 3, columns: { count: 2, height: 6 } });
d.paragraph(notes, { at: [1, 12], width: 3, columns: { height: 6 } });
d.paragraph(notes, { at: [1, 4], width: 3, columns: { heights: [6, 4] } });
```

`columns` flows the lines through columns side by side, each `width` wide and `gutter` apart, in
drawing units. A column takes lines until the next one's box would reach below its height; that
line, or the first after a `\N` in the value, starts the next column at its top. In the column
that takes the rest, a `\N` only breaks the line.

- `{ count, height }` gives that many columns, each `height` high, and the last takes whatever
  the others leave, past its height. The box is as wide as all of them, filled or not.
- `{ height }` gives as many columns as the text takes, each `height` high.
- `{ heights }` gives a column of each height in turn, then one more that takes the rest. A file
  holds the heights of the columns the text reaches, so heights past them are not read back.
- `gutter` is five times the paragraph's height when not given.

`align` and `valign` place each column as a box of its own: with `valign: "bottom"`, every
column's last line ends on `at`. `layoutParagraph` gives each column's box in `columns`, and each
line its `column`.

A paragraph takes the options of every entity: an `id`, a `linetype`, a `lineweight` and, under
a standard, a `pen`. Under a standard it names a `role`, which gives its height and text style as
it gives a text's, and in model space the `view` it is read in.

## The value

A line feed in the value given to `paragraph()` starts a new paragraph. The paragraph holds it as
`\P`, the code a CAD program writes, so a value read back from a file has `\P` where the line
feed was.

The value holds the inline codes of an `MTEXT`, as the DXF Reference gives them. tsdraft lays out
these:

| Code                 | Draws                                                                       |
| -------------------- | --------------------------------------------------------------------------- |
| `\P`                 | A paragraph break                                                           |
| `\N`                 | A paragraph break that starts the next column                               |
| `\~`                 | A space the line does not break at                                          |
| `\\`, `\{`, `\}`     | A backslash and a brace                                                     |
| `{` and `}`          | A group: what a code sets inside it ends at its `}`, 16 groups deep at most |
| `\L` and `\l`        | Underline on and off                                                        |
| `\K` and `\k`        | Strike-through on and off                                                   |
| `\H0.2;`, `\H2x;`    | The height of the characters after it, in drawing units or times the last   |
| `\W0.8;`             | Their width factor, in the place of the style's                             |
| `\Q15;`              | Their oblique angle in degrees, -85 to 85, in the place of the style's      |
| `\A0;` to `\A2;`     | Where they sit on the line: on the baseline, centered or at the top         |
| `\C1;`               | A color by its index, which moves nothing and which the preview draws       |
| `\fArial\|b1;`       | A TrueType font of `FONTS`, in bold with `b1`: `i0`, `c` and `p` pass       |
| `\Fromans.shx;`      | An SHX font of `FONTS`                                                      |
| `\S1/2;`             | A fraction stacked over a level bar                                         |
| `\S1#2;`             | A fraction stacked beside a slash                                           |
| `\S+0.1^-0.2;`       | Two parts stacked with no bar, as a tolerance                               |
| `\S2^ ;` and `\S^2;` | A superscript and a subscript                                               |
| `%%d`, `%%p`, `%%c`  | A degree sign, a plus-or-minus sign and a diameter sign                     |
| `\U+XXXX`            | The character of that code point                                            |
| A tab                | A move to the next tab stop                                                 |
| `\pxi-3,l3,t3;`      | The indents, tab stops, justification, room and spacing of the paragraph    |

`%%` before any other character draws as it is: `100%%%` draws three percent signs, and `%%%d`
a percent sign and a degree sign.

A stack's parts hold digits or capitals, with `.`, `,`, `+` or `-` beside them, as a fraction or
a tolerance does, or only spaces, as the bottom of a superscript does, or nothing, as the top of
a subscript does. Its parts are as tall as the text around them.

Helpers write the codes, so a value reads as what it draws:

```ts
import { bold, list, plain, stack, subscript, superscript, underline } from "tsdraft";

d.paragraph(
  `${bold("GENERAL NOTES", "Arial")}
1. ${underline("VERIFY")} ALL DIMENSIONS IN THE FIELD.
2. GAP 3${stack("1", "2")}", AREA 12 FT${superscript("2")}.
3. OWNER: ${plain(owner)}`,
  { at: [1, 20], width: 4, height: 0.1 },
);
```

- `underline(text)` underlines a group.
- `bold(text, font)` sets a group in the bold face of a TrueType font of `FONTS`, which it is then
  set in, and measured by its own widths. A bold code names its font, so the helper takes one.
- `stack(top, bottom, divider)` stacks two parts: over a level bar for `"/"`, the default,
  beside a slash for `"#"`, and with no bar for `"^"`.
- `superscript(text)` and `subscript(text)` set a part above the line, and at its foot.
- `list(items, { marks, subMarks, indent })` writes a numbered or lettered list in two levels, as
  CAD programs write one: each item a paragraph of its own, its mark, a tab and its text, under a
  hanging indent of `indent` heights, 3 by default. An item is a string, or `{ text, items }` with
  the items of the level under it, indented as far again. `marks` is `"1."`, the default, `"1)"`,
  `"A."` or `"a."`, and `subMarks` `"A."` by default. The items are joined by `\P`.
- `paragraphFormat(properties)` writes a `\p` code that sets what it gives, in heights: `indent`,
  the first line's indent from the left indent; `left` and `right`, the indents; `tabs`, the tab
  stops from the left of the box, and `[]` for none; `justification`, `"left"`, `"center"`,
  `"right"`, `"justified"` or `"distributed"`; `before` and `after`, the room before and after the
  paragraph; and `spacing`, `{ style: "m", value }` for a factor of the paragraph's own spacing or
  `{ style: "e", value }` for its lines exactly that far apart.
- `plain(text)` escapes what would start a code: a backslash, a brace, and the second percent
  sign of `%%d`, `%%p` and `%%c`, written as `\U+0025`, so a value that comes from elsewhere draws
  as it is.

A `\p` code sets what it gives of the paragraph it stands in, wherever in it, and of every
paragraph after it until another code changes it. So the text after a list keeps the list's
indents and tab stops; start it with `paragraphFormat({ indent: 0, left: 0, tabs: [] })`:

```ts
d.paragraph(
  `GENERAL NOTES\\P${list([
    "VERIFY ALL DIMENSIONS IN THE FIELD.",
    {
      text: "DO NOT SCALE THE DRAWINGS.",
      items: ["USE THE DIMENSIONS SHOWN.", "ASK THE ENGINEER."],
    },
  ])}\\P${paragraphFormat({ indent: 0, left: 0, tabs: [] })}END OF NOTES`,
  { at: [1, 20], width: 4, height: 0.1 },
);
```

With `x`, as the helpers write it, a `\p` code's numbers are in heights of the text; without it,
in drawing units, as a firm's drawing may hold them.

## What `lint` refuses

`lint` refuses a value it cannot lay out as the leading CAD app does, and the builder refuses the
same as the code runs; a literal value with one of these mistakes is a compile error too. Each
message names the code.

- A `{` that is never closed, a `}` that closes nothing, and groups nested more than 16 deep.
- A code tsdraft does not know, such as `\Z`, and a backslash at the end of the value.
- A code with no `;` to end it, such as `\fArial` with nothing after it.
- A font in `\f` or `\F` that is not one of `FONTS`, since the leading CAD app draws a font it does
  not have in another font. Italic, `\f...|i1;`, since tsdraft has no widths for italic letters.
  Bold in an SHX font, which has no bold. An option other than `b0`, `b1`, `i0`, and `c` or `p`
  with digits after it, and an option given twice, as `\fArial|b1|b0;`.
- `%%c` in an SHX font, the style's or one a `\f` code sets, which draws a diameter sign of its
  own, narrower than `Ø`, that tsdraft does not lay out yet. A TrueType font draws it as `Ø`, and
  keeps it. The type of a literal value refuses it in a font a `\f` or `\F` code sets, as far as
  that code's group reaches; in the style's font only `lint` and the builder refuse it, since the
  type does not know the style's font. A read `MTEXT` that holds one is laid out as approximate.
- A control character but a tab, a character above U+FFFF and the private-use characters
  U+E800 to U+E8FF, which a text cannot hold either. The type of a literal value refuses all but a
  character above U+FFFF, which only `lint` and the builder refuse: TypeScript reads a template
  literal type by characters and never splits the two halves of one, so no type can find it.
- In `\p`, an option it does not know, a tab stop that aligns text by its right, its center or a
  decimal point, `tr`, `tc` and `td`, and spacing at least a size, `sa`, which tsdraft does not
  lay out.
- A code of the table above whose number is not one it takes: a height or width factor of 0 or
  of more than 15 digits before its point, an oblique angle past 85, `\A` other than 0, 1 or 2, a
  color number past 257.
- The codes tsdraft does not lay out yet: `\T` the spacing of the characters after it, which the
  leading CAD app plots as a spacing of its own between characters; `\c`, a true color, which
  the preview cannot draw as the plot does yet; `\O`, an overline, which sits
  at a TrueType font's ascent, which tsdraft's tables do not hold; `\X`, which only a dimension's
  text holds; and `\M+NXXXX`, a character of a code page. A paragraph that held one would plot
  otherwise than tsdraft draws it.
- A stacked part that holds other characters than those above, such as `\Sx/y;`, since where it
  stands depends on the top of its letters, which tsdraft's tables hold only for digits and
  capitals; and a stack in underlined or struck-through characters, which is laid out otherwise.

It refuses columns that are not one of the three kinds above: a count that is not a whole number
from 1 to 1000, a height or heights not above 0, from 1 to 1000 heights, a gutter below 0, and
columns on a paragraph without a width. It warns of a `\N` in a paragraph without columns, which
breaks the line as `\P` does.

It also refuses a height or a width that is not greater than 0 as written, a line spacing outside
0.25 to 4 as given, so none rounds into the range or out of it, an `align`, a `valign` or a `lineSpacingStyle` that is not one of its
choices, and a text style the drawing does not have.

## How a paragraph is laid out

`layoutParagraph` and `measureParagraph` are the one layout of a paragraph. The extents, `toSVG`,
`toPDF`, `inspectText` and the box of the view a DXF opens at all take a paragraph's lines and its
box from them, from the widths `measureText` measures a text by and the ink of each character
that `FONT_METRICS` holds beside them. They read the height, the width, the line spacing factor
and the style's width factor and oblique angle as the writers write them, to 6 decimals, so a
paragraph wraps in the picture where it wraps in the file.

```ts
const { lines, corners, frame } = measureParagraph({
  value: "ALL WORK SHALL COMPLY WITH THE CODES IN FORCE.",
  height: 0.1,
  width: 1.5,
  font: "Arial",
});
```

`lines` holds each line that draws a character, with the box of its capitals, as `measureText`
gives a text's. `corners` is the box of all the paragraph draws, and `frame` the box `align` and
`valign` place it by. `layoutParagraph` gives the same before the paragraph is turned and moved,
with each run of characters in one font and format, where it starts, and each underline and bar.
`paragraphInStyle(paragraph, style)` gives a paragraph in its text style, as `measureParagraph`
takes it.

tsdraft lays a paragraph out by the rules of the leading CAD app, in heights `h` of the paragraph,
from the widths and the ink of each character that `FONT_METRICS` holds:

- A run is characters of one font, face and format, set by their advances. The next run starts
  where the last one's advances end, or where its last character's ink ends where that is
  further, as after an `f`.
- A line starts at the left of its first character's ink and ends at the right of its last
  one's. It keeps the spaces it starts with and drops those it ends with. `"left"` puts that
  start on `at`, `"right"` that end, and `"center"` the middle of the two: the width moves no line.
- A line breaks only at a space or before a tab, and only to keep the next word inside the
  width: the word stays when the advances up to it, from the line's first point, and its own ink
  come to no more than the width. The left of the line's first letter has no part in it. A word
  wider than the width stays whole and passes it. In a word that holds a stack, what follows the
  last stack stands for the word, or the stack where it ends the word. A tab goes with the word
  after it where the line wraps. A leaned word's ink is taken to reach twice its last letter's
  lean further, whatever its width factor.
- With a width, a paragraph's first line starts at its left indent plus its first-line indent,
  never left of the box, its other lines at its left indent, and its words wrap at its right
  indent. A word that reaches the width itself leaves a line that starts at an indent or holds a
  tab. Without a width, no indent moves a line.
- A tab moves the pen to a stop, measured from the left of the box: of the left indent and the
  paragraph's stops, the first that leaves the next letter's first point past the pen, and then
  the next multiple of `4h`. A stop at or past the right indent moves it nowhere. The next letter's
  ink starts on the stop. Without a width only the left indent and the multiples of `4h` are stops,
  counted from the line's first letter, and a tab before that letter moves nothing. After a tab,
  the wrap measures the words as a line that starts on the stop.
- `"left"`, `"center"` and `"right"`, from `align` or from the paragraph's justification, set a
  line flush left at its start, centered between its start and the right indent, or flush right
  at the right indent, and without a width about `at`. A justified line grows each space after
  its last tab alike to end at the right indent, but a paragraph's last line, which stands by
  `align`. A distributed line grows each gap between two letters or stacks after its last tab
  alike, every line, and stands centered without a width. A grown line draws each word and space,
  or each letter, as a run of its own. A line wider than its room is not grown, and a distributed
  one is centered.
- A run of the codes above is laid out at its own height, width factor and oblique angle: its
  advances scale with them, and a line's A is its tallest run's top, and its D a third of that
  run's height, with the third of the paragraph's height after it. `\A1;` centers the runs after
  it on the line's tallest run, and `\A2;` sets them at its top. A run after a leaned one starts
  further by how far the lean takes the last capital's top. A line that holds spaces or a tab in
  a format of their own, or ends in one of another format than the spaces dropped after it, is
  placed by its first point and not by its ink.
- In columns, a line starts the next column when its box reaches below its column's height: its
  ink with `"at-least"` spacing, `h/3` below its baseline with `"exactly"`, and the box of the
  paragraph's own spacing. It stands at the column's top as a first line does, and the next column
  is the width and the gutter further along.
- With `"at-least"` spacing, each line takes `lineSpacing` times its ascent, a third of the height
  of what reaches highest, and `h/3`. Its ascent is how far its letters reach above the baseline,
  at least `h`, as an `Å` or a stack reaches further: a plain line takes `5h/3`. The first line's
  top is the top of the box, and the box ends at the bottom of the last line's ink.
- With `"exactly"`, the first baseline is `h` below the top of the box and each next one
  `lineSpacing` times `5h/3` below it, whatever the lines hold, and the box ends `h/3` below the
  last.
- A paragraph's own spacing takes the place of both. A factor `f` gives each line `f` times `5/4`
  of its ascent and the third of a height below it, `5h/3` for a line of capitals, and the box
  ends no further below the last line's top than that. Exactly `v` sets each baseline `v` below
  its line's top and the next line `5v/3` below, and the box ends `2v/3` below the last baseline,
  less `4/3` of what `v` passes `h` by.
- The room before a paragraph comes before its first line, the first paragraph's too, and is a
  quarter of a height at least; the room after one comes before the next, and not at the top of a
  column. Once a `\p` code has
  `x`, the numbers of each code after it are in heights too.
- The style's width factor scales everything along a line. In a TrueType font its oblique angle
  moves where a line starts by its first letter's bottom, and where it ends by its ascent, times
  the angle's tangent.
- An underline runs from a run's first character to the end of its last one's advance, and
  through a tab from the pen to the stop, at the font's descent in a TrueType font and `h/5` below
  the baseline in an SHX font. A strike-through runs `h/2` above it.
- A bold run is in its font's bold face, with that face's own widths and ink.
- A fraction's top part has its ink's top at the top of the stack and its baseline `h/6` above a
  bar as long as the wider part's ink, and the bottom part its ink `h/6` below the bar and its
  baseline on the line's. Each part is centered on the bar. `^` sets both parts from the stack's
  start with no bar, as a tolerance; `#` sets them side by side with a slash between. A
  superscript is a tolerance over a space, `h/3` up, and a subscript one under nothing, on the
  baseline. The next character starts a little past the stack's ink, by the font.

`approximate` is true where tsdraft's numbers are an estimate: a value with a code it does not
lay out or a character outside its tables, a font that is not one of `FONTS`, an oblique angle in
an SHX font, `%%c` in an SHX font, which draws a diameter sign of its own, a stack in a
TrueType font other than Arial, whose digits and capitals may stand lower than its `A`, a
negative indent or room, a `\p` number past `1e15` drawing units, which is held there, tab stops
given out of order, a paragraph's own spacing by a factor outside 0.25 to 4 or exactly 0 or
less, and a justified or distributed line in an SHX font.

`inspectText` checks each line of a paragraph as it checks a text: one that plots over another
text, runs past the outline it starts in, or off the paper.

## In the picture and the plot

`toSVG` draws a paragraph as a group, `data-paragraph`, with each run as a text is drawn: in a
TrueType font from its first point and held to its characters' advances, and in an SHX font from
where its layout starts it to where it ends. Each underline, strike-through, bar and slash is a
line of its pen. Each part of a stack is a run of its own. A bold run has `font-weight="bold"` and is
sized by its bold face's own capital `A`, which `capHeightOf(font, true)` gives. `toPDF` sets a
bold run in the bold face of its font's file when `fonts` holds one under the font's name and
` Bold`, as `{ "Arial Bold": bytes }`, which `boldFontKey` gives, and in Helvetica-Bold,
Times-Bold or Courier-Bold otherwise. `FONTS` names each TrueType font's bold file, such as
`arialbd.ttf`, which `tsdraft render` and `tsdraft dev` look for beside the regular one.

## Reading

`readDXF` reads an `MTEXT` with its point, height, width, attachment, rotation, text style, value,
line spacing factor and line spacing style, and its columns from the embedded object the leading
CAD app saves after its own groups, its `width` then each column's. Its rotation comes from its
direction, groups 11 and 21, or else from group 50 in degrees, as the leading CAD app reads it,
though the DXF Reference gives radians; tsdraft writes the direction. `layoutMtext(mtext, style)` and `measureMtext` lay
one out by the same rules, in the font of `FONTS` nearest its style's, and say it is approximate
when the font is not the style's own or the value holds a code tsdraft does not lay out.
[Reading drawing files](reading.md) has the rest.

## Not yet

The spacing of the characters, `\T`, an overline, stacked parts in lower case, tab stops that align text by its right, its
center or a decimal point, and columns that flow from right to left. Attributes of paragraph text
are in [Blocks](blocks.md#attributes-of-paragraph-text).
