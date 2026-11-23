// Measures a firm's sheet in the loop: its reads through the read cache, from the file, from disk
// and from memory; its picture drawn once and kept in fragments; what it shows; and a build of an
// edit over it, as the preview of an edit makes one from the kept fragments: one entity erased,
// one moved and one added in the xref with the most entities, drawn and joined. Each time is a
// median. It prints no file's name, so its numbers can be recorded as they are.
//
//   pnpm bench:read <sheet> [--layout <name>] [--reader <package or folder>]
import { mkdtempSync, rmSync } from "node:fs";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { editedPicture, readPicture, sheetShows, type DrawingRead, type ReadEntity } from "tsdraft";
import { ReadCache } from "../src/read-cache.ts";
import { findReaders, readerFor } from "../src/readers.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { layout: { type: "string" }, reader: { type: "string" } },
});

const sheet = resolve(positionals[0] ?? "");

if (!positionals[0])
  throw new Error("usage: bench-read.ts <sheet> [--layout <name>] [--reader <pkg>]");

const median = (xs: number[]) => xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)]!;

const time = async <T>(work: () => T | Promise<T>): Promise<[T, number]> => {
  const t = performance.now();
  const out = await work();

  return [out, performance.now() - t];
};

const ms = (n: number) => Math.round(n * 10) / 10;

const readers = findReaders({ cwd: process.cwd(), inputs: [sheet], reader: values.reader });
const folder = mkdtempSync(join(tmpdir(), "tsdraft-bench-read-"));
const limits = { maxMemoryMb: 4096 };
const options = { geometry: true };

/** Reads a file through a cache: from the file, then from disk in a fresh cache, then from memory. */
async function readThrice(file: string): Promise<{ read: DrawingRead; times: number[] } | null> {
  const reader = readerFor(readers, extname(file));
  const cache = new ReadCache(folder);
  const [first, fromFile] = await time(() => cache.read(file, reader, limits, options));

  if (!("read" in first)) return null;
  const [, fromDisk] = await time(() => new ReadCache(folder).read(file, reader, limits, options));
  const [, fromMemory] = await time(() => cache.read(file, reader, limits, options));

  return { read: first.read, times: [fromFile, fromDisk, fromMemory] };
}

try {
  const host = await readThrice(sheet);

  if (!host) throw new Error("the sheet could not be read");
  const xrefs: Record<string, DrawingRead> = {};
  const readTimes = [host.times];

  for (const xref of host.read.xrefs) {
    const found = await readThrice(resolve(dirname(sheet), xref.path.replaceAll("\\", "/")));

    if (!found) continue;
    xrefs[xref.name] = found.read;
    readTimes.push(found.times);
  }

  const layout = values.layout ?? host.read.layouts[0]?.name;

  if (layout === undefined) throw new Error("the sheet has no layout");
  const sum = (i: number) => ms(readTimes.reduce((n, t) => n + t[i]!, 0));

  const pictureOptions = { layout, xrefs };
  const [kept, keptMs] = await time(() => readPicture(host.read, pictureOptions));
  const [shown, showsMs] = await time(() => sheetShows(host.read, layout, { xrefs }));
  const showsAgain: number[] = [];

  for (let i = 0; i < 5; i++)
    showsAgain.push((await time(() => sheetShows(host.read, layout, { xrefs })))[1]);

  // The xref with the most entities is edited: its first entity erased, its first line moved, a
  // line added, as an edit file over the sheet would.
  const [name, base] = Object.entries(xrefs).toSorted(
    ([, a], [, b]) => (b.model.entities?.length ?? 0) - (a.model.entities?.length ?? 0),
  )[0] ?? [undefined, undefined];

  let buildMs: number | undefined;
  let editable = 0;

  if (name !== undefined && base !== undefined) {
    const entities = base.model.entities ?? [];
    editable = entities.length;
    const erased = entities[0];
    const line = entities.find((e) => e.kind === "line" && e !== erased);

    const moved: ReadEntity | undefined =
      line?.kind === "line"
        ? {
            ...line,
            from: [line.from[0] + 1, line.from[1]],
            to: [line.to[0] + 1, line.to[1]],
          }
        : undefined;

    const added: ReadEntity = {
      kind: "line",
      layer: "0",
      handle: "FFFFFFF0",
      from: [0, 0],
      to: [10, 10],
    };

    const only: DrawingRead = {
      ...base,
      model: { ...base.model, entities: [...(moved ? [moved] : []), added] },
    };

    // A build draws the edit's own entities through the sheet, with the sheet's paper left out.
    const shell: DrawingRead = {
      ...host.read,
      layouts: host.read.layouts.map((l) => ({ ...l, entities: [] })),
      model: {
        ...host.read.model,
        entities: (host.read.model.entities ?? []).filter(
          (e) => e.kind === "insert" && e.block === name,
        ),
      },
    };

    const erasedSet = new Set(erased?.handle === undefined ? [] : [erased.handle]);
    const builds: number[] = [];

    for (let i = 0; i < 21; i++) {
      builds.push(
        (
          await time(() =>
            editedPicture(kept, {
              xref: name,
              erased: erasedSet,
              drawn: readPicture(shell, { layout, xrefs: { [name]: only } }),
            }),
          )
        )[1],
      );
    }

    buildMs = ms(median(builds));
  }

  const [load] = loadavg();
  console.log(
    JSON.stringify(
      {
        node: process.versions.node,
        load: Math.round(load! * 100) / 100,
        cores: availableParallelism(),
        files: readTimes.length,
        readMs: { fromFile: sum(0), fromDisk: sum(1), fromMemory: sum(2) },
        pictureMs: ms(keptMs),
        pictureChars: kept.svg.length,
        shows: {
          entities: shown?.entities.length ?? 0,
          firstMs: ms(showsMs),
          againMs: ms(median(showsAgain)),
        },
        edit: { entitiesInXref: editable, buildMs },
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(folder, { recursive: true, force: true });
}
