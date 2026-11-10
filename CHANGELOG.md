# Changelog

## Unreleased

Every fix below was found by opening tsdraft's output in AutoCAD 2025.

- Fixed: text holding `\U+XXXX` or `\M+NXXXX` came out in AutoCAD as the
  character those escapes stand for, so `\U+00B0` became a degree sign and
  `\U+000A` put a line feed inside a single-line text. Both DXF versions now
  write such a backslash so that AutoCAD holds the text as the drawing has it
  when it opens the file. AutoCAD decodes the text after all once it has saved
  the drawing itself and opened it again: `\M+NXXXX` after a save as DWG, and
  `\U+XXXX` too after a save as DXF.
- Fixed: a size too small for the 6 decimals tsdraft writes was written as 0.
  AutoCAD gave such a text its default height, and held such a circle or arc
  with radius 0. A radius, text height or rectangle size that would be written
  as 0 is now an error, in the compiler for a literal and when the code runs.
  `rect()` also throws when a side is lost because two corners round together.
- Fixed: AutoCAD reads only two exponent digits from DXF, so it took a number
  written as `1e+100` for `1e+10`, with no `AUDIT` error. A coordinate, size or
  text rotation of 1e100 or more is now an error, in the compiler for a size
  written as a literal and when the code runs. The R2018 writer also caps the
  extents and the view height it works out, which could pass 1e100 for a
  drawing whose own numbers are all smaller.
- Fixed: an arc within 0.000001 degrees of a full turn was written with equal
  angles, which AutoCAD holds as an arc of no length. It is now an error. An arc
  angle that rounds up to 360 is written as 0.
- Fixed: `toDXF` wrote layer `0` wherever the drawing listed it, and `AUDIT`
  reported "Layer zero name found at incorrect index" when another layer came
  first. Layer `0` is now written first.
- Fixed: `lint` matched layer names with JavaScript's `toLowerCase()`, which
  AutoCAD does not use. It accepted an entity on `οδος` for a layer `ΟΔΟΣ`,
  where AutoCAD makes a second layer. `lint` and the builder now compare names
  as AutoCAD does. The README lists the pairs that differ.
- Fixed: two layers such as `ΟΔΟΣ` and `οδος`, which AutoCAD keeps apart but
  its `AUDIT` reports as a duplicate name, are now an error.
- Fixed: AutoCAD discarded a drawing whose layer name had a zero-width space,
  another invisible formatting character, a letterlike symbol such as the ohm
  sign U+2126, or a Glagolitic, Coptic, Tifinagh, Georgian Supplement, Latin
  Extended-C or Ethiopic Extended letter. Those names are now errors, in the
  compiler for a literal and when the code runs. The README lists them.
- Fixed: `lint` threw a `RangeError` on a polyline of about 100,000 points or
  more.
- Fixed: a layer name that starts or ends with a no-break space, or another
  space outside ASCII, threw when the code ran, though the compiler accepted
  the literal and AutoCAD accepts the name. Only an ASCII space is refused now.
- Fixed: AutoCAD replaced the private-use characters U+E800 to U+E8FF in text
  and layer names. They are now errors.
- Fixed: `toSVG` drew nothing for an arc so close to a full turn that its ends
  rounded to one point, and ignored a layer's color when an entity spelled the
  layer's name in another case.
- Changed: a `DrawingError` message starts "The drawing has 3 problems:" and no
  longer names DXF, because code other than `toDXF` uses it to refuse a drawing.
- Changed: `lint` messages for a bad radius or height read "radius: This value
  must be greater than 0", the wording the compiler uses for a literal.
- `lint` warns about a polyline or an arc with no length, as it does for a line,
  and about a line, polyline or arc that loses its length to rounding.
- `lint` warns about text that contains `%%`, which AutoCAD stores as written
  but draws as a control code: `%%d` is drawn as a degree sign.
- `pnpm test:cad` covers each fix above, and checks every character `lint`
  accepts in text and in layer names, and each form of number the writers
  print, against AutoCAD.

## 0.2.0

0.1.1 was never published, so its changes ship here too.

Every fix below comes from opening tsdraft's output in AutoCAD 2025.

- `createDrawing({ dxf: "R2018" })` targets AC1032, the DXF version AutoCAD has
  used since 2018. It writes handles, owner links, the standard tables, model
  and paper space blocks, plot styles and `$INSUNITS`. R12 stays the default.
  `toDXF(drawing)` writes the drawing's version, and
  `toDXF(drawing, { version })` writes another.
- Layer names, layer colors, radii, text heights and rectangle sizes written as
  literals are checked by the compiler. The same checks run when the code runs.
- `lint(drawing, { version })` returns every problem in a drawing. `toDXF`
  throws a `DrawingError` listing the errors instead of writing a file AutoCAD
  would reject.
- Fixed: AutoCAD discarded R12 drawings whose layer names had spaces, dots or
  other punctuation, or more than 31 characters. Those names are now errors in
  an R12 drawing and allowed in an R2018 drawing.
- Fixed: a layer name containing a line break wrote extra records into the
  file. Commas, carets and leading or trailing spaces are rejected too.
- Fixed: AutoCAD discarded any drawing with a `^` in its text. A caret is now
  escaped.
- Fixed: R12 text outside ASCII came out garbled. It is now written as
  `\U+XXXX` escapes.
- Fixed: arc angles outside 0 to 360 failed `AUDIT`. Angles are now stored from
  0 up to 360.
- Fixed: `wall` and `WALL` were two layers, and AutoCAD kept only the first.
  They are now one layer.
- Text with control characters, or with emoji and other characters above
  U+FFFF, is rejected, because AutoCAD cannot read it.
- Unknown units, and rectangle sizes of 0 or less, are rejected.
- Breaking: a `Drawing` now has a required `dxf` field, and R12 layer names
  AutoCAD rejects now throw (see above).
- `pnpm test:cad` runs the output through AutoCAD over ssh.
- Published from GitHub Actions through npm trusted publishing, with a
  provenance attestation linking the package to its source commit.
- `tsdraft/package.json` can be imported or resolved.
- The package now includes this changelog.

## 0.1.0

First release.

- `createDrawing()` builds a drawing with layers (AutoCAD Color Index colors),
  lines, polylines, rectangles, circles, arcs and single-line text.
- `toDXF()` writes ASCII DXF R12 (AC1009) with layer and linetype tables.
- `toSVG()` writes an SVG preview with model Y pointing up.
