/**
 * The one place that knows which language the configurator is speaking.
 *
 * Everything reads `lang.current`; only `setLang` writes it, and it does three things
 * at once so they can never drift apart: the store, aparté's own 88 UI strings, and the
 * document's `lang` attribute (which is what a screen reader and a translation prompt
 * both read).
 */
import { aparteGlobalConfig } from '@aparte/core';
import { detectLang, type Lang } from './lang';

/**
 * Not `$state<Lang>` at module scope but an object, so every importer shares one
 * reference and reads through the same proxy.
 */
export const lang = $state<{ current: Lang }>({ current: 'en' });

/** Extra locale keys of ours, re-applied after every `setLocale` — see below. */
let extraKeys: Record<string, string> = {};

/**
 * Switch the configurator's language.
 *
 * `setLocale()` REPLACES aparté's locale rather than merging into it — documented, and
 * sound: without it you could never remove a key. The consequence for a host is that
 * anything it added with `extendLocale` is dropped by the next `setLocale`, so our own
 * keys are kept here and re-applied on every switch.
 */
export async function setLang(next: Lang): Promise<void> {
  lang.current = next;

  if (typeof document !== 'undefined') document.documentElement.lang = next;

  if (next === 'fr') {
    // Loaded on demand: an English visitor never pays for the French strings.
    const { fr } = await import('@aparte/locale-fr');
    aparteGlobalConfig.setLocale({ ...fr, ...extraKeys });
  } else {
    aparteGlobalConfig.resetLocale();
    if (Object.keys(extraKeys).length > 0) aparteGlobalConfig.extendLocale(extraKeys);
  }
}

/** Register locale keys of our own, kept across language switches. */
export function keepLocaleKeys(keys: Record<string, string>): void {
  extraKeys = { ...extraKeys, ...keys };
}

/**
 * The opening language, before anyone has chosen.
 *
 * The scenario still ASKS — the choice is the first question, and it is asked in English
 * so it is legible to everyone. This only decides which plate is pre-selected, and which
 * language the question itself is already written in for a French visitor.
 */
export function initLang(): Lang {
  const guess = detectLang();
  void setLang(guess);
  return guess;
}
