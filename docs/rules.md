# Rules

tsdraft checks these rules. The [README](../README.md#checks) explains the three
places checks run.

## Numbers

Numbers are written with 6 decimals, in DXF and in SVG. The checks below judge
a drawing as it will be written, so a size too small to survive the rounding is
an error and a line that rounds down to a point is a warning. Every number must
also be under 1e100 in size. AutoCAD reads only two exponent digits from DXF, so
it would take `1e+100` for `1e+10` and report nothing.

## Errors

- Layer names cannot be empty, start or end with a space, or contain a line
  break or any of ``< > / \ " : ; ? * | = ` ^ ,``. R12 names have the tighter
  limits in the [DXF versions](../README.md#dxf-versions) table.
- Layer names cannot contain the other characters AutoCAD refuses in a name. It
  discards the drawing over any of them, and they are listed under
  [Layer name characters](layer-names.md#layer-name-characters).
- `wall` and `WALL` are the same layer, as in CAD. The first spelling is kept.
  tsdraft compares names the way AutoCAD does, which is not the way JavaScript
  does: see [Layer names and case](layer-names.md#layer-names-and-case).
- Layer colors are whole numbers from 1 to 255.
- Radii, text heights and rectangle sizes are greater than 0, and large enough
  not to be written as 0. Anything from 0.000001 up is safe. AutoCAD gives text
  of height 0 its default height.
- Text is a single line. It cannot contain emoji or other characters above
  U+FFFF, because AutoCAD cannot read them from DXF, or the private-use
  characters U+E800 to U+E8FF, which AutoCAD replaces.
- Coordinates, sizes and text rotations are under 1e100 in size, because
  AutoCAD reads only two exponent digits from DXF.
- Arc angles are stored from 0 up to 360, so -90 becomes 270. An arc cannot come
  within 0.000001 degrees of a full turn, because its two angles would be
  written the same and AutoCAD holds such an arc as having no length. Draw a
  circle instead.
- Linetype names follow the rules of layer names, and are compared the same
  way: see [Linetype names](layer-names.md#linetype-names). A layer or an
  entity can only use a linetype the drawing defines, or `Continuous`, `ByLayer`
  or `ByBlock`, because AutoCAD discards a drawing that uses any other. Those
  three cannot be defined, and a layer's linetype cannot be `ByLayer` or
  `ByBlock`. A name that `AUDIT` would report as a duplicate of one of them,
  such as `Conti` + soft hyphen + `nuous`, cannot be defined either.
- A layer or an entity given a linetype definition, not a name, must give the
  pattern and description the drawing already has for that name, if it has it.
  `linetype()` changes a definition.
- A linetype pattern has 2 to 12 lengths, or none for a solid line. AutoCAD
  discards a drawing with a longer pattern, and its `AUDIT` reports a pattern of
  one length. A length that is not 0 must not be written as 0, because the dash
  or gap would become a dot: use 0.000001 or more in size, or 0 for a dot. The
  lengths, added up without their signs, must be under 1e100, because the total
  is written too.
- A description is a single line, with no characters text cannot hold, and is at
  most 249 characters, where AutoCAD cuts it.
- A text style has one of the fonts in `FONTS`: an SHX font by its file name,
  such as `txt.shx`, or a TrueType font by its typeface, such as `Arial`. They
  are fonts AutoCAD 2025 or Windows installs. AutoCAD draws text in a font it
  does not have in another font, and its `AUDIT` reports nothing.
- Text style names follow the rules of layer names, and are compared the same
  way: `notes` and `NOTES` are one style. AutoCAD discards a drawing over a
  style name it refuses, and its `AUDIT` reports the pairs of style names it
  reports for layers.
- A text can only name a style the drawing defines, or `Standard`. AutoCAD puts
  a text that names a style it does not have in `Standard`, and reports nothing.
- `Standard` is in every drawing and cannot be defined. AutoCAD keeps the first
  style of a name and skips a second.
- A text given a style definition, not a name, must give the font, width factor
  and oblique angle the drawing already has for that name, if it has it.
  `textStyle()` changes a definition.
- A style's width factor is from 0.01 to 100, the range AutoCAD's `STYLE`
  command takes. AutoCAD's `AUDIT` reports a style with a width factor of 0 or
  less, of 0.0001 or of 1000000.
- A style's oblique angle is from -85 to 85 degrees. AutoCAD's `AUDIT` reports a
  style or a text slanted further.
- A text's `align` is `"left"`, `"center"` or `"right"`, and its `valign` is
  `"baseline"`, `"bottom"`, `"middle"` or `"top"`.
- A lineweight is one of AutoCAD's: 0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25,
  0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2 or
  2.11 millimetres. AutoCAD discards a drawing with an entity of any other.
- Layer `0` cannot be frozen. It is the current layer, and AutoCAD does not
  freeze the current layer.
- The linetype scale is a size, like a radius. AutoCAD reads 0 or less as 1.
- An R12 drawing has no linetypes but `Continuous`, no linetype scale, no
  lineweights and no layer states. Its entities take no linetype or lineweight
  of their own, and draw ByLayer. Its texts are in `Standard`, left on the
  baseline, and it defines no text style.
- Block names follow the rules of layer names. AutoCAD discards a drawing over a block name
  it refuses. It keeps names that start with `*` for the blocks it makes itself, and its
  `AUDIT` reports any other block of such a name. A name is at most 255 characters:
  AutoCAD's `BLOCK` command refuses a longer one.
- A block is defined once, and no two blocks have names AutoCAD takes for one: `TREE` and
  `tree`, `straße` and `strasse`. AutoCAD keeps one block of the two, puts the entities of
  both in it, and reports nothing. See [Names](blocks.md#names).
- An insert names a block the drawing defines. AutoCAD's `AUDIT` reports an insert of a
  block the drawing does not have, and AutoCAD cannot save the drawing as DXF.
- A block holds no insert of itself, directly or through the blocks it inserts. AutoCAD's
  `AUDIT` reports such blocks as self referencing.
- Neither scale of an insert is 0, or small enough to be written as 0. AutoCAD reads a scale
  of 0 as 1.
- An attribute's tag is not empty, which AutoCAD's `AUDIT` reports, and holds no lower-case
  letter a to z. AutoCAD's `ATTDEF` command holds a tag in capitals, and its `-ATTEDIT`
  command finds no attribute whose tag has a lower-case letter. A tag, a prompt and a value
  are single lines of what text can hold.
- No two attribute definitions of a block have one tag. An insert sets an attribute by its
  tag, and the tag gives the definition its handle, so two of one tag would have one handle:
  AutoCAD discards a drawing in which two objects have one handle.
- An insert sets only attributes its block defines. An attribute's place, height and style
  come from its definition, so a value for any other tag would not be written. AutoCAD
  itself keeps an attribute whose tag its block does not define.
- An insert's scale leaves each attribute of its block slanted by no more than 85 degrees,
  and with a width factor from 0.01 to 100. AutoCAD's `AUDIT` reports an attribute slanted
  further, and one with a width factor of 750000. The point the insert puts each attribute
  at is under 1e100 in size, as any coordinate is. An attribute definition is held to the
  rules of a text: its height, its style and its justification.
- An R12 drawing has no blocks, inserts or attributes.
- An xref's name follows the rules of block names, and no block and no other xref has a name
  AutoCAD takes for the same. An xref is a block to AutoCAD: it discards a drawing with two
  such names that differ only in case, and makes one xref of any other two, such as `straße`
  and `strasse`, and reports nothing.
- An xref's path is not empty, since AutoCAD then looks for a DWG file named as the xref is.
  It does not end in `.dxf`: AutoCAD loads only a DWG file as an xref, reports that it is
  unable to load a DXF, and draws nothing for it.
- An xref's path starts from the folder of the drawing's file: it does not start with `/` or
  `\`, or with a drive such as `C:`. AutoCAD takes an absolute path. Where that folder is
  missing, as on another machine, it loads a file of the same name from the drawing's folder
  when there is one, and reports the xref as loaded.
- An xref's path holds none of `* ? < > | :` or `"`. AutoCAD finds no file whose name holds
  one of them. It does read a path wrapped in a pair of quotes as the path inside, and tsdraft
  wants that path written without them.
- An xref's path does not end in a dot, unless the dot follows `.dwg`. AutoCAD adds `.dwg`
  after the dot, so for `base.` it looks for `base..dwg` and finds no file.
- An xref's path holds no backslash before `M+`, a digit from 1 to 5 and four hex digits.
  Once AutoCAD has saved the drawing it reads those as one character, and looks for another
  file. A `/` there does the same work.
- An xref's path is a single line of what text can hold, and at most 32,000 characters.
  AutoCAD finds no file by a path with a tab, replaces the private-use characters when it
  saves the drawing, and finds no file by a path that comes to more than 32,767 characters
  with the folder of the drawing.
- An xref has no entities, no base point and no attribute definitions, and an insert of one
  sets no attributes: its file holds what it draws.
- An R12 drawing has no xrefs.
- A layout's name is not empty, has at most 255 characters, holds none of
  `< > / \ " : ; ? * | , =` and the backtick, no control character and no space at either
  end, and is not `Model` in any case. AutoCAD's `LAYOUT` command refuses such names, its
  `-PLOT` finds no layout by a name with a space at an end, and it keeps `Model` for the model
  tab. See [Names](layouts.md#names).
- No two layouts have names AutoCAD takes for one, as `Sheet` and `SHEET` are. AutoCAD keeps
  one of the two, and its `AUDIT` reports the other as missing from the dictionary of layouts.
- A layout's paper is one of `PAPERS`, and its plot style table `monochrome.ctb` or
  `acad.ctb`. AutoCAD plots nothing for a layout whose paper the plotter knows neither by
  name nor by size, and plots one whose plot style table it does not have with no table.
- A viewport's corner and center are points, its width and height are sizes, and its ratio is
  greater than 0. The height of model space it shows, which a file holds in place of a
  scale, is not written as 0 and is under 1e100.
- A layout is not defined inside a block or another layout, and a block is not defined inside
  a layout.
- An R12 drawing has no layouts.
- A dimension names a dimension style the drawing defines, and not `Standard`, which is
  AutoCAD's own. AutoCAD discards a drawing with a dimension in a style it does not have.
- A dimension style's name follows the rules of a layer's name, is at most 255 characters,
  and is not one AutoCAD takes for another style's. Its text style is one the drawing
  defines. Its text height is greater than 0, its arrow size, extension lengths and gap are
  0 or more, its two scales are greater than 0, its precision is a whole number from 0 to 8
  and its arrowhead is one of `ARROWHEADS`. AutoCAD's `AUDIT` reports a style that breaks
  most of these, and [Dimensions](dimensions.md#what-lint-reports) says what it does with
  each.
- A prefix, a suffix and a dimension's own text have none of `\`, `{` and `}`, which AutoCAD
  reads as formatting. A prefix has no `<>`. A dimension's text is not empty or all spaces,
  which AutoCAD draws as no text, and has no `[]` beside `<>`, for which AutoCAD writes the
  measurement again in alternate units.
- A dimension measures something, writes a number under 100,000,000 with no more than 15
  digits once it is rounded to its style's precision, and with closed filled arrowheads has room for its text
  between its extension lines. AutoCAD draws one that measures nothing with the text 0,
  drops decimals of a larger number, works the 16th digit out from its own arithmetic, and
  turns the arrowheads of one without room outward.
- Every number a dimension draws is under 1e100: each size of its style times the scale, and
  each point of its picture. A text height, and an arrow size other than 0, times the scale is
  not written as 0.
- A linear dimension measures along an angle from -360 to 360, by tsdraft's own rule, so that
  one direction has one angle.
- A dimension is not in a block. AutoCAD draws nothing for it when it opens the file.
- A block is not named `_ArchTick`, in any case. AutoCAD draws a dimension's architectural
  tick with the block of that name.
- An R12 drawing has no dimensions.
- An entity's id has 1 to 64 letters A to Z or a to z, digits, `.`, `-` and
  `_`, and no two entities share one, whatever its case, in model space, in a block or on a
  layout. A viewport's id is one of them. See
  [Ids](format.md#ids).
- No two ids give one handle. An entity's handle comes from its id, and AutoCAD discards a
  drawing in which two objects have one handle. It is rare: see
  [An id gives a handle](format.md#an-id-gives-a-handle). The same goes for the handles a
  block's name and an attribute's tag give: see [Handles](blocks.md#handles).
- A drawing has `format: 0`. See [Format 0](format.md#format-0).
- A drawing has the shape of a `Drawing`. `lint` takes any plain data and never throws: for a
  list that is not an array or has an empty slot, an item that is not an object, an entity
  whose `kind` is not one of `line`, `polyline`, `circle`, `arc`, `text`, `insert`,
  `linear-dimension` and `aligned-dimension`, a missing
  field and a field of the wrong type, it gives an error with the path to the value, such as
  `entities[3].from must be a point, [x, y]`. The rule is `linetype`, `text-style`, `block` or
  `attribute` for a value in that list, `xref` for one in `xrefs`, `dimension-style` for one
  in `dimensionStyles`, `layout` for a layout,
  `viewport` for a viewport, and `format` for the rest, which an entity of a sheet is.
  No other rule is checked on an object of the wrong shape, and what names it gets no error
  for that. The error's `item` is the path of the item to leave out, such as `entities[3]`
  or `layouts[0].viewports[1]`. An error about a layout's paper or about a viewport with no
  view has an `item` as well, since neither can be drawn.
- An object has only the fields of its type. `colour` on a layer or `thickness` on an entity
  would not be written, so each is an error under the same rules, and the message names the
  field it is closest to: `layers[1]: unknown field "colour". Did you mean "color"?` A field
  of another kind of object, such as `scale` on a text, gets no hint.

## Warnings

`lint` also returns warnings. Warnings do not stop an export. They are:

- A line, a polyline or an arc that has no length, or has none once its numbers
  are rounded.
- Text that contains `%%`. AutoCAD stores the text as written but reads `%%` as
  the start of a control code when it draws it: `%%d` is drawn as a degree sign
  and `%%%` as one percent sign.
- A dimension's text, or its style's prefix or suffix, that contains `%%`, for the same
  reason.
- An xref that no insert places. AutoCAD purges an xref that nothing references
  when it opens the drawing.
- A viewport that reaches past its layout's paper. AutoCAD plots a layout as far as its paper
  goes.
- A viewport that shows none of the drawing: nothing in model space lies in the box it shows.

`toDXF` throws a `DrawingError` for errors only. Its `diagnostics` property holds
them, and other code may throw one to refuse a drawing for its own reasons.
