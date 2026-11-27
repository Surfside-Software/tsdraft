// The frame the command gives a model-space picture, which `tsdraft/png` gives it too.

/** An SVG with the margin `toSVG` gives by default, and the extents of what it draws. */
export interface Framed {
  readonly svg: string;
  readonly min: [number, number];
  readonly max: [number, number];
}

/**
 * Reads the extents from an SVG drawn with no margin, then gives it the margin `toSVG` uses by
 * default, 2% of the larger side, so one render serves both.
 */
export function framed(svg: string): Framed {
  const box = /viewBox="([^"]+)"/.exec(svg);
  const [x = 0, y = 0, w = 1, h = 1] = (box?.[1] ?? "").split(" ").map(Number);
  const m = Math.max(w, h, 1) * 0.02;
  const round = (n: number) => Number(n.toFixed(6));
  const viewBox = [x - m, y - m, w + m * 2, h + m * 2].map(round).join(" ");

  return {
    svg: svg.replace(/viewBox="[^"]+"/, `viewBox="${viewBox}"`),
    // The SVG flips Y, so its top edge is the drawing's highest point.
    min: [round(x), round(-y - h)],
    max: [round(x + w), round(-y)],
  };
}
