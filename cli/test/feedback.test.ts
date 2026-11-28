// Agent feedback: `tsdraft feedback` and the `feedback` tool of `tsdraft mcp`, run as an agent runs
// them, each with a home, a config and a feedback folder of its own and a local endpoint where one
// is wanted. Whatever a report's texts hold, only `{ id, kind, subject, tsdraft }` may be posted.
import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { hostname, userInfo } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkPayload,
  decodeReport,
  endpointOf,
  FeedbackRefusal,
  payloadOf,
  versionOf,
} from "../src/feedback.ts";
import { sendingStopped } from "../src/feedback-mode.ts";
import { isString, type Json, type JsonObject } from "../src/guards.ts";
import { inScratch } from "./scratch.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const linux = process.platform === "linux";
const linuxOnly = { skip: !linux && "the state folder's path is Linux's here" };

/** What the environment may hold that would change these runs, which each run leaves out. */
const OUTSIDE =
  /^(CI|GITHUB_ACTIONS|GITLAB_CI|CIRCLECI|TRAVIS|BUILDKITE|JENKINS_URL|TEAMCITY_VERSION|TF_BUILD|BITBUCKET_BUILD_NUMBER|CODEBUILD_BUILD_ID|DRONE|APPVEYOR|DO_NOT_TRACK|TSDRAFT_.*|XDG_CONFIG_HOME|XDG_STATE_HOME|NODE_OPTIONS|NODE_USE_ENV_PROXY|(?:HTTPS?|NO|ALL)_PROXY|(?:https?|no|all)_proxy)$/;

/** Environment variables, by name. */
interface Env {
  [name: string]: string;
}

/** A run's environment: its own home, config and feedback folders, with `extra` over them. */
function envFor(dir: string, extra: Env = {}): Env {
  const kept: Env = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !OUTSIDE.test(name)) kept[name] = value;
  }

  return {
    ...kept,
    HOME: join(dir, "home"),
    XDG_CONFIG_HOME: join(dir, "config"),
    TSDRAFT_FEEDBACK_DIR: join(dir, "feedback"),
    ...extra,
  };
}

/** tsdraft's state folder in the scratch folder's home, where the hour's count lives. */
const stateOf = (dir: string) => join(dir, "home", ".local", "state", "tsdraft");

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `node <args>` in the scratch folder, as an agent's shell does, without blocking. */
async function run(dir: string, args: readonly string[], extra: Env = {}): Promise<Run> {
  const child = spawn(process.execPath, args, {
    cwd: dir,
    env: envFor(dir, extra),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  const code = await new Promise<number | null>((done) => child.once("close", done));

  return { code, stdout, stderr };
}

/** Runs `tsdraft feedback` with `args`. */
async function feedback(dir: string, args: readonly string[], extra: Env = {}): Promise<Run> {
  return run(dir, [cli, "feedback", ...args], extra);
}

/** The JSON a run printed. */
function jsonOf(stdout: string): JsonObject {
  // SAFETY: the command prints one JSON object, which each test reads field by field.
  return JSON.parse(stdout) as JsonObject;
}

/** Each report saved in the scratch folder's feedback folder, as written. */
function savedTexts(dir: string): string[] {
  let names: string[];

  try {
    names = readdirSync(join(dir, "feedback"));
  } catch {
    return [];
  }

  return names.map((n) => readFileSync(join(dir, "feedback", n), "utf8"));
}

function saved(dir: string): JsonObject[] {
  // SAFETY: the reports are what the command wrote, which the tests check field by field.
  return savedTexts(dir).map((text) => JSON.parse(text) as JsonObject);
}

interface Posted {
  readonly body: JsonObject;
  readonly raw: string;
  readonly headers: IncomingHttpHeaders;
}

/** A local endpoint that answers `status` and keeps what it was sent. */
async function withEndpoint(
  use: (url: string, posted: Posted[], answer: (status: number) => void) => Promise<void>,
): Promise<void> {
  const posted: Posted[] = [];
  let status = 204;

  const server = createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (raw += chunk));

    request.on("end", () => {
      // SAFETY: the command posts one JSON object, which each test reads.
      posted.push({ body: JSON.parse(raw) as JsonObject, raw, headers: request.headers });
      response.writeHead(status).end();
    });
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  // SAFETY: a server listening on a TCP port has an address with its port.
  const { port } = server.address() as AddressInfo;

  try {
    await use(`http://127.0.0.1:${port}/feedback`, posted, (s) => (status = s));
  } finally {
    server.close();
  }
}

/** A text an agent could write that names a firm's client, address and file. */
const FIRM_TEXT = "Client: North West, 17 Oak Lane, plans/WestWing.dwg";

const REPORT = [
  "--kind",
  "confusing",
  "--subject",
  "render",
  "--expected",
  FIRM_TEXT,
  "--actual",
  FIRM_TEXT,
  "--workaround",
  FIRM_TEXT,
];

const PAYLOAD_KEYS = ["id", "kind", "subject", "tsdraft"];
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** Every header a send carries, none of which names the machine. */
const HEADERS = new Set(["host", "connection", "content-type", "content-length"]);

/** Holds that what was posted is the four fields alone, with nothing of the firm or the machine. */
function onlyCategories(posted: Posted, id: Json | undefined, kind: string, subject: string): void {
  assert.deepEqual(Object.keys(posted.body).sort(), PAYLOAD_KEYS);
  assert.deepEqual(posted.body, { id, kind, subject, tsdraft: posted.body.tsdraft });
  assert.match(String(posted.body.tsdraft), VERSION);

  const all = `${posted.raw}\n${JSON.stringify(Object.values(posted.headers))}`;

  for (const word of ["North West", "Oak Lane", "WestWing", hostname(), userInfo().username]) {
    assert.equal(all.includes(word), false, word);
  }

  for (const name of Object.keys(posted.headers)) assert.ok(HEADERS.has(name), name);
}

test("feedback is off by default: the command says how to turn it on and keeps nothing", async () => {
  await inScratch(async (dir) => {
    const off = await feedback(dir, REPORT);
    assert.equal(off.code, 1);
    assert.match(off.stderr, /tsdraft feedback mode on/);
    assert.equal(off.stdout, "");
    assert.deepEqual(saved(dir), []);

    const mode = jsonOf((await feedback(dir, ["mode"])).stdout);
    assert.deepEqual([mode.mode, mode.from], ["off", "default"]);

    // The saved copies may be listed at any time.
    assert.match((await feedback(dir, ["list"])).stdout, /No reports/);
  });
});

/** A hook that notes each module of feedback a process loads, other than the mode's. */
function loadHook(dir: string): string {
  const hook = join(dir, "hook.mjs");

  writeFileSync(
    hook,
    `import { registerHooks } from "node:module";
registerHooks({ load(url, context, next) {
  if (/\\/feedback\\.ts$/.test(url)) process.stderr.write("LOADED " + url + "\\n");
  return next(url, context);
} });
`,
  );

  return hook;
}

test("with feedback off, the command loads nothing of it beyond the mode", async () => {
  await inScratch(async (dir) => {
    const hook = loadHook(dir);
    const off = await run(dir, ["--import", hook, cli, "feedback", ...REPORT]);
    assert.equal(off.code, 1);
    assert.doesNotMatch(off.stderr, /LOADED/);

    // On, it loads it: the hook sees what it is meant to.
    const on = await run(dir, ["--import", hook, cli, "feedback", ...REPORT], {
      TSDRAFT_FEEDBACK: "on",
    });

    assert.match(on.stderr, /LOADED .*\/feedback\.ts/);
  });
});

test("feedback mode writes the config, and TSDRAFT_FEEDBACK wins over it", async () => {
  await inScratch(async (dir) => {
    const set = await feedback(dir, ["mode", "on"]);
    assert.equal(set.code, 0, set.stderr);
    assert.equal(jsonOf(set.stdout).file, join(dir, "config", "tsdraft", "feedback.json"));
    assert.deepEqual(
      JSON.parse(readFileSync(join(dir, "config", "tsdraft", "feedback.json"), "utf8")),
      { mode: "on" },
    );
    assert.equal(jsonOf((await feedback(dir, ["mode"])).stdout).mode, "on");

    const env = jsonOf((await feedback(dir, ["mode"], { TSDRAFT_FEEDBACK: "off" })).stdout);
    assert.deepEqual([env.mode, env.from], ["off", "TSDRAFT_FEEDBACK"]);
    assert.equal((await feedback(dir, REPORT, { TSDRAFT_FEEDBACK: "off" })).code, 1);

    // A value that is no mode is off, and says so. The modes of before are gone.
    const wrong = await feedback(dir, REPORT, { TSDRAFT_FEEDBACK: "auto" });
    assert.equal(wrong.code, 1);
    assert.match(wrong.stderr, /TSDRAFT_FEEDBACK is off, on or unset/);

    for (const args of [
      ["mode", "auto"],
      ["mode", "on-request"],
      ["mode", "on", "now"],
    ]) {
      assert.equal((await feedback(dir, args)).code, 64, args.join(" "));
    }
  });
});

test("on, the command sends the four fields alone, and the firm's text stays in the copy", async () => {
  await inScratch(async (dir) => {
    await withEndpoint(async (url, posted) => {
      const sent = await feedback(dir, REPORT, {
        TSDRAFT_FEEDBACK: "on",
        TSDRAFT_FEEDBACK_URL: url,
      });

      assert.equal(sent.code, 0, sent.stderr);
      const receipt = jsonOf(sent.stdout);
      assert.deepEqual([receipt.status, receipt.sent], ["sent", true]);
      assert.equal(posted.length, 1);
      onlyCategories(posted[0]!, receipt.id, "confusing", "render");
      assert.deepEqual(receipt.payload, posted[0]!.body);
      assert.equal(sent.stdout.includes("North West"), false);

      const [copy] = saved(dir);
      assert.deepEqual(
        [copy?.expected, copy?.actual, copy?.workaround, copy?.status],
        [FIRM_TEXT, FIRM_TEXT, FIRM_TEXT, "sent"],
      );
      assert.equal(receipt.saved, join(dir, "feedback", `${String(receipt.id)}.json`));

      // The mode set by the command does the same.
      await feedback(dir, ["mode", "on"]);
      const config = await feedback(dir, REPORT, { TSDRAFT_FEEDBACK_URL: url });
      assert.equal(config.code, 0, config.stderr);
      onlyCategories(posted[1]!, jsonOf(config.stdout).id, "confusing", "render");
    });
  });
});

test("DO_NOT_TRACK, TSDRAFT_TELEMETRY=0 and CI send nothing and keep the report", async () => {
  await inScratch(async (dir) => {
    await withEndpoint(async (url, posted) => {
      const cases: [Env, RegExp][] = [
        [{ DO_NOT_TRACK: "1" }, /DO_NOT_TRACK/],
        [{ TSDRAFT_TELEMETRY: "0" }, /TSDRAFT_TELEMETRY/],
        [{ CI: "true" }, /CI/],
        [{ GITHUB_ACTIONS: "true" }, /CI/],
      ];

      for (const [extra, reason] of cases) {
        const env = { TSDRAFT_FEEDBACK: "on", TSDRAFT_FEEDBACK_URL: url, ...extra };
        const done = await feedback(dir, REPORT, env);
        assert.equal(done.code, 0, done.stderr);
        const receipt = jsonOf(done.stdout);
        assert.equal(receipt.sent, false);
        assert.match(String(receipt.reason), reason);
      }

      assert.equal(posted.length, 0);
      assert.equal(saved(dir).length, cases.length);
      assert.ok(saved(dir).every((r) => r.status === "not sent" && r.expected === FIRM_TEXT));
    });
  });
});

test("DO_NOT_TRACK counts for any value but empty, 0 and false, as CI does", () => {
  assert.notEqual(sendingStopped({ DO_NOT_TRACK: "1" }), null);
  assert.notEqual(sendingStopped({ DO_NOT_TRACK: "yes" }), null);
  assert.equal(sendingStopped({ DO_NOT_TRACK: "0" }), null);
  assert.equal(sendingStopped({ DO_NOT_TRACK: "false" }), null);
  assert.equal(sendingStopped({ DO_NOT_TRACK: "" }), null);
  assert.notEqual(sendingStopped({ TSDRAFT_TELEMETRY: "off" }), null);
  assert.notEqual(sendingStopped({ CI: "1" }), null);
  assert.equal(sendingStopped({ CI: "false" }), null);
  assert.equal(sendingStopped({}), null);
});

test("TSDRAFT_FEEDBACK_URL may name this machine alone, by number, over http", async () => {
  assert.match(String(endpointOf({})), /no feedback endpoint yet/);

  for (const url of ["http://127.0.0.1:4100/feedback", "http://[::1]:8080/"]) {
    assert.ok(endpointOf({ TSDRAFT_FEEDBACK_URL: url }) instanceof URL, url);
  }

  for (const url of [
    "http://localhost/feedback",
    "http://localhost:4100/",
    "https://localhost/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "http://example.com/feedback",
    "http://10.0.0.1/",
    "http://127.0.0.2/",
    "http://0.0.0.0/",
    "http://127.0.0.1.example.com/",
    "http://localhost.example.com/",
    "http://127.0.0.1/feedback?client=north-west",
    "http://127.0.0.1/feedback?",
    "http://me:secret@127.0.0.1/",
    "http://me@127.0.0.1/",
    "http://127.0.0.1@example.com/",
    "http://127.0.0.1/#north-west",
    "ftp://127.0.0.1/",
    "file:///tmp/feedback",
    "not a url",
  ]) {
    const got = endpointOf({ TSDRAFT_FEEDBACK_URL: url });
    assert.ok(isString(got) && /may only name this machine/.test(got), url);
  }

  // A refused URL sends nothing, even to a server on this machine.
  await inScratch(async (dir) => {
    await withEndpoint(async (url, posted) => {
      const port = new URL(url).port;

      for (const given of [
        `${url}?client=north-west`,
        url.replace("http://", "http://me:x@"),
        `http://localhost:${port}/feedback`,
        `https://127.0.0.1:${port}/feedback`,
      ]) {
        const done = await feedback(dir, REPORT, {
          TSDRAFT_FEEDBACK: "on",
          TSDRAFT_FEEDBACK_URL: given,
        });

        const receipt = jsonOf(done.stdout);
        assert.deepEqual([receipt.sent, receipt.status], [false, "not sent"], given);
        assert.match(String(receipt.reason), /may only name this machine/);
      }

      assert.equal(posted.length, 0);
    });
  });
});

test("the payload's version is the leading major.minor.patch, else unknown, so it has four fields", () => {
  const report = {
    id: "00000000-0000-4000-8000-000000000000",
    kind: "bug",
    subject: "lint",
  } as const;

  for (const [given, sent] of [
    ["0.6.0", "0.6.0"],
    ["123.456.789", "123.456.789"],
    ["0.6.0-beta.1", "0.6.0"],
    ["0.6.0+build.7", "0.6.0"],
    ["0.6.0 North West", "0.6.0"],
    ["1.2.3.4", "1.2.3"],
    [undefined, "unknown"],
    ["", "unknown"],
    ["0.6", "unknown"],
    ["1000.0.0", "unknown"],
    ["0.6.1000", "unknown"],
    ["v0.6.0", "unknown"],
    ["North West 0.6.0", "unknown"],
  ] as const) {
    assert.equal(versionOf(given), sent, String(given));
    const payload = payloadOf(report, given);
    assert.deepEqual(payload, { ...report, tsdraft: sent });
    checkPayload(payload);
  }
});

test("every payload is checked against the four fields before it is posted", () => {
  const payload = {
    id: "00000000-0000-4000-8000-000000000000",
    kind: "bug",
    subject: "lint",
    tsdraft: "0.6.0",
  };

  checkPayload(payload);
  checkPayload({ ...payload, tsdraft: "unknown" });
  const { tsdraft: _, ...noVersion } = payload;

  for (const wrong of [
    noVersion,
    { ...payload, tsdraft: "0.6.0-beta.1" },
    { ...payload, expected: "x" },
    { ...payload, harness: "codex" },
    { ...payload, runtime: "node" },
    { ...payload, tsdraft: "0.6.0 North West" },
    { ...payload, id: "north-west" },
    { ...payload, kind: "rant" },
    { ...payload, subject: "north-west" },
  ]) {
    assert.throws(() => checkPayload(wrong), FeedbackRefusal, JSON.stringify(wrong));
  }
});

test("the report's decoder refuses what is not on its lists and drops unknown fields", () => {
  assert.deepEqual(
    decodeReport({ kind: "bug", subject: "tsdraft render", actual: "  x  ", client: "North West" }),
    { kind: "bug", subject: "render", actual: "x" },
  );
  assert.deepEqual(
    decodeReport({ kind: "bug", subject: "lint", actual: "é".repeat(300) }).actual,
    "é".repeat(300),
  );

  for (const wrong of [
    null,
    [],
    "bug",
    { kind: "rant", subject: "render" },
    { kind: "bug", subject: "north-west" },
    { kind: "bug" },
    { kind: "bug", subject: "lint", actual: "x".repeat(301) },
    { kind: "bug", subject: "lint", expected: 3 },
  ]) {
    assert.throws(() => decodeReport(wrong), FeedbackRefusal, JSON.stringify(wrong));
  }
});

test("the command refuses a kind, a subject, a text or a flag out of place, with exit 64", async () => {
  await inScratch(async (dir) => {
    const on = { TSDRAFT_FEEDBACK: "on" };

    for (const args of [
      ["--kind", "rant", "--subject", "render"],
      ["--kind", "bug", "--subject", "my-client-job"],
      ["--kind", "bug"],
      ["--kind", "bug", "--subject", "lint", "--actual", "x".repeat(301)],
      ["--kind", "bug", "--subject", "lint", "--width", "3"],
      ["--kind", "bug", "--subject", "lint", "--json"],
      ["list", "--kind", "bug"],
      ["render", "--json"],
      ["send", "00000000-0000-4000-8000-000000000000"],
      ["send"],
    ]) {
      assert.equal((await feedback(dir, args, on)).code, 64, args.join(" "));
    }

    // There is no send <id>, with feedback off too.
    assert.equal((await feedback(dir, ["send", "00000000-0000-4000-8000-000000000000"])).code, 64);
    assert.deepEqual(saved(dir), []);
  });
});

test("a send that fails is recorded in the copy, list shows it, and it is not tried again", async () => {
  await inScratch(async (dir) => {
    const none = await feedback(dir, REPORT, { TSDRAFT_FEEDBACK: "on" });
    const unsent = jsonOf(none.stdout);
    assert.deepEqual([unsent.status, unsent.sent], ["not sent", false]);
    assert.match(String(unsent.reason), /no feedback endpoint yet/);

    let failed: JsonObject = {};
    let gone = "";

    await withEndpoint(async (url, posted, answer) => {
      const extra = { TSDRAFT_FEEDBACK: "on", TSDRAFT_FEEDBACK_URL: url };
      answer(503);
      const done = await feedback(dir, REPORT, extra);
      assert.equal(done.code, 0, done.stderr);
      failed = jsonOf(done.stdout);
      assert.deepEqual([failed.status, failed.sent], ["failed", false]);
      assert.match(String(failed.reason), /503/);
      // One try, with the run over: nothing more is posted.
      assert.equal(posted.length, 1);
      gone = url;
    });

    // An endpoint that is gone fails at once, and is recorded too.
    const unreached = jsonOf(
      (
        await feedback(dir, REPORT, {
          TSDRAFT_FEEDBACK: "on",
          TSDRAFT_FEEDBACK_URL: gone,
        })
      ).stdout,
    );

    assert.deepEqual(
      [unreached.status, unreached.reason],
      ["failed", "the endpoint could not be reached"],
    );

    const copy = saved(dir).find((r) => r.id === failed.id);
    assert.deepEqual([copy?.status, copy?.expected], ["failed", FIRM_TEXT]);
    assert.match(String(copy?.reason), /503/);

    const list = await feedback(dir, ["list"]);
    assert.match(list.stdout, new RegExp(`${String(failed.id)}\\s+failed\\s+confusing\\s+render`));
    assert.match(
      list.stdout,
      new RegExp(`${String(unsent.id)}\\s+not sent\\s+confusing\\s+render`),
    );
    // SAFETY: list --json prints an array of the saved reports.
    const listed = JSON.parse((await feedback(dir, ["list", "--json"])).stdout) as JsonObject[];
    assert.equal(listed.length, 3);
    assert.ok(listed.every((r) => r.expected === FIRM_TEXT));

    // A file in the folder that is not a report of tsdraft's is passed over.
    writeFileSync(join(dir, "feedback", "00000000-0000-4000-8000-00000000000f.json"), "{}");

    // SAFETY: list --json prints an array of the saved reports.
    assert.equal(
      (JSON.parse((await feedback(dir, ["list", "--json"])).stdout) as JsonObject[]).length,
      3,
    );
  });
});

/** Fills the machine's hour with reports, in the state folder of the scratch folder's home. */
function fillHour(dir: string): void {
  mkdirSync(stateOf(dir), { recursive: true });
  const now = Date.now();

  writeFileSync(
    join(stateOf(dir), "feedback-hour.json"),
    JSON.stringify(Array.from({ length: 10 }, (_, i) => now - i)),
  );
}

test(
  "the hour's limit holds across runs, and a new feedback folder does not reset it",
  linuxOnly,
  async () => {
    await inScratch(async (dir) => {
      fillHour(dir);

      for (const folder of ["feedback", "elsewhere"]) {
        const done = await feedback(dir, REPORT, {
          TSDRAFT_FEEDBACK: "on",
          TSDRAFT_FEEDBACK_DIR: join(dir, folder),
        });

        assert.equal(done.code, 1);
        assert.match(done.stderr, /10 reports in the last hour/);
      }

      assert.deepEqual(saved(dir), []);
    });
  },
);

test(
  "the hour's limit is approximate: one at a time it holds at 10, and a burst lets at least 10 through",
  linuxOnly,
  async () => {
    await inScratch(async (dir) => {
      const extra = { TSDRAFT_FEEDBACK: "on" };
      const hour = join(stateOf(dir), "feedback-hour.json");
      mkdirSync(stateOf(dir), { recursive: true });
      const now = Date.now();
      // Nine this hour, and one from more than an hour ago, which no longer counts.
      writeFileSync(
        hour,
        JSON.stringify([now - 3_700_000, ...Array.from({ length: 9 }, (_, i) => now - i)]),
      );

      assert.equal((await feedback(dir, REPORT, extra)).code, 0);
      const tenth = await feedback(dir, REPORT, extra);
      assert.equal(tenth.code, 1);
      assert.match(tenth.stderr, /about 10 reports in the last hour/);

      // From an empty hour, 14 runs at once: no lock, so a few more may pass, never fewer.
      writeFileSync(hour, "[]");

      const runs = await Promise.all(
        Array.from({ length: 14 }, async () => feedback(dir, REPORT, extra)),
      );

      const passed = runs.filter((r) => r.code === 0).length;
      assert.ok(passed >= 10, `${passed} passed`);
      assert.ok(runs.filter((r) => r.code !== 0).every((r) => /last hour/.test(r.stderr)));

      // The file is always whole, as each run writes a file of its own and renames it; a run may
      // write over another's time, which is why the limit is approximate.
      // SAFETY: the hour's file is the array of times the runs wrote.
      const times = JSON.parse(readFileSync(hour, "utf8")) as number[];
      assert.ok(times.length >= 1 && times.length <= passed, String(times.length));
      assert.deepEqual(readdirSync(stateOf(dir)), ["feedback-hour.json"]);
    });
  },
);

test("the send goes straight to the target, never through a proxy from the environment", async () => {
  await inScratch(async (dir) => {
    let proxied = 0;

    const proxy = createServer((_request, response) => {
      proxied++;
      response.writeHead(204).end();
    });

    proxy.on("connect", (_request, socket: { destroy: () => void }) => {
      proxied++;
      socket.destroy();
    });
    await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
    // SAFETY: a server listening on a TCP port has an address with its port.
    const { port } = proxy.address() as AddressInfo;

    try {
      await withEndpoint(async (url, posted) => {
        const done = await feedback(dir, REPORT, {
          TSDRAFT_FEEDBACK: "on",
          TSDRAFT_FEEDBACK_URL: url,
          NODE_USE_ENV_PROXY: "1",
          HTTP_PROXY: `http://127.0.0.1:${port}`,
          http_proxy: `http://127.0.0.1:${port}`,
        });

        assert.equal(done.code, 0, done.stderr);
        assert.equal(jsonOf(done.stdout).sent, true);
        assert.equal(posted.length, 1);
        onlyCategories(posted[0]!, jsonOf(done.stdout).id, "confusing", "render");
      });
    } finally {
      proxy.close();
    }

    assert.equal(proxied, 0);
  });
});

/** One line the server wrote, as JSON-RPC. */
interface Line {
  readonly id?: number | string | null;
  readonly result?: {
    readonly content?: readonly { readonly type: string; readonly text?: string }[];
    readonly isError?: boolean;
    readonly tools?: readonly {
      readonly name: string;
      readonly annotations?: JsonObject;
      readonly description?: string;
      readonly inputSchema?: JsonObject;
    }[];
    readonly instructions?: string;
  };
  readonly error?: { readonly code: number; readonly message: string };
}

interface Server {
  readonly ask: (method: string, params?: JsonObject) => Promise<Line>;
  /** Asks each of `calls` in one write to the server's input. */
  readonly burst: (calls: readonly JsonObject[]) => Promise<Line>[];
  /** The ids of the answers, in the order the server wrote them. */
  readonly order: (number | string | null | undefined)[];
}

/** Starts `tsdraft mcp` in the scratch folder, initialized, for `use`. */
async function withServer(
  dir: string,
  extra: Env,
  options: { nodeOptions?: readonly string[]; stderr?: (text: string) => void },
  use: (server: Server) => Promise<void>,
): Promise<void> {
  const child: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    [...(options.nodeOptions ?? []), cli, "mcp"],
    { cwd: dir, env: envFor(dir, extra), stdio: ["pipe", "pipe", "pipe"] },
  );

  child.stderr.setEncoding("utf8").on("data", (text: string) => options.stderr?.(text));
  const waiting = new Map<number | string, (line: Line) => void>();
  const order: (number | string | null | undefined)[] = [];
  const write = (value: JsonObject) => void child.stdin.write(`${JSON.stringify(value)}\n`);
  let next = 0;

  const ask = async (method: string, params: JsonObject = {}) => {
    const id = ++next;
    const answer = new Promise<Line>((resolve) => waiting.set(id, resolve));
    write({ jsonrpc: "2.0", id, method, params });

    return answer;
  };

  const burst = (calls: readonly JsonObject[]) => {
    const ids = calls.map(() => ++next);
    const answers = ids.map(async (id) => new Promise<Line>((resolve) => waiting.set(id, resolve)));

    const lines = calls.map(
      (params, i) =>
        `${JSON.stringify({ jsonrpc: "2.0", id: ids[i], method: "tools/call", params })}\n`,
    );

    child.stdin.write(lines.join(""));

    return answers;
  };

  createInterface({ input: child.stdout }).on("line", (text) => {
    // SAFETY: every line on stdout is JSON-RPC, which each test reads.
    const line = JSON.parse(text) as Line;
    order.push(line.id);

    if (line.id !== undefined && line.id !== null) waiting.get(line.id)?.(line);
  });

  try {
    await ask("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "North West test harness", version: "0" },
    });

    write({ jsonrpc: "2.0", method: "notifications/initialized" });
    await use({ ask, burst, order });
  } finally {
    child.stdin.end();
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

/** What the tool answered: its receipt, or why it refused. */
interface ToolAnswer {
  readonly json: JsonObject;
  readonly isError: boolean;
  readonly text: string;
}

function receiptOf(reply: Line): ToolAnswer {
  assert.equal(reply.error, undefined, JSON.stringify(reply.error));
  const text = reply.result?.content?.[0]?.text ?? "";
  const isError = reply.result?.isError === true;

  // SAFETY: the tool answers with its receipt as JSON, or with why it refused as text.
  return { json: isError ? {} : (JSON.parse(text) as JsonObject), isError, text };
}

async function report(server: Server, args: JsonObject): Promise<ToolAnswer> {
  return receiptOf(await server.ask("tools/call", { name: "feedback", arguments: args }));
}

const FIRM_REPORT = {
  kind: "missing_capability",
  subject: "execute",
  expected: FIRM_TEXT,
  actual: FIRM_TEXT,
  workaround: FIRM_TEXT,
};

test("off: the server lists no feedback tool, mentions none and loads nothing of it", async () => {
  await inScratch(async (dir) => {
    let stderr = "";

    const options = {
      nodeOptions: ["--import", loadHook(dir)],
      stderr: (text: string) => (stderr += text),
    };

    await withServer(dir, {}, options, async (server) => {
      const tools = await server.ask("tools/list");
      assert.deepEqual(
        tools.result?.tools?.map((t) => t.name),
        ["render", "execute"],
      );

      const again = await server.ask("initialize", { protocolVersion: "2025-06-18" });
      assert.doesNotMatch(again.result?.instructions ?? "", /feedback/);

      const call = await server.ask("tools/call", {
        name: "feedback",
        arguments: { kind: "bug", subject: "render" },
      });

      assert.equal(call.error?.code, -32602);
      assert.deepEqual(saved(dir), []);
    });

    assert.doesNotMatch(stderr, /LOADED/);

    stderr = "";
    await withServer(dir, { TSDRAFT_FEEDBACK: "on" }, options, async (server) => {
      await server.ask("tools/list");
    });

    assert.match(stderr, /LOADED .*\/feedback\.ts/);
  });
});

test("on over MCP: the tool sends the four fields alone, and the firm's text stays in the copy", async () => {
  await inScratch(async (dir) => {
    await withEndpoint(async (url, posted) => {
      const extra = { TSDRAFT_FEEDBACK: "on", TSDRAFT_FEEDBACK_URL: url };

      await withServer(dir, extra, {}, async (server) => {
        const tools = await server.ask("tools/list");
        const tool = tools.result?.tools?.find((t) => t.name === "feedback");
        assert.deepEqual(tool?.annotations, {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        });
        assert.match(tool?.description ?? "", /are never sent/);
        assert.doesNotMatch(JSON.stringify(tool?.inputSchema), /userRequested/);

        const init = await server.ask("initialize", { protocolVersion: "2025-06-18" });
        assert.match(init.result?.instructions ?? "", /call feedback/);

        const { json } = await report(server, { ...FIRM_REPORT, unknown: "dropped" });
        assert.equal(json.sent, true);
        assert.equal(posted.length, 1);
        onlyCategories(posted[0]!, json.id, "missing_capability", "execute");
        assert.deepEqual(json.payload, posted[0]!.body);
        assert.equal(JSON.stringify(json).includes("North West"), false);

        const [text] = savedTexts(dir);
        assert.ok(text?.includes(FIRM_TEXT));
        assert.equal(text?.includes("dropped"), false);
        assert.equal(text?.includes("test harness"), false);

        await report(server, { kind: "bug", subject: "render" });
        await report(server, { kind: "bug", subject: "render" });
        const fourth = await report(server, { kind: "bug", subject: "render" });
        assert.equal(fourth.isError, true);
        assert.match(fourth.text, /already filed 3 reports/);
        assert.equal(posted.length, 3);
        assert.equal(savedTexts(dir).length, 3);
      });

      // An opt-out holds over MCP too, and the copy is kept.
      await withServer(dir, { ...extra, DO_NOT_TRACK: "1" }, {}, async (server) => {
        const { json } = await report(server, FIRM_REPORT);
        assert.equal(json.sent, false);
        assert.match(String(json.reason), /DO_NOT_TRACK/);
      });

      assert.equal(posted.length, 3);
    });
  });
});

test("four feedback calls in one write file 3, as the session's limit is taken before any wait", async () => {
  await inScratch(async (dir) => {
    await withEndpoint(async (url, posted) => {
      await withServer(
        dir,
        { TSDRAFT_FEEDBACK: "on", TSDRAFT_FEEDBACK_URL: url },
        {},
        async (server) => {
          const call = { name: "feedback", arguments: { kind: "bug", subject: "render" } };

          const answers = (await Promise.all(server.burst([call, call, call, call]))).map(
            receiptOf,
          );

          assert.equal(answers.filter((a) => a.json.sent === true).length, 3);

          const refused = answers.filter((a) => a.isError);
          assert.equal(refused.length, 1);
          assert.match(refused[0]!.text, /already filed 3 reports/);
        },
      );

      assert.equal(posted.length, 3);
      assert.equal(new Set(posted.map((p) => p.body.id)).size, 3);
      assert.equal(saved(dir).length, 3);
    });
  });
});

test("feedback turned off after the server started is read again before the POST, which is not made", async () => {
  await inScratch(async (dir) => {
    await withEndpoint(async (url, posted) => {
      assert.equal((await feedback(dir, ["mode", "on"])).code, 0);

      await withServer(dir, { TSDRAFT_FEEDBACK_URL: url }, {}, async (server) => {
        const tools = await server.ask("tools/list");
        assert.ok(tools.result?.tools?.some((t) => t.name === "feedback"));
        assert.equal((await feedback(dir, ["mode", "off"])).code, 0);

        const { json } = await report(server, FIRM_REPORT);
        assert.deepEqual([json.sent, json.status], [false, "not sent"]);
        assert.match(String(json.reason), /off now/);
      });

      assert.equal(posted.length, 0);
      const [copy] = saved(dir);
      assert.deepEqual([copy?.status, copy?.expected], ["not sent", FIRM_TEXT]);
      assert.match(String(copy?.reason), /off now/);
    });
  });
});
