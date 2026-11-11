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
  Point,
  TextStyle,
} from "./drawing.ts";
import { written } from "./format.ts";
import { validIdHandle } from "./handles.ts";
import { layerAuditKey, layerKey } from "./layers.ts";
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
  lineweightProblem,
  linetypeNameProblem,
  linetypeProblem,
  linetypeScaleProblem,
  R12_ONLY,
  magnitudeProblem,
  placedAttributeProblem,
  scaleProblem,
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
  | "attribute"
  | "duplicate-attribute"
  | "undefined-attribute"
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
  /**
   * When it is an entity problem, the entity's index: into the entities of `block` when there
   * is one, and into `drawing.entities` otherwise.
   */
  readonly entity?: number;
  /** The `id` of the entity the problem is in, when it has one. */
  readonly id?: string;
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
 */
export function lint(drawing: Drawing, options: LintOptions = {}): Diagnostic[] {
  const version = options.version ?? drawing.dxf;
  const out: Diagnostic[] = [];

  const format = formatProblem(drawing.format);
  if (format) out.push({ rule: "format", severity: "error", message: format });

  if (!["in", "ft", "mm", "cm", "m"].includes(drawing.units)) {
    out.push({
      rule: "units",
      severity: "error",
      message: `Unknown units: ${JSON.stringify(drawing.units)}`,
    });
  }

  const r12 = version === "R12";
  const scale = drawing.linetypeScale;
  if (scale !== undefined && (r12 ? scale !== 1 : linetypeScaleProblem(scale))) {
    const problem = r12 ? R12_ONLY.linetypes : linetypeScaleProblem(scale);
    out.push({ rule: "linetype", severity: "error", message: `linetypeScale: ${problem}` });
  }

  // AutoCAD compares linetype names as it compares layer names, and AUDIT reports a twin of a
  // built-in linetype as it reports any other.
  const linetypes = new Set<string>();
  const linetypesAudited = new Map<string, string>(
    BUILT_IN_LINETYPES.map((name) => [layerAuditKey(name), name]),
  );
  for (const linetype of drawing.linetypes ?? []) {
    const error = (rule: LintRule, message: string) =>
      out.push({ rule, severity: "error", message, linetype: linetype.name });
    const label = `Linetype ${JSON.stringify(linetype.name)}`;
    if (r12) {
      error("linetype", `${label}: ${R12_ONLY.linetypes}`);
      continue;
    }
    const problem = linetypeProblem(linetype.name, linetype.description, linetype.pattern);
    if (problem) error("linetype", `${label}: ${problem}`);
    if (typeof linetype.name !== "string") continue;
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
  }
  /** What is wrong with a reference to a linetype, which AutoCAD discards a drawing over. */
  const missing = (name: unknown): string | undefined => {
    if (typeof name !== "string") return "a linetype is named by a string";
    const problem = linetypeNameProblem(name);
    if (problem) return `Linetype ${JSON.stringify(name)}: ${problem}`;
    return builtInLinetype(name) || linetypes.has(layerKey(name))
      ? undefined
      : undefinedLinetypeProblem(name);
  };

  // AutoCAD compares text style names as it compares layer names.
  const textStyles = new Set<string>();
  const stylesByKey = new Map<string, TextStyle>();
  const textStylesAudited = new Map<string, string>([
    [layerAuditKey(STANDARD_TEXT_STYLE), STANDARD_TEXT_STYLE],
  ]);
  for (const style of drawing.textStyles ?? []) {
    const error = (rule: LintRule, message: string) =>
      out.push({ rule, severity: "error", message, textStyle: style.name });
    const label = `Text style ${JSON.stringify(style.name)}`;
    if (r12) {
      error("text-style", `${label}: ${R12_ONLY.text}`);
      continue;
    }
    const problem = textStyleProblem(style.name, style.font, style.widthFactor, style.obliqueAngle);
    if (problem) error("text-style", `${label}: ${problem}`);
    if (typeof style.name !== "string") continue;
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
    if (!textStyles.has(key)) stylesByKey.set(key, style);
    textStyles.add(key);
    if (!textStylesAudited.has(auditKey)) textStylesAudited.set(auditKey, style.name);
  }
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
        const problem = `Text style ${JSON.stringify(name)}: ${textStyleNameProblem(name)}`;
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
  for (const layer of drawing.layers) {
    const error = (rule: LintRule, message: string) =>
      out.push({ rule, severity: "error", message, layer: layer.name });
    const nameProblem = layerNameProblem(layer.name, version);
    if (nameProblem) error("layer-name", `Layer ${JSON.stringify(layer.name)}: ${nameProblem}`);
    const colorProblem = layerColorProblem(layer.color);
    if (colorProblem) error("layer-color", `Layer ${JSON.stringify(layer.name)}: ${colorProblem}`);
    const label = `Layer ${JSON.stringify(layer.name)}`;
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
        `Layer ${JSON.stringify(layer.name)} is defined twice. CAD ignores case in layer names`,
      );
    } else if (twinProblem) {
      error("duplicate-layer", `Layer ${JSON.stringify(layer.name)}: ${twinProblem}`);
    }
    seen.add(key);
    if (!audited.has(auditKey)) audited.set(auditKey, layer.name);
  }
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
      ? `. AutoCAD does not take it for layer ${JSON.stringify(twin)}: it would add a layer, and its AUDIT would report a duplicate name`
      : "";
    return `layer ${JSON.stringify(layer)} is not defined${hint}`;
  };

  // AutoCAD takes two block names for one where its AUDIT would call two layer names
  // duplicates, and an insert finds its block as an entity finds its layer.
  const blocks = new Map<string, Block>();
  const blocksAudited = new Map<string, string>();
  const allBlocks = drawing.blocks ?? [];
  for (const block of allBlocks) {
    const label = `Block ${JSON.stringify(block.name)}`;
    const error = (rule: LintRule, message: string) =>
      out.push({ rule, severity: "error", message: `${label}: ${message}`, block: block.name });
    if (r12) {
      error("block", R12_ONLY.blocks);
      continue;
    }
    const nameProblem = blockNameProblem(block.name);
    if (nameProblem) {
      error("block", nameProblem);
      continue;
    }
    const auditKey = layerAuditKey(block.name);
    const first = blocksAudited.get(auditKey);
    if (first !== undefined) {
      error("duplicate-block", blockTwinProblem(block.name, first)!);
      continue;
    }
    blocksAudited.set(auditKey, block.name);
    blocks.set(layerKey(block.name), block);
    const base: unknown = block.base;
    if (base !== undefined) {
      const [x, y] = base as Point;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        error("block", "its base point must be finite numbers");
      } else {
        const problem = magnitudeProblem(x) ?? magnitudeProblem(y);
        if (problem) error("block", `its base point: ${problem}`);
      }
    }
    const named = blockHandles(block.name);
    for (const handle of [named.record, named.begin, named.end]) {
      const clash = claim(handle, `the block ${JSON.stringify(block.name)}`);
      if (clash) error("id-handle", clash);
    }
  }

  /** Checks the attribute definitions of a block that passed the checks above. */
  const lintAttributes = (block: Block): void => {
    const tags = new Set<string>();
    (block.attributes ?? []).forEach((definition, index) => {
      const tag: unknown = definition.tag;
      const add = (rule: LintRule, severity: Diagnostic["severity"], problem: string) => {
        const call = block.attributes ? callOf(block.attributes, index) : undefined;
        out.push({
          rule,
          severity,
          message: `Block ${JSON.stringify(block.name)}, attribute ${shownTag(tag)}: ${problem}`,
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
        const what = `the attribute ${JSON.stringify(tag)} of the block ${JSON.stringify(block.name)}`;
        const clash = claim(definitionHandle(block.name, tag as string), what);
        if (clash) add("id-handle", "error", clash);
      }
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
    });
  };

  const lintEntities = (entities: readonly Entity[], block: Block | undefined): void => {
    const where = block ? ` of block ${JSON.stringify(block.name)}` : "";
    entities.forEach((entity, index) => {
      const id: unknown = entity.id;
      const add = (rule: LintRule, severity: Diagnostic["severity"], problem: string) => {
        const call = callOf(entities, index);
        out.push({
          rule,
          severity,
          message: `${entity.kind} #${index}${where}: ${problem}`,
          ...(block ? { block: block.name } : {}),
          entity: index,
          ...(typeof id === "string" ? { id } : {}),
          ...(call ? { call } : {}),
        });
      };
      let named = false;
      if (id !== undefined) {
        const problem = idProblem(id);
        const first = problem ? undefined : ids.get(idKey(id as string));
        if (problem) add("id", "error", problem);
        else if (first !== undefined)
          add("duplicate-id", "error", duplicateIdProblem(id as string, first));
        else {
          ids.set(idKey(id as string), id as string);
          const what = `the id ${JSON.stringify(id)}`;
          const clash = claim(validIdHandle(id as string), what, id as string);
          if (clash) add("id-handle", "error", clash);
          named = true;
        }
      }
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
        if (typeof name !== "string")
          add("undefined-block", "error", "a block is named by a string");
        else if (!placed) {
          const twin = blocksAudited.get(layerAuditKey(name));
          const hint = twin ? `. Name it as the drawing does, ${JSON.stringify(twin)}` : "";
          add("undefined-block", "error", `${undefinedBlockProblem(name)}${hint}`);
        }
        const set: unknown = entity.attributes === undefined ? {} : entity.attributes;
        if (typeof set !== "object" || set === null || Array.isArray(set)) {
          add("undefined-attribute", "error", ATTRIBUTES_SHAPE);
          return;
        }
        const tags = new Set((placed?.attributes ?? []).map((definition) => definition.tag));
        // What the insert makes of each attribute, once the insert itself is sound.
        if (placed && problems.length === 0) {
          for (const definition of placed.attributes ?? []) {
            if (
              typeof definition.tag !== "string" ||
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
          if (problem) add("text", "error", `attribute ${JSON.stringify(tag)}: ${problem}`);
          const warning = typeof value === "string" ? textWarning(value) : undefined;
          if (warning) add("text", "warning", `attribute ${JSON.stringify(tag)}: ${warning}`);
        }
        if (named && tags.size > 0) {
          const insert = `the insert ${JSON.stringify(id)}`;
          const taken = [...tags].map((tag): [string, string] => [
            insertAttributeHandle(id as string, tag),
            `the attribute ${JSON.stringify(tag)} of ${insert}`,
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
    });
  };
  for (const block of blocks.values()) {
    lintAttributes(block);
    lintEntities(block.entities, block);
  }
  lintEntities(drawing.entities, undefined);

  // A block that holds an insert of itself, directly or through the blocks it inserts.
  const inserted = (block: Block): Block[] =>
    block.entities.flatMap((entity) => {
      const name: unknown = entity.kind === "insert" ? entity.block : undefined;
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
 * `textStyle`, `block`, `attribute` and entity methods at a call that breaks a rule, with that one problem as the
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

/** A tag for a message, whatever its type. */
function shownTag(tag: unknown): string {
  return typeof tag === "string" ? JSON.stringify(tag) : String(tag);
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
