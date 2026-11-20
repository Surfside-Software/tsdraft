import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Script } from "node:vm";
import {
  bold,
  createDrawing,
  layoutMtext,
  layoutParagraph,
  lint,
  measureMtext,
  measureParagraph,
  paragraphInStyle,
  parseParagraph,
  plain,
  readDXF,
  stack,
  subscript,
  superscript,
  svgToPDF,
  toDXF,
  toSVG,
  underline,
  type Drawing,
  type Entity,
  type Paragraph,
} from "../src/index.ts";
import { readProblems } from "./read-agreement.ts";
import { timeLimit } from "./time-limit.ts";

const running = new Script("running()");
/** What `fn` gives, stopped after `ms`, so a run that never ends fails. */
const within = <T>(ms: number, fn: () => T): T => {
  Object.assign(globalThis, { running: fn });
  return running.runInThisContext({ timeout: timeLimit(ms) }) as T;
};

/** What a value draws, a piece at a time: characters, `[top, divider, bottom]` and `|` for a break. */
const drawn = (value: string) =>
  parseParagraph(value).pieces.map((p) =>
    p.kind === "characters" ? p.value : p.kind === "stack" ? [p.top, p.separator, p.bottom] : "|",
  );

test("a paragraph's codes draw what the DXF Reference gives them", () => {
  assert.deepEqual(drawn("ONE\\PTWO"), ["ONE", "|", "TWO"]);
  assert.deepEqual(drawn("A\\~B \\\\ \\{ \\}"), ["A\u00a0B \\ { }"]);
  // %% starts no other code: %%% and %%u draw as they are, and %%%d is a percent and a degree.
  assert.deepEqual(drawn("45%%d %%P0.5 %%c6 100%%% %%u %%%d"), ["45° ±0.5 Ø6 100%%% %%u %°"]);
  assert.deepEqual(drawn("\\U+00B0\\u+00b1"), ["°±"]);
  assert.deepEqual(drawn("3\\S1/2;\\S1#2;\\S+0.1^-0.2;"), [
    "3",
    ["1", "/", "2"],
    ["1", "#", "2"],
    ["+0.1", "^", "-0.2"],
  ]);
  // A backslash takes the character after it as it is, in a stack's parts.
  assert.deepEqual(drawn("\\S1\\/2/3\\;;"), [["1/2", "/", "3;"]]);
  const formats = parseParagraph("{\\LU}\\OO\\o\\KK\\k{\\fArial|b1|i0|c0|p34;B}R").pieces.map((p) =>
    p.kind === "characters" ? [p.value, p.format] : p.kind,
  );
  const plainFormat = {
    underline: false,
    overline: false,
    strikeThrough: false,
    bold: false,
    font: undefined,
    size: 1,
    align: 0,
  };
  assert.deepEqual(formats, [
    ["U", { ...plainFormat, underline: true }],
    ["O", { ...plainFormat, overline: true }],
    ["K", { ...plainFormat, strikeThrough: true }],
    ["B", { ...plainFormat, bold: true, font: "Arial" }],
    ["R", plainFormat],
  ]);
  assert.equal(parseParagraph("{\\fArial|b1;B}\\P\\S2^ ;").problem, undefined);
});

test("the helpers write codes that draw their text as given", () => {
  assert.deepEqual(drawn(plain("50% \\ {x} %%d %%%P")), ["50% \\ {x} %%d %%%P"]);
  assert.deepEqual(drawn(stack("1/2", "3;4", "#")), [["1/2", "#", "3;4"]]);
  assert.deepEqual(drawn(superscript("2")), [["2", "^", " "]]);
  assert.deepEqual(drawn(subscript("2")), [["", "^", "2"]]);
  assert.equal(parseParagraph(`${bold("A", "Arial")}${underline("B")}`).problem, undefined);
});

test("what tsdraft does not lay out is refused, and named", () => {
  const refused: [string, RegExp][] = [
    ["{A", /never closed/],
    ["A}", /closes no \{/],
    ["\\H2;A", /code \\H, which sets the height/],
    ["\\W0.8;A", /code \\W/],
    ["\\Q15;A", /code \\Q/],
    ["\\T2;A", /code \\T/],
    ["\\A1;A", /code \\A/],
    ["\\C1;A", /code \\C, which sets the color/],
    ["\\c255;A", /code \\c, which sets the true color/],
    ["\\pi-1,l1;A", /code \\p/],
    ["A\\NB", /code \\N, which starts a new column/],
    ["A\\XB", /code \\X/],
    ["\\OA", /code \\O, which draws a line over/],
    ["\\M+18140", /code \\M, which holds a character of a code page/],
    ["\\Z", /code \\Z is not one tsdraft knows/],
    ["\\U+00", /code \\U is not one tsdraft knows/],
    ["\\H2", /code \\H has no ; to end it/],
    ["\\S1/2", /code \\S has no ; to end it/],
    ["\\Ffoo.shx;A", /names the font "foo.shx", which is not one of FONTS/],
    ["\\fArial|i1;A", /sets italic/],
    ["\\fArial|x;A", /option "x"/],
    ["\\fromans.shx|b1;A", /SHX font, which has no bold/],
    ["A\\", /ends with a \\/],
    ["A\nB", /control characters/],
    ["\\U+0009", /control characters/],
    ["\ud83d\ude00", /above U\+FFFF/],
    ["\ue801", /private-use/],
    [`${"{".repeat(17)}A${"}".repeat(17)}`, /nest more than 16 deep/],
  ];
  for (const [value, problem] of refused) {
    assert.match(parseParagraph(value).problem ?? "", problem, JSON.stringify(value));
  }
});

test("a paragraph is read in time in proportion to its value, however it is made", () => {
  const values = [
    "{".repeat(4_000_000),
    "}".repeat(4_000_000),
    "\\".repeat(4_000_000),
    "\\S".repeat(2_000_000),
    "\\f".repeat(2_000_000),
    "\\H".repeat(2_000_000),
    "%%".repeat(2_000_000),
    "\\fArial|b1;x".repeat(300_000),
    "\\S1\\/2/3;".repeat(400_000),
    "\\La\\l".repeat(800_000),
  ];
  for (const value of values) within(2000, () => parseParagraph(value));
  // And laid out, at a width that breaks every word, at none, and with a word longer than any line.
  for (const width of [1e-6, 0, -1, Number.NaN, 1e300]) {
    within(3000, () => layoutParagraph({ value: "A BC ".repeat(400_000), height: 1, width }));
  }
  const long = within(2000, () =>
    layoutParagraph({ value: "W".repeat(2_000_000), height: 1, width: 1 }),
  );
  assert.equal(long.lines.length, 1);
});

/** The first point of each run of a paragraph of height 1, from its point, and its value. */
const runs = (paragraph: Omit<Parameters<typeof layoutParagraph>[0], "height">) =>
  layoutParagraph({ ...paragraph, height: 1 }).lines.flatMap((line) =>
    line.runs.map((run) => [run.value, run.x, run.baseline] as const),
  );

/** True when `a` and `b` agree to `within`, each number of them. */
const near = (a: readonly unknown[], b: readonly unknown[], within = 1e-4): boolean =>
  a.length === b.length &&
  a.every((value, i) =>
    Array.isArray(value)
      ? near(value, b[i] as unknown[], within)
      : typeof value === "number"
        ? Math.abs(value - (b[i] as number)) <= within
        : value === b[i],
  );

test("a paragraph is laid out where the leading CAD app sets its lines and runs", () => {
  const arial = { font: "Arial" } as const;
  const lines = (value: string, width: number, font = "Arial") =>
    layoutParagraph({ value, height: 1, width, font }).lines.map((line) => line.value);
  // A line starts at its first character's ink and ends at its last one's, and keeps the spaces
  // it starts with. The width moves no line.
  for (const width of [0, 24]) {
    assert.ok(
      near(runs({ value: "ONE\\PTWO WALLS\\P1 TYP.", width, align: "right", ...arial }), [
        ["ONE", -2.95225, -1.01774],
        ["TWO WALLS", -8.30969, -2.70214],
        ["1 TYP.", -4.1487, -4.3729],
      ]),
    );
  }
  assert.ok(near(runs({ value: "  HHH  ", align: "right", ...arial }), [["  HHH", -3.69031, -1]]));
  // The next run starts where the last one's ink ends, past its advances.
  assert.ok(
    near(runs({ value: "{\\fArial|b1;f}H", ...arial }), [
      ["f", -0.01637, -1.01705],
      ["H", 0.48977, -1.01705],
    ]),
  );
  // A word stays when the advances up to it and its ink fit; the first letter's left has no part.
  assert.deepEqual(lines("THHH HHHH HHHH", 8.0795), ["THHH HHHH", "HHHH"]);
  assert.deepEqual(lines("THHH HHHH HHHH", 8.0765), ["THHH", "HHHH", "HHHH"]);
  assert.deepEqual(lines('HHHH 1\\S1/2;" HHHH', 6.2986), ['HHHH 11/2"', "HHHH"]);
  assert.deepEqual(lines('HHHH 1\\S1/2;" HHHH', 6.2936), ["HHHH", '11/2" HHHH']);
  // No slack beyond the tables' rounding, and no break but at a space: the written width just
  // under the reach wraps, and the one just over it does not.
  const ink = layoutParagraph({ value: "HHHH HHHH", height: 1, font: "romans.shx" }).lines[0]!;
  const reach = ink.end - ink.start;
  const [under, over] = [Math.floor(reach * 1e6) / 1e6, Math.ceil(reach * 1e6) / 1e6];
  assert.deepEqual(lines("HHHH HHHH HHHH", under, "romans.shx"), ["HHHH", "HHHH", "HHHH"]);
  assert.deepEqual(lines("HHHH HHHH HHHH", over, "romans.shx"), ["HHHH HHHH", "HHHH"]);
  assert.deepEqual(lines("HHHH\\~HHHH HHHH", 1), ["HHHH HHHH", "HHHH"]);
  assert.deepEqual(lines("WATER-PROOFING", 1), ["WATER-PROOFING"]);
  // At least: each line's slot is the factor times its A, D and a third, from its top.
  const baselines = (
    value: string,
    lineSpacing: number,
    lineSpacingStyle: "at-least" | "exactly" = "at-least",
  ) =>
    layoutParagraph({ value, height: 1, ...arial, lineSpacing, lineSpacingStyle }).lines.map(
      (line) => line.baseline,
    );
  for (const factor of [0.5, 1, 1.5, 2]) {
    assert.ok(near(baselines("HHH\\PHHH", factor), [-1, -1 - (5 / 3) * factor]));
  }
  assert.ok(near(baselines("HHH\\P\u00c5\u00c9\u00ce\\PHHH", 1), [-1, -2.9191, -4.5858]));
  assert.ok(near(baselines("1\\S1/2;\\PHHH", 1), [-2.3415, -2.6748 - 1]));
  // Exactly: 5/3 of the height times the factor apart, the first a height below the top.
  assert.ok(
    near(baselines("HHH\\P\u00c5\u00c9\u00ce\\PHHH", 2, "exactly"), [-1, -13 / 3, -23 / 3]),
  );
  // The box ends at the last line's ink below its baseline.
  assert.ok(
    near(runs({ value: "HHH\\PHgy", valign: "bottom", ...arial }), [
      ["HHH", -0.11187, 1.96066],
      ["Hgy", -0.11187, 0.294],
    ]),
  );
  // A superscript is a third of a height up, and a fraction's bar a sixth below its top part.
  assert.ok(
    near(
      runs({ value: "X\\S2^ ;", ...arial }),
      [
        ["X", -0.00614, -1.33811],
        ["2", 0.88472, -1.00409],
        [" ", 0.92565, -1.33811],
      ],
      1e-3,
    ),
  );
  const fraction = layoutParagraph({ value: '1\\S1/2;"', height: 1, ...arial });
  assert.ok(near(fraction.strokes[0]!.from, [0.6248, -1.1708]));
  assert.ok(near(fraction.strokes[0]!.to, [1.2872, -1.1708]));
  assert.ok(
    near(
      fraction.lines[0]!.runs.map((run) => run.x),
      [-0.15208, 0.61968, 0.58392, 1.354],
    ),
  );
  // A slash stack stands its top part on its bottom part's ink, and centers the slash at its top.
  const slash = layoutParagraph({ value: "\\S1#A;", height: 1, ...arial });
  assert.ok(
    near(
      slash.lines[0]!.runs.map((run) => run.baseline),
      [-1.00409, -2.00409],
    ),
  );
  const [from, to] = [slash.strokes[0]!.from, slash.strokes[0]!.to];
  assert.ok(near([(from[1] + to[1]) / 2], [-1.00409]));
  // An underline lies at the descent of a TrueType font and a fifth of a height in an SHX font.
  for (const [font, below] of [
    ["Arial", -0.29604],
    ["romans.shx", -0.2],
  ] as const) {
    const [line] = layoutParagraph({ value: "\\LHHHH\\l HH", height: 1, font }).strokes;
    assert.ok(near([line!.from[1] - -1], [below]), font);
  }
});

test("what the tables cannot lay out exactly is approximate, or refused", () => {
  const approximate = (value: string, font: string, obliqueAngle = 0) =>
    layoutParagraph({ value, height: 1, font, obliqueAngle }).approximate;
  assert.equal(approximate("H%%cH", "Arial"), false);
  assert.equal(approximate("H%%cH", "romans.shx"), true);
  assert.equal(approximate("H\u00d8H", "romans.shx"), false);
  assert.equal(approximate("ONE", "romans.shx", 15), true);
  assert.equal(approximate("ONE", "Arial", 15), false);
  assert.equal(approximate("1\\S1/2;", "Arial"), false);
  assert.equal(approximate("1\\S1/2;", "Times New Roman"), true);
  for (const value of ["\\Sx/y;", "\\S1/2a;", "\\S+/1;", "\\S 1/2;", "\\S1/2/3;"]) {
    assert.match(parseParagraph(value).problem ?? "", /stacked part/, value);
  }
  for (const value of ["\\S1/2;", "\\S+0.01^-0.02;", "\\S2^ ;", "\\S^2;", "\\SAB#CD;"]) {
    assert.equal(parseParagraph(value).problem, undefined, value);
  }
  assert.match(parseParagraph("\\OOVER").problem ?? "", /code \\O, which draws a line over/);
  assert.match(parseParagraph("\\L1\\S1/2;").problem ?? "", /stack in underlined/);
  assert.equal(parseParagraph("{\\L1}\\S1/2;").problem, undefined);
});

/** A drawing with one paragraph of these fields, as data. */
function holding(fields: Record<string, unknown>, dxf: "R12" | "R2018" = "R2018"): Drawing {
  const paragraph = {
    kind: "paragraph",
    layer: "0",
    at: [0, 0],
    height: 0.1,
    rotation: 0,
    value: "NOTE",
    ...fields,
  };
  return { ...createDrawing({ dxf }).build(), entities: [paragraph as unknown as Entity] };
}

test("lint refuses a paragraph built as data that the leading CAD app would not take as written", () => {
  const errors = (drawing: Drawing) =>
    lint(drawing)
      .filter((d) => d.severity === "error")
      .map((d) => `${d.rule}: ${d.message}`);
  assert.deepEqual(errors(holding({})), []);
  assert.deepEqual(errors(holding({}, "R12")), [
    'paragraph: paragraph #0: tsdraft writes no paragraphs to R12 drawings. Use DXF version "R2018" for a paragraph',
  ]);
  const refused: [Record<string, unknown>, RegExp][] = [
    [{ value: "A\nB" }, /^paragraph: .*control characters/],
    [{ value: "\\H2;A" }, /^paragraph: .*code \\H/],
    [{ lineSpacing: 5 }, /^paragraph: .*from 0.25 to 4/],
    [
      { lineSpacingStyle: "loose" },
      /^paragraph: .*lineSpacingStyle must be "at-least" or "exactly"/,
    ],
    [{ align: "justified" }, /^text-align: .*align must be "left", "center" or "right"/],
    [{ valign: "baseline" }, /^text-align: .*valign must be "top", "middle" or "bottom"/],
    [{ width: 0 }, /^geometry: .*width: This value must be greater than 0/],
    [{ height: -1 }, /^geometry: .*height: This value must be greater than 0/],
    [{ style: "NOTES" }, /^undefined-text-style: /],
    // An SHX font draws %%c as a sign of its own, which is not laid out yet: the style's or one a
    // code sets.
    [{ value: "%%c6" }, /^paragraph: .*%%c in an SHX font/],
    [{ value: "\\fArial;\\fromans.shx;%%c6" }, /^paragraph: .*%%c in an SHX font/],
  ];
  for (const [fields, problem] of refused) {
    const found = errors(holding(fields));
    assert.ok(
      found.some((e) => problem.test(e)),
      `${JSON.stringify(fields)}: ${found.join("; ")}`,
    );
  }
  // A TrueType font keeps it.
  const arial = { textStyles: [{ name: "NOTES", font: "Arial" }] };
  assert.deepEqual(errors({ ...holding({ value: "%%c6", style: "NOTES" }), ...arial }), []);
  assert.deepEqual(errors(holding({ value: "\\fArial;%%c6" })), []);
});

test("readDXF gives back each paragraph as toDXF wrote it, in model space, a block and a layout", async () => {
  const d = createDrawing({ units: "in" });
  d.textStyle({ name: "NOTES", font: "Arial" });
  const long = Array.from({ length: 80 }, (_, i) => `WORD${i} ^ CARET`).join(" ");
  d.paragraph(
    `${bold("NOTES", "Arial")}\n1. ${underline("ALL")} WORK 3${stack("1", "2")}" \\U+00B0 %%d`,
    {
      at: [0, 0],
      width: 2,
      height: 0.1,
      style: "NOTES",
      align: "right",
      valign: "bottom",
      rotation: 15,
      lineSpacing: 1.25,
      lineSpacingStyle: "exactly",
      id: "notes",
    },
  );
  d.paragraph(long, { at: [0, -2], width: 4 });
  d.block("TAG", {}, () => d.paragraph("TAG", { at: [0, 0], align: "center", valign: "middle" }));
  d.insert("TAG", [5, 5]);
  d.layout("SHEET", { paper: "ARCH D" }, () =>
    d.paragraph(long, { at: [1, 20], width: 6, height: 0.125 }),
  );
  const drawing = d.build();
  const read = await readDXF(toDXF(drawing), { geometry: true });
  assert.deepEqual(readProblems(drawing, read, "tsdraft"), []);
  const mtexts = read.model.entities!.filter((e) => e.kind === "mtext");
  assert.equal(mtexts.length, 2);
  assert.equal(mtexts[1]!.kind === "mtext" && mtexts[1]!.value, long);
});

test("a paragraph is laid out from its numbers as written, as a read of the file lays it out", async () => {
  const d = createDrawing({ units: "in" });
  d.textStyle({ name: "NOTES", font: "Arial" });
  // Each is within the writers' rounding of where its second word wraps.
  d.paragraph("HHHH HHHH", { at: [0, 0], height: 1, width: 8.234652113580001, style: "NOTES" });
  d.paragraph("HHHH HHHH", { at: [0, 5], height: 0.1000004, width: 0.823466, style: "NOTES" });
  const drawing = d.build();
  const read = await readDXF(toDXF(drawing), { geometry: true });
  const style = read.textStyles.find((s) => s.name === "NOTES");
  const mtexts = read.model.entities!.filter((e) => e.kind === "mtext");
  assert.deepEqual(
    mtexts.map((m) => layoutMtext(m, style).lines.length),
    [2, 1],
  );
  drawing.entities.forEach((e, i) => {
    const laid = layoutParagraph(paragraphInStyle(e as Paragraph, drawing.textStyles![0]));
    assert.deepEqual(laid.lines, layoutMtext(mtexts[i]!, style).lines);
  });
});

test("a paragraph is placed in the direction the DXF holds: its rotation within a turn, as written", async () => {
  const d = createDrawing({ units: "in" });
  d.textStyle({ name: "NOTES", font: "Arial" });
  const rotations = [8571234567891230000, 400.5, -30, 4e-7, 359.9999996];
  for (const [i, rotation] of rotations.entries()) {
    d.paragraph("HHHH", { at: [0, 10 * i], height: 1e9, rotation, style: "NOTES" });
  }
  const drawing = d.build();
  const read = await readDXF(toDXF(drawing), { geometry: true });
  const style = read.textStyles.find((s) => s.name === "NOTES");
  const mtexts = read.model.entities!.filter((e) => e.kind === "mtext");
  drawing.entities.forEach((e, i) => {
    const placed = measureParagraph(paragraphInStyle(e as Paragraph, drawing.textStyles![0]));
    assert.deepEqual(placed.lines, measureMtext(mtexts[i]!, style).lines, String(rotations[i]));
  });
  assert.deepEqual(readProblems(drawing, read, "tsdraft"), []);
});

test("a run and a text in a TrueType font are plotted from their first point at their advances", () => {
  const d = createDrawing({ units: "in" });
  d.textStyle({ name: "NOTES", font: "Arial" });
  // An "f" reaches past its advance, which stretches no glyph: the leading CAD app plots 100 Tz.
  d.layout("SHEET", { paper: "ARCH D" }, () => {
    d.paragraph("f {\\Lf}", { at: [1, 20], height: 1, style: "NOTES" });
    d.text([1, 10], "f", { height: 1, style: "NOTES" });
  });
  const picture = toSVG(d.build(), { layout: "SHEET" });
  const page = new TextDecoder("latin1").decode(svgToPDF([picture]));
  assert.deepEqual(
    [...page.matchAll(/(\S+) Tz/g)].map((m) => m[1]),
    ["100", "100", "100"],
  );
});

test("a bold run is drawn bold, and plotted in a bold face or the bold file given", () => {
  const d = createDrawing({ units: "in" });
  d.textStyle({ name: "NOTES", font: "Arial" });
  d.layout("SHEET", { paper: "ARCH D" }, () =>
    d.paragraph(`${bold("BOLD", "Arial")} REGULAR`, { at: [1, 20], height: 0.125, style: "NOTES" }),
  );
  const drawing = d.build();
  const picture = toSVG(drawing, { layout: "SHEET" });
  assert.equal(picture.match(/font-weight="bold"/g)?.length, 1);
  const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
  const faces = text(svgToPDF([picture]));
  assert.ok(faces.includes("/BaseFont /Helvetica-Bold") && faces.includes("/BaseFont /Helvetica "));
  const font = new Uint8Array(
    readFileSync(new URL("../cli/assets/fonts/JetBrainsMono-Regular.ttf", import.meta.url)),
  );
  const embedded = text(svgToPDF([picture], { fonts: { "Arial Bold": font } }));
  assert.ok(!embedded.includes("/BaseFont /Helvetica-Bold") && embedded.includes("/FontFile2"));
});

test("under a standard a paragraph is held to its role's text style and height, as a text is", async () => {
  const { default: sheet, standard } = await import("../examples/site-plan.ts");
  assert.deepEqual(
    lint(sheet, { standard }).filter((d) => d.severity === "error"),
    [],
  );
  const [layout] = sheet.layouts!;
  const at = layout!.entities.findIndex((e) => e.kind === "paragraph");
  const changed = (fields: Record<string, unknown>): Drawing => ({
    ...sheet,
    layouts: [
      {
        ...layout!,
        entities: layout!.entities.map((e, i) => (i === at ? ({ ...e, ...fields } as Entity) : e)),
      },
    ],
  });
  const rules = (drawing: Drawing) =>
    lint(drawing, { standard })
      .filter((d) => d.severity === "error" && d.entity === at)
      .map((d) => d.rule);
  assert.deepEqual(rules(changed({ height: 0.2 })), ["height-off-role"]);
  assert.deepEqual(rules(changed({ style: undefined })), ["text-style-outside-standard"]);
});
