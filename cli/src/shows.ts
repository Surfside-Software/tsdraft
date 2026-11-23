// `tsdraft shows`: what a sheet of a drawing file shows, or what is near a point, as JSON. The
// file and each xref's file named with `--xref` are read through the read cache, so a second
// question of the same files reads none of them again.
import { extname, resolve } from "node:path";
import { nearPoint, sheetShows, spaceShows, type DrawingRead, type Point } from "tsdraft";
import { cacheFolder, ReadCache, type CachedRead } from "./read-cache.ts";
import { findReaders, readerFor } from "./readers.ts";

/** The most xrefs inside xrefs followed, as the picture of an xref follows them. */
const XREF_DEPTH = 16;

/**
 * The most reads of xrefs given, counting each place a file is attached at: files that attach one
 * another would otherwise give a tree as large as the ways through them.
 */
const XREF_NODES = 64;

export interface ShowsRequest {
  readonly file: string;
  /** A layout whose sheet is asked about: its paper and what each viewport shows. */
  readonly sheet?: string;
  /** A layout whose paper alone is asked about. Model space without `sheet` or `layout`. */
  readonly layout?: string;
  readonly near?: Point;
  readonly within?: number;
  /** The file each xref stands for, by the xref's name, at any depth, by its full path. */
  readonly xrefs: Readonly<Record<string, string>>;
  readonly reader?: string;
}

type ReadXrefs = Record<string, DrawingRead | { read: DrawingRead; xrefs?: ReadXrefs }>;

/** Answers one question, and gives what to print and the exit code. */
export async function shows(request: ShowsRequest): Promise<{ json: unknown; code: number }> {
  const cwd = process.cwd();
  const files = [request.file, ...Object.values(request.xrefs)].map((f) => resolve(f));
  const readers = findReaders({ cwd, inputs: files, reader: request.reader });
  const cache = new ReadCache(cacheFolder(readers.project));
  const read = async (file: string): Promise<CachedRead> =>
    cache.read(file, readerFor(readers, extname(file)), {}, { geometry: true });
  const host = await read(resolve(request.file));
  if (!("read" in host)) return { json: { file: host.file, skipped: host.skipped }, code: 1 };
  const skipped: { xref: string; file: string; skipped: string }[] = [];
  // A block name's letters A to Z are one in either case, as the leading CAD app compares them.
  const key = (name: string) => name.replace(/[a-z]/g, (c) => c.toUpperCase());
  const given = new Map(Object.entries(request.xrefs).map(([name, f]) => [key(name), f]));
  let nodes = 0;
  let xrefsCapped = false;
  /**
   * The reads of the xrefs a read names that were given, and of theirs below. Inside an xref only
   * its attachments are followed, as CAD programs load no overlay of a referenced drawing.
   */
  const xrefsOf = async (of: DrawingRead, depth: number, chain: Set<string>) => {
    const out: ReadXrefs = {};
    if (depth >= XREF_DEPTH) return out;
    for (const xref of of.xrefs) {
      if (depth > 0 && xref.overlay) continue;
      const file = given.get(key(xref.name));
      if (file === undefined) continue;
      const path = resolve(file);
      if (chain.has(path)) continue;
      if (++nodes > XREF_NODES) {
        xrefsCapped = true;
        continue;
      }
      const found = await read(path);
      if (!("read" in found)) {
        skipped.push({ xref: xref.name, file: path, skipped: found.skipped });
        continue;
      }
      const below = await xrefsOf(found.read, depth + 1, new Set([...chain, path]));
      out[xref.name] =
        Object.keys(below).length > 0 ? { read: found.read, xrefs: below } : found.read;
    }
    return out;
  };
  const xrefs = await xrefsOf(host.read, 0, new Set([resolve(request.file)]));
  const where =
    request.sheet !== undefined
      ? { sheet: request.sheet }
      : request.layout !== undefined
        ? { layout: request.layout }
        : {};
  const answer =
    request.near !== undefined
      ? nearPoint(host.read, request.near, { xrefs, within: request.within ?? 0, ...where })
      : request.sheet !== undefined
        ? sheetShows(host.read, request.sheet, { xrefs })
        : spaceShows(host.read, { xrefs, ...where });
  const base = {
    file: host.file,
    reader: host.reader,
    from: host.from,
    ...where,
    xrefs: Object.keys(xrefs),
    ...(xrefsCapped ? { xrefsCapped: true } : {}),
    ...(skipped.length > 0 ? { skipped } : {}),
  };
  if (answer === undefined) {
    return {
      json: { ...base, error: `the file has no layout ${request.sheet ?? request.layout}` },
      code: 1,
    };
  }
  return { json: { ...base, ...answer }, code: 0 };
}
