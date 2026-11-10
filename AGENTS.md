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
  The tables came from AutoCAD, and `pnpm test:cad` checks them against it.
- `layerAuditKey` follows only the kinds of pair measured in AutoCAD, and must
  never call two names duplicates when `AUDIT` does not. Add a kind only with an
  AutoCAD result behind it and a pair in `auditPairs` in `scripts/cad-check.ts`.
- Passing ezdxf or another parser proves little: AutoCAD discards files they
  accept. After changing a DXF writer or a rule, run `pnpm test:cad` with
  `TSDRAFT_CAD_SSH` set. It runs AutoCAD's headless console on another machine,
  never an open CAD window. Add a case there for anything new the writer emits.
- The published package must run on Node 22. Only development tooling may need
  Node 24; on Node 22, development needs 22.18 or later for type stripping.
- Release by bumping `version` and the CHANGELOG in a PR, merging it, then
  publishing a GitHub release tagged `v<version>` on the merge commit. The
  Release workflow publishes to npm through trusted publishing. Never publish
  from a laptop with a token.
- Follow the `cad-automation-notes` skill before any live CAD call.
