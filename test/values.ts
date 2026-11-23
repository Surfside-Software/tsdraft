// Typed forms of the values the tests hand the library, so a test needs no type assertion: a value
// of the wrong type, given on purpose, data that a fuzz test changes in ways no type allows, and
// an entity of the kind a test expects.
import assert from "node:assert/strict";
import { isObjectOrArray } from "../src/guards.ts";

/** A field of data a fuzz test builds and changes. JSON is one. */
export type Field = null | boolean | number | string | bigint | undefined | Data | readonly Field[];

/** A record of data a fuzz test changes field by field, as plain JavaScript can. */
export interface Data {
  [key: string]: Field;
}

/**
 * `value` where a `T` is taken, though its type does not allow it: what plain JavaScript or a
 * file can hand the library. The test that passes it proves the library refuses it, or stays
 * bounded on it.
 */
export function wrong<T>(value: Field): T {
  // SAFETY: the value is wrong on purpose, and the test that passes it asserts what is done with it.
  return value as never;
}

/** `value`, a value of the library's types, as data that a fuzz test may change. */
export function dataOf<T extends object>(value: T): Data {
  // SAFETY: the library's values are records of data; the test changes them only as data.
  return value as never;
}

/** Copies of the records in `list`, as data. */
export const copies = <T extends object>(list: readonly T[] | undefined): Data[] =>
  (list ?? []).map((item) => ({ ...dataOf(item) }));

function isKind<E extends { readonly kind: string }, K extends E["kind"]>(
  item: E,
  kind: K,
): item is Extract<E, { readonly kind: K }> {
  return item.kind === kind;
}

/** `item`, which must be there and of `kind`, typed as that kind. */
export function ofKind<E extends { readonly kind: string }, K extends E["kind"]>(
  item: E | undefined,
  kind: K,
): Extract<E, { readonly kind: K }> {
  assert.ok(item !== undefined && isKind(item, kind), `expected a ${kind}, got ${item?.kind}`);

  return item;
}

/** Whether `value` is a record, not a list. */
export function isData(value: Field): value is Data {
  return isObjectOrArray(value) && !Array.isArray(value);
}

/** The records in `list`, when it is a list. */
export const recordsIn = (list: Field): Data[] => (Array.isArray(list) ? list.filter(isData) : []);

/** Whether `key` names a field of `record`, its own or its prototype's. */
export function hasKey<T extends object>(record: T, key: PropertyKey): key is keyof T {
  return key in record;
}

/** The field `step` of `value`, a record or a list. */
export const fieldOf = (value: Field, step: string | number): Field =>
  Array.isArray(value) ? value[Number(step)] : isData(value) ? value[step] : undefined;

/** The record at field `step` of `value`, which must be one. */
export function recordAt(value: Field, step: string | number): Data {
  const found = fieldOf(value, step);
  assert.ok(isData(found), `${step} must be a record`);

  return found;
}
