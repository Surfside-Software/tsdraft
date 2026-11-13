// Small facts about an opening, shared by the model and the sheets.
import type { Opening } from "./house.ts";

export const alongXOf = (o: Opening): boolean => o.cut[2] - o.cut[0] > o.cut[3] - o.cut[1];
export const widthOf = (o: Opening): number =>
  alongXOf(o) ? o.cut[2] - o.cut[0] : o.cut[3] - o.cut[1];
