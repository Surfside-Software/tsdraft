// The one table of a standard's fields. It gives each field's type, the rule of a single value,
// its default and whether the hash reads it. `readDocument` checks a document against it,
// `defineStandard` fills the defaults from it and the hash leaves out what it marks, and
// `standardSchema` writes the JSON Schema from it, so the three cannot drift apart.
import {
  isBoolean,
  isNumber,
  isObjectOrArray,
  isPlainRecord,
  isString,
  type Json,
} from "../guards.ts";
import type { Drawing } from "../drawing.ts";
import {
  ARROWHEAD_BLOCKS,
  ARROWHEADS,
  DEFAULT_ARROWHEAD,
  DEFAULT_LEADER_ARROWHEAD,
  DIMENSION_FRACTIONS,
  DIMENSION_TEXT_FITS,
  DIMENSION_RADIAL_TEXTS,
  DIMENSION_ANGLE_UNITS,
  DIMENSION_ARC_SYMBOLS,
  MAX_ANGLE_PRECISION,
  JOG_ANGLE,
  DIMENSION_TEXT_PLACEMENTS,
  DIMENSION_UNITS,
  FEET_INCH_ZEROS,
  LEADER_ARROWHEADS,
  ZERO_SUPPRESSIONS,
} from "../arrowheads.ts";
import { FONTS } from "../fonts.ts";
import { layerKey, rejectedNameCharacter } from "../layers.ts";
import { LINEWEIGHTS } from "../linetypes.ts";
import { DEFAULT_PLOT_STYLE_TABLE, PAPERS, PLOT_STYLE_TABLES } from "../papers.ts";
import {
  arrowheadProblem,
  attributeTagProblem,
  dimensionStyleLookProblem,
  fractionProblem,
  fractionScaleProblem,
  textFitProblem,
  radialTextProblem,
  jogAngleProblem,
  angleUnitsProblem,
  anglePrecisionProblem,
  angleZerosProblem,
  arcSymbolProblem,
  textPlacementProblem,
  blockNameProblem,
  dimensionPrefixProblem,
  dimensionStyleNameProblem,
  feetInchZerosProblem,
  fontProblem,
  idKey,
  idProblem,
  layerColorProblem,
  layerNameProblem,
  LEADER_ATTACHMENTS,
  LEADER_DIRECTIONS,
  LEADER_SHAFT_KINDS,
  LEADER_VERTICAL_ATTACHMENTS,
  leaderArrowheadProblem,
  leaderAttachmentProblem,
  leaderDirectionProblem,
  leaderShaftKindProblem,
  leaderSizeProblem,
  leaderVerticalAttachmentProblem,
  lineweightValueProblem,
  linetypeProblem,
  linetypeScaleProblem,
  measurementScaleProblem,
  notNegativeProblem,
  obliqueAngleProblem,
  paperProblem,
  plainDimensionText,
  plotStyleProblem,
  precisionProblem,
  ratioProblem,
  shown,
  sizeProblem,
  textGapProblem,
  textProblem,
  widthFactorProblem,
  xrefPathProblem,
  zeroSuppressionProblem,
  zerosOfUnitsProblem,
} from "../rules.ts";
import { canonical } from "../json.ts";
import { PLAIN_OBJECT } from "../shape.ts";
import { VERSION } from "../version.ts";
import type {
  DimensionStyleDocument,
  DimensionStyleFieldsDocument,
  DisciplineDocument,
  LayerDocument,
  LayerFieldsDocument,
  LeaderStyleDocument,
  LeaderStyleFieldsDocument,
  LinetypeDocument,
  PenDocument,
  ScaleDocument,
  SheetFormatDocument,
  StandardDocument,
  TextRoleDocument,
  TextRoleFieldsDocument,
  TitleBlockDocument,
  TitleBlockFieldDocument,
  WritingDocument,
  XrefDocument,
} from "./document.ts";
import {
  dimensionStyleIdProblem,
  styleNameStandardProblem,
  FILL_KEYS,
  fillProblem,
  layerZeroProblem,
  leaderStyleIdProblem,
  paperUnitsProblem,
  roleNameProblem,
  scaleLabelProblem,
  sheetFilesProblem,
  SOURCES,
  sourceProblem,
  standardIdProblem,
  standardVersionProblem,
  writingUnitsProblem,
} from "./rules.ts";

/** A JSON Schema, or a part of one: the keywords the standard's schema writes. */
export interface Schema {
  readonly $schema?: string;
  readonly $id?: string;
  readonly $ref?: string;
  readonly $comment?: Schema;
  readonly $defs?: { readonly [name: string]: Schema };
  readonly title?: string;
  readonly description?: string;
  readonly type?: "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";
  readonly enum?: readonly (string | number)[];
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly maxLength?: number;
  readonly items?: Schema;
  readonly not?: Schema;
  readonly anyOf?: readonly Schema[];
  readonly properties?: { readonly [name: string]: Schema };
  readonly propertyNames?: Schema;
  readonly additionalProperties?: Schema | boolean;
  readonly required?: readonly string[];
  readonly default?: Json;
}

/**
 * A value of a standard: a value of its document with each default filled in and each drawing
 * read, which `drawingOf` leaves out when it cannot read it.
 */
export type StandardValue =
  | Json
  | Drawing
  | readonly StandardValue[]
  | { readonly [key: string]: StandardValue | undefined };

/** A field of an object of the document. */
export interface Field {
  readonly node: Node;
  readonly description: string;
  /** Required in every document. */
  readonly required?: true;
  /** Required in a document that extends nothing. */
  readonly root?: true;
  /** What a document that leaves the field out has. A default, once released, never changes. */
  readonly default?: Json;
  /** Left out of the hash: provenance, and text for people that no rule reads. */
  readonly unhashed?: true;
  /** Left out of the `Standard`. */
  readonly dropped?: true;
}

type Check<T> = (value: T) => string | undefined;

export type Node =
  | { readonly kind: "string"; readonly schema: Schema; readonly check?: Check<string> }
  | { readonly kind: "number"; readonly schema: Schema; readonly check?: Check<number> }
  | { readonly kind: "boolean" }
  | { readonly kind: "numbers"; readonly schema: Schema; readonly check?: Check<readonly number[]> }
  | RecordNode
  | MapNode
  | { readonly kind: "drawing"; readonly description: string }
  | { readonly kind: "extends" };

export interface RecordNode {
  readonly kind: "record";
  /** Its name among the schema's definitions. */
  readonly name: string;
  /** What it is, for a message, such as "a layer". */
  readonly what: string;
  readonly fields: Readonly<Record<string, Field>>;
  /**
   * A rule of the whole object, given the key it has in its map, reported at the object. It
   * takes the object as the document type `record` was given it for.
   */
  readonly check?: (value: never, key: string) => string | undefined;
}

export interface MapNode {
  readonly kind: "map";
  /** The schema of its keys. */
  readonly keys: Schema;
  readonly key: Check<string>;
  /** For keys that are names: the form two are compared in, and the problem of a second. */
  readonly fold?: Fold;
  readonly value: Node;
  /** True for a section, where `null` removes the parent's entry. */
  readonly nullable?: true;
}

export interface Fold {
  readonly key: (name: string) => string;
  /** What is wrong with a key whose fold is that of the key `first` before it. */
  readonly twin: (first: string) => string;
}

type Keys = { readonly keys: Schema; readonly key: Check<string>; readonly fold?: Fold };

/** The fields of the document type `T`, each in the table, so a new field is a compile error here. */
type FieldsOf<T> = { readonly [K in Exclude<keyof T, "$comment">]-?: Field };

function record<T>(
  name: string,
  what: string,
  fields: FieldsOf<T>,
  check?: (value: T, key: string) => string | undefined,
): RecordNode {
  return check
    ? { kind: "record", name, what, fields, check }
    : { kind: "record", name, what, fields };
}

/** The same fields, none required and none with a default: the fields `byDiscipline` replaces. */
function replacing<F extends Readonly<Record<string, Field>>>(fields: F): F {
  const out: Record<string, Field> = {};

  for (const [key, field] of Object.entries(fields)) {
    const { required: _, default: __, root: ___, ...rest } = field;
    out[key] = rest;
  }

  // SAFETY: `out` has each key of `fields`, and a field of each.
  return out as F;
}

// The characters of each kind of text, as a class of a regular expression that reads the same
// with and without the `u` flag: it names only characters up to U+FFFF, so a character above
// U+FFFF matches it in neither reading.
const hex = (code: number): string => `\\u${code.toString(16).padStart(4, "0")}`;

function characterClass(allowed: (code: number) => boolean): string {
  let out = "";

  for (let code = 0; code <= 0xffff; code++) {
    if (!allowed(code)) continue;
    let end = code;

    while (end < 0xffff && allowed(end + 1)) end++;
    out += end === code ? hex(code) : `${hex(code)}-${hex(end)}`;
    code = end;
  }

  return `[${out}]`;
}

const surrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdfff;

const isText = (code: number): boolean =>
  code >= 0x20 && code !== 0x7f && !surrogate(code) && !(code >= 0xe800 && code <= 0xe8ff);

const isNameCharacter = (code: number): boolean =>
  code >= 0x20 &&
  code !== 0x7f &&
  !surrogate(code) &&
  !'<>/\\":;?*|=`^,'.includes(String.fromCharCode(code)) &&
  rejectedNameCharacter(String.fromCharCode(code)) === undefined;

/** A word in any case of its letters, for a lookahead. */
const anyCase = (word: string): string =>
  [...word].map((c) => (/[a-z]/i.test(c) ? `[${c.toUpperCase()}${c.toLowerCase()}]` : c)).join("");

/** True for a text character that is none of `characters`. */
const textBut =
  (characters: string) =>
  (code: number): boolean =>
    isText(code) && !characters.includes(String.fromCharCode(code));

const patterns = {
  text: () => `^${characterClass(isText)}*$`,
  /** A dimension style's suffix: a text with none of the characters the leading CAD app reads as formatting. */
  suffix: () => `^${characterClass(textBut("\\{}"))}*$`,
  /** A prefix: a suffix with no `<>`, which the leading CAD app takes for the place of the measurement. */
  prefix: () => `^(?![\\s\\S]*<>)${characterClass(textBut("\\{}"))}*$`,
  /**
   * An xref's path: from the folder of the drawing's file, with no `* ? < > | : "` and no
   * multibyte escape, and not ending in `.dxf`, or in a dot other than the one after `.dwg`.
   */
  xrefPath: () =>
    `^(?![/\\\\]|[A-Za-z]:)(?![\\s\\S]*\\.[Dd][Xx][Ff]$)(?=(?![\\s\\S]*\\.$)|[\\s\\S]*\\.[Dd][Ww][Gg]\\.$)(?![\\s\\S]*\\\\[Mm]\\+[1-5][0-9A-Fa-f]{4})${characterClass(textBut('*?<>|:"'))}+$`,
  tag: () => `^${characterClass((c) => isText(c) && !(c >= 0x61 && c <= 0x7a))}+$`,
  property: () => `^${characterClass((c) => c >= 0x20 && c !== 0x7f && !surrogate(c))}{1,64}$`,
  /** A name the leading CAD app takes for a layer, a linetype or a block, with `exclude` refused in any case. */
  name: (...exclude: string[]) =>
    `^(?! )(?![\\s\\S]* $)${exclude.length ? `(?!(?:${exclude.map(anyCase).join("|")})$)` : ""}${characterClass(isNameCharacter)}{1,255}$`,
  id: (...exclude: string[]) =>
    `^${exclude.length ? `(?!(?:${exclude.map(anyCase).join("|")})$)` : ""}[A-Za-z0-9._-]{1,64}$`,
};

// Each pattern is worked out when a schema is written, not when the library loads.
const lazy = (pattern: () => string, extra: Schema = {}): Schema =>
  Object.defineProperty({ ...extra }, "pattern", { get: pattern, enumerable: true });

const string = (schema: Schema = {}, check?: Check<string>): Node =>
  check ? { kind: "string", schema, check } : { kind: "string", schema };

const number = (schema: Schema = {}, check?: Check<number>): Node =>
  check ? { kind: "number", schema, check } : { kind: "number", schema };

const boolean: Node = { kind: "boolean" };
const text: Node = string(lazy(patterns.text), textProblem);

const box: Node = {
  kind: "numbers",
  schema: { minItems: 4, maxItems: 4, description: "[left, bottom, right, top] on the paper" },
  check: (value) =>
    value.length === 4 ? undefined : "A box is four numbers: [left, bottom, right, top]",
};

const point: Node = {
  kind: "numbers",
  schema: { minItems: 2, maxItems: 2 },
  check: (value) => (value.length === 2 ? undefined : "A point is two numbers: [x, y]"),
};

/** Two keys that are one: by `idKey`, or by `layerKey` for `names`, among `owner`'s `what`s. */
const twins = (owner: string, what: string, names?: true): Fold => ({
  key: names ? layerKey : idKey,
  twin: (first) =>
    names
      ? `${owner} already has a ${what} of this name, as ${shown(first)}. The leading CAD app takes the two names for one`
      : `${owner} already has a ${what} of this id, as ${shown(first)}. Ids are compared without regard to case`,
});

/** Keys that are ids of `owner`'s `what`s. */
const ids = (
  owner: string,
  what: string,
  check: Check<string> = () => undefined,
  ...exclude: string[]
): Keys => ({
  keys: lazy(() => patterns.id(...exclude)),
  key: (key: string) => idProblem(key) ?? check(key),
  fold: twins(owner, what),
});

const map = (keys: Keys, value: Node, nullable?: true): Node =>
  nullable ? { kind: "map", ...keys, value, nullable } : { kind: "map", ...keys, value };

const discipline: Field = {
  node: string(),
  description:
    "The discipline the entry belongs to, a discipline of the standard. An entry without one belongs to every discipline",
};

const description: Field = {
  node: text,
  description: "For people and the specimen. No rule reads it",
  unhashed: true,
};

const DISCIPLINE = record<DisciplineDocument>("discipline", "a discipline", {
  title: { node: text, description: "For people", required: true, unhashed: true },
});

const PEN = record<PenDocument>("pen", "a pen", {
  lineweight: {
    node: number({ enum: LINEWEIGHTS }, lineweightValueProblem),
    description: "One of the leading CAD app's lineweights, in millimetres",
    required: true,
  },
  description,
});

const LINETYPE = record<LinetypeDocument>(
  "linetype",
  "a linetype",
  {
    description: {
      node: string(lazy(patterns.text, { maxLength: 249 })),
      description: "What the leading CAD app's LINETYPE command shows for it",
      default: "",
    },
    pattern: {
      node: { kind: "numbers", schema: { maxItems: 12, not: { minItems: 1, maxItems: 1 } } },
      description:
        "2 to 12 lengths in paper units, before linetypeScale, or none for a solid line: a dash above 0, a gap below 0 and a dot 0",
      required: true,
    },
  },
  (value) =>
    linetypeProblem(
      "linetype",
      value.description === undefined ? "" : value.description,
      value.pattern,
    ),
);

const LAYER_FIELDS = {
  color: {
    node: number({ type: "integer", minimum: 1, maximum: 255 }, layerColorProblem),
    description: "A number from 1 to 255 in the color index CAD programs share",
    required: true,
  },
  linetype: {
    node: string(),
    description: "A linetype of the standard, or Continuous",
    default: "Continuous",
  },
  pen: {
    node: string(),
    description:
      'A pen of the standard. Without one the layer has the leading CAD app\'s lineweight "Default"',
  },
  plot: { node: boolean, description: "Whether the layer plots", default: true },
  description,
} as const satisfies FieldsOf<LayerFieldsDocument>;

const LAYER_REPLACED = record<LayerFieldsDocument>(
  "layerFields",
  "a layer's fields for a discipline",
  replacing(LAYER_FIELDS),
);

const byDiscipline = (fields: RecordNode): Field => ({
  node: map(ids("byDiscipline", "discipline"), fields),
  description:
    "Fields that replace the entry's own in each discipline's drawings, by discipline. Only under sheetFiles \"sheet-per-file\"",
});

const LAYER = record<LayerDocument>("layer", "a layer", {
  ...LAYER_FIELDS,
  discipline,
  byDiscipline: byDiscipline(LAYER_REPLACED),
});

const ROLE_FIELDS = {
  font: {
    node: string({ enum: Object.keys(FONTS) }, fontProblem),
    description: "One of FONTS, as the leading CAD app stores it",
    required: true,
  },
  height: {
    node: number({ exclusiveMinimum: 0 }, sizeProblem),
    description: "The plotted height of a capital, in paper units, at least minTextHeight",
    required: true,
  },
  widthFactor: {
    node: number({ minimum: 0.01, maximum: 100 }, widthFactorProblem),
    description: "How wide each character is drawn, as a share of its own width",
    default: 1,
  },
  obliqueAngle: {
    node: number({ minimum: -85, maximum: 85 }, obliqueAngleProblem),
    description: "The slant of each character, in degrees to the right",
    default: 0,
  },
  description,
} as const satisfies FieldsOf<TextRoleFieldsDocument>;

/**
 * The name of a firm's own style a role or a leader style stands for, which an edit of the firm's
 * file uses as the file defines it. `Standard` is the file's own there.
 */
const firmStyleName: Node = string(
  lazy(() => patterns.name()),
  (name) => dimensionStyleNameProblem(name),
);

const ROLE = record<TextRoleDocument>("textRole", "a text role", {
  ...ROLE_FIELDS,
  styleName: {
    node: firmStyleName,
    description:
      "The name of the text style the role is in a firm's files. An edit of a firm's file that holds the style draws in it as the file defines it. Defaults to the role's id in capitals; Standard, which only an edit draws in",
  },
  discipline,
  byDiscipline: byDiscipline(
    record<TextRoleFieldsDocument>(
      "textRoleFields",
      "a text role's fields for a discipline",
      replacing(ROLE_FIELDS),
    ),
  ),
});

const SCALE = record<ScaleDocument>("scale", "a scale", {
  label: {
    node: string(lazy(patterns.property), scaleLabelProblem),
    description: "The name the leading CAD app's scale list gives the scale, such as 1\" = 10'",
    required: true,
  },
  ratio: {
    node: number({ exclusiveMinimum: 0 }, ratioProblem),
    description: "Drawing lengths per length on paper, such as 120 for 1\" = 10'",
    required: true,
  },
  discipline,
});

const WRITING = record<WritingDocument>(
  "writing",
  "a dimension style's writing",
  {
    units: {
      node: string({ enum: DIMENSION_UNITS }, writingUnitsProblem),
      description:
        "How a length is written: decimal, or architectural, which takes a length times measurementScale as inches and writes feet and inches with a fraction of an inch, as 4'-1 7/16\"",
      default: "decimal",
    },
    precision: {
      node: number({ type: "integer", minimum: 0, maximum: 8 }, precisionProblem),
      description:
        "From 0 to 8: the decimals of a measurement, or in architectural units the least fraction of an inch, 1 over 2 to this power, so 4 writes sixteenths",
      required: true,
    },
    prefix: {
      node: string(lazy(patterns.prefix), dimensionPrefixProblem),
      description: "Written before each measurement",
    },
    suffix: {
      node: string(lazy(patterns.suffix), plainDimensionText),
      description: "Written after each measurement",
    },
    suppressZeros: {
      node: string({ enum: ZERO_SUPPRESSIONS }, zeroSuppressionProblem),
      description: "The zeros of a measurement in decimal units that are left out",
    },
    feetInchZeros: {
      node: string({ enum: FEET_INCH_ZEROS }, feetInchZerosProblem),
      description:
        "The zeros a measurement in architectural units writes: inches, which writes 4'-0\" and 6\", and is what a writing that names none writes; feet, which writes 4' and 0'-6\"; both; or neither",
    },
    measurementScale: {
      node: number({ exclusiveMinimum: 0 }, measurementScaleProblem),
      description: "Each measurement is written times this",
      default: 1,
    },
    fraction: {
      node: string({ enum: DIMENSION_FRACTIONS }, fractionProblem),
      description:
        "In architectural units, how the fraction of an inch is written: inline, as 4'-1 7/16\", stacked over a bar, or diagonal, beside a slash",
      default: "inline",
    },
    fractionScale: {
      node: number({ minimum: 0.25, maximum: 1 }, fractionScaleProblem),
      description: "The height of a stacked fraction as a share of the text's, from 0.25 to 1",
      default: 1,
    },
  },
  (value) =>
    zerosOfUnitsProblem(value.units, value.suppressZeros, value.feetInchZeros) ??
    dimensionStyleLookProblem({
      units: value.units,
      fraction: value.fraction,
      fractionScale: value.fractionScale,
    }),
);

const unitsOf = (what: string): Node =>
  record<NonNullable<DimensionStyleDocument["writing"]>>("writings", what, {
    in: { node: WRITING, description: "In a drawing in inches" },
    ft: { node: WRITING, description: "In a drawing in feet" },
    mm: { node: WRITING, description: "In a drawing in millimetres" },
    cm: { node: WRITING, description: "In a drawing in centimetres" },
    m: { node: WRITING, description: "In a drawing in metres" },
  });

const size = (check: Check<number>, what: string): Field => ({
  node: number({ minimum: 0 }, check),
  description: `${what}, on paper`,
  required: true,
});

const STYLE_FIELDS = {
  role: {
    node: string(),
    description: "The text role of the dimension's text, which gives its text style and height",
    required: true,
  },
  arrowhead: {
    node: string({ enum: Object.keys(ARROWHEADS) }, arrowheadProblem),
    description: "One of ARROWHEADS",
    default: DEFAULT_ARROWHEAD,
  },
  arrowSize: size(notNegativeProblem, "The size of an arrowhead"),
  extensionOffset: size(notNegativeProblem, "How far an extension line starts from its point"),
  extensionBeyond: size(
    notNegativeProblem,
    "How far an extension line runs past the dimension line",
  ),
  textGap: size(textGapProblem, "The gap between the text and the dimension line"),
  textPlacement: {
    node: string({ enum: DIMENSION_TEXT_PLACEMENTS }, textPlacementProblem),
    description: "The text above the dimension line, or centered in a break of it",
    default: "above",
  },
  radialText: {
    node: string({ enum: DIMENSION_RADIAL_TEXTS }, radialTextProblem),
    description:
      "How a radius, a diameter or a jogged radius dimension's text reads: along its line, or level",
    default: "aligned",
  },
  jogAngle: {
    node: number({ minimum: JOG_ANGLE.least, maximum: JOG_ANGLE.most }, jogAngleProblem),
    description: "The angle of a jogged radius dimension's jog to its line, in degrees",
    default: JOG_ANGLE.default,
  },
  angleUnits: {
    node: string({ enum: DIMENSION_ANGLE_UNITS }, angleUnitsProblem),
    description:
      "The units an angular dimension writes its angle in: degrees, degrees, minutes and seconds, grads or radians",
    default: "degrees",
  },
  anglePrecision: {
    node: number({ minimum: 0, maximum: MAX_ANGLE_PRECISION }, anglePrecisionProblem),
    description:
      "How many decimals an angle takes; in degrees, minutes and seconds, 0 writes the degrees, 1 and 2 the minutes too, and 3 and 4 the seconds",
    default: 0,
  },
  suppressAngleZeros: {
    node: string({ enum: ZERO_SUPPRESSIONS }, angleZerosProblem),
    description: "The zeros an angle leaves out. Defaults to none",
  },
  arcSymbol: {
    node: string({ enum: DIMENSION_ARC_SYMBOLS }, arcSymbolProblem),
    description:
      "Where an arc length dimension draws the arc symbol: before its text, above it, or nowhere",
    default: "before",
  },
  textFit: {
    node: string({ enum: DIMENSION_TEXT_FITS }, textFitProblem),
    description:
      "Where a text goes that does not fit between the extension lines: inside them all the same, or out on a leader",
    default: "inside",
  },
  dimensionLineweight: {
    node: number({ enum: LINEWEIGHTS }, lineweightValueProblem),
    description:
      "The lineweight of the dimension line, its arrowheads and a leader to its text, in millimetres. Defaults to the dimension's own",
  },
  extensionLineweight: {
    node: number({ enum: LINEWEIGHTS }, lineweightValueProblem),
    description:
      "The lineweight of the extension lines, in millimetres. Defaults to the dimension's own",
  },
  writing: {
    node: unitsOf("a dimension style's writing"),
    description:
      "How a length is written in each unit of a drawing. A drawing in a unit it does not list cannot draw a dimension in the style",
    default: {},
  },
  description,
} as const satisfies FieldsOf<DimensionStyleFieldsDocument>;

/** A name a standard gives a dimension style in the leading CAD app: any name that app takes, but `Standard`. */
const styleName: Node = string(
  lazy(() => patterns.name("Standard")),
  (name) => dimensionStyleNameProblem(name) ?? styleNameStandardProblem(name),
);

const DIMENSION_STYLE = record<DimensionStyleDocument>("dimensionStyle", "a dimension style", {
  ...STYLE_FIELDS,
  layoutName: {
    node: styleName,
    description:
      "The style's name in the leading CAD app on a layout, such as the name a firm's drawings already give their style. Defaults to its id in capitals",
  },
  scaleNames: {
    node: map(ids("scaleNames", "scale"), styleName),
    description:
      "The style's name in the leading CAD app in model space at a scale, by the scale's id, such as the name a firm's drawings already give the style at that scale. A scale it does not list takes the id in capitals, a hyphen and the scale's id",
  },
  discipline,
  byDiscipline: byDiscipline(
    record<DimensionStyleFieldsDocument>(
      "dimensionStyleFields",
      "a dimension style's fields for a discipline",
      replacing(STYLE_FIELDS),
    ),
  ),
});

const LEADER_FIELDS = {
  role: {
    node: string(),
    description: "The text role of the note, which gives its text style and height",
    required: true,
  },
  arrowhead: {
    node: string({ enum: Object.keys(LEADER_ARROWHEADS) }, leaderArrowheadProblem),
    description: "One of LEADER_ARROWHEADS",
    default: DEFAULT_LEADER_ARROWHEAD,
  },
  arrowSize: size(leaderSizeProblem, "The size of an arrowhead"),
  landing: size(leaderSizeProblem, "The length of the landing, 0 for none"),
  gap: size(leaderSizeProblem, "The gap between the end of the landing and the note"),
  attachment: {
    node: string({ enum: LEADER_ATTACHMENTS }, leaderAttachmentProblem),
    description: "Where the landing meets the side of the note: one of LEADER_ATTACHMENTS",
    default: "first-line",
  },
  direction: {
    node: string({ enum: LEADER_DIRECTIONS }, leaderDirectionProblem),
    description:
      'Whether the landing meets the side of the note, "horizontal", or its top or bottom, "vertical"',
    default: "horizontal",
  },
  verticalAttachment: {
    node: string({ enum: LEADER_VERTICAL_ATTACHMENTS }, leaderVerticalAttachmentProblem),
    description:
      'Where the landing meets a note above or below it: "center", or "line" with a line as wide as the note',
    default: "center",
  },
  frame: {
    node: boolean,
    description: "True for a frame around each note, one gap outside it",
    default: false,
  },
  shaft: {
    node: string({ enum: LEADER_SHAFT_KINDS }, leaderShaftKindProblem),
    description: 'How the shafts run through their points: "straight", or "curved"',
    default: "straight",
  },
  description,
} as const satisfies FieldsOf<LeaderStyleFieldsDocument>;

const LEADER_STYLE = record<LeaderStyleDocument>("leaderStyle", "a leader style", {
  ...LEADER_FIELDS,
  styleName: {
    node: firmStyleName,
    description:
      "The name of the multileader style the style is in a firm's files. An edit of a firm's file that holds the style draws in it as the file defines it. Defaults to the style's id in capitals; Standard, which only an edit draws in",
  },
  discipline,
  byDiscipline: byDiscipline(
    record<LeaderStyleFieldsDocument>(
      "leaderStyleFields",
      "a leader style's fields for a discipline",
      replacing(LEADER_FIELDS),
    ),
  ),
});

const FIELD = record<TitleBlockFieldDocument>("titleBlockField", "a title block's field", {
  fills: {
    node: string({ enum: FILL_KEYS }, fillProblem),
    description: "What the sheet fills the field with. A field without one is filled by its tag",
  },
  box: { node: box, description: "With a box, lint warns of a value that runs past it" },
  source: {
    node: string({ enum: SOURCES }, sourceProblem),
    description:
      "attribute: an attribute of the block that the builder sets. fileName, layoutName and currentDate: a field of the xref's drawing that the leading CAD app fills",
    default: "attribute",
  },
});

const XREF = record<XrefDocument>("xref", "an xref", {
  name: {
    node: string(
      lazy(() => patterns.name(...ARROWHEAD_BLOCKS)),
      blockNameProblem,
    ),
    description: "The xref's name",
    required: true,
  },
  path: {
    node: string(lazy(patterns.xrefPath, { maxLength: 32000 }), xrefPathProblem),
    description: "The path of the firm's DWG as each sheet's file sees it",
    required: true,
  },
  at: { node: point, description: "Where the xref is inserted on the paper", default: [0, 0] },
});

const drawing = (what: string): Node => ({
  kind: "drawing",
  description: `${what}: a Drawing as JSON, or a string that names one`,
});

const TITLE_BLOCK = record<TitleBlockDocument>("titleBlock", "a title block", {
  paper: {
    node: string({ enum: Object.keys(PAPERS) }, paperProblem),
    description: "One of PAPERS",
    required: true,
  },
  block: {
    node: drawing("The drawing that holds the block blockName, in paper units"),
    description: "The drawing that holds the block blockName",
  },
  blockName: {
    node: string(
      lazy(() => patterns.name(...ARROWHEAD_BLOCKS)),
      blockNameProblem,
    ),
    description: "The block of block that the builder inserts at [0, 0] on each sheet",
  },
  xref: { node: XREF, description: "The firm's own DWG, referenced by each sheet as an overlay" },
  preview: {
    node: drawing("What the pictures draw in place of the xref"),
    description: "What the pictures draw in place of the xref",
  },
  layer: {
    node: string(),
    description: "A layer of the standard, which the title block is inserted on",
    required: true,
  },
  drawingArea: {
    node: box,
    description: "The part of the paper inside the border",
    required: true,
  },
  box: {
    node: box,
    description:
      "The title block's own rectangle inside the drawing area, which no viewport may reach into",
  },
  fields: {
    node: map(
      {
        keys: lazy(patterns.tag),
        key: attributeTagProblem,
      },
      FIELD,
    ),
    description: "The fields a sheet fills, by tag",
    default: {},
  },
});

const SHEET_FORMAT = record<SheetFormatDocument>("sheetFormat", "a sheet format", {
  paper: {
    node: string({ enum: Object.keys(PAPERS) }, paperProblem),
    description: "One of PAPERS, which is its title block's paper",
    required: true,
  },
  titleBlock: { node: string(), description: "A title block of the standard", required: true },
  plotStyle: {
    node: string({ enum: PLOT_STYLE_TABLES }, plotStyleProblem),
    description: "The sheet format's own plot style table, in place of the standard's",
  },
  zones: {
    node: map(ids("The sheet format", "zone"), box),
    description:
      "Named boxes inside the title block's drawing area, which the code lays the sheet out by",
    default: {},
  },
  discipline,
});

const section = (keys: Keys, entry: RecordNode, what: string): Field => ({
  node: map(keys, entry, true),
  description: `${what}, by name. null removes the parent's entry of that name`,
  default: {},
});

const STANDARD = "The standard";

/** The document's top level. */
export const DOCUMENT = record<StandardDocument>("standard", "a standard", {
  $schema: {
    node: string(),
    description: "The JSON Schema of the document",
    unhashed: true,
    dropped: true,
  },
  id: {
    node: string({ pattern: "^[A-Za-z0-9._@/-]{1,128}$" }, standardIdProblem),
    description: "1 to 128 letters, digits, ., -, _, @ and /, so a package name is one",
    required: true,
    unhashed: true,
  },
  version: {
    node: string(lazy(patterns.property), standardVersionProblem),
    description: "1 to 64 characters",
    required: true,
    unhashed: true,
  },
  title: { node: text, description: "For people. Defaults to the id", unhashed: true },
  extends: {
    node: { kind: "extends" },
    description:
      'The parent: a path from this file, or a package specifier. "tsdraft/standard.json" is the built-in standard',
    unhashed: true,
    dropped: true,
  },
  paperUnits: {
    node: string({ enum: ["in", "mm"] }, paperUnitsProblem),
    description: "The unit of every length on paper. A child keeps its parent's",
    root: true,
  },
  minTextHeight: {
    node: number({ exclusiveMinimum: 0 }, sizeProblem),
    description: "The least height a text may plot at, in paper units",
    root: true,
  },
  linetypeScale: {
    node: number({ exclusiveMinimum: 0 }, linetypeScaleProblem),
    description: "A dash plots its pattern's length times this, at every scale",
    default: 1,
  },
  plotStyle: {
    node: string({ enum: PLOT_STYLE_TABLES }, plotStyleProblem),
    description: "The plot style table of each layout. One of PLOT_STYLE_TABLES",
    default: DEFAULT_PLOT_STYLE_TABLE,
  },
  sheetFiles: {
    node: string({ enum: ["one-drawing", "sheet-per-file"] }, sheetFilesProblem),
    description:
      "one-drawing: a set is one drawing with a layout for each sheet. sheet-per-file: each sheet is a file of its own",
    default: "one-drawing",
  },
  defaultSheetFormat: {
    node: string(),
    description: "The sheet format of a layout that names none",
  },
  defaultDimensionStyle: {
    node: string(),
    description: "The dimension style of a dimension that names none",
  },
  defaultLeaderStyle: {
    node: string(),
    description: "The leader style of a leader that names none",
  },
  disciplines: section(ids(STANDARD, "discipline"), DISCIPLINE, "The disciplines"),
  pens: section(ids(STANDARD, "pen"), PEN, "Named lineweights"),
  linetypes: section(
    {
      keys: lazy(() => patterns.name("Continuous", "ByLayer", "ByBlock")),
      key: (name) => linetypeProblem(name, "", []),
      fold: twins(STANDARD, "linetype", true),
    },
    LINETYPE,
    "The linetypes. Continuous is in every standard and is never listed",
  ),
  layers: section(
    {
      keys: lazy(() => patterns.name("0")),
      key: (name) => layerNameProblem(name, "R2018") ?? layerZeroProblem(name),
      fold: twins(STANDARD, "layer", true),
    },
    LAYER,
    "The layers",
  ),
  textRoles: section(
    ids(STANDARD, "text role", roleNameProblem, "standard"),
    ROLE,
    "The text roles",
  ),
  scales: section(ids(STANDARD, "scale"), SCALE, "The scales"),
  dimensionStyles: section(
    ids(STANDARD, "dimension style", dimensionStyleIdProblem, "standard"),
    DIMENSION_STYLE,
    "The dimension styles",
  ),
  leaderStyles: section(
    ids(STANDARD, "leader style", leaderStyleIdProblem, "standard"),
    LEADER_STYLE,
    "The leader styles",
  ),
  titleBlocks: section(ids(STANDARD, "title block"), TITLE_BLOCK, "The title blocks"),
  sheetFormats: section(ids(STANDARD, "sheet format"), SHEET_FORMAT, "The sheet formats"),
});

/**
 * An object of these entries, as `Object.fromEntries` makes it, which is several times slower
 * for an object of many keys. A key `__proto__` is a field like any other.
 */
export function entriesObject<T>(entries: Iterable<readonly [string, T]>) {
  const out: Record<string, T> = {};

  for (const [key, value] of entries) {
    if (key !== "__proto__") out[key] = value;
    else
      Object.defineProperty(out, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }

  return out;
}

const FIELDS = new WeakMap<RecordNode, readonly (readonly [string, Field])[]>();

/** The fields of a record, in the table's order, listed once. */
function fieldsOf(node: RecordNode): readonly (readonly [string, Field])[] {
  let fields = FIELDS.get(node);

  if (!fields) FIELDS.set(node, (fields = Object.entries(node.fields)));

  return fields;
}

/** The nodes that hold a drawing. */
const DRAWN: ReadonlySet<Node> = new Set<Node>([
  TITLE_BLOCK,
  DOCUMENT.fields.titleBlocks!.node,
  TITLE_BLOCK.fields.block!.node,
  TITLE_BLOCK.fields.preview!.node,
]);

/** A problem of a document: the path of what it is about, and what is wrong. */
export interface Problem {
  readonly item: string;
  readonly message: string;
}

const at = (path: string, key: string): string => (path ? `${path}.${key}` : key);
const entry = (path: string, key: string): string => `${path}[${JSON.stringify(key)}]`;

/**
 * The version a document's `$schema` names, when it names a later tsdraft than this one, such
 * as `https://cdn.jsdelivr.net/npm/tsdraft@0.5.6/standard.schema.json`.
 */
function laterVersion(schema: unknown): string | undefined {
  if (!isString(schema)) return undefined;
  const named = /tsdraft@((\d+)\.(\d+)\.(\d+)[^/]*)\/standard\.schema\.json$/.exec(schema);

  if (!named) return undefined;
  const ours = VERSION.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const theirs = Number(named[i + 2]);

    if (theirs !== ours[i]) return theirs > ours[i]! ? named[1] : undefined;
  }

  return undefined;
}

/**
 * Checks a document against the table, field by field, and adds each problem to `problems`.
 * True when it found none.
 */
export function readDocument(document: unknown, problems: Problem[]): boolean {
  const before = problems.length;
  const later = isPlainRecord(document) ? laterVersion(document.$schema) : undefined;
  const update = later ? `. This standard was written for tsdraft ${later}: update tsdraft` : "";
  const add = (item: string, message: string) => problems.push({ item, message });

  /**
   * Reads `value` at `path`. `name` is the field's name, or the key of a map's entry, in which
   * case `key` is empty and a message shows the name quoted.
   */
  const read = (node: Node, value: unknown, path: string, name: string, key: string): void => {
    const label = (): string => (key ? name : shown(name));

    switch (node.kind) {
      case "string":
        if (!isString(value)) add(path, `${label()} must be a string`);
        else {
          const problem = node.check?.(value);

          if (problem) add(path, problem);
        }

        return;
      case "number":
        if (!isNumber(value) || !Number.isFinite(value)) {
          add(path, `${label()} must be a finite number`);
        } else {
          const problem = node.check?.(value);

          if (problem) add(path, problem);
        }

        return;
      case "boolean":
        if (!isBoolean(value)) add(path, `${label()} must be true or false`);

        return;
      case "numbers": {
        if (!isFiniteNumbers(value)) add(path, `${label()} must be an array of finite numbers`);
        else {
          const problem = node.check?.(value);

          if (problem) add(path, problem);
        }

        return;
      }

      case "drawing":
        if (!isString(value) && !isPlainRecord(value)) {
          add(path, `${label()} must be a drawing as JSON, or a string that names one`);
        }

        return;
      case "extends":
        if (!isString(value) && !isObjectOrArray(value)) {
          add(path, `${label()} must be a standard, or a string that names one`);
        }

        return;
      case "map":
        if (!isPlainRecord(value)) {
          add(path, `${label()} ${PLAIN_OBJECT}`);

          return;
        }

        const seen = node.fold && new Map<string, string>();

        for (const [name, item] of Object.entries(value)) {
          const where = entry(path, name);
          const keyProblem = node.key(name);

          if (keyProblem) add(where, keyProblem);
          else if (seen) {
            const key = node.fold!.key(name);
            const first = seen.get(key);

            if (first === undefined) seen.set(key, name);
            else add(where, node.fold!.twin(first));
          }

          if (item === null && node.nullable) continue;
          read(node.value, item, where, name, "");
        }

        return;
      case "record": {
        if (!isPlainRecord(value)) {
          add(path, `${label()} ${PLAIN_OBJECT}`);

          return;
        }

        const start = problems.length;

        for (const [name, field] of Object.entries(value)) {
          if (name === "$comment") {
            if (!isString(field)) add(at(path, name), "$comment must be a string");
            continue;
          }

          const known = Object.hasOwn(node.fields, name) ? node.fields[name] : undefined;

          if (!known) {
            add(
              at(path, name),
              `${JSON.stringify(name)} is not a field of ${node.what} in tsdraft ${VERSION}${update}`,
            );
          } else if (field !== undefined) {
            read(known.node, field, at(path, name), name, name);
          }
        }

        const alone = node === DOCUMENT && value.extends === undefined;

        for (const [name, field] of fieldsOf(node)) {
          if (value[name] !== undefined) continue;

          if (field.required) {
            add(
              at(path, name),
              `${capital(node.what)} must have the field ${JSON.stringify(name)}`,
            );
          } else if (field.root && alone) {
            add(
              at(path, name),
              `A standard that extends nothing must have the field ${JSON.stringify(name)}`,
            );
          }
        }

        if (problems.length === start && node.check) {
          // SAFETY: each field of the object has passed the node the table gives it, which is the
          // field's type in the document type the check was given for.
          const problem = node.check(value as never, key || name);

          if (problem) add(path, problem);
        }

        return;
      }
    }
  };

  read(DOCUMENT, document, "", "The standard", "standard");

  return problems.length === before;
}

/** True for an array of finite numbers with no empty slot. */
function isFiniteNumbers(value: unknown): value is readonly number[] {
  if (!Array.isArray(value)) return false;

  for (let i = 0; i < value.length; i++) {
    if (!(i in value) || typeof value[i] !== "number" || !Number.isFinite(value[i])) return false;
  }

  return true;
}

const capital = (what: string): string => what.charAt(0).toUpperCase() + what.slice(1);

/** A plain object of a document, or of a standard, by its fields. */
export type Fields = { readonly [key: string]: StandardValue | undefined };

/**
 * Fills each default the table gives, for an object of the document whose fields have passed
 * `readDocument`, and leaves out `$comment` and each dropped field. A drawing is left to
 * `drawingOf`, which gives the one it names.
 */
export function withDefaults(
  node: Node,
  value: unknown,
  drawingOf: (value: unknown, path: string) => Drawing | undefined,
  path: string,
): StandardValue | undefined {
  // Only a drawing's path is ever shown, so no other path is worked out.
  if (!DRAWN.has(node)) path = "";

  switch (node.kind) {
    case "numbers":
      // SAFETY: `readDocument` has read the value as an array of finite numbers.
      return Object.freeze([...(value as readonly number[])]);
    case "drawing":
      return drawingOf(value, path);
    case "map":
      return Object.freeze(
        entriesObject(
          // SAFETY: `readDocument` has read the value as a plain object.
          Object.entries(value as Fields).map(([name, item]) => [
            name,
            withDefaults(node.value, item, drawingOf, path && entry(path, name)),
          ]),
        ),
      );
    case "record": {
      // SAFETY: `readDocument` has read the value as a plain object.
      const given = value as Fields;
      const out: Record<string, StandardValue | undefined> = {};

      for (const [name, field] of fieldsOf(node)) {
        if (field.dropped) continue;
        const own = given[name];

        if (own !== undefined) out[name] = withDefaults(field.node, own, drawingOf, at(path, name));
        else if (field.default !== undefined) {
          out[name] = withDefaults(field.node, field.default, drawingOf, at(path, name));
        }
      }

      return Object.freeze(out);
    }

    default:
      // SAFETY: `readDocument` has read the value as a string, a number, true or false, or the
      // standard a document extends.
      return value as StandardValue;
  }
}

const SORTED = new WeakMap<RecordNode, readonly (readonly [string, Field])[]>();

/** The fields of a record by name in code-unit order, as `canonical` writes keys. */
function sortedFieldsOf(node: RecordNode): readonly (readonly [string, Field])[] {
  let fields = SORTED.get(node);

  if (!fields) {
    fields = fieldsOf(node).toSorted(([a], [b]) => (a < b ? -1 : 1));
    SORTED.set(node, fields);
  }

  return fields;
}

/** True when two values are one value, as their canonical JSON says. */
export const same = (a: StandardValue | undefined, b: StandardValue | undefined): boolean =>
  a === b || (isObjectOrArray(a) && isObjectOrArray(b) && canonical(a) === canonical(b));

/**
 * The canonical JSON of what the hash reads of a resolved standard: every field but those the
 * table marks as unhashed, and none whose value is its default, with each drawing whole. It is
 * the JSON `canonical` writes for that value. `written` gives a drawing's JSON when it is known.
 */
export function hashedJson(
  standard: unknown,
  written: (value: WeakKey) => string | undefined,
): string {
  let out = "";

  const write = (node: Node, value: unknown): void => {
    if (node.kind === "record" || node.kind === "map") {
      // SAFETY: a record or a map of a standard is a plain object, by its fields.
      const given = value as Fields;
      let first = true;

      const field = (name: string, item: Node, own: StandardValue | undefined): void => {
        out += `${first ? "{" : ","}${JSON.stringify(name)}:`;
        first = false;
        write(item, own);
      };

      if (node.kind === "map") {
        for (const key of Object.keys(given).sort()) field(key, node.value, given[key]);
      } else {
        for (const [name, known] of sortedFieldsOf(node)) {
          const own = given[name];

          if (own === undefined || known.unhashed) continue;

          if (known.default !== undefined && same(own, known.default)) continue;
          field(name, known.node, own);
        }
      }

      out += first ? "{}" : "}";
    } else {
      out += canonical(value, "A standard", written);
    }
  };

  write(DOCUMENT, standard);

  return out;
}

/** The JSON Schema of a standard's document, for the tsdraft of `version`. */
export function standardSchema(version: string): Schema {
  const definitions: Record<string, Schema> = {};

  const schemaOf = (node: Node): Schema => {
    switch (node.kind) {
      case "string":
        return { type: "string", ...plain(node.schema) };
      case "number":
        return { type: "number", ...plain(node.schema) };
      case "boolean":
        return { type: "boolean" };
      case "numbers":
        return { type: "array", items: { type: "number" }, ...plain(node.schema) };
      case "drawing":
        return { description: node.description, anyOf: [{ type: "object" }, { type: "string" }] };
      case "extends":
        return { type: "string" };
      case "map": {
        const value = schemaOf(node.value);

        return {
          type: "object",
          propertyNames: plain(node.keys),
          additionalProperties: node.nullable ? { anyOf: [value, { type: "null" }] } : value,
        };
      }

      case "record": {
        if (node !== DOCUMENT && !definitions[node.name]) {
          definitions[node.name] = {};
          definitions[node.name] = objectOf(node);
        }

        return node === DOCUMENT ? objectOf(node) : { $ref: `#/$defs/${node.name}` };
      }
    }
  };

  const objectOf = (node: RecordNode): Schema => {
    const properties: Record<string, Schema> = {};
    properties.$comment = { type: "string", description: "For people. No rule reads it" };

    for (const [name, field] of fieldsOf(node)) {
      let property = schemaOf(field.node);

      if (property.description === undefined) {
        property = { ...property, description: field.description };
      }

      if (field.default !== undefined) property = { ...property, default: field.default };
      properties[name] = property;
    }

    const required = fieldsOf(node)
      .filter(([, field]) => field.required)
      .map(([name]) => name);

    const root = fieldsOf(node)
      .filter(([, field]) => field.root)
      .map(([name]) => name);

    let schema: Schema = { type: "object", description: capital(node.what), properties };

    if (required.length) schema = { ...schema, required };

    // A document that extends nothing has the root fields.
    if (root.length) schema = { ...schema, anyOf: [{ required: ["extends"] }, { required: root }] };

    return { ...schema, additionalProperties: false };
  };

  const top = schemaOf(DOCUMENT);

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://cdn.jsdelivr.net/npm/tsdraft@${version}/standard.schema.json`,
    title: "A tsdraft standard",
    ...top,
    description:
      "A firm's CAD standard: its layers, pens, linetypes, text roles, scales, dimension styles, leader styles, title blocks and sheet formats. What a schema cannot hold, such as a name that refers to another entry, is checked by defineStandard",
    $defs: Object.fromEntries(Object.entries(definitions).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}

/** A schema fragment as plain data: its patterns worked out. */
function plain(schema: Schema): Schema {
  return { ...schema };
}
