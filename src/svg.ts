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
} from "./drawing.ts";
import { extents } from "./extents.ts";
import { fontInfo, STANDARD_FONT } from "./fonts.ts";
import { fmt } from "./format.ts";
import { layerKey } from "./layers.ts";
import { builtInLinetype, lineweightCode } from "./linetypes.ts";

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
  // Each entity keeps its index in `drawing.entities`, for its element's data-entity. What an
  // insert holds is judged entity by entity, unless the insert's own layer is frozen.
  const shown = [...drawing.entities.entries()].filter(([, e]) =>
    e.kind === "insert" ? !frozen({ name: e.layer }) : !hidden({ name: e.layer }),
  );
  const blocks = blocksByKey(drawing.blocks);
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
  // AutoCAD scales the dashes of a referenced drawing by the linetype scale of the drawing
  // that references it.
  // AutoCAD reads a scale of 0 or less as 1, and so is one that is not a finite number here.
  const stated = drawing.linetypeScale ?? 1;
  const scale = stated > 0 && Number.isFinite(stated) ? stated : 1;
  const styleOf = (e: Entity, from?: Referenced): TextStyle | undefined =>
    e.kind === "text" && e.style !== undefined
      ? tablesOf(from).textStyles.get(layerKey(e.style))
      : undefined;
  const stroke = options.strokeWidth ?? 1;

  /**
   * The pen of an entity that draws on `on`. `insertLayer` is the layer of the insert that
   * holds it, whose linetype and lineweight an entity set to ByBlock takes. `from` is the
   * referenced drawing the entity is in, whose linetypes it names.
   */
  const pen = (e: Drawn, on: LayerRef, insertLayer?: LayerRef, from?: Referenced): Pen => {
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
      color: aciColor(layer?.color ?? 7),
      dashes: Number.isFinite(scale) ? pattern?.map((length) => length * scale) : undefined,
      lineweight: code < 0 ? DEFAULT_LINEWEIGHT : code,
    };
  };

  const marks = (e: Entity, index: number): string =>
    `data-layer="${esc(e.layer)}" data-entity="${index}"${e.id === undefined ? "" : ` data-id="${esc(e.id)}"`}`;
  const body = shown
    .map(([i, e]) => {
      if (e.kind !== "insert")
        return entityToSvg(e, marks(e, i), pen(e, { name: e.layer }), stroke, styleOf(e));
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
          const drawnPen = pen(drawn, at.layer, at.insertLayer, at.from);
          const style = styleOf(drawn, at.from);
          parts.push(entityToSvg(drawn, mark, drawnPen, stroke, style, at.matrix));
        },
        xrefs,
      );
      const inside = parts.length > 0 ? `\n      ${parts.join("\n      ")}\n    ` : "";
      const xref = blocks.has(layerKey(e.block)) ? undefined : findXref(drawing, e.block);
      const path = xref === undefined ? "" : ` data-xref="${esc(xref.path)}"`;
      return `<g ${marks(e, i)} data-block="${esc(e.block)}"${path}>${inside}</g>`;
    })
    .join("\n    ");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)}">`,
    `  <g transform="scale(1 -1)" fill="none" stroke-width="${fmt(stroke)}" vector-effect="non-scaling-stroke">`,
    `    ${body}`,
    `  </g>`,
    `</svg>`,
    ``,
  ].join("\n");
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
  stroke: number,
  style: TextStyle | undefined,
  matrix?: Matrix,
): string {
  // A lineweight of 0 draws as the thinnest line, as in AutoCAD.
  const width =
    pen.lineweight === DEFAULT_LINEWEIGHT
      ? ""
      : ` stroke-width="${fmt((stroke * Math.max(pen.lineweight, 5)) / DEFAULT_LINEWEIGHT)}"`;
  const s = `stroke="${pen.color}"${width} vector-effect="non-scaling-stroke" ${mark}`;
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
