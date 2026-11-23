import type { Json } from "../src/guards.ts";
import assert from "node:assert/strict";
import { basename } from "node:path";
import { test } from "node:test";
import { inspect, isDeepStrictEqual } from "node:util";
import { Script } from "node:vm";
import { without } from "../cli/src/omit.ts";
import {
  BUILT_IN_STANDARD,
  defineStandard,
  DrawingError,
  fromJSON,
  lint,
  toDXF,
  toJSON,
  toSVG,
  type ParagraphAttributeDefinition,
  type TextAttributeDefinition,
  type Block,
  type Diagnostic,
  type DimensionStyle,
  type Drawing,
  type Entity,
  type Layer,
  type Layout,
  type LeaderStyle,
  type TableCellStyle,
  type TableStyle,
  type Hatch,
  type HatchPattern,
  type Linetype,
  type PatternLine,
  type Leader,
  type Polyline,
  type Standard,
  type TextStyle,
  type Viewport,
  type Xref,
  type FitSpline,
} from "../src/index.ts";
import { isNumber, isObjectOrArray, isString } from "../src/guards.ts";
import { timeLimit } from "./time-limit.ts";
import { dataOf, fieldOf, isData, recordsIn, wrong, type Data, type Field } from "./values.ts";

const styled = {
  linetype: "DD",
  lineweight: 0.25,
  linetypeScale: 2,
  color: [10, 200, 30],
  transparency: 50,
} as const;

const justified = { style: "NOTES", align: "center", valign: "middle" } as const;

/**
 * Each kind of entity with every field it can have: a field left out is a compile error. A
 * polyline has a width or widths for each side, and `wide` has the other. A leader has a note,
 * and `keyed` a block in its place. A hatch has a pattern, and `shaded` and `tinted` a gradient.
 */
type Kinds = {
  readonly [K in Entity["kind"]]: K extends "polyline"
    ? Required<Omit<Polyline, "width">>
    : K extends "leader"
      ? Required<Omit<Leader, "block" | "attributes">>
      : K extends "hatch"
        ? Required<Omit<Hatch, "gradient">>
        : Required<Extract<Entity, { kind: K }>>;
};

export const kinds = {
  line: { kind: "line", layer: "WALL", from: [0, 0], to: [10, 0], id: "a", ...styled },
  polyline: {
    kind: "polyline",
    layer: "0",
    points: [
      [0, 0],
      [10, 0],
      [10, 5],
    ],
    closed: true,
    bulges: [0, 0.5, -1],
    widths: [
      [0, 1],
      [1, 1],
      [0.5, 0],
    ],
    linetypeGeneration: true,
    id: "b",
    ...styled,
  },
  circle: { kind: "circle", layer: "0", center: [5, 5], radius: 2, id: "c", ...styled },
  arc: {
    kind: "arc",
    layer: "0",
    center: [5, 5],
    radius: 3,
    startAngle: 0,
    endAngle: 90,
    id: "d",
    ...styled,
  },
  text: {
    kind: "text",
    view: "plan",
    layer: "0",
    at: [0, 4],
    height: 1,
    rotation: 0,
    value: "T-0",
    id: "e",
    ...styled,
    ...justified,
  },
  paragraph: {
    kind: "paragraph",
    view: "plan",
    layer: "0",
    at: [0, 8],
    height: 0.5,
    rotation: 15,
    value: 'ALL WORK SHALL {\\LCOMPLY}\\P3\\S1/2;" GAP',
    width: 6,
    style: "NOTES",
    align: "center",
    valign: "bottom",
    lineSpacing: 1.5,
    lineSpacingStyle: "exactly",
    columns: { height: 4, count: 2, gutter: 0.5 },
    // A paragraph in columns takes no mask; a leader's note has one of every field.
    mask: false,
    id: "k",
    ...styled,
  },
  insert: {
    kind: "insert",
    view: "plan",
    color: "ByBlock",
    transparency: "ByBlock",
    layer: "0",
    block: "TREE",
    at: [20, 0],
    id: "f",
    scale: [2, 2],
    rotation: 30,
    attributes: { TAG: "T-1" },
  },
  "linear-dimension": {
    kind: "linear-dimension",
    scale: 2,
    view: "plan",
    color: 1,
    transparency: 40,
    layer: "0",
    style: "DIMS",
    from: [0, 0],
    to: [30, 10],
    line: [0, -6],
    angle: 15,
    text: "<> TYP",
    textBelow: "CLR.",
    id: "g",
  },
  "aligned-dimension": {
    kind: "aligned-dimension",
    scale: 2,
    view: "plan",
    color: [200, 100, 50],
    transparency: "ByLayer",
    layer: "0",
    style: "DIMS",
    from: [0, 0],
    to: [30, 10],
    offset: 8,
    text: "VARIES",
    textBelow: "<> O.C.",
    id: "h",
  },
  leader: {
    kind: "leader",
    view: "plan",
    color: 255,
    transparency: 0,
    layer: "0",
    style: "NOTE",
    text: ["NOTE", "SECOND LINE"],
    at: [40, 10],
    shafts: [
      [[35, 5]],
      [
        [36, 2],
        [38, 4],
      ],
    ],
    side: "right",
    attachment: "last-line",
    verticalAttachment: "line",
    width: 2,
    frame: true,
    mask: { color: 1, offsetFactor: 1.25 },
    shaft: "curved",
    farShafts: [[[45, 5]]],
    textStyle: "NOTES",
    textHeight: 0.08,
    arrowSize: 0.05,
    landing: 0.1,
    gap: 0.02,
    id: "i",
  },
  image: {
    kind: "image",
    layer: "0",
    path: "images/aerial.png",
    pixels: [400, 200],
    at: [50, 0],
    width: 20,
    height: 10,
    rotation: 15,
    clip: [
      [52, 2],
      [60, 1],
      [58, 8],
    ],
    invertClip: true,
    transparent: true,
    id: "m",
    ...styled,
  },
  underlay: {
    kind: "underlay",
    layer: "0",
    path: "refs/arch.pdf",
    page: "2",
    pageSize: [17, 11],
    at: [80, 0],
    scale: 0.5,
    rotation: 10,
    clip: [
      [81, 1],
      [86, 1],
      [84, 4],
    ],
    invertClip: true,
    fade: 25,
    contrast: 60,
    monochrome: true,
    on: true,
    id: "u",
    ...styled,
  },
  hatch: {
    kind: "hatch",
    layer: "0",
    loops: [
      {
        points: [
          [70, 0],
          [80, 0],
          [80, 10],
        ],
        bulges: [0, 0.5, 0],
      },
    ],
    pattern: { name: "STRIPES", scale: 2, angle: 30, origin: [1, 1] },
    id: "w1",
    ...styled,
  },
  wipeout: {
    kind: "wipeout",
    layer: "0",
    points: [
      [90, 0],
      [95, 0],
      [92, 4],
    ],
    id: "w2",
    ...styled,
  },
  ellipse: {
    kind: "ellipse",
    layer: "0",
    center: [100, 5],
    majorAxis: [4, 1],
    ratio: 0.5,
    startParameter: 30,
    endParameter: 270,
    id: "w6",
    ...styled,
  },
  // A spline by its control points; `fitted` is one through fit points.
  spline: {
    kind: "spline",
    layer: "0",
    controlPoints: [
      [110, 0],
      [112, 4],
    ],
    degree: 1,
    knots: [0, 0, 1, 1],
    weights: [1, 2],
    closed: false,
    id: "w7",
    ...styled,
  },
  "radius-dimension": {
    kind: "radius-dimension",
    scale: 2,
    view: "plan",
    color: 7,
    transparency: 90,
    layer: "0",
    style: "ARCH",
    center: [0, 0],
    point: [3, 4],
    text: "<> TYP",
    textBelow: "MIN.",
    textFromCenter: 2,
    id: "h-r",
  },
  "diameter-dimension": {
    kind: "diameter-dimension",
    scale: 2,
    view: "plan",
    color: [0, 0, 0],
    transparency: 25,
    layer: "0",
    style: "ARCH",
    center: [0, 0],
    point: [-3, 4],
    text: "<> BOLT",
    textBelow: "EQ.",
    textFromCenter: -1,
    id: "h-d",
  },
  "jogged-radius-dimension": {
    kind: "jogged-radius-dimension",
    scale: 2,
    view: "plan",
    color: 8,
    transparency: "ByBlock",
    layer: "0",
    style: "ARCH",
    center: [0, 0],
    point: [30, 40],
    start: [25, 20],
    jog: [27, 30],
    text: "<> CL",
    textBelow: "CURB",
    id: "h-j",
  },
  "arc-length-dimension": {
    kind: "arc-length-dimension",
    scale: 2,
    view: "plan",
    color: "ByLayer",
    transparency: 10,
    layer: "0",
    style: "ARCH",
    center: [0, 0],
    radius: 10,
    startAngle: 30,
    endAngle: 120,
    at: [0, 12],
    text: "<> TYP",
    textBelow: "MIN.",
    id: "h-l",
  },
  "angular-dimension": {
    kind: "angular-dimension",
    scale: 2,
    view: "plan",
    color: 250,
    transparency: 75,
    layer: "0",
    style: "ARCH",
    vertex: [0, 0],
    from: [10, 0],
    to: [0, 10],
    at: [7, 7],
    text: "<> TYP",
    textBelow: "MIN.",
    id: "h-a",
  },
  table: {
    kind: "table",
    color: "ByLayer",
    transparency: "ByLayer",
    layer: "0",
    style: "SCHEDULE",
    at: [100, 20],
    rotation: 0,
    columns: [1, 2],
    title: "DOORS",
    titleHeight: 0.4,
    header: [
      { text: "MARK", align: "left", valign: "bottom", textHeight: 0.1, color: 1, fill: 2 },
      "SIZE",
    ],
    headerHeight: 0.3,
    rows: [
      [{ block: "TREE", blockScale: 0.5, columnSpan: 2, rowSpan: 2 }, null],
      [null, null],
    ],
    rowHeights: [0.5, null],
    id: "tb",
  },
  "ordinate-dimension": {
    kind: "ordinate-dimension",
    scale: 2,
    view: "plan",
    color: [40, 160, 220],
    transparency: 50,
    layer: "0",
    style: "ARCH",
    axis: "x",
    origin: [1, 2],
    feature: [10, 5],
    leaderEnd: [10, 15],
    text: "<> TYP",
    textBelow: "MIN.",
    id: "h-o",
  },
  point: { kind: "point", layer: "0", at: [6, 5], rotation: 30, id: "w8", ...styled },
} satisfies Kinds;

/** A polyline of one width, with every field the polyline of `kinds` leaves out. */
const wide: Required<Omit<Polyline, "widths">> = {
  kind: "polyline",
  layer: "0",
  points: kinds.polyline.points,
  closed: false,
  bulges: [0.25, 0],
  width: 0.25,
  linetypeGeneration: true,
  id: "j",
  ...styled,
};

/** A hatch with a gradient of two colors, with every field the hatch of `kinds` leaves out. */
const shaded: Required<Omit<Hatch, "pattern">> = {
  kind: "hatch",
  layer: "0",
  loops: kinds.hatch.loops,
  gradient: {
    name: "spherical",
    angle: 30,
    centered: false,
    colors: [
      [200, 40, 30],
      [20, 90, 180],
    ],
  },
  id: "w3",
  ...styled,
};

/** A hatch with a gradient of one color and its tint. */
const tinted: Required<Omit<Hatch, "pattern">> = {
  kind: "hatch",
  layer: "0",
  loops: kinds.hatch.loops,
  gradient: {
    name: "inverted-curved",
    angle: 200,
    centered: true,
    color: [30, 120, 200],
    tint: 0.4,
  },
  id: "w4",
  ...styled,
};

/** A spline through fit points, with every field one can have. */
const fitted: Required<FitSpline> = {
  kind: "spline",
  layer: "0",
  fitPoints: [
    [120, 0],
    [124, 3],
  ],
  startTangent: [0, 1],
  endTangent: [1, 0],
  closed: false,
  id: "w5",
  ...styled,
};

const keyed: Required<
  Omit<
    Leader,
    | "text"
    | "attachment"
    | "verticalAttachment"
    | "width"
    | "frame"
    | "mask"
    | "textStyle"
    | "textHeight"
  >
> = {
  kind: "leader",
  view: "plan",
  color: "ByBlock",
  transparency: 20,
  layer: "0",
  style: "NOTE",
  block: "TREE",
  attributes: { TAG: "T-2" },
  at: [60, 10],
  shafts: [[[55, 5]]],
  side: "right",
  shaft: "straight",
  farShafts: [[[65, 5]]],
  arrowSize: 0.05,
  landing: 0.1,
  gap: 0.02,
  id: "keyed",
};

/** One of everything an R2018 drawing can hold, with every field of every object. */
export const full: Required<Drawing> & {
  readonly linetypes: readonly [Required<Linetype>, Required<Linetype>];
  readonly patterns: readonly [
    Required<HatchPattern> & { readonly lines: readonly [Required<PatternLine>] },
  ];
  readonly textStyles: readonly [Required<TextStyle>];
  // A style in decimal units leaves zeros out, and one in architectural units writes them.
  readonly dimensionStyles: readonly [
    Required<Omit<DimensionStyle, "feetInchZeros" | "fraction" | "fractionScale">>,
    Required<Omit<DimensionStyle, "suppressZeros">>,
  ];
  readonly leaderStyles: readonly [Required<LeaderStyle>];
  readonly tableStyles: readonly [
    Required<TableStyle> & { readonly data: Required<TableCellStyle> },
  ];
  readonly layers: readonly [Layer, Required<Layer>];
  readonly blocks: readonly [
    Block,
    Required<Block> & {
      readonly attributes: readonly [
        Required<TextAttributeDefinition>,
        Required<ParagraphAttributeDefinition>,
      ];
    },
  ];
  readonly xrefs: readonly [Required<Xref>];
  readonly layouts: readonly [
    Required<Layout> & { readonly viewports: readonly [Required<Viewport>] },
    Layout,
  ];
} = {
  format: 0,
  units: "ft",
  dxf: "R2018",
  linetypeScale: 2,
  imageFrame: false,
  underlayFrame: "screen",
  wipeoutFrame: false,
  pointStyle: { figure: "cross", circle: true, square: true, size: { percent: 10 } },
  linetypes: [
    {
      name: "DD",
      description: "Dash dot",
      pattern: [0.5, -0.25, 0, -0.25],
      marks: [
        {
          after: 1,
          text: "W",
          style: "Standard",
          height: 0.1,
          rotation: 0,
          orient: "upright",
          offset: [0, -0.05],
        },
      ],
    },
    // A linetype of shapes that nothing draws in, which lint does not warn of.
    {
      name: "SHAPES",
      description: "Shapes",
      pattern: [0.5, -0.25],
      marks: [
        {
          after: 1,
          glyph: 3,
          file: "shapes.shx",
          scale: 0.1,
          rotation: 0,
          orient: "relative",
          offset: [0, 0],
        },
      ],
    },
  ],
  patterns: [
    {
      name: "STRIPES",
      description: "Dashed stripes",
      lines: [{ angle: 45, base: [0, 0], offset: [0, 0.25], dashes: [0.5, -0.25, 0, -0.25] }],
    },
  ],
  textStyles: [{ name: "NOTES", font: "Arial", widthFactor: 0.9, obliqueAngle: 10 }],
  dimensionStyles: [
    {
      name: "DIMS",
      textStyle: "NOTES",
      textHeight: 0.1,
      arrowhead: "architectural-tick",
      arrowSize: 0.1,
      extensionOffset: 0.05,
      extensionBeyond: 0.1,
      textGap: 0.05,
      lineExtension: 0.1,
      scale: 10,
      precision: 2,
      prefix: "L ",
      suffix: "'",
      units: "decimal",
      suppressZeros: "trailing",
      measurementScale: 2,
      textPlacement: "centered",
      textFit: "leader",
      dimensionLineweight: 0.5,
      extensionLineweight: 0.25,
      radialText: "horizontal",
      jogAngle: 30,
      angleUnits: "degrees-minutes-seconds",
      anglePrecision: 4,
      suppressAngleZeros: "leading",
      textMask: { color: 3 },
      arcSymbol: "above",
    },
    {
      name: "ARCH",
      textStyle: "NOTES",
      textHeight: 0.1,
      arrowhead: "architectural-tick",
      arrowSize: 0.1,
      extensionOffset: 0.05,
      extensionBeyond: 0.1,
      textGap: 0.05,
      lineExtension: 0.1,
      scale: 10,
      precision: 4,
      prefix: "",
      suffix: "",
      units: "architectural",
      feetInchZeros: "both",
      measurementScale: 12,
      fraction: "stacked",
      fractionScale: 0.75,
      textPlacement: "above",
      textFit: "inside",
      dimensionLineweight: 0.35,
      extensionLineweight: 0.18,
      radialText: "aligned",
      jogAngle: 45,
      angleUnits: "degrees",
      anglePrecision: 0,
      suppressAngleZeros: "both",
      textMask: true,
      arcSymbol: "none",
    },
  ],
  leaderStyles: [
    {
      name: "NOTE",
      textStyle: "NOTES",
      textHeight: 0.1,
      arrowhead: "dot",
      arrowSize: 0.1,
      landing: 0.1,
      gap: 0.05,
      attachment: "first-line",
      direction: "vertical",
      verticalAttachment: "line",
      frame: true,
      shaft: "curved",
      block: "TREE",
      blockConnection: "insertion",
      blockScale: 2,
      scale: 10,
    },
  ],
  tableStyles: [
    {
      name: "SCHEDULE",
      textStyle: "NOTES",
      textHeight: 0.1,
      horizontalMargin: 0.03,
      verticalMargin: 0.02,
      title: { textHeight: 0.15 },
      header: { fill: 8 },
      data: {
        textStyle: "NOTES",
        textHeight: 0.08,
        align: "left",
        valign: "middle",
        color: 3,
        fill: 9,
        lineweight: 0.25,
      },
    },
  ],
  layers: [
    { name: "0", color: 7 },
    {
      name: "WALL",
      color: 1,
      linetype: "DD",
      lineweight: 0.5,
      off: false,
      frozen: false,
      locked: true,
      plot: false,
    },
  ],
  blocks: [
    { name: "LEAF", entities: [{ kind: "circle", layer: "0", center: [0, 0], radius: 1 }] },
    {
      name: "TREE",
      base: [1, 2],
      attributes: [
        {
          kind: "text",
          tag: "TAG",
          prompt: "Tree tag",
          value: "T-0",
          layer: "0",
          at: [0, 4],
          height: 1,
          rotation: 0,
          ...justified,
        },
        {
          kind: "paragraph",
          tag: "NOTE",
          prompt: "Note",
          value: "PLANT IN\\PSPRING",
          layer: "0",
          at: [0, -4],
          height: 0.5,
          rotation: 0,
          style: "NOTES",
          width: 6,
          align: "center",
          valign: "middle",
          lineSpacing: 1.5,
          lineSpacingStyle: "exactly",
        },
      ],
      entities: [
        { kind: "arc", layer: "0", center: [0, 0], radius: 3, startAngle: 0, endAngle: 90 },
        { kind: "insert", layer: "0", block: "LEAF", at: [1, 1] },
      ],
    },
  ],
  xrefs: [{ name: "BASE", path: "base.dwg", attach: true }],
  entities: [
    ...Object.values(kinds),
    { kind: "insert", layer: "0", block: "BASE", at: [0, 0] },
    wide,
    keyed,
    fitted,
    shaded,
    tinted,
  ],
  layouts: [
    {
      name: "C-101",
      paper: "ARCH D",
      plotStyle: "acad.ctb",
      viewports: [
        {
          id: "view",
          layer: "WALL",
          corner: [1, 1],
          width: 20,
          height: 10,
          center: [5, 2],
          ratio: 12,
          frozenLayers: ["WALL"],
          twist: 30,
        },
      ],
      // One of each kind of entity on the sheet, each with an id of its own.
      entities: Object.values(kinds).map((entity) => ({ ...entity, id: `sheet-${entity.id}` })),
    },
    { name: "Blank", paper: "ANSI B", viewports: [], entities: [] },
  ],
};

/** What an R12 drawing can hold. */
export const r12: Drawing = {
  format: 0,
  units: "ft",
  dxf: "R12",
  layers: [{ name: "0", color: 7 }],
  entities: [
    { kind: "line", layer: "0", from: [0, 0], to: [10, 0], id: "a" },
    {
      kind: "polyline",
      layer: "0",
      points: kinds.polyline.points,
      closed: true,
      id: "b",
      linetype: "ByLayer",
      lineweight: "ByLayer",
    },
    { kind: "circle", layer: "0", center: [5, 5], radius: 2 },
    { kind: "arc", layer: "0", center: [5, 5], radius: 3, startAngle: 0, endAngle: 90 },
    { kind: "text", layer: "0", at: [0, 4], height: 1, rotation: 0, value: "T-0" },
  ],
};

export type Path = readonly (string | number)[];

/**
 * Visit each field once. structuredClone preserves shared objects, so changing a field
 * through any path to its parent produces the same mutated drawing.
 */
function paths(value: Field, at: Path = [], seen = new WeakSet<object>()): Path[] {
  if (!isObjectOrArray(value) || seen.has(value)) return [];
  seen.add(value);

  return Object.keys(value).flatMap((key) => {
    const step = [...at, Array.isArray(value) ? Number(key) : key];

    return [step, ...paths(fieldOf(value, key), step, seen)];
  });
}

export const HOLE = Symbol("an empty slot");

/** A value the sweep puts in a drawing, or `HOLE` for an empty slot. */
export type Swept = Field | typeof HOLE;

/** A copy of `drawing` with the value at `path` replaced, or its slot emptied for `HOLE`. */
export function replaced(drawing: Drawing, path: Path, value: Swept): Field {
  if (path.length === 0) return value === HOLE ? undefined : value;
  const copy = structuredClone(dataOf(drawing));
  let parent: Field = copy;

  for (const step of path.slice(0, -1)) parent = fieldOf(parent, step);
  const last = path.at(-1)!;

  if (isObjectOrArray(parent)) {
    if (value === HOLE) Reflect.deleteProperty(parent, last);
    else Reflect.set(parent, last, value);
  }

  return copy;
}

const at = (drawing: Field, path: Path): Field =>
  path.reduce<Field>((value, step) => fieldOf(value, step), drawing);

const circular: Data = {};

circular.self = circular;

const oddValues = [undefined, null, 5, "x", {}, [], 1n, circular, { toString: 0 }];

/** The values to put in place of the one at `path`. */
function replacements(drawing: Field, path: Path): Swept[] {
  const parent = at(drawing, path.slice(0, -1));
  const value = at(drawing, path);

  return [
    ...oddValues,
    ...(Array.isArray(value) ? [[null], new Array(2)] : []),
    ...(isNumber(value) ? [0, -1, NaN, Infinity] : []),
    ...(Array.isArray(parent) ? ([HOLE] as const) : []),
    // The same value with a field nobody knows.
    ...(value === null ? [{ zz: 1 }] : isData(value) ? [{ ...value, zz: 1 }] : []),
  ];
}

/**
 * A standard whose title block is the full drawing's block `TREE` on its sheet, so that `lint`
 * walks every rule of a standard over the drawing, its title block and its fields among them.
 */
const treeStandard = defineStandard({
  id: "tree",
  version: "1",
  paperUnits: "in",
  minTextHeight: 0.05,
  layers: { WALL: { color: 1 } },
  textRoles: { note: { font: "Arial", height: 0.1 } },
  titleBlocks: {
    tree: {
      paper: "ARCH D",
      block: {
        format: 0,
        units: "in",
        dxf: "R2018",
        layers: [{ name: "0", color: 7 }],
        entities: [],
        textStyles: full.textStyles,
        blocks: full.blocks,
      },
      blockName: "TREE",
      layer: "WALL",
      drawingArea: [0.5, 0.5, 35.5, 23.5],
      fields: { TAG: { box: [1, 1, 2, 2] } },
    },
  },
  sheetFormats: { d: { paper: "ARCH D", titleBlock: "tree" } },
});

export const errors = (drawing: Drawing, version?: "R12" | "R2018") =>
  lint(drawing, version ? { version } : {}).filter((d) => d.severity === "error");

/**
 * Runs `toSVG` for model space and for each layout, as the command does, and stops it after a
 * second, so a drawing that never finishes fails the test.
 */
const draw = new Script(
  "toSVG(drawing); if (Array.isArray(drawing?.layouts)) for (const layout of drawing.layouts) toSVG(drawing, { layout: layout.name });",
);

Object.assign(globalThis, { toSVG });

/** What `toSVG` does with a drawing: the error it throws, or undefined when it draws it. */
function drawn(drawing: Drawing): Error | undefined {
  Object.assign(globalThis, { drawing });

  try {
    draw.runInThisContext({ timeout: timeLimit(1000) });

    return undefined;
  } catch (thrown) {
    return thrown instanceof Error ? thrown : new Error(String(thrown));
  }
}

const hung = (thrown: Error | undefined): boolean =>
  thrown !== undefined && "code" in thrown && thrown.code === "ERR_SCRIPT_EXECUTION_TIMEOUT";

/**
 * Says what `lint` does wrong with a value: it must return, for every version and standard, and
 * agree with itself, `toSVG` must return or throw in a second, a value `lint` reports no error
 * for must be one the writers, `toSVG` and `fromJSON` take, and a drawing it reports an error for
 * must be one `toSVG` draws, at least once the items the errors name are left out.
 */
function failure(value: Field): string | undefined {
  const drawing = wrong<Drawing>(value);
  let found: Diagnostic[];

  let others: [how: string, refused: Diagnostic[]][];

  try {
    const under = (standard: Standard) =>
      lint(drawing, { standard }).filter((d) => d.severity === "error");

    others = [
      ["R12", errors(drawing, "R12")],
      ["R2018", errors(drawing, "R2018")],
      ["the built-in standard", under(BUILT_IN_STANDARD)],
      ["a standard", under(treeStandard)],
    ];
    found = errors(drawing);
  } catch (thrown) {
    return `lint threw ${String(thrown)}`;
  }

  // `lint` for the drawing's own version is the plain one.
  for (const [how, more] of others) {
    if (how === fieldOf(value, "dxf") && !isDeepStrictEqual(more, found))
      return `lint for ${how}, the drawing's own version, reports other errors`;
  }

  const refused = drawn(drawing);

  if (hung(refused)) return "toSVG does not finish";

  if (found.length > 0) {
    // A writer refuses what `lint` reports before it reads the drawing.
    try {
      toDXF(drawing);

      return "lint reports an error, and toDXF writes the drawing";
    } catch (thrown) {
      if (!(thrown instanceof DrawingError)) {
        return `lint reports an error, and toDXF throws ${String(thrown).split("\n", 1)[0]}`;
      }
    }

    // The command asks for a drawing with a list of layers and one of entities before it lints.
    if (!Array.isArray(drawing?.layers) || !Array.isArray(drawing.entities)) return undefined;

    if (refused === undefined) return undefined;
    const rest = drawn(without(drawing, new Set(found.flatMap((d) => d.item ?? []))));

    return rest === undefined
      ? undefined
      : `it cannot be drawn without what lint names: ${String(rest).split("\n", 1)[0]}`;
  }

  try {
    if (refused !== undefined) throw refused;
    toDXF(drawing);
    fromJSON(toJSON(drawing));
    fromJSON(wrong<Json>(structuredClone(value)));
  } catch (thrown) {
    return `lint reports no error, and then: ${String(thrown).split("\n", 1)[0]}`;
  }

  return undefined;
}

/**
 * How many test files share the sweep. `node --test` runs each file in a process of its own, and
 * one file fewer at once than the machine has cores: 7 is what 8 cores run at once.
 */
export const SHARES = 7;

const TABLES = [
  "layers",
  "linetypes",
  "patterns",
  "textStyles",
  "dimensionStyles",
  "leaderStyles",
  "tableStyles",
  "blocks",
  "xrefs",
] as const;

/** Every string in a value, at any depth: a drawing names a layer, style or block by a string. */
function strings(value: Field, found = new Set<string>()): Set<string> {
  if (isString(value)) found.add(value);
  else if (isObjectOrArray(value)) {
    for (const field of Object.values(value)) strings(field, found);
  }

  return found;
}

/** Whether `value` is `target` or holds it, at any depth. */
const holds = (value: Field, target: Data | readonly Field[]): boolean =>
  value === target ||
  (isObjectOrArray(value) && Object.values(value).some((f) => holds(f, target)));

const names = (item: Field, among: Set<string>): boolean =>
  [...strings(item)].some((name) => among.has(name));

/** An entity or a table item of `full`, where it is, and for a table item its table. */
interface Item {
  readonly at: Path;
  readonly item: Field;
  readonly table?: (typeof TABLES)[number];
}

/** The name of a table item, by which the rest of a drawing refers to it. */
const nameOf = ({ item, table }: Item): string[] =>
  table && isData(item) && isString(item.name) ? [item.name] : [];

/** A drawing a case runs in, and the path in it of the value the case replaces. */
interface Part {
  readonly drawing: Drawing;
  readonly path: Path;
}

/** The length of the list at `path` in a drawing, or 0 where there is none. */
function lengthAt(drawing: Drawing, path: Path): number {
  const list = at(dataOf(drawing), path);

  return Array.isArray(list) ? list.length : 0;
}

/**
 * The smallest part of `full` in which a value at `path` breaks what it breaks in `full`, and the
 * path to the same place there. A value under an entity or a table item keeps every item that
 * holds the object it changes, since the drawing shares objects among them, every item that names
 * a changed table item, and every table item that any of those names. Each layout keeps its
 * viewports, which draw the model space. Anything else changes the drawing as a whole.
 */
function smallest(path: Path): Part {
  const whole = dataOf(full);

  const items: Item[] = [
    ...full.entities.map((item, index) => ({ at: ["entities", index], item: dataOf(item) })),
    ...full.layouts.flatMap((layout, number) =>
      layout.entities.map((item, index) => ({
        at: ["layouts", number, "entities", index],
        item: dataOf(item),
      })),
    ),
    ...TABLES.flatMap((table) =>
      recordsIn(fieldOf(whole, table)).map((item, index) => ({ at: [table, index], item, table })),
    ),
  ];

  const own = items.find(({ at }) => at.every((step, index) => path[index] === step));

  if (!own) return { drawing: full, path };
  const parent = at(whole, path.slice(0, -1));

  const changed = new Set(
    path.length === own.at.length
      ? [own]
      : items.filter(({ item }) => isObjectOrArray(parent) && holds(item, parent)),
  );

  // A table item's name may be in any other item, and a name it holds brings that one in too.
  const named = new Set([...changed].flatMap(nameOf));

  for (let size = -1; size !== named.size;) {
    size = named.size;

    for (const each of items) {
      if (each.table && names(each.item, named)) for (const name of nameOf(each)) named.add(name);
    }
  }

  for (const each of items) if (names(each.item, named)) changed.add(each);
  // Layer 0 is in every drawing.
  const used = new Set(["0", ...named]);
  strings(
    full.layouts.map(({ entities: _entities, ...layout }) => dataOf(layout)),
    used,
  );

  for (const { item } of changed) strings(item, used);

  for (let size = -1; size !== used.size;) {
    size = used.size;

    for (const each of items)
      if (nameOf(each).some((name) => used.has(name))) strings(each.item, used);
  }

  const kept = items.filter(
    (each) => changed.has(each) || nameOf(each).some((name) => used.has(name)),
  );

  const within = (prefix: Path) =>
    kept.filter(
      ({ at }) =>
        at.length === prefix.length + 1 && prefix.every((step, index) => at[index] === step),
    );

  // SAFETY: it is `full` with fewer entities and table items, and every item one of them names.
  const drawing: Drawing = {
    ...full,
    entities: within(["entities"]).map(({ item }) => item),
    layouts: full.layouts.map((layout, number) => ({
      ...layout,
      entities: within(["layouts", number, "entities"]).map(({ item }) => item),
    })),
    ...Object.fromEntries(TABLES.map((table) => [table, within([table]).map(({ item }) => item)])),
  } as never;

  const index = within(own.at.slice(0, -1)).indexOf(own);

  return { drawing, path: [...own.at.slice(0, -1), index, ...path.slice(own.at.length)] };
}

/** A replacement's kind, the same for each path: a copy with a field nobody knows is one kind. */
const kindOf = (value: Swept): string =>
  value !== HOLE && isData(value) && Object.hasOwn(value, "zz")
    ? "unknown field"
    : inspect(value, { depth: 0, breakLength: Infinity });

type Case = {
  drawing: Drawing;
  path: Path;
  value: Swept;
  count: number;
  smallest: Part;
  /** Whether the case runs in the whole drawing too, where it is smaller. */
  whole: boolean;
};

/**
 * Every case of the sweep: each value put in place of each value of both drawings, counted, and
 * the smallest drawing to put it in. A value equal to the one it replaces leaves the drawing as it
 * was, so only the first such case of each drawing runs.
 *
 * A fault may show only in a drawing as big as `full`: past a limit on the work of `lint` or
 * `toSVG`, or on the length of a list. So one value of each path also runs in the whole drawing:
 * a kind of value no path of the same field name, such as each `rotation`, has run there yet
 * before one that has, and among those the kind fewest of those paths offer.
 */
export function* cases(): Generator<Case> {
  const all = [full, r12].flatMap((drawing) => {
    let unchanged = false;

    return [[], ...paths(dataOf(drawing))].map((path) => {
      const original = at(dataOf(drawing), path);

      const values = replacements(dataOf(drawing), path).filter((value) => {
        if (!Object.is(value, original)) return true;

        if (unchanged) return false;
        unchanged = true;

        return true;
      });

      const name = String(path.findLast((step) => isString(step)));

      return {
        drawing,
        path,
        values,
        name,
        part: drawing === full ? smallest(path) : { drawing, path },
      };
    });
  });

  // How many paths of each field name offer each kind of value, so the rarest kind runs first.
  const offered = new Map<string, number>();

  for (const { drawing, values, name, part } of all) {
    if (part.drawing === drawing) continue;

    for (const kind of new Set(values.map(kindOf)))
      offered.set(`${name} ${kind}`, (offered.get(`${name} ${kind}`) ?? 0) + 1);
  }

  const ranWhole = new Map<string, Set<string>>();
  let count = 0;

  for (const { drawing, path, values, name, part } of all) {
    // A hole in a list the smallest drawing shortens may leave out items after it, so it runs in
    // the whole drawing, and the path's whole-drawing run takes another value.
    const shortened =
      part.drawing !== drawing &&
      lengthAt(part.drawing, part.path.slice(0, -1)) < lengthAt(drawing, path.slice(0, -1));

    let wholeAt = -1;

    if (part.drawing !== drawing) {
      const ran = ranWhole.get(name) ?? new Set<string>();
      ranWhole.set(name, ran);
      const fresh = (value: Swept) => !ran.has(kindOf(value));
      const rarity = (value: Swept) => offered.get(`${name} ${kindOf(value)}`)!;

      // A kind not yet run there first, then the one fewest of the field's paths offer.
      const before = (value: Swept, other: Swept) =>
        fresh(value) !== fresh(other) ? fresh(value) : rarity(value) < rarity(other);

      for (const [index, value] of values.entries()) {
        if (shortened && value === HOLE) continue;

        if (wholeAt < 0 || before(value, values[wholeAt])) wholeAt = index;
      }

      ran.add(kindOf(values[wholeAt]));
    }

    for (const [index, value] of values.entries()) {
      const hole = value === HOLE && shortened;
      yield {
        drawing,
        path,
        value,
        count: count++,
        smallest: hole ? { drawing, path } : part,
        whole: !hole && index === wholeAt,
      };
    }
  }
}

/**
 * One test file's share of the sweep: the file `shape-sweep/share-N.test.ts` takes each case
 * whose count leaves N - 1 when divided by `SHARES`. So the files together take every case once.
 */
export function sweep(file: string): void {
  const share = Number(/^share-(\d+)\.test\.ts$/.exec(basename(file))?.[1]);

  const name =
    "lint returns for every value of the wrong type, with an error for what cannot be written";

  test(`${name}: share ${share} of ${SHARES}`, () => {
    assert.ok(share >= 1 && share <= SHARES, `${file} is no share of the sweep`);
    const failures: string[] = [];

    for (const { drawing, path, value, count, smallest, whole } of cases()) {
      if (count % SHARES !== share - 1) continue;
      let found = failure(replaced(smallest.drawing, smallest.path, value));

      if (!found && whole) {
        const big = failure(replaced(drawing, path, value));

        if (big) found = `in the whole drawing, ${big}`;
      }

      if (found) {
        const shown = inspect(value, { depth: 0, breakLength: Infinity });

        const where =
          smallest.drawing === drawing
            ? ""
            : ` (in its smallest drawing at ${smallest.path.join(".")})`;

        failures.push(`${drawing.dxf} ${path.join(".")}${where} = ${shown}: ${found}`);
      }
    }

    assert.deepEqual(failures, []);
  });
}
