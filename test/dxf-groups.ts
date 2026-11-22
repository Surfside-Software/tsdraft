import assert from "node:assert/strict";

/** Parses DXF text into [code, value] pairs. */
export function pairs(dxf: string): [number, string][] {
  const lines = dxf.split("\r\n");
  assert.equal(lines.pop(), "", "DXF ends with CRLF");
  assert.equal(lines.length % 2, 0, "DXF has whole group-code pairs");
  const out: [number, string][] = [];
  for (let i = 0; i < lines.length; i += 2) out.push([Number(lines[i]), lines[i + 1] ?? ""]);
  return out;
}

/** The records of a DXF: each from one group 0 to the next. */
export function records(dxf: string): [number, string][][] {
  const out: [number, string][][] = [];
  for (const pair of pairs(dxf)) {
    if (pair[0] === 0) out.push([]);
    out.at(-1)?.push(pair);
  }
  return out;
}

/** The groups following the subclass marker in the nth record of this type. */
export function recordFields(dxf: string, type: string, subclass: string, n = 0): string[] {
  const groups = records(dxf).filter((record) => record[0]?.[1] === type)[n];
  assert.ok(groups, `Missing ${type} record ${n}`);
  const marker = groups.findIndex(([code, value]) => code === 100 && value === subclass);
  assert.notEqual(marker, -1, `Missing ${subclass} in ${type}`);
  return groups.slice(marker + 1).map(([code, value]) => `${code}=${value}`);
}
