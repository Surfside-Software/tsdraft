// The process that draws PNGs for the command. The renderer is a native module, and a fault in
// it ends the process it runs in, so it runs here and not in the command: `png.ts` starts this
// process, sends it one picture at a time and starts another when this one dies.
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

/** A picture to draw, and the answer to it. */
export interface PngRequest {
  readonly id: number;
  readonly svg: string;
  /** The width in pixels, already narrowed to what one PNG may have. */
  readonly width: number;
}
export type PngAnswer =
  | { readonly id: number; readonly png: Uint8Array }
  | { readonly id: number; readonly error: string };

let render: typeof RenderAsync | undefined;

async function draw(svg: string, fitted: number): Promise<Uint8Array> {
  render ??= (require("@resvg/resvg-js") as { renderAsync: typeof RenderAsync }).renderAsync;
  const [, , w = 1] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? "").split(" ").map(Number);
  // resvg ignores non-scaling-stroke, so each stroke width, which toSVG gives in screen pixels
  // on the group and on each element with a heavier or lighter pen, is turned into drawing units
  // for this size, in proportion to the group's.
  const base = Number(/<g [^>]*stroke-width="([^"]*)"/.exec(svg)?.[1]) || 1;
  // A layout's lines are as wide as their lineweights on the paper. They are kept, and all
  // widened alike only where the default pen would come out under a pixel wide.
  const toUnits = / data-layout="/.test(svg)
    ? Math.max(1, 1 / (base * (fitted / w)))
    : Math.max(1, fitted / 1200) / (fitted / w) / base;
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
  return image.asPng();
}

process.on("message", (request: PngRequest) => {
  draw(request.svg, request.width).then(
    (png) => process.send!({ id: request.id, png } satisfies PngAnswer),
    (error: unknown) => process.send!({ id: request.id, error: String(error) } satisfies PngAnswer),
  );
});
process.once("disconnect", () => process.exit(0));
