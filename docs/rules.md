# Rules

tsdraft checks these rules. The [README](../README.md#checks) explains the three
places checks run.

## Numbers

Numbers are written with 6 decimals, in DXF and in SVG. The checks below judge
a drawing as it will be written, so a size too small to survive the rounding is
an error and a line that rounds down to a point is a warning. Every number must
also be under 1e100 in size. The leading CAD app reads only two exponent digits from DXF, so
it would take `1e+100` for `1e+10` and report nothing.

## Errors

- Layer names cannot be empty, start or end with a space, or contain a line
  break or any of ``< > / \ " : ; ? * | = ` ^ ,``. R12 names have the tighter
  limits in the [DXF versions](../README.md#dxf-versions) table.
- Layer names cannot contain the other characters the leading CAD app refuses in a name. It
  discards the drawing over any of them, and they are listed under
  [Layer name characters](layer-names.md#layer-name-characters).
- `wall` and `WALL` are the same layer, as in CAD. The first spelling is kept.
  tsdraft compares names the way the leading CAD app does, which is not the way JavaScript
  does: see [Layer names and case](layer-names.md#layer-names-and-case).
- Layer colors are whole numbers from 1 to 255.
- Radii, text heights and rectangle sizes are greater than 0, and large enough
  not to be written as 0. Anything from 0.000001 up is safe. The leading CAD app gives text
  of height 0 its default height.
- Text is a single line. It cannot contain emoji or other characters above
  U+FFFF, because the leading CAD app cannot read them from DXF, or the private-use
  characters U+E800 to U+E8FF, which that app replaces.
- Coordinates, sizes and text rotations are under 1e100 in size, because
  the leading CAD app reads only two exponent digits from DXF.
- A polyline has a bulge for each side and a pair of widths for each side when it has them:
  a closed polyline has a side for each point, an open one a side fewer. A width is 0 or more,
  since the leading CAD app reads a negative width of every side as 0 and keeps a negative width
  of one side with no `AUDIT` error, and a polyline has one width for every side or one for each,
  not both. [Polylines](polylines.md#checks) has the rest.
- A paragraph is R2018 only. Its height, and its width where it has one, are greater than 0 as
  written, its line spacing is a factor from 0.25 to 4 as written, and its value holds only the
  codes tsdraft lays out: its braces close, each code is one tsdraft knows and ends with its `;`
  where it takes one, a font is one of `FONTS`, in bold only for a TrueType font and never in
  italic, and braces nest at most 16 deep. The codes of the height, width, slant, place and color of
  characters take the numbers the leading CAD app does, and the spacing of characters and an
  overline are refused until tsdraft lays them out, since a paragraph that held one would plot
  otherwise than tsdraft draws it. So are a stacked part of other characters than digits and
  capitals with `.`, `,`, `+` or `-`, or spaces, and a stack in underlined or struck-through
  characters. Its columns are a count and a height, a height, or heights, with a width to be as wide
  as, and a `\N` without them is a warning.
  [Paragraphs](paragraphs.md#what-lint-refuses) has the rest.
- An image is R2018 only. Its path is not empty, starts from the folder of the drawing's file and
  holds no `* ? < > | : "`, since the leading CAD app finds the file of an absolute path only
  there, its `pixels` are the file's, two whole numbers from 1 to 2,147,483,647, and two images of
  one file give it the same pixels. Its width and height are greater than 0 as written. A clip is
  two corners of a rectangle of some width and height along the image's sides, or a polygon of 3
  points that differ, at most 10,000 in all, and `invertClip` needs a clip.
  [Images](images.md#what-lint-refuses) has the rest.
- A hatch and a wipeout are R2018 only. A hatch has at least one loop, and each loop at least 3
  points, or 2 joined by an arc, with a bulge for each side where it has bulges. A wipeout has at
  least 3 points, which do not lie on one line as written, and sides that do not cross.
  `wipeoutFrame` is `true` or `false`. A paragraph's mask is `true`, `false` or
  `{ color?, offsetFactor? }`, a color from 1 to 256 and a factor from 1 to 5, as a leader's is,
  on a paragraph without columns, and a dimension style's `textMask` is `true`, `false` or `{ color }`.
  [Fills, wipeouts and masks](fills.md) has the rest.
- Arc angles are stored from 0 up to 360, so -90 becomes 270. An arc cannot come
  within 0.000001 degrees of a full turn, because its two angles would be
  written the same and the leading CAD app holds such an arc as having no length. Draw a
  circle instead.
- Linetype names follow the rules of layer names, and are compared the same
  way: see [Linetype names](layer-names.md#linetype-names). A layer or an
  entity can only use a linetype the drawing defines, or `Continuous`, `ByLayer`
  or `ByBlock`, because the leading CAD app discards a drawing that uses any other. Those
  three cannot be defined, and a layer's linetype cannot be `ByLayer` or
  `ByBlock`. A name that `AUDIT` would report as a duplicate of one of them,
  such as `Conti` + soft hyphen + `nuous`, cannot be defined either.
- A layer or an entity given a linetype definition, not a name, must give the
  pattern and description the drawing already has for that name, if it has it.
  `linetype()` changes a definition.
- A linetype pattern has 2 to 12 lengths, or none for a solid line. The leading CAD app
  discards a drawing with a longer pattern, and its `AUDIT` reports a pattern of
  one length. A length that is not 0 must not be written as 0, because the dash
  or gap would become a dot: use 0.000001 or more in size, or 0 for a dot. The
  lengths, added up without their signs, must be under 1e100, because the total
  is written too.
- A description is a single line, with no characters text cannot hold, and is at
  most 249 characters, where the leading CAD app cuts it.
- A text style has one of the fonts in `FONTS`: an SHX font by its file name,
  such as `txt.shx`, or a TrueType font by its typeface, such as `Arial`. They
  are fonts the 2025 release of the leading CAD app or Windows installs. That app draws text in a
  font it does not have in another font, and its `AUDIT` reports nothing.
- Text style names follow the rules of layer names, and are compared the same
  way: `notes` and `NOTES` are one style. The leading CAD app discards a drawing over a
  style name it refuses, and its `AUDIT` reports the pairs of style names it
  reports for layers.
- A text can only name a style the drawing defines, or `Standard`. The leading CAD app puts
  a text that names a style it does not have in `Standard`, and reports nothing.
- `Standard` is in every drawing and cannot be defined. The leading CAD app keeps the first
  style of a name and skips a second.
- A text given a style definition, not a name, must give the font, width factor
  and oblique angle the drawing already has for that name, if it has it.
  `textStyle()` changes a definition.
- A style's width factor is from 0.01 to 100, the range the leading CAD app's `STYLE`
  command takes. That app's `AUDIT` reports a style with a width factor of 0 or
  less, of 0.0001 or of 1000000.
- A style's oblique angle is from -85 to 85 degrees. The leading CAD app's `AUDIT` reports a
  style or a text slanted further.
- A text's `align` is `"left"`, `"center"` or `"right"`, and its `valign` is
  `"baseline"`, `"bottom"`, `"middle"` or `"top"`.
- A lineweight is one of the leading CAD app's: 0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25,
  0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2 or
  2.11 millimetres. That app discards a drawing with an entity of any other.
- Layer `0` cannot be frozen. It is the current layer, and the leading CAD app does not
  freeze the current layer.
- The linetype scale is a size, like a radius. The leading CAD app reads 0 or less as 1.
- An R12 drawing has no linetypes but `Continuous`, no linetype scale, no
  lineweights and no layer states. Its entities take no linetype or lineweight
  of their own, and draw ByLayer. Its texts are in `Standard`, left on the
  baseline, and it defines no text style.
- Block names follow the rules of layer names. The leading CAD app discards a drawing over a block
  name it refuses. It keeps names that start with `*` for the blocks it makes itself, and its
  `AUDIT` reports any other block of such a name. A name is at most 255 characters:
  that app's `BLOCK` command refuses a longer one.
- A block is defined once, and no two blocks have names the leading CAD app takes for one: `TREE`
  and `tree`, `straße` and `strasse`. That app keeps one block of the two, puts the entities of
  both in it, and reports nothing. See [Names](blocks.md#names).
- An insert names a block the drawing defines. The leading CAD app's `AUDIT` reports an insert of a
  block the drawing does not have, and that app cannot save the drawing as DXF.
- A block holds no insert of itself, directly or through the blocks it inserts. The leading CAD
  app's `AUDIT` reports such blocks as self referencing.
- Neither scale of an insert is 0, or small enough to be written as 0. The leading CAD app reads a
  scale of 0 as 1.
- An attribute's tag is not empty, which the leading CAD app's `AUDIT` reports, and holds no
  lower-case letter a to z. That app's `ATTDEF` command holds a tag in capitals, and its `-ATTEDIT`
  command finds no attribute whose tag has a lower-case letter. A tag, a prompt and a value
  are single lines of what text can hold.
- No two attribute definitions of a block have one tag. An insert sets an attribute by its
  tag, and the tag gives the definition its handle, so two of one tag would have one handle:
  the leading CAD app discards a drawing in which two objects have one handle.
- An insert sets only attributes its block defines. An attribute's place, height and style
  come from its definition, so a value for any other tag would not be written. The leading CAD app
  itself keeps an attribute whose tag its block does not define.
- An insert's scale leaves each attribute of its block slanted by no more than 85 degrees,
  and with a width factor from 0.01 to 100. The leading CAD app's `AUDIT` reports an attribute
  slanted further, and one with a width factor of 750000. The point the insert puts each attribute
  at is under 1e100 in size, as any coordinate is. An attribute definition is held to the
  rules of a text: its height, its style and its justification.
- An R12 drawing has no blocks, inserts or attributes.
- An xref's name follows the rules of block names, and no block and no other xref has a name
  the leading CAD app takes for the same. An xref is a block to that app: it discards a drawing with
  two such names that differ only in case, and makes one xref of any other two, such as `straße`
  and `strasse`, and reports nothing.
- An xref's path is not empty, since the leading CAD app then looks for a DWG file named as the xref
  is. It does not end in `.dxf`: that app loads only a DWG file as an xref, reports that it is
  unable to load a DXF, and draws nothing for it.
- An xref's path starts from the folder of the drawing's file: it does not start with `/` or
  `\`, or with a drive such as `C:`. The leading CAD app takes an absolute path. Where that folder
  is missing, as on another machine, it loads a file of the same name from the drawing's folder
  when there is one, and reports the xref as loaded.
- An xref's path holds none of `* ? < > | :` or `"`. The leading CAD app finds no file whose name
  holds one of them. It does read a path wrapped in a pair of quotes as the path inside, and tsdraft
  wants that path written without them.
- An xref's path does not end in a dot, unless the dot follows `.dwg`. The leading CAD app adds
  `.dwg` after the dot, so for `base.` it looks for `base..dwg` and finds no file.
- An xref's path holds no backslash before `M+`, a digit from 1 to 5 and four hex digits.
  Once the leading CAD app has saved the drawing it reads those as one character, and looks for
  another file. A `/` there does the same work.
- An xref's path is a single line of what text can hold, and at most 32,000 characters.
  The leading CAD app finds no file by a path with a tab, replaces the private-use characters when
  it saves the drawing, and finds no file by a path that comes to more than 32,767 characters
  with the folder of the drawing.
- An xref has no entities, no base point and no attribute definitions, and an insert of one
  sets no attributes: its file holds what it draws.
- An R12 drawing has no xrefs.
- A layout's name is not empty, has at most 255 characters, holds none of
  `< > / \ " : ; ? * | , =` and the backtick, no control character and no space at either
  end, and is not `Model` in any case. The leading CAD app's `LAYOUT` command refuses such names,
  its `-PLOT` finds no layout by a name with a space at an end, and it keeps `Model` for the model
  tab. See [Names](layouts.md#names).
- No two layouts have names the leading CAD app takes for one, as `Sheet` and `SHEET` are. That app
  keeps one of the two, and its `AUDIT` reports the other as missing from the dictionary of layouts.
- A layout's paper is one of `PAPERS`, and its plot style table one of `PLOT_STYLE_TABLES`.
  The leading CAD app plots nothing for a layout whose paper the plotter knows neither by name nor
  by size, and plots one whose plot style table it does not have with no table.
- A viewport's corner and center are points, its width and height are sizes, and its ratio is
  greater than 0. The height of model space it shows, which a file holds in place of a
  scale, is not written as 0 and is under 1e100.
- A layout is not defined inside a block or another layout, and a block is not defined inside
  a layout.
- An R12 drawing has no layouts.
- A dimension names a dimension style the drawing defines, and not `Standard`, which is
  the leading CAD app's own. That app discards a drawing with a dimension in a style it does not
  have.
- A dimension style's name follows the rules of a layer's name, is at most 255 characters,
  and is not one the leading CAD app takes for another style's. Its text style is one the drawing
  defines. Its text height is greater than 0, its arrow size, extension lengths and gap are
  0 or more, its two scales are greater than 0, its precision is a whole number from 0 to 8
  and its arrowhead is one of `ARROWHEADS`. That app's `AUDIT` reports a style that breaks
  most of these, and [Dimensions](dimensions.md#what-lint-reports) says what it does with
  each.
- A prefix, a suffix and a dimension's own text have none of `\`, `{` and `}`, which the leading CAD
  app reads as formatting. A prefix has no `<>`. A dimension's text is not empty or all spaces,
  which that app draws as no text, and has no `[]` beside `<>`, for which that app writes the
  measurement again in alternate units.
- A dimension measures something, writes a number under 100,000,000 with no more than 15
  digits once it is rounded to its style's precision, and with closed filled arrowheads has room for its text
  between its extension lines. The leading CAD app draws one that measures nothing with the text 0,
  drops decimals of a larger number, works the 16th digit out from its own arithmetic, and
  turns the arrowheads of one without room outward.
- Every number a dimension draws is under 1e100: each size of its style times the scale, and
  each point of its picture. A text height, and an arrow size other than 0, times the scale is
  not written as 0.
- A linear dimension measures along an angle from -360 to 360, by tsdraft's own rule, so that
  one direction has one angle.
- A dimension is not in a block. The leading CAD app draws nothing for it when it opens the file.
- A block is not named `_ArchTick` or `_Oblique`, in any case. The leading CAD app draws a
  dimension's ticks with the blocks of those names.
- What a dimension style sets of how it looks is one of its lists, a stacked fraction is in
  feet and inches, and a dimension leaves out what [Dimensions](dimensions.md#what-lint-reports)
  says is not laid out yet.
- An R12 drawing has no dimensions.
- A leader names a leader style the drawing defines, and not `Standard`, which is the leading CAD
  app's own. A leader style's name follows the rules of a dimension style's name. Its text style,
  and a leader's own, is one the drawing defines. Its text height is greater than 0, its arrow
  size, landing and gap are 0 or more, its scale is greater than 0, its arrowhead is one of
  `LEADER_ARROWHEADS` and its attachment one of `LEADER_ATTACHMENTS`. A leader's width is greater
  than 0, and its mask `true`, `false` or a color index and a factor from 1 to 5. A leader whose
  content is a block names a block of the drawing and sets nothing only a note has.
  [Leaders](leaders.md#what-lint-reports) says why.
- A leader's note is paragraphs of text with none of `\`, `{` and `}`, and one that is not
  empty or all spaces. A leader has a shaft, and the first segment of each has a length once it
  is written with 6 decimals. Every number a leader draws is under 1e100.
- A leader is not in a block, and an R12 drawing has no leaders.
- A block is not named `_Open`, `_Dot` or `_None`, in any case. The leading CAD app draws a leader's
  arrowheads with the blocks of those names.
- An entity's id has 1 to 64 letters A to Z or a to z, digits, `.`, `-` and
  `_`, and no two entities share one, whatever its case, in model space, in a block or on a
  layout. A viewport's id is one of them. See
  [Ids](format.md#ids).
- No two ids give one handle. An entity's handle comes from its id, and the leading CAD app discards
  a drawing in which two objects have one handle. It is rare: see
  [An id gives a handle](format.md#an-id-gives-a-handle). The same goes for the handles a
  block's name and an attribute's tag give: see [Handles](blocks.md#handles).
- A drawing has `format: 0`. See [Format 0](format.md#format-0).
- A drawing has the shape of a `Drawing`. `lint` takes any plain data and never throws: for a
  list that is not an array or has an empty slot, an item that is not an object, an entity
  whose `kind` is not one of `line`, `polyline`, `circle`, `arc`, `text`, `insert`,
  `linear-dimension`, `aligned-dimension` and `leader`, a missing
  field and a field of the wrong type, it gives an error with the path to the value, such as
  `entities[3].from must be a point, [x, y]`. The rule is `linetype`, `text-style`, `block` or
  `attribute` for a value in that list, `xref` for one in `xrefs`, `dimension-style` for one
  in `dimensionStyles`, `leader-style` for one in `leaderStyles`, `layout` for a layout,
  `viewport` for a viewport, and `format` for the rest, which an entity of a sheet is.
  No other rule is checked on an object of the wrong shape, and what names it gets no error
  for that. An object that a drawing made in code shares among many places is reported where it
  is first met. A `Proxy` is code, not data, and nothing can tell one from data without asking it:
  `lint` reads one as the data its traps give and calls them in proportion to what it reads, so
  a trap that throws or never returns does so inside `lint`. The error's `item` is the path of
  the item to leave out, such as `entities[3]` or `layouts[0].viewports[1]`. An error about a layout's paper or about a viewport with no
  view has an `item` as well, since neither can be drawn.
- An object has only the fields of its type. `colour` on a layer or `thickness` on an entity
  would not be written, so each is an error under the same rules, and the message names the
  field it is closest to: `layers[1]: unknown field "colour". Did you mean "color"?` A field
  of another kind of object, such as `scale` on a text, gets no hint.

## Warnings

`lint` also returns warnings. Warnings do not stop an export, except `check-capped`. They are:

- A line, a polyline or an arc that has no length, or has none once its numbers
  are rounded.
- Text that contains `%%`. The leading CAD app stores the text as written but reads `%%` as
  the start of a control code when it draws it: `%%d` is drawn as a degree sign
  and `%%%` as one percent sign.
- A dimension's text, or its style's prefix or suffix, that contains `%%`, for the same
  reason, and a line of a leader's note that does.
- An xref that no insert places. The leading CAD app purges an xref that nothing references
  when it opens the drawing.
- A viewport that reaches past its layout's paper. The leading CAD app plots a layout as far as its
  paper goes.
- A viewport that shows none of the drawing: nothing in model space lies in the box it shows.
- `check-capped`: where `lint` stopped the checks it makes again for what a drawing repeats:
  each attribute an insert places and each handle it takes past its first 64, a tag of 256
  characters or more each time an insert's values are searched for it, what each
  dimension reads from its style's prefix and suffix, the way back through a cycle of blocks,
  which each block of the cycle's error names while there is room, the extents of model
  space and of each layout, which the DXF holds and each viewport is held against, and a list,
  a list of 64 points or more, an insert's values past the first 64, or a string of 256
  characters or more that a drawing made in code shares among many places, each time it is read
  again. They are bounded: they do at most
  500,000 units of work, and 16 more for each entity and attribute definition the drawing holds,
  counting a shared list once,
  so a drawing that repeats far more than it holds gets this one warning, which says where they
  stopped, and no entity past there is checked. Every other check takes time in proportion to
  the drawing, and blocks nested to any depth cost what they hold, not what they draw. `toDXF`
  refuses a drawing with this warning, since a problem past that point would go unreported.

`toDXF` throws a `DrawingError` for errors, and for `check-capped`. Its `diagnostics` property holds
them, and other code may throw one to refuse a drawing for its own reasons.

## A drawing's standard

`lint(drawing, { standard })` also holds a drawing to the standard it is drawn to, as the builder
does at each call, so a drawing made by other code or read from JSON is held to it too. The leading
CAD app opens a drawing that breaks its standard, and `toDXF` writes one: these are a firm's rules,
not that app's. `lint` takes the standard as plain data, from any copy of tsdraft: it checks it, and
works out its hash again. A standard that does not check, or whose hash is not its content's, is
one `standard` error, and `lint` holds the drawing to nothing else of it. `discipline` names the
drawing's discipline, which resolves the entries with fields by discipline. Without `standard`,
`lint` checks none of this.

Errors:

- `layer-outside-standard`: a layer the standard does not have, and an entity of model space or
  of a layout on layer `0`, which is in no standard. In a block, layer `0` draws as the insert's
  layer does, and is the layer to draw on.
- `layer-differs-from-standard`: a layer whose color, linetype, lineweight or plot flag is not
  the standard's, once for each.
- `linetype-outside-standard`: a linetype the standard does not have.
- `linetype-differs-from-standard`: a linetype whose pattern or description is not the
  standard's, and a linetype scale other than the standard's.
- `pen-outside-standard`: an entity's lineweight that is no pen's. `ByLayer` and `ByBlock` are
  every standard's.
- `text-style-outside-standard`: a text style that is no role's and no title block's, and a text
  or an attribute definition in no role's text style, `Standard` among them. So is a leader with
  a text style of its own that is no role's.
- `text-style-differs-from-standard`: a role's text style whose font, width factor or oblique
  angle is not the role's.
- `dimension-style-outside-standard`: a dimension style that is none of the standard's, which
  are named after the style's id in capitals on a layout, such as `DIMS`, and with a scale's id
  after it in model space, such as `DIMS-1in-10ft`.
- `dimension-style-differs-from-standard`: one of those whose text style, sizes, arrowhead,
  scale or writing is not what the standard gives it, once for each. A style that the standard
  says nothing about how to write in its units, the drawing's or the paper's, is
  `dimension-style`.
- `leader-style-outside-standard`: a leader style that is none of the standard's, which are
  named as its dimension styles are, such as `NOTES` on a layout and `NOTES-1in-10ft` in model
  space.
- `leader-style-differs-from-standard`: one of those whose text style, text height, arrowhead,
  sizes, attachment or scale is not what the standard gives it, once for each.
- `scale-outside-standard`: a viewport whose ratio is no scale of the standard.
- `sheet-format-outside-standard`: a layout on a paper that no sheet format of the standard is
  on, and one whose plot style table is not its sheet format's.
- `viewport-outside-drawing-area`: a viewport that reaches past the drawing area of its sheet
  format's title block, or into the title block's box.
- `title-block-differs-from-standard`: a title block in the drawing that is not the standard's,
  as below, and a layout that inserts the title block of another sheet format than its own.
- `height-off-role`: a text in a role's text style that plots at another height than the
  role's. A line of a leader's note counts as a text, where the leader is shown at its style's
  scale.
- `height-below-standard`: a text that plots below the standard's `minTextHeight`, a line of a
  leader's note included.
- `dimension-off-scale`: a dimension shown in a viewport at another ratio than its style's
  scale, and one on a layout in a style for model space.
- `leader-off-scale`: the same for a leader.
- `sheet-per-file`: under `sheetFiles` `"sheet-per-file"`, a drawing with a second layout, and
  a sheet number in the title block that cannot name a file.
- `layout`: under `sheetFiles` `"one-drawing"`, a sheet number in the title block that is not
  its layout's name.
- `standard`: besides a standard that does not check, an R12 drawing, and a `discipline` that is
  none of the standard's, or is given under `"one-drawing"`.

Warnings:

- `sheet-format-ambiguous`: a layout on a paper that several sheet formats are on, which inserts
  the title block of none of them, or of several with other title blocks that its plot style
  table does not tell apart. `lint` does not check its drawing area, its title block or its
  fields.
- `title-block-missing`: a layout with no insert of its sheet format's title block.
- `title-block-field-unset`: a field of the title block, written as an attribute, that its insert
  does not set, so it shows its attribute's default.
- `title-block-field-overflow`: a field's value that runs past the field's box, as `measureText`
  measures it.
- `discipline-unknown`: the entries with fields by discipline that `lint` checked in none of
  their forms, since it was not given the drawing's discipline.
- `standard-check-capped`: where the checks of text heights and dimension scales, or of a list
  or a long string that a drawing made in code shares among many places, stopped. They
  are bounded, counting each text, each dimension by the length of what its label reads, its
  style's name, its own text and its style's prefix, suffix and text style, each insert they walk
  and each item of the block it enters, each name they read the first time, by its length, and
  each error by the length of its message. The checks of layers, pens and text styles pay for
  a list each time another block reads it, each error from it by the length of its message, and
  a string of 256 characters or more each time another place holds it. They enter only a block
  that can draw a text, so a
  drawing with no text in its blocks costs nothing to walk. A drawing that draws more than they
  look through gets one warning that says where they stopped. The other checks take time in proportion to the drawing, the standard and the
  problems they report: a standard given as data gets one problem for each pair of its names
  that the leading CAD app takes for one, however many there are.

A layout is on the one sheet format of the standard on its paper. Among several on its paper, it
is on those whose title block it inserts, and of those, on the ones whose plot style table it
has. When they share one title block, `lint` checks the layout against that title block.

A text is checked in each viewport that shows it, whether model space draws it itself or through
an insert: where its box meets the part of model space the viewport shows, and its layer is on,
thawed and plots. It plots at its height, times the scale of the insert that draws it, times the
viewport's scale. A text of a layout plots at its height, times its insert's scale. Heights are
compared as written, with 6 decimals.

A title block in the drawing is the standard's when every definition of its closure is, by its
JSON: its block, each block that block inserts, each text style their texts and attributes name,
each linetype their entities name, and its xref's name and path. Then the rules for pens, text
styles and role heights leave out what it draws, and `height-below-standard` still holds its
texts. When one of them differs, or is missing, every rule holds it as any other block.
