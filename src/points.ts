// A drawing's point style: what figure every point plots as, and how big, as the file holds it
// in PDMODE and PDSIZE and as the leading CAD app draws it.
import type { Point, PointFigure, PointStyle } from "./drawing.ts";
import { sizeProblem } from "./rules.ts";
import { isBoolean, isNumber, isPlainRecord } from "./guards.ts";

/** The figures, in the order PDMODE numbers them from 0. */
export const POINT_FIGURES: readonly PointFigure[] = ["dot", "none", "plus", "cross", "tick"];

/** The PDMODE that holds a point style. */
export function pointMode(style: PointStyle): number {
  return POINT_FIGURES.indexOf(style.figure) + (style.circle ? 32 : 0) + (style.square ? 64 : 0);
}

/** The PDSIZE that holds a point style's size: a relative size is negative, and none is 0. */
export function pointSize(style: PointStyle): number {
  const size = style.size;

  if (size === undefined) return 0;

  return isNumber(size) ? size : -size.percent;
}

/**
 * The point style a file's PDMODE and PDSIZE give, as the leading CAD app plots them. A PDMODE
 * that is none of the 20 the app offers plots as a dot, and a PDSIZE of 0, or none, as 5% of the
 * view.
 *
 * ```ts
 * pointStyleOf(35, -10); // { figure: "cross", circle: true, size: { percent: 10 } }
 * ```
 */
export function pointStyleOf(pdmode?: number, pdsize?: number): PointStyle {
  const mode = Number.isInteger(pdmode) ? pdmode! : 0;
  const figure = mode & 31;
  const known = mode >= 0 && mode <= 100 && (mode & ~(31 | 32 | 64)) === 0 && figure <= 4;
  const size = Number.isFinite(pdsize) ? pdsize! : 0;

  const figured: PointStyle = { figure: known ? POINT_FIGURES[figure]! : "dot" };
  const circled: PointStyle = known && mode & 32 ? { ...figured, circle: true } : figured;
  const squared: PointStyle = known && mode & 64 ? { ...circled, square: true } : circled;

  return { ...squared, size: size > 0 ? size : { percent: size === 0 ? 5 : -size } };
}

/**
 * What is wrong with a value given as a point style, each as a sentence. It takes any value, as a
 * caller in plain JavaScript may give one.
 */
export function pointStyleProblems(style: unknown): string[] {
  if (!isPlainRecord(style)) return ["pointStyle must be a plain object"];
  const s = style;
  const out: string[] = [];
  // The first field it does not know, cut short, keeps the message small whatever the key.
  const extra = Object.keys(s).find((key) => !["figure", "circle", "square", "size"].includes(key));

  if (extra !== undefined)
    out.push(
      `pointStyle has a field it does not know, ${JSON.stringify(extra.length > 40 ? `${extra.slice(0, 40)}…` : extra)}`,
    );

  if (!POINT_FIGURES.some((figure) => figure === s.figure))
    out.push(`pointStyle's figure must be one of ${POINT_FIGURES.map((f) => `"${f}"`).join(", ")}`);

  for (const flag of ["circle", "square"])
    if (s[flag] !== undefined && !isBoolean(s[flag]))
      out.push(`pointStyle's ${flag} must be true or false`);
  const size = s.size;

  if (size === undefined) return out;

  if (isNumber(size)) {
    const problem = Number.isFinite(size) ? sizeProblem(size) : "it must be a finite number";

    if (problem) out.push(`pointStyle's size: ${problem}`);
  } else if (isPlainRecord(size) && Object.keys(size).length === 1 && "percent" in size) {
    const percent = size.percent;

    const problem =
      isNumber(percent) && Number.isFinite(percent)
        ? sizeProblem(percent)
        : "it must be a finite number";

    if (problem) out.push(`pointStyle's size in percent: ${problem}`);
  } else out.push("pointStyle's size must be a number, or { percent } of the view");

  return out;
}

/**
 * How far a point's figure reaches from the point: its size, the length of an arm of its + or ×.
 * A relative size is that share of half `height`, the height of the view the point is seen in, in
 * its units. Undefined when the figure has no size to draw, and is drawn as a dot.
 */
export function pointReach(style: PointStyle, height: number): number | undefined {
  const size = style.size ?? { percent: 5 };
  const reach = isNumber(size) ? size : (size.percent / 100) * (height / 2);

  return reach > 0 && Number.isFinite(reach) ? reach : undefined;
}

/** A part of a point's figure: a circle of a radius, or a path, one point long for a dot. */
export type PointPart = { readonly radius: number } | { readonly points: readonly Point[] };

/**
 * The parts of a point's figure about the origin, before it is turned, in the order the leading
 * CAD app plots them: the circle from its point at 0 degrees counterclockwise, the square from its
 * lower left corner clockwise, then the dot, the +, the × or the tick. `reach` is `pointReach`'s.
 */
export function pointFigure(style: PointStyle, reach: number | undefined): PointPart[] {
  if (reach === undefined) return style.figure === "none" ? [] : [{ points: [[0, 0]] }];
  const h = reach / 2;
  const out: PointPart[] = [];

  if (style.circle) out.push({ radius: h });

  if (style.square)
    out.push({
      points: [
        [-h, -h],
        [-h, h],
        [h, h],
        [h, -h],
        [-h, -h],
      ],
    });
  const a = reach / Math.SQRT2;

  switch (style.figure) {
    case "dot":
      out.push({ points: [[0, 0]] });
      break;
    case "plus":
      out.push(
        {
          points: [
            [-reach, 0],
            [reach, 0],
          ],
        },
        {
          points: [
            [0, -reach],
            [0, reach],
          ],
        },
      );
      break;
    case "cross":
      out.push(
        {
          points: [
            [-a, -a],
            [a, a],
          ],
        },
        {
          points: [
            [-a, a],
            [a, -a],
          ],
        },
      );
      break;
    case "tick":
      out.push({
        points: [
          [0, 0],
          [0, h],
        ],
      });
      break;
    case "none":
      break;
  }

  return out;
}
