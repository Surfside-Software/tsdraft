import { blocksByKey, eachDrawn, mapPoint, type LayerRef, type Referenced } from "./blocks.ts";
import { dimensionPicture, type Dimension } from "./dimensions.ts";
import type { Block, DimensionStyle, Entity, Text, TextStyle } from "./drawing.ts";
import { layerKey } from "./layers.ts";
import { measureText } from "./measure.ts";

/**
 * Approximate extents. Arcs use their full circle. A text counts for the box `measureText`
 * gives it, its capitals as long as the text plots, justified, turned and leaned as it is,
 * and for what its font draws below the baseline. An insert counts for what its block draws where the
 * insert puts it, with a circle or an arc under an uneven scale as the box around its circle.
 * An insert of an xref counts for the drawing given for it in `xrefs`, and for nothing without
 * one. A dimension counts for its lines, its arrowheads and its text, when `dimensionStyles`
 * holds its style.
 *
 * @param isHidden - True for a layer whose entities are left out, wherever they are drawn.
 * @param isFrozen - True for a layer that hides the whole of an insert on it: a frozen layer,
 *   and in a plot a layer that does not plot.
 * @param xrefs - The drawing of each xref, as `referencedByKey` gives them.
 */
export function extents(
  entities: readonly Entity[],
  textStyles: readonly TextStyle[] = [],
  blocks: readonly Block[] = [],
  isHidden: (layer: LayerRef) => boolean = () => false,
  isFrozen: (layer: LayerRef) => boolean = () => false,
  xrefs?: ReadonlyMap<string, Referenced>,
  dimensionStyles: readonly DimensionStyle[] = [],
): [number, number, number, number] {
  return (
    boxer(textStyles, blocks, isHidden, isFrozen, xrefs, dimensionStyles)(entities) ?? [0, 0, 1, 1]
  );
}

/**
 * A function that gives the box `extents` gives for some entities of one drawing, or
 * undefined when they draw nothing. The drawing's blocks and text styles are read once,
 * so the function can be asked for each entity of a large drawing in turn.
 */
export function boxer(
  textStyles: readonly TextStyle[] = [],
  blocks: readonly Block[] = [],
  isHidden: (layer: LayerRef) => boolean = () => false,
  isFrozen: (layer: LayerRef) => boolean = () => false,
  xrefs?: ReadonlyMap<string, Referenced>,
  dimensionStyles: readonly DimensionStyle[] = [],
): (entities: readonly Entity[]) => [number, number, number, number] | undefined {
  const stylesOf = (styles: readonly TextStyle[]): Map<string, TextStyle> =>
    new Map(styles.map((t) => [layerKey(t.name), t]));
  const own = stylesOf(textStyles);
  // The text styles of each referenced drawing, worked out when a text of it is first met.
  const referenced = new Map<Referenced, Map<string, TextStyle>>();
  let styles = own;
  const dimensionStylesOf = (list: readonly DimensionStyle[]): Map<string, DimensionStyle> =>
    new Map(list.map((style) => [layerKey(style.name), style]));
  const ownDimensionStyles = dimensionStylesOf(dimensionStyles);
  const referencedDimensionStyles = new Map<Referenced, Map<string, DimensionStyle>>();
  let stylesOfDimensions = ownDimensionStyles;
  /** What a dimension draws: its lines, its arrowheads, and its text as any text is boxed. */
  const dimension = (e: Dimension): void => {
    const style = stylesOfDimensions.get(layerKey(e.style));
    if (style === undefined) return;
    const picture = dimensionPicture(e, style);
    for (const line of [...picture.extensionLines, picture.dimensionLine]) {
      add(...line[0]);
      add(...line[1]);
    }
    for (const arrowhead of picture.arrowheads) for (const corner of arrowhead) add(...corner);
    const { label } = picture;
    const text: Text = {
      kind: "text",
      layer: e.layer,
      at: label.at,
      height: label.height,
      value: label.value,
      rotation: label.rotation,
      align: "center",
      ...(label.style === undefined ? {} : { style: label.style }),
    };
    one(text);
  };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const plain = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  let add = plain;
  const byKey = blocks.length > 0 || xrefs?.size ? blocksByKey(blocks) : undefined;
  const one = (e: Exclude<Entity, { kind: "insert" }>) => {
    switch (e.kind) {
      case "line":
        add(...e.from);
        add(...e.to);
        break;
      case "polyline":
        for (const p of e.points) add(...p);
        break;
      case "circle":
      case "arc":
        add(e.center[0] - e.radius, e.center[1] - e.radius);
        add(e.center[0] + e.radius, e.center[1] + e.radius);
        // The other two corners count too once an insert turns the box.
        if (add !== plain) {
          add(e.center[0] - e.radius, e.center[1] + e.radius);
          add(e.center[0] + e.radius, e.center[1] - e.radius);
        }
        break;
      case "text": {
        const style = e.style === undefined ? undefined : styles.get(layerKey(e.style));
        const { corners, descent } = measureText(style ? { ...e, ...style } : e);
        const [c0, c1, c2, c3] = corners;
        for (const [x, y] of corners) add(x, y);
        // What a font draws below the baseline follows the lean of the box's ends.
        const below = descent / e.height || 0;
        add(c0[0] - (c3[0] - c0[0]) * below, c0[1] - (c3[1] - c0[1]) * below);
        add(c1[0] - (c2[0] - c1[0]) * below, c1[1] - (c2[1] - c1[1]) * below);
        break;
      }
      case "linear-dimension":
      case "aligned-dimension":
        dimension(e);
        break;
    }
  };
  return (entities) => {
    [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const e of entities) {
      if (e.kind !== "insert") {
        one(e);
        continue;
      }
      if (!byKey) continue;
      eachDrawn(
        e,
        byKey,
        isFrozen,
        (drawn, { matrix, layer, frozen, from }) => {
          if (frozen || isHidden(layer) || !matrix) return;
          add = (x, y) => plain(...mapPoint(matrix, [x, y]));
          if (from && !referenced.has(from)) {
            referenced.set(from, stylesOf(from.drawing.textStyles ?? []));
          }
          styles = from ? referenced.get(from)! : own;
          if (from && !referencedDimensionStyles.has(from)) {
            referencedDimensionStyles.set(
              from,
              dimensionStylesOf(from.drawing.dimensionStyles ?? []),
            );
          }
          stylesOfDimensions = from ? referencedDimensionStyles.get(from)! : ownDimensionStyles;
          one(drawn);
        },
        xrefs,
      );
      add = plain;
      styles = own;
      stylesOfDimensions = ownDimensionStyles;
    }
    return minX === Infinity ? undefined : [minX, minY, maxX, maxY];
  };
}
