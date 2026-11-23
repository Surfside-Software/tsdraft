// The part of a file a read with `only` keeps: what named layouts show of model space, and areas of
// it. Both readers read the file once without geometry for its layouts and blocks, build the filter
// here, and read again keeping what it lets through.
import type { Point } from "../drawing.ts";
import { layerKey, layoutNameKey } from "../layers.ts";
import { paragraphGutter, type ParagraphColumns } from "../paragraphs.ts";
import { ReadError } from "./groups.ts";
import type {
  DrawingRead,
  ReadBlock,
  ReadEntity,
  ReadLayout,
  ReadMtext,
  ReadPart,
  ReadViewport,
} from "./model.ts";

/** The key a space's `other` counts what a read with `only` left out of model space under. */
export const OUTSIDE_THE_READ = "outside what was read";

/** The most layouts a `ReadError` for a name the file lacks lists. */
const LISTED = 50;

/**
 * The most windows and areas a read with `only` holds each entity of model space to, so the filter's
 * work stays in proportion to the file. A sheet holds a few viewports.
 */
export const MOST_WINDOWS = 1024;

/** How deep inserts of blocks in blocks are followed for a box. Deeper, the box is not known. */
const DEPTH = 64;

/**
 * How much each window and area is widened, of its size: for what draws a little past its points,
 * such as a point's figure, a lineweight or an arrowhead, and so both readers keep what touches it.
 */
const WIDEN = 1 / 50;

/** A box: `[minX, minY, maxX, maxY]`. */
type Box = readonly [number, number, number, number];

/**
 * The corners in model space of what a viewport shows: its rectangle on the paper, taken to model
 * space about its view's center at its ratio and turned by its twist, counterclockwise from the
 * corner at the lower left of the paper. A viewport with no height shows nothing, and gives none.
 */
export function viewportWindow(
  viewport: ReadViewport,
): readonly [Point, Point, Point, Point] | undefined {
  if (!(viewport.ratio > 0)) return undefined;
  const [cx, cy] = viewport.viewCenter;
  const halfWidth = viewport.width / viewport.ratio / 2;
  const halfHeight = viewport.viewHeight / 2;
  const turn = (viewport.twist * Math.PI) / 180;
  const [cos, sin] = viewport.twist === 0 ? [1, 0] : [Math.cos(turn), Math.sin(turn)];
  // The paper's x axis runs along (cos, -sin) in model space, and its y axis along (sin, cos).
  const at = (x: number, y: number): Point => [
    cx + x * halfWidth * cos + y * halfHeight * sin,
    cy - x * halfWidth * sin + y * halfHeight * cos,
  ];
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
}

/** What a read with `only` keeps, from a read of the same file without geometry. */
export interface PartFilter {
  /** The part as the read gives it back: the layouts as the file spells them, the areas ordered. */
  readonly part: ReadPart;
  /** True for a layout the read keeps, by its name as the file spells it. */
  readonly keepsLayout: (name: string) => boolean;
  /** True when model space keeps an entity: its box meets a window or an area, or is not known. */
  readonly keeps: (entity: ReadEntity) => boolean;
}

/**
 * The filter of a read with `only`, from a read of the same file without geometry.
 *
 * @throws ReadError for an `only` that names no layout and no area, a name the file has no layout
 *   of, `Model`, an area with a corner that is not finite, or more than `MOST_WINDOWS` windows and
 *   areas in all.
 */
export function partFilter(first: DrawingRead, only: ReadPart): PartFilter {
  if (typeof only !== "object" || only === null || Array.isArray(only))
    throw new ReadError("`only` is an object of layouts and areas");
  const names: readonly unknown[] = only.layouts ?? [];
  const areas: readonly unknown[] = only.areas ?? [];
  if (!Array.isArray(names) || !Array.isArray(areas))
    throw new ReadError("`only` gives its layouts and its areas each as a list");
  if (names.length + areas.length > MOST_WINDOWS)
    throw new ReadError(`\`only\` names more than ${MOST_WINDOWS} layouts and areas in all`);
  if (names.length === 0 && areas.length === 0)
    throw new ReadError("`only` names no layout and no area, so it would keep nothing");
  // Names compared as the leading CAD app compares a layout's, which `layoutNameKey` gives.
  const byName = new Map<string, ReadLayout>();
  for (const l of first.layouts)
    if (!byName.has(layoutNameKey(l.name))) byName.set(layoutNameKey(l.name), l);
  const spelled: string[] = [];
  const kept = new Set<string>();
  const windows: Box[] = [];
  let everything = false;
  for (const name of names) {
    if (typeof name !== "string")
      throw new ReadError("`only` names a layout by a value that is not a string");
    const key = layoutNameKey(name);
    const layout = byName.get(key);
    if (layout === undefined) {
      const held = first.layouts.slice(0, LISTED).map((l) => JSON.stringify(l.name));
      const more =
        first.layouts.length > LISTED ? `, and ${first.layouts.length - LISTED} more` : "";
      throw new ReadError(
        key === layoutNameKey("Model")
          ? "`only` names `Model`: model space is read as the layouts show it, or whole without `only`"
          : `the file has no layout named ${JSON.stringify(name)}; it has ${held.join(", ") || "none"}${more}`,
      );
    }
    if (kept.has(key)) continue;
    kept.add(key);
    spelled.push(layout.name);
    for (const viewport of layout.viewports) {
      // A view along another direction than straight down has no window in the plane.
      if (viewport.turnedView) everything = true;
      const corners = viewportWindow(viewport);
      if (corners) windows.push(widened(boxOfPoints(corners)));
    }
    if (windows.length > MOST_WINDOWS)
      throw new ReadError(
        `the layouts \`only\` names hold more than ${MOST_WINDOWS} viewports; read them a few at a time`,
      );
  }
  const ordered: (readonly [Point, Point])[] = [];
  for (const area of areas) {
    const [a, b] = Array.isArray(area) ? area : [];
    const numbers = Array.isArray(a) && Array.isArray(b) ? [a[0], a[1], b[0], b[1]] : [];
    if (numbers.length !== 4 || !numbers.every((n) => typeof n === "number" && Number.isFinite(n)))
      throw new ReadError("an area of `only` is not two corners whose numbers are finite");
    const box: Box = [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
    ];
    ordered.push([
      [box[0], box[1]],
      [box[2], box[3]],
    ]);
    windows.push(widened(box));
  }
  const part: ReadPart = {
    ...(spelled.length > 0 && { layouts: spelled }),
    ...(ordered.length > 0 && { areas: ordered }),
  };
  if (windows.length > MOST_WINDOWS)
    throw new ReadError(`\`only\` holds more than ${MOST_WINDOWS} windows and areas in all`);
  const keepsLayout = (name: string): boolean => kept.has(layoutNameKey(name));
  if (everything) return { part, keepsLayout, keeps: () => true };
  const boxes = new BlockBoxes(first);
  return {
    part,
    keepsLayout,
    keeps: (entity) => {
      const box = boxes.of(entity, 0);
      if (box === undefined) return true;
      for (const w of windows)
        if (box[0] <= w[2] && box[2] >= w[0] && box[1] <= w[3] && box[3] >= w[1]) return true;
      return false;
    },
  };
}

function widened(b: Box): Box {
  // Never less than the last digits of its coordinates, where the two readers' numbers differ.
  const by = Math.max(
    WIDEN * Math.max(b[2] - b[0], b[3] - b[1]),
    1e-9 * Math.max(Math.abs(b[0]), Math.abs(b[1]), Math.abs(b[2]), Math.abs(b[3]), 1),
  );
  return [b[0] - by, b[1] - by, b[2] + by, b[3] + by];
}

function boxOfPoints(points: readonly Point[]): Box {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** A growing box, which stays unknown once anything in it is. */
class Bounds {
  x0 = Infinity;
  y0 = Infinity;
  x1 = -Infinity;
  y1 = -Infinity;
  unknown = false;

  /** A point, of which a point in 3D gives its x and y. */
  point(p: readonly number[] | undefined, pad = 0): void {
    if (p === undefined) return;
    const [x = NaN, y = NaN] = p;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(pad)) {
      this.unknown = true;
      return;
    }
    const r = Math.abs(pad);
    if (x - r < this.x0) this.x0 = x - r;
    if (y - r < this.y0) this.y0 = y - r;
    if (x + r > this.x1) this.x1 = x + r;
    if (y + r > this.y1) this.y1 = y + r;
  }

  points(ps: readonly (readonly number[])[] | undefined, pad = 0): void {
    if (ps) for (const p of ps) this.point(p, pad);
  }

  box(b: Box | undefined): void {
    if (b === undefined) this.unknown = true;
    else {
      this.point([b[0], b[1]]);
      this.point([b[2], b[3]]);
    }
  }

  /** The sides of a polyline or a hatch's loop, each with its bulge, and a half width beside. */
  sides(ps: readonly Point[], bulges: readonly number[] | undefined, closed: boolean, pad: number) {
    this.points(ps, pad);
    if (!bulges) return;
    for (let i = 0; i < ps.length; i++) {
      const bulge = bulges[i] ?? 0;
      if (bulge === 0) continue;
      const next = i + 1 < ps.length ? ps[i + 1] : closed ? ps[0] : undefined;
      if (next === undefined) continue;
      const a = ps[i]!;
      const chord = Math.hypot(next[0] - a[0], next[1] - a[1]);
      // Every point of the arc lies within half the chord and its rise of the chord's middle.
      const reach = (chord / 2) * (1 + Math.abs(bulge));
      this.point([(a[0] + next[0]) / 2, (a[1] + next[1]) / 2], reach + pad);
    }
  }

  /** Widens what it holds so far by `r` each way. */
  pad(r: number): void {
    if (!(this.x0 <= this.x1)) return;
    const by = Math.abs(r);
    this.x0 -= by;
    this.y0 -= by;
    this.x1 += by;
    this.y1 += by;
  }

  done(): Box | undefined {
    if (this.unknown || !(this.x0 <= this.x1) || !(this.y0 <= this.y1)) return undefined;
    return [this.x0, this.y0, this.x1, this.y1];
  }
}

/**
 * The reach of a text from where it starts: twice its height for each character at its width
 * factor, and its height again, which no font of the core's draws past. A text's value counts its
 * codes as characters, which only widens it.
 */
function textReach(height: number, length: number, widthFactor = 1, oblique = 0): number {
  const h = Math.abs(height);
  // A slanted text leans its height times the slant's tangent, which the leading CAD app holds
  // to 85 degrees either way.
  const lean = Math.tan((Math.min(85, Math.abs(oblique) || 0) * Math.PI) / 180);
  return h * (1 + lean + 2 * Math.max(1, Math.abs(widthFactor)) * Math.max(1, length));
}

const SIZE_CODES = /\\([HWT])([-+]?[0-9.]+(?:[eE][-+]?[0-9]+)?)(x?);/g;

/**
 * How many times larger the codes of paragraph text may make its characters than its height and
 * width factor: each `\H`, `\W` and `\T` that grows them, a width factor, a tracking and a
 * relative height by its factor and an absolute height by its ratio to `height`, all multiplied,
 * which only widens it.
 */
function codeGrowth(value: string, height: number): number {
  if (!value.includes("\\")) return 1;
  let growth = 1;
  for (const [, code, n, relative] of value.matchAll(SIZE_CODES)) {
    const size = Math.abs(Number(n));
    const factor =
      code !== "H" || relative === "x" || height === 0 ? size : size / Math.abs(height);
    if (factor > 1) growth *= factor;
  }
  return growth;
}

/**
 * True for what a block's `other` counts that an insert of it does not draw: an entity it marks
 * invisible. An attribute definition it does not keep may be a constant one, which every insert draws.
 */
const undrawn = (key: string): boolean => key === "invisible";

/** The boxes of the blocks of a read, each worked out once, by the handle of its record. */
class BlockBoxes {
  readonly #byHandle = new Map<string, ReadBlock>();
  readonly #byName = new Map<string, ReadBlock | null>();
  readonly #boxes = new Map<ReadBlock, Box | undefined>();
  /** The blocks whose boxes are being worked out, so that a cycle gives no box. */
  readonly #open = new Set<ReadBlock>();

  /** Each text style's width factor and slant, by its name in capitals. */
  readonly #styles = new Map<string, { readonly widthFactor: number; readonly oblique: number }>();
  /** Each dimension style's arrowhead and text height at its overall scale, by its name in capitals. */
  readonly #dimensions = new Map<
    string,
    { readonly arrow: number; readonly text: number; readonly annotative: boolean }
  >();

  /** The widest and most slanted of the text styles, for a text whose style the read names late. */
  readonly #widest: { widthFactor: number; oblique: number } = { widthFactor: 1, oblique: 0 };

  constructor(read: DrawingRead) {
    // Names are compared as the leading CAD app compares a table's, and of two records of one
    // name the wider and the larger is taken.
    for (const t of read.textStyles) {
      const key = layerKey(t.name);
      const held = this.#styles.get(key);
      const widthFactor = Math.max(Math.abs(t.widthFactor ?? 1), held?.widthFactor ?? 0);
      const oblique = Math.max(Math.abs(t.oblique ?? 0), held?.oblique ?? 0);
      this.#styles.set(key, { widthFactor, oblique });
      this.#widest.widthFactor = Math.max(this.#widest.widthFactor, widthFactor);
      this.#widest.oblique = Math.max(this.#widest.oblique, oblique);
    }
    for (const d of read.dimensionStyles) {
      const key = layerKey(d.name);
      const scale = Math.abs(d.scale ?? 1) || 1;
      const held = this.#dimensions.get(key);
      this.#dimensions.set(key, {
        arrow: Math.max(Math.abs(d.arrowSize ?? 0.18) * scale, held?.arrow ?? 0),
        text: Math.max(Math.abs(d.textHeight ?? 0.18) * scale, held?.text ?? 0),
        annotative: d.annotative || held?.annotative === true,
      });
    }
    for (const block of read.blocks) {
      if (block.handle !== undefined && !this.#byHandle.has(block.handle.toUpperCase()))
        this.#byHandle.set(block.handle.toUpperCase(), block);
      // A name two blocks hold names neither.
      const key = layerKey(block.name);
      this.#byName.set(key, this.#byName.has(key) ? null : block);
    }
  }

  #block(name: string | undefined, handle: string | undefined): ReadBlock | undefined {
    if (handle !== undefined) return this.#byHandle.get(handle.toUpperCase());
    return name === undefined ? undefined : (this.#byName.get(layerKey(name)) ?? undefined);
  }

  /** A block's box in its own coordinates, or none when it is past a limit or in a cycle. */
  #ofBlock(block: ReadBlock, depth: number): Box | undefined {
    if (this.#boxes.has(block)) return this.#boxes.get(block);
    // A block that holds anything it does not keep but invisible entities and attribute
    // definitions, which an insert does not draw, may draw past what it keeps.
    if (depth >= DEPTH || this.#open.has(block) || !Object.keys(block.other).every(undrawn))
      return undefined;
    this.#open.add(block);
    const b = new Bounds();
    for (const e of block.entities) {
      b.box(this.of(e, depth + 1));
      if (b.unknown) break;
    }
    for (const d of block.attributeDefinitions)
      b.point(d.at, this.#reach(d, d.default?.length ?? 0));
    this.#open.delete(block);
    // A block that draws nothing has no box, and an insert of it is kept by its point.
    const box = b.unknown ? undefined : (b.done() ?? [0, 0, 0, 0]);
    this.#boxes.set(block, box);
    return box;
  }

  /** A box of a block's picture in model space, as a dimension or a table places it, unturned. */
  #picture(name: string | undefined, handle: string | undefined, depth: number, b: Bounds): void {
    if (name === undefined && handle === undefined) return;
    const block = this.#block(name, handle);
    b.box(block === undefined ? undefined : this.#ofBlock(block, depth));
  }

  /** How far a text or an attribute reaches from its points, at its style's width and slant. */
  #reach(
    t: { height: number; widthFactor?: number; oblique?: number; style: string | undefined },
    length: number,
  ) {
    const style = t.style === undefined ? this.#widest : this.#styles.get(layerKey(t.style));
    return textReach(
      t.height,
      length,
      Math.max(Math.abs(t.widthFactor ?? 1), Math.abs(style?.widthFactor ?? 1)),
      Math.max(Math.abs(t.oblique ?? 0), Math.abs(style?.oblique ?? 0)),
    );
  }

  /** A dimension's arrowheads past its points, its text about where it sits, and its picture. */
  #dimension(
    e: { style: string; textAt: Point; text?: string; block?: string; blockHandle?: string },
    depth: number,
    b: Bounds,
  ): void {
    const style = this.#dimensions.get(layerKey(e.style)) ?? {
      arrow: 0.18,
      text: 0.18,
      annotative: false,
    };
    // An annotative style draws at the annotation's scale, which the read does not hold, so only
    // the picture tells how far the dimension draws.
    if (style.annotative && e.block === undefined && e.blockHandle === undefined) b.box(undefined);
    b.pad(style.arrow);
    // The measurement and its words, which the read gives only in part.
    b.point(e.textAt, textReach(style.text, (e.text?.length ?? 0) + 16));
    this.#picture(e.block, e.blockHandle, depth, b);
  }

  /** A box never smaller than what an entity draws, or none where the read cannot tell. */
  of(e: ReadEntity, depth: number): Box | undefined {
    const b = new Bounds();
    switch (e.kind) {
      case "line":
        b.points([e.from, e.to]);
        break;
      case "polyline": {
        let pad = (e.width ?? 0) / 2;
        for (const [s, t] of e.widths ?? []) pad = Math.max(pad, Math.abs(s) / 2, Math.abs(t) / 2);
        b.sides(e.points, e.bulges, e.closed, pad);
        break;
      }
      case "circle":
      case "arc":
        b.point(e.center, e.radius);
        break;
      case "point":
        b.point(e.at);
        break;
      case "ellipse":
        b.point(e.center, Math.hypot(e.majorAxis[0], e.majorAxis[1]));
        break;
      case "spline":
        // A curve through its fit points may swing past them, and only control points hold it.
        if (e.controlPoints.length === 0) return undefined;
        b.points(e.controlPoints);
        b.points(e.fitPoints);
        break;
      case "text": {
        const reach = this.#reach(e, e.value.length);
        b.points([e.at, e.stored], reach);
        b.point(e.alignAt, reach);
        break;
      }
      case "mtext": {
        // Every line of it laid out at the widest it can wrap to, one under another.
        const reach =
          Math.abs(e.width) +
          this.#reach({ height: e.height, style: e.style }, e.value.length) *
            Math.max(1, Math.abs(e.lineSpacing)) *
            codeGrowth(e.value, e.height);
        b.point(e.at, reach + (e.columns ? columnsReach(e, e.columns) : 0));
        break;
      }
      case "insert": {
        const block = this.#block(e.block, e.blockHandle);
        const box = block === undefined ? undefined : this.#ofBlock(block, depth);
        if (box === undefined) return undefined;
        b.points(placed(box, block!.base, e.at, e.scale, e.rotation));
        for (const a of e.attributes ?? [])
          b.points([a.at, a.stored], this.#reach(a, a.value.length));
        break;
      }
      case "dimension":
        b.points([e.from, e.to, e.line, e.textAt]);
        this.#dimension(e, depth, b);
        break;
      case "radial-dimension":
        b.points([e.center, e.point, e.textAt]);
        b.point(e.start);
        b.point(e.jog);
        this.#dimension(e, depth, b);
        break;
      case "angular-dimension":
        b.points([e.at, e.textAt]);
        b.point(e.vertex);
        b.point(e.from);
        b.point(e.to);
        if (e.first) b.points(e.first);
        if (e.second) b.points(e.second);
        this.#dimension(e, depth, b);
        break;
      case "ordinate-dimension":
        b.points([e.origin, e.feature, e.leaderEnd, e.textAt]);
        this.#dimension(e, depth, b);
        break;
      case "arc-length-dimension":
        b.point(e.center, e.radius);
        b.points([e.at, e.textAt]);
        this.#dimension(e, depth, b);
        break;
      case "multileader": {
        // An arrowhead reaches its size past a shaft's point, and a landing its length. A DXF
        // names a multileader's text style once the file is read, after the filter, so both
        // readers take the widest of the file's for its note.
        const arrow = Math.abs(e.arrowSize) || 0;
        b.point(e.at, Math.abs(e.landing) + arrow);
        for (const s of e.shafts) b.points(s, arrow);
        for (const r of e.roots) {
          b.point(r.at, Math.abs(r.landing) + arrow);
          for (const s of r.shafts) b.points(s, arrow);
        }
        b.point(
          e.textAt,
          Math.abs(e.width) +
            this.#reach({ height: e.textHeight, style: undefined }, e.text.length) *
              codeGrowth(e.text, e.textHeight),
        );
        if (e.block) {
          const block = this.#block(e.block.name, undefined);
          const box = block === undefined ? undefined : this.#ofBlock(block, depth);
          if (box === undefined) return undefined;
          b.points(
            placed(box, block!.base, e.block.at, [e.block.scale, e.block.scale], e.block.rotation),
          );
        }
        break;
      }
      case "leader": {
        // Its arrowhead and its hook line, at its dimension style's arrow size, or at the
        // annotation's scale for an annotative style, which the read does not hold.
        const style = this.#dimensions.get(layerKey(e.style));
        if (style?.annotative) return undefined;
        b.points(e.points, 2 * (style?.arrow ?? 0.18));
        break;
      }
      case "solid":
      case "wipeout":
        b.points(e.points);
        break;
      case "image": {
        const [w, h] = e.pixels;
        const u: Point = [e.u[0] * w, e.u[1] * w];
        const v: Point = [e.v[0] * h, e.v[1] * h];
        b.points([
          e.at,
          [e.at[0] + u[0], e.at[1] + u[1]],
          [e.at[0] + v[0], e.at[1] + v[1]],
          [e.at[0] + u[0] + v[0], e.at[1] + u[1] + v[1]],
        ]);
        break;
      }
      case "hatch":
        for (const loop of e.loops) b.sides(loop.points, loop.bulges, true, 0);
        break;
      case "table": {
        let [width, height] = [0, 0];
        for (const c of e.columns) width += Math.abs(c);
        for (const r of e.rows) height += Math.abs(r);
        b.point(e.at, Math.hypot(width, height));
        this.#picture(e.block, e.blockHandle, depth, b);
        break;
      }
      case "3dsolid":
      case "region":
      case "body":
        for (const edge of e.edges) {
          if (edge.kind === "line") b.points([edge.from, edge.to]);
          else if (edge.kind === "ellipse") b.point(edge.center, Math.hypot(...edge.majorAxis));
          else b.points(edge.controlPoints);
        }
        if (e.edges.length === 0) return undefined;
        break;
      // An underlay's page has a size the read does not hold.
      case "underlay":
        return undefined;
    }
    return b.done();
  }
}

/**
 * How far paragraph text's further columns reach from its start: as many columns as it states, or
 * one for each character where it states none, each its width and gutter apart, and its tallest.
 */
function columnsReach(e: ReadMtext, columns: ParagraphColumns): number {
  const count = columns.heights?.length ?? columns.count ?? Math.max(1, e.value.length);
  let tallest = columns.heights ? 0 : Math.abs(columns.height);
  for (const h of columns.heights ?? []) tallest = Math.max(tallest, Math.abs(h));
  return count * (Math.abs(e.width) + Math.abs(paragraphGutter(columns, e.height))) + tallest;
}

/** The corners of a block's box placed by an insert: from its base, scaled, turned, then moved. */
function placed(
  box: Box,
  base: Point,
  at: Point,
  scale: readonly [number, number],
  rotation: number,
): Point[] {
  const turn = (rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
  const corners: Point[] = [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[2], box[3]],
    [box[0], box[3]],
  ];
  return corners.map(([x, y]) => {
    const [sx, sy] = [(x - base[0]) * scale[0], (y - base[1]) * scale[1]];
    return [at[0] + sx * cos - sy * sin, at[1] + sx * sin + sy * cos];
  });
}
