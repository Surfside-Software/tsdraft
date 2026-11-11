import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDrawing,
  DrawingError,
  fromJSON,
  idHandle,
  layoutHandles,
  lint,
  PAPERS,
  toDXF,
  toJSON,
  toSVG,
  viewportView,
  type Drawing,
  type Layout,
} from "../src/index.ts";
import { layoutNameKey } from "../src/layers.ts";
import { findLayout } from "../src/layouts.ts";

/** A plan in feet with one sheet: a border and a note on the paper, and a view at 1" = 10'. */
function sheet(): Drawing {
  const d = createDrawing({ units: "ft" });
  d.layer("WALL", { color: 1, lineweight: 0.5, linetype: { name: "DASH", pattern: [0.5, -0.25] } });
  d.layer("VIEW", { color: 4, plot: false });
  d.layer("WALL", {}, () => d.line([100, 100], [200, 100], { id: "wall" }));
  d.block("TAG", {}, () => d.attribute("NO", [0, 0], { value: "X", height: 0.2 }));
  d.layout("A-101", { paper: "ARCH D" }, (page) => {
    d.rect([0.5, 0.5], page.width - 1, page.height - 1, { id: "border" });
    d.layer("VIEW", {}, () =>
      page.viewport([1, 1], 34, 22, { center: [170, 110], ratio: 120, id: "plan" }),
    );
    d.insert("TAG", [30, 2], { id: "tag", attributes: { NO: "A-101" } });
  });
  return d.build();
}

function pairs(dxf: string): [number, string][] {
  const lines = dxf.split("\r\n");
  const out: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([Number(lines[i]), lines[i + 1]!]);
  return out;
}

/** The records of a DXF: each from one group 0 to the next. */
function records(dxf: string): [number, string][][] {
  const out: [number, string][][] = [];
  for (const pair of pairs(dxf)) {
    if (pair[0] === 0) out.push([]);
    out.at(-1)?.push(pair);
  }
  return out;
}

test("layout() puts what is drawn inside it on a sheet, and the drawing round-trips as JSON", () => {
  const drawing = sheet();
  assert.equal(drawing.entities.length, 1);
  assert.deepEqual(drawing.layouts, [
    {
      name: "A-101",
      paper: "ARCH D",
      viewports: [
        {
          id: "plan",
          layer: "VIEW",
          corner: [1, 1],
          width: 34,
          height: 22,
          center: [170, 110],
          ratio: 120,
        },
      ],
      entities: [
        {
          kind: "polyline",
          layer: "0",
          points: [
            [0.5, 0.5],
            [35.5, 0.5],
            [35.5, 23.5],
            [0.5, 23.5],
          ],
          closed: true,
          id: "border",
        },
        {
          kind: "insert",
          layer: "0",
          block: "TAG",
          at: [30, 2],
          id: "tag",
          attributes: { NO: "A-101" },
        },
      ],
    },
  ]);
  assert.deepEqual(lint(drawing), []);
  assert.equal(toJSON(fromJSON(toJSON(drawing))), toJSON(drawing));
  assert.throws(
    () => fromJSON(toJSON(drawing).replace('"paper":"ARCH D"', '"paper":"ARCH D","scale":2')),
    /unknown field "scale"/,
  );
});

test("a viewport's ratio gives the view AutoCAD holds, in every pair of units", () => {
  const viewport = sheet().layouts![0]!.viewports[0]!;
  // 1" = 10': 22 inches of paper show 220 feet, and a foot takes a tenth of an inch.
  const view = viewportView(viewport, "in", "ft");
  assert.deepEqual(
    [view.paperCenter, view.viewHeight, view.box, view.scale],
    [[18, 12], 220, [0, 0, 340, 220], 0.1],
  );
  // A ratio is a ratio of lengths, so 1:50 on inch paper shows 50 inches for each inch.
  assert.equal(viewportView({ ...viewport, ratio: 50 }, "in", "mm").viewHeight, 22 * 50 * 25.4);
  assert.equal(viewportView({ ...viewport, ratio: 96 }, "in", "in").viewHeight, 22 * 96);
  assert.equal(viewportView({ ...viewport, ratio: 100 }, "mm", "m").viewHeight, 2.2);
  assert.throws(() => viewportView({ ...viewport, ratio: 0 }, "in", "ft"), RangeError);
  assert.throws(() => viewportView({ ...viewport, height: Number.NaN }, "in", "ft"), RangeError);
  assert.throws(() => viewportView(viewport, "ft" as "in", "ft"), RangeError);
  assert.throws(() => viewportView(null as never, "in", "ft"), RangeError);
});

test("the R2018 DXF holds the layout, its page setup, its block and its viewports", () => {
  const drawing = sheet();
  const dxf = toDXF(drawing);
  const all = records(dxf);
  const handles = layoutHandles("A-101");
  const value = (record: [number, string][], code: number, nth = 0): string | undefined =>
    record.filter(([c]) => c === code)[nth]?.[1];
  const layout = all.find((r) => r[0]![1] === "LAYOUT" && value(r, 5) === handles.layout)!;
  // The page setup: the plotter, the paper as the plotter names it, in millimetres, the
  // layout at 1:1, with plot styles and lineweights, and the plot style table.
  assert.deepEqual(
    [2, 4, 44, 45, 70, 72, 73, 74, 75, 7].map((code) => value(layout, code)),
    [
      "DWG To PDF.pc3",
      "ARCH_full_bleed_D_(36.00_x_24.00_Inches)",
      "914.400024",
      "609.599976",
      "688",
      "0",
      "0",
      "5",
      "16",
      "monochrome.ctb",
    ],
  );
  assert.deepEqual(
    [value(layout, 1, 1), value(layout, 71), value(layout, 330, 2)],
    ["A-101", "1", handles.record],
  );
  // Model space and the layout's block each name their layout, and the block is the paper
  // space the drawing opens on.
  const blockRecords = all.filter((r) => r[0]![1] === "BLOCK_RECORD");
  assert.deepEqual(
    blockRecords.map((r) => [
      value(r, 2),
      value(r, 5) === handles.record,
      value(r, 340) !== undefined,
    ]),
    [
      ["*Model_Space", false, true],
      ["*Paper_Space", true, true],
      ["TAG", false, false],
    ],
  );
  // The sheet's own viewport comes first, then the drawing's, locked, with the height of the
  // view where a scale would be.
  const viewports = all.filter((r) => r[0]![1] === "VIEWPORT");
  assert.deepEqual(
    viewports.map((r) => [
      value(r, 5),
      value(r, 8),
      value(r, 69),
      value(r, 41),
      value(r, 45),
      value(r, 90),
    ]),
    [
      [handles.sheet, "0", "1", "26.4", "26.4", String(0x8060)],
      [idHandle("plan"), "VIEW", "2", "22", "220", String(0xc060)],
    ],
  );
  // Everything on the sheet is marked as paper space and owned by the layout's block.
  const paper = all.filter((r) => value(r, 67) === "1" && !["BLOCK", "ENDBLK"].includes(r[0]![1]));
  assert.deepEqual(
    paper.map((r) => r[0]![1]),
    ["VIEWPORT", "VIEWPORT", "LWPOLYLINE", "INSERT", "ATTRIB", "SEQEND"],
  );
  assert.ok(paper.slice(0, 4).every((r) => value(r, 330) === handles.record));
  // The drawing opens on the sheet, and every pointer leads to an object.
  assert.ok(dxf.includes("$TILEMODE\r\n70\r\n0\r\n"));
  const owned = new Set(
    pairs(dxf)
      .filter(([c]) => c === 5 || c === 105)
      .map(([, v]) => v),
  );
  const pointers = pairs(dxf).filter(([c]) => [330, 331, 340, 350].includes(c));
  assert.deepEqual(
    pointers.filter(([, v]) => v !== "0" && !owned.has(v)),
    [],
  );
  assert.equal(owned.size, pairs(dxf).filter(([c]) => c === 5 || c === 105).length);
});

test("a layout's handles come from its name, and never change", () => {
  // These are in files that exist. A change here breaks every reference to a layout's objects.
  assert.deepEqual(layoutHandles("Sheet"), {
    layout: "11EDB78FA2B790",
    record: "12D6006383692E",
    begin: "1817AD8C7E8788",
    end: "12D7E9EB8AC139",
    sheet: "13F27F898AC410",
  });
  assert.equal(new Set(Object.values(layoutHandles("Sheet"))).size, 5);
  assert.deepEqual(layoutHandles("SHEET"), layoutHandles("Sheet"));
  assert.notDeepEqual(layoutHandles("É"), layoutHandles("é"));
  assert.throws(() => layoutHandles("Model"), RangeError);
  // An entity of model space with an id keeps its handle when a layout is added.
  const d = createDrawing();
  d.line([0, 0], [1, 0], { id: "a" });
  const before = toDXF(d.build());
  d.layout("Sheet", { paper: "ARCH D" }, () => d.line([0, 0], [1, 1]));
  const lineOf = (dxf: string): string => /LINE\r\n5\r\n([0-9A-F]+)\r\n/.exec(dxf)![1]!;
  assert.deepEqual([lineOf(before), lineOf(toDXF(d.build()))], [idHandle("a"), idHandle("a")]);
  // A drawing whose list of layouts is empty is written as one with none.
  assert.equal(toDXF({ ...d.build(), layouts: [] }), before);
});

test("a second layout is a block of its own, with what it holds inside it", () => {
  const d = createDrawing({ units: "ft" });
  d.layout("One", { paper: "ARCH D" }, () => d.line([0, 0], [1, 1]));
  d.layout("Two", { paper: "ANSI B", plotStyle: "acad.ctb" }, (page) => {
    page.viewport([1, 1], 15, 9, { center: [0, 0], ratio: 240 });
    d.line([0, 0], [2, 2]);
  });
  const dxf = toDXF(d.build());
  const blocks = dxf.slice(dxf.indexOf("BLOCKS"), dxf.indexOf("ENTITIES"));
  assert.ok(blocks.includes("*Paper_Space0"));
  // The first layout's entities are with the drawing's, and the second's are in its block.
  assert.equal(blocks.split("VIEWPORT").length - 1, 2);
  assert.equal(dxf.slice(dxf.indexOf("ENTITIES")).split("\r\nVIEWPORT\r\n").length - 1, 1);
  assert.ok(dxf.includes("acad.ctb"));
});

test("a layout's name is held to AutoCAD's rules, at compile time and when the code runs", () => {
  const d = createDrawing();
  const refused = (run: () => unknown, pattern: RegExp): void => {
    assert.throws(run, (error: unknown) => {
      assert.ok(error instanceof DrawingError);
      assert.match(error.message, pattern);
      return true;
    });
  };
  // @ts-expect-error an empty name
  refused(() => d.layout("", { paper: "ARCH D" }, () => {}), /cannot be empty/);
  // @ts-expect-error the model tab's name
  refused(() => d.layout("MODEL", { paper: "ARCH D" }, () => {}), /cannot be named Model/);
  // @ts-expect-error a character AutoCAD's LAYOUT command refuses
  refused(() => d.layout("A/B", { paper: "ARCH D" }, () => {}), /cannot contain/);
  // @ts-expect-error a space at the end
  refused(() => d.layout("A ", { paper: "ARCH D" }, () => {}), /start or end with a space/);
  // @ts-expect-error a paper that is not in the list
  refused(() => d.layout("A", { paper: "A1" }, () => {}), /must be one of PAPERS/);
  // @ts-expect-error a plot style table that is not in the list
  refused(() => d.layout("A", { paper: "ARCH D", plotStyle: "mine.ctb" }, () => {}), /plot style/);
  refused(() => d.layout("x".repeat(256), { paper: "ARCH D" }, () => {}), /255 characters/);
  // @ts-expect-error a control character
  refused(() => d.layout("A\tB", { paper: "ARCH D" }, () => {}), /control characters/);
  refused(() => d.layout(5 as never, { paper: "ARCH D" }, () => {}), /must be a string/);
  refused(() => d.layout("A", null as never, () => {}), /must be one of PAPERS/);
  // A caret and a space inside are names AutoCAD's own command takes.
  d.layout("A^1 plan", { paper: "ANSI A" }, () => {});
  // AutoCAD takes these for the same name, and a layout that is being drawn has its name.
  refused(() => d.layout("a^1 PLAN", { paper: "ANSI A" }, () => {}), /already has a layout/);
  refused(
    () => d.layout("É", { paper: "ANSI A" }, () => d.layout("é", { paper: "ANSI A" }, () => {})),
    /inside a block or another layout/,
  );
  d.layout("É", { paper: "ANSI A" }, () => {});
  refused(() => d.layout("é", { paper: "ANSI A" }, () => {}), /already has a layout.*"É"/);
  assert.deepEqual(
    d.build().layouts?.map((layout) => layout.name),
    ["A^1 plan", "É"],
  );
  const r12 = createDrawing({ dxf: "R12" });
  // @ts-expect-error R12 has no layouts
  refused(() => r12.layout("A", { paper: "ARCH D" }, () => {}), /no layouts to R12/);
});

test("AutoCAD's table of letters decides which two layout names are one", () => {
  for (const [a, b] of [
    ["Sheet", "SHEET"],
    ["Ÿ", "ÿ"],
    ["Σ", "σ"],
    ["Ǆ", "ǆ"],
    ["Ａ", "ａ"],
  ]) {
    assert.equal(layoutNameKey(a!), layoutNameKey(b!), `${a} and ${b}`);
  }
  // It keeps these apart: the sharp s and two of them, the two small sigmas, the title-case
  // digraph, a composed letter and a decomposed one, and Cherokee's two cases.
  for (const [a, b] of [
    ["straße", "STRASSE"],
    ["σ", "ς"],
    ["ǅ", "ǆ"],
    ["é", "é"],
    ["Ꭰ", "ꭰ"],
  ]) {
    assert.notEqual(layoutNameKey(a!), layoutNameKey(b!), `${a} and ${b}`);
  }
  assert.equal(findLayout(sheet(), "a-101")?.name, "A-101");
});

test("a viewport is checked as it is added, and belongs to the layout being drawn", () => {
  const d = createDrawing({ units: "ft" });
  d.line([0, 0], [1, 0], { id: "taken" });
  let kept: { viewport: (...args: never[]) => unknown } | undefined;
  d.layout("A", { paper: "ARCH D" }, (page) => {
    kept = page as never;
    const view = { center: [0, 0], ratio: 120 } as const;
    const zero = { center: [0, 0], ratio: 0 } as const;
    // @ts-expect-error a ratio of 0
    assert.throws(() => page.viewport([0, 0], 1, 1, zero), /ratio must be greater/);
    // @ts-expect-error a width of 0
    assert.throws(() => page.viewport([0, 0], 0, 1, view), /width: This value must be greater/);
    assert.throws(() => page.viewport([0, 0], 1, 1, { ...view, ratio: 1e-9 }), /written as 0/);
    assert.throws(() => page.viewport([0, 0], 1, 1, { ...view, ratio: 1e200 }), /1e100/);
    assert.throws(() => page.viewport([0, Number.NaN], 1, 1, view), /corner must be a point/);
    assert.throws(() => page.viewport([0, 0], 1, 1, null as never), /center must be a point/);
    // An id is one of the drawing's, whatever space it is in.
    assert.throws(() => page.viewport([0, 0], 1, 1, { ...view, id: "TAKEN" }), /already used/);
    assert.throws(() => d.block("B", {}, () => {}), /cannot be defined on a layout/);
    assert.throws(() => d.attribute("T", [0, 0]), /belongs to a block/);
    page.viewport([0, 0], 1, 1, { ...view, id: "v" });
  });
  assert.throws(() => d.line([0, 0], [1, 1], { id: "V" }), /already used/);
  assert.throws(
    () => kept!.viewport([0, 0] as never, 1 as never, 1 as never, {} as never),
    /while its layout is drawn/,
  );
  assert.throws(
    () => d.block("B", {}, () => d.layout("C", { paper: "ARCH D" }, () => {})),
    /inside a block or another layout/,
  );
  assert.equal(d.build().layouts![0]!.viewports.length, 1);
  // The error names the layout and the call.
  const recorded = createDrawing({ recordCalls: true });
  try {
    recorded.layout("A", { paper: "ARCH D" }, (page) =>
      page.viewport([0, 0], 1, 1, { center: [0, 0], ratio: -1 as number, id: "bad" }),
    );
    assert.fail("no error");
  } catch (error) {
    const [found] = (error as DrawingError).diagnostics;
    assert.deepEqual([found?.rule, found?.layout, found?.id], ["viewport", "A", "bad"]);
    assert.match(found?.call?.file ?? "", /layouts\.test\.ts$/);
  }
});

test("a layout whose draw throws leaves the builder as it was", () => {
  const d = createDrawing();
  d.layer("L", { color: 2 });
  assert.throws(
    () =>
      d.layout("A", { paper: "ARCH D" }, (page) => {
        d.layer("L", {}, () => {
          d.line([0, 0], [1, 1], { id: "line" });
          page.viewport([0, 0], 1, 1, { center: [0, 0], ratio: 1, id: "view" });
          throw new Error("stop");
        });
      }),
    /stop/,
  );
  // The name, the ids and the handles are free again, and drawing goes to model space.
  d.layout("A", { paper: "ARCH D" }, () => {});
  d.line([0, 0], [1, 1], { id: "line" });
  d.circle([0, 0], 1, { id: "view" });
  const drawing = d.build();
  assert.deepEqual(
    drawing.entities.map((e) => [e.id, e.layer]),
    [
      ["line", "0"],
      ["view", "0"],
    ],
  );
  assert.deepEqual(drawing.layouts, [{ name: "A", paper: "ARCH D", viewports: [], entities: [] }]);
});

test("lint repeats every layout rule for a drawing built another way", () => {
  const base = sheet();
  const [good] = base.layouts as [Layout];
  const rules = (layouts: unknown, over: Partial<Drawing> = {}): string[] =>
    lint({ ...base, ...over, layouts } as Drawing).map(
      (d) => `${d.severity} ${d.rule}: ${d.message}`,
    );
  const one = (layouts: unknown, over?: Partial<Drawing>): string => {
    const found = rules(layouts, over);
    assert.equal(found.length, 1, found.join("\n"));
    return found[0]!;
  };
  assert.match(one(5), /error layout: layouts must be an array/);
  assert.match(one([null]), /error layout: layouts\[0\] must be a plain object/);
  assert.match(
    one([{ ...good, name: 7 }]),
    /error layout: Layout 7: A layout's name must be a string/,
  );
  assert.match(one([{ ...good, name: "model" }]), /cannot be named Model/);
  assert.match(one([{ ...good, paper: "A0" }]), /error layout: .*must be one of PAPERS/);
  assert.match(one([{ ...good, paper: null }]), /must be one of PAPERS/);
  assert.match(one([{ ...good, plotStyle: "x.ctb" }]), /error layout: .*plot style table/);
  assert.match(one([{ ...good, plotStyle: null }]), /plot style table/);
  assert.match(one([{ ...good, viewports: null }]), /layouts\[0\].viewports must be an array/);
  assert.match(one([{ ...good, entities: {} }]), /layouts\[0\].entities must be an array/);
  assert.match(
    one([{ ...good, viewports: [null] }]),
    /error viewport: layouts\[0\]\.viewports\[0\] must be a plain object/,
  );
  const [view] = good.viewports;
  const withView = (over: object): unknown => [{ ...good, viewports: [{ ...view, ...over }] }];
  assert.match(one(withView({ ratio: 0 })), /error viewport: .*ratio must be greater than 0/);
  assert.match(one(withView({ ratio: "120" })), /ratio must be a finite number/);
  assert.match(one(withView({ width: 0 })), /width: This value must be greater than 0/);
  assert.match(one(withView({ center: [1] })), /center must be a point/);
  assert.match(one(withView({ layer: "NOPE" })), /error undefined-layer: .*"NOPE" is not defined/);
  assert.match(one(withView({ layer: null })), /a layer is named by a string/);
  assert.match(one(withView({ id: "wall" })), /error duplicate-id: /);
  assert.match(one(withView({ id: 5 })), /error id: /);
  // Two layouts AutoCAD takes for one, and an entity of a layout that breaks an entity's rule.
  assert.match(
    one([good, { ...good, name: "a-101", viewports: [], entities: [] }]),
    /error duplicate-layout: Layout "a-101": .*as "A-101"/,
  );
  assert.match(
    one([{ ...good, entities: [{ kind: "circle", layer: "0", center: [0, 0], radius: -1 }] }]),
    /error geometry: circle #0 of layout "A-101": radius/,
  );
  assert.match(
    one([good], {
      dxf: "R12",
      blocks: [],
      linetypes: [],
      layers: [{ name: "0", color: 7 }],
      entities: [],
    }),
    /no layouts to R12/,
  );
  assert.throws(() => toDXF({ ...base, layouts: [{ ...good, paper: "A0" }] }), DrawingError);
  // What lint can see of a view: one that reaches past the paper, and one with nothing in it.
  assert.match(
    one(withView({ corner: [10, 10] })),
    /warning viewport: .*past the paper, which is 36 by 24/,
  );
  assert.match(
    one(withView({ center: [9000, 0] })),
    /warning viewport: .*shows none of the drawing/,
  );
  assert.match(one([good], { entities: [] }), /shows none of the drawing/);
});

test("toSVG draws a layout as it plots: the sheet, each view clipped at its scale, pens on paper", () => {
  const drawing = sheet();
  const svg = toSVG(drawing, { layout: "a-101" });
  // The picture is the paper, in its units, and white.
  assert.match(svg, /viewBox="0 -24 36 24" data-layout="A-101" data-paper="ARCH D">/);
  assert.match(svg, /<rect x="0" y="-24" width="36" height="24" fill="#ffffff"\/>/);
  // The default pen is 0.25 mm of paper, in inches.
  assert.match(svg, /<g transform="scale\(1 -1\)" fill="none" stroke-width="0.009843">/);
  // The view: clipped to its rectangle, a tenth of an inch to the foot, about its center.
  assert.match(
    svg,
    /<clipPath id="tsdraft-viewport-0"><rect x="1" y="1" width="34" height="22"\/>/,
  );
  assert.match(svg, /<g data-viewport="0" data-id="plan" clip-path="url\(#tsdraft-viewport-0\)">/);
  assert.match(
    svg,
    /<g transform="translate\(18 12\) scale\(0.1\) translate\(-170 -110\)" stroke-width="0.0984251968504">/,
  );
  // Inside it a 0.5 mm line is 0.5 mm on the paper, black under monochrome.ctb, and its
  // dashes are as long on the paper as the pattern: 0.5 of an inch is 5 feet of model space.
  const wall =
    /<path d="M 100 100 L 105 100 M 107.5 100[^"]*" stroke="#000000" stroke-width="0.196850393701" [^>]*data-id="wall"\/>/;
  assert.match(svg, wall);
  // The border of the viewport is on a layer that does not plot, so it is not drawn.
  assert.doesNotMatch(svg, /data-viewport-border/);
  assert.match(
    toSVG(drawing, { layout: "A-101", drawNoPlot: true }),
    /<rect x="1" y="1" width="34" height="22" stroke="#000000" stroke-width="0.001969" data-layer="VIEW" data-viewport-border="0" data-id="plan"\/>/,
  );
  // What is on the sheet is drawn in paper units, after the views.
  assert.match(
    svg,
    /<polygon points="0.5,0.5 35.5,0.5 35.5,23.5 0.5,23.5" stroke="#000000" data-layer="0" data-entity="0" data-id="border"\/>/,
  );
  assert.match(svg, /data-block="TAG">\n      <text [^>]*>A-101<\/text>/);
  assert.ok(svg.indexOf("data-viewport=") < svg.indexOf('data-id="border"'));
  // acad.ctb plots each pen in its color, and index 7 black.
  const colored = toSVG(
    { ...drawing, layouts: [{ ...drawing.layouts![0]!, plotStyle: "acad.ctb" }] },
    { layout: "A-101" },
  );
  assert.match(colored, /stroke="#ff0000" stroke-width="0.196850393701" [^>]*data-id="wall"/);
  assert.match(colored, /stroke="#000000" data-layer="0" data-entity="0" data-id="border"/);
  assert.throws(() => toSVG(drawing, { layout: "Nope" }), RangeError);
  // Model space is drawn as it was.
  assert.doesNotMatch(toSVG(drawing), /data-layout|border/);
  assert.equal(PAPERS["ARCH D"].media, "ARCH_full_bleed_D_(36.00_x_24.00_Inches)");
});

test("a view keeps its scale and its place when the scale is small or the model is far off", () => {
  /** Where the picture of a sheet puts a point of model space, from the viewport's transform. */
  const placed = (drawing: Drawing, point: readonly [number, number]): [number, number] => {
    const svg = toSVG(drawing, { layout: "S" });
    const [, cx, cy, scale, tx, ty] =
      /transform="translate\((\S+) (\S+)\) scale\((\S+)\) translate\((\S+) (\S+)\)"/
        .exec(svg)!
        .map(Number);
    return [cx! + scale! * (point[0] + tx!), cy! + scale! * (point[1] + ty!)];
  };
  const close = (got: readonly number[], want: readonly number[]): void => {
    got.forEach((value, i) =>
      assert.ok(Math.abs(value - want[i]!) < 1e-9, `${got} is not ${want}`),
    );
  };
  const one = (units: "mm" | "ft", center: [number, number], ratio: number): Drawing => {
    const d = createDrawing({ units });
    d.line(center, [center[0] + 1, center[1] + 1]);
    d.layout("S", { paper: "ARCH D" }, (page) => page.viewport([0, 0], 10, 10, { center, ratio }));
    return d.build();
  };
  // Millimetres at 1:500 on paper in inches: 12,700 mm of the model take one inch.
  close(placed(one("mm", [0, 0], 500), [127000, 0]), [15, 5]);
  close(placed(one("mm", [0, 0], 1000), [254000, -127000]), [15, 0]);
  // A view a million units from the origin is still centered on its rectangle.
  close(placed(one("mm", [1000000, 0], 50), [1000000, 0]), [5, 5]);
  close(placed(one("mm", [1000000, 0], 50), [1001270, 1270]), [6, 6]);
  // A default pen is 0.25 mm of paper at any scale: its width in model units times the scale.
  const svg = toSVG(one("mm", [0, 0], 1000), { layout: "S" });
  const [, scale, width] = /scale\((\S+)\) [^>]*stroke-width="(\S+)"/.exec(svg)!.map(Number);
  assert.ok(Math.abs(scale! * width! - 0.25 / 25.4) < 1e-12);
});

test("a view draws all that may show in it, and a clipped group always holds its own rectangle", () => {
  const view = (
    model: (d: ReturnType<typeof createDrawing>) => void,
    corner: [number, number] = [0, 0],
    size = 10,
    center: [number, number] = [0, 0],
  ): string => {
    const d = createDrawing();
    model(d);
    d.layout("S", { paper: "ARCH D" }, (page) =>
      page.viewport(corner, size, size, { center, ratio: 12 / size }),
    );
    return toSVG(d.build(), { layout: "S" });
  };
  const clipped = /<g data-viewport="0" clip-path="url\(#tsdraft-viewport-0\)">\n/.source;
  const keeper = (x: number, y: number, width: number, height: number): RegExp =>
    new RegExp(
      `${clipped}      <rect x="${x}" y="${y}" width="${width}" height="${height}" visibility="hidden" stroke="#000000"/>\n`,
    );
  // An arc and a circle whose boxes reach the view and whose lines do not: both are drawn,
  // and the hidden rectangle keeps the group on the picture.
  const far = view((d) => {
    d.arc([0, 0], 80, 10, 20, { id: "arc" });
    d.circle([0, 0], 1e6, { id: "circle" });
  });
  assert.match(far, keeper(0, 0, 10, 10));
  assert.match(far, /data-id="arc"/);
  assert.match(far, /data-id="circle"/);
  // The rectangle is the part of the view on the paper.
  assert.match(
    view((d) => d.line([2, -4], [3, -3]), [-4, 20]),
    keeper(0, 20, 6, 4),
  );
  // A view with nothing in it, and one wholly off the paper, have no clipped group.
  for (const empty of [
    view(() => {}),
    view((d) => d.line([500, 0], [600, 0])),
    view((d) => d.line([0, 0], [1, 1]), [40, 0]),
  ]) {
    assert.match(empty, /<g data-viewport="0"\/>/);
    assert.doesNotMatch(empty, /clip/);
  }
  // A wide pen whose line is just outside the view reaches into it.
  assert.match(
    view(
      (d) => d.line([-0.01, 0.1], [-0.01, 0.9], { lineweight: 0.7, id: "pen" }),
      [1, 1],
      1,
      [0.5, 0.5],
    ),
    /data-id="pen"/,
  );
  // So does a turned text that starts outside it, whatever the width of its letters.
  assert.match(
    view((d) => d.text([-11.75, -22], "TITLE", { height: 8, rotation: 45, id: "title" })),
    /data-id="title"/,
  );
});

test("a viewport lint refuses is drawn as its border, with no view", () => {
  const d = createDrawing();
  d.line([0, 0], [1, 1]);
  d.layout("S", { paper: "ARCH D" }, (page) =>
    page.viewport([1, 1], 4, 4, { center: [0, 0], ratio: 1 }),
  );
  const drawing = d.build();
  for (const ratio of [0, -1]) {
    const layout = drawing.layouts![0]!;
    const refused = { ...layout, viewports: [{ ...layout.viewports[0]!, ratio }] };
    const svg = toSVG({ ...drawing, layouts: [refused] }, { layout: "S" });
    assert.match(svg, /<g data-viewport="0"\/>/);
    assert.doesNotMatch(svg, /clip|data-entity/);
    assert.match(svg, /<rect x="1" y="1" width="4" height="4" [^>]*data-viewport-border="0"\/>/);
  }
});

test("a sheet of many entities and many blocks is drawn without a pass over the blocks for each", () => {
  const d = createDrawing();
  for (let b = 0; b < 1000; b++) d.block(`B${b}`, {}, () => d.line([0, 0], [1, 1]));
  for (let i = 0; i < 40_000; i++) {
    const [x, y] = [i % 200, Math.floor(i / 200)];
    d.line([x, y], [x + 0.5, y + 0.5]);
  }
  d.layout("S", { paper: "ARCH D" }, (page) => {
    for (let v = 0; v < 4; v++) {
      page.viewport([1 + v * 8, 1], 7, 7, { center: [v * 50, 50], ratio: 12 });
    }
  });
  const drawing = d.build();
  const start = performance.now();
  toSVG(drawing, { layout: "S" });
  // About 0.1 s. With the blocks looked through again for each entity it was over 4 s.
  assert.ok(performance.now() - start < 2000);
});

test("a view is drawn only where it can be seen: on the paper and in the picture, as written", () => {
  const one = (
    corner: [number, number],
    width: number,
    height: number,
    ratio: number,
    line: [number, number],
    margin = 0,
  ): string => {
    const d = createDrawing();
    d.line(line, [line[0] + 1, line[1] + 1], { id: "line" });
    d.layout("S", { paper: "ARCH D" }, (page) =>
      page.viewport(corner, width, height, { center: [0, 0], ratio }),
    );
    return toSVG(d.build(), { layout: "S", margin });
  };
  const empty = (svg: string): void => {
    assert.match(svg, /<g data-viewport="0"\/>/);
    assert.doesNotMatch(svg, /clip|data-id="line"/);
  };
  // The part on the paper is narrower than the last decimal written, so it has no width.
  empty(one([-200.000149, 0], 200.000149, 10, 1, [0, 0]));
  // A margin below 0 leaves the viewport outside the picture.
  const cropped = one([0, 0], 1, 1, 1, [0, 0], -11);
  assert.match(cropped, /viewBox="11 -13 14 2"/);
  empty(cropped);
  // A line under the part of a viewport that is off the paper is not drawn, and the clip is
  // the part on the paper.
  const wide = (line: [number, number]): string => one([-1000000, 0], 1000010, 10, 12, line);
  empty(wide([-1000, 0]));
  const kept = wide([6000000, 0]);
  assert.match(
    kept,
    /<clipPath id="tsdraft-viewport-0"><rect x="0" y="0" width="10" height="10"\/>/,
  );
  assert.match(kept, /<rect x="0" y="0" width="10" height="10" visibility="hidden"/);
  assert.match(kept, /data-id="line"/);
  // A margin that cuts into a viewport cuts its clip too.
  assert.match(
    one([0, 0], 4, 4, 1, [0, 0], -1),
    /<rect x="1" y="1" width="3" height="3" visibility="hidden"/,
  );
});

test("a view of a layout is the picture: a viewport is cut to it, or left out when it misses", () => {
  const d = createDrawing();
  d.line([0, 0], [10, 10], { id: "line" });
  d.layout("S", { paper: "ARCH D" }, (page) => {
    page.viewport([2, 2], 10, 10, { center: [5, 5], ratio: 1, id: "plan" });
    page.viewport([20, 2], 4, 4, { center: [5, 5], ratio: 1, id: "key" });
    d.text([30, 20], "NOTE", { height: 0.25, id: "note" });
  });
  const drawing = d.build();
  // Over a corner of the first viewport: the clip and its hidden rectangle are the part seen.
  const corner = toSVG(drawing, { layout: "S", view: [8, 9, 16, 15] });
  assert.match(corner, /viewBox="8 -15 8 6" data-layout="S"/);
  assert.match(
    corner,
    /<clipPath id="tsdraft-viewport-0"><rect x="8" y="9" width="4" height="3"\/>/,
  );
  assert.match(corner, /<rect x="8" y="9" width="4" height="3" visibility="hidden"/);
  assert.match(corner, /<g data-viewport="1" data-id="key"\/>/);
  // Over the note alone, it misses every viewport: no view is drawn and nothing is clipped.
  const note = toSVG(drawing, { layout: "S", view: [29, 19, 35, 21] });
  assert.match(note, /viewBox="29 -21 6 2"/);
  assert.match(note, /<g data-viewport="0" data-id="plan"\/>\s*<rect[^>]*data-viewport-border="0"/);
  assert.match(note, /<g data-viewport="1" data-id="key"\/>/);
  assert.doesNotMatch(note, /clip|data-id="line"/);
  assert.match(note, /data-id="note"/);
  // A view may lie off the paper.
  assert.match(toSVG(drawing, { layout: "S", view: [-10, -10, -5, -5] }), /viewBox="-10 5 5 5"/);
  assert.throws(() => toSVG(drawing, { layout: "S", view: [0, 0, 0, 0] }), RangeError);
});

test("a slanted text that leans into a view is drawn in it, and counts as shown", () => {
  const d = createDrawing();
  d.textStyle({ name: "LEAN", font: "Arial", obliqueAngle: 85 });
  d.text([-5, 0], "M", { height: 1, style: "LEAN", id: "lean" });
  d.block("TAG", {}, () => d.text([0, 0], "M", { height: 1, style: "LEAN" }));
  d.insert("TAG", [-5, 0], { id: "tag" });
  d.layout("S", { paper: "ARCH D" }, (page) =>
    page.viewport([1, 1], 1, 1, { center: [0, 0.5], ratio: 1 }),
  );
  const drawing = d.build();
  assert.deepEqual(lint(drawing), []);
  const svg = toSVG(drawing, { layout: "S" });
  assert.match(svg, /data-id="lean"/);
  assert.match(svg, /data-id="tag"/);
});

test("a border is an xref placed on a layout alone, with the sheet's fields over it", () => {
  const b = createDrawing({ units: "in" });
  b.rect([0.5, 0.5], 35, 23).text([29, 3], "FIRM", { height: 0.25 });
  const d = createDrawing({ units: "ft" });
  d.xref("BORDER", "border.dwg");
  d.block("FIELDS", {}, () => d.attribute("SHEET", [34, 1], { value: "-", height: 0.5 }));
  d.layout("C-101", { paper: "ARCH D" }, () => {
    d.insert("BORDER", [0, 0]);
    d.insert("FIELDS", [0, 0], { attributes: { SHEET: "C-101" } });
  });
  const sheet = d.build();
  // An xref that only a layout places is placed: nothing warns that AutoCAD will purge it.
  assert.deepEqual(lint(sheet), []);
  // The preview draws the border on the paper at the insert's scale, under the field, and
  // none of it in the picture of model space.
  const svg = toSVG(sheet, { layout: "C-101", xrefs: { BORDER: b.build() } });
  assert.match(
    svg.replaceAll(/\n\s*/g, ""),
    /data-block="BORDER" data-xref="border.dwg"><polygon points="0.5,0.5 35.5,0.5 35.5,23.5 0.5,23.5"[^>]*\/><text [^>]*>FIRM<\/text><\/g><g [^>]*data-block="FIELDS"><text [^>]*>C-101</,
  );
  assert.doesNotMatch(toSVG(sheet, { xrefs: { BORDER: b.build() } }), /FIRM|C-101/);
});
