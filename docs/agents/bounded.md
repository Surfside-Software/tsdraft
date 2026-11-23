# Bounded walks, and data of any shape

Rules for agents who change `lint`, `inspectText`, the extents or any walk of a drawing, or what
they do with data of the wrong shape. [AGENTS.md](../../AGENTS.md) has the rules that hold for every
change.

- `lint`, `inspectText`, the extents and `toSVG` must stay bounded on any data, by construction:
  each reads a list up to its first empty slot, works out each name's `layerKey` once a call,
  follows blocks with a stack of its own, and pays for what it does again, by its size, before
  it does it. The data is the value as given, and a drawing made in code may share one list,
  object or string among many places, which JSON cannot. So what a walk reads of one of those
  and can keep, it keeps for the call, by the object or, for a value of 256 characters or more,
  by the string: the extents' boxes, a text's measure through `measurer` in `src/measure.ts`,
  `inspectText`'s cut of a list and the outline of a long list of points, and `lint`'s checks of
  a long value and an insert's values. What a walk must read again for each place, `lint` pays
  for by its size each time after the first: a list of entities or of attribute definitions, a
  list of points of 64 or more, an insert's values past the first 64, and a string of 256
  characters or more in a field an entity, a definition or an insert's values has, since a
  message quotes it and `toDXF` writes it again. An object of the wrong shape is reported where
  it is first met, and its messages pay for their length, so a long key or kind that many objects
  share is paid for each time it is quoted. Once `lint` or `inspectText` stops, it reads no entity
  past there. `itemsOf` counts a list once. The boxer pays for a list that
  another drawing holds too, such as one drawing given for many xrefs, and the standard's checks
  pay for a shared list, each error they give from it by its length, and a shared long string. A
  walk skips an attribute definition that is no object, as `isDefinition` in `src/blocks.ts`
  says. Key no `Map` or `Set` of a walk by strings a drawing holds: V8 hashes a string over
  16,383 characters by its length alone, so a table of many such strings of one length compares
  each it looks up with all the others. `Strings` in `src/shape.ts` keys a long one by its length
  and 80 of its characters, keeps one string a key, and says when a string takes another's
  place, which the walk then pays for by its length. So distinct long strings crafted to agree at
  those characters pay as if they were shared. Each insert does its first 64 attributes, and the first 64 steps of its walk, free
  of the limit: that is work in proportion to the drawing. `lint` pays for each attribute an
  insert places and each handle it takes past those, what a dimension reads from its style's
  prefix and suffix, the search for the way back through a cycle, which finds cycles first in
  one pass, and the extents of model space, which the DXF writer works out within the same
  limit; past its limit, 500,000 units and 16 more for each entity and attribute definition the
  drawing holds, it ends with `check-capped`, which `toDXF` refuses. `lint` boxes model space
  and then each layout with one boxer, as the writer does, so the writer stops on nothing `lint`
  passed. What a drawing repeats is paid for and what it holds is not: a value an insert holds
  is free, a definition's value it repeats is paid for by its length. Whatever is read for each
  placement reads only the fields it needs, as `inStyle` and `attributeText` do, never a copy
  of all an object holds, and a measured text takes only its font, width factor and oblique
  angle from its style. `toSVG` writes at most 500 million characters, and walks through
  inserts at most 2,000,000 blocks and entities that draw nothing, and refuses an insert whose
  walk would spend more than is left before it walks it, from the boxer's `walkCost`; what it draws counts against
  the characters, so drawing an entity may cost only in proportion to what it writes: a dashed
  polyline's sides that have a length are found once a picture, for each list of points. Past
  either it throws a `RangeError` that names where it stopped. It joins an insert's elements as
  it makes them, so the memory it holds stays near its characters. Looking a long string up in
  an object can take time in proportion to its length, so a name is looked up in a table of
  tsdraft's, such as `FONTS` or `ARROWHEADS`, only when it is no longer than the table's
  longest, and a walk that looks a definition's tag up among an insert's values pays a unit for
  each 256 characters of it, `lookupCost` in `src/blocks.ts`.
  `test/bounded.test.ts` fuzzes the four from a seed under a vm timeout, with limits given to
  `lintWithin`, `inspectWithin` and `svgWithin`, and with lists and values that many places
  share. Every walk but `lint` may throw a `RangeError` there, and nothing else.
- `lint` takes any plain data and never throws, since a `Drawing` can be written by hand. A
  `Proxy` is code, not data, and `src/`, which imports no `node:` module, has no way to tell one
  from data without calling its traps. So `lint`, like the rest of the library, reads one as the
  data its traps give, calling them in proportion to what it reads, and a trap that throws or
  never returns does so inside the call. `test/bounded.test.ts` holds both: the traps of one that
  returns are called a bounded number of times, and data a proxy makes up as it is read is
  refused where its shape is wrong. The command, which runs a drawing file's code, ends a build
  past its timeout.
  `src/shape.ts` holds the fields of each object and their types, once, for `fromJSON` and for
  `lint`. `lint` checks an object's shape there before a rule reads it, and skips the rules for
  an object that fails, but still records its name, so that nothing that names it gets a
  second error. A field under `ruled` is left to the rule that reports its type with a message
  of its own. A message shows a value from the drawing only through `shown` in `src/rules.ts`,
  and a diagnostic's field holds a name only when it is a string. An error about a value of
  the wrong type carries `item`, the path of what a reader has to leave out.
  `test/shape-sweep.ts` replaces every field of a full drawing with values of other types, and
  its drawing is typed so that a new field or entity kind is a compile error there. A value
  under an entity or a table item goes into the smallest drawing that holds that item and what it
  names, since every check on the whole drawing makes the work grow with the square of the
  drawing. A fault may show only past a limit a big drawing reaches, so one value of each path
  runs in the whole drawing too, and the paths of one field name share out its values there.
  Each value runs every `lint`, and the one for the drawing's own version must say what the
  plain one says. The test files
  `test/shape-sweep/share-1.test.ts` and on share the cases, and `node --test` runs one file
  fewer at once than the machine has cores. `pnpm test` runs them after every other test, in a
  run of their own: beside the others they fill every core for 20 seconds or more, and a test
  with a time limit, as in `test/bounded.test.ts`, then fails at a limit tuned to a machine
  with room. Raise `SHARES` and add a file only where the machines that run the tests have the
  cores for one more.
