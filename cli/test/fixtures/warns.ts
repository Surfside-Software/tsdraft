// A drawing file with a lint warning: the line drawn on line 6 has no length.
import { createDrawing } from "tsdraft";

const d = createDrawing();

d.line([1, 1], [1, 1], { id: "stub" });

export default d.build();
