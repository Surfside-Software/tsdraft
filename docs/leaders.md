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

| Field                | What it sets                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `name`               | The style's name, held to the rules of a dimension style's name.                                  |
| `textStyle`          | The text style of the note. `"Standard"` unless given.                                            |
| `textHeight`         | The height of the note's capitals. Greater than 0.                                                |
| `arrowhead`          | `"closed-filled"`, the default, `"open"`, `"dot"` or `"none"`. `LEADER_ARROWHEADS` lists them.    |
| `arrowSize`          | The length of an arrowhead. 0 draws none.                                                         |
| `landing`            | The length of the level line from where the shafts meet toward the note. 0 draws none.            |
| `gap`                | The gap between the end of the landing and the note.                                              |
| `attachment`         | Where the landing meets the side of the note: one of `LEADER_ATTACHMENTS`, below.                 |
| `direction`          | `"horizontal"`, the default, or `"vertical"`: the landing meets the note's top or bottom.         |
| `verticalAttachment` | Where it meets a note above or below: `"center"`, the default, or `"line"`, with a line under it. |
| `frame`              | `true` for a frame around each note, one gap outside it. `false` unless given.                    |
| `shaft`              | `"straight"`, the default, or `"curved"`: each shaft a curve through its points.                  |
| `block`              | A block of the drawing its leaders hold in place of a note.                                       |
| `blockConnection`    | How the block meets the landing: `"extents"`, the default, or `"insertion"`.                      |
| `blockScale`         | What the block is scaled by, times `scale`. 1 unless given.                                       |
| `scale`              | What every size above is multiplied by. 1 unless given.                                           |

`LEADER_ATTACHMENTS` are, in order: `"top-of-first"`, the top of the note; `"first-line"`, the
default, the middle of its first line; `"middle"`, the middle of the note; `"last-line"`, the
middle of its last line; `"bottom-of-last"`, its bottom; `"underline-last"`, the bottom of its last
line, with the landing drawn on under that line; `"underline-first"`, the same under its first
line; `"bottom-of-first"`, the bottom of its first line; and `"underline-all"`, which underlines
every line.

Give the sizes as they plot, and let `scale` carry the view, as for a
[dimension style](dimensions.md#sizes-and-the-scale). A leader in model space that a viewport
shows at a ratio of 120 takes `scale: fromPaper(1, "in", { ratio: 120, units: "ft" })`, and a
leader on a layout a style with no scale. The file holds each size times the scale, with a
scale of 1, so CAD draws the sizes the style works out.

## A leader

`d.leader(text, options)` draws one. `text` is the note: a string for one line, or an array of
its paragraphs from the top. Each is one line, unless `width` wraps it. In place of a note it may
be `{ block, attributes }`: a block of the drawing, such as a tag or a keynote bubble, and the
value of each of its attributes, by its tag, where it is not its definition's.

```ts
d.leader(
  { block: "KEYNOTE", attributes: { NUM: "7" } },
  { style: "KEYNOTES", at: [62, 38], to: [52, 26] },
);
```

- `style` names the leader style.
- `at` is where the shafts meet and the landing starts.
- `to` is what the note names. A point is the tip of one straight shaft. A list has a shaft for
  each item: a point is a straight shaft from that tip, and a list of points is a shaft from its
  first point, the tip, through each point after it, where it bends, to `at`.
- `side` is the side of `at` the note is on: `"left"`, `"right"`, `"above"` or `"below"`. Unless
  given, it is the side away from the first shaft: in a horizontal style right when `at` is not to
  the left of the last point before it, and in a vertical one above when `at` is not below it.
- `attachment` and `verticalAttachment` replace the style's.
- `width` is the width the note wraps at, greater than 0, times the style's scale.
- `frame` and `shaft` replace the style's.
- `toFarSide` gives the shafts of a second root, on the note's far side, as `to` does. Its point
  is worked out from the note: past its far end, as far out as `at` is on the near side, or above
  or below a note that is below or above `at`. A drafter moves the note and both roots follow.
- `mask` hides what is drawn before the leader behind its note: `true` for the drawing's
  background, or `{ color, offsetFactor }`, with a color index from 1 to 255, or 256 for the
  layer's, and how far the mask reaches past the note, as a factor of its text height from 1 to
  5, 1.5 unless given.
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
- The note is a paragraph, laid out as [paragraph text](paragraphs.md) is: each line set by the
  ink of its letters, and wrapped at `width`. On the right it starts `gap` past the end of the
  landing, justified left, and on the left it ends there, justified right. Its attachment puts it
  as high as CAD does: for `"first-line"`, the middle of its first line, which runs from its top
  as far down as its capitals and the last line's letters below the baseline, is level with `at`.
- The underline attachments run the landing on under the line they meet, as far as the note
  reaches, but not into a frame.
- Above or below `at`, the note is a gap away from it and centered on it, and no landing is drawn.
  With `"line"`, a line as wide as the note runs through `at`.
- A frame runs around the note's box one gap outside it, and a mask fills the note's box grown by
  its factor of the text height less one, each side, before the rest of the leader is drawn.
- A curved shaft is the cubic CAD programs draw through the arrowhead's base, each bend and the end
  of the landing, which it meets level, with no landing drawn apart. A curve whose first stretch
  is shorter than the arrowhead draws none and runs to its tip.
- A block in place of the note is level with `at`. By its extents, the side of its box meets the
  end of the landing; by its insertion point, it is slid along the line through `at` until its
  outline meets the end of the landing.

`leaderPicture(leader, style, textStyle)` gives what CAD draws for a leader: each shaft as drawn,
its arrowheads, its landing, its note as a paragraph and where it is held, its underlines, its
frame and its mask, and the numbers the file holds for it. `leaderSizes(leader, style)` gives the sizes it is drawn with, and
`findLeaderStyle(drawing, name)` the style a leader names.

## Under a standard

A standard lists its leader styles in `leaderStyles`, by an id, each with a `role`, which gives
the note its text style and height, and an `arrowSize`, a `landing` and a `gap` on paper, and
optionally an `arrowhead`, an `attachment`, a `direction`, a `verticalAttachment`, a `frame` and a
`shaft`.
`defaultLeaderStyle` names the one a leader with no `style` is drawn in. The built-in standard's
is `notes`: the role `note`, a closed filled arrowhead 1/8 inch long, a landing of 1/8 inch, a gap
of 1/16 and the landing at the middle of the first line.

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
`data-part`: `mask`, `shaft`, `landing`, `arrowhead`, `underline`, `frame` or `text`. A mask in
the drawing's background is filled white and marked `data-mask="background"`, for a viewer whose
background is another color. A drawing's extents take its leaders in, notes, frames and masks
included.

`inspectText` takes each line of a leader's note for a text where the picture puts it, so it
warns of a note that plots over another text.

## What lint reports

Each of these is an error, at the builder's call and in `lint`. The rule is `leader-style`,
`duplicate-leader-style`, `undefined-leader-style` or `leader`.

- A style's name follows the rules of a dimension style's name, and no two styles have names
  the leading CAD app takes for one.
- `Standard` is not defined and not named. Every drawing with a leader style has that style,
  with the leading CAD app's own values, and that app skips a second style of the name.
- A style's text style, and a leader's own, is one the drawing defines. Each holds it by its
  handle, which would lead to no style.
- A text height is greater than 0. The arrow size, the landing and the gap are 0 or more, and
  the scale is greater than 0.
- A leader whose content is a block names a block of the drawing, and sets none of `text`,
  `attachment`, `verticalAttachment`, `width`, `frame`, `mask`, `textStyle` and `textHeight`.
  Its attributes are strings.
- An arrowhead is one of `LEADER_ARROWHEADS`, an attachment one of `LEADER_ATTACHMENTS`, a side
  one of `LEADER_SIDES`, a direction one of `LEADER_DIRECTIONS`, a vertical attachment one of
  `LEADER_VERTICAL_ATTACHMENTS`, a frame `true` or `false`, a width greater than 0 and a mask as
  above.
- Every paragraph of a note is text with none of `\`, `{` and `}`, which the leading CAD app reads
  as the formatting of the note. One is not empty or all spaces.
- A leader has a shaft, and each shaft starts with its tip. Its tip and the point after it, or
  `at` for a straight shaft, are not one point once they are written with 6 decimals: CAD would
  have no direction to point the arrowhead in.
- Every number a leader draws is under 1e100: each size of its style and its own times the
  scale, and each point of its picture. A text height, and an arrow size other than 0, times the
  scale is not written as 0.
- A leader names a style the drawing defines.
- A leader is not in a block. tsdraft writes a leader in model space or on a layout, where a
  drafter moves it as one.
- No block is named `_Open`, `_Dot` or `_None`, in any case of their letters. The leading CAD app
  draws the arrowheads of a leader with the blocks of those names.
- An R12 drawing has no leaders.

`lint` warns of a line of a note with `%%`, which the leading CAD app reads as the start of a
control code, as it does in any text.

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

For a drawing with a leader style, tsdraft writes the leading CAD app's own leader style `Standard`
and each style of the drawing, in the dictionary `ACAD_MLEADERSTYLE`, the blocks `_Open`, `_Dot` and
`_None` that its styles draw arrowheads with, and each leader as a multileader: one leader root
where its shafts meet and a second on the note's far side, a leader line for each shaft, and its
note as a multiline text with its width, its mask and where it is held, or its block with where
it is placed and its attributes as the multileader's labels. The file holds no picture of a leader. CAD draws it from
what the multileader holds.

## What is not drawn yet

A block in place of the note draws its attributes centered by their ink, where CAD programs center
a label of a multileader's block by its advances: 0.0055 inch apart for a `1` 0.1 inch high.
