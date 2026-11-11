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
- DXF has one writer per version: `src/dxf-r12.ts` (AC1009) and
  `src/dxf-r2018.ts` (AC1032, the default). R12 is frozen: a new feature is
  R2018 only, and `lint` refuses an R12 drawing that uses it. Check that an
  entity or header variable exists in the target version before writing it.
  `src/dxf.ts` picks the writer.
- AC1032 needs every handle unique, every owner (330) and pointer (340, 350, 390) to resolve, and `$HANDSEED` above the highest handle. AutoCAD also
  discards the whole file if a LAYER has no 390 plot style pointer. The tests
  check all of this.
- A rule AutoCAD enforces lives in `src/rules.ts` twice: as a type, so a wrong
  literal is a compile error, and as a runtime check with the same message. The
  builder calls the runtime check, and `lint()` in `src/lint.ts` repeats it for
  drawings built another way. `toDXF` refuses to write a drawing with lint
  errors. Test a new rule with `@ts-expect-error` inside `assert.throws`, as
  `test/rules.test.ts` does, so both halves are proven.
- The writers print numbers with 6 decimals. `written` in `src/format.ts` is that
  rounding, and `lint` judges sizes, points and arc angles as written. A new
  check on a number must do the same.
- AutoCAD reads two exponent digits from DXF, so no number may be written as
  1e100 or more. `lint` refuses those in a drawing. A number a writer works out
  for itself, such as an extent, must go through `readable` in `src/format.ts`.
- `src/layers.ts` holds what AutoCAD does with layer-name characters: the ones
  it refuses, the capitals it lower-cases to compare names, and the pairs only
  `AUDIT` calls duplicates. Never compare layer names with `toLowerCase()`.
- AutoCAD holds linetype names to the layer-name rules and compares them the
  same way, so linetypes use `layerKey`, `layerAuditKey` and the name checks of
  layers.
- `src/fonts.ts` is the one list of fonts a text style may have, with the file
  AutoCAD stores for each and, for a TrueType font, its pitch and family.
  `lint`, both writers and `toSVG` read it. Add a font only when AutoCAD 2025
  or Windows installs it.
- Text style names use `layerKey`, `layerAuditKey` and the name checks of
  layers, as linetype names do. A text holds its own width factor and oblique
  angle in the file, so the writers copy them from its style.
- `layerAuditKey` follows only the kinds of pair `docs/layer-names.md` lists,
  and must never call two names duplicates when `AUDIT` does not. Add a kind
  only when `AUDIT` reports every pair of that kind as a duplicate.
- Passing ezdxf or another parser proves little: AutoCAD discards files they
  accept.
- The published package must run on Node 22. Only development tooling may need
  Node 24; on Node 22, development needs 22.18 or later for type stripping.
- Changes reach this repo only through export pull requests, as
  `CONTRIBUTING.md` says. Release by bumping `version` and the CHANGELOG,
  merging the export pull request that carries them, then publishing a GitHub
  release tagged `v<version>` on the commit that merge made. The Release
  workflow publishes to npm through trusted publishing. Never publish from a
  laptop with a token.
