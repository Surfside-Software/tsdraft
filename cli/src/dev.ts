// `tsdraft dev`: a live preview on localhost. It rebuilds when the drawing file or a file it
// imported changes, and pushes each build to the page over Server-Sent Events.
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, watch, type FSWatcher } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, relative, sep } from "node:path";
import { Builder, projectRoot, toState, type Outcome } from "./build.ts";
import { pngFonts } from "./fonts.ts";
import { pngUnavailable, startRenderer, toPNG } from "./png.ts";
import type { BuildState } from "./state.ts";
import { fileVersion } from "./version.ts";
import type { FileVersion } from "./worker.ts";

const DEFAULT_PORT = 4610;
const HOST = "127.0.0.1";
/** Editors often write a file in more than one step; wait this long for the last one. */
const SETTLE_MS = 8;
/** The longest `/state.json?after=` may wait. */
const MAX_WAIT_MS = 120_000;
/** PNGs kept for the drawing on screen, the most recently asked for first. */
const PNG_CACHE = 2;

const pagePath = new URL("../assets/page.html", import.meta.url);
const markPath = new URL("../assets/mark.svg", import.meta.url);

/** What the page receives for each build. `svg` is null when the picture did not change. */
interface BuildEvent {
  readonly state: BuildState;
  /** The state of the build on screen, which differs from `state` after a failure. */
  readonly shownState: BuildState | null;
  readonly svg: string | null;
  /** The picture of each layout, in the order of its tab. Null when `svg` is. */
  readonly layouts: readonly { readonly name: string; readonly svg: string }[] | null;
  readonly swatches: Readonly<Record<string, string>>;
}

export async function dev(
  file: string,
  options: { port: number | undefined; timeout: number; drawNoPlot?: boolean },
): Promise<void> {
  const root = projectRoot(file);
  const session = randomUUID().slice(0, 8);
  const builder = new Builder({
    timeout: options.timeout,
    warm: true,
    drawNoPlot: options.drawNoPlot === true,
  });
  /** Why this server makes no PNG, when the optional renderer is absent. */
  const noPng = pngUnavailable();
  // The renderer's process is kept for the session, and started again if it dies on a picture.
  startRenderer();
  const clients = new Set<ServerResponse>();
  /** Calls each waiting `?after=` request when a build is published. */
  const waiters = new Set<() => void>();
  /** Each PNG made of the build on screen, by its width and its layout, `null` for model space. */
  let pngs: {
    width: number;
    layout: string | null;
    png: Promise<{ png: Buffer; width: number }>;
  }[] = [];
  let base = "";
  /** The number of the latest build started. */
  let build = 0;
  /** The number of the build queued or running, which will replace `state`. */
  let pending: number | null = 1;
  let state: BuildState | undefined;
  let shown:
    | {
        build: number;
        svg: string;
        fonts: readonly string[];
        layouts: Outcome["layouts"];
        swatches: Readonly<Record<string, string>>;
        state: BuildState;
      }
    | undefined;

  const snapshot = (): BuildState => ({ ...state!, pending });
  const event = (withSvg: boolean): BuildEvent => ({
    state: snapshot(),
    shownState: shown?.state ?? null,
    svg: withSvg ? (shown?.svg ?? null) : null,
    layouts: withSvg ? (shown?.layouts ?? null) : null,
    swatches: shown?.swatches ?? {},
  });
  const send = (res: ServerResponse, event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (event: string, data: unknown) => {
    for (const res of clients) send(res, event, data);
  };

  // The files the latest builds read, with the version each build saw. After a failure it keeps
  // what the last good build loaded as well, so fixing any of those files rebuilds.
  let versions = new Map<string, string | null>([[file, null]]);
  const watchers = new Map<string, FSWatcher>();
  let timer: NodeJS.Timeout | undefined;
  const changed = (files: Iterable<FileVersion>) => {
    for (const [path, version] of files) if (fileVersion(path) !== version) return true;
    return false;
  };
  const schedule = () => {
    pending = build + 1;
    clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), SETTLE_MS);
  };
  const watchFiles = () => {
    const files = [...versions.keys()];
    // A folder, not the file: editors that save by renaming replace the file's inode. A file that
    // does not exist yet is watched through the nearest folder above it that does.
    // Watching a folder follows a symlink to its target, so a path through one also watches each
    // folder that holds a link, to see the link pointed elsewhere.
    const dirs = new Set(files.map(existingFolder));
    const seen = new Set<string>();
    for (const path of files) for (const dir of linkFolders(path, seen)) dirs.add(dir);
    for (const [dir, watcher] of watchers) {
      if (dirs.has(dir)) continue;
      watcher.close();
      watchers.delete(dir);
    }
    for (const dir of dirs) {
      if (watchers.has(dir)) continue;
      const watcher = watch(dir, (_event, name) => {
        // Some platforms give no name; then any change in the folder counts.
        if (name) {
          const path = join(dir, name);
          const relevant = (f: string) => f === path || f.startsWith(path + sep);
          if (![...versions.keys()].some(relevant)) return;
        }
        schedule();
      });
      // A watch that stops would miss the next save, so build now; the build watches again.
      watcher.on("error", () => {
        watcher.close();
        watchers.delete(dir);
        schedule();
      });
      watchers.set(dir, watcher);
    }
  };

  const rebuild = async () => {
    timer = undefined;
    builder.cancel();
    const number = ++build;
    pending = number;
    broadcast("start", { session, build: number });
    const outcome = await builder.build(file, root);
    if (!outcome || number !== build) return;
    if (outcome.ok) versions = new Map(outcome.files);
    else {
      // Files only the last good build read are taken as they are now; the watch covers them.
      for (const path of versions.keys()) versions.set(path, fileVersion(path));
      for (const [path, version] of outcome.files) versions.set(path, version);
    }
    watchFiles();
    // A file the build read changed while it ran, perhaps one not watched until now, or the
    // build read one file at two versions: this answer is stale or mixed, so it is thrown away
    // and the build runs again, unless a save has already queued one.
    if (changed(outcome.files)) {
      if (timer === undefined) void rebuild();
      return;
    }
    if (outcome.ok && outcome.svg) pngs = [];
    const shownBuild = outcome.ok ? number : (shown?.build ?? null);
    const picture = (kind: "svg" | "png", layout?: string): string =>
      `${base}/drawing.${kind}?session=${session}&build=${shownBuild}${
        layout === undefined ? "" : `&layout=${encodeURIComponent(layout)}`
      }`;
    // After a failed build the pictures are still those of the build on screen.
    const sheets = outcome.ok ? outcome.layouts : (shown?.layouts ?? []);
    const outputs: BuildState["outputs"] =
      shownBuild === null
        ? { svg: null, png: null, pngError: null, pngFonts: [], layouts: [] }
        : {
            svg: picture("svg"),
            png: noPng ? null : picture("png"),
            pngError: noPng,
            pngFonts: outcome.ok
              ? pngFonts(outcome.fonts, outcome.svg ?? "")
              : pngFonts(shown?.fonts ?? [], shown?.svg ?? ""),
            layouts: sheets.map(({ name, fonts, svg }) => ({
              name,
              svg: picture("svg", name),
              png: noPng ? null : picture("png", name),
              pngError: noPng,
              pngFonts: pngFonts(fonts, svg),
            })),
          };
    state = toState(outcome, session, number, file, shownBuild, outputs);
    if (pending === number) pending = null;
    if (outcome.ok && outcome.svg) {
      shown = {
        build: number,
        svg: outcome.svg,
        fonts: outcome.fonts,
        layouts: outcome.layouts,
        swatches: outcome.swatches,
        state,
      };
    }
    broadcast("build", event(outcome.ok));
    report(state, root);
    for (const wake of waiters) wake();
  };

  const server = createServer((req, res) => {
    try {
      handle(req, res);
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain" }).end(String(error));
    }
  });

  const handle = (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("x-tsdraft-session", session);
    // Only pages on this machine's own name may read the drawing; a page on another site that
    // points its own name at 127.0.0.1 is turned away, and so is a request another site's page
    // makes, such as an <img> of the PNG.
    const host = req.headers.host ?? "";
    if (
      !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url ?? "/", base);
    const plain = { "cache-control": "no-store" };
    const json = (status: number, body: BuildState) =>
      res
        .writeHead(status, {
          ...plain,
          "content-type": "application/json",
          "x-tsdraft-build": String(body.build),
        })
        .end(`${JSON.stringify(body, null, 2)}\n`);
    switch (url.pathname) {
      case "/":
        res
          .writeHead(200, { ...plain, "content-type": "text/html; charset=utf-8" })
          .end(readFileSync(pagePath));
        return;
      case "/mark.svg":
        res.writeHead(200, { "content-type": "image/svg+xml" }).end(readFileSync(markPath));
        return;
      case "/state.json": {
        // A save whose watch event has not arrived yet, or never will, still counts.
        const recheck = () => {
          if (pending === null && changed(versions)) schedule();
        };
        recheck();
        const after = url.searchParams.get("after");
        if (after === null) {
          if (state) json(200, snapshot());
          else
            res.writeHead(503, { ...plain, "retry-after": "1" }).end("The first build is running");
          return;
        }
        // A build number from another session says nothing about this one's.
        const asked = url.searchParams.get("session");
        const n = asked !== null && asked !== session ? 0 : Number(after);
        const wait = Number(url.searchParams.get("timeout") ?? options.timeout + 5_000);
        if (!Number.isInteger(n) || n < 0 || !(wait >= 0)) {
          res.writeHead(400, plain).end("after must be a build number, timeout milliseconds");
          return;
        }
        const ready = () => state !== undefined && state.build > n && pending === null;
        if (ready()) return json(200, snapshot());
        const finish = () => {
          clearTimeout(expiry);
          waiters.delete(wake);
          // 202: no newer build finished in time; `pending` says whether one is due.
          if (ready()) json(200, snapshot());
          else if (state) json(202, snapshot());
          else
            res.writeHead(503, { ...plain, "retry-after": "1" }).end("The first build is running");
        };
        const wake = () => ready() && finish();
        const expiry = setTimeout(
          () => {
            // A save made while this waited that no watch reported is a build due, not settled.
            recheck();
            finish();
          },
          Math.min(wait, MAX_WAIT_MS),
        );
        waiters.add(wake);
        res.on("close", () => {
          clearTimeout(expiry);
          waiters.delete(wake);
        });
        return;
      }
      case "/drawing.svg":
      case "/drawing.png": {
        if (!shown) {
          res.writeHead(404, plain).end("No build has made a drawing yet");
          return;
        }
        const stamp = { ...plain, "x-tsdraft-build": String(shown.build) };
        const other = url.searchParams.get("session");
        if (other !== null && other !== session) {
          res
            .writeHead(409, { ...stamp, "content-type": "text/plain" })
            .end(`Session ${other} has ended; this is session ${session}. Fetch /state.json.\n`);
          return;
        }
        const asked = url.searchParams.get("build");
        if (asked !== null && asked !== String(shown.build)) {
          res
            .writeHead(409, { ...stamp, "content-type": "text/plain" })
            .end(`Build ${asked} is not on screen; build ${shown.build} is. Fetch /state.json.\n`);
          return;
        }
        // Model space, or with `layout` the sheet of that layout.
        const layout = url.searchParams.get("layout");
        const source =
          layout === null ? shown.svg : shown.layouts.find((sheet) => sheet.name === layout)?.svg;
        if (source === undefined) {
          res
            .writeHead(404, { ...stamp, "content-type": "text/plain" })
            .end(`Build ${shown.build} has no picture of a layout named ${layout}.\n`);
          return;
        }
        if (url.pathname === "/drawing.svg") {
          res.writeHead(200, { ...stamp, "content-type": "image/svg+xml" }).end(source);
          return;
        }
        if (noPng) {
          res.writeHead(501, { ...plain, "content-type": "text/plain" }).end(`${noPng}.\n`);
          return;
        }
        const width = Math.min(Math.max(Number(url.searchParams.get("width")) || 1600, 16), 8000);
        let entry = pngs.find((p) => p.width === width && p.layout === layout);
        if (!entry) {
          const made = { width, layout, png: toPNG(source, width) };
          made.png.catch(() => (pngs = pngs.filter((p) => p !== made)));
          entry = made;
        }
        pngs = [entry, ...pngs.filter((p) => p !== entry)].slice(0, PNG_CACHE);
        entry.png.then(
          ({ png, width: used }) =>
            res
              .writeHead(200, {
                ...stamp,
                "content-type": "image/png",
                "x-tsdraft-width": String(used),
              })
              .end(png),
          (error: unknown) => res.writeHead(500, plain).end(String(error)),
        );
        return;
      }
      case "/events": {
        res.writeHead(200, {
          ...plain,
          "content-type": "text/event-stream",
          connection: "keep-alive",
        });
        clients.add(res);
        res.on("close", () => clients.delete(res));
        send(res, "hello", { file: relative(root, file), root, session, pending });
        if (state) send(res, "build", event(true));
        if (pending !== null) send(res, "start", { session, build: pending });
        return;
      }
      default:
        res.writeHead(404, plain).end();
    }
  };

  const port = await listen(server, options.port ?? DEFAULT_PORT, options.port === undefined);
  base = `http://${HOST}:${port}`;
  process.stdout.write(`tsdraft dev  ${base}  ${relative(process.cwd(), file) || file}\n`);
  if (noPng) process.stderr.write(`tsdraft: ${noPng}.\n`);
  // A comment line now and then keeps proxies and idle timers from closing the stream.
  setInterval(() => {
    for (const res of clients) res.write(": keep-alive\n\n");
  }, 15_000).unref();
  const stop = () => {
    builder.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  watchFiles();
  await rebuild();
}

/** The folder a file is in, or the nearest one above it that exists. */
function existingFolder(file: string): string {
  let dir = dirname(file);
  while (!existsSync(dir) && dir !== dirname(dir)) dir = dirname(dir);
  return dir;
}

/** The folders that hold a symlink on the way to a path whose real path differs from it. */
function linkFolders(path: string, seen: Set<string>): string[] {
  try {
    if (realpathSync.native(path) === path) return [];
  } catch {
    return [];
  }
  const out: string[] = [];
  for (let at = path; at !== dirname(at) && !seen.has(at); at = dirname(at)) {
    seen.add(at);
    try {
      if (lstatSync(at).isSymbolicLink()) out.push(dirname(at));
    } catch {
      // Gone since; the version check catches it.
    }
  }
  return out;
}

/** Listens on the port, or on the next free one when `fallback` allows it. */
async function listen(
  server: ReturnType<typeof createServer>,
  port: number,
  fallback: boolean,
): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    const tried = fallback && attempt >= 10 ? 0 : port + (fallback ? attempt : 0);
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(tried, HOST, () => {
          server.off("error", reject);
          resolve();
        });
      });
      return (server.address() as AddressInfo).port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || !fallback) throw error;
    }
  }
}

/** One line per build on stdout, for a person watching the terminal or an agent reading it. */
function report(state: BuildState, root: string): void {
  const head = `build ${state.build}  ${state.ok ? "ok" : "failed"}  ${state.ms} ms`;
  if (!state.ok && state.error) {
    const e = state.error;
    const where = e.file ? `${relative(root, e.file)}${e.line ? `:${e.line}` : ""}  ` : "";
    process.stdout.write(`${head}  ${where}${e.message.split("\n")[0]}\n`);
    return;
  }
  const counts = state.drawing?.counts;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const issues = counts
    ? `  ${plural(counts.errors, "error")}, ${plural(counts.warnings, "warning")}`
    : "";
  process.stdout.write(`${head}${issues}\n`);
}
