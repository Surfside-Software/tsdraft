import type { Drawing, DxfVersion } from "./drawing.ts";
import { toDXFR12 } from "./dxf-r12.ts";
import { toDXFR2018 } from "./dxf-r2018.ts";
import { DrawingError, lint } from "./lint.ts";

export interface DxfOptions {
  /** Defaults to the version the drawing was created for, which is `"R2018"` unless set. */
  readonly version?: DxfVersion;
}

/**
 * Writes the drawing as ASCII DXF. Throws a `DrawingError` listing every lint
 * error when the drawing breaks a rule of the version being written, because
 * AutoCAD would reject or garble the file.
 */
export function toDXF(drawing: Drawing, options: DxfOptions = {}): string {
  const version = options.version ?? drawing.dxf;
  if (version !== "R12" && version !== "R2018") {
    throw new Error(`Unsupported DXF version: ${JSON.stringify(version)}`);
  }
  const errors = lint(drawing, { version }).filter((d) => d.severity === "error");
  if (errors.length > 0) throw new DrawingError(errors);
  return version === "R12" ? toDXFR12(drawing) : toDXFR2018(drawing);
}
