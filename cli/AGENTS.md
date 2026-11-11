# Agent notes

- `BuildState` in `src/state.ts` is what agents program against. Change a field's meaning or
  remove one only with a bump of `schema`, and keep `test/render.test.ts` in step.
- The command opens no file an xref names. The worker draws an xref from the drawing file's
  named export `xrefs` alone, and `drawing.xrefs` says with `shown` which ones the pictures
  have, so an agent knows what it is not seeing.
- `outputs.svg` and `outputs.png` are model space, with or without layouts, and
  `outputs.layouts` has each sheet. The worker draws a layout only with a copy of tsdraft that
  has `viewportView`, since an older one would draw model space for it. `without` leaves a
  layout out whole, or one viewport or one entity of it, by the `item` of a diagnostic.
  A sheet's SVG has its stroke widths in paper units, which `src/png.ts` keeps and the page
  does not touch.
- The renderer draws in a process of its own, `src/png-child.ts`, which `src/png.ts` starts,
  keeps while the command runs, and starts again when it dies. resvg stops its process on
  some pictures, and the command must outlive that: the picture it died on gets a `pngError`,
  its own in `outputs.layouts`, and every other output and the exit code are as they would
  have been. The same holds when the process cannot start. Each request is settled once: an
  `error` listener stays on the process for its whole life, and a send that fails counts as
  the process gone. `render` starts the process before the build, so that it loads while the drawing
  is built. A test that makes the renderer abort runs the command under
  `prlimit --core=1:1 --`, which keeps the kernel from writing a core, and is skipped where
  there is no `prlimit`.
- `toSVG` may throw on a drawing `lint` reports an error for. The worker then draws the drawing
  `without` in `src/omit.ts` gives: the one without the `item` of each error, with a stand-in
  for an entity so the others keep their indexes. `drawing.omitted` lists what was left out,
  and the counts are the real drawing's. If that throws too, the build fails with `lint`'s
  diagnostics kept and exit code 2. A throw with no lint error is a failed build as before.
  `test/shape.test.ts` in the package proves `without` gives a drawing `toSVG` draws.
- `tsdraft dev` must never present a stale or mismatched answer as current. Every file a build
  loads whose real path has no `node_modules` folder is watched and version-checked, wherever it
  is; `inProject` only places errors. A build that read a file changed since, or one file at two
  versions, is thrown away and run again, `pending` is set from the save until the
  replacement is published, and `?build=` on a picture is refused once that build is gone.
- `src/worker.ts` runs in the child process, one per build. It must not write to stdout, which
  is the drawing file's own log. It loads tsdraft only after the drawing, and uses the copy the
  drawing loaded, so a waiting spare never holds stale code.
- The page in `assets/page.html` has no framework and no build step. It finds an entity's element
  by `data-entity="<index>"`, which `toSVG` writes on each element. Position is no guide, since
  `toSVG` leaves out entities on layers that are off or frozen. The fallback to position among
  the children of `toSVG`'s group serves only a copy of tsdraft older than `data-entity`, which
  drew every entity, one element each, in order.
- `toSVG` draws dashes as geometry and writes a `stroke-width` in screen pixels on elements whose
  pen is not the default. resvg ignores `non-scaling-stroke`, so `src/png.ts` turns every
  `stroke-width` into drawing units in proportion to the group's. Change both together.
- Speed is the feature. Run `pnpm bench` after a change to the build path and keep the time from
  save to pushed SVG for the example well under 100 ms. Never rasterize a PNG nobody asked for.
- The command imports the library by its package name, `tsdraft`, which resolves to `../dist`
  in a checkout and in an install, so `check` and `test` build the library first. The worker
  never loads it for itself when the drawing loaded a copy: the drawing file's own import
  decides which copy checks and draws it, and [docs/command.md](../docs/command.md) gives the
  order after that.
- `../src` never imports from this folder. The command is compiled to `dist/` here, and
  `assets/` holds every file it reads at run time, found with a path from `import.meta.url`
  that is the same from `src/` and from `dist/`.
- `@resvg/resvg-js` is an optional dependency. Only `src/png.ts` and `src/png-child.ts` load
  it, and only when a PNG is asked for or `tsdraft dev` starts. Without it the command still gives the SVG and the JSON,
  with the reason in `outputs.pngError`.
- [GUIDE.md](../GUIDE.md) is what an agent that uses tsdraft reads, and
  [docs/command.md](../docs/command.md) is the full page. Keep both true when the JSON, a flag
  or the setup changes, and run the guide's commands and snippets again.
