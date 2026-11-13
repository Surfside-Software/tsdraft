// Writes the files the package ships beside its library from the source: standard.json, the
// built-in standard with its title block inline, standard.schema.json, from the table of a
// standard's fields, and src/version.ts, from package.json. test/standard.test.ts fails when a
// committed file differs from what this writes.
//
//   pnpm standard:files
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUILT_IN_STANDARD } from "../src/index.ts";
import { standardSchema } from "../src/standard/shape.ts";

const root = join(import.meta.dirname, "..");

/** The package's version, as package.json gives it. */
export function packageVersion(): string {
  return (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string })
    .version;
}

/** The URL of the schema of the tsdraft of `version`, which a document's `$schema` names. */
export const schemaUrl = (version: string): string =>
  `https://cdn.jsdelivr.net/npm/tsdraft@${version}/standard.schema.json`;

/** standard.json: the built-in standard as a document, without its hash and chain. */
export function builtInDocument(version: string): Record<string, unknown> {
  const { hash: _, chain: __, ...document } = BUILT_IN_STANDARD;
  return { $schema: schemaUrl(version), ...document };
}

/** src/version.ts. */
export function versionSource(version: string): string {
  return [
    "// Written by scripts/standard-files.ts from package.json. Run `pnpm standard:files` after a",
    "// change to the version.",
    "",
    "/** The version of this copy of tsdraft. */",
    `export const VERSION = ${JSON.stringify(version)};`,
    "",
  ].join("\n");
}

if (import.meta.main) {
  const version = packageVersion();
  const json = {
    "standard.json": builtInDocument(version),
    "standard.schema.json": standardSchema(version),
  };
  for (const [name, value] of Object.entries(json)) {
    writeFileSync(join(root, name), `${JSON.stringify(value, null, 2)}\n`);
  }
  writeFileSync(join(root, "src", "version.ts"), versionSource(version));
  // The formatter lays the JSON out, so `pnpm fmt:check` passes on the files as written.
  execFileSync(join(root, "node_modules", ".bin", "oxfmt"), Object.keys(json), {
    cwd: root,
    stdio: "inherit",
  });
}
