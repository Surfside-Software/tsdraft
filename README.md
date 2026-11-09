# tsdraft

Write 2D CAD drawings in TypeScript and export them as DXF, the exchange format
that AutoCAD, BricsCAD and most other CAD programs open, or as SVG for a quick
preview. A drawing is a program, so dimensions can come from variables, drawings
can share code, and changes show up as diffs.

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

## Example

```ts
import { createDrawing, toDXF, toSVG } from "tsdraft";

const d = createDrawing({ units: "ft" });

d.layer("C-PROP", { color: 3 }, () => {
  d.rect([0, 0], 75, 120);
});
d.layer("A-BLDG", { color: 1 }, () => {
  d.rect([17.5, 30], 40, 50);
  d.text([19.5, 55], "PROPOSED RESIDENCE", { height: 2 });
});

const drawing = d.build();
const dxf = toDXF(drawing);
const svg = toSVG(drawing);
```

Coordinates are in drawing units with Y pointing up, as in CAD. Angles are in
degrees, counterclockwise from +X. Layer colors are AutoCAD Color Index numbers.
Entities go on layer `0` unless they are drawn inside a `layer()` callback.

## DXF versions

A drawing is written for one DXF version. `createDrawing()` targets R12, the
oldest version still in common use, which nearly every CAD program can open.
`createDrawing({ dxf: "R2018" })` targets the version AutoCAD has used since
2018, which is the newest one Autodesk has published. `toDXF(drawing)` writes
the drawing's version, and `toDXF(drawing, { version })` writes another one.

|               | `"R12"`, the default                               | `"R2018"`                                              |
| ------------- | -------------------------------------------------- | ------------------------------------------------------ |
| Format code   | AC1009                                             | AC1032                                                 |
| Drawing units | Not stored. Set them in CAD with `UNITS`.          | Stored in `$INSUNITS`.                                 |
| Polylines     | `POLYLINE` with `VERTEX` records                   | `LWPOLYLINE`                                           |
| Text          | ASCII, with `\U+XXXX` escapes for other characters | UTF-8                                                  |
| Layer names   | Up to 31 letters, digits, `$`, `-` and `_`         | Up to 255 characters, with the exceptions listed below |

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

The rules:

- Layer names cannot be empty, start or end with a space, or contain a line
  break or any of ``< > / \ " : ; ? * | = ` ^ ,``. R12 names have the tighter
  limits in the table above.
- `wall` and `WALL` are the same layer, as in CAD. The first spelling is kept.
- Layer colors are whole numbers from 1 to 255.
- Radii, text heights and rectangle sizes are greater than 0.
- Text is a single line. It cannot contain emoji or other characters above
  U+FFFF, because AutoCAD cannot read them from DXF.
- Arc angles are stored from 0 up to 360, so -90 becomes 270.

`lint` also returns warnings, such as a line with no length. Warnings do not
stop an export.

## Development

Contributors need Node 24 or later and pnpm. Node runs the TypeScript source
directly, so tests and examples need no build step.

```sh
pnpm install
pnpm verify    # format check, lint, type check, tests, package smoke test
pnpm example   # writes a site plan to examples/out/ as DXF and SVG
```

`pnpm test:cad` opens the output in AutoCAD. It needs
`TSDRAFT_CAD_SSH=user@host`, an ssh login to a WSL shell on a Windows machine
that has AutoCAD. Each test drawing runs in AutoCAD's headless console, which
runs `AUDIT` and saves the drawing back as DXF. The script then compares that
file with what was drawn. Run it after any change to a DXF writer, because
AutoCAD rejects files that DXF parsing libraries accept.

`pnpm test:package` packs the package, installs the tarball into a throwaway
project and checks that it type-checks and runs there. `pnpm build` compiles
`src/` to `dist/`, and `npm pack` and `npm publish` run it automatically.

The official TypeScript 7 compiler checks and builds the package.
[tsrs](https://github.com/oxc-project/tsrs), the Rust port of TypeScript, runs
as `pnpm check:tsrs` and as an informational CI step. It tracks TypeScript 7.1
beta, so it does not gate releases yet. Its WebAssembly build is the planned
route for type-checking drawings in a browser playground.

## Releasing

Bump `version` in `package.json` and add a CHANGELOG entry in a pull request.
After it merges, publish a GitHub release tagged `v<version>` on the merge
commit. The Release workflow checks that the tag matches the version, runs
`pnpm verify` and publishes to npm through
[trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm token
is stored anywhere. npm adds a provenance attestation that links each version to
the commit it was built from.

## License

[MIT](LICENSE)
