// `lintEdit`: the refusals of an edit that its read can tell, and its warnings. It never throws,
// and stays bounded on any value, as `lint` does: the edit's shape is checked first, each handle is
// paid for before it is worked, and what goes past the limit is one diagnostic.
import type { CallSite } from "../callsite.ts";
import { layerKey } from "../layers.ts";
import { OUTSIDE_THE_READ, partFilter, type PartFilter } from "../read/part.ts";
import type { DrawingRead, ReadEntity } from "../read/model.ts";
import { canonicalHandle, checkEdit, MADE_KINDS, statementCall, type Edit } from "./model.ts";
import { movedEntity, NOT_MOVED, NOT_SCALED } from "./moved.ts";
import { editReach, indexRead, type Located, type ReadIndex } from "./reach.ts";
import { applied } from "./transform.ts";

/**
 * True when a paragraph's codes give a run a height in drawing units, not as a factor of the
 * text's. `\\\\` is a backslash, so what follows it is text.
 */
const absoluteHeight = (value: string): boolean => {
  for (const m of value.matchAll(/\\\\|\\H[0-9.+\-eE]+(x?);/g))
    if (m[0] !== "\\\\" && m[1] === "") return true;

  return false;
};

/** True when an entity holds paragraph text with a height of its own, which a scale leaves. */
function ownHeight(e: ReadEntity): boolean {
  switch (e.kind) {
    case "mtext":
      return absoluteHeight(e.value);
    case "multileader":
      return absoluteHeight(e.text);
    case "insert":
      return (e.attributes ?? []).some((a) => a.paragraph !== undefined && absoluteHeight(a.value));
    default:
      return false;
  }
}

const DIMENSIONS: ReadonlySet<string> = new Set([
  "dimension",
  "radial-dimension",
  "angular-dimension",
  "arc-length-dimension",
  "ordinate-dimension",
]);

export type EditRule =
  /** The edit is not one: its shape, its hash, its file's format, or a statement not made yet. */
  | "edit-malformed"
  | "edit-hash"
  | "edit-format"
  | "edit-not-made"
  /** A handle two statements reach. */
  | "edit-twice"
  /** A handle the read neither keeps nor lists. */
  | "edit-missing"
  /** What goes with another and is edited only with it: an attribute, or a picture's entity. */
  | "edit-part"
  /** A move out of what a read with `only` keeps, which the checks could not then see. */
  | "edit-only"
  /** An object of a kind the reader does not read. */
  | "edit-unread-object"
  /** An entity of a block's definition that no edit reaches, or one an edit reaches, a warning. */
  | "edit-block"
  | "edit-block-definition"
  /** A 3D solid, a region or a body. */
  | "edit-modeler"
  /** What a scale or a turn of a kind would change that it cannot: a dimension's measurement. */
  | "edit-transform"
  /** An old leader and its note, moved or erased apart. */
  | "edit-leader-note"
  | "edit-locked-layer"
  | "edit-limit";

export interface EditDiagnostic {
  readonly rule: EditRule;
  readonly severity: "error" | "warning";
  readonly message: string;
  /** The place of the statement in `statements`, where one is at fault. */
  readonly statement?: number;
  readonly handle?: string;
  /** The call in the edit file that made the statement, where its builder recorded it. */
  readonly call?: CallSite;
}

export interface LintEditOptions {
  /** The most diagnostics listed; past them one more says how many there were. Default 1000. */
  readonly most?: number;
}

const parts = new WeakMap<DrawingRead, PartFilter>();

/** The filter of what a read with `only` keeps, made once for each read. */
function partOf(read: DrawingRead): PartFilter {
  let f = parts.get(read);

  if (f === undefined) parts.set(read, (f = partFilter(read, read.only!)));

  return f;
}

/** What the edit's read says of a handle it does not hold: that `only` or a limit left it out. */
function missingWhy(read: DrawingRead): string {
  const counts = [read.model.other, ...read.layouts.map((l) => l.other)];

  const left = counts.some(
    (c) => (c?.[OUTSIDE_THE_READ] ?? 0) > 0 || (c?.["past the limit"] ?? 0) > 0,
  );

  if (read.only !== undefined || left)
    return ", or the read leaves it out: name the layout that shows it, or its area, in the edit's only";

  return "";
}

/**
 * Why a statement cannot reach a handle it names, as an error, or a warning it makes, or
 * undefined.
 */
export function handleProblem(
  read: DrawingRead,
  index: ReadIndex,
  edit: Edit,
  statement: number,
  handle: string,
): { rule: EditRule; severity: "error" | "warning"; message: string } | undefined {
  const s = edit.statements[statement]!;

  if (s.kind !== "erase" && s.kind !== "move") return undefined;
  const h = canonicalHandle(handle);
  const at: Located | undefined = index.byHandle.get(h);
  const verb = s.kind === "erase" ? "erases" : "moves";

  const error = (rule: EditRule, message: string) => ({
    rule,
    severity: "error" as const,
    message,
  });

  if (at === undefined)
    return error(
      "edit-missing",
      `The edit ${verb} ${h}, which the file does not hold${missingWhy(read)}`,
    );

  if (at.kind === "attribute")
    return error(
      "edit-part",
      `${h} is an attribute of the insert ${at.insert}, which is erased and moved with it`,
    );

  if (at.kind === "picture")
    return error(
      "edit-part",
      `${h} is of the picture of ${at.of}, which is erased and moved with it`,
    );

  if (at.kind === "unread") {
    if (s.kind === "erase" && at.unread.kind === "OLE2FRAME") return undefined;

    return error(
      "edit-unread-object",
      `${h} is an entity of the kind ${at.unread.kind}, which tsdraft does not read, so no edit ${verb} it${at.unread.kind === "OLE2FRAME" ? " but an erasure" : ""}`,
    );
  }

  if (at.kind === "viewport") {
    if (s.kind === "erase")
      return error(
        "edit-not-made",
        `The viewport ${h} cannot be erased by this version of tsdraft`,
      );

    if (!applied(s.transform).moveOnly)
      return error(
        "edit-transform",
        `The viewport ${h} is only moved on its paper: a turn or a scale of it is refused`,
      );

    return undefined;
  }

  const e = at.entity;

  if (NOT_MOVED.has(e.kind))
    return error(
      "edit-modeler",
      `${h} is a ${e.kind}, whose modeler data no writer changes, so no edit ${verb} it`,
    );

  if (s.kind === "move") {
    const t = applied(s.transform);

    if (t.scale !== 1 && NOT_SCALED.has(e.kind))
      return error(
        "edit-transform",
        `${h} is a ${e.kind}: a scale would change ${e.kind === "table" ? "its cells" : "its measurement"}, so it is refused`,
      );

    if (t.scale !== 1 && ownHeight(e))
      return error(
        "edit-transform",
        `${h} holds paragraph text with a height of its own, \\H, which a scale would leave as it is, so a scale of it is refused: move or turn it, or set its heights as a factor of the text's, \\H2x`,
      );

    if (t.scale !== 1 && e.kind === "leader" && e.note !== undefined)
      return error(
        "edit-transform",
        `${h} is an old leader with a note, whose hook line keeps its dimension style's length, so a scale of it is refused: move it, or erase it and draw it again`,
      );

    // `rotate` is less whole turns. An ordinate dimension's measurement would change; the leading
    // CAD app draws any other dimension's picture again when it turns one, and keeps an old
    // leader's line to its note level.
    if (t.rotate !== 0 && e.kind === "ordinate-dimension")
      return error(
        "edit-transform",
        `${h} is an ordinate dimension: a turn would change its measurement, so it is refused`,
      );

    if (t.rotate !== 0 && DIMENSIONS.has(e.kind))
      return error(
        "edit-transform",
        `${h} is a dimension, whose picture the leading CAD app draws again when it turns, so a turn of it is refused: move it, or erase it and draw it again`,
      );

    if (t.rotate !== 0 && e.kind === "leader" && e.note !== undefined)
      return error(
        "edit-transform",
        `${h} is an old leader with a note, whose line to it the leading CAD app lays out again when it turns, so a turn of it is refused: move it, or erase it and draw it again`,
      );
  }

  // What a read with `only` keeps is all the checks see of model space: a move out of it is
  // planned on a read that keeps where it goes.
  if (s.kind === "move" && at.space.kind === "model" && read.only !== undefined) {
    const moved = movedEntity(e, applied(s.transform));

    if (!partOf(read).keeps(moved))
      return error(
        "edit-only",
        `${h} would move out of what the edit's read keeps: name in the edit's only an area or a layout that shows where it goes`,
      );
  }

  if (at.space.kind === "block") {
    const name = at.space.name;
    const block = index.blocks.get(name);
    const xref = read.xrefs.some((x) => x.name === name);
    const uses = index.inserts.get(name) ?? 0;

    if (
      block === undefined ||
      block.anonymous ||
      name.startsWith("*") ||
      xref ||
      uses > 1 ||
      index.insertsInBlocks.has(name)
    )
      return error(
        "edit-block",
        `${h} is of the block ${JSON.stringify(name)}, ${xref ? "an xref" : block?.anonymous || name.startsWith("*") ? "which the file names itself" : uses > 1 ? `which the file inserts ${uses} times` : "which another block inserts"}: changing it would change every insert of it`,
      );

    return {
      rule: "edit-block-definition",
      severity: "warning",
      message: `${h} is of the block ${JSON.stringify(name)}, which ${read.only === undefined ? "the file" : "the read"} shows inserted ${uses === 1 ? "once" : "nowhere"}: the edit ${s.kind === "erase" ? "erases it from" : "moves it in"} the block's definition, in the block's own coordinates`,
    };
  }

  return undefined;
}

/**
 * The refusals of an edit that its read can tell, and its warnings, with the call of each
 * statement where the edit's builder recorded it. Never throws. The writers refuse what only the
 * file's records tell: a reference to an erased object without a rule, an associative dimension
 * or hatch moved apart from what it names, a dynamic block's definition.
 */
export function lintEdit(
  edit: Edit,
  read: DrawingRead,
  options: LintEditOptions = {},
): EditDiagnostic[] {
  const most = options.most ?? 1000;
  const out: EditDiagnostic[] = [];
  let past = 0;

  const report = (d: EditDiagnostic): void => {
    if (out.length < most) {
      const call = d.statement === undefined ? undefined : statementCall(edit, d.statement);
      out.push(call === undefined ? d : { ...d, call });
    } else past++;
  };

  try {
    const problems = checkEdit(edit);

    if (problems.length > 0) {
      report({
        rule: "edit-malformed",
        severity: "error",
        message: `The edit is malformed: ${problems.join("; ")}`,
      });

      return out;
    }

    if (read.sha256 !== edit.sha256)
      report({
        rule: "edit-hash",
        severity: "error",
        message: `The read is of the bytes ${read.sha256}, not the ${edit.sha256} the edit was planned on`,
      });

    if (read.version !== undefined && read.version !== "AC1032")
      report({
        rule: "edit-format",
        severity: "error",
        message: `The file is of the format ${read.version}, and an edit writes only the 2018 format, AC1032`,
      });
    edit.statements.forEach((s, i) => {
      if (!MADE_KINDS.has(s.kind))
        report({
          rule: "edit-not-made",
          severity: "error",
          statement: i,
          message: `This version of tsdraft makes no ${s.kind} statement yet`,
        });
    });

    if (read.model.entities === undefined) {
      report({
        rule: "edit-missing",
        severity: "error",
        message: "The read has no geometry, so it holds no entity an edit can name",
      });

      return out;
    }

    const index = indexRead(read);
    const reach = editReach(edit, index);

    for (const [h, first, second] of reach.twice)
      report({
        rule: "edit-twice",
        severity: "error",
        statement: second,
        handle: h,
        message: `Statements ${first} and ${second} both reach ${h}: one statement edits an object once`,
      });
    const locked = new Set(read.layers.filter((l) => l.locked).map((l) => layerKey(l.name)));
    // An old leader's note, by the note's handle, and the leader that names it.
    const leaderOf = new Map<string, string>();

    for (const at of index.byHandle.values())
      if (at.kind === "entity" && at.entity.kind === "leader" && at.entity.note && at.entity.handle)
        leaderOf.set(canonicalHandle(at.entity.note), canonicalHandle(at.entity.handle));

    const statementOf = (h: string): number | undefined =>
      reach.erased.get(h) ?? reach.moved.get(h);

    edit.statements.forEach((s, i) => {
      if (s.kind !== "erase" && s.kind !== "move") return;

      // A handle named twice in one statement is named once.
      for (const h of new Set(s.handles.map(canonicalHandle))) {
        const problem = handleProblem(read, index, edit, i, h);

        if (problem !== undefined) report({ ...problem, statement: i, handle: h });
        const at = index.byHandle.get(h);

        if (at?.kind !== "entity") continue;

        if (locked.has(layerKey(at.entity.layer)))
          report({
            rule: "edit-locked-layer",
            severity: "warning",
            statement: i,
            handle: h,
            message: `${h} is on the locked layer ${JSON.stringify(at.entity.layer)}: the edit ${s.kind === "erase" ? "erases" : "moves"} it, and the layer stays locked`,
          });

        // An old leader and its note go together: a note erased or moved alone, or a leader moved alone.
        const note =
          at.entity.kind === "leader" && at.entity.note
            ? canonicalHandle(at.entity.note)
            : undefined;

        const leader = leaderOf.get(h);
        const other = note ?? leader;

        if (other === undefined || !index.byHandle.has(other)) continue;
        const together = statementOf(other) === i;

        const apart =
          note !== undefined
            ? s.kind === "move" && !together
            : s.kind === "erase"
              ? !reach.erased.has(other)
              : !together;

        if (apart)
          report({
            rule: "edit-leader-note",
            severity: "error",
            statement: i,
            handle: h,
            message:
              note !== undefined
                ? `${h} is an old leader whose note is ${note}: a move of it takes the note in the same statement`
                : `${h} is the note of the old leader ${leader}: ${s.kind === "erase" ? "it is erased only with its leader" : "it moves with its leader, in the same statement"}`,
          });
      }
    });
  } catch (error) {
    report({
      rule: "edit-malformed",
      severity: "error",
      message: `The edit could not be checked: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  if (past > 0)
    out.push({
      rule: "edit-limit",
      severity: "error",
      message: `${past} more diagnostics past the ${most} listed`,
    });

  return out;
}
