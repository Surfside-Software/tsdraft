// Components-and-cladding wind pressures on the walls, ASCE 7-22 chapter 30, part 1 (h <= 60').
// Worked out from the criteria and the house, so the schedules, the notes and the garage door
// all quote one number. Allowable stress design: 0.6 times the strength-level pressure.
import { CRITERIA } from "../project.ts";
import { DEPTH, HEIGHTS, ROOF, W, type Opening } from "./house.ts";
import { alongXOf, widthOf } from "./geometry.ts";

/** Mean roof height above grade, feet. */
export const meanRoofHeight = (): number =>
  (CRITERIA.flood.ffe * 12 +
    (ROOF.eaveHeight + ROOF.ridgeHeight) / 2 -
    CRITERIA.flood.finishGrade * 12) /
  12;

/** Velocity pressure at the mean roof height, psf: 0.00256 Kz Kzt Kd Ke V^2, exposure D. */
export function qh(): number {
  const h = meanRoofHeight();
  // Exposure D, ASCE 7-22 table 26.10-1, interpolated between 25' and 40'.
  const kz =
    h <= 25 ? 1.12 : h <= 30 ? 1.12 + ((h - 25) / 5) * 0.04 : 1.16 + ((h - 30) / 10) * 0.06;
  return 0.00256 * kz * 1.0 * 0.85 * 1.0 * CRITERIA.wind.vult ** 2;
}

/** The end zone width a, feet: 10% of the least horizontal dimension or 0.4h, not under 3'. */
export const endZone = (): number =>
  Math.max(Math.min((0.1 * Math.min(W, DEPTH)) / 12, 0.4 * meanRoofHeight()), 3);

/** GCp of a wall zone for an effective area in square feet, figure 30.3-1. */
function gcp(zone: 4 | 5, area: number): { pos: number; neg: number } {
  const t = Math.min(Math.max(Math.log10(area / 10) / Math.log10(50), 0), 1);
  const pos = 1.0 - 0.3 * t;
  const neg = zone === 4 ? -1.1 + 0.3 * t : -1.4 + 0.6 * t;
  return { pos, neg };
}

/** The ASD design pressures of an exterior opening, psf, with its zone. */
export function designPressure(o: Opening): { zone: 4 | 5; pos: number; neg: number } {
  const a = endZone() * 12;
  const [x0, y0, x1, y1] = o.cut;
  const ax = alongXOf(o);
  const nearCorner = ax ? x0 < a || x1 > W - a : y0 < a || y1 > DEPTH - a;
  const zone: 4 | 5 = nearCorner ? 5 : 4;
  const area = Math.max((widthOf(o) * (o.height ?? 80)) / 144, 10);
  const g = gcp(zone, area);
  const q = qh();
  const gcpi = 0.18;
  return { zone, pos: 0.6 * q * (g.pos + gcpi), neg: 0.6 * q * (g.neg - gcpi) };
}

export const psf = (p: { pos: number; neg: number }) =>
  `+${p.pos.toFixed(1)} / ${p.neg.toFixed(1)}`;
export { HEIGHTS };
