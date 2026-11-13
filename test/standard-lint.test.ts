import assert from "node:assert/strict";
import { test } from "node:test";
import { Script } from "node:vm";
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
  type Insert,
  type LintOptions,
  type Standard,
  type Text,
} from "../src/index.ts";
import { lintStandard } from "../src/standard/lint.ts";

const layout = sheet.layouts![0]!;
const titleBlock = layout.entities[0] as Insert;
const rules = (drawing: Drawing, options: LintOptions = { standard }): string[] =>
  lint(drawing, options).map((d) => d.rule);
/** The example with model space or its sheet changed. */
const withModel = (entities: readonly Entity[]): Drawing => ({ ...sheet, entities });
const withSheet = (change: Partial<typeof layout>): Drawing => ({
  ...sheet,
  layouts: [{ ...layout, ...change }],
});
const only = (found: readonly Diagnostic[], rule: string) => found.filter((d) => d.rule === rule);

const linting = new Script("linting()");
const checking = new Script("checking()");
/** The rules `lint` reports with `options`, stopped after `ms`, so a run that never ends fails. */
const within = (ms: number, drawing: unknown, options: LintOptions = { standard }): string[] => {
  Object.assign(globalThis, { linting: () => rules(drawing as Drawing, options) });
  return linting.runInThisContext({ timeout: ms }) as string[];
};

test("the example sheet breaks no rule of its standard at either scale, nor from JSON", () => {
  for (const scale of ["1in-10ft", "1in-20ft"] as const) {
    assert.deepEqual(lint(sitePlan(scale).drawing, { standard }), []);
  }
  const data = JSON.parse(JSON.stringify(standard)) as Standard;
  assert.deepEqual(lint(fromJSON(toJSON(sheet)), { standard: data }), []);
});

test("a standard given as data is checked again, and one that does not check is one error", () => {
  for (const given of [
    { ...standard, minTextHeight: 0.07 },
    { ...standard, layers: 3 },
    { ...standard, extends: BUILT_IN_STANDARD },
    5,
  ]) {
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
      ["layer-outside-standard", 57],
      ["pen-outside-standard", 57],
      ["text-style-outside-standard", 58],
    ],
  );
  assert.match(
    found[0]!.message,
    /^Layer "A-WALL" is not a layer of the standard "site-plan-example" version 1/,
  );
  assert.match(found[3]!.message, /^line #57: Layer "0" is in every drawing and in no standard/);
  assert.equal(
    found[4]!.message,
    "line #57: A lineweight of 0.6 mm is no pen of the standard. Its pens are bold 0.5, fine 0.18, heavy 0.7, light 0.25 and medium 0.35 mm. Give the entity a pen",
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
      `text #50: This text of the role "note" plots 0.047 in tall in viewport "plan" at 1" = 10', and the role is 0.094 in: it was sized for another scale. Draw it in the view of the viewport that shows it`,
      `text #50: This text plots 0.047 in tall in viewport "plan" at 1" = 10', below the standard's least height of 0.0625 in`,
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
    `insert #${layout.entities.findIndex((e) => e.kind === "insert" && e.block === "NORTH ARROW")} of layout "C-101": The text "N" of its block of the role "heading" plots 0.094 in tall on layout "C-101", and the role is 0.188 in: a text on a layout plots at its height. Draw it in its role, and insert its block at a scale of 1`,
  );
  assert.ok(only(found, "height-below-standard").every((d) => d.entity === 0));
  assert.ok(only(found, "height-below-standard").length > 0);
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
  assert.equal(found.length, 6);
  assert.match(
    found[0]!.message,
    /^linear-dimension #28: It is in the dimension style "DIMS-1in-20ft", for 1" = 20', and is shown in viewport "plan" at 1" = 10'/,
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
    rules(withSheet({ viewports: layout.viewports.map((v) => ({ ...v, width: 30 })) })),
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
  let extra: unknown = "A";
  for (let i = 0; i < 40; i++) extra = [extra, extra];
  const [first, ...rest] = sheet.blocks!.find((b) => b.name === "TITLE BLOCK")!.entities;
  for (const change of [
    { extra },
    { entities: [{ ...first!, extra } as unknown as Entity, ...rest] },
  ]) {
    const changed: Drawing = {
      ...sheet,
      blocks: sheet.blocks!.map((b) => (b.name === "TITLE BLOCK" ? { ...b, ...change } : b)),
    };
    assert.ok(within(1000, changed).includes("title-block-differs-from-standard"));
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
    lint({ ...sheet, layouts: [5 as never, layout] }, { standard: perFile })
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
  const note = layout.entities.find((e) => e.kind === "text" && e.style === "NOTE") as Text;
  const { id: _, ...twice } = { ...note, height: note.height * 2 };
  const sheetTree: Drawing = {
    ...withSheet({ entities: [...layout.entities, lines.top, twice] }),
    blocks: lines.blocks,
  };
  assert.deepEqual(within(3000, sheetTree), ["height-off-role"]);
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
    const found = within(3000, { ...sheet, entities: [top], blocks, layouts: [] });
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
    assert.ok(within(1000, drawing).length > 0);
  }
  const data = JSON.parse(JSON.stringify(standard)) as Standard;
  assert.deepEqual(within(1000, sheet, { standard: { ...data, chain: slots() } }), ["standard"]);
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
  const doubled = (): unknown => {
    let value: unknown = pick([long, 0, null]);
    for (let i = 0; i < 40; i++) value = random() < 0.5 ? [value, value] : { a: value, b: value };
    return value;
  };
  const cyclic = (): unknown => {
    const value: Record<string, unknown> = { name: long };
    value.self = value;
    return value;
  };
  const hostile = (): unknown =>
    pick([doubled, cyclic, () => long, () => null, () => -1, () => NaN, () => ({}), () => []])();
  /** A list of `item` that is all empty slots, has a hole, or holds it many times. */
  const listed = (item: unknown): unknown[] => {
    const holed = [item, item, item];
    delete holed[1];
    // oxlint-disable-next-line unicorn/no-new-array
    return pick([() => new Array(2 ** 32 - 1), () => holed, () => new Array(500).fill(item)])();
  };
  type Data = Record<string, unknown>;
  const copies = (list: unknown): Data[] =>
    ((list as readonly Data[] | undefined) ?? []).map((item) => ({ ...item }));
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
    const blocks = sheet.blocks!.map((b) => ({
      ...b,
      entities: copies(b.entities),
      attributes: copies(b.attributes),
    }));
    const sheetLayout = {
      ...layout,
      entities: copies(layout.entities),
      viewports: copies(layout.viewports),
    };
    const drawing: Data = {
      ...sheet,
      layers: copies(sheet.layers),
      linetypes: copies(sheet.linetypes),
      textStyles: copies(sheet.textStyles),
      dimensionStyles: copies(sheet.dimensionStyles),
      entities: copies(sheet.entities),
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
      ].map((field) => [drawing, field] as [Data, string]),
      [drawing, "xrefs"],
      [sheetLayout, "entities"],
      [sheetLayout, "viewports"],
      ...blocks.flatMap((b) => [
        [b, "entities"] as [Data, string],
        [b, "attributes"] as [Data, string],
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
      blocks.push(...(tree as typeof blocks));
      (random() < 0.5 ? (drawing.entities as Data[]) : sheetLayout.entities).push({ ...top });
    }
    // Many texts in many viewports.
    if (random() < 0.2) {
      const note = sheet.entities.find((e) => e.kind === "text")!;
      (drawing.entities as Data[]).push(...copies(Array.from({ length: 3000 }, () => note)));
      sheetLayout.viewports = copies(Array.from({ length: 300 }, () => layout.viewports[0]));
    }
    // Many dimensions in a style with a long prefix, which every label reads.
    if (random() < 0.15) {
      const dimension = sheet.entities.find((e) => e.kind === "linear-dimension")!;
      (drawing.entities as Data[]).push(...copies(Array.from({ length: 400 }, () => dimension)));
      (drawing.dimensionStyles as Data[])[0]!.prefix = prefix;
    }
    // A field of something in the drawing: a long name, a value of the wrong type, or a field
    // nobody knows that is large written out.
    const records: Data[] = [drawing, sheetLayout, ...lists.flatMap(([o, f]) => o[f] as Data[])];
    for (const e of [...sheetLayout.entities, ...(drawing.entities as Data[])]) {
      if (e.attributes) records.push((e.attributes = { ...(e.attributes as Data) }));
    }
    for (let changes = Math.floor(random() * 5); changes > 0; changes--) {
      const record = pick(records);
      const known = Object.keys(record);
      const kind = random();
      if (kind < 0.4 && known.length > 0) {
        const field = pick(known);
        record[field] = typeof record[field] === "string" ? `${long}${record[field]}` : long;
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
    const given = as < 0.4 ? standard : (JSON.parse(as < 0.5 ? wide : data) as Data);
    const checked =
      as >= 0.4 && as < 0.5 && random() < 0.5 ? { units: "ft", entities: [] } : drawing;
    if (as >= 0.7) {
      const copy = given as Data;
      const section = pick(Object.keys(copy));
      const value = copy[section];
      if (random() < 0.5 && value && typeof value === "object" && !Array.isArray(value)) {
        (value as Data)[pick(["extra", long, ...Object.keys(value)])] = hostile();
      } else copy[section] = random() < 0.5 ? hostile() : listed(value);
    }
    const discipline = pick([undefined, undefined, "C", long, 5]);

    const out: Diagnostic[] = [];
    Object.assign(globalThis, {
      checking: () =>
        lintStandard(checked as unknown as Drawing, given, discipline, undefined, out, 20_000),
    });
    try {
      checking.runInThisContext({ timeout: 1000 });
    } catch (thrown) {
      assert.fail(`case ${n}: ${String((thrown as Error)?.message ?? thrown)}`);
    }
    assert.ok(out.every((d) => typeof d.rule === "string" && typeof d.message === "string"));
  }
});
