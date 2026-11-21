// What a DXF record of an entity reads as: the kinds of `ReadEntity`, each in the world's
// coordinates with the pen it sets for itself.
import type { ParagraphColumns } from "../paragraphs.ts";
import type { Point } from "../drawing.ts";
import { textOnce, textTwice } from "./groups.ts";
import { wholeImageClip } from "../images.ts";
import type {
  ReadAttribute,
  ReadAttributeParagraph,
  ReadDimension,
  ReadRadialDimension,
  ReadAngularDimension,
  ReadArcLengthDimension,
  ReadOrdinateDimension,
  ReadEntity,
  ReadEntityBase,
  ReadGradient,
  ReadHatchLoop,
  ReadImage,
  ReadPatternLine,
  ReadMtext,
  ReadMultileader,
  ReadPolyline,
  ReadTextPlacement,
} from "./model.ts";
import { dimensionTextParts, gradientDegrees } from "./model.ts";
import {
  facing,
  first,
  inSubclass,
  map,
  name,
  num,
  placed,
  point,
  turned,
  type Facing,
  type Rec,
} from "./records.ts";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** What a record reads as: an entity, a kind left out and why, or a record that is broken. */
export type Reading =
  | { readonly entity: ReadEntity }
  | { readonly other: string }
  | { readonly malformed: string };

const HANDLE = /^[0-9A-Fa-f]{1,16}$/;

/** The handle a group holds: 1 to 16 hexadecimal digits, or undefined for anything else. */
export function handleAt(r: Rec, code: number): string | undefined {
  const value = first(r, code);
  return value !== undefined && HANDLE.test(value) ? value : undefined;
}

/** The most tags of one insert, and labels of one multileader's block, that are kept. */
export const MAX_TAGS = 1000;

/**
 * A color of a book as DXF group 430 holds it, the book's name and the color's with a `$` between
 * them, or undefined for none.
 */
export function colorBookOf(
  value: string | undefined,
): { readonly book: string; readonly name: string } | undefined {
  if (value === undefined || value === "") return undefined;
  const at = value.indexOf("$");
  return at < 0
    ? { book: "", name: value }
    : { book: value.slice(0, at), name: value.slice(at + 1) };
}

/** The pen an entity sets for itself, with each part left out at ByLayer. */
export function baseOf(r: Rec, layer: string, handle: string | undefined): ReadEntityBase {
  const color = num(r, 62);
  const trueColor = num(r, 420);
  const book = colorBookOf(name(r, 430));
  const linetype = name(r, 6);
  const lineweight = num(r, 370);
  const linetypeScale = num(r, 48);
  return {
    handle,
    layer,
    ...(color !== undefined && color !== 256 && { color }),
    ...(trueColor !== undefined && { trueColor }),
    ...(book !== undefined && { colorBook: book }),
    ...(linetype !== undefined && !/^bylayer$/i.test(linetype.trim()) && { linetype }),
    ...(lineweight !== undefined && lineweight !== -1 && { lineweight }),
    ...(linetypeScale !== undefined && linetypeScale !== 1 && { linetypeScale }),
  };
}

/**
 * The group codes of the doubles an entity holds: its points, sizes, angles and direction, and a
 * hatch's gradient.
 */
const isDouble = (code: number): boolean =>
  (code >= 10 && code <= 59) ||
  (code >= 110 && code <= 149) ||
  (code >= 210 && code <= 239) ||
  (code >= 460 && code <= 469);

/** True when a double of the record does not read as a finite number. */
export function brokenNumber(r: Rec): boolean {
  for (let i = 0; i < r.codes.length; i++) {
    if (!isDouble(r.codes[i]!)) continue;
    const value = r.values[i]!;
    if (value.trim() !== "" && !Number.isFinite(Number(value))) return true;
  }
  return false;
}

/** An angle in degrees, from 0 up to 360. */
const degrees = (n: number): number => ((n % 360) + 360) % 360;

const ALIGNS = ["left", "center", "right", "aligned", "middle", "fit"] as const;
const VALIGNS = ["baseline", "bottom", "middle", "top"] as const;

/** A justified text whose two points are one, as the file holds it, for its start to be worked out. */
export interface PendingStart {
  readonly placement: Mutable<ReadTextPlacement>;
  readonly value: string;
  /** The alignment point and the rotation in the entity's own coordinates. */
  readonly own: Point;
  readonly rotation: number;
  readonly face: Facing;
  /** Group 71: 2 for a text mirrored along its baseline, 4 across it. */
  readonly flags: number;
}

/**
 * Where a text, an attribute or an attribute definition is. A justified text whose file holds
 * its alignment point as its first point too gets `alignment` and a pending start, which the
 * reader works out once it knows the text's font.
 */
export function placementOf(
  r: Rec,
  face: Facing,
  value: string,
  valignCode: 73 | 74,
): { placement: Mutable<ReadTextPlacement>; pending?: PendingStart } {
  const align = ALIGNS[num(r, 72) ?? 0] ?? "left";
  // A text fitted or aligned between its points, or set on its middle, has no vertical one.
  const valign =
    align === "left" || align === "center" || align === "right"
      ? (VALIGNS[num(r, valignCode) ?? 0] ?? "baseline")
      : "baseline";
  const flags = num(r, 71) ?? 0;
  const own = point(r, 10);
  const ownAlign = first(r, 11) !== undefined ? point(r, 11) : own;
  const rotation = num(r, 50) ?? 0;
  const widthFactor = num(r, 41) ?? 1;
  const oblique = num(r, 51) ?? 0;
  const stored = placed(own, face);
  const justified = align !== "left" || valign !== "baseline";
  const placement: Mutable<ReadTextPlacement> = {
    at: stored,
    startFrom: "file",
    stored,
    ...(justified && { alignAt: placed(ownAlign, face) }),
    height: num(r, 40) ?? 0,
    // Seen from below, a text turns the other way and reads backward.
    rotation: face === -1 ? degrees(-rotation) : rotation,
    style: name(r, 7) ?? "Standard",
    ...(align !== "left" && { align }),
    ...(valign !== "baseline" && { valign }),
    ...(widthFactor !== 1 && { widthFactor }),
    ...(oblique !== 0 && { oblique }),
    ...(((flags & 2) !== 0) !== (face === -1) && { backward: true }),
    ...((flags & 4) !== 0 && { upsideDown: true }),
  };
  if (!justified || own[0] !== ownAlign[0] || own[1] !== ownAlign[1]) return { placement };
  placement.at = placement.alignAt!;
  placement.startFrom = "alignment";
  return { placement, pending: { placement, value, own: ownAlign, rotation, face, flags } };
}

/** The groups of an `MTEXT` before its embedded object, group 101, which repeats some of them. */
function ownGroups(r: Rec): Rec {
  const end = r.codes.indexOf(101);
  return end < 0
    ? r
    : { type: r.type, codes: r.codes.slice(0, end), values: r.values.slice(0, end) };
}

/** The names of the kinds of dimension `ReadDimension` does not hold, by group 70's low bits. */
const DIMENSION_KINDS = ["", "", "angular", "diameter", "radius", "angular 3-point", "ordinate"];

/** What a multileader names by handle, until the file is read. */
export interface LeaderNames {
  readonly style?: string | undefined;
  readonly textStyle?: string | undefined;
  /** The record of the block that is its content. */
  readonly block?: string | undefined;
}

/** What the reader finishes once the whole file is read. */
export interface Later {
  /** A justified text whose start is worked out from its font. */
  start(pending: PendingStart): void;
  /** A multileader whose styles, block and block's labels are named by handle. */
  leader(entity: ReadMultileader, names: LeaderNames): void;
}

/**
 * What a record of a kind with nothing after it reads as, or undefined for a kind it does not
 * read here. `face` is how its own coordinates lie in the world.
 */
export function readingOf(
  r: Rec,
  base: ReadEntityBase,
  face: Facing,
  later: Later,
  r12 = false,
): Reading | undefined {
  if (brokenNumber(r)) return { malformed: `${r.type} with a number that is not finite` };
  switch (r.type) {
    case "LINE":
      return { entity: { ...base, kind: "line", from: point(r, 10), to: point(r, 11) } };
    case "CIRCLE":
      if (face === 0) return { other: "CIRCLE in 3D" };
      return {
        entity: {
          ...base,
          kind: "circle",
          center: placed(point(r, 10), face),
          radius: num(r, 40) ?? 0,
        },
      };
    case "ARC":
      if (face === 0) return { other: "ARC in 3D" };
      // Seen from below, an arc runs the other way: its end is the world's start.
      return {
        entity: {
          ...base,
          kind: "arc",
          center: placed(point(r, 10), face),
          radius: num(r, 40) ?? 0,
          start: turned(num(r, face === -1 ? 51 : 50) ?? 0, face),
          end: turned(num(r, face === -1 ? 50 : 51) ?? 0, face),
        },
      };
    case "ELLIPSE":
      return ellipse(r, base, face);
    case "SPLINE":
      return spline(r, base, face);
    case "LWPOLYLINE":
      return lwpolyline(r, base, face);
    case "TEXT": {
      if (face === 0) return { other: "TEXT in 3D" };
      const value = textTwice(first(r, 1) ?? "");
      const { placement, pending } = placementOf(r, face, value, 73);
      const entity = { ...base, kind: "text" as const, ...placement, value };
      if (pending) later.start({ ...pending, placement: entity });
      return { entity };
    }
    case "MTEXT":
      return mtext(r, base);
    case "DIMENSION":
    case "LARGE_RADIAL_DIMENSION":
      return dimension(r, base, face, r12);
    case "ARC_DIMENSION":
      return arcLengthDimension(r, base, face);
    case "MULTILEADER":
      return multileader(r, base, later);
    case "LEADER":
      return leader(r, base, face);
    case "IMAGE":
      return image(r, base);
    case "HATCH":
      return hatch(r, base, face);
    case "WIPEOUT":
      return wipeout(r, base);
    case "SOLID": {
      if (face === 0) return { other: "SOLID in 3D" };
      const corner = (code: number): Point =>
        placed(first(r, code) === undefined ? point(r, 12) : point(r, code), face);
      return { entity: { ...base, kind: "solid", points: [10, 11, 13, 12].map(corner) } };
    }
    default:
      return undefined;
  }
}

/**
 * An image as its file places it. Its clip is held in the image's pixels, as the file holds it,
 * a polygon without its first point again at its end, and its path is the definition's, which
 * the reader fills in once it has read the definitions: `imageInWorld` finishes it.
 */
function image(r: Rec, base: ReadEntityBase): Reading {
  const s = inSubclass(r, "AcDbRasterImage");
  // An image whose vectors leave the plane is one the read model does not hold.
  if ([31, 32, 30].some((code) => Math.abs(num(s, code) ?? 0) > 1e-9)) {
    return { other: "IMAGE in 3D" };
  }
  const flags = num(s, 70) ?? 0;
  const points: Point[] = [];
  for (let i = 0; i < s.codes.length; i++) {
    if (s.codes[i] !== 14) continue;
    const y = s.codes[i + 1] === 24 ? Number(s.values[i + 1]) : 0;
    points.push([Number(s.values[i]), y]);
  }
  const [head] = points;
  const tail = points.at(-1);
  if (
    (num(s, 71) ?? 1) !== 1 &&
    points.length > 1 &&
    head![0] === tail![0] &&
    head![1] === tail![1]
  ) {
    points.pop();
  }
  const definition = handleAt(s, 340);
  const brightness = num(s, 281) ?? 50;
  const contrast = num(s, 282) ?? 50;
  const fade = num(s, 283) ?? 0;
  return {
    entity: {
      ...base,
      kind: "image",
      path: "",
      ...(definition !== undefined && { definition }),
      pixels: [num(s, 13) ?? 0, num(s, 23) ?? 0],
      at: point(s, 10),
      u: point(s, 11),
      v: point(s, 12),
      // Flag 4 clips the image to its boundary whatever 280 says, as the leading CAD app draws
      // it, and the whole image's boundary is no clip, unless it is inverted: a hole of it all.
      ...(points.length > 0 &&
        ((num(s, 280) ?? 0) !== 0 ||
          (num(s, 290) ?? 0) !== 0 ||
          !wholeImageClip(num(s, 71) ?? 1, points, [num(s, 13) ?? 0, num(s, 23) ?? 0])) && {
          clip: points,
        }),
      ...((num(s, 290) ?? 0) !== 0 && { invertClip: true }),
      ...((flags & 8) !== 0 && { transparent: true }),
      ...((flags & 1) === 0 && { hidden: true }),
      ...((flags & 4) === 0 && { unclipped: true }),
      ...(brightness !== 50 && { brightness }),
      ...(contrast !== 50 && { contrast }),
      ...(fade !== 0 && { fade }),
    },
  };
}

/** What a hatch's island style 75 reads as. */
const HATCH_STYLES = ["normal", "outer", "ignore"] as const;

/** The bulge of an arc that turns through `sweep` degrees, counterclockwise when above 0. */
const bulgeOf = (sweep: number): number => Math.tan((sweep * Math.PI) / 720);

/**
 * A hatch: its pattern, its style and its loops, each a polyline, or a loop of lines and arcs
 * read as one, as points and the bulge of each side. One with an ellipse or a spline in a loop,
 * which `ReadHatchLoop` does not hold, is counted.
 */
function hatch(r: Rec, base: ReadEntityBase, face: Facing): Reading {
  if (face === 0) return { other: "HATCH in 3D" };
  const s = inSubclass(r, "AcDbHatch");
  const { codes, values } = s;
  let i = codes.indexOf(91);
  if (i < 0) return { malformed: "HATCH with no count of loops" };
  // A group whose value is not a finite number makes the hatch malformed, once all is read.
  let broken = false;
  const value = (k: number) => {
    const text = values[k]!;
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) broken = true;
    return n;
  };
  // The next group of a code from `i` on, read by the order of the loop's groups.
  const take = (code: number): number | undefined => {
    if (codes[i] !== code) return undefined;
    return value(i++);
  };
  const count = value(i++);
  const loops: ReadHatchLoop[] = [];
  const mirror = (p: Point): Point => placed(p, face);
  for (let loop = 0; loop < count && i < codes.length; loop++) {
    const flags = take(92);
    if (flags === undefined) return { malformed: "HATCH whose loops do not follow its count" };
    const points: Point[] = [];
    const bulges: number[] = [];
    if ((flags & 2) !== 0) {
      const bulged = take(72) === 1;
      take(73);
      const n = take(93) ?? 0;
      for (let k = 0; k < n && codes[i] === 10; k++) {
        const x = value(i++);
        const y = take(20) ?? 0;
        points.push(mirror([x, y]));
        const bulge = bulged ? (take(42) ?? 0) : 0;
        bulges.push(face === -1 ? -bulge : bulge);
      }
    } else {
      const n = take(93) ?? 0;
      for (let k = 0; k < n && codes[i] === 72; k++) {
        const type = take(72);
        if (type === 1) {
          const [x0, y0] = [take(10) ?? 0, take(20) ?? 0];
          take(11);
          take(21);
          points.push(mirror([x0, y0]));
          bulges.push(0);
        } else if (type === 2) {
          const [cx, cy] = [take(10) ?? 0, take(20) ?? 0];
          const radius = take(40) ?? 0;
          const [start, end] = [take(50) ?? 0, take(51) ?? 0];
          const ccw = take(73) !== 0;
          // A clockwise arc holds its angles as they turn clockwise: the world's are less 360.
          const [a0, a1] = ccw ? [start, end] : [360 - start, 360 - end];
          let sweep = ccw ? a1 - a0 : -(a0 - a1);
          if (ccw && sweep <= 0) sweep += 360;
          if (!ccw && sweep >= 0) sweep -= 360;
          const at = (angle: number): Point =>
            mirror([
              cx + radius * Math.cos((angle * Math.PI) / 180),
              cy + radius * Math.sin((angle * Math.PI) / 180),
            ]);
          const sign = face === -1 ? -1 : 1;
          // A whole circle is two halves, since one side cannot end where it starts.
          if (Math.abs(sweep) >= 360 - 1e-9) {
            points.push(at(a0), at(a0 + sweep / 2));
            bulges.push(sign * bulgeOf(sweep / 2), sign * bulgeOf(sweep / 2));
          } else {
            points.push(at(a0));
            bulges.push(sign * bulgeOf(sweep));
          }
        } else if (type === 3 || type === 4) {
          return { other: "HATCH bounded by an ellipse or a spline" };
        } else return { malformed: "HATCH with an edge of no known kind" };
      }
    }
    // The handles of the entities it bounds, which the read model does not hold.
    const objects = take(97) ?? 0;
    for (let k = 0; k < objects && codes[i] === 330; k++) i++;
    loops.push({
      points,
      ...(bulges.some((b) => b !== 0) && { bulges: bulges.map((b) => b + 0) }),
      flags,
    });
  }
  const style = HATCH_STYLES[num(s, 75) ?? 0] ?? "normal";
  const solid = num(s, 70) === 1;
  // What a pattern holds after its loops: its kind, angle, scale, crossing and lines.
  let pattern: Partial<Record<"patternType" | "patternAngle" | "patternScale", number>> & {
    crossed?: true;
    patternLines?: ReadPatternLine[];
  } = {};
  if (!solid) {
    while (i < codes.length && codes[i] !== 76) i++;
    const type = take(76);
    const angle = take(52);
    const scale = take(41);
    const crossed = take(77) === 1;
    const count = take(78) ?? 0;
    const lines: ReadPatternLine[] = [];
    for (let k = 0; k < count && codes[i] === 53; k++) {
      const angleOf = take(53) ?? 0;
      const placedBase = mirror([take(43) ?? 0, take(44) ?? 0]);
      const offset = mirror([take(45) ?? 0, take(46) ?? 0]);
      const dashCount = take(79) ?? 0;
      const dashes: number[] = [];
      for (let d = 0; d < dashCount && codes[i] === 49; d++) dashes.push(take(49) ?? 0);
      if (dashes.length !== dashCount || codes[i] === 49)
        return { malformed: "HATCH whose pattern lines do not follow their counts" };
      lines.push({
        // Seen from below, a line's direction is mirrored too.
        angle: face === -1 ? 180 - angleOf : angleOf,
        base: placedBase,
        offset,
        ...(dashes.length > 0 && { dashes }),
      });
    }
    if (lines.length !== count || codes[i] === 53)
      return { malformed: "HATCH whose pattern lines do not follow their counts" };
    pattern = {
      ...(type !== undefined && { patternType: type }),
      ...(angle !== undefined && { patternAngle: angle }),
      ...(scale !== undefined && { patternScale: scale }),
      ...(crossed && { crossed: true as const }),
      patternLines: lines,
    };
  }
  if (broken) return { malformed: "HATCH with a number that is not finite" };
  const gradient = hatchGradient(codes, values, i, face);
  // A finite angle in radians can be past the doubles in degrees, and a tint in single
  // precision, as readDWG counts them too.
  if (gradient && !(Number.isFinite(gradient.angle) && Number.isFinite(gradient.tint ?? 0)))
    return { malformed: "HATCH with a number past the doubles" };
  return {
    entity: {
      ...base,
      kind: "hatch",
      pattern: name(s, 2) ?? "",
      solid,
      style,
      ...(num(s, 71) === 1 && { associative: true as const }),
      loops,
      ...pattern,
      ...(gradient && { gradient }),
    },
  };
}

/**
 * A hatch's gradient, from its group 450 on, after its loops: undefined where 450 is missing or 0.
 * Seen from below, its angle is mirrored as a pattern line's is.
 */
function hatchGradient(
  codes: readonly number[],
  values: readonly string[],
  from: number,
  face: Facing,
): ReadGradient | undefined {
  const at = codes.indexOf(450, from);
  if (at < 0 || !(Number(values[at]) !== 0)) return undefined;
  let [label, radians, shift, single, tint] = ["", 0, 0, 0, 0];
  const colors: number[] = [];
  for (let k = at + 1; k < codes.length; k++) {
    const value = values[k]!;
    switch (codes[k]) {
      case 460:
        radians = Number(value) || 0;
        break;
      case 461:
        shift = Number(value) || 0;
        break;
      case 452:
        single = Number(value) || 0;
        break;
      case 462:
        tint = Number(value) || 0;
        break;
      case 421:
        if (colors.length < 2) colors.push((Number(value) || 0) & 0xffffff);
        break;
      case 470:
        label = value;
        break;
    }
  }
  const angle = gradientDegrees(radians);
  return {
    name: label,
    angle: face === -1 ? 180 - angle : angle,
    centered: shift === 0,
    colors,
    ...(single === 1 && { tint: Math.fround(tint) }),
  };
}

/**
 * An ellipse: its center and axis are in the world's coordinates whatever its extrusion, and seen
 * from below its parameters run clockwise, so its arc from s to e is the arc from -e to -s of the
 * ellipse seen from above. One whose ratio is outside (0, 1] or whose axis has no length is broken.
 */
function ellipse(r: Rec, base: ReadEntityBase, face: Facing): Reading {
  if (face === 0) return { other: "ELLIPSE in 3D" };
  const s = inSubclass(r, "AcDbEllipse");
  if (Math.abs(num(s, 30) ?? 0) > 1e-9 || Math.abs(num(s, 31) ?? 0) > 1e-9)
    return { other: "ELLIPSE in 3D" };
  const majorAxis = point(s, 11);
  const ratio = num(s, 40) ?? 1;
  if (!(ratio > 0 && ratio <= 1) || (majorAxis[0] === 0 && majorAxis[1] === 0))
    return { malformed: "ELLIPSE with a ratio outside 0 to 1 or an axis of no length" };
  const [s0, e0] = [num(s, 41) ?? 0, num(s, 42) ?? 2 * Math.PI];
  const whole = Math.abs(e0 - s0) >= 2 * Math.PI - 1e-9 || s0 === e0;
  const inDegrees = (t: number) => degrees((t * 180) / Math.PI);
  const [start, end] = face === -1 ? [-e0, -s0] : [s0, e0];
  return {
    entity: {
      ...base,
      kind: "ellipse",
      center: point(s, 10),
      majorAxis,
      ratio,
      ...(whole ? {} : { startParameter: inDegrees(start), endParameter: inDegrees(end) }),
    },
  };
}

/** The highest degree of a spline read. */
const SPLINE_DEGREE_READ = 11;

/**
 * A spline as the file holds it, in the world's coordinates whatever its extrusion. One whose
 * counts disagree with its groups, whose degree is out of range, or whose knots do not fit its
 * control points is broken; one with a point off the plane is counted.
 */
function spline(r: Rec, base: ReadEntityBase, face: Facing): Reading {
  if (face === 0) return { other: "SPLINE in 3D" };
  const s = inSubclass(r, "AcDbSpline");
  const flags = num(s, 70) ?? 0;
  const degree = num(s, 71) ?? 3;
  const knots: number[] = [];
  const weights: number[] = [];
  const controlPoints: Point[] = [];
  const fitPoints: Point[] = [];
  let flat = true;
  for (let i = 0; i < s.codes.length; i++) {
    const code = s.codes[i]!;
    const value = Number(s.values[i]);
    if (code === 40) knots.push(value);
    // Weights count only for a spline marked rational, as the leading CAD app reads them.
    else if (code === 41 && (flags & 4) !== 0) weights.push(value);
    else if (code === 10 || code === 11) {
      const y = s.codes[i + 1] === code + 10 ? Number(s.values[i + 1]) : 0;
      const z = s.codes[i + 2] === code + 20 ? Number(s.values[i + 2]) : 0;
      if (Math.abs(z) > 1e-9) flat = false;
      (code === 10 ? controlPoints : fitPoints).push([value, y]);
    }
  }
  if (!flat) return { other: "SPLINE in 3D" };
  const counted = (code: number, list: readonly unknown[]) => (num(s, code) ?? 0) === list.length;
  const broken =
    !Number.isInteger(degree) ||
    degree < 1 ||
    degree > SPLINE_DEGREE_READ ||
    !counted(72, knots) ||
    !counted(73, controlPoints) ||
    !counted(74, fitPoints) ||
    (weights.length > 0 && weights.length !== controlPoints.length) ||
    (controlPoints.length > 0 && knots.length !== controlPoints.length + degree + 1) ||
    (controlPoints.length === 0 && fitPoints.length < 2);
  if (broken) return { malformed: "SPLINE whose counts disagree with its groups or its degree" };
  // A fit closed by its first point again at its end gives that point once.
  const [head, tail] = [fitPoints[0], fitPoints.at(-1)];
  const repeated =
    (flags & 1) !== 0 && fitPoints.length > 2 && head![0] === tail![0] && head![1] === tail![1];
  const tangent = (code: number) =>
    first(s, code) === undefined
      ? {}
      : { [code === 12 ? "startTangent" : "endTangent"]: point(s, code) };
  const spacing =
    (flags & 1024) === 0
      ? undefined
      : (flags & 64) !== 0
        ? "square-root"
        : (flags & 128) !== 0
          ? "uniform"
          : (flags & 32) !== 0
            ? "chord"
            : undefined;
  const tolerance = num(s, 44);
  return {
    entity: {
      ...base,
      kind: "spline",
      degree,
      knots,
      controlPoints,
      ...(weights.length > 0 && { weights }),
      closed: (flags & 1) !== 0,
      ...((flags & 2) !== 0 && { periodic: true as const }),
      ...(fitPoints.length > 0 && { fitPoints: repeated ? fitPoints.slice(0, -1) : fitPoints }),
      ...tangent(12),
      ...tangent(13),
      ...(fitPoints.length > 0 && tolerance !== undefined && { fitTolerance: tolerance }),
      ...(spacing !== undefined && { knotSpacing: spacing }),
    },
  };
}

/**
 * A wipeout: its clip, which the file holds in the axes of its picture of one pixel, in the
 * world's coordinates, a polygon without its first point again at its end, or a rectangle's four
 * corners. One whose vectors leave the plane is counted.
 */
function wipeout(r: Rec, base: ReadEntityBase): Reading {
  const s = inSubclass(r, "AcDbWipeout");
  if ([31, 32, 30].some((code) => Math.abs(num(s, code) ?? 0) > 1e-9)) {
    return { other: "WIPEOUT in 3D" };
  }
  const held: Point[] = [];
  for (let i = 0; i < s.codes.length; i++) {
    if (s.codes[i] !== 14) continue;
    const y = s.codes[i + 1] === 24 ? Number(s.values[i + 1]) : 0;
    held.push([Number(s.values[i]), y]);
  }
  const [at, u, v] = [point(s, 10), point(s, 11), point(s, 12)];
  const rectangle = (num(s, 71) ?? 2) === 1;
  let corners = held;
  if (rectangle && held.length === 2) {
    const [[x0, y0], [x1, y1]] = held as [Point, Point];
    corners = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
  } else if (held.length > 1) {
    const [head, tail] = [held[0]!, held.at(-1)!];
    if (head[0] === tail[0] && head[1] === tail[1]) corners = held.slice(0, -1);
  }
  const points = corners.map(([x, y]): Point => {
    const [a, b] = [x + 0.5, 0.5 - y];
    return [at[0] + a * u[0] + b * v[0], at[1] + a * u[1] + b * v[1]];
  });
  return { entity: { ...base, kind: "wipeout", points } };
}

/**
 * Finishes an image the reader kept: its definition's path, and its clip from its pixels into
 * the world's coordinates.
 */
export function imageInWorld(image: ReadImage, path: string | undefined): void {
  const mutable = image as Mutable<ReadImage>;
  mutable.path = path ?? "";
  if (image.clip === undefined) return;
  const { at, u, v } = image;
  const height = image.pixels[1];
  mutable.clip = image.clip.map(([x, y]) => {
    const [s, t] = [x + 0.5, height - y - 0.5];
    return [at[0] + s * u[0] + t * v[0], at[1] + s * u[1] + t * v[1]];
  });
}

function lwpolyline(r: Rec, base: ReadEntityBase, face: Facing): Reading {
  if (face === 0) return { other: "LWPOLYLINE in 3D" };
  const points: Point[] = [];
  // The bulge and the two widths each point gives the side from it to the next, from its group
  // 10 up to the next point's, in whatever order they come.
  const bulges: number[] = [];
  const widths: [number, number][] = [];
  let vertex: { x: number; y?: number; bulge: number; widths: [number, number] } | undefined;
  const close = (): void => {
    if (vertex?.y === undefined) return;
    points.push(placed([vertex.x, vertex.y], face));
    bulges.push(vertex.bulge);
    widths.push(vertex.widths);
  };
  for (let i = 0; i < r.codes.length; i++) {
    const code = r.codes[i];
    const value = Number(r.values[i]);
    if (code === 10) {
      close();
      vertex = { x: value, bulge: 0, widths: [0, 0] };
    } else if (vertex === undefined) continue;
    else if (code === 20 && vertex.y === undefined) vertex.y = value;
    else if (code === 42) vertex.bulge = value;
    else if (code === 40 || code === 41) vertex.widths[code - 40] = value;
  }
  close();
  const flags = num(r, 70) ?? 0;
  const closed = (flags & 1) !== 0;
  return {
    entity: {
      ...base,
      kind: "polyline",
      points,
      closed,
      ...sidesOf(points.length, closed, bulges, widths, num(r, 43) ?? 0, face),
      ...((flags & 128) !== 0 && { linetypeGeneration: true as const }),
    },
  };
}

/**
 * The bulges and the widths of a polyline's sides, from what each of its points gives the side
 * from it to the next, as `ReadPolyline` holds them: each left out when every one is 0, and the
 * constant width only where no point gives a width of its own. A bulge seen from below turns the
 * other way.
 */
export function sidesOf(
  count: number,
  closed: boolean,
  bulges: readonly number[],
  widths: readonly (readonly [number, number])[],
  constant: number,
  face: Facing,
): Pick<ReadPolyline, "bulges" | "width" | "widths"> {
  const sides = closed ? count : Math.max(0, count - 1);
  const bent = bulges.slice(0, sides).map((bulge) => (face === -1 ? -bulge : bulge));
  const own = widths.slice(0, sides);
  const wide = own.some(([start, end]) => start !== 0 || end !== 0);
  return {
    ...(bent.some((bulge) => bulge !== 0) ? { bulges: bent.map((bulge) => bulge + 0) } : {}),
    ...(wide ? { widths: own.map(([start, end]) => [start, end] as const) } : {}),
    ...(!wide && constant !== 0 ? { width: constant } : {}),
  };
}

function mtext(record: Rec, base: ReadEntityBase): Reading {
  const face = facing(record);
  if (face !== 1) return { other: face === -1 ? "MTEXT seen from below" : "MTEXT in 3D" };
  const r = ownGroups(record);
  let value = "";
  for (let i = 0; i < r.codes.length; i++) {
    if (r.codes[i] === 3 || r.codes[i] === 1) value += r.values[i];
  }
  const dx = num(r, 11);
  const dy = num(r, 21);
  // Its direction, groups 11 and 21, or else its rotation, group 50, which the leading CAD app
  // reads as degrees, though the DXF Reference gives radians.
  const rotation =
    dx !== undefined && dy !== undefined && (dx !== 0 || dy !== 0)
      ? degrees((Math.atan2(dy, dx) * 180) / Math.PI)
      : degrees(num(r, 50) ?? 0);
  const flags = num(r, 90) ?? 0;
  const color = num(r, 63);
  const trueColor = num(r, 421);
  // Bit 1 turns the mask on, and bit 2 fills it with the drawing's background.
  const mask =
    (flags & 1) === 0
      ? undefined
      : {
          // A true color stands for the color, whose index is only the nearest one.
          ...((flags & 2) === 0 && trueColor === undefined && color !== undefined && { color }),
          ...((flags & 2) === 0 && trueColor !== undefined && { trueColor }),
          offsetFactor: num(r, 45) ?? 1.5,
        };
  const entity: ReadMtext = {
    ...base,
    kind: "mtext",
    at: point(r, 10),
    height: num(r, 40) ?? 0,
    width: num(r, 41) ?? 0,
    attachment: num(r, 71) ?? 1,
    rotation,
    style: name(r, 7) ?? "Standard",
    value: textOnce(value),
    lineSpacing: num(r, 44) ?? 1,
    lineSpacingStyle: num(r, 73) === 2 ? "exactly" : "at-least",
    ...(mask !== undefined && { mask }),
  };
  // The embedded object's direction wins over the MTEXT's own, as the leading CAD app reads it.
  const embedded = embeddedDirection(record);
  const turned = embedded === undefined ? entity : { ...entity, rotation: embedded };
  const held = columnsOf(record);
  if (held) return { entity: { ...turned, width: held.width, columns: held.columns } };
  return { entity: turned };
}

/** The direction in an `MTEXT`'s embedded object, in degrees, or undefined where it has none. */
function embeddedDirection(record: Rec): number | undefined {
  const from = record.codes.indexOf(101);
  if (from < 0) return undefined;
  const after: Rec = {
    type: record.type,
    codes: record.codes.slice(from + 1),
    values: record.values.slice(from + 1),
  };
  const dx = num(after, 10);
  const dy = num(after, 20);
  if (dx === undefined || dy === undefined || (dx === 0 && dy === 0)) return undefined;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return undefined;
  return degrees((Math.atan2(dy, dx) * 180) / Math.PI);
}

/**
 * An `MTEXT`'s columns, from its embedded object, with the width of each, or undefined when it
 * has none: static ones, type 1, by their count; dynamic ones, type 2, by their height, or one
 * by one by the heights after group 74 up to the first of 0, which takes the rest.
 */
function columnsOf(record: Rec): { width: number; columns: ParagraphColumns } | undefined {
  const from = record.codes.indexOf(101);
  if (from < 0) return undefined;
  const after: Rec = {
    type: record.type,
    codes: record.codes.slice(from + 1),
    values: record.values.slice(from + 1),
  };
  const type = num(after, 71);
  const width = num(after, 44);
  const height = num(after, 41);
  const gutter = num(after, 45) ?? 0;
  const good = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n);
  if ((type !== 1 && type !== 2) || !good(width) || width <= 0 || !good(height) || gutter < 0) {
    return undefined;
  }
  if (type === 1) {
    const count = num(after, 72);
    if (!good(count) || count < 1) return undefined;
    return { width, columns: { count: Math.floor(count), height, gutter } };
  }
  if (num(after, 73) !== 0) return { width, columns: { height, gutter } };
  const heights: number[] = [];
  for (let i = 0; i < after.codes.length; i++) {
    if (after.codes[i] !== 46) continue;
    const tall = Number(after.values[i]);
    if (!(tall > 0)) break;
    heights.push(tall);
  }
  return heights.length > 0 ? { width, columns: { heights, gutter } } : undefined;
}

function dimension(r: Rec, base: ReadEntityBase, face: Facing, r12: boolean): Reading {
  if (face !== 1) return { other: face === -1 ? "DIMENSION seen from below" : "DIMENSION in 3D" };
  // The kind is group 70's low four bits, 9 for a jogged radius: 32, 64 and 128 are flags.
  const kind = (num(r, 70) ?? 0) & 15;
  if (kind === 3 || kind === 4 || kind === 9) return radialDimension(r, base, kind, r12);
  if (kind === 2 || kind === 5) return angularDimension(r, base, kind, r12);
  if (kind === 6) return ordinateDimension(r, base, r12);
  if (kind > 1) return { other: `DIMENSION ${DIMENSION_KINDS[kind] ?? "of another kind"}` };
  const angle = kind === 0 ? (num(r, 50) ?? 0) : 0;
  // The leading CAD app leaves the measurement out when it is 1. An R12 file holds none.
  const measurement = num(r, 42) ?? (r12 ? undefined : 1);
  const text = first(r, 1);
  const block = name(r, 2);
  const parts = text === undefined ? {} : dimensionTextParts(textOnce(text));
  const entity: ReadDimension = {
    ...base,
    kind: "dimension",
    type: kind === 0 ? "linear" : "aligned",
    from: point(r, 13),
    to: point(r, 14),
    line: point(r, 10),
    ...(angle !== 0 && { angle }),
    textAt: point(r, 11),
    ...(measurement !== undefined && { measurement }),
    ...parts,
    style: name(r, 3) ?? "Standard",
    ...(block !== undefined && block !== "" && { block }),
  };
  return { entity };
}

/** The color index of a mask's color from the 32 bits a file holds: ByBlock 0, an index, else 256. */
export function maskColor(raw: number): number {
  const method = raw >>> 24;
  return method === 0xc1 ? 0 : method === 0xc3 ? raw & 0xff : 256;
}

/**
 * A radius (group 70's kind 4), a diameter (3) or a jogged radius (9) dimension. A diameter holds
 * the far end of its line in group 10 and its center halfway to group 15.
 */
function radialDimension(r: Rec, base: ReadEntityBase, kind: number, r12: boolean): Reading {
  const measurement = num(r, 42) ?? (r12 ? undefined : 1);
  const text = first(r, 1);
  const block = name(r, 2);
  const parts = text === undefined ? {} : dimensionTextParts(textOnce(text));
  const onCircle = point(r, 15);
  const definition = point(r, 10);
  const center: Point =
    kind === 3
      ? [(definition[0] + onCircle[0]) / 2, (definition[1] + onCircle[1]) / 2]
      : definition;
  const entity: ReadRadialDimension = {
    ...base,
    kind: "radial-dimension",
    type: kind === 4 ? "radius" : kind === 3 ? "diameter" : "jogged-radius",
    center,
    point: onCircle,
    ...(kind === 9 && { start: point(r, 13), jog: point(r, 14) }),
    textAt: point(r, 11),
    ...(((num(r, 70) ?? 0) & 128) !== 0 && { placed: true }),
    ...(measurement !== undefined && { measurement }),
    ...parts,
    style: name(r, 3) ?? "Standard",
    ...(block !== undefined && block !== "" && { block }),
  };
  return { entity };
}

/**
 * An ordinate dimension (group 70's kind 6): its origin (10), its feature (13) and its leader's
 * end (14), giving X where group 70 holds 64 and Y where not. One drawn in a turned coordinate
 * system, whose axes group 51 turns, is left out.
 */
function ordinateDimension(r: Rec, base: ReadEntityBase, r12: boolean): Reading {
  const turned = num(r, 51) ?? 0;
  if (turned !== 0) return { other: "DIMENSION ordinate in a turned coordinate system" };
  const measurement = num(r, 42) ?? (r12 ? undefined : 1);
  const text = first(r, 1);
  const block = name(r, 2);
  const parts = text === undefined ? {} : dimensionTextParts(textOnce(text));
  const flags = num(r, 70) ?? 0;
  const entity: ReadOrdinateDimension = {
    ...base,
    kind: "ordinate-dimension",
    axis: (flags & 64) !== 0 ? "x" : "y",
    origin: point(r, 10),
    feature: point(r, 13),
    leaderEnd: point(r, 14),
    textAt: point(r, 11),
    ...((flags & 128) !== 0 && { placed: true }),
    ...(measurement !== undefined && { measurement }),
    ...parts,
    style: name(r, 3) ?? "Standard",
    ...(block !== undefined && block !== "" && { block }),
  };
  return { entity };
}

/**
 * An arc length dimension: its center (group 15), the radius to the arc's first end (13), the arc's
 * angles (40 and 41, after the common group 70, in radians), a point of its own arc (10), and
 * whether it measures part of the arc (the second group 70).
 */
function arcLengthDimension(r: Rec, base: ReadEntityBase, face: Facing): Reading {
  if (face !== 1)
    return { other: face === -1 ? "ARC_DIMENSION seen from below" : "ARC_DIMENSION in 3D" };
  const center = point(r, 15);
  const end = point(r, 13);
  // The arc's own groups follow its subclass marker: the common part holds a 41 and a 70 too.
  const marker = r.codes.findIndex((code, i) => code === 100 && r.values[i] === "AcDbArcDimension");
  const after = (code: number): string | undefined => {
    const at = marker < 0 ? -1 : r.codes.indexOf(code, marker);
    return at < 0 ? undefined : r.values[at];
  };
  const partial = after(70);
  const degrees = (code: number): number => {
    const value = Number(after(code) ?? 0) * (180 / Math.PI);
    return Number.isFinite(value) ? value : 0;
  };
  const text = first(r, 1);
  const block = name(r, 2);
  const parts = text === undefined ? {} : dimensionTextParts(textOnce(text));
  const entity: ReadArcLengthDimension = {
    ...base,
    kind: "arc-length-dimension",
    center,
    radius: Math.hypot(end[0] - center[0], end[1] - center[1]),
    startAngle: degrees(40),
    endAngle: degrees(41),
    at: point(r, 10),
    textAt: point(r, 11),
    ...(((num(r, 70) ?? 0) & 128) !== 0 && { placed: true }),
    ...(partial !== undefined && Number(partial) !== 0 && { partial: true }),
    measurement: num(r, 42) ?? 1,
    ...parts,
    style: name(r, 3) ?? "Standard",
    ...(block !== undefined && block !== "" && { block }),
  };
  return { entity };
}

/**
 * An angular dimension by two lines (group 70's kind 2), 13 to 14 and 15 to 10, its arc through
 * 16, or by three points (5), its vertex 15, its lines through 13 and 14, its arc through 10.
 */
function angularDimension(r: Rec, base: ReadEntityBase, kind: number, r12: boolean): Reading {
  const radians = num(r, 42) ?? (r12 ? undefined : 1);
  // An angle of radians too large for degrees is left out, as no angle.
  const degrees =
    radians === undefined ? undefined : radians === -1 ? -1 : radians * (180 / Math.PI);
  const measurement = degrees !== undefined && Number.isFinite(degrees) ? degrees : undefined;
  const text = first(r, 1);
  const block = name(r, 2);
  const parts = text === undefined ? {} : dimensionTextParts(textOnce(text));
  const entity: ReadAngularDimension = {
    ...base,
    kind: "angular-dimension",
    ...(kind === 5
      ? { type: "three-point", vertex: point(r, 15), from: point(r, 13), to: point(r, 14) }
      : {
          type: "two-line",
          first: [point(r, 13), point(r, 14)],
          second: [point(r, 15), point(r, 10)],
        }),
    at: point(r, kind === 5 ? 10 : 16),
    textAt: point(r, 11),
    ...(((num(r, 70) ?? 0) & 128) !== 0 && { placed: true }),
    ...(measurement !== undefined && { measurement }),
    ...parts,
    style: name(r, 3) ?? "Standard",
    ...(block !== undefined && block !== "" && { block }),
  };
  return { entity };
}

/**
 * A `MULTILEADER`, from the context data that says how it is drawn: every root with its shafts, a
 * note or a block, and the multileader's own groups after the context. One whose note or block
 * leaves the plane is left out.
 */
function multileader(r: Rec, base: ReadEntityBase, later: Later): Reading {
  const c = r.codes;
  const v = r.values;
  let where: "before" | "context" | "leader" | "line" | "after" = "before";
  const roots: { shafts: Point[][]; groups: Record<number, string> }[] = [];
  let shaft: Point[] = [];
  // The first value of each group of the context and of what follows it, which hold each once,
  // but for the block's labels after the context: groups 330 and 302 of each.
  const context: Record<number, string> = {};
  const after: Record<number, string> = {};
  const labels: { definition: string | undefined; text: string }[] = [];
  for (let i = 0; i < c.length; i++) {
    const code = c[i]!;
    const value = v[i]!;
    // The groups that open and close a part, as the leading CAD app writes them, may carry spaces.
    const mark = code >= 300 && code <= 305 ? value.trim() : value;
    if (where === "before") {
      if (code === 300 && mark === "CONTEXT_DATA{") where = "context";
    } else if (where === "context" && code === 301 && mark === "}") where = "after";
    else if (where === "context" && code === 302 && mark === "LEADER{") {
      where = "leader";
      roots.push({ shafts: [], groups: {} });
    } else if (where === "leader" && code === 304 && mark === "LEADER_LINE{") {
      where = "line";
      shaft = [];
    } else if (where === "line" && code === 305) {
      where = "leader";
      roots.at(-1)!.shafts.push(shaft);
    } else if (where === "leader" && code === 303) where = "context";
    else if (where === "line") {
      if (code === 10 && c[i + 1] === 20) shaft.push([Number(value), Number(v[i + 1])]);
    } else if (where === "after" && code === 330) {
      const handle = value.trim();
      // A label of the null handle fills no definition.
      const known = HANDLE.test(handle) && !/^0+$/.test(handle);
      labels.push({ definition: known ? handle.toUpperCase() : undefined, text: "" });
    } else if (where === "after" && code === 302 && labels.length > 0) labels.at(-1)!.text = value;
    else {
      const groups =
        where === "leader" ? roots.at(-1)!.groups : where === "context" ? context : after;
      if (!(code in groups)) groups[code] = value;
    }
  }
  const number = (groups: Record<number, string>, code: number, otherwise: number): number => {
    const value = Number(groups[code]);
    return groups[code] !== undefined && Number.isFinite(value) ? value : otherwise;
  };
  const pair = (groups: Record<number, string>, x: number): Point | undefined =>
    groups[x] === undefined ? undefined : [number(groups, x, 0), number(groups, x + 10, 0)];
  const up = (x: number): boolean =>
    Math.abs(number(context, x, 0)) <= 1e-9 &&
    Math.abs(number(context, x + 10, 0)) <= 1e-9 &&
    number(context, x + 20, 1) > 0;
  // Group 290 of the context says it holds a note, and 296 a block; group 172 after it says the
  // same, 2 a note and 1 a block, for a file that leaves the context's out.
  const content = number(after, 172, 2);
  const hasText = number(context, 290, content === 2 ? 1 : 0) === 1;
  const hasBlock = !hasText && number(context, 296, content === 1 ? 1 : 0) === 1;
  // The normal of the note is groups 11, 21 and 31 of the context, and of the block 14, 24 and 34.
  if ((hasText && !up(11)) || (hasBlock && !up(14))) return { other: "MULTILEADER in 3D" };
  // A block's labels are keyed by the handle of the definition each fills until the file is read.
  let attributes: Record<string, string> | undefined;
  let kept = 0;
  for (const { definition, text } of hasBlock ? labels : []) {
    attributes ??= map<string>();
    if (definition === undefined || definition in attributes) continue;
    if (kept++ >= MAX_TAGS) break;
    attributes[definition] = textTwice(text);
  }
  const block = hasBlock
    ? {
        name: "",
        at: pair(context, 15) ?? [0, 0],
        scale: number(context, 16, 1),
        rotation: (number(context, 46, 0) * 180) / Math.PI,
        ...(attributes && { attributes }),
      }
    : undefined;
  const textAt = (hasText && pair(context, 12)) || block?.at || pair(context, 10) || [0, 0];
  const read = roots.map((root) => ({
    at: pair(root.groups, 10) ?? [0, 0],
    direction: pair(root.groups, 11) ?? ([1, 0] as Point),
    landing: number(root.groups, 40, 0),
    shafts: root.shafts,
  }));
  const [first] = read;
  const masked = hasText && number(context, 292, 0) === 1;
  const entity: ReadMultileader = {
    ...base,
    kind: "multileader",
    shafts: first?.shafts ?? [],
    at: first?.at ?? textAt,
    direction: first?.direction ?? [1, 0],
    landing: first?.landing ?? 0,
    roots: read,
    // Group 170 after the context: 0 no shafts, 1 straight, 2 curved.
    shaft: (["none", "straight", "curved"] as const)[number(after, 170, 1)] ?? "straight",
    text: hasText ? textOnce(context[304] ?? "") : "",
    textAt,
    textAttachment: hasText ? number(context, 171, 1) : 1,
    width: hasText ? number(context, 43, 0) : 0,
    textHeight: number(context, 41, 0),
    textStyle: "Standard",
    arrowSize: number(context, 140, 0),
    attachments: {
      left: number(context, 174, 1),
      right: number(context, 175, 1),
      top: number(context, 273, 9),
      bottom: number(context, 272, 9),
    },
    ...(number(after, 271, 0) === 1 && { vertical: true }),
    ...(number(after, 292, 0) === 1 && { frame: true }),
    // Group 292 of the context masks the note, with the drawing's background where 291 says so
    // and else with the color of group 91.
    ...(masked && {
      mask: {
        offsetFactor: number(context, 141, 1.5),
        ...(number(context, 291, 0) !== 1 && {
          color: maskColor(number(context, 91, 0xc0000000)),
        }),
      },
    }),
    ...(block && { block }),
  };
  later.leader(entity, {
    style: after[340],
    // A note names its text style in the context, and the multileader its own after it.
    textStyle: hasText ? context[340] : after[343],
    ...(hasBlock && { block: context[341] ?? after[344] }),
  });
  return { entity };
}

/**
 * The old `LEADER`: its points as the file holds them, in the world's coordinates, and the handle
 * of its note. The leading CAD app leaves group 71 out where it draws an arrowhead, and group 73
 * out where it has no note.
 */
function leader(r: Rec, base: ReadEntityBase, face: Facing): Reading {
  if (face === 0) return { other: "LEADER in 3D" };
  const points: Point[] = [];
  for (let i = 0; i < r.codes.length; i++) {
    if (r.codes[i] !== 10) continue;
    points.push([Number(r.values[i]), r.codes[i + 1] === 20 ? Number(r.values[i + 1]) : 0]);
  }
  const note = (num(r, 73) ?? 3) === 3 ? undefined : handleAt(r, 340);
  return {
    entity: {
      ...base,
      kind: "leader",
      style: name(r, 3) ?? "Standard",
      points,
      shaft: num(r, 72) === 1 ? "curved" : "straight",
      arrowhead: num(r, 71) !== 0,
      ...(note !== undefined && { note }),
    },
  };
}

/** An attribute of an insert from its `ATTRIB` record. */
export function attributeOf(
  r: Rec,
  base: ReadEntityBase,
  later: Later,
): ReadAttribute | { malformed: string } | { other: string } {
  if (brokenNumber(r)) return { malformed: "ATTRIB with a number that is not finite" };
  const face = facing(r);
  if (face === 0) return { other: "ATTRIB in 3D" };
  const { text, paragraph } = attributeParts(r);
  if (paragraph === null) return { other: "ATTRIB of paragraph text in 3D" };
  const value = paragraph ? paragraph.value : textTwice(first(text, 1) ?? "");
  const { placement, pending } = placementOf(text, face, value, 74);
  const attribute = {
    ...base,
    ...placement,
    tag: textTwice(first(text, 2) ?? ""),
    value,
    // Its own flag, group 70, or the entity's, group 60, as a dynamic block's state hides it.
    ...((((num(text, 70) ?? 0) & 1) !== 0 || num(text, 60) === 1) && { invisible: true }),
    ...(paragraph && { paragraph: paragraph.paragraph }),
  };
  if (pending && !paragraph) later.start({ ...pending, placement: attribute });
  return attribute;
}

/**
 * The parts of an `ATTRIB` or an `ATTDEF`: its text's groups, without the paragraph's flags its
 * subclass holds, and for one of paragraph text the paragraph after group 101, its embedded
 * object, with its value. Its paragraph is null where it lies off the plane.
 */
export function attributeParts(r: Rec): {
  readonly text: Rec;
  readonly paragraph:
    | { readonly paragraph: ReadAttributeParagraph; readonly value: string }
    | undefined
    | null;
} {
  const from = r.codes.indexOf(101);
  if (from < 0) return { text: r, paragraph: undefined };
  // Groups 71 and 72 after the subclass of the attribute say it is of paragraph text.
  const subclass = r.codes.findIndex(
    (code, i) =>
      code === 100 &&
      (r.values[i] === "AcDbAttribute" || r.values[i] === "AcDbAttributeDefinition"),
  );
  const codes: number[] = [];
  const values: string[] = [];
  for (let i = 0; i < from; i++) {
    if (subclass >= 0 && i > subclass && (r.codes[i] === 71 || r.codes[i] === 72)) continue;
    codes.push(r.codes[i]!);
    values.push(r.values[i]!);
  }
  const text: Rec = { type: r.type, codes, values };
  const after: Rec = {
    type: r.type,
    codes: r.codes.slice(from + 1),
    values: r.values.slice(from + 1),
  };
  const z = num(after, 230) ?? 1;
  if (Math.abs(num(after, 210) ?? 0) > 1e-9 || Math.abs(num(after, 220) ?? 0) > 1e-9) {
    return { text, paragraph: null };
  }
  let value = "";
  for (let i = 0; i < after.codes.length; i++) {
    if (after.codes[i] === 3 || after.codes[i] === 1) value += after.values[i];
  }
  const dx = num(after, 11);
  const dy = num(after, 21);
  const rotation =
    dx !== undefined && dy !== undefined && (dx !== 0 || dy !== 0)
      ? degrees((Math.atan2(dy, dx) * 180) / Math.PI)
      : 0;
  return {
    text,
    paragraph: {
      value: textOnce(value),
      paragraph: {
        at: point(after, 10),
        height: num(after, 40) ?? 0,
        width: num(after, 41) ?? 0,
        attachment: num(after, 71) ?? 1,
        rotation,
        style: name(after, 7) ?? "Standard",
        lineSpacing: num(after, 44) ?? 1,
        lineSpacingStyle: num(after, 73) === 2 ? "exactly" : "at-least",
        ...(z < 0 && { mirrored: true }),
      },
    },
  };
}

/** The characters a string costs against a budget: one item for each 32. */
export const nameCost = (value: string | undefined): number =>
  value === undefined ? 0 : Math.floor(value.length / 32);
const chars = nameCost;

/** What a text's place costs: one for each point it holds. */
const placementCost = (p: ReadTextPlacement): number =>
  2 + (p.alignAt === undefined ? 0 : 1) + chars(p.style);

/** What an attribute costs against a budget. */
export const attributeCost = (a: ReadAttribute): number =>
  1 +
  placementCost(a) +
  chars(a.tag) +
  chars(a.value) +
  chars(a.layer) +
  chars(a.linetype) +
  (a.colorBook ? chars(a.colorBook.book) + chars(a.colorBook.name) : 0) +
  (a.paragraph ? 2 + chars(a.paragraph.style) : 0);

/**
 * What an entity costs against `BLOCK_ITEMS` or `GEOMETRY_ITEMS`: one, and one more for each of
 * its points, bulges and pairs of widths, each attribute or tag, and each 32 characters of its
 * names and its text.
 */
export function costOf(e: ReadEntity): number {
  const own =
    1 +
    chars(e.layer) +
    chars(e.linetype) +
    (e.colorBook ? chars(e.colorBook.book) + chars(e.colorBook.name) : 0);
  switch (e.kind) {
    case "line":
      return own + 2;
    case "circle":
    case "arc":
    case "ellipse":
      return own + 1;
    case "spline":
      return (
        own +
        e.knots.length +
        e.controlPoints.length +
        (e.weights?.length ?? 0) +
        (e.fitPoints?.length ?? 0)
      );
    case "polyline":
      return own + e.points.length + (e.bulges?.length ?? 0) + (e.widths?.length ?? 0);
    case "solid":
      return own + e.points.length;
    case "text":
      return own + placementCost(e) + chars(e.value);
    case "mtext":
      return own + 1 + chars(e.value) + chars(e.style) + (e.columns?.heights?.length ?? 0);
    case "dimension":
      return own + 4 + chars(e.text) + chars(e.textBelow) + chars(e.style) + chars(e.block);
    case "radial-dimension":
      return own + 5 + chars(e.text) + chars(e.textBelow) + chars(e.style) + chars(e.block);
    case "angular-dimension":
    case "arc-length-dimension":
    case "ordinate-dimension":
      return own + 6 + chars(e.text) + chars(e.textBelow) + chars(e.style) + chars(e.block);
    case "multileader": {
      let points = 3;
      for (const root of e.roots) {
        points += 3;
        for (const shaft of root.shafts) points += 1 + shaft.length;
      }
      let labels = 0;
      const attributes = e.block?.attributes ?? {};
      for (const tag in attributes) labels += 1 + chars(tag) + chars(attributes[tag]);
      return (
        own +
        points +
        labels +
        chars(e.text) +
        chars(e.textStyle) +
        chars(e.style) +
        chars(e.block?.name)
      );
    }
    case "leader":
      return own + e.points.length + chars(e.style) + chars(e.note);
    case "insert": {
      let more = 2 + chars(e.block);
      for (const tag in e.tags) more += 1 + chars(tag);
      for (const a of e.attributes ?? []) more += attributeCost(a);
      return own + more;
    }
    case "image":
      return own + 4 + (e.clip?.length ?? 0) + chars(e.definition);
    case "hatch": {
      let points = 0;
      for (const loop of e.loops) points += 1 + loop.points.length + (loop.bulges?.length ?? 0);
      for (const line of e.patternLines ?? []) points += 3 + (line.dashes?.length ?? 0);
      if (e.gradient) points += 4 + e.gradient.colors.length + chars(e.gradient.name);
      return own + points + chars(e.pattern);
    }
    case "wipeout":
      return own + e.points.length;
    case "table":
      return (
        own +
        chars(e.style) +
        chars(e.block) +
        e.rows.length +
        e.columns.length +
        e.cells.reduce((sum, cell) => sum + 1 + chars(cell.text) + chars(cell.block), 0)
      );
  }
}
