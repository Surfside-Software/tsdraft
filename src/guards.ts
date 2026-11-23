// Runtime checks of values that come from outside the types: JSON, a file, or a caller in plain
// JavaScript. `typeof` stays in these guards, so the code that checks a value says what it decodes.

/** A value JSON can hold. */
export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

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
export function isObjectOrArray(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

export function isFunction(value: unknown): value is (...args: never[]) => void {
  return typeof value === "function";
}

/**
 * True for a plain object whose fields are all its own data: no class or other object behind it
 * to inherit a field from, no symbol or hidden key, which `toJSON` would not write, and no
 * getter or setter, which could give another value each time it is read. No field is read.
 */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);

  if (proto !== Object.prototype && proto !== null) return false;

  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key);

    if (typeof key !== "string" || !field?.enumerable || !("value" in field)) return false;
  }

  return true;
}

/** True for an object that is not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for an object or an array: either is read by key, and its fields are of any type. */
export function isKeyed(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}
