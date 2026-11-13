// The rules of a standard that `lint(drawing, { standard })` holds a drawing to: what the builder
// refuses under a standard, for a drawing made by other code or read from JSON, under the same
// rules, and what only the whole drawing shows, such as the height a text plots at in each
// viewport that shows it. AutoCAD opens a drawing that breaks them: they are the firm's.
import { DEFAULT_ARROWHEAD } from "../arrowheads.ts";
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
  Linetype,
  Point,
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
import { validViewportView } from "../layouts.ts";
import type { Diagnostic, LintRule } from "../lint.ts";
import { measureText } from "../measure.ts";
import { DEFAULT_PLOT_STYLE_TABLE, paperInfo } from "../papers.ts";
import {
  idKey,
  isStandardDimensionStyle,
  isStandardTextStyle,
  sheetNumberProblem,
  shown,
  viewportProblem,
} from "../rules.ts";
import { arrayProblem, isSound, TYPED, type Check } from "../shape.ts";
import { visibility } from "../svg.ts";
import { isUnits, modelLength } from "../units.ts";
import type {
  Standard,
  StandardDimensionStyle,
  StandardLayer,
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
 * characters, a dimension one more for each 32 characters its label reads, each insert walked
 * and each item of its block, each name read the first time, one more for each 32 characters,
 * each box a grid looks at, each text or dimension held against a viewport, and each error, one
 * more for each 32 characters of its message.
 */
const MAX_WORK = 1_000_000;

const IN_VIEWPORT =
  "it was sized for another scale. Draw it in the view of the viewport that shows it";
const ON_LAYOUT =
  "a text on a layout plots at its height. Draw it in its role, and insert its block at a scale of 1";

/** Thrown inside a walk to end it when the work reaches its limit. */
const CAPPED = Symbol("capped");

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
  const layers = sound<Layer>(TYPED.layer, listOf(drawing.layers));
  const linetypes = sound<Linetype>(TYPED.linetype, listOf(drawing.linetypes));
  const textStyles = sound<TextStyle>(TYPED.textStyle, listOf(drawing.textStyles));
  const dimensionStyles = sound<DimensionStyle>(
    TYPED.dimensionStyle,
    listOf(drawing.dimensionStyles),
  );
  const blocks = sound<Block>(TYPED.block, listOf(drawing.blocks));
  const xrefs = sound<Xref>(TYPED.xref, listOf(drawing.xrefs));
  const layoutList = listOf(drawing.layouts);
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
      ["precision", style.precision, writing.precision],
      ["prefix", style.prefix ?? "", writing.prefix ?? ""],
      ["suffix", style.suffix ?? "", writing.suffix ?? ""],
      ["suppressZeros", style.suppressZeros ?? "none", writing.suppressZeros ?? "none"],
      ["measurementScale", style.measurementScale ?? 1, writing.measurementScale],
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
    listOf(entities).forEach((entity, i) => {
      if (!isEntity(entity)) return;
      const call = callOf(entities as object[], i);
      const about = {
        ...where,
        entity: i,
        ...(typeof entity.id === "string" ? { id: entity.id } : {}),
        ...(call ? { call } : {}),
      };
      const label = `${entity.kind} #${i}${of}`;
      if (where.block === undefined && layerKey(entity.layer) === "0") {
        error("layer-outside-standard", `${label}: ${DRAWN.layerZero}`, about);
      }
      if (entity.kind === "text" && !roleOf(entity.style)) {
        error("text-style-outside-standard", `${label}: ${DRAWN.textWithoutRole}`, about);
      }
      if (entity.kind === "insert" || entity.kind.endsWith("-dimension")) return;
      const weight = (entity as { readonly lineweight?: unknown }).lineweight;
      if (weight === undefined || weight === "ByLayer" || weight === "ByBlock") return;
      if (typeof weight === "number" && index.pens.has(written(weight))) return;
      error("pen-outside-standard", `${label}: ${penProblem(weight, index)}`, about);
    });
  };
  lintEntities(drawing.entities, {});
  for (const block of blocksByName.values()) {
    if (standardBlocks.has(layerKey(block.name))) continue;
    lintEntities(block.entities, { block: block.name });
    listOf(block.attributes).forEach((definition, i) => {
      if (!isDefinition(definition) || roleOf(definition.style)) return;
      const call = callOf(block.attributes!, i);
      error(
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
  const definitions = new Map<Block, Map<string, AttributeDefinition>>();
  const definitionsOf = (block: Block): ReadonlyMap<string, AttributeDefinition> => {
    let found = definitions.get(block);
    if (!found) {
      found = new Map();
      for (const a of listOf(block.attributes)) {
        if (isDefinition(a) && !found.has(a.tag)) found.set(a.tag, a);
      }
      definitions.set(block, found);
    }
    return found;
  };
  /** Each sound viewport of a layout, with its index and what a diagnostic about it carries. */
  const viewportsOf = (layout: Layout) =>
    listOf(layout.viewports).flatMap((viewport, i) => {
      if (!isSound(TYPED.viewport, viewport, false)) return [];
      const v = viewport as Viewport;
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
    const inserts = listOf(layout.entities).flatMap((e, i) =>
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
    for (const e of listOf(layout.entities)) {
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
  let work = 0;
  let capped: string | undefined;
  const spend = (cost: number): boolean => {
    if (capped !== undefined) return false;
    work += cost;
    return work <= most;
  };
  const shownLayers = visibility(
    { ...drawing, layers, linetypes: [], textStyles: [], dimensionStyles: [] },
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
  const dimensionBox = boxer([...stylesByKey.values()], [], undefined, undefined, undefined, [
    ...shownStyles.values(),
  ]);
  /** The texts and the dimensions a space draws, with what a diagnostic says of each. */
  const lettered = (
    entities: unknown,
    where: { readonly layout?: string },
  ): { readonly texts: Lettered[]; readonly dimensions: Measured[] } => {
    const texts: Lettered[] = [];
    const dimensions: Measured[] = [];
    const of = where.layout !== undefined ? ` of layout ${shown(where.layout)}` : "";
    listOf(entities).forEach((entity, i) => {
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
        text: Text,
        styled: Styled | undefined,
        placement: Placement | undefined,
        titleBlock: boolean,
      ) => {
        const tag = placement?.attribute;
        const size = (typeof text.value === "string" ? text.value.length : 0) + (tag?.length ?? 0);
        if (!spend(1 + Math.floor(size / 32))) throw CAPPED;
        const measured = guarded(() => placedText(text, styled?.style, placement?.matrix));
        if (!measured) return;
        const role = titleBlock ? undefined : roleIn(styled);
        const what =
          placement === undefined
            ? "This text"
            : tag === undefined
              ? `The text ${shown(text.value)} of its block`
              : `The attribute ${shown(tag)} of its block`;
        texts.push({ ...measured, ...(role ? { role } : {}), about, label, what });
      };
      try {
        if (entity.kind === "linear-dimension" || entity.kind === "aligned-dimension") {
          const style = styleRatio.get(walk.key(entity.style));
          if (!style || walk.hidden({ name: walk.layer(entity.layer) })) return;
          // Its box reads its style's name, its own text and what its style gives every label.
          const reads = entity.style.length + (entity.text?.length ?? 0) + style.reads;
          if (!spend(1 + Math.floor(reads / 32))) throw CAPPED;
          const box = guarded(() => dimensionBox([entity]));
          if (box) dimensions.push({ about, label, box, style: style.shown, scale: style.scale });
          return;
        }
        if (entity.kind === "text") {
          if (walk.hidden({ name: walk.layer(entity.layer) })) return;
          keep(entity, walk.styled(walk.style(entity.style)), undefined, false);
          return;
        }
        if (entity.kind !== "insert") return;
        const placed = walk.insert(entity);
        if (placed === undefined || walk.frozen({ name: placed.layer })) return;
        const titleBlock = standardBlocks.has(walk.key(entity.block));
        eachDrawn(placed, walk.blocks(), walk.frozen, (drawn, placement) => {
          if (drawn.kind !== "text" || placement.frozen || walk.hidden(placement.layer)) return;
          keep(drawn, walk.styled(drawn.style), placement, titleBlock);
        });
      } catch (thrown) {
        // Blocks nested deeper than the stack end the walk as its limit does.
        if (thrown !== CAPPED && !(thrown instanceof RangeError)) throw thrown;
        capped ??= `at ${label}`;
      }
    });
    return { texts, dimensions };
  };

  const scaleLabel = (ratio: number): string =>
    index.scalesByRatio.get(written(ratio))?.label ?? `a ratio of ${ratio}`;
  const space = guarded(() => lettered(drawing.entities, {})) ?? { texts: [], dimensions: [] };
  const nearText = grid(
    space.texts.map((t) => t.box),
    spend,
  );
  const nearDimension = grid(
    space.dimensions.map((d) => d.box),
    spend,
  );
  for (const layout of layouts) {
    const paper = paperInfo(layout.paper);
    if (!paper || paper.units !== paperUnits) continue;
    const name = `layout ${shown(layout.name)}`;
    (listOf(layout.viewports) as unknown[]).forEach((viewport, i) => {
      if (capped !== undefined || !units || !isSound(TYPED.viewport, viewport, false)) return;
      const v = viewport as Viewport;
      if (viewportProblem(v, paper.units, units)) return;
      const view = validViewportView(v, paper.units, units);
      const shownIn = `in ${typeof v.id === "string" ? `viewport ${shown(v.id)}` : `viewport #${i} of ${name}`} at ${scaleLabel(v.ratio)}`;
      const found: number[] = [];
      nearText(view.box, (t) => found.push(t));
      for (const t of found.sort((a, b) => a - b)) {
        if (!spend(1)) break;
        const text = space.texts[t]!;
        checkHeight(text, text.height * view.scale, shownIn, IN_VIEWPORT);
      }
      const dimensions: number[] = [];
      nearDimension(view.box, (d) => dimensions.push(d));
      for (const d of dimensions.sort((a, b) => a - b)) {
        if (!spend(1)) break;
        const dimension = space.dimensions[d]!;
        if (dimension.scale && written(dimension.scale.ratio) === written(v.ratio)) continue;
        const style = dimension.scale
          ? `the dimension style ${dimension.style}, for ${dimension.scale.label}`
          : `the dimension style ${dimension.style}, which is for a layout`;
        report(
          "dimension-off-scale",
          `${dimension.label}: It is in ${style}, and is shown ${shownIn}. Draw it in the view of the viewport that shows it`,
          dimension.about,
          dimension.label,
        );
      }
      if (capped === undefined && work > most) capped = `at viewport #${i} of ${name}`;
    });
    if (capped !== undefined) break;
    const sheet = guarded(() => lettered(layout.entities, { layout: layout.name }));
    for (const text of sheet?.texts ?? []) checkHeight(text, text.height, `on ${name}`, ON_LAYOUT);
    for (const dimension of sheet?.dimensions ?? []) {
      if (!dimension.scale) continue;
      report(
        "dimension-off-scale",
        `${dimension.label}: It is in the dimension style ${dimension.style}, for ${dimension.scale.label} in model space, and a layout plots it at 1:1. Give it the style of a layout: a dimension on a layout names no view`,
        dimension.about,
        dimension.label,
      );
    }
    if (capped !== undefined) break;
  }
  if (capped !== undefined || work > most) {
    warn(
      "standard-check-capped",
      `lint stopped its checks of the heights texts plot at and the scales dimensions are shown at their limit, ${capped ?? "at the end"}: the drawing draws more than they look through, so a text or a dimension past that point may break the standard with no error`,
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
   * the standard's title block has none, since no role sizes it.
   */
  readonly role?: { readonly id: string; readonly height: number };
  readonly about: Partial<Diagnostic>;
  /** The entity, as a message names it: `text #3 of layout "C-101"`. */
  readonly label: string;
  /** The text, as a message names it: `This text` or `The attribute "TITLE" of its block`. */
  readonly what: string;
}

/** A dimension of a space, with its box and the scale of its style, or null for a layout's. */
interface Measured {
  readonly about: Partial<Diagnostic>;
  readonly label: string;
  readonly box: Box;
  /** The name of its style, as a message shows it. */
  readonly style: string;
  readonly scale: StandardScale | null;
}

/**
 * The height a text is drawn at where `matrix` puts it, which an insert's scale changes, and the
 * box `boxer` gives it there: its capitals, and what its font draws below the baseline.
 */
function placedText(
  text: Text,
  style: TextStyle | undefined,
  matrix: Matrix | undefined,
): { readonly height: number; readonly box: Box } {
  const { corners, descent } = measureText(style ? { ...text, ...style } : text);
  const [c0, c1, c2, c3] = corners;
  const below = descent / text.height || 0;
  const points: Point[] = [
    ...corners,
    [c0[0] - (c3[0] - c0[0]) * below, c0[1] - (c3[1] - c0[1]) * below],
    [c1[0] - (c2[0] - c1[0]) * below, c1[1] - (c2[1] - c1[1]) * below],
  ];
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
  const textOf = (text: Text): Text => ({
    kind: "text",
    layer: layer(text.layer),
    at: text.at,
    height: text.height,
    value: text.value,
    rotation: text.rotation,
    ...justified(text),
  });
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
    type Item = { readonly text: Text } | { readonly insert: Insert; readonly block: Block };
    const held = new Map<Block, { items: Item[]; definitions: AttributeDefinition[] }>();
    const insertedBy = new Map<Block, Block[]>();
    const lettered: Block[] = [];
    for (const block of blocks.values()) {
      const items: Item[] = [];
      let texts = false;
      for (const e of listOf(block.entities)) {
        const kind = (e as { readonly kind?: unknown } | null | undefined)?.kind;
        if ((kind !== "text" && kind !== "insert") || !isSound(TYPED.entity, e, false)) continue;
        const entity = e as Text | Insert;
        if (entity.kind === "text") {
          items.push({ text: entity });
          texts = true;
          continue;
        }
        const inner = blocks.get(key(entity.block));
        if (inner === undefined) continue;
        items.push({ insert: entity, block: inner });
        const by = insertedBy.get(inner);
        if (by) by.push(block);
        else insertedBy.set(inner, [block]);
      }
      const definitions = listOf(block.attributes).filter((a) =>
        isSound(TYPED.attribute, a, false),
      ) as AttributeDefinition[];
      held.set(block, { items, definitions });
      if (texts || definitions.length > 0) lettered.push(block);
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
    for (const block of drawsText) {
      const { items, definitions } = held.get(block)!;
      const entities: Entity[] = [];
      for (const item of items) {
        if ("text" in item) entities.push(textOf(item.text));
        else if (drawsText.has(item.block))
          entities.push(placed(item.insert, tokens.get(item.block)!));
      }
      const token = tokens.get(block)!;
      walked.push([
        token,
        {
          name: token,
          ...(block.base === undefined ? {} : { base: block.base }),
          entities,
          attributes: definitions.map(definitionOf),
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

/**
 * The items of a list up to its first empty slot, where the other rules stop, or none when it is
 * not a list. A list with no empty slot is given itself, so `callOf` finds its calls.
 */
function listOf(value: unknown): readonly unknown[] {
  if (arrayProblem(value, "") !== undefined) return [];
  const list = value as readonly unknown[];
  for (let i = 0; i < list.length; i++) {
    if (list[i] === undefined && !(i in list)) return list.slice(0, i);
  }
  return list;
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

/** A standard as `lint` reads it: its entries by the keys AutoCAD finds them by. */
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
  /** The dimension style of the standard whose AutoCAD name has this `layerKey`, and its scale. */
  readonly dimensionStyle: (key: string) =>
    | {
        readonly id: string;
        readonly entry: StandardDimensionStyle;
        readonly scale: readonly [id: string, scale: StandardScale] | undefined;
      }
    | undefined;
  readonly titleBlocks: readonly TitleBlockIndex[];
  /** The id of the title block each block or xref name of a title block places, by `layerKey`. */
  readonly titleBlockParts: ReadonlyMap<string, string>;
  /** Every text style of every title block's closure, by `layerKey`. */
  readonly titleBlockStyles: ReadonlySet<string>;
  /** The sheet formats on each paper. */
  readonly formatsByPaper: ReadonlyMap<string, OnPaper>;
}

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
  // model space. Ids are ASCII, so a name's key is its style's key, `-` and its scale's key, and
  // at most one style and scale give it: defineStandard refuses two names AutoCAD takes for one.
  const styleKeys = new Map(
    Object.entries<StandardDimensionStyle>(standard.dimensionStyles).map(
      ([id, entry]) => [layerKey(capitals(id)), { id, entry, scale: undefined }] as const,
    ),
  );
  const scaleKeys = new Map(scales.map((scale) => [layerKey(scale[0]), scale]));
  const longest = (keys: Iterable<string>) => {
    let most = 0;
    for (const key of keys) most = Math.max(most, key.length);
    return most;
  };
  const longestStyle = longest(styleKeys.keys());
  const longestScale = longest(scaleKeys.keys());
  const dimensionStyle: Index["dimensionStyle"] = (key) => {
    const own = styleKeys.get(key);
    if (own || key.length > longestStyle + 1 + longestScale) return own;
    for (
      let at = key.indexOf("-", 1);
      at > 0 && at <= longestStyle;
      at = key.indexOf("-", at + 1)
    ) {
      const style = styleKeys.get(key.slice(0, at));
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
        if (e.kind === "text" && e.style !== undefined) styles.add(layerKey(e.style));
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
