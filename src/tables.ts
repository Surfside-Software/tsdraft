// What a table needs worked out: the keys of the handles of a table style, of the dictionary that
// holds the styles and of a table's picture, the cell style of each kind of row, and where each
// cell of a table is once its spans are taken.
import type { Matrix } from "./blocks.ts";
import type {
  Insert,
  Paragraph,
  Point,
  ParagraphAlign,
  ParagraphVerticalAlign,
  Table,
  TableCell,
  TableCellContent,
  TableCellStyle,
  TableStyle,
} from "./drawing.ts";
import type { Block, TableOptions, TextStyle } from "./drawing.ts";
import { boxer } from "./extents.ts";
import { layerKey } from "./layers.ts";
import { TABLE_CELLS, tableProblem, tableStyleProblem } from "./rules.ts";
import { filled, Strings } from "./shape.ts";
import { keyHandle } from "./handles.ts";
import { layoutCellText, paragraphDirection, paragraphInStyle, placer } from "./paragraphs.ts";
import { isObjectOrArray, isString } from "./guards.ts";

/** The leading CAD app's own table style, which the writers add with a drawing's first. */
export const STANDARD_TABLE_STYLE = "Standard";

/** The sizes of the leading CAD app's own table style, which the writers add with a drawing's first. */
export const STANDARD_TABLE_STYLE_SIZES: TableStyle = {
  name: STANDARD_TABLE_STYLE,
  textHeight: 0.18,
  horizontalMargin: 0.06,
  verticalMargin: 0.06,
  title: { textHeight: 0.25 },
};

/** The name of the dictionary of table styles, as the leading CAD app names it. */
export const TABLE_STYLE_DICTIONARY = "ACAD_TABLESTYLE";

/** The kinds of row, in the order a table style holds their cell styles in a file. */
export const TABLE_ROW_KINDS = ["data", "title", "header"] as const;

export type TableRowKind = (typeof TABLE_ROW_KINDS)[number];

/** A name with A to Z in lower case, as the keys of the handles hold it. */
function lower(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** The handle of a table style whose name the rules have passed. */
export function validTableStyleHandle(name: string): string {
  return keyHandle(`table-style:${lower(name)}`);
}

/** The handle of the dictionary of table styles. */
export function tableStyleDictionaryHandle(): string {
  return keyHandle("dictionary:acad_tablestyle");
}

/** Where a table is: its id, or its index among the entities of model space or of a layout. */
export interface TablePlace {
  readonly id?: string;
  readonly layout?: string;
  readonly index: number;
}

/**
 * The key of a part of a table's picture: the table's id with A to Z in lower case, or `@`, its
 * layout's name in lower case, `/` and its index for one without an id. An id holds neither `@`
 * nor `/`, and a layout's name holds no `/`.
 */
export function tablePictureKey(place: TablePlace, part: string): string {
  const who =
    place.id !== undefined
      ? lower(place.id)
      : `@${place.layout === undefined ? "" : lower(place.layout)}/${place.index}`;

  return `table-picture:${who}/${part}`;
}

/** The handle of a part of a table's picture: `record`, `begin`, `end`, or a part it draws. */
export function tablePictureHandle(place: TablePlace, part: string): string {
  return keyHandle(tablePictureKey(place, part));
}

/** A cell style with every field it can default filled in from its table style. */
export interface CellStyleHeld {
  readonly textStyle: string | undefined;
  readonly textHeight: number;
  readonly align: ParagraphAlign;
  readonly valign: ParagraphVerticalAlign;
  readonly color: number | undefined;
  readonly fill: number | undefined;
  readonly lineweight: number | undefined;
}

/** Where each kind of row puts its content, unless its cell style says otherwise. */
const PLACE: Record<TableRowKind, readonly [ParagraphAlign, ParagraphVerticalAlign]> = {
  title: ["center", "middle"],
  header: ["center", "middle"],
  data: ["center", "top"],
};

/** The cell style of one kind of row of a table style. */
export function cellStyleOf(style: TableStyle, kind: TableRowKind): CellStyleHeld {
  const own: TableCellStyle = style[kind] ?? {};

  return {
    textStyle: own.textStyle ?? style.textStyle,
    textHeight: own.textHeight ?? style.textHeight,
    align: own.align ?? PLACE[kind][0],
    valign: own.valign ?? PLACE[kind][1],
    color: own.color,
    fill: own.fill,
    lineweight: own.lineweight,
  };
}

/** A table style's margins: across, then up and down. */
export function tableMargins(style: TableStyle): readonly [number, number] {
  return [
    style.horizontalMargin ?? style.textHeight / 3,
    style.verticalMargin ?? style.textHeight / 3,
  ];
}

/** A cell as the grid holds it: where it starts, how far it reaches and what it holds. */
export interface GridCell {
  readonly row: number;
  readonly column: number;
  readonly rows: number;
  readonly columns: number;
  readonly kind: TableRowKind;
  readonly content: TableCellContent;
}

/** The content of a cell given as a string or an object. */
export function cellContent(cell: TableCell): TableCellContent {
  return isString(cell) ? { text: cell } : cell;
}

/**
 * The rows of a table as a file holds them, from the top: the title, the header, then the data
 * rows, each with its kind and the least height given for it.
 */
export function tableRows(table: Table): {
  readonly kind: TableRowKind;
  readonly cells: readonly (TableCell | null)[];
  readonly height: number | undefined;
}[] {
  const out: {
    kind: TableRowKind;
    cells: readonly (TableCell | null)[];
    height: number | undefined;
  }[] = [];

  const count = table.columns.length;

  if (table.title !== undefined) {
    const cells: (TableCell | null)[] = [
      isString(table.title)
        ? { text: table.title, columnSpan: count }
        : { ...table.title, columnSpan: count },
    ];

    for (let c = 1; c < count; c++) cells.push(null);
    out.push({ kind: "title", cells, height: table.titleHeight });
  }

  if (table.header !== undefined) {
    out.push({ kind: "header", cells: table.header, height: table.headerHeight });
  }

  table.rows.forEach((cells, r) => {
    const height = table.rowHeights?.[r];
    out.push({ kind: "data", cells, height: height === null ? undefined : height });
  });

  return out;
}

/**
 * Each cell that starts a span, or stands alone, in reading order. The rules have checked that
 * every row holds a cell for each column, that a span stays inside the table and inside the
 * header or the data, and that the cells a span covers are `null`.
 */
export function gridCells(table: Table): GridCell[] {
  const out: GridCell[] = [];
  tableRows(table).forEach(({ kind, cells }, row) => {
    cells.forEach((cell, column) => {
      if (cell === null) return;
      const content = cellContent(cell);
      out.push({
        row,
        column,
        rows: content.rowSpan ?? 1,
        columns: content.columnSpan ?? 1,
        kind,
        content,
      });
    });
  });

  return out;
}

/** A line of a table's picture: a side of a cell, in the table's own coordinates. */
export interface TableLine {
  readonly from: Point;
  readonly to: Point;
  /** Its lineweight in millimetres, or undefined for its table's. */
  readonly lineweight: number | undefined;
}

/** A cell's text where the picture holds it: a paragraph held at `at` by `align` and `valign`. */
export interface TableText {
  readonly row: number;
  readonly column: number;
  readonly at: Point;
  readonly value: string;
  readonly height: number;
  readonly width: number;
  readonly align: ParagraphAlign;
  readonly valign: ParagraphVerticalAlign;
  readonly textStyle: string | undefined;
  readonly color: number | undefined;
}

/** A block in a cell, where the picture inserts it. */
export interface TableBlock {
  readonly row: number;
  readonly column: number;
  readonly block: string;
  readonly at: Point;
  readonly scale: number;
  /** What the block draws, in its own coordinates before its scale, or undefined for nothing. */
  readonly box?: readonly [number, number, number, number];
}

/** A cell's fill: its box, `[left, bottom, right, top]`, and its color index. */
export interface TableFill {
  readonly row: number;
  readonly column: number;
  readonly box: readonly [number, number, number, number];
  readonly color: number;
}

/**
 * What the leading CAD app draws for a table, in the table's own coordinates: X to the right and Y
 * up from its upper left corner, so every row is below 0. `rows` and `columns` are the height of
 * each row and the width of each column as the file holds them.
 */
export interface TablePicture {
  readonly rows: readonly number[];
  readonly columns: readonly number[];
  readonly fills: readonly TableFill[];
  readonly lines: readonly TableLine[];
  readonly texts: readonly TableText[];
  readonly blocks: readonly TableBlock[];
}

/** What `tablePicture` needs to measure a cell's text and to place a block. */
export interface TableMeasures {
  /** The height a text takes: its paragraph's box, from its first line's top to its last line's bottom. */
  readonly textHeight: (text: TableText) => number;
  /** A block's box in its own coordinates, `[left, bottom, right, top]`, or undefined for none. */
  readonly blockBox: (name: string) => readonly [number, number, number, number] | undefined;
}

/** The picture of a table the rules refuse. */
const NOTHING: TablePicture = {
  rows: [],
  columns: [],
  fills: [],
  lines: [],
  texts: [],
  blocks: [],
};

/** How tall a row is for each line of text at least, in text heights. */
const ROW_LINE = 4 / 3;

/**
 * The picture of a table: the height of each row, its fills, its lines, and where each cell's
 * text and block go. A table or a style that `tableProblem` or `tableStyleProblem` refuses has
 * an empty picture.
 */
export function tablePicture(
  table: Table,
  style: TableStyle,
  measures: TableMeasures,
): TablePicture {
  // A table or a style the rules refuse draws nothing, so no walk reads what it cannot bound.
  if (tableProblem(table) !== undefined || tableStyleProblem(style) !== undefined) return NOTHING;
  const [hm, vm] = tableMargins(style);
  const rows = tableRows(table);
  const cells = gridCells(table);
  const columns = table.columns;

  const styles = {
    title: cellStyleOf(style, "title"),
    header: cellStyleOf(style, "header"),
    data: cellStyleOf(style, "data"),
  };

  // Where each column starts, added up once from the left, in the order a sum from 0 takes.
  const lefts = [0];

  for (let c = 0; c < columns.length; c++) lefts.push(lefts[c]! + columns[c]!);
  const left = (column: number): number => lefts[column]!;

  const widthOf = (cell: GridCell): number => {
    let w = 0;

    for (let c = cell.column; c < cell.column + cell.columns; c++) w += columns[c]!;

    return w;
  };

  const textOf = (cell: GridCell): TableText | undefined => {
    const own = styles[cell.kind];
    const value = cell.content.text;

    if (value === undefined || value === "" || cell.content.block !== undefined) return undefined;

    return {
      row: cell.row,
      column: cell.column,
      at: [0, 0],
      value,
      height: cell.content.textHeight ?? own.textHeight,
      width: widthOf(cell) - 2 * hm,
      align: cell.content.align ?? own.align,
      valign: cell.content.valign ?? own.valign,
      textStyle: own.textStyle,
      color: cell.content.color ?? own.color,
    };
  };

  /** A block's box in its own coordinates and the scale it is drawn at in a cell of this size. */
  const blockFit = (
    cell: GridCell,
    room: readonly [number, number],
  ):
    | {
        readonly box: readonly [number, number, number, number];
        readonly drawn: readonly [number, number, number, number] | undefined;
        readonly scale: number;
      }
    | undefined => {
    const name = cell.content.block;

    if (name === undefined) return undefined;
    const drawn = measures.blockBox(name);
    const box = drawn ?? [0, 0, 0, 0];
    const size = [box[2] - box[0], box[3] - box[1]] as const;
    // Fitted by each side that has a size, so a line fits along its length; a point keeps 1.
    const fits = [0, 1].flatMap((i) => (size[i]! > 0 ? [room[i]! / size[i]!] : []));
    const scale = cell.content.blockScale ?? (fits.length > 0 ? Math.min(...fits) : 1);

    return { box, drawn, scale };
  };

  /** The height a cell's content needs: its text's, or its block's at its scale. */
  const contentHeight = (cell: GridCell, roomAcross: number): number | undefined => {
    if (cell.content.block !== undefined) {
      if (cell.content.blockScale === undefined) return undefined;
      const fit = blockFit(cell, [roomAcross, 0]);

      return fit === undefined ? undefined : (fit.box[3] - fit.box[1]) * fit.scale;
    }

    const text = textOf(cell);

    // A text takes at least a line of its own height.
    return text === undefined
      ? undefined
      : Math.max(measures.textHeight(text), ROW_LINE * text.height);
  };

  /** Where a cell's block goes: its box placed in the cell, less the margins, as its text would be. */
  const blockOf = (
    cell: GridCell,
    box: readonly [number, number, number, number],
  ): TableBlock | undefined => {
    const room: readonly [number, number] = [box[2] - box[0] - 2 * hm, box[3] - box[1] - 2 * vm];
    const fit = blockFit(cell, room);

    if (fit === undefined) return undefined;
    const own = styles[cell.kind];
    const align = cell.content.align ?? own.align;
    const valign = cell.content.valign ?? own.valign;

    const [b0, b1, b2, b3] = [
      fit.box[0] * fit.scale,
      fit.box[1] * fit.scale,
      fit.box[2] * fit.scale,
      fit.box[3] * fit.scale,
    ];

    let x = (box[0] + box[2]) / 2 - (b0 + b2) / 2;

    if (align === "left") x = box[0] + hm - b0;
    else if (align === "right") x = box[2] - hm - b2;
    let y = (box[1] + box[3]) / 2 - (b1 + b3) / 2;

    if (valign === "top") y = box[3] - vm - b3;
    else if (valign === "bottom") y = box[1] + vm - b1;

    const placed: TableBlock = {
      row: cell.row,
      column: cell.column,
      block: cell.content.block!,
      at: [x, y],
      scale: fit.scale,
    };

    return fit.drawn === undefined ? placed : { ...placed, box: fit.drawn };
  };

  // Each row at least as tall as a line of its text, then as its own cells need.
  const heights = rows.map(({ kind, height }) => {
    const least = ROW_LINE * styles[kind].textHeight + 2 * vm;

    return Math.max(height ?? 0, least);
  });

  for (const cell of cells) {
    if (cell.rows !== 1) continue;
    const content = contentHeight(cell, widthOf(cell) - 2 * hm);

    if (content === undefined) continue;
    const need = content + 2 * vm;

    if (need > heights[cell.row]!) heights[cell.row] = need;
  }

  // A cell over several rows grows the last of them.
  for (const cell of cells) {
    if (cell.rows === 1) continue;
    const content = contentHeight(cell, widthOf(cell) - 2 * hm);

    if (content === undefined) continue;
    const need = content + 2 * vm;
    let have = 0;

    for (let r = cell.row; r < cell.row + cell.rows; r++) have += heights[r]!;

    if (need > have) heights[cell.row + cell.rows - 1]! += need - have;
  }

  // Where each row starts, added up once from the top.
  const tops = [0];

  for (let r = 0; r < heights.length; r++) tops.push(tops[r]! - heights[r]!);
  const top = (row: number): number => tops[row]!;

  const boxOf = (cell: GridCell): readonly [number, number, number, number] => {
    const x0 = left(cell.column);
    const y1 = top(cell.row);
    let h = 0;

    for (let r = cell.row; r < cell.row + cell.rows; r++) h += heights[r]!;

    return [x0, y1 - h, x0 + widthOf(cell), y1];
  };

  const fills: TableFill[] = [];
  const texts: TableText[] = [];
  const blocks: TableBlock[] = [];

  for (const cell of cells) {
    const box = boxOf(cell);
    const fill = cell.content.fill ?? styles[cell.kind].fill;

    if (fill !== undefined) fills.push({ row: cell.row, column: cell.column, box, color: fill });
    const text = textOf(cell);

    if (text !== undefined) {
      let x = (box[0] + box[2]) / 2;

      if (text.align === "left") x = box[0] + hm;
      else if (text.align === "right") x = box[2] - hm;
      let y = (box[1] + box[3]) / 2;

      if (text.valign === "top") y = box[3] - vm;
      else if (text.valign === "bottom") y = box[1] + vm;

      texts.push({ ...text, at: [x, y] });
    }

    const placed = blockOf(cell, box);

    if (placed !== undefined) blocks.push(placed);
  }

  // Which cell holds each place of the grid, by its index in `cells`.
  const owner = new Int32Array(rows.length * columns.length).fill(-1);
  cells.forEach((cell, i) => {
    for (let r = cell.row; r < cell.row + cell.rows; r++) {
      for (let c = cell.column; c < cell.column + cell.columns; c++)
        owner[r * columns.length + c] = i;
    }
  });
  const ownerAt = (row: number, column: number): number => owner[row * columns.length + column]!;
  const weightOf = (row: number): number | undefined => styles[rows[row]!.kind].lineweight;
  const lines: TableLine[] = [];

  /**
   * Joins the pieces of one line of the grid: each piece that is drawn, with its lineweight, runs
   * on from the one before while the two share a lineweight, as the leading CAD app joins them.
   */
  const join = (
    count: number,
    drawn: (i: number) => boolean,
    weight: (i: number) => number | undefined,
    at: (i: number) => number,
    make: (from: number, to: number, lineweight: number | undefined) => TableLine,
  ): void => {
    let start: number | undefined;
    let held: number | undefined;

    for (let i = 0; i <= count; i++) {
      const open = i < count && drawn(i);
      const w = open ? weight(i) : undefined;

      if (start !== undefined && (!open || w !== held)) {
        lines.push(make(start, at(i), held));
        start = undefined;
      }

      if (open && start === undefined) {
        start = at(i);
        held = w;
      }
    }
  };

  for (let r = 0; r <= rows.length; r++) {
    const y = top(r);
    // A row's top is drawn where the cell above it is not the cell below it.
    join(
      columns.length,
      (c) => r === 0 || r === rows.length || ownerAt(r - 1, c) !== ownerAt(r, c),
      () => weightOf(Math.min(r, rows.length - 1)),
      left,
      (from, to, lineweight) => ({ from: [from, y], to: [to, y], lineweight }),
    );
  }

  for (let c = 0; c <= columns.length; c++) {
    const x = left(c);
    join(
      rows.length,
      (r) => c === 0 || c === columns.length || ownerAt(r, c - 1) !== ownerAt(r, c),
      weightOf,
      top,
      (from, to, lineweight) => ({ from: [x, from], to: [x, to], lineweight }),
    );
  }

  return { rows: heights, columns, fills, lines, texts, blocks };
}

/**
 * The measures of a drawing's tables: each text laid out as a paragraph in its style, from the top
 * of its first line's capitals to its last baseline, and each block's box from `blockBox`.
 */
export function tableMeasures(
  styleOf: (name: string | undefined) => TextStyle | undefined,
  blockBox: TableMeasures["blockBox"],
): TableMeasures {
  return {
    textHeight: (text) => {
      const layout = layoutCellText(
        paragraphInStyle(
          { value: text.value, height: text.height, width: text.width },
          styleOf(text.textStyle),
        ),
      );

      return layout.frame[3] - layout.frame[1];
    },
    blockBox,
  };
}

/** Where a table's picture puts a point of its own coordinates: turned by its rotation, at `at`. */
export function tableMatrix(table: Table): Matrix {
  const [cos, sin] = paragraphDirection(table.rotation);

  return [cos, sin, -sin, cos, table.at[0], table.at[1]];
}

/**
 * The box of what a table draws, in the drawing's coordinates, or undefined for nothing: its
 * grid, each cell's text's ink, and the box of each cell's block at its scale and place. A
 * block's box is the whole of what it draws, as its fit takes it, so a layer turned off inside it
 * still counts. `styleOf` gives a text style by its name. `blockBox`, given, boxes what a block
 * draws where that is more than it was fitted by, such as what it draws through an xref.
 */
export function tableBox(
  table: Table,
  picture: TablePicture,
  styleOf: (name: string | undefined) => TextStyle | undefined,
  blockBox?: (name: string) => readonly [number, number, number, number] | undefined,
): [number, number, number, number] | undefined {
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const [a, b, c, d, x0, y0] = tableMatrix(table);

  const add = (x: number, y: number): void => {
    const px = a * x + c * y + x0;
    const py = b * x + d * y + y0;
    box[0] = Math.min(box[0], px);
    box[1] = Math.min(box[1], py);
    box[2] = Math.max(box[2], px);
    box[3] = Math.max(box[3], py);
  };

  let width = 0;

  for (const w of picture.columns) width += w;
  let height = 0;

  for (const h of picture.rows) height += h;

  if (picture.columns.length > 0) {
    add(0, 0);
    add(width, 0);
    add(width, -height);
    add(0, -height);
  }

  for (const text of picture.texts) {
    const paragraph = tableParagraph(table, text);
    const layout = layoutCellText(paragraphInStyle(paragraph, styleOf(text.textStyle)));

    if (!layout.ink) continue;
    const place = placer(paragraph);
    const [i0, j0, i1, j1] = layout.ink;

    // Already in the drawing's coordinates, so each goes in as it is.
    for (const [x, y] of [place(i0, j0), place(i1, j0), place(i1, j1), place(i0, j1)]) {
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
    }
  }

  for (const block of picture.blocks) {
    const drawn = blockBox ? blockBox(block.block) : block.box;

    if (drawn === undefined) continue;
    const [x, y] = block.at;
    const s = block.scale;
    const [b0, b1, b2, b3] = drawn;
    add(x + s * b0, y + s * b1);
    add(x + s * b2, y + s * b1);
    add(x + s * b2, y + s * b3);
    add(x + s * b0, y + s * b3);
  }

  return box[0] === Infinity ? undefined : box;
}

/** A cell's text as a paragraph, where the picture places it in the table's space. */
export function tableParagraph(table: Table, text: TableText): Paragraph {
  const [a, b, c, d, e, f] = tableMatrix(table);
  const [x, y] = text.at;

  const at: Point = [a * x + c * y + e, b * x + d * y + f];
  const { height, value, width, align, valign, textStyle } = text;
  const { layer } = table;
  const rotation = table.rotation ?? 0;

  return textStyle === undefined
    ? { kind: "paragraph", layer, at, height, value, rotation, width, align, valign }
    : {
        kind: "paragraph",
        layer,
        at,
        height,
        value,
        rotation,
        width,
        style: textStyle,
        align,
        valign,
      };
}

/** The insert of each block a table's cells hold, where the picture places it, on the table's layer. */
export function tableInserts(table: Table, picture: TablePicture): Insert[] {
  const [a, b, c, d, e, f] = tableMatrix(table);

  return picture.blocks.map((block) => {
    const [x, y] = block.at;

    const placed: Insert = {
      kind: "insert",
      layer: table.layer,
      block: block.block,
      at: [a * x + c * y + e, b * x + d * y + f],
      scale: [block.scale, block.scale],
    };

    return table.rotation === undefined || table.rotation === 0
      ? placed
      : { ...placed, rotation: table.rotation };
  });
}

/** A table's size, as `measureTable` gives it. */
export interface TableMeasure {
  /** How wide it is: its columns' widths added up. */
  readonly width: number;
  /** How tall it is: its rows' heights added up, each as tall as its cells need. */
  readonly height: number;
  /** The height of each row, from the top: the title's, the header's, then each data row's. */
  readonly rows: readonly number[];
  readonly columns: readonly number[];
}

/**
 * How large a table is drawn in its style, with each row as tall as its cells need, as the leading
 * CAD app lays it out: for placing what goes below or beside it. `textStyles` and `blocks` are
 * the drawing's, which its style and its cells name.
 *
 * ```ts
 * const { height } = measureTable(schedule, SCHEDULE_STYLE, textStyles);
 * ```
 */
export function measureTable(
  table: TableOptions,
  style: TableStyle,
  textStyles: readonly TextStyle[] = [],
  blocks: readonly Block[] = [],
): TableMeasure {
  const named = (name: string | undefined) =>
    name === undefined ? undefined : textStyles.find((t) => layerKey(t.name) === layerKey(name));

  // One boxer for the call, which keeps the box of each block it reads.
  const box = boxer(textStyles, blocks);
  const known = new Map<string, readonly [number, number, number, number] | undefined>();

  const picture = tablePicture(
    { ...table, kind: "table", layer: "0" },
    style,
    tableMeasures(named, (name) => {
      const k = layerKey(name);

      if (!known.has(k))
        known.set(k, box([{ kind: "insert", layer: "0", block: name, at: [0, 0] }]));

      return known.get(k);
    }),
  );

  return {
    width: picture.columns.reduce((sum, w) => sum + w, 0),
    height: picture.rows.reduce((sum, h) => sum + h, 0),
    rows: picture.rows,
    columns: picture.columns,
  };
}

/** The shortest text of a cell that `tableRepeats` tells apart by its value. */
const LONG = 256;

/**
 * For the tables of one call, what reading a table again costs when it shares its rows, a row, a
 * cell or a text of `LONG` characters or more with a table read before, as a drawing made in code
 * may: a unit for each row and each cell, and one for each 32 characters of a text. 0 for a table
 * that shares none, whose lists the drawing holds. A table of more cells than the rules allow
 * costs nothing here, since nothing reads its cells.
 */
export function tableRepeats(): (table: unknown) => number {
  const lists = new WeakMap<object, { readonly cost: number; readonly shares: boolean }>();
  const cells = new WeakSet<object>();
  const texts = new Strings<true>();

  const text = (value: unknown): [number, boolean] => {
    if (!isString(value)) return [1, false];
    const long = value.length >= LONG;
    const again = long && (texts.get(value) !== undefined || texts.clashes(value));

    if (long) texts.set(value, true);

    return [1 + Math.floor(value.length / 32), again];
  };

  const cell = (value: unknown): [number, boolean] => {
    if (isString(value)) return text(value);

    if (!isObjectOrArray(value)) return [1, false];
    const again = cells.has(value);
    cells.add(value);
    const [cost, shared] = text("text" in value ? value.text : undefined);

    return [cost, again || shared];
  };

  const read = (list: unknown, item: (value: unknown) => [number, boolean]): [number, boolean] => {
    if (!Array.isArray(list)) return [0, false];
    const known = lists.get(list);

    if (known) return [known.cost, true];
    let cost = 0;
    let shares = false;

    for (const value of filled(list)) {
      const [more, again] = item(value);
      cost += more;
      shares ||= again;
    }

    lists.set(list, { cost, shares });

    return [cost, shares];
  };

  const row = (value: unknown): [number, boolean] => {
    const [cost, shares] = read(value, cell);

    return [1 + cost, shares];
  };

  return (table) => {
    if (!isObjectOrArray(table)) return 0;
    const { columns, rows, header, title } = fieldsOf(table);
    const width = Array.isArray(columns) ? columns.length : 0;

    const height =
      (Array.isArray(rows) ? rows.length : 0) +
      (header === undefined ? 0 : 1) +
      (title === undefined ? 0 : 1);

    if (width === 0 || width * height > TABLE_CELLS) return 0;
    const [ofRows, sharedRows] = read(rows, row);
    const [ofHeader, sharedHeader] = row(header);
    const [ofTitle, sharedTitle] = cell(title);

    return sharedRows || sharedHeader || sharedTitle ? ofRows + ofHeader + ofTitle : 0;
  };
}

/**
 * What reading a table's cells costs, before any of them is read: a unit for each cell and one for
 * each 32 characters of its text. 0 for a table whose cells the rules refuse to read: one of more
 * than `TABLE_CELLS` cells, or with no list of columns or rows.
 */
export function tableCost(table: unknown): number {
  if (!isObjectOrArray(table)) return 0;
  const { columns, rows, header, title } = fieldsOf(table);

  if (!Array.isArray(columns) || !Array.isArray(rows)) return 0;
  const width = columns.length;
  const height = rows.length + (header === undefined ? 0 : 1) + (title === undefined ? 0 : 1);

  // No column, or more cells than the rules allow: no row is read.
  if (width === 0 || width * height > TABLE_CELLS) return 0;

  const of = (cell: unknown): number => {
    const text = isString(cell)
      ? cell
      : isObjectOrArray(cell) && "text" in cell
        ? cell.text
        : undefined;

    return 1 + (isString(text) ? Math.floor(text.length / 32) : 0);
  };

  const row = (list: unknown): number => {
    if (!Array.isArray(list)) return 0;
    let cost = 0;

    for (let c = 0; c < list.length && c < width; c++) cost += of(list[c]);

    return cost;
  };

  let cost = of(title) + row(header);

  for (let r = 0; r < rows.length; r++) cost += row(rows[r]);

  return cost;
}

/** Each cell's text with the text style of its row and where it is, for `tableTextsProblem`. */
export function tableTexts(
  table: Table,
  style: TableStyle,
): { readonly text: string; readonly textStyle: string | undefined; readonly at: string }[] {
  const out: { text: string; textStyle: string | undefined; at: string }[] = [];
  const first = (table.title === undefined ? 0 : 1) + (table.header === undefined ? 0 : 1);

  for (const cell of gridCells(table)) {
    const text = cell.content.text;

    if (text === undefined || text === "") continue;

    let at = `rows[${cell.row - first}][${cell.column}]`;

    if (cell.kind === "title") at = "title";
    else if (cell.kind === "header") at = `header[${cell.column}]`;

    out.push({ text, textStyle: cellStyleOf(style, cell.kind).textStyle, at });
  }

  return out;
}

/** The fields of a table the walks count before they read it, each as a caller gives it. */
interface TableFields {
  readonly columns: unknown;
  readonly rows: unknown;
  readonly header: unknown;
  readonly title: unknown;
}

function fieldsOf<Given extends object>(table: Given): TableFields {
  return {
    columns: "columns" in table ? table.columns : undefined,
    rows: "rows" in table ? table.rows : undefined,
    header: "header" in table ? table.header : undefined,
    title: "title" in table ? table.title : undefined,
  };
}
