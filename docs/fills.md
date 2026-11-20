# Fills, wipeouts and masks

A solid fill is a hatch: an area filled in its pen's color, which CAD programs hold as one entity a
drafter selects, edits and measures as one. Wall poché, filled arrowheads, bar dots and the filled
parts of symbols are hatches. A wipeout is a polygon filled with the paper's color, which hides
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

Hatch patterns, a firm's own pattern file and gradients come later. A hatch today is solid.

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
polyline path. A wipeout is a `WIPEOUT`, a square picture of one pixel clipped by its polygon, and
the drawing holds `WIPEOUTVARIABLES` and the dictionary variable `WIPEOUTFRAME`, which is what CAD
programs read of whether frames show. A mask is the background of an `MTEXT`, and a dimension
style's is its `DIMTFILL` and `DIMTFILLCLR` and the background of the `MTEXT` of its picture.
