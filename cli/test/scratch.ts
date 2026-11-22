import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

/** A temporary project inside the package so its imports resolve to this copy of tsdraft. */
export async function inScratch(use: (dir: string) => void | Promise<void>): Promise<void> {
  const out = join(import.meta.dirname, "../examples/out");
  mkdirSync(out, { recursive: true });
  const dir = mkdtempSync(join(out, "test-"));
  try {
    await use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
