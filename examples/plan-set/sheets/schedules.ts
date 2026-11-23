// A-601: the door and window schedules, read from the openings of `model/house.ts`, with each
// window's wind zone and design pressure worked out, the egress check of each bedroom window,
// and elevations of the window types drawn on the sheet.
import type { Point, TableOptions } from "../../../src/index.ts";
import {
  L1,
  L2,
  WINDOW_MARKS,
  WINDOW_TYPES,
  type Level,
  type Opening,
  type Room,
} from "../model/house.ts";
import { alongXOf, widthOf } from "../model/geometry.ts";
import { designPressure, endZone, meanRoofHeight, psf, qh } from "../model/wind.ts";
import { frame } from "../lib/frame.ts";
import {
  aligned,
  AREA,
  ftIn,
  H,
  LAYERS,
  noteColumn,
  put,
  SCHEDULE,
  tableBottom,
  type D,
  type SheetDraw,
} from "../lib/kit.ts";

/** The room an opening serves: the room beside the middle of its cut, inside the house. */
function roomOf(level: Level, o: Opening): Room | undefined {
  const [x0, y0, x1, y1] = o.cut;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;

  const probes: Point[] = alongXOf(o)
    ? [
        [cx, y1 + 12],
        [cx, y0 - 12],
      ]
    : [
        [x1 + 12, cy],
        [x0 - 12, cy],
      ];

  for (const [px, py] of probes) {
    const room = level.rooms.find(
      (r) => px > r.rect[0] && px < r.rect[2] && py > r.rect[1] && py < r.rect[3],
    );

    if (room) return room;
  }

  return undefined;
}

const DOOR_TYPES = new Map<string, { type: string; material: string; remarks: string }>([
  ["door", { type: "A", material: "SOLID CORE WOOD", remarks: "PASSAGE SET" }],
  ["double", { type: "B", material: "SOLID CORE WOOD", remarks: "PAIR, FLUSH BOLTS" }],
  [
    "slider",
    { type: "C", material: "ALUM. / IMPACT GLASS", remarks: "4-PANEL SLIDER, FL APPROVAL" },
  ],
  [
    "overhead",
    {
      type: "D",
      material: "INSULATED STEEL",
      remarks: "IMPACT RATED, OPENER, FL APPROVAL",
    },
  ],
  ["bifold", { type: "E", material: "HOLLOW CORE WOOD", remarks: "BI-FOLD" }],
]);

/** Net clear opening of a single hung window, from its frame: sash 2" all round, meeting rail 2". */
function egress(tag: string) {
  const t = WINDOW_TYPES.get(tag)!;
  // A twin unit opens one sash at a time, so its clear opening is one sash's.
  const w = (t.kind.includes("TWIN") ? t.width / 2 : t.width) - 4;
  const h = t.kind.includes("CASEMENT") ? t.height - 4 : t.height / 2 - 3;
  const area = (w * h) / 144;

  return { area, w, h, ok: area >= 5.7 && h >= 24 && w >= 20 };
}

function sheet(d: D): void {
  frame(d, "A-601", (dd) => {
    const x0 = AREA.left + 0.2;
    // The door schedule.
    const doors: string[][] = [];

    for (const level of [L1, L2]) {
      for (const o of level.openings) {
        if (o.kind === "window" || o.kind === "cased" || !o.tag) continue;
        const t = DOOR_TYPES.get(o.kind)!;
        const room = roomOf(level, o);

        const fire =
          o.tag === "103"
            ? "20 MIN., SELF-CLOSING (R302.5.1)"
            : o.exterior
              ? t.remarks.replace("PASSAGE SET", "IMPACT RATED, DEADBOLT")
              : t.remarks;

        doors.push([
          o.tag,
          room?.name ?? "-",
          t.type,
          ftIn(widthOf(o)),
          ftIn(o.height ?? 80),
          o.kind === "overhead" ? "-" : '1 3/4"',
          o.exterior && o.kind === "door" ? "FIBERGLASS, IMPACT" : t.material,
          o.exterior ? psf(designPressure(o)) : "-",
          fire,
        ]);
      }
    }

    const draw = (t: TableOptions) => dd.layer(LAYERS.text, {}, () => dd.table(t));

    const doorAligns = {
      0: "center",
      2: "center",
      3: "center",
      4: "center",
      5: "center",
      7: "center",
    } as const;

    const doorSchedule: TableOptions = {
      style: SCHEDULE,
      at: [x0, AREA.top - 0.1],
      columns: [0.55, 2.0, 0.6, 0.8, 0.8, 0.7, 2.2, 1.3, 3.6],
      title: "DOOR SCHEDULE",
      header: aligned(
        ["NO.", "ROOM", "TYPE", "WIDTH", "HEIGHT", "THICK.", "MATERIAL", "DP (PSF)", "REMARKS"],
        doorAligns,
      ),
      rows: doors.map((row) => aligned(row, doorAligns)),
      rowHeights: doors.map(() => 0.24),
    };

    draw(doorSchedule);
    let y = tableBottom(doorSchedule);

    // The door types, drawn at 1/4" = 1'-0".
    y -= 0.3;
    dd.layer(LAYERS.text, {}, () => {
      put(dd, [x0, y], "DOOR TYPE ELEVATIONS", H.label, { valign: "top" });
      put(dd, [x0 + 12.5, y], `SCALE: 1/4" = 1'-0"`, H.note, { valign: "top", align: "right" });
    });
    const ds = 0.25 / 12;

    const types: [string, number, number, string][] = [
      ["A", 36, 80, "FLUSH, SINGLE"],
      ["B", 60, 96, "FLUSH, PAIR"],
      ["C", 144, 96, "4-PANEL SLIDER"],
      ["D", 192, 96, "OVERHEAD, 4 X 8 PANELS"],
      ["E", 60, 80, "BI-FOLD, 4 LEAVES"],
    ];

    let dx = x0 + 0.2;
    const dbase = y - 2.55;

    for (const [tag, w0, h0, kind] of types) {
      const w = w0 * ds;
      const h = h0 * ds;
      dd.layer(LAYERS.elev, {}, () => dd.rect([dx, dbase], w, h));
      dd.layer(LAYERS.elevFine, {}, () => {
        if (tag === "B") dd.line([dx + w / 2, dbase], [dx + w / 2, dbase + h]);

        if (tag === "C")
          for (let k = 1; k < 4; k++)
            dd.line([dx + (w * k) / 4, dbase], [dx + (w * k) / 4, dbase + h]);

        if (tag === "D")
          for (let k = 1; k < 4; k++)
            dd.line([dx, dbase + (h * k) / 4], [dx + w, dbase + (h * k) / 4]);

        if (tag === "E")
          for (let k = 1; k < 4; k++)
            dd.line([dx + (w * k) / 4, dbase], [dx + (w * k) / 4, dbase + h]);

        if (tag === "A" || tag === "B") dd.circle([dx + w - 0.06, dbase + h * 0.45], 0.02);
      });
      dd.layer(LAYERS.text, {}, () => {
        put(dd, [dx + w / 2, dbase - 0.15], `TYPE ${tag}`, H.note, {
          align: "center",
          valign: "top",
        });
        put(dd, [dx + w / 2, dbase - 0.33], kind, H.small, { align: "center", valign: "top" });
      });
      dx += Math.max(w, 1.2) + 0.5;
    }

    y = dbase - 0.6;

    // The window list: every window, with its room, zone and pressure.
    const windows: string[][] = [];
    const count: Record<string, number> = {};

    for (const level of [L1, L2]) {
      for (const o of level.openings) {
        if (o.kind !== "window" || !o.tag) continue;
        count[o.tag] = (count[o.tag] ?? 0) + 1;
        const room = roomOf(level, o);
        const p = designPressure(o);
        const bedroom = room?.name.includes("BEDROOM") ?? false;
        const e = egress(o.tag);
        windows.push([
          WINDOW_MARKS.get(o) ?? "-",
          o.tag,
          room?.name ?? "-",
          `ZONE ${p.zone}`,
          psf(p),
          bedroom ? (e.ok ? `YES, ${e.area.toFixed(1)} SF` : `NO, ${e.area.toFixed(1)} SF`) : "-",
        ]);
      }
    }

    y -= 0.35;
    const listTop = y;
    const listAligns = { 0: "center", 1: "center", 3: "center", 4: "center", 5: "center" } as const;
    draw({
      style: SCHEDULE,
      at: [x0, y],
      columns: [0.7, 0.6, 2.2, 1.1, 1.6, 1.6],
      title: "WINDOW LIST",
      header: aligned(
        ["MARK", "TYPE", "ROOM", "WIND ZONE", "DP (PSF, ASD)", "EGRESS (5.7 SF)"],
        listAligns,
      ),
      rows: windows.map((row) => aligned(row, listAligns)),
      rowHeights: windows.map(() => 0.22),
    });

    // The window types, with an elevation of each at 1/2" = 1'-0".
    const x2 = x0 + 8.4;
    const typeAligns = { 0: "center", 1: "center", 2: "center", 4: "center", 5: "center" } as const;

    const typeRows = [...WINDOW_TYPES].map(([tag, t]) => {
      const e = egress(tag);

      return aligned(
        [
          tag,
          String(count[tag] ?? 0),
          `${ftIn(t.width)} X ${ftIn(t.height)}`,
          t.kind,
          `7'-2"/8'-0"`,
          `${e.w}" X ${e.h}"`,
          t.note,
        ],
        typeAligns,
      );
    });

    const windowTypes: TableOptions = {
      style: SCHEDULE,
      at: [x2, listTop],
      columns: [0.6, 0.6, 1.4, 1.7, 0.8, 1.3, 3.2],
      title: "WINDOW TYPES",
      header: aligned(
        ["TYPE", "QTY.", "SIZE (W X H)", "OPERATION", "HEAD", "CLEAR OPENING", "GLAZING"],
        typeAligns,
      ),
      rows: typeRows,
      rowHeights: typeRows.map(() => 0.24),
    };

    draw(windowTypes);
    y = tableBottom(windowTypes);
    y -= 0.5;
    dd.layer(LAYERS.text, {}, () => {
      put(dd, [x2, y], "WINDOW TYPE ELEVATIONS", H.label, { valign: "top" });
      put(dd, [x2 + 8.3, y], `SCALE: 1/2" = 1'-0"`, H.note, { valign: "top", align: "right" });
    });
    let ex = x2 + 0.2;
    const base = y - 3.4;

    for (const [tag, t] of WINDOW_TYPES) {
      const s = 0.5 / 12; // paper inches per inch at 1/2" = 1'-0"
      const w = t.width * s;
      const h = t.height * s;
      dd.layer(LAYERS.elev, {}, () => dd.rect([ex, base], w, h));
      dd.layer(LAYERS.elevFine, {}, () => {
        dd.rect([ex + 0.06, base + 0.06], w - 0.12, h - 0.12);

        if (t.kind.includes("HUNG")) {
          const twin = t.kind.includes("TWIN");

          if (twin) dd.line([ex + w / 2, base], [ex + w / 2, base + h]);
          dd.line([ex, base + h / 2], [ex + w, base + h / 2]);
        } else if (t.kind === "CASEMENT") {
          dd.polyline([
            [ex + 0.06, base + 0.06],
            [ex + w - 0.06, base + h / 2],
            [ex + 0.06, base + h - 0.06],
          ]);
        } else {
          dd.polyline([
            [ex + 0.06, base + 0.06],
            [ex + w / 2, base + h - 0.06],
            [ex + w - 0.06, base + 0.06],
          ]);
        }
      });
      dd.layer(LAYERS.tags, {}, () =>
        dd.insert("WINDOW TAG", [ex + w / 2, base - 0.35], {
          scale: 1.3,
          attributes: { WINDOW: tag },
        }),
      );
      dd.layer(LAYERS.text, {}, () =>
        put(dd, [ex + w / 2, base - 0.65], `${ftIn(t.width)} X ${ftIn(t.height)}`, H.small, {
          align: "center",
          valign: "top",
        }),
      );
      ex += w + 0.45;
    }

    y = base - 1.1;
    const q = qh();
    noteColumn(dd, [x2, y], 8.3, "SCHEDULE NOTES", [
      `DESIGN PRESSURES ARE ALLOWABLE STRESS (0.6 X STRENGTH) PER ASCE 7-22 CH. 30, VULT ${165} MPH, EXPOSURE D, MEAN ROOF HEIGHT ${meanRoofHeight().toFixed(1)}', QH = ${q.toFixed(1)} PSF, GCPI +/-0.18. ZONE 5 IS WITHIN ${endZone().toFixed(1)}' OF A CORNER.`,
      "EVERY EXTERIOR WINDOW AND DOOR IS IMPACT RATED (LARGE MISSILE) WITH FLORIDA PRODUCT APPROVAL AT OR ABOVE THE PRESSURE LISTED. SUBMIT APPROVALS BEFORE INSTALLATION.",
      'EGRESS: NET CLEAR OPENING 5.7 SQ. FT. MIN., 24" HIGH AND 20" WIDE MIN., SILL 44" MAX. A.F.F. (FBC-R R310.2). SECOND-FLOOR SILLS 24" MIN. A.F.F. OR WITH OPENING CONTROL (R312.2).',
      'GLAZING IN DOORS, WITHIN 24" OF A DOOR, IN WET AREAS AND AT STAIRS IS SAFETY GLAZING (FBC-R R308.4).',
      "ENERGY: WINDOW U-FACTOR 0.40 MAX., SHGC 0.25 MAX. (CLIMATE ZONE 2), PER FORM R405.",
      'DOOR 103 BETWEEN THE GARAGE AND THE HOUSE: SOLID WOOD OR STEEL 1 3/8" MIN., OR 20-MINUTE RATED, SELF-CLOSING AND SELF-LATCHING (FBC-R R302.5.1).',
    ]);
  });
}

export const SHEETS = { "A-601": sheet } satisfies Record<string, SheetDraw>;
