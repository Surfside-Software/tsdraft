# Development

This page covers the tests and compilers behind `pnpm verify` and
`pnpm test:cad`, and how to release. The [README](../README.md#development) has
the setup.

`pnpm test:cad` opens the output in AutoCAD. It needs
`TSDRAFT_CAD_SSH=user@host`, an ssh login to a WSL shell on a Windows machine
that has AutoCAD. Each test drawing runs in AutoCAD's headless console, which
runs `AUDIT` and saves the drawing back as DXF. The script then compares that
file with what was drawn. Run it after any change to a DXF writer, because
AutoCAD rejects files that DXF parsing libraries accept. Some of its cases write
a file `toDXF` would refuse, to show that AutoCAD does what the rule says.

`pnpm test:package` packs the package, installs the tarball into a throwaway
project and checks that it type-checks and runs there. `pnpm build` compiles
`src/` to `dist/`, and `npm pack` and `npm publish` run it automatically.

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
