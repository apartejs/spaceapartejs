/**
 * The instrument panel, held to its contract.
 *
 * These are DOM tests without a chat: every control is built by hand, clicked, and
 * asked for its value — which is exactly what the panel does to it. Three things are
 * worth testing and nothing else here is:
 *
 * 1. **A click produces a value.** `getValue()` is the whole contract; a control that
 *    looks right and answers wrong is worse than a radio button.
 * 2. **`notifyChange()` fires.** The panel re-gates the send button on that call and
 *    nothing else, so a control that forgets it can never be submitted. It is invisible
 *    in a browser until the button stays grey — hence a test.
 * 3. **The dispatch takes only what it should.** Returning a control for a field we
 *    cannot render fully (a multi-select, an enum with a free-text escape) silently
 *    deletes an answer the user was offered.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AparteElicitationEnumField,
  AparteElicitationField,
  AparteElicitationStringField,
} from '@aparte/core';

import { LANG_ENDONYM, LANG_SAMPLE } from '../i18n/lang';
import {
  createChoice,
  createColour,
  createEmoji,
  createLanguage,
  createPrompt,
  createSpaceLanguage,
  createTheme,
  createWeights,
  normaliseHex,
  type InstrumentContext,
} from './controls';
import { createInstrument, installInstruments, type InstrumentHost } from './instruments';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function spyContext(): InstrumentContext & { changes: number; commits: number } {
  const ctx = {
    changes: 0,
    commits: 0,
    notifyChange(): void {
      ctx.changes += 1;
    },
    commit(): void {
      ctx.commits += 1;
    },
  };
  return ctx;
}

const stringField = (over: Partial<AparteElicitationStringField> = {}): AparteElicitationStringField => ({
  type: 'string',
  ...over,
});

const enumField = (
  options: AparteElicitationEnumField['options'],
  over: Partial<AparteElicitationEnumField> = {},
): AparteElicitationEnumField => ({ type: 'enum', allowOther: false, options, ...over });

const buttons = (el: HTMLElement): HTMLButtonElement[] =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('[role="radio"]'));

/** Mount in the document — `document.activeElement` and `closest()` need a tree. */
function mount(el: HTMLElement): void {
  document.body.appendChild(el);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

// ─── Colour ──────────────────────────────────────────────────────────────────

describe('createColour', () => {
  it('normalises every hex shape it will be handed', () => {
    expect(normaliseHex('#fff')).toBe('#FFFFFF');
    expect(normaliseHex('ff3e00')).toBe('#FF3E00');
    expect(normaliseHex('#FF3E00')).toBe('#FF3E00');
    expect(normaliseHex('rebeccapurple')).toBe('');
    expect(normaliseHex('')).toBe('');
  });

  it('answers with the swatch that was clicked', () => {
    const ctx = spyContext();
    const control = createColour(stringField({ default: '#FF3E00' }), ctx);
    mount(control.el);

    const swatches = buttons(control.el);
    expect(swatches.length).toBeGreaterThanOrEqual(6);
    expect(swatches[0]?.getAttribute('aria-checked')).toBe('true');

    swatches[3]?.click();

    expect(control.getValue()).toMatch(/^#[0-9A-F]{6}$/);
    expect(swatches[3]?.getAttribute('aria-label')).toContain(control.getValue());
    expect(swatches[3]?.getAttribute('aria-checked')).toBe('true');
    expect(swatches[0]?.getAttribute('aria-checked')).toBe('false');
    expect(ctx.changes).toBe(1);
    expect(ctx.commits).toBe(1);
    expect(control.isComplete()).toBe(true);
  });

  it('opens the whole spectrum through the custom input', () => {
    const ctx = spyContext();
    const control = createColour(stringField({ default: '#ff3e00' }), ctx);
    mount(control.el);

    const picker = control.el.querySelector<HTMLInputElement>('input[type="color"]');
    expect(picker).not.toBeNull();

    picker!.value = '#123456';
    picker!.dispatchEvent(new Event('input'));

    expect(control.getValue()).toBe('#123456'.toUpperCase());
    expect(ctx.changes).toBe(1);
    // A colour nobody offered lights no preset, and never answers on its own.
    expect(buttons(control.el).some((b) => b.getAttribute('aria-checked') === 'true')).toBe(false);
    expect(ctx.commits).toBe(0);
    expect(control.el.querySelector('.instrument__readout')?.textContent).toBe('#123456'.toUpperCase());
  });

  it('shows the current value in the readout from the start', () => {
    const control = createColour(stringField({ default: '#abc' }), spyContext());
    expect(control.getValue()).toBe('#AABBCC');
    expect(control.el.querySelector('.instrument__readout')?.textContent).toBe('#AABBCC');
  });
});

// ─── Emoji ───────────────────────────────────────────────────────────────────

describe('createEmoji', () => {
  it('offers a grid and answers with the one clicked', () => {
    const ctx = spyContext();
    const control = createEmoji(stringField({ default: '🛸' }), ctx);
    mount(control.el);

    const grid = buttons(control.el);
    expect(grid).toHaveLength(24);
    expect(grid[0]?.getAttribute('aria-checked')).toBe('true');
    // Every tap target is named, or a screen reader reads twenty-four blanks.
    expect(grid.every((b) => (b.getAttribute('aria-label') ?? '') !== '')).toBe(true);

    grid[8]?.click();

    expect(control.getValue()).toBe('🤖');
    expect(ctx.changes).toBe(1);
    expect(control.isComplete()).toBe(true);
  });

  it('takes a character that is not in the grid', () => {
    const ctx = spyContext();
    const control = createEmoji(stringField({ default: '🛸' }), ctx);
    mount(control.el);

    const other = control.el.querySelector<HTMLInputElement>('.instrument__other');
    other!.value = '🥐';
    other!.dispatchEvent(new Event('input'));

    expect(control.getValue()).toBe('🥐');
    expect(buttons(control.el).some((b) => b.getAttribute('aria-checked') === 'true')).toBe(false);
    expect(ctx.changes).toBe(1);
  });

  it('is complete when nothing is required and nothing is chosen', () => {
    const control = createEmoji(stringField({ required: false }), spyContext());
    expect(control.getValue()).toBe('');
    expect(control.isComplete()).toBe(true);
  });
});

// ─── Theme ───────────────────────────────────────────────────────────────────

describe('createTheme', () => {
  const field = enumField(
    [
      { value: 'system', label: 'Follow the visitor’s system' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ],
    { title: 'Which theme?', default: 'dark' },
  );

  it('draws one card per option and lights the default', () => {
    const control = createTheme(field, spyContext());
    const cards = buttons(control.el);
    expect(cards).toHaveLength(3);
    expect(control.getValue()).toBe('dark');
    expect(cards[2]?.getAttribute('aria-checked')).toBe('true');
    // The question has to travel with the control: the built-in header is gone.
    expect(control.el.querySelector('.aparte-elic-title')?.textContent).toBe('Which theme?');
  });

  it('shows the theme rather than naming it, and splits for "system"', () => {
    const control = createTheme(field, spyContext());
    const cards = buttons(control.el);
    expect(cards[1]?.querySelector('[data-face="light"]')).not.toBeNull();
    expect(cards[2]?.querySelector('[data-face="dark"]')).not.toBeNull();
    expect(cards[0]?.querySelectorAll('.instrument__face--split [data-face]')).toHaveLength(2);
  });

  it('answers on the click', () => {
    const ctx = spyContext();
    const control = createTheme(field, ctx);
    mount(control.el);

    buttons(control.el)[1]?.click();

    expect(control.getValue()).toBe('light');
    expect(ctx.changes).toBe(1);
  });
});

// ─── Weights ─────────────────────────────────────────────────────────────────

describe('createWeights', () => {
  const field = enumField(
    [
      { value: 'q4', label: 'q4 — smallest', description: 'Shortest download.', recommended: true },
      { value: 'int8', label: 'int8 — quantised', description: 'Close to full quality.' },
      { value: 'fp32', label: 'fp32 — full precision', description: 'Longest download.' },
    ],
    { default: 'q4' },
  );

  it('keeps the smallest-first order and draws a bar per size', () => {
    const control = createWeights(field, spyContext());
    const cards = buttons(control.el);
    expect(cards.map((c) => c.querySelector('.instrument__card-title')?.textContent)).toEqual([
      'q4 — smallest',
      'int8 — quantised',
      'fp32 — full precision',
    ]);

    const widths = Array.from(
      control.el.querySelectorAll<HTMLElement>('.instrument__bar-fill'),
    ).map((fill) => Number.parseInt(fill.style.width, 10));
    expect(widths).toEqual([13, 25, 100]);
  });

  it('marks the recommended one with a lit pip and a word for the reader', () => {
    const control = createWeights(field, spyContext());
    const first = buttons(control.el)[0];
    expect(first?.querySelector('.instrument__pip')).not.toBeNull();
    expect(first?.querySelector('.instrument__sr')?.textContent).toBe('recommended');
  });

  it('answers with the dtype that was clicked', () => {
    const ctx = spyContext();
    const control = createWeights(field, ctx);
    mount(control.el);

    buttons(control.el)[1]?.click();

    expect(control.getValue()).toBe('int8');
    expect(control.isComplete()).toBe(true);
    expect(ctx.changes).toBe(1);
  });
});

// ─── Choice ──────────────────────────────────────────────────────────────────

describe('createChoice', () => {
  const field = enumField([
    { value: 'default', label: 'Build it with the defaults', description: 'A general assistant.', recommended: true },
    { value: 'custom', label: 'Write a system prompt' },
    { value: 'look', label: 'Change the look' },
  ]);

  it('answers on the click, and asks the panel to submit', () => {
    const ctx = spyContext();
    const control = createChoice(field, ctx);
    mount(control.el);

    expect(control.isComplete()).toBe(false);
    buttons(control.el)[2]?.click();

    expect(control.getValue()).toBe('look');
    expect(control.isComplete()).toBe(true);
    expect(ctx.changes).toBe(1);
    expect(ctx.commits).toBe(1);
  });

  it('is one tab stop: arrows move focus, they do not choose', () => {
    const control = createChoice(field, spyContext());
    mount(control.el);

    const cards = buttons(control.el);
    expect(cards[0]?.tabIndex).toBe(0);
    expect(cards[1]?.tabIndex).toBe(-1);

    cards[0]?.focus();
    cards[0]?.parentElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );

    expect(document.activeElement).toBe(cards[1]);
    // Moved, not chosen — a selection here would submit the question under the hand.
    expect(control.getValue()).toBe('');
    expect(cards[1]?.getAttribute('aria-checked')).toBe('false');
  });

  it('is a radiogroup of radios', () => {
    const control = createChoice(field, spyContext());
    expect(control.el.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(buttons(control.el)).toHaveLength(3);
    expect(buttons(control.el).every((b) => b.type === 'button')).toBe(true);
  });
});

// ─── System prompt ───────────────────────────────────────────────────────────

describe('createPrompt', () => {
  it('counts what has been written', () => {
    const ctx = spyContext();
    const control = createPrompt(stringField({ required: false, title: 'What should it be told?' }), ctx);
    mount(control.el);

    const area = control.el.querySelector<HTMLTextAreaElement>('textarea');
    expect(control.el.querySelector('.instrument__count')?.textContent).toBe('0 characters');

    area!.value = 'You are helpful.';
    area!.dispatchEvent(new Event('input'));

    expect(control.getValue()).toBe('You are helpful.');
    expect(control.el.querySelector('.instrument__count')?.textContent).toBe('16 characters');
    expect(ctx.changes).toBe(1);
  });

  it('lets an optional prompt stay empty', () => {
    const control = createPrompt(stringField({ required: false }), spyContext());
    expect(control.isComplete()).toBe(true);
  });

  it('holds a required prompt to something written', () => {
    const control = createPrompt(stringField({ required: true }), spyContext());
    expect(control.isComplete()).toBe(false);
  });
});

// ─── Language ────────────────────────────────────────────────────────────────

/**
 * Run something with the browser claiming to speak these languages.
 *
 * `navigator.languages` is a prototype getter in jsdom, so it is shadowed with an own
 * property and the shadow is removed afterwards — a test that leaks this would decide
 * the outcome of every test written after it.
 */
function withLanguages(tags: readonly string[], run: () => void): void {
  const nav = window.navigator as unknown as { languages?: readonly string[] };
  const own = Object.getOwnPropertyDescriptor(nav, 'languages');
  Object.defineProperty(nav, 'languages', { value: tags, configurable: true });
  try {
    run();
  } finally {
    if (own) Object.defineProperty(nav, 'languages', own);
    else delete nav.languages;
  }
}

/** Regional indicators: the flags this control must never grow. */
const FLAGS = /[\u{1F1E6}-\u{1F1FF}]/u;

const langs = (over: Partial<AparteElicitationEnumField> = {}): AparteElicitationEnumField =>
  enumField([{ value: 'en' }, { value: 'fr' }], over);

describe('createLanguage', () => {
  it('writes each plate in its own language, and tags it to be read in that voice', () => {
    const control = createLanguage(langs({ title: 'Which language should we speak?' }), spyContext());
    const plates = buttons(control.el);
    expect(plates).toHaveLength(2);

    expect(plates[0]?.querySelector('.instrument__endonym')?.textContent).toBe(LANG_ENDONYM.en);
    expect(plates[1]?.querySelector('.instrument__endonym')?.textContent).toBe(LANG_ENDONYM.fr);
    expect(plates[1]?.querySelector('.instrument__sample')?.textContent).toBe(LANG_SAMPLE.fr);

    // Without `lang`, a screen reader says "Français" with an English voice — which is
    // the one thing a plate written in French must not do.
    expect(plates[1]?.querySelector('.instrument__endonym')?.getAttribute('lang')).toBe('fr');
    expect(plates[1]?.querySelector('.instrument__sample')?.getAttribute('lang')).toBe('fr');

    // A flag is a country, not a language.
    expect(FLAGS.test(control.el.textContent ?? '')).toBe(false);
    expect(control.el.querySelector('img')).toBeNull();

    // The question travels with the control: the built-in header is gone.
    expect(control.el.querySelector('.aparte-elic-title')?.textContent).toBe(
      'Which language should we speak?',
    );
  });

  it('lights the browser’s own language before anyone has touched anything', () => {
    withLanguages(['fr-BE', 'en'], () => {
      const control = createLanguage(langs(), spyContext());
      expect(control.getValue()).toBe('fr');
      expect(buttons(control.el)[1]?.getAttribute('aria-checked')).toBe('true');
      expect(control.isComplete()).toBe(true);
    });
  });

  it('falls back to English when the browser speaks neither', () => {
    withLanguages(['de-DE'], () => {
      expect(createLanguage(langs(), spyContext()).getValue()).toBe('en');
    });
  });

  it('lets the scenario’s own default win over the guess', () => {
    withLanguages(['fr-FR'], () => {
      expect(createLanguage(langs({ default: 'en' }), spyContext()).getValue()).toBe('en');
    });
  });

  it('answers on the click', () => {
    const ctx = spyContext();
    const control = createLanguage(langs(), ctx);
    mount(control.el);

    buttons(control.el)[1]?.click();

    expect(control.getValue()).toBe('fr');
    expect(buttons(control.el)[1]?.getAttribute('aria-checked')).toBe('true');
    expect(buttons(control.el)[0]?.getAttribute('aria-checked')).toBe('false');
    expect(ctx.changes).toBe(1);
    expect(ctx.commits).toBe(1);
  });

  it('is one tab stop: arrows move focus, they do not choose', () => {
    withLanguages(['de-DE'], () => {
      const control = createLanguage(langs(), spyContext());
      mount(control.el);

      const plates = buttons(control.el);
      expect(plates[0]?.tabIndex).toBe(0);
      expect(plates[1]?.tabIndex).toBe(-1);

      plates[0]?.focus();
      plates[0]?.parentElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );

      expect(document.activeElement).toBe(plates[1]);
      // Moved, not chosen — this question answers on the click, and a selection made by
      // pressing Right would send it under the hand.
      expect(control.getValue()).toBe('en');
      expect(plates[1]?.getAttribute('aria-checked')).toBe('false');
    });
  });

  it('is a radiogroup of radios, and puts focus on the lit plate', () => {
    withLanguages(['fr-FR'], () => {
      const control = createLanguage(langs(), spyContext());
      mount(control.el);

      expect(control.el.querySelector('[role="radiogroup"]')).not.toBeNull();
      expect(buttons(control.el).every((b) => b.type === 'button')).toBe(true);

      control.focus?.();
      expect(document.activeElement).toBe(buttons(control.el)[1]);
    });
  });
});

// ─── The language of the Space ───────────────────────────────────────────────

describe('createSpaceLanguage', () => {
  const field = (over: Partial<AparteElicitationEnumField> = {}): AparteElicitationEnumField =>
    enumField(
      [
        { value: 'en' },
        { value: 'fr' },
        { value: 'both', description: 'The page follows your visitor.' },
      ],
      over,
    );

  it('adds a third plate that stacks the two samples', () => {
    const control = createSpaceLanguage(field(), spyContext());
    const plates = buttons(control.el);
    expect(plates).toHaveLength(3);

    const both = plates[2];
    expect(both?.className).toContain('instrument__plate--both');

    // Titled in both languages, because it is addressed to both readers.
    const names = Array.from(both?.querySelectorAll('.instrument__endonym') ?? []);
    expect(names.map((n) => n.textContent)).toEqual(['Both', 'Les deux']);
    expect(names.map((n) => n.getAttribute('lang'))).toEqual(['en', 'fr']);

    // And it SHOWS what "both" means rather than saying it.
    const samples = Array.from(both?.querySelectorAll('.instrument__sample') ?? []);
    expect(samples.map((s) => s.textContent)).toEqual([LANG_SAMPLE.en, LANG_SAMPLE.fr]);
    expect(samples.map((s) => s.getAttribute('lang'))).toEqual(['en', 'fr']);
    expect(both?.querySelector('.instrument__plate-note')?.textContent).toBe(
      'The page follows your visitor.',
    );
  });

  it('guesses nothing: the creator’s browser knows nothing about the visitors', () => {
    withLanguages(['fr-FR'], () => {
      const control = createSpaceLanguage(field(), spyContext());
      expect(control.getValue()).toBe('');
      expect(control.isComplete()).toBe(false);
      expect(buttons(control.el).some((b) => b.getAttribute('aria-checked') === 'true')).toBe(false);
    });
  });

  it('answers with both', () => {
    const ctx = spyContext();
    const control = createSpaceLanguage(field(), ctx);
    mount(control.el);

    buttons(control.el)[2]?.click();

    expect(control.getValue()).toBe('both');
    expect(control.isComplete()).toBe(true);
    expect(ctx.changes).toBe(1);
    expect(ctx.commits).toBe(1);
  });

  it('still proposes what the scenario proposes', () => {
    const control = createSpaceLanguage(field({ default: 'both' }), spyContext());
    expect(control.getValue()).toBe('both');
    expect(buttons(control.el)[2]?.getAttribute('aria-checked')).toBe('true');
  });
});

// ─── The dispatch ────────────────────────────────────────────────────────────

describe('createInstrument', () => {
  const host: InstrumentHost = {
    setElicitationFieldRenderer: () => {},
    getElicitationOptions: () => ({ answerOnClick: true }),
  };
  const ctx = (key?: string): { key?: string; notifyChange: () => void } =>
    key === undefined ? { notifyChange: () => {} } : { key, notifyChange: () => {} };

  const build = (field: AparteElicitationField, key?: string) =>
    createInstrument(field, ctx(key), host);

  it('reads the key first: a string is a colour, an emoji or a paragraph', () => {
    expect(build(stringField({ default: '#FF3E00' }), 'accent')?.el.className).toContain(
      'instrument--colour',
    );
    expect(build(stringField(), 'emoji')?.el.className).toContain('instrument--emoji');
    expect(build(stringField({ multiline: true }), 'systemPrompt')?.el.className).toContain(
      'instrument--prompt',
    );
  });

  it('leaves every other line of text to the built-in', () => {
    expect(build(stringField(), 'title')).toBeNull();
    expect(build(stringField(), 'greeting')).toBeNull();
    expect(build(stringField())).toBeNull();
  });

  it('recognises the weights question by its values when there is no key', () => {
    const weights = enumField([{ value: 'q4' }, { value: 'fp16' }, { value: 'fp32' }]);
    expect(build(weights)?.el.className).toContain('instrument--weights');
    expect(build(weights, 'dtype')?.el.className).toContain('instrument--weights');
    // One value that is not a dtype and this is somebody else's question.
    expect(
      build(enumField([{ value: 'q4' }, { value: 'later' }]))?.el.className,
    ).toContain('instrument--choice');
  });

  it('sends the theme to the cards and everything else to the choice fallback', () => {
    expect(
      build(enumField([{ value: 'light' }, { value: 'dark' }]), 'theme')?.el.className,
    ).toContain('instrument--theme');
    expect(
      build(enumField([{ value: 'download' }, { value: 'push' }]))?.el.className,
    ).toContain('instrument--choice');
  });

  it('never takes a field whose escape hatch it cannot draw', () => {
    // "Other…" is the built-in's, and a control that drops it deletes an answer.
    expect(build({ type: 'enum', options: [{ value: 'a' }, { value: 'b' }] })).toBeNull();
    expect(build(enumField([{ value: 'a' }, { value: 'b' }], { multiple: true }))).toBeNull();
    expect(build({ type: 'boolean' })).toBeNull();
  });
});

// ─── Answering on the click ──────────────────────────────────────────────────

describe('answering on the click', () => {
  /**
   * A stand-in for the composer the panel mounts our control into.
   *
   * Left out of the document on purpose: `<aparte-composer>` is a real custom element
   * here (the browser entry defines it), and connecting one would run its whole
   * lifecycle for the sake of one method. `closest()` walks a detached tree just as
   * well, which is all the control asks of it.
   */
  function composer(): { el: HTMLElement; submit: ReturnType<typeof vi.fn> } {
    const el = document.createElement('aparte-composer');
    const submit = vi.fn();
    Object.assign(el, { submit });
    return { el, submit };
  }

  const host = (answerOnClick: boolean): InstrumentHost => ({
    setElicitationFieldRenderer: () => {},
    getElicitationOptions: () => ({ answerOnClick }),
  });

  const single = enumField([{ value: 'download' }, { value: 'push' }]);

  it('submits the panel when the question is asked on its own', () => {
    const { el, submit } = composer();
    const control = createInstrument(single, { notifyChange: () => {} }, host(true));
    el.appendChild(control!.el);

    buttons(control!.el)[0]?.click();

    expect(control!.getValue()).toBe('download');
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('never submits from inside a form: the other questions are unanswered', () => {
    const { el, submit } = composer();
    const control = createInstrument(
      enumField([{ value: 'light' }, { value: 'dark' }], { default: 'dark' }),
      { key: 'theme', notifyChange: () => {} },
      host(true),
    );
    el.appendChild(control!.el);

    buttons(control!.el)[0]?.click();

    expect(control!.getValue()).toBe('light');
    expect(submit).not.toHaveBeenCalled();
  });

  it('respects a host that turned answer-on-click off', () => {
    const { el, submit } = composer();
    const control = createInstrument(single, { notifyChange: () => {} }, host(false));
    el.appendChild(control!.el);

    buttons(control!.el)[0]?.click();

    expect(submit).not.toHaveBeenCalled();
  });

  it('leaves a question with a default to the send button, as the built-in does', () => {
    const { el, submit } = composer();
    const control = createInstrument(
      enumField([{ value: 'q4' }, { value: 'fp32' }], { default: 'q4' }),
      { notifyChange: () => {} },
      host(true),
    );
    el.appendChild(control!.el);

    buttons(control!.el)[1]?.click();

    expect(control!.getValue()).toBe('fp32');
    expect(submit).not.toHaveBeenCalled();
  });

  it('works with no composer above it', () => {
    const control = createInstrument(single, { notifyChange: () => {} }, host(true));
    mount(control!.el);
    expect(() => buttons(control!.el)[0]?.click()).not.toThrow();
    expect(control!.getValue()).toBe('download');
  });
});

// ─── Installation ────────────────────────────────────────────────────────────

describe('installInstruments', () => {
  it('registers one renderer, however many times it is called', () => {
    const setElicitationFieldRenderer = vi.fn();
    const host: InstrumentHost = {
      setElicitationFieldRenderer,
      getElicitationOptions: () => ({ answerOnClick: true }),
    };

    installInstruments(host);
    installInstruments(host);
    installInstruments(host);

    expect(setElicitationFieldRenderer).toHaveBeenCalledTimes(1);
  });

  it('registers a renderer that dispatches like the dispatcher', () => {
    const registered: Array<Parameters<InstrumentHost['setElicitationFieldRenderer']>[0]> = [];
    installInstruments({
      setElicitationFieldRenderer: (fn) => registered.push(fn),
      getElicitationOptions: () => ({ answerOnClick: true }),
    });

    const renderer = registered[0];
    expect(renderer).not.toBeNull();
    const built = renderer?.(stringField({ default: '#FF3E00' }), {
      key: 'accent',
      notifyChange: () => {},
    });
    expect(built?.el.className).toContain('instrument--colour');
  });
});
