# Text

## Styles and fonts

A text style names a font, and may make its characters wider, narrower or slanted. It has no
height of its own, so each text keeps its height. Define a style once and name it on each text,
or give the definition in place of the name:

```ts
import { createDrawing, FONTS } from "tsdraft";

const d = createDrawing({ units: "ft" });
d.textStyle({ name: "NOTES", font: "Arial" });
d.textStyle({ name: "NARROW", font: "romans.shx", widthFactor: 0.8, obliqueAngle: 15 });
d.text([0, 0], "GENERAL NOTES", { height: 1, style: "NOTES" });
d.text([0, 2], "TITLE", { height: 2, style: { name: "TITLE", font: "Arial" } });
```

Every drawing has the style `Standard`, with the font `txt.shx`. A text with no `style` is in
it.

A font goes by the name AutoCAD stores for it: the file name for an SHX font, the typeface for
a TrueType font. `FONTS` lists the fonts a style may have, and `Font` is the type of their
names:

| Kind     | Fonts                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SHX      | `txt.shx`, `monotxt.shx`, `simplex.shx`, `romans.shx`, `romand.shx`, `romanc.shx`, `romant.shx`, `complex.shx`, `italic.shx`, `isocp.shx`, `isoct.shx` |
| TrueType | `Arial`, `Calibri`, `Consolas`, `Courier New`, `Georgia`, `Segoe UI`, `Tahoma`, `Times New Roman`, `Trebuchet MS`, `Verdana`                           |

The SHX fonts are drafting alphabets that AutoCAD 2025 installs, and the TrueType fonts come
with Windows. The list is closed because AutoCAD draws text in a font it does not have in
another font, and its `AUDIT` reports nothing. A font outside the list is a compile error
where it is written as a literal, a builder error and a `lint` error.

A width factor is from 0.01 to 100, the range AutoCAD's `STYLE` command takes. AutoCAD's
`AUDIT` reports a style with a width factor of 0 or less, of 0.0001 or of 1000000. An oblique
angle is from -85 to 85 degrees, and `AUDIT` reports a style or a text slanted further. Both
limits are judged as the number is written, with 6 decimals.

AutoCAD slants a text after it widens it: the top of a text of height 1 lies the tangent of
the oblique angle further along the text, whatever the width factor, and a negative angle
leans it back. `toSVG` draws it so, and the drawing's extents take the lean in.

AutoCAD sizes a TrueType font so that its capital `A` is as tall as the text's height. In
Times New Roman, Georgia and Trebuchet MS that `A` is taller than a flat capital such as
`H`, so an `H` of a text of height 1 is a little under 1 tall.

A text holds its style's width factor and oblique angle from the moment it is written. Change
a style with `textStyle()` and the files tsdraft writes change with it.

## Justification

`align` places a text's point along its line, and `valign` up and down it:

```ts
d.text([50, 20], "LOT 12", { height: 2, align: "center", valign: "middle" });
d.text([100, 0], "CENTERLINE", { height: 1, align: "right" });
```

| `align`    | The point is                          |
| ---------- | ------------------------------------- |
| `"left"`   | The left end of the text. The default |
| `"center"` | Half way along the text               |
| `"right"`  | The right end of the text             |

| `valign`     | The point is                                     |
| ------------ | ------------------------------------------------ |
| `"baseline"` | On the line the letters stand on. The default    |
| `"bottom"`   | At the bottom of the letters that reach below it |
| `"middle"`   | Half way up a capital                            |
| `"top"`      | At the top of a capital                          |

tsdraft writes the point as the text's alignment point, so no width has to be estimated to
center a text or to end it at a point. AutoCAD's "aligned" and "fit" modes, which stretch a
text between two points, are not written.

## How long a text is

`measureText` gives the length a text plots at, and the box its capitals fill:

```ts
import { measureText } from "tsdraft";

measureText({ value: "GENERAL NOTES", height: 0.125 }).length; // 1.583 in txt.shx
const { length, corners, descent, approximate } = measureText({
  value: "LOT 12",
  height: 2,
  font: "Arial",
  widthFactor: 0.9,
  obliqueAngle: 15,
  at: [50, 20],
  rotation: 30,
  align: "center",
  valign: "middle",
});
```

It takes a text's `value` and `height`, the `font`, `widthFactor` and `obliqueAngle` of its
style, and its `at`, `rotation`, `align` and `valign`. All but the first two may be left out:
the font is then `txt.shx`, the font of `Standard`. A `Text` and its `TextStyle` spread into
one object are such a text.

- `length` is how long the text is along its baseline, from where its first character starts
  to draw to where its last one ends. It is the sum of the characters' advances, less the
  blank a last character leaves after it, times the height and the width factor. Kerning is
  not counted.
- `corners` is the box of the text's capitals, turned as the text is: the start and the end of
  the baseline, then the end and the start of the line along the top of a capital. A centered
  text has its point half way along it, and a right-justified one at its end. The point of a
  text justified to its `top` is one height above the baseline, to its `middle` half a height,
  and to its `bottom` as far below the baseline as its font draws. An oblique angle leans the
  box as it leans the letters: the top lies further along by the height times the tangent of
  the angle, whatever the width factor.
- `descent` is how far below the baseline the font's letters reach, as the tail of a `g` does.
  The box leaves that out.
- `approximate` is true for an estimate. `FONT_METRICS` holds the widths of each font's
  characters from U+0020 to U+007E and from U+00A0 to U+00FF. Any other character is taken
  to be as wide as `?`. `%%d`, `%%p` and `%%c`, which AutoCAD draws as a degree sign, a
  plus-or-minus sign and a diameter sign, each count as one character. A text with any of
  these, or with another `%%`, is measured approximately, and so is a centered or
  right-justified text that starts or ends with a space.

A capital of `txt.shx` moves the text on by its whole height, and one of Arial by about 0.9
of it, so lay out columns and break lines by `measureText`, never by a guess per character. The
drawing's extents, `toSVG` and `inspectText` all take a text's box from it.

## Text as it plots

`toSVG` starts each text where `measureText` says it plots, sets its `textLength` to the length
it plots at, and keeps its spaces, so a text is as long in the picture as on paper, in any
font. It draws the text in a CSS font family for its font, ending in a generic family for a
screen that lacks the font, at a size that makes that font's capitals the text's height: the
height itself is in the element's `data-height`. An SHX font is drawn in a generic family, as
a font whose capitals are 0.7 of its size, so on a screen an SHX text's letters have other
shapes and may be a little taller or shorter than they plot. The
[command's PNG](command.md#fonts-in-a-png) sizes each text by the typeface it draws it in.
`toSVG` draws `%%d`, `%%p` and `%%c` as the characters AutoCAD draws for them.

`inspectText(drawing)` returns warnings about text that plots badly, which no rule of the file
forbids, so `lint` does not report them and `toDXF` writes the file all the same:

| Rule                   | The text                                                                     |
| ---------------------- | ---------------------------------------------------------------------------- |
| `text-overlaps-text`   | Lies over another text, by more than a tenth of the smaller one's height     |
| `text-leaves-boundary` | Has its point inside a closed polyline, or on it, and runs past the polyline |
| `text-off-paper`       | Is on a layout and runs off its paper                                        |

The boundary of a text is the smallest closed polyline around its point: the border of a
sheet, the outline of a room, the cell of a table drawn as a rectangle. Four separate lines
bound nothing. A text may pass its boundary, or the paper, by a tenth of its height. Each
warning has `bounds`, the box of the text as it plots, or of both texts of an overlap, in the
coordinates of its space, and `other`, which names the other text or the polyline. `entity` is
the index of the entity in model space, or in the layout that `layout` names. For a
dimension's text it is the dimension's index. For a text an insert draws it is the insert's
index, with the tag in `attribute` when the text is one of the insert's attributes.

Only what plots is looked at: nothing on a layer that is off, frozen or set not to plot,
unless `drawNoPlot` is given, as for `toSVG`. Model space and each layout are looked at apart.
A text with nothing but spaces in it is left out, so a blank attribute warns of nothing. A
text gets one warning of each rule at most. Its work is bounded: a drawing with more text and
closed polylines near each other than it checks, such as thousands of texts on one spot, gets
one `text-check-capped` warning, and what is left is not held against other texts or
polylines. `inspectText` takes the `xrefs` that `toSVG` takes, and like it may throw on a
drawing `lint` reports an error for.

## Escapes

When AutoCAD opens tsdraft's DXF, it holds each text exactly as the drawing has
it. tsdraft escapes what DXF would otherwise read as something else: a caret,
and a backslash that starts `\U+XXXX` or `\M+NXXXX`, which AutoCAD decodes into
a character. A text `\U+00B0` reaches AutoCAD as those seven characters and not
as a degree sign. Write the character itself, `°`, to get the character.

That lasts until AutoCAD saves the drawing, because AutoCAD does not escape these
sequences in what it writes. After it saves as DWG and opens the file again, a
text `\M+18140` holds the character U+3000. After it saves as DXF and opens
that, `\U+00B0` holds a degree sign as well. tsdraft cannot change this.
