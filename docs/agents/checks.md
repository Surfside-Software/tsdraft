# `inspectText` and `checkIntent`

Rules for agents who change the text warnings or the checks of intent. [AGENTS.md](../../AGENTS.md)
has the rules that hold for every change.

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
