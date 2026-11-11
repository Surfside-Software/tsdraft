import {
  blocksByKey,
  eachDrawn,
  findXref,
  mapPoint,
  referencedByKey,
  type LayerRef,
  type Matrix,
  type Referenced,
} from "./blocks.ts";
import {
  sweep,
  type Drawing,
  type Entity,
  type Insert,
  type Layer,
  type Point,
  type TextStyle,
  type Viewport,
} from "./drawing.ts";
import { boxer, extents } from "./extents.ts";
import { fontInfo, STANDARD_FONT } from "./fonts.ts";
import { fmt, written } from "./format.ts";
import { layerKey } from "./layers.ts";
import { findLayout, validViewportView } from "./layouts.ts";
import { builtInLinetype, LINEWEIGHTS, lineweightCode } from "./linetypes.ts";
import { DEFAULT_PLOT_STYLE_TABLE, paperInfo } from "./papers.ts";
import { viewportProblem } from "./rules.ts";
import { isUnits } from "./units.ts";

/**
 * The color AutoCAD plots each ACI index in, from 1 to 255, ten to a row. The entry for index
 * 7 is not used: 7 is black on paper and white on a dark screen, so it draws in currentColor.
 */
const ACI: readonly string[] = [
  "ff0000 ffff00 00ff00 00ffff 0000ff ff00ff 000000 808080 dcdcdc ff0000",
  "ff7f7f dd0000 dd6e6e b80000 b85c5c 950000 954a4a 720000 723939 ff3f00",
  "ff9f7f dd3700 dd8a6e b82e00 b8735c 952500 955d4a 721c00 724739 ff7f00",
  "ffbf7f dd6e00 dda56e b85c00 b88a5c 954a00 95704a 723900 725639 ffbf00",
  "ffdf7f dda500 ddc16e b88a00 b8a15c 957000 95834a 725600 726439 ffff00",
  "ffff7f dddd00 dddd6e b8b800 b8b85c 959500 95954a 727200 727239 bfff00",
  "dfff7f a5dd00 c1dd6e 8ab800 a1b85c 709500 83954a 567200 647239 7fff00",
  "bfff7f 6edd00 a5dd6e 5cb800 8ab85c 4a9500 70954a 397200 567239 3fff00",
  "9fff7f 37dd00 8add6e 2eb800 73b85c 259500 5d954a 1c7200 477239 00ff00",
  "7fff7f 00dd00 6edd6e 00b800 5cb85c 009500 4a954a 007200 397239 00ff3f",
  "7fff9f 00dd37 6edd8a 00b82e 5cb873 009525 4a955d 00721c 397247 00ff7f",
  "7fffbf 00dd6e 6edda5 00b85c 5cb88a 00954a 4a9570 007239 397256 00ffbf",
  "7fffdf 00dda5 6eddc1 00b88a 5cb8a1 009570 4a9583 007256 397264 00ffff",
  "7fffff 00dddd 6edddd 00b8b8 5cb8b8 009595 4a9595 007272 397272 00bfff",
  "7fdfff 00a5dd 6ec1dd 008ab8 5ca1b8 007095 4a8395 005672 396472 007fff",
  "7fbfff 006edd 6ea5dd 005cb8 5c8ab8 004a95 4a7095 003972 395672 003fff",
  "7f9fff 0037dd 6e8add 002eb8 5c73b8 002595 4a5d95 001c72 394772 0000ff",
  "7f7fff 0000dd 6e6edd 0000b8 5c5cb8 000095 4a4a95 000072 393972 3f00ff",
  "9f7fff 3700dd 8a6edd 2e00b8 735cb8 250095 5d4a95 1c0072 473972 7f00ff",
  "bf7fff 6e00dd a56edd 5c00b8 8a5cb8 4a0095 704a95 390072 563972 bf00ff",
  "df7fff a500dd c16edd 8a00b8 a15cb8 700095 834a95 560072 643972 ff00ff",
  "ff7fff dd00dd dd6edd b800b8 b85cb8 950095 954a95 720072 723972 ff00bf",
  "ff7fdf dd00a5 dd6ec1 b8008a b85ca1 950070 954a83 720056 723964 ff007f",
  "ff7fbf dd006e dd6ea5 b8005c b85c8a 95004a 954a70 720039 723956 ff003f",
  "ff7f9f dd0037 dd6e8a b8002e b85c73 950025 954a5d 72001c 723947 545454",
  "767676 989898 bababa dbdbdb fafafa",
]
  .join(" ")
  .split(" ");

/** The color of an ACI index. An index outside 1 to 255 draws like 7, in currentColor. */
function aciColor(index: number): string {
  const rgb = index === 7 ? undefined : ACI[index - 1];
  return rgb === undefined ? "currentColor" : `#${rgb}`;
}

/** AutoCAD draws a lineweight of "Default" at its LWDEFAULT, 0.25 mm. */
const DEFAULT_LINEWEIGHT = 25;

/**
 * The height of a capital in the screen font that stands in for an SHX font, and how far a
 * letter such as "g" reaches below the baseline, as shares of the font size. They place a text
 * that is not justified to its baseline. The fonts themselves are not read.
 */
const CAP_HEIGHT = 0.7;
const DESCENT = 0.2;

/**
 * The most dashes one entity is cut into. AutoCAD draws a line solid when its pattern is too
 * fine to show, and so does the preview.
 */
const MAX_DASHES = 10000;

export interface SvgOptions {
  /** Margin around the drawing's extents, in drawing units. Defaults to 2% of the larger side. */
  readonly margin?: number;
  /**
   * Stroke width in screen pixels of a line of the default lineweight, 0.25 mm. Other
   * lineweights are drawn in proportion. It stays constant when the SVG scales.
   */
  readonly strokeWidth?: number;
  /** Draws the layers whose `plot` is false too. They are left out by default. */
  readonly drawNoPlot?: boolean;
  /**
   * The drawing each xref stands for, by the xref's name. An insert of an xref draws the model
   * space of the drawing given here, and nothing when none is given.
   */
  readonly xrefs?: Readonly<Record<string, Drawing>>;
  /**
   * The name of a layout to draw in place of model space: the sheet as it plots. `margin` then
   * defaults to 0, and `strokeWidth` is not used, because a sheet's lines are as wide as their
   * lineweights.
   */
  readonly layout?: string;
}

/** How an entity is drawn. */
interface Pen {
  readonly color: string;
  /** Dash, gap, dash, ... in drawing units, starting with a dash. Undefined for a solid line. */
  readonly dashes: readonly number[] | undefined;
  /** In hundredths of a millimetre. */
  readonly lineweight: number;
}

/**
 * Renders a preview SVG of the drawing as it plots. Model Y points up, so the drawing group
 * flips Y. Entities on layers that are off, frozen or set not to plot are left out, and each
 * layer draws in the color AutoCAD plots its index in. Dashed lines are cut into their dashes,
 * scaled by the drawing's linetype scale, and each line is as wide as its lineweight. A text is
 * anchored at its justification point, and is drawn with its style's width factor and oblique
 * angle in the CSS font family tsdraft gives its style's font, which ends in a generic family
 * for a screen that lacks the font. Each entity's element has its layer in `data-layer`, its
 * index in `drawing.entities` in `data-entity`, and its `id`, when it has one, in `data-id`.
 *
 * An insert is a group with its block's name in `data-block`. It holds an element for each
 * entity of the block, and of the blocks inserted in it, drawn where the insert puts it, and a
 * text for each attribute with the insert's value. An entity on layer `0` of a block draws as
 * its insert's layer does, and any other as its own layer does, which `data-layer` names. An
 * insert on a frozen layer, or on a layer that does not plot, draws nothing.
 *
 * An insert of an xref is such a group too, with the xref's path in `data-xref`. `toSVG` opens
 * no file, so it draws the drawing given for the xref in `options.xrefs`, as AutoCAD draws a
 * loaded xref: an entity on layer `0` there draws as the insert's layer does, and any other as
 * its own layer of the referenced drawing does, in that layer's color, linetype, lineweight
 * and state, with `data-layer` naming it as AutoCAD does, `XREF|LAYER`. Dashes are scaled by
 * this drawing's linetype scale. The group is empty for an xref with no drawing given.
 *
 * With `options.layout`, the picture is that layout as AutoCAD plots it, in paper units: a
 * white sheet the size of its paper, each viewport as a group with its index in
 * `data-viewport` that shows model space at the viewport's scale, clipped to its rectangle,
 * and then what is drawn on the sheet. Every line is as wide as its lineweight on the paper,
 * a dash is as long on the paper as its pattern times the linetype scale, in a viewport too,
 * and colors are the ones the layout's plot style table plots: black for `monochrome.ctb`. A
 * viewport's border is drawn as the thinnest line when its layer is on, thawed and set to
 * plot, and its view is drawn whatever its layer's state. `data-entity` counts the layout's
 * entities, and inside a viewport's group the entities of model space.
 *
 * @throws RangeError when the drawing has no layout of the name `options.layout`.
 */
export function toSVG(drawing: Drawing, options: SvgOptions = {}): string {
  const xrefs = referencedByKey(drawing, options.xrefs);
  // The tables of the drawing and of each drawing it references, made when first asked for.
  const tables = new Map<Drawing, Tables>();
  const tablesOf = (from: Referenced | undefined): Tables => {
    const source = from?.drawing ?? drawing;
    let found = tables.get(source);
    if (!found) tables.set(source, (found = tablesFor(source)));
    return found;
  };
  const layerOf = (ref: LayerRef): Layer | undefined =>
    tablesOf(ref.of).layers.get(layerKey(ref.name));
  const hidden = (ref: LayerRef): boolean => {
    const layer = layerOf(ref);
    if (layer?.off || layer?.frozen) return true;
    return options.drawNoPlot !== true && layer?.plot === false;
  };
  // An insert on a frozen layer draws nothing, and in a plot neither does one on a layer that
  // does not plot, whatever layers its block's entities are on.
  const frozen = (ref: LayerRef): boolean => {
    const layer = layerOf(ref);
    return layer?.frozen === true || (options.drawNoPlot !== true && layer?.plot === false);
  };
  const blocks = blocksByKey(drawing.blocks);
  const styleOf = (e: Entity, from?: Referenced): TextStyle | undefined =>
    e.kind === "text" && e.style !== undefined
      ? tablesOf(from).textStyles.get(layerKey(e.style))
      : undefined;

  /**
   * The pen of an entity that draws on `on`. `insertLayer` is the layer of the insert that
   * holds it, whose linetype and lineweight an entity set to ByBlock takes. `from` is the
   * referenced drawing the entity is in, whose linetypes it names.
   */
  const pen = (
    look: Look,
    e: Drawn,
    on: LayerRef,
    insertLayer?: LayerRef,
    from?: Referenced,
  ): Pen => {
    const layer: Layer | undefined = layerOf(on);
    /**
     * The layer a linetype or a lineweight comes from, with the drawing whose layer it is, or
     * `"own"` for the entity's own.
     */
    const source = (
      value: string | number | undefined,
    ): { readonly layer: Layer | undefined; readonly of: Referenced | undefined } | "own" => {
      const name = typeof value === "string" ? builtInLinetype(value) : undefined;
      if (value === undefined || name === "ByLayer") return { layer, of: on.of };
      // An insert draws ByLayer, so ByBlock is the insert's layer.
      if (name === "ByBlock" && insertLayer !== undefined) {
        return { layer: layerOf(insertLayer), of: insertLayer.of };
      }
      return "own";
    };
    const linetypeFrom = source(e.linetype);
    const linetype = linetypeFrom === "own" ? e.linetype : linetypeFrom.layer?.linetype;
    // A layer's linetype is one of the layer's drawing, and an entity's one of the entity's.
    const named = linetypeFrom === "own" ? from : linetypeFrom.of;
    const pattern =
      linetype === undefined ? undefined : tablesOf(named).patterns.get(layerKey(linetype));
    const weightFrom = source(e.lineweight);
    const weight =
      weightFrom === "own"
        ? (e.lineweight ?? "Default")
        : (weightFrom.layer?.lineweight ?? "Default");
    const code = lineweightCode(weight);
    return {
      color: look.color(layer?.color ?? 7),
      dashes: Number.isFinite(look.dashScale)
        ? pattern?.map((length) => length * look.dashScale)
        : undefined,
      lineweight: code < 0 ? DEFAULT_LINEWEIGHT : code,
    };
  };

  /**
   * The entities of a space that are drawn, each with its index among them. What an insert
   * holds is judged entity by entity, unless the insert's own layer is frozen.
   */
  const shownOf = (entities: readonly Entity[]): [number, Entity][] =>
    [...entities.entries()].filter(([, e]) =>
      e.kind === "insert" ? !frozen({ name: e.layer }) : !hidden({ name: e.layer }),
    );

  /** An element for each entity that is drawn, as `look` draws it. */
  const elements = (shown: readonly [number, Entity][], look: Look): string[] => {
    const marks = (e: Entity, index: number): string =>
      `data-layer="${esc(e.layer)}" data-entity="${index}"${e.id === undefined ? "" : ` data-id="${esc(e.id)}"`}`;
    return shown.map(([i, e]) => {
      if (e.kind !== "insert")
        return entityToSvg(e, marks(e, i), pen(look, e, { name: e.layer }), look, styleOf(e));
      const parts: string[] = [];
      eachDrawn(
        e,
        blocks,
        frozen,
        (drawn, at) => {
          if (at.frozen || hidden(at.layer)) return;
          // AutoCAD names a layer of an xref by the xref's name, a bar and the layer's.
          const { name, of } = at.layer;
          const mark = `data-layer="${esc(of ? `${of.name}|${name}` : name)}"`;
          const drawnPen = pen(look, drawn, at.layer, at.insertLayer, at.from);
          const style = styleOf(drawn, at.from);
          parts.push(entityToSvg(drawn, mark, drawnPen, look, style, at.matrix));
        },
        xrefs,
      );
      const inside =
        parts.length > 0
          ? `\n${look.indent}  ${parts.join(`\n${look.indent}  `)}\n${look.indent}`
          : "";
      const xref = blocks.has(layerKey(e.block)) ? undefined : findXref(drawing, e.block);
      const path = xref === undefined ? "" : ` data-xref="${esc(xref.path)}"`;
      return `<g ${marks(e, i)} data-block="${esc(e.block)}"${path}>${inside}</g>`;
    });
  };

  // AutoCAD scales the dashes of a referenced drawing by the linetype scale of the drawing
  // that references it.
  // AutoCAD reads a scale of 0 or less as 1, and so is one that is not a finite number here.
  const stated = drawing.linetypeScale ?? 1;
  const linetypeScale = stated > 0 && Number.isFinite(stated) ? stated : 1;
  if (options.layout !== undefined) {
    const layout = findLayout(drawing, options.layout);
    const paper = layout && paperInfo(layout.paper);
    if (!layout || !paper) {
      throw new RangeError(`The drawing has no layout named ${JSON.stringify(options.layout)}`);
    }
    // A sheet is paper: a pen plots black unless the plot style table keeps its color, and
    // index 7 is black on paper.
    const monochrome = (layout.plotStyle ?? DEFAULT_PLOT_STYLE_TABLE) === "monochrome.ctb";
    const color = (index: number): string =>
      monochrome || index === 7 ? "#000000" : aciColor(index);
    // Hundredths of a millimetre in paper units.
    const perHundredth = paper.units === "in" ? 1 / 2540 : 1 / 100;
    /** A look whose lines are as wide as they plot, in a space `scale` paper units to one. */
    const plotted = (scale: number, indent: string): Look => ({
      color,
      dashScale: linetypeScale / scale,
      indent,
      stroke: (lineweight) =>
        lineweight === DEFAULT_LINEWEIGHT
          ? ""
          : ` stroke-width="${precise((Math.max(lineweight, 5) * perHundredth) / scale)}"`,
    });
    const onPaper = plotted(1, "    ");
    const thin = fmt(5 * perHundredth);
    // Each entity of model space with the box around what it draws, worked out once, a slanted
    // text with its lean, and how far past that box its ink may reach beyond its pen: a
    // text's letters may be wider than the estimate of its box, and so may the texts of a block.
    const boxOf = boxer(drawing.textStyles, drawing.blocks, hidden, frozen, xrefs, true);
    const model = shownOf(drawing.entities).flatMap((shown) => {
      const box = boxOf([shown[1]]);
      if (!box) return [];
      const lettered = shown[1].kind === "text" || shown[1].kind === "insert";
      const slack = lettered ? Math.max(box[2] - box[0], box[3] - box[1]) : 0;
      return [{ shown, box, slack }];
    });
    // A drawing in units tsdraft does not know is drawn as one in inches, as `lint` judges it.
    const units = isUnits(drawing.units) ? drawing.units : "in";
    // The picture: the paper and the margin around it, in paper units and as written.
    const margin = options.margin ?? 0;
    const frame = [
      written(-margin),
      written(-paper.height - margin),
      written(paper.width + margin * 2),
      written(paper.height + margin * 2),
    ] as const;
    const picture = [frame[0], -(frame[1] + frame[3]), frame[0] + frame[2], -frame[1]] as const;
    const parts: string[] = [];
    layout.viewports.forEach((viewport, index) => {
      const id = viewport.id === undefined ? "" : ` data-id="${esc(viewport.id)}"`;
      // A viewport `lint` refuses has no view to draw: a ratio of 0 or less, or no size.
      const sound = viewportProblem(viewport, paper.units, units) === undefined;
      if (!sound) {
        parts.push(`<g data-viewport="${index}"${id}/>`);
        // Its border is still drawn where its rectangle can be read.
        const { corner, width, height, layer } = viewport as Partial<Viewport>;
        const sizes = [corner?.[0], corner?.[1], width, height];
        if (
          typeof layer === "string" &&
          sizes.every((size) => typeof size === "number" && Number.isFinite(size)) &&
          width! > 0 &&
          height! > 0 &&
          !hidden({ name: layer })
        ) {
          const stroke = color(layerOf({ name: layer })?.color ?? 7);
          parts.push(
            `<rect x="${fmt(corner![0])}" y="${fmt(corner![1])}" width="${fmt(width!)}" height="${fmt(height!)}" stroke="${stroke}" stroke-width="${thin}" data-layer="${esc(layer)}" data-viewport-border="${index}"${id}/>`,
          );
        }
        return;
      }
      const view = validViewportView(viewport, paper.units, units);
      const [x, y] = [view.paperCenter[0] - view.width / 2, view.paperCenter[1] - view.height / 2];
      const box = `x="${fmt(x)}" y="${fmt(y)}" width="${fmt(view.width)}" height="${fmt(view.height)}"`;
      // Model space is placed so that the view's center lies at the middle of the rectangle.
      // The scale is written in full: six decimals leave a drawing in millimetres at 1:1000,
      // whose scale is 0.0000393701, two digits.
      const place = `translate(${fmt(view.paperCenter[0])} ${fmt(view.paperCenter[1])}) scale(${precise(view.scale)}) translate(${fmt(-view.center[0])} ${fmt(-view.center[1])})`;
      // A view is drawn only where it can be seen: the viewport, cut to the paper, cut to
      // the picture, with every number as it is written. The clip, the hidden rectangle and
      // the choice of what to draw all use this one rectangle.
      const seen = [
        written(Math.max(x, 0, picture[0])),
        written(Math.max(y, 0, picture[1])),
        written(Math.min(x + view.width, paper.width, picture[2])),
        written(Math.min(y + view.height, paper.height, picture[3])),
      ] as const;
      const [seenWidth, seenHeight] = [written(seen[2] - seen[0]), written(seen[3] - seen[1])];
      // It has a width and a height as written, and as a renderer that keeps numbers in
      // single precision reads its corners.
      const visible =
        seenWidth > 0 &&
        seenHeight > 0 &&
        Math.fround(seen[0]) < Math.fround(seen[2]) &&
        Math.fround(seen[1]) < Math.fround(seen[3]);
      // The same rectangle in model space.
      const shows = seen.map(
        (at, i) => view.center[i % 2]! + (at - view.paperCenter[i % 2]!) / view.scale,
      );
      // Only what may reach into it is drawn. The test errs on the side of drawing: an
      // entity's box, which for an arc is its circle's, with the widest pen there is and
      // the slack of its letters around it.
      const widest = (LINEWEIGHTS.at(-1)! * 100 * perHundredth) / view.scale;
      const near = !visible
        ? []
        : model
            .filter(({ box: b, slack }) => {
              const by = widest + slack;
              return (
                b[0] - by <= shows[2]! &&
                b[2] + by >= shows[0]! &&
                b[1] - by <= shows[3]! &&
                b[3] + by >= shows[1]!
              );
            })
            .map(({ shown }) => shown);
      const inside = elements(near, plotted(view.scale, "        "));
      if (inside.length === 0) {
        // Nothing of the view can be seen, so there is nothing to clip.
        parts.push(`<g data-viewport="${index}"${id}/>`);
      } else {
        // The first element is hidden and is the rectangle itself. It draws nothing, and it
        // keeps the group's box on the picture whatever else the group holds: resvg, which
        // the command draws PNGs with, takes the box of a clipped group's elements before it
        // clips them, and stops the program that runs it when that box lies wholly more than
        // two widths of the picture to its left or right, or two heights above or below it.
        const rect = `x="${seen[0]}" y="${seen[1]}" width="${seenWidth}" height="${seenHeight}"`;
        parts.push(
          `<clipPath id="tsdraft-viewport-${index}"><rect ${rect}/></clipPath>`,
          [
            `<g data-viewport="${index}"${id} clip-path="url(#tsdraft-viewport-${index})">`,
            `      <rect ${rect} visibility="hidden" stroke="#000000"/>`,
            `      <g transform="${place}" stroke-width="${precise((DEFAULT_LINEWEIGHT * perHundredth) / view.scale)}">`,
            ...inside.map((element) => `        ${element}`),
            `      </g>`,
            `    </g>`,
          ].join("\n"),
        );
      }
      // AutoCAD plots a viewport's border as its thinnest line, and only when its layer plots.
      if (!hidden({ name: viewport.layer })) {
        const stroke = color(layerOf({ name: viewport.layer })?.color ?? 7);
        parts.push(
          `<rect ${box} stroke="${stroke}" stroke-width="${thin}" data-layer="${esc(viewport.layer)}" data-viewport-border="${index}"${id}/>`,
        );
      }
    });
    parts.push(...elements(shownOf(layout.entities), onPaper));
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${frame.join(" ")}" data-layout="${esc(layout.name)}" data-paper="${esc(layout.paper)}">`,
      `  <rect x="0" y="${fmt(-paper.height)}" width="${fmt(paper.width)}" height="${fmt(paper.height)}" fill="#ffffff"/>`,
      `  <g transform="scale(1 -1)" fill="none" stroke-width="${fmt(DEFAULT_LINEWEIGHT * perHundredth)}">`,
      ...parts.map((part) => `    ${part}`),
      `  </g>`,
      `</svg>`,
      ``,
    ].join("\n");
  }

  // Each entity keeps its index in `drawing.entities`, for its element's data-entity.
  const shown = shownOf(drawing.entities);
  const [minX, minY, maxX, maxY] = extents(
    shown.map(([, e]) => e),
    drawing.textStyles,
    drawing.blocks,
    hidden,
    frozen,
    xrefs,
  );
  const margin = options.margin ?? Math.max(maxX - minX, maxY - minY, 1) * 0.02;
  const x = minX - margin;
  const y = -(maxY + margin);
  const w = maxX - minX + margin * 2;
  const h = maxY - minY + margin * 2;
  const stroke = options.strokeWidth ?? 1;
  // On a screen each layer draws in its own color, and every line keeps its width in pixels
  // however far the picture is zoomed.
  const onScreen: Look = {
    color: aciColor,
    dashScale: linetypeScale,
    indent: "    ",
    stroke: (lineweight) =>
      `${
        lineweight === DEFAULT_LINEWEIGHT
          ? ""
          : ` stroke-width="${fmt((stroke * Math.max(lineweight, 5)) / DEFAULT_LINEWEIGHT)}"`
      } vector-effect="non-scaling-stroke"`,
  };
  const body = elements(shown, onScreen).join("\n    ");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)}">`,
    `  <g transform="scale(1 -1)" fill="none" stroke-width="${fmt(stroke)}" vector-effect="non-scaling-stroke">`,
    `    ${body}`,
    `  </g>`,
    `</svg>`,
    ``,
  ].join("\n");
}

/**
 * A number with 12 significant digits, for a scale or a width that six decimals would cut
 * short. SVG reads the exponent a very small one is printed with.
 */
function precise(value: number): string {
  return String(Number(value.toPrecision(12)));
}

/** How a space is drawn: on a screen, or as it plots on paper. */
interface Look {
  /** The color of an ACI index. */
  readonly color: (index: number) => string;
  /** What a linetype's pattern is multiplied by, to give dashes in the space's own units. */
  readonly dashScale: number;
  /** The attributes that set an element's stroke width, for a lineweight in hundredths of a millimetre. */
  readonly stroke: (lineweight: number) => string;
  /** The white space before an element, which what an insert holds is set in from. */
  readonly indent: string;
}

/** What a drawing's entities name: its layers, its dash patterns and its text styles. */
interface Tables {
  /** Keyed as AutoCAD looks layers up, so an entity on `wall` takes the color of layer `WALL`. */
  readonly layers: ReadonlyMap<string, Layer>;
  readonly patterns: ReadonlyMap<string, number[] | undefined>;
  readonly textStyles: ReadonlyMap<string, TextStyle>;
}

function tablesFor(drawing: Drawing): Tables {
  return {
    layers: new Map(drawing.layers.map((l) => [layerKey(l.name), l])),
    patterns: new Map(
      (drawing.linetypes ?? []).map((t) => [layerKey(t.name), alternating(t.pattern)]),
    ),
    textStyles: new Map((drawing.textStyles ?? []).map((t) => [layerKey(t.name), t])),
  };
}

/** An entity that draws something of its own, which an insert does not. */
type Drawn = Exclude<Entity, Insert>;

/**
 * What a matrix makes of a circle: an ellipse with these two radii, the first turned by `turn`
 * degrees, drawn counterclockwise when `sweep` is 1. With no matrix it is the circle.
 */
function rounded(
  radius: number,
  m: Matrix | undefined,
): { rx: number; ry: number; turn: number; sweep: 0 | 1 } {
  if (!m) return { rx: radius, ry: radius, turn: 0, sweep: 1 };
  // The two stretches of the matrix, and the turn it gives the first.
  const [e, f, g, h] = [(m[0] + m[3]) / 2, (m[0] - m[3]) / 2, (m[1] + m[2]) / 2, (m[1] - m[2]) / 2];
  const [q, r] = [Math.hypot(e, h), Math.hypot(f, g)];
  const sweep = m[0] * m[3] - m[1] * m[2] < 0 ? 0 : 1;
  const [rx, ry] = [radius * (q + r), radius * Math.abs(q - r)];
  // A matrix that scales both ways alike leaves a circle, which has no turn to give.
  if (fmt(rx) === fmt(ry)) return { rx, ry, turn: 0, sweep };
  return { rx, ry, turn: ((Math.atan2(g, f) + Math.atan2(h, e)) * 90) / Math.PI, sweep };
}

/**
 * @param mark - The data attributes of the element.
 * @param matrix - Where an insert puts the entity, for one that a block holds.
 */
function entityToSvg(
  e: Drawn,
  mark: string,
  pen: Pen,
  look: Look,
  style: TextStyle | undefined,
  matrix?: Matrix,
): string {
  // A lineweight of 0 draws as the thinnest line, as in AutoCAD.
  const s = `stroke="${pen.color}"${look.stroke(pen.lineweight)} ${mark}`;
  const at = (p: Point): Point => (matrix ? mapPoint(matrix, p) : p);
  if (e.kind !== "text" && pen.dashes) {
    const d = dashedPath(e, pen.dashes, matrix);
    // A pattern with a dot draws it as a round cap on a path of no length.
    const cap = pen.dashes.includes(0) ? ` stroke-linecap="round"` : "";
    if (d !== undefined) return `<path d="${d}"${cap} ${s}/>`;
  }
  switch (e.kind) {
    case "line": {
      const [from, to] = [at(e.from), at(e.to)];
      return `<line x1="${fmt(from[0])}" y1="${fmt(from[1])}" x2="${fmt(to[0])}" y2="${fmt(to[1])}" ${s}/>`;
    }
    case "polyline": {
      const tag = e.closed ? "polygon" : "polyline";
      const points = e.points
        .map(at)
        .map(([px, py]) => `${fmt(px)},${fmt(py)}`)
        .join(" ");
      return `<${tag} points="${points}" ${s}/>`;
    }
    case "circle":
      return roundToSvg(at(e.center), rounded(e.radius, matrix), s);
    case "arc": {
      const [cx, cy] = e.center;
      const a0 = rad(e.startAngle);
      const a1 = rad(e.endAngle);
      const large = sweep(e.startAngle, e.endAngle) > 180 ? 1 : 0;
      const ends = [a0, a1].map((a) =>
        at([cx + e.radius * Math.cos(a), cy + e.radius * Math.sin(a)]),
      );
      const [start, end] = ends.map(([px, py]) => `${fmt(px)} ${fmt(py)}`);
      const round = rounded(e.radius, matrix);
      // SVG draws nothing for an arc that ends where it starts, which is where rounding can
      // put the ends of an arc that is all but a full turn.
      if (start === end && large === 1) return roundToSvg(at(e.center), round, s);
      // sweep-flag 1 is the positive-angle direction in local (Y-up) coordinates: counterclockwise.
      return `<path d="M ${start} A ${fmt(round.rx)} ${fmt(round.ry)} ${fmt(round.turn)} ${large} ${round.sweep} ${end}" ${s}/>`;
    }
    case "text": {
      // Undo the group's Y flip so the text reads upright, then apply CAD rotation.
      let t = `translate(${fmt(e.at[0])} ${fmt(e.at[1])}) scale(1 -1)${e.rotation ? ` rotate(${fmt(-e.rotation)})` : ""}`;
      // An insert's matrix is applied last, so it comes first.
      if (matrix) t = `matrix(${matrix.map(fmt).join(" ")}) ${t}`;
      // The baseline is moved along the text's own up, before the style widens or slants it.
      const font = fontInfo(style?.font ?? STANDARD_FONT);
      // A text's height is the height of its capitals, which a font draws smaller than its size.
      const size = e.height / (font?.capHeight ?? 1);
      const capital = font?.capHeight === undefined ? CAP_HEIGHT * e.height : e.height;
      const drop =
        e.valign === "top"
          ? capital
          : e.valign === "middle"
            ? capital / 2
            : e.valign === "bottom"
              ? -DESCENT * size
              : 0;
      if (drop !== 0) t += ` translate(0 ${fmt(drop)})`;
      const width = style?.widthFactor ?? 1;
      if (width !== 1) t += ` scale(${fmt(width)} 1)`;
      const oblique = style?.obliqueAngle ?? 0;
      if (oblique !== 0) t += ` skewX(${fmt(-oblique)})`;
      const anchor =
        e.align === "center"
          ? ` text-anchor="middle"`
          : e.align === "right"
            ? ` text-anchor="end"`
            : "";
      const family = font?.family ?? "monospace";
      return `<text transform="${t}" font-size="${fmt(size)}" font-family="${esc(family)}"${anchor} fill="${pen.color}" stroke="none" ${mark}>${esc(e.value)}</text>`;
    }
  }
}

/** A circle, or the ellipse an insert that scales unevenly makes of one. */
function roundToSvg(center: Point, round: ReturnType<typeof rounded>, s: string): string {
  const [cx, cy] = [fmt(center[0]), fmt(center[1])];
  if (fmt(round.rx) === fmt(round.ry))
    return `<circle cx="${cx}" cy="${cy}" r="${fmt(round.rx)}" ${s}/>`;
  const turn = round.turn === 0 ? "" : ` transform="rotate(${fmt(round.turn)} ${cx} ${cy})"`;
  return `<ellipse cx="${cx}" cy="${cy}" rx="${fmt(round.rx)}" ry="${fmt(round.ry)}"${turn} ${s}/>`;
}

/**
 * A linetype pattern as SVG thinks of dashes: dash, gap, dash, gap, starting with a dash and
 * of even length. Dashes or gaps side by side are joined, and a pattern that starts with a gap
 * is turned to start with the dash after it. Undefined for a pattern with no gap, with no dash
 * or dot, or with no length, and the caller then draws the entity solid.
 */
function alternating(pattern: readonly number[]): number[] | undefined {
  const first = pattern.findIndex((length) => length >= 0);
  if (first < 0) return undefined;
  const runs: number[] = [];
  // A dot is a dash of no length. Runs alternate dash, gap, so an odd index is a gap.
  for (const length of [...pattern.slice(first), ...pattern.slice(0, first)]) {
    if (runs.length % 2 === (length < 0 ? 0 : 1)) runs[runs.length - 1]! += Math.abs(length);
    else runs.push(Math.abs(length));
  }
  if (runs.length < 2) return undefined;
  if (runs.length % 2 === 1) runs[0]! += runs.pop()!;
  return runs.reduce((a, b) => a + b, 0) > 0 ? runs : undefined;
}

/**
 * An entity cut into the dashes of its pattern, as path data, or undefined when the pattern
 * is too fine for the entity and it draws solid. A polyline starts the pattern again at each
 * vertex, as AutoCAD does unless told otherwise. The cuts are made in the entity's own
 * coordinates and then placed by `matrix`, so a pattern scales with the insert that draws it.
 */
function dashedPath(
  e: Exclude<Drawn, { kind: "text" }>,
  dashes: readonly number[],
  matrix: Matrix | undefined,
): string | undefined {
  const place = (px: number, py: number): string => {
    const [mx, my] = matrix ? mapPoint(matrix, [px, py]) : [px, py];
    return `${fmt(mx)} ${fmt(my)}`;
  };
  const total = dashes.reduce((a, b) => a + b, 0);
  const out: string[] = [];
  /** Cuts a stretch of the given length, and draws each dash from `from` to `to` along it. */
  const cut = (length: number, draw: (from: number, to: number) => string): boolean => {
    // Dashes that add up to no length would never reach the end of the stretch.
    if (!(total > 0) || length / total > MAX_DASHES) return false;
    let at = 0;
    for (let i = 0; at < length; i = (i + 1) % dashes.length) {
      const end = Math.min(at + dashes[i]!, length);
      if (i % 2 === 0) out.push(draw(at, end));
      at += dashes[i]!;
    }
    return true;
  };
  const straight = (a: Point, b: Point): boolean => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const along = (t: number) =>
      place(a[0] + ((b[0] - a[0]) * t) / length, a[1] + ((b[1] - a[1]) * t) / length);
    return length === 0 || cut(length, (from, to) => `M ${along(from)} L ${along(to)}`);
  };
  const round = (center: Point, radius: number, start: number, turn: number): boolean => {
    const along = (t: number) => {
      const angle = rad(start) + t / radius;
      return place(center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle));
    };
    const shape = rounded(radius, matrix);
    return cut(radius * rad(turn), (from, to) => {
      // SVG draws no arc between two equal points, so a dot is a line of no length.
      if (to === from) return `M ${along(from)} L ${along(to)}`;
      const arc = `A ${fmt(shape.rx)} ${fmt(shape.ry)} ${fmt(shape.turn)}`;
      // A dash of a full turn ends where it starts, so it is drawn as two halves.
      if ((to - from) / radius > Math.PI && along(from) === along(to)) {
        return `M ${along(from)} ${arc} 0 ${shape.sweep} ${along((from + to) / 2)} ${arc} 0 ${shape.sweep} ${along(to)}`;
      }
      const large = (to - from) / radius > Math.PI ? 1 : 0;
      return `M ${along(from)} ${arc} ${large} ${shape.sweep} ${along(to)}`;
    });
  };
  let ok: boolean;
  switch (e.kind) {
    case "line":
      ok = straight(e.from, e.to);
      break;
    case "polyline": {
      const points = e.closed ? [...e.points, e.points[0]!] : e.points;
      ok = points.slice(1).every((p, i) => straight(points[i]!, p));
      break;
    }
    case "circle":
      ok = round(e.center, e.radius, 0, 360);
      break;
    case "arc":
      ok = round(e.center, e.radius, e.startAngle, sweep(e.startAngle, e.endAngle));
      break;
  }
  return ok && out.length > 0 ? out.join(" ") : undefined;
}

function rad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function esc(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}
