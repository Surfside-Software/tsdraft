import {
  definitionHandle,
  insertAttributeHandle,
  insertEndHandle,
  blockHandles,
  placeAttribute,
} from "./blocks.ts";
import { callOf, type CallSite } from "./callsite.ts";
import type {
  AttributeDefinition,
  Block,
  Drawing,
  DxfVersion,
  Entity,
  Layout,
  Viewport,
  Insert,
  Layer,
  Linetype,
  Point,
  TextStyle,
  Xref,
} from "./drawing.ts";
import { extents } from "./extents.ts";
import { written } from "./format.ts";
import { validIdHandle } from "./handles.ts";
import { validLayoutHandles, validViewportView } from "./layouts.ts";
import { paperInfo } from "./papers.ts";
import { isUnits } from "./units.ts";
import {
  arrayProblem,
  isObject,
  isSound,
  PLAIN_OBJECT,
  slotProblem,
  TYPED,
  WALKABLE,
  type Check,
} from "./shape.ts";
import { layerAuditKey, layerKey, layoutNameKey } from "./layers.ts";
import { STANDARD_TEXT_STYLE } from "./fonts.ts";
import { BUILT_IN_LINETYPES, builtInLinetype } from "./linetypes.ts";
import {
  arcIsWrittenAsPoint,
  arcProblem,
  ATTRIBUTES_SHAPE,
  attributeTagProblem,
  blockCycleProblem,
  blockNameProblem,
  blockTwinProblem,
  duplicateAttributeProblem,
  duplicateIdProblem,
  formatProblem,
  handleProblem,
  idHandleProblem,
  idKey,
  idProblem,
  isStandardTextStyle,
  layerColorProblem,
  layerFlagProblem,
  layerLinetypeProblem,
  layerNameProblem,
  layerStateProblem,
  layerTwinProblem,
  layoutNameProblem,
  layoutTwinProblem,
  lineweightProblem,
  linetypeNameProblem,
  linetypeProblem,
  linetypeScaleProblem,
  R12_ONLY,
  magnitudeProblem,
  paperProblem,
  placedAttributeProblem,
  plotStyleProblem,
  scaleProblem,
  shown,
  sizeProblem,
  textAlignProblem,
  textProblem,
  textStyleNameProblem,
  textStyleProblem,
  textWarning,
  undefinedAttributeProblem,
  undefinedBlockProblem,
  undefinedLinetypeProblem,
  undefinedTextStyleProblem,
  viewportEmptyWarning,
  viewportOffPaperWarning,
  viewportProblem,
  XREF_ATTRIBUTES,
  XREF_REFUSED_FIELDS,
  XREF_UNPLACED,
  xrefFieldProblem,
  xrefPathProblem,
  xrefTwinProblem,
} from "./rules.ts";

export type LintRule =
  | "format"
  | "units"
  | "layer-name"
  | "duplicate-layer"
  | "layer-color"
  | "undefined-layer"
  | "linetype"
  | "duplicate-linetype"
  | "undefined-linetype"
  | "lineweight"
  | "layer-state"
  | "geometry"
  | "text"
  | "text-style"
  | "duplicate-text-style"
  | "undefined-text-style"
  | "text-align"
  | "id"
  | "duplicate-id"
  | "id-handle"
  | "block"
  | "duplicate-block"
  | "undefined-block"
  | "block-cycle"
  | "layout"
  | "duplicate-layout"
  | "viewport"
  | "attribute"
  | "duplicate-attribute"
  | "undefined-attribute"
  | "xref"
  | "zero-length";

export interface Diagnostic {
  readonly rule: LintRule;
  /** An error means AutoCAD rejects, repairs or garbles the output. `toDXF` refuses to write it. */
  readonly severity: "error" | "warning";
  readonly message: string;
  /** The layer the problem is in, when it is a layer problem. */
  readonly layer?: string;
  /** The linetype the problem is in, when it is a problem with a linetype's definition. */
  readonly linetype?: string;
  /** The text style the problem is in, when it is a problem with a text style's definition. */
  readonly textStyle?: string;
  /**
   * The block the problem is in: a problem with the block's definition, with one of its
   * attribute definitions, or with one of its entities.
   */
  readonly block?: string;
  /** The tag of the attribute definition the problem is in. */
  readonly attribute?: string;
  /** The xref the problem is in, when it is a problem with an xref's name or path. */
  readonly xref?: string;
  /**
   * The layout the problem is in: a problem with the layout itself, with one of its viewports,
   * or with one of its entities.
   */
  readonly layout?: string;
  /** When it is a viewport problem, the viewport's index in the viewports of `layout`. */
  readonly viewport?: number;
  /**
   * When it is an entity problem, the entity's index: into the entities of `block` or of
   * `layout` when there is one, and into `drawing.entities` otherwise.
   */
  readonly entity?: number;
  /** The `id` of the entity or the viewport the problem is in, when it has one. */
  readonly id?: string;
  /**
   * For a problem with the shape of a value, the path of the item that holds it, such as
   * `entities[3]`, `blocks[0]`, `blocks[0].attributes[1]` or `layouts[0].viewports[1]`, or of a
   * list that is not one, such as `blocks`. Code that walks or draws the drawing has to leave the item out.
   */
  readonly item?: string;
  /**
   * The call in the drawing's code that the problem comes from. `lint` gives the call that drew
   * the entity when the drawing's builder recorded calls, and an error the builder throws gives
   * the call that threw. Missing where the JavaScript engine has no stack to read.
   */
  readonly call?: CallSite;
}

export interface LintOptions {
  /** The DXF version to check against. Defaults to the drawing's own. */
  readonly version?: DxfVersion;
}

/**
 * Checks a drawing against the rules AutoCAD enforces when it opens DXF.
 *
 * A drawing made with `createDrawing()` already passes the error rules for its
 * own DXF version, because the builder throws at the offending call. `lint`
 * matters when a `Drawing` was built by hand or by other code, when it is
 * exported as a different version than it was built for, and for warnings.
 *
 * It takes any plain data and never throws. A value that does not have the shape of a
 * `Drawing`, such as a list that is not an array, an entity of an unknown kind or a field of
 * the wrong type, is an error that gives the path to it, and no other rule is checked on that
 * object. A field no object of its type has is an error too.
 */
export function lint(drawing: Drawing, options: LintOptions = {}): Diagnostic[] {
  if (typeof drawing !== "object" || drawing === null || Array.isArray(drawing)) {
    return [{ rule: "format", severity: "error", message: `The drawing ${PLAIN_OBJECT}` }];
  }
  const version = options?.version ?? drawing.dxf;
  const out: Diagnostic[] = [];

  // A rule reads an object only once its shape is sound. A value of the wrong shape is reported
  // with the path to it and the item it is in, and no rule reads it.
  /**
   * Reports what is wrong with the shape of the value at `at`, and says whether a rule can read
   * it. A field nobody knows is reported, and the value is read all the same.
   */
  const malformed = (
    check: Check,
    value: unknown,
    at: string,
    rule: LintRule,
    about: Partial<Diagnostic> = {},
  ): boolean => {
    if (isSound(check, value)) return false;
    const problems: string[] = [];
    const extra: string[] = [];
    check(value, at, problems, extra);
    for (const message of extra) out.push({ rule, severity: "error", message, ...about });
    for (const message of problems) {
      out.push({ rule, severity: "error", message, ...about, ...(at ? { item: at } : {}) });
    }
    return problems.length > 0;
  };
  /**
   * Names the item at `at` in the errors added since `from`, when a field of it has the wrong
   * type. A rule has then reported the field, and what draws the drawing cannot read the item.
   */
  const mark = (typed: Check, value: unknown, at: string, from: number): void => {
    if (out.length === from || isSound(typed, value, false)) return;
    for (let i = from; i < out.length; i++) {
      const found = out[i]!;
      if (found.severity === "error" && found.item === undefined) out[i] = { ...found, item: at };
    }
  };
  /**
   * Gives `visit` each item of the list at `at`, up to its first empty slot, which is an error,
   * and marks what it reports for an item that fails `typed`.
   */
  const each = <T>(
    list: readonly T[],
    at: string,
    rule: LintRule,
    typed: Check,
    visit: (item: T, index: number) => void,
    about: Partial<Diagnostic> = {},
  ): void => {
    for (let i = 0; i < list.length; i++) {
      if (list[i] === undefined && !(i in list)) {
        out.push({ rule, severity: "error", message: slotProblem(at, i), ...about, item: at });
        return;
      }
      const from = out.length;
      visit(list[i]!, i);
      mark(typed, list[i], `${at}[${i}]`, from);
    }
  };
  /** The items of one of the drawing's lists, or none, with an error, when it is not a list. */
  const listed = <T>(
    field: "layers" | "entities" | "linetypes" | "textStyles" | "blocks" | "xrefs" | "layouts",
    rule: LintRule,
  ): readonly T[] => {
    const value: unknown = drawing[field];
    if (value === undefined && field !== "layers" && field !== "entities") return [];
    const problem = arrayProblem(value, field);
    if (problem) out.push({ rule, severity: "error", message: problem, item: field });
    return problem ? [] : (value as readonly T[]);
  };
  /** Names an entry of a list in a diagnostic, when its name is one. */
  const named = (field: "linetype" | "textStyle" | "block" | "xref", name: unknown) =>
    typeof name === "string" ? { [field]: name } : {};

  const format = formatProblem(drawing.format);
  if (format) out.push({ rule: "format", severity: "error", message: format });
  malformed(WALKABLE.drawing as Check, drawing, "", "format");

  if (!["in", "ft", "mm", "cm", "m"].includes(drawing.units)) {
    out.push({
      rule: "units",
      severity: "error",
      message: `Unknown units: ${shown(drawing.units)}`,
    });
  }

  const r12 = version === "R12";
  const scale = drawing.linetypeScale;
  if (scale !== undefined && (r12 ? scale !== 1 : linetypeScaleProblem(scale))) {
    const problem = r12 ? R12_ONLY.linetypes : linetypeScaleProblem(scale);
    out.push({
      rule: "linetype",
      severity: "error",
      message: `linetypeScale: ${problem}`,
      ...(typeof scale === "number" ? {} : { item: "linetypeScale" }),
    });
  }

  // AutoCAD compares linetype names as it compares layer names, and AUDIT reports a twin of a
  // built-in linetype as it reports any other.
  const linetypes = new Set<string>();
  const linetypesAudited = new Map<string, string>(
    BUILT_IN_LINETYPES.map((name) => [layerAuditKey(name), name]),
  );
  const linetypeList = listed<Linetype>("linetypes", "linetype");
  each(linetypeList, "linetypes", "linetype", TYPED.linetype, (linetype, i) => {
    if (malformed(WALKABLE.linetype, linetype, `linetypes[${i}]`, "linetype")) return;
    const error = (rule: LintRule, message: string) =>
      out.push({ rule, severity: "error", message, ...named("linetype", linetype.name) });
    const label = `Linetype ${shown(linetype.name)}`;
    if (r12) {
      error("linetype", `${label}: ${R12_ONLY.linetypes}`);
      return;
    }
    const problem = linetypeProblem(linetype.name, linetype.description, linetype.pattern);
    if (problem) error("linetype", `${label}: ${problem}`);
    if (typeof linetype.name !== "string") return;
    const key = layerKey(linetype.name);
    const auditKey = layerAuditKey(linetype.name);
    const twin = layerTwinProblem(
      linetype.name,
      linetypesAudited.get(auditKey) ?? linetype.name,
      "linetype",
    );
    if (linetypes.has(key)) {
      error(
        "duplicate-linetype",
        `${label} is defined twice. CAD ignores case in linetype names and keeps the first`,
      );
    } else if (twin) {
      error("duplicate-linetype", `${label}: ${twin}`);
    }
    linetypes.add(key);
    if (!linetypesAudited.has(auditKey)) linetypesAudited.set(auditKey, linetype.name);
  });
  /** What is wrong with a reference to a linetype, which AutoCAD discards a drawing over. */
  const missing = (name: unknown): string | undefined => {
    if (typeof name !== "string") return "a linetype is named by a string";
    const problem = linetypeNameProblem(name);
    if (problem) return `Linetype ${shown(name)}: ${problem}`;
    return builtInLinetype(name) || linetypes.has(layerKey(name))
      ? undefined
      : undefinedLinetypeProblem(name);
  };

  // AutoCAD compares text style names as it compares layer names.
  const textStyles = new Set<string>();
  const stylesByKey = new Map<string, TextStyle>();
  const unreadStyles = new Set<string>();
  const textStylesAudited = new Map<string, string>([
    [layerAuditKey(STANDARD_TEXT_STYLE), STANDARD_TEXT_STYLE],
  ]);
  const styleList = listed<TextStyle>("textStyles", "text-style");
  each(styleList, "textStyles", "text-style", TYPED.textStyle, (style, i) => {
    if (malformed(WALKABLE.textStyle, style, `textStyles[${i}]`, "text-style")) return;
    const error = (rule: LintRule, message: string) =>
      out.push({ rule, severity: "error", message, ...named("textStyle", style.name) });
    const label = `Text style ${shown(style.name)}`;
    if (r12) {
      error("text-style", `${label}: ${R12_ONLY.text}`);
      return;
    }
    const problem = textStyleProblem(style.name, style.font, style.widthFactor, style.obliqueAngle);
    if (problem) error("text-style", `${label}: ${problem}`);
    if (typeof style.name !== "string") return;
    const key = layerKey(style.name);
    const auditKey = layerAuditKey(style.name);
    const twin = layerTwinProblem(
      style.name,
      textStylesAudited.get(auditKey) ?? style.name,
      "text style",
    );
    if (textStyles.has(key)) {
      error(
        "duplicate-text-style",
        `${label} is defined twice. CAD ignores case in text style names and keeps the first`,
      );
    } else if (twin) {
      error("duplicate-text-style", `${label}: ${twin}`);
    }
    if (!textStyles.has(key)) {
      // A style whose numbers are not numbers is known by its name, and places no attribute.
      const numbers = [style.widthFactor ?? 1, style.obliqueAngle ?? 0];
      if (numbers.every((n) => typeof n === "number")) stylesByKey.set(key, style);
      else unreadStyles.add(key);
    }
    textStyles.add(key);
    if (!textStylesAudited.has(auditKey)) textStylesAudited.set(auditKey, style.name);
  });
  /** What is wrong with a text's style, justification or both, each with its rule. */
  const textProblems = (
    text: Pick<AttributeDefinition, "style" | "align" | "valign">,
  ): [LintRule, string][] => {
    const found: [LintRule, string][] = [];
    const name: unknown = text.style;
    if (name !== undefined) {
      if (typeof name !== "string") {
        found.push(["undefined-text-style", "a text style is named by a string"]);
      } else if (textStyleNameProblem(name)) {
        const problem = `Text style ${shown(name)}: ${textStyleNameProblem(name)}`;
        found.push(["undefined-text-style", problem]);
      } else if (!isStandardTextStyle(name)) {
        if (r12) found.push(["text-style", R12_ONLY.text]);
        else if (!textStyles.has(layerKey(name))) {
          found.push(["undefined-text-style", undefinedTextStyleProblem(name)]);
        }
      }
    }
    for (const [field, plain] of [
      ["align", "left"],
      ["valign", "baseline"],
    ] as const) {
      const value: unknown = text[field];
      if (value === undefined) continue;
      const problem =
        textAlignProblem(field, value) ?? (r12 && value !== plain ? R12_ONLY.text : undefined);
      if (problem) found.push(["text-align", problem]);
    }
    return found;
  };

  // AutoCAD looks layers up by one form of their names, and AUDIT compares another.
  const seen = new Set<string>();
  const audited = new Map<string, string>();
  each(listed<Layer>("layers", "format"), "layers", "format", TYPED.layer, (layer, i) => {
    if (malformed(WALKABLE.layer, layer, `layers[${i}]`, "format")) return;
    const error = (rule: LintRule, message: string) =>
      out.push({ rule, severity: "error", message, layer: layer.name });
    const nameProblem = layerNameProblem(layer.name, version);
    if (nameProblem) error("layer-name", `Layer ${shown(layer.name)}: ${nameProblem}`);
    const colorProblem = layerColorProblem(layer.color);
    if (colorProblem) error("layer-color", `Layer ${shown(layer.name)}: ${colorProblem}`);
    const label = `Layer ${shown(layer.name)}`;
    if (layer.linetype !== undefined) {
      const name: unknown = layer.linetype;
      if (r12) {
        if (typeof name !== "string" || builtInLinetype(name) !== "Continuous") {
          error("linetype", `${label}: ${R12_ONLY.linetypes}`);
        }
      } else {
        const absent = missing(name);
        if (absent) error("undefined-linetype", `${label}: ${absent}`);
        const problem = typeof name === "string" ? layerLinetypeProblem(name) : undefined;
        if (problem) error("linetype", `${label}: ${problem}`);
      }
    }
    if (layer.lineweight !== undefined) {
      const problem =
        lineweightProblem(layer.lineweight, "layer") ??
        (r12 && layer.lineweight !== "Default" ? R12_ONLY.lineweights : undefined);
      if (problem) error("lineweight", `${label}: ${problem}`);
    }
    for (const state of ["off", "frozen", "locked", "plot"] as const) {
      const flagProblem = layerFlagProblem(state, layer[state]);
      if (flagProblem) error("layer-state", `${label}: ${flagProblem}`);
    }
    const states = layer.off || layer.frozen || layer.locked || layer.plot === false;
    const stateProblem =
      r12 && states ? R12_ONLY.layerStates : layerStateProblem(layer.name, layer.frozen);
    if (stateProblem) error("layer-state", `${label}: ${stateProblem}`);
    const key = layerKey(layer.name);
    const auditKey = layerAuditKey(layer.name);
    const twinProblem = layerTwinProblem(layer.name, audited.get(auditKey) ?? layer.name);
    if (seen.has(key)) {
      error(
        "duplicate-layer",
        `Layer ${shown(layer.name)} is defined twice. CAD ignores case in layer names`,
      );
    } else if (twinProblem) {
      error("duplicate-layer", `Layer ${shown(layer.name)}: ${twinProblem}`);
    }
    seen.add(key);
    if (!audited.has(auditKey)) audited.set(auditKey, layer.name);
  });
  if (!seen.has("0")) {
    out.push({ rule: "undefined-layer", severity: "error", message: 'Layer "0" is missing' });
  }

  /** The first spelling of each id, by `idKey`. */
  const ids = new Map<string, string>();
  /** What took each handle that comes from a name: an id, or a description of anything else. */
  const handles = new Map<string, { readonly id?: string; readonly what: string }>();
  /** What is wrong with a second taker of a handle, or undefined when the handle is free. */
  const claim = (handle: string, what: string, id?: string): string | undefined => {
    const other = handles.get(handle);
    if (other === undefined) {
      handles.set(handle, id === undefined ? { what } : { id, what });
      return undefined;
    }
    return id !== undefined && other.id !== undefined
      ? idHandleProblem(id, other.id, handle)
      : handleProblem(what, other.what, handle);
  };
  const undefinedLayer = (layer: string): string | undefined => {
    if (seen.has(layerKey(layer))) return undefined;
    // AutoCAD adds a layer for a name it does not know. When AUDIT takes that name for a
    // declared layer's, it then reports the new layer as a duplicate of it.
    const twin = audited.get(layerAuditKey(layer));
    const hint = twin
      ? `. AutoCAD does not take it for layer ${shown(twin)}: it would add a layer, and its AUDIT would report a duplicate name`
      : "";
    return `layer ${shown(layer)} is not defined${hint}`;
  };

  // AutoCAD takes two block names for one where its AUDIT would call two layer names
  // duplicates, and an insert finds its block as an entity finds its layer.
  const blocks = new Map<string, Block>();
  const blocksAudited = new Map<string, string>();
  /** What the rules can read of each block that has a name, and where it is in the drawing. */
  const walked = new Map<
    Block,
    {
      readonly at: string;
      readonly entities: readonly Entity[];
      /** Each attribute definition by its index, or undefined for one no rule can read. */
      readonly definitions: readonly (AttributeDefinition | undefined)[];
      /** The tag of each definition that has one, read or not, so an insert can name it. */
      readonly tags: readonly (string | undefined)[];
      /** False for a base point no rule can read. */
      readonly based: boolean;
    }
  >();
  each(listed<Block>("blocks", "block"), "blocks", "block", TYPED.block, (block, i) => {
    const at = `blocks[${i}]`;
    // A block with a name stays one an insert can place, whatever else is wrong with it.
    const unread = malformed(WALKABLE.block, block, at, "block");
    if (!isObject(block)) return;
    const label = `Block ${shown(block.name)}`;
    const error = (rule: LintRule, message: string) =>
      out.push({
        rule,
        severity: "error",
        message: `${label}: ${message}`,
        ...named("block", block.name),
      });
    if (r12) {
      error("block", R12_ONLY.blocks);
      return;
    }
    const nameProblem = blockNameProblem(block.name);
    if (nameProblem) {
      error("block", nameProblem);
      return;
    }
    const auditKey = layerAuditKey(block.name);
    const first = blocksAudited.get(auditKey);
    if (first !== undefined) {
      error("duplicate-block", blockTwinProblem(block.name, first)!);
      return;
    }
    blocksAudited.set(auditKey, block.name);
    blocks.set(layerKey(block.name), block);
    const isList = (value: unknown) => !unread || arrayProblem(value, "") === undefined;
    const definitions: (AttributeDefinition | undefined)[] = [];
    const tags: (string | undefined)[] = [];
    each(
      block.attributes !== undefined && isList(block.attributes) ? block.attributes : [],
      `${at}.attributes`,
      "attribute",
      TYPED.attribute,
      (definition, index) => {
        const about = { block: block.name };
        const path = `${at}.attributes[${index}]`;
        const sound = !malformed(WALKABLE.attribute, definition, path, "attribute", about);
        definitions[index] = sound ? definition : undefined;
        const tag: unknown = isObject(definition) ? definition.tag : undefined;
        tags[index] = typeof tag === "string" ? tag : undefined;
      },
      { block: block.name },
    );
    const base: unknown = block.base;
    const based = !unread || base === undefined || isSound(WALKABLE.point, base);
    const entities = isList(block.entities) ? block.entities : [];
    walked.set(block, { at, entities, definitions, tags, based });
    if (based && base !== undefined) {
      const [x, y] = base as Point;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        error("block", "its base point must be finite numbers");
      } else {
        const problem = magnitudeProblem(x) ?? magnitudeProblem(y);
        if (problem) error("block", `its base point: ${problem}`);
      }
    }
    const handles = blockHandles(block.name);
    for (const handle of [handles.record, handles.begin, handles.end]) {
      const clash = claim(handle, `the block ${shown(block.name)}`);
      if (clash) error("id-handle", clash);
    }
  });

  // An xref is a block to AutoCAD, so it shares the blocks' names, and an insert finds it as
  // it finds a block.
  const xrefs = new Map<string, Xref>();
  const xrefsAudited = new Set<string>();
  const placedXrefs = new Set<Xref>();
  each(listed<Xref>("xrefs", "xref"), "xrefs", "xref", TYPED.xref, (xref, i) => {
    const name: unknown = (xref as Xref | null)?.name;
    const about = named("xref", name);
    const error = (rule: LintRule, message: string) =>
      out.push({ rule, severity: "error", message: `Xref ${shown(name)}: ${message}`, ...about });
    if (!isObject(xref)) {
      error("xref", "an xref must be an object with a name and a path");
      return;
    }
    malformed(WALKABLE.xref, xref, `xrefs[${i}]`, "xref", about);
    if (r12) {
      error("xref", R12_ONLY.xrefs);
      return;
    }
    const nameProblem = blockNameProblem(name);
    if (nameProblem) {
      error("xref", nameProblem);
      return;
    }
    const auditKey = layerAuditKey(xref.name);
    const first = blocksAudited.get(auditKey);
    if (first !== undefined) {
      const kind = xrefsAudited.has(auditKey) ? "xref" : "block";
      error("duplicate-block", xrefTwinProblem(xref.name, first, kind));
      return;
    }
    blocksAudited.set(auditKey, xref.name);
    xrefsAudited.add(auditKey);
    xrefs.set(layerKey(xref.name), xref);
    const pathProblem = xrefPathProblem(xref.path);
    if (pathProblem) error("xref", pathProblem);
    for (const field of XREF_REFUSED_FIELDS) {
      if ((xref as unknown as Record<string, unknown>)[field] !== undefined) {
        error("xref", xrefFieldProblem(field));
      }
    }
    const handles = blockHandles(xref.name);
    for (const handle of [handles.record, handles.begin, handles.end]) {
      const clash = claim(handle, `the xref ${shown(xref.name)}`);
      if (clash) error("id-handle", clash);
    }
  });

  /** Checks the attribute definitions of a block that passed the checks above. */
  const lintAttributes = (block: Block): void => {
    const tags = new Set<string>();
    const { at, definitions, tags: kept } = walked.get(block)!;
    definitions.forEach((definition, index) => {
      // A definition no rule can read keeps its tag, which still counts against a second one.
      if (!definition && kept[index] === undefined) return;
      const from = out.length;
      const tag: unknown = definition ? definition.tag : kept[index];
      const add = (rule: LintRule, severity: Diagnostic["severity"], problem: string) => {
        const call = block.attributes ? callOf(block.attributes, index) : undefined;
        out.push({
          rule,
          severity,
          message: `Block ${shown(block.name)}, attribute ${shown(tag)}: ${problem}`,
          block: block.name,
          ...(typeof tag === "string" ? { attribute: tag } : {}),
          ...(call ? { call } : {}),
        });
      };
      const tagProblem = attributeTagProblem(tag);
      if (tagProblem) add("attribute", "error", tagProblem);
      else if (tags.has(tag as string)) {
        add("duplicate-attribute", "error", duplicateAttributeProblem(tag as string));
      } else {
        tags.add(tag as string);
        const what = `the attribute ${shown(tag)} of the block ${shown(block.name)}`;
        const clash = claim(definitionHandle(block.name, tag as string), what);
        if (clash) add("id-handle", "error", clash);
      }
      if (!definition) return;
      for (const [field, value] of [
        ["its value", definition.value],
        ["its prompt", definition.prompt ?? ""],
      ] as const) {
        const problem = typeof value === "string" ? textProblem(value) : "must be a string";
        if (problem) add("text", "error", `${field}: ${problem}`);
        const warning = typeof value === "string" ? textWarning(value) : undefined;
        if (warning) add("text", "warning", `${field}: ${warning}`);
      }
      const layer = undefinedLayer(definition.layer);
      if (layer) add("undefined-layer", "error", layer);
      for (const problem of geometryProblems({ ...definition, kind: "text" })) {
        add("geometry", "error", problem);
      }
      for (const [rule, found] of textProblems(definition)) add(rule, "error", found);
      mark(TYPED.attribute, definition, `${at}.attributes[${index}]`, from);
    });
  };

  type Add = (rule: LintRule, severity: Diagnostic["severity"], problem: string) => void;
  /** Checks the id of an entity or a viewport and takes its handle. True for an id that is new. */
  const lintId = (id: unknown, add: Add): boolean => {
    if (id === undefined) return false;
    const problem = idProblem(id);
    const first = problem ? undefined : ids.get(idKey(id as string));
    if (problem) add("id", "error", problem);
    else if (first !== undefined) {
      add("duplicate-id", "error", duplicateIdProblem(id as string, first));
    } else {
      ids.set(idKey(id as string), id as string);
      const what = `the id ${shown(id)}`;
      const clash = claim(validIdHandle(id as string), what, id as string);
      if (clash) add("id-handle", "error", clash);
      return true;
    }
    return false;
  };

  /**
   * Checks the entities of model space, of a block, or of the layout `sheet`, whose path in the
   * drawing is `sheet.at`.
   */
  const lintEntities = (
    entities: readonly Entity[],
    block: Block | undefined,
    sheet?: { readonly name: string; readonly at: string },
  ): void => {
    const where = block
      ? ` of block ${shown(block.name)}`
      : sheet
        ? ` of layout ${shown(sheet.name)}`
        : "";
    const at = block
      ? `${walked.get(block)!.at}.entities`
      : sheet
        ? `${sheet.at}.entities`
        : "entities";
    const inBlock = block ? { block: block.name } : sheet ? { layout: sheet.name } : {};
    const lintEntity = (entity: Entity, index: number): void => {
      if (!isSound(WALKABLE.entity, entity)) {
        const call = callOf(entities, index);
        const about = { ...inBlock, entity: index, ...(call ? { call } : {}) };
        if (malformed(WALKABLE.entity, entity, `${at}[${index}]`, "format", about)) {
          // An insert no rule can read still places the xref it names.
          const name: unknown = isObject(entity) && entity.kind === "insert" && entity.block;
          const xref = typeof name === "string" ? xrefs.get(layerKey(name)) : undefined;
          if (xref && !blocks.has(layerKey(name as string))) placedXrefs.add(xref);
          return;
        }
      }
      const id: unknown = entity.id;
      const add = (rule: LintRule, severity: Diagnostic["severity"], problem: string) => {
        const call = callOf(entities, index);
        out.push({
          rule,
          severity,
          message: `${entity.kind} #${index}${where}: ${problem}`,
          ...inBlock,
          entity: index,
          ...(typeof id === "string" ? { id } : {}),
          ...(call ? { call } : {}),
        });
      };
      const named = lintId(id, add);
      const layer = undefinedLayer(entity.layer);
      if (layer) add("undefined-layer", "error", layer);
      const problems = geometryProblems(entity);
      for (const problem of problems) add("geometry", "error", problem);
      if (entity.kind === "insert") {
        if (r12) {
          add("block", "error", R12_ONLY.blocks);
          return;
        }
        const name: unknown = entity.block;
        const placed = typeof name === "string" ? blocks.get(layerKey(name)) : undefined;
        const xref = typeof name === "string" && !placed ? xrefs.get(layerKey(name)) : undefined;
        if (xref) placedXrefs.add(xref);
        if (typeof name !== "string")
          add("undefined-block", "error", "a block is named by a string");
        else if (!placed && !xref) {
          const twin = blocksAudited.get(layerAuditKey(name));
          const hint = twin ? `. Name it as the drawing does, ${shown(twin)}` : "";
          add("undefined-block", "error", `${undefinedBlockProblem(name)}${hint}`);
        }
        const set: unknown = entity.attributes === undefined ? {} : entity.attributes;
        if (typeof set !== "object" || set === null || Array.isArray(set)) {
          add("undefined-attribute", "error", ATTRIBUTES_SHAPE);
          return;
        }
        if (xref) {
          if (Object.keys(set).length > 0) add("undefined-attribute", "error", XREF_ATTRIBUTES);
          return;
        }
        const read = placed ? walked.get(placed)! : undefined;
        const tags = new Set<string>();
        for (const tag of read?.tags ?? []) if (tag !== undefined) tags.add(tag);
        // What the insert makes of each attribute, once the insert itself is sound.
        if (placed && read?.based && problems.length === 0) {
          for (const definition of read.definitions) {
            if (
              !definition ||
              typeof definition.tag !== "string" ||
              (typeof definition.style === "string" &&
                unreadStyles.has(layerKey(definition.style))) ||
              geometryProblems({ ...definition, kind: "text" }).length > 0
            )
              continue;
            const style =
              typeof definition.style === "string"
                ? stylesByKey.get(layerKey(definition.style))
                : undefined;
            const problem = placedAttributeProblem(
              definition.tag,
              placeAttribute(definition, style, entity, placed.base),
            );
            if (problem) add("geometry", "error", problem);
          }
        }
        for (const [tag, value] of Object.entries(set as Record<string, unknown>)) {
          if (placed && !tags.has(tag)) {
            add("undefined-attribute", "error", undefinedAttributeProblem(tag, placed.name));
          }
          const problem = typeof value === "string" ? textProblem(value) : "must be a string";
          if (problem) add("text", "error", `attribute ${shown(tag)}: ${problem}`);
          const warning = typeof value === "string" ? textWarning(value) : undefined;
          if (warning) add("text", "warning", `attribute ${shown(tag)}: ${warning}`);
        }
        if (named && tags.size > 0) {
          const insert = `the insert ${shown(id)}`;
          const taken = [...tags].map((tag): [string, string] => [
            insertAttributeHandle(id as string, tag),
            `the attribute ${shown(tag)} of ${insert}`,
          ]);
          taken.push([insertEndHandle(id as string), `the end of the attributes of ${insert}`]);
          for (const [handle, what] of taken) {
            const clash = claim(handle, what);
            if (clash) add("id-handle", "error", clash);
          }
        }
        return;
      }
      if (entity.linetype !== undefined) {
        const name: unknown = entity.linetype;
        const problem = r12
          ? typeof name === "string" && builtInLinetype(name) === "ByLayer"
            ? undefined
            : R12_ONLY.entityStyle
          : missing(name);
        if (problem) add(r12 ? "linetype" : "undefined-linetype", "error", problem);
      }
      if (entity.lineweight !== undefined) {
        const problem =
          lineweightProblem(entity.lineweight, "entity") ??
          (r12 && entity.lineweight !== "ByLayer" ? R12_ONLY.entityStyle : undefined);
        if (problem) add("lineweight", "error", problem);
      }
      if (entity.kind === "text") {
        const problem = textProblem(entity.value);
        if (problem) add("text", "error", problem);
        for (const [rule, found] of textProblems(entity)) add(rule, "error", found);
        const warning = textWarning(entity.value);
        if (warning) add("text", "warning", warning);
      }
      // A shape with a geometry error has no length worth a second message.
      const collapsed = problems.length === 0 ? zeroLength(entity) : undefined;
      if (collapsed) add("zero-length", "warning", collapsed);
    };
    each(entities, at, "format", TYPED.entity, lintEntity, inBlock);
  };
  for (const block of blocks.values()) {
    lintAttributes(block);
    lintEntities(walked.get(block)!.entities, block);
  }
  lintEntities(listed<Entity>("entities", "format"), undefined);

  // AutoCAD compares layout names by a table of its own, which `layoutNameKey` holds.
  const layoutNames = new Map<string, string>();
  /** The box of what model space holds, worked out when a viewport first asks. */
  let modelBox: readonly [number, number, number, number] | null | undefined;
  const boxOfModel = (): readonly [number, number, number, number] | null => {
    if (modelBox === undefined) {
      try {
        const model: unknown = drawing.entities;
        modelBox =
          !Array.isArray(model) || model.length === 0
            ? null
            : extents(drawing.entities, drawing.textStyles, drawing.blocks);
      } catch {
        // A drawing whose entities cannot be measured has errors of its own above.
        modelBox = null;
      }
    }
    return modelBox;
  };
  each(listed<Layout>("layouts", "layout"), "layouts", "layout", TYPED.layout, (layout, i) => {
    const at = `layouts[${i}]`;
    // A layout with a name keeps it, whatever else is wrong with it.
    const unread = malformed(WALKABLE.layout, layout, at, "layout");
    if (!isObject(layout)) return;
    const { name } = layout;
    const inLayout = typeof name === "string" ? { layout: name } : {};
    const error = (rule: LintRule, message: string) =>
      out.push({
        rule,
        severity: "error",
        message: `Layout ${shown(name)}: ${message}`,
        ...inLayout,
      });
    if (r12) {
      error("layout", R12_ONLY.layouts);
      return;
    }
    const nameProblem = layoutNameProblem(name);
    if (nameProblem) {
      error("layout", nameProblem);
      return;
    }
    const first = layoutNames.get(layoutNameKey(name));
    if (first !== undefined) {
      error("duplicate-layout", layoutTwinProblem(name, first)!);
      return;
    }
    layoutNames.set(layoutNameKey(name), name);
    // A layout on no paper cannot be drawn, so the error names it as the item to leave out.
    const problem = paperProblem(layout.paper);
    if (problem) {
      const message = `Layout ${shown(name)}: ${problem}`;
      out.push({ rule: "layout", severity: "error", message, ...inLayout, item: at });
    }
    if (layout.plotStyle !== undefined) {
      const styleProblem = plotStyleProblem(layout.plotStyle);
      if (styleProblem) error("layout", styleProblem);
    }
    for (const handle of Object.values(validLayoutHandles(name))) {
      const clash = claim(handle, `the layout ${shown(name)}`);
      if (clash) error("id-handle", clash);
    }
    const paper = problem ? undefined : paperInfo(layout.paper);
    const isList = (value: unknown) => !unread || arrayProblem(value, "") === undefined;
    const viewports = isList(layout.viewports) ? layout.viewports : [];
    const lintViewport = (viewport: Viewport, index: number): void => {
      const call = callOf(viewports, index);
      const about = { layout: name, viewport: index, ...(call ? { call } : {}) };
      const path = `${at}.viewports[${index}]`;
      if (malformed(WALKABLE.viewport, viewport, path, "viewport", about)) return;
      const id: unknown = viewport.id;
      const add: Add = (rule, severity, found) => {
        out.push({
          rule,
          severity,
          message: `viewport #${index} of layout ${shown(name)}: ${found}`,
          ...about,
          ...(typeof id === "string" ? { id } : {}),
        });
      };
      lintId(id, add);
      const layer: unknown = viewport.layer;
      const absent =
        typeof layer === "string" ? undefinedLayer(layer) : "a layer is named by a string";
      if (absent) add("undefined-layer", "error", absent);
      // Without its paper a viewport is judged as one on a paper in inches.
      const units = isUnits(drawing.units) ? drawing.units : "in";
      const found = viewportProblem(viewport, paper?.units ?? "in", units);
      if (found) {
        // A viewport with no view cannot be drawn, so the error names it.
        add("viewport", "error", found);
        out[out.length - 1] = { ...out.at(-1)!, item: path };
        return;
      }
      if (!paper) return;
      const view = validViewportView(viewport, paper.units, units);
      const half = [view.width / 2, view.height / 2] as const;
      const offPaper = viewportOffPaperWarning(
        [
          view.paperCenter[0] - half[0],
          view.paperCenter[1] - half[1],
          view.paperCenter[0] + half[0],
          view.paperCenter[1] + half[1],
        ],
        paper,
      );
      if (offPaper) add("viewport", "warning", offPaper);
      const model = boxOfModel();
      const [minX, minY, maxX, maxY] = view.box;
      if (!model || model[0] > maxX || model[2] < minX || model[1] > maxY || model[3] < minY) {
        add("viewport", "warning", viewportEmptyWarning(view.box));
      }
    };
    each(viewports, `${at}.viewports`, "viewport", TYPED.viewport, lintViewport, inLayout);
    lintEntities(isList(layout.entities) ? layout.entities : [], undefined, { name, at });
  });

  for (const xref of xrefs.values()) {
    if (placedXrefs.has(xref)) continue;
    out.push({
      rule: "xref",
      severity: "warning",
      message: `Xref ${shown(xref.name)}: ${XREF_UNPLACED}`,
      xref: xref.name,
    });
  }

  // A block that holds an insert of itself, directly or through the blocks it inserts.
  const inserted = (block: Block): Block[] =>
    walked.get(block)!.entities.flatMap((entity) => {
      const name: unknown =
        (entity as Entity | null)?.kind === "insert" ? (entity as Insert).block : undefined;
      const found = typeof name === "string" ? blocks.get(layerKey(name)) : undefined;
      return found ? [found] : [];
    });
  for (const block of blocks.values()) {
    const path = pathBack(block, inserted);
    if (path) {
      const message = blockCycleProblem(path.map((b) => b.name));
      out.push({ rule: "block-cycle", severity: "error", message, block: block.name });
    }
  }

  return out;
}

/**
 * An error that refuses a drawing because of what `lint` found in it. `toDXF`
 * throws it when a drawing has lint errors for the version being written, `fromJSON`
 * when the JSON is not a drawing it can read, and the builder's `layer`, `linetype`,
 * `textStyle`, `block`, `attribute`, `xref` and entity methods at a call that breaks a rule, with that one problem as the
 * message. Other code can throw it to refuse a drawing for its own purpose. Its
 * message lists the first 10 problems and names no file format.
 */
export class DrawingError extends Error {
  /** Every problem the drawing was refused for, including those the message leaves out. */
  readonly diagnostics: readonly Diagnostic[];

  /**
   * @param diagnostics - The problems to refuse the drawing for, as `lint` returns them.
   * @param message - Defaults to a list of the first 10 problems.
   */
  constructor(diagnostics: readonly Diagnostic[], message?: string) {
    const count = diagnostics.length === 1 ? "1 problem" : `${diagnostics.length} problems`;
    const shown = diagnostics.slice(0, 10).map((d) => `- ${d.message}`);
    const more = diagnostics.length > 10 ? [`- and ${diagnostics.length - 10} more`] : [];
    super(message ?? [`The drawing has ${count}:`, ...shown, ...more].join("\n"));
    this.name = "DrawingError";
    this.diagnostics = diagnostics;
  }
}

/**
 * The shortest way from a block through the blocks it inserts back to itself, the block first
 * and last, or undefined when it holds no insert of itself.
 */
function pathBack<T>(start: T, next: (from: T) => readonly T[]): T[] | undefined {
  const cameFrom = new Map<T, T>();
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i]!;
    for (const to of next(from)) {
      if (to === start) {
        const path = [start];
        for (let at = from; at !== start; at = cameFrom.get(at)!) path.unshift(at);
        return [start, ...path];
      }
      if (!cameFrom.has(to)) {
        cameFrom.set(to, from);
        queue.push(to);
      }
    }
  }
  return undefined;
}

function geometryProblems(e: Entity): string[] {
  const out: string[] = [];
  const finite = (label: string, ...values: number[]) => {
    if (!values.every(Number.isFinite)) {
      out.push(`${label} must be finite numbers`);
      return;
    }
    const problem = values.map(magnitudeProblem).find((p) => p !== undefined);
    if (problem) out.push(`${label}: ${problem}`);
  };
  const size = (label: string, value: number) => {
    const problem = Number.isFinite(value) ? sizeProblem(value) : "This value must be finite";
    if (problem) out.push(`${label}: ${problem}`);
  };
  switch (e.kind) {
    case "line":
      finite("its points", ...e.from, ...e.to);
      break;
    case "polyline":
      if (e.points.length < 2) out.push("a polyline needs at least 2 points");
      // A loop, because a polyline can have more points than a call can take arguments.
      if (!e.points.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) {
        out.push("its points must be finite numbers");
      } else {
        for (const [x, y] of e.points) {
          const problem = magnitudeProblem(x) ?? magnitudeProblem(y);
          if (!problem) continue;
          out.push(`its points: ${problem}`);
          break;
        }
      }
      break;
    case "circle":
      finite("its center", ...e.center);
      size("radius", e.radius);
      break;
    case "arc":
      finite("its center", ...e.center);
      size("radius", e.radius);
      if (![e.startAngle, e.endAngle].every((a) => Number.isFinite(a) && a >= 0 && a < 360)) {
        out.push("its angles must be from 0 up to 360");
      } else if (e.startAngle === e.endAngle) {
        out.push("its start and end angles must differ");
      } else {
        const problem = arcProblem(e.startAngle, e.endAngle);
        if (problem) out.push(problem);
      }
      break;
    case "text":
      finite("its position and rotation", ...e.at, e.rotation);
      size("height", e.height);
      break;
    case "insert": {
      finite("its position and rotation", ...e.at, e.rotation ?? 0);
      const scale: unknown = e.scale;
      if (scale === undefined) break;
      if (!Array.isArray(scale) || scale.length !== 2) {
        out.push("its scale must be [x, y]");
        break;
      }
      const problem = scaleProblem(scale[0]) ?? scaleProblem(scale[1]);
      if (problem) out.push(`its scale: ${problem}`);
      break;
    }
  }
  return out;
}

/** Says how a valid entity ends up with no length in the file, or returns undefined when it has one. */
function zeroLength(e: Entity): string | undefined {
  const rounded = "once it is rounded to the 6 decimals tsdraft writes";
  switch (e.kind) {
    case "line":
      if (same(e.from, e.to)) return "the line has no length";
      return sameWritten(e.from, e.to) ? `the line has no length ${rounded}` : undefined;
    case "polyline": {
      const [first] = e.points;
      if (!first) return undefined;
      if (e.points.every((p) => same(p, first))) return "the polyline has no length";
      return e.points.every((p) => sameWritten(p, first))
        ? `the polyline has no length ${rounded}`
        : undefined;
    }
    case "arc":
      return arcIsWrittenAsPoint(e.startAngle, e.endAngle)
        ? `the arc has no length ${rounded}`
        : undefined;
    case "circle":
    case "text":
    case "insert":
      return undefined;
  }
}

function same(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function sameWritten(a: Point, b: Point): boolean {
  return written(a[0]) === written(b[0]) && written(a[1]) === written(b[1]);
}
