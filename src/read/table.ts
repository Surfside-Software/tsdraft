// A DXF's table and table style: the groups of an `ACAD_TABLE` after its subclass `AcDbTable`,
// read as they arrive, and a `TABLESTYLE` object. A table is read from the groups every save
// holds of it, its rows, columns and cells, and not from the objects of its dictionary.
import type { Point } from "../drawing.ts";
import { TABLE_CELLS, TABLE_COLUMNS } from "../rules.ts";
import { textOnce, unescaped } from "./groups.ts";
import type { ReadTableCell, ReadTableCellStyle, ReadTableStyle } from "./model.ts";
import { inSubclass, type Rec } from "./records.ts";

const HANDLE = /^[0-9A-Fa-f]{1,16}$/;

/** What a table's groups read as, but for what its style and its head say. */
export interface TableParts {
  readonly styleHandle: string | undefined;
  readonly blockHandle: string | undefined;
  readonly direction: Point;
  readonly rows: readonly number[];
  readonly columns: readonly number[];
  /** Whether the table itself hides its title and its header, where it says. */
  readonly noTitle: boolean | undefined;
  readonly noHeader: boolean | undefined;
  readonly cells: readonly ReadTableCell[];
}

export type TableReading =
  | { readonly table: TableParts }
  | { readonly other: string }
  | { readonly malformed: string };

/** A cell while its groups arrive. */
interface CellDraft {
  merged: boolean;
  /** Group 91: which of its style's fields it changes. */
  flags: number;
  block: boolean;
  fit: boolean;
  columnSpan: number;
  rowSpan: number;
  blockRecord?: string;
  blockScale?: number;
  alignment?: number;
  textHeight?: number;
  color?: number;
  fill?: number;
  noFill: boolean;
  /** Its text, from groups 2 and 1, and the string its value shows, from 303 and 302. */
  text: string;
  shown: string;
}

/** Group codes of doubles. */
const isDouble = (code: number): boolean =>
  (code >= 10 && code <= 59) || (code >= 110 && code <= 149);

/**
 * The groups of one table after `100 AcDbTable`, read as they arrive: its head, the height of
 * each row and the width of each column, then each cell, its own groups and its value up to
 * `ACVALUE_END`. It holds nothing past its limits: a table of more than `TABLE_COLUMNS` columns,
 * `TABLE_CELLS` cells or `rows` rows, or whose items pass `room`, is counted, never listed.
 */
export class TableGroups {
  readonly #room: number;
  readonly #rowLimit: number;
  #stage: "head" | "cell" | "value" = "head";
  /** How many 280 groups its head has had: the first is the version of its data. */
  #versions = 0;
  #styleHandle: string | undefined;
  #blockHandle: string | undefined;
  #direction: [number, number] = [1, 0];
  #rowCount: number | undefined;
  #columnCount: number | undefined;
  #noTitle: boolean | undefined;
  #noHeader: boolean | undefined;
  #rows: number[] = [];
  #columns: number[] = [];
  #cells: CellDraft[] = [];
  #cell: CellDraft | undefined;
  /** What it holds so far, counted as `costOf` counts a table, with every character it holds. */
  #items = 1;
  #characters = 0;
  /** Why it is not read, once that is known: then it holds nothing more. */
  #refused: TableReading | undefined;
  #broken = false;
  #mismatched = false;

  constructor(room: number, rowLimit: number) {
    this.#room = room;
    this.#rowLimit = rowLimit;
  }

  group(code: number, value: string): void {
    if (this.#refused) return;

    if (isDouble(code) && value.trim() !== "" && !Number.isFinite(Number(value))) {
      this.#broken = true;

      return;
    }

    if (code === 171) return this.#startCell(value);

    if (this.#stage === "head") return this.#head(code, value);
    const cell = this.#cell!;

    if (this.#stage === "value") {
      if (code === 1 || code === 2) this.#text(cell, "text", value);
      // The string its value shows, which a cell whose value holds no text gives.
      else if ((code === 302 || code === 303) && cell.text === "") this.#text(cell, "shown", value);
      else if (code === 304) this.#stage = "cell";

      return;
    }

    const n = Number(value);

    switch (code) {
      case 91:
        if (Number.isSafeInteger(n)) cell.flags = n;

        return;
      case 173:
        cell.merged = n !== 0;

        return;
      case 174:
        cell.fit = n !== 0;

        return;
      case 175:
        cell.columnSpan = Number.isSafeInteger(n) && n > 0 ? n : 1;

        return;
      case 176:
        cell.rowSpan = Number.isSafeInteger(n) && n > 0 ? n : 1;

        return;
      case 340:
        if (HANDLE.test(value.trim())) cell.blockRecord = value.trim();

        return;
      case 144:
        cell.blockScale = n;

        return;
      case 170:
        if (Number.isFinite(n)) cell.alignment = n;

        return;
      case 140:
        cell.textHeight = n;

        return;
      case 64:
        if (Number.isFinite(n)) cell.color = n;

        return;
      case 63:
        if (Number.isFinite(n)) cell.fill = n;

        return;
      // In a cell, 283 says it has no fill, where in a cell style it says it has one.
      case 283:
        cell.noFill = n === 1;

        return;
      // A file of the format before R2007 holds a cell's text among its own groups.
      case 1:
      case 2:
        this.#text(cell, "text", value);

        return;
      case 301:
        if (value.trim() === "CELL_VALUE") this.#stage = "value";

        return;
    }
  }

  #head(code: number, value: string): void {
    const n = Number(value);

    switch (code) {
      case 280:
        if (this.#versions++ > 0) this.#noTitle = n === 1;

        return;
      case 281:
        this.#noHeader = n === 1;

        return;
      case 342:
        if (HANDLE.test(value.trim())) this.#styleHandle = value.trim();

        return;
      case 343:
        if (HANDLE.test(value.trim())) this.#blockHandle = value.trim();

        return;
      case 11:
        this.#direction[0] = n;

        return;
      case 21:
        this.#direction[1] = n;

        return;
      case 91:
      case 92: {
        if (!Number.isSafeInteger(n) || n < 0) {
          this.#refused = { malformed: "ACAD_TABLE whose rows or columns are no whole number" };

          return;
        }

        if (code === 91) this.#rowCount = n;
        else this.#columnCount = n;
        this.#limit();

        return;
      }

      case 141:
        this.#size(this.#rows, this.#rowCount ?? this.#rowLimit, value);

        return;
      case 142:
        this.#size(this.#columns, this.#columnCount ?? TABLE_COLUMNS, value);

        return;
    }
  }

  /** Refuses a table past the core's limits, or of more rows than a read keeps items. */
  #limit(): void {
    const [rows, columns] = [this.#rowCount ?? 0, this.#columnCount ?? 0];

    if (columns > TABLE_COLUMNS)
      this.#refused = { other: `ACAD_TABLE of more than ${TABLE_COLUMNS} columns` };
    else if (rows * columns > TABLE_CELLS)
      this.#refused = { other: `ACAD_TABLE of more than ${TABLE_CELLS} cells` };
    else if (rows > this.#rowLimit)
      this.#refused = { other: `ACAD_TABLE of more than ${this.#rowLimit} rows` };
    else if (1 + rows + columns > this.#room) this.#refused = { other: "past the limit" };
  }

  #size(list: number[], most: number, value: string): void {
    if (list.length >= most) {
      this.#mismatched = true;

      return;
    }

    list.push(Number(value));
    this.#spend(1, 0);
  }

  #startCell(value: string): void {
    const most = Math.min(
      TABLE_CELLS,
      this.#rowCount === undefined || this.#columnCount === undefined
        ? TABLE_CELLS
        : this.#rowCount * this.#columnCount,
    );

    this.#stage = "cell";

    if (this.#cells.length >= most) {
      // Its groups are read into a cell that is not kept.
      this.#mismatched = true;
      this.#cell = draft(value);

      return;
    }

    this.#cell = draft(value);
    this.#cells.push(this.#cell);
    this.#spend(1, 0);
  }

  #text(cell: CellDraft, field: "text" | "shown", value: string): void {
    cell[field] += value;
    this.#spend(0, value.length);
  }

  #spend(items: number, characters: number): void {
    this.#items += items;
    this.#characters += characters;

    if (this.#items + Math.floor(this.#characters / 32) > this.#room) {
      this.#refused = { other: "past the limit" };
      this.#cells = [];
      this.#rows = [];
      this.#columns = [];
    }
  }

  /** What the table reads as, with each cell's block named from its record's handle. */
  end(blockName: (record: string) => string | undefined): TableReading {
    if (this.#refused) return this.#refused;

    if (this.#broken) return { malformed: "ACAD_TABLE with a number that is not finite" };
    const rows = this.#rowCount ?? this.#rows.length;
    const columns = this.#columnCount ?? this.#columns.length;

    if (
      this.#mismatched ||
      this.#rows.length !== rows ||
      this.#columns.length !== columns ||
      this.#cells.length !== rows * columns
    ) {
      return { malformed: "ACAD_TABLE whose rows, columns or cells are not as many as it says" };
    }

    const cells: ReadTableCell[] = [];
    this.#cells.forEach((c, i) => {
      if (c.merged) return;
      const text = c.text !== "" ? c.text : c.shown;
      const block = c.block && c.blockRecord !== undefined ? blockName(c.blockRecord) : undefined;
      cells.push({
        row: Math.floor(i / columns),
        column: i % columns,
        rowSpan: c.rowSpan,
        columnSpan: c.columnSpan,
        ...(!c.block && text !== "" && { text: textOnce(text) }),
        ...(block !== undefined && { block }),
        ...(block !== undefined &&
          !c.fit && { blockScale: Number.isFinite(c.blockScale) ? c.blockScale! : 1 }),
        ...((c.flags & ALIGNMENT_OWN) !== 0 &&
          c.alignment !== undefined && { alignment: c.alignment }),
        ...((c.flags & HEIGHT_OWN) !== 0 &&
          Number.isFinite(c.textHeight) && { textHeight: c.textHeight! }),
        ...((c.flags & COLOR_OWN) !== 0 && c.color !== undefined && { color: c.color }),
        ...((c.flags & FILL_OWN) !== 0 && c.fill !== undefined && !c.noFill && { fill: c.fill }),
      });
    });
    const [dx, dy] = this.#direction;
    const length = Math.hypot(dx, dy);

    const direction: Point =
      !Number.isFinite(length) || length === 0
        ? [1, 0]
        : Math.abs(length - 1) > 1e-9
          ? [dx / length, dy / length]
          : [dx, dy];

    return {
      table: {
        styleHandle: this.#styleHandle,
        blockHandle: this.#blockHandle,
        direction,
        rows: this.#rows,
        columns: this.#columns,
        noTitle: this.#noTitle,
        noHeader: this.#noHeader,
        cells,
      },
    };
  }
}

/** The bits of a cell's group 91 that say it changes its style's alignment, fill color, text color and text height. */
const ALIGNMENT_OWN = 0x1;
const FILL_OWN = 0x4;
const COLOR_OWN = 0x8;
const HEIGHT_OWN = 0x20;

function draft(type: string): CellDraft {
  return {
    merged: false,
    flags: 0,
    block: Number(type) === 2,
    fit: false,
    columnSpan: 1,
    rowSpan: 1,
    noFill: false,
    text: "",
    shown: "",
  };
}

/** The kinds of row in the order a table style holds their cell styles. */
const KINDS = ["data", "title", "header"] as const;

/** Where each kind of row puts its content where its cell style does not say: the top center, or the middle. */
const ALIGNMENT = { data: 2, title: 5, header: 5 } as const;

/** The leading CAD app's own sizes, which a style that states none has. */
const TEXT_HEIGHT = { data: 0.18, title: 0.25, header: 0.18 } as const;
const MARGIN = 0.06;

/** A table style as a `TABLESTYLE` holds it, with whether it hides its title and its header. */
export interface TableStyleHeld {
  readonly style: Omit<ReadTableStyle, "handle" | "name">;
  readonly noTitle: boolean;
  readonly noHeader: boolean;
}

/** The codes of a cell style's own fields, any of which starts the next cell style once it has it. */
const CELL_CODES = new Set([7, 140, 170, 62, 63, 283, 274]);

/**
 * A `TABLESTYLE`: its margins, whether it hides its title and its header, then a cell style for
 * each kind of row, in the order data, title, header. A cell style starts at its text style,
 * group 7, or at a field the one before already holds. A field a style leaves out is the leading
 * CAD app's own.
 */
export function tableStyleOf(r: Rec): TableStyleHeld {
  const own = inSubclass(r, "AcDbTableStyle");
  let horizontal = MARGIN;
  let vertical = MARGIN;
  let noTitle = false;
  let noHeader = false;
  let versions = 0;
  const cells: Map<number, string>[] = [];
  let cell: Map<number, string> | undefined;

  for (let i = 0; i < own.codes.length; i++) {
    const code = own.codes[i]!;
    const value = own.values[i]!;

    if (CELL_CODES.has(code)) {
      if (cell === undefined || code === 7 || cell.has(code)) {
        if (cells.length === KINDS.length) break;
        cell = new Map();
        cells.push(cell);
      }

      cell.set(code, value);
      continue;
    }

    if (cell !== undefined) continue;
    const n = Number(value);

    if (code === 40 && Number.isFinite(n)) horizontal = n;
    else if (code === 41 && Number.isFinite(n)) vertical = n;
    else if (code === 280 && versions++ > 0) noTitle = n === 1;
    else if (code === 281) noHeader = n === 1;
  }

  const styleOf = (kind: (typeof KINDS)[number], at: number): ReadTableCellStyle => {
    const groups = cells[at];

    const number = (code: number, otherwise: number): number => {
      const value = groups?.get(code);
      const n = Number(value);

      return value !== undefined && value.trim() !== "" && Number.isFinite(n) ? n : otherwise;
    };

    const textStyle = groups?.get(7);
    const filled = number(283, 0) === 1;

    return {
      textStyle: textStyle === undefined || textStyle === "" ? "Standard" : unescaped(textStyle),
      textHeight: number(140, TEXT_HEIGHT[kind]),
      alignment: number(170, ALIGNMENT[kind]),
      color: number(62, 0),
      ...(filled && { fill: number(63, 7) }),
      lineweight: number(274, -2),
    };
  };

  return {
    style: {
      horizontalMargin: horizontal,
      verticalMargin: vertical,
      data: styleOf("data", 0),
      title: styleOf("title", 1),
      header: styleOf("header", 2),
    },
    noTitle,
    noHeader,
  };
}
