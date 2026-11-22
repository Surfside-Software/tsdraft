# Agent notes

These rules hold for every change. The rules of one part of the library are in a page of its
own, and each is as binding as these: before you change a part, read its page. A change to
`lint`, to `toSVG` or to a writer often touches several.

| Part                                                                                                           | Its files, among them                                                                                                      | Page                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Handles from ids and names, blocks, inserts, attributes and xrefs                                              | `src/handles.ts`, `src/blocks.ts`                                                                                          | [handles.md](docs/agents/handles.md)                                                                                                                               |
| The DXF writers: what each kind of thing writes, and which handles must never change                           | `src/dxf.ts`, `src/dxf-r2018.ts`, `src/dxf-r12.ts`                                                                         | [handles.md](docs/agents/handles.md), then the page of each kind written                                                                                           |
| Layouts, viewports, papers, dimensions, leaders and arrowheads                                                 | `src/layouts.ts`, `src/papers.ts`, `src/dimensions.ts`, `src/leaders.ts`, `src/arrowheads.ts`                              | [sheets.md](docs/agents/sheets.md)                                                                                                                                 |
| What `toSVG` draws: a view's clip and cull, the measure of a text, paragraphs, fonts, dashes, marks and shapes | `src/svg.ts`, `src/extents.ts`, `src/measure.ts`, `src/paragraphs.ts`, `src/fonts.ts`, `src/linetypes.ts`, `src/shapes.ts` | [pictures.md](docs/agents/pictures.md); for a sheet's picture also [pdf.md](docs/agents/pdf.md)                                                                    |
| The text warnings and the checks of intent                                                                     | `src/inspect.ts`, `src/intent.ts`                                                                                          | [checks.md](docs/agents/checks.md)                                                                                                                                 |
| A standard, and what the builder and `lint` do under one                                                       | `src/standard/`                                                                                                            | [standard.md](docs/agents/standard.md); for `styleNameAt` also [sheets.md](docs/agents/sheets.md)                                                                  |
| Any walk of a drawing, which must stay bounded, and data of the wrong shape                                    | `src/lint.ts`, `src/shape.ts`, `src/inspect.ts`, `src/extents.ts`, `src/svg.ts`                                            | [bounded.md](docs/agents/bounded.md)                                                                                                                               |
| The readers                                                                                                    | `src/read/`                                                                                                                | [reading.md](docs/agents/reading.md); images and fills also [images-fills.md](docs/agents/images-fills.md), paragraphs also [pictures.md](docs/agents/pictures.md) |
| Images, PDF underlays, hatches, gradients, wipeouts and masks                                                  | `src/images.ts`, `src/raster.ts`, `src/underlays.ts`, `src/fills.ts`                                                       | [images-fills.md](docs/agents/images-fills.md)                                                                                                                     |
| The plot to PDF and the TrueType reader                                                                        | `src/pdf.ts`, `src/truetype.ts`                                                                                            | [pdf.md](docs/agents/pdf.md); fills and masks in a plot also [images-fills.md](docs/agents/images-fills.md)                                                        |

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
- AC1032 needs every handle unique, every owner (330) and pointer (340, 350, 390) to resolve, and
  `$HANDSEED` above the highest handle. The leading CAD app also discards the whole file if a LAYER
  has no 390 plot style pointer. The tests check all of this.
- `examples/site-plan.ts` is the sheet an agent copies, so it must read as a model: the site
  in model space at its true size, with the annotation that is read in the plan sized by the
  view it names, and everything that belongs to the paper inside `d.layout`, in paper units.
  Its layout is on its standard's sheet format and laid out by its zones, and its border and
  title block are the standard's, placed by `sheet.titleBlock()`. Never draw a sheet in model
  space there.
- A rule the leading CAD app enforces lives in `src/rules.ts` twice: as a type, so a wrong
  literal is a compile error, and as a runtime check with the same message. The
  builder calls the runtime check, and `lint()` in `src/lint.ts` repeats it for
  drawings built another way. `toDXF` refuses to write a drawing with lint
  errors. Test a new rule with `@ts-expect-error` inside `assert.throws`, as
  `test/rules.test.ts` does, so both halves are proven.
- The writers print numbers with 6 decimals. `written` in `src/format.ts` is that
  rounding, and `lint` judges sizes, points and arc angles as written. A new
  check on a number must do the same. One exception: a paragraph's line-spacing factor is judged
  as given, from 0.25 to 4, as its type holds a literal, which cannot round. Both ends have 6
  decimals, so no factor in the range rounds out of it when written, and the type and the runtime
  check agree.
- The leading CAD app reads two exponent digits from DXF, so no number may be written as
  1e100 or more. `lint` refuses those in a drawing. A number a writer works out
  for itself, such as an extent, must go through `readable` in `src/format.ts`.
- `src/layers.ts` holds what the leading CAD app does with layer-name characters: the ones
  it refuses, the capitals it lower-cases to compare names, and the pairs only
  `AUDIT` calls duplicates. Never compare layer names with `toLowerCase()`.
- The leading CAD app holds linetype and text style names to the layer-name rules and compares
  them the same way, so both use `layerKey`, `layerAuditKey` and the name checks of layers. A
  text holds its own width factor and oblique angle in the file, so the writers copy them from
  its style.
- `layerAuditKey` follows only the kinds of pair `docs/layer-names.md` lists,
  and must never call two names duplicates when `AUDIT` does not. Add a kind
  only when `AUDIT` reports every pair of that kind as a duplicate.
- Passing ezdxf or another parser proves little: the leading CAD app discards files they
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
  `CONTRIBUTING.md` says, and [docs/development.md](docs/development.md) says how to
  release. Never publish from a laptop with a token.
