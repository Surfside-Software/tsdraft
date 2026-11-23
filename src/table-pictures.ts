// The tables of a drawing as both writers write them: each with its style, the key of its handles
// and its picture, and the name of the block that holds the picture.
import { blocksByKey } from "./blocks.ts";
import type { Drawing, Table, TableStyle, TextStyle } from "./drawing.ts";
import { boxer, type Boxer } from "./extents.ts";
import { layerKey } from "./layers.ts";
import { checksLimit } from "./lint.ts";
import { tableMeasures, tablePicture, type TablePicture, type TablePlace } from "./tables.ts";

/** A table of a drawing, with what the writers need to write it. */
export interface DrawnTable {
  readonly table: Table;
  /** 0 for model space, or 1 and on for each layout in the drawing's order. */
  readonly space: number;
  /** Its index among the entities of its space. */
  readonly index: number;
  /** The block of its picture: `*T` and its number among the drawing's tables, from 1. */
  readonly name: string;
  readonly place: TablePlace;
  readonly style: TableStyle;
  readonly picture: TablePicture;
}

/**
 * The tables of model space, then of each layout, that name a style of the drawing, with their
 * pictures. `boxOf` boxes a cell's block; missing, one is made for the drawing.
 */
export function drawingTables(drawing: Drawing, boxOf?: Boxer): DrawnTable[] {
  const styles = new Map((drawing.tableStyles ?? []).map((style) => [layerKey(style.name), style]));

  if (styles.size === 0) return [];

  const textStyles = new Map(
    (drawing.textStyles ?? []).map((style) => [layerKey(style.name), style]),
  );

  const styleOf = (name: string | undefined): TextStyle | undefined =>
    name === undefined ? undefined : textStyles.get(layerKey(name));

  const blocks = blocksByKey(drawing.blocks);

  const box =
    boxOf ??
    boxer(
      drawing.textStyles,
      drawing.blocks,
      undefined,
      undefined,
      undefined,
      drawing.dimensionStyles,
      drawing.leaderStyles,
      checksLimit(drawing),
    );

  const measures = tableMeasures(styleOf, (name) => {
    const found = blocks.get(layerKey(name));

    return found === undefined
      ? undefined
      : box([{ kind: "insert", layer: "0", block: found.name, at: [0, 0] }]);
  });

  const layouts = drawing.layouts ?? [];
  const out: DrawnTable[] = [];
  [drawing.entities, ...layouts.map((layout) => layout.entities)].forEach((entities, space) => {
    entities.forEach((entity, index) => {
      if (entity.kind !== "table") return;
      const style = styles.get(layerKey(entity.style));

      if (style === undefined) return;
      const layout = space === 0 ? undefined : layouts[space - 1]!.name;
      out.push({
        table: entity,
        space,
        index,
        name: `*T${out.length + 1}`,
        place: placeOf(index, entity.id, layout),
        style,
        picture: tablePicture(entity, style, measures),
      });
    });
  });

  return out;
}

/** Where a table is, with its id and its layout when it has them. */
function placeOf(index: number, id: string | undefined, layout: string | undefined): TablePlace {
  const place: TablePlace = id === undefined ? { index } : { index, id };

  return layout === undefined ? place : { ...place, layout };
}
