# Changelog

## Unreleased

- `toSVG` draws a layer in the color AutoCAD plots its index in, for every index
  from 1 to 255. It knew 1 to 6 and drew the rest in `currentColor`. Index 7
  stays `currentColor`: it is black on paper and white on a dark screen.
- Breaking: `toSVG` leaves out a layer whose `plot` is false, as it leaves out
  one that is off or frozen, so the picture is the drawing as it plots.
  `toSVG(drawing, { drawNoPlot: true })` draws those layers too.

## 0.4.0

- `fromPaper(length, "in" | "mm", { ratio, units })` turns a length on paper
  into drawing units, to size text, symbols and dashes by how large they plot:
  `fromPaper(3 / 32, "in", { ratio: 96, units: "ft" })` is 0.75. A wrong unit,
  and a length or ratio of 0 or less, are compile errors as literals and thrown
  errors otherwise. A result that would be written as 0, or is 1e100 or more,
  throws.
- `examples/site-plan.ts` is now the example sheet: a permit-style site plan for
  an ARCH D sheet at 1" = 10', with property lines, setbacks, a building
  footprint, dimensions, labels, site data, notes and a legend. Every text
  height and annotation offset comes from `fromPaper`. Its default export is the drawing.
- Breaking: a `Drawing` has `format: 0`, its format version, which is separate
  from `dxf`. The builder sets it. A drawing written by hand needs it, and
  `lint` reports one without it under the new rule `format`. Format 0 carries
  no promise of stability.
- Breaking: `LintRule` gained `format`, `id` and `duplicate-id`. Code that
  switches over every rule, or uses `Record<LintRule, …>`, needs the three.
- `toJSON(drawing)` writes a drawing as canonical JSON: the same drawing gives
  the same string, whatever order its keys were set in.
- `fromJSON(json)` reads a drawing from a JSON string or a parsed value. It
  refuses a format version, a field or an entity kind it does not know, naming
  each, then runs `lint`, and throws a `DrawingError`.
- Entities take an `id` in their options: 1 to 64 letters, digits, `.`, `-` and
  `_`. A malformed id and a second entity with the same id are builder errors
  and `lint` errors, under the new rules `id` and `duplicate-id`. `toSVG` writes
  the id as `data-id`.
- A `Diagnostic` about an entity carries its `id`, and `call`, the file, line
  and column of the call that drew it, when the drawing was built with
  `createDrawing({ recordCalls: true })`. Setting
  `globalThis.TSDRAFT_RECORD_CALLS = true` before a drawing's code runs turns
  recording on for every builder that does not set the option, which is how a
  tool that runs drawing files asks for it.
- The builder's `layer`, `linetype` and entity methods now throw a
  `DrawingError` with the same message as before. Its diagnostic has the rule,
  the `id` and the `call` that broke it.
- [docs/format.md](docs/format.md) describes all of the above.

## 0.3.0

- Breaking: `createDrawing()` now targets DXF R2018. Pass `{ dxf: "R12" }` for
  R12, which gets no new features.
- Linetypes. `d.linetype({ name, description, pattern })` defines one, with
  dashes as positive lengths, gaps as negative ones and dots as 0. `DASHED`,
  `HIDDEN`, `CENTER`, `PHANTOM`, `DASHDOT` and `DOT` are exported with the
  patterns AutoCAD loads from its `acad.lin`. `Continuous`, `ByLayer` and
  `ByBlock` are in every drawing. `createDrawing({ linetypeScale })` sets
  `$LTSCALE`.
- Lineweights in millimetres, from AutoCAD's 24.
- Layers take a `linetype`, a `lineweight`, and `off`, `frozen`, `locked` and
  `plot`. Entities take a `linetype` and a `lineweight` of their own, and draw
  ByLayer otherwise, as before.
- `toSVG` draws dashes and pen weights, and leaves out layers that are off or
  frozen. Its `strokeWidth` is now the width of a 0.25 mm line.
- `toSVG` marks each entity's element with `data-entity`, its index in
  `drawing.entities`, beside `data-layer`.
- New rules, each a builder error and a `lint` error, and a compile error where
  the literal shows it:
  - a lineweight outside AutoCAD's list, which makes AutoCAD discard the drawing
    when an entity has it;
  - a linetype the drawing does not define, which makes AutoCAD discard it;
  - a pattern of one length, which `AUDIT` reports, or more than 12, which makes
    AutoCAD discard the drawing;
  - a pattern length that is not 0 but is written as 0, which would turn a dash
    or a gap into a dot, and a pattern whose lengths add up to 1e100 or more,
    because the total is written too;
  - defining `Continuous`, `ByLayer` or `ByBlock`, a layer whose linetype is
    `ByLayer` or `ByBlock`, and freezing layer `0`, which is the current layer;
  - a linetype scale of 0 or less, or one written as 0, which AutoCAD reads as
    1, and a description over 249 characters, where AutoCAD cuts it;
  - linetype names follow the rules of layer names, which AutoCAD holds them to,
    and a name that `AUDIT` would report as a duplicate of `Continuous`,
    `ByLayer` or `ByBlock`, such as one with a soft hyphen in it;
  - a description with a control character, an emoji or a private-use
    character from U+E800 to U+E8FF, as for text;
  - an R12 drawing that defines a linetype, sets a linetype scale, or gives a
    layer a linetype other than `Continuous`, a lineweight or a state, and an R12
    entity with a linetype or lineweight of its own. Each message says to use
    R2018.
- A layer or an entity can be given a definition in place of a linetype name.
  It is checked as `linetype()` checks one, and is defined if the drawing does
  not have the name. If the drawing has the name with another pattern or
  description, the builder throws: change a linetype with `linetype()`.
- `lint` has the rules `linetype`, `duplicate-linetype`, `undefined-linetype`,
  `lineweight` and `layer-state`, and a diagnostic names its `linetype`.

## 0.2.2

- Fixed: AutoCAD keeps two layers such as `straße` and `STRASSE` apart, but its
  `AUDIT` reports them as a duplicate name. `lint` now reports the second layer
  as a duplicate, and the builder throws at the `layer()` call. It does so for
  these kinds of pair, in either letter case and inside longer names:
  - a letter and the letters it stands for, such as `ß` and `ss`, `æ` and `ae`,
    `œ` and `oe`, `ĳ` and `ij`, `ﬁ` and `fi`, `ǆ` and `dž`, and `þ` and `th`;
  - a composed character and its decomposed form, such as `é`;
  - a name with a soft hyphen inside it or in front of it and the same name
    without.

  This is not all that `AUDIT` reports. The README lists what is covered and
  what is left out.

- When an entity names its layer by the other spelling of such a pair, the
  undefined-layer error now says which declared layer AutoCAD does not take it
  for. AutoCAD adds a layer for the entity, and `AUDIT` reports a duplicate name.

## 0.2.1

- Fixed: text holding `\U+XXXX` or `\M+NXXXX` came out in AutoCAD as the
  character those escapes stand for, so `\U+00B0` became a degree sign and
  `\U+000A` put a line feed inside a single-line text. Both DXF versions now
  write such a backslash so that AutoCAD holds the text as the drawing has it
  when it opens the file. AutoCAD decodes the text after all once it has saved
  the drawing itself and opened it again: `\M+NXXXX` after a save as DWG, and
  `\U+XXXX` too after a save as DXF.
- Fixed: a size too small for the 6 decimals tsdraft writes was written as 0.
  AutoCAD gave such a text its default height, and held such a circle or arc
  with radius 0. A radius, text height or rectangle size that would be written
  as 0 is now an error, in the compiler for a literal and when the code runs.
  `rect()` also throws when a side is lost because two corners round together.
- Fixed: AutoCAD reads only two exponent digits from DXF, so it took a number
  written as `1e+100` for `1e+10`, with no `AUDIT` error. A coordinate, size or
  text rotation of 1e100 or more is now an error, in the compiler for a size
  written as a literal and when the code runs. The R2018 writer also caps the
  extents and the view height it works out, which could pass 1e100 for a
  drawing whose own numbers are all smaller.
- Fixed: an arc within 0.000001 degrees of a full turn was written with equal
  angles, which AutoCAD holds as an arc of no length. It is now an error. An arc
  angle that rounds up to 360 is written as 0.
- Fixed: `toDXF` wrote layer `0` wherever the drawing listed it, and `AUDIT`
  reported "Layer zero name found at incorrect index" when another layer came
  first. Layer `0` is now written first.
- Fixed: `lint` matched layer names with JavaScript's `toLowerCase()`, which
  AutoCAD does not use. It accepted an entity on `οδος` for a layer `ΟΔΟΣ`,
  where AutoCAD makes a second layer. `lint` and the builder now compare names
  as AutoCAD does. The README lists the pairs that differ.
- Fixed: two layers such as `ΟΔΟΣ` and `οδος`, which AutoCAD keeps apart but
  its `AUDIT` reports as a duplicate name, are now an error.
- Fixed: AutoCAD discarded a drawing whose layer name had a zero-width space,
  another invisible formatting character, a letterlike symbol such as the ohm
  sign U+2126, or a Glagolitic, Coptic, Tifinagh, Georgian Supplement, Latin
  Extended-C or Ethiopic Extended letter. Those names are now errors, in the
  compiler for a literal and when the code runs. The README lists them.
- Fixed: `lint` threw a `RangeError` on a polyline of about 100,000 points or
  more.
- Fixed: a layer name that starts or ends with a no-break space, or another
  space outside ASCII, threw when the code ran, though the compiler accepted
  the literal and AutoCAD accepts the name. Only an ASCII space is refused now.
- Fixed: AutoCAD replaced the private-use characters U+E800 to U+E8FF in text
  and layer names. They are now errors.
- Fixed: `toSVG` drew nothing for an arc so close to a full turn that its ends
  rounded to one point, and ignored a layer's color when an entity spelled the
  layer's name in another case.
- Changed: a `DrawingError` message starts "The drawing has 3 problems:" and no
  longer names DXF, because code other than `toDXF` uses it to refuse a drawing.
- Changed: `lint` messages for a bad radius or height read "radius: This value
  must be greater than 0", the wording the compiler uses for a literal.
- `lint` warns about a polyline or an arc with no length, as it does for a line,
  and about a line, polyline or arc that loses its length to rounding.
- `lint` warns about text that contains `%%`, which AutoCAD stores as written
  but draws as a control code: `%%d` is drawn as a degree sign.

## 0.2.0

0.1.1 was never published, so its changes ship here too.

- `createDrawing({ dxf: "R2018" })` targets AC1032, the DXF version AutoCAD has
  used since 2018. It writes handles, owner links, the standard tables, model
  and paper space blocks, plot styles and `$INSUNITS`. R12 stays the default.
  `toDXF(drawing)` writes the drawing's version, and
  `toDXF(drawing, { version })` writes another.
- Layer names, layer colors, radii, text heights and rectangle sizes written as
  literals are checked by the compiler. The same checks run when the code runs.
- `lint(drawing, { version })` returns every problem in a drawing. `toDXF`
  throws a `DrawingError` listing the errors instead of writing a file AutoCAD
  would reject.
- Fixed: AutoCAD discarded R12 drawings whose layer names had spaces, dots or
  other punctuation, or more than 31 characters. Those names are now errors in
  an R12 drawing and allowed in an R2018 drawing.
- Fixed: a layer name containing a line break wrote extra records into the
  file. Commas, carets and leading or trailing spaces are rejected too.
- Fixed: AutoCAD discarded any drawing with a `^` in its text. A caret is now
  escaped.
- Fixed: R12 text outside ASCII came out garbled. It is now written as
  `\U+XXXX` escapes.
- Fixed: arc angles outside 0 to 360 failed `AUDIT`. Angles are now stored from
  0 up to 360.
- Fixed: `wall` and `WALL` were two layers, and AutoCAD kept only the first.
  They are now one layer.
- Text with control characters, or with emoji and other characters above
  U+FFFF, is rejected, because AutoCAD cannot read it.
- Unknown units, and rectangle sizes of 0 or less, are rejected.
- Breaking: a `Drawing` now has a required `dxf` field, and R12 layer names
  AutoCAD rejects now throw (see above).
- Published from GitHub Actions through npm trusted publishing, with a
  provenance attestation linking the package to its source commit.
- `tsdraft/package.json` can be imported or resolved.
- The package now includes this changelog.

## 0.1.0

First release.

- `createDrawing()` builds a drawing with layers (AutoCAD Color Index colors),
  lines, polylines, rectangles, circles, arcs and single-line text.
- `toDXF()` writes ASCII DXF R12 (AC1009) with layer and linetype tables.
- `toSVG()` writes an SVG preview with model Y pointing up.
