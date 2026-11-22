// The edges of a 3D solid, a region or a body, from the modeler data a file keeps for it in the
// text form (SAT) that DXF files and DWG files before 2013 hold. The data is a list of records,
// each ending at `#`, that point at each other by their place in the list as `$n`. Each `edge`
// record names the two vertices it runs between, its range of parameters, the curve it lies on and
// whether it runs along the curve or against it. The body's `transform`, when it has one, places
// all of it in the world.
import type { Point3, ReadEdge } from "./model.ts";

/** The edges read from a solid's data, and how many it holds that the reader does not follow. */
export interface ModelerEdges {
  readonly edges: ReadEdge[];
  readonly unread: number;
}

/** The oldest version of the text form read: the one files of the 2004 format hold. */
const OLDEST = 20800;

/** The most records read of one solid's data. A record takes at least 2 characters. */
const MOST_RECORDS = 1 << 22;

/** A record: its name, and its fields after the name as the text holds them. */
interface SatRecord {
  readonly name: string;
  readonly fields: readonly string[];
  /** The subtype data between braces, for the curves that hold it. */
  readonly braces?: readonly string[];
}

/** What starts a string of the data, so that none reads as a brace or a record's end. */
const STRING = "\u0002";

/** Splits the text into its tokens: words, `{`, `}`, `#`, and `@n` strings, each one token. */
function tokens(text: string, from: number): string[] {
  const out: string[] = [];
  let at = from;
  const n = text.length;
  while (at < n) {
    const c = text.charCodeAt(at);
    if (c <= 32) {
      at++;
      continue;
    }
    if (c === 64 /* @ */) {
      let end = at + 1;
      while (end < n && text.charCodeAt(end) >= 48 && text.charCodeAt(end) <= 57) end++;
      const length = Number(text.slice(at + 1, end));
      const start = end + 1;
      out.push(STRING + text.slice(start, Math.min(n, start + length)));
      at = start + length;
      continue;
    }
    if (c === 35 /* # */ || c === 123 /* { */ || c === 125 /* } */) {
      out.push(text[at]!);
      at++;
      continue;
    }
    let end = at + 1;
    while (end < n) {
      const d = text.charCodeAt(end);
      if (d <= 32 || d === 35 || d === 123 || d === 125) break;
      end++;
    }
    out.push(text.slice(at, end));
    at = end;
  }
  return out;
}

/** The records of the text, or undefined for a text of a version or a form not read. */
function satRecords(text: string): { version: number; list: SatRecord[] } | undefined {
  // The header: a line of the version and counts, a line of the product's names, and a line of
  // the units and the tolerances.
  let at = 0;
  const lines: string[] = [];
  for (let i = 0; i < 3; i++) {
    const end = text.indexOf("\n", at);
    if (end < 0) return undefined;
    lines.push(text.slice(at, end));
    at = end + 1;
  }
  const version = Number(lines[0]!.trim().split(/\s+/)[0]);
  if (!Number.isInteger(version) || version < OLDEST) return undefined;
  return { version, list: recordsOf(tokens(text, at)) };
}

/** What a true flag of the binary form reads as, which no word of the text form is. */
const TRUE = "\u0001";

/** Whether a flag is set: `reversed` and `shear` in the text form, true in the binary form. */
const set = (field: string | undefined): boolean =>
  field === TRUE || field === "reversed" || field === "shear";

/**
 * The records of the binary form (SAB), or undefined for one of a version or a form not read. It
 * holds the text form's tokens, each after a byte that says its kind: a number of 4 or 8 bytes, a
 * pointer, a string, a part of a record's name, a point or a vector of three numbers, a flag, a
 * brace, or a record's end. Its header is a line of 15 characters and four numbers of 4 bytes, the
 * version first; the product's names and the units follow as tokens before the first record.
 */
function sabRecords(bytes: Uint8Array): { version: number; list: SatRecord[] } | undefined {
  if (bytes.length < 31) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getInt32(15, true);
  if (version < OLDEST) return undefined;
  const latin = (from: number, n: number): string => {
    let s = "";
    for (let i = from; i < from + n; i++) s += String.fromCharCode(bytes[i]!);
    return s;
  };
  const all: string[] = [];
  let name = "";
  let started = false;
  let at = 31;
  const n = bytes.length;
  while (at < n) {
    const tag = bytes[at++]!;
    const need = (k: number): boolean => at + k <= n;
    switch (tag) {
      case 0x04:
      case 0x0c:
      case 0x15: {
        if (!need(4)) return undefined;
        const v = view.getInt32(at, true);
        all.push(tag === 0x0c ? `$${v}` : tag === 0x15 ? `E${v}` : String(v));
        at += 4;
        break;
      }
      case 0x06:
        if (!need(8)) return undefined;
        all.push(String(view.getFloat64(at, true)));
        at += 8;
        break;
      case 0x13:
      case 0x14:
        if (!need(24)) return undefined;
        for (let k = 0; k < 3; k++) all.push(String(view.getFloat64(at + 8 * k, true)));
        at += 24;
        break;
      case 0x07:
      case 0x0d:
      case 0x0e: {
        if (!need(1)) return undefined;
        const length = bytes[at++]!;
        if (!need(length)) return undefined;
        const word = latin(at, length);
        at += length;
        if (tag === 0x07) all.push(STRING + word);
        else if (tag === 0x0e) name += `${word}-`;
        else {
          // The tokens before the first record's name are the header's: names and units.
          if (!started) {
            all.length = 0;
            started = true;
          }
          all.push(name + word);
          name = "";
        }
        break;
      }
      case 0x0a:
      case 0x0b:
        all.push(tag === 0x0a ? TRUE : "F");
        break;
      case 0x0f:
        all.push("{");
        break;
      case 0x10:
        all.push("}");
        break;
      case 0x11:
        all.push("#");
        break;
      default:
        return undefined;
    }
    if (all.length > 8 * MOST_RECORDS) return undefined;
  }
  return { version, list: recordsOf(all) };
}

/** The records of a list of tokens, each its name and its tokens up to its `#`. */
function recordsOf(all: readonly string[]): SatRecord[] {
  const list: SatRecord[] = [];
  let i = 0;
  while (i < all.length && list.length < MOST_RECORDS) {
    const name = all[i]!;
    if (name.startsWith("End-of-")) break;
    const fields: string[] = [];
    let braces: string[] | undefined;
    let depth = 0;
    i++;
    for (; i < all.length; i++) {
      const t = all[i]!;
      if (t === "#" && depth === 0) break;
      if (t === "{") {
        depth++;
        braces ??= [];
        braces.push(t);
        continue;
      }
      if (t === "}") {
        depth = Math.max(0, depth - 1);
        braces?.push(t);
        continue;
      }
      if (depth > 0) braces!.push(t);
      else fields.push(t);
    }
    i++;
    list.push(braces === undefined ? { name, fields } : { name, fields, braces });
  }
  return list;
}

/** Whether a record is of a kind, or of a kind made from it, as `tedge-edge` is an edge. */
const isKind = (name: string, kind: string): boolean => name === kind || name.endsWith(`-${kind}`);

/**
 * Whether an edge is a seam: one where a face meets itself, whose two coedges lie on one face, as
 * where a swept tube closes. CAD programs show no seam.
 */
function seam(list: readonly SatRecord[], edge: SatRecord): boolean {
  const coedge = list[pointer(edge.fields[7])];
  if (coedge === undefined || !isKind(coedge.name, "coedge")) return false;
  const partner = list[pointer(coedge.fields[5])];
  if (partner === undefined || partner === coedge || !isKind(partner.name, "coedge")) return false;
  const face = (c: SatRecord) => {
    const loop = list[pointer(c.fields[8])];
    return loop?.name === "loop" ? pointer(loop.fields[5]) : -1;
  };
  return face(coedge) >= 0 && face(coedge) === face(partner);
}

const pointer = (field: string | undefined): number =>
  field !== undefined && field.startsWith("$") ? Number(field.slice(1)) : -1;

const numbers = (fields: readonly string[], from: number, count: number): number[] | undefined => {
  const out: number[] = [];
  for (let i = from; i < from + count; i++) {
    const v = Number(fields[i]);
    if (fields[i] === undefined || !Number.isFinite(v)) return undefined;
    out.push(v);
  }
  return out;
};

/** How a body is placed in the world: a point's row times `rows`, times `scale`, plus `move`. */
interface Placement {
  readonly rows: readonly [Point3, Point3, Point3];
  readonly move: Point3;
  readonly scale: number;
}

const placePoint = (p: Point3, t: Placement | undefined): Point3 =>
  t === undefined
    ? p
    : [
        (p[0] * t.rows[0][0] + p[1] * t.rows[1][0] + p[2] * t.rows[2][0]) * t.scale + t.move[0],
        (p[0] * t.rows[0][1] + p[1] * t.rows[1][1] + p[2] * t.rows[2][1]) * t.scale + t.move[1],
        (p[0] * t.rows[0][2] + p[1] * t.rows[1][2] + p[2] * t.rows[2][2]) * t.scale + t.move[2],
      ];

const placeVector = (v: Point3, t: Placement | undefined): Point3 =>
  t === undefined
    ? v
    : [
        (v[0] * t.rows[0][0] + v[1] * t.rows[1][0] + v[2] * t.rows[2][0]) * t.scale,
        (v[0] * t.rows[0][1] + v[1] * t.rows[1][1] + v[2] * t.rows[2][1]) * t.scale,
        (v[0] * t.rows[0][2] + v[1] * t.rows[1][2] + v[2] * t.rows[2][2]) * t.scale,
      ];

const cross = (a: Point3, b: Point3): Point3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: Point3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Point3): Point3 | undefined => {
  const l = length(a);
  return l > 0 && Number.isFinite(l) ? [a[0] / l, a[1] / l, a[2] / l] : undefined;
};

/** The placement of the first body's `transform`, or undefined when it has none. */
function placementOf(list: readonly SatRecord[]): Placement | undefined | null {
  const body = list.find((r) => r.name === "body");
  if (body === undefined) return undefined;
  const at = pointer(body.fields[5]);
  if (at < 0) return undefined;
  const t = list[at];
  if (t?.name !== "transform") return null;
  const v = numbers(t.fields, 2, 13);
  if (v === undefined) return null;
  // A shear is not a placement this reader follows.
  if (set(t.fields[17])) return null;
  return {
    rows: [
      [v[0]!, v[1]!, v[2]!],
      [v[3]!, v[4]!, v[5]!],
      [v[6]!, v[7]!, v[8]!],
    ],
    move: [v[9]!, v[10]!, v[11]!],
    scale: v[12]!,
  };
}

/** The point a vertex record names, by its last pointer. */
function vertexPoint(list: readonly SatRecord[], at: number): Point3 | undefined {
  const v = list[at];
  if (v === undefined || !isKind(v.name, "vertex")) return undefined;
  // The point is the last pointer, among the last few fields.
  for (let i = v.fields.length - 1; i >= Math.max(0, v.fields.length - 4); i--) {
    const p = pointer(v.fields[i]);
    if (p >= 0) {
      const r = list[p];
      if (r?.name !== "point") return undefined;
      const xyz = numbers(r.fields, 3, 3);
      return xyz === undefined ? undefined : [xyz[0]!, xyz[1]!, xyz[2]!];
    }
  }
  return undefined;
}

/** A B-spline as the modeler data holds it, its knots with their end knots added once more. */
interface Bspline {
  readonly degree: number;
  readonly knots: number[];
  readonly points: Point3[];
  readonly weights?: number[];
}

/**
 * The B-spline that opens a curve's subtype data: `nubs` or `nurbs`, the degree, `open`, `closed`
 * or `periodic`, the count of distinct knots, each knot and how many times it repeats, then each
 * control point, with its weight for `nurbs`. Each end knot repeats one time fewer than a clamped
 * B-spline's, so each is added once more.
 */
function bsplineAt(data: readonly string[], from: number, end = data.length): Bspline | undefined {
  const kind = data[from];
  if (kind !== "nubs" && kind !== "nurbs") return undefined;
  const degree = Number(data[from + 1]);
  const count = Number(data[from + 3]);
  if (!Number.isInteger(degree) || degree < 1 || degree > 25) return undefined;
  if (!Number.isInteger(count) || count < 2 || from + 4 + 2 * count > end) return undefined;
  const knots: number[] = [];
  let at = from + 4;
  for (let i = 0; i < count; i++) {
    const k = Number(data[at]);
    const times = Number(data[at + 1]);
    at += 2;
    if (!Number.isFinite(k) || !Number.isInteger(times) || times < 1 || times > degree + 1)
      return undefined;
    if (knots.length > 0 && k < knots[knots.length - 1]!) return undefined;
    for (let j = 0; j < times; j++) knots.push(k);
  }
  knots.unshift(knots[0]!);
  knots.push(knots[knots.length - 1]!);
  const n = knots.length - degree - 1;
  const rational = kind === "nurbs";
  const per = rational ? 4 : 3;
  if (n < degree + 1 || at + n * per > end) return undefined;
  const points: Point3[] = [];
  const weights: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = numbers(data, at, per);
    if (v === undefined) return undefined;
    points.push([v[0]!, v[1]!, v[2]!]);
    if (rational) {
      if (!(v[3]! > 0)) return undefined;
      weights.push(v[3]!);
    }
    at += per;
  }
  return rational ? { degree, knots, points, weights } : { degree, knots, points };
}

/** A subtype's data: its tokens, from `from` up to `to`, in its record's braces. */
interface Subtype {
  readonly tokens: readonly string[];
  readonly from: number;
  readonly to: number;
}

/** The subtypes the data defines, by the number `ref n` names: each brace not of a `ref`, in order. */
function subtypes(list: readonly SatRecord[]): Subtype[] {
  const out: Subtype[] = [];
  for (const r of list) {
    const b = r.braces;
    if (b === undefined) continue;
    const opens: [start: number, index: number][] = [];
    for (let i = 0; i < b.length; i++) {
      if (b[i] === "{") {
        if (b[i + 1] === "ref") opens.push([i, -1]);
        else {
          opens.push([i, out.length]);
          out.push({ tokens: b, from: i + 1, to: i + 1 });
        }
      } else if (b[i] === "}") {
        const open = opens.pop();
        if (open !== undefined && open[1] >= 0)
          out[open[1]] = { tokens: b, from: open[0] + 1, to: i };
      }
    }
  }
  return out;
}

/** The B-spline of an intcurve's subtype: within its first tokens, after `full` or its version. */
function curveSpline(
  data: Subtype,
  shared: readonly Subtype[],
  read: Map<Subtype, Bspline | undefined>,
  work: { left: number },
  depth = 0,
): Bspline | undefined {
  const t = data.tokens;
  if (t[data.from] === "ref") {
    const target = shared[Number(t[data.from + 1])];
    return target === undefined || depth > 8
      ? undefined
      : curveSpline(target, shared, read, work, depth + 1);
  }
  // A subtype many curves name is read once, and each read is paid for, whether or not it reads.
  if (read.has(data)) return read.get(data);
  work.left -= data.to - data.from;
  let s: Bspline | undefined;
  for (let at = data.from; at < Math.min(data.to, data.from + 5); at++) {
    if (t[at] === "nubs" || t[at] === "nurbs") {
      s = bsplineAt(t, at, data.to);
      break;
    }
  }
  read.set(data, s);
  return s;
}

/** The subtype a curve record opens: the data from its first brace to its match. */
function ownSubtype(r: SatRecord): Subtype | undefined {
  const b = r.braces;
  if (b === undefined || b[0] !== "{") return undefined;
  let depth = 0;
  for (let i = 0; i < b.length; i++) {
    if (b[i] === "{") depth++;
    else if (b[i] === "}" && --depth === 0) return { tokens: b, from: 1, to: i };
  }
  return undefined;
}

/** Inserts the knot `u` into a B-spline in homogeneous form until it repeats `times` times. */
function insertKnot(
  degree: number,
  knots: number[],
  points: number[][],
  u: number,
  times: number,
): void {
  for (let r = 0; r < times; r++) {
    let k = degree;
    while (k + 1 < knots.length - degree - 1 && knots[k + 1]! <= u) k++;
    const out: number[][] = [];
    for (let i = 0; i < points.length + 1; i++) {
      if (i <= k - degree) out.push(points[i]!);
      else if (i > k) out.push(points[i - 1]!);
      else {
        const a = (u - knots[i]!) / (knots[i + degree]! - knots[i]!);
        out.push(points[i]!.map((c, j) => (1 - a) * points[i - 1]![j]! + a * c));
      }
    }
    knots.splice(k + 1, 0, u);
    points.length = 0;
    for (const q of out) points.push(q);
  }
}

/** The B-spline cut to its parameters from `a` to `b`, clamped at both ends. */
function cut(s: Bspline, a: number, b: number): Bspline | undefined {
  const p = s.degree;
  const knots = [...s.knots];
  const lo = knots[p]!;
  const hi = knots[knots.length - p - 1]!;
  const from = Math.max(lo, Math.min(a, b));
  const to = Math.min(hi, Math.max(a, b));
  if (!(to > from)) return undefined;
  const w = s.weights;
  const points = s.points.map((q, i) => {
    const wi = w?.[i] ?? 1;
    return [q[0] * wi, q[1] * wi, q[2] * wi, wi];
  });
  const times = (u: number) => knots.filter((k) => k === u).length;
  if (from > lo || times(from) < p + 1) insertKnot(p, knots, points, from, p + 1 - times(from));
  if (to < hi || times(to) < p + 1) insertKnot(p, knots, points, to, p + 1 - times(to));
  const first = knots.indexOf(from);
  const last = knots.lastIndexOf(to);
  const kept = knots.slice(first, last + 1);
  const cp = points.slice(first, last - p);
  return {
    degree: p,
    knots: kept,
    points: cp.map((h) => [h[0]! / h[3]!, h[1]! / h[3]!, h[2]! / h[3]!] as Point3),
    ...(w === undefined ? {} : { weights: cp.map((h) => h[3]!) }),
  };
}

const TURN = 2 * Math.PI;

/** Whether every number an edge holds is finite. */
function finite(edge: ReadEdge): boolean {
  const ok = (q: readonly number[]) => q.every(Number.isFinite);
  switch (edge.kind) {
    case "line":
      return ok(edge.from) && ok(edge.to);
    case "ellipse":
      return (
        ok(edge.center) &&
        ok(edge.normal) &&
        ok(edge.majorAxis) &&
        ok([edge.ratio, edge.startParameter ?? 0, edge.endParameter ?? 0])
      );
    case "spline":
      return ok(edge.knots) && edge.controlPoints.every(ok) && ok(edge.weights ?? []);
  }
}

/** An edge with each -0 as 0, which the text form writes as `-0` and the binary form as 0. */
function signless(edge: ReadEdge): ReadEdge {
  const n = (v: number): number => v + 0;
  const p = (q: Point3): Point3 => [q[0] + 0, q[1] + 0, q[2] + 0];
  switch (edge.kind) {
    case "line":
      return { ...edge, from: p(edge.from), to: p(edge.to) };
    case "ellipse":
      return {
        ...edge,
        center: p(edge.center),
        normal: p(edge.normal),
        majorAxis: p(edge.majorAxis),
      };
    case "spline":
      return {
        ...edge,
        knots: edge.knots.map(n),
        controlPoints: edge.controlPoints.map(p),
        ...(edge.weights && { weights: edge.weights.map(n) }),
      };
  }
}
const degrees = (radians: number): number => (radians * 180) / Math.PI;

/**
 * The edges of the modeler data in its text form: lines, ellipses and splines in the world, and a
 * count of the edges it holds on a curve the reader does not follow. A text of an older version, or
 * one that does not read as records, gives no edges and `unread` -1.
 */
export function satEdges(text: string): ModelerEdges {
  return edgesOf(satRecords(text));
}

/** The edges of the modeler data in its binary form, as `satEdges` reads the text form. */
export function sabEdges(bytes: Uint8Array): ModelerEdges {
  return edgesOf(sabRecords(bytes));
}

function edgesOf(read: { version: number; list: SatRecord[] } | undefined): ModelerEdges {
  if (read === undefined) return { edges: [], unread: -1 };
  const { list } = read;
  const place = placementOf(list);
  if (place === null)
    return { edges: [], unread: list.filter((r) => isKind(r.name, "edge")).length };
  const shared = subtypes(list);
  // Each curve's B-spline is read once, however many edges lie on it.
  const splines = new Map<SatRecord, Bspline | undefined>();
  const subtypeSplines = new Map<Subtype, Bspline | undefined>();
  // Cutting a B-spline to an edge takes time in its points: past a budget in the data's size,
  // the edges left are not followed.
  let tokens = 0;
  for (const r of list) tokens += 1 + r.fields.length + (r.braces?.length ?? 0);
  const work = { left: 1_000_000 + 16 * tokens };
  const edges: ReadEdge[] = [];
  let unread = 0;
  for (const r of list) {
    if (!isKind(r.name, "edge")) continue;
    const edge =
      work.left > 0 ? edgeOf(list, r, place, shared, splines, subtypeSplines, work) : undefined;
    // An edge with a number past the doubles, such as from a scale past them, is not followed.
    if (edge === undefined || (edge !== null && !finite(edge))) unread++;
    else if (edge !== null) edges.push(signless(edge));
  }
  return { edges, unread };
}

/** One edge record in the world, null for one of no length, or undefined for one not read. */
function edgeOf(
  list: readonly SatRecord[],
  r: SatRecord,
  place: Placement | undefined,
  shared: readonly Subtype[],
  splines: Map<SatRecord, Bspline | undefined>,
  read: Map<Subtype, Bspline | undefined>,
  work: { left: number },
): ReadEdge | null | undefined {
  // The fields after the name: attributes, history, a pointer, the start vertex and parameter,
  // the end vertex and parameter, a coedge, the curve and the sense.
  const f = r.fields;
  const start = vertexPoint(list, pointer(f[3]));
  const end = vertexPoint(list, pointer(f[5]));
  const [t0, t1] = [Number(f[4]), Number(f[6])];
  // An edge on no curve is a point, such as a cone's apex; a seam does not show.
  if (pointer(f[8]) < 0 || seam(list, r)) return null;
  const curve = list[pointer(f[8])];
  const reversed = set(f[9]);
  if (start === undefined || end === undefined || curve === undefined) return undefined;
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return undefined;
  // The edge's parameters run along the curve, or against it for a reversed edge.
  const [u0, u1] = reversed ? [-t1, -t0] : [t0, t1];
  switch (curve.name) {
    case "straight-curve": {
      const [from, to] = [placePoint(start, place), placePoint(end, place)];
      return { kind: "line", from, to };
    }
    case "ellipse-curve": {
      const v = numbers(curve.fields, 3, 10);
      if (v === undefined) return undefined;
      const center: Point3 = [v[0]!, v[1]!, v[2]!];
      const normal = unit([v[3]!, v[4]!, v[5]!]);
      const major: Point3 = [v[6]!, v[7]!, v[8]!];
      const ratio = v[9]!;
      if (normal === undefined || !(length(major) > 0) || !(ratio > 0 && ratio <= 1))
        return undefined;
      const minor = cross(normal, major);
      const placedMajor = placeVector(major, place);
      const placedNormal = unit(cross(placedMajor, placeVector(minor, place)));
      if (placedNormal === undefined) return undefined;
      const span = u1 - u0;
      const base = {
        kind: "ellipse" as const,
        center: placePoint(center, place),
        normal: placedNormal,
        majorAxis: placedMajor,
        ratio,
      };
      if (!(span > 0)) return undefined;
      if (span >= TURN - 1e-12) return base;
      const from = ((u0 % TURN) + TURN) % TURN;
      return { ...base, startParameter: degrees(from), endParameter: degrees(from + span) };
    }
    case "intcurve-curve": {
      let s = splines.get(curve);
      if (!splines.has(curve)) {
        const data = ownSubtype(curve);
        s = data === undefined ? undefined : curveSpline(data, shared, read, work);
        splines.set(curve, s);
      }
      if (s === undefined) return undefined;
      work.left -= s.knots.length * (s.degree + 2);
      // A reversed curve runs its B-spline backward: its parameter t is the B-spline's -t.
      const [v0, v1] = set(curve.fields[3]) ? [-u1, -u0] : [u0, u1];
      const piece = cut(s, v0, v1);
      if (piece === undefined) return null;
      return {
        kind: "spline",
        degree: piece.degree,
        knots: piece.knots,
        controlPoints: piece.points.map((q) => placePoint(q, place)),
        ...(piece.weights === undefined ? {} : { weights: piece.weights }),
      };
    }
    default:
      return undefined;
  }
}

/**
 * The text of modeler data as a file before 2013 holds it: each character from `!` to `~` is
 * 159 less itself, and a tab is a space.
 */
export function decipherSat(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out += c > 32 && c < 127 ? String.fromCharCode(159 - c) : c === 9 ? " " : text[i];
  }
  return out;
}
