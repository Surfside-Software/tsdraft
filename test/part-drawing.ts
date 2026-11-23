// Drawings for the read by layout: one whose entities each lie in or out of what a layout shows,
// by their layer, and a file of details past `GEOMETRY_ITEMS` whose sheets each show one.
import { createDrawing, type Drawing } from "../src/index.ts";

/**
 * Each entity of model space on a layer `IN-*` meets a window of the layout `A` or `B`, or the
 * area `AREA`, and each on `OUT-*` meets none. `A` shows 45 to 55 by 46 to 54; `B` a view turned
 * 30 degrees about 150, 50; `C` nothing of model space; `AREA` is 290 to 300 each way.
 */
export function partDrawing(): Drawing {
  const d = createDrawing({ units: "in" });
  d.block("BOX", {}, () => d.rect([0, 0], 10, 4));
  d.block("NEST", {}, () => d.insert("BOX", [5, 0]));
  d.block("AWAY", {}, () => d.rect([0, 100], 5, 5));
  d.layer("IN-LINE", {}, () => {
    d.line([47, 48], [53, 52]);
    // From far outside, through the window.
    d.line([0, 50], [500, 50]);
  });
  d.layer("IN-CIRCLE", {}, () => {
    // Its center outside, its side inside.
    d.circle([60, 50], 6);
    d.arc([50, 40], 7, 0, 180);
  });
  // Both points outside the window, the bulge through it.
  d.layer("IN-BULGE", {}, () =>
    d.polyline(
      [
        [40, 41],
        [60, 41],
      ],
      false,
      { bulges: [-1] },
    ),
  );
  d.layer("IN-TEXT", {}, () =>
    d.text([38, 50], "A NOTE THAT RUNS INTO THE WINDOW", { height: 0.5 }),
  );
  d.layer("IN-INSERT", {}, () => {
    // Its point outside, its block inside.
    d.insert("BOX", [38, 47]);
    d.insert("NEST", [36, 48]);
    d.insert("BOX", [62, 47], { rotation: 180 });
  });
  d.layer("IN-TURNED", {}, () => d.line([150, 50], [152, 51]));
  d.layer("IN-AREA", {}, () => d.circle([295, 295], 1));
  d.layer("OUT-LINE", {}, () => d.line([100, 100], [110, 100]));
  d.layer("OUT-CIRCLE", {}, () => d.circle([100, 50], 2));
  d.layer("OUT-INSERT", {}, () => {
    d.insert("BOX", [120, 120]);
    // Its point inside the window and its block far from it.
    d.insert("AWAY", [50, 50]);
    d.insert("NEST", [-200, -200]);
  });
  d.layer("OUT-TEXT", {}, () => d.text([400, 400], "FAR", { height: 0.5 }));
  d.layout("A", { paper: "ARCH D" }, (page) => {
    page.viewport([1, 1], 10, 8, { center: [50, 50], ratio: 1 });
    d.line([0, 0], [1, 1]);
  });
  d.layout("B", { paper: "ARCH D" }, (page) => {
    page.viewport([1, 1], 4, 1, { center: [150, 50], ratio: 1, twist: 30 });
    d.circle([2, 2], 1);
  });
  d.layout("C", { paper: "ARCH D" }, () => d.line([5, 5], [6, 6]));

  return d.build();
}

/** The area of `partDrawing` that no layout shows, given with its corners the other way round. */
export const PART_AREA = [
  [300, 300],
  [290, 290],
] as const;

/**
 * A detail file: `rows` by `columns` details 100 apart, each 120 lines, a circle, a polyline and a
 * note, past `GEOMETRY_ITEMS` at 30 by 40, and the sheets `D-1` to `D-4`, each one viewport on one
 * detail, `D-4`'s turned.
 */
export function detailsDrawing(rows: number, columns: number): Drawing {
  const d = createDrawing({ units: "in" });
  d.layer("DETAIL", {}, () => {
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < columns; c++) {
        const [x, y] = [c * 100, r * 100];

        for (let k = 0; k < 120; k++) d.line([x + 10 + k / 2, y + 10], [x + 10 + k / 2, y + 70]);
        d.circle([x + 50, y + 50], 20);
        d.polyline(
          [
            [x + 5, y + 5],
            [x + 75, y + 5],
            [x + 75, y + 75],
          ],
          false,
        );
        d.text([x + 10, y + 80], `DETAIL ${r * columns + c + 1}`, { height: 2 });
      }
  });

  const sheets: [name: string, row: number, column: number, twist: number][] = [
    ["D-1", 0, 0, 0],
    ["D-2", Math.floor(rows / 2), Math.floor(columns / 2), 0],
    ["D-3", rows - 1, columns - 1, 0],
    ["D-4", 1, 2, 15],
  ];

  for (const [name, row, column, twist] of sheets)
    d.layout(name, { paper: "ARCH D" }, (page) => {
      page.viewport([1, 1], 20, 20, {
        center: [column * 100 + 42, row * 100 + 45],
        ratio: 4,
        twist,
      });
      d.text([22, 2], name, { height: 0.25 });
    });

  return d.build();
}
