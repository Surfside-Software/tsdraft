// A drawing file whose builder call fails at run time, on line 7.
import { createDrawing } from "tsdraft";

const d = createDrawing();
const radius: number = -1;

d.circle([0, 0], radius);

export default d.build();
