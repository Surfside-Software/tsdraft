// The built-in standard, as a document. Its layer names follow the public layer name format of
// the National CAD Standard, with a short list of its own. Its version goes up whenever what it
// states changes, and the CHANGELOG says so.
import { CENTER, DASHDOT, DASHED, DOT, HIDDEN, PHANTOM } from "../linetypes.ts";
import type { Linetype } from "../drawing.ts";
import {
  PLAIN_BOX,
  PLAIN_DRAWING_AREA,
  PLAIN_FIELDS,
  PLAIN_TITLE_BLOCK_NAME,
  PLAIN_TITLE_BLOCK_SPECIFIER,
} from "./title-block.ts";

/** What `extends` names the built-in standard by. */
export const BUILT_IN_SPECIFIER = "tsdraft/standard.json";

const linetype = ({ description, pattern }: Linetype) => ({ description, pattern });

const engineering = (feet: number) =>
  [`1in-${feet}ft`, { label: `1" = ${feet}'`, ratio: feet * 12 }] as const;
const architectural = (id: string, label: string, inches: number) =>
  [id, { label: `${label} = 1'-0"`, ratio: 12 / inches }] as const;

export const BUILT_IN_DOCUMENT = {
  id: "tsdraft",
  version: "1",
  paperUnits: "in",
  minTextHeight: 0.0625,
  linetypeScale: 0.5,
  plotStyle: "monochrome.ctb",
  defaultSheetFormat: "arch-d",
  defaultDimensionStyle: "dims",
  disciplines: {
    G: { title: "General" },
    C: { title: "Civil" },
    V: { title: "Survey" },
  },
  pens: {
    heavy: { lineweight: 0.7 },
    bold: { lineweight: 0.5 },
    medium: { lineweight: 0.35 },
    light: { lineweight: 0.25 },
    fine: { lineweight: 0.18 },
  },
  linetypes: {
    DASHED: linetype(DASHED),
    HIDDEN: linetype(HIDDEN),
    CENTER: linetype(CENTER),
    PHANTOM: linetype(PHANTOM),
    DASHDOT: linetype(DASHDOT),
    DOT: linetype(DOT),
  },
  layers: {
    "C-PROP": { color: 7, linetype: "PHANTOM", pen: "heavy", discipline: "C" },
    "C-PROP-ADJC": { color: 8, linetype: "PHANTOM", pen: "fine", discipline: "C" },
    "C-PROP-MONU": { color: 7, pen: "light", discipline: "C" },
    "C-SETB": { color: 1, linetype: "DASHED", pen: "light", discipline: "C" },
    "C-BLDG": { color: 5, pen: "heavy", discipline: "C" },
    "C-PAVE": { color: 8, pen: "medium", discipline: "C" },
    "C-ROAD-CNTR": { color: 8, linetype: "CENTER", pen: "fine", discipline: "C" },
    "C-ANNO-DIMS": { color: 8, pen: "fine", discipline: "C" },
    "C-ANNO-TEXT": { color: 7, pen: "light", discipline: "C" },
    "C-ANNO-SYMB": { color: 7, pen: "medium", discipline: "C" },
    "C-ANNO-TITL": { color: 7, pen: "bold", discipline: "C" },
    "G-ANNO-TTLB": { color: 7, pen: "medium", discipline: "G" },
    "G-ANNO-NPLT": { color: 8, plot: false, discipline: "G" },
  },
  textRoles: {
    note: { font: "Arial", height: 0.09375 },
    label: { font: "Arial", height: 0.125 },
    heading: { font: "Arial", height: 0.1875 },
    title: { font: "Arial", height: 0.25 },
    dimension: { font: "Arial", height: 0.09375 },
  },
  scales: Object.fromEntries([
    engineering(10),
    engineering(20),
    engineering(30),
    engineering(40),
    engineering(50),
    engineering(60),
    engineering(100),
    architectural("1-8in-1ft", '1/8"', 1 / 8),
    architectural("3-16in-1ft", '3/16"', 3 / 16),
    architectural("1-4in-1ft", '1/4"', 1 / 4),
    architectural("3-8in-1ft", '3/8"', 3 / 8),
    architectural("1-2in-1ft", '1/2"', 1 / 2),
    architectural("3-4in-1ft", '3/4"', 3 / 4),
    architectural("1in-1ft", '1"', 1),
    architectural("1-1-2in-1ft", '1 1/2"', 3 / 2),
    architectural("3in-1ft", '3"', 3),
  ]) as Readonly<Record<BuiltInScale, { readonly label: string; readonly ratio: number }>>,
  dimensionStyles: {
    dims: {
      role: "dimension",
      arrowhead: "architectural-tick",
      arrowSize: 0.125,
      extensionOffset: 0.0625,
      extensionBeyond: 0.125,
      textGap: 0.0625,
      writing: {
        ft: { precision: 1, suffix: "'" },
        in: { precision: 0, suffix: '"' },
        mm: { precision: 0 },
      },
    },
  },
  titleBlocks: {
    plain: {
      paper: "ARCH D",
      block: PLAIN_TITLE_BLOCK_SPECIFIER,
      blockName: PLAIN_TITLE_BLOCK_NAME,
      layer: "G-ANNO-TTLB",
      drawingArea: PLAIN_DRAWING_AREA,
      box: PLAIN_BOX,
      fields: PLAIN_FIELDS,
    },
  },
  sheetFormats: {
    "arch-d": {
      paper: "ARCH D",
      titleBlock: "plain",
      zones: {
        views: [0.5, 2, 27.5, 23.5],
        viewTitles: [0.5, 0.5, 27.5, 2],
        notes: [28.5, 3.5, 35.5, 23.5],
      },
    },
  },
} as const;

type BuiltInScale =
  | "1in-10ft"
  | "1in-20ft"
  | "1in-30ft"
  | "1in-40ft"
  | "1in-50ft"
  | "1in-60ft"
  | "1in-100ft"
  | "1-8in-1ft"
  | "3-16in-1ft"
  | "1-4in-1ft"
  | "3-8in-1ft"
  | "1-2in-1ft"
  | "3-4in-1ft"
  | "1in-1ft"
  | "1-1-2in-1ft"
  | "3in-1ft";
