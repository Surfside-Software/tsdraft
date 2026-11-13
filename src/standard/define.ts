// `defineStandard`: a document checked against the table of its fields, merged with its parent,
// checked as a whole, with every default filled in, and hashed.
import type { Block, Drawing, Entity, TextStyle } from "../drawing.ts";
import { canonical, fromJSON } from "../json.ts";
import { layerAuditKey, layerKey } from "../layers.ts";
import { DrawingError, type Diagnostic } from "../lint.ts";
import { paperInfo } from "../papers.ts";
import { written } from "../format.ts";
import { layerTwinProblem, shown } from "../rules.ts";
import { isRecord } from "../shape.ts";
import { sha256Text } from "../sha256.ts";
import { BUILT_IN_DOCUMENT, BUILT_IN_SPECIFIER } from "./default.ts";
import {
  SECTIONS,
  type Box,
  type Section,
  type Standard,
  type StandardDimensionStyle,
  type StandardDocument,
  type StandardLayer,
  type StandardLink,
  type StandardOptions,
  type StandardSheetFormat,
  type StandardTextRole,
  type StandardTitleBlock,
} from "./document.ts";
import type { CheckDocument, NamesOf, ParentOf } from "./literal.ts";
import { adopted, MADE, readStandardsWith } from "./made.ts";
import { capitals, inheritedDefaultProblem, referenceProblem } from "./rules.ts";
import {
  DOCUMENT,
  entriesObject,
  hashedJson,
  readDocument,
  same,
  withDefaults,
  type MapNode,
  type Problem,
  type RecordNode,
} from "./shape.ts";
import { PLAIN_TITLE_BLOCK_SPECIFIER, plainTitleBlock } from "./title-block.ts";

/**
 * Checks a standard's document, resolves it against its parent and returns the `Standard`.
 *
 * A literal mistake in the document is a compile error with the message of the runtime check:
 * a layer name AutoCAD refuses, a color outside 1 to 255, a lineweight AutoCAD does not have, a
 * font not in `FONTS`, a paper not in `PAPERS`, and a discipline, pen, linetype, layer, role,
 * dimension style, title block or sheet format that the standard and its parent do not have.
 * The compiler compares names exactly; the runtime check folds case as AutoCAD does.
 *
 * @param document - The standard, as a TypeScript literal or as the value `JSON.parse` gives.
 * @param options - `files` gives what a string `extends`, `block` or `preview` names.
 * @returns The standard: plain, frozen data, every default filled in and each name a field holds
 *   spelled as its entry spells it, with its `hash` and the `chain` of its parents.
 * @throws A `DrawingError` whose diagnostics have the rule `standard`, and the path of each
 *   problem in the document as `item`, such as `layers["A-WALL"].pen`.
 */
export function defineStandard<
  const D extends StandardDocument & CheckDocument<D, ParentOf<D, F>>,
  const F extends Readonly<Record<string, unknown>> = {},
>(
  document: D,
  options?: StandardOptions<F>,
): Standard<NamesOf<D, ParentOf<D, F>>, D["id"], D["version"]> {
  const problems: Problem[] = [];
  const standard = resolve(document, options?.files ?? {}, problems);
  if (!standard || problems.length > 0) throw standardError(problems);
  return standard as never;
}

function standardError(problems: readonly Problem[]): DrawingError {
  const diagnostics = problems.map(({ item, message }): Diagnostic => ({
    rule: "standard",
    severity: "error",
    message,
    ...(item ? { item } : {}),
  }));
  const count = problems.length === 1 ? "1 problem" : `${problems.length} problems`;
  const shownProblems = problems
    .slice(0, 10)
    .map(({ item, message }) => `- ${item ? `${item}: ` : ""}${message}`);
  const more = problems.length > 10 ? [`- and ${problems.length - 10} more`] : [];
  return new DrawingError(
    diagnostics,
    [`The standard has ${count}:`, ...shownProblems, ...more].join("\n"),
  );
}

/** `layerKey` of `Continuous`, the linetype every standard has. */
const CONTINUOUS = layerKey("Continuous");

/** How the names of a section are compared: AutoCAD's way for its names, and ids without case. */
const foldOf = (section: Section): ((name: string) => string) =>
  (DOCUMENT.fields[section]!.node as MapNode).fold!.key;

/** The fields of an entry of each section that name an entry of another, and that section. */
const REFERENCES: { readonly [S in Section]: readonly (readonly [string, Section])[] } = {
  disciplines: [],
  pens: [],
  linetypes: [],
  layers: [
    ["linetype", "linetypes"],
    ["pen", "pens"],
    ["discipline", "disciplines"],
  ],
  textRoles: [["discipline", "disciplines"]],
  scales: [["discipline", "disciplines"]],
  dimensionStyles: [
    ["role", "textRoles"],
    ["discipline", "disciplines"],
  ],
  titleBlocks: [["layer", "layers"]],
  sheetFormats: [
    ["titleBlock", "titleBlocks"],
    ["discipline", "disciplines"],
  ],
};

/** The entry of a section of the table. */
const entryNode = (section: Section): RecordNode =>
  (DOCUMENT.fields[section]!.node as MapNode).value as RecordNode;

/** A copy of plain data, frozen through. */
function frozen<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(frozen)) as T;
  if (typeof value !== "object" || value === null) return value;
  return Object.freeze(
    entriesObject(Object.entries(value).map(([key, item]) => [key, frozen(item)])),
  ) as T;
}

let plain: Drawing | undefined;
/** The plain title block's drawing, made once. The builder has checked each of its calls. */
const plainDrawing = (): Drawing => (plain ??= remember(frozen(plainTitleBlock())));

/**
 * The built-in standard's hash. `resolve` works it out with every check, which would cost each
 * load of the library several milliseconds, so the built-in standard is made from the table's
 * defaults alone, and test/standard.test.ts resolves its document and holds the two to one
 * standard. A change to what it states needs a new version, which the CHANGELOG gives, and then
 * this hash.
 */
const BUILT_IN_HASH = "5cf072f6c9b4d19975a1b417039da159acf4a4b491ec3599ba9f05dcc8405403";

let builtIn: Standard | undefined;
/** The built-in standard, made once. */
function builtInStandard(): Standard {
  if (builtIn) return builtIn;
  const { id, version, ...rest } = withDefaults(DOCUMENT, BUILT_IN_DOCUMENT, plainDrawing, "") as {
    readonly id: string;
    readonly version: string;
  } & Record<Section, Readonly<Record<string, unknown>>>;
  const sections = SECTIONS.map((section) => {
    const entries = rest[section];
    const names = Object.keys(entries).sort((a, b) => (layerKey(a) < layerKey(b) ? -1 : 1));
    return [section, Object.freeze(entriesObject(names.map((name) => [name, entries[name]])))];
  });
  builtIn = Object.freeze({
    id,
    version,
    title: id,
    ...rest,
    ...Object.fromEntries(sections),
    hash: BUILT_IN_HASH,
    chain: Object.freeze([]),
  }) as unknown as Standard;
  MADE.add(builtIn);
  return builtIn;
}

/** The canonical JSON of each title block's drawing, which is frozen, worked out once. */
const drawingJson = new WeakMap<object, string | undefined>();
const writtenDrawing = (value: object): string | undefined => {
  if (!drawingJson.has(value)) return undefined;
  let json = drawingJson.get(value);
  if (json === undefined) drawingJson.set(value, (json = canonical(value, "A drawing")));
  return json;
};
const remember = (drawing: Drawing): Drawing => {
  drawingJson.set(drawing, undefined);
  return drawing;
};

/**
 * Resolves a document, adding each problem to `problems`, or returns undefined when it cannot
 * get as far as a standard.
 */
function resolve(
  document: unknown,
  files: Readonly<Record<string, unknown>>,
  problems: Problem[],
): Standard | undefined {
  if (!readDocument(document, problems)) return undefined;
  const doc = document as StandardDocument;
  const add = (item: string, message: string) => problems.push({ item, message });

  let parent: Standard | undefined;
  if (doc.extends !== undefined) {
    parent = parentOf(doc.extends, files, add);
    if (!parent) return undefined;
    const loop = [parent, ...parent.chain].find(
      (link) => link.id === doc.id && link.version === doc.version,
    );
    if (loop) {
      add("extends", `The standard ${shown(doc.id)} version ${shown(doc.version)} extends itself`);
      return undefined;
    }
  }

  const fallback = <K extends keyof Standard>(field: K): Standard[K] =>
    (doc[field as keyof StandardDocument] ??
      parent?.[field] ??
      DOCUMENT.fields[field]!.default) as Standard[K];
  // A child keeps its parent's units, so the rest is checked in those.
  const paperUnits = parent ? parent.paperUnits : fallback("paperUnits");
  if (parent && doc.paperUnits !== undefined && doc.paperUnits !== parent.paperUnits) {
    add("paperUnits", `A standard keeps its parent's paperUnits, ${shown(parent.paperUnits)}`);
  }

  // A title block's drawing, from the document or from what a string names.
  const drawingOf = (value: unknown, path: string): Drawing | undefined => {
    let given = value;
    if (typeof value === "string") {
      if (value === PLAIN_TITLE_BLOCK_SPECIFIER) return plainDrawing();
      if (!Object.hasOwn(files, value)) {
        add(
          path,
          `${shown(value)} is not in options.files. The library reads no file: pass the value JSON.parse gives for it as files[${shown(value)}]`,
        );
        return undefined;
      }
      given = files[value];
    }
    try {
      return remember(frozen(fromJSON(given)));
    } catch (thrown) {
      if (!(thrown instanceof DrawingError)) throw thrown;
      for (const d of thrown.diagnostics) add(d.item ? `${path}.${d.item}` : path, d.message);
      return undefined;
    }
  };

  // Each section: the parent's entries, then the document's, by name as AutoCAD compares names.
  const merged = {} as Record<Section, Map<string, readonly [name: string, entry: unknown]>>;
  for (const section of SECTIONS) {
    const fold = foldOf(section);
    const entries = new Map<string, readonly [string, unknown]>();
    for (const [name, entry] of Object.entries(parent?.[section] ?? {})) {
      entries.set(fold(name), [name, entry]);
    }
    // `readDocument` has refused two names of one fold in the document.
    for (const [name, entry] of Object.entries(doc[section] ?? {})) {
      const key = fold(name);
      const path = `${section}[${JSON.stringify(name)}]`;
      const inherited = entries.get(key);
      if (entry === null) {
        if (inherited) entries.delete(key);
        else {
          add(
            path,
            `null removes the parent's entry of this name, and ${parent ? `the parent has no ${REFERENCE_WORDS[section]} of this name` : "the standard extends nothing"}`,
          );
        }
        continue;
      }
      entries.set(key, [
        inherited ? inherited[0] : name,
        withDefaults(entryNode(section), entry, drawingOf, path),
      ]);
    }
    merged[section] = entries;
  }

  const lookup = <T>(section: Section, name: string): T | undefined =>
    merged[section].get(foldOf(section)(name))?.[1] as T | undefined;
  /** The name of the entry of `section` that `name` names, as the standard spells it. */
  const spelling = (section: Section, name: string): string | undefined =>
    section === "linetypes" && layerKey(name) === CONTINUOUS
      ? "Continuous"
      : merged[section].get(foldOf(section)(name))?.[0];
  /** The parent's entries, which the standard holds as they are unless the document wrote them. */
  const kept = new Set(SECTIONS.flatMap((section) => Object.values(parent?.[section] ?? {})));
  const refer = (section: Section, name: unknown, path: string, owner?: Section): void => {
    if (typeof name === "string" && spelling(section, name) === undefined) {
      add(path, referenceProblem(section, name, owner));
    }
  };
  /** The rule of each field of an entry of `section` that names another entry. */
  const references = (
    section: Section,
    entry: object,
    path: string,
    inherited = kept.has(entry),
  ): void => {
    for (const [field, target] of REFERENCES[section]) {
      const name = (entry as Record<string, unknown>)[field];
      refer(target, name, `${path}.${field}`, inherited ? section : undefined);
    }
  };
  const sheetFiles = fallback("sheetFiles");
  const minTextHeight = fallback("minTextHeight");
  const defaultSheetFormat = doc.defaultSheetFormat ?? parent?.defaultSheetFormat;
  const defaultDimensionStyle = doc.defaultDimensionStyle ?? parent?.defaultDimensionStyle;
  for (const [field, section, name] of [
    ["defaultSheetFormat", "sheetFormats", defaultSheetFormat],
    ["defaultDimensionStyle", "dimensionStyles", defaultDimensionStyle],
  ] as const) {
    if (name === undefined || spelling(section, name) !== undefined) continue;
    add(
      field,
      doc[field] === undefined
        ? inheritedDefaultProblem(field, section, name)
        : referenceProblem(section, name),
    );
  }

  // Two names that AUDIT takes for one, which the merge by AutoCAD's own folding keeps apart.
  for (const section of ["layers", "linetypes"] as const) {
    const seen = new Map<string, string>();
    for (const [name] of merged[section].values()) {
      const key = layerAuditKey(name);
      const other = seen.get(key);
      const problem =
        other === undefined
          ? undefined
          : layerTwinProblem(name, other, section === "layers" ? "layer" : "linetype");
      if (problem) add(`${section}[${JSON.stringify(name)}]`, problem);
      else seen.set(key, name);
    }
  }

  /**
   * Each entry of a section with its name and its path in the document. Every name has passed
   * its rule here, and no rule lets a name hold a character that JSON escapes, so a path quotes
   * it as it is.
   */
  const each = <T>(section: Section) =>
    [...merged[section].values()].map(
      ([name, entry]) => [name, entry as T, `${section}["${name}"]`] as const,
    );
  /**
   * The rules of `byDiscipline` on an entry of `section`: each key a discipline, and each
   * discipline's fields as the entry's, through `check`.
   */
  const byDiscipline = <T extends object>(
    section: Section,
    entry: { readonly discipline?: string; readonly byDiscipline?: Record<string, T> },
    path: string,
    check: (fields: T, path: string) => void = () => {},
  ): void => {
    if (entry.byDiscipline === undefined) return;
    const where = `${path}.byDiscipline`;
    if (sheetFiles === "one-drawing") add(where, BY_DISCIPLINE_ONE_DRAWING);
    if (entry.discipline !== undefined) add(where, BY_DISCIPLINE_OF_ONE);
    const inherited = kept.has(entry);
    for (const [discipline, fields] of Object.entries(entry.byDiscipline)) {
      const at = `${where}[${JSON.stringify(discipline)}]`;
      refer("disciplines", discipline, at, inherited ? section : undefined);
      references(section, fields, at, inherited);
      check(fields, at);
    }
  };

  for (const [, layer, path] of each<StandardLayer>("layers")) {
    references("layers", layer, path);
    byDiscipline("layers", layer, path);
  }

  const roleHeight = (role: Partial<StandardTextRole>, path: string): void => {
    if (role.height !== undefined && written(role.height) < written(minTextHeight)) {
      add(
        `${path}.height`,
        `A text role's height, ${role.height}, is below the standard's minTextHeight, ${minTextHeight}`,
      );
    }
  };
  for (const [, role, path] of each<StandardTextRole>("textRoles")) {
    roleHeight(role, path);
    references("textRoles", role, path);
    byDiscipline("textRoles", role, path, roleHeight);
  }

  for (const [, scale, path] of each<object>("scales")) references("scales", scale, path);

  // A dimension style's name in AutoCAD is its id in capitals on a layout, and with a scale's id
  // after it in model space. No two of those names may be one to AutoCAD.
  const styleNames = new Map<string, string>();
  const scaleIds = [...merged.scales.values()].map(([name]) => name);
  for (const [id, style, path] of each<StandardDimensionStyle>("dimensionStyles")) {
    references("dimensionStyles", style, path);
    byDiscipline("dimensionStyles", style, path);
    const named = (name: string, what: string): void => {
      const key = layerAuditKey(name);
      const other = styleNames.get(key);
      if (other === undefined) styleNames.set(key, what);
      else {
        add(
          path,
          `${capital(what)} and ${other} have names that AutoCAD takes for one dimension style. Rename the style or the scale`,
        );
      }
    };
    named(capitals(id), `the dimension style ${shown(id)}`);
    for (const scale of scaleIds) {
      named(
        `${capitals(id)}-${scale}`,
        `the dimension style ${shown(id)} at the scale ${shown(scale)}`,
      );
    }
  }

  const papers = (paper: string, path: string) => {
    const info = paperInfo(paper);
    if (info && info.units !== paperUnits) {
      add(
        path,
        `The paper ${shown(paper)} is in ${shown(info.units)}, and the standard's paperUnits are ${shown(paperUnits)}`,
      );
    }
    return info;
  };
  const roleStyles = new Map(
    [...merged.textRoles.values()].map(([id]) => [layerAuditKey(capitals(id)), id] as const),
  );
  const blocks = new Map<string, { name: string; json: string; owner: string }>();
  const textStyles = new Map<string, { name: string; json: string; owner: string }>();
  const xrefs = new Map<string, { name: string; path: string; owner: string }>();
  for (const [id, block, path] of each<StandardTitleBlock>("titleBlocks")) {
    const info = papers(block.paper, `${path}.paper`);
    references("titleBlocks", block, path);
    if (!block.block && !block.xref) add(path, TITLE_BLOCK_FORM);
    if (block.block && block.blockName === undefined) add(`${path}.blockName`, BLOCK_NAME_MISSING);
    if (!block.block && block.blockName !== undefined) add(`${path}.blockName`, BLOCK_NAME_ALONE);
    if (block.preview && !block.xref) add(`${path}.preview`, PREVIEW_ALONE);
    if (info) {
      boxIn(
        block.drawingArea,
        [0, 0, info.width, info.height],
        "the paper",
        `${path}.drawingArea`,
        add,
      );
    }
    if (block.box) boxIn(block.box, block.drawingArea, "the drawing area", `${path}.box`, add);
    const drawn =
      block.block && block.blockName !== undefined
        ? titleBlockDrawing(block.block, block.blockName, `${path}.block`, paperUnits, lookup, add)
        : undefined;
    for (const [tag, field] of Object.entries(block.fields)) {
      const at = `${path}.fields[${JSON.stringify(tag)}]`;
      if (field.box && info) {
        boxIn(field.box, [0, 0, info.width, info.height], "the paper", `${at}.box`, add);
      }
      if (field.source !== "attribute" && !block.xref)
        add(`${at}.source`, filledByAutoCAD(field.source));
      if (
        (field.source === "fileName" || field.source === "layoutName") &&
        sheetFiles === "one-drawing"
      ) {
        add(`${at}.source`, READS_A_NAME);
      }
      if (field.source === "attribute") {
        if (!block.block) add(at, ATTRIBUTE_WITHOUT_BLOCK);
        else if (drawn && !drawn.block.attributes?.some((a) => a.tag === tag)) {
          add(
            at,
            `The block ${shown(drawn.block.name)} has no attribute with the tag ${shown(tag)}, which a field whose source is "attribute" is written in`,
          );
        }
      }
    }
    if (block.preview && block.preview.units !== paperUnits) {
      add(`${path}.preview`, unitsProblem(block.preview.units, paperUnits));
    }
    if (drawn) {
      const owned = (
        kind: "block" | "text style",
        found: Map<string, { name: string; json: string; owner: string }>,
        name: string,
        json: string,
      ): void => {
        const key = layerAuditKey(name);
        const other = found.get(key);
        if (other === undefined) found.set(key, { name, json, owner: id });
        else if (other.json !== json) {
          add(
            `${path}.block`,
            `The title blocks ${shown(other.owner)} and ${shown(id)} both hold a ${kind} ${shown(name)}, with different definitions. A drawing holds one ${kind} of a name: give one of them another name`,
          );
        }
      };
      for (const b of drawn.blocks) owned("block", blocks, b.name, canonical(b));
      for (const style of drawn.textStyles) {
        owned("text style", textStyles, style.name, canonical(style));
        const role = roleStyles.get(layerAuditKey(style.name));
        if (role !== undefined) {
          add(
            `${path}.block`,
            `The title block's text style ${shown(style.name)} has the name of the text style of the role ${shown(role)}. Give one of them another name`,
          );
        }
      }
    }
    if (block.xref) {
      const key = layerAuditKey(block.xref.name);
      const other = xrefs.get(key);
      if (other === undefined) xrefs.set(key, { ...block.xref, owner: id });
      else if (other.path !== block.xref.path) {
        add(
          `${path}.xref.path`,
          `The title blocks ${shown(other.owner)} and ${shown(id)} both have an xref ${shown(block.xref.name)}, at different paths. A drawing holds one xref of a name: give one of them another name`,
        );
      }
    }
  }
  for (const [key, xref] of xrefs) {
    const block = blocks.get(key);
    if (block) {
      add(
        `titleBlocks[${JSON.stringify(xref.owner)}].xref.name`,
        `The xref ${shown(xref.name)} has the name of the block ${shown(block.name)} of the title block ${shown(block.owner)}. An xref is a block to AutoCAD: give one of them another name`,
      );
    }
  }

  for (const [, format, path] of each<StandardSheetFormat>("sheetFormats")) {
    papers(format.paper, `${path}.paper`);
    references("sheetFormats", format, path);
    const block = lookup<StandardTitleBlock>("titleBlocks", format.titleBlock);
    if (!block) continue;
    if (block.paper !== format.paper) {
      add(
        `${path}.paper`,
        `The sheet format's paper, ${shown(format.paper)}, is not its title block's, ${shown(block.paper)}`,
      );
    }
    for (const [zone, box] of Object.entries(format.zones)) {
      boxIn(
        box,
        block.drawingArea,
        "the title block's drawing area",
        `${path}.zones[${JSON.stringify(zone)}]`,
        add,
      );
    }
  }

  if (problems.length > 0) return undefined;

  /**
   * `entry` with each field that names another entry, and each key of its `byDiscipline`, spelled
   * as that entry is, so that neither the standard nor its hash depends on how a name was written.
   */
  const respelled = (section: Section, entry: Record<string, unknown>): unknown => {
    let out: Record<string, unknown> | undefined;
    for (const [field, target] of REFERENCES[section]) {
      const name = entry[field];
      if (typeof name !== "string") continue;
      const spelled = spelling(target, name)!;
      if (spelled !== name) (out ??= { ...entry })[field] = spelled;
    }
    const by = entry.byDiscipline as Readonly<Record<string, Record<string, unknown>>> | undefined;
    if (by) {
      let changed = false;
      const disciplines = Object.entries(by).map(([discipline, fields]) => {
        const name = spelling("disciplines", discipline)!;
        const own = respelled(section, fields);
        changed ||= name !== discipline || own !== fields;
        return [name, own] as const;
      });
      if (changed) (out ??= { ...entry }).byDiscipline = Object.freeze(entriesObject(disciplines));
    }
    return out ? Object.freeze(out) : entry;
  };
  const sections = Object.fromEntries(
    SECTIONS.map((section) => {
      // An entry's key is `layerKey` of its name, or for an id its letters in lower case,
      // which is the same.
      const entries = merged[section];
      const sorted = [...entries.keys()].sort().map((key) => {
        const [name, entry] = entries.get(key)!;
        return [name, respelled(section, entry as Record<string, unknown>)] as const;
      });
      return [section, Object.freeze(entriesObject(sorted))];
    }),
  );
  const body = {
    id: doc.id,
    version: doc.version,
    title: doc.title ?? doc.id,
    paperUnits,
    minTextHeight,
    linetypeScale: fallback("linetypeScale"),
    plotStyle: fallback("plotStyle"),
    sheetFiles,
    ...(defaultSheetFormat === undefined
      ? {}
      : { defaultSheetFormat: spelling("sheetFormats", defaultSheetFormat) }),
    ...(defaultDimensionStyle === undefined
      ? {}
      : { defaultDimensionStyle: spelling("dimensionStyles", defaultDimensionStyle) }),
    ...sections,
  };
  const chain = parent
    ? [{ id: parent.id, version: parent.version, hash: parent.hash }, ...parent.chain]
    : [];
  // Each entry is frozen already, and a parent's entries are the parent's own.
  const standard = Object.freeze({
    ...body,
    hash: sha256Text(hashedJson(body, writtenDrawing)),
    chain: frozen(chain),
  }) as unknown as Standard;
  MADE.add(standard);
  return standard;
}

/** The parent a document's `extends` names, or undefined after adding the problem. */
function parentOf(
  value: string | Standard,
  files: Readonly<Record<string, unknown>>,
  add: (item: string, message: string) => void,
): Standard | undefined {
  let given: unknown = value;
  if (typeof value === "string") {
    if (value === BUILT_IN_SPECIFIER) return builtInStandard();
    if (!Object.hasOwn(files, value)) {
      add(
        "extends",
        `${shown(value)} is not in options.files. The library reads no file: pass the standard it names as files[${shown(value)}]`,
      );
      return undefined;
    }
    given = files[value];
  }
  const standard = adopted(given);
  if (!standard) {
    add(
      "extends",
      "The parent is not a standard: give extends a Standard that defineStandard made, unchanged, or a string that options.files gives one for",
    );
  }
  return standard;
}

/**
 * A standard from another copy of tsdraft, as data: read again as a document with no `extends`,
 * and undefined unless its hash is its content's.
 */
function readAgain(given: unknown): Standard | undefined {
  const { hash, chain, ...rest } = isRecord(given) ? given : ({} as Record<string, unknown>);
  const links =
    Array.isArray(chain) &&
    chain.every(
      (link) =>
        isRecord(link) &&
        typeof link.id === "string" &&
        typeof link.version === "string" &&
        typeof link.hash === "string",
    );
  const again = links && typeof hash === "string" ? resolve(rest, {}, []) : undefined;
  if (!again || again.hash !== hash) return undefined;
  // Its entries are `again`'s, whose drawings' JSON is known.
  const standard = Object.freeze({
    ...again,
    chain: frozen(
      (chain as StandardLink[]).map(({ id, version, hash }) => ({ id, version, hash })),
    ),
  }) as Standard;
  MADE.add(standard);
  return standard;
}
readStandardsWith(readAgain);

/** The closure of a title block's block: what a drawing that inserts it has to hold. */
interface Drawn {
  readonly block: Block;
  readonly blocks: readonly Block[];
  readonly textStyles: readonly TextStyle[];
}

/**
 * Checks the drawing of a title block's block against the standard, and returns its block with
 * every block it inserts and every text style they use, or undefined when it has no such block.
 */
function titleBlockDrawing(
  drawing: Drawing,
  blockName: string,
  path: string,
  paperUnits: string,
  lookup: <T>(section: Section, name: string) => T | undefined,
  add: (item: string, message: string) => void,
): Drawn | undefined {
  if (drawing.units !== paperUnits) add(path, unitsProblem(drawing.units, paperUnits));
  const byName = new Map((drawing.blocks ?? []).map((b) => [layerKey(b.name), b]));
  const start = byName.get(layerKey(blockName));
  if (!start) {
    add(path, `The title block's drawing has no block ${shown(blockName)}, which blockName names`);
    return undefined;
  }
  for (const [field, what] of [
    ["dimensionStyles", "a dimension style"],
    ["layouts", "a layout"],
    ["xrefs", "an xref"],
  ] as const) {
    if ((drawing[field]?.length ?? 0) > 0) add(path, `A title block's drawing cannot hold ${what}`);
  }
  const everything = [drawing.entities, ...(drawing.blocks ?? []).map((b) => b.entities)];
  if (everything.some((entities) => entities.some((e) => e.kind.endsWith("-dimension")))) {
    add(path, "A title block's drawing cannot hold a dimension");
  }
  for (const linetype of drawing.linetypes ?? []) {
    const own = lookup<{ description: string; pattern: readonly number[] }>(
      "linetypes",
      linetype.name,
    );
    if (!own) {
      add(
        path,
        `The title block's drawing defines the linetype ${shown(linetype.name)}, which the standard does not have`,
      );
    } else if (
      !same({ ...own }, { description: linetype.description, pattern: linetype.pattern })
    ) {
      add(
        path,
        `The title block's drawing defines the linetype ${shown(linetype.name)} otherwise than the standard does`,
      );
    }
  }

  const blocks = [start];
  const styleNames = new Set<string>();
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const layers = [
      ...block.entities.map((e: Entity) => e.layer),
      ...(block.attributes ?? []).map((a) => a.layer),
    ];
    for (const layer of new Set(layers)) {
      if (layer !== "0" && lookup("layers", layer) === undefined) {
        add(
          path,
          `The block ${shown(block.name)} draws on the layer ${shown(layer)}, which is not a layer of the standard. A title block draws on layer 0 or on layers of the standard`,
        );
      }
    }
    for (const e of block.entities) {
      if (e.kind === "text" && e.style !== undefined) styleNames.add(layerKey(e.style));
      if (e.kind !== "insert") continue;
      const inserted = byName.get(layerKey(e.block));
      if (inserted && !blocks.includes(inserted)) blocks.push(inserted);
    }
    for (const a of block.attributes ?? [])
      if (a.style !== undefined) styleNames.add(layerKey(a.style));
  }
  const textStyles = (drawing.textStyles ?? []).filter((s) => styleNames.has(layerKey(s.name)));
  return { block: start, blocks, textStyles };
}

/** Adds a problem when `box` is not a box, or reaches past `outer`, which is `what`. */
function boxIn(
  box: Box,
  outer: Box,
  what: string,
  path: string,
  add: (item: string, message: string) => void,
): void {
  const [left, bottom, right, top] = box.map(written) as unknown as Box;
  if (!(left < right && bottom < top)) {
    add(
      path,
      "A box is [left, bottom, right, top], with left less than right and bottom less than top",
    );
    return;
  }
  const [l, b, r, t] = outer.map(written) as unknown as Box;
  if (left < l || bottom < b || right > r || top > t) {
    add(path, `The box reaches past ${what}, [${outer.join(", ")}]`);
  }
}

const capital = (what: string): string => what.charAt(0).toUpperCase() + what.slice(1);

const unitsProblem = (units: string, paperUnits: string): string =>
  `The drawing is in ${shown(units)}, and the standard's paperUnits are ${shown(paperUnits)}. A title block is drawn in paper units`;

const filledByAutoCAD = (source: string): string =>
  `A field whose source is ${shown(source)} is a field of the xref's drawing that AutoCAD fills, and this title block has no xref`;

const REFERENCE_WORDS: Record<Section, string> = {
  disciplines: "discipline",
  pens: "pen",
  linetypes: "linetype",
  layers: "layer",
  textRoles: "text role",
  scales: "scale",
  dimensionStyles: "dimension style",
  titleBlocks: "title block",
  sheetFormats: "sheet format",
};

const BY_DISCIPLINE_ONE_DRAWING =
  "byDiscipline holds only under sheetFiles \"sheet-per-file\", where each discipline's model is a drawing of its own. In one drawing a name has one set of properties, so give each discipline's entry a name of its own";
const BY_DISCIPLINE_OF_ONE =
  "An entry of one discipline has one set of fields. byDiscipline is for an entry that every discipline shares";
const TITLE_BLOCK_FORM =
  "A title block has a block that tsdraft draws, an xref of the firm's own drawing, or both";
const BLOCK_NAME_MISSING = "A title block with a block names it with blockName";
const BLOCK_NAME_ALONE = "blockName names the block of block, and this title block has no block";
const PREVIEW_ALONE = "A preview is drawn in place of an xref, and this title block has no xref";
const READS_A_NAME =
  "Under sheetFiles \"one-drawing\" no field reads the file's name or the layout's name. One drawing has one file name, and an xref that every layout shares shows one layout's name on every sheet. Make the field an attribute";
const ATTRIBUTE_WITHOUT_BLOCK =
  'A field whose source is "attribute" is written in an attribute of the title block\'s block, and this title block has no block';

/** The built-in standard: its layers, pens, roles, scales, dimension style and plain title block. */
export const BUILT_IN_STANDARD: BuiltInStandard = builtInStandard() as BuiltInStandard;

export type BuiltInStandard = Standard<
  NamesOf<typeof BUILT_IN_DOCUMENT, undefined>,
  (typeof BUILT_IN_DOCUMENT)["id"],
  (typeof BUILT_IN_DOCUMENT)["version"]
>;
