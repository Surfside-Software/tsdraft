import type { Drawing, DxfVersion, Entity, Point } from "./drawing.ts";
import { layerColorProblem, layerNameProblem, textProblem } from "./rules.ts";

export type LintRule =
  | "units"
  | "layer-name"
  | "duplicate-layer"
  | "layer-color"
  | "undefined-layer"
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

  const seen = new Set<string>();
  for (const layer of drawing.layers) {
    const error = (rule: LintRule, message: string) =>
      out.push({ rule, severity: "error", message, layer: layer.name });
    const nameProblem = layerNameProblem(layer.name, version);
    if (nameProblem) error("layer-name", `Layer ${JSON.stringify(layer.name)}: ${nameProblem}`);
    const colorProblem = layerColorProblem(layer.color);
    if (colorProblem) error("layer-color", `Layer ${JSON.stringify(layer.name)}: ${colorProblem}`);
    const key = layer.name.toLowerCase();
    if (seen.has(key)) {
      error(
        "duplicate-layer",
        `Layer ${JSON.stringify(layer.name)} is defined twice. CAD ignores case in layer names`,
      );
    }
    seen.add(key);
  }
  if (!seen.has("0")) {
    out.push({ rule: "undefined-layer", severity: "error", message: 'Layer "0" is missing' });
  }

  drawing.entities.forEach((entity, index) => {
    const add = (rule: LintRule, severity: Diagnostic["severity"], problem: string) =>
      out.push({ rule, severity, message: `${entity.kind} #${index}: ${problem}`, entity: index });
    if (!seen.has(entity.layer.toLowerCase())) {
      add("undefined-layer", "error", `layer ${JSON.stringify(entity.layer)} is not defined`);
    }
    for (const problem of geometryProblems(entity)) add("geometry", "error", problem);
    if (entity.kind === "text") {
      const problem = textProblem(entity.value);
      if (problem) add("text", "error", problem);
    }
    if (entity.kind === "line" && same(entity.from, entity.to)) {
      add("zero-length", "warning", "the line has no length");
    }
  });

  return out;
}

/** Thrown by `toDXF` when a drawing has lint errors for the version being written. */
export class DrawingError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: readonly Diagnostic[]) {
    const shown = diagnostics.slice(0, 10).map((d) => `- ${d.message}`);
    const more = diagnostics.length > 10 ? [`- and ${diagnostics.length - 10} more`] : [];
    super(["The drawing cannot be written as DXF:", ...shown, ...more].join("\n"));
    this.name = "DrawingError";
    this.diagnostics = diagnostics;
  }
}

function geometryProblems(e: Entity): string[] {
  const out: string[] = [];
  const finite = (label: string, ...values: number[]) => {
    if (!values.every(Number.isFinite)) out.push(`${label} must be finite numbers`);
  };
  const positive = (label: string, value: number) => {
    if (!(Number.isFinite(value) && value > 0)) out.push(`${label} must be greater than 0`);
  };
  switch (e.kind) {
    case "line":
      finite("its points", ...e.from, ...e.to);
      break;
    case "polyline":
      if (e.points.length < 2) out.push("a polyline needs at least 2 points");
      finite("its points", ...e.points.flat());
      break;
    case "circle":
      finite("its center", ...e.center);
      positive("its radius", e.radius);
      break;
    case "arc":
      finite("its center", ...e.center);
      positive("its radius", e.radius);
      if (![e.startAngle, e.endAngle].every((a) => Number.isFinite(a) && a >= 0 && a < 360)) {
        out.push("its angles must be from 0 up to 360");
      } else if (e.startAngle === e.endAngle) {
        out.push("its start and end angles must differ");
      }
      break;
    case "text":
      finite("its position and rotation", ...e.at, e.rotation);
      positive("its height", e.height);
      break;
  }
  return out;
}

function same(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
