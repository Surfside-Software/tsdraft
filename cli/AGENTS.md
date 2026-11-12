# Agent notes

- `BuildState` in `src/state.ts` is what agents program against. Change a field's meaning or
  remove one only with a bump of `schema`, and keep `test/render.test.ts` in step. A field of
  something no release has shipped may change without a bump: the count of a block's inserts
  gained the inserts on layouts while layouts were unreleased.
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
- The renderer consults no system font by name. `src/fonts.ts` looks in the machine's font
  folders, once for the life of the command, for the file of each TrueType font of `FONTS`,
  or of a font made to its widths, and takes a file only when the family name inside it is
  the one expected. `src/png.ts` sends the renderer's process the files a picture needs, and
  the process sets the SVG's font family to the file's own. Every other font is drawn in the
  shipped JetBrains Mono. `outputs.pngFonts` and each layout's `pngFonts` say which, from
  `pictureFaces`, the one function that picks the files `toPNG` sends. Add a font to
  `SAME_WIDTHS` only when every advance width of the Latin-1 letters is the same share of the
  size as the font's own. Ship no font file that is not under a licence that allows it.
- A text is as long in a PNG as it plots because `toSVG` writes its `textLength`, and as tall
  because `src/png-child.ts` sets its `font-size` to its `data-height` over the cap height of
  the face that draws it. `src/fonts.ts` reads that cap height from the face's file, the
  shipped font's too, and takes `FONTS`' own number for a font's own file, which is how
  AutoCAD sizes the font. Never write a cap height as a constant. The pictures are what an
  agent judges fit by, so `test/png.test.ts` measures a PNG's ink against `measureText`.
- The worker runs the library's `inspectText` after `lint`, when the copy of tsdraft the
  drawing loaded has it, and puts its warnings after `lint`'s diagnostics. It must never fail
  a build or change the exit code, so a throw there gives no warnings. Each warning brings
  its own `bounds`, in its picture's coordinates: do not box it again with `aboutEntity`,
  which would give the box of a whole insert.
- When the drawing file exports `intent`, the worker runs the library's `checkIntent` after
  `inspectText`, and puts its warnings last, under the same terms: no failed build, no change
  to the exit code, and each warning's own `bounds`. When the copy of tsdraft the drawing
  loaded has no `checkIntent`, or its `checkIntent` throws, the build gets one
  `intent-unchecked` warning that says so, so an intent is never passed over without a word.
- `render --view` draws one rectangle with `toSVG`'s `view`, with no margin, as
  `outputs.view`, and writes no other picture. `tsdraft dev` has no view: its server keeps
  only SVG strings and a worker ends after one build. A `Builder` passes the view to the
  worker in each request.
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
  is the drawing file's own log. The drawing file's own import decides which copy of tsdraft
  checks and draws it, by the rule in `findLibrary`, whatever a waiting process holds.
- A waiting process may load ahead, and run, only the library of the command's own package.
  That is the folder two above `src/worker.ts` or `dist/worker.js`, by its real path: its
  `dist/index.js`, or `src/index.ts` in a checkout, and files in that one folder. No name in
  a package.json decides it. `src/warmup.ts` runs that library on a sheet of its own and
  reads nothing. Any other copy of tsdraft, such as a second one in a project's
  `node_modules`, is never loaded or run ahead: it may print, count its calls or loop, and a
  build must answer the same whether its process waited or not. Nor is the drawing, a module
  of the user's or a kit that passes the library on. For those the build runs in a process
  that has started, has stripped a sample file's types and formatted a number, and holds
  nothing else.
- Two processes wait. The first is warmed up, the second holds nothing, so that a build the
  first must not run has a process that has started. A warmed process builds only when every
  file it loaded ahead, every path an import named on the way to one, which covers a link
  pointed elsewhere, and every package.json above one is on disk as it was read. The parent
  compares them before it picks the process, and the process again before it builds and
  answers `stale` if not. While a process loads the library ahead, an import that leads
  outside the library's folder, by its real path, or to a part of Node, is refused in the
  resolve hook, before anything of it runs, and the library is not kept. A warm-up must end
  within `WARM_DEADLINE` of its request, or the parent ends the process. The process also
  ends itself, from a thread of its own that a step that never returns cannot hold, at twice
  the deadline or when its parent is gone. A library that cannot be kept is not loaded ahead
  again until its folder changes: a file or a folder in it, or the folder itself, so that one
  taken away and put back counts. One that missed the deadline once is tried once more after
  the next build, and after a second miss waits for a change too. What a warm-up writes is
  dropped, since a build's `log` is what the drawing file wrote. A module loaded ahead that
  the build reaches is reported to the parent with the version it was read at, as if the
  build had read it, so it is watched as before.
- Never keep a process for a second build: what a drawing leaves in a global or in the
  library would reach the next one. A process ends itself only after its output has left
  it, through the streams' own `write`, kept when the worker loads, since a drawing may replace
  `process.stdout.write`. The parent never ends one that has answered, or the end of a long log
  is lost.
  `test/warm.test.ts` holds all of this by counting what a build reads and by comparing a
  warm answer with a cold one, never by timing.
- The page in `assets/page.html` has no framework and no build step. It finds an entity's element
  by `data-entity="<index>"`, which `toSVG` writes on each element. Position is no guide, since
  `toSVG` leaves out entities on layers that are off or frozen. The fallback to position among
  the children of `toSVG`'s group serves only a copy of tsdraft older than `data-entity`, which
  drew every entity, one element each, in order.
- `toSVG` draws dashes as geometry and writes a `stroke-width` in screen pixels on elements whose
  pen is not the default. resvg ignores `non-scaling-stroke`, so `src/png.ts` turns every
  `stroke-width` into drawing units in proportion to the group's. Change both together.
- Speed is the feature. Run `pnpm bench` after a change to the build path. On a machine that
  is not busy, which is a load average of at most half its cores, both of which the bench
  prints, keep the time from save to pushed SVG for the example sheet well under 100 ms with
  the saves some time apart, and under 150 ms back to back, when each save follows the last
  build at once. A busy machine is slower: give its load beside any number. Never rasterize a
  PNG nobody asked for.
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
  or the setup changes, and run the guide's commands and snippets again. Both tell an agent
  to fit text with `measureText`, to act on the `text-` warnings, and to read small text with
  `--view`: the pictures show what the plot shows, and no page may say otherwise.
