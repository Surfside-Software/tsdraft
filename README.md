# tsdraft

Write 2D CAD drawings in TypeScript and export them as DXF for AutoCAD or
BricsCAD, or as SVG for a quick preview. A drawing is a program, so dimensions
can come from variables, sheets can share code, and changes show up as diffs.
[tscircuit](https://github.com/tscircuit/tscircuit) takes the same approach to
circuit boards.

This is an early release. It has layers, lines, polylines, rectangles, circles,
arcs and single-line text. It does not yet have dimensions, hatches, blocks,
paper space or a JSX syntax.

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

`toDXF` writes ASCII DXF R12, because nearly every CAD program can open that
version. R12 has no field for drawing units, so the file holds plain numbers.
Set the units in CAD after opening it, for example with `UNITS` in AutoCAD or
BricsCAD.

## Development

Contributors need Node 24 or later and pnpm. Node runs the TypeScript source
directly, so tests and examples need no build step.

```sh
pnpm install
pnpm verify    # format check, lint, type check, tests, package smoke test
pnpm example   # writes examples/out/site-plan.dxf and .svg
```

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
