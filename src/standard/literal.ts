// The compile-time half of `defineStandard`: the names a document resolves to, with its parent's,
// and the check of each literal in the document, whose message is the runtime check's.
import type {
  ArrowheadOf,
  AttributeTag,
  BlockName,
  DimensionAffix,
  DimensionPrefix,
  EntityId,
  FontOf,
  LayerColor,
  LayerName,
  LineweightOf,
  MeasurementScale,
  NewLinetypeName,
  NotNegative,
  ObliqueAngle,
  PaperOf,
  Pattern,
  PlotStyleOf,
  Positive,
  Precision,
  Ratio,
  TextGap,
  WidthFactor,
  XrefPath,
  ZeroSuppressionOf,
} from "../rules.ts";
import type { BuiltInStandard } from "./define.ts";
import type { BUILT_IN_SPECIFIER } from "./default.ts";
import type { Section, Standard, StandardNames } from "./document.ts";
import type {
  DimensionStyleStandard,
  FillOf,
  LayerZero,
  NameIn,
  PaperUnitsOf,
  RoleStandard,
  SheetFilesOf,
  SourceOf,
  WritingUnitsOf,
} from "./rules.ts";

/**
 * The parent `D` names: a `Standard` given as itself, the built-in standard, or the standard
 * `options.files` holds under the literal string `extends` holds. Any other string, or an
 * `extends` that `D` may leave out, gives a parent whose names are `string`, which only the
 * runtime check holds to.
 */
export type ParentOf<D, F> = "extends" extends keyof D
  ? undefined extends D["extends" & keyof D]
    ? Standard
    : Named<D["extends" & keyof D], F>
  : undefined;
type Named<E, F> = E extends string
  ? string extends E
    ? Standard
    : E extends typeof BUILT_IN_SPECIFIER
      ? BuiltInStandard
      : E extends keyof F
        ? F[E] extends Standard
          ? F[E]
          : Standard
        : Standard
  : E;

type Own<D, S extends Section> = S extends keyof D ? D[S] : {};
/** True when the names of a section are not known: `D` may leave it out, or its keys are `string`. */
type Unknown<E> = undefined extends E ? true : string extends keyof E ? true : false;
/**
 * The names of the entries that are there. An entry that may be `null` or left out may be gone,
 * and so may one that a member of a union of sections lacks.
 */
type Live<E> = Exclude<Keys<E>, Gone<E, Keys<E>>> & string;
type Keys<E> = E extends unknown ? keyof E : never;
type Gone<E, All> = E extends unknown
  ?
      | Exclude<All, keyof E>
      | { [K in keyof E]-?: null extends E[K] ? K : {} extends Pick<E, K> ? K : never }[keyof E]
  : never;
/** The names an entry may remove: each that is, or may be, `null` in any member of `E`. */
type Removed<E> = (E extends unknown
  ? { [K in keyof E]-?: null extends E[K] ? K : never }[keyof E]
  : never) &
  string;
type Inherited<P, S extends Section> = P extends { readonly [K in S]: infer E }
  ? keyof E & string
  : never;
/**
 * A name as the type compares it: in lower case, after Σ is written σ, since `Lowercase` makes Σ
 * at the end of a word ς, where `layerKey` makes it σ. Two names `layerKey` or `idKey` takes for
 * one are one here too. Where this takes two for one that `layerKey` keeps apart, such as Ÿ and
 * ÿ, the type leaves a name out, and never names an entry the standard lacks: a removed name is
 * left out even when a live entry folds to it.
 */
type Fold<N extends string> = Lowercase<Sigma<N>>;
type Sigma<N extends string> = N extends `${infer A}Σ${infer B}` ? `${A}σ${Sigma<B>}` : N;
/** The parent's names by their fold, which a child's entry keeps. */
type Folds<Names extends string> = { readonly [N in Names as Fold<N>]: N };
type Spelled<K extends string, Names extends string> = K extends unknown
  ? Fold<K> extends keyof Folds<Names>
    ? Folds<Names>[Fold<K>] & string
    : K
  : never;
type SectionNames<D, P, S extends Section> =
  Unknown<Own<D, S>> extends true
    ? string
    : Exclude<
        Inherited<P, S> | Spelled<Live<Own<D, S>>, Inherited<P, S>>,
        Spelled<Removed<Own<D, S>>, Inherited<P, S>>
      >;

/** The names of each section of the standard that `D` resolves to over its parent `P`. */
export type NamesOf<D, P> = { readonly [S in Section]: SectionNames<D, P, S> };

type Str<V, R> = V extends string ? R : unknown;
type Num<V, R> = V extends number ? R : unknown;

/** `Problem` when a name breaks a rule, and `never` when it is valid. */
type Valid<K extends string, Checked> = [Checked] extends [K] ? never : Checked;
type IdProblem<K extends string> = Valid<K, EntityId<K>>;

/**
 * The document `D` with each literal that breaks a rule replaced by the rule's message, so
 * `D extends CheckDocument<D, P>` holds only for a document with no such literal.
 */
export type CheckDocument<D, P, N extends StandardNames = NamesOf<D, P>> = {
  readonly [K in keyof D]: K extends "paperUnits"
    ? PaperUnitsOf<D[K]>
    : K extends "minTextHeight" | "linetypeScale"
      ? Num<D[K], Positive<D[K] & number>>
      : K extends "plotStyle"
        ? Str<D[K], PlotStyleOf<D[K] & string>>
        : K extends "sheetFiles"
          ? SheetFilesOf<D[K]>
          : K extends "defaultSheetFormat"
            ? NameIn<D[K], N["sheetFormats"], "sheetFormats">
            : K extends "defaultDimensionStyle"
              ? NameIn<D[K], N["dimensionStyles"], "dimensionStyles">
              : K extends Section
                ? Entries<D[K], K, N>
                : unknown;
};

type Entries<E, S extends Section, N extends StandardNames> = {
  readonly [K in keyof E]: E[K] extends null
    ? null
    : K extends string
      ? [KeyProblem<K, S>] extends [never]
        ? Entry<E[K], S, N>
        : KeyProblem<K, S>
      : unknown;
};

type KeyProblem<K extends string, S extends Section> = string extends K
  ? never
  : S extends "layers"
    ? LayerZero<K> | Valid<K, LayerName<K, "R2018">>
    : S extends "linetypes"
      ? Valid<K, NewLinetypeName<K>>
      : S extends "textRoles"
        ? IdProblem<K> | RoleStandard<K>
        : S extends "dimensionStyles"
          ? IdProblem<K> | DimensionStyleStandard<K>
          : IdProblem<K>;

type Entry<E, S extends Section, N extends StandardNames> = S extends "pens"
  ? Pen<E>
  : S extends "linetypes"
    ? LinetypeEntry<E>
    : S extends "layers"
      ? Layer<E, N>
      : S extends "textRoles"
        ? Role<E, N>
        : S extends "scales"
          ? Scale<E, N>
          : S extends "dimensionStyles"
            ? DimensionStyle<E, N>
            : S extends "titleBlocks"
              ? TitleBlock<E, N>
              : S extends "sheetFormats"
                ? SheetFormat<E, N>
                : unknown;

type Pen<E> = {
  readonly [F in keyof E]: F extends "lineweight"
    ? Num<E[F], LineweightOf<E[F] & number>>
    : unknown;
};

type LinetypeEntry<E> = {
  readonly [F in keyof E]: F extends "pattern"
    ? E[F] extends readonly number[]
      ? Pattern<E[F]>
      : unknown
    : unknown;
};

type Discipline<V, N extends StandardNames> = NameIn<V, N["disciplines"], "disciplines">;

/** `byDiscipline`: each key a discipline of the standard, and its fields as the entry's of `S`. */
type ByDiscipline<B, N extends StandardNames, S extends Section> = {
  readonly [K in keyof B]: K extends string
    ? [Discipline<K, N>] extends [K]
      ? S extends "layers"
        ? LayerFields<B[K], N>
        : S extends "textRoles"
          ? RoleFields<B[K], N>
          : StyleFields<B[K], N>
      : Discipline<K, N>
    : unknown;
};

type LayerFields<E, N extends StandardNames> = {
  readonly [F in keyof E]: F extends "color"
    ? Num<E[F], LayerColor<E[F] & number>>
    : F extends "linetype"
      ? NameIn<E[F], N["linetypes"] | "Continuous", "linetypes">
      : F extends "pen"
        ? NameIn<E[F], N["pens"], "pens">
        : F extends "discipline"
          ? Discipline<E[F], N>
          : unknown;
};

type Layer<E, N extends StandardNames> = {
  readonly [F in keyof E]: F extends "byDiscipline"
    ? ByDiscipline<E[F], N, "layers">
    : LayerFields<E, N>[F];
};

type RoleFields<E, N extends StandardNames> = {
  readonly [F in keyof E]: F extends "font"
    ? Str<E[F], FontOf<E[F] & string>>
    : F extends "height"
      ? Num<E[F], Positive<E[F] & number>>
      : F extends "widthFactor"
        ? Num<E[F], WidthFactor<E[F] & number>>
        : F extends "obliqueAngle"
          ? Num<E[F], ObliqueAngle<E[F] & number>>
          : F extends "discipline"
            ? Discipline<E[F], N>
            : unknown;
};

type Role<E, N extends StandardNames> = {
  readonly [F in keyof E]: F extends "byDiscipline"
    ? ByDiscipline<E[F], N, "textRoles">
    : RoleFields<E, N>[F];
};

type Scale<E, N extends StandardNames> = {
  readonly [F in keyof E]: F extends "ratio"
    ? Num<E[F], Ratio<E[F] & number>>
    : F extends "discipline"
      ? Discipline<E[F], N>
      : unknown;
};

type Writing<E> = {
  readonly [F in keyof E]: F extends "units"
    ? WritingUnitsOf<E[F]>
    : F extends "precision"
      ? Num<E[F], Precision<E[F] & number>>
      : F extends "prefix"
        ? Str<E[F], DimensionPrefix<E[F] & string>>
        : F extends "suffix"
          ? Str<E[F], DimensionAffix<E[F] & string>>
          : F extends "suppressZeros"
            ? Str<E[F], ZeroSuppressionOf<E[F] & string>>
            : F extends "measurementScale"
              ? Num<E[F], MeasurementScale<E[F] & number>>
              : unknown;
};

type StyleFields<E, N extends StandardNames> = {
  readonly [F in keyof E]: F extends "role"
    ? NameIn<E[F], N["textRoles"], "textRoles">
    : F extends "arrowhead"
      ? Str<E[F], ArrowheadOf<E[F] & string>>
      : F extends "arrowSize" | "extensionOffset" | "extensionBeyond"
        ? Num<E[F], NotNegative<E[F] & number>>
        : F extends "textGap"
          ? Num<E[F], TextGap<E[F] & number>>
          : F extends "writing"
            ? { readonly [U in keyof E[F]]: Writing<E[F][U]> }
            : F extends "discipline"
              ? Discipline<E[F], N>
              : unknown;
};

type DimensionStyle<E, N extends StandardNames> = {
  readonly [F in keyof E]: F extends "byDiscipline"
    ? ByDiscipline<E[F], N, "dimensionStyles">
    : StyleFields<E, N>[F];
};

type Field<E> = {
  readonly [F in keyof E]: F extends "fills"
    ? FillOf<E[F]>
    : F extends "source"
      ? SourceOf<E[F]>
      : unknown;
};

type Xref<E> = {
  readonly [F in keyof E]: F extends "name"
    ? Str<E[F], BlockName<E[F] & string>>
    : F extends "path"
      ? Str<E[F], XrefPath<E[F] & string>>
      : unknown;
};

type TitleBlock<E, N extends StandardNames> = {
  readonly [F in keyof E]: F extends "paper"
    ? Str<E[F], PaperOf<E[F] & string>>
    : F extends "layer"
      ? NameIn<E[F], N["layers"], "layers">
      : F extends "blockName"
        ? Str<E[F], BlockName<E[F] & string>>
        : F extends "xref"
          ? Xref<E[F]>
          : F extends "fields"
            ? {
                readonly [T in keyof E[F]]: T extends string
                  ? [AttributeTag<T>] extends [T]
                    ? Field<E[F][T]>
                    : AttributeTag<T>
                  : unknown;
              }
            : unknown;
};

type SheetFormat<E, N extends StandardNames> = {
  readonly [F in keyof E]: F extends "paper"
    ? Str<E[F], PaperOf<E[F] & string>>
    : F extends "titleBlock"
      ? NameIn<E[F], N["titleBlocks"], "titleBlocks">
      : F extends "plotStyle"
        ? Str<E[F], PlotStyleOf<E[F] & string>>
        : F extends "zones"
          ? {
              readonly [Z in keyof E[F]]: Z extends string
                ? [IdProblem<Z>] extends [never]
                  ? unknown
                  : IdProblem<Z>
                : unknown;
            }
          : F extends "discipline"
            ? Discipline<E[F], N>
            : unknown;
};
