// G-001: the cover. Everything here is on the paper: the project, the index read from the sheet
// list, the code data and design criteria read from `project.ts`, the areas worked out from the
// house, a vicinity map and the legend of the set's symbols.
import type { Point } from "../../../src/index.ts";
import { CRITERIA, FIRM, PROJECT, SHEETS as SHEET_LIST } from "../project.ts";
import { areas, ROOF } from "../model/house.ts";
import { frame } from "../lib/frame.ts";
import {
  AREA,
  H,
  LAYERS,
  noteColumn,
  put,
  table,
  TITLE,
  type D,
  type SheetDraw,
} from "../lib/kit.ts";

function cover(d: D): void {
  frame(d, "G-001", (dd) => {
    const top = AREA.top - 0.2;
    dd.layer(LAYERS.text, {}, () => {
      put(dd, [AREA.left + 0.2, top], PROJECT.name, 0.75, { valign: "top", style: TITLE });
      put(dd, [AREA.left + 0.25, top - 1.05], PROJECT.kind, H.head, { valign: "top" });
      put(dd, [AREA.left + 0.25, top - 1.4], `${PROJECT.address}, ${PROJECT.city}`, H.head, {
        valign: "top",
      });
      put(
        dd,
        [AREA.left + 0.25, top - 1.75],
        `OWNER: ${PROJECT.owner}    |    ${PROJECT.parcel}    |    JOB ${PROJECT.job}`,
        H.label,
        { valign: "top" },
      );
      dd.line([AREA.left + 0.2, top - 2.1], [AREA.right - 0.2, top - 2.1], { lineweight: 0.7 });
    });
    const colTop = top - 2.45;
    const a = areas();
    const sf = (n: number) => `${Math.round(n).toLocaleString("en-US")} SF`;
    const heightAboveDfe =
      CRITERIA.flood.ffe + (ROOF.eaveHeight + ROOF.ridgeHeight) / 2 / 12 - CRITERIA.flood.dfe;

    // Column 1: project data, criteria, areas.
    const c1 = AREA.left + 0.2;
    let y = table(
      dd,
      [c1, colTop],
      "PROJECT DATA",
      [
        { name: "ITEM", width: 2.6 },
        { name: "VALUE", width: 4.6 },
      ],
      [
        ["SCOPE", "NEW SINGLE-FAMILY DWELLING"],
        ["OCCUPANCY", "R-3 / FBC-R DWELLING"],
        ["CONSTRUCTION TYPE", CRITERIA.construction],
        ["STORIES", "2"],
        ["FIRE SPRINKLERS", "NONE (NOT REQUIRED)"],
        ["ZONING", "RSF-6 (DEMO)"],
        [
          "FLOOD ZONE / BFE",
          `${CRITERIA.flood.zone} / ${CRITERIA.flood.bfe.toFixed(2)}' ${CRITERIA.flood.datum}`,
        ],
        ["DESIGN FLOOD ELEV.", `${CRITERIA.flood.dfe.toFixed(2)}' NAVD`],
        ["FIRST FLOOR", `${CRITERIA.flood.ffe.toFixed(2)}' NAVD`],
        ["FINISHED GRADE", `${CRITERIA.flood.finishGrade.toFixed(2)}' NAVD AT HOUSE`],
        ["BUILDING HEIGHT", `${heightAboveDfe.toFixed(2)}' D.F.E. TO MEAN ROOF`],
        ["HEIGHT LIMIT", `${CRITERIA.zoning.maxHeight}'-0" (D.F.E. TO MEAN ROOF)`],
        ["PLATE HEIGHTS", `1ST 10'-0", 2ND 9'-1 1/8"`],
      ],
    );
    y -= 0.3;
    y = table(
      dd,
      [c1, y],
      "AREA TABULATION (GROSS, TO OUTSIDE FACE)",
      [
        { name: "AREA", width: 4.2 },
        { name: "SQ. FT.", width: 3.0, align: "right" },
      ],
      [
        ["FIRST FLOOR, CONDITIONED", sf(a.l1)],
        ["SECOND FLOOR, CONDITIONED", sf(a.l2)],
        ["TOTAL CONDITIONED", sf(a.living)],
        ["GARAGE", sf(a.garage)],
        ["ENTRY PORCH", sf(a.porch)],
        ["COVERED LANAI", sf(a.lanai)],
        ["TOTAL UNDER ROOF", sf(a.total)],
      ],
    );
    y -= 0.3;
    const w = CRITERIA.wind;
    table(
      dd,
      [c1, y],
      "DESIGN CRITERIA (ASCE 7-22)",
      [
        { name: "ITEM", width: 3.6 },
        { name: "VALUE", width: 3.6 },
      ],
      [
        ["ULTIMATE WIND SPEED, VULT", `${w.vult} MPH`],
        ["NOMINAL WIND SPEED, VASD", `${w.vasd} MPH`],
        ["RISK CATEGORY", w.risk],
        ["EXPOSURE CATEGORY", w.exposure],
        ["ENCLOSURE", w.enclosure],
        ["INTERNAL PRESSURE COEF.", w.gcpi],
        ["WIND-BORNE DEBRIS REGION", "YES, IMPACT OPENINGS"],
        ["FLOOR LIVE LOAD", `${CRITERIA.live.floor} / ${CRITERIA.live.sleeping} PSF (SLEEPING)`],
        ["ROOF LIVE / DEAD LOAD", `${CRITERIA.live.roof} / ${CRITERIA.dead.roof} PSF`],
        ["SOIL BEARING (ASSUMED)", `${CRITERIA.soil.toLocaleString("en-US")} PSF`],
      ],
    );

    // Column 2: code data and general notes.
    const c2 = AREA.left + 7.9;
    y = noteColumn(dd, [c2, colTop], 7.4, "APPLICABLE CODES", [...CRITERIA.codes], {
      numbered: false,
    });
    y -= 0.25;
    noteColumn(dd, [c2, y], 7.4, "GENERAL NOTES", [
      "THE CONTRACTOR SHALL VERIFY ALL DIMENSIONS AND CONDITIONS AT THE SITE AND REPORT ANY DISCREPANCY TO THE ENGINEER BEFORE STARTING WORK.",
      "ALL WORK SHALL COMPLY WITH THE CODES LISTED ABOVE AND THE REQUIREMENTS OF THE AUTHORITY HAVING JURISDICTION.",
      "THESE DRAWINGS SHOW THE COMPLETED STRUCTURE. MEANS, METHODS, SHORING AND SAFETY DURING CONSTRUCTION ARE THE CONTRACTOR'S.",
      "WRITTEN DIMENSIONS GOVERN. DO NOT SCALE THE DRAWINGS.",
      "EXTERIOR WINDOWS, DOORS, GARAGE DOOR, ROOFING AND SOFFIT SHALL HAVE FLORIDA PRODUCT APPROVAL FOR THE DESIGN PRESSURES ON A-601 AND S-501, SUBMITTED BEFORE INSTALLATION.",
      "PRE-ENGINEERED WOOD TRUSSES ARE A DEFERRED SUBMITTAL, DESIGNED BY A FLORIDA REGISTERED ENGINEER FOR THE LOADS ON S-501. SUBMIT SEALED TRUSS DRAWINGS BEFORE THE FRAMING INSPECTION.",
      "ENERGY CODE COMPLIANCE BY FORM R405 (PERFORMANCE), SUBMITTED UNDER SEPARATE COVER.",
      "THE LOWEST FLOOR AND ALL MECHANICAL AND ELECTRICAL EQUIPMENT ARE AT OR ABOVE THE DESIGN FLOOD ELEVATION. ENCLOSED AREAS BELOW IT ARE FOR PARKING, ACCESS AND STORAGE ONLY.",
      "SUBMIT ELEVATION CERTIFICATES AT THE LOWEST FLOOR FORM INSPECTION AND AT FINAL.",
      "TERMITE PROTECTION: SOIL TREATMENT BY A LICENSED APPLICATOR PER FBC-R R318, CERTIFICATE AT FINAL.",
    ]);

    // Column 3: the index, read from the sheet list.
    const c3 = AREA.left + 15.8;
    y = table(
      dd,
      [c3, colTop],
      "SHEET INDEX",
      [
        { name: "SHEET", width: 1.0 },
        { name: "TITLE", width: 5.6 },
      ],
      SHEET_LIST.map((s) => [
        s.number,
        [s.title, s.title2].filter(Boolean).join(" ").replace(", ", " ") +
          (s.number === "M-101" ? "  (ADDED, REV. 1)" : ""),
      ]),
      { rowHeight: 0.26 },
    );
    y -= 0.3;
    table(
      dd,
      [c3, y],
      "ABBREVIATIONS",
      [
        { name: "", width: 1.0 },
        { name: "", width: 2.3 },
        { name: "", width: 1.0 },
        { name: "", width: 2.3 },
      ],
      [
        ["A.F.F.", "ABOVE FINISH FLOOR", "GWB", "GYPSUM WALLBOARD"],
        ["BFE", "BASE FLOOD ELEVATION", "MAX.", "MAXIMUM"],
        ["CLG.", "CEILING", "MIN.", "MINIMUM"],
        ["CMU", "CONCRETE MASONRY UNIT", "NAVD", "N. AMER. VERT. DATUM"],
        ["CONC.", "CONCRETE", "O.C.", "ON CENTER"],
        ["DFE", "DESIGN FLOOD ELEV.", "OSB", "ORIENTED STRAND BD."],
        ["EL.", "ELEVATION", "P.T.", "PRESSURE TREATED"],
        ["F.F.E.", "FINISH FLOOR ELEV.", "T.O.", "TOP OF"],
        ["FTG.", "FOOTING", "TYP.", "TYPICAL"],
      ],
      { rowHeight: 0.24 },
    );

    // Column 4: vicinity map, legend and the team.
    const c4 = AREA.left + 23.0;
    vicinity(dd, [c4, colTop], 6.5, 5.0);
    legend(dd, [c4, colTop - 6.0], 6.5);
    noteColumn(
      dd,
      [c4, AREA.bottom + 3.2],
      6.5,
      "PROJECT TEAM",
      [
        `OWNER: ${PROJECT.owner}`,
        `ENGINEER: ${FIRM.name} (FICTIONAL), ${FIRM.lines[0]}, ${FIRM.lines[1]}`,
        "CONTRACTOR: TO BE SELECTED",
      ],
      { numbered: false },
    );
  });
}

/** A made-up vicinity map: streets, the canal and the site, not to scale. */
function vicinity(d: D, at: Point, w: number, h: number): void {
  const [x, y0] = at;
  const y = y0 - h;
  d.layer(LAYERS.text, {}, () => {
    put(d, [x, y0], "VICINITY MAP", H.label, { valign: "top" });
    put(d, [x + w, y0], "NOT TO SCALE", H.small, { valign: "top", align: "right" });
    d.rect([x, y], w, h - 0.3, { lineweight: 0.35 });
    const roads: [Point, Point, string, number][] = [
      [[x, y + 1.2], [x + w, y + 1.2], "SANDPIPER COVE DR.", 0],
      [[x, y + 3.4], [x + w, y + 3.4], "HERON SOUND BLVD.", 0],
      [[x + 1.4, y], [x + 1.4, y + h - 0.3], "OSPREY WAY", 90],
      [[x + 5.0, y], [x + 5.0, y + h - 0.3], "COQUINA AVE.", 90],
    ];
    for (const [a, b, name, rot] of roads) {
      d.line(a, b, { lineweight: 0.5 });
      // Each name sits beside its road, clear of the crossing roads.
      const at: Point = rot ? [a[0] - 0.08, y + 0.15] : [x + 2.0, a[1] + 0.08];
      put(d, at, name, H.small, { rotation: rot });
    }
    // The canal, between the two streets, and the site on its south bank.
    d.line([x + 1.5, y + 2.1], [x + w, y + 2.1], { lineweight: 0.18 });
    d.line([x + 1.5, y + 2.5], [x + w, y + 2.5], { lineweight: 0.18 });
    put(d, [x + 3.2, y + 2.24], "HERON SOUND CANAL", H.small, { align: "center" });
    d.rect([x + 3.0, y + 1.3], 0.35, 0.7, { lineweight: 0.7 });
    put(d, [x + 3.5, y + 1.55], "SITE", H.label);
    d.insert("NORTH ARROW", [x + w - 0.6, y + h - 1.0], { scale: 0.7 });
  });
}

function legend(d: D, at: Point, w: number): void {
  let y = at[1];
  d.layer(LAYERS.text, {}, () => {
    put(d, [at[0], y], "SYMBOLS", H.label, { valign: "top" });
    y -= H.label + 0.06;
    d.line([at[0], y], [at[0] + w, y], { lineweight: 0.35 });
    y -= 0.35;
  });
  const row = (label: string, draw: (c: Point) => void) => {
    d.layer(LAYERS.text, {}, () => {
      draw([at[0] + 0.45, y + 0.04]);
      put(d, [at[0] + 1.2, y], label, H.note, { valign: "middle" });
    });
    y -= 0.5;
  };
  row("VIEW TITLE: VIEW NO. / SHEET", (c) =>
    d.insert("VIEW TITLE", [c[0] - 0.25, c[1]], {
      scale: 0.6,
      attributes: { VIEW_NO: "1", VIEW_SHEET: "A-301", VIEW_TITLE: "", VIEW_SCALE: "" },
    }),
  );
  row("SECTION: NO. / SHEET", (c) =>
    d.insert("SECTION MARK", c, { attributes: { SECT: "A", SHEET: "A-301" } }),
  );
  row("DOOR NUMBER", (c) => d.insert("DOOR TAG", c, { attributes: { DOOR: "101" } }));
  row("WINDOW TYPE", (c) => d.insert("WINDOW TAG", c, { attributes: { WINDOW: "A" } }));
  row("LEVEL: NAME / ELEVATION", (c) =>
    d.insert("LEVEL", [c[0] - 0.2, c[1]], { attributes: { NAME: "", EL: "" } }),
  );
  row("SPOT GRADE, PROPOSED / (EXISTING)", (c) => d.insert("SPOT", c, { attributes: { EL: "" } }));
  row("FLOOD VENT", (c) => d.insert("FLOOD VENT", c));
}

export const SHEETS: Record<string, SheetDraw> = { "G-001": cover };
