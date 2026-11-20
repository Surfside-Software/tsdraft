// What differs between a read with geometry and the `Drawing` its file was written from: each
// entity of model space, of each layout and of each block, in order, with its pen, its points,
// its text and its justification. `tsdraft` holds a read of tsdraft's own DXF to the numbers as
// written. The other reader's read is of a DXF that the leading CAD app wrote of the same drawing,
// held to the doubles that app holds, within the rounding of 6 decimals for what it works out
// again, and each text to what its DXF reader makes of the text it wrote.
import { placeAttribute } from "../src/blocks.ts";
import {
  dimensionAngle,
  arcLengthArc,
  dimensionMeasure,
  dimensionPicture,
  isDimension,
} from "../src/dimensions.ts";
import type {
  AttributeDefinition,
  Block,
  Drawing,
  Entity,
  ParagraphAttributeDefinition,
  Point,
  TextStyle,
} from "../src/drawing.ts";
import { written, writtenAngle } from "../src/format.ts";
import { idHandle } from "../src/handles.ts";
import { findLeaderStyle, leaderPicture } from "../src/leaders.ts";
import { fromImagePixels, imageClip, imageVectors, writtenImagePath } from "../src/images.ts";
import { layerKey } from "../src/layers.ts";
import { entityLinetype, lineweightCode } from "../src/linetypes.ts";
import { paragraphAttachment, paragraphDirection, paragraphTurn } from "../src/paragraphs.ts";
import { textOnce, textTwice } from "../src/read/groups.ts";
import type {
  DrawingRead,
  ReadAttribute,
  ReadAttributeParagraph,
  ReadEntity,
  ReadTextPlacement,
} from "../src/read/model.ts";

export type ReadBy = "tsdraft" | "cad";

/** A text as the leading CAD app's DXF export writes what it holds: a caret as `^ `, a control character as `^` and a letter. */
function exported(text: string): string {
  let out = "";
  for (const c of text) {
    const code = c.charCodeAt(0);
    out += c === "^" ? "^ " : code < 0x20 ? `^${String.fromCharCode(code + 64)}` : c;
  }
  return out;
}

/**
 * The problems found, at most `most`. `own`, for a read by the leading CAD app, is the read of
 * tsdraft's own DXF of the drawing: where it worked a text's start out from the widths, that app's
 * start must be within the widths' measure of it.
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
  // tsdraft's own file holds each number as written. The leading CAD app's holds the double it
  // read, and a multileader and a dimension as that app works them out again, within the rounding
  // of 6 decimals.
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
      /** True for the text of an attribute of paragraph text, whose file holds where it starts. */
      readonly paragraph?: boolean;
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
    if (justified && by === "tsdraft" && got.startFrom === "file" && !want.paragraph) {
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

  /** A text of tsdraft's own read, worked out from the widths, against the leading CAD app's start. */
  const start = (got: ReadTextPlacement, mine: unknown, value: string, label: string): void => {
    const ownText = mine as ReadTextPlacement | undefined;
    if (by !== "cad" || ownText?.startFrom !== "widths") return;
    // The widths are measured to 11 decimals: 1e-9 of the height for each character.
    const slack =
      1e-9 * got.height * Math.max(1, [...value].length) +
      1e-12 * Math.max(1, Math.abs(got.at[0]), Math.abs(got.at[1]));
    const [dx, dy] = [got.at[0] - ownText.at[0], got.at[1] - ownText.at[1]];
    if (Math.hypot(dx, dy) > slack) {
      say(`${label}: the leading CAD app starts it at ${got.at}, and the widths at ${ownText.at}`);
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
    const value = placed.paragraph?.value;
    if (value === undefined ? got.value !== twice(placed.value) : !paragraphValue(got.value, value))
      say(`${label}: reads ${JSON.stringify(got.value)}`);
    if (!sameName(got.layer, definition.layer)) say(`${label}: on layer ${got.layer}`);
    // The file holds a mirrored insert's attribute seen from below, which mirrors X.
    const at: Point = placed.mirrored ? [-placed.at[0], placed.at[1]] : placed.at;
    const uneven = placed.paragraph?.uneven ?? true;
    placement(
      got,
      {
        ...lineOf(definition),
        at: point(at),
        height: written(placed.height),
        rotation: written(placed.mirrored ? -placed.rotation : placed.rotation),
        widthFactor: uneven ? written(placed.widthFactor) : 1,
        obliqueAngle: uneven ? written(placed.obliqueAngle) : 0,
        mirrored: placed.mirrored,
        paragraph: placed.paragraph !== undefined,
      },
      label,
    );
    if (placed.paragraph) {
      const [cos, sin] = paragraphDirection(placed.rotation);
      paragraphOf(got.paragraph, definition as ParagraphAttributeDefinition, {
        at: point(at),
        height: written(placed.height),
        width: placed.paragraph.width ?? 0,
        turn: (Math.atan2(sin, placed.mirrored ? -cos : cos) * 180) / Math.PI,
        mirrored: placed.mirrored,
        label,
      });
      return;
    }
    start(got, mine, got.value, label);
  };

  /** A paragraph's value as a reader holds it: a DWG keeps a `\U+XXXX` as written. */
  const paragraphValue = (got: string, want: string): boolean => got === once(want) || got === want;

  /** A definition of paragraph text as the text of one line its file holds with it. */
  const lineOf = (definition: AttributeDefinition): AttributeDefinition =>
    definition.kind === "paragraph"
      ? {
          ...definition,
          kind: "text",
          align: definition.align ?? "left",
          valign: definition.valign ?? "top",
        }
      : definition;

  /** The paragraph of an attribute or a definition of paragraph text, against what it must be. */
  const paragraphOf = (
    got: ReadAttributeParagraph | undefined,
    definition: ParagraphAttributeDefinition,
    want: {
      readonly at: Point;
      readonly height: number;
      readonly width: number;
      readonly turn: number;
      readonly mirrored: boolean;
      readonly label: string;
    },
  ): void => {
    const { label } = want;
    if (!got) return say(`${label}: holds no paragraph`);
    if (!sameName(got.style, definition.style ?? "Standard")) say(`${label}: style ${got.style}`);
    if (!nearPoint(got.at, want.at)) say(`${label}: paragraph at ${got.at}, expected ${want.at}`);
    for (const [what, a, b] of [
      ["height", got.height, want.height],
      ["width", got.width, want.width],
      ["attachment", got.attachment, paragraphAttachment(definition)],
      ["line spacing", got.lineSpacing, written(definition.lineSpacing ?? 1)],
    ] as const) {
      if (!near(a, b)) say(`${label}: paragraph ${what} ${a}, expected ${b}`);
    }
    if (got.lineSpacingStyle !== (definition.lineSpacingStyle ?? "at-least")) {
      say(`${label}: line spacing ${got.lineSpacingStyle}`);
    }
    // Its direction is written with 15 digits, which give its turn back within their rounding.
    const turned = (((got.rotation - want.turn) % 360) + 360) % 360;
    if (Math.min(turned, 360 - turned) > 1e-9) say(`${label}: paragraph turned ${got.rotation}`);
    if ((got.mirrored ?? false) !== want.mirrored) say(`${label}: mirrored ${got.mirrored}`);
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
    if (want.kind !== "insert" && want.kind !== "leader" && !isDimension(want)) {
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
        {
          // Each side's bulge and widths as written, where a list left out is all 0.
          const sides = want.closed ? want.points.length : want.points.length - 1;
          for (let i = 0; i < sides; i++) {
            const bulge = [got.bulges?.[i] ?? 0, written(want.bulges?.[i] ?? 0)];
            const constant = [got.width ?? 0, written(want.width ?? 0)] as const;
            const read = got.widths?.[i] ?? [constant[0], constant[0]];
            const drawn = want.widths?.[i] ?? [constant[1], constant[1]];
            if (
              !near(bulge[0]!, bulge[1]!) ||
              !near(read[0], written(drawn[0])) ||
              !near(read[1], written(drawn[1]))
            ) {
              say(`${label}: side ${i} has bulge ${bulge[0]} and widths ${read.join(", ")}`);
              break;
            }
          }
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
      case "paragraph": {
        if (!kind("mtext") || got.kind !== "mtext") return;
        const style = styleOf(want.style);
        // A DWG keeps a `\U+XXXX` as written, where a DXF's reader decodes it.
        if (got.value !== once(want.value) && got.value !== want.value) {
          say(`${label}: reads ${JSON.stringify(got.value)}`);
        }
        if (!sameName(got.style, style?.name ?? want.style ?? "Standard")) {
          say(`${label}: style ${got.style}`);
        }
        if (!nearPoint(got.at, point(want.at))) say(`${label}: at ${got.at}`);
        for (const [what, a, b] of [
          ["height", got.height, written(want.height)],
          ["width", got.width, written(want.width ?? 0)],
          ["attachment", got.attachment, paragraphAttachment(want)],
          ["line spacing", got.lineSpacing, written(want.lineSpacing ?? 1)],
        ] as const) {
          if (!near(a, b)) say(`${label}: ${what} ${a}, expected ${b}`);
        }
        if (got.lineSpacingStyle !== (want.lineSpacingStyle ?? "at-least")) {
          say(`${label}: line spacing ${got.lineSpacingStyle}`);
        }
        // Its direction is written with 15 digits, which give its turn back within their rounding.
        const turned = (((got.rotation - paragraphTurn(want.rotation)) % 360) + 360) % 360;
        if (Math.min(turned, 360 - turned) > 1e-9) say(`${label}: turned ${got.rotation}`);
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
        const below = want.textBelow === undefined ? undefined : once(want.textBelow);
        if ((got.textBelow ?? undefined) !== below) {
          say(`${label}: text below ${JSON.stringify(got.textBelow)}`);
        }
        if (!style) return;
        const font = drawing.textStyles?.find((t) => sameName(t.name, style.textStyle ?? ""));
        const picture = dimensionPicture(want, style, font);
        // The leading CAD app works the point of the dimension line out again as it draws the
        // picture, and places the text by its letters, so a read by that
        // app is held to where the line is.
        if (!nearPoint(got.line, picture.definitionPoint, true)) {
          say(
            `${label}: its line meets the second extension line at ${got.line}, expected ${picture.definitionPoint}`,
          );
        }
        if (by === "tsdraft" && !nearPoint(got.textAt, point(picture.textPoint))) {
          say(`${label}: its text at ${got.textAt}, expected ${picture.textPoint}`);
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
      case "radius-dimension":
      case "diameter-dimension":
      case "jogged-radius-dimension": {
        if (!kind("radial-dimension") || got.kind !== "radial-dimension") return;
        const type =
          { "radius-dimension": "radius", "diameter-dimension": "diameter" }[
            want.kind as "radius-dimension"
          ] ?? "jogged-radius";
        if (got.type !== type) say(`${label}: ${got.type}, expected ${type}`);
        if (!sameName(got.style, want.style)) say(`${label}: style ${got.style}`);
        if (
          !nearPoint(got.center, point(want.center)) ||
          !nearPoint(got.point, point(want.point))
        ) {
          say(`${label}: center ${got.center}, point ${got.point}`);
        }
        if (
          want.kind === "jogged-radius-dimension" &&
          (!nearPoint(got.start ?? [NaN, NaN], point(want.start)) ||
            !nearPoint(got.jog ?? [NaN, NaN], point(want.jog)))
        )
          say(`${label}: starts at ${got.start}, jogs at ${got.jog}`);
        if ((got.text ?? undefined) !== (want.text === undefined ? undefined : once(want.text))) {
          say(`${label}: text ${JSON.stringify(got.text)}`);
        }
        const below = want.textBelow === undefined ? undefined : once(want.textBelow);
        if ((got.textBelow ?? undefined) !== below) {
          say(`${label}: text below ${JSON.stringify(got.textBelow)}`);
        }
        const style = dimensionStyles.get(layerKey(want.style));
        if (!style) return;
        const font = drawing.textStyles?.find((t) => sameName(t.name, style.textStyle ?? ""));
        const picture = dimensionPicture(want, style, font);
        if (by === "tsdraft" && !nearPoint(got.textAt, point(picture.textPoint))) {
          say(`${label}: its text at ${got.textAt}, expected ${picture.textPoint}`);
        }
        const measurement =
          dimensionMeasure(want).measurement * written(style.measurementScale ?? 1);
        if (
          got.measurement === undefined ||
          Math.abs(got.measurement - measurement) > 1e-9 * Math.max(1, Math.abs(measurement))
        ) {
          say(`${label}: measures ${got.measurement}, expected ${measurement}`);
        }
        return;
      }
      case "arc-length-dimension": {
        if (!kind("arc-length-dimension") || got.kind !== "arc-length-dimension") return;
        if (!sameName(got.style, want.style)) say(`${label}: style ${got.style}`);
        const arc = arcLengthArc(want);
        const turn = (a: number, b: number): number =>
          Math.abs(((((a - b) % 360) + 540) % 360) - 180);
        if (
          !nearPoint(got.center, arc.center) ||
          Math.abs(got.radius - arc.radius) > 1e-6 ||
          turn(got.startAngle, arc.start) > 1e-6 ||
          turn(got.endAngle, arc.start + arc.sweep) > 1e-6
        ) {
          say(
            `${label}: about ${got.center} of ${got.radius}, ${got.startAngle} to ${got.endAngle}`,
          );
        }
        if ((got.text ?? undefined) !== (want.text === undefined ? undefined : once(want.text))) {
          say(`${label}: text ${JSON.stringify(got.text)}`);
        }
        const style = dimensionStyles.get(layerKey(want.style));
        if (!style) return;
        const measurement =
          dimensionMeasure(want).measurement * written(style.measurementScale ?? 1);
        if (
          got.measurement === undefined ||
          Math.abs(got.measurement - measurement) > 1e-9 * Math.max(1, Math.abs(measurement))
        ) {
          say(`${label}: measures ${got.measurement}, expected ${measurement}`);
        }
        return;
      }
      case "angular-dimension": {
        if (!kind("angular-dimension") || got.kind !== "angular-dimension") return;
        if (got.type !== "three-point") say(`${label}: ${got.type}, expected three-point`);
        if (!sameName(got.style, want.style)) say(`${label}: style ${got.style}`);
        if (
          !nearPoint(got.vertex ?? [NaN, NaN], point(want.vertex)) ||
          !nearPoint(got.from ?? [NaN, NaN], point(want.from)) ||
          !nearPoint(got.to ?? [NaN, NaN], point(want.to))
        ) {
          say(`${label}: vertex ${got.vertex}, from ${got.from}, to ${got.to}`);
        }
        // The leading CAD app keeps a point of the arc of its own choosing.
        if (by === "tsdraft" && !nearPoint(got.at, point(want.at)))
          say(`${label}: arc at ${got.at}`);
        if ((got.text ?? undefined) !== (want.text === undefined ? undefined : once(want.text))) {
          say(`${label}: text ${JSON.stringify(got.text)}`);
        }
        const below = want.textBelow === undefined ? undefined : once(want.textBelow);
        if ((got.textBelow ?? undefined) !== below) {
          say(`${label}: text below ${JSON.stringify(got.textBelow)}`);
        }
        const style = dimensionStyles.get(layerKey(want.style));
        if (!style) return;
        const font = drawing.textStyles?.find((t) => sameName(t.name, style.textStyle ?? ""));
        const picture = dimensionPicture(want, style, font);
        if (by === "tsdraft" && !nearPoint(got.textAt, point(picture.textPoint))) {
          say(`${label}: its text at ${got.textAt}, expected ${picture.textPoint}`);
        }
        const degrees = (dimensionMeasure(want).measurement * 180) / Math.PI;
        if (got.measurement === undefined || Math.abs(got.measurement - degrees) > 1e-9 * degrees) {
          say(`${label}: measures ${got.measurement}, expected ${degrees}`);
        }
        return;
      }
      case "leader": {
        if (!kind("multileader") || got.kind !== "multileader") return;
        const style = findLeaderStyle(drawing, want.style);
        if (!style) return;
        const named = want.textStyle ?? style.textStyle;
        const picture = leaderPicture(want, style, styleOf(named), (name) =>
          blocks.get(layerKey(name)),
        );
        if (!sameName(got.style, style.name)) say(`${label}: style ${got.style}`);
        if (!sameName(got.textStyle, styleOf(named)?.name ?? named ?? "Standard")) {
          say(`${label}: note in ${got.textStyle}`);
        }
        // The note as written, with the code an underline of every line puts before it.
        if (got.text !== once(picture.note.value))
          say(`${label}: note ${JSON.stringify(got.text)}`);
        const loose = by === "cad";
        for (const [what, a, b] of [
          ["text height", got.textHeight, picture.sizes.textHeight],
          ["arrow size", got.arrowSize, picture.sizes.arrowSize],
          ["landing", got.landing, picture.sizes.landing],
          ["direction", got.direction[0], picture.direction],
        ] as const) {
          if (!near(a, b, loose)) say(`${label}: ${what} ${a}, expected ${b}`);
        }
        if (!nearPoint(got.at, picture.connection, loose)) say(`${label}: at ${got.at}`);
        // A block in place of the note is held at the block's point.
        const noteAt = picture.block === undefined ? picture.location : point(picture.block.at);
        if (!nearPoint(got.textAt, noteAt, loose)) say(`${label}: note at ${got.textAt}`);
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
      case "image": {
        if (!kind("image") || got.kind !== "image") return;
        if (got.path !== writtenImagePath(want.path))
          say(`${label}: path ${JSON.stringify(got.path)}`);
        if (got.pixels[0] !== want.pixels[0] || got.pixels[1] !== want.pixels[1]) {
          say(`${label}: pixels ${got.pixels.join(" by ")}`);
        }
        const [u, v] = imageVectors(want);
        if (!nearPoint(got.at, point(want.at)) || !nearPoint(got.u, u) || !nearPoint(got.v, v)) {
          say(`${label}: at ${got.at}, u ${got.u}, v ${got.v}`);
        }
        // The clip as both readers give it: in the world, a rectangle by its lower and upper
        // corners in the image's pixels, a polygon without its first point again.
        const clip = imageClip(want);
        const at = point(want.at);
        const world =
          want.clip === undefined
            ? undefined
            : (clip.type === 2 ? clip.points.slice(0, -1) : clip.points).map((p) =>
                fromImagePixels(at, u, v, want.pixels, p),
              );
        if (
          (world === undefined) !== (got.clip === undefined) ||
          (world !== undefined &&
            (world.length !== got.clip!.length ||
              world.some((p, k) => !nearPoint(got.clip![k]!, p))))
        ) {
          say(`${label}: clip ${JSON.stringify(got.clip)}`);
        }
        if ((got.invertClip ?? false) !== (want.invertClip ?? false)) say(`${label}: invertClip`);
        if ((got.transparent ?? false) !== (want.transparent ?? false))
          say(`${label}: transparent`);
        for (const flag of ["hidden", "unclipped"] as const) {
          if (got[flag]) say(`${label}: ${flag}`);
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
      const paragraph = definition.kind === "paragraph";
      if (
        paragraph
          ? !paragraphValue(read.default ?? "", definition.value)
          : read.default !== twice(definition.value)
      )
        say(`${label}: reads ${JSON.stringify(read.default)}`);
      if (read.prompt !== twice(definition.prompt ?? definition.tag))
        say(`${label}: asks ${read.prompt}`);
      if (!sameName(read.layer, definition.layer)) say(`${label}: on layer ${read.layer}`);
      placement(
        read,
        {
          ...lineOf(definition),
          at: point(definition.at),
          height: written(definition.height),
          rotation: written(definition.rotation),
          widthFactor: paragraph ? 1 : written(style?.widthFactor ?? 1),
          obliqueAngle: paragraph ? 0 : written(style?.obliqueAngle ?? 0),
          mirrored: false,
          paragraph,
        },
        label,
      );
      if (definition.kind === "paragraph") {
        paragraphOf(read.paragraph, definition, {
          at: point(definition.at),
          height: written(definition.height),
          width: written(definition.width ?? 0),
          turn: paragraphTurn(definition.rotation),
          mirrored: false,
          label,
        });
      } else start(read, mine?.attributeDefinitions[i], read.default ?? "", label);
    });
  }
  if (Object.keys(read.unread.malformed).length > 0) {
    say(`malformed: ${JSON.stringify(read.unread.malformed)}`);
  }
  return problems;
}
