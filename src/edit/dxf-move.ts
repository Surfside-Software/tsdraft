// A move, a turn and a scale of one DXF record: the values of the groups that hold its points,
// angles and sizes written again, by a table of what each group holds in each kind, and every
// other byte copied. Points held in the entity's own coordinates go through its extrusion,
// which must be +Z or -Z.
import type { Point } from "../drawing.ts";
import { degrees360 } from "./moved.ts";
import { numberAs, shortest, type HeldGroup, type Splice } from "./dxf-groups.ts";
import { knotScale, type Applied } from "./transform.ts";

/**
 * What a group holds: a point in the world's coordinates or the entity's own (its X, with Y and Z
 * at 10 and 20 past it), a vector turned and scaled, a direction turned, an angle in degrees or
 * radians, an angle in degrees clockwise, a size, or a point whose X and Y stay and whose Z is scaled, as a 2D polyline's.
 */
type Role =
  | "pw"
  | "po"
  | "vw"
  | "vo"
  | "dw"
  | "dx"
  | "do"
  | "deg"
  | "cw"
  | "rad"
  | "size"
  | "z"
  | "s3";

type Roles = Readonly<Record<number, Role>>;

const TEXT = { 10: "po", 11: "po", 40: "size", 50: "deg", 39: "size" } satisfies Roles;

const MTEXT = {
  10: "pw",
  11: "dw",
  40: "size",
  41: "size",
  42: "size",
  43: "size",
  46: "size",
  48: "size",
  49: "size",
  50: "deg",
} satisfies Roles;

/** The paragraph an attribute embeds, whose direction of 0, 0 runs along X. */
const EMBEDDED = { 10: "pw", 11: "dx", 40: "size", 41: "size", 46: "size" } satisfies Roles;

/** The roles of each kind's groups, by its subclass marker where codes mean other things in each. */
const KINDS: ReadonlyMap<string, Readonly<Record<string, Roles>>> = new Map(
  Object.entries({
    LINE: { "": { 10: "pw", 11: "pw", 39: "size" } },
    POINT: { "": { 10: "pw", 39: "size", 50: "deg" } },
    CIRCLE: { "": { 10: "po", 40: "size", 39: "size" } },
    ARC: { "": { 10: "po", 40: "size", 39: "size", 50: "deg", 51: "deg" } },
    ELLIPSE: { "": { 10: "pw", 11: "vw" } },
    SPLINE: { "": { 10: "pw", 11: "pw", 12: "dw", 13: "dw" } },
    LWPOLYLINE: { "": { 10: "po", 38: "size", 39: "size", 40: "size", 41: "size", 43: "size" } },
    POLYLINE: { "": { 10: "z", 39: "size", 40: "size", 41: "size" } },
    VERTEX: { "": { 10: "po", 40: "size", 41: "size", 50: "deg" } },
    TEXT: { "": TEXT },
    ATTRIB: { "": {}, AcDbText: TEXT, embedded: EMBEDDED },
    ATTDEF: { "": {}, AcDbText: TEXT, embedded: EMBEDDED },
    INSERT: {
      "": { 10: "po", 41: "size", 42: "size", 43: "size", 44: "size", 45: "size", 50: "deg" },
    },
    // An MTEXT's embedded object holds its direction at 10, and its columns' sizes from 40 on.
    MTEXT: {
      "": MTEXT,
      embedded: {
        10: "dw",
        11: "pw",
        40: "size",
        41: "size",
        42: "size",
        43: "size",
        44: "size",
        45: "size",
        46: "size",
      },
    },
    DIMENSION: {
      AcDbDimension: { 10: "pw", 11: "po", 12: "po" },
      AcDbAlignedDimension: { 13: "pw", 14: "pw", 50: "deg" },
      AcDb2LineAngularDimension: { 13: "pw", 14: "pw", 15: "pw", 16: "po" },
      AcDb3PointAngularDimension: { 13: "pw", 14: "pw", 15: "pw" },
      AcDbOrdinateDimension: { 13: "pw", 14: "pw" },
      AcDbRadialDimension: { 15: "pw" },
      AcDbDiametricDimension: { 15: "pw" },
    },
    LARGE_RADIAL_DIMENSION: {
      AcDbDimension: { 10: "pw", 11: "po", 12: "po" },
      AcDbRadialDimensionLarge: { 13: "pw", 14: "pw", 15: "pw" },
    },
    ARC_DIMENSION: {
      AcDbDimension: { 10: "pw", 11: "po", 12: "po" },
      // Its 40 and 41 run along the arc from its own start, so a turn leaves them.
      AcDbArcDimension: { 13: "pw", 14: "pw", 15: "pw", 16: "pw", 17: "pw" },
    },
    LEADER: { "": { 10: "pw", 40: "size", 41: "size", 211: "dw", 212: "vw", 213: "vw" } },
    SOLID: { "": { 10: "po", 11: "po", 12: "po", 13: "po", 39: "size" } },
    TRACE: { "": { 10: "po", 11: "po", 12: "po", 13: "po", 39: "size" } },
    IMAGE: { "": { 10: "pw", 11: "vw", 12: "vw" } },
    WIPEOUT: { "": { 10: "pw", 11: "vw", 12: "vw" } },
    PDFUNDERLAY: { "": { 10: "pw", 41: "size", 42: "size", 43: "size", 50: "deg" } },
    ACAD_TABLE: { AcDbBlockReference: { 10: "po", 50: "deg" }, AcDbTable: { 10: "pw", 11: "dw" } },
    VIEWPORT: { AcDbViewport: { 10: "pw" } },
    SEQEND: { "": {} },
  } satisfies Record<string, Readonly<Record<string, Roles>>>),
);

/**
 * A group the file leaves out at its default, written when the edit makes it another value: after
 * the last group of its subclass whose code `after` names, or after the subclass's marker.
 */
interface Optional {
  readonly subclass: string;
  /** A marker the record must hold for the group to be its. */
  readonly marker?: string;
  readonly code: number;
  readonly role: "deg" | "cw" | "size";
  readonly value: number;
  readonly after: readonly number[];
}

const TEXT_ROTATION: Optional = {
  subclass: "AcDbText",
  code: 50,
  role: "deg",
  value: 0,
  after: [1, 40],
};

const OPTIONAL: ReadonlyMap<string, readonly Optional[]> = new Map(
  Object.entries({
    INSERT: [
      { subclass: "AcDbBlockReference", code: 41, role: "size", value: 1, after: [30, 20] },
      { subclass: "AcDbBlockReference", code: 42, role: "size", value: 1, after: [41, 30, 20] },
      { subclass: "AcDbBlockReference", code: 43, role: "size", value: 1, after: [42, 41, 30, 20] },
      {
        subclass: "AcDbBlockReference",
        code: 50,
        role: "deg",
        value: 0,
        after: [43, 42, 41, 30, 20],
      },
    ],
    PDFUNDERLAY: [
      { subclass: "AcDbUnderlayReference", code: 41, role: "size", value: 1, after: [30, 20] },
      { subclass: "AcDbUnderlayReference", code: 42, role: "size", value: 1, after: [41, 30, 20] },
      {
        subclass: "AcDbUnderlayReference",
        code: 43,
        role: "size",
        value: 1,
        after: [42, 41, 30, 20],
      },
      {
        subclass: "AcDbUnderlayReference",
        code: 50,
        role: "deg",
        value: 0,
        after: [43, 42, 41, 30, 20],
      },
    ],
    TEXT: [TEXT_ROTATION],
    ATTRIB: [TEXT_ROTATION],
    ATTDEF: [TEXT_ROTATION],
    POINT: [{ subclass: "AcDbPoint", code: 50, role: "deg", value: 0, after: [230, 30, 20, 39] }],
    MTEXT: [{ subclass: "AcDbMText", code: 50, role: "deg", value: 0, after: [43, 42, 31, 21, 7] }],
    DIMENSION: [
      {
        subclass: "AcDbAlignedDimension",
        marker: "AcDbRotatedDimension",
        code: 50,
        role: "deg",
        value: 0,
        after: [34, 24, 14],
      },
    ],
  } satisfies Record<string, readonly Optional[]>),
);

/** The kinds a DXF move writes. */
export const MOVED_KINDS: ReadonlySet<string> = new Set([...KINDS.keys(), "HATCH", "MULTILEADER"]);

/** The extrusion of a record, +1 for +Z, -1 for -Z, and 0 for any other. */
export function facingOf(groups: readonly HeldGroup[]): 1 | -1 | 0 {
  let x = 0;
  let y = 0;
  let z = 1;
  let inData = false;

  for (const g of groups) {
    if (g.code === 1001) inData = true;

    if (inData) continue;

    if (g.code === 210) x = Number(g.value);
    else if (g.code === 220) y = Number(g.value);
    else if (g.code === 230) z = Number(g.value);
  }

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return 0;
  const tiny = 1e-12;

  if (Math.abs(x) > tiny || Math.abs(y) > tiny) return 0;

  return z > 0 ? 1 : z < 0 ? -1 : 0;
}

interface Mover {
  readonly t: Applied;
  /** True for an embedded paragraph seen from below, whose direction turns the other way. */
  below?: boolean;
  /** -1 for an entity seen from below, whose own X runs the world's -X. */
  readonly face: 1 | -1;
  readonly out: Splice[];
  /** What keeps the record from being moved, such as a point whose numbers are apart. */
  problem?: string;
}

const ownToWorld = (m: Mover, p: Point): Point => (m.face === 1 ? p : [-p[0], p[1]]);

function setPoint(
  m: Mover,
  gx: HeldGroup,
  gy: HeldGroup,
  gz: HeldGroup | undefined,
  world: boolean,
): void {
  const p: Point = [Number(gx.value), Number(gy.value)];
  const q = world ? m.t.point(p) : ownToWorld(m, m.t.point(ownToWorld(m, p)));

  if (q[0] !== p[0]) m.out.push(numberAs(gx, q[0]));

  if (q[1] !== p[1]) m.out.push(numberAs(gy, q[1]));

  if (gz !== undefined && m.t.scale !== 1) m.out.push(numberAs(gz, m.t.size(Number(gz.value))));
}

function setVector(
  m: Mover,
  gx: HeldGroup,
  gy: HeldGroup,
  world: boolean,
  scaled: boolean,
  zeroIsX = false,
): void {
  const held: Point = [Number(gx.value), Number(gy.value)];

  const v: Point =
    zeroIsX && held[0] === 0 && held[1] === 0 && m.t.rotate % 360 !== 0 ? [1, 0] : held;

  const flip = (u: Point): Point => (zeroIsX && m.below ? [u[0], -u[1]] : u);
  const turn = (u: Point): Point => flip(scaled ? m.t.vector(flip(u)) : m.t.direction(flip(u)));
  const q = world ? turn(v) : ownToWorld(m, turn(ownToWorld(m, v)));

  if (q[0] !== held[0]) m.out.push(numberAs(gx, q[0]));

  if (q[1] !== held[1]) m.out.push(numberAs(gy, q[1]));
}

const TURN = 2 * Math.PI;

function setAngle(m: Mover, g: HeldGroup, radians: boolean, clockwise = false): void {
  if (m.t.rotate % 360 === 0) return;
  const a = Number(g.value);

  if (!Number.isFinite(a)) return;

  if (!radians) {
    m.out.push(numberAs(g, degrees360(a + (clockwise ? -m.face : m.face) * m.t.rotate)));

    return;
  }

  const turned = a + m.face * m.t.radians(0);
  const kept = turned % TURN;
  m.out.push(numberAs(g, kept < 0 ? kept + TURN : kept));
}

/** Applies a role to the group at `i`, and returns how many groups it took. */
/** True when a point's Z, `code` + 20, comes later in the record than right after its Y. */
function zApart(groups: readonly HeldGroup[], from: number, code: number): boolean {
  for (let k = from; k < groups.length && groups[k]!.code !== code; k++)
    if (groups[k]!.code === code + 20) return true;

  return false;
}

function apply(m: Mover, groups: readonly HeldGroup[], i: number, role: Role): number {
  const g = groups[i]!;
  const next = groups[i + 1];
  const pair = next !== undefined && next.code === g.code + 10 ? next : undefined;
  const third = groups[i + 2];

  const z =
    pair !== undefined && third !== undefined && third.code === g.code + 20 ? third : undefined;

  switch (role) {
    case "pw":
    case "po":
      if (pair === undefined) {
        m.problem ??= `a point whose group ${g.code} has no ${g.code + 10} after it`;

        return 1;
      }

      // A scale changes the Z, which must then be found where it belongs, after its Y.
      if (z === undefined && m.t.scale !== 1 && zApart(groups, i + 2, g.code))
        m.problem ??= `a point whose group ${g.code + 20} is not after its ${g.code + 10}`;
      setPoint(m, g, pair, z, role === "pw");

      return z === undefined ? 2 : 3;
    case "vw":
    case "vo":
    case "dw":
    case "dx":
    case "do":
      if (pair === undefined) {
        m.problem ??= `a vector whose group ${g.code} has no ${g.code + 10} after it`;

        return 1;
      }

      setVector(
        m,
        g,
        pair,
        role !== "vo" && role !== "do",
        role === "vw" || role === "vo",
        role === "dx",
      );

      return z === undefined ? 2 : 3;
    case "deg":
    case "cw":
    case "rad":
      setAngle(m, g, role === "rad", role === "cw");

      return 1;
    case "size":
      if (m.t.scale !== 1) m.out.push(numberAs(g, m.t.size(Number(g.value))));

      return 1;
    case "s3":
      if (m.t.scale !== 1)
        for (const h of [g, pair, z])
          if (h !== undefined) m.out.push(numberAs(h, m.t.size(Number(h.value))));

      return z === undefined ? (pair === undefined ? 1 : 2) : 3;
    case "z":
      if (z !== undefined && m.t.scale !== 1) m.out.push(numberAs(z, m.t.size(Number(z.value))));

      return z === undefined ? (pair === undefined ? 1 : 2) : 3;
  }
}

/** The groups that carry a record's own data: not in a group 102 opens, nor its extended data. */
function* own(groups: readonly HeldGroup[]): Generator<[number, string]> {
  let inBraces = false;

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;

    if (g.code === 1001) return;

    if (g.code === 102) {
      inBraces = g.value.trim().startsWith("{");
      continue;
    }

    if (inBraces) continue;
    yield [i, g.value];
  }
}

/**
 * The splices that move one record, or a reason it cannot be moved: a kind with no table, or an
 * extrusion that is neither +Z nor -Z. `owner` gives the groups of the record whose coordinates it
 * is in, a 2D polyline's for its vertices, which hold no facing of their own.
 */
export function moveRecord(
  kind: string,
  held: readonly HeldGroup[],
  t: Applied,
  owner?: readonly HeldGroup[],
): Splice[] | string {
  // A comment, 999, may sit between a point's X and its Y: the splices go by place, so it is left out.
  const groups = held.some((g) => g.code === 999) ? held.filter((g) => g.code !== 999) : held;

  if (kind === "HATCH") return moveHatch(groups, t);

  if (kind === "MULTILEADER") return moveMultileader(groups, t);
  const table = KINDS.get(kind);

  if (table === undefined) return `a ${kind} is not moved by this version of tsdraft`;
  const face = facingOf(owner ?? groups);

  if (face === 0) return `the ${kind} is not in the plan's plane`;
  const m: Mover = { t, face, out: [] };
  const optional = OPTIONAL.get(kind) ?? [];
  /** Each optional group seen, and the last group of each code of its subclass, by subclass. */
  const seen = new Set<string>();
  const last = new Map<string, HeldGroup>();
  const embeddedLast = new Map<number, HeldGroup>();
  const from = groups.findIndex((g) => g.code === 101);
  m.below = from >= 0 && groups.slice(from).some((g) => g.code === 230 && Number(g.value) < 0);
  let subclass = "";
  let embedded = false;
  let skip = 0;

  for (const [i] of own(groups)) {
    const g = groups[i]!;

    if (embedded) embeddedLast.set(g.code, g);
    else {
      const at = g.code === 100 ? `${g.value.trim()}:100` : `${subclass}:${g.code}`;
      last.set(at, g);
      seen.add(at);
    }

    if (skip > 0) {
      skip--;
      continue;
    }

    if (g.code === 100) subclass = g.value.trim();

    if (g.code === 101) embedded = true;

    if (g.code === 0 || g.code === 100 || g.code === 101) continue;
    const roles = embedded ? table["embedded"] : (table[subclass] ?? table[""]);
    const role = roles?.[g.code];

    if (role !== undefined) skip = apply(m, groups, i, role) - 1;
  }

  if (kind === "SPLINE" && t.scale !== 1) splineKnots(m, groups);
  const end = groups[0]?.eol ?? "\r\n";

  // An embedded paragraph that leaves out its direction runs along X: a turn writes one. One seen
  // from below holds its direction so.
  if (
    embeddedLast.size > 0 &&
    !embeddedLast.has(11) &&
    table["embedded"]?.[11] === "dx" &&
    t.rotate % 360 !== 0
  ) {
    const anchor = [46, 41, 40, 10].map((c) => embeddedLast.get(c)).find((g) => g !== undefined);

    if (anchor !== undefined) {
      const [x, y] = t.direction([1, 0]);
      const yy = m.below ? -y : y;
      m.out.push({
        from: anchor.end,
        to: anchor.end,
        text: ` 11${end}${shortest(x)}${end} 21${end}${shortest(yy)}${end} 31${end}0${end}`,
      });
    }
  }

  for (const o of optional) {
    if (seen.has(`${o.subclass}:${o.code}`) || !seen.has(`${o.subclass}:100`)) continue;

    if (o.marker !== undefined && !seen.has(`${o.marker}:100`)) continue;

    const value =
      o.role === "size"
        ? t.size(o.value)
        : degrees360(o.value + (o.role === "cw" ? -face : face) * t.rotate);

    if (value === o.value) continue;

    const anchor =
      o.after.map((c) => last.get(`${o.subclass}:${c}`)).find((g) => g !== undefined) ??
      last.get(`${o.subclass}:100`);

    if (anchor === undefined) return `the ${kind} holds no place for its group ${o.code}`;
    m.out.push({
      from: anchor.end,
      to: anchor.end,
      text: `${String(o.code).padStart(3)}${end}${shortest(value)}${end}`,
    });
  }

  return m.problem === undefined ? m.out : `the record holds ${m.problem}`;
}

/** The knots of a spline by fit points scaled as the readers fit them again from its points. */
function splineKnots(m: Mover, groups: readonly HeldGroup[]): void {
  const held = [...own(groups)].map(([i]) => groups[i]!);

  if (!held.some((g) => g.code === 11)) return;
  const flags = Number(held.find((g) => g.code === 70)?.value ?? 0);

  const spacing =
    (flags & 64) !== 0
      ? "square-root"
      : (flags & 128) !== 0
        ? "uniform"
        : (flags & 32) !== 0
          ? "chord"
          : undefined;

  const by = knotScale(spacing, m.t.scale);

  if (by !== 1)
    for (const g of held) if (g.code === 40) m.out.push(numberAs(g, Number(g.value) * by));
}

/**
 * An arc edge's start and end, at `i` and after it: turned the way the edge runs, as its group 73
 * says, with its span kept, so a whole circle from 0 to 360 stays one. How many groups it took.
 */
function arcEdge(m: Mover, groups: readonly HeldGroup[], i: number): number {
  const start = groups[i]!;
  const end = groups[i + 1];

  if (end?.code !== 51 || m.t.rotate % 360 === 0) return end?.code === 51 ? 1 : 0;
  let clockwise = false;

  for (let k = i + 2; k < groups.length && ![72, 92, 97].includes(groups[k]!.code); k++)
    if (groups[k]!.code === 73) clockwise = Number(groups[k]!.value) === 0;
  const a = Number(start.value);
  const b = Number(end.value);

  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  const sense = clockwise ? -m.face : m.face;
  const turned = degrees360(a + sense * m.t.rotate);
  m.out.push(numberAs(start, turned), numberAs(end, turned + (b - a)));

  return 1;
}

/** A hatch: its loops' points and edges, its pattern's lines, its seed points and its gradient. */
function moveHatch(groups: readonly HeldGroup[], t: Applied): Splice[] | string {
  const face = facingOf(groups);

  if (face === 0) return "the HATCH is not in the plan's plane";
  const m: Mover = { t, face, out: [] };
  let inHatch = false;
  let elevation = true;
  let edge = 0;
  let inPolylineLoop = false;
  let afterLoops = false;
  let skip = 0;

  for (const [i] of own(groups)) {
    if (skip > 0) {
      skip--;
      continue;
    }

    const g = groups[i]!;

    if (g.code === 100) {
      inHatch = g.value.trim() === "AcDbHatch";
      continue;
    }

    if (!inHatch) continue;

    const at = (role: Role): void => {
      skip = apply(m, groups, i, role) - 1;
    };

    switch (g.code) {
      case 10:
        if (elevation) {
          elevation = false;
          at("z");
        } else at("po");
        break;
      case 92:
        inPolylineLoop = (Number(g.value) & 2) !== 0;
        edge = 0;
        break;
      case 72:
        if (!inPolylineLoop) edge = Number(g.value);
        break;
      case 11:
        at(edge === 3 ? "vo" : "po");
        break;
      case 12:
      case 13:
        if (edge === 4) at("do");
        break;
      case 40:
        if (edge === 2 && !afterLoops) at("size");
        break;
      case 50:
        if (edge === 2 && !afterLoops) skip = arcEdge(m, groups, i);
        break;
      case 75:
        afterLoops = true;
        edge = 0;
        break;
      // The pattern's angle is the world's, as both readers read it; each line's is the hatch's own.
      case 52:
        at(m.face === 1 ? "deg" : "cw");
        break;
      case 53:
        at("deg");
        break;
      case 41:
        if (afterLoops) at("size");
        break;
      case 43: {
        // A pattern line's base point, X at 43 and Y at 44, and its offset at 45 and 46.
        const y = groups[i + 1];

        if (y?.code === 44) {
          setPoint(m, g, y, undefined, false);
          skip = 1;
        }

        break;
      }

      case 45: {
        const y = groups[i + 1];

        if (y?.code === 46) {
          setVector(m, g, y, false, true);
          skip = 1;
        }

        break;
      }

      case 49:
        at("size");
        break;
      case 460:
        at("rad");
        break;
    }
  }

  return m.problem === undefined ? m.out : `the record holds ${m.problem}`;
}

/** What each group of a multileader holds, in each of its sections. */
const LEADER_ROLES: ReadonlyMap<string, Roles> = new Map(
  Object.entries({
    context: {
      10: "pw",
      12: "pw",
      13: "dw",
      15: "pw",
      16: "s3",
      41: "size",
      42: "rad",
      43: "size",
      44: "size",
      46: "rad",
      110: "pw",
      111: "dw",
      112: "dw",
      140: "size",
      142: "size",
      143: "size",
      145: "size",
    },
    leader: { 10: "pw", 11: "dw", 12: "pw", 13: "pw", 40: "size" },
    line: { 10: "pw", 11: "pw", 12: "pw" },
    after: { 41: "size", 42: "size", 43: "rad" },
  } satisfies Record<string, Roles>),
);

/**
 * A multileader: its sections, `CONTEXT_DATA{` and in it each `LEADER{` and `LEADER_LINE{`, each
 * with its own meaning of a code, and its block content's matrix, sixteen groups 47 row by row.
 */
function moveMultileader(groups: readonly HeldGroup[], t: Applied): Splice[] | string {
  const m: Mover = { t, face: 1, out: [] };
  let section = "entity";
  let skip = 0;
  let matrix: HeldGroup[] = [];

  for (const [i] of own(groups)) {
    if (skip > 0) {
      skip--;
      continue;
    }

    const g = groups[i]!;
    const v = g.value.trim();

    if (g.code === 300 && v === "CONTEXT_DATA{") section = "context";
    else if (g.code === 302 && v === "LEADER{") section = "leader";
    else if (g.code === 304 && v === "LEADER_LINE{") section = "line";
    else if (g.code === 305) section = "leader";
    else if (g.code === 303) section = "context";
    else if (g.code === 301) section = "after";
    else if (g.code === 47 && section === "context") matrix.push(g);
    else {
      const role = LEADER_ROLES.get(section)?.[g.code];

      if (role !== undefined) skip = apply(m, groups, i, role) - 1;
    }
  }

  if (matrix.length === 16) blockMatrix(m, matrix);
  else if (matrix.length > 0) return "the MULTILEADER's block matrix is not of 16 values";

  return m.problem === undefined ? m.out : `the record holds ${m.problem}`;
}

/** A block content's matrix, row by row, with the transform made before it. */
function blockMatrix(m: Mover, cells: readonly HeldGroup[]): void {
  const a = cells.map((c) => Number(c.value));

  const set = (i: number, value: number): void => {
    if (value !== a[i]) m.out.push(numberAs(cells[i]!, value));
  };

  for (let j = 0; j < 4; j++) {
    const [x, y] = j < 3 ? m.t.vector([a[j]!, a[4 + j]!]) : m.t.point([a[j]!, a[4 + j]!]);
    set(j, x);
    set(4 + j, y);
    set(8 + j, m.t.size(a[8 + j]!));
  }
}
