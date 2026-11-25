// The mode of agent feedback and where it keeps its files, apart from the rest of `feedback.ts` so
// that a command or a server with feedback off reads its mode and loads nothing else of it.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isObject } from "./guards.ts";

export const MODES = ["off", "on"] as const;

export type Mode = (typeof MODES)[number];

type Env = NodeJS.ProcessEnv;

/** The mode, and what set it. */
export interface ModeSetting {
  readonly mode: Mode;
  readonly from: "TSDRAFT_FEEDBACK" | "config" | "default";
  /** A value that is not a mode, which counts as off. */
  readonly problem?: string;
}

export const OFF_MESSAGE =
  "Agent feedback is off, as it is unless the user turns it on. The user turns it on with `tsdraft feedback mode on`, or TSDRAFT_FEEDBACK=on; a report then sends only its kind, subject, id and tsdraft version, and its texts stay on this machine. Nothing was saved or sent.";

/** Variables a CI service sets, as T3 Code lists them. `CI=false` and `CI=0` do not count. */
const CI_VARIABLES = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "CIRCLECI",
  "TRAVIS",
  "BUILDKITE",
  "JENKINS_URL",
  "TEAMCITY_VERSION",
  "TF_BUILD",
  "BITBUCKET_BUILD_NUMBER",
  "CODEBUILD_BUILD_ID",
  "DRONE",
  "APPVEYOR",
];

const isMode = (value: unknown): value is Mode => MODES.some((mode) => mode === value);

/** `TSDRAFT_FEEDBACK`, else the config file `tsdraft feedback mode` writes, else off. */
export function feedbackMode(env: Env = process.env): ModeSetting {
  const given = env.TSDRAFT_FEEDBACK?.trim();

  if (given !== undefined && given !== "") {
    if (isMode(given)) return { mode: given, from: "TSDRAFT_FEEDBACK" };

    return {
      mode: "off",
      from: "TSDRAFT_FEEDBACK",
      problem: `TSDRAFT_FEEDBACK is ${MODES.join(", ")} or unset, so feedback is off.`,
    };
  }

  let text: string;

  try {
    text = readFileSync(configFile(env), "utf8");
  } catch {
    return { mode: "off", from: "default" };
  }

  try {
    const parsed: unknown = JSON.parse(text);

    if (isObject(parsed) && "mode" in parsed && isMode(parsed.mode)) {
      return { mode: parsed.mode, from: "config" };
    }
  } catch {
    // Read below as a file that holds no mode.
  }

  return {
    mode: "off",
    from: "config",
    problem: `${configFile(env)} holds no mode, so feedback is off.`,
  };
}

/** Writes the mode to the config file and gives its path. */
export function setFeedbackMode(mode: Mode, env: Env = process.env): string {
  const file = configFile(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify({ mode }, null, 2)}\n`, { mode: 0o600 });

  return file;
}

const absolute = (value: string | undefined) =>
  value !== undefined && value !== "" && isAbsolute(value) ? value : undefined;

/**
 * The user's config folder for tsdraft: `$XDG_CONFIG_HOME/tsdraft`, else Application Support on
 * macOS, the roaming app data folder on Windows and `~/.config/tsdraft` elsewhere.
 */
export function configFile(env: Env = process.env): string {
  const xdg = absolute(env.XDG_CONFIG_HOME);

  if (xdg) return join(xdg, "tsdraft", "feedback.json");
  const home = homedir();

  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "tsdraft", "feedback.json");
  }

  if (process.platform === "win32") {
    return join(
      absolute(env.APPDATA) ?? join(home, "AppData", "Roaming"),
      "tsdraft",
      "feedback.json",
    );
  }

  return join(home, ".config", "tsdraft", "feedback.json");
}

/**
 * tsdraft's state folder in the user's home, which no variable moves: the hour's count of reports
 * lives here, so that a new `TSDRAFT_FEEDBACK_DIR` does not reset it.
 */
export function stateFolder(): string {
  const home = homedir();

  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "tsdraft");
  }

  if (process.platform === "win32") return join(home, "AppData", "Local", "tsdraft");

  return join(home, ".local", "state", "tsdraft");
}

/**
 * Where reports are saved: `TSDRAFT_FEEDBACK_DIR`, else `$XDG_STATE_HOME/tsdraft/feedback`, else
 * Application Support on macOS, the local app data folder on Windows and `~/.local/state`
 * elsewhere.
 */
export function feedbackFolder(env: Env = process.env): string {
  const given = env.TSDRAFT_FEEDBACK_DIR;

  if (given !== undefined && given !== "") return resolve(given);
  const xdg = absolute(env.XDG_STATE_HOME);

  if (xdg) return join(xdg, "tsdraft", "feedback");
  const home = homedir();

  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "tsdraft", "feedback");
  }

  if (process.platform === "win32") {
    return join(
      absolute(env.LOCALAPPDATA) ?? join(home, "AppData", "Local"),
      "tsdraft",
      "feedback",
    );
  }

  return join(home, ".local", "state", "tsdraft", "feedback");
}

/** Whether a variable that stops sending is set: anything but empty, `0` or `false`. */
const set = (value: string | undefined) =>
  !["", "0", "false"].includes(value?.trim().toLowerCase() ?? "");

/** Why nothing may be sent from here, or `null`: `DO_NOT_TRACK`, `TSDRAFT_TELEMETRY=0` or CI. */
export function sendingStopped(env: Env = process.env): string | null {
  if (set(env.DO_NOT_TRACK)) {
    return "DO_NOT_TRACK is set, so nothing is sent. The report is saved on this machine.";
  }

  const telemetry = env.TSDRAFT_TELEMETRY?.trim().toLowerCase() ?? "";

  if (["0", "false", "no", "off", "n"].includes(telemetry)) {
    return "TSDRAFT_TELEMETRY is 0, so nothing is sent. The report is saved on this machine.";
  }

  return CI_VARIABLES.some((name) => set(env[name]))
    ? "This runs in CI, so nothing is sent. The report is saved on this machine."
    : null;
}
