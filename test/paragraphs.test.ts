import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  bold,
  createDrawing,
  layoutMtext,
  layoutParagraph,
  lint,
  list,
  measureMtext,
  measureParagraph,
  paragraphFormat,
  paragraphInStyle,
  parseParagraph,
  plain,
  readDXF,
  stack,
  subscript,
  superscript,
  svgToPDF,
  inspectText,
  toPDF,
  toDXF,
  toSVG,
  checkDrawingRead,
  paragraphColumnsHeld,
  underline,
  type Drawing,
  type Entity,
  type ParagraphLayout,
  type Point,
} from "../src/index.ts";
import { isNumber } from "../src/guards.ts";
import { paragraphMeasurer } from "../src/paragraphs.ts";
import { readProblems } from "./read-agreement.ts";
import { within } from "./time-limit.ts";
import { dataOf, fieldOf, ofKind, recordsIn, wrong, type Data } from "./values.ts";

/** What a value draws, a piece at a time: characters, `[top, divider, bottom]` and `|` for a break. */
const drawn = (value: string) =>
  parseParagraph(value).pieces.map((p) => {
    switch (p.kind) {
      case "characters":
        return p.value;
      case "stack":
        return [p.top, p.separator, p.bottom];
      default:
        return "|";
    }
  });

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
    height: undefined,
    widthFactor: undefined,
    obliqueAngle: undefined,
    align: 0,
    color: undefined,
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
    ["\\H0;A", /code \\H takes a height above 0/],
    ["\\H2.;A", /code \\H takes a height above 0/],
    ["\\W-1;A", /code \\W takes a width factor above 0/],
    ["\\Q86;A", /code \\Q takes an oblique angle in degrees, from -85 to 85/],
    ["\\T2;A", /code \\T, which sets the spacing/],
    ["\\A3;A", /code \\A takes 0, 1 or 2/],
    ["\\C258;A", /code \\C takes a color number from 0 to 257/],
    ["\\c16777216;A", /code \\c takes a true color/],
    ["\\ptr3;A", /aligns text by its right/],
    ["\\psa1.2;A", /at least a size apart/],
    ["\\pi-;A", /option "i-"/],
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
  a.every((value, i) => {
    const other = b[i];

    if (Array.isArray(value)) return Array.isArray(other) && near(value, other, within);

    if (isNumber(value)) return isNumber(other) && Math.abs(value - other) <= within;

    return value === other;
  });

/** Fields of a paragraph to lay out. */
type MoreFields = Partial<Parameters<typeof layoutParagraph>[0]>;

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

test("a list hangs its items under their marks, and its tabs and indents fall where the leading CAD app puts them", () => {
  const arial = { font: "Arial" } as const;

  const lines = (value: string, width: number) =>
    layoutParagraph({ value, height: 1, width, ...arial }).lines.map((line) => line.value);

  assert.equal(
    list(["ONE", { text: "TWO", items: ["UNDER"] }]),
    "\\pxi-3,l3,t3;1.\tONE\\P\\pxi-3,l3,t3;2.\tTWO\\P\\pxi-3,l6,t6;A.\tUNDER",
  );
  assert.equal(
    paragraphFormat({
      indent: 0,
      left: 0,
      tabs: [],
      justification: "justified",
      spacing: { style: "m", value: 1.15 },
    }),
    "\\pxi0,l0,tz,qj,sm1.15;",
  );
  // The text after the tab starts its ink on the stop, the left indent, as do the lines it wraps to.
  assert.ok(
    near(runs({ value: list(["HHHH HHHH HHHH"]), width: 11.35, ...arial }), [
      ["1.", -0.15211, -1.00409],
      ["HHHH HHHH", 2.88813, -1.00409],
      ["HHHH", 2.88813, -2.67076],
    ]),
  );
  // The words after the tab are measured as a line that starts on the stop, as the plot wraps them.
  assert.deepEqual(lines(list(["HHHH HHHH HHHH"]), 11.2348), ["1.\tHHHH HHHH", "HHHH"]);
  assert.deepEqual(lines(list(["HHHH HHHH HHHH"]), 11.2346), ["1.\tHHHH", "HHHH", "HHHH"]);
  // Stops given, then every four heights; a stop that would put the next letter behind the pen is
  // passed, and a centered line is laid out from the box and then moved.
  assert.ok(
    near(runs({ value: "\\pxt2.5,4;H\tH\tH\tH", width: 20, ...arial }), [
      ["H", -0.11187, -1],
      ["H", 2.38813, -1],
      ["H", 3.88813, -1],
      ["H", 7.88813, -1],
    ]),
  );
  assert.deepEqual(lines("\\pxt3;HHH\tHHH HHH HHH", 6), ["HHH", "\tHHH", "HHH", "HHH"]);
  assert.ok(
    near(runs({ value: "\\pxqc;H\tH", width: 10, ...arial }), [
      ["H", 2.49591, -1],
      ["H", 6.49591, -1],
    ]),
  );

  // A right indent holds every line short of it, and the lines after the first start at the left
  // indent.
  const starts = layoutParagraph({
    value: `\\pxi1,l2,r1;${"HHHH ".repeat(8)}`,
    height: 1,
    width: 32,
    ...arial,
  }).lines.map((line) => [line.value.split(" ").length, Math.round(line.start)]);

  assert.deepEqual(starts, [
    [6, 3],
    [2, 2],
  ]);
  // A justified line grows its spaces to end at the width, each space a run of its own; its
  // paragraph's last line stands by the attachment.
  assert.ok(
    near(
      runs({ value: "\\pqj;HHHH HH HHHH H HHHH HHHH HHH", width: 12, ...arial }).slice(0, 5),
      [
        ["HHHH", -0.11187, -1],
        [" ", 3.92361, -1],
        ["HH", 4.99, -1],
        [" ", 7.0067, -1],
        ["HHHH", 8.0771, -1],
      ],
      0.003,
    ),
  );

  // A surrogate with no pair is a character of its own, and so is what follows it.
  assert.deepEqual(
    runs({ value: "\\pxqd;\ud83d\uff21BC", width: 20, ...arial }).map(([value]) => value),
    ["\ud83d", "\uff21", "B", "C"],
  );

  // The paragraph's own spacing, by a factor and exactly, and room before and after it.
  const baselines = (value: string, height = 1) =>
    layoutParagraph({ value, height, ...arial }).lines.map((line) => +line.baseline.toFixed(4));

  assert.deepEqual(baselines("\\psm1.5;HHH\\P1\\S1/2;\\PHHH"), [-1, -4.8415, -7.8903]);
  assert.deepEqual(baselines("\\pse0.6;HHH\\PHHH"), [-0.6, -1.6]);
  assert.deepEqual(baselines("\\pb1;HHH\\P\\pa2;HHH\\PHHH"), [-2, -4.6667, -9.3333]);
  // Room before a paragraph is a quarter of a height at least, and `x` holds for the codes after.
  assert.deepEqual(baselines("\\pxa0.5;HHH\\P\\pb0.1;HHH"), [-1, -3.4167]);
  assert.deepEqual(baselines("\\pxa0.5;HHH\\P\\pb0.5;HHH", 2), [-2, -7.3333]);
  assert.deepEqual(baselines("\\pa1;HHH\\P\\pb0.5;HHH", 2), [-2, -6.8333]);
  // The picture holds the tab as an entity, which an XML reader keeps, and the plot reads it.
  const d = createDrawing({ units: "in" });
  d.layout("SHEET", { paper: "ARCH D" }, () => d.paragraph(list(["ONE"]), { at: [1, 20] }));
  const picture = toSVG(d.build(), { layout: "SHEET" });
  assert.ok(picture.includes('data-paragraph="\\pxi-3,l3,t3;1.&#9;ONE"'));
  assert.ok(svgToPDF([picture]).length > 0);
});

test("columns take a paragraph's lines in turn, where the leading CAD app sets them", () => {
  const arial = { font: "Arial", height: 0.2, width: 2 } as const;
  const twelve = Array.from({ length: 12 }, (_, k) => `L${k + 1} HHHH`).join("\\P");
  const ten = Array.from({ length: 10 }, (_, k) => `L${k + 1} HHHH`).join("\\P");
  const lay = (value: string, more: MoreFields) => layoutParagraph({ value, ...arial, ...more });

  const columnsOf = (layout: ParagraphLayout) =>
    layout.lines.map((line) => `${line.column}:${line.value.split(" ")[0]}`).join(" ");

  const first = (layout: ParagraphLayout, value: string) =>
    layout.lines.flatMap((line) => line.runs).find((run) => run.value === value)!;

  const near = (got: number, want: number) =>
    assert.ok(Math.abs(got - want) < 2e-4, `${got} ${want}`);

  // A line whose box reaches below the column's height starts the next, the gutter past it; the
  // last static column takes what is left.
  const two = lay(twelve, { columns: { count: 2, height: 1, gutter: 0.5 } });
  assert.match(columnsOf(two), /^0:L1 0:L2 0:L3 1:L4 .* 1:L12$/);
  near(first(two, "L1 HHHH").x, -0.0205);
  near(first(two, "L4 HHHH").x, 2.4795);
  near(first(two, "L4 HHHH").baseline, -0.2);
  assert.equal(two.columns.length, 2);
  // Without a count, as many as it takes; with heights, one each, then one for the rest.
  assert.equal(lay(twelve, { columns: { height: 1, gutter: 0.5 } }).columns.length, 4);
  assert.equal(
    columnsOf(lay(ten, { columns: { heights: [0.6, 1.2], gutter: 0.5 } })),
    "0:L1 0:L2 1:L3 1:L4 1:L5 2:L6 2:L7 2:L8 2:L9 2:L10",
  );
  // `\N` starts the next column; exact spacing ends a line's box a third of a height down.
  assert.equal(
    columnsOf(lay("L1 HHHH\\NL2 HHHH", { columns: { count: 2, height: 2 } })),
    "0:L1 1:L2",
  );
  assert.equal(
    columnsOf(lay(ten, { lineSpacingStyle: "exactly", columns: { count: 2, height: 0.58 } })),
    "0:L1 1:L2 1:L3 1:L4 1:L5 1:L6 1:L7 1:L8 1:L9 1:L10",
  );
  // Each column is a box the attachment places on its own; static ones stand as wide as all.
  const bottom = lay(twelve, { valign: "bottom", columns: { count: 2, height: 1.2, gutter: 0.5 } });
  near(first(bottom, "L3 HHHH").baseline, 0.0035);
  near(first(bottom, "L12 HHHH").baseline, 0.0001);

  const right = lay("L1 HHHH\\PL2 HHHH", {
    align: "right",
    columns: { count: 3, height: 1, gutter: 0.5 },
  });

  near(first(right, "L1 HHHH").x, -6.173);
  assert.deepEqual([right.frame[0], right.frame[2]], [-7, 0]);
  // Past the heights given one column takes the rest, a \\N there too.
  assert.equal(columnsOf(lay("A\\NB\\NC", { columns: { heights: [1] } })), "0:A 1:B 1:C");

  // What a file holds adds up as written.
  const held = {
    value: "A",
    height: 0.2,
    width: 1.2345674,
    columns: { count: 3, height: 1, gutter: 0.2345674 },
  };

  const kept = paragraphColumnsHeld(held, layoutParagraph(held))!;
  assert.deepEqual([kept.width, kept.gutter, kept.total], [1.234567, 0.234567, 4.172835]);
  // One measurer keeps a long value's layout for each height of its columns.
  const notes = `${"VERIFY ALL DIMENSIONS IN FIELD\\P".repeat(10)}END`;
  const measurer = paragraphMeasurer();

  const counts = [0.2, 10].map(
    (height) =>
      measurer.layout({ value: notes, ...arial, height: 0.125, width: 8, columns: { height } })
        .columns.length,
  );

  assert.deepEqual(counts, [11, 1]);
  // Columns that are not an object, as data may hold them, are none.
  assert.equal(lay(twelve, { columns: wrong(null) }).columns.length, 1);
  // A distributed line wider than its room is left whole, and centered.
  const wide = lay("\\pxqd;CONSTRUCTION.", {});
  assert.deepEqual(
    wide.lines[0]!.runs.map((run) => run.value),
    ["CONSTRUCTION."],
  );
  near(wide.lines[0]!.runs[0]!.x, -0.1589);
});

test("the codes that change the characters after them set them where the leading CAD app does", () => {
  const lay = (value: string, more: MoreFields = {}) =>
    layoutParagraph({ value, height: 0.25, font: "Arial", ...more });

  const runs = (value: string, more: MoreFields = {}) =>
    lay(value, more).lines.flatMap((line) =>
      line.runs.map((run) => [run.value, +run.x.toFixed(4), +run.baseline.toFixed(4), run.height]),
    );

  // A height drawn in drawing units or as a factor, the line set by its tallest run.
  assert.deepEqual(runs("HH\\H2x;HH"), [
    ["HH", -0.028, -0.5, 0.25],
    ["HH", 0.4765, -0.5, 0.5],
  ]);
  // A line's D is a third of its tallest run.
  assert.deepEqual(
    lay("HH\\P{\\H2x;HH}\\PHH").lines.map((line) => +line.baseline.toFixed(4)),
    [-0.25, -0.9167, -1.4167],
  );
  assert.deepEqual(
    runs("\\H0.4;HH\\PHH").map((run) => run[3]),
    [0.4, 0.4],
  );
  // A width factor and an oblique angle of their own, not the style's.
  const wide = lay("HH\\W2;HH", { widthFactor: 0.8 }).lines[0]!.runs.map((run) => run.widthFactor);
  assert.deepEqual(wide, [0.8, 2]);
  // A run after a leaned run starts further by the lean of its last capital's top.
  assert.deepEqual(
    runs("HH\\Q0;HH{\\Q30;HH}", { obliqueAngle: 15 }).map((run) => run[1]),
    [-0.028, 0.5435, 1.0479],
  );
  // Centered on the tallest run, from where \\A stands.
  assert.deepEqual(
    runs("H{\\H2x;H}\\A1;H{\\H0.5x;H}").map((run) => run[2]),
    [-0.5, -0.5, -0.375, -0.3125],
  );
  // A color starts a run and moves nothing; spaces of their own size place the line by its
  // first point.
  assert.deepEqual(
    runs("\\C1;RED\\C3;GREEN").map((run) => run[0]),
    ["RED", "GREEN"],
  );
  // The preview draws a run in the color its code sets.
  const colored = createDrawing({ units: "in" });
  colored.paragraph("{\\C1;RED} BLACK", { at: [0, 0] });

  const fills = toSVG(colored.build())
    .match(/<text[^>]*>/g)!
    .map((t) => /fill="([^"]*)"/.exec(t)![1]);

  assert.deepEqual(fills, ["#ff0000", "currentColor"]);
  assert.equal(runs("HH {\\H3x; } HH")[0]![1], 0);
  // A stack under a width factor or a lean of its own is laid out and drawn in them, unmeasured.
  const squeezed = lay('\\W2;1\\S1/2;" GYP');
  assert.ok(squeezed.approximate);
  assert.deepEqual([...new Set(squeezed.lines[0]!.runs.map((run) => run.widthFactor))], [2]);
  // A run leaned by a code leans its line's box, which inspectText reads.
  const leaned = createDrawing({ units: "in" });
  leaned.rect([0, 0], 1.1, 1.1);
  leaned.paragraph("\\Q45;H", { at: [0.05, 1], height: 1, style: { name: "A", font: "Arial" } });
  assert.ok(inspectText(leaned.build()).some((d) => d.rule === "text-leaves-boundary"));

  // Each run leans the box by its own angle, up to its own top.
  const leaves = (value: string, width: number, high = 1.4, at: Point = [0.2, 1.3]) => {
    const d = createDrawing({ units: "in" });
    d.rect([0, 0], width, high);
    d.paragraph(value, { at, height: 1, style: { name: "A", font: "Arial" } });

    return inspectText(d.build()).some((w) => w.rule === "text-leaves-boundary");
  };

  assert.equal(leaves("I{\\Q-40;H}I", 4), true);
  assert.equal(leaves("H{\\H0.25x;\\Q45;H}", 1.7), false);
  assert.equal(leaves("{\\Q85;T}{\\H9x;.}", 40, 40, [10, 30]), false);
  // An upright line that starts with a stack is boxed by its ink, as before the codes.
  const scale = createDrawing({ units: "in" });
  const value = '\\S1/16;" = 1\'-0"';
  const style = { name: "A", font: "Arial" } as const;
  const line = layoutParagraph({ value, height: 1, font: "Arial" }).lines[0]!;
  scale.paragraph(value, { at: [10, 2.8], height: 1, style });
  scale.text([10 + line.start - 0.1, 2.8 + line.baseline], "SCALE:", {
    height: 1,
    style: "A",
    align: "right",
  });
  assert.deepEqual(inspectText(scale.build()), []);
  // A run a factor makes too small to write draws nothing, and the plot goes on.
  const small = createDrawing({ units: "m" });
  small.paragraph("{\\H0.4x;NOTE}", { at: [0, 0.000004], height: 0.000001 });
  small.layout("A", { paper: "ANSI A" }, (page) =>
    page.viewport([1, 1], 4, 4, { center: [0, 0], ratio: 0.0001 }),
  );
  assert.ok(toPDF(small.build()).length > 0);
  // A chain of factors past what a number holds is held, and approximate.
  const tall = lay(`${"\\H999999999999999x;".repeat(21)}A`);
  assert.ok(tall.approximate && Number.isFinite(tall.lines[0]!.runs[0]!.height));
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
function holding(fields: Data, dxf: "R12" | "R2018" = "R2018"): Drawing {
  const paragraph = {
    kind: "paragraph",
    layer: "0",
    at: [0, 0],
    height: 0.1,
    rotation: 0,
    value: "NOTE",
    ...fields,
  };

  return { ...createDrawing({ dxf }).build(), entities: [wrong(paragraph)] };
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

  const refused: [Data, RegExp][] = [
    [{ value: "A\nB" }, /^paragraph: .*control characters/],
    [{ value: "\\H0;A" }, /^paragraph: .*code \\H takes/],
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
    [{ columns: { height: 1 } }, /^paragraph: .*needs a width/],
    [{ width: 2, columns: { count: 0, height: 1 } }, /^paragraph: .*a whole count from 1 to 1000/],
    [{ width: 2, columns: { height: 1, heights: [1] } }, /^paragraph: .*\{ heights, gutter\? \}/],
    [{ width: 2, columns: { heights: [] } }, /^paragraph: .*from 1 to 1000 heights/],
    [{ width: 2, columns: { height: 1, gutter: -1 } }, /^paragraph: .*a gutter of 0 or more/],
    [{ width: 2, columns: { heights: [4e-7, 2] } }, /^paragraph: .*heights above 0 as written/],
    [
      { width: 2, columns: { height: 1, count: 1000, gutter: 1e98 } },
      /^paragraph: .*too wide to write/,
    ],
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

  // A \N without columns only breaks the line, which lint warns of.
  const warnings = (drawing: Drawing) =>
    lint(drawing)
      .filter((d) => d.severity === "warning")
      .map((d) => d.message);

  assert.deepEqual(warnings(holding({ value: "A\\NB" })), [
    "paragraph #0: The paragraph code \\N starts the next column, and this paragraph has no columns: it breaks the line, as \\P does",
  ]);
  assert.deepEqual(warnings(holding({ value: "A\\NB", width: 2, columns: { height: 1 } })), []);
  // A list of heights is read by its items, whatever its methods.
  const odd = Object.assign([1, 2], { [Symbol.iterator]: 0, slice: 0, map: 0 });
  const shadowed = holding({ value: "A\\NB", width: 2, columns: { heights: odd } });
  assert.deepEqual(errors(shadowed), []);
  assert.doesNotThrow(() => toSVG(shadowed));
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
  d.paragraph(list(["ONE\tTWO", "THREE"]), { at: [0, -6], width: 4 });
  // Columns of each kind, held in an embedded object after the MTEXT's own groups.
  d.paragraph(long, { at: [10, 0], width: 2, columns: { count: 2, height: 1, gutter: 0.25 } });
  d.paragraph(long, { at: [20, 0], width: 2, rotation: 30, columns: { height: 1 } });
  d.paragraph(`${long}\\N${long}`, { at: [30, 0], width: 2, columns: { heights: [1, 2] } });
  // A file holds the heights of the columns the text reaches.
  d.paragraph("A", { at: [40, 0], width: 2, columns: { heights: [1, 2, 3] } });
  const drawing = d.build();
  const dxf = toDXF(drawing);
  assert.ok(dxf.includes("1.^IONE^ITWO"), "a tab is written as ^I");
  const read = await readDXF(dxf, { geometry: true });
  assert.deepEqual(readProblems(drawing, read, "tsdraft"), []);
  const mtexts = read.model.entities!.filter((e) => e.kind === "mtext");
  assert.equal(mtexts.length, 7);
  assert.equal(mtexts[1]!.kind === "mtext" && mtexts[1]!.value, long);

  // The embedded object's direction wins over group 50.
  const turned = await readDXF(
    dxf.replace(/\r\n11\r\n0\.866025403784439\r\n21\r\n0\.5\r\n31\r\n0\r\n/, "\r\n50\r\n90\r\n"),
    { geometry: true },
  );

  const thirty = turned.model.entities!.filter((e) => e.kind === "mtext")[4]!;
  assert.equal(thirty.kind === "mtext" && thirty.rotation, 30);

  const both = dataOf(structuredClone(read));
  const entities = recordsIn(fieldOf(both.model, "entities"));
  entities.find((e) => e.columns !== undefined)!.columns = { height: 1, heights: [2] };
  assert.match(
    checkDrawingRead(both).join("; "),
    /columns must be \{ height, count\?, gutter\? \}/,
  );
  assert.deepEqual(
    mtexts.slice(3).map((e) => e.kind === "mtext" && [e.width, e.columns]),
    [
      [2, { count: 2, height: 1, gutter: 0.25 }],
      [2, { height: 1, gutter: 0.625 }],
      [2, { heights: [1, 2], gutter: 0.625 }],
      [2, { heights: [1], gutter: 0.625 }],
    ],
  );
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
    const laid = layoutParagraph(paragraphInStyle(ofKind(e, "paragraph"), drawing.textStyles![0]));
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
    const placed = measureParagraph(
      paragraphInStyle(ofKind(e, "paragraph"), drawing.textStyles![0]),
    );

    assert.deepEqual(placed.lines, measureMtext(mtexts[i]!, style).lines, String(rotations[i]));
  });
  assert.deepEqual(readProblems(drawing, read, "tsdraft"), []);
});

test("an attribute's text starts under 1e100 when its point and height together reach it", () => {
  for (const [at, rotation] of [
    [[0, -9e99], 0],
    [[9e99, 0], 90],
  ] as const) {
    const d = createDrawing({ units: "in" });
    d.block("B", {}, () =>
      d.attribute("N", at, { kind: "paragraph", value: "A", width: 10, height: 9e99, rotation }),
    );
    d.insert("B", [0, 0]);
    const numbers = toDXF(d.build()).split("\r\n").map(Number).filter(Number.isFinite);
    assert.ok(
      numbers.every((n) => Math.abs(n) < 1e100),
      String(rotation),
    );
  }
});

test("an attribute of paragraph text is written and read as the leading CAD app's -INSERT makes it", async () => {
  const d = createDrawing({ units: "in" });
  d.textStyle({ name: "NOTES", font: "Arial", widthFactor: 0.8 });
  d.block("NOTE", {}, () =>
    d.attribute("NOTE", [1, 1], {
      kind: "paragraph",
      value: "ALL WORK SHALL COMPLY\nWITH THE CODES",
      width: 3,
      height: 0.25,
      style: "NOTES",
      align: "right",
      valign: "bottom",
      lineSpacing: 2,
    }),
  );
  d.insert("NOTE", [0, 0]);
  d.insert("NOTE", [10, 0], { scale: [2, 0.5], rotation: 30, attributes: { NOTE: "OWN\nVALUE" } });
  d.insert("NOTE", [20, 0], { scale: [-1.5, 1.5], rotation: 45 });
  const drawing = d.build();
  const dxf = toDXF(drawing);
  // The text the attribute would be as a line holds no value, and its paragraph follows it.
  assert.ok(dxf.includes("\r\n71\r\n     4\r\n") || dxf.includes("\r\n71\r\n4\r\n"));
  assert.ok(dxf.includes("\r\n101\r\nEmbedded Object\r\n"));
  assert.ok(dxf.includes("\\W4.0000;OWN\\PVALUE"), "an uneven scale widens by a code");
  const read = await readDXF(dxf, { geometry: true });
  assert.deepEqual(checkDrawingRead(JSON.parse(JSON.stringify(read))), []);
  assert.deepEqual(readProblems(drawing, read, "tsdraft"), []);
  const [definition] = read.blocks.find((b) => b.name === "NOTE")!.attributeDefinitions;
  assert.equal(definition!.default, "ALL WORK SHALL COMPLY\\PWITH THE CODES");
  // Its text starts where a text of no value does: at the bottom, Arial's descent above the point.
  assert.equal(definition!.startFrom, "file");
  assert.equal(definition!.at[0], 1);
  assert.ok(Math.abs(definition!.at[1] - (1 + 0.29604365621 * 0.25)) < 1e-14);
  assert.deepEqual(definition!.paragraph, {
    at: [1, 1],
    height: 0.25,
    width: 3,
    attachment: 9,
    rotation: 0,
    style: "NOTES",
    lineSpacing: 2,
    lineSpacingStyle: "at-least",
  });
  const inserts = read.model.entities!.filter((e) => e.kind === "insert");
  const mirrored = inserts[2]!.kind === "insert" ? inserts[2]!.attributes![0]! : undefined;
  assert.equal(mirrored?.paragraph?.mirrored, true);
  assert.equal(mirrored?.value, "ALL WORK SHALL COMPLY\\PWITH THE CODES");
});

test("a read of an attribute of paragraph text is held to where its text starts", async () => {
  const d = createDrawing({ units: "in" });
  d.block("B", {}, () => d.attribute("N", [1, 2], { kind: "paragraph", value: "A", height: 0.25 }));
  d.insert("B", [10, 5]);
  const drawing = d.build();
  const dxf = toDXF(drawing);
  // The height below the attribute's point, at 11, 7.
  const start = "\r\n10\r\n11\r\n20\r\n6.75\r\n";
  assert.equal(dxf.split(start).length, 2);
  assert.deepEqual(readProblems(drawing, await readDXF(dxf, { geometry: true }), "tsdraft"), []);
  const moved = dxf.replace(start, "\r\n10\r\n11\r\n20\r\n123\r\n");
  assert.deepEqual(readProblems(drawing, await readDXF(moved, { geometry: true }), "tsdraft"), [
    "model space insert #0 attribute N: starts at 11,123, expected 11,6.75",
  ]);
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

  const changed = (fields: Data): Drawing => ({
    ...sheet,
    layouts: [
      {
        ...layout!,
        entities: layout!.entities.map((e, i) =>
          i === at ? wrong<Entity>({ ...dataOf(e), ...fields }) : e,
        ),
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

test("a leaned word wraps as if its ink reached twice its last character's lean further", () => {
  // The least width that holds two words on one line, in Arial capitals of height 1.
  const least = (obliqueAngle: number, widthFactor = 1) => {
    let [lo, hi] = [0, 20];

    for (let i = 0; i < 50; i++) {
      const width = (lo + hi) / 2;

      const { lines } = layoutParagraph({
        value: "HHH HHH",
        height: 1,
        width,
        font: "Arial",
        obliqueAngle,
        widthFactor,
      });

      [lo, hi] = lines.length === 1 ? [lo, width] : [width, hi];
    }

    return hi;
  };

  for (const [angle, factor] of [
    [15, 1],
    [30, 1],
    [15, 0.5],
  ] as const) {
    const further = least(angle, factor) - least(0, factor);
    // Within the rounding of a width as written.
    assert.ok(
      Math.abs(further - 2 * Math.tan((angle * Math.PI) / 180)) < 1e-5,
      `${angle}, ${factor}`,
    );
  }

  // A left lean wraps as an upright word does.
  assert.equal(least(-15), least(0));
});
