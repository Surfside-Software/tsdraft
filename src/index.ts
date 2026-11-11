export {
  attributeDefinitionHandle,
  attributeHandle,
  attributesEndHandle,
  blockHandle,
  findBlock,
  findXref,
  placeAttribute,
  type PlacedAttribute,
} from "./blocks.ts";
export type { CallSite } from "./callsite.ts";
export {
  createDrawing,
  DrawingBuilder,
  sweep,
  type Arc,
  type AttributeDefinition,
  type AttributeOptions,
  type Block,
  type BlockOptions,
  type Circle,
  type Drawing,
  type DrawingOptions,
  type DxfVersion,
  type Entity,
  type EntityOptions,
  type Insert,
  type InsertOptions,
  type Layer,
  type LayerOptions,
  type Line,
  type Linetype,
  type LinetypeChoice,
  type LinetypeDefinition,
  type Lineweight,
  type Point,
  type Polyline,
  type Text,
  type TextAlign,
  type TextOptions,
  type TextStyle,
  type TextStyleChoice,
  type TextStyleDefinition,
  type TextVerticalAlign,
  type Units,
  type Xref,
} from "./drawing.ts";
export { toDXF, type DxfOptions } from "./dxf.ts";
export { FONTS, type Font, type FontInfo } from "./fonts.ts";
export { idHandle } from "./handles.ts";
export { fromJSON, toJSON } from "./json.ts";
export { DrawingError, lint, type Diagnostic, type LintOptions, type LintRule } from "./lint.ts";
export { CENTER, DASHDOT, DASHED, DOT, HIDDEN, LINEWEIGHTS, PHANTOM } from "./linetypes.ts";
export { fromPaper, type PaperScale, type PaperUnit } from "./paper.ts";
export type {
  Aci,
  AttributeTag,
  BlockName,
  Description,
  EntityId,
  FontOf,
  InsertScale,
  LayerColor,
  LayerLinetypeName,
  LayerName,
  LineweightOf,
  LinetypeName,
  NewLinetypeName,
  NewTextStyleName,
  ObliqueAngle,
  PaperLength,
  Pattern,
  Positive,
  Ratio,
  TextStyleName,
  WidthFactor,
  XrefPath,
} from "./rules.ts";
export { toSVG, type SvgOptions } from "./svg.ts";
