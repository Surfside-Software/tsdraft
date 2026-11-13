import {
  definitionHandle,
  insertAttributeHandle,
  insertEndHandle,
  blockHandles,
  blocksByKey,
  placeAttribute,
} from "./blocks.ts";
import { arrowheadInfo, DEFAULT_ARROWHEAD } from "./arrowheads.ts";
import {
  arrowheadEntityHandle,
  arrowheadsWithBlocks,
  dimensionAngle,
  dimensionMeasure,
  dimensionPicture,
  validDimensionPictureHandles,
  validDimensionStyleHandle,
  type DimensionPicture,
  type DimensionPictureHandles,
  type Dimension,
} from "./dimensions.ts";
import type {
  AttributeDefinition,
  Block,
  DimensionStyle,
  Drawing,
  Entity,
  Insert,
  Layout,
  Linetype,
  Text,
  TextStyle,
  Units,
  Viewport,
} from "./drawing.ts";
import { extents } from "./extents.ts";
import {
  layoutBlockName,
  validLayoutHandles,
  validViewportView,
  type LayoutHandles,
} from "./layouts.ts";
import {
  DEFAULT_PLOT_STYLE_TABLE,
  fromMillimetres,
  mediumMargins,
  paperInfo,
  paperMillimetres,
  PLOTTER,
  type PaperInfo,
} from "./papers.ts";
import { fontInfo, STANDARD_TEXT_STYLE } from "./fonts.ts";
import { ID_HANDLE_SEED, validIdHandle } from "./handles.ts";
import { dxfOnce, dxfText, fmt, readable, written, writtenAngle } from "./format.ts";
import { layerKey, layerZeroFirst } from "./layers.ts";
import { entityLinetype, layerLinetype, lineweightCode, patternLength } from "./linetypes.ts";
import { TEXT_ALIGNS, TEXT_VERTICAL_ALIGNS } from "./rules.ts";

/** `$INSUNITS` codes from the DXF Reference. */
const INSUNITS: Record<Units, number> = { in: 1, ft: 2, mm: 4, cm: 5, m: 6 };

type Group = (code: number, value: string | number) => void;

/** A symbol table record: its handle, and a writer for the fields after the common ones. */
interface TableRecord {
  readonly type: string;
  readonly subclass: string;
  readonly name: string;
  readonly handle: string;
  /** Group 70. */
  readonly flags?: number;
  readonly fields?: (g: Group) => void;
}

/**
 * Writes an ASCII DXF for AutoCAD 2018 and later (AC1032), the newest DXF
 * version Autodesk has published. AutoCAD 2027 still reads and writes AC1032.
 *
 * Unlike R12, this version has handles, owner links, an OBJECTS section and the
 * `$INSUNITS` header, so the drawing's units reach CAD and xref and block
 * insertion scale correctly. Text is UTF-8.
 *
 * An entity with an id takes the handle its id gives, so it keeps that handle when the drawing
 * around it changes. So do a block's own objects, from its name, and the attributes of an insert
 * that has an id. Every other object takes the next handle counted up from 1.
 *
 * @param handleOf - The handle an id gives. Only a test of the ends of the range passes one.
 */
export function toDXFR2018(
  drawing: Drawing,
  handleOf: (id: string) => string = validIdHandle,
): string {
  let seed = 1;
  const handle = () => (seed++).toString(16).toUpperCase();
  const body: string[] = [];
  const g = groupWriter(body);

  const rootDictionary = handle();
  const groupDictionary = handle();
  const plotStyleDictionary = handle();
  const normalPlotStyle = handle();
  const modelSpace = handle();
  const paperSpace = handle();
  // A drawing with a layout holds the dictionary of its layouts and a layout for the model
  // tab. Each layout's own objects take their handles from its name.
  const layouts = drawing.layouts ?? [];
  const sheets = layouts.map((layout, index) => sheetOf(layout, index));
  const layoutDictionary = sheets.length > 0 ? handle() : "";
  const modelLayout = sheets.length > 0 ? handle() : "";
  // The extents are worked out here, so they are brought into the range AutoCAD reads.
  const [left, bottom, right, top] = extentsOf(drawing.entities, drawing);
  const [minX, minY, maxX, maxY] = [
    readable(left),
    readable(bottom),
    readable(right),
    readable(top),
  ];

  g(0, "SECTION");
  g(2, "CLASSES");
  g(0, "ENDSEC");

  g(0, "SECTION");
  g(2, "TABLES");
  writeTable(g, handle, "VPORT", [
    {
      type: "VPORT",
      subclass: "AcDbViewportTableRecord",
      name: "*Active",
      handle: handle(),
      fields: (g) => writeActiveViewport(g, minX, minY, maxX, maxY),
    },
  ]);
  const linetypes: Linetype[] = [
    { name: "ByBlock", description: "", pattern: [] },
    { name: "ByLayer", description: "", pattern: [] },
    { name: "Continuous", description: "Solid line", pattern: [] },
    ...(drawing.linetypes ?? []),
  ];
  writeTable(
    g,
    handle,
    "LTYPE",
    linetypes.map((linetype) => ({
      type: "LTYPE",
      subclass: "AcDbLinetypeTableRecord",
      name: linetype.name,
      handle: handle(),
      fields: (g) => {
        g(3, dxfOnce(linetype.description));
        g(72, 65); // alignment: "A"
        g(73, linetype.pattern.length);
        g(40, patternLength(linetype.pattern.map(written)));
        for (const length of linetype.pattern) {
          g(49, length);
          g(74, 0); // a plain dash, gap or dot
        }
      },
    })),
  );
  writeTable(
    g,
    handle,
    "LAYER",
    // AUDIT reports "Layer zero name found at incorrect index" unless layer 0 comes first.
    layerZeroFirst(drawing.layers).map((layer) => ({
      type: "LAYER",
      subclass: "AcDbLayerTableRecord",
      name: layer.name,
      handle: handle(),
      flags: (layer.frozen ? 1 : 0) | (layer.locked ? 4 : 0),
      fields: (g) => {
        // A layer that is off has its color negated.
        g(62, layer.off ? -layer.color : layer.color);
        g(6, layerLinetype(layer));
        if (layer.plot === false) g(290, 0);
        g(370, lineweightCode(layer.lineweight ?? "Default"));
        g(390, normalPlotStyle); // AutoCAD rejects a layer without a plot style
      },
    })),
  );
  const textStyles = drawing.textStyles ?? [];
  const standardStyle = handle();
  // Each text style has a handle of its own. A dimension style holds the first of a name.
  const textStyleHandleList = textStyles.map(() => handle());
  const textStyleHandles = new Map(
    textStyles.map((style, i) => [layerKey(style.name), textStyleHandleList[i]!]).reverse() as [
      string,
      string,
    ][],
  );
  writeTable(g, handle, "STYLE", [
    {
      type: "STYLE",
      subclass: "AcDbTextStyleTableRecord",
      name: STANDARD_TEXT_STYLE,
      handle: standardStyle,
      fields: (g) => {
        g(40, 0); // fixed height: none
        g(41, 1); // width factor
        g(50, 0); // oblique angle
        g(71, 0); // generation flags
        g(42, 0.2); // last height used
        g(3, "txt");
        g(4, "");
      },
    },
    ...textStyles.map((style, i) => ({
      type: "STYLE",
      subclass: "AcDbTextStyleTableRecord",
      name: style.name,
      handle: textStyleHandleList[i]!,
      fields: (g: Group) => {
        const font = fontInfo(style.font);
        g(40, 0); // fixed height: none, so each text keeps its own
        g(41, style.widthFactor ?? 1);
        g(50, style.obliqueAngle ?? 0);
        g(71, 0); // generation flags
        g(42, 0.2); // last height used
        g(3, font?.file ?? style.font);
        g(4, "");
        // A TrueType font is named by its typeface in the record's extended data, with its
        // pitch and family.
        if (font?.pitchAndFamily !== undefined) {
          g(1001, "ACAD");
          g(1000, style.font);
          g(1071, font.pitchAndFamily);
        }
      },
    })),
  ]);
  // Keyed as style names are compared, so a text that names `notes` takes the style `NOTES`.
  const stylesByKey = new Map(textStyles.map((style) => [layerKey(style.name), style]));
  const styleOf = (name: string | undefined): TextStyle | undefined =>
    name === undefined ? undefined : stylesByKey.get(layerKey(name));
  writeTable(g, handle, "VIEW", []);
  writeTable(g, handle, "UCS", []);
  writeTable(g, handle, "APPID", [
    { type: "APPID", subclass: "AcDbRegAppTableRecord", name: "ACAD", handle: handle() },
  ]);
  const dimensionStyles = drawing.dimensionStyles ?? [];
  // Keyed as style names are compared, so a dimension that names `dim` takes the style `DIM`.
  const dimensionStylesByKey = new Map(
    dimensionStyles.map((style) => [layerKey(style.name), style]),
  );
  const arrowheads = arrowheadsWithBlocks(dimensionStyles);
  writeTable(g, handle, "DIMSTYLE", [
    {
      type: "DIMSTYLE",
      subclass: "AcDbDimStyleTableRecord",
      name: "Standard",
      handle: handle(),
      // DIMTXSTY. A dimension in a style with no text style has no text.
      fields: (g) => g(340, standardStyle),
    },
    ...dimensionStyles.map((style) => ({
      type: "DIMSTYLE",
      subclass: "AcDbDimStyleTableRecord",
      name: style.name,
      handle: validDimensionStyleHandle(style.name),
      fields: (g: Group) =>
        writeDimensionStyle(
          g,
          style,
          textStyleHandles.get(layerKey(style.textStyle ?? STANDARD_TEXT_STYLE)) ?? standardStyle,
        ),
    })),
  ]);
  const blocks = drawing.blocks ?? [];
  const xrefs = drawing.xrefs ?? [];
  // The block of each dimension's picture, by the dimension's space and place: model space,
  // then each layout. A dimension in a style the drawing does not have gets none.
  const pictures = new Map<string, Picture>();
  [drawing.entities, ...sheets.map((sheet) => sheet.layout.entities)].forEach((entities, space) => {
    entities.forEach((entity, index) => {
      if (entity.kind !== "linear-dimension" && entity.kind !== "aligned-dimension") return;
      const style = dimensionStylesByKey.get(layerKey(entity.style));
      if (style === undefined) return;
      const layout = space === 0 ? undefined : sheets[space - 1]!.layout.name;
      pictures.set(`${space}/${index}`, {
        name: `*D${pictures.size + 1}`,
        picture: dimensionPicture(entity, style),
        handles: validDimensionPictureHandles({
          index,
          ...(entity.id === undefined ? {} : { id: entity.id }),
          ...(layout === undefined ? {} : { layout }),
        }),
        layer: entity.layer,
        textStyle: styleOf(style.textStyle)?.name ?? STANDARD_TEXT_STYLE,
      });
    });
  });
  const blockRecordFields = (g: Group) => {
    g(280, 1); // explodable
    g(281, 0); // scale uniformly: no
  };
  /** The record of a block that a layout shows: model space, or a layout's paper space. */
  const layoutRecordFields = (layout: string) => (g: Group) => {
    g(340, layout);
    blockRecordFields(g);
  };
  writeTable(g, handle, "BLOCK_RECORD", [
    {
      type: "BLOCK_RECORD",
      subclass: "AcDbBlockTableRecord",
      name: "*Model_Space",
      handle: modelSpace,
      fields: sheets.length > 0 ? layoutRecordFields(modelLayout) : blockRecordFields,
    },
    // A drawing with no layout has the empty paper space every drawing has.
    ...(sheets.length > 0
      ? sheets.map((sheet) => ({
          type: "BLOCK_RECORD",
          subclass: "AcDbBlockTableRecord",
          name: sheet.block,
          handle: sheet.handles.record,
          fields: layoutRecordFields(sheet.handles.layout),
        }))
      : [
          {
            type: "BLOCK_RECORD",
            subclass: "AcDbBlockTableRecord",
            name: "*Paper_Space",
            handle: paperSpace,
            fields: blockRecordFields,
          },
        ]),
    ...blocks.map((block) => ({
      type: "BLOCK_RECORD",
      subclass: "AcDbBlockTableRecord",
      name: block.name,
      handle: blockHandles(block.name).record,
      // A block is in the drawing's units, so that CAD inserts it at its own size.
      flags: INSUNITS[drawing.units],
      fields: blockRecordFields,
    })),
    // An xref's record states no units: AutoCAD keeps the scale each insert of it has.
    ...xrefs.map((xref) => ({
      type: "BLOCK_RECORD",
      subclass: "AcDbBlockTableRecord",
      name: xref.name,
      handle: blockHandles(xref.name).record,
      fields: blockRecordFields,
    })),
    // The block of each arrowhead a dimension style draws with.
    ...arrowheads.map(({ block }) => ({
      type: "BLOCK_RECORD",
      subclass: "AcDbBlockTableRecord",
      name: block,
      handle: blockHandles(block).record,
      fields: blockRecordFields,
    })),
    ...[...pictures.values()].map(({ name, handles }) => ({
      type: "BLOCK_RECORD",
      subclass: "AcDbBlockTableRecord",
      name,
      handle: handles.record,
      fields: blockRecordFields,
    })),
  ]);
  g(0, "ENDSEC");

  const blocksByName = blocksByKey(blocks);
  /**
   * Writes the entities of model space, of a block or of a layout, each owned by `owner`.
   * `paper` marks the entities of a layout as being in paper space.
   */
  const writeEntities = (
    entities: readonly Entity[],
    owner: string,
    paper = false,
    space?: number,
  ): void => {
    entities.forEach((entity, index) => {
      const own = entity.id === undefined ? handle() : handleOf(entity.id);
      if (entity.kind === "linear-dimension" || entity.kind === "aligned-dimension") {
        writeDimension(
          g,
          entity,
          dimensionStylesByKey.get(layerKey(entity.style)),
          own,
          owner,
          paper,
          space === undefined ? undefined : pictures.get(`${space}/${index}`)?.name,
        );
        return;
      }
      if (entity.kind !== "insert") {
        writeEntity(
          g,
          entity,
          own,
          owner,
          entity.kind === "text" ? styleOf(entity.style) : undefined,
          paper,
        );
        return;
      }
      const block = blocksByName.get(layerKey(entity.block));
      const definitions = block?.attributes ?? [];
      writeInsert(g, entity, own, owner, definitions.length > 0, paper);
      if (definitions.length === 0) return;
      const { id } = entity;
      for (const definition of definitions) {
        const placed = placeAttribute(definition, styleOf(definition.style), entity, block?.base);
        g(0, "ATTRIB");
        g(5, id === undefined ? handle() : insertAttributeHandle(id, definition.tag));
        g(330, own);
        g(100, "AcDbEntity");
        if (paper) g(67, 1);
        g(8, definition.layer);
        g(100, "AcDbText");
        writeTextFields(g, { ...definition, ...placed }, styleOf(definition.style), placed);
        g(100, "AcDbAttribute");
        writeAttributeFields(g, definition, undefined);
      }
      g(0, "SEQEND");
      g(5, id === undefined ? handle() : insertEndHandle(id));
      g(330, own);
      g(100, "AcDbEntity");
      if (paper) g(67, 1);
      g(8, entity.layer);
    });
  };
  /** Writes what a layout holds: the viewport of the sheet, its viewports, then its entities. */
  const writeSheet = (sheet: Sheet, space: number): void => {
    const owner = sheet.handles.record;
    writeSheetViewport(g, sheet, owner);
    sheet.layout.viewports.forEach((viewport, index) => {
      const own = viewport.id === undefined ? handle() : handleOf(viewport.id);
      // The sheet's own viewport has the number 1, so the others count from 2.
      writeViewport(g, viewport, own, owner, index + 2, sheet.paper, drawing.units);
    });
    writeEntities(sheet.layout.entities, owner, true, space);
  };

  g(0, "SECTION");
  g(2, "BLOCKS");
  writeBlock(g, handle(), handle(), "*Model_Space", modelSpace, { paper: false });
  // The counter passes the two handles of the empty paper space whether it is written or not.
  const [paperBegin, paperEnd] = [handle(), handle()];
  if (sheets.length === 0) {
    writeBlock(g, paperBegin, paperEnd, "*Paper_Space", paperSpace, { paper: true });
  }
  // The block of the first layout is empty here: what it holds is written with the entities.
  sheets.forEach((sheet, index) => {
    writeBlock(g, sheet.handles.begin, sheet.handles.end, sheet.block, sheet.handles.record, {
      paper: true,
      ...(index === 0 ? {} : { contents: () => writeSheet(sheet, index + 1) }),
    });
  });
  for (const block of blocks) {
    const handles = blockHandles(block.name);
    writeBlock(g, handles.begin, handles.end, block.name, handles.record, {
      paper: false,
      base: block.base,
      hasAttributes: (block.attributes ?? []).length > 0,
      contents: () => {
        writeEntities(block.entities, handles.record);
        for (const definition of block.attributes ?? []) {
          g(0, "ATTDEF");
          g(5, definitionHandle(block.name, definition.tag));
          g(330, handles.record);
          g(100, "AcDbEntity");
          g(8, definition.layer);
          g(100, "AcDbText");
          writeTextFields(g, definition, styleOf(definition.style), undefined);
          g(100, "AcDbAttributeDefinition");
          writeAttributeFields(g, definition, definition.prompt ?? definition.tag);
        }
      },
    });
  }
  for (const xref of xrefs) {
    const handles = blockHandles(xref.name);
    writeBlock(g, handles.begin, handles.end, xref.name, handles.record, {
      paper: false,
      xrefPath: xref.path,
    });
  }
  for (const { arrowhead, block } of arrowheads) {
    const handles = blockHandles(block);
    const stroke = arrowheadInfo(arrowhead)!.stroke!;
    writeBlock(g, handles.begin, handles.end, block, handles.record, {
      paper: false,
      contents: () => {
        // One stroke, as wide as the arrowhead's, which takes its color and its linetype
        // from the dimension that draws it.
        g(0, "LWPOLYLINE");
        g(5, arrowheadEntityHandle(block));
        g(330, handles.record);
        g(100, "AcDbEntity");
        g(8, "0");
        g(6, "ByBlock");
        g(62, 0);
        g(100, "AcDbPolyline");
        g(90, 2);
        g(70, 0);
        g(43, stroke.width);
        for (const [x, y] of [stroke.from, stroke.to]) {
          g(10, x);
          g(20, y);
        }
      },
    });
  }
  for (const picture of pictures.values()) writePicture(g, picture);
  g(0, "ENDSEC");

  g(0, "SECTION");
  g(2, "ENTITIES");
  writeEntities(drawing.entities, modelSpace, false, 0);
  if (sheets[0] !== undefined) writeSheet(sheets[0], 1);
  g(0, "ENDSEC");

  g(0, "SECTION");
  g(2, "OBJECTS");
  g(0, "DICTIONARY");
  g(5, rootDictionary);
  g(330, "0");
  g(100, "AcDbDictionary");
  g(281, 1); // duplicate records: keep existing
  g(3, "ACAD_GROUP");
  g(350, groupDictionary);
  if (sheets.length > 0) {
    g(3, "ACAD_LAYOUT");
    g(350, layoutDictionary);
  }
  g(3, "ACAD_PLOTSTYLENAME");
  g(350, plotStyleDictionary);
  g(0, "DICTIONARY");
  ownedBy(g, groupDictionary, rootDictionary);
  g(100, "AcDbDictionary");
  g(281, 1);
  // Plot style names: a dictionary with a default, holding the "Normal" placeholder.
  g(0, "ACDBDICTIONARYWDFLT");
  ownedBy(g, plotStyleDictionary, rootDictionary);
  g(100, "AcDbDictionary");
  g(281, 1);
  g(3, "Normal");
  g(350, normalPlotStyle);
  g(100, "AcDbDictionaryWithDefault");
  g(340, normalPlotStyle);
  g(0, "ACDBPLACEHOLDER");
  ownedBy(g, normalPlotStyle, plotStyleDictionary);
  if (sheets.length > 0) {
    g(0, "DICTIONARY");
    ownedBy(g, layoutDictionary, rootDictionary);
    g(100, "AcDbDictionary");
    g(281, 1);
    g(3, "Model");
    g(350, modelLayout);
    for (const sheet of sheets) {
      g(3, dxfOnce(sheet.layout.name));
      g(350, sheet.handles.layout);
    }
    writeModelLayout(g, modelLayout, layoutDictionary, modelSpace, [minX, minY, maxX, maxY]);
    sheets.forEach((sheet, index) => {
      writeLayout(g, sheet, layoutDictionary, index + 1, sheetExtents(sheet, drawing));
    });
  }
  g(0, "ENDSEC");
  g(0, "EOF");

  // The header goes first in the file but is written last, once every handle is assigned.
  const header: string[] = [];
  const h = groupWriter(header);
  h(0, "SECTION");
  h(2, "HEADER");
  h(9, "$ACADVER");
  h(1, "AC1032");
  h(9, "$DWGCODEPAGE");
  h(3, "ANSI_1252");
  h(9, "$INSBASE");
  point(h, 10, 0, 0);
  h(9, "$EXTMIN");
  point(h, 10, minX, minY);
  h(9, "$EXTMAX");
  point(h, 10, maxX, maxY);
  h(9, "$INSUNITS");
  h(70, INSUNITS[drawing.units]);
  h(9, "$MEASUREMENT");
  h(70, drawing.units === "in" || drawing.units === "ft" ? 0 : 1);
  if (drawing.linetypeScale !== undefined && drawing.linetypeScale !== 1) {
    h(9, "$LTSCALE");
    h(40, drawing.linetypeScale);
  }
  // A drawing saved from this file then refuses in-place editing through a reference to it.
  h(9, "$XEDIT");
  h(290, 0);
  h(9, "$CLAYER");
  h(8, "0");
  const [first] = sheets;
  if (first !== undefined) {
    // AutoCAD takes the extents and the limits of the layout it opens on from the header.
    const [pMinX, pMinY, pMaxX, pMaxY] = sheetExtents(first, drawing);
    const limits = sheetLimits(first.paper);
    h(9, "$PEXTMIN");
    point(h, 10, pMinX, pMinY);
    h(9, "$PEXTMAX");
    point(h, 10, pMaxX, pMaxY);
    h(9, "$PLIMMIN");
    h(10, limits[0]);
    h(20, limits[1]);
    h(9, "$PLIMMAX");
    h(10, limits[2]);
    h(20, limits[3]);
    // 0 opens the drawing on its first layout, where 1 opens it on the model tab.
    h(9, "$TILEMODE");
    h(70, 0);
  }
  h(9, "$HANDSEED");
  // AutoCAD numbers the objects it adds from the seed up, so it is above every handle here.
  const named =
    blocks.length > 0 ||
    xrefs.length > 0 ||
    sheets.length > 0 ||
    dimensionStyles.length > 0 ||
    drawing.entities.some((entity) => entity.id !== undefined);
  h(5, named ? ID_HANDLE_SEED : handle());
  h(0, "ENDSEC");

  return [...header, ...body].join("\r\n") + "\r\n";
}

function groupWriter(out: string[]): Group {
  return (code, value) => {
    out.push(String(code), typeof value === "number" ? fmt(value) : value);
  };
}

/** Handle, reactor and owner fields for an object owned by a dictionary. */
function ownedBy(g: Group, handle: string, owner: string): void {
  g(5, handle);
  g(102, "{ACAD_REACTORS");
  g(330, owner);
  g(102, "}");
  g(330, owner);
}

function point(g: Group, code: number, x: number, y: number): void {
  point3(g, code, x, y, 0);
}

function point3(g: Group, code: number, x: number, y: number, z: number): void {
  g(code, x);
  g(code + 10, y);
  g(code + 20, z);
}

function writeTable(
  g: Group,
  handle: () => string,
  name: string,
  records: readonly TableRecord[],
): void {
  const table = handle();
  g(0, "TABLE");
  g(2, name);
  g(5, table);
  g(330, "0");
  g(100, "AcDbSymbolTable");
  g(70, records.length);
  if (name === "DIMSTYLE") {
    g(100, "AcDbDimStyleTable");
    g(71, records.length);
    for (const r of records) g(340, r.handle);
  }
  for (const r of records) {
    g(0, r.type);
    // DIMSTYLE records use 105 for their handle, because 5 is DIMBLK's code there.
    g(r.type === "DIMSTYLE" ? 105 : 5, r.handle);
    g(330, table);
    g(100, "AcDbSymbolTableRecord");
    g(100, r.subclass);
    g(2, r.name);
    g(70, r.flags ?? 0);
    r.fields?.(g);
  }
  g(0, "ENDTAB");
}

/** The *Active viewport, zoomed to the drawing's extents so the file opens on the drawing. */
function writeActiveViewport(
  g: Group,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  const aspect = 1.6;
  // A drawing can span more than AutoCAD can read as one number, so the height is capped.
  const height = readable(Math.max(maxY - minY, (maxX - minX) / aspect, 1) * 1.1);
  g(10, 0); // lower-left corner of the viewport on screen
  g(20, 0);
  g(11, 1); // upper-right corner
  g(21, 1);
  g(12, (minX + maxX) / 2); // view center
  g(22, (minY + maxY) / 2);
  g(13, 0); // snap base
  g(23, 0);
  g(14, 0.5); // snap spacing
  g(24, 0.5);
  g(15, 0.5); // grid spacing
  g(25, 0.5);
  g(16, 0); // view direction
  g(26, 0);
  g(36, 1);
  g(17, 0); // view target
  g(27, 0);
  g(37, 0);
  g(40, height);
  g(41, aspect);
  g(42, 50); // lens length
  g(43, 0); // front clip
  g(44, 0); // back clip
  g(50, 0); // snap rotation
  g(51, 0); // view twist
  g(71, 0); // view mode
  g(72, 1000); // circle zoom percent
  g(73, 1); // fast zoom
  g(74, 3); // UCS icon
  g(75, 0); // snap off
  g(76, 0); // grid off
  g(77, 0); // snap style
  g(78, 0); // snap isopair
}

/** Writes a block's definition: the object that opens it, what it holds, and the one that closes it. */
function writeBlock(
  g: Group,
  begin: string,
  end: string,
  name: string,
  owner: string,
  block: {
    readonly paper: boolean;
    readonly base?: Block["base"];
    readonly hasAttributes?: boolean;
    /** The path of the file an xref's block stands for. */
    readonly xrefPath?: string;
    /** True for a block of no name of its own, such as a dimension's picture. */
    readonly anonymous?: boolean;
    readonly contents?: () => void;
  },
): void {
  g(0, "BLOCK");
  g(5, begin);
  g(330, owner);
  g(100, "AcDbEntity");
  if (block.paper) g(67, 1);
  g(8, "0");
  g(100, "AcDbBlockBegin");
  g(2, name);
  // 1: the block is anonymous. 2: it has attribute definitions. 4 and 8: it is an xref, and an
  // overlay.
  g(70, block.anonymous ? 1 : block.xrefPath !== undefined ? 12 : block.hasAttributes ? 2 : 0);
  point(g, 10, ...(block.base ?? [0, 0]));
  g(3, name);
  // AutoCAD decodes a block's path once, where it decodes a text twice.
  g(1, block.xrefPath === undefined ? "" : dxfOnce(block.xrefPath));
  block.contents?.();
  g(0, "ENDBLK");
  g(5, end);
  g(330, owner);
  g(100, "AcDbEntity");
  if (block.paper) g(67, 1);
  g(8, "0");
  g(100, "AcDbBlockEnd");
}

function writeInsert(
  g: Group,
  e: Insert,
  handle: string,
  owner: string,
  hasAttributes: boolean,
  paper: boolean,
): void {
  g(0, "INSERT");
  g(5, handle);
  g(330, owner);
  g(100, "AcDbEntity");
  if (paper) g(67, 1);
  g(8, e.layer);
  g(100, "AcDbBlockReference");
  if (hasAttributes) g(66, 1); // attributes follow
  g(2, e.block);
  point(g, 10, ...e.at);
  const [x, y] = e.scale ?? [1, 1];
  if (x !== 1) g(41, x);
  if (y !== 1) g(42, y);
  if (e.rotation !== undefined && e.rotation !== 0) g(50, e.rotation);
}

/**
 * The fields a text, an attribute definition and an attribute share, up to the justification
 * across the line. `placed` is what an insert makes of an attribute's definition.
 */
function writeTextFields(
  g: Group,
  e: Pick<Text, "at" | "height" | "value" | "rotation" | "align" | "valign">,
  style: TextStyle | undefined,
  placed:
    | { readonly widthFactor: number; readonly obliqueAngle: number; readonly mirrored: boolean }
    | undefined,
): void {
  point(g, 10, ...e.at);
  g(40, e.height);
  g(1, dxfText(e.value));
  if (e.rotation !== 0) g(50, e.rotation);
  // A text holds its own width factor and oblique angle. It starts with its style's.
  const widthFactor = placed?.widthFactor ?? style?.widthFactor ?? 1;
  const obliqueAngle = placed?.obliqueAngle ?? style?.obliqueAngle ?? 0;
  if (widthFactor !== 1) g(41, widthFactor);
  if (obliqueAngle !== 0) g(51, obliqueAngle);
  g(7, style?.name ?? STANDARD_TEXT_STYLE);
  const align = TEXT_ALIGNS.indexOf(e.align ?? "left");
  const valign = TEXT_VERTICAL_ALIGNS.indexOf(e.valign ?? "baseline");
  if (align > 0) g(72, align);
  // A justified text is placed by its alignment point, and its first point is written as
  // the same point.
  if (align > 0 || valign > 0) point(g, 11, ...e.at);
  if (placed?.mirrored) point3(g, 210, 0, 0, -1);
}

/** The fields of an attribute definition, which has a prompt, or of an attribute, after its text's. */
function writeAttributeFields(
  g: Group,
  definition: AttributeDefinition,
  prompt: string | undefined,
): void {
  g(280, 0); // version
  if (prompt !== undefined) g(3, dxfText(prompt));
  g(2, dxfText(definition.tag));
  g(70, 0); // visible, and asked for on insertion
  const valign = TEXT_VERTICAL_ALIGNS.indexOf(definition.valign ?? "baseline");
  if (valign > 0) g(74, valign);
  g(280, 1); // the attribute keeps its place in the block
}

/**
 * Writes an entity. `style` is the text style of a text that is not in `Standard`, and `paper`
 * is true for an entity of a layout.
 */
function writeEntity(
  g: Group,
  e: Exclude<Entity, Insert | Dimension>,
  handle: string,
  owner: string,
  style: TextStyle | undefined,
  paper: boolean,
): void {
  const begin = (type: string, subclass: string) => {
    g(0, type);
    g(5, handle);
    g(330, owner);
    g(100, "AcDbEntity");
    if (paper) g(67, 1);
    g(8, e.layer);
    const linetype = entityLinetype(e);
    if (linetype !== undefined) g(6, linetype);
    if (e.lineweight !== undefined && e.lineweight !== "ByLayer") {
      g(370, lineweightCode(e.lineweight));
    }
    g(100, subclass);
  };
  switch (e.kind) {
    case "line":
      begin("LINE", "AcDbLine");
      point(g, 10, ...e.from);
      point(g, 11, ...e.to);
      return;
    case "polyline":
      begin("LWPOLYLINE", "AcDbPolyline");
      g(90, e.points.length);
      g(70, e.closed ? 1 : 0);
      g(43, 0); // constant width
      for (const [x, y] of e.points) {
        g(10, x);
        g(20, y);
      }
      return;
    case "circle":
      begin("CIRCLE", "AcDbCircle");
      point(g, 10, ...e.center);
      g(40, e.radius);
      return;
    case "arc":
      begin("ARC", "AcDbCircle");
      point(g, 10, ...e.center);
      g(40, e.radius);
      g(100, "AcDbArc");
      g(50, writtenAngle(e.startAngle));
      g(51, writtenAngle(e.endAngle));
      return;
    case "text":
      begin("TEXT", "AcDbText");
      writeTextFields(g, e, style, undefined);
      // TEXT repeats its subclass marker before the vertical alignment.
      g(100, "AcDbText");
      {
        const valign = TEXT_VERTICAL_ALIGNS.indexOf(e.valign ?? "baseline");
        if (valign > 0) g(73, valign);
      }
      return;
  }
}

/** What a dimension style's `suppressZeros` is in `DIMZIN`, group 78. */
const ZERO_SUPPRESSION_CODES = { leading: 4, trailing: 8, both: 12 } as const;

/**
 * The fields of a dimension style. Every dimension of tsdraft's is drawn one way where a
 * style has no choice: the text above the dimension line and along it, always between the
 * extension lines, with a dimension line between them too, and in decimal units.
 *
 * @param textStyle - The handle of the style's text style.
 */
function writeDimensionStyle(g: Group, style: DimensionStyle, textStyle: string): void {
  const prefix = style.prefix ?? "";
  const suffix = style.suffix ?? "";
  // AutoCAD decodes this string once, as it does a linetype's description.
  if (prefix !== "" || suffix !== "") g(3, dxfOnce(`${prefix}<>${suffix}`));
  g(40, style.scale ?? 1); // DIMSCALE
  g(41, style.arrowSize); // DIMASZ
  g(42, style.extensionOffset); // DIMEXO
  g(44, style.extensionBeyond); // DIMEXE
  const arrowhead = style.arrowhead ?? DEFAULT_ARROWHEAD;
  const block = arrowheadInfo(arrowhead)?.block;
  // DIMDLE: with a tick, the dimension line runs one arrow size past each extension line,
  // as AutoCAD draws it whenever it turns the ticks outward.
  if (block !== undefined) g(46, style.arrowSize);
  g(73, 0); // DIMTIH: the text is along the dimension line
  g(74, 0); // DIMTOH
  g(77, 1); // DIMTAD: the text is above the dimension line
  g(78, style.suppressZeros === undefined ? 0 : ZERO_SUPPRESSION_CODES[style.suppressZeros]);
  g(140, style.textHeight); // DIMTXT
  g(144, style.measurementScale ?? 1); // DIMLFAC
  g(147, style.textGap); // DIMGAP
  g(172, 1); // DIMTOFL: a dimension line between the extension lines, whatever fits
  g(174, 1); // DIMTIX: the text between the extension lines, whatever fits
  g(271, style.precision); // DIMDEC
  g(277, 2); // DIMLUNIT: decimal
  g(278, 46); // DIMDSEP: a point
  g(340, textStyle); // DIMTXSTY
  if (block !== undefined) g(342, blockHandles(block).record); // DIMBLK
}

/**
 * Writes a dimension. It names no block of its picture: AutoCAD draws the picture when it
 * reads the file, from the dimension's points and its style.
 */
function writeDimension(
  g: Group,
  e: Dimension,
  style: DimensionStyle | undefined,
  handle: string,
  owner: string,
  paper: boolean,
  block: string | undefined,
): void {
  // `lint` refuses a dimension in a style the drawing does not have, which has no picture.
  const at = e.kind === "linear-dimension" ? e.line : e.to;
  const picture = style ? dimensionPicture(e, style) : { definitionPoint: at, textMiddle: at };
  g(0, "DIMENSION");
  g(5, handle);
  g(330, owner);
  g(100, "AcDbEntity");
  if (paper) g(67, 1);
  g(8, e.layer);
  g(100, "AcDbDimension");
  if (block !== undefined) g(2, block);
  point(g, 10, ...picture.definitionPoint);
  point(g, 11, ...picture.textMiddle);
  // 32: the dimension has a picture of its own. 1: it is aligned.
  g(70, e.kind === "aligned-dimension" ? 33 : 32);
  if (e.text !== undefined) g(1, dxfOnce(e.text));
  g(71, 5); // the text is placed by its middle
  // What it reads, with 15 digits: AutoCAD works it out only when it draws the picture
  // itself, and keeps the picture the file holds.
  if (style) g(42, measurementValue(e, style));
  g(3, style?.name ?? e.style);
  g(100, "AcDbAlignedDimension");
  point(g, 13, ...e.from);
  point(g, 14, ...e.to);
  if (e.kind === "linear-dimension") {
    const angle = dimensionAngle(e);
    if (angle !== 0) g(50, angle);
    g(100, "AcDbRotatedDimension");
  }
}

/** The block of a dimension's picture, with what the writer needs for it. */
interface Picture {
  /** The block's name, `*D` and a number. */
  readonly name: string;
  readonly picture: DimensionPicture;
  readonly handles: DimensionPictureHandles;
  /** The dimension's layer, which everything in the block is on. */
  readonly layer: string;
  readonly textStyle: string;
}

/** The most characters of a text DXF holds in one group. */
const TEXT_CHUNK = 250;

/**
 * Writes the block of a dimension's picture as AutoCAD writes one: the two extension lines,
 * the dimension line, the arrowheads and the text, on the dimension's layer, in the color and
 * lineweight of the dimension. It holds no definition points: they do not plot, and AutoCAD
 * works them out again when it draws the dimension anew.
 */
function writePicture(g: Group, { name, picture, handles, layer, textStyle }: Picture): void {
  const owner = handles.record;
  writeBlock(g, handles.begin, handles.end, name, owner, {
    paper: false,
    anonymous: true,
    contents: () => {
      const begin = (type: string, handle: string, subclass: string, lineweight: boolean) => {
        g(0, type);
        g(5, handle);
        g(330, owner);
        g(100, "AcDbEntity");
        g(8, layer);
        g(62, 0); // by block
        if (lineweight) g(370, -2); // by block
        g(100, subclass);
      };
      const lines: (readonly [readonly [number, number], readonly [number, number], string])[] = [
        [...picture.extensionLines[0]!, handles.extensionLines[0]],
        [...picture.extensionLines[1]!, handles.extensionLines[1]],
        [...picture.dimensionLine, handles.dimensionLine],
      ];
      for (const [from, to, handle] of lines) {
        begin("LINE", handle, "AcDbLine", true);
        point(g, 10, ...from);
        point(g, 11, ...to);
      }
      picture.arrowheadEntities.forEach((arrowhead, i) => {
        const handle = handles.arrowheads[i]!;
        if (arrowhead.kind === "solid") {
          begin("SOLID", handle, "AcDbTrace", false);
          const [left, right, tip] = arrowhead.corners;
          for (const [code, corner] of [
            [10, left],
            [11, right],
            [12, tip],
            [13, tip],
          ] as const) {
            point(g, code, ...corner);
          }
          return;
        }
        begin("INSERT", handle, "AcDbBlockReference", true);
        g(2, arrowhead.block);
        point(g, 10, ...arrowhead.at);
        for (const code of [41, 42, 43]) g(code, arrowhead.scale);
        if (written(arrowhead.rotation) !== 0) g(50, arrowhead.rotation);
      });
      const { label } = picture;
      begin("MTEXT", handles.text, "AcDbMText", false);
      point(g, 10, ...picture.textMiddle);
      g(40, label.height);
      g(41, 0); // no width to wrap at
      g(46, 0);
      g(71, 5); // placed by its middle
      g(72, 1); // left to right
      // AutoCAD writes the text with a code that centers what is stacked in it.
      const text = dxfOnce(`\\A1;${label.value}`);
      let at = 0;
      while (text.length - at > TEXT_CHUNK) {
        // A caret and what it escapes stay in one group.
        const end = text[at + TEXT_CHUNK - 1] === "^" ? at + TEXT_CHUNK - 1 : at + TEXT_CHUNK;
        g(3, text.slice(at, end));
        at = end;
      }
      g(1, text.slice(at));
      g(7, textStyle);
      if (written(label.rotation) !== 0) {
        // 15 digits of the direction: 6 decimals would turn the text off AutoCAD's own.
        g(11, fifteenDigits(label.direction[0]));
        g(21, fifteenDigits(label.direction[1]));
        g(31, 0);
      }
      g(73, 1); // line spacing at least as set
      g(44, 1);
    },
  });
}

/** What a dimension reads, as the DXF writes it: the length times the style's measurement scale. */
function measurementValue(dimension: Dimension, style: DimensionStyle): string {
  return fifteenDigits(
    dimensionMeasure(dimension).measurement * written(style.measurementScale ?? 1),
  );
}

/**
 * A number with 15 significant digits and no exponent, which JavaScript writes for a number
 * under a millionth. Summed as a whole number, 15 digits stay under 2^53, so the double
 * AutoCAD reads from them can be worked out exactly, where a 16th may move it a unit in the
 * last place.
 */
function fifteenDigits(value: number): string {
  const kept = Number(value.toPrecision(15));
  return Math.abs(kept) < 1e-6 ? kept.toFixed(20) : String(kept);
}

/** A layout with what the writer works out for it once. */
interface Sheet {
  readonly layout: Layout;
  readonly handles: LayoutHandles;
  /** The name of the layout's block. */
  readonly block: string;
  readonly paper: PaperInfo;
}

function sheetOf(layout: Layout, index: number): Sheet {
  const paper = paperInfo(layout.paper);
  if (paper === undefined) throw new RangeError(`paper ${layout.paper} is not one of PAPERS`);
  return { layout, handles: validLayoutHandles(layout.name), block: layoutBlockName(index), paper };
}

/** AutoCAD holds the extents of a space with nothing in it as these, the wrong way round. */
const EMPTY_EXTENT = 1e20;

/**
 * The limits of a layout, `[minX, minY, maxX, maxY]` in paper units: the part of the sheet
 * that prints, worked out as AutoCAD does from the sizes its page setup holds in millimetres.
 */
function sheetLimits(paper: PaperInfo): [number, number, number, number] {
  const [left, bottom, right, top] = paper.printable;
  const mm = (length: number): number => paperMillimetres(length, paper.units);
  const back = (length: number): number => readable(fromMillimetres(length, paper.units));
  return [
    back(mm(left)),
    back(mm(bottom)),
    back(mm(paper.width) - mm(paper.width - right)),
    back(mm(paper.height) - mm(paper.height - top)),
  ];
}

/**
 * The extents of what a layout holds, in paper units: its entities and the rectangles of its
 * viewports. A layout that holds nothing has the extents AutoCAD gives an empty one.
 */
function sheetExtents(sheet: Sheet, drawing: Drawing): [number, number, number, number] {
  const { layout, paper } = sheet;
  if (layout.entities.length === 0 && layout.viewports.length === 0) {
    return [EMPTY_EXTENT, EMPTY_EXTENT, -EMPTY_EXTENT, -EMPTY_EXTENT];
  }
  const box =
    layout.entities.length > 0
      ? extentsOf(layout.entities, drawing)
      : [Infinity, Infinity, -Infinity, -Infinity];
  for (const viewport of layout.viewports) {
    const view = validViewportView(viewport, paper.units, drawing.units);
    box[0] = Math.min(box[0]!, view.paperCenter[0] - view.width / 2);
    box[1] = Math.min(box[1]!, view.paperCenter[1] - view.height / 2);
    box[2] = Math.max(box[2]!, view.paperCenter[0] + view.width / 2);
    box[3] = Math.max(box[3]!, view.paperCenter[1] + view.height / 2);
  }
  return box.map(readable) as [number, number, number, number];
}

/** The extents of some entities of a drawing, with its styles and its blocks. */
function extentsOf(
  entities: readonly Entity[],
  drawing: Drawing,
): [number, number, number, number] {
  return extents(
    entities,
    drawing.textStyles,
    drawing.blocks,
    undefined,
    undefined,
    undefined,
    drawing.dimensionStyles,
  );
}

/** The fields of a viewport that say how its view is drawn, which are the same in every one. */
function writeViewFields(g: Group, viewHeight: number, status: number): void {
  point(g, 13, 0, 0); // snap base
  g(14, 0.5); // snap spacing
  g(24, 0.5);
  g(15, 0.5); // grid spacing
  g(25, 0.5);
  point3(g, 16, 0, 0, 1); // view direction
  point3(g, 17, 0, 0, 0); // view target
  g(42, 50); // lens length
  g(43, 0); // front clip
  g(44, 0); // back clip
  g(45, viewHeight);
  g(50, 0); // snap angle
  g(51, 0); // view twist
  g(72, 1000); // circle zoom percent
  g(90, status);
  g(1, ""); // plot style sheet
  g(281, 0); // render mode: 2D
  g(71, 1); // a UCS of its own
  g(74, 0); // UCS icon at the origin: no
  point3(g, 110, 0, 0, 0); // UCS origin
  point3(g, 111, 1, 0, 0); // UCS X axis
  point3(g, 112, 0, 1, 0); // UCS Y axis
  g(79, 0); // orthographic UCS: none
  g(146, 0); // elevation
  g(170, 0); // shade plot: as displayed
  g(61, 5); // major grid lines
}

/** In a viewport's status, group 90: the view is locked against zooming. */
const VIEW_LOCKED = 0x4000;
/** In group 90: a bit AutoCAD sets on every viewport, with the UCS icon's two bits. */
const VIEW_STATUS = 0x8000 | 0x40 | 0x20;

/**
 * The viewport AutoCAD keeps for the sheet as a whole, which is the first of every layout and
 * has the number 1. Its view is the sheet with a margin, so the layout opens on its paper.
 */
function writeSheetViewport(g: Group, sheet: Sheet, owner: string): void {
  const { width, height } = sheet.paper;
  const aspect = 1.6;
  const viewHeight = Math.max(height, width / aspect) * 1.1;
  g(0, "VIEWPORT");
  g(5, sheet.handles.sheet);
  g(330, owner);
  g(100, "AcDbEntity");
  g(67, 1);
  g(8, "0");
  g(100, "AcDbViewport");
  point(g, 10, width / 2, height / 2);
  g(40, viewHeight * aspect);
  g(41, viewHeight);
  g(68, 1); // on, and the first to be drawn
  g(69, 1);
  g(12, width / 2); // view center
  g(22, height / 2);
  writeViewFields(g, viewHeight, VIEW_STATUS);
}

/** Writes a viewport of a layout: its rectangle on the paper, and the view it shows, locked. */
function writeViewport(
  g: Group,
  viewport: Viewport,
  handle: string,
  owner: string,
  number: number,
  paper: PaperInfo,
  units: Units,
): void {
  const view = validViewportView(viewport, paper.units, units);
  g(0, "VIEWPORT");
  g(5, handle);
  g(330, owner);
  g(100, "AcDbEntity");
  g(67, 1);
  g(8, viewport.layer);
  g(100, "AcDbViewport");
  point(g, 10, ...view.paperCenter);
  g(40, view.width);
  g(41, view.height);
  g(68, number); // on, and its place in the order the viewports are drawn in
  g(69, number);
  g(12, view.center[0]);
  g(22, view.center[1]);
  writeViewFields(g, view.viewHeight, VIEW_STATUS | VIEW_LOCKED);
}

/** In a page setup's flags, group 70. */
const PLOT_USE_STANDARD_SCALE = 16;
const PLOT_PLOT_STYLES = 32;
const PLOT_LINEWEIGHTS = 128;
const PLOT_VIEWPORTS_FIRST = 512;
const PLOT_MODEL_TYPE = 1024;
const PLOT_INITIALIZING = 8192;

/**
 * The layout of the model tab. Its page setup names no plotter, so AutoCAD marks it as one
 * still to be set up, and plots model space with the settings a drafter gives it.
 */
function writeModelLayout(
  g: Group,
  handle: string,
  dictionary: string,
  modelSpace: string,
  box: readonly [number, number, number, number],
): void {
  g(0, "LAYOUT");
  ownedBy(g, handle, dictionary);
  g(100, "AcDbPlotSettings");
  g(1, ""); // page setup name
  g(2, "none_device");
  g(4, ""); // paper size
  g(6, ""); // plot view
  for (const code of [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 140, 141]) g(code, 0);
  g(142, 1);
  g(143, 1);
  g(
    70,
    PLOT_INITIALIZING |
      PLOT_MODEL_TYPE |
      PLOT_VIEWPORTS_FIRST |
      PLOT_LINEWEIGHTS |
      PLOT_PLOT_STYLES |
      PLOT_USE_STANDARD_SCALE,
  );
  g(72, 0); // paper units: inches
  g(73, 0); // rotation
  g(74, 0); // plot area: the display
  g(7, ""); // plot style table
  g(75, 0); // standard scale: fit
  g(147, 1); // scale factor
  g(76, 0); // shade plot: as displayed
  g(77, 2); // shade plot resolution: normal
  g(78, 300); // shade plot DPI
  g(148, 0); // paper image origin
  g(149, 0);
  g(100, "AcDbLayout");
  g(1, "Model");
  g(70, 1); // linetypes scale to paper
  g(71, 0); // the first tab
  g(10, 0); // limits
  g(20, 0);
  g(11, 12);
  g(21, 9);
  point3(g, 12, 0, 0, 0); // insertion base
  point3(g, 14, box[0], box[1], 0); // extents
  point3(g, 15, box[2], box[3], 0);
  g(146, 0); // elevation
  point3(g, 13, 0, 0, 0); // UCS origin
  point3(g, 16, 1, 0, 0); // UCS X axis
  point3(g, 17, 0, 1, 0); // UCS Y axis
  g(76, 0); // orthographic UCS: none
  g(330, modelSpace);
}

/**
 * A layout: its page setup, then its sheet. The page setup plots the layout on `DWG To PDF.pc3`
 * at 1:1 with its plot style table and with lineweights. Its lengths are in millimetres,
 * whatever the paper's units.
 */
function writeLayout(
  g: Group,
  sheet: Sheet,
  dictionary: string,
  tab: number,
  box: readonly [number, number, number, number],
): void {
  const { layout, paper, handles } = sheet;
  const mm = (length: number): number => paperMillimetres(length, paper.units);
  const [left, bottom, right, top] = mediumMargins(paper);
  g(0, "LAYOUT");
  ownedBy(g, handles.layout, dictionary);
  g(100, "AcDbPlotSettings");
  g(1, ""); // page setup name
  g(2, PLOTTER);
  g(4, paper.media);
  g(6, ""); // plot view
  // The margins the plotter keeps clear and the medium's size, as the plotter holds it.
  g(40, mm(left));
  g(41, mm(bottom));
  g(42, mm(right));
  g(43, mm(top));
  g(44, mm(paper.medium.width));
  g(45, mm(paper.medium.height));
  g(46, 0); // plot origin
  g(47, 0);
  g(48, 0); // plot window, lower left
  g(49, 0);
  g(140, 0); // plot window, upper right
  g(141, 0);
  g(142, 1); // custom scale: paper units
  g(143, 1); // custom scale: drawing units
  g(70, PLOT_VIEWPORTS_FIRST | PLOT_LINEWEIGHTS | PLOT_PLOT_STYLES | PLOT_USE_STANDARD_SCALE);
  g(72, paper.units === "in" ? 0 : 1);
  g(73, paper.medium.rotation); // the plot's rotation onto the medium
  g(74, 5); // plot area: the layout
  g(7, layout.plotStyle ?? DEFAULT_PLOT_STYLE_TABLE);
  g(75, 16); // standard scale: 1:1
  g(147, 1); // scale factor
  g(76, 0); // shade plot: as displayed
  g(77, 2); // shade plot resolution: normal
  g(78, 300); // shade plot DPI
  g(148, 0); // paper image origin
  g(149, 0);
  g(100, "AcDbLayout");
  g(1, dxfOnce(layout.name));
  g(70, 1); // linetypes scale to paper
  g(71, tab);
  const limits = sheetLimits(paper);
  g(10, limits[0]);
  g(20, limits[1]);
  g(11, limits[2]);
  g(21, limits[3]);
  point3(g, 12, 0, 0, 0); // insertion base
  point3(g, 14, box[0], box[1], 0); // extents
  point3(g, 15, box[2], box[3], 0);
  g(146, 0); // elevation
  point3(g, 13, 0, 0, 0); // UCS origin
  point3(g, 16, 1, 0, 0); // UCS X axis
  point3(g, 17, 0, 1, 0); // UCS Y axis
  g(76, 0); // orthographic UCS: none
  g(330, handles.record);
  g(331, handles.sheet); // the viewport that was last current
}
