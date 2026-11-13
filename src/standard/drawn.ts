// What the builder refuses in a drawing drawn to a standard, each rule twice: as a type, so a
// literal mistake is a compile error, and as a runtime message that is the same, as
// `src/rules.ts` holds the rules of a drawing. A literal names an entry exactly as the standard
// spells it, and the builder, as AutoCAD does, finds one in any case.
import type { LayerName, LinetypeName } from "../rules.ts";
import type { Standard } from "./document.ts";

/** How a message names a standard. */
type Of<Z extends Standard> = `the standard "${Z["id"]}" version ${Z["version"]}`;
const of = (standard: Standard): string =>
  `the standard ${JSON.stringify(standard.id)} version ${standard.version}`;

const STANDARD_R12 =
  "Under a standard a drawing is R2018: a standard gives its layers linetypes and pens, which R12 cannot hold";
const STANDARD_LINETYPE_SCALE =
  "Under a standard the linetype scale is the standard's. Leave linetypeScale out, or set it in the standard";
const DISCIPLINE_WITHOUT_STANDARD =
  "discipline names a discipline of the drawing's standard, and this drawing has none";
const DISCIPLINE_ONE_DRAWING =
  'Under sheetFiles "one-drawing" a drawing names no discipline: the model and every sheet are one drawing, where a layer has one set of properties';
const LAYER_ZERO =
  'Layer "0" is in every drawing and in no standard. Draw on a layer of the standard: in a block, what is drawn outside any layer() is on layer "0" already, and draws on the layer of its insert';
const LAYER_PROPERTIES =
  "Under a standard a layer's color, linetype, lineweight and plot flag are the standard's. Give layer() only off, frozen or locked, or change the layer in the standard";
const LINETYPE_DEFINED =
  "Under a standard the linetypes are the standard's, and a drawing defines none of its own. Add the linetype to the standard's linetypes in defineStandard, and name it";
const PEN_LINEWEIGHT =
  'Under a standard an entity\'s lineweight comes from a pen of the standard: give it pen, or lineweight "ByLayer" or "ByBlock"';
const PEN_WITHOUT_STANDARD =
  "pen names a pen of the drawing's standard, and this drawing has none. Draw to a standard with createDrawing({ standard }), or give the entity a lineweight";
const PEN_AND_LINEWEIGHT = "An entity takes a pen or a lineweight, not both";
const NOT_A_STANDARD =
  "standard must be a Standard that defineStandard made, unchanged, and this one does not check";
const ROLE_WITHOUT_STANDARD =
  "role names a text role of the drawing's standard, and this drawing has none. Draw to a standard with createDrawing({ standard }), or give the text a height";
const ROLE_AND_HEIGHT =
  "A text with a role plots at the role's height. Leave height out, or change the role in the standard";
const ROLE_AND_STYLE =
  "A text with a role is in the role's text style. Leave style out, or change the role in the standard";
const ROLE_WITHOUT_VIEW =
  "A text of model space with a role names the view it is read in, which sizes it to plot at the role's height: give it view, which view() returns";
const ROLE_VIEW_ON_PAPER =
  "A text in a block or on a layout is drawn in paper units, at its role's height, and names no view. Leave view out";
const VIEW_WITHOUT_ROLE =
  "A text names a view to plot at its role's height. Give it a role too, or leave view out";
const VIEW_WITHOUT_STANDARD =
  "view names a view that view() declares in a drawing drawn to a standard, and this drawing has none. Draw to a standard with createDrawing({ standard })";
const SCALE_WITHOUT_STANDARD =
  "view() declares a view at a scale of the drawing's standard, and this drawing has none. Draw to a standard with createDrawing({ standard }), or give a viewport its ratio";
const INSERT_VIEW_AND_SCALE =
  "An insert with a view is scaled by the view, to plot its block at the block's size in paper units. Leave scale out, or leave view out for a block drawn at its size in the model";
const INSERT_VIEW_ON_PAPER =
  "An insert in a block or on a layout is in paper units, and names no view. Leave view out";
const VIEWPORT_RATIO =
  "Under a standard a viewport shows a view, whose scale gives its ratio. Give it view, which view() returns, in place of ratio";
const VIEWPORT_ID =
  "A viewport that shows a view has the view's id, which view() took. Leave id out";
const DIMENSION_STYLE_DEFINED =
  "Under a standard the dimension styles are the standard's, and a drawing defines none of its own. Add the style to the standard's dimensionStyles in defineStandard, and name it by its id";
const DIMENSION_WITHOUT_VIEW =
  "A dimension of model space under a standard names the view it is read in, whose scale sizes its style: give it view, which view() returns";
const DIMENSION_VIEW_ON_PAPER =
  "A dimension on a layout is drawn in paper units, and names no view. Leave view out";
const LAYOUT_PAPER_UNITS =
  "a sheet of a standard is in the standard's paper units, which its text roles and dimension styles are sized in";

export type StandardR12 = typeof STANDARD_R12;
export type StandardLinetypeScale = typeof STANDARD_LINETYPE_SCALE;
export type DisciplineWithoutStandard = typeof DISCIPLINE_WITHOUT_STANDARD;
export type LayerProperties = typeof LAYER_PROPERTIES;
export type LinetypeDefined = typeof LINETYPE_DEFINED;
export type PenWithoutStandard = typeof PEN_WITHOUT_STANDARD;
export type RoleWithoutStandard = typeof ROLE_WITHOUT_STANDARD;
export type RoleAndHeight = typeof ROLE_AND_HEIGHT;
export type RoleAndStyle = typeof ROLE_AND_STYLE;
export type ViewWithoutStandard = typeof VIEW_WITHOUT_STANDARD;
export type ScaleWithoutStandard = typeof SCALE_WITHOUT_STANDARD;
export type InsertViewAndScale = typeof INSERT_VIEW_AND_SCALE;
export type ViewportRatio = typeof VIEWPORT_RATIO;
export type ViewportId = typeof VIEWPORT_ID;
export type DimensionStyleDefined = typeof DIMENSION_STYLE_DEFINED;

/** The message for each rule of this file that has no name in it, for the builder. */
export const DRAWN = {
  r12: STANDARD_R12,
  linetypeScale: STANDARD_LINETYPE_SCALE,
  disciplineWithoutStandard: DISCIPLINE_WITHOUT_STANDARD,
  disciplineOneDrawing: DISCIPLINE_ONE_DRAWING,
  layerZero: LAYER_ZERO,
  layerProperties: LAYER_PROPERTIES,
  linetypeDefined: LINETYPE_DEFINED,
  penWithoutStandard: PEN_WITHOUT_STANDARD,
  penAndLineweight: PEN_AND_LINEWEIGHT,
  notAStandard: NOT_A_STANDARD,
  roleWithoutStandard: ROLE_WITHOUT_STANDARD,
  roleAndHeight: ROLE_AND_HEIGHT,
  roleAndStyle: ROLE_AND_STYLE,
  roleWithoutView: ROLE_WITHOUT_VIEW,
  roleViewOnPaper: ROLE_VIEW_ON_PAPER,
  viewWithoutRole: VIEW_WITHOUT_ROLE,
  viewWithoutStandard: VIEW_WITHOUT_STANDARD,
  scaleWithoutStandard: SCALE_WITHOUT_STANDARD,
  insertViewAndScale: INSERT_VIEW_AND_SCALE,
  insertViewOnPaper: INSERT_VIEW_ON_PAPER,
  viewportRatio: VIEWPORT_RATIO,
  viewportId: VIEWPORT_ID,
  dimensionStyleDefined: DIMENSION_STYLE_DEFINED,
  dimensionWithoutView: DIMENSION_WITHOUT_VIEW,
  dimensionViewOnPaper: DIMENSION_VIEW_ON_PAPER,
} as const;

type LayerLacks<
  N extends string,
  Z extends Standard,
> = `Layer "${N}" is not a layer of ${Of<Z>}. Add it to the standard, as layers: { "${N}": { color: 7 } } in defineStandard, or use one of its layers`;
/** What is wrong with a layer the standard lacks. */
export const layerLacks = (name: string, standard: Standard): string =>
  `Layer ${JSON.stringify(name)} is not a layer of ${of(standard)}. Add it to the standard, as layers: { ${JSON.stringify(name)}: { color: 7 } } in defineStandard, or use one of its layers`;

/**
 * Resolves to `N` when it is a layer of the standard `Z`, and to the error message otherwise: a
 * name AutoCAD refuses, layer `0`, or a layer the standard lacks.
 */
export type LayerOfStandard<N extends string, Z extends Standard> = string extends N
  ? N
  : N extends keyof Z["layers"]
    ? N
    : [LayerName<N, "R2018">] extends [N]
      ? N extends "0"
        ? typeof LAYER_ZERO
        : LayerLacks<N, Z>
      : LayerName<N, "R2018">;

/** What `layer()` sets on a layer of a standard: its states, which are the drawing's. */
export interface StandardLayerOptions {
  /** Hides the layer. */
  readonly off?: boolean;
  /** Hides the layer and leaves it out of regeneration. */
  readonly frozen?: boolean;
  /** Keeps the layer's entities from being edited in CAD. */
  readonly locked?: boolean;
  readonly color?: LayerProperties;
  readonly linetype?: LayerProperties;
  readonly lineweight?: LayerProperties;
  readonly plot?: LayerProperties;
}

type LinetypeLacks<
  L extends string,
  Z extends Standard,
> = `Linetype "${L}" is not a linetype of ${Of<Z>}. Add it to the standard, as linetypes: { "${L}": { pattern: [0.5, -0.25] } } in defineStandard, or use one of its linetypes or Continuous`;
/** What is wrong with an entity's linetype that the standard lacks. */
export const linetypeLacks = (name: string, standard: Standard): string =>
  `Linetype ${JSON.stringify(name)} is not a linetype of ${of(standard)}. Add it to the standard, as linetypes: { ${JSON.stringify(name)}: { pattern: [0.5, -0.25] } } in defineStandard, or use one of its linetypes or Continuous`;

/**
 * An entity's linetype under the standard `Z`, as the whole value given, `L`: a linetype of the
 * standard, `Continuous`, `ByLayer` or `ByBlock`, by name. A definition resolves to the message,
 * since under a standard a drawing defines no linetype. The last branch, never taken, lets `L`
 * be inferred, as in `LinetypeChoice`.
 */
export type LinetypeOfStandard<L, Z extends Standard> = [L] extends [string | object]
  ? L extends string
    ? string extends L
      ? L
      : Lowercase<L> extends "continuous" | "bylayer" | "byblock"
        ? L
        : L extends keyof Z["linetypes"]
          ? L
          : [LinetypeName<L>] extends [L]
            ? LinetypeLacks<L, Z>
            : LinetypeName<L>
    : LinetypeDefined
  : L;

type PenLacks<
  P extends string,
  Z extends Standard,
> = `Pen "${P}" is not a pen of ${Of<Z>}. Add it to the standard, as pens: { "${P}": { lineweight: 0.25 } } in defineStandard, or use one of its pens`;
/** What is wrong with a pen the standard lacks. */
export const penLacks = (name: string, standard: Standard): string =>
  `Pen ${JSON.stringify(name)} is not a pen of ${of(standard)}. Add it to the standard, as pens: { ${JSON.stringify(name)}: { lineweight: 0.25 } } in defineStandard, or use one of its pens`;

/** Resolves to `P` when it is a pen of the standard `Z`, and to the error message otherwise. */
export type PenOfStandard<P extends string, Z extends Standard> = string extends P
  ? P
  : P extends keyof Z["pens"]
    ? P
    : PenLacks<P, Z>;

/**
 * An entity's lineweight under a standard: `"ByLayer"` or `"ByBlock"`. A literal number
 * resolves to the message, and a number that is not a literal is checked when the code runs.
 */
export type LineweightUnderStandard<W extends number> = number extends W
  ? W | "ByLayer" | "ByBlock"
  : typeof PEN_LINEWEIGHT;

/** What is wrong with an entity's lineweight under a standard, with the standard's pens. */
export function penLineweightProblem(standard: Standard): string {
  const pens = Object.entries(standard.pens).map(([name, pen]) => `${name} ${pen.lineweight}`);
  const list =
    pens.length === 0
      ? "The standard has no pen"
      : `The standard's pens are ${pens.length === 1 ? pens[0] : `${pens.slice(0, -1).join(", ")} and ${pens.at(-1)}`} mm`;
  return `${PEN_LINEWEIGHT}. ${list}`;
}

type DisciplineLacks<
  D extends string,
  Z extends Standard,
> = `Discipline "${D}" is not a discipline of ${Of<Z>}. Add it to the standard, as disciplines: { "${D}": { title: "${D}" } } in defineStandard, or use one of its disciplines`;
/** What is wrong with a drawing's discipline that the standard lacks. */
export const disciplineLacks = (name: string, standard: Standard): string =>
  `Discipline ${JSON.stringify(name)} is not a discipline of ${of(standard)}. Add it to the standard, as disciplines: { ${JSON.stringify(name)}: { title: ${JSON.stringify(name)} } } in defineStandard, or use one of its disciplines`;

/** Resolves to `D` when it is a discipline of the standard `Z`, and to the message otherwise. */
export type DisciplineOfStandard<D extends string, Z extends Standard> = string extends D
  ? D
  : D extends keyof Z["disciplines"]
    ? D
    : DisciplineLacks<D, Z>;

/**
 * What is wrong with an entry that has fields by discipline, in a drawing that names none: a
 * `"Layer"`, a `"Text role"` or a `"Dimension style"`.
 */
export function unnamedDisciplineProblem(
  what: string,
  name: string,
  entry: { readonly byDiscipline?: object },
): string {
  const disciplines = Object.keys(entry.byDiscipline ?? {});
  const listed =
    disciplines.length === 1
      ? `the discipline ${disciplines[0]}`
      : `the disciplines ${disciplines.slice(0, -1).join(", ")} and ${disciplines.at(-1)}`;
  return `${what} ${JSON.stringify(name)} has fields of its own in ${listed} of the standard, so a drawing that uses it names its discipline, as createDrawing({ standard, discipline })`;
}

type RoleLacks<
  R extends string,
  Z extends Standard,
> = `Role "${R}" is not a text role of ${Of<Z>}. Add it to the standard, as textRoles: { "${R}": { font: "Arial", height: 0.125 } } in defineStandard, or use one of its roles`;
/** What is wrong with a text role the standard lacks. */
export const roleLacks = (name: string, standard: Standard): string =>
  `Role ${JSON.stringify(name)} is not a text role of ${of(standard)}. Add it to the standard, as textRoles: { ${JSON.stringify(name)}: { font: "Arial", height: 0.125 } } in defineStandard, or use one of its roles`;

/** What is wrong with a text style `textStyle()` defines under the name of a role's text style. */
export const roleTextStyleProblem = (name: string, role: string, standard: Standard): string =>
  `Text style ${JSON.stringify(name)} is the text style of the role ${JSON.stringify(role)} of ${of(standard)}, which gives its font, width factor and oblique angle. Give the style another name, or change the role in the standard`;

/** Resolves to `R` when it is a text role of the standard `Z`, and to the message otherwise. */
export type RoleOfStandard<R extends string, Z extends Standard> = string extends R
  ? R
  : R extends keyof Z["textRoles"]
    ? R
    : RoleLacks<R, Z>;

type ScaleLacks<
  C extends string,
  Z extends Standard,
> = `Scale "${C}" is not a scale of ${Of<Z>}. Add it to the standard, as scales: { "${C}": { label: "${C}", ratio: 1 } } in defineStandard, or use one of its scales`;
/** What is wrong with a view's scale that the standard lacks. */
export const scaleLacks = (name: string, standard: Standard): string =>
  `Scale ${JSON.stringify(name)} is not a scale of ${of(standard)}. Add it to the standard, as scales: { ${JSON.stringify(name)}: { label: ${JSON.stringify(name)}, ratio: 1 } } in defineStandard, or use one of its scales`;

/** Resolves to `C` when it is a scale of the standard `Z`, and to the message otherwise. */
export type ScaleOfStandard<C extends string, Z extends Standard> = string extends C
  ? C
  : C extends keyof Z["scales"]
    ? C
    : ScaleLacks<C, Z>;

type DimensionStyleLacks<
  S extends string,
  Z extends Standard,
> = `Dimension style "${S}" is not a dimension style of ${Of<Z>}. Add it to the standard's dimensionStyles in defineStandard, with its role, arrowSize, extensionOffset, extensionBeyond, textGap and writing, or use one of its dimension styles`;
/** What is wrong with a dimension style the standard lacks. */
export const dimensionStyleLacks = (name: string, standard: Standard): string =>
  `Dimension style ${JSON.stringify(name)} is not a dimension style of ${of(standard)}. Add it to the standard's dimensionStyles in defineStandard, with its role, arrowSize, extensionOffset, extensionBeyond, textGap and writing, or use one of its dimension styles`;

type DimensionStyleReserved<S extends string> =
  `Dimension style "${S}" is in no standard: its name in AutoCAD would be STANDARD, which AutoCAD takes for the dimension style Standard that every drawing has. Use one of the standard's dimension styles`;
/** What is wrong with the dimension style `standard`, in any case, which no standard holds. */
export const dimensionStyleReserved = (name: string): string | undefined =>
  name.toUpperCase() === "STANDARD"
    ? `Dimension style ${JSON.stringify(name)} is in no standard: its name in AutoCAD would be STANDARD, which AutoCAD takes for the dimension style Standard that every drawing has. Use one of the standard's dimension styles`
    : undefined;

/**
 * Resolves to `S` when it is a dimension style of the standard `Z`, and to the message
 * otherwise, for each member of `S`. No standard has a style whose id is `standard` in any case,
 * so that has a message of its own for every standard, its type's names `string` or not.
 */
export type DimensionStyleOfStandard<S extends string, Z extends Standard> = string extends S
  ? S
  : S extends unknown
    ? Uppercase<S> extends "STANDARD"
      ? DimensionStyleReserved<S>
      : S extends keyof Z["dimensionStyles"]
        ? S
        : DimensionStyleLacks<S, Z>
    : never;

/** What is wrong with a dimension that names no style, under a standard that has no default. */
export const noDefaultDimensionStyle = (standard: Standard): string =>
  `${capitalized(of(standard))} has no defaultDimensionStyle. Give the dimension the style of the standard it is drawn in, or set defaultDimensionStyle in the standard`;

/** What is wrong with a dimension in a unit its style does not say how to write. */
export const writingLacks = (style: string, units: string, standard: Standard): string =>
  `The dimension style ${JSON.stringify(style)} of ${of(standard)} has no writing for ${JSON.stringify(units)}, the units it is drawn in. Add one, as writing: { ${units}: { precision: 2 } }, to the style in defineStandard, or use a style that has one`;

/** What is wrong with a view that `view()` of this drawing did not return. */
export const viewNotDeclared = (view: unknown): string => {
  const id: unknown = (view as { readonly id?: unknown } | null)?.id;
  return `${typeof id === "string" ? `The view ${JSON.stringify(id)}` : "This view"} is not a view of this drawing. Declare it with view(), and give what view() returns`;
};

/** What is wrong with an insert in model space, without a view, of a block with role texts. */
export const roleBlockWithoutView = (block: string): string =>
  `Block ${JSON.stringify(block)} holds texts with roles, which are drawn in paper units, so an insert of it in model space names the view it is read in, as insert(name, at, { view })`;

/** What is wrong with a layout whose paper is not in the standard's paper units. */
export const layoutPaperUnitsProblem = (paper: string, units: string, standard: Standard): string =>
  `the paper ${JSON.stringify(paper)} is in ${units}, and ${of(standard)} has its paper units in ${standard.paperUnits}: ${LAYOUT_PAPER_UNITS}`;

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
