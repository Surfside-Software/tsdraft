// The set's drafting kit: text styles, layers, symbols as blocks, the sheet frame and the
// helpers every sheet uses. The drawing is in inches, as the firm's model files are. Sizes of
// annotation are paper sizes, turned into model inches for a view's ratio with `fromPaper`.
import {
  CENTER,
  DASHED,
  fromPaper,
  HIDDEN,
  measureText,
  PHANTOM,
  type DrawingBuilder,
  type Point,
  type TextAlign,
  type TextVerticalAlign,
} from "../../../src/index.ts";
import { arrowhead, feetInches } from "../../lib/drafting.ts";

export type D = DrawingBuilder;
export const FONT = "Arial" as const;
export const NOTES = "NOTES";
export const TITLE = "TITLE";

/** Text heights on paper, in inches. */
export const H = {
  small: 1 / 16,
  note: 3 / 32,
  label: 1 / 8,
  sub: 5 / 32,
  head: 3 / 16,
  title: 1 / 4,
};

/** A view: its ratio and the paper-to-model helper for it. */
export interface View {
  readonly ratio: number;
  readonly label: string;
  /** Paper inches as model inches. */
  readonly p: (inches: number) => number;
  /** The dimension style for the view. */
  readonly dim: string;
}

const LABELS: Record<number, string> = {
  12: `1" = 1'-0"`,
  16: `3/4" = 1'-0"`,
  24: `1/2" = 1'-0"`,
  32: `3/8" = 1'-0"`,
  48: `1/4" = 1'-0"`,
  64: `3/16" = 1'-0"`,
  96: `1/8" = 1'-0"`,
  192: `1/16" = 1'-0"`,
  120: `1" = 10'-0"`,
  240: `1" = 20'-0"`,
};

const views = new Map<number, View>();

/** The view at `ratio`, with its dimension style, defined once per drawing. */
export function view(d: D, ratio: number): View {
  const known = views.get(ratio);
  if (known) return known;
  const p = (inches: number) => fromPaper(inches, "in", { ratio, units: "in" });
  const dim = `DIM-${ratio}`;
  const civil = ratio >= 120;
  d.dimensionStyle({
    name: dim,
    textStyle: NOTES,
    textHeight: H.note,
    arrowhead: "architectural-tick",
    arrowSize: 1 / 16,
    extensionOffset: 1 / 16,
    extensionBeyond: 1 / 16,
    textGap: 1 / 32,
    scale: p(1),
    // A civil view measures in decimal feet. An architectural one gets feet and inches as a
    // text override, since a dimension writes only decimals.
    precision: civil ? 1 : 0,
    measurementScale: civil ? 1 / 12 : 1,
    suffix: civil ? "'" : '"',
  });
  const v: View = { ratio, label: LABELS[ratio] ?? `1:${ratio}`, p, dim };
  views.set(ratio, v);
  return v;
}

/** Resets the per-drawing caches, for a second drawing in one process. */
export function resetKit(): void {
  views.clear();
}

export const ftIn = (inches: number): string => feetInches(Math.abs(inches));

/** How long a text plots, in paper inches at `height`. */
export const width = (value: string, height: number): number =>
  measureText({ value, height, font: FONT }).length;

/** A text in the set's style. */
export function put(
  d: D,
  at: Point,
  value: string,
  height: number,
  o: { align?: TextAlign; valign?: TextVerticalAlign; rotation?: number; style?: string } = {},
): void {
  if (!value.trim()) return;
  d.text(at, value, { height, ...o, style: o.style ?? NOTES });
}

/** Breaks a sentence into lines no longer than `max`, by how long each plots. */
export function wrap(sentence: string, height: number, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of sentence.split(/\s+/)) {
    const longer = line ? `${line} ${word}` : word;
    if (line && width(longer, height) > max) {
      lines.push(line);
      line = word;
    } else line = longer;
  }
  return line ? [...lines, line] : lines;
}

export const LAYERS = {
  // The firm's sheet layers.
  ttlb: "G-TTLB",
  text: "G-ANNO-TEXT",
  vport: "G-ANNO-NPLT",
  revText: "Rev_Text",
  revs: "G-ANNO-REVS",
  // Plans.
  wall: "A-WALL",
  wallLow: "A-WALL-PRHT",
  door: "A-DOOR",
  glaz: "A-GLAZ",
  flor: "A-FLOR",
  stair: "A-FLOR-STRS",
  case: "A-FLOR-CASE",
  fixt: "P-FIXT",
  ovhd: "A-FLOR-OVHD",
  roof: "A-ROOF",
  roofOutl: "A-ROOF-OUTL",
  anno: "A-ANNO-TEXT",
  dims: "A-ANNO-DIMS",
  symb: "A-ANNO-SYMB",
  tags: "A-ANNO-TAGS",
  elev: "A-ELEV",
  elevFine: "A-ELEV-FINE",
  sect: "A-SECT",
  sectFine: "A-SECT-FINE",
  patt: "A-PATT",
  grade: "A-ELEV-GRAD",
  // Structure.
  fndn: "S-FNDN",
  ftng: "S-FNDN-HIDD",
  slab: "S-SLAB",
  fram: "S-FRAM",
  beam: "S-BEAM",
  strAnno: "S-ANNO-TEXT",
  strDims: "S-ANNO-DIMS",
  // Site.
  prop: "C-PROP",
  setb: "C-SETB",
  bldg: "C-BLDG",
  pave: "C-PAVE",
  road: "C-ROAD-CNTR",
  wall2: "C-SEAW",
  water: "C-WATR",
  topo: "C-TOPO",
  util: "C-UTIL",
  tree: "L-PLNT",
  civAnno: "C-ANNO-TEXT",
  civDims: "C-ANNO-DIMS",
  // MEP. The base plan under them plots gray.
  base: "E-BASE",
  lite: "E-LITE",
  powr: "E-POWR",
  circ: "E-POWR-CIRC",
  eAnno: "E-ANNO-TEXT",
  plmb: "P-DOMW",
  sanr: "P-SANR",
  pAnno: "P-ANNO-TEXT",
} as const;

/** Defines every layer of the set, with its color, linetype and pen. */
export function defineLayers(d: D): void {
  const L = LAYERS;
  const layer = (name: string, color: number, lineweight: number | "Default", linetype?: string) =>
    d.layer(name, { color, lineweight, ...(linetype ? { linetype } : {}) });
  d.linetype(DASHED);
  d.linetype(HIDDEN);
  d.linetype(CENTER);
  d.linetype(PHANTOM);
  layer(L.ttlb, 7, 0.35);
  layer(L.text, 7, 0.25);
  d.layer(L.vport, { color: 8, plot: false });
  layer(L.revText, 7, 0.18);
  layer(L.revs, 7, 0.35);
  for (let i = 1; i <= 8; i++) layer(`Rev_${i}`, 7, 0.18);
  layer(L.wall, 7, 0.5);
  layer(L.wallLow, 7, 0.35);
  layer(L.door, 7, 0.25);
  layer(L.glaz, 7, 0.18);
  layer(L.flor, 7, 0.18);
  layer(L.stair, 7, 0.25);
  layer(L.case, 7, 0.18);
  layer(L.fixt, 7, 0.18);
  layer(L.ovhd, 7, 0.18, "HIDDEN");
  layer(L.roof, 7, 0.35);
  layer(L.roofOutl, 7, 0.5);
  layer(L.anno, 7, 0.25);
  layer(L.dims, 7, 0.18);
  layer(L.symb, 7, 0.25);
  layer(L.tags, 7, 0.25);
  layer(L.elev, 7, 0.5);
  layer(L.elevFine, 7, 0.18);
  layer(L.sect, 7, 0.6);
  layer(L.sectFine, 7, 0.25);
  layer(L.patt, 7, 0.09);
  layer(L.grade, 7, 0.7);
  layer(L.fndn, 7, 0.5);
  layer(L.ftng, 7, 0.25, "HIDDEN");
  layer(L.slab, 7, 0.18);
  layer(L.fram, 7, 0.25);
  layer(L.beam, 7, 0.5, "DASHED");
  layer(L.strAnno, 7, 0.25);
  layer(L.strDims, 7, 0.18);
  layer(L.prop, 7, 0.7, "PHANTOM");
  layer(L.setb, 7, 0.25, "DASHED");
  layer(L.bldg, 7, 0.6);
  layer(L.pave, 7, 0.35);
  layer(L.road, 7, 0.18, "CENTER");
  layer(L.wall2, 7, 0.5);
  layer(L.water, 7, 0.18);
  layer(L.topo, 7, 0.18, "DASHED");
  layer(L.util, 7, 0.25, "DASHED");
  layer(L.tree, 7, 0.18);
  layer(L.civAnno, 7, 0.25);
  layer(L.civDims, 7, 0.18);
  // Color 252 is a light gray. The MEP sheets plot with acad.ctb, so it screens the base plan.
  layer(L.base, 252, 0.18);
  layer(L.lite, 7, 0.35);
  layer(L.powr, 7, 0.35);
  layer(L.circ, 7, 0.25);
  layer(L.eAnno, 7, 0.25);
  layer(L.plmb, 7, 0.35);
  layer(L.sanr, 7, 0.5);
  layer(L.pAnno, 7, 0.25);
}

/** Defines the text styles and the set's symbols. Call once, before any sheet. */
export function defineSymbols(d: D): void {
  d.textStyle({ name: NOTES, font: FONT });
  d.textStyle({ name: TITLE, font: FONT, widthFactor: 0.9 });

  // Symbols are drawn in paper inches. In model space they are inserted at `view.p(1)`.
  d.block("NORTH ARROW", {}, () => {
    const r = 0.375;
    d.circle([0, 0], r);
    d.polyline(
      [
        [0, r * 1.25],
        [r * 0.38, -r * 0.7],
        [0, -r * 0.35],
        [-r * 0.38, -r * 0.7],
      ],
      true,
    );
    d.line([0, -r * 0.35], [0, r * 1.25]);
    d.text([0, r * 1.35], "N", { height: H.head, style: NOTES, align: "center" });
  });
  // A door tag: a number in a circle.
  d.block("DOOR TAG", {}, () => {
    d.circle([0, 0], 0.14);
    d.attribute("DOOR", [0, 0], {
      value: "000",
      height: 0.08,
      style: NOTES,
      align: "center",
      valign: "middle",
    });
  });
  // A window tag: a letter in a hexagon.
  d.block("WINDOW TAG", {}, () => {
    const r = 0.13;
    const pts: Point[] = [];
    for (let i = 0; i < 6; i++)
      pts.push([r * Math.cos((Math.PI / 3) * i), r * Math.sin((Math.PI / 3) * i)]);
    d.polyline(pts, true);
    d.attribute("WINDOW", [0, 0], {
      value: "X",
      height: 0.09,
      style: NOTES,
      align: "center",
      valign: "middle",
    });
  });
  // A room tag: the name over the area and the ceiling.
  d.block("ROOM TAG", {}, () => {
    d.attribute("ROOM", [0, 0.04], {
      value: "ROOM",
      height: H.label,
      style: NOTES,
      align: "center",
    });
    d.attribute("AREA", [0, -0.04], {
      value: "",
      height: H.note,
      style: NOTES,
      align: "center",
      valign: "top",
    });
  });
  // A section mark: a bubble with the section over the sheet, and an arrow the way it looks.
  // Its base point is the bubble's middle. Rotate it to turn the arrow; +X is the default.
  d.block("SECTION MARK", {}, () => {
    const r = 0.22;
    d.circle([0, 0], r);
    d.line([-r, 0], [r, 0]);
    d.polyline(
      [
        [r * 0.7, r * 0.7],
        [r * 1.9, 0],
        [r * 0.7, -r * 0.7],
      ],
      false,
    );
    d.attribute("SECT", [0, 0.04], { value: "1", height: 0.1, style: NOTES, align: "center" });
    d.attribute("SHEET", [0, -0.04], {
      value: "A-000",
      height: 0.07,
      style: NOTES,
      align: "center",
      valign: "top",
    });
  });
  // A section bubble with no arrow: `sectionCut` draws the arrow the way the section looks, so
  // the bubble's text stays upright whatever the direction.
  d.block("SECTION BUBBLE", {}, () => {
    const r = 0.22;
    d.circle([0, 0], r);
    d.line([-r, 0], [r, 0]);
    d.attribute("SECT", [0, 0.04], { value: "1", height: 0.1, style: NOTES, align: "center" });
    d.attribute("SHEET", [0, -0.04], {
      value: "A-000",
      height: 0.07,
      style: NOTES,
      align: "center",
      valign: "top",
    });
  });
  // A level marker for elevations and sections: a target with the level's name and elevation.
  d.block("LEVEL", {}, () => {
    const r = 0.08;
    d.circle([0, 0], r);
    d.line([-r, 0], [r, 0]);
    d.line([0, -r], [0, r]);
    d.attribute("NAME", [r + 0.06, 0.03], { value: "LEVEL", height: H.note, style: NOTES });
    d.attribute("EL", [r + 0.06, -0.03], {
      value: "EL. 0.00'",
      height: H.note,
      style: NOTES,
      valign: "top",
    });
  });
  // A spot grade for the site plan.
  d.block("SPOT", {}, () => {
    d.line([-0.05, -0.05], [0.05, 0.05]);
    d.line([-0.05, 0.05], [0.05, -0.05]);
    d.attribute("EL", [0.08, 0.02], { value: "0.00", height: H.note, style: NOTES });
  });
  // A palm for the site plan, its fronds one unit in radius: insert it at the canopy's radius.
  d.block("PALM", {}, () => {
    d.circle([0, 0], 0.12);
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      d.line([Math.cos(a) * 0.12, Math.sin(a) * 0.12], [Math.cos(a + 0.25), Math.sin(a + 0.25)]);
    }
  });
  // The view title: a bubble with the view's number, the title and the scale. The underline
  // is drawn per view, as long as its title.
  d.block("VIEW TITLE", {}, () => {
    const r = 0.25;
    d.circle([r, 0], r);
    d.line([0, 0], [2 * r, 0]);
    d.attribute("VIEW_NO", [r, 0.05], {
      value: "1",
      height: H.label,
      style: NOTES,
      align: "center",
    });
    d.attribute("VIEW_SHEET", [r, -0.05], {
      value: "A-000",
      height: 0.08,
      style: NOTES,
      align: "center",
      valign: "top",
    });
    d.attribute("VIEW_TITLE", [2 * r + 0.12, 0.06], {
      value: "VIEW",
      height: H.title,
      style: TITLE,
    });
    d.attribute("VIEW_SCALE", [2 * r + 0.12, -0.06], {
      value: "SCALE",
      height: H.label,
      style: NOTES,
      valign: "top",
    });
  });
  // Electrical symbols, in paper inches.
  d.block("E-DUPLEX", {}, () => {
    d.circle([0, 0], 0.07);
    d.line([-0.03, -0.1], [-0.03, 0.1]);
    d.line([0.03, -0.1], [0.03, 0.1]);
  });
  d.block("E-GFCI", {}, () => {
    d.circle([0, 0], 0.07);
    d.line([-0.03, -0.1], [-0.03, 0.1]);
    d.line([0.03, -0.1], [0.03, 0.1]);
    d.text([0.12, -0.03], "GFI", { height: 0.06, style: NOTES });
  });
  d.block("E-SWITCH", {}, () => {
    d.text([0, 0], "S", { height: 0.12, style: NOTES, align: "center", valign: "middle" });
  });
  d.block("E-SWITCH3", {}, () => {
    d.text([0, 0], "S", { height: 0.12, style: NOTES, align: "center", valign: "middle" });
    d.text([0.07, -0.07], "3", { height: 0.06, style: NOTES });
  });
  d.block("E-CEILING", {}, () => {
    const r = 0.1;
    d.circle([0, 0], r);
    d.line([-r * 0.7, -r * 0.7], [r * 0.7, r * 0.7]);
    d.line([-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7]);
  });
  d.block("E-RECESSED", {}, () => {
    d.circle([0, 0], 0.07);
    d.circle([0, 0], 0.035);
  });
  d.block("E-FAN", {}, () => {
    d.circle([0, 0], 0.08);
    for (const a of [0, 90, 180, 270]) {
      const t = (a * Math.PI) / 180;
      d.polyline(
        [
          [Math.cos(t) * 0.08, Math.sin(t) * 0.08],
          [Math.cos(t + 0.35) * 0.3, Math.sin(t + 0.35) * 0.3],
          [Math.cos(t - 0.15) * 0.3, Math.sin(t - 0.15) * 0.3],
        ],
        true,
      );
    }
  });
  d.block("E-WALLLIGHT", {}, () => {
    d.circle([0, 0.06], 0.06);
    d.line([-0.1, 0], [0.1, 0]);
    d.line([-0.04, 0.02], [0.04, 0.1]);
    d.line([-0.04, 0.1], [0.04, 0.02]);
  });
  d.block("E-SMOKE", {}, () => {
    d.circle([0, 0], 0.09);
    d.text([0, 0], "S/C", { height: 0.05, style: NOTES, align: "center", valign: "middle" });
  });
  d.block("E-EXHAUST", {}, () => {
    d.rect([-0.09, -0.09], 0.18, 0.18);
    d.line([-0.09, -0.09], [0.09, 0.09]);
    d.line([-0.09, 0.09], [0.09, -0.09]);
  });
  d.block("E-PANEL", {}, () => {
    d.rect([-0.2, -0.06], 0.4, 0.12);
    d.line([-0.2, -0.06], [0.2, 0.06]);
  });
  d.block("E-220", {}, () => {
    d.circle([0, 0], 0.08);
    d.line([-0.06, -0.05], [0.06, 0.05]);
    d.line([-0.06, 0.05], [0.06, -0.05]);
    d.line([0, -0.08], [0, 0.08]);
  });
  d.block("E-DISC", {}, () => {
    d.rect([-0.08, -0.08], 0.16, 0.16);
    d.text([0, 0], "D", { height: 0.08, style: NOTES, align: "center", valign: "middle" });
  });
  // A flood vent in a wall, for plans.
  d.block("FLOOD VENT", {}, () => {
    d.rect([-0.12, -0.05], 0.24, 0.1);
    d.line([-0.12, -0.05], [0.12, 0.05]);
  });
}

// ---------------------------------------------------------------------------------------------
// Dimensions.

/**
 * A chained string of linear dimensions through `points`, along `axis`, with its line at `at`
 * on the other axis. An architectural view writes feet and inches as each dimension's text, as
 * a dimension writes only decimals.
 */
export function dimString(
  d: D,
  v: View,
  points: readonly Point[],
  axis: "x" | "y",
  at: number,
): void {
  const i = axis === "x" ? 0 : 1;
  const sorted = [...points].sort((a, b) => a[i] - b[i]);
  const unique = sorted.filter((p, k) => k === 0 || Math.abs(p[i] - sorted[k - 1]![i]) > 0.01);
  for (let k = 1; k < unique.length; k++) {
    const a = unique[k - 1]!;
    const b = unique[k]!;
    const line: Point = axis === "x" ? [0, at] : [at, 0];
    const civil = v.ratio >= 120;
    d.linearDimension(a, b, line, {
      style: v.dim,
      ...(axis === "y" ? { along: "y" as const } : {}),
      ...(civil ? {} : { text: ftIn(b[i] - a[i]) }),
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Notes in model space: a leader to a point, with lines of text.

/** A note with a leader, sized for view `v`. `lines` are wrapped by the caller. */
export function leaderNote(
  d: D,
  v: View,
  target: Point,
  elbow: Point,
  lines: readonly string[],
): void {
  const h = v.p(H.note);
  const side = elbow[0] >= target[0] ? 1 : -1;
  const end: Point = [elbow[0] + side * v.p(1 / 8), elbow[1]];
  d.polyline([target, elbow, end]);
  arrowhead(d, target, elbow, v.p(1 / 8));
  const x = end[0] + side * v.p(1 / 16);
  lines.forEach((line, k) => {
    put(d, [x, elbow[1] - k * h * 1.6], line, h, {
      align: side > 0 ? "left" : "right",
      valign: "middle",
    });
  });
}

/** A note of several lines in model space, wrapped to `maxPaper` inches. */
export function modelNote(
  d: D,
  v: View,
  at: Point,
  text: string,
  maxPaper = 2.5,
  align: TextAlign = "left",
): number {
  const h = v.p(H.note);
  const lines = wrap(text, H.note, maxPaper);
  lines.forEach((line, k) => put(d, [at[0], at[1] - k * h * 1.6], line, h, { align }));
  return lines.length * h * 1.6;
}

// ---------------------------------------------------------------------------------------------
// The sheet.

/** The drawing area of every sheet, inside the border and left of the title strip. */
export const AREA = { left: 2.0, bottom: 0.75, right: 31.75, top: 23.25 } as const;
/** The title strip on the right of the sheet. */
export const STRIP = { left: 32.0, right: 35.5, bottom: 0.5, top: 23.5 } as const;

/** A view on a sheet: a viewport at a ratio, with its title under it. */
export function viewport(
  d: D,
  sheet: {
    viewport: (
      c: Point,
      w: number,
      h: number,
      o: { center: Point; ratio: number; id?: string },
    ) => unknown;
  },
  o: {
    corner: Point;
    size: [number, number];
    center: Point;
    v: View;
    id: string;
    number: string;
    sheetNo: string;
    title: string;
    scale?: string;
    titleAt?: Point;
  },
): void {
  d.layer(LAYERS.vport, {}, () => {
    sheet.viewport(o.corner, o.size[0], o.size[1], {
      center: o.center,
      ratio: o.v.ratio,
      id: o.id,
    });
  });
  viewTitle(
    d,
    o.titleAt ?? [o.corner[0] + 0.1, o.corner[1] - 0.35],
    o.number,
    o.sheetNo,
    o.title,
    o.scale ?? `SCALE: ${o.v.label}`,
  );
}

/** A view title on the sheet: the bubble, the title over a line as long as it, the scale. */
export function viewTitle(
  d: D,
  at: Point,
  number: string,
  sheetNo: string,
  title: string,
  scale: string,
): void {
  d.layer(LAYERS.text, {}, () => {
    d.insert("VIEW TITLE", at, {
      attributes: { VIEW_NO: number, VIEW_SHEET: sheetNo, VIEW_TITLE: title, VIEW_SCALE: scale },
    });
    const length = Math.max(
      measureText({ value: title, height: H.title, font: FONT, widthFactor: 0.9 }).length,
      width(scale, H.label),
    );
    d.line([at[0] + 0.5, at[1]], [at[0] + 0.62 + length + 0.15, at[1]], { lineweight: 0.5 });
  });
}

/** A graphic scale in paper space for a view, `length` inches long, numbered in feet. */
export function graphicScale(d: D, at: Point, v: View, length = 2): void {
  const feetPerInch = v.ratio / 12;
  // Divide the bar where the numbers come out round.
  const total = length * feetPerInch;
  const step = [1, 2, 4, 5, 8, 10, 20, 25, 40, 50, 100].find((s) => total / s <= 4) ?? 100;
  const stops: number[] = [];
  for (let f = 0; f <= total + 1e-9; f += step) stops.push(f);
  const bar = stops.at(-1)! / feetPerInch;
  const h = 0.08;
  d.layer(LAYERS.text, {}, () => {
    d.rect(at, bar, h);
    stops.forEach((f, k) => {
      const x = at[0] + f / feetPerInch;
      if (k > 0 && k < stops.length - 1) d.line([x, at[1]], [x, at[1] + h]);
      put(d, [x, at[1] + h + 0.05], `${f}'`, H.small, { align: "center" });
    });
    for (let k = 0; k + 1 < stops.length; k += 2) {
      const x0 = at[0] + stops[k]! / feetPerInch;
      const x1 = at[0] + stops[k + 1]! / feetPerInch;
      d.line([x0, at[1] + h / 2], [x1, at[1] + h / 2]);
    }
  });
}

/** Notes in a column on the sheet. Returns the y below the last line. */
export function noteColumn(
  d: D,
  at: Point,
  colWidth: number,
  heading: string,
  notes: readonly string[],
  o: { numbered?: boolean; height?: number } = {},
): number {
  const h = o.height ?? H.note;
  const lead = h * 1.65;
  let y = at[1];
  d.layer(LAYERS.text, {}, () => {
    put(d, [at[0], y], heading, H.label, { valign: "top" });
    y -= H.label + 0.06;
    d.line([at[0], y], [at[0] + colWidth, y], { lineweight: 0.35 });
    y -= 0.08 + h;
    const indent = o.numbered === false ? 0 : width("00. ", h);
    notes.forEach((note, k) => {
      if (o.numbered !== false) put(d, [at[0], y], `${k + 1}.`, h);
      for (const line of wrap(note, h, colWidth - indent)) {
        put(d, [at[0] + indent, y], line, h);
        y -= lead;
      }
      y -= h * 0.5;
    });
  });
  return y;
}

/**
 * A table on the sheet: a heading, a header row and rows, in columns of the given widths. Each
 * cell is checked to fit; a value too long for its cell throws, so the table is fixed in code.
 */
export function table(
  d: D,
  at: Point,
  heading: string,
  columns: readonly { name: string; width: number; align?: TextAlign }[],
  rows: readonly (readonly string[])[],
  o: { height?: number; rowHeight?: number } = {},
): number {
  const h = o.height ?? H.note;
  const rh = o.rowHeight ?? h * 2.4;
  const total = columns.reduce((s, c) => s + c.width, 0);
  let y = at[1];
  d.layer(LAYERS.text, {}, () => {
    if (heading) {
      put(d, [at[0], y], heading, H.label, { valign: "top" });
      y -= H.label + 0.1;
    }
    const top = y;
    const all = [columns.map((c) => c.name), ...rows];
    all.forEach((cells, r) => {
      let x = at[0];
      cells.forEach((cell, c) => {
        const col = columns[c]!;
        const pad = 0.05;
        const textWidth = width(cell, h);
        if (textWidth > col.width - 2 * pad) {
          throw new Error(
            `Table "${heading}": "${cell}" is ${textWidth.toFixed(2)} in long for a cell ${col.width} in wide`,
          );
        }
        const align = col.align ?? "left";
        const tx =
          align === "center"
            ? x + col.width / 2
            : align === "right"
              ? x + col.width - pad
              : x + pad;
        put(d, [tx, y - rh / 2], cell, h, { align, valign: "middle" });
        x += col.width;
      });
      y -= rh;
      d.line([at[0], y], [at[0] + total, y], { lineweight: r === 0 ? 0.35 : 0.13 });
    });
    d.rect([at[0], y], total, top - y, { lineweight: 0.35 });
    let x = at[0];
    for (const col of columns.slice(0, -1)) {
      x += col.width;
      d.line([x, y], [x, top]);
    }
  });
  return y;
}

/** The arrow and slope of a roof, in model space for view `v`. */
export function slopeArrow(d: D, v: View, at: Point, angle: number, text: string): void {
  const len = v.p(0.6);
  const t = (angle * Math.PI) / 180;
  const tip: Point = [at[0] + (Math.cos(t) * len) / 2, at[1] + (Math.sin(t) * len) / 2];
  const tail: Point = [at[0] - (Math.cos(t) * len) / 2, at[1] - (Math.sin(t) * len) / 2];
  d.line(tail, tip);
  arrowhead(d, tip, tail, v.p(0.1));
  let rot = angle;
  if (rot > 90) rot -= 180;
  if (rot <= -90) rot += 180;
  // The text stands on the side its own "up" points to, clear of the arrow.
  const r = (rot * Math.PI) / 180;
  const lift = v.p(0.07);
  put(d, [at[0] - Math.sin(r) * lift, at[1] + Math.cos(r) * lift], text, v.p(H.note), {
    align: "center",
    rotation: rot,
  });
}

/** Draws one sheet: its model space and its layout. */
export type SheetDraw = (d: D) => void;

/**
 * A section cut mark in model space for view `v`: the bubble upright at `at`, with its arrow
 * pointing the way the section looks.
 */
export function sectionCut(
  d: D,
  v: View,
  at: Point,
  look: "N" | "S" | "E" | "W",
  sect: string,
  sheet: string,
): void {
  d.insert("SECTION BUBBLE", at, { scale: v.p(1), attributes: { SECT: sect, SHEET: sheet } });
  const r = v.p(0.22);
  const dir: Point =
    look === "N" ? [0, 1] : look === "S" ? [0, -1] : look === "E" ? [1, 0] : [-1, 0];
  const across: Point = [-dir[1], dir[0]];
  const base = (k: number): Point => [
    at[0] + dir[0] * r * 0.7 + across[0] * r * 0.7 * k,
    at[1] + dir[1] * r * 0.7 + across[1] * r * 0.7 * k,
  ];
  d.polyline([base(1), [at[0] + dir[0] * r * 1.9, at[1] + dir[1] * r * 1.9], base(-1)], false);
}

/**
 * A revision cloud around a rectangle, as arcs bulging outward, with a delta tag holding the
 * revision number at its upper right. Sizes are paper inches through `p`.
 */
export function revisionCloud(
  d: D,
  p: (inches: number) => number,
  rect: readonly [number, number, number, number],
  rev: string,
): void {
  const [x0, y0, x1, y1] = rect;
  const step = p(0.3);
  d.layer(LAYERS.revs, {}, () => {
    const side = (a: Point, b: Point, outward: number) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.round(len / step));
      const ux = (b[0] - a[0]) / len;
      const uy = (b[1] - a[1]) / len;
      const base = (Math.atan2(uy, ux) * 180) / Math.PI;
      for (let k = 0; k < n; k++) {
        const c: Point = [a[0] + ux * (len / n) * (k + 0.5), a[1] + uy * (len / n) * (k + 0.5)];
        const r = len / n / 2;
        // A half circle on the outside of the side.
        d.arc(c, r, base + (outward > 0 ? 0 : 180), base + (outward > 0 ? 180 : 360));
      }
    };
    side([x0, y0], [x1, y0], -1);
    side([x1, y0], [x1, y1], -1);
    side([x1, y1], [x0, y1], -1);
    side([x0, y1], [x0, y0], -1);
    const h = p(0.28);
    const at: Point = [x1 + p(0.12), y1 + p(0.12)];
    d.polyline([at, [at[0] + h, at[1]], [at[0] + h / 2, at[1] + h * 0.87]], true);
    d.text([at[0] + h / 2, at[1] + h * 0.3], rev, {
      height: p(0.1),
      style: NOTES,
      align: "center",
      valign: "middle",
    });
  });
}
