// Symbols the elevation and section sheets need that the kit does not have. The kit's LEVEL
// writes its text to the right of the target; a level on the left of a view needs it on the
// left. Defined once per drawing, the first time a sheet of this module draws.
import { H, LAYERS, NOTES, type D, type View } from "../lib/kit.ts";
import type { Local } from "./elevations-lib.ts";

const defined = new WeakSet<D>();

export function elevSymbols(d: D): void {
  if (defined.has(d)) return;
  defined.add(d);
  d.block("LEVEL-L", {}, () => {
    const r = 0.08;
    d.circle([0, 0], r);
    d.line([-r, 0], [r, 0]);
    d.line([0, -r], [0, r]);
    d.attribute("NAME", [-r - 0.06, 0.03], {
      value: "LEVEL",
      height: H.note,
      style: NOTES,
      align: "right",
    });
    d.attribute("EL", [-r - 0.06, -0.03], {
      value: "EL. 0.00'",
      height: H.note,
      style: NOTES,
      align: "right",
      valign: "top",
    });
  });
}

/** A level marker on the left of a view: its line from `from` (local h) to the target at `h`. */
export function levelLeft(
  L: Local,
  v: View,
  h: number,
  z: number,
  from: number,
  name: string,
  elev: string,
): void {
  const r = v.p(0.08);
  L.d.layer(LAYERS.symb, {}, () => {
    L.d.line(L.P(from, z), L.P(h + r, z));
    L.d.insert("LEVEL-L", L.P(h, z), { scale: v.p(1), attributes: { NAME: name, EL: elev } });
  });
}
