import assert from "node:assert/strict";
import { test } from "node:test";
import { createDrawing, toDXF, toSVG } from "../src/index.ts";

/** Parses DXF text into [code, value] pairs. */
function pairs(dxf: string): [number, string][] {
  const lines = dxf.split("\r\n");
  assert.equal(lines.pop(), "", "DXF ends with CRLF");
  assert.equal(lines.length % 2, 0, "DXF has whole group-code pairs");
  const out: [number, string][] = [];
  for (let i = 0; i < lines.length; i += 2) out.push([Number(lines[i]), lines[i + 1] ?? ""]);
  return out;
}

function sample() {
  const b = createDrawing({ units: "ft" });
  b.layer("C-PROP", { color: 3 }, () => {
    b.rect([0, 0], 100, 0.1 + 0.2);
    b.arc([50, 0], 5, 0, 180);
  });
  b.text([1, 1], "LOT 1 <A&B>", { height: 2, rotation: 90 });
  return b.build();
}

test("DXF is well-formed R12 with layers and entities", () => {
  const p = pairs(toDXF(sample()));
  const has = (code: number, value: string) => p.some(([c, v]) => c === code && v === value);

  assert.deepEqual(p.at(-1), [0, "EOF"]);
  assert.ok(has(1, "AC1009"));
  const headerVars = p.filter(([c]) => c === 9).map(([, v]) => v);
  assert.deepEqual(headerVars, ["$ACADVER"], "only R12 header variables");
  assert.ok(has(2, "C-PROP") && has(62, "3"), "layer table entry");
  for (const kind of ["POLYLINE", "VERTEX", "SEQEND", "ARC", "TEXT"]) assert.ok(has(0, kind), kind);
  assert.equal(p.filter(([c, v]) => c === 0 && v === "VERTEX").length, 4);
  assert.ok(has(20, "0.3"), "no float noise in coordinates");
  assert.ok(has(1, "LOT 1 <A&B>"));
  assert.ok(has(50, "90"), "text rotation");
});

test("SVG flips Y, escapes text and colors by layer", () => {
  const svg = toSVG(sample(), { margin: 0 });
  assert.match(svg, /<g transform="scale\(1 -1\)"/);
  assert.match(svg, /<polygon points="0,0 100,0 100,0.3 0,0.3" stroke="#00ff00"/);
  assert.match(svg, /<path d="M 55 0 A 5 5 0 0 1 45 0"/);
  assert.match(svg, />LOT 1 &lt;A&amp;B&gt;<\/text>/);
  assert.match(svg, /rotate\(-90\)/);
});

test("empty drawing still exports", () => {
  const d = createDrawing().build();
  assert.deepEqual(pairs(toDXF(d)).at(-1), [0, "EOF"]);
  assert.match(toSVG(d), /^<svg /);
});

test("R2018 DXF has AC1032 sections, units and valid handles", () => {
  const p = pairs(toDXF(sample(), { version: "R2018" }));
  const has = (code: number, value: string) => p.some(([c, v]) => c === code && v === value);
  const after = (name: string) => p[p.findIndex(([c, v]) => c === 9 && v === name) + 1]?.[1];

  assert.deepEqual(p.at(-1), [0, "EOF"]);
  assert.equal(after("$ACADVER"), "AC1032");
  assert.equal(after("$INSUNITS"), "2", "feet");
  assert.equal(after("$MEASUREMENT"), "0", "imperial");
  const sections = p.flatMap(([c, v], i) => (c === 0 && v === "SECTION" ? [p[i + 1]?.[1]] : []));
  assert.deepEqual(sections, ["HEADER", "CLASSES", "TABLES", "BLOCKS", "ENTITIES", "OBJECTS"]);

  // Handles: unique, every owner and pointer resolves, and $HANDSEED is above all of them.
  const headerEnd = p.findIndex(([c, v]) => c === 0 && v === "ENDSEC");
  const handles = p
    .slice(headerEnd)
    .filter(([c]) => c === 5 || c === 105)
    .map(([, v]) => v);
  assert.equal(new Set(handles).size, handles.length, "handles are unique");
  for (const [code, value] of p.slice(headerEnd)) {
    if (code === 330 || code === 340 || code === 350 || code === 390) {
      assert.ok(value === "0" || handles.includes(value), `${code} ${value} resolves`);
    }
  }
  const seed = parseInt(after("$HANDSEED") ?? "", 16);
  assert.ok(
    handles.every((h) => parseInt(h, 16) < seed),
    "$HANDSEED is above every handle",
  );

  for (const table of ["VPORT", "LTYPE", "LAYER", "STYLE", "APPID", "DIMSTYLE", "BLOCK_RECORD"]) {
    assert.ok(has(2, table), `${table} table`);
  }
  for (const name of ["*Model_Space", "*Paper_Space", "Continuous", "Standard", "ACAD"]) {
    assert.ok(has(2, name), name);
  }
  assert.ok(has(3, "ACAD_GROUP"), "root dictionary");
  // AutoCAD discards the file ("Did not receive PlotStyleName") if a layer has no 390 pointer.
  const layers = p.filter(([c, v]) => c === 0 && v === "LAYER").length;
  assert.equal(p.filter(([c]) => c === 390).length, layers, "every layer has a plot style");
  assert.ok(has(0, "ACDBDICTIONARYWDFLT") && has(3, "ACAD_PLOTSTYLENAME"), "plot styles");
  assert.ok(has(0, "LWPOLYLINE") && has(90, "4") && has(70, "1"), "closed 4-point polyline");
  assert.ok(has(100, "AcDbArc") && has(51, "180"), "arc");
  assert.ok(has(1, "LOT 1 <A&B>") && has(50, "90"), "text");
  assert.ok(!has(0, "POLYLINE") && !has(0, "VERTEX"), "no R12 polylines");
});

test("R2018 DXF records metric units and keeps UTF-8 text", () => {
  const d = createDrawing({ units: "mm" }).text([0, 0], "Ø 25 – café").build();
  const dxf = toDXF(d, { version: "R2018" });
  assert.match(dxf, /\$INSUNITS\r\n70\r\n4\r\n/);
  assert.match(dxf, /\$MEASUREMENT\r\n70\r\n1\r\n/);
  assert.match(dxf, /\r\nØ 25 – café\r\n/);
  assert.deepEqual(pairs(toDXF(createDrawing().build(), { version: "R2018" })).at(-1), [0, "EOF"]);
});

test("toDXF rejects unknown versions", () => {
  // @ts-expect-error: checks the runtime guard for JavaScript callers.
  assert.throws(() => toDXF(sample(), { version: "R14" }), /Unsupported DXF version/);
});
