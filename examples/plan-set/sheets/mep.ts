// M-101, E-101 and P-101, the MEP sheets. The electrical design is in `mep-power.ts`, the HVAC
// design in `mep-equip.ts` and `mep-hvac.ts`, the sheets in `mep-m101.ts`, `mep-e101.ts` and
// `mep-p101.ts`.
import type { SheetDraw } from "../lib/kit.ts";
import { SHEETS_E } from "./mep-e101.ts";
import { SHEETS_M } from "./mep-m101.ts";
import { SHEETS_P } from "./mep-p101.ts";

export const SHEETS: Record<string, SheetDraw> = { ...SHEETS_M, ...SHEETS_E, ...SHEETS_P };
