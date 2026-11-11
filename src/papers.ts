// The paper a layout may have, and the plot style tables its page setup may name. This is the
// one list of each: `lint`, the writers and `toSVG` all read it.
import type { PaperUnit } from "./paper.ts";

/** What tsdraft knows of a paper size. */
export interface PaperInfo {
  /** The name AutoCAD stores for the size in a page setup for `DWG To PDF.pc3`. */
  readonly media: string;
  /** The unit of the size, and of everything drawn on a layout of this paper. */
  readonly units: PaperUnit;
  /** The width of the sheet, which is its longer side. */
  readonly width: number;
  readonly height: number;
  /**
   * The part of the sheet the plotter prints on, as its lower-left and upper-right corners
   * from the sheet's lower-left corner: `[left, bottom, right, top]`. A full-bleed size prints
   * to every edge.
   */
  readonly printable: readonly [left: number, bottom: number, right: number, top: number];
}

/**
 * Every paper a layout may have. Each is a size that AutoCAD's `DWG To PDF.pc3` offers as full
 * bleed, with no margin the plotter keeps clear, and landscape, with the longer side across.
 * The list is closed because a page setup names its paper by the name the plotter gives it,
 * and AutoCAD plots a layout whose paper the plotter does not have on another size.
 */
export const PAPERS = {
  "ARCH A": inches("ARCH_full_bleed_A_(12.00_x_9.00_Inches)", 12, 9),
  "ARCH B": inches("ARCH_full_bleed_B_(18.00_x_12.00_Inches)", 18, 12),
  "ARCH C": inches("ARCH_full_bleed_C_(24.00_x_18.00_Inches)", 24, 18),
  "ARCH D": inches("ARCH_full_bleed_D_(36.00_x_24.00_Inches)", 36, 24),
  "ANSI A": inches("ANSI_full_bleed_A_(11.00_x_8.50_Inches)", 11, 8.5),
  "ANSI B": inches("ANSI_full_bleed_B_(17.00_x_11.00_Inches)", 17, 11),
  "ANSI C": inches("ANSI_full_bleed_C_(22.00_x_17.00_Inches)", 22, 17),
  "ANSI D": inches("ANSI_full_bleed_D_(34.00_x_22.00_Inches)", 34, 22),
} as const satisfies Readonly<Record<string, PaperInfo>>;

function inches<M extends string, W extends number, H extends number>(
  media: M,
  width: W,
  height: H,
) {
  return { media, units: "in", width, height, printable: [0, 0, width, height] } as const;
}

/** The name of a paper a layout may have. */
export type Paper = keyof typeof PAPERS;

/** What tsdraft knows of a paper, or undefined for a name that is not in `PAPERS`. */
export function paperInfo(name: string): PaperInfo | undefined {
  return Object.hasOwn(PAPERS, name) ? PAPERS[name as Paper] : undefined;
}

/**
 * The plot style tables a layout's page setup may name, which are color-dependent tables that
 * AutoCAD installs. `monochrome.ctb` plots every color in black, and `acad.ctb` plots each in
 * its own color. Both plot a line at the lineweight it has.
 */
export const PLOT_STYLE_TABLES = ["monochrome.ctb", "acad.ctb"] as const;

/** The name of a plot style table a layout may have. */
export type PlotStyleTable = (typeof PLOT_STYLE_TABLES)[number];

/** The plot style table of a layout that names none. */
export const DEFAULT_PLOT_STYLE_TABLE: PlotStyleTable = "monochrome.ctb";

/** The plotter of every layout's page setup, by the name of its configuration file. */
export const PLOTTER = "DWG To PDF.pc3";

const MM_PER_INCH = 25.4;

/**
 * A paper length in millimetres as AutoCAD holds it in a page setup: the nearest number that
 * fits in four bytes, which for 36 inches is 914.4000244140625.
 */
export function paperMillimetres(length: number, units: PaperUnit): number {
  return Math.fround(units === "in" ? length * MM_PER_INCH : length);
}

/** A length a page setup holds in millimetres, in the paper's units. */
export function fromMillimetres(length: number, units: PaperUnit): number {
  return units === "in" ? length / MM_PER_INCH : length;
}
