/**
 * The `index.html` of a generated Space.
 *
 * What this file emits IS the product: a single standalone document, no build step,
 * no npm, no backend. Everything it needs comes from jsDelivr, pinned to
 * `APARTE_VERSION` on every URL — a generated Space has to keep working long after
 * the configurator that wrote it has moved on.
 *
 * V1 SHIPS ONE INFERENCE MODE: the browser. The page runs the model on the visitor's
 * own machine through Transformers.js — so there is no account, no token, no key
 * field and no sign-in anywhere below. `SpaceConfig.mode` still carries three values
 * (the contract is frozen for v1.x), but this generator only ever emits the browser
 * page; anything else is treated as `browser` rather than refused. The `providers`
 * and `endpoint` documents lived here until commit 86310b4 and will be fished back
 * out of it when those modes return.
 *
 * Four rules govern everything below.
 *
 * 1. ESCAPE EVERYTHING. Model ids, titles, prompts and greetings are user input and
 *    they land in HTML text, in HTML attributes and in JavaScript string literals.
 *    `escapeHtml()` and `jsString()` are the only ways any of them get in. A title
 *    containing `</script>` must not break the file — see `jsString`.
 * 2. SETTINGS ARE OVERRIDABLE. Hugging Face injects a static Space's variables as
 *    `window.huggingface.variables`, so the owner can change the model, the prompt
 *    or the title from the Space settings without editing this file. The values
 *    baked in at generation time are the fallback, never the only source.
 * 3. THE PAGE SPEAKS ONE LANGUAGE, OR IT SPEAKS THE VISITOR'S. Every user-facing
 *    string lives in ONE table (`pageCopyEn` / `pageCopyFr`) and none is a literal at
 *    a call site. `config.lang` decides what ships: `en` or `fr` bake a single table
 *    and the document stays the size it has always been; `both` bakes two and picks
 *    at load time from the visitor's own `navigator.language`, with the creator's
 *    language as the fallback and a `LANG` variable to pin it. `<html lang>` follows,
 *    at generation time and again at runtime.
 * 4. NEVER GUESS A NUMBER. The page announces what the download weighs, because
 *    nobody should click "Load the model" without knowing whether that means
 *    172 MB or 800 MB. Every figure it shows was measured — on the Hub at
 *    generation time, or by transformers.js while it runs. Where nothing was
 *    measured the page says nothing, and a size that belongs to a model the
 *    settings have since replaced is dropped rather than reused.
 *
 * And one constraint from the configurator's preview, which is not cosmetic: this
 * document is rendered in an iframe sandboxed WITHOUT `allow-same-origin`, so at
 * load time it must touch no same-origin storage — no `localStorage`, no cookies,
 * no `caches`. Reading any of them on an opaque origin throws, and the page would
 * die before it drew anything. See the note on `generateSpace()`.
 */

import { APARTE_VERSION, type SpaceConfig } from '../config/space-config';
import type { Lang } from '../i18n/lang';
import { componentDtypes, formatBytes } from '../hub/types';
import { generateStyleCss, safeAccent } from './style-css';

/**
 * A `SpaceConfig`, plus the two things the generator is told rather than asked.
 *
 * Additive and optional, so every existing caller keeps working and a config written
 * before these fields existed still generates.
 *
 * `downloadBytes` is the TOTAL the visitor's browser pulls for `config.dtype` —
 * `ModelScan.onnxSizes[dtype]`, sidecars included — and it is absent, not zero, when
 * the Hub never told us.
 *
 * `creatorLang` is the language the CONFIGURATOR was speaking, and it matters in one
 * case only: `config.lang === 'both'`, where the page carries both sets of strings and
 * needs a fallback for a visitor whose browser asks for neither. It is not part of
 * `SpaceConfig` because the contract there is frozen, and because it is not a choice
 * anybody made about the Space — it is a fact about the session that wrote it. Absent,
 * it is English, which is both `detectLang()`'s answer and the Hub's own default.
 *
 * They ride on the config rather than on extra parameters for one reason: the generator
 * has exactly one input, and `generateSpace(config)` should not have to grow a second one
 * to pass a value through. The day either joins `SpaceConfig` proper, nothing here
 * changes.
 */
export type SpaceConfigWithWeights = SpaceConfig & {
  downloadBytes?: number;
  creatorLang?: Lang;
  /**
   * component → the dtypes it is published in, straight from `ModelScan`.
   *
   * The RAW decomposition rather than a finished `{ component: dtype }` map, because the
   * chosen precision can still change after the scan: carrying the answer would mean
   * recomputing it on every `dtype` patch and getting one wrong eventually. The generator
   * asks `componentDtypes()` at the moment it writes the file, once, from the dtype that
   * is actually in the config by then.
   */
  components?: Record<string, string[]>;
};

// ── What the generated page says ───────────────────────────────────────────

/**
 * Every user-facing string of the generated page, in the language it was written in.
 *
 * ENGLISH IS THE SOURCE AND IT DEFINES THE TYPE. `PageCopy` is `typeof pageCopyEn`, so
 * a French table that forgets a key is a compile error rather than a blank on somebody
 * else's Space. Deliberately not a `Record<string, string>`: that would typecheck an
 * empty object and defeat the only guard this table has.
 *
 * The values are TEMPLATES with `{named}` holes, never sentences glued out of
 * fragments. `'Downloading ' + file + ' — ' + percent + '%'` is three fragments in one
 * fixed order, and word order is a property of a language, not of the code that prints
 * it. A hole can move anywhere inside its sentence, and a translation is free to
 * restructure the whole thing around it — which is what `downloading` does below.
 *
 * They are templates rather than functions for a mechanical reason: these strings do
 * not run here, they are WRITTEN INTO ANOTHER FILE and run in the visitor's browser.
 * A function cannot cross that gap; a string can, and `fill()` — three lines, in this
 * module and again in the generated page — puts the values back.
 */
const pageCopyEn = {
  /** Under the button, once there is a model to download. */
  gateNote: 'Nothing leaves your device. The weights download once, then stay cached.',
  /** Accessible name of the progress bar. */
  progressLabel: 'Model download',
  /** The mark in the footer. */
  badge: 'Made with aparté',
  /** No MODEL_ID anywhere: said in the words of the Hub's own settings UI, which is English. */
  noModel:
    'No model yet. In this Space: Settings → Variables and secrets → New variable, name it MODEL_ID, and give it a repository that ships ONNX weights.',
  runsInBrowser: 'This model runs entirely in your browser.',
  loadModel: 'Load the model',
  loadModelWeighed: 'Load the model · {weight}',
  saveDataWeighed:
    'Your browser is in data-saver mode, and this is a {weight} download. Nothing starts until you ask for it.',
  saveDataUnknown:
    'Your browser is in data-saver mode, and these weights can run to hundreds of megabytes. Nothing starts until you ask for it.',
  alreadyCached: 'The weights are already in this browser. Nothing to download.',
  startModel: 'Start the model',
  preparing: 'Preparing…',
  loadingFromCache: 'Loading from cache…',
  /** Four progress lines, not a verb glued to a clause: French moves the noun. */
  downloading: 'Downloading {file} — {percent}%',
  downloadingTotal: 'Downloading {file} — {percent}% · {weight} in all',
  reading: 'Reading {file} — {percent}%',
  readingTotal: 'Reading {file} — {percent}% · {weight} in all',
  /** Stands in for `{file}` when transformers.js names no file. */
  someFile: 'weights',
  loadingModel: 'Loading the model…',
  loadFailed: 'The model could not be loaded. {error}',
};

/** The type every other language has to satisfy. */
export type PageCopy = typeof pageCopyEn;

/**
 * The same page in French — a translation of the INTENT, not of the words.
 *
 * `{file}` sits after a colon rather than after "de", because the hole can hold a
 * filename or the fallback noun and `Téléchargement de model.onnx` is not French.
 * No-break spaces are written `\u00a0` rather than typed, so they stay visible in this
 * file: French puts one before `:` and before `%`, and an ordinary space there lets a
 * line break between the number and the sign.
 *
 * VOUVOIEMENT HERE, TUTOIEMENT IN THE CONFIGURATOR, and the split is not an oversight.
 * The configurator talks to one person who chose to open it \u2014 the model's author, a
 * peer \u2014 and says `ton mod\u00e8le`. This page is published on a worldwide Hub and read by
 * whoever lands on it, and `@aparte/locale-fr` says `\u00c9crivez un message\u2026` right under
 * these lines: a page that said `ton navigateur` above a composer that said `\u00e9crivez`
 * would be two registers in one screen. Seen in the preview, once the French locale
 * started loading. `noModel` is vouvoy\u00e9 too, though only the owner can act on it \u2014
 * the page has no idea who is reading it.
 */
const pageCopyFr: PageCopy = {
  gateNote:
    'Rien ne quitte votre appareil. Les poids se téléchargent une fois, puis restent en cache.',
  progressLabel: 'Téléchargement du modèle',
  badge: 'Fait avec aparté',
  noModel:
    'Pas encore de modèle. Dans ce Space\u00a0: Settings → Variables and secrets → New variable, nommez-la MODEL_ID et donnez-lui un dépôt qui publie des poids ONNX.',
  runsInBrowser: 'Ce modèle tourne entièrement dans votre navigateur.',
  loadModel: 'Charger le modèle',
  loadModelWeighed: 'Charger le modèle · {weight}',
  saveDataWeighed:
    'Votre navigateur est en mode économie de données, et ce téléchargement pèse {weight}. Rien ne démarre tant que vous ne le demandez pas.',
  saveDataUnknown:
    'Votre navigateur est en mode économie de données, et ces poids peuvent peser plusieurs centaines de mégaoctets. Rien ne démarre tant que vous ne le demandez pas.',
  alreadyCached: 'Les poids sont déjà dans ce navigateur. Rien à télécharger.',
  startModel: 'Démarrer le modèle',
  preparing: 'Préparation…',
  loadingFromCache: 'Chargement depuis le cache…',
  downloading: 'Téléchargement\u00a0: {file} — {percent}\u00a0%',
  downloadingTotal: 'Téléchargement\u00a0: {file} — {percent}\u00a0% · {weight} en tout',
  reading: 'Lecture\u00a0: {file} — {percent}\u00a0%',
  readingTotal: 'Lecture\u00a0: {file} — {percent}\u00a0% · {weight} en tout',
  someFile: 'les poids',
  loadingModel: 'Chargement du modèle…',
  loadFailed: 'Le modèle n’a pas pu être chargé. {error}',
};

export const PAGE_COPY: Record<Lang, PageCopy> = { en: pageCopyEn, fr: pageCopyFr };

/** `{named}` holes, filled. An unknown hole is left alone rather than blanked. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

/** True when this Space ships both languages and picks between them at load time. */
export function carriesBothLangs(config: SpaceConfigWithWeights): boolean {
  return config.lang === 'both';
}

/**
 * The language the MARKUP is written in.
 *
 * For `en` and `fr` that is the whole story. For `both` it is the fallback — what the
 * `<html lang>` attribute, the README and the strings baked into the document say
 * before the runtime picker gets a word in.
 */
export function bakedLang(config: SpaceConfigWithWeights): Lang {
  if (config.lang === 'fr') return 'fr';
  if (config.lang === 'en') return 'en';
  return config.creatorLang === 'fr' ? 'fr' : 'en';
}

/**
 * The download size worth baking in, or 0 for "we do not know".
 *
 * 0 is the single "say nothing" value the whole page tests against — a negative, a NaN,
 * an Infinity or a fractional byte count are all treated as no answer rather than
 * smuggled into a button label.
 */
function downloadBytesOf(config: SpaceConfigWithWeights): number {
  const bytes = config.downloadBytes;
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0) return 0;
  return bytes;
}

/**
 * ` /* 172 MB *​/` beside the raw byte count, or nothing when there is none.
 *
 * The generated file is meant to be read and edited by hand — it is the whole Space —
 * and `180355072` tells a human nothing. Written with the same helper the configurator
 * used, so the file and the conversation that produced it say the same number.
 */
function bakedWeightComment(config: SpaceConfigWithWeights): string {
  const weight = formatBytes(downloadBytesOf(config));
  return weight ? ` /* ${weight} */` : '';
}

// ── CDN ────────────────────────────────────────────────────────────────────

const CDN = 'https://cdn.jsdelivr.net/npm';

/**
 * `@huggingface/transformers` is a PEER dependency of the provider — heavy, and it
 * ships its own onnxruntime — so no CDN bundle contains it and the page has to
 * name a version itself. This one matches the provider's peer range (`^4.2.0`).
 */
const HF_TRANSFORMERS_VERSION = '4.2.0';

/** Where the badge points, and the front door of this generator. */
export const SPACES_URL = 'https://space.apartejs.dev';

const CORE_ESM = `${CDN}/@aparte/core@${APARTE_VERSION}/+esm`;
const CORE_CSS = `${CDN}/@aparte/core@${APARTE_VERSION}/dist/index.css`;
const HF_TRANSFORMERS_ESM = `${CDN}/@huggingface/transformers@${HF_TRANSFORMERS_VERSION}/+esm`;

/**
 * The transformers provider is the one package NOT loaded through `/+esm`.
 *
 * It spawns its inference Web Worker with `new URL('assets/worker-*.js',
 * import.meta.url)`. Under `/+esm` that resolves next to the `+esm` path, where the
 * asset does not exist; under `/dist/index.js` it resolves to the real file. The
 * version is pinned exactly the same way.
 */
const TRANSFORMERS_PROVIDER_URL = `${CDN}/@aparte/provider-transformers@${APARTE_VERSION}/dist/index.js`;

/**
 * The French strings of the LIBRARY — a separate package because core ships English.
 *
 * Without it a French Space is French in every word this generator writes and English in
 * every word aparté writes: the page said "Ce modèle tourne entièrement dans ton
 * navigateur" over a composer that said "Type a message…". Two languages, one screen.
 */
const LOCALE_FR_URL = `${CDN}/@aparte/locale-fr@${APARTE_VERSION}/+esm`;

/** The tab, the `<h1>` and the README heading, all from the same rule. */
const HEADING_FALLBACK = 'aparté chat';

/**
 * What this Space calls itself.
 *
 * One function because the answer has to be the same in three places — `<title>`,
 * the `<h1>` baked into the markup, and `settings.title`, which overwrites both a
 * moment after load. A Space generated with an empty title used to get its heading
 * from `modelId` in the markup and an empty string from the settings block, so the
 * tab and the H1 went blank as soon as the module ran.
 */
export function spaceHeading(config: SpaceConfig): string {
  return config.title || config.modelId || HEADING_FALLBACK;
}

// ── Escaping ───────────────────────────────────────────────────────────────

/**
 * HTML text and attribute values. Both quote styles are escaped so the result is
 * safe in `attr="…"` and `attr='…'` alike.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A JavaScript string literal, safe to drop inside a `<script>` block.
 *
 * `JSON.stringify` alone is not enough, and the gap is the single sharpest edge in
 * this module: it leaves `<` and `>` as themselves, so a title of `</script>` would
 * close the block from inside a string and the rest of the file would be parsed as
 * HTML. Escaping `<`, `>` and `&` to `\uXXXX` keeps the value byte-identical to the
 * JS engine while making it invisible to the HTML parser. U+2028/U+2029 are legal
 * in JSON and illegal in a JS string literal, so they go too.
 */
export function jsString(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// ── Pieces ─────────────────────────────────────────────────────────────────

/**
 * The bare specifiers the module script uses, mapped to pinned CDN URLs.
 *
 * One block holds every dependency the Space loads, which is the point: it is the
 * first thing to read when you want to know what this page pulls in, and the only
 * place a version appears twice would be a bug. It also lets the transformers
 * provider's own `import { … } from '@aparte/core'` resolve to the SAME url the
 * page uses — a second copy of core would carry a second provider registry.
 */
function importMap(config: SpaceConfig): string {
  const imports: Record<string, string> = {
    '@aparte/core': CORE_ESM,
    '@aparte/provider-transformers': TRANSFORMERS_PROVIDER_URL,
    '@huggingface/transformers': HF_TRANSFORMERS_ESM,
  };

  // An English-only Space never names the French package: it would be a line in the map
  // that nothing resolves, and this block is meant to be read as what the page loads.
  if (config.lang !== 'en') imports['@aparte/locale-fr'] = LOCALE_FR_URL;

  return JSON.stringify({ imports }, null, 2);
}

/**
 * The `dtype` the generated page passes to `registerModel`.
 *
 * A chat model is one graph and takes one word: `"q4"`. A VISION model is several graphs
 * that load together — `embed_tokens`, `vision_encoder`, `decoder_model_merged` — each
 * published in its own set of builds, and the loader has to be told which build of each
 * to fetch. So it takes a map, and the map is built with the SAME rule the download size
 * is counted with: the chosen dtype for every part that has it, its only build for a part
 * published once. Anything else would announce one number and fetch another.
 *
 * Falls back to the plain string whenever the parts are unknown — a hand-built config, a
 * scan that never ran — rather than inventing a map from nothing.
 */
function dtypeLiteral(config: SpaceConfigWithWeights): string {
  const map = componentDtypes({ onnxComponents: config.components }, config.dtype);
  if (!map) return jsString(config.dtype);

  const single = Object.keys(map);
  // One component named exactly as the whole model: that IS the plain case, and a map
  // of one is noise in a file people read.
  if (single.length === 1 && single[0] === 'model') return jsString(config.dtype);

  const entries = Object.entries(map).map(([part, dtype]) => `${jsString(part)}: ${jsString(dtype)}`);
  return `{ ${entries.join(', ')} }`;
}

/**
 * The composer, spelled out so the greeting can live inside the chat.
 *
 * `<aparte-chat>` fills in this exact composition when it is left empty — but only
 * when it is left empty: any child of ours would be replaced by it. The greeting
 * needs to sit between the transcript and the composer, so the composition is
 * written out instead, matching what core would have injected.
 *
 * No `style="flex: 1"` on the input, unlike the getting-started example: core's
 * stylesheet already declares `aparte-composer-input { flex: 1 1 auto }`, so the
 * inline copy only overrides it with a different flex-basis for no gain.
 */
function composition(config: SpaceConfig): string {
  const chips = config.attachments
    ? '\n          <aparte-composer-attachments></aparte-composer-attachments>'
    : '';
  const picker = config.attachments
    ? '\n            <aparte-composer-add-attachment></aparte-composer-add-attachment>'
    : '';

  return `        <div class="aparte-composer-shell">${chips}
          <div class="aparte-composer-row">${picker}
            <aparte-composer-input></aparte-composer-input>
            <aparte-composer-send></aparte-composer-send>
          </div>
        </div>`;
}

/**
 * The strip that stands between the visitor and a chat that cannot answer yet.
 *
 * The only thing standing there in v1 is the download: no account to create, no
 * token to paste, no sign-in to wait for. One button, once per browser.
 *
 * `gate-warning` is the data-saver line — empty and hidden in the markup, because
 * whether it has anything to say is a question only the visitor's browser can
 * answer. It wears `gate-text` rather than `gate-note`: a warning that arrives in
 * fine print is a warning nobody reads.
 *
 * The two strings that live in the MARKUP rather than in the script are here: the note
 * and the progress bar's accessible name. On a `both` page they are written in the
 * fallback language and the script rewrites them if the visitor turned out to speak the
 * other one — the same thing it already does to the title and the greeting.
 */
function gateMarkup(copy: PageCopy): string {
  return `
    <section class="gate" id="gate" hidden>
      <p class="gate-text" id="gate-text"></p>
      <p class="gate-text" id="gate-warning" hidden></p>
      <button class="aparte-btn aparte-btn--primary aparte-btn--solid" type="button" id="gate-action"></button>
      <progress class="progress" id="progress" max="100" aria-label="${escapeHtml(copy.progressLabel)}" hidden></progress>
      <p class="status" id="status" role="status" aria-live="polite"></p>
      <!-- Hidden until there is a model: with none configured there is no download to
           reassure anyone about, and the promise would read as a non sequitur. -->
      <p class="gate-note" id="gate-note" hidden>${escapeHtml(copy.gateNote)}</p>
    </section>
`;
}

function footerMarkup(config: SpaceConfig, copy: PageCopy): string {
  if (!config.badge) return '';

  return `
    <footer class="app-footer">
      <a class="badge" href="${SPACES_URL}" target="_blank" rel="noopener noreferrer">
        <span class="badge-mark" aria-hidden="true">('.')</span>
        <span id="badge-label">${escapeHtml(copy.badge)}</span>
      </a>
    </footer>
`;
}

// ── The module script ──────────────────────────────────────────────────────

const IMPORTS_BLOCK = `import { aparteGlobalConfig, AparteClient, AparteDirectTransport, registerDefaultRenderers } from '@aparte/core';
  import { TransformersProvider, registerModel } from '@aparte/provider-transformers';`;

/**
 * The library's own words, in the language this Space was written in.
 *
 * Core ships English, so `en` emits nothing at all. `fr` imports the package outright —
 * the page is French, it will need every key. `both` waits until `pickLang()` has read
 * the visitor's browser and then imports on demand, so an English visitor to a bilingual
 * Space downloads no French at all.
 *
 * Both arms run BEFORE `registerDefaultRenderers()`: a locale set after the first render
 * is a composer that says "Type a message…" until something happens to redraw it.
 */
function localeBlock(config: SpaceConfig): string {
  if (config.lang === 'en') return '';

  if (config.lang === 'fr') {
    return `
  /* aparté speaks English out of the box; this Space does not. */
  import { fr } from '@aparte/locale-fr';
  aparteGlobalConfig.setLocale(fr);
`;
  }

  return `
  /* Only the visitor who turned out to speak French pays for the French strings. */
  if (LANG === 'fr') {
    const { fr } = await import('@aparte/locale-fr');
    aparteGlobalConfig.setLocale(fr);
  }
`;
}

/**
 * Read the settings, then apply the ones that are pure presentation.
 *
 * `||` for the values an empty string cannot mean (a title, a model id) and `??`
 * for the ones it can — blanking SYSTEM_PROMPT or GREETING in the Space settings is
 * a legitimate way to turn them off.
 *
 * The baked title is `spaceHeading(config)`, not `config.title`: it has to be the
 * same string the markup already shows, or an unnamed Space blanks its own tab and
 * `<h1>` the moment this runs.
 */
function settingsBlock(config: SpaceConfigWithWeights): string {
  return `  /* Hugging Face injects a static Space's variables here, so everything below can
     be changed in Settings → Variables without touching this file. What was chosen
     when the Space was generated is the fallback. */
  const VARS = (globalThis.huggingface && globalThis.huggingface.variables) || {};

  const settings = {
    title: VARS.TITLE || ${jsString(spaceHeading(config))},
    model: VARS.MODEL_ID || ${jsString(config.modelId)},
    systemPrompt: VARS.SYSTEM_PROMPT ?? ${jsString(config.systemPrompt)},
    greeting: VARS.GREETING ?? ${jsString(config.greeting)},
    accent: VARS.ACCENT || ${jsString(safeAccent(config.accent))},
  };

  /* What the download WEIGHS, in bytes, measured on the Hub the day this Space was
     generated. 0 means nobody measured it, and the page then says nothing about the
     size rather than inventing one.

     The figure belongs to the model baked in above, so it is only believed while that
     is still the model: point MODEL_ID at something else in Settings → Variables and
     the number is dropped, because a confident wrong size on a download button is
     worse than no size at all. Set MODEL_BYTES beside the new MODEL_ID — the total
     bytes of its ONNX weights, sidecars included — to give the page its figure back. */
  const BAKED_MODEL = ${jsString(config.modelId)};
  const BAKED_BYTES = ${downloadBytesOf(config)};${bakedWeightComment(config)}
  const declaredBytes = Number(VARS.MODEL_BYTES);
  const modelBytes = Number.isFinite(declaredBytes) && declaredBytes > 0
    ? declaredBytes
    : settings.model === BAKED_MODEL ? BAKED_BYTES : 0;

  document.title = settings.title;
  document.getElementById('title').textContent = settings.title;
  document.getElementById('welcome').textContent = settings.greeting;

  /* A colour from the settings goes straight into a CSS custom property, so it is
     checked first — core derives most of its palette from this one token. */
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(settings.accent)) {
    document.documentElement.style.setProperty('--aparte-primary', settings.accent);
  }

  if (settings.systemPrompt) aparteGlobalConfig.setSystemPrompt(settings.systemPrompt);
`;
}

/**
 * One copy table, written out as a readable JS object literal.
 *
 * Every value goes through `jsString`, not `JSON.stringify`: these are sentences with
 * apostrophes and dashes in them, and one of them could one day contain a `<`. The file
 * is meant to be read and edited by hand in the Hub's editor, so it is indented rather
 * than minified — this table IS the page's vocabulary, and the first thing anyone
 * translating the Space further will look for.
 *
 * `omit` drops the strings this Space has no use for. There is exactly one today — the
 * badge, on a Space that turned it off — and the rule behind it is the page's own: what
 * is never shown is never shipped.
 */
function copyTable(copy: PageCopy, indent: string, omit: readonly string[] = []): string {
  const entries = Object.entries(copy)
    .filter(([key]) => !omit.includes(key))
    .map(([key, value]) => `${indent}  ${key}: ${jsString(value)},`)
    .join('\n');

  return `{\n${entries}\n${indent}}`;
}

/** `fill()`, in the generated page. The twin of the one in this module. */
const FILL_HELPER = `
  /* A {named} hole, filled. The page never glues sentences out of fragments — word
     order is a property of the language, not of the code that prints it — so every
     string above is whole and the values drop into it. */
  function fill(template, values) {
    return template.replace(/\\{(\\w+)\\}/g, (whole, key) =>
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole);
  }
`;

/**
 * What the page says, and — when it carries both languages — which set it says it in.
 *
 * `en` and `fr` bake ONE table: a Space written in one language pays for one language,
 * and the document stays the size it has always been. `both` bakes two and picks at
 * load time from the VISITOR's own browser, because a Space is public on a worldwide
 * Hub and its author should be allowed not to decide for people they will never meet.
 */
function copyBlock(config: SpaceConfigWithWeights): string {
  const fallback = bakedLang(config);
  /* A Space with the badge turned off has no footer, so the word never appears on it
     and never needs to travel with it. */
  const omit = config.badge ? [] : ['badge'];

  if (!carriesBothLangs(config)) {
    return `
  /* Everything this page says, in the one language it was generated for. */
  const T = ${copyTable(PAGE_COPY[fallback], '  ', omit)};
${FILL_HELPER}`;
  }

  const badgeSync = config.badge
    ? `
  const badgeLabel = document.getElementById('badge-label');
  if (badgeLabel) badgeLabel.textContent = T.badge;`
    : '';

  return `
  /* This Space carries BOTH sets of strings. */
  const COPY = {
    en: ${copyTable(PAGE_COPY.en, '    ', omit)},
    fr: ${copyTable(PAGE_COPY.fr, '    ', omit)},
  };

  /* Which one the visitor gets. The LANG variable pins it — set it to 'en' or 'fr' in
     Settings → Variables and secrets — and otherwise the visitor's own browser decides.
     Only the primary subtag is read, so fr-CA and fr-BE are French; a browser asking
     for neither language falls back to the one this Space was generated in. */
  const FALLBACK_LANG = ${jsString(fallback)};

  function pickLang() {
    const forced = String(VARS.LANG || '').toLowerCase().split('-')[0];
    if (forced === 'en' || forced === 'fr') return forced;
    const tags = navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language];
    for (const tag of tags) {
      const primary = String(tag || '').toLowerCase().split('-')[0];
      if (primary === 'en' || primary === 'fr') return primary;
    }
    return FALLBACK_LANG;
  }

  const LANG = pickLang();
  const T = COPY[LANG];

  /* The markup was written in the fallback language, so the three strings that live
     outside this script are rewritten when the visitor speaks the other one. The
     lang attribute goes with them: it is what a screen reader picks a voice from. */
  document.documentElement.lang = LANG;
  document.getElementById('gate-note').textContent = T.gateNote;
  document.getElementById('progress').setAttribute('aria-label', T.progressLabel);${badgeSync}
${FILL_HELPER}`;
}

/**
 * `system` theme: core deliberately does not read the OS preference — that is a
 * product decision, so the page owns it. Light and dark write the attribute
 * straight into the markup instead, and this block is not emitted at all.
 */
function themeBlock(config: SpaceConfig): string {
  if (config.theme !== 'system') return '';

  return `
  /* Core never reads the OS preference on its own; following the visitor's setting
     is this page's decision to make, and it follows it live. */
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = () => {
    document.documentElement.setAttribute('data-aparte-theme', scheme.matches ? 'dark' : 'light');
  };
  applyTheme();
  scheme.addEventListener('change', applyTheme);
`;
}

/**
 * Locking the composer, and saying why.
 *
 * The composer ships `disabled` in the markup and this is what takes it off, so a
 * visitor cannot type into a chat that has no way to answer while the module loads.
 */
const GATE_HELPERS = `
  const composer = document.querySelector('aparte-composer');
  const gate = document.getElementById('gate');
  const gateText = document.getElementById('gate-text');
  const gateWarning = document.getElementById('gate-warning');
  const gateAction = document.getElementById('gate-action');
  const gateNote = document.getElementById('gate-note');
  const status = document.getElementById('status');

  /* The same rule the configurator used to phrase this number: no decimal above
     10 MB, powers of 1024, and '' — never '0 MB' — for anything unmeasured. Inlined
     rather than imported, because this page has no build step and no dependency it
     does not name in the import map. */
  function humanBytes(bytes) {
    if (!(bytes > 0)) return '';
    const mb = bytes / 1048576;
    if (mb < 1) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    if (mb < 10) return (Math.round(mb * 10) / 10) + ' MB';
    if (mb < 1024) return Math.round(mb) + ' MB';
    return (Math.round(bytes / 107374182.4) / 10) + ' GB';
  }

  /** What the visitor is being asked for, in words — '' when nobody measured it. */
  const weight = humanBytes(modelBytes);

  function lock(message) {
    composer.setAttribute('disabled', '');
    gate.hidden = false;
    gateText.textContent = message;
  }

  function unlock() {
    composer.removeAttribute('disabled');
    gate.hidden = true;
    status.textContent = '';
  }

  function say(message) {
    status.textContent = message;
  }
`;

function browserScript(config: SpaceConfig): string {
  return `
  /* The import map in <head> is load-bearing, not decoration.
     Inference runs off the main thread in a Web Worker, and that worker asks this page
     where Transformers.js lives — it reads the answer from the map. Remove the map and
     the model never loads. */

  registerDefaultRenderers();

  /* A Space can legitimately ship before its model exists — you publish the page
     while the model is still training or converting, then fill the variable in.
     Say what to do about it in the words of the Hub's own settings UI, and never
     offer a button that cannot work. Nothing below this runs without a model:
     registering an empty id would leave the picker pointing at nothing. */
  if (!settings.model) {
    lock(T.noModel);
    gateAction.hidden = true;
  } else {

  gateNote.hidden = false;

  registerModel({
    id: settings.model,
    name: settings.model.split('/').pop() || settings.model,
    task: ${config.vision ? "'image-text-to-text'" : "'text-generation'"},
    capabilities: [${config.vision ? "'streaming', 'vision'" : "'streaming'"}],
    dtype: ${dtypeLiteral(config)},
  });

  aparteGlobalConfig.registerAIProvider(TransformersProvider);
  aparteGlobalConfig.setModelConfig({ defaultProvider: 'transformers', defaultModel: settings.model });
  /* The provider owns its I/O — it runs the model locally — so the direct
     transport simply delegates to it. There is no key and nothing to send. */
  aparteGlobalConfig.setTransport(new AparteDirectTransport({ byok: true }));
  aparteGlobalConfig.setBubbleActions({ retry: true, edit: true });
  new AparteClient().start();

  /* The client owns the ASSISTANT turn only — on the vanilla path the host still has
     to put the visitor's own message in the transcript, or a conversation shows the
     answers with none of the questions. (The framework wrappers do this for you; a
     plain page does not.) */
  const chatEl = document.querySelector('aparte-chat');
  let sent = 0;
  chatEl?.addEventListener('aparte-send', (event) => {
    const text = event.detail?.content;
    if (!text) return;
    chatEl.viewport?.appendMessage({
      id: 'u' + ++sent,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    });
  });

  const progress = document.getElementById('progress');

  /* Weights are hundreds of megabytes, so the download is asked for rather than
     started: one click, once per browser — Transformers.js keeps them in the
     Cache API afterwards. The composer stays locked until the model can answer.

     The size goes ON THE BUTTON, because that is where the decision is made. A
     visitor who clicks "Load the model · 172 MB" has agreed to 172 megabytes; one
     who clicks "Load the model" has agreed to a mystery. When nothing was measured
     the button keeps the plain label — a guess would be worse than the silence. */
  let started = false;
  let weightsCached = false;

  lock(T.runsInBrowser);
  gateAction.textContent = weight ? fill(T.loadModelWeighed, { weight: weight }) : T.loadModel;

  /* Data-saver mode is the visitor telling their browser not to spend megabytes.
     Offering them several hundred without a word is not on — so the line is added
     and the download still waits for the same click. Warn, do not block: they came
     here for the model, and they are the ones who know what their connection costs.
     Below the floor there is nothing to warn about; unmeasured weights get the
     warning too, because "unknown" can be a gigabyte. */
  const SAVE_DATA_FLOOR = 52428800; /* 50 MB */
  function savingData() {
    try {
      return Boolean(navigator.connection && navigator.connection.saveData);
    } catch (error) {
      return false;
    }
  }
  if (savingData() && (!modelBytes || modelBytes >= SAVE_DATA_FLOOR)) {
    gateWarning.textContent = weight
      ? fill(T.saveDataWeighed, { weight: weight })
      : T.saveDataUnknown;
    gateWarning.hidden = false;
  }

  /* A visitor who has been here before already has the weights — Transformers.js
     keeps them in the Cache API — and the provider will say so. Ask it, and reword
     the gate when the answer is yes: a button offering a 172 MB download, followed
     by a progress bar, is a lie told to someone who is three seconds from a chat.

     Asked asynchronously and swallowed on purpose. getModelStatus reads the Cache
     API, which THROWS on an opaque origin — the configurator previews this page in
     a sandbox without allow-same-origin, and that is exactly such an origin. A page
     that cannot ask is simply a page that says nothing new, so the gate keeps the
     wording it already has. It is also optional on the provider interface, hence the
     typeof guard rather than a plain call. */
  (async () => {
    try {
      if (typeof TransformersProvider.getModelStatus !== 'function') return;
      const state = await TransformersProvider.getModelStatus(settings.model);
      if (state !== 'cached' && state !== 'ready') return;
      weightsCached = true;
      /* The click may already have happened while we were asking — in which case the
         gate has moved on and must not be dragged back to its opening line. */
      if (started) return;
      lock(T.alreadyCached);
      gateAction.textContent = T.startModel;
      gateWarning.hidden = true;
      gateNote.hidden = true;
    } catch (error) {
      /* No answer is not a "no". Say nothing, offer the download as usual. */
    }
  })();

  gateAction.addEventListener('click', async () => {
    started = true;
    gateAction.disabled = true;
    gateWarning.hidden = true;
    progress.hidden = false;
    progress.removeAttribute('value');
    say(weightsCached ? T.loadingFromCache : T.preparing);

    try {
      await TransformersProvider.prepareModel(settings.model, (update) => {
        if (update.status === 'downloading' || update.status === 'cached') {
          /* The progress figure is 0–100, and it belongs to ONE FILE — the provider
             passes on what transformers.js reports per file, naming which in
             update.file. So the percentage and the file are shown as they are, and
             the total is named as a total: multiplying one by the other would print
             a "74 MB of 172 MB" that nothing ever measured.

             Four whole sentences rather than a verb glued to a clause and a suffix:
             an unmeasured download has no total to mention, and a language that is
             not English puts the verb, the file and the percentage in another order. */
          const percent = Math.round(update.progress ?? 0);
          progress.value = percent;
          const reading = update.status === 'cached';
          const line = weight
            ? (reading ? T.readingTotal : T.downloadingTotal)
            : (reading ? T.reading : T.downloading);
          say(fill(line, {
            file: update.file || T.someFile,
            percent: String(percent),
            weight: weight,
          }));
        } else if (update.status === 'loading') {
          progress.removeAttribute('value');
          say(T.loadingModel);
        }
      });
      unlock();
    } catch (error) {
      progress.hidden = true;
      gateAction.disabled = false;
      say(fill(T.loadFailed, { error: String((error && error.message) || error) }));
    }
  });

  }
`;
}

// ── The document ───────────────────────────────────────────────────────────

/**
 * The complete, standalone `index.html` of a generated Space.
 *
 * `config.mode` is not branched on: v1 emits the browser/ONNX page for every
 * config. A `providers` or `endpoint` value is a leftover from a config written
 * for a later version, and the right answer to it is the page we can actually
 * ship — not an exception in the middle of a live preview.
 */
export function generateIndexHtml(config: SpaceConfigWithWeights): string {
  const themeAttribute =
    config.theme === 'system' ? '' : ` data-aparte-theme="${escapeHtml(config.theme)}"`;
  const heading = spaceHeading(config);
  /* The language the DOCUMENT is written in — the chosen one, or, on a page that
     carries both, the fallback the script may replace a moment after load. */
  const copy = PAGE_COPY[bakedLang(config)];

  return `<!doctype html>
<html lang="${bakedLang(config)}"${themeAttribute}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(heading)}</title>

<link rel="stylesheet" href="${CORE_CSS}">

<style>
${generateStyleCss(config)}</style>

<!-- Every dependency this Space loads, pinned. aparté packages ship at one version
     across the board, so the number below is the only one to keep in step; a
     different string is a different URL, and a second copy of core would carry a
     provider registry the page never writes to. -->
<script type="importmap">
${importMap(config)}
</script>
</head>

<body>
  <div class="app">
    <header class="app-header">
      <span class="app-emoji" aria-hidden="true">${escapeHtml(config.emoji)}</span>
      <h1 class="app-title" id="title">${escapeHtml(heading)}</h1>
    </header>
${gateMarkup(copy)}
    <aparte-chat center-empty${config.attachments ? ' attachments' : ''}>
      <aparte-chat-viewport></aparte-chat-viewport>
      <div class="welcome" id="welcome">${escapeHtml(config.greeting)}</div>
      <aparte-elicitation></aparte-elicitation>
      <aparte-composer disabled>
${composition(config)}
      </aparte-composer>
    </aparte-chat>
${footerMarkup(config, copy)}  </div>

<script type="module">
  ${IMPORTS_BLOCK}

${settingsBlock(config)}${copyBlock(config)}${localeBlock(config)}${themeBlock(config)}${GATE_HELPERS}${browserScript(config)}</script>
</body>
</html>
`;
}
