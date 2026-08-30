/**
 * What the configurator learns about a model before asking anything.
 *
 * Detection is a shortcut that pre-fills, never a prerequisite: every field here has a
 * "we don't know" value, and the scenario must work with all of them unknown.
 */

export type ScanStatus =
  | 'found'
  /** 401/403 — private or gated; a login may lift it. */
  | 'private'
  | 'not-found'
  | 'error';

export interface ModelScan {
  id: string;
  status: ScanStatus;
  /** True when the repo is readable but marked private (we were authenticated). */
  isPrivate: boolean;
  gated: boolean;
  pipelineTag: string | null;
  libraryName: string | null;
  /** ONNX weights in the repo → the browser mode is available. */
  hasOnnx: boolean;
  onnxFiles: string[];
  /**
   * The transformers.js dtypes the repo actually ships, smallest first — `['q4', 'fp32']`
   * for a repo carrying `onnx/model_q4.onnx` and `onnx/model.onnx`. Safe to pass straight
   * to `registerModel({ dtype })`: unknown suffixes are dropped, and `model_quantized.onnx`
   * is reported as `q8`, the token that loads it.
   *
   * Optional so a hand-built `ModelScan` stays valid; read it as `onnxDtypes ?? []`.
   */
  onnxDtypes?: string[];
  /**
   * What each dtype actually WEIGHS, in bytes — `{ q4: 180355072, fp32: 538968064 }`.
   *
   * The whole download for that dtype, not one file: an encoder/decoder repo ships
   * several `.onnx` files per size, and a big export ships its weights in an
   * `.onnx_data` sidecar next to a nearly empty `.onnx`. Summing them is the point —
   * the number here is what the visitor's browser will actually pull.
   *
   * A dtype appears ONLY when the Hub gave a size for every file counted towards it.
   * A missing key means "we do not know", never "it is free": read it as
   * `onnxSizes?.[dtype]` and say nothing when the answer is undefined.
   *
   * Optional so a hand-built `ModelScan` stays valid.
   */
  onnxSizes?: Record<string, number>;
  /**
   * component → the dtypes that component is published in.
   *
   * A chat model is one graph and this says so — `{ model: ['q4', 'fp32'] }`. A vision
   * model is SEVERAL graphs that load together, each with its own set of builds, and a
   * loader has to be told which build of each to fetch. That is what
   * `componentDtypes()` turns this into.
   *
   * Optional so a hand-built `ModelScan` stays valid; read it as `onnxComponents ?? {}`.
   */
  onnxComponents?: Record<string, string[]>;
  /** Inference provider names serving this model (empty = not served). */
  providers: string[];
  /** `image-text-to-text` & friends → the generated composer takes attachments. */
  supportsImage: boolean;
  /**
   * Human-readable reason when status is 'error'.
   *
   * UNTRUSTED: it can carry text the user typed (their malformed repo id) or text the Hub
   * sent back. It is bounded and stripped of `<>&"'` at the source, but it must be rendered
   * as TEXT — never assigned to `innerHTML`, never interpolated into generated markup.
   */
  error: string | null;
}

export function emptyScan(id: string): ModelScan {
  return {
    id,
    status: 'error',
    isPrivate: false,
    gated: false,
    pipelineTag: null,
    libraryName: null,
    hasOnnx: false,
    onnxFiles: [],
    onnxDtypes: [],
    onnxSizes: {},
    onnxComponents: {},
    providers: [],
    supportsImage: false,
    error: null,
  };
}

/**
 * Which build of each component to load, for one chosen precision.
 *
 * The rule is the one the weights are already counted with, and it is not arithmetic —
 * it is what "choosing q4" MEANS for a model made of several graphs: every component in
 * that dtype, and where a component was published in only one build, that build. An
 * image tower shipped once is loaded by every variant; asking for a q4 of it would ask
 * for a file that does not exist.
 *
 * Returns `null` when there is nothing to say — no components known, or the chosen dtype
 * is not one the model offers. A caller with `null` should keep passing the plain string
 * rather than invent a map.
 */
export function componentDtypes(
  scan: Pick<ModelScan, 'onnxComponents'>,
  dtype: string,
): Record<string, string> | null {
  const components = scan.onnxComponents ?? {};
  const names = Object.keys(components);
  if (names.length === 0) return null;

  const map: Record<string, string> = {};
  for (const name of names) {
    const built = components[name] ?? [];
    const wanted = UNQUANTISED_COMPONENTS.has(name) ? unquantised(built, dtype) : dtype;
    if (built.includes(wanted)) map[name] = wanted;
    else if (built.includes(dtype)) map[name] = dtype;
    else if (built.length === 1 && built[0]) map[name] = built[0];
    // A component with several builds and none of them the chosen dtype: we do not know
    // which one belongs to this variant, so we name none and let the loader default.
  }

  return Object.keys(map).length > 0 ? map : null;
}

/**
 * Components that must NOT be loaded quantised, whatever precision was chosen.
 *
 * `embed_tokens` is an embedding lookup, and a 4-bit one is exported with
 * `com.microsoft.GatherBlockQuantized`. Ask for it on a machine without a GPU and
 * onnxruntime-web answers `Failed to find kernel for GatherBlockQuantized … ep:
 * 'CPUExecutionProvider'` and the model never loads at all — seen in a browser on
 * LFM2.5-VL-450M asking for q4f16 across the board.
 *
 * This is also why the provider's own documentation writes its example as
 * `{ embed_tokens: 'fp16', vision_encoder: 'q4', decoder_model_merged: 'q4' }` rather
 * than one word for everything. It reads as a quality tip; it is a loadability rule.
 *
 * The saving lost is small — the embedding table is the least of the three graphs —
 * and a Space that does not start saves nothing at all.
 */
const UNQUANTISED_COMPONENTS = new Set(['embed_tokens']);

/** The builds that need no substituting — asking for one of these is already safe. */
const UNQUANTISED_DTYPES = new Set(['fp16', 'fp32']);

/**
 * The build to load for a part that must not be quantised.
 *
 * Someone who asked for fp32 gets fp32: substituting fp16 "because it is also
 * unquantised" would quietly hand them a smaller model than the one they chose, and be
 * a second way of announcing one thing and fetching another.
 */
function unquantised(built: string[], asked: string): string {
  if (UNQUANTISED_DTYPES.has(asked)) return asked;
  for (const safe of ['fp16', 'fp32']) if (built.includes(safe)) return safe;
  return asked;
}

// —————————————————————————————————————————————————————————————————————————————
// Bytes, in words
// —————————————————————————————————————————————————————————————————————————————

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

/** `4.7`, `1`, `172` — one decimal, and no `.0` hanging off the end of a round number. */
const oneDecimal = (value: number): string => String(Math.round(value * 10) / 10);

/**
 * A byte count as a person would say it — the one place in the product that decides.
 *
 * The rule is precision that survives being read out loud: **no decimal above 10 MB**,
 * because "172 MB" is a number you can weigh and "171.7 MB" is a number you skim past.
 * Under that, one decimal earns its place (4.7 MB and 4 MB are different sizes of small);
 * a gigabyte and up goes back to one decimal, because "1434 MB" is not how anyone thinks
 * about a download that big.
 *
 * Powers of 1024 — what a browser's own download panel counts in.
 *
 * **Returns `''` for anything it cannot state**: zero, a negative, a NaN, an Infinity.
 * That empty string is the contract. Callers test it and say NOTHING when it is empty;
 * an invented size on a "Load the model" button is worse than a button with no size at
 * all, because the second one is honest about what it does not know.
 *
 * It lives here, next to `onnxSizes`, because both the scenario (which asks about the
 * download) and the generator (which announces it on the button) have to phrase the
 * same number the same way. Two spellings of "172 MB" in one product is a bug.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < MIB) return `${Math.max(1, Math.round(bytes / KIB))} KB`;
  if (bytes < 10 * MIB) return `${oneDecimal(bytes / MIB)} MB`;
  if (bytes < GIB) return `${Math.round(bytes / MIB)} MB`;
  return `${oneDecimal(bytes / GIB)} GB`;
}

/** Which inference modes a scan makes possible, and whether it may be believed at all. */
export interface ModeAvailability {
  /**
   * True only for a scan that actually read the repo. When false, the three flags below
   * are open doors, not findings — nothing was learned.
   */
  conclusive: boolean;
  /** ONNX weights in the repo. The only mode v1 generates. */
  browser: boolean;
  providers: boolean;
  endpoint: boolean;
}

/**
 * Which inference modes a scan makes possible — the only honest reader of a `ModelScan`.
 *
 * A scan that came back 'private', 'not-found' or 'error' carries the `emptyScan()`
 * defaults, which are indistinguishable from "we looked and found nothing". So only a
 * `status === 'found'` scan is allowed to close a door: anything else leaves all three
 * open and says so with `conclusive: false`. "We could not read the repo" must never
 * reach a human as "your model has no ONNX weights".
 */
export function modesFor(scan: ModelScan | null): ModeAvailability {
  if (!scan || scan.status !== 'found') {
    return { conclusive: false, browser: true, providers: true, endpoint: true };
  }
  return {
    conclusive: true,
    browser: scan.hasOnnx,
    providers: scan.providers.length > 0,
    endpoint: true,
  };
}

/**
 * @deprecated Use {@link modesFor}. Kept as a delegating alias so existing callers keep
 * working; it used to believe an unread scan and silently close the browser mode on a 401.
 */
export function availableModes(scan: ModelScan | null): ModeAvailability {
  return modesFor(scan);
}

/** The signed-in user, or null. */
export interface HubUser {
  name: string;
  fullname: string | null;
  avatarUrl: string | null;
}
