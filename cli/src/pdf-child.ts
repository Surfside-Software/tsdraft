// The process that plots pictures of layouts to one PDF for the command. `pdf.ts` starts one
// for each plot and ends it once it has answered, or at its deadline, so a plot too large for
// its time or for the machine's memory ends this process alone.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { svgToPDF } from "tsdraft";

/** What the process is asked. */
export interface PdfRequest {
  readonly pictures: readonly string[];
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
process.once("message", ({ pictures }: PdfRequest) => {
  let answer: PdfAnswer;
  try {
    const missing: string[] = pictures.map(() => "");
    const pdf = svgToPDF(pictures, {
      deflate: (bytes) => deflateSync(bytes),
      missing: (_layout, characters, page) => (missing[page] = characters),
    });
    answer = { pdf, missing };
  } catch (error) {
    answer = { error: (error as Error).message };
  }
  process.send!(answer);
});
