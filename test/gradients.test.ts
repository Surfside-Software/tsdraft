import assert from "node:assert/strict";
import { test } from "node:test";
import { createDrawing, readDXF, tintColor, toDXF, type Point } from "../src/index.ts";

const triangle: Point[] = [
  [0, 0],
  [1, 0],
  [1, 1],
];

test("a gradient is written as CAD programs hold it, black as 0,0,1, and read back", async () => {
  const d = createDrawing({ units: "in" });
  d.hatch(triangle, {
    gradient: {
      name: "inverted-spherical",
      angle: 30,
      centered: false,
      colors: [
        [0, 0, 0],
        [255, 255, 255],
      ],
    },
  });
  d.hatch(triangle, { gradient: { name: "cylinder", color: [255, 0, 0], tint: 0.25 } });
  const dxf = toDXF(d.build());
  const groups = (n: number) => {
    let at = -1;
    for (let k = 0; k <= n; k++) at = dxf.indexOf("\r\n450\r\n", at + 1);
    const end = dxf.indexOf("\r\n", dxf.indexOf("\r\n470\r\n", at) + 7);
    return dxf.slice(at + 2, end).split("\r\n");
  };
  // After the seed point: whether a gradient, its angle in radians, its shift, one color or two,
  // the tint, then each color's index and true color, then its name.
  assert.deepEqual(
    groups(0),
    ["450", "1", "451", "0", "460", "0.523598775598299", "461", "1", "452", "0", "462", "1"]
      .concat(["453", "2", "463", "0", "63", "178", "421", "1"])
      .concat(["463", "1", "63", "7", "421", "16777215", "470", "INVSPHERICAL"]),
  );
  // One color and its tint: the second color is the first with its lightness set to the tint.
  assert.deepEqual(
    groups(1).filter((_, k, all) => ["452", "462", "421"].includes(all[k - 1] ?? "")),
    ["1", "0.25", String(0xff0000), String(0x800000)],
  );
  const read = await readDXF(dxf, { geometry: true });
  assert.deepEqual(
    read.model.entities!.map((e) => (e.kind === "hatch" ? e.gradient : undefined)),
    [
      { name: "INVSPHERICAL", angle: 30, centered: false, colors: [1, 0xffffff] },
      { name: "CYLINDER", angle: 0, centered: true, colors: [0xff0000, 0x800000], tint: 0.25 },
    ],
  );
});

test("a tint's second color is the color with its lightness set to the tint, as CAD programs store it", () => {
  assert.deepEqual(tintColor([255, 0, 0], 0.25), [128, 0, 0]);
  assert.deepEqual(tintColor([30, 120, 200], 0.5), [33, 134, 222]);
});
