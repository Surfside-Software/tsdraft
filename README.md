# tsdraft

Write 2D CAD drawings in TypeScript and export them as DXF for AutoCAD or
BricsCAD, or as SVG for a quick preview. A drawing is a program, so dimensions
can come from variables, sheets can share code, and changes show up as diffs.
[tscircuit](https://github.com/tscircuit/tscircuit) takes the same approach to
circuit boards.

This is an early start. It has layers, lines, polylines, rectangles, circles,
arcs and single-line text. It does not yet have dimensions, hatches, blocks,
paper space or a JSX syntax.

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
version. It also sets `$INSUNITS` from the drawing's units.

## Development

Requires Node 24 or later and pnpm. Node runs the TypeScript source directly, so
tests and examples need no build step.

```sh
pnpm install
pnpm verify    # type check, tests, build
pnpm example   # writes examples/out/site-plan.dxf and .svg
```

`pnpm build` compiles `src/` to `dist/` for publishing.

## Status

The package is still marked `private`, so `npm publish` refuses to run.
Remove `"private": true` when the first version is ready to publish.

## License

[MIT](LICENSE)
