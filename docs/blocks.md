# Blocks, inserts and attributes

A block is a set of entities drawn once, under a name. An insert places a block at a point,
scaled and turned, as many times as the drawing needs it. An attribute is a text of a block
that each insert carries with a value of its own, which a drafter can edit in CAD. Blocks are
written to R2018 drawings only.

```ts
const d = createDrawing({ units: "ft" });
d.layer("L-PLNT", { color: 3 });

d.block("TREE", {}, () => {
  d.circle([0, 0], 1);
  d.line([-0.15, 0], [0.15, 0]);
  d.attribute("TAG", [0, 1.2], { value: "T-0", prompt: "Tree tag", height: 0.3, align: "center" });
});

d.layer("L-PLNT", {}, () => {
  d.insert("TREE", [15, 112], { scale: 5, attributes: { TAG: "T-1" }, id: "tree-1" });
  d.insert("TREE", [50, 130], { scale: [6, 5], rotation: 30 });
});
```

An insert also places an xref, a DWG file the drawing references: see [Xrefs](xrefs.md). A
block is inserted in model space, in another block and on a [layout](layouts.md) alike, and a
sheet's title block is a block with an attribute for each field: see
[Title blocks](title-blocks.md).

## Defining a block

`d.block(name, options, draw)` defines a block. What `draw` draws goes in the block and not in
the drawing, in the block's own coordinates. `options.base` is the point of the block that an
insert puts at its own point, `[0, 0]` unless given.

- A block holds every kind of entity, and inserts of blocks defined before it.
- A block is defined once. It cannot be defined inside another block.
- When `draw` throws, the block is not defined, and its name, its ids and what it drew are
  free again. A layer, a linetype, a text style or an xref that `draw` defined stays, as it
  belongs to the drawing.
- Inside `draw` the current layer starts as `0`, and `layer()` puts entities on a layer of
  their own, as it does anywhere.

## Layers in a block

An entity of a block keeps its layer, with one exception: layer `0` stands for the layer of
the insert. AutoCAD draws an entity on layer `0` of a block in the color, linetype and
lineweight of the layer its insert is on, and an entity on any other layer in that layer's
own. The rule holds through inserts inside blocks: an insert on layer `0` of a block passes
on the layer of the insert outside it.

- An insert on a layer that is off hides what its block holds on layer `0`. The entities on
  other layers still draw.
- An insert on a frozen layer hides everything its block holds, and an insert on a layer that
  does not plot plots none of it.
- An attribute is stored on its definition's layer. AutoCAD's `INSERT` leaves an attribute
  on layer `0` when its definition is there, and draws it as the insert's layer draws.
- An entity whose linetype or lineweight is `"ByBlock"` takes its insert's, which is the
  insert's layer's.

## Attributes

`d.attribute(tag, at, options)` adds an attribute definition to the block being drawn. It is
placed, sized and justified as `text()` places a text: `height`, `rotation`, `style`, `align`
and `valign`. `value` is the default, and `prompt` is what CAD asks when someone inserts the
block by hand.

An insert sets values by tag in `attributes`. An attribute it does not set has its definition's
default. Each insert carries one attribute for every definition of its block.

An attribute stays a field in CAD, in model space and on a layout: AutoCAD's `-ATTEDIT`
command changes its value, and the drawing keeps the new value when it is saved.

## Inserting a block

`d.insert(block, at, options)` places a block with its base point at `at`, on the current
layer.

- `scale` is one number for both axes, or `[x, y]`. A negative scale mirrors the block.
- `rotation` is in degrees counterclockwise, about `at`.
- `id` names the insert, as it names any entity.
- `attributes` holds a value for each tag to set.

AutoCAD holds each attribute of an insert as a text of its own, with the height, rotation,
width factor and oblique angle that the insert's scale and rotation give the definition's.
`placeAttribute(definition, style, insert, base)` returns that text. An insert that scales its
block unevenly widens or narrows each attribute and slants it, and is refused when the result
is slanted by more than 85 degrees or has a width factor outside 0.01 to 100. The numbers
are worked out from the insert, the block and the definition as the file holds them, with 6
decimals.

## Names

A block name follows the rules of layer names, and is at most 255 characters.

AutoCAD takes two block names for one more readily than it does two layer names. `TREE` and
`tree` are one block, and so are `straße` and `strasse`, and a composed `é` and a decomposed
one: every pair of names that [`AUDIT` reports as duplicates](layer-names.md) among layers.
Given two such blocks, AutoCAD keeps one, puts the entities of both in it, and reports
nothing. So the second is an error.

An insert finds its block as an entity finds its layer: `tree` finds `TREE`.
`findBlock(drawing, name)` returns the block an insert of a name places. It does not find
`straße` by `strasse`, though AutoCAD would. Name a block as the drawing spells it.

`lint` follows the kinds of pair [Layer names](layer-names.md) lists, which are not all that
AutoCAD takes for one. Two block names that differ only in a letter added to Unicode after
about 2008, such as `Ԥ`, U+0524, are one block to AutoCAD and two to `lint`.

## Handles

In an R2018 drawing the objects of a block take their handles from names, as an entity takes
its handle from its id, so they keep them when the drawing around them changes:

- A block's record, from the block's name: `blockHandle(name)`. The two objects that open
  and close its definition in a DXF take theirs from the name too.
- An attribute definition, from its block's name and its tag:
  `attributeDefinitionHandle(block, tag)`.
- An entity in a block that has an id, and an insert that has an id, from the id:
  `idHandle(id)`.
- The attributes of an insert that has an id, from the id and each tag:
  `attributeHandle(id, tag)`. `attributesEndHandle(id)` is the handle of the object that
  closes an insert's attributes.

An entity in a block, an insert and an insert's attributes without an id are counted, as any
entity without an id is. Ids are unique across the whole drawing, in blocks and out of them.

Each handle is worked out as an id's is, from a key that no id can be:
`block:NAME`, `block-begin:NAME`, `block-end:NAME`, `attdef:NAME/TAG`, `attrib:ID/TAG` and
`attrib-end:ID`. `NAME` is the block's name with A to Z in lower case and nothing else
changed, so `TREE` and `tree` give one handle. Changing the case of any other letter of a
name gives the block other handles, as renaming it does. `TAG` is the tag as written, and
`ID` is the id in lower case. The key is hashed as its UTF-8 bytes. Two names that give one
handle are refused under the rule `id-handle`, as two ids are. Each function throws a
`RangeError` for a name, a tag or an id the rules refuse.

A drawing that has a block has a `$HANDSEED` of `20000000000000`, as one that has an id does.

## The preview

`toSVG` draws an insert as a group, `<g data-entity data-layer data-block>`, with an element
for each entity its block draws, where the insert puts it, and a text for each attribute with
the insert's value. Each element has the layer it draws on in `data-layer`. A circle under an
uneven scale is an ellipse, a dash pattern scales with its insert, and the extents take in
what every insert draws.
