# Agent notes

- Run `pnpm verify` before finishing a change. It type checks, runs the tests
  and builds.
- Source files import each other with `.ts` extensions. Node runs them directly,
  and `tsc` rewrites the extensions to `.js` when it builds `dist/`.
- Keep syntax erasable: no enums, namespaces or parameter properties.
  `erasableSyntaxOnly` enforces this, because Node only strips types.
- Model coordinates have Y pointing up and angles in degrees counterclockwise,
  matching DXF. Only `toSVG` flips Y.
- DXF output targets R12 (AC1009). Check that a new entity exists in R12 before
  writing it, or add a newer DXF version as a separate writer.
- Test a DXF change by opening the example output in BricsCAD or AutoCAD when you
  can. Follow the `cad-automation-notes` skill before any live CAD call.
