import assert from "node:assert/strict";
import { test } from "node:test";
import sheet, { sitePlan, standard } from "../examples/site-plan.ts";
import {
  BUILT_IN_STANDARD,
  createDrawing,
  defineStandard,
  fromJSON,
  lint,
  toJSON,
  type Block,
  type Diagnostic,
  type Drawing,
  type Entity,
  type Point,
  type Insert,
  type LintOptions,
  type Standard,
} from "../src/index.ts";
import { isString } from "../src/guards.ts";
import { guarded, lintStandard } from "../src/standard/lint.ts";
import { within } from "./time-limit.ts";
import {
  copies,
  dataOf,
  isData,
  ofKind,
  recordsIn,
  wrong,
  type Data,
  type Field,
} from "./values.ts";

const layout = sheet.layouts![0]!;
const titleBlock = ofKind(layout.entities[0], "insert");

const rules = (drawing: Drawing, options: LintOptions = { standard }): string[] =>
  lint(drawing, options).map((d) => d.rule);

/** The example with model space or its sheet changed. */
const withModel = (entities: readonly Entity[]): Drawing => ({ ...sheet, entities });

const withSheet = (change: Partial<typeof layout>): Drawing => ({
  ...sheet,
  layouts: [{ ...layout, ...change }],
});

const only = (found: readonly Diagnostic[], rule: string) => found.filter((d) => d.rule === rule);

const rulesWithin = (ms: number, drawing: Drawing, options: LintOptions = { standard }): string[] =>
  within(ms, () => rules(drawing, options));

test("the example sheet breaks no rule of its standard at either scale, nor from JSON", () => {
  for (const scale of ["1in-10ft", "1in-20ft"] as const) {
    assert.deepEqual(lint(sitePlan(scale).drawing, { standard }), []);
  }

  const asData: Standard = JSON.parse(JSON.stringify(standard));
  assert.deepEqual(lint(fromJSON(toJSON(sheet)), { standard: asData }), []);
});

test("a standard given as data is checked again, and one that does not check is one error", () => {
  for (const given of [
    { ...standard, minTextHeight: 0.07 },
    { ...standard, layers: 3 },
    { ...standard, extends: BUILT_IN_STANDARD },
    5,
  ]) {
    // SAFETY: a standard of the wrong shape on purpose, which lint must report.
    const found = lint(sheet, { standard: given as Standard });
    assert.deepEqual(
      found.map((d) => d.rule),
      ["standard"],
    );
    assert.match(found[0]!.message, /^The standard given to lint does not check/);
  }

  assert.match(
    lint(sheet, { standard: { ...standard, minTextHeight: 0.07 } })[0]!.message,
    /: hash: The standard's hash is not the hash of what it states/,
  );
  // Without a standard, lint holds the drawing to none of its rules.
  assert.deepEqual(
    lint(withModel([...sheet.entities, { kind: "line", layer: "0", from: [0, 0], to: [1, 1] }])),
    [],
  );
});

test("lint reports what the builder refuses under a standard, under the same rules", () => {
  const found = lint(
    {
      ...sheet,
      layers: [...sheet.layers, { name: "A-WALL", color: 2 }],
      entities: [
        ...sheet.entities,
        { kind: "line", layer: "0", from: [0, 0], to: [1, 1], lineweight: 0.6 },
        { kind: "text", layer: "C-ANNO-TEXT", at: [50, 50], height: 1, value: "A", rotation: 0 },
      ],
      textStyles: [...sheet.textStyles!, { name: "MINE", font: "Arial" }],
      dimensionStyles: [...sheet.dimensionStyles!, { ...sheet.dimensionStyles![0]!, name: "MINE" }],
    },
    { standard },
  );

  assert.deepEqual(
    found.map((d) => [d.rule, d.layer ?? d.textStyle ?? d.dimensionStyle ?? d.entity]),
    [
      ["layer-outside-standard", "A-WALL"],
      ["text-style-outside-standard", "MINE"],
      ["dimension-style-outside-standard", "MINE"],
      ["layer-outside-standard", sheet.entities.length],
      ["pen-outside-standard", sheet.entities.length],
      ["text-style-outside-standard", sheet.entities.length + 1],
    ],
  );
  assert.match(
    found[0]!.message,
    /^Layer "A-WALL" is not a layer of the standard "site-plan-example" version 1/,
  );
  const line = `line #${sheet.entities.length}`;
  assert.ok(
    found[3]!.message.startsWith(`${line}: Layer "0" is in every drawing and in no standard`),
  );
  assert.equal(
    found[4]!.message,
    `${line}: A lineweight of 0.6 mm is no pen of the standard. Its pens are bold 0.5, fine 0.18, heavy 0.7, light 0.25 and medium 0.35 mm. Give the entity a pen`,
  );
});

test("a layer, a linetype, a role's text style and a dimension style hold the standard's values", () => {
  const found = lint(
    {
      ...sheet,
      layers: sheet.layers.map((l) => (l.name === "C-PROP" ? { ...l, color: 3, plot: false } : l)),
      linetypes: sheet.linetypes!.map((l) =>
        l.name === "DASHED" ? { ...l, pattern: [1, -1] } : l,
      ),
      linetypeScale: 1,
      textStyles: sheet.textStyles!.map((s) =>
        s.name === "NOTE" ? { ...s, font: "romans.shx" } : s,
      ),
      dimensionStyles: sheet.dimensionStyles!.map((s) => ({ ...s, arrowSize: 0.2 })),
    },
    { standard },
  );

  assert.deepEqual(
    found.map((d) => d.message),
    [
      'Layer "C-PROP" has color 3, and the standard gives it color 7',
      'Layer "C-PROP" has plot false, and the standard gives it plot true',
      'Linetype "DASHED" has the pattern [1, -1], and the standard gives it [0.5, -0.25]',
      "The drawing's linetypeScale is 1, and the standard's is 0.5. Leave linetypeScale to the standard",
      'Text style "NOTE" has font "romans.shx", and the role "note" gives it font "Arial"',
      'Dimension style "DIMS-1in-10ft" has arrowSize 0.2, and the standard gives it arrowSize 0.125',
      'Dimension style "FEET-INCHES-1in-10ft" has arrowSize 0.2, and the standard gives it arrowSize 0.125',
    ],
  );
  assert.deepEqual(
    found.map((d) => d.rule),
    [
      "layer-differs-from-standard",
      "layer-differs-from-standard",
      "linetype-differs-from-standard",
      "linetype-differs-from-standard",
      "text-style-differs-from-standard",
      "dimension-style-differs-from-standard",
      "dimension-style-differs-from-standard",
    ],
  );
  // A dimension style at a scale writes the drawing's units, and the built-in one has no metres.
  const d = createDrawing({ units: "m" });
  const { textStyle: _, ...dims } = sheet.dimensionStyles![0]!;
  d.dimensionStyle(dims);
  assert.match(
    lint(d.build(), { standard: BUILT_IN_STANDARD }).find((x) => x.rule === "dimension-style")!
      .message,
    /has no writing for "m"/,
  );
});

test("a text plots at its role's height in each viewport that shows it, and at least the least", () => {
  const half = withModel(
    sheet.entities.map((e) =>
      e.kind === "text" && e.value === "EDGE OF PAVEMENT" ? { ...e, height: e.height / 2 } : e,
    ),
  );

  assert.deepEqual(
    lint(half, { standard }).map((d) => d.message),
    [
      `text #60: This text of the role "note" plots 0.047 in tall in viewport "plan" at 1" = 10', and the role is 0.094 in: it was sized for another scale. Draw it in the view of the viewport that shows it`,
      `text #60: This text plots 0.047 in tall in viewport "plan" at 1" = 10', below the standard's least height of 0.0625 in`,
    ],
  );
  // The model of the sheet at 1" = 10', shown at 1" = 20': every text and dimension is off.
  const far = rules(withSheet({ viewports: layout.viewports.map((v) => ({ ...v, ratio: 240 })) }));
  assert.ok(far.includes("height-off-role") && far.includes("dimension-off-scale"));
  assert.ok(!far.includes("scale-outside-standard"));
  // A viewport at a ratio of no scale of the standard.
  const odd = withSheet({ viewports: layout.viewports.map((v) => ({ ...v, ratio: 100 })) });
  assert.equal(rules(odd)[0], "scale-outside-standard");

  // On the sheet, a text an insert draws plots at the insert's scale. The title block's texts
  // have no role, and still plot at least the least height.
  const scaled = withSheet({
    entities: layout.entities.map((e) =>
      e.kind === "insert" && (e.block === "NORTH ARROW" || e === titleBlock)
        ? { ...e, scale: [0.5, 0.5] as const }
        : e,
    ),
  });

  const found = lint(scaled, { standard });
  assert.equal(
    only(found, "height-off-role")
      .map((d) => d.message)
      .join("\n"),
    layout.entities
      .flatMap((e, i) => (e.kind === "insert" && e.block === "NORTH ARROW" ? [i] : []))
      .map(
        (i) =>
          `insert #${i} of layout "C-101": The text "N" of its block of the role "heading" plots 0.094 in tall on layout "C-101", and the role is 0.188 in: a text on a layout plots at its height. Draw it in its role, and insert its block at a scale of 1`,
      )
      .join("\n"),
  );
  assert.ok(only(found, "height-below-standard").every((d) => d.entity === 0));
  assert.ok(only(found, "height-below-standard").length > 0);
});

test("a viewport holds a text to its scale where the text reaches into it, turned or not, and frozen layers out", () => {
  // The key plan is turned 30 degrees about [50, 70] and shows 260 feet across. The plan's
  // viewport shows x from -50 to 150. Both points are past the plan, and inside the box around
  // the key plan's turned rectangle: the first is in the rectangle, the second is not.
  const far = (at: Point, layer = "C-SETB"): Entity => ({
    kind: "text",
    layer,
    at,
    height: 0.01,
    value: "FAR",
    rotation: 0,
  });

  const found = (text: Entity) =>
    lint(withModel([...sheet.entities, text]), { standard })
      .filter((d) => d.rule === "height-below-standard")
      .map((d) => d.message);

  assert.match(found(far([170, 60])).join(), /in viewport "key-plan"/);
  assert.deepEqual(found(far([200, 230])), []);
  // A layer the key plan freezes shows nothing there.
  assert.deepEqual(found(far([170, 60], "C-ANNO-TEXT")), []);
});

test("a viewport whose fields are inherited is checked as one that holds them", () => {
  const plain = withSheet({});

  const inherited = withSheet({
    viewports: layout.viewports.map((v): typeof v => Object.create(v)),
  });

  assert.deepEqual(lint(inherited, { standard }), lint(plain, { standard }));
});

test("a dimension is shown at its style's scale", () => {
  const twenty = { ...sheet.dimensionStyles![0]!, name: "DIMS-1in-20ft", scale: 20 };

  const found = lint(
    {
      ...withModel(
        sheet.entities.map((e) =>
          e.kind === "linear-dimension" ? { ...e, style: twenty.name } : e,
        ),
      ),
      dimensionStyles: [...sheet.dimensionStyles!, twenty],
    },
    { standard },
  );

  // Every one of the seven dimensions, each now in the style for 1" = 20'.
  assert.equal(found.length, 7);
  assert.match(
    found[0]!.message,
    /^linear-dimension #36: It is in the dimension style "DIMS-1in-20ft", for 1" = 20', and is shown in viewport "plan" at 1" = 10'/,
  );
});

test("a dimension style whose id starts with a hyphen is found at each scale", () => {
  const dashed = defineStandard({
    id: "dashed",
    version: "1",
    extends: BUILT_IN_STANDARD,
    dimensionStyles: { "-x": BUILT_IN_STANDARD.dimensionStyles.dims },
  });

  const d = createDrawing({ units: "ft", standard: dashed });
  const plan = d.view("plan", { scale: "1in-10ft" });
  d.linearDimension([0, 0], [10, 0], [0, 5], { style: "-x", view: plan });
  const drawing = d.build();
  assert.equal(drawing.dimensionStyles![0]!.name, "-X-1in-10ft");
  const found = lint(drawing, { standard: dashed }).map((d) => d.rule);
  assert.ok(!found.includes("dimension-style-outside-standard"), found.join());
});

test("a layout is on a sheet format of its paper, with its title block and inside its area", () => {
  assert.deepEqual(rules(withSheet({ plotStyle: "acad.ctb" })), ["sheet-format-outside-standard"]);
  assert.deepEqual(rules(withSheet({ paper: "ARCH E" })).slice(-1), [
    "sheet-format-outside-standard",
  ]);
  assert.deepEqual(
    rules(
      withSheet({ viewports: layout.viewports.map((v, i) => (i === 0 ? { ...v, width: 30 } : v)) }),
    ),
    ["viewport-outside-drawing-area"],
  );
  assert.deepEqual(rules(withSheet({ entities: layout.entities.slice(1) })), [
    "title-block-missing",
  ]);
  const { DATE: _, ...rest } = titleBlock.attributes!;

  const fields = lint(
    withSheet({
      entities: [
        {
          ...titleBlock,
          attributes: {
            ...rest,
            PROJECT: "A PROJECT NAME FAR TOO LONG FOR THE FIELD IT IS WRITTEN IN",
            SHEET: "C-102",
          },
        },
        ...layout.entities.slice(1),
      ],
    }),
    { standard },
  );

  assert.deepEqual(
    fields.map((d) => [d.rule, d.entity]),
    [
      ["title-block-field-overflow", 0],
      ["title-block-field-unset", 0],
      ["layout", 0],
    ],
  );
  assert.match(
    fields[2]!.message,
    /^Under sheetFiles "one-drawing" a sheet's number is its layout's name, "C-101"/,
  );
});

test("a title block is the standard's when its block, text styles and linetypes are", () => {
  const found = lint(
    {
      ...sheet,
      blocks: sheet.blocks!.map((b) =>
        b.name === "TITLE BLOCK" ? { ...b, entities: b.entities.slice(1) } : b,
      ),
    },
    { standard },
  );

  assert.equal(found[0]!.rule, "title-block-differs-from-standard");
  assert.equal(
    found[0]!.message,
    'The title block "plain" of the standard: its block "TITLE BLOCK" is not the standard\'s. Place it with sheet.titleBlock(), which copies it from the standard',
  );
  // Read as any other block, its texts have no role.
  assert.ok(
    found
      .slice(1)
      .every((d) => d.rule === "text-style-outside-standard" && d.block === "TITLE BLOCK"),
  );
  // A field of no definition makes it another, however much the field holds when written out.
  let extra: Field = "A";

  for (let i = 0; i < 40; i++) extra = [extra, extra];
  const [first, ...rest] = sheet.blocks!.find((b) => b.name === "TITLE BLOCK")!.entities;

  for (const change of [
    { extra },
    { entities: [wrong<Entity>({ ...dataOf(first!), extra }), ...rest] },
  ]) {
    const changed: Drawing = {
      ...sheet,
      blocks: sheet.blocks!.map((b) => (b.name === "TITLE BLOCK" ? { ...b, ...change } : b)),
    };

    assert.ok(rulesWithin(1000, changed).includes("title-block-differs-from-standard"));
  }
});

test("a layout's sheet format is the one on its paper whose title block it inserts", () => {
  const plain = BUILT_IN_STANDARD.titleBlocks.plain;

  const two = defineStandard({
    id: "two",
    version: "1",
    extends: standard,
    titleBlocks: {
      other: {
        ...plain,
        blockName: "OTHER",
        block: {
          ...plain.block!,
          blocks: plain.block!.blocks!.map((b) => ({ ...b, name: "OTHER" })),
        },
      },
    },
    sheetFormats: { "arch-d-other": { paper: "ARCH D", titleBlock: "other" } },
  });

  assert.deepEqual(rules(sheet, { standard: two }), []);
  assert.deepEqual(rules(withSheet({ entities: layout.entities.slice(1) }), { standard: two }), [
    "sheet-format-ambiguous",
  ]);
});

test("among sheet formats that share a title block, a layout's is told by its plot style table", () => {
  const color = defineStandard({
    id: "color",
    version: "1",
    extends: standard,
    sheetFormats: {
      "arch-d-color": { paper: "ARCH D", titleBlock: "plain", plotStyle: "acad.ctb" },
    },
  });

  assert.deepEqual(rules(sheet, { standard: color }), []);
  assert.deepEqual(rules(withSheet({ plotStyle: "acad.ctb" }), { standard: color }), []);
  // A table of neither is reported, and the layout is still checked against the title block.
  const wide = { ...layout.viewports[0]!, corner: [0, 0] as const };

  const found = lint(withSheet({ plotStyle: "Grayscale.ctb", viewports: [wide] }), {
    standard: color,
  });

  assert.deepEqual(
    found.map((d) => d.rule),
    ["sheet-format-outside-standard", "viewport-outside-drawing-area"],
  );
  assert.match(found[1]!.message, /the sheet formats "arch-d" and "arch-d-color", \[/);
});

test("under sheet-per-file a drawing has one layout, and its number names a file", () => {
  const perFile = defineStandard({
    id: "per-file",
    version: "1",
    extends: standard,
    sheetFiles: "sheet-per-file",
  });

  const second = {
    ...layout,
    name: "C-102",
    viewports: [],
    entities: [
      {
        ...titleBlock,
        id: "C-102.title-block",
        attributes: { ...titleBlock.attributes, SHEET: "C/102" },
      },
    ],
  };

  // A second layout is reported when the first cannot be read.
  assert.deepEqual(
    lint({ ...sheet, layouts: [wrong(5), layout] }, { standard: perFile })
      .filter((d) => d.rule === "sheet-per-file")
      .map((d) => d.layout),
    [layout.name],
  );
  const found = lint({ ...sheet, layouts: [layout, second] }, { standard: perFile });
  assert.deepEqual(
    found.map((d) => [d.rule, d.layout]),
    [
      ["sheet-per-file", "C-102"],
      ["sheet-per-file", "C-102"],
    ],
  );
  assert.match(
    found[0]!.message,
    /^Layout "C-102": Under sheetFiles "sheet-per-file" a drawing is one sheet/,
  );
  assert.match(
    found[1]!.message,
    /^Under sheetFiles "sheet-per-file" a sheet's number names its file/,
  );
});

test("an entry with fields by discipline is checked in the drawing's discipline", () => {
  const perFile = defineStandard({
    id: "per-file",
    version: "1",
    extends: standard,
    sheetFiles: "sheet-per-file",
    layers: {
      "C-PROP": { color: 7, linetype: "PHANTOM", pen: "heavy", byDiscipline: { C: { color: 1 } } },
    },
  });

  assert.deepEqual(rules(sheet, { standard: perFile }), ["discipline-unknown"]);
  assert.deepEqual(rules(sheet, { standard: perFile, discipline: "c" }), [
    "layer-differs-from-standard",
  ]);
  assert.deepEqual(rules(sheet, { standard: perFile, discipline: "V" }), []);
  assert.deepEqual(rules(sheet, { standard: perFile, discipline: "Q" }), [
    "standard",
    "discipline-unknown",
  ]);
  assert.deepEqual(rules(sheet, { standard, discipline: "C" }), ["standard"]);
});

test("the checks of heights stop at a limit, and say so", () => {
  const pile: Entity[] = Array.from({ length: 2000 }, () => ({
    kind: "text",
    layer: "C-ANNO-TEXT",
    at: [50, 45],
    height: 0.9375,
    value: "PILE",
    rotation: 0,
    style: "NOTE",
  }));

  const { id: _, ...viewport } = layout.viewports[0]!;
  const viewports = Array.from({ length: 300 }, () => viewport);
  const started = performance.now();

  const found = rules({
    ...withModel([...sheet.entities, ...pile]),
    layouts: [{ ...layout, viewports }],
  });

  const ms = performance.now() - started;
  assert.ok(ms < 1000, `${ms} ms`);
  assert.deepEqual(found, ["standard-check-capped"]);
});

test("layouts that share one list pay for it, so their checks stop at the limit", () => {
  const lines = Array.from({ length: 20_000 }, (_, i): Entity => ({
    kind: "line",
    layer: titleBlock.layer,
    from: [i, 0],
    to: [i, 1],
  }));

  const shared = { ...layout, entities: [...layout.entities, ...lines] };
  const out: Diagnostic[] = [];
  within(5000, () =>
    lintStandard(
      { ...sheet, layouts: Array(3000).fill(shared) },
      standard,
      undefined,
      "R2018",
      out,
    ),
  );
  assert.deepEqual(
    out.map((d) => d.rule),
    ["standard-check-capped"],
  );
});

test("a text that inserts within inserts scale to nothing plots no height", () => {
  const blocks: Block[] = [
    {
      name: "T0",
      base: [0, 0],
      entities: [{ kind: "text", layer: "0", at: [0, 0], height: 0.1, value: "TINY", rotation: 0 }],
    },
  ];

  for (let i = 1; i <= 60; i++) {
    blocks.push({
      name: `T${i}`,
      base: [0, 0],
      entities: [
        { kind: "insert", layer: "0", block: `T${i - 1}`, at: [0, 0], scale: [1e-6, 1e-6] },
      ],
    });
  }

  const tiny: Insert = { kind: "insert", layer: titleBlock.layer, block: "T60", at: [5, 5] };

  const found = lint(
    {
      ...sheet,
      blocks: [...sheet.blocks!, ...blocks],
      layouts: [{ ...layout, entities: [...layout.entities, tiny] }],
    },
    { standard },
  );

  assert.match(
    only(found, "height-below-standard")[0]?.message ?? "",
    /"TINY" of its block plots 0 in tall/,
  );
});

test("a check that throws on a value another rule reports is left out, and a bug is not", () => {
  assert.equal(
    guarded(() => {
      throw new RangeError("a value another rule reports");
    }),
    undefined,
  );
  assert.throws(
    () =>
      guarded(() => {
        throw new TypeError("a bug");
      }),
    TypeError,
  );
});

test("the walk of an insert enters what can draw a text, and pays for each item and name", () => {
  /** 25 blocks that each insert the one below twice, so the last draws `leaf` 2^24 times. */
  const tree = (leaf: Entity, prefix = "", layer = "C-PROP") => {
    const blocks: Block[] = [{ name: `${prefix}B0`, base: [0, 0], entities: [leaf] }];

    for (let i = 1; i < 25; i++) {
      const insert: Insert = { kind: "insert", layer, block: `${prefix}B${i - 1}`, at: [0, 0] };
      blocks.push({
        name: `${prefix}B${i}`,
        base: [0, 0],
        entities: [insert, { ...insert, at: [1, 0] }],
      });
    }

    const top: Insert = { kind: "insert", layer: "C-PROP", block: `${prefix}B24`, at: [0, 0] };

    return { blocks: [...sheet.blocks!, ...blocks], top };
  };

  // A tree of lines draws no text, so the walk does not enter it, and the text after it is checked.
  const lines = tree({ kind: "line", layer: "0", from: [0, 0], to: [1, 1] });

  const note = ofKind(
    layout.entities.find((e) => e.kind === "text" && e.style === "NOTE"),
    "text",
  );

  const { id: _, ...twice } = { ...note, height: note.height * 2 };

  const sheetTree: Drawing = {
    ...withSheet({ entities: [...layout.entities, lines.top, twice] }),
    blocks: lines.blocks,
  };

  assert.deepEqual(rulesWithin(3000, sheetTree), ["height-off-role"]);
  // No layout, whose viewports have the other rules walk the inserts of model space.
  const long = "A".repeat(10_000);

  const text = (value: string): Entity => ({
    kind: "text",
    layer: "0",
    at: [0, 0],
    height: 1,
    value,
    rotation: 0,
    style: "NOTE",
  });

  for (const { blocks, top } of [tree(text(long)), tree(text("A"), long, `L-${long}`)]) {
    const found = rulesWithin(3000, { ...sheet, entities: [top], blocks, layouts: [] });
    assert.equal(found.at(-1), "standard-check-capped");
  }
});

test("lint stops at the first empty slot of a list, as the other rules do", () => {
  // oxlint-disable-next-line unicorn/no-new-array
  const slots = () => new Array(2 ** 32 - 1);
  const holed: Block = { name: "HOLED", base: [0, 0], entities: [], attributes: slots() };

  for (const drawing of [
    { ...sheet, layers: slots() },
    { ...sheet, entities: slots() },
    { ...sheet, blocks: slots() },
    { ...sheet, blocks: [...sheet.blocks!, holed] },
    { ...sheet, layouts: slots() },
    withSheet({ entities: slots() }),
    withSheet({ viewports: slots() }),
  ]) {
    assert.ok(rulesWithin(1000, drawing).length > 0);
  }

  const asData: Standard = JSON.parse(JSON.stringify(standard));
  assert.deepEqual(rulesWithin(1000, sheet, { standard: { ...asData, chain: slots() } }), [
    "standard",
  ]);
});

/** Numbers from 0 up to 1, the same from one seed on every run. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("the checks of a standard stay bounded on any data, and never throw", () => {
  const random = seeded(4);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const long = "W".repeat(20_000);
  const data = JSON.stringify(standard);

  /** A value that is small in memory and 2^40 times its size written out. */
  const doubled = (): Field => {
    let value: Field = pick([long, 0, null]);

    for (let i = 0; i < 40; i++) value = random() < 0.5 ? [value, value] : { a: value, b: value };

    return value;
  };

  const cyclic = (): Field => {
    const value: Data = { name: long };
    value.self = value;

    return value;
  };

  const hostile = (): Field =>
    pick([doubled, cyclic, () => long, () => null, () => -1, () => NaN, () => ({}), () => []])();

  /** A list of `item` that is all empty slots, has a hole, or holds it many times. */
  const listed = (item: Field): Field[] => {
    const holed = [item, item, item];
    delete holed[1];

    // oxlint-disable-next-line unicorn/no-new-array
    return pick([() => new Array(2 ** 32 - 1), () => holed, () => new Array(500).fill(item)])();
  };

  const prefix = "P".repeat(400_000);
  // A standard with 800 dimension styles and 800 scales, which name 640,800 dimension styles.
  const dims = BUILT_IN_STANDARD.dimensionStyles.dims;

  const wide = JSON.stringify(
    defineStandard({
      id: "wide",
      version: "1",
      extends: BUILT_IN_STANDARD,
      scales: Object.fromEntries(
        Array.from({ length: 800 }, (_, i) => [`s${i}`, { label: `S${i}`, ratio: 1000 + i }]),
      ),
      dimensionStyles: Object.fromEntries(Array.from({ length: 800 }, (_, i) => [`d${i}`, dims])),
    }),
  );

  for (let n = 0; n < 40; n++) {
    const blocks = sheet.blocks!.map((b): Data => ({
      ...dataOf(b),
      entities: copies(b.entities),
      attributes: copies(b.attributes),
    }));

    const layoutEntities = copies(layout.entities);

    const sheetLayout: Data = {
      ...dataOf(layout),
      entities: layoutEntities,
      viewports: copies(layout.viewports),
    };

    const entities = copies(sheet.entities);
    const dimensionStyles = copies(sheet.dimensionStyles);

    const drawing: Data = {
      ...dataOf(sheet),
      layers: copies(sheet.layers),
      linetypes: copies(sheet.linetypes),
      textStyles: copies(sheet.textStyles),
      dimensionStyles,
      entities,
      blocks,
      layouts: [sheetLayout],
    };

    const lists: [Data, string][] = [
      ...[
        "layers",
        "linetypes",
        "textStyles",
        "dimensionStyles",
        "blocks",
        "layouts",
        "entities",
      ].map((field): [Data, string] => [drawing, field]),
      [drawing, "xrefs"],
      [sheetLayout, "entities"],
      [sheetLayout, "viewports"],
      ...blocks.flatMap((b): [Data, string][] => [
        [b, "entities"],
        [b, "attributes"],
      ]),
    ];

    // Trees of blocks, deep and wide, or one long chain, which may insert its own top.
    if (random() < 0.7) {
      const [depth, width] = pick([
        [20 + Math.floor(random() * 20), pick([2, 3])],
        [5000, 1],
      ]);

      // Long names on a short tree: a long chain of them is a large drawing written out.
      const prefix = depth < 100 ? pick(["", long]) : "";
      const layer = pick(["0", "C-PROP", long]);

      const top: Data = {
        kind: "insert",
        layer: "C-PROP",
        block: `${prefix}T`,
        at: [0, 0],
        attributes: { [pick(["TAG", long])]: pick(["V", long]) },
      };

      const text = {
        kind: "text",
        layer: pick(["0", long]),
        at: [0, 0],
        height: pick([1, 1e-9, 1e99]),
        value: pick(["A", long]),
        rotation: 0,
        style: pick(["NOTE", long]),
      };

      const definition = { tag: pick(["TAG", long]), value: pick(["V", long]), layer: "0" };
      const leaf = pick([text, { kind: "line", layer: "0", from: [0, 0], to: [1, 1] }, top]);

      const tree: Data[] = [
        {
          name: `${prefix}B0`,
          base: [0, 0],
          entities: [leaf],
          attributes: [{ ...definition, at: [0, 0], height: 1, rotation: 0, style: "NOTE" }],
        },
      ];

      for (let i = 1; i < depth; i++) {
        const insert = { kind: "insert", layer, block: `${prefix}B${i - 1}` };
        tree.push({
          name: `${prefix}B${i}`,
          base: [0, 0],
          entities: Array.from({ length: width }, (_, j) => ({ ...insert, at: [j, 0] })),
        });
      }

      tree.push({
        name: `${prefix}T`,
        base: [0, 0],
        entities: [{ kind: "insert", layer, block: `${prefix}B${depth - 1}`, at: [0, 0] }],
      });
      blocks.push(...tree);
      (random() < 0.5 ? entities : layoutEntities).push({ ...top });
    }

    // Many texts in many viewports.
    if (random() < 0.2) {
      const note = sheet.entities.find((e) => e.kind === "text")!;
      entities.push(...copies(Array.from({ length: 3000 }, () => note)));
      sheetLayout.viewports = copies(Array.from({ length: 300 }, () => layout.viewports[0]!));
    }

    // Many dimensions in a style with a long prefix, which every label reads.
    if (random() < 0.15) {
      const dimension = sheet.entities.find((e) => e.kind === "linear-dimension")!;
      entities.push(...copies(Array.from({ length: 400 }, () => dimension)));
      dimensionStyles[0]!.prefix = prefix;
    }

    // A field of something in the drawing: a long name, a value of the wrong type, or a field
    // nobody knows that is large written out.
    // A list the sheet does not have, such as its xrefs, holds no record.
    const records: Data[] = [drawing, sheetLayout, ...lists.flatMap(([o, f]) => recordsIn(o[f]))];

    for (const e of [...layoutEntities, ...entities]) {
      const { attributes } = e;

      if (isData(attributes)) records.push((e.attributes = { ...attributes }));
    }

    for (let changes = Math.floor(random() * 5); changes > 0; changes--) {
      const record = pick(records);
      const known = Object.keys(record);
      const kind = random();

      if (kind < 0.4 && known.length > 0) {
        const field = pick(known);
        const value = record[field];
        record[field] = isString(value) ? `${long}${value}` : long;
      } else if (kind < 0.7) record[pick(["extra", long])] = hostile();
      else if (known.length > 0) record[pick(known)] = hostile();
    }

    // A list that is all empty slots, has a hole, or holds one item many times.
    if (random() < 0.3) {
      const [owner, field] = pick(lists);
      const list = owner[field];
      owner[field] = listed(Array.isArray(list) && list.length > 0 ? pick(list) : hostile());
    }

    // The standard, as made or as data, or as data with a field changed, or the wide standard as
    // data, against the drawing or an empty one.
    const as = random();
    const parsed: Data | undefined = as < 0.4 ? undefined : JSON.parse(as < 0.5 ? wide : data);
    const given = parsed ?? standard;

    const checked =
      as >= 0.4 && as < 0.5 && random() < 0.5 ? { units: "ft", entities: [] } : drawing;

    if (as >= 0.7 && parsed) {
      const section = pick(Object.keys(parsed));
      const value = parsed[section];

      if (random() < 0.5 && isData(value)) {
        value[pick(["extra", long, ...Object.keys(value)])] = hostile();
      } else parsed[section] = random() < 0.5 ? hostile() : listed(value);
    }

    const discipline = pick([undefined, undefined, "C", long, 5]);

    const out: Diagnostic[] = [];

    try {
      within(1000, () => lintStandard(wrong(checked), given, discipline, undefined, out, 20_000));
    } catch (thrown) {
      assert.fail(`case ${n}: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
    }

    assert.ok(out.every((d) => isString(d.rule) && isString(d.message)));
  }
});

test("a viewport that shows what another view of its scale draws is warned of, once an entity", () => {
  /** Two elevations at 1/8" = 1'-0", the east one `apart` feet below the south one. */
  const elevations = (apart: number, frozenLayers?: string[]) => {
    const d = createDrawing({ units: "ft", standard: BUILT_IN_STANDARD });
    const south = d.view("south", { scale: "1-8in-1ft" });
    const east = d.view("east", { scale: "1-8in-1ft" });
    const plan = d.view("plan", { scale: "1-4in-1ft" });
    d.block("TAG", {}, () => {
      d.circle([0, 0], 0.125);
      d.text([0, 0], "1", { role: "note", align: "center", valign: "middle" });
      d.text([0, -0.2], "A", { role: "note", align: "center", valign: "top" });
    });
    d.layer("C-BLDG", () => {
      d.rect([0, 0], 40, 10);
      d.rect([0, -apart], 25, 14);
    });
    d.layer("C-ANNO-TEXT", () => {
      d.text([2, 2], "SOUTH", { role: "note", view: south, id: "south-text" });
      d.leader("STEEL PANELS", { view: south, at: [30, 14], to: [28, 8] });
      d.text([2, 2 - apart], "EAST", { role: "note", view: east });
      // Drawn for a view at another scale: the checks of scale report it, and this check does not.
      d.text([20, 4], "PLAN NOTE", { role: "note", view: plan });
    });
    d.layer("C-ANNO-SYMB", () => d.insert("TAG", [10, 5], { view: south }));
    d.layer("C-ANNO-DIMS", () => d.linearDimension([0, 0], [40, 0], [0, -3], { view: south }));
    d.layout("A-1", (sheet) => {
      d.layer("G-ANNO-NPLT", () => {
        sheet.viewport([1, 15], 8, 3, { view: south, center: [20, 5] });
        sheet.viewport([1, 8], 8, 6, {
          view: east,
          center: [20, 7 - apart],
          ...(frozenLayers && { frozenLayers }),
        });
      });
    });

    return d.build();
  };

  const near = elevations(20);
  assert.deepEqual(
    only(lint(near, { standard: BUILT_IN_STANDARD }), "viewport-shows-other-view").map((x) => [
      x.severity,
      x.message.split(":")[0],
      x.id,
    ]),
    [
      ["warning", "text #2", "south-text"],
      ["warning", "insert #6", undefined],
      ["warning", "leader #3", undefined],
      ["warning", "linear-dimension #7", undefined],
    ],
  );
  const found = lint(near, { standard: BUILT_IN_STANDARD });
  assert.match(
    only(found, "viewport-shows-other-view")[0]!.message,
    /^text #2: It is drawn for the view "south", and is shown in viewport "east" at 1\/8" = 1'-0", which shows another view at its scale\./,
  );
  assert.ok(found.some((x) => x.rule === "height-off-role" && x.message.startsWith("text #5")));

  // The elevations apart, or the layers of the south one's annotation frozen in the east viewport.
  for (const drawing of [
    elevations(60),
    elevations(20, ["C-ANNO-TEXT", "C-ANNO-SYMB", "C-ANNO-DIMS"]),
  ]) {
    assert.deepEqual(
      only(lint(drawing, { standard: BUILT_IN_STANDARD }), "viewport-shows-other-view"),
      [],
    );
  }

  // The builder keeps the view on the annotation it draws for one, and a reader of JSON keeps it.
  const kept = near.entities.flatMap((e) => ("view" in e && e.view ? [`${e.kind}:${e.view}`] : []));
  assert.deepEqual(kept, [
    "text:south",
    "leader:south",
    "text:east",
    "text:plan",
    "insert:south",
    "linear-dimension:south",
  ]);
  assert.deepEqual(fromJSON(toJSON(near)).entities, near.entities);

  // Without the field, as a drawing built before it or by other code, nothing is warned of.
  const bare = {
    ...near,
    entities: near.entities.map((e) => {
      // SAFETY: the builder keeps the view an annotation was drawn for, which Entity does not name.
      const { view: _, ...rest } = e as Entity & { view?: string };

      // SAFETY: an entity without its view field is still an entity of its kind.
      return rest as Entity;
    }),
  };

  assert.deepEqual(
    only(lint(bare, { standard: BUILT_IN_STANDARD }), "viewport-shows-other-view"),
    [],
  );
});
