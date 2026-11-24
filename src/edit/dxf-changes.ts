// The changes of a DXF: for each change of an entity, of a layer and of a viewport, the records it
// writes again and the splices of each, and the fields a whole value takes out. Each value is the
// one `changedEntity` gives, so the copy reads as `editedRead` says.
import { isString } from "../guards.ts";
import type { DxfDocument } from "../read/document.ts";
import type { DrawingRead, ReadAttribute, ReadEntity } from "../read/model.ts";
import { changedEntity, changedViewport, layerNamed, linetypeNamed } from "./changed.ts";
import {
  boxSplices,
  headerSplice,
  layerSplices,
  penSplices,
  penValues,
  textSplices,
  viewportSplices,
  type TextValues,
} from "./dxf-change.ts";
import type { HeldGroup, Splice } from "./dxf-groups.ts";
import { headerValue } from "./dxf.ts";
import { facingOf } from "./dxf-move.ts";
import {
  canonicalHandle,
  EditError,
  type Edit,
  type EntityChanges,
  type TextChange,
} from "./model.ts";
import { indexRead } from "./reach.ts";

/** What the changes need of the DXF's records, as `recordEdits` holds them. */
export interface ChangeRecords {
  readonly bytes: Uint8Array;
  readonly doc: DxfDocument;
  readonly byHandle: ReadonlyMap<string, number>;
  kind(i: number): string;
  section(i: number): string;
  groups(i: number): HeldGroup[];
  /** The record of a handle a statement names, with the refusals of a block's definition. */
  named(h: string, statement: number): number;
  /** The records that follow an insert with attributes or a 2D polyline, its own up to its SEQEND. */
  followers(i: number): number[];
  /** The handle of the entry `name` of the dictionary of record `i`. */
  dictionaryEntry(i: number, name: string): string | undefined;
}

export interface ChangeEdits {
  readonly splices: ReadonlyMap<number, Splice[]>;
  /** The records a whole value takes out with its fields, by the statement. */
  readonly erased: ReadonlyMap<number, number>;
}

/** The record its extension dictionary names `name`, or undefined. */
function extensionOf(r: ChangeRecords, i: number, name: string): number | undefined {
  const groups = r.groups(i);
  const at = groups.findIndex((g) => g.code === 102 && g.value.trim() === "{ACAD_XDICTIONARY");
  const h = at >= 0 ? groups[at + 1]?.value.trim() : undefined;
  const x = h === undefined ? undefined : r.byHandle.get(canonicalHandle(h));
  const f = x === undefined ? undefined : r.dictionaryEntry(x, name);

  return f === undefined ? undefined : r.byHandle.get(canonicalHandle(f));
}

/** The dictionary of a text's fields, which its extension dictionary names `ACAD_FIELD`, or undefined. */
const fieldsOf = (r: ChangeRecords, i: number): number | undefined =>
  extensionOf(r, i, "ACAD_FIELD");

/** The changes of a text a change writes, from the entity before and after it. */
function textValues(
  before: ReadEntity | ReadAttribute,
  after: ReadEntity | ReadAttribute,
  change: TextChange | undefined,
  c: EntityChanges,
): TextValues {
  const value = change === undefined || !("value" in after) ? undefined : after.value;
  const out: { -readonly [K in keyof TextValues]: TextValues[K] } = {};

  if (value !== undefined) out.value = value;

  if ("stored" in after && "stored" in before) {
    if (after.stored[0] !== before.stored[0] || after.stored[1] !== before.stored[1])
      out.stored = after.stored;

    if ((after.widthFactor ?? 1) !== (before.widthFactor ?? 1))
      out.widthFactor = after.widthFactor ?? 1;
  }

  if ("height" in after && "height" in before && after.height !== before.height)
    out.height = after.height;

  if (c.width !== undefined && "width" in after) out.width = after.width;

  return out;
}

const textPlace = (kind: string): "AcDbText" | "AcDbMText" | undefined =>
  kind === "TEXT" || kind === "ATTRIB" ? "AcDbText" : kind === "MTEXT" ? "AcDbMText" : undefined;

/** The splices of each change of the edit, and the fields a whole value takes out. */
export function changeSplices(r: ChangeRecords, edit: Edit, read: DrawingRead): ChangeEdits {
  const splices = new Map<number, Splice[]>();
  const erased = new Map<number, number>();
  let index: ReturnType<typeof indexRead> | undefined;
  let visretain = false;
  let apps: boolean | undefined;

  /** True when the file's APPID table registers AcXRefLayerPropertyOverride. */
  const registered = (): boolean => {
    if (apps !== undefined) return apps;
    apps = false;

    for (let i = 0; i < r.doc.count && !apps; i++)
      if (r.kind(i) === "APPID" && r.section(i) === "TABLES")
        apps = r
          .groups(i)
          .some((g) => g.code === 2 && g.value.trim() === "AcXRefLayerPropertyOverride");

    return apps;
  };

  const add = (i: number, list: Splice[] | string, statement: number, what: string): void => {
    if (isString(list)) throw new EditError(`${what}: ${list}`, statement);

    if (list.length === 0) return;
    const held = splices.get(i);

    if (held) held.push(...list);
    else splices.set(i, [...list]);
  };

  /** A whole value takes out the fields of its text; a replacement in one is refused. */
  const fields = (i: number, change: TextChange, statement: number, h: string): void => {
    const f = fieldsOf(r, i);

    if (f === undefined) return;

    if (!isString(change))
      throw new EditError(
        `${h} shows a field, which writes its own value back over a part of it: give it a whole value, which takes the field out`,
        statement,
      );
    erased.set(f, statement);
  };

  /**
   * A justified text seen from below places its start in its own coordinates by a rule the
   * widths of the read do not hold: one whose start a change would move is refused.
   */
  const down = (
    i: number,
    before: ReadEntity | ReadAttribute,
    after: ReadEntity | ReadAttribute,
    statement: number,
    h: string,
  ): void => {
    if (!("stored" in before) || !("stored" in after)) return;

    const moves =
      before.stored[0] !== after.stored[0] ||
      before.stored[1] !== after.stored[1] ||
      (before.widthFactor ?? 1) !== (after.widthFactor ?? 1);

    if (moves && facingOf(r.groups(i)) !== 1)
      throw new EditError(
        `${h} is a justified text seen from below, whose start a change of it is not placed again for`,
        statement,
      );
  };

  edit.statements.forEach((s, statement) => {
    if (s.kind === "change") {
      index ??= indexRead(read);
      const h = canonicalHandle(s.handle);
      const at = index.byHandle.get(h);

      if (at?.kind !== "entity")
        throw new EditError(`${h} is not an entity the read keeps`, statement);
      const i = r.named(h, statement);
      const c = s.changes;
      const before = at.entity;
      const after = changedEntity(before, c, read);

      if ("problem" in after) throw new EditError(`${h}: ${after.problem}`, statement);
      const kind = r.kind(i);

      const pen = penValues(c, {
        ...(c.layer !== undefined && { layer: layerNamed(read, c.layer)?.name ?? c.layer }),
        ...(c.linetype !== undefined && {
          linetype: linetypeNamed(read, c.linetype) ?? c.linetype,
        }),
      });

      add(i, penSplices(r.groups(i), pen), statement, h);

      // A 2D polyline's vertices and its SEQEND, and an insert's SEQEND, take its pen.
      if (pen.size > 0)
        for (const k of r.followers(i))
          if (r.kind(k) !== "ATTRIB") add(k, penSplices(r.groups(k), pen), statement, h);
      const place = textPlace(kind);

      if (c.text !== undefined || c.height !== undefined || c.width !== undefined) {
        if (place === undefined)
          throw new EditError(`${h} is a ${kind}, which holds no text`, statement);

        if (c.text !== undefined) fields(i, c.text, statement, h);

        if (place === "AcDbText") down(i, before, after, statement, h);
        add(i, textSplices(r.groups(i), place, textValues(before, after, c.text, c)), statement, h);
      }

      if (c.boxHeight !== undefined) {
        if (kind !== "MULTILEADER")
          throw new EditError(`${h} is a ${kind}, which holds no note box`, statement);

        if (extensionOf(r, i, "AcDbContextDataManager") !== undefined)
          throw new EditError(`${h} is annotative, with a note box for each scale`, statement);
        add(i, boxSplices(r.groups(i)), statement, h);
      }

      if (c.attributes !== undefined && before.kind === "insert" && after.kind === "insert") {
        const list = before.attributes ?? [];

        for (const tag in c.attributes) {
          const k = list.findIndex((a) => a.tag.toUpperCase() === tag.toUpperCase());
          const a = list[k];
          const b = after.attributes?.[k];

          if (a?.handle === undefined || b === undefined)
            throw new EditError(`${h} holds no attribute ${JSON.stringify(tag)}`, statement);
          const j = r.byHandle.get(canonicalHandle(a.handle));

          if (j === undefined)
            throw new EditError(`The file holds no record of the attribute ${a.handle}`, statement);
          fields(j, c.attributes[tag]!, statement, a.handle);

          if (a.paragraph === undefined) down(j, a, b, statement, a.handle);
          const values = textValues(a, b, c.attributes[tag], {});
          add(
            j,
            textSplices(r.groups(j), a.paragraph === undefined ? "AcDbText" : "embedded", values),
            statement,
            a.handle,
          );
        }
      }

      return;
    }

    if (s.kind === "layer") {
      const layer = layerNamed(read, s.name);

      const i =
        layer?.handle === undefined ? undefined : r.byHandle.get(canonicalHandle(layer.handle));

      if (layer === undefined || i === undefined || r.kind(i) !== "LAYER")
        throw new EditError(
          `The file holds no record of the layer ${JSON.stringify(s.name)}`,
          statement,
        );

      const linetype =
        s.changes.linetype === undefined ? undefined : linetypeNamed(read, s.changes.linetype);

      add(
        i,
        layerSplices(r.groups(i), s.changes, linetype, layer.xref, registered()),
        statement,
        layer.name,
      );
      visretain ||= layer.xref;

      return;
    }

    if (s.kind !== "viewport") return;
    index ??= indexRead(read);
    const h = canonicalHandle(s.handle);
    const at = index.byHandle.get(h);
    const i = r.byHandle.get(h);

    if (at?.kind !== "viewport" || i === undefined)
      throw new EditError(`${h} is not a viewport the read keeps`, statement);
    const c = s.changes;
    const after = changedViewport(at.viewport, c, read);
    const groups = r.groups(i);
    const num = (code: number): number => Number(groups.find((g) => g.code === code)?.value ?? 0);
    const turn = c.center !== undefined || c.twist !== undefined;
    // The view's center in the coordinates of its display, which turn with its twist from its target.
    const t = (after.twist * Math.PI) / 180;
    const [dx, dy] = [after.viewCenter[0] - num(17), after.viewCenter[1] - num(27)];

    const frozen = (): string[] | undefined => {
      if (c.freeze === undefined && c.thaw === undefined) return undefined;
      const handleOf = (name: string): string | undefined => layerNamed(read, name)?.handle;
      const thaw = new Set((c.thaw ?? []).flatMap((n) => handleOf(n) ?? []).map(canonicalHandle));
      const held = groups.filter((g) => g.code === 331).map((g) => g.value.trim());
      const out = held.filter((x) => !thaw.has(canonicalHandle(x)));

      for (const name of c.freeze ?? []) {
        const x = handleOf(name);

        if (x === undefined)
          throw new EditError(`The file holds no layer ${JSON.stringify(name)}`, statement);

        if (!out.some((y) => canonicalHandle(y) === canonicalHandle(x))) out.push(x);
      }

      return out;
    };

    const list = frozen();

    add(
      i,
      viewportSplices(groups, {
        ...(turn && {
          center: [
            dx * Math.cos(t) - dy * Math.sin(t),
            dx * Math.sin(t) + dy * Math.cos(t),
          ] as const,
        }),
        ...(c.ratio !== undefined && { viewHeight: after.viewHeight }),
        ...(c.twist !== undefined && { twist: after.twist }),
        ...(c.on !== undefined && { on: c.on }),
        ...(list !== undefined && { frozen: list }),
      }),
      statement,
      h,
    );
  });

  // A host keeps its changes of an xref's layers only at VISRETAIN 1.
  if (visretain) {
    const v = r.doc.header().find((x) => x.name === "$VISRETAIN");

    if (v !== undefined) {
      const splice = headerSplice(r.bytes, v.start, v.length, 1);

      if (splice !== undefined && headerValue(r.bytes, r.doc, "$VISRETAIN") !== "1") {
        let k = 0;

        while (k + 1 < r.doc.count && r.doc.starts[k + 1]! <= v.start) k++;
        const held = splices.get(k);

        if (held) held.push(splice);
        else splices.set(k, [splice]);
      }
    }
  }

  return { splices, erased };
}
