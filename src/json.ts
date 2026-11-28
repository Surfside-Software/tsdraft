// The `Drawing` format as JSON: one canonical string for a drawing, and the parser that turns
// JSON back into a drawing and refuses what it does not know.
import { isBoolean, isNumber, isPlainRecord, isRecord, isString, type Json } from "./guards.ts";
import type { Drawing } from "./drawing.ts";
import { DrawingError, lint } from "./lint.ts";
import { formatProblem, typeName } from "./rules.ts";
import { PLAIN_OBJECT, readDrawing } from "./shape.ts";

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
  return canonical(drawing, "A drawing");
}

/**
 * Writes a value as canonical JSON, as `toJSON` writes a drawing. Throws a `RangeError` when the
 * value holds one JSON cannot, such as `NaN`, naming it as `what` does. `written` may give the canonical
 * JSON of an object already worked out, which is then used as it is.
 *
 * It also throws once the JSON would run past `most` characters, or it has read more than
 * `most` keys, so a value that holds one list many times over costs no more than `most`.
 */
export function canonical(
  value: unknown,
  what = "A value",
  written?: (value: WeakKey) => string | undefined,
  most = Infinity,
): string {
  let out = "";
  // Every key read, those whose value is `undefined` among them, which are left out: so it counts
  // the work, and is only an upper bound of the keys written.
  let keys = 0;

  const past = (more: number): void => {
    if (out.length + more > most || keys > most) {
      throw new RangeError(`${what} runs past ${most} characters of JSON`);
    }
  };

  /** Writes the JSON `written` gives for an object, when it gives one. */
  const writtenBefore = (value: WeakKey): boolean => {
    const known = written?.(value);

    if (known === undefined) return false;
    out += known;

    return true;
  };

  const write = (value: unknown): void => {
    past(0);

    if (isNumber(value)) {
      if (Number.isFinite(value)) {
        out += Object.is(value, -0) ? "-0" : value;

        return;
      }
    } else if (isString(value)) {
      past(value.length + 2);
      out += JSON.stringify(value);

      return;
    } else if (isBoolean(value)) {
      out += value;

      return;
    } else if (value === null) {
      out += "null";

      return;
    } else if (Array.isArray(value)) {
      if (writtenBefore(value)) return;
      // Its brackets and commas.
      past(value.length + 1);
      out += "[";

      for (let i = 0; i < value.length; i++) {
        if (i > 0) out += ",";
        write(value[i]);
      }

      out += "]";

      return;
    } else if (isRecord(value)) {
      if (writtenBefore(value)) return;
      // The keys are counted, and the budget checked, before any value is read.
      const names = Object.keys(value);
      keys += names.length;
      past(0);
      let first = true;

      for (const key of names.sort()) {
        if (value[key] === undefined) continue;
        out += `${first ? "{" : ","}${JSON.stringify(key)}:`;
        first = false;
        write(value[key]);
      }

      out += first ? "{}" : "}";

      return;
    }

    const shown = isNumber(value) ? String(value) : typeName(value);
    throw new RangeError(`${what} with a value of ${shown} cannot be written as JSON`);
  };

  write(value);

  return out;
}

/**
 * Reads a drawing from JSON, as a string or as the value `JSON.parse` gives, which is returned
 * as the drawing when it passes.
 *
 * It refuses a format version it does not know, a field or an entity kind it does not know, a
 * missing field and a value of the wrong type, and then every error `lint` finds, so a drawing
 * that was read has passed each check the builder makes, and a `check-capped` warning, as
 * `toDXF` refuses it. It throws a `DrawingError` whose
 * diagnostics name each problem, with the rule `"format"` for the ones `lint` does not look for.
 */
export function fromJSON(json: unknown): Drawing {
  let value = json;

  if (isString(json)) {
    try {
      value = parseJson(json);
    } catch (thrown) {
      refuse([
        `The JSON cannot be parsed: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
      ]);
    }
  }

  if (!isPlainRecord(value)) refuse([`The drawing ${PLAIN_OBJECT}`]);
  // The fields of another format version cannot be judged, so its version is all that is said.
  const format = formatProblem(Object.hasOwn(value, "format") ? value.format : undefined);

  if (format) refuse([format]);
  const problems: string[] = [];

  if (!isDrawing(value, problems)) refuse(problems);

  // A drawing too repetitive for `lint` to check to its end may hide an error past where it
  // stopped, so it is refused as `toDXF` refuses it.
  const errors = lint(value).filter((d) => d.severity === "error" || d.rule === "check-capped");

  if (errors.length > 0) throw new DrawingError(errors);

  return value;
}

/** The value `JSON.parse` gives for a string, which is JSON. */
function parseJson(text: string): Json {
  return JSON.parse(text);
}

/** True for a plain object in which `readDrawing` finds no problem, so it holds a drawing's fields. */
function isDrawing(
  value: Record<string, unknown>,
  problems: string[],
): value is Record<string, unknown> & Drawing {
  readDrawing(value, "", problems);

  return problems.length === 0;
}

function refuse(problems: readonly string[]): never {
  throw new DrawingError(
    problems.map((message) => ({ rule: "format", severity: "error", message })),
  );
}
