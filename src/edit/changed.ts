// What a change makes of an entity of the read, a layer and a viewport, as both readers read the
// copy the writers make: `editedRead` and the preview hold these, and `lintEdit` refuses what they
// cannot make.
import { matchedIndex } from "../colors.ts";
import { isString } from "../guards.ts";
import { layerKey } from "../layers.ts";
import type {
  DrawingRead,
  ReadAttribute,
  ReadEntity,
  ReadEntityBase,
  ReadLayer,
  ReadViewport,
} from "../read/model.ts";
import type { EntityChanges, LayerChanges, TextChange, ViewportChanges } from "./model.ts";
import { changedLine, changedParagraph, placedText } from "./text-change.ts";

/** A layer's name as the file's table spells it, or undefined when the file holds none of it. */
export function layerNamed(read: DrawingRead, name: string): ReadLayer | undefined {
  const key = layerKey(name);

  return read.layers.find((l) => layerKey(l.name) === key);
}

/** A linetype's name as the file spells it, `ByBlock` and `ByLayer` among them, or undefined. */
export function linetypeNamed(read: DrawingRead, name: string): string | undefined {
  if (/^bylayer$/i.test(name)) return "ByLayer";

  if (/^byblock$/i.test(name)) return "ByBlock";
  const key = layerKey(name);

  return read.linetypes.find((l) => layerKey(l.name) === key)?.name;
}

/** The color a true color stores beside it: the nearest index. */
const indexOf = (rgb: number): number =>
  matchedIndex([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255]);

/** The pen of an entity after a change of it, each part left out at ByLayer as the readers do. */
export function changedPen<E extends ReadEntityBase>(e: E, c: EntityChanges, read: DrawingRead): E {
  const { color, trueColor, colorBook, linetype, lineweight, linetypeScale, ...rest } = e;
  const recolored = c.color !== undefined || c.trueColor !== undefined;

  const type =
    c.linetype === undefined ? linetype : (linetypeNamed(read, c.linetype) ?? c.linetype);

  const w = c.lineweight;
  const weight = w === undefined ? lineweight : w === "ByBlock" ? -2 : w === "Default" ? -3 : w;
  const scale = c.linetypeScale ?? linetypeScale;

  // SAFETY: the copy holds every field of `e`, with only the pen's fields set or left out.
  return {
    ...rest,
    ...(c.layer !== undefined && { layer: layerNamed(read, c.layer)?.name ?? c.layer }),
    ...(recolored
      ? c.trueColor !== undefined
        ? { color: indexOf(c.trueColor), trueColor: c.trueColor }
        : c.color !== 256 && { color: c.color }
      : {
          ...(color !== undefined && { color }),
          ...(trueColor !== undefined && { trueColor }),
          ...(colorBook !== undefined && { colorBook }),
        }),
    ...(type !== undefined && type !== "ByLayer" && { linetype: type }),
    ...(weight !== undefined && weight !== "ByLayer" && { lineweight: weight }),
    ...(scale !== undefined && scale !== 1 && { linetypeScale: scale }),
  } as E;
}

/** What a change of a text's value gives, a single-line text's or a paragraph's. */
export const changedValue = (
  value: string,
  change: TextChange,
  paragraph: boolean,
): string | { problem: string } =>
  paragraph ? changedParagraph(value, change) : changedLine(value, change);

/** An attribute after a change of its value, placed again where its justification needs it. */
function changedAttribute(
  a: ReadAttribute,
  change: TextChange,
  read: DrawingRead,
): ReadAttribute | { problem: string } {
  const value = changedValue(a.value, change, a.paragraph !== undefined);

  if (!isString(value)) return value;

  if (a.paragraph !== undefined) return { ...a, value };
  const placed = placedText(a, value, a.height, read.textStyles);

  if (placed === undefined)
    return a.startFrom !== "file" && a.alignAt !== undefined
      ? { ...a, value, at: a.alignAt, startFrom: "alignment" }
      : { ...a, value };

  return { ...a, value, ...placedFields(a, placed) };
}

/** The fields a placement sets on a text, its start where the read worked one out. */
function placedFields(
  t: {
    readonly stored: readonly [number, number];
    readonly at: readonly [number, number];
    readonly startFrom: string;
  },
  placed: { stored: readonly [number, number]; height: number; widthFactor: number },
) {
  return {
    stored: placed.stored,
    at: placed.stored,
    startFrom: "file" as const,
    height: placed.height,
    ...(placed.widthFactor !== 1 && { widthFactor: placed.widthFactor }),
  };
}

/**
 * An entity after a change, or why the change cannot be made of it. A justified text's start is
 * worked out where the widths give it; elsewhere the read keeps the point the file holds, which the
 * DXF copy keeps and the DWG copy refuses.
 */
export function changedEntity(
  e: ReadEntity,
  c: EntityChanges,
  read: DrawingRead,
): ReadEntity | { problem: string } {
  let out: ReadEntity = changedPen(e, c, read);

  if (c.text !== undefined || c.height !== undefined) {
    if (out.kind === "text") {
      const value = c.text === undefined ? out.value : changedLine(out.value, c.text);

      if (!isString(value)) return value;
      const height = c.height ?? out.height;
      const placed = placedText(out, value, height, read.textStyles);

      // Where the widths do not give the start, the copy keeps the point the file holds. One
      // that holds its alignment point there is read from it, as the readers read such a text.
      if (placed === undefined && out.startFrom !== "file" && out.alignAt !== undefined) {
        const { widthFactor: _, ...rest } = out;
        out = {
          ...rest,
          ...(out.widthFactor !== undefined && { widthFactor: out.widthFactor }),
          value,
          height,
          at: out.alignAt,
          startFrom: "alignment",
        };
      } else if (placed === undefined) {
        const { widthFactor: _, ...rest } = out;
        out = {
          ...rest,
          ...(out.widthFactor !== undefined && { widthFactor: out.widthFactor }),
          value,
          height,
        };
      } else {
        const { widthFactor: _, ...rest } = out;
        out = { ...rest, value, ...placedFields(out, placed) };
      }
    } else if (out.kind === "mtext") {
      const value = c.text === undefined ? out.value : changedParagraph(out.value, c.text);

      if (!isString(value)) return value;
      out = { ...out, value, height: c.height ?? out.height };
    } else
      return {
        problem: `${c.text !== undefined ? "a text" : "a height"} is changed only of a text or paragraph text, and this is a ${e.kind}`,
      };
  }

  if (c.width !== undefined) {
    if (out.kind !== "mtext")
      return { problem: `a width is changed only of paragraph text, and this is a ${e.kind}` };
    out = { ...out, width: c.width };
  }

  if (c.boxHeight !== undefined) {
    // A multileader holds a note, a block or neither, and the read gives a note's text.
    if (out.kind !== "multileader" || out.block !== undefined || out.text === "")
      return {
        problem: `a note box is fitted only of a multileader with a note, and this is ${out.kind === "multileader" ? "one with none" : `a ${e.kind}`}`,
      };
    const { boxHeight: _, ...rest } = out;
    out = rest;
  }

  if (c.attributes !== undefined) {
    if (out.kind !== "insert")
      return { problem: `attributes are changed only of an insert, and this is a ${e.kind}` };
    const list = out.attributes ?? [];
    const attributes: ReadAttribute[] = [...list];

    for (const tag in c.attributes) {
      const at = list.findIndex((a) => a.tag.toUpperCase() === tag.toUpperCase());

      if (at < 0)
        return { problem: `the insert holds no attribute of the tag ${JSON.stringify(tag)}` };

      if (list.findIndex((a, k) => k > at && a.tag.toUpperCase() === tag.toUpperCase()) >= 0)
        return { problem: `the insert holds two attributes of the tag ${JSON.stringify(tag)}` };
      const a = changedAttribute(list[at]!, c.attributes[tag]!, read);

      if ("problem" in a) return { problem: `the attribute ${JSON.stringify(tag)}: ${a.problem}` };
      attributes[at] = a;
    }

    const tags = { ...out.tags };

    for (const a of attributes) tags[a.tag] = a.value !== "";
    out = { ...out, attributes, tags };
  }

  return out;
}

/** A layer after a change of its state. */
export function changedLayer(l: ReadLayer, c: LayerChanges, read: DrawingRead): ReadLayer {
  const { trueColor, ...rest } = l;
  const kept = c.color === undefined && c.trueColor === undefined ? trueColor : c.trueColor;

  return {
    ...rest,
    ...(c.on !== undefined && { on: c.on }),
    ...(c.frozen !== undefined && { frozen: c.frozen }),
    ...(c.locked !== undefined && { locked: c.locked }),
    ...(c.plot !== undefined && { plot: c.plot }),
    ...(c.color !== undefined && { color: c.color }),
    ...(c.trueColor !== undefined && { color: indexOf(c.trueColor) }),
    ...(kept !== undefined && { trueColor: kept }),
    ...(c.linetype !== undefined && { linetype: linetypeNamed(read, c.linetype) ?? c.linetype }),
    ...(c.lineweight !== undefined && {
      lineweight: c.lineweight === "Default" ? -3 : c.lineweight,
    }),
  };
}

/** A viewport after it is re-aimed, turned on or off, or given layers to freeze and thaw. */
export function changedViewport(
  v: ReadViewport,
  c: ViewportChanges,
  read: DrawingRead,
): ReadViewport {
  let out: ReadViewport = { ...v };

  if (c.center !== undefined) out = { ...out, viewCenter: [c.center[0], c.center[1]] };

  if (c.ratio !== undefined) out = { ...out, ratio: c.ratio, viewHeight: v.height / c.ratio };

  if (c.twist !== undefined) out = { ...out, twist: c.twist };

  if (c.on !== undefined) out = { ...out, on: c.on };

  if (c.freeze !== undefined || c.thaw !== undefined) {
    const thaw = new Set((c.thaw ?? []).map(layerKey));
    const frozen = v.frozenLayers.filter((n) => !thaw.has(layerKey(n)));
    const held = new Set(frozen.map(layerKey));

    for (const name of c.freeze ?? []) {
      const spelled = layerNamed(read, name)?.name ?? name;

      if (!held.has(layerKey(spelled))) {
        frozen.push(spelled);
        held.add(layerKey(spelled));
      }
    }

    out = { ...out, frozenLayers: frozen };
  }

  return out;
}
