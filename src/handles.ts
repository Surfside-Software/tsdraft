// The handle an entity's id gives it in an R2018 drawing.
//
// AutoCAD names an object by its handle, a number that is unique in its drawing. A dimension
// that another drawing puts on an entity of this one, through an xref, holds the entity's
// handle and nothing else. So the handle comes from the id alone and never from what else the
// drawing holds.
//
// Handles are shared out like this:
//
// - The writers count the handles of every object without an id up from 1. A counted handle
//   cannot reach 2^52, because a drawing cannot hold that many objects. Nothing uses the
//   handles from 2^32 up to 2^52. Keep them for a later scheme.
// - 2^52 up to 2^53 holds the handles that names give: an entity's id, and the keys of
//   `blocks.ts` for a block's own objects and for attributes. Any kind of object but an entity
//   hashes its key with a prefix that no id can contain, such as `block:NAME`, since an id
//   cannot hold `:` or `/`. It hashes into this same range, and two keys that give one handle
//   are refused as two ids are. A key is hashed as its UTF-8 bytes, which for an id are its
//   characters.
// - AutoCAD numbers the objects it adds from `$HANDSEED` up, which is 2^53 when a drawing has
//   ids.
import { idKey, idProblem } from "./rules.ts";

/**
 * `$HANDSEED` of a drawing that has ids: 2^53, one more than the last handle an id can give.
 * AutoCAD numbers the objects it adds from the seed up, so they stay clear of every id's handle.
 */
export const ID_HANDLE_SEED = "20000000000000";

/**
 * The handle an entity with this id has in an R2018 drawing, in hexadecimal as DXF group 5
 * holds it. It depends on the id alone, so the entity keeps it when other entities, layers,
 * linetypes and text styles come and go.
 *
 * With `h` the 64-bit FNV-1a hash of the ASCII bytes of the id in lower case, the handle is
 * `2^52 + ((h AND (2^52 - 1)) XOR (h >> 52))`. Ids are compared without regard to case, so
 * `Door-1` and `door-1` give one handle.
 *
 * What this returns for an id will not change in any later version: another drawing may hold
 * the handle.
 *
 * @param id - An entity id.
 * @throws RangeError when `id` is not a valid entity id.
 */
export function idHandle(id: string): string {
  const problem = idProblem(id);
  if (problem) throw new RangeError(problem);
  return validIdHandle(id);
}

/** `idHandle` for an id that `idProblem` has already passed. */
export function validIdHandle(id: string): string {
  return keyHandle(idKey(id));
}

/**
 * The handle a key gives: 2^52 plus the 64-bit FNV-1a hash of the key's UTF-8 bytes, folded to
 * 52 bits. An id is its own key, in lower case. Every other key starts with a prefix that
 * holds `:`, which no id can.
 */
export function keyHandle(key: string): string {
  // The FNV offset basis, as its high and low 32 bits. The arithmetic stays in 32-bit halves
  // of plain numbers, which every JavaScript engine works out alike.
  let high = 0xcbf29ce4;
  let low = 0x84222325;
  const byte = (value: number): void => {
    low = (low ^ value) >>> 0;
    // Times the FNV prime, 2^40 + 0x1b3, keeping 64 bits.
    const product = low * 0x1b3;
    high = (Math.imul(high, 0x1b3) + Math.floor(product / 2 ** 32) + (low << 8)) >>> 0;
    low = product >>> 0;
  };
  for (let i = 0; i < key.length; i++) {
    // A name holds no character above U+FFFF, so UTF-8 takes one to three bytes for each.
    const code = key.charCodeAt(i);
    if (code < 0x80) byte(code);
    else if (code < 0x800) {
      byte(0xc0 | (code >> 6));
      byte(0x80 | (code & 0x3f));
    } else {
      byte(0xe0 | (code >> 12));
      byte(0x80 | ((code >> 6) & 0x3f));
      byte(0x80 | (code & 0x3f));
    }
  }
  // The top 12 bits are folded into the low 52, and 2^52 is bit 20 of the high half.
  low ^= high >>> 20;
  high = 0x100000 | (high & 0xfffff);
  // The digits come from numbers under 2^31, which print far faster than a larger one.
  return (
    high.toString(16) +
    (low >>> 16).toString(16).padStart(4, "0") +
    (low & 0xffff).toString(16).padStart(4, "0")
  ).toUpperCase();
}
