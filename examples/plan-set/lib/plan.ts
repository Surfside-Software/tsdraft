// Draws a floor plan of a level at an origin in model space: the walls as their clean outline,
// openings, doors, windows, stairs and fixtures, and, for an architectural sheet, the tags and
// the dimension strings.
import type { Point } from "../../../src/index.ts";
import {
  ATTIC_ACCESS,
  ENTRY,
  GARAGE_STEPS,
  HEIGHTS,
  LANAI,
  LANAI_SLAB,
  POWDER,
  STAIR,
  WINDOW_MARKS,
  type Level,
  type Opening,
  type Rect,
} from "../model/house.ts";
import { dimString, ftIn, H, LAYERS, put, type D, type View } from "./kit.ts";

export interface PlanLayers {
  wall: string;
  low: string;
  door: string;
  glaz: string;
  fixt: string;
  stair: string;
  ovhd: string;
}

export const ARCH_LAYERS: PlanLayers = {
  wall: LAYERS.wall,
  low: LAYERS.wallLow,
  door: LAYERS.door,
  glaz: LAYERS.glaz,
  fixt: LAYERS.fixt,
  stair: LAYERS.stair,
  ovhd: LAYERS.ovhd,
};

/** Every layer the base plan under the MEP and framing sheets: one gray layer. */
export const BASE_LAYERS = (layer: string): PlanLayers => ({
  wall: layer,
  low: layer,
  door: layer,
  glaz: layer,
  fixt: layer,
  stair: layer,
  ovhd: layer,
});

const inside = (r: Rect, x: number, y: number) => x > r[0] && x < r[2] && y > r[1] && y < r[3];

/**
 * The outline of the union of wall rectangles, less the cuts, as lines merged along each run.
 * The walls are axis-aligned, so a grid of every x and y they hold decides each cell.
 */
export function wallOutline(walls: readonly Rect[], cuts: readonly Rect[]): [Point, Point][] {
  const xs = [...new Set([...walls, ...cuts].flatMap((r) => [r[0], r[2]]))].sort((a, b) => a - b);
  const ys = [...new Set([...walls, ...cuts].flatMap((r) => [r[1], r[3]]))].sort((a, b) => a - b);
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const filled: boolean[][] = [];
  for (let i = 0; i < nx; i++) {
    filled.push([]);
    for (let j = 0; j < ny; j++) {
      const cx = (xs[i]! + xs[i + 1]!) / 2;
      const cy = (ys[j]! + ys[j + 1]!) / 2;
      filled[i]!.push(walls.some((r) => inside(r, cx, cy)) && !cuts.some((r) => inside(r, cx, cy)));
    }
  }
  const at = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && filled[i]![j]!;
  const lines: [Point, Point][] = [];
  // Horizontal edges.
  for (let j = 0; j <= ny; j++) {
    let start: number | undefined;
    for (let i = 0; i <= nx; i++) {
      const edge = i < nx && at(i, j - 1) !== at(i, j);
      if (edge && start === undefined) start = i;
      if (!edge && start !== undefined) {
        lines.push([
          [xs[start]!, ys[j]!],
          [xs[i]!, ys[j]!],
        ]);
        start = undefined;
      }
    }
  }
  for (let i = 0; i <= nx; i++) {
    let start: number | undefined;
    for (let j = 0; j <= ny; j++) {
      const edge = j < ny && at(i - 1, j) !== at(i, j);
      if (edge && start === undefined) start = j;
      if (!edge && start !== undefined) {
        lines.push([
          [xs[i]!, ys[start]!],
          [xs[i]!, ys[j]!],
        ]);
        start = undefined;
      }
    }
  }
  return lines;
}

/** Whether an opening's wall runs along x. */
export const alongX = (o: Opening) => o.cut[2] - o.cut[0] > o.cut[3] - o.cut[1];
export const openingWidth = (o: Opening) => (alongX(o) ? o.cut[2] - o.cut[0] : o.cut[3] - o.cut[1]);
export const openingCenter = (o: Opening): Point => [
  (o.cut[0] + o.cut[2]) / 2,
  (o.cut[1] + o.cut[3]) / 2,
];

/** Draws one door leaf and its swing. */
function leaf(d: D, o: Opening, hinge: "start" | "end", w: number, from: number): void {
  const [x0, y0, x1, y1] = o.cut;
  const s = o.swing ?? 1;
  if (alongX(o)) {
    const y = s > 0 ? y1 : y0;
    const hx = hinge === "start" ? from : from;
    const dir = hinge === "start" ? 1 : -1;
    d.line([hx, y], [hx, y + s * w]);
    const a0 = s > 0 ? (dir > 0 ? 0 : 90) : dir > 0 ? 270 : 180;
    d.arc([hx, y], w, a0, a0 + 90);
    void x0;
    void x1;
  } else {
    const x = s > 0 ? x1 : x0;
    const hy = from;
    const dir = hinge === "start" ? 1 : -1;
    d.line([x, hy], [x + s * w, hy]);
    const a0 = s > 0 ? (dir > 0 ? 0 : 270) : dir > 0 ? 90 : 180;
    d.arc([x, hy], w, a0, a0 + 90);
  }
}

/** Draws an opening's door or window in its cut. */
function opening(d: D, o: Opening, L: PlanLayers): void {
  const [x0, y0, x1, y1] = o.cut;
  const ax = alongX(o);
  const w = openingWidth(o);
  const start = ax ? x0 : y0;
  const end = ax ? x1 : y1;
  const mid = ax ? (y0 + y1) / 2 : (x0 + x1) / 2;
  const seg = (a: number, c: number, b: number, c2 = c): [Point, Point] =>
    ax
      ? [
          [a, c],
          [b, c2],
        ]
      : [
          [c, a],
          [c2, b],
        ];
  switch (o.kind) {
    case "window": {
      d.layer(L.glaz, {}, () => {
        const lo = ax ? y0 : x0;
        const hi = ax ? y1 : x1;
        for (const c of [lo, hi, mid - 0.75, mid + 0.75]) d.line(...seg(start, c, end));
      });
      return;
    }
    case "door":
      d.layer(L.door, {}, () => leaf(d, o, o.hinge ?? "start", w, o.hinge === "end" ? end : start));
      return;
    case "double":
      d.layer(L.door, {}, () => {
        leaf(d, o, "start", w / 2, start);
        leaf(d, o, "end", w / 2, end);
      });
      return;
    case "slider":
      d.layer(L.door, {}, () => {
        // Four panels, two fixed outside and two that slide inside them.
        const q = w / 4;
        for (let k = 0; k < 4; k++) {
          const c = mid + (k === 1 || k === 2 ? -1.25 : 1.25);
          d.line(...seg(start + k * q, c, start + (k + 1) * q + (k < 3 ? 2 : 0)));
        }
      });
      d.layer(L.glaz, {}, () => {
        d.line(...seg(start, ax ? y0 : x0, end));
        d.line(...seg(start, ax ? y1 : x1, end));
      });
      return;
    case "overhead":
      d.layer(L.door, {}, () => {
        d.line(...seg(start, ax ? y1 - 1 : x1 - 1, end));
        d.line(...seg(start, ax ? y1 - 2.5 : x1 - 2.5, end));
      });
      d.layer(L.ovhd, {}, () => {
        // The door's tracks overhead, back to its opener.
        d.line(...seg(start, ax ? y1 : x1, start, ax ? y1 + 108 : x1 + 108));
        d.line(...seg(end, ax ? y1 : x1, end, ax ? y1 + 108 : x1 + 108));
      });
      return;
    case "bifold":
      d.layer(L.door, {}, () => {
        const n = 4;
        const q = w / n;
        const pts: Point[] = [];
        for (let k = 0; k <= n; k++) {
          const a = start + k * q;
          const c = (ax ? y1 : x1) + (k % 2 === 1 ? 6 : 0);
          pts.push(ax ? [a, c] : [c, a]);
        }
        d.polyline(pts);
      });
      return;
    case "cased":
      d.layer(L.ovhd, {}, () => {
        d.line(...seg(start, mid, end));
      });
      return;
  }
}

type Xf = (p: Point) => Point;
const xf = (at: Point, rot: number): Xf => {
  const t = (rot * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return ([x, y]) => [at[0] + x * c - y * s, at[1] + x * s + y * c];
};
const ring = (f: Xf, cx: number, cy: number, rx: number, ry: number, n = 20): Point[] => {
  const pts: Point[] = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    pts.push(f([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]));
  }
  return pts;
};
const box = (d: D, f: Xf, x0: number, y0: number, x1: number, y1: number) =>
  d.polyline([f([x0, y0]), f([x1, y0]), f([x1, y1]), f([x0, y1])], true);

/** Fixtures, each drawn from its back edge at `at`, facing the room at `rot` degrees. */
export const FIXTURES = {
  toilet(d: D, at: Point, rot: number) {
    const f = xf(at, rot);
    box(d, f, -10, 0, 10, 8);
    d.polyline(ring(f, 0, 18, 7.5, 10), true);
  },
  lav(d: D, at: Point, rot: number, width = 36) {
    const f = xf(at, rot);
    box(d, f, -width / 2, 0, width / 2, 22);
    d.polyline(ring(f, 0, 11, 8, 6), true);
  },
  doubleLav(d: D, at: Point, rot: number, width = 72) {
    const f = xf(at, rot);
    box(d, f, -width / 2, 0, width / 2, 22);
    d.polyline(ring(f, -width / 4, 11, 8, 6), true);
    d.polyline(ring(f, width / 4, 11, 8, 6), true);
  },
  tub(d: D, at: Point, rot: number) {
    const f = xf(at, rot);
    box(d, f, -30, 0, 30, 32);
    d.polyline(ring(f, 0, 16, 26, 12, 28), true);
  },
  shower(d: D, at: Point, rot: number, w = 48, depth = 42) {
    const f = xf(at, rot);
    box(d, f, -w / 2, 0, w / 2, depth);
    d.line(f([-w / 2, 0]), f([w / 2, depth]));
    d.line(f([w / 2, 0]), f([-w / 2, depth]));
    d.circle(f([0, depth / 2]), 2);
  },
  counter(d: D, x0: number, y0: number, x1: number, y1: number) {
    d.rect([x0, y0], x1 - x0, y1 - y0);
  },
  sink(d: D, at: Point, rot: number) {
    const f = xf(at, rot);
    box(d, f, -16, 3, -1, 19);
    box(d, f, 1, 3, 16, 19);
  },
  range(d: D, at: Point, rot: number) {
    const f = xf(at, rot);
    box(d, f, -15, 0, 15, 24);
    for (const [x, y] of [
      [-7, 7],
      [7, 7],
      [-7, 17],
      [7, 17],
    ] as const)
      d.circle(f([x, y]), 4);
  },
  fridge(d: D, at: Point, rot: number) {
    const f = xf(at, rot);
    box(d, f, -18, 0, 18, 30);
    d.line(f([-18, 30]), f([18, 0]));
  },
  washerDryer(d: D, at: Point, rot: number) {
    const f = xf(at, rot);
    box(d, f, -28, 0, -1, 27);
    box(d, f, 1, 0, 28, 27);
    d.circle(f([-14.5, 13.5]), 10);
  },
  waterHeater(d: D, at: Point) {
    d.circle(at, 11);
  },
};

/** The stairs: 16 treads of 10" from `y0` going north, with the cut and the arrow. */
function stairs(d: D, level: "L1" | "L2", L: PlanLayers): void {
  const { x0, x1, y0, treads } = STAIR;
  const run = STAIR.tread;
  d.layer(L.stair, {}, () => {
    for (let k = 0; k <= treads; k++) {
      const y = y0 + k * run;
      if (level === "L1" && k > 9) continue;
      d.line([x0, y], [x1, y]);
    }
    // The handrail and the arrow up the run.
    d.line([x0 + 3, y0], [x0 + 3, y0 + treads * run]);
    const mid = (x0 + x1) / 2;
    if (level === "L1") {
      d.line([x0, y0 + 9.6 * run], [x1, y0 + 8.4 * run]);
      d.polyline([
        [mid, y0 + 6],
        [mid, y0 + 8.4 * run],
      ]);
    } else {
      d.polyline([
        [mid, y0 + treads * run - 6],
        [mid, y0 + 6],
      ]);
    }
  });
  if (level === "L1") {
    d.layer(L.ovhd, {}, () => {
      for (let k = 10; k <= treads; k++) d.line([x0, y0 + k * run], [x1, y0 + k * run]);
    });
  }
}

/** The fixtures of a level. */
function fixtures(d: D, level: "L1" | "L2", L: PlanLayers): void {
  d.layer(L.fixt, {}, () => {
    if (level === "L1") {
      // Kitchen: counters on the north and west walls, the island, the sink under the window.
      // The west counter stops short of doors 105 and 107; the fridge stands past door 107.
      FIXTURES.counter(d, 172.5, 496, 379.5, 520);
      FIXTURES.counter(d, 136.5, 354, 160.5, 434);
      FIXTURES.counter(d, 204, 384, 312, 426);
      FIXTURES.sink(d, [252, 520], 180);
      FIXTURES.range(d, [136.5, 394], -90);
      FIXTURES.fridge(d, [136.5, 494], -90);
      // Laundry, powder and the water heater in the garage.
      FIXTURES.washerDryer(d, [70, 408], 180);
      // Powder room: the water closet's centerline 20" from the north wall and 15" from the
      // vanity south of it, with 36" clear in front (FBC-R P2705.1).
      FIXTURES.toilet(d, [8, POWDER.wc], -90);
      FIXTURES.lav(d, [8, POWDER.vanity], -90, 30);
      FIXTURES.waterHeater(d, [240, 262]);
    } else {
      // Bath 2.
      FIXTURES.tub(d, [141, 312], 180);
      FIXTURES.toilet(d, [80, 240], -90);
      FIXTURES.lav(d, [141, 208.5], 0, 48);
      // Owner's bath.
      FIXTURES.doubleLav(d, [501, 168], 180, 96);
      FIXTURES.shower(d, [570, 6], 0, 84, 48);
      FIXTURES.tub(d, [430, 6], 0);
      FIXTURES.toilet(d, [618, 120], 90);
    }
  });
}

/** Draws a level's plan at `origin`. */
export function drawPlan(
  d: D,
  origin: Point,
  level: Level,
  L: PlanLayers,
  which: "L1" | "L2",
): void {
  const o = (p: Point): Point => [origin[0] + p[0], origin[1] + p[1]];
  const shift = (r: Rect): Rect => [
    r[0] + origin[0],
    r[1] + origin[1],
    r[2] + origin[0],
    r[3] + origin[1],
  ];
  const walls = level.walls.map(shift);
  const cuts = level.openings.map((x) => shift(x.cut));
  d.layer(L.wall, {}, () => {
    for (const [a, b] of wallOutline(walls, cuts)) d.line(a, b);
  });
  d.layer(L.low, {}, () => {
    for (const [a, b] of wallOutline(level.low.map(shift), [])) d.line(a, b);
  });
  for (const op of level.openings) opening(d, { ...op, cut: shift(op.cut) }, L);
  // Draw the fixtures and stairs at the origin by shifting through a temporary builder view.
  const shifted = shiftBuilder(d, origin);
  stairs(shifted, which, L);
  fixtures(shifted, which, L);
  if (which === "L1") extras(d, origin, L);
  if (which === "L2") {
    d.layer(L.ovhd, {}, () => {
      const [a0, b0, a1, b1] = shift(ATTIC_ACCESS);
      d.rect([a0, b0], a1 - a0, b1 - b0);
      d.line([a0, b0], [a1, b1]);
      d.line([a0, b1], [a1, b0]);
    });
  }
  if (which === "L1") {
    d.layer(L.wall, {}, () => {
      // The lanai's slab edge and its columns.
      const [x0, y0, x1, y1] = shift(LANAI);
      d.polyline([
        [x0, y0],
        [x0, y1],
        [x1, y1],
        [x1, y0],
      ]);
      for (const cx of [x0, x1 - 12]) d.rect([cx, y1 - 12], 12, 12);
    });
    d.layer(L.ovhd, {}, () => {
      // The beam over the porch, and the lanai's beam.
      d.line(o([272, 4]), o([376, 4]));
      const [x0, , x1, y1] = shift(LANAI);
      d.line([x0, y1 - 6], [x1, y1 - 6]);
    });
  }
}

/** The first floor's steps, guards and flood vents, all from the model. */
function extras(d: D, origin: Point, L: PlanLayers): void {
  const o = (p: Point): Point => [origin[0] + p[0], origin[1] + p[1]];
  d.layer(L.stair, {}, () => {
    // Garage steps at door 103: the landing's edge, the treads and a handrail on the west.
    const g = GARAGE_STEPS;
    const edge = g.top - g.landing;
    for (let k = 0; k < g.risers; k++)
      d.line(o([g.x0, edge - k * g.tread]), o([g.x1, edge - k * g.tread]));
    d.line(o([g.x0, g.top]), o([g.x0, edge - (g.risers - 1) * g.tread]));
    d.line(o([g.x1, g.top]), o([g.x1, edge - (g.risers - 1) * g.tread]));
    d.line(o([g.x1 - 2, g.top - 6]), o([g.x1 - 2, edge - (g.risers - 1) * g.tread]));
    // The front entry stair, south of the porch, with a handrail each side.
    const e = ENTRY;
    const treads = e.risers - 1;
    for (let k = 0; k <= treads; k++) d.line(o([e.x0, -k * e.tread]), o([e.x1, -k * e.tread]));
    for (const x of [e.x0, e.x1]) d.line(o([x, 0]), o([x, -treads * e.tread]));
    for (const x of [e.x0 + 2, e.x1 - 2]) d.line(o([x, 6]), o([x, -treads * e.tread - 12]));
    // Lanai steps down to the pool deck.
    const ls = LANAI_SLAB.steps;
    const top = LANAI[3];
    const lt = ls.risers - 1;
    for (let k = 0; k <= lt; k++)
      d.line(o([ls.x0, top + k * ls.tread]), o([ls.x1, top + k * ls.tread]));
    for (const x of [ls.x0, ls.x1]) d.line(o([x, top]), o([x, top + lt * ls.tread]));
    for (const x of [ls.x0 + 2, ls.x1 - 2])
      d.line(o([x, top - 6]), o([x, top + lt * ls.tread + 12]));
  });
  d.layer(L.low, {}, () => {
    // 36" guards at the porch's open edge, each side of the stair, and on the lanai's open sides.
    // Each guard is drawn as the legend shows it, two lines 2" apart, and returns to the
    // stair's handrails.
    for (const [a, b] of [
      [272, ENTRY.x0 + 2],
      [ENTRY.x1 - 2, 376],
    ] as const)
      d.rect(o([a, 0]), b - a, 2);
    const [x0, y0, x1, y1] = LANAI;
    d.rect(o([x0, y0]), 2, y1 - y0);
    d.rect(o([x1 - 2, y0]), 2, y1 - y0);
    d.rect(o([x0, y1 - 2]), LANAI_SLAB.steps.x0 + 2 - x0, 2);
    d.rect(o([LANAI_SLAB.steps.x1 - 2, y1 - 2]), x1 - LANAI_SLAB.steps.x1 + 2, 2);
  });
}

/**
 * A builder whose drawing calls are shifted by `origin`. Only the calls the fixtures and the
 * stairs use are wrapped.
 */
function shiftBuilder(d: D, origin: Point): D {
  const s = (p: Point): Point => [p[0] + origin[0], p[1] + origin[1]];
  const proxy = Object.create(d) as D;
  Object.assign(proxy, {
    line: (a: Point, b: Point, opts?: object) => d.line(s(a), s(b), opts as never),
    polyline: (pts: Point[], closed?: boolean, opts?: object) =>
      d.polyline(pts.map(s), closed, opts as never),
    rect: (at: Point, w: number, h: number, opts?: object) => d.rect(s(at), w, h, opts as never),
    circle: (c: Point, r: number, opts?: object) => d.circle(s(c), r, opts as never),
    arc: (c: Point, r: number, a0: number, a1: number, opts?: object) =>
      d.arc(s(c), r, a0, a1, opts as never),
    layer: (name: string, opts: object, draw?: () => void) =>
      d.layer(name as never, opts as never, draw),
  });
  return proxy;
}

/** Tags of rooms, doors and windows, sized for view `v`. */
export function planTags(d: D, origin: Point, level: Level, v: View): void {
  const o = (p: Point): Point => [origin[0] + p[0], origin[1] + p[1]];
  d.layer(LAYERS.tags, {}, () => {
    for (const room of level.rooms) {
      const [x0, y0, x1, y1] = room.rect;
      const at = room.tagAt ?? [(x0 + x1) / 2, (y0 + y1) / 2];
      const area = Math.round(room.area ?? ((x1 - x0) * (y1 - y0)) / 144);
      const small = x1 - x0 < 80 || y1 - y0 < 60;
      d.insert("ROOM TAG", o(at), {
        scale: v.p(1),
        attributes: {
          ROOM: room.name,
          AREA: small ? "" : room.ceiling ? `${area} SF  |  ${room.ceiling}` : `${area} SF`,
        },
      });
    }
    for (const op of level.openings) {
      if (!op.tag) continue;
      const [cx, cy] = openingCenter(op);
      const ax = alongX(op);
      // A tag sits off the wall on the inside of the opening's swing, or on the room side.
      const off = v.p(0.3);
      const sideX = cx > 312 ? -1 : 1;
      const sideY = cy > 264 ? -1 : 1;
      const at: Point = ax
        ? [cx, cy + (op.tagSide ?? sideY) * off]
        : [cx + (op.tagSide ?? sideX) * off, cy];
      if (op.kind === "window") {
        d.insert("WINDOW TAG", o(at), { scale: v.p(1), attributes: { WINDOW: op.tag } });
        const mark = WINDOW_MARKS.get(op);
        if (mark)
          put(d, [o(at)[0], o(at)[1] - v.p(0.17)], mark, v.p(H.small), {
            align: "center",
            valign: "top",
          });
      } else d.insert("DOOR TAG", o(at), { scale: v.p(1), attributes: { DOOR: op.tag } });
    }
  });
}

/** The exterior dimension strings of a level: openings, jogs and overall, on all four sides. */
export function planDims(
  d: D,
  origin: Point,
  level: Level,
  v: View,
  sides: readonly ("S" | "N" | "E" | "W")[] = ["S", "N", "E", "W"],
): void {
  const o = (p: Point): Point => [origin[0] + p[0], origin[1] + p[1]];
  const ext = level.openings.filter((x) => x.exterior);
  const gap = v.p(0.375);
  const first = v.p(0.75);
  const xMax = 624;
  const yMax = level.name === "FIRST FLOOR" ? 528 : 528;
  d.layer(LAYERS.dims, {}, () => {
    for (const side of sides) {
      const horizontal = side === "S" || side === "N";
      const faceY = side === "S" ? 0 : yMax;
      const faceX = side === "W" ? 0 : xMax;
      const onFace = ext.filter((x) =>
        horizontal
          ? alongX(x) && (side === "S" ? x.cut[1] < 100 : x.cut[3] > yMax - 20)
          : !alongX(x) && (side === "W" ? x.cut[0] < 20 : x.cut[2] > xMax - 20),
      );
      const centers = onFace.map((x) => (horizontal ? openingCenter(x)[0] : openingCenter(x)[1]));
      const ends = horizontal ? [0, xMax] : [0, yMax];
      const jogs = horizontal && side === "S" && level.name === "FIRST FLOOR" ? [264, 376] : [];
      const dir = side === "S" || side === "W" ? -1 : 1;
      const line = (k: number) => (horizontal ? faceY : faceX) + dir * (first + gap * k);
      const pts = (values: number[]): Point[] =>
        values.map((a) => o(horizontal ? [a, faceY] : [faceX, a]));
      const strings = [
        [...ends, ...jogs, ...centers].sort((a, b) => a - b),
        ...(jogs.length ? [[...ends, ...jogs].sort((a, b) => a - b)] : []),
        ends,
      ];
      strings.forEach((values, k) => {
        const at = horizontal ? origin[1] + line(k) : origin[0] + line(k);
        dimString(d, v, pts(values), horizontal ? "x" : "y", at);
      });
    }
  });
}

/** Writes an elevation label for a plan note, such as "F.F.E. 11.00' NAVD". */
export const navd = (feet: number) => `${feet.toFixed(2)}' NAVD`;
export { ftIn, H, put };
export const plateNote = () => `PLATE HT. ${ftIn(HEIGHTS.l1Plate)}`;
