# Points

A point marks a location, such as a survey shot, a benchmark or a control point. Every point of
a drawing plots as the same figure, which the drawing's point style gives: CAD programs keep it in
the file as `$PDMODE` and `$PDSIZE`.

```ts
const d = createDrawing({ pointStyle: { figure: "cross", circle: true, size: 0.25 } });
d.point([10, 5]);
d.point([12, 5], { rotation: 30 });
```

Points are R2018 only.

## The point style

`pointStyle` takes a `figure`: `"dot"`, `"none"`, `"plus"`, `"cross"` (a ×) or `"tick"` (a short
line up from the point). `circle` and `square` draw a circle and a square around it. A drawing
with no point style plots each point as a dot, as CAD programs do.

`size` is how far an arm of the + or the × reaches from the point. The tick is half as long, and
the circle and the square are as wide as the size. It is either:

- a number, in drawing units. In a block it is scaled with the insert, as the block's lines are.
- `{ percent }`, a share of half the height of the view the point is seen in: the sheet's height on
  a layout, the view's height in model space through a viewport, and the picture's height in a
  picture of model space. Under an insert it is not scaled, but it is turned, mirrored and skewed
  with the insert. A point style with no size is `{ percent: 5 }`.

## A point

`point(at, { rotation })` turns the figure by `rotation` degrees counterclockwise, brought into 0
up to 360. A point is the entity `{ kind: "point", layer, at, rotation? }`, with the `linetype` and
`lineweight` of every entity.

## How it plots

The figure plots in the thinnest line the printer draws, solid, whatever the point's lineweight
and linetype: the circle first, then the square, then the dot, +, × or tick. A dot is a stroke of
no length at the point. A point drawn as a dot alone, in model space seen through a viewport,
plots a device pixel wide, 1/600 inch, as CAD programs plot it.

The extents count a point at its location, not its figure, since a relative figure's size takes
the view the extents give.

## Reading

`readDXF` reads a point as `{ kind: "point", at, rotation? }`, and the header's `pdmode` and
`pdsize` as the file holds them. `pointStyleOf(pdmode, pdsize)` gives the point style they plot
as: a mode CAD programs do not offer plots as a dot, and a size of 0 as `{ percent: 5 }`.

## Checks

`lint` refuses a point style whose figure is not one of the five, whose `circle` or `square` is
not true or false, or whose size or percent is not above 0, is written as 0, or is 1e100 or more;
a point whose location is not finite, or whose rotation is not from 0 up to 360; and a point or a
point style in an R12 drawing.
