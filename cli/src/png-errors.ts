// Why a PNG was not made. `tsdraft/png` exports these, so they hold no type of Node's.

/**
 * The renderer, `@resvg/resvg-js`, cannot load: it is an optional dependency, absent after an
 * install that left optional packages out and on a platform it has no build for. The message
 * says which, and what to do.
 */
export class PngUnavailable extends Error {
  /** Always `"PngUnavailable"`. */
  override readonly name = "PngUnavailable";
}

/** The picture is so tall for its width that it cannot be drawn within the most pixels a PNG may have, at any width. */
export class PngTooLarge extends Error {
  /** Always `"PngTooLarge"`. */
  override readonly name = "PngTooLarge";
}

/**
 * The renderer gave no PNG for a picture: its process could not be started, died while it drew
 * the picture, or answered that it cannot draw it. The next picture is drawn all the same, by a
 * new process when this one is gone.
 */
export class RendererCrashed extends Error {
  /** Always `"RendererCrashed"`. */
  override readonly name = "RendererCrashed";

  constructor(how: string, when: "starting" | "drawing" | "answered") {
    super(
      when === "starting"
        ? `No PNG: the renderer's process could not start (${how}). Use the SVG`
        : `No PNG: the renderer @resvg/resvg-js ${
            when === "drawing" ? "stopped while it drew" : "could not draw"
          } this picture (${how}). Use the SVG. Other pictures are not affected`,
    );
  }
}
