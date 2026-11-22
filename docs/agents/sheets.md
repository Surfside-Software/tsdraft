# Layouts, dimensions and leaders

Rules for agents who change layouts, viewports, papers, dimensions or leaders.
[AGENTS.md](../../AGENTS.md) has the rules that hold for every change.

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
