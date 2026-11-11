// Rasterizes the preview SVG with resvg, which needs no browser and no system program.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { renderAsync as RenderAsync } from "@resvg/resvg-js";

const require = createRequire(import.meta.url);

// `toSVG` sets each text in a font family for its style's font, ending in a generic family.
// This font, JetBrains Mono under the OFL in assets/fonts/OFL.txt, answers for every family, so text
// reads the same on every machine, and no system font is consulted. A text in Arial is
// therefore justified, widened and slanted as drawn, but in this font's letters.
const FONT = fileURLToPath(new URL("../assets/fonts/JetBrainsMono-Regular.ttf", import.meta.url));

/** The page's dark theme: color 7, drawn as currentColor, is bone on ink as in CAD. */
const BACKGROUND = "#0b0b0c";
const FOREGROUND = "#f2f2f3";

/** The most pixels one PNG may have: 16 million, 64 MB while it is drawn. */
export const MAX_PIXELS = 16_000_000;

let render: typeof RenderAsync | undefined;
let unavailable: string | null | undefined;

/**
 * Why no PNG can be made, or `null` when one can. The renderer is an optional dependency, so it
 * is absent after an install that left optional packages out, and on a platform it has no build
 * for. Loads the renderer on the first call.
 */
export function pngUnavailable(): string | null {
  if (unavailable !== undefined) return unavailable;
  try {
    render = (require("@resvg/resvg-js") as { renderAsync: typeof RenderAsync }).renderAsync;
    unavailable = null;
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException;
    const cause = String(message).split("\n")[0];
    // The package itself is missing, or it is there and its native part is not.
    unavailable =
      code === "MODULE_NOT_FOUND" && cause?.includes("'@resvg/resvg-js'")
        ? `No PNG: the renderer @resvg/resvg-js, an optional dependency of tsdraft, is not ` +
          `installed. Install it with "npm i -D @resvg/resvg-js", or use the SVG`
        : `No PNG: the renderer @resvg/resvg-js has no build that loads on this platform, ` +
          `${process.platform} ${process.arch} (${cause}). Use the SVG`;
  }
  return unavailable;
}

/**
 * Renders the SVG `width` pixels wide, its height following the drawing's proportions, on a
 * worker thread of libuv rather than the caller's event loop. A width that would make more than
 * `MAX_PIXELS` is narrowed to fit; the result gives the width used. Rejects with the reason when
 * `pngUnavailable()` gives one.
 */
export async function toPNG(svg: string, width: number): Promise<{ png: Buffer; width: number }> {
  const reason = pngUnavailable();
  if (reason !== null || !render) throw new Error(reason ?? "No PNG renderer");
  const [, , w = 1, h = 1] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? "").split(" ").map(Number);
  const aspect = Math.max(h, 1e-9) / Math.max(w, 1e-9);
  const fitted = Math.max(1, Math.min(width, Math.floor(Math.sqrt(MAX_PIXELS / aspect))));
  // resvg ignores non-scaling-stroke, so each stroke width, which toSVG gives in screen pixels
  // on the group and on each element with a heavier or lighter pen, is turned into drawing units
  // for this size, in proportion to the group's.
  const base = Number(/<g [^>]*stroke-width="([^"]*)"/.exec(svg)?.[1]) || 1;
  const toUnits = Math.max(1, fitted / 1200) / (fitted / w) / base;
  const source = svg
    .replace("<svg ", `<svg color="${FOREGROUND}" `)
    .replace(
      /stroke-width="([^"]*)"/g,
      (_, px: string) => `stroke-width="${Number(px) * toUnits}"`,
    );
  const image = await render(source, {
    fitTo: { mode: "width", value: fitted },
    background: BACKGROUND,
    font: {
      fontFiles: [FONT],
      loadSystemFonts: false,
      defaultFontFamily: "JetBrains Mono",
      monospaceFamily: "JetBrains Mono",
      sansSerifFamily: "JetBrains Mono",
      serifFamily: "JetBrains Mono",
    },
  });
  return { png: image.asPng(), width: fitted };
}
