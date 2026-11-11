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

`toSVG` anchors a text at its point and draws it in a CSS font family for its font, ending in
a generic family for a screen that lacks the font. It does not read the fonts, so a text may be
a little wider or narrower on screen than in CAD.

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
