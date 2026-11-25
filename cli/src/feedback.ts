// Agent feedback: a report of where tsdraft got in an agent's way. The agent picks a kind and a
// subject from lists and may add three short texts in its own words. The whole report is saved on
// this machine, and with feedback on, only its categories leave: `{ id, kind, subject, tsdraft }`.
// No text, and nothing of the machine, the project or the client, is ever sent.
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { basename, extname, join } from "node:path";
import {
  feedbackFolder,
  feedbackMode,
  type ModeSetting,
  OFF_MESSAGE,
  sendingStopped,
  stateFolder,
} from "./feedback-mode.ts";
import { isNumber, isObject, isString, type JsonObject } from "./guards.ts";

export const KINDS = ["bug", "confusing", "missing_capability", "wrong_docs", "other"] as const;

/** What a report may be about: a command, a tool of `tsdraft mcp`, a part of the library, or all. */
export const SUBJECTS = [
  "render",
  "dev",
  "shows",
  "write",
  "mcp",
  "feedback",
  "execute",
  "lint",
  "toSVG",
  "toDXF",
  "standard",
  "edit",
  "read",
  "measureText",
  "general",
] as const;

export type Kind = (typeof KINDS)[number];

export type Subject = (typeof SUBJECTS)[number];

/** Reports one command run or one server session may file, and this machine in an hour, roughly. */
export const SESSION_LIMIT = 3;
export const HOUR_LIMIT = 10;

/** The most characters each text may hold. */
export const TEXT_LIMIT = 300;
const SEND_TIMEOUT = 10_000;

/** The version a payload names: three numbers of at most three digits, or `unknown`. */
const VERSION = /^(?:\d{1,3}\.\d{1,3}\.\d{1,3}|unknown)$/u;

/** The ids tsdraft gives: a random UUID. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** The only fields that ever leave this machine, each of them in every payload. */
const PAYLOAD_FIELDS = "id,kind,subject,tsdraft";

/** A report that cannot be filed as given, said to whoever gave it. */
export class FeedbackRefusal extends Error {}

const TEXT_FIELDS = ["expected", "actual", "workaround"] as const;

/** The three texts of a report, in the agent's own words. They stay on this machine. */
interface ReportTexts {
  expected?: string;
  actual?: string;
  workaround?: string;
}

/** What the agent gives, once checked. */
export interface ReportInput extends Readonly<ReportTexts> {
  readonly kind: Kind;
  readonly subject: Subject;
}

/** What became of a report's one send. */
const STATUSES = ["sent", "not sent", "failed"] as const;

type Status = (typeof STATUSES)[number];

/** A report as saved on this machine. */
export interface SavedReport extends ReportInput {
  readonly id: string;
  readonly createdAt: string;
  readonly via: "cli" | "mcp";
  readonly status: Status;
  /** Why it was not sent, or the error of the send that failed. */
  readonly reason?: string;
}

export interface Receipt {
  readonly id: string;
  readonly status: Status;
  readonly sent: boolean;
  readonly reason?: string;
  /** The copy on this machine. */
  readonly saved: string;
  /** What was sent, or would have been: the only fields that ever leave this machine. */
  readonly payload: JsonObject;
  readonly note: string;
}

type Env = NodeJS.ProcessEnv;

const isKind = (value: unknown): value is Kind => KINDS.some((kind) => kind === value);

const isSubject = (value: unknown): value is Subject =>
  SUBJECTS.some((subject) => subject === value);

const isStatus = (value: unknown): value is Status => STATUSES.some((status) => status === value);

const codePoints = (text: string) => [...text].length;

/** The report the agent gave, with each field checked. Unknown fields are dropped. */
export function decodeReport(input: unknown): ReportInput {
  if (!isObject(input) || Array.isArray(input)) {
    throw new FeedbackRefusal(
      "A report is an object: { kind, subject, expected?, actual?, workaround? }.",
    );
  }

  const fields = new Map(Object.entries(input));
  const kind = fields.get("kind");
  const given = fields.get("subject");

  if (!isKind(kind)) throw new FeedbackRefusal(`kind is one of ${KINDS.join(", ")}.`);

  // `tsdraft render` names the command as the help does.
  const subject = isString(given) ? given.trim().replace(/^tsdraft\s+/u, "") : given;

  if (!isSubject(subject)) {
    throw new FeedbackRefusal(
      `subject is a tsdraft command, a tool of tsdraft mcp, a part of the library or general: one of ${SUBJECTS.join(", ")}.`,
    );
  }

  const texts: ReportTexts = {};

  for (const field of TEXT_FIELDS) {
    const value = fields.get(field);

    if (value === undefined || value === null) continue;

    if (!isString(value)) throw new FeedbackRefusal(`${field} is text.`);

    if (codePoints(value) > TEXT_LIMIT) {
      throw new FeedbackRefusal(`${field} is at most ${TEXT_LIMIT} characters.`);
    }

    if (value.trim() !== "") texts[field] = value.trim();
  }

  return { kind, subject, ...texts };
}

/** The leading `major.minor.patch` of a version, each part at most three digits, else `unknown`. */
export function versionOf(version: string | undefined): string {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}(?!\d)/u.exec(version ?? "")?.[0] ?? "unknown";
}

/**
 * What leaves this machine for a report: its id, kind, subject and tsdraft's version, always those
 * four. Every send is made by this function and checked by `checkPayload`.
 */
export function payloadOf(
  report: Pick<SavedReport, "id" | "kind" | "subject">,
  version: string | undefined,
): JsonObject {
  return { id: report.id, kind: report.kind, subject: report.subject, tsdraft: versionOf(version) };
}

/** Throws unless the payload is one `payloadOf` could make: the four fields, each of its kind. */
export function checkPayload(payload: JsonObject): void {
  const wrong = (why: string) => new FeedbackRefusal(`The payload ${why}, so nothing was sent.`);

  if (Object.keys(payload).sort().join() !== PAYLOAD_FIELDS) {
    throw wrong("does not hold exactly id, kind, subject and tsdraft");
  }

  if (!isString(payload.id) || !ID.test(payload.id)) throw wrong("has no id tsdraft gave");

  if (!isKind(payload.kind) || !isSubject(payload.subject)) throw wrong("has no kind or subject");

  if (!isString(payload.tsdraft) || !VERSION.test(payload.tsdraft)) {
    throw wrong("has a version that is not one");
  }
}

/** The hosts `TSDRAFT_FEEDBACK_URL` may name: this machine, by number, for tests. */
const LOOPBACK = new Set(["127.0.0.1", "[::1]"]);

const NO_ENDPOINT =
  "tsdraft has no feedback endpoint yet, so nothing was sent. The report is saved on this machine.";

const REFUSED_URL =
  "TSDRAFT_FEEDBACK_URL may only name this machine, as http://127.0.0.1 or http://[::1], with no user, password, query or fragment, so nothing was sent.";

/**
 * Where a report is posted: `TSDRAFT_FEEDBACK_URL` when it is plain http to 127.0.0.1 or ::1, with
 * no credentials, query or fragment. Else why nothing is sent.
 */
export function endpointOf(env: Env = process.env): URL | string {
  const given = env.TSDRAFT_FEEDBACK_URL?.trim() ?? "";

  // The built-in endpoint is empty for now. When it is set it gets a transport of its own, built
  // then: `post` below speaks plain http to this machine alone.
  if (given === "") return NO_ENDPOINT;

  let url: URL;

  try {
    url = new URL(given);
  } catch {
    return REFUSED_URL;
  }

  const plain =
    url.protocol === "http:" &&
    LOOPBACK.has(url.hostname) &&
    url.username === "" &&
    url.password === "" &&
    !given.includes("?") &&
    !given.includes("#") &&
    !given.includes("@");

  return plain ? url : REFUSED_URL;
}

/** Every report saved on this machine, newest first. A file that is not one is passed over. */
export function savedReports(env: Env = process.env): SavedReport[] {
  const folder = feedbackFolder(env);
  let names: string[];

  try {
    names = readdirSync(folder);
  } catch {
    return [];
  }

  const reports: SavedReport[] = [];

  for (const name of names) {
    if (extname(name) !== ".json") continue;
    let report: SavedReport | null;

    try {
      report = reportOf(JSON.parse(readFileSync(join(folder, name), "utf8")));
    } catch {
      continue;
    }

    if (report !== null && report.id === basename(name, ".json")) reports.push(report);
  }

  return reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** A saved copy, with each field it needs checked: one that is not tsdraft's is `null`. */
function reportOf(value: unknown): SavedReport | null {
  if (!isObject(value) || Array.isArray(value)) return null;
  const fields = new Map(Object.entries(value));

  const [id, createdAt, via, status, reason] = ["id", "createdAt", "via", "status", "reason"].map(
    (key) => fields.get(key),
  );

  if (
    !isString(id) ||
    !ID.test(id) ||
    !isString(createdAt) ||
    Number.isNaN(Date.parse(createdAt)) ||
    (via !== "cli" && via !== "mcp") ||
    !isStatus(status) ||
    (reason !== undefined && !isString(reason))
  ) {
    return null;
  }

  try {
    return {
      id,
      createdAt,
      ...decodeReport(value),
      via,
      status,
      ...(isString(reason) && { reason }),
    };
  } catch {
    return null;
  }
}

/** Writes a file whole: to a file of its own beside it, then renamed over it. */
function writeWhole(file: string, text: string): void {
  const temporary = `${file}.${randomUUID()}.tmp`;

  try {
    writeFileSync(temporary, text, { mode: 0o600, flag: "wx" });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function save(report: SavedReport, env: Env): string {
  const folder = feedbackFolder(env);
  const file = join(folder, `${report.id}.json`);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  writeWhole(file, `${JSON.stringify(report, null, 2)}\n`);

  return file;
}

/**
 * Takes one of the machine's `HOUR_LIMIT` reports an hour, or gives `false`. The times live in a
 * file in tsdraft's state folder, read, checked and replaced whole with no lock, so a burst of
 * processes may let a few more through. Synchronous, so a session's calls take it one by one.
 */
function takeHour(): boolean {
  const now = Date.now();
  const folder = stateFolder();
  const file = join(folder, "feedback-hour.json");
  let times: number[] = [];

  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));

    if (Array.isArray(parsed)) times = parsed.filter((t): t is number => isNumber(t));
  } catch {
    // None yet, or not tsdraft's: counted as none.
  }

  times = times.filter((t) => t > now - 3_600_000 && t <= now);

  if (times.length >= HOUR_LIMIT) return false;
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  writeWhole(file, JSON.stringify([...times, now]));

  return true;
}

/**
 * Where the report goes, or why it may not be sent now. Read again right before the POST, so that
 * feedback turned off or an opt-out set since the server started stops it.
 */
function sendTo(env: Env): URL | string {
  if (feedbackMode(env).mode === "off") {
    return "Agent feedback is off now, so nothing was sent. The report is saved on this machine.";
  }

  return sendingStopped(env) ?? endpointOf(env);
}

/**
 * Posts the payload once, with `node:http` and an agent of its own, so no proxy is used, and no
 * header that names the machine. Follows no redirect. Gives the error, or `null` when taken.
 */
async function post(url: URL, payload: JsonObject): Promise<string | null> {
  const body = JSON.stringify(payload);

  return new Promise((done) => {
    const unreached = () => done("the endpoint could not be reached");

    const sending = request(
      {
        host: url.hostname === "[::1]" ? "::1" : url.hostname,
        port: url.port === "" ? 80 : Number(url.port),
        path: url.pathname,
        method: "POST",
        agent: false,
        signal: AbortSignal.timeout(SEND_TIMEOUT),
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        response.on("error", unreached).resume();
        const status = response.statusCode ?? 0;
        done(status >= 200 && status < 300 ? null : `the endpoint answered ${status}`);
      },
    );

    sending.on("error", (error) => {
      if (error.name !== "AbortError") return unreached();
      done(`the endpoint did not answer within ${SEND_TIMEOUT / 1000} s`);
    });

    sending.end(body);
  });
}

/** tsdraft's version, from its package.json. */
function packageVersion(): string | undefined {
  try {
    const json: unknown = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    );

    return isObject(json) && "version" in json && isString(json.version) ? json.version : undefined;
  } catch {
    return undefined;
  }
}

/** Reports of one command run or one server session: the mode, and how many reports it filed. */
export class Feedback {
  readonly setting: ModeSetting;
  readonly #via: "cli" | "mcp";
  readonly #env: Env;
  #filed = 0;

  constructor(options: { via: "cli" | "mcp"; env?: Env }) {
    this.#via = options.via;
    this.#env = options.env ?? process.env;
    this.setting = feedbackMode(this.#env);
  }

  /**
   * Files a report: saves it whole on this machine, then sends its four fields once, with no retry,
   * and records what became of the send in the copy. Everything up to the send runs before any
   * `await`, so calls that arrive together count against the session's limit one by one.
   */
  async file(report: ReportInput): Promise<Receipt> {
    if (this.setting.mode === "off") {
      throw new FeedbackRefusal(this.setting.problem ?? OFF_MESSAGE);
    }

    if (this.#filed >= SESSION_LIMIT) {
      throw new FeedbackRefusal(
        `This ${this.#via === "mcp" ? "session" : "run"} already filed ${SESSION_LIMIT} reports. Nothing was saved or sent.`,
      );
    }

    this.#filed++;

    if (!takeHour()) {
      throw new FeedbackRefusal(
        `This machine filed about ${HOUR_LIMIT} reports in the last hour. Nothing was saved or sent.`,
      );
    }

    // A new id for each report, made here: nothing read from a saved copy is ever posted.
    const filed: SavedReport = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...report,
      via: this.#via,
      status: "not sent",
      reason: "the send had not ended",
    };

    const payload = payloadOf(filed, packageVersion());
    checkPayload(payload);

    // The copy on this machine comes first, before anything is sent.
    const saved = save(filed, this.#env);
    const to = sendTo(this.#env);
    const error = isString(to) ? to : await post(to, payload);
    const { reason: _, ...rest } = filed;

    const after: SavedReport =
      error === null
        ? { ...rest, status: "sent" }
        : { ...rest, status: isString(to) ? "not sent" : "failed", reason: error };

    save(after, this.#env);

    return {
      id: after.id,
      status: after.status,
      sent: error === null,
      ...(error !== null && { reason: error }),
      saved,
      payload,
      note: NOTE,
    };
  }
}

const NOTE =
  "Only the id, kind, subject and tsdraft version leave this machine, in one try. The texts stay in the copy named by saved.";

/** The `feedback` tool of `tsdraft mcp`, listed only while feedback is on. */
export function feedbackTool(): JsonObject {
  return {
    name: "feedback",
    title: "Send feedback about tsdraft",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: `File a report for tsdraft's maintainer about tsdraft itself: a rule, message or diagnostic that was wrong or unclear, a doc that misled you, a capability that is missing, a bug, or a workaround you had to invent. Not about the user's drawing or project. Call it on your own when tsdraft gets in your way.

Only the report's id, kind, subject and the tsdraft version leave this machine, sent once as the report is filed. expected, actual and workaround, at most ${TEXT_LIMIT} characters each, are kept in a copy on this machine for the user and are never sent. Write them in your own words all the same: never quote the user's messages, code or files.

It answers with the receipt: { id, status, sent, reason, saved, payload }. status is sent, not sent (reason says why) or failed (reason gives the error); a send is never tried again. Tell the user in one sentence, with the id.`,
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: [...KINDS],
          description:
            "bug: tsdraft did something wrong; confusing: a rule, message or diagnostic was unclear; missing_capability: something you needed is not there; wrong_docs: a doc was wrong or misled you; other.",
        },
        subject: {
          type: "string",
          enum: [...SUBJECTS],
          description:
            "What it is about: a tsdraft command (render, dev, shows, write, mcp, feedback), a tool of this server (render, execute), a part of the library (lint, toSVG, toDXF, standard, edit, read, measureText), or general.",
        },
        expected: {
          type: "string",
          maxLength: TEXT_LIMIT,
          description: "What you expected tsdraft to do. Kept on this machine.",
        },
        actual: {
          type: "string",
          maxLength: TEXT_LIMIT,
          description: "What it did instead. Kept on this machine.",
        },
        workaround: {
          type: "string",
          maxLength: TEXT_LIMIT,
          description: "What you did instead, if anything. Kept on this machine.",
        },
      },
      required: ["kind", "subject"],
      additionalProperties: false,
    },
  };
}

/** The line the server's instructions gain while the tool is listed. */
export const FEEDBACK_INSTRUCTIONS =
  "When tsdraft gets in your way, such as a rule or message that was wrong or unclear, a doc that misled you, a missing capability, a bug or a workaround you had to invent, call feedback and tell the user its id in one sentence. Only its id, kind, subject and tsdraft version are sent; its texts stay on this machine.";

/** The flags `tsdraft feedback` takes. */
export interface FeedbackFlags {
  readonly kind?: string;
  readonly subject?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly workaround?: string;
  readonly json?: boolean;
}

/** A `tsdraft feedback` used wrongly: the command prints it with the help and exits 64. */
export class FeedbackUsage extends Error {}

const print = (value: Receipt | readonly SavedReport[]) =>
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

/**
 * `tsdraft feedback`: files a report, or with `list` lists the saved reports. `cli.ts` handles
 * `mode` and the off case before it loads this file. Prints JSON on stdout, and gives the exit code.
 */
export async function feedbackCommand(
  args: readonly string[],
  flags: FeedbackFlags,
  env: Env = process.env,
): Promise<number> {
  const [action, value] = args;

  if (action === "list") {
    if (value !== undefined) throw new FeedbackUsage("list takes nothing more.");
    const reports = savedReports(env);

    if (flags.json) {
      print(reports);

      return 0;
    }

    const lines = reports.map(
      (r) => `${r.createdAt}  ${r.id}  ${r.status.padEnd(8)}  ${r.kind}  ${r.subject}`,
    );

    process.stdout.write(
      lines.length === 0 ? `No reports in ${feedbackFolder(env)}.\n` : `${lines.join("\n")}\n`,
    );

    return 0;
  }

  if (action !== undefined) {
    throw new FeedbackUsage(
      `feedback has no ${JSON.stringify(action)}: give a report, mode or list.`,
    );
  }

  let report: ReportInput;

  try {
    report = decodeReport({
      kind: flags.kind,
      subject: flags.subject,
      expected: flags.expected,
      actual: flags.actual,
      workaround: flags.workaround,
    });
  } catch (error) {
    if (error instanceof FeedbackRefusal) throw new FeedbackUsage(error.message);
    throw error;
  }

  try {
    print(await new Feedback({ via: "cli", env }).file(report));

    return 0;
  } catch (error) {
    if (!(error instanceof FeedbackRefusal)) throw error;
    process.stderr.write(`${error.message}\n`);

    return 1;
  }
}
