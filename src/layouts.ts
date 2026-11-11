// What a layout needs worked out: the keys of the handles of its own objects, the name of its
// block, and the view of model space each of its viewports shows.
import type { Drawing, Layout, Point, Units, Viewport } from "./drawing.ts";
import { written } from "./format.ts";
import { keyHandle } from "./handles.ts";
import { layoutNameKey } from "./layers.ts";
import type { PaperUnit } from "./paper.ts";
import { layoutNameProblem, viewportProblem } from "./rules.ts";
import { modelLength } from "./units.ts";

/**
 * A layout's name as its handles are keyed: A to Z in lower case and nothing else changed, as
 * `idKey` treats an id. AutoCAD takes two names with one key for one layout, so the duplicate
 * rule refuses the second. No table that can grow is part of this, and it must never change.
 */
function layoutKey(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** The handles of the objects a layout is made of in an R2018 drawing. */
export interface LayoutHandles {
  /** The layout itself: its page setup and its sheet. */
  readonly layout: string;
  /** The record of the block that holds what is drawn on the layout. */
  readonly record: string;
  /** The two objects that open and close that block's definition in a DXF. */
  readonly begin: string;
  readonly end: string;
  /** The viewport AutoCAD keeps for the sheet as a whole, the first of every layout. */
  readonly sheet: string;
}

/** `layoutHandles` for a name the layout rules have passed. */
export function validLayoutHandles(name: string): LayoutHandles {
  const key = layoutKey(name);
  return {
    layout: keyHandle(`layout:${key}`),
    record: keyHandle(`layout-block:${key}`),
    begin: keyHandle(`layout-begin:${key}`),
    end: keyHandle(`layout-end:${key}`),
    sheet: keyHandle(`layout-sheet:${key}`),
  };
}

/**
 * The handles of a layout's own objects in an R2018 drawing. They come from the layout's name
 * with A to Z in lower case, so the layout keeps them when the drawing around it changes.
 *
 * @throws RangeError when `name` is not a valid layout name.
 */
export function layoutHandles(name: string): LayoutHandles {
  const problem = layoutNameProblem(name);
  if (problem !== undefined) throw new RangeError(problem);
  return validLayoutHandles(name);
}

/**
 * The name of the block that holds a layout, by the layout's place in the drawing. AutoCAD
 * names the block of the layout it opens on `*Paper_Space`, and the others `*Paper_Space0`,
 * `*Paper_Space1` and so on.
 */
export function layoutBlockName(index: number): string {
  return index === 0 ? "*Paper_Space" : `*Paper_Space${index - 1}`;
}

/** What a viewport shows, with every number as the writers write it. */
export interface ViewportView {
  /** The middle of the viewport's rectangle on the paper. */
  readonly paperCenter: Point;
  /** The rectangle's size on the paper. */
  readonly width: number;
  readonly height: number;
  /** The point of model space at the middle of the rectangle. */
  readonly center: Point;
  /**
   * The height of model space the viewport shows, in drawing units. A file holds it where a
   * scale would be: AutoCAD takes the viewport's height over this for the scale.
   */
  readonly viewHeight: number;
  /** The box of model space the viewport shows: `[minX, minY, maxX, maxY]`. */
  readonly box: readonly [minX: number, minY: number, maxX: number, maxY: number];
  /** How many paper units one drawing unit takes in the viewport. */
  readonly scale: number;
}

/** `viewportView` for a viewport the rules have passed. */
export function validViewportView(
  viewport: Viewport,
  paperUnits: PaperUnit,
  units: Units,
): ViewportView {
  const [x, y] = [written(viewport.corner[0]), written(viewport.corner[1])];
  const [width, height] = [written(viewport.width), written(viewport.height)];
  const center: Point = [written(viewport.center[0]), written(viewport.center[1])];
  const viewHeight = written(modelLength(height, paperUnits, viewport.ratio, units));
  const scale = height / viewHeight;
  const halfWidth = width / scale / 2;
  return {
    paperCenter: [written(x + width / 2), written(y + height / 2)],
    width,
    height,
    center,
    viewHeight,
    box: [
      center[0] - halfWidth,
      center[1] - viewHeight / 2,
      center[0] + halfWidth,
      center[1] + viewHeight / 2,
    ],
    scale,
  };
}

/**
 * The view of model space a viewport shows: the box of the model it frames and the scale it
 * shows it at, from the viewport's rectangle and ratio, the units of its layout's paper and
 * the drawing's units. Every number is taken as the writers write it, with 6 decimals, so the
 * view is the one AutoCAD holds for the file.
 *
 * @param paperUnits - The units of the paper of the viewport's layout, as `PAPERS` gives them.
 * @param units - The drawing's units.
 * @throws RangeError when the viewport, the paper units or the units are not ones a drawing
 *   can hold.
 */
export function viewportView(
  viewport: Viewport,
  paperUnits: PaperUnit,
  units: Units,
): ViewportView {
  const problem = viewportProblem(viewport, paperUnits, units);
  if (problem !== undefined) throw new RangeError(problem);
  return validViewportView(viewport, paperUnits, units);
}

/**
 * The layout of this name, found as AutoCAD finds one, without regard to the case of the
 * letters it folds: `sheet` finds `Sheet`.
 */
export function findLayout(drawing: Pick<Drawing, "layouts">, name: string): Layout | undefined {
  const key = layoutNameKey(name);
  return drawing.layouts?.find((layout) => layoutNameKey(layout.name) === key);
}
