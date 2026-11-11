// The JSON that `tsdraft render` prints and `tsdraft dev` serves as /state.json. Agents program
// against it, so a change here is a change to the interface.
import type { Diagnostic, DxfVersion, Entity, Units } from "tsdraft";

/** The result of one build of a drawing file. */
export interface BuildState {
  /** The shape of this object. It goes up when a field changes meaning or goes away. */
  readonly schema: 2;
  /**
   * Whether the file ran and its default export gave a drawing. Lint errors do not make it false.
   * `render` also reports false when it could not write the SVG or PNG, with `error.name`
   * `Output`; then `drawing` and `diagnostics` still describe the drawing.
   */
  readonly ok: boolean;
  /**
   * Counts builds since the command started. `render` always reports 1. In `tsdraft dev` a number
   * can be skipped: a build that read a file changed while it ran is thrown away and run again.
   */
  readonly build: number;
  /**
   * Changes each time the command starts, so a `build` number from before a restart is not
   * mistaken for one after it.
   */
  readonly session: string;
  /**
   * In `tsdraft dev`, the number the next build will have while one is queued or running, which
   * means this state is about to be replaced; `null` when this is the latest. Always `null` from
   * `render`.
   */
  readonly pending: number | null;
  /**
   * The build whose drawing `outputs` point at. Equal to `build` when `ok`. After a failed build
   * in `tsdraft dev`, it is the last build that worked, whose drawing stays on screen; `null`
   * when none has.
   */
  readonly shownBuild: number | null;
  /** Absolute path of the drawing file, with symlinks resolved. */
  readonly file: string;
  /** When the build finished, as an ISO 8601 time. */
  readonly finishedAt: string;
  /** Milliseconds from the start of the build to the SVG being ready, or to the failure. */
  readonly ms: number;
  /** Where those milliseconds went. Missing steps did not run. */
  readonly timings: Timings;
  /** What the drawing holds. `null` when the build failed. */
  readonly drawing: DrawingSummary | null;
  /**
   * What `lint` reports for the drawing, errors first. When the file threw a `DrawingError`, as
   * `toDXF` and the builder do, its diagnostics, without `kind` and `bounds`. Otherwise empty
   * when the build failed.
   */
  readonly diagnostics: readonly BuildDiagnostic[];
  /** Why the build failed. `null` when `ok`. */
  readonly error: BuildError | null;
  /**
   * The pictures. `render` gives file paths. `dev` gives URLs of the drawing on screen, which
   * after a failed build is the last good one, naming its session and build so that a picture
   * from another is refused. `null` when there is none. `pngError` says why there is no PNG
   * beside an SVG: the PNG renderer is an optional dependency, and it is not installed or has no
   * build for this machine. The build is still `ok`. Otherwise `pngError` is `null`.
   */
  readonly outputs: {
    readonly svg: string | null;
    readonly png: string | null;
    readonly pngError: string | null;
  };
  /** What the drawing file printed to stdout and stderr, cut to its last 8,000 characters. */
  readonly log: string;
}

/**
 * A lint diagnostic. For an entity problem, `layer` is the layer the entity names, `kind` and
 * `bounds` say what and where it is, `id` is the entity's id when it has one, and `call` is the
 * call in the drawing's code that drew it. For a problem the builder threw, `call` is the call
 * that threw. The `file` of a `call` is an absolute path, as `error.file` is.
 */
export interface BuildDiagnostic extends Diagnostic {
  readonly kind?: Entity["kind"];
  /** The box around the entity, in drawing units, worked out as `extents` is. */
  readonly bounds?: Box;
}

export interface Box {
  readonly min: readonly [x: number, y: number];
  readonly max: readonly [x: number, y: number];
}

export interface Timings {
  /** Starting the child process that runs the file, up to its first line of work. */
  readonly start?: number;
  /** Importing the drawing file and calling its default export. */
  readonly load?: number;
  readonly lint?: number;
  readonly svg?: number;
  /** Rasterizing the PNG, when one was asked for. Not counted in `ms`. */
  readonly png?: number;
}

export interface DrawingSummary {
  readonly units: Units;
  readonly dxf: DxfVersion;
  /**
   * The smallest box around the entities on layers that are on, thawed and set to plot, in
   * drawing units, as `toSVG` works it out. A build that draws the layers that do not plot
   * counts their entities too. It is
   * approximate: an arc counts as its whole circle, and text as 0.6 of its height per letter.
   */
  readonly extents: Box;
  readonly counts: {
    readonly layers: number;
    readonly entities: number;
    readonly errors: number;
    readonly warnings: number;
  };
  /** Each layer in the drawing's order, with the number of entities that name it exactly. */
  readonly layers: readonly LayerSummary[];
}

export interface LayerSummary {
  readonly name: string;
  /** AutoCAD Color Index. */
  readonly color: number;
  /** The linetype its entities draw with ByLayer. */
  readonly linetype: string;
  /** The lineweight its entities draw with ByLayer, in millimetres. */
  readonly lineweight: number | "Default";
  /** An off or frozen layer's entities are left out of the pictures and the extents. */
  readonly off: boolean;
  readonly frozen: boolean;
  /**
   * False for a layer that does not plot. Its entities are left out too, unless the build was
   * asked to draw such layers.
   */
  readonly plot: boolean;
  readonly entities: number;
}

export interface BuildError {
  /**
   * `Error`, `SyntaxError`, `Timeout` when the file ran too long, `Exit` when its process died,
   * `Output` when `render` could not write a picture.
   */
  readonly name: string;
  readonly message: string;
  /** Node's error code, such as `ERR_INVALID_TYPESCRIPT_SYNTAX`, when it has one. */
  readonly code: string | null;
  /**
   * Where to fix it: the innermost line of the stack that is in a file of the project, outside
   * node_modules. A throw inside tsdraft lands on the call that led to it. `null` when the error
   * points at no file of the project.
   */
  readonly file: string | null;
  readonly line: number | null;
  readonly column: number | null;
  /** The error's stack as Node printed it, or `""`. */
  readonly stack: string;
}
