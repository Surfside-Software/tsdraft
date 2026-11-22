import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { deflateSync } from "node:zlib";
import { createDrawing, pdfPageSize, toPDF } from "../src/index.ts";
import { timeLimit } from "./time-limit.ts";

const latin1 = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0) & 255);
const text = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

/** An object of a PDF being built: its number and its body, with a stream's bytes if any. */
interface Part {
  readonly n: number;
  readonly body: string;
  readonly stream?: Uint8Array;
}

function objectBytes({ n, body, stream }: Part): string {
  if (stream === undefined) return `${n} 0 obj\n${body}\nendobj\n`;
  return `${n} 0 obj\n${body}\nstream\n${text(stream)}\nendstream\nendobj\n`;
}

/** A PDF with a classic cross-reference table, and the offset of its table. */
function classic(parts: readonly Part[], trailer = "/Root 1 0 R", prefix = ""): string {
  let pdf = prefix || "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const at = new Map<number, number>();
  for (const part of parts) {
    at.set(part.n, pdf.length);
    pdf += objectBytes(part);
  }
  const numbers = [...at.keys()].sort((a, b) => a - b);
  const xref = pdf.length;
  pdf += "xref\n";
  if (prefix === "") pdf += "0 1\n0000000000 65535 f \n";
  for (const n of numbers) {
    pdf += `${n} 1\n${String(at.get(n)).padStart(10, "0")} 00000 n \n`;
  }
  const size = Math.max(0, ...numbers) + 1;
  return `${pdf}trailer\n<< /Size ${size} ${trailer} >>\nstartxref\n${xref}\n%%EOF\n`;
}

/** Big-endian bytes of `v` in `w` bytes. */
const be = (v: number, w: number): number[] =>
  Array.from({ length: w }, (_, i) => Math.floor(v / 256 ** (w - 1 - i)) & 255);

/** Rows with PNG predictor 12 (up) applied, a 0 or 2 before each row. */
function predicted(rows: number[][]): Uint8Array {
  const out: number[] = [];
  rows.forEach((row, r) => {
    out.push(2, ...row.map((b, i) => (b - (r > 0 ? rows[r - 1]![i]! : 0)) & 255));
  });
  return new Uint8Array(out);
}

/**
 * A PDF 1.5 file with a cross-reference stream compressed with a PNG predictor, and `packed`
 * objects inside one object stream.
 */
function modern(loose: readonly Part[], packed: readonly Part[], trailer = "/Root 1 0 R"): string {
  let pdf = "%PDF-1.5\n";
  const rows = new Map<number, number[]>();
  for (const part of loose) {
    rows.set(part.n, [1, ...be(pdf.length, 3), 0]);
    pdf += objectBytes(part);
  }
  const all = [...loose.map((p) => p.n), ...packed.map((p) => p.n)];
  const top = Math.max(0, ...all) + 1;
  if (packed.length > 0) {
    const stm = top;
    let header = "";
    let bodies = "";
    packed.forEach((part, i) => {
      header += `${part.n} ${bodies.length} `;
      bodies += `${part.body}\n`;
      rows.set(part.n, [2, ...be(stm, 3), i]);
    });
    const data = deflateSync(latin1(header + bodies));
    rows.set(stm, [1, ...be(pdf.length, 3), 0]);
    pdf += objectBytes({
      n: stm,
      body: `<< /Type /ObjStm /N ${packed.length} /First ${header.length} /Filter /FlateDecode /Length ${data.length} >>`,
      stream: data,
    });
  }
  const xrefN = top + 1;
  rows.set(xrefN, [1, ...be(pdf.length, 3), 0]);
  const table: number[][] = [];
  for (let n = 0; n <= xrefN; n++) table.push(rows.get(n) ?? [0, 0, 0, 0, 0]);
  const data = deflateSync(predicted(table));
  const xref = pdf.length;
  pdf += objectBytes({
    n: xrefN,
    body: `<< /Type /XRef /Size ${xrefN + 1} /W [1 3 1] ${trailer} /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 5 >> /Length ${data.length} >>`,
    stream: data,
  });
  return `${pdf}startxref\n${xref}\n%%EOF\n`;
}

/** The catalog, a page tree of one page, and the page with `page` in its dictionary. */
const onePage = (page: string, tree = ""): Part[] => [
  { n: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
  { n: 2, body: `<< /Type /Pages /Kids [3 0 R] /Count 1 ${tree} >>` },
  { n: 3, body: `<< /Type /Page /Parent 2 0 R ${page} >>` },
];

const size = (pdf: string | Uint8Array, page: string | number = 1) =>
  pdfPageSize(typeof pdf === "string" ? latin1(pdf) : pdf, page);

test("a page's MediaBox, in inches", () => {
  assert.deepEqual(size(classic(onePage("/MediaBox [0 0 612 792]"))), [8.5, 11]);
  // Corners in either order, off the origin.
  assert.deepEqual(size(classic(onePage("/MediaBox [72 792 684 0]"))), [8.5, 11]);
  // Reals, and a box that is no box.
  assert.deepEqual(size(classic(onePage("/MediaBox [0.0 0 1224.0 792.]"))), [17, 11]);
  assert.equal(size(classic(onePage("/MediaBox [0 0 612]"))), undefined);
  assert.equal(size(classic(onePage("/MediaBox [0 0 0 792]"))), undefined);
  assert.equal(size(classic(onePage(""))), undefined);
});

test("the CropBox cut to the MediaBox", () => {
  const crop = (box: string) => size(classic(onePage(`/MediaBox [0 0 1224 792] /CropBox ${box}`)));
  assert.deepEqual(crop("[36 36 1188 756]"), [16, 10]);
  assert.deepEqual(crop("[-100 -100 612 2000]"), [8.5, 11]);
  // A CropBox that misses the MediaBox, or is broken, leaves the MediaBox.
  assert.deepEqual(crop("[2000 2000 3000 3000]"), [17, 11]);
  assert.deepEqual(crop("[1 2 3]"), [17, 11]);
});

test("boxes and the turn are inherited from the page tree", () => {
  const tree = "/MediaBox [0 0 2592 1728] /CropBox [0 0 1728 1728] /Rotate 90";
  assert.deepEqual(size(classic(onePage("", tree))), [24, 24]);
  assert.deepEqual(size(classic(onePage("", "/MediaBox [0 0 2592 1728] /Rotate 90"))), [24, 36]);
  // The page's own box and turn win over the tree's.
  assert.deepEqual(size(classic(onePage("/MediaBox [0 0 612 792] /Rotate 0", tree))), [8.5, 11]);
  // Through two levels of the tree.
  const deep: Part[] = [
    { n: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { n: 2, body: "<< /Type /Pages /Kids [4 0 R] /Count 1 /MediaBox [0 0 1224 792] >>" },
    { n: 4, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 /Parent 2 0 R /Rotate 270 >>" },
    { n: 3, body: "<< /Type /Page /Parent 4 0 R >>" },
  ];
  assert.deepEqual(size(classic(deep)), [11, 17]);
});

test("a turn of 90 or 270 swaps width and height", () => {
  const turned = (rotate: string) =>
    size(classic(onePage(`/MediaBox [0 0 1224 792] /Rotate ${rotate}`)));
  assert.deepEqual(turned("0"), [17, 11]);
  assert.deepEqual(turned("90"), [11, 17]);
  assert.deepEqual(turned("180"), [17, 11]);
  assert.deepEqual(turned("270"), [11, 17]);
  assert.deepEqual(turned("-90"), [11, 17]);
  assert.deepEqual(turned("-180"), [17, 11]);
  assert.deepEqual(turned("450"), [11, 17]);
  // A turn that is not a multiple of 90 counts as none.
  assert.deepEqual(turned("45"), [17, 11]);
  assert.deepEqual(turned("/East"), [17, 11]);
});

test("UserUnit scales the page", () => {
  assert.deepEqual(size(classic(onePage("/MediaBox [0 0 144 72] /UserUnit 10"))), [20, 10]);
  assert.deepEqual(size(classic(onePage("/MediaBox [0 0 144 72] /UserUnit 0"))), [2, 1]);
  assert.deepEqual(size(classic(onePage("/MediaBox [0 0 144 72] /UserUnit -3"))), [2, 1]);
});

test("numbers, boxes, counts, kids and turns given by reference", () => {
  const parts: Part[] = [
    { n: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { n: 2, body: "<< /Type /Pages /Kids 7 0 R /Count 8 0 R /Rotate 9 0 R >>" },
    { n: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox 4 0 R /UserUnit 10 0 R >>" },
    { n: 4, body: "[0 0 5 0 R 6 0 R]" },
    { n: 5, body: "1224" },
    { n: 6, body: "792" },
    { n: 7, body: "[3 0 R]" },
    { n: 8, body: "1" },
    { n: 9, body: "-270" },
    { n: 10, body: "2" },
  ];
  assert.deepEqual(size(classic(parts)), [22, 34]);
});

test("pages are numbered from 1, as a string or a number", () => {
  const parts: Part[] = [
    { n: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { n: 2, body: "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 4 >>" },
    { n: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>" },
    { n: 4, body: "<< /Type /Pages /Parent 2 0 R /Kids [6 0 R 7 0 R] /Count 2 >>" },
    { n: 5, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 2592 1728] >>" },
    { n: 6, body: "<< /Type /Page /Parent 4 0 R /MediaBox [0 0 1224 792] >>" },
    { n: 7, body: "<< /Type /Page /Parent 4 0 R /MediaBox [0 0 1728 1224] >>" },
  ];
  const pdf = classic(parts);
  assert.deepEqual(size(pdf, 1), [8.5, 11]);
  assert.deepEqual(size(pdf, "1"), [8.5, 11]);
  assert.deepEqual(size(pdf, 2), [17, 11]);
  assert.deepEqual(size(pdf, "3"), [24, 17]);
  assert.deepEqual(size(pdf, 4), [36, 24]);
  for (const page of [0, 5, -1, 1.5, NaN, Infinity, "0", "01", " 1", "1 ", "+1", "1.0", "", "a"]) {
    assert.equal(size(pdf, page), undefined, String(page));
  }
  assert.equal(size(pdf, null as unknown as number), undefined);
});

test("a cross-reference stream with a predictor, and objects in an object stream", () => {
  const [catalog, tree, page] = onePage("/MediaBox [0 0 1224 792] /Rotate 90");
  assert.deepEqual(size(modern([catalog!, tree!, page!], [])), [11, 17]);
  assert.deepEqual(size(modern([], [catalog!, tree!, page!])), [11, 17]);
  assert.deepEqual(size(modern([catalog!], [tree!, page!])), [11, 17]);
  // The predictor is needed: without it the rows are read wrong.
  const plain = text(latin1(modern([catalog!], [tree!, page!])));
  assert.equal(size(plain.replace("/Predictor 12", "/Predictor 01")), undefined);
  // A filter it does not read.
  assert.equal(
    size(plain.replace("/Filter /FlateDecode /Length", "/Filter /LZWDecode /Length")),
    undefined,
  );
});

test("an incremental update changes a box, the newest winning", () => {
  const first = classic(onePage("/MediaBox [0 0 612 792]"));
  const prev = Number(/startxref\n(\d+)/.exec(first)![1]);
  const page = { n: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1224 792] >>" };
  const update = classic([page], `/Root 1 0 R /Prev ${prev}`, first);
  assert.deepEqual(size(update), [17, 11]);
  assert.deepEqual(size(first), [8.5, 11]);
  // A /Prev that points at itself ends.
  const looped = update.replace(
    `/Prev ${prev}`,
    `/Prev ${Number(/startxref\n(\d+)\n%%EOF\n$/.exec(update)![1])}`,
  );
  assert.deepEqual(size(looped), [17, 11]);
});

test("a broken cross-reference is read by scanning for the objects", () => {
  const pdf = classic(onePage("/MediaBox [0 0 612 792]"));
  // Every offset off by 3.
  const moved = pdf.replace(
    /^(\d{10}) 00000 n $/gm,
    (_, at) => `${String(Number(at) + 3).padStart(10, "0")} 00000 n `,
  );
  assert.deepEqual(size(moved), [8.5, 11]);
  assert.deepEqual(size(pdf.replace(/startxref\n\d+/, "startxref\n999999")), [8.5, 11]);
  assert.deepEqual(size(pdf.slice(0, pdf.indexOf("xref\n"))), [8.5, 11]);
  // Object streams found through a cross-reference stream the scan finds.
  const [catalog, tree, page] = onePage("/MediaBox [0 0 1224 792]");
  const modernPdf = modern([catalog!], [tree!, page!]);
  assert.deepEqual(size(modernPdf.replace(/startxref\n\d+/, "startxref\n5")), [17, 11]);
});

test("an encrypted file reads where its pages are outside object streams", () => {
  const encrypt = "/Root 1 0 R /Encrypt 9 0 R";
  const parts = [
    ...onePage("/MediaBox [0 0 612 792]"),
    { n: 9, body: "<< /Filter /Standard /V 2 >>" },
  ];
  assert.deepEqual(size(classic(parts, encrypt)), [8.5, 11]);
  const [catalog, tree, page] = onePage("/MediaBox [0 0 612 792]");
  assert.equal(size(modern([catalog!, parts[3]!], [tree!, page!], encrypt)), undefined);
});

test("a page tree that loops, or is too deep, gives undefined", () => {
  const cycle: Part[] = [
    { n: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { n: 2, body: "<< /Type /Pages /Kids [4 0 R] /Count 1 /MediaBox [0 0 612 792] >>" },
    { n: 4, body: "<< /Type /Pages /Kids [2 0 R] /Count 1 /Parent 4 0 R >>" },
  ];
  assert.equal(size(classic(cycle)), undefined);
  const self: Part[] = [
    { n: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { n: 2, body: "<< /Type /Pages /Kids [2 0 R] /Count 1 >>" },
  ];
  assert.equal(size(classic(self)), undefined);
  const chain: Part[] = [{ n: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" }];
  for (let n = 2; n < 400; n++) {
    chain.push({ n, body: `<< /Type /Pages /Kids [${n + 1} 0 R] /Count 1 >>` });
  }
  chain.push({ n: 400, body: "<< /Type /Page /MediaBox [0 0 612 792] >>" });
  assert.equal(size(classic(chain)), undefined);
  assert.deepEqual(
    size(
      classic(
        chain
          .slice(0, 1)
          .concat(chain.slice(300))
          .map((p, i) => (i === 0 ? { n: 1, body: "<< /Type /Catalog /Pages 301 0 R >>" } : p)),
      ),
    ),
    [8.5, 11],
  );
  // A reference to a reference to itself.
  assert.equal(size(classic([...onePage("/MediaBox 4 0 R"), { n: 4, body: "4 0 R" }])), undefined);
});

test("garbage and truncated files give undefined", () => {
  for (const bytes of [
    "",
    "%PDF-",
    "%PDF-1.7\n",
    "hello",
    "%PDF-1.4\n1 0 obj << /Pages",
    "<<<<<<<<",
  ]) {
    assert.equal(size(bytes), undefined, bytes);
  }
  const pdf = classic(onePage("/MediaBox [0 0 612 792]"));
  assert.equal(size(pdf.replace("%PDF-", "%XYZ-")), undefined);
  for (let cut = 0; cut < pdf.length; cut += 7) {
    const found = size(pdf.slice(0, cut));
    assert.ok(found === undefined || (found[0] === 8.5 && found[1] === 11), String(cut));
  }
  assert.equal(pdfPageSize("%PDF-1.4" as unknown as Uint8Array, 1), undefined);
});

test("the size of each page of a PDF toPDF writes", () => {
  const d = createDrawing({ units: "ft" });
  d.layout("A", { paper: "ANSI B" }, () => {});
  d.layout("B", { paper: "ARCH E" }, () => {});
  d.layout("C", { paper: "ARCH D" }, () => {});
  const drawing = d.build();
  for (const pdf of [toPDF(drawing), toPDF(drawing, { deflate: (b) => deflateSync(b) })]) {
    assert.deepEqual(pdfPageSize(pdf, 1), [17, 11]);
    assert.deepEqual(pdfPageSize(pdf, "2"), [48, 36]);
    assert.deepEqual(pdfPageSize(pdf, 3), [36, 24]);
    assert.equal(pdfPageSize(pdf, 4), undefined);
  }
});

/** A seeded generator of whole numbers below `n`. */
function seeded(seed: number): (n: number) => number {
  return (n) => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return Math.floor((seed / 2 ** 32) * n);
  };
}

test("mutated PDFs give a size or undefined, never a throw, within the time limit", () => {
  const d = createDrawing({ units: "ft" });
  d.layout("A", { paper: "ANSI B" }, () => {});
  d.layout("B", { paper: "ARCH E" }, () => {});
  const [catalog, tree, page] = onePage(
    "/MediaBox [0 0 1224 792] /CropBox [0 0 600 700] /Rotate 90",
  );
  const seeds = [
    toPDF(d.build()),
    latin1(
      classic(
        onePage("/MediaBox 4 0 R /Rotate 5 0 R").concat([
          { n: 4, body: "[0 0 612 792]" },
          { n: 5, body: "90" },
        ]),
      ),
    ),
    latin1(modern([catalog!], [tree!, page!])),
  ];
  const big = [
    "99999999999",
    "-1",
    "1e308",
    "4294967296",
    "[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[",
    "<<".repeat(400),
    "(",
    "1 0 R ".repeat(50),
  ];
  const random = seeded(12);
  const checked = (bytes: Uint8Array, page: number): void => {
    const found = pdfPageSize(bytes, page);
    if (found === undefined) return;
    assert.equal(found.length, 2);
    for (const x of found) assert.ok(Number.isFinite(x) && x > 0, String(found));
  };
  runInNewContext(
    `for (let i = 0; i < 4000; i++) run(i);`,
    {
      run: (i: number) => {
        const seed = seeds[i % seeds.length]!;
        let bytes: Uint8Array;
        const kind = random(4);
        if (kind === 0) bytes = seed.slice(0, random(seed.length));
        else if (kind === 1) {
          bytes = seed.slice();
          for (let k = 0; k < 1 + random(6); k++) bytes[random(bytes.length)] = random(256);
        } else if (kind === 2) {
          // A number or a token replaced by a huge one, a deep nesting or an open string.
          const t = text(seed);
          const spots = [...t.matchAll(/\d+|\[|<</g)];
          const spot = spots[random(spots.length)]!;
          const by = big[random(big.length)]!;
          bytes = latin1(t.slice(0, spot.index) + by + t.slice(spot.index! + spot[0].length));
        } else {
          // A span copied over another.
          bytes = seed.slice();
          const from = random(bytes.length);
          bytes.copyWithin(random(bytes.length), from, from + random(64));
        }
        checked(bytes, 1 + random(3));
      },
    },
    { timeout: timeLimit(2000) },
  );
});

test("a large file of many pages is read in time", () => {
  const parts: Part[] = [{ n: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" }];
  const kids: string[] = [];
  for (let n = 3; n < 10_003; n++) {
    kids.push(`${n} 0 R`);
    parts.push({ n, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n} 72] >>` });
  }
  parts.push({ n: 2, body: `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>` });
  const pdf = classic(parts);
  const broken = latin1(pdf.replace(/startxref\n\d+/, "startxref\n1"));
  runInNewContext(
    `check()`,
    {
      check: () => {
        assert.deepEqual(pdfPageSize(latin1(pdf), 10_000), [10_002 / 72, 1]);
        assert.deepEqual(pdfPageSize(broken, 10_000), [10_002 / 72, 1]);
      },
    },
    { timeout: timeLimit(1500) },
  );
});

test("a page whose entry is off is found by the scan, never taken for the next page", () => {
  const parts: Part[] = [
    { n: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { n: 2, body: "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>" },
    { n: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 2592 1728] >>" },
    { n: 4, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 2592 1728] /Rotate 90 >>" },
    { n: 5, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>" },
  ];
  const pdf = classic(parts);
  const at = pdf.indexOf("4 0 obj");
  const off = pdf.replace(
    `${String(at).padStart(10, "0")} 00000 n `,
    `${String(at + 7).padStart(10, "0")} 00000 n `,
  );
  assert.deepEqual(size(off, 2), [24, 36]);
  assert.deepEqual(size(off, 3), [8.5, 11]);
});

test("pages are counted in order, whatever a stale /Count says", () => {
  const parts: Part[] = [
    { n: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { n: 2, body: "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 3 >>" },
    { n: 3, body: "<< /Type /Pages /Parent 2 0 R /Kids [4 0 R 5 0 R] /Count 1 >>" },
    { n: 4, body: "<< /Type /Page /Parent 3 0 R /MediaBox [0 0 612 792] >>" },
    { n: 5, body: "<< /Type /Page /Parent 3 0 R /MediaBox [0 0 1224 792] >>" },
    { n: 6, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 2592 1728] >>" },
  ];
  assert.deepEqual(size(classic(parts), 2), [17, 11]);
  assert.deepEqual(size(classic(parts), 3), [36, 24]);
});

test("a null entry is none, so the page takes its parent's", () => {
  const tree = "/MediaBox [0 0 1224 792] /CropBox [0 0 720 432] /Rotate 90";
  assert.deepEqual(size(classic(onePage("/CropBox null /Rotate null", tree))), [6, 10]);
});

test("a reference to a free object, or one of another generation, is null", () => {
  const parts = [...onePage("/MediaBox [0 0 1224 792] /CropBox 4 0 R")];
  let pdf = classic([...parts, { n: 4, body: "[0 0 432 432]" }]);
  assert.deepEqual(size(pdf), [6, 6]);
  pdf = pdf.replace(/4 1\n(\d{10}) 00000 n /, "4 1\n$1 00001 n ");
  assert.deepEqual(size(pdf), [17, 11]);
  // Freed by a later update.
  const first = classic([...parts, { n: 4, body: "[0 0 432 432]" }]);
  const prev = Number(/startxref\n(\d+)/.exec(first)![1]);
  const freed = `${first}xref\n4 1\n0000000000 00001 f \ntrailer\n<< /Size 5 /Root 1 0 R /Prev ${prev} >>\nstartxref\n${first.length}\n%%EOF\n`;
  assert.deepEqual(size(freed), [17, 11]);
});

test("object streams whose counts lead through other object streams stop, without a throw", () => {
  // Stream k's /N is a reference to an object packed in stream k + 1, thousands deep.
  const depth = 3000;
  let pdf = "%PDF-1.5\n";
  const offsets: number[] = [];
  const put = (n: number, body: string, stream?: string) => {
    offsets[n] = pdf.length;
    pdf +=
      stream === undefined
        ? `${n} 0 obj\n${body}\nendobj\n`
        : `${n} 0 obj\n${body}\nstream\n${stream}\nendstream\nendobj\n`;
  };
  // Objects 10 + k (k < depth) are object streams; object 10000 + k is packed in stream 10 + k + 1.
  for (let k = 0; k < depth; k++) {
    const data = `${10000 + k} 0 1\n`;
    put(
      10 + k,
      `<< /Type /ObjStm /N ${10000 + k} 0 R /First ${data.length - 2} /Length ${data.length} >>`,
      data,
    );
  }
  const xref = pdf.length;
  let table = "xref\n0 1\n0000000000 65535 f \n";
  for (let k = 0; k < depth; k++)
    table += `${10 + k} 1\n${String(offsets[10 + k]).padStart(10, "0")} 00000 n \n`;
  pdf += `${table}trailer\n<< /Size 20000 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const t = performance.now();
  assert.equal(size(pdf), undefined);
  assert.ok(performance.now() - t < timeLimit(2000));
});

test("a table off by a row, or of other generations than its objects, is read by the scan", () => {
  const pdf = classic(onePage("/MediaBox [0 0 2592 1728]"));
  // Numbered from 1, a writer's mistake: object 1 lands on the free row.
  const fromOne = pdf.replace("xref\n0 1\n", "xref\n1 1\n");
  assert.deepEqual(size(fromOne), [36, 24]);
  const generations = pdf.replace(/ 00000 n /g, " 00001 n ");
  assert.deepEqual(size(generations), [36, 24]);
});

test("a hybrid file's objects in object streams, which its table marks free, are read", () => {
  let pdf = "%PDF-1.5\n";
  const at: number[] = [];
  const put = (part: Part): void => {
    at[part.n] = pdf.length;
    pdf += objectBytes(part);
  };
  onePage("/MediaBox [0 0 432 720] /CropBox 4 0 R").forEach(put);
  const packed = "4 0 [0 0 216 144]";
  put({
    n: 5,
    body: `<< /Type /ObjStm /N 1 /First 4 /Length ${packed.length} >>`,
    stream: latin1(packed),
  });
  const rows = [2, ...be(5, 3), 0];
  put({
    n: 6,
    body: `<< /Type /XRef /Size 7 /Index [4 1] /W [1 3 1] /Length ${rows.length} >>`,
    stream: new Uint8Array(rows),
  });
  const xref = pdf.length;
  const row = (n: number) => `${String(at[n]).padStart(10, "0")} 00000 n \n`;
  pdf += `xref\n0 7\n0000000000 65535 f \n${row(1)}${row(2)}${row(3)}0000000000 00000 f \n`;
  pdf += `${row(5)}${row(6)}trailer\n<< /Size 7 /Root 1 0 R /XRefStm ${at[6]} >>\n`;
  assert.deepEqual(size(`${pdf}startxref\n${xref}\n%%EOF\n`), [3, 2]);
});

test("an offset past the end of the file charges the budget, never refunds it", () => {
  // The tree's root names an object whose row points past the file; each of its nodes names an
  // object that opens a string and never closes it, so each read runs to the end of the file.
  const nodes = 1000;
  const parts: Part[] = [
    { n: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { n: 9, body: "0" },
  ];
  const kids: string[] = [];
  for (let i = 0; i < nodes; i++) {
    const n = 10 + 2 * i;
    kids.push(`${n} 0 R`);
    parts.push({ n, body: `<< /Type /Pages /Kids [] /Rotate ${n + 1} 0 R >>` });
    parts.push({ n: n + 1, body: "(" });
  }
  parts.push({ n: 2, body: `<< /Type /Pages /Kids [${kids.join(" ")}] /Rotate 9 0 R >>` });
  parts.push({ n: 8, body: `<< /Pad <${"0".repeat(4_000_000)}> >>` });
  const pdf = classic(parts).replace(/^\d{10}( 00000 n \n)(?=10 1\n)/m, "9999999999$1");
  runInNewContext(
    `check()`,
    { check: () => assert.equal(size(pdf), undefined) },
    { timeout: timeLimit(1500) },
  );
});
