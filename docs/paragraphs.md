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
| `\~`                 | A space the line does not break at                                          |
| `\\`, `\{`, `\}`     | A backslash and a brace                                                     |
| `{` and `}`          | A group: what a code sets inside it ends at its `}`, 16 groups deep at most |
| `\L` and `\l`        | Underline on and off                                                        |
| `\K` and `\k`        | Strike-through on and off                                                   |
| `\fArial\|b1;`       | A TrueType font of `FONTS`, in bold with `b1`: `i0`, `c` and `p` pass       |
| `\Fromans.shx;`      | An SHX font of `FONTS`                                                      |
| `\S1/2;`             | A fraction stacked over a level bar                                         |
| `\S1#2;`             | A fraction stacked beside a slash                                           |
| `\S+0.1^-0.2;`       | Two parts stacked with no bar, as a tolerance                               |
| `\S2^ ;` and `\S^2;` | A superscript and a subscript                                               |
| `%%d`, `%%p`, `%%c`  | A degree sign, a plus-or-minus sign and a diameter sign                     |
| `\U+XXXX`            | The character of that code point                                            |

`%%` before any other character draws as it is: `100%%%` draws three percent signs, and `%%%d`
a percent sign and a degree sign.

A stack's parts hold digits or capitals, with `.`, `,`, `+` or `-` beside them, as a fraction or
a tolerance does, or only spaces, as the bottom of a superscript does, or nothing, as the top of
a subscript does. Its parts are as tall as the text around them.

Helpers write the codes, so a value reads as what it draws:

```ts
import { bold, plain, stack, subscript, superscript, underline } from "tsdraft";

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
- `plain(text)` escapes what would start a code: a backslash, a brace, and the second percent
  sign of `%%d`, `%%p` and `%%c`, written as `\U+0025`, so a value that comes from elsewhere draws
  as it is.

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
- A control character, a tab among them, a character above U+FFFF and the private-use characters
  U+E800 to U+E8FF, which a text cannot hold either. The type of a literal value refuses all but a
  character above U+FFFF, which only `lint` and the builder refuse: TypeScript reads a template
  literal type by characters and never splits the two halves of one, so no type can find it.
- The codes tsdraft does not lay out yet: `\p`, a paragraph's indents, tab stops and alignment,
  which numbered and lettered lists are made of; `\N`, columns; `\H` the height, `\W` the width
  factor, `\Q` the oblique angle, `\T` the spacing and `\A` the alignment of the characters after
  it; `\C` and `\c` color; `\O`, an overline, which sits at a TrueType font's ascent, which
  tsdraft's tables do not hold; `\X`, which only a dimension's text holds; and `\M+NXXXX`, a
  character of a code page. A paragraph that held one would plot otherwise than tsdraft draws it.
- A stacked part that holds other characters than those above, such as `\Sx/y;`, since where it
  stands depends on the top of its letters, which tsdraft's tables hold only for digits and
  capitals; and a stack in underlined or struck-through characters, which is laid out otherwise.

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
- A line breaks only at a space, and only to keep the next word inside the width: the word stays
  when the advances up to it, from the line's first point, and its own ink come to no more than
  the width. The left of the line's first letter has no part in it. A word wider than the width
  stays whole and passes it. In a word that holds a stack, what follows the last stack stands
  for the word, or the stack where it ends the word.
- With `"at-least"` spacing, each line takes `lineSpacing` times its ascent, a third of the height
  of what reaches highest, and `h/3`. Its ascent is how far its letters reach above the baseline,
  at least `h`, as an `Å` or a stack reaches further: a plain line takes `5h/3`. The first line's
  top is the top of the box, and the box ends at the bottom of the last line's ink.
- With `"exactly"`, the first baseline is `h` below the top of the box and each next one
  `lineSpacing` times `5h/3` below it, whatever the lines hold, and the box ends `h/3` below the
  last.
- The style's width factor scales everything along a line. In a TrueType font its oblique angle
  moves where a line starts by its first letter's bottom, and where it ends by its ascent, times
  the angle's tangent.
- An underline runs from a run's first character to the end of its last one's advance, at the
  font's descent in a TrueType font and `h/5` below the baseline in an SHX font. A
  strike-through runs `h/2` above it.
- A bold run is in its font's bold face, with that face's own widths and ink.
- A fraction's top part has its ink's top at the top of the stack and its baseline `h/6` above a
  bar as long as the wider part's ink, and the bottom part its ink `h/6` below the bar and its
  baseline on the line's. Each part is centered on the bar. `^` sets both parts from the stack's
  start with no bar, as a tolerance; `#` sets them side by side with a slash between. A
  superscript is a tolerance over a space, `h/3` up, and a subscript one under nothing, on the
  baseline. The next character starts a little past the stack's ink, by the font.

`approximate` is true where tsdraft's numbers are an estimate: a value with a code it does not
lay out or a character outside its tables, a font that is not one of `FONTS`, an oblique angle in
an SHX font, `%%c` in an SHX font, which draws a diameter sign of its own, and a stack in a
TrueType font other than Arial, whose digits and capitals may stand lower than its `A`.

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
line spacing factor and line spacing style. Its rotation comes from its direction, groups 11 and
21, or else from group 50 in degrees, as the leading CAD app reads it, though the DXF Reference
gives radians; tsdraft writes the direction. `layoutMtext(mtext, style)` and `measureMtext` lay
one out by the same rules, in the font of `FONTS` nearest its style's, and say it is approximate
when the font is not the style's own or the value holds a code tsdraft does not lay out.
[Reading drawing files](reading.md) has the rest.

## Not yet

Numbered and lettered lists with hanging indents, tab stops, columns, the codes that change the
height, width, slant, spacing, alignment or color of the characters after them, an overline,
stacked parts in lower case, and attributes of more than one line.
