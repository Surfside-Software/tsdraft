# Agent notes

- Run `pnpm verify` before finishing a change. It checks formatting, lints,
  type checks, runs the tests and runs the package smoke test, which builds.
  Run `pnpm fmt` to fix formatting.
- Source files import each other with `.ts` extensions. Node runs them directly,
  and `tsc` rewrites the extensions to `.js` when it builds `dist/`.
- Keep syntax erasable: no enums, namespaces or parameter properties.
  `erasableSyntaxOnly` enforces this, because Node only strips types.
- Official `tsc` from `typescript` is the gate for checks and builds. `tsrs` is
  informational until it tracks the same TypeScript version.
- Model coordinates have Y pointing up and angles in degrees counterclockwise,
  matching DXF. Only `toSVG` flips Y.
- DXF has one writer per version: `src/dxf-r12.ts` (AC1009, the default) and
  `src/dxf-r2018.ts` (AC1032). Check that an entity or header variable exists in
  the target version before writing it. `src/dxf.ts` picks the writer.
- AC1032 needs every handle unique, every owner (330) and pointer (340, 350, 390) to resolve, and `$HANDSEED` above the highest handle. AutoCAD also
  discards the whole file if a LAYER has no 390 plot style pointer. The tests
  check all of this.
- The published package must run on Node 22. Only development tooling may need
  Node 24; on Node 22, development needs 22.18 or later for type stripping.
- Release by bumping `version` and the CHANGELOG in a PR, merging it, then
  publishing a GitHub release tagged `v<version>` on the merge commit. The
  Release workflow publishes to npm through trusted publishing. Never publish
  from a laptop with a token.
- Test a DXF change by opening the example output in BricsCAD or AutoCAD when you
  can. Follow the `cad-automation-notes` skill before any live CAD call.
