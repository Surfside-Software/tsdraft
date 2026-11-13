// E-101: the power and lighting plans of both floors at 3/16" = 1'-0", over a screened base
// plan, with the legend, the panel schedule, the load calculation and the notes, all from the
// circuits and devices in `mep-power.ts`.
import type { Point } from "../../../src/index.ts";
import { L1, L2, type Level } from "../model/house.ts";
import { frame } from "../lib/frame.ts";
import { arrowhead } from "../../lib/drafting.ts";
import {
  AREA,
  H,
  LAYERS,
  noteColumn,
  put,
  table,
  view,
  viewport,
  width,
  type D,
  type View,
} from "../lib/kit.ts";
import { BASE_LAYERS, drawPlan } from "../lib/plan.ts";
import {
  CIRCUITS,
  circuit,
  circuitLoads,
  DEVICES,
  isLight,
  isReceptacle,
  isSwitch,
  loadCalc,
  PANEL,
  PANEL_AT,
  WIRE,
  type Device,
  type Floor,
} from "./mep-power.ts";
import { center, EQUIP } from "./mep-equip.ts";

export const E_ORIGIN: Record<Floor, Point> = { L1: [310000, 0], L2: [350000, 0] };

const LEVELS: Record<Floor, Level> = { L1, L2 };

/** An arc from `a` to `b` that bows to the left of a to b by `bulge` of the chord. */
function arcBetween(
  d: D,
  a: Point,
  b: Point,
  bulge: number,
  trim: number,
  linetype?: string,
  maxSag = Infinity,
): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const c0 = Math.hypot(dx, dy);
  if (c0 - 2 * trim <= c0 * 0.05) return;
  const ux = dx / c0;
  const uy = dy / c0;
  const p: Point = [a[0] + ux * trim, a[1] + uy * trim];
  const q: Point = [b[0] - ux * trim, b[1] - uy * trim];
  const c = c0 - 2 * trim;
  const s = Math.min(bulge * c, maxSag);
  const r = (c * c) / 4 / (2 * s) + s / 2;
  const mx = (p[0] + q[0]) / 2;
  const my = (p[1] + q[1]) / 2;
  const nx = -uy;
  const ny = ux;
  const center: Point = [mx - nx * (r - s), my - ny * (r - s)];
  const ang = (pt: Point) => (Math.atan2(pt[1] - center[1], pt[0] - center[0]) * 180) / Math.PI;
  d.arc(center, r, ang(q), ang(p), linetype ? { linetype } : {});
}

/** The longest jump between two outlets drawn as one run of a circuit, in inches: 25 ft. */
const JUMP = 300;

/** Splits items into groups whose members are within `jump` of another member. */
function clusters<T extends { at: Point }>(items: readonly T[], jump: number): T[][] {
  const out: T[][] = [];
  const left = [...items];
  while (left.length) {
    const group = [left.shift()!];
    for (let k = 0; k < group.length; k++) {
      for (let j = left.length - 1; j >= 0; j--) {
        const a = group[k]!.at;
        const b = left[j]!.at;
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= jump) group.push(...left.splice(j, 1));
      }
    }
    out.push(group);
  }
  return out;
}

/** The shortest tree joining the items, grown from `root` (Prim). Each edge is [from, to]. */
function spanningTree<T extends { at: Point }>(items: readonly T[], root: T): [Point, Point][] {
  const inTree = [root];
  const left = items.filter((x) => x !== root);
  const edges: [Point, Point][] = [];
  while (left.length) {
    let best: [number, number] = [0, 0];
    let bestD = Infinity;
    inTree.forEach((a, i) =>
      left.forEach((b, j) => {
        const dd = Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]);
        if (dd < bestD) {
          bestD = dd;
          best = [i, j];
        }
      }),
    );
    const b = left.splice(best[1], 1)[0]!;
    edges.push([inTree[best[0]]!.at, b.at]);
    inTree.push(b);
  }
  return edges;
}

/** Orders points as a path by nearest neighbour, from the first. */
function chain<T extends { at: Point }>(items: readonly T[], from: Point): T[] {
  const left = [...items];
  const out: T[] = [];
  let here = from;
  while (left.length) {
    let best = 0;
    let bestD = Infinity;
    left.forEach((x, k) => {
      const dd = Math.hypot(x.at[0] - here[0], x.at[1] - here[1]);
      if (dd < bestD) {
        bestD = dd;
        best = k;
      }
    });
    const next = left.splice(best, 1)[0]!;
    out.push(next);
    here = next.at;
  }
  return out;
}

/** A box in model space: x0, y0, x1, y1. */
type Box = [number, number, number, number];
const hits = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
/** The box a text fills, from `measureText` by way of `width`. */
const textBox = (
  at: Point,
  value: string,
  h: number,
  paperH: number,
  align: "left" | "right" | "center",
): Box => {
  const w = (width(value, paperH) * h) / paperH;
  const x0 = align === "left" ? at[0] : align === "right" ? at[0] - w : at[0] - w / 2;
  return [x0, at[1], x0 + w, at[1] + h];
};

const layerOf = (dv: Device) =>
  isReceptacle(dv.block) || dv.block === "E-220" || dv.block === "E-PANEL" || dv.block === "E-DISC"
    ? LAYERS.powr
    : LAYERS.lite;

/** Where a room's name goes when the bottom of the room is taken by devices. */
const ROOM_NAME_AT: Record<string, Point> = { "L1/FOYER": [349, 140], "L2/BATH 2": [110, 220] };

/**
 * Low-voltage outlets, which the kit has no symbols for: a TV/data outlet (a triangle) and a
 * doorbell button and chime. Defined here, in paper inches like the kit's symbols, by `e101`,
 * which runs once per drawing.
 */
const LOW_VOLTAGE: { block: string; floor: Floor; at: Point; rot: number }[] = [
  { block: "E-TVDATA", floor: "L1", at: [610, 360], rot: 90 },
  { block: "E-TVDATA", floor: "L1", at: [610, 100], rot: 90 },
  { block: "E-TVDATA", floor: "L2", at: [12, 105], rot: -90 },
  { block: "E-TVDATA", floor: "L2", at: [12, 400], rot: -90 },
  { block: "E-TVDATA", floor: "L2", at: [612, 395], rot: 90 },
  { block: "E-TVDATA", floor: "L2", at: [374, 400], rot: 90 },
  { block: "E-BELL", floor: "L1", at: [372, 66], rot: 0 },
  { block: "E-CHIME", floor: "L1", at: [349, 278], rot: 0 },
];

function defineLowVoltage(d: D): void {
  d.block("E-TVDATA", {}, () => {
    d.polyline(
      [
        [-0.08, 0],
        [0.08, 0],
        [0, 0.12],
      ],
      true,
    );
    d.line([0, 0], [0, 0.12]);
  });
  d.block("E-BELL", {}, () => {
    d.circle([0, 0], 0.05);
    d.circle([0, 0], 0.02);
  });
  d.block("E-CHIME", {}, () => {
    d.rect([-0.08, -0.05], 0.16, 0.1);
    d.text([0, 0], "CH", { height: 0.05, style: "NOTES", align: "center", valign: "middle" });
  });
}

/** One floor's power and lighting plan, in model space at its origin. */
function powerPlan(d: D, v: View, floor: Floor): void {
  const origin = E_ORIGIN[floor];
  const level = LEVELS[floor];
  const o = (p: Point): Point => [origin[0] + p[0], origin[1] + p[1]];
  drawPlan(d, origin, level, BASE_LAYERS(LAYERS.base), floor);
  // Room names, screened with the base.
  d.layer(LAYERS.base, {}, () => {
    for (const r of level.rooms) {
      const [x0, y0, x1] = r.rect;
      const at: Point = ROOM_NAME_AT[`${floor}/${r.name}`] ?? [(x0 + x1) / 2, y0 + v.p(0.12)];
      if (x1 - x0 < v.p(width(r.name, H.note) + 0.1)) continue;
      put(d, o(at), r.name, v.p(H.note), { align: "center" });
    }
  });
  const here = DEVICES.filter((x) => x.floor === floor);
  // What is already on the plan, for placing the home runs' labels clear of it.
  const taken: Box[] = here.map((dv) => {
    const r = v.p(dv.block === "E-FAN" ? 0.3 : 0.12);
    return [o(dv.at)[0] - r, o(dv.at)[1] - r, o(dv.at)[0] + r, o(dv.at)[1] + r];
  });
  for (const x of LOW_VOLTAGE.filter((y) => y.floor === floor)) {
    const [cx, cy] = o(x.at);
    taken.push([cx - v.p(0.12), cy - v.p(0.12), cx + v.p(0.12), cy + v.p(0.12)]);
  }
  for (const r of level.rooms) {
    const [x0, y0, x1] = r.rect;
    const at = ROOM_NAME_AT[`${floor}/${r.name}`] ?? [(x0 + x1) / 2, y0 + v.p(0.12)];
    taken.push(textBox(o(at), r.name, v.p(H.note), H.note, "center"));
  }
  // The symbols.
  for (const dv of here) {
    d.layer(layerOf(dv), {}, () => {
      d.insert(dv.block, o(dv.at), { scale: v.p(1), rotation: dv.rot });
    });
  }
  // Low-voltage outlets.
  d.layer(LAYERS.eAnno, {}, () => {
    for (const x of LOW_VOLTAGE.filter((y) => y.floor === floor))
      d.insert(x.block, o(x.at), { scale: v.p(1), rotation: x.rot });
  });
  // Tags beside the symbols: a switch's letter, WP, DW and so on.
  d.layer(LAYERS.eAnno, {}, () => {
    for (const dv of here) {
      if (!dv.tag) continue;
      const small = v.p(H.small);
      if (isSwitch(dv.block)) {
        put(d, o([dv.at[0] + v.p(0.07), dv.at[1] + v.p(0.03)]), dv.tag, small);
        continue;
      }
      const side =
        dv.rot === 90 || dv.rot === -90 ? [v.p(0.13), -v.p(0.03)] : [v.p(0.12), v.p(0.06)];
      const at = o([dv.at[0] + side[0]!, dv.at[1] + side[1]!]);
      put(d, at, dv.tag, small);
      taken.push(textBox(at, dv.tag, small, H.small, "left"));
    }
    // Every light's switch letter, beside the fixture, as an electrician reads a plan.
    for (const dv of here) {
      if (!isLight(dv.block) || !dv.group || dv.group.length > 2) continue;
      put(d, o([dv.at[0] + v.p(0.1), dv.at[1] - v.p(0.16)]), dv.group, v.p(H.small));
    }
  });
  const trim = v.p(0.1);
  // Switch legs: dashed, from the first switch to each fixture of its group in turn, and between
  // the switches of a three-way.
  d.layer(LAYERS.circ, {}, () => {
    const groups = new Map<string, Device[]>();
    for (const dv of here)
      if (dv.group)
        groups.set(`${dv.ckt}/${dv.group}`, [...(groups.get(`${dv.ckt}/${dv.group}`) ?? []), dv]);
    for (const g of groups.values()) {
      const switches = g.filter((x) => isSwitch(x.block));
      const fixtures = g.filter((x) => !isSwitch(x.block) && !isReceptacle(x.block));
      const first = switches[0];
      if (!first) continue;
      let prev = first.at;
      for (const f of chain(fixtures, first.at)) {
        arcBetween(d, o(prev), o(f.at), 0.18, trim, "HIDDEN", v.p(0.14));
        prev = f.at;
      }
      for (const s of switches.slice(1))
        arcBetween(d, o(first.at), o(s.at), 0.12, trim, "HIDDEN", v.p(0.14));
    }
  });
  // Circuits: solid arcs through each circuit's outlets, and a home run toward the panel.
  d.layer(LAYERS.circ, {}, () => {
    for (const c of CIRCUITS) {
      const ds = here.filter((x) => x.ckt === c.key && x.block !== "E-PANEL");
      // A switch group joins the circuit at its first switch.
      const seen = new Set<string>();
      const nodes = ds.filter((x) => {
        if (!x.group) return true;
        if (!isSwitch(x.block) || seen.has(x.group)) return false;
        seen.add(x.group);
        return true;
      });
      if (!nodes.length) continue;
      // A circuit whose outlets lie far apart is drawn as clusters, each with its home run.
      for (const cluster of clusters(nodes, JUMP)) {
        const root = chain(cluster, PANEL_AT)[0]!;
        for (const [a, b] of spanningTree(cluster, root))
          arcBetween(d, o(a), o(b), 0.15, trim, undefined, v.p(0.12));
        homeRun(d, v, o(root.at), o(PANEL_AT), c.label, taken);
      }
    }
  });
  equipment(d, v, floor, o);
}

/**
 * A home run: a short line from the first outlet toward the panel, an arrowhead, the circuit.
 * The label takes the first of a few places round the tip that is clear of `taken`, trying a
 * longer arrow when none is.
 */
function homeRun(d: D, v: View, from: Point, panel: Point, label: string, taken: Box[]): void {
  const dx = panel[0] - from[0];
  const dy = panel[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len < v.p(0.3)) return;
  const ux = dx / len;
  const uy = dy / len;
  const h = v.p(H.small);
  const g = v.p(0.04);
  let best: { tip: Point; at: Point; align: "left" | "right"; box: Box } | undefined;
  for (const reach of [0.42, 0.6, 0.8]) {
    const tip: Point = [from[0] + ux * v.p(reach), from[1] + uy * v.p(reach)];
    const tries: [Point, "left" | "right"][] = [
      [[tip[0] + g, tip[1] + g], "left"],
      [[tip[0] - g, tip[1] + g], "right"],
      [[tip[0] + g, tip[1] - g - h], "left"],
      [[tip[0] - g, tip[1] - g - h], "right"],
    ];
    if (ux < 0) tries.unshift(tries.splice(1, 1)[0]!);
    for (const [at, align] of tries) {
      const box = textBox(at, label, h, H.small, align);
      const candidate = { tip, at, align, box };
      best ??= candidate;
      if (!taken.some((t) => hits(t, box))) {
        best = candidate;
        break;
      }
    }
    if (best && !taken.some((t) => hits(t, best!.box))) break;
    best = reach === 0.8 ? best : undefined;
  }
  const { tip, at, align, box } = best!;
  const a: Point = [from[0] + ux * v.p(0.1), from[1] + uy * v.p(0.1)];
  d.line(a, tip);
  arrowhead(d, tip, a, v.p(0.08));
  d.layer(LAYERS.eAnno, {}, () => put(d, at, label, h, { align }));
  taken.push(box);
}

/** The equipment drawn as outlines: heat pumps, air handlers, the meter, with their notes. */
function equipment(d: D, v: View, floor: Floor, o: (p: Point) => Point): void {
  const note = (at: Point, lines: string[], align: "left" | "right" = "left") =>
    d.layer(LAYERS.eAnno, {}, () =>
      lines.forEach((t, k) =>
        put(d, o([at[0], at[1] - k * v.p(H.small * 1.7)]), t, v.p(H.small), { align }),
      ),
    );
  const box = (r: readonly [number, number, number, number], linetype?: string) =>
    d.rect(o([r[0], r[1]]), r[2] - r[0], r[3] - r[1], linetype ? { linetype } : {});
  d.layer(LAYERS.powr, {}, () => {
    if (floor === "L1") {
      box(EQUIP.hp1);
      box(EQUIP.hp2);
      box(EQUIP.ahu1);
      // The meter on the garage's west face, behind the panel.
      d.circle(o([-7, PANEL_AT[1]]), v.p(0.09));
    } else {
      box(EQUIP.ahu2, "HIDDEN");
    }
  });
  if (floor === "L1") {
    d.layer(LAYERS.eAnno, {}, () =>
      put(d, o([-7, PANEL_AT[1]]), "M", v.p(H.small), { align: "center", valign: "middle" }),
    );
    note([630, 312], ["HP-1, HP-2 ON", "PAD AT D.F.E."]);
    note([-64, 236], ["METER/MAIN", "200A, SERVICE", "DISC. (230.85)", "+ SPD (230.67)"]);
    note([24, 222], [`PANEL "${PANEL.name}"`, `${PANEL.amps}A, 40 SP.`]);
    note([center(EQUIP.ahu1)[0], EQUIP.ahu1[1] - 10], ["AHU-1 ON STAND"], "right");
  } else {
    note([EQUIP.ahu2[2] + 4, EQUIP.ahu2[1] + 6], ["AHU-2 IN ATTIC", "ABOVE (M-101)"]);
  }
}

// ---------------------------------------------------------------------------------------------
// Paper space.

/** The symbol legend, with the kit's blocks at paper size. */
function legend(d: D, at: Point, w: number): number {
  let y = at[1];
  d.layer(LAYERS.text, {}, () => {
    put(d, [at[0], y], "ELECTRICAL LEGEND", H.label, { valign: "top" });
    y -= H.label + 0.06;
    d.line([at[0], y], [at[0] + w, y], { lineweight: 0.35 });
    y -= 0.22;
  });
  const rows: [string, (c: Point) => void][] = [
    ["DUPLEX RECEPT., 20A, TR", (c) => d.insert("E-DUPLEX", c)],
    [
      "GFCI DUPLEX RECEPT., TR (WP: WR, IN-USE COVER)",
      (c) => d.insert("E-GFCI", [c[0] - 0.06, c[1]]),
    ],
    ["240V RECEPT. / OUTLET, NEMA PER EQUIPMENT", (c) => d.insert("E-220", c)],
    ["SINGLE-POLE SWITCH, LETTER = FIXTURES", (c) => d.insert("E-SWITCH", c)],
    ["THREE-WAY SWITCH", (c) => d.insert("E-SWITCH3", c)],
    ["CEILING LIGHT FIXTURE", (c) => d.insert("E-CEILING", c)],
    ["RECESSED LED DOWNLIGHT, IC RATED", (c) => d.insert("E-RECESSED", c)],
    [
      "CEILING FAN W/ LIGHT KIT, FAN-RATED BOX",
      (c) => d.insert("E-FAN", [c[0], c[1]], { scale: 0.6 }),
    ],
    ["WALL-MOUNTED LIGHT FIXTURE", (c) => d.insert("E-WALLLIGHT", [c[0], c[1] - 0.04])],
    ["SMOKE / CO ALARM, 120V, INTERCONNECTED", (c) => d.insert("E-SMOKE", c)],
    ["EXHAUST FAN, 50 CFM MIN., DUCTED OUT", (c) => d.insert("E-EXHAUST", c)],
    ["PANELBOARD", (c) => d.insert("E-PANEL", c)],
    ["DISCONNECT SWITCH", (c) => d.insert("E-DISC", c)],
    ["TV / DATA OUTLET (CAT 6 + RG6)", (c) => d.insert("E-TVDATA", [c[0], c[1] - 0.06])],
    [
      "DOORBELL BUTTON / CHIME",
      (c) => {
        d.insert("E-BELL", [c[0] - 0.12, c[1]]);
        d.insert("E-CHIME", [c[0] + 0.12, c[1]]);
      },
    ],
  ];
  for (const [label, draw] of rows) {
    d.layer(LAYERS.eAnno, {}, () => draw([at[0] + 0.3, y + 0.035]));
    d.layer(LAYERS.text, {}, () => put(d, [at[0] + 0.7, y], label, H.note, { valign: "middle" }));
    y -= 0.3;
  }
  // The line types of the wiring.
  const lineRow = (label: string, draw: (a: Point, b: Point) => void) => {
    d.layer(LAYERS.circ, {}, () => draw([at[0] + 0.05, y], [at[0] + 0.55, y]));
    d.layer(LAYERS.text, {}, () => put(d, [at[0] + 0.7, y], label, H.note, { valign: "middle" }));
    y -= 0.3;
  };
  lineRow("BRANCH CIRCUIT, CONCEALED", (a, b) => arcBetween(d, a, b, 0.15, 0));
  lineRow("SWITCH LEG", (a, b) => arcBetween(d, a, b, 0.15, 0, "HIDDEN"));
  lineRow("HOME RUN TO PANEL A, CIRCUIT NO.", (a, b) => {
    d.line(a, b);
    arrowhead(d, b, a, 0.08);
    put(d, [b[0] - 0.4, b[1] + 0.04], "A-1", H.small);
  });
  return y;
}

/** The panel schedule: odd circuits on the left, even on the right, in breaker order. */
function panelSchedule(d: D, at: Point): { y: number; width: number } {
  const loads = circuitLoads();
  const byPos = new Map<number, { c: (typeof loads)[number]; pole: number }>();
  for (const c of loads) c.positions.forEach((p, k) => byPos.set(p, { c, pole: k }));
  const half = (pos: number): string[] => {
    const hit = byPos.get(pos);
    if (!hit) return [String(pos), "SPACE", "", "", ""];
    const { c, pole } = hit;
    const per = Math.round(c.va / c.poles);
    const spare = c.desc === "SPARE";
    const bkr = `${c.amps}/${c.poles}${c.type ? ` ${c.type}` : ""}`;
    if (pole > 0) return [String(pos), "--", "", "", String(per)];
    const desc = c.count && !c.fixed ? `${c.desc} (${c.count})` : c.desc;
    return [String(pos), desc, bkr, spare ? "" : WIRE[c.amps]!, spare ? "" : String(per)];
  };
  const rows: string[][] = [];
  const phase = { A: 0, B: 0 };
  for (let r = 0; r < PANEL.spaces / 2; r++) {
    const ph = r % 2 === 0 ? "A" : "B";
    const left = half(2 * r + 1);
    const right = half(2 * r + 2);
    phase[ph] += Number(left[4] || 0) + Number(right[4] || 0);
    rows.push([...left, ph, ...right.slice(1).reverse(), right[0]!]);
  }
  const cols = [
    { name: "CKT", width: 0.42, align: "center" as const },
    { name: "DESCRIPTION", width: 2.75 },
    { name: "BKR", width: 0.72, align: "center" as const },
    { name: "WIRE", width: 0.5, align: "center" as const },
    { name: "VA", width: 0.55, align: "right" as const },
    { name: "PH", width: 0.36, align: "center" as const },
    { name: "VA", width: 0.55, align: "right" as const },
    { name: "WIRE", width: 0.5, align: "center" as const },
    { name: "BKR", width: 0.72, align: "center" as const },
    { name: "DESCRIPTION", width: 2.75, align: "right" as const },
    { name: "CKT", width: 0.42, align: "center" as const },
  ];
  const total = cols.reduce((s, c) => s + c.width, 0);
  let y = at[1];
  d.layer(LAYERS.text, {}, () => {
    put(d, [at[0], y], `PANEL "${PANEL.name}" SCHEDULE`, H.label, { valign: "top" });
    y -= H.label + 0.1;
    const info = `${PANEL.amps}A, ${PANEL.volts}, ${PANEL.spaces} SPACES, ${PANEL.main}A MAIN BKR., ${PANEL.aic} KAIC, SURFACE, GARAGE`;
    put(d, [at[0], y], info, H.note, { valign: "top" });
    y -= H.note + 0.1;
  });
  y = table(d, [at[0], y], "", cols, rows, { height: H.note, rowHeight: 0.2 });
  const connected = phase.A + phase.B;
  d.layer(LAYERS.text, {}, () => {
    y -= 0.2;
    put(
      d,
      [at[0], y],
      `CONNECTED LOAD: PHASE A ${phase.A.toLocaleString("en-US")} VA, PHASE B ${phase.B.toLocaleString("en-US")} VA, TOTAL ${connected.toLocaleString("en-US")} VA`,
      H.note,
    );
    y -= 0.2;
    put(
      d,
      [at[0], y],
      "BKR: AF = COMBINATION AFCI, GF = GFCI, DF = DUAL FUNCTION AFCI/GFCI.",
      H.note,
    );
    y -= 0.2;
    put(
      d,
      [at[0], y],
      "(N) = NUMBER OF OUTLETS AND FIXTURES ON THE CIRCUIT, AS DRAWN ON THE PLANS.",
      H.note,
    );
  });
  return { y: y - 0.1, width: total };
}

/** The service load calculation, NEC 220.82. */
function loadCalcTable(d: D, at: Point, w: number): number {
  const lc = loadCalc();
  const f = (n: number) => Math.round(n).toLocaleString("en-US");
  const rows: string[][] = [
    [`GENERAL LTG. + RECEPT., 3 VA/SF X ${f(lc.living)} SF`, f(lc.lighting)],
    [`SMALL APPLIANCE, ${lc.sabc / 1500} X 1,500 VA`, f(lc.sabc)],
    [`LAUNDRY, ${lc.laundry / 1500} X 1,500 VA`, f(lc.laundry)],
    ...lc.appliances.map((c) => [`${c.desc}, NAMEPLATE`, f(c.va)]),
    ["GENERAL LOAD, 220.82(B)", f(lc.general)],
    ["FIRST 10,000 VA AT 100% + REST AT 40%", f(lc.generalDemand)],
    ["HEAT PUMPS + AHU STRIP HEAT AT 100%, 220.82(C)", f(lc.hvac)],
    ["TOTAL DEMAND LOAD", f(lc.total)],
    [`SERVICE: ${f(lc.total)} VA / 240 V`, `${lc.amps.toFixed(0)} A`],
  ];
  const y = table(
    d,
    at,
    "SERVICE LOAD CALCULATION (NEC 220.82)",
    [
      { name: "LOAD", width: w - 0.85 },
      { name: "VA", width: 0.85, align: "right" },
    ],
    rows,
    { height: H.note, rowHeight: 0.2 },
  );
  let yy = y - 0.18;
  d.layer(LAYERS.text, {}, () => {
    const ok = lc.amps <= PANEL.amps;
    const lines = [
      `${lc.amps.toFixed(0)} A ${ok ? "<=" : ">"} ${PANEL.amps} A SERVICE: ${ok ? "OK" : "TOO SMALL"}.`,
      "SERVICE CONDUCTORS 2/0 CU OR 4/0 AL (NEC 310.12).",
      "GEC #4 CU TO CONCRETE-ENCASED ELECTRODE (250.52(A)(3)).",
    ];
    for (const line of lines) {
      put(d, [at[0], yy], line, H.note);
      yy -= 0.19;
    }
  });
  if (lc.amps > PANEL.amps)
    throw new Error(`The load, ${lc.amps.toFixed(0)} A, is more than the ${PANEL.amps} A service`);
  return yy - 0.1;
}

/** The lighting fixture schedule: each fixture type, and how many the plans hold. */
function fixtureSchedule(d: D, at: Point): number {
  const types: [string, Device["block"], string, string, string][] = [
    [
      "A",
      "E-RECESSED",
      '6" LED DOWNLIGHT, IC, AIR-TIGHT, 3000K (WET LISTED AT SHOWER/TUB)',
      "15",
      "RECESSED",
    ],
    [
      "B",
      "E-CEILING",
      "LED CEILING FIXTURE / PENDANT, 3000K, OWNER SELECTED",
      "60",
      "CEILING / PENDANT",
    ],
    ["C", "E-FAN", '52" CEILING FAN W/ LED LIGHT KIT (WET RATED AT LANAI)', "100", "FAN-RATED BOX"],
    [
      "D",
      "E-WALLLIGHT",
      "LED WALL SCONCE / VANITY / EXTERIOR WET LISTED",
      "40",
      'WALL, 72" A.F.F.',
    ],
    ["E", "E-EXHAUST", "EXHAUST FAN, 50 CFM MIN., DUCTED OUTSIDE, ENERGY STAR", "50", "CEILING"],
    ["F", "E-SMOKE", "SMOKE / CO ALARM, 120 V, 10-YR BATTERY BACKUP", "5", "CEILING"],
  ];
  const rows = types.map(([t, block, desc, va, mount]) => [
    t,
    desc,
    va,
    mount,
    String(DEVICES.filter((x) => x.block === block).length),
  ]);
  return table(
    d,
    at,
    "LIGHTING FIXTURE SCHEDULE",
    [
      { name: "TYPE", width: 0.5, align: "center" },
      { name: "DESCRIPTION", width: 5.6 },
      { name: "VA", width: 0.5, align: "right" },
      { name: "MOUNTING", width: 1.6 },
      { name: "QTY", width: 0.5, align: "right" },
    ],
    rows,
    { height: H.note, rowHeight: 0.22 },
  );
}

/** The service one-line diagram, not to scale, from the utility to panel A. */
function oneLine(d: D, at: Point, w: number): number {
  const [x0, top] = at;
  const cx = x0 + 1.0;
  const lbl = (p: Point, t: string) => put(d, p, t, H.note, { valign: "middle" });
  d.layer(LAYERS.text, {}, () => {
    put(d, [x0, top], "SERVICE ONE-LINE DIAGRAM", H.label, { valign: "top" });
    d.line([x0, top - H.label - 0.06], [x0 + w, top - H.label - 0.06], { lineweight: 0.35 });
    put(d, [x0, top - H.label - 0.2], "NOT TO SCALE", H.small, { valign: "top" });
  });
  let y = top - 0.85;
  d.layer(LAYERS.powr, {}, () => {
    // The utility's transformer.
    d.circle([cx, y], 0.16);
    d.circle([cx, y - 0.22], 0.16);
    lbl([cx + 0.35, y - 0.11], "UTILITY PAD-MOUNT TRANSFORMER");
    y -= 0.38;
    d.line([cx, y], [cx, y - 0.7]);
    lbl([cx + 0.35, y - 0.35], "UNDERGROUND LATERAL BY UTILITY");
    y -= 0.7;
    // The meter.
    d.circle([cx, y - 0.2], 0.2);
    put(d, [cx, y - 0.2], "M", H.label, { align: "center", valign: "middle" });
    lbl([cx + 0.35, y - 0.2], "METER, 200 A, ABOVE D.F.E.");
    y -= 0.4;
    d.line([cx, y], [cx, y - 0.3]);
    y -= 0.3;
    // The service disconnect: the main breaker in the meter/main, where the neutral and the
    // grounding meet: the main bonding jumper and the grounding electrode conductor.
    d.rect([cx - 0.25, y - 0.55], 0.5, 0.55);
    d.arc([cx + 0.05, y - 0.27], 0.15, 110, 250);
    lbl([cx + 0.4, y - 0.1], "MAIN BKR. 200 A = SERVICE DISCONNECT,");
    lbl([cx + 0.4, y - 0.28], '"EMERGENCY DISCONNECT" (230.85); SPD (230.67)');
    lbl([cx + 0.4, y - 0.46], "MAIN BONDING JUMPER HERE (250.24(B), 250.28)");
    // The GEC from the service disconnect to the footing steel.
    const gy0 = y - 0.27;
    d.line([cx - 0.25, gy0], [cx - 0.7, gy0]);
    d.line([cx - 0.7, gy0], [cx - 0.7, gy0 - 0.45]);
    for (let k = 0; k < 3; k++)
      d.line(
        [cx - 0.7 - 0.12 + 0.04 * k, gy0 - 0.45 - 0.07 * k],
        [cx - 0.7 + 0.12 - 0.04 * k, gy0 - 0.45 - 0.07 * k],
      );
    y -= 0.55;
    lbl([cx + 0.4, y - 0.12], "#4 CU GEC TO FOOTING STEEL, AT THE SERVICE");
    lbl([cx + 0.4, y - 0.3], "(250.24(A), 250.52(A)(3)); BOND METAL WATER");
    lbl([cx + 0.4, y - 0.48], "PIPE, IF ANY (250.104)");
    // The feeder to panel A: four wires, the fourth the equipment grounding conductor.
    d.line([cx, y], [cx, y - 1.3]);
    for (let k = 0; k < 4; k++) {
      const ty = y - 0.75 + k * 0.07;
      d.line([cx - 0.07, ty - 0.035], [cx + 0.07, ty + 0.035]);
    }
    put(d, [cx - 0.1, y - 0.62], "G", H.small, { align: "right", valign: "middle" });
    lbl([cx + 0.4, y - 0.7], "4-WIRE FEEDER: (3) 2/0 CU + #6 CU EGC,");
    lbl([cx + 0.4, y - 0.88], "OR (3) 4/0 AL + #4 AL EGC (215.6, 250.122),");
    lbl([cx + 0.4, y - 1.06], 'IN 2" PVC SCH. 80');
    y -= 1.3;
    // Panel A.
    d.rect([cx - 0.45, y - 0.6], 0.9, 0.6);
    put(d, [cx, y - 0.3], '"A"', H.label, { align: "center", valign: "middle" });
    lbl([cx + 0.6, y - 0.12], `PANEL "A", ${PANEL.amps} A, ${PANEL.spaces} SP., GARAGE`);
    lbl([cx + 0.6, y - 0.3], "FEEDER PANEL: NEUTRAL ISOLATED, NO MBJ;");
    lbl([cx + 0.6, y - 0.48], "EGC BONDED TO ENCLOSURE (250.24(A)(5))");
    const gy = y - 0.6;
    y = gy - 0.2;
  });
  return y;
}

const NOTES = [
  "ALL WORK PER NFPA 70, NATIONAL ELECTRICAL CODE, 2020 EDITION, AS ADOPTED BY THE 2023 FBC, AND THE SERVING UTILITY'S RULES. CONTRACTOR VERIFIES THE SERVICE POINT WITH THE UTILITY.",
  'SERVICE: 200 A, 120/240 V, 1 PHASE, 3 WIRE, UNDERGROUND. METER/MAIN OUTDOORS ON THE GARAGE WEST WALL; ITS MAIN BREAKER IS THE SERVICE DISCONNECT, MARKED "EMERGENCY DISCONNECT, SERVICE DISCONNECT" (NEC 230.85), WITH THE MAIN BONDING JUMPER AND THE GEC THERE (250.24). PANEL A IS A FEEDER PANEL: 4-WIRE FEEDER WITH AN EGC (215.6), NEUTRAL ISOLATED FROM THE ENCLOSURE (250.24(A)(5)). TYPE 1 OR 2 SPD AT THE SERVICE (NEC 230.67).',
  "AFCI: EVERY 120 V, 15 AND 20 A BRANCH CIRCUIT SUPPLYING OUTLETS OR DEVICES IN KITCHENS, FAMILY AND LIVING ROOMS, DENS, BEDROOMS, CLOSETS, HALLWAYS, LAUNDRY AREAS AND SIMILAR ROOMS IS PROTECTED BY A LISTED COMBINATION-TYPE AFCI AT THE PANEL (NEC 210.12(A)).",
  `GFCI: EVERY 125 V THROUGH 250 V RECEPTACLE IN BATHROOMS, GARAGES, OUTDOORS, KITCHENS WHERE SERVING COUNTERTOPS, WITHIN 6 FT OF A SINK, AND IN LAUNDRY AREAS, INCLUDING THE 240 V DRYER RECEPTACLE ON A 2-POLE GFCI BREAKER (CKT. ${circuit("DRYER").label}), AND THE DISHWASHER OUTLET, IS GFCI PROTECTED (NEC 210.8(A), 210.8(D)).`,
  "TAMPER-RESISTANT: ALL 15 AND 20 A, 125 AND 250 V NONLOCKING RECEPTACLES ARE LISTED TAMPER-RESISTANT (NEC 406.12). OUTDOOR RECEPTACLES ARE WEATHER-RESISTANT WITH IN-USE COVERS (NEC 406.9(B)).",
  'RECEPTACLES: NO POINT ALONG A WALL LINE MORE THAN 6 FT FROM A RECEPTACLE (NEC 210.52(A)); NO POINT ALONG A COUNTERTOP MORE THAN 24" FROM ONE (210.52(C)(1)); ISLAND OUTLETS PER 210.52(C)(2). AT LEAST ONE OUTDOOR RECEPTACLE AT THE FRONT AND THE BACK (210.52(E)).',
  "BRANCH CIRCUITS: TWO OR MORE 20 A SMALL-APPLIANCE CIRCUITS, ONE 20 A LAUNDRY, ONE 20 A BATHROOM AND ONE 20 A GARAGE CIRCUIT (NEC 210.11(C)). COPPER, TYPE NM-B OR THHN/THWN-2; #14 MIN. ON 15 A, #12 ON 20 A.",
  "SMOKE AND CO ALARMS: COMBINATION SMOKE/CO ALARMS IN EACH SLEEPING ROOM, OUTSIDE EACH SLEEPING AREA AND ON EACH STORY (FBC-R R314.3, R315.3), 120 V WITH BATTERY BACKUP, INTERCONNECTED SO THAT ALL SOUND WHEN ONE DOES (R314.4, R315.5). LISTED TO UL 217 AND UL 2034.",
  "HVAC (SEE M-101): DISCONNECT WITHIN SIGHT OF EACH HEAT PUMP AND AIR HANDLER (NEC 440.14), 125 V SERVICE RECEPTACLE WITHIN 25 FT (NEC 210.63). ATTIC: LIGHTS AT THE ACCESS AND AT AHU-2, SWITCHED AT THE ACCESS OPENING, AND A GFCI RECEPTACLE AT AHU-2 (FBC-R M1305.1.3.1, NEC 210.70(A)(3)). BREAKERS PER THE UNIT'S NAMEPLATE MOCP; VERIFY BEFORE ROUGH-IN.",
  "FLOOD ZONE AE: THE METER, PANEL, CONDENSERS, AIR HANDLERS AND WATER HEATER ARE AT OR ABOVE THE D.F.E. OF 10.00' NAVD (FBC-R R322.1.6). WIRING BELOW THE D.F.E. IN THE GARAGE IS LIMITED TO WHAT THE GARAGE NEEDS AND IS GFCI PROTECTED.",
  "LIGHTING: ALL PERMANENTLY INSTALLED FIXTURES ARE HIGH-EFFICACY (FBC-EC R404.1). RECESSED FIXTURES IN INSULATED CEILINGS ARE IC-RATED, AIR-TIGHT. FIXTURES OVER TUBS AND SHOWERS ARE LISTED FOR DAMP LOCATIONS. CLOSET FIXTURES PER NEC 410.16.",
  'MOUNTING HEIGHTS TO CENTER UNLESS NOTED: RECEPTACLES 16", COUNTER RECEPTACLES 44", SWITCHES 48", EXTERIOR WP RECEPTACLES 18" ABOVE GRADE MIN. CEILING FANS ON LISTED FAN-SUPPORT BOXES (NEC 314.27(C)).',
];

function e101(d: D): void {
  defineLowVoltage(d);
  const v = view(d, 64);
  powerPlan(d, v, "L1");
  powerPlan(d, v, "L2");
  frame(d, "E-101", (dd, sheet) => {
    const vpW = 12.0;
    const vpH = 11.8;
    const top = AREA.top - 0.1;
    const vpY = top - vpH;
    // The views: the house, with the heat pumps outside its east wall and the lanai north.
    const middle: Point = [300, 318];
    const vps: [Floor, number, string][] = [
      ["L1", AREA.left + 0.1, "FIRST FLOOR POWER AND LIGHTING PLAN"],
      ["L2", AREA.left + 0.1 + vpW + 0.25, "SECOND FLOOR POWER AND LIGHTING PLAN"],
    ];
    vps.forEach(([floor, x, title], k) => {
      viewport(dd, sheet, {
        corner: [x, vpY],
        size: [vpW, vpH],
        center: [E_ORIGIN[floor][0] + middle[0], E_ORIGIN[floor][1] + middle[1]],
        v,
        id: `vp-E-101-${floor}`,
        number: String(k + 1),
        sheetNo: "E-101",
        title,
        titleAt: [x + 0.1, vpY - 0.45],
      });
      dd.layer(LAYERS.text, {}, () =>
        dd.insert("NORTH ARROW", [x + vpW - 0.6, vpY - 0.5], { scale: 0.8 }),
      );
    });
    // Below the views: the legend, the panel schedule, the load calculation.
    const belowTop = vpY - 1.0;
    legend(dd, [AREA.left + 0.1, belowTop], 4.0);
    const sch = panelSchedule(dd, [AREA.left + 4.4, belowTop]);
    fixtureSchedule(dd, [AREA.left + 4.4, sch.y - 0.3]);
    const lcX = AREA.left + 4.4 + sch.width + 0.35;
    loadCalcTable(dd, [lcX, belowTop], AREA.left + 2 * vpW + 0.35 - lcX);
    // The notes, down the right side.
    const nx = AREA.left + 0.1 + 2 * vpW + 0.25 + 0.35;
    const notesEnd = noteColumn(dd, [nx, top], AREA.right - nx, "ELECTRICAL NOTES", NOTES);
    oneLine(dd, [nx, notesEnd - 0.4], AREA.right - nx);
  });
}

export const SHEETS_E = { "E-101": e101 };
