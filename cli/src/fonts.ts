// The typeface the PNG renderer and the PDF set each of tsdraft's fonts in. The command ships
// one font, which answers in a PNG for every font it finds no file for. A TrueType font is set
// in its own file when the machine has it, or in a font made to its widths, so that its letters
// have their own shapes, and a PDF embeds that file cut to the letters it uses. `toSVG` holds
// every text to the length it plots, whatever the typeface, and the renderer sizes each by the
// cap height of the typeface it draws, which is read here.
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { boldFontKey, capHeightOf, FONTS, pdfFace } from "tsdraft";
import type { PngFont } from "./state.ts";

/** The font the command ships: JetBrains Mono, under the OFL in assets/fonts/OFL.txt. */
export const SHIPPED = {
  face: "JetBrains Mono",
  file: fileURLToPath(new URL("../assets/fonts/JetBrainsMono-Regular.ttf", import.meta.url)),
} as const;

let shippedCapHeight: number | undefined;

/** The height of a capital of the shipped font, as a share of its size, read from its file. */
export function shippedCap(): number {
  return (shippedCapHeight ??= capHeight(readFileSync(SHIPPED.file)) ?? 0.73);
}

/**
 * Fonts made to the widths of another: each has, letter for letter, the advance widths of the
 * font it stands in for. The Liberation fonts are installed on most Linux machines.
 */
const SAME_WIDTHS = new Map<string, readonly { face: string; file: string; bold: string }[]>([
  [
    "Arial",
    [
      {
        face: "Liberation Sans",
        file: "LiberationSans-Regular.ttf",
        bold: "LiberationSans-Bold.ttf",
      },
    ],
  ],
  [
    "Courier New",
    [
      {
        face: "Liberation Mono",
        file: "LiberationMono-Regular.ttf",
        bold: "LiberationMono-Bold.ttf",
      },
    ],
  ],
  [
    "Times New Roman",
    [
      {
        face: "Liberation Serif",
        file: "LiberationSerif-Regular.ttf",
        bold: "LiberationSerif-Bold.ttf",
      },
    ],
  ],
]);

/** The `font-family` `toSVG` writes for each font of `FONTS`, by the font's name. */
const FAMILIES = new Map<string, string>(
  Object.entries(FONTS).map(([font, info]) => [font, info.family]),
);

/** A font file the renderer loads, and what the SVG's `font-family` becomes for it. */
export interface Face {
  /** The `font-family` `toSVG` writes for the font. */
  readonly family: string;
  /** The family name the file gives itself, which the renderer finds it by. */
  readonly face: string;
  readonly file: string;
  /** The height of a capital in the file, as a share of the font's size. */
  readonly capHeight: number;
  /** The file of the face's bold, of the same family, and the height of a capital in it. */
  readonly bold?: { readonly file: string; readonly capHeight: number };
}

/** The folders an operating system keeps its fonts in. */
function fontFolders(): string[] {
  const home = homedir();

  if (process.platform === "win32") {
    return [
      join(process.env.WINDIR ?? "C:\\Windows", "Fonts"),
      join(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "Microsoft/Windows/Fonts"),
    ];
  }

  if (process.platform === "darwin") {
    return ["/System/Library/Fonts", "/Library/Fonts", join(home, "Library/Fonts")];
  }

  return [
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    join(home, ".local/share/fonts"),
    join(home, ".fonts"),
  ];
}

/** Every file under the folders whose name, in lower case, is one of `names`. */
function findFiles(folders: readonly string[], names: ReadonlySet<string>): Map<string, string> {
  const found = new Map<string, string>();

  const walk = (folder: string, depth: number): void => {
    let entries;

    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name.toLowerCase();

      if (entry.isDirectory()) {
        if (depth < 4) walk(join(folder, entry.name), depth + 1);
      } else if (names.has(name) && !found.has(name)) found.set(name, join(folder, entry.name));
    }
  };

  for (const folder of folders) walk(folder, 0);

  return found;
}

/**
 * The family name a TrueType file gives itself: name 1 of its `name` table, in the Windows
 * encoding. Undefined for a file that is not a TrueType font or has no such name.
 */
export function familyName(bytes: Uint8Array): string | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  try {
    const tables = view.getUint16(4);

    for (let i = 0; i < tables; i++) {
      const entry = 12 + i * 16;
      const tag = String.fromCharCode(...bytes.subarray(entry, entry + 4));

      if (tag !== "name") continue;
      const table = view.getUint32(entry + 8);
      const strings = table + view.getUint16(table + 4);
      // The family in United States English, language 0x409, or failing that the first.
      let family: string | undefined;

      for (let n = 0; n < view.getUint16(table + 2); n++) {
        const record = table + 6 + n * 12;

        // Platform 3 is Windows, whose strings are UTF-16, and name 1 is the family.
        if (view.getUint16(record) !== 3 || view.getUint16(record + 6) !== 1) continue;
        const english = view.getUint16(record + 4) === 0x409;

        if (family !== undefined && !english) continue;
        const [length, offset] = [view.getUint16(record + 8), view.getUint16(record + 10)];
        family = "";

        for (let at = 0; at + 1 < length; at += 2) {
          family += String.fromCharCode(view.getUint16(strings + offset + at));
        }

        if (english) break;
      }

      return family;
    }
  } catch {
    // The file is shorter than its tables say.
  }

  return undefined;
}

/** Where each table of a TrueType file starts, by its tag. */
function tablesOf(bytes: Uint8Array, view: DataView): Map<string, number> {
  const tables = new Map<string, number>();

  for (let i = 0; i < view.getUint16(4); i++) {
    const entry = 12 + i * 16;
    tables.set(String.fromCharCode(...bytes.subarray(entry, entry + 4)), view.getUint32(entry + 8));
  }

  return tables;
}

/**
 * The height of a capital that a TrueType file states, as a share of the font's size: the cap
 * height of its `OS/2` table over the units of its em. Undefined for a file that states none.
 */
export function capHeight(bytes: Uint8Array): number | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  try {
    const tables = tablesOf(bytes, view);
    const [head, os2] = [tables.get("head"), tables.get("OS/2")];

    // The table has a cap height from its version 2 on.
    if (head === undefined || os2 === undefined || view.getUint16(os2) < 2) return undefined;
    const share = view.getInt16(os2 + 88) / view.getUint16(head + 18);

    return share > 0 && Number.isFinite(share) ? share : undefined;
  } catch {
    // The file is shorter than its tables say.
    return undefined;
  }
}

/**
 * The face of each TrueType font of `FONTS` that the machine has a file for, by the font's
 * name: the font's own file, or one made to its widths. A file counts only when the family
 * name inside it is the one expected, since the renderer finds a font by that name.
 *
 * @param folders - Where to look. The operating system's font folders unless given.
 */
export function findFaces(folders: readonly string[] = fontFolders()): Map<string, Face> {
  const wanted: {
    font: string;
    info: { readonly family: string; readonly capHeight?: number };
    face: string;
    file: string;
    bold: readonly string[];
  }[] = [];

  for (const [font, info] of Object.entries(FONTS)) {
    if (!("capHeight" in info)) continue;
    // Windows names the file as `FONTS` does, and macOS by the typeface.
    const bold = "bold" in info ? [info.bold.file, `${font} Bold.ttf`] : [];

    for (const file of [info.file, `${font}.ttf`]) {
      wanted.push({ font, info, face: font, file, bold });
    }

    for (const same of SAME_WIDTHS.get(font) ?? []) {
      wanted.push({ font, info, ...same, bold: [same.bold] });
    }
  }

  const files = findFiles(
    folders,
    new Set(wanted.flatMap((w) => [w.file, ...w.bold]).map((file) => file.toLowerCase())),
  );

  /** The bytes of a file found, of the family `face`, or undefined. */
  const read = (file: string, face: string): Uint8Array | undefined => {
    const path = files.get(file.toLowerCase());

    if (path === undefined) return undefined;

    try {
      const bytes = readFileSync(path);

      return familyName(bytes) === face ? bytes : undefined;
    } catch {
      return undefined;
    }
  };

  const faces = new Map<string, Face>();

  for (const { font, info, face, file, bold } of wanted) {
    if (faces.has(font)) continue;
    const bytes = read(file, face);

    if (bytes === undefined) continue;
    // The font's own file is sized as `FONTS` says the leading CAD app sizes the font. A font that
    // stands in for it is sized by its own capitals, and one that states no cap height as the font.
    const own = face === font;
    const cap = (own ? undefined : capHeight(bytes)) ?? info.capHeight ?? shippedCap();

    const found: Face = {
      family: info.family,
      face,
      file: files.get(file.toLowerCase())!,
      capHeight: cap,
    };

    const boldFile = bold.find((name) => read(name, face) !== undefined);

    if (boldFile === undefined) {
      faces.set(font, found);
      continue;
    }

    const boldBytes = read(boldFile, face)!;

    const boldCap =
      (own ? capHeightOf(font, true) : capHeight(boldBytes)) ?? info.capHeight ?? shippedCap();

    faces.set(font, {
      ...found,
      bold: { file: files.get(boldFile.toLowerCase())!, capHeight: boldCap },
    });
  }

  return faces;
}

let found: Map<string, Face> | undefined;

/** The faces this machine has, looked for once for the life of the command. */
export function faces(): ReadonlyMap<string, Face> {
  return (found ??= findFaces());
}

/** A value as `toSVG` writes it in an attribute. */
const attribute = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

/**
 * The faces a picture's PNG is set in, beside the shipped one: each face the machine has for
 * a font family the SVG names. `toPNG` sends the renderer these, and `pngFonts` reports them.
 */
export function pictureFaces(svg: string, known: ReadonlyMap<string, Face> = faces()): Face[] {
  return [...known.values()].filter(({ family }) =>
    svg.includes(` font-family="${attribute(family)}"`),
  );
}

/**
 * How the PNG of a picture sets each of its fonts.
 *
 * @param fonts - The fonts of the picture, as the build names them.
 * @param svg - The picture.
 */
export function pngFonts(
  fonts: readonly string[],
  svg: string,
  known: ReadonlyMap<string, Face> = faces(),
): PngFont[] {
  const used = pictureFaces(svg, known);

  return fonts.map((font) => {
    const family = FAMILIES.get(font);
    const face = used.find((one) => one.family === family);

    return { font, face: face?.face ?? SHIPPED.face };
  });
}

/**
 * The files a PDF embeds, by the font each sets: the faces the machine has, and the bold of each
 * by `boldFontKey` of its font.
 */
export function pdfFiles(known: ReadonlyMap<string, Face> = faces()): Record<string, string> {
  return Object.fromEntries(
    [...known].flatMap(([font, face]) => [
      [font, face.file],
      ...(face.bold ? [[boldFontKey(font), face.bold.file]] : []),
    ]),
  );
}

/** The face a PDF sets a font in with a file, by the font and the file's path, read once. */
const pdfFaces = new Map<string, string>();

/**
 * How a PDF of a picture sets each of its fonts: in the face of the file `pdfFiles` gives the PDF
 * for it, which the PDF embeds, or in the standard face `pdfFace` names for a font with no file,
 * or with one the PDF cannot embed.
 *
 * @param fonts - The fonts of the picture, as the build names them.
 */
export function pdfFonts(
  fonts: readonly string[],
  known: ReadonlyMap<string, Face> = faces(),
): PngFont[] {
  return fonts.map((font) => {
    const file = known.get(font)?.file;

    if (file === undefined) return { font, face: pdfFace(font) };
    const key = `${font}\0${file}`;
    let face = pdfFaces.get(key);

    if (face === undefined) {
      try {
        face = pdfFace(font, readFileSync(file));
      } catch {
        face = pdfFace(font);
      }

      pdfFaces.set(key, face);
    }

    return { font, face };
  });
}
