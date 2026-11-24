// The refusals of a change of an entity, a layer's change and a viewport's that the read can
// tell, beside those `handleProblem` gives every statement that names a handle.
import { isString } from "../guards.ts";
import { layerKey } from "../layers.ts";
import { layoutMtext } from "../read/mtext.ts";
import type { DrawingRead, ReadEntity, ReadMtext, ReadViewport } from "../read/model.ts";
import { changedEntity, changedViewport, layerNamed, linetypeNamed } from "./changed.ts";
import type { EditRule } from "./lint.ts";
import { canonicalHandle, type EditStatement } from "./model.ts";
import type { ReadIndex } from "./reach.ts";
import { breaksColumn, styleOf } from "./text-change.ts";

export interface ChangeProblem {
  readonly rule: EditRule;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly handle?: string;
}

const error = (rule: EditRule, message: string, handle?: string): ChangeProblem => ({
  rule,
  severity: "error",
  message,
  ...(handle !== undefined && { handle }),
});

/**
 * Why paragraph text of columns cannot be changed so, or undefined when it can: `after` is the
 * text after the change. Two or more columns take no width; one dynamic column of a height of its
 * own takes no change that would flow its text into a second.
 */
function columnsProblem(
  after: ReadMtext,
  widthGiven: boolean,
  read: DrawingRead,
): string | undefined {
  const e = after;
  const width = after.width;
  const c = e.columns;

  if (c === undefined) return undefined;

  if ((c.count ?? 1) > 1 || (c.heights?.length ?? 0) > 1)
    return widthGiven
      ? "it is paragraph text of two or more columns, which hold their own widths, so it takes no width"
      : undefined;

  // A dynamic column of a height of its own, given once or as its one height.
  const tall = c.height ?? c.heights?.[0];

  if (c.count === undefined && tall !== undefined && tall > 0) {
    if (breaksColumn(after.value))
      return "its text after the change holds a column break, \\N, which starts a second column";

    // A dynamic column of a height of its own flows into a second when the text grows past it.
    const { columns: _, ...one } = e;
    const layout = layoutMtext({ ...one, width }, styleOf(read.textStyles, e.style));
    const [, bottom, , top] = layout.frame;

    if (top - bottom > tall * (1 + 1e-9))
      return `its text after the change runs past its column's height, ${tall}, into a second column`;
  }

  return undefined;
}

/** The problems of a change of the entity `e`, which `handleProblem` found nothing wrong with. */
export function entityChangeProblems(
  read: DrawingRead,
  e: ReadEntity,
  statement: Extract<EditStatement, { kind: "change" }>,
): ChangeProblem[] {
  const out: ChangeProblem[] = [];
  const c = statement.changes;
  const h = canonicalHandle(statement.handle);

  if (c.layer !== undefined && layerNamed(read, c.layer) === undefined)
    out.push(
      error(
        "edit-change",
        `The file holds no layer ${JSON.stringify(c.layer)}: an edit adds no layer yet`,
        h,
      ),
    );

  if (c.linetype !== undefined && linetypeNamed(read, c.linetype) === undefined)
    out.push(
      error(
        "edit-change",
        `The file holds no linetype ${JSON.stringify(c.linetype)}: an edit adds no linetype yet`,
        h,
      ),
    );

  // A host keeps an xref's layer only while VISRETAIN is 1, and the xref's file owns it.
  if (c.layer !== undefined && layerNamed(read, c.layer)?.xref === true)
    out.push(
      error(
        "edit-change",
        `${JSON.stringify(c.layer)} is a layer of an xref: an entity of the host goes on a layer of its own`,
        h,
      ),
    );

  const shows = (handle: string | undefined): boolean =>
    handle !== undefined &&
    read.fields.some(
      (f) =>
        f.text.handle !== undefined && canonicalHandle(f.text.handle) === canonicalHandle(handle),
    );

  for (const [tag, t] of Object.entries(c.attributes ?? {}))
    if (!isString(t) && e.kind === "insert")
      for (const a of e.attributes ?? [])
        if (a.tag.toUpperCase() === tag.toUpperCase() && shows(a.handle))
          out.push(
            error(
              "edit-change",
              `The attribute ${JSON.stringify(tag)} of ${h} shows a field, which writes its own value back over a part of it: give it a whole value`,
              h,
            ),
          );

  if (c.text !== undefined && !isString(c.text) && shows(h))
    out.push(
      error(
        "edit-change",
        `${h} shows a field, which writes its own value back over a part of it: give it a whole value, which takes the field out`,
        h,
      ),
    );

  if (c.height !== undefined && e.kind === "text" && e.align === "aligned")
    out.push(error("edit-change", `${h} is an aligned text, whose height its two points set`, h));

  const made = changedEntity(e, c, read);

  if ("problem" in made) out.push(error("edit-change", `${h}: ${made.problem}`, h));
  else if (
    made.kind === "mtext" &&
    (c.width !== undefined || c.text !== undefined || c.height !== undefined)
  ) {
    const why = columnsProblem(made, c.width !== undefined, read);

    if (why !== undefined) out.push(error("edit-change", `${h} cannot be changed so: ${why}`, h));
  }

  return out;
}

/** The problems of a layer's change. */
export function layerChangeProblems(
  read: DrawingRead,
  statement: Extract<EditStatement, { kind: "layer" }>,
): ChangeProblem[] {
  const out: ChangeProblem[] = [];
  const layer = layerNamed(read, statement.name);
  const c = statement.changes;

  if (layer === undefined) {
    out.push(
      error(
        "edit-layer",
        `The file holds no layer ${JSON.stringify(statement.name)}${statement.name.includes("|") ? ": a host keeps a record of an xref's layer only while its VISRETAIN is 1, and its DWG holds none otherwise" : ""}`,
      ),
    );

    return out;
  }

  if (c.linetype !== undefined && linetypeNamed(read, c.linetype) === undefined)
    out.push(
      error(
        "edit-layer",
        `The file holds no linetype ${JSON.stringify(c.linetype)}: an edit adds no linetype yet`,
      ),
    );

  const current = read.header.clayer ?? "0";

  if (c.frozen === true && layerKey(layer.name) === layerKey(current))
    out.push(error("edit-layer", `${layer.name} is the current layer, which is never frozen`));

  if (c.linetype !== undefined && /^by(layer|block)$/i.test(c.linetype))
    out.push(
      error("edit-layer", "A layer's linetype is one of the file's, not ByLayer or ByBlock"),
    );

  return out;
}

/** The four corners of what a viewport shows of model space. */
function viewCorners(v: ReadViewport): (readonly [number, number])[] {
  const ratio = v.ratio > 0 ? v.ratio : 1;
  const [w, h] = [v.width / ratio / 2, v.viewHeight / 2];
  const turn = (-v.twist * Math.PI) / 180;
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)];

  return [
    [-w, -h],
    [w, -h],
    [w, h],
    [-w, h],
  ].map(
    ([x, y]) =>
      [v.viewCenter[0] + x! * cos - y! * sin, v.viewCenter[1] + x! * sin + y! * cos] as const,
  );
}

/** The box of points, `[left, bottom, right, top]`. */
const boxOf = (points: readonly (readonly [number, number])[]) =>
  [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ] as const;

/** The problems of a viewport's change. */
export function viewportChangeProblems(
  read: DrawingRead,
  index: ReadIndex,
  statement: Extract<EditStatement, { kind: "viewport" }>,
  missing: string,
): ChangeProblem[] {
  const h = canonicalHandle(statement.handle);
  const at = index.byHandle.get(h);

  if (at === undefined)
    return [
      error(
        "edit-missing",
        `The edit changes the viewport ${h}, which the file does not hold${missing}`,
        h,
      ),
    ];

  if (at.kind !== "viewport") return [error("edit-viewport", `${h} is not a viewport`, h)];
  const out: ChangeProblem[] = [];
  const c = statement.changes;

  for (const name of [...(c.freeze ?? []), ...(c.thaw ?? [])])
    if (layerNamed(read, name) === undefined)
      out.push(
        error(
          "edit-viewport",
          `The file holds no layer ${JSON.stringify(name)} to freeze or thaw in ${h}`,
          h,
        ),
      );

  if (
    at.viewport.turnedView &&
    (c.center !== undefined || c.ratio !== undefined || c.twist !== undefined)
  )
    out.push(
      error(
        "edit-viewport",
        `${h} looks along another direction than straight down, so it is not re-aimed`,
        h,
      ),
    );

  if (
    read.only !== undefined &&
    (c.center !== undefined || c.ratio !== undefined || c.twist !== undefined)
  ) {
    // What the viewport shows after lies inside one area of the read or one window of a layout
    // it keeps, or the preview and the checks would miss what it shows.
    const v = changedViewport(at.viewport, c, read);
    const corners = viewCorners(v);
    const only = read.only;

    const inside = (box: readonly [number, number, number, number]): boolean =>
      corners.every(([x, y]) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]);

    const areas = (only.areas ?? []).map(
      ([p, q]) =>
        [
          Math.min(p[0], q[0]),
          Math.min(p[1], q[1]),
          Math.max(p[0], q[0]),
          Math.max(p[1], q[1]),
        ] as const,
    );

    const kept = new Set((only.layouts ?? []).map((n) => n.toUpperCase()));

    const windows = read.layouts
      .filter((l) => kept.has(l.name.toUpperCase()))
      .flatMap((l) =>
        l.viewports.filter((w) => w.on && w.twist % 360 === 0).map((w) => boxOf(viewCorners(w))),
      );

    const shown = [...areas, ...windows].some(inside);

    if (!shown)
      out.push(
        error(
          "edit-viewport",
          `${h} would show model space the edit's read leaves out: name the new view's area in the edit's only`,
          h,
        ),
      );
  }

  return out;
}
