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

## Warnings

`lint` also returns warnings. Warnings do not stop an export. They are:

- A line, a polyline or an arc that has no length, or has none once its numbers
  are rounded.
- Text that contains `%%`. AutoCAD stores the text as written but reads `%%` as
  the start of a control code when it draws it: `%%d` is drawn as a degree sign
  and `%%%` as one percent sign.

`toDXF` throws a `DrawingError` for errors only. Its `diagnostics` property holds
them, and other code may throw one to refuse a drawing for its own reasons.
