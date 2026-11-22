# The standard

Rules for agents who change anything under `src/standard/`, or what the builder and `lint` do under
a standard. [AGENTS.md](../../AGENTS.md) has the rules that hold for every change.

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
