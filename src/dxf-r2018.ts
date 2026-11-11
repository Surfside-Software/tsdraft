import {
  definitionHandle,
  insertAttributeHandle,
  insertEndHandle,
  blockHandles,
  blocksByKey,
  placeAttribute,
} from "./blocks.ts";
import type {
  AttributeDefinition,
  Block,
  Drawing,
  Entity,
  Insert,
  Linetype,
  Text,
  TextStyle,
  Units,
} from "./drawing.ts";
import { extents } from "./extents.ts";
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
  // The extents are worked out here, so they are brought into the range AutoCAD reads.
  const [left, bottom, right, top] = extents(drawing.entities, drawing.textStyles, drawing.blocks);
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
  writeTable(g, handle, "STYLE", [
    {
      type: "STYLE",
      subclass: "AcDbTextStyleTableRecord",
      name: STANDARD_TEXT_STYLE,
      handle: handle(),
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
    ...textStyles.map((style) => ({
      type: "STYLE",
      subclass: "AcDbTextStyleTableRecord",
      name: style.name,
      handle: handle(),
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
  writeTable(g, handle, "VIEW", []);
  writeTable(g, handle, "UCS", []);
  writeTable(g, handle, "APPID", [
    { type: "APPID", subclass: "AcDbRegAppTableRecord", name: "ACAD", handle: handle() },
  ]);
  writeTable(g, handle, "DIMSTYLE", [
    { type: "DIMSTYLE", subclass: "AcDbDimStyleTableRecord", name: "Standard", handle: handle() },
  ]);
  const blocks = drawing.blocks ?? [];
  const blockRecordFields = (g: Group) => {
    g(280, 1); // explodable
    g(281, 0); // scale uniformly: no
  };
  writeTable(g, handle, "BLOCK_RECORD", [
    {
      type: "BLOCK_RECORD",
      subclass: "AcDbBlockTableRecord",
      name: "*Model_Space",
      handle: modelSpace,
      fields: blockRecordFields,
    },
    {
      type: "BLOCK_RECORD",
      subclass: "AcDbBlockTableRecord",
      name: "*Paper_Space",
      handle: paperSpace,
      fields: blockRecordFields,
    },
    ...blocks.map((block) => ({
      type: "BLOCK_RECORD",
      subclass: "AcDbBlockTableRecord",
      name: block.name,
      handle: blockHandles(block.name).record,
      // A block is in the drawing's units, so that CAD inserts it at its own size.
      flags: INSUNITS[drawing.units],
      fields: blockRecordFields,
    })),
  ]);
  g(0, "ENDSEC");

  const blocksByName = blocksByKey(blocks);
  const styleOf = (name: string | undefined): TextStyle | undefined =>
    name === undefined ? undefined : stylesByKey.get(layerKey(name));
  /** Writes the entities of model space or of a block, each owned by `owner`. */
  const writeEntities = (entities: readonly Entity[], owner: string): void => {
    for (const entity of entities) {
      const own = entity.id === undefined ? handle() : handleOf(entity.id);
      if (entity.kind !== "insert") {
        writeEntity(
          g,
          entity,
          own,
          owner,
          entity.kind === "text" ? styleOf(entity.style) : undefined,
        );
        continue;
      }
      const block = blocksByName.get(layerKey(entity.block));
      const definitions = block?.attributes ?? [];
      writeInsert(g, entity, own, owner, definitions.length > 0);
      if (definitions.length === 0) continue;
      const { id } = entity;
      for (const definition of definitions) {
        const placed = placeAttribute(definition, styleOf(definition.style), entity, block?.base);
        g(0, "ATTRIB");
        g(5, id === undefined ? handle() : insertAttributeHandle(id, definition.tag));
        g(330, own);
        g(100, "AcDbEntity");
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
      g(8, entity.layer);
    }
  };

  g(0, "SECTION");
  g(2, "BLOCKS");
  writeBlock(g, handle(), handle(), "*Model_Space", modelSpace, { paper: false });
  writeBlock(g, handle(), handle(), "*Paper_Space", paperSpace, { paper: true });
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
  g(0, "ENDSEC");

  g(0, "SECTION");
  g(2, "ENTITIES");
  writeEntities(drawing.entities, modelSpace);
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
  h(9, "$CLAYER");
  h(8, "0");
  h(9, "$HANDSEED");
  // AutoCAD numbers the objects it adds from the seed up, so it is above every handle here.
  const named = blocks.length > 0 || drawing.entities.some((entity) => entity.id !== undefined);
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
  g(70, block.hasAttributes ? 2 : 0); // 2: the block has attribute definitions
  point(g, 10, ...(block.base ?? [0, 0]));
  g(3, name);
  g(1, "");
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
): void {
  g(0, "INSERT");
  g(5, handle);
  g(330, owner);
  g(100, "AcDbEntity");
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

/** Writes an entity. `style` is the text style of a text that is not in `Standard`. */
function writeEntity(
  g: Group,
  e: Exclude<Entity, Insert>,
  handle: string,
  owner: string,
  style: TextStyle | undefined,
): void {
  const begin = (type: string, subclass: string) => {
    g(0, type);
    g(5, handle);
    g(330, owner);
    g(100, "AcDbEntity");
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
