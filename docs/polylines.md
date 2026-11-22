# Polylines

A polyline is one entity of sides, from each point to the next and, when it is closed, from the
last back to the first. A side is straight or an arc, and may be drawn wide. In the file it is an
`LWPOLYLINE`, which a CAD user selects, moves and edits as one.

Arcs and widths are R2018 only. The builder and `lint` refuse them in an R12 drawing.

## Arcs

A side is an arc by its bulge: the tangent of a quarter of the angle the arc turns through, 0 for
a straight side, 1 for a half circle, and greater than 0 when the arc turns counterclockwise,
which bulges it to the right of the way the side runs. `bulges` holds one for each side:

```ts
// A straight side, then a half circle that bulges below its chord.
d.polyline(
  [
    [0, 0],
    [10, 0],
    [20, 0],
  ],
  false,
  { bulges: [0, 1] },
);
```

`bulgeThrough(from, through, to)` gives the bulge of the arc from `from` to `to` that passes
through `through`:

```ts
const bulge = bulgeThrough([0, 0], [5, 2], [10, 0]);
d.polyline(
  [
    [0, 0],
    [10, 0],
  ],
  false,
  { bulges: [bulge] },
);
```

`radius` rounds each corner with an arc of that radius, tangent to both sides, as a bar's hook is
bent. The polyline then holds the arcs' ends in place of its corners, and an open one keeps its
two ends. `rect` takes `radius` for a rectangle with rounded corners. A radius whose arcs need
more of a side than the side has is refused.

```ts
// A bar's hook: a leg, the bend, and the tail, as one polyline as wide as the bar.
d.polyline(
  [
    [0, 0],
    [0, 12],
    [4, 12],
  ],
  false,
  { radius: 1.5, width: 0.625 },
);
d.rect([0, 0], 24, 12, { radius: 2 });
```

## Revision clouds

`cloud(outline, { arc })` draws a revision cloud along a closed outline: the corners of a
rectangle, or an outline drawn around what changed. It is one closed polyline of arcs from point
to point along each side, as many on a side as its length over `arc`, rounded and at least one.
Each arc turns through 110 degrees, as the arcs of the leading CAD app's own clouds do, and
bulges out of the outline. An arc of less than half a circle stays beside its own stretch of the
side, so the cloud never enters the outline at a corner: drawn around a note, the dimensions and
a window it marks, it crosses none of them. `arc` is a length in drawing units; in model space
under a standard, `view.paper(3 / 8)` gives arcs about 3/8 in long on the paper.

```ts
d.cloud(
  [
    [40, -15],
    [85, -15],
    [85, 28],
    [40, 28],
  ],
  { arc: plan.paper(3 / 8) },
);
```

No arc may cross the outline. In a notch narrower than an arc bulges, an arc on one wall would
reach the far one, and the cloud is refused: give a shorter arc. In a notch a little wider, the
arcs on its two walls may overlap each other while neither crosses the outline. A cloud has at most 10,000
arcs. Its outline needs three points or more and an area.

## Widths

`width` draws every side that wide, in drawing units, and `widths` gives each side its own width
at its start and at its end: one pair for each side. A polyline has one or the other.

```ts
// A duct heavier than any pen.
d.polyline(
  [
    [0, 0],
    [30, 0],
    [30, 20],
  ],
  false,
  { width: 2 },
);
// An arrowhead: one side that widens from nothing at its tip.
d.polyline(
  [
    [0, 0],
    [0, -1],
  ],
  false,
  { widths: [[0, 0.3]] },
);
```

`donut(center, outside, { inside })` draws a filled ring `outside` across with a hole `inside`
across: a closed polyline of two half circles, as wide as the ring. With no `inside` it is a
filled dot, such as a bar cut in a section.

## How it plots

The leading CAD app fills a side that has a width at either end, at that width whatever its pen,
and draws a side of width 0 with its pen. `toSVG`, `toPDF` and `tsdraft render` draw them the same
way:

- A wide side ends square. The width changes along a side from its start width to its end width,
  along an arc as well.
- Where two wide sides meet, two straight ones meet in a miter, with the edges of each carried to
  where they cross, unless the turn is more than 151.04 degrees, the miter's corner then lying
  more than twice the width from the point; both then end square. A straight side and an arc meet
  along the line from the arc's center through the point, unless the tangent of the turn is more
  than 4. Two arcs each end square, on the line from their center.
- A dashed wide side is cut into its dashes as a line is, each dash filled and square at both
  ends, with no joins. The dashes of a wide arc are fitted along its outer edge, at the larger of
  its widths.
- An insert or a viewport scales a width with the rest of what it draws.

`polylineBox(e)` is the box a polyline covers: its points, the arcs of its sides and its wide sides
with their joins. The extents and the view a file opens on take it.

## Checks

`lint` refuses a list of bulges or widths that is not a list, or holds what is not a number or a
pair of numbers, as `format`, as it refuses any field of the wrong type. It refuses, as
`geometry`:

- A list of bulges or widths that does not have one for each side: a closed polyline has a side
  for each point, and an open one a side fewer.
- A bulge or a width that is not a finite number, or is 1e100 or more.
- A width less than 0. The leading CAD app reads a negative width of every side as 0, and keeps a
  negative width of one side with no `AUDIT` error.
- A width and widths for each side together.
- Either in an R12 drawing.

`checkIntent` takes only outlines of straight sides, and leaves a property line or a footprint
with an arc unchecked, with an `intent-unchecked` warning.
