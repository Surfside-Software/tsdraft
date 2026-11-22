# Transparency

An entity is opaque unless it has a transparency of its own. `transparency` takes three kinds of
value:

- A whole percent from 0 to 90, as CAD programs set it: 50 for half, not 0.5. 0 is opaque, and is
  kept apart from ByLayer.
- `"ByLayer"`, the default, which is left out of the drawing. A layer has no transparency in
  tsdraft, so an entity ByLayer is opaque.
- `"ByBlock"`, the transparency of the insert that places the entity's block.

```ts
const d = createDrawing({ units: "ft" });
d.layer("L-PLNT", { color: 3 }, () => {
  // The tree's canopy, half transparent over the walk beneath it.
  d.hatch(
    [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ],
    { transparency: 50 },
  );
});
```

Every entity but a table takes a transparency, as it takes a color. A table's grid plots opaque in
CAD programs, and the builder and `lint` refuse a transparency of its own. A wipeout fades, its
white and its frame alike. Transparencies are R2018 only: the builder and `lint` refuse one but
`"ByLayer"` in an R12 drawing, and anything else under the rule `entity-transparency`.

## ByBlock

An entity of a block set `"ByBlock"` takes the transparency of the insert that places the block,
and through an insert ByBlock inside another block the outer insert's. An insert's own transparency
fades only what its block sets ByBlock, as its color colors only that. An entity ByBlock outside
any block is opaque.

## A block a leader places

CAD programs hold every entity directly in a block a leader places in place of its note
transparent ByBlock, whatever it set, and drop a percent of its own. So the builder and `lint`
refuse a percent there, 0 too, under `entity-transparency`, and the writers write each of its
entities and attribute definitions ByBlock. An entity left ByLayer in such a block then fades
with any insert of the block, at the insert's transparency. The leader draws its block opaque,
whatever its own transparency. A block inserted inside it keeps what it sets, and its color is
untouched.

## How it plots

CAD programs plot transparency only where the page setup or the plot asks for it, and the page
setups tsdraft writes do not, so `toPDF` and `toSVG` draw every entity opaque by default, as those
programs plot the file. `plotTransparency: true` draws each entity at its transparency, as they plot
it when told to plot transparency always:

```ts
const pdf = toPDF(d.build(), { plotTransparency: true, deflate });
const svg = toSVG(d.build(), { layout: "L-101", plotTransparency: true });
```

Each entity is composed first and then faded, so where its parts overlap, a wide polyline's corners
or a dimension's arrowheads on its line, it is no darker. An arrowhead CAD programs draw from a
block, a dimension's architectural tick or oblique stroke and a leader's open or dot arrowhead,
plots opaque in a faded dimension or leader, as those programs plot it. `toSVG` puts each faded entity in a group
with an `opacity`, and `toPDF` makes it a transparency group.

## In the file

DXF group 440 holds a transparency, after the color's groups: `0x02000000` and the entity's opacity
from 0 to 255, `floor(255 * (100 - percent) / 100)`, or `0x01000000` for ByBlock, and nothing for
ByLayer. A dimension's picture holds every part transparent ByBlock, as CAD programs save one. A
drawing read back gives the opacity as `alpha`, as [Reading](reading.md) says.
