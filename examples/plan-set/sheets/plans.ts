// A-101 and A-102: the floor plans at 1/4" = 1'-0", with their tags, dimensions, notes and
// legends. The plans are drawn in model space at an origin of their own.
import type { Point } from "../../../src/index.ts";
import { CRITERIA } from "../project.ts";
import {
  areas,
  ENTRY,
  FLOOD_VENT_RATING,
  FLOOD_VENTS,
  GARAGE_STEPS,
  L1,
  L2,
  HEIGHTS,
  LANAI_SLAB,
  POWDER,
  STAIR,
  type Level,
} from "../model/house.ts";
import { frame } from "../lib/frame.ts";
import {
  AREA,
  dimString,
  H,
  LAYERS,
  leaderNote,
  noteColumn,
  put,
  revisionCloud,
  sectionCut,
  view,
  viewport,
  wrap,
  type D,
  type SheetDraw,
} from "../lib/kit.ts";
import { ARCH_LAYERS, drawPlan, planDims, planTags } from "../lib/plan.ts";
import { CUT_X } from "./elevations-section.ts";

export const ORIGIN = { L1: [20000, 0] as Point, L2: [40000, 0] as Point };

/** The middle of the part of model space a plan sheet shows: the house with its dimensions. */
const center = (origin: Point): Point => [origin[0] + 312, origin[1] + 300];

const riser = (HEIGHTS.l2 / STAIR.risers).toFixed(2);
const PLAN_NOTES = [
  "DIMENSIONS ARE TO THE FACE OF MASONRY OR THE FACE OF STUD UNLESS NOTED. DO NOT SCALE THE DRAWINGS.",
  'EXTERIOR WALLS OF THE FIRST FLOOR ARE 8" CMU WITH A REINFORCED TIE BEAM. SEE S-101 AND S-501.',
  "ALL EXTERIOR GLAZED OPENINGS ARE IMPACT RATED FOR THE DESIGN PRESSURES ON A-601, WITH FLORIDA PRODUCT APPROVAL.",
  'GARAGE SEPARATION (FBC-R R302.6): 5/8" TYPE X GYPSUM BOARD ON THE GARAGE CEILING BELOW BEDROOM 2 AND THE HALL, 1/2" GYPSUM BOARD ON THE GARAGE WALLS AND ON STRUCTURE SUPPORTING THE CEILING. DOOR 103: SOLID CORE 1 3/8" MIN., SELF-CLOSING AND SELF-LATCHING.',
  `FLOOD VENTS: ${FLOOD_VENTS.length} ENGINEERED VENTS, EACH CERTIFIED (ICC-ES) TO COVER ${FLOOD_VENT_RATING} SQ. FT. OF ENCLOSED AREA: ${FLOOD_VENTS.length} X ${FLOOD_VENT_RATING} = ${FLOOD_VENTS.length * FLOOD_VENT_RATING} SQ. FT. >= ${areas().garage} SQ. FT. GROSS GARAGE AREA. BOTTOM WITHIN 12" OF GRADE, ON TWO WALLS (FBC-R R322.2.2). LOCATIONS PER S-101.`,
  "SMOKE AND CARBON MONOXIDE ALARMS PER E-101, INTERCONNECTED.",
  `MAIN STAIR: ${STAIR.risers} RISERS AT ${riser}" (7 3/4" MAX.), ${STAIR.treads} TREADS AT ${STAIR.tread}", 36" LANDINGS TOP AND BOTTOM, HANDRAIL 34"-38" ABOVE THE NOSINGS, GUARD 36" MIN. (FBC-R R311.7).`,
  `GARAGE STEPS AT DOOR 103: 36" LANDING, ${GARAGE_STEPS.risers} RISERS AT 7 1/2", TREADS ${GARAGE_STEPS.tread}", HANDRAIL ONE SIDE. ENTRY STAIR: ${ENTRY.risers} RISERS AT 6 3/8", TREADS ${ENTRY.tread}", HANDRAILS BOTH SIDES. LANAI STEPS: ${LANAI_SLAB.steps.risers} RISERS AT 6 13/16", TREADS ${LANAI_SLAB.steps.tread}", HANDRAILS BOTH SIDES.`,
  `GUARDS 36" HIGH AT THE PORCH AND LANAI EDGES, WHICH ARE 32" ABOVE FINISHED GRADE (${CRITERIA.flood.finishGrade.toFixed(2)}' NAVD), WITH NO OPENING A 4" SPHERE PASSES (FBC-R R312.1).`,
  "ROOM AREAS ON THE TAGS ARE NET, TO THE INSIDE FACE OF THE WALLS. G-001 TABULATES GROSS AREAS.",
];

const L2_NOTES = [
  'EXTERIOR WALLS OF THE SECOND FLOOR ARE 2X6 STUDS AT 16" O.C. WITH 7/16" OSB SHEATHING, NAILED PER S-501 NOTE 12.',
  'EMERGENCY ESCAPE OPENINGS IN EVERY BEDROOM: 5.7 SQ. FT. NET CLEAR, 24" HIGH, 20" WIDE, SILL 44" MAX. ABOVE THE FLOOR (FBC-R R310).',
  'WINDOWS WHOSE SILL IS LESS THAN 24" ABOVE THE FLOOR AND MORE THAN 72" ABOVE GRADE GET OPENING CONTROL DEVICES (FBC-R R312.2).',
  "BATH EXHAUST FANS 50 CFM MIN., DUCTED TO THE OUTSIDE.",
  'GUARDS AT THE STAIR OPENING 36" HIGH, WITH NO OPENING A 4" SPHERE PASSES.',
  'ATTIC ACCESS: 30" X 54" PULL-DOWN ATTIC STAIR IN THE HALL CEILING, LARGE ENOUGH TO REMOVE AHU-2, WITH A LIGHT AND RECEPTACLE (E-101). PASSAGEWAY TO THE UNIT 22" WIDE AND 30" HIGH MIN. WITH CONTINUOUS SOLID FLOORING 24" WIDE, 10\'-1" LONG, PER M-101 (FBC-R R807.1, M1305.1.3).',
  "ROOM AREAS ON THE TAGS ARE NET, TO THE INSIDE FACE OF THE WALLS.",
];

function planSheet(
  d: D,
  number: string,
  level: Level,
  which: "L1" | "L2",
  _notes: readonly string[],
): void {
  const origin = ORIGIN[which];
  const v = view(d, 48);
  drawPlan(d, origin, level, ARCH_LAYERS, which);
  planTags(d, origin, level, v);
  planDims(d, origin, level, v);
  // Notes in the plan.
  const o = (p: Point): Point => [origin[0] + p[0], origin[1] + p[1]];
  d.layer(LAYERS.anno, {}, () => {
    if (which === "L1") {
      leaderNote(d, v, o([120, 8]), o([150, -110]), [
        "16'-0\" X 8'-0\" IMPACT RATED",
        "OVERHEAD DOOR, SEE A-601",
      ]);
      leaderNote(d, v, o([600, 640]), o([690, 720]), [
        `RAISED LANAI SLAB EL. ${LANAI_SLAB.slab.toFixed(2)}' NAVD,`,
        'ON STEM WALLS PER S-101, 36" GUARD',
      ]);
      leaderNote(d, v, o([300, 40]), o([60, -140]), [
        `ENTRY PORCH SLAB EL. ${ENTRY.slab.toFixed(2)}' NAVD,`,
        '4" STEP DOWN FROM DOOR 101,',
        '36" GUARD AT OPEN EDGE',
      ]);
      leaderNote(d, v, o([345, -30]), o([450, -150]), [
        `${ENTRY.risers}R DN TO WALK AT ${CRITERIA.flood.finishGrade.toFixed(2)}',`,
        "HANDRAILS BOTH SIDES",
      ]);
      leaderNote(d, v, o([38, 240]), o([120, 230]), [
        `${GARAGE_STEPS.risers}R DN TO GARAGE SLAB,`,
        'HANDRAIL, 36" LANDING',
      ]);
      leaderNote(d, v, o([500, 690]), o([420, 740]), [
        `${LANAI_SLAB.steps.risers}R DN TO POOL DECK`,
        `AT ${LANAI_SLAB.deck.toFixed(2)}' NAVD`,
      ]);
      leaderNote(d, v, o([0, 100]), o([-110, 70]), ["FLOOD VENT, TYP. OF 4,", "SEE S-101"]);
      for (const fv of FLOOD_VENTS)
        d.insert("FLOOD VENT", o(fv.at), { scale: v.p(1), rotation: fv.wall === "W" ? 90 : 0 });
      // Powder room: the water closet's clearances, dimensioned.
      d.layer(LAYERS.dims, {}, () => {
        const vanityEdge = POWDER.vanity + POWDER.vanityWidth / 2;
        dimString(
          d,
          v,
          [o([40, vanityEdge]), o([40, POWDER.wc]), o([40, 520])],
          "y",
          origin[0] + 62,
        );
      });
      // Revision 1's changes, clouded: the stair, the garage steps, the entry stair and porch
      // guards, the powder room, the lanai guards and steps.
      const cloud = (r: [number, number, number, number]) =>
        revisionCloud(
          d,
          v.p,
          [o([r[0], r[1]])[0], o([r[0], r[1]])[1], o([r[2], r[3]])[0], o([r[2], r[3]])[1]],
          "1",
        );
      cloud([268, 84, 320, 292]);
      cloud([10, 214, 66, 290]);
      cloud([266, -58, 382, 6]);
      cloud([10, 416, 70, 518]);
      cloud([380, 664, 620, 712]);
      put(d, o([293, STAIR.y0 - 6]), "UP", v.p(H.note), { align: "center", valign: "top" });
      put(
        d,
        o([140, 56]),
        `GARAGE SLAB EL. ${CRITERIA.flood.garage.toFixed(2)}' NAVD`,
        v.p(H.note),
        { align: "center" },
      );
      put(d, o([500, 150]), `F.F.E. ${CRITERIA.flood.ffe.toFixed(2)}' NAVD`, v.p(H.note), {
        align: "center",
      });
    } else {
      put(d, o([293, STAIR.y1 + 8]), "DN", v.p(H.note), { align: "center" });
      leaderNote(d, v, o([270, 200]), o([170, 360]), ['36" GUARD', "AT OPENING"]);
      leaderNote(d, v, o([251, 70]), o([280, 92]), ["ATTIC ACCESS ABOVE"]);
      revisionCloud(
        d,
        v.p,
        [o([226, 14])[0], o([226, 14])[1], o([276, 88])[0], o([276, 88])[1]],
        "1",
      );
      put(d, o([350, 230]), "OPEN TO BELOW", v.p(H.note), { align: "center" });
      put(
        d,
        o([500, 330]),
        `F.F. ${(CRITERIA.flood.ffe + HEIGHTS.l2 / 12).toFixed(2)}' NAVD`,
        v.p(H.note),
        { align: "center" },
      );
    }
  });
  d.layer(LAYERS.symb, {}, () => {
    d.line(o([CUT_X, -60]), o([CUT_X, 0]), { linetype: "PHANTOM" });
    d.line(o([CUT_X, which === "L1" ? 672 : 528]), o([CUT_X, which === "L1" ? 740 : 600]), {
      linetype: "PHANTOM",
    });
    sectionCut(d, v, o([CUT_X, -80]), "W", "1", "A-301");
    sectionCut(d, v, o([CUT_X, which === "L1" ? 760 : 620]), "W", "1", "A-301");
    sectionCut(d, v, o([745, which === "L1" ? 410 : 400]), "W", "2", "A-301");
    d.line(o([624, which === "L1" ? 410 : 400]), o([724, which === "L1" ? 410 : 400]));
  });
  frame(d, number, (dd, sheet) => {
    const vpW = 23.0;
    const vpH = 20.5;
    viewport(dd, sheet, {
      corner: [AREA.left, AREA.top - vpH],
      size: [vpW, vpH],
      center: center(origin),
      v,
      id: `vp-${number}`,
      number: "1",
      sheetNo: number,
      title: level.name + " PLAN",
      titleAt: [AREA.left + 0.2, AREA.top - vpH - 0.5],
    });
    dd.layer(LAYERS.text, {}, () => {
      dd.insert("NORTH ARROW", [AREA.left + vpW - 1.0, AREA.top - vpH - 0.55]);
    });
    const x = AREA.left + vpW + 0.5;
    let y = AREA.top - 0.1;
    y = noteColumn(
      dd,
      [x, y],
      AREA.right - x,
      "PLAN NOTES",
      which === "L1" ? PLAN_NOTES : L2_NOTES,
    );
    y -= 0.3;
    y = legend(dd, [x, y], AREA.right - x, which);
    void wrap;
  });
}

/** The plan's legend, drawn with the plan's own symbols. */
function legend(d: D, at: Point, w: number, which: "L1" | "L2"): number {
  let y = at[1];
  d.layer(LAYERS.text, {}, () => {
    put(d, [at[0], y], "LEGEND", H.label, { valign: "top" });
    y -= H.label + 0.06;
    d.line([at[0], y], [at[0] + w, y], { lineweight: 0.35 });
    y -= 0.3;
  });
  const row = (label: string, draw: (c: Point) => void) => {
    draw([at[0] + 0.3, y + 0.03]);
    d.layer(LAYERS.text, {}, () => put(d, [at[0] + 0.7, y], label, H.note, { valign: "middle" }));
    y -= 0.38;
  };
  row("DOOR NUMBER, SEE A-601", (c) =>
    d.layer(LAYERS.tags, {}, () => d.insert("DOOR TAG", c, { attributes: { DOOR: "101" } })),
  );
  row("WINDOW TYPE, SEE A-601", (c) =>
    d.layer(LAYERS.tags, {}, () => d.insert("WINDOW TAG", c, { attributes: { WINDOW: "A" } })),
  );
  row("WINDOW MARK, SEE A-601", (c) =>
    d.layer(LAYERS.tags, {}, () =>
      put(d, c, "1-01", H.small, { align: "center", valign: "middle" }),
    ),
  );
  if (which === "L1")
    row('8" CMU WALL', (c) =>
      d.layer(LAYERS.wall, {}, () => d.rect([c[0] - 0.25, c[1] - 0.04], 0.5, 0.08)),
    );
  else
    row("2X6 STUD WALL", (c) =>
      d.layer(LAYERS.wall, {}, () => d.rect([c[0] - 0.25, c[1] - 0.03], 0.5, 0.06)),
    );
  row("2X4 STUD WALL", (c) =>
    d.layer(LAYERS.wall, {}, () => d.rect([c[0] - 0.25, c[1] - 0.02], 0.5, 0.04)),
  );
  row('36" GUARD OR HALF WALL', (c) =>
    d.layer(LAYERS.wallLow, {}, () => d.rect([c[0] - 0.25, c[1] - 0.02], 0.5, 0.04)),
  );
  row("OVERHEAD OR HIDDEN", (c) =>
    d.layer(LAYERS.ovhd, {}, () => d.line([c[0] - 0.25, c[1]], [c[0] + 0.25, c[1]])),
  );
  row("SECTION CUT: NO. / SHEET", (c) =>
    d.layer(LAYERS.symb, {}, () =>
      d.insert("SECTION BUBBLE", c, { attributes: { SECT: "1", SHEET: "A-301" } }),
    ),
  );
  if (which === "L1")
    row("FLOOD VENT", (c) => d.layer(LAYERS.anno, {}, () => d.insert("FLOOD VENT", c)));
  return y;
}

export const SHEETS: Record<string, SheetDraw> = {
  "A-101": (d) => planSheet(d, "A-101", L1, "L1", PLAN_NOTES),
  "A-102": (d) => planSheet(d, "A-102", L2, "L2", L2_NOTES),
};
