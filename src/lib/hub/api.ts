/**
 * Read-only probes against the public Hugging Face Hub API.
 *
 * Detection PRE-FILLS the configurator, it is never a prerequisite. Nothing in this
 * module throws: every failure comes back as a well-formed `ModelScan`, so the
 * scenario stays usable even when every single field is unknown.
 *
 * v1 generates exactly one kind of Space — transformers.js running in the visitor's
 * own browser — so the question this module exists to answer is "does this repo carry
 * ONNX weights, in which quantisations, and how heavy is each one?". `hasOnnx`,
 * `onnxDtypes` and `onnxSizes` are the product; the rest pre-fills a field or two.
 *
 * All of it runs in the browser — the Hub API answers with permissive CORS headers,
 * which is what lets this product have no backend at all.
 */

import { isValidRepoId } from '../config/space-config';
import { emptyScan, type ModelScan } from './types';

/**
 * The one honest way to turn a scan into "which modes are still open".
 *
 * Re-exported here so the module that produces scans also hands you the module that
 * reads them; `modesFor` itself lives next to `ModelScan` in `./types`.
 */
export { modesFor } from './types';
export type { ModeAvailability } from './types';

const HUB_API = 'https://huggingface.co/api';

/**
 * Fields the Hub only returns when explicitly expanded. Written by hand rather than
 * through `URLSearchParams` so the query string stays byte-for-byte the one that was
 * verified against the live API (`expand[]=`, unescaped brackets).
 */
const MODEL_EXPAND = [
  'inferenceProviderMapping',
  'private',
  'gated',
  'pipeline_tag',
  'library_name',
] as const;

/** Enough to prove ONNX weights exist and to show a couple of paths; not a file browser. */
const ONNX_FILE_LIMIT = 20;

/**
 * How transformers.js names the file for each `dtype`: `model.onnx` is fp32, and every
 * other dtype is `model_<suffix>.onnx`. Read backwards — from the file we found to the
 * dtype that would load it — this is exactly the list the configurator can offer.
 *
 * `q8` is the odd one out: its file has always been called `model_quantized.onnx`, so
 * both spellings map to the token `registerModel({ dtype })` actually accepts.
 */
const DTYPE_BY_SUFFIX = new Map<string, string>([
  ['q4f16', 'q4f16'],
  ['q4', 'q4'],
  ['bnb4', 'bnb4'],
  ['int8', 'int8'],
  ['uint8', 'uint8'],
  ['quantized', 'q8'],
  ['q8', 'q8'],
  ['fp16', 'fp16'],
  ['fp32', 'fp32'],
]);

/** Smallest download first — the order a browser-only Space wants them offered in. */
const DTYPE_ORDER = ['q4', 'q4f16', 'bnb4', 'int8', 'uint8', 'q8', 'fp16', 'fp32'];

/**
 * Pipeline tags whose models take an image alongside the text prompt. `image-text-to-text`
 * is the canonical one today; the others are kept because the Hub has renamed this family
 * more than once and an over-eager attachments button is a far smaller sin than a missing one.
 */
const IMAGE_PIPELINE_TAGS = new Set([
  'image-text-to-text',
  'visual-question-answering',
  'image-to-text',
  'video-text-to-text',
  'any-to-any',
]);

/**
 * Look up everything the configurator can learn about a model without asking the user.
 *
 * READ THIS BEFORE USING THE RESULT: every field other than `id`, `status` and `error` is
 * MEANINGLESS unless `status === 'found'`. A 401, a 404 or a dead network all come back
 * with the `emptyScan()` defaults — `hasOnnx: false`, `onnxDtypes: []`, `providers: []` —
 * which say "we never got to look", not "we looked and there is nothing". Route the
 * decision through {@link modesFor}, which refuses to read an inconclusive scan; telling
 * someone their model has no ONNX weights because we could not open the repo is the one
 * unforgivable bug in an ONNX-only v1.
 *
 * @param id     Hub repo id, `owner/name`.
 * @param token  Optional access token — lifts private/gated repos the user can read.
 */
export async function scanModel(id: string, token?: string): Promise<ModelScan> {
  const trimmed = id.trim();
  const scan = emptyScan(trimmed);

  if (!trimmed) {
    scan.error = 'No model id given.';
    return scan;
  }
  if (!isSafeRepoId(trimmed)) {
    // The id is echoed back so the user can see their typo — bounded and stripped of the
    // characters that would let it escape into markup on the way to the screen.
    scan.error = `"${safeText(trimmed, 60)}" is not a repo id — those look like owner/name.`;
    return scan;
  }

  const headers = authHeaders(token);
  const url = `${HUB_API}/models/${encodeRepoPath(trimmed)}?${MODEL_EXPAND.map(
    (field) => `expand[]=${field}`,
  ).join('&')}`;

  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (cause) {
    scan.error = `Could not reach the Hugging Face Hub (${describe(cause)}).`;
    return scan;
  }

  // 401/403 are not failures: they are the "sign in and I will look again" branch.
  if (response.status === 401 || response.status === 403) {
    scan.status = 'private';
    return scan;
  }
  if (response.status === 404) {
    scan.status = 'not-found';
    return scan;
  }
  if (!response.ok) {
    scan.error = await readError(response);
    return scan;
  }

  let raw: RawModel;
  try {
    raw = ((await response.json()) ?? {}) as RawModel;
  } catch (cause) {
    scan.error = `The Hub sent something we could not read (${describe(cause)}).`;
    return scan;
  }

  scan.status = 'found';
  scan.isPrivate = raw.private === true;
  scan.gated = Boolean(raw.gated); // `false` when open, "auto"/"manual" when gated.
  scan.pipelineTag = asString(raw.pipeline_tag);
  scan.libraryName = asString(raw.library_name);
  scan.providers = readProviders(raw.inferenceProviderMapping);
  scan.supportsImage = scan.pipelineTag !== null && IMAGE_PIPELINE_TAGS.has(scan.pipelineTag);

  const onnx = await listOnnxFiles(trimmed, headers);
  scan.hasOnnx = onnx.files.length > 0;
  scan.onnxFiles = onnx.files;
  scan.onnxDtypes = onnx.dtypes;
  scan.onnxSizes = onnx.sizes;

  return scan;
}

// —————————————————————————————————————————————————————————————————————————————
// Internals
// —————————————————————————————————————————————————————————————————————————————

interface RawModel {
  private?: unknown;
  gated?: unknown;
  pipeline_tag?: unknown;
  library_name?: unknown;
  inferenceProviderMapping?: unknown;
}

interface RawTreeEntry {
  type?: unknown;
  path?: unknown;
  size?: unknown;
  lfs?: unknown;
}

/** What the repo tree told us about ONNX. */
interface OnnxFindings {
  files: string[];
  dtypes: string[];
  /** dtype → total bytes; a dtype is absent unless every one of its files was measured. */
  sizes: Record<string, number>;
}

const noOnnx = (): OnnxFindings => ({ files: [], dtypes: [], sizes: {} });

function authHeaders(token?: string): Record<string, string> {
  return token && token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {};
}

/**
 * `owner/name`, and nothing that walks out of `/api/models/`.
 *
 * `isValidRepoId` allows a dot-only segment, so `../..` passes it — and the URL it builds
 * normalises to the Hub root, sending the user's `Authorization` header somewhere we never
 * meant to call. Two dots are not a repo, so they are refused here.
 */
function isSafeRepoId(id: string): boolean {
  if (!isValidRepoId(id)) return false;
  return id
    .trim()
    .split('/')
    .every((segment) => segment !== '.' && segment !== '..');
}

/**
 * Keeps the `owner/name` slash, escapes everything else.
 *
 * A dot-only segment is percent-encoded rather than passed through: `encodeURIComponent`
 * leaves `..` untouched (dots are unreserved), and the guard in `isSafeRepoId` should never
 * be the only thing standing between a typo and a path traversal.
 */
function encodeRepoPath(id: string): string {
  return id
    .split('/')
    .map((segment) =>
      segment === '.' || segment === '..' ? segment.replace(/\./g, '%2E') : encodeURIComponent(segment),
    )
    .join('/');
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message || cause.name;
  return String(cause);
}

/**
 * Text from the user or from the Hub, made fit to sit inside a sentence we display:
 * bounded, and stripped of the characters that turn a message into markup.
 */
function safeText(value: string, max: number): string {
  const cleaned = value.replace(/[<>&"']/g, '').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

/** A message worth showing a human, without leaking a token or a stack trace. */
async function readError(response: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown } | null;
    detail = asString(body?.error) ?? asString(body?.message) ?? '';
  } catch {
    detail = '';
  }
  return detail
    ? `The Hub answered ${response.status}: ${safeText(detail, 200)}`
    : `The Hub answered ${response.status}.`;
}

/**
 * `inferenceProviderMapping` is an object keyed by provider name — but it has shipped as
 * an array in the past and is simply absent for models nobody serves, so all three shapes
 * are handled. A provider counts when its status is "live"; a missing status is taken as
 * live, since "listed but unusable" is rarer than "listed and served".
 *
 * v1 never generates a provider-backed Space: this is kept because it is a fact about the
 * model worth showing, and because v1.x reopens that mode without a migration.
 */
function readProviders(mapping: unknown): string[] {
  if (!mapping) return [];
  const names: string[] = [];

  if (Array.isArray(mapping)) {
    for (const entry of mapping) {
      if (typeof entry === 'string') {
        names.push(entry);
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as { provider?: unknown; providerId?: unknown; status?: unknown };
      const name = asString(row.provider) ?? asString(row.providerId);
      if (name && isLive(row.status)) names.push(name);
    }
  } else if (typeof mapping === 'object') {
    for (const [name, value] of Object.entries(mapping as Record<string, unknown>)) {
      if (!name) continue;
      if (!value || typeof value !== 'object') {
        names.push(name);
        continue;
      }
      if (isLive((value as { status?: unknown }).status)) names.push(name);
    }
  }

  return [...new Set(names)];
}

function isLive(status: unknown): boolean {
  if (status === undefined || status === null) return true;
  return typeof status === 'string' && status.toLowerCase() === 'live';
}

/**
 * ONNX weights in the repo are what makes the whole product possible, so this is the one
 * probe worth being precise about: the full recursive tree, every `.onnx` path, the dtype
 * each of those files would be loaded as, and — the reason anyone should care — what each
 * dtype WEIGHS.
 *
 * The size is the point of the second pass. The tree endpoint reports a `size` per file
 * and we used to drop it on the floor, so a visitor clicked "Load the model" with no idea
 * whether that meant 172 MB or 800 MB. Getting it right means two things:
 *
 *   · SUM, never max. A `q4` export is `model_q4.onnx` PLUS `model_q4.onnx_data` when the
 *     weights live outside the graph, and an encoder/decoder repo ships several `.onnx`
 *     per size. The browser fetches all of them; the number has to be all of them.
 *   · Say nothing rather than guess. A dtype is reported only when every file counted
 *     towards it carried a usable size, so a partial tree comes back absent instead of
 *     understated — a download that is quietly twice the announced figure is the exact
 *     bug this function exists to prevent.
 *
 * A failed listing is NOT a "no": it comes back empty, and callers must treat an empty
 * result on an otherwise-found repo as "we could not tell" rather than as proof. That is
 * the honest limit of this call — the Hub gives us no way to distinguish a 500 on the tree
 * endpoint from a repo with no weights, so we never claim the difference.
 */
async function listOnnxFiles(id: string, headers: Record<string, string>): Promise<OnnxFindings> {
  try {
    const response = await fetch(
      `${HUB_API}/models/${encodeRepoPath(id)}/tree/main?recursive=true`,
      { headers },
    );
    if (!response.ok) return noOnnx();

    const entries = (await response.json()) as unknown;
    if (!Array.isArray(entries)) return noOnnx();

    const files: string[] = [];
    /** component → dtype → bytes, and whether every file behind that total was measured. */
    const parts = new Map<string, Map<string, { bytes: number; measured: boolean; graph: boolean }>>();

    for (const entry of entries as RawTreeEntry[]) {
      if (entry?.type === 'directory') continue;
      const path = asString(entry?.path);
      if (!path) continue;

      const lower = path.toLowerCase();
      const isGraph = lower.endsWith('.onnx');
      // `model_q4.onnx_data` is the external-weights sidecar of `model_q4.onnx` — not a
      // variant of its own (it never becomes a dtype), but almost all of the download.
      const owner = isGraph ? lower : externalDataOwner(lower);
      if (!owner) continue;

      // The path list is a sample for the UI; the maths below reads the whole tree.
      if (isGraph && files.length < ONNX_FILE_LIMIT) files.push(path);

      const { component, dtype } = splitOnnxName(owner);
      const byDtype = parts.get(component) ?? new Map();
      const row = byDtype.get(dtype) ?? { bytes: 0, measured: true, graph: false };
      // Only the `.onnx` proves a build exists. A stray `.onnx_data` whose graph is not
      // in the repo weighs something and loads nothing.
      if (isGraph) row.graph = true;
      const size = sizeOf(entry);
      if (size === null) row.measured = false;
      else row.bytes += size;
      byDtype.set(dtype, row);
      parts.set(component, byDtype);
    }

    // The dtypes on offer are the primary component's: a part with a build the model
    // itself does not have is not a variant anyone can load.
    const dtypes = new Set<string>();
    for (const [component, byDtype] of parts) {
      if (!isPrimaryComponent(component)) continue;
      for (const [dtype, row] of byDtype) if (row.graph) dtypes.add(dtype);
    }

    const ordered = sortDtypes(dtypes);
    const sizes: Record<string, number> = {};
    // What one variant weighs: every component, in THIS dtype — or in its own only
    // build when it has no such dtype (a shared image tower, a vocoder published once).
    // A single unmeasured file withholds the whole figure rather than reporting short.
    for (const dtype of ordered) {
      let bytes = 0;
      let measured = true;
      for (const byDtype of parts.values()) {
        const row = byDtype.get(dtype) ?? (byDtype.size === 1 ? [...byDtype.values()][0] : undefined);
        if (!row) continue;
        if (!row.measured) measured = false;
        bytes += row.bytes;
      }
      if (measured && bytes > 0) sizes[dtype] = bytes;
    }

    return { files, dtypes: ordered, sizes };
  } catch {
    return noOnnx();
  }
}

/**
 * `onnx/model_q4.onnx_data` → `onnx/model_q4.onnx`, and null for anything else.
 *
 * Optimum and transformers.js write the sidecar as `<name>.onnx_data`; a handful of repos
 * use `<name>.onnx.data` instead. Both spellings point at the same graph, and the weight
 * of a big export is almost entirely in there — miss it and `fp32` reports 400 KB.
 */
function externalDataOwner(lowerPath: string): string | null {
  if (lowerPath.endsWith('.onnx_data')) return lowerPath.slice(0, -'_data'.length);
  if (lowerPath.endsWith('.onnx.data')) return lowerPath.slice(0, -'.data'.length);
  return null;
}

/**
 * The bytes the Hub reports for one tree entry, or null when it reported none.
 *
 * `lfs.size` is preferred where it exists: the weights are LFS objects, and that field is
 * the size of the object itself rather than of whatever the tree happens to be holding.
 * Null is a real answer — it is what makes a dtype come back unmeasured instead of light.
 */
function sizeOf(entry: RawTreeEntry): number | null {
  const lfs = entry.lfs;
  if (lfs && typeof lfs === 'object') {
    const large = asSize((lfs as { size?: unknown }).size);
    if (large !== null) return large;
  }
  return asSize(entry.size);
}

function asSize(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * `onnx/model_q4.onnx` → `q4`, `onnx/model_quantized.onnx` → `q8`, `onnx/model.onnx` → `fp32`.
 *
 * The rule is the last underscore-separated token of the file name: a known dtype token is
 * that dtype, anything else is the full-precision export (`fp32` is what transformers.js
 * loads when no suffix is asked for). An exotic Optimum name (`model_O2.onnx`) therefore
 * reads as fp32 — the list is a hint for the configurator, not a promise about the repo.
 */
/**
 * Which component a graph belongs to, and in which dtype.
 *
 * A modern ONNX export is not one file. `onnx-community/LFM2-VL-450M-ONNX` ships three
 * graphs that load together — `decoder_model_merged`, `embed_tokens`, `vision_encoder` —
 * and publishes each of them in five dtypes. So a file name carries two facts, and both
 * matter: WHICH PART it is, and WHICH BUILD of that part.
 *
 * Read as "one file, one variant", that repo offers a 1.5 GB q4 (every part, every
 * build, added up). Read properly it offers 349 MB: the q4 of each part, once.
 *
 * The dtype suffix is the last underscore-separated token when it is one we know;
 * everything before it is the component. A name with no known suffix is the component's
 * full-precision build, which is what `model.onnx` has always meant.
 */
export interface OnnxGraph {
  component: string;
  dtype: string;
}

export function splitOnnxName(path: string): OnnxGraph {
  const base = path
    .slice(path.lastIndexOf('/') + 1)
    .toLowerCase()
    .replace(/\.onnx$/, '');
  const cut = base.lastIndexOf('_');
  if (cut > 0) {
    const suffix = base.slice(cut + 1);
    const dtype = DTYPE_BY_SUFFIX.get(suffix);
    if (dtype) return { component: base.slice(0, cut), dtype };
  }
  return { component: base, dtype: 'fp32' };
}

/**
 * The components that are a model rather than a piece of one.
 *
 * The dtypes on offer are the dtypes THIS part ships: a repo whose vision encoder has a
 * q4 build but whose decoder does not cannot be run in q4. Everything else is a part —
 * downloaded with whichever build it has, never offered as a choice of its own.
 */
const PRIMARY_COMPONENTS = ['model', 'decoder_model_merged', 'decoder_model', 'encoder_model'];

export function isPrimaryComponent(component: string): boolean {
  return PRIMARY_COMPONENTS.includes(component);
}

function sortDtypes(dtypes: Set<string>): string[] {
  return [...dtypes].sort((a, b) => {
    const left = DTYPE_ORDER.indexOf(a);
    const right = DTYPE_ORDER.indexOf(b);
    return (left < 0 ? DTYPE_ORDER.length : left) - (right < 0 ? DTYPE_ORDER.length : right);
  });
}
