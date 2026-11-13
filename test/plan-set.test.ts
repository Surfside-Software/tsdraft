import assert from "node:assert/strict";
import { test } from "node:test";
import { checkIntent, lint } from "../src/index.ts";
import set, { intent, xrefs } from "../examples/plan-set/set.ts";

test("the permit set example draws its 15 sheets, lints clean and keeps its setbacks", () => {
  assert.deepEqual(
    set.layouts?.map((layout) => layout.name),
    [
      "G-001",
      "C-101",
      "A-101",
      "A-102",
      "A-103",
      "A-201",
      "A-202",
      "A-301",
      "A-601",
      "S-101",
      "S-102",
      "S-501",
      "M-101",
      "E-101",
      "P-101",
    ],
  );
  for (const drawing of [set, ...Object.values(xrefs)]) {
    assert.deepEqual(
      lint(drawing).filter((d) => d.severity === "error"),
      [],
    );
  }
  assert.deepEqual(checkIntent(set, intent), []);
});
