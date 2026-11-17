// The process that plots pictures of layouts to one PDF for the command. `pdf.ts` starts one
// for each plot and ends it once it has answered, or at its deadline, so a plot too large for
// its time or for the machine's memory ends this process alone.
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { svgToPDF } from "tsdraft";

/** What the process is asked: the pictures, and the font file to embed for each font, by path. */
export interface PdfRequest {
  readonly pictures: readonly string[];
  readonly fonts: Readonly<Record<string, string>>;
}

/**
 * What the process answers: the PDF and the characters each page lacks, by its place in the
 * pictures, or why there is none.
 */
export type PdfAnswer =
  | { readonly pdf: Uint8Array; readonly missing: readonly string[] }
  | { readonly error: string };

// Where the machine runs short of memory, the kernel ends this process before the command.
try {
  writeFileSync("/proc/self/oom_score_adj", "1000");
} catch {
  // Not Linux, or not allowed: the heap's cap and the library's byte caps still hold.
}

// The command ends this process once it has the answer; it ends itself if the command goes.
process.once("disconnect", () => process.exit(0));
process.once("message", ({ pictures, fonts }: PdfRequest) => {
  let answer: PdfAnswer;
  try {
    const missing: string[] = pictures.map(() => "");
    // A file that cannot be read now is not embedded, and its font is set in a standard face.
    const files: Record<string, Uint8Array> = {};
    for (const [font, path] of Object.entries(fonts)) {
      try {
        files[font] = readFileSync(path);
      } catch {}
    }
    const pdf = svgToPDF(pictures, {
      fonts: files,
      deflate: (bytes) => deflateSync(bytes),
      missing: (_layout, characters, page) => (missing[page] = characters),
    });
    answer = { pdf, missing };
  } catch (error) {
    answer = { error: (error as Error).message };
  }
  process.send!(answer);
});
