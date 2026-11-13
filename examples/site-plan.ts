// A permit-style site plan: a lot from its plat dimensions, with setbacks, a building footprint,
// the street, labels, dimensions, site data and notes, on a sheet with a border and a title
// block. Copy this file to start a drawing.
//
// The drawing has two spaces, as a drafter keeps them:
//
// - Model space holds the site at its true size, in feet, with the annotation that is read in
//   the plan: bearings, dimensions and labels.
// - The layout `C-101` holds the sheet, in inches of paper: the border and the title block, the
//   column of notes, the view title, the north arrow and the graphic scale. One viewport shows
//   the plan on it at the scale.
//
// The export `intent` says what the plan must hold to: the residence keeps out of the
// setbacks. `tsdraft render` and `tsdraft dev` check it on each build, with `checkIntent`, and
// warn of a footprint that crosses a setback line.
//
// Sheet: ARCH D, 36 wide and 24 tall. Scale: 1" = 10', a ratio of 120.
//
//   +----------------------------------------------+
//   | +-------------------------------+  SITE DATA |   The border is 1/2 in inside the edge of
//   | |                               |  GENERAL   |   the paper. The viewport is the left 27 in
//   | |           viewport            |  NOTES     |   of the drawing area, above a strip for
//   | |          (the plan)           |  LEGEND    |   the view title. A column 7 in wide holds
//   | |                               |  ABBREV.   |   the notes, and the title block is at its
//   | +-------------------------------+ +--------+ |   foot, in the lower right corner: 6 1/2 in
//   |  N  view title   graphic scale    | title  | |   wide and 3 in tall.
//   |                                   | block  | |
//   +----------------------------------------------+
//
// The sheet holds the plan at 1" = 10' and at 1" = 20'. At a larger scale the plan is taller
// than its viewport.
//
// Run with `pnpm example`. It writes examples/out/site-plan.dxf (AutoCAD 2018 DXF),
// site-plan.svg, which is model space, and site-plan-sheet.svg, which is the layout as it
// plots. The drawing is also the default export, for a tool that takes a drawing file, and
// `sitePlan(ratio)` builds the sheet at another ratio.
//
// How it is put together:
// - The parameters come first, and every position is worked out from them.
// - What belongs to the site is drawn in model space, in feet. What belongs to the paper is
//   drawn inside `d.layout(...)`, in inches, at the size it plots.
// - An annotation of the plan is in model space, sized by how large it plots: `paper` turns
//   inches on paper into feet for the viewport's ratio. So the same code draws the sheet at
//   another ratio: the plan changes size in its viewport and its text keeps its plotted
//   height.
// - The drawing is drawn to a standard, `standard`, which extends the built-in one with the
//   layer `V-TREE`. A layer is named, and its color, linetype, pen and plot flag are the
//   standard's. Its entities draw ByLayer, and one that plots heavier than its layer names a
//   pen of the standard.
// - Every text is in the sheet's text style, `NOTES`, through `put`, and is justified to its
//   point with `align` and `valign`. Columns and line breaks are laid out by the length
//   `measureText` gives a text in the style's font.
// - A symbol is a block, drawn once and inserted where it is needed. The tree and the property
//   corner are in the plan and in the legend, so each is inserted in model space and on the
//   layout. A block's entities are on layer 0, so each insert draws on its own layer.
// - The border and the title block are one block, `TITLE BLOCK`, drawn by `titleBlock`. Its
//   fields are attributes, and the insert on the layout gives each its value. In CAD each
//   stays an attribute. `titleBlock` and `TITLE_BLOCK` can be copied by themselves.
import { mkdirSync, writeFileSync } from "node:fs";
import {
  BUILT_IN_STANDARD,
  checkIntent,
  createDrawing,
  defineStandard,
  fromPaper,
  PAPERS,
  toDXF,
  toSVG,
  type Drawing,
  type DrawingBuilder,
  type Intent,
  type Point,
  type TextAlign,
  type TextVerticalAlign,
} from "../src/index.ts";
import { arrowhead, textWidth } from "./lib/drafting.ts";

/**
 * The standard the sheet is drawn to: the built-in one, with a layer for the trees. Its layers
 * give the plan its colors, linetypes and pens, and its linetype scale sizes the dashes.
 */
export const standard = defineStandard({
  id: "site-plan-example",
  version: "1",
  extends: BUILT_IN_STANDARD,
  layers: { "V-TREE": { color: 3, pen: "fine", discipline: "V" } },
});

/** A builder of a drawing drawn to the standard. */
type Builder = DrawingBuilder<"R2018", number, typeof standard>;

// The sheet. Lengths on it are inches of paper, from its lower-left corner. The paper is full
// bleed, with no margin a plotter keeps clear, so the border sets the edge of the drawing:
// it is `margin` inside the paper, and nothing is drawn outside it.
const sheet = { number: "C-101", title: "SITE PLAN", paper: "ARCH D", margin: 1 / 2 } as const;
const project = {
  name: "RESIDENCE AT LOT 12, BLOCK 3",
  date: "2026-11-11",
  drawnBy: "AB",
  checkedBy: "CD",
};
// The layout of the sheet: the width of the column of notes at the right of the drawing area,
// the space between it and the viewport, the height of the strip under the viewport that
// holds the view title, and how far text and symbols keep from the border. The title block is
// at the foot of the column.
const layout = { column: 7, gutter: 1, titleStrip: 1 + 1 / 2, clear: 1 / 4 };
// Text heights on paper, in inches.
const size = { note: 3 / 32, label: 1 / 8, heading: 3 / 16, title: 1 / 4 };
// The sheet's text style and its font, which every length of a text is measured in.
const NOTES = "NOTES";
const FONT = "Arial";

// The scale the viewport shows the plan at, as a ratio, and the drawing's units. A foot is 12
// inches, so an inch on paper is `ratio / 12` feet.
const scale = { ratio: 120, units: "ft" } as const;

// The site, in feet. The lot's front left corner is the origin.
const lot = { name: "LOT 12, BLOCK 3", width: 100, depth: 140 };
const zoning = { district: "R-1 SINGLE-FAMILY", maxCoverage: 40 }; // percent
const setbacks = { front: 25, side: 7.5, rear: 20 }; // required
const house = { width: 52, depth: 44, frontYard: 30, floor: 12.5 }; // the yard is to the garage
const garage = { width: 22, projection: 5 }; // at the right end of the front wall
const driveway = { width: 18, flare: 5 };
const street = { name: "OAK STREET", rightOfWay: 50, pavement: 24 };
const sidewalk = { width: 5, fromLot: 2 };
const trees: { at: Point; radius: number }[] = [
  { at: [15, 112], radius: 5 },
  { at: [50, 130], radius: 6 },
  { at: [85, 111], radius: 5 },
  { at: [28, 12], radius: 5 },
];

// Positions worked out from the site.
const houseX = (lot.width - house.width) / 2;
const houseY = house.frontYard + garage.projection;
const garageX = houseX + house.width - garage.width;
const footprint: Point[] = [
  [houseX, houseY],
  [garageX, houseY],
  [garageX, house.frontYard],
  [houseX + house.width, house.frontYard],
  [houseX + house.width, houseY + house.depth],
  [houseX, houseY + house.depth],
];
const bounds = {
  left: Math.min(...footprint.map((p) => p[0])),
  right: Math.max(...footprint.map((p) => p[0])),
  front: Math.min(...footprint.map((p) => p[1])),
  rear: Math.max(...footprint.map((p) => p[1])),
};
const provided = {
  front: bounds.front,
  side: Math.min(bounds.left, lot.width - bounds.right),
  rear: lot.depth - bounds.rear,
};
const footprintArea = house.width * house.depth + garage.width * garage.projection;
const lotArea = lot.width * lot.depth;
const centerline = -street.rightOfWay / 2;
const pavement = { near: centerline + street.pavement / 2, far: centerline - street.pavement / 2 };
const driveX = garageX + (garage.width - driveway.width) / 2;

const feet = (n: number) => `${n.toFixed(1)}'`;
const squareFeet = (n: number) => `${Math.round(n).toLocaleString("en-US")} SF`;
const acres = (n: number) => `${(n / 43560).toFixed(2)} AC`;

/** A rectangle. */
export interface Box {
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
  readonly top: number;
}

/** The example as a drawing, with where the parts of its sheet lie. */
export interface Sheet {
  readonly drawing: Drawing;
  /** The name of the layout. */
  readonly layout: string;
  /** The part of the paper that is drawn on, inside the border, in inches. */
  readonly drawingArea: Box;
  /** The title block, in the drawing area's lower right corner, in inches. */
  readonly titleBlock: Box;
  /** The box of each field of the title block, by the tag of its attribute, in inches. */
  readonly fields: Readonly<Record<string, Box>>;
  /** The viewport's rectangle on the paper, in inches. */
  readonly viewport: Box;
  /** The part of model space the viewport shows, in drawing units. */
  readonly view: Box;
}

/** A sheet's title block as a block: its name, and where its parts lie on the sheet. */
interface TitleBlock {
  readonly name: string;
  readonly drawingArea: Box;
  readonly box: Box;
  readonly fields: Readonly<Record<string, Box>>;
}

/**
 * The title block: the name of its block, its size on the sheet and the heights of its texts,
 * in inches. `titleBlock` reads this and its arguments, and nothing else of this file.
 */
const TITLE_BLOCK = {
  name: "TITLE BLOCK",
  width: 6.5,
  height: 3,
  text: { label: 1 / 16, field: 1 / 8, title: 3 / 16, number: 5 / 16 },
} as const;

/**
 * Defines the title block's block for a sheet `width` by `height`, in inches: the border,
 * `margin` inside the paper, and a title block in its lower right corner, with an attribute
 * for each field, a table for revisions and an area for a seal. Its texts are in the text
 * style `style`, which the drawing has. The block's base point is the sheet's lower-left
 * corner, so it is inserted on a layout at `[0, 0]`, with the fields in `attributes`.
 *
 * Its lines and texts are on layer 0, so they draw on the layer of the insert. The border and
 * the outline are drawn with the standard's heavy pen.
 */
function titleBlock(
  d: Builder,
  {
    width,
    height,
    margin,
    style,
  }: { width: number; height: number; margin: number; style: string },
): TitleBlock {
  const { name, text } = TITLE_BLOCK;
  const area: Box = { left: margin, bottom: margin, right: width - margin, top: height - margin };
  const box: Box = {
    left: area.right - TITLE_BLOCK.width,
    bottom: area.bottom,
    right: area.right,
    top: area.bottom + TITLE_BLOCK.height,
  };
  // The seal and the revisions take the left 2 in. The fields are in rows at their right: the
  // project, the sheet's title, then four small fields beside the sheet number.
  const split = box.left + 2;
  const number = box.right - 1.75;
  const rows = [box.top - 0.6, box.top - 1.4, box.top - 2.2];
  const middle = (split + number) / 2;
  const cell = (left: number, bottom: number, right: number, top: number): Box => ({
    left,
    bottom,
    right,
    top,
  });
  const seal = cell(box.left, box.top - 2, split, box.top);
  const revisions = cell(box.left, box.bottom, split, seal.bottom);
  const fields = {
    PROJECT: cell(split, rows[0]!, box.right, box.top),
    TITLE: cell(split, rows[1]!, box.right, rows[0]!),
    DATE: cell(split, rows[2]!, middle, rows[1]!),
    SCALE: cell(middle, rows[2]!, number, rows[1]!),
    DRAWN: cell(split, box.bottom, middle, rows[2]!),
    CHECKED: cell(middle, box.bottom, number, rows[2]!),
    SHEET: cell(number, box.bottom, box.right, rows[1]!),
  };
  const pad = 1 / 16;
  /** The small fixed text that names a cell, in its upper left corner. */
  const label = (within: Box, value: string): void => {
    d.text([within.left + pad, within.top - pad], value, {
      height: text.label,
      style,
      valign: "top",
    });
  };
  /** A field: its label, and its attribute at the foot of its cell. */
  const field = (tag: keyof typeof fields, prompt: string, textHeight: number): void => {
    const within = fields[tag];
    label(within, prompt.toUpperCase());
    d.attribute(tag, [within.left + pad, within.bottom + pad * 1.5], {
      value: "-",
      prompt,
      height: textHeight,
      style,
    });
  };

  d.block(name, {}, () => {
    d.rect([area.left, area.bottom], area.right - area.left, area.top - area.bottom, {
      pen: "heavy",
    });
    // The title block's left and top edges. The border is its other two.
    d.polyline(
      [
        [box.left, box.bottom],
        [box.left, box.top],
        [box.right, box.top],
      ],
      false,
      { pen: "heavy" },
    );
    d.line([split, box.bottom], [split, box.top]);
    d.line([box.left, seal.bottom], [split, seal.bottom]);
    for (const y of rows) d.line([split, y], [y === rows[2] ? number : box.right, y]);
    d.line([middle, box.bottom], [middle, rows[1]!]);
    d.line([number, box.bottom], [number, rows[1]!]);

    label(seal, "SEAL");
    // The revisions: a heading, a row that names the columns, and three rows to fill.
    label(revisions, "REVISIONS");
    const rowHeight = (revisions.top - revisions.bottom) / 5;
    const columns = [
      { left: revisions.left, name: "NO." },
      { left: revisions.left + 0.3, name: "DATE" },
      { left: revisions.left + 0.9, name: "DESCRIPTION" },
    ];
    for (let row = 1; row < 5; row++) {
      const y = revisions.top - rowHeight * row;
      d.line([revisions.left, y], [revisions.right, y]);
    }
    for (const column of columns) {
      const top = revisions.top - rowHeight;
      if (column.left > revisions.left) d.line([column.left, revisions.bottom], [column.left, top]);
      label({ ...revisions, left: column.left, top }, column.name);
    }

    field("PROJECT", "Project", text.field);
    field("TITLE", "Sheet title", text.title);
    field("DATE", "Date", text.field);
    field("SCALE", "Scale", text.field);
    field("DRAWN", "Drawn by", text.field);
    field("CHECKED", "Checked by", text.field);
    // The sheet number is the largest text of the sheet, centered in its cell.
    label(fields.SHEET, "SHEET");
    d.attribute(
      "SHEET",
      [(number + box.right) / 2, (fields.SHEET.bottom + fields.SHEET.top) / 2 - pad],
      {
        value: "-",
        prompt: "Sheet number",
        height: text.number,
        style,
        align: "center",
        valign: "middle",
      },
    );
  });
  return { name, drawingArea: area, box, fields };
}

/** Builds the sheet with its plan at `ratio`: 120 is 1" = 10', and 240 is 1" = 20'. */
export function sitePlan(ratio: number = scale.ratio): Sheet {
  const feetPerInch = ratio / 12;
  const scaleLabel = `1" = ${feetPerInch}'`;

  /**
   * A length on paper, in inches, as drawing units in the viewport. Every size and offset of
   * an annotation in model space uses it.
   */
  const paper = (inches: number) => fromPaper(inches, "in", { ratio, units: scale.units });

  // The paper, and the viewport on it: the left part of the drawing area, above the strip for
  // the view title.
  const page = PAPERS[sheet.paper];
  const area: Box = {
    left: sheet.margin,
    bottom: sheet.margin,
    right: page.width - sheet.margin,
    top: page.height - sheet.margin,
  };
  const viewport: Box = {
    left: area.left,
    bottom: area.bottom + layout.titleStrip,
    right: area.right - layout.column - layout.gutter,
    top: area.top,
  };
  // The viewport is centered on the plan: the lot and the street's right-of-way. `view` is the
  // part of model space it shows, and the lot stays at the origin at every ratio.
  const planCenter: Point = [lot.width / 2, (lot.depth - street.rightOfWay) / 2];
  const view: Box = {
    left: planCenter[0] - paper(viewport.right - viewport.left) / 2,
    bottom: planCenter[1] - paper(viewport.top - viewport.bottom) / 2,
    right: planCenter[0] + paper(viewport.right - viewport.left) / 2,
    top: planCenter[1] + paper(viewport.top - viewport.bottom) / 2,
  };

  // The standard's linetype patterns are sized for paper: DASHED is a 0.5 dash and a 0.25 gap.
  // On a layout AutoCAD sizes dashes on the paper, in every viewport, so the standard's linetype
  // scale, 1/2, is a paper length and no drawing length: the dashes plot at half their pattern,
  // a 1/4 in dash, at every ratio.
  const d = createDrawing({ units: scale.units, standard });
  d.textStyle({ name: NOTES, font: FONT });
  const widthOf = (value: string, height: number) => textWidth(value, height, FONT);

  /**
   * A text in the sheet's style. `height` is in the units of the space it is drawn in: inches
   * on the layout, and `paper(inches)` in model space. `options` justify it to `at` and turn it.
   */
  function put(
    at: Point,
    value: string,
    height: number,
    options: { align?: TextAlign; valign?: TextVerticalAlign; rotation?: number } = {},
  ): void {
    d.text(at, value, { height, style: NOTES, ...options });
  }

  // The symbols. A block's coordinates are its own, and its base point is its origin.
  d.block("TREE", {}, () => {
    // The canopy, one foot in radius, and a cross at the trunk.
    d.circle([0, 0], 1);
    d.line([-0.15, 0], [0.15, 0]);
    d.line([0, -0.15], [0, 0.15]);
  });
  // The other symbols are in inches, at the size they plot. On the layout they are inserted as
  // they are, and in model space at `paper(1)`.
  const gap = 1 / 16; // between a line and its text, in inches
  d.block("PROPERTY CORNER", {}, () => d.circle([0, 0], 1 / 16));
  const arrowRadius = 3 / 8;
  d.block("NORTH ARROW", {}, () => {
    // North is up the block. Its base point is the middle of the circle.
    d.text([0, arrowRadius + gap], "N", { height: size.heading, style: NOTES, align: "center" });
    d.circle([0, 0], arrowRadius);
    d.line([0, -arrowRadius], [0, arrowRadius * 0.4]);
    arrowhead(d, [0, arrowRadius], [0, 0], arrowRadius * 0.9);
  });
  // The view title: the title over a line and the scale under it. Its base point is the left
  // end of the line. The line has one fixed length, long enough for the sheet's view title,
  // and does not follow the title an insert sets. Its tags are its own: a tag of the title
  // block names another field.
  const titleLine = widthOf(sheet.title, size.title) + 1 / 4;
  d.block("VIEW TITLE", {}, () => {
    d.attribute("VIEW_TITLE", [0, gap], {
      value: "VIEW TITLE",
      prompt: "View title",
      height: size.title,
      style: NOTES,
    });
    d.line([0, 0], [titleLine, 0]);
    d.attribute("VIEW_SCALE", [0, -gap], {
      value: "SCALE: 1\" = 10'",
      prompt: "Scale",
      height: size.label,
      style: NOTES,
      valign: "top",
    });
  });
  const block = titleBlock(d, {
    width: page.width,
    height: page.height,
    margin: sheet.margin,
    style: NOTES,
  });

  // Model space: the site, at its true size in feet.
  d.layer("C-PROP", () => d.rect([0, 0], lot.width, lot.depth, { id: "lot" }));
  d.layer("C-PROP-ADJC", () => {
    // The adjoining lot lines and the street run to the sides of the view.
    for (const y of [0, lot.depth]) {
      d.line([view.left, y], [0, y]);
      d.line([lot.width, y], [view.right, y]);
    }
    // The far side of the street's right-of-way.
    d.line([view.left, -street.rightOfWay], [view.right, -street.rightOfWay]);
  });
  d.layer("C-PROP-MONU", () => {
    for (const x of [0, lot.width]) {
      for (const y of [0, lot.depth]) d.insert("PROPERTY CORNER", [x, y], { scale: paper(1) });
    }
  });
  d.layer("C-SETB", () => {
    const { front, side, rear } = setbacks;
    d.rect([side, front], lot.width - side * 2, lot.depth - front - rear);
  });
  d.layer("C-BLDG", () => d.polyline(footprint, true, { id: "residence" }));

  d.layer("C-PAVE", () => {
    // The driveway, flared to the street with a quarter circle on each side.
    const flareY = pavement.near + driveway.flare;
    d.line([driveX, bounds.front], [driveX, flareY]);
    d.arc([driveX - driveway.flare, flareY], driveway.flare, 270, 0);
    d.line([driveX + driveway.width, bounds.front], [driveX + driveway.width, flareY]);
    d.arc([driveX + driveway.width + driveway.flare, flareY], driveway.flare, 180, 270);
    // The near edge of pavement and the sidewalk stop at the driveway.
    const open = { from: driveX - driveway.flare, to: driveX + driveway.width + driveway.flare };
    d.line([view.left, pavement.near], [open.from, pavement.near]);
    d.line([open.to, pavement.near], [view.right, pavement.near]);
    d.line([view.left, pavement.far], [view.right, pavement.far]);
    for (const y of [-sidewalk.fromLot, -sidewalk.fromLot - sidewalk.width]) {
      d.line([view.left, y], [driveX, y]);
      d.line([driveX + driveway.width, y], [view.right, y]);
    }
  });
  d.layer("C-ROAD-CNTR", () => d.line([view.left, centerline], [view.right, centerline]));
  d.layer("V-TREE", () => {
    for (const tree of trees) d.insert("TREE", tree.at, { scale: tree.radius });
  });

  // The plan's annotation, in model space with what it describes. Its sizes are paper sizes,
  // turned into feet for the viewport's ratio.
  const text = { note: paper(size.note), label: paper(size.label), heading: paper(size.heading) };
  const near = paper(gap); // between a line and its text
  const clear = paper(1 / 8); // between a heavy line and its text

  // The dimensions are AutoCAD's own: each measures the two points it is given, and writes
  // what it measures. Their style has paper sizes in inches and the scale of this view, so a
  // sheet at another ratio needs the same style at another scale, under another name.
  const dimensions = `DIMS-${feetPerInch}`;
  d.dimensionStyle({
    name: dimensions,
    textStyle: NOTES,
    textHeight: size.note,
    arrowhead: "architectural-tick",
    arrowSize: 1 / 8,
    extensionOffset: gap,
    extensionBeyond: 1 / 8,
    textGap: gap,
    scale: paper(1),
    precision: 1,
    suffix: "'",
  });
  // One string across the lot, behind the building, and one up it, outside the east line.
  // Each runs through the building's corners, and ends on a lot line.
  const across = bounds.rear + paper(3 / 8);
  const up = lot.width + paper(5 / 8);
  d.layer("C-ANNO-DIMS", () => {
    const acrossLot: Point[] = [
      [0, across],
      [bounds.left, bounds.rear],
      [bounds.right, bounds.rear],
      [lot.width, across],
    ];
    const upLot: Point[] = [
      [lot.width, 0],
      [bounds.right, bounds.front],
      [bounds.right, bounds.rear],
      [lot.width, lot.depth],
    ];
    for (let i = 1; i < acrossLot.length; i++) {
      d.linearDimension(acrossLot[i - 1]!, acrossLot[i]!, [0, across], { style: dimensions });
    }
    for (let i = 1; i < upLot.length; i++) {
      d.linearDimension(upLot[i - 1]!, upLot[i]!, [up, 0], { style: dimensions, along: "y" });
    }
  });

  d.layer("C-ANNO-TEXT", () => {
    const { note, label, heading } = text;
    const middle = lot.width / 2;

    // Bearings and distances, clockwise from the northwest corner. Each sits outside its line,
    // but for the front one, which is inside the lot, clear of the sidewalk and the driveway.
    const course = (bearing: string, length: number) => `${bearing}  ${length.toFixed(2)}'`;
    const sideMiddle = (across + lot.depth) / 2;
    put([middle, lot.depth + clear], course(`N 90°00'00" E`, lot.width), note, { align: "center" });
    put([lot.width + clear + note, sideMiddle], course(`S 00°00'00" E`, lot.depth), note, {
      align: "center",
      rotation: 90,
    });
    put([driveX / 2, clear], course(`S 90°00'00" W`, lot.width), note, { align: "center" });
    put([-clear, sideMiddle], course(`N 00°00'00" W`, lot.depth), note, {
      align: "center",
      rotation: 90,
    });

    // Setbacks, each along its line.
    const { front, side, rear } = setbacks;
    const inset = side + paper(1 / 4);
    put([inset, front + near], `${front}' FRONT SETBACK`, note);
    put([inset, lot.depth - rear + near], `${rear}' REAR SETBACK`, note);
    for (const x of [side, lot.width - side]) {
      put([x - near, (front + bounds.rear) / 2], `${side}' SIDE SETBACK`, note, {
        align: "center",
        rotation: 90,
      });
    }

    // The lot, the building and the pavement.
    stack(
      [middle, (across + lot.depth - rear) / 2],
      [
        [lot.name, heading],
        [`${squareFeet(lotArea)} (${acres(lotArea)})`, label],
      ],
    );
    stack(
      [(bounds.left + bounds.right) / 2, houseY + house.depth / 2],
      [
        ["PROPOSED", heading],
        ["RESIDENCE", heading],
        [`${squareFeet(footprintArea)} FOOTPRINT`, label],
        [`F.F.E. ${house.floor.toFixed(2)}'`, label],
      ],
    );
    put([driveX + driveway.width / 2, setbacks.front / 2], "CONC. DRIVEWAY", note, {
      align: "center",
      valign: "middle",
      rotation: 90,
    });
    put([0, -sidewalk.fromLot - sidewalk.width / 2], `${sidewalk.width}' CONC. SIDEWALK`, note, {
      valign: "middle",
    });
    put([0, pavement.near - near], "EDGE OF PAVEMENT", note, { valign: "top" });
    const rightOfWay = `${street.rightOfWay}' PUBLIC RIGHT-OF-WAY`;
    put([middle, centerline + clear], rightOfWay, note, { align: "center" });
    put([middle, centerline + clear + note + near * 1.5], street.name, heading, {
      align: "center",
    });
    put([view.right - clear, centerline + near], "CENTERLINE", note, { align: "right" });

    // The adjoining lots, each an inch outside its lot line and reading along it.
    put([-paper(1), lot.depth / 2], "LOT 11", label, { align: "center", rotation: 90 });
    put([lot.width + paper(1) + label, lot.depth / 2], "LOT 13", label, {
      align: "center",
      rotation: 90,
    });
    put([middle, lot.depth + paper(1)], "LOT 27", label, { align: "center" });
  });

  /** Lines of text in model space, each with its height, centered on `center` as one block. */
  function stack(
    center: Point,
    lines: readonly (readonly [value: string, height: number])[],
  ): void {
    const height = lines.reduce((sum, line) => sum + line[1], 0) + near * 1.5 * (lines.length - 1);
    let top = center[1] + height / 2;
    for (const [value, lineHeight] of lines) {
      put([center[0], top - lineHeight], value, lineHeight, { align: "center" });
      top -= lineHeight + near * 1.5;
    }
  }

  // The sheet: everything drawn inside `d.layout` is on the paper, in inches.
  d.layout(sheet.number, { paper: sheet.paper }, (paperSheet) => {
    // The border and the title block, with the sheet's fields.
    d.layer("G-ANNO-TTLB", () => {
      d.insert(block.name, [0, 0], {
        id: "title-block",
        attributes: {
          PROJECT: project.name,
          TITLE: sheet.title,
          DATE: project.date,
          SCALE: scaleLabel,
          DRAWN: project.drawnBy,
          CHECKED: project.checkedBy,
          SHEET: paperSheet.name,
        },
      });
    });

    // The plan, at the ratio. A viewport's border is on a layer that does not plot.
    d.layer("G-ANNO-NPLT", () => {
      const [width, height] = [viewport.right - viewport.left, viewport.top - viewport.bottom];
      paperSheet.viewport([viewport.left, viewport.bottom], width, height, {
        center: planCenter,
        ratio,
        id: "plan",
      });
    });

    // The view title, under the viewport: the north arrow, the title and the graphic scale in
    // a row. The underline of the title is level with the middle of the north arrow.
    const underline = area.bottom + layout.clear + arrowRadius;
    const titleX = area.left + layout.clear + arrowRadius * 2 + 3 / 8;
    d.layer("C-ANNO-TITL", () => {
      d.insert("VIEW TITLE", [titleX, underline], {
        attributes: { VIEW_TITLE: sheet.title, VIEW_SCALE: `SCALE: ${scaleLabel}` },
      });
    });
    d.layer("C-ANNO-SYMB", () => {
      // The viewport is not turned, so north is up the sheet.
      d.insert("NORTH ARROW", [area.left + layout.clear + arrowRadius, underline]);

      // A graphic scale 2 in long, divided at 1/2 in and 1 in, and numbered in feet of the
      // plan at the viewport's ratio.
      const bar = { x: titleX + titleLine + 3 / 4, length: 2, height: 1 / 8 };
      const y = underline - bar.height;
      const stops = [0, 1 / 4, 1 / 2, 1]; // shares of the bar's length
      d.rect([bar.x, y], bar.length, bar.height);
      for (const stop of stops.slice(1, -1)) {
        d.line([bar.x + bar.length * stop, y], [bar.x + bar.length * stop, y + bar.height]);
      }
      d.line([bar.x, y + bar.height / 2], [bar.x + bar.length / 4, y + bar.height / 2]);
      for (const stop of stops) {
        const at: Point = [bar.x + bar.length * stop, y + bar.height + gap];
        put(at, String(stop * bar.length * feetPerInch), size.note, { align: "center" });
      }
      put([bar.x + bar.length + 1 / 8, y], "FEET", size.note);
    });

    // The column of notes: site data, general notes, legend and abbreviations, from the top of
    // the drawing area down. `row` is the baseline of the next line.
    const column = { left: area.right - layout.column, width: layout.column - layout.clear };
    const leading = size.label * 1.8; // from one line to the next
    const blockGap = 3 / 4; // between two blocks of the column
    let row = area.top - layout.clear;

    function columnHeading(title: string): void {
      row -= size.heading;
      d.layer("C-ANNO-TITL", () => {
        put([column.left, row], title, size.heading);
        d.line([column.left, row - gap], [column.left + column.width, row - gap]);
      });
      row -= gap + leading * 1.2;
    }

    /**
     * Rows of cells in columns. The first column is `first` wide, and each later one starts a
     * gap past the widest text of the one before it.
     */
    function table(rows: readonly (readonly string[])[], first: number): void {
      const starts = [0, first];
      for (let i = 1; i < Math.max(...rows.map((cells) => cells.length)) - 1; i++) {
        const widest = Math.max(...rows.map((cells) => widthOf(cells[i] ?? "", size.label)));
        starts.push((starts[i] ?? 0) + widest + 1 / 2);
      }
      for (const cells of rows) {
        cells.forEach((cell, i) => put([column.left + (starts[i] ?? 0), row], cell, size.label));
        row -= leading;
      }
    }

    /** Breaks a sentence into lines no longer than `width`, by the length each plots at. */
    function wrap(sentence: string, height: number, width: number): string[] {
      const lines: string[] = [];
      let line = "";
      for (const word of sentence.split(" ")) {
        const longer = line ? `${line} ${word}` : word;
        if (line && widthOf(longer, height) > width) {
          lines.push(line);
          line = word;
        } else {
          line = longer;
        }
      }
      return [...lines, line];
    }

    columnHeading("SITE DATA");
    d.layer("C-ANNO-TEXT", () => {
      const coverage = (footprintArea / lotArea) * 100;
      const nameColumn = widthOf("BUILDING FOOTPRINT", size.label) + 1 / 2;
      table(
        [
          ["PARCEL", lot.name],
          ["ZONING", zoning.district],
          ["LOT AREA", `${squareFeet(lotArea)} (${acres(lotArea)})`],
          ["BUILDING FOOTPRINT", squareFeet(footprintArea)],
          ["LOT COVERAGE", `${coverage.toFixed(1)}% (${zoning.maxCoverage}% MAX.)`],
          ["FINISHED FLOOR", `ELEV. ${house.floor.toFixed(2)}'`],
        ],
        nameColumn,
      );
      row -= leading / 2;
      // The setbacks the zoning requires, beside the ones measured from the footprint.
      table(
        [
          ["SETBACK", "REQUIRED", "PROVIDED"],
          ["FRONT", feet(setbacks.front), feet(provided.front)],
          ["SIDE", feet(setbacks.side), feet(provided.side)],
          ["REAR", feet(setbacks.rear), feet(provided.rear)],
        ],
        nameColumn,
      );
    });

    row -= blockGap;
    columnHeading("GENERAL NOTES");
    d.layer("C-ANNO-TEXT", () => {
      const notes = [
        "PROPERTY LINES ARE DRAWN FROM THE RECORDED PLAT. NO FIELD SURVEY WAS MADE FOR THIS PLAN.",
        "DIMENSIONS ARE IN FEET, MEASURED TO THE OUTSIDE FACE OF THE FOUNDATION WALL.",
        "SETBACKS ARE MEASURED AT RIGHT ANGLES FROM THE PROPERTY LINE TO THE NEAREST WALL.",
        "THE FINISHED FLOOR ELEVATION IS ON AN ASSUMED DATUM.",
        "LOCATE ALL UNDERGROUND UTILITIES BEFORE DIGGING.",
        "GRADE THE LOT TO DRAIN AWAY FROM THE BUILDING AND TOWARD THE STREET. KEEP RUNOFF OFF THE ADJOINING LOTS.",
        "PUT EROSION CONTROL IN PLACE BEFORE CLEARING, AND KEEP IT UNTIL THE LOT IS STABILIZED.",
        "PROTECT THE EXISTING TREES SHOWN. NO TREE IS TO BE REMOVED.",
        "WORK IN THE PUBLIC RIGHT-OF-WAY NEEDS ITS OWN PERMIT.",
        "REPLACE ANY SIDEWALK OR PAVEMENT DAMAGED DURING CONSTRUCTION.",
      ];
      const indent = widthOf("00. ", size.label);
      notes.forEach((note, i) => {
        put([column.left, row], `${i + 1}.`, size.label);
        for (const line of wrap(note, size.label, column.width - indent)) {
          put([column.left + indent, row], line, size.label);
          row -= leading;
        }
        row -= leading / 3;
      });
    });

    // The legend shows each line of the plan on its own layer, and each symbol as the block
    // the plan inserts. Dashes are as long here as in the viewport, since AutoCAD sizes both
    // on the paper.
    row -= blockGap;
    columnHeading("LEGEND");
    const sample = 2; // the length of a legend line
    function legendRow(layer: keyof typeof standard.layers, name: string, draw: () => void): void {
      d.layer(layer, draw);
      d.layer("C-ANNO-TEXT", () => {
        put([column.left + sample + 3 / 8, row], name, size.label);
      });
      row -= leading * 1.5;
    }
    const sampleLine = () =>
      d.line([column.left, row + size.label / 2], [column.left + sample, row + size.label / 2]);
    const sampleCenter = (): Point => [column.left + sample / 2, row + size.label / 2];
    legendRow("C-PROP", "PROPERTY LINE", sampleLine);
    legendRow("C-PROP-ADJC", "ADJOINING LOT LINE", sampleLine);
    legendRow("C-SETB", "BUILDING SETBACK LINE", sampleLine);
    legendRow("C-BLDG", "BUILDING FOOTPRINT", sampleLine);
    legendRow("C-PAVE", "EDGE OF PAVEMENT OR CONCRETE", sampleLine);
    legendRow("C-ROAD-CNTR", "STREET CENTERLINE", sampleLine);
    legendRow("C-PROP-MONU", "PROPERTY CORNER", () => d.insert("PROPERTY CORNER", sampleCenter()));
    row -= leading / 2;
    // The tree is one foot in radius in its block, and 3/16 in on the paper.
    legendRow("V-TREE", "EXISTING TREE TO REMAIN", () =>
      d.insert("TREE", sampleCenter(), { scale: 3 / 16 }),
    );

    row -= blockGap;
    columnHeading("ABBREVIATIONS");
    d.layer("C-ANNO-TEXT", () => {
      table(
        [
          ["AC", "ACRES"],
          ["CONC.", "CONCRETE"],
          ["ELEV.", "ELEVATION"],
          ["F.F.E.", "FINISHED FLOOR ELEVATION"],
          ["MAX.", "MAXIMUM"],
          ["SF", "SQUARE FEET"],
        ],
        widthOf("F.F.E.", size.label) + 1 / 2,
      );
    });
  });

  return {
    drawing: d.build(),
    layout: sheet.number,
    drawingArea: block.drawingArea,
    titleBlock: block.box,
    fields: block.fields,
    viewport,
    view,
  };
}

const example = sitePlan();
const drawing = example.drawing;
export default drawing;

/**
 * What the plan must hold to: the residence keeps out of the setbacks. The lot's sides run
 * counterclockwise from its front left corner, as `rect` draws them: the front, the right side,
 * the rear and the left side.
 */
export const intent: Intent = {
  setbacks: [
    {
      property: "lot",
      footprints: ["residence"],
      distance: [setbacks.front, setbacks.side, setbacks.rear, setbacks.side],
    },
  ],
};

// Run as a script, the example writes its files. Imported, it only hands over the drawing.
if (import.meta.main) {
  const outDir = new URL("./out/", import.meta.url);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(new URL("site-plan.dxf", outDir), toDXF(drawing));
  writeFileSync(new URL("site-plan.svg", outDir), toSVG(drawing));
  writeFileSync(new URL("site-plan-sheet.svg", outDir), toSVG(drawing, { layout: example.layout }));
  const onSheet = drawing.layouts?.[0]?.entities.length ?? 0;
  console.log(
    `Wrote ${drawing.entities.length} entities in model space and ${onSheet} on the sheet, ` +
      `on ${drawing.layers.length} layers, to examples/out/`,
  );
  const warnings = checkIntent(drawing, intent);
  console.log(
    warnings.length === 0
      ? "The residence keeps out of every setback"
      : warnings.map((w) => w.message).join("\n"),
  );
}
