import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILT_IN_STANDARD,
  createDrawing,
  defineStandard,
  findLeaderStyle,
  leaderPicture,
  lineSpacing,
  lint,
  toDXF,
  toSVG,
  type Drawing,
  type Leader,
  type LeaderStyle,
} from "../src/index.ts";
import { referencedByKey } from "../src/blocks.ts";
import { extents } from "../src/extents.ts";

const STYLE = { textHeight: 0.1, arrowSize: 0.12, landing: 0.2, gap: 0.05 } as const;

/** A drawing with the style `NOTES` and whatever `draw` adds. */
function noted(draw: (d: ReturnType<typeof createDrawing>) => void, change: object = {}) {
  const d = createDrawing();
  d.leaderStyle({ name: "NOTES", ...STYLE, ...change });
  draw(d);
  return d.build();
}

// Each `@ts-expect-error` below proves the compiler rejects the literal. The `assert.throws`
// around it proves the same mistake is caught when the code runs.
test("a leader style and a leader are checked as literals and when the code runs", () => {
  const d = createDrawing();
  // @ts-expect-error: a leader style's name follows the rules of layer names.
  assert.throws(() => d.leaderStyle({ ...STYLE, name: "A/B" }), /Leader style names cannot/);
  // @ts-expect-error: Standard is the leading CAD app's own.
  assert.throws(() => d.leaderStyle({ ...STYLE, name: "standard" }), /cannot be defined/);
  // @ts-expect-error: an arrowhead is one of LEADER_ARROWHEADS.
  assert.throws(() => d.leaderStyle({ ...STYLE, name: "A", arrowhead: "tick" }), /LEADER_ARROW/);
  // @ts-expect-error: a size is not less than 0.
  assert.throws(() => d.leaderStyle({ ...STYLE, name: "A", gap: -1 }), /gap: .*less than 0/);
  // @ts-expect-error: a text has a height.
  assert.throws(() => d.leaderStyle({ ...STYLE, name: "A", textHeight: 0 }), /textHeight/);
  // @ts-expect-error: a scale is above 0.
  assert.throws(() => d.leaderStyle({ ...STYLE, name: "A", scale: 0 }), /scale: .*greater than 0/);
  d.leaderStyle({ ...STYLE, name: "NOTES", arrowhead: "dot", attachment: "last-line" });
  assert.throws(() => d.leaderStyle({ ...STYLE, name: "notes" }), /already has a leader style/);

  const at = [1, 1] as const;
  // @ts-expect-error: the leading CAD app reads a backslash as the start of a code of the note's format.
  assert.throws(() => d.leader("A\\B", { style: "NOTES", at, to: [0, 0] }), /cannot contain \\/);
  // @ts-expect-error: and a brace as a group of its format, in any line.
  assert.throws(() => d.leader(["A", "{B}"], { style: "NOTES", at, to: [0, 0] }), /\{ or \}/);
  // @ts-expect-error: a note needs a line with something on it.
  assert.throws(() => d.leader(["", " "], { style: "NOTES", at, to: [0, 0] }), /is not empty/);
  // @ts-expect-error: a leader names a style the drawing has.
  assert.throws(() => d.leader("A", { style: "Standard", at, to: [0, 0] }), /CAD app's own/);
  assert.throws(() => d.leader("A", { style: "OTHER", at, to: [0, 0] }), /not defined/);
  // @ts-expect-error: and its sizes of its own are sizes.
  assert.throws(() => d.leader("A", { style: "NOTES", at, to: [0, 0], arrowSize: -1 }), /0/);
  // @ts-expect-error: and it names a shaft.
  assert.throws(() => d.leader("A", { style: "NOTES", at, to: [] }), /needs a shaft/);
  assert.throws(() => d.leader("A", { style: "NOTES", at, to: [1, 1] }), /one point/);
  assert.throws(() => d.leader("A", { style: "NOTES", at, to: [0, 0], textStyle: "NONE" }), /NONE/);
  d.leader("A", {
    style: "notes",
    at,
    to: [
      [0, 0],
      [
        [2, 0],
        [1.5, 0.5],
      ],
    ],
    landing: 0,
  });

  const r12 = createDrawing({ dxf: "R12" });
  // @ts-expect-error: R12 drawings have no leaders.
  assert.throws(() => r12.leaderStyle({ ...STYLE, name: "A" }), /no leaders to R12/);
  // @ts-expect-error: nor a leader.
  assert.throws(() => r12.leader("A", { style: "A", at, to: [0, 0] }), /no leaders to R12/);
  // A leader belongs to a space, and not to a block.
  assert.throws(
    () => d.block("NOTE", {}, () => d.leader("A", { style: "NOTES", at, to: [0, 0] })),
    /cannot be in a block/,
  );
});

test("lint finds what the builder refuses, in a drawing built by hand", () => {
  const drawing = noted((d) => d.leader("A", { style: "NOTES", at: [1, 1], to: [0, 0] }));
  assert.deepEqual(lint(drawing), []);
  const leader = drawing.entities[0] as Leader;
  const rules = (entities: readonly Leader[], change: Partial<Drawing> = {}) =>
    lint({ ...drawing, ...change, entities }).map((found) => found.rule);
  assert.deepEqual(rules([{ ...leader, style: "OTHER" }]), ["undefined-leader-style"]);
  assert.deepEqual(rules([{ ...leader, text: ["A{B}"] }]), ["leader"]);
  assert.deepEqual(rules([{ ...leader, shafts: [[[1, 1]]] }]), ["leader"]);
  assert.deepEqual(rules([{ ...leader, side: "up" as never }]), ["leader"]);
  assert.deepEqual(rules([{ ...leader, textStyle: "NONE" }]), ["undefined-text-style"]);
  assert.deepEqual(rules([leader], { dxf: "R12" }), ["leader-style", "leader"]);
  const style = drawing.leaderStyles![0]!;
  assert.deepEqual(rules([leader], { leaderStyles: [style, { ...style, name: "notes" }] }), [
    "duplicate-leader-style",
  ]);
  // A leader in a block is refused, and one with a style of a name the leading CAD app keeps for its own.
  assert.deepEqual(
    lint({ ...drawing, blocks: [{ name: "B", entities: [leader] }] }).map((found) => found.rule),
    ["leader"],
  );
  assert.deepEqual(rules([leader], { leaderStyles: [{ ...style, name: "Standard" }] }).sort(), [
    "leader-style",
    "undefined-leader-style",
  ]);
});

test("a leader is drawn where the leading CAD app draws it", () => {
  const style: LeaderStyle = { name: "S", ...STYLE, scale: 2 };
  const leader: Leader = {
    kind: "leader",
    layer: "0",
    style: "S",
    text: ["ONE", "TWO", "THREE"],
    at: [10, 5],
    shafts: [
      [[6, 2]],
      [
        [7, 0],
        [9, 1],
      ],
    ],
  };
  const right = leaderPicture(leader, style);
  // Each size is the style's times its scale.
  assert.deepEqual(right.sizes, { textHeight: 0.2, arrowSize: 0.24, landing: 0.4, gap: 0.1 });
  // The note is on the side away from the shaft, and the landing runs there from `at`.
  assert.equal(right.side, "right");
  assert.deepEqual(right.landing, [
    [10, 5],
    [10.4, 5],
  ]);
  // A closed filled arrowhead is a third as wide as it is long, and the shaft starts at its base.
  const [tip, ...base] = right.arrowheads[0]!.filled;
  assert.deepEqual(tip, [6, 2]);
  const along = [0.8, 0.6] as const;
  const start = right.shafts[0]![0]!;
  assert.ok(Math.abs(start[0] - (6 + along[0] * 0.24)) < 1e-12);
  assert.ok(Math.abs(start[1] - (2 + along[1] * 0.24)) < 1e-12);
  assert.ok(
    Math.abs(Math.hypot(base[0]![0] - base[1]![0], base[0]![1] - base[1]![1]) - 0.08) < 1e-12,
  );
  // The second shaft runs from its tip through its bend to `at`.
  assert.deepEqual(right.shafts[1]!.slice(1), [
    [9, 1],
    [10, 5],
  ]);
  // The middle of the first line's capitals is level with `at`, the lines 5/3 of the height apart.
  const pitch = lineSpacing(0.2);
  assert.deepEqual(right.location, [10.5, 5.1]);
  assert.deepEqual(
    right.lines.map((line) => [line.align, line.at[0], Number((line.at[1] - 5).toFixed(12))]),
    [
      ["left", 10.5, -0.1],
      ["left", 10.5, Number((-0.1 - pitch).toFixed(12))],
      ["left", 10.5, Number((-0.1 - 2 * pitch).toFixed(12))],
    ],
  );
  // On the left, held by its last line, the note is justified right.
  const left = leaderPicture({ ...leader, side: "left", attachment: "last-line" }, style);
  assert.equal(left.direction, -1);
  assert.ok(Math.abs(left.lines.at(-1)!.at[1] - 4.9) < 1e-12);
  assert.deepEqual(
    left.lines.map((line) => [line.align, line.at[0]]),
    left.lines.map(() => ["right", 9.5]),
  );
  // A dot is a disk as wide as the arrow size, and with no arrowhead the shaft runs to the tip.
  const dot = leaderPicture(leader, { ...style, arrowhead: "dot" }).arrowheads[0]!;
  assert.deepEqual(
    dot.disks.map((disk) => disk.radius),
    [0.12],
  );
  const none = leaderPicture(leader, { ...style, arrowhead: "none" });
  assert.deepEqual(none.shafts[0]![0], [6, 2]);
  assert.equal(none.arrowheads[0]!.lines.length + none.arrowheads[0]!.filled.length, 0);
  const open = leaderPicture(leader, { ...style, arrowhead: "open" });
  assert.equal(open.arrowheads[0]!.lines.length, 3);
  // Its own sizes take the place of the style's, and the scale multiplies them too.
  assert.equal(leaderPicture({ ...leader, landing: 0 }, style).landing, undefined);
  assert.equal(leaderPicture({ ...leader, textHeight: 0.05 }, style).sizes.textHeight, 0.1);
});

test("a dot through an insert that scales unevenly is drawn as an ellipse", () => {
  const base = noted((d) => d.leader("A", { style: "NOTES", at: [1, 1], to: [0, 0] }), {
    arrowhead: "dot",
    arrowSize: 2,
  });
  const host = createDrawing()
    .xref("BASE", "base.dwg")
    .insert("BASE", [0, 0], { scale: [2, 1] });
  assert.match(
    toSVG(host.build(), { xrefs: { BASE: base } }),
    /<ellipse [^>]*rx="2" ry="1" fill="[^"]+" stroke="none" data-part="arrowhead"\/>/,
  );
});

test("the extents hold a dot that an insert turns and stretches into an ellipse", () => {
  const base = noted((d) => d.leader("A", { style: "NOTES", at: [1, 1], to: [0, 0] }), {
    arrowhead: "dot",
    arrowSize: 4,
  });
  const host = createDrawing()
    .xref("BASE", "base.dwg")
    .insert("BASE", [0, 0], { scale: [3, 1], rotation: 45 })
    .build();
  const xrefs = referencedByKey(host, { BASE: base });
  const [minX, minY] = extents(host.entities, [], host.blocks, undefined, undefined, xrefs);
  // A dot of radius 2 becomes an ellipse 6 by 2, turned 45 degrees, which reaches √20 past its center on every side.
  assert.ok(minX <= -Math.sqrt(20) + 1e-9, `${minX}`);
  assert.ok(minY <= -Math.sqrt(20) + 1e-9, `${minY}`);
});

test("a leader's sizes of its own are written as its own, not as a style", () => {
  const drawing = noted((d) => {
    d.leader("PLAIN", { style: "NOTES", at: [1, 1], to: [0, 0] });
    d.leader("OWN", {
      style: "NOTES",
      at: [3, 1],
      to: [2, 0],
      textHeight: 0.05,
      arrowSize: 0.04,
      landing: 0.06,
      gap: 0.02,
      attachment: "last-line",
    });
  });
  const dxf = toDXF(drawing);
  const flags = [
    ...dxf.matchAll(/\r\nAcDbMLeader[\s\S]*?\r\n301\r\n\}\r\n340\r\n[0-9A-F]+\r\n90\r\n(\d+)\r\n/g),
  ].map(([, value]) => Number(value));
  // Content, text alignment and text always, and then each size and attachment set.
  const always = (1 << 10) | (1 << 14) | (1 << 18);
  assert.deepEqual(flags, [
    always,
    always | (1 << 5) | (1 << 7) | (1 << 9) | (1 << 12) | (1 << 16) | (1 << 25),
  ]);
  assert.equal(dxf.match(/\r\nMLEADERSTYLE\r\n/g)?.length, 2 + 1); // the class, Standard and NOTES
  assert.equal(findLeaderStyle(drawing, "notes")?.name, "NOTES");
});

const standard = defineStandard({
  id: "leaders",
  version: "1",
  extends: BUILT_IN_STANDARD,
  textRoles: { small: { font: "Arial", height: 0.0625 } },
  leaderStyles: { notes: { role: "note", arrowSize: 0.125, landing: 0.125, gap: 0.0625 } },
  defaultLeaderStyle: "notes",
});

test("under a standard a leader names its style by id, and model space has one for each scale", () => {
  const d = createDrawing({ standard, units: "ft" });
  const plan = d.view("plan", { scale: "1in-10ft" });
  d.layer("C-ANNO-TEXT", () => {
    d.leader("IN THE PLAN", { view: plan, at: [10, 10], to: [5, 5] });
    d.leader("SMALLER", { view: plan, at: [10, 20], to: [5, 15], role: "small", arrowSize: 0.05 });
    d.leader("SAME", { style: "notes", role: "note", view: plan, at: [10, 30], to: [5, 25] });
    assert.throws(
      // @ts-expect-error: a standard's leaders name their styles by id.
      () => d.leader("A", { style: "OTHER", view: plan, at: [1, 1], to: [0, 0] }),
      /not a leader style/,
    );
    assert.throws(
      // @ts-expect-error: and their notes take a role, not a text height.
      () => d.leader("A", { view: plan, at: [1, 1], to: [0, 0], textHeight: 1 }),
      /role/,
    );
    assert.throws(() => d.leader("A", { at: [1, 1], to: [0, 0] }), /names the view/);
    assert.throws(
      // @ts-expect-error: a size of its own is a size.
      () => d.leader("A", { view: plan, at: [1, 1], to: [0, 0], arrowSize: -1 }),
      /less than 0/,
    );
    // @ts-expect-error: and it names a shaft.
    assert.throws(() => d.leader("A", { view: plan, at: [1, 1], to: [] }), /needs a shaft/);
  });
  // @ts-expect-error: a drawing under a standard defines no leader style.
  assert.throws(() => d.leaderStyle({ ...STYLE, name: "A" }), /leaderStyles in defineStandard/);
  const drawing = d.build();
  const [style] = drawing.leaderStyles!;
  assert.equal(style!.name, "NOTES-1in-10ft");
  assert.equal(style!.textStyle, "NOTE");
  assert.ok(Math.abs(style!.scale! - 10) < 1e-12);
  const [, smaller, same] = drawing.entities as Leader[];
  assert.equal(smaller!.textStyle, "SMALL");
  assert.equal(smaller!.textHeight, 0.0625);
  assert.equal(smaller!.arrowSize, 0.05);
  assert.equal(same!.textStyle, undefined);
  assert.deepEqual(
    lint(drawing, { standard }).filter((found) => found.severity === "error"),
    [],
  );

  // lint holds a leader style to the standard, and a leader to the scale its viewport shows.
  const changed = {
    ...drawing,
    leaderStyles: [
      { ...style!, gap: 0.1 },
      { ...style!, name: "OWN" },
    ],
  };
  const rules = lint(changed, { standard }).map((found) => found.rule);
  assert.ok(rules.includes("leader-style-differs-from-standard"));
  assert.ok(rules.includes("leader-style-outside-standard"));
  const shown = createDrawing({ standard, units: "ft" });
  const view = shown.view("plan", { scale: "1in-20ft" });
  shown.layout("A-101", (sheet) => {
    sheet.viewport([1, 1], 10, 10, { view, center: [10, 10] });
  });
  const off = { ...shown.build(), leaderStyles: drawing.leaderStyles!, entities: drawing.entities };
  const offRules = lint(off, { standard }).map((found) => found.rule);
  assert.ok(
    offRules.includes("leader-off-scale"),
    "a leader in the style for 1in-10ft is off in a viewport at 1in-20ft",
  );
  // Its note plots at half its role's height there, which that error already says.
  assert.ok(!offRules.includes("height-off-role"));
});

test("under a standard a leader's note is held to its role and to the least height", () => {
  const d = createDrawing({ standard, units: "ft" });
  const plan = d.view("plan", { scale: "1in-10ft" });
  d.layer("C-ANNO-TEXT", () => {
    d.leader(["IN THE", "PLAN"], { view: plan, at: [10, 10], to: [5, 5] });
    d.leader("SMALL", { view: plan, role: "small", at: [10, 20], to: [5, 15] });
  });
  d.layout("A-101", (sheet) => {
    sheet.viewport([2, 2], 10, 10, { view: plan, center: [10, 10] });
    d.layer("C-ANNO-TEXT", () => d.leader("ON PAPER", { at: [14, 4], to: [13, 3] }));
  });
  const drawing = d.build();
  const errors = (change: Partial<Leader>, layout = false) => {
    const sheet = drawing.layouts![0]!;
    const changed: Drawing = layout
      ? {
          ...drawing,
          layouts: [
            {
              ...sheet,
              entities: [
                ...sheet.entities.slice(0, -1),
                { ...sheet.entities.at(-1)!, ...change } as Leader,
              ],
            },
          ],
        }
      : {
          ...drawing,
          entities: [{ ...(drawing.entities[0] as Leader), ...change }, drawing.entities[1]!],
        };
    return lint(changed, { standard })
      .filter((found) => found.severity === "error")
      .map((found) => found.rule);
  };
  assert.deepEqual(errors({}), []);
  // A text height of its own, in the viewport and on the sheet: each line of the note.
  const below = ["height-off-role", "height-below-standard"];
  assert.deepEqual(errors({ textHeight: 0.001 }), [...below, ...below]);
  assert.deepEqual(errors({ textHeight: 0.001 }, true), below);
  // A text style that is a role's, at another role's height, and one that is no role's.
  assert.deepEqual(errors({ textStyle: "SMALL", textHeight: 0.2 }), [
    "height-off-role",
    "height-off-role",
  ]);
  assert.deepEqual(errors({ textStyle: "Standard" }), ["text-style-outside-standard"]);
});

test("a leader style at a height other than its role's is reported once, not for each line", () => {
  const d = createDrawing({ standard, units: "ft" });
  const plan = d.view("plan", { scale: "1in-10ft" });
  d.layer("C-ANNO-TEXT", () => {
    d.leader(["ONE", "TWO"], { view: plan, at: [10, 10], to: [5, 5] });
    d.leader("SMALL", { view: plan, role: "small", at: [10, 20], to: [5, 15] });
  });
  d.layout("A-101", (sheet) => {
    sheet.viewport([2, 2], 10, 10, { view: plan, center: [10, 10] });
  });
  const drawing = d.build();
  const taller = {
    ...drawing,
    leaderStyles: [{ ...drawing.leaderStyles![0]!, textHeight: 0.125 }],
  };
  // A leader with a height of its own is still held to its role.
  assert.deepEqual(
    lint(taller, { standard })
      .filter((found) => found.severity === "error")
      .map((found) => found.rule),
    ["leader-style-differs-from-standard"],
  );
  // The same holds for a style in another role's text style.
  const restyled = {
    ...drawing,
    leaderStyles: [{ ...drawing.leaderStyles![0]!, textStyle: "SMALL" }],
  };
  assert.deepEqual(
    lint(restyled, { standard })
      .filter((found) => found.severity === "error")
      .map((found) => found.rule),
    ["leader-style-differs-from-standard"],
  );
});
