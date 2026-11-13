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
- An xref is a block record with a path: `Drawing.xrefs` holds a name and a path, and an
  insert places one by its name. It shares the blocks' names and the keys of their handles,
  `block:KEY` and the two beside it, and is written as an overlay, which cannot make a cycle
  AutoCAD has to break. AutoCAD reads the path of a BLOCK once, so the DXF writes it with
  `dxfOnce`. `eachDrawn` walks the drawing a caller gives for an xref as it walks a block,
  with each layer as a `LayerRef` that says which drawing's layer it is. `src/` opens no
  file: `toSVG` draws only the drawings it is given.
- A layout is a sheet: `Drawing.layouts` holds each with its paper, its viewports and the
  entities drawn on it in paper units. `src/papers.ts` is the one list of papers and of plot
  style tables, with the name AutoCAD stores for each paper. Add a paper only when
  `DWG To PDF.pc3` has it, and with the name the plotter gives it. `src/layouts.ts` holds the
  keys of a layout's handles, `layout:KEY` and the four beside it, from its name with A to Z
  in lower case: never change one. AutoCAD compares layout names by a table of its own,
  `layoutNameKey` in `src/layers.ts`, which is not `layerKey`. The DXF holds the first layout
  in `*Paper_Space`, with its entities among model space's and marked with group 67, and
  every other in a block `*Paper_Space0` and on. A viewport holds the height of its view and
  no scale: `validViewportView` works it out from the numbers as they are written.
- A dimension holds its two points, its style and its text, and both writers add the block of
  its picture, `*D` and a number, which AutoCAD shows and which an xref or an insert of the
  file needs: AutoCAD draws nothing for a dimension inside another drawing's block.
  `src/dimensions.ts` is the one place that says what AutoCAD draws, `dimensionPicture`, and
  what string it writes, `measurementText`: the writers, `toSVG`, the extents and the command
  all read it, from the numbers as they are written. What a dimension reads, group 42, and the
  direction of its text are written with 15 significant digits: near enough to AutoCAD's own,
  and few enough that the double AutoCAD reads from them can be worked out exactly. Every number of a picture must stay under 1e100,
  which `dimensionDrawnProblem` checks for the builder and `lint` alike. A style's sizes are paper
  sizes and its `scale` is AutoCAD's overall scale. The text is always above the line and
  between the extension lines, so the one case that depends on a font's widths, closed
  filled arrowheads that may not fit, is refused by `arrowRoom`. The keys of the handles are
  `dimension-style:NAME`, with A to Z in lower case, `arrowhead:NAME` for the stroke in an
  arrowhead's block, whose own handles are the block's, and `dimension-picture:WHO/PART` for
  the block of a picture and what it holds, where WHO is the dimension's id with A to Z in
  lower case, or `@LAYOUT/INDEX` for one without an id: never change one. A dimension is
  refused inside a block, where AutoCAD draws nothing for it.
- `examples/site-plan.ts` is the sheet an agent copies, so it must read as a model: the site
  in model space at its true size, with the annotation that is read in the plan sized by the
  view it names, and everything that belongs to the paper inside `d.layout`, in paper units.
  Its layout is on its standard's sheet format and laid out by its zones, and its border and
  title block are the standard's, placed by `sheet.titleBlock()`. Never draw a sheet in model
  space there.
- A view is drawn only where it can be seen. The clip of a view, the hidden rectangle and
  the cull all use one rectangle: the viewport, cut to the paper, cut to the picture `toSVG`
  is drawing (its `viewBox`), with every number as it will be written. If that rectangle has
  no width or no height as written, the view is the empty group with no clip. `toSVG` also
  takes it to have none when its two sides are one number in single precision, which is how
  a renderer may read them.
- The first element of every clipped group is that rectangle, hidden. Never write a clipped
  group without it. resvg, the command's PNG renderer, takes the box of a clipped group's
  elements before it clips them, and stops the whole process when that box lies wholly more
  than two widths of the picture left or right of it, or two heights above or below. The
  hidden rectangle is in the picture and counts in that box, so the box always meets the
  picture, whatever else the group holds. A viewport `lint` refuses is drawn as its border
  alone.
- Leaving out of a view what cannot show in it must never leave out what shows. The cull
  keeps an entity whose box, from `boxer` in `src/extents.ts`, reaches the
  rectangle when the box is made larger by the widest lineweight and, for a text or an
  insert, by the larger side of the box, since a letter may reach past the box of its text.
  A `view` of model space is culled the same way, but its pens are as wide in pixels at any
  size, so a pen is taken to reach the picture's larger side, times `strokeWidth` above 1.
  The box holds the lean of a text whose style has an oblique angle: AutoCAD slants a
  text after it widens it, so the lean is the height times the tangent of the angle and the
  width factor has no part in it. `toSVG` writes `skewX` before `scale` for that reason.
  Build `boxer` once for a drawing: it reads every block and text style when it is made.
- `measureText` in `src/measure.ts` is the one measure of a text: its length from the widths
  in `src/font-metrics.ts`, where its justification puts it, and the one rule for its
  baseline. The extents, `toSVG` and `inspectText` all take a text's box from it, so a
  warning's box is the box the picture draws. Never work a text's length or place out
  anywhere else. `src/font-metrics.ts` holds, for each font of `FONTS` and each character
  from U+0020 to U+007E and U+00A0 to U+00FF, the numbers of a text of height 1. It is data:
  never edit a number by hand, and keep its header to what the numbers are.
- `toSVG` draws a text from where `measureText` starts it, with no `text-anchor`, and holds
  it to its length with `textLength` and `lengthAdjust="spacingAndGlyphs"`, so every renderer
  draws it as long as it plots in whatever typeface it has. `xml:space="preserve"` keeps its
  spaces. `data-height` follows `font-family` directly, and `font-size` comes before both:
  the command finds the three together to size a text for the typeface it draws.
- `inspectText` in `src/inspect.ts` warns about text as it plots. It is not `lint`: its rules
  and its type are its own, `LintRule` stays closed, and `toDXF` never asks it. It shares
  `visibility` in `src/svg.ts` with `toSVG`, so the two leave out the same layers, and walks
  inserts with `eachDrawn`. It must stay bounded: boxes are worked out once and found through
  a grid, and every box the grid looks at and every point a check reads count against one
  limit, which ends the checks with `text-check-capped` when it is reached.
- `checkIntent` in `src/intent.ts` checks a drawing against the intent given beside it: so
  far, setbacks. It is not `lint` either, and its rules and type are its own. It finds
  entities of model space by id, with `idKey`, and reads no layer's state. It takes any value
  as the intent and never throws: a field it does not know, an id that names nothing or a
  count that does not match is an `intent-unchecked` warning, never a pass with nothing said.
  Unlike `lint`, it measures the points as the drawing holds them, not as written: rounding
  the points and then the distance makes a footprint on its setback line warn, and hides a
  real shortfall. It measures from the property line's first corner, and compares with one
  tolerance, `toleranceOf`, for the arithmetic alone, never wider than the writers' rounding
  moves a coordinate. A test of two outlines must hold when no side meets another exactly,
  as on a turned lot: `contained` cuts a footprint's side at every corner of the lot within
  the tolerance of it, and a corner of the lot inside the footprint puts it off the lot. It
  takes only simple outlines, judged with `turn`, which is exact for the doubles held, and
  refuses one that crosses or touches itself, such as a lot
  with a hole. Each outline is read once and paid for before it is read, the search for its
  sides that meet uses `grid` from `src/inspect.ts`, every point looked at counts against one
  limit, what goes past it is one warning for each setback, and the warnings stop at a
  number of their own. A warning names the part of the intent it is about
  by `item`, a path such as `setbacks[0]`, so a later check of intent gets a field of
  `Intent` of its own and adds no field to the warning.
- AutoCAD sizes dashes on the paper in a viewport, so `toSVG` scales a pattern by the
  linetype scale over the viewport's scale there. `toSVG` draws a layout with `elements`, the
  walk it draws model space with, under a `Look` that says how wide and what color a pen is.
- A rule AutoCAD enforces lives in `src/rules.ts` twice: as a type, so a wrong
  literal is a compile error, and as a runtime check with the same message. The
  builder calls the runtime check, and `lint()` in `src/lint.ts` repeats it for
  drawings built another way. `toDXF` refuses to write a drawing with lint
  errors. Test a new rule with `@ts-expect-error` inside `assert.throws`, as
  `test/rules.test.ts` does, so both halves are proven.
- `src/standard/` is a firm's standard. `shape.ts` is the one table of a document's fields: each
  field's type, the rule of its value, its default and whether the hash reads it.
  `scripts/standard-files.ts` writes `standard.schema.json` from it, `standard.json` from the
  built-in standard and `src/version.ts` from `package.json`, and `test/standard.test.ts` fails
  until `pnpm standard:files` has run after a change to any of them. A rule of a document's
  literal is a type in `src/standard/literal.ts` with the runtime check's message, as a rule of a
  drawing is in `src/rules.ts`. A default, once released, never changes: a change of behavior
  comes as a new field or value. The library makes `BUILT_IN_STANDARD` as it loads without the
  checks, with `BUILT_IN_HASH` in `src/standard/define.ts`, and a test resolves its document with
  them. A change to what it states raises its version, which the CHANGELOG gives, and sets that
  hash.
- A rule of a drawing drawn to a standard, which the builder refuses, is a type in
  `src/standard/drawn.ts` with the runtime check's message, and its message names the standard
  by the id and version its type carries. The builder finds an entry of the standard in any case,
  as AutoCAD does, and the type compares the exact spelling. `drawing.ts` reads a standard
  through `src/standard/made.ts` and never imports `define.ts`, which draws the plain title
  block with the builder as it loads. A drawing without a standard is built as it was before
  standards.
- Under a standard, a top-level conditional on the standard's type parameter `Z` whose branches
  mention `Z`, such as `Z extends Standard ? A<Z> : B` as a parameter's type, makes
  `DrawingBuilder<…, undefined>` not assignable to `DrawingBuilder<…, Standard | undefined>`,
  which a helper typed with `ReturnType<typeof createDrawing>` needs. A conditional inside a
  field's type, a conditional whose branches do not mention `Z`, and a conditional that is one
  member of a union are fine. In a rest tuple, an element whose type is that conditional alone
  makes `DrawingBuilder<…, S>` for a standard `S` not assignable to `DrawingBuilder<…, Standard>`,
  and so do overloads; `layout()` keeps it one member of a union with `| undefined`.
- Under a standard, a title block's block, the blocks it inserts and their text styles enter the
  drawing under their own names when `sheet.titleBlock()` first places it, and one the drawing
  has with another definition is refused: never rename one, since its handles come from its
  name. The builder fills a title block's scale when the layout's `draw` returns.
- Under a standard, a role's text style and a dimension style of the standard enter the drawing
  on first use, under `capitals` of the id, and in model space with the view's scale id after a
  dimension style's: `DIMS-1in-10ft`. A view's id is taken when `view()` declares it, and the
  one viewport that shows the view takes that id and no other.
- `lint(drawing, { standard })` runs the rules of a standard in `src/standard/lint.ts` after the
  others, and without `standard` runs none of them. It takes the standard through `adopted` in
  `src/standard/made.ts`, as the builder does, and reads only what `TYPED` in `src/shape.ts` finds
  sound. A rule the builder refuses under a standard has the builder's rule name in `lint`, and
  its message from `src/standard/drawn.ts` where that fits a `Drawing`. It must stay bounded by
  construction: it reads a list up to its first empty slot, reads each item of the drawing once,
  and pays for anything it does again, in proportion to its size, before it does it. The walk of
  an insert reads blocks made once a drawing, with only what can draw a text and a short token for
  each name, and pays for each block it enters. A title block's definition is compared as JSON
  cut short at the length of the standard's. `test/standard-lint.test.ts` fuzzes it from a seed.
- `lint` takes any plain data and never throws, since a `Drawing` can be written by hand.
  `src/shape.ts` holds the fields of each object and their types, once, for `fromJSON` and for
  `lint`. `lint` checks an object's shape there before a rule reads it, and skips the rules for
  an object that fails, but still records its name, so that nothing that names it gets a
  second error. A field under `ruled` is left to the rule that reports its type with a message
  of its own. A message shows a value from the drawing only through `shown` in `src/rules.ts`,
  and a diagnostic's field holds a name only when it is a string. An error about a value of
  the wrong type carries `item`, the path of what a reader has to leave out.
  `test/shape.test.ts` replaces every field of a full drawing with values of other types, and
  its drawing is typed so that a new field or entity kind is a compile error there.
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
  `lint`, both writers and `toSVG` read the list. A TrueType font also has its `capHeight`,
  which `toSVG` and the command read: the top of the font's capital `A` over its units per em, since
  AutoCAD makes that `A` as tall as the text's height. It is not the cap height the font
  states. Add a font only when AutoCAD 2025
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
