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
  return [toDXF(sheet), toDXF(kitchen), toDXF(d.build(), { version: "R12" })].map((t) =>
    encoder.encode(t),
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
    switch (index(11)) {
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
            66,
            70,
            71,
            72,
            73,
            90,
            102,
            330,
            340,
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
            "VERTEX",
            "MTEXT",
            "DIMENSION",
            "MULTILEADER",
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
