# What `toSVG` draws: views, text and linetypes

Rules for agents who change `toSVG`, a view's clip and cull, the measure of a text, paragraphs,
fonts or dashes. [AGENTS.md](../../AGENTS.md) has the rules that hold for every change.

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
- The leading CAD app sizes dashes on the paper in a viewport, so `toSVG` scales a pattern by the
  linetype scale over the viewport's scale there. It fits a pattern to each line, side of a
  polyline and arc: the stretch holds as many whole patterns as fit, its first and last dash
  are each half of the first dash and of what is left over, and a stretch shorter than its
  pattern is solid. A circle holds the whole number of patterns nearest its length, stretched
  alike to go round it, from a dash at angle 0. `cut` in `dashedPath` is the one place that
  does it. A linetype's `marks` are placed by `markSpots`, with each whole pattern of a fitted
  stretch, and `letterAt` sets each text in the frame of the side it lands on, the line's
  direction in its own coordinates deciding `upright`; on an arc that frame is the straight piece
  the leading CAD app cuts the arc into, `arcFrame`, 1/1200 inch from it on the paper, which
  `Look.chord` holds. `glyphAt` draws a shape the same way, from the outlines `parseShx` reads
  of its file, found by `glyphFinder`, which `lint` shares. A pattern that ends with a dash runs
  it into its first, `Dashes.trail`, and is fitted to its own first dash, `Dashes.lead`. A polyline's `linetypeGeneration` cuts its sides as one course, `courseOf`,
  from its second point when it is closed. `toSVG` draws a layout with `elements`, the
  walk it draws model space with, under a `Look` that says how wide and what color a pen is.
- `src/fonts.ts` is the one list of fonts a text style may have, with the file
  the leading CAD app stores for each and, for a TrueType font, its pitch and family.
  `lint`, both writers and `toSVG` read the list. A TrueType font also has its `capHeight`,
  which `toSVG` and the command read: the top of the font's capital `A` over its units per em, since
  that app makes that `A` as tall as the text's height. It is not the cap height the font
  states. Add a font only when the 2025 release of that app
  or Windows installs it.
- A read file's picture is `src/read/picture.ts`: `pictureDrawing` turns a `DrawingRead` into the
  `Drawing` `toSVG` draws, and what a `Drawing` cannot hold, a paper tsdraft does not list, an
  entity's own linetype scale and a layer's true color, rides on the symbols of
  `src/picture-marks.ts`, which only `toSVG` reads. Draw a new kind of `ReadEntity` there, from the
  kinds a `Drawing` has, never with code of its own in `src/svg.ts`. With `READ_SOURCES` given,
  `svgWithin` groups the elements of each top-level read entity into one fragment, starts each id
  it makes from the fragment's viewport and handle, and names an image's picture by its file, so
  a fragment kept from one picture joins with another's. Without it, the picture of a `Drawing` is
  byte for byte what it was: change the pieces in `finish` so that `joinPicture` gives the same
  text either way.
