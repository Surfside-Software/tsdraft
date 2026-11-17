// What differs between a read with geometry and the `Drawing` its file was written from: each
// entity of model space, of each layout and of each block, in order, with its pen, its points,
// its text and its justification. `tsdraft` holds a read of tsdraft's own DXF to the numbers as
// written. `autocad` holds a read of a DXF that AutoCAD wrote of the same drawing to the doubles
// AutoCAD holds, within the rounding of 6 decimals for what AutoCAD works out again, and each
// text to what AutoCAD's DXF reader makes of the text as AutoCAD wrote it.
import { placeAttribute } from "../src/blocks.ts";
import { dimensionAngle, dimensionMeasure, dimensionPicture } from "../src/dimensions.ts";
import type {
  AttributeDefinition,
  Block,
  Drawing,
  Entity,
  Point,
  TextStyle,
} from "../src/drawing.ts";
import { written, writtenAngle } from "../src/format.ts";
import { idHandle } from "../src/handles.ts";
import { findLeaderStyle, leaderPicture } from "../src/leaders.ts";
import { layerKey } from "../src/layers.ts";
import { entityLinetype, lineweightCode } from "../src/linetypes.ts";
import { textOnce, textTwice } from "../src/read/groups.ts";
import type {
  DrawingRead,
  ReadAttribute,
  ReadEntity,
  ReadTextPlacement,
} from "../src/read/model.ts";

export type ReadBy = "tsdraft" | "autocad";

/** A text as AutoCAD's DXF export writes what it holds: a caret as `^ `, a control character as `^` and a letter. */
function exported(text: string): string {
  let out = "";
  for (const c of text) {
    const code = c.charCodeAt(0);
    out += c === "^" ? "^ " : code < 0x20 ? `^${String.fromCharCode(code + 64)}` : c;
  }
  return out;
}

/**
 * The problems found, at most `most`. `own`, for a read by AutoCAD, is the read of tsdraft's own
 * DXF of the drawing: where it worked a text's start out from the widths, AutoCAD's start must
 * be within the widths' measure of it.
 */
export function readProblems(
  drawing: Drawing,
  read: DrawingRead,
  by: ReadBy,
  own?: DrawingRead,
  most = 20,
): string[] {
  const problems: string[] = [];
  const say = (problem: string): void => {
    if (problems.length < most) problems.push(problem);
  };
  // tsdraft's own file holds each number as written. AutoCAD's holds the double it read, and a
  // multileader and a dimension as AutoCAD works them out again, within the rounding of 6
  // decimals.
  const near = (a: number, b: number, loose = false): boolean =>
    by === "tsdraft" && !loose
      ? a === b
      : Math.abs(a - b) <= (loose ? 2e-6 : 0) + 1e-9 * Math.max(1, Math.abs(b));
  const nearPoint = (a: Point | undefined, b: Point, loose = false): boolean =>
    a !== undefined && near(a[0], b[0], loose) && near(a[1], b[1], loose);
  const nearAngle = (a: number, b: number): boolean => {
    const turned = (((a - b) % 360) + 360) % 360;
    return Math.min(turned, 360 - turned) <= (by === "tsdraft" ? 0 : 1e-9);
  };
  const point = (p: Point): Point => [written(p[0]), written(p[1])];
  const twice = (value: string): string => (by === "tsdraft" ? value : textTwice(exported(value)));
  const once = (value: string): string => (by === "tsdraft" ? value : textOnce(exported(value)));
  const sameName = (a: string | undefined, b: string): boolean =>
    a !== undefined && layerKey(a) === layerKey(b);

  const styles = new Map((drawing.textStyles ?? []).map((s) => [layerKey(s.name), s]));
  const styleOf = (name: string | undefined): TextStyle | undefined =>
    name === undefined ? undefined : styles.get(layerKey(name));
  const blocks = new Map((drawing.blocks ?? []).map((b) => [layerKey(b.name), b]));
  const dimensionStyles = new Map(
    (drawing.dimensionStyles ?? []).map((s) => [layerKey(s.name), s]),
  );

  /** A text's place: where its file puts it, and what it is justified to. */
  const placement = (
    got: ReadTextPlacement,
    want: {
      readonly at: Point;
      readonly height: number;
      readonly rotation: number;
      readonly style?: string | undefined;
      readonly align?: string | undefined;
      readonly valign?: string | undefined;
      readonly widthFactor: number;
      readonly obliqueAngle: number;
      readonly mirrored: boolean;
    },
    label: string,
  ): void => {
    const align = want.align ?? "left";
    const valign = want.valign ?? "baseline";
    const justified = align !== "left" || valign !== "baseline";
    if ((got.align ?? "left") !== align)
      say(`${label}: aligned ${got.align ?? "left"}, expected ${align}`);
    if ((got.valign ?? "baseline") !== valign) {
      say(`${label}: aligned ${got.valign ?? "baseline"} up and down, expected ${valign}`);
    }
    const at = justified ? got.alignAt : got.at;
    if (!nearPoint(at, want.at)) say(`${label}: placed at ${at}, expected ${want.at}`);
    if (!justified && got.startFrom !== "file") say(`${label}: starts from ${got.startFrom}`);
    if (justified && by === "tsdraft" && got.startFrom === "file") {
      say(`${label}: starts from the file, which holds its alignment point there`);
    }
    if (!near(got.height, want.height))
      say(`${label}: height ${got.height}, expected ${want.height}`);
    if (!nearAngle(got.rotation, want.rotation)) {
      say(`${label}: turned ${got.rotation}, expected ${want.rotation}`);
    }
    if (!sameName(got.style, want.style ?? "Standard")) {
      say(`${label}: style ${got.style}, expected ${want.style ?? "Standard"}`);
    }
    if (!near(got.widthFactor ?? 1, want.widthFactor)) {
      say(`${label}: width factor ${got.widthFactor ?? 1}, expected ${want.widthFactor}`);
    }
    if (!nearAngle(got.oblique ?? 0, want.obliqueAngle)) {
      say(`${label}: oblique ${got.oblique ?? 0}, expected ${want.obliqueAngle}`);
    }
    if ((got.backward ?? false) !== want.mirrored)
      say(`${label}: backward ${got.backward ?? false}`);
    if (got.upsideDown) say(`${label}: upside down`);
  };

  /** A text of tsdraft's own read, worked out from the widths, against AutoCAD's start. */
  const start = (got: ReadTextPlacement, mine: unknown, value: string, label: string): void => {
    const ownText = mine as ReadTextPlacement | undefined;
    if (by !== "autocad" || ownText?.startFrom !== "widths") return;
    // The widths are measured to 11 decimals: 1e-9 of the height for each character.
    const slack =
      1e-9 * got.height * Math.max(1, [...value].length) +
      1e-12 * Math.max(1, Math.abs(got.at[0]), Math.abs(got.at[1]));
    const [dx, dy] = [got.at[0] - ownText.at[0], got.at[1] - ownText.at[1]];
    if (Math.hypot(dx, dy) > slack) {
      say(`${label}: AutoCAD starts it at ${got.at}, and the widths at ${ownText.at}`);
    }
  };

  const attribute = (
    got: ReadAttribute | undefined,
    mine: ReadAttribute | undefined,
    definition: AttributeDefinition,
    insert: Extract<Entity, { kind: "insert" }>,
    block: Block,
    label: string,
  ): void => {
    if (!got) {
      say(`${label}: missing`);
      return;
    }
    const style = styleOf(definition.style);
    const placed = placeAttribute(definition, style, insert, block.base);
    if (got.tag !== twice(definition.tag)) say(`${label}: tag ${got.tag}`);
    if (got.value !== twice(placed.value)) say(`${label}: reads ${JSON.stringify(got.value)}`);
    if (!sameName(got.layer, definition.layer)) say(`${label}: on layer ${got.layer}`);
    // The file holds a mirrored insert's attribute seen from below, which mirrors X.
    const at: Point = placed.mirrored ? [-placed.at[0], placed.at[1]] : placed.at;
    placement(
      got,
      {
        ...definition,
        at: point(at),
        height: written(placed.height),
        rotation: written(placed.mirrored ? -placed.rotation : placed.rotation),
        widthFactor: written(placed.widthFactor),
        obliqueAngle: written(placed.obliqueAngle),
        mirrored: placed.mirrored,
      },
      label,
    );
    start(got, mine, got.value, label);
  };

  const entity = (
    got: ReadEntity | undefined,
    mine: ReadEntity | undefined,
    want: Entity,
    label: string,
  ): void => {
    if (!got) {
      say(`${label}: missing`);
      return;
    }
    if (!sameName(got.layer, want.layer))
      say(`${label}: on layer ${got.layer}, expected ${want.layer}`);
    if (want.id !== undefined && got.handle !== idHandle(want.id)) {
      say(`${label}: handle ${got.handle}, expected ${idHandle(want.id)}`);
    }
    if (got.color !== undefined || got.trueColor !== undefined)
      say(`${label}: has a color of its own`);
    if (
      want.kind !== "insert" &&
      want.kind !== "leader" &&
      want.kind !== "linear-dimension" &&
      want.kind !== "aligned-dimension"
    ) {
      const linetype = entityLinetype(want);
      if (linetype === undefined ? got.linetype !== undefined : !sameName(got.linetype, linetype)) {
        say(`${label}: linetype ${got.linetype}, expected ${linetype}`);
      }
      const weight = lineweightCode(want.lineweight ?? "ByLayer");
      if ((got.lineweight ?? -1) !== weight)
        say(`${label}: lineweight ${got.lineweight}, expected ${weight}`);
    }
    const kind = (k: ReadEntity["kind"]): boolean => {
      if (got.kind === k) return true;
      say(`${label}: read as ${got.kind}, expected ${k}`);
      return false;
    };
    switch (want.kind) {
      case "line":
        if (!kind("line") || got.kind !== "line") return;
        if (!nearPoint(got.from, point(want.from)) || !nearPoint(got.to, point(want.to))) {
          say(`${label}: from ${got.from} to ${got.to}`);
        }
        return;
      case "polyline":
        if (!kind("polyline") || got.kind !== "polyline") return;
        if (got.closed !== want.closed) say(`${label}: closed ${got.closed}`);
        if (
          got.points.length !== want.points.length ||
          got.points.some((p, i) => !nearPoint(p, point(want.points[i]!)))
        ) {
          say(`${label}: points ${JSON.stringify(got.points).slice(0, 200)}`);
        }
        return;
      case "circle":
        if (!kind("circle") || got.kind !== "circle") return;
        if (!nearPoint(got.center, point(want.center)) || !near(got.radius, written(want.radius))) {
          say(`${label}: center ${got.center}, radius ${got.radius}`);
        }
        return;
      case "arc":
        if (!kind("arc") || got.kind !== "arc") return;
        if (
          !nearPoint(got.center, point(want.center)) ||
          !near(got.radius, written(want.radius)) ||
          !nearAngle(got.start, writtenAngle(want.startAngle)) ||
          !nearAngle(got.end, writtenAngle(want.endAngle))
        ) {
          say(
            `${label}: center ${got.center}, radius ${got.radius}, from ${got.start} to ${got.end}`,
          );
        }
        return;
      case "text": {
        if (!kind("text") || got.kind !== "text") return;
        const style = styleOf(want.style);
        if (got.value !== twice(want.value)) say(`${label}: reads ${JSON.stringify(got.value)}`);
        placement(
          got,
          {
            ...want,
            at: point(want.at),
            height: written(want.height),
            rotation: written(want.rotation),
            style: style?.name ?? want.style,
            widthFactor: written(style?.widthFactor ?? 1),
            obliqueAngle: written(style?.obliqueAngle ?? 0),
            mirrored: false,
          },
          label,
        );
        start(got, mine, got.value, label);
        return;
      }
      case "insert": {
        if (!kind("insert") || got.kind !== "insert") return;
        const block = blocks.get(layerKey(want.block));
        if (!sameName(got.block, want.block)) say(`${label}: inserts ${got.block}`);
        const [sx, sy] = want.scale ?? [1, 1];
        if (
          !nearPoint(got.at, point(want.at)) ||
          !near(got.scale[0], written(sx)) ||
          !near(got.scale[1], written(sy)) ||
          !nearAngle(got.rotation, written(want.rotation ?? 0))
        ) {
          say(`${label}: at ${got.at}, scale ${got.scale}, turned ${got.rotation}`);
        }
        if (block && !got.blockHandle) say(`${label}: names no block record`);
        const definitions = block?.attributes ?? [];
        const attributes = got.attributes ?? [];
        if (attributes.length !== definitions.length) {
          say(`${label}: ${attributes.length} attributes, expected ${definitions.length}`);
        }
        const myAttributes = mine?.kind === "insert" ? mine.attributes : undefined;
        definitions.forEach((definition, i) =>
          attribute(
            attributes[i],
            myAttributes?.[i],
            definition,
            want,
            block!,
            `${label} attribute ${definition.tag}`,
          ),
        );
        return;
      }
      case "linear-dimension":
      case "aligned-dimension": {
        if (!kind("dimension") || got.kind !== "dimension") return;
        const style = dimensionStyles.get(layerKey(want.style));
        const type = want.kind === "linear-dimension" ? "linear" : "aligned";
        if (got.type !== type) say(`${label}: ${got.type}, expected ${type}`);
        if (!sameName(got.style, want.style)) say(`${label}: style ${got.style}`);
        if (!nearPoint(got.from, point(want.from)) || !nearPoint(got.to, point(want.to))) {
          say(`${label}: from ${got.from} to ${got.to}`);
        }
        const angle = want.kind === "linear-dimension" ? written(dimensionAngle(want)) : 0;
        if (!nearAngle(got.angle ?? 0, angle))
          say(`${label}: along ${got.angle}, expected ${angle}`);
        if ((got.text ?? undefined) !== (want.text === undefined ? undefined : once(want.text))) {
          say(`${label}: text ${JSON.stringify(got.text)}`);
        }
        if (!style) return;
        const picture = dimensionPicture(want, style);
        // AutoCAD works the point of the dimension line out again as it draws the picture, and
        // places the text by its letters, so a read by AutoCAD is held to where the line is.
        if (!nearPoint(got.line, picture.definitionPoint, true)) {
          say(
            `${label}: its line meets the second extension line at ${got.line}, expected ${picture.definitionPoint}`,
          );
        }
        if (by === "tsdraft" && !nearPoint(got.textAt, picture.textMiddle)) {
          say(`${label}: its text at ${got.textAt}, expected ${picture.textMiddle}`);
        }
        const measurement =
          dimensionMeasure(want).measurement * written(style.measurementScale ?? 1);
        if (
          got.measurement === undefined ||
          Math.abs(got.measurement - measurement) > 1e-9 * Math.max(1, Math.abs(measurement))
        ) {
          say(`${label}: measures ${got.measurement}, expected ${measurement}`);
        }
        if (by === "tsdraft" && !got.block?.startsWith("*D"))
          say(`${label}: drawn by ${got.block}`);
        if (got.block !== undefined && !got.blockHandle) say(`${label}: names no block record`);
        return;
      }
      case "leader": {
        if (!kind("multileader") || got.kind !== "multileader") return;
        const style = findLeaderStyle(drawing, want.style);
        if (!style) return;
        const named = want.textStyle ?? style.textStyle;
        const picture = leaderPicture(want, style, styleOf(named));
        if (!sameName(got.style, style.name)) say(`${label}: style ${got.style}`);
        if (!sameName(got.textStyle, styleOf(named)?.name ?? named ?? "Standard")) {
          say(`${label}: note in ${got.textStyle}`);
        }
        if (got.text !== once(want.text.join("\\P")))
          say(`${label}: note ${JSON.stringify(got.text)}`);
        const loose = by === "autocad";
        for (const [what, a, b] of [
          ["text height", got.textHeight, picture.sizes.textHeight],
          ["arrow size", got.arrowSize, picture.sizes.arrowSize],
          ["landing", got.landing, picture.sizes.landing],
          ["direction", got.direction[0], picture.direction],
        ] as const) {
          if (!near(a, b, loose)) say(`${label}: ${what} ${a}, expected ${b}`);
        }
        if (!nearPoint(got.at, picture.connection, loose)) say(`${label}: at ${got.at}`);
        if (!nearPoint(got.textAt, picture.location, loose)) say(`${label}: note at ${got.textAt}`);
        if (
          got.shafts.length !== want.shafts.length ||
          got.shafts.some(
            (shaft, s) =>
              shaft.length !== want.shafts[s]!.length ||
              shaft.some((p, k) => !nearPoint(p, point(want.shafts[s]![k]!), loose)),
          )
        ) {
          say(`${label}: shafts ${JSON.stringify(got.shafts).slice(0, 200)}`);
        }
        return;
      }
    }
  };

  const entities = (
    got: readonly ReadEntity[] | undefined,
    mine: readonly ReadEntity[] | undefined,
    other: Readonly<Record<string, number>> | undefined,
    want: readonly Entity[],
    where: string,
  ): void => {
    if (!got) {
      say(`${where}: no entities read`);
      return;
    }
    if (got.length !== want.length)
      say(`${where}: ${got.length} entities, expected ${want.length}`);
    if (Object.keys(other ?? {}).length > 0) say(`${where}: left out ${JSON.stringify(other)}`);
    want.forEach((e, i) => entity(got[i], mine?.[i], e, `${where} ${e.kind} #${i}`));
  };

  entities(
    read.model.entities,
    own?.model.entities,
    read.model.other,
    drawing.entities,
    "model space",
  );
  (drawing.layouts ?? []).forEach((layout, i) => {
    const got = read.layouts.find((l) => l.name === layout.name);
    if (!got) {
      say(`layout ${layout.name}: missing`);
      return;
    }
    const mine = own?.layouts.find((l) => l.name === layout.name);
    entities(
      got.entities,
      mine?.entities,
      got.other,
      layout.entities,
      `layout ${layout.name} #${i}`,
    );
  });
  for (const block of drawing.blocks ?? []) {
    const got = read.blocks.find((b) => sameName(b.name, block.name));
    if (!got) {
      say(`block ${block.name}: missing`);
      continue;
    }
    const mine = own?.blocks.find((b) => sameName(b.name, block.name));
    entities(got.entities, mine?.entities, got.other, block.entities, `block ${block.name}`);
    const definitions = block.attributes ?? [];
    if (got.attributeDefinitions.length !== definitions.length) {
      say(`block ${block.name}: ${got.attributeDefinitions.length} attribute definitions`);
    }
    definitions.forEach((definition, i) => {
      const read = got.attributeDefinitions[i];
      const label = `block ${block.name} attribute definition ${definition.tag}`;
      if (!read) return say(`${label}: missing`);
      const style = styleOf(definition.style);
      if (read.tag !== twice(definition.tag)) say(`${label}: tag ${read.tag}`);
      if (read.default !== twice(definition.value))
        say(`${label}: reads ${JSON.stringify(read.default)}`);
      if (read.prompt !== twice(definition.prompt ?? definition.tag))
        say(`${label}: asks ${read.prompt}`);
      if (!sameName(read.layer, definition.layer)) say(`${label}: on layer ${read.layer}`);
      placement(
        read,
        {
          ...definition,
          at: point(definition.at),
          height: written(definition.height),
          rotation: written(definition.rotation),
          widthFactor: written(style?.widthFactor ?? 1),
          obliqueAngle: written(style?.obliqueAngle ?? 0),
          mirrored: false,
        },
        label,
      );
      start(read, mine?.attributeDefinitions[i], read.default ?? "", label);
    });
  }
  if (Object.keys(read.unread.malformed).length > 0) {
    say(`malformed: ${JSON.stringify(read.unread.malformed)}`);
  }
  return problems;
}
