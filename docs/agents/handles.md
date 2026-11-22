# Handles, blocks and xrefs

Rules for agents who change handles from ids and names, blocks, inserts, attributes or xrefs.
[AGENTS.md](../../AGENTS.md) has the rules that hold for every change.

- An entity with an id takes the handle `idHandle` in `src/handles.ts` gives the id, from
  2^52 up to 2^53, and a drawing that has ids has a `$HANDSEED` of 2^53. Every other object
  is counted up from 1. Another drawing that dimensions the entity through an xref holds that
  handle, so never change what `idHandle` returns for an id, nor `idKey`, which it hashes:
  every such dimension would come loose, and the leading CAD app would report nothing.
- The range from 2^52 to 2^53 is for every handle that comes from a name, not only an
  entity's id. Another kind of object, such as a block, hashes its key with a prefix that no
  id can contain, such as `block:NAME`, since an id cannot hold `:` or `/`. It hashes into
  the same range, and two keys that give one handle are refused as two ids are. A key that can
  hold characters outside ASCII, as a block's name can, is hashed as its UTF-8 bytes. A
  counted handle cannot reach 2^52, because a drawing cannot hold that many objects. Nothing
  uses the handles from 2^32 up to 2^52. Keep them for a later scheme.
- `src/blocks.ts` holds the keys of the handles blocks need: a block's record and the two
  objects of its definition from its name, an attribute definition from its block and tag, and
  the attributes of an insert that has an id from the id and each tag. Never change a key, or
  `keyHandle`, which hashes it. A key holds a name with A to Z in lower case and a tag as
  written. Neither `layerKey` nor any table that can grow may be part of a key, because a
  change to the table would move every handle it touches. An insert without an id and its
  attributes are counted.
- The leading CAD app takes two block names for one wherever its `AUDIT` would call two layer names
  duplicates, and merges the two blocks without a word. So a second block is refused by
  `layerAuditKey`, and an insert finds its block by `layerKey`.
- An entity on layer `0` of a block draws as its insert's layer does. `eachDrawn` in
  `src/blocks.ts` walks what an insert draws, with the layer and the matrix of each entity,
  for `toSVG` and `inspectText`. It keeps its own stack, so a chain of any depth is walked,
  does not enter an insert on a frozen layer, reads each list up to its first empty slot, and
  asks `spend` before each block it enters and each item it reads. The extents never walk an
  entity of a block: `boxer` in `src/extents.ts` keeps the box of each block's own entities, in
  the block's coordinates, worked out once for each drawing it is in and whether its layer `0`
  is hidden. A placement walks the blocks it inserts, with their matrices composed as
  `eachDrawn` composes them, and maps the corners of each block's own box: each side takes the
  corner that rounds no nearer than any point inside, so the box holds the walk's to the last
  bit, is the walk's where no insert is turned, and for a turned insert may be larger. Each walk
  enters its first 64 blocks free and all walks the boxer's `walking` more, which `lint` gives
  the writer's whole limit, so the two take one path, and `lint` boxes model space when it holds
  anything whose box can cost: an insert, a dimension, a leader or a text past `KEYED`. Past that, a placement
  maps the corners of the box of all its block draws, widened by what rounding can move a number
  on the way, so the extents never come out smaller than a walk's. Where a number on the way
  overflowed or a product underflowed, which the slack cannot cover, it walks the blocks within
  the walks left, and past them the boxer stops. A box that
  depends on a block of a cycle being open is not kept for another way in. What many places share is read once a boxer: the box of a list of entities,
  of a long list of points and of a leader, a long value's measure, and the inserts of a list.
  An insert's attributes are written as texts in the insert's
  own coordinates, which `placeAttribute` works out from the numbers as they are written. One of
  paragraph text is the paragraph `attributeParagraph` gives in those coordinates, mirrored where
  X runs the other way, which `eachDrawn` draws with the matrix of the space the insert is in, and
  the boxer keeps apart from a block's other attributes, in the coordinates of its insert's
  space, since an uneven scale lays it out again rather than stretching it. An
  attribute is stored on its definition's layer, and one on layer `0` draws as its insert's
  layer does. An insert on a frozen layer, or in a plot on a layer that does not plot, draws
  nothing of its block.
- An xref is a block record with a path: `Drawing.xrefs` holds a name and a path, and an
  insert places one by its name. It shares the blocks' names and the keys of their handles,
  `block:KEY` and the two beside it, and is written as an overlay, unless `attach` is true. That
  app reads the path of a BLOCK once, so the DXF writes it with `dxfOnce`. `eachDrawn` walks the
  drawing a caller gives for an xref as it walks a block, with each layer as a `LayerRef` that
  says which drawing's layer it is. `src/` opens no file: `toSVG` draws only the drawings it is
  given. `referencedTree` in `src/blocks.ts` is the one reading of what is given in `xrefs`: a
  tree of `Referenced`, one for each place, each with the drawings of its own attachments,
  never of an overlay, cut where a drawing on the chain above comes again and past `XREF_DEPTH`
  drawings down, with why in its problems, which `lint` reports with `xrefs`. Past `XREF_LOOKS`
  names looked for inside referenced drawings it follows none, so the same given with drawings
  left out cuts nothing the whole did not, which the command relies on; `drawnXrefs` gives the
  tree in the form given. `eachDrawn` and the boxer read that tree, the boxer keeping a block's
  box for each drawing and the drawings given for its attachments. `inspectText` reads the
  drawings given for the drawing's own xrefs alone, once each, and checks no text of their
  attachments: a cut for each place cost work outside its limit.
