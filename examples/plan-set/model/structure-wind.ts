// Components-and-cladding wind pressures on the main hip roof, ASCE 7-22 chapter 30 part 1,
// worked the same way as the wall pressures in `wind.ts`, so S-501 quotes one set of numbers.
// Allowable stress design: 0.6 times the strength-level pressure.
import { HEIGHTS } from "./house.ts";
import { endZone, meanRoofHeight, qh } from "./wind.ts";

/** The roof slope in degrees. */
export const roofAngle = (): number => (Math.atan(HEIGHTS.pitch / 12) * 180) / Math.PI;

/**
 * GCp of the hip roof's zones at an effective area of 10 sq. ft. or less (roofing and sheathing),
 * figure 30.3-2F (hip, 20 to 27 degrees): -1.4, -2.0 and -2.0, the 7-16 figure 30.3-2G values
 * the 7-22 commentary keeps. The positive +0.6 is read off the graph by eye, so the engineer of
 * record checks it.
 */
const ROOF_GCP = { 1: -1.4, 2: -2.0, 3: -2.0, pos: 0.6 } as const;
/** The wall's positive GCp at 10 sq. ft., figure 30.3-1, which section 30.7 adds under an overhang. */
const WALL_POS = 1.0;

export interface RoofZonePressure {
  readonly zone: string;
  readonly where: string;
  readonly gcp: number;
  /** The positive GCp, where the surface takes a positive pressure. */
  readonly gcpPos: number | null;
  readonly neg: number;
  readonly pos: number | null;
}

/** ASD pressures by roof zone, psf. Overhangs add the wall's coefficient and drop GCpi (30.7). */
export function roofPressures(): RoofZonePressure[] {
  const q = 0.6 * qh();
  const gcpi = 0.18;
  const roof = (zone: 1 | 2 | 3, where: string): RoofZonePressure => ({
    zone: String(zone),
    where,
    gcp: ROOF_GCP[zone],
    gcpPos: ROOF_GCP.pos,
    neg: q * (ROOF_GCP[zone] - gcpi),
    pos: q * (ROOF_GCP.pos + gcpi),
  });
  const overhang = (zone: string, gcp: number, where: string): RoofZonePressure => ({
    zone,
    where,
    gcp: gcp - WALL_POS,
    gcpPos: null,
    neg: q * (gcp - WALL_POS),
    pos: null,
  });
  return [
    roof(1, "FIELD"),
    roof(2, "WITHIN a OF RIDGE AND HIPS"),
    roof(3, "WITHIN a OF EAVES"),
    // The 2'-0" overhang lies wholly within a of an eave, so it takes zone 3 (or 2 at a hip).
    overhang("O.H.", ROOF_GCP[3], `${HEIGHTS.overhang / 12}'-0" OVERHANGS (ROOF + WALL, 30.7)`),
    // Soffit panels take the adjacent wall's pressure, zone 5 at 10 sq. ft. (figure 30.7-1, note 3).
    {
      zone: "SOFFIT",
      where: "SOFFIT PANELS (= ADJ. WALL, ZONE 5)",
      gcp: -1.4,
      gcpPos: WALL_POS,
      neg: q * (-1.4 - gcpi),
      pos: q * (WALL_POS + gcpi),
    },
  ];
}

export { endZone, meanRoofHeight, qh };
