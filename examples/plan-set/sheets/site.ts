// C-101: the site plan at 1" = 10'-0", in model space at the origin, inches, from the lot's
// front left property corner. The lot, setbacks, the house, the pool, the drive, utilities,
// grades and drainage, with site data and notes on the sheet. `INTENT` holds the setbacks the
// house and the pool keep, which every build checks.
import type { Intent, Point } from "../../../src/index.ts";
import { CRITERIA, PROJECT } from "../project.ts";
import { DEPTH, ENTRY, FOOTPRINT, LANAI, LANAI_SLAB, ROOF, W } from "../model/house.ts";
import { frame } from "../lib/frame.ts";
import {
  AREA,
  dimString,
  H,
  LAYERS,
  leaderNote,
  noteColumn,
  put,
  table,
  view,
  viewport,
  type D,
  type SheetDraw,
} from "../lib/kit.ts";
import { arrowhead } from "../../lib/drafting.ts";

export const LOT = { width: 80 * 12, depth: 125 * 12 };
/** The house's southwest corner on the lot. */
export const HOUSE_AT: Point = [14 * 12, 30 * 12];
const STREET = { name: "SANDPIPER COVE DRIVE", row: 50 * 12, pavement: 22 * 12 };
const CANAL = { name: "HERON SOUND CANAL (TIDAL)", width: 80 * 12 };
const POOL = { x: 38 * 12, y: 92 * 12, w: 28 * 12, h: 14 * 12 };
const DECK = 4 * 12;
const DRIVE = { x0: HOUSE_AT[0] + 12, x1: HOUSE_AT[0] + 228, flare: 5 * 12 };

const at = (p: Point): Point => [HOUSE_AT[0] + p[0], HOUSE_AT[1] + p[1]];
const shoelace = (pts: readonly Point[]) =>
  Math.abs(
    pts.reduce(
      (s, p, i) => s + p[0] * pts[(i + 1) % pts.length]![1] - pts[(i + 1) % pts.length]![0] * p[1],
      0,
    ),
  ) / 2;

export const footprintSite: Point[] = FOOTPRINT.map(at);
const poolDeck: Point[] = [
  [POOL.x - DECK, HOUSE_AT[1] + LANAI[3]],
  [POOL.x + POOL.w + DECK, HOUSE_AT[1] + LANAI[3]],
  [POOL.x + POOL.w + DECK, POOL.y + POOL.h + DECK],
  [POOL.x - DECK, POOL.y + POOL.h + DECK],
];

/** The setbacks: the residence and the pool, by the ids the plan gives them. */
export const INTENT: Intent = {
  setbacks: [
    {
      property: "lot",
      footprints: ["residence"],
      distance: [
        CRITERIA.zoning.front * 12,
        CRITERIA.zoning.side * 12,
        CRITERIA.zoning.rear * 12,
        CRITERIA.zoning.side * 12,
      ],
    },
    {
      property: "lot",
      footprints: ["pool"],
      distance: [
        CRITERIA.zoning.front * 12,
        CRITERIA.zoning.poolSide * 12,
        CRITERIA.zoning.poolRear * 12,
        CRITERIA.zoning.poolSide * 12,
      ],
    },
  ],
};

function site(d: D): void {
  const v = view(d, 120);
  const t = v.p(H.note);
  const left = -30 * 12;
  const right = LOT.width + 30 * 12;
  const cl = -STREET.row / 2;
  const edgeN = cl + STREET.pavement / 2;
  const edgeS = cl - STREET.pavement / 2;

  d.layer(LAYERS.prop, {}, () => d.rect([0, 0], LOT.width, LOT.depth, { id: "lot" }));
  d.layer(LAYERS.setb, {}, () => {
    const z = CRITERIA.zoning;
    d.rect(
      [z.side * 12, z.front * 12],
      LOT.width - z.side * 24,
      LOT.depth - (z.front + z.rear) * 12,
    );
  });
  d.layer(LAYERS.bldg, {}, () => d.polyline(footprintSite, true, { id: "residence" }));
  // The roof's overhang, dashed, and the pool.
  d.layer(LAYERS.ovhd, {}, () => d.rect(at([-24, -24]), W + 48, DEPTH + 48));
  d.layer(LAYERS.pave, {}, () => {
    d.rect([POOL.x, POOL.y], POOL.w, POOL.h, { id: "pool" });
    d.rect([POOL.x + 6, POOL.y + 6], POOL.w - 12, POOL.h - 12);
    d.polyline(poolDeck, true);
    // The drive from the garage to the street, flared, and the walk to the porch.
    const flareY = edgeN + DRIVE.flare;
    d.line([DRIVE.x0, HOUSE_AT[1]], [DRIVE.x0, flareY]);
    d.line([DRIVE.x1, HOUSE_AT[1]], [DRIVE.x1, flareY]);
    d.arc([DRIVE.x0 - DRIVE.flare, flareY], DRIVE.flare, 270, 360);
    d.arc([DRIVE.x1 + DRIVE.flare, flareY], DRIVE.flare, 180, 270);
    // The entry stair down from the porch, then the walk to the drive.
    const e = ENTRY;
    const foot = -(e.risers - 1) * e.tread;
    for (let k = 0; k < e.risers; k++) d.line(at([e.x0, -k * e.tread]), at([e.x1, -k * e.tread]));
    for (const x of [e.x0, e.x1]) d.line(at([x, 0]), at([x, foot]));
    d.polyline([at([e.x0, foot]), at([e.x0, foot - 24]), [DRIVE.x1, at([0, foot - 24])[1]]]);
    d.polyline([at([e.x1, foot]), at([e.x1, foot - 72]), [DRIVE.x1, at([0, foot - 72])[1]]]);
    // Equipment pads on the east side.
    d.rect([HOUSE_AT[0] + W + 18, HOUSE_AT[1] + 240], 36, 80);
    d.rect([HOUSE_AT[0] + W + 18, HOUSE_AT[1] + 340], 30, 48);
    // The street's edges of pavement, broken at the drive.
    d.line([left, edgeN], [DRIVE.x0 - DRIVE.flare, edgeN]);
    d.line([DRIVE.x1 + DRIVE.flare, edgeN], [right, edgeN]);
    d.line([left, edgeS], [right, edgeS]);
  });
  d.layer(LAYERS.road, {}, () => d.line([left, cl], [right, cl]));
  d.layer(LAYERS.prop, {}, () => {
    // The adjoining lot lines and the far right-of-way line.
    d.line([left, -STREET.row], [right, -STREET.row]);
  });
  d.layer(LAYERS.setb, {}, () => {
    for (const x of [0, LOT.width]) d.line([x, 0], [x, -6]);
  });
  d.layer(LAYERS.wall2, {}, () => {
    // The seawall, its cap 1'-4" wide, along the rear property line.
    d.rect([left, LOT.depth], right - left, 16);
  });
  d.layer(LAYERS.water, {}, () => {
    for (let k = 1; k <= 6; k++)
      d.line([left, LOT.depth + 16 + k * 60], [right, LOT.depth + 16 + k * 60]);
  });
  d.layer(LAYERS.util, {}, () => {
    // Water service from the meter, sewer lateral to its cleanout, underground electric.
    const meter: Point = [LOT.width - 60, -18];
    d.polyline([meter, [meter[0], HOUSE_AT[1] + 200], [HOUSE_AT[0] + W, HOUSE_AT[1] + 200]]);
    d.polyline([
      [120, cl],
      [120, -12],
      [120, HOUSE_AT[1] + 340],
      [HOUSE_AT[0], HOUSE_AT[1] + 340],
    ]);
    d.polyline([
      [60, cl - 60],
      [60, HOUSE_AT[1] + 240],
      [HOUSE_AT[0], HOUSE_AT[1] + 240],
    ]);
  });
  d.layer(LAYERS.util, {}, () => {
    d.rect([LOT.width - 72, -30], 24, 24);
    d.circle([120, -12], 6);
  });
  d.layer(LAYERS.topo, {}, () => {
    // Side swales.
    for (const x of [3.5 * 12, LOT.width - 3.5 * 12]) d.line([x, 6 * 12], [x, LOT.depth - 2 * 12]);
  });
  d.layer(LAYERS.tree, {}, () => {
    for (const p of [
      [60, 120],
      [900, 160],
      [60, 1380],
      [900, 1420],
      [500, 60],
    ] as Point[])
      d.insert("PALM", p, { scale: 84 });
  });

  // Annotation of the plan.
  d.layer(LAYERS.civAnno, {}, () => {
    const course = (b: string, feet: number) => `${b}  ${feet.toFixed(2)}'`;
    put(d, [LOT.width / 2, LOT.depth - v.p(0.15)], course(`S 89°59'48" E`, 80), t, {
      align: "center",
      valign: "top",
    });
    put(d, [LOT.width / 2, v.p(0.12)], course(`N 89°59'48" W`, 80), t, { align: "center" });
    put(d, [-v.p(0.12), LOT.depth * 0.62], course(`N 00°00'12" E`, 125), t, {
      align: "center",
      rotation: 90,
    });
    put(d, [LOT.width + v.p(0.22), LOT.depth * 0.62], course(`S 00°00'12" W`, 125), t, {
      align: "center",
      rotation: 90,
    });
    put(d, [LOT.width / 2, cl + v.p(0.1)], STREET.name, v.p(H.label), { align: "center" });
    put(
      d,
      [LOT.width / 2, cl - v.p(0.22)],
      `${STREET.row / 12}' PUBLIC RIGHT-OF-WAY, ${STREET.pavement / 12}' ASPHALT`,
      t,
      { align: "center" },
    );
    put(d, [LOT.width / 2, LOT.depth + 16 + 150], CANAL.name, v.p(H.label), { align: "center" });
    put(d, [LOT.width / 2, LOT.depth + 16 + 120], "MEAN HIGH WATER EL. 1.20' NAVD (DEMO)", t, {
      align: "center",
      valign: "top",
    });
    put(d, [-v.p(1.1), LOT.depth / 2], "LOT 13", v.p(H.label), { align: "center", rotation: 90 });
    put(d, [LOT.width + v.p(1.1), LOT.depth / 2], "LOT 15", v.p(H.label), {
      align: "center",
      rotation: 90,
    });
    put(d, [LOT.width / 2, LOT.depth + 26], "EXIST. CONC. SEAWALL, CAP EL. 7.90' NAVD", t, {
      align: "center",
    });
    // The house and the rest.
    const c = at([500, 300]);
    put(d, c, "PROPOSED 2-STORY", v.p(H.label), { align: "center" });
    put(d, [c[0], c[1] - v.p(0.2)], "RESIDENCE", v.p(H.label), { align: "center" });
    put(d, [c[0], c[1] - v.p(0.4)], `F.F.E. ${CRITERIA.flood.ffe.toFixed(2)}' NAVD`, t, {
      align: "center",
    });
    put(d, at([136, 140]), "GARAGE", t, { align: "center" });
    put(d, at([136, 110]), `SLAB ${CRITERIA.flood.garage.toFixed(2)}'`, t, { align: "center" });
    put(d, at([500, 600]), "COV. LANAI", t, { align: "center" });
    put(d, [POOL.x + POOL.w / 2, POOL.y + POOL.h / 2], "POOL (SEPARATE PERMIT)", t, {
      align: "center",
      valign: "middle",
    });
    put(d, [(DRIVE.x0 + DRIVE.x1) / 2, 150], "CONC. DRIVEWAY", t, {
      align: "center",
      rotation: 90,
    });
    put(
      d,
      [CRITERIA.zoning.side * 6, LOT.depth * 0.3],
      `${CRITERIA.zoning.side}' SIDE SETBACK`,
      t,
      { rotation: 90, align: "center", valign: "middle" },
    );
    put(
      d,
      [LOT.width - CRITERIA.zoning.side * 6, LOT.depth * 0.3],
      `${CRITERIA.zoning.side}' SIDE SETBACK`,
      t,
      { rotation: 90, align: "center", valign: "middle" },
    );
    put(
      d,
      [CRITERIA.zoning.side * 12 + v.p(0.1), CRITERIA.zoning.front * 12 + v.p(0.06)],
      `${CRITERIA.zoning.front}' FRONT SETBACK`,
      t,
    );
    put(
      d,
      [CRITERIA.zoning.side * 12 + v.p(0.1), LOT.depth - CRITERIA.zoning.rear * 12 + v.p(0.06)],
      `${CRITERIA.zoning.rear}' REAR SETBACK`,
      t,
    );
    leaderNote(d, v, [LOT.width - 60, -18], [LOT.width + 160, -150], ['WATER METER, 1" SERVICE']);
    leaderNote(
      d,
      v,
      [120, -12],
      [-150, -110],
      ['SANITARY CLEANOUT, 4" BUILDING SEWER', "@ 1/8\" PER FT. MIN., INV. 5.31' AT C.O."],
    );
    leaderNote(
      d,
      v,
      [HOUSE_AT[0] + W + 36, HOUSE_AT[1] + 288],
      [LOT.width + 160, HOUSE_AT[1] + 380],
      ["HP-1 AND HP-2 CONDENSERS ON", "PLATFORM, TOP AT 10.00' NAVD MIN."],
    );
    leaderNote(
      d,
      v,
      [HOUSE_AT[0] + W + 33, HOUSE_AT[1] + 364],
      [LOT.width + 160, HOUSE_AT[1] + 470],
      ["POOL EQUIPMENT PAD"],
    );
    leaderNote(d, v, [42, 500], [-160, 640], ["GRASSED SWALE,", '6" DEEP, TYP.']);
    leaderNote(
      d,
      v,
      [60, HOUSE_AT[1] + 240],
      [-160, HOUSE_AT[1] + 160],
      ["U.G. ELECTRIC", "SERVICE"],
    );
    // Flow arrows, from the house to the swales and the street.
    for (const [a, b] of [
      [
        [HOUSE_AT[0] - 10, 700],
        [60, 700],
      ],
      [
        [HOUSE_AT[0] + W + 10, 760],
        [LOT.width - 60, 760],
      ],
      [
        [300, 300],
        [300, 120],
      ],
      [
        [POOL.x - DECK - 20, LOT.depth - 90],
        [60, LOT.depth - 90],
      ],
      [
        [POOL.x + POOL.w + DECK + 20, LOT.depth - 90],
        [LOT.width - 60, LOT.depth - 90],
      ],
    ] as [Point, Point][]) {
      d.line(a, b);
      arrowhead(d, b, a, v.p(0.12));
    }
  });
  // Spot grades: existing in parentheses, proposed plain.
  d.layer(LAYERS.civAnno, {}, () => {
    const fg = CRITERIA.flood.finishGrade.toFixed(2);
    const spot = (p: Point, el: string) =>
      d.insert("SPOT", p, { scale: v.p(1), attributes: { EL: el } });
    spot([24, 24], "(7.20)");
    spot([LOT.width - 90, 24], "(7.15)");
    spot([24, LOT.depth - 30], "(7.70)");
    spot([LOT.width - 90, LOT.depth - 30], "(7.65)");
    spot(at([-30, 200]), fg);
    spot(at([W + 30, 200]), fg);
    spot(at([-30, 450]), fg);
    spot(at([W + 30, 480]), fg);
    spot([DRIVE.x0 + 30, edgeN + 30], "7.40");
    spot([POOL.x - 70, POOL.y + 40], LANAI_SLAB.deck.toFixed(2));
    spot([42, 640], "7.40");
    spot([LOT.width - 42, 700], "7.40");
  });
  // Dimensions in decimal feet, which a dimension writes natively.
  d.layer(LAYERS.civDims, {}, () => {
    const fp = footprintSite;
    const xs = fp.map((p) => p[0]);
    const ys = fp.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    // Front setback to the garage, rear to the lanai, sides at the middle of the house.
    dimString(
      d,
      v,
      [
        [minX + 60, 0],
        [minX + 60, minY],
      ],
      "y",
      minX + 60,
    );
    dimString(
      d,
      v,
      [
        [LANAI[0] + HOUSE_AT[0], maxY],
        [LANAI[0] + HOUSE_AT[0], LOT.depth],
      ],
      "y",
      POOL.x - DECK - 40,
    );
    dimString(
      d,
      v,
      [
        [0, HOUSE_AT[1] + 420],
        [minX, HOUSE_AT[1] + 420],
        [maxX, HOUSE_AT[1] + 420],
        [LOT.width, HOUSE_AT[1] + 420],
      ],
      "x",
      HOUSE_AT[1] + 420,
    );
    dimString(
      d,
      v,
      [
        [POOL.x + POOL.w, POOL.y + POOL.h],
        [LOT.width, POOL.y + POOL.h],
      ],
      "x",
      POOL.y + POOL.h + 30,
    );
    dimString(
      d,
      v,
      [
        [POOL.x + POOL.w - 40, POOL.y + POOL.h],
        [POOL.x + POOL.w - 40, LOT.depth],
      ],
      "y",
      POOL.x + POOL.w + 80,
    );
  });
}

function sheet(d: D): void {
  const v = view(d, 120);
  site(d);
  const lotArea = (LOT.width * LOT.depth) / 144;
  // One definition of height for the set: from the D.F.E. to the mean roof height.
  const heightAboveDfe =
    CRITERIA.flood.ffe + (ROOF.eaveHeight + ROOF.ridgeHeight) / 2 / 12 - CRITERIA.flood.dfe;
  // Coverage counts the entry porch under the second floor, which the setback outline leaves out.
  const porchArea = (112 * 72) / 144;
  const fpArea = shoelace(footprintSite) / 144 + porchArea;
  const roofArea = ((W + 48) * (DEPTH + 48)) / 144;
  const driveArea =
    ((DRIVE.x1 - DRIVE.x0) * (HOUSE_AT[1] + STREET.row / 2 - STREET.pavement / 2)) / 144;
  const walkArea = (48 * 180) / 144;
  const deckArea = shoelace(poolDeck) / 144 - (POOL.w * POOL.h) / 144;
  const pool = (POOL.w * POOL.h) / 144;
  const pads = (36 * 80 + 30 * 48) / 144;
  const imperv = fpArea + driveArea + walkArea + deckArea + pool + pads;
  const onLotDrive = ((DRIVE.x1 - DRIVE.x0) * HOUSE_AT[1]) / 144;
  const impervLot = fpArea + onLotDrive + walkArea + deckArea + pool + pads;
  const fpXs = footprintSite.map((p) => p[0]);
  const fpYs = footprintSite.map((p) => p[1]);
  const provided = {
    front: Math.min(...fpYs) / 12,
    rear: (LOT.depth - Math.max(...fpYs)) / 12,
    left: Math.min(...fpXs) / 12,
    right: (LOT.width - Math.max(...fpXs)) / 12,
  };
  void roofArea;
  void imperv;
  frame(d, "C-101", (dd, s) => {
    const vpW = 20.5;
    const vpH = 20.6;
    viewport(dd, s, {
      corner: [AREA.left, AREA.top - vpH],
      size: [vpW, vpH],
      center: [LOT.width / 2, LOT.depth / 2 - 90],
      v,
      id: "vp-site",
      number: "1",
      sheetNo: "C-101",
      title: "SITE PLAN",
      titleAt: [AREA.left + 0.2, AREA.top - vpH - 0.55],
    });
    dd.layer(LAYERS.text, {}, () =>
      dd.insert("NORTH ARROW", [AREA.left + 9.5, AREA.top - vpH - 0.6]),
    );
    const x = AREA.left + vpW + 0.4;
    const w = AREA.right - x;
    let y = AREA.top - 0.1;
    const sf = (n: number) => `${Math.round(n).toLocaleString("en-US")} SF`;
    y = table(
      dd,
      [x, y],
      "SITE DATA",
      [
        { name: "ITEM", width: 3.6 },
        { name: "VALUE", width: w - 3.6 },
      ],
      [
        ["PARCEL", PROJECT.parcel],
        ["PARCEL ID", PROJECT.parcelId],
        ["ZONING", CRITERIA.zoning.district],
        [
          "FLOOD ZONE",
          `${CRITERIA.flood.zone}, BFE ${CRITERIA.flood.bfe.toFixed(1)}' ${CRITERIA.flood.datum}`,
        ],
        ["FIRM PANEL", CRITERIA.flood.panel],
        ["DESIGN FLOOD ELEV.", `${CRITERIA.flood.dfe.toFixed(2)}' (BFE + 1')`],
        ["LOT AREA", `${sf(lotArea)} (${(lotArea / 43560).toFixed(3)} AC)`],
        [
          "BUILDING COVERAGE",
          `${sf(fpArea)} (${((fpArea / lotArea) * 100).toFixed(1)}%, ${CRITERIA.zoning.maxCoverage}% MAX.)`,
        ],
        ["COVERAGE INCLUDES", `HOUSE, GARAGE, ${Math.round(porchArea)} SF PORCH, LANAI`],
        ["IMPERVIOUS ON LOT", `${sf(impervLot)} (${((impervLot / lotArea) * 100).toFixed(1)}%)`],
        [
          "PERVIOUS ON LOT",
          `${sf(lotArea - impervLot)} (${(((lotArea - impervLot) / lotArea) * 100).toFixed(1)}%)`,
        ],
        [
          "BUILDING HEIGHT",
          `${heightAboveDfe.toFixed(2)}' D.F.E. TO MEAN ROOF (${CRITERIA.zoning.maxHeight}' MAX.)`,
        ],
      ],
    );
    y -= 0.25;
    const ft = (n: number) => `${n.toFixed(1)}'`;
    const z = CRITERIA.zoning;
    y = table(
      dd,
      [x, y],
      "SETBACKS",
      [
        { name: "SIDE", width: 1.6 },
        { name: "REQUIRED", width: 1.4, align: "center" },
        { name: "PROVIDED", width: 1.4, align: "center" },
        { name: "POOL REQ.", width: w - 4.4, align: "center" },
      ],
      [
        ["FRONT (S)", ft(z.front), ft(provided.front), "-"],
        ["REAR (N)", ft(z.rear), ft(provided.rear), ft(z.poolRear)],
        ["SIDE (W)", ft(z.side), ft(provided.left), ft(z.poolSide)],
        ["SIDE (E)", ft(z.side), ft(provided.right), ft(z.poolSide)],
      ],
    );
    y -= 0.25;
    y = noteColumn(dd, [x, y], w, "SITE NOTES", [
      "BOUNDARY, BEARINGS AND EXISTING GRADES FROM A SURVEY BY OTHERS (FICTIONAL), NAVD 88. VERIFY BEFORE CONSTRUCTION.",
      `THE LOWEST FLOOR IS AT ${CRITERIA.flood.ffe.toFixed(2)}' NAVD, ${(CRITERIA.flood.ffe - CRITERIA.flood.bfe).toFixed(1)}' ABOVE THE BFE. SUBMIT AN ELEVATION CERTIFICATE AT THE SLAB AND AT FINAL.`,
      "THE GARAGE SLAB IS BELOW THE DFE: USE FLOOD-RESISTANT MATERIALS BELOW 10.00' NAVD AND FLOOD VENTS PER S-101.",
      'FILL UNDER THE HOUSE IS CLEAN SAND, COMPACTED TO 95% MODIFIED PROCTOR IN 12" LIFTS.',
      `FINISHED GRADE ${CRITERIA.flood.finishGrade.toFixed(2)}' NAVD AT THE FOUNDATION, FALLING 6" MIN. IN 10' (FBC-R R401.3) TO THE SIDE SWALES AT 7.40' AND THE STREET. THE REAR YARD DRAINS TO THE SIDE SWALES, NOT OVER THE SEAWALL. NO RUNOFF ONTO ADJOINING LOTS.`,
      "INSTALL SILT FENCE ALONG THE SEAWALL AND THE SIDE LOT LINES BEFORE CLEARING. NO DISCHARGE TO THE CANAL.",
      "THE DRIVEWAY APRON IN THE RIGHT-OF-WAY NEEDS ITS OWN PERMIT FROM THE COUNTY.",
      "THE POOL, ITS DECK AND ITS BARRIER ARE UNDER A SEPARATE PERMIT. SHOWN FOR SETBACK AND COVERAGE ONLY.",
    ]);
    y -= 0.25;
    legend(dd, [x, y], w);
  });
}

function legend(d: D, at0: Point, w: number): void {
  let y = at0[1];
  d.layer(LAYERS.text, {}, () => {
    put(d, [at0[0], y], "LEGEND", H.label, { valign: "top" });
    y -= H.label + 0.06;
    d.line([at0[0], y], [at0[0] + w, y], { lineweight: 0.35 });
    y -= 0.22;
  });
  const row = (layer: string, label: string, draw?: (c: Point) => void) => {
    d.layer(layer, {}, () =>
      draw ? draw([at0[0] + 0.5, y + 0.04]) : d.line([at0[0], y + 0.04], [at0[0] + 1.0, y + 0.04]),
    );
    d.layer(LAYERS.text, {}, () =>
      put(d, [at0[0] + 1.3, y], label, H.note, { valign: "baseline" }),
    );
    y -= 0.27;
  };
  row(LAYERS.prop, "PROPERTY LINE");
  row(LAYERS.setb, "BUILDING SETBACK LINE");
  row(LAYERS.ovhd, "ROOF OVERHANG");
  row(LAYERS.util, "UNDERGROUND UTILITY");
  row(LAYERS.topo, "SWALE");
  row(LAYERS.civAnno, "PROPOSED / (EXISTING) GRADE", (c) =>
    d.insert("SPOT", c, { attributes: { EL: "8.00 / (7.20)" } }),
  );
}

export const SHEETS: Record<string, SheetDraw> = { "C-101": sheet };
