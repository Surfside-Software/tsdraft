import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decipherSat,
  edgesInPlan,
  sabEdges,
  satEdges,
  type ReadEdge,
  type ReadModelerGeometry,
} from "../src/index.ts";
import { random } from "./read-fuzz.ts";

/** A small body in the text form: a line, a whole circle and a B-spline, moved 10 along X. */
const RECORDS = [
  "asmheader $-1 -1 @5 1.0.0 #",
  "body $-1 -1 $-1 $-1 $-1 $2 #",
  "transform $-1 -1 1 0 0 0 1 0 0 0 1 10 0 0 1 no_rotate no_reflect no_shear #",
  "point $-1 -1 $-1 0 0 0 #",
  "point $-1 -1 $-1 2 0 0 #",
  "vertex $-1 -1 $-1 $-1 0 $3 #",
  "vertex $-1 -1 $-1 $-1 0 $4 #",
  "straight-curve $-1 -1 $-1 0 0 0 1 0 0 I I #",
  "edge $-1 -1 $-1 $5 0 $6 2 $-1 $7 forward @7 unknown #",
  "ellipse-curve $-1 -1 $-1 0 0 0 0 0 1 2 0 0 1 I I #",
  "edge $-1 -1 $-1 $6 0 $6 6.283185307179586 $-1 $9 forward @7 unknown #",
  "intcurve-curve $-1 -1 $-1 forward { exact_int_cur 22800 full nubs 1 open 2 0 1 1 1 0 0 0 0 1 0 } I I #",
  "edge $-1 -1 $-1 $5 0 $5 1 $-1 $11 forward @7 unknown #",
];
const SAT = `21500 ${RECORDS.length} 1 0\n4 test 0 \n1 1e-06 1e-10\n${RECORDS.join("\n")}\nEnd-of-ACIS-data\n`;

/** The same records in the binary form, each token after the byte that says its kind. */
function sab(): Uint8Array {
  const out: number[] = [...new TextEncoder().encode("ACIS BinaryFile")];
  const int = (v: number) => {
    const b = new DataView(new ArrayBuffer(4));
    b.setInt32(0, v, true);
    out.push(...new Uint8Array(b.buffer));
  };
  const double = (v: number) => {
    const b = new DataView(new ArrayBuffer(8));
    b.setFloat64(0, v, true);
    out.push(...new Uint8Array(b.buffer));
  };
  const word = (tag: number, w: string) => out.push(tag, w.length, ...new TextEncoder().encode(w));
  [21500, 0, 1, 0].forEach(int);
  for (const record of RECORDS) {
    const tokens = record.split(" ");
    const [name, ...rest] = tokens;
    const parts = name!.split("-");
    for (const part of parts.slice(0, -1)) word(0x0e, part);
    word(0x0d, parts.at(-1)!);
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i]!;
      if (t === "#") out.push(0x11);
      else if (t === "{") out.push(0x0f);
      else if (t === "}") out.push(0x10);
      else if (t.startsWith("$")) (out.push(0x0c), int(Number(t.slice(1))));
      else if (t.startsWith("@")) word(0x07, rest[++i]!);
      else if (t === "forward" || t.startsWith("no_") || t === "I") out.push(0x0b);
      else if (/^-?\d+$/.test(t) && !/^(0|1|2)$/.test(t)) (out.push(0x04), int(Number(t)));
      else if (Number.isFinite(Number(t))) (out.push(0x06), double(Number(t)));
      else word(0x0d, t);
    }
  }
  word(0x0e, "End");
  word(0x0e, "of");
  word(0x0e, "ACIS");
  word(0x0d, "data");
  return Uint8Array.from(out);
}

test("modeler data reads as the body's edges in the world, from either form", () => {
  const { edges, unread } = satEdges(SAT);
  assert.equal(unread, 0);
  assert.deepEqual(edges, [
    { kind: "line", from: [10, 0, 0], to: [12, 0, 0] },
    { kind: "ellipse", center: [10, 0, 0], normal: [0, 0, 1], majorAxis: [2, 0, 0], ratio: 1 },
    {
      kind: "spline",
      degree: 1,
      knots: [0, 0, 1, 1],
      controlPoints: [
        [10, 0, 0],
        [10, 1, 0],
      ],
    },
  ]);
  assert.deepEqual(sabEdges(sab()), { edges, unread });
});

test("a file's cipher of the text form is its own inverse", () => {
  const plain = "edge $-1 -1 $5 0.5 forward #\n";
  assert.notEqual(decipherSat(plain), plain);
  assert.equal(decipherSat(decipherSat(plain)), plain);
});

test("hostile modeler data reads as edges or as data not read, in bounded time", () => {
  const next = random(13);
  const bytes = sab();
  for (let run = 0; run < 2000; run++) {
    const text = [...SAT];
    const b = Uint8Array.from(bytes);
    for (let k = 0; k < 1 + Math.floor(next() * 6); k++) {
      const at = Math.floor(next() * text.length);
      text[at] = String.fromCharCode(32 + Math.floor(next() * 95));
      b[Math.floor(next() * b.length)] = Math.floor(next() * 256);
    }
    for (const read of [satEdges(text.join("")), sabEdges(b)]) {
      assert.ok(read.unread >= -1);
      for (const e of read.edges) assert.ok(["line", "ellipse", "spline"].includes(e.kind));
    }
  }
  // Braces nested deep, and many edges on one long curve, read in time in proportion to the data.
  const deep = SAT.replace(
    "exact_int_cur",
    `${"{ ".repeat(100_000)}${"} ".repeat(100_000)}exact_int_cur`,
  );
  const long = `nubs 3 open 2000 ${Array.from({ length: 2000 }, (_, i) => `${i} ${i === 0 || i === 1999 ? 3 : 1}`).join(" ")} ${"1 2 3 ".repeat(2002)}`;
  const many = SAT.replace("nubs 1 open 2 0 1 1 1 0 0 0 0 1 0", long).replace(
    "End-of-ACIS-data",
    `${"edge $-1 -1 $-1 $5 10 $5 1500 $-1 $11 forward @7 unknown #\n".repeat(20_000)}End-of-ACIS-data`,
  );
  const started = performance.now();
  satEdges(deep);
  assert.ok(satEdges(many).unread > 0);
  assert.ok(performance.now() - started < 5000);
  // Many long distinct splines all read: the budget is in the data's size.
  const k = 1000;
  const spaced = Array.from({ length: k }, (_, i) => `${i} ${i === 0 || i === k - 1 ? 3 : 1}`);
  let profile = SAT.replace("End-of-ACIS-data\n", "");
  for (let c = 0; c < 120; c++) {
    profile += `intcurve-curve $-1 -1 $-1 forward { exact_int_cur 22800 full nubs 3 open ${k} ${spaced.join(" ")} ${"1 2 3 ".repeat(k + 2)}0 } I I #\n`;
    profile += `edge $-1 -1 $-1 $5 1.5 $5 997.5 $-1 $${RECORDS.length + 2 * c} forward @7 unknown #\n`;
  }
  assert.equal(satEdges(`${profile}End-of-ACIS-data\n`).unread, 0);
  // A B-spline that says it holds far more knots than the data does.
  const huge = SAT.replace("nubs 1 open 2", "nubs 1 open 999999999");
  assert.equal(satEdges(huge).unread, 1);
});

const solid = (edges: ReadEdge[]): ReadModelerGeometry => ({
  kind: "3dsolid",
  layer: "SOLID",
  color: 3,
  edges,
});

test("edgesInPlan draws each edge as it shows from above", () => {
  const tilt = Math.PI / 3;
  const drawn = edgesInPlan(
    solid([
      { kind: "line", from: [0, 0, 0], to: [0, 0, 5] },
      { kind: "line", from: [0, 0, 0], to: [3, 4, 5] },
      // A circle of radius 2 turned 60 degrees about X: an ellipse half as tall.
      {
        kind: "ellipse",
        center: [0, 0, 1],
        normal: [0, -Math.sin(tilt), Math.cos(tilt)],
        majorAxis: [2, 0, 0],
        ratio: 1,
      },
      // A circle seen edge on: a line across it.
      { kind: "ellipse", center: [5, 0, 0], normal: [0, 1, 0], majorAxis: [2, 0, 0], ratio: 1 },
    ]),
  );
  assert.equal(drawn.length, 3);
  assert.deepEqual(drawn[0], { layer: "SOLID", color: 3, kind: "line", from: [0, 0], to: [3, 4] });
  const ellipse = drawn[1]!;
  assert.equal(ellipse.kind, "ellipse");
  if (ellipse.kind === "ellipse") {
    assert.ok(Math.abs(Math.hypot(...ellipse.majorAxis) - 2) < 1e-12);
    assert.ok(Math.abs(ellipse.ratio - 0.5) < 1e-12);
  }
  // Nearly edge on, at a ratio the writers would write as 0: a line too.
  const nearly = edgesInPlan(
    solid([
      {
        kind: "ellipse",
        center: [0, 0, 0],
        normal: [0, Math.sqrt(1 - 1e-14), 1e-7],
        majorAxis: [1000, 0, 0],
        ratio: 1,
      },
    ]),
  );
  assert.equal(nearly[0]?.kind, "line");
  // A short arc at the tip of such a circle: a line across the axis, between its own ends.
  const d = (4e-7 * 180) / Math.PI;
  const tip = edgesInPlan(
    solid([
      {
        kind: "ellipse",
        center: [0, 0, 0],
        normal: [0, Math.sqrt(1 - 1.6e-13), 4e-7],
        majorAxis: [4e6, 0, 0],
        ratio: 1,
        startParameter: 360 - d,
        endParameter: 360 + d,
      },
    ]),
  );
  assert.equal(tip[0]?.kind, "line");
  const line = drawn[2]!;
  assert.equal(line.kind, "line");
  if (line.kind === "line") {
    assert.ok(Math.abs(Math.abs(line.to[0] - line.from[0]) - 4) < 1e-12);
  }
});
