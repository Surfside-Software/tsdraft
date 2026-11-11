// A drawing without the items `lint` reports as unreadable, so the rest of it can be drawn.
import type { Drawing, Entity } from "tsdraft";

/**
 * Stands in for an entity that is left out, so the entities after it keep their indexes. It
 * draws nothing, counts for nothing in the extents and is on no layer.
 */
export const LEFT_OUT: Entity = { kind: "polyline", layer: "", points: [], closed: false };

/**
 * The drawing without the items at `items`, which are the `item` paths of `lint`'s diagnostics:
 * an entry of a list, such as `layers[1]`, `blocks[0]` or `blocks[0].attributes[2]`, an entity,
 * such as `entities[3]` or `blocks[0].entities[1]`, a whole list, such as `xrefs`, or
 * `linetypeScale`.
 */
export function without(drawing: Drawing, items: ReadonlySet<string>): Drawing {
  const kept = <T>(list: readonly T[] | undefined, at: string): T[] | undefined =>
    items.has(at) || !Array.isArray(list)
      ? undefined
      : list.filter((_, i) => !items.has(`${at}[${i}]`));
  const entities = (list: readonly Entity[], at: string): Entity[] =>
    (kept(list, at) && list.map((e, i) => (items.has(`${at}[${i}]`) ? LEFT_OUT : e))) ?? [];
  const blocks =
    kept(drawing.blocks, "blocks") &&
    drawing.blocks!.flatMap((block, i) => {
      const at = `blocks[${i}]`;
      if (items.has(at)) return [];
      const attributes = items.has(`${at}.attributes`)
        ? []
        : kept(block.attributes, `${at}.attributes`);
      return [
        {
          ...block,
          entities: entities(block.entities, `${at}.entities`),
          ...(attributes ? { attributes } : {}),
        },
      ];
    });
  const { linetypes, textStyles, blocks: _, xrefs, linetypeScale, ...rest } = drawing;
  const lists = { linetypes, textStyles, xrefs };
  return {
    ...rest,
    layers: kept(drawing.layers, "layers") ?? [],
    entities: entities(drawing.entities, "entities"),
    ...(blocks ? { blocks } : {}),
    ...(linetypeScale === undefined || items.has("linetypeScale") ? {} : { linetypeScale }),
    ...Object.fromEntries(
      Object.entries(lists).flatMap(([field, list]) => {
        const sound = kept<unknown>(list, field);
        return sound ? [[field, sound]] : [];
      }),
    ),
  };
}
