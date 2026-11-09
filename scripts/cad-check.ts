// Opens tsdraft's DXF output in real AutoCAD and checks that AutoCAD sees what
// was drawn. Parsers such as ezdxf accept files that AutoCAD discards, so this
// is the test that counts for a writer change.
//
//   TSDRAFT_CAD_SSH=user@host pnpm test:cad
//
// The host is a WSL shell on a Windows machine with AutoCAD installed, reached
// over ssh. Nothing touches an open CAD window: each case runs in its own
// accoreconsole.exe, AutoCAD's headless console. For each case AutoCAD opens
// the DXF, runs AUDIT without fixing, and saves its own DXF, which this script
// reads back and compares with the drawing.
//
// Optional: TSDRAFT_CAD_DIR, a folder on the Windows drive as WSL sees it.
// TSDRAFT_ACCORECONSOLE, the WSL path of accoreconsole.exe.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDrawing,
  toDXF,
  type Drawing,
  type DrawingBuilder,
  type DxfVersion,
  type Entity,
} from "../src/index.ts";

const host = process.env.TSDRAFT_CAD_SSH;
if (!host) {
  console.error("Set TSDRAFT_CAD_SSH=user@host to a WSL shell on a Windows machine with AutoCAD.");
  process.exit(1);
}
const remoteDir = process.env.TSDRAFT_CAD_DIR ?? "/mnt/c/Users/Public/tsdraft-cad-check";
const accoreconsole = process.env.TSDRAFT_ACCORECONSOLE ?? "";

const INSUNITS = { in: 1, ft: 2, mm: 4, cm: 5, m: 6 };

/** Everything the library can draw, on layers that use each version's full naming range. */
function everything<V extends DxfVersion>(d: DrawingBuilder<V>, layers: [string, string]): Drawing {
  const [first, second] = layers;
  d.layer(first, { color: 3 }, () => {
    d.rect([0, 0], 75, 120);
    d.polyline([
      [0, 0],
      [10.5, 0],
      [10.5, 5.25],
    ]);
    d.line([-10, -12], [85, -12]);
  });
  d.layer(second, { color: 1 }, () => {
    d.circle([12, 100], 6);
    d.arc([62, 100], 6, 200, 340);
    d.arc([30, 30], 2.5, -90, 450.5);
    d.arc([40, 40], 2.5, 350, 370);
    d.text([2, -6], "LOT 75' x 120'", { height: 3 });
    d.text([2, -20], "Ø 25 – café x^2 日本語 100% <A&B>", { height: 2, rotation: 90 });
    d.text([2, -30], "  spaces kept  ", { height: 1 });
  });
  // CAD ignores case, so this is the first layer again.
  d.layer(first.toUpperCase(), {}, () => {
    d.line([0, 0], [5, 5]);
  });
  return d.build();
}

const cases: Record<string, Drawing> = {
  "r12-everything": everything(createDrawing({ units: "ft" }), [
    "c-prop_$1",
    "A234567890123456789012345678901",
  ]),
  "r2018-everything": everything(createDrawing({ units: "ft", dxf: "R2018" }), [
    "c prop #1 (new).v2",
    "CAFÉ 日本",
  ]),
  "r2018-long-name-mm": everything(createDrawing({ units: "mm", dxf: "R2018" }), [
    "a".repeat(255),
    "B",
  ]),
  "r12-empty": createDrawing().build(),
  "r2018-empty": createDrawing({ units: "m", dxf: "R2018" }).build(),
};

const local = mkdtempSync(join(tmpdir(), "tsdraft-cad-"));
try {
  for (const [name, drawing] of Object.entries(cases)) {
    writeFileSync(join(local, `${name}.dxf`), toDXF(drawing));
  }
  // The remote half. accoreconsole writes UTF-16, so the log is converted to UTF-8.
  writeFileSync(
    join(local, "run.sh"),
    `#!/bin/bash
set -u
cd "$(dirname "$0")"
exe="\${1:-}"
# The newest full AutoCAD, or AutoCAD LT when that is all there is.
if [ -z "$exe" ]; then exe=$(ls -d "/mnt/c/Program Files/Autodesk/AutoCAD "*/accoreconsole.exe 2>/dev/null | grep -v " LT " | sort | tail -1); fi
if [ -z "$exe" ]; then exe=$(ls -d "/mnt/c/Program Files/Autodesk/AutoCAD LT "*/accoreconsole.exe 2>/dev/null | sort | tail -1); fi
if [ ! -f "$exe" ]; then echo "accoreconsole.exe not found"; exit 2; fi
echo "using $exe"
win=$(wslpath -w "$PWD")
for dxf in *.dxf; do
  n=\${dxf%.dxf}
  case $n in *.out) continue;; esac
  printf '_.AUDIT\\r\\n_N\\r\\n_.SAVEAS\\r\\nDXF\\r\\n\\r\\n"%s\\\\%s.out.dxf"\\r\\n_.QUIT\\r\\n_Y\\r\\n' "$win" "$n" > "$n.scr"
  timeout 300 "$exe" /i "$win\\\\$n.dxf" /s "$win\\\\$n.scr" /l en-US > "$n.raw" 2>&1
  iconv -f UTF-16LE -t UTF-8 "$n.raw" 2>/dev/null | tr -d '\\r' > "$n.log" || tr -d '\\000\\r' < "$n.raw" > "$n.log"
  rm -f "$n.raw" "$n.scr"
  echo "ran $n"
done
`,
  );

  const run = (cmd: string, args: string[]) =>
    execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  run("ssh", [host, `rm -rf '${remoteDir}' && mkdir -p '${remoteDir}'`]);
  run("scp", ["-q", "-r", `${local}/.`, `${host}:${remoteDir}/`]);
  console.log(run("ssh", [host, `bash '${remoteDir}/run.sh' '${accoreconsole}'`]).trim());
  run("scp", ["-q", "-r", `${host}:${remoteDir}/.`, local]);

  let failed = 0;
  for (const [name, drawing] of Object.entries(cases)) {
    try {
      const log = readFileSync(join(local, `${name}.log`), "utf8");
      const rejection = log
        .split("\n")
        .find((l) => /invalid|improper|error in|read error/i.test(l));
      assert.ok(!rejection, `AutoCAD rejected the file: ${rejection}`);
      assert.match(log, /Total errors found 0 fixed 0/, "AUDIT found errors");
      compare(drawing, readDxf(readFileSync(join(local, `${name}.out.dxf`), "utf8")));
      console.log(`ok    ${name}`);
    } catch (error) {
      failed++;
      console.log(`FAIL  ${name}: ${(error as Error).message}`);
    }
  }
  if (failed > 0) {
    console.log(
      `${failed} of ${Object.keys(cases).length} cases failed. Logs are in ${remoteDir} on ${host}.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `AutoCAD opened all ${Object.keys(cases).length} cases, AUDIT found no errors, and the geometry matches.`,
    );
  }
} finally {
  rmSync(local, { recursive: true, force: true });
}

interface DxfRecord {
  readonly type: string;
  /** Every value for a group code, in file order. */
  readonly groups: Map<number, string[]>;
}

interface CadDrawing {
  readonly insunits: number | undefined;
  /** Color by lower-cased name. CAD ignores case, and AutoCAD upper-cases names from an R12 file. */
  readonly layers: Map<string, number>;
  readonly entities: DxfRecord[];
}

/** Reads the parts of an AutoCAD-written DXF that the comparison needs. */
function readDxf(text: string): CadDrawing {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i]), lines[i + 1] ?? ""]);

  let section = "";
  let table = "";
  let insunits: number | undefined;
  const layers = new Map<string, number>();
  const entities: DxfRecord[] = [];
  let current: DxfRecord | undefined;
  const close = () => {
    if (!current) return;
    if (section === "ENTITIES") entities.push(current);
    if (section === "TABLES" && table === "LAYER" && current.type === "LAYER") {
      layers.set(plainCaret(first(current, 2)).toLowerCase(), Number(first(current, 62)));
    }
    current = undefined;
  };
  pairs.forEach(([code, value], i) => {
    if (code === 0) {
      close();
      if (value === "SECTION") section = pairs[i + 1]?.[1] ?? "";
      else if (value === "TABLE") table = pairs[i + 1]?.[1] ?? "";
      else if (value !== "ENDSEC" && value !== "ENDTAB")
        current = { type: value, groups: new Map() };
      return;
    }
    if (section === "HEADER" && code === 9 && value === "$INSUNITS") {
      insunits = Number(pairs[i + 1]?.[1]);
    }
    if (current) current.groups.set(code, [...(current.groups.get(code) ?? []), value]);
  });
  return { insunits, layers, entities };
}

function first(record: DxfRecord, code: number): string {
  return record.groups.get(code)?.[0] ?? "";
}

/** AutoCAD writes a literal caret as a caret and a space. */
function plainCaret(value: string): string {
  return value.replaceAll("^ ", "^");
}

function compare(drawing: Drawing, cad: CadDrawing): void {
  if (drawing.dxf === "R2018") {
    assert.equal(cad.insunits, INSUNITS[drawing.units], "$INSUNITS");
  }
  for (const layer of drawing.layers) {
    assert.equal(
      cad.layers.get(layer.name.toLowerCase()),
      layer.color,
      `color of layer ${layer.name}`,
    );
  }
  assert.equal(cad.entities.length, drawing.entities.length, "entity count");
  drawing.entities.forEach((entity, i) => {
    const record = cad.entities[i];
    assert.ok(record, `entity ${i}`);
    const label = `${entity.kind} #${i}`;
    assert.equal(
      plainCaret(first(record, 8)).toLowerCase(),
      entity.layer.toLowerCase(),
      `${label} layer`,
    );
    const [type, expected] = expectedGroups(entity);
    assert.equal(record.type, type, `${label} type`);
    for (const [code, values] of expected) {
      const actual: string[] = record.groups.get(code) ?? [];
      assert.equal(actual.length, values.length, `${label} group ${code} count`);
      values.forEach((value, n) => {
        if (typeof value === "string") {
          assert.equal(plainCaret(actual[n] ?? ""), value, `${label} group ${code}`);
        } else {
          assert.ok(
            Math.abs(Number(actual[n]) - value) < 1e-6,
            `${label} group ${code}: expected ${value}, AutoCAD has ${actual[n]}`,
          );
        }
      });
    }
  });
}

/** The DXF type AutoCAD holds an entity as, and the group values it must have. */
function expectedGroups(e: Entity): [string, Map<number, (string | number)[]>] {
  switch (e.kind) {
    case "line":
      return [
        "LINE",
        new Map([
          [10, [e.from[0]]],
          [20, [e.from[1]]],
          [11, [e.to[0]]],
          [21, [e.to[1]]],
        ]),
      ];
    case "polyline":
      // AutoCAD converts an R12 POLYLINE to LWPOLYLINE when it loads the file.
      return [
        "LWPOLYLINE",
        new Map([
          [90, [e.points.length]],
          [70, [e.closed ? 1 : 0]],
          [10, e.points.map((p) => p[0])],
          [20, e.points.map((p) => p[1])],
        ]),
      ];
    case "circle":
      return [
        "CIRCLE",
        new Map([
          [10, [e.center[0]]],
          [20, [e.center[1]]],
          [40, [e.radius]],
        ]),
      ];
    case "arc":
      return [
        "ARC",
        new Map([
          [10, [e.center[0]]],
          [20, [e.center[1]]],
          [40, [e.radius]],
          [50, [e.startAngle]],
          [51, [e.endAngle]],
        ]),
      ];
    case "text":
      return [
        "TEXT",
        new Map<number, (string | number)[]>([
          [10, [e.at[0]]],
          [20, [e.at[1]]],
          [40, [e.height]],
          [1, [e.value]],
          ...(e.rotation === 0 ? [] : [[50, [e.rotation]] as [number, number[]]]),
        ]),
      ];
  }
}
