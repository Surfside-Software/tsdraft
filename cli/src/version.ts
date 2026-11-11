// A file's version, as the worker saw it when it loaded the file, so the server can tell
// whether the file changed since, without trusting clocks or watch events.
import { realpathSync, statSync } from "node:fs";

/**
 * A string that changes when the file is written, replaced or moved, and, for a path through a
 * symlink, when the link points somewhere else; `null` when it is missing.
 */
export function fileVersion(path: string): string | null {
  try {
    const s = statSync(path, { bigint: true });
    return `${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}:${realpathSync.native(path)}`;
  } catch {
    return null;
  }
}
