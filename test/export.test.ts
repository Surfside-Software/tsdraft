import assert from "node:assert/strict";
import { test } from "node:test";
import { createDrawing, DASHED, idHandle, toDXF, toSVG, type Drawing } from "../src/index.ts";

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
  const b = createDrawing({ units: "ft", dxf: "R12" });
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

test("text is escaped for each DXF version", () => {
  const b = createDrawing({ dxf: "R12" }).text([0, 0], "Ø 25 – café x^2");
  // R12 predates Unicode DXF. AutoCAD discards a drawing with a bare caret in either version.
  assert.match(toDXF(b.build()), /\r\n\\U\+00D8 25 \\U\+2013 caf\\U\+00E9 x\^ 2\r\n/);
  assert.match(toDXF(b.build(), { version: "R2018" }), /\r\nØ 25 – café x\^ 2\r\n/);
});

test("toDXF writes the version the drawing was created for, R2018 unless it names R12", () => {
  const d = createDrawing({ dxf: "R12" }).build();
  assert.match(toDXF(d), /AC1009/);
  assert.match(toDXF(d, { version: "R2018" }), /AC1032/);
  assert.match(toDXF(createDrawing().build()), /AC1032/);
});

test("an R2018 drawing has $XEDIT 0, and an R12 drawing does not state it", () => {
  const dxf = (version: "R12" | "R2018"): string =>
    toDXF(createDrawing({ units: "ft", dxf: version }).build());
  assert.match(dxf("R2018"), /\r\n9\r\n\$XEDIT\r\n290\r\n0\r\n/);
  assert.doesNotMatch(dxf("R12"), /XEDIT/);
});

test("text that looks like a DXF escape is written so AutoCAD keeps it", () => {
  /** The value AutoCAD is given for a text, which is group 1 of the TEXT record. */
  const value = (text: string, version: "R12" | "R2018") => {
    const p = pairs(toDXF(createDrawing().text([0, 0], text).build(), { version }));
    const record = p.slice(p.findIndex(([code, v]) => code === 0 && v === "TEXT"));
    return record.find(([code]) => code === 1)?.[1];
  };
  for (const version of ["R12", "R2018"] as const) {
    // AutoCAD decodes these twice, so the backslash is escaped twice.
    assert.equal(value("\\U+00B0 literal", version), "\\U+005CU+005CU+00B0 literal");
    assert.equal(value("\\u+00b0", version), "\\U+005CU+005Cu+00b0");
    assert.equal(value("\\M+18140", version), "\\U+005CU+005CM+18140");
    assert.equal(value("\\m+5abcd", version), "\\U+005CU+005Cm+5abcd");
    assert.equal(value("\\U+00\\U+00420", version), "\\U+00\\U+005CU+005CU+00420");
    // A backslash that starts nothing AutoCAD decodes stays as it is.
    for (const plain of [
      "C:\\Users\\file",
      "\\U+00B",
      "\\U+00G0",
      "\\M+08140",
      "\\M+1814",
      "\\",
      "U+00B0",
    ]) {
      assert.equal(value(plain, version), plain);
    }
    assert.equal(value("x^2 \\U+005E", version), "x^ 2 \\U+005CU+005CU+005E");
  }
  assert.equal(value("\\U+00E9 é", "R12"), "\\U+005CU+005CU+00E9 \\U+00E9");
  assert.equal(value("\\U+00E9 é", "R2018"), "\\U+005CU+005CU+00E9 é");
});

test("layer 0 is written first, wherever the drawing has it", () => {
  const d: Drawing = {
    format: 0,
    units: "in",
    dxf: "R2018",
    layers: [
      { name: "FIRST", color: 1 },
      { name: "0", color: 5 },
      { name: "LAST", color: 3 },
    ],
    entities: [{ kind: "line", layer: "LAST", from: [0, 0], to: [1, 1] }],
  };
  for (const version of ["R12", "R2018"] as const) {
    const p = pairs(toDXF(d, { version }));
    const names = p.flatMap(([code, value], i) => {
      if (code !== 0 || value !== "LAYER") return [];
      const record = p.slice(i + 1, i + 8);
      return [`${record.find(([c]) => c === 2)?.[1]} ${record.find(([c]) => c === 62)?.[1]}`];
    });
    assert.deepEqual(names, ["0 5", "FIRST 1", "LAST 3"], version);
  }
  assert.deepEqual(
    d.layers.map((l) => l.name),
    ["FIRST", "0", "LAST"],
    "the drawing is not changed",
  );
});

test("arc angles are written from 0 up to 360", () => {
  const d = createDrawing().arc([0, 0], 1, 359.9999996, 90).arc([0, 0], 1, 90, 359.9999996).build();
  for (const version of ["R12", "R2018"] as const) {
    const p = pairs(toDXF(d, { version }));
    const angles = p
      .slice(p.findIndex(([code, value]) => code === 2 && value === "ENTITIES"))
      .filter(([code]) => code === 50 || code === 51)
      .map(([, value]) => value);
    assert.deepEqual(angles, ["0", "90", "90", "0"], version);
  }
});

test("SVG draws an arc of nearly a full turn, and colors by layer whatever the case", () => {
  const d: Drawing = {
    format: 0,
    units: "in",
    dxf: "R2018",
    layers: [
      { name: "0", color: 7 },
      { name: "WALL", color: 1 },
    ],
    entities: [
      // The two ends round to the same point, where an SVG arc draws nothing.
      { kind: "arc", layer: "wall", center: [5, 5], radius: 1, startAngle: 0, endAngle: 359.99999 },
      { kind: "arc", layer: "wall", center: [5, 5], radius: 1, startAngle: 0, endAngle: 0.00001 },
    ],
  };
  const [, , full, short] = toSVG(d).split("\n");
  assert.match(full ?? "", /<circle cx="5" cy="5" r="1" stroke="#ff0000"/);
  assert.match(short ?? "", /<path d="M 6 5 A 1 1 0 0 1 6 5" stroke="#ff0000"/);
});

test("numbers are written in the forms AutoCAD reads", () => {
  const printed = (value: number) => {
    const p = pairs(toDXF(createDrawing().line([0, 0], [value, 0]).build()));
    return p
      .slice(p.findIndex(([code, v]) => code === 0 && v === "LINE"))
      .find(([c]) => c === 11)?.[1];
  };
  const forms: [number, string][] = [
    [-0, "0"],
    [-0.0000004, "0"],
    [0.0000004, "0"],
    [0.0000006, "0.000001"],
    [-0.000001, "-0.000001"],
    [0.1 + 0.2, "0.3"],
    [1234.5678915, "1234.567892"],
    // Digits up to 1e21, which AutoCAD reads at their full length.
    [123456789012345680000, "123456789012345680000"],
    // An exponent from 1e21 up, and never more than two digits of it.
    [1e21, "1e+21"],
    [-1.2345678901234568e21, "-1.2345678901234568e+21"],
    [9.999999999999998e99, "9.999999999999998e+99"],
  ];
  for (const [value, text] of forms) assert.equal(printed(value), text);
  assert.throws(() => printed(1e100), /under 1e100/);
});

test("the numbers a writer works out stay in the range AutoCAD reads", () => {
  const b = createDrawing({ dxf: "R2018" });
  // The ends are 1.8e100 apart, and the text is guessed to be 5.9e102 wide.
  b.line([0, 9e99], [3, -9e99]);
  b.circle([9e99, -9e99], 9.9e99);
  b.text([9e99, 0], "x".repeat(100), { height: 9.9e99 });
  const d = b.build();
  for (const version of ["R12", "R2018"] as const) {
    const dxf = toDXF(d, { version });
    assert.doesNotMatch(dxf, /e[+-]\d{3}|Infinity|NaN/, version);
  }
  const p = pairs(toDXF(d));
  const after = (name: string) => p[p.findIndex(([c, v]) => c === 9 && v === name) + 1]?.[1];
  assert.equal(after("$EXTMAX"), "9.999999999999998e+99");
  const view = p.slice(p.findIndex(([c, v]) => c === 0 && v === "VPORT"));
  assert.equal(view.find(([c]) => c === 40)?.[1], "9.999999999999998e+99", "view height");
});

test("SVG draws dashes and pen weights, and leaves out layers that are off or frozen", () => {
  const d = createDrawing({ linetypeScale: 2 });
  d.layer("DASHED", { linetype: DASHED, lineweight: 0.5 }, () => d.line([0, 0], [3, 0]));
  d.layer("OFF", { off: true }, () => d.line([0, 1], [3, 1]));
  d.layer("FROZEN", { frozen: true }, () => d.line([0, 2], [3, 2]));
  d.text([0, 3], "x");
  const svg = toSVG(d.build());
  // DASHED is 0.5 on and 0.25 off, at a scale of 2, and 0.5 mm is twice the default width.
  assert.match(svg, /<path d="M 0 0 L 1 0 M 1.5 0 L 2.5 0" stroke="currentColor" stroke-width="2"/);
  assert.doesNotMatch(svg, /data-layer="OFF"|data-layer="FROZEN"/);
  // The index is the entity's in drawing.entities, counting the ones left out.
  assert.match(svg, /data-layer="0" data-entity="3">x<\/text>/);
  // A dash longer than a circle is drawn as the two halves of a full turn.
  const long = { name: "LONG", pattern: [100, -1] };
  const circle = toSVG(createDrawing().circle([0, 0], 1, { linetype: long }).build());
  assert.match(circle, /<path d="M 1 0 A 1 1 0 0 1 -1 0 A 1 1 0 0 1 1 0"/);
});

test("R2018 DXF and SVG carry text styles and justification", () => {
  const d = createDrawing();
  d.textStyle({ name: "NOTES", font: "Arial", widthFactor: 0.9, obliqueAngle: 15 });
  d.text([1, 2], "plain");
  d.text([3, 4], "styled", { height: 2, style: "notes", align: "center", valign: "middle" });
  d.text([5, 6], "shx", { style: { name: "SHX", font: "txt.shx" }, align: "right", rotation: 30 });
  d.text([7, 8], "top", { valign: "top" });
  const drawing = d.build();
  const dxf = toDXF(drawing).replaceAll("\r\n", "|");
  // A style has no height. A TrueType font is its file, with its typeface in extended data.
  assert.ok(
    dxf.includes(
      "|2|NOTES|70|0|40|0|41|0.9|50|15|71|0|42|0.2|3|arial.ttf|4||1001|ACAD|1000|Arial|1071|34|0|",
    ),
  );
  assert.ok(dxf.includes("|2|SHX|70|0|40|0|41|1|50|0|71|0|42|0.2|3|txt.shx|4||0|ENDTAB"));
  // A text left on the baseline in Standard is written as before there were styles.
  assert.ok(
    dxf.includes("|100|AcDbText|10|1|20|2|30|0|40|0.125|1|plain|7|Standard|100|AcDbText|0|"),
  );
  // A justified text gives its point as the alignment point, and holds its style's width and slant.
  assert.ok(
    dxf.includes(
      "|10|3|20|4|30|0|40|2|1|styled|41|0.9|51|15|7|NOTES|72|1|11|3|21|4|31|0|100|AcDbText|73|2|0|",
    ),
  );
  assert.ok(dxf.includes("|1|shx|50|30|7|SHX|72|2|11|5|21|6|31|0|100|AcDbText|0|"));
  assert.ok(dxf.includes("|1|top|7|Standard|11|7|21|8|31|0|100|AcDbText|73|3|0|"));
  const p = pairs(toDXF(drawing));
  const handles = p.filter(([c]) => c === 5 || c === 105).map(([, v]) => v);
  assert.equal(new Set(handles).size, handles.length, "handles are unique");

  const svg = toSVG(drawing);
  assert.match(
    svg,
    /<text transform="translate\(1 2\) scale\(1 -1\)" font-size="0.125" font-family="monospace" fill/,
  );
  // Arial is drawn larger, so that its capitals are the text's height, and moved down half of it.
  assert.match(
    svg,
    /translate\(3 4\) scale\(1 -1\) translate\(0 1\) scale\(0.9 1\) skewX\(-15\)" font-size="2.793296" font-family="Arial, Helvetica, sans-serif" text-anchor="middle"/,
  );
  assert.match(
    svg,
    /translate\(5 6\) scale\(1 -1\) rotate\(-30\)" font-size="0.125" font-family="monospace" text-anchor="end"/,
  );
  assert.match(svg, /translate\(7 8\) scale\(1 -1\) translate\(0 0.0875\)"/);
});

test("the extents follow a text's vertical alignment and its style's width factor", () => {
  const below = createDrawing().line([0, 0], [10, 0]);
  below.text([5, 0], "BELOW", { height: 2, valign: "top" });
  // The text hangs 2 below the line, so the picture and $EXTMIN reach y = -2. Its five
  // characters run from x = 5 to 11.
  assert.match(toSVG(below.build(), { margin: 0 }), /viewBox="0 0 11 2"/);
  assert.match(toDXF(below.build()), /\$EXTMIN\r\n10\r\n0\r\n20\r\n-2\r\n/);
  const wide = createDrawing().text([0, 0], "WIDE", {
    height: 1,
    style: { name: "W", font: "Arial", widthFactor: 100 },
  });
  // Four characters of 0.6 each, a hundred times as wide.
  assert.match(toSVG(wide.build(), { margin: 0 }), /viewBox="0 -1 240 1"/);
});

test("SVG colors every ACI index, and index 7 is the foreground", () => {
  const d = createDrawing();
  d.layer("ORANGE", { color: 30 }, () => d.line([0, 0], [1, 0]));
  d.layer("LAST", { color: 255 }, () => d.line([0, 2], [1, 2]));
  d.line([0, 1], [1, 1]);
  const svg = toSVG(d.build());
  assert.match(svg, /stroke="#ff7f00"[^>]*data-layer="ORANGE"/);
  // The last index holds the table's length and order.
  assert.match(svg, /stroke="#fafafa"[^>]*data-layer="LAST"/);
  assert.match(svg, /stroke="currentColor"[^>]*data-layer="0"/);
});

test("SVG leaves out a layer that does not plot, unless asked for it", () => {
  const d = createDrawing();
  d.layer("GUIDE", { color: 8, plot: false }, () => d.line([0, 0], [50, 0]));
  d.layer("HIDDEN", { plot: false, off: true }, () => d.line([0, 0], [0, 90]));
  d.line([0, 1], [1, 1]);
  const drawing = d.build();
  const plotted = toSVG(drawing);
  const all = toSVG(drawing, { drawNoPlot: true });
  assert.doesNotMatch(plotted, /data-layer="GUIDE"/);
  assert.match(all, /stroke="#808080"[^>]*data-layer="GUIDE"/);
  // The picture's box follows what is drawn, and a layer that is off stays out either way.
  const box = (svg: string) => /viewBox="([^"]*)"/.exec(svg)![1]!.split(" ").map(Number);
  assert.ok(box(plotted)[2]! < 2 && box(all)[2]! > 50 && box(all)[3]! < 10);
  assert.doesNotMatch(all, /data-layer="HIDDEN"/);
});

test("an entity's id gives its handle, whatever else the drawing holds", () => {
  // 2^52 plus the FNV-1a hash of "a", af63dc4c8601ec8c, folded to 52 bits.
  assert.equal(idHandle("a"), "13DC4C8601E67A");
  assert.equal(idHandle("Door-1"), idHandle("door-1"));

  // A string that is not an id has no handle.
  assert.throws(() => idHandle("door 1"), /can only use/);

  /** The handle of each entity by its id, of those with no id in order, and `$HANDSEED`. */
  const handles = (drawing: Drawing) => {
    const p = pairs(toDXF(drawing));
    const start = p.findIndex(([c, v]) => c === 2 && v === "ENTITIES");
    const end = p.findIndex(([c, v], i) => i > start && c === 0 && v === "ENDSEC");
    const all = p.filter(([c]) => c === 5 || c === 105).map(([, v]) => v);
    const entities = p.slice(start, end).flatMap(([c, v]) => (c === 5 ? [v] : []));
    assert.equal(new Set(all).size, all.length, "handles are unique");
    return {
      byId: Object.fromEntries(
        drawing.entities.flatMap((e, i) => (e.id === undefined ? [] : [[e.id, entities[i]!]])),
      ),
      counted: entities.filter((_, i) => drawing.entities[i]!.id === undefined),
      seed: all[0],
    };
  };
  const dotted = { name: "DOTTED", pattern: [0, -1] };
  const before = createDrawing({ units: "ft" });
  before.linetype(dotted).linetype(DASHED);
  before.textStyle({ name: "NOTES", font: "Arial" }).textStyle({ name: "TITLE", font: "txt.shx" });
  before.layer("A-WALL", { color: 1, linetype: "DOTTED" }, () => {
    before.line([0, 0], [10, 0], { id: "wall-south" }).line([0, 9], [10, 9]);
  });
  before.layer("A-COLS", { color: 2, linetype: DASHED }, () => {
    before.circle([20, 0], 2, { id: "column-A1" });
    before.text([0, 0], "old", { height: 1, style: "TITLE", id: "title" });
  });
  // The same tables in another order with one more of each, and the entities moved, reordered
  // and joined by others.
  const after = createDrawing({ units: "ft" });
  after
    .linetype({ name: "GRID", pattern: [2, -1] })
    .linetype(DASHED)
    .linetype(dotted);
  after.textStyle({ name: "TITLE", font: "txt.shx" }).textStyle({ name: "SMALL", font: "Arial" });
  after.textStyle({ name: "NOTES", font: "Arial" });
  after.layer("A-GRID", { color: 5, linetype: "GRID" }, () => {
    after.line([-5, -5], [30, -5]).text([0, 0], "new", { height: 1, id: "note" });
  });
  after.layer("A-COLS", { color: 2, linetype: DASHED }, () => {
    after.text([3, 3], "old", { height: 1, style: "TITLE", id: "title" });
    after.circle([25, 1], 3, { id: "column-A1" });
  });
  after.layer("A-WALL", { color: 1, linetype: "DOTTED" }, () => {
    after.line([0, 9], [10, 9]).line([2, 1], [16, 1], { id: "Wall-South" });
  });

  const [a, b] = [handles(before.build()), handles(after.build())];
  assert.deepEqual(a.byId, {
    "wall-south": idHandle("wall-south"),
    "column-A1": idHandle("column-A1"),
    title: idHandle("title"),
  });
  // The entities that are in both keep their handles, the respelled id too.
  assert.deepEqual(b.byId, {
    "Wall-South": a.byId["wall-south"],
    "column-A1": a.byId["column-A1"],
    title: a.byId.title,
    note: idHandle("note"),
  });
  // An entity with no id is counted on from the tables, so one more of those moves it.
  assert.deepEqual([a.counted, b.counted], [["22"], ["25", "26"]]);
  // The seed is 2^53, above every handle an id can give.
  assert.deepEqual([a.seed, b.seed], ["20000000000000", "20000000000000"]);
});
