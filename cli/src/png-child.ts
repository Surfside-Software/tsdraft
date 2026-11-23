// The process that draws PNGs for the command. The renderer is a native module, and a fault in
// it ends the process it runs in, so it runs here and not in the command: `png.ts` starts this
// process, sends it one picture at a time and starts another when this one dies.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { renderAsync as RenderAsync } from "@resvg/resvg-js";

const require = createRequire(import.meta.url);

// `toSVG` sets each text in a font family for its style's font, ending in a generic family.
// This font, JetBrains Mono under the OFL in assets/fonts/OFL.txt, answers for every family
// that a request names no face for. A text is then as long and as tall as it plots, in this
// font's letters. The system's fonts are not consulted: a request brings the file of each face
// it wants.
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
  /**
   * The font file to set a font family of the SVG in, with the family name the file has and
   * the height of its capitals as a share of its size.
   */
  readonly faces: readonly {
    readonly family: string;
    readonly face: string;
    readonly file: string;
    readonly capHeight: number;
    /** The file of its bold, of the same family name, and the height of a capital in it. */
    readonly bold?: { readonly file: string; readonly capHeight: number };
  }[];
  /** The height of a capital of this process's own font, as a share of its size. */
  readonly capHeight: number;
}

export type PngAnswer =
  | { readonly id: number; readonly png: Uint8Array }
  | { readonly id: number; readonly error: string };

let render: typeof RenderAsync | undefined;

const attribute = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

async function draw({ svg, width: fitted, faces, capHeight }: PngRequest): Promise<Uint8Array> {
  if (render === undefined) {
    const resvg: { renderAsync: typeof RenderAsync } = require("@resvg/resvg-js");
    render = resvg.renderAsync;
  }

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

  // `toSVG` gives each text the height of its capitals, and sizes it for the font it names.
  // Here it is sized for the face it is drawn in, so that its capitals are that tall, in bold where
  // the text is bold and the face has one.
  const byFamily = new Map(faces.map((face) => [attribute(face.family), face]));

  let set = svg.replace(
    /( font-weight="bold")? font-size="[^"]*" font-family="([^"]*)" data-height="([^"]*)"/g,
    (_, bold: string | undefined, family: string, height: string) => {
      const face = byFamily.get(family);
      const cap = (bold ? face?.bold?.capHeight : undefined) ?? face?.capHeight ?? capHeight;
      const size = Number(height) / cap;

      return `${bold ?? ""} font-size="${size}" font-family="${face ? attribute(face.face) : family}"`;
    },
  );

  // A picture from a copy of tsdraft that gives no height keeps its sizes.
  for (const { family, face } of faces) {
    set = set.replaceAll(
      ` font-family="${attribute(family)}"`,
      ` font-family="${attribute(face)}"`,
    );
  }

  const source = set
    .replace("<svg ", `<svg color="${FOREGROUND}" `)
    .replace(
      /stroke-width="([^"]*)"/g,
      (_, px: string) => `stroke-width="${Number(px) * toUnits}"`,
    );

  const image = await render(source, {
    fitTo: { mode: "width", value: fitted },
    background: BACKGROUND,
    font: {
      fontFiles: [
        FONT,
        ...faces.flatMap((face) => [face.file, ...(face.bold ? [face.bold.file] : [])]),
      ],
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
  draw(request).then(
    (png) => process.send!({ id: request.id, png } satisfies PngAnswer),
    (cause: unknown) => process.send!({ id: request.id, error: String(cause) } satisfies PngAnswer),
  );
});

process.once("disconnect", () => process.exit(0));
