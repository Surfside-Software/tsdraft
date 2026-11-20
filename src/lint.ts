import {
  definitionHandle,
  insertAttributeHandle,
  insertEndHandle,
  blockHandles,
  lookupCost,
  placeAttribute,
  referencedTree,
  type XrefDrawings,
} from "./blocks.ts";
import {
  arrowheadInfo,
  DEFAULT_ARROWHEAD,
  DEFAULT_LEADER_ARROWHEAD,
  leaderArrowheadInfo,
  STANDARD_LEADER_STYLE,
  type LeaderArrowhead,
} from "./arrowheads.ts";
import { callOf, type CallSite } from "./callsite.ts";
import {
  arrowheadEntityHandle,
  dimensionDrawnProblem,
  pictureHandleList,
  pictureOwner,
  validDimensionPictureHandles,
  validDimensionStyleHandle,
  type Dimension,
  type DimensionPlace,
  isDimension,
} from "./dimensions.ts";
import type {
  AttributeDefinition,
  Block,
  DimensionStyle,
  Drawing,
  DxfVersion,
  Entity,
  Image,
  Layout,
  Viewport,
  Insert,
  Layer,
  Leader,
  LeaderStyle,
  Linetype,
  Point,
  Text,
  TextStyle,
  Xref,
} from "./drawing.ts";
import { boxer, type Boxer } from "./extents.ts";
import { exactKey, imagePathKey, imageReactorHandle, imageVectors } from "./images.ts";
import { written } from "./format.ts";
import { validIdHandle } from "./handles.ts";
import { validLayoutHandles, validViewportView, viewReaches } from "./layouts.ts";
import {
  leaderArrowheadHandles,
  leaderDrawnProblem,
  leaderRepeats,
  leaderStyleDictionaryHandle,
  validLeaderStyleHandle,
} from "./leaders.ts";
import { paperInfo } from "./papers.ts";
import { isUnits } from "./units.ts";
import type { Standard } from "./standard/document.ts";
import { lintStandard } from "./standard/lint.ts";
import {
  arrayProblem,
  filled,
  isObject,
  isSound,
  KEYED,
  PLAIN_OBJECT,
  slotProblem,
  TYPED,
  WALKABLE,
  Strings,
  type Check,
} from "./shape.ts";
import { layerAuditKey, layerKey, layoutNameKey } from "./layers.ts";
import { STANDARD_FONT, STANDARD_TEXT_STYLE } from "./fonts.ts";
import { parseParagraph, type ParsedParagraph } from "./paragraph-codes.ts";
import { BUILT_IN_LINETYPES, builtInLinetype } from "./linetypes.ts";
import {
  IMAGE_CLIP_MOST,
  IMAGE_CLIP_MOST_PROBLEM,
  IMAGE_INVERT_WITHOUT_CLIP,
  IMAGE_PIXELS_SAME,
  imageClipProblem,
  imagePathProblem,
  imagePixelsProblem,
  arcIsWrittenAsPoint,
  arcProblem,
  ATTRIBUTES_SHAPE,
  attributeTagProblem,
  blockCycleProblem,
  blockNameProblem,
  blockTwinProblem,
  DIMENSION_IN_BLOCK,
  dimensionStyleNameProblem,
  dimensionStyleProblem,
  dimensionStyleTwinProblem,
  dimensionStyleWarning,
  dimensionAngleProblem,
  dimensionTextProblem,
  duplicateAttributeProblem,
  duplicateIdProblem,
  formatProblem,
  handleProblem,
  idHandleProblem,
  idKey,
  idProblem,
  isStandardDimensionStyle,
  isStandardLeaderStyle,
  isStandardTextStyle,
  LEADER_IN_BLOCK,
  leaderOwnProblem,
  leaderShaftsProblem,
  leaderStyleNameProblem,
  leaderStyleProblem,
  leaderStyleTwinProblem,
  leaderTextProblem,
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
  polylineSidesProblems,
  paperProblem,
  placedAttributeProblem,
  plotStyleProblem,
  scaleProblem,
  shown,
  sizeProblem,
  textAlignProblem,
  textProblem,
  lineSpacingProblem,
  paragraphChoiceProblem,
  paragraphColumnsShapeProblem,
  paragraphColumnsSizeProblem,
  PARAGRAPH_COLUMN_BREAK,
  paragraphProblemIn,
  paragraphValueProblem,
  textStyleNameProblem,
  textStyleProblem,
  textWarning,
  undefinedAttributeProblem,
  undefinedBlockProblem,
  undefinedDimensionStyleProblem,
  undefinedDimensionTextStyleProblem,
  undefinedLeaderStyleProblem,
  undefinedLeaderTextStyleProblem,
  undefinedLinetypeProblem,
  undefinedTextStyleProblem,
  viewportEmptyWarning,
  viewportOffPaperWarning,
  viewportProblem,
  XREF_ATTRIBUTES,
  XREF_REFUSED_FIELDS,
  XREFS_GIVEN,
  xrefChainProblem,
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
  | "dimension-style"
  | "duplicate-dimension-style"
  | "undefined-dimension-style"
  | "dimension"
  | "leader-style"
  | "duplicate-leader-style"
  | "undefined-leader-style"
  | "leader"
  | "paragraph"
  | "image"
  | "zero-length"
  | "standard"
  | "layer-outside-standard"
  | "layer-differs-from-standard"
  | "linetype-outside-standard"
  | "pen-outside-standard"
  | "role"
  | "scale-outside-standard"
  | "dimension-style-outside-standard"
  | "leader-style-outside-standard"
  | "text-style-outside-standard"
  | "sheet-format-outside-standard"
  | "sheet-per-file"
  | "discipline-unknown"
  | "linetype-differs-from-standard"
  | "text-style-differs-from-standard"
  | "dimension-style-differs-from-standard"
  | "leader-style-differs-from-standard"
  | "sheet-format-ambiguous"
  | "height-below-standard"
  | "height-off-role"
  | "dimension-off-scale"
  | "leader-off-scale"
  | "viewport-outside-drawing-area"
  | "title-block-missing"
  | "title-block-differs-from-standard"
  | "title-block-field-unset"
  | "title-block-field-overflow"
  | "standard-check-capped"
  | "check-capped";

export interface Diagnostic {
  readonly rule: LintRule;
  /**
   * An error means the leading CAD app rejects, repairs or garbles the output, and `toDXF` refuses
   * to write it, or that the drawing breaks a rule of the standard `lint` was given, which `toDXF`
   * does not check.
   */
  readonly severity: "error" | "warning";
  readonly message: string;
  /** The layer the problem is in, when it is a layer problem. */
  readonly layer?: string;
  /** The linetype the problem is in, when it is a problem with a linetype's definition. */
  readonly linetype?: string;
  /** The text style the problem is in, when it is a problem with a text style's definition. */
  readonly textStyle?: string;
  /** The dimension style the problem is in, when it is a problem with its definition. */
  readonly dimensionStyle?: string;
  /** The leader style the problem is in, when it is a problem with its definition. */
  readonly leaderStyle?: string;
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

/**
 * What `lint` checks a drawing against: its DXF version, and the standard it is drawn to, with
 * the drawing's discipline.
 */
export type LintOptions = {
  /**
   * The drawings the xrefs stand for, as `toSVG` takes them. `lint` then says why any drawing
   * given there is not drawn. It does not check those drawings: lint each on its own.
   */
  readonly xrefs?: XrefDrawings;
} & (
  | {
      /** The DXF version to check against. Defaults to the drawing's own. */
      readonly version?: DxfVersion;
      readonly standard?: undefined;
      readonly discipline?: undefined;
    }
  | {
      /** The DXF version to check against. Defaults to the drawing's own. */
      readonly version?: DxfVersion;
      /**
       * The standard the drawing is drawn to, as `defineStandard` returns it, from this copy of
       * tsdraft or another. `lint` then holds the drawing to its rules too.
       */
      readonly standard: Standard;
      /**
       * The drawing's discipline, a discipline of the standard, which resolves the entries with
       * fields by discipline.
       */
      readonly discipline?: string;
    }
);

/**
 * The most work the checks do again for what a drawing repeats, beside `REPEATS` for each
 * entity and attribute definition it holds, counted in what they look at: each attribute an
 * insert places past its first `FREE`, each handle an attribute of an insert with an id takes
 * past its first `FREE`, one more for each 32 characters of the id and the tag, one for each 32
 * characters a dimension's style's prefix and suffix and its own text hold, each block the
 * search for the way back through a cycle looks at, with each insert it holds, and each 32
 * characters of the names on the way, and what `boxer` counts for the box of model space.
 */
const MAX_WORK = 500_000;

/** The work the checks may do again for each entity and attribute definition of a drawing. */
const REPEATS = 16;

/** The attributes of each insert that are placed, and take handles, free of the limit. */
const FREE = 64;

/** The values of an insert that gives none. */
const NO_VALUES: Readonly<Record<string, string>> = Object.freeze({});

/** The shortest text value the checks read once, however many places share it. */
const LONG = 256;

/**
 * Checks a drawing against the rules the leading CAD app enforces when it opens DXF.
 *
 * A drawing made with `createDrawing()` already passes the error rules for its
 * own DXF version, because the builder throws at the offending call. `lint`
 * matters when a `Drawing` was built by hand or by other code, when it is
 * exported as a different version than it was built for, and for warnings.
 *
 * It takes any plain data and never throws. A `Proxy` is read as the data its traps give, so a
 * trap that throws or never returns does so inside `lint`. A value that does not have the shape
 * of a `Drawing`, such as a list that is not an array, an entity of an unknown kind or a field
 * of the wrong type, is an error that gives the path to it, and no other rule is checked on
 * that object. A field no object of its type has is an error too.
 *
 * With `standard`, it then holds the drawing to the standard: its layers, linetypes, pens, text
 * styles, dimension styles, sheet formats and title blocks, the height each text plots at in
 * each viewport that shows it and on its layout, and the scale each dimension is shown at. It
 * takes the standard as plain data, checks it and works out its hash again, and a standard that
 * does not check is one `standard` error. Without `standard` it checks none of this.
 */
export function lint(drawing: Drawing, options: LintOptions = {}): Diagnostic[] {
  return lintWithin(drawing, options, checksLimit(drawing));
}

/**
 * The work `lint` does again for what a drawing repeats, at most. The DXF writer boxes the
 * drawing within it, so it stops on nothing `lint` passed.
 */
export function checksLimit(drawing: Drawing): number {
  return MAX_WORK + REPEATS * itemsOf(drawing);
}

/** How many entities and attribute definitions a drawing's lists hold, up to their empty slots. */
function itemsOf(drawing: Drawing): number {
  if (!isObject(drawing)) return 0;
  // A list that many blocks share is counted once.
  const counted = new WeakSet<object>();
  const count = (list: unknown): number => {
    if (typeof list !== "object" || list === null || counted.has(list)) return 0;
    counted.add(list);
    return filled(list).length;
  };
  let items = count(drawing.entities);
  for (const block of filled(drawing.blocks as unknown)) {
    if (isObject(block)) items += count(block.entities) + count(block.attributes);
  }
  for (const layout of filled(drawing.layouts as unknown)) {
    if (isObject(layout)) items += count(layout.entities);
  }
  return items;
}

/** `lint` with `most` units of work for what it does again. */
export function lintWithin(drawing: Drawing, options: LintOptions, most: number): Diagnostic[] {
  if (typeof drawing !== "object" || drawing === null || Array.isArray(drawing)) {
    return [{ rule: "format", severity: "error", message: `The drawing ${PLAIN_OBJECT}` }];
  }
  const version = options?.version ?? drawing.dxf;
  const out: Diagnostic[] = [];

  // What the checks do again for each insert of a block, each dimension of a style and each
  // block of a cycle is paid for before it is done, and ends at a limit with one warning.
  let work = 0;
  let stopped: string | undefined;
  /** Counts the cost of a step at `where`, and says whether there is room left to take it. */
  const spend = (cost: number, where: () => string): boolean => {
    if (stopped !== undefined) return false;
    work += cost;
    if (work <= most) return true;
    stopped = where();
    return false;
  };

  /**
   * The lists, the long lists of points and the objects of an insert's values the checks have
   * read. A drawing made in code may share one among many places, and reading it again is paid
   * for, by its size, before it is done.
   */
  const read = new WeakSet<object>();
  /** True for a list or an object the checks have read before, which it notes otherwise. */
  const again = (value: unknown): boolean => {
    if (typeof value !== "object" || value === null) return false;
    if (read.has(value)) return true;
    read.add(value);
    return false;
  };
  /** What is wrong with a text value and what it warns of, worked out once for a long one. */
  const textChecks = new Strings<readonly [string | undefined, string | undefined]>();
  const checkText = (value: string): readonly [string | undefined, string | undefined] => {
    if (value.length < LONG) return [textProblem(value), textWarning(value)];
    let found = textChecks.get(value);
    if (!found) textChecks.set(value, (found = [textProblem(value), textWarning(value)]));
    return found;
  };
  /** What is wrong with a paragraph's value in its style's font, read once for a long one. */
  const paragraphChecks = new Strings<
    Pick<ParsedParagraph, "problem" | "ownDiameter" | "columnBreak">
  >();
  /** What is wrong with a paragraph's value, and whether it holds a `\N`. */
  const checkParagraph = (value: string, font: unknown): [string | undefined, boolean] => {
    let found = value.length < LONG ? undefined : paragraphChecks.get(value);
    if (!found) {
      const { problem, ownDiameter, columnBreak } = parseParagraph(value);
      found = { problem, ownDiameter, columnBreak };
      if (value.length >= LONG) paragraphChecks.set(value, found);
    }
    return [paragraphProblemIn(found, font), found.columnBreak];
  };
  /** What is wrong with each columns object a paragraph gives, apart from its width. */
  const columnShapes = new WeakMap<object, string | undefined>();
  /** The strings of `LONG` characters or more the checks have read. */
  const long = new Strings<true>();
  /**
   * What reading a string again costs: one for each 32 characters of one of `LONG` or more that
   * the checks have read before, in another place. A long string that many places share is read,
   * quoted and written again for each.
   */
  const repeat = (value: unknown): number => {
    if (typeof value !== "string" || value.length < LONG) return 0;
    // One that took the place of another of its length counts as read before.
    const again = long.get(value) !== undefined || long.clashes(value);
    long.set(value, true);
    return again ? Math.floor(value.length / 32) : 0;
  };
  /**
   * What reading the strings of an entity or a definition again costs, as `repeat` counts it,
   * for each field the checks read or quote. A field nobody knows, or a kind that is none, is
   * quoted only where its object is first met, through `malformed`. Past the limit a long string
   * is not looked up, which would compare it with another.
   */
  const long1 = (value: unknown): number =>
    typeof value === "string" && value.length >= LONG
      ? stopped === undefined
        ? repeat(value)
        : 1
      : 0;
  /** Of an entity: the fields every entity has, and those its kind adds. */
  const repeatedIn = (e: Readonly<Record<string, unknown>>): number => {
    let cost = long1(e.id) + long1(e.layer) + long1(e.linetype) + long1(e.lineweight);
    switch (e.kind) {
      case "text":
        cost += long1(e.value) + long1(e.style) + long1(e.align) + long1(e.valign);
        break;
      case "paragraph":
        cost +=
          long1(e.value) +
          long1(e.style) +
          long1(e.align) +
          long1(e.valign) +
          long1(e.lineSpacingStyle);
        break;
      case "insert":
        cost += long1(e.block);
        break;
      case "linear-dimension":
      case "aligned-dimension":
      case "radius-dimension":
      case "diameter-dimension":
      case "jogged-radius-dimension":
        cost += long1(e.style) + long1(e.text) + long1(e.textBelow);
        break;
      case "leader":
        cost += long1(e.style) + long1(e.textStyle);
        break;
      case "image":
        cost += long1(e.path);
        break;
    }
    return cost;
  };
  /** Of an attribute definition. */
  const repeatedOf = (d: Readonly<Record<string, unknown>>): number =>
    long1(d.tag) +
    long1(d.value) +
    long1(d.prompt) +
    long1(d.layer) +
    long1(d.style) +
    long1(d.align) +
    long1(d.valign);
  const leaderAgain = leaderRepeats();
  /** What is wrong with a dimension's own text, worked out once for a long one. */
  const dimensionTexts = new Strings<readonly [string | undefined]>();
  const checkDimensionText = (text: unknown): string | undefined => {
    if (typeof text !== "string" || text.length < LONG) return dimensionTextProblem(text);
    let found = dimensionTexts.get(text);
    if (!found) dimensionTexts.set(text, (found = [dimensionTextProblem(text)]));
    return found[0];
  };
  /** Whether the drawing holds an entity whose box can cost anything against the limit. */
  let boxable = false;
  /** The blocks whose definitions were past the limit, which no insert's value is held to. */
  const unreadDefinitions = new Set<Block>();
  /** The values each object of an insert's values holds, read once, and what its long strings cost. */
  const valuesOf = new WeakMap<
    object,
    { readonly entries: readonly (readonly [string, unknown])[]; readonly long: number }
  >();

  /** Whether a rule can read each object that is not sound, under each check it was met with. */
  const shapes = new WeakMap<object, Map<Check, boolean>>();
  /** True once an object that is not sound has been met, before which none is looked up. */
  let unsound = false;

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
    // An object that is not sound is reported where it is first met. A drawing made in code may
    // share it among many places, which give no messages again and cost a unit each: the drawing
    // has an error there, so toDXF refuses it.
    const object = typeof value === "object" && value !== null ? value : undefined;
    const before = object && unsound ? shapes.get(object)?.get(check) : undefined;
    if (before !== undefined) {
      spend(1, () => at || "the drawing");
      return !before;
    }
    if (isSound(check, value)) return false;
    const remember = (readable: boolean): void => {
      if (!object) return;
      unsound = true;
      let checks = shapes.get(object);
      if (!checks) shapes.set(object, (checks = new Map()));
      checks.set(check, readable);
    };
    // Past the limit a shape is only asked about, which builds no message.
    if (stopped !== undefined) {
      const readable = isSound(check, value, false);
      remember(readable);
      return !readable;
    }
    const problems: string[] = [];
    const extra: string[] = [];
    check(value, at, problems, extra);
    remember(problems.length === 0);
    // A message pays for what it quotes, such as a long key or kind that many objects share.
    let length = 0;
    for (const message of [...extra, ...problems]) length += message.length;
    if (!spend(Math.floor(length / 32), () => at || "the drawing")) return problems.length > 0;
    for (const message of extra) out.push({ rule, severity: "error", message, ...about });
    for (const message of problems) {
      out.push({ rule, severity: "error", message, ...about, ...(at ? { item: at } : {}) });
    }
    return problems.length > 0;
  };
  /** True for an object met before that was not sound under `check`, whose shape is not read again. */
  const metUnsound = (check: Check, value: unknown): boolean =>
    unsound &&
    typeof value === "object" &&
    value !== null &&
    shapes.get(value)?.has(check) === true;
  /**
   * Names the item at `at` in the errors added since `from`, when a field of it has the wrong
   * type. A rule has then reported the field, and what draws the drawing cannot read the item.
   */
  /** Whether an object is sound under a check but for fields nobody knows, worked out once. */
  const typedSound = new WeakMap<object, Map<Check, boolean>>();
  const mark = (typed: Check, value: unknown, at: string, from: number): void => {
    if (out.length === from) return;
    let sound: boolean | undefined;
    if (typeof value === "object" && value !== null) {
      let checks = typedSound.get(value);
      if (!checks) typedSound.set(value, (checks = new Map()));
      sound = checks.get(typed);
      if (sound === undefined) checks.set(typed, (sound = isSound(typed, value, false)));
    } else sound = isSound(typed, value, false);
    if (sound) return;
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
    field:
      | "layers"
      | "entities"
      | "linetypes"
      | "textStyles"
      | "blocks"
      | "xrefs"
      | "layouts"
      | "dimensionStyles"
      | "leaderStyles",
    rule: LintRule,
  ): readonly T[] => {
    const value: unknown = drawing[field];
    if (value === undefined && field !== "layers" && field !== "entities") return [];
    const problem = arrayProblem(value, field);
    if (problem) out.push({ rule, severity: "error", message: problem, item: field });
    return problem ? [] : (value as readonly T[]);
  };
  /** Names an entry of a list in a diagnostic, when its name is one. */
  const named = (
    field: "linetype" | "textStyle" | "dimensionStyle" | "leaderStyle" | "block" | "xref",
    name: unknown,
  ) => (typeof name === "string" ? { [field]: name } : {});

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

  const frame: unknown = drawing.imageFrame;
  if (frame !== undefined && typeof frame !== "boolean") {
    out.push({
      rule: "image",
      severity: "error",
      message: "imageFrame must be true or false",
      item: "imageFrame",
    });
  }

  // The leading CAD app compares linetype names as it compares layer names, and AUDIT reports a
  // twin of a built-in linetype as it reports any other.
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
  /** What is wrong with a reference to a linetype, which the leading CAD app discards a drawing over. */
  const missing = (name: unknown): string | undefined => {
    if (typeof name !== "string") return "a linetype is named by a string";
    const problem = linetypeNameProblem(name);
    if (problem) return `Linetype ${shown(name)}: ${problem}`;
    return builtInLinetype(name) || linetypes.has(layerKey(name))
      ? undefined
      : undefinedLinetypeProblem(name);
  };

  // The leading CAD app compares text style names as it compares layer names.
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

  // The leading CAD app looks layers up by one form of their names, and AUDIT compares another.
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
    // The leading CAD app adds a layer for a name it does not know. When AUDIT takes that name for
    // a declared layer's, it then reports the new layer as a duplicate of it.
    const twin = audited.get(layerAuditKey(layer));
    const hint = twin
      ? `. The leading CAD app does not take it for layer ${shown(twin)}: it would add a layer, and its AUDIT would report a duplicate name`
      : "";
    return `layer ${shown(layer)} is not defined${hint}`;
  };

  // The leading CAD app compares dimension style names as it compares layer names, and keeps the
  // first of two it takes for one. A style with a name counts for the dimensions that name it,
  // whatever else is wrong with it, and only one with nothing wrong is measured with.
  const dimensionStyleNames = new Set<string>();
  const dimensionStyles = new Map<string, DimensionStyle>();
  const dimensionStylesAudited = new Map<string, string>();
  const arrowheadBlocks = new Set<string>();
  each(
    listed<DimensionStyle>("dimensionStyles", "dimension-style"),
    "dimensionStyles",
    "dimension-style",
    TYPED.dimensionStyle,
    (style, i) => {
      if (malformed(WALKABLE.dimensionStyle, style, `dimensionStyles[${i}]`, "dimension-style")) {
        return;
      }
      const error = (rule: LintRule, message: string) =>
        out.push({
          rule,
          severity: "error",
          message: `Dimension style ${shown(style.name)}: ${message}`,
          ...named("dimensionStyle", style.name),
        });
      if (r12) {
        error("dimension-style", R12_ONLY.dimensions);
        return;
      }
      const problem = dimensionStyleProblem(style);
      if (problem) error("dimension-style", problem);
      const name: unknown = style.name;
      if (dimensionStyleNameProblem(name) || isStandardDimensionStyle(name as string)) return;
      const auditKey = layerAuditKey(style.name);
      const first = dimensionStylesAudited.get(auditKey);
      if (first !== undefined) {
        error("duplicate-dimension-style", dimensionStyleTwinProblem(style.name, first)!);
        return;
      }
      dimensionStylesAudited.set(auditKey, style.name);
      const key = layerKey(style.name);
      dimensionStyleNames.add(key);
      const textStyle: unknown = style.textStyle;
      let lettered = true;
      if (
        typeof textStyle === "string" &&
        !textStyleNameProblem(textStyle) &&
        !isStandardTextStyle(textStyle)
      ) {
        if (!textStyles.has(layerKey(textStyle))) {
          error("undefined-text-style", undefinedDimensionTextStyleProblem(textStyle));
          lettered = false;
        } else if (unreadStyles.has(layerKey(textStyle))) lettered = false;
      }
      const warning = dimensionStyleWarning(style);
      if (warning) {
        out.push({
          rule: "text",
          severity: "warning",
          message: `Dimension style ${shown(style.name)}: ${warning}`,
          dimensionStyle: style.name,
        });
      }
      const clash = claim(
        validDimensionStyleHandle(style.name),
        `the dimension style ${shown(style.name)}`,
      );
      if (clash) error("id-handle", clash);
      const arrowhead: unknown = style.arrowhead ?? DEFAULT_ARROWHEAD;
      const block = arrowheadInfo(arrowhead)?.block;
      if (block !== undefined && !arrowheadBlocks.has(block)) {
        arrowheadBlocks.add(block);
        const handles = blockHandles(block);
        for (const handle of [
          handles.record,
          handles.begin,
          handles.end,
          arrowheadEntityHandle(block),
        ]) {
          const taken = claim(handle, `the arrowhead ${shown(arrowhead)}`);
          if (taken) error("id-handle", taken);
        }
      }
      if (!problem && lettered) dimensionStyles.set(key, style);
    },
  );
  /** Checks what a dimension names and what it measures. `sound` is false for one whose points no rule can measure. */
  const lintDimension = (
    dimension: Dimension,
    add: (rule: LintRule, severity: Diagnostic["severity"], problem: string) => void,
    sound: boolean,
    inBlock: boolean,
    where: () => string,
  ): void => {
    if (r12) {
      add("dimension", "error", R12_ONLY.dimensions);
      return;
    }
    if (inBlock) add("dimension", "error", DIMENSION_IN_BLOCK);
    const name: unknown = dimension.style;
    const nameProblem = dimensionStyleNameProblem(name);
    let style: DimensionStyle | undefined;
    if (nameProblem) add("undefined-dimension-style", "error", nameProblem);
    else if (!dimensionStyleNames.has(layerKey(name as string))) {
      add("undefined-dimension-style", "error", undefinedDimensionStyleProblem(name as string));
    } else style = dimensionStyles.get(layerKey(name as string));
    for (const text of [dimension.text, dimension.textBelow] as unknown[]) {
      if (text === undefined) continue;
      const problem = checkDimensionText(text);
      if (problem) {
        add("dimension", "error", problem);
        return;
      }
      const warning = checkText(text as string)[1];
      if (warning) add("text", "warning", warning);
    }
    if (sound && dimension.kind === "linear-dimension" && dimension.angle !== undefined) {
      const problem = dimensionAngleProblem(dimension.angle);
      if (problem) {
        add("dimension", "error", problem);
        return;
      }
    }
    if (!style || !sound) return;
    // Its style's prefix and suffix are read again for each dimension that has the style.
    const reads =
      (style.prefix?.length ?? 0) +
      (style.suffix?.length ?? 0) +
      ((dimension.text as string | undefined)?.length ?? 0) +
      ((dimension.textBelow as string | undefined)?.length ?? 0);
    if (!spend(Math.floor(reads / 32), where)) return;
    const textStyle =
      style.textStyle === undefined ? undefined : stylesByKey.get(layerKey(style.textStyle));
    const problem = dimensionDrawnProblem(dimension, style, textStyle);
    if (problem) add("dimension", "error", problem);
  };

  // Leader style names are compared as dimension style names are. A style with a name counts for
  // the leaders that name it, whatever else is wrong with it, and only one with nothing wrong is
  // drawn with.
  const leaderStyleNames = new Set<string>();
  const leaderStyles = new Map<string, LeaderStyle>();
  const leaderStylesAudited = new Map<string, string>();
  const leaderArrowheads = new Set<string>();
  each(
    listed<LeaderStyle>("leaderStyles", "leader-style"),
    "leaderStyles",
    "leader-style",
    TYPED.leaderStyle,
    (style, i) => {
      if (malformed(WALKABLE.leaderStyle, style, `leaderStyles[${i}]`, "leader-style")) return;
      const error = (rule: LintRule, message: string) =>
        out.push({
          rule,
          severity: "error",
          message: `Leader style ${shown(style.name)}: ${message}`,
          ...named("leaderStyle", style.name),
        });
      if (r12) {
        error("leader-style", R12_ONLY.leaders);
        return;
      }
      const problem = leaderStyleProblem(style);
      if (problem) error("leader-style", problem);
      const name: unknown = style.name;
      if (leaderStyleNameProblem(name) || isStandardLeaderStyle(name as string)) return;
      const auditKey = layerAuditKey(style.name);
      const first = leaderStylesAudited.get(auditKey);
      if (first !== undefined) {
        error("duplicate-leader-style", leaderStyleTwinProblem(style.name, first)!);
        return;
      }
      // The first style brings the leading CAD app's own and the dictionary that holds them.
      if (leaderStylesAudited.size === 0) {
        for (const [handle, what] of [
          [
            validLeaderStyleHandle(STANDARD_LEADER_STYLE),
            `the leader style ${shown(STANDARD_LEADER_STYLE)}`,
          ],
          [leaderStyleDictionaryHandle(), "the dictionary of leader styles"],
        ] as const) {
          const taken = claim(handle, what);
          if (taken) error("id-handle", taken);
        }
      }
      leaderStylesAudited.set(auditKey, style.name);
      const key = layerKey(style.name);
      leaderStyleNames.add(key);
      const textStyle: unknown = style.textStyle;
      let lettered = true;
      if (
        typeof textStyle === "string" &&
        !textStyleNameProblem(textStyle) &&
        !isStandardTextStyle(textStyle)
      ) {
        if (!textStyles.has(layerKey(textStyle))) {
          error("undefined-text-style", undefinedLeaderTextStyleProblem(textStyle));
          lettered = false;
        } else if (unreadStyles.has(layerKey(textStyle))) lettered = false;
      }
      const clash = claim(
        validLeaderStyleHandle(style.name),
        `the leader style ${shown(style.name)}`,
      );
      if (clash) error("id-handle", clash);
      const arrowhead: unknown = style.arrowhead ?? DEFAULT_LEADER_ARROWHEAD;
      const block = leaderArrowheadInfo(arrowhead)?.block;
      if (block !== undefined && !leaderArrowheads.has(block)) {
        leaderArrowheads.add(block);
        const handles = leaderArrowheadHandles(arrowhead as LeaderArrowhead)!;
        for (const handle of [handles.record, handles.begin, handles.end, ...handles.strokes]) {
          const taken = claim(handle, `the arrowhead ${shown(arrowhead)}`);
          if (taken) error("id-handle", taken);
        }
      }
      if (!problem && lettered) leaderStyles.set(key, style);
    },
  );
  /** Checks what a leader names, its note and its shafts. `sound` is false for one no rule can read. */
  const lintLeader = (
    leader: Leader,
    add: (rule: LintRule, severity: Diagnostic["severity"], problem: string) => void,
    inBlock: boolean,
  ): void => {
    if (r12) {
      add("leader", "error", R12_ONLY.leaders);
      return;
    }
    if (inBlock) add("leader", "error", LEADER_IN_BLOCK);
    const name: unknown = leader.style;
    const nameProblem = leaderStyleNameProblem(name);
    let style: LeaderStyle | undefined;
    if (nameProblem) add("undefined-leader-style", "error", nameProblem);
    else if (!leaderStyleNames.has(layerKey(name as string))) {
      add("undefined-leader-style", "error", undefinedLeaderStyleProblem(name as string));
    } else style = leaderStyles.get(layerKey(name as string));
    const textProblem = leaderTextProblem(leader.text);
    if (textProblem) add("leader", "error", textProblem);
    else {
      for (const line of leader.text) {
        const warning = textWarning(line);
        if (warning) {
          add("text", "warning", warning);
          break;
        }
      }
    }
    const shaftProblem = leaderShaftsProblem(leader.shafts, leader.at);
    if (shaftProblem) add("leader", "error", shaftProblem);
    const own: unknown = leader.textStyle;
    let textStyle: TextStyle | undefined;
    let lettered = true;
    if (typeof own === "string" && !textStyleNameProblem(own) && !isStandardTextStyle(own)) {
      if (!textStyles.has(layerKey(own))) {
        add("undefined-text-style", "error", undefinedLeaderTextStyleProblem(own));
        lettered = false;
      } else if (unreadStyles.has(layerKey(own))) lettered = false;
      else textStyle = stylesByKey.get(layerKey(own));
    }
    const ownProblem = leaderOwnProblem(leader, written(style?.scale ?? 1));
    if (ownProblem) add("leader", "error", ownProblem);
    if (!style || textProblem || shaftProblem || ownProblem || !lettered) return;
    if (own === undefined && style.textStyle !== undefined) {
      textStyle = stylesByKey.get(layerKey(style.textStyle));
    }
    const problem = leaderDrawnProblem(leader, style, textStyle);
    if (problem) add("leader", "error", problem);
  };

  // The leading CAD app takes two block names for one where its AUDIT would call two layer names
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
  /**
   * The tags of a block's definitions, and those an insert places, with their text styles and
   * their tags as JSON, which a message about any insert of the block quotes.
   */
  const placing = new Map<
    Block,
    {
      readonly tags: ReadonlySet<string>;
      readonly placed: readonly [
        AttributeDefinition & { tag: string },
        TextStyle | undefined,
        string,
      ][];
    }
  >();
  const placingOf = (block: Block) => {
    let found = placing.get(block);
    if (found) return found;
    const read = walked.get(block)!;
    const tags = new Set<string>();
    for (const tag of read.tags) if (tag !== undefined) tags.add(tag);
    const placed: [AttributeDefinition & { tag: string }, TextStyle | undefined, string][] = [];
    for (const definition of read.definitions) {
      if (
        !definition ||
        typeof definition.tag !== "string" ||
        (typeof definition.style === "string" && unreadStyles.has(layerKey(definition.style))) ||
        geometryProblems(asText(definition)).length > 0
      )
        continue;
      const style =
        typeof definition.style === "string"
          ? stylesByKey.get(layerKey(definition.style))
          : undefined;
      placed.push([
        definition as AttributeDefinition & { tag: string },
        style,
        JSON.stringify(definition.tag),
      ]);
    }
    placing.set(block, (found = { tags, placed }));
    return found;
  };
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
    const attributes =
      block.attributes !== undefined && isList(block.attributes) ? block.attributes : [];
    // A list that many blocks share is read again for each, and paid for. Past the limit its
    // definitions are not read, and no value of an insert is held against them.
    const where = () => `the attributes of block ${shown(block.name)}`;
    const unpaid = again(attributes) && !spend(attributes.length, where);
    if (unpaid) unreadDefinitions.add(block);
    each(
      unpaid ? [] : attributes,
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

  // An xref is a block to the leading CAD app, so it shares the blocks' names, and an insert finds
  // it as it finds a block.
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
      // A long string that another place holds too is read again, and paid for.
      const shared = definition ? repeatedOf(definition as never) : 0;
      const where = () => `the attribute ${shown(tag)} of block ${shown(block.name)}`;
      if (shared > 0 && !spend(shared, where)) return;
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
        const [problem, warning] =
          typeof value === "string" ? checkText(value) : ["must be a string", undefined];
        if (problem) add("text", "error", `${field}: ${problem}`);
        if (warning) add("text", "warning", `${field}: ${warning}`);
      }
      const layer = undefinedLayer(definition.layer);
      if (layer) add("undefined-layer", "error", layer);
      for (const problem of geometryProblems(asText(definition))) {
        add("geometry", "error", problem);
      }
      for (const [rule, found] of textProblems(definition)) add(rule, "error", found);
      mark(TYPED.attribute, definition, `${at}.attributes[${index}]`, from);
    });
  };

  type Add = (rule: LintRule, severity: Diagnostic["severity"], problem: string) => void;
  /** The pixels the first image of each file gives it, by its path with \ and / as one. */
  // Keyed exactly, since a path may be long.
  const imagePixels = new Map<string, readonly [number, number]>();
  /**
   * Checks what an image holds beyond the fields every entity has: its path, its pixels, its clip
   * and its flags, and that each file has one size, and takes its reactor's handle from its id.
   */
  const lintImage = (
    image: Image,
    add: Add,
    sound: boolean,
    named: boolean,
    here: () => string,
  ): void => {
    const pathProblem = imagePathProblem(image.path);
    if (pathProblem) add("image", "error", pathProblem);
    const pixelsProblem = imagePixelsProblem(image.pixels);
    if (pixelsProblem) add("image", "error", `pixels: ${pixelsProblem}`);
    for (const [field, value] of [
      ["invertClip", image.invertClip],
      ["transparent", image.transparent],
    ] as const) {
      if (value !== undefined && typeof value !== "boolean") {
        add("image", "error", `${field} must be true or false`);
      }
    }
    if (image.clip === undefined && image.invertClip === true) {
      add("image", "error", IMAGE_INVERT_WITHOUT_CLIP);
    }
    if (pathProblem === undefined && pixelsProblem === undefined) {
      const key = exactKey(imagePathKey(image.path));
      const first = imagePixels.get(key);
      // A long path many images share is read again for each, which `repeatedIn` paid for.
      if (first === undefined) imagePixels.set(key, [image.pixels[0], image.pixels[1]]);
      else if (first[0] !== image.pixels[0] || first[1] !== image.pixels[1]) {
        add("image", "error", IMAGE_PIXELS_SAME);
      }
    }
    if (sound && pixelsProblem === undefined && image.clip !== undefined) {
      const list: unknown = image.clip;
      if (Array.isArray(list) && list.length > IMAGE_CLIP_MOST) {
        add("image", "error", `clip: ${IMAGE_CLIP_MOST_PROBLEM}`);
      } else if (
        Array.isArray(list) &&
        list.length > 64 &&
        !spend(Math.floor(list.length / 8), here)
      ) {
        return;
      } else {
        const [u, v] = imageVectors(image);
        const at: Point = [written(image.at[0]), written(image.at[1])];
        const problem = imageClipProblem(image.clip, at, u, v);
        if (problem) add("image", "error", `clip: ${problem}`);
      }
    }
    if (named) {
      const clash = claim(
        imageReactorHandle(idKey(image.id as string)),
        `the reactor of the image ${shown(image.id)}`,
      );
      if (clash) add("id-handle", "error", clash);
    }
  };
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
    const space = block
      ? `block ${shown(block.name)}`
      : sheet
        ? `layout ${shown(sheet.name)}`
        : "model space";
    const lintEntity = (entity: Entity, index: number): void => {
      // Once the checks have stopped, no entity is read again: `check-capped` says a problem past
      // there may be unreported, and toDXF refuses the drawing.
      if (stopped !== undefined) return;
      const here = () => `${entity.kind} #${index} of ${space}`;
      // A long list of points, bulges, widths or column heights that many entities share is read
      // again for each, and paid for.
      if (
        isObject(entity) &&
        (entity.kind === "polyline" || entity.kind === "image" || entity.kind === "paragraph")
      ) {
        let cost = 0;
        const columns: unknown = entity.kind === "paragraph" ? entity.columns : undefined;
        const lists =
          entity.kind === "image"
            ? [entity.clip]
            : entity.kind === "paragraph"
              ? [isObject(columns) ? columns.heights : undefined]
              : [entity.points, entity.bulges, entity.widths];
        for (const list of lists) {
          if (Array.isArray(list) && list.length >= FREE && again(list))
            cost += Math.floor(list.length / 8);
        }
        if (cost > 0 && !spend(cost, here)) return;
      }
      // What the extents would do again is paid for there, so a drawing that can cost them
      // anything is boxed below.
      if (isObject(entity) && !boxable) boxable = costsBoxes(entity);
      // So are a leader that shares its shafts or its note with another and a long string.
      const shared = isObject(entity)
        ? (entity.kind === "leader" ? leaderAgain(entity) : 0) + repeatedIn(entity)
        : 0;
      if (shared > 0 && !spend(shared, here)) return;
      if (metUnsound(WALKABLE.entity, entity) || !isSound(WALKABLE.entity, entity)) {
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
      if (
        r12 &&
        entity.kind === "polyline" &&
        (entity.bulges !== undefined || entity.width !== undefined || entity.widths !== undefined)
      ) {
        add("geometry", "error", R12_ONLY.polylines);
      }
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
        const set: unknown = entity.attributes === undefined ? NO_VALUES : entity.attributes;
        if (typeof set !== "object" || set === null || Array.isArray(set)) {
          add("undefined-attribute", "error", ATTRIBUTES_SHAPE);
          return;
        }
        // An object that many inserts share is read again for each, past the first `FREE`, and
        // so is a long tag or value. One that costs nothing to read again is not kept.
        let known = valuesOf.get(set);
        let cost: number;
        if (known) cost = Math.max(0, known.entries.length - FREE) + known.long;
        else {
          const entries = Object.entries(set as Record<string, unknown>);
          let long = 0;
          cost = 0;
          for (const [tag, value] of entries) {
            cost += long1(tag) + long1(value);
            for (const text of [tag, value]) {
              if (typeof text === "string" && text.length >= LONG)
                long += Math.floor(text.length / 32);
            }
          }
          known = { entries, long };
          if (entries.length > FREE || long > 0) valuesOf.set(set, known);
        }
        if (cost > 0 && !spend(cost, here)) return;
        const values = known.entries;
        if (xref) {
          if (values.length > 0) add("undefined-attribute", "error", XREF_ATTRIBUTES);
          return;
        }
        const read = placed ? placingOf(placed) : undefined;
        const tags = read?.tags ?? new Set<string>();
        // What the insert makes of each attribute, once the insert itself is sound.
        if (placed && walked.get(placed)!.based && problems.length === 0) {
          let count = 0;
          for (const [definition, style, quoted] of read!.placed) {
            // A definition's value that the insert does not hold is written again for it.
            const repeated = !Object.hasOwn(set as object, definition.tag);
            const cost =
              (count++ >= FREE ? 1 : 0) +
              lookupCost(entity, definition) +
              (repeated ? Math.floor(definition.value.length / 32) : 0);
            if (cost > 0 && !spend(cost, here)) break;
            const problem = placedAttributeProblem(
              definition.tag,
              placeAttribute(definition, style, entity, placed.base),
              quoted,
            );
            if (problem) add("geometry", "error", problem);
          }
        }
        for (const [tag, value] of values) {
          if (placed && !tags.has(tag) && !unreadDefinitions.has(placed)) {
            add("undefined-attribute", "error", undefinedAttributeProblem(tag, placed.name));
          }
          const [problem, warning] =
            typeof value === "string" ? checkText(value) : ["must be a string", undefined];
          if (problem) add("text", "error", `attribute ${shown(tag)}: ${problem}`);
          if (warning) add("text", "warning", `attribute ${shown(tag)}: ${warning}`);
        }
        if (named && tags.size > 0) {
          const insert = `the insert ${shown(id)}`;
          const taken: [string, string][] = [];
          let count = 0;
          for (const tag of tags) {
            // A sound id has at most 64 characters, so only the tag, which each insert of the
            // block repeats, is paid for by its length.
            const cost = (count++ >= FREE ? 1 : 0) + Math.floor(tag.length / 32);
            if (cost > 0 && !spend(cost, here)) break;
            taken.push([
              insertAttributeHandle(id as string, tag),
              `the attribute ${shown(tag)} of ${insert}`,
            ]);
          }
          taken.push([insertEndHandle(id as string), `the end of the attributes of ${insert}`]);
          for (const [handle, what] of taken) {
            const clash = claim(handle, what);
            if (clash) add("id-handle", "error", clash);
          }
        }
        return;
      }
      if (entity.kind === "leader") {
        if (problems.length === 0) lintLeader(entity, add, block !== undefined);
        return;
      }
      if (entity.kind === "image") {
        if (r12) {
          add("image", "error", R12_ONLY.images);
          return;
        }
        lintImage(entity, add, problems.length === 0, named, here);
      }
      if (isDimension(entity)) {
        lintDimension(entity, add, problems.length === 0, block !== undefined, here);
        // The block of its picture takes handles from its id, or else from its place.
        if (!r12 && !block && (id === undefined || named)) {
          const place: DimensionPlace = {
            index,
            ...(id === undefined ? {} : { id: id as string }),
            ...(sheet ? { layout: sheet.name } : {}),
          };
          const what = pictureOwner(place, shown);
          for (const handle of pictureHandleList(validDimensionPictureHandles(place))) {
            const clash = claim(handle, what);
            if (clash) {
              add("id-handle", "error", clash);
              break;
            }
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
        const [problem, warning] = checkText(entity.value);
        if (problem) add("text", "error", problem);
        for (const [rule, found] of textProblems(entity)) add(rule, "error", found);
        if (warning) add("text", "warning", warning);
      }
      if (entity.kind === "paragraph") {
        if (r12) {
          add("paragraph", "error", R12_ONLY.paragraphs);
          return;
        }
        // A value is checked in its style's font, which decides what `%%c` draws. A style that is
        // not found has an error of its own.
        const style: unknown = entity.style;
        const font =
          style === undefined
            ? STANDARD_FONT
            : typeof style === "string"
              ? (stylesByKey.get(layerKey(style))?.font ??
                (isStandardTextStyle(style) ? STANDARD_FONT : undefined))
              : undefined;
        const [problem, columnBreak] =
          typeof entity.value === "string"
            ? checkParagraph(entity.value, font)
            : [paragraphValueProblem(entity.value, font), false];
        if (problem) add("paragraph", "error", problem);
        if (entity.columns !== undefined) {
          // Columns many paragraphs share are checked once.
          const given: unknown = entity.columns;
          let shape: string | undefined;
          if (typeof given === "object" && given !== null) {
            if (columnShapes.has(given)) shape = columnShapes.get(given);
            else columnShapes.set(given, (shape = paragraphColumnsShapeProblem(given)));
          } else shape = paragraphColumnsShapeProblem(given);
          const columns = shape ?? paragraphColumnsSizeProblem(given, entity.width, entity.height);
          if (columns) add("paragraph", "error", columns);
        } else if (columnBreak) add("paragraph", "warning", PARAGRAPH_COLUMN_BREAK);
        const { align, valign, lineSpacing, lineSpacingStyle } = entity;
        for (const [rule, field, value] of [
          ["text-align", "align", align],
          ["text-align", "valign", valign],
          ["paragraph", "lineSpacingStyle", lineSpacingStyle],
        ] as const) {
          const choice = value === undefined ? undefined : paragraphChoiceProblem(field, value);
          if (choice) add(rule, "error", choice);
        }
        const spacing = lineSpacing === undefined ? undefined : lineSpacingProblem(lineSpacing);
        if (spacing) add("paragraph", "error", spacing);
        const styled = entity.style === undefined ? {} : { style: entity.style };
        for (const [rule, found] of textProblems(styled)) add(rule, "error", found);
      }
      // A shape with a geometry error has no length worth a second message.
      const collapsed = problems.length === 0 ? zeroLength(entity) : undefined;
      if (collapsed) add("zero-length", "warning", collapsed);
    };
    // A list that many blocks share is read again for each, and paid for.
    if (again(entities) && !spend(entities.length, () => `the entities of ${space}`)) return;
    each(entities, at, "format", TYPED.entity, lintEntity, inBlock);
  };
  for (const block of blocks.values()) {
    lintAttributes(block);
    lintEntities(walked.get(block)!.entities, block);
  }
  lintEntities(listed<Entity>("entities", "format"), undefined);

  // The leading CAD app compares layout names by a table of its own, which `layoutNameKey` holds.
  const layoutNames = new Map<string, string>();
  /**
   * The box of what model space holds, worked out when a viewport first asks, or undefined when
   * the work it takes reaches its limit. The boxes of the layouts are worked out after it with the
   * same boxer, in the DXF writer's order, so the writer stops on nothing `lint` passed.
   */
  let modelBox: readonly [number, number, number, number] | null | undefined;
  let boxed = false;
  const boxOfModel = (): readonly [number, number, number, number] | null | undefined => {
    if (boxed) return modelBox;
    boxed = true;
    if (stopped !== undefined) return undefined;
    // A drawing whose entities cannot be measured has errors of its own above.
    modelBox = null;
    let boxOf: Boxer;
    try {
      // What the boxes do again counts against the checks' limit.
      boxOf = boxer(
        drawing.textStyles,
        drawing.blocks,
        undefined,
        undefined,
        undefined,
        [...dimensionStyles.values()],
        [...leaderStyles.values()],
        most - work,
        // The writer's walks have the whole limit, and so have these, so the two take one path.
        most,
      );
    } catch {
      return modelBox;
    }
    const spaces: [unknown, string][] = [[drawing.entities, "model space"]];
    for (const layout of filled(drawing.layouts as unknown) as Partial<Layout>[]) {
      spaces.push([layout?.entities, `layout ${shown(layout?.name)}`]);
    }
    for (const [entities, space] of spaces) {
      if (!Array.isArray(entities)) continue;
      const model = space === "model space";
      try {
        const box = boxOf(entities);
        if (model && entities.length > 0) modelBox = box ?? [0, 0, 1, 1];
      } catch {
        continue;
      }
      const at = boxOf.capped;
      if (at !== undefined) {
        if (model) modelBox = undefined;
        const index = (entities as readonly unknown[]).indexOf(at);
        stopped ??= `${at.kind} #${index} of ${space}, in the box of what ${space} draws`;
        break;
      }
    }
    work += boxOf.spent;
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
      // A list of frozen layers that another viewport holds too is read again, and paid for by
      // its length, as each long name in it that another place holds is by its own. That comes
      // first, so that a viewport the limit stops reports nothing, and no check reads its list.
      const frozenList: unknown =
        typeof viewport === "object" && viewport !== null ? viewport.frozenLayers : undefined;
      if (Array.isArray(frozenList)) {
        const where = () => `the frozen layers of viewport #${index} of layout ${shown(name)}`;
        if (again(frozenList) && !spend(frozenList.length, where)) return;
        let names = 0;
        for (const frozen of filled(frozenList)) names += repeat(frozen);
        if (names > 0 && !spend(names, where)) return;
      }
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
      // A file holds each layer a viewport freezes by its handle, which only a layer has.
      (viewport.frozenLayers ?? []).forEach((frozen, j) => {
        const absent = undefinedLayer(frozen);
        if (absent) add("undefined-layer", "error", `its frozenLayers[${j}]: ${absent}`);
      });
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
      if (model === undefined) return;
      const apart =
        !model ||
        model[0] > maxX ||
        model[2] < minX ||
        model[1] > maxY ||
        model[3] < minY ||
        !viewReaches(view, model);
      if (apart) {
        const turned = {
          width: view.width / view.scale,
          height: view.viewHeight,
          center: view.center,
          twist: view.twist,
        };
        add("viewport", "warning", viewportEmptyWarning(view.box, turned));
      }
    };
    each(viewports, `${at}.viewports`, "viewport", TYPED.viewport, lintViewport, inLayout);
    lintEntities(isList(layout.entities) ? layout.entities : [], undefined, { name, at });
  });

  // The DXF writer works the extents out within the same limit, so a drawing whose extents can
  // cost anything is boxed here too.
  if (boxable) boxOfModel();
  // Past the limit, an insert that places an xref may not have been read.
  for (const xref of stopped === undefined ? xrefs.values() : []) {
    if (placedXrefs.has(xref)) continue;
    out.push({
      rule: "xref",
      severity: "warning",
      message: `Xref ${shown(xref.name)}: ${XREF_UNPLACED}`,
      xref: xref.name,
    });
  }

  // A block that holds an insert of itself, directly or through the blocks it inserts. The walk
  // above paid for each list and long name this reads again, and past the limit it reads none.
  const insertedBy = new Map<Block, Block[]>();
  for (const block of stopped === undefined ? blocks.values() : []) {
    const found: Block[] = [];
    for (const entity of filled(walked.get(block)!.entities)) {
      const name: unknown =
        (entity as Entity | null)?.kind === "insert" ? (entity as Insert).block : undefined;
      const inner = typeof name === "string" ? blocks.get(layerKey(name)) : undefined;
      if (inner) found.push(inner);
    }
    insertedBy.set(block, found);
  }
  const cyclic = inCycles([...insertedBy.keys()], (block) => insertedBy.get(block)!);
  // The way back from a block of a cycle stays among the blocks that reach each other.
  const grouped = new Map<Block, Block[]>();
  for (const [block, group] of cyclic) {
    grouped.set(
      block,
      insertedBy.get(block)!.filter((inner) => cyclic.get(inner) === group),
    );
  }
  for (const block of blocks.values()) {
    if (!cyclic.has(block)) continue;
    const where = () => `the cycle of block ${shown(block.name)}`;
    const found = pathBack(block, (from) => grouped.get(from)!, spend, where);
    const names = found?.map((b) => b.name);
    const length = names?.reduce((sum, name) => sum + name.length, 0) ?? 0;
    const path = names && spend(Math.floor(length / 32), where) ? names : [block.name];
    const message = blockCycleProblem(path);
    out.push({ rule: "block-cycle", severity: "error", message, block: block.name });
  }

  if (stopped !== undefined) {
    out.push({
      rule: "check-capped",
      severity: "warning",
      message: `lint stopped repeating its checks of each insert, each dimension, each block of a cycle and each list that many places share at ${stopped}; a problem past there may be unreported, so toDXF refuses the drawing`,
    });
  }

  const given: unknown = options?.standard;
  if (given !== undefined) lintStandard(drawing, given, options?.discipline, version, out);
  const referenced: unknown = options?.xrefs;
  if (referenced !== undefined) lintReferenced(drawing, referenced, out);
  return out;
}

/** The blocks `lintReferenced` reads of a drawing given: none. */
const NO_BLOCKS: ReadonlyMap<string, Block> = new Map();

/**
 * Why a drawing given in `xrefs` is not drawn, as `referencedTree` finds it: a warning of the
 * xref of the drawing it is under, or an error for a value that is no drawing.
 */
function lintReferenced(drawing: Drawing, xrefs: unknown, out: Diagnostic[]): void {
  if (typeof xrefs !== "object" || xrefs === null || Array.isArray(xrefs)) {
    out.push({ rule: "xref", severity: "error", message: XREFS_GIVEN });
    return;
  }
  const { problems, unreported, unreportedShapes } = referencedTree(
    drawing,
    xrefs,
    () => NO_BLOCKS,
  );
  for (const { kind, chain } of problems) {
    out.push({
      rule: "xref",
      severity: kind === "shape" ? "error" : "warning",
      message: xrefChainProblem(kind, chain),
      ...(chain[0] === undefined ? {} : { xref: chain[0] }),
    });
  }
  if (unreportedShapes > 0) {
    out.push({
      rule: "xref",
      severity: "error",
      message: `${unreportedShapes} more values given in xrefs are neither a Drawing nor { drawing, xrefs }, so nothing is drawn for them`,
    });
  }
  if (unreported > unreportedShapes) {
    out.push({
      rule: "xref",
      severity: "warning",
      message: `${unreported - unreportedShapes} more drawings given in xrefs are not drawn, for the reasons above`,
    });
  }
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
function pathBack<T>(
  start: T,
  next: (from: T) => readonly T[],
  spend: (cost: number, where: () => string) => boolean,
  where: () => string,
): T[] | undefined {
  const cameFrom = new Map<T, T>();
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i]!;
    const ahead = next(from);
    if (!spend(1 + ahead.length, where)) return undefined;
    for (const to of ahead) {
      if (to === start) {
        const back = [start];
        for (let at = from; at !== start; at = cameFrom.get(at)!) back.push(at);
        back.push(start);
        return back.reverse();
      }
      if (!cameFrom.has(to)) {
        cameFrom.set(to, from);
        queue.push(to);
      }
    }
  }
  return undefined;
}

/**
 * The blocks that are in a cycle of inserts, each with the number of its group: those that
 * reach each other. A block that inserts itself is a group of its own. The walk keeps its own
 * stack, so a chain of any length is followed, and it reads each insert once.
 */
function inCycles<T>(nodes: readonly T[], next: (from: T) => readonly T[]): Map<T, number> {
  const order = new Map<T, number>();
  const low = new Map<T, number>();
  const held: T[] = [];
  const holding = new Set<T>();
  const out = new Map<T, number>();
  let groups = 0;
  for (const root of nodes) {
    if (order.has(root)) continue;
    const stack: [T, number][] = [[root, 0]];
    order.set(root, order.size);
    low.set(root, order.get(root)!);
    held.push(root);
    holding.add(root);
    while (stack.length > 0) {
      const top = stack.at(-1)!;
      const [node, at] = top;
      const after = next(node);
      if (at < after.length) {
        top[1]++;
        const to = after[at]!;
        if (!order.has(to)) {
          order.set(to, order.size);
          low.set(to, order.get(to)!);
          held.push(to);
          holding.add(to);
          stack.push([to, 0]);
        } else if (holding.has(to)) low.set(node, Math.min(low.get(node)!, order.get(to)!));
        continue;
      }
      stack.pop();
      const parent = stack.at(-1);
      if (parent) low.set(parent[0], Math.min(low.get(parent[0])!, low.get(node)!));
      if (low.get(node) !== order.get(node)) continue;
      const group: T[] = [];
      let member: T;
      do {
        member = held.pop()!;
        holding.delete(member);
        group.push(member);
      } while (member !== node);
      if (group.length > 1 || after.includes(node)) {
        for (const m of group) out.set(m, groups);
        groups++;
      }
    }
  }
  return out;
}

/** The text an attribute definition's geometry is checked as, from the fields that place it. */
function asText(definition: AttributeDefinition): Text {
  return {
    kind: "text",
    layer: definition.layer,
    at: definition.at,
    height: definition.height,
    value: definition.value,
    rotation: definition.rotation,
  };
}

/**
 * True for an entity whose box can cost anything: an insert, a dimension, a leader, a text too
 * long for a table of strings to keep, and a polyline that may have an arc or a width, whose box
 * pays for a long list read again.
 */
function costsBoxes(e: Readonly<Record<string, unknown>>): boolean {
  const kind = e.kind;
  if (kind === "text") return typeof e.value === "string" && e.value.length > KEYED;
  // A paragraph's layout reads its value again for each place, as a long text's measure does.
  if (kind === "paragraph") return typeof e.value === "string" && e.value.length >= LONG;
  if (kind === "polyline") {
    return Array.isArray(e.bulges) || Array.isArray(e.widths) || typeof e.width === "number";
  }
  return (
    kind === "insert" ||
    kind === "leader" ||
    kind === "linear-dimension" ||
    kind === "aligned-dimension" ||
    kind === "radius-dimension" ||
    kind === "diameter-dimension" ||
    kind === "jogged-radius-dimension"
  );
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
      if (e.points.length >= 2) {
        const sides = e.closed ? e.points.length : e.points.length - 1;
        out.push(...polylineSidesProblems(sides, e.bulges, e.width, e.widths));
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
    case "paragraph":
      finite("its position and rotation", ...e.at, e.rotation);
      size("height", e.height);
      if (e.width !== undefined) size("width", e.width);
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
    case "linear-dimension":
      finite("its points and its angle", ...e.from, ...e.to, ...e.line, e.angle ?? 0);
      break;
    case "aligned-dimension":
      finite("its points and its offset", ...e.from, ...e.to, e.offset);
      break;
    case "radius-dimension":
    case "diameter-dimension":
      finite("its points and its text's distance", ...e.center, ...e.point, e.textFromCenter ?? 0);
      break;
    case "jogged-radius-dimension":
      finite("its points", ...e.center, ...e.point, ...e.start, ...e.jog);
      break;
    case "leader":
      finite("its point", ...e.at);
      break;
    case "image":
      finite("its position and rotation", ...e.at, e.rotation ?? 0);
      size("width", e.width);
      size("height", e.height);
      break;
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
    case "paragraph":
    case "insert":
    case "linear-dimension":
    case "aligned-dimension":
    case "leader":
    case "image":
      return undefined;
  }
}

function same(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function sameWritten(a: Point, b: Point): boolean {
  return written(a[0]) === written(b[0]) && written(a[1]) === written(b[1]);
}
