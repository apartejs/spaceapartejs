/**
 * The tool rows, held to their contract.
 *
 * These are DOM tests without a chat: a segment is built by hand, handed to the
 * registered renderer, and the resulting element is interrogated. Five things are worth
 * testing here and the rest is styling.
 *
 * 1. **A row says what happened, at rest.** The readout lives in the summary; a test that
 *    only asserted `textContent` of the whole element would pass on a row that hid every
 *    fact behind the disclosure. So the assertions read `.tool-row__gist`.
 * 2. **A scan that could not read the repo never reads as an empty repo.** The one
 *    sentence in this file that would be a lie, and the reason `modesFor()` exists.
 * 3. **Untrusted text stays text.** A Hub error and a repo id are attacker-influenced;
 *    the row must produce text nodes, never elements.
 * 4. **The status is honoured.** Pending, awaiting-approval, rejected, aborted and failed
 *    each have their own row, and none of them invents a result.
 * 5. **`update` patches in place.** A reader who opened a row keeps it open when the
 *    result lands — the whole reason the renderer implements `update` at all.
 */

import { describe, expect, it } from 'vitest';
import type { AparteToolCallSegment, AparteToolRenderer } from '@aparte/core';

import { setLang } from '../i18n/store.svelte';

import {
  formatBytes,
  installToolRenderers,
  safeHttpUrl,
  spaceRepoId,
  utf8Length,
  type ToolRendererOptions,
  type ToolRowHost,
} from './tool-renderers';

// ─── Fixtures ────────────────────────────────────────────────────────────────

interface Fitted {
  host: ToolRowHost;
  registered: string[];
  renderers: Map<string, AparteToolRenderer>;
}

function fit(options: Omit<ToolRendererOptions, 'host'> = {}): Fitted {
  const renderers = new Map<string, AparteToolRenderer>();
  const registered: string[] = [];
  const host: ToolRowHost = {
    registerToolRenderer(name, renderer) {
      registered.push(name);
      renderers.set(name, renderer);
    },
  };
  installToolRenderers({ ...options, host });
  return { host, registered, renderers };
}

const segment = (
  name: string,
  over: Partial<AparteToolCallSegment> = {},
): AparteToolCallSegment => ({
  id: 'seg-1',
  type: 'tool_call',
  status: 'resolved',
  toolCall: { id: 'call-1', name, input: {} },
  ...over,
});

/**
 * Render one segment through the renderer registered for its tool.
 *
 * Two contracts are asserted here rather than in a test of their own, because every case
 * below depends on them: a row is an ELEMENT (there is no innerHTML surface in this file,
 * which is the whole XSS argument) and it is a `<details>` (the readout is at rest, the
 * detail is behind the disclosure).
 */
function draw(fitted: Fitted, seg: AparteToolCallSegment): HTMLDetailsElement {
  const renderer = fitted.renderers.get(seg.toolCall.name);
  if (!renderer) throw new Error(`no renderer for ${seg.toolCall.name}`);
  const out = renderer.render(seg);
  if (typeof out === 'string') throw new Error('a row must be an element, never a string of markup');
  if (!(out instanceof HTMLDetailsElement)) throw new Error('a row must be a <details>');
  return out;
}

const gist = (row: HTMLElement): string => row.querySelector('.tool-row__gist')?.textContent ?? '';
const state = (row: HTMLElement): string =>
  row.querySelector('.aparte-tool-state')?.textContent ?? '';
const detail = (row: HTMLElement): string =>
  row.querySelector('.tool-row__detail')?.textContent ?? '';

/** A `ModelScan`-shaped object, as `structuredContent` carries it. */
const scan = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'onnx-community/whisper-tiny',
  status: 'found',
  isPrivate: false,
  gated: false,
  pipelineTag: 'automatic-speech-recognition',
  libraryName: 'transformers.js',
  hasOnnx: true,
  onnxFiles: ['onnx/model_q4.onnx', 'onnx/model.onnx'],
  onnxDtypes: ['q4', 'fp32'],
  providers: [],
  supportsImage: false,
  error: null,
  ...over,
});

// ─── Installation ────────────────────────────────────────────────────────────

describe('installToolRenderers', () => {
  it('registers a renderer for every tool that has a readout, and no others', () => {
    const { registered } = fit();
    expect(registered.sort()).toEqual(
      [
        'ask_appearance',
        'ask_behaviour',
        'ask_model',
        'ask_outcome',
        'ask_precision',
        'create_space',
        'download_zip',
        'generate_files',
        'scan_model',
      ].sort(),
    );
  });

  it('leaves an unregistered tool to the library default', () => {
    const { renderers } = fit();
    // No renderer means core draws its own row — the documented way to opt out.
    expect(renderers.has('ask_user')).toBe(false);
    expect(renderers.has('web_search')).toBe(false);
  });

  it('is idempotent, and a later call still hands over the facts it carries', () => {
    const fitted = fit();
    installToolRenderers({ host: fitted.host, files: () => [{ path: 'index.html', content: 'x' }] });
    expect(fitted.registered).toHaveLength(9);

    const row = draw(
      fitted,
      segment('generate_files', { structuredResult: { value: 'ready', paths: ['index.html'] } }),
    );
    expect(gist(row)).toContain('1 B');
  });
});

// ─── scan_model ──────────────────────────────────────────────────────────────

describe('scan_model', () => {
  it('reads the repo, the verdict, the weights, the task and the vision flag', () => {
    const row = draw(
      fit(),
      segment('scan_model', {
        structuredResult: { step: 'scan', value: 'onnx.variants', scan: scan(), variants: ['q4', 'fp32'] },
      }),
    );

    const text = gist(row);
    expect(text).toContain('onnx-community/whisper-tiny');
    expect(text).toContain('ships ONNX weights');
    // The weight is the point of the chip: q4 and fp32 are a download eight times apart.
    expect(text).toContain('q4');
    expect(text).toContain('4-bit');
    expect(text).toContain('fp32');
    expect(text).toContain('32-bit');
    expect(text).toContain('automatic-speech-recognition');
    expect(text).not.toContain('vision');
    expect(row.dataset['tone']).toBe('ok');
    expect(state(row)).toBe('Scanned');
  });

  it('flags a vision model, because the generated page takes attachments', () => {
    const row = draw(
      fit(),
      segment('scan_model', {
        structuredResult: {
          value: 'onnx.vision',
          scan: scan({ supportsImage: true, pipelineTag: 'image-text-to-text' }),
          variants: ['q4'],
        },
      }),
    );
    expect(gist(row)).toContain('vision');
  });

  it('says a repo ships no ONNX weights only when it actually read the repo', () => {
    const row = draw(
      fit(),
      segment('scan_model', {
        structuredResult: {
          value: 'no-onnx',
          scan: scan({ hasOnnx: false, onnxFiles: [], onnxDtypes: [] }),
          variants: [],
        },
      }),
    );
    expect(gist(row)).toContain('no ONNX weights');
    expect(row.dataset['tone']).toBe('warn');
  });

  it('never lets a 401 read as an empty repo', () => {
    const row = draw(
      fit(),
      segment('scan_model', {
        structuredResult: { value: 'private', scan: scan({ status: 'private', hasOnnx: false, onnxFiles: [], onnxDtypes: [] }) },
      }),
    );
    const text = gist(row);
    expect(text).toContain('401');
    expect(text).toContain('nothing could be read');
    expect(text).not.toContain('no ONNX weights');
    expect(state(row)).toBe('Locked');
  });

  it('tells a 404 apart from an unreachable Hub', () => {
    const missing = draw(
      fit(),
      segment('scan_model', {
        structuredResult: { value: 'missing', scan: scan({ status: 'not-found' }) },
      }),
    );
    expect(gist(missing)).toContain('404');
    expect(state(missing)).toBe('No repo');

    const dead = draw(
      fit(),
      segment('scan_model', {
        structuredResult: {
          value: 'error',
          scan: scan({ status: 'error', error: 'Failed to fetch' }),
        },
      }),
    );
    expect(gist(dead)).toContain('could not be reached');
    expect(gist(dead)).toContain('Failed to fetch');
    expect(state(dead)).toBe('Unreachable');
  });

  it('renders an untrusted error and an untrusted id as text, never as markup', () => {
    const nasty = '<img src=x onerror=alert(1)>';
    const row = draw(
      fit(),
      segment('scan_model', {
        structuredResult: {
          value: 'error',
          scan: scan({ id: `owner/${nasty}`, status: 'error', error: nasty }),
        },
      }),
    );
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('script')).toBeNull();
    expect(gist(row)).toContain(nasty);
  });

  it('names the model it is looking up while it runs', () => {
    const row = draw(
      fit(),
      segment('scan_model', {
        status: 'pending',
        toolCall: { id: 'call-1', name: 'scan_model', input: { modelId: 'owner/model' } },
      }),
    );
    expect(gist(row)).toContain('owner/model');
    expect(state(row)).toBe('Running');
    expect(row.querySelector('.aparte-tool-spinner')?.hasAttribute('hidden')).toBe(false);
  });

  it('says nothing about weights when the call was stopped or declined', () => {
    for (const [status, word] of [
      ['aborted', 'Stopped'],
      ['rejected', 'Declined'],
    ] as const) {
      const row = draw(fit(), segment('scan_model', { status }));
      expect(state(row)).toBe(word);
      expect(gist(row)).not.toContain('ONNX');
      expect(row.querySelector('.aparte-tool-spinner')?.hasAttribute('hidden')).toBe(true);
    }
  });

  it('shows the crash line when the handler threw', () => {
    const row = draw(
      fit(),
      segment('scan_model', { status: 'failed', result: 'TypeError: fetch is not a function' }),
    );
    expect(state(row)).toBe('Failed');
    expect(gist(row)).toContain('TypeError: fetch is not a function');
    expect(row.dataset['tone']).toBe('bad');
  });

  it('opens onto the full readout and the arguments the model chose', () => {
    const row = draw(
      fit(),
      segment('scan_model', {
        toolCall: { id: 'call-1', name: 'scan_model', input: { modelId: 'onnx-community/whisper-tiny' } },
        result: 'scan=onnx.variants\nonnx-community/whisper-tiny — found.',
        structuredResult: { value: 'onnx.variants', scan: scan(), variants: ['q4', 'fp32'] },
      }),
    );
    const text = detail(row);
    expect(text).toContain('automatic-speech-recognition');
    expect(text).toContain('transformers.js');
    expect(text).toContain('public');
    expect(text).toContain('Input');
    expect(text).toContain('Result');
    expect(row.dataset['empty']).toBe('false');
  });
});

// ─── generate_files ──────────────────────────────────────────────────────────

describe('generate_files', () => {
  const built = [
    { path: 'index.html', content: 'a'.repeat(4200) },
    { path: 'README.md', content: 'b'.repeat(800) },
  ];

  it('lists every file with its size, and a total', () => {
    const row = draw(
      fit({ files: () => built }),
      segment('generate_files', {
        structuredResult: { value: 'ready', paths: ['index.html', 'README.md'] },
      }),
    );
    const text = gist(row);
    expect(text).toContain('index.html');
    expect(text).toContain('4.2 kB');
    expect(text).toContain('README.md');
    expect(text).toContain('800 B');
    expect(text).toContain('5.0 kB');
    expect(state(row)).toBe('Written');

    const opened = detail(row);
    expect(opened).toContain('total');
    expect(opened).toContain('5.0 kB');
  });

  it('counts the files rather than inventing a size when the host lent none', () => {
    const row = draw(
      fit(),
      segment('generate_files', {
        structuredResult: { value: 'ready', paths: ['index.html', 'README.md', 'style.css'] },
      }),
    );
    expect(gist(row)).toContain('3 files');
    expect(gist(row)).not.toContain('kB');
    expect(gist(row)).not.toContain(' B');
  });

  it('reports an incomplete config and a refused generation apart', () => {
    const incomplete = draw(
      fit(),
      segment('generate_files', {
        structuredResult: { value: 'incomplete.model', missing: ['title'] },
      }),
    );
    expect(gist(incomplete)).toContain('still missing: title');
    expect(incomplete.dataset['tone']).toBe('warn');

    const failed = draw(fit(), segment('generate_files', { structuredResult: { value: 'error' } }));
    expect(state(failed)).toBe('Failed');
    expect(failed.dataset['tone']).toBe('bad');
  });
});

// ─── create_space ────────────────────────────────────────────────────────────

describe('create_space', () => {
  const live = segment('create_space', {
    structuredResult: {
      value: 'live',
      name: 'whisper-tiny-space',
      url: 'https://huggingface.co/spaces/paul/whisper-tiny-space',
    },
  });

  it('gives the Space as a real link, safely opened', () => {
    const row = draw(fit(), live);
    const anchor = row.querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('href')).toBe('https://huggingface.co/spaces/paul/whisper-tiny-space');
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('noreferrer noopener');
    // The repo id, in the Hub's own face.
    expect(anchor?.textContent).toBe('paul/whisper-tiny-space');
    expect(anchor?.classList.contains('tool-row__mono')).toBe(true);
    expect(state(row)).toBe('Live');
  });

  it('does not let following the link toggle the disclosure', () => {
    const row = draw(fit(), live);
    let bubbled = 0;
    row.addEventListener('click', () => {
      bubbled += 1;
    });
    row.querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(bubbled).toBe(0);
  });

  it('refuses a URL that is not http(s)', () => {
    const row = draw(
      fit(),
      segment('create_space', {
        // A URL nobody should ever get an href for — the point of the test.
        structuredResult: { value: 'live', name: 'evil', url: 'javascript:alert(1)' },
      }),
    );
    expect(row.querySelector('a')).toBeNull();
    expect(gist(row)).toContain('evil');
  });

  it('says the Space is being created while it runs, and who is waited on before that', () => {
    const pending = draw(fit(), segment('create_space', { status: 'pending' }));
    expect(gist(pending)).toContain('creating the Space');

    const waiting = draw(fit(), segment('create_space', { status: 'awaiting-approval' }));
    expect(gist(waiting)).toContain('go-ahead');
    expect(state(waiting)).toBe('Waiting');
  });

  it('flags a Space that still has no model id', () => {
    const row = draw(
      fit(),
      segment('create_space', {
        structuredResult: { value: 'live.no-model', name: 'blank', url: 'https://hf.co/spaces/paul/blank' },
      }),
    );
    expect(gist(row)).toContain('MODEL_ID');
  });

  it('says the push was refused', () => {
    const row = draw(
      fit(),
      segment('create_space', { structuredResult: { value: 'error', name: 'whisper' } }),
    );
    expect(state(row)).toBe('Refused');
    expect(gist(row)).toContain('whisper');
  });
});

// ─── download_zip ────────────────────────────────────────────────────────────

describe('download_zip', () => {
  it('names the archive and its size', () => {
    const row = draw(
      fit({ archive: () => ({ name: 'whisper-tiny.zip', bytes: 15_360 }) }),
      segment('download_zip', { structuredResult: { value: 'ok' } }),
    );
    expect(gist(row)).toContain('whisper-tiny.zip');
    expect(gist(row)).toContain('15.4 kB');
    expect(state(row)).toBe('Saved');
  });

  it('still says the file left the browser when the host lent nothing', () => {
    const row = draw(fit(), segment('download_zip', { structuredResult: { value: 'ok' } }));
    expect(gist(row)).toContain('handed to your browser');
  });

  it('reports a failed zip', () => {
    const row = draw(fit(), segment('download_zip', { structuredResult: { value: 'error' } }));
    expect(state(row)).toBe('Failed');
    expect(gist(row)).toContain('did not make it');
  });
});

// ─── the ask_* family ────────────────────────────────────────────────────────

describe('the ask_* rows', () => {
  it('puts the question and its answer on one line', () => {
    const cases: ReadonlyArray<[string, string, string]> = [
      ['ask_model', 'onnx-community/whisper-tiny', 'Model'],
      ['ask_precision', 'q4', 'Weights'],
      ['ask_behaviour', 'custom', 'Behaviour'],
      ['ask_appearance', 'default', 'Look'],
      ['ask_outcome', 'push', 'Next'],
    ];
    for (const [tool, value, question] of cases) {
      const row = draw(fit(), segment(tool, { structuredResult: { value } }));
      expect(row.querySelector('.tool-row__question')?.textContent).toBe(question);
      expect(row.querySelector('.tool-row__answer')?.textContent).toBeTruthy();
      expect(state(row)).toBe('Answered');
    }
  });

  it('translates an answer into the words the panel used', () => {
    const behaviour = draw(fit(), segment('ask_behaviour', { structuredResult: { value: 'custom' } }));
    expect(gist(behaviour)).toContain('own prompt and greeting');

    const outcome = draw(fit(), segment('ask_outcome', { structuredResult: { value: 'download' } }));
    expect(gist(outcome)).toContain('download the zip');

    const weights = draw(fit(), segment('ask_precision', { structuredResult: { value: 'q4f16' } }));
    expect(gist(weights)).toContain('4-bit');
  });

  it('treats an empty value as no answer, and not as a failure', () => {
    const row = draw(fit(), segment('ask_model', { structuredResult: { value: '' } }));
    expect(gist(row)).toContain('no answer');
    expect(state(row)).toBe('Unanswered');
    expect(row.dataset['tone']).toBe('warn');
  });

  it('waits for the answer while the panel is open', () => {
    const row = draw(fit(), segment('ask_appearance', { status: 'pending' }));
    expect(gist(row)).toContain('waiting for your answer');
    expect(state(row)).toBe('Running');
  });
});

// ─── update ──────────────────────────────────────────────────────────────────

describe('update', () => {
  it('patches the same element and keeps a disclosure the reader opened', () => {
    const fitted = fit({ files: () => [{ path: 'index.html', bytes: 2048 }] });
    const renderer = fitted.renderers.get('generate_files');
    const pending = segment('generate_files', { status: 'pending' });
    const row = draw(fitted, pending);
    row.open = true;

    renderer?.update?.(row, {
      ...pending,
      status: 'resolved',
      result: 'files=ready\n1 file: index.html',
      structuredResult: { value: 'ready', paths: ['index.html'] },
    });

    expect(row.open).toBe(true);
    expect(row.dataset['status']).toBe('resolved');
    expect(gist(row)).toContain('2.0 kB');
    expect(state(row)).toBe('Written');
    expect(row.querySelector('.aparte-tool-spinner')?.hasAttribute('hidden')).toBe(true);
  });
});

// ─── The small measurements ──────────────────────────────────────────────────

describe('the numbers', () => {
  it('counts UTF-8 bytes, emoji included', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('→')).toBe(3);
    // A Space's emoji is a surrogate pair: four bytes, not two characters.
    expect(utf8Length('🛸')).toBe(4);
  });

  it('writes bytes in the units the Hub uses', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1000)).toBe('1.0 kB');
    expect(formatBytes(1_500_000)).toBe('1.5 MB');
    expect(formatBytes(Number.NaN)).toBe('');
  });

  it('only trusts an http(s) URL', () => {
    expect(safeHttpUrl('https://huggingface.co/spaces/a/b')).toBe('https://huggingface.co/spaces/a/b');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
  });

  it('reads the repo id out of a Space URL, and falls back to the name it was given', () => {
    expect(spaceRepoId('https://huggingface.co/spaces/paul/demo', 'demo')).toBe('paul/demo');
    expect(spaceRepoId('https://example.com/', 'demo')).toBe('demo');
    expect(spaceRepoId('nonsense', 'demo')).toBe('demo');
  });
});

// ─── The two languages ───────────────────────────────────────────────────────

describe('the language a row speaks', () => {
  // The regression this pins: every word below was an English literal in the renderers,
  // on the reasoning that the file had "no locale to re-read". Under a French transcript
  // `scan_model` still said `no model id yet`, three rows under a French question.
  it('follows the language being spoken, and leaves the Hub its own words', async () => {
    await setLang('fr');
    try {
      const scanned = draw(
        fit(),
        segment('scan_model', {
          structuredResult: {
            scan: {
              id: 'onnx-community/SmolLM2-135M-Instruct-ONNX',
              status: 'found',
              hasOnnx: true,
              onnxFiles: ['onnx/model_q4.onnx'],
              onnxDtypes: ['q4'],
              pipelineTag: 'text-generation',
              supportsImage: false,
            },
          },
        }),
      );
      expect(state(scanned)).toBe('Trouvé');
      expect(gist(scanned)).toContain('des poids ONNX sont publiés');
      // The Hub's own words, untranslated: the id and the pipeline tag it declared.
      expect(gist(scanned)).toContain('onnx-community/SmolLM2-135M-Instruct-ONNX');
      expect(gist(scanned)).toContain('text-generation');

      // The `ask_*` views are built once at module load; their question must not be.
      const asked = draw(fit(), segment('ask_behaviour', { structuredResult: { value: 'default' } }));
      expect(gist(asked)).toContain('Comportement');
      expect(gist(asked)).toContain('valeurs par défaut gardées');

      const pending = draw(fit(), segment('scan_model', { status: 'pending' }));
      expect(state(pending)).toBe('En cours');
    } finally {
      await setLang('en');
    }
  });

  it('says the same things in English', async () => {
    await setLang('en');
    const row = draw(fit(), segment('ask_behaviour', { structuredResult: { value: 'default' } }));
    expect(gist(row)).toContain('Behaviour');
    expect(gist(row)).toContain('defaults kept');
  });
});
