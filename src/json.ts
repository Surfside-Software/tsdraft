// The `Drawing` format as JSON: one canonical string for a drawing, and the parser that turns
// JSON back into a drawing and refuses what it does not know.
import type { Drawing } from "./drawing.ts";
import { DrawingError, lint } from "./lint.ts";
import { formatProblem } from "./rules.ts";
import { isRecord, PLAIN_OBJECT, readDrawing } from "./shape.ts";

/**
 * Writes the drawing as canonical JSON: no white space, the keys of every object in code-unit
 * order, and each number in the shortest form that reads back as the same number, with `-0`
 * for negative zero. Two drawings that are equal give the same string, whatever order their
 * keys were set in. A field that is `undefined` is left out.
 *
 * The drawing is written as it is and is not checked: `fromJSON` checks it when it is read.
 * Throws when the drawing holds a value JSON cannot, such as `NaN`.
 */
export function toJSON(drawing: Drawing): string {
  let out = "";
  const write = (value: unknown): void => {
    switch (typeof value) {
      case "number":
        if (!Number.isFinite(value)) break;
        out += Object.is(value, -0) ? "-0" : value;
        return;
      case "string":
        out += JSON.stringify(value);
        return;
      case "boolean":
        out += value;
        return;
      case "object": {
        if (value === null) {
          out += "null";
          return;
        }
        if (Array.isArray(value)) {
          out += "[";
          for (let i = 0; i < value.length; i++) {
            if (i > 0) out += ",";
            write(value[i]);
          }
          out += "]";
          return;
        }
        const fields = value as Record<string, unknown>;
        let first = true;
        for (const key of Object.keys(fields).sort()) {
          if (fields[key] === undefined) continue;
          out += `${first ? "{" : ","}${JSON.stringify(key)}:`;
          first = false;
          write(fields[key]);
        }
        out += first ? "{}" : "}";
        return;
      }
    }
    const shown = typeof value === "number" ? String(value) : typeof value;
    throw new Error(`A drawing with a value of ${shown} cannot be written as JSON`);
  };
  write(drawing);
  return out;
}

/**
 * Reads a drawing from JSON, as a string or as the value `JSON.parse` gives, which is returned
 * as the drawing when it passes.
 *
 * It refuses a format version it does not know, a field or an entity kind it does not know, a
 * missing field and a value of the wrong type, and then every error `lint` finds, so a drawing
 * that was read has passed each check the builder makes. It throws a `DrawingError` whose
 * diagnostics name each problem, with the rule `"format"` for the ones `lint` does not look for.
 */
export function fromJSON(json: unknown): Drawing {
  let value = json;
  if (typeof json === "string") {
    try {
      value = JSON.parse(json);
    } catch (thrown) {
      refuse([`The JSON cannot be parsed: ${(thrown as Error).message}`]);
    }
  }
  if (!isRecord(value)) refuse([`The drawing ${PLAIN_OBJECT}`]);
  // The fields of another format version cannot be judged, so its version is all that is said.
  const format = formatProblem(Object.hasOwn(value, "format") ? value.format : undefined);
  if (format) refuse([format]);
  const problems: string[] = [];
  readDrawing(value, "", problems);
  if (problems.length > 0) refuse(problems);
  const errors = lint(value as unknown as Drawing).filter((d) => d.severity === "error");
  if (errors.length > 0) throw new DrawingError(errors);
  return value as unknown as Drawing;
}

function refuse(problems: readonly string[]): never {
  throw new DrawingError(
    problems.map((message) => ({ rule: "format", severity: "error", message })),
  );
}
