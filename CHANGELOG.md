# Changelog

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
