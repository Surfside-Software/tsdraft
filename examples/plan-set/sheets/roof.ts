// A-103: the roof plan at 1/4" = 1'-0": the hip roof from `ROOF`, the lanai's shed roof, slopes,
// gutters and downspouts, the walls below dashed, and the attic ventilation worked out from the
// attic's area.
import type { Point } from "../../../src/index.ts";
import { DEPTH, HEIGHTS, LANAI, ROOF, ROOF_VENTS, W } from "../model/house.ts";
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
  slopeArrow,
  table,
  view,
  viewport,
  type D,
  type SheetDraw,
} from "../lib/kit.ts";

export const ORIGIN: Point = [60000, 0];

function roof(d: D): void {
  const v = view(d, 48);
  const o = (p: Point): Point => [ORIGIN[0] + p[0], ORIGIN[1] + p[1]];
  const [x0, y0, x1, y1] = ROOF.eave;
  const [r0, r1] = ROOF.ridge;
  d.layer(LAYERS.roofOutl, {}, () => {
    d.polyline([o([x0, y0]), o([x1, y0]), o([x1, y1]), o([x0, y1])], true);
  });
  d.layer(LAYERS.roof, {}, () => {
    // Hips from each corner to the ridge's ends, and the ridge.
    d.line(o([x0, y0]), o(r0));
    d.line(o([x0, y1]), o(r0));
    d.line(o([x1, y0]), o(r1));
    d.line(o([x1, y1]), o(r1));
    d.line(o(r0), o(r1));
    // The lanai's shed roof against the north wall.
    const [lx0, , lx1, ly1] = ROOF.lanai.rect;
    d.polyline([o([lx0, y1]), o([lx0, ly1]), o([lx1, ly1]), o([lx1, y1])]);
    // Gutters along the eaves, 6" K-style, drawn as a second line inside the eave.
    d.polyline(
      [o([x0 + 6, y0 + 6]), o([x1 - 6, y0 + 6]), o([x1 - 6, y1 - 6]), o([x0 + 6, y1 - 6])],
      true,
    );
    d.line(o([lx0 + 6, ly1 - 6]), o([lx1 - 6, ly1 - 6]));
    // Downspouts, 3x4, at the corners and at the lanai.
    for (const p of [
      [x0 + 6, y0 + 6],
      [x1 - 6, y0 + 6],
      [x0 + 6, y1 - 6],
      [lx0 + 6, ly1 - 6],
      [lx1 - 6, ly1 - 6],
      [x1 - 6, y1 - 6],
    ] as Point[]) {
      d.rect(o([p[0] - 3, p[1] - 3]), 6, 6);
    }
  });
  d.layer(LAYERS.roof, {}, () => {
    // Off-ridge vents, 4' long, two on each plane within 3' of the ridge or a hip.
    // All on the north and south planes, clear of the hips, within 3' of the ridge measured
    // vertically (FBC-R R806.2 exception).
    for (const [cx, cy] of [
      [286, 244],
      [338, 244],
      [280, 214],
      [344, 214],
      [286, 284],
      [338, 284],
      [280, 314],
      [344, 314],
    ] as Point[]) {
      d.rect(o([cx - 24, cy - 4]), 48, 8);
    }
    revisionCloud(
      d,
      v.p,
      [o([240, 196])[0], o([240, 196])[1], o([384, 332])[0], o([384, 332])[1]],
      "1",
    );
  });
  d.layer(LAYERS.ovhd, {}, () => {
    // The outside face of the walls below.
    d.rect(o([0, 0]), W, DEPTH);
  });
  d.layer(LAYERS.anno, {}, () => {
    const t = v.p(H.note);
    slopeArrow(d, v, o([312, 60]), -90, "6:12");
    slopeArrow(d, v, o([312, 470]), 90, "6:12");
    slopeArrow(d, v, o([40, 264]), 180, "6:12");
    slopeArrow(d, v, o([584, 264]), 0, "6:12");
    slopeArrow(d, v, o([(LANAI[0] + LANAI[2]) / 2, 640]), 90, "3:12");
    put(d, o([312, 286]), "RIDGE", t, { align: "center" });
    put(d, o([312, 230]), `RIDGE EL. ${(11 + ROOF.ridgeHeight / 12).toFixed(2)}' NAVD`, t, {
      align: "center",
    });
    leaderNote(d, v, o([150, 150]), o([200, -110]), [
      "STANDING SEAM METAL ROOF, 24 GA.,",
      "ON SELF-ADHERED UNDERLAYMENT",
      'OVER 19/32" PLYWOOD SHEATHING',
    ]);
    leaderNote(d, v, o([x1 - 6, y0 + 20]), o([x1 + 40, -110]), [
      '6" ALUM. K-STYLE GUTTER,',
      "3X4 DOWNSPOUT, TYP.",
    ]);
    leaderNote(d, v, o([x0, 400]), o([60, 430]), [
      '24" OVERHANG WITH VENTED',
      "ALUM. SOFFIT, TYP.",
    ]);
    leaderNote(d, v, o([480, 600]), o([700, 680]), [
      "LANAI SHED ROOF, 3:12,",
      "METAL ROOFING TO MATCH,",
      "LEDGER FLASHED TO WALL",
    ]);
    leaderNote(d, v, o([340, 264]), o([470, 360]), [
      "CONTINUOUS RIDGE VENT,",
      "SEE VENTILATION TABLE",
    ]);
    leaderNote(d, v, o([262, 314]), o([200, 380]), [
      "OFF-RIDGE VENT, 54 SQ. IN.",
      "NET FREE AREA, TYP. OF 8",
    ]);
  });
  d.layer(LAYERS.dims, {}, () => {
    dimString(
      d,
      v,
      [o([x0, y0]), o([0, y0]), o([W, y0]), o([x1, y0])],
      "x",
      ORIGIN[1] + y0 - v.p(0.6),
    );
    dimString(
      d,
      v,
      [o([x0, y0]), o([x0, 0]), o([x0, DEPTH]), o([x0, y1])],
      "y",
      ORIGIN[0] + x0 - v.p(0.6),
    );
    dimString(d, v, [o([x0, y1]), o(r0), o(r1), o([x1, y1])], "x", ORIGIN[1] + y1 + v.p(0.9));
  });
}

function sheet(d: D): void {
  roof(d);
  const v = view(d, 48);
  const attic = (W * DEPTH) / 144;
  const required = attic / 300; // 1/300 with balanced ventilation
  const ridgeLength = ROOF.ridge[1][0] - ROOF.ridge[0][0];
  const ridgeVent = ((ridgeLength / 12) * ROOF_VENTS.ridgeRate) / 144;
  // A hip has a short ridge, so off-ridge vents within 3' of the ridge make up the upper half.
  const offRidge = ROOF_VENTS.offRidge; // sq in of net free area each
  const offRidgeVent = (offRidge.count * offRidge.each) / 144;
  const required150 = attic / 150;
  const upper = ridgeVent + offRidgeVent;
  const soffitLength = (2 * (W + DEPTH + 4 * HEIGHTS.overhang)) / 12;
  const soffitVent = (soffitLength * ROOF_VENTS.soffitRate) / 144;
  frame(d, "A-103", (dd, s) => {
    const vpW = 23.0;
    const vpH = 20.5;
    viewport(dd, s, {
      corner: [AREA.left, AREA.top - vpH],
      size: [vpW, vpH],
      center: [ORIGIN[0] + 312, ORIGIN[1] + 300],
      v,
      id: "vp-roof",
      number: "1",
      sheetNo: "A-103",
      title: "ROOF PLAN",
      titleAt: [AREA.left + 0.2, AREA.top - vpH - 0.5],
    });
    dd.layer(LAYERS.text, {}, () =>
      dd.insert("NORTH ARROW", [AREA.left + vpW - 1.0, AREA.top - vpH - 0.55]),
    );
    const x = AREA.left + vpW + 0.5;
    const w = AREA.right - x;
    let y = noteColumn(dd, [x, AREA.top - 0.1], w, "ROOF NOTES", [
      "ROOF COVERING, UNDERLAYMENT AND FASTENING SHALL HAVE FLORIDA PRODUCT APPROVAL FOR THE ROOF ZONE PRESSURES ON S-501, HVHZ NOT REQUIRED.",
      "UNDERLAYMENT: SELF-ADHERED POLYMER-MODIFIED BITUMEN OVER THE WHOLE DECK (FBC-R R905.1.1, HIGH-WIND).",
      'ROOF SHEATHING: 19/32" APA RATED PLYWOOD, 8D RING SHANK NAILS AT 4" O.C. EDGES AND 6" O.C. FIELD.',
      'TRUSSES AT 24" O.C. BY THE TRUSS ENGINEER; SEE S-102 FOR THE LAYOUT AND UPLIFT CONNECTORS.',
      "FLASH ALL VALLEYS, WALLS, PENETRATIONS AND THE LANAI LEDGER WITH 26 GA. GALVANIZED STEEL.",
      "DOWNSPOUTS DISCHARGE TO SPLASH BLOCKS DIRECTED TO THE SIDE SWALES. SEE C-101.",
    ]);
    y -= 0.3;
    y = table(
      dd,
      [x, y],
      "ATTIC VENTILATION (FBC-R R806.2)",
      [
        { name: "ITEM", width: 4.0 },
        { name: "SQ. FT.", width: w - 4.0, align: "right" },
      ],
      [
        ["ATTIC FLOOR AREA", attic.toFixed(0)],
        ["NET FREE AREA REQ. AT 1/150", required150.toFixed(2)],
        ["NET FREE AREA REQ. AT 1/300 (BALANCED)", required.toFixed(2)],
        [`RIDGE VENT, ${(ridgeLength / 12).toFixed(0)} LF AT 18 SQ. IN./FT.`, ridgeVent.toFixed(2)],
        [
          `${offRidge.count} OFF-RIDGE VENTS AT ${offRidge.each} SQ. IN. EACH`,
          offRidgeVent.toFixed(2),
        ],
        [
          `UPPER VENTS, ${Math.round((upper / (upper + soffitVent)) * 100)}% OF TOTAL`,
          upper.toFixed(2),
        ],
        [`SOFFIT VENT, ${soffitLength.toFixed(0)} LF AT 9 SQ. IN./FT.`, soffitVent.toFixed(2)],
        ["TOTAL PROVIDED", (upper + soffitVent).toFixed(2)],
      ],
    );
    noteColumn(
      dd,
      [x, y - 0.25],
      w,
      "VENTILATION NOTE",
      [
        `THE TOTAL PROVIDED, ${(upper + soffitVent).toFixed(2)} SQ. FT., MEETS 1/150 (${required150.toFixed(2)} SQ. FT.) WITHOUT THE 1/300 EXCEPTION. OFF-RIDGE VENTS SIT ON THE NORTH AND SOUTH PLANES, CLEAR OF THE HIPS, NO MORE THAN 3' BELOW THE RIDGE MEASURED VERTICALLY.`,
      ],
      { numbered: false },
    );
  });
}

export const SHEETS: Record<string, SheetDraw> = { "A-103": sheet };
