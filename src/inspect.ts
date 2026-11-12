// What a reader of the plot would call a mistake in its text, which no rule of a file forbids:
// a text over another, a text that runs out of the outline it starts in, a text off the paper.
// `lint` holds the rules a file must meet. These are warnings about the picture.
import {
  blocksByKey,
  eachDrawn,
  mapPoint,
  referencedByKey,
  type Matrix,
  type Referenced,
} from "./blocks.ts";
import { callOf, type CallSite } from "./callsite.ts";
import { dimensionPicture } from "./dimensions.ts";
import type { Drawing, Entity, Insert, Point, Text } from "./drawing.ts";
import { written } from "./format.ts";
import { layerKey } from "./layers.ts";
import { measureText } from "./measure.ts";
import { paperInfo } from "./papers.ts";
import { shown } from "./rules.ts";
import { visibility } from "./svg.ts";

/** The checks `inspectText` makes. `text-check-capped` says that it stopped short. */
export type TextRule =
  | "text-overlaps-text"
  | "text-leaves-boundary"
  | "text-off-paper"
  | "text-check-capped";

/** What names a text, or the outline it left, among the entities of its space. */
export interface TextOccurrence {
  /** The index of the entity in its space. For what an insert draws, the insert's. */
  readonly entity: number;
  /** For the text of an insert's attribute, the attribute's tag. */
  readonly attribute?: string;
  /** The entity's `id`, when it has one. */
  readonly id?: string;
}

/** A warning about a text as it plots. */
export interface TextWarning extends Partial<TextOccurrence> {
  readonly rule: TextRule;
  readonly severity: "warning";
  readonly message: string;
  /** The layout the text is on. Missing for a text of model space. */
  readonly layout?: string;
  /** The layer the entity names. */
  readonly layer?: string;
  /**
   * The box around the text as it plots, and around the other text too when two overlap, in
   * the coordinates of its space: drawing units in model space, paper units on a layout.
   */
  readonly bounds?: { readonly min: Point; readonly max: Point };
  /** The other text of an overlap, or the closed polyline a text leaves. */
  readonly other?: TextOccurrence;
  /** The call that drew the entity, when the drawing's builder recorded calls. */
  readonly call?: CallSite;
}

export interface InspectOptions {
  /** Counts the layers whose `plot` is false too, as `toSVG` draws them with the same option. */
  readonly drawNoPlot?: boolean;
  /** The drawing each xref stands for, by the xref's name, as `toSVG` takes them. */
  readonly xrefs?: Readonly<Record<string, Drawing>>;
}

/** How far a text may reach into another, or past an outline, as a share of its height. */
const TOLERANCE = 0.1;

/**
 * The most work one drawing is checked for, counted in what the checks look at: each box the
 * grid looks at, the eight corners of two texts held against each other, and each point of an
 * outline held against a text, eight times over for the four sides of its box.
 */
const MAX_WORK = 16_000_000;

type Box = readonly [minX: number, minY: number, maxX: number, maxY: number];

/** What draws a text or an outline, as `TextOccurrence` names it, with the entity's layer. */
interface Placed {
  readonly entity: number;
  readonly attribute: string | undefined;
  readonly id: string | undefined;
  readonly layer: string;
}

interface PlacedText extends Placed {
  readonly value: string;
  /** The point the text is justified to. */
  readonly at: Point;
  /** The box of its capitals: the baseline's start and end, then the top's end and start. */
  readonly corners: readonly Point[];
  /** The same box, smaller on every side by what a text may reach past an outline. */
  readonly inner: readonly Point[];
  readonly height: number;
  readonly box: Box;
}

interface Outline extends Placed {
  readonly points: readonly Point[];
  readonly area: number;
  readonly box: Box;
  /** True for a rectangle with level sides, which is its own box: most outlines are. */
  readonly upright: boolean;
}

/**
 * Looks at the text of a drawing as it plots, and warns about:
 *
 * - `text-overlaps-text`: two texts whose boxes overlap by more than a tenth of the smaller
 *   one's height. The warning is on the later text, and `other` names the earlier.
 * - `text-leaves-boundary`: a text whose point is inside a closed polyline, or on it, and
 *   whose box reaches more than a tenth of its height past the smallest such polyline, which
 *   `other` names: a note past the sheet's border, a label out of its room, a field out of
 *   its cell.
 * - `text-off-paper`: on a layout, a text whose box reaches that far past the paper.
 *
 * A text's box is the one `measureText` gives: its capitals, turned and leaned as the text
 * is. A dimension's text counts as a text, where the dimension's picture puts it. Only what plots counts, as in `toSVG`: nothing on a layer that is off, frozen or set not
 * to plot. Model space and each layout are looked at apart, and a layout's text is never held
 * against what a viewport shows. An insert counts for the texts, the attributes and the
 * closed polylines its block draws, where the insert puts them, and a text with no characters
 * but spaces is left out. Each text gets one warning of a rule at most.
 *
 * It never changes what `lint` reports or what `toDXF` writes. Its work is bounded: a drawing
 * with more text and outlines near each other than it checks gets one `text-check-capped`
 * warning, and the rest is not held against other texts or outlines. Like `toSVG`, it may
 * throw on a drawing `lint` reports an error for.
 */
export function inspectText(drawing: Drawing, options: InspectOptions = {}): TextWarning[] {
  const { tablesOf, hidden, frozen, styleOf } = visibility(drawing, options.drawNoPlot);
  const blocks = blocksByKey(drawing.blocks);
  const xrefs = referencedByKey(drawing, options.xrefs);
  const out: TextWarning[] = [];
  let work = 0;
  let capped = false;
  /** Counts the cost of a step, and says whether there is room left to take it. */
  const spend = (cost: number): boolean => {
    if (capped) return false;
    work += cost;
    capped = work > MAX_WORK;
    return !capped;
  };

  const space = (entities: readonly Entity[], layout?: string, paper?: Box): void => {
    const texts: PlacedText[] = [];
    const outlines: Outline[] = [];
    /** Keeps what the rules look at: a text with something to draw, or a closed polyline. */
    const keep = (
      drawn: Exclude<Entity, Insert>,
      index: number,
      matrix?: Matrix,
      from?: Referenced,
      attribute?: string,
    ): void => {
      const { id, layer } = entities[index]!;
      const place = (p: Point): Point => (matrix ? mapPoint(matrix, p) : p);
      if (drawn.kind === "linear-dimension" || drawn.kind === "aligned-dimension") {
        // A dimension's text is a text where its picture puts it.
        const style = tablesOf(from).dimensionStyles.get(layerKey(drawn.style));
        if (style === undefined) return;
        const { label } = dimensionPicture(drawn, style);
        const text: Text = {
          kind: "text",
          layer: drawn.layer,
          at: label.at,
          height: label.height,
          value: label.value,
          rotation: label.rotation,
          align: "center",
          ...(label.style === undefined ? {} : { style: label.style }),
        };
        if (text.value.trim() !== "") keep(text, index, matrix, from, attribute);
        return;
      }
      if (drawn.kind === "text") {
        const style = styleOf(drawn, from);
        const { corners } = measureText(style ? { ...drawn, ...style } : drawn);
        const placed = matrix ? corners.map(place) : corners;
        const inner = innerBox(placed);
        if (!inner) return;
        texts.push({
          entity: index,
          attribute,
          id,
          layer,
          value: drawn.value,
          at: place(drawn.at),
          corners: placed,
          inner: inner.corners,
          height: inner.height,
          box: boxOf(placed),
        });
      } else if (drawn.kind === "polyline") {
        const points = matrix ? drawn.points.map(place) : drawn.points;
        const area = Math.abs(shoelace(points));
        if (!(area > 0)) return;
        const box = boxOf(points);
        // A polygon that fills its box is the box.
        const upright = written(area) === written(2 * (box[2] - box[0]) * (box[3] - box[1]));
        outlines.push({ entity: index, attribute, id, layer, points, area, box, upright });
      }
    };
    const wanted = (e: Exclude<Entity, Insert>): boolean =>
      e.kind === "text"
        ? e.value.trim() !== ""
        : e.kind === "linear-dimension" ||
          e.kind === "aligned-dimension" ||
          (e.kind === "polyline" && e.closed && e.points.length > 2);
    entities.forEach((entity, index) => {
      // Most entities are no insert, and are looked at without the walk an insert needs.
      if (entity.kind !== "insert") {
        if (wanted(entity) && !hidden({ name: entity.layer })) keep(entity, index);
        return;
      }
      if (frozen({ name: entity.layer })) return;
      eachDrawn(
        entity,
        blocks,
        frozen,
        (drawn, at) => {
          if (!wanted(drawn) || at.frozen || hidden(at.layer)) return;
          keep(drawn, index, at.matrix, at.from, at.attribute);
        },
        xrefs,
      );
    });

    const warn = (rule: TextRule, text: PlacedText, message: string, other?: Placed): void => {
      const box =
        other && "corners" in other
          ? boxOf([...text.corners, ...(other as PlacedText).corners])
          : text.box;
      const call = callOf(entities, text.entity);
      out.push({
        rule,
        severity: "warning",
        message,
        ...(layout === undefined ? {} : { layout }),
        entity: text.entity,
        ...(text.attribute === undefined ? {} : { attribute: text.attribute }),
        ...(text.id === undefined ? {} : { id: text.id }),
        layer: text.layer,
        bounds: {
          min: [written(box[0]), written(box[1])],
          max: [written(box[2]), written(box[3])],
        },
        ...(other === undefined ? {} : { other: occurrence(other) }),
        ...(call === undefined ? {} : { call }),
      });
    };
    const nearText = grid(
      texts.map((t) => t.box),
      spend,
    );
    const nearOutline = grid(
      outlines.map((o) => o.box),
      spend,
    );
    /** The earliest text before this one that it overlaps. */
    const earliest = (text: PlacedText, index: number): PlacedText | undefined => {
      let over = -1;
      nearText(
        text.box,
        (other) => {
          if ((over < 0 || other < over) && spend(8) && overlap(text, texts[other]!)) over = other;
        },
        index,
      );
      return texts[over];
    };
    /** The smallest closed polyline the text's point is in, when the text runs past it. */
    const left = (text: PlacedText): Outline | undefined => {
      let around: Outline | undefined;
      nearOutline([text.at[0], text.at[1], text.at[0], text.at[1]], (other) => {
        const outline = outlines[other]!;
        if (around && around.area <= outline.area) return;
        // The grid finds an outline by its box, which settles it for a rectangle.
        if (outline.upright || (spend(outline.points.length) && inside(text.at, outline.points))) {
          around = outline;
        }
      });
      // A search cut short may have missed the smallest, so it judges nothing.
      if (!around || capped) return undefined;
      if (around.upright) return boxed(text.inner, around.box) ? undefined : around;
      return spend(8 * around.points.length) && !within(text.inner, around.points)
        ? around
        : undefined;
    };
    texts.forEach((text, index) => {
      const over = capped ? undefined : earliest(text, index);
      if (over) {
        warn(
          "text-overlaps-text",
          text,
          `${named(text)} plots over ${named(over, false)}. Move one of them or make it shorter`,
          over,
        );
      }
      const around = capped ? undefined : left(text);
      if (around) {
        warn(
          "text-leaves-boundary",
          text,
          `${named(text)} starts inside a closed polyline and runs past it. Make it shorter, break it into lines that measureText says fit, or move it`,
          around,
        );
      }
      if (paper && !boxed(text.inner, paper)) {
        warn(
          "text-off-paper",
          text,
          `${named(text)} runs off the paper of layout ${shown(layout)}, which is ${paper[2]} by ${paper[3]}`,
        );
      }
    });
  };

  if (Array.isArray(drawing.entities)) space(drawing.entities);
  for (const layout of Array.isArray(drawing.layouts) ? drawing.layouts : []) {
    if (!Array.isArray(layout?.entities)) continue;
    const paper = typeof layout.paper === "string" ? paperInfo(layout.paper) : undefined;
    space(layout.entities, layout.name, paper && [0, 0, paper.width, paper.height]);
  }
  if (capped) {
    out.push({
      rule: "text-check-capped",
      severity: "warning",
      message:
        "The drawing has more text and closed polylines near each other than inspectText checks: it stopped short, so a text may overlap another or leave its outline with no warning",
    });
  }
  return out;
}

function occurrence({ entity, attribute, id }: Placed): TextOccurrence {
  return {
    entity,
    ...(attribute === undefined ? {} : { attribute }),
    ...(id === undefined ? {} : { id }),
  };
}

/** A text by its value, and by its tag when it is an attribute. */
function named(text: PlacedText, first = true): string {
  const what = text.attribute === undefined ? "text" : `attribute ${shown(text.attribute)}`;
  return `${first ? what[0]!.toUpperCase() + what.slice(1) : what} ${shown(text.value)}`;
}

/**
 * A text's box made smaller on every side by what a text may reach past an outline, with the
 * text's height in the picture, or undefined for a box with no length or no height.
 */
function innerBox(
  corners: readonly Point[],
): { corners: readonly Point[]; height: number } | undefined {
  const c0 = corners[0]!;
  const c1 = corners[1]!;
  const c2 = corners[2]!;
  const c3 = corners[3]!;
  const alongX = c1[0] - c0[0];
  const alongY = c1[1] - c0[1];
  const upX = c3[0] - c0[0];
  const upY = c3[1] - c0[1];
  const length = Math.hypot(alongX, alongY);
  const side = Math.hypot(upX, upY);
  // The distance from the baseline to the top of a capital, whatever the text's lean.
  const height = Math.abs(alongX * upY - alongY * upX) / length;
  if (!(length > 0 && height > 0 && Number.isFinite(length + side))) return undefined;
  const a = Math.min(TOLERANCE * height, length / 2) / length;
  const u = Math.min(TOLERANCE * height, side / 2) / side;
  const move = (p: Point, i: number, j: number): Point => [
    p[0] + i * a * alongX + j * u * upX,
    p[1] + i * a * alongY + j * u * upY,
  ];
  return {
    corners: [move(c0, 1, 1), move(c1, -1, 1), move(c2, -1, -1), move(c3, 1, -1)],
    height,
  };
}

function boxOf(points: readonly Point[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return [minX, minY, maxX, maxY];
}

/** Twice the area of a polygon, positive when its points run counterclockwise. */
function shoelace(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum;
}

/** Whether two texts' boxes overlap by more than the tolerance, along every side of both. */
function overlap(a: PlacedText, b: PlacedText): boolean {
  const tolerance = TOLERANCE * Math.min(a.height, b.height);
  // A box is a parallelogram, so two sides of each give every direction across both.
  for (let side = 0; side < 4; side++) {
    const corners = side < 2 ? a.corners : b.corners;
    const p = corners[side % 2]!;
    const q = corners[(side % 2) + 1]!;
    const nx = q[1] - p[1];
    const ny = p[0] - q[0];
    const size = Math.hypot(nx, ny);
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (let i = 0; i < 4; i++) {
      const along = (a.corners[i]![0] * nx + a.corners[i]![1] * ny) / size;
      if (along < a0) a0 = along;
      if (along > a1) a1 = along;
      const other = (b.corners[i]![0] * nx + b.corners[i]![1] * ny) / size;
      if (other < b0) b0 = other;
      if (other > b1) b1 = other;
    }
    if (!(Math.min(a1, b1) - Math.max(a0, b0) > tolerance)) return false;
  }
  return true;
}

/** Whether every point is in a box, or on its edge. */
function boxed(points: readonly Point[], box: Box): boolean {
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (p[0] < box[0] || p[0] > box[2] || p[1] < box[1] || p[1] > box[3]) return false;
  }
  return true;
}

/** Which side of the line from `a` to `b` the point `p` is on: positive on its left. */
function side(a: Point, b: Point, p: Point): number {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}

/** Whether a point is inside a polygon. A point on its outline is. */
function inside(p: Point, polygon: readonly Point[]): boolean {
  const x = p[0];
  const y = p[1];
  let odd = false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    if (
      (a[0] < b[0] ? a[0] <= x && x <= b[0] : b[0] <= x && x <= a[0]) &&
      (a[1] < b[1] ? a[1] <= y && y <= b[1] : b[1] <= y && y <= a[1])
    ) {
      // On the side itself, within what the arithmetic can tell.
      const reach = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (Math.abs(side(a, b, p)) <= 1e-9 * reach * Math.max(1, reach)) return true;
    }
    if (a[1] > y !== b[1] > y && x < a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) {
      odd = !odd;
    }
  }
  return odd;
}

/** Whether a box lies wholly in a polygon, which may be concave. Touching its outline is in. */
function within(box: readonly Point[], polygon: readonly Point[]): boolean {
  for (let j = 0; j < box.length; j++) if (!inside(box[j]!, polygon)) return false;
  // Every corner is in, so the box is out only where the outline cuts through one of its sides.
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    for (let j = 0; j < box.length; j++) {
      const c = box[j]!;
      const d = box[(j + 1) % box.length]!;
      if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return false;
    }
  }
  return true;
}

/** The most cells one box is filed under. A larger box is held against every other. */
const MAX_CELLS = 64;

/** The most cells a grid has each way. */
const SPAN = 1024;

/**
 * Files boxes in a grid of cells about their own size, and gives a function that calls `found`
 * with the index of each box below `below` that may touch a given box, once each. It spends
 * one for each box it looks at, and stops when `spend` says there is no room left.
 */
function grid(
  boxes: readonly Box[],
  spend: (cost: number) => boolean,
): (box: Box, found: (index: number) => void, below?: number) => void {
  if (boxes.length === 0) return () => {};
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let width = 0;
  let height = 0;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    if (b[0] < minX) minX = b[0];
    if (b[1] < minY) minY = b[1];
    if (b[2] > maxX) maxX = b[2];
    if (b[3] > maxY) maxY = b[3];
    width += b[2] - b[0];
    height += b[3] - b[1];
  }
  // A cell is as large as the boxes are on average, and no smaller than the grid allows over
  // the space the boxes span.
  const cellX = Math.max(width / boxes.length, (maxX - minX) / SPAN) || 1;
  const cellY = Math.max(height / boxes.length, (maxY - minY) / SPAN) || 1;
  const column = (x: number): number =>
    Math.max(0, Math.min(SPAN - 1, Math.floor((x - minX) / cellX)));
  const row = (y: number): number =>
    Math.max(0, Math.min(SPAN - 1, Math.floor((y - minY) / cellY)));
  // Each cell holds its boxes in the order of their indexes, and so does `large`.
  const cells = new Map<number, number[]>();
  const large: number[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    const x0 = column(b[0]);
    const x1 = column(b[2]);
    const y0 = row(b[1]);
    const y1 = row(b[3]);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS) {
      large.push(i);
      continue;
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const filed = cells.get(x * SPAN + y);
        if (filed) filed.push(i);
        else cells.set(x * SPAN + y, [i]);
      }
    }
  }
  // The last query that looked at each box, so that a box in two cells is found once.
  const seen = new Int32Array(boxes.length);
  let query = 0;
  return (b, found, below = boxes.length) => {
    query++;
    /** Looks at a box, and says whether there is room to go on. */
    const look = (index: number): boolean => {
      if (!spend(1)) return false;
      if (seen[index] !== query) {
        seen[index] = query;
        const o = boxes[index]!;
        if (o[0] <= b[2] && o[2] >= b[0] && o[1] <= b[3] && o[3] >= b[1]) found(index);
      }
      return true;
    };
    for (let i = 0; i < large.length && large[i]! < below; i++) if (!look(large[i]!)) return;
    // A box outside the grid touches nothing that is filed in it.
    if (b[2] < minX || b[0] > maxX || b[3] < minY || b[1] > maxY) return;
    const x0 = column(b[0]);
    const x1 = column(b[2]);
    const y0 = row(b[1]);
    const y1 = row(b[3]);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS) {
      for (let i = 0; i < below; i++) if (!look(i)) return;
      return;
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const filed = cells.get(x * SPAN + y);
        if (!filed) continue;
        for (let i = 0; i < filed.length && filed[i]! < below; i++) if (!look(filed[i]!)) return;
      }
    }
  };
}
