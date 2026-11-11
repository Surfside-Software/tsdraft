# Examples

Each example builds a drawing and writes it to `examples/out/` as an AutoCAD
2018 DXF and an SVG. `pnpm example` runs both. The pictures here are the SVGs
restyled by `pnpm readme:drawing`, which gives each layer a color and keeps the
lineweights the drawing sets.

## Outdoor kitchen

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../docs/assets/outdoor-kitchen-dark.svg">
  <img src="../docs/assets/outdoor-kitchen-light.svg" alt="An elevation of an outdoor kitchen wall with a refrigerator, a gas grill under a vent hood and a sink below a window, beside a wall section through the grill from the footing to the attic" width="100%">
</picture>

An elevation of an outdoor kitchen wall and a wall section through its grill,
at 3/8" = 1'-0". The section runs from the footing and its reinforcing, through
the masonry wall and the cabinet, to the hood's duct, the ceilings and the
insulation above them. The wall, the counter and the run of cabinets are
parameters at the top of [`outdoor-kitchen.ts`](outdoor-kitchen.ts), and every
position, dimension and size in a note is worked out from them. Change the
grill from 36 to 42 inches and the cabinets move, the dimensions change and the
note says 42".

```sh
node examples/outdoor-kitchen.ts
```

The dimensions, leaders, stucco stipple, hatching, earth, insulation, dashed
lines, break lines and view titles come from [`lib/drafting.ts`](lib/drafting.ts).
Each function takes the drawing builder and draws lines, polylines, circles,
arcs and text, so a CAD program opens the result as plain geometry.

## Site plan

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../docs/assets/site-plan-dark.svg">
  <img src="../docs/assets/site-plan-light.svg" alt="A permit-style site plan at 1 inch to 10 feet: a lot with its bearings, setback lines, a building footprint with dimension strings, a driveway, a sidewalk, trees and the street, beside site data, general notes and a legend, above a view title, a graphic scale and a north arrow" width="100%">
</picture>

The example sheet: a permit-style site plan for an ARCH D sheet, 36 by 24
inches, at 1" = 10'. It draws the lot from its plat dimensions, with the
setbacks, the building footprint, the driveway and the street, then the labels,
dimension strings, site data, notes and legend. It is the file to copy to start
a drawing. The parameters are at the top of [`site-plan.ts`](site-plan.ts),
each layer sets a linetype and a pen weight. The site is in feet, and every
text height, annotation offset and panel size, and the linetype scale, come
from `fromPaper`, as a plotted size at the one ratio the file names. Change the
ratio from 120 to 240 and the annotation keeps its plotted size around a plan
half as large. There is no
border or title block yet, because tsdraft has no paper space.

The file's default export is the drawing, and it writes its DXF and SVG only
when it is run:

```sh
node examples/site-plan.ts
```
