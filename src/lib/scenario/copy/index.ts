/**
 * One `copy`, two languages, and the seam between them.
 *
 * English is the source and the type: `en.ts` is a plain object, `ScenarioCopy` is
 * `typeof en`, and `fr.ts` is declared as one. A string added to English and forgotten
 * in French is a compile error — which is the entire reason the two files are shaped
 * this way rather than as a `Record<string, string>` a missing key could slip through.
 *
 * Two ways to reach the words:
 *
 * - `copyFor(lang)` when you already know the language — the scenario tree is built
 *   once per language at module load, so its branches are plain strings the provider
 *   can stream.
 * - `copy` when you do not: a live view that reads `lang.current` on every access.
 *   Tool handlers use it (they run long after the tools were registered, and after the
 *   language question has been answered), and so does the Svelte host — reading a
 *   `$state` through these getters is a tracked read, so a language switch repaints the
 *   empty state and the placeholder without anyone subscribing to anything.
 *
 * The getters are the whole trick, and they are why `copy` must never be destructured
 * at module scope: `const script = copy.script` freezes the language of whoever imported
 * first.
 */

import { modelName } from '../../config/space-config';
import type { Lang } from '../../i18n/lang';
import { lang } from '../../i18n/store.svelte';
import { en, type ScenarioCopy } from './en';
import { fr } from './fr';

export type { ScenarioCopy, OnnxSizes } from './en';

/** Every language the configurator speaks, by code. */
const BY_LANG: Record<Lang, ScenarioCopy> = { en, fr };

/** The words of one language. */
export function copyFor(code: Lang): ScenarioCopy {
  return BY_LANG[code];
}

/**
 * The words of the language being spoken RIGHT NOW.
 *
 * One getter per top-level section rather than a Proxy: the type stays exactly
 * `ScenarioCopy`, so a typo is caught here as it would be in either file.
 */
export const copy: ScenarioCopy = {
  get entry() {
    return copyFor(lang.current).entry;
  },
  get script() {
    return copyFor(lang.current).script;
  },
  get ask() {
    return copyFor(lang.current).ask;
  },
  get result() {
    return copyFor(lang.current).result;
  },
  get tools() {
    return copyFor(lang.current).tools;
  },
  get rows() {
    return copyFor(lang.current).rows;
  },
};

/** Why `ask_model` is being asked — which of its four openings it uses. */
export type AskModelReason = keyof ScenarioCopy['ask']['model']['message'];

/**
 * The Space title we suggest for a model, before anyone edits it.
 *
 * Not translated, and not by omission: a Space title is a proper name on a worldwide
 * Hub, it is the same string whichever language the configurator was speaking, and it
 * is the value `titlePatch` compares against to tell "ours" from "theirs".
 */
export function suggestedTitle(modelId: string): string {
  return modelId ? `${modelName(modelId)} chat` : 'Aparté chat';
}
