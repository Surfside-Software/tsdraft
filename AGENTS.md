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
- DXF output targets R12 (AC1009). Check that an entity or header variable exists
  in R12 before writing it, or add a newer DXF version as a separate writer.
- The published package must run on Node 22. Only development tooling may need
  Node 24.
- Test a DXF change by opening the example output in BricsCAD or AutoCAD when you
  can. Follow the `cad-automation-notes` skill before any live CAD call.
