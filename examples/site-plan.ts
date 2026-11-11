// A permit-style site plan: a lot from its plat dimensions, with setbacks, a building footprint,
// the street, labels, dimensions, site data and notes. Copy this file to start a drawing.
//
// Sheet: ARCH D, 24 x 36 in, landscape: 36 wide and 24 tall. Scale: 1" = 10', a ratio of 120.
// Units are feet, in model space. The sheet is laid out in inches on paper:
//
//   +----------------------------------------------+
//   |                                 |  SITE DATA |   The drawing area is the sheet less a
//   |                                 |  GENERAL   |   1/2 in margin. The plan is centered in
//   |                                 |  NOTES     |   its left 27 in, with its view title under
//   |              plan               |  LEGEND    |   it at the lower left. A column 7 in wide
//   |                                 |  ABBREV.   |   holds the notes.
//   |                                 |            |
//   |  view title                     |  (title    |   The title block will go in the sheet's
//   |                                 |   block)   |   lower right corner: 6 1/2 in wide and
//   +----------------------------------------------+   3 in tall are kept clear for it, at the
//                                                      foot of the column, and the notes stop
//                                                      above that space.
//
// The sheet holds the plan at 1" = 10' and at 1" = 20'. At a larger scale the plan is taller
// than the sheet.
//
// There is no border and no title block, and the sheet's edge is not drawn: they belong to
// paper space, which tsdraft does not have yet.
//
// Run with `pnpm example`. It writes examples/out/site-plan.dxf (AutoCAD 2018 DXF) and
// site-plan.svg. The drawing is also the default export, for a tool that takes a drawing file,
// and `sitePlan(ratio)` builds the sheet at another ratio.
//
// How it is put together:
// - The parameters come first, and every position is worked out from them.
// - The sheet is a parameter too. Its rectangle and its drawing area are worked out in drawing
//   units for the ratio, around the plan, and every block of notes is placed from them.
// - Each layer sets a linetype and a pen weight, and its entities draw ByLayer.
// - The site is in feet. Text, symbols, dashes and every annotation offset are sized by how
//   large they plot: `paper` turns inches on paper into drawing units for the ratio in `view`,
//   so the sheet still reads when the ratio changes.
// - Every text is in the sheet's text style, `NOTES`, through `put`, and is justified to its
//   point with `align` and `valign`. Only columns and line breaks use an estimated width.
// - A symbol is a block, drawn once and inserted where it is needed: the tree, the property
//   corner, the north arrow and the view title. The tree is drawn one foot in radius and
//   inserted at each tree's radius. The others are drawn in inches at the size they plot, and
//   inserted at `paper(1)`. Their entities are on layer 0, so each insert draws on its own
//   layer. The view title's text and scale are attributes, which each insert sets.
import { mkdirSync, writeFileSync } from "node:fs";
import {
  CENTER,
  createDrawing,
  DASHED,
  fromPaper,
  PHANTOM,
  toDXF,
  toSVG,
  type Drawing,
  type Point,
  type TextAlign,
  type TextVerticalAlign,
} from "../src/index.ts";
import { arrowhead, dimensionChain, textWidth, type DimensionStyle } from "./lib/drafting.ts";

// The sheet, in inches on paper. It is full bleed: the border will sit `margin` inside its edge,
// and nothing is drawn outside the border.
const sheet = { name: "ARCH D", width: 36, height: 24, margin: 1 / 2 };
// The layout, in inches on paper: the width of the column of notes at the right of the drawing
// area, the space between it and the plan, and the space kept clear for a title block in the
// lower right corner of the drawing area. The column is the wider of the two, so the title
// block sits at its foot.
const layout = { column: 7, gutter: 1, titleBlock: { width: 6 + 1 / 2, height: 3 } };

// The scale the sheet plots at, as a ratio, and the drawing's units. A foot is 12 inches, so an
// inch on paper is `ratio / 12` feet.
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

/** A rectangle of the sheet, in drawing units. */
export interface Box {
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
  readonly top: number;
}

/** The sheet as a drawing, with where it lies in the drawing's coordinates. */
export interface Sheet {
  readonly drawing: Drawing;
  /** The edge of the sheet. It is not drawn. */
  readonly sheetEdge: Box;
  /** The part of the sheet that is drawn on: the sheet less its margin. */
  readonly drawingArea: Box;
  /** The space kept clear for the title block, in the drawing area's lower right corner. */
  readonly titleBlockSpace: Box;
}

/** Builds the sheet to plot at `ratio`: 120 is 1" = 10', and 240 is 1" = 20'. */
export function sitePlan(ratio: number = scale.ratio): Sheet {
  const view = { ratio, units: scale.units };
  const feetPerInch = ratio / 12;
  const scaleLabel = `1" = ${feetPerInch}'`;

  /** A length on paper, in inches, as drawing units. Every annotation size and offset uses it. */
  const paper = (inches: number) => fromPaper(inches, "in", view);

  // Plotted sizes, in drawing units.
  const text = {
    note: paper(3 / 32),
    label: paper(1 / 8),
    heading: paper(3 / 16),
    title: paper(1 / 4),
  };
  const gap = paper(1 / 16); // between a line and its text
  const clear = paper(1 / 8); // between a heavy line and its text
  const tick = paper(1 / 16); // half a dimension tick
  const leading = text.label * 1.8; // from one line of the column of notes to the next
  const blockGap = paper(3 / 4); // between two blocks of the column

  // The sheet, in drawing units. The plan is centered in its part of the drawing area, which
  // puts the sheet around the site: the lot stays at the origin at every ratio.
  const planCenter: Point = [lot.width / 2, (lot.depth - street.rightOfWay) / 2];
  const areaWidth = paper(sheet.width - sheet.margin * 2);
  const areaHeight = paper(sheet.height - sheet.margin * 2);
  const planWidth = areaWidth - paper(layout.column + layout.gutter);
  const areaLeft = planCenter[0] - planWidth / 2;
  const areaBottom = planCenter[1] - areaHeight / 2;
  const drawingArea: Box = {
    left: areaLeft,
    bottom: areaBottom,
    right: areaLeft + areaWidth,
    top: areaBottom + areaHeight,
  };
  const sheetEdge: Box = {
    left: drawingArea.left - paper(sheet.margin),
    bottom: drawingArea.bottom - paper(sheet.margin),
    right: drawingArea.right + paper(sheet.margin),
    top: drawingArea.top + paper(sheet.margin),
  };
  const titleBlockSpace: Box = {
    left: drawingArea.right - paper(layout.titleBlock.width),
    bottom: drawingArea.bottom,
    right: drawingArea.right,
    top: drawingArea.bottom + paper(layout.titleBlock.height),
  };
  const column = {
    left: drawingArea.right - paper(layout.column),
    top: drawingArea.top,
    width: paper(layout.column),
  };
  // The street and the adjoining lot lines run to the sides of the plan's part of the sheet.
  const ends = { left: drawingArea.left, right: drawingArea.left + planWidth };

  // AutoCAD's linetype patterns are sized for paper: DASHED is a 0.5 dash and a 0.25 gap. At this
  // linetype scale they plot at half that, a 1/4 in dash.
  const d = createDrawing({ units: scale.units, linetypeScale: paper(1 / 2) });

  // The sheet's text style. Arial's capitals are about 0.9 of the text height wide.
  const NOTES = "NOTES";
  d.textStyle({ name: NOTES, font: "Arial" });
  const perCharacter = 0.9;
  const widthOf = (value: string, height: number) => textWidth(value, height, perCharacter);

  /** A text in the sheet's style. `options` justify it to `at` and turn it. */
  function put(
    at: Point,
    value: string,
    height: number,
    options: { align?: TextAlign; valign?: TextVerticalAlign; rotation?: number } = {},
  ): void {
    d.text(at, value, { height, style: NOTES, ...options });
  }

  d.layer("C-PROP", { color: 7, linetype: PHANTOM, lineweight: 0.7 });
  d.layer("C-PROP-ADJC", { color: 8, linetype: PHANTOM, lineweight: 0.18 });
  d.layer("C-PROP-MONU", { color: 7, lineweight: 0.25 });
  d.layer("C-SETB", { color: 1, linetype: DASHED, lineweight: 0.25 });
  d.layer("C-BLDG", { color: 5, lineweight: 0.7 });
  d.layer("C-PAVE", { color: 8, lineweight: 0.35 });
  d.layer("C-ROAD-CNTR", { color: 8, linetype: CENTER, lineweight: 0.18 });
  d.layer("V-TREE", { color: 3, lineweight: 0.18 });
  d.layer("C-ANNO-DIMS", { color: 8, lineweight: 0.18 });
  d.layer("C-ANNO-TEXT", { color: 7, lineweight: 0.25 });
  d.layer("C-ANNO-SYMB", { color: 7, lineweight: 0.35 });
  d.layer("C-ANNO-TITL", { color: 7, lineweight: 0.5 });

  // The symbols. A block's coordinates are its own, and its base point is its origin.
  d.block("TREE", {}, () => {
    // The canopy, one foot in radius, and a cross at the trunk.
    d.circle([0, 0], 1);
    d.line([-0.15, 0], [0.15, 0]);
    d.line([0, -0.15], [0, 0.15]);
  });
  // The other symbols are in inches on paper, and `symbolScale` plots them at that size.
  const symbolScale = paper(1);
  const inch = { gap: 1 / 16, note: 3 / 32, label: 1 / 8, heading: 3 / 16, title: 1 / 4 };
  d.block("PROPERTY CORNER", {}, () => d.circle([0, 0], 1 / 16));
  const arrowRadius = 3 / 8;
  d.block("NORTH ARROW", {}, () => {
    // North is up the block. Its base point is the middle of the circle.
    d.text([0, arrowRadius + inch.gap], "N", {
      height: inch.heading,
      style: NOTES,
      align: "center",
    });
    d.circle([0, 0], arrowRadius);
    d.line([0, -arrowRadius], [0, arrowRadius * 0.4]);
    arrowhead(d, [0, arrowRadius], [0, 0], arrowRadius * 0.9);
  });
  // The view title: the title over a line and the scale under it. Its base point is the left
  // end of the line. The line has one fixed length, long enough for the sheet's longest view
  // title, and does not follow the title an insert sets.
  const titleLine = textWidth("SITE PLAN", inch.title, perCharacter) + 1 / 4;
  d.block("VIEW TITLE", {}, () => {
    d.attribute("TITLE", [0, inch.gap], {
      value: "VIEW TITLE",
      prompt: "View title",
      height: inch.title,
      style: NOTES,
    });
    d.line([0, 0], [titleLine, 0]);
    d.attribute("SCALE", [0, -inch.gap], {
      value: "SCALE: 1\" = 10'",
      prompt: "Scale",
      height: inch.label,
      style: NOTES,
      valign: "top",
    });
  });

  d.layer("C-PROP", {}, () => d.rect([0, 0], lot.width, lot.depth));
  d.layer("C-PROP-ADJC", {}, () => {
    for (const y of [0, lot.depth]) {
      d.line([ends.left, y], [0, y]);
      d.line([lot.width, y], [ends.right, y]);
    }
    // The far side of the street's right-of-way.
    d.line([ends.left, -street.rightOfWay], [ends.right, -street.rightOfWay]);
  });
  d.layer("C-PROP-MONU", {}, () => {
    for (const x of [0, lot.width]) {
      for (const y of [0, lot.depth]) d.insert("PROPERTY CORNER", [x, y], { scale: symbolScale });
    }
  });
  d.layer("C-SETB", {}, () => {
    const { front, side, rear } = setbacks;
    d.rect([side, front], lot.width - side * 2, lot.depth - front - rear);
  });
  d.layer("C-BLDG", {}, () => d.polyline(footprint, true));

  d.layer("C-PAVE", {}, () => {
    // The driveway, flared to the street with a quarter circle on each side.
    const flareY = pavement.near + driveway.flare;
    d.line([driveX, bounds.front], [driveX, flareY]);
    d.arc([driveX - driveway.flare, flareY], driveway.flare, 270, 0);
    d.line([driveX + driveway.width, bounds.front], [driveX + driveway.width, flareY]);
    d.arc([driveX + driveway.width + driveway.flare, flareY], driveway.flare, 180, 270);
    // The near edge of pavement and the sidewalk stop at the driveway.
    const open = { from: driveX - driveway.flare, to: driveX + driveway.width + driveway.flare };
    d.line([ends.left, pavement.near], [open.from, pavement.near]);
    d.line([open.to, pavement.near], [ends.right, pavement.near]);
    d.line([ends.left, pavement.far], [ends.right, pavement.far]);
    for (const y of [-sidewalk.fromLot, -sidewalk.fromLot - sidewalk.width]) {
      d.line([ends.left, y], [driveX, y]);
      d.line([driveX + driveway.width, y], [ends.right, y]);
    }
  });
  d.layer("C-ROAD-CNTR", {}, () => d.line([ends.left, centerline], [ends.right, centerline]));
  d.layer("V-TREE", {}, () => {
    for (const tree of trees) d.insert("TREE", tree.at, { scale: tree.radius });
  });

  // One string of dimensions across the lot, behind the building, and one up it, outside the east
  // line. Each runs through the building's corners.
  const across = bounds.rear + paper(3 / 8);
  const up = lot.width + paper(5 / 8);
  d.layer("C-ANNO-DIMS", {}, () => {
    const style: DimensionStyle = {
      text: text.note,
      tick,
      gap,
      extend: gap,
      format: feet,
      textStyle: NOTES,
      perCharacter,
    };
    dimensionChain(
      d,
      [
        [0, across],
        [bounds.left, bounds.rear],
        [bounds.right, bounds.rear],
        [lot.width, across],
      ],
      "x",
      across,
      // A side setback line crosses each side yard's segment. The segment's text is centered in
      // the part between that line and the building, so the line cannot run through it.
      {
        ...style,
        textAt: (from, to) =>
          (Math.max(from, setbacks.side) + Math.min(to, lot.width - setbacks.side)) / 2,
      },
    );
    dimensionChain(
      d,
      [
        [lot.width, 0],
        [bounds.right, bounds.front],
        [bounds.right, bounds.rear],
        [lot.width, lot.depth],
      ],
      "y",
      up,
      style,
    );
  });

  d.layer("C-ANNO-TEXT", {}, () => {
    const { note, label: size, heading } = text;
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
    put([inset, front + gap], `${front}' FRONT SETBACK`, note);
    put([inset, lot.depth - rear + gap], `${rear}' REAR SETBACK`, note);
    for (const x of [side, lot.width - side]) {
      put([x - gap, (front + bounds.rear) / 2], `${side}' SIDE SETBACK`, note, {
        align: "center",
        rotation: 90,
      });
    }

    // The lot, the building and the pavement.
    stack(
      [middle, (across + lot.depth - rear) / 2],
      [
        [lot.name, heading],
        [`${squareFeet(lotArea)} (${acres(lotArea)})`, size],
      ],
    );
    stack(
      [(bounds.left + bounds.right) / 2, houseY + house.depth / 2],
      [
        ["PROPOSED", heading],
        ["RESIDENCE", heading],
        [`${squareFeet(footprintArea)} FOOTPRINT`, size],
        [`F.F.E. ${house.floor.toFixed(2)}'`, size],
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
    put([0, pavement.near - gap], "EDGE OF PAVEMENT", note, { valign: "top" });
    const rightOfWay = `${street.rightOfWay}' PUBLIC RIGHT-OF-WAY`;
    put([middle, centerline + clear], rightOfWay, note, { align: "center" });
    put([middle, centerline + clear + note + gap * 1.5], street.name, heading, { align: "center" });
    put([ends.right, centerline + gap], "CENTERLINE", note, { align: "right" });

    // The adjoining lots, each an inch outside its lot line and reading along it.
    put([-paper(1), lot.depth / 2], "LOT 11", size, { align: "center", rotation: 90 });
    put([lot.width + paper(1) + size, lot.depth / 2], "LOT 13", size, {
      align: "center",
      rotation: 90,
    });
    put([middle, lot.depth + paper(1)], "LOT 27", size, { align: "center" });
  });

  // The column of notes: site data, general notes, legend and abbreviations, from the top of the
  // drawing area down. `row` is the baseline of the next line.
  let row = column.top;

  function columnHeading(title: string): void {
    row -= text.heading;
    d.layer("C-ANNO-TITL", {}, () => {
      put([column.left, row], title, text.heading);
      d.line([column.left, row - gap], [column.left + column.width, row - gap]);
    });
    row -= gap + leading * 1.2;
  }

  /**
   * Rows of cells in columns. The first column is `first` wide, and each later one starts a gap
   * past the widest text of the one before it.
   */
  function table(rows: readonly (readonly string[])[], first: number): void {
    const starts = [0, first];
    for (let i = 1; i < Math.max(...rows.map((cells) => cells.length)) - 1; i++) {
      const widest = Math.max(...rows.map((cells) => widthOf(cells[i] ?? "", text.label)));
      starts.push((starts[i] ?? 0) + widest + paper(1 / 2));
    }
    for (const cells of rows) {
      cells.forEach((cell, i) => put([column.left + (starts[i] ?? 0), row], cell, text.label));
      row -= leading;
    }
  }

  columnHeading("SITE DATA");
  d.layer("C-ANNO-TEXT", {}, () => {
    const coverage = (footprintArea / lotArea) * 100;
    const nameColumn = widthOf("BUILDING FOOTPRINT", text.label) + paper(1 / 2);
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
  d.layer("C-ANNO-TEXT", {}, () => {
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
    const indent = widthOf("00. ", text.label);
    notes.forEach((note, i) => {
      put([column.left, row], `${i + 1}.`, text.label);
      for (const line of wrap(note, text.label, column.width - indent)) {
        put([column.left + indent, row], line, text.label);
        row -= leading;
      }
      row -= leading / 3;
    });
  });

  row -= blockGap;
  columnHeading("LEGEND");
  const sample = paper(2); // the length of a legend line
  function legendRow(layer: Parameters<typeof d.layer>[0], name: string, draw: () => void): void {
    d.layer(layer, {}, draw);
    d.layer("C-ANNO-TEXT", {}, () => {
      put([column.left + sample + paper(3 / 8), row], name, text.label);
    });
    row -= leading * 1.5;
  }
  const sampleLine = () =>
    d.line([column.left, row + text.label / 2], [column.left + sample, row + text.label / 2]);
  const sampleCenter = (): Point => [column.left + sample / 2, row + text.label / 2];
  legendRow("C-PROP", "PROPERTY LINE", sampleLine);
  legendRow("C-PROP-ADJC", "ADJOINING LOT LINE", sampleLine);
  legendRow("C-SETB", "BUILDING SETBACK LINE", sampleLine);
  legendRow("C-BLDG", "BUILDING FOOTPRINT", sampleLine);
  legendRow("C-PAVE", "EDGE OF PAVEMENT OR CONCRETE", sampleLine);
  legendRow("C-ROAD-CNTR", "STREET CENTERLINE", sampleLine);
  legendRow("C-PROP-MONU", "PROPERTY CORNER", () =>
    d.insert("PROPERTY CORNER", sampleCenter(), { scale: symbolScale }),
  );
  row -= leading / 2;
  legendRow("V-TREE", "EXISTING TREE TO REMAIN", () =>
    d.insert("TREE", sampleCenter(), { scale: paper(3 / 16) }),
  );

  row -= blockGap;
  columnHeading("ABBREVIATIONS");
  d.layer("C-ANNO-TEXT", {}, () => {
    table(
      [
        ["AC", "ACRES"],
        ["CONC.", "CONCRETE"],
        ["ELEV.", "ELEVATION"],
        ["F.F.E.", "FINISHED FLOOR ELEVATION"],
        ["MAX.", "MAXIMUM"],
        ["SF", "SQUARE FEET"],
      ],
      widthOf("F.F.E.", text.label) + paper(1 / 2),
    );
  });

  // The view title, under the plan at the lower left of the drawing area: the north arrow, the
  // title and the graphic scale in a row.
  const arrow = { radius: paper(arrowRadius) };
  // The underline of the title, level with the middle of the north arrow.
  const underline = drawingArea.bottom + arrow.radius;
  const titleX = drawingArea.left + arrow.radius * 2 + paper(3 / 8);
  const titleWidth = paper(titleLine);
  d.layer("C-ANNO-TITL", {}, () => {
    d.insert("VIEW TITLE", [titleX, underline], {
      scale: symbolScale,
      attributes: { TITLE: "SITE PLAN", SCALE: `SCALE: ${scaleLabel}` },
    });
  });
  d.layer("C-ANNO-SYMB", {}, () => {
    // North is up the sheet.
    d.insert("NORTH ARROW", [drawingArea.left + arrow.radius, underline], { scale: symbolScale });

    // A graphic scale 2 in long on paper, divided at 1/2 in and 1 in, and numbered in feet.
    const bar = { x: titleX + titleWidth + paper(3 / 4), length: paper(2), height: paper(1 / 8) };
    const y = underline - bar.height;
    const stops = [0, 1 / 4, 1 / 2, 1]; // shares of the bar's length
    d.rect([bar.x, y], bar.length, bar.height);
    for (const stop of stops.slice(1, -1)) {
      d.line([bar.x + bar.length * stop, y], [bar.x + bar.length * stop, y + bar.height]);
    }
    d.line([bar.x, y + bar.height / 2], [bar.x + bar.length / 4, y + bar.height / 2]);
    for (const stop of stops) {
      const at: Point = [bar.x + bar.length * stop, y + bar.height + gap];
      put(at, String(stop * 2 * feetPerInch), text.note, { align: "center" });
    }
    put([bar.x + bar.length + clear, y], "FEET", text.note);
  });

  /** Lines of text, each with its height, centered on `center` as one block. */
  function stack(
    center: Point,
    lines: readonly (readonly [value: string, height: number])[],
  ): void {
    const height = lines.reduce((sum, line) => sum + line[1], 0) + gap * 1.5 * (lines.length - 1);
    let top = center[1] + height / 2;
    for (const [value, size] of lines) {
      put([center[0], top - size], value, size, { align: "center" });
      top -= size + gap * 1.5;
    }
  }

  /** Breaks a sentence into lines no wider than `width`, by the estimated width of its text. */
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

  return { drawing: d.build(), sheetEdge, drawingArea, titleBlockSpace };
}

const drawing = sitePlan().drawing;
export default drawing;

// Run as a script, the example writes its files. Imported, it only hands over the drawing.
if (import.meta.main) {
  const outDir = new URL("./out/", import.meta.url);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(new URL("site-plan.dxf", outDir), toDXF(drawing));
  writeFileSync(new URL("site-plan.svg", outDir), toSVG(drawing));
  console.log(
    `Wrote ${drawing.entities.length} entities on ${drawing.layers.length} layers to examples/out/`,
  );
}
