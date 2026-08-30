/**
 * Every branch of `scanModel` over a mocked `fetch` — no network, ever.
 *
 * Detection is the one place where the product talks to somebody else's API, so the shape
 * of the payloads is pinned here: an `inferenceProviderMapping` that changes shape or a
 * `tree` call that starts failing must break a test, not a user's afternoon.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { modesFor, scanModel } from './api';
import { componentDtypes, emptyScan, formatBytes } from './types';

// —————————————————————————————————————————————————————————————————————————————
// Harness
// —————————————————————————————————————————————————————————————————————————————

type Route = Response | Error | undefined;

interface Routes {
  /** GET /api/models/<id>?expand[]=… */
  model?: Route;
  /** GET /api/models/<id>/tree/main?recursive=true */
  tree?: Route;
}

interface Call {
  url: string;
  headers: Record<string, string>;
}

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function install(routes: Routes): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });

      const route = url.includes('/tree/') ? routes.tree : routes.model;

      if (route === undefined) throw new Error(`No route for ${url}`);
      if (route instanceof Error) throw route;
      return route;
    }),
  );
  return calls;
}

const SERVED_MODEL = {
  id: 'meta-llama/Llama-3.2-3B-Instruct',
  private: false,
  gated: false,
  pipeline_tag: 'text-generation',
  library_name: 'transformers',
  inferenceProviderMapping: {
    'featherless-ai': { status: 'live', providerId: 'meta-llama/Llama-3.2-3B-Instruct' },
    novita: { status: 'live', providerId: 'meta-llama/llama-3.2-3b-instruct' },
    sambanova: { status: 'staging', providerId: 'Llama-3.2-3B' },
  },
};

/** The reference case: public, ONNX weights, transformers.js, served by nobody. */
const SOUFFLEURS_MODEL = {
  id: 'maxituc/aparte-souffleurs',
  private: false,
  gated: false,
  pipeline_tag: 'text-generation',
  library_name: 'transformers.js',
};

const TREE_WITH_ONNX = [
  { type: 'file', path: 'README.md', size: 400 },
  { type: 'file', path: 'config.json', size: 900 },
  { type: 'directory', path: 'onnx' },
  { type: 'file', path: 'onnx/model_q4.onnx', size: 123 },
  { type: 'file', path: 'onnx/model.onnx_data', size: 456 },
];

const TREE_WITHOUT_ONNX = [
  { type: 'file', path: 'README.md', size: 400 },
  { type: 'file', path: 'model.safetensors', size: 999 },
];

/** What an onnx-community repo actually looks like: one export per quantisation. */
const TREE_WITH_VARIANTS = [
  { type: 'directory', path: 'onnx' },
  { type: 'file', path: 'onnx/model.onnx' },
  { type: 'file', path: 'onnx/model_fp16.onnx' },
  { type: 'file', path: 'onnx/model_q4.onnx' },
  { type: 'file', path: 'onnx/model_q4f16.onnx' },
  { type: 'file', path: 'onnx/model_quantized.onnx' },
  { type: 'file', path: 'onnx/model_bnb4.onnx' },
  { type: 'file', path: 'onnx/model_uint8.onnx' },
  { type: 'file', path: 'onnx/model.onnx_data' },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// —————————————————————————————————————————————————————————————————————————————
// scanModel — the happy paths
// —————————————————————————————————————————————————————————————————————————————

describe('scanModel', () => {
  it('reads a served model: providers, library, no browser mode', async () => {
    install({ model: json(SERVED_MODEL), tree: json(TREE_WITHOUT_ONNX) });

    const scan = await scanModel('meta-llama/Llama-3.2-3B-Instruct');

    expect(scan.status).toBe('found');
    expect(scan.id).toBe('meta-llama/Llama-3.2-3B-Instruct');
    // "staging" is listed but not served — only live providers make the cut.
    expect(scan.providers).toEqual(['featherless-ai', 'novita']);
    expect(scan.libraryName).toBe('transformers');
    expect(scan.pipelineTag).toBe('text-generation');
    expect(scan.hasOnnx).toBe(false);
    expect(scan.onnxFiles).toEqual([]);
    expect(scan.supportsImage).toBe(false);
    expect(scan.isPrivate).toBe(false);
    expect(scan.gated).toBe(false);
    expect(scan.error).toBeNull();
  });

  it('reads the reference case: ONNX weights, no provider at all', async () => {
    install({ model: json(SOUFFLEURS_MODEL), tree: json(TREE_WITH_ONNX) });

    const scan = await scanModel('maxituc/aparte-souffleurs');

    expect(scan.status).toBe('found');
    expect(scan.providers).toEqual([]);
    expect(scan.hasOnnx).toBe(true);
    expect(scan.onnxFiles).toEqual(['onnx/model_q4.onnx']);
    expect(scan.libraryName).toBe('transformers.js');
  });

  it('asks the Hub for every field it will not volunteer', async () => {
    const calls = install({ model: json(SOUFFLEURS_MODEL), tree: json(TREE_WITH_ONNX) });

    await scanModel('maxituc/aparte-souffleurs');

    const modelUrl = calls[0]?.url ?? '';
    expect(modelUrl).toContain('https://huggingface.co/api/models/maxituc/aparte-souffleurs?');
    for (const field of [
      'inferenceProviderMapping',
      'private',
      'gated',
      'pipeline_tag',
      'library_name',
    ]) {
      expect(modelUrl).toContain(`expand[]=${field}`);
    }
    expect(calls[1]?.url).toBe(
      'https://huggingface.co/api/models/maxituc/aparte-souffleurs/tree/main?recursive=true',
    );
  });

  it('sends the token on both calls, and no header without one', async () => {
    const withToken = install({ model: json(SOUFFLEURS_MODEL), tree: json(TREE_WITH_ONNX) });
    await scanModel('maxituc/aparte-souffleurs', 'hf_secret');
    expect(withToken.map((call) => call.headers['Authorization'])).toEqual([
      'Bearer hf_secret',
      'Bearer hf_secret',
    ]);

    vi.unstubAllGlobals();
    const anonymous = install({ model: json(SOUFFLEURS_MODEL), tree: json(TREE_WITH_ONNX) });
    await scanModel('maxituc/aparte-souffleurs');
    expect(anonymous.every((call) => !('Authorization' in call.headers))).toBe(true);
  });
});

// —————————————————————————————————————————————————————————————————————————————
// scanModel — inferenceProviderMapping, in all the shapes it has worn
// —————————————————————————————————————————————————————————————————————————————

describe('scanModel / providers', () => {
  it('handles the array shape', async () => {
    install({
      model: json({
        ...SOUFFLEURS_MODEL,
        inferenceProviderMapping: [
          { provider: 'together', status: 'live' },
          { provider: 'hyperbolic', status: 'error' },
          { providerId: 'fireworks-ai' },
        ],
      }),
      tree: json(TREE_WITHOUT_ONNX),
    });

    const scan = await scanModel('maxituc/aparte-souffleurs');
    // "together" is live, "hyperbolic" is not, and a statusless entry is taken as served.
    expect(scan.providers).toEqual(['together', 'fireworks-ai']);
  });

  it('handles a missing mapping', async () => {
    install({ model: json(SOUFFLEURS_MODEL), tree: json(TREE_WITHOUT_ONNX) });
    expect((await scanModel('maxituc/aparte-souffleurs')).providers).toEqual([]);
  });

  it('handles a mapping that is null, or full of nonsense', async () => {
    install({
      model: json({ ...SOUFFLEURS_MODEL, inferenceProviderMapping: null }),
      tree: json(TREE_WITHOUT_ONNX),
    });
    expect((await scanModel('a/b')).providers).toEqual([]);

    vi.unstubAllGlobals();
    install({
      model: json({ ...SOUFFLEURS_MODEL, inferenceProviderMapping: 'nebius' }),
      tree: json(TREE_WITHOUT_ONNX),
    });
    expect((await scanModel('a/b')).providers).toEqual([]);
  });

  it('keeps a provider whose entry is not an object', async () => {
    install({
      model: json({ ...SOUFFLEURS_MODEL, inferenceProviderMapping: { nebius: 'live' } }),
      tree: json(TREE_WITHOUT_ONNX),
    });
    expect((await scanModel('a/b')).providers).toEqual(['nebius']);
  });
});

// —————————————————————————————————————————————————————————————————————————————
// scanModel — ONNX detection
// —————————————————————————————————————————————————————————————————————————————

describe('scanModel / ONNX', () => {
  it('names every dtype the repo ships, smallest first', async () => {
    install({ model: json(SOUFFLEURS_MODEL), tree: json(TREE_WITH_VARIANTS) });

    const scan = await scanModel('onnx-community/whatever');

    expect(scan.hasOnnx).toBe(true);
    // `model_quantized.onnx` is the file transformers.js loads for dtype `q8`, and the
    // suffix-less `model.onnx` is fp32. `.onnx_data` is a sidecar, not a variant.
    expect(scan.onnxDtypes).toEqual(['q4', 'q4f16', 'bnb4', 'uint8', 'q8', 'fp16', 'fp32']);
    expect(scan.onnxFiles).not.toContain('onnx/model.onnx_data');
  });

  it('reads the dtype off encoder/decoder exports too', async () => {
    install({
      model: json(SOUFFLEURS_MODEL),
      tree: json([
        { type: 'file', path: 'onnx/encoder_model.onnx' },
        { type: 'file', path: 'onnx/decoder_model_merged_q4.onnx' },
        { type: 'file', path: 'onnx/decoder_model_merged_int8.onnx' },
      ]),
    });

    expect((await scanModel('a/b')).onnxDtypes).toEqual(['q4', 'int8', 'fp32']);
  });

  it('reports no dtype when there is no ONNX at all', async () => {
    install({ model: json(SOUFFLEURS_MODEL), tree: json(TREE_WITHOUT_ONNX) });

    const scan = await scanModel('a/b');
    expect(scan.hasOnnx).toBe(false);
    expect(scan.onnxDtypes).toEqual([]);
  });

  it('collects dtypes from the whole tree, past the path cap', async () => {
    // The filler is named the way a repo names its components (`layer_0.onnx`), NOT
    // `model_<n>.onnx`: an unrecognised suffix on a `model_` stem is not a dtype, and
    // promoting it to one is what once invented an "fp32" variant out of an image tower.
    const many = [
      ...Array.from({ length: 25 }, (_, index) => ({
        type: 'file',
        path: `onnx/layer_${index}.onnx`,
      })),
      { type: 'file', path: 'onnx/model.onnx' },
      { type: 'file', path: 'onnx/model_q4.onnx' },
    ];
    install({ model: json(SOUFFLEURS_MODEL), tree: json(many) });

    const scan = await scanModel('a/b');
    expect(scan.onnxFiles).toHaveLength(20);
    // The last two entries never made the path list, but their dtypes still count.
    expect(scan.onnxDtypes).toEqual(['q4', 'fp32']);
  });

  it('caps the file list', async () => {
    const many = Array.from({ length: 25 }, (_, index) => ({
      type: 'file',
      path: `onnx/model_${index}.onnx`,
      size: 1,
    }));
    install({ model: json(SOUFFLEURS_MODEL), tree: json(many) });

    const scan = await scanModel('maxituc/aparte-souffleurs');
    expect(scan.hasOnnx).toBe(true);
    expect(scan.onnxFiles).toHaveLength(20);
  });

  it('stays a good scan when the file listing fails', async () => {
    install({ model: json(SOUFFLEURS_MODEL), tree: json({ error: 'nope' }, 500) });

    const scan = await scanModel('maxituc/aparte-souffleurs');
    // The model was found; we simply cannot promise the browser mode.
    expect(scan.status).toBe('found');
    expect(scan.hasOnnx).toBe(false);
    expect(scan.error).toBeNull();
  });

  it('survives a tree that is not an array', async () => {
    install({ model: json(SOUFFLEURS_MODEL), tree: json({ siblings: [] }) });
    expect((await scanModel('a/b')).hasOnnx).toBe(false);
  });

  it('survives the tree call throwing', async () => {
    install({ model: json(SOUFFLEURS_MODEL), tree: new TypeError('Failed to fetch') });
    const scan = await scanModel('a/b');
    expect(scan.status).toBe('found');
    expect(scan.hasOnnx).toBe(false);
  });
});

// —————————————————————————————————————————————————————————————————————————————
// scanModel — what each dtype weighs
// —————————————————————————————————————————————————————————————————————————————

/**
 * The number a visitor is entitled to before they click "Load the model".
 *
 * Two ways to get it wrong, and both ship a page that lies. Under-count — miss the
 * `.onnx_data` sidecar, miss the decoder — and someone promised 400 KB downloads
 * 500 MB. Guess where the Hub said nothing and the promise was never measured at all.
 * Every case below is one of those two.
 */
describe('scanModel / onnxSizes', () => {
  const MB = 1048576;

  it('adds the external-weights sidecar to the graph it belongs to', async () => {
    install({
      model: json(SOUFFLEURS_MODEL),
      // The whole point: `model_q4.onnx` is a stub, and the weights are next to it.
      tree: json([
        { type: 'directory', path: 'onnx' },
        { type: 'file', path: 'onnx/model_q4.onnx', size: 2 * MB },
        { type: 'file', path: 'onnx/model_q4.onnx_data', size: 170 * MB },
        { type: 'file', path: 'config.json', size: 900 },
      ]),
    });

    const scan = await scanModel('a/b');

    expect(scan.onnxDtypes).toEqual(['q4']);
    expect(scan.onnxSizes).toEqual({ q4: 172 * MB });
  });

  it('accepts the `.onnx.data` spelling of the same sidecar', async () => {
    install({
      model: json(SOUFFLEURS_MODEL),
      tree: json([
        { type: 'file', path: 'onnx/model.onnx', size: 1 * MB },
        { type: 'file', path: 'onnx/model.onnx.data', size: 513 * MB },
      ]),
    });

    expect((await scanModel('a/b')).onnxSizes).toEqual({ fp32: 514 * MB });
  });

  it('sums every file a dtype needs, not just the biggest one', async () => {
    install({
      model: json(SOUFFLEURS_MODEL),
      // An encoder/decoder export: the browser fetches both halves, so both count.
      tree: json([
        { type: 'file', path: 'onnx/encoder_model_q4.onnx', size: 30 * MB },
        { type: 'file', path: 'onnx/decoder_model_merged_q4.onnx', size: 90 * MB },
        { type: 'file', path: 'onnx/encoder_model.onnx', size: 120 * MB },
        { type: 'file', path: 'onnx/decoder_model_merged.onnx', size: 360 * MB },
      ]),
    });

    const scan = await scanModel('a/b');

    expect(scan.onnxSizes).toEqual({ q4: 120 * MB, fp32: 480 * MB });
    // Smallest first, and the sizes agree with the order.
    expect(Object.keys(scan.onnxSizes ?? {})).toEqual(['q4', 'fp32']);
  });

  it('says nothing about a dtype the Hub did not measure in full', async () => {
    install({
      model: json(SOUFFLEURS_MODEL),
      tree: json([
        { type: 'file', path: 'onnx/model_q4.onnx', size: 2 * MB },
        // No size on the sidecar: reporting 2 MB here would be the exact lie this
        // guards against, so q4 comes back unmeasured instead of feather-light.
        { type: 'file', path: 'onnx/model_q4.onnx_data' },
        { type: 'file', path: 'onnx/model.onnx', size: 500 * MB },
      ]),
    });

    const scan = await scanModel('a/b');

    expect(scan.onnxDtypes).toEqual(['q4', 'fp32']);
    expect(scan.onnxSizes).toEqual({ fp32: 500 * MB });
  });

  it('ignores a sidecar whose graph is not in the repo', async () => {
    install({ model: json(SOUFFLEURS_MODEL), tree: json(TREE_WITH_ONNX) });

    const scan = await scanModel('maxituc/aparte-souffleurs');

    // `onnx/model.onnx_data` is there but `onnx/model.onnx` is not, so fp32 is not a
    // size anyone can download and must not appear with one.
    expect(scan.onnxDtypes).toEqual(['q4']);
    expect(scan.onnxSizes).toEqual({ q4: 123 });
  });

  it('prefers the LFS size, which is the size of the object itself', async () => {
    install({
      model: json(SOUFFLEURS_MODEL),
      tree: json([
        { type: 'file', path: 'onnx/model_q4.onnx', size: 134, lfs: { size: 172 * MB } },
      ]),
    });

    expect((await scanModel('a/b')).onnxSizes).toEqual({ q4: 172 * MB });
  });

  it('comes back empty rather than wrong when the tree gives no sizes', async () => {
    install({ model: json(SOUFFLEURS_MODEL), tree: json(TREE_WITH_VARIANTS) });

    const scan = await scanModel('a/b');

    expect(scan.onnxDtypes?.length).toBeGreaterThan(0);
    expect(scan.onnxSizes).toEqual({});
  });

  it('comes back empty when the listing failed altogether', async () => {
    install({ model: json(SOUFFLEURS_MODEL), tree: new TypeError('Failed to fetch') });

    expect((await scanModel('a/b')).onnxSizes).toEqual({});
  });

  it('refuses a size the Hub reported as something other than a number', async () => {
    install({
      model: json(SOUFFLEURS_MODEL),
      tree: json([
        { type: 'file', path: 'onnx/model_q4.onnx', size: '172000000' },
        { type: 'file', path: 'onnx/model.onnx', size: 500 * MB },
      ]),
    });

    expect((await scanModel('a/b')).onnxSizes).toEqual({ fp32: 500 * MB });
  });
});

// —————————————————————————————————————————————————————————————————————————————
// formatBytes — the one place the product decides how a size is spelled
// —————————————————————————————————————————————————————————————————————————————

describe('formatBytes', () => {
  const MB = 1048576;

  it('drops the decimal above 10 MB, where nobody reads it', () => {
    expect(formatBytes(172 * MB)).toBe('172 MB');
    expect(formatBytes(514 * MB)).toBe('514 MB');
    expect(formatBytes(10 * MB)).toBe('10 MB');
    expect(formatBytes(180355072)).toBe('172 MB');
  });

  it('keeps one decimal below 10 MB, where 4 and 4.7 are different sizes', () => {
    expect(formatBytes(4.7 * MB)).toBe('4.7 MB');
    expect(formatBytes(1 * MB)).toBe('1 MB');
  });

  it('switches to GB rather than printing four digits of megabytes', () => {
    expect(formatBytes(1024 * MB)).toBe('1 GB');
    expect(formatBytes(1.4 * 1024 * MB)).toBe('1.4 GB');
  });

  it('speaks in KB below a megabyte, and never rounds a real file to nothing', () => {
    expect(formatBytes(400 * 1024)).toBe('400 KB');
    expect(formatBytes(12)).toBe('1 KB');
  });

  it('says NOTHING when there is nothing to say — the contract every caller tests', () => {
    expect(formatBytes(0)).toBe('');
    expect(formatBytes(-1)).toBe('');
    expect(formatBytes(Number.NaN)).toBe('');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('');
  });
});

// —————————————————————————————————————————————————————————————————————————————
// scanModel — image support and gating
// —————————————————————————————————————————————————————————————————————————————

describe('scanModel / capabilities', () => {
  it('turns image-text-to-text into attachment support', async () => {
    install({
      model: json({ ...SOUFFLEURS_MODEL, pipeline_tag: 'image-text-to-text' }),
      tree: json(TREE_WITHOUT_ONNX),
    });
    expect((await scanModel('a/b')).supportsImage).toBe(true);
  });

  it('is tolerant of the neighbouring vision tags', async () => {
    for (const tag of ['visual-question-answering', 'image-to-text', 'any-to-any']) {
      vi.unstubAllGlobals();
      install({
        model: json({ ...SOUFFLEURS_MODEL, pipeline_tag: tag }),
        tree: json(TREE_WITHOUT_ONNX),
      });
      expect((await scanModel('a/b')).supportsImage).toBe(true);
    }
  });

  it('reports a gated repo we were allowed to read', async () => {
    install({
      model: json({ ...SOUFFLEURS_MODEL, gated: 'manual', private: true }),
      tree: json(TREE_WITHOUT_ONNX),
    });
    const scan = await scanModel('a/b', 'hf_secret');
    expect(scan.status).toBe('found');
    expect(scan.gated).toBe(true);
    expect(scan.isPrivate).toBe(true);
  });

  it('leaves unknown fields null rather than guessing', async () => {
    install({ model: json({}), tree: json(TREE_WITHOUT_ONNX) });
    const scan = await scanModel('a/b');
    expect(scan.status).toBe('found');
    expect(scan.pipelineTag).toBeNull();
    expect(scan.libraryName).toBeNull();
    expect(scan.supportsImage).toBe(false);
    expect(scan.gated).toBe(false);
  });
});

// —————————————————————————————————————————————————————————————————————————————
// scanModel — the unhappy paths, none of which may throw
// —————————————————————————————————————————————————————————————————————————————

describe('scanModel / failures', () => {
  it('maps 401 and 403 to "private" — a login may lift it', async () => {
    for (const status of [401, 403]) {
      vi.unstubAllGlobals();
      install({ model: json({ error: 'Repository not found' }, status) });
      const scan = await scanModel('someone/secret');
      expect(scan.status).toBe('private');
      expect(scan.error).toBeNull();
    }
  });

  it('maps 404 to "not-found"', async () => {
    install({ model: json({ error: 'Not found' }, 404) });
    const scan = await scanModel('someone/typo');
    expect(scan.status).toBe('not-found');
    expect(scan.error).toBeNull();
  });

  it('turns any other HTTP failure into a readable error', async () => {
    install({ model: json({ error: 'Internal Server Error' }, 500) });
    const scan = await scanModel('a/b');
    expect(scan.status).toBe('error');
    expect(scan.error).toContain('500');
    expect(scan.error).toContain('Internal Server Error');
  });

  it('does not need the error body to be JSON', async () => {
    install({
      model: {
        ok: false,
        status: 503,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      } as unknown as Response,
    });
    const scan = await scanModel('a/b');
    expect(scan.status).toBe('error');
    expect(scan.error).toContain('503');
  });

  it('reports a network failure instead of throwing', async () => {
    install({ model: new TypeError('Failed to fetch') });
    const scan = await scanModel('a/b');
    expect(scan.status).toBe('error');
    expect(scan.error).toContain('Failed to fetch');
    expect(scan.hasOnnx).toBe(false);
    expect(scan.providers).toEqual([]);
  });

  it('reports an unreadable 200 body', async () => {
    install({
      model: {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected end of JSON input');
        },
      } as unknown as Response,
    });
    const scan = await scanModel('a/b');
    expect(scan.status).toBe('error');
    expect(scan.error).toContain('Unexpected end of JSON input');
  });

  it('refuses a malformed id without spending a request', async () => {
    const calls = install({});

    const blank = await scanModel('   ');
    expect(blank.status).toBe('error');
    expect(blank.error).toBe('No model id given.');

    const bare = await scanModel('llama');
    expect(bare.status).toBe('error');
    expect(bare.error).toContain('owner/name');

    expect(calls).toHaveLength(0);
  });

  it('trims the id it was given', async () => {
    const calls = install({ model: json(SOUFFLEURS_MODEL), tree: json(TREE_WITH_ONNX) });
    const scan = await scanModel('  maxituc/aparte-souffleurs  ');
    expect(scan.id).toBe('maxituc/aparte-souffleurs');
    expect(calls[0]?.url).toContain('/models/maxituc/aparte-souffleurs?');
  });
});

// —————————————————————————————————————————————————————————————————————————————
// scanModel — what an id is not allowed to do
// —————————————————————————————————————————————————————————————————————————————

describe('scanModel / hostile ids', () => {
  it('refuses a dot-only segment instead of walking up the Hub API', async () => {
    // `isValidRepoId` accepts these — `https://huggingface.co/api/models/../..` normalises
    // to the API root, and the request would carry the user's Authorization header there.
    for (const id of ['../..', './.', 'owner/..', '../name']) {
      vi.unstubAllGlobals();
      const calls = install({});
      const scan = await scanModel(id, 'hf_secret');
      expect(scan.status).toBe('error');
      expect(scan.error).toContain('owner/name');
      expect(calls).toHaveLength(0);
    }
  });

  it('bounds and de-fangs the id it echoes back', async () => {
    install({});
    const scan = await scanModel(`<img src=x onerror="alert('${'A'.repeat(300)}')">`);

    expect(scan.status).toBe('error');
    // The quotes around the id are ours; nothing markup-shaped survives from the input.
    expect(scan.error).not.toMatch(/[<>&']/);
    expect(scan.error).toContain('is not a repo id');
    // Long enough to recognise your typo, short enough not to be the message.
    expect(scan.error?.length ?? 0).toBeLessThan(120);
  });
});

// —————————————————————————————————————————————————————————————————————————————
// modesFor — the only reader allowed to close a door
// —————————————————————————————————————————————————————————————————————————————

describe('modesFor', () => {
  it('believes a scan that actually read the repo', async () => {
    install({ model: json(SOUFFLEURS_MODEL), tree: json(TREE_WITH_ONNX) });
    const found = await scanModel('maxituc/aparte-souffleurs');

    expect(modesFor(found)).toEqual({
      conclusive: true,
      browser: true,
      providers: false,
      endpoint: true,
    });
  });

  it('closes the browser mode only on a repo it could read', async () => {
    install({ model: json(SERVED_MODEL), tree: json(TREE_WITHOUT_ONNX) });
    const found = await scanModel('meta-llama/Llama-3.2-3B-Instruct');

    expect(modesFor(found).browser).toBe(false);
    expect(modesFor(found).conclusive).toBe(true);
  });

  it('never turns "we could not look" into "there are no ONNX weights"', async () => {
    // The regression this exists for: private/not-found/error all carry the emptyScan
    // defaults, which are indistinguishable from a repo with nothing in it.
    for (const status of ['private', 'not-found', 'error'] as const) {
      const blocked = { ...emptyScan('someone/secret'), status };
      expect(modesFor(blocked)).toEqual({
        conclusive: false,
        browser: true,
        providers: true,
        endpoint: true,
      });
    }
  });

  it('treats no scan at all as nothing known', () => {
    expect(modesFor(null)).toEqual({
      conclusive: false,
      browser: true,
      providers: true,
      endpoint: true,
    });
  });

  it('reports a 401 as inconclusive, not as a model without weights', async () => {
    install({ model: json({ error: 'Repository not found' }, 401) });
    const scan = await scanModel('someone/secret');

    expect(scan.hasOnnx).toBe(false); // the raw field is a default…
    expect(modesFor(scan).browser).toBe(true); // …and must not be read as an answer.
    expect(modesFor(scan).conclusive).toBe(false);
  });
});

describe('a model whose weights come in several parts', () => {
  /**
   * Regression, caught in a browser: `maxituc/aparte-souffleurs` ships `model_q4.onnx`
   * (796 MB with its sidecar) next to `vision-tower-0.1.0.onnx` (257 MB). Read as a
   * variant, the tower became an "fp32" build — and the smallest one — so the generated
   * Space offered a 257 MB download for a model that pulls 1.05 GB. A figure three times
   * short is worse than no figure.
   */
  it('counts a shared component in every variant, and never as one', async () => {
    const tree = [
      { type: 'file', path: 'onnx/model_q4.onnx', size: 300_000 },
      { type: 'file', path: 'onnx/model_q4.onnx_data', size: 800_000_000 },
      { type: 'file', path: 'onnx/vision-tower-0.1.0.onnx', size: 300_000 },
      { type: 'file', path: 'onnx/vision-tower-0.1.0.onnx_data', size: 260_000_000 },
    ];
    install({ model: json({ id: 'acme/vlm', pipeline_tag: 'image-text-to-text' }), tree: json(tree) });
    const scan = await scanModel('acme/vlm');

    expect(scan.onnxDtypes).toEqual(['q4']);
    // The tower has one build and no q4 of its own, so it is downloaded as it is.
    expect(scan.onnxSizes?.['q4']).toBe(300_000 + 800_000_000 + 300_000 + 260_000_000);
    expect(scan.onnxSizes?.['fp32']).toBeUndefined();
  });

  it('still reads a plain single-variant repo the same way', async () => {
    install({
      model: json({ id: 'acme/plain', pipeline_tag: 'text-generation' }),
      tree: json([
        { type: 'file', path: 'onnx/model_q4.onnx', size: 1_000 },
        { type: 'file', path: 'onnx/model.onnx', size: 4_000 },
      ]),
    });
    const scan = await scanModel('acme/plain');

    expect(scan.onnxDtypes).toEqual(['q4', 'fp32']);
    expect(scan.onnxSizes?.['q4']).toBe(1_000);
    expect(scan.onnxSizes?.['fp32']).toBe(4_000);
  });
});

describe('a repo whose every component ships in every dtype', () => {
  /**
   * `onnx-community/LFM2-VL-450M-ONNX`, trimmed: three graphs that load together, each
   * published in several builds. A visitor picking q4 downloads the q4 of EACH — not one
   * file, and not every build of every part. Read the naive way this repo offers a 1.5 GB
   * q4; read properly it offers 349 MB.
   */
  const MB = 1_048_576;
  // Every graph with its sidecar, the way the repo really ships them: the `.onnx` is a
  // few hundred kilobytes of structure and the weights live in the `.onnx_data`.
  const graph = (name: string, dataMb: number) => [
    { type: 'file', path: `onnx/${name}.onnx`, size: 0 },
    { type: 'file', path: `onnx/${name}.onnx_data`, size: dataMb * MB },
  ];
  const tree = [
    ...graph('decoder_model_merged', 1384),
    ...graph('decoder_model_merged_q4', 248),
    ...graph('decoder_model_merged_q4f16', 211),
    ...graph('embed_tokens', 256),
    ...graph('embed_tokens_q4', 41),
    ...graph('embed_tokens_q4f16', 37),
    // The build the loader is actually given for this part — see the block on
    // `embed_tokens` below — so the figure has to count it, not the q4 next to it.
    ...graph('embed_tokens_fp16', 128),
    ...graph('vision_encoder', 368),
    ...graph('vision_encoder_q4', 60),
    ...graph('vision_encoder_q4f16', 54),
  ];

  it('adds one build of each component, not all of them', async () => {
    install({ model: json({ id: 'onnx-community/vl', pipeline_tag: 'image-text-to-text' }), tree: json(tree) });
    const scan = await scanModel('onnx-community/vl');

    // 41 is the q4 of the embedding table and it is NOT what gets loaded: 128 is.
    expect(scan.onnxSizes?.['q4']).toBe((248 + 128 + 60) * MB);
    expect(scan.onnxSizes?.['q4f16']).toBe((211 + 128 + 54) * MB);
    expect(scan.onnxSizes?.['fp32']).toBe((1384 + 256 + 368) * MB);
  });

  it('offers the dtypes the model itself ships, and marks the repo as taking images', async () => {
    install({ model: json({ id: 'onnx-community/vl', pipeline_tag: 'image-text-to-text' }), tree: json(tree) });
    const scan = await scanModel('onnx-community/vl');

    expect(scan.onnxDtypes).toEqual(['q4', 'q4f16', 'fp32']);
    expect(scan.supportsImage).toBe(true);
  });
});

// ─── Which build of each part to load ────────────────────────────────────────

describe('the components a model is made of', () => {
  /**
   * The decomposition the weights were already counted from, kept rather than thrown
   * away. It became load-bearing when `provider-transformers` learned vision: its
   * `registerModel` takes a dtype PER COMPONENT (`{ embed_tokens: 'fp16',
   * vision_encoder: 'q4', … }`), because a vision model is several graphs that load
   * together, each published in its own set of builds.
   */
  it('reports each part and the builds it exists in', async () => {
    install({
      model: json({ id: 'acme/vlm', pipeline_tag: 'image-text-to-text' }),
      tree: json([
        { type: 'file', path: 'onnx/decoder_model_merged_q4.onnx', size: 1_000 },
        { type: 'file', path: 'onnx/decoder_model_merged_fp16.onnx', size: 4_000 },
        { type: 'file', path: 'onnx/embed_tokens_q4.onnx', size: 500 },
        { type: 'file', path: 'onnx/embed_tokens_fp16.onnx', size: 900 },
        { type: 'file', path: 'onnx/vision_encoder.onnx', size: 2_000 },
      ]),
    });
    const scan = await scanModel('acme/vlm');

    expect(scan.onnxComponents).toEqual({
      decoder_model_merged: ['q4', 'fp16'],
      embed_tokens: ['q4', 'fp16'],
      // Published once, with no dtype suffix: `splitOnnxName` reads that as fp32.
      vision_encoder: ['fp32'],
    });
  });

  it('names no build for a part that has none — a stray sidecar is not a build', async () => {
    install({
      model: json({ id: 'acme/orphan', pipeline_tag: 'text-generation' }),
      tree: json([
        { type: 'file', path: 'onnx/model_q4.onnx', size: 1_000 },
        // A sidecar whose graph is not in the repo: it weighs something and loads nothing.
        { type: 'file', path: 'onnx/model_q8.onnx_data', size: 9_000 },
      ]),
    });
    const scan = await scanModel('acme/orphan');

    expect(scan.onnxComponents).toEqual({ model: ['q4'] });
  });
});

describe('componentDtypes', () => {
  const scan = {
    onnxComponents: {
      decoder_model_merged: ['q4', 'fp16'],
      embed_tokens: ['q4', 'fp16'],
      vision_encoder: ['fp32'],
    },
  };

  it('asks for the chosen build of every part that has one', () => {
    expect(componentDtypes(scan, 'q4')).toEqual({
      decoder_model_merged: 'q4',
      // NOT q4: an embedding table is never loaded quantised — see the block below.
      embed_tokens: 'fp16',
      // One build only, so that is what a q4 variant loads — asking for a q4 of it
      // would ask for a file that does not exist.
      vision_encoder: 'fp32',
    });
  });

  it('is the same rule the sizes are counted with', () => {
    expect(componentDtypes(scan, 'fp16')).toEqual({
      decoder_model_merged: 'fp16',
      embed_tokens: 'fp16',
      vision_encoder: 'fp32',
    });
  });

  it('says nothing rather than inventing a map', () => {
    expect(componentDtypes({ onnxComponents: {} }, 'q4')).toBeNull();
    expect(componentDtypes({}, 'q4')).toBeNull();
    // A part with several builds and none of them the one asked for: we do not know
    // which belongs to this variant, so it is left out and the loader defaults.
    expect(componentDtypes({ onnxComponents: { a: ['q4', 'q8'] } }, 'fp16')).toBeNull();
  });

  it('handles the ordinary case — one part, one name', () => {
    expect(componentDtypes({ onnxComponents: { model: ['q4', 'fp32'] } }, 'q4')).toEqual({
      model: 'q4',
    });
  });
});

describe('the parts that must not be quantised', () => {
  /**
   * Found in a browser, on LFM2.5-VL-450M asked for q4f16 across the board:
   *
   *   Failed to find kernel for com.microsoft.GatherBlockQuantized
   *   (node:'/model/embed_tokens/Gather_Quant' ep:'CPUExecutionProvider')
   *
   * A 4-bit embedding table needs a kernel the CPU execution provider does not have, so
   * the model does not load AT ALL — not "loads and is a bit worse". The provider's own
   * docs write their example the same way (`embed_tokens: 'fp16'`); it reads as a
   * quality tip and it is a loadability rule.
   */
  it('keeps embed_tokens off the quantised builds', () => {
    const scan = {
      onnxComponents: {
        decoder_model_merged: ['q4f16', 'fp16', 'fp32'],
        embed_tokens: ['q4f16', 'fp16', 'fp32'],
        vision_encoder: ['q4f16', 'fp16', 'fp32'],
      },
    };

    expect(componentDtypes(scan, 'q4f16')).toEqual({
      decoder_model_merged: 'q4f16',
      embed_tokens: 'fp16',
      vision_encoder: 'q4f16',
    });
  });

  it('prefers fp16, falls back to fp32, and gives up rather than break the load', () => {
    expect(componentDtypes({ onnxComponents: { embed_tokens: ['q4', 'fp32'] } }, 'q4')).toEqual({
      embed_tokens: 'fp32',
    });
    // Nothing unquantised published: the asked-for build is still better than no key at
    // all, and the loader gets to fail with its own message rather than ours.
    expect(componentDtypes({ onnxComponents: { embed_tokens: ['q4', 'q8'] } }, 'q4')).toEqual({
      embed_tokens: 'q4',
    });
  });

  it('leaves every other part on the chosen precision', () => {
    const scan = { onnxComponents: { model: ['q4', 'fp16'], vision_encoder: ['q4', 'fp16'] } };
    expect(componentDtypes(scan, 'q4')).toEqual({ model: 'q4', vision_encoder: 'q4' });
  });
});
