// What a sheet of a read file shows, and what is near a point. Both are answered from the read
// and the drawing its picture is made from: the entities of a layout's paper, and for each
// viewport that is on, the entities of model space it shows, followed through inserts and xrefs
// with the core's bounded `eachDrawn`, with each layer's state as the sheet holds it.
import type { Block, Entity, Insert, Point, Rgb } from "../drawing.ts";
import {
  eachDrawn,
  insertMatrix,
  mapPoint,
  referencedByKey,
  type LayerRef,
  type Matrix,
  type Placement,
  type Referenced,
} from "../blocks.ts";
import { boxer, type Boxer } from "../extents.ts";
import { grid, type Box } from "../inspect.ts";
import { isNumber, isString } from "../guards.ts";
import { layerKeys, layoutNameKey } from "../layers.ts";
import type { DrawingRead, ReadEntity, ReadLayer, ReadViewport } from "./model.ts";
import { viewportWindow } from "./part.ts";
import { pictureDrawing, type PictureDrawing, type XrefReads } from "./picture.ts";

/** One entity a sheet or a space shows. */
export interface ShownEntity {
  /** The handle of the entity in the file that holds it, when the file gives one. */
  readonly handle?: string;
  /** The handles of the inserts it was reached through, the outermost first. */
  readonly through: readonly string[];
  /** The xrefs it was reached through, by name, the outermost first. Empty for the file's own. */
  readonly xrefs: readonly string[];
  /** Its kind, as a `Drawing`'s entity names it, such as `line` or `text`. */
  readonly kind: string;
  /** Its layer as the sheet names it: `XREF|LAYER` for a layer of an xref's file. */
  readonly layer: string;
  /** The color it draws in, after ByLayer and ByBlock: an index of the 255, or a true color. */
  readonly color: number | Rgb;
  /** The viewport it shows through, by its place in the layout's `viewports`, or none. */
  readonly viewport?: number;
  /** Its box: on the paper for a sheet, in the space's own coordinates for a space. */
  readonly box: Box;
  /** For a text, a paragraph text or an attribute, what it says, with its codes. */
  readonly text?: string;
  /** For an attribute, its tag. */
  readonly tag?: string;
}

/** What a sheet or a space shows. */
export interface Shown {
  /**
   * In the order each space draws them: the paper's first, then each viewport's in the order of
   * the layout's `viewports`.
   */
  readonly entities: readonly ShownEntity[];
  /** True when the answer stopped at a limit, so it holds less than is shown. */
  readonly capped: boolean;
}

/** The limits of a question. */
export interface QuestionLimits {
  /** The most entities an answer holds. */
  readonly entities?: number;
  /** The most steps of the walk through inserts and of the boxes, as `eachDrawn` spends them. */
  readonly work?: number;
}

export const QUESTION_LIMITS: Readonly<Required<QuestionLimits>> = {
  entities: 100_000,
  work: 4_000_000,
};

/** What a question reads beside the read. */
export interface QuestionOptions {
  /** The read each xref stands for, by the xref's name, as the picture of a read file takes them. */
  readonly xrefs?: XrefReads;
  readonly limits?: QuestionLimits;
}

/** A clip of an insert, in the coordinates of the block it places. */
interface Clip {
  readonly outline: readonly Point[];
  readonly inverted?: boolean;
}

/** A viewport as a question walks it: its map from model space to the paper, and its outline. */
interface View {
  readonly index: number;
  readonly toPaper: Matrix;
  /** Its outline in model space: its rectangle, or the outline that clips it. */
  readonly outline: readonly Point[];
  readonly box: Box;
  /** The keys of the layers frozen in it alone, as the sheet names them. */
  readonly frozen: ReadonlySet<string>;
}

const TURN = Math.PI / 180;

/** The most areas `xrefAreas` gives, which a read by layout takes. */
const MOST_AREAS = 1024;

/** The most xrefs inside xrefs whose clips are read. */
const XREF_DEPTH = 16;

function invert(m: Matrix): Matrix | undefined {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;

  if (!Number.isFinite(det) || det === 0) return undefined;

  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

function boxOfPoints(points: readonly Point[]): Box {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];

  for (const [x, y] of points) {
    if (x < minX) minX = x;

    if (y < minY) minY = y;

    if (x > maxX) maxX = x;

    if (y > maxY) maxY = y;
  }

  return [minX, minY, maxX, maxY];
}

function mapBox(m: Matrix | undefined, box: Box): Box {
  if (m === undefined) return box;
  const [x0, y0, x1, y1] = box;

  return boxOfPoints([
    mapPoint(m, [x0, y0]),
    mapPoint(m, [x1, y0]),
    mapPoint(m, [x1, y1]),
    mapPoint(m, [x0, y1]),
  ]);
}

const boxesMeet = (a: Box, b: Box): boolean =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** True when a point lies inside a polygon. */
function inside(polygon: readonly Point[], [x, y]: Point): boolean {
  let within = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;

    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) within = !within;
  }

  return within;
}

/** True when two segments cross or touch. */
function cross(p: Point, q: Point, r: Point, s: Point): boolean {
  const side = (a: Point, b: Point, c: Point) =>
    Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));

  const [d1, d2, d3, d4] = [side(r, s, p), side(r, s, q), side(p, q, r), side(p, q, s)];

  if (d1 !== d2 && d3 !== d4) return true;

  const on = (a: Point, b: Point, c: Point) =>
    Math.min(a[0], b[0]) <= c[0] &&
    c[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= c[1] &&
    c[1] <= Math.max(a[1], b[1]);

  return (
    (d1 === 0 && on(r, s, p)) ||
    (d2 === 0 && on(r, s, q)) ||
    (d3 === 0 && on(p, q, r)) ||
    (d4 === 0 && on(p, q, s))
  );
}

const cornersOf = ([x0, y0, x1, y1]: Box): Point[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** True when a box and a polygon share a point. */
function polygonMeetsBox(polygon: readonly Point[], box: Box): boolean {
  if (polygon.length < 3 || !boxesMeet(boxOfPoints(polygon), box)) return false;
  const [x0, y0, x1, y1] = box;

  if (inside(polygon, [x0, y0])) return true;

  for (const [x, y] of polygon) if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return true;
  const corners = cornersOf(box);

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    for (let k = 0; k < 4; k++) {
      if (cross(polygon[j]!, polygon[i]!, corners[k]!, corners[(k + 1) % 4]!)) return true;
    }
  }

  return false;
}

/** True when a box lies wholly inside a polygon, apart from its outline. */
function polygonHoldsBox(polygon: readonly Point[], box: Box): boolean {
  if (polygon.length < 3 || !cornersOf(box).every((corner) => inside(polygon, corner))) {
    return false;
  }

  const corners = cornersOf(box);

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    for (let k = 0; k < 4; k++) {
      if (cross(polygon[j]!, polygon[i]!, corners[k]!, corners[(k + 1) % 4]!)) return false;
    }
  }

  return true;
}

/**
 * The points of a line, or of a polyline of straight sides that are not wide, in the space they
 * are drawn in, with whether the last joins the first: its exact path, where a box would hold
 * more than it draws. Undefined for any other entity.
 */
function pathOf(
  entity: Entity,
  matrix: Matrix | undefined,
  spend: (cost: number) => boolean,
): { points: Point[]; closed: boolean } | undefined {
  const place = (p: Point): Point => (matrix ? mapPoint(matrix, p) : p);

  if (entity.kind === "line") {
    return { points: [place(entity.from), place(entity.to)], closed: false };
  }

  if (
    entity.kind !== "polyline" ||
    entity.bulges?.some((b) => b !== 0) ||
    (entity.width ?? 0) !== 0 ||
    entity.widths?.some(([a, b]) => a !== 0 || b !== 0)
  ) {
    return undefined;
  }

  // Its points are paid for before they are placed.
  if (!spend(entity.points.length)) return undefined;

  return { points: entity.points.map(place), closed: entity.closed };
}

/** True when a path and a polygon share a point. */
function polygonMeetsPath(
  polygon: readonly Point[],
  path: { readonly points: Point[]; readonly closed: boolean },
): boolean {
  const { points, closed } = path;

  if (polygon.length < 3 || points.length === 0) return false;

  // A path is its stroke: a closed one that goes round the polygon meets nothing of it.
  if (points.some((p) => inside(polygon, p))) return true;
  const sides = closed ? points.length : points.length - 1;

  for (let k = 0; k < sides; k++) {
    const [a, b] = [points[k]!, points[(k + 1) % points.length]!];

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      if (cross(polygon[j]!, polygon[i]!, a, b)) return true;
    }
  }

  return false;
}

/**
 * The map from model space to the paper of a viewport, which shows `viewCenter` at `center`,
 * turned by its twist, at `ratio` paper units to the model's one.
 */
export function viewportToPaper(viewport: ReadViewport): Matrix {
  const turn = viewport.twist * TURN;
  const [cos, sin] = [Math.cos(turn) * viewport.ratio, Math.sin(turn) * viewport.ratio];
  const [cx, cy] = viewport.viewCenter;
  const [px, py] = viewport.center;

  return [cos, sin, -sin, cos, px - cos * cx + sin * cy, py - sin * cx - cos * cy];
}

/** The sides an arc of a clip's outline is cut into, for each quarter turn. */
const ARC_SIDES = 8;

/**
 * The outline of a closed polyline or a circle, as a polygon, each arc cut into sides of a
 * sixteenth of a turn at most, or undefined for any other entity.
 */
function outlineOf(entity: ReadEntity): Point[] | undefined {
  if (entity.kind === "circle") {
    const n = 4 * ARC_SIDES;
    const [[cx, cy], r] = [entity.center, entity.radius];

    if (!(r > 0)) return undefined;

    return Array.from({ length: n }, (_, i): Point => {
      const t = (2 * Math.PI * i) / n;

      return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
    });
  }

  if (entity.kind !== "polyline" || !entity.closed || entity.points.length < 2) return undefined;
  const { points, bulges } = entity;
  const out: Point[] = [];

  for (let i = 0; i < points.length; i++) {
    const [a, b] = [points[i]!, points[(i + 1) % points.length]!];
    out.push(a);
    const bulge = bulges?.[i] ?? 0;
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const chord = Math.hypot(dx, dy);

    if (bulge === 0 || !Number.isFinite(bulge) || chord === 0) continue;
    const turn = 4 * Math.atan(bulge);
    const sides = Math.ceil((Math.abs(turn) / (Math.PI / 2)) * ARC_SIDES);
    const radius = chord / (2 * Math.sin(turn / 2));
    const toCenter = radius * Math.cos(turn / 2);

    const [cx, cy] = [
      (a[0] + b[0]) / 2 - (dy / chord) * toCenter,
      (a[1] + b[1]) / 2 + (dx / chord) * toCenter,
    ];

    const start = Math.atan2(a[1] - cy, a[0] - cx);

    for (let k = 1; k < sides; k++) {
      const t = start + (turn * k) / sides;
      out.push([cx + Math.abs(radius) * Math.cos(t), cy + Math.abs(radius) * Math.sin(t)]);
    }
  }

  return out.length >= 3 ? out : undefined;
}

function viewOf(
  viewport: ReadViewport,
  index: number,
  key: (name: string) => string,
  clipOf: (handle: string) => ReadEntity | undefined,
  evenOff = false,
): View | undefined {
  if ((!viewport.on && !evenOff) || viewport.turnedView || !(viewport.ratio > 0)) return undefined;
  const toPaper = viewportToPaper(viewport);
  const fromPaper = invert(toPaper);
  const window = viewportWindow(viewport);

  if (!fromPaper || !window) return undefined;
  // The outline that clips it is on the paper; its rectangle is the window a read by layout keeps.
  const by = viewport.clipBy === undefined ? undefined : clipOf(viewport.clipBy);
  const clip = by === undefined ? undefined : outlineOf(by);
  const outline = clip ? clip.map((p) => mapPoint(fromPaper, p)) : [...window];

  return {
    index,
    toPaper,
    outline,
    box: boxOfPoints(outline),
    frozen: new Set(viewport.frozenLayers.map(key)),
  };
}

interface LayerState {
  readonly hidden: boolean;
  readonly frozen: boolean;
  readonly color: number | Rgb;
}

const rgbOf = (value: number): Rgb => [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];

function stateOfRead(layer: ReadLayer): LayerState {
  const frozen = layer.frozen || !layer.plot;

  return {
    hidden: frozen || !layer.on,
    frozen,
    color: layer.trueColor !== undefined ? rgbOf(layer.trueColor) : Math.abs(layer.color ?? 7),
  };
}

/**
 * The state of each layer as the sheet holds it: its own, and for a layer of an xref the host's
 * record of it, `XREF|LAYER`, where the host has one, else the referenced drawing's.
 */
function layerStates(read: DrawingRead, key: (name: string) => string) {
  const own = new Map<string, LayerState>();

  for (const layer of read.layers) own.set(key(layer.name), stateOfRead(layer));
  const nameOf = (ref: LayerRef): string => (ref.of ? `${ref.of.name}|${ref.name}` : ref.name);
  const theirs = new Map<Referenced, Map<string, LayerState>>();

  const stateOf = (ref: LayerRef): LayerState | undefined => {
    const host = own.get(key(nameOf(ref)));

    if (host || !ref.of) return host;
    let layers = theirs.get(ref.of);

    if (!layers) {
      layers = new Map();

      for (const layer of ref.of.drawing.layers) {
        const frozen = layer.frozen === true || layer.plot === false;
        layers.set(key(layer.name), {
          hidden: frozen || layer.off === true,
          frozen,
          color: isNumber(layer.color) || Array.isArray(layer.color) ? layer.color : 7,
        });
      }

      theirs.set(ref.of, layers);
    }

    return layers.get(key(ref.name));
  };

  return { nameOf, stateOf };
}

/** The color an entity draws in, from its own, its layer's, or its insert's for ByBlock. */
function colorOf(
  entity: Entity,
  placement: Placement,
  layerColor: (ref: LayerRef) => number | Rgb,
): number | Rgb {
  const own = "color" in entity ? entity.color : undefined;

  if (isNumber(own) && own >= 1 && own <= 255) return own;

  // What is neither an index nor a name is a true color.
  if (own !== undefined && !isNumber(own) && !isString(own)) return own;

  if (own === "ByBlock") {
    const block = placement.byBlock;

    if (block === undefined) return 7;

    return "color" in block ? block.color : layerColor(block.layer);
  }

  return layerColor(placement.layer);
}

function textOf(entity: Entity): string | undefined {
  if (entity.kind === "text" || entity.kind === "paragraph") return entity.value;

  return undefined;
}

/** What a question keeps for one read and the reads given for its xrefs. */
interface Prepared {
  readonly read: DrawingRead;
  readonly picture: PictureDrawing;
  readonly referenced: ReadonlyMap<string, Referenced>;
  readonly blocks: ReadonlyMap<string, Block>;
  readonly clips: ReadonlyMap<string, Clip>;
  readonly key: (name: string) => string;
  /** The box of each entity at the top of model space, made when first asked for. */
  model?: { readonly boxes: Box[]; readonly index: number[]; readonly capped: boolean };
  /** The grid of what each space or sheet shows, by its name. */
  readonly near: Map<
    string,
    { readonly shown: Shown; readonly limits: string; readonly find: Finder }
  >;
}

type Finder = (box: Box, found: (index: number) => void) => void;

/**
 * The clip of each insert that has one, in the read and the reads of its xrefs, keyed by the file
 * it is in, as `fileKey` names it, and its handle: a handle is one file's own.
 */
function clipsOf(
  read: DrawingRead,
  xrefs: XrefReads | undefined,
  key: (name: string) => string,
  file = "",
  into = new Map<string, Clip>(),
  depth = 0,
): Map<string, Clip> {
  const each = (entities: readonly ReadEntity[] | undefined): void => {
    for (const e of entities ?? []) {
      if (e.kind === "insert" && e.clip !== undefined && e.handle !== undefined) {
        into.set(`${file}\u0000${e.handle}`, e.clip);
      }
    }
  };

  each(read.model.entities);

  for (const layout of read.layouts) each(layout.entities);

  for (const block of read.blocks) each(block.entities);

  if (depth >= XREF_DEPTH) return into;

  for (const [name, given] of Object.entries(xrefs ?? {})) {
    // SAFETY: an xref given with no `read` of its own is given as its read alone.
    const { read: inner, xrefs: below } =
      "read" in given && "format" in given.read
        ? given
        : { read: given as DrawingRead, xrefs: undefined };

    clipsOf(inner, below, key, `${file}/${key(name)}`, into, depth + 1);
  }

  return into;
}

/** What is kept for each read, and for the reads given for its xrefs. */
const prepared = new WeakMap<DrawingRead, WeakMap<object, Prepared>>();
const NO_XREFS = {};

function prepare(read: DrawingRead, xrefs: XrefReads | undefined): Prepared {
  let byXrefs = prepared.get(read);

  if (!byXrefs) prepared.set(read, (byXrefs = new WeakMap()));
  const found = byXrefs.get(xrefs ?? NO_XREFS);

  if (found) return found;
  const picture = pictureDrawing(read, xrefs === undefined ? {} : { xrefs });
  const key = layerKeys();

  const made: Prepared = {
    read,
    picture,
    referenced: referencedByKey(picture.drawing, picture.xrefs),
    blocks: new Map((picture.drawing.blocks ?? []).map((b) => [key(b.name), b])),
    clips: clipsOf(read, xrefs, key),
    key,
    near: new Map(),
  };

  byXrefs.set(xrefs ?? NO_XREFS, made);

  return made;
}

function boxerOf(p: Prepared): Boxer {
  const { drawing } = p.picture;

  return boxer(
    drawing.textStyles ?? [],
    drawing.blocks ?? [],
    () => false,
    () => false,
    p.referenced,
    drawing.dimensionStyles ?? [],
    drawing.leaderStyles ?? [],
    undefined,
    undefined,
    drawing.tableStyles ?? [],
  );
}

/** The files of the inserts of a placement's chain, and the xrefs the chain came through. */
interface ChainFiles {
  files: string[];
  xrefs: string[];
}

/**
 * For each insert of a placement's chain, the file it is in, as `clipsOf` keys it, and the xrefs
 * the chain came through, by name.
 */
function chainFiles(chain: readonly { readonly insert: Insert }[], p: Prepared): ChainFiles {
  const files: string[] = [];
  const xrefs: string[] = [];
  let [file, blocks, referenced] = ["", p.blocks, p.referenced];

  for (const { insert } of chain) {
    files.push(file);
    const name = p.key(insert.block);

    if (blocks.has(name)) continue;
    const found = referenced.get(name);

    if (!found) continue;
    xrefs.push(found.name);
    [file, blocks, referenced] = [`${file}/${p.key(found.name)}`, found.blocks, found.xrefs];
  }

  return { files, xrefs };
}

/**
 * Walks the entities of one space, and keeps what each shows: through a viewport onto the paper,
 * or in the space's own coordinates. Each entity is walked through its inserts, and what lies on
 * a layer that is off, frozen, frozen in the viewport or does not plot is left out, and so is
 * what lies outside the viewport's outline or an insert's clip.
 */
function walker(p: Prepared, limits: QuestionLimits | undefined) {
  const { entities: most, work } = { ...QUESTION_LIMITS, ...limits };
  const { key } = p;
  const states = layerStates(p.read, key);
  const layerColor = (ref: LayerRef): number | Rgb => states.stateOf(ref)?.color ?? 7;
  const boxOf = boxerOf(p);
  const out: ShownEntity[] = [];
  let spent = 0;
  let capped = false;

  const spend = (cost: number): boolean => {
    spent += cost;

    if (spent > work) capped = true;

    return !capped;
  };

  // `eachDrawn` gives every placement inside one block the same chain, so what the chain says is
  // worked out once for it: the xrefs, and each insert's clip in the coordinates of the space.
  const chains = new WeakMap<object, { xrefs: string[]; clips: (Clip | undefined)[] }>();
  const NO_CHAIN = { xrefs: [], clips: [] };

  const alongChain = (chain: readonly { readonly insert: Insert; readonly matrix: Matrix }[]) => {
    if (chain.length === 0) return NO_CHAIN;
    let found = chains.get(chain);

    if (found) return found;
    const { files, xrefs } = chainFiles(chain, p);

    const clips = chain.map(({ insert, matrix }, i): Clip | undefined => {
      const handle = p.picture.handles.get(insert);
      const clip = handle === undefined ? undefined : p.clips.get(`${files[i]}\u0000${handle}`);

      if (!clip || !spend(clip.outline.length)) return undefined;

      return { ...clip, outline: clip.outline.map((point) => mapPoint(matrix, point)) };
    });

    found = { xrefs, clips };
    chains.set(chain, found);

    return found;
  };

  const walk = (entity: Entity, view: View | undefined): void => {
    const frozenHere = (ref: LayerRef): boolean =>
      view !== undefined && view.frozen.has(key(states.nameOf(ref)));

    const isFrozen = (ref: LayerRef): boolean =>
      states.stateOf(ref)?.frozen === true || frozenHere(ref);

    eachDrawn(
      entity,
      p.blocks,
      isFrozen,
      (piece, placement) => {
        if (capped) return;

        if (states.stateOf(placement.layer)?.hidden === true || frozenHere(placement.layer)) return;

        if (!spend(1)) return;
        const own = boxOf([piece]);

        if (boxOf.capped !== undefined) capped = true;

        if (own === undefined || capped) return;
        const box = mapBox(placement.matrix, own);
        // A line or a straight polyline is held to an outline by its path, which a turned view or
        // clip would otherwise meet by its box alone.
        const path = pathOf(piece, placement.matrix, spend);

        if (capped) return;

        const meets = (outline: readonly Point[]): boolean =>
          path ? polygonMeetsPath(outline, path) : polygonMeetsBox(outline, box);

        // A test against an outline pays for the outline's points and the path's.
        const cost = (outline: readonly Point[]) =>
          outline.length * (path ? path.points.length : 1);

        if (view && (!spend(cost(view.outline)) || !meets(view.outline))) return;
        const chain = placement.inserts ?? [];
        const along = alongChain(chain);

        // A clip left unmapped at the limit would show what it hides.
        if (capped) return;

        for (const clip of along.clips) {
          if (clip === undefined) continue;

          if (!spend(cost(clip.outline))) return;

          if (clip.inverted ? polygonHoldsBox(clip.outline, box) : !meets(clip.outline)) return;
        }

        if (out.length >= most) {
          capped = true;

          return;
        }

        const handle = p.picture.handles.get(piece);
        const through: string[] = [];

        for (const { insert } of chain) {
          const h = p.picture.handles.get(insert);

          if (h !== undefined) through.push(h);
        }

        const text = textOf(piece);
        out.push({
          ...(handle !== undefined && { handle }),
          through,
          xrefs: along.xrefs,
          kind: piece.kind,
          layer: states.nameOf(placement.layer),
          color: colorOf(piece, placement, layerColor),
          ...(view && { viewport: view.index }),
          box: view
            ? path
              ? boxOfPoints(path.points.map((p) => mapPoint(view.toPaper, p)))
              : mapBox(view.toPaper, box)
            : box,
          ...(text !== undefined && { text }),
          ...(placement.attribute !== undefined && { tag: placement.attribute }),
        });
      },
      p.referenced,
      spend,
      key,
      undefined,
      undefined,
      undefined,
      true,
    );
  };

  return {
    walk,
    spend,
    done: (): Shown => ({ entities: out, capped }),
    get capped() {
      return capped;
    },
  };
}

function modelBoxes(p: Prepared): { boxes: Box[]; index: number[]; capped: boolean } {
  if (p.model) return p.model;
  const boxOf = boxerOf(p);
  const boxes: Box[] = [];
  const index: number[] = [];
  p.picture.drawing.entities.forEach((entity, i) => {
    const box = boxOf([entity]);

    if (box) {
      boxes.push(box);
      index.push(i);
    }
  });

  // Past the boxer's limit a box holds less than it should, so the answer says it stopped.
  return (p.model = { boxes, index, capped: boxOf.capped !== undefined });
}

function sheet(p: Prepared, layout: string, limits: QuestionLimits | undefined): Shown | undefined {
  const wanted = layoutNameKey(layout);
  const at = p.read.layouts.findIndex((l) => layoutNameKey(l.name) === wanted);

  if (at < 0) return undefined;
  const drawn = p.picture.drawing.layouts?.find((l) => layoutNameKey(l.name) === wanted);
  const w = walker(p, limits);

  for (const entity of drawn?.entities ?? []) {
    w.walk(entity, undefined);

    if (w.capped) return w.done();
  }

  const model = p.picture.drawing.entities;
  const { boxes, index, capped } = modelBoxes(p);

  if (capped) return { ...w.done(), capped: true };
  const find = grid(boxes, w.spend);
  const readLayout = p.read.layouts[at]!;
  const byHandle = new Map<string, ReadEntity | undefined>();

  for (const viewport of readLayout.viewports) {
    if (viewport.clipBy !== undefined) byHandle.set(viewport.clipBy, undefined);
  }

  if (byHandle.size > 0) {
    for (const entity of readLayout.entities ?? []) {
      if (entity.handle !== undefined && byHandle.has(entity.handle))
        byHandle.set(entity.handle, entity);
    }
  }

  for (const [i, viewport] of readLayout.viewports.entries()) {
    const view = viewOf(viewport, i, p.key, (h) => byHandle.get(h));

    if (!view) continue;
    const found: number[] = [];
    find(view.box, (n) => found.push(n));
    found.sort((a, b) => a - b);

    for (const n of found) {
      w.walk(model[index[n]!]!, view);

      if (w.capped) return w.done();
    }
  }

  return w.done();
}

function space(
  p: Prepared,
  layout: string | undefined,
  limits: QuestionLimits | undefined,
): Shown | undefined {
  let entities: readonly Entity[] = p.picture.drawing.entities;

  if (layout !== undefined) {
    const wanted = layoutNameKey(layout);
    const drawn = p.picture.drawing.layouts?.find((l) => layoutNameKey(l.name) === wanted);

    if (!drawn) return undefined;
    entities = drawn.entities;
  }

  const w = walker(p, limits);

  for (const entity of entities) {
    w.walk(entity, undefined);

    if (w.capped) break;
  }

  return w.done();
}

/**
 * What a layout of a read shows: the entities of its paper, and for each viewport that is on,
 * those of model space it shows, through inserts and through xrefs whose reads are given. What
 * lies on a layer that is off, frozen, frozen in that viewport or that does not plot is left out,
 * with the state the host holds for an xref's layer as `XREF|LAYER`; so is what lies outside the
 * viewport's rectangle or the outline that clips it, and outside an insert's clip. Each entity's
 * box is on the paper. Undefined when the read has no layout of that name.
 */
export function sheetShows(
  read: DrawingRead,
  layout: string,
  options: QuestionOptions = {},
): Shown | undefined {
  return sheet(prepare(read, options.xrefs), layout, options.limits);
}

/**
 * What a space of a read draws: model space, or with `layout` that layout's paper, through
 * inserts and xrefs as `sheetShows` follows them, each entity's box in the space's coordinates.
 * Undefined when the read has no layout of that name.
 */
export function spaceShows(
  read: DrawingRead,
  options: QuestionOptions & { readonly layout?: string } = {},
): Shown | undefined {
  return space(prepare(read, options.xrefs), options.layout, options.limits);
}

/** What `nearPoint` gives: the entities, nearest first, each with its distance. */
export interface Near {
  readonly entities: readonly (ShownEntity & { readonly distance: number })[];
  /** True when what it searched stopped at a limit. */
  readonly capped: boolean;
}

/** The distance from a point to a box, 0 inside it. */
function distanceTo([x, y]: Point, [x0, y0, x1, y1]: Box): number {
  const dx = Math.max(x0 - x, 0, x - x1);
  const dy = Math.max(y0 - y, 0, y - y1);

  return Math.hypot(dx, dy);
}

/**
 * The entities whose box comes within `within` of a point, nearest first: of a sheet with
 * `sheet`, on its paper, as `sheetShows` gives them; of a layout's paper with `layout`, or of
 * model space, as `spaceShows` gives them. What the sheet or space shows is worked out and
 * filed in a grid once for each read and the reads given for its xrefs, so each question after
 * the first costs about what it finds. Of two at one distance the smaller box comes first. At
 * most `most` entities, 100 by default.
 */
export function nearPoint(
  read: DrawingRead,
  at: Point,
  options: QuestionOptions & {
    readonly within?: number;
    readonly sheet?: string;
    readonly layout?: string;
    readonly most?: number;
  } = {},
): Near | undefined {
  const p = prepare(read, options.xrefs);
  // What is filed depends on the limits it was worked out within.
  const { entities: most, work } = { ...QUESTION_LIMITS, ...options.limits };

  const name =
    options.sheet !== undefined
      ? `sheet:${layoutNameKey(options.sheet)}`
      : options.layout !== undefined
        ? `layout:${layoutNameKey(options.layout)}`
        : "model";

  const limits = `${most}:${work}`;
  let filed = p.near.get(name);

  // One grid is kept for each space or sheet, for the limits it was worked out within.
  if (!filed || filed.limits !== limits) {
    const shown =
      options.sheet !== undefined
        ? sheet(p, options.sheet, options.limits)
        : space(p, options.layout, options.limits);

    if (!shown) return undefined;

    const search = grid(
      shown.entities.map((e) => e.box),
      () => true,
    );

    filed = { shown, limits, find: (box, found) => search(box, found) };
    p.near.set(name, filed);
  }

  const within = Math.max(0, options.within ?? 0);
  const [x, y] = at;
  const found: (ShownEntity & { distance: number })[] = [];
  filed.find([x - within, y - within, x + within, y + within], (n) => {
    const entity = filed.shown.entities[n]!;
    const distance = distanceTo(at, entity.box);

    if (distance <= within) found.push({ ...entity, distance });
  });
  // Of two at one distance, as of two whose boxes hold the point, the smaller box comes first.
  const area = ([x0, y0, x1, y1]: Box) => (x1 - x0) * (y1 - y0);
  found.sort((a, b) => a.distance - b.distance || area(a.box) - area(b.box));

  return { entities: found.slice(0, Math.max(0, options.most ?? 100)), capped: filed.shown.capped };
}

/**
 * The parts of an xref's model space a layout of its host shows: for each viewport and each insert
 * of the xref at the top of the host's model space, the box, in the xref's own coordinates, of the
 * viewport's outline taken back through the insert, cut to the insert's clip, as two corners. A
 * viewport that is off counts too, since an edit may turn it on. A read of the xref needs only
 * what meets these, as a read by layout takes its areas. Past 1,024 of them it gives one box that holds
 * them all.
 */
export function xrefAreas(
  read: DrawingRead,
  layout: string,
  xref: string,
): (readonly [Point, Point])[] {
  const wanted = layoutNameKey(layout);
  const found = read.layouts.find((l) => layoutNameKey(l.name) === wanted);

  if (!found) return [];
  const key = layerKeys();
  const name = key(xref);
  const byHandle = new Map<string, ReadEntity>();

  for (const entity of found.entities ?? []) {
    if (entity.handle !== undefined) byHandle.set(entity.handle, entity);
  }

  const inserts = (read.model.entities ?? []).filter(
    (e): e is Extract<ReadEntity, { kind: "insert" }> =>
      e.kind === "insert" && key(e.block) === name,
  );

  const views = found.viewports.flatMap(
    (v, i) => viewOf(v, i, key, (h) => byHandle.get(h), true) ?? [],
  );

  const back = (insert: (typeof inserts)[number], outline: readonly Point[]): Box | undefined => {
    const m = invert(insertMatrix(insert));

    if (!m) return undefined;
    let out = boxOfPoints(outline.map((point) => mapPoint(m, point)));

    if (insert.clip && !insert.clip.inverted) {
      const clip = boxOfPoints(insert.clip.outline);

      if (!boxesMeet(out, clip)) return undefined;
      out = [
        Math.max(out[0], clip[0]),
        Math.max(out[1], clip[1]),
        Math.min(out[2], clip[2]),
        Math.min(out[3], clip[3]),
      ];
    }

    return out.every(Number.isFinite) ? out : undefined;
  };

  const corners = (b: Box): readonly [Point, Point] => [
    [b[0], b[1]],
    [b[2], b[3]],
  ];

  // Past `MOST_AREAS` pairs of a viewport and an insert, the boxes of all the viewports, joined,
  // are taken back through each insert, and then joined into one: more than is shown, never less.
  if (views.length * inserts.length <= MOST_AREAS) {
    const areas: (readonly [Point, Point])[] = [];

    for (const view of views) {
      for (const insert of inserts) {
        const box = back(insert, view.outline);

        if (box) areas.push(corners(box));
      }
    }

    return areas;
  }

  const all = boxOfPoints(views.flatMap((v) => cornersOf(v.box)));

  const boxes = inserts
    .map((insert) => back(insert, cornersOf(all)))
    .filter((box): box is Box => box !== undefined);

  return boxes.length === 0 ? [] : [corners(boxOfPoints(boxes.flatMap(cornersOf)))];
}
