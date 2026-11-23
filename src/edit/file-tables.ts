// What a firm's file holds that an edit's additions name, as the builder's definitions: each of
// its layers, linetypes, styles and blocks by the name the file spells it, from the file's read.
// The builder takes them as the file's, and the writers map each back to the file's own record.
import { ARROWHEADS, LEADER_ARROWHEADS, type Arrowhead } from "../arrowheads.ts";
import type {
  AttributeDefinition,
  Block,
  DimensionStyle,
  FileDefinitions,
  Layer,
  LeaderStyle,
  Linetype,
  TableStyle,
  TextStyle,
} from "../drawing.ts";
import { STANDARD_TEXT_STYLE } from "../fonts.ts";
import { isString } from "../guards.ts";
import { layerKey } from "../layers.ts";
import type {
  DrawingRead,
  ReadAttributeDefinition,
  ReadDimensionStyle,
  ReadLayer,
  ReadLeaderStyle,
  ReadLinetype,
  ReadTableStyle,
  ReadTextStyle,
} from "../read/model.ts";
import { LEADER_ATTACHMENTS } from "../rules.ts";

/** The linetypes every file holds, which the builder holds of its own. */
const BUILT_IN = new Set(["bylayer", "byblock", "continuous"]);

/** The stand-in of the file's own `Standard` of a table, which the builder cannot define. */
export const STANDARD_STAND_IN = "TSDRAFT-FILE-STANDARD";

/** The file's definitions, as the builder of an edit's additions takes them. */
export interface FileTables extends FileDefinitions {
  /** What a dimension or leader style of the file cannot be drawn in, by its `layerKey`. */
  readonly undrawn: ReadonlyMap<string, string>;
}

/** A layer as the builder holds one: only the fields that are not a layer's default. */
export function layerOf(l: ReadLayer): Layer {
  const lineweight =
    l.lineweight === undefined || l.lineweight < 0 ? undefined : l.lineweight / 100;

  return {
    name: l.name,
    color: l.color ?? 7,
    ...(l.linetype !== undefined &&
      layerKey(l.linetype) !== "continuous" && { linetype: l.linetype }),
    ...(lineweight !== undefined && { lineweight }),
    ...(!l.on && { off: true }),
    ...(l.frozen && { frozen: true }),
    ...(l.locked && { locked: true }),
    ...(!l.plot && { plot: false }),
  };
}

function linetypeOf(l: ReadLinetype): Linetype {
  return { name: l.name, description: l.description ?? "", pattern: [...l.pattern] };
}

/** A text style by the font it names: a TrueType family where it names one, else its file. */
function textStyleOf(s: ReadTextStyle): TextStyle {
  return {
    name: s.name,
    font: s.family ?? s.font ?? "txt.shx",
    ...(s.widthFactor !== undefined && s.widthFactor !== 1 && { widthFactor: s.widthFactor }),
    ...(s.oblique !== undefined && s.oblique !== 0 && { obliqueAngle: s.oblique }),
  };
}

/** The arrowhead a block names, of those tsdraft draws. */
function arrowheadOf(block: string | undefined): Arrowhead | undefined {
  if (block === undefined || block === "") return "closed-filled";

  for (const [name, info] of Object.entries(ARROWHEADS))
    if ("block" in info && layerKey(info.block) === layerKey(block)) {
      // SAFETY: `name` is a key of ARROWHEADS.
      return name as Arrowhead;
    }

  return undefined;
}

/**
 * A dimension style as the builder draws one, or why it cannot: tsdraft draws decimal and
 * architectural lengths, its own arrowheads, and text along the dimension line between the
 * extension lines.
 */
function dimensionStyleOf(s: ReadDimensionStyle, name: string): DimensionStyle | string {
  const arrowhead = arrowheadOf(s.arrowheadBlock);

  if (arrowhead === undefined)
    return `its arrowhead, the block ${JSON.stringify(s.arrowheadBlock)}, is not one tsdraft draws`;
  const units = s.lengthUnits ?? 2;

  if (units !== 2 && units !== 4)
    return `its lengths are in units ${units}, and tsdraft writes decimal and architectural ones`;
  const architectural = units === 4;
  const zeros = s.zeros ?? 0;

  return {
    name,
    ...(s.textStyle !== undefined &&
      layerKey(s.textStyle) !== layerKey(STANDARD_TEXT_STYLE) && { textStyle: s.textStyle }),
    textHeight: s.textHeight ?? 0.18,
    arrowhead,
    arrowSize: s.arrowSize ?? 0.18,
    extensionOffset: s.extensionOffset ?? 0.0625,
    extensionBeyond: s.extensionBeyond ?? 0.18,
    textGap: Math.abs(s.textGap ?? 0.09),
    lineExtension: s.lineExtension ?? 0,
    ...(s.scale !== undefined && s.scale > 0 && { scale: s.scale }),
    units: architectural ? "architectural" : "decimal",
    precision: s.precision ?? 4,
    ...(s.suffix !== undefined && suffixOf(s.suffix)),
    ...(architectural
      ? { feetInchZeros: (["neither", "both", "feet", "inches"] as const)[zeros & 3]! }
      : (zeros & 12) !== 0 && {
          suppressZeros: (zeros & 12) === 12 ? "both" : (zeros & 4) !== 0 ? "leading" : "trailing",
        }),
    ...(s.lengthFactor !== undefined &&
      s.lengthFactor !== 1 && { measurementScale: s.lengthFactor }),
    ...(architectural && fractionOf(s)),
    textPlacement: (s.textVertical ?? 0) === 0 ? "centered" : "above",
    // A radial dimension's text outside its circle is level where the style keeps it so.
    ...((s.textLevelOutside ?? 1) === 1 && { radialText: "horizontal" as const }),
    ...(s.dimensionLineweight !== undefined &&
      s.dimensionLineweight >= 0 && { dimensionLineweight: s.dimensionLineweight / 100 }),
    ...(s.extensionLineweight !== undefined &&
      s.extensionLineweight >= 0 && { extensionLineweight: s.extensionLineweight / 100 }),
  };
}

/** How a style writes a fraction of an inch, `DIMFRAC`, with its size where it is stacked. */
function fractionOf(s: ReadDimensionStyle): Pick<DimensionStyle, "fraction" | "fractionScale"> {
  const fraction = (["stacked", "diagonal", "inline"] as const)[s.fraction ?? 0] ?? "stacked";

  return {
    fraction,
    ...(fraction !== "inline" &&
      s.fractionScale !== undefined && { fractionScale: s.fractionScale }),
  };
}

/** A `DIMPOST` of `prefix<>suffix`, or of a suffix alone. */
function suffixOf(post: string): Pick<DimensionStyle, "prefix" | "suffix"> {
  const at = post.indexOf("<>");

  if (at < 0) return post === "" ? {} : { suffix: post };
  const prefix = post.slice(0, at);
  const suffix = post.slice(at + 2);

  return { ...(prefix !== "" && { prefix }), ...(suffix !== "" && { suffix }) };
}

function leaderStyleOf(s: ReadLeaderStyle, name: string): LeaderStyle | string {
  let arrowhead: string | undefined = "closed-filled";

  if (s.arrowheadBlock !== undefined && s.arrowheadBlock !== "") {
    arrowhead = undefined;

    for (const [key, info] of Object.entries(LEADER_ARROWHEADS))
      if ("block" in info && layerKey(info.block) === layerKey(s.arrowheadBlock)) arrowhead = key;
  }

  if (arrowhead === undefined)
    return `its arrowhead, the block ${JSON.stringify(s.arrowheadBlock)}, is not one tsdraft draws`;
  const attachment = LEADER_ATTACHMENTS[s.attachment];

  return {
    name,
    ...(s.textStyle !== undefined &&
      layerKey(s.textStyle) !== layerKey(STANDARD_TEXT_STYLE) && { textStyle: s.textStyle }),
    textHeight: s.textHeight,
    ...(arrowhead !== "closed-filled" && { arrowhead }),
    arrowSize: s.arrowSize,
    landing: s.landing,
    gap: s.gap,
    ...(attachment !== undefined && { attachment }),
    ...(s.direction === 1 && { direction: "vertical" as const }),
    ...(s.frame && { frame: true }),
    ...(s.scale !== 1 && s.scale > 0 && { scale: s.scale }),
  };
}

function tableStyleOf(s: ReadTableStyle, name: string): TableStyle {
  return {
    name,
    ...(layerKey(s.data.textStyle) !== layerKey(STANDARD_TEXT_STYLE) && {
      textStyle: s.data.textStyle,
    }),
    textHeight: s.data.textHeight,
    horizontalMargin: s.horizontalMargin,
    verticalMargin: s.verticalMargin,
  };
}

function attributeOf(a: ReadAttributeDefinition): AttributeDefinition {
  const at = a.alignAt ?? a.at;

  return {
    tag: a.tag,
    ...(a.prompt !== undefined && { prompt: a.prompt }),
    value: a.default ?? "",
    layer: a.layer,
    at: [at[0], at[1]],
    height: a.height,
    rotation: a.rotation,
    ...(layerKey(a.style) !== layerKey(STANDARD_TEXT_STYLE) && { style: a.style }),
    ...(a.align !== undefined &&
      a.align !== "aligned" &&
      a.align !== "fit" && { align: a.align === "middle" ? "center" : a.align }),
    ...(a.align === "middle" ? { valign: "middle" as const } : a.valign && { valign: a.valign }),
  };
}

/** A name of the file's for its table, not taken by the stand-in, which the file may hold too. */
function standIn(taken: ReadonlySet<string>): string {
  let name = STANDARD_STAND_IN;

  for (let n = 2; taken.has(layerKey(name)); n++) name = `${STANDARD_STAND_IN}-${n}`;

  return name;
}

/** The file's definitions from its read, for the builder of an edit's additions. */
export function fileTables(read: DrawingRead): FileTables {
  const aliases = new Map<string, string>();
  const undrawn = new Map<string, string>();

  /** The name a style of the file is held under: a stand-in for its own `Standard`. */
  const named = (
    table: "dimensionStyles" | "leaderStyles" | "tableStyles",
    name: string,
    taken: ReadonlySet<string>,
  ): string => {
    if (layerKey(name) !== "standard") return name;
    const alias = standIn(taken);
    aliases.set(`${table}:standard`, alias);

    return alias;
  };

  const dimensionNames = new Set(read.dimensionStyles.map((s) => layerKey(s.name)));
  const dimensionStyles: DimensionStyle[] = [];

  for (const s of read.dimensionStyles) {
    const style = dimensionStyleOf(s, named("dimensionStyles", s.name, dimensionNames));

    if (isString(style)) undrawn.set(`dimensionStyles:${layerKey(s.name)}`, style);
    else dimensionStyles.push(style);
  }

  const leaderNames = new Set((read.leaderStyles ?? []).map((s) => layerKey(s.name)));
  const leaderStyles: LeaderStyle[] = [];
  const seenLeaders = new Set<string>();

  for (const s of read.leaderStyles ?? []) {
    // A name the file holds twice is named by its handle, and the builder takes the first.
    if (seenLeaders.has(layerKey(s.name))) continue;
    seenLeaders.add(layerKey(s.name));
    const style = leaderStyleOf(s, named("leaderStyles", s.name, leaderNames));

    if (isString(style)) undrawn.set(`leaderStyles:${layerKey(s.name)}`, style);
    else leaderStyles.push(style);
  }

  const tableNames = new Set(read.tableStyles.map((s) => layerKey(s.name)));

  return {
    layers: read.layers.filter((l) => !l.xref).map(layerOf),
    linetypes: read.linetypes.filter((l) => !BUILT_IN.has(layerKey(l.name))).map(linetypeOf),
    textStyles: read.textStyles
      .filter((s) => layerKey(s.name) !== layerKey(STANDARD_TEXT_STYLE) && !s.glyphFile)
      .map(textStyleOf),
    dimensionStyles,
    leaderStyles,
    tableStyles: read.tableStyles.map((s) =>
      tableStyleOf(s, named("tableStyles", s.name, tableNames)),
    ),
    blocks: read.blocks
      .filter((b) => !b.anonymous)
      .map((b): Block => ({
        name: b.name,
        base: [b.base[0], b.base[1]],
        entities: [],
        attributes: b.attributeDefinitions.map(attributeOf),
      })),
    aliases,
    undrawn,
  };
}
