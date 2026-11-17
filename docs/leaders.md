# Leaders

A leader points a note at what it names: one or more shafts, each with an arrowhead at its tip,
meet at a point, and a short level landing runs from there to the note. In the file it is a
multileader and not lines and text: a drafter moves it, adds a shaft or edits its note with
CAD's multileader commands. tsdraft draws leaders in R2018 drawings only.

```ts
const d = createDrawing({ units: "ft" });
d.layer("A-WALL", { color: 7 });
d.layer("A-ANNO-NOTE", { color: 2, lineweight: 0.18 });
d.textStyle({ name: "NOTES", font: "Arial" });

d.leaderStyle({
  name: "NOTE-10",
  textStyle: "NOTES",
  textHeight: 3 / 32,
  arrowSize: 1 / 8,
  landing: 1 / 8,
  gap: 1 / 16,
  scale: fromPaper(1, "in", { ratio: 120, units: "ft" }),
});

d.layer("A-WALL", {}, () => d.rect([0, 0], 52, 30));
d.layer("A-ANNO-NOTE", {}, () => {
  d.leader("WALL", { style: "NOTE-10", at: [62, 38], to: [52, 26] });
  d.leader(["EXISTING", "WALLS TO", "REMAIN"], {
    style: "NOTE-10",
    at: [-10, 40],
    to: [
      [0, 24],
      [12, 30],
    ],
  });
});
```

## A leader style

Every leader names a leader style, which says how it is drawn. `d.leaderStyle(definition)`
defines one. A style is defined once, under a name no other style has, and before the first
leader that names it.

| Field        | What it sets                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `name`       | The style's name, held to the rules of a dimension style's name.                                                   |
| `textStyle`  | The text style of the note. `"Standard"` unless given.                                                             |
| `textHeight` | The height of the note's capitals. Greater than 0.                                                                 |
| `arrowhead`  | `"closed-filled"`, the default, `"open"`, `"dot"` or `"none"`. `LEADER_ARROWHEADS` lists them.                     |
| `arrowSize`  | The length of an arrowhead. 0 draws none.                                                                          |
| `landing`    | The length of the level line from where the shafts meet toward the note. 0 draws none.                             |
| `gap`        | The gap between the end of the landing and the note.                                                               |
| `attachment` | `"first-line"`, the default, has the landing meet the middle of the note's first line, and `"last-line"` its last. |
| `scale`      | What every size above is multiplied by. 1 unless given.                                                            |

Give the sizes as they plot, and let `scale` carry the view, as for a
[dimension style](dimensions.md#sizes-and-the-scale). A leader in model space that a viewport
shows at a ratio of 120 takes `scale: fromPaper(1, "in", { ratio: 120, units: "ft" })`, and a
leader on a layout a style with no scale. The file holds each size times the scale, with a
scale of 1, so CAD draws the sizes the style works out.

## A leader

`d.leader(text, options)` draws one. `text` is the note: a string for one line, or an array of
its lines from the top. CAD draws the lines as they are given and does not wrap them.

- `style` names the leader style.
- `at` is where the shafts meet and the landing starts.
- `to` is what the note names. A point is the tip of one straight shaft. A list has a shaft for
  each item: a point is a straight shaft from that tip, and a list of points is a shaft from its
  first point, the tip, through each point after it, where it bends, to `at`.
- `side` is the side of `at` the note is on, `"left"` or `"right"`. Unless given, it is the side
  away from the first shaft: right when `at` is not to the left of the last point before it.
- `attachment` replaces the style's.
- `textStyle`, `textHeight`, `arrowSize`, `landing` and `gap` replace the style's, each times the
  style's scale. The file holds each as the leader's own, so CAD keeps it when the style
  changes.
- `id`, as any entity takes one: see [Ids](format.md#ids).

A leader is on the current layer, and is drawn in that layer's color and lineweight. It takes no
linetype or lineweight of its own. It goes in model space or on a [layout](layouts.md), and not
in a block.

### How a leader is drawn

- Each shaft runs from its tip through its bends to `at`. The arrowhead at its tip points along
  the shaft's first segment.
- A closed filled arrowhead is a filled triangle as long as `arrowSize` and a third as wide. An
  open one is the two long sides of the same triangle. A dot is a filled disk on the tip, with a
  radius of half the arrow size. `"none"` draws no arrowhead. The shaft reaches the tip either
  way: with an arrowhead, the arrowhead draws the last arrow size of it.
- The landing runs level from `at`, as long as `landing`, toward the note's side.
- The note starts `gap` past the end of the landing. On the right it is justified left, and on
  the left justified right. The middle of the capitals of its first line, or of its last line,
  is level with `at`.
- Its lines are `lineSpacing(textHeight)` apart, 5/3 of the height. `lineSpacing` is the one
  rule for that, which the picture, the extents and `inspectText` use.

`leaderPicture(leader, style, textStyle)` gives what CAD draws for a leader: each shaft as drawn,
its arrowheads, its landing and each line of its note with where it is, and the numbers the file
holds for it. `leaderSizes(leader, style)` gives the sizes it is drawn with, and
`findLeaderStyle(drawing, name)` the style a leader names.

## Under a standard

A standard lists its leader styles in `leaderStyles`, by an id, each with a `role`, which gives
the note its text style and height, and an `arrowSize`, a `landing` and a `gap` on paper, and
optionally an `arrowhead` and an `attachment`. `defaultLeaderStyle` names the one a leader with
no `style` is drawn in.

```ts
const standard = defineStandard({
  id: "my-firm",
  version: "1",
  extends: BUILT_IN_STANDARD,
  leaderStyles: { notes: { role: "note", arrowSize: 1 / 8, landing: 1 / 8, gap: 1 / 16 } },
  defaultLeaderStyle: "notes",
});
const d = createDrawing({ units: "ft", standard });
const plan = d.view("plan", { scale: "1in-10ft" });
d.layer("C-ANNO-TEXT", () =>
  d.leader(["EXISTING OAK", "TO REMAIN"], { view: plan, at: [35, 20], to: [30, 14] }),
);
```

The builder defines the style's leader style on first use: `NOTES-1in-10ft` for the style
`notes` in a view at `1in-10ft`, with a scale of `view.paper(1)`, and `NOTES` on a layout. A
drawing under a standard defines no leader style of its own. `role` gives one leader the text
style and height of another role, and a size of its own is a length on paper.

## The preview

`toSVG` draws each leader as CAD does, in model space, through a viewport and on a sheet, in
its layer's color and lineweight. A leader is a `<g>` with `data-layer`, `data-entity`,
`data-id` and `data-leader`, its note with a line break between its lines. Its children have a
`data-part`: `shaft`, `landing`, `arrowhead` or `text`. A drawing's extents take its leaders
in, notes included.

`inspectText` takes each line of a leader's note for a text where the picture puts it, so it
warns of a note that plots over another text.

## What lint reports

Each of these is an error, at the builder's call and in `lint`. The rule is `leader-style`,
`duplicate-leader-style`, `undefined-leader-style` or `leader`.

- A style's name follows the rules of a dimension style's name, and no two styles have names
  AutoCAD takes for one.
- `Standard` is not defined and not named. Every drawing with a leader style has that style,
  with AutoCAD's own values, and AutoCAD skips a second style of the name.
- A style's text style, and a leader's own, is one the drawing defines. Each holds it by its
  handle, which would lead to no style.
- A text height is greater than 0. The arrow size, the landing and the gap are 0 or more, and
  the scale is greater than 0.
- An arrowhead is one of `LEADER_ARROWHEADS`, an attachment `"first-line"` or `"last-line"`,
  and a side `"left"` or `"right"`.
- Every line of a note is a single line of text with none of `\`, `{` and `}`, which AutoCAD
  reads as the formatting of the note. One line is not empty or all spaces.
- A leader has a shaft, and each shaft starts with its tip. Its tip and the point after it, or
  `at` for a straight shaft, are not one point once they are written with 6 decimals: CAD would
  have no direction to point the arrowhead in.
- Every number a leader draws is under 1e100: each size of its style and its own times the
  scale, and each point of its picture. A text height, and an arrow size other than 0, times the
  scale is not written as 0.
- A leader names a style the drawing defines.
- A leader is not in a block. tsdraft writes a leader in model space or on a layout, where a
  drafter moves it as one.
- No block is named `_Open`, `_Dot` or `_None`, in any case of their letters. AutoCAD draws the
  arrowheads of a leader with the blocks of those names.
- An R12 drawing has no leaders.

`lint` warns of a line of a note with `%%`, which AutoCAD reads as the start of a control code,
as it does in any text.

Under a standard, `lint` also reports `leader-style-outside-standard` for a leader style that is
none of the standard's, `leader-style-differs-from-standard` for one whose text style, sizes,
arrowhead, attachment or scale is not what the standard gives it, and `leader-off-scale` for a
leader shown in a viewport at another ratio than its style's scale, and one on a layout in a
style for model space. Where a leader is shown at its style's scale, each line of its note is
held to its role's height and to the least height as a text is, with `height-off-role` and
`height-below-standard`, and a text style of the leader's own that is no role's is
`text-style-outside-standard`.

## Handles

A leader style takes its handle from its name, with A to Z in lower case, so it keeps the handle
when the drawing around it changes. `leaderStyleHandle(name)` gives it, and
`leaderStyleDictionaryHandle()` the handle of the dictionary that lists the styles. A leader that
has an `id` takes `idHandle(id)`, as any entity does. The block of an open, dot or no arrowhead
takes the handles its name gives a block, and `leaderArrowheadHandles(arrowhead)` gives its
record's and its strokes'. What each of these returns will not change in a later version of
tsdraft.

## What a file holds

For a drawing with a leader style, tsdraft writes AutoCAD's own leader style `Standard` and each
style of the drawing, in the dictionary `ACAD_MLEADERSTYLE`, the blocks `_Open`, `_Dot` and
`_None` that its styles draw arrowheads with, and each leader as a multileader: one leader root
where its shafts meet, a leader line for each shaft, and its note as a multiline text. The file
holds no picture of a leader. CAD draws it from what the multileader holds.

## What is not drawn yet

A leader with two roots, a curved shaft, a block in place of the note, a note attached at its
top or bottom, a frame around the note, and a note that wraps at a width.
