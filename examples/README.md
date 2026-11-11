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
  <img src="../docs/assets/site-plan-light.svg" alt="A landscape sheet, 3 wide to 2 tall, inside a border. At the left, a permit-style site plan at 1 inch to 10 feet: a lot with its bearings, setback lines, a building footprint with dimension strings, a driveway, a sidewalk, trees and the street, with a north arrow, the view title and a graphic scale under it. At the right, a column of site data, general notes, a legend and abbreviations, and in the lower right corner a title block with the project, the sheet title, the date, the scale and the sheet number C-101" width="100%">
</picture>

The example sheet: a permit-style site plan on an ARCH D sheet, 36 by 24 inches,
at 1" = 10'. It is the file to copy to start a drawing.

[`site-plan.ts`](site-plan.ts) keeps two spaces, as a drafter does:

- **Model space** holds the site at its true size, in feet: the lot from its
  plat dimensions, the setbacks, the building footprint, the driveway, the
  street and the trees. The annotation that is read in the plan is there too:
  bearings and distances, dimension strings and labels. Each is sized by how
  large it plots, with `fromPaper` for the viewport's ratio.
- **The layout `C-101`** holds the sheet, in inches of paper: the border, the
  title block, a column of site data, general notes, a legend and
  abbreviations, and under the plan the north arrow, the view's title and a
  graphic scale. A text there has the height it plots at.

One viewport shows the plan on the layout at the ratio. It is on a layer that
does not plot, so its border stays off the page. AutoCAD opens the file on the
sheet and plots it at 1" = 10' on a page 36 by 24 inches.

Where a thing could go either way, the example puts it with what it belongs
to. The north arrow and the graphic scale describe a view, not the site, so
they are on the sheet beside the view's title, and the scale is numbered from
the viewport's ratio. The legend is part of the sheet. Its lines are drawn on
the plan's own layers, and its dashes are as long as the plan's, because
AutoCAD sizes dashes on the paper in a viewport and on the sheet alike. The
street and the adjoining lot lines are part of the site: they run to the sides
of what the viewport shows, where it cuts them off.

The sheet is laid out from its parameters, in inches: the border half an inch
inside the paper, the viewport in the left 27 inches of the drawing area above
a strip for the view's title, a column 7 inches wide for the notes, and the
title block at its foot, 6 1/2 by 3 inches in the lower right corner. The
paper is full bleed, and the border is still inside it: AutoCAD plots a line
on the left, bottom or right edge of the paper with half its width off the
page, and does not plot a line on the top edge.

The border and the title block are one block, `TITLE BLOCK`, which the
function `titleBlock` draws for the sheet's size. Its fields are attributes:
the project, the sheet's title and number, the date, the scale, and who drew
and checked it. It also has a table for revisions and an area for a seal. The
insert on the layout gives each field its value, and in CAD each stays an
attribute. `titleBlock` reads its arguments and the constant `TITLE_BLOCK`
beside it, so the two can be copied by themselves. The view title's
attributes have tags of their own, `VIEW_TITLE` and `VIEW_SCALE`, so no tag
names two fields. [Title blocks](../docs/title-blocks.md)
has more, and the way to use a firm's own border.

The trees, the property corners, the north arrow and the view title are blocks
too. The tree and the property corner are in the plan and in the legend, so
each is inserted in model space and on the layout: the tree at each tree's
radius in the plan and at 3/16 inch in the legend.

Each layer sets a linetype and a pen weight. The linetype scale is a length of
paper, 1/2. Change the ratio from 120 to 240 and nothing on the sheet moves:
the plan is half as large in its viewport, and its text keeps its plotted
height. The sheet holds the plan at 1" = 10' and at 1" = 20'. At a larger
scale, such as 1" = 8', the plan is taller than its viewport.

The picture is the layout, as `toSVG(drawing, { layout: "C-101" })` draws the
sheet, in the page's colors. `sitePlan(ratio)` builds the sheet at a ratio and
returns the drawing with where its parts lie: `drawingArea`, `titleBlock`, the
box of each of its `fields` and the `viewport` on the paper, in inches, and
`view`, the part of model space the viewport shows. A test builds it at 120
and at 240. It holds model space inside the view, the sheet inside the border,
everything but the title block out of the title block's space and off the
viewport, the texts of each space off one another, and each field inside its
box.

The file's default export is the drawing, and it writes its DXF, the SVG of
model space and the SVG of the sheet only when it is run:

```sh
node examples/site-plan.ts
```
