/**
 * The script that IS the configurator.
 *
 * No model, no key, no network: `@aparte/provider-scenario` replays turns we wrote, the
 * real agent loop runs our tools, and the transcript looks exactly like a chat with an
 * assistant because every mechanism it shows is the real one.
 *
 * How a branch is chosen — the documented "branching on what the user answered":
 *
 * - a tool handler puts the answer on the first line of its result (`scan=onnx`);
 * - `match()` reads the last `tool_result` message and returns the KEY of the scenario
 *   that answers it — the key, never the object, which is the classic slip;
 * - nothing is remembered between calls. The conversation carries the state, so a retry
 *   on an earlier message replays that branch exactly, and a sibling branch can hold a
 *   different config without either one leaking into the other.
 *
 * Free text is not off limits: a set of `when` patterns answer the questions people
 * actually ask mid-flow — what ONNX is, how big the download is, what it costs, whether
 * a phone can run it, whether a private model works, what aparté is, help, recap, zip,
 * start over — and anything else replays the step we were on. Each of those answers ends
 * by naming the way back in, so an aside never becomes an exit.
 *
 * The shape of the run, now that v1 ships one inference mode: paste an id, read the
 * scan, accept the look, take the files. Nobody is asked where the model runs, because
 * it runs in one place — the visitor's browser.
 */

import { contentToText } from '@aparte/core';
import type {
  AparteAIProvider,
  AparteChatMessage,
  AparteChatRequest,
  AparteChatResponse,
} from '@aparte/core';
import { createScenarioProvider } from '@aparte/provider-scenario';
import type { Scenario, ScenarioPacing } from '@aparte/provider-scenario';

import { isValidRepoId } from '../config/space-config';
import type { Lang } from '../i18n/lang';
import { lang } from '../i18n/store.svelte';
import type { ScenarioCopy } from './copy';
import { copyFor } from './copy';
import type { ConfiguratorPort, ConfiguratorTool, StepAnswer } from './tools';
import { createConfiguratorTools, parseAnswer } from './tools';

/**
 * The turn cap the host must lift.
 *
 * One user message drives the whole wizard: welcome → scan → weights → behaviour →
 * generate → outcome → push is eight provider calls in a single run, and every tool
 * round-trip counts as a turn. `AparteClientOptions.maxTurns` defaults to 10 and a
 * per-tool override cannot raise the global cap — so a client built without this number
 * stops the configurator mid-sentence on the longest branches.
 *
 * ```ts
 * new AparteClient({ maxTurns: CONFIGURATOR_MAX_TURNS }).start();
 * ```
 */
export const CONFIGURATOR_MAX_TURNS = 40;

/**
 * The other cap to lift: how long a tool may take to resolve.
 *
 * Every question here is asked from inside a tool handler, so "the tool is running"
 * means "a person is deciding". `toolTimeoutMs` defaults to five minutes and the loop
 * RACES it against the handler — when it fires, the run stops where it stands. Five
 * minutes is not long for someone writing a system prompt or reading up on what ONNX is
 * and how to convert to it. Nothing is lost when it does fire (the next message resumes
 * the pending step), but it should be rare.
 */
export const CONFIGURATOR_TOOL_TIMEOUT_MS = 30 * 60 * 1000;

/** Fast enough to feel written, slow enough to read as it lands. */
const DEFAULT_PACING: ScenarioPacing = { chunk: 24, delay: 12 };

export interface ConfiguratorProviderOptions {
  /** `'instant'` in a test; the default reads as typing. */
  pacing?: ScenarioPacing | 'instant';
  /** Provider id, as core sees it. */
  id?: string;
}

// ─── The tree ────────────────────────────────────────────────────────────────

/**
 * One branch: a paragraph, and optionally the tool it hands over to.
 *
 * `input` is how a step tells a shared tool which paragraph it is following — the same
 * `ask_model` box asks for a converted id after a repo with no ONNX in it, and for a
 * correction after a 404. The script cannot compute a value, but it can name a case.
 */
const say = (text: string, tool?: string, input?: Record<string, unknown>): Scenario =>
  tool === undefined
    ? { turn: [{ text }] }
    : { turn: [{ text }, input === undefined ? { tool } : { tool, input }] };

/**
 * The patterns that catch a typed aside — ONE set, shared by both languages.
 *
 * They are not copy: a pattern is not read by anyone, and a French speaker who types
 * "combien ça coûte" and an English one who types "what does this cost" are asking the
 * same question and get the same paragraph — in whichever language the configurator is
 * currently speaking. Keeping one set here is also what lets `matchesWhen` be asked of
 * either tree and answer the same thing.
 *
 * Two traps, both paid for once. `\b` is defined on ASCII word characters, so it never
 * closes a French word that ends in an accent — hence the alternatives that open with
 * `\b` and stop without one. And `\bgo\b` belongs to NOBODY: "go" is how someone resumes
 * a paused step, and a pattern that swallowed it would make the way back unreachable
 * (which is why "Mo" and "Go", the French byte units, are not in `size`).
 */
const WHEN = {
  language:
    /(\blangues?\b|\blanguage\b|\bfran[çc]ais|\benglish\b|\banglais\b|\bin (french|english)\b)/i,
  help: /(\b(help|how does this work|what can i (say|do)|stuck)\b|\b(aide|secours)\b|comment (ça|ca) marche|je suis perdu)/i,
  onnx: /\b(onnx|transformers\.?js|webgpu|wasm|convert|conversion|optimum|quantis|quantifi)/i,
  size: /(\b(size|sizes|how (big|large|heavy|long)|megabytes?|gigabytes?|mb|gb|bandwidth|weights?)\b|\b(tailles?|poids|lourd|m[ée]gaoctets?|gigaoctets?|t[ée]l[ée]chargement)\b|\bp[èe]se|bande passante)/i,
  cost: /(\b(cost|costs|price|pricing|free|bill|billed|billing|pay|paid|charge|charged|money|budget|credits?|quota|subscription)\b|\b(prix|tarifs?|gratuit|payant|budget|cr[ée]dits?|abonnement)\b|\bco[ûu]te?|\bpay(er|e)|\bfactur|\bgratuit)/i,
  phone: /(\b(phone|phones|mobile|tablet|ipad|iphone|android|laptop|device|devices|hardware|ram)\b|\b(portable|tablette|ordinateur|appareils?|mat[ée]riel)\b|\bt[ée]l[ée]phone|\bm[ée]moire)/i,
  private: /(\b(private|gated|401|unauthorized|permission)\b|\b(restreint|autorisation)\b|\bpriv[ée])/i,
  // No trailing `\b` on the first alternative: `\b` is defined on ASCII word
  // characters, so "aparté " has no boundary after its é and the pattern that looked
  // right never matched the product's own name.
  aparte:
    /(\bapart[eé]|\bwho (are you|made|built)\b|\bwhat (is|are) you\b|\bwhich library\b|\bqui es-tu\b|\bquelle biblioth[èe]que\b)/i,
  recap: /(\b(recap|summary|summarise|summarize|where are we|current config|status)\b|\br[ée]cap|\bo[ùu] en (est-on|sommes-nous)|configuration actuelle)/i,
  restart:
    /(\b(start over|start again|begin again|restart|reset|from scratch|another model|different model)\b|\brecommenc|\bred[ée]marr|\brepartir de z[ée]ro|\b(un )?autre mod[èe]le\b|\bnouveau mod[èe]le\b)/i,
  zip: /(\b(zip|download|archive)\b|\bt[ée]l[ée]charger)/i,
} as const;

/**
 * Every branch, by key, for ONE language.
 *
 * A key is reached from a tool result (through `match`) or from a `when` pattern
 * (through the default rule) — never from a counter, which is what keeps the whole
 * thing replayable. Built once per language at module load, because a scenario step
 * carries a resolved string: the provider streams `text`, it does not call a function.
 */
function buildScenarios(c: ScenarioCopy): Record<string, Scenario> {
  const script = c.script;
  return {
    // E0 — the door, and the one question that decides how everything after it is
    // written. `default` is what the provider falls back to, so the language question
    // is it: nothing else can be said until we know which words to say it in. This
    // branch and the next are ENGLISH in both trees — see `copy/en.ts`.
    default: say(script.language, 'ask_language'),
    language_id: say(script.languageWithId, 'ask_language'),

    // E0b — the welcome, in the language that was just chosen. Two of them for the
    // same reason as ever: a paragraph that ignores the id already in the box would be
    // asking for something it has been given.
    language_set: say(script.welcome, 'scan_model'),
    language_set_id: say(script.welcomeWithId, 'scan_model'),
    // Switched mid-run: one line, no tool. The next message resumes the pending step.
    language_changed: say(script.languageChanged),

    welcome_id: say(script.welcomeWithId, 'scan_model'),

    // E1 — what the Hub said. The ONNX weights decide the whole branch: they are what
    // makes the Space run with no account and no key, so their absence is the one
    // obstacle worth a paragraph of its own. Four flavours of good news, because a
    // sentence that cannot hold a number has to earn its place by being true of THIS
    // repo: one size or several, images or text only.
    scan_onnx: say(script.scanOnnx, 'ask_behaviour'),
    scan_onnx_variants: say(script.scanOnnxVariants, 'ask_precision'),
    scan_onnx_vision: say(script.scanOnnxVision, 'ask_behaviour'),
    scan_onnx_vision_variants: say(script.scanOnnxVisionVariants, 'ask_precision'),
    scan_no_onnx: say(script.scanNoOnnx, 'ask_model', { reason: 'converted' }),
    scan_private: say(script.scanPrivate, 'ask_behaviour'),
    scan_missing: say(script.scanMissing, 'ask_model', { reason: 'missing' }),
    scan_error: say(script.scanError, 'ask_behaviour'),
    scan_none: say(script.scanNone, 'ask_model', { reason: 'none' }),

    model_set: say(script.modelSet, 'scan_model'),
    model_none: say(script.modelNone, 'ask_behaviour'),

    // E2 — the only thing left to choose about the model, and only when the repo ships
    // more than one size of it.
    precision_set: say(script.precisionSet, 'ask_behaviour'),

    // E3 — behaviour and looks, both skippable in one click. "Change the look" goes
    // STRAIGHT to the five questions: someone who has just asked for the look does not
    // need to be asked whether they want it.
    behaviour_default: say(script.behaviourDefault, 'generate_files'),
    behaviour_custom: say(script.behaviourCustom, 'ask_appearance'),
    behaviour_look: say(script.behaviourLook, 'ask_appearance', { straight: true }),
    appearance_done: say(script.appearanceDone, 'generate_files'),

    // The two consequences worth saying before shipping: a page with no model yet, and
    // a model the visitor's browser will not be allowed to fetch.
    files_ready: say(script.filesReady, 'ask_outcome'),
    files_ready_no_model: say(script.filesReadyNoModel, 'ask_outcome'),
    files_ready_private: say(script.filesReadyPrivate, 'ask_outcome'),
    files_incomplete_model: say(script.filesIncompleteModel, 'ask_model', { reason: 'none' }),
    files_error: say(script.filesError),

    // E4 — out the door, and the last thing anyone reads. Both endings come in two:
    // with a model, and with the one step left when there is not one yet.
    outcome_download: say(script.outcomeDownload, 'download_zip'),
    outcome_push: say(script.outcomePush, 'create_space'),
    outcome_push_anon: say(script.outcomePushAnon),
    downloaded: say(script.downloaded),
    downloaded_no_model: say(script.downloadedNoModel),
    download_error: say(script.downloadError),
    pushed: say(script.pushed),
    pushed_no_model: say(script.pushedNoModel),
    push_error: say(script.pushError),
    push_rejected: say(script.pushRejected),

    paused: say(script.paused),

    // Off-script, on purpose: the questions people ask instead of clicking, each
    // answered properly and each ending with the way back into the flow. Order is the
    // tie-break — the provider takes the FIRST `when` that matches, so "how big is the
    // download" is a question about size, not a request for the zip, and "what does
    // WebGPU cost me" is about ONNX rather than about money.
    //
    // The language switch is declared first because it is the only one that changes
    // what the OTHER answers would have been written in.
    language_again: { when: WHEN.language, ...say(script.languageAgain, 'ask_language', { again: true }) },
    help: { when: WHEN.help, ...say(script.help) },
    onnx: { when: WHEN.onnx, ...say(script.onnx) },
    size: { when: WHEN.size, ...say(script.size) },
    cost: { when: WHEN.cost, ...say(script.cost) },
    phone: { when: WHEN.phone, ...say(script.phone) },
    private: { when: WHEN.private, ...say(script.private) },
    aparte: { when: WHEN.aparte, ...say(script.aparte) },
    recap: { when: WHEN.recap, ...say(script.recap, 'generate_files') },
    restart: { when: WHEN.restart, ...say(script.restart, 'ask_model', { reason: 'restart' }) },
    zip: { when: WHEN.zip, ...say(script.zip, 'download_zip') },
  };
}

/**
 * The whole tree, once per language.
 *
 * Typed `Record<Lang, …>` rather than built from a loop: adding a language to `Lang`
 * should fail HERE, at compile time, rather than stream an empty turn at whoever
 * chose it.
 */
const SCENARIOS_BY_LANG: Record<Lang, Record<string, Scenario>> = {
  en: buildScenarios(copyFor('en')),
  fr: buildScenarios(copyFor('fr')),
};

/** English, and the shape every other tree has: the keys are what routing names. */
const SCENARIOS = SCENARIOS_BY_LANG.en;

// ─── Routing ─────────────────────────────────────────────────────────────────

const SCAN_BRANCH: Record<string, string> = {
  onnx: 'scan_onnx',
  'onnx.variants': 'scan_onnx_variants',
  'onnx.vision': 'scan_onnx_vision',
  'onnx.vision.variants': 'scan_onnx_vision_variants',
  'no-onnx': 'scan_no_onnx',
  private: 'scan_private',
  missing: 'scan_missing',
  error: 'scan_error',
  none: 'scan_none',
};

const FILES_BRANCH: Record<string, string> = {
  ready: 'files_ready',
  'ready.no-model': 'files_ready_no_model',
  'ready.private': 'files_ready_private',
  'incomplete.model': 'files_incomplete_model',
};

/** Branches that end by asking something — the only ones worth resuming to. */
const ASKS_SOMETHING = new Set(
  Object.entries(SCENARIOS)
    .filter(([, scenario]) => {
      const { turn } = scenario;
      return typeof turn !== 'string' && turn.some((step) => 'tool' in step);
    })
    .map(([key]) => key),
);

/** Branches that are an ending, not a dead end: replay the closing line, ask nothing. */
const CLOSING = new Set(['downloaded', 'downloaded_no_model', 'pushed', 'pushed_no_model']);

/** Which branch a tool's answer leads to. An empty value always pauses. */
export function routeAnswer({ key, value }: StepAnswer): string {
  switch (key) {
    // The opening question, and the one that can also be asked again mid-run — which
    // is the whole difference between the three: a fresh answer opens the flow, a
    // second one resumes whatever it interrupted.
    case 'language':
      return value === 'ok.again'
        ? 'language_changed'
        : value === 'ok.id'
          ? 'language_set_id'
          : value === 'ok'
            ? 'language_set'
            : 'paused';
    case 'scan':
      return SCAN_BRANCH[value] ?? 'scan_error';
    case 'model':
      return value ? 'model_set' : 'model_none';
    case 'precision':
      return value ? 'precision_set' : 'paused';
    case 'behaviour':
      return value === 'default'
        ? 'behaviour_default'
        : value === 'custom'
          ? 'behaviour_custom'
          : value === 'look'
            ? 'behaviour_look'
            : 'paused';
    case 'appearance':
      return value ? 'appearance_done' : 'paused';
    case 'files':
      return FILES_BRANCH[value] ?? 'files_error';
    case 'next':
      return value === 'download'
        ? 'outcome_download'
        : value === 'push'
          ? 'outcome_push'
          : value === 'push.anon'
            ? 'outcome_push_anon'
            : 'paused';
    // The two endings, each in two: a Space with a model in it, and one still waiting
    // for its MODEL_ID. Anything unrecognised but non-empty is still a success — the
    // closing line matters more than the sub-case.
    case 'zip':
      return value === 'ok.no-model'
        ? 'downloaded_no_model'
        : value === 'error' || !value
          ? 'download_error'
          : 'downloaded';
    case 'space':
      return value === 'error'
        ? 'push_error'
        : value === 'live.no-model'
          ? 'pushed_no_model'
          : value
            ? 'pushed'
            : 'paused';
    default:
      return 'paused';
  }
}

/** The tool a `tool_result` answers — the call with that id, in the turn before. */
function toolNameOf(messages: AparteChatMessage[], toolCallId: string | undefined): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const call = messages[i]?.toolCalls?.find((toolCall) => toolCall.id === toolCallId);
    if (call) return call.name;
  }
  return undefined;
}

/**
 * Where a tool result leads.
 *
 * A result we cannot parse was written by core, not by us: a refused approval, a handler
 * that threw, a call the loop skipped. The only one worth its own branch is the refusal
 * of the push — the single irreversible act here, and the one a person is most likely to
 * say no to on purpose.
 */
function routeResult(message: AparteChatMessage, messages: AparteChatMessage[]): string {
  const parsed = parseAnswer(contentToText(message.content));
  if (parsed) return routeAnswer(parsed);
  return toolNameOf(messages, message.toolCallId) === 'create_space' ? 'push_rejected' : 'paused';
}

/**
 * The step to replay after an aside — what "go" means.
 *
 * The last branch that actually asks something, walking back past the ones that only
 * said a sentence: a dismissed question, a failed push, a config that would not
 * generate. Without that walk, "go" replays the dead end that stopped us and the
 * conversation cannot leave it. An ending — the zip saved, the Space live — is not a
 * dead end, so it simply says its last line again.
 */
function resumeKey(messages: AparteChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== 'tool_result') continue;
    const parsed = parseAnswer(contentToText(message.content));
    if (!parsed) continue;
    const key = routeAnswer(parsed);
    if (CLOSING.has(key)) return key;
    if (ASKS_SOMETHING.has(key)) return key;
  }
  return 'default';
}

/** Does any scenario's `when` claim this message? Then let the default rule have it. */
function matchesWhen(text: string, scenarios: Record<string, Scenario>): boolean {
  return Object.values(scenarios).some((scenario) => {
    const { when } = scenario;
    if (when === undefined) return false;
    return typeof when === 'string' ? text.toLowerCase().includes(when.toLowerCase()) : when.test(text);
  });
}

/**
 * Has the language been settled in THIS conversation?
 *
 * Read off the transcript rather than kept in a variable, for the same reason nothing
 * else here is remembered: a retry on an earlier message has to replay that branch
 * exactly, and a flag set on the way past would answer for a turn that never happened.
 * An empty value — the question dismissed — does not count, so "go" asks it again.
 */
function languageChosen(messages: AparteChatMessage[]): boolean {
  return messages.some((message) => {
    if (message.role !== 'tool_result') return false;
    const parsed = parseAnswer(contentToText(message.content));
    return parsed?.key === 'language' && parsed.value !== '';
  });
}

/**
 * Pick the scenario for one call. Returns a KEY, or `undefined` to hand the call to the
 * provider's own rule (which is how the `when` patterns above get their turn).
 */
export function matchScenario(
  request: AparteChatRequest,
  scenarios: Record<string, Scenario>,
): string | undefined {
  const messages = request.messages;
  const last = messages[messages.length - 1];
  if (!last) return 'default';
  if (last.role === 'tool_result') return routeResult(last, messages);
  if (last.role !== 'user') return undefined;

  const typed = contentToText(last.content).trim();
  // Before anything else, including the `when` patterns: we cannot answer an aside in
  // a language nobody has chosen. A pasted id is not lost — `captureTypedModelId` has
  // already put it in the config, and the branch below says so out loud.
  if (!languageChosen(messages)) return isValidRepoId(typed) ? 'language_id' : 'default';
  // A message shaped like a repo id IS an answer: take it, wherever we are.
  if (isValidRepoId(typed)) return 'welcome_id';
  if (matchesWhen(typed, scenarios)) return undefined;
  return resumeKey(messages);
}

// ─── The provider ────────────────────────────────────────────────────────────

/**
 * The composer is the only place free text arrives, and a repo id typed into it is the
 * answer to the first question. Recording it here — before the turn plays — is what lets
 * `scan_model` run without asking again.
 *
 * It reads the request and writes the host's config: nothing is kept on the provider, so
 * replaying an old turn recomputes the same thing.
 *
 * Only when the user message is the LAST one in the request, which is the only call it
 * is new on. A run is many provider calls and the composer message stays at the end of
 * the conversation for all of them — so walking back to "the last user message" and
 * re-applying it made every later call undo the id the user had just chosen at
 * `ask_model`: an elicitation answer is not a user message, so the id they corrected was
 * silently reverted to the one they had pasted, and the same 404 was scanned again.
 */
function captureTypedModelId(request: AparteChatRequest, port: ConfiguratorPort): void {
  const last = request.messages[request.messages.length - 1];
  if (last?.role !== 'user') return;
  const typed = contentToText(last.content).trim();
  if (isValidRepoId(typed) && port.getConfig().modelId !== typed) {
    port.patchConfig({ modelId: typed });
  }
}

/**
 * The scripted provider that drives the configurator.
 *
 * ONE provider per language behind a single façade, and the language is read at the top
 * of every call. A scenario step carries a resolved string — `{ text }`, never a
 * function — so the tree cannot be re-read after it is handed over; picking the tree
 * per call is what makes the sentence AFTER the language question come out in the
 * language that question just chose.
 */
export function createConfiguratorProvider(
  port: ConfiguratorPort,
  options: ConfiguratorProviderOptions = {},
): AparteAIProvider {
  const providers = new Map<Lang, AparteAIProvider>();
  const providerFor = (code: Lang): AparteAIProvider => {
    const existing = providers.get(code);
    if (existing) return existing;
    const made = createScenarioProvider({
      id: options.id ?? 'configurator',
      name: 'Configurator script',
      pacing: options.pacing ?? DEFAULT_PACING,
      scenarios: SCENARIOS_BY_LANG[code],
      match: matchScenario,
    });
    providers.set(code, made);
    return made;
  };

  // Built eagerly so the metadata below has something to read, and so a provider with
  // no `chat()` is a startup error rather than a silent first turn.
  const first = providerFor(lang.current);
  if (!first.chat) throw new Error('The scenario provider must expose chat().');

  return {
    id: first.id,
    getMetadata: () => first.getMetadata(),
    getModels: () => first.getModels(),
    fetchModels: async () => first.getModels(),
    chat: (
      request: AparteChatRequest,
      config?: string | Record<string, string>,
      ctx?: { providerId: string; signal?: AbortSignal },
    ): Promise<AparteChatResponse> => {
      captureTypedModelId(request, port);
      const inner = providerFor(lang.current);
      const chat = inner.chat;
      if (!chat) throw new Error('The scenario provider must expose chat().');
      return chat.call(inner, request, config, ctx);
    },
  };
}

/**
 * Everything the host has to register, in one call.
 *
 * ```ts
 * const { provider, tools, maxTurns, toolTimeoutMs } = createConfigurator(port);
 * aparteGlobalConfig.registerAIProvider(provider);
 * for (const { definition, handler } of tools) aparteGlobalConfig.registerTool(definition, handler);
 * registerDefaultRenderers();
 * new AparteClient({ maxTurns, toolTimeoutMs }).start();
 * ```
 *
 * Four things the host owns and this module cannot do for it:
 *
 * - **`<aparte-elicitation>` must be inside the `<aparte-chat>`.** It is the presenter;
 *   without one every question rejects with `no-presenter` and each step pauses.
 * - **`maxTurns`**, above — the default of 10 is smaller than the longest branch.
 * - **`toolTimeoutMs`**, above — the default of five minutes is a deadline on a person.
 * - **The composer stays the way in.** A single choice answers on click by default
 *   (0.16), which is what makes the happy path two clicks; leave `answerOnClick` on.
 *   `copy.entry` holds the empty-state line and the placeholder that invite the first
 *   message — the script cannot say them, since it only speaks once someone has typed.
 *
 * Nothing else: with one provider registered and one model in it, 0.16 selects it on
 * its own, so no `setModelConfig` call is needed.
 */
export function createConfigurator(
  port: ConfiguratorPort,
  options: ConfiguratorProviderOptions = {},
): {
  provider: AparteAIProvider;
  tools: ConfiguratorTool[];
  maxTurns: number;
  toolTimeoutMs: number;
} {
  return {
    provider: createConfiguratorProvider(port, options),
    tools: createConfiguratorTools(port),
    maxTurns: CONFIGURATOR_MAX_TURNS,
    toolTimeoutMs: CONFIGURATOR_TOOL_TIMEOUT_MS,
  };
}

/** Exported for the test: the whole tree, by key. English — the routing names these. */
export const CONFIGURATOR_SCENARIOS = SCENARIOS;

/** Exported for the test: every tree, so a language cannot go missing a branch. */
export const CONFIGURATOR_SCENARIOS_BY_LANG = SCENARIOS_BY_LANG;
