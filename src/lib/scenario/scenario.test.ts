/**
 * The configurator, driven end to end with no browser and no clock.
 *
 * The harness below is the agent loop's essentials — call the provider, run the tool it
 * asked for, feed the result back, call again — so these tests exercise the real
 * provider, the real routing and the real handlers. Only the two edges are faked: the
 * questions (a queue of answers instead of a panel) and the port (the Hub, the
 * generator, the zip, the push).
 *
 * `pacing: 'instant'` hands the whole turn over at once, so a full configuration runs in
 * microseconds and always the same way.
 *
 * The harness records the model ids it was asked to scan, not just how many times: two
 * bugs shipped green because every assertion here counted calls and none of them looked
 * at WHICH model the config held afterwards.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AparteChatMessage,
  AparteChatRequest,
  AparteElicitationField,
  AparteElicitationRequest,
  AparteElicitationResult,
  AparteStreamEvent,
  AparteToolCall,
} from '@aparte/core';

import { ACCENT_DEFAULT, DEFAULT_CONFIG } from '../config/space-config';
import type { SpaceConfig } from '../config/space-config';
import type { GeneratedSpace } from '../generator/types';
import { generateIndexHtml } from '../generator/index-html';
import { emptyScan } from '../hub/types';
import type { HubUser, ModelScan } from '../hub/types';
import type { Lang } from '../i18n/lang';
import { setLang } from '../i18n/store.svelte';
import {
  CONFIGURATOR_SCENARIOS,
  createConfiguratorProvider,
  routeAnswer,
} from './scenario';
import { createConfiguratorTools, parseAnswer, smallestVariant } from './tools';
import type { ConfiguratorPort, ConfiguratorTool, StepAnswer } from './tools';

// ─── Fakes ───────────────────────────────────────────────────────────────────

/** One scripted answer to one question: a value, or a dismissal. */
type Answer = { value: unknown } | 'decline';

const value = (content: unknown): Answer => ({ value: content });

/** A repo that ships exactly one set of ONNX weights: the shortest happy path. */
const found = (id: string, overrides: Partial<ModelScan> = {}): ModelScan => ({
  ...emptyScan(id),
  status: 'found',
  pipelineTag: 'text-generation',
  libraryName: 'transformers',
  hasOnnx: true,
  onnxFiles: ['onnx/model_q4.onnx'],
  // The scenario reads `onnxDtypes`, never the paths: only the scan can tell a shared
  // component from a variant, because only it sees the whole tree and the sizes. A fake
  // that fills the paths and forgets the dtypes is not a scan this product would ever get.
  onnxDtypes: ['q4'],
  ...overrides,
});

const SPACE: GeneratedSpace = {
  files: [
    { path: 'index.html', content: '<!doctype html>' },
    { path: 'README.md', content: '---\ntitle: test\n---' },
  ],
  indexHtml: '<!doctype html>',
};

const label = (request: AparteElicitationRequest): string =>
  typeof request.message === 'function' ? request.message() : request.message;

interface HarnessOptions {
  /**
   * Where the run starts, relative to the FIRST question of all: the language.
   *
   * A `Lang` opens on a conversation that has already answered it — two seeded
   * messages, exactly what the transcript holds from the second turn on — and switches
   * the configurator into that language. Everything after is unchanged, so `asked` and
   * `calls` stay the record of what a test is actually about, and the assertions that
   * count the interaction budget go on counting questions about the SPACE.
   *
   * `'ask'` seeds nothing and starts before the question, for the tests that are about
   * the question itself.
   */
  language?: Lang | 'ask';
  answers?: Answer[];
  /** `deny` refuses the approval the way the built-in gate does. */
  approvals?: Array<'allow' | 'deny'>;
  scan?: (id: string, call: number) => ModelScan;
  user?: HubUser | null;
  signIn?: () => HubUser | null;
  generate?: () => GeneratedSpace;
  download?: () => string;
  push?: (name: string) => Promise<string>;
}

function createHarness(options: HarnessOptions = {}) {
  const config: SpaceConfig = { ...DEFAULT_CONFIG };
  const answers = [...(options.answers ?? [])];
  const approvals = [...(options.approvals ?? [])];
  const asked: AparteElicitationRequest[] = [];
  /** Questions the script asked that no test scripted an answer for. */
  const unanswered: string[] = [];
  const calls: string[] = [];
  const results: string[] = [];
  const texts: string[] = [];
  const pushed: string[] = [];
  /** Every id handed to the Hub, in order — the record that catches a reverted id. */
  const scanned: string[] = [];
  let generated = 0;
  let downloads = 0;
  let account: HubUser | null = options.user ?? null;

  const ask = async (request: AparteElicitationRequest): Promise<AparteElicitationResult> => {
    asked.push(request);
    const next = answers.shift();
    if (next === undefined) {
      unanswered.push(label(request));
      return { action: 'decline' };
    }
    if (next === 'decline') return { action: 'decline' };
    return { action: 'accept', content: next.value };
  };

  const port: ConfiguratorPort = {
    getConfig: () => config,
    patchConfig: (patch) => Object.assign(config, patch),
    scan: async (id) => {
      scanned.push(id);
      return options.scan ? options.scan(id, scanned.length - 1) : found(id);
    },
    generate: () => {
      generated++;
      return options.generate ? options.generate() : SPACE;
    },
    download: () => {
      downloads++;
      return options.download ? options.download() : 'space.zip';
    },
    push: async (name) => {
      pushed.push(name);
      return options.push
        ? await options.push(name)
        : `https://huggingface.co/spaces/${account?.name ?? 'anon'}/${name}`;
    },
    getUser: () => account,
    signIn: async () => {
      account = options.signIn ? options.signIn() : null;
      return account;
    },
    ask,
  };

  const provider = createConfiguratorProvider(port, { pacing: 'instant' });
  const tools = new Map<string, ConfiguratorTool>(
    createConfiguratorTools(port).map((tool) => [tool.definition.name, tool]),
  );
  const messages: AparteChatMessage[] = [];

  // The language, settled before the first message — unless the test wants to settle it
  // itself. `languageChosen()` reads the transcript rather than a flag, so seeding the
  // exchange is the whole of it: no state to fake, and the run continues exactly as it
  // would after a real answer.
  const opening = options.language ?? 'en';
  if (opening !== 'ask') {
    void setLang(opening);
    messages.push(
      {
        role: 'tool_call',
        content: '',
        toolCalls: [{ id: 'seeded-language', name: 'ask_language', input: {} }],
      },
      { role: 'tool_result', content: 'language=ok', toolCallId: 'seeded-language' },
    );
  }

  const drain = async (stream: ReadableStream<AparteStreamEvent>): Promise<AparteStreamEvent[]> => {
    const events: AparteStreamEvent[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value: event } = await reader.read();
      if (done) break;
      if (event) events.push(event);
    }
    return events;
  };

  /** One user message, played to the end of the run — every tool round-trip included. */
  const send = async (message: string): Promise<void> => {
    messages.push({ role: 'user', content: message });

    for (let turn = 0; turn < 40; turn++) {
      const request: AparteChatRequest = { messages: [...messages], modelId: 'scripted' };
      const chat = provider.chat;
      if (!chat) throw new Error('the provider has no chat()');
      const response = await chat.call(provider, request);
      if (typeof response === 'string') throw new Error('expected a stream of events');
      const events = await drain(response);

      const text = events
        .filter((event): event is AparteStreamEvent & { type: 'text' } => event.type === 'text')
        .map((event) => event.delta)
        .join('');
      if (text) texts.push(text);

      const use = events.find(
        (event): event is AparteStreamEvent & { type: 'tool_use' } => event.type === 'tool_use',
      );
      if (!use) {
        messages.push({ role: 'assistant', content: text });
        return;
      }

      const call: AparteToolCall = { id: use.id, name: use.name, input: use.input };
      messages.push({ role: 'tool_call', content: '', precedingText: text, toolCalls: [call] });

      const tool = tools.get(call.name);
      if (!tool) throw new Error(`the script called an unregistered tool: ${call.name}`);

      // The approval gate, as the client runs it: on a refusal the handler never runs
      // and core writes the result itself — prose our `match()` cannot parse.
      if (tool.definition.needsApproval && (approvals.shift() ?? 'allow') === 'deny') {
        messages.push({
          role: 'tool_result',
          content: 'Tool execution was rejected by the user.',
          toolCallId: call.id,
        });
        continue;
      }

      const result = await tool.handler(call, new AbortController().signal);
      calls.push(call.name);
      results.push(result.content);
      messages.push({ role: 'tool_result', content: result.content, toolCallId: call.id });
    }
    throw new Error('the run never settled');
  };

  return {
    config,
    send,
    asked,
    unanswered,
    calls,
    results,
    texts,
    pushed,
    scanned,
    scans: () => scanned.length,
    generated: () => generated,
    downloads: () => downloads,
    transcript: () => texts.join('\n'),
    left: () => answers.length,
    row: (prefix: string) => results.filter((line) => line.startsWith(prefix)).at(-1) ?? '',
    times: (name: string) => calls.filter((call) => call === name).length,
  };
}

const stubPort = (): ConfiguratorPort => ({
  getConfig: () => ({ ...DEFAULT_CONFIG }),
  patchConfig: () => undefined,
  scan: async (id) => emptyScan(id),
  generate: () => SPACE,
  download: () => undefined,
  push: async () => '',
});

/** The option values of an enum question. */
function optionsOf(request: AparteElicitationRequest | undefined): string[] {
  const schema = request?.schema;
  if (!schema || schema.type !== 'enum') return [];
  return schema.options.map((option) => option.value);
}

function recommendedOf(request: AparteElicitationRequest | undefined): string | undefined {
  const schema = request?.schema;
  if (!schema || schema.type !== 'enum') return undefined;
  return schema.options.find((option) => option.recommended)?.value;
}

/** What the buttons of an enum question actually SAY — where the megabytes live. */
function labelsOf(request: AparteElicitationRequest | undefined): string[] {
  const schema = request?.schema;
  if (!schema || schema.type !== 'enum') return [];
  return schema.options.map((option) => option.label ?? option.value);
}

function descriptionsOf(request: AparteElicitationRequest | undefined): string[] {
  const schema = request?.schema;
  if (!schema || schema.type !== 'enum') return [];
  return schema.options.map((option) => option.description ?? '');
}

/** One mebibyte, so a test can write a size the way `formatBytes` will read it back. */
const MB = 1048576;

/** One field of a form question. */
function fieldOf(
  request: AparteElicitationRequest | undefined,
  key: string,
): AparteElicitationField | undefined {
  const schema = request?.schema;
  if (!schema || schema.type !== 'object') return undefined;
  return schema.properties[key];
}

/** The options of one enum FIELD of a form — a language list, a theme list. */
function fieldOptionsOf(
  request: AparteElicitationRequest | undefined,
  key: string,
): Array<{ value: string; label?: string; description?: string; recommended?: boolean }> {
  const field = fieldOf(request, key);
  return field && field.type === 'enum' ? field.options : [];
}

/** The chips a stepped form shows, in order — one `header` per question. */
function headersOf(request: AparteElicitationRequest | undefined): Array<string | undefined> {
  const schema = request?.schema;
  if (!schema || schema.type !== 'object') return [];
  return Object.values(schema.properties).map((field) => field.header);
}

// A key the provider does not know streams an empty turn and warns on the console
// (0.16). Nothing here may do that, so the warning is a failure in every test.
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  // The configurator's language is module state, and a French test would otherwise
  // leave the next one speaking French.
  await setLang('en');
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});

// ─── The happy path ──────────────────────────────────────────────────────────

describe('the happy path', () => {
  it('turns a pasted model id into a downloadable Space in two clicks', async () => {
    const harness = createHarness({ answers: [value('default'), value('download')] });

    await harness.send('onnx-community/Qwen2.5-0.5B-Instruct');

    expect(harness.calls).toEqual([
      'scan_model',
      'ask_behaviour',
      'generate_files',
      'ask_outcome',
      'download_zip',
    ]);
    // One paste, two questions — the whole interaction budget.
    expect(harness.asked).toHaveLength(2);
    expect(harness.unanswered).toEqual([]);
    expect(harness.left()).toBe(0);

    expect(harness.config.modelId).toBe('onnx-community/Qwen2.5-0.5B-Instruct');
    expect(harness.config.title).toBe('Qwen2.5-0.5B-Instruct chat');
    expect(harness.scans()).toBe(1);
    expect(harness.generated()).toBe(1);
    expect(harness.downloads()).toBe(1);
    // What the visitor is promised, and the only inference story v1 tells.
    expect(harness.transcript()).toContain('no account, no token');
  });

  it('never produces anything but a browser Space', async () => {
    const harness = createHarness({ answers: [value('default'), value('download')] });

    await harness.send('acme/model');

    // The contract stays open for a later version; v1 simply never writes to it.
    expect(harness.config.mode).toBe('browser');
    expect(harness.config.endpointUrl).toBe('');
    expect(harness.asked.map(label).join(' ')).not.toContain('inference');
  });

  it('pre-fills image input from the scan instead of asking about it', async () => {
    const harness = createHarness({
      scan: (id) => found(id, { supportsImage: true, pipelineTag: 'image-text-to-text' }),
      answers: [value('default'), value('download')],
    });

    await harness.send('acme/vision-model');

    expect(harness.config.attachments).toBe(true);
    expect(harness.asked).toHaveLength(2);
  });

  it('takes the custom route when the user asks for one', async () => {
    const harness = createHarness({
      answers: [
        value('custom'),
        value({ systemPrompt: 'You explain ONNX.', greeting: 'Ask me about weights.' }),
        value('custom'),
        value({ title: 'Weights & Words', emoji: '🌘', theme: 'dark', accent: '00AAFF' }),
        value('download'),
      ],
    });

    await harness.send('acme/model');

    expect(harness.calls).toEqual([
      'scan_model',
      'ask_behaviour',
      'ask_appearance',
      'generate_files',
      'ask_outcome',
      'download_zip',
    ]);
    expect(harness.config.systemPrompt).toBe('You explain ONNX.');
    expect(harness.config.greeting).toBe('Ask me about weights.');
    expect(harness.config.title).toBe('Weights & Words');
    expect(harness.config.emoji).toBe('🌘');
    expect(harness.config.theme).toBe('dark');
    expect(harness.config.accent).toBe('#00AAFF');
  });

  it('opens the look form on the values already in the config', async () => {
    const harness = createHarness({
      answers: [value('look'), value({ accent: '#12345' }), value('download')],
    });

    await harness.send('acme/model');

    // "Change the look" IS the answer to "do you want to change the look": the form is
    // the very next thing, and the whole run is still three questions long.
    expect(harness.asked).toHaveLength(3);
    const form = harness.asked[1];
    expect(headersOf(form)).toEqual(['Title', 'Emoji', 'Theme', 'Accent', 'Language']);
    // Every field of that form shows what it is about to change — the theme included.
    expect(fieldOf(form, 'title')?.default).toBe('model chat');
    expect(fieldOf(form, 'theme')?.default).toBe('system');
    expect(fieldOf(form, 'accent')?.default).toBe(ACCENT_DEFAULT);
    // The one field that does NOT open on the current value: a Space is public on a
    // worldwide Hub, so the offer is to decide for nobody.
    expect(fieldOf(form, 'spaceLang')?.default).toBe('both');
    // Five hex digits is not a colour: the generated page would drop it silently.
    expect(harness.config.accent).toBe(ACCENT_DEFAULT);
  });

  it('still offers the look as a choice on the way out of the behaviour form', async () => {
    const harness = createHarness({
      answers: [
        value('custom'),
        value({ systemPrompt: 'You explain ONNX.' }),
        value('keep'),
        value('download'),
      ],
    });

    await harness.send('acme/model');

    // Nobody asked for the look here — it is offered, and declining it is one click.
    expect(optionsOf(harness.asked[2])).toEqual(['keep', 'custom']);
    expect(harness.calls).toContain('ask_appearance');
    expect(harness.config.title).toBe('model chat');
  });
});

// ─── Detection shapes the questions ──────────────────────────────────────────

describe('what the scan changes', () => {
  it('says plainly what a visitor gets, and asks nothing about the weights', async () => {
    const harness = createHarness({ answers: [value('default'), value('download')] });

    await harness.send('acme/model');

    expect(harness.calls).not.toContain('ask_precision');
    // The one size in the repo is the one the generated page will ask for.
    expect(harness.config.dtype).toBe('q4');
    expect(harness.transcript()).toContain('runs in the visitor’s browser');
  });

  it('takes the weights from the repo rather than from the default', async () => {
    const harness = createHarness({
      scan: (id) => found(id, { onnxFiles: ['onnx/model.onnx'], onnxDtypes: ['fp32'] }),
      answers: [value('default'), value('download')],
    });

    await harness.send('acme/full-precision');

    // The default is q4, and this repo has no such file: a Space built on the default
    // would ask the Hub for weights that do not exist.
    expect(harness.config.dtype).toBe('fp32');
    expect(harness.calls).not.toContain('ask_precision');
  });

  it('reports what it actually read: the file count, the sizes, the visibility', async () => {
    const harness = createHarness({
      scan: (id) =>
        found(id, {
          onnxFiles: ['onnx/model.onnx', 'onnx/model_q4.onnx', 'onnx/decoder_model_merged_q4.onnx'],
          onnxDtypes: ['q4', 'fp32'],
        }),
      answers: [value('q4'), value('default'), value('download')],
    });

    await harness.send('acme/many-files');

    const row = harness.row('scan=');
    expect(row).toContain('3 files, two sizes (q4, fp32)');
    expect(row).toContain('task: text-generation');
    expect(row).toContain('visibility: public');
  });

  it('names the sizes this repo ships in the question itself', async () => {
    const harness = createHarness({
      scan: (id) =>
        found(id, {
          onnxFiles: ['onnx/model.onnx', 'onnx/model_fp16.onnx', 'onnx/model_q4.onnx'],
          onnxDtypes: ['q4', 'fp16', 'fp32'],
        }),
      answers: [value('q4'), value('default'), value('download')],
    });

    await harness.send('acme/many-sizes');

    // The script above cannot hold a value; the question below it can, and does.
    expect(harness.asked.map(label).join(' ')).toContain('three sizes of weights: q4, fp16 and fp32');
  });

  it('says out loud that a vision model takes images, and switches attachments on', async () => {
    const harness = createHarness({
      scan: (id) =>
        found(id, {
          supportsImage: true,
          pipelineTag: 'image-text-to-text',
          onnxFiles: ['onnx/model_q4.onnx', 'onnx/model.onnx'],
          onnxDtypes: ['q4', 'fp32'],
        }),
      answers: [value('q4'), value('default'), value('download')],
    });

    await harness.send('acme/vision-model');

    // The vision branch, and it still asks about the weights: a vision repo with two
    // sizes is exactly where the download question matters most.
    expect(harness.calls).toContain('ask_precision');
    expect(harness.transcript()).toContain('takes images as well as text');
    expect(harness.transcript()).toContain('never leave their machine');
    expect(harness.config.attachments).toBe(true);
  });

  it('asks which weights only when the repo ships several, smallest recommended', async () => {
    const harness = createHarness({
      scan: (id) =>
        found(id, {
          onnxFiles: ['onnx/model.onnx', 'onnx/model_fp16.onnx', 'onnx/model_q4.onnx'],
          onnxDtypes: ['q4', 'fp16', 'fp32'],
        }),
      answers: [value('fp16'), value('default'), value('download')],
    });

    await harness.send('acme/many-sizes');

    expect(harness.calls).toEqual([
      'scan_model',
      'ask_precision',
      'ask_behaviour',
      'generate_files',
      'ask_outcome',
      'download_zip',
    ]);
    expect(optionsOf(harness.asked[0])).toEqual(['q4', 'fp16', 'fp32']);
    expect(recommendedOf(harness.asked[0])).toBe('q4');
    expect(harness.config.dtype).toBe('fp16');
    expect(harness.unanswered).toEqual([]);
  });

  it('asks the weight question in megabytes, not in adjectives', async () => {
    const harness = createHarness({
      scan: (id) =>
        found(id, {
          onnxFiles: ['onnx/model.onnx', 'onnx/model_q4.onnx'],
          onnxDtypes: ['q4', 'fp32'],
          onnxSizes: { q4: 172 * MB, fp32: 514 * MB },
        }),
      answers: [value('fp32'), value('default'), value('download')],
    });

    await harness.send('acme/measured');

    // The whole point of the change: "smallest" and "full precision" are opinions,
    // 172 MB against 514 MB is the decision the visitor's connection will pay for.
    expect(label(harness.asked[0]!)).toContain('q4 · 172 MB and fp32 · 514 MB');
    expect(labelsOf(harness.asked[0])).toEqual(['q4 · 172 MB', 'fp32 · 514 MB']);
    // The size is in the label, so the description drops to what the number cannot say.
    expect(descriptionsOf(harness.asked[0])[0]).toBe(
      'The shortest wait. Answers a shade rougher than the full weights.',
    );
    // And the row under the answer names the weight of what was actually chosen.
    expect(harness.row('precision=')).toContain('Weights: fp32 · 514 MB.');
  });

  it('recommends the lightest measured download even when the dtype ladder disagrees', async () => {
    const harness = createHarness({
      scan: (id) =>
        found(id, {
          onnxFiles: ['onnx/model_q4f16.onnx', 'onnx/model_int8.onnx'],
          onnxDtypes: ['q4f16', 'int8'],
          // This repo's q4f16 export is the heavy one. The ladder would still put it
          // first; the scales say otherwise, and the scales were measured.
          onnxSizes: { q4f16: 400 * MB, int8: 120 * MB },
        }),
      answers: [value('int8'), value('default'), value('download')],
    });

    await harness.send('acme/upside-down');

    expect(optionsOf(harness.asked[0])).toEqual(['q4f16', 'int8']);
    expect(recommendedOf(harness.asked[0])).toBe('int8');
    // The scan pre-fills with the same answer it recommends.
    expect(harness.config.dtype).toBe('int8');
  });

  it('keeps the old wording when the Hub never said what anything weighs', async () => {
    const harness = createHarness({
      scan: (id) => found(id, { onnxFiles: ['onnx/model.onnx', 'onnx/model_q4.onnx'], onnxDtypes: ['q4', 'fp32'] }),
      answers: [value('q4'), value('default'), value('download')],
    });

    await harness.send('acme/unmeasured');

    // No sizes, no invented megabytes — and no bare "·" left hanging in a label.
    expect(labelsOf(harness.asked[0])).toEqual(['q4 — smallest', 'fp32 — full precision']);
    expect(label(harness.asked[0]!)).not.toContain('·');
    expect(harness.row('precision=')).toContain('Weights: q4.');
  });

  it('puts the weight in the scan row, next to the size it belongs to', async () => {
    const harness = createHarness({
      scan: (id) =>
        found(id, {
          onnxFiles: ['onnx/model.onnx', 'onnx/model_q4.onnx'],
          onnxDtypes: ['q4', 'fp32'],
          // fp32 was never measured in full, so it goes back to being a bare name
          // rather than borrowing a number from its neighbour.
          onnxSizes: { q4: 172 * MB },
        }),
      answers: [value('q4'), value('default'), value('download')],
    });

    await harness.send('acme/measured');

    expect(harness.row('scan=')).toContain('two sizes (q4 · 172 MB, fp32)');
  });

  it('carries the measured weight through the config onto the generated button', async () => {
    const harness = createHarness({
      scan: (id) =>
        found(id, {
          onnxFiles: ['onnx/model.onnx', 'onnx/model_q4.onnx'],
          onnxDtypes: ['q4', 'fp32'],
          onnxSizes: { q4: 172 * MB, fp32: 514 * MB },
        }),
      answers: [value('fp32'), value('default'), value('download')],
    });

    await harness.send('acme/measured');

    // The seam this test exists for. A size the Hub reported is worth nothing until it
    // reaches the page a visitor loads, and it has to be the size of the dtype they
    // ACTUALLY chose — fp32's 514 MB, not the q4 the scan pre-filled.
    expect(generateIndexHtml(harness.config)).toContain(
      `const BAKED_BYTES = ${514 * MB}; /* 514 MB */`,
    );
  });

  it('forgets the weight when the model does, rather than reusing it', async () => {
    const harness = createHarness({
      scan: (id, call) =>
        call === 0
          ? found(id, { onnxSizes: { q4: 172 * MB } })
          : // The second repo ships weights the Hub never measured.
            found(id, { onnxFiles: ['onnx/model_q4.onnx'] }),
      answers: [value('default'), value('download'), value('default'), value('download')],
    });

    await harness.send('acme/first');
    expect(generateIndexHtml(harness.config)).toContain(`const BAKED_BYTES = ${172 * MB};`);

    await harness.send('acme/second');

    // 172 MB was true of the first repo. Printing it on the second one's button would
    // be the same lie the feature exists to stop, arriving through the back door.
    expect(generateIndexHtml(harness.config)).toContain('const BAKED_BYTES = 0;');
    expect(harness.unanswered).toEqual([]);
  });

  it('offers a converted model instead of a wall when there are no ONNX weights', async () => {
    const harness = createHarness({
      scan: (id, call) => (call === 0 ? found(id, { hasOnnx: false, onnxFiles: [], onnxDtypes: [] }) : found(id)),
      answers: [value('onnx-community/acme-model'), value('default'), value('download')],
    });

    await harness.send('acme/torch-only');

    expect(harness.calls).toEqual([
      'scan_model',
      'ask_model',
      'scan_model',
      'ask_behaviour',
      'generate_files',
      'ask_outcome',
      'download_zip',
    ]);
    // A door, not a dead end: the two ways to get ONNX weights, then the box to paste
    // an already-converted id into.
    expect(harness.transcript()).toContain('onnx-community');
    expect(harness.transcript()).toContain('Optimum');
    expect(harness.scanned).toEqual(['acme/torch-only', 'onnx-community/acme-model']);
    expect(harness.config.modelId).toBe('onnx-community/acme-model');
    expect(harness.downloads()).toBe(1);
  });

  it('never reports an unreachable Hub as a model without ONNX weights', async () => {
    const harness = createHarness({
      scan: (id) => ({ ...emptyScan(id), status: 'error', error: 'network down' }),
      answers: [value('default'), value('download')],
    });

    await harness.send('acme/model');

    expect(harness.row('scan=')).toContain('scan=error');
    expect(harness.transcript()).toContain('could not reach the Hub');
    expect(harness.transcript()).not.toContain('no ONNX weights');
    // Nothing is lost: the rest is set by hand and the files are still written.
    expect(harness.calls.at(-1)).toBe('download_zip');
  });

  it('offers a sign-in on a 401 and warns about the weights when it is refused', async () => {
    const harness = createHarness({
      scan: (id) => ({ ...emptyScan(id), status: 'private' }),
      answers: [value('manual'), value('default'), value('download')],
    });

    await harness.send('acme/secret-model');

    expect(harness.scans()).toBe(1);
    expect(harness.results[0]).toContain('scan=private');
    expect(harness.transcript()).toContain('401');
    // The consequence that matters: the weights are fetched by the visitor's browser.
    expect(harness.transcript()).toContain('fetches the weights');
  });

  it('rescans after a sign-in, and warns that visitors still get a 401', async () => {
    const harness = createHarness({
      scan: (id, call) =>
        call === 0 ? { ...emptyScan(id), status: 'private' } : found(id, { isPrivate: true }),
      signIn: () => ({ name: 'ada', fullname: 'Ada', avatarUrl: null }),
      answers: [value('signin'), value('default'), value('download')],
    });

    await harness.send('acme/secret-model');

    expect(harness.scans()).toBe(2);
    expect(harness.results[0]).toContain('Signed in as ada');
    expect(harness.row('files=')).toContain('files=ready.private');
    expect(harness.transcript()).toContain('Make the model public');
  });

  /**
   * Regression, found by a human clicking through with no model to offer: the run used
   * to answer `files=incomplete.model` and ask for the id again — and since the honest
   * answer is still "I don't have one", that was a loop with no way out. The page reads
   * MODEL_ID from the Space's variables, so publishing first and filling it in later is
   * a supported path, and the scenario already promises exactly that out loud.
   */
  it('generates a Space with no model, and does not ask again', async () => {
    const harness = createHarness({
      answers: [
        value(''), // no id after all
        value('default'), // appearance
        value('download'),
      ],
    });

    await harness.send('hello');

    expect(harness.results.some((row) => row.startsWith('files=incomplete'))).toBe(false);
    expect(harness.times('ask_model')).toBe(1);
    expect(harness.generated()).toBe(1);
    expect(harness.calls.at(-1)).toBe('download_zip');
    expect(harness.config.modelId).toBe('');
    // Both ends of that run name the one thing still to do, and where to do it.
    expect(harness.row('files=')).toContain('files=ready.no-model');
    expect(harness.row('zip=')).toContain('zip=ok.no-model');
    expect(harness.transcript()).toContain('MODEL_ID');
    expect(harness.transcript()).toContain('Settings → Variables');
  });
});

// ─── The model id, across the branches it travels through ────────────────────

describe('the model id the config ends up holding', () => {
  it('keeps the id given at ask_model instead of reverting to the pasted one', async () => {
    const harness = createHarness({
      scan: (id) => (id === 'acme/typo' ? { ...emptyScan(id), status: 'not-found' } : found(id)),
      answers: [value('acme/real'), value('default'), value('download')],
    });

    await harness.send('acme/typo');

    // The composer message stays at the end of the conversation for every call of the
    // run: re-reading it after the correction scanned the 404 again, for ever.
    expect(harness.scanned).toEqual(['acme/typo', 'acme/real']);
    expect(harness.config.modelId).toBe('acme/real');
    expect(harness.config.title).toBe('real chat');
    expect(harness.times('ask_model')).toBe(1);
    expect(harness.calls.at(-1)).toBe('download_zip');
    expect(harness.unanswered).toEqual([]);
  });

  it('drops the stale id when ask_model is answered with nothing', async () => {
    const harness = createHarness({
      scan: (id) => ({ ...emptyScan(id), status: 'not-found' }),
      answers: [value('')],
    });

    await harness.send('acme/typo');

    // The script says "we carry on without one"; the config has to agree, or the next
    // generate quietly rebuilds the Space around the id that just 404ed.
    expect(harness.config.modelId).toBe('');
    expect(harness.scanned).toEqual(['acme/typo']);
    expect(harness.transcript()).toContain('carry on without one');
  });

  it('drops the stale id when the ask_model question is dismissed', async () => {
    const harness = createHarness({
      scan: (id) => ({ ...emptyScan(id), status: 'not-found' }),
      answers: ['decline'],
    });

    await harness.send('acme/typo');

    expect(harness.config.modelId).toBe('');
    expect(harness.row('model=')).toBe('model=\nNo answer — the question was dismissed.');
  });

  it('drops the stale id when ask_model is answered with something that is not an id', async () => {
    const harness = createHarness({
      scan: (id) => ({ ...emptyScan(id), status: 'not-found' }),
      answers: [value('the small qwen one')],
    });

    await harness.send('acme/typo');

    expect(harness.config.modelId).toBe('');
    expect(harness.row('model=')).toContain('is not an owner/name id');
  });
});

// ─── Off-script ──────────────────────────────────────────────────────────────

describe('typing instead of clicking', () => {
  it('answers a question about the download size without losing the thread', async () => {
    const harness = createHarness({
      answers: [
        'decline', // the behaviour question is dismissed
        value('default'), // …and asked again after "go"
        value('download'),
      ],
    });

    await harness.send('acme/model');
    expect(harness.calls).toEqual(['scan_model', 'ask_behaviour']);
    expect(harness.transcript()).toContain('Paused');

    // "download" also appears in the zip pattern: the size answer wins because it is
    // declared first, which is the whole tie-break rule.
    await harness.send('how big is the download?');
    expect(harness.texts.at(-1)).toContain('The weights download once');
    expect(harness.calls).toEqual(['scan_model', 'ask_behaviour']); // no tool ran

    await harness.send('go');
    expect(harness.calls).toEqual([
      'scan_model',
      'ask_behaviour',
      'ask_behaviour',
      'generate_files',
      'ask_outcome',
      'download_zip',
    ]);
    expect(harness.unanswered).toEqual([]);
  });

  it('explains ONNX, and how to get it, on request', async () => {
    const harness = createHarness({ answers: ['decline'] });

    await harness.send('acme/model');
    await harness.send('what is onnx?');

    expect(harness.texts.at(-1)).toContain('transformers.js');
    expect(harness.texts.at(-1)).toContain('optimum-cli export onnx');
  });

  it('greets a first message that is not an id, then asks for one', async () => {
    const harness = createHarness({
      answers: [value('acme/model'), value('default'), value('download')],
    });

    await harness.send('hello');

    expect(harness.calls).toEqual([
      'scan_model',
      'ask_model',
      'scan_model',
      'ask_behaviour',
      'generate_files',
      'ask_outcome',
      'download_zip',
    ]);
    expect(harness.results[0]).toBe('scan=none\nNo model id to scan yet.');
    expect(harness.config.modelId).toBe('acme/model');
  });

  it('answers the four questions people ask instead of clicking, and keeps the thread', async () => {
    const harness = createHarness({ answers: ['decline', value('default'), value('download')] });

    await harness.send('acme/model');

    await harness.send('what does this cost me?');
    expect(harness.texts.at(-1)).toContain('free to host');

    await harness.send('can visitors use it on a phone?');
    expect(harness.texts.at(-1)).toContain('WebGPU where the browser offers it');

    await harness.send('what is aparté anyway?');
    expect(harness.texts.at(-1)).toContain('Web components');

    await harness.send('what is my model doing, is it private?');
    expect(harness.texts.at(-1)).toContain('401');

    // Four asides, no tool run, and the pending question is still there to resume.
    expect(harness.calls).toEqual(['scan_model', 'ask_behaviour']);

    await harness.send('go');
    expect(harness.calls.at(-1)).toBe('download_zip');
    expect(harness.unanswered).toEqual([]);
  });

  it('starts over on a new model id when asked to', async () => {
    const harness = createHarness({
      answers: ['decline', value('acme/second'), value('default'), value('download')],
    });

    await harness.send('acme/first');
    await harness.send('let us start over');

    expect(harness.transcript()).toContain('start over from any model id');
    expect(harness.scanned).toEqual(['acme/first', 'acme/second']);
    expect(harness.config.modelId).toBe('acme/second');
    expect(harness.config.title).toBe('second chat');
    expect(harness.calls.at(-1)).toBe('download_zip');
  });

  it('regenerates and shows the whole config on "recap"', async () => {
    const harness = createHarness({
      answers: [value('default'), 'decline', 'decline'],
    });
    await harness.send('acme/model');
    await harness.send('recap please');

    expect(harness.times('generate_files')).toBe(2);
    expect(harness.row('files=')).toContain('weights: q4');
    expect(harness.row('files=')).toContain('accent: #FF3E00');
    // A field that cannot vary is not worth a line.
    expect(harness.row('files=')).not.toContain('mode:');
    expect(harness.unanswered).toEqual([]);
  });
});

// ─── The way out ─────────────────────────────────────────────────────────────

describe('the outcome', () => {
  it('pushes to the account after the approval, under the name the user confirmed', async () => {
    const harness = createHarness({
      user: { name: 'ada', fullname: 'Ada Lovelace', avatarUrl: null },
      answers: [value('default'), value('push'), value('My Demo Space')],
      approvals: ['allow'],
    });

    await harness.send('acme/model');

    expect(harness.calls.at(-1)).toBe('create_space');
    expect(harness.pushed).toEqual(['my-demo-space']);
    expect(harness.row('space=')).toContain('https://huggingface.co/spaces/ada/my-demo-space');
    expect(harness.transcript()).toContain('go/no-go');
    expect(harness.transcript()).toContain('Liftoff');
    // What exists now, and the one thing to do with it.
    expect(harness.transcript()).toContain('send it one message');
  });

  it('tells a Space with no model where to put the id, after the push', async () => {
    const harness = createHarness({
      user: { name: 'ada', fullname: null, avatarUrl: null },
      answers: [value(''), value('default'), value('push'), value('demo')],
      approvals: ['allow'],
    });

    await harness.send('hello');

    expect(harness.row('space=')).toContain('space=live.no-model');
    expect(harness.row('space=')).toContain('https://huggingface.co/spaces/ada/demo');
    expect(harness.transcript()).toContain('Liftoff');
    expect(harness.transcript()).toContain('Settings → Variables');
    expect(harness.transcript()).toContain('MODEL_ID');
  });

  it('says so, and keeps the zip on the table, when the approval is refused', async () => {
    const harness = createHarness({
      user: { name: 'ada', fullname: null, avatarUrl: null },
      answers: [value('default'), value('push'), value('demo')],
      approvals: ['deny'],
    });

    await harness.send('acme/model');

    expect(harness.pushed).toEqual([]);
    expect(harness.transcript()).toContain('No push, then');
  });

  it('asks for a sign-in before pushing when there is no account', async () => {
    const harness = createHarness({ answers: [value('default'), value('push')] });

    await harness.send('acme/model');

    expect(harness.calls.at(-1)).toBe('ask_outcome');
    expect(harness.row('next=')).toContain('next=push.anon');
    expect(harness.transcript()).toContain('Sign in');
  });

  it('reports a failed push instead of pretending', async () => {
    const harness = createHarness({
      user: { name: 'ada', fullname: null, avatarUrl: null },
      answers: [value('default'), value('push'), value('demo')],
      push: async () => {
        throw new Error('403 Forbidden');
      },
    });

    await harness.send('acme/model');

    expect(harness.row('space=')).toContain('403 Forbidden');
    expect(harness.transcript()).toContain('The push failed');
  });
});

// ─── The two languages, which are two separate decisions ─────────────────────

describe('the language the configurator speaks', () => {
  it('asks first, in English, and lets the browser pre-select nothing more', async () => {
    // A French browser: `initLang()` has already switched everything over.
    await setLang('fr');
    const harness = createHarness({ language: 'ask', answers: ['decline'] });

    await harness.send('hello');

    expect(harness.calls).toEqual(['ask_language']);
    // The one turn everybody has to be able to read, whatever their browser said.
    expect(harness.texts[0]).toContain('in English so that everyone can read it');
    // The question is asked ONCE, by the field. Putting it in the bubble as well —
    // or in the panel's own message — printed it twice, one above the other.
    expect(fieldOf(harness.asked[0], 'language')?.title).toBe(
      'Which language should we do this in?',
    );
    expect(label(harness.asked[0]!)).toBe('');
    expect(harness.texts[0]!.toLowerCase()).not.toContain('which language');
    // The guess pre-selects the answer and does nothing else.
    expect(fieldOf(harness.asked[0], 'language')?.default).toBe('fr');
    // And the list demonstrates the two languages instead of labelling them: each name
    // is written in its own language, and so is the sentence under it.
    expect(fieldOptionsOf(harness.asked[0], 'language').map((option) => option.value)).toEqual([
      'en',
      'fr',
    ]);
    expect(fieldOptionsOf(harness.asked[0], 'language').map((option) => option.label)).toEqual([
      'English',
      'Français',
    ]);
    expect(fieldOptionsOf(harness.asked[0], 'language')[1]?.description).toBe(
      'Construisons votre Space.',
    );

    // Dismissed decides nothing: "go" asks again rather than keeping the guess.
    await harness.send('go');
    expect(harness.times('ask_language')).toBe(2);
  });

  it('runs the whole flow in French once French is chosen', async () => {
    const harness = createHarness({
      language: 'ask',
      answers: [value({ language: 'fr' }), value('default'), value('download')],
    });

    await harness.send('acme/model');

    expect(harness.calls).toEqual([
      'ask_language',
      'scan_model',
      'ask_behaviour',
      'generate_files',
      'ask_outcome',
      'download_zip',
    ]);
    // Asking the language first costs the pasted id nothing.
    expect(harness.scanned).toEqual(['acme/model']);
    expect(harness.row('language=')).toBe('language=ok.id\nLangue : Français.');

    // The script…
    expect(harness.transcript()).toContain('je construis le Space autour de ce modèle');
    expect(harness.transcript()).toContain('dans le navigateur du visiteur');
    expect(harness.transcript()).toContain('pas de compte, pas de jeton, rien à payer');
    // …the questions…
    expect(label(harness.asked[1]!)).toBe('Quelque chose à changer avant que je construise ?');
    expect(descriptionsOf(harness.asked[1])[0]).toContain('c’est le visiteur qui parle en premier');
    // …and the rows the tools write.
    expect(harness.row('scan=')).toContain('acme/model — trouvé.');
    expect(harness.row('scan=')).toContain('entrée image : non');
    expect(harness.row('files=')).toContain('poids : q4');
    expect(harness.row('zip=')).toContain('space.zip enregistré.');

    // The closing line included: nothing falls back to English halfway. Matched without
    // its first letter — the same sentence opens a clause in one outcome and a sentence
    // in the other, and the capital is the only difference between them.
    expect(harness.transcript()).toContain('l n’y a pas de backend à faire tourner');
    expect(harness.transcript()).not.toContain('Liftoff');
    expect(harness.unanswered).toEqual([]);
  });

  it('switches mid-run when asked, and resumes the step it interrupted', async () => {
    const harness = createHarness({
      answers: ['decline', value({ language: 'fr' }), value('default'), value('download')],
    });

    await harness.send('acme/model');
    expect(harness.calls).toEqual(['scan_model', 'ask_behaviour']);
    expect(harness.transcript()).toContain('Paused');

    await harness.send('on continue en français ?');
    expect(harness.texts.at(-1)).toContain('Français à partir d’ici');
    // A switch is not a restart: nothing was scanned again, nothing was asked again.
    expect(harness.scanned).toEqual(['acme/model']);

    await harness.send('go');
    expect(harness.calls).toEqual([
      'scan_model',
      'ask_behaviour',
      'ask_language',
      'ask_behaviour',
      'generate_files',
      'ask_outcome',
      'download_zip',
    ]);
    // The pending question came back — in the language it was asked to come back in.
    expect(label(harness.asked[2]!)).toBe('Quelque chose à changer avant que je construise ?');
    expect(harness.config.modelId).toBe('acme/model');
  });
});

describe('the language the generated Space speaks', () => {
  it('is asked with the look, and offers the answer that decides for nobody', async () => {
    const harness = createHarness({
      answers: [value('look'), value({ spaceLang: 'both' }), value('download')],
    });

    await harness.send('acme/model');

    const options = fieldOptionsOf(harness.asked[1], 'spaceLang');
    expect(options.map((option) => option.value)).toEqual(['both', 'en', 'fr']);
    expect(options.map((option) => option.label)).toEqual(['Both', 'English', 'Français']);
    expect(options.find((option) => option.recommended)?.value).toBe('both');
    // What `both` actually does, said out loud rather than implied by the word.
    expect(options[0]?.description).toContain('follows each visitor’s own browser');

    expect(harness.config.lang).toBe('both');
    expect(harness.row('appearance=')).toContain('written in both languages');
    expect(harness.row('files=')).toContain('written in: both languages');
  });

  it('is a different decision from the one about this conversation', async () => {
    const harness = createHarness({
      language: 'ask',
      answers: [
        value({ language: 'fr' }),
        value('look'),
        value({ spaceLang: 'en' }),
        value('download'),
      ],
    });

    await harness.send('acme/model');

    // French questions, an English Space. A French developer is allowed to build a demo
    // for a worldwide audience, and the reverse is just as true.
    expect(harness.config.lang).toBe('en');
    expect(label(harness.asked[3]!)).toContain('est construit');
    expect(harness.row('files=')).toContain('écrit en : English');
  });
});

// ─── The wiring itself ───────────────────────────────────────────────────────

describe('the tree', () => {
  it('only ever calls tools that exist', () => {
    const names = createConfiguratorTools(stubPort()).map((tool) => tool.definition.name);

    for (const [key, scenario] of Object.entries(CONFIGURATOR_SCENARIOS)) {
      const { turn } = scenario;
      if (typeof turn === 'string') continue;
      for (const step of turn) {
        if ('tool' in step) expect(names, `${key} calls ${step.tool}`).toContain(step.tool);
      }
    }
  });

  it('has no tool left for a mode v1 does not ship', () => {
    const names = createConfiguratorTools(stubPort()).map((tool) => tool.definition.name);

    expect(names).not.toContain('ask_mode');
    expect(names).not.toContain('ask_endpoint');
  });

  it('routes every answer a tool can produce to a scenario that exists', () => {
    const answers: StepAnswer[] = [
      { key: 'language', value: 'ok' },
      { key: 'language', value: 'ok.id' },
      { key: 'language', value: 'ok.again' },
      { key: 'language', value: '' },
      { key: 'scan', value: 'onnx' },
      { key: 'scan', value: 'onnx.variants' },
      { key: 'scan', value: 'onnx.vision' },
      { key: 'scan', value: 'onnx.vision.variants' },
      { key: 'scan', value: 'no-onnx' },
      { key: 'scan', value: 'private' },
      { key: 'scan', value: 'missing' },
      { key: 'scan', value: 'error' },
      { key: 'scan', value: 'none' },
      { key: 'model', value: 'acme/model' },
      { key: 'model', value: '' },
      { key: 'precision', value: 'q4' },
      { key: 'precision', value: '' },
      { key: 'behaviour', value: 'default' },
      { key: 'behaviour', value: 'custom' },
      { key: 'behaviour', value: 'look' },
      { key: 'behaviour', value: '' },
      { key: 'appearance', value: 'default' },
      { key: 'appearance', value: 'custom' },
      { key: 'appearance', value: '' },
      { key: 'files', value: 'ready' },
      { key: 'files', value: 'ready.no-model' },
      { key: 'files', value: 'ready.private' },
      { key: 'files', value: 'incomplete.model' },
      { key: 'files', value: 'error' },
      { key: 'next', value: 'download' },
      { key: 'next', value: 'push' },
      { key: 'next', value: 'push.anon' },
      { key: 'next', value: '' },
      { key: 'zip', value: 'ok' },
      { key: 'zip', value: 'ok.no-model' },
      { key: 'zip', value: 'error' },
      { key: 'space', value: 'live' },
      { key: 'space', value: 'live.no-model' },
      // An older row, or one written by hand: a URL is still a success.
      { key: 'space', value: 'https://huggingface.co/spaces/ada/demo' },
      { key: 'space', value: 'error' },
    ];

    for (const answer of answers) {
      const key = routeAnswer(answer);
      expect(CONFIGURATOR_SCENARIOS, `${answer.key}=${answer.value} → ${key}`).toHaveProperty(key);
    }
  });

  it('reads key=value off the first line, and nothing else', () => {
    expect(parseAnswer('precision=q4')).toEqual({ key: 'precision', value: 'q4' });
    expect(parseAnswer('model=acme/model\nModel id set to acme/model.')).toEqual({
      key: 'model',
      value: 'acme/model',
    });
    expect(parseAnswer('scan=')).toEqual({ key: 'scan', value: '' });
    expect(parseAnswer('Tool execution was rejected by the user.')).toBeNull();
    expect(parseAnswer('nonsense=1')).toBeNull();
    expect(parseAnswer('')).toBeNull();
    // The two keys v1 no longer speaks.
    expect(parseAnswer('mode=browser')).toBeNull();
    expect(parseAnswer('endpoint=https://x/v1')).toBeNull();
  });


  it('recommends the lightest download, and only trusts a complete set of sizes', () => {
    // Nothing measured: the dtype ladder is the best guess there is.
    expect(smallestVariant(['q4', 'fp16', 'fp32'])).toBe('q4');

    // Measured, and the ladder is wrong — this repo's q4f16 export is the fat one.
    expect(smallestVariant(['q4f16', 'int8', 'fp32'], { q4f16: 400, int8: 120, fp32: 900 })).toBe(
      'int8',
    );

    // Half-measured. Believing it would let a merely-known fp32 beat an unknown q4 and
    // recommend the biggest file in the repo, so the ladder wins instead.
    expect(smallestVariant(['q4', 'fp32'], { fp32: 900 })).toBe('q4');
    expect(smallestVariant(['q4', 'fp32'], { q4: 0, fp32: 900 })).toBe('q4');

    expect(smallestVariant([])).toBe('');
  });
});
