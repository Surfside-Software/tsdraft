// `tsdraft mcp`: the command as an MCP server on stdin and stdout, for an agent whose harness
// speaks MCP. Two tools: `render`, which builds a drawing file and answers with its brief and its
// pictures as images, and `execute`, which runs a program over the same builds and reads and
// answers with only what the program returns. The drawing files stay on disk, written with the
// agent's own tools, and the rest of the command stays the command.
import { type ChildProcess, fork } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { BRIEF_DIAGNOSTICS, brief, type Brief } from "./brief.ts";
import { Builder } from "./build.ts";
import type { Feedback } from "./feedback.ts";
import { feedbackMode } from "./feedback-mode.ts";
import { isBoolean, isNumber, isObject, isString, type Json, type JsonObject } from "./guards.ts";
import {
  type CallValue,
  type ProgramAnswer,
  type ProgramCall,
  type ProgramError,
  type ProgramRequest,
  PNG_LIMIT,
  RESULT_LIMIT,
  SHOW_LIMIT,
} from "./program.ts";
import { render, type Rendered } from "./render.ts";

/**
 * The versions of MCP this server speaks, newest first. All of them have tools and images, and
 * none has batches: 2025-03-26, which has them, is not offered.
 */
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2024-11-05"];

/** The pictures `render` attaches unless it is asked for another number. */
const DEFAULT_IMAGES = 2;

/** The end of what a program printed that its answer keeps. */
const LOG_LIMIT = 4_000;

const DEFAULT_TIMEOUT = 10_000;
const BUILD_TIMEOUT_MAX = 600_000;
const PROGRAM_TIMEOUT = 120_000;
const PROGRAM_TIMEOUT_MAX = 600_000;

// Beside this file: TypeScript in a checkout, JavaScript in the published package.
const here = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
const programPath = new URL(`./program${here}`, import.meta.url);
const guidePath = fileURLToPath(new URL("../../GUIDE.md", import.meta.url));

type Id = string | number;

/** The fields of an object the client sent, each as JSON gave it. */
type Fields = ReadonlyMap<string, unknown>;

/** A request the client sent, or a notification when it has no id. */
interface Message {
  readonly id?: Id;
  readonly method: string;
  readonly params: Fields;
}

type Reply =
  | { readonly id: Id | null; readonly result: JsonObject }
  | { readonly id: Id | null; readonly error: { readonly code: number; readonly message: string } };

type Content =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

type ToolResult = { readonly content: readonly Content[]; readonly isError?: boolean };

/** A tool's input that cannot be used, said to the agent as the tool's own error. */
class InputError extends Error {}

/** The options of one render, as the tool or a program gives them. */
interface RenderInput {
  readonly view?: readonly [number, number, number, number];
  readonly layout?: string;
  readonly drawNoPlot: boolean;
  readonly pdf: boolean;
  readonly width: number;
  readonly timeout: number;
  readonly reader?: string;
  /** How many PNGs to draw, in the order of a brief's pictures. Every one when not given. */
  readonly pngs?: number;
}

export async function serve(): Promise<void> {
  const cwd = process.cwd();
  // stdout is the protocol's. Whatever else would print there goes to stderr.
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = process.stderr.write.bind(process.stderr);
  // A client that has gone has closed the pipe: the server goes too.
  process.stdout.on("error", () => process.exit(0));

  const send = (message: Reply): void => {
    write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  };

  // Read once, when the server starts. With feedback off nothing more of it is loaded or read.
  const loaded = feedbackMode().mode === "off" ? undefined : await import("./feedback.ts");
  const feedback = loaded && { module: loaded, session: new loaded.Feedback({ via: "mcp" }) };

  const builds = new Builds();
  const programs = new Programs(builds, cwd);
  /** What stops a request in flight, by its id, for `notifications/cancelled`. */
  const cancels = new Map<Id, () => void>();

  const answer = async ({ id, method, params }: Message): Promise<void> => {
    if (method === "notifications/cancelled") {
      const cancelled = params.get("requestId");

      if (isString(cancelled) || isNumber(cancelled)) cancels.get(cancelled)?.();

      return;
    }

    // A notification is never answered.
    if (id === undefined) return;

    const reply = (result: JsonObject) => send({ id, result });
    const fail = (code: number, text: string) => send({ id, error: { code, message: text } });

    switch (method) {
      case "initialize": {
        const asked = params.get("protocolVersion");

        return reply({
          protocolVersion:
            isString(asked) && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0]!,
          capabilities: { tools: {} },
          serverInfo: { name: "tsdraft", version: packageVersion() },
          instructions: feedback
            ? `${instructions(cwd)}\n\n${feedback.module.FEEDBACK_INSTRUCTIONS}`
            : instructions(cwd),
        });
      }

      case "ping":
        return reply({});

      case "tools/list":
        return reply({
          tools: feedback ? [...tools(cwd), feedback.module.feedbackTool()] : tools(cwd),
        });

      case "tools/call": {
        const name = params.get("name");
        const args = fieldsOf(params.get("arguments"));

        if (name === "feedback" && feedback) {
          return reply(await feedbackCall(feedback.session, args, feedback.module));
        }

        if (name !== "render" && name !== "execute") {
          return fail(-32602, `Unknown tool: ${JSON.stringify(name ?? null)}`);
        }

        const token: Token = { cancelled: false };

        cancels.set(id, () => {
          token.cancelled = true;
          builds.stop(token);
          programs.cancel(id);
        });

        try {
          const result =
            name === "render"
              ? await renderTool(builds, args, cwd, token)
              : await programs.run(id, args);

          if (!token.cancelled) reply(result);
        } catch (error) {
          if (token.cancelled) return;

          if (error instanceof InputError) {
            return reply({ content: [{ type: "text", text: error.message }], isError: true });
          }

          return fail(-32603, error instanceof Error ? error.message : String(error));
        } finally {
          cancels.delete(id);
        }

        return;
      }

      default:
        return fail(-32601, `Method not found: ${method}`);
    }
  };

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

  lines.on("line", (line) => {
    if (line.trim() === "") return;
    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch {
      return send({ id: null, error: { code: -32700, message: "Parse error" } });
    }

    const message = fieldsOf(parsed);
    const method = message.get("method");
    const given = message.get("id");
    const params = message.get("params");
    // An id is a string or a number. A request with any other is answered as invalid.
    const id = isString(given) || isNumber(given) ? given : undefined;

    // A response to a request of ours: the server sends none, so there is none to take.
    if (method === undefined && (message.has("result") || message.has("error"))) return;

    if (
      message.get("jsonrpc") !== "2.0" ||
      !isString(method) ||
      (message.has("id") && id === undefined) ||
      (params !== undefined && (!isObject(params) || Array.isArray(params)))
    ) {
      return send({ id: id ?? null, error: { code: -32600, message: "Invalid Request" } });
    }

    answer({ method, params: fieldsOf(params), ...(id !== undefined && { id }) }).catch(
      (error: unknown) => {
        if (id === undefined) return;
        const text = error instanceof Error ? error.message : String(error);
        send({ id, error: { code: -32603, message: text } });
      },
    );
  });

  // The children end with the server, however it ends.
  const end = () => {
    programs.close();
    builds.close();
  };

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      end();
      process.exit(0);
    });
  }

  await new Promise<void>((done) => lines.once("close", done));
  end();
}

function fieldsOf(value: unknown): Fields {
  return new Map(isObject(value) && !Array.isArray(value) ? Object.entries(value) : []);
}

/** Whether the request a piece of work is for was cancelled, or its program ended. */
interface Token {
  cancelled: boolean;
}

/** The build running, by the token of what asked for it, and the builder it runs in. */
interface Running {
  readonly token: Token;
  builder?: Builder;
}

/** A build that was not started, because what asked for it was cancelled first. */
class Skipped extends Error {}

/**
 * The builders, kept between calls so that a build after the first finds a process waiting with
 * the library loaded, as `tsdraft dev` does. Builds run one at a time.
 */
class Builds {
  #warm: { key: string; builder: Builder } | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #running: Running | undefined;

  /**
   * Builds and writes the pictures of `file`, a path from the working folder, and gives what
   * `use` makes of it. `use` runs before the next build starts, so the pictures it reads are
   * this build's. A build whose token was cancelled before its turn does not start.
   */
  async render<T>(
    file: string,
    input: RenderInput,
    token: Token,
    use: (rendered: Rendered) => T,
  ): Promise<T> {
    const run = this.#queue.then(async () => {
      if (token.cancelled) throw new Skipped("Cancelled before it started");
      const running: Running = { token };
      this.#running = running;

      try {
        return use(await this.#render(realpath(resolve(file)), input, running));
      } finally {
        this.#running = undefined;
      }
    });

    this.#queue = run.catch(() => {});

    return run;
  }

  /** Stops the build `token` asked for, when it is the one running, so the next need not wait. */
  stop(token: Token): void {
    if (this.#running?.token === token) this.#running.builder?.cancel();
  }

  async #render(file: string, input: RenderInput, running: Running): Promise<Rendered> {
    const common = {
      timeout: input.timeout,
      drawNoPlot: input.drawNoPlot,
      ...(input.reader !== undefined && { reader: input.reader }),
    };

    const options = {
      width: input.width,
      pdf: input.pdf,
      ...(input.pngs !== undefined && { pngs: input.pngs }),
    };

    // A view is drawn by a builder of its own, as `render --view` draws it.
    if (input.view) {
      const builder = new Builder({
        ...common,
        warm: false,
        view:
          input.layout === undefined
            ? { box: input.view }
            : { box: input.view, layout: input.layout },
      });

      running.builder = builder;

      try {
        return await render(file, { ...options, builder, closeBuilder: true, view: input.view });
      } finally {
        builder.close();
      }
    }

    const key = JSON.stringify(common);

    if (this.#warm?.key !== key) {
      this.#warm?.builder.close();
      this.#warm = { key, builder: new Builder({ ...common, warm: true }) };
    }

    running.builder = this.#warm.builder;

    return render(file, { ...options, builder: this.#warm.builder, closeBuilder: false });
  }

  close(): void {
    this.#warm?.builder.close();
    this.#warm = undefined;
  }
}

async function renderTool(
  builds: Builds,
  args: Fields,
  cwd: string,
  token: Token,
): Promise<ToolResult> {
  const file = args.get("file");

  if (!isString(file) || file === "")
    throw new InputError("Give file: the path of a drawing file.");
  const input = renderInput(args);
  const images = args.get("images") ?? DEFAULT_IMAGES;

  if (!isNumber(images) || !Number.isInteger(images) || images < 0 || images > SHOW_LIMIT) {
    throw new InputError(`images must be a whole number from 0 to ${SHOW_LIMIT}.`);
  }

  // Only the pictures it attaches get a PNG: rasterizing the others would only cost time. They
  // are read before the next build can write over them.
  return builds.render(file, { ...input, pngs: images }, token, ({ state, code }) => {
    const made = brief(state, code, cwd);
    const attached: Content[] = [];

    const pictures = made.pictures.map((picture) => {
      if (attached.length >= images || picture.png === null) return picture;
      const png = readPng(resolve(cwd, picture.png));

      if (png === null) return picture;
      attached.push(png);

      return { ...picture, attached: true };
    });

    const answer: Brief = { ...made, pictures };

    // A build that failed is the tool's failure, as the command's exit code 1 is.
    return {
      content: [{ type: "text", text: JSON.stringify(answer) }, ...attached],
      ...(!state.ok && { isError: true }),
    };
  });
}

function renderInput(args: Fields): RenderInput {
  const view = args.get("view");
  const layout = args.get("layout");
  const drawNoPlot = args.get("drawNoPlot") ?? false;
  const pdf = args.get("pdf") ?? false;
  const width = positive("width", args.get("width") ?? 1600);
  const timeout = positive("timeout", args.get("timeout") ?? DEFAULT_TIMEOUT);

  // Builds run one at a time, so one that may run without end would hold every call after it.
  if (timeout > BUILD_TIMEOUT_MAX) {
    throw new InputError(`timeout is at most ${BUILD_TIMEOUT_MAX} ms.`);
  }

  const reader = args.get("reader");
  const pngs = args.get("pngs");

  if (pngs !== undefined && (!isNumber(pngs) || !Number.isInteger(pngs) || pngs < 0)) {
    throw new InputError("pngs must be a whole number of 0 or more.");
  }

  if (!isBoolean(drawNoPlot)) throw new InputError("drawNoPlot is true or false.");

  if (!isBoolean(pdf)) throw new InputError("pdf is true or false.");

  if (layout !== undefined && !isString(layout)) throw new InputError("layout is a layout's name.");

  if (reader !== undefined && !isString(reader)) {
    throw new InputError("reader is a package's name or a folder.");
  }

  let box: [number, number, number, number] | undefined;

  if (view !== undefined) {
    const [x0, y0, x1, y1] = Array.isArray(view) ? view : [];

    if (
      !Array.isArray(view) ||
      view.length !== 4 ||
      !isNumber(x0) ||
      !isNumber(y0) ||
      !isNumber(x1) ||
      !isNumber(y1) ||
      ![x0, y0, x1, y1].every(Number.isFinite) ||
      !(x1 > x0 && y1 > y0)
    ) {
      throw new InputError(
        "view is [x0, y0, x1, y1]: the lower-left and the upper-right corner of a rectangle.",
      );
    }

    box = [x0, y0, x1, y1];
  }

  if (layout !== undefined && box === undefined) throw new InputError("layout goes with view.");

  if (pdf && box !== undefined) {
    throw new InputError("pdf plots whole sheets, and view draws one rectangle.");
  }

  if (pdf && drawNoPlot) {
    throw new InputError(
      "pdf plots the sheets as they plot, and drawNoPlot draws layers a plot leaves out.",
    );
  }

  return {
    drawNoPlot,
    pdf,
    width,
    timeout,
    ...(box !== undefined && { view: box }),
    ...(isString(layout) && { layout }),
    ...(isString(reader) && { reader }),
    ...(isNumber(pngs) && { pngs }),
  };
}

function positive(name: string, n: unknown): number {
  if (!isNumber(n) || !Number.isInteger(n) || n <= 0) {
    throw new InputError(`${name} must be a positive whole number.`);
  }

  return n;
}

/** A process that runs one program, and whether it started and loaded the library. */
interface ProgramProcess {
  readonly child: ChildProcess;
  readonly ready: Promise<boolean>;
}

/**
 * The programs `execute` runs, each in a process of its own. One process waits with the library
 * loaded, so that a program starts at once; it never runs a second program.
 */
class Programs {
  readonly #builds: Builds;
  readonly #cwd: string;
  #spare: ProgramProcess | undefined;
  /** Every process alive, the spare among them, so that none outlives the server. */
  readonly #children = new Set<ChildProcess>();
  /** The process of each request, from the moment it is taken. */
  readonly #running = new Map<Id, ChildProcess>();
  /** The token of each request's program, which a cancel sets at once. */
  readonly #tokens = new Map<Id, Token>();
  #closed = false;

  constructor(builds: Builds, cwd: string) {
    this.#builds = builds;
    this.#cwd = cwd;
  }

  #spawn(): ProgramProcess {
    const child = fork(programPath, [], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      serialization: "advanced",
      execArgv: ["--disable-warning=ExperimentalWarning", "--max-old-space-size=2048"],
    });

    this.#children.add(child);
    // A failed send or kill is reported through its callback or its return value.
    child.on("error", () => {});

    const ready = new Promise<boolean>((done) => {
      child.on("message", (m: unknown) => {
        if (isObject(m) && "type" in m && m.type === "ready") done(true);
      });

      child.once("exit", () => {
        this.#children.delete(child);

        // A spare that has gone is never handed a program, which would wait for its deadline.
        if (this.#spare?.child === child) this.#spare = undefined;
        done(false);
      });
    });

    return { child, ready };
  }

  cancel(id: Id): void {
    // A build the program left waiting is skipped from now, before its process has gone.
    const token = this.#tokens.get(id);

    if (token) {
      token.cancelled = true;
      this.#builds.stop(token);
    }

    this.#running.get(id)?.kill("SIGKILL");
  }

  async run(id: Id, args: Fields): Promise<ToolResult> {
    const code = args.get("code");
    const timeout = args.get("timeout") ?? PROGRAM_TIMEOUT;

    if (!isString(code) || code.trim() === "") {
      throw new InputError("Give code: the body of an async function.");
    }

    if (
      !isNumber(timeout) ||
      !Number.isInteger(timeout) ||
      timeout <= 0 ||
      timeout > PROGRAM_TIMEOUT_MAX
    ) {
      throw new InputError(
        `timeout is a whole number of milliseconds, at most ${PROGRAM_TIMEOUT_MAX}.`,
      );
    }

    if (this.#closed) throw new Error("The server is ending");
    const taken = this.#spare ?? this.#spawn();
    this.#spare = undefined;
    const { child } = taken;
    // The program's own: once it has ended, by an answer, a cancel or its deadline, a render it
    // left waiting does not start.
    const token: Token = { cancelled: false };
    this.#tokens.set(id, token);
    // Held from now, so that a cancel or the server's end reaches it while it starts.
    this.#running.set(id, child);
    let log = "";

    const keep = (chunk: string) => {
      log = (log + chunk).slice(-LOG_LIMIT * 2);
    };

    // Decoded as a stream, so a character split between two chunks stays whole.
    for (const stream of [child.stdout, child.stderr]) {
      stream?.setEncoding("utf8");
      stream?.on("data", keep);
    }

    try {
      const done = await new Promise<Done>((answered) => {
        // A render the program left waiting must not start once it has answered or ended, even
        // while its process still closes.
        const settle = (result: Done) => {
          token.cancelled = true;
          answered(result);
        };

        const end = (error: ProgramError) => settle({ error, images: [] });

        // The deadline counts from the request, the process's start among it.
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          end({
            kind: "Timeout",
            message: `The program ran for longer than ${timeout} ms and was ended. A render it started may have written its pictures.`,
          });
        }, timeout);

        child.on("message", (m: unknown) => {
          const message = programMessage(m);

          if (message?.type === "done") {
            clearTimeout(timer);
            settle(message);
          } else if (message?.type === "call") {
            // A process that has gone takes the answer with it.
            void this.#call(message, token).then(
              (answer) => child.connected && child.send(answer, () => {}),
              () => {},
            );
          }
        });

        child.once("exit", (exitCode, signal) => {
          clearTimeout(timer);
          const how = signal === null ? `with code ${exitCode}` : `on ${signal}`;
          end({ kind: "Exit", message: `The program's process ended before it answered, ${how}.` });
        });

        void taken.ready.then((ready) => {
          if (!ready) return;
          const request: ProgramRequest = { type: "run", code };
          child.send(request);
        });
      });

      // What the program printed last may still be in its pipes.
      await settled(child);
      const logs = log.length > LOG_LIMIT ? `…${log.slice(-LOG_LIMIT)}` : log;

      const images: Content[] = done.images.map((data) => ({
        type: "image",
        data,
        mimeType: "image/png",
      }));

      // The value is already JSON, and goes in as it is rather than parsed and written again.
      const head =
        done.json === undefined
          ? `"ok":false,"error":${JSON.stringify(done.error)}`
          : `"ok":true,"value":${done.json}`;

      const text = `{${head}${logs === "" ? "" : `,"logs":${JSON.stringify(logs)}`}}`;

      return {
        content: [{ type: "text", text }, ...images],
        ...(done.json === undefined && { isError: true }),
      };
    } finally {
      // Whatever the program left waiting, such as a render queued, is not started, and a render
      // it left running is stopped.
      token.cancelled = true;
      this.#builds.stop(token);
      this.#tokens.delete(id);
      this.#running.delete(id);
      child.kill("SIGKILL");

      // The next program's process starts once this one is done, unless one waits already.
      if (!this.#closed && this.#spare === undefined) this.#spare = this.#spawn();
    }
  }

  /** Answers a program's call of `render` or `shows`; a failure is the answer's message. */
  async #call(call: ProgramCall, token: Token): Promise<ProgramAnswer> {
    try {
      const file = resolve(this.#cwd, call.file);
      const options = fieldsOf(call.options);

      if (call.name === "render") {
        // A program draws the PNGs it asks for, and no others.
        const input = { pngs: 0, ...renderInput(options) };

        return await this.#builds.render(file, input, token, ({ state, code }) => ({
          type: "answer",
          id: call.id,
          value: state,
          brief: brief(state, code, this.#cwd),
        }));
      }

      return { type: "answer", id: call.id, value: await showsOf(file, options) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return { type: "answer", id: call.id, message };
    }
  }

  close(): void {
    this.#closed = true;
    this.#spare = undefined;

    for (const child of this.#children) child.kill("SIGKILL");
  }
}

/** How a program ended: its value as JSON, or its error, and the PNGs it showed. */
interface Done {
  readonly json?: string;
  readonly error?: ProgramError;
  readonly images: readonly string[];
}

/**
 * A message of a program's process, with each field checked: the program runs in it and can
 * send anything. One that is not as the process sends it is dropped, and the program then ends
 * at its deadline.
 */
function programMessage(m: unknown): (Done & { readonly type: "done" }) | ProgramCall | null {
  const fields = fieldsOf(m);
  const type = fields.get("type");

  if (type === "call") {
    const id = fields.get("id");
    const name = fields.get("name");
    const file = fields.get("file");

    if (!isNumber(id) || (name !== "render" && name !== "shows") || !isString(file)) return null;

    return { type, id, name, file, options: fields.get("options") };
  }

  if (type !== "done") return null;
  const json = fields.get("json");
  const error = fieldsOf(fields.get("error"));
  const images = fields.get("images");
  const kind = error.get("kind");
  const message = error.get("message");
  const line = error.get("line");
  const column = error.get("column");

  if (!Array.isArray(images) || images.length > SHOW_LIMIT || !images.every(isString)) return null;

  if (isString(json)) {
    // The process refuses a larger value itself; a program that sent its own answer is held to it.
    if (json.length > RESULT_LIMIT) {
      const why = `The program answered with ${json.length} characters, over the limit of ${RESULT_LIMIT}`;

      return { type, error: { kind: "TooLarge", message: why }, images: [] };
    }

    return { type, json, images };
  }

  if (!isString(kind) || !isString(message)) return null;

  return {
    type,
    error: {
      kind,
      message,
      ...(isNumber(line) && { line }),
      ...(isNumber(column) && { column }),
    },
    images,
  };
}

async function showsOf(file: string, options: Fields): Promise<CallValue> {
  const sheet = options.get("sheet");
  const layout = options.get("layout");
  const near = options.get("near");
  const within = options.get("within");
  const reader = options.get("reader");

  if (sheet !== undefined && !isString(sheet)) throw new Error("sheet is a layout's name");

  if (layout !== undefined && !isString(layout)) throw new Error("layout is a layout's name");

  if (sheet !== undefined && layout !== undefined) {
    throw new Error("sheet asks about a whole sheet, and layout about its paper alone: give one");
  }

  const point =
    Array.isArray(near) &&
    near.length === 2 &&
    isNumber(near[0]) &&
    isNumber(near[1]) &&
    Number.isFinite(near[0]) &&
    Number.isFinite(near[1])
      ? ([near[0], near[1]] as const)
      : undefined;

  if (near !== undefined && point === undefined) throw new Error("near is [x, y]");

  if (within !== undefined && (!isNumber(within) || !Number.isFinite(within) || within < 0)) {
    throw new Error("within is a distance of 0 or more");
  }

  if (within !== undefined && point === undefined) throw new Error("within goes with near");

  const given = options.get("xrefs") ?? {};

  if (!isObject(given) || Array.isArray(given)) {
    throw new Error("xrefs maps each xref's name to its file");
  }

  const xrefs = new Map<string, string>();

  for (const [name, path] of Object.entries(given)) {
    if (!isString(path)) throw new Error("xrefs maps each xref's name to its file");
    xrefs.set(name, resolve(path));
  }

  if (reader !== undefined && !isString(reader)) {
    throw new Error("reader is a package's name or a folder");
  }

  const { shows } = await import("./shows.ts");

  const answered = await shows({
    file,
    xrefs: Object.fromEntries(xrefs),
    ...(isString(sheet) && { sheet }),
    ...(isString(layout) && { layout }),
    ...(point !== undefined && { near: [point[0], point[1]] }),
    ...(isNumber(within) && { within }),
    ...(isString(reader) && { reader }),
  });

  return jsonOf(answered.json);
}

/** The answer of `shows`, which holds only what JSON holds, as the command prints it. */
function jsonOf(value: unknown): Json {
  // SAFETY: `shows` answers with plain data made to be printed with JSON.stringify.
  return value as Json;
}

/** Settles when the process has ended, or a moment after, when its pipes have said all they will. */
async function settled(child: ChildProcess): Promise<void> {
  if (child.stdout?.closed !== false && child.stderr?.closed !== false) return;

  await new Promise<void>((done) => {
    // A process that ends closes its pipes once all it wrote has been read from them.
    const timer = setTimeout(done, 1_000);

    child.once("close", () => {
      clearTimeout(timer);
      done();
    });

    // The program has answered: its process has nothing left to do but end.
    if (child.connected) child.disconnect();
  });
}

/** A PNG this server wrote, as an image to attach, or `null` when it is not there to read. */
function readPng(path: string): Content | null {
  if (extname(path).toLowerCase() !== ".png") return null;

  try {
    if (!statSync(path).isFile() || statSync(path).size > PNG_LIMIT) return null;

    return { type: "image", data: readFileSync(path).toString("base64"), mimeType: "image/png" };
  } catch {
    return null;
  }
}

/** The `feedback` tool: the receipt, or why the report was refused, as the tool's error. */
async function feedbackCall(
  session: Feedback,
  args: Fields,
  { decodeReport, FeedbackRefusal }: typeof import("./feedback.ts"),
): Promise<ToolResult> {
  try {
    const receipt = await session.file(decodeReport(Object.fromEntries(args)));

    return { content: [{ type: "text", text: JSON.stringify(receipt) }] };
  } catch (error) {
    if (!(error instanceof FeedbackRefusal)) throw error;

    return { content: [{ type: "text", text: error.message }], isError: true };
  }
}

function realpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    // Missing: the build reports it.
    return path;
  }
}

function packageVersion(): string {
  const json: unknown = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );

  return isObject(json) && "version" in json && isString(json.version) ? json.version : "0.0.0";
}

function instructions(cwd: string): string {
  const guide = existsSync(guidePath) ? guidePath : "GUIDE.md in the tsdraft package";

  return `tsdraft draws 2D CAD drawings in TypeScript and writes DXF. A drawing file is a TypeScript module whose default export is a Drawing, or a function that returns one; it may also be a DXF, or a DWG a reader in the project reads. Read ${guide} before your first drawing: it shows how a drawing is built and checked.

Write and edit the drawing file with your own file tools. Then:
- render builds it and answers with a brief: the counts, each error and warning at the call that made it, and the pictures, the first of them as images. Fix the errors first. To read small text, render again with view set to a diagnostic's bounds.
- execute runs a JavaScript program over the same builds, and over DXF and DWG files read as data. Use it for what the brief leaves out, such as inserts, dimensions or a layout's viewports, or what a file shows near a point, and return only what you need.

The tsdraft command does the rest: \`tsdraft dev <file>\` for a live preview in a browser, \`tsdraft write\` for the edited copy of a file, and \`tsc --noEmit\` for the rules tsdraft holds as types. Paths are from ${cwd}.`;
}

function tools(cwd: string): JsonObject[] {
  return [
    {
      name: "render",
      title: "Render a drawing",
      // It runs the drawing file's code and writes its pictures, over the last ones.
      annotations: {
        readOnlyHint: false,
        // It writes over only its own pictures, in the out folder.
        destructiveHint: false,
        idempotentHint: false,
        // It runs the drawing file's code, which may do anything.
        openWorldHint: true,
      },
      description: `Builds a drawing file once, as \`tsdraft render\` does, writes its SVG and PNG pictures to an out folder beside it, and answers with a brief of the build as JSON. It runs the drawing file's code with the permissions of the user who started the server, as the command does. The brief comes first, then the first \`images\` pictures as images: a view, then an edit's pictures of its changes, then each layout's sheet, then model space.

The brief: ok; code, as the command exits (0 built with no lint errors, 2 lint reported errors, 1 the build failed); error, with the line to fix, when it failed; units, extents and counts; each layout; rules, every diagnostic counted by its rule; diagnostics, the first ${BRIEF_DIAGNOSTICS}, errors first, each with at, the call in the drawing's code that made it, and bounds, its box in its picture's coordinates; more, how many it leaves out; pictures, each with its PNG path and attached when it is one of the images; pdf; and the end of the file's log. For the whole BuildState, such as every insert or dimension, use execute.

Paths are from ${cwd}. Build again after each save.`,
      inputSchema: {
        type: "object",
        properties: {
          file: {
            type: "string",
            description:
              "The drawing file: a TypeScript module whose default export is a Drawing, an edit file, a DXF, or a DWG a reader in the project reads.",
          },
          view: {
            type: "array",
            items: { type: "number" },
            minItems: 4,
            maxItems: 4,
            description:
              "Draws only this rectangle, [x0, y0, x1, y1] from its lower-left to its upper-right corner, in drawing units of model space, or in paper units on layout. Give it a diagnostic's bounds to read small text. No other picture is drawn.",
          },
          layout: {
            type: "string",
            description: "With view: the layout whose sheet the rectangle is on.",
          },
          images: {
            type: "integer",
            minimum: 0,
            maximum: SHOW_LIMIT,
            description: `How many pictures to attach as images. Default ${DEFAULT_IMAGES}. 0 for none: the paths are in the brief.`,
          },
          pdf: { type: "boolean", description: "Also plots the sheets to PDF, each and the set." },
          drawNoPlot: { type: "boolean", description: "Also draws the layers that do not plot." },
          width: { type: "integer", minimum: 1, description: "PNG width in pixels. Default 1600." },
          timeout: {
            type: "integer",
            minimum: 1,
            maximum: BUILD_TIMEOUT_MAX,
            description: "How long the build may run, in ms. Default 10000, at most 600000.",
          },
          reader: {
            type: "string",
            description:
              "The package that reads a DWG, by name or folder, when the project names none or several.",
          },
        },
        required: ["file"],
        additionalProperties: false,
      },
    },
    {
      name: "execute",
      title: "Run a program over drawings",
      // A program may do anything the user who started the server may.
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      description: `Runs a JavaScript program, the body of an async function: use await, and return what you want back. Only what it returns reaches you, so a large build or read never fills your context. It runs in a process of its own, from ${cwd}, with the permissions of the user who started the server: it is no sandbox. It has:

render(file: string, options?: { view?: [x0, y0, x1, y1]; layout?: string; drawNoPlot?: boolean; pdf?: boolean; width?: number; timeout?: number; reader?: string; pngs?: number }): Promise<BuildState>
  Builds and writes the SVG pictures as the render tool does, and a PNG of the first pngs of them, 0 unless asked, in the order the brief lists the pictures. It gives the whole BuildState that \`tsdraft render\` prints: { ok, file, ms, error, log, diagnostics: [{ severity, rule, message, call, layer, layout, entity, bounds, ... }], drawing: { units, extents, counts, layers, blocks, inserts: [{ entity, block, layer, id, at, scale, rotation, attributes }], dimensions: [{ entity, kind, measurement, text }], xrefs, layouts: [{ name, paper, width, height, viewports: [{ rectangle, ratio, center, shows }], inserts, dimensions }] }, outputs: { png, svg, layouts: [{ name, png }], view, pdf, changes } }.
brief(state): the brief the render tool answers with, from a state render gave.
shows(file: string, options?: { sheet?: string; layout?: string; near?: [x, y]; within?: number; xrefs?: Record<string, string>; reader?: string }): Promise<object>
  What \`tsdraft shows\` prints for a DXF or a DWG: with sheet, what each viewport of that layout shows; with layout, its paper alone; else model space. Each entity with its handle, kind, layer, box and text, nearest first with near.
show(png: string): attaches that PNG to the answer as an image, at most ${SHOW_LIMIT}.
tsdraft: the tsdraft library, such as tsdraft.measureText({ value, height }).
await import("node:fs") and other modules work.

It answers {"ok":true,"value":...,"logs":"..."} with the returned value as JSON and what the program printed, or {"ok":false,"error":{"kind","message","line","column"}}. A value over ${RESULT_LIMIT.toLocaleString("en-US")} characters of JSON is refused, never cut: return only the fields, the counts or the page you need. For example:
  const s = await render("plan.ts", { pngs: 1 });
  show(s.outputs.layouts[0].png);
  return s.drawing.layouts.map((l) => ({ name: l.name, scales: l.viewports.map((v) => v.ratio) }));`,
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "The body of an async function, in JavaScript." },
          timeout: {
            type: "integer",
            minimum: 1,
            maximum: PROGRAM_TIMEOUT_MAX,
            description: `How long the program may run, in ms. Default ${PROGRAM_TIMEOUT}.`,
          },
        },
        required: ["code"],
        additionalProperties: false,
      },
    },
  ];
}
