# Text

When AutoCAD opens tsdraft's DXF, it holds each text exactly as the drawing has
it. tsdraft escapes what DXF would otherwise read as something else: a caret,
and a backslash that starts `\U+XXXX` or `\M+NXXXX`, which AutoCAD decodes into
a character. A text `\U+00B0` reaches AutoCAD as those seven characters and not
as a degree sign. Write the character itself, `°`, to get the character.

That lasts until AutoCAD saves the drawing, because AutoCAD does not escape these
sequences in what it writes. After it saves as DWG and opens the file again, a
text `\M+18140` holds the character U+3000. After it saves as DXF and opens
that, `\U+00B0` holds a degree sign as well. tsdraft cannot change this.
