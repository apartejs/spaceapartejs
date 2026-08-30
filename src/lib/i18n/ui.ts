/**
 * The chrome's dictionary, and the one function that picks a language.
 *
 * Deliberately rune-free and store-free. This module is a pure lookup: it takes a `Lang`
 * and returns the strings for it, which means it can be imported anywhere — a test, the
 * generator, a plain `.ts` helper — without dragging Svelte's reactivity in with it.
 *
 * The REACTIVITY lives in the component, one line, and it is visible there rather than
 * hidden behind a getter:
 *
 *     import { lang } from '../lib/i18n/store.svelte';
 *     import { uiCopy } from '../lib/i18n/ui';
 *
 *     const t = $derived(uiCopy(lang.current));
 *
 * `lang` is a `$state` proxy, so reading `lang.current` while the `$derived` is being
 * evaluated subscribes that component to it: `setLang('fr')` re-runs the derived, the
 * template re-renders, and every string on screen changes at once. Nothing needs to be
 * pushed and nothing needs to be re-mounted.
 */

import { en, type UiCopy } from './en';
import { fr } from './fr';
import type { Lang } from './lang';

/**
 * Every language, keyed. `Record<Lang, UiCopy>` and not a lookup with a fallback: adding a
 * third `Lang` has to break here, at the one place a new dictionary would be plugged in.
 */
const DICTIONARIES: Record<Lang, UiCopy> = { en, fr };

/** The strings for a language. Total by construction — there is no missing case. */
export function uiCopy(current: Lang): UiCopy {
  return DICTIONARIES[current];
}

export type { UiCopy };
