# The readers

Rules for agents who change anything under `src/read/`. [AGENTS.md](../../AGENTS.md) has the rules
that hold for every change.

- `src/read/` reads a file into a `DrawingRead`, the read model, which is not a `Drawing` and is
  never written back. `readDXF` reads as the bytes arrive and must never hold the whole file or
  a list that grows with entities past its limits, `CENSUS_LIMIT`, `BLOCK_ITEMS` and
  `GEOMETRY_ITEMS`; a record's binary groups are dropped as they arrive. Without `geometry` it
  keeps no text of model space or a layout and no attribute value. It throws only a
  `ReadError`, for a file it cannot read at all, and counts the rest it does not understand under
  `unread`. A group's default, such as the text style `Standard`, is filled in, since the leading
  CAD app leaves a default out. `src/read/entities.ts` reads each kind of `ReadEntity`, for blocks
  and spaces alike, and `costOf` there is what each costs against a budget. A string holds what
  that app holds after reading the file, by the passes `src/read/groups.ts` makes, and a justified
  text whose file stores its alignment point as its start is placed from `layoutText` only where
  the layout is exact. No map of a read is keyed by a name longer than a DXF value holds, since
  V8 hashes a long string by its length alone. `src/read/document.ts` is the document of a DXF:
  where each record is in bytes, so the records copied in order give the file back. It is
  internal. `checkDrawingRead` holds a reader's answer to the model's fields: change both
  together, and the reading page, `docs/reading.md`. `test/read-fuzz.ts` fuzzes the reader from
  a seed, and `test/read-agreement.ts` holds a read with geometry to the `Drawing` it came from.
  A read with `only` reads the file twice, and `src/read/part.ts` decides what it keeps: a box
  there is never smaller than what the picture draws, and an entity it cannot box is kept.
