// `tsdraft/png`, the library's PNG writer. The library itself runs in a browser and so draws no
// PNG; this entry runs on Node and draws `toSVG`'s picture as `tsdraft render` does.
import { toSVG, type Drawing, type SvgOptions } from "tsdraft";
import { framed } from "./framed.ts";
import { toPNG as rasterize } from "./png.ts";

export { PngTooLarge, PngUnavailable, RendererCrashed } from "./png-errors.ts";

/** What `toPNG` draws, as `toSVG` takes it, and how wide. */
export interface PngOptions extends Omit<SvgOptions, "strokeWidth"> {
  /**
   * The width in pixels, a whole number, 1600 by default as in `tsdraft render`. The height
   * follows the picture's proportions. A width that would give more than 16 million pixels is
   * narrowed to fit, so the PNG's own header gives the width drawn.
   */
  readonly width?: number;
}

/**
 * Draws the drawing as a PNG: the picture `toSVG` writes with the same options, on the dark
 * background of `tsdraft render`, with the same fonts and the same pixels. Each line keeps the
 * width it has in the picture, and a text's capitals are as tall as the text in the face it is
 * set in, as in the plot.
 *
 * The renderer, `@resvg/resvg-js`, is an optional dependency of tsdraft. It draws in a process of
 * its own, which the first call starts and later calls reuse, so a picture it stops on rejects
 * this call and never ends the caller. The process does not keep a program from ending.
 *
 * Rejects with a `PngUnavailable` when the renderer is not installed or cannot load here, a
 * `PngTooLarge` for a picture too tall to draw at any width, and a `RendererCrashed` when the
 * renderer gave no PNG for this picture. Rejects as `toSVG` throws, and with a `RangeError` for a
 * width that is not a whole number of at least 1.
 */
export async function toPNG(drawing: Drawing, options: PngOptions = {}): Promise<Uint8Array> {
  const { width = 1600, ...picture } = options;

  if (!Number.isInteger(width) || width < 1) {
    throw new RangeError(`A PNG's width is a whole number of pixels, at least 1, not ${width}`);
  }

  // Model space with no margin given gets the command's frame: the margin is added after the
  // picture is drawn, so what toSVG sizes by the picture's height is sized as the command sizes it.
  const svg =
    picture.margin === undefined && picture.view === undefined && picture.layout === undefined
      ? framed(toSVG(drawing, { ...picture, margin: 0 })).svg
      : toSVG(drawing, picture);

  const { png } = await rasterize(svg, width);

  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
}
