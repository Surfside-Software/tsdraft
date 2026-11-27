// `tsdraft render`, as a function: builds a drawing file once, writes its pictures and gives the
// BuildState and the exit code. The command prints it, and `tsdraft mcp` serves it.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { type Builder, projectRoot, round, toState } from "./build.ts";
import { faces, pdfFonts, pngFonts } from "./fonts.ts";
import { isString } from "./guards.ts";
import { pngUnavailable, RendererCrashed, startRenderer, toPNG } from "./png.ts";
import type { BuildError, BuildState, ChangesOutput, LayoutOutput, ViewOutput } from "./state.ts";

export interface RenderOptions {
  /** Builds the file. It must have been made with `view` when `view` is given. */
  readonly builder: Builder;
  /** Ends the builder once the drawing is built, before the pictures are written. */
  readonly closeBuilder: boolean;
  /** The PNG width in pixels. */
  readonly width: number;
  /** The folder the pictures go to. Without it, an out folder beside the file, which is the command's own. */
  readonly out?: string;
  readonly pdf: boolean;
  /** The one rectangle to draw, as x0, y0, x1, y1. */
  readonly view?: readonly [number, number, number, number];
  /**
   * How many PNGs to draw, in the order a brief lists the pictures: the view, an edit's pictures
   * of changes, each layout's sheet, then model space. Every one when it is not given. A picture
   * past it gets its SVG alone, with `pngError` saying so.
   */
  readonly pngs?: number;
}

/** The `pngError` of a picture `pngs` left without its PNG. */
export const PNG_SKIPPED = "Not drawn: the render asked for fewer PNGs";

export interface Rendered {
  readonly state: BuildState;
  /** 0 when it built with no lint errors, 2 when lint reported errors, 1 when it failed. */
  readonly code: 0 | 1 | 2;
}

/** Builds `file`, a real path, once and writes its pictures, as `tsdraft render` does. */
export async function render(file: string, options: RenderOptions): Promise<Rendered> {
  const { builder, width, view } = options;
  // The plotter loads only for --pdf, and before anything is built or written, as a static
  // import would: a plotter that fails to load stops the command first.
  const pdf = options.pdf ? await import("./pdf.ts") : undefined;

  // The renderer's process starts while the drawing is built, unless no PNG is wanted. Its
  // modules load before the build starts, so their load time never counts against --timeout.
  if (options.pngs !== 0) startRenderer();

  let pngMs: number | undefined;
  const building = builder.build(file, projectRoot(file));
  // The machine's fonts are looked for while the drawing is built.
  faces();
  const outcome = await building;

  if (options.closeBuilder) builder.close();

  if (!outcome) throw new Error("The build was stopped before it answered");

  type Mutable<T> = { -readonly [K in keyof T]: T[K] };

  // The pictures that get a PNG, in the order a brief lists them.
  const order = [
    "view",
    ...(outcome.ok && outcome.changes
      ? [
          ...(outcome.changes.svg === null ? [] : ["changes"]),
          ...outcome.changes.layouts.map((_, i) => `changes ${i}`),
        ]
      : []),
    ...(outcome.ok ? outcome.layouts.map((_, i) => `layout ${i}`) : []),
    "model",
  ].filter((key) => key !== "view" || view !== undefined);

  const drawn = new Set(options.pngs === undefined ? order : order.slice(0, options.pngs));

  const layouts: Mutable<LayoutOutput>[] = [];

  /**
   * Draws a picture's PNG and writes it. When the renderer dies on the picture, gives the
   * reason, and the rest of the run goes on: the SVG is written, and so is every other picture.
   */
  const drawPng = async (svg: string, to: string): Promise<string | null> => {
    const t = performance.now();

    try {
      const { png } = await toPNG(svg, width);
      writeFileSync(to, png);

      return null;
    } catch (error) {
      if (!(error instanceof RendererCrashed)) throw error;
      process.stderr.write(`tsdraft: ${error.message}.\n`);

      return error.message;
    } finally {
      pngMs = (pngMs ?? 0) + performance.now() - t;
    }
  };

  const outputs: Mutable<BuildState["outputs"]> = {
    svg: null,
    png: null,
    pngError: null,
    pngFonts: [],
    layouts,
    view: null,
    pdf: null,
    pdfError: null,
    changes: null,
  };

  let failed: BuildError | null = null;
  const dir = resolve(options.out ?? join(file, "..", "out"));
  const name = basename(file, extname(file));
  let path = dir;

  try {
    if (outcome.ok && outcome.view && view) {
      // A view is the one picture of its run.
      mkdirSync(dir, { recursive: true });
      path = join(dir, `${name}.view.svg`);
      writeFileSync(path, outcome.view.svg);
      const unavailable = pngUnavailable();

      const made: ViewOutput = {
        layout: outcome.view.layout,
        box: { min: [view[0], view[1]], max: [view[2], view[3]] },
        svg: path,
        png: null,
        pngError: unavailable,
        pngFonts: pngFonts(outcome.view.fonts, outcome.view.svg),
      };

      outputs.view = made;

      if (unavailable === null && !drawn.has("view")) {
        outputs.view = { ...made, pngError: PNG_SKIPPED };
      } else if (unavailable === null) {
        path = join(dir, `${name}.view.png`);
        const pngError = await drawPng(outcome.view.svg, path);
        outputs.view = { ...made, pngError, png: pngError === null ? path : null };
      } else {
        process.stderr.write(`tsdraft: ${unavailable}.\n`);
      }
    } else if (outcome.ok && outcome.svg) {
      mkdirSync(dir, { recursive: true });
      path = join(dir, `${name}.svg`);
      writeFileSync(path, outcome.svg);
      outputs.svg = path;
      outputs.pngFonts = pngFonts(outcome.fonts, outcome.svg);
      // Without the optional renderer the drawing still built: the JSON says why no PNG.
      const unavailable = pngUnavailable();
      outputs.pngError = unavailable;

      if (outputs.pngError === null && !drawn.has("model")) {
        outputs.pngError = PNG_SKIPPED;
      } else if (outputs.pngError === null) {
        path = join(dir, `${name}.png`);
        outputs.pngError = await drawPng(outcome.svg, path);

        if (outputs.pngError === null) outputs.png = path;
      } else {
        process.stderr.write(`tsdraft: ${outputs.pngError}.\n`);
      }

      // Each layout's sheet, beside the picture of model space.
      const taken = new Set<string>();
      const sheets: { stem: string; svg: string }[] = [];

      for (const [i, sheet] of outcome.layouts.entries()) {
        const stem = layoutFile(name, sheet.name, taken);
        path = join(dir, `${stem}.svg`);
        writeFileSync(path, sheet.svg);

        const made: Mutable<LayoutOutput> = {
          name: sheet.name,
          ...(sheet.file !== undefined && { file: sheet.file }),
          svg: path,
          png: null,
          pngError: unavailable,
          pngFonts: pngFonts(sheet.fonts, sheet.svg),
          pdf: null,
          pdfError: null,
          pdfFonts: pdfFonts(sheet.fonts),
          pdfMissing: null,
        };

        if (unavailable === null && !drawn.has(`layout ${i}`)) {
          made.pngError = PNG_SKIPPED;
        } else if (unavailable === null) {
          path = join(dir, `${stem}.png`);
          made.pngError = await drawPng(sheet.svg, path);

          if (made.pngError === null) made.png = path;
        }

        layouts.push(made);
        sheets.push({ stem, svg: sheet.svg });
      }

      // An edit's pictures of what it changes, each beside the picture it marks.
      if (outcome.changes) {
        const write = async (svg: string, stem: string, key: string) => {
          path = join(dir, `${stem}.svg`);
          writeFileSync(path, svg);
          const svgPath = path;
          let pngError = unavailable === null && !drawn.has(key) ? PNG_SKIPPED : unavailable;
          let png: string | null = null;

          if (pngError === null) {
            path = join(dir, `${stem}.png`);
            pngError = await drawPng(svg, path);

            if (pngError === null) png = path;
          }

          return { svg: svgPath, png, pngError };
        };

        const model =
          outcome.changes.svg === null
            ? null
            : await write(outcome.changes.svg, `${name}.changes`, "changes");

        const changed: Mutable<ChangesOutput> = {
          svg: model?.svg ?? null,
          png: model?.png ?? null,
          pngError: model?.pngError ?? null,
          layouts: [],
        };

        for (const [i, sheet] of outcome.changes.layouts.entries()) {
          const stem = sheets[i]?.stem ?? layoutFile(name, sheet.name, taken);
          changed.layouts = [
            ...changed.layouts,
            { name: sheet.name, ...(await write(sheet.svg, `${stem}.changes`, `changes ${i}`)) },
          ];
        }

        outputs.changes = changed;
      }

      // Each sheet, then the set: a page for each sheet, in the order of the layouts.
      if (pdf && sheets.length > 0) {
        const { plot } = pdf;
        const omitted = outcome.drawing?.omitted?.length ?? 0;

        if (omitted > 0) {
          outputs.pdfError =
            "The build left out what lint refused, which drawing.omitted lists, so its sheets are not plotted";

          for (const made of layouts) made.pdfError = outputs.pdfError;
        } else {
          for (const [i, sheet] of sheets.entries()) {
            const made = layouts[i]!;
            const plotted = await plot([sheet.svg]);
            made.pdfError = plotted.error;

            if (plotted.pdf) {
              path = join(dir, `${sheet.stem}.pdf`);
              writeFileSync(path, plotted.pdf);
              made.pdf = path;
              made.pdfMissing = plotted.missing[0] ?? "";
            }
          }

          const unplotted = layouts.find((made) => made.pdf === null);

          if (unplotted) {
            outputs.pdfError = `The sheet ${JSON.stringify(unplotted.name)} could not be plotted, so the set is not`;
          } else {
            const plotted = await plot(sheets.map((sheet) => sheet.svg));
            outputs.pdfError = plotted.error;

            if (plotted.pdf) {
              path = join(dir, `${name}.pdf`);
              writeFileSync(path, plotted.pdf);
              outputs.pdf = path;
            }
          }
        }
      }
    }
  } catch (error) {
    failed = outputError(`Could not write ${path}`, error);
  }

  // Only the default folder belongs to the command. A file in --out may be the user's.
  if (options.out === undefined) {
    const removeOld = (old: string): void => {
      try {
        rmSync(old, { force: true });
      } catch (error) {
        if (outcome.ok) failed ??= outputError(`Could not remove the old ${old}`, error);
      }
    };

    for (const [kind, written] of Object.entries({
      svg: outputs.svg,
      png: outputs.png,
      "view.svg": outputs.view?.svg ?? null,
      "view.png": outputs.view?.png ?? null,
      "changes.svg": outputs.changes?.svg ?? null,
      "changes.png": outputs.changes?.png ?? null,
      pdf: outputs.pdf,
    })) {
      if (written === null) removeOld(join(dir, `${name}.${kind}`));
    }

    if (existsSync(dir)) {
      const kept = new Set([
        ...layouts.flatMap((made) => [made.svg, made.png, made.pdf]),
        ...(outputs.changes?.layouts ?? []).flatMap((made) => [made.svg, made.png]),
      ]);

      for (const entry of readdirSync(dir)) {
        if (!entry.startsWith(`${name}.layout-`) || !/\.(svg|png|pdf)$/.test(entry)) continue;
        const old = join(dir, entry);

        if (!kept.has(old)) removeOld(old);
      }
    }
  }

  const state = toState(outcome, randomUUID().slice(0, 8), 1, file, outcome.ok ? 1 : null, outputs);
  const timings = pngMs === undefined ? state.timings : { ...state.timings, png: round(pngMs) };

  const result: BuildState = failed
    ? { ...state, ok: false, error: failed, timings }
    : { ...state, timings };

  const errors = state.drawing?.counts.errors ?? 0;

  return {
    state: result,
    code: outcome.linted || (result.ok && errors > 0) ? 2 : result.ok ? 0 : 1,
  };
}

/**
 * The name of a layout's pictures, without an extension: the drawing file's name, `.layout-`
 * and the layout's name with every character a file name may not hold as `_`. A second layout
 * that comes to the same name has a number after it.
 */
function layoutFile(name: string, layout: string, taken: Set<string>): string {
  const safe = layout.replaceAll(/[^A-Za-z0-9._-]/g, "_");
  let stem = `${name}.layout-${safe}`;

  for (let n = 2; taken.has(stem.toLowerCase()); n++) stem = `${name}.layout-${safe}-${n}`;
  taken.add(stem.toLowerCase());

  return stem;
}

function outputError(what: string, cause: unknown): BuildError {
  // SAFETY: the writes, the renderer and the plot fail with Errors, those of the file system
  // with a code.
  const e = cause as NodeJS.ErrnoException;

  return {
    name: "Output",
    message: `${what}: ${e.message}`,
    code: isString(e.code) ? e.code : null,
    file: null,
    line: null,
    column: null,
    stack: e.stack ?? "",
  };
}
