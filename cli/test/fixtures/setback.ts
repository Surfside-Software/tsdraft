// A drawing file whose footprint, drawn on line 8, is 15 from the front of its lot, inside the
// front setback of 25 that its export `intent` gives.
import { createDrawing, type Intent } from "tsdraft";

const d = createDrawing({ units: "ft" });

d.layer("C-PROP", { color: 7 }, () => d.rect([0, 0], 100, 140, { id: "lot" }));
d.layer("C-BLDG", { color: 5 }, () => d.rect([25, 15], 50, 40, { id: "house" }));

export default d.build();

export const intent: Intent = {
  setbacks: [{ property: "lot", footprints: ["house"], distance: [25, 7.5, 20, 7.5] }],
};
