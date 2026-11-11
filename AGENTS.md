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
- An entity with an id takes the handle `idHandle` in `src/handles.ts` gives the id, from
  2^52 up to 2^53, and a drawing that has ids has a `$HANDSEED` of 2^53. Every other object
  is counted up from 1. Another drawing that dimensions the entity through an xref holds that
  handle, so never change what `idHandle` returns for an id, nor `idKey`, which it hashes:
  every such dimension would come loose, and AutoCAD would report nothing.
- The range from 2^52 to 2^53 is for every handle that comes from a name, not only an
  entity's id. Another kind of object, such as a block, hashes its key with a prefix that no
  id can contain, such as `block:NAME`, since an id cannot hold `:` or `/`. It hashes into
  the same range, and two keys that give one handle are refused as two ids are. A key that can
  hold characters outside ASCII, as a block's name can, is hashed as its UTF-8 bytes. A
  counted handle cannot reach 2^52, because a drawing cannot hold that many objects. Nothing
  uses the handles from 2^32 up to 2^52. Keep them for a later scheme.
- `src/blocks.ts` holds the keys of the handles blocks need: a block's record and the two
  objects of its definition from its name, an attribute definition from its block and tag, and
  the attributes of an insert that has an id from the id and each tag. Never change a key, or
  `keyHandle`, which hashes it. A key holds a name with A to Z in lower case and a tag as
  written. Neither `layerKey` nor any table that can grow may be part of a key, because a
  change to the table would move every handle it touches. An insert without an id and its
  attributes are counted.
- AutoCAD takes two block names for one wherever its `AUDIT` would call two layer names
  duplicates, and merges the two blocks without a word. So a second block is refused by
  `layerAuditKey`, and an insert finds its block by `layerKey`.
- An entity on layer `0` of a block draws as its insert's layer does. `eachDrawn` in
  `src/blocks.ts` walks what an insert draws, with the layer and the matrix of each entity,
  for `toSVG` and the extents. An insert's attributes are written as texts in the insert's
  own coordinates, which `placeAttribute` works out from the numbers as they are written. An
  attribute is stored on its definition's layer, and one on layer `0` draws as its insert's
  layer does. An insert on a frozen layer, or in a plot on a layer that does not plot, draws
  nothing of its block.
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
- The published library must run on Node 22. The command needs 22.18, checks it at start and
  says so. Only development tooling may need
  Node 24; on Node 22, development needs 22.18 or later for type stripping.
- `src/` is the library and must run in a browser: no `node:` import, no package, and nothing
  from `cli/`. `cli/` is the `tsdraft` command, with notes of its own in `cli/AGENTS.md`. The
  package smoke test runs `scripts/library-alone.ts`, which fails on any of the three, on any
  dynamic import, and on the words `process`, `require` and `Buffer` anywhere in a built file.
  A change to what `toSVG` writes or to a diagnostic can break the command, and `pnpm test`
  runs its tests too.
- The one dependency is `@resvg/resvg-js`, the command's PNG renderer, and it is optional. The
  command must keep working without it. Add no other dependency.
- Changes reach this repo only through export pull requests, as
  `CONTRIBUTING.md` says. Release by bumping `version` and the CHANGELOG,
  merging the export pull request that carries them, then publishing a GitHub
  release tagged `v<version>` on the commit that merge made. The Release
  workflow publishes to npm through trusted publishing. Never publish from a
  laptop with a token.
