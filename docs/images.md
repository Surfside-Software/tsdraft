# Images

An image is a raster file, a PNG or a JPEG, drawn at a size in drawing units: an aerial under a
site plan, a vicinity map, a logo in a title block, a standard detail kept as a picture. The
drawing holds the file's path and its size in pixels, and nothing of what it shows. CAD programs
load the file each time they open the drawing. In the file it is an `IMAGE`, with the file's
definition, an `IMAGEDEF`, which every image of that file shares.

Images are R2018 only. The builder and `lint` refuse one in an R12 drawing.

## Drawing one

`d.image(path, at, options)` places the file at `path` with its lower-left corner at `at`, `width`
drawing units wide. `pixels` are the file's own width and height in pixels, which `rasterSize`
reads from its bytes. Its height defaults to the width times the file's height over its width,
so its pixels are square:

```ts
import { readFileSync } from "node:fs";
import { createDrawing, rasterSize } from "tsdraft";

const pixels = rasterSize(readFileSync("aerial.png"))!;
const d = createDrawing({ units: "ft" });
d.layer("C-IMAG", { color: 8 }, () => {
  d.image("aerial.png", [-50, -40], { pixels, width: 400 });
});
```

`path` starts from the folder of the drawing's file, with `\` or `/` between folders, such as
`"aerial.png"` or `"../survey/aerial.png"`. The writers write it with `\`, as CAD programs save
one. An absolute path is refused: a CAD program looks for its file there and nowhere else, so on
another machine it finds none.

`pixels` must be the file's. A CAD program draws the file's own pixels at the size each pixel has
in the drawing, so an image whose file has other pixels plots at the wrong size, and cut.
`toSVG`, `toPDF` and `tsdraft render` refuse such a file.

`height` stretches the image, and `rotation` turns it about its lower-left corner, in degrees
counterclockwise. In a block, an insert's scale and rotation place it as they place the rest of
the block, and a negative scale mirrors it.

Each file is written once, as one definition that every image of it names, with `\` and `/` taken
as one. Two images of one file must give it the same `pixels`. The definition is named by the
file's name without its extension, with a number after it where another file took the name
first. A drawing cannot hold a definition no image uses: [reading](reading.md) has the ones a
file holds.

## Clipping

`clip` hides what lies outside an outline, in the drawing's coordinates. Two points are opposite
corners of a rectangle along the image's sides; three or more are a polygon, which the writers
close. Points outside the image are kept: the image shows inside both its outline and the clip.

```ts
// The part of the aerial around the lot.
d.image("aerial.png", [-50, -40], {
  pixels,
  width: 400,
  clip: [
    [-20, -20],
    [180, 160],
  ],
});
```

On a turned image the two corners are taken along its sides, so they name a rectangle turned with
it. `invertClip: true` shows the image outside the clip and hides what the clip holds.

A CAD program paints the part of a clip that reaches past its image white, which hides what is
drawn before the image there. `toSVG` and `toPDF` leave that part unpainted.

## Frames, transparency and order

Each image has a frame: its outline, or its clip's, past the image too, or the hole alone for an
inverted clip, drawn in the image's layer, color and lineweight after the image. `imageFrame:
false` on the drawing hides every frame, in the plot too, as a sheet with a logo or an aerial
wants.

A PNG's transparent pixels show what is behind them only with `transparent: true`. Without it the
image is opaque, and a transparent pixel plots in the color the file gives it. A JPEG has no
transparency.

An image hides what is drawn before it and is hidden by what is drawn after it, in the order of
the drawing. Draw an aerial first, and the linework over it.

## Plotting

`toSVG` and `toPDF` draw an image from its file's bytes, given as `images`, by the image's path
exactly as the drawing gives it:

```ts
const images = { "aerial.png": new Uint8Array(readFileSync("aerial.png")) };
toSVG(drawing, { layout: "C-101", images });
toPDF(drawing, { images, deflate: zlib.deflateSync });
```

The picture holds each file once, as a data URL, and the PDF holds it once as it is: a JPEG, and a
PNG with no transparency to show, as their own data, and any other PNG decoded, with its
transparency as a soft mask. A browser drops the colors of a pixel with no alpha, which CAD
programs plot for an image not marked `transparent`, so the picture holds a PNG with transparency
again without it for such an image: the file without its `tRNS` chunk, or for an alpha channel
its colors decoded and stored uncompressed. A PNG with an alpha channel of more than 4,194,304
pixels is held as it is instead, its pixels with no alpha see-through in the picture, and the PDF
plots it opaque. A JPEG is drawn as its pixels are stored, whatever its EXIF says, as
CAD programs plot it. An image whose file is not given, or is neither a PNG nor a JPEG, is drawn
as a CAD program draws one whose file it cannot find: its frame, with its path written inside it.

An xref's images take their files from the xref's own, whose paths start from its drawing's
folder, never from the sheet's: give them with the drawing, as `{ drawing, images }` among
`xrefs`. Without them, an xref's images are drawn as images whose files are missing.

```ts
toSVG(sheet, { images, xrefs: { BASE: { drawing: base, images: baseImages } } });
```

`tsdraft render` and `tsdraft dev` read each image's file from the drawing file's folder, and warn
of one that is missing. Its pixels must be the file's, or the build reports an error and draws
the frame.

## What lint refuses

- A path that is empty, absolute, longer than 32,000 characters, or that holds `* ? < > | : "`, a
  multibyte escape or a character a text cannot hold.
- `pixels` that are not two whole numbers from 1 to 2,147,483,647, and two images of one file with
  other pixels.
- A width or a height that is not greater than 0 as written.
- A clip of fewer than 2 points or more than 10,000, a rectangle of no width or no height in the
  image's axes, a polygon of fewer than 3 points that differ, and `invertClip` with no clip.
- An image in an R12 drawing.

Brightness, contrast and fade are always written as CAD programs set them for a new image: 50, 50
and 0. A file that sets other values reads them, and its plot draws the image without them.
