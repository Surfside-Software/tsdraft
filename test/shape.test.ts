import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";
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
  type TextStyle,
  type Viewport,
  type Xref,
  type FitSpline,
} from "../src/index.ts";
import { timeLimit } from "./time-limit.ts";

const styled = { linetype: "DD", lineweight: 0.25, color: [10, 200, 30] } as const;
const justified = { style: "NOTES", align: "center", valign: "middle" } as const;

/**
 * Each kind of entity with every field it can have: a field left out is a compile error. A
 * polyline has a width or widths for each side, and `wide` has the other. A leader has a note,
 * and `keyed` a block in its place. A hatch has a pattern, and `shaded` and `tinted` a gradient.
 */
const kinds: {
  readonly [K in Entity["kind"]]: K extends "polyline"
    ? Required<Omit<Polyline, "width">>
    : K extends "leader"
      ? Required<Omit<Leader, "block" | "attributes">>
      : K extends "hatch"
        ? Required<Omit<Hatch, "gradient">>
        : Required<Extract<Entity, { kind: K }>>;
} = {
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
    color: "ByBlock",
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
    color: 1,
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
    color: [200, 100, 50],
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
    color: 255,
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
    color: 7,
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
    color: [0, 0, 0],
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
    color: 8,
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
    color: "ByLayer",
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
    color: 250,
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
    color: [40, 160, 220],
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
};

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
  color: "ByBlock",
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
const full: Required<Drawing> & {
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
  wipeoutFrame: false,
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
          shape: 3,
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
const r12: Drawing = {
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

type Path = readonly (string | number)[];

/** Every path to a value in `value`, at every depth. */
function paths(value: unknown, at: Path = []): Path[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.keys(value).flatMap((key) => {
    const step = [...at, Array.isArray(value) ? Number(key) : key];
    return [step, ...paths((value as Record<string, unknown>)[key], step)];
  });
}

const HOLE = Symbol("an empty slot");

/** A copy of `drawing` with the value at `path` replaced, or its slot emptied for `HOLE`. */
function replaced(drawing: unknown, path: Path, value: unknown): unknown {
  if (path.length === 0) return value;
  const copy = structuredClone(drawing) as Record<string | number, unknown>;
  let parent = copy;
  for (const step of path.slice(0, -1)) parent = parent[step] as typeof parent;
  if (value === HOLE) delete parent[path.at(-1)!];
  else parent[path.at(-1)!] = value;
  return copy;
}

const at = (drawing: unknown, path: Path): unknown =>
  path.reduce((value, step) => (value as Record<string | number, unknown>)[step], drawing);

const circular: Record<string, unknown> = {};
circular.self = circular;
const wrong = [undefined, null, 5, "x", {}, [], 1n, circular, { toString: 0 }];

/** The values to put in place of the one at `path`. */
function replacements(drawing: unknown, path: Path): unknown[] {
  const parent = at(drawing, path.slice(0, -1));
  const value = at(drawing, path);
  return [
    ...wrong,
    ...(Array.isArray(value) ? [[null], new Array(2)] : []),
    ...(typeof value === "number" ? [0, -1, NaN, Infinity] : []),
    ...(Array.isArray(parent) ? [HOLE] : []),
    // The same value with a field nobody knows.
    ...(typeof value === "object" && !Array.isArray(value) ? [{ ...value, zz: 1 }] : []),
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

const errors = (drawing: Drawing, version?: "R12" | "R2018") =>
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
function drawn(drawing: Drawing): unknown {
  Object.assign(globalThis, { drawing });
  try {
    draw.runInThisContext({ timeout: timeLimit(1000) });
    return undefined;
  } catch (thrown) {
    return thrown;
  }
}

const hung = (thrown: unknown): boolean =>
  (thrown as { code?: unknown } | null)?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT";

/**
 * Says what `lint` does wrong with a value: it must return, `toSVG` must return or throw in a
 * second, a value `lint` reports no error for must be one the writers, `toSVG` and `fromJSON`
 * take, and a drawing it reports an error for must be one `toSVG` draws, at least once the
 * items the errors name are left out.
 */
function failure(value: unknown): string | undefined {
  const drawing = value as Drawing;
  let found: Diagnostic[];
  try {
    for (const version of ["R12", "R2018"] as const) errors(drawing, version);
    lint(drawing, { standard: BUILT_IN_STANDARD });
    lint(drawing, { standard: treeStandard });
    found = errors(drawing);
  } catch (thrown) {
    return `lint threw ${String(thrown)}`;
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
    fromJSON(structuredClone(value));
  } catch (thrown) {
    return `lint reports no error, and then: ${String(thrown).split("\n", 1)[0]}`;
  }
  return undefined;
}

test("lint returns for every value of the wrong type, with an error for what cannot be written", () => {
  const failures: string[] = [];
  for (const drawing of [full, r12]) {
    assert.deepEqual(lint(fromJSON(toJSON(drawing))), []);
    for (const path of [[], ...paths(drawing)]) {
      for (const value of replacements(drawing, path)) {
        const found = failure(replaced(drawing, path, value));
        const shown = inspect(value, { depth: 0, breakLength: Infinity });
        if (found) failures.push(`${drawing.dxf} ${path.join(".")} = ${shown}: ${found}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("a value of the wrong shape is reported in these words, once", () => {
  const cases: [path: Path, value: unknown, expected: string[]][] = [
    [["units"], 1n, ["units: Unknown units: a value of type bigint"]],
    [
      ["xrefs", 0, "name"],
      { toString: 0 },
      [
        "xref: Xref a value of type object: A block's name must be a string",
        `undefined-block: insert #22: Block "BASE" is not defined. The leading CAD app's AUDIT reports an insert of a block the drawing does not have, and that app cannot save the drawing as DXF`,
      ],
    ],
    [
      ["entities", 1],
      HOLE,
      ["format: entities has no item at index 1. An array cannot have empty slots"],
    ],
    [
      ["entities", 1, "points"],
      new Array(200000),
      ["format: entities[1].points has no item at index 0. An array cannot have empty slots"],
    ],
    [["blocks", 1, "base"], "x", ["block: blocks[1].base must be a point, [x, y]"]],
    [
      ["blocks", 1, "attributes", 0, "height"],
      "x",
      ["attribute: blocks[1].attributes[0].height must be a number"],
    ],
    [
      ["textStyles", 0, "obliqueAngle"],
      null,
      ['text-style: Text style "NOTES": obliqueAngle must be a finite number'],
    ],
    [
      ["blocks", 1, "attributes"],
      [{ ...full.blocks[1].attributes[0], height: "x" }, full.blocks[1].attributes[0]],
      [
        "attribute: blocks[1].attributes[0].height must be a number",
        'duplicate-attribute: Block "TREE", attribute "TAG": The block already has an attribute with the tag "TAG". An insert sets an attribute by its tag, and the tag gives the definition its handle: the leading CAD app discards a drawing in which two objects have one handle',
      ],
    ],
    [
      ["entities", 4],
      { ...kinds.text, Scale: [1, 1], weight: 0.25, neight: 1, ltype: "DD", valu: "T" },
      [
        'format: entities[4]: unknown field "Scale"',
        'format: entities[4]: unknown field "weight"',
        'format: entities[4]: unknown field "neight". Did you mean "height"?',
        'format: entities[4]: unknown field "ltype". Did you mean "linetype"?',
        'format: entities[4]: unknown field "valu". Did you mean "value"?',
      ],
    ],
    [
      ["textStyles", 0],
      { ...full.textStyles[0], line: 1 },
      ['text-style: textStyles[0]: unknown field "line"'],
    ],
    [
      ["layers", 1],
      { name: "WALL", color: 1, colour: 1, clor: 1, linetyep: "DD" },
      [
        'format: layers[1]: unknown field "colour". Did you mean "color"?',
        'format: layers[1]: unknown field "clor". Did you mean "color"?',
        'format: layers[1]: unknown field "linetyep". Did you mean "linetype"?',
      ],
    ],
    [
      ["entities", 0],
      { ...kinds.line, lineWeight: 0.25, weight: 0.25, layers: "0", thickness: 2 },
      [
        'format: entities[0]: unknown field "lineWeight". Did you mean "lineweight"?',
        'format: entities[0]: unknown field "weight". Did you mean "lineweight"?',
        'format: entities[0]: unknown field "layers". Did you mean "layer"?',
        'format: entities[0]: unknown field "thickness"',
      ],
    ],
    [
      ["layouts", 0],
      HOLE,
      ["layout: layouts has no item at index 0. An array cannot have empty slots"],
    ],
    [
      ["layouts", 0, "viewports", 0, "ratio"],
      "x",
      ['viewport: viewport #0 of layout "C-101": The ratio must be a finite number'],
    ],
    [
      ["layouts", 0, "entities", 0, "from"],
      5,
      ["format: layouts[0].entities[0].from must be a point, [x, y]"],
    ],
    // A viewport has no scale and no point named `at`, which other objects have: no hint.
    [
      ["layouts", 0, "viewports", 0],
      { ...full.layouts[0].viewports[0], scale: 2, at: [0, 0], centre: [0, 0], widht: 2 },
      [
        'viewport: layouts[0].viewports[0]: unknown field "scale"',
        'viewport: layouts[0].viewports[0]: unknown field "at"',
        'viewport: layouts[0].viewports[0]: unknown field "centre". Did you mean "center"?',
        'viewport: layouts[0].viewports[0]: unknown field "widht". Did you mean "width"?',
      ],
    ],
    [
      ["layouts", 1],
      { ...full.layouts[1], papr: "ANSI B", plotstyle: "acad.ctb", viewport: [], units: "in" },
      [
        'layout: layouts[1]: unknown field "papr". Did you mean "paper"?',
        'layout: layouts[1]: unknown field "plotstyle". Did you mean "plotStyle"?',
        'layout: layouts[1]: unknown field "viewport". Did you mean "viewports"?',
        'layout: layouts[1]: unknown field "units"',
      ],
    ],
  ];
  for (const [path, value, expected] of cases) {
    const found = errors(replaced(full, path, value) as Drawing);
    assert.deepEqual(
      found.map((d) => `${d.rule}: ${d.message}`),
      expected,
      path.join("."),
    );
  }
});
