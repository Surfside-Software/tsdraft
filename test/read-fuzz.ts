// The DXF reader's fuzz: files bent group by group and byte by byte, each read under a time
// limit. Each read gives a `DrawingRead` that `checkDrawingRead` passes, or a `ReadError`, and
// nothing else; its answer stays within the command's size; and its document gives the file
// back byte for byte. test/read-fuzz.test.ts runs a fixed set of seeds.
//
// The long pass, from new seeds and with any DXF files beside the core's own, under a memory
// cap and with no core dump:
//   prlimit --core=1:1 -- node test/read-fuzz.ts --seed 7 --runs 20000 [file.dxf ...]
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import kitchen from "../examples/outdoor-kitchen.ts";
import sheet from "../examples/site-plan.ts";
import {
  checkDrawingRead,
  createDrawing,
  ReadError,
  toDXF,
  type DrawingRead,
} from "../src/index.ts";
import type { DxfDocument } from "../src/read/document.ts";
import { READ_LIMITS, readDXFDocument, readDXFWithin } from "../src/read/dxf.ts";
import { timeLimit } from "./time-limit.ts";

/** A random number from 0 up to 1, the same for a seed. */
export function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2 ** 32;
  };
}

type Group = [code: string, value: string];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The groups of a file, as lines two by two. */
const groupsOf = (text: string): Group[] => {
  const lines = text.split(/\r?\n/);
  const out: Group[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([lines[i]!, lines[i + 1]!]);
  return out;
};

const textOf = (groups: readonly Group[]): string =>
  groups.map(([code, value]) => `${code}\r\n${value}\r\n`).join("");

/** The files the fuzz starts from: what toDXF writes of the examples and of a few drawings. */
export function seedFiles(): Uint8Array[] {
  const d = createDrawing({ units: "ft", dxf: "R12" });
  d.layer("A", { color: 1 }, () => {
    d.text([0, 0], "A", { height: 1 });
    d.polyline([
      [0, 0],
      [1, 1],
    ]);
  });
  // Images in model space and in a block, clipped both ways, with their objects.
  const images = createDrawing({ units: "ft" });
  images.block("LOGO", {}, () =>
    images.layer("0", {}, () => images.image("logo.png", [0, 0], { pixels: [8, 4], width: 2 })),
  );
  images.layer("A", { color: 1 }, () => {
    images.image("a.png", [0, 0], {
      pixels: [4, 2],
      width: 4,
      clip: [
        [1, 0.5],
        [3, 1.5],
      ],
    });
    images.image("b/a.png", [5, 0], {
      pixels: [4, 4],
      width: 4,
      invertClip: true,
      clip: [
        [6, 1],
        [8, 1],
        [7, 3],
      ],
    });
    images.insert("LOGO", [0, 10]);
  });
  // Tables of two styles, with spans, blocks, fills and a cell's own sizes.
  const tables = createDrawing({ units: "in" });
  tables.block("TAG", {}, () => tables.circle([0, 0], 0.2));
  tables.tableStyle({ name: "PLAIN", textHeight: 0.18, header: { fill: 8, lineweight: 0.35 } });
  tables.table({
    style: "PLAIN",
    at: [0, 10],
    rotation: 30,
    columns: [0.6, 1.1],
    title: "SCHEDULE",
    header: ["MARK", { block: "TAG" }],
    rows: [
      [
        { text: "D1", rowSpan: 2, align: "left" },
        { block: "TAG", blockScale: 0.5 },
      ],
      [null, { text: "A LONG NOTE\\PTWO", fill: 3, color: 1, textHeight: 0.1 }],
    ],
  });
  // Ellipses and splines of each kind, in model space and in a block.
  const curves = createDrawing({ units: "ft" });
  curves.block("CURVE", {}, () => curves.layer("0", {}, () => curves.ellipse([0, 0], [2, 1], 0.5)));
  curves.layer("C", { color: 3 }, () => {
    curves.ellipse([0, 0], [3, 0], 0.4, { startParameter: 300, endParameter: 60 });
    curves.spline([
      [0, 0],
      [4, 2],
      [8, 1],
    ]);
    curves.spline(
      [
        [0, 5],
        [3, 8],
        [6, 5],
      ],
      { closed: true },
    );
    curves.spline(
      [
        [0, 9],
        [4, 10],
      ],
      { startTangent: [0, 1], endTangent: [1, 0] },
    );
    curves.controlSpline(
      [
        [0, 0],
        [0, 2],
        [2, 2],
      ],
      { degree: 2, weights: [1, Math.SQRT1_2, 1] },
    );
    curves.controlSpline(
      [
        [5, 0],
        [6, 2],
        [7, 0],
        [8, 2],
      ],
      { closed: true },
    );
    curves.insert("CURVE", [10, 10]);
  });
  return [
    ...[
      toDXF(sheet),
      toDXF(kitchen),
      toDXF(d.build(), { version: "R12" }),
      toDXF(images.build()),
      toDXF(tables.build()),
      toDXF(curves.build()),
    ].map((t) => encoder.encode(t)),
    leaderFile(),
  ];
}

type Pair = readonly [code: number, value: string | number];

/** A multileader's record, with a note or a block, from its roots: each a list of shafts. */
function multileaderRecord(
  handle: string,
  roots: readonly (readonly (readonly Pair[])[])[],
  options: { block?: boolean; shaft?: number; labels?: readonly string[] },
): Pair[] {
  const out: Pair[] = [
    [0, "MULTILEADER"],
    [5, handle],
    [8, "0"],
    [100, "AcDbMLeader"],
  ];
  out.push([270, 2], [300, "CONTEXT_DATA{"], [40, 1], [10, 5], [20, 5], [30, 0], [41, 0.18]);
  out.push([140, 0.18], [145, 0.09], [174, 1], [175, 1], [176, 0], [177, 0]);
  if (options.block) {
    out.push([290, 0], [296, 1], [341, "1F"], [14, 0], [24, 0], [34, 1], [15, 6], [25, 5]);
    out.push([35, 0], [16, 2], [26, 2], [36, 2], [46, 0.5], [93, -1056964608]);
    for (let i = 0; i < 16; i++) out.push([47, i % 5 === 0 ? 1 : 0]);
  } else {
    out.push([290, 1], [304, "NOTE\\PTWO"], [11, 0], [21, 0], [31, 1], [340, "11"]);
    out.push([12, 6], [22, 5], [32, 0], [13, 1], [23, 0], [33, 0], [42, 0], [43, 2], [44, 0]);
    out.push([45, 1], [170, 1], [90, -1073741824], [171, 1], [172, 5], [91, -1023410175]);
    out.push([141, 1.5], [92, 0], [291, 0], [292, 1], [293, 0], [294, 0], [296, 0]);
  }
  out.push([110, 0], [120, 0], [130, 0], [111, 1], [121, 0], [131, 0], [112, 0], [122, 1]);
  out.push([132, 0], [297, 0]);
  roots.forEach((lines, r) => {
    out.push([302, "LEADER{"], [290, 1], [291, 1], [10, 5 - r], [20, 5], [30, 0], [11, 1]);
    out.push([21, 0], [31, 0], [90, 0], [40, 0.36]);
    lines.forEach((points, l) => out.push([304, "LEADER_LINE{"], ...points, [91, l], [305, "}"]));
    out.push([271, 0], [303, "}"]);
  });
  out.push([272, 9], [273, 9], [301, "}"], [340, "12"], [90, 6816768], [170, options.shaft ?? 1]);
  out.push([91, -1056964608], [341, "14"], [171, -2], [290, 1], [291, 1], [41, 0.36], [42, 0.18]);
  out.push([172, options.block ? 1 : 2], [343, "11"], [173, 1], [95, 1], [174, 1], [175, 0]);
  out.push([92, -1056964608], [292, 1], [344, "1F"], [93, -1056964608], [10, 1], [20, 1]);
  out.push([30, 1], [43, 0], [176, 0], [293, 0]);
  (options.labels ?? []).forEach((definition, i) =>
    out.push([330, definition], [177, i], [44, 0], [302, `V${i}`]),
  );
  out.push([294, 0], [178, 0], [179, 1], [45, 1], [271, 1], [272, 9], [273, 9], [295, 0]);
  return out;
}

/** An old leader's record through `points`, with its note's handle unless it has none. */
const leaderRecord = (handle: string, points: number, more: readonly Pair[]): Pair[] => [
  [0, "LEADER"],
  [5, handle],
  [8, "0"],
  [100, "AcDbLeader"],
  [3, "Standard"],
  ...more,
  [76, points],
  ...Array.from({ length: points }, (_, i): Pair[] => [
    [10, i],
    [20, i % 2],
    [30, 0],
  ]).flat(),
];

/**
 * A file of multileaders of many roots, shafts and points, one whose block has labels, of more
 * definitions than a read keeps among them, and old leaders, one of many points and one in 3D.
 */
function leaderFile(): Uint8Array {
  const shaft = (n: number): Pair[] =>
    Array.from({ length: n }, (_, i): Pair[] => [
      [10, i],
      [20, i],
      [30, 0],
    ]).flat();
  const roots = (r: number, l: number, n: number) =>
    Array.from({ length: r }, () => Array.from({ length: l }, () => shaft(n)));
  const labels = [
    "2A",
    ...Array.from({ length: 1200 }, (_, i) => (0x1000 + i).toString(16)),
    "2B",
    "2A",
    "0",
    "zz",
  ];
  const groups: Pair[] = [
    ...([
      [0, "SECTION"],
      [2, "HEADER"],
      [9, "$ACADVER"],
      [1, "AC1032"],
      [0, "ENDSEC"],
    ] as Pair[]),
    ...([
      [0, "SECTION"],
      [2, "TABLES"],
      [0, "TABLE"],
      [2, "BLOCK_RECORD"],
    ] as Pair[]),
    ...([
      [0, "BLOCK_RECORD"],
      [5, "1F"],
      [2, "TAG"],
      [0, "ENDTAB"],
      [0, "ENDSEC"],
    ] as Pair[]),
    ...([
      [0, "SECTION"],
      [2, "BLOCKS"],
      [0, "BLOCK"],
      [5, "20"],
      [330, "1F"],
      [8, "0"],
    ] as Pair[]),
    ...([
      [2, "TAG"],
      [70, 2],
      [10, 0],
      [20, 0],
    ] as Pair[]),
    ...(["2A", "2B"].flatMap((h, i) => [
      [0, "ATTDEF"],
      [5, h],
      [330, "1F"],
      [8, "0"],
      [10, 0],
      [20, i],
      [40, 0.1],
      [1, "1"],
      [3, "Prompt"],
      [2, `T${i}`],
      [70, 0],
    ]) as Pair[]),
    ...([
      [0, "ENDBLK"],
      [5, "21"],
      [330, "1F"],
      [8, "0"],
      [0, "ENDSEC"],
    ] as Pair[]),
    ...([
      [0, "SECTION"],
      [2, "ENTITIES"],
    ] as Pair[]),
    ...multileaderRecord("40", roots(3, 4, 6), { shaft: 2 }),
    ...multileaderRecord("41", roots(2, 1, 2), { block: true, labels }),
    ...multileaderRecord("42", [], { shaft: 0 }),
    ...multileaderRecord("43", [[]], {}),
    ...multileaderRecord("44", roots(50, 10, 40), { block: true, labels: ["2A"] }),
    ...leaderRecord("50", 3, [
      [71, 0],
      [72, 1],
      [73, 0],
      [340, "40"],
    ]),
    ...leaderRecord("51", 5000, []),
    ...leaderRecord("52", 2, [
      [73, 0],
      [340, "41"],
      [210, 1],
      [220, 0],
      [230, 0],
    ]),
    ...([
      [0, "ENDSEC"],
      [0, "EOF"],
    ] as Pair[]),
  ];
  return encoder.encode(
    groups.map(([code, value]) => `${String(code).padStart(3)}\r\n${value}\r\n`).join(""),
  );
}

const NUMBERS = ["0", "1", "-1", "4294967295", "1e308", "-1e308", "1e999", "NaN", "", "1.#QNAN"];
const HANDLES = ["0", "FFFFFFFFFFFFFFFF", "DEADBEEF", "1".repeat(17), "zz"];

/** A record that inserts itself, and a chain of blocks each inserting the next. */
function blocks(depth: number): Group[] {
  const out: Group[] = [];
  for (let i = 0; i < depth; i++) {
    out.push(["  0", "BLOCK"], ["  2", `B${i}`], [" 70", "0"], [" 10", "0"], [" 20", "0"]);
    out.push(["  0", "INSERT"], ["  8", "0"], ["  2", `B${i + 1 === depth ? i : i + 1}`]);
    out.push([" 10", "0"], [" 20", "0"], ["  0", "ENDBLK"]);
  }
  return out;
}

/** One file bent from `bytes`, by a few mutations each of a kind `next` picks. */
export function mutate(bytes: Uint8Array, next: () => number): Uint8Array {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const index = (n: number): number => Math.floor(next() * n);
  if (next() < 0.15) {
    // Bytes: bits flipped, a range zeroed, or the file cut.
    const out = new Uint8Array(bytes);
    const kind = index(3);
    if (kind === 0)
      for (let k = 0; k < 1 + index(20); k++) out[index(out.length)]! ^= 1 << index(8);
    else if (kind === 1) out.fill(0, index(out.length), index(out.length));
    else return out.subarray(0, index(out.length));
    return out;
  }
  const groups = groupsOf(decoder.decode(bytes));
  const starts = groups.flatMap(([code], i) => (code.trim() === "0" ? [i] : []));
  // A record, from the starts the file had before this round's steps, kept within the file.
  const record = (): [number, number] => {
    const k = index(starts.length);
    const to = Math.min(starts[k + 1] ?? groups.length, groups.length);
    return [Math.min(starts[k] ?? 0, to), to];
  };
  for (let step = 0; step < 1 + index(4); step++) {
    const at = index(groups.length);
    const group = groups[at];
    if (!group) break;
    switch (index(12)) {
      case 0: {
        // Codes swapped.
        const other = groups[index(groups.length)]!;
        [group[0], other[0]] = [other[0], group[0]];
        break;
      }
      case 1: {
        // A record repeated.
        const [from, to] = record();
        // Up to 200 copies, and no more than a million groups in all.
        const copies = Math.min(1 + index(200), Math.floor(1e6 / Math.max(1, to - from)));
        const after = groups.splice(to);
        for (let k = 0; k < copies; k++) {
          for (let g = from; g < to; g++) groups.push([...groups[g]!]);
        }
        for (const g of after) groups.push(g);
        break;
      }
      case 2:
        // A value cut.
        group[1] = group[1].slice(0, index(group[1].length + 1));
        break;
      case 3:
        // A value lengthened.
        group[1] = group[1].repeat(1 + index(next() < 0.1 ? 5000 : 50));
        break;
      case 4:
        // A count, a size or a number set to what breaks it.
        group[1] = pick(NUMBERS);
        break;
      case 5: {
        // A handle pointed at itself, at another record's, or at none.
        const own = groups.find(([code]) => code.trim() === "5")?.[1];
        group[1] = next() < 0.5 && own ? own : pick(HANDLES);
        break;
      }
      case 6:
        // A group, or a record, left out.
        if (next() < 0.5) groups.splice(at, 1);
        else groups.splice(...record());
        break;
      case 7:
        // A group of another code.
        group[0] = String(
          pick([
            0,
            1,
            2,
            5,
            8,
            10,
            11,
            40,
            41,
            42,
            66,
            70,
            71,
            72,
            73,
            90,
            102,
            76,
            170,
            172,
            177,
            290,
            296,
            300,
            301,
            302,
            303,
            304,
            305,
            330,
            340,
            341,
            360,
            1001,
            index(1100),
          ]),
        );
        break;
      case 8:
        // A record of another kind.
        groups.splice(at, 0, [
          "  0",
          pick([
            "LINE",
            "TEXT",
            "INSERT",
            "ATTRIB",
            "SEQEND",
            "POLYLINE",
            "LWPOLYLINE",
            "VERTEX",
            "MTEXT",
            "DIMENSION",
            "MULTILEADER",
            "LEADER",
            "HATCH",
            "WIPEOUT",
            "SORTENTSTABLE",
            "DICTIONARYVAR",
            "SECTION",
            "ENDSEC",
            "BLOCK",
            "ENDBLK",
            "DICTIONARY",
            "EOF",
          ]),
        ]);
        break;
      case 9: {
        // Blocks that insert themselves, nested deep.
        const blocksAt = groups.findIndex(
          ([code, value], i) =>
            code.trim() === "2" && value === "BLOCKS" && groups[i - 1]?.[1] === "SECTION",
        );
        if (blocksAt >= 0)
          groups.splice(blocksAt + 1, 0, ...blocks(next() < 0.2 ? 10_000 : 1 + index(10)));
        break;
      }
      case 10: {
        // A handle given to two records.
        const handles = groups.filter(([code]) => code.trim() === "5");
        if (handles.length > 1) pick(handles)[1] = pick(handles)[1];
        break;
      }
      case 11: {
        // A run of a record's groups repeated, such as a multileader's roots, shafts, points or
        // labels, up to a million groups in all.
        const [from, to] = record();
        const start = from + index(to - from);
        const end = start + 1 + index(Math.min(40, to - start));
        const copies = Math.min(1 + index(2000), Math.floor(1e6 / (end - start)));
        const run = groups.slice(start, end);
        const after = groups.splice(end);
        for (let k = 0; k < copies; k++) for (const g of run) groups.push([...g]);
        for (const g of after) groups.push(g);
        break;
      }
    }
  }
  return encoder.encode(textOf(groups));
}

const running = new Script("running()");
/** What `fn` gives, stopped after `ms`, so a read that never ends fails. */
function within<T>(ms: number, fn: () => T): T {
  Object.assign(globalThis, { running: fn });
  return running.runInThisContext({ timeout: ms }) as T;
}

/** The command's largest answer. */
const ANSWER = 128 * 1024 * 1024;

/** What is wrong with one read of `bytes`, or undefined when nothing is. */
export async function problemOf(bytes: Uint8Array, geometry: boolean): Promise<string | undefined> {
  // Each read is in proportion to its file: a second, and a second more for each 20 MB.
  const ms = Math.ceil(timeLimit(1000 + bytes.length / 20_000));
  let read: Promise<DrawingRead>;
  let both: Promise<{ read: DrawingRead; document: DxfDocument }>;
  try {
    read = within(ms, () => readDXFWithin(bytes, { geometry }, READ_LIMITS));
    both = within(ms, () => readDXFDocument(bytes, { geometry }));
    // The document's read fails where the read does, and is waited for only when it does not.
    both.catch(() => undefined);
  } catch (error) {
    return `the read took more than ${ms} ms, or threw ${(error as Error).message}`;
  }
  let answer: DrawingRead;
  try {
    answer = await read;
  } catch (error) {
    return error instanceof ReadError ? undefined : `it threw ${(error as Error).stack}`;
  }
  const json = JSON.stringify(answer);
  if (json.length > ANSWER) return `its answer is ${json.length} characters`;
  const problems = checkDrawingRead(JSON.parse(json));
  if (problems.length > 0) return problems.slice(0, 3).join("; ");
  const { document } = await both;
  let at = 0;
  for (let i = 0; i < document.count; i++) {
    if (document.starts[i] !== at) return `record ${i} starts at ${document.starts[i]}, not ${at}`;
    at += document.length(i);
  }
  if (at !== bytes.length) return `its records hold ${at} of ${bytes.length} bytes`;
  return undefined;
}

/** Runs `runs` bent files from `seed`, and gives each one that fails with its problem. */
export async function fuzz(
  files: readonly Uint8Array[],
  seed: number,
  runs: number,
): Promise<{ seed: number; run: number; problem: string; bytes: Uint8Array }[]> {
  const next = random(seed);
  const found: { seed: number; run: number; problem: string; bytes: Uint8Array }[] = [];
  for (let run = 0; run < runs; run++) {
    let bytes = files[Math.floor(next() * files.length)]!;
    for (let k = 0; k < 1 + Math.floor(next() * 3); k++) bytes = mutate(bytes, next);
    const problem = await problemOf(bytes, next() < 0.6);
    if (problem !== undefined) found.push({ seed, run, problem, bytes });
  }
  return found;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const option = (name: string, otherwise: number): number => {
    const at = args.indexOf(name);
    return at < 0 ? otherwise : Number(args[at + 1]);
  };
  const seed = option("--seed", Date.now() % 1_000_000);
  const runs = option("--runs", 1000);
  const paths = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  const files = [...seedFiles(), ...paths.map((p) => new Uint8Array(readFileSync(p)))];
  const started = performance.now();
  const found = await fuzz(files, seed, runs);
  for (const { run, problem, bytes } of found) {
    console.log(`seed ${seed} run ${run} (${bytes.length} bytes): ${problem.slice(0, 500)}`);
  }
  console.log(
    `${runs} reads from seed ${seed} in ${Math.round((performance.now() - started) / 1000)} s: ${found.length} problems`,
  );
  if (found.length > 0) process.exitCode = 1;
}
