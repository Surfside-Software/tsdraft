// Where in the caller's code a builder method was called. The location comes from the engine's
// stack, so it holds a path of the machine the drawing was built on. It is kept beside the
// drawing, never in it.

/** A place in a source file, as the JavaScript engine names it in a stack. */
export interface CallSite {
  /** A `file://` URL for an ES module in Node, a path for CommonJS, and a URL in a browser. */
  readonly file: string;
  /** Counted from 1. */
  readonly line: number;
  /** Counted from 1. */
  readonly column: number;
}

/**
 * A stack that the engine has captured and formats when `stack` is first read. `whole` is true
 * for a stack that starts inside tsdraft, and false for one cut down to the caller's frame.
 */
export interface HeldCall {
  readonly stack?: unknown;
  readonly whole: boolean;
}

type Method = (...args: never[]) => unknown;
type Capture = (target: object, above: Method) => void;

/** The calls that drew a drawing's entities, by its `entities` array and each entity's index. */
const recorded = new WeakMap<object, readonly (HeldCall | undefined)[]>();

/**
 * Captures the call of the builder method `method` that is running now, to be read later, or
 * returns undefined where the engine gives no stack. It must be called from the builder's file.
 *
 * With `Error.captureStackTrace` the engine leaves out every frame down to `method`, so only the
 * caller's frame is captured. Without it, the whole stack of a new error is kept.
 */
export function holdCall(method: Method): HeldCall | undefined {
  const errors = Error as { captureStackTrace?: Capture; stackTraceLimit?: unknown };
  try {
    if (typeof errors.captureStackTrace !== "function") {
      return { stack: new Error().stack, whole: true };
    }
    const held: HeldCall = { whole: false };
    const limit = errors.stackTraceLimit;
    const limited = typeof limit === "number";
    if (limited) errors.stackTraceLimit = 1;
    try {
      errors.captureStackTrace(held, method);
    } finally {
      if (limited) errors.stackTraceLimit = limit;
    }
    return held;
  } catch {
    return undefined;
  }
}

/** The location a held call names, or undefined when its stack has none. */
export function readCall(held: HeldCall | undefined): CallSite | undefined {
  if (!held) return undefined;
  try {
    const stack = held.stack;
    if (typeof stack !== "string") return undefined;
    return held.whole ? callerInStack(stack) : parseStack(stack)[0];
  } catch {
    return undefined;
  }
}

/**
 * The caller's frame in a whole stack captured by `holdCall`: the first frame in neither of
 * tsdraft's two files on it, which are those of the first frame, `holdCall`'s own, and of the
 * second, the builder's. Frames are told apart by file and not counted, because an engine may
 * leave a frame out. When the caller's code is in one file with tsdraft, as in a bundle, no
 * frame qualifies and there is no location, which is better than a line inside tsdraft.
 */
export function callerInStack(stack: string): CallSite | undefined {
  const [capture, builder, ...rest] = parseStack(stack);
  return rest.find((frame) => frame.file !== capture?.file && frame.file !== builder?.file);
}

/** Keeps the calls that drew `entities`, one for each entity in order. */
export function recordCalls(
  entities: readonly object[],
  calls: readonly (HeldCall | undefined)[],
): void {
  recorded.set(entities, calls);
}

/** The call that drew the entity at `index` of `entities`, when the builder recorded it. */
export function callOf(entities: readonly object[], index: number): CallSite | undefined {
  return readCall(recorded.get(entities)?.[index]);
}

/**
 * The location of each frame of a stack, innermost first. V8 writes a frame as
 * `at name (file:1:2)` or `at file:1:2`, and Firefox and Safari as `name@file:1:2`. A line that
 * is no frame, such as the error's message, is left out.
 */
export function parseStack(stack: string): CallSite[] {
  return stack.split("\n").flatMap((line) => {
    const frame =
      /^\s*at .*?\((.+):(\d+):(\d+)\)$/.exec(line) ??
      /^\s*at (.+):(\d+):(\d+)$/.exec(line) ??
      /^[^@]*@(.+):(\d+):(\d+)$/.exec(line);
    return frame ? [{ file: frame[1]!, line: Number(frame[2]), column: Number(frame[3]) }] : [];
  });
}
