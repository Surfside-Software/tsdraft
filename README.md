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

Numbers are written with 6 decimals, in DXF and in SVG. The checks below judge
a drawing as it will be written, so a size too small to survive the rounding is
an error and a line that rounds down to a point is a warning. Every number must
also be under 1e100 in size. AutoCAD reads only two exponent digits from DXF, so
it would take `1e+100` for `1e+10` and report nothing.

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
- Layer names cannot contain the other characters AutoCAD refuses in a name. It
  discards the drawing over any of them, and they are listed under
  [Layer name characters](#layer-name-characters).
- `wall` and `WALL` are the same layer, as in CAD. The first spelling is kept.
  tsdraft compares names the way AutoCAD does, which is not the way JavaScript
  does: see [Layer names and case](#layer-names-and-case).
- Layer colors are whole numbers from 1 to 255.
- Radii, text heights and rectangle sizes are greater than 0, and large enough
  not to be written as 0. Anything from 0.000001 up is safe. AutoCAD gives text
  of height 0 its default height.
- Text is a single line. It cannot contain emoji or other characters above
  U+FFFF, because AutoCAD cannot read them from DXF, or the private-use
  characters U+E800 to U+E8FF, which AutoCAD replaces.
- Coordinates, sizes and text rotations are under 1e100 in size, because
  AutoCAD reads only two exponent digits from DXF.
- Arc angles are stored from 0 up to 360, so -90 becomes 270. An arc cannot come
  within 0.000001 degrees of a full turn, because its two angles would be
  written the same and AutoCAD holds such an arc as having no length. Draw a
  circle instead.

`lint` also returns warnings. Warnings do not stop an export. They are:

- A line, a polyline or an arc that has no length, or has none once its numbers
  are rounded.
- Text that contains `%%`. AutoCAD stores the text as written but reads `%%` as
  the start of a control code when it draws it: `%%d` is drawn as a degree sign
  and `%%%` as one percent sign.

`toDXF` throws a `DrawingError` for errors only. Its `diagnostics` property holds
them, and other code may throw one to refuse a drawing for its own reasons.

### Text

When AutoCAD opens tsdraft's DXF, it holds each text exactly as the drawing has
it. tsdraft escapes what DXF would otherwise read as something else: a caret,
and a backslash that starts `\U+XXXX` or `\M+NXXXX`, which AutoCAD decodes into
a character. A text `\U+00B0` reaches AutoCAD as those seven characters and not
as a degree sign. Write the character itself, `°`, to get the character.

That lasts until AutoCAD saves the drawing, because AutoCAD does not escape these
sequences in what it writes. After it saves as DWG and opens the file again, a
text `\M+18140` holds the character U+3000. After it saves as DXF and opens
that, `\U+00B0` holds a degree sign as well. tsdraft cannot change this.

### Layer names and case

AutoCAD lower-cases a layer name one character at a time, from a table of its
own that is older and smaller than Unicode's. An entity on `mixedcase`, `café`,
`αβγ` or `СЛОЙ` goes on a layer declared as `MixedCase`, `CAFÉ`, `ΑΒΓ` or `Слой`,
and `lint` accepts it. AutoCAD does not pair these, and `lint` reports the
entity's layer as undefined:

- `ΟΔΟΣ` and `οδος`, because of the final sigma `ς`. `οδοσ` does match.
- `STRASSE` and `straße`, and `TITLE` and `tıtle` with a dotless `ı`.
- `Ÿ` and `ÿ`, `İ` and `i`, and the title-case digraphs such as `ǅ`.
- Georgian, Cherokee and most other letters that gained a case after Unicode
  5.1.

Declaring both spellings as layers is an error too for some of these pairs,
among them `ΟΔΟΣ` and `οδος`, `Ÿ` and `ÿ`, and `ß` and `ẞ`. AutoCAD keeps two
layers, and its `AUDIT` then reports a duplicate name.

`AUDIT` compares names more loosely than `lint` can follow in full. It also
reports `straße` and `strasse`, `æ` and `ae`, and a composed `é` and its
decomposed form as duplicates, and `lint` does not catch those.

### Layer name characters

AutoCAD refuses these characters in a layer name, so `lint` does too. Over any
of them but the last row's, AutoCAD discards the whole drawing. All are outside
ASCII, so they only concern R2018 drawings.

| Characters                                                                 | What they are                                              |
| -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| U+0080 to U+009F                                                           | C1 control characters                                      |
| U+0600 to U+0603, U+06DD, U+070F, U+17B4, U+17B5                           | Arabic, Syriac and Khmer formatting characters             |
| U+200B to U+200F, U+202A to U+202E, U+2060 to U+2064, U+206A to U+206F     | Zero-width spaces and joiners, and text direction controls |
| U+FEFF, U+FFF9 to U+FFFB                                                   | The byte order mark and annotation characters              |
| U+2071, U+207F, U+2090 to U+2094                                           | Superscript and subscript letters                          |
| Letters in U+2102 to U+214E, such as `ℓ`, `ℕ`, the ohm sign and the kelvin | Letterlike symbols. Use the Greek `Ω`, U+03A9, for ohms.   |
| U+2180 to U+2188                                                           | Roman numeral characters                                   |
| U+2C00 to U+2C5E, except U+2C2F                                            | Glagolitic                                                 |
| U+2C60 to U+2C7D, except U+2C70                                            | Latin Extended-C                                           |
| U+2C80 to U+2CE4                                                           | Coptic                                                     |
| U+2D00 to U+2D25                                                           | Georgian Supplement                                        |
| U+2D30 to U+2D65, U+2D6F                                                   | Tifinagh                                                   |
| Letters in U+2D80 to U+2DDE                                                | Ethiopic Extended                                          |
| U+E800 to U+E8FF                                                           | Private use. AutoCAD replaces these and keeps the drawing. |

`src/layers.ts` has the exact list.

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
AutoCAD rejects files that DXF parsing libraries accept. Some of its cases write
a file `toDXF` would refuse, to show that AutoCAD does what the rule says.

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
