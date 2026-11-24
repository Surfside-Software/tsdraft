// `lintEdit`: the refusals of an edit that its read can tell, and its warnings. It never throws,
// and stays bounded on any value, as `lint` does: the edit's shape is checked first, each handle is
// paid for before it is worked, and what goes past the limit is one diagnostic.
import type { CallSite } from "../callsite.ts";
import { nearestFont } from "../fonts.ts";
import { layerKey } from "../layers.ts";
import { OUTSIDE_THE_READ, partFilter, type PartFilter } from "../read/part.ts";
import type { DrawingRead, ReadEntity, ReadTable } from "../read/model.ts";
import { addedOf, readAdditionsFile, type Added } from "./added.ts";
import { canonicalHandle, checkEdit, MADE_KINDS, statementCall, type Edit } from "./model.ts";
import { replacement, writesAdditions } from "./replaced.ts";
import { movedEntity, NOT_MOVED, NOT_SCALED } from "./moved.ts";
import { editReach, indexRead, type Located, type ReadIndex } from "./reach.ts";
import { planKey, stretchPlan } from "./stretch.ts";
import { applied } from "./transform.ts";
import {
  entityChangeProblems,
  layerChangeProblems,
  viewportChangeProblems,
} from "./lint-change.ts";

/**
 * True when a paragraph's codes give a run a height in drawing units, not as a factor of the
 * text's. `\\\\` is a backslash, so what follows it is text.
 */
const absoluteHeight = (value: string): boolean => {
  for (const m of value.matchAll(/\\\\|\\H[0-9.+\-eE]+(x?);/g))
    if (m[0] !== "\\\\" && m[1] === "") return true;

  return false;
};

/** What a refusal in a block calls an entity of each kind tsdraft lays out itself. */
const KIND_NAMES: Partial<Record<ReadEntity["kind"], string>> = {
  text: "a justified text",
  insert: "an insert with a justified attribute",
  mtext: "a paragraph in columns",
  multileader: "a multileader",
  dimension: "a dimension",
  table: "a table",
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

/** What each statement that names a handle does to it, and to an entity of a block's definition. */
const VERBS = {
  erase: "erases",
  move: "moves",
  change: "changes",
  stretch: "stretches",
  vertices: "sets the vertices of",
} as const;

const INSIDE = {
  erase: "erases it from",
  move: "moves it in",
  change: "changes it in",
  stretch: "stretches it in",
  vertices: "sets its vertices in",
} as const;

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
  /** A stretch of what it cannot stretch, or one that leaves an entity it names as it is, a warning. */
  | "edit-stretch"
  | "edit-stretch-unchanged"
  /** Vertices a polyline cannot take. */
  | "edit-vertices"
  | "edit-locked-layer"
  /** An addition the writers cannot make, or a file with no seed to number its handles from. */
  | "edit-addition"
  /** An addition on a layer that hides it or does not plot it, which is a warning. */
  | "edit-addition-layer"
  /** An earlier addition of the edit's name that a person changed, or erased. */
  | "edit-mark-changed"
  | "edit-mark-erased"
  /** An addition of an earlier one's id in another kind, which takes a new handle: a warning. */
  | "edit-id-kind-changed"
  /** A change of an entity it cannot make: a text not found once, a width of columns, a name the file lacks. */
  | "edit-change"
  /** A layer's change it cannot make: a layer the file holds no record of. */
  | "edit-layer"
  /** A viewport's change it cannot make, or a viewport named by another kind of statement. */
  | "edit-viewport"
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

/** The entity a move, a stretch or a vertices statement leaves, or undefined where it is as it was. */
function entityAfter(
  edit: Edit,
  index: ReadIndex,
  statement: number,
  h: string,
  e: ReadEntity,
): ReadEntity | undefined {
  const s = edit.statements[statement]!;

  if (s.kind === "move") return movedEntity(e, applied(s.transform));
  const plan = stretchPlan(edit, index);
  const repointedAt = plan.repointed.get(h);

  if (repointedAt?.statement === statement) return repointedAt.entity;

  if (s.kind === "stretch" && plan.moved.get(h) === statement)
    return movedEntity(e, applied({ by: s.by }));

  return undefined;
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

  if (
    s.kind !== "erase" &&
    s.kind !== "move" &&
    s.kind !== "change" &&
    s.kind !== "stretch" &&
    s.kind !== "vertices"
  )
    return undefined;
  const h = canonicalHandle(handle);
  const at: Located | undefined = index.byHandle.get(h);
  const verb = VERBS[s.kind];

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
      s.kind === "change"
        ? `${h} is an attribute of the insert ${at.insert}: change it by its tag, in the insert's attributes`
        : `${h} is an attribute of the insert ${at.insert}, which is erased and moved with it`,
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
    if (s.kind === "stretch" || s.kind === "vertices")
      return error(
        s.kind === "stretch" ? "edit-stretch" : "edit-vertices",
        `${h} is a viewport, which is only moved on its paper`,
      );

    if (s.kind === "change")
      return error("edit-viewport", `${h} is a viewport, which a viewport statement changes`);

    if (s.kind === "erase")
      return error(
        "edit-not-made",
        `The viewport ${h} cannot be erased by this version of tsdraft`,
      );

    if (s.kind === "move" && !applied(s.transform).moveOnly)
      return error(
        "edit-transform",
        `The viewport ${h} is only moved on its paper: a turn or a scale of it is refused`,
      );

    return undefined;
  }

  const e = at.entity;
  const clipped = index.clips.get(h);

  // A viewport's clip holds the viewport's box: it moves with the viewport, by a move alone. A
  // change of its pen leaves its points.
  if (
    clipped !== undefined &&
    s.kind !== "erase" &&
    s.kind !== "change" &&
    !(s.kind === "move" && s.handles.some((n) => canonicalHandle(n) === clipped))
  )
    return error(
      "edit-part",
      `${h} clips the viewport ${clipped}, whose box it holds: it moves with the viewport, in a move of both`,
    );

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

  if (s.kind === "stretch" || s.kind === "vertices") {
    const refused = stretchPlan(edit, index).refused.get(planKey(statement, h));

    if (refused !== undefined)
      return error(
        s.kind === "stretch" ? "edit-stretch" : "edit-vertices",
        `The edit ${verb} ${h}, but ${refused}`,
      );
  }

  // What a read with `only` keeps is all the checks see of model space: a move out of it is
  // planned on a read that keeps where it goes.
  const after = s.kind === "erase" ? undefined : entityAfter(edit, index, statement, h, e);

  if (after !== undefined && at.space.kind === "model" && read.only !== undefined) {
    if (!partOf(read).keeps(after))
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
      message: `${h} is of the block ${JSON.stringify(name)}, which ${read.only === undefined ? "the file" : "the read"} shows inserted ${uses === 1 ? "once" : "nowhere"}: the edit ${INSIDE[s.kind]} the block's definition${s.kind === "erase" || s.kind === "change" ? "" : ", in the block's own coordinates"}`,
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

    const kept = stretchPlan(edit, index).kept;

    edit.statements.forEach((s, i) => {
      if (s.kind !== "erase" && s.kind !== "move" && s.kind !== "stretch" && s.kind !== "vertices")
        return;

      // A handle named twice in one statement is named once.
      for (const h of new Set(
        (s.kind === "vertices" ? [s.handle] : s.handles).map(canonicalHandle),
      )) {
        const problem = handleProblem(read, index, edit, i, h);

        if (problem !== undefined) report({ ...problem, statement: i, handle: h });
        else {
          const why = kept.get(planKey(i, h));

          if (why !== undefined)
            report({
              rule: "edit-stretch-unchanged",
              severity: "warning",
              statement: i,
              handle: h,
              message: `The edit stretches ${h}, but leaves it as it is: ${why}`,
            });
        }

        const at = index.byHandle.get(h);

        if (at?.kind !== "entity") continue;

        if (locked.has(layerKey(at.entity.layer)))
          report({
            rule: "edit-locked-layer",
            severity: "warning",
            statement: i,
            handle: h,
            message: `${h} is on the locked layer ${JSON.stringify(at.entity.layer)}: the edit ${VERBS[s.kind]} it, and the layer stays locked`,
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

    edit.statements.forEach((s, i) => {
      if (s.kind === "layer") {
        for (const p of layerChangeProblems(read, s)) report({ ...p, statement: i });

        return;
      }

      if (s.kind === "viewport") {
        for (const p of viewportChangeProblems(read, index, s, missingWhy(read)))
          report({ ...p, statement: i });

        return;
      }

      if (s.kind !== "change") return;
      const h = canonicalHandle(s.handle);
      const problem = handleProblem(read, index, edit, i, h);

      if (problem !== undefined) report({ ...problem, statement: i, handle: h });

      if (problem?.severity === "error") return;
      const at = index.byHandle.get(h);

      if (at?.kind !== "entity") return;

      for (const p of entityChangeProblems(read, at.entity, s)) report({ ...p, statement: i });

      if (locked.has(layerKey(at.entity.layer)))
        report({
          rule: "edit-locked-layer",
          severity: "warning",
          statement: i,
          handle: h,
          message: `${h} is on the locked layer ${JSON.stringify(at.entity.layer)}: the edit changes it, and the layer stays locked`,
        });
    });

    if (writesAdditions(read, edit)) lintAdditions(edit, read, report);
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

/**
 * The refusals and warnings of an edit's additions: an earlier addition of its name a person
 * changed or erased, a file with no seed, an addition the writers cannot make, and one on a layer
 * that is off, frozen, set not to plot, `Defpoints` or `0`, or frozen in a viewport of the file.
 */
function lintAdditions(edit: Edit, read: DrawingRead, report: (d: EditDiagnostic) => void): void {
  if (read.header.handseed === undefined) {
    report({
      rule: "edit-addition",
      severity: "error",
      message: "The file states no $HANDSEED, which an addition's handle is counted from",
    });

    return;
  }

  const replaced = replacement(read, edit);

  for (const p of replaced.problems)
    report({ rule: p.rule, severity: "error", handle: p.handle, message: p.message });

  for (const id of replaced.kindChanged)
    report({
      rule: "edit-id-kind-changed",
      severity: "warning",
      message: `The addition ${id} is of another kind than the one of its id the edit wrote before: the old one is erased, and the new one takes a new handle`,
    });
  let added: Added;

  try {
    added = addedOf(read, edit, readAdditionsFile(read));
  } catch (error) {
    report({
      rule: "edit-addition",
      severity: "error",
      message: error instanceof Error ? error.message : String(error),
    });

    return;
  }

  const layers = new Map([...read.layers, ...added.layers].map((l) => [layerKey(l.name), l]));

  const frozenIn = new Set(
    read.layouts.flatMap((l) => l.viewports.flatMap((v) => v.frozenLayers.map(layerKey))),
  );

  const levelText = new Set(
    read.dimensionStyles.filter((d) => (d.textLevelInside ?? 1) === 1).map((d) => layerKey(d.name)),
  );

  // The file's styles whose font the builder does not take, so a justified text in one would
  // start where the file's font does not put it: its own Standard, which the builder measures in
  // txt.shx, and a style in a font not in FONTS, which it measures in a stand-in.
  const unmeasured = new Map(
    read.textStyles
      .filter((t) =>
        layerKey(t.name) === "standard"
          ? (t.font ?? "").toLowerCase().replace(/\.shx$/, "") !== "txt"
          : !nearestFont(t.family ?? t.font ?? "txt.shx").exact,
      )
      .map((t) => [layerKey(t.name), t.name]),
  );

  // Of those, the styles in a stand-in font, where every width the writers work out from the
  // font would be the stand-in's: what the leading CAD app lays out itself is all they take.
  const standIn = (name: string | undefined): string | undefined =>
    name === undefined || layerKey(name) === "standard"
      ? undefined
      : unmeasured.get(layerKey(name));

  // The file's styles and those the edit adds alike.
  const dimensionStyles = [...read.dimensionStyles, ...added.dimensionStyles];
  const tableStyles = [...read.tableStyles, ...added.tableStyles];

  const dimensionText = (style: string): string | undefined =>
    standIn(dimensionStyles.find((s) => layerKey(s.name) === layerKey(style))?.textStyle);

  // Of a table, the cell styles of the rows that hold text: the title's, the header's, the data's.
  const tableText = (t: ReadTable): string | undefined => {
    const s = tableStyles.find(
      (x) => t.style !== undefined && layerKey(x.name) === layerKey(t.style),
    );

    if (s === undefined) return undefined;
    const first = (t.title ? 1 : 0) + (t.header ? 1 : 0);

    const holds = (from: number, to: number): boolean =>
      t.cells.some((c) => c.row >= from && c.row < to && (c.text ?? "") !== "");

    return [
      t.title && holds(0, 1) ? s.title : undefined,
      t.header && holds(first - 1, first) ? s.header : undefined,
      holds(first, Infinity) ? s.data : undefined,
    ]
      .map((c) => standIn(c?.textStyle))
      .find((n) => n);
  };

  // The stand-in style a kind tsdraft lays out itself is drawn in, if any.
  const laidOutIn = (e: ReadEntity): string | undefined => {
    switch (e.kind) {
      case "insert":
        return e.attributes
          ?.filter((a) => a.alignAt !== undefined && a.paragraph === undefined)
          .map((a) => standIn(a.style))
          .find((n) => n);
      case "mtext":
        return e.columns === undefined ? undefined : standIn(e.style);
      case "multileader":
        return standIn(e.textStyle);
      case "dimension":
        return dimensionText(e.style);
      case "table":
        return tableText(e);
      default:
        return undefined;
    }
  };

  // A block the edit defines is drawn where each insert puts it, as tsdraft laid it out.
  for (const b of added.blocks)
    for (const e of b.entities) {
      const style =
        (e.kind === "text" && e.alignAt !== undefined
          ? unmeasured.get(layerKey(e.style))
          : undefined) ?? laidOutIn(e);

      if (style !== undefined)
        report({
          rule: "edit-addition",
          severity: "error",
          ...(e.handle !== undefined && { handle: e.handle }),
          message: `The block ${b.name} the edit adds holds ${KIND_NAMES[e.kind] ?? e.kind} laid out by tsdraft in the file's text style ${style}, whose font tsdraft does not measure it in: only a text justified left and a paragraph of one column may be drawn in it`,
        });
    }

  for (const space of added.spaces)
    for (const e of space.entities) {
      const style = e.kind === "text" ? unmeasured.get(layerKey(e.style)) : undefined;
      const id = e.mark?.id ?? e.handle ?? "";

      const refuse = (message: string): void =>
        report({
          rule: "edit-addition",
          severity: "error",
          ...(e.handle !== undefined && { handle: e.handle }),
          message,
        });

      if (e.kind === "text" && e.alignAt !== undefined && style !== undefined)
        refuse(
          `The addition ${id} is a justified text in the file's ${style}, whose font tsdraft does not measure it in: justify it left, or name another of the file's styles`,
        );

      const laidOut = laidOutIn(e);

      if (laidOut !== undefined)
        refuse(
          `The addition ${id} is laid out by tsdraft in the file's text style ${laidOut}, whose font tsdraft does not hold: only a text justified left and a paragraph of one column may be drawn in it`,
        );

      // tsdraft draws a dimension's text along its line, which a style that keeps it level
      // draws otherwise wherever the line is not level.
      if (e.kind === "dimension" && levelText.has(layerKey(e.style))) {
        const along =
          e.type === "aligned"
            ? (Math.atan2(e.to[1] - e.from[1], e.to[0] - e.from[0]) * 180) / Math.PI
            : (e.angle ?? 0);

        const turned = Math.abs(((along % 180) + 180) % 180);

        if (Math.min(turned, 180 - turned) > 1e-9)
          report({
            rule: "edit-addition",
            severity: "error",
            ...(e.handle !== undefined && { handle: e.handle }),
            message: `The addition ${e.mark?.id ?? e.handle ?? ""} is a dimension at ${along} degrees in the style ${JSON.stringify(e.style)}, which keeps its text level, and tsdraft draws a dimension's text along its line: draw it level, or in a style that lays its text along the line`,
          });
      }

      const l = layers.get(layerKey(e.layer));

      const why =
        layerKey(e.layer) === "0"
          ? "the layer 0, which takes the layer of what inserts it"
          : layerKey(e.layer) === "defpoints"
            ? "Defpoints, which does not plot"
            : l === undefined
              ? undefined
              : !l.on
                ? "a layer that is off"
                : l.frozen
                  ? "a frozen layer"
                  : !l.plot
                    ? "a layer set not to plot"
                    : space.layout === undefined && frozenIn.has(layerKey(e.layer))
                      ? "a layer a viewport of the file freezes"
                      : undefined;

      if (why !== undefined)
        report({
          rule: "edit-addition-layer",
          severity: "warning",
          ...(e.handle !== undefined && { handle: e.handle }),
          message: `The addition ${e.mark?.id ?? e.handle ?? ""} is on ${JSON.stringify(e.layer)}, ${why}`,
        });
    }
}
