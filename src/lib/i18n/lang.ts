/**
 * Two languages, and two separate decisions.
 *
 * The language the CONFIGURATOR speaks (this file) is not the language the generated
 * SPACE speaks. A French developer may well want an English demo for a worldwide
 * audience, and the reverse is just as true — so the scenario asks twice, and the two
 * answers live in different places: this one in the app, the other in `SpaceConfig`.
 *
 * This module holds no state and touches no DOM: it is the vocabulary both halves share.
 */

export type Lang = 'en' | 'fr';

export const LANGS: readonly Lang[] = ['en', 'fr'];

/**
 * What the generated Space is written in.
 *
 * `both` is not a language but a policy: the page carries both sets of strings and picks
 * by the VISITOR's own `navigator.language`, falling back to the creator's choice. A
 * Space is public on a worldwide Hub, and its author should be allowed not to decide for
 * people they will never meet.
 */
export type SpaceLang = Lang | 'both';

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'fr';
}

/**
 * The name of a language, written IN that language — never a flag.
 *
 * A flag is a country, not a language: French is not France, and English is not the
 * United Kingdom. The endonym is what every well-made language picker uses, and it has
 * the property that matters here — you can read your own language's name even when the
 * interface is in one you do not speak.
 */
export const LANG_ENDONYM: Record<Lang, string> = {
  en: 'English',
  fr: 'Français',
};

/**
 * One sentence per language, written in it.
 *
 * The language selector shows these under the name, so the control DEMONSTRATES the
 * language instead of labelling it: you do not read "French", you see what the
 * conversation will sound like. Keep them short, and keep them in the product's voice —
 * they are a sample of the thing being chosen.
 */
export const LANG_SAMPLE: Record<Lang, string> = {
  en: "Let's build your Space.",
  fr: 'Construisons votre Space.',
};

/**
 * The visitor's language, when we can tell.
 *
 * Only the primary subtag is read: `fr-CA`, `fr-BE` and `fr` are one language here.
 * Anything else is English, which is the Hub's own default and the one this product was
 * written in first.
 */
export function detectLang(navigatorLanguages?: readonly string[]): Lang {
  const candidates =
    navigatorLanguages ??
    (typeof navigator === 'undefined'
      ? []
      : (navigator.languages ?? [navigator.language]).filter(Boolean));

  for (const tag of candidates) {
    const primary = String(tag).toLowerCase().split('-')[0];
    if (isLang(primary)) return primary;
  }
  return 'en';
}
