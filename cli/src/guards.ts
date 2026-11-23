// Runtime checks of values that come from outside the types: a drawing file's exports, a copy of
// tsdraft the drawing loaded, a reader's answer or a file. `typeof` stays in these guards, as in
// the library's own.
import type { Json } from "tsdraft";

export type { Json };

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** An object or an array, not null. Read its keys after an `in` check, which types each one. */
export function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

export function isFunction(value: unknown): value is (...args: never[]) => void {
  return typeof value === "function";
}

/** An object JSON can hold. */
export type JsonObject = { readonly [key: string]: Json };

/** A JSON object: not null, and not a list. */
export function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
