// The brief of a build: what an agent needs after each save, in a few hundred tokens, where the
// whole BuildState of a set of sheets can be a hundred thousand. `tsdraft mcp` answers `render`
// with it, and a program `execute` runs can make one from any state.
import { relative } from "node:path";
import { PNG_SKIPPED } from "./render.ts";
import type { BuildDiagnostic, BuildState, Box, XrefSummary } from "./state.ts";

/** The most diagnostics a brief lists. The rest are counted by rule. */
export const BRIEF_DIAGNOSTICS = 12;

/** The end of the drawing file's log a brief keeps. */
const BRIEF_LOG = 1_500;

export interface Brief {
  readonly ok: boolean;
  /** As `tsdraft render` exits: 0 built with no lint errors, 2 lint reported errors, 1 failed. */
  readonly code: 0 | 1 | 2;
  readonly file: string;
  readonly ms: number;
  /** Why the build failed, at the line to fix. */
  readonly error?: {
    readonly name: string;
    readonly message: string;
    readonly at: string | null;
  };
  readonly units?: string;
  readonly extents?: Box;
  readonly counts?: NonNullable<BuildState["drawing"]>["counts"];
  /** What lint left out of the pictures, by the `item` of its error. */
  readonly omitted?: readonly string[];
  /** Each xref, at any depth, with `(not shown)` after one the pictures do not draw. */
  readonly xrefs?: readonly string[];
  /** Each layout: its name, paper and how many viewports it has. */
  readonly layouts?: readonly string[];
  /** Every diagnostic, counted by its rule. */
  readonly rules: Readonly<Record<string, number>>;
  /** The first diagnostics, errors first, each at the call that made it. */
  readonly diagnostics: readonly BriefDiagnostic[];
  /** How many diagnostics `diagnostics` leaves out. */
  readonly more: number;
  /** Each picture this build wrote, by what it shows. */
  readonly pictures: readonly Picture[];
  readonly pdf?: string;
  readonly pdfError?: string;
  /** The end of what the drawing file printed. */
  readonly log?: string;
}

export interface BriefDiagnostic {
  readonly severity: "error" | "warning";
  readonly rule: string;
  readonly message: string;
  /** The call in the drawing's code that made it, as `file:line:column` from the working folder. */
  readonly at?: string;
  /** Where in the drawing it is, as the diagnostic names it. */
  readonly where?: string;
  /** Its box in the coordinates of its picture: give it to `render`'s `view`. */
  readonly bounds?: readonly [number, number, number, number];
}

export interface Picture {
  /** `model`, `view`, `layout <name>`, `changes` or `changes <layout>`. */
  readonly shows: string;
  readonly png: string | null;
  readonly svg: string;
  readonly pngError?: string;
  /** True when the answer of `tsdraft mcp`'s render carries it as an image. */
  readonly attached?: boolean;
}

/** Makes the brief of a build, with paths from `cwd`. */
export function brief(state: BuildState, code: 0 | 1 | 2, cwd: string): Brief {
  const near = (path: string): string => {
    const from = relative(cwd, path);

    return from.startsWith("..") || from === "" ? path : from;
  };

  const drawing = state.drawing;
  const rules: Record<string, number> = {};

  for (const d of state.diagnostics) rules[d.rule] = (rules[d.rule] ?? 0) + 1;

  const diagnostics = state.diagnostics.slice(0, BRIEF_DIAGNOSTICS).map((d) => diagnostic(d, near));
  const { outputs } = state;
  const pictures: Picture[] = [];

  const picture = (
    shows: string,
    made: { svg: string | null; png: string | null; pngError: string | null },
  ) => {
    if (made.svg === null) return;
    pictures.push({
      shows,
      svg: near(made.svg),
      png: made.png === null ? null : near(made.png),
      // A PNG left out on purpose needs no word: `png` is null.
      ...(made.pngError !== null && made.pngError !== PNG_SKIPPED && { pngError: made.pngError }),
    });
  };

  if (outputs.view) picture("view", outputs.view);

  if (outputs.changes) {
    picture("changes", outputs.changes);

    for (const sheet of outputs.changes.layouts) picture(`changes ${sheet.name}`, sheet);
  }

  for (const sheet of outputs.layouts) picture(`layout ${sheet.name}`, sheet);
  picture("model", outputs);

  const error = state.error;
  const log = state.log.trim();

  return {
    ok: state.ok,
    code,
    file: near(state.file),
    ms: state.ms,
    ...(error && {
      error: {
        name: error.name,
        message: error.message,
        at: error.file === null ? null : `${near(error.file)}:${error.line}:${error.column}`,
      },
    }),
    ...(drawing && {
      units: drawing.units,
      extents: drawing.extents,
      counts: drawing.counts,
      ...(drawing.omitted && { omitted: drawing.omitted }),
      ...(drawing.xrefs.length > 0 && { xrefs: xrefNames(drawing.xrefs, "") }),
      ...(drawing.layouts.length > 0 && {
        layouts: drawing.layouts.map(
          (l) =>
            `${l.name}: ${l.paper}, ${l.viewports.length} viewport${l.viewports.length === 1 ? "" : "s"}`,
        ),
      }),
    }),
    rules,
    diagnostics,
    more: state.diagnostics.length - diagnostics.length,
    pictures,
    ...(outputs.pdf !== null && { pdf: near(outputs.pdf) }),
    ...(outputs.pdfError !== null && { pdfError: outputs.pdfError }),
    ...(log !== "" && { log: log.length > BRIEF_LOG ? `…${log.slice(-BRIEF_LOG)}` : log }),
  };
}

/** Each xref's name, after the names of those it is inside, and whether the pictures draw it. */
function xrefNames(xrefs: readonly XrefSummary[], inside: string): string[] {
  return xrefs.flatMap((xref) => [
    `${inside}${xref.name}${xref.shown ? "" : " (not shown)"}`,
    ...xrefNames(xref.xrefs, `${inside}${xref.name} > `),
  ]);
}

function diagnostic(d: BuildDiagnostic, near: (path: string) => string): BriefDiagnostic {
  const where = [
    d.xref !== undefined && `xref ${d.xref}`,
    d.layout !== undefined && `layout ${d.layout}`,
    d.viewport !== undefined && `viewport ${d.viewport}`,
    d.block !== undefined && `block ${d.block}`,
    d.entity !== undefined && `entity ${d.entity}${d.kind === undefined ? "" : ` (${d.kind})`}`,
    d.id !== undefined && `id ${d.id}`,
    d.layer !== undefined && `layer ${d.layer}`,
    d.item !== undefined && `item ${d.item}`,
  ].filter((part) => part !== false);

  return {
    severity: d.severity,
    rule: d.rule,
    message: d.message,
    ...(d.call && { at: `${near(d.call.file)}:${d.call.line}:${d.call.column}` }),
    ...(where.length > 0 && { where: where.join(", ") }),
    ...(d.bounds && {
      // Rounded outward, so the box still holds all it is about, however small.
      bounds: [
        Math.floor(d.bounds.min[0] * 1000) / 1000,
        Math.floor(d.bounds.min[1] * 1000) / 1000,
        Math.ceil(d.bounds.max[0] * 1000) / 1000,
        Math.ceil(d.bounds.max[1] * 1000) / 1000,
      ],
    }),
  };
}
