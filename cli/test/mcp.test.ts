// `tsdraft mcp` is what an agent's harness talks to, so these run the command itself and speak
// MCP to it on stdin and stdout, as a harness does.
import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createDrawing, toDXF } from "tsdraft";
import type { JsonObject } from "../src/guards.ts";
import { inScratch } from "./scratch.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

/** One line the server wrote, as JSON-RPC. */
interface Reply {
  readonly id?: number | string | null;
  readonly result?: {
    readonly content?: readonly Block[];
    readonly isError?: boolean;
    readonly tools?: readonly {
      readonly name: string;
      readonly inputSchema: JsonObject;
      readonly annotations?: {
        readonly readOnlyHint?: boolean;
        readonly destructiveHint?: boolean;
      };
    }[];
    readonly protocolVersion?: string;
    readonly instructions?: string;
    readonly serverInfo?: { readonly name: string };
  };
  readonly error?: { readonly code: number; readonly message: string };
}

interface Block {
  readonly type: string;
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
}

interface Server {
  readonly ask: (method: string, params?: JsonObject) => Promise<Reply>;
  readonly write: (line: string) => void;
  /** Every line the server wrote, each parsed. */
  readonly lines: Reply[];
  readonly child: ChildProcessWithoutNullStreams;
}

/** Starts `tsdraft mcp` in `cwd`, initialized, and ends it once `use` settles. */
async function withServer(cwd: string, use: (server: Server) => Promise<void>): Promise<void> {
  const child = spawn(process.execPath, [cli, "mcp"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
  const lines: Reply[] = [];
  const waiting = new Map<number | string, (reply: Reply) => void>();

  createInterface({ input: child.stdout }).on("line", (line) => {
    // Every line on stdout is JSON-RPC: a line that is not JSON fails the test here.
    // SAFETY: what the server writes is checked by each test that reads it.
    const reply = JSON.parse(line) as Reply;
    lines.push(reply);

    if (reply.id !== undefined && reply.id !== null) waiting.get(reply.id)?.(reply);
  });

  let next = 0;
  const write = (line: string) => void child.stdin.write(`${line}\n`);

  const ask = async (method: string, params: JsonObject = {}): Promise<Reply> => {
    const id = ++next;

    return new Promise((resolve) => {
      waiting.set(id, resolve);
      write(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  };

  try {
    const init = await ask("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });

    assert.equal(init.result?.protocolVersion, "2025-06-18");
    write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    await use({ ask, write, lines, child });
  } finally {
    child.stdin.end();
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

const call = async (server: Server, name: string, args: JsonObject): Promise<readonly Block[]> => {
  const reply = await server.ask("tools/call", { name, arguments: args });
  assert.equal(reply.error, undefined, JSON.stringify(reply.error));

  return reply.result?.content ?? [];
};

/** The JSON of a tool's first block, which is always its text. */
function textOf(blocks: readonly Block[]): JsonObject {
  assert.equal(blocks[0]?.type, "text");

  // SAFETY: both tools answer with a JSON object first.
  return JSON.parse(blocks[0]?.text ?? "") as JsonObject;
}

const SHEET = `import { createDrawing } from "tsdraft";

const d = createDrawing({ units: "ft" });
d.layer("C-PROP", { color: 7 }, () => d.rect([0, 0], 100, 140));
d.layout("C-101", { paper: "ARCH D" }, (sheet) => {
  d.rect([0.5, 0.5], sheet.width - 1, sheet.height - 1);
  d.text([1, 1], "SITE PLAN", { height: 0.25 });
  d.layer("G-ANNO-NPLT", {}, () =>
    sheet.viewport([1, 2], 26, 21, { center: [50, 70], ratio: 120, id: "plan" }),
  );
});

export default d.build();
`;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test("initialize names the server, and tools/list gives render and execute", async () => {
  await inScratch(async (dir) => {
    await withServer(dir, async (server) => {
      const tools = await server.ask("tools/list");
      assert.deepEqual(
        tools.result?.tools?.map((tool) => tool.name),
        ["render", "execute"],
      );

      // Neither only reads, and a program may do anything its user may.
      assert.deepEqual(
        tools.result?.tools?.map((tool) => [
          tool.annotations?.readOnlyHint,
          tool.annotations?.destructiveHint,
        ]),
        [
          [false, false],
          [false, true],
        ],
      );

      const old = await server.ask("initialize", { protocolVersion: "1999-01-01" });
      assert.equal(old.result?.serverInfo?.name, "tsdraft");
      // A version the server does not speak is answered with its newest.
      assert.match(old.result?.protocolVersion ?? "", /^\d{4}-\d{2}-\d{2}$/);
      assert.notEqual(old.result?.protocolVersion, "1999-01-01");
      assert.match(old.result?.instructions ?? "", /GUIDE\.md/);
    });
  });
});

test("render answers with a brief and draws only the PNGs it attaches", async () => {
  await inScratch(async (dir) => {
    writeFileSync(join(dir, "sheet.ts"), SHEET);

    await withServer(dir, async (server) => {
      const blocks = await call(server, "render", { file: "sheet.ts", images: 1 });
      const brief = textOf(blocks);
      assert.equal(brief.ok, true);
      assert.equal(brief.code, 0);
      assert.equal(brief.file, "sheet.ts");
      assert.deepEqual(brief.layouts, ["C-101: ARCH D, 1 viewport"]);
      assert.equal(blocks.length, 2);
      assert.equal(blocks[1]?.mimeType, "image/png");
      assert.deepEqual(Buffer.from(blocks[1]?.data ?? "", "base64").subarray(0, 4), PNG);

      // SAFETY: the brief lists its pictures so.
      const pictures = brief.pictures as { shows: string; png: string | null; attached?: true }[];

      assert.deepEqual(
        pictures.map((p) => [p.shows, p.png !== null, p.attached === true]),
        [
          ["layout C-101", true, true],
          ["model", false, false],
        ],
      );

      // The sheet's PNG alone was rasterized.
      const out = readdirSync(join(dir, "out")).filter((f) => f.endsWith(".png"));
      assert.deepEqual(out, ["sheet.layout-C-101.png"]);

      const none = await call(server, "render", { file: "sheet.ts", images: 0 });
      assert.equal(none.length, 1);
      assert.deepEqual(
        readdirSync(join(dir, "out")).filter((f) => f.endsWith(".png")),
        [],
      );
    });
  });
});

test("render gives a diagnostic at its call, and a failed build at its line", async () => {
  await inScratch(async (dir) => {
    // Copies, so that the pictures go to the scratch folder and not beside the fixtures.
    for (const name of ["warns.ts", "throws.ts"]) {
      copyFileSync(fileURLToPath(new URL(`fixtures/${name}`, import.meta.url)), join(dir, name));
    }

    await withServer(dir, async (server) => {
      const warns = textOf(await call(server, "render", { file: "warns.ts" }));
      assert.equal(warns.code, 0);

      // SAFETY: the brief lists its diagnostics so.
      const [first] = warns.diagnostics as { severity: string; at: string; where: string }[];

      assert.equal(first?.severity, "warning");
      assert.match(first?.at ?? "", /warns\.ts:6:\d+$/);
      assert.match(first?.where ?? "", /id stub/);

      const throws = textOf(await call(server, "render", { file: "throws.ts" }));
      assert.equal(throws.ok, false);
      assert.equal(throws.code, 1);
      // SAFETY: a failed build's brief has its error so.
      assert.match((throws.error as { at: string }).at, /throws\.ts:7:\d+$/);
    });
  });
});

test("render refuses input it cannot use as the tool's own error", async () => {
  await inScratch(async (dir) => {
    await withServer(dir, async (server) => {
      for (const [args, said] of [
        [{}, /Give file/],
        [{ file: "a.ts", view: [0, 0, -1, 1] }, /view is/],
        [{ file: "a.ts", layout: "C-101" }, /layout goes with view/],
        [{ file: "a.ts", pdf: true, view: [0, 0, 1, 1] }, /pdf plots whole sheets/],
        [{ file: "a.ts", images: 9 }, /images must be/],
        [{ file: "a.ts", timeout: 600_001 }, /timeout is at most/],
      ] as const) {
        const reply = await server.ask("tools/call", { name: "render", arguments: args });
        assert.equal(reply.result?.isError, true, JSON.stringify(args));
        assert.match(reply.result?.content?.[0]?.text ?? "", said);
      }
    });
  });
});

test("execute returns only what the program returns, with what it printed and showed", async () => {
  await inScratch(async (dir) => {
    writeFileSync(join(dir, "sheet.ts"), SHEET);

    await withServer(dir, async (server) => {
      const blocks = await call(server, "execute", {
        code: [
          `const bare = await render("sheet.ts");`,
          // A program's render draws no PNG it did not ask for.
          `if (bare.outputs.layouts[0].png !== null || bare.outputs.png !== null) throw new Error("drew a PNG");`,
          `const s = await render("sheet.ts", { pngs: 1 });`,
          `console.log("built", s.ok);`,
          `show(s.outputs.layouts[0].png);`,
          `const b = brief(s);`,
          `return { scales: s.drawing.layouts[0].viewports.map((v) => v.ratio), code: b.code, measured: tsdraft.measureText({ value: "AB", height: 1 }).length > 0 };`,
        ].join("\n"),
      });

      assert.deepEqual(textOf(blocks), {
        ok: true,
        value: { scales: [120], code: 0, measured: true },
        logs: "built true\n",
      });

      assert.equal(blocks.length, 2);
      assert.equal(blocks[1]?.type, "image");
    });
  });
});

test("execute refuses a value too large, whole, and says what it held", async () => {
  await inScratch(async (dir) => {
    await withServer(dir, async (server) => {
      const big = textOf(
        await call(server, "execute", { code: `return { rows: Array(20000).fill("abcdef") };` }),
      );

      assert.equal(big.ok, false);
      // SAFETY: a failed program's answer has its error so.
      const error = big.error as { kind: string; message: string };
      assert.equal(error.kind, "TooLarge");
      assert.match(error.message, /180,\d{3} characters/);
      assert.match(error.message, /rows: Array\(20000\) of string/);
    });
  });
});

test("execute reports where a program failed, and ends one that runs too long", async () => {
  await inScratch(async (dir) => {
    await withServer(dir, async (server) => {
      const run = async (args: JsonObject) => textOf(await call(server, "execute", args)).error;

      assert.deepEqual(await run({ code: "const a = 1;\nthrow new Error('boom');" }), {
        kind: "Uncaught",
        message: "Error: boom",
        line: 2,
        column: 7,
      });

      assert.deepEqual(await run({ code: "\n\nreturn )" }), {
        kind: "SyntaxError",
        message: "SyntaxError: Unexpected token ')'",
        line: 3,
      });

      assert.equal(
        // SAFETY: a failed program's answer has its error so.
        ((await run({ code: "while (true) {}", timeout: 1000 })) as { kind: string }).kind,
        "Timeout",
      );

      // SAFETY: a failed program's answer has its error so.
      const notJson = (await run({ code: "return () => 1" })) as { kind: string };
      assert.equal(notJson.kind, "NotJSON");
    });
  });
});

test("execute runs each program in a process of its own", async () => {
  await inScratch(async (dir) => {
    await withServer(dir, async (server) => {
      const first = await call(server, "execute", { code: "globalThis.left = 1; return 1;" });
      assert.equal(textOf(first).value, 1);
      const second = await call(server, "execute", { code: "return globalThis.left ?? null;" });
      assert.equal(textOf(second).value, null);
    });
  });
});

test("execute reads a DXF with shows", async () => {
  await inScratch(async (dir) => {
    const d = createDrawing({ units: "ft" });
    d.layer("WALLS", { color: 3 }, () => d.line([0, 0], [10, 0]));
    writeFileSync(join(dir, "plan.dxf"), toDXF(d.build()));

    await withServer(dir, async (server) => {
      const answer = textOf(
        await call(server, "execute", {
          code: `const r = await shows("plan.dxf", { near: [5, 0], within: 1 });\nreturn r.entities.map((e) => [e.kind, e.layer]);`,
        }),
      );

      assert.deepEqual(answer, { ok: true, value: [["line", "WALLS"]] });
    });
  });
});

test("a cancelled program is ended and gets no answer", async () => {
  await inScratch(async (dir) => {
    await withServer(dir, async (server) => {
      const before = server.lines.length;
      const id = "long";

      server.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name: "execute", arguments: { code: "while (true) {}" } },
        }),
      );

      // The program has started once the server answers a ping sent after it.
      await server.ask("ping");
      server.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { requestId: id },
        }),
      );

      // The server still answers, and never answers the cancelled call.
      await call(server, "execute", { code: "return 2;" });
      assert.equal(
        server.lines.slice(before).some((line) => line.id === id),
        false,
      );
    });
  });
});

test("the server answers a bad message with JSON-RPC's errors, and a notification never", async () => {
  await inScratch(async (dir) => {
    await withServer(dir, async (server) => {
      const before = server.lines.length;
      server.write("{not json");
      server.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/whatever" }));
      assert.equal((await server.ask("no/such/method")).error?.code, -32601);
      assert.equal((await server.ask("tools/call", { name: "nope" })).error?.code, -32602);
      const parse = server.lines.slice(before).find((line) => line.error?.code === -32700);
      assert.equal(parse?.id, null);
      // The parse error, then the two answers: the notification got none.
      assert.equal(server.lines.length - before, 3);
    });
  });
});

test("the server ends when its input does, and leaves no program running", async (t) => {
  if (!existsSync("/proc/self")) return t.skip("no /proc to look for the process in");

  await inScratch(async (dir) => {
    let pid: unknown;

    await withServer(dir, async (server) => {
      pid = textOf(
        await call(server, "execute", {
          code: "setInterval(() => {}, 1000);\nreturn process.pid;",
        }),
      ).value;
    });

    assert.ok(Number.isInteger(pid));
    assert.equal(existsSync(`/proc/${String(pid)}`), false);
  });
});

/** The processes whose parent is `pid`, by their command lines, from /proc. */
function childrenOf(pid: number): string[] {
  return readdirSync("/proc")
    .filter((entry) => /^\d+$/.test(entry))
    .flatMap((entry) => {
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
        const parent = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);

        return parent === pid ? [readFileSync(`/proc/${entry}/cmdline`, "utf8")] : [];
      } catch {
        return [];
      }
    });
}

const settle = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the server refuses an envelope that is not JSON-RPC 2.0", async () => {
  await inScratch(async (dir) => {
    await withServer(dir, async (server) => {
      const before = server.lines.length;
      server.write(JSON.stringify({ id: "a", method: "ping" }));
      server.write(JSON.stringify({ jsonrpc: "2.0", id: null, method: "ping" }));
      server.write(JSON.stringify({ jsonrpc: "2.0", id: "b", method: "ping", params: [1] }));
      const named = await server.ask("tools/call", { name: { toString: 1 } });
      assert.equal(named.error?.code, -32602);

      assert.deepEqual(
        server.lines.slice(before, before + 3).map((line) => [line.id, line.error?.code]),
        [
          ["a", -32600],
          [null, -32600],
          ["b", -32600],
        ],
      );
    });
  });
});

test("a failed build and a failed program are the tool's errors", async () => {
  await inScratch(async (dir) => {
    copyFileSync(
      fileURLToPath(new URL("fixtures/throws.ts", import.meta.url)),
      join(dir, "throws.ts"),
    );

    await withServer(dir, async (server) => {
      const built = await server.ask("tools/call", {
        name: "render",
        arguments: { file: "throws.ts" },
      });

      assert.equal(built.result?.isError, true);

      const ran = await server.ask("tools/call", {
        name: "execute",
        arguments: { code: "throw 1" },
      });

      assert.equal(ran.result?.isError, true);

      const fine = await server.ask("tools/call", {
        name: "execute",
        arguments: { code: "return 1" },
      });

      assert.equal(fine.result?.isError, undefined);
    });
  });
});

test("show keeps the picture as it was when shown", async () => {
  await inScratch(async (dir) => {
    writeFileSync(join(dir, "sheet.ts"), SHEET);

    await withServer(dir, async (server) => {
      const blocks = await call(server, "execute", {
        code: [
          `const s = await render("sheet.ts", { pngs: 1 });`,
          `show(s.outputs.layouts[0].png);`,
          // This build writes no PNG, and takes the one shown away.
          `await render("sheet.ts", { pngs: 0 });`,
          `return 1;`,
        ].join("\n"),
      });

      assert.equal(textOf(blocks).ok, true);
      assert.equal(blocks[1]?.type, "image");
    });
  });
});

test("programs at once, and one cancelled as it starts, leave one process waiting", async (t) => {
  if (!existsSync("/proc/self/stat")) return t.skip("no /proc to count the processes in");

  await inScratch(async (dir) => {
    await withServer(dir, async (server) => {
      const pid = server.child.pid!;

      server.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "gone",
          method: "tools/call",
          params: {
            name: "execute",
            arguments: {
              code: `const fs = await import("node:fs");\nfs.writeFileSync("ran", "");`,
            },
          },
        }),
      );

      server.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { requestId: "gone" },
        }),
      );

      const answers = await Promise.all(
        [1, 2, 3, 4].map(async (n) =>
          textOf(await call(server, "execute", { code: `return ${n};` })),
        ),
      );

      assert.deepEqual(
        answers.map((answer) => answer.value),
        [1, 2, 3, 4],
      );

      await settle(500);
      const programs = childrenOf(pid).filter((command) => command.includes("program."));
      assert.equal(programs.length, 1, programs.join("\n"));
      assert.equal(existsSync(join(dir, "ran")), false);
    });
  });
});

test("a program that never yields ends with the server", async (t) => {
  if (!existsSync("/proc/self/stat")) return t.skip("no /proc to look for the process in");

  await inScratch(async (dir) => {
    const child = spawn(process.execPath, [cli, "mcp"], {
      cwd: dir,
      stdio: ["pipe", "ignore", "ignore"],
    });

    const write = (message: JsonObject) =>
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

    write({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });

    write({
      id: 2,
      method: "tools/call",
      params: {
        name: "execute",
        arguments: {
          code: `const fs = await import("node:fs");\nfs.writeFileSync("pid", String(process.pid));\nfor (;;) {}`,
        },
      },
    });

    const file = join(dir, "pid");

    for (let i = 0; i < 100 && !existsSync(file); i++) await settle(100);
    const pid = readFileSync(file, "utf8");
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));

    for (let i = 0; i < 30 && existsSync(`/proc/${pid}`); i++) await settle(100);
    assert.equal(existsSync(`/proc/${pid}`), false);
  });
});

test("a program's log keeps its end, however much it printed", async () => {
  await inScratch(async (dir) => {
    await withServer(dir, async (server) => {
      const answer = textOf(
        await call(server, "execute", {
          code: `process.stdout.write("x".repeat(8 * 1024 * 1024));\nconsole.log("THE END");\nreturn 1;`,
        }),
      );

      assert.equal(answer.value, 1);
      assert.match(String(answer.logs), /THE END\n$/);
    });
  });
});
