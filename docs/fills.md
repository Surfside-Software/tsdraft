# Fills, wipeouts and masks

A solid fill is a hatch: an area filled in its pen's color, which CAD programs hold as one entity a
drafter selects, edits and measures as one. Wall poché, filled arrowheads, bar dots and the filled
parts of symbols are hatches. A hatch with a pattern draws the pattern's lines inside its loops
instead, as for concrete, earth or brick, and a hatch with a gradient runs from one color to
another, as for a sky or a shaded roof. A wipeout is a polygon filled with the paper's color, which hides
what is drawn before it. A mask hides what is drawn before a text, behind the text's box: a
paragraph, a leader's note and a dimension's text each take one.

Hatches, wipeouts and masks are R2018 only. The builder and `lint` refuse one in an R12 drawing.

## Hatches

`d.hatch(boundary)` fills the area inside one outline, or inside a list of loops. A loop is
`{ points, bulges? }`: its points in order, closed back to the first, and a bulge for each side,
as a closed polyline's are, so a side can be an arc. The area inside an odd number of loops is
filled. A loop inside another is a hole, and a loop inside a hole fills again:

```ts
const d = createDrawing({ units: "in" });
d.layer("A-WALL-PATT", { color: 8 }, () => {
  // A wall 8 inches thick with a window cut out of it.
  d.hatch([
    {
      points: [
        [0, 0],
        [96, 0],
        [96, 8],
        [0, 8],
      ],
    },
    {
      points: [
        [36, 0],
        [72, 0],
        [72, 8],
        [36, 8],
      ],
    },
  ]);
  // A dot, a circle of two half-circle sides.
  d.hatch([
    {
      points: [
        [100, 4],
        [101, 4],
      ],
      bulges: [1, 1],
    },
  ]);
});
```

The loops may come in any order and run either way round, and they may cross: CAD programs fill
by the parity of the loops around each point, and tsdraft writes every hatch so that they do.
Two loops that overlap leave their overlap empty, and the same loop twice fills nothing.

A loop needs at least 3 points, or 2 joined by an arc. `lint` refuses a hatch with no loop, a
loop of fewer points, and a list of bulges that does not have one for each side.

A hatch is filled in its layer's color, with no outline whatever its lineweight. Draw its boundary
as a polyline of its own where the sheet shows one. In a block, an insert's scale and rotation place a hatch as they place the rest of the
block, and a negative scale mirrors it.

A hatch can also be filled with a gradient: see [Gradients](#gradients).

## Patterns

A hatch with a `pattern` draws a pattern's lines in its pen in place of the solid fill. tsdraft has
no patterns of its own: a firm's patterns are its pattern file, the `.pat` file CAD programs read.
`parsePatterns(text)` reads one into `HatchPattern`s, and `d.patterns()` adds them to the drawing,
from the file's text or a list of definitions. A hatch then names one, whatever the case of its
letters, as a layer names a linetype:

```ts
import { readFileSync } from "node:fs";

const d = createDrawing({ units: "in" });
d.patterns(readFileSync("firm.pat", "utf8"));
d.layer("A-WALL-PATT", { color: 8 }, () =>
  d.hatch(
    [
      [0, 0],
      [96, 0],
      [96, 8],
      [0, 8],
    ],
    { pattern: { name: "AR-CONC", scale: 0.5, angle: 45, origin: [0, 0] } },
  ),
);
```

`scale` multiplies every length of the pattern, `angle` turns it, in degrees counterclockwise, and
`origin` is the point its lines start from; they are 1, 0 and `[0, 0]` unless given. A pattern of
a name the drawing has replaces it and keeps the first spelling, as `linetype()` does, and of two
of one name in one call the first is added, as CAD programs read a pattern file. A drawing written
by hand holds its patterns in `Drawing.patterns`, and a hatch takes the first of a name.

A pattern is families of parallel lines. In a pattern file a pattern starts at a line
`*NAME, description`, and each line after it is `angle, x, y, dx, dy` and its dashes: the family's
line runs through the base point `x, y` at `angle`, the next line of the family lies `dx` along it
and `dy` across it, and its dashes repeat along it from the base point, a positive length drawn, a
negative one left out and 0 a dot. A `;` starts a comment. A `HatchPattern` holds the same,
`{ name, description?, lines }`, with each line `{ angle, base, offset, dashes? }` and no dashes for
a solid line.

Lines of the hatch's own need no pattern: `{ spacing, angle?, crossed?, origin? }` draws lines
`spacing` apart at `angle`, and with `crossed: true` as many more square to them:

```ts
d.hatch(slab, { pattern: { spacing: 0.25, angle: 45, crossed: true } });
```

`lint` and the builder refuse a hatch that names a pattern the drawing does not have, a `scale` or
`spacing` not greater than 0 or written as 0, a `name` and a `spacing` together, and `crossed` with
a name. They refuse a pattern whose name breaks the rules of a linetype's name, with no line or more
than 32,767, a line whose offset across it rounds to 0 at 6 decimals, more than 32,767 dashes on a
line or dashes all 0, and two patterns of one name. A hatch whose pattern would draw more than
1,000,000 lines across the box of its loops is refused, as is one whose lines, scaled, turned and
moved to its origin, hold a number of 1e100 or more: give it a larger scale or spacing.

`toSVG` and `toPDF` draw the lines cut to the loops, inside an odd number of them as a solid hatch
is filled, as the leading CAD app plots them. Each line's dashes count from its base point, a dot
is a round end of no length, and where a line runs along a side of a loop the side is drawn alone.

`readDXF` and `readDWG` read a hatch's pattern back: `pattern` is its name, `_U` for lines of its
own, `patternType` is 0 for lines of its own, 1 for a pattern CAD programs ship and 2 for one of a
file, and `patternAngle`, `patternScale`, the spacing of lines of its own, and `crossed` are as the
file holds them. `patternLines` holds each line as the file holds it, placed in the drawing: its
angle with the pattern's added, its base point scaled, turned and moved to the origin, its offset
scaled and turned to the line, and its dashes scaled. A firm's patterns can be read back from its
drawings this way.

## Gradients

A hatch with a `gradient` is filled from one color to another in place of its pen's color: a
sky behind an elevation, a shaded roof or a lawn on a site plan. Each color is a true color,
`[red, green, blue]`, each a whole number from 0 to 255. Give two colors, or one color and its
`tint`, from 0 for black to 1 for white, which gives the second as the color with its lightness set
to the tint, as CAD programs do:

```ts
const d = createDrawing({ units: "ft" });
d.hatch(
  [
    [0, 10],
    [40, 10],
    [40, 20],
    [0, 20],
  ],
  {
    gradient: {
      name: "linear",
      angle: 90,
      colors: [
        [255, 255, 255],
        [30, 120, 200],
      ],
    },
  },
);
d.hatch(
  [
    [0, 0],
    [40, 0],
    [40, 8],
    [0, 8],
  ],
  { gradient: { name: "spherical", color: [60, 160, 60], tint: 0.8 } },
);
```

`name` is one of nine. `linear` runs from the first color to the second across the box of the
loops. `cylinder` runs from the first color at both sides to the second along the middle.
`spherical` runs from a spot of the second color out to the first, `hemispherical` from a spot half
the box's larger side below its middle, and `curved` from an oval along the bottom. Each `inverted-` name,
`inverted-cylinder`, `inverted-spherical`, `inverted-hemispherical` and `inverted-curved`, swaps its
pair's colors. `angle` turns the gradient about the middle of the box, in degrees counterclockwise,
and `centered: false` moves it off the middle, in the gradient's own directions before `angle` turns
it: a linear gradient or a cylinder then reaches half way at 0.3 of the way across, a spherical spot
moves left and up by a quarter of the box's larger side, a hemispherical one left by half of it, and
a curved oval left by a quarter of the box's width. They are 0 and `true` unless given.

A gradient is worked out on the box of the loops, its arcs at their full extent, as CAD programs
work it out. At an angle that is not a quarter turn, a linear, cylinder or curved gradient spans the
box turned back by the angle; a spot keeps the size of the box's larger side, and the turned box's
at an odd multiple of 45 degrees. A box with no width or height draws nothing.

A gradient plots in its own colors whatever the plot style table, `monochrome.ctb` included: `toSVG`
and `toPDF` draw it so. `toSVG` fills the loops with a `linearGradient` or a `radialGradient` and
`toPDF` with a shading, each with enough colors along a curve that it strays less than a level from
the gradient. The leading CAD app plots a gradient as a picture made of triangles between points it
chooses, so its colors stray from the gradient's between them, a few levels for most gradients and
more where a spot meets the corner of a box turned at an angle that is not a quarter turn.

A file cannot hold pure black as a gradient's color: the leading CAD app reads it as no color and
takes another in its place. tsdraft writes black as `[0, 0, 1]`, and draws it so.

`lint` and the builder refuse a gradient with a pattern, a name not of the nine, a field it does not
know, a color that is not three whole numbers from 0 to 255, a tint outside 0 to 1, two colors with
a tint, and an angle that is not a finite number under 1e100. A literal one of these is a compile
error, but for an angle of `NaN` or `Infinity`, which TypeScript types as any number.

`readDXF` and `readDWG` read a hatch's gradient back as `gradient`: its `name` as the file holds
it, such as `LINEAR` or `INVSPHERICAL`, its `angle` in degrees, `centered`, the first two `colors`,
each `0xRRGGBB`, and for one color its `tint`, as single precision holds it.

## Wipeouts

`d.wipeout(points)` draws a polygon of three or more corners in the paper's color, which hides
what is drawn before it and is hidden by what is drawn after:

```ts
d.layer("A-ANNO-WIPE", { color: 7 }, () =>
  d.wipeout([
    [2, 2],
    [5, 2],
    [5, 3],
    [2, 3],
  ]),
);
```

Its frame, the polygon drawn in its pen, shows and plots unless `Drawing.wipeoutFrame` is `false`.
It is one setting for every wipeout of the drawing, as CAD programs hold it. A sheet whose
wipeouts are masks behind notes wants it `false`.

`lint` refuses a wipeout of fewer than 3 points, one whose points lie on one line once rounded to
the 6 decimals tsdraft writes, and one whose sides cross: CAD programs hide nothing behind one of
those. The points may end with the first again.

## Masks

A paragraph's `mask` and a leader's `mask` are a `TextMask`: `true` for the drawing's background,
or `{ color?, offsetFactor? }` for a color index of its own, 1 to 256, where 256 is the layer's,
and the factor of the text height the box grows by. A mask is the text's box grown by the factor
less one times the text's height on each side, 1.5 unless given, from 1 to 5. A paragraph in
columns takes no mask yet. Here a note hides the lines behind it:

```ts
d.paragraph("VERIFY ALL DIMENSIONS IN THE FIELD", {
  at: [1, 6],
  width: 2.5,
  height: 0.1,
  mask: true,
});
```

A paragraph's box is as wide as its width, or its widest line where a word reaches past the
width, and as high as its lines. A leader's mask covers its note's box.

A dimension style's `textMask` masks the text of every dimension in the style: `true` for the
drawing's background, or `{ color }`. Its box grows by a quarter of the text's height each side,
as CAD programs grow a dimension's.

A mask hides what is drawn before its text and nothing drawn after it. The preview draws a mask
in the background's color in white and marks it `data-mask="background"`.

## Draw order

What a drawing draws later is drawn over what it draws earlier: entities draw in the order of
their list, model space's, a layout's or a block's. So draw a fill before the lines over it, and
a wipeout after what it hides and before the note on it. A file a CAD program saved may hold a
sort table that draws its entities in another order: [reading](reading.md) has the order it
gives, `drawOrder`.

## In the file

A hatch is a `HATCH` of the pattern `SOLID`, with island detection normal and each loop a
polyline path. A hatch with a pattern holds its lines instead: group 2 its pattern's name, or `_U`
for lines of its own, 70 0, 76 its type, 2 for a pattern of the drawing's and 0 for lines of its
own, 52 its angle, 41 its scale or its spacing, 77 1 where its lines are crossed, and 78 the
number of its lines. Each line follows, placed in the drawing: 53 its angle, 43 and 44 its base
point, 45 and 46 its offset, 79 the number of its dashes and a 49 for each dash, with 15
significant digits. A gradient is groups 450 to 470 after the seed point: 450 1, 451 0, 460 its angle in radians
with 15 significant digits, 461 0 when centered and 1 when not, 452 1 for one color, 462 its tint,
or 1 for two colors, 453 2, then for each color 463 0 or 1, 63 the index nearest it and 421 the
color, and 470 its name in capitals with no hyphen, such as `INVSPHERICAL`. For one color the second
is the color its tint gives. A wipeout is a `WIPEOUT`, a square picture of one pixel clipped by its
polygon, and
the drawing holds `WIPEOUTVARIABLES` and the dictionary variable `WIPEOUTFRAME`, which is what CAD
programs read of whether frames show. A mask is the background of an `MTEXT`, and a dimension
style's is its `DIMTFILL` and `DIMTFILLCLR` and the background of the `MTEXT` of its picture.
