// What a waiting build process runs before a build is asked of it, so that the build finds
// the code it needs compiled. Each step runs code of Node, or of the library of the command's
// own package, on values made here, and reads nothing: no file, and nothing of the drawing or
// of a build before. No step runs another copy of the library.
import * as nodeModule from "node:module";

type Library = Partial<typeof import("tsdraft")>;

/** A drawing file in small: the syntax Node has to strip from one. */
const SOURCE = `import { createDrawing, type Point, type TextAlign } from "tsdraft";
interface Lot { readonly width: number; readonly depth: number; corners?: Point[] }
type Side = "front" | "rear" | keyof Lot;
const lot = { width: 80, depth: 120 } as const satisfies Lot;
const area = (l: Lot): string => \`\${(l.width * l.depth).toLocaleString("en-US")} SF\`;
export function plan<T extends Lot>(given: T, ratio = 120, ...sides: Side[]): Point[] {
  const d = createDrawing({ units: "ft" });
  const put = (at: Point, value: string, options: { align?: TextAlign } = {}): void => {
    d.text(at, value, { height: ratio / 96, ...options });
  };
  d.layer("C-PROP", { color: 7 }, () => {
    d.rect([0, 0], given.width, given.depth);
    for (const [i, side] of sides.entries()) put([i, 0] as Point, String(side), { align: "center" });
  });
  put([0, 0], area(given));
  return (given.corners ?? []).map(([x, y]): Point => [x!, y as number]);
}
export default plan(lot);
`;

/** Stripping the types of a drawing file, which is slow the first time. */
export const stripSteps: readonly (() => void)[] = [
  () => {
    const strip = (nodeModule as { stripTypeScriptTypes?: (source: string) => string })
      .stripTypeScriptTypes;
    for (let i = 0; i < 8; i++) strip?.(SOURCE);
  },
];

/** Formatting a number or a date starts a part of Node that takes long the first time. */
export const formatSteps: readonly (() => void)[] = [
  () => (1234.5).toLocaleString("en-US"),
  () => (1234.5).toLocaleString(),
  () => new Date(0).toLocaleDateString("en-US"),
];

/**
 * The steps that run the library: a small sheet through the builder, `lint` and `toSVG`.
 */
export function librarySteps(library: Library): readonly (() => void)[] {
  let drawing: ReturnType<typeof sheet> | undefined;
  return [
    () => (drawing = sheet(library)),
    () => drawing && library.lint?.(drawing),
    () => drawing && library.toSVG?.(drawing, { margin: 0 }),
    () => {
      for (const layout of drawing?.layouts ?? [])
        library.toSVG?.(drawing!, { layout: layout.name });
    },
    // Once more, since much of the code is compiled better on its second run.
    () => {
      const again = sheet(library);
      library.lint?.(again);
      library.toSVG?.(again, { margin: 0 });
      for (const layout of again.layouts ?? []) library.toSVG?.(again, { layout: layout.name });
    },
  ];
}

function sheet(library: Library) {
  const d = library.createDrawing!({ units: "ft", linetypeScale: 1 / 2 });
  const ratio = 120;
  const paper = (inches: number) => library.fromPaper!(inches, "in", { ratio, units: "ft" });
  d.textStyle({ name: "NOTES", font: "Arial" });
  d.block("TREE", {}, () => {
    d.circle([0, 0], 1);
    d.line([-0.15, 0], [0.15, 0]);
  });
  d.block("TITLE", {}, () => {
    d.rect([0.5, 0.5], 35, 23, { lineweight: 0.7 });
    d.polyline([
      [29, 0.5],
      [29, 3.5],
      [35.5, 3.5],
    ]);
    d.text([29.1, 3.3], "PROJECT", { height: 0.08, style: "NOTES", valign: "top" });
    d.attribute("PROJECT", [29.1, 2.6], { value: "-", prompt: "Project", height: 0.2 });
    d.attribute("SHEET", [34, 0.7], { value: "-", prompt: "Sheet", height: 0.3, style: "NOTES" });
  });
  d.layer("C-PROP", { color: 7, linetype: library.PHANTOM!, lineweight: 0.35 }, () => {
    d.rect([0, 0], 80, 120);
  });
  d.layer("C-SETB", { color: 1, linetype: library.DASHED! }, () => d.rect([10, 25], 60, 85));
  d.layer("C-BLDG", { color: 4, lineweight: 0.5 }, () => {
    d.polyline(
      [
        [20, 40],
        [60, 40],
        [60, 80],
        [20, 80],
      ],
      true,
    );
  });
  d.layer("C-PAVE", { color: 8, linetype: library.CENTER! }, () => {
    d.line([30, 0], [30, 25]);
    d.arc([26, 4], 4, 270, 0);
    d.circle([40, 60], 3);
  });
  d.layer("L-PLNT", { color: 3 }, () => {
    d.insert("TREE", [12, 100], { scale: 6 });
    d.insert("TREE", [68, 100], { scale: 4, rotation: 30 });
  });
  d.layer("C-ANNO", { color: 7 }, () => {
    d.text([40, 122], `N 90°00'00" E  80.00'`, {
      height: paper(0.1),
      style: "NOTES",
      align: "center",
    });
    d.text([-2, 60], "120.00'", { height: paper(0.1), rotation: 90, valign: "middle" });
    d.text([40, 60], "RESIDENCE", { height: paper(0.14), align: "center", valign: "middle" });
  });
  d.layout("C-101", { paper: "ARCH D" }, (paperSheet) => {
    d.layer("G-ANNO-TTLB", { color: 7 }, () => {
      d.insert("TITLE", [0, 0], {
        id: "title-block",
        attributes: { PROJECT: "A HOUSE", SHEET: paperSheet.name },
      });
    });
    d.layer("G-ANNO-NPLT", { color: 7, plot: false }, () => {
      paperSheet.viewport([1, 2], 27, 21, { center: [40, 60], ratio, id: "plan" });
    });
    d.layer("G-ANNO-TEXT", { color: 7 }, () => {
      d.text([29.2, 22.5], "GENERAL NOTES", { height: 0.18, style: "NOTES" });
      d.line([29.2, 22.4], [35, 22.4]);
      d.insert("TREE", [30, 10], { scale: 3 / 16 });
    });
  });
  return d.build();
}
