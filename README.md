<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Surfside-Software/tsdraft/main/docs/assets/tsdraft-logo-dark.svg">
  <img src="https://raw.githubusercontent.com/Surfside-Software/tsdraft/main/docs/assets/tsdraft-logo-light.svg" alt="tsdraft" width="292" height="64">
</picture>

Write 2D CAD drawings in TypeScript and export them as DXF for CAD programs, or
as SVG for a quick preview.

[![npm](https://img.shields.io/npm/v/tsdraft?color=1aafc8)](https://www.npmjs.com/package/tsdraft)
[![CI](https://img.shields.io/github/actions/workflow/status/Surfside-Software/tsdraft/ci.yml?branch=main&label=CI)](https://github.com/Surfside-Software/tsdraft/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/tsdraft?color=1aafc8)](LICENSE)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Surfside-Software/tsdraft/main/docs/assets/site-plan-dark.svg">
  <img src="https://raw.githubusercontent.com/Surfside-Software/tsdraft/main/docs/assets/site-plan-light.svg" alt="A site plan drawn by tsdraft: a lot with its setbacks, a house, a driveway, six trees and the street" width="640">
</picture>

```ts
import { createDrawing, toDXF, toSVG } from "tsdraft";

const lot = { width: 120, depth: 80 }; // ft
const setbacks = { front: 20, side: 10, rear: 15 };
const house = { width: 56, depth: 32 };
const x = (lot.width - house.width) / 2;
const y = setbacks.front + 5;

const d = createDrawing({ units: "ft" });

d.layer("C-PROP", { color: 3 }, () => {
  d.rect([0, 0], lot.width, lot.depth);
  d.text([2, -6], `LOT ${lot.width}' x ${lot.depth}'`, { height: 3 });
});
d.layer("C-SETB", { color: 4 }, () => {
  const { front, side, rear } = setbacks;
  d.rect([side, front], lot.width - side * 2, lot.depth - front - rear);
});
d.layer("A-BLDG", { color: 1 }, () => {
  d.rect([x, y], house.width, house.depth);
  d.text([x + 2, y + house.depth / 2], "PROPOSED RESIDENCE", { height: 3 });
});
d.layer("C-PAVE", { color: 8 }, () => {
  d.line([x + 40, y], [x + 40, -12]);
  d.line([x + 52, y], [x + 52, -12]);
});
d.layer("C-ROAD", { color: 2 }, () => {
  d.line([-10, -12], [lot.width + 10, -12]);
  d.text([lot.width / 2 - 10, -18], "MAIN STREET", { height: 3 });
});
d.layer("V-TREE", { color: 3 }, () => {
  for (let i = 0; i < 6; i++) d.circle([15 + i * 18, 72], 5);
});

const drawing = d.build();
const dxf = toDXF(drawing);
const svg = toSVG(drawing);
```

The picture is the SVG that `toSVG` writes for this code, restyled for this
page. A drawing is a program, so dimensions can come from variables, drawings
can share code, and changes show up as diffs.

Coordinates are in drawing units with Y pointing up, as in CAD. Angles are in
degrees, counterclockwise from +X. Layer colors are AutoCAD Color Index numbers.
Entities go on layer `0` unless they are drawn inside a `layer()` callback.

## Status

tsdraft is at an early stage. It draws layers, lines, polylines, rectangles,
circles, arcs and single-line text. It does not yet have dimensions, hatches,
blocks, linetypes, lineweights or paper space layouts. It writes DXF, not DWG.

The DXF output is tested by opening it in AutoCAD 2025 and running `AUDIT`. It
has not been tested in BricsCAD or any other CAD program yet.

## Install

```sh
npm install tsdraft
```

tsdraft is an ES module and needs Node 22 or later.

## DXF versions

A drawing is written for one DXF version. `createDrawing()` targets R12, the
oldest version still in common use, which nearly every CAD program can open.
`createDrawing({ dxf: "R2018" })` targets the version AutoCAD has used since
2018, which is the newest one Autodesk has published. `toDXF(drawing)` writes
the drawing's version, and `toDXF(drawing, { version })` writes another one.

|               | `"R12"`, the default                               | `"R2018"`                                                               |
| ------------- | -------------------------------------------------- | ----------------------------------------------------------------------- |
| Format code   | AC1009                                             | AC1032                                                                  |
| Drawing units | Not stored. Set them in CAD with `UNITS`.          | Stored in `$INSUNITS`.                                                  |
| Polylines     | `POLYLINE` with `VERTEX` records                   | `LWPOLYLINE`                                                            |
| Text          | ASCII, with `\U+XXXX` escapes for other characters | UTF-8                                                                   |
| Layer names   | Up to 31 letters, digits, `$`, `-` and `_`         | Up to 255 characters, except those in [the rules](docs/rules.md#errors) |

Choose R2018 when the drawing will be inserted into another drawing, because CAD
needs the stored units to scale it correctly. AutoCAD shows layer names from an
R12 file in upper case.

## Checks

AutoCAD discards a whole drawing over one bad layer name, and it reports no
line of your code when it does. tsdraft checks the rules AutoCAD enforces at
three points, so the mistake shows up where you made it.

1. **In the editor.** Layer names, colors and sizes written as literals are
   checked by the TypeScript compiler, and the error message says what is wrong.
2. **When the code runs.** The builder throws at the call that breaks a rule.
   This covers values the compiler cannot see, such as a name read from a file.
3. **Before export.** `lint(drawing)` returns every problem in a drawing, and
   `toDXF` throws a `DrawingError` that lists them instead of writing a file
   AutoCAD would reject.

```ts
const d = createDrawing({ units: "ft" });

d.layer("A WALL");
// error TS2345: Argument of type '"A WALL"' is not assignable to parameter of
// type '"R12 layer names can only use letters, digits, $, - and _. Use DXF
// version \"R2018\" for other characters"'.

createDrawing({ dxf: "R2018" }).layer("A WALL"); // fine

lint(drawing, { version: "R12" }); // check a drawing against another version
```

## Reference

- [Rules](docs/rules.md) lists what `lint` refuses and what it warns about.
- [Layer names](docs/layer-names.md) explains how AutoCAD compares layer names,
  and lists the pairs `AUDIT` calls duplicates and the characters it refuses.
- [Text](docs/text.md) explains what tsdraft escapes in text, and what AutoCAD
  does with it after a save.

## Development

Contributors need Node 24 or later and pnpm. Node runs the TypeScript source
directly, so tests and examples need no build step.

```sh
pnpm install
pnpm verify          # format check, lint, type check, tests, package smoke test
pnpm example         # writes a site plan to examples/out/ as DXF and SVG
pnpm readme:drawing  # redraws the picture at the top of this page from the example
```

[docs/development.md](docs/development.md) covers `pnpm test:cad` (which opens
the output in AutoCAD), the package smoke test, the TypeScript compilers and
releasing.

## Contributing

tsdraft is developed in a private repository and published here through pull
requests from the `export` branch. Issues are welcome.
[`CONTRIBUTING.md`](CONTRIBUTING.md) says how changes arrive.

## License

[MIT](LICENSE)
