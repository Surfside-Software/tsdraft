// What the picture of a read file gives `toSVG` beside the `Drawing` it draws, under keys no
// `Drawing` holds, so that a drawing made in code draws as it always has.
import { isString } from "./guards.ts";
import type { PaperInfo } from "./papers.ts";

/** On a layout: the paper of a read layout, which need not be one of `PAPERS`. */
export const READ_PAPER: unique symbol = Symbol("tsdraft read paper");

/** On an entity: its own linetype scale, group 48, which a `Drawing` does not hold. */
export const OWN_LINETYPE_SCALE: unique symbol = Symbol("tsdraft own linetype scale");

/** On a paragraph: the text of a table's cell, whose words wider than its width break. */
export const CELL_TEXT: unique symbol = Symbol("tsdraft cell text");

/**
 * On a drawing: `$PSLTSCALE` is 0, so a viewport sizes dashes in model units, by the linetype scale
 * alone, not on the paper.
 */
export const MODEL_DASHES: unique symbol = Symbol("tsdraft model dashes");

/** On an image: its fade, from 0 to 100, which mixes it toward the background. */
export const IMAGE_FADE: unique symbol = Symbol("tsdraft image fade");

/** On a layer: its true color as 0xRRGGBB, which a `Drawing`'s layer does not hold. */
export const LAYER_TRUE_COLOR: unique symbol = Symbol("tsdraft layer true color");

/** On the options of `svgPieces`: which top-level entity of the read each entity came from. */
export const READ_SOURCES: unique symbol = Symbol("tsdraft read sources");

/** A layout of a read, with its paper. */
export interface ReadPaperLayout {
  readonly [READ_PAPER]?: PaperInfo;
}

/** An entity with its own linetype scale. */
export interface OwnLinetypeScale {
  readonly [OWN_LINETYPE_SCALE]?: number;
}

/** The top-level entity of a read an entity of the drawing was made from. */
export interface ReadSource {
  /** Its index in its space's `entities`. */
  readonly index: number;
  readonly handle?: string;
}

/** For each space of the drawing, the source of each of its top-level entities, by its index. */
export interface ReadSources {
  readonly model: readonly ReadSource[];
  /** By the layout's index in `drawing.layouts`. */
  readonly layouts: readonly (readonly ReadSource[])[];
}

/** The picture of one entity at the top of a space, and of what was made from it. */
export interface PictureFragment {
  /** Its entity's index in its space's `entities` in the read. */
  readonly index: number;
  readonly handle?: string;
  /** Its elements, as the picture joins them. */
  readonly svg?: string;
  /**
   * For an insert of an xref at the top of a space: in place of `svg`, the xref's run, with a
   * fragment for each entity at the top of the xref's model space, whose handles are its file's.
   */
  readonly run?: PictureRun;
  /** The ids of the definitions it uses, in the order it first uses them. */
  readonly defs: readonly string[];
}

/**
 * The fragments of one space as the picture draws it: a layout's paper, model space through one
 * of its viewports, or model space alone. Joined, they are `open`, each fragment with `between`
 * between two, and `close`, or `empty` when there is none.
 */
export interface PictureRun {
  readonly kind: "fragments";
  readonly space: "paper" | "model";
  /**
   * For model space through a viewport, its index among the viewports the picture draws: those of
   * the layout's that are on and have a view, in the layout's order.
   */
  readonly viewport?: number;
  /** For an xref's run, the block name its insert names. */
  readonly xref?: string;
  readonly open: string;
  readonly between: string;
  readonly close: string;
  readonly empty: string;
  readonly fragments: readonly PictureFragment[];
}

/** A piece of a picture: its own text, a space's fragments, or where the definitions go. */
export type PicturePiece = string | PictureRun | { readonly kind: "defs" };

/** The picture's text from its pieces, with each definition its fragments use, in order. */
export function joinPicture(
  pieces: readonly PicturePiece[],
  defs: Readonly<Record<string, string>>,
): string {
  const used: string[] = [];
  const seen = new Set<string>();

  const use = (run: PictureRun): void => {
    for (const fragment of run.fragments) {
      for (const id of fragment.defs) {
        if (!seen.has(id) && Object.hasOwn(defs, id)) {
          seen.add(id);
          used.push(defs[id]!);
        }
      }

      if (fragment.run !== undefined) use(fragment.run);
    }
  };

  for (const piece of pieces) {
    if (!isString(piece) && piece.kind === "fragments") use(piece);
  }

  const joined = (run: PictureRun): string =>
    run.fragments.length === 0
      ? run.empty
      : run.open +
        run.fragments
          .map((f) => (f.run !== undefined ? joined(f.run) : (f.svg ?? "")))
          .join(run.between) +
        run.close;

  let out = "";

  for (const piece of pieces) {
    if (isString(piece)) out += piece;
    else if (piece.kind === "defs")
      out += used.length > 0 ? `\n  <defs>${used.join("")}</defs>` : "";
    else out += joined(piece);
  }

  return out;
}
