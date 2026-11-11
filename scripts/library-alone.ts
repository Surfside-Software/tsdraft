// Proves that the built library stands alone: `import "tsdraft"` loads no Node module, no
// package and nothing of the command, so the library can run where there is no Node. Given the
// folder of the built library, it holds every .js file there to three things.
//
// 1. The engine's own parse lists each static import, and each must be a built file beside it.
// 2. The text has no `import` that is not a static one, so no dynamic import at all, and none of
//    the names Node code reaches for. This reads comments and strings too, and is strict on
//    purpose: a false alarm costs a rewording.
// 3. The library is loaded and used in a context with no Node globals, where a dynamic import
//    throws and no code can be made from a string, and builds, checks and writes a drawing there.
//
// Run by scripts/package-smoke.ts, with --experimental-vm-modules and
// --disallow-code-generation-from-strings.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const dist = process.argv[2]!;
const names = readdirSync(dist).filter((name) => name.endsWith(".js"));
assert.ok(names.includes("index.js"), `${dist} has no index.js`);

// The context is a browser's, not Node's: what the language itself defines, and the two globals
// of a browser that honest library code may use. No process, no Buffer, no require. Code made
// from a string would be a way back to Node, through the function constructor, so the context
// refuses it, and the flag this runs with refuses it for the objects handed in from outside.
assert.throws(() => new Function("return 1"), "run with --disallow-code-generation-from-strings");
const context = vm.createContext(Object.assign(Object.create(null), { TextEncoder, URL }), {
  codeGeneration: { strings: false, wasm: false },
});
for (const way of ["globalThis.constructor", "URL", "(() => {})"]) {
  assert.throws(
    () => vm.runInContext(`${way}.constructor("return this")()`, context),
    `${way} can make code from a string`,
  );
}
const refuse = (specifier: string): never => {
  throw new Error(`the library imported ${specifier} while it ran`);
};
const modules = new Map<string, vm.SourceTextModule>();
for (const name of names) {
  const source = readFileSync(join(dist, name), "utf8");
  const other = /\bimport\b(?!\s+[\w$*{"'])/.exec(source);
  assert.equal(other, null, `${name} has an import that is not a static one, at ${other?.index}`);
  const reached =
    /\b(require|process|Buffer|__dirname|__filename|setImmediate|clearImmediate)\b|\bglobal\./.exec(
      source,
    );
  assert.equal(reached, null, `${name} names ${reached?.[0]}`);
  modules.set(
    `./${name}`,
    new vm.SourceTextModule(source, {
      identifier: name,
      context,
      importModuleDynamically: refuse,
    }),
  );
}

const link = (specifier: string, from: vm.Module): vm.Module => {
  const found = modules.get(specifier);
  assert.ok(found, `${from.identifier} imports ${specifier}, which is not a file of the library`);
  return found;
};
// Every file, also one that index.js does not reach. Linking one links what it imports.
for (const module of modules.values()) {
  if (module.status === "unlinked") await module.link(link);
  await module.evaluate();
}

const use = new vm.SourceTextModule(
  `import { createDrawing, DASHED, fromJSON, lint, toDXF, toJSON, toSVG } from "./index.js";
   const d = createDrawing({ units: "ft" });
   d.layer("A-WALL", { color: 4, linetype: DASHED, lineweight: 0.5 }, () => {
     d.rect([0, 0], 10, 5, { id: "room" });
     d.circle([5, 2.5], 1);
     d.arc([0, 0], 2, 0, 90);
     d.polyline([[0, 0], [3, 4], [6, 0]]);
     d.text([1, 1], "ROOM", { height: 0.5 });
   });
   const drawing = d.build();
   const again = fromJSON(toJSON(drawing));
   export default [lint(drawing).length, toSVG(again).slice(0, 4), toDXF(again).slice(-5), again.entities.length];`,
  { identifier: "use.js", context, importModuleDynamically: refuse },
);
await use.link(link);
await use.evaluate();
const result = (use.namespace as { default: unknown[] }).default;
assert.deepEqual([...result], [0, "<svg", "EOF\r\n", 5]);
console.log(`the library stands alone: ${names.length} files, no Node module and no package`);
