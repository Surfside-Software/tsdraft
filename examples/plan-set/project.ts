// The project: a made-up two-story residence on a made-up canal lot in a made-up Florida town.
// Every name, address and number here is fictional.
export const PROJECT = {
  name: "CALLOWAY RESIDENCE",
  kind: "NEW TWO-STORY SINGLE-FAMILY RESIDENCE",
  address: "218 SANDPIPER COVE DRIVE",
  city: "CORAL HERON KEY, FLORIDA 34999",
  owner: "JUNIPER AND THEO CALLOWAY",
  parcel: "LOT 14, BLOCK C, HERON SOUND ESTATES",
  plat: "PLAT BOOK 00, PAGE 00 (DEMO)",
  parcelId: "00-00-00-00000-000-0140",
  county: "MANGROVE COUNTY (FICTIONAL)",
  job: "26-0418",
  date: "2026-11-13",
  drawn: "AGENT",
  checked: "--",
  issue: "ISSUED FOR PERMIT",
} as const;

export const FIRM = {
  name: "HALYARD & MOSS",
  sub: "ENGINEERING  -  DEMO",
  lines: ["100 EXAMPLE WAY, SUITE 0", "CORAL HERON KEY, FL 34999", "CA NO. 00000 (FICTIONAL)"],
} as const;

/** The design criteria, which the cover, the structural sheets and the notes all read. */
export const CRITERIA = {
  code: "2023 FLORIDA BUILDING CODE, RESIDENTIAL, 8TH EDITION",
  codes: [
    "2023 FLORIDA BUILDING CODE, RESIDENTIAL, 8TH EDITION (FBC-R)",
    "2023 FLORIDA BUILDING CODE, ENERGY CONSERVATION, 8TH EDITION",
    "FBC-R CHAPTERS 12-24 (MECHANICAL) AND 25-33 (PLUMBING) GOVERN THIS DWELLING",
    "NFPA 70, NATIONAL ELECTRICAL CODE, 2020 EDITION",
    "ASCE 7-22, MINIMUM DESIGN LOADS FOR BUILDINGS",
  ],
  wind: {
    vult: 165,
    vasd: 128,
    risk: "II",
    exposure: "D",
    enclosure: "ENCLOSED",
    gcpi: "+/-0.18",
    debris: "YES - ALL OPENINGS IMPACT RATED",
  },
  flood: {
    zone: "AE",
    panel: "12000C0000J (DEMO)",
    bfe: 9.0,
    dfe: 10.0,
    ffe: 11.0,
    garage: 8.5,
    grade: 7.5,
    /** Finished grade at the foundation, after fill. Slopes to 7.40 at the swales. */
    finishGrade: 8.0,
    datum: "NAVD 88",
  },
  soil: 2000,
  concrete: 3000,
  rebar: 60,
  cmu: 2000,
  live: { floor: 40, sleeping: 30, roof: 20 },
  dead: { roof: 15, floor: 12 },
  occupancy: "R-3 (FBC-R SINGLE-FAMILY DWELLING)",
  construction: "TYPE V-B",
  zoning: {
    district: "RSF-6 RESIDENTIAL SINGLE-FAMILY (DEMO)",
    front: 25,
    side: 7.5,
    rear: 20,
    poolSide: 7.5,
    poolRear: 10,
    maxHeight: 35,
    maxCoverage: 40,
  },
} as const;

export interface SheetInfo {
  readonly number: string;
  readonly title: string;
  readonly title2?: string;
  readonly mep?: boolean;
}

/** The set's sheets, in order. The index on the cover and every title block read this. */
export const SHEETS: readonly SheetInfo[] = [
  { number: "G-001", title: "COVER SHEET,", title2: "INDEX AND CODE DATA" },
  { number: "C-101", title: "SITE PLAN" },
  { number: "A-101", title: "FIRST FLOOR PLAN" },
  { number: "A-102", title: "SECOND FLOOR PLAN" },
  { number: "A-103", title: "ROOF PLAN" },
  { number: "A-201", title: "EXTERIOR ELEVATIONS,", title2: "SOUTH AND NORTH" },
  { number: "A-202", title: "EXTERIOR ELEVATIONS,", title2: "EAST AND WEST" },
  { number: "A-301", title: "BUILDING SECTION", title2: "AND WALL SECTION" },
  { number: "A-601", title: "DOOR AND WINDOW", title2: "SCHEDULES" },
  { number: "S-101", title: "FOUNDATION PLAN" },
  { number: "S-102", title: "FLOOR AND ROOF", title2: "FRAMING PLANS" },
  { number: "S-501", title: "STRUCTURAL DETAILS", title2: "AND NOTES" },
  { number: "M-101", title: "MECHANICAL PLANS", title2: "AND SCHEDULES", mep: true },
  { number: "E-101", title: "POWER AND", title2: "LIGHTING PLANS", mep: true },
  { number: "P-101", title: "PLUMBING RISER", title2: "DIAGRAMS", mep: true },
];

export const sheetInfo = (number: string): SheetInfo => {
  const s = SHEETS.find((x) => x.number === number);
  if (!s) throw new Error(`No sheet ${number}`);
  return s;
};
