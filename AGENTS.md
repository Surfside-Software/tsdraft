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
- AC1032 needs every handle unique, every owner (330) and pointer (340, 350, 390) to resolve, and
  `$HANDSEED` above the highest handle. The leading CAD app also discards the whole file if a LAYER
  has no 390 plot style pointer. The tests check all of this.
- An entity with an id takes the handle `idHandle` in `src/handles.ts` gives the id, from
  2^52 up to 2^53, and a drawing that has ids has a `$HANDSEED` of 2^53. Every other object
  is counted up from 1. Another drawing that dimensions the entity through an xref holds that
  handle, so never change what `idHandle` returns for an id, nor `idKey`, which it hashes:
  every such dimension would come loose, and the leading CAD app would report nothing.
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
- The leading CAD app takes two block names for one wherever its `AUDIT` would call two layer names
  duplicates, and merges the two blocks without a word. So a second block is refused by
  `layerAuditKey`, and an insert finds its block by `layerKey`.
- An entity on layer `0` of a block draws as its insert's layer does. `eachDrawn` in
  `src/blocks.ts` walks what an insert draws, with the layer and the matrix of each entity,
  for `toSVG` and `inspectText`. It keeps its own stack, so a chain of any depth is walked,
  does not enter an insert on a frozen layer, reads each list up to its first empty slot, and
  asks `spend` before each block it enters and each item it reads. The extents never walk an
  entity of a block: `boxer` in `src/extents.ts` keeps the box of each block's own entities, in
  the block's coordinates, worked out once for each drawing it is in and whether its layer `0`
  is hidden. A placement walks the blocks it inserts, with their matrices composed as
  `eachDrawn` composes them, and maps the corners of each block's own box: each side takes the
  corner that rounds no nearer than any point inside, so the box holds the walk's to the last
  bit, is the walk's where no insert is turned, and for a turned insert may be larger. Each walk
  enters its first 64 blocks free and all walks the boxer's `walking` more, which `lint` gives
  the writer's whole limit, so the two take one path, and `lint` boxes model space when it holds
  anything whose box can cost: an insert, a dimension, a leader or a text past `KEYED`. Past that, a placement
  maps the corners of the box of all its block draws, widened by what rounding can move a number
  on the way, so the extents never come out smaller than a walk's. Where a number on the way
  overflowed or a product underflowed, which the slack cannot cover, it walks the blocks within
  the walks left, and past them the boxer stops. A box that
  depends on a block of a cycle being open is not kept for another way in. What many places share is read once a boxer: the box of a list of entities,
  of a long list of points and of a leader, a long value's measure, and the inserts of a list.
  An insert's attributes are written as texts in the insert's
  own coordinates, which `placeAttribute` works out from the numbers as they are written. An
  attribute is stored on its definition's layer, and one on layer `0` draws as its insert's
  layer does. An insert on a frozen layer, or in a plot on a layer that does not plot, draws
  nothing of its block.
- An xref is a block record with a path: `Drawing.xrefs` holds a name and a path, and an
  insert places one by its name. It shares the blocks' names and the keys of their handles,
  `block:KEY` and the two beside it, and is written as an overlay, unless `attach` is true. That
  app reads the path of a BLOCK once, so the DXF writes it with `dxfOnce`. `eachDrawn` walks the
  drawing a caller gives for an xref as it walks a block, with each layer as a `LayerRef` that
  says which drawing's layer it is. `src/` opens no file: `toSVG` draws only the drawings it is
  given. `referencedTree` in `src/blocks.ts` is the one reading of what is given in `xrefs`: a
  tree of `Referenced`, one for each place, each with the drawings of its own attachments,
  never of an overlay, cut where a drawing on the chain above comes again and past `XREF_DEPTH`
  drawings down, with why in its problems, which `lint` reports with `xrefs`. Past `XREF_LOOKS`
  names looked for inside referenced drawings it follows none, so the same given with drawings
  left out cuts nothing the whole did not, which the command relies on; `drawnXrefs` gives the
  tree in the form given. `eachDrawn` and the boxer read that tree, the boxer keeping a block's
  box for each drawing and the drawings given for its attachments. `inspectText` reads the
  drawings given for the drawing's own xrefs alone, once each, and checks no text of their
  attachments: a cut for each place cost work outside its limit.
- A layout is a sheet: `Drawing.layouts` holds each with its paper, its viewports and the
  entities drawn on it in paper units. `src/papers.ts` is the one list of papers and of plot
  style tables, with the name the leading CAD app stores for each paper. Add a paper only when
  `DWG To PDF.pc3` has it, and with the name the plotter gives it. `src/layouts.ts` holds the
  keys of a layout's handles, `layout:KEY` and the four beside it, from its name with A to Z
  in lower case: never change one. That app compares layout names by a table of its own,
  `layoutNameKey` in `src/layers.ts`, which is not `layerKey`. The DXF holds the first layout
  in `*Paper_Space`, with its entities among model space's and marked with group 67, and
  every other in a block `*Paper_Space0` and on. A viewport holds the height of its view and
  no scale: `validViewportView` works it out from the numbers as they are written.
- A dimension holds its two points, its style and its text, and both writers add the block of
  its picture, `*D` and a number, which the leading CAD app shows and which an xref or an insert of
  the file needs: that app draws nothing for a dimension inside another drawing's block.
  `src/dimensions.ts` is the one place that says what that app draws, `dimensionPicture`, and
  what string it writes, `measurementText`: the writers, `toSVG`, the extents and the command
  all read it, from the numbers as they are written. What a dimension reads, group 42, and the
  direction of its text are written with 15 significant digits: near enough to the leading CAD app's
  own, and few enough that the double that app reads from them can be worked out exactly. Every
  number of a picture must stay under 1e100, which `dimensionDrawnProblem` checks for the builder
  and `lint` alike. A style's sizes are paper sizes and its `scale` is that app's overall scale. The
  text is always above the line and between the extension lines, so the one case that depends on a
  font's widths, closed filled arrowheads that may not fit, is refused by `arrowRoom`. The keys of
  the handles are `dimension-style:NAME`, with A to Z in lower case, `arrowhead:NAME` for the stroke
  in an arrowhead's block, whose own handles are the block's, and `dimension-picture:WHO/PART` for
  the block of a picture and what it holds, where WHO is the dimension's id with A to Z in
  lower case, or `@LAYOUT/INDEX` for one without an id: never change one. A dimension is
  refused inside a block, where that app draws nothing for it.
- A leader holds its note, its point, its shafts and its own sizes, and the R2018 writer writes it
  as a multileader with no picture. `src/leaders.ts` is the one place that says what the leading CAD
  app draws, `leaderPicture`, which the writers, `toSVG`, the extents and `inspectText` all read.
  Its note is a `Paragraph`, laid out by `layoutParagraph` and held where the multileader holds it,
  so the note's lines follow every rule of a paragraph's. A mask is drawn first in the leader's
  group, so it hides what is drawn before the leader and none of the leader. A block in place of
  the note is placed from its own outline, read once for each list of a block's entities and cut
  at `OUTLINE_ITEMS`; `toSVG` draws it as an insert after the leader, so the insert walk draws it
  and its attributes. A curved shaft is solved as three diagonals, in time in proportion to its
  points. A style's
  sizes are paper sizes times its `scale`, and the file holds them multiplied out with a scale of 1.
  The writers add that app's own `Standard` and the dictionary `ACAD_MLEADERSTYLE` with the first
  style. The keys of the handles are `leader-style:NAME`, with A to Z in lower case,
  `dictionary:acad_mleaderstyle`, and `arrowhead:NAME` and `arrowhead:NAME/N` for the strokes of
  the blocks `_Open`, `_Dot` and `_None`: never change one. A leader is refused inside a block.
- A style in architectural units, `DIMLUNIT` 4, writes feet and inches with the fraction on the
  line, `DIMFRAC` 2, and `feetInchZeros` is `DIMZIN` 0 to 3. `feetAndInches` in
  `src/dimensions.ts` is the string, and the dimension holds no text of its own, so the leading CAD
  app measures it again when its points move. A standard's style is named in that app by
  `styleNameAt` in `src/standard/rules.ts`, which the builder, `lint` and `defineStandard` share:
  a `layoutName` or a name in `scaleNames` where the standard gives one, and the id's name
  otherwise.
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
  The box holds the lean of a text whose style has an oblique angle: the leading CAD app slants a
  text after it widens it, so the lean is the height times the tangent of the angle and the
  width factor has no part in it. `toSVG` writes `skewX` before `scale` for that reason.
  Build `boxer` once for a drawing: it reads every block and text style when it is made, and
  keeps each block's box. `toSVG` and the DXF writer each build one for a call.
- `measureText` in `src/measure.ts` is the one measure of a text: its length from the widths
  in `src/font-metrics.ts`, where its justification puts it, and the one rule for its
  baseline. The extents, `toSVG` and `inspectText` all take a text's box from it, so a
  warning's box is the box the picture draws. Never work a text's length or place out
  anywhere else. `src/font-metrics.ts` holds, for each font of `FONTS` and each character
  from U+0020 to U+007E and U+00A0 to U+00FF, the numbers of a text of height 1. It is data:
  never edit a number by hand, and keep its header to what the numbers are.
- `src/paragraphs.ts` is the one layout of a paragraph, `layoutParagraph` and `measureParagraph`:
  where each line and each run sits, its strokes and its box, from the font tables' advances and
  their paragraph columns, each letter's ink and each bold face.
  The extents, `toSVG`, `inspectText`, the writers' boxes and `src/read/mtext.ts` all take a
  paragraph from it, and every rule of where a line goes is in the block at its top. Its value is
  read only by `parseParagraph` in `src/paragraph-codes.ts`, in one pass with a stack of its own
  and at most `PARAGRAPH_NESTING` formats, and `ParagraphValue` in `src/rules.ts` is the same
  grammar as a type, which gives up past a fixed number of steps and leaves the rest to the
  runtime check. Two rules only the runtime check holds: `%%c` in the style's font, which the type
  does not know, and a character above U+FFFF, since TypeScript never splits the surrogate pair
  that holds one. A code it does not lay out is refused by `lint`, never drawn as a guess.
- `toSVG` draws a text with no `text-anchor`, and holds it to a length with `textLength` and
  `lengthAdjust="spacingAndGlyphs"`, so every renderer draws it as long in whatever typeface it
  has. A text or a paragraph's run in a TrueType font is drawn from its first point and held to
  its characters' advances, which the leading CAD app's PDF sets at `100 Tz`; one in an SHX
  font, which plots as strokes, from where `measureText` starts it and held to the length it
  plots. `xml:space="preserve"` keeps its
  spaces. `data-height` follows `font-family` directly, and `font-size` comes before both:
  the command finds the three together to size a text for the typeface it draws.
- `inspectText` in `src/inspect.ts` warns about text as it plots. It is not `lint`: its rules
  and its type are its own, `LintRule` stays closed, and `toDXF` never asks it. It shares
  `visibility` in `src/svg.ts` with `toSVG`, so the two leave out the same layers, and walks
  inserts with `eachDrawn`. It must stay bounded: boxes are worked out once and found through
  a grid, and every box the grid looks at, every point a check reads and each step of the walk
  of an insert, a text by its length, and each character a warning quotes, count against one
  limit, which ends the checks with `text-check-capped`, saying where, when it is reached. The walk reads blocks and xrefs cut to
  what the checks keep, `looked` in `src/inspect.ts`, so linework costs it nothing, and its
  steps are free for the first 64 of each insert and for as many more as one walk of every
  block and xref takes.
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
- The leading CAD app sizes dashes on the paper in a viewport, so `toSVG` scales a pattern by the
  linetype scale over the viewport's scale there. It fits a pattern to each line, side of a
  polyline and arc: the stretch holds as many whole patterns as fit, its first and last dash
  are each half of the first dash and of what is left over, and a stretch shorter than its
  pattern is solid. A circle holds the whole number of patterns nearest its length, stretched
  alike to go round it, from a dash at angle 0. `cut` in `dashedPath` is the one place that
  does it. `toSVG` draws a layout with `elements`, the
  walk it draws model space with, under a `Look` that says how wide and what color a pen is.
- A rule the leading CAD app enforces lives in `src/rules.ts` twice: as a type, so a wrong
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
  as the leading CAD app does, and the type compares the exact spelling. `drawing.ts` reads a
  standard through `src/standard/made.ts` and never imports `define.ts`, which draws the plain title
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
- Under a standard, a role's text style and a dimension or leader style of the standard enter
  the drawing on first use, under `capitals` of the id, and in model space with the view's scale
  id after a dimension or leader style's: `DIMS-1in-10ft`. A view's id is taken when `view()` declares it, and the
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
  To time `lint` against a standard given as data, time the standard's own check, `adopted`,
  apart from the index and the rules: it checks the whole document and works out its hash again
  on each call, so it can hide what the rest costs.
- `lint`, `inspectText`, the extents and `toSVG` must stay bounded on any data, by construction:
  each reads a list up to its first empty slot, works out each name's `layerKey` once a call,
  follows blocks with a stack of its own, and pays for what it does again, by its size, before
  it does it. The data is the value as given, and a drawing made in code may share one list,
  object or string among many places, which JSON cannot. So what a walk reads of one of those
  and can keep, it keeps for the call, by the object or, for a value of 256 characters or more,
  by the string: the extents' boxes, a text's measure through `measurer` in `src/measure.ts`,
  `inspectText`'s cut of a list and the outline of a long list of points, and `lint`'s checks of
  a long value and an insert's values. What a walk must read again for each place, `lint` pays
  for by its size each time after the first: a list of entities or of attribute definitions, a
  list of points of 64 or more, an insert's values past the first 64, and a string of 256
  characters or more in a field an entity, a definition or an insert's values has, since a
  message quotes it and `toDXF` writes it again. An object of the wrong shape is reported where
  it is first met, and its messages pay for their length, so a long key or kind that many objects
  share is paid for each time it is quoted. Once `lint` or `inspectText` stops, it reads no entity
  past there. `itemsOf` counts a list once. The boxer pays for a list that
  another drawing holds too, such as one drawing given for many xrefs, and the standard's checks
  pay for a shared list, each error they give from it by its length, and a shared long string. A
  walk skips an attribute definition that is no object, as `isDefinition` in `src/blocks.ts`
  says. Key no `Map` or `Set` of a walk by strings a drawing holds: V8 hashes a string over
  16,383 characters by its length alone, so a table of many such strings of one length compares
  each it looks up with all the others. `Strings` in `src/shape.ts` keys a long one by its length
  and 80 of its characters, keeps one string a key, and says when a string takes another's
  place, which the walk then pays for by its length. So distinct long strings crafted to agree at
  those characters pay as if they were shared. Each insert does its first 64 attributes, and the first 64 steps of its walk, free
  of the limit: that is work in proportion to the drawing. `lint` pays for each attribute an
  insert places and each handle it takes past those, what a dimension reads from its style's
  prefix and suffix, the search for the way back through a cycle, which finds cycles first in
  one pass, and the extents of model space, which the DXF writer works out within the same
  limit; past its limit, 500,000 units and 16 more for each entity and attribute definition the
  drawing holds, it ends with `check-capped`, which `toDXF` refuses. `lint` boxes model space
  and then each layout with one boxer, as the writer does, so the writer stops on nothing `lint`
  passed. What a drawing repeats is paid for and what it holds is not: a value an insert holds
  is free, a definition's value it repeats is paid for by its length. Whatever is read for each
  placement reads only the fields it needs, as `inStyle` and `attributeText` do, never a copy
  of all an object holds, and a measured text takes only its font, width factor and oblique
  angle from its style. `toSVG` writes at most 500 million characters, and walks through
  inserts at most 2,000,000 blocks and entities that draw nothing, and refuses an insert whose
  walk would spend more than is left before it walks it, from the boxer's `walkCost`; what it draws counts against
  the characters, so drawing an entity may cost only in proportion to what it writes: a dashed
  polyline's sides that have a length are found once a picture, for each list of points. Past
  either it throws a `RangeError` that names where it stopped. It joins an insert's elements as
  it makes them, so the memory it holds stays near its characters. Looking a long string up in
  an object can take time in proportion to its length, so a name is looked up in a table of
  tsdraft's, such as `FONTS` or `ARROWHEADS`, only when it is no longer than the table's
  longest, and a walk that looks a definition's tag up among an insert's values pays a unit for
  each 256 characters of it, `lookupCost` in `src/blocks.ts`.
  `test/bounded.test.ts` fuzzes the four from a seed under a vm timeout, with limits given to
  `lintWithin`, `inspectWithin` and `svgWithin`, and with lists and values that many places
  share. Every walk but `lint` may throw a `RangeError` there, and nothing else.
- `lint` takes any plain data and never throws, since a `Drawing` can be written by hand. A
  `Proxy` is code, not data, and `src/`, which imports no `node:` module, has no way to tell one
  from data without calling its traps. So `lint`, like the rest of the library, reads one as the
  data its traps give, calling them in proportion to what it reads, and a trap that throws or
  never returns does so inside the call. `test/bounded.test.ts` holds both: the traps of one that
  returns are called a bounded number of times, and data a proxy makes up as it is read is
  refused where its shape is wrong. The command, which runs a drawing file's code, ends a build
  past its timeout.
  `src/shape.ts` holds the fields of each object and their types, once, for `fromJSON` and for
  `lint`. `lint` checks an object's shape there before a rule reads it, and skips the rules for
  an object that fails, but still records its name, so that nothing that names it gets a
  second error. A field under `ruled` is left to the rule that reports its type with a message
  of its own. A message shows a value from the drawing only through `shown` in `src/rules.ts`,
  and a diagnostic's field holds a name only when it is a string. An error about a value of
  the wrong type carries `item`, the path of what a reader has to leave out.
  `test/shape.test.ts` replaces every field of a full drawing with values of other types, and
  its drawing is typed so that a new field or entity kind is a compile error there.
- `src/read/` reads a file into a `DrawingRead`, the read model, which is not a `Drawing` and is
  never written back. `readDXF` reads as the bytes arrive and must never hold the whole file or
  a list that grows with entities past its limits, `CENSUS_LIMIT`, `BLOCK_ITEMS` and
  `GEOMETRY_ITEMS`; a record's binary groups are dropped as they arrive. Without `geometry` it
  keeps no text of model space or a layout and no attribute value. It throws only a
  `ReadError`, for a file it cannot read at all, and counts the rest it does not understand under
  `unread`. A group's default, such as the text style `Standard`, is filled in, since the leading
  CAD app leaves a default out. `src/read/entities.ts` reads each kind of `ReadEntity`, for blocks
  and spaces alike, and `costOf` there is what each costs against a budget. A string holds what
  that app holds after reading the file, by the passes `src/read/groups.ts` makes, and a justified
  text whose file stores its alignment point as its start is placed from `layoutText` only where
  the layout is exact. No map of a read is keyed by a name longer than a DXF value holds, since
  V8 hashes a long string by its length alone. `src/read/document.ts` is the document of a DXF:
  where each record is in bytes, so the records copied in order give the file back. It is
  internal. `checkDrawingRead` holds a reader's answer to the model's fields: change both
  together, and the reading page, `docs/reading.md`. `test/read-fuzz.ts` fuzzes the reader from
  a seed, and `test/read-agreement.ts` holds a read with geometry to the `Drawing` it came from.
- `src/images.ts` is the one place of where an image's pixels go, its clip as the file holds it
  and its frame: the writers, the plots, the extents and the readers all take an image from it.
  A file is keyed by its path with `exactKey`, never `Strings`, since a lost key writes a file
  twice. A file's bytes are untrusted input: `src/raster.ts` reads them as `src/truetype.ts` reads
  a font, and decodes a PNG only up to `RASTER_PIXELS`. A browser drops the colors of a pixel of
  no alpha, which the leading CAD app plots for an image not marked transparent, so `toSVG` holds
  such a PNG again without its transparency, up to `OPAQUE_PIXELS`; past them it holds the file
  as it is and marks the `<use>` `data-opaque`, which `toPDF` reads. That is the one place the
  preview and the plot part. A PNG the plot must decode and cannot is drawn by neither, as a file
  not given.
- `src/fills.ts` is the one place of what a hatch, a wipeout and a text's mask draw: a hatch's loops
  and their sides, filled by parity, which the writers make the leading CAD app's rule too by island
  style normal and polyline loops; a wipeout's square picture of one pixel and its clip; a mask's box
  and factor, a paragraph's and a dimension style's. The writers, `toSVG`, the extents, `lint` and
  the readers take them from it. The wipeout frame is the dictionary variable `WIPEOUTFRAME`, which is
  what that app reads, beside `WIPEOUTVARIABLES`, which it does not. A hatch is drawn as one path
  with `fill-rule="evenodd"`, which `toPDF` writes as `f*`. tsdraft ships no hatch pattern: a
  firm's pattern file gives them. A hatch finds its pattern by `layerKey` of its name, the first of
  a name, and `patternDrawnProblem` is the one check of what its lines draw, which `lint`, the
  builder and `toSVG` share: a pattern that would draw more than `HATCH_LINES` lines across the
  box of its loops, or place a number of 1e100 or more, is refused, and `toSVG` draws none of its
  lines.
- `src/pdf.ts` plots layouts to PDF from the pictures `toSVG` draws of them, and decides
  nothing about a drawing: every rule of what a sheet plots stays in `toSVG`, so the preview
  and the plot cannot part. It reads the closed set of elements and attributes `toSVG` writes
  for a layout, and refuses any other with a `RangeError` that names it, so a new element in
  `toSVG` is drawn in the PDF in the same pull request or fails `test/pdf.test.ts`. It reads
  each picture once, with a sticky pattern that refuses what it cannot read, and writes in
  proportion to it. Each point is mapped to the page and written in points with three
  decimals, never with an exponent. A text in a TrueType font whose file the caller passes in
  `fonts` is set in that file, embedded as a subset; any other in Helvetica, Times or Courier
  with widths from `src/font-metrics.ts`. Either way it is stretched with `Tz` to the length
  `toSVG` holds it to. The library has no zlib, so a caller passes `deflate`. The same pictures give the same bytes. A picture of
  a layout says its format in `data-picture`, `SHEET_PICTURE` in `src/svg.ts`, and `svgToPDF`
  reads no other: raise it in the pull request that changes what an element or an attribute of
  such a picture means, since the closed list catches a new one and not a changed one.
- `src/truetype.ts` reads a TrueType file for `toPDF` and cuts it to a subset. A font file is
  untrusted input: every offset and count is held to the bytes before it is read, each glyph is
  read once when the file is, and a file it does not take is refused with the reason as a
  string, never a throw. A composite glyph built of itself, or nested deeper than 16, is refused,
  so cutting a font it took always ends. `test/truetype.test.ts` mutates the shipped font from a
  seed.
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
- The leading CAD app holds linetype names to the layer-name rules and compares them the
  same way, so linetypes use `layerKey`, `layerAuditKey` and the name checks of
  layers.
- `src/fonts.ts` is the one list of fonts a text style may have, with the file
  the leading CAD app stores for each and, for a TrueType font, its pitch and family.
  `lint`, both writers and `toSVG` read the list. A TrueType font also has its `capHeight`,
  which `toSVG` and the command read: the top of the font's capital `A` over its units per em, since
  that app makes that `A` as tall as the text's height. It is not the cap height the font
  states. Add a font only when the 2025 release of that app
  or Windows installs it.
- Text style names use `layerKey`, `layerAuditKey` and the name checks of
  layers, as linetype names do. A text holds its own width factor and oblique
  angle in the file, so the writers copy them from its style.
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
  `CONTRIBUTING.md` says. Release by bumping `version` and the CHANGELOG,
  merging the export pull request that carries them, then publishing a GitHub
  release tagged `v<version>` on the commit that merge made. The Release
  workflow publishes to npm through trusted publishing. Never publish from a
  laptop with a token.
