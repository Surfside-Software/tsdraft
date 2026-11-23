// What a hatch, a wipeout and a text's mask draw, from the numbers as they are written: the one
// place the writers, `toSVG`, the extents and the readers take them from.
//
// The leading CAD app fills a hatch whose loops are all polylines and whose island style is normal
// by the parity of the loops around a point, whichever way each runs and in whatever order: so
// tsdraft writes every hatch that way. It holds a wipeout as a picture of one pixel, square, its
// lower-left corner the polygon's least X and Y and its side the larger of the polygon's width and
// height, clipped by the polygon in that pixel's axes, y down from its top. It plots a text's mask
// as the text's box grown by the mask's factor less one times its height, each side.
import type { Matrix } from "./blocks.ts";
import type {
  Drawing,
  Entity,
  GradientName,
  Hatch,
  HatchGradient,
  HatchLoop,
  HatchPattern,
  PatternLine,
  Point,
  Polyline,
  Rgb,
  TextMask,
} from "./drawing.ts";
import { placedLines, userLines, type PlacedLine } from "./patterns.ts";
import { fifteenDigits, written } from "./format.ts";
import { keyHandle } from "./handles.ts";
import { layerKey } from "./layers.ts";
import { placer, type ParagraphLayout, type ParagraphToMeasure } from "./paragraphs.ts";
import { direction, polylineSides, sideArc, type PolylineSide } from "./polylines.ts";
import {
  HATCH_LINES,
  PATTERN_ITEMS,
  PATTERN_REACH,
  patternDensityProblem,
  rgbOf,
} from "./rules.ts";
import { filled } from "./shape.ts";
import { isNumber, isRecord, isString } from "./guards.ts";

/**
 * A hatch's loops that can be drawn: each an object up to the list's first empty slot. One of
 * another shape, which `lint` refuses, draws nothing.
 */
export function drawnLoops(loops: readonly HatchLoop[] | undefined): HatchLoop[] {
  const out: HatchLoop[] = [];

  for (const loop of filled(loops)) {
    if (isLoop(loop)) out.push(loop);
  }

  return out;
}

/** A loop as the closed polyline it is drawn as, which `polylineSides` and the extents read. */
export function loopOutline(loop: HatchLoop, layer: string): Polyline {
  return loop.bulges === undefined
    ? { kind: "polyline", layer, points: loop.points, closed: true }
    : { kind: "polyline", layer, points: loop.points, closed: true, bulges: loop.bulges };
}

/** What a hatch's pattern draws, as a file holds it. */
export interface HatchLines {
  /** The pattern's name, or `_U` for user-defined lines, as the leading CAD app names them. */
  readonly name: string;
  /** Group 76: 2 a pattern of a file, 0 user-defined lines. */
  readonly type: 0 | 2;
  readonly angle: number;
  /** The pattern's scale, or the user-defined lines' spacing. */
  readonly scale: number;
  readonly crossed: boolean;
  readonly lines: readonly PlacedLine[];
}

/**
 * A drawing's patterns by the name a hatch gives, which is taken as a linetype's name is, whatever
 * the case of its letters: the first of a name where two share it, which `lint` refuses.
 */
export function patternFinder(
  patterns: readonly HatchPattern[] | undefined,
): (name: string) => HatchPattern | undefined {
  const byKey = new Map<string, HatchPattern>();

  for (const pattern of patterns ?? []) {
    const key = layerKey(pattern.name);

    if (!byKey.has(key)) byKey.set(key, pattern);
  }

  return (name) => byKey.get(layerKey(name));
}

/** A hatch's pattern as it is drawn, before its lines are placed. */
interface Chosen extends Omit<HatchLines, "lines"> {
  readonly origin: Point;
  /** The pattern of the drawing it names, or undefined for user-defined lines. */
  readonly pattern?: HatchPattern;
}

/**
 * A hatch's pattern from its numbers as written, a field the rules refuse taken as its default:
 * undefined for a solid hatch, and for a pattern `patternOf` does not find.
 */
function chosen(
  hatch: Pick<Hatch, "pattern">,
  patternOf: (name: string) => HatchPattern | undefined,
): Chosen | undefined {
  // A hatch made by hand may give a pattern of any shape.
  const given: unknown = hatch.pattern;

  if (!isRecord(given)) return undefined;

  const at = given.origin;
  const [x, y]: readonly unknown[] = Array.isArray(at) && at.length === 2 ? at : [0, 0];
  const origin: Point = [isFiniteNumber(x) ? written(x) : 0, isFiniteNumber(y) ? written(y) : 0];
  const angle = isFiniteNumber(given.angle) ? written(given.angle) : 0;

  if (isNumber(given.spacing)) {
    const spacing = isFiniteNumber(given.spacing) ? written(given.spacing) : 0;

    if (!(spacing > 0)) return undefined;
    const crossed = given.crossed === true;

    return { name: "_U", type: 0, angle, scale: spacing, crossed, origin };
  }

  if (!isString(given.name)) return undefined;
  const pattern = patternOf(given.name);

  if (pattern === undefined) return undefined;
  const scale = isFiniteNumber(given.scale) ? written(given.scale) : 1;

  if (!(scale > 0)) return undefined;

  return { name: pattern.name, type: 2, angle, scale, crossed: false, origin, pattern };
}

/**
 * The lines a hatch's pattern draws, placed in the drawing: undefined for a solid hatch, and for a
 * pattern `patternOf` does not find, which `lint` refuses.
 */
export function hatchLines(
  hatch: Pick<Hatch, "pattern">,
  patternOf: (name: string) => HatchPattern | undefined,
): HatchLines | undefined {
  const c = chosen(hatch, patternOf);

  if (c === undefined) return undefined;
  const { name, type, angle, scale, crossed, origin, pattern } = c;

  const lines = pattern
    ? placedLines(filled(pattern.lines), scale, angle, origin)
    : userLines(scale, angle, crossed, origin);

  return { name, type, angle, scale, crossed, lines };
}

/** The box of a hatch's loops: `[x0, y0, x1, y1]`. */
export type LoopsBox = readonly [number, number, number, number];

/**
 * A box that holds what a hatch's loops close around, its arcs too, from their numbers as given:
 * the box of each side grown by the height of its arc, `|bulge|` times half its chord, which holds
 * the arc whatever its sweep. Undefined for a loop with a point or a bulge that is not a finite
 * number, which `lint` refuses, and for no point at all.
 */
export function loopsBox(loops: readonly HatchLoop[] | undefined): LoopsBox | undefined {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];

  for (const loop of drawnLoops(loops)) {
    const points = filled(loop.points);
    const bulges: unknown = loop.bulges;
    const n = points.length;

    for (let i = 0; i < n; i++) {
      const p: unknown = points[i];
      const q: unknown = points[(i + 1) % n];

      if (!Array.isArray(p) || !Array.isArray(q)) return undefined;
      const px: unknown = p[0];
      const py: unknown = p[1];
      const qx: unknown = q[0];
      const qy: unknown = q[1];

      if (!isFiniteNumber(px) || !isFiniteNumber(py) || !isFiniteNumber(qx) || !isFiniteNumber(qy))
        return undefined;
      const b: unknown = Array.isArray(bulges) && i < bulges.length ? bulges[i] : 0;

      if (b !== undefined && !isFiniteNumber(b)) return undefined;
      const grow = b ? (Math.abs(b) * Math.hypot(qx - px, qy - py)) / 2 : 0;
      x0 = Math.min(x0, px - grow, qx - grow);
      y0 = Math.min(y0, py - grow, qy - grow);
      x1 = Math.max(x1, px + grow, qx + grow);
      y1 = Math.max(y1, py + grow, qy + grow);
    }
  }

  return x0 <= x1 && y0 <= y1 ? [x0, y0, x1, y1] : undefined;
}

/** What a hatch pattern's definition holds, as the checks of what a hatch draws read it. */
export interface PatternSizes {
  /** Its lines and the dashes of each, which a hatch's lines are placed from. */
  readonly items: number;
  /** The largest size of a line's angle. */
  readonly angle: number;
  /** The largest sum of the sizes of a line's base point's numbers. */
  readonly base: number;
  /** The largest size of a number a line's offset or dashes gives, the offset's two summed. */
  readonly reach: number;
}

/** The sizes of one of a pattern's lines, whose numbers are all finite. */
export function lineSizes(line: PatternLine): Omit<PatternSizes, "items"> {
  let reach = Math.abs(line.offset[0]) + Math.abs(line.offset[1]);

  for (const dash of filled(line.dashes ?? [])) reach = Math.max(reach, Math.abs(dash));

  return {
    angle: Math.abs(line.angle),
    base: Math.abs(line.base[0]) + Math.abs(line.base[1]),
    reach,
  };
}

/**
 * The sizes of a pattern's lines, or undefined when one cannot be placed: at most `PATTERN_ITEMS`
 * lines, each an object of finite numbers with at most as many dashes. A list of dashes that many
 * lines share is read once, through `dashesRead`.
 */
export function patternSizes(
  lines: readonly PatternLine[] | undefined,
  dashesRead: WeakMap<object, number | undefined>,
): PatternSizes | undefined {
  if (!Array.isArray(lines) || lines.length > PATTERN_ITEMS) return undefined;

  const pair = (p: unknown): p is Point =>
    Array.isArray(p) && isFiniteNumber(p[0]) && isFiniteNumber(p[1]);

  let [items, angle, bases, reach] = [lines.length, 0, 0, 0];

  for (let i = 0; i < lines.length; i++) {
    const l: unknown = lines[i];

    // A list is no line: it has no angle.
    if (!isRecord(l)) return undefined;

    if (!isFiniteNumber(l.angle) || !pair(l.base) || !pair(l.offset)) return undefined;
    const dashes: unknown = l.dashes;
    let most = 0;

    if (dashes !== undefined) {
      if (!Array.isArray(dashes)) return undefined;

      if (!dashesRead.has(dashes)) {
        let found: number | undefined = 0;

        if (dashes.length > PATTERN_ITEMS) found = undefined;
        else
          for (let j = 0; j < dashes.length; j++) {
            const dash: unknown = dashes[j];

            if (!isFiniteNumber(dash)) {
              found = undefined;
              break;
            }

            found = Math.max(found, Math.abs(dash));
          }

        dashesRead.set(dashes, found);
      }

      const found = dashesRead.get(dashes);

      if (found === undefined) return undefined;
      most = found;
      items += dashes.length;
    }

    const [base, offset] = [l.base, l.offset];
    angle = Math.max(angle, Math.abs(l.angle));
    bases = Math.max(bases, Math.abs(base[0]) + Math.abs(base[1]));
    reach = Math.max(reach, most, Math.abs(offset[0]) + Math.abs(offset[1]));
  }

  return { items, angle, base: bases, reach };
}

/** A family of a hatch's lines as their count reads it: their angle and how far apart they lie. */
export interface Family {
  readonly angle: number;
  readonly apart: number;
}

/** What a hatch's pattern places, as the checks of what it draws read it. */
export interface PatternSpread {
  readonly families: readonly Family[];
  /** At least the largest size of a number a placed line holds: an angle, a coordinate, a dash. */
  readonly reach: number;
}

/**
 * What a hatch's pattern places, from its numbers as written: each family of lines, and a size no
 * number its placed lines hold is above. Undefined for a solid hatch, and for a pattern `patternOf`
 * does not find; `sizesOf` gives the sizes of the definition it finds.
 */
export function hatchSpread(
  hatch: Pick<Hatch, "pattern">,
  patternOf: (name: string) => HatchPattern | undefined,
  sizesOf: (pattern: HatchPattern) => PatternSizes | undefined,
): PatternSpread | undefined {
  const c = chosen(hatch, patternOf);

  if (c === undefined) return undefined;
  const { angle, scale, origin, pattern } = c;
  const away = Math.max(Math.abs(origin[0]), Math.abs(origin[1]));

  if (pattern === undefined) {
    const families = [{ angle, apart: scale }];

    if (c.crossed) families.push({ angle: angle + 90, apart: scale });

    return { families, reach: Math.max(Math.abs(angle) + 90, scale, away) };
  }

  const sizes = sizesOf(pattern);

  if (sizes === undefined) return undefined;
  const families: Family[] = [];

  for (const line of filled(pattern.lines)) {
    families.push({ angle: line.angle + angle, apart: line.offset[1] * scale });
  }

  // A line's base is scaled, turned and moved, and its offset and dashes scaled and turned.
  return {
    families,
    reach: Math.max(sizes.angle + Math.abs(angle), sizes.base * scale + away, sizes.reach * scale),
  };
}

/**
 * How many lines a hatch's pattern draws across the box of its loops, at most: for each family,
 * the box's extent across its lines over how far apart they lie, and one more.
 */
export function linesAcross(box: LoopsBox, families: readonly Family[]): number {
  const [width, height] = [box[2] - box[0], box[3] - box[1]];
  let count = 0;

  for (const { angle, apart } of families) {
    const [c, s] = direction(angle);
    count += Math.floor((width * Math.abs(s) + height * Math.abs(c)) / Math.abs(apart)) + 1;
  }

  return count;
}

/**
 * What is wrong with what a hatch's pattern draws inside its loops, or undefined: a number of its
 * placed lines that is 1e100 or more, or more lines than `HATCH_LINES`. `lint` and the builder
 * refuse such a hatch, and `toSVG` draws none of its lines.
 */
export function patternDrawnProblem(box: LoopsBox, spread: PatternSpread): string | undefined {
  // Written with 15 digits, a number just under 1e100 would print as 1e+100.
  if (!(Number(spread.reach.toPrecision(15)) < 1e100)) return PATTERN_REACH;
  const count = linesAcross(box, spread.families);

  return count <= HATCH_LINES ? undefined : patternDensityProblem(count);
}

/** The name a file holds for each gradient, group 470. */
export const GRADIENT_NAMES: Readonly<Record<GradientName, string>> = {
  linear: "LINEAR",
  cylinder: "CYLINDER",
  "inverted-cylinder": "INVCYLINDER",
  spherical: "SPHERICAL",
  "inverted-spherical": "INVSPHERICAL",
  hemispherical: "HEMISPHERICAL",
  "inverted-hemispherical": "INVHEMISPHERICAL",
  curved: "CURVED",
  "inverted-curved": "INVCURVED",
};

/** A gradient as both writers write it, from its numbers as written. */
export interface GradientWritten {
  readonly name: GradientName;
  /** Group 460: radians, as `fifteenDigits` writes them. */
  readonly angle: number;
  readonly centered: boolean;
  /** Group 452: true for one color and its tint. */
  readonly single: boolean;
  /** Group 462: the tint as written for one color, and 1 for two. */
  readonly tint: number;
  /** The two colors of groups 421: for one color, the color and `tintColor` of it. */
  readonly colors: readonly [Rgb, Rgb];
}

/**
 * A hatch's gradient as written, or undefined for none and for one whose name, colors or tint the
 * rules refuse. An angle that is not finite is taken as 0, and a centering other than false as true.
 */
export function gradientWritten(gradient: HatchGradient | undefined): GradientWritten | undefined {
  // A hatch made by hand may give a gradient of any shape, and any value in each field.
  if (!isRecord(gradient)) return;
  const fields: GradientFields = gradient;
  // Each field is read once, and each color copied, so what is checked is what is written.
  const name = fields.name;
  const angle = fields.angle;
  const centered = fields.centered;
  const colors = fields.colors;
  const color = fields.color;
  const tint = fields.tint;

  if (!isGradientName(name)) return;
  const degrees = isNumber(angle) && Number.isFinite(angle) ? written(angle) : 0;

  const base = {
    name,
    angle: Number(fifteenDigits((degrees * Math.PI) / 180)),
    centered: centered !== false,
  };

  if (colors !== undefined) {
    if (!Array.isArray(colors) || colors.length !== 2) return;
    const [first, second] = [rgbOf(colors[0]), rgbOf(colors[1])];

    if (!first || !second) return;

    return { ...base, single: false, tint: 1, colors: [held(first), held(second)] };
  }

  const one = rgbOf(color);

  if (!one || !isNumber(tint) || !(tint >= 0 && tint <= 1)) return;
  const shade = written(tint);

  return {
    ...base,
    single: true,
    tint: shade,
    colors: [held(one), held(tintColor(one, shade))],
  };
}

/**
 * A gradient's color as a file holds it: black as 0,0,1, since the leading CAD app reads a true
 * color of 0 as none and takes the index's color in its place.
 */
const held = (color: Rgb): Rgb =>
  color[0] === 0 && color[1] === 0 && color[2] === 0 ? [0, 0, 1] : [color[0], color[1], color[2]];

/** A true color as one number, `0xRRGGBB`, as group 421 holds it. */
export const rgbNumber = ([r, g, b]: Rgb): number => (r << 16) | (g << 8) | b;

/**
 * The second color of a gradient of one color, as the leading CAD app stores it for a tint: the
 * color with its lightness, in hue, lightness and saturation, set to the tint, its hue in whole
 * degrees and its saturation in whole hundredths.
 */
export function tintColor([r, g, b]: Rgb, tint: number): Rgb {
  const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)];
  const lightness = (max + min) / 510;

  const spread =
    max === min
      ? 0
      : lightness <= 0.5
        ? (max - min) / (max + min)
        : (max - min) / (510 - max - min);

  const saturation = Math.round(spread * 100) / 100;
  let hue = 0;

  if (max !== min) {
    if (max === r) hue = (g - b) / (max - min);
    else if (max === g) hue = 2 + (b - r) / (max - min);
    else hue = 4 + (r - g) / (max - min);
  }

  hue = ((Math.round(hue * 60) % 360) + 360) % 360;
  const high = tint <= 0.5 ? tint * (1 + saturation) : tint + saturation - tint * saturation;
  const low = 2 * tint - high;

  const channel = (at: number): number => {
    const x = ((at % 360) + 360) % 360;

    const v =
      x < 60
        ? low + ((high - low) * x) / 60
        : x < 180
          ? high
          : x < 240
            ? low + ((high - low) * (240 - x)) / 60
            : low;

    return Math.round(v * 255);
  };

  return [channel(hue + 120), channel(hue), channel(hue - 120)];
}

/** A color of a gradient's picture, where it lies from 0 to 1 along the picture. */
export interface GradientStop {
  readonly offset: number;
  readonly color: Rgb;
}

/**
 * What a gradient draws, as the leading CAD app plots it: its colors along a line, `linear`, or
 * out from a point, `radial`, each in a frame that `frame` maps onto the hatch's coordinates. A
 * linear picture runs from x 0 to x 1 of its frame, and a radial one from its frame's origin to the
 * circle of radius 1 about it; past either end it keeps the end's color. The colors between two
 * stops run straight from one to the other.
 */
export interface GradientPicture {
  readonly kind: "linear" | "radial";
  readonly frame: Matrix;
  readonly stops: readonly GradientStop[];
}

const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
const scale = (x: number, y: number): Matrix => [x, 0, 0, y, 0, 0];
const turn = (a: number): Matrix => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];

const times = (...ms: Matrix[]): Matrix =>
  ms.reduce((m, n): Matrix => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]);

/**
 * How many colors a curve's picture holds, each rounded to a whole level: enough that it strays
 * less than a level from the curve.
 */
const FALLOFF_STOPS = 33;
const CYLINDER_STOPS = 33;

/** The most colors a gradient's picture holds, which `svgToPDF` reads no more than. */
export const GRADIENT_STOPS = Math.max(FALLOFF_STOPS, CYLINDER_STOPS);

/** Where a gradient that is not centered is half way along t, and where its spots move. */
const SHIFTED_MIDDLE = 0.3;
const SPOT_SHIFT = 0.25;

/** How much a curved gradient's oval is squeezed across, centered and not. */
const CURVED_ACROSS = { centered: 2 / 3, shifted: 4 / 5 } as const;

/** What a gradient's frames are worked out from: each side of its loops, then the picture. */
export interface GradientBoxer {
  side(from: Point, to: Point, bulge: number): void;
  picture(): GradientPicture | undefined;
}

/**
 * Walks a gradient hatch's sides and gives its picture. The leading CAD app works a gradient out
 * in two frames, each a unit square about the middle of the box of the loops, its arcs at their
 * full extent, turned by the gradient's angle a: the box frame scaled by W and H, the sides of the
 * box of the loops turned by minus a reduced by quarter turns to -45 to 45 degrees; and the square
 * frame scaled by L both ways, the box's larger side, or the turned box's at an odd multiple of 45
 * degrees. A box with no width or height draws nothing.
 */
export function gradientBoxer(g: GradientWritten): GradientBoxer {
  const quarter = Math.PI / 2;
  const reduced = g.angle - quarter * Math.round(g.angle / quarter);
  const [c, s] = [Math.cos(reduced), Math.sin(reduced)];

  // Across, up, and the two of the turned box.
  const axes: readonly Point[] = [
    [1, 0],
    [0, 1],
    [c, s],
    [-s, c],
  ];

  const low = [Infinity, Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity, -Infinity];

  const include = (p: Point) => {
    for (let k = 0; k < 4; k++) {
      const along = p[0] * axes[k]![0] + p[1] * axes[k]![1];

      if (along < low[k]!) low[k] = along;

      if (along > high[k]!) high[k] = along;
    }
  };

  return {
    side(from, to, bulge) {
      include(from);
      include(to);
      const arc = sideArc(from, to, bulge);

      if (!arc) return;
      // The arc's farthest point along each axis, either way, where it lies inside its sweep.
      const span = Math.abs(arc.sweep);

      for (const [x, y] of axes)
        for (const sign of [1, -1]) {
          const at = Math.atan2(sign * y, sign * x);
          const gone = arc.sweep > 0 ? at - arc.start : arc.start - at;
          const turned = ((gone % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

          if (turned <= span)
            include([arc.center[0] + sign * x * arc.radius, arc.center[1] + sign * y * arc.radius]);
        }
    },
    picture() {
      const [w, h, W, H] = [
        high[0]! - low[0]!,
        high[1]! - low[1]!,
        high[2]! - low[2]!,
        high[3]! - low[3]!,
      ];

      if (!(w > 0 && h > 0 && W > 0 && H > 0) || !Number.isFinite(w + h + W + H)) return;
      const middle: Point = [(low[0]! + high[0]!) / 2, (low[1]! + high[1]!) / 2];
      const diagonal = Math.abs(Math.abs(reduced) - Math.PI / 4) < 1e-9;
      const side = diagonal ? Math.max(W, H) : Math.max(w, h);
      const box = times(translate(...middle), scale(W, H), turn(g.angle));
      const square = times(translate(...middle), scale(side, side), turn(g.angle));

      return pictured(g, { box, square, middle, w, h, W, H });
    },
  };
}

/** The frames of a gradient's box, and the sides they are made from. */
interface Frames {
  readonly box: Matrix;
  readonly square: Matrix;
  readonly middle: Point;
  readonly w: number;
  readonly h: number;
  readonly W: number;
  readonly H: number;
}

/** A gradient's picture in its frames. */
function pictured(g: GradientWritten, f: Frames): GradientPicture {
  const inverted = g.name.startsWith("inverted-");
  const [from, to] = inverted ? [g.colors[1], g.colors[0]] : g.colors;

  const mix = (t: number): Rgb => [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ];

  const shift = g.centered ? 0 : 1;

  // A falloff from the second color at the middle of a spot, r 0, to the first at its edge, r 1.
  const falloff = (): GradientStop[] =>
    Array.from({ length: FALLOFF_STOPS }, (_, k) => {
      const r = k / (FALLOFF_STOPS - 1);

      return { offset: r, color: mix(Math.cos((Math.PI / 2) * r)) };
    });

  // Where t falls for a fraction of the way along a gradient that is not centered.
  const unbent = (t: number): number =>
    g.centered
      ? t
      : t <= 0.5
        ? 2 * SHIFTED_MIDDLE * t
        : SHIFTED_MIDDLE + 2 * (1 - SHIFTED_MIDDLE) * (t - 0.5);

  const across = times(f.box, translate(-0.5, 0));

  switch (g.name) {
    case "linear": {
      if (!g.centered) {
        return {
          kind: "linear",
          frame: across,
          stops: [
            { offset: 0, color: mix(0) },
            { offset: SHIFTED_MIDDLE, color: mix(0.5) },
            { offset: 1, color: mix(1) },
          ],
        };
      }

      // The plane through the middle and the box's corners, each held to 0 to 1: the gradient
      // itself unless a corner falls past an end of it.
      const u = (x: number, y: number) =>
        Math.min(
          1,
          Math.max(0, 0.5 + (Math.cos(g.angle) * x) / f.W + (Math.sin(g.angle) * y) / f.H),
        ) - 0.5;

      const [a, b] = [u(f.w / 2, f.h / 2), u(-f.w / 2, f.h / 2)];
      const [gx, gy] = [(a - b) / f.w, (a + b) / f.h];
      const size = gx * gx + gy * gy;
      const [ex, ey] = [gx / size, gy / size];

      return {
        kind: "linear",
        frame: [ex, ey, -ey, ex, f.middle[0] - ex / 2, f.middle[1] - ey / 2],
        stops: [
          { offset: 0, color: mix(0) },
          { offset: 1, color: mix(1) },
        ],
      };
    }

    case "cylinder":
    case "inverted-cylinder":
      return {
        kind: "linear",
        frame: across,
        stops: Array.from({ length: CYLINDER_STOPS }, (_, k) => {
          const t = k / (CYLINDER_STOPS - 1);

          return { offset: unbent(t), color: mix(Math.sin(Math.PI * t)) };
        }),
      };
    case "spherical":
    case "inverted-spherical":
      return {
        kind: "radial",
        frame: times(f.square, translate(-SPOT_SHIFT * shift, SPOT_SHIFT * shift), scale(0.5, 0.5)),
        stops: falloff(),
      };
    case "hemispherical":
    case "inverted-hemispherical":
      return {
        kind: "radial",
        frame: times(f.square, translate(-2 * SPOT_SHIFT * shift, -0.5)),
        stops: falloff(),
      };
    case "curved":
    case "inverted-curved": {
      const k = g.centered ? CURVED_ACROSS.centered : CURVED_ACROSS.shifted;

      return {
        kind: "radial",
        frame: times(f.box, translate(-SPOT_SHIFT * shift, -0.5), scale(1 / k, 1)),
        stops: falloff(),
      };
    }
  }
}

/**
 * The picture of a hatch's gradient, from its loops and gradient as written: undefined for a hatch
 * with no gradient, for one the rules refuse, and for loops whose box has no width or height.
 */
export function gradientPicture(
  hatch: Pick<Hatch, "loops" | "gradient">,
): GradientPicture | undefined {
  const g = gradientWritten(hatch.gradient);

  if (g === undefined) return undefined;
  const boxer = gradientBoxer(g);

  for (const loop of drawnLoops(hatch.loops)) {
    for (const side of loopSides(loop)) {
      boxer.side(writtenPoint(side.from), writtenPoint(side.to), written(side.bulge));
    }
  }

  return boxer.picture();
}

/** A point as the writers write it. */
export const writtenPoint = ([x, y]: Point): Point => [written(x), written(y)];

/** The sides of a hatch's loop, as a closed polyline's. */
export function loopSides(loop: HatchLoop): PolylineSide[] {
  return polylineSides(loopOutline(loop, ""));
}

/** True when a loop has a side with a bulge as written. */
export function loopBulged(loop: HatchLoop): boolean {
  const bulges: unknown = loop.bulges;

  if (!Array.isArray(bulges)) return false;

  for (let i = 0; i < bulges.length && i in bulges; i++) {
    const b: unknown = bulges[i];

    if (isNumber(b) && written(b) !== 0) return true;
  }

  return false;
}

/** True when a polygon's points, as written, all lie on one line, so it closes around no area. */
export function onOneLine(points: readonly Point[]): boolean {
  const p = points.map(([x, y]): Point => [written(x), written(y)]);
  const a = p[0];
  const b = p.find((q) => q[0] !== a?.[0] || q[1] !== a?.[1]);

  if (a === undefined || b === undefined) return true;

  return p.every((c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) === 0);
}

/**
 * True when two sides of a polygon cross or touch, other than where two sides meet at a corner,
 * from its points as written: each side against each one not next to it. A point given twice in
 * a row, or its first point again at its end, makes no side.
 */
export function polygonCrosses(points: readonly Point[]): boolean {
  const p: Point[] = [];

  for (const [x, y] of points) {
    const q: Point = [written(x), written(y)];
    const last = p.at(-1);

    if (last === undefined || last[0] !== q[0] || last[1] !== q[1]) p.push(q);
  }

  if (p.length > 1 && p[0]![0] === p.at(-1)![0] && p[0]![1] === p.at(-1)![1]) p.pop();
  const n = p.length;

  const turn = (a: Point, b: Point, c: Point): number =>
    Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));

  const within = (a: Point, b: Point, c: Point): boolean =>
    Math.min(a[0], b[0]) <= c[0] &&
    c[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= c[1] &&
    c[1] <= Math.max(a[1], b[1]);

  for (let i = 0; i < n; i++) {
    const [a, b] = [p[i]!, p[(i + 1) % n]!];

    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [c, d] = [p[j]!, p[(j + 1) % n]!];
      const [t1, t2, t3, t4] = [turn(a, b, c), turn(a, b, d), turn(c, d, a), turn(c, d, b)];

      if (t1 !== t2 && t3 !== t4 && t1 !== 0 && t2 !== 0 && t3 !== 0 && t4 !== 0) return true;

      if (
        (t1 === 0 && within(a, b, c)) ||
        (t2 === 0 && within(a, b, d)) ||
        (t3 === 0 && within(c, d, a)) ||
        (t4 === 0 && within(c, d, b))
      )
        return true;
    }
  }

  return false;
}

/** A wipeout's picture of one pixel: its lower-left corner and its side, as written. */
export interface WipeoutPicture {
  readonly corner: Point;
  readonly side: number;
}

/** The picture a wipeout's points give, from the points as written. */
export function wipeoutPicture(points: readonly Point[]): WipeoutPicture {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];

  for (const [x, y] of filled(points)) {
    const [wx, wy] = [written(x), written(y)];
    x0 = Math.min(x0, wx);
    y0 = Math.min(y0, wy);
    x1 = Math.max(x1, wx);
    y1 = Math.max(y1, wy);
  }

  return { corner: [x0, y0], side: Math.max(x1 - x0, y1 - y0) };
}

/**
 * A wipeout's polygon in its picture's axes, as the file holds it: x across from the left edge's
 * middle and y down from the top's, each from -0.5 to 0.5, with its first point again at its end.
 */
export function wipeoutClip(points: readonly Point[]): Point[] {
  const { corner, side } = wipeoutPicture(points);
  const given = filled(points);

  return [...given, given[0]!].map(([x, y]): Point => [
    (written(x) - corner[0]) / side - 0.5,
    0.5 - (written(y) - corner[1]) / side,
  ]);
}

/** A mask as it is drawn: none for `false`, and for `true` or an object its color and factor. */
export interface Mask {
  /** A color index, or undefined for the drawing's background. */
  readonly color?: number;
  readonly offsetFactor: number;
}

/** A mask's factor of the text height unless given, as the leading CAD app sets one. */
export const MASK_FACTOR = 1.5;

/** The factor of a dimension's mask, which its style does not set. */
export const DIMENSION_MASK_FACTOR = 1.25;

/**
 * A mask as it is drawn: none for `false`, and for `true` or an object the drawing's background or
 * a color index, and its factor as written. A field the rules refuse is drawn as its default, and
 * any other value as no mask.
 */
export function maskOf(mask: TextMask | undefined): Mask | undefined {
  if (mask === true) return { offsetFactor: MASK_FACTOR };

  // A mask made by hand may be of any shape, and hold any value in each field.
  if (!isRecord(mask)) return undefined;
  const fields: MaskFields = mask;
  const color = fields.color;
  const offsetFactor = fields.offsetFactor;

  const factor =
    isNumber(offsetFactor) && Number.isFinite(offsetFactor) ? written(offsetFactor) : MASK_FACTOR;

  return isColorIndex(color) ? { color, offsetFactor: factor } : { offsetFactor: factor };
}

/** The box of each layout's lines a mask covers, read once for a layout however often it is placed. */
const reaches = new WeakMap<ParagraphLayout, readonly [number, number, number, number]>();

/** A layout's frame, reaching to the start and the end of each line that passes it. */
function maskReach(layout: ParagraphLayout): readonly [number, number, number, number] {
  const known = reaches.get(layout);

  if (known) return known;
  let [left, bottom, right, top] = layout.frame;

  for (const line of layout.lines) {
    const first = line.runs[0];

    if (first === undefined) continue;

    if (first.x < left) left = first.x;

    if (line.end > right) right = line.end;
  }

  const reach = [left, bottom, right, top] as const;
  reaches.set(layout, reach);

  return reach;
}

/**
 * The box of a text's mask, `[left, bottom, right, top]` along its lines from its point: its box,
 * reaching to the end of a line longer than its width, grown by its factor less one times
 * `height` each side.
 */
export function maskBox(
  layout: ParagraphLayout,
  height: number,
  mask: Mask,
): [number, number, number, number] {
  const [left, bottom, right, top] = maskReach(layout);
  const grow = (mask.offsetFactor - 1) * height;

  return [left - grow, bottom - grow, right + grow, top + grow];
}

/** The corners of a paragraph's mask, its lower left first and counterclockwise. */
export function paragraphMaskCorners(
  paragraph: Pick<ParagraphToMeasure, "at" | "rotation" | "height">,
  layout: ParagraphLayout,
  mask: Mask,
): Point[] {
  const place = placer(paragraph);
  const [l, b, r, t] = maskBox(layout, paragraph.height, mask);

  return [place(l, b), place(r, b), place(r, t), place(l, t)];
}

/** How many wipeouts a drawing holds: in model space, on its layouts and in its blocks. */
export function wipeoutCount(drawing: Drawing): number {
  const lists: (readonly Entity[] | undefined)[] = [
    drawing.entities,
    ...filled(drawing.layouts ?? []).map((layout) => layout.entities),
    ...filled(drawing.blocks ?? []).map((block) => block.entities),
  ];

  let count = 0;

  for (const list of lists) for (const e of filled(list ?? [])) if (e.kind === "wipeout") count++;

  return count;
}

/** The mask of a dimension style's text, or undefined for none and for a value `lint` refuses. */
export function dimensionMask(
  style: { readonly textMask?: unknown } | undefined,
): Mask | undefined {
  const mask: unknown = style?.textMask;

  if (mask === true) return { offsetFactor: DIMENSION_MASK_FACTOR };

  if (!isRecord(mask)) return undefined;
  const { color } = mask;

  if (!isColorIndex(color)) return undefined;

  return { color, offsetFactor: DIMENSION_MASK_FACTOR };
}

/** The handle of WIPEOUTVARIABLES, which the dictionary `ACAD_WIPEOUT_VARS` names. */
export function wipeoutVariablesHandle(): string {
  return keyHandle("wipeout-variables:");
}

/** The handle of the dictionary of the drawing's variables, `AcDbVariableDictionary`. */
export function variableDictionaryHandle(): string {
  return keyHandle("dictionary:acdbvariabledictionary");
}

/** The handle of the variable `WIPEOUTFRAME` there, which says whether wipeouts' frames show. */
export function wipeoutFrameVariableHandle(): string {
  return keyHandle("dictionary-variable:wipeoutframe");
}

/** The application the classes of a wipeout and its variables name. */
export const WIPEOUT_APPLICATION = "WipeOut";

/** The fields of a gradient, as a hatch made by hand may hold them. */
interface GradientFields {
  readonly name?: unknown;
  readonly angle?: unknown;
  readonly centered?: unknown;
  readonly colors?: unknown;
  readonly color?: unknown;
  readonly tint?: unknown;
}

/** The fields of a mask, as a text made by hand may hold them. */
interface MaskFields {
  readonly color?: unknown;
  readonly offsetFactor?: unknown;
}

/** Whether a value is a finite number. */
function isFiniteNumber(n: unknown): n is number {
  return isNumber(n) && Number.isFinite(n);
}

/** Whether a mask's color is a color index, 1 to 256, which is ByLayer. */
function isColorIndex(color: unknown): color is number {
  return isNumber(color) && Number.isInteger(color) && color >= 1 && color <= 256;
}

function isGradientName(name: unknown): name is GradientName {
  return isString(name) && Object.hasOwn(GRADIENT_NAMES, name);
}

/**
 * Whether a value of a hatch's loops is drawn as one: an object that is no array. Each reader of
 * a loop reads its points and its bulges as lists of any values.
 */
function isLoop(loop: unknown): loop is HatchLoop {
  return isRecord(loop);
}
