// The title block, in two parts, as the firm keeps it:
//
// - The border: a drawing of its own, `Set up/TB-ARCHD.dwg`, which every sheet attaches on
//   its layout as an xref. It holds the lines, the labels, the firm and the project, in model
//   space, in paper inches, with its lower-left corner at 0,0.
// - The sheet's fields: a block of attributes, `SHEET FIELDS`, inserted on each layout over
//   the border. The firm fills these from the file's and the layout's names with fields, which
//   tsdraft cannot write, so here each is an attribute the code sets.
import { createDrawing, type Drawing, type Point } from "../../../src/index.ts";
import { FIRM, PROJECT } from "../project.ts";
import { FONT, H, STRIP, type D } from "./kit.ts";

/** Where each part of the strip lies, in paper inches. */
export const TB = {
  border: { left: 1.5, bottom: 0.5, right: 35.5, top: 23.5 },
  firmBottom: 21.2,
  projectBottom: 17.9,
  revBottom: 14.6,
  sealBottom: 11.1,
  eorBottom: 9.9,
  fieldRows: [9.9, 9.3, 8.7, 8.1],
  titleBottom: 4.0,
  numberBottom: 0.5,
} as const;

const L = STRIP.left;
const R = STRIP.right;
const MID = (L + R) / 2;
const PAD = 0.07;

/** The boxes of the four rows of small fields: two per row. */
export const FIELD_BOXES: Record<string, { at: Point; label: string }> = {
  DATE: { at: [L + PAD, TB.fieldRows[1]], label: "DATE" },
  JOB: { at: [MID + PAD, TB.fieldRows[1]], label: "JOB NO." },
  DRAWN: { at: [L + PAD, TB.fieldRows[2]], label: "DRAWN BY" },
  CHECKED: { at: [MID + PAD, TB.fieldRows[2]], label: "CHECKED BY" },
  SCALE: { at: [L + PAD, TB.fieldRows[3]], label: "SCALE" },
};

/** The border drawing, which is written to its own DWG and attached by every sheet. */
export function borderDrawing(): Drawing {
  const b = createDrawing({ units: "in" });
  b.textStyle({ name: "TB", font: FONT });
  b.textStyle({ name: "TB-TITLE", font: FONT, widthFactor: 0.9 });
  b.layer("G-TTLB-HEVY", { color: 7, lineweight: 0.7 });
  b.layer("G-TTLB", { color: 7, lineweight: 0.35 });
  b.layer("G-TTLB-FINE", { color: 7, lineweight: 0.13 });
  b.layer("G-TTLB-TEXT", { color: 7, lineweight: 0.25 });
  const t = (
    at: Point,
    value: string,
    height: number,
    o: {
      align?: "left" | "center" | "right";
      valign?: "top" | "middle" | "baseline";
      style?: string;
    } = {},
  ) => b.text(at, value, { height, ...o, style: o.style ?? "TB" });
  const { border } = TB;
  b.layer("G-TTLB-HEVY", {}, () => {
    b.rect([border.left, border.bottom], border.right - border.left, border.top - border.bottom);
    b.line([L, border.bottom], [L, border.top]);
  });
  b.layer("G-TTLB", {}, () => {
    for (const y of [
      TB.firmBottom,
      TB.projectBottom,
      TB.revBottom,
      TB.sealBottom,
      TB.eorBottom,
      TB.fieldRows[3],
      TB.titleBottom,
    ]) {
      b.line([L, y], [R, y]);
    }
  });
  b.layer("G-TTLB-FINE", {}, () => {
    for (const y of TB.fieldRows.slice(1, 3)) b.line([L, y], [R, y]);
    b.line([MID, TB.fieldRows[0]], [MID, TB.fieldRows[2]]);
  });
  b.layer("G-TTLB-TEXT", {}, () => {
    // The firm.
    t([MID, 22.95], FIRM.name, 0.3, { align: "center", style: "TB-TITLE" });
    t([MID, 22.55], FIRM.sub, H.label, { align: "center" });
    FIRM.lines.forEach((line, k) => t([MID, 22.2 - k * 0.16], line, H.small, { align: "center" }));
    // The project.
    const label = (y: number, value: string) => t([L + PAD, y], value, H.small, { valign: "top" });
    label(TB.firmBottom - PAD, "PROJECT");
    t([MID, 20.6], PROJECT.name, H.head, { align: "center", style: "TB-TITLE" });
    t([MID, 20.3], PROJECT.kind, H.small, { align: "center" });
    t([MID, 20.0], PROJECT.address, H.note, { align: "center" });
    t([MID, 19.8], PROJECT.city, H.note, { align: "center" });
    label(19.55, "OWNER");
    t([MID, 19.2], PROJECT.owner, H.note, { align: "center" });
    t([MID, 18.85], PROJECT.parcel, H.small, { align: "center" });
    t([MID, 18.65], `PARCEL ID ${PROJECT.parcelId}`, H.small, { align: "center" });
    t([MID, 18.35], PROJECT.county, H.small, { align: "center" });
    label(TB.projectBottom - PAD, "REVISIONS");
    label(TB.revBottom - PAD, "ENGINEER'S SEAL");
    t([MID, 13.0], "DEMONSTRATION SET", H.label, { align: "center" });
    t([MID, 12.75], "NOT FOR CONSTRUCTION", H.label, { align: "center" });
    t([MID, 12.45], "NO SEAL. NO ENGINEER OF RECORD.", H.small, { align: "center" });
    label(TB.sealBottom - PAD, "ENGINEER OF RECORD");
    t([MID, 10.45], "J. R. HALYARD, P.E. (FICTIONAL)", H.note, { align: "center" });
    t([MID, 10.15], "FLORIDA P.E. NO. 00000", H.small, { align: "center" });
    for (const [, box] of Object.entries(FIELD_BOXES)) {
      t([box.at[0], box.at[1] + 0.6 - PAD], box.label, H.small, { valign: "top" });
    }
    label(TB.fieldRows[3] - PAD, "SHEET TITLE");
    label(TB.titleBottom - PAD, "SHEET NUMBER");
  });
  return b.build();
}

/** Defines the block of a sheet's fields, whose attributes sit in the border's boxes. */
export function defineSheetFields(d: D): void {
  d.block("SHEET FIELDS", {}, () => {
    for (const [tag, box] of Object.entries(FIELD_BOXES)) {
      d.attribute(tag, [box.at[0], box.at[1] + 0.12], {
        value: "-",
        height: H.note,
        style: "NOTES",
        prompt: box.label,
      });
    }
    d.attribute("TITLE1", [MID, 7.3], {
      value: "-",
      height: 0.21,
      style: "TITLE",
      align: "center",
      prompt: "Sheet title",
    });
    d.attribute("TITLE2", [MID, 6.9], {
      value: "",
      height: 0.21,
      style: "TITLE",
      align: "center",
      prompt: "Sheet title, second line",
    });
    d.attribute("ISSUE", [MID, 4.5], {
      value: "",
      height: H.note,
      style: "NOTES",
      align: "center",
      prompt: "Issue",
    });
    d.attribute("SHEETNO", [MID, 2.1], {
      value: "-",
      height: 0.7,
      style: "TITLE",
      align: "center",
      valign: "middle",
      prompt: "Sheet number",
    });
    d.attribute("SHEETOF", [MID, 0.85], {
      value: "",
      height: H.note,
      style: "NOTES",
      align: "center",
      prompt: "Sheet of",
    });
  });
}

/** The revision table of a sheet, in paper space on the firm's layers, one per revision. */
export function revisionTable(
  d: D,
  revisions: readonly { no: string; date: string; what: string }[],
): void {
  const top = TB.projectBottom - 0.22;
  const rowH = (top - TB.revBottom - 0.02) / 9;
  const cols = [L, L + 0.35, L + 1.15, R];
  d.layer("Rev_Text", {}, () => {
    for (let r = 0; r <= 9; r++) d.line([L, top - r * rowH], [R, top - r * rowH]);
    for (const x of cols.slice(1, -1)) d.line([x, top], [x, top - 9 * rowH]);
    ["NO.", "DATE", "DESCRIPTION"].forEach((name, k) =>
      d.text([cols[k]! + 0.05, top - rowH / 2], name, {
        height: H.small,
        style: "NOTES",
        valign: "middle",
      }),
    );
  });
  revisions.slice(0, 8).forEach((rev, k) => {
    d.layer(`Rev_${k + 1}`, {}, () => {
      const y = top - (k + 1.5) * rowH;
      d.text([cols[0]! + 0.05, y], rev.no, { height: H.small, style: "NOTES", valign: "middle" });
      d.text([cols[1]! + 0.05, y], rev.date, { height: H.small, style: "NOTES", valign: "middle" });
      d.text([cols[2]! + 0.05, y], rev.what, { height: H.small, style: "NOTES", valign: "middle" });
    });
  });
}
