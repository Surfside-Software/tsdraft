// The layout of a paragraph text a file holds, by the one layout of a paragraph: from its width,
// attachment, line spacing and value, in its style's font or the font of `FONTS` nearest it.
import { nearestFont } from "../fonts.ts";
import {
  attachmentPlace,
  layoutParagraph,
  measureParagraph,
  type ParagraphLayout,
  type ParagraphMeasure,
  type ParagraphToMeasure,
} from "../paragraphs.ts";
import type { ReadMtext, ReadTextStyle } from "./model.ts";

/**
 * A read MTEXT as `layoutParagraph` takes it: in the font of `FONTS` nearest its style's, with
 * its style's width factor and oblique angle. `exact` is false when the font is not the
 * style's own, or the attachment is not one of 1 to 9, which is then taken as 1.
 */
export function mtextToMeasure(
  mtext: ReadMtext,
  style?: Pick<ReadTextStyle, "font" | "family" | "widthFactor" | "oblique">,
): { readonly paragraph: ParagraphToMeasure; readonly exact: boolean } {
  const font = nearestFont(style?.family ?? style?.font ?? "");
  const place = attachmentPlace(mtext.attachment);
  const paragraph: ParagraphToMeasure = {
    value: mtext.value,
    height: mtext.height,
    width: mtext.width,
    font: font.font,
    widthFactor: style?.widthFactor ?? 1,
    obliqueAngle: style?.oblique ?? 0,
    at: mtext.at,
    rotation: mtext.rotation,
    align: place?.align ?? "left",
    valign: place?.valign ?? "top",
    lineSpacing: mtext.lineSpacing,
    lineSpacingStyle: mtext.lineSpacingStyle,
    ...(mtext.columns && { columns: mtext.columns }),
  };
  return { paragraph, exact: font.exact && place !== undefined };
}

/**
 * Lays a read MTEXT out as tsdraft lays out a paragraph, in its style, which the caller finds by
 * the MTEXT's `style`. Its layout is `approximate` when its font or its attachment is not one
 * tsdraft knows.
 */
export function layoutMtext(
  mtext: ReadMtext,
  style?: Pick<ReadTextStyle, "font" | "family" | "widthFactor" | "oblique">,
): ParagraphLayout {
  const { paragraph, exact } = mtextToMeasure(mtext, style);
  const layout = layoutParagraph(paragraph);
  return exact ? layout : { ...layout, approximate: true };
}

/** Measures a read MTEXT as `measureParagraph` measures a paragraph, in its style. */
export function measureMtext(
  mtext: ReadMtext,
  style?: Pick<ReadTextStyle, "font" | "family" | "widthFactor" | "oblique">,
): ParagraphMeasure {
  const { paragraph, exact } = mtextToMeasure(mtext, style);
  const measure = measureParagraph(paragraph);
  return exact ? measure : { ...measure, approximate: true };
}
