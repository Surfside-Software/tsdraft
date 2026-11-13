// What the builder refuses in a drawing drawn to a standard, each rule twice: as a type, so a
// literal mistake is a compile error, and as a runtime message that is the same, as
// `src/rules.ts` holds the rules of a drawing. A literal names an entry exactly as the standard
// spells it, and the builder, as AutoCAD does, finds one in any case.
import type { LayerName, LinetypeName } from "../rules.ts";
import type { Standard, StandardLayer } from "./document.ts";

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

export type StandardR12 = typeof STANDARD_R12;
export type StandardLinetypeScale = typeof STANDARD_LINETYPE_SCALE;
export type DisciplineWithoutStandard = typeof DISCIPLINE_WITHOUT_STANDARD;
export type LayerProperties = typeof LAYER_PROPERTIES;
export type LinetypeDefined = typeof LINETYPE_DEFINED;
export type PenWithoutStandard = typeof PEN_WITHOUT_STANDARD;

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

/** What is wrong with a layer that has fields by discipline, in a drawing that names none. */
export function unnamedDisciplineProblem(name: string, layer: StandardLayer): string {
  const disciplines = Object.keys(layer.byDiscipline ?? {});
  const listed =
    disciplines.length === 1
      ? `the discipline ${disciplines[0]}`
      : `the disciplines ${disciplines.slice(0, -1).join(", ")} and ${disciplines.at(-1)}`;
  return `Layer ${JSON.stringify(name)} has fields of its own in ${listed} of the standard, so a drawing that uses it names its discipline, as createDrawing({ standard, discipline })`;
}
