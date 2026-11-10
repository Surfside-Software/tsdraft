import type { Drawing, Entity, Units } from "./drawing.ts";
import { extents } from "./extents.ts";
import { dxfText, fmt, readable, writtenAngle } from "./format.ts";
import { layerZeroFirst } from "./layers.ts";

/** `$INSUNITS` codes from the DXF Reference. */
const INSUNITS: Record<Units, number> = { in: 1, ft: 2, mm: 4, cm: 5, m: 6 };

type Group = (code: number, value: string | number) => void;

/** A symbol table record: its handle, and a writer for the fields after the common ones. */
interface TableRecord {
  readonly type: string;
  readonly subclass: string;
  readonly name: string;
  readonly handle: string;
  readonly fields?: (g: Group) => void;
}

/**
 * Writes an ASCII DXF for AutoCAD 2018 and later (AC1032), the newest DXF
 * version Autodesk has published. AutoCAD 2027 still reads and writes AC1032.
 *
 * Unlike R12, this version has handles, owner links, an OBJECTS section and the
 * `$INSUNITS` header, so the drawing's units reach CAD and xref and block
 * insertion scale correctly. Text is UTF-8.
 */
export function toDXFR2018(drawing: Drawing): string {
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
  const [left, bottom, right, top] = extents(drawing.entities);
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
  writeTable(
    g,
    handle,
    "LTYPE",
    [
      ["ByBlock", ""],
      ["ByLayer", ""],
      ["Continuous", "Solid line"],
    ].map(([name = "", description = ""]) => ({
      type: "LTYPE",
      subclass: "AcDbLinetypeTableRecord",
      name,
      handle: handle(),
      fields: (g) => {
        g(3, description);
        g(72, 65);
        g(73, 0);
        g(40, 0);
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
      fields: (g) => {
        g(62, layer.color);
        g(6, "Continuous");
        g(370, -3); // lineweight: default
        g(390, normalPlotStyle); // AutoCAD rejects a layer without a plot style
      },
    })),
  );
  writeTable(g, handle, "STYLE", [
    {
      type: "STYLE",
      subclass: "AcDbTextStyleTableRecord",
      name: "Standard",
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
  ]);
  writeTable(g, handle, "VIEW", []);
  writeTable(g, handle, "UCS", []);
  writeTable(g, handle, "APPID", [
    { type: "APPID", subclass: "AcDbRegAppTableRecord", name: "ACAD", handle: handle() },
  ]);
  writeTable(g, handle, "DIMSTYLE", [
    { type: "DIMSTYLE", subclass: "AcDbDimStyleTableRecord", name: "Standard", handle: handle() },
  ]);
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
  ]);
  g(0, "ENDSEC");

  g(0, "SECTION");
  g(2, "BLOCKS");
  writeBlock(g, handle, "*Model_Space", modelSpace, false);
  writeBlock(g, handle, "*Paper_Space", paperSpace, true);
  g(0, "ENDSEC");

  g(0, "SECTION");
  g(2, "ENTITIES");
  for (const entity of drawing.entities) writeEntity(g, entity, handle(), modelSpace);
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
  h(9, "$CLAYER");
  h(8, "0");
  h(9, "$HANDSEED");
  h(5, handle());
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
  g(code, x);
  g(code + 10, y);
  g(code + 20, 0);
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
    g(70, 0);
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

function writeBlock(
  g: Group,
  handle: () => string,
  name: string,
  owner: string,
  paper: boolean,
): void {
  g(0, "BLOCK");
  g(5, handle());
  g(330, owner);
  g(100, "AcDbEntity");
  if (paper) g(67, 1);
  g(8, "0");
  g(100, "AcDbBlockBegin");
  g(2, name);
  g(70, 0);
  point(g, 10, 0, 0);
  g(3, name);
  g(1, "");
  g(0, "ENDBLK");
  g(5, handle());
  g(330, owner);
  g(100, "AcDbEntity");
  if (paper) g(67, 1);
  g(8, "0");
  g(100, "AcDbBlockEnd");
}

function writeEntity(g: Group, e: Entity, handle: string, owner: string): void {
  const begin = (type: string, subclass: string) => {
    g(0, type);
    g(5, handle);
    g(330, owner);
    g(100, "AcDbEntity");
    g(8, e.layer);
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
      point(g, 10, ...e.at);
      g(40, e.height);
      g(1, dxfText(e.value));
      if (e.rotation !== 0) g(50, e.rotation);
      g(7, "Standard");
      // TEXT repeats its subclass marker before the vertical alignment fields.
      g(100, "AcDbText");
      return;
  }
}
