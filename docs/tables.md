# Tables

A table is a schedule, a legend or a calculation in rows and columns: a title row across its
columns, a header row and data rows. In the file it is one table entity and not lines and text,
so a drafter adds a row, resizes a column or edits a cell with CAD's own table commands. tsdraft
draws tables in R2018 drawings only.

```ts
const d = createDrawing({ units: "in" });
d.layer("A-ANNO-SCHD", { color: 7 });
d.textStyle({ name: "NOTES", font: "Arial" });
d.block("SWATCH-CONC", {}, () => d.rect([0, 0], 1, 0.5));

d.tableStyle({
  name: "SCHEDULE",
  textStyle: "NOTES",
  textHeight: 0.1,
  title: { textHeight: 0.15 },
  header: { lineweight: 0.35 },
  data: { align: "left", valign: "middle" },
});

d.layout("A-601", { paper: "ARCH D" }, () => {
  d.layer("A-ANNO-SCHD", {}, () => {
    d.table({
      style: "SCHEDULE",
      at: [1, 22],
      columns: [0.6, 0.8, 0.8, 2.4],
      title: "DOOR SCHEDULE",
      header: ["MARK", { text: "SIZE", columnSpan: 2 }, null, "NOTES"],
      rows: [
        ["D1", "3'-0\"", "7'-0\"", "SOLID CORE, 20 MIN. RATED, CLOSER"],
        [{ text: "D2", rowSpan: 2 }, "2'-8\"", "6'-8\"", "HOLLOW CORE"],
        [null, "2'-6\"", "6'-8\"", { block: "SWATCH-CONC" }],
      ],
    });
  });
});
```

## A table style

Every table names a table style, which says how its cells are drawn. `d.tableStyle(definition)`
defines one, once, under a name no other style has, and before the first table that names it.
`"Standard"` is the leading CAD app's own, which tsdraft writes beside a drawing's styles, and a
drawing neither defines it nor draws in it.

| Field              | What it sets                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `name`             | The style's name, held to the rules of a dimension style's name.                                |
| `textStyle`        | The text style of its cells. `"Standard"` unless given.                                         |
| `textHeight`       | The height of its cells' capitals, for each kind of row that gives none. Greater than 0.        |
| `horizontalMargin` | The room between a cell's sides and its content. A third of `textHeight` unless given.          |
| `verticalMargin`   | The room between a cell's top and bottom and its content. A third of `textHeight` unless given. |
| `title`            | The cell style of the title row.                                                                |
| `header`           | The cell style of the header row.                                                               |
| `data`             | The cell style of the data rows.                                                                |

A cell style may set `textStyle`, `textHeight`, `align` (`"left"`, `"center"` or `"right"`),
`valign` (`"top"`, `"middle"` or `"bottom"`), `color` and `fill`, each a color index from 1 to
255, and `lineweight`, the lineweight in millimetres of its cells' borders. A title's and a
header's content is centered across and up and down unless its style says otherwise, and a data
cell's is centered across at the top.

## A table

`d.table(options)` draws a table on the current layer, its upper left corner at `at`.

| Field          | What it sets                                                                     |
| -------------- | -------------------------------------------------------------------------------- |
| `style`        | A table style of the drawing.                                                    |
| `at`           | Its upper left corner.                                                           |
| `rotation`     | Degrees counterclockwise. 0 unless given.                                        |
| `columns`      | The width of each column, from the left.                                         |
| `title`        | The title, in one cell across every column. Missing, the table has no title row. |
| `header`       | The header row, a cell for each column. Missing, the table has no header row.    |
| `rows`         | The data rows, from the top, each a list of a cell for each column.              |
| `titleHeight`  | The least height of the title row.                                               |
| `headerHeight` | The least height of the header row.                                              |
| `rowHeights`   | The least height of each data row, or `null` for as tall as its cells need.      |

Each row holds a cell for each column. A cell is its text, as a string, or an object:

| Field             | What it sets                                                                       |
| ----------------- | ---------------------------------------------------------------------------------- |
| `text`            | Its text, with a paragraph's codes. `\P` breaks a line.                            |
| `block`           | A block of the drawing in place of a text. It takes no attribute values.           |
| `blockScale`      | The block's scale. Missing, the block is scaled to fit the cell, less its margins. |
| `columnSpan`      | How many columns it spans, to the right. 1 unless given.                           |
| `rowSpan`         | How many rows it spans, down. 1 unless given.                                      |
| `align`, `valign` | Where its content sits in it, in place of its row's cell style.                    |
| `textHeight`      | The height of its text's capitals.                                                 |
| `color`           | The color index of its text.                                                       |
| `fill`            | The color index it is filled with, as a swatch.                                    |

A cell that another spans is `null`, so `rows[r][c]` is always column `c`. A span stays inside
the header or inside the data rows.

## How a table is laid out

The leading CAD app lays a table out again whenever a drafter edits it, so tsdraft draws it as
that app does:

- A cell's text wraps at the column's width less two horizontal margins, as paragraph text does,
  but a word wider than that breaks before each character whose ink would pass it.
- Each row is as tall as its tallest cell needs: its text's box, and at least four thirds of its
  text's height, plus two vertical margins; or its block, at its scale, plus the margins. A row
  is never shorter than the height given for it. A cell that spans rows grows the last of them.
- A block in a cell is placed by its box, as a text would be by `align` and `valign`. A block
  scaled to fit takes all it draws, a layer that does not plot included.
- A table in a referenced drawing draws the block in each of its cells too.
- A border between two cells is drawn in the lineweight of the row it is the top of, and pieces of
  one line run on while they share a lineweight.

`measureTable(options, style, textStyles, blocks)` gives a table's width and height, and the
height of each row, as `d.table` lays it out, for placing what goes below it.

## What lint reports

| Rule                    | What it reports                                                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `table-style`           | A table style that cannot be written, or one in an R12 drawing.                                                                                                                                                              |
| `duplicate-table-style` | A second table style of a name the drawing has, compared as the leading CAD app does.                                                                                                                                        |
| `undefined-table-style` | A table whose style the drawing does not have, or that names `"Standard"`.                                                                                                                                                   |
| `table`                 | A table with a row of the wrong length, a span past the table or over another, a `null` no span covers, a cell of a block the drawing lacks, a block its fit would scale to 0, a table in a block, or one in an R12 drawing. |
