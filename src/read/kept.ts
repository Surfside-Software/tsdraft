// The picture of a read file after an edit, from the fragments of its picture kept from before:
// those of the entities the edit does not reach as they were, those it changes drawn again, and
// those it adds after the rest, joined in one pass over the fragments.
import { isString } from "../guards.ts";
import {
  joinPicture,
  type PictureFragment,
  type PicturePiece,
  type PictureRun,
} from "../picture-marks.ts";

/** A picture in fragments, as `readPicture` gives one. */
export interface PictureInPieces {
  readonly pieces: readonly PicturePiece[];
  readonly defs: Readonly<Record<string, string>>;
}

/** What an edit changes in a picture. */
export interface PictureChange {
  /**
   * The xref the edit is in, by the name its insert names, when it edits the file an xref of the
   * picture stands for. Without it the edit is in the picture's own file.
   */
  readonly xref?: string;
  /** The handles, in the edited file, of the entities it erases. */
  readonly erased?: ReadonlySet<string>;
  /**
   * The handles of the entities it changes. Each is drawn where `drawn` draws it, and left out of
   * every space where `drawn` has no fragment for it, as when a move takes it out of a viewport.
   */
  readonly changed?: ReadonlySet<string>;
  /**
   * The picture of the entities it changes and adds, drawn as the kept one was, with the same
   * options: of a read that holds only them. A fragment whose handle the kept picture has takes
   * that one's place; any other comes after the rest of its space.
   */
  readonly drawn?: PictureInPieces;
}

const runKey = (run: PictureRun): string => `${run.space}:${run.viewport ?? "-"}`;

/**
 * The runs of a picture by space and viewport, and of each xref in them by its name and the
 * handle of the insert that places it, since one space may place an xref more than once.
 */
function runsOf(pieces: readonly PicturePiece[]): Map<string, PictureRun> {
  const runs = new Map<string, PictureRun>();

  for (const piece of pieces) {
    if (isString(piece) || piece.kind !== "fragments") continue;
    const key = runKey(piece);

    if (!runs.has(key)) runs.set(key, piece);

    for (const fragment of piece.fragments) {
      const inner = fragment.run;
      const at = `${key}|${inner?.xref}|${fragment.handle ?? `#${fragment.index}`}`;

      if (inner?.xref !== undefined && !runs.has(at)) runs.set(at, inner);
    }
  }

  return runs;
}

/** A run with the erased fragments left out, the changed ones in their place and the added after. */
function edited(
  run: PictureRun,
  erased: ReadonlySet<string> | undefined,
  changed: ReadonlySet<string> | undefined,
  drawn: PictureRun | undefined,
): PictureRun {
  if (!erased?.size && !changed?.size && drawn === undefined) return run;
  const again = new Map<string, PictureFragment>();

  for (const fragment of drawn?.fragments ?? []) {
    if (fragment.handle !== undefined) again.set(fragment.handle, fragment);
  }

  const fragments: PictureFragment[] = [];

  for (const fragment of run.fragments) {
    const handle = fragment.handle;

    if (handle !== undefined && erased?.has(handle)) continue;
    const redrawn = handle === undefined ? undefined : again.get(handle);

    if (redrawn) again.delete(handle!);
    else if (handle !== undefined && changed?.has(handle)) continue;
    fragments.push(redrawn ?? fragment);
  }

  for (const fragment of drawn?.fragments ?? []) {
    if (fragment.handle === undefined || again.get(fragment.handle) === fragment) {
      fragments.push(fragment);
    }
  }

  return { ...run, fragments };
}

/**
 * The picture after an edit, as `readPicture` would draw the edited file whole, from the kept
 * fragments of the picture before it. Two things stay as they were: each kept entity's
 * `data-entity`, its place among the entities before the edit, and the frame of model space drawn
 * alone, which its extents before the edit give; a sheet's frame is its paper's. Inside an
 * xref's run a changed entity `drawn` does not draw is left out, where the whole picture draws it
 * outside the viewport's clip, which shows nothing of it. Its cost is in
 * proportion to the fragments of the picture, never to what the file holds.
 */
export function editedPicture(kept: PictureInPieces, change: PictureChange): string {
  const drawnRuns = change.drawn ? runsOf(change.drawn.pieces) : new Map<string, PictureRun>();
  const defs = change.drawn ? { ...kept.defs, ...change.drawn.defs } : kept.defs;
  const { xref, erased, changed } = change;

  const pieces = kept.pieces.map((piece): PicturePiece => {
    if (isString(piece) || piece.kind !== "fragments") return piece;
    const key = runKey(piece);

    if (xref === undefined) return edited(piece, erased, changed, drawnRuns.get(key));
    let touched = false;

    const fragments = piece.fragments.map((fragment) => {
      if (fragment.run?.xref !== xref) return fragment;
      touched = true;

      return {
        ...fragment,
        run: edited(
          fragment.run,
          erased,
          changed,
          drawnRuns.get(`${key}|${xref}|${fragment.handle ?? `#${fragment.index}`}`),
        ),
      };
    });

    return touched ? { ...piece, fragments } : piece;
  });

  return joinPicture(pieces, defs);
}
