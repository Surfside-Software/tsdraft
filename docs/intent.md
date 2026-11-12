# Checks of intent

`lint` holds a drawing to the rules of its file. It cannot know what the drawing is meant to
show: that a house keeps out of its setbacks is a rule of the site, not of the file.
`checkIntent(drawing, intent)` checks a drawing against such rules, given as data beside it,
and returns warnings. It never changes what `lint` reports or what `toDXF` writes, and it
never throws on plain data. Its one check so far is setbacks.

## Setbacks

```ts
import { checkIntent, createDrawing, type Intent } from "tsdraft";

const d = createDrawing({ units: "ft" });
d.layer("C-PROP", { color: 7 }, () => d.rect([0, 0], 100, 140, { id: "lot" }));
d.layer("C-BLDG", { color: 5 }, () => d.rect([25, 15], 50, 40, { id: "house" }));
const drawing = d.build();

const intent: Intent = {
  setbacks: [{ property: "lot", footprints: ["house"], distance: [25, 7.5, 20, 7.5] }],
};

checkIntent(drawing, intent);
// [{ rule: "footprint-in-setback", side: 0, required: 25, provided: 15, id: "house", … }]
```

A setback names a property line and the footprints that keep out of it, by their ids. Each is
a closed polyline of model space, as `rect` and `polyline(points, true)` draw them. `distance`
is the setback in drawing units, the units the points are in, whatever `units` the drawing
names: one number for every side, or one for each side in the order of the property line's
points. The first side runs from the first point to the second, and the last from the last
point back to the first. A point that repeats the one before it, and a last point that repeats
the first, are the same corner and make no side. `rect` draws its corners counterclockwise from
the one it is given, so for a lot drawn from its front left corner the sides are the front, the
right side, the rear and the left side.

| Rule                     | Warns of                                                                |
| ------------------------ | ----------------------------------------------------------------------- |
| `footprint-in-setback`   | A footprint nearer a side of its property line than that side's setback |
| `footprint-off-property` | A footprint that is not wholly inside its property line                 |
| `intent-unchecked`       | Part of the intent that could not be checked, and why                   |

A footprint's distance from a side is the least distance from the side, from one corner of the
property line to the next, to the footprint's outline. So a footprint past the end of a side,
where the lot turns a corner, is measured to that corner and not to the line the side lies
on.

Distances are measured from the points as the drawing holds them, before the writers round
them to 6 decimals, and from the property line's first corner, so the arithmetic stays as
small as the lot however far it is from the origin. A footprint keeps a setback when it is no
nearer the side than the setback less a tolerance, and it is on its property line when it is
within the tolerance of it. The tolerance is 2^-44 of the largest coordinate of the property
line and the footprint, and never more than 0.0000005, half a unit of the sixth decimal, which
is as far as the writers' rounding moves a coordinate. So a footprint drawn on its setback line
passes at any angle, a footprint may touch a side whose setback is 0, and a footprint short of
its setback by more than the tolerance and twice the spacing of doubles at its distance from
the origin is warned of, even where the shortfall is below the sixth decimal. A point is held
only to the nearest double, and that spacing is how far apart doubles lie: 2^-26, about
0.000000015, at 100,000,000 drawing units from the origin, which is as far as this holds.
Farther out the spacing grows, and a shortfall a little past the tolerance may pass.

A footprint is inside its property line when every point of its outline is, so it may touch the
property line or run along it. A footprint whose side runs out of the lot and back through two
of the lot's corners, such as one that fills the corner an L-shaped lot lacks or bridges a
notch, is not inside, and nor is one that has a corner of the lot inside it. A footprint that
is not wholly inside gets `footprint-off-property` and no `footprint-in-setback`. A layer's
state does not matter: a footprint on a layer that is off is checked all the same.

A property line or a footprint must be simple: its sides meet only where one ends and the next
starts. One whose outline crosses or touches itself, or goes back to a corner it has passed, is
`intent-unchecked`, and so is not checked. So the check takes no lot with a hole, which can be
drawn only as one outline that touches itself. Whether two sides meet is worked out exactly
for the doubles the drawing holds, so a sharp corner whose sides come within a hair of each
other is a corner.

Both footprint warnings name the footprint by `entity`, its index in model space, with its
`id`, `layer` and `call`, and the property line by `other`. Every warning about a setback gives
`item`, the path of the setback in the intent, such as `setbacks[0]`. `footprint-in-setback`
gives a warning for each side the footprint is too near, with `side`, `required`, the side's
setback, `provided`, the distance measured, unrounded, and `bounds`, the box of the point of
the side and the point of the footprint nearest each other, larger on every side by the
setback. `footprint-off-property` gives the footprint's box as `bounds`.

`intent-unchecked` says what was not checked and why: a field the intent does not have, an id
that names no closed polyline of model space, an outline that is not simple, a distance that
is not a number of 0 or more, distances that are not one for each side, or more points than the
check takes. The rest of the intent is checked. An id is found whatever its case, as the
drawing compares ids, and an id named twice in one setback is checked once.

The work is bounded. Each outline is read once, however often the intent names it, and a call
does at most 4,000,000 steps of work. It counts one for each item of a list in the intent;
twenty for each point of an outline as it is read, checked, copied and filed, which keeps the
memory of a call to a few tens of megabytes; one for each side the search for sides that meet
looks at, one for each pair it finds, and 64 for each such pair it works out exactly; nine for
each pair of a footprint's point and its property line's as the two are checked; and two times
the property line's points for each piece beyond the first that its outline cuts a side of the
footprint into. So no outline of more than 200,000 points is read, and a property line is
checked in practice only well below that: one of about 60,000 points, round, takes the whole of
a call with a footprint of four corners. A footprint of many corners, or many footprints,
leaves room for fewer. Whatever of a setback would go past the steps left is one
`intent-unchecked` warning for the setback, which names the first part not checked, counts
the rest, and names what took the most of the work. A call gives at most 200 warnings, then
one more that says it stopped there.

## In the command

A drawing file that exports `intent` beside its drawing is checked on each build:

```ts
export default d.build();

export const intent: Intent = {
  setbacks: [{ property: "lot", footprints: ["house"], distance: [25, 7.5, 20, 7.5] }],
};
```

`tsdraft render` and `tsdraft dev` put the warnings in `diagnostics` after those of
`inspectText`, each with the `kind` of the entity it names, and `drawing.counts.warnings`
counts them. They never change the exit code. The page lists them with the other diagnostics,
and a click on one finds its footprint in the picture. A drawing loaded with a copy of tsdraft
from before `checkIntent` gets one `intent-unchecked` warning that says so, and so does one
whose copy throws, with the error's message.

The example sheet, [`examples/site-plan.ts`](../examples/site-plan.ts), exports the setbacks
its residence keeps out of, and has no such warning.
