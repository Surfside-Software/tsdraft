// The paper a layout may have, and the plot style tables its page setup may name. This is the
// one list of each: `lint`, the writers and `toSVG` all read it.
import type { PaperUnit } from "./paper.ts";

/** What tsdraft knows of a paper size. */
export interface PaperInfo {
  /** The name AutoCAD stores for the size in a page setup for `DWG To PDF.pc3`. */
  readonly media: string;
  /** The unit of the size, and of everything drawn on a layout of this paper. */
  readonly units: PaperUnit;
  /** The width of a layout of this paper, which is its longer side. */
  readonly width: number;
  readonly height: number;
  /**
   * The medium as the plotter holds it, which the page setup stores: its width and height, and
   * the plot's rotation on it, as DXF group 73 holds it. 0 plots the layout as it is, on a medium
   * as wide as the layout. 1 turns it a quarter turn onto a medium held upright, as AutoCAD's own
   * landscape page setup on that medium does, and the PDF shows the page turned back, landscape.
   */
  readonly medium: {
    readonly width: number;
    readonly height: number;
    readonly rotation: 0 | 1;
  };
  /**
   * The part of the sheet the plotter prints on, as its lower-left and upper-right corners
   * from the sheet's lower-left corner: `[left, bottom, right, top]`. A full-bleed size prints
   * to every edge.
   */
  readonly printable: readonly [left: number, bottom: number, right: number, top: number];
}

/**
 * Every paper a layout may have. Each is a size that AutoCAD's `DWG To PDF.pc3` offers as full
 * bleed, with no margin the plotter keeps clear, and a layout of each is landscape, with the
 * longer side across. The plotter holds `ARCH E` upright, so its plot is turned a quarter turn
 * onto it. The list is closed because a page setup names its paper by the name the plotter
 * gives it, and AutoCAD plots a layout whose paper the plotter does not have on another size.
 */
export const PAPERS = {
  "ARCH A": inches("ARCH_full_bleed_A_(12.00_x_9.00_Inches)", 12, 9),
  "ARCH B": inches("ARCH_full_bleed_B_(18.00_x_12.00_Inches)", 18, 12),
  "ARCH C": inches("ARCH_full_bleed_C_(24.00_x_18.00_Inches)", 24, 18),
  "ARCH D": inches("ARCH_full_bleed_D_(36.00_x_24.00_Inches)", 36, 24),
  "ARCH E": inches("ARCH_full_bleed_E_(36.00_x_48.00_Inches)", 48, 36, 1),
  "ANSI A": inches("ANSI_full_bleed_A_(11.00_x_8.50_Inches)", 11, 8.5),
  "ANSI B": inches("ANSI_full_bleed_B_(17.00_x_11.00_Inches)", 17, 11),
  "ANSI C": inches("ANSI_full_bleed_C_(22.00_x_17.00_Inches)", 22, 17),
  "ANSI D": inches("ANSI_full_bleed_D_(34.00_x_22.00_Inches)", 34, 22),
} as const satisfies Readonly<Record<string, PaperInfo>>;

/** A paper in inches, `width` across the layout, on a medium the plot turns `rotation` onto. */
function inches<M extends string, W extends number, H extends number>(
  media: M,
  width: W,
  height: H,
  rotation: 0 | 1 = 0,
) {
  const medium =
    rotation === 0 ? { width, height, rotation } : { width: height, height: width, rotation };
  return { media, units: "in", width, height, medium, printable: [0, 0, width, height] } as const;
}

/** The name of a paper a layout may have. */
export type Paper = keyof typeof PAPERS;

/** What tsdraft knows of a paper, or undefined for a name that is not in `PAPERS`. */
export function paperInfo(name: string): PaperInfo | undefined {
  return Object.hasOwn(PAPERS, name) ? PAPERS[name as Paper] : undefined;
}

/**
 * The plot style tables a layout's page setup may name, which are color-dependent tables that
 * AutoCAD installs. `monochrome.ctb` plots every color in black, `acad.ctb` each in its own
 * color, `Grayscale.ctb` each in a gray of its own, and `DWF Virtual Pens.ctb` each in the color
 * of its pen. Each but `DWF Virtual Pens.ctb` plots a line at the lineweight it has; that one
 * plots every line 0.254 mm wide.
 */
export const PLOT_STYLE_TABLES = [
  "monochrome.ctb",
  "acad.ctb",
  "Grayscale.ctb",
  "DWF Virtual Pens.ctb",
] as const;

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

/**
 * The strip the plotter keeps clear at each edge of the medium, `[left, bottom, right, top]` in
 * the paper's units, as the page setup holds them: in the medium's own orientation. A plot
 * turned onto a medium held upright puts the layout's bottom edge on the medium's left and the
 * layout's left edge at the medium's top.
 */
export function mediumMargins(
  paper: PaperInfo,
): readonly [left: number, bottom: number, right: number, top: number] {
  const [left, bottom, right, top] = paper.printable;
  const margins = [left, bottom, paper.width - right, paper.height - top] as const;
  if (paper.medium.rotation === 0) return margins;
  return [margins[1], margins[2], margins[3], margins[0]];
}

/** A length a page setup holds in millimetres, in the paper's units. */
export function fromMillimetres(length: number, units: PaperUnit): number {
  return units === "in" ? length / MM_PER_INCH : length;
}
