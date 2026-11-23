// Reads a DXF of more than 500 MB, the example sheet's model space repeated, and prints how many
// bytes it read, whether the census stopped at its limit, the largest heap seen at a chunk, the
// size of its answer as JSON, and with `--geometry` how many entities model space kept.
// test/read.test.ts runs it in a process with the heap of a read.
import sheet from "../examples/site-plan.ts";
import { readDXF, toDXF } from "../src/index.ts";

const encoder = new TextEncoder();
let heap = 0;

async function* large(): AsyncGenerator<Uint8Array> {
  const text = toDXF(sheet);
  const start = text.indexOf("\nENTITIES\r\n") + "\nENTITIES\r\n".length;
  const end = text.indexOf("\n0\r\nENDSEC\r\n", start) + 1;
  const entities = encoder.encode(text.slice(start, end).repeat(200));
  yield encoder.encode(text.slice(0, start));

  for (let total = 0; total < 520e6; total += entities.length) {
    heap = Math.max(heap, process.memoryUsage().heapUsed);
    yield entities;
  }

  yield encoder.encode(text.slice(end));
}

const geometry = process.argv.includes("--geometry");
const read = await readDXF(large(), { geometry });

heap = Math.max(heap, process.memoryUsage().heapUsed);

const answer = new TextEncoder().encode(JSON.stringify(read)).length;
const kept = read.model.entities?.length ?? 0;
const past = read.model.other?.["past the limit"] ?? 0;

console.log(
  JSON.stringify({ bytes: read.bytes, capped: read.model.census.capped, heap, answer, kept, past }),
);
