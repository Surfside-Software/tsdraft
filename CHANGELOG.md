# Changelog

## Unreleased

- `toDXF(drawing, { version: "R2018" })` writes AC1032 DXF with handles, owner
  links, the standard tables, model and paper space blocks, a root dictionary
  and `$INSUNITS`. R12 stays the default.
- `DxfOptions` and `DxfVersion` are exported.

## 0.1.1

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
