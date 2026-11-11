// A drawing file to copy. Preview it with `tsdraft dev examples/lot.ts`, or render it once with
// `tsdraft render examples/lot.ts`. Units are feet. The property line is phantom and the setback
// dashed, at a linetype scale of 4, and the building is drawn with a heavier pen.
import { createDrawing, DASHED, PHANTOM } from "tsdraft";

const lot = { width: 100, depth: 140 };
const setbacks = { front: 25, side: 7.5, rear: 20 };
const house = { width: 48, depth: 60 };
const houseAt = { x: (lot.width - house.width) / 2, y: setbacks.front + 5 };
const street = -12;

const d = createDrawing({ units: "ft", linetypeScale: 4 });

d.layer("C-PROP", { color: 7, linetype: PHANTOM, lineweight: 0.35 }, () => {
  d.rect([0, 0], lot.width, lot.depth);
  d.text([2, -6], `LOT 12, ${lot.width}' x ${lot.depth}'`, { height: 2.5 });
});

d.layer("C-SETB", { color: 8, linetype: DASHED }, () => {
  const { front, side, rear } = setbacks;
  d.rect([side, front], lot.width - side * 2, lot.depth - front - rear);
});

d.layer("A-BLDG", { color: 4, lineweight: 0.7 }, () => {
  d.rect([houseAt.x, houseAt.y], house.width, house.depth);
  d.text([houseAt.x + 4, houseAt.y + house.depth / 2], "PROPOSED RESIDENCE", { height: 2.5 });
});

d.layer("C-PAVE", { color: 8 }, () => {
  const x = houseAt.x + house.width - 14;
  d.line([x, houseAt.y], [x, street]);
  d.line([x + 12, houseAt.y], [x + 12, street]);
});

d.layer("C-ROAD", { color: 2 }, () => {
  d.line([-10, street], [lot.width + 10, street]);
  d.text([lot.width / 2 - 8, street - 6], "OAK STREET", { height: 2.5 });
});

export default d.build();
