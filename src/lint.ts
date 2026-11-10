import type { Drawing, DxfVersion, Entity, Point } from "./drawing.ts";
import { written } from "./format.ts";
import { layerAuditKey, layerKey } from "./layers.ts";
import { BUILT_IN_LINETYPES, builtInLinetype } from "./linetypes.ts";
import {
  arcIsWrittenAsPoint,
  arcProblem,
  layerColorProblem,
  layerFlagProblem,
  layerLinetypeProblem,
  layerNameProblem,
  layerStateProblem,
  layerTwinProblem,
  lineweightProblem,
  linetypeNameProblem,
  linetypeProblem,
  linetypeScaleProblem,
  R12_ONLY,
  magnitudeProblem,
  sizeProblem,
  textProblem,
  textWarning,
  undefinedLinetypeProblem,
} from "./rules.ts";

export type LintRule =
  | "units"
  | "layer-name"
  | "duplicate-layer"
  | "layer-color"
  | "undefined-layer"
  | "linetype"
  | "duplicate-linetype"
  | "undefined-linetype"
  | "lineweight"
  | "layer-state"
  | "geometry"
  | "text"
  | "zero-length";

export interface Diagnostic {
  readonly rule: LintRule;
  /** An error means AutoCAD rejects, repairs or garbles the output. `toDXF` refuses to write it. */
  readonly severity: "error" | "warning";
  readonly message: string;
  /** The layer the problem is in, when it is a layer problem. */
  readonly layer?: string;
  /** The linetype the problem is in, when it is a problem with a linetype's definition. */
  readonly linetype?: string;
  /** Index into `drawing.entities`, when it is an entity problem. */
  readonly entity?: number;
}

export interface LintOptions {
  /** The DXF version to check against. Defaults to the drawing's own. */
  readonly version?: DxfVersion;
}

/**
 * Checks a drawing against the rules AutoCAD enforces when it opens DXF.
 *
 * A drawing made with `createDrawing()` already passes the error rules for its
 * own DXF version, because the builder throws at the offending call. `lint`
 * matters when a `Drawing` was built by hand or by other code, when it is
 * exported as a different version than it was built for, and for warnings.
 */
export function lint(drawing: Drawing, options: LintOptions = {}): Diagnostic[] {
  const version = options.version ?? drawing.dxf;
  const out: Diagnostic[] = [];

  if (!["in", "ft", "mm", "cm", "m"].includes(drawing.units)) {
    out.push({
      rule: "units",
      severity: "error",
      message: `Unknown units: ${JSON.stringify(drawing.units)}`,
    });
  }

  const r12 = version === "R12";
  const scale = drawing.linetypeScale;
  if (scale !== undefined && (r12 ? scale !== 1 : linetypeScaleProblem(scale))) {
    const problem = r12 ? R12_ONLY.linetypes : linetypeScaleProblem(scale);
    out.push({ rule: "linetype", severity: "error", message: `linetypeScale: ${problem}` });
  }

  // AutoCAD compares linetype names as it compares layer names, and AUDIT reports a twin of a
  // built-in linetype as it reports any other.
  const linetypes = new Set<string>();
  const linetypesAudited = new Map<string, string>(
    BUILT_IN_LINETYPES.map((name) => [layerAuditKey(name), name]),
  );
  for (const linetype of drawing.linetypes ?? []) {
    const error = (rule: LintRule, message: string) =>
      out.push({ rule, severity: "error", message, linetype: linetype.name });
    const label = `Linetype ${JSON.stringify(linetype.name)}`;
    if (r12) {
      error("linetype", `${label}: ${R12_ONLY.linetypes}`);
      continue;
    }
    const problem = linetypeProblem(linetype.name, linetype.description, linetype.pattern);
    if (problem) error("linetype", `${label}: ${problem}`);
    if (typeof linetype.name !== "string") continue;
    const key = layerKey(linetype.name);
    const auditKey = layerAuditKey(linetype.name);
    const twin = layerTwinProblem(
      linetype.name,
      linetypesAudited.get(auditKey) ?? linetype.name,
      "linetype",
    );
    if (linetypes.has(key)) {
      error(
        "duplicate-linetype",
        `${label} is defined twice. CAD ignores case in linetype names and keeps the first`,
      );
    } else if (twin) {
      error("duplicate-linetype", `${label}: ${twin}`);
    }
    linetypes.add(key);
    if (!linetypesAudited.has(auditKey)) linetypesAudited.set(auditKey, linetype.name);
  }
  /** What is wrong with a reference to a linetype, which AutoCAD discards a drawing over. */
  const missing = (name: unknown): string | undefined => {
    if (typeof name !== "string") return "a linetype is named by a string";
    const problem = linetypeNameProblem(name);
    if (problem) return `Linetype ${JSON.stringify(name)}: ${problem}`;
    return builtInLinetype(name) || linetypes.has(layerKey(name))
      ? undefined
      : undefinedLinetypeProblem(name);
  };

  // AutoCAD looks layers up by one form of their names, and AUDIT compares another.
  const seen = new Set<string>();
  const audited = new Map<string, string>();
  for (const layer of drawing.layers) {
    const error = (rule: LintRule, message: string) =>
      out.push({ rule, severity: "error", message, layer: layer.name });
    const nameProblem = layerNameProblem(layer.name, version);
    if (nameProblem) error("layer-name", `Layer ${JSON.stringify(layer.name)}: ${nameProblem}`);
    const colorProblem = layerColorProblem(layer.color);
    if (colorProblem) error("layer-color", `Layer ${JSON.stringify(layer.name)}: ${colorProblem}`);
    const label = `Layer ${JSON.stringify(layer.name)}`;
    if (layer.linetype !== undefined) {
      const name: unknown = layer.linetype;
      if (r12) {
        if (typeof name !== "string" || builtInLinetype(name) !== "Continuous") {
          error("linetype", `${label}: ${R12_ONLY.linetypes}`);
        }
      } else {
        const absent = missing(name);
        if (absent) error("undefined-linetype", `${label}: ${absent}`);
        const problem = typeof name === "string" ? layerLinetypeProblem(name) : undefined;
        if (problem) error("linetype", `${label}: ${problem}`);
      }
    }
    if (layer.lineweight !== undefined) {
      const problem =
        lineweightProblem(layer.lineweight, "layer") ??
        (r12 && layer.lineweight !== "Default" ? R12_ONLY.lineweights : undefined);
      if (problem) error("lineweight", `${label}: ${problem}`);
    }
    for (const state of ["off", "frozen", "locked", "plot"] as const) {
      const flagProblem = layerFlagProblem(state, layer[state]);
      if (flagProblem) error("layer-state", `${label}: ${flagProblem}`);
    }
    const states = layer.off || layer.frozen || layer.locked || layer.plot === false;
    const stateProblem =
      r12 && states ? R12_ONLY.layerStates : layerStateProblem(layer.name, layer.frozen);
    if (stateProblem) error("layer-state", `${label}: ${stateProblem}`);
    const key = layerKey(layer.name);
    const auditKey = layerAuditKey(layer.name);
    const twinProblem = layerTwinProblem(layer.name, audited.get(auditKey) ?? layer.name);
    if (seen.has(key)) {
      error(
        "duplicate-layer",
        `Layer ${JSON.stringify(layer.name)} is defined twice. CAD ignores case in layer names`,
      );
    } else if (twinProblem) {
      error("duplicate-layer", `Layer ${JSON.stringify(layer.name)}: ${twinProblem}`);
    }
    seen.add(key);
    if (!audited.has(auditKey)) audited.set(auditKey, layer.name);
  }
  if (!seen.has("0")) {
    out.push({ rule: "undefined-layer", severity: "error", message: 'Layer "0" is missing' });
  }

  drawing.entities.forEach((entity, index) => {
    const add = (rule: LintRule, severity: Diagnostic["severity"], problem: string) =>
      out.push({ rule, severity, message: `${entity.kind} #${index}: ${problem}`, entity: index });
    if (!seen.has(layerKey(entity.layer))) {
      // AutoCAD adds a layer for a name it does not know. When AUDIT takes that name for a
      // declared layer's, it then reports the new layer as a duplicate of it.
      const twin = audited.get(layerAuditKey(entity.layer));
      const hint = twin
        ? `. AutoCAD does not take it for layer ${JSON.stringify(twin)}: it would add a layer, and its AUDIT would report a duplicate name`
        : "";
      add(
        "undefined-layer",
        "error",
        `layer ${JSON.stringify(entity.layer)} is not defined${hint}`,
      );
    }
    if (entity.linetype !== undefined) {
      const name: unknown = entity.linetype;
      const problem = r12
        ? typeof name === "string" && builtInLinetype(name) === "ByLayer"
          ? undefined
          : R12_ONLY.entityStyle
        : missing(name);
      if (problem) add(r12 ? "linetype" : "undefined-linetype", "error", problem);
    }
    if (entity.lineweight !== undefined) {
      const problem =
        lineweightProblem(entity.lineweight, "entity") ??
        (r12 && entity.lineweight !== "ByLayer" ? R12_ONLY.entityStyle : undefined);
      if (problem) add("lineweight", "error", problem);
    }
    const problems = geometryProblems(entity);
    for (const problem of problems) add("geometry", "error", problem);
    if (entity.kind === "text") {
      const problem = textProblem(entity.value);
      if (problem) add("text", "error", problem);
      const warning = textWarning(entity.value);
      if (warning) add("text", "warning", warning);
    }
    // A shape with a geometry error has no length worth a second message.
    const collapsed = problems.length === 0 ? zeroLength(entity) : undefined;
    if (collapsed) add("zero-length", "warning", collapsed);
  });

  return out;
}

/**
 * An error that refuses a drawing because of what `lint` found in it. `toDXF`
 * throws it when a drawing has lint errors for the version being written, and
 * other code can throw it to refuse a drawing for its own purpose. Its message
 * lists the first 10 problems and names no file format.
 */
export class DrawingError extends Error {
  /** Every problem the drawing was refused for, including those the message leaves out. */
  readonly diagnostics: readonly Diagnostic[];

  /**
   * @param diagnostics - The problems to refuse the drawing for, as `lint` returns them.
   */
  constructor(diagnostics: readonly Diagnostic[]) {
    const count = diagnostics.length === 1 ? "1 problem" : `${diagnostics.length} problems`;
    const shown = diagnostics.slice(0, 10).map((d) => `- ${d.message}`);
    const more = diagnostics.length > 10 ? [`- and ${diagnostics.length - 10} more`] : [];
    super([`The drawing has ${count}:`, ...shown, ...more].join("\n"));
    this.name = "DrawingError";
    this.diagnostics = diagnostics;
  }
}

function geometryProblems(e: Entity): string[] {
  const out: string[] = [];
  const finite = (label: string, ...values: number[]) => {
    if (!values.every(Number.isFinite)) {
      out.push(`${label} must be finite numbers`);
      return;
    }
    const problem = values.map(magnitudeProblem).find((p) => p !== undefined);
    if (problem) out.push(`${label}: ${problem}`);
  };
  const size = (label: string, value: number) => {
    const problem = Number.isFinite(value) ? sizeProblem(value) : "This value must be finite";
    if (problem) out.push(`${label}: ${problem}`);
  };
  switch (e.kind) {
    case "line":
      finite("its points", ...e.from, ...e.to);
      break;
    case "polyline":
      if (e.points.length < 2) out.push("a polyline needs at least 2 points");
      // A loop, because a polyline can have more points than a call can take arguments.
      if (!e.points.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) {
        out.push("its points must be finite numbers");
      } else {
        for (const [x, y] of e.points) {
          const problem = magnitudeProblem(x) ?? magnitudeProblem(y);
          if (!problem) continue;
          out.push(`its points: ${problem}`);
          break;
        }
      }
      break;
    case "circle":
      finite("its center", ...e.center);
      size("radius", e.radius);
      break;
    case "arc":
      finite("its center", ...e.center);
      size("radius", e.radius);
      if (![e.startAngle, e.endAngle].every((a) => Number.isFinite(a) && a >= 0 && a < 360)) {
        out.push("its angles must be from 0 up to 360");
      } else if (e.startAngle === e.endAngle) {
        out.push("its start and end angles must differ");
      } else {
        const problem = arcProblem(e.startAngle, e.endAngle);
        if (problem) out.push(problem);
      }
      break;
    case "text":
      finite("its position and rotation", ...e.at, e.rotation);
      size("height", e.height);
      break;
  }
  return out;
}

/** Says how a valid entity ends up with no length in the file, or returns undefined when it has one. */
function zeroLength(e: Entity): string | undefined {
  const rounded = "once it is rounded to the 6 decimals tsdraft writes";
  switch (e.kind) {
    case "line":
      if (same(e.from, e.to)) return "the line has no length";
      return sameWritten(e.from, e.to) ? `the line has no length ${rounded}` : undefined;
    case "polyline": {
      const [first] = e.points;
      if (!first) return undefined;
      if (e.points.every((p) => same(p, first))) return "the polyline has no length";
      return e.points.every((p) => sameWritten(p, first))
        ? `the polyline has no length ${rounded}`
        : undefined;
    }
    case "arc":
      return arcIsWrittenAsPoint(e.startAngle, e.endAngle)
        ? `the arc has no length ${rounded}`
        : undefined;
    case "circle":
    case "text":
      return undefined;
  }
}

function same(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function sameWritten(a: Point, b: Point): boolean {
  return written(a[0]) === written(b[0]) && written(a[1]) === written(b[1]);
}
