# Development

This page covers the tests and compilers behind `pnpm verify`, and how to
release. The [README](../README.md#development) has the setup.

`src/` is the library and `cli/` is the `tsdraft` command. The library must run
in a browser, so nothing in `src/` imports a Node module, a package or a file
under `cli/`. `pnpm build` compiles `src/` to `dist/` and `cli/src/` to
`cli/dist/`, and `npm pack` and `npm publish` run it automatically. The command
imports the library by its package name, which resolves to `dist/`, so `check`
and `test` build the library first.

`pnpm test:package` packs the package and checks the tarball three ways. It
unpacks it into a throwaway project that type-checks and runs code importing
`tsdraft`, and runs `scripts/library-alone.ts`, which loads every built file of
the library where there are no Node globals and refuses any import that is not
a static import of another library file. It installs the
tarball with npm into an empty project and runs `tsdraft render` and
`tsdraft dev` there. And it installs it again with `--omit=optional` and checks
that the command works without the PNG renderer. The install with the renderer
needs the npm registry.

The official TypeScript 7 compiler checks and builds the package.
[tsrs](https://github.com/oxc-project/tsrs), the Rust port of TypeScript, runs
as `pnpm check:tsrs` and as an informational CI step. It tracks TypeScript 7.1
beta, so it does not gate releases yet. Its WebAssembly build is the planned
route for type-checking drawings in a browser playground.

## Releasing

Bump `version` in `package.json` and add a CHANGELOG entry. After the export
pull request that carries them merges, publish a GitHub release tagged
`v<version>` on the commit it made. The Release workflow checks that the tag
matches the version, runs `pnpm verify` and publishes to npm through
[trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm token
is stored anywhere. npm adds a provenance attestation that links each version to
the commit it was built from.
