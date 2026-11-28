// The walks of a table made by hand that must stay bounded: what reading its cells costs, and what
// reading it again costs when it shares its lists with another, each read from fields of any type.
import { isObjectOrArray, isString } from "./guards.ts";
import { TABLE_CELLS } from "./rules.ts";
import { filled, Strings } from "./shape.ts";

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
