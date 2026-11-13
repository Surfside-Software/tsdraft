// The built-in standard's plain title block, for an ARCH D sheet: a drawing in inches that holds
// one block, `TITLE BLOCK`, with the border, the title block in its lower right corner and an
// attribute for each field.
import { createDrawing, type Drawing } from "../drawing.ts";
import type { Box } from "./document.ts";

/** What `"tsdraft/title-blocks/plain-arch-d.json"` names. */
export const PLAIN_TITLE_BLOCK_SPECIFIER = "tsdraft/title-blocks/plain-arch-d.json";

/** The block's name, and its text style, which is in Arial. */
export const PLAIN_TITLE_BLOCK_NAME = "TITLE BLOCK";

const PAPER = { width: 36, height: 24, margin: 1 / 2 };
const SIZE = { width: 6.5, height: 3 };
const TEXT = { label: 1 / 16, field: 1 / 8, title: 3 / 16, number: 5 / 16 };

const area = {
  left: PAPER.margin,
  bottom: PAPER.margin,
  right: PAPER.width - PAPER.margin,
  top: PAPER.height - PAPER.margin,
};
const box = {
  left: area.right - SIZE.width,
  bottom: area.bottom,
  right: area.right,
  top: area.bottom + SIZE.height,
};
// The seal and the revisions take the left 2 in. The fields are in rows at their right: the
// project, the sheet's title, then four small fields beside the sheet number.
const split = box.left + 2;
const number = box.right - 1.75;
const rows = [box.top - 0.6, box.top - 1.4, box.top - 2.2] as const;
const middle = (split + number) / 2;

/** The part of the paper inside the border. */
export const PLAIN_DRAWING_AREA: Box = [area.left, area.bottom, area.right, area.top];
/** The title block's own rectangle, in the drawing area's lower right corner. */
export const PLAIN_BOX: Box = [box.left, box.bottom, box.right, box.top];

/** Each field's cell, by its tag, with what a sheet fills it with. */
export const PLAIN_FIELDS = {
  PROJECT: { fills: "project", box: [split, rows[0], box.right, box.top] },
  TITLE: { fills: "title", box: [split, rows[1], box.right, rows[0]] },
  DATE: { fills: "date", box: [split, rows[2], middle, rows[1]] },
  SCALE: { fills: "scale", box: [middle, rows[2], number, rows[1]] },
  DRAWN: { fills: "drawnBy", box: [split, box.bottom, middle, rows[2]] },
  CHECKED: { fills: "checkedBy", box: [middle, box.bottom, number, rows[2]] },
  SHEET: { fills: "number", box: [number, box.bottom, box.right, rows[1]] },
} as const satisfies Readonly<Record<string, { fills: string; box: Box }>>;

/**
 * The drawing of the plain title block. Its lines and texts are on layer 0, so they draw on the
 * layer of the insert, and the border and the title block's outline carry a lineweight of their
 * own.
 */
export function plainTitleBlock(): Drawing {
  const d = createDrawing({ units: "in", dxf: "R2018", recordCalls: false });
  const style = PLAIN_TITLE_BLOCK_NAME;
  d.textStyle({ name: style, font: "Arial" });
  const pad = 1 / 16;
  type Cell = readonly [left: number, bottom: number, right: number, top: number];
  /** The small fixed text that names a cell, in its upper left corner. */
  const label = ([left, , , top]: Cell, value: string): void => {
    d.text([left + pad, top - pad], value, { height: TEXT.label, style, valign: "top" });
  };
  /** A field: its label, and its attribute at the foot of its cell. */
  const field = (tag: keyof typeof PLAIN_FIELDS, prompt: string, height: number): void => {
    const cell = PLAIN_FIELDS[tag].box;
    label(cell, prompt.toUpperCase());
    d.attribute(tag, [cell[0] + pad, cell[1] + pad * 1.5], { value: "-", prompt, height, style });
  };
  const seal: Cell = [box.left, box.top - 2, split, box.top];
  const revisions: Cell = [box.left, box.bottom, split, seal[1]];

  d.block(PLAIN_TITLE_BLOCK_NAME, {}, () => {
    d.rect([area.left, area.bottom], area.right - area.left, area.top - area.bottom, {
      lineweight: 0.7,
    });
    // The title block's left and top edges. The border is its other two.
    d.polyline(
      [
        [box.left, box.bottom],
        [box.left, box.top],
        [box.right, box.top],
      ],
      false,
      { lineweight: 0.7 },
    );
    d.line([split, box.bottom], [split, box.top]);
    d.line([box.left, seal[1]], [split, seal[1]]);
    for (const y of rows) d.line([split, y], [y === rows[2] ? number : box.right, y]);
    d.line([middle, box.bottom], [middle, rows[1]]);
    d.line([number, box.bottom], [number, rows[1]]);

    label(seal, "SEAL");
    // The revisions: a heading, a row that names the columns, and three rows to fill.
    label(revisions, "REVISIONS");
    const rowHeight = (revisions[3] - revisions[1]) / 5;
    const columns = [
      { left: revisions[0], name: "NO." },
      { left: revisions[0] + 0.3, name: "DATE" },
      { left: revisions[0] + 0.9, name: "DESCRIPTION" },
    ];
    for (let row = 1; row < 5; row++) {
      const y = revisions[3] - rowHeight * row;
      d.line([revisions[0], y], [revisions[2], y]);
    }
    for (const column of columns) {
      const top = revisions[3] - rowHeight;
      if (column.left > revisions[0]) d.line([column.left, revisions[1]], [column.left, top]);
      label([column.left, revisions[1], revisions[2], top], column.name);
    }

    field("PROJECT", "Project", TEXT.field);
    field("TITLE", "Sheet title", TEXT.title);
    field("DATE", "Date", TEXT.field);
    field("SCALE", "Scale", TEXT.field);
    field("DRAWN", "Drawn by", TEXT.field);
    field("CHECKED", "Checked by", TEXT.field);
    // The sheet number is the largest text of the sheet, centered in its cell.
    const sheet = PLAIN_FIELDS.SHEET.box;
    label(sheet, "SHEET");
    d.attribute("SHEET", [(number + box.right) / 2, (sheet[1] + sheet[3]) / 2 - pad], {
      value: "-",
      prompt: "Sheet number",
      height: TEXT.number,
      style,
      align: "center",
      valign: "middle",
    });
  });
  return d.build();
}
