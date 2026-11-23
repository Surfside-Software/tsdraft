// Hatch patterns: a pattern file's definitions, and the lines a pattern draws inside a hatch's
// loops. A pattern is a set of families of parallel lines: each family's line runs through its
// base point at its angle, the next one over is moved by its offset, and its dashes repeat along
// it from the base point, a positive length drawn, a negative one left out, and 0 a dot. A pattern
// file gives the offset along and across its line; a hatch in a file holds every line already
// turned by the hatch's angle, scaled and moved to its origin, the offset turned to the line's
// angle. The lines are cut to the area the loops fill by parity, as the leading CAD app cuts them.
import type { HatchPattern, PatternLine, Point } from "./drawing.ts";
import {
  direction,
  includeArc,
  sideArc,
  type PolylineBox,
  type PolylineSide,
  type SideArc,
} from "./polylines.ts";
import { isString } from "./guards.ts";

/** The most characters of a pattern file `parsePatterns` reads. */
export const PATTERN_FILE_LENGTH = 1_000_000;

/**
 * The patterns of a pattern file's text, in the format CAD programs read: a pattern starts at a
 * line `*NAME, description`, and each line after it is `angle, x, y, dx, dy` and its dashes. A `;`
 * starts a comment.
 *
 * @throws RangeError for a line it cannot read, naming its number, and for text past
 *   `PATTERN_FILE_LENGTH` characters.
 */
export function parsePatterns(text: string): HatchPattern[] {
  if (!isString(text)) throw new RangeError("A pattern file's text must be a string");

  if (text.length > PATTERN_FILE_LENGTH)
    throw new RangeError(`A pattern file is at most ${PATTERN_FILE_LENGTH} characters`);
  const out: { name: string; description?: string; lines: PatternLine[] }[] = [];
  const rows = text.split(/\r\n|\r|\n/);
  rows.forEach((row, index) => {
    const comment = row.indexOf(";");
    const line = (comment < 0 ? row : row.slice(0, comment)).trim();

    if (line === "") return;
    const where = `line ${index + 1} of the pattern file`;

    if (line.startsWith("*")) {
      const at = line.indexOf(",");
      const name = (at < 0 ? line.slice(1) : line.slice(1, at)).trim();

      if (name === "") throw new RangeError(`${where}: a pattern needs a name after *`);
      const description = at < 0 ? "" : line.slice(at + 1).trim();
      out.push(description === "" ? { name, lines: [] } : { name, description, lines: [] });

      return;
    }

    const pattern = out.at(-1);

    if (pattern === undefined) throw new RangeError(`${where}: a line before any *NAME`);
    const values = line.split(",").map((v) => v.trim());
    const numbers = values.map(Number);

    if (values.length < 5 || values.some((v) => v === "") || !numbers.every(Number.isFinite))
      throw new RangeError(
        `${where}: a line is angle, x, y, dx, dy and its dashes, all numbers, not ${JSON.stringify(line)}`,
      );
    // Five numbers or more, as the check above says.
    const [angle, x, y, dx, dy] = [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!, numbers[4]!];
    const dashes = numbers.slice(5);
    const placed: PatternLine = { angle, base: [x, y], offset: [dx, dy] };
    pattern.lines.push(dashes.length === 0 ? placed : { ...placed, dashes });
  });

  for (const pattern of out) {
    if (pattern.lines.length === 0)
      throw new RangeError(`The pattern ${JSON.stringify(pattern.name)} has no lines`);
  }

  return out;
}

/** A pattern's line placed in a drawing: turned, scaled and moved, the offset turned to it. */
export interface PlacedLine {
  readonly angle: number;
  readonly base: Point;
  /** In the drawing's axes. */
  readonly offset: Point;
  readonly dashes: readonly number[];
}

const turn = ([x, y]: Point, degrees: number): Point => {
  const [c, s] = direction(degrees);

  return [x * c - y * s, x * s + y * c];
};

/**
 * A pattern's lines placed by a hatch: each angle plus `angle`, each base scaled, turned and moved
 * to `origin`, each offset scaled and turned to its line's angle, and each dash scaled.
 */
export function placedLines(
  lines: readonly PatternLine[],
  scale: number,
  angle: number,
  origin: Point,
): PlacedLine[] {
  return lines.map((line) => {
    const base = turn([line.base[0] * scale, line.base[1] * scale], angle);

    return {
      angle: line.angle + angle,
      base: [origin[0] + base[0], origin[1] + base[1]],
      offset: turn([line.offset[0] * scale, line.offset[1] * scale], line.angle + angle),
      dashes: (line.dashes ?? []).map((d) => d * scale),
    };
  });
}

/** User-defined lines: one family at `angle`, `spacing` apart, and another square to it when crossed. */
export function userLines(
  spacing: number,
  angle: number,
  crossed: boolean,
  origin: Point,
): PlacedLine[] {
  const one = (a: number): PlacedLine => ({
    angle: a,
    base: origin,
    offset: turn([0, spacing], a),
    dashes: [],
  });

  return crossed ? [one(angle), one(angle + 90)] : [one(angle)];
}

/** A side of a loop a pattern is cut to: straight, or an arc by its bulge. */
export type PatternSide = Pick<PolylineSide, "from" | "to" | "bulge">;

/**
 * The pieces a pattern's lines draw inside the area loops fill by parity: each family's lines
 * cross the loops' box, each line is cut where it crosses a side, an arc where the line meets its
 * circle, and the pieces between an odd and an even crossing are cut again into its dashes from
 * its base point. `step` is asked before each line, paying for the sides it crosses, and before
 * each repeat of a line's dashes, paying for them; `piece` is given each piece. The walk stops when
 * either says no.
 */
export function patternPieces(
  rings: readonly (readonly PatternSide[])[],
  lines: readonly PlacedLine[],
  step: (cost: number) => boolean,
  piece: (from: Point, to: Point) => boolean,
): void {
  const box: PolylineBox = [Infinity, Infinity, -Infinity, -Infinity];
  const sides: { readonly side: PatternSide; readonly arc: SideArc | undefined }[] = [];

  for (const ring of rings) {
    for (const side of ring) {
      const arc = sideArc(side.from, side.to, side.bulge);
      sides.push({ side, arc });
      const [x, y] = side.from;

      if (x < box[0]) box[0] = x;

      if (y < box[1]) box[1] = y;

      if (x > box[2]) box[2] = x;

      if (y > box[3]) box[3] = y;

      if (arc) includeArc(box, arc);
    }
  }

  const [x0, y0, x1, y1] = box;

  if (!(x0 <= x1 && y0 <= y1)) return;
  // A line is crossed with every side, twice: once for where it crosses, once for where it runs along.
  const lineCost = 1 + Math.floor(sides.length / 32);
  // How far two distances may differ and be one: to the last bits of the loops' size, and of
  // where they lie, so that a hatch far from the origin cuts as one near it.
  const magnitude = Math.max(Math.abs(x0), Math.abs(y0), Math.abs(x1), Math.abs(y1));
  const tiny = 1e-9 * Math.max(x1 - x0, y1 - y0) + 2 * Number.EPSILON * magnitude;

  const corners: Point[] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];

  for (const line of lines) {
    const along = direction(line.angle);
    const across: Point = [-along[1], along[0]];
    // How far one line of the family lies from the next, square to them.
    const apart = line.offset[0] * across[0] + line.offset[1] * across[1];

    if (!(Math.abs(apart) > 1e-12)) continue;

    const reach = corners.map(
      ([x, y]) => ((x - line.base[0]) * across[0] + (y - line.base[1]) * across[1]) / apart,
    );

    const first = Math.ceil(Math.min(...reach) - 1e-9);
    const last = Math.floor(Math.max(...reach) + 1e-9);
    const period = line.dashes.reduce((sum, d) => sum + Math.abs(d), 0);
    const repeatCost = 1 + Math.floor(line.dashes.length / 32);

    for (let k = first; k <= last; k++) {
      if (!step(lineCost)) return;
      const origin: Point = [line.base[0] + k * line.offset[0], line.base[1] + k * line.offset[1]];

      const off = ([x, y]: Point): number =>
        (x - origin[0]) * across[0] + (y - origin[1]) * across[1];

      const at = ([x, y]: Point): number => (x - origin[0]) * along[0] + (y - origin[1]) * along[1];
      // Where the line crosses each side, as a distance along it from its origin. An end on the
      // line counts as below it, so that the two sides that meet there count it once between them.
      const crossings: number[] = [];
      // The stretches of the line that straight sides lie along, which it draws nothing on.
      const runs: [number, number][] = [];

      for (const { side, arc } of sides) {
        const sp = off(side.from);
        const sq = off(side.to);

        if (!arc) {
          if (Math.abs(sp) <= tiny && Math.abs(sq) <= tiny) {
            const [tp, tq] = [at(side.from), at(side.to)];

            if (Math.abs(tq - tp) > tiny) runs.push([Math.min(tp, tq), Math.max(tp, tq)]);
          }

          if (sp > 0 === sq > 0) continue;
          const t = sp / (sp - sq);
          crossings.push(
            at([
              side.from[0] + (side.to[0] - side.from[0]) * t,
              side.from[1] + (side.to[1] - side.from[1]) * t,
            ]),
          );
          continue;
        }

        // The arc's circle meets the line where its center lies less than its radius off it. Along
        // the arc, from its start, through each meeting inside its sweep, to its end, the line is
        // crossed wherever the side of it the arc is on changes, as for a straight side.
        const sweep = Math.abs(arc.sweep);

        const arcAt = (u: number): Point => {
          const angle = arc.start + Math.sign(arc.sweep) * u;

          return [
            arc.center[0] + arc.radius * Math.cos(angle),
            arc.center[1] + arc.radius * Math.sin(angle),
          ];
        };

        const meetings: number[] = [];
        const centerOff = off(arc.center);

        if (Math.abs(centerOff) < arc.radius) {
          const facing = Math.atan2(across[1], across[0]);
          const turn = Math.acos(-centerOff / arc.radius);

          for (const angle of [facing + turn, facing - turn]) {
            const from = arc.sweep > 0 ? angle - arc.start : arc.start - angle;
            const u = ((from % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

            if (u > 0 && u < sweep) meetings.push(u);
          }

          meetings.sort((m, n) => m - n);
        }

        const events = [0, ...meetings, sweep];
        let above = sp > 0;

        for (let e = 0; e + 1 < events.length; e++) {
          // The side between two meetings, where it lies furthest off the line: a tangent touches
          // it at one point, which is no crossing.
          const [a, b] = [events[e]!, events[e + 1]!];
          let most = 0;

          for (const f of [0.25, 0.5, 0.75]) {
            const d = off(arcAt(a + (b - a) * f));

            if (Math.abs(d) > Math.abs(most)) most = d;
          }

          const inside = most > 0;

          if (inside !== above) crossings.push(e === 0 ? at(side.from) : at(arcAt(events[e]!)));
          above = inside;
        }

        if (sq > 0 !== above) crossings.push(at(side.to));
      }

      crossings.sort((m, n) => m - n);

      if (!step(1 + Math.floor((crossings.length + runs.length) / 8))) return;
      // The stretches inside the loops, less the runs along a side: the runs sorted and joined
      // where they overlap, then both walked once together.
      runs.sort((m, n) => m[0] - n[0]);
      const joined: [number, number][] = [];

      for (const run of runs) {
        const last = joined.at(-1);

        if (last && run[0] <= last[1]) last[1] = Math.max(last[1], run[1]);
        else joined.push([run[0], run[1]]);
      }

      const stretches: [number, number][] = [];
      let r = 0;

      for (let i = 0; i + 1 < crossings.length; i += 2) {
        let from = crossings[i]!;
        const to = crossings[i + 1]!;

        while (r < joined.length && joined[r]![1] <= from) r++;

        for (let q = r; q < joined.length && joined[q]![0] < to && from < to; q++) {
          const [a, b] = joined[q]!;

          if (a > from) stretches.push([from, a]);

          if (b > from) from = b;
        }

        if (from < to) stretches.push([from, to]);
      }

      const point = (t: number): Point => [origin[0] + along[0] * t, origin[1] + along[1] * t];

      for (const [from, to] of stretches) {
        if (period === 0) {
          if (!piece(point(from), point(to))) return;
          continue;
        }

        // The dashes from the pattern's start before `from` on, up to `to`.
        let t = Math.floor(from / period) * period;

        while (t <= to) {
          if (!step(repeatCost)) return;

          for (const dash of line.dashes) {
            const end = t + Math.abs(dash);

            // A dash that only touches the stretch draws nothing there. A dot draws inside it and
            // at its far end, not at its near one, as the leading CAD app draws them.
            const drawn =
              dash > 0
                ? end > from + tiny && t < to - tiny
                : dash === 0 && t > from + tiny && t <= to + tiny;

            if (drawn && !piece(point(Math.max(t, from)), point(Math.min(end, to)))) return;
            t = end;
          }
        }
      }
    }
  }
}
