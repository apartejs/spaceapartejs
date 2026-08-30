/**
 * The configurator's tools.
 *
 * Every step of the wizard is a real aparté tool: the scripted provider calls it, the
 * loop runs the handler, and a row appears in the transcript with its input and output.
 * That is the point — a visitor watches aparté's tool-calling UI work for real, with no
 * model anywhere near it.
 *
 * Two contracts hold this module together.
 *
 * 1. **The port.** Nothing here touches the Hub, the generator, JSZip or the DOM
 *    directly: the host injects them. That is what makes the whole scenario testable
 *    with fakes and a `pacing: 'instant'` provider.
 * 2. **`key=value` on the first line of every result.** `match()` in `scenario.ts`
 *    reads it to pick the next branch — the documented "branch on what the user
 *    answered" pattern. It has to be prose because that is all a `tool_result` message
 *    carries to the provider: `structuredContent` lands on the transcript's segment for
 *    renderers, not in the conversation the provider is handed.
 *
 * v1 builds ONE kind of Space: the model runs in the visitor's browser, through
 * transformers.js and ONNX weights. There is no question about where inference runs,
 * because there is nothing to choose — and so no tool here writes `mode` or
 * `endpointUrl`. The fields stay in `SpaceConfig` for a later version; we simply never
 * produce anything but the `browser` default.
 */

import { requestUserInput } from '@aparte/core';
import type {
  AparteElicitationRequest,
  AparteElicitationResult,
  AparteTool,
  AparteToolCall,
  AparteToolContext,
  AparteToolHandler,
  AparteToolResult,
} from '@aparte/core';

import type { SpaceConfig } from '../config/space-config';
import {
  DEFAULT_CONFIG,
  isValidRepoId,
  missingFields,
  needsModelLater,
  slugify,
} from '../config/space-config';
import type { SpaceConfigWithWeights } from '../generator/index-html';
import type { GeneratedSpace } from '../generator/types';
import type { HubUser, ModelScan } from '../hub/types';
import { emptyScan } from '../hub/types';
import type { SpaceLang } from '../i18n/lang';
import { isLang, LANG_ENDONYM, LANGS } from '../i18n/lang';
import { lang, setLang } from '../i18n/store.svelte';
import type { AskModelReason } from './copy';
import { copy, suggestedTitle } from './copy';

// ─── The port: everything the scenario needs from the outside world ──────────

/** How a question reaches the user. Defaults to core's `requestUserInput`. */
export type AskUser = (request: AparteElicitationRequest) => Promise<AparteElicitationResult>;

/**
 * What the host lends the scenario.
 *
 * The host owns the `SpaceConfig` — the scenario only reads it and patches it — and
 * owns every capability that touches the network or the filesystem. A test passes fakes;
 * the Svelte app passes the real thing.
 */
export interface ConfiguratorPort {
  /** The live config. Read on every question, so options can name real values. */
  getConfig(): SpaceConfig;
  /**
   * Merge a patch into the live config.
   *
   * `SpaceConfigWithWeights` rather than `SpaceConfig`: the scan measures what the
   * chosen weights weigh, and the generated page has to announce it on its own
   * download button. That is the one fact about the Space that comes from the Hub
   * rather than from the person building it, and it travels with the config so the
   * generator stays a pure function of one argument.
   */
  patchConfig(patch: Partial<SpaceConfigWithWeights>): void;
  /** Look a model up on the Hub. Never throws for a 404 — that is a `ScanStatus`. */
  scan(modelId: string, signal?: AbortSignal): Promise<ModelScan>;
  /** Turn the current config into files and refresh the preview. */
  generate(): GeneratedSpace | Promise<GeneratedSpace>;
  /** Hand the zip to the browser. Returns the file name, when it has one. */
  download(): string | void | Promise<string | void>;
  /** Create the Space and push the files. Returns its URL. */
  push(name: string): Promise<string>;
  /** The signed-in user, or null. Absent when the host has no Hub session at all. */
  getUser?(): HubUser | null;
  /** Start a Hub sign-in. Absent when the host cannot offer one. */
  signIn?(): Promise<HubUser | null>;
  /** Ask the user. Injected in tests; defaults to core's `requestUserInput`. */
  ask?: AskUser;
}

/** A tool definition and the handler that answers it, ready for `registerTool`. */
export interface ConfiguratorTool {
  definition: AparteTool;
  handler: AparteToolHandler;
}

// ─── The result protocol ─────────────────────────────────────────────────────

/** The step a tool result reports on. The first token of `key=value`. */
export type StepKey =
  | 'language'
  | 'scan'
  | 'model'
  | 'precision'
  | 'behaviour'
  | 'appearance'
  | 'files'
  | 'next'
  | 'zip'
  | 'space';

export interface StepAnswer {
  key: StepKey;
  /** May be empty: an empty value always means "no answer", and always pauses. */
  value: string;
}

const STEP_KEYS: readonly StepKey[] = [
  'language',
  'scan',
  'model',
  'precision',
  'behaviour',
  'appearance',
  'files',
  'next',
  'zip',
  'space',
];

/**
 * Read `key=value` off the first line of a tool result.
 *
 * Returns null for anything else — which is how a result core wrote itself (a rejected
 * approval, a handler that threw) is told apart from one of ours.
 */
export function parseAnswer(content: string): StepAnswer | null {
  const firstLine = content.split('\n', 1)[0] ?? '';
  const separator = firstLine.indexOf('=');
  if (separator <= 0) return null;
  const key = firstLine.slice(0, separator);
  if (!STEP_KEYS.includes(key as StepKey)) return null;
  return { key: key as StepKey, value: firstLine.slice(separator + 1).trim() };
}

/** Build a result: the machine-readable line, then whatever a person should read. */
function answer(
  call: AparteToolCall,
  key: StepKey,
  value: string,
  prose?: string,
  structured?: Record<string, unknown>,
): AparteToolResult {
  const head = `${key}=${value}`;
  return {
    toolCallId: call.id,
    content: prose ? `${head}\n${prose}` : head,
    structuredContent: { step: key, value, ...structured },
  };
}

// ─── ONNX weights: which sizes a repo actually ships ─────────────────────────



/**
 * The variant to recommend, and the one a scan pre-fills: the lightest download.
 *
 * `onnxVariants` already orders by the dtype ladder, which is a good guess — but only a
 * guess. A repo that ships a fat `q4f16` and a lean `int8` breaks the ladder, and once
 * the Hub has told us what each one weighs there is no reason to guess at all.
 *
 * The measured order is used only when EVERY variant was measured. A half-known set would
 * let a merely-known fp32 beat an unknown q4 and recommend the biggest file in the repo —
 * so a partial answer falls back to the ladder rather than to the wrong end of it.
 */
export function smallestVariant(
  variants: readonly string[],
  sizes: Readonly<Record<string, number>> = {},
): string {
  const fallback = variants[0] ?? '';
  const weighed = variants.every((dtype) => {
    const bytes = sizes[dtype];
    return typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0;
  });
  if (!weighed) return fallback;
  return variants.reduce(
    (lightest, dtype) => ((sizes[dtype] ?? 0) < (sizes[lightest] ?? 0) ? dtype : lightest),
    fallback,
  );
}

// ─── Asking ──────────────────────────────────────────────────────────────────

/**
 * Ask, and treat "no answer" as an answer.
 *
 * `requestUserInput` REJECTS when the request ends without one — a stopped turn, a
 * question taken away, no presenter mounted. Letting that through would fail the turn
 * and leave the transcript with an error instead of a way forward, so every caller here
 * gets `null` and routes to the paused branch.
 */
async function askSafely(
  ask: AskUser,
  request: AparteElicitationRequest,
): Promise<AparteElicitationResult | null> {
  try {
    return await ask(request);
  } catch {
    return null;
  }
}

/** The value of an accepted single-field answer, trimmed; '' for anything else. */
function acceptedText(result: AparteElicitationResult | null): string {
  if (!result || result.action !== 'accept') return '';
  return typeof result.content === 'string' ? result.content.trim() : '';
}

/** The keyed values of an accepted object form; an empty record for anything else. */
function acceptedForm(result: AparteElicitationResult | null): Record<string, unknown> {
  if (!result || result.action !== 'accept') return {};
  const { content } = result;
  return typeof content === 'object' && content !== null ? (content as Record<string, unknown>) : {};
}

const text = (form: Record<string, unknown>, key: string): string => {
  const value = form[key];
  return typeof value === 'string' ? value.trim() : '';
};

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A hex colour CSS will actually honour: 3, 4, 6 or 8 digits, nothing between. */
const HEX_COLOUR = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Which ONNX branch a successful scan leads to.
 *
 * Two facts split it, and both change what is TRUE of the next paragraph: how many sizes
 * of weights the repo ships (one is nothing to ask about, several is the only question
 * the model itself earns) and whether it reads images (which turns attachments on in the
 * page we generate, and is worth saying out loud rather than doing silently).
 */
function onnxBranch(scan: ModelScan, variants: readonly string[]): string {
  if (variants.length === 0) return 'no-onnx';
  const many = variants.length > 1;
  if (scan.supportsImage) return many ? 'onnx.vision.variants' : 'onnx.vision';
  return many ? 'onnx.variants' : 'onnx';
}

/** The `reason` a step passed to `ask_model`, or the neutral opening. */
function askModelReason(given: unknown): AskModelReason {
  return given === 'converted' || given === 'missing' || given === 'restart' ? given : 'none';
}

/** A language the GENERATED page can be written in, or nothing at all. */
function spaceLangOf(value: string): SpaceLang | null {
  if (value === 'both') return value;
  return isLang(value) ? value : null;
}

// ─── The panoply ─────────────────────────────────────────────────────────────

/** No arguments: the script cannot compute any, and every value is asked for. */
const NO_INPUT = { type: 'object', properties: {} } as const;

/**
 * Drop the model and everything measured about it.
 *
 * `downloadBytes` is a fact about one repo at one dtype. Carrying it across a change of
 * model would print the old model's megabytes on the new model's download button — the
 * one failure this whole feature exists to prevent, arriving through the back door.
 */
const forgetModel: Partial<SpaceConfigWithWeights> = { modelId: '', downloadBytes: undefined };

/**
 * Build the tools for one configurator instance.
 *
 * The closure holds two things that are neither conversation state nor `SpaceConfig`:
 * the last scan (a cached network answer, read by `ask_precision` to list the weights it
 * saw) and the Space name chosen at the outcome step (a push argument, not part of the
 * Space's content). Everything that decides where the conversation goes next travels in
 * the tool results instead, so the provider itself stays stateless.
 */
export function createConfiguratorTools(port: ConfiguratorPort): ConfiguratorTool[] {
  const ask: AskUser = port.ask ?? requestUserInput;
  let lastScan: ModelScan | null = null;
  let spaceName = '';

  const target = (context: AparteToolContext | undefined): HTMLElement | null =>
    context?.target ?? null;

  const user = (): HubUser | null => port.getUser?.() ?? null;

  const canSignIn = (): boolean => typeof port.signIn === 'function';

  /** A sign-in that never throws and never blocks the flow: it either happens, or not. */
  const signIn = async (): Promise<HubUser | null> => {
    if (!port.signIn) return null;
    try {
      return await port.signIn();
    } catch {
      return null;
    }
  };

  /** A scan that never throws: a dead network is a status, not a failed turn. */
  const scanSafely = async (id: string, signal?: AbortSignal): Promise<ModelScan> => {
    try {
      return await port.scan(id, signal);
    } catch (error) {
      return { ...emptyScan(id), status: 'error', error: errorText(error) };
    }
  };

  /**
   * The title a model suggests, unless the user has one of their own.
   *
   * "One of their own" excludes the two titles we wrote ourselves: the generic fallback,
   * written the moment a config is generated without an id, and the one suggested by the
   * id currently in the config — which may be the 404 the user is in the middle of
   * correcting. Anything typed at the appearance step is theirs, and survives a rescan.
   */
  const titlePatch = (id: string): Partial<SpaceConfig> => {
    const { title, modelId } = port.getConfig();
    const ours = !title || title === suggestedTitle('') || title === suggestedTitle(modelId);
    return ours ? { title: suggestedTitle(id) } : {};
  };

  /**
   * What a successful scan pre-fills. Detection is a shortcut, never a prerequisite.
   *
   * The weights matter here: `dtype` names a FILE in the repo, so a default of `q4` on a
   * repo that only ships `model.onnx` would generate a page asking for something that is
   * not there. The lightest size the scan actually saw wins — by measured bytes when the
   * Hub gave them, by the dtype ladder when it did not — and the question, when there is
   * one, only moves it up.
   */
  const applyScan = (scan: ModelScan, variants: string[]): void => {
    const patch: Partial<SpaceConfigWithWeights> = { modelId: scan.id, ...titlePatch(scan.id) };
    if (scan.status === 'found') patch.attachments = scan.supportsImage;
    const smallest = smallestVariant(variants, scan.onnxSizes ?? {});
    if (smallest) patch.dtype = smallest;
    // Written on EVERY scan, including as `undefined` — never merely when known. A
    // rescan that lands on a repo the Hub did not measure must clear the figure, or
    // the previous model's megabytes end up on this model's download button.
    patch.downloadBytes = smallest ? scan.onnxSizes?.[smallest] : undefined;
    port.patchConfig(patch);
  };

  /** Fill in whatever the user never chose, right before the files are written. */
  const applyDefaults = (): void => {
    const config = port.getConfig();
    const patch: Partial<SpaceConfig> = {};
    if (!config.title) patch.title = suggestedTitle(config.modelId);
    if (!config.emoji) patch.emoji = DEFAULT_CONFIG.emoji;
    if (Object.keys(patch).length > 0) port.patchConfig(patch);
  };

  /** The repo name we would push under. */
  const currentSpaceName = (): string =>
    spaceName || slugify(port.getConfig().title) || 'aparte-space';

  const isPrivateModel = (): boolean =>
    lastScan !== null && (lastScan.status === 'private' || lastScan.isPrivate || lastScan.gated);

  // ── ask_language ──────────────────────────────────────────────────────────
  /**
   * The first question, and the only one whose answer changes every question after it.
   *
   * Three things make it worth its own step rather than a setting in a corner:
   *
   * - It is asked ENGLISH-side whatever the browser said. `detectLang()` pre-selects the
   *   answer and nothing more — a guess that decides on its own is not a question, and
   *   the one turn everybody has to be able to read cannot be written in a guess.
   * - It is asked through an object schema so the field carries the key `language`, which
   *   is what the host's instrument dispatches on. A single field has no key.
   * - `setLang()` is awaited before the result is written, so the row under the answer,
   *   and every paragraph the script streams afterwards, are already in the new language.
   *
   * It writes nothing to `SpaceConfig`. What the GENERATED Space is written in is a
   * different decision, asked later, and living in `config.lang`.
   */
  const askLanguage: ConfiguratorTool = {
    definition: {
      name: 'ask_language',
      description: copy.tools.ask_language,
      // `again: true` when the user asked to switch mid-conversation: same question,
      // but the answer resumes the pending step instead of opening the run.
      inputSchema: { type: 'object', properties: { again: { type: 'boolean' } } },
    },
    handler: async (call, signal, context) => {
      const again = call.input['again'] === true;
      const chosen = text(
        acceptedForm(
          await askSafely(ask, {
            message: copy.ask.language.message,
            schema: {
              type: 'object',
              required: ['language'],
              properties: {
                language: {
                  type: 'enum',
                  header: copy.ask.language.header,
                  title: copy.ask.language.title,
                  description: copy.ask.language.description,
                  allowOther: false,
                  // The guess, and only as a pre-selection.
                  default: lang.current,
                  options: LANGS.map((code) => ({
                    value: code,
                    ...copy.ask.language.option(code),
                  })),
                },
              },
            },
            signal,
            target: target(context),
          }),
        ),
        'language',
      );
      if (!isLang(chosen)) return answer(call, 'language', '', copy.result.noAnswer);

      // A locale bundle that fails to load must not take the conversation with it: the
      // store has already switched `lang.current`, which is what the copy reads, and
      // aparté's own 88 strings simply stay as they were.
      try {
        await setLang(chosen);
      } catch {
        /* the language is set; only aparté's UI strings did not follow. */
      }

      return answer(
        call,
        'language',
        again ? 'ok.again' : port.getConfig().modelId ? 'ok.id' : 'ok',
        copy.result.languageSet(chosen),
        { language: chosen },
      );
    },
  };

  // ── scan_model ────────────────────────────────────────────────────────────
  const scanModel: ConfiguratorTool = {
    definition: {
      name: 'scan_model',
      description: copy.tools.scan_model,
      inputSchema: { type: 'object', properties: { modelId: { type: 'string' } } },
    },
    handler: async (call, signal, context) => {
      const given = call.input['modelId'];
      const id = (
        typeof given === 'string' && given.trim() ? given : port.getConfig().modelId
      ).trim();
      if (!id) return answer(call, 'scan', 'none', copy.result.scanNone);

      const notes: string[] = [];
      let scan = await scanSafely(id, signal);

      // A 401 is the one obstacle a sign-in can lift, so it is the one place the scan
      // asks a question of its own instead of handing a dead end back to the script.
      if (scan.status === 'private' && canSignIn() && !user()) {
        const decision = await askSafely(ask, {
          message: copy.ask.signIn.message,
          schema: {
            type: 'enum',
            allowOther: false,
            options: [
              {
                value: 'signin',
                label: copy.ask.signIn.yes.label,
                description: copy.ask.signIn.yes.description,
                recommended: true,
              },
              {
                value: 'manual',
                label: copy.ask.signIn.no.label,
                description: copy.ask.signIn.no.description,
              },
            ],
          },
          signal,
          target: target(context),
        });
        if (acceptedText(decision) === 'signin') {
          const signedIn = await signIn();
          if (signedIn) {
            notes.push(copy.result.signedIn(signedIn.name));
            scan = await scanSafely(id, signal);
          } else {
            notes.push(copy.result.signInFailed);
          }
        }
      }

      lastScan = scan;
      // The scan already worked this out, over the WHOLE tree and with the sizes in
      // hand: it knows a shared component (an image tower) from a variant, which a list
      // of paths cannot. Recomputing it here from `onnxFiles` — a capped sample — is how
      // a 257 MB image tower once became an "fp32 variant" and the smallest download.
      const variants = scan.status === 'found' ? [...(scan.onnxDtypes ?? [])] : [];
      applyScan(scan, variants);

      const prose = (line: string): string => [line, ...notes].join('\n');
      switch (scan.status) {
        case 'found':
          // The weights decide the future: several sizes to pick from, one size and
          // nothing to ask, or no ONNX at all — which is the branch that offers a
          // converted model instead of stopping. Image support splits it once more,
          // because a page that takes attachments is a different promise.
          return answer(
            call,
            'scan',
            onnxBranch(scan, variants),
            prose(copy.result.scanFound(scan, variants)),
            { scan, variants },
          );
        case 'private':
          return answer(call, 'scan', 'private', prose(copy.result.scanPrivate(scan.id)), { scan });
        case 'not-found':
          return answer(call, 'scan', 'missing', prose(copy.result.scanMissing(scan.id)), { scan });
        default:
          return answer(call, 'scan', 'error', prose(copy.result.scanError(scan.id, scan.error)), {
            scan,
          });
      }
    },
  };

  // ── ask_model ─────────────────────────────────────────────────────────────
  const askModel: ConfiguratorTool = {
    definition: {
      name: 'ask_model',
      description: copy.tools.ask_model,
      // The one step reached from four different paragraphs — a repo that 404ed, a repo
      // with no ONNX in it, no id at all, a deliberate restart. `reason` is how the
      // script tells the question which of them it is following.
      inputSchema: { type: 'object', properties: { reason: { type: 'string' } } },
    },
    handler: async (call, signal, context) => {
      const current = port.getConfig().modelId;
      const answered = await askSafely(ask, {
        message: copy.ask.model.message[askModelReason(call.input['reason'])],
        schema: {
          type: 'string',
          placeholder: copy.ask.model.placeholder,
          required: false,
          default: current,
        },
        signal,
        target: target(context),
      });

      // Every road out of here clears the id, because every road out of here is reached
      // by a script that says "we carry on without one" — and the id we are holding is
      // the one that just 404ed. A config that keeps it would make a liar of the next
      // sentence, and would silently regenerate the same broken Space. The measured
      // weight goes with it: it was the weight of THAT model.
      const typed = acceptedText(answered);
      if (!answered || answered.action !== 'accept') {
        port.patchConfig(forgetModel);
        return answer(call, 'model', '', copy.result.noAnswer);
      }
      if (!typed) {
        port.patchConfig(forgetModel);
        return answer(call, 'model', '', copy.result.modelNone);
      }
      if (!isValidRepoId(typed)) {
        port.patchConfig(forgetModel);
        return answer(call, 'model', '', copy.result.modelInvalid(typed));
      }

      port.patchConfig({ ...forgetModel, modelId: typed, ...titlePatch(typed) });
      return answer(call, 'model', typed, copy.result.modelSet(typed));
    },
  };

  // ── ask_precision ─────────────────────────────────────────────────────────
  const askPrecision: ConfiguratorTool = {
    definition: {
      name: 'ask_precision',
      description: copy.tools.ask_precision,
      inputSchema: NO_INPUT,
    },
    handler: async (call, signal, context) => {
      const variants = lastScan ? [...(lastScan.onnxDtypes ?? [])] : [];
      // What each of them weighs, straight off the last scan. Empty when the tree gave no
      // sizes, and every reader below treats "empty" as "say nothing", never as "zero".
      const sizes = lastScan?.onnxSizes ?? {};
      // Nothing to choose is not a question: the scan already wrote the only size there
      // is, and asking would be theatre.
      if (variants.length < 2) {
        const { dtype } = port.getConfig();
        return answer(call, 'precision', dtype, copy.result.precisionKept(dtype, sizes[dtype]));
      }

      // Recommend the lightest download — measured where the Hub measured it. This is the
      // one question in the script where the right answer depends on a number, so the
      // number is in the labels rather than in an adjective above them.
      const recommended = smallestVariant(variants, sizes);
      const chosen = acceptedText(
        await askSafely(ask, {
          // The one place the sizes this repo actually ships can be named in the
          // question itself: the script above it is written, this is computed.
          message: copy.ask.precision.message(variants, sizes),
          schema: {
            type: 'enum',
            allowOther: false,
            default: recommended,
            options: variants.map((dtype) => ({
              value: dtype,
              ...copy.ask.precision.option(dtype, sizes[dtype]),
              ...(dtype === recommended ? { recommended: true } : {}),
            })),
          },
          signal,
          target: target(context),
        }),
      );
      if (!variants.includes(chosen)) {
        return answer(call, 'precision', '', copy.result.noAnswer);
      }

      // The weight follows the choice: pick fp32 and the generated button has to say
      // 514 MB, not the 172 MB of the q4 the scan pre-filled.
      const patch: Partial<SpaceConfigWithWeights> = {
        dtype: chosen,
        downloadBytes: sizes[chosen],
      };
      port.patchConfig(patch);
      return answer(call, 'precision', chosen, copy.result.precisionSet(chosen, sizes[chosen]));
    },
  };

  // ── ask_behaviour ─────────────────────────────────────────────────────────
  const askBehaviour: ConfiguratorTool = {
    definition: {
      name: 'ask_behaviour',
      description: copy.tools.ask_behaviour,
      inputSchema: NO_INPUT,
    },
    handler: async (call, signal, context) => {
      const config = port.getConfig();
      const chosen = acceptedText(
        await askSafely(ask, {
          message: copy.ask.behaviour.message,
          schema: {
            type: 'enum',
            allowOther: false,
            options: [
              {
                value: 'default',
                label: copy.ask.behaviour.defaults.label,
                description: copy.ask.behaviour.defaults.description(config),
                recommended: true,
              },
              {
                value: 'custom',
                label: copy.ask.behaviour.custom.label,
                description: copy.ask.behaviour.custom.description,
              },
              {
                value: 'look',
                label: copy.ask.behaviour.look.label,
                description: copy.ask.behaviour.look.description,
              },
            ],
          },
          signal,
          target: target(context),
        }),
      );

      if (chosen === 'default') {
        return answer(call, 'behaviour', 'default', copy.result.behaviourDefault);
      }
      if (chosen === 'look') {
        return answer(call, 'behaviour', 'look', copy.result.behaviourLook);
      }
      if (chosen !== 'custom') {
        return answer(call, 'behaviour', '', copy.result.noAnswer);
      }

      const form = acceptedForm(
        await askSafely(ask, {
          message: '',
          schema: {
            type: 'object',
            required: [],
            properties: {
              systemPrompt: {
                type: 'string',
                header: copy.ask.behaviour.systemPrompt.header,
                title: copy.ask.behaviour.systemPrompt.title,
                description: copy.ask.behaviour.systemPrompt.description,
                placeholder: copy.ask.behaviour.systemPrompt.placeholder,
                multiline: true,
                required: false,
                default: config.systemPrompt,
              },
              greeting: {
                type: 'string',
                header: copy.ask.behaviour.greeting.header,
                title: copy.ask.behaviour.greeting.title,
                description: copy.ask.behaviour.greeting.description,
                placeholder: copy.ask.behaviour.greeting.placeholder,
                required: false,
                default: config.greeting,
              },
            },
          },
          signal,
          target: target(context),
        }),
      );

      port.patchConfig({
        systemPrompt: text(form, 'systemPrompt'),
        greeting: text(form, 'greeting'),
      });
      return answer(call, 'behaviour', 'custom', copy.result.behaviourCustom(port.getConfig()));
    },
  };

  // ── ask_appearance ────────────────────────────────────────────────────────
  /**
   * The look, as four questions rather than one lump.
   *
   * An `object` schema of several fields is presented one at a time with a chip per
   * question, so each one gets a real title, a line of explanation and — this is the
   * part that matters — the value it is about to change already filled in. Every key is
   * a `SpaceConfig` field name on purpose: the composer's instruments (the swatches, the
   * emoji grid, the theme cards) recognise the question by its key.
   */
  const appearanceForm = (
    config: SpaceConfig,
    lead: string,
    signal: AbortSignal | undefined,
    context: AparteToolContext | undefined,
  ): Promise<AparteElicitationResult | null> =>
    askSafely(ask, {
      message: lead,
      schema: {
        type: 'object',
        required: [],
        properties: {
          title: {
            type: 'string',
            header: copy.ask.appearance.title.header,
            title: copy.ask.appearance.title.title,
            description: copy.ask.appearance.title.description,
            required: false,
            default: config.title,
          },
          emoji: {
            type: 'string',
            header: copy.ask.appearance.emoji.header,
            title: copy.ask.appearance.emoji.title,
            description: copy.ask.appearance.emoji.description,
            required: false,
            default: config.emoji,
          },
          theme: {
            type: 'enum',
            header: copy.ask.appearance.theme.header,
            title: copy.ask.appearance.theme.title,
            allowOther: false,
            // The only field that used to open with nothing chosen, in a form whose
            // whole point is "here is what you have, change what you like".
            default: config.theme,
            options: [
              {
                value: 'system',
                label: copy.ask.appearance.theme.system,
                description: copy.ask.appearance.theme.systemNote,
                recommended: true,
              },
              {
                value: 'light',
                label: copy.ask.appearance.theme.light,
                description: copy.ask.appearance.theme.lightNote,
              },
              {
                value: 'dark',
                label: copy.ask.appearance.theme.dark,
                description: copy.ask.appearance.theme.darkNote,
              },
            ],
          },
          accent: {
            type: 'string',
            header: copy.ask.appearance.accent.header,
            title: copy.ask.appearance.accent.title,
            description: copy.ask.appearance.accent.description,
            placeholder: copy.ask.appearance.accent.placeholder,
            required: false,
            default: config.accent,
          },
          /**
           * The SECOND language question, and the one that is not about us.
           *
           * It sits in the look form because that is where the Space stops being a
           * model and starts being a page someone reads. `both` is the default and the
           * recommendation for the reason the endonyms are: a Space is public on a
           * worldwide Hub, and its author is allowed not to decide for people they will
           * never meet — the page carries both string sets and follows each visitor's
           * own browser.
           */
          spaceLang: {
            type: 'enum',
            header: copy.ask.appearance.spaceLang.header,
            title: copy.ask.appearance.spaceLang.title,
            description: copy.ask.appearance.spaceLang.description,
            allowOther: false,
            default: 'both',
            options: [
              {
                value: 'both',
                label: copy.ask.appearance.spaceLang.both,
                description: copy.ask.appearance.spaceLang.bothNote,
                recommended: true,
              },
              {
                value: 'en',
                label: LANG_ENDONYM.en,
                description: copy.ask.appearance.spaceLang.englishNote,
              },
              {
                value: 'fr',
                label: LANG_ENDONYM.fr,
                description: copy.ask.appearance.spaceLang.frenchNote,
              },
            ],
          },
        },
      },
      signal,
      target: target(context),
    });

  const askAppearance: ConfiguratorTool = {
    definition: {
      name: 'ask_appearance',
      description: copy.tools.ask_appearance,
      // `straight: true` when the user has just asked for the look by name. Offering
      // them "use what you have / let me set them" at that point is a click that spends
      // their attention re-asking a question they have already answered.
      inputSchema: { type: 'object', properties: { straight: { type: 'boolean' } } },
    },
    handler: async (call, signal, context) => {
      applyDefaults();
      const config = port.getConfig();
      const straight = call.input['straight'] === true;

      if (!straight) {
        const chosen = acceptedText(
          await askSafely(ask, {
            message: copy.ask.appearance.message,
            schema: {
              type: 'enum',
              allowOther: false,
              options: [
                {
                  value: 'keep',
                  label: copy.ask.appearance.keep.label,
                  description: copy.ask.appearance.keep.description(config),
                  recommended: true,
                },
                {
                  value: 'custom',
                  label: copy.ask.appearance.custom.label,
                  description: copy.ask.appearance.custom.description,
                },
              ],
            },
            signal,
            target: target(context),
          }),
        );

        if (chosen === 'keep') {
          return answer(call, 'appearance', 'default', copy.result.appearanceKept(config));
        }
        if (chosen !== 'custom') {
          return answer(call, 'appearance', '', copy.result.noAnswer);
        }
      }

      const form = acceptedForm(
        await appearanceForm(config, straight ? copy.ask.appearance.form : '', signal, context),
      );

      const theme = text(form, 'theme');
      const accent = text(form, 'accent');
      const patch: Partial<SpaceConfig> = {};
      const title = text(form, 'title');
      const emoji = text(form, 'emoji');
      const spaceLang = spaceLangOf(text(form, 'spaceLang'));
      if (title) patch.title = title;
      if (emoji) patch.emoji = emoji;
      if (theme === 'light' || theme === 'dark' || theme === 'system') patch.theme = theme;
      if (HEX_COLOUR.test(accent)) patch.accent = accent.startsWith('#') ? accent : `#${accent}`;
      if (spaceLang) patch.lang = spaceLang;
      port.patchConfig(patch);

      return answer(call, 'appearance', 'custom', copy.result.appearanceKept(port.getConfig()));
    },
  };

  // ── generate_files ────────────────────────────────────────────────────────
  const generateFiles: ConfiguratorTool = {
    definition: {
      name: 'generate_files',
      description: copy.tools.generate_files,
      inputSchema: NO_INPUT,
    },
    handler: async (call) => {
      applyDefaults();
      const config = port.getConfig();
      const missing = missingFields(config);
      if (missing.length > 0) {
        // Unreachable in v1 — `applyDefaults` has just written a title and the endpoint
        // mode never ships — but a config that genuinely cannot be written should say so
        // rather than emit a broken file. A MISSING MODEL IS NOT ONE OF THOSE CASES: the
        // page reads MODEL_ID from the Space's variables, so it is generated without one
        // and says what to fill in. Asking again here is what used to loop forever.
        return answer(
          call,
          'files',
          'incomplete.model',
          copy.result.generatedIncomplete(missing, config),
          { missing },
        );
      }

      try {
        const space = await port.generate();
        const paths = space.files.map((file) => file.path);
        // Two things about a finished build are worth a paragraph rather than a line:
        // a page with no model yet (which has one more step, and it is a supported
        // path), and a private model (which would 401 every visitor). The empty id
        // wins the tie — a private repo we could not read is moot if the page is not
        // pointed at it in the first place.
        return answer(
          call,
          'files',
          needsModelLater(config) ? 'ready.no-model' : isPrivateModel() ? 'ready.private' : 'ready',
          [copy.result.generated(paths), '', copy.result.recap(config)].join('\n'),
          { paths },
        );
      } catch (error) {
        return answer(call, 'files', 'error', copy.result.generateFailed(errorText(error)));
      }
    },
  };

  // ── ask_outcome ───────────────────────────────────────────────────────────
  const askOutcome: ConfiguratorTool = {
    definition: {
      name: 'ask_outcome',
      description: copy.tools.ask_outcome,
      inputSchema: NO_INPUT,
    },
    handler: async (call, signal, context) => {
      const signedIn = user();
      const suggested = currentSpaceName();
      const chosen = acceptedText(
        await askSafely(ask, {
          message: copy.ask.outcome.message(port.getConfig()),
          schema: {
            type: 'enum',
            allowOther: false,
            options: [
              {
                value: 'download',
                label: copy.ask.outcome.download.label,
                description: copy.ask.outcome.download.description,
                ...(signedIn ? {} : { recommended: true }),
              },
              {
                value: 'push',
                label: copy.ask.outcome.push.label,
                description: signedIn
                  ? copy.ask.outcome.push.descriptionSignedIn(signedIn.name, suggested)
                  : copy.ask.outcome.push.descriptionAnonymous,
                ...(signedIn ? { recommended: true } : {}),
              },
            ],
          },
          signal,
          target: target(context),
        }),
      );

      if (chosen === 'download') {
        return answer(call, 'next', 'download', copy.result.outcomeDownload);
      }
      if (chosen !== 'push') {
        return answer(call, 'next', '', copy.result.outcomeNone);
      }

      const account = signedIn ?? (await signIn());
      if (!account) {
        return answer(call, 'next', 'push.anon', copy.result.outcomePushAnonymous);
      }

      const typed = acceptedText(
        await askSafely(ask, {
          message: copy.ask.outcome.name.message,
          schema: {
            type: 'string',
            placeholder: copy.ask.outcome.name.placeholder,
            required: false,
            default: suggested,
          },
          signal,
          target: target(context),
        }),
      );
      spaceName = slugify(typed) || suggested;
      return answer(call, 'next', 'push', copy.result.outcomePush(account.name, spaceName), {
        owner: account.name,
        name: spaceName,
      });
    },
  };

  // ── download_zip ──────────────────────────────────────────────────────────
  const downloadZip: ConfiguratorTool = {
    definition: {
      name: 'download_zip',
      description: copy.tools.download_zip,
      inputSchema: NO_INPUT,
    },
    handler: async (call) => {
      try {
        const filename = await port.download();
        // The closing line has one more thing to say when the page has no model yet:
        // where to put the id, on a Space that does not exist yet.
        return answer(
          call,
          'zip',
          needsModelLater(port.getConfig()) ? 'ok.no-model' : 'ok',
          copy.result.zipSaved(typeof filename === 'string' ? filename : undefined),
        );
      } catch (error) {
        return answer(call, 'zip', 'error', copy.result.zipFailed(errorText(error)));
      }
    },
  };

  // ── create_space ──────────────────────────────────────────────────────────
  const createSpace: ConfiguratorTool = {
    definition: {
      name: 'create_space',
      description: copy.tools.create_space,
      inputSchema: NO_INPUT,
      // The one irreversible act in the whole configurator: it writes to someone's
      // account. The loop pauses here and asks at the composer before the handler runs.
      needsApproval: true,
    },
    handler: async (call) => {
      const name = currentSpaceName();
      try {
        const url = await port.push(name);
        // The URL travels in the prose and in `structuredContent`, never in the routing
        // value: what the closing paragraph needs to know is whether the Space that just
        // went up has a model in it, and there is exactly one thing left to do when not.
        return answer(
          call,
          'space',
          needsModelLater(port.getConfig()) ? 'live.no-model' : 'live',
          copy.result.pushed(url),
          { name, url },
        );
      } catch (error) {
        return answer(call, 'space', 'error', copy.result.pushFailed(errorText(error)), { name });
      }
    },
  };

  return [
    askLanguage,
    scanModel,
    askModel,
    askPrecision,
    askBehaviour,
    askAppearance,
    generateFiles,
    askOutcome,
    downloadZip,
    createSpace,
  ];
}
