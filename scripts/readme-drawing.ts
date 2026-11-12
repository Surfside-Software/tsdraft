// Runs the examples and writes each one's SVG, restyled per theme, to
// docs/assets/<name>-{light,dark}.svg. Each layer gets a color role. Line widths come from the
// drawing's lineweights, as toSVG writes them, and are made to scale with the picture as
// lineweights do on paper.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sitePlan } from "../examples/site-plan.ts";
import { toSVG } from "../src/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

type Role = "line" | "muted" | "accent";

interface Picture {
  readonly name: string;
  /** Width of the picture in pixels. */
  readonly width: number;
  /** The margin added around the drawing, in drawing units. */
  readonly pad: number;
  /**
   * The edge of the sheet the drawing plots on, in drawing units. The picture is then framed on
   * the sheet, not on the drawing, and outlines the sheet's edge, which the drawing leaves out.
   */
  readonly sheet?: { left: number; bottom: number; right: number; top: number };
  /** The width in pixels, at `width`, of a line of the default lineweight, 0.25 mm. */
  readonly pen: number;
  /** Round line ends, which draw very short lines as dots but close up fine dash patterns. */
  readonly roundCaps: boolean;
  /** The color role of each layer that has entities. */
  readonly roles: Record<string, Role>;
  /** The SVG of a layout to restyle, in place of the model space the example writes. */
  readonly sheetSvg?: string;
}

// The site plan's picture is its layout, as toSVG draws the sheet: paper units, each line as
// wide as its lineweight, and dashes as long as they plot.
const site = sitePlan();
const sitePicture = toSVG(site.drawing, { layout: site.drawing.layouts![0]!.name });

const themes = {
  light: { bg: "#f6f8fa", line: "#1f2328", muted: "#818b98", accent: "#0d7a8c" },
  dark: { bg: "#131315", line: "#f2f2f3", muted: "#8b8b92", accent: "#1aafc8" },
};

const pictures: Picture[] = [
  {
    name: "site-plan",
    width: 1100,
    pad: 0,
    pen: 0.8,
    sheetSvg: sitePicture,
    roundCaps: false,
    roles: {
      "C-PROP": "line",
      "C-PROP-ADJC": "muted",
      "C-PROP-MONU": "line",
      "C-SETB": "muted",
      "C-BLDG": "accent",
      "C-PAVE": "muted",
      "C-ROAD-CNTR": "muted",
      "V-TREE": "muted",
      "C-ANNO-DIMS": "accent",
      "C-ANNO-TEXT": "line",
      "C-ANNO-SYMB": "line",
      "C-ANNO-TITL": "line",
      "G-ANNO-TTLB": "line",
    },
  },
  {
    name: "outdoor-kitchen",
    width: 830,
    pad: 2,
    pen: 0.55,
    roundCaps: true,
    roles: {
      "A-WALL": "line",
      "A-WALL-PATT": "muted",
      "A-FLOR-CASE": "line",
      "A-EQPM": "line",
      "A-GLAZ": "line",
      "A-FURN": "line",
      "A-DETL": "line",
      "A-DETL-HIDN": "muted",
      "A-ANNO-DIMS": "accent",
      "A-ANNO-NOTE": "line",
      "A-ANNO-SYMB": "line",
      "A-ANNO-TITL": "line",
    },
  },
];

// The group toSVG wraps the entities in. A default line is one pixel wide at any size, and an
// entity of another lineweight carries its width in pixels in proportion.
const group =
  '<g transform="scale(1 -1)" fill="none" stroke-width="1" vector-effect="non-scaling-stroke">';

/** A line one pixel wide just inside the edge of the picture, which is the sheet's edge. */
function sheetOutline(x: number, y: number, w: number, h: number, pixel: number, color: string) {
  const at = [x + pixel / 2, y + pixel / 2, w - pixel, h - pixel].map((n) => Number(n.toFixed(3)));
  return `  <rect x="${at[0]}" y="${at[1]}" width="${at[2]}" height="${at[3]}" rx="2" fill="none" stroke="${color}" stroke-width="${Number(pixel.toFixed(3))}"/>`;
}

/**
 * A layout's picture in a theme's colors. Its lines keep the widths toSVG gave them, each in
 * proportion to its lineweight, and all are widened alike so that the default pen is `pen`
 * pixels wide at the picture's size. The white sheet becomes the theme's ground, outlined.
 */
function sheetPicture(
  svg: string,
  { width, pen, roles, name }: Picture,
  colors: (typeof themes)[keyof typeof themes],
): string {
  const [x = 0, y = 0, w = 0, h = 0] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? "")
    .split(" ")
    .map(Number);
  const base = Number(
    /<g transform="scale\(1 -1\)" fill="none" stroke-width="([^"]+)"/.exec(svg)?.[1],
  );
  if (!(w > 0) || !(base > 0) || !svg.includes('fill="#ffffff"/>')) {
    throw new Error(
      "toSVG's picture of a layout changed shape, so the restyling no longer applies",
    );
  }
  const unitsPerPixel = w / width;
  const wider = (pen * unitsPerPixel) / base;
  let dimension: string | undefined;
  const out = svg.split("\n").map((line) => {
    if (line.startsWith("<svg ")) {
      return line.replace(
        /viewBox="[^"]+"[^>]*>/,
        `viewBox="${x} ${y} ${w} ${h}" width="${width}" height="${Math.round((width * h) / w)}">`,
      );
    }
    if (line.includes('fill="#ffffff"/>')) {
      return [
        `  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Number((2 * unitsPerPixel).toFixed(4))}" fill="${colors.bg}"/>`,
        sheetOutline(x, y, w, h, unitsPerPixel, colors.muted).replace(
          'rx="2"',
          `rx="${Number((2 * unitsPerPixel).toFixed(4))}"`,
        ),
      ].join("\n");
    }
    const layer = /data-layer="([^"]+)"/.exec(line)?.[1];
    // A dimension is a group that names the layer, and its parts are the lines after it.
    if (line.includes("data-dimension=")) dimension = layer;
    else if (line.trim() === "</g>") dimension = undefined;
    const drawnOn = layer ?? dimension;
    const role = drawnOn === undefined ? undefined : roles[drawnOn];
    if (drawnOn !== undefined && !role) throw new Error(`Layer ${drawnOn} of ${name} has no role`);
    const styled = line
      .replace(/stroke-width="([^"]+)"/, (_, value: string) => {
        return `stroke-width="${Number((Number(value) * wider).toPrecision(5))}"`;
      })
      .replace('fill="none" stroke-width', 'fill="none" stroke-linejoin="round" stroke-width');
    // The hidden rectangle of a clipped view draws nothing, and has no layer.
    if (line.includes('visibility="hidden"')) {
      return styled.replace('stroke="#000000"', `stroke="${colors.muted}"`);
    }
    if (!role) return styled;
    return styled
      .replace(/ data-layer="[^"]*"/, "")
      .replace(/ data-entity="[^"]*"/, "")
      .replace(/stroke="#000000"/, `stroke="${colors[role]}"`)
      .replace(/fill="#000000"/, `fill="${colors[role]}"`);
  });
  const text = out.join("\n");
  if (!text.includes(colors.accent) || text.includes("data-layer") || text.includes("#000000")) {
    throw new Error(
      "toSVG's picture of a layout changed shape, so the restyling no longer applies",
    );
  }
  return text;
}

for (const picture of pictures) {
  const { name, width, pad, pen, roundCaps, roles, sheet } = picture;
  execFileSync(process.execPath, [`examples/${name}.ts`], { cwd: root, stdio: "inherit" });
  if (picture.sheetSvg !== undefined) {
    for (const [theme, colors] of Object.entries(themes)) {
      writeFileSync(
        `${root}/docs/assets/${name}-${theme}.svg`,
        sheetPicture(picture.sheetSvg, picture, colors),
      );
    }
    console.log(`Wrote docs/assets/${name}-light.svg and ${name}-dark.svg`);
    continue;
  }
  const svg = readFileSync(`${root}/examples/out/${name}.svg`, "utf8");
  if (!svg.includes(group)) {
    throw new Error("toSVG's output changed shape, so the restyling no longer applies");
  }

  for (const [theme, colors] of Object.entries(themes)) {
    let unitsPerPixel = 0;
    const lines = svg
      .replace(/viewBox="([^"]+)">/, (_, box: string) => {
        // The view box has Y pointing down, so the sheet's top edge is its least Y.
        const [x = 0, y = 0, w = 0, h = 0] = sheet
          ? [sheet.left, -sheet.top, sheet.right - sheet.left, sheet.top - sheet.bottom]
          : box.split(" ").map(Number);
        const [vx, vy, vw, vh] = [x - pad, y - pad, w + pad * 2, h + pad * 2].map((n) =>
          Number(n.toFixed(6)),
        ) as [number, number, number, number];
        unitsPerPixel = vw / width;
        return [
          `viewBox="${vx} ${vy} ${vw} ${vh}" width="${width}" height="${Math.round((width * vh) / vw)}">`,
          `  <rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" rx="2" fill="${colors.bg}"/>`,
          ...(sheet ? [sheetOutline(vx, vy, vw, vh, unitsPerPixel, colors.muted)] : []),
        ].join("\n");
      })
      .replace(
        group,
        `<g transform="scale(1 -1)" fill="none"${roundCaps ? ' stroke-linecap="round"' : ""} stroke-linejoin="round">`,
      )
      .split("\n");
    // Entities drawn alike share one group that carries their color and width, which keeps the
    // file small.
    const body: string[] = [];
    let openGroup = "";
    for (const line of lines) {
      const layer = /data-layer="([^"]+)"/.exec(line)?.[1];
      const role = layer === undefined ? undefined : roles[layer];
      if (layer !== undefined && !role) throw new Error(`Layer ${layer} of ${name} has no role`);
      const relative = Number(/ stroke-width="([\d.]+)"/.exec(line)?.[1] ?? 1);
      const strokeWidth = Number((relative * pen * unitsPerPixel).toFixed(3));
      const groupTag = role ? `    <g stroke="${colors[role]}" stroke-width="${strokeWidth}">` : "";
      if (groupTag !== openGroup) {
        if (openGroup) body.push("    </g>");
        if (groupTag) body.push(groupTag);
        openGroup = groupTag;
      }
      if (!role) {
        body.push(line);
        continue;
      }
      body.push(
        line
          .replace(/ vector-effect="non-scaling-stroke"/, "")
          .replace(/ data-layer="[^"]*"/, "")
          .replace(/ data-entity="[^"]*"/, "")
          .replace(/ stroke-width="[^"]*"/, "")
          .replace(/ stroke="(?!none)[^"]*"/, "")
          .replace(/fill="(?!none)[^"]*"/, `fill="${colors[role]}"`)
          .replace(
            'font-family="monospace"',
            `font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"`,
          ),
      );
    }
    const out = body.join("\n");
    if (
      !out.includes(colors.bg) ||
      !out.includes(colors.accent) ||
      out.includes("vector-effect") ||
      out.includes("data-layer") ||
      out.includes("data-entity")
    ) {
      throw new Error("toSVG's output changed shape, so the restyling no longer applies");
    }
    writeFileSync(`${root}/docs/assets/${name}-${theme}.svg`, out);
  }
  console.log(`Wrote docs/assets/${name}-light.svg and ${name}-dark.svg`);
}
