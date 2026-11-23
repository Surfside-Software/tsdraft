// `editDXF`: the edited copy of a firm's DXF. Each record the edit does not change is copied as
// the file holds it, line ends included, so an edit that changes nothing gives the file back.
import { DxfDocumentReader, type DxfDocument } from "../read/document.ts";
import { BINARY } from "../read/groups.ts";
import type { DrawingRead } from "../read/model.ts";
import { sha256 } from "../sha256.ts";
import { recordEdits } from "./dxf-records.ts";
import { lintEdit } from "./lint.ts";
import { EditError, editToMake, type Edit } from "./model.ts";
import { indexRead } from "./reach.ts";

/** The one format an edit writes: the 2018 format's. */
export const EDIT_VERSION = "AC1032";

/** The most bytes of a header variable read for its value, comments among them. */
const MOST_VARIABLE = 1 << 20;

/** The value of a header variable, from the bytes of its groups. */
export function headerValue(bytes: Uint8Array, doc: DxfDocument, name: string): string | undefined {
  const variable = doc.header().find((v) => v.name === name);

  if (!variable) return undefined;

  const text = new TextDecoder("latin1").decode(
    bytes.subarray(variable.start, variable.start + Math.min(variable.length, MOST_VARIABLE)),
  );

  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));

  // The code 9 and the name, then the value's group, past any comment, group 999.
  for (let i = 2; i + 1 < lines.length; i += 2)
    if (lines[i]!.trim() !== "999") return lines[i + 1]!.trim();

  return undefined;
}

/**
 * The document of a DXF an edit may be made in, or an `EditError` for one it refuses: one given
 * as binary, past the document's caps, or of a format other than 2018's.
 */
export function editableDXF(bytes: Uint8Array): DxfDocument {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, BINARY.length));

  if (head === BINARY) throw new EditError("The file is a binary DXF, which no edit takes");
  const reader = new DxfDocumentReader();
  reader.push(bytes);
  const doc = reader.end();

  if (doc.capped)
    throw new EditError("The file holds more records than an edit lists, so no edit takes it");
  const version = headerValue(bytes, doc, "$ACADVER");

  if (version !== EDIT_VERSION)
    throw new EditError(
      `The file is of the format ${version ?? "it does not name"}, and an edit writes only the 2018 format, ${EDIT_VERSION}`,
    );

  return doc;
}

/** Checks that the bytes are those the edit was planned on, and those the read was of. */
export function checkHash(bytes: Uint8Array, edit: Edit, read: DrawingRead | undefined): void {
  const hash = sha256(bytes);

  if (hash !== edit.sha256)
    throw new EditError(
      `The file's SHA-256 is ${hash}, not the ${edit.sha256} the edit was planned on: it changed after the edit was planned`,
    );

  if (read !== undefined && read.sha256 !== hash)
    throw new EditError("The read given is of other bytes than the file's");
}

/**
 * The edited copy of a DXF of the 2018 format. Throws only `EditError`: for bytes whose SHA-256
 * is not the edit's, for a file an edit refuses, and for a statement it cannot make.
 */
export function editDXF(bytes: Uint8Array, edit: Edit, read: DrawingRead): Uint8Array {
  try {
    const made = editToMake(edit);
    checkHash(bytes, made, read);
    const doc = editableDXF(bytes);

    if (made.statements.length === 0) return bytes.slice();
    const refused = lintEdit(made, read).find((d) => d.severity === "error");

    if (refused !== undefined) throw new EditError(refused.message, refused.statement);
    const { erased, patched } = recordEdits(bytes, doc, made, read);
    const parts: Uint8Array[] = [];

    for (let i = 0; i < doc.count; i++) {
      if (erased.has(i)) continue;
      const start = doc.starts[i]!;
      parts.push(patched.get(i) ?? bytes.subarray(start, start + doc.length(i)));
    }

    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;

    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }

    return out;
  } catch (error) {
    if (error instanceof EditError) throw error;
    throw new EditError(
      `The edit could not be made: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
