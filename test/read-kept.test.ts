// The picture of an edited read from the fragments kept from before the edit is the picture of the
// edited read drawn whole: in the file's own spaces, and in a model a sheet shows through an xref.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDrawing,
  editedPicture,
  readDXF,
  readPicture,
  toDXF,
  type DrawingRead,
  type ReadEntity,
} from "../src/index.ts";
import { ofKind } from "./values.ts";

async function model(): Promise<DrawingRead> {
  const d = createDrawing({ units: "ft" });
  d.layer("A-WALL", { color: 1 }).layer("A-ANNO", { color: 3 });

  for (let i = 0; i < 4; i++) {
    d.layer("A-WALL", {}, () => d.rect([0, 200 * i], 100, 60));
    d.layer("A-ANNO", {}, () => d.text([5, 200 * i + 50], `PLAN ${i + 1}`, { height: 2 }));
  }

  return readDXF(toDXF(d.build()), { geometry: true });
}

async function sheet(): Promise<DrawingRead> {
  const d = createDrawing({ units: "ft" });
  d.xref("MODEL", "model.dwg", { attach: true });
  d.insert("MODEL", [0, 0]);
  d.layout("Sheet", { paper: "ARCH D" }, (s) => {
    d.text([1, 1], "SHEET", { height: 0.25 });
    s.viewport([2, 2], 20, 16, { center: [50, 330], ratio: 120 });
  });

  return readDXF(toDXF(d.build()), { geometry: true });
}

/** The read with model space's entities as `edit` gives them. */
const withModel = (
  read: DrawingRead,
  edit: (entities: readonly ReadEntity[]) => readonly ReadEntity[],
): DrawingRead => ({
  ...read,
  model: { ...read.model, entities: edit(read.model.entities ?? []) },
});

/** An edit of model space: the second entity erased, the fourth moved, a circle added. */
function edit(read: DrawingRead) {
  const entities = read.model.entities ?? [];
  const erased = entities[1]!;
  const moved = ofKind(entities[3], "text");
  const changed: ReadEntity = { ...moved, at: [moved.at[0] + 20, moved.at[1]] };

  const added: ReadEntity = {
    kind: "circle",
    layer: "A-WALL",
    handle: "FFFF0",
    center: [50, 30],
    radius: 5,
  };

  const after = withModel(read, (es) => [
    ...es.filter((e) => e !== erased).map((e) => (e === moved ? changed : e)),
    added,
  ]);

  const only = withModel(read, () => [changed, added]);

  return { erased: new Set([erased.handle!]), changed: new Set([moved.handle!]), after, only };
}

/**
 * A picture without what places an entity among the drawing's: its index, and for model space
 * alone the frame its extents give, which the kept picture holds as it was before the edit.
 */
const placed = (svg: string): string =>
  svg.replace(/ data-entity="\d+"/g, "").replace(/ viewBox="[^"]*"/, "");

test("an edit of the file's own model space joins its kept fragments", async () => {
  const read = await model();
  const kept = readPicture(read);
  const { erased, changed, after, only } = edit(read);
  const joined = editedPicture(kept, { erased, changed, drawn: readPicture(only) });
  assert.equal(placed(joined), placed(readPicture(after).svg));
});

test("an edit of a model a sheet shows through an xref joins the sheet's kept fragments", async () => {
  const [host, base] = [await sheet(), await model()];
  const options = { layout: "Sheet" };
  const kept = readPicture(host, { ...options, xrefs: { MODEL: base } });
  const { erased, changed, after, only } = edit(base);
  const drawn = readPicture(host, { ...options, xrefs: { MODEL: only } });
  const joined = editedPicture(kept, { xref: "MODEL", erased, changed, drawn });
  assert.equal(joined, readPicture(host, { ...options, xrefs: { MODEL: after } }).svg);
  assert.notEqual(joined, kept.svg);
});

test("an entity moved out of a viewport's view leaves it", async () => {
  const d = createDrawing({ units: "ft" });
  d.rect([0, 0], 100, 60);
  d.text([5, 50], "PLAN 1", { height: 2 });
  d.layout("Sheet", { paper: "ARCH D" }, (s) => {
    s.viewport([2, 2], 10, 8, { center: [50, 30], ratio: 120 });
  });
  const read = await readDXF(toDXF(d.build()), { geometry: true });
  const options = { layout: "Sheet" };
  const kept = readPicture(read, options);

  const text = ofKind(
    (read.model.entities ?? []).find((e) => e.kind === "text"),
    "text",
  );

  const away: ReadEntity = { ...text, at: [text.at[0] + 5000, text.at[1]] };
  const after = withModel(read, (es) => es.map((e) => (e === text ? away : e)));

  const drawn = readPicture(
    withModel(read, () => [away]),
    options,
  );

  const joined = editedPicture(kept, { changed: new Set([text.handle!]), drawn });
  assert.equal(joined, readPicture(after, options).svg);
});

test("an edit of an xref placed twice in a space draws each place", async () => {
  const base = await model();
  const d = createDrawing({ units: "ft" });
  d.xref("MODEL", "model.dwg", { attach: true });
  d.insert("MODEL", [0, 0]);
  d.insert("MODEL", [1000, 0]);
  const host = await readDXF(toDXF(d.build()), { geometry: true });
  const kept = readPicture(host, { xrefs: { MODEL: base } });
  const { erased, changed, after, only } = edit(base);
  const drawn = readPicture(host, { xrefs: { MODEL: only } });
  const joined = editedPicture(kept, { xref: "MODEL", erased, changed, drawn });
  assert.equal(joined, readPicture(host, { xrefs: { MODEL: after } }).svg);
});
