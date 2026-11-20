import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import {
  createDrawing,
  lint,
  rasterSize,
  readDXF,
  toDXF,
  toPDF,
  toSVG,
  type Drawing,
  type Entity,
  type ReadImage,
} from "../src/index.ts";
import {
  base64,
  inflate,
  pngPixels,
  rasterInfo,
  withoutExif,
  type PngInfo,
} from "../src/raster.ts";
import { OPAQUE_PIXELS, svgWithin } from "../src/svg.ts";
import { timeLimit } from "./time-limit.ts";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(
    [...type].map((c) => c.charCodeAt(0)),
    4,
  );
  out.set(data, 8);
  view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
};

/** A PNG of 8 bits a sample, its samples given pixel by pixel. */
function png(
  width: number,
  height: number,
  color: number,
  pixel: (x: number, y: number) => number[],
): Uint8Array {
  const samples = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color]!;
  const raw = new Uint8Array((width * samples + 1) * height);
  // Filter 0 on every row, so the samples are as given.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      raw.set(pixel(x, y).slice(0, samples), y * (width * samples + 1) + 1 + x * samples);
    }
  }
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width);
  new DataView(header.buffer).setUint32(4, height);
  header.set([8, color, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    ...(color === 3 ? [chunk("PLTE", new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]))] : []),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The smallest JPEG header: a start of image, an APP1 of EXIF, a start of frame and its end. */
function jpeg(width: number, height: number): Uint8Array {
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8];
  const start = [0xff, 0xd8, 0xff, 0xe1, 0, exif.length + 2];
  const frame = [0xff, 0xc0, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1];
  return new Uint8Array([...start, ...exif, ...frame, 1, 0x11, 0, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
}

const seeded = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

test("a PNG's pixels come back of each color type, and a JPEG's size from its header", () => {
  for (const color of [0, 2, 3, 4, 6]) {
    const file = png(5, 3, color, (x, y) =>
      Array.from({ length: 4 }, (_, k) => (x * 40 + y * 7 + k) % 3),
    );
    const info = rasterInfo(file) as PngInfo;
    assert.deepEqual([info.width, info.height, info.color], [5, 3, color]);
    const pixels = pngPixels(info)!;
    assert.equal(pixels.samples.length, 5 * 3 * pixels.channels);
  }
  assert.deepEqual(rasterSize(jpeg(640, 480)), [640, 480]);
  // A JPEG keeps its pixels and loses the EXIF that would turn it in a browser.
  assert.equal(withoutExif(jpeg(2, 2)).length, jpeg(2, 2).length - 18);
  assert.equal(rasterSize(new Uint8Array([1, 2, 3])), undefined);
});

test("a broken raster file is answered with undefined, never a throw, and in time", () => {
  const random = seeded(17);
  const files = [
    ...[0, 2, 3, 4, 6].map((color) => png(9, 7, color, (x, y) => [x * 20, y * 30, 100, 200])),
    jpeg(300, 200),
  ];
  const limit = timeLimit(4000);
  const start = performance.now();
  for (let n = 0; n < 3000; n++) {
    const file = new Uint8Array(files[n % files.length]!);
    const kind = Math.floor(random() * 4);
    let bytes: Uint8Array = file;
    if (kind === 0) {
      for (let k = 0; k < 1 + random() * 8; k++) {
        file[Math.floor(random() * file.length)]! ^= 1 << Math.floor(random() * 8);
      }
    } else if (kind === 1) bytes = file.subarray(0, Math.floor(random() * file.length));
    else if (kind === 2) {
      // A size or a length made huge.
      file.set([0xff, 0xff, 0xff, 0x7f], 8 + Math.floor(random() * Math.min(30, file.length - 12)));
    } else file.fill(0, Math.floor(random() * file.length));
    const info = rasterInfo(bytes);
    if (info?.kind === "png") pngPixels(info);
    inflate(bytes.subarray(Math.floor(random() * bytes.length)), 1 << 16);
  }
  assert.ok(performance.now() - start < limit, "the fuzz finished in time");
});

test("inflate stops at its limit, and a hostile size decodes to nothing", () => {
  assert.equal(inflate(new Uint8Array(deflateSync(new Uint8Array(1 << 20))), 1000), undefined);
  // A PNG that says it is 2^31-1 pixels wide.
  const file = png(4, 4, 2, () => [1, 2, 3]);
  new DataView(file.buffer).setUint32(16, 0x7fffffff);
  const info = rasterInfo(file);
  assert.ok(info === undefined || (info.kind === "png" && pngPixels(info) === undefined));
});

/** A drawing with one image on a layout, its fields as given. */
const withImage = (image: Readonly<Record<string, unknown>>): Drawing => ({
  format: 0,
  units: "in",
  dxf: "R2018",
  layers: [{ name: "0", color: 7 }],
  entities: [],
  layouts: [
    {
      name: "S",
      paper: "ANSI B",
      viewports: [],
      entities: [
        {
          kind: "image",
          layer: "0",
          path: "a.png",
          pixels: [4, 4],
          at: [1, 1],
          width: 2,
          height: 2,
          ...image,
        } as unknown as Entity,
      ],
    },
  ],
});

test("lint never throws on an image of hostile fields, and the writers and plots stay bounded", () => {
  const random = seeded(29);
  // A list with two empty slots.
  const holes: unknown[] = [];
  holes.length = 2;
  const values: unknown[] = [
    undefined,
    null,
    0,
    -1,
    1e99,
    1e100,
    Number.NaN,
    Infinity,
    "",
    "x",
    true,
    {},
    [],
    [1],
    [1, 2],
    [0, 0],
    [2 ** 31, 1],
    [[1, 1]],
    [
      [1, 1],
      [1, 1],
    ],
    [
      [1, 1],
      [3, 3],
    ],
    Array.from({ length: 10_001 }, (_, i) => [i, i % 7]),
    [undefined, [1, 1]],
    holes,
    [
      [Number.NaN, 1],
      [2, 2],
      [3, 1],
    ],
    "C:\\a.png",
    "/a.png",
    "a".repeat(40_000),
  ];
  const fields = [
    "path",
    "pixels",
    "at",
    "width",
    "height",
    "rotation",
    "clip",
    "invertClip",
    "transparent",
  ];
  const files = { "a.png": png(4, 4, 6, (x) => [x * 60, 0, 0, x * 60]) };
  const limit = timeLimit(20_000);
  const start = performance.now();
  for (let n = 0; n < 400; n++) {
    const image: Record<string, unknown> = {};
    for (let k = 0; k < 1 + Math.floor(random() * 3); k++) {
      const field = fields[Math.floor(random() * fields.length)]!;
      image[field] = values[Math.floor(random() * values.length)];
    }
    const drawing = withImage(image);
    if (lint(drawing).some((d) => d.severity === "error")) assert.throws(() => toDXF(drawing));
    else toDXF(drawing);
    // The plots draw any drawing, and throw nothing but a RangeError.
    try {
      toSVG(drawing, { layout: "S", images: files });
      toPDF(drawing, { images: files });
    } catch (error) {
      assert.ok(error instanceof RangeError, `drawing ${n}: ${(error as Error).message}`);
    }
  }
  assert.ok(performance.now() - start < limit, "the fuzz finished in time");
});

test("an image's rules are compile errors and runtime errors", () => {
  const r12 = createDrawing({ dxf: "R12" });
  const d = createDrawing();
  const sized = { pixels: [4, 4], width: 1 } as const;
  // @ts-expect-error: R12 holds no image.
  assert.throws(() => r12.image("a.png", [0, 0], sized), /no images to R12/);
  // @ts-expect-error: an absolute path is refused.
  assert.throws(() => d.image("C:\\a.png", [0, 0], sized), /must start from the folder/);
  // @ts-expect-error: an empty path is refused.
  assert.throws(() => d.image("", [0, 0], sized), /cannot be empty/);
  // @ts-expect-error: a width of 0.
  assert.throws(() => d.image("a.png", [0, 0], { pixels: [4, 4], width: 0 }), /width/);
  assert.throws(() => d.image("a.png", [0, 0], { pixels: [4, 0], width: 1 }), /from 1 to/);
  const rectangle: [number, number][] = [
    [0, 0],
    [1, 0],
  ];
  assert.throws(() => d.image("a.png", [0, 0], { ...sized, clip: rectangle }), /apart along/);
  const polygon: [number, number][] = [
    [0, 0],
    [1, 1],
    [0, 0],
  ];
  assert.throws(() => d.image("a.png", [0, 0], { ...sized, clip: polygon }), /3 points that/);
  assert.throws(() => d.image("a.png", [0, 0], { ...sized, invertClip: true }), /needs a clip/);
  d.image("a.png", [0, 0], { pixels: [4, 2], width: 1 });
  const [made] = d.build().entities as Extract<Entity, { kind: "image" }>[];
  assert.equal(made!.height, 0.5);
  // Two images of one file that give it other pixels.
  d.image("a.png", [5, 0], { pixels: [4, 3], width: 1 });
  assert.match(
    lint(d.build())
      .map((x) => x.message)
      .join("\n"),
    /same pixels/,
  );
});

test("readDXF reads tsdraft's images back, with each file's definition once", async () => {
  const d = createDrawing();
  d.layer("0", {}, () => {
    d.image("images/a.png", [0, 0], {
      pixels: [4, 2],
      width: 4,
      clip: [
        [1, 0.5],
        [3, 1.5],
      ],
    });
    d.image("images\\a.png", [5, 0], {
      pixels: [4, 2],
      width: 4,
      invertClip: true,
      clip: [
        [6, 0.5],
        [8, 0.4],
        [7, 1.5],
      ],
    });
    d.image("b.jpg", [9, 0], { pixels: [3, 3], width: 1, transparent: true });
  });
  const read = await readDXF(toDXF(d.build()), { geometry: true });
  assert.deepEqual(
    read.images.map(({ name, path, images }) => [name, path, images]),
    [
      ["a", "images\\a.png", 2],
      ["b", "b.jpg", 1],
    ],
  );
  const [first, second, third] = (read.model.entities ?? []) as ReadImage[];
  const rounded = (points: readonly (readonly number[])[] | undefined) =>
    points?.map((p) => p.map((v) => Math.round(v * 1e6) / 1e6));
  assert.equal(first!.path, "images\\a.png");
  // Two opposite corners of the rectangle, as the file holds them: its top left in the image's
  // pixels, then its bottom right.
  assert.deepEqual(rounded(first!.clip), [
    [1, 1.5],
    [3, 0.5],
  ]);
  assert.equal(second!.clip!.length, 3);
  assert.equal(second!.invertClip, true);
  assert.equal(third!.transparent, true);
});

test("many files of one name are named in time, each by the next free number", () => {
  const d = createDrawing({ units: "ft", dxf: "R2018" });
  d.image("x/a.png", [0, 0], { pixels: [2, 2], width: 1 });
  d.image("a2.png", [2, 0], { pixels: [2, 2], width: 1 });
  for (let i = 0; i < 20_000; i++) d.image(`d${i}/a.png`, [i, 4], { pixels: [2, 2], width: 1 });
  const drawing = d.build();
  const start = performance.now();
  const dxf = toDXF(drawing);
  assert.ok(performance.now() - start < timeLimit(8000), "written in time");
  // `a2` is the second file's own name, so the third file of `a` takes 3.
  const names = [...dxf.matchAll(/\n *3\r?\n(a\d*)\r?\n *350\r?\n/g)].map((m) => m[1]);
  assert.deepEqual(names.slice(0, 4), ["a", "a10", "a100", "a1000"]);
  assert.equal(new Set(names).size, 20_002);
  assert.ok(names.includes("a20002") && !names.includes("a20003"));
});

test("toPDF reads a file once however many times a sheet places it", () => {
  // A megabyte of noise, which deflate cannot shrink.
  const bytes = png(600, 600, 2, (x, y) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return [h & 255, (h >>> 8) & 255, (h >>> 16) & 255];
  });
  assert.ok(bytes.length > 1_000_000);
  const d = createDrawing({ units: "in", dxf: "R2018" });
  d.layout("S", { paper: "ANSI B" }, () => {
    for (let i = 0; i < 600; i++) {
      d.image("aerial.png", [(i % 30) * 0.5, Math.floor(i / 30) * 0.5], {
        pixels: [600, 600],
        width: 0.4,
      });
    }
  });
  const drawing = d.build();
  const start = performance.now();
  const pdf = toPDF(drawing, { images: { "aerial.png": bytes }, deflate: (b) => deflateSync(b) });
  assert.ok(performance.now() - start < timeLimit(1500), "plotted in time");
  // The file is embedded once.
  assert.equal(new TextDecoder("latin1").decode(pdf).match(/\/Subtype \/Image/g)?.length, 1);
});

test("an xref's images take their files from the xref's own, never the sheet's", () => {
  const sheetFile = png(4, 4, 2, () => [255, 0, 0]);
  const baseFile = png(8, 8, 2, () => [0, 0, 255]);
  const base = createDrawing({ units: "ft" });
  base.image("aerial.png", [0, 0], { pixels: [8, 8], width: 100 });
  const sheet = createDrawing({ units: "ft" }).xref("BASE", "../base/base.dwg");
  sheet.image("aerial.png", [200, 0], { pixels: [4, 4], width: 50 }).insert("BASE", [0, 0]);
  const drawing = sheet.build();
  const images = { "aerial.png": sheetFile };
  // Without the base's files its image is drawn as one whose file is missing: its path.
  const alone = toSVG(drawing, { xrefs: { BASE: base.build() }, images });
  assert.equal(alone.match(/<image /g)?.length, 1);
  assert.equal(alone.match(/<use /g)?.length, 1);
  assert.match(alone, />aerial\.png</);
  // With them, each draws its own file.
  const both = toSVG(drawing, {
    xrefs: { BASE: { drawing: base.build(), images: { "aerial.png": baseFile } } },
    images,
  });
  assert.equal(both.match(/<image /g)?.length, 2);
  assert.match(both, /data-pixels="8 8"/);
  assert.match(both, /data-pixels="4 4"/);
  // An xref's file of other pixels than its image gives is the same error as the sheet's.
  assert.throws(
    () =>
      toSVG(drawing, {
        xrefs: { BASE: { drawing: base.build(), images: { "aerial.png": sheetFile } } },
        images,
      }),
    RangeError,
  );
});

test("the box of a turned image's clip holds the frame's four corners", () => {
  const d = createDrawing({ units: "ft", dxf: "R2018" });
  d.image("a.png", [0, 0], {
    pixels: [1, 1],
    width: 5,
    rotation: 45,
    clip: [
      [10, 0],
      [0, 1],
    ],
  });
  const viewBox = /viewBox="([^"]+)"/.exec(toSVG(d.build(), { margin: 0 }))![1]!.split(" ");
  // The picture's y runs down: the frame's lowest corner, 4.5 below the image, is its bottom.
  const [, top, , height] = viewBox.map(Number) as [number, number, number, number];
  assert.ok(Math.abs(top + height - 4.5) < 1e-6, `${top + height}`);
});

test("the readers keep a clip that the display flags turn on, whatever its own flag says", async () => {
  const d = createDrawing({ dxf: "R2018" });
  d.image("a.png", [0, 0], {
    pixels: [4, 2],
    width: 4,
    clip: [
      [1, 0.5],
      [3, 1.5],
    ],
  });
  d.image("a.png", [5, 0], { pixels: [4, 2], width: 4 });
  // The whole image's boundary inverted: a hole of it all.
  d.image("a.png", [10, 0], {
    pixels: [4, 2],
    width: 4,
    clip: [
      [10, 0],
      [14, 2],
    ],
    invertClip: true,
  });
  const dxf = toDXF(d.build());
  // Each clip turned off by its own flag, 280, which the display flags overrule: the IMAGE
  // records' 280, which comes before their 281.
  let turned = 0;
  const off = dxf.replace(/\r\n0\r\nIMAGE\r\n5\r\n[^]*?\r\n281\r\n/g, (record) => {
    if (record.includes("\r\n280\r\n1\r\n")) turned++;
    return record.replace("\r\n280\r\n1\r\n", "\r\n280\r\n0\r\n");
  });
  assert.equal(turned, 2);
  const read = await readDXF(off, { geometry: true });
  const [clipped, whole, hole] = read.model.entities!.filter(
    (e) => e.kind === "image",
  ) as ReadImage[];
  assert.equal(hole!.clip?.length, 2);
  assert.equal(hole!.invertClip, true);
  assert.deepEqual(clipped!.clip, [
    [1, 1.5],
    [3, 0.5],
  ]);
  // The whole image's boundary, which the writer gives an image with no clip, is no clip.
  assert.equal(whole!.clip, undefined);
});

test("an image not marked transparent is pictured with the colors of its transparent pixels", () => {
  const file = png(10, 10, 6, () => [255, 0, 0, 0]);
  const svgOf = (transparent: boolean) => {
    const d = createDrawing({ units: "in", dxf: "R2018" });
    d.image("a.png", [0, 0], { pixels: [10, 10], width: 1, transparent });
    return toSVG(d.build(), { images: { "a.png": file } });
  };
  const held = (svg: string) => {
    const data = /href="data:image\/png;base64,([^"]+)"/.exec(svg)![1]!;
    return rasterInfo(new Uint8Array(Buffer.from(data, "base64"))) as PngInfo;
  };
  const opaque = held(svgOf(false));
  assert.equal(opaque.color, 2);
  assert.deepEqual([...pngPixels(opaque)!.samples.subarray(0, 3)], [255, 0, 0]);
  assert.doesNotMatch(svgOf(false), /filter/);
  assert.equal(held(svgOf(true)).color, 6);
  // The PDF compresses the picture's stored copy again, and shows it without a soft mask.
  const d = createDrawing({ units: "in", dxf: "R2018" });
  d.layout("S", { paper: "ANSI B" }, () => {
    d.image("a.png", [1, 1], { pixels: [10, 10], width: 1 });
  });
  const pdf = new TextDecoder("latin1").decode(
    toPDF(d.build(), { images: { "a.png": file }, deflate: (b) => deflateSync(b) }),
  );
  assert.doesNotMatch(pdf, /SMask/);
  assert.doesNotMatch(pdf, /Predictor/);
});

test("two long paths that agree where a long key is sampled are two files", () => {
  const a = `${"a".repeat(16_500)}/x.png`;
  const b = `${a.slice(0, 40)}b${a.slice(41)}`;
  const d = createDrawing({ units: "in", dxf: "R2018" });
  for (const [i, path] of [a, b, a].entries()) {
    d.image(path as "x.png", [i * 2, 0], { pixels: [1, 1], width: 1 });
  }
  const drawing = d.build();
  assert.deepEqual(lint(drawing), []);
  const dxf = toDXF(drawing);
  assert.equal(dxf.match(/\r\n0\r\nIMAGEDEF\r\n/g)?.length, 2);
});

test("a damaged PNG is left out of the PDF, which stays whole", () => {
  const file = png(4, 4, 6, (x) => [x * 60, 0, 0, 128]);
  // Its compressed data broken: its header still reads.
  const broken = file.slice();
  broken.fill(0, 41, 60);
  const d = createDrawing({ units: "in", dxf: "R2018" });
  d.layout("S", { paper: "ANSI B" }, () => {
    d.image("a.png", [1, 1], { pixels: [4, 4], width: 1, transparent: true });
  });
  const pdf = new TextDecoder("latin1").decode(
    toPDF(d.build(), { images: { "a.png": broken }, deflate: (b) => deflateSync(b) }),
  );
  assert.doesNotMatch(pdf, /undefined/);
  assert.doesNotMatch(pdf, /\/Subtype \/Image/);
});

test("an image of malformed fields draws nothing, and lint reports it without a throw", () => {
  const sound = { kind: "image", layer: "0", path: "a.png", pixels: [1, 1], at: [0, 0] };
  const shapes: Record<string, unknown>[] = [
    { ...sound, width: 1, height: 1, clip: [] },
    { ...sound, width: 1, height: 1, clip: [[0, 0]] },
    { ...sound, pixels: Object.assign([1, 1], { [Symbol.iterator]: null }), width: 1, height: 1 },
    { ...sound, width: 0, height: 1 },
  ];
  for (const image of shapes) {
    const drawing: Drawing = {
      format: 0,
      units: "in",
      dxf: "R2018",
      layers: [{ name: "0", color: 7 }],
      entities: [image as unknown as Entity],
    };
    assert.ok(lint(drawing).some((found) => found.severity === "error"));
    assert.doesNotMatch(toSVG(drawing, { images: {} }), /data-image/);
  }
});

test("a clip many images share is read once a picture, and one with other keys is refused", () => {
  let reads = 0;
  const points = Array.from({ length: 1000 }, (_, i): [number, number] => [
    Math.cos(i / 100),
    Math.sin(i / 100),
  ]);
  const shared = new Proxy(points, {
    getOwnPropertyDescriptor(target, key) {
      reads++;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const entities = Array.from({ length: 100 }, (_, i) => ({
    kind: "image",
    layer: "0",
    path: "a.png",
    pixels: [4, 4],
    at: [i * 3 - 1.5, -1.5],
    width: 3,
    height: 3,
    clip: shared,
  }));
  const drawing = {
    format: 0,
    units: "in",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    entities,
    imageFrame: false,
  } as unknown as Drawing;
  toSVG(drawing);
  assert.ok(reads < 5000, `${reads} reads`);
  // A clip with a key beyond its indexes is no plain list, which lint refuses and toSVG leaves out.
  const odd = Object.assign(
    [
      [0, 0],
      [1, 1],
    ],
    { map: null },
  );
  const one = { ...drawing, entities: [{ ...entities[0]!, clip: odd }] } as unknown as Drawing;
  assert.ok(lint(one).some((found) => found.rule === "image" && found.severity === "error"));
  assert.doesNotMatch(toSVG(one), /data-image/);
});

test("a PNG stored without compression that is too large to decode is embedded as it is", () => {
  // A header of 10,001 by 10,000 gray pixels, its data an empty stored block and then any:
  // the PDF holds it as it is, and does not decode it.
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, 10_001);
  new DataView(header.buffer).setUint32(4, 10_000);
  header.set([8, 0, 0, 0, 0], 8);
  const file = new Uint8Array([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...chunk("IHDR", header),
    ...chunk("IDAT", new Uint8Array([0x78, 0x01, 0, 0, 0, 255, 255, 3, 0])),
    ...chunk("IEND", new Uint8Array()),
  ]);
  const d = createDrawing({ units: "in", dxf: "R2018" });
  d.layout("S", { paper: "ANSI B" }, () => {
    d.image("big.png", [1, 1], { pixels: [10_001, 10_000], width: 2 });
  });
  const pdf = new TextDecoder("latin1").decode(
    toPDF(d.build(), { images: { "big.png": file }, deflate: (b) => deflateSync(b) }),
  );
  assert.equal(pdf.match(/\/Subtype \/Image/g)?.length, 1);
});

test("every image of a file is held to its pixels, in an xref given the sheet's files too", () => {
  const images = { "a.png": png(1, 1, 2, () => [1, 2, 3]) };
  const base = createDrawing({ units: "ft" });
  base.image("a.png", [0, 0], { pixels: [2, 2], width: 1 });
  const sheet = createDrawing({ units: "ft" }).xref("BASE", "base.dwg");
  sheet.image("a.png", [5, 0], { pixels: [1, 1], width: 1 }).insert("BASE", [0, 0]);
  assert.throws(
    () => toSVG(sheet.build(), { images, xrefs: { BASE: { drawing: base.build(), images } } }),
    RangeError,
  );
});

test("a PNG with an alpha channel too large to copy is pictured as it is and plotted opaque", () => {
  const side = 2049;
  assert.ok(side * side > OPAQUE_PIXELS);
  // Red with no alpha, every pixel.
  const raw = new Uint8Array((side * 4 + 1) * side);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) raw[y * (side * 4 + 1) + 1 + x * 4] = 255;
  }
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, side);
  new DataView(header.buffer).setUint32(4, side);
  header.set([8, 6, 0, 0, 0], 8);
  const file = new Uint8Array([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...chunk("IHDR", header),
    ...chunk("IDAT", new Uint8Array(deflateSync(raw))),
    ...chunk("IEND", new Uint8Array()),
  ]);
  const d = createDrawing({ units: "in", dxf: "R2018" });
  d.layout("S", { paper: "ANSI B" }, () => {
    d.image("big.png", [1, 1], { pixels: [side, side], width: 2 });
  });
  const drawing = d.build();
  const images = { "big.png": file };
  const svg = toSVG(drawing, { layout: "S", images });
  assert.match(svg, /<use [^>]*data-opaque=""/);
  assert.ok(svg.length < file.length * 2, "the file is held as it is");
  const pdf = new TextDecoder("latin1").decode(
    toPDF(drawing, { images, deflate: (b) => deflateSync(b) }),
  );
  assert.equal(pdf.match(/\/Subtype \/Image/g)?.length, 1);
  assert.doesNotMatch(pdf, /SMask/);
});

test("base64 is one flat string, and a file too long for the picture is refused before it is read", () => {
  for (let n = 0; n < 7; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => i * 77 + 3);
    assert.equal(base64(bytes), Buffer.from(bytes).toString("base64"));
  }
  const file = png(400, 400, 2, (x, y) => [x, y, (x * y) & 255]);
  const d = createDrawing({ units: "in", dxf: "R2018" });
  d.image("a.png", [0, 0], { pixels: [400, 400], width: 1 });
  // A walk limit of 100 holds 25,000 characters: the file's text takes more.
  assert.ok(base64(file).length > 25_000);
  assert.throws(() => svgWithin(d.build(), { images: { "a.png": file } }, 100), RangeError);
});

test("a PNG the plot must decode past the most pixels it decodes is its frame and path in both", () => {
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, 10_001);
  new DataView(header.buffer).setUint32(4, 10_000);
  header.set([8, 6, 0, 0, 0], 8);
  const file = new Uint8Array([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...chunk("IHDR", header),
    ...chunk("IDAT", new Uint8Array([0x78, 0x9c, 3, 0])),
    ...chunk("IEND", new Uint8Array()),
  ]);
  const d = createDrawing({ units: "in", dxf: "R2018" });
  d.layout("S", { paper: "ANSI B" }, () => {
    d.image("big.png", [1, 1], { pixels: [10_001, 10_000], width: 2 });
  });
  const drawing = d.build();
  const images = { "big.png": file };
  const svg = toSVG(drawing, { layout: "S", images });
  assert.doesNotMatch(svg, /<image /);
  assert.match(svg, />big\.png</);
  const pdf = new TextDecoder("latin1").decode(
    toPDF(drawing, { images, deflate: (b) => deflateSync(b) }),
  );
  assert.doesNotMatch(pdf, /\/Subtype \/Image/);
});
