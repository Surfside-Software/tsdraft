import { blocksByKey, eachDrawn, mapPoint, type LayerRef, type Referenced } from "./blocks.ts";
import type { Block, Entity, TextStyle } from "./drawing.ts";
import { layerKey } from "./layers.ts";

/**
 * How far a text on its bottom starts above its point, as a share of its height. Fonts differ,
 * and this box is an estimate.
 */
const DESCENT = 0.3;

/**
 * Approximate extents. Arcs use their full circle. A text assumes 0.6 × height per character,
 * times its style's width factor, and is moved for its justification: back along its line for
 * `align`, and down or up it for `valign`. An insert counts for what its block draws where the
 * insert puts it, with a circle or an arc under an uneven scale as the box around its circle.
 * An insert of an xref counts for the drawing given for it in `xrefs`, and for nothing without
 * one.
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
): [number, number, number, number] {
  return boxer(textStyles, blocks, isHidden, isFrozen, xrefs)(entities) ?? [0, 0, 1, 1];
}

/**
 * A function that gives the box `extents` gives for some entities of one drawing, or
 * undefined when they draw nothing. The drawing's blocks and text styles are read once,
 * so the function can be asked for each entity of a large drawing in turn.
 *
 * @param slanted - Also holds the top of each text where its style's oblique angle leans it,
 *   which `extents` leaves out.
 */
export function boxer(
  textStyles: readonly TextStyle[] = [],
  blocks: readonly Block[] = [],
  isHidden: (layer: LayerRef) => boolean = () => false,
  isFrozen: (layer: LayerRef) => boolean = () => false,
  xrefs?: ReadonlyMap<string, Referenced>,
  slanted = false,
): (entities: readonly Entity[]) => [number, number, number, number] | undefined {
  /** A style's width factor, and how far one height of it leans before that factor widens it. */
  const factorsOf = (styles: readonly TextStyle[]): Map<string, readonly [number, number]> =>
    new Map(
      styles.map((t) => [
        layerKey(t.name),
        [t.widthFactor ?? 1, slanted ? Math.tan(rad(t.obliqueAngle ?? 0)) : 0],
      ]),
    );
  const own = factorsOf(textStyles);
  // The text styles of each referenced drawing, worked out when a text of it is first met.
  const referenced = new Map<Referenced, Map<string, readonly [number, number]>>();
  let widthFactors = own;
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
        const [widthFactor, lean] =
          e.style === undefined ? [1, 0] : (widthFactors.get(layerKey(e.style)) ?? [1, 0]);
        const len = e.value.length * e.height * 0.6 * widthFactor;
        const r = rad(e.rotation);
        // The share of the text's length that lies before its justification point.
        const before = e.align === "center" ? 0.5 : e.align === "right" ? 1 : 0;
        // How far the baseline is above the point, as a share of the height.
        const lift =
          e.valign === "top"
            ? -1
            : e.valign === "middle"
              ? -0.5
              : e.valign === "bottom"
                ? DESCENT
                : 0;
        const start: [number, number] = [
          e.at[0] - before * len * Math.cos(r) - lift * e.height * Math.sin(r),
          e.at[1] - before * len * Math.sin(r) + lift * e.height * Math.cos(r),
        ];
        add(...start);
        add(start[0] + len * Math.cos(r), start[1] + len * Math.sin(r));
        const up: [number, number] = [-e.height * Math.sin(r), e.height * Math.cos(r)];
        add(start[0] + up[0], start[1] + up[1]);
        // The fourth corner, which is the far one of a text that is turned.
        add(start[0] + len * Math.cos(r) + up[0], start[1] + len * Math.sin(r) + up[1]);
        if (Number.isFinite(lean) && lean !== 0) {
          // The top of a slanted text lies further along it, or further back.
          for (const along of [0, len]) {
            const far = along + e.height * lean * widthFactor;
            add(start[0] + far * Math.cos(r) + up[0], start[1] + far * Math.sin(r) + up[1]);
          }
        }
        break;
      }
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
            referenced.set(from, factorsOf(from.drawing.textStyles ?? []));
          }
          widthFactors = from ? referenced.get(from)! : own;
          one(drawn);
        },
        xrefs,
      );
      add = plain;
      widthFactors = own;
    }
    return minX === Infinity ? undefined : [minX, minY, maxX, maxY];
  };
}

function rad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
