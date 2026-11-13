// The Calloway Residence permit set: one drawing, one layout per sheet, in inches. The border
// is the firm's way: its own DWG, attached on every layout as an xref.
import { mkdirSync, writeFileSync } from "node:fs";
import { checkIntent, createDrawing, toDXF, toSVG, type Intent } from "../../src/index.ts";
import { BORDER, BORDER_PATH } from "./lib/frame.ts";
import { defineLayers, defineSymbols, resetKit, type SheetDraw } from "./lib/kit.ts";
import { borderDrawing, defineSheetFields } from "./lib/titleblock.ts";
import { SHEETS } from "./project.ts";
import { SHEETS as COVER } from "./sheets/cover.ts";
import { SHEETS as ELEVATIONS } from "./sheets/elevations.ts";
import { SHEETS as MEP } from "./sheets/mep.ts";
import { SHEETS as PLANS } from "./sheets/plans.ts";
import { SHEETS as ROOF } from "./sheets/roof.ts";
import { SHEETS as SCHEDULES } from "./sheets/schedules.ts";
import { INTENT, SHEETS as SITE } from "./sheets/site.ts";
import { SHEETS as STRUCTURE } from "./sheets/structure.ts";

export function buildSet() {
  resetKit();
  const d = createDrawing({ units: "in", linetypeScale: 0.5 });
  defineLayers(d);
  defineSymbols(d);
  defineSheetFields(d);
  d.xref(BORDER, BORDER_PATH);
  // Each module gives the sheets it draws, by number. A sheet draws its model space at an
  // origin of its own, so no viewport shows another sheet's views.
  const sheets: Record<string, SheetDraw> = {
    ...COVER,
    ...SITE,
    ...PLANS,
    ...ROOF,
    ...ELEVATIONS,
    ...SCHEDULES,
    ...STRUCTURE,
    ...MEP,
  };
  for (const s of SHEETS) sheets[s.number]?.(d);
  return d.build();
}

const drawing = buildSet();
export default drawing;
export const xrefs = { [BORDER]: borderDrawing() };
export const intent: Intent = INTENT;

// When run, it writes the set's DXF, the border's DXF at the path the xref names, and an SVG of each
// sheet, to examples/out/plan-set/. Model space holds every sheet's views side by side, so it
// gets no picture of its own.
if (import.meta.main) {
  const outDir = new URL("../out/plan-set/", import.meta.url);
  const borderFile = new URL(BORDER_PATH.replace(/\.dwg$/, ".dxf"), outDir);
  mkdirSync(new URL(".", borderFile), { recursive: true });
  writeFileSync(new URL("plan-set.dxf", outDir), toDXF(drawing));
  writeFileSync(borderFile, toDXF(xrefs[BORDER]));
  const layouts = drawing.layouts ?? [];
  for (const { name } of layouts) {
    writeFileSync(new URL(`${name}.svg`, outDir), toSVG(drawing, { layout: name, xrefs }));
  }
  const onSheets = layouts.reduce((sum, layout) => sum + layout.entities.length, 0);
  console.log(
    `Wrote ${drawing.entities.length} entities in model space and ${onSheets} on ` +
      `${layouts.length} sheets, on ${drawing.layers.length} layers, to examples/out/plan-set/`,
  );
  const warnings = checkIntent(drawing, intent);
  console.log(
    warnings.length === 0
      ? "The house keeps out of every setback"
      : warnings.map((w) => w.message).join("\n"),
  );
}
