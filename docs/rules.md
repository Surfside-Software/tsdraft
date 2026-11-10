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
- A lineweight is one of AutoCAD's: 0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25,
  0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2 or
  2.11 millimetres. AutoCAD discards a drawing with an entity of any other.
- Layer `0` cannot be frozen. It is the current layer, and AutoCAD does not
  freeze the current layer.
- The linetype scale is a size, like a radius. AutoCAD reads 0 or less as 1.
- An R12 drawing has no linetypes but `Continuous`, no linetype scale, no
  lineweights and no layer states. Its entities take no linetype or lineweight
  of their own, and draw ByLayer.

## Warnings

`lint` also returns warnings. Warnings do not stop an export. They are:

- A line, a polyline or an arc that has no length, or has none once its numbers
  are rounded.
- Text that contains `%%`. AutoCAD stores the text as written but reads `%%` as
  the start of a control code when it draws it: `%%d` is drawn as a degree sign
  and `%%%` as one percent sign.

`toDXF` throws a `DrawingError` for errors only. Its `diagnostics` property holds
them, and other code may throw one to refuse a drawing for its own reasons.
