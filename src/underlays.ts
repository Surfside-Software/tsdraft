// PDF underlays: where a page goes, its clip as the file holds it, the outline its frame draws,
// the colors it plots in, and the definition each page is written as. The writers, the plot, the
// extents and the readers all take an underlay from here, from the numbers as they are written.
import type { Drawing, Entity, Point, Underlay } from "./drawing.ts";
import { written } from "./format.ts";
import { keyHandle } from "./handles.ts";
import { exactKey } from "./images.ts";
import { layerKey } from "./layers.ts";
import { filled } from "./shape.ts";

/** A plain array of `count` finite numbers, read without running a getter. */
function finiteNumbers(value: unknown, count: number): boolean {
  if (
    !Array.isArray(value) ||
    value.length !== count ||
    Reflect.ownKeys(value).length !== count + 1
  )
    return false;
  for (let i = 0; i < count; i++) {
    const item = Object.getOwnPropertyDescriptor(value, i);
    if (!item || !("value" in item) || typeof item.value !== "number") return false;
    if (!Number.isFinite(item.value)) return false;
  }
  return true;
}

/**
 * Whether an underlay's fields can be drawn: a path and a page, a page size of two numbers above
 * 0, a point, a finite scale not 0, and a clip of two points or more, each a point, plain arrays
 * all. The plots and the extents leave out one that cannot, which `lint` refuses.
 */
export function underlayDrawable(underlay: Underlay, checked?: WeakMap<object, boolean>): boolean {
  const { path, page, pageSize, at, scale, rotation, clip } = underlay as Partial<
    Record<keyof Underlay, unknown>
  >;
  if (typeof path !== "string" || (page !== undefined && typeof page !== "string")) return false;
  if (!finiteNumbers(pageSize, 2) || !finiteNumbers(at, 2)) return false;
  const [w, h] = pageSize as [number, number];
  if (!(w > 0 && h > 0)) return false;
  if (scale !== undefined && !(typeof scale === "number" && Number.isFinite(scale) && scale !== 0))
    return false;
  if (rotation !== undefined && !(typeof rotation === "number" && Number.isFinite(rotation)))
    return false;
  if (clip === undefined) return true;
  if (!Array.isArray(clip) || clip.length < 2) return false;
  const known = checked?.get(clip);
  if (known !== undefined) return known;
  let sound = Reflect.ownKeys(clip).length === clip.length + 1;
  for (let i = 0; sound && i < clip.length; i++) {
    const item = Object.getOwnPropertyDescriptor(clip, i);
    sound = item !== undefined && "value" in item && finiteNumbers(item.value, 2);
  }
  checked?.set(clip, sound);
  return sound;
}

/** The page's name an underlay shows: its number from 1, `"1"` when it gives none. */
export const pageOf = (underlay: Underlay): string => underlay.page ?? "1";

/**
 * The vectors of one inch of an underlay's page in the drawing: along its bottom edge, and up its
 * side, from its scale and its turn.
 */
export function underlayVectors(underlay: Underlay): [u: Point, v: Point] {
  const turn = ((underlay.rotation ?? 0) * Math.PI) / 180;
  const quarter = Number.isInteger((underlay.rotation ?? 0) / 90);
  const cos = quarter ? Math.round(Math.cos(turn)) : Math.cos(turn);
  const sin = quarter ? Math.round(Math.sin(turn)) : Math.sin(turn);
  const s = written(underlay.scale ?? 1);
  return [
    [s * cos + 0, s * sin + 0],
    [-s * sin + 0, s * cos + 0],
  ];
}

/** The lower-left corner as written, and the vectors of one inch of the page. */
function placed(underlay: Underlay): { at: Point; u: Point; v: Point } {
  const [u, v] = underlayVectors(underlay);
  return { at: [written(underlay.at[0]), written(underlay.at[1])], u, v };
}

/** A point of the drawing in an underlay's page, in inches from the page's lower-left corner. */
export function toPage(at: Point, u: Point, v: Point, [x, y]: Point): Point {
  const det = u[0] * v[1] - u[1] * v[0];
  const [dx, dy] = [x - at[0], y - at[1]];
  return [(dx * v[1] - dy * v[0]) / det, (u[0] * dy - u[1] * dx) / det];
}

/** A point of an underlay's page, in inches from its lower-left corner, in the drawing. */
export function fromPage(at: Point, u: Point, v: Point, [x, y]: Point): Point {
  return [at[0] + x * u[0] + y * v[0], at[1] + x * u[1] + y * v[1]];
}

/** The corners of an underlay's page in the drawing, from its lower-left round counterclockwise. */
export function underlayCorners(underlay: Underlay): [Point, Point, Point, Point] {
  const { at, u, v } = placed(underlay);
  const [w, h] = underlay.pageSize;
  return [at, fromPage(at, u, v, [w, 0]), fromPage(at, u, v, [w, h]), fromPage(at, u, v, [0, h])];
}

/**
 * An underlay's clip as the file holds it, in inches of its page from its lower-left corner: a
 * rectangle by its top-left and bottom-right corners, as the leading CAD app saves one, or a
 * polygon's points as given, which that app does not close. Empty for no clip.
 */
export function underlayClip(underlay: Underlay): Point[] {
  if (underlay.clip === undefined) return [];
  const { at, u, v } = placed(underlay);
  const points = underlay.clip.map(([x, y]) => toPage(at, u, v, [written(x), written(y)]));
  if (points.length !== 2) return points;
  const [[x0, y0], [x1, y1]] = points as [Point, Point];
  return [
    [Math.min(x0, x1), Math.max(y0, y1)],
    [Math.max(x0, x1), Math.min(y0, y1)],
  ];
}

/**
 * The outline an underlay's frame draws, in the drawing, as a closed ring: its clip's, past the
 * page too, or the page's when it is not clipped. A rectangle of a clip is the one along the
 * page's sides through its corners.
 */
export function underlayFrame(underlay: Underlay): Point[] {
  if (underlay.clip === undefined) return underlayCorners(underlay);
  const { at, u, v } = placed(underlay);
  const clip = underlayClip(underlay);
  const back = (p: Point) => fromPage(at, u, v, p);
  if (clip.length === 2) {
    const [[x0, y1], [x1, y0]] = clip as [Point, Point];
    return [back([x0, y0]), back([x1, y0]), back([x1, y1]), back([x0, y1])];
  }
  return clip.map(back);
}

/** The flags of an underlay as the file holds them: clip 1, shown 2, monochrome 4, inverted 16. */
export function underlayFlags(underlay: Underlay): number {
  return (
    (underlay.clip !== undefined ? 1 : 0) |
    (underlay.on === false ? 0 : 2) |
    (underlay.monochrome === true ? 4 : 0) |
    (underlay.invertClip === true && underlay.clip !== undefined ? 16 : 0)
  );
}

/**
 * The color the leading CAD app plots a color of an underlay's page in, each part from 0 to 255:
 * made gray by its lightness when monochrome, its lightness drawn toward a middle gray by the
 * contrast, then mixed toward white by the fade.
 */
export function underlayColor(
  rgb: readonly [number, number, number],
  { fade, contrast, monochrome }: { fade: number; contrast: number; monochrome: boolean },
): [number, number, number] {
  let [r, g, b] = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
  if (monochrome) {
    const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
    [r, g, b] = [l, l, l];
  }
  if (contrast !== 100) {
    const k = contrast / 100;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const target = CONTRAST_GRAY + (l - CONTRAST_GRAY) * k;
    // The same hue and saturation at the new lightness.
    if (max === min) [r, g, b] = [target, target, target];
    else {
      const s = l <= 0.5 ? (max - min) / (max + min) : (max - min) / (2 - max - min);
      const q = target <= 0.5 ? target * (1 + s) : target + s - target * s;
      const p = 2 * target - q;
      const part = (x: number) => p + ((x - min) / (max - min)) * (q - p);
      [r, g, b] = [part(r), part(g), part(b)];
    }
  }
  if (fade !== 0) {
    const f = fade / 100;
    [r, g, b] = [r + (1 - r) * f, g + (1 - g) * f, b + (1 - b) * f];
  }
  const out = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
  return [out(r), out(g), out(b)];
}

/** The gray the contrast draws a lightness toward. */
const CONTRAST_GRAY = 0.44;

/** One page the underlays of a drawing show, as one definition of it. */
export interface UnderlayDefinition {
  /** Its name in the dictionary of PDF definitions: the file's name and its page, made unique. */
  readonly name: string;
  /** The path as the first underlay of it gives it. */
  readonly path: string;
  readonly page: string;
  readonly handle: string;
}

/** The key two paths of one file share: `\` and `/` are one. */
export function underlayPathKey(path: string): string {
  return path.replaceAll("\\", "/");
}

/**
 * The handle of the definition of a page of the file at `path`, from its path, with `\` and `/`
 * taken as one, and its page. Never change the key.
 */
export function underlayDefinitionHandle(path: string, page: string): string {
  return keyHandle(`underlay-definition:${underlayPathKey(path)}|${page}`);
}

/** The handle of the dictionary of PDF definitions, `ACAD_PDFDEFINITIONS`. */
export function underlayDictionaryHandle(): string {
  return keyHandle("dictionary:acad_pdfdefinitions");
}

/** The handle of the dictionary variable `PDFFRAME`. */
export function underlayFrameVariableHandle(): string {
  return keyHandle("dictionary-variable:pdfframe");
}

/** The name of the dictionary of PDF definitions, as the leading CAD app names it. */
export const UNDERLAY_DICTIONARY = "ACAD_PDFDEFINITIONS";

/** `PDFFRAME` as the drawing's frame setting holds it: 1 shows and plots, 0 neither, 2 shows. */
export function underlayFrameValue(frame: Drawing["underlayFrame"]): 0 | 1 | 2 {
  return frame === false ? 0 : frame === "screen" ? 2 : 1;
}

/**
 * The definitions of the pages a drawing's underlays show, in the order each is first met: one
 * for each path and page, with `\` and `/` taken as one. Each is named by its file's name without
 * its extension, then ` - ` and its page, as the leading CAD app names one, with a number in
 * brackets after the file's name for a name another file took first.
 */
export function underlayDefinitions(underlays: Iterable<Underlay>): UnderlayDefinition[] {
  const byKey = new Map<string, UnderlayDefinition>();
  const taken = new Set<string>();
  const found: UnderlayDefinition[] = [];
  // The next number to try after each name taken, so many files of one name are named in time.
  const next = new Map<string, number>();
  for (const underlay of underlays) {
    const path = underlayPathKey(underlay.path);
    const page = pageOf(underlay);
    const key = exactKey(`${page}|${path}`);
    if (byKey.has(key)) continue;
    const file = path.slice(path.lastIndexOf("/") + 1);
    const dot = file.lastIndexOf(".");
    const base = (dot > 0 ? file.slice(0, dot) : file) || "underlay";
    const nameOf = (stem: string) => `${stem} - ${page}`;
    const baseKey = exactKey(layerKey(nameOf(base)));
    let name = nameOf(base);
    if (taken.has(baseKey)) {
      let n = next.get(baseKey) ?? 2;
      while (taken.has(exactKey(layerKey(nameOf(`${base} (${n})`))))) n++;
      name = nameOf(`${base} (${n})`);
      next.set(baseKey, n + 1);
    }
    taken.add(exactKey(layerKey(name)));
    const definition: UnderlayDefinition = {
      name,
      path: underlay.path,
      page,
      handle: underlayDefinitionHandle(underlay.path, page),
    };
    byKey.set(key, definition);
    found.push(definition);
  }
  return found;
}

/**
 * Every underlay of a drawing, in the order the writers name their pages by: model space, each
 * layout, then each block, each list read up to its first empty slot.
 */
export function* drawingUnderlays(drawing: Drawing): Generator<Underlay> {
  const lists: (readonly Entity[] | undefined)[] = [
    drawing.entities,
    ...filled(drawing.layouts ?? []).map((layout) => layout.entities),
    ...filled(drawing.blocks ?? []).map((block) => block.entities),
  ];
  for (const list of lists) {
    for (const e of filled(list ?? [])) if (e.kind === "underlay") yield e;
  }
}

/**
 * The three lines the leading CAD app writes where an underlay's file is missing, from the top,
 * each with its baseline's start in the page's inches: one fifth of an inch high, a third apart,
 * the last on the insertion point.
 */
export function missingLines(underlay: Underlay): { value: string; at: Point }[] {
  const path = underlay.path.replaceAll("/", "\\");
  return [
    { value: "Missing or invalid reference", at: [0, 2 / 3] },
    { value: `File: ${path}`, at: [0, 1 / 3] },
    { value: `Sheet: ${pageOf(underlay)}`, at: [0, 0] },
  ];
}

/** The height of the lines of a missing file, in the page's inches. */
export const MISSING_HEIGHT = 0.2;

/** The fade a file means when it gives none: the leading CAD app's DXF saves no fade of 25. */
export const UNDERLAY_FADE_DEFAULT = 25;

/** The contrast a file means when it gives none: that app's DXF saves no contrast of 75. */
export const UNDERLAY_CONTRAST_DEFAULT = 75;

/** The most an underlay's fade may be, and the least its contrast, as the leading CAD app sets them. */
export const UNDERLAY_FADE_MOST = 80;
export const UNDERLAY_CONTRAST_LEAST = 20;

/**
 * The fade, contrast and monochrome an underlay plots in. A field that is not a whole number in
 * its range, which lint refuses, plots as none.
 */
export function underlayLook(underlay: Underlay): {
  fade: number;
  contrast: number;
  monochrome: boolean;
} {
  const { fade, contrast } = underlay as { fade?: unknown; contrast?: unknown };
  return {
    fade:
      Number.isInteger(fade) && (fade as number) >= 0 && (fade as number) <= UNDERLAY_FADE_MOST
        ? (fade as number)
        : 0,
    contrast:
      Number.isInteger(contrast) &&
      (contrast as number) >= UNDERLAY_CONTRAST_LEAST &&
      (contrast as number) <= 100
        ? (contrast as number)
        : 100,
    monochrome: underlay.monochrome === true,
  };
}

/** Whether an underlay plots its page in colors other than the page's own. */
export function underlayAdjusted(underlay: Underlay): boolean {
  const { fade, contrast, monochrome } = underlayLook(underlay);
  return fade !== 0 || contrast !== 100 || monochrome;
}

/**
 * Whether a picture `width` by `height` pixels has the shape of a page `size` inches, to a pixel
 * along each side: some one resolution draws both sides within a pixel of the picture's.
 */
export function pictureFits(
  width: number,
  height: number,
  size: readonly [number, number],
): boolean {
  const [w, h] = size;
  if (!(width > 0 && height > 0 && w > 0 && h > 0)) return false;
  return Math.max((width - 1) / w, (height - 1) / h) <= Math.min((width + 1) / w, (height + 1) / h);
}

/**
 * How far the lines of a missing file may reach from the page's corner, in the drawing's units:
 * each letter is held as wide as the lines are high.
 */
export function missingReach(underlay: Underlay): number {
  const longest = Math.max(
    "Missing or invalid reference".length,
    "File: ".length + underlay.path.length,
    "Sheet: ".length + pageOf(underlay).length,
  );
  return (longest + 1) * MISSING_HEIGHT * Math.abs(written(underlay.scale ?? 1));
}

/** Where `placed` puts the page, for the plot: its corner as written and its vectors. */
export function underlayPlacement(underlay: Underlay): { at: Point; u: Point; v: Point } {
  return placed(underlay);
}
