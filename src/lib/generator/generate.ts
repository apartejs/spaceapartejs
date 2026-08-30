/**
 * The generator: a pure function `SpaceConfig` → files.
 *
 * No DOM, no network, no clock, no randomness — the same config always produces the
 * same bytes. That is what lets the preview render exactly what the user will
 * download, and what lets the tests hold the output to account.
 *
 * The work is split three ways and re-exported here, so callers have one import:
 *   · `index-html.ts` — the standalone document (and the escaping rules)
 *   · `readme.ts`     — the Hub front matter and the prose under it
 *   · `style-css.ts`  — the theme, inlined into the document
 *
 * V1 generates one kind of Space: the model runs in the visitor's browser through
 * Transformers.js. `SpaceConfig.mode` still has three values — the contract is
 * frozen so v1.x can reopen the other two without a migration — but nothing here
 * branches on it and nothing but the browser page is ever emitted.
 *
 * `SpaceConfig.lang` IS branched on, in both files: `en` and `fr` bake one set of
 * strings, `both` bakes two and lets the visitor's own browser choose between them.
 * The parameter is widened to `SpaceConfigWithWeights` so a caller can also pass the
 * measured download size and the language the configurator was speaking — both
 * optional, both additive, neither part of the frozen contract.
 */

import type { GeneratedSpace } from './types';
import { generateIndexHtml, type SpaceConfigWithWeights } from './index-html';
import { generateReadme } from './readme';

export {
  generateIndexHtml,
  escapeHtml,
  jsString,
  spaceHeading,
  bakedLang,
  carriesBothLangs,
  fill,
  PAGE_COPY,
  SPACES_URL,
  type PageCopy,
  type SpaceConfigWithWeights,
} from './index-html';
export { generateReadme, safeEmoji, yamlString, type ReadmeCopy } from './readme';
export { generateStyleCss, safeAccent } from './style-css';

/**
 * Every file of the generated Space.
 *
 * Two files, not three: the theme is inlined into `index.html` rather than shipped
 * as a `style.css` beside it. A Space that is one document survives being saved to
 * disk, pasted into the Hub's editor, or handed to an iframe's `srcdoc` — and the
 * preview does exactly that last one.
 *
 * ── SECURITY INVARIANT on `indexHtml` ──────────────────────────────────────
 * The returned `indexHtml` is untrusted output — it is woven out of strings the
 * user typed — and the preview renders it in an iframe that MUST be sandboxed
 * WITHOUT `allow-same-origin`. Grant that token and the previewed page shares the
 * configurator's origin: it could read `localStorage`, where the user's Hugging
 * Face token lives, and hand it to anyone. `allow-scripts` plus `allow-same-origin`
 * together are equivalent to no sandbox at all.
 *
 * The obligation runs both ways, so it lives here rather than only in the preview
 * component: whatever is generated has to WORK on an opaque origin. At load time
 * the page must therefore touch no same-origin storage — no `localStorage`, no
 * `document.cookie`, no `caches` — because reading any of them on an opaque origin
 * throws a SecurityError and the module would die before it drew anything. That is
 * one more reason v1's browser-only page has no key field and no stored session:
 * everything it needs at load time comes from `window.huggingface.variables` and
 * the CDN. Storage the visitor's model download uses later (the Cache API, inside
 * Transformers.js) is reached from a click handler, already inside a try/catch, and
 * only in the real Space — never on the preview's load path.
 */
export function generateSpace(config: SpaceConfigWithWeights): GeneratedSpace {
  const indexHtml = generateIndexHtml(config);

  return {
    indexHtml,
    files: [
      { path: 'index.html', content: indexHtml },
      { path: 'README.md', content: generateReadme(config) },
    ],
  };
}
