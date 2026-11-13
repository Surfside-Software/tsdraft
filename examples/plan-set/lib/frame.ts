// The frame every sheet shares: the layout on ARCH D, the border attached as an xref, the
// sheet's fields and its revision table.
import type { Point, Sheet } from "../../../src/index.ts";
import { PROJECT, SHEETS, sheetInfo } from "../project.ts";
import { LAYERS, type D } from "./kit.ts";
import { revisionTable } from "./titleblock.ts";

export const BORDER = "TB-ARCHD";
/** The border's path from the set's file, as the firm keeps it: in a `Set up` folder. */
export const BORDER_PATH = "Set up/TB-ARCHD.dwg";

export const REVISIONS = [
  { no: "0", date: PROJECT.date, what: PROJECT.issue },
  { no: "1", date: PROJECT.date, what: "PLAN REVIEW RESPONSES" },
];

export type SheetFn = (d: D, sheet: Sheet) => void;

/** Adds the layout of sheet `number`, framed, and calls `draw` on it. */
export function frame(d: D, number: string, draw: SheetFn): void {
  const info = sheetInfo(number);
  const index = SHEETS.indexOf(info) + 1;
  d.layout(
    number,
    { paper: "ARCH D", plotStyle: info.mep ? "acad.ctb" : "monochrome.ctb" },
    (sheet) => {
      d.layer(LAYERS.ttlb, {}, () => {
        d.insert(BORDER, [0, 0], { id: `border-${number}` });
        d.insert("SHEET FIELDS", [0, 0], {
          id: `fields-${number}`,
          attributes: {
            DATE: PROJECT.date,
            JOB: PROJECT.job,
            DRAWN: PROJECT.drawn,
            CHECKED: PROJECT.checked,
            SCALE: "AS NOTED",
            TITLE1: info.title,
            TITLE2: info.title2 ?? "",
            ISSUE: PROJECT.issue,
            SHEETNO: number,
            SHEETOF: `SHEET ${index} OF ${SHEETS.length}`,
          },
        });
      });
      revisionTable(
        d,
        number === "M-101" ? [REVISIONS[0]!, { ...REVISIONS[1]!, what: "SHEET ADDED" }] : REVISIONS,
      );
      draw(d, sheet);
    },
  );
}

/** A point on the sheet. */
export type P = Point;
