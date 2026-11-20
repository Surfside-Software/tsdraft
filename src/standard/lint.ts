// The rules of a standard that `lint(drawing, { standard })` holds a drawing to: what the builder
// refuses under a standard, for a drawing made by other code or read from JSON, under the same
// rules, and what only the whole drawing shows, such as the height a text plots at in each
// viewport that shows it. The leading CAD app opens a drawing that breaks them: they are the firm's.
import { DEFAULT_ARROWHEAD, DEFAULT_LEADER_ARROWHEAD } from "../arrowheads.ts";
import {
  blocksByKey,
  eachDrawn,
  mapPoint,
  placeAttribute,
  type LayerRef,
  type Matrix,
  type Placement,
} from "../blocks.ts";
import { callOf } from "../callsite.ts";
import type {
  AttributeDefinition,
  Block,
  DimensionStyle,
  Drawing,
  Entity,
  Insert,
  Layer,
  Layout,
  LeaderStyle,
  Linetype,
  Point,
  Paragraph,
  Text,
  TextStyle,
  Viewport,
  Xref,
} from "../drawing.ts";
import { boxer } from "../extents.ts";
import { STANDARD_FONT } from "../fonts.ts";
import { written } from "../format.ts";
import { grid, type Box } from "../inspect.ts";
import { canonical } from "../json.ts";
import { layerKey } from "../layers.ts";
import { leaderPicture } from "../leaders.ts";
import { validViewportView, viewReaches } from "../layouts.ts";
import type { Diagnostic, LintRule } from "../lint.ts";
import { inStyle, measureText } from "../measure.ts";
import { measureParagraph, paragraphInStyle } from "../paragraphs.ts";
import { DEFAULT_PLOT_STYLE_TABLE, paperInfo } from "../papers.ts";
import {
  idKey,
  isStandardDimensionStyle,
  isStandardLeaderStyle,
  isStandardTextStyle,
  sheetNumberProblem,
  shown,
  viewportProblem,
} from "../rules.ts";
import { filled, isSound, Strings, TYPED, type Check } from "../shape.ts";
import { visibility } from "../svg.ts";
import { isUnits, modelLength } from "../units.ts";
import type {
  Standard,
  StandardDimensionStyle,
  StandardLayer,
  StandardLeaderStyle,
  StandardLinetype,
  StandardScale,
  StandardSheetFormat,
  StandardTextRole,
  StandardTitleBlock,
} from "./document.ts";
import {
  DRAWN,
  disciplineLacks,
  layerLacks,
  linetypeLacks,
  numberNotLayoutName,
  sheetNumberOfFile,
  writingLacks,
} from "./drawn.ts";
import { adopted } from "./made.ts";
import { capitals } from "./rules.ts";
import type { Problem } from "./shape.ts";

/**
 * The most work the checks of text heights and dimension scales do for one drawing, counted in
 * what they look at: each text and dimension a space draws, a text one more for each 32
 * characters, a dimension one more for each 32 characters its label reads, a leader as much again
 * for its note and each line of the note as a text, each insert walked and each item of its
 * block, each name read the first time, one more for each 32 characters, each box a grid looks
 * at, each text or dimension held against a viewport, and each error, one more for each 32
 * characters of its message. Model space is looked at again, and paid for again, for each set of
 * layers a viewport freezes.
 */
const MAX_WORK = 1_000_000;

const IN_VIEWPORT =
  "it was sized for another scale. Draw it in the view of the viewport that shows it";
const ON_LAYOUT =
  "a text on a layout plots at its height. Draw it in its role, and insert its block at a scale of 1";
const LEADER_NOTE =
  "a leader's note takes its text style and height from a role. Give the leader role, in place of textStyle and textHeight";

/** Thrown inside a walk to end it when the work reaches its limit. */
const CAPPED = Symbol("capped");

/** The frozen layers of a viewport that freezes none. */
const NONE: readonly string[] = [];

/**
 * Adds to `out` what breaks the standard `given`, which is taken as plain data from any copy of
 * tsdraft. A standard that does not check is one `standard` error, and nothing else is checked.
 * The checks of heights and scales do at most `most` units of work.
 */
export function lintStandard(
  drawing: Drawing,
  given: unknown,
  discipline: unknown,
  version: unknown,
  out: Diagnostic[],
  most = MAX_WORK,
): void {
  const problems: Problem[] = [];
  let standard: Standard | undefined;
  try {
    standard = adopted(given, problems);
  } catch (thrown) {
    // lint never throws, whatever it is given as a standard.
    problems.push({ item: "", message: String((thrown as Error)?.message ?? thrown) });
  }
  if (!standard) {
    out.push({ rule: "standard", severity: "error", message: notChecked(problems) });
    return;
  }
  const index = indexOf(standard);
  const error = (rule: LintRule, message: string, about: Partial<Diagnostic> = {}): void => {
    out.push({ rule, severity: "error", message, ...about });
  };
  const warn = (rule: LintRule, message: string, about: Partial<Diagnostic> = {}): void => {
    out.push({ rule, severity: "warning", message, ...about });
  };
  if (version === "R12") error("standard", DRAWN.r12);

  // The drawing's discipline, which resolves the entries with fields by discipline.
  let known: string | undefined;
  if (discipline !== undefined) {
    if (typeof discipline !== "string") error("standard", "A discipline is named by a string");
    else if (standard.sheetFiles === "one-drawing") error("standard", DRAWN.disciplineOneDrawing);
    else {
      known = Object.keys(standard.disciplines).find((id) => idKey(id) === idKey(discipline));
      if (known === undefined) error("standard", disciplineLacks(discipline, standard));
    }
  }
  /** The entries with fields by discipline that went unchecked, for lack of a discipline. */
  const skipped = new Set<string>();
  /** An entry as the drawing's discipline resolves it, or undefined when that is not known. */
  const resolved = <E extends { readonly byDiscipline?: { readonly [d: string]: object } }>(
    entry: E,
    what: string,
  ): E | undefined => {
    if (!entry.byDiscipline) return entry;
    if (known === undefined) {
      skipped.add(what);
      return undefined;
    }
    return { ...entry, ...entry.byDiscipline[known] };
  };

  const units = isUnits(drawing.units) ? drawing.units : undefined;
  const sound = <T>(check: Check, list: readonly unknown[]): T[] =>
    list.filter((item) => isSound(check, item, false)) as T[];
  const layers = sound<Layer>(TYPED.layer, filled(drawing.layers));
  const linetypes = sound<Linetype>(TYPED.linetype, filled(drawing.linetypes));
  const textStyles = sound<TextStyle>(TYPED.textStyle, filled(drawing.textStyles));
  const dimensionStyles = sound<DimensionStyle>(
    TYPED.dimensionStyle,
    filled(drawing.dimensionStyles),
  );
  const leaderStyles = sound<LeaderStyle>(TYPED.leaderStyle, filled(drawing.leaderStyles));
  const blocks = sound<Block>(TYPED.block, filled(drawing.blocks));
  const xrefs = sound<Xref>(TYPED.xref, filled(drawing.xrefs));
  const layoutList = filled(drawing.layouts);
  const layouts = sound<Layout>(TYPED.layout, layoutList);
  const isEntity = (e: unknown): e is Entity => isSound(TYPED.entity, e, false);
  const isDefinition = (a: unknown): a is AttributeDefinition => isSound(TYPED.attribute, a, false);
  const first = <T extends { readonly name: string }>(list: readonly T[]): Map<string, T> => {
    const map = new Map<string, T>();
    for (const item of list) if (!map.has(layerKey(item.name))) map.set(layerKey(item.name), item);
    return map;
  };
  const stylesByKey = first(textStyles);
  const blocksByName = first(blocks);
  const xrefsByName = first(xrefs);

  // The layers.
  for (const layer of first(layers).values()) {
    if (layerKey(layer.name) === "0") continue;
    const found = index.layers.get(layerKey(layer.name));
    const about = { layer: layer.name };
    if (!found) {
      error("layer-outside-standard", layerLacks(layer.name, standard), about);
      continue;
    }
    const [name, entry] = found;
    const fields = resolved(entry, `the layer ${shown(name)}`);
    if (!fields) continue;
    const pen = fields.pen === undefined ? undefined : standard.pens[fields.pen];
    /** Reports a field of the layer, each value as a message shows it. */
    const differs = (field: string, value: string, own: string): void => {
      error(
        "layer-differs-from-standard",
        `Layer ${shown(layer.name)} has ${field} ${value}, and the standard gives it ${field} ${own}`,
        about,
      );
    };
    if (layer.color !== fields.color) differs("color", shown(layer.color), shown(fields.color));
    const linetype = layer.linetype ?? "Continuous";
    if (layerKey(linetype) !== layerKey(fields.linetype)) {
      differs("linetype", shown(linetype), shown(fields.linetype));
    }
    const lineweight = layer.lineweight ?? "Default";
    const own = pen?.lineweight ?? "Default";
    const mm = (weight: unknown) => (typeof weight === "number" ? `${weight} mm` : shown(weight));
    if (lineweight !== own) differs("lineweight", mm(lineweight), mm(own));
    const plot = layer.plot ?? true;
    if (plot !== fields.plot) differs("plot", shown(plot), shown(fields.plot));
  }

  // The linetypes and the linetype scale.
  for (const linetype of first(linetypes).values()) {
    const found = index.linetypes.get(layerKey(linetype.name));
    const about = { linetype: linetype.name };
    if (!found) {
      error("linetype-outside-standard", linetypeLacks(linetype.name, standard), about);
      continue;
    }
    const [, own] = found;
    const label = `Linetype ${shown(linetype.name)}`;
    if (!samePattern(linetype.pattern, own.pattern)) {
      error(
        "linetype-differs-from-standard",
        `${label} has the pattern [${linetype.pattern.join(", ")}], and the standard gives it [${own.pattern.join(", ")}]`,
        about,
      );
    }
    if (linetype.description !== own.description) {
      error(
        "linetype-differs-from-standard",
        `${label} has the description ${shown(linetype.description)}, and the standard gives it ${shown(own.description)}`,
        about,
      );
    }
  }
  const scale: unknown = drawing.linetypeScale ?? 1;
  if (typeof scale === "number" && written(scale) !== written(standard.linetypeScale)) {
    error(
      "linetype-differs-from-standard",
      `The drawing's linetypeScale is ${shown(scale)}, and the standard's is ${standard.linetypeScale}. Leave linetypeScale to the standard`,
    );
  }

  // The text styles: a role's, or a title block's.
  const roleOf = (style: string | undefined) =>
    style === undefined ? undefined : index.roleStyles.get(layerKey(style));
  for (const style of first(textStyles).values()) {
    if (isStandardTextStyle(style.name)) continue;
    const about = { textStyle: style.name };
    const role = roleOf(style.name);
    if (!role) {
      if (!index.titleBlockStyles.has(layerKey(style.name))) {
        error(
          "text-style-outside-standard",
          `Text style ${shown(style.name)}: ${DRAWN.textStyleDefined}`,
          about,
        );
      }
      continue;
    }
    const [id, entry] = role;
    const fields = resolved(entry, `the text role ${shown(id)}`);
    if (!fields) continue;
    const differs = (field: string, value: unknown, own: unknown): void => {
      error(
        "text-style-differs-from-standard",
        `Text style ${shown(style.name)} has ${field} ${shown(value)}, and the role ${shown(id)} gives it ${field} ${shown(own)}`,
        about,
      );
    };
    if (style.font !== fields.font) differs("font", style.font, fields.font);
    const widthFactor = style.widthFactor ?? 1;
    if (written(widthFactor) !== written(fields.widthFactor)) {
      differs("widthFactor", widthFactor, fields.widthFactor);
    }
    const obliqueAngle = style.obliqueAngle ?? 0;
    if (written(obliqueAngle) !== written(fields.obliqueAngle)) {
      differs("obliqueAngle", obliqueAngle, fields.obliqueAngle);
    }
  }

  // The dimension styles: one of the standard's, on a layout or at one of its scales.
  /**
   * Each dimension style of the standard the drawing has: the ratio it is drawn at, a scale's or
   * null on a layout, its name as a message shows it, and the length of what each of its labels
   * reads of it, its prefix, its suffix and its text style's name.
   */
  const styleRatio = new Map<
    string,
    { readonly shown: string; readonly scale: StandardScale | null; readonly reads: number }
  >();
  const shownStyles = first(dimensionStyles);
  for (const style of shownStyles.values()) {
    if (isStandardDimensionStyle(style.name)) continue;
    const about = { dimensionStyle: style.name };
    const label = `Dimension style ${shown(style.name)}`;
    const found = index.dimensionStyle(layerKey(style.name));
    if (!found) {
      error("dimension-style-outside-standard", `${label}: ${DRAWN.dimensionStyleDefined}`, about);
      continue;
    }
    const { id, entry, scale: at } = found;
    const reads =
      (style.prefix?.length ?? 0) + (style.suffix?.length ?? 0) + (style.textStyle?.length ?? 0);
    styleRatio.set(layerKey(style.name), {
      shown: shown(style.name),
      scale: at?.[1] ?? null,
      reads,
    });
    const fields = resolved(entry, `the dimension style ${shown(id)}`);
    const roleFound = fields && index.roles.get(idKey(fields.role));
    const role = roleFound && resolved(roleFound[1], `the text role ${shown(roleFound[0])}`);
    if (!fields || !roleFound || !role) continue;
    const writingUnits = at ? units : standard.paperUnits;
    if (writingUnits === undefined) continue;
    const writing = fields.writing[writingUnits];
    if (!writing) {
      error("dimension-style", `${label}: ${writingLacks(id, writingUnits, standard)}`, about);
      continue;
    }
    const expected: readonly (readonly [string, unknown, unknown])[] = [
      ["textStyle", style.textStyle ?? "Standard", capitals(roleFound[0])],
      ["textHeight", style.textHeight, role.height],
      ["arrowhead", style.arrowhead ?? DEFAULT_ARROWHEAD, fields.arrowhead],
      ["arrowSize", style.arrowSize, fields.arrowSize],
      ["extensionOffset", style.extensionOffset, fields.extensionOffset],
      ["extensionBeyond", style.extensionBeyond, fields.extensionBeyond],
      ["textGap", style.textGap, fields.textGap],
      [
        "scale",
        style.scale ?? 1,
        at && units ? modelLength(1, standard.paperUnits, at[1].ratio, units) : 1,
      ],
      ["units", style.units ?? "decimal", writing.units],
      ["precision", style.precision, writing.precision],
      ["prefix", style.prefix ?? "", writing.prefix ?? ""],
      ["suffix", style.suffix ?? "", writing.suffix ?? ""],
      ["suppressZeros", style.suppressZeros ?? "none", writing.suppressZeros ?? "none"],
      [
        "feetInchZeros",
        style.feetInchZeros ?? (style.units === "architectural" ? "inches" : "none"),
        writing.feetInchZeros ?? (writing.units === "architectural" ? "inches" : "none"),
      ],
      ["measurementScale", style.measurementScale ?? 1, writing.measurementScale],
      ["fraction", style.fraction ?? "inline", writing.fraction],
      ["fractionScale", style.fractionScale ?? 1, writing.fractionScale],
      ["textPlacement", style.textPlacement ?? "above", fields.textPlacement],
      ["textFit", style.textFit ?? "inside", fields.textFit],
      ["dimensionLineweight", style.dimensionLineweight, fields.dimensionLineweight],
      ["extensionLineweight", style.extensionLineweight, fields.extensionLineweight],
    ];
    for (const [field, value, own] of expected) {
      const same =
        field === "textStyle"
          ? layerKey(value as string) === layerKey(own as string)
          : typeof value === "number" && typeof own === "number"
            ? written(value) === written(own)
            : value === own;
      if (same) continue;
      error(
        "dimension-style-differs-from-standard",
        `${label} has ${field} ${shown(value)}, and the standard gives it ${field} ${shown(own)}`,
        about,
      );
    }
  }

  // The leader styles: one of the standard's, on a layout or at one of its scales, as the
  // dimension styles are.
  const leaderRatio = new Map<
    string,
    {
      readonly shown: string;
      readonly scale: StandardScale | null;
      readonly reads: number;
      readonly style: LeaderStyle;
      /** True when its text height is not its role's, which the style's own error reports. */
      offHeight: boolean;
      /** True when its text style is not its role's, which that error reports too. */
      offStyle: boolean;
    }
  >();
  const shownLeaderStyles = first(leaderStyles);
  for (const style of shownLeaderStyles.values()) {
    if (isStandardLeaderStyle(style.name)) continue;
    const about = { leaderStyle: style.name };
    const label = `Leader style ${shown(style.name)}`;
    const found = index.leaderStyle(layerKey(style.name));
    if (!found) {
      error("leader-style-outside-standard", `${label}: ${DRAWN.leaderStyleDefined}`, about);
      continue;
    }
    const { id, entry, scale: at } = found;
    const ratio = {
      shown: shown(style.name),
      scale: at?.[1] ?? null,
      reads: style.textStyle?.length ?? 0,
      style,
      offHeight: false,
      offStyle: false,
    };
    leaderRatio.set(layerKey(style.name), ratio);
    const fields = resolved(entry, `the leader style ${shown(id)}`);
    const roleFound = fields && index.roles.get(idKey(fields.role));
    const role = roleFound && resolved(roleFound[1], `the text role ${shown(roleFound[0])}`);
    if (!fields || !roleFound || !role) continue;
    if (at && !units) continue;
    const expected: readonly (readonly [string, unknown, unknown])[] = [
      ["textStyle", style.textStyle ?? "Standard", capitals(roleFound[0])],
      ["textHeight", style.textHeight, role.height],
      ["arrowhead", style.arrowhead ?? DEFAULT_LEADER_ARROWHEAD, fields.arrowhead],
      ["arrowSize", style.arrowSize, fields.arrowSize],
      ["landing", style.landing, fields.landing],
      ["gap", style.gap, fields.gap],
      ["attachment", style.attachment ?? "first-line", fields.attachment],
      [
        "scale",
        style.scale ?? 1,
        at && units ? modelLength(1, standard.paperUnits, at[1].ratio, units) : 1,
      ],
    ];
    for (const [field, value, own] of expected) {
      const same =
        field === "textStyle"
          ? layerKey(value as string) === layerKey(own as string)
          : typeof value === "number" && typeof own === "number"
            ? written(value) === written(own)
            : value === own;
      if (same) continue;
      if (field === "textHeight") ratio.offHeight = true;
      if (field === "textStyle") ratio.offStyle = true;
      error(
        "leader-style-differs-from-standard",
        `${label} has ${field} ${shown(value)}, and the standard gives it ${field} ${shown(own)}`,
        about,
      );
    }
  }

  // The title blocks: one in the drawing is the standard's when every definition of its closure
  // is, and the rules for pens, text styles and role heights then skip what it draws.
  const standardBlocks = new Set<string>();
  const linetypesByKey = first(linetypes);
  /**
   * The canonical JSON of each definition the closures name, by its kind, worked out once: none
   * for one with a field its kind does not have, and none past `length` characters, the length
   * of the standard's, which it then cannot be.
   */
  const drawnJson = new Map<Check, Map<object, { json: string | undefined; length: number }>>();
  const jsonOfDrawn = (check: Check, found: object, length: number): string | undefined => {
    let ofKind = drawnJson.get(check);
    if (!ofKind) drawnJson.set(check, (ofKind = new Map()));
    const known = ofKind.get(found);
    if (known && known.length >= length) return known.json;
    let json: string | undefined;
    // Only JSON cut short at `length` is written again, for a longer definition of the standard.
    let upTo = Infinity;
    if (isSound(check, found)) {
      json = guarded(() => canonical(found, "A definition", undefined, length));
      if (json === undefined) upTo = length;
    }
    ofKind.set(found, { json, length: upTo });
    return json;
  };
  for (const block of index.titleBlocks) {
    const placed =
      (block.blockName !== undefined && blocksByName.has(layerKey(block.blockName))) ||
      (block.xref !== undefined && xrefsByName.has(layerKey(block.xref.name)));
    if (!placed) continue;
    const differ: string[] = [];
    const missing: string[] = [];
    const compare = (
      kind: string,
      check: Check,
      own: ReadonlyMap<string, { readonly name: string; readonly json: string }>,
      drawn: ReadonlyMap<string, object>,
    ): void => {
      for (const [key, { name, json }] of own) {
        const found = drawn.get(key);
        if (!found) missing.push(`${kind} ${shown(name)}`);
        else if (jsonOfDrawn(check, found, json.length) !== json) {
          differ.push(`${kind} ${shown(name)}`);
        }
      }
    };
    compare("block", TYPED.block, block.blocks, blocksByName);
    compare("text style", TYPED.textStyle, block.textStyles, stylesByKey);
    compare("linetype", TYPED.linetype, block.linetypes, linetypesByKey);
    if (block.xref) {
      const found = xrefsByName.get(layerKey(block.xref.name));
      if (!found) missing.push(`xref ${shown(block.xref.name)}`);
      else if (found.path !== block.xref.path) differ.push(`xref ${shown(block.xref.name)}`);
    }
    if (differ.length === 0 && missing.length === 0) {
      for (const key of block.blocks.keys()) standardBlocks.add(key);
      continue;
    }
    const parts = [
      ...(differ.length > 0
        ? [`its ${listed(differ)} ${differ.length === 1 ? "is" : "are"} not the standard's`]
        : []),
      ...(missing.length > 0 ? [`the drawing has no ${listed(missing)} of it`] : []),
    ];
    error(
      "title-block-differs-from-standard",
      `The title block ${shown(block.id)} of the standard: ${parts.join(", and ")}. Place it with sheet.titleBlock(), which copies it from the standard`,
      block.blockName !== undefined && blocksByName.has(layerKey(block.blockName))
        ? { block: blocksByName.get(layerKey(block.blockName))!.name }
        : { xref: block.xref!.name },
    );
  }

  // What the checks do again is bounded work: a list that many blocks share, and the heights
  // texts plot at and the scales dimensions are shown at. Past the limit, no more is checked.
  let work = 0;
  let capped: string | undefined;
  const spend = (cost: number): boolean => {
    if (capped !== undefined) return false;
    work += cost;
    return work <= most;
  };
  /** The lists of entities and definitions read, so that one many blocks share is paid again. */
  const read = new WeakSet<object>();
  /** True when the checks stopped at a list or a long string that many places share. */
  let shared = false;
  /** The strings of 256 characters or more the checks have read. */
  const long = new Strings<true>();
  /**
   * Whether an object may be read: free, unless a field these checks read or quote holds a long
   * string another place holds, which is read and quoted again, and paid for by its length.
   */
  const fresh = (object: object, at: string): boolean => {
    let cost = 0;
    const fields = object as Readonly<Record<string, unknown>>;
    for (const field of ["layer", "style", "textStyle", "lineweight", "tag"] as const) {
      const value = fields[field];
      if (typeof value !== "string" || value.length < 256) continue;
      // Past the limit a long string is not looked up, which compares it with another.
      if (capped !== undefined) return false;
      // One that took the place of another of its length counts as read before.
      if (long.get(value) !== undefined || long.clashes(value)) {
        cost += Math.floor(value.length / 32);
      }
      long.set(value, true);
    }
    if (cost === 0 || spend(cost)) return true;
    if (capped === undefined) {
      capped = `at ${at}`;
      shared = true;
    }
    return false;
  };
  /** Whether a list may be read: once free, and again for another block when paid for. */
  const affordable = (list: unknown, of: string): boolean => {
    if (!Array.isArray(list)) return true;
    if (!read.has(list)) {
      read.add(list);
      return true;
    }
    if (spend(list.length)) return true;
    if (capped === undefined) {
      capped = `at the list${of || " of model space"}`;
      shared = true;
    }
    return false;
  };

  /**
   * `error` for the items of a list read again for another block, where each error pays for its
   * message by its length, as each error of the heights and scales does.
   */
  const paid =
    (at: string): typeof error =>
    (rule, message, about) => {
      if (spend(Math.floor(message.length / 32))) error(rule, message, about);
      else if (capped === undefined) {
        capped = `at ${at}`;
        shared = true;
      }
    };

  // Each entity and attribute definition: its layer, its text style and its pen.
  const lintEntities = (
    entities: unknown,
    where: { readonly block?: string; readonly layout?: string },
  ): void => {
    const of =
      where.block !== undefined
        ? ` of block ${shown(where.block)}`
        : where.layout !== undefined
          ? ` of layout ${shown(where.layout)}`
          : "";
    const again = Array.isArray(entities) && read.has(entities);
    if (!affordable(entities, of)) return;
    const say = again ? paid(`the list${of || " of model space"}`) : error;
    filled(entities).forEach((entity, i) => {
      if (!isEntity(entity) || !fresh(entity, `${entity.kind} #${i}${of}`)) return;
      const call = callOf(entities as object[], i);
      const about = {
        ...where,
        entity: i,
        ...(typeof entity.id === "string" ? { id: entity.id } : {}),
        ...(call ? { call } : {}),
      };
      const label = `${entity.kind} #${i}${of}`;
      if (where.block === undefined && layerKey(entity.layer) === "0") {
        say("layer-outside-standard", `${label}: ${DRAWN.layerZero}`, about);
      }
      if ((entity.kind === "text" || entity.kind === "paragraph") && !roleOf(entity.style)) {
        say("text-style-outside-standard", `${label}: ${DRAWN.textWithoutRole}`, about);
      }
      if (entity.kind === "leader" && entity.textStyle !== undefined && !roleOf(entity.textStyle)) {
        say("text-style-outside-standard", `${label}: ${DRAWN.leaderRoleAndText}`, about);
      }
      if (
        entity.kind === "insert" ||
        entity.kind.endsWith("-dimension") ||
        entity.kind === "leader"
      ) {
        return;
      }
      const weight = (entity as { readonly lineweight?: unknown }).lineweight;
      if (weight === undefined || weight === "ByLayer" || weight === "ByBlock") return;
      if (typeof weight === "number" && index.pens.has(written(weight))) return;
      say("pen-outside-standard", `${label}: ${penProblem(weight, index)}`, about);
    });
  };
  lintEntities(drawing.entities, {});
  for (const block of blocksByName.values()) {
    if (standardBlocks.has(layerKey(block.name))) continue;
    lintEntities(block.entities, { block: block.name });
    const of = ` of block ${shown(block.name)}`;
    const again = Array.isArray(block.attributes) && read.has(block.attributes);
    if (!affordable(block.attributes, of)) continue;
    const say = again ? paid(`the list${of}`) : error;
    filled(block.attributes).forEach((definition, i) => {
      if (!isDefinition(definition) || roleOf(definition.style)) return;
      if (!fresh(definition, `an attribute${of}`)) return;
      const call = callOf(block.attributes!, i);
      say(
        "text-style-outside-standard",
        `Block ${shown(block.name)}, attribute ${shown(definition.tag)}: ${DRAWN.textWithoutRole}`,
        { block: block.name, attribute: definition.tag, ...(call ? { call } : {}) },
      );
    });
  }
  for (const layout of layouts) lintEntities(layout.entities, { layout: layout.name });

  // The sheets.
  if (standard.sheetFiles === "sheet-per-file") {
    for (const layout of sound<Layout>(TYPED.layout, layoutList.slice(1))) {
      error("sheet-per-file", `Layout ${shown(layout.name)}: ${DRAWN.secondLayout}`, {
        layout: layout.name,
      });
    }
  }
  /** The first sound attribute definition of each tag a block has, worked out once a block. */
  const definitions = new Map<object, Map<string, AttributeDefinition>>();
  const definitionsOf = (block: Block): ReadonlyMap<string, AttributeDefinition> => {
    // Read once for each list, however many blocks share it.
    const list: unknown = block.attributes;
    const key = typeof list === "object" && list !== null ? list : block;
    let found = definitions.get(key);
    if (!found) {
      found = new Map();
      for (const a of filled(block.attributes)) {
        if (isDefinition(a) && !found.has(a.tag)) found.set(a.tag, a);
      }
      definitions.set(key, found);
    }
    return found;
  };
  /**
   * Each viewport as the checks read it, worked out once for each: nothing when it is not sound,
   * and otherwise its fields without its list of frozen layers, and that list apart. Only this
   * reads the list, and `spaceFor` once for each list. A list another viewport holds too is paid
   * for before this reads it again.
   */
  const checkedViewports = new WeakMap<
    object,
    { readonly viewport: Viewport; readonly frozen: readonly string[] } | null
  >();
  const checkedViewport = (viewport: unknown, where: string) => {
    if (typeof viewport !== "object" || viewport === null) return undefined;
    let checked = checkedViewports.get(viewport);
    if (checked === undefined) {
      const list: unknown = (viewport as { readonly frozenLayers?: unknown }).frozenLayers;
      checked = null;
      if (
        affordable(list, ` of frozen layers of ${where}`) &&
        isSound(TYPED.viewport, viewport, false)
      ) {
        // Each field is read by name, as the shape check reads it, so one it inherits counts.
        const { layer, corner, width, height, center, ratio, id, twist } = viewport as Viewport;
        const fields: Viewport = {
          layer,
          corner,
          width,
          height,
          center,
          ratio,
          ...(id === undefined ? {} : { id }),
          ...(twist === undefined ? {} : { twist }),
        };
        checked = { viewport: fields, frozen: Array.isArray(list) ? (list as string[]) : NONE };
      }
      checkedViewports.set(viewport, checked);
    }
    return checked ?? undefined;
  };
  /** Each sound viewport of a layout, with its index and what a diagnostic about it carries. */
  const viewportsOf = (layout: Layout) =>
    filled(layout.viewports).flatMap((viewport, i) => {
      const checked = checkedViewport(viewport, `viewport #${i} of layout ${shown(layout.name)}`);
      if (!checked) return [];
      const v = checked.viewport;
      const call = callOf(layout.viewports, i);
      const about = {
        layout: layout.name,
        viewport: i,
        ...(typeof v.id === "string" ? { id: v.id } : {}),
        ...(call ? { call } : {}),
      };
      return [{ viewport: v, i, about, name: `viewport #${i} of layout ${shown(layout.name)}` }];
    });
  for (const layout of layouts) {
    for (const { viewport, about, name } of viewportsOf(layout)) {
      if (typeof viewport.ratio !== "number" || index.scalesByRatio.has(written(viewport.ratio))) {
        continue;
      }
      error(
        "scale-outside-standard",
        `${name}: its ratio, ${viewport.ratio}, is no scale of the standard ${shown(standard.id)} version ${standard.version}. Show a view at one of its scales, as sheet.viewport(corner, width, height, { view, center })`,
        about,
      );
    }
    const paper = paperInfo(layout.paper);
    if (!paper) continue;
    const label = `Layout ${shown(layout.name)}`;
    const about = { layout: layout.name };
    const inserts = filled(layout.entities).flatMap((e, i) =>
      isEntity(e) && e.kind === "insert" ? [[i, e] as const] : [],
    );
    /** What a diagnostic about the layout's entity `i` carries. */
    const entityAbout = (i: number, id: string | undefined) => {
      const call = callOf(layout.entities, i);
      return {
        layout: layout.name,
        entity: i,
        ...(id === undefined ? {} : { id }),
        ...(call ? { call } : {}),
      };
    };
    /** The blocks and xrefs the layout's inserts name, whether or not another rule can read them. */
    const named = new Set<string>();
    for (const e of filled(layout.entities)) {
      const insert = (e as { readonly kind?: unknown; readonly block?: unknown } | null) ?? {};
      if (insert.kind === "insert" && typeof insert.block === "string") {
        named.add(layerKey(insert.block));
      }
    }
    const placed = (name: string | undefined): boolean =>
      name !== undefined && named.has(layerKey(name));
    const insertsOf = (name: string | undefined) =>
      name === undefined ? [] : inserts.filter(([, e]) => layerKey(e.block) === layerKey(name));
    const onPaper = index.formatsByPaper.get(layout.paper);
    if (!onPaper) {
      error(
        "sheet-format-outside-standard",
        `${label}: the standard ${shown(standard.id)} version ${standard.version} has no sheet format on the paper ${shown(layout.paper)}. Put the layout on one of its sheet formats, as layout(name, { sheetFormat }, draw)`,
        about,
      );
      continue;
    }
    // Among several on its paper, the layout's sheet formats are those whose title block it
    // inserts, and of those, the ones whose plot style table it has. Each step reads only the
    // title blocks the layout inserts.
    let blocks: readonly TitleBlockIndex[];
    if (onPaper.formats.length === 1) blocks = [onPaper.formats[0]!.block];
    else {
      const found = new Set<TitleBlockIndex>();
      for (const key of named) for (const b of onPaper.byPart.get(key) ?? []) found.add(b);
      blocks = [...found].sort(
        (a, b) => onPaper.byBlock.get(a)!.order - onPaper.byBlock.get(b)!.order,
      );
    }
    const table = layout.plotStyle ?? DEFAULT_PLOT_STYLE_TABLE;
    const hasTable = (b: TitleBlockIndex) => onPaper.byBlock.get(b)!.byTable.has(table as string);
    const held = blocks.length > 0 ? blocks.some(hasTable) : onPaper.tables.has(table as string);
    if (!held) {
      const first =
        blocks.length > 0 ? onPaper.byBlock.get(blocks[0]!)!.all[0]! : onPaper.formats[0]!;
      error(
        "sheet-format-outside-standard",
        `${label}: its plot style table is ${shown(table)}, and its sheet format gives it ${shown(first.table)}. Leave the plot style table to the sheet format`,
        about,
      );
    }
    const narrowed = held ? blocks.filter(hasTable) : blocks;
    // Sheet formats that share a title block are checked alike.
    if (narrowed.length !== 1) {
      warn(
        "sheet-format-ambiguous",
        `${label}: the standard has the sheet formats ${onPaper.listed} on the paper ${shown(layout.paper)}, and the layout ${narrowed.length === 0 ? "inserts the title block of none of them" : `inserts the title blocks ${listed(narrowed.map((b) => shown(b.id)))} of several of them`}, so lint cannot tell which it is on, and checks neither its drawing area, its title block nor its fields. Insert the title block of its sheet format with sheet.titleBlock()`,
        about,
      );
      continue;
    }
    const block = narrowed[0]!;
    const ofBlock = onPaper.byBlock.get(block)!;
    const formats = held ? ofBlock.byTable.get(table as string)! : ofBlock.all;
    const format = formatLabel(formats);

    // The viewports keep inside the drawing area and out of the title block's box.
    const [left, bottom, right, top] = block.titleBlock.drawingArea.map(written);
    const box = block.titleBlock.box?.map(written);
    for (const { viewport: v, about: where, name } of viewportsOf(layout)) {
      const x0 = written(v.corner[0]);
      const y0 = written(v.corner[1]);
      const x1 = written(x0 + written(v.width));
      const y1 = written(y0 + written(v.height));
      if (x0 < left! || y0 < bottom! || x1 > right! || y1 > top!) {
        error(
          "viewport-outside-drawing-area",
          `${name}: it reaches past the drawing area of the ${format}, [${block.titleBlock.drawingArea.join(", ")}]. Keep it inside, as the sheet's zones lay it out`,
          where,
        );
      }
      if (box && x0 < box[2]! && x1 > box[0]! && y0 < box[3]! && y1 > box[1]!) {
        error(
          "viewport-outside-drawing-area",
          `${name}: it reaches into the title block's box, [${block.titleBlock.box!.join(", ")}]. Keep it out of the title block`,
          where,
        );
      }
    }

    // The title block of its sheet format, and no other.
    const own = new Set(
      [block.blockName, block.xref?.name].flatMap((name) =>
        name === undefined ? [] : [layerKey(name)],
      ),
    );
    for (const [i, insert] of inserts) {
      const other = index.titleBlockParts.get(layerKey(insert.block));
      if (!other || own.has(layerKey(insert.block))) continue;
      error(
        "title-block-differs-from-standard",
        `insert #${i} of layout ${shown(layout.name)}: it places the title block ${shown(other)}, and the layout's ${format} ${formats.length === 1 ? "has" : "have"} the title block ${shown(block.id)}. Place its title block with sheet.titleBlock()`,
        entityAbout(i, insert.id),
      );
    }
    const absent = [
      ...(block.blockName !== undefined && !placed(block.blockName)
        ? [`its block ${shown(block.blockName)}`]
        : []),
      ...(block.xref !== undefined && !placed(block.xref.name)
        ? [`its xref ${shown(block.xref.name)}`]
        : []),
    ];
    if (absent.length > 0) {
      warn(
        "title-block-missing",
        `${label}: it has no insert of ${absent.join(" or ")}, of the title block ${shown(block.id)} of its ${format}. Place the title block with sheet.titleBlock()`,
        about,
      );
    }

    // The fields its insert fills.
    const [fieldIndex, fieldInsert] = insertsOf(block.blockName)[0] ?? [];
    const definitionBlock =
      block.blockName === undefined ? undefined : blocksByName.get(layerKey(block.blockName));
    if (fieldInsert === undefined || !definitionBlock) continue;
    const set = fieldInsert.attributes ?? {};
    const insertAbout = entityAbout(fieldIndex!, fieldInsert.id);
    for (const [tag, field] of Object.entries(block.titleBlock.fields)) {
      if (field.source !== "attribute") continue;
      const key = field.fills ?? tag;
      const value = Object.hasOwn(set, tag) ? set[tag] : undefined;
      if (typeof value !== "string") {
        warn(
          "title-block-field-unset",
          `${label}: the title block's field ${shown(tag)} is not set, so it shows its attribute's default. Give ${key} in createDrawing's fields or in titleBlock()`,
          insertAbout,
        );
        continue;
      }
      if (key === "number") {
        if (standard.sheetFiles === "one-drawing" && value !== layout.name) {
          error("layout", numberNotLayoutName(value, layout.name), insertAbout);
        }
        const problem =
          standard.sheetFiles === "sheet-per-file" ? sheetNumberProblem(value) : undefined;
        if (problem) error("sheet-per-file", sheetNumberOfFile(problem), insertAbout);
      }
      if (!field.box) continue;
      const definition = definitionsOf(definitionBlock).get(tag);
      if (!definition) continue;
      const style =
        definition.style === undefined ? undefined : stylesByKey.get(layerKey(definition.style));
      const corners = guarded(() => {
        const attribute = placeAttribute(definition, style, fieldInsert, definitionBlock.base);
        if (attribute.mirrored) return undefined;
        return measureText({
          value,
          height: attribute.height,
          font: style?.font ?? STANDARD_FONT,
          widthFactor: attribute.widthFactor,
          obliqueAngle: attribute.obliqueAngle,
          at: attribute.at,
          rotation: attribute.rotation,
          ...(definition.align === undefined ? {} : { align: definition.align }),
          ...(definition.valign === undefined ? {} : { valign: definition.valign }),
        }).corners;
      });
      if (!corners) continue;
      const [l, b, r, t] = field.box.map(written);
      if (
        corners.every(
          ([x, y]) => written(x) >= l! && written(x) <= r! && written(y) >= b! && written(y) <= t!,
        )
      ) {
        continue;
      }
      warn(
        "title-block-field-overflow",
        `${label}: the value ${shown(value)} of the title block's field ${shown(tag)} runs past its box, [${field.box.join(", ")}]. Make it shorter`,
        insertAbout,
      );
    }
  }

  // The heights texts plot at and the scales dimensions are shown at, as bounded work.
  const shownLayers = visibility(
    { ...drawing, layers, linetypes: [], textStyles: [], dimensionStyles: [], leaderStyles: [] },
    false,
  );
  const walk = lettering(blocksByName, shownLayers, stylesByKey, index.roleStyles, spend);
  /** The role of a text style as the drawing's discipline resolves it, worked out once a style. */
  const roles = new Map<Styled, { readonly id: string; readonly height: number } | null>();
  const roleIn = (styled: Styled | undefined) => {
    if (!styled?.role) return undefined;
    let role = roles.get(styled);
    if (role === undefined) {
      const [id, entry] = styled.role;
      const fields = resolved(entry, `the text role ${shown(id)}`);
      roles.set(styled, (role = fields ? { id, height: fields.height } : null));
    }
    return role ?? undefined;
  };
  const minHeight = written(standard.minTextHeight);
  const paperUnits = standard.paperUnits;
  /**
   * Adds an error of these checks about the entity `where` names, paid for by the length of its
   * message: one text or viewport may give many errors, each showing a value of the drawing.
   */
  const report = (rule: LintRule, message: string, about: Partial<Diagnostic>, where: string) => {
    if (spend(Math.floor(message.length / 32))) error(rule, message, about);
    else capped ??= `at ${where}`;
  };
  /** Checks the height a text plots at, `plotted`, `at` a viewport or on a layout. */
  const checkHeight = (text: Lettered, plotted: number, at: string, advice: string): void => {
    const height = written(plotted);
    const label = `${text.label}: ${text.what}`;
    const { role } = text;
    if (role && height !== written(role.height)) {
      report(
        "height-off-role",
        `${label} of the role ${shown(role.id)} plots ${round(plotted)} ${paperUnits} tall ${at}, and the role is ${round(role.height)} ${paperUnits}: ${advice}`,
        text.about,
        text.label,
      );
    }
    if (height < minHeight) {
      report(
        "height-below-standard",
        `${label} plots ${round(plotted)} ${paperUnits} tall ${at}, below the standard's least height of ${standard.minTextHeight} ${paperUnits}`,
        text.about,
        text.label,
      );
    }
  };
  // The first style of each name, as `styleRatio` measured it.
  const dimensionBox = boxer(
    [...stylesByKey.values()],
    [],
    undefined,
    undefined,
    undefined,
    [...shownStyles.values()],
    [...shownLeaderStyles.values()],
  );
  /**
   * The texts and the dimensions a space draws, with what a diagnostic says of each, leaving out
   * what is on the layers `frozenHere` holds the tokens of, as a viewport that freezes them does.
   */
  const lettered = (
    entities: unknown,
    where: { readonly layout?: string },
    frozenHere?: ReadonlySet<string>,
  ): { readonly texts: Lettered[]; readonly dimensions: Measured[] } => {
    const hidden = (ref: LayerRef) => walk.hidden(ref) || frozenHere?.has(ref.name) === true;
    const frozen = (ref: LayerRef) => walk.frozen(ref) || frozenHere?.has(ref.name) === true;
    const texts: Lettered[] = [];
    const dimensions: Measured[] = [];
    const of = where.layout !== undefined ? ` of layout ${shown(where.layout)}` : "";
    filled(entities).forEach((entity, i) => {
      if (!isEntity(entity) || capped !== undefined) return;
      const call = callOf(entities as object[], i);
      const about = {
        ...where,
        entity: i,
        ...(typeof entity.id === "string" ? { id: entity.id } : {}),
        ...(call ? { call } : {}),
      };
      const label = `${entity.kind} #${i}${of}`;
      /**
       * Keeps a text the entity draws, itself or through an insert at `placement`. It costs one
       * more for each 32 characters of its value and its tag, which it is measured and named by.
       */
      const keep = (
        text: Text | Paragraph,
        styled: Styled | undefined,
        placement: Placement | undefined,
        titleBlock: boolean,
        note?: { readonly scale: StandardScale | null; readonly roleless?: boolean },
      ) => {
        const tag = placement?.attribute;
        const size = (typeof text.value === "string" ? text.value.length : 0) + (tag?.length ?? 0);
        if (!spend(1 + Math.floor(size / 32))) throw CAPPED;
        const measured = guarded(() => placedText(text, styled?.style, placement?.matrix));
        if (!measured) return;
        const role = titleBlock || note?.roleless ? undefined : roleIn(styled);
        const what = note
          ? `The line ${shown(text.value)} of its note`
          : placement === undefined
            ? text.kind === "paragraph"
              ? "This paragraph"
              : "This text"
            : tag === undefined
              ? `The text ${shown(text.value)} of its block`
              : `The attribute ${shown(tag)} of its block`;
        texts.push({
          ...measured,
          ...(role ? { role } : {}),
          ...(note ? { scale: note.scale } : {}),
          about,
          label,
          what,
        });
      };
      try {
        if (entity.kind === "linear-dimension" || entity.kind === "aligned-dimension") {
          const style = styleRatio.get(walk.key(entity.style));
          if (!style || hidden({ name: walk.layer(entity.layer) })) return;
          // Its box reads its style's name, its own text and what its style gives every label.
          const reads = entity.style.length + (entity.text?.length ?? 0) + style.reads;
          if (!spend(1 + Math.floor(reads / 32))) throw CAPPED;
          const box = guarded(() => dimensionBox([entity]));
          if (dimensionBox.capped) throw CAPPED;
          if (box) {
            dimensions.push({
              about,
              label,
              box,
              style: style.shown,
              scale: style.scale,
              kind: "dimension",
            });
          }
          return;
        }
        if (entity.kind === "leader") {
          const style = leaderRatio.get(walk.key(entity.style));
          if (!style || hidden({ name: walk.layer(entity.layer) })) return;
          // Its box reads its style's name, each line of its note, its shafts and its text style.
          let reads = entity.style.length + style.reads + (entity.textStyle?.length ?? 0);
          for (const line of filled(entity.text)) {
            reads += (typeof line === "string" ? line.length : 0) + 1;
          }
          for (const shaft of filled(entity.shafts))
            reads += 32 * Math.max(1, filled(shaft).length);
          if (!spend(1 + Math.floor(reads / 32))) throw CAPPED;
          const box = guarded(() => dimensionBox([entity]));
          if (dimensionBox.capped) throw CAPPED;
          if (box) {
            dimensions.push({
              about,
              label,
              box,
              style: style.shown,
              scale: style.scale,
              kind: "leader",
            });
          }
          // Each line of its note is a text in its text style, at the height the leader draws it.
          if (!spend(1 + Math.floor(reads / 32))) throw CAPPED;
          const styled = walk.styled(walk.style(entity.textStyle ?? style.style.textStyle));
          const lines = guarded(() => leaderPicture(entity, style.style, styled?.style).lines);
          for (const line of lines ?? []) {
            const text: Text = {
              kind: "text",
              layer: entity.layer,
              at: line.at,
              height: line.height,
              value: line.value,
              rotation: 0,
              align: line.align,
            };
            // A note at its style's height, where that or the style's text style is not its
            // role's, is reported with the style. A height of its own is still held to a role.
            const roleless =
              entity.textHeight === undefined &&
              (style.offHeight || (entity.textStyle === undefined && style.offStyle));
            keep(text, styled, undefined, false, { scale: style.scale, roleless });
          }
          return;
        }
        if (entity.kind === "text" || entity.kind === "paragraph") {
          if (hidden({ name: walk.layer(entity.layer) })) return;
          keep(entity, walk.styled(walk.style(entity.style)), undefined, false);
          return;
        }
        if (entity.kind !== "insert") return;
        const placed = walk.insert(entity);
        if (placed === undefined || frozen({ name: placed.layer })) return;
        const titleBlock = standardBlocks.has(walk.key(entity.block));
        eachDrawn(placed, walk.blocks(), frozen, (drawn, placement) => {
          if ((drawn.kind !== "text" && drawn.kind !== "paragraph") || hidden(placement.layer)) {
            return;
          }
          keep(drawn, walk.styled(drawn.style), placement, titleBlock);
        });
      } catch (thrown) {
        if (thrown !== CAPPED) throw thrown;
        capped ??= `at ${label}`;
      }
    });
    return { texts, dimensions };
  };

  const scaleLabel = (ratio: number): string =>
    index.scalesByRatio.get(written(ratio))?.label ?? `a ratio of ${ratio}`;
  /**
   * What model space draws, and the grids that find it, for each set of layers a viewport
   * freezes, keyed by their tokens: model space is walked again for each set, and paid for again.
   */
  const spaces = new Map<string, ReturnType<typeof modelSpace>>();
  const modelSpace = (frozenHere?: ReadonlySet<string>) => {
    const space = guarded(() => lettered(drawing.entities, {}, frozenHere)) ?? {
      texts: [],
      dimensions: [],
    };
    return {
      space,
      nearText: grid(
        space.texts.map((t) => t.box),
        spend,
      ),
      nearDimension: grid(
        space.dimensions.map((d) => d.box),
        spend,
      ),
    };
  };
  spaces.set("", modelSpace());
  /** The set of layers each list of frozen layers names, with its key, read once a list. */
  const frozenSets = new WeakMap<object, { key: string; tokens: Set<string> }>();
  /**
   * What model space draws in a viewport, or undefined when reading its layers or walking model
   * space again for them reached the limit. A walk for a new set pays for each entity first.
   */
  const spaceFor = (list: readonly string[], where: string) => {
    let set = frozenSets.get(list);
    if (set === undefined) {
      const tokens = new Set<string>();
      try {
        for (const name of filled(list)) if (typeof name === "string") tokens.add(walk.layer(name));
      } catch (thrown) {
        if (thrown !== CAPPED) throw thrown;
        capped ??= `at ${where}`;
        return undefined;
      }
      frozenSets.set(list, (set = { key: [...tokens].sort().join(" "), tokens }));
    }
    const { key, tokens } = set;
    let found = spaces.get(key);
    if (!found) {
      const entities = Array.isArray(drawing.entities) ? filled(drawing.entities).length : 0;
      if (!spend(entities)) {
        capped ??= `at ${where}`;
        return undefined;
      }
      spaces.set(key, (found = modelSpace(tokens)));
    }
    return found;
  };
  for (const layout of layouts) {
    const paper = paperInfo(layout.paper);
    if (!paper || paper.units !== paperUnits) continue;
    const name = `layout ${shown(layout.name)}`;
    (filled(layout.viewports) as unknown[]).forEach((viewport, i) => {
      if (capped !== undefined || !units) return;
      const checked = checkedViewport(viewport, `viewport #${i} of ${name}`);
      if (!checked) return;
      const v = checked.viewport;
      if (viewportProblem(v, paper.units, units)) return;
      const view = validViewportView(v, paper.units, units);
      const inView = spaceFor(checked.frozen, `viewport #${i} of ${name}`);
      if (!inView) return;
      const { space, nearText, nearDimension } = inView;
      const shownIn = `in ${typeof v.id === "string" ? `viewport ${shown(v.id)}` : `viewport #${i} of ${name}`} at ${scaleLabel(v.ratio)}`;
      const found: number[] = [];
      nearText(view.box, (t) => found.push(t));
      for (const t of found.sort((a, b) => a - b)) {
        if (!spend(1)) break;
        const text = space.texts[t]!;
        if (!viewReaches(view, text.box)) continue;
        if (text.scale === undefined) {
          checkHeight(text, text.height * view.scale, shownIn, IN_VIEWPORT);
        } else if (text.scale && written(text.scale.ratio) === written(v.ratio)) {
          checkHeight(text, text.height * view.scale, shownIn, LEADER_NOTE);
        }
      }
      const dimensions: number[] = [];
      nearDimension(view.box, (d) => dimensions.push(d));
      for (const d of dimensions.sort((a, b) => a - b)) {
        if (!spend(1)) break;
        const dimension = space.dimensions[d]!;
        if (!viewReaches(view, dimension.box)) continue;
        if (dimension.scale && written(dimension.scale.ratio) === written(v.ratio)) continue;
        const style = dimension.scale
          ? `the ${dimension.kind} style ${dimension.style}, for ${dimension.scale.label}`
          : `the ${dimension.kind} style ${dimension.style}, which is for a layout`;
        report(
          `${dimension.kind}-off-scale`,
          `${dimension.label}: It is in ${style}, and is shown ${shownIn}. Draw it in the view of the viewport that shows it`,
          dimension.about,
          dimension.label,
        );
      }
      if (capped === undefined && work > most) capped = `at viewport #${i} of ${name}`;
    });
    if (capped !== undefined) break;
    const sheet = guarded(() => lettered(layout.entities, { layout: layout.name }));
    for (const text of sheet?.texts ?? []) {
      if (text.scale === undefined) checkHeight(text, text.height, `on ${name}`, ON_LAYOUT);
      else if (text.scale === null) checkHeight(text, text.height, `on ${name}`, LEADER_NOTE);
    }
    for (const dimension of sheet?.dimensions ?? []) {
      if (!dimension.scale) continue;
      report(
        `${dimension.kind}-off-scale`,
        `${dimension.label}: It is in the ${dimension.kind} style ${dimension.style}, for ${dimension.scale.label} in model space, and a layout plots it at 1:1. Give it the style of a layout: a ${dimension.kind} on a layout names no view`,
        dimension.about,
        dimension.label,
      );
    }
    if (capped !== undefined) break;
  }
  if (capped !== undefined || work > most) {
    warn(
      "standard-check-capped",
      shared
        ? `lint stopped its checks of the lists and the long strings that many places share at their limit, ${capped}: the drawing shares more than they look through, so an entity there or past that point may break the standard with no error`
        : `lint stopped its checks of the heights texts plot at and the scales dimensions are shown at their limit, ${capped ?? "at the end"}: the drawing draws more than they look through, so a text or a dimension past that point may break the standard with no error`,
    );
  }

  if (skipped.size > 0) {
    warn(
      "discipline-unknown",
      `lint does not know the drawing's discipline, so it checked none of the forms of ${listed([...skipped])}, which ${skipped.size === 1 ? "has" : "have"} fields by discipline. Give lint the drawing's discipline, as lint(drawing, { standard, discipline })`,
    );
  }
}

/** A text as a space draws it: its height and its box there, and what names it. */
interface Lettered {
  readonly height: number;
  readonly box: Box;
  /**
   * The role whose text style the text is in, as the drawing's discipline resolves it. A text of
   * the standard's title block has none, since no role sizes it, and nor has a line of a leader's
   * note at the height of a style that is not its role's, which the style's error reports.
   */
  readonly role?: { readonly id: string; readonly height: number };
  /**
   * For a line of a leader's note, the scale of the leader's style, or null for a layout's. Its
   * height is checked only where it plots at that scale: elsewhere `leader-off-scale` reports it.
   */
  readonly scale?: StandardScale | null;
  readonly about: Partial<Diagnostic>;
  /** The entity, as a message names it: `text #3 of layout "C-101"`. */
  readonly label: string;
  /** The text, as a message names it: `This text` or `The attribute "TITLE" of its block`. */
  readonly what: string;
}

/**
 * A dimension or a leader of a space, with its box and the scale of its style, or null for a
 * layout's.
 */
interface Measured {
  readonly about: Partial<Diagnostic>;
  readonly label: string;
  readonly box: Box;
  /** The name of its style, as a message shows it. */
  readonly style: string;
  readonly scale: StandardScale | null;
  readonly kind: "dimension" | "leader";
}

/**
 * The height a text is drawn at where `matrix` puts it, which an insert's scale changes, and the
 * box `boxer` gives it there: its capitals, and what its font draws below the baseline.
 */
function placedText(
  text: Text | Paragraph,
  style: TextStyle | undefined,
  matrix: Matrix | undefined,
): { readonly height: number; readonly box: Box } {
  let points: Point[];
  if (text.kind === "paragraph") {
    const { corners, frame } = measureParagraph(paragraphInStyle(text, style));
    points = [...(corners ?? frame)];
  } else {
    const { corners, descent } = measureText(inStyle(text, style));
    const [c0, c1, c2, c3] = corners;
    const below = descent / text.height || 0;
    points = [
      ...corners,
      [c0[0] - (c3[0] - c0[0]) * below, c0[1] - (c3[1] - c0[1]) * below],
      [c1[0] - (c2[0] - c1[0]) * below, c1[1] - (c2[1] - c1[1]) * below],
    ];
  }
  const placed = matrix ? points.map((p) => mapPoint(matrix, p)) : points;
  const xs = placed.map((p) => p[0]);
  const ys = placed.map((p) => p[1]);
  let height = text.height;
  if (matrix) {
    // The text's height across its baseline, which the matrix turns and stretches.
    const [a, b, c, d] = matrix;
    const turn = (text.rotation * Math.PI) / 180;
    const along = Math.hypot(
      a * Math.cos(turn) + c * Math.sin(turn),
      b * Math.cos(turn) + d * Math.sin(turn),
    );
    height = (text.height * Math.abs(a * d - b * c)) / along;
  }
  return { height, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

/**
 * The blocks the walk of an insert finds by name. Each block it enters spends one for the insert
 * and one for each item it holds, before the walk reads any, whatever their layer, so a tree of
 * blocks that each insert the one below twice ends at the limit.
 */
class Entered extends Map<string, Block> {
  readonly #spend: (cost: number) => boolean;

  constructor(blocks: Iterable<readonly [string, Block]>, spend: (cost: number) => boolean) {
    super(blocks);
    this.#spend = spend;
  }

  override get(key: string): Block | undefined {
    const block = super.get(key);
    if (block && !this.#spend(1 + block.entities.length + (block.attributes?.length ?? 0))) {
      throw CAPPED;
    }
    return block;
  }
}

/** A text style of the drawing, as the walk of an insert reads it, and the role it styles. */
interface Styled {
  readonly style: TextStyle | undefined;
  readonly role: readonly [id: string, role: StandardTextRole] | undefined;
}

/**
 * What the walk of an insert reads, made once a drawing. Each name of the drawing it reads, it
 * reads once: its `layerKey` is paid for by its length the first time, and the walk holds a short
 * token in its place. The blocks are made when an insert is first walked, and hold only what can
 * draw a text: a block that draws a text or an attribute, itself or through what it inserts, with
 * its texts, its attribute definitions and its inserts of such blocks. An insert of any other
 * block is not walked, and costs nothing.
 */
function lettering(
  blocks: ReadonlyMap<string, Block>,
  shownLayers: { hidden(layer: LayerRef): boolean; frozen(layer: LayerRef): boolean },
  styles: ReadonlyMap<string, TextStyle>,
  roleStyles: ReadonlyMap<string, readonly [id: string, role: StandardTextRole]>,
  spend: (cost: number) => boolean,
) {
  const keys = new Map<string, string>();
  const key = (name: string): string => {
    let found = keys.get(name);
    if (found === undefined) {
      if (!spend(1 + Math.floor(name.length / 32))) throw CAPPED;
      keys.set(name, (found = layerKey(name)));
    }
    return found;
  };
  /** The token of each layer by key, and the state of each by token. */
  const layerTokens = new Map<string, string>();
  const layerStates = new Map<string, { readonly hidden: boolean; readonly frozen: boolean }>();
  // Layer `0`'s token is "0", by which an entity of a block takes its insert's layer.
  const layer = (name: string): string => {
    const k = key(name);
    let token = layerTokens.get(k);
    if (token === undefined) {
      token = k === "0" ? "0" : `#${layerTokens.size}`;
      layerTokens.set(k, token);
      const ref = { name: k };
      layerStates.set(token, { hidden: shownLayers.hidden(ref), frozen: shownLayers.frozen(ref) });
    }
    return token;
  };
  const styleTokens = new Map<string, string>();
  const styled = new Map<string, Styled>();
  const style = (name: string | undefined): string | undefined => {
    if (name === undefined) return undefined;
    const k = key(name);
    let token = styleTokens.get(k);
    if (token === undefined) {
      styleTokens.set(k, (token = `#${styleTokens.size}`));
      styled.set(token, { style: styles.get(k), role: roleStyles.get(k) });
    }
    return token;
  };
  const placed = (insert: Insert, block: string): Insert => ({
    kind: "insert",
    layer: layer(insert.layer),
    block,
    at: insert.at,
    ...(insert.scale === undefined ? {} : { scale: insert.scale }),
    ...(insert.rotation === undefined ? {} : { rotation: insert.rotation }),
    ...(insert.attributes === undefined ? {} : { attributes: insert.attributes }),
  });
  const justified = (text: Text | AttributeDefinition) => ({
    ...(text.style === undefined ? {} : { style: style(text.style)! }),
    ...(text.align === undefined ? {} : { align: text.align }),
    ...(text.valign === undefined ? {} : { valign: text.valign }),
  });
  const textOf = (text: Text | Paragraph): Text | Paragraph =>
    text.kind === "paragraph"
      ? {
          kind: "paragraph",
          layer: layer(text.layer),
          at: text.at,
          height: text.height,
          value: text.value,
          rotation: text.rotation,
          ...(text.style === undefined ? {} : { style: style(text.style)! }),
          ...(text.width === undefined ? {} : { width: text.width }),
          ...(text.align === undefined ? {} : { align: text.align }),
          ...(text.valign === undefined ? {} : { valign: text.valign }),
          ...(text.lineSpacing === undefined ? {} : { lineSpacing: text.lineSpacing }),
          ...(text.lineSpacingStyle === undefined
            ? {}
            : { lineSpacingStyle: text.lineSpacingStyle }),
        }
      : {
          kind: "text",
          layer: layer(text.layer),
          at: text.at,
          height: text.height,
          value: text.value,
          rotation: text.rotation,
          ...justified(text),
        };
  const definitionOf = (definition: AttributeDefinition): AttributeDefinition => ({
    tag: definition.tag,
    value: definition.value,
    layer: layer(definition.layer),
    at: definition.at,
    height: definition.height,
    rotation: definition.rotation,
    ...justified(definition),
  });

  const tokens = new Map<Block, string>();
  let entered: Entered | undefined;
  const enter = (): Entered => {
    if (entered) return entered;
    // What each block holds that can draw a text, and the blocks that insert each.
    type Item =
      | { readonly text: Text | Paragraph }
      | { readonly insert: Insert; readonly block: Block };
    const held = new Map<Block, { items: Item[]; definitions: AttributeDefinition[] }>();
    const insertedBy = new Map<Block, Block[]>();
    const lettered: Block[] = [];
    // A list that many blocks share is read once, and what it inserts is paid for again.
    type Read = { items: Item[]; texts: boolean; inners: Block[] };
    const reads = new Map<unknown, Read>();
    const definitionLists = new Map<unknown, AttributeDefinition[]>();
    for (const block of blocks.values()) {
      let found = reads.get(block.entities);
      if (found) {
        if (found.inners.length > 0 && !spend(found.inners.length)) throw CAPPED;
      } else {
        const items: Item[] = [];
        const inners = new Set<Block>();
        let texts = false;
        for (const e of filled(block.entities)) {
          const kind = (e as { readonly kind?: unknown } | null | undefined)?.kind;
          if (
            (kind !== "text" && kind !== "paragraph" && kind !== "insert") ||
            !isSound(TYPED.entity, e, false)
          ) {
            continue;
          }
          const entity = e as Text | Paragraph | Insert;
          if (entity.kind === "text" || entity.kind === "paragraph") {
            items.push({ text: entity });
            texts = true;
            continue;
          }
          const inner = blocks.get(key(entity.block));
          if (inner === undefined) continue;
          items.push({ insert: entity, block: inner });
          inners.add(inner);
        }
        reads.set(block.entities, (found = { items, texts, inners: [...inners] }));
      }
      for (const inner of found.inners) {
        const by = insertedBy.get(inner);
        if (by) by.push(block);
        else insertedBy.set(inner, [block]);
      }
      let definitions = definitionLists.get(block.attributes);
      if (!definitions) {
        definitions = filled(block.attributes).filter((a) =>
          isSound(TYPED.attribute, a, false),
        ) as AttributeDefinition[];
        definitionLists.set(block.attributes, definitions);
      }
      held.set(block, { items: found.items, definitions });
      if (found.texts || definitions.length > 0) lettered.push(block);
    }
    const drawsText = new Set(lettered);
    for (let i = 0; i < lettered.length; i++) {
      for (const by of insertedBy.get(lettered[i]!) ?? []) {
        if (drawsText.has(by)) continue;
        drawsText.add(by);
        lettered.push(by);
      }
    }
    for (const block of drawsText) tokens.set(block, `#${tokens.size}`);
    const walked: [string, Block][] = [];
    const built = new Map<Item[], Entity[]>();
    const copies = new Map<AttributeDefinition[], AttributeDefinition[]>();
    const copied = (list: AttributeDefinition[]): AttributeDefinition[] => {
      let found = copies.get(list);
      if (!found) copies.set(list, (found = list.map(definitionOf)));
      return found;
    };
    for (const block of drawsText) {
      const { items, definitions } = held.get(block)!;
      let entities = built.get(items);
      if (!entities) {
        entities = [];
        for (const item of items) {
          if ("text" in item) entities.push(textOf(item.text));
          else if (drawsText.has(item.block))
            entities.push(placed(item.insert, tokens.get(item.block)!));
        }
        built.set(items, entities);
      }
      const token = tokens.get(block)!;
      walked.push([
        token,
        {
          name: token,
          ...(block.base === undefined ? {} : { base: block.base }),
          entities,
          attributes: copied(definitions),
        },
      ]);
    }
    return (entered = new Entered(walked, spend));
  };

  return {
    key,
    /** The token of a layer's name. */
    layer,
    /** The token of a text style's name. */
    style,
    styled: (token: string | undefined): Styled | undefined =>
      token === undefined ? undefined : styled.get(token),
    hidden: (layer: LayerRef): boolean => layerStates.get(layer.name)?.hidden === true,
    frozen: (layer: LayerRef): boolean => layerStates.get(layer.name)?.frozen === true,
    blocks: enter,
    /** An insert as the walk reads it, or undefined when its block draws no text. */
    insert: (insert: Insert): Insert | undefined => {
      enter();
      const block = blocks.get(key(insert.block));
      const token = block && tokens.get(block);
      return token === undefined ? undefined : placed(insert, token);
    },
  };
}

/** What `fn` gives, or undefined when it throws on a value another rule reports. */
function guarded<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function samePattern(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((n, i) => written(n) === written(b[i]!));
}

const round = (n: number): string => String(Number(n.toFixed(3)));

const listed = (items: readonly string[]): string =>
  items.length === 1 ? items[0]! : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** What is wrong with an entity's lineweight that is no pen of the standard. */
function penProblem(weight: unknown, index: Index): string {
  const lineweight = typeof weight === "number" ? `${weight} mm` : shown(weight);
  return index.pensListed === undefined
    ? `A lineweight of ${lineweight} is no pen of the standard, which has none. Give the entity the lineweight ByLayer`
    : `A lineweight of ${lineweight} is no pen of the standard. Its pens are ${index.pensListed} mm. Give the entity a pen`;
}

/** The one error for a standard that does not check: its first problem, and how many more. */
function notChecked(problems: readonly Problem[]): string {
  const [problem] = problems;
  const what = problem
    ? `${problem.item ? `${problem.item}: ` : ""}${problem.message}`
    : DRAWN.notAStandard;
  const more =
    problems.length > 1
      ? `, and ${problems.length - 1} more ${problems.length === 2 ? "problem" : "problems"}`
      : "";
  return `The standard given to lint does not check, so lint held the drawing to none of its rules: ${what}${more}`;
}

/** A title block of a standard, with the definitions of its closure as the drawing must hold them. */
interface TitleBlockIndex {
  readonly id: string;
  readonly titleBlock: StandardTitleBlock;
  readonly blockName: string | undefined;
  readonly xref: StandardTitleBlock["xref"];
  /** Each block, text style and linetype of its closure, by `layerKey`, with its JSON. */
  readonly blocks: ReadonlyMap<string, { readonly name: string; readonly json: string }>;
  readonly textStyles: ReadonlyMap<string, { readonly name: string; readonly json: string }>;
  readonly linetypes: ReadonlyMap<string, { readonly name: string; readonly json: string }>;
}

/** A standard as `lint` reads it: its entries by the keys the leading CAD app finds them by. */
interface Index {
  readonly layers: ReadonlyMap<string, readonly [name: string, layer: StandardLayer]>;
  readonly linetypes: ReadonlyMap<string, readonly [name: string, linetype: StandardLinetype]>;
  /** Each pen's lineweight, as written. */
  readonly pens: ReadonlySet<number>;
  /** Each pen and its lineweight, as a message lists them, or undefined when it has none. */
  readonly pensListed: string | undefined;
  readonly roles: ReadonlyMap<string, readonly [id: string, role: StandardTextRole]>;
  /** Each role by `layerKey` of its text style's name. */
  readonly roleStyles: ReadonlyMap<string, readonly [id: string, role: StandardTextRole]>;
  readonly scalesByRatio: ReadonlyMap<number, StandardScale>;
  /** The dimension style of the standard whose name in the leading CAD app has this `layerKey`, and its scale. */
  readonly dimensionStyle: StyleLookup<StandardDimensionStyle>;
  /** The leader style of the standard whose name in the leading CAD app has this `layerKey`, and its scale. */
  readonly leaderStyle: StyleLookup<StandardLeaderStyle>;
  readonly titleBlocks: readonly TitleBlockIndex[];
  /** The id of the title block each block or xref name of a title block places, by `layerKey`. */
  readonly titleBlockParts: ReadonlyMap<string, string>;
  /** Every text style of every title block's closure, by `layerKey`. */
  readonly titleBlockStyles: ReadonlySet<string>;
  /** The sheet formats on each paper. */
  readonly formatsByPaper: ReadonlyMap<string, OnPaper>;
}

/** A style of a standard by the `layerKey` of its name in the leading CAD app, with the scale the name gives. */
type StyleLookup<E> = (key: string) =>
  | {
      readonly id: string;
      readonly entry: E;
      readonly scale: readonly [id: string, scale: StandardScale] | undefined;
    }
  | undefined;

/** A sheet format of a standard, with its title block and its plot style table. */
interface Format {
  readonly id: string;
  readonly block: TitleBlockIndex;
  readonly table: string;
}

/** The sheet formats of a standard on one paper. */
interface OnPaper {
  /** In the standard's order. */
  readonly formats: readonly Format[];
  /** As a message lists them. */
  readonly listed: string;
  /** Every plot style table they have. */
  readonly tables: ReadonlySet<string>;
  /** The formats of each title block, all and by plot style table, and where its first is. */
  readonly byBlock: ReadonlyMap<
    TitleBlockIndex,
    {
      readonly order: number;
      readonly all: readonly Format[];
      readonly byTable: ReadonlyMap<string, readonly Format[]>;
    }
  >;
  /** The title blocks each block or xref name places, by `layerKey`. */
  readonly byPart: ReadonlyMap<string, ReadonlySet<TitleBlockIndex>>;
}

const labels = new WeakMap<readonly Format[], string>();

/** Sheet formats as a message names them: `sheet formats "arch-d" and "arch-d-color"`. */
function formatLabel(formats: readonly Format[]): string {
  let label = labels.get(formats);
  if (label === undefined) {
    const ids = formats.map((format) => shown(format.id));
    label = `sheet format${ids.length === 1 ? "" : "s"} ${listed(ids)}`;
    labels.set(formats, label);
  }
  return label;
}

const indexes = new WeakMap<Standard, Index>();

function indexOf(standard: Standard): Index {
  const found = indexes.get(standard);
  if (found) return found;
  const byKey = <T>(entries: Readonly<Record<string, T>>, key: (name: string) => string) =>
    new Map(Object.entries(entries).map(([name, entry]) => [key(name), [name, entry] as const]));
  const roles = byKey(standard.textRoles, idKey);
  const scales = Object.entries<StandardScale>(standard.scales);
  const pens = Object.entries(standard.pens).map(([id, pen]) => `${id} ${pen.lineweight}`);
  // A dimension style's name is its id in capitals on a layout, and with a scale's id after it in
  // model space, unless the standard gives it another. Ids are ASCII, so a name an id gives has
  // its style's key, `-` and its scale's key, and at most one style and scale give it:
  // defineStandard refuses two names the leading CAD app takes for one. A leader style's name is
  // made from its id the same way, and the standard gives it no other.
  const styles = Object.entries<StandardDimensionStyle>(standard.dimensionStyles);
  const styleKeys = new Map(
    styles.map(([id, entry]) => [layerKey(capitals(id)), { id, entry, scale: undefined }] as const),
  );
  const scaleKeys = new Map(scales.map((scale) => [layerKey(scale[0]), scale]));
  type Found = ReturnType<Index["dimensionStyle"]>;
  const givenNames = new Map<string, Found>();
  // Each place a style is given a name, as its id and its scale's key, or its id alone.
  const renamedAt = new Set<string>();
  const place = (id: string, scale: string | undefined) =>
    scale === undefined ? id : `${id}\u0000${layerKey(scale)}`;
  for (const [id, entry] of styles) {
    if (entry.layoutName !== undefined) {
      givenNames.set(layerKey(entry.layoutName), { id, entry, scale: undefined });
      renamedAt.add(place(id, undefined));
    }
    for (const [at, name] of Object.entries(entry.scaleNames ?? {})) {
      const scale = scaleKeys.get(layerKey(at));
      if (!scale) continue;
      givenNames.set(layerKey(name), { id, entry, scale });
      renamedAt.add(place(id, scale[0]));
    }
  }
  /** True when the standard gives the style another name than its id gives it there. */
  const renamed = (found: NonNullable<Found>): boolean =>
    renamedAt.has(place(found.id, found.scale?.[0]));
  const longest = (keys: Iterable<string>) => {
    let most = 0;
    for (const key of keys) most = Math.max(most, key.length);
    return most;
  };
  const longestStyle = longest(styleKeys.keys());
  const longestScale = longest(scaleKeys.keys());
  // A name the standard gives, or else the first name an id gives at a place it does not rename.
  const dimensionStyle: Index["dimensionStyle"] = (key) => {
    const given = givenNames.get(key);
    if (given) return given;
    const own = styleKeys.get(key);
    if (own && !renamed(own)) return own;
    if (key.length > longestStyle + 1 + longestScale) return undefined;
    for (
      let at = key.indexOf("-", 1);
      at > 0 && at <= longestStyle;
      at = key.indexOf("-", at + 1)
    ) {
      const style = styleKeys.get(key.slice(0, at));
      const scale = style && scaleKeys.get(key.slice(at + 1));
      if (scale && !renamed({ ...style, scale })) return { ...style, scale };
    }
    return undefined;
  };
  const leaderStyleKeys = new Map(
    Object.entries<StandardLeaderStyle>(standard.leaderStyles).map(
      ([id, entry]) => [layerKey(capitals(id)), { id, entry, scale: undefined }] as const,
    ),
  );
  const longestLeaderStyle = longest(leaderStyleKeys.keys());
  const leaderStyle: Index["leaderStyle"] = (key) => {
    const own = leaderStyleKeys.get(key);
    if (own || key.length > longestLeaderStyle + 1 + longestScale) return own;
    for (
      let at = key.indexOf("-", 1);
      at > 0 && at <= longestLeaderStyle;
      at = key.indexOf("-", at + 1)
    ) {
      const style = leaderStyleKeys.get(key.slice(0, at));
      const scale = style && scaleKeys.get(key.slice(at + 1));
      if (scale) return { ...style, scale };
    }
    return undefined;
  };
  const titleBlocks = Object.entries<StandardTitleBlock>(standard.titleBlocks).map(
    ([id, titleBlock]) => closureOf(id, titleBlock),
  );
  const titleBlocksById = new Map(titleBlocks.map((block) => [block.id, block]));
  const titleBlockParts = new Map<string, string>();
  for (const block of titleBlocks) {
    for (const name of [block.blockName, block.xref?.name]) {
      if (name !== undefined && !titleBlockParts.has(layerKey(name))) {
        titleBlockParts.set(layerKey(name), block.id);
      }
    }
  }
  const byPaper = new Map<string, Format[]>();
  for (const [id, format] of Object.entries<StandardSheetFormat>(standard.sheetFormats)) {
    const block = titleBlocksById.get(format.titleBlock)!;
    const list = byPaper.get(format.paper) ?? [];
    list.push({ id, block, table: format.plotStyle ?? standard.plotStyle });
    byPaper.set(format.paper, list);
  }
  const formatsByPaper = new Map<string, OnPaper>();
  for (const [paper, formats] of byPaper) {
    const byBlock = new Map<
      TitleBlockIndex,
      { order: number; all: Format[]; byTable: Map<string, Format[]> }
    >();
    const byPart = new Map<string, Set<TitleBlockIndex>>();
    formats.forEach((format, order) => {
      let own = byBlock.get(format.block);
      if (!own) {
        byBlock.set(format.block, (own = { order, all: [], byTable: new Map() }));
        for (const name of [format.block.blockName, format.block.xref?.name]) {
          if (name === undefined) continue;
          const placing = byPart.get(layerKey(name)) ?? new Set();
          byPart.set(layerKey(name), placing.add(format.block));
        }
      }
      own.all.push(format);
      const same = own.byTable.get(format.table) ?? [];
      same.push(format);
      own.byTable.set(format.table, same);
    });
    formatsByPaper.set(paper, {
      formats,
      listed: listed(formats.map((format) => shown(format.id))),
      tables: new Set(formats.map((format) => format.table)),
      byBlock,
      byPart,
    });
  }
  const index: Index = {
    layers: byKey(standard.layers, layerKey),
    linetypes: byKey(standard.linetypes, layerKey),
    pens: new Set(Object.values(standard.pens).map((pen) => written(pen.lineweight))),
    pensListed: pens.length === 0 ? undefined : listed(pens),
    roles,
    roleStyles: new Map([...roles.values()].map((role) => [layerKey(capitals(role[0])), role])),
    scalesByRatio: new Map(scales.map(([, scale]) => [written(scale.ratio), scale])),
    dimensionStyle,
    leaderStyle,
    titleBlocks,
    titleBlockParts,
    titleBlockStyles: new Set(titleBlocks.flatMap((block) => [...block.textStyles.keys()])),
    formatsByPaper,
  };
  indexes.set(standard, index);
  return index;
}

/**
 * A title block with its closure: its block, every block that block inserts, transitively, every
 * text style their texts and attributes name and every linetype their entities name.
 */
function closureOf(id: string, titleBlock: StandardTitleBlock): TitleBlockIndex {
  const blocks = new Map<string, { name: string; json: string }>();
  const textStyles = new Map<string, { name: string; json: string }>();
  const linetypes = new Map<string, { name: string; json: string }>();
  const drawing = titleBlock.block;
  if (drawing && titleBlock.blockName !== undefined) {
    const byName = blocksByKey(drawing.blocks);
    const queue = [byName.get(layerKey(titleBlock.blockName))].filter((b) => b !== undefined);
    const queued = new Set(queue);
    const styles = new Set<string>();
    const lines = new Set<string>();
    for (let i = 0; i < queue.length; i++) {
      const block = queue[i]!;
      blocks.set(layerKey(block.name), { name: block.name, json: canonical(block) });
      for (const e of block.entities) {
        if ((e.kind === "text" || e.kind === "paragraph") && e.style !== undefined) {
          styles.add(layerKey(e.style));
        }
        const linetype = (e as { readonly linetype?: string }).linetype;
        if (linetype !== undefined) lines.add(layerKey(linetype));
        const inner = e.kind === "insert" ? byName.get(layerKey(e.block)) : undefined;
        if (inner && !queued.has(inner)) {
          queued.add(inner);
          queue.push(inner);
        }
      }
      for (const a of block.attributes ?? [])
        if (a.style !== undefined) styles.add(layerKey(a.style));
    }
    for (const style of drawing.textStyles ?? []) {
      const key = layerKey(style.name);
      if (styles.has(key)) textStyles.set(key, { name: style.name, json: canonical(style) });
    }
    for (const linetype of drawing.linetypes ?? []) {
      const key = layerKey(linetype.name);
      if (lines.has(key)) linetypes.set(key, { name: linetype.name, json: canonical(linetype) });
    }
  }
  return {
    id,
    titleBlock,
    blockName: drawing ? titleBlock.blockName : undefined,
    xref: titleBlock.xref,
    blocks,
    textStyles,
    linetypes,
  };
}
