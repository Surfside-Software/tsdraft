import type { Drawing } from "./drawing.ts";
import { toDXFR12 } from "./dxf-r12.ts";
import { toDXFR2018 } from "./dxf-r2018.ts";

/**
 * DXF versions tsdraft writes.
 *
 * - `"R12"` (AC1009) opens in nearly every CAD program, but has no units or handles.
 * - `"R2018"` (AC1032) is the newest published version and the native format of
 *   AutoCAD 2018 through 2027. It records the drawing's units.
 */
export type DxfVersion = "R12" | "R2018";

export interface DxfOptions {
  /** Defaults to `"R12"`. */
  readonly version?: DxfVersion;
}

/** Writes the drawing as ASCII DXF. */
export function toDXF(drawing: Drawing, options: DxfOptions = {}): string {
  const version = options.version ?? "R12";
  switch (version) {
    case "R12":
      return toDXFR12(drawing);
    case "R2018":
      return toDXFR2018(drawing);
    default:
      throw new Error(`Unsupported DXF version: ${JSON.stringify(version satisfies never)}`);
  }
}
