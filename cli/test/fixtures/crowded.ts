// A drawing file whose text plots badly: a note that runs past its border on line 8, a text
// over another, and on the sheet a tag that runs off the paper.
import { createDrawing } from "tsdraft";

const d = createDrawing({ units: "in" });

d.rect([0, 0], 10, 8, { id: "border" });
d.text([1, 6], "THIS NOTE IS TOO LONG FOR ITS SHEET", { height: 0.5, id: "note" });
d.text([1, 2], "TITLE", { height: 0.5 });
d.text([1.5, 2.2], "OVER", { height: 0.5, id: "over" });
d.block("TAG", {}, () => d.attribute("MARK", [0, 0], { value: "A1", height: 0.25 }));
d.layout("S-1", { paper: "ANSI A" }, (sheet) => {
  sheet.viewport([0.5, 0.5], 5, 4, { center: [5, 4], ratio: 2, id: "plan" });
  d.insert("TAG", [10.8, 8], { id: "tag" });
});

export default d.build();
