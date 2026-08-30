/**
 * The generator's contract, held to account.
 *
 * These tests are pure string assertions — no DOM, no network. They exist because
 * what this module emits is what users ship: a mistake here is a broken Space on
 * somebody else's account, and nothing downstream would catch it.
 *
 * The escaping cases are the ones worth staring at. A title containing `</script>`
 * has to survive both the HTML parser and the JS parser, and the two want opposite
 * things.
 *
 * V1 generates exactly one kind of Space — the model runs in the visitor's browser —
 * so the mode is not a matrix any more, it is an invariant, and it is tested as one.
 */

import { describe, expect, it } from 'vitest';
import {
  APARTE_VERSION,
  DEFAULT_CONFIG,
  missingFields,
  type SpaceConfig,
} from '../config/space-config';
import { formatBytes } from '../hub/types';
import {
  PAGE_COPY,
  escapeHtml,
  generateIndexHtml,
  generateReadme,
  generateSpace,
  jsString,
  type PageCopy,
} from './generate';

function config(overrides: Partial<SpaceConfig> = {}): SpaceConfig {
  return {
    ...DEFAULT_CONFIG,
    modelId: 'onnx-community/Qwen2.5-0.5B-Instruct',
    title: 'Tiny chat',
    greeting: 'Ask me anything.',
    systemPrompt: 'You are helpful.',
    ...overrides,
  };
}

const html = (overrides: Partial<SpaceConfig> = {}): string => generateSpace(config(overrides)).indexHtml;

/** The same page, for a config that also knows what its weights weigh. */
const weighed = (downloadBytes: number, overrides: Partial<SpaceConfig> = {}): string =>
  generateIndexHtml({ ...config(overrides), downloadBytes });

/** The module script, without its `<script>` wrapper. */
function moduleScript(document: string): string {
  return document.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] ?? '';
}

/**
 * The page's own byte formatter, lifted out and made callable.
 *
 * The generated page cannot import `formatBytes` — it has no build step and no
 * dependency it does not name in its import map — so it carries a copy. A copy that
 * drifts is two products disagreeing about what "172 MB" means, which is exactly the
 * confusion this whole feature exists to remove. Hence the test below that runs both.
 */
function pageFormatter(document: string): (bytes: number) => string {
  const source = moduleScript(document).match(/function humanBytes\(bytes\) \{[\s\S]*?\n  \}/)?.[0];
  if (!source) throw new Error('the page has no humanBytes()');
  return new Function(`${source}\nreturn humanBytes;`)() as (bytes: number) => string;
}

/**
 * `modelBytes` as the page itself computes it, for a given set of Space variables.
 *
 * The declarations are lifted verbatim and run — no re-implementation — because the
 * question being asked is whether the PAGE drops a size that no longer belongs to the
 * model it is about, and only the page's own arithmetic can answer that.
 */
function modelBytesIn(document: string, variables: Record<string, unknown> = {}): number {
  const prelude = moduleScript(document).match(/const VARS = [\s\S]*?modelBytes = [\s\S]*?: 0;/)?.[0];
  if (!prelude) throw new Error('the page has no modelBytes');

  const host = globalThis as Record<string, unknown>;
  const had = 'huggingface' in host;
  const previous = host['huggingface'];
  host['huggingface'] = { variables };
  try {
    return new Function(`${prelude}\nreturn modelBytes;`)() as number;
  } finally {
    if (had) host['huggingface'] = previous;
    else delete host['huggingface'];
  }
}

/**
 * The page's own language picker, lifted out and made callable.
 *
 * `VARS` and `navigator` come in as parameters rather than as globals: the question is
 * what the PAGE decides for a given browser and a given Space variable, and running its
 * own function against a stub answers it without a re-implementation to keep in step.
 */
function pickLangIn(
  document: string,
  languages: readonly string[],
  variables: Record<string, unknown> = {},
): string {
  const script = moduleScript(document);
  const fallback = script.match(/const FALLBACK_LANG = .*?;/)?.[0];
  const picker = script.match(/function pickLang\(\) \{[\s\S]*?\n {2}\}/)?.[0];
  if (!fallback || !picker) throw new Error('the page has no language picker');

  const run = new Function('VARS', 'navigator', `${fallback}\n${picker}\nreturn pickLang();`) as (
    vars: Record<string, unknown>,
    nav: { languages: readonly string[]; language: string | undefined },
  ) => string;

  return run(variables, { languages, language: languages[0] });
}

/** The `{named}` holes of a string, sorted, so two languages can be compared on them. */
function holes(value: string): string {
  return (value.match(/\{\w+\}/g) ?? []).sort().join(' ');
}

const MB = 1048576;

// ── Shape ──────────────────────────────────────────────────────────────────

describe('generateSpace', () => {
  it('emits index.html and README.md, and index.html is the entry point', () => {
    const space = generateSpace(config());

    expect(space.files.map((file) => file.path)).toEqual(['index.html', 'README.md']);
    expect(space.files[0]?.content).toBe(space.indexHtml);
    expect(space.indexHtml.startsWith('<!doctype html>')).toBe(true);
  });

  it('is pure — the same config twice gives the same bytes', () => {
    expect(generateSpace(config()).indexHtml).toBe(generateSpace(config()).indexHtml);
  });

  it('inlines the theme instead of linking a second file', () => {
    const document = html();

    expect(document).toContain('<style>');
    expect(document).not.toContain('style.css');
  });
});

// ── The pinned version ─────────────────────────────────────────────────────

describe('CDN pinning', () => {
  it('never floats a version', () => {
    const document = html();

    expect(document).not.toContain('@latest');
    expect(document).not.toContain('@next');
    expect(document).not.toContain('@alpha');

    // Every @aparte/* URL carries the exact version, and no other.
    const aparteUrls = document.match(/@aparte\/[a-z-]+@[^/'"]+/g) ?? [];
    expect(aparteUrls.length).toBeGreaterThan(0);
    for (const url of aparteUrls) expect(url.endsWith(`@${APARTE_VERSION}`)).toBe(true);
  });

  it('loads the core stylesheet from the same pinned version', () => {
    expect(html()).toContain(
      `https://cdn.jsdelivr.net/npm/@aparte/core@${APARTE_VERSION}/dist/index.css`,
    );
  });
});

// ── One mode, and it is an invariant ───────────────────────────────────────

describe('browser mode', () => {
  const document = html({ dtype: 'q8' });

  it('registers the in-browser provider and the model', () => {
    expect(document).toContain("from '@aparte/provider-transformers'");
    expect(document).toContain('registerModel({');
    expect(document).toContain("task: 'text-generation'");
    expect(document).toContain("capabilities: ['streaming']");
    expect(document).toContain('dtype: "q8"');
    expect(document).toContain('registerAIProvider(TransformersProvider)');
  });

  it('maps the peer dependency, which no CDN bundle contains', () => {
    expect(document).toContain('"@huggingface/transformers": "https://cdn.jsdelivr.net/npm/@huggingface/transformers@');
  });

  it('loads the provider from dist, so its worker asset resolves', () => {
    expect(document).toContain(`@aparte/provider-transformers@${APARTE_VERSION}/dist/index.js`);
    expect(document).not.toContain(`@aparte/provider-transformers@${APARTE_VERSION}/+esm`);
  });

  it('shows download progress before the first send', () => {
    expect(document).toContain('TransformersProvider.prepareModel(settings.model');
    expect(document).toContain("update.status === 'downloading'");
    expect(document).toContain('<progress');
    expect(document).toContain("composer.setAttribute('disabled', '')");
  });

  it('brings no OpenAI-compatible provider along', () => {
    expect(document).not.toContain('provider-openai-compat');
  });
});

// ── Nobody clicks a download without knowing what it costs ─────────────────

/**
 * The rule these all defend: every figure the page shows was measured, and where
 * nothing was measured the page says nothing.
 *
 * A wrong size is worse than no size. Someone who clicks "Load the model · 172 MB"
 * has agreed to 172 megabytes; if the real download is 800, the page spent their
 * data on a promise it invented. So each test here is either "the number is there
 * and it is right" or "the number is gone, and nothing took its place".
 */
describe('the weight of the download', () => {
  it('puts the size on the button, where the decision is made', () => {
    const script = moduleScript(weighed(180355072));

    expect(script).toContain('const BAKED_BYTES = 180355072; /* 172 MB */');
    expect(script).toContain(
      'gateAction.textContent = weight ? fill(T.loadModelWeighed, { weight: weight }) : T.loadModel',
    );
    // The label is one whole sentence with a hole in it, not two fragments glued.
    expect(script).toContain('loadModelWeighed: "Load the model · {weight}"');
  });

  it('bakes nothing when nothing was measured, and offers a plain button', () => {
    expect(moduleScript(html())).toContain('const BAKED_BYTES = 0;');
    // No comment either: `/* 0 MB */` would be a figure, and there is no figure.
    expect(moduleScript(html())).not.toContain('BAKED_BYTES = 0; /*');
    expect(modelBytesIn(html())).toBe(0);
  });

  it('refuses a byte count that is not a byte count', () => {
    for (const bogus of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(moduleScript(weighed(bogus))).toContain('const BAKED_BYTES = 0;');
    }
  });

  it('keeps the figure while the Space still points at the model it describes', () => {
    const document = weighed(172 * MB);

    expect(modelBytesIn(document)).toBe(172 * MB);
    expect(modelBytesIn(document, { MODEL_ID: 'onnx-community/Qwen2.5-0.5B-Instruct' })).toBe(
      172 * MB,
    );
  });

  it('drops the figure the moment MODEL_ID names a different model', () => {
    const document = weighed(172 * MB);

    // The Space owner swapped the model in Settings → Variables. 172 MB was true of
    // the old one and says nothing about this one, so the page stops claiming it.
    expect(modelBytesIn(document, { MODEL_ID: 'onnx-community/Llama-3.2-1B' })).toBe(0);
  });

  it('lets MODEL_BYTES put a size back, for the model that now has one', () => {
    const document = weighed(172 * MB);

    expect(
      modelBytesIn(document, { MODEL_ID: 'onnx-community/Llama-3.2-1B', MODEL_BYTES: 800 * MB }),
    ).toBe(800 * MB);
    // A string is what a Space variable actually arrives as.
    expect(modelBytesIn(document, { MODEL_BYTES: String(90 * MB) })).toBe(90 * MB);
    // And junk in the variable falls back rather than poisoning the label.
    expect(modelBytesIn(document, { MODEL_BYTES: 'lots' })).toBe(172 * MB);
    expect(modelBytesIn(document, { MODEL_BYTES: '-5' })).toBe(172 * MB);
  });

  it('spells a size exactly as the configurator spelled it', () => {
    const humanBytes = pageFormatter(weighed(172 * MB));

    for (const bytes of [0, -1, 12, 400 * 1024, MB, 4.7 * MB, 10 * MB, 172 * MB, 1024 * MB, 1.4 * 1024 * MB]) {
      expect(humanBytes(bytes)).toBe(formatBytes(bytes));
    }
  });
});

// ── The gate tells the truth to a visitor who has been here before ─────────

describe('a returning visitor', () => {
  const script = moduleScript(html());

  it('asks the provider whether the weights are already here', () => {
    expect(script).toContain('TransformersProvider.getModelStatus(settings.model)');
    // Optional on the provider interface — a plain call would throw on a provider
    // that does not implement it.
    expect(script).toContain("typeof TransformersProvider.getModelStatus !== 'function'");
    expect(script).toContain("state !== 'cached' && state !== 'ready'");
  });

  it('stops calling it a download once it is one', () => {
    expect(script).toContain('The weights are already in this browser. Nothing to download.');
    expect(script).toContain('gateAction.textContent = T.startModel');
    expect(script).toContain('say(weightsCached ? T.loadingFromCache : T.preparing)');
  });

  it('survives an origin where the cache cannot be read at all', () => {
    // The configurator previews this page in a sandbox without allow-same-origin, and
    // reading the Cache API there throws. The probe is asynchronous and swallowed, so
    // a page that cannot ask simply keeps the wording it already has.
    expect(script).toMatch(/getModelStatus[\s\S]*?\} catch \(error\) \{/);
    expect(script).toContain('if (started) return;');
  });
});

// ── What transformers.js actually reports, and nothing more ────────────────

describe('progress, honestly', () => {
  const script = moduleScript(weighed(172 * MB));

  it('names the file and the percentage it was given', () => {
    expect(script).toContain("const reading = update.status === 'cached';");
    expect(script).toContain('file: update.file || T.someFile');
    expect(script).toContain('percent: String(percent)');
    expect(script).toContain('downloading: "Downloading {file} — {percent}%"');
    expect(script).toContain('reading: "Reading {file} — {percent}%"');
  });

  it('reports the total as a total, and never multiplies it by a per-file percent', () => {
    // `progress` is the progress of ONE file. `172 MB * 43%` would print a figure
    // nothing measured, so the size is stated as what it is: the whole download.
    expect(script).toContain('downloadingTotal: "Downloading {file} — {percent}% · {weight} in all"');
    expect(script).not.toContain('modelBytes * percent');
    expect(script).not.toContain('percent / 100');
  });

  it('keeps a line for the case where the total is unknown', () => {
    // Four whole sentences, not a verb glued to a clause glued to a suffix: an
    // unmeasured download has no total to mention, and the next language along puts
    // the words in another order.
    expect(script).toContain('const line = weight');
    expect(script).toContain('? (reading ? T.readingTotal : T.downloadingTotal)');
    expect(script).toContain(': (reading ? T.reading : T.downloading);');
  });
});

// ── Data saver ─────────────────────────────────────────────────────────────

describe('data-saver mode', () => {
  const script = moduleScript(weighed(172 * MB));

  it('warns before offering the download, instead of starting it', () => {
    expect(script).toContain('navigator.connection && navigator.connection.saveData');
    expect(script).toContain('and this is a {weight} download');
    expect(script).toContain('fill(T.saveDataWeighed, { weight: weight })');
    expect(script).toContain('gateWarning.hidden = false');
    // The warning is a sentence, not a lock: the visitor still decides.
    expect(script).toContain('Nothing starts until you ask for it.');
  });

  it('keeps a word for the case where the size is unknown', () => {
    // "Unknown" can be a gigabyte, so it earns the warning too.
    expect(script).toContain('these weights can run to hundreds of megabytes');
    expect(script).toContain('!modelBytes || modelBytes >= SAVE_DATA_FLOOR');
  });
});

// ── The generated script has to parse ──────────────────────────────────────

describe('the module script', () => {
  it('is syntactically valid JavaScript, weights known or not, in every language', () => {
    const documents = [
      html(),
      weighed(172 * MB),
      html({ modelId: '' }),
      html({ lang: 'fr' }),
      html({ lang: 'both' }),
      weighed(172 * MB, { lang: 'both' }),
    ];

    // Parsed as an ASYNC function body, because what ships is `<script type="module">`
    // and a module may await at its top level — which the `both` page does, to load the
    // French locale only for the visitor who turned out to need it. `new Function` would
    // reject that as "await is only valid in async functions", and the page it rejects
    // runs fine in every browser this product supports.
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
      body: string,
    ) => unknown;

    for (const document of documents) {
      const body = moduleScript(document).replace(/^\s*import .*$/gm, '');
      expect(() => new AsyncFunction(body)).not.toThrow();
    }
  });

  it('brings in nothing new to say a number', () => {
    const document = weighed(172 * MB);
    const urls = document.match(/https?:\/\/[^\s'"]+/g) ?? [];
    const hosts = new Set(urls.map((url) => new URL(url).host));

    expect([...hosts].sort()).toEqual(['cdn.jsdelivr.net', 'space.apartejs.dev']);
  });
});

describe('the CDN worker, now handled upstream', () => {
  /**
   * Until 0.16.1 this file shipped a shim: it fetched the provider's worker source,
   * rewrote its bare `@huggingface/transformers` import and handed back a same-origin
   * blob worker. apartejs/aparte#41 fixed both halves upstream, so the shim is gone —
   * and what replaces it is the import map, which the worker now reads to find its peer
   * dependency. That map is therefore load-bearing, not decoration.
   */
  it('carries no shim any more', () => {
    const document = html();

    expect(document).not.toContain('useSameOriginWorker');
    expect(document).not.toContain('window.Worker =');
    expect(document).not.toContain('aparte#41');
  });

  it('still declares the peer dependency in the import map, which the worker reads', () => {
    const document = html();

    expect(document).toContain('<script type="importmap">');
    expect(document).toContain('"@huggingface/transformers"');
  });
});

describe('the v1 invariant: browser-only', () => {
  const laterModes: SpaceConfig['mode'][] = ['providers', 'endpoint'];

  it.each(laterModes)('emits the browser page for a %s config too, without throwing', (mode) => {
    const document = html({ mode, endpointUrl: 'https://llm.example.com/v1' });

    expect(document).toContain("from '@aparte/provider-transformers'");
    expect(document).toContain('TransformersProvider.prepareModel(settings.model');
    expect(document).not.toContain('provider-openai-compat');
    expect(document).not.toContain('ENDPOINT_URL');
    expect(document).not.toContain('llm.example.com');
  });

  it('ships no sign-in, no token, no key field and no router', () => {
    const document = html();

    expect(document.toLowerCase()).not.toContain('oauth');
    expect(document).not.toContain('@huggingface/hub');
    expect(document).not.toContain('id="api-key"');
    expect(document).not.toContain('router.huggingface.co');
  });

  // The preview renders this document in an iframe sandboxed WITHOUT
  // allow-same-origin — otherwise the previewed page could read the configurator's
  // localStorage, where the user's Hugging Face token lives. On an opaque origin
  // every same-origin store throws on access, so the load path must not touch one.
  it('assumes no same-origin storage at load time', () => {
    const document = html();

    expect(document).not.toContain('localStorage');
    expect(document).not.toContain('sessionStorage');
    expect(document).not.toContain('document.cookie');
    expect(document).not.toContain('indexedDB');
  });
});

// ── Settings, overridable at runtime ───────────────────────────────────────

describe('window.huggingface.variables', () => {
  it('reads every setting from the Space variables, falling back to what was baked in', () => {
    const document = html();

    expect(document).toContain('globalThis.huggingface && globalThis.huggingface.variables');
    expect(document).toContain('title: VARS.TITLE || "Tiny chat"');
    expect(document).toContain('model: VARS.MODEL_ID ||');
    expect(document).toContain('systemPrompt: VARS.SYSTEM_PROMPT ?? "You are helpful."');
    expect(document).toContain('greeting: VARS.GREETING ?? "Ask me anything."');
    expect(document).toContain('accent: VARS.ACCENT ||');
  });

  it('uses ?? for the settings an empty string can legitimately mean', () => {
    const document = html();

    // A blank SYSTEM_PROMPT is a way to turn the prompt off; a blank TITLE is not
    // a title, so that one falls through to the baked value.
    expect(document).toContain('SYSTEM_PROMPT ??');
    expect(document).toContain('TITLE ||');
  });

  it('bakes the SAME heading fallback the markup shows, so an untitled Space keeps it', () => {
    // Regression: the markup used `title || modelId || 'aparté chat'` while the
    // settings block baked `config.title` alone, so a Space generated with no title
    // drew its model id and then blanked the tab and the H1 as soon as the module ran.
    const named = html({ title: '', modelId: 'onnx-community/Qwen2.5-0.5B-Instruct' });

    expect(named).toContain('<title>onnx-community/Qwen2.5-0.5B-Instruct</title>');
    expect(named).toContain('<h1 class="app-title" id="title">onnx-community/Qwen2.5-0.5B-Instruct</h1>');
    expect(named).toContain('title: VARS.TITLE || "onnx-community/Qwen2.5-0.5B-Instruct"');
    expect(named).not.toContain('title: VARS.TITLE || ""');

    const anonymous = html({ title: '', modelId: '' });

    expect(anonymous).toContain('<title>aparté chat</title>');
    expect(anonymous).toContain('title: VARS.TITLE || "aparté chat"');
  });
});

// ── Appearance ─────────────────────────────────────────────────────────────

describe('theme, accent and metadata', () => {
  it('writes the theme attribute for light and dark', () => {
    expect(html({ theme: 'dark' })).toContain('<html lang="en" data-aparte-theme="dark">');
    expect(html({ theme: 'light' })).toContain('<html lang="en" data-aparte-theme="light">');
  });

  it('writes no attribute for system, and follows the visitor instead', () => {
    const document = html({ theme: 'system' });

    expect(document).toContain('<html lang="en">');
    expect(document).not.toContain('data-aparte-theme="system"');
    expect(document).toContain("matchMedia('(prefers-color-scheme: dark)')");
  });

  it('drives the palette from one accent token', () => {
    expect(html({ accent: '#0ea5e9' })).toContain('--aparte-primary: #0ea5e9;');
  });

  it('refuses an accent that is not a hex colour', () => {
    const document = html({ accent: 'red; } body { display: none } .x {' });

    expect(document).not.toContain('display: none } .x');
    expect(document).toContain(`--aparte-primary: ${DEFAULT_CONFIG.accent};`);
  });

  it('puts the title and emoji in the document', () => {
    const document = html({ title: 'Orbit', emoji: '🚀' });

    expect(document).toContain('<title>Orbit</title>');
    expect(document).toContain('<span class="app-emoji" aria-hidden="true">🚀</span>');
  });
});

// ── Flags ──────────────────────────────────────────────────────────────────

describe('attachments', () => {
  it('mounts the picker and the chips strip when they are asked for', () => {
    const document = html({ attachments: true });

    expect(document).toContain('<aparte-chat center-empty attachments>');
    expect(document).toContain('<aparte-composer-add-attachment>');
    expect(document).toContain('<aparte-composer-attachments>');
  });

  it('mounts neither when they are not', () => {
    const document = html({ attachments: false });

    expect(document).toContain('<aparte-chat center-empty>');
    expect(document).not.toContain('aparte-composer-add-attachment');
    expect(document).not.toContain('aparte-composer-attachments');
  });
});

describe('a Space that has no model yet', () => {
  /**
   * Publishing the page before the model exists is a supported path — the page reads
   * MODEL_ID from the Space's variables. Refusing to generate used to send the scenario
   * into a loop: "I cannot write the files without a model id", then ask again, forever.
   */
  it('is generated, and says where to put the model id', () => {
    const document = html({ modelId: '' });

    expect(document).toContain('MODEL_ID');
    expect(document).toContain('Variables and secrets');
  });

  it('offers no button that cannot work, and registers no empty model', () => {
    const document = html({ modelId: '' });
    const script = document.slice(document.indexOf('<script type="module">'));

    expect(script).toContain('gateAction.hidden = true');
    // registerModel sits behind the guard, so an id-less page never reaches it.
    expect(script.indexOf('if (!settings.model)')).toBeLessThan(script.indexOf('registerModel({'));
  });

  it('still generates the file rather than reporting a missing field', () => {
    expect(missingFields({ ...DEFAULT_CONFIG, modelId: '', title: 'T' })).toEqual([]);
  });
});

describe('the visitor own messages', () => {
  /**
   * Caught in a real browser, not by the suite: the model answered and the questions
   * were nowhere. `AparteClient` owns the assistant turn only — on the vanilla path
   * the page must append the user's message itself, which the wrappers do for you.
   */
  it('appends them to the transcript, since the client only owns the assistant turn', () => {
    const document = html({});

    expect(document).toContain("addEventListener('aparte-send'");
    expect(document).toContain('appendMessage');
    expect(document).toContain("role: 'user'");
  });
});

describe('badge', () => {
  it('renders the mascot mark and links home when it is on', () => {
    const document = html({ badge: true });

    expect(document).toContain('https://space.apartejs.dev');
    expect(document).toContain("('.')");
    expect(document).toContain('Made with aparté');
    expect(generateReadme(config({ badge: true }))).toContain(
      '[![Made with Aparté Spaces](https://space.apartejs.dev/badge.svg)](https://space.apartejs.dev)',
    );
  });

  it('renders nothing when it is off', () => {
    const document = html({ badge: false });

    expect(document).not.toContain('Made with aparté');
    expect(document).not.toContain('<footer');
    expect(generateReadme(config({ badge: false }))).not.toContain('badge.svg');
  });
});

// ── The language the generated Space speaks ────────────────────────────────

/**
 * A DIFFERENT decision from the language the configurator speaks, and it is made by
 * someone who does not know their audience: a Space is public on a worldwide Hub. So
 * `en` and `fr` bake one set of strings and `both` bakes two and asks the visitor's own
 * browser — and the thing these tests actually defend is that no user-facing string is
 * ever a literal at a call site, because a literal is a string nobody can translate.
 */
describe('the copy table', () => {
  it('gives every French string the same holes as its English source', () => {
    // The type already forces French to have every KEY. Nothing forces it to keep the
    // values a sentence needs, and a `{weight}` lost in translation is a label that
    // silently stops saying how big the download is.
    for (const key of Object.keys(PAGE_COPY.en) as Array<keyof PageCopy>) {
      expect([key, holes(PAGE_COPY.fr[key])]).toEqual([key, holes(PAGE_COPY.en[key])]);
    }
  });

  it('ships no string this Space never shows', () => {
    // The badge is the only one that can be switched off, and a page without a footer
    // has no use for the word — in either language.
    for (const lang of ['en', 'fr', 'both'] as const) {
      const document = html({ lang, badge: false });

      expect(document).not.toContain('Made with aparté');
      expect(document).not.toContain('Fait avec aparté');
      expect(document).not.toContain('T.badge');
    }

    expect(html({ lang: 'both', badge: true })).toContain('badgeLabel.textContent = T.badge');
  });

  it('leaves no hole unfilled in the markup the visitor sees', () => {
    for (const lang of ['en', 'fr', 'both'] as const) {
      const document = html({ lang });
      const markup = document.slice(0, document.indexOf('<script type="module">'));

      expect(markup).not.toMatch(/\{\w+\}/);
    }
  });
});

describe("the library's own words", () => {
  // The gap this pins, seen in the preview: the page said "Ce modèle tourne entièrement
  // dans votre navigateur" over a composer that said "Type a message…". Everything this
  // generator writes was translated; nothing aparté writes was, because core ships
  // English and the French package was never loaded.
  it('ships the French locale with a French Space, and applies it', () => {
    const document = html({ lang: 'fr' });

    expect(document).toContain('@aparte/locale-fr@');
    expect(document).toContain("import { fr } from '@aparte/locale-fr'");
    expect(moduleScript(document)).toContain('aparteGlobalConfig.setLocale(fr)');
  });

  it('loads it on demand on a bilingual Space, and never for an English visitor', () => {
    const script = moduleScript(html({ lang: 'both' }));

    expect(script).toContain("if (LANG === 'fr')");
    expect(script).toContain("await import('@aparte/locale-fr')");
    // Dynamic, so the English half of a bilingual audience downloads no French at all.
    expect(script).not.toContain("import { fr } from '@aparte/locale-fr'");
  });

  it('sets the locale before the first render, not after it', () => {
    const script = moduleScript(html({ lang: 'fr' }));

    // A locale applied after the components have drawn leaves an English composer on
    // screen until something happens to redraw it.
    expect(script.indexOf('setLocale(fr)')).toBeLessThan(
      script.indexOf('registerDefaultRenderers()'),
    );
  });

  it('names no French package on an English Space', () => {
    const document = html({ lang: 'en' });

    expect(document).not.toContain('locale-fr');
  });
});

describe('a Space written in one language', () => {
  it('bakes that language and only that one', () => {
    const french = moduleScript(html({ lang: 'fr' }));

    expect(french).toContain('Ce modèle tourne entièrement dans votre navigateur.');
    expect(french).not.toContain('This model runs entirely in your browser.');
    // One table, no picker: the page stays the size it has always been.
    expect(french).toContain('const T = {');
    expect(french).not.toContain('const COPY = {');
    expect(french).not.toContain('function pickLang()');
  });

  it('says which language in the lang attribute, whatever the theme', () => {
    expect(html({ lang: 'fr' })).toContain('<html lang="fr">');
    expect(html({ lang: 'en' })).toContain('<html lang="en">');
    expect(html({ lang: 'fr', theme: 'dark' })).toContain(
      '<html lang="fr" data-aparte-theme="dark">',
    );
  });

  it('translates the markup as well as the script', () => {
    const document = html({ lang: 'fr' });

    // The three strings that live outside the script — and the accessible name is one
    // of them, which is exactly the kind of string an English literal survives in.
    expect(document).toContain('aria-label="Téléchargement du modèle"');
    expect(document).toContain('Rien ne quitte votre appareil.');
    expect(document).toContain('<span id="badge-label">Fait avec aparté</span>');
    // Nothing to rewrite at runtime, so nothing rewrites it.
    expect(document).not.toContain('document.documentElement.lang =');
  });

  it('keeps the Hub own words for the Hub own menus', () => {
    // The settings UI a French owner has to click through is in English. Translating
    // the path would send them looking for a menu that does not exist.
    const french = html({ lang: 'fr', modelId: '' });

    expect(french).toContain('Pas encore de modèle.');
    expect(french).toContain('Settings → Variables and secrets → New variable');
    expect(french).toContain('MODEL_ID');
  });
});

describe('a Space that carries both languages', () => {
  const document = html({ lang: 'both' });
  const script = moduleScript(document);

  it('ships both sets and picks between them at load time', () => {
    expect(script).toContain('const COPY = {');
    expect(script).toContain('This model runs entirely in your browser.');
    expect(script).toContain('Ce modèle tourne entièrement dans votre navigateur.');
    expect(script).toContain('const LANG = pickLang();');
    expect(script).toContain('const T = COPY[LANG];');
  });

  it('reads the visitor own browser, primary subtag only', () => {
    expect(pickLangIn(document, ['fr-CA'])).toBe('fr');
    expect(pickLangIn(document, ['FR'])).toBe('fr');
    expect(pickLangIn(document, ['en-GB'])).toBe('en');
    // The first language it can actually speak, not the first one asked for.
    expect(pickLangIn(document, ['de-DE', 'fr-BE'])).toBe('fr');
  });

  it('falls back to the language the Space was generated in', () => {
    expect(pickLangIn(document, ['de-DE'])).toBe('en');
    expect(pickLangIn(document, [])).toBe('en');

    const french = generateIndexHtml({ ...config({ lang: 'both' }), creatorLang: 'fr' });

    expect(moduleScript(french)).toContain('const FALLBACK_LANG = "fr";');
    expect(pickLangIn(french, ['de-DE'])).toBe('fr');
    // And the markup is written in the fallback, since that is what loads first.
    expect(french).toContain('<html lang="fr">');
    expect(french).toContain('Rien ne quitte votre appareil.');
  });

  it('lets the LANG variable pin it, like every other setting', () => {
    expect(pickLangIn(document, ['fr-FR'], { LANG: 'en' })).toBe('en');
    expect(pickLangIn(document, ['en-US'], { LANG: 'fr' })).toBe('fr');
    expect(pickLangIn(document, ['en-US'], { LANG: 'FR-ca' })).toBe('fr');
    // A variable nobody can honour is ignored rather than obeyed into a blank page.
    expect(pickLangIn(document, ['fr-FR'], { LANG: 'de' })).toBe('fr');
    expect(pickLangIn(document, ['fr-FR'], { LANG: '' })).toBe('fr');
  });

  it('moves the lang attribute and the markup with the choice', () => {
    // The document loads in the fallback; whichever strings live outside the script
    // are rewritten when the visitor turned out to speak the other language.
    expect(document).toContain('<html lang="en">');
    expect(script).toContain('document.documentElement.lang = LANG;');
    expect(script).toContain("document.getElementById('gate-note').textContent = T.gateNote;");
    expect(script).toContain("setAttribute('aria-label', T.progressLabel)");
    expect(script).toContain('badgeLabel.textContent = T.badge');
  });

  it('still touches no same-origin storage to do it', () => {
    // navigator.language is not a store. The preview sandboxes this page without
    // allow-same-origin, and anything that reads a store there throws on load.
    expect(document).not.toContain('localStorage');
    expect(document).not.toContain('document.cookie');
    expect(script).toContain('navigator.languages');
  });

  it('brings no new dependency along to say it twice', () => {
    const urls = document.match(/https?:\/\/[^\s'"]+/g) ?? [];
    const hosts = new Set(urls.map((url) => new URL(url).host));

    expect([...hosts].sort()).toEqual(['cdn.jsdelivr.net', 'space.apartejs.dev']);
  });
});

describe('the README follows the Space', () => {
  it('is written in French for a French Space, front matter and badge untouched', () => {
    const readme = generateReadme(config({ lang: 'fr' }));

    // The front matter is Hub configuration, not prose: translate a key and the Space
    // stops building.
    expect(readme.startsWith('---\n')).toBe(true);
    expect(readme).toContain('sdk: static');
    expect(readme).toContain('title: "Tiny chat"');
    expect(readme).toContain('colorFrom: indigo');
    expect(readme).toContain(
      '[![Made with Aparté Spaces](https://space.apartejs.dev/badge.svg)](https://space.apartejs.dev)',
    );

    expect(readme).toContain('## Ni compte, ni jeton, ni facture');
    expect(readme).toContain('| Variable | Ce qu’elle change | Valeur à la génération |');
    expect(readme).not.toContain('No account, no token, no bill');
  });

  it('is written in the creator language for a bilingual Space, and says the page adapts', () => {
    const english = generateReadme(config({ lang: 'both' }));

    expect(english).toContain('The page is written in English and in French');
    expect(english).toContain('it speaks English');
    expect(english).not.toContain('Ni compte, ni jeton');

    const french = generateReadme({ ...config({ lang: 'both' }), creatorLang: 'fr' });

    expect(french).toContain('La page est écrite en français et en anglais');
    expect(french).toContain('elle parle français');
    // A language is lowercase inside a French sentence; the picker's label is not.
    expect(french).not.toContain('parle Français');
  });

  it('documents LANG only on the Space where it can do anything', () => {
    expect(generateReadme(config({ lang: 'both' }))).toContain('| `LANG` |');

    for (const lang of ['en', 'fr'] as const) {
      expect(generateReadme(config({ lang }))).not.toContain('| `LANG` |');
    }
  });

  it('leaves no unfilled hole in any of the three', () => {
    for (const lang of ['en', 'fr', 'both'] as const) {
      expect(generateReadme(config({ lang }))).not.toMatch(/\{\w+\}/);
    }
  });
});

// ── The escaping, which is the whole ballgame ──────────────────────────────

describe('escaping', () => {
  const hostile = '</script><img src=x onerror=alert(1)>"\'\\';

  it('escapeHtml neutralises tags and both quote styles', () => {
    expect(escapeHtml('<b>"x"&\'y\'</b>')).toBe('&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
  });

  it('jsString hides < and > from the HTML parser while keeping the value intact', () => {
    const literal = jsString('</script>');

    expect(literal).not.toContain('</script>');
    expect(literal).toContain('\\u003c');
    // The point of the escape: the JS engine still sees the original string.
    expect(JSON.parse(literal)).toBe('</script>');
  });

  it('jsString round-trips quotes, backslashes and line separators', () => {
    // U+2028 / U+2029 are legal in JSON and illegal raw in a JS string literal, so
    // JSON.stringify alone would emit a file the browser refuses to parse.
    const lineSeparator = String.fromCharCode(0x2028);
    const paragraphSeparator = String.fromCharCode(0x2029);
    const nasty = `a"b'c\\d ${lineSeparator} e ${paragraphSeparator} f\ng`;
    const literal = jsString(nasty);

    expect(literal).not.toContain(lineSeparator);
    expect(literal).not.toContain(paragraphSeparator);
    expect(JSON.parse(literal)).toBe(nasty);
  });

  it('a hostile title cannot close the script block or open a tag', () => {
    const document = html({ title: hostile, systemPrompt: hostile, greeting: hostile });

    // One opening <script type="module"> and one closing </script> for it.
    const scriptCloses = document.match(/<\/script>/g) ?? [];
    expect(scriptCloses).toHaveLength(2); // the import map and the module script

    // No `<` from the hostile string ever reaches the HTML parser as a tag: in
    // text it is an entity, in JS it is a unicode escape. The payload's letters do
    // survive inside a JS string literal, which is the point — they are inert
    // there, and that string only ever becomes textContent.
    expect(document).not.toContain('<img');
  });

  it('a hostile title survives as a value, escaped, in both contexts', () => {
    const document = html({ title: hostile });

    // In HTML text: entity-escaped.
    expect(document).toContain(`<title>${escapeHtml(hostile)}</title>`);
    // In JS: a literal the engine reads back as the original string.
    expect(document).toContain(jsString(hostile));
  });

  it('a hostile model id stays inside its JS string literal', () => {
    // The model id never reaches the <style> block — the only user value that does
    // is the accent, and that one is whitelisted. What the id DOES reach is the
    // settings object, so what matters is that it stays a JS string there and never
    // becomes markup.
    const modelId = '</style><script>alert(1)</script>';
    const document = html({ modelId });

    expect(document).toContain(`model: VARS.MODEL_ID || ${jsString(modelId)}`);
    expect(document).not.toContain('<script>alert(1)');
    expect(document).not.toContain('</style><script>');
  });
});

// ── The README, which is Hub configuration ─────────────────────────────────

describe('generateReadme', () => {
  it('carries the static-Space front matter', () => {
    const readme = generateReadme(config());

    expect(readme.startsWith('---\n')).toBe(true);
    expect(readme).toContain('sdk: static');
    expect(readme).toContain('pinned: false');
    expect(readme).toContain('title: "Tiny chat"');
    expect(readme).toContain('colorFrom: indigo');
    expect(readme).toContain('colorTo: purple');
  });

  it('never asks the Hub for OAuth, whatever the config says', () => {
    const modes: SpaceConfig['mode'][] = ['browser', 'providers', 'endpoint'];

    for (const mode of modes) {
      const readme = generateReadme(config({ mode, endpointUrl: 'https://e.example/v1' }));

      expect(readme).not.toContain('hf_oauth');
      expect(readme).not.toContain('inference-api');
    }
  });

  it('says plainly that the Space needs no account and no token', () => {
    const readme = generateReadme(config());

    expect(readme).toContain('No account, no token, no bill');
    expect(readme).toContain("entirely in the visitor's browser");
    // The one honest caveat: the WEIGHTS still need auth if the repo is not public.
    expect(readme).toContain('private or gated repository');
  });

  it('falls back on a card colour the Hub would reject', () => {
    const readme = generateReadme(config({ colorFrom: 'chartreuse', colorTo: 'BLUE' }));

    expect(readme).toContain('colorFrom: indigo');
    expect(readme).toContain('colorTo: blue');
  });

  it('quotes a title that would otherwise change the YAML', () => {
    const readme = generateReadme(config({ title: 'Chat: "the good one"\nsdk: docker' }));

    expect(readme).toContain('title: "Chat: \\"the good one\\" sdk: docker"');
    // The injected key must not survive as a key of its own.
    expect(readme.split('---')[1]).not.toMatch(/^sdk: docker$/m);
  });

  it('puts one emoji on the card, or the default', () => {
    expect(generateReadme(config({ emoji: '🚀' }))).toContain('emoji: "🚀"');
    // A ZWJ sequence is still one glyph.
    expect(generateReadme(config({ emoji: '\u{1F468}\u200D\u{1F4BB}' }))).toContain(
      'emoji: "\u{1F468}\u200D\u{1F4BB}"',
    );
    // Prose, a second glyph, or something aimed at the front matter: none of it lands.
    for (const hostile of ['not an emoji', '🚀🛸', '" \nsdk: docker', 'x']) {
      expect(generateReadme(config({ emoji: hostile }))).toContain(
        `emoji: "${DEFAULT_CONFIG.emoji}"`,
      );
    }
  });

  it('documents the settings variables and warns about secrets', () => {
    const readme = generateReadme(config());

    expect(readme).toContain('`SYSTEM_PROMPT`');
    expect(readme).toContain('`MODEL_ID`');
    expect(readme).toContain('Settings → Variables and secrets');
    expect(readme).toContain('Never put');
    // v1 has no endpoint to document.
    expect(readme).not.toContain('ENDPOINT_URL');
  });

  it('keeps a multi-line value inside its table cell', () => {
    // Regression: values were escaped for pipes and backticks but not for newlines,
    // so the normal case — a SYSTEM_PROMPT written over several lines — ended the
    // Markdown table on its own row and took every row under it with it.
    const readme = generateReadme(
      config({ systemPrompt: 'Be brief.\n\nNever mention | pipes,\tor `backticks`.' }),
    );
    const lines = readme.split('\n');

    expect(lines).toContain(
      "| `SYSTEM_PROMPT` | The instructions sent ahead of every conversation. | `Be brief. Never mention \\| pipes, or 'backticks'.` |",
    );
    // The rows below it survive, which is what a raw newline used to destroy.
    expect(lines.some((line) => line.startsWith('| `GREETING`'))).toBe(true);
    expect(lines.some((line) => line.startsWith('| `ACCENT`'))).toBe(true);
  });

  it('links the model only when the id is one the Hub could have', () => {
    expect(generateReadme(config())).toContain(
      '](https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct)',
    );

    // A backtick would end the code span and a ")" would end the link destination.
    const hostile = generateReadme(config({ modelId: 'x`](https://evil.example)`y' }));

    expect(hostile).toContain("`x'](https://evil.example)'y`");
    expect(hostile).not.toContain('huggingface.co/x');
  });

  it('names the pinned aparté version', () => {
    expect(generateReadme(config())).toContain(APARTE_VERSION);
  });
});
