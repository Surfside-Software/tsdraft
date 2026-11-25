import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isObjectOrArray, isString } from "../src/guards.ts";

const root = join(import.meta.dirname, "..");

/** What oxlint's JSON format gives, each field as it gives it. */
interface OxlintReport {
  readonly diagnostics?: unknown;
}

interface OxlintDiagnostic {
  readonly code?: unknown;
  readonly filename?: unknown;
}

// What the two rules `.oxlintrc.json` turns off for the files that decode outside input report
// there, by file. Each count is the count found: one that falls lowers its pin in the same change,
// and none may grow.
const PINNED = new Map([
  [
    "no-unknown-parameters",
    new Map([
      ["cli/src/mcp.ts", 7],
      ["cli/src/program.ts", 12],
      ["cli/src/worker.ts", 6],
      ["src/colors.ts", 1],
      ["src/drawing.ts", 32],
      ["src/edit/change-shape.ts", 3],
      ["src/edit/model.ts", 3],
      ["src/json.ts", 3],
      ["src/leaders.ts", 15],
      ["src/lint.ts", 16],
      ["src/points.ts", 1],
      ["src/read/check.ts", 4],
      ["src/rules.ts", 126],
      ["src/shape.ts", 10],
      ["src/shapes.ts", 2],
      ["src/standard/define.ts", 3],
      ["src/standard/lint.ts", 5],
      ["src/standard/made.ts", 3],
      ["src/standard/shape.ts", 7],
      ["src/tables.ts", 9],
      ["src/transparency.ts", 1],
    ]),
  ],
  [
    "no-unsafe-dictionary-type",
    new Map([
      ["src/guards.ts", 3],
      ["src/json.ts", 2],
      ["src/shape.ts", 1],
    ]),
  ],
]);

/** One violation of each pinned rule. */
const FIXTURE = `export function first(value: unknown): boolean {
  return value === 1;
}

export const table: Record<string, unknown> = {};
`;

/** The reports of each pinned rule by file, linting `paths` with the shared rules alone. */
function pinnedReports(dir: string, paths: readonly string[]): Map<string, Map<string, number>> {
  // Without this package's overrides.
  const config = join(dir, "oxlintrc.json");
  writeFileSync(config, JSON.stringify({ extends: [join(root, ".oxlintrc.shared.json")] }));

  const run = spawnSync(
    join(root, "node_modules/.bin/oxlint"),
    ["-c", config, "--format", "json", ...paths],
    { cwd: root, encoding: "utf8" },
  );

  const report: unknown = JSON.parse(run.stdout);
  assert.ok(isObjectOrArray(report), run.stderr);
  const { diagnostics }: OxlintReport = report;
  assert.ok(Array.isArray(diagnostics), run.stderr);
  const reported: readonly unknown[] = diagnostics;
  const found = new Map([...PINNED.keys()].map((rule) => [rule, new Map<string, number>()]));

  for (const one of reported) {
    if (!isObjectOrArray(one)) continue;
    const { code, filename }: OxlintDiagnostic = one;

    if (!isString(code) || !isString(filename)) continue;
    const rule = /^anti-slop\((.+)\)$/.exec(code)?.[1];

    const counts = rule === undefined ? undefined : found.get(rule);

    counts?.set(filename, (counts.get(filename) ?? 0) + 1);
  }

  return found;
}

test("the shared rules report each pinned rule by the code the pins name", () => {
  const dir = mkdtempSync(join(tmpdir(), "tsdraft-ratchet-"));

  try {
    const fixture = join(dir, "fixture.ts");
    writeFileSync(fixture, FIXTURE);

    for (const [rule, counts] of pinnedReports(dir, [fixture])) {
      assert.deepEqual(counts, new Map([[fixture, 1]]), `${rule} is not reported`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the files that may take unknown input hold as much of it as their pins say", () => {
  const dir = mkdtempSync(join(tmpdir(), "tsdraft-ratchet-"));

  try {
    for (const [rule, counts] of pinnedReports(dir, ["src", "cli/src"])) {
      assert.deepEqual(counts, PINNED.get(rule), `the reports of ${rule} differ from the pins`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
