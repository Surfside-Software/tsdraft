import { heldColor, matchedIndex, storedColor } from "./colors.ts";
import { storedTransparency } from "./transparency.ts";
import {
  attributeTextStart,
  definitionHandle,
  insertAttributeHandle,
  insertEndHandle,
  blockHandles,
  blocksByKey,
  placeAttribute,
  type PlacedAttribute,
} from "./blocks.ts";
import {
  arrowheadInfo,
  DEFAULT_ARROWHEAD,
  DEFAULT_LEADER_ARROWHEAD,
  DIMENSION_ANGLE_UNITS,
  DIMENSION_ARC_SYMBOLS,
  JOG_ANGLE,
  leaderArrowheadInfo,
  type LeaderArrowheadStroke,
} from "./arrowheads.ts";
import {
  arrowheadEntityHandle,
  arrowheadsWithBlocks,
  arcLengthArc,
  dimensionAngle,
  dimensionFileText,
  dimensionMeasure,
  dimensionPicture,
  FEET_INCH_ZEROS_CODES,
  validDimensionPictureHandles,
  validDimensionStyleHandle,
  mtextOfLabel,
  type DimensionLabel,
  type DimensionPlace,
  type DimensionPicture,
  type DimensionPictureHandles,
  type Dimension,
  isDimension,
  isRadial,
} from "./dimensions.ts";
import type {
  AttributeDefinition,
  ParagraphAttributeDefinition,
  Block,
  DimensionStyle,
  Drawing,
  Entity,
  EntityColor,
  EntityTransparency,
  Image,
  Underlay,
  Insert,
  Layout,
  Leader,
  ParagraphAlign,
  ParagraphVerticalAlign,
  Table,
  TableStyle,
  LeaderStyle,
  Linetype,
  LinetypeMark,
  Point,
  Text,
  TextStyle,
  Units,
  Viewport,
  HatchPattern,
  Spline,
} from "./drawing.ts";
import { isFitSpline } from "./drawing.ts";
import { boxer, type Boxer } from "./extents.ts";
import { drawingTables } from "./table-pictures.ts";
import { clamped, fitSpline } from "./curves.ts";
import {
  dimensionMask,
  GRADIENT_NAMES,
  gradientWritten,
  rgbNumber,
  hatchLines,
  patternFinder,
  loopBulged,
  maskOf,
  type Mask,
  variableDictionaryHandle,
  WIPEOUT_APPLICATION,
  wipeoutClip,
  wipeoutCount,
  wipeoutFrameVariableHandle,
  wipeoutPicture,
  wipeoutVariablesHandle,
} from "./fills.ts";
import {
  drawingImages,
  IMAGE_DICTIONARY,
  IMAGE_VARIABLES,
  exactKey,
  imageClip,
  imageDefinitions,
  imageDictionaryHandle,
  imagePathKey,
  imageReactorHandle,
  imageVectors,
  RASTER_UNITS,
  rasterVariablesHandle,
  writtenImagePath,
  type ImageDefinition,
} from "./images.ts";
import {
  drawingUnderlays,
  pageOf,
  UNDERLAY_DICTIONARY,
  underlayClip,
  underlayDefinitions,
  underlayDictionaryHandle,
  underlayFlags,
  underlayFrameValue,
  underlayFrameVariableHandle,
  underlayPathKey,
  type UnderlayDefinition,
} from "./underlays.ts";

/** The key of a page's definition: its page, and its path with \ and / as one. */
const underlayKey = (path: string, page: string): string =>
  exactKey(`${page}|${underlayPathKey(path)}`);

import {
  cellStyleOf,
  gridCells,
  STANDARD_TABLE_STYLE_SIZES,
  TABLE_ROW_KINDS,
  TABLE_STYLE_DICTIONARY,
  tableMargins,
  tablePictureHandle,
  tableRows,
  tableStyleDictionaryHandle,
  validTableStyleHandle,
  type GridCell,
  type TablePicture,
  type TablePlace,
} from "./tables.ts";
import { isUnits } from "./units.ts";
import { checksLimit, DrawingError } from "./lint.ts";
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
import {
  dxfOnce,
  dxfText,
  fifteenDigits,
  fmt,
  readable,
  sixteenDigits,
  written,
  writtenAngle,
} from "./format.ts";
import { layerKey, layerZeroFirst } from "./layers.ts";
import {
  layoutParagraph,
  lineSpacingStyleCode,
  paragraphAttachment,
  paragraphColumnsHeld,
  paragraphDirection,
  paragraphInStyle,
} from "./paragraphs.ts";
import {
  attachmentCode,
  LEADER_STYLE_DICTIONARY,
  leaderArrowheadHandles,
  leaderArrowheadsWithBlocks,
  leaderAttachment,
  leaderCount,
  leaderOwnFlags,
  leaderPicture,
  leaderSizes,
  leaderStyleDictionaryHandle,
  leaderVerticalAttachment,
  noteAttachmentPoint,
  verticalAttachmentCode,
  STANDARD_LEADER_STYLE_SIZES,
  validLeaderStyleHandle,
  heldByBlock,
  leaderPlacesBlock,
} from "./leaders.ts";
import { entityLinetype, layerLinetype, lineweightCode, patternLength } from "./linetypes.ts";
import { idKey, isStandardTextStyle, shown, TEXT_ALIGNS, TEXT_VERTICAL_ALIGNS } from "./rules.ts";
import { pointMode, pointSize } from "./points.ts";
import { shxFileKey } from "./shapes.ts";
import { isNumber } from "./guards.ts";

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
 * Writes an ASCII DXF in the R2018 format (AC1032), the newest DXF version
 * published. The 2027 release of the leading CAD app still reads and writes AC1032.
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

  // The extents are worked out here, so they are brought into the range the leading CAD app reads.
  // Each block's outline is worked out once for the drawing, within the limit `lint` boxes it in.
  const boxOf = boxer(
    drawing.textStyles,
    drawing.blocks,
    undefined,
    undefined,
    undefined,
    drawing.dimensionStyles,
    drawing.leaderStyles,
    checksLimit(drawing),
    undefined,
    drawing.tableStyles,
  );

  const [left, bottom, right, top] = extentsOf(drawing.entities, boxOf, "model space");
  // Each layout is boxed once, after model space, as `lint` boxes them.
  const sheetBoxes = sheets.map((sheet) => sheetExtents(sheet, drawing, boxOf));

  const [minX, minY, maxX, maxY] = [
    readable(left),
    readable(bottom),
    readable(right),
    readable(top),
  ];

  const leaderStyles = drawing.leaderStyles ?? [];
  // Keyed as style names are compared, so a leader that names `notes` takes the style `NOTES`.
  const leaderStylesByKey = new Map(leaderStyles.map((style) => [layerKey(style.name), style]));
  const leaderArrowheads = leaderArrowheadsWithBlocks(leaderStyles);
  const tableStyles = drawing.tableStyles ?? [];
  // Each file the images show is one definition, and each image has a reactor of its own.
  const images = [...drawingImages(drawing)];
  const definitions = imageDefinitions(images);
  // Keyed exactly, since a path may be long.
  const definitionOf = new Map<string, ImageDefinition>();

  for (const definition of definitions)
    definitionOf.set(exactKey(imagePathKey(definition.path)), definition);
  const reactors: { readonly image: string; readonly reactor: string; readonly of: string }[] = [];
  // Each page the underlays show is one definition, which lists the underlays of it.
  const underlays = [...drawingUnderlays(drawing)];
  const pageDefinitions = underlayDefinitions(underlays);
  const pageDefinitionOf = new Map<string, UnderlayDefinition>();

  for (const definition of pageDefinitions)
    pageDefinitionOf.set(underlayKey(definition.path, definition.page), definition);
  const underlayUsers = new Map<string, string[]>();
  const pdfFrame = underlayFrameValue(drawing.underlayFrame);

  g(0, "SECTION");
  g(2, "CLASSES");

  // A jogged radius dimension is an entity of a class, which a drawing that has one lists.
  const jogged = [drawing.entities, ...sheets.map((sheet) => sheet.layout.entities)]
    .flat()
    .filter((e) => e.kind === "jogged-radius-dimension").length;

  if (jogged > 0) {
    writeClass(g, "LARGE_RADIAL_DIMENSION", "AcDbRadialDimensionLarge", "ObjectDBX Classes", 1025, {
      count: jogged,
      entity: true,
    });
  }

  // So is an arc length dimension.
  const arcLengths = [drawing.entities, ...sheets.map((sheet) => sheet.layout.entities)]
    .flat()
    .filter((e) => e.kind === "arc-length-dimension").length;

  if (arcLengths > 0) {
    writeClass(g, "ARC_DIMENSION", "AcDbArcDimension", "ObjectDBX Classes", 1025, {
      count: arcLengths,
      entity: true,
    });
  }

  // A multileader and its style are objects of classes, which a drawing that has them lists.
  if (leaderStyles.length > 0) {
    writeClass(g, "MLEADERSTYLE", "AcDbMLeaderStyle", "ACDB_MLEADERSTYLE_CLASS", 4095, {
      count: leaderStyles.length + 1,
      entity: false,
    });
    writeClass(g, "MULTILEADER", "AcDbMLeader", "ACDB_MLEADER_CLASS", 1025, {
      count: leaderCount(drawing),
      entity: true,
    });
  }

  const tableCount = [drawing.entities, ...sheets.map((sheet) => sheet.layout.entities)]
    .flat()
    .filter((e) => e.kind === "table").length;

  // A table and its style are objects of classes too.
  if (tableStyles.length > 0) {
    writeClass(g, "TABLESTYLE", "AcDbTableStyle", "ObjectDBX Classes", 4095, {
      count: tableStyles.length + 1,
      entity: false,
    });
    writeClass(g, "ACAD_TABLE", "AcDbTable", "ObjectDBX Classes", 1025, {
      count: tableCount,
      entity: true,
    });
  }

  const wipeouts = wipeoutCount(drawing);

  if (wipeouts > 0) {
    writeClass(g, "WIPEOUT", "AcDbWipeout", WIPEOUT_APPLICATION, 2175, {
      count: wipeouts,
      entity: true,
    });
    writeClass(g, "WIPEOUTVARIABLES", "AcDbWipeoutVariables", WIPEOUT_APPLICATION, 0, {
      count: 1,
      entity: false,
    });
    writeClass(g, "DICTIONARYVAR", "AcDbDictionaryVar", "ObjectDBX Classes", 0, {
      count: 1,
      entity: false,
    });
  }

  if (underlays.length > 0) {
    writeClass(g, "PDFDEFINITION", "AcDbPdfDefinition", "ObjectDBX Classes", 1153, {
      count: pageDefinitions.length,
      entity: false,
    });
    writeClass(g, "PDFUNDERLAY", "AcDbPdfReference", "ObjectDBX Classes", 4095, {
      count: underlays.length,
      entity: true,
    });

    if (wipeouts === 0 && pdfFrame !== 1) {
      writeClass(g, "DICTIONARYVAR", "AcDbDictionaryVar", "ObjectDBX Classes", 0, {
        count: 1,
        entity: false,
      });
    }
  }

  // The leading CAD app draws nothing of an image whose class it holds no count of.
  if (images.length > 0) {
    const count = (n: number, entity = false) => ({ count: n, entity });
    writeClass(g, "IMAGEDEF", "AcDbRasterImageDef", "ISM", 0, count(definitions.length));
    writeClass(g, "RASTERVARIABLES", "AcDbRasterVariables", "ISM", 0, count(1));
    writeClass(g, "IMAGEDEF_REACTOR", "AcDbRasterImageDefReactor", "ISM", 1, count(images.length));
    writeClass(g, "IMAGE", "AcDbRasterImage", "ISM", 2175, count(images.length, true));
  }

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

  const linetypeHandles = linetypes.map(() => handle());
  // A leader style draws its shafts in the linetype ByBlock, which it holds by its handle.
  const linetypeByBlock = linetypeHandles[0]!;
  const textStyles = drawing.textStyles ?? [];
  // A linetype's mark holds its text style, or its shape file's, by its handle. The shape files
  // are styles of their own after the text styles, one for each file, in the order first named.
  const shxKeys = new Map<string, string>();

  for (const t of linetypes)
    for (const m of t.marks ?? [])
      if ("glyph" in m && !shxKeys.has(shxFileKey(m.file))) shxKeys.set(shxFileKey(m.file), m.file);
  const shxFiles = [...shxKeys.values()];
  let styleHandles: { standard: string; list: string[]; shx: string[] } | undefined;

  const allocateStyles = () => ({
    standard: handle(),
    list: textStyles.map(() => handle()),
    shx: shxFiles.map(() => handle()),
  });

  // A drawing whose linetypes have no marks numbers its styles after its linetypes' table.
  if (linetypes.some((t) => (t.marks?.length ?? 0) > 0)) styleHandles = allocateStyles();

  const markStyle = (m: LinetypeMark): string => {
    const handles = styleHandles!;

    if ("glyph" in m) return handles.shx[[...shxKeys.keys()].indexOf(shxFileKey(m.file))]!;
    const name = m.style ?? STANDARD_TEXT_STYLE;

    if (isStandardTextStyle(name)) return handles.standard;
    const key = layerKey(name);

    return handles.list[textStyles.findIndex((t) => layerKey(t.name) === key)] ?? handles.standard;
  };

  writeTable(
    g,
    handle,
    "LTYPE",
    linetypes.map((linetype, i) => ({
      type: "LTYPE",
      subclass: "AcDbLinetypeTableRecord",
      name: linetype.name,
      handle: linetypeHandles[i]!,
      fields: (g) => {
        g(3, dxfOnce(linetype.description));
        g(72, 65); // alignment: "A"
        g(73, linetype.pattern.length);
        g(40, patternLength(linetype.pattern.map(written)));
        const marks = linetype.marks ?? [];
        linetype.pattern.forEach((length, i) => {
          g(49, length);
          const m = marks.find((mark) => mark.after === i);

          if (m === undefined) {
            g(74, 0); // a plain dash, gap or dot

            return;
          }

          const text = "text" in m;
          const orient = m.orient ?? "relative";
          g(74, (text ? 2 : 4) | (orient === "absolute" ? 1 : 0) | (orient === "upright" ? 8 : 0));
          // SAFETY: toDXF writes only what lint passes, which refuses a glyph that is no number.
          g(75, text ? 0 : (m.glyph as number));
          g(340, markStyle(m));
          g(46, text ? m.height : m.scale);
          g(50, m.rotation ?? 0);
          g(44, m.offset?.[0] ?? 0);
          g(45, m.offset?.[1] ?? 0);

          if (text) g(9, dxfOnce(m.text));
        });
      },
    })),
  );
  // A viewport holds each layer it freezes by the layer's handle.
  const layerHandles = new Map<string, string>();
  writeTable(
    g,
    handle,
    "LAYER",
    // AUDIT reports "Layer zero name found at incorrect index" unless layer 0 comes first.
    layerZeroFirst(drawing.layers).map((layer) => ({
      type: "LAYER",
      subclass: "AcDbLayerTableRecord",
      name: layer.name,
      handle: layerHandleOf(layerHandles, layer.name, handle()),
      flags: (layer.frozen ? 1 : 0) | (layer.locked ? 4 : 0),
      fields: (g) => {
        // A layer that is off has its color negated.
        g(62, layer.off ? -layer.color : layer.color);
        g(6, layerLinetype(layer));

        if (layer.plot === false) g(290, 0);
        g(370, lineweightCode(layer.lineweight ?? "Default"));
        g(390, normalPlotStyle); // the leading CAD app rejects a layer without a plot style
      },
    })),
  );
  styleHandles ??= allocateStyles();
  const standardStyle = styleHandles.standard;
  // Each text style has a handle of its own. A dimension style holds the first of a name.
  const textStyleHandleList = styleHandles.list;

  const textStyleHandles = new Map(
    textStyles
      .map((style, i): [string, string] => [layerKey(style.name), textStyleHandleList[i]!])
      .reverse(),
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
    // A shape file is a style with no name and flag 1, which the leading CAD app makes for a
    // linetype's shapes.
    ...shxFiles.map((file, i) => ({
      type: "STYLE",
      subclass: "AcDbTextStyleTableRecord",
      name: "",
      handle: styleHandles!.shx[i]!,
      flags: 1,
      fields: (g: Group) => {
        g(40, 0);
        g(41, 1);
        g(50, 0);
        g(71, 0);
        g(42, 0.2);
        g(3, dxfOnce(file));
        g(4, "");
      },
    })),
  ]);
  // Keyed as style names are compared, so a text that names `notes` takes the style `NOTES`.
  const stylesByKey = new Map(textStyles.map((style) => [layerKey(style.name), style]));
  const patternOf = patternFinder(drawing.patterns);

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
      if (!isDimension(entity)) return;
      const style = dimensionStylesByKey.get(layerKey(entity.style));

      if (style === undefined) return;
      const layout = space === 0 ? undefined : sheets[space - 1]!.layout.name;
      pictures.set(`${space}/${index}`, {
        name: `*D${pictures.size + 1}`,
        picture: dimensionPicture(entity, style, styleOf(style.textStyle)),
        handles: validDimensionPictureHandles(dimensionPlace(index, entity.id, layout)),
        layer: entity.layer,
        textStyle: styleOf(style.textStyle)?.name ?? STANDARD_TEXT_STYLE,
        mask: dimensionMask(style),
      });
    });
  });
  // The block of each table's picture, by the table's space and place, as a dimension's.
  const tableBlocks = new Map<string, TableBlockHeld>();
  /** The handles of the tables that name each style, which the style lists as its reactors. */
  const tablesOfStyle = new Map<string, string[]>();

  for (const drawn of drawingTables(drawing, boxOf)) {
    tableBlocks.set(`${drawn.space}/${drawn.index}`, {
      name: drawn.name,
      picture: drawn.picture,
      place: drawn.place,
      style: drawn.style,
      layer: drawn.table.layer,
      rotation: drawn.table.rotation,
    });
  }

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
    // An xref's record states no units: the leading CAD app keeps the scale each insert of it has.
    ...xrefs.map((xref) => ({
      type: "BLOCK_RECORD",
      subclass: "AcDbBlockTableRecord",
      name: xref.name,
      handle: blockHandles(xref.name).record,
      fields: blockRecordFields,
    })),
    // The block of each arrowhead a dimension style or a leader style draws with.
    ...[...arrowheads, ...leaderArrowheads].map(({ block }) => ({
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
    ...[...tableBlocks.values()].map(({ name, place }) => ({
      type: "BLOCK_RECORD",
      subclass: "AcDbBlockTableRecord",
      name,
      handle: tablePictureHandle(place, "record"),
      fields: blockRecordFields,
    })),
  ]);
  g(0, "ENDSEC");

  const blocksByName = blocksByKey(blocks);
  /** The handle each table was written with. */
  const tableHandles = new Map<TableBlockHeld, string>();

  /** Writes a table entity, which a style the drawing does not have leaves out. */
  const writeTableEntity = (
    table: Table,
    handle: string,
    owner: string,
    paper: boolean,
    space: number | undefined,
    index: number,
  ): void => {
    const held = space === undefined ? undefined : tableBlocks.get(`${space}/${index}`);

    if (held === undefined) return;
    tableHandles.set(held, handle);
    writeTableGroups(g, table, held, { handle, owner, paper }, (name) => {
      const block = blocksByName.get(layerKey(name));

      return block === undefined ? undefined : blockHandles(block.name).record;
    });
  };

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

      if (entity.kind === "image") {
        const definition = definitionOf.get(exactKey(imagePathKey(entity.path)))!;
        const reactor = entity.id === undefined ? handle() : imageReactorHandle(idKey(entity.id));
        reactors.push({ image: own, reactor, of: definition.handle });
        writeImage(g, entity, {
          handle: own,
          owner,
          paper,
          definition: definition.handle,
          reactor,
        });

        return;
      }

      if (entity.kind === "underlay") {
        const definition = pageDefinitionOf.get(underlayKey(entity.path, pageOf(entity)))!;
        const users = underlayUsers.get(definition.handle);

        if (users) users.push(own);
        else underlayUsers.set(definition.handle, [own]);
        writeUnderlay(g, entity, { handle: own, owner, paper, definition: definition.handle });

        return;
      }

      if (entity.kind === "leader") {
        const style = leaderStylesByKey.get(layerKey(entity.style));

        if (style === undefined) return;
        const named = entity.textStyle ?? style.textStyle;
        writeLeader(g, entity, style, {
          handle: own,
          owner,
          paper,
          findBlock: (name) => blocksByName.get(layerKey(name)),
          textStyle: styleOf(named),
          textStyleHandle:
            textStyleHandles.get(layerKey(named ?? STANDARD_TEXT_STYLE)) ?? standardStyle,
          linetype: linetypeByBlock,
        });

        return;
      }

      if (entity.kind === "table") {
        writeTableEntity(entity, own, owner, paper, space, index);

        return;
      }

      if (isDimension(entity)) {
        const picture = space === undefined ? undefined : pictures.get(`${space}/${index}`);
        writeDimension(
          g,
          entity,
          dimensionStylesByKey.get(layerKey(entity.style)),
          own,
          owner,
          paper,
          picture?.name,
          picture?.picture,
        );

        return;
      }

      if (entity.kind !== "insert") {
        writeEntity(
          g,
          entity,
          own,
          owner,
          entity.kind === "text" || entity.kind === "paragraph" ? styleOf(entity.style) : undefined,
          paper,
          patternOf,
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

        if (definition.kind === "paragraph") {
          writeParagraphAttribute(g, definition, styleOf(definition.style), placed, undefined);
          continue;
        }

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
      const frozen = frozenHandles(viewport, layerHandles);
      writeViewport(g, viewport, own, owner, index + 2, sheet.paper, drawing.units, frozen);
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
    writeBlock(
      g,
      sheet.handles.begin,
      sheet.handles.end,
      sheet.block,
      sheet.handles.record,
      index === 0 ? { paper: true } : { paper: true, contents: () => writeSheet(sheet, index + 1) },
    );
  });
  const placedByLeader = leaderPlacesBlock(drawing);

  for (const block of blocks) {
    const handles = blockHandles(block.name);
    // A block a leader places holds all it draws ByBlock, as the leading CAD app reads it.
    const byBlock = placedByLeader(block.name);
    writeBlock(g, handles.begin, handles.end, block.name, handles.record, {
      paper: false,
      base: block.base,
      hasAttributes: (block.attributes ?? []).length > 0,
      contents: () => {
        writeEntities(byBlock ? heldByBlock(block.entities) : block.entities, handles.record);

        for (const definition of block.attributes ?? []) {
          g(0, "ATTDEF");
          g(5, definitionHandle(block.name, definition.tag));
          g(330, handles.record);
          g(100, "AcDbEntity");
          g(8, definition.layer);

          if (byBlock) writeColor(g, undefined, "ByBlock");
          g(100, "AcDbText");

          if (definition.kind === "paragraph") {
            const prompt = definition.prompt ?? definition.tag;
            writeParagraphAttribute(g, definition, styleOf(definition.style), undefined, prompt);
            continue;
          }

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
      attach: xref.attach === true,
    });
  }

  for (const { arrowhead, block } of arrowheads) {
    const handles = blockHandles(block);
    const stroke = arrowheadInfo(arrowhead)!.stroke!;
    writeBlock(g, handles.begin, handles.end, block, handles.record, {
      paper: false,
      contents: () => {
        // One stroke, as wide as the arrowhead's, which takes its color and its linetype
        // from the dimension that draws it: a line where it has no width, which takes its
        // lineweight from the dimension too.
        if (stroke.width === 0) {
          writeArrowheadStroke(
            g,
            { kind: "line", from: stroke.from, to: stroke.to },
            arrowheadEntityHandle(block),
            handles.record,
          );

          return;
        }

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

  for (const { arrowhead, block, strokes } of leaderArrowheads) {
    const handles = blockHandles(block);
    const own = leaderArrowheadHandles(arrowhead)!.strokes;
    writeBlock(g, handles.begin, handles.end, block, handles.record, {
      paper: false,
      contents: () =>
        strokes.forEach((stroke, i) => writeArrowheadStroke(g, stroke, own[i]!, handles.record)),
    });
  }

  for (const picture of pictures.values()) writePicture(g, picture);

  for (const held of tableBlocks.values()) {
    writeTablePicture(g, held, styleOf, (name) => blocksByName.get(layerKey(name))?.name);
  }

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

  if (images.length > 0) {
    g(3, IMAGE_DICTIONARY);
    g(350, imageDictionaryHandle());
    g(3, IMAGE_VARIABLES);
    g(350, rasterVariablesHandle());
  }

  if (sheets.length > 0) {
    g(3, "ACAD_LAYOUT");
    g(350, layoutDictionary);
  }

  const leaderDictionary = leaderStyleDictionaryHandle();

  if (leaderStyles.length > 0) {
    g(3, LEADER_STYLE_DICTIONARY);
    g(350, leaderDictionary);
  }

  g(3, "ACAD_PLOTSTYLENAME");
  g(350, plotStyleDictionary);
  const tableDictionary = tableStyleDictionaryHandle();

  if (tableStyles.length > 0) {
    g(3, TABLE_STYLE_DICTIONARY);
    g(350, tableDictionary);
  }

  if (underlays.length > 0) {
    g(3, UNDERLAY_DICTIONARY);
    g(350, underlayDictionaryHandle());
  }

  if (wipeouts > 0) {
    g(3, "ACAD_WIPEOUT_VARS");
    g(350, wipeoutVariablesHandle());
  }

  const pdfFrameWritten = underlays.length > 0 && pdfFrame !== 1;

  if (wipeouts > 0 || pdfFrameWritten) {
    g(3, "AcDbVariableDictionary");
    g(350, variableDictionaryHandle());
  }

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

  if (leaderStyles.length > 0) {
    // The leading CAD app's own style, then the drawing's, which the dictionary lists by name.
    const styles: [LeaderStyle, string][] = [
      [STANDARD_LEADER_STYLE_SIZES, standardStyle],
      ...leaderStyles.map((style): [LeaderStyle, string] => [
        style,
        textStyleHandles.get(layerKey(style.textStyle ?? STANDARD_TEXT_STYLE)) ?? standardStyle,
      ]),
    ];

    g(0, "DICTIONARY");
    ownedBy(g, leaderDictionary, rootDictionary);
    g(100, "AcDbDictionary");
    g(281, 1);

    for (const [style] of styles) {
      g(3, dxfOnce(style.name));
      g(350, validLeaderStyleHandle(style.name));
    }

    for (const [style, textStyle] of styles) {
      const content =
        style.block === undefined ? undefined : blocksByName.get(layerKey(style.block))?.name;

      writeLeaderStyle(g, style, leaderDictionary, textStyle, linetypeByBlock, content);
    }
  }

  if (tableStyles.length > 0) {
    // Each table names its style's handle, and the style lists the tables that name it, through
    // which the leading CAD app draws each table again when the style changes.
    for (const held of tableBlocks.values()) {
      const key = layerKey(held.style.name);
      const list = tablesOfStyle.get(key) ?? [];
      const written = tableHandles.get(held);

      if (written !== undefined) list.push(written);
      tablesOfStyle.set(key, list);
    }

    const styles = [STANDARD_TABLE_STYLE_SIZES, ...tableStyles];
    g(0, "DICTIONARY");
    ownedBy(g, tableDictionary, rootDictionary);
    g(100, "AcDbDictionary");
    g(281, 1);

    for (const style of styles) {
      g(3, dxfOnce(style.name));
      g(350, validTableStyleHandle(style.name));
    }

    for (const style of styles) {
      writeTableStyle(
        g,
        style,
        validTableStyleHandle(style.name),
        tableDictionary,
        tablesOfStyle.get(layerKey(style.name)) ?? [],
      );
    }
  }

  if (images.length > 0) {
    writeImageObjects(g, definitions, reactors, rootDictionary, drawing);
  }

  if (underlays.length > 0) writeUnderlayObjects(g, pageDefinitions, underlayUsers, rootDictionary);

  if (wipeouts > 0) writeWipeoutObjects(g, rootDictionary, drawing);

  if (wipeouts > 0 || pdfFrameWritten) {
    const values: Record<string, number> = {};

    if (pdfFrameWritten) values.PDFFRAME = pdfFrame;

    if (wipeouts > 0) values.WIPEOUTFRAME = drawing.wipeoutFrame === false ? 0 : 1;
    writeVariables(g, rootDictionary, values);
  }

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
      writeLayout(g, sheet, layoutDictionary, index + 1, sheetBoxes[index]!);
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

  if (drawing.pointStyle !== undefined) {
    h(9, "$PDMODE");
    h(70, pointMode(drawing.pointStyle));
    h(9, "$PDSIZE");
    h(40, pointSize(drawing.pointStyle));
  }

  // A drawing saved from this file then refuses in-place editing through a reference to it.
  h(9, "$XEDIT");
  h(290, 0);
  h(9, "$CLAYER");
  h(8, "0");
  const [first] = sheets;

  if (first !== undefined) {
    // The leading CAD app takes the extents and the limits of the layout it opens on from the header.
    const [pMinX, pMinY, pMaxX, pMaxY] = sheetBoxes[0]!;
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

  // The leading CAD app numbers the objects it adds from the seed up, so it is above every handle here.
  const named =
    blocks.length > 0 ||
    xrefs.length > 0 ||
    sheets.length > 0 ||
    dimensionStyles.length > 0 ||
    leaderStyles.length > 0 ||
    tableStyles.length > 0 ||
    images.length > 0 ||
    underlays.length > 0 ||
    wipeoutCount(drawing) > 0 ||
    drawing.entities.some((entity) => entity.id !== undefined);

  h(5, named ? ID_HANDLE_SEED : handle());
  h(0, "ENDSEC");

  return [...header, ...body].join("\r\n") + "\r\n";
}

function groupWriter(out: string[]): Group {
  return (code, value) => {
    out.push(String(code), isNumber(value) ? fmt(value) : value);
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
  // A drawing can span more than the leading CAD app can read as one number, so the height is capped.
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
    /** True for an xref that is attached, and not an overlay. */
    readonly attach?: boolean;
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
  const xref = block.attach === true ? 4 : 12;
  g(70, block.anonymous ? 1 : block.xrefPath !== undefined ? xref : block.hasAttributes ? 2 : 0);
  point(g, 10, ...(block.base ?? [0, 0]));
  g(3, name);
  // The leading CAD app decodes a block's path once, where it decodes a text twice.
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
  writeColor(g, e.color, e.transparency);
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
 * across the line. `placed` is what an insert makes of an attribute's definition. `start` is a
 * first point written in place of `at`.
 */
function writeTextFields(
  g: Group,
  e: Pick<Text, "at" | "height" | "value" | "rotation" | "align" | "valign">,
  style: TextStyle | undefined,
  placed:
    | { readonly widthFactor: number; readonly obliqueAngle: number; readonly mirrored: boolean }
    | undefined,
  start?: readonly [x: string, y: string],
): void {
  if (start) {
    g(10, start[0]);
    g(20, start[1]);
    g(30, 0);
  } else point(g, 10, ...e.at);
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
 * Writes an attribute definition of paragraph text, with its prompt, or an insert's attribute of
 * one, as `placed` gives it, after its subclass of a text: the text it would be as a line, which
 * holds no value, then the paragraph the leading CAD app draws, as an embedded object. The
 * attribute's paragraph is in the drawing's coordinates, also where the insert mirrors it.
 */
function writeParagraphAttribute(
  g: Group,
  definition: ParagraphAttributeDefinition,
  style: TextStyle | undefined,
  placed: PlacedAttribute | undefined,
  prompt: string | undefined,
): void {
  const uneven = placed?.paragraph?.uneven === true;
  const at = placed?.at ?? definition.at;
  const mirrored = placed?.mirrored === true;
  const height = placed?.height ?? definition.height;
  const rotation = placed?.rotation ?? definition.rotation;
  const valign = TEXT_VALIGN_OF[definition.valign ?? "top"];
  const [sx, sy] = attributeTextStart(definition, style, placed);
  const start = [fifteenDigits(sx), fifteenDigits(sy)] as const;
  writeTextFields(
    g,
    { at, height, value: "", rotation, align: definition.align ?? "left", valign },
    style,
    {
      widthFactor: uneven ? placed.widthFactor : 1,
      obliqueAngle: uneven ? placed.obliqueAngle : 0,
      mirrored,
    },
    start,
  );
  g(100, prompt === undefined ? "AcDbAttribute" : "AcDbAttributeDefinition");
  g(280, 0); // version

  if (prompt !== undefined) g(3, dxfText(prompt));
  g(2, dxfText(definition.tag));
  g(70, 0); // visible, and asked for on insertion
  g(74, TEXT_VERTICAL_ALIGNS.indexOf(valign));
  g(280, 1); // the attribute keeps its place in the block
  g(71, prompt === undefined ? 2 : 4); // of paragraph text, an attribute or a definition
  g(72, 0);
  const [x, y] = mirrored ? [-at[0], at[1]] : at;
  point(g, 11, x, y);
  g(101, "Embedded Object");
  point(g, 10, x, y);
  g(40, height);
  g(41, (placed ? placed.paragraph?.width : definition.width) ?? 0);
  g(46, 0); // no height of its own
  g(71, paragraphAttachment(definition));
  g(72, 1); // left to right
  writeMtextValue(g, placed?.paragraph?.value ?? definition.value);
  g(7, style?.name ?? STANDARD_TEXT_STYLE);

  if (mirrored) point3(g, 210, 0, 0, -1);
  const [cos, sin] = paragraphDirection(rotation);
  const across = mirrored ? -cos : cos;

  if (across !== 1 || sin !== 0) {
    g(11, fifteenDigits(across));
    g(21, fifteenDigits(sin));
    g(31, 0);
  }

  g(73, lineSpacingStyleCode(definition));
  g(44, definition.lineSpacing ?? 1);
}

/** A number with the 16 significant digits the leading CAD app saves a parameter with, and no exponent. */
/**
 * Writes a spline as the leading CAD app saves one. Through fit points: the cubic `fitSpline`
 * fits, then the points, a closed one with its first point again at the end and the tangent where
 * it joins at both ends. By control points: clamped, as that app saves every spline.
 */
function writeSpline(g: Group, e: Spline, begin: () => void): void {
  begin();
  point3(g, 210, 0, 0, 1);

  const tolerances = (fit: boolean) => {
    g(42, "0.000000001");
    g(43, "0.0000000001");

    if (fit) g(44, "0.0000000001");
  };

  const unit = (code: number, [x, y]: Point) => {
    const length = Math.hypot(x, y);

    for (const [at, value] of [
      [code, x / length],
      [code + 10, y / length],
    ] as const)
      g(at, value === 0 ? "0" : fifteenDigits(value));
    g(code + 20, 0);
  };

  // Numbers the writer works out, as the leading CAD app saves them, with 16 digits.
  const exactPoint = (code: number, x: number, y: number) => {
    g(code, sixteenDigits(x));
    g(code + 10, sixteenDigits(y));
    g(code + 20, 0);
  };

  if (isFitSpline(e)) {
    const closed = e.closed === true;
    // Fitted through the points as written, which a reader of the file fits through again.
    const asWritten = (p: Point): Point => [written(p[0]), written(p[1])];
    const points = e.fitPoints.map(asWritten);
    const fitted = fitSpline(points, "chord", e.startTangent, e.endTangent, closed);
    const fit = closed ? [...points, points[0]!] : points;
    const startTangent = closed ? fitted.tangent : e.startTangent;
    const endTangent = closed ? fitted.tangent : e.endTangent;
    // Fit by chord (32), planar (8), and 16 more for a line between two points with no tangent;
    // a closed one is periodic (2) and closed (1).
    const line = fit.length === 2 && !startTangent && !endTangent;
    g(70, 1024 + 32 + 8 + (line ? 16 : 0) + (closed ? 3 : 0));
    g(71, 3);
    g(72, fitted.knots.length);
    g(73, fitted.controlPoints.length);
    g(74, fit.length);
    tolerances(true);

    if (startTangent) unit(12, startTangent);

    if (endTangent) unit(13, endTangent);

    for (const knot of fitted.knots) g(40, sixteenDigits(knot));

    for (const [x, y] of fitted.controlPoints) exactPoint(10, x, y);

    for (const [x, y] of fit) point(g, 11, x, y);

    return;
  }

  // Knots are written with 16 digits, as a span may be smaller than 6 decimals hold; the control
  // points and weights as written, or with 16 digits where the clamp worked them out.
  const { degree, knots } = e;
  const controlPoints = e.controlPoints.map(([x, y]): Point => [written(x), written(y)]);

  const held = clamped(
    e.weights === undefined
      ? { degree, knots, controlPoints }
      : { degree, knots, controlPoints, weights: e.weights.map(written) },
  );

  const worked =
    held.knots.length !== e.knots.length || held.knots.some((k, i) => k !== e.knots[i]);

  g(70, 8 + (held.weights ? 4 : 0) + (e.closed ? 3 : 0));
  g(71, held.degree);
  g(72, held.knots.length);
  g(73, held.controlPoints.length);
  g(74, 0);
  tolerances(false);

  for (const knot of held.knots) g(40, sixteenDigits(knot));
  held.controlPoints.forEach(([x, y], i) => {
    if (worked) exactPoint(10, x, y);
    else point(g, 10, x, y);

    if (held.weights) g(41, worked ? sixteenDigits(held.weights[i]!) : held.weights[i]!);
  });
}

/** The vertical justification of the text a paragraph attribute would be as a line. */
const TEXT_VALIGN_OF = { top: "top", middle: "middle", bottom: "bottom" } as const;

/**
 * An entity's own color, after its linetype: group 62, and 420 for a true color; and its
 * transparency, group 440, which follows them.
 */
function writeColor(
  g: Group,
  color: EntityColor | undefined,
  transparency: EntityTransparency | undefined,
): void {
  const stored = storedColor(color);

  if (stored !== undefined) {
    g(62, stored.index);

    if (stored.rgb !== undefined) g(420, stored.rgb);
  }

  const value = storedTransparency(transparency);

  if (value !== undefined) g(440, value);
}

/**
 * Writes an entity. `style` is the text style of a text that is not in `Standard`, and `paper`
 * is true for an entity of a layout.
 */
function writeEntity(
  g: Group,
  e: Exclude<Entity, Insert | Dimension | Leader | Table>,
  handle: string,
  owner: string,
  style: TextStyle | undefined,
  paper: boolean,
  patternOf: (name: string) => HatchPattern | undefined,
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
    writeColor(g, e.color, e.transparency);

    if (e.lineweight !== undefined && e.lineweight !== "ByLayer") {
      g(370, lineweightCode(e.lineweight));
    }

    const scale = "linetypeScale" in e && isNumber(e.linetypeScale) ? e.linetypeScale : 1;

    if (scale !== 1) g(48, scale);
    g(100, subclass);
  };

  switch (e.kind) {
    case "line":
      begin("LINE", "AcDbLine");
      point(g, 10, ...e.from);
      point(g, 11, ...e.to);

      return;
    case "polyline": {
      begin("LWPOLYLINE", "AcDbPolyline");
      g(90, e.points.length);
      // Flag 128 runs the linetype's pattern on past each vertex.
      g(70, (e.closed ? 1 : 0) | (e.linetypeGeneration ? 128 : 0));

      // A width for each side is written at each point, and a constant width once.
      if (e.widths === undefined) g(43, e.width ?? 0);
      e.points.forEach(([x, y], i) => {
        g(10, x);
        g(20, y);
        const pair = e.widths?.[i];

        if (e.widths) {
          g(40, pair?.[0] ?? 0);
          g(41, pair?.[1] ?? 0);
        }

        const bulge = e.bulges?.[i] ?? 0;

        if (written(bulge) !== 0) g(42, bulge);
      });

      return;
    }

    case "circle":
      begin("CIRCLE", "AcDbCircle");
      point(g, 10, ...e.center);
      g(40, e.radius);

      return;
    case "point": {
      begin("POINT", "AcDbPoint");
      point(g, 10, ...e.at);
      // The file holds the angle the figure is turned clockwise by.
      const turned = written(e.rotation ?? 0) % 360;

      if (turned !== 0) g(50, 360 - turned);

      return;
    }

    case "arc":
      begin("ARC", "AcDbCircle");
      point(g, 10, ...e.center);
      g(40, e.radius);
      g(100, "AcDbArc");
      g(50, writtenAngle(e.startAngle));
      g(51, writtenAngle(e.endAngle));

      return;
    case "ellipse": {
      begin("ELLIPSE", "AcDbEllipse");
      point(g, 10, ...e.center);
      point(g, 11, ...e.majorAxis);
      point3(g, 210, 0, 0, 1);
      g(40, e.ratio);
      // The end is always past the start, by up to a turn, as the leading CAD app saves it.
      const radians = (t: number) => (writtenAngle(t) * Math.PI) / 180;
      const start = e.startParameter === undefined ? 0 : radians(e.startParameter);
      let end = e.endParameter === undefined ? 2 * Math.PI : radians(e.endParameter);

      if (end <= start) end += 2 * Math.PI;
      // With 15 digits, which the app reads back as written: from 16 it keeps one a bit off.
      g(41, start === 0 ? 0 : fifteenDigits(start));
      g(42, fifteenDigits(end));

      return;
    }

    case "spline":
      writeSpline(g, e, () => begin("SPLINE", "AcDbSpline"));

      return;
    case "paragraph": {
      begin("MTEXT", "AcDbMText");

      // Columns: the width of them all and their height, then an embedded object after group 44,
      // as the leading CAD app saves them.
      const columns =
        e.columns && paragraphColumnsHeld(e, layoutParagraph(paragraphInStyle(e, style)));

      point(g, 10, ...e.at);
      g(40, e.height);
      g(41, columns ? columns.total : (e.width ?? 0)); // the width its lines wrap at, or 0 for none
      g(46, columns ? columns.height : 0); // no height of its own
      const attachment = paragraphAttachment(e);
      g(71, attachment);
      g(72, 1); // left to right
      writeMtextValue(g, e.value);
      g(7, style?.name ?? STANDARD_TEXT_STYLE);
      const [cos, sin] = paragraphDirection(e.rotation);

      if (cos !== 1 || sin !== 0) {
        g(11, fifteenDigits(cos));
        g(21, fifteenDigits(sin));
        g(31, 0);
      }

      g(73, lineSpacingStyleCode(e));
      g(44, e.lineSpacing ?? 1);
      writeMask(g, maskOf(e.mask));

      if (columns) {
        g(101, "Embedded Object");
        g(70, attachment);

        if (cos === 1 && sin === 0) point(g, 10, 1, 0);
        else {
          g(10, fifteenDigits(cos));
          g(20, fifteenDigits(sin));
          g(30, 0);
        }

        point(g, 11, ...e.at);
        g(40, columns.total);
        g(41, columns.height);
        g(42, columns.total);
        g(43, readable(columns.tallest));
        g(71, columns.type);
        g(72, columns.count);
        g(44, columns.width);
        g(45, columns.gutter);
        g(73, columns.auto ? 1 : 0);
        g(74, 0); // left to right

        for (const tall of columns.heights) g(46, tall);
      }

      return;
    }

    case "hatch": {
      begin("HATCH", "AcDbHatch");
      point(g, 10, 0, 0);
      point3(g, 210, 0, 0, 1);
      const pattern = hatchLines(e, patternOf);
      g(2, pattern?.name ?? "SOLID");
      g(70, pattern === undefined ? 1 : 0); // solid, or lines
      g(71, 0); // no boundary objects
      const loops = e.loops;
      g(91, loops.length);

      for (const loop of loops) {
        const points = loop.points;
        const bulged = loopBulged(loop);
        g(92, 2); // a polyline
        g(72, bulged ? 1 : 0);
        g(73, 1); // closed
        g(93, points.length);
        points.forEach(([x, y], i) => {
          g(10, x);
          g(20, y);

          if (bulged) g(42, loop.bulges?.[i] ?? 0);
        });
        g(97, 0);
      }

      g(75, 0); // normal: the parity of the loops around a point

      if (pattern === undefined) g(76, 1); // predefined
      else {
        g(76, pattern.type);
        g(52, pattern.angle);
        g(41, pattern.scale);
        g(77, pattern.crossed ? 1 : 0);
        g(78, pattern.lines.length);

        for (const line of pattern.lines) {
          g(53, fifteenDigits(line.angle));
          g(43, fifteenDigits(line.base[0]));
          g(44, fifteenDigits(line.base[1]));
          g(45, fifteenDigits(line.offset[0]));
          g(46, fifteenDigits(line.offset[1]));
          g(79, line.dashes.length);

          for (const dash of line.dashes) g(49, fifteenDigits(dash));
        }
      }

      g(98, 1);
      g(10, 0);
      g(20, 0);
      const gradient = gradientWritten(e.gradient);

      if (gradient !== undefined) {
        g(450, 1);
        g(451, 0);
        g(460, fifteenDigits(gradient.angle));
        g(461, gradient.centered ? 0 : 1);
        g(452, gradient.single ? 1 : 0);
        g(462, gradient.tint);
        g(453, 2);
        gradient.colors.forEach((color, k) => {
          g(463, k);
          g(63, matchedIndex(color));
          g(421, rgbNumber(color));
        });
        g(470, GRADIENT_NAMES[gradient.name]);
      }

      return;
    }

    case "wipeout": {
      begin("WIPEOUT", "AcDbWipeout");
      g(90, 0); // the class's version
      const { corner, side } = wipeoutPicture(e.points);
      point(g, 10, ...corner);
      point(g, 11, side, 0);
      point(g, 12, 0, side);
      g(13, 1);
      g(23, 1);
      g(340, "0"); // no definition
      g(70, 7); // shown, shown when not square to the screen, clipped
      g(280, 1);
      g(281, 50);
      g(282, 50);
      g(283, 0);
      g(290, 0);
      g(360, "0");
      g(71, 2); // a polygon
      const clip = wipeoutClip(e.points);
      g(91, clip.length);

      for (const [x, y] of clip) {
        g(14, fifteenDigits(x));
        g(24, fifteenDigits(y));
      }

      return;
    }

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

/**
 * A text's mask, after the line spacing of its MTEXT: on and in the drawing's background, or in a
 * color index of its own, and the factor its box grows by.
 */
function writeMask(g: Group, mask: Mask | undefined): void {
  if (mask === undefined) return;
  g(90, mask.color === undefined ? 3 : 1);
  g(63, mask.color ?? 256);
  g(45, mask.offsetFactor);
  g(441, 0);
}

/** What a dimension style's `suppressZeros` is in `DIMZIN`, group 78. */
const ZERO_SUPPRESSION_CODES = { leading: 4, trailing: 8, both: 12 } as const;

/**
 * The fields of a dimension style. Every dimension of tsdraft's is drawn one way where a
 * style has no choice: the text above the dimension line and along it, always between the
 * extension lines, with a dimension line between them too, and in architectural units with
 * the fraction on the line.
 *
 * @param textStyle - The handle of the style's text style.
 */
function writeDimensionStyle(g: Group, style: DimensionStyle, textStyle: string): void {
  const prefix = style.prefix ?? "";
  const suffix = style.suffix ?? "";

  // The leading CAD app decodes this string once, as it does a linetype's description.
  if (prefix !== "" || suffix !== "") g(3, dxfOnce(`${prefix}<>${suffix}`));
  g(40, style.scale ?? 1); // DIMSCALE
  g(41, style.arrowSize); // DIMASZ
  g(42, style.extensionOffset); // DIMEXO
  g(44, style.extensionBeyond); // DIMEXE
  const arrowhead = style.arrowhead ?? DEFAULT_ARROWHEAD;
  const block = arrowheadInfo(arrowhead)?.block;

  // DIMDLE: with a tick, the dimension line runs past each extension line, one arrow size unless
  // the style says otherwise, as the leading CAD app draws it whenever it turns the ticks outward.
  if (block !== undefined) g(46, style.lineExtension ?? style.arrowSize);
  const mask = dimensionMask(style);

  if (mask !== undefined) {
    g(69, mask.color === undefined ? 1 : 2); // DIMTFILL: the background, or DIMTFILLCLR

    if (mask.color !== undefined) g(70, mask.color); // DIMTFILLCLR
  }

  g(73, 0); // DIMTIH: the text is along the dimension line
  g(74, 0); // DIMTOH
  g(77, style.textPlacement === "centered" ? 0 : 1); // DIMTAD: above the line, or in it
  const architectural = style.units === "architectural";
  g(
    78,
    architectural
      ? FEET_INCH_ZEROS_CODES[style.feetInchZeros ?? "inches"]
      : style.suppressZeros === undefined
        ? 0
        : ZERO_SUPPRESSION_CODES[style.suppressZeros],
  ); // DIMZIN
  const angleZeros = style.suppressAngleZeros;

  if (angleZeros !== undefined) g(79, ANGLE_ZERO_CODES[angleZeros]); // DIMAZIN
  const arcSymbol = style.arcSymbol ?? "before";

  if (arcSymbol !== "before") g(90, DIMENSION_ARC_SYMBOLS.indexOf(arcSymbol)); // DIMARCSYM
  g(140, style.textHeight); // DIMTXT
  g(144, style.measurementScale ?? 1); // DIMLFAC

  if (style.fractionScale !== undefined) g(146, style.fractionScale); // DIMTFAC
  g(147, style.textGap); // DIMGAP
  g(172, 1); // DIMTOFL: a dimension line between the extension lines, whatever fits
  const leader = style.textFit === "leader";
  // DIMTIX: the text between the extension lines whatever fits, or moved out where it does not.
  g(174, leader ? 0 : 1);

  if ((style.anglePrecision ?? 0) !== 0) g(179, style.anglePrecision!); // DIMADEC
  g(271, style.precision); // DIMDEC
  const angleUnits = style.angleUnits ?? "degrees";

  if (angleUnits !== "degrees") g(275, DIMENSION_ANGLE_UNITS.indexOf(angleUnits)); // DIMAUNIT

  // DIMFRAC: stacked across, stacked diagonally, or on the line, as 1 7/16.
  if (architectural) g(276, FRACTION_CODES[style.fraction ?? "inline"]);
  g(277, architectural ? 4 : 2); // DIMLUNIT: architectural or decimal
  g(278, 46); // DIMDSEP: a point

  if (leader) g(279, 1); // DIMTMOVE: a text moved out hangs on a leader
  g(340, textStyle); // DIMTXSTY

  if (block !== undefined) g(342, blockHandles(block).record); // DIMBLK

  if (style.dimensionLineweight !== undefined) g(371, Math.round(style.dimensionLineweight * 100)); // DIMLWD

  if (style.extensionLineweight !== undefined) g(372, Math.round(style.extensionLineweight * 100)); // DIMLWE
}

/** `DIMAZIN` for the zeros an angle leaves out. */
const ANGLE_ZERO_CODES = { leading: 1, trailing: 2, both: 3 } as const;

/** `DIMFRAC` for each way a style writes a fraction of an inch. */
const FRACTION_CODES = { stacked: 0, diagonal: 1, inline: 2 } as const;

/**
 * Writes a dimension. It names no block of its picture: the leading CAD app draws the picture when
 * it reads the file, from the dimension's points and its style.
 */
function writeDimension(
  g: Group,
  e: Dimension,
  style: DimensionStyle | undefined,
  handle: string,
  owner: string,
  paper: boolean,
  block: string | undefined,
  drawn: DimensionPicture | undefined,
): void {
  // `lint` refuses a dimension in a style the drawing does not have, which has no picture.
  const at = isRadial(e)
    ? e.center
    : e.kind === "linear-dimension"
      ? e.line
      : e.kind === "angular-dimension" || e.kind === "arc-length-dimension"
        ? e.at
        : e.kind === "ordinate-dimension"
          ? e.origin
          : e.to;

  const picture = drawn ?? { definitionPoint: at, textPoint: at };
  const jogged = e.kind === "jogged-radius-dimension";
  g(
    0,
    jogged
      ? "LARGE_RADIAL_DIMENSION"
      : e.kind === "arc-length-dimension"
        ? "ARC_DIMENSION"
        : "DIMENSION",
  );
  g(5, handle);
  g(330, owner);
  g(100, "AcDbEntity");

  if (paper) g(67, 1);
  g(8, e.layer);
  writeColor(g, e.color, e.transparency);
  g(100, "AcDbDimension");

  if (block !== undefined) g(2, block);
  point(g, 10, ...picture.definitionPoint);
  point(g, 11, ...picture.textPoint);
  // The kind, and 32: the dimension has a picture of its own; 64: an ordinate gives X; 128: its
  // text is where it was placed.
  const placed = "textFromCenter" in e && e.textFromCenter !== undefined ? 128 : 0;
  const alongX = e.kind === "ordinate-dimension" && e.axis === "x" ? 64 : 0;
  g(70, DIMENSION_TYPES[e.kind] + 32 + alongX + placed);
  const text = dimensionFileText(e);

  if (text !== undefined) g(1, dxfOnce(text));
  g(71, 5); // the text is placed by its middle

  // What it reads, with 15 digits: the leading CAD app works it out only when it draws the picture
  // itself, and keeps the picture the file holds.
  if (style) g(42, measurementValue(e, style));
  g(3, style?.name ?? e.style);

  if (e.kind === "arc-length-dimension") {
    // The arc's ends, its center, no part of it alone, its angles in radians, and no leader.
    const { center, first, second, start, sweep } = arcLengthArc(e);
    g(100, "AcDbArcDimension");
    point(g, 13, ...first);
    point(g, 14, ...second);
    point(g, 15, ...center);
    g(70, 0);
    g(40, fifteenDigits((start * Math.PI) / 180));
    g(41, fifteenDigits((((start + sweep) % 360) * Math.PI) / 180));
    g(71, 0);
    point(g, 16, ...first);
    point(g, 17, ...second);
    writeOverrides(g, radialOverrides(e, style));

    return;
  }

  if (e.kind === "ordinate-dimension") {
    g(100, "AcDbOrdinateDimension");
    point(g, 13, ...e.feature);
    point(g, 14, ...e.leaderEnd);
    writeOverrides(g, radialOverrides(e, style));

    return;
  }

  if (e.kind === "angular-dimension") {
    g(100, "AcDb3PointAngularDimension");
    point(g, 13, ...e.from);
    point(g, 14, ...e.to);
    point(g, 15, ...e.vertex);
    writeOverrides(g, radialOverrides(e, style));

    return;
  }

  if (isRadial(e)) {
    if (e.kind === "jogged-radius-dimension") {
      g(100, "AcDbRadialDimensionLarge");
      point(g, 13, ...e.start);
      point(g, 14, ...e.jog);
    } else {
      g(100, e.kind === "radius-dimension" ? "AcDbRadialDimension" : "AcDbDiametricDimension");
    }

    point(g, 15, ...e.point);
    g(40, 0); // no leader length: the text's place is group 11
    writeOverrides(g, radialOverrides(e, style));

    return;
  }

  g(100, "AcDbAlignedDimension");
  point(g, 13, ...e.from);
  point(g, 14, ...e.to);

  if (e.kind === "linear-dimension") {
    const angle = dimensionAngle(e);

    if (angle !== 0) g(50, angle);
    g(100, "AcDbRotatedDimension");
  }

  writeOverrides(g, radialOverrides(e, style));
}

/** A dimension's overrides of its style, as the extended data `ACAD`, `DSTYLE`. */
function writeOverrides(g: Group, overrides: readonly (readonly [number, number])[]): void {
  if (overrides.length === 0) return;
  g(1001, "ACAD");
  g(1000, "DSTYLE");
  g(1002, "{");

  for (const [code, value] of overrides) {
    g(1070, code);

    if (code === 50 || code === 40) g(1040, value);
    else g(1070, value);
  }

  g(1002, "}");
}

/**
 * The overrides a radial dimension holds of what its style sets of it alone, by the group each
 * has in a dimension style: DIMJOGANG (50) in radians, and DIMTIH (73) and DIMTOH (74) for a level
 * text. Another kind holds only its own scale.
 */
export function radialOverrides(
  e: Dimension,
  style: DimensionStyle | undefined,
): (readonly [code: number, value: number])[] {
  // A dimension's own scale, DIMSCALE (40), whatever its kind.
  const own: [number, number][] = e.scale === undefined ? [] : [[40, e.scale]];

  if (!isRadial(e) || style === undefined) return own;
  const out: [number, number][] = own;
  const jog = style.jogAngle;

  if (
    e.kind === "jogged-radius-dimension" &&
    jog !== undefined &&
    written(jog) !== JOG_ANGLE.default
  ) {
    out.push([50, (written(jog) * Math.PI) / 180]);
  }

  if (style.radialText === "horizontal") out.push([73, 1], [74, 1]);

  return out;
}

/** Group 70's kind of each dimension. */
const DIMENSION_TYPES = {
  "linear-dimension": 0,
  "aligned-dimension": 1,
  "diameter-dimension": 3,
  "radius-dimension": 4,
  "jogged-radius-dimension": 9,
  "angular-dimension": 5,
  "arc-length-dimension": 5,
  "ordinate-dimension": 6,
} as const;

/** The block of a dimension's picture, with what the writer needs for it. */
interface Picture {
  /** The block's name, `*D` and a number. */
  readonly name: string;
  readonly picture: DimensionPicture;
  readonly handles: DimensionPictureHandles;
  /** The dimension's layer, which everything in the block is on. */
  readonly layer: string;
  readonly textStyle: string;
  /** The mask behind each of its texts, from its style. */
  readonly mask: Mask | undefined;
}

/** The most characters of a text DXF holds in one group. */
const TEXT_CHUNK = 250;

/**
 * Writes the block of a dimension's picture as the leading CAD app writes one: the two extension
 * lines, the dimension line, the arrowheads and the text, on the dimension's layer, in the color
 * and lineweight of the dimension. It holds no definition points: they do not plot, and that app
 * works them out again when it draws the dimension anew.
 */
function writePicture(g: Group, { name, picture, handles, layer, textStyle, mask }: Picture): void {
  const owner = handles.record;
  writeBlock(g, handles.begin, handles.end, name, owner, {
    paper: false,
    anonymous: true,
    contents: () => {
      const weights = picture.lineweights;

      const begin = (type: string, handle: string, subclass: string, lineweight?: number) => {
        g(0, type);
        g(5, handle);
        g(330, owner);
        g(100, "AcDbEntity");
        g(8, layer);
        g(62, 0); // by block
        g(440, 0x01000000); // transparent by block, as the leading CAD app saves a picture

        if (lineweight !== undefined) g(370, lineweight);
        g(100, subclass);
      };

      const lines: (readonly [
        readonly [number, number],
        readonly [number, number],
        string,
        number,
      ])[] = [
        // An ordinate's jogged leader, which has no dimension line, takes its handle for its third
        // line.
        ...picture.extensionLines.map(
          ([from, to], i) =>
            [
              from,
              to,
              [...handles.extensionLines, handles.dimensionLine][i]!,
              weights.extension,
            ] as const,
        ),
        ...picture.dimensionLines.map(
          ([from, to], i) => [from, to, handles.dimensionLines[i]!, weights.dimension] as const,
        ),
        ...picture.leader.map(
          ([from, to], i) => [from, to, handles.leader[i]!, weights.dimension] as const,
        ),
      ];

      for (const [from, to, handle, lineweight] of lines) {
        begin("LINE", handle, "AcDbLine", lineweight);
        point(g, 10, ...from);
        point(g, 11, ...to);
      }

      picture.dimensionArcs.forEach((arc, i) => {
        begin("ARC", handles.dimensionArcs[i]!, "AcDbCircle", weights.dimension);
        point(g, 10, ...arc.center);
        g(40, arc.radius);
        g(100, "AcDbArc");
        g(50, writtenAngle(arc.start));
        g(51, writtenAngle(arc.end));
      });
      picture.arrowheadEntities.forEach((arrowhead, i) => {
        const handle = handles.arrowheads[i]!;

        if (arrowhead.kind === "solid") {
          begin("SOLID", handle, "AcDbTrace");
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

        begin("INSERT", handle, "AcDbBlockReference", weights.dimension);
        g(2, arrowhead.block);
        point(g, 10, ...arrowhead.at);

        for (const code of [41, 42, 43]) g(code, arrowhead.scale);

        if (written(arrowhead.rotation) !== 0) g(50, arrowhead.rotation);
      });

      const text = (label: DimensionLabel, middle: Point, handle: string, value: string) => {
        begin("MTEXT", handle, "AcDbMText");
        point(g, 10, ...middle);
        g(40, label.height);
        g(41, 0); // no width to wrap at
        g(46, 0);
        g(71, 5); // placed by its middle
        g(72, 1); // left to right
        writeMtextValue(g, value);
        g(7, textStyle);

        if (written(label.rotation) !== 0) {
          // 15 digits of the direction: 6 decimals would turn the text off the leading CAD app's own.
          g(11, fifteenDigits(label.direction[0]));
          g(21, fifteenDigits(label.direction[1]));
          g(31, 0);
        }

        g(73, 1); // line spacing at least as set
        g(44, 1);
        writeMask(g, mask);
      };

      text(picture.label, picture.textMiddle, handles.text, mtextOfLabel(picture.label.value));

      if (picture.below) {
        const { label, middle } = picture.below;
        text(label, middle, handles.belowText, label.value === "" ? "" : mtextOfLabel(label.value));
      }
    },
  });
}

/**
 * Writes the value of an MTEXT, which the leading CAD app decodes once: in groups 3 of
 * `TEXT_CHUNK` characters, and the rest in group 1, with a tab as `^I`.
 */
function writeMtextValue(g: Group, value: string): void {
  const text = dxfOnce(value).replaceAll("\t", "^I");
  let at = 0;

  while (text.length - at > TEXT_CHUNK) {
    // A caret and what it escapes stay in one group.
    const end = text[at + TEXT_CHUNK - 1] === "^" ? at + TEXT_CHUNK - 1 : at + TEXT_CHUNK;
    g(3, text.slice(at, end));
    at = end;
  }

  g(1, text.slice(at));
}

/** What a dimension reads, as the DXF writes it: the length times the style's measurement scale. */
function measurementValue(dimension: Dimension, style: DimensionStyle): string {
  // An angle, in radians, takes no measurement scale.
  const scale = dimension.kind === "angular-dimension" ? 1 : written(style.measurementScale ?? 1);

  return fifteenDigits(dimensionMeasure(dimension).measurement * scale);
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

/** The leading CAD app holds the extents of a space with nothing in it as these, the wrong way round. */
const EMPTY_EXTENT = 1e20;

/**
 * The limits of a layout, `[minX, minY, maxX, maxY]` in paper units: the part of the sheet
 * that prints, worked out as the leading CAD app does from the sizes its
 * page setup holds in millimetres.
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
 * viewports. A layout that holds nothing has the extents the leading CAD app gives an empty one.
 */
function sheetExtents(
  sheet: Sheet,
  drawing: Drawing,
  boxOf: Boxer,
): [number, number, number, number] {
  const { layout, paper } = sheet;

  if (layout.entities.length === 0 && layout.viewports.length === 0) {
    return [EMPTY_EXTENT, EMPTY_EXTENT, -EMPTY_EXTENT, -EMPTY_EXTENT];
  }

  const box =
    layout.entities.length > 0
      ? extentsOf(layout.entities, boxOf, `layout ${shown(layout.name)}`)
      : [Infinity, Infinity, -Infinity, -Infinity];

  for (const viewport of layout.viewports) {
    const view = validViewportView(viewport, paper.units, drawing.units);
    box[0] = Math.min(box[0]!, view.paperCenter[0] - view.width / 2);
    box[1] = Math.min(box[1]!, view.paperCenter[1] - view.height / 2);
    box[2] = Math.max(box[2]!, view.paperCenter[0] + view.width / 2);
    box[3] = Math.max(box[3]!, view.paperCenter[1] + view.height / 2);
  }

  return [readable(box[0]!), readable(box[1]!), readable(box[2]!), readable(box[3]!)];
}

/**
 * The extents of some entities of a drawing, with its styles and its blocks.
 *
 * @throws DrawingError with a `check-capped` warning when the drawing repeats more than the
 *   extents work out.
 */
function extentsOf(
  entities: readonly Entity[],
  boxOf: Boxer,
  space: string,
): [number, number, number, number] {
  const box = boxOf(entities);
  const at = boxOf.capped;

  if (at) {
    const where = `${at.kind} #${entities.indexOf(at)} of ${space}`;
    throw new DrawingError([
      {
        rule: "check-capped",
        severity: "warning",
        message: `toDXF stopped working out the extents at ${where}; the drawing repeats more than they look through, so toDXF refuses it`,
      },
    ]);
  }

  return box ?? [0, 0, 1, 1];
}

/** Keeps the handle of a layer by its key, the first of a key, and gives it back. */
function layerHandleOf(handles: Map<string, string>, name: string, given: string): string {
  if (!handles.has(layerKey(name))) handles.set(layerKey(name), given);

  return given;
}

/** The handle of each layer a viewport freezes, once each, in the order it names them. */
function frozenHandles(viewport: Viewport, layerHandles: ReadonlyMap<string, string>): string[] {
  const frozen = new Set<string>();

  for (const name of viewport.frozenLayers ?? []) frozen.add(layerHandles.get(layerKey(name))!);

  return [...frozen];
}

/**
 * The fields of a viewport that say how its view is drawn: its height, its twist, the layers it
 * freezes by their handles, and its status. The others are the same in every viewport.
 */
function writeViewFields(
  g: Group,
  viewHeight: number,
  status: number,
  twist = 0,
  frozen: readonly string[] = [],
): void {
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
  g(51, twist); // view twist, in degrees counterclockwise
  g(72, 1000); // circle zoom percent

  for (const layer of frozen) g(331, layer);
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

/** In group 90: a bit the leading CAD app sets on every viewport, with the UCS icon's two bits. */
const VIEW_STATUS = 0x8000 | 0x40 | 0x20;

/**
 * The viewport the leading CAD app keeps for the sheet as a whole, which is the first of every
 * layout and has the number 1. Its view is the sheet with a margin, so
 * the layout opens on its paper.
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
  frozen: readonly string[],
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
  // The view's middle in its own coordinates, which turn with its twist about the target, 0.
  g(12, view.displayCenter[0]);
  g(22, view.displayCenter[1]);
  writeViewFields(g, view.viewHeight, VIEW_STATUS | VIEW_LOCKED, view.twist, frozen);
}

/** In a page setup's flags, group 70. */
const PLOT_USE_STANDARD_SCALE = 16;
const PLOT_PLOT_STYLES = 32;
const PLOT_LINEWEIGHTS = 128;
const PLOT_VIEWPORTS_FIRST = 512;
const PLOT_MODEL_TYPE = 1024;
const PLOT_INITIALIZING = 8192;

/**
 * The layout of the model tab. Its page setup names no plotter, so the leading CAD app marks it as
 * one still to be set up, and plots model space with the settings a drafter gives it.
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

/** A class of the drawing's objects, by the name a DXF gives its objects. */
function writeClass(
  g: Group,
  dxfName: string,
  cppName: string,
  appName: string,
  proxyFlags: number,
  of: { readonly count: number; readonly entity: boolean },
): void {
  g(0, "CLASS");
  g(1, dxfName);
  g(2, cppName);
  g(3, appName);
  g(90, proxyFlags);
  g(91, of.count); // how many objects of the class the drawing holds
  g(280, 0); // not a proxy
  g(281, of.entity ? 1 : 0);
}

/** Where an image's IMAGE goes, and what it points to. */
interface ImagePlace {
  readonly handle: string;
  readonly owner: string;
  readonly paper: boolean;
  readonly definition: string;
  readonly reactor: string;
}

/**
 * An IMAGE: its corner, the vectors of one pixel and its pixels, its definition, shown and
 * clipped, transparent when asked, brightness 50, contrast 50 and fade 0, and its clip in pixels.
 * The vectors and the clip are written with 15 digits, which a pixel of a large file needs.
 */
function writeImage(g: Group, e: Image, place: ImagePlace): void {
  g(0, "IMAGE");
  g(5, place.handle);
  g(330, place.owner);
  g(100, "AcDbEntity");

  if (place.paper) g(67, 1);
  g(8, e.layer);
  const linetype = entityLinetype(e);

  if (linetype !== undefined) g(6, linetype);
  writeColor(g, e.color, e.transparency);

  if (e.lineweight !== undefined && e.lineweight !== "ByLayer") {
    g(370, lineweightCode(e.lineweight));
  }

  g(100, "AcDbRasterImage");
  g(90, 0); // the class's version
  point(g, 10, ...e.at);
  const [u, v] = imageVectors(e);

  for (const [code, [x, y]] of [
    [11, u],
    [12, v],
  ] as const) {
    g(code, fifteenDigits(x));
    g(code + 10, fifteenDigits(y));
    g(code + 20, 0);
  }

  g(13, e.pixels[0]);
  g(23, e.pixels[1]);
  g(340, place.definition);
  // Shown, shown when not square to the screen, clipped by its boundary, and transparent.
  g(70, 7 | (e.transparent ? 8 : 0));
  g(280, e.clip === undefined ? 0 : 1);
  g(281, 50);
  g(282, 50);
  g(283, 0);
  g(290, e.invertClip ? 1 : 0);
  g(360, place.reactor);
  const clip = imageClip(e);
  g(71, clip.type);
  g(91, clip.points.length);

  for (const [x, y] of clip.points) {
    g(14, fifteenDigits(x));
    g(24, fifteenDigits(y));
  }
}

/**
 * The objects of a drawing's images: the dictionary of their definitions, each definition with
 * the reactors of the images of it, each reactor, and RASTERVARIABLES, which says whether a frame
 * shows.
 */
function writeImageObjects(
  g: Group,
  definitions: readonly ImageDefinition[],
  reactors: readonly { readonly image: string; readonly reactor: string; readonly of: string }[],
  root: string,
  drawing: Drawing,
): void {
  const dictionary = imageDictionaryHandle();
  g(0, "DICTIONARY");
  ownedBy(g, dictionary, root);
  g(100, "AcDbDictionary");
  g(281, 1);

  // In the order the leading CAD app saves them: by the name folded to lower case as it folds
  // names, a character's code at a time.
  const sorted = definitions
    .map((definition) => ({ definition, key: layerKey(definition.name) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ definition }) => definition);

  // Each definition's reactors, by its handle, which is short.
  const reactorsOf = new Map<string, string[]>();

  for (const { reactor, of } of reactors) {
    const list = reactorsOf.get(of);

    if (list) list.push(reactor);
    else reactorsOf.set(of, [reactor]);
  }

  for (const definition of sorted) {
    g(3, dxfOnce(definition.name));
    g(350, definition.handle);
  }

  for (const definition of definitions) {
    g(0, "IMAGEDEF");
    g(5, definition.handle);
    g(102, "{ACAD_REACTORS");
    g(330, dictionary);

    for (const reactor of reactorsOf.get(definition.handle) ?? []) g(330, reactor);
    g(102, "}");
    g(330, dictionary);
    g(100, "AcDbRasterImageDef");
    g(90, 0);
    g(1, dxfOnce(writtenImagePath(definition.path)));
    g(10, definition.pixels[0]);
    g(20, definition.pixels[1]);
    // The size of one pixel, as the leading CAD app gives a file of no resolution: a whole image
    // one unit wide.
    g(11, fifteenDigits(1 / definition.pixels[0]));
    g(21, fifteenDigits(1 / definition.pixels[0]));
    g(280, 1); // loaded
    g(281, 0); // no unit of resolution
  }

  for (const { image, reactor } of reactors) {
    g(0, "IMAGEDEF_REACTOR");
    g(5, reactor);
    g(330, image);
    g(100, "AcDbRasterImageDefReactor");
    g(90, 2);
    g(330, image);
  }

  g(0, "RASTERVARIABLES");
  ownedBy(g, rasterVariablesHandle(), root);
  g(100, "AcDbRasterVariables");
  g(90, 0);
  g(70, drawing.imageFrame === false ? 0 : 1);
  g(71, 1); // high quality
  g(72, isUnits(drawing.units) ? RASTER_UNITS[drawing.units] : RASTER_UNITS.in);
}

/**
 * The objects of a drawing's wipeouts: WIPEOUTVARIABLES, and the variable `WIPEOUTFRAME` in the
 * dictionary of the drawing's variables, which is what the leading CAD app reads of whether their
 * frames show.
 */
function writeWipeoutObjects(g: Group, root: string, drawing: Drawing): void {
  g(0, "WIPEOUTVARIABLES");
  ownedBy(g, wipeoutVariablesHandle(), root);
  g(100, "AcDbWipeoutVariables");
  g(70, drawing.wipeoutFrame === false ? 0 : 1);
}

/**
 * The dictionary of the drawing's variables and each variable in it, by name in the order of
 * their names: `PDFFRAME` and `WIPEOUTFRAME`, which is what the leading CAD app reads of whether
 * the frames of underlays and wipeouts show.
 */
function writeVariables(g: Group, root: string, values: Readonly<Record<string, number>>): void {
  const variables = variableDictionaryHandle();

  const handles = new Map([
    ["PDFFRAME", underlayFrameVariableHandle()],
    ["WIPEOUTFRAME", wipeoutFrameVariableHandle()],
  ]);

  const names = Object.keys(values).sort();
  g(0, "DICTIONARY");
  ownedBy(g, variables, root);
  g(100, "AcDbDictionary");
  g(281, 1);

  for (const name of names) {
    g(3, name);
    g(350, handles.get(name)!);
  }

  for (const name of names) {
    g(0, "DICTIONARYVAR");
    ownedBy(g, handles.get(name)!, variables);
    g(100, "DictionaryVariables");
    g(280, 0);
    g(1, String(values[name]));
  }
}

/** Where an underlay's PDFUNDERLAY goes, and what it points to. */
interface UnderlayPlace {
  readonly handle: string;
  readonly owner: string;
  readonly paper: boolean;
  readonly definition: string;
}

/**
 * A PDFUNDERLAY, as the leading CAD app saves one: its corner, its scale both ways, its turn when
 * it has one, its flags, contrast and fade, and its clip in the page's inches.
 */
function writeUnderlay(g: Group, e: Underlay, place: UnderlayPlace): void {
  g(0, "PDFUNDERLAY");
  g(5, place.handle);
  g(330, place.owner);
  g(100, "AcDbEntity");

  if (place.paper) g(67, 1);
  g(8, e.layer);
  const linetype = entityLinetype(e);

  if (linetype !== undefined) g(6, linetype);

  if (e.lineweight !== undefined && e.lineweight !== "ByLayer") {
    g(370, lineweightCode(e.lineweight));
  }

  g(100, "AcDbUnderlayReference");
  g(340, place.definition);
  point(g, 10, ...e.at);
  // The leading CAD app leaves out a scale of 1 and no turn.
  const scale = written(e.scale ?? 1);

  if (scale !== 1) {
    g(41, scale);
    g(42, scale);
  }

  const turn = writtenAngle((((e.rotation ?? 0) % 360) + 360) % 360);

  if (turn !== 0) g(50, turn);
  g(280, underlayFlags(e));
  // Written whatever their values: the leading CAD app saves no contrast of 75 and no fade of 25,
  // but reads a file without them as other values.
  g(281, e.contrast ?? 100);
  g(282, e.fade ?? 0);

  for (const [x, y] of underlayClip(e)) {
    g(11, fifteenDigits(x));
    g(21, fifteenDigits(y));
  }
}

/**
 * The objects of a drawing's underlays: the dictionary of their pages' definitions, and each
 * definition with the underlays of it among its reactors.
 */
function writeUnderlayObjects(
  g: Group,
  definitions: readonly UnderlayDefinition[],
  users: ReadonlyMap<string, readonly string[]>,
  root: string,
): void {
  const dictionary = underlayDictionaryHandle();
  g(0, "DICTIONARY");
  ownedBy(g, dictionary, root);
  g(100, "AcDbDictionary");
  g(281, 1);

  const sorted = definitions
    .map((definition) => ({ definition, key: layerKey(definition.name) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ definition }) => definition);

  for (const definition of sorted) {
    g(3, dxfOnce(definition.name));
    g(350, definition.handle);
  }

  for (const definition of definitions) {
    g(0, "PDFDEFINITION");
    g(5, definition.handle);
    g(102, "{ACAD_REACTORS");
    g(330, dictionary);

    for (const user of users.get(definition.handle) ?? []) g(330, user);
    g(102, "}");
    g(330, dictionary);
    g(100, "AcDbUnderlayDefinition");
    g(1, dxfOnce(definition.path.replaceAll("/", "\\")));
    g(2, definition.page);
  }
}

/** A color the leading CAD app holds as ByLayer and as ByBlock, as a multileader and its style write one. */
const COLOR_BY_LAYER = -1073741824;
const COLOR_BY_BLOCK = -1056964608;

/** The lineweight ByBlock, as a multileader and its style write it. */
const LINEWEIGHT_BY_BLOCK = -2;

/**
 * A leader style, with its sizes times its scale and a scale of 1. Its shafts, its text and its
 * block are ByBlock, so a leader draws in its own color, linetype and lineweight, which are its
 * layer's. The note's lines are spaced at least as the paragraph layout sets them, and the text
 * is level.
 *
 * @param textStyle - The handle of the style's text style.
 * @param linetype - The handle of the linetype ByBlock.
 * @param content - The block the style holds in place of a note, as the drawing names it.
 */
function writeLeaderStyle(
  g: Group,
  style: LeaderStyle,
  dictionary: string,
  textStyle: string,
  linetype: string,
  content: string | undefined,
): void {
  const sizes = leaderSizes({}, style);
  const scale = written(style.scale ?? 1);
  const attachment = attachmentCode(leaderAttachment({}, style));
  const vertical = verticalAttachmentCode(leaderVerticalAttachment({}, style));
  const block = leaderArrowheadInfo(style.arrowhead ?? DEFAULT_LEADER_ARROWHEAD)?.block;
  g(0, "MLEADERSTYLE");
  ownedBy(g, validLeaderStyleHandle(style.name), dictionary);
  g(100, "AcDbMLeaderStyle");
  g(179, 2); // version
  g(170, content === undefined ? 2 : 1); // content: a text, or a block
  g(171, 1); // the leader is drawn first
  g(172, 0); // and from its arrowhead
  g(90, 2); // the points MLEADER asks for
  g(40, 0); // angles MLEADER keeps the segments to: none
  g(41, 0);
  g(173, style.shaft === "curved" ? 2 : 1); // straight shafts, or curves
  g(91, COLOR_BY_BLOCK);
  g(340, linetype);
  g(92, LINEWEIGHT_BY_BLOCK);
  g(290, 1); // a landing
  g(42, sizes.gap);
  g(291, 1); // of a set length
  g(43, sizes.landing);
  g(3, ""); // description

  // The closed filled arrowhead is the leading CAD app's default, which the style names by no block.
  if (block !== undefined) g(341, blockHandles(block).record);
  g(44, sizes.arrowSize);
  g(300, ""); // the default text
  g(342, textStyle);
  g(174, attachment); // where the landing meets a note on its right
  g(178, attachment); // and on its left
  g(175, 1); // level text
  g(176, 0); // text aligned as its attachment puts it
  g(93, COLOR_BY_BLOCK);
  g(45, sizes.textHeight);
  g(292, style.frame === true ? 1 : 0);
  g(297, 0); // a note on the left is justified right
  g(46, 0.18 * scale); // the spacing MLEADERALIGN offers, as the leading CAD app's Standard style has it

  // The block as the drawing names it, whose record's handle comes from that name.
  if (content !== undefined) g(343, blockHandles(content).record);
  g(94, COLOR_BY_BLOCK);
  const blockScale = written(style.blockScale ?? 1);
  g(47, blockScale); // the block's scale
  g(49, blockScale);
  g(140, blockScale);
  g(293, 1);
  g(141, 0); // the block's rotation
  g(294, 1);
  g(177, style.blockConnection === "insertion" ? 1 : 0); // by its extents, or its insertion point
  g(142, 1); // scale
  g(295, 0);
  g(296, 0); // not annotative
  g(143, 0.125 * scale); // the size of a break DIMBREAK makes, as the leading CAD app's Standard style has it
  g(271, style.direction === "vertical" ? 1 : 0);
  g(272, vertical);
  g(273, vertical);
  g(298, 0);
}

/**
 * A leader: a multileader whose note is a text of lines that do not wrap, with one leader root,
 * a leader line for each shaft and the numbers `leaderPicture` works out. It is held to the
 * sizes it is drawn with, at a scale of 1, and names its style and every property it sets
 * itself, in place of its style's.
 */
function writeLeader(
  g: Group,
  e: Leader,
  style: LeaderStyle,
  where: {
    readonly handle: string;
    readonly owner: string;
    readonly paper: boolean;
    /** The block of the drawing of a name, for a block in place of the note. */
    readonly findBlock: (name: string) => Block | undefined;
    /** The text style of its note, unless it is `Standard`, and its handle. */
    readonly textStyle: TextStyle | undefined;
    readonly textStyleHandle: string;
    /** The handle of the linetype ByBlock. */
    readonly linetype: string;
  },
): void {
  const picture = leaderPicture(e, style, where.textStyle, where.findBlock);
  const { sizes } = picture;
  const content = picture.block;
  const byInsertion = style.blockConnection === "insertion" ? 1 : 0;
  const attachment = attachmentCode(picture.attachment);
  const vertical = verticalAttachmentCode(picture.verticalAttachment);
  const left = picture.side === "left";
  // A block in place of the note keeps a note's default alignment.
  const align = content !== undefined ? 0 : picture.noteAttachment === 2 ? 1 : left ? 2 : 0;
  const block = leaderArrowheadInfo(style.arrowhead ?? DEFAULT_LEADER_ARROWHEAD)?.block;
  const mask = picture.mask;
  const maskColor = mask?.color;
  g(0, "MULTILEADER");
  g(5, where.handle);
  g(330, where.owner);
  g(100, "AcDbEntity");

  if (where.paper) g(67, 1);
  g(8, e.layer);
  writeColor(g, e.color, e.transparency);
  g(100, "AcDbMLeader");
  g(270, 2); // version
  g(300, "CONTEXT_DATA{");
  g(40, 1); // scale
  point3(g, 10, ...picture.contentBase, 0);
  g(41, sizes.textHeight);
  g(140, sizes.arrowSize);
  g(145, sizes.gap);
  g(174, attachment);
  g(175, attachment);
  g(176, align); // justified left, centered or right
  g(177, content === undefined ? 0 : byInsertion);

  if (content !== undefined) {
    // A block in place of the note, where it is placed, and the matrix that places it.
    const scale = content.scale?.[0] ?? 1;
    g(290, 0);
    g(296, 1);
    g(341, blockHandles(content.block).record);
    point3(g, 14, 0, 0, 1);
    point3(g, 15, ...content.at, 0);
    point3(g, 16, scale, scale, scale);
    g(46, 0);
    g(93, COLOR_BY_LAYER);

    for (const value of [
      scale,
      0,
      0,
      content.at[0],
      0,
      scale,
      0,
      content.at[1],
      0,
      0,
      scale,
      0,
      0,
      0,
      0,
      1,
    ]) {
      g(47, value);
    }
  }

  if (content === undefined) {
    g(290, 1); // the content is a text
    g(304, dxfOnce(picture.note.value));
    point3(g, 11, 0, 0, 1); // the text's normal
    g(340, where.textStyleHandle);
    point3(g, 12, ...picture.location, 0);
    point3(g, 13, 1, 0, 0); // along the text
    g(42, 0); // rotation
    g(43, picture.note.width ?? 0); // the width it wraps at
    g(44, 0);
    g(45, 1); // line spacing
    g(170, 1); // at least as set
    g(90, heldColor(e.color)); // the note's color, the leader's own
    g(171, picture.noteAttachment); // held by its top left, top center or top right
    g(172, 5); // flow
    // A mask in the drawing's background, or in a color of its own.
    g(91, maskColor === undefined || maskColor === 256 ? COLOR_BY_LAYER : aciColor(maskColor));
    g(141, mask?.factor ?? 0);
    g(92, 0);
    g(291, mask !== undefined && maskColor === undefined ? 1 : 0);
    g(292, mask === undefined ? 0 : 1);
    g(173, 0); // no columns
    g(293, 0);
    g(142, 0);
    g(143, 0);
    g(294, 0);
    g(295, 0);
    g(296, 0); // no block
  }

  // The plane the leader is drawn in, from the first tip, as the leading CAD app's MLEADER sets it.
  const tip = e.shafts[0]![0]!;
  point3(g, 110, tip[0], tip[1], 0);
  point3(g, 111, 1, 0, 0);
  point3(g, 112, 0, 1, 0);
  g(297, 0);
  g(302, "LEADER{");
  g(290, 1);
  g(291, 1);
  point3(g, 10, ...picture.connection, 0);
  point3(g, 11, picture.direction, 0, 0);
  g(90, 0); // the root's index
  g(40, sizes.landing);
  e.shafts.forEach((shaft, i) => {
    g(304, "LEADER_LINE{");

    for (const [x, y] of shaft) point3(g, 10, x, y, 0);
    g(91, i);
    g(305, "}");
  });
  g(271, picture.vertical ? 1 : 0); // the landing meets the note at its side, or its top or bottom
  g(303, "}");

  // A second root on the note's far side, its lines numbered on from the first root's.
  if (picture.farConnection !== undefined) {
    g(302, "LEADER{");
    g(290, 1);
    g(291, 1);
    point3(g, 10, ...picture.farConnection, 0);
    point3(g, 11, picture.farDirection ?? -picture.direction, 0, 0);
    g(90, 1); // the root's index
    g(40, sizes.landing);
    (e.farShafts ?? []).forEach((shaft, j) => {
      g(304, "LEADER_LINE{");

      for (const [x, y] of shaft) point3(g, 10, x, y, 0);
      g(91, e.shafts.length + j);
      g(305, "}");
    });
    g(271, picture.vertical ? 1 : 0);
    g(303, "}");
  }

  g(272, vertical);
  g(273, vertical);
  g(301, "}");
  g(340, validLeaderStyleHandle(style.name));
  g(90, leaderOwnFlags(e, style));
  g(170, picture.curved ? 2 : 1); // straight shafts, or curves
  g(91, COLOR_BY_BLOCK);
  g(341, where.linetype);
  g(171, LINEWEIGHT_BY_BLOCK);
  g(290, 1);
  g(291, 1);
  g(41, sizes.landing);

  if (block !== undefined) g(342, blockHandles(block).record);
  g(42, sizes.arrowSize);
  g(172, content === undefined ? 2 : 1); // content: a text, or a block
  g(343, where.textStyleHandle);
  g(173, attachment);
  g(95, attachment);
  g(174, 1); // level text
  g(175, content === undefined && left ? 2 : 0);
  g(92, COLOR_BY_BLOCK);
  g(292, picture.frame === undefined ? 0 : 1);

  if (content !== undefined) g(344, blockHandles(content.block).record);
  g(93, COLOR_BY_BLOCK);
  point3(g, 10, 1, 1, 1); // the block's scale
  g(43, 0);
  g(176, content === undefined ? 0 : byInsertion);
  g(293, 0); // not annotative

  // Each attribute of a block in place of the note, by its definition, and its value.
  if (content !== undefined) {
    const block = where.findBlock(content.block);
    (block?.attributes ?? []).forEach((definition, i) => {
      g(330, definitionHandle(block!.name, definition.tag));
      g(177, i + 1);
      g(44, 0);
      g(302, dxfText(content.attributes?.[definition.tag] ?? definition.value));
    });
  }

  g(294, 0);
  g(178, 0);
  g(179, content === undefined ? noteAttachmentPoint(picture.side, e.width !== undefined) : 1);
  g(45, 1); // scale
  g(271, picture.vertical ? 1 : 0);
  g(272, vertical);
  g(273, vertical);
  g(295, 0);
}

/** A color index as a multileader holds it: the index in the low byte of a color by index. */
function aciColor(index: number): number {
  return 0xc3000000 | index | 0;
}

/** One entity of the block of a leader's arrowhead, on layer `0` and ByBlock. */
function writeArrowheadStroke(
  g: Group,
  stroke: LeaderArrowheadStroke,
  handle: string,
  owner: string,
): void {
  g(0, stroke.kind === "line" ? "LINE" : "LWPOLYLINE");
  g(5, handle);
  g(330, owner);
  g(100, "AcDbEntity");
  g(8, "0");
  g(6, "ByBlock");
  g(62, 0);

  if (stroke.kind === "line") {
    g(370, LINEWEIGHT_BY_BLOCK);
    g(100, "AcDbLine");
    point(g, 10, ...stroke.from);
    point(g, 11, ...stroke.to);

    return;
  }

  g(100, "AcDbPolyline");
  g(90, stroke.points.length);
  g(70, 1); // closed
  g(43, stroke.width);
  stroke.points.forEach(([x, y], i) => {
    g(10, x);
    g(20, y);
    g(42, stroke.bulges[i]!);
  });
}

/** Group 170's code of each place in a cell: 1 to 3 along the top, 4 to 6 the middle, 7 to 9 the bottom. */
function cellAlignment(align: ParagraphAlign, valign: ParagraphVerticalAlign): number {
  return paragraphAttachment({ align, valign });
}

/** Writes a table style as the leading CAD app saves one: its margins, then a cell style for each kind of row. */
function writeTableStyle(
  g: Group,
  style: TableStyle,
  handle: string,
  owner: string,
  tables: readonly string[],
): void {
  g(0, "TABLESTYLE");
  g(5, handle);
  g(102, "{ACAD_REACTORS");
  g(330, owner);

  for (const table of tables) g(330, table);
  g(102, "}");
  g(330, owner);
  g(100, "AcDbTableStyle");
  g(280, 0); // the version of its data
  g(3, dxfOnce(style.name));
  g(70, 0); // its rows run down
  g(71, 0);
  const [horizontal, vertical] = tableMargins(style);
  g(40, horizontal);
  g(41, vertical);
  g(280, 0); // its title is shown
  g(281, 0); // its header is shown

  for (const kind of TABLE_ROW_KINDS) {
    const cell = cellStyleOf(style, kind);
    g(7, dxfOnce(cell.textStyle ?? STANDARD_TEXT_STYLE));
    g(140, cell.textHeight);
    g(170, cellAlignment(cell.align, cell.valign));
    g(62, cell.color ?? 0); // by block
    g(63, cell.fill ?? 7);
    g(283, cell.fill === undefined ? 0 : 1);
    g(90, 512); // its data are of no one kind
    g(91, 0);
    g(1, "");
    const weight = cell.lineweight === undefined ? -2 : lineweightCode(cell.lineweight);

    // Each of its six borders: its lineweight, whether it shows and its color.
    for (let border = 0; border < 6; border++) {
      g(274 + border, weight);
      g(284 + border, 1);
      g(64 + border, 0);
    }
  }
}

/** A table's picture and what the writer needs to write it. */
interface TableBlockHeld {
  /** The block's name, `*T` and a number. */
  readonly name: string;
  readonly picture: TablePicture;
  readonly place: TablePlace;
  readonly style: TableStyle;
  readonly layer: string;
  /** The table's rotation, which the block holds its picture turned by. */
  readonly rotation: number | undefined;
}

/** Writes the block of a table's picture: its fills, its lines, then each cell's text and block. */
function writeTablePicture(
  g: Group,
  { name, picture, place, layer, rotation }: TableBlockHeld,
  styleOf: (name: string | undefined) => TextStyle | undefined,
  blockName: (name: string) => string | undefined,
): void {
  const record = tablePictureHandle(place, "record");
  writeBlock(
    g,
    tablePictureHandle(place, "begin"),
    tablePictureHandle(place, "end"),
    name,
    record,
    {
      paper: false,
      anonymous: true,
      contents: () => {
        const begin = (
          type: string,
          part: string,
          subclass: string,
          o: { readonly lineweight?: number; readonly color?: number | undefined } = {},
        ) => {
          g(0, type);
          g(5, tablePictureHandle(place, part));
          g(330, record);
          g(100, "AcDbEntity");
          g(8, layer);
          g(6, "ByBlock");
          g(62, o.color ?? 0);

          if (o.lineweight !== undefined) g(370, o.lineweight);
          g(100, subclass);
        };

        // The block holds the picture turned as the table is, and its insert is not turned.
        const [cos, sin] = paragraphDirection(rotation);

        const turned = (x: number, y: number): [number, number] =>
          cos === 1 && sin === 0 ? [x, y] : [x * cos - y * sin, x * sin + y * cos];

        const at = (code: number, x: number, y: number) => point(g, code, ...turned(x, y));

        for (const fill of picture.fills) {
          const [x0, y0, x1, y1] = fill.box;
          begin("SOLID", `fill-${fill.row}-${fill.column}`, "AcDbTrace", { color: fill.color });
          // Its corners as the leading CAD app holds them: the left side down, then the right.
          at(10, x0, y1);
          at(11, x0, y0);
          at(12, x1, y1);
          at(13, x1, y0);
        }

        picture.lines.forEach((line, i) => {
          begin("LINE", `line-${i}`, "AcDbLine", {
            lineweight: line.lineweight === undefined ? -2 : lineweightCode(line.lineweight),
          });
          at(10, ...line.from);
          at(11, ...line.to);
        });

        for (const text of picture.texts) {
          begin("MTEXT", `text-${text.row}-${text.column}`, "AcDbMText", { color: text.color });
          at(10, ...text.at);
          g(40, text.height);
          g(41, text.width);
          g(46, 0);
          g(71, paragraphAttachment(text));
          g(72, 1);
          writeMtextValue(g, text.value);
          g(7, styleOf(text.textStyle)?.name ?? STANDARD_TEXT_STYLE);

          if (cos !== 1 || sin !== 0) {
            g(11, fifteenDigits(cos));
            g(21, fifteenDigits(sin));
            g(31, 0);
          }

          g(73, 1);
          g(44, 1);
        }

        for (const block of picture.blocks) {
          const named = blockName(block.block);

          if (named === undefined) continue;
          begin("INSERT", `block-${block.row}-${block.column}`, "AcDbBlockReference");
          g(2, named);
          at(10, ...block.at);
          g(41, block.scale);
          g(42, block.scale);
          g(43, block.scale);

          if (rotation !== undefined && rotation !== 0) g(50, writtenAngle(rotation));
        }
      },
    },
  );
}

/** Writes a table: the insert of its picture's block, then its rows, its columns and each cell. */
function writeTableGroups(
  g: Group,
  table: Table,
  held: TableBlockHeld,
  own: { readonly handle: string; readonly owner: string; readonly paper: boolean },
  blockRecord: (name: string) => string | undefined,
): void {
  g(0, "ACAD_TABLE");
  g(5, own.handle);
  g(330, own.owner);
  g(100, "AcDbEntity");

  if (own.paper) g(67, 1);
  g(8, table.layer);
  g(100, "AcDbBlockReference");
  g(2, held.name);
  point(g, 10, ...table.at);
  g(100, "AcDbTable");
  g(280, 0);
  g(342, validTableStyleHandle(held.style.name));
  g(343, tablePictureHandle(held.place, "record"));
  const [cos, sin] = paragraphDirection(table.rotation);
  g(11, cos === 1 ? 1 : fifteenDigits(cos));
  g(21, sin === 0 ? 0 : fifteenDigits(sin));
  g(31, 0);
  g(90, 22);
  const picture = held.picture;
  g(91, picture.rows.length);
  g(92, picture.columns.length);
  g(93, 0);
  g(94, 0);
  g(95, 0);
  g(96, 0);

  // Without a title or a header, the table says so, since its style shows both.
  if (table.title === undefined) g(280, 1);

  if (table.header === undefined) g(281, 1);

  for (const height of picture.rows) g(141, height);

  for (const width of picture.columns) g(142, width);
  const rows = tableRows(table);
  const starts = new Map<string, GridCell>();

  for (const cell of gridCells(table)) starts.set(`${cell.row}/${cell.column}`, cell);
  rows.forEach(({ cells }, r) => {
    cells.forEach((_, c) => {
      const cell = starts.get(`${r}/${c}`);
      const content = cell?.content ?? {};
      const block = content.block === undefined ? undefined : blockRecord(content.block);
      g(171, block === undefined ? 1 : 2);
      g(172, 0);
      g(173, cell === undefined ? 1 : 0); // merged into another
      g(174, block !== undefined && content.blockScale === undefined ? 1 : 0); // fit to the cell
      g(175, cell?.columns ?? 1);
      g(176, cell?.rows ?? 1);
      let flags = 0;
      const overrides: [number, number | string][] = [];

      if (content.align !== undefined || content.valign !== undefined) {
        const own = cellStyleOf(held.style, rows[r]!.kind);
        flags |= CELL_ALIGNMENT;
        overrides.push([
          170,
          cellAlignment(content.align ?? own.align, content.valign ?? own.valign),
        ]);
      }

      if (content.fill !== undefined) {
        flags |= CELL_FILL;
        // A cell's 283 says it has no fill, where a cell style's says it has one.
        overrides.push([63, content.fill], [283, 0]);
      }

      if (content.color !== undefined) {
        flags |= CELL_COLOR;
        overrides.push([64, content.color]);
      }

      if (content.textHeight !== undefined) {
        flags |= CELL_TEXT_HEIGHT;
        overrides.push([140, content.textHeight]);
      }

      g(91, flags);
      g(178, 0);
      g(145, 0);

      if (block !== undefined) {
        g(340, block);
        g(144, content.blockScale ?? 1);
        g(179, 0);
      }

      for (const [code, value] of overrides) g(code, value);
      g(92, 0);
      g(301, "CELL_VALUE");
      const text = block === undefined ? content.text : undefined;

      if (text === undefined || text === "") {
        g(93, block === undefined ? 3 : 1);
        g(90, block === undefined ? 0 : 4);
        g(94, 0);
        g(300, "");
        g(302, "");
      } else {
        g(93, 4);
        g(90, 4); // a string
        writeCellText(g, 1, 2, text);
        g(94, 0);
        g(300, "");
        writeCellText(g, 302, 303, text);
      }

      g(304, "ACVALUE_END");
    });
  });
}

/** The bits of a cell's group 91 that say which of its style's fields it changes. */
const CELL_ALIGNMENT = 0x1;

/** A fill of its own: its color, 0x4, and whether it has one, 0x2. */
const CELL_FILL = 0x6;
const CELL_COLOR = 0x8;
const CELL_TEXT_HEIGHT = 0x20;

/**
 * Writes a cell's text as an MTEXT's is written, its carets and tabs escaped: whole in `last` up
 * to 250 characters, and in pieces of 250 in `more` before it past that, a caret kept with what it
 * escapes.
 */
function writeCellText(g: Group, last: number, more: number, value: string): void {
  const text = dxfOnce(value).replaceAll("\t", "^I");
  let at = 0;

  while (text.length - at > TEXT_CHUNK) {
    const end = text[at + TEXT_CHUNK - 1] === "^" ? at + TEXT_CHUNK - 1 : at + TEXT_CHUNK;
    g(more, text.slice(at, end));
    at = end;
  }

  g(last, text.slice(at));
}

/** Where a dimension is, with its id and its layout when it has them. */
function dimensionPlace(
  index: number,
  id: string | undefined,
  layout: string | undefined,
): DimensionPlace {
  const place: DimensionPlace = id === undefined ? { index } : { index, id };

  return layout === undefined ? place : { ...place, layout };
}
