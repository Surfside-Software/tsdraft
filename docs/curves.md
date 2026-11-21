# Ellipses and splines

An ellipse is one entity, whole or an arc of it. A spline is a smooth curve: through fit points,
as a drafter draws the top of a bank, a tree line or a contour through located shots, or by its
control points, as a curve is given in another program. In the file each is the `ELLIPSE` or
`SPLINE` CAD programs hold, which a CAD user selects and edits as one.

Both are R2018 only. The builder and `lint` refuse them in an R12 drawing.

## Ellipses

`ellipse(center, majorAxis, ratio)` takes the vector from the center to one end of the major
axis, which gives the major radius and the direction, and the ratio of the minor radius to the
major, above 0 and at most 1:

```ts
d.ellipse([10, 5], [4, 0], 0.5); // 8 across, 4 high
d.ellipse([10, 5], [0, 3], 0.6, { startParameter: 0, endParameter: 180 }); // the left half
```

`startParameter` and `endParameter` make an arc of it, counterclockwise from one to the other,
in degrees, given together or not at all. A parameter is not the angle a point is at from the
center: the point at parameter `t` is `center + cos(t) * majorAxis + sin(t) * ratio * minor`,
where `minor` is `majorAxis` turned a quarter turn counterclockwise. They agree at multiples of 90
degrees; on an ellipse of ratio 0.5, parameter 45 is the point at about 26.6 degrees.
`ellipsePoint` gives a point at a parameter in radians. Parameters are stored from 0 up to 360,
so -90 becomes 270.

## Splines through fit points

`spline(fitPoints)` draws the cubic CAD programs' `SPLINE` fits through the points, with its knots
spaced by the chords between them:

```ts
d.spline([
  [-34, 146],
  [-28, 124],
  [-35, 98],
  [-27, 72],
]);
d.spline(
  [
    [0, 0],
    [10, 4],
    [20, 2],
  ],
  { startTangent: [0, 1], endTangent: [1, 0] },
);
d.spline(
  [
    [0, 10],
    [5, 14],
    [10, 10],
    [5, 6],
  ],
  { closed: true },
);
```

`startTangent` and `endTangent` are the directions it leaves its first point and reaches its
last in; where one is left out it is worked out from the points. `closed` runs it from the last
point back to the first, smooth through it, and takes no tangents. Two points with no tangent
give the straight line between them.

The file holds the fit points and the cubic through them: its knots and control points, which
`fitSpline` works out, and which the writers, the pictures and the extents all take from it. A
closed one holds its first point again at its end, with the direction it runs through it as both
tangents.

## Splines by their control points

`controlSpline(controlPoints)` draws a B-spline of `degree`, 3 unless given, from 1 to 11:

```ts
d.controlSpline([
  [0, 0],
  [5, 8],
  [10, 0],
  [15, 8],
]);
// A quarter circle, as a rational quadratic.
d.controlSpline(
  [
    [0, 0],
    [0, 5],
    [5, 5],
  ],
  { degree: 2, weights: [1, Math.SQRT1_2, 1] },
);
d.controlSpline(
  [
    [0, 0],
    [5, 8],
    [10, 0],
    [15, 8],
  ],
  { closed: true },
);
```

Its `knots` are as many as its control points and its degree together, and one more, none less
than the one before. Left out, they are clamped and uniform: the degree and one more of 0, then
1, 2 and on, and the degree and one more of the last, so the curve starts on its first control
point and ends on its last. `weights`, one for each control point and each above 0, make it
rational, which draws a circle or an ellipse exactly. `closed` makes it periodic, smooth where it
joins: without `knots`, its first `degree` control points come again at its end, with uniform
knots, so it closes on them.

CAD programs save every spline clamped at the ends of what it draws, so the writer writes one whose
knots are not clamped there, a closed one among them, as the same curve with clamped knots:
`clamped` gives that form.

## How it plots

`toSVG` and `toPDF` draw an ellipse as an ellipse and an arc of one as an elliptical arc, through
an insert's scale, turn and mirror too. A spline of degree 1 to 3 that is not rational is drawn
exactly, as lines or cubic pieces; a rational one, or one of a higher degree, as 32 straight steps
to each span of its knots.

A dash pattern runs along the whole curve as one stretch. An arc of an ellipse and an open spline
are fitted as a line is: as many whole patterns as fit, and the first and last dash each half of
the first dash and of what is left over. A whole ellipse and a closed spline hold the whole number
of patterns nearest their length, stretched alike to go round, from a dash at parameter 0, or at
the spline's start. A curve shorter than its pattern is solid.

The extents hold the curve itself, not its control points: an ellipse's are exact, and a spline's
within a ten-millionth of a unit of the curve, and never inside it.

## Checks

The builder refuses, and `lint` reports, under the rule `geometry`:

- an ellipse whose ratio is not above 0 and at most 1 as written, whose major axis is `[0, 0]` as
  written, with one parameter and not the other, or with parameters outside 0 up to 360 or equal as
  written;
- a spline through fewer than 2 fit points, or 3 when it is closed, or with two side by side, or
  the last and the first of a closed one, that are one as written; a tangent of `[0, 0]`, or any
  tangent on a closed one; or a fit whose control points come to 1e100 or more;
- a spline by its control points of a degree that is not a whole number from 1 to
  `SPLINE_DEGREE_MOST`, with fewer control points than its degree and one more, with knots that
  are not as many as its control points and its degree and one, that decrease, or that are all
  one over what it draws, as written, or with weights that are not one for each control point and
  each above 0 as written;
- more than `SPLINE_ITEMS`, 32,767, knots, which a file counts in 16 bits: a spline through fit
  points takes 6 more than its points, 7 when it is closed.

A literal the compiler can read is refused there too: a ratio of 0, of less or of more than 1, a
degree outside the range, fewer than 2 fit points or two the same side by side, a tangent of
`[0, 0]`, a tangent on a closed spline, and too few control points, the wrong count of knots or
of weights, or a weight of 0 or less, for a spline given as literals.

## Reading

`readDXF` with `geometry` reads an `ellipse` with its `center`, `majorAxis`, `ratio` and, for an
arc, its `startParameter` and `endParameter` in degrees, and a `spline` with its `degree`, `knots`,
`controlPoints` and `weights` as the file holds them, `closed`, `periodic`, and its `fitPoints`,
tangents and `fitTolerance` where it has them. [Reading a DXF](reading.md) has the rest.
