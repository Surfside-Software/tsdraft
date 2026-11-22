// Images: where an image's pixels go, its clip as the file holds it, the outline its frame
// draws, and the definition each file is written as. The writers, the plot, the extents and the
// readers all take an image from here, from the numbers as they are written.
import type { Drawing, Entity, Image, Point } from "./drawing.ts";
import { written } from "./format.ts";
import { keyHandle } from "./handles.ts";
import { layerKey } from "./layers.ts";
import { imagePixelsProblem } from "./rules.ts";
import { sha256Text } from "./sha256.ts";
import { drawableClip, filled, isFinitePoint, KEYED } from "./shape.ts";

/**
 * A key of a `Map` for a string of any length, which no other string has: the string itself, or
 * for one longer than V8 hashes by its characters, its SHA-256.
 */
export function exactKey(text: string): string {
  return text.length <= KEYED ? `=${text}` : `#${sha256Text(text)}`;
}

/**
 * Whether an image's fields can be drawn: a path, its pixels, a point and finite sizes not 0, and
 * a clip of two points or more, each a point, plain arrays all. The plots and the extents leave
 * out one that cannot, which `lint` refuses.
 */
export function imageDrawable(image: Image, checked?: WeakMap<object, boolean>): boolean {
  const { path, pixels, at, width, height, rotation, clip } = image as Partial<
    Record<keyof Image, unknown>
  >;
  const size = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n !== 0;
  if (typeof path !== "string" || imagePixelsProblem(pixels) !== undefined) return false;
  if (!isFinitePoint(at) || !size(width) || !size(height)) return false;
  if (rotation !== undefined && !(typeof rotation === "number" && Number.isFinite(rotation)))
    return false;
  return drawableClip(clip, checked);
}

/** The vectors of one pixel of an image: along its bottom edge, and up its side. */
export function imageVectors(image: Image): [u: Point, v: Point] {
  const turn = ((image.rotation ?? 0) * Math.PI) / 180;
  // A turn by a whole quarter is exact, as the leading CAD app saves one.
  const quarter = Number.isInteger((image.rotation ?? 0) / 90);
  const cos = quarter ? Math.round(Math.cos(turn)) : Math.cos(turn);
  const sin = quarter ? Math.round(Math.sin(turn)) : Math.sin(turn);
  const [du, dv] = [image.width / image.pixels[0], image.height / image.pixels[1]];
  return [
    [du * cos + 0, du * sin + 0],
    [-dv * sin + 0, dv * cos + 0],
  ];
}

/** The lower-left corner as written, and the vectors of one pixel. */
function placed(image: Image): { at: Point; u: Point; v: Point } {
  const [u, v] = imageVectors(image);
  return { at: [written(image.at[0]), written(image.at[1])], u, v };
}

/**
 * A point of the drawing in an image's pixels, as its clip holds them: across from the centers of
 * its left column, and down from the centers of its top row, so the image spans -0.5 to its width
 * less 0.5 one way and -0.5 to its height less 0.5 the other.
 */
export function toImagePixels(
  at: Point,
  u: Point,
  v: Point,
  pixels: readonly [number, number],
  [x, y]: Point,
): Point {
  const det = u[0] * v[1] - u[1] * v[0];
  const [dx, dy] = [x - at[0], y - at[1]];
  const s = (dx * v[1] - dy * v[0]) / det;
  const t = (u[0] * dy - u[1] * dx) / det;
  return [s - 0.5, pixels[1] - t - 0.5];
}

/** A point of an image's pixels, as its clip holds them, in the drawing. */
export function fromImagePixels(
  at: Point,
  u: Point,
  v: Point,
  pixels: readonly [number, number],
  [x, y]: Point,
): Point {
  const [s, t] = [x + 0.5, pixels[1] - y - 0.5];
  return [at[0] + s * u[0] + t * v[0], at[1] + s * u[1] + t * v[1]];
}

/** A clip as the file holds it: 1 for a rectangle by two corners, 2 for a polygon, in pixels. */
export interface ImageClip {
  readonly type: 1 | 2;
  readonly points: readonly Point[];
}

/**
 * An image's clip as the file holds it. With none, the whole image: its two corners. A rectangle's
 * corners are its lower and upper, as the leading CAD app's own `IMAGECLIP` writes them, and a
 * polygon ends at its first point again, without which that app discards the drawing.
 */
export function imageClip(image: Image): ImageClip {
  const [w, h] = image.pixels;
  if (image.clip === undefined) {
    return {
      type: 1,
      points: [
        [-0.5, -0.5],
        [w - 0.5, h - 0.5],
      ],
    };
  }
  const { at, u, v } = placed(image);
  const points = image.clip.map(([x, y]) =>
    toImagePixels(at, u, v, image.pixels, [written(x), written(y)]),
  );
  if (points.length === 2) {
    const [[x0, y0], [x1, y1]] = points as [Point, Point];
    return {
      type: 1,
      points: [
        [Math.min(x0, x1), Math.min(y0, y1)],
        [Math.max(x0, x1), Math.max(y0, y1)],
      ],
    };
  }
  const [first] = points;
  const last = points.at(-1)!;
  const closed = first![0] === last[0] && first![1] === last[1];
  return { type: 2, points: closed ? points : [...points, first!] };
}

/**
 * Whether a clip as a file holds it, in pixels, is the whole image's rectangle, which the leading
 * CAD app saves for an image it does not clip: to a billionth of the image, since a DXF of the
 * same save may hold 99.50000000000001 where the DWG holds 99.5.
 */
export function wholeImageClip(
  type: number,
  points: readonly Point[],
  [w, h]: readonly [number, number],
): boolean {
  if (type !== 1 || points.length !== 2) return false;
  const [[x0, y0], [x1, y1]] = points as [Point, Point];
  const near = (value: number, edge: number, side: number) =>
    Math.abs(value - edge) <= 1e-9 * Math.max(1, side);
  return (
    near(Math.min(x0, x1), -0.5, w) &&
    near(Math.min(y0, y1), -0.5, h) &&
    near(Math.max(x0, x1), w - 0.5, w) &&
    near(Math.max(y0, y1), h - 0.5, h)
  );
}

/** The corners of an image in the drawing, from its lower-left corner round counterclockwise. */
export function imageCorners(image: Image): [Point, Point, Point, Point] {
  const { at, u, v } = placed(image);
  const [w, h] = image.pixels;
  const along: Point = [u[0] * w, u[1] * w];
  const up: Point = [v[0] * h, v[1] * h];
  return [
    at,
    [at[0] + along[0], at[1] + along[1]],
    [at[0] + along[0] + up[0], at[1] + along[1] + up[1]],
    [at[0] + up[0], at[1] + up[1]],
  ];
}

/**
 * The outline an image's frame draws, in the drawing, as a closed ring: its clip's outline, past
 * the image too, the hole's alone for an inverted clip, or the image's outline when it is not
 * clipped. A rectangle of a clip is the one along the image's sides through its corners.
 */
export function imageFrame(image: Image): Point[] {
  if (image.clip === undefined) return imageCorners(image);
  const clip = imageClip(image);
  const { at, u, v } = placed(image);
  const back = (p: Point) => fromImagePixels(at, u, v, image.pixels, p);
  if (clip.type === 1) {
    const [[x0, y0], [x1, y1]] = clip.points as [Point, Point];
    return [back([x0, y1]), back([x1, y1]), back([x1, y0]), back([x0, y0])];
  }
  return clip.points.slice(0, -1).map(back);
}

/** One file the images of a drawing show, as one definition of it. */
export interface ImageDefinition {
  /** Its name in the dictionary of images: the file's name without its extension, made unique. */
  readonly name: string;
  /** The path as the first image of it gives it. */
  readonly path: string;
  readonly pixels: readonly [number, number];
  readonly handle: string;
}

/** A path as the writers write it, with `\` between folders, as the leading CAD app saves one. */
export function writtenImagePath(path: string): string {
  return path.replaceAll("/", "\\");
}

/** The key two paths of one file share: `\` and `/` are one. */
export function imagePathKey(path: string): string {
  return path.replaceAll("\\", "/");
}

/**
 * The handle of the definition of the file at `path`, from its path with `\` and `/` taken as
 * one, so it keeps it when the drawing around it changes. Never change the key.
 */
export function imageDefinitionHandle(path: string): string {
  return keyHandle(`image-definition:${imagePathKey(path)}`);
}

/** The handle of the dictionary of images, `ACAD_IMAGE_DICT`. */
export function imageDictionaryHandle(): string {
  return keyHandle("dictionary:acad_image_dict");
}

/** The handle of RASTERVARIABLES, which holds whether images' frames show. */
export function rasterVariablesHandle(): string {
  return keyHandle("raster-variables:");
}

/** The handle of the reactor of an image with an id, from the id with A to Z in lower case. */
export function imageReactorHandle(idKey: string): string {
  return keyHandle(`image-reactor:${idKey}`);
}

/** The name of the dictionary of images, as the leading CAD app names it. */
export const IMAGE_DICTIONARY = "ACAD_IMAGE_DICT";

/** The name under which the root dictionary holds RASTERVARIABLES. */
export const IMAGE_VARIABLES = "ACAD_IMAGE_VARS";

/**
 * The definitions of the files a drawing's images show, in the order each file is first met:
 * one for each path, with `\` and `/` taken as one. Each is named by its file's name without its
 * extension, as the leading CAD app's `-IMAGE` names one, with a number after it for a name another
 * file took first, compared as that app compares names.
 */
export function imageDefinitions(images: Iterable<Image>): ImageDefinition[] {
  // Keyed exactly, since a path may be long and a lost key would write a file twice.
  const byPath = new Map<string, ImageDefinition>();
  const taken = new Set<string>();
  // The next number to try after each name taken, so that many files of one name are named in
  // time in proportion to their count.
  const next = new Map<string, number>();
  for (const image of images) {
    const path = imagePathKey(image.path);
    const key = exactKey(path);
    if (byPath.has(key)) continue;
    const file = path.slice(path.lastIndexOf("/") + 1);
    const dot = file.lastIndexOf(".");
    const base = (dot > 0 ? file.slice(0, dot) : file) || "image";
    const baseKey = exactKey(layerKey(base));
    let name = base;
    if (taken.has(baseKey)) {
      // Every number below the one kept was taken, and stays taken.
      let n = next.get(baseKey) ?? 2;
      while (taken.has(exactKey(layerKey(`${base}${n}`)))) n++;
      name = `${base}${n}`;
      next.set(baseKey, n + 1);
    }
    taken.add(exactKey(layerKey(name)));
    byPath.set(key, {
      name,
      path: image.path,
      pixels: [image.pixels[0], image.pixels[1]],
      handle: imageDefinitionHandle(image.path),
    });
  }
  return [...byPath.values()];
}

/**
 * Every image of a drawing, in the order the writers name their files by: model space, each
 * layout, then each block, each list read up to its first empty slot.
 */
export function* drawingImages(drawing: Drawing): Generator<Image> {
  const lists: (readonly Entity[] | undefined)[] = [
    drawing.entities,
    ...filled(drawing.layouts ?? []).map((layout) => layout.entities),
    ...filled(drawing.blocks ?? []).map((block) => block.entities),
  ];
  for (const list of lists) {
    for (const e of filled(list ?? [])) if (e.kind === "image") yield e;
  }
}

/** RASTERVARIABLES' units of a drawing's units, as the leading CAD app saves them. */
export const RASTER_UNITS = { in: 5, ft: 6, mm: 1, cm: 2, m: 3 } as const;
