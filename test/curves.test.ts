import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDrawing,
  HIDDEN,
  readDXF,
  toDXF,
  toPDF,
  toSVG,
  type Drawing,
  type Entity,
  type Point,
} from "../src/index.ts";
import { clamped, ellipsePoint, splinePoint } from "../src/curves.ts";
import { extents } from "../src/extents.ts";
import { readProblems } from "./read-agreement.ts";

/** The groups of the `n`th record of `type` in a DXF, as `code=value`. */
function record(dxf: string, type: string, n = 0): string[] {
  const lines = dxf.split("\r\n");
  let at = -1;
  for (let k = 0; k <= n; k++) {
    at = lines.findIndex((line, i) => i > at && line === type && lines[i - 1]!.trim() === "0");
  }
  const out: string[] = [];
  for (let i = at + 1; i + 1 < lines.length && lines[i]!.trim() !== "0"; i += 2)
    out.push(`${lines[i]!.trim()}=${lines[i + 1]}`);
  return out;
}

/** The groups of a record from its subclass on, without its handle and owner. */
const own = (groups: readonly string[], subclass: string) =>
  groups.slice(groups.indexOf(`100=${subclass}`) + 1);

const drawing = (entities: Entity[]): Drawing => ({ ...createDrawing().build(), entities });

test("toDXF writes an ellipse and a spline as the leading CAD app saves them", () => {
  const dxf = toDXF(
    drawing([
      { kind: "ellipse", layer: "0", center: [1, 2], majorAxis: [3, 0], ratio: 0.5 },
      // An arc that runs through 0 ends a turn past its start.
      {
        kind: "ellipse",
        layer: "0",
        center: [0, 0],
        majorAxis: [0, 2],
        ratio: 0.5,
        startParameter: 300,
        endParameter: 60,
      },
      {
        kind: "spline",
        layer: "0",
        controlPoints: [
          [0, 0],
          [0, 1],
          [1, 1],
        ],
        degree: 2,
        knots: [0, 0, 0, 1, 1, 1],
        weights: [1, 0.5, 1],
      },
      // A periodic spline of unclamped knots is saved clamped over what it runs over.
      {
        kind: "spline",
        layer: "0",
        controlPoints: [
          [0.3, 0.3],
          [1.5, 0.3],
          [1.5, 1.1],
          [0.3, 1.1],
          [0.3, 0.3],
          [1.5, 0.3],
          [1.5, 1.1],
        ],
        degree: 3,
        knots: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        closed: true,
      },
      {
        kind: "spline",
        layer: "0",
        fitPoints: [
          [0, 0],
          [3, 4],
        ],
      },
      {
        kind: "spline",
        layer: "0",
        fitPoints: [
          [0, 0],
          [4, 0],
          [2, 3],
        ],
        closed: true,
      },
    ]),
  );
  assert.deepEqual(own(record(dxf, "ELLIPSE"), "AcDbEllipse"), [
    ...["10=1", "20=2", "30=0", "11=3", "21=0", "31=0", "210=0", "220=0", "230=1", "40=0.5"],
    ...["41=0", "42=6.28318530717959"],
  ]);
  assert.deepEqual(own(record(dxf, "ELLIPSE", 1), "AcDbEllipse").slice(-2), [
    "41=5.23598775598299",
    "42=7.33038285837618",
  ]);
  assert.deepEqual(own(record(dxf, "SPLINE"), "AcDbSpline"), [
    ...["210=0", "220=0", "230=1", "70=12", "71=2", "72=6", "73=3", "74=0"],
    ...["42=0.000000001", "43=0.0000000001"],
    ...["40=0", "40=0", "40=0", "40=1", "40=1", "40=1"],
    ...["10=0", "20=0", "30=0", "41=1", "10=0", "20=1", "30=0", "41=0.5"],
    ...["10=1", "20=1", "30=0", "41=1"],
  ]);
  const periodic = own(record(dxf, "SPLINE", 1), "AcDbSpline");
  assert.deepEqual(periodic.slice(3, 8), ["70=11", "71=3", "72=11", "73=7", "74=0"]);
  assert.deepEqual(
    periodic.filter((g) => g.startsWith("40=")).map((g) => Number(g.slice(3))),
    [3, 3, 3, 3, 4, 5, 6, 7, 7, 7, 7],
  );
  const points = periodic.filter((g) => /^[12]0=/.test(g));
  assert.deepEqual(points.slice(0, 2), points.slice(-2));
  // Through two points: a line, its four control points a third of the way apart.
  const two = own(record(dxf, "SPLINE", 2), "AcDbSpline");
  assert.deepEqual(two.slice(3, 15), [
    ...["70=1080", "71=3", "72=8", "73=4", "74=2"],
    ...["42=0.000000001", "43=0.0000000001", "44=0.0000000001"],
    ...["40=0", "40=0", "40=0", "40=0"],
  ]);
  assert.deepEqual(
    two.filter((g) => /^[12]0=/.test(g)),
    [
      "10=0",
      "20=0",
      "10=0.9999999999999998",
      "20=1.333333333333333",
      "10=2",
      "20=2.666666666666667",
      "10=3",
      "20=4",
    ],
  );
  // Closed: its first fit point again at the end, and one tangent at both ends.
  const ring = own(record(dxf, "SPLINE", 3), "AcDbSpline");
  assert.deepEqual(ring.slice(3, 8), ["70=1067", "71=3", "72=10", "73=6", "74=4"]);
  const tangent = (codes: readonly number[]) =>
    codes.map((code) => ring.find((g) => g.startsWith(`${code}=`))!.split("=")[1]);
  assert.deepEqual(tangent([12, 22, 32]), tangent([13, 23, 33]));
  assert.deepEqual(ring.filter((g) => /^[12]1=/.test(g)).slice(-2), ["11=0", "21=0"]);
});

test("clamped gives the same curve, starting and ending on its control points", () => {
  const points: Point[] = [
    [0, 0],
    [1, 3],
    [2, -1],
    [4, 2],
    [5, 0],
  ];
  const spline = {
    degree: 3,
    knots: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    controlPoints: points,
    weights: [1, 2, 1, 0.5, 1],
  };
  const held = clamped(spline);
  assert.deepEqual(held.knots, [3, 3, 3, 3, 4, 5, 5, 5, 5]);
  for (const u of [3, 3.4, 4, 4.9, 5]) {
    const [a, b] = [
      splinePoint(3, spline.knots, points, spline.weights, u),
      splinePoint(3, held.knots, held.controlPoints, held.weights, u),
    ];
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-12, `${u}`);
  }
  assert.deepEqual(clamped(held), held);
});

test("readDXF gives back each curve as it was drawn, and one seen from below as it draws", async () => {
  const d = createDrawing();
  d.ellipse([1, 2], [3, 1], 0.4, { startParameter: 30, endParameter: 90 });
  d.ellipse([1, 2], [3, 1], 0.4);
  d.spline([
    [0, 0],
    [3, 4],
    [6, 1],
  ]);
  d.spline(
    [
      [0, 0],
      [4, 0],
      [2, 3],
    ],
    { closed: true },
  );
  d.controlSpline(
    [
      [0, 0],
      [0, 1],
      [1, 1],
    ],
    { degree: 2, weights: [1, Math.SQRT1_2, 1] },
  );
  d.controlSpline(
    [
      [0, 0],
      [1, 2],
      [2, 0],
      [3, 2],
    ],
    { closed: true },
  );
  const built = d.build();
  const text = toDXF(built);
  const read = await readDXF(text, { geometry: true });
  assert.deepEqual(readProblems(built, read, "tsdraft"), []);
  const fit = read.model.entities![3]!;
  assert.ok(fit.kind === "spline" && fit.closed && fit.fitPoints?.length === 3);

  // The arc from 30 to 90 seen from below runs from -90 to -30.
  const below = text.replace(
    "230\r\n1\r\n40\r\n0.4\r\n41\r\n0.523598775598299\r\n42\r\n1.5707963267949",
    "230\r\n-1\r\n40\r\n0.4\r\n41\r\n4.71238898038469\r\n42\r\n5.759586531581287",
  );
  assert.ok(below !== text);
  const [arc] = (await readDXF(below, { geometry: true })).model.entities!;
  assert.ok(arc?.kind === "ellipse");
  assert.ok(Math.abs(arc.startParameter! - 30) < 1e-9 && Math.abs(arc.endParameter! - 90) < 1e-9);

  const broken = await readDXF(
    text.replace("40\r\n0.4\r\n", "40\r\n1.5\r\n").replace("72\r\n9\r\n", "72\r\n8\r\n"),
    { geometry: true },
  );
  assert.deepEqual(Object.keys(broken.unread.malformed).sort(), [
    "ELLIPSE with a ratio outside 0 to 1 or an axis of no length",
    "SPLINE whose counts disagree with its groups or its degree",
  ]);
});

test("toSVG draws an ellipse an insert places as the ellipse it maps it to", () => {
  const d = createDrawing();
  d.block("OVAL", {}, () => {
    d.ellipse([0, 0], [2, 0], 0.5);
    d.ellipse([0, 0], [2, 0], 0.5, { startParameter: 0, endParameter: 90 });
  });
  d.insert("OVAL", [10, 10], { scale: [-1, 3] });
  const svg = toSVG(d.build());
  // The axes [2, 0] and [0, 1] become [-2, 0] and [0, 3]: the longer is 3, upright.
  assert.match(svg, /<ellipse cx="10" cy="10" rx="3" ry="2" transform="rotate\(90 10 10\)"/);
  // The quarter from the end of the major axis now runs clockwise, from [8, 10] to [10, 13].
  assert.match(svg, /<path d="M 8 10 A 3 2 90 0 0 10 13"/);
});

test("the extents of a spline and of an arc of an ellipse are the curve's, not the control points'", () => {
  const points: Point[] = [
    [0, 0],
    [1, 4],
    [3, -2],
    [4, 1],
  ];
  const d = createDrawing();
  d.controlSpline(points);
  d.ellipse([0, 0], [2, 0], 0.5, { startParameter: 45, endParameter: 135 });
  const box = extents(d.build().entities);
  const curve = Array.from({ length: 10001 }, (_, k) =>
    splinePoint(3, [0, 0, 0, 0, 1, 1, 1, 1], points, undefined, k / 10000),
  );
  const arc = Array.from({ length: 10001 }, (_, k) =>
    ellipsePoint([0, 0], [2, 0], 0.5, Math.PI / 4 + (Math.PI / 2) * (k / 10000)),
  );
  const all = [...curve, ...arc];
  const sampled = [
    Math.min(...all.map((p) => p[0])),
    Math.min(...all.map((p) => p[1])),
    Math.max(...all.map((p) => p[0])),
    Math.max(...all.map((p) => p[1])),
  ];
  for (const [i, got] of box.entries()) {
    const want = sampled[i]!;
    assert.ok(Math.abs(got - want) < 1e-6, `${i}: ${got} against ${want}`);
    assert.ok(i < 2 ? got <= want : got >= want, `${i}: ${got} inside ${want}`);
  }
});

test("a curve's dashes run along its whole length, as a line's or a circle's do", () => {
  const dashed = (e: Entity): string => {
    const d = createDrawing().linetype(HIDDEN);
    d.layer("D", { linetype: "HIDDEN" });
    const svg = toSVG({ ...d.build(), entities: [{ ...e, layer: "D" } as Entity] });
    return /<path d="([^"]*)"/.exec(svg)![1]!;
  };
  const moves = (path: string) => path.split("M").length - 1;
  // A whole ellipse of ratio 1 dashes as the circle it is, from its parameter 0.
  const round = dashed({ kind: "circle", layer: "D", center: [0, 0], radius: 3 });
  const oval = dashed({ kind: "ellipse", layer: "D", center: [0, 0], majorAxis: [3, 0], ratio: 1 });
  assert.equal(moves(oval), moves(round));
  assert.ok(oval.startsWith("M 3 0 "));
  // A spline that is a straight line dashes as the line: half of the first dash and of what is
  // left over at each end.
  const line = dashed({ kind: "line", layer: "D", from: [0, 0], to: [10, 0] });
  const straight = dashed({
    kind: "spline",
    layer: "D",
    controlPoints: [
      [0, 0],
      [10, 0],
    ],
    degree: 1,
    knots: [0, 0, 1, 1],
  });
  const ends = (path: string) =>
    path
      .split("M")
      .slice(1)
      .map((dash) => {
        const xs = dash
          .trim()
          .split(/ L /)
          .map((p) => Number(p.split(" ")[0]));
        return [xs[0], xs.at(-1)];
      });
  assert.deepEqual(ends(straight), ends(line));
});

test("toPDF plots a spline's Bézier pieces and an arc of an ellipse", () => {
  const d = createDrawing({ units: "in" });
  d.layout("S", { paper: "ANSI B" }, () => {
    d.controlSpline([
      [1, 1],
      [2, 3],
      [3, 1],
      [4, 3],
    ]);
    d.ellipse([6, 4], [1, 0], 0.5, { startParameter: 0, endParameter: 270 });
  });
  const pdf = new TextDecoder("latin1").decode(toPDF(d.build()));
  assert.match(pdf, / c\n/);
});
