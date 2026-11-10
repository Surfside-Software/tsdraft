// Opens tsdraft's DXF output in real AutoCAD and checks that AutoCAD sees what
// was drawn. Parsers such as ezdxf accept files that AutoCAD discards, so this
// is the test that counts for a writer change.
//
//   TSDRAFT_CAD_SSH=user@host pnpm test:cad
//
// The host is a WSL shell on a Windows machine with AutoCAD installed, reached
// over ssh. Nothing touches an open CAD window: each case runs in its own
// accoreconsole.exe, AutoCAD's headless console. For each case AutoCAD opens
// the DXF, runs AUDIT without fixing, and saves its own DXF, which this script
// reads back and compares with the drawing.
//
// Most cases are drawings that must come back as drawn. The others write a
// file that `toDXF` would refuse or `lint` warns about, to show what AutoCAD
// does with it. Those are the reasons behind rules in `src/rules.ts` and
// tables in `src/layers.ts`.
//
// Optional: TSDRAFT_CAD_DIR, a folder on the Windows drive as WSL sees it.
// TSDRAFT_ACCORECONSOLE, the WSL path of accoreconsole.exe.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toDXFR12 } from "../src/dxf-r12.ts";
import { toDXFR2018 } from "../src/dxf-r2018.ts";
import { written, writtenAngle } from "../src/format.ts";
import {
  createDrawing,
  lint,
  toDXF,
  type Drawing,
  type DrawingBuilder,
  type DxfVersion,
  type Entity,
  type Layer,
} from "../src/index.ts";
import { layerKey } from "../src/layers.ts";
import { layerNameProblem, layerTwinProblem, textProblem } from "../src/rules.ts";

const host = process.env.TSDRAFT_CAD_SSH;
if (!host) {
  console.error("Set TSDRAFT_CAD_SSH=user@host to a WSL shell on a Windows machine with AutoCAD.");
  process.exit(1);
}
const remoteDir = process.env.TSDRAFT_CAD_DIR ?? "/mnt/c/Users/Public/tsdraft-cad-check";
const accoreconsole = process.env.TSDRAFT_ACCORECONSOLE ?? "";

const INSUNITS = { in: 1, ft: 2, mm: 4, cm: 5, m: 6 };

/** Everything the library can draw, on layers that use each version's full naming range. */
function everything<V extends DxfVersion>(d: DrawingBuilder<V>, layers: [string, string]): Drawing {
  const [first, second] = layers;
  d.layer(first, { color: 3 }, () => {
    d.rect([0, 0], 75, 120);
    d.polyline([
      [0, 0],
      [10.5, 0],
      [10.5, 5.25],
    ]);
    d.line([-10, -12], [85, -12]);
  });
  d.layer(second, { color: 1 }, () => {
    d.circle([12, 100], 6);
    d.arc([62, 100], 6, 200, 340);
    d.arc([30, 30], 2.5, -90, 450.5);
    d.arc([40, 40], 2.5, 350, 370);
    d.text([2, -6], "LOT 75' x 120'", { height: 3 });
    d.text([2, -20], "Ø 25 – café x^2 日本語 100% <A&B>", { height: 2, rotation: 90 });
    d.text([2, -30], "  spaces kept  ", { height: 1 });
  });
  // CAD ignores case, so this is the first layer again.
  d.layer(first.toUpperCase(), {}, () => {
    d.line([0, 0], [5, 5]);
  });
  return d.build();
}

/** What AutoCAD did with one file. */
interface CadResult {
  readonly log: string;
  /** The DXF AutoCAD saved, or undefined when it saved none. */
  readonly saved: CadDrawing | undefined;
}

interface Case {
  /** The DXF AutoCAD opens. */
  readonly dxf: string;
  /** Throws when AutoCAD did not do what the case expects. */
  readonly check: (result: CadResult) => void;
}

/** A drawing that must pass `lint`, load with no AUDIT errors and come back as drawn. */
function drawn(drawing: Drawing): Case {
  return { dxf: toDXF(drawing), check: (result) => compare(drawing, loaded(result)) };
}

/** A drawing made without the builder, on the layers given after layer `0`. */
function plain(dxf: DxfVersion, layers: readonly Layer[], entities: readonly Entity[]): Drawing {
  return { units: "in", dxf, layers: [{ name: "0", color: 7 }, ...layers], entities };
}

/** Writes a drawing that `toDXF` would refuse, to show what AutoCAD does with it. */
function refused(drawing: Drawing): string {
  assert.ok(
    lint(drawing).some((d) => d.severity === "error"),
    "lint must refuse this drawing",
  );
  return drawing.dxf === "R12" ? toDXFR12(drawing) : toDXFR2018(drawing);
}

/** Repeatable pseudo-random integers below `n`, so every run tests the same strings. */
function sequence(seed: number): (n: number) => number {
  let state = seed;
  return (n) => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return (state >>> 8) % n;
  };
}

/** Every character below U+10000 that `allowed` accepts, in code point order. */
function characters(allowed: (character: string) => boolean): string[] {
  const out: string[] = [];
  for (let code = 0x20; code <= 0xffff; code++) {
    const character = String.fromCharCode(code);
    if (allowed(character)) out.push(character);
  }
  return out;
}

function chunks(items: readonly string[], size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size).join(""));
  return out;
}

/** Sizes, angles and points at the edge of the 6 decimals the writers keep. */
function rounding<V extends DxfVersion>(d: DrawingBuilder<V>): Drawing {
  d.circle([0, 0], 0.000001);
  d.arc([5, 0], 0.0000006, 0, 90);
  d.rect([10, 10], 0.000001, 0.0000006);
  d.text([0, 5], "smallest text", { height: 0.0000006 });
  // Written from 0, because 359.9999996 rounds up to 360.
  d.arc([0, 20], 2, 359.9999996, 90);
  d.arc([5, 20], 2, 90, 359.9999996);
  d.arc([10, 20], 2, 0.0000004, 359.999999);
  // These three have no length once rounded, which lint warns about.
  d.arc([15, 20], 2, 180, 180.0000004);
  d.line([1, 1], [1.0000001, 1]);
  d.polyline([
    [2, 2],
    [2.0000001, 2],
    [2, 2.0000002],
  ]);
  d.text([0, 8], "turned", { height: 1, rotation: 359.9999996 });
  return d.build();
}

/**
 * Numbers as large as AutoCAD reads from DXF, which is anything under 1e100,
 * and in each form the writers print: digits up to 1e21 and an exponent from there.
 */
function largeNumbers<V extends DxfVersion>(d: DrawingBuilder<V>): Drawing {
  // The two ends are 1.8e100 apart, which is more than the view height can be written as.
  d.line([0, 9e99], [3, -9e99]);
  d.circle([1e21, -1e99], 9.999999e99);
  d.line([-9.999999999999998e99, 1.2345678901234568e21], [123456789012345680000, 1e20]);
  d.text([-1e50, 1e50], "tall", { height: 9e99 });
  return d.build();
}

/**
 * Text that looks like the escapes AutoCAD decodes in a DXF string. AutoCAD
 * must hold every one of these character for character.
 */
function escapes<V extends DxfVersion>(d: DrawingBuilder<V>): Drawing {
  const fixed = [
    "\\U+00B0 literal",
    "\\U+000A p",
    "\\u+00b0",
    "\\U+005CU+00B0",
    "\\U+00\\U+00420",
    "\\U+005CU+005CU+00B0",
    "\\U+0000",
    "\\U+D83D\\U+DE00",
    "\\M+18140",
    "\\m+1ABCD",
    "C:\\Users\\U+0041dmin",
    "\\\\U+00B0",
    "é\\U+00E9 \\é",
    "^J",
    "a^ ^^b^",
    "\\",
    "",
  ];
  const pieces = [
    ..."\\\\\\UuMm++005CcB418A^ J%é日x",
    "\\U+00B0",
    "\\u+00b0",
    "\\M+18140",
    "\\m+1ABCD",
    "\\U+005C",
    "\\U+005E",
    "\\U+000A",
    "U+005C",
    "M+18140",
    "\\U+",
    "^J",
    "%%d",
  ];
  const next = sequence(20250);
  const random = Array.from({ length: 400 }, () =>
    Array.from({ length: 1 + next(8) }, () => pieces[next(pieces.length)] ?? "").join(""),
  );
  [...fixed, ...random].forEach((value, i) => d.text([0, i * 2], value, { height: 1 }));
  return d.build();
}

/** Every character `lint` accepts in text, 64 to a line. */
function textCharacters<V extends DxfVersion>(d: DrawingBuilder<V>): Drawing {
  const accepted = characters((c) => textProblem(c) === undefined);
  chunks(accepted, 64).forEach((value, i) => d.text([0, i * 2], value, { height: 1 }));
  return d.build();
}

/** Layer `0` after other layers, which is how a drawing written as a plain object can have it. */
function layerZeroLast(dxf: DxfVersion): Drawing {
  return {
    units: "mm",
    dxf,
    layers: [
      { name: "FIRST", color: 1 },
      { name: "0", color: 5 },
      { name: "LAST", color: 3 },
    ],
    entities: [
      { kind: "line", layer: "FIRST", from: [0, 0], to: [1, 1] },
      { kind: "circle", layer: "0", center: [0, 0], radius: 1 },
      { kind: "line", layer: "LAST", from: [0, 0], to: [2, 1] },
    ],
  };
}

/** The other case of a character, where Unicode gives it exactly one character. */
function otherCases(character: string): string[] {
  const lower = character.toLowerCase();
  const upper = character.toUpperCase();
  return [lower, upper, upper.toLowerCase(), lower.toUpperCase()].filter(
    (other) => other.length === 1 && other !== character,
  );
}

/**
 * Every pair of characters that Unicode relates by case and a layer name can
 * hold, as [declared layer, layer an entity uses]. The names of pair `i` start
 * with `P<i>_`, so no two pairs can be confused.
 */
function casePairs(): [declared: string, used: string][] {
  const usable = new Set(characters((c) => layerNameProblem(`A${c}A`, "R2018") === undefined));
  const seen = new Set<string>();
  const pairs: [string, string][] = [];
  for (const character of usable) {
    for (const other of otherCases(character)) {
      const key = [character, other].sort().join("");
      if (!usable.has(other) || seen.has(key)) continue;
      seen.add(key);
      pairs.push([`P${pairs.length}_${character}`, `P${pairs.length}_${other}`]);
    }
  }
  return pairs;
}

/** One layer per pair, with a line on the pair's other spelling. */
function casePairDrawing(pairs: readonly [string, string][]): Drawing {
  return plain(
    "R2018",
    pairs.map(([declared]) => ({ name: declared, color: 1 })),
    pairs.map(([, used], i) => ({ kind: "line", layer: used, from: [i, 0], to: [i, 1] })),
  );
}

/**
 * AutoCAD must take two names for one layer exactly when `layerKey` does, and
 * its AUDIT must report a duplicate name wherever `lint` would.
 */
function checkCasePairs(pairs: readonly [string, string][], result: CadResult): void {
  const cad = opened(result);
  const duplicates = new Set(
    [...result.log.matchAll(/^Duplicate name "(.*)" in Layer symbol table/gm)].map((m) => m[1]),
  );
  assert.equal(cad.entities.length, pairs.length, "entity count");
  pairs.forEach(([declared, used], i) => {
    const record = cad.entities[i];
    assert.ok(record, `entity ${i}`);
    const same = layerKey(declared) === layerKey(used);
    assert.equal(
      first(record, 8),
      same ? declared : used,
      `${declared} and ${used} are ${same ? "one layer" : "two layers"} to lint`,
    );
    if (layerTwinProblem(used, declared)) {
      assert.ok(
        duplicates.has(declared) || duplicates.has(used),
        `AUDIT reports ${declared} and ${used} as a duplicate name`,
      );
    }
  });
}

/**
 * Pairs of layer names for AUDIT's duplicate check: [name, other name]. The
 * names of pair `i` start with `A<i>_`. AutoCAD keeps both layers of every
 * pair. Its AUDIT must report a duplicate name for exactly the pairs `lint`
 * refuses, which are all but the last group.
 */
function auditPairs(): [string, string][] {
  const softHyphen = "\u00ad";
  // A letter and the letters AUDIT takes it for.
  const spelledOut: [string, string][] = [
    ["ß", "ss"],
    ["ẞ", "ss"],
    ["æ", "ae"],
    ["ᴂ", "ae"],
    ["œ", "oe"],
    ["ĳ", "ij"],
    ["þ", "th"],
    ["ǆ", "dž"],
    ["ǅ", "dž"],
    ["ǉ", "lj"],
    ["ǈ", "lj"],
    ["ǌ", "nj"],
    ["ǋ", "nj"],
    ["ǳ", "dz"],
    ["ǲ", "dz"],
    ["ﬀ", "ff"],
    ["ﬁ", "fi"],
    ["ﬂ", "fl"],
    ["ﬃ", "ffi"],
    ["ﬄ", "ffl"],
    ["ﬆ", "st"],
    ["ȸ", "db"],
    ["ȹ", "qp"],
    ["ʪ", "ls"],
    ["ʫ", "lz"],
    ["ꜳ", "aa"],
    ["ꜵ", "ao"],
    ["ꜷ", "au"],
    ["ꜹ", "av"],
    ["ꜽ", "ay"],
    ["ꝏ", "oo"],
  ];
  const pairs: [string, string][] = [];
  for (const [letter, spelling] of spelledOut) {
    // Alone, in the other letter case, and inside a longer name.
    pairs.push([letter, spelling], [letter.toUpperCase(), spelling.toUpperCase()]);
    pairs.push([`Wall ${letter} 2`, `WALL ${spelling.toUpperCase()} 2`]);
  }
  pairs.push(
    // A composed character and its decomposed form, whatever the order of its marks.
    ["é", "e\u0301"],
    ["CAFÉ au lait", "cafe\u0301 au lait"],
    ["Ångström", "A\u030angstro\u0308m"],
    ["\u1ead", "a\u0302\u0323"],
    ["a\u0323\u0302", "a\u0302\u0323"],
    ["Ÿ", "y\u0308"],
    ["Þórr", "tho\u0301rr"],
    ["ǽ", "ae\u0301"],
    // A soft hyphen inside a name or in front of it.
    [`co${softHyphen}op`, "coop"],
    [`${softHyphen}CO${softHyphen}${softHyphen}OP 2`, "coop 2"],
    [`Haupt${softHyphen}straße`, "HAUPTSTRASSE"],
    // Two names that both end with a soft hyphen, which lint compares like any others.
    [`co${softHyphen}op${softHyphen}`, `coop${softHyphen}`],
    [`coop${softHyphen}${softHyphen}`, `coop${softHyphen}`],
    [`Straße${softHyphen}`, `STRASSE${softHyphen}`],
    [`CAFÉ${softHyphen}`, `cafe\u0301${softHyphen}`],
    [`ΟΔΟΣ${softHyphen}`, `οδος${softHyphen}`],
    // The kinds together.
    [`Ĳssel${softHyphen}ﬂöße`, "IJSSELFLO\u0308SSE"],
    // From here on, AUDIT reports no duplicate and lint refuses nothing.
    ["ß", "sz"],
    ["ǆ", "dz"],
    ["ø", "oe"],
    ["ü", "ue"],
    ["ð", "dh"],
    ["cafe", "café"],
    ["µm", "μm"],
    ["한", "\u1112\u1161\u11ab"],
    ["\u09cb", "\u09c7\u09be"],
    ["É", `E${softHyphen}\u0301`],
    [`coop${softHyphen}`, "coop"],
  );
  // JavaScript has no capital for some of the letters and gives their spelling, which is no pair.
  return pairs
    .filter(([name, other]) => layerKey(name) !== layerKey(other))
    .map(([name, other], i) => [`A${i}_${name}`, `A${i}_${other}`]);
}

/**
 * Longer names, each beside a respelling of itself. `lint` must never refuse
 * a pair that AUDIT does not report, wherever the respelled letters fall.
 */
function auditRespellings(): [string, string][] {
  const softHyphen = "\u00ad";
  // Each row holds spellings AUDIT may take for one another.
  const spellings = [
    ["ss", "ß", "ẞ", "SS"],
    ["ae", "æ", "Æ", "AE"],
    ["oe", "œ", "Œ"],
    ["ij", "ĳ", "Ĳ", "IJ"],
    ["th", "þ", "Þ", "Th"],
    ["dž", "ǆ", "Ǆ", "ǅ", "dz\u030c"],
    ["dz", "ǳ", "ǲ"],
    ["fi", "ﬁ", "FI"],
    ["ffi", "ﬃ", "ﬀi"],
    ["é", "e\u0301", "É", "E\u0301"],
    ["\u1ead", "a\u0323\u0302", "a\u0302\u0323", "â\u0323"],
    ["σ", "ς", "Σ"],
    ["한"],
    ["\u1112\u1161\u11ab"],
    ["x", "X"],
    ["s"],
    ["e"],
    [" "],
    ["-"],
    ["", softHyphen],
  ];
  const next = sequence(1855);
  const spell = (rows: readonly number[]) =>
    rows.map((row) => spellings[row]?.[next(spellings[row]?.length ?? 1)] ?? "").join("");
  return Array.from({ length: 600 }, (_, i): [string, string] => {
    const rows = Array.from({ length: 1 + next(5) }, () => next(spellings.length));
    // One pair in four differs in a whole letter, so not every pair is a respelling.
    const other = rows.map((row) => (next(4 * rows.length) === 0 ? next(spellings.length) : row));
    return [`R${i}_${spell(rows)}_`, `R${i}_${spell(other)}_`];
  });
}

/** One layer for each name of each pair. `lint` refuses the drawing for the pairs it calls duplicates. */
function pairedLayers(pairs: readonly [string, string][]): Drawing {
  return plain(
    "R2018",
    pairs.flat().map((name) => ({ name, color: 1 })),
    [],
  );
}

/** The first names of the pairs that AUDIT reported a duplicate name in. */
function auditDuplicates(pairs: readonly [string, string][], result: CadResult): Set<string> {
  const reported = new Set(
    [...result.log.matchAll(/^Duplicate name "(.*)" in Layer symbol table/gm)].map((m) => m[1]),
  );
  return new Set(
    pairs
      .filter(([name, other]) => reported.has(name) || reported.has(other))
      .map(([name]) => name),
  );
}

/** Layers that differ only by case, with every entity on the spelling that was not declared. */
function layerCase(): Drawing {
  const pairs = casePairs().filter(([declared, used]) => layerKey(declared) === layerKey(used));
  pairs.push(["MixedCase", "mixedcase"], ["CAFÉ", "café"], ["ΑΒΓ", "αβγ"], ["Слой", "СЛОЙ"]);
  return casePairDrawing(pairs);
}

/** Every character `lint` accepts in a layer name, 200 to a name. */
function layerNameCharacters(): Drawing {
  const accepted = characters((c) => layerNameProblem(`A${c}A`, "R2018") === undefined);
  const names = chunks(accepted, 200).map((part, i) => `N${i}_${part}_`);
  return plain(
    "R2018",
    names.map((name, i) => ({ name, color: 1 + (i % 255) })),
    names.map((layer, i) => ({ kind: "line", layer, from: [i, 0], to: [i, 1] })),
  );
}

/** A layer whose name has a character AutoCAD refuses, which costs the whole drawing. */
function discarded(character: string): Case {
  return {
    dxf: refused(plain("R2018", [{ name: `A${character}B`, color: 1 }], [])),
    check: ({ log }) => {
      assert.match(log, /Invalid symbol table record name/);
      assert.match(log, /drawing discarded/);
    },
  };
}

/** AutoCAD reads two exponent digits, so it takes each 1e+100 here for 1e+10 and reports no error. */
function tenThousandMillion(dxf: DxfVersion): Case {
  const drawing = plain(
    dxf,
    [],
    [
      { kind: "line", layer: "0", from: [0, 0], to: [1e100, 1] },
      { kind: "circle", layer: "0", center: [0, 0], radius: 1e100 },
      { kind: "text", layer: "0", at: [0, 0], height: 1e100, rotation: 0, value: "tall" },
    ],
  );
  return {
    dxf: refused(drawing),
    check: (result) => {
      const [line, circle, text] = loaded(result).entities;
      assert.equal(line && Number(first(line, 11)), 1e10, "the end of the line");
      assert.equal(circle && Number(first(circle, 40)), 1e10, "the radius");
      assert.equal(text && Number(first(text, 40)), 1e10, "the text height");
    },
  };
}

function oneText(value: string, height: number): Drawing {
  return plain("R2018", [], [{ kind: "text", layer: "0", at: [0, 0], height, rotation: 0, value }]);
}

const allCasePairs = casePairs();
const allAuditPairs = auditPairs();
const allAuditRespellings = auditRespellings();

const cases: Record<string, Case> = {
  "r12-everything": drawn(
    everything(createDrawing({ units: "ft" }), ["c-prop_$1", "A234567890123456789012345678901"]),
  ),
  "r2018-everything": drawn(
    everything(createDrawing({ units: "ft", dxf: "R2018" }), ["c prop #1 (new).v2", "CAFÉ 日本"]),
  ),
  "r2018-long-name-mm": drawn(
    everything(createDrawing({ units: "mm", dxf: "R2018" }), ["a".repeat(255), "B"]),
  ),
  "r12-empty": drawn(createDrawing().build()),
  "r2018-empty": drawn(createDrawing({ units: "m", dxf: "R2018" }).build()),
  "r12-rounding": drawn(rounding(createDrawing())),
  "r2018-rounding": drawn(rounding(createDrawing({ dxf: "R2018" }))),
  "r12-large-numbers": drawn(largeNumbers(createDrawing())),
  "r2018-large-numbers": {
    dxf: toDXF(largeNumbers(createDrawing({ dxf: "R2018" }))),
    check: (result) => {
      const cad = loaded(result);
      compare(largeNumbers(createDrawing({ dxf: "R2018" })), cad);
      // tsdraft caps the view height it works out, and AutoCAD must read the cap as written.
      assert.ok(
        cad.viewHeight !== undefined && Math.abs(cad.viewHeight / 9.999999999999998e99 - 1) < 1e-9,
        `view height: AutoCAD has ${cad.viewHeight}`,
      );
    },
  },
  "r12-text-escapes": drawn(escapes(createDrawing())),
  "r2018-text-escapes": drawn(escapes(createDrawing({ dxf: "R2018" }))),
  "r12-text-characters": drawn(textCharacters(createDrawing())),
  "r2018-text-characters": drawn(textCharacters(createDrawing({ dxf: "R2018" }))),
  "r12-layer-zero-last": drawn(layerZeroLast("R12")),
  "r2018-layer-zero-last": drawn(layerZeroLast("R2018")),
  "r2018-layer-case": drawn(layerCase()),
  "r2018-layer-name-characters": drawn(layerNameCharacters()),
  // Only an ASCII space is refused at the ends of a name.
  "r2018-layer-name-edge-spaces": drawn(
    plain(
      "R2018",
      [
        { name: "\u00a0A", color: 1 },
        { name: "B\u3000", color: 2 },
        { name: "\u2003C\u2028", color: 3 },
      ],
      [{ kind: "line", layer: "b\u3000", from: [0, 0], to: [1, 1] }],
    ),
  ),

  // From here on, each case writes what `toDXF` refuses or warns about, to show why.
  "r2018-layer-case-pairs": {
    dxf: refused(casePairDrawing(allCasePairs)),
    check: (result) => checkCasePairs(allCasePairs, result),
  },
  "r2018-layer-audit-pairs": {
    dxf: refused(pairedLayers(allAuditPairs)),
    check: (result) => {
      const cad = opened(result);
      const duplicates = auditDuplicates(allAuditPairs, result);
      for (const [name, other] of allAuditPairs) {
        assert.ok(cad.layers.has(layerKey(name)) && cad.layers.has(layerKey(other)), `two layers`);
        assert.equal(
          duplicates.has(name),
          layerTwinProblem(other, name) !== undefined,
          `AUDIT reports ${name} and ${other} as a duplicate name`,
        );
      }
    },
  },
  "r2018-layer-audit-respellings": {
    dxf: refused(pairedLayers(allAuditRespellings)),
    check: (result) => {
      opened(result);
      const duplicates = auditDuplicates(allAuditRespellings, result);
      const refusedPairs = allAuditRespellings.filter(([name, other]) =>
        layerTwinProblem(other, name),
      );
      assert.ok(refusedPairs.length > 200, "lint refuses a good share of the pairs");
      for (const [name, other] of refusedPairs) {
        assert.ok(duplicates.has(name), `AUDIT reports ${name} and ${other} as a duplicate name`);
      }
    },
  },
  "r2018-layer-other-spelling": {
    // An entity that names its layer by the other spelling of a pair gets a layer of its own.
    dxf: refused(
      plain(
        "R2018",
        [
          { name: "straße", color: 1 },
          { name: "café", color: 2 },
        ],
        [
          { kind: "line", layer: "STRASSE", from: [0, 0], to: [1, 1] },
          { kind: "line", layer: "cafe\u0301", from: [0, 0], to: [1, 2] },
        ],
      ),
    ),
    check: (result) => {
      const cad = opened(result);
      assert.deepEqual([...cad.layers.keys()], ["0", "straße", "café", "strasse", "cafe\u0301"]);
      assert.match(result.log, /Duplicate name "STRASSE" in Layer symbol table/);
      assert.match(result.log, /Duplicate name "cafe\u0301" in Layer symbol table/);
      assert.match(result.log, /Total errors found 2 fixed 0/);
    },
  },
  "r2018-layer-name-zero-width-space": discarded("\u200b"),
  "r2018-layer-name-c1-control": discarded("\u0085"),
  "r2018-layer-name-ohm-sign": discarded("\u2126"),
  "r2018-layer-name-coptic": discarded("\u2c80"),
  "r2018-layer-name-private-use": {
    dxf: refused(plain("R2018", [{ name: "A\ue800B", color: 1 }], [])),
    check: (result) => {
      const names = [...opened(result).layers.keys()];
      assert.deepEqual(names, ["0", "a\\m+00000b"], "AutoCAD replaces the character");
    },
  },
  "r2018-text-private-use": {
    dxf: refused(oneText("A\ue800B", 1)),
    check: (result) => {
      const [text] = opened(result).entities;
      assert.equal(text && first(text, 1), "A\\M+00000B", "AutoCAD replaces the character");
    },
  },
  "r2018-text-height-zero": {
    dxf: refused(oneText("tiny", 0.0000004)),
    check: (result) => {
      const [text] = opened(result).entities;
      assert.equal(
        text && Number(first(text, 40)),
        0.2,
        "AutoCAD gives the text its default height",
      );
    },
  },
  "r12-number-of-1e100": tenThousandMillion("R12"),
  "r2018-number-of-1e100": tenThousandMillion("R2018"),
  "r2018-arc-rounded-shut": {
    dxf: refused(
      plain(
        "R2018",
        [],
        [
          {
            kind: "arc",
            layer: "0",
            center: [0, 0],
            radius: 1,
            startAngle: 180.0000004,
            endAngle: 180,
          },
        ],
      ),
    ),
    check: (result) => {
      // The drawing's extents are those of the arc, and they are the single point at 180 degrees.
      const { extents } = opened(result);
      assert.ok(extents, "extents");
      for (const [x, y] of [extents.min, extents.max]) {
        assert.ok(Math.abs(x + 1) < 1e-9 && Math.abs(y) < 1e-9, "the arc has no length");
      }
    },
  },
  "r2018-text-percent": {
    dxf: toDXF(oneText("%%d", 1)),
    check: (result) => {
      const cad = loaded(result);
      const [text] = cad.entities;
      assert.equal(text && first(text, 1), "%%d", "AutoCAD stores the text as written");
      // Three characters of this height are over 2 units wide. A degree sign is a third of one.
      assert.ok(cad.extents && cad.extents.max[0] < 0.5, "AutoCAD draws %%d as one character");
    },
  },
};

const local = mkdtempSync(join(tmpdir(), "tsdraft-cad-"));
try {
  for (const [name, { dxf }] of Object.entries(cases)) {
    writeFileSync(join(local, `${name}.dxf`), dxf);
  }
  // The remote half. accoreconsole writes UTF-16, so the log is converted to UTF-8.
  writeFileSync(
    join(local, "run.sh"),
    `#!/bin/bash
set -u
cd "$(dirname "$0")"
exe="\${1:-}"
# The newest full AutoCAD, or AutoCAD LT when that is all there is.
if [ -z "$exe" ]; then exe=$(ls -d "/mnt/c/Program Files/Autodesk/AutoCAD "*/accoreconsole.exe 2>/dev/null | grep -v " LT " | sort | tail -1); fi
if [ -z "$exe" ]; then exe=$(ls -d "/mnt/c/Program Files/Autodesk/AutoCAD LT "*/accoreconsole.exe 2>/dev/null | sort | tail -1); fi
if [ ! -f "$exe" ]; then echo "accoreconsole.exe not found"; exit 2; fi
echo "using $exe"
win=$(wslpath -w "$PWD")
for dxf in *.dxf; do
  n=\${dxf%.dxf}
  case $n in *.out) continue;; esac
  printf '_.AUDIT\\r\\n_N\\r\\n_.SAVEAS\\r\\nDXF\\r\\n\\r\\n"%s\\\\%s.out.dxf"\\r\\n_.QUIT\\r\\n_Y\\r\\n' "$win" "$n" > "$n.scr"
  timeout 300 "$exe" /i "$win\\\\$n.dxf" /s "$win\\\\$n.scr" /l en-US > "$n.raw" 2>&1
  iconv -f UTF-16LE -t UTF-8 "$n.raw" 2>/dev/null | tr -d '\\r' > "$n.log" || tr -d '\\000\\r' < "$n.raw" > "$n.log"
  rm -f "$n.raw" "$n.scr"
  echo "ran $n"
done
`,
  );

  const run = (cmd: string, args: string[]) =>
    execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  run("ssh", [host, `rm -rf '${remoteDir}' && mkdir -p '${remoteDir}'`]);
  run("scp", ["-q", "-r", `${local}/.`, `${host}:${remoteDir}/`]);
  console.log(run("ssh", [host, `bash '${remoteDir}/run.sh' '${accoreconsole}'`]).trim());
  run("scp", ["-q", "-r", `${host}:${remoteDir}/.`, local]);

  let failed = 0;
  for (const [name, { check }] of Object.entries(cases)) {
    try {
      const out = join(local, `${name}.out.dxf`);
      check({
        log: readFileSync(join(local, `${name}.log`), "utf8"),
        saved: existsSync(out) ? readDxf(readFileSync(out, "utf8")) : undefined,
      });
      console.log(`ok    ${name}`);
    } catch (error) {
      failed++;
      console.log(`FAIL  ${name}: ${(error as Error).message}`);
    }
  }
  if (failed > 0) {
    console.log(
      `${failed} of ${Object.keys(cases).length} cases failed. Logs are in ${remoteDir} on ${host}.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`AutoCAD did what all ${Object.keys(cases).length} cases expect.`);
  }
} finally {
  rmSync(local, { recursive: true, force: true });
}

interface DxfRecord {
  readonly type: string;
  /** Every value for a group code, in file order. */
  readonly groups: Map<number, string[]>;
}

interface CadDrawing {
  readonly insunits: number | undefined;
  /** `$EXTMIN` and `$EXTMAX`, which AutoCAD works out from what it draws. Undefined when it drew nothing. */
  readonly extents: { readonly min: [number, number]; readonly max: [number, number] } | undefined;
  /** The height of the `*Active` viewport, which is the view the drawing opens on. */
  readonly viewHeight: number | undefined;
  /** Color by `layerKey`. AutoCAD ignores case, and upper-cases names from an R12 file. */
  readonly layers: Map<string, number>;
  readonly entities: DxfRecord[];
}

/** The drawing AutoCAD saved, for a file it must not discard. */
function opened({ log, saved }: CadResult): CadDrawing {
  const rejection = log.split("\n").find((l) => /invalid|improper|error in|read error/i.test(l));
  assert.ok(!rejection, `AutoCAD rejected the file: ${rejection}`);
  assert.ok(saved, "AutoCAD saved no DXF");
  return saved;
}

/** The drawing AutoCAD saved, for a file it must open with no AUDIT errors. */
function loaded(result: CadResult): CadDrawing {
  const cad = opened(result);
  assert.match(result.log, /Total errors found 0 fixed 0/, "AUDIT found errors");
  return cad;
}

/** Reads the parts of an AutoCAD-written DXF that the comparison needs. */
function readDxf(text: string): CadDrawing {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i]), lines[i + 1] ?? ""]);

  let section = "";
  let table = "";
  let insunits: number | undefined;
  let viewHeight: number | undefined;
  const corner = (name: string): [number, number] | undefined => {
    const at = pairs.findIndex(([code, value]) => code === 9 && value === name);
    return at < 0 ? undefined : [Number(pairs[at + 1]?.[1]), Number(pairs[at + 2]?.[1])];
  };
  const min = corner("$EXTMIN");
  const max = corner("$EXTMAX");
  // AutoCAD writes extents of 1e20 and -1e20 for a drawing with nothing to draw.
  const extents = min && max && min[0] <= max[0] ? { min, max } : undefined;
  const layers = new Map<string, number>();
  const entities: DxfRecord[] = [];
  let current: DxfRecord | undefined;
  const close = () => {
    if (!current) return;
    if (section === "ENTITIES") entities.push(current);
    if (section === "TABLES" && current.type === "VPORT") viewHeight = Number(first(current, 40));
    if (section === "TABLES" && table === "LAYER" && current.type === "LAYER") {
      layers.set(layerKey(plainCaret(first(current, 2))), Number(first(current, 62)));
    }
    current = undefined;
  };
  pairs.forEach(([code, value], i) => {
    if (code === 0) {
      close();
      if (value === "SECTION") section = pairs[i + 1]?.[1] ?? "";
      else if (value === "TABLE") table = pairs[i + 1]?.[1] ?? "";
      else if (value !== "ENDSEC" && value !== "ENDTAB")
        current = { type: value, groups: new Map() };
      return;
    }
    if (section === "HEADER" && code === 9 && value === "$INSUNITS") {
      insunits = Number(pairs[i + 1]?.[1]);
    }
    if (current) current.groups.set(code, [...(current.groups.get(code) ?? []), value]);
  });
  return { insunits, extents, viewHeight, layers, entities };
}

function first(record: DxfRecord, code: number): string {
  return record.groups.get(code)?.[0] ?? "";
}

/** AutoCAD writes a literal caret as a caret and a space. */
function plainCaret(value: string): string {
  return value.replaceAll("^ ", "^");
}

function compare(drawing: Drawing, cad: CadDrawing): void {
  if (drawing.dxf === "R2018") {
    assert.equal(cad.insunits, INSUNITS[drawing.units], "$INSUNITS");
  }
  // An entity on a name AutoCAD does not take for a declared layer would add a layer here.
  assert.equal(cad.layers.size, drawing.layers.length, "layer count");
  for (const layer of drawing.layers) {
    assert.equal(cad.layers.get(layerKey(layer.name)), layer.color, `color of layer ${layer.name}`);
  }
  assert.equal(cad.entities.length, drawing.entities.length, "entity count");
  drawing.entities.forEach((entity, i) => {
    const record = cad.entities[i];
    assert.ok(record, `entity ${i}`);
    const label = `${entity.kind} #${i}`;
    assert.equal(layerKey(plainCaret(first(record, 8))), layerKey(entity.layer), `${label} layer`);
    const [type, expected] = expectedGroups(entity);
    assert.equal(record.type, type, `${label} type`);
    if (entity.kind === "text") {
      // AutoCAD leaves out a rotation of 0, and brings one from an R12 file into 0 to 360.
      const turned = Number(first(record, 50) || "0") - written(entity.rotation);
      assert.ok(
        Math.abs(turned - 360 * Math.round(turned / 360)) <= 1e-9,
        `${label} rotation: expected ${entity.rotation}, AutoCAD has ${first(record, 50) || "0"}`,
      );
    }
    for (const [code, values] of expected) {
      const actual: string[] = record.groups.get(code) ?? [];
      assert.equal(actual.length, values.length, `${label} group ${code} count`);
      values.forEach((value, n) => {
        if (typeof value === "string") {
          assert.equal(plainCaret(actual[n] ?? ""), value, `${label} group ${code}`);
        } else {
          // AutoCAD must have the number as written, give or take what a double can hold.
          const expected = written(value);
          assert.ok(
            Math.abs(Number(actual[n]) - expected) <= 1e-9 * Math.max(1, Math.abs(expected)),
            `${label} group ${code}: expected ${expected}, AutoCAD has ${actual[n]}`,
          );
        }
      });
    }
  });
}

/** The DXF type AutoCAD holds an entity as, and the group values it must have. */
function expectedGroups(e: Entity): [string, Map<number, (string | number)[]>] {
  switch (e.kind) {
    case "line":
      return [
        "LINE",
        new Map([
          [10, [e.from[0]]],
          [20, [e.from[1]]],
          [11, [e.to[0]]],
          [21, [e.to[1]]],
        ]),
      ];
    case "polyline":
      // AutoCAD converts an R12 POLYLINE to LWPOLYLINE when it loads the file.
      return [
        "LWPOLYLINE",
        new Map([
          [90, [e.points.length]],
          [70, [e.closed ? 1 : 0]],
          [10, e.points.map((p) => p[0])],
          [20, e.points.map((p) => p[1])],
        ]),
      ];
    case "circle":
      return [
        "CIRCLE",
        new Map([
          [10, [e.center[0]]],
          [20, [e.center[1]]],
          [40, [e.radius]],
        ]),
      ];
    case "arc":
      return [
        "ARC",
        new Map([
          [10, [e.center[0]]],
          [20, [e.center[1]]],
          [40, [e.radius]],
          [50, [writtenAngle(e.startAngle)]],
          [51, [writtenAngle(e.endAngle)]],
        ]),
      ];
    case "text":
      return [
        "TEXT",
        new Map<number, (string | number)[]>([
          [10, [e.at[0]]],
          [20, [e.at[1]]],
          [40, [e.height]],
          [1, [e.value]],
        ]),
      ];
  }
}
