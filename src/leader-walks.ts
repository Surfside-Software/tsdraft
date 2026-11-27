// The walks of a leader made by hand that must stay bounded: what reading one again costs when it
// shares its lists with another, and the blocks the leaders of a drawing place, each read from
// fields of any type.
import type { Leader } from "./drawing.ts";
import { isObjectOrArray, isRecord, isString } from "./guards.ts";
import { layerKey } from "./layers.ts";
import { filled, Strings } from "./shape.ts";

/** The shortest line of a note that `leaderRepeats` tells apart by its value. */
const LONG = 256;

/**
 * For the leaders of one call, what reading a leader again costs when it shares its list of
 * shafts, a shaft, its note, its block's values or a line of `LONG` characters or more with a
 * leader read before, as a drawing made in code may: a unit for each shaft, each point, each line,
 * tag and value, and one for each 32 characters a line, tag or value holds. 0 for a leader that shares none, whose lists the drawing holds.
 */
export function leaderRepeats(): (leader: Leader) => number {
  const lists = new WeakMap<object, { readonly cost: number; readonly shares: boolean }>();
  const shafts = new WeakSet<object>();
  const lines = new Strings<true>();

  /** What a list costs, worked out once, and whether it was read before or shares an item. */
  const read = (list: unknown, item: (value: unknown) => [number, boolean]): [number, boolean] => {
    if (!isObjectOrArray(list)) return [0, false];
    const known = lists.get(list);

    if (known) return [known.cost, true];
    let cost = 0;
    let shares = false;

    for (const value of filled(list)) {
      const [more, again] = item(value);
      cost += more;
      shares ||= again;
    }

    lists.set(list, { cost, shares });

    return [cost, shares];
  };

  const shaft = (value: unknown): [number, boolean] => {
    if (!isObjectOrArray(value)) return [1, false];
    const again = shafts.has(value);
    shafts.add(value);

    return [1 + (Array.isArray(value) ? value.length : 0), again];
  };

  const line = (value: unknown): [number, boolean] => {
    if (!isString(value)) return [1, false];
    // A line that took the place of another of its length counts as read before.
    const long = value.length >= LONG;
    const again = long && (lines.get(value) !== undefined || lines.clashes(value));

    if (long) lines.set(value, true);

    return [1 + Math.floor(value.length / 32), again];
  };

  // The values of a block in place of the note, by their tags, read once for each object: each
  // tag and value costs as a line does.
  const sets = new WeakMap<object, { readonly cost: number; readonly shares: boolean }>();

  const valuesOf = (set: unknown): [number, boolean] => {
    if (!isObjectOrArray(set)) return [0, false];
    const known = sets.get(set);

    if (known) return [known.cost, true];
    let cost = 0;
    let shares = false;

    for (const [tag, value] of Object.entries(set)) {
      const [ofTag, sharedTag] = line(tag);
      const [ofValue, sharedValue] = line(value);
      cost += ofTag + ofValue;
      shares ||= sharedTag || sharedValue;
    }

    sets.set(set, { cost, shares });

    return [cost, shares];
  };

  return (leader) => {
    const [ofShafts, sharedShafts] = read(leader.shafts, shaft);
    const [ofFar, sharedFar] = read(leader.farShafts, shaft);
    const [ofText, sharedText] = read(leader.text, line);
    const [ofValues, sharedValues] = valuesOf(leader.attributes);

    return sharedShafts || sharedFar || sharedText || sharedValues
      ? ofShafts + ofFar + ofText + ofValues
      : 0;
  };
}

/** The longest name a block may have: no longer name finds one. */
const BLOCK_NAME_MOST = 255;

/**
 * Whether a block, by its name, is placed by a leader of the drawing in place of its note. As the
 * leading CAD app reads a file, it makes every entity directly in such a block transparent
 * ByBlock, whatever it held, and draws the leader's block opaque. A leader is refused inside a
 * block, so this reads model space and the layouts, each list up to its first empty slot, and
 * keys each name once.
 */
export function leaderPlacesBlock(drawing: unknown): (block: string) => boolean {
  const placed = leaderBlockKeys(drawing);

  return (block) =>
    placed.size > 0 && block.length <= BLOCK_NAME_MOST && placed.has(layerKey(block));
}

/** The `layerKey` of each block a leader of the drawing places, as `leaderPlacesBlock` finds them. */
export function leaderBlockKeys(drawing: unknown): ReadonlySet<string> {
  const d: Walked | undefined = isRecord(drawing) ? drawing : undefined;

  const each = (list: unknown, at: (item: Walked) => void): void => {
    if (!Array.isArray(list)) return;

    for (let i = 0; i < list.length; i++) {
      const item: unknown = list[i];

      if (item === undefined) break;

      // A list holds no field this walk reads, so one in place of an item reads as nothing.
      if (isRecord(item)) at(item);
    }
  };

  const named = (name: unknown): string | undefined =>
    isString(name) && name.length <= BLOCK_NAME_MOST ? layerKey(name) : undefined;

  const styles = new Map<string, Walked>();
  each(d?.leaderStyles, (style) => {
    const key = named(style.name);

    if (key !== undefined && !styles.has(key)) styles.set(key, style);
  });
  const placed = new Set<string>();
  // A list many layouts share is read once.
  const seen = new Set<unknown>();

  const read = (entities: unknown): void => {
    if (seen.has(entities)) return;
    seen.add(entities);
    each(entities, (e) => {
      if (e.kind !== "leader") return;
      const style = styles.get(named(e.style) ?? "");
      // The block that `leaderBlock` finds, of fields of any type.
      const key = named(e.block ?? (e.text === undefined ? style?.block : undefined));

      if (key !== undefined) placed.add(key);
    });
  };

  read(d?.entities);
  each(d?.layouts, (layout) => read(layout.entities));

  return placed;
}

/** The fields of a drawing, a layout, a leader or a leader style that the walk for blocks reads. */
interface Walked {
  readonly entities?: unknown;
  readonly layouts?: unknown;
  readonly leaderStyles?: unknown;
  readonly name?: unknown;
  readonly kind?: unknown;
  readonly style?: unknown;
  readonly block?: unknown;
  readonly text?: unknown;
}
