/**
 * The instrument panel — the controls themselves.
 *
 * When the script asks something, the composer does not show a list of radio buttons:
 * it shows the INSTRUMENT for that question. A colour is a row of lit swatches, an
 * emoji is a grid, a theme is three little pictures of the page it makes, a set of
 * weights is a bar you can compare at a glance.
 *
 * Four rules hold every control here to the same shape.
 *
 * 1. **Plain DOM.** These are mounted by aparté into its composer, not by Svelte.
 *    `document.createElement`, no framework, no reactivity — the control owns its own
 *    state and hands it back through `getValue()`.
 * 2. **`notifyChange()` on every change.** The panel re-reads `isComplete()` on that
 *    call and nothing else; a control that forgets it is a control whose answer can
 *    never be submitted.
 * 3. **One decision, one gesture.** A question asked on its own commits on the click,
 *    through the `commit` hook the caller passes (see `instruments.ts`). A question
 *    inside a form never does: its siblings have not been answered yet.
 * 4. **Keyboard and semantics first.** Every group is a real `radiogroup` of real
 *    `<button>`s with a roving tabindex; arrows move, click or Enter/Space selects.
 *    Arrows deliberately do NOT select: in a question that answers on the click, a
 *    selection made by pressing Down would submit the form under the user's fingers.
 *
 * Styles live in `src/styles/instruments.css`, scoped under `.instrument`.
 */

import type {
  AparteElicitationEnumField,
  AparteElicitationFieldControl,
  AparteElicitationStringField,
} from '@aparte/core';

import { LANG_ENDONYM, LANG_SAMPLE, LANGS, detectLang, isLang, type Lang } from '../i18n/lang';

// ─── The context a control is built with ─────────────────────────────────────

/**
 * What a control needs from the panel around it.
 *
 * A narrower thing than `AparteElicitationFieldContext` on purpose: `key` has already
 * been read by the dispatcher (it is what chose this control), and `commit` is the
 * caller's decision, not the field's.
 */
export interface InstrumentContext {
  /** Re-gate the send button. Called on every value change, without exception. */
  notifyChange(): void;
  /**
   * Answer the question with this click. Present only when the question is asked on
   * its own and the host's `answerOnClick` policy is on.
   */
  commit?(): void;
}

// ─── Small DOM helpers ───────────────────────────────────────────────────────

let seq = 0;
const uid = (prefix: string): string => `instrument-${prefix}-${++seq}`;

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * The root of every control.
 *
 * It carries `aparte-elic-field` as well as our own classes so it keeps the panel's
 * own vertical rhythm — the panel hides fields with `hidden` when it steps through a
 * form, which is why the stylesheet never gives `.instrument` an unconditional
 * `display`.
 */
function root(kind: string): HTMLDivElement {
  return make('div', `aparte-elic-field instrument instrument--${kind}`);
}

/**
 * The question above the control, in the panel's own classes.
 *
 * Replacing a field means replacing its header too: the built-in draws it, and a
 * custom control that forgets leaves a form step with no question on it. Returns the
 * title's id so a group can point `aria-labelledby` at it.
 */
function header(parent: HTMLElement, field: { title?: string; description?: string }): string | undefined {
  let titleId: string | undefined;
  if (field.title) {
    const title = make('p', 'aparte-elic-title instrument__question', field.title);
    titleId = uid('title');
    title.id = titleId;
    parent.appendChild(title);
  }
  if (field.description) {
    parent.appendChild(make('p', 'aparte-elic-desc instrument__hint', field.description));
  }
  return titleId;
}

function radioButton(className: string): HTMLButtonElement {
  const button = make('button', className);
  button.type = 'button';
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-checked', 'false');
  button.tabIndex = -1;
  return button;
}

interface GroupEntry {
  value: string;
  el: HTMLButtonElement;
}

interface Group {
  /** Light one option (or none), without answering. */
  select(value: string | null): void;
  /** Put focus on the lit option, or the first one. */
  focus(): void;
}

/**
 * Turn a list of buttons into one keyboard-operable radio group.
 *
 * Roving tabindex: the group is ONE tab stop and the arrows move inside it, which is
 * the only shape that stays usable when a control holds twenty-four options.
 */
function wireGroup(
  list: HTMLElement,
  entries: readonly GroupEntry[],
  onPick: (value: string) => void,
  labelledBy?: string,
  label?: string,
): Group {
  list.setAttribute('role', 'radiogroup');
  if (labelledBy) list.setAttribute('aria-labelledby', labelledBy);
  else if (label) list.setAttribute('aria-label', label);

  let current: string | null = null;

  const paint = (): void => {
    for (const entry of entries) {
      const on = entry.value === current;
      entry.el.setAttribute('aria-checked', String(on));
      entry.el.classList.toggle('is-lit', on);
      entry.el.tabIndex = on ? 0 : -1;
    }
    if (current === null) {
      const first = entries[0];
      if (first) first.el.tabIndex = 0;
    }
  };

  for (const entry of entries) {
    entry.el.addEventListener('click', () => {
      current = entry.value;
      paint();
      onPick(entry.value);
    });
  }

  const MOVES = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
  list.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!MOVES.includes(event.key)) return;
    const from = entries.findIndex((entry) => entry.el === document.activeElement);
    if (from < 0) return;
    event.preventDefault();
    const last = entries.length - 1;
    const to =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? from === last
              ? 0
              : from + 1
            : from === 0
              ? last
              : from - 1;
    const target = entries[to];
    if (!target) return;
    for (const entry of entries) entry.el.tabIndex = -1;
    target.el.tabIndex = 0;
    target.el.focus();
  });

  paint();

  return {
    select: (value) => {
      current = entries.some((entry) => entry.value === value) ? value : null;
      paint();
    },
    focus: () => {
      const lit = entries.find((entry) => entry.value === current) ?? entries[0];
      lit?.el.focus();
    },
  };
}

/** Text only a screen reader needs — a recommendation, the name of a swatch. */
function srOnly(text: string): HTMLSpanElement {
  return make('span', 'instrument__sr', text);
}

/** The lit diode that marks the recommended option. */
function pip(): HTMLSpanElement {
  const dot = make('span', 'instrument__pip');
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

// ─── 1. Colour ───────────────────────────────────────────────────────────────

/**
 * The presets: aparté's own orange first, then a handful that hold up on a dark hull.
 *
 * Every one of them passes AA against both a white and a near-black page background,
 * because the value chosen here becomes the accent of a generated Space whose theme
 * we do not control.
 */
const ACCENT_PRESETS: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: '#FF3E00', name: 'Thruster orange' },
  { hex: '#D9A24B', name: 'Brass' },
  { hex: '#E4572E', name: 'Ember' },
  { hex: '#E0578F', name: 'Flare pink' },
  { hex: '#A78BFA', name: 'Nebula violet' },
  { hex: '#3B82F6', name: 'Ion blue' },
  { hex: '#0EA5A5', name: 'Coolant teal' },
  { hex: '#3F9E4D', name: 'Signal green' },
];

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#abc` and `abcdef` both become `#AABBCC`; anything else becomes ''. */
export function normaliseHex(value: string): string {
  const match = HEX.exec(value.trim());
  if (!match) return '';
  const digits = match[1] ?? '';
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((d) => d + d)
          .join('')
      : digits;
  return `#${full.toUpperCase()}`;
}

/**
 * A row of swatches that light when picked, and a native colour input as the last one.
 *
 * The presets are the fast path; the input is the escape hatch, so no colour is out of
 * reach. The hex is shown in the mono face because it is a literal value — the same
 * rule the model ids and the file names follow.
 */
export function createColour(
  field: AparteElicitationStringField,
  ctx: InstrumentContext,
): AparteElicitationFieldControl {
  const el = root('colour');
  const titleId = header(el, field);

  let value = normaliseHex(field.default ?? '') || ACCENT_PRESETS[0]!.hex;

  const row = make('div', 'instrument__swatches');
  const entries: GroupEntry[] = ACCENT_PRESETS.map(({ hex, name }) => {
    const button = radioButton('instrument__swatch');
    button.style.setProperty('--swatch', hex);
    button.setAttribute('aria-label', `${name} ${hex}`);
    button.title = `${name} · ${hex}`;
    return { value: hex, el: button };
  });
  for (const entry of entries) row.appendChild(entry.el);

  const readout = make('span', 'instrument__readout', value);
  readout.setAttribute('aria-live', 'polite');

  const custom = make('label', 'instrument__custom');
  const input = make('input', 'instrument__picker');
  input.type = 'color';
  input.value = value.toLowerCase();
  custom.append(input, make('span', 'instrument__custom-label', 'Custom'));

  const group = wireGroup(
    row,
    entries,
    (picked) => {
      value = picked;
      input.value = picked.toLowerCase();
      readout.textContent = picked;
      custom.classList.remove('is-lit');
      ctx.notifyChange();
      ctx.commit?.();
    },
    titleId,
    field.title ?? 'Accent colour',
  );

  input.addEventListener('input', () => {
    const picked = normaliseHex(input.value);
    if (!picked) return;
    value = picked;
    readout.textContent = picked;
    const preset = entries.some((entry) => entry.value === picked);
    group.select(preset ? picked : null);
    custom.classList.toggle('is-lit', !preset);
    ctx.notifyChange();
  });

  group.select(value);

  const bar = make('div', 'instrument__row');
  bar.append(custom, readout);
  el.append(row, bar);

  return {
    el,
    getValue: () => value,
    isComplete: () => value !== '',
    focus: () => group.focus(),
  };
}

// ─── 2. Emoji ────────────────────────────────────────────────────────────────

/** Twenty-four that suit a model demo: the sky, the machines, a few characters. */
const EMOJI: ReadonlyArray<{ char: string; name: string }> = [
  { char: '🛸', name: 'flying saucer' },
  { char: '🚀', name: 'rocket' },
  { char: '🛰️', name: 'satellite' },
  { char: '🪐', name: 'ringed planet' },
  { char: '🌌', name: 'milky way' },
  { char: '☄️', name: 'comet' },
  { char: '⭐', name: 'star' },
  { char: '🔭', name: 'telescope' },
  { char: '🤖', name: 'robot' },
  { char: '👾', name: 'alien monster' },
  { char: '🧠', name: 'brain' },
  { char: '⚡', name: 'lightning' },
  { char: '✨', name: 'sparkles' },
  { char: '🔮', name: 'crystal ball' },
  { char: '🪄', name: 'magic wand' },
  { char: '📡', name: 'satellite dish' },
  { char: '🦉', name: 'owl' },
  { char: '🐙', name: 'octopus' },
  { char: '🦊', name: 'fox' },
  { char: '🐝', name: 'bee' },
  { char: '🐳', name: 'whale' },
  { char: '🦜', name: 'parrot' },
  { char: '💬', name: 'speech balloon' },
  { char: '📚', name: 'books' },
];

/**
 * A grid of big tap targets, and a field for the one you had in mind instead.
 *
 * The Space card carries exactly one character, so this is a single choice — but a
 * palette can never be complete, hence the input beside it. Typing there un-lights
 * the grid unless what you typed is already in it.
 */
export function createEmoji(
  field: AparteElicitationStringField,
  ctx: InstrumentContext,
): AparteElicitationFieldControl {
  const el = root('emoji');
  const titleId = header(el, field);

  let value = (field.default ?? '').trim();

  const grid = make('div', 'instrument__grid');
  const entries: GroupEntry[] = EMOJI.map(({ char, name }) => {
    const button = radioButton('instrument__emoji');
    button.setAttribute('aria-label', name);
    button.title = name;
    const glyph = make('span', 'instrument__glyph', char);
    glyph.setAttribute('aria-hidden', 'true');
    button.appendChild(glyph);
    return { value: char, el: button };
  });
  for (const entry of entries) grid.appendChild(entry.el);

  const other = make('input', 'instrument__other');
  other.type = 'text';
  // Long enough for a ZWJ sequence — 👩‍🚀 is five UTF-16 units, not one.
  other.maxLength = 8;
  other.placeholder = '🎈';
  other.setAttribute('aria-label', 'Any other character');
  const otherLabel = make('label', 'instrument__row');
  otherLabel.append(other, make('span', 'instrument__custom-label', 'or type one'));

  const group = wireGroup(
    grid,
    entries,
    (picked) => {
      value = picked;
      other.value = '';
      ctx.notifyChange();
      ctx.commit?.();
    },
    titleId,
    field.title ?? 'Emoji',
  );

  other.addEventListener('input', () => {
    const typed = other.value.trim();
    value = typed;
    group.select(entries.some((entry) => entry.value === typed) ? typed : null);
    ctx.notifyChange();
  });

  if (value && !entries.some((entry) => entry.value === value)) other.value = value;
  group.select(value);

  el.append(grid, otherLabel);

  const required = field.required ?? true;
  return {
    el,
    getValue: () => value,
    isComplete: () => (required ? value !== '' : true),
    focus: () => group.focus(),
  };
}

// ─── 3. Theme ────────────────────────────────────────────────────────────────

/** A tiny drawing of the page the theme makes: a header, two bubbles, a composer. */
function themeFace(variant: 'light' | 'dark'): HTMLSpanElement {
  const face = make('span', 'instrument__face');
  face.dataset['face'] = variant;
  face.setAttribute('aria-hidden', 'true');
  face.append(
    make('span', 'instrument__face-bar'),
    make('span', 'instrument__face-bubble'),
    make('span', 'instrument__face-bubble instrument__face-bubble--mine'),
    make('span', 'instrument__face-composer'),
  );
  return face;
}

/** `system` is the two of them, split on the diagonal. */
function themeMock(value: string): HTMLSpanElement {
  if (value === 'light' || value === 'dark') return themeFace(value);
  const split = make('span', 'instrument__face instrument__face--split');
  split.setAttribute('aria-hidden', 'true');
  const light = themeFace('light');
  const dark = themeFace('dark');
  dark.classList.add('instrument__face--clipped');
  split.append(light, dark);
  return split;
}

/**
 * Three cards that SHOW the theme instead of naming it.
 *
 * The word "dark" is a label; a picture of a dark page is the thing itself. The label
 * stays under it — the drawing narrows the choice, the word confirms it.
 */
export function createTheme(
  field: AparteElicitationEnumField,
  ctx: InstrumentContext,
): AparteElicitationFieldControl {
  const el = root('theme');
  const titleId = header(el, field);

  let value = typeof field.default === 'string' ? field.default : '';

  const row = make('div', 'instrument__themes');
  const entries: GroupEntry[] = field.options.map((option) => {
    const button = radioButton('instrument__theme');
    button.appendChild(themeMock(option.value));
    button.appendChild(make('span', 'instrument__label', option.label ?? option.value));
    if (option.recommended) {
      button.appendChild(pip());
      button.appendChild(srOnly('recommended'));
    }
    if (option.description) button.title = option.description;
    return { value: option.value, el: button };
  });
  for (const entry of entries) row.appendChild(entry.el);

  const group = wireGroup(
    row,
    entries,
    (picked) => {
      value = picked;
      ctx.notifyChange();
      ctx.commit?.();
    },
    titleId,
    field.title ?? 'Theme',
  );
  group.select(value);

  el.appendChild(row);

  return {
    el,
    getValue: () => value,
    isComplete: () => value !== '',
    focus: () => group.focus(),
  };
}

// ─── 4. Weights ──────────────────────────────────────────────────────────────

/** Bits per weight, which is what the download actually costs. */
const DTYPE_BITS: Readonly<Record<string, number>> = {
  q4: 4,
  q4f16: 4.5,
  bnb4: 4.5,
  int4: 4,
  int8: 8,
  uint8: 8,
  q8: 8,
  fp16: 16,
  bf16: 16,
  fp32: 32,
};

/** What the bar is measuring, said in the mono face beside it. */
const DTYPE_CAPTION: Readonly<Record<string, string>> = {
  q4: '4-bit',
  q4f16: '4-bit · fp16 maths',
  bnb4: '4-bit',
  int4: '4-bit',
  int8: '8-bit',
  uint8: '8-bit',
  q8: '8-bit',
  fp16: '16-bit',
  bf16: '16-bit',
  fp32: '32-bit',
};

/**
 * The weights, as a set of bars you can compare without reading a word.
 *
 * The question this answers is "how long will my visitors wait", and the answer is a
 * length. The options arrive smallest-first from the scan, so the bars grow down the
 * list and the shape of the choice is visible before any of the labels are read.
 */
export function createWeights(
  field: AparteElicitationEnumField,
  ctx: InstrumentContext,
): AparteElicitationFieldControl {
  const el = root('weights');
  const titleId = header(el, field);

  let value = typeof field.default === 'string' ? field.default : '';

  const bits = field.options.map((option) => DTYPE_BITS[option.value] ?? 32);
  const widest = Math.max(...bits, 1);

  const list = make('div', 'instrument__cards');
  const entries: GroupEntry[] = field.options.map((option, index) => {
    const button = radioButton('instrument__card instrument__card--weights');

    const top = make('span', 'instrument__card-head');
    top.appendChild(make('span', 'instrument__card-title', option.label ?? option.value));
    const caption = DTYPE_CAPTION[option.value];
    if (caption) top.appendChild(make('span', 'instrument__data', caption));
    button.appendChild(top);

    const track = make('span', 'instrument__bar');
    track.setAttribute('aria-hidden', 'true');
    const fill = make('span', 'instrument__bar-fill');
    const share = Math.max(6, Math.round(((bits[index] ?? 32) / widest) * 100));
    fill.style.width = `${share}%`;
    track.appendChild(fill);
    button.appendChild(track);

    if (option.description) {
      button.appendChild(make('span', 'instrument__card-desc', option.description));
    }
    if (option.recommended) {
      button.appendChild(pip());
      button.appendChild(srOnly('recommended'));
    }
    return { value: option.value, el: button };
  });
  for (const entry of entries) list.appendChild(entry.el);

  const group = wireGroup(
    list,
    entries,
    (picked) => {
      value = picked;
      ctx.notifyChange();
      ctx.commit?.();
    },
    titleId,
    field.title ?? 'Weights',
  );
  group.select(value);

  el.appendChild(list);

  return {
    el,
    getValue: () => value,
    isComplete: () => value !== '',
    focus: () => group.focus(),
  };
}

// ─── 5. Choice ───────────────────────────────────────────────────────────────

/**
 * The fallback for every other single choice: stacked cards, not radios.
 *
 * A title, the description the script wrote under it, a lit edge when it is chosen and
 * a diode on the one we recommend. It answers on the click wherever the panel allows
 * it, because a one-decision question that needs a second gesture is a form.
 */
export function createChoice(
  field: AparteElicitationEnumField,
  ctx: InstrumentContext,
): AparteElicitationFieldControl {
  const el = root('choice');
  const titleId = header(el, field);

  let value = typeof field.default === 'string' ? field.default : '';

  const list = make('div', 'instrument__cards');
  const entries: GroupEntry[] = field.options.map((option) => {
    const button = radioButton('instrument__card');
    button.appendChild(make('span', 'instrument__card-title', option.label ?? option.value));
    if (option.description) {
      button.appendChild(make('span', 'instrument__card-desc', option.description));
    }
    if (option.recommended) {
      button.appendChild(pip());
      button.appendChild(srOnly('recommended'));
    }
    return { value: option.value, el: button };
  });
  for (const entry of entries) list.appendChild(entry.el);

  const group = wireGroup(
    list,
    entries,
    (picked) => {
      value = picked;
      ctx.notifyChange();
      ctx.commit?.();
    },
    titleId,
    field.title ?? 'Choose one',
  );
  group.select(value);

  el.appendChild(list);

  return {
    el,
    getValue: () => value,
    isComplete: () => value !== '',
    focus: () => group.focus(),
  };
}

// ─── 6. System prompt ────────────────────────────────────────────────────────

/**
 * The one string field worth taking over: a textarea with a character count.
 *
 * Everything else a person types here — a title, a repo name, a greeting — is a line,
 * and the built-in input is already the right instrument for a line. A system prompt
 * is a paragraph somebody writes and rewrites, so it gets room and a count.
 */
export function createPrompt(
  field: AparteElicitationStringField,
  ctx: InstrumentContext,
): AparteElicitationFieldControl {
  const el = root('prompt');
  const titleId = header(el, field);

  // Styled here rather than borrowed from `.aparte-field`, so which stylesheet loads
  // first cannot decide what this looks like.
  const area = make('textarea', 'instrument__area');
  area.rows = 4;
  if (field.placeholder) area.placeholder = field.placeholder;
  if (field.maxLength != null) area.maxLength = field.maxLength;
  area.value = field.default ?? '';
  if (titleId) area.setAttribute('aria-labelledby', titleId);
  else area.setAttribute('aria-label', 'System prompt');

  const countId = uid('count');
  const count = make('span', 'instrument__count instrument__data');
  count.id = countId;
  area.setAttribute('aria-describedby', countId);

  const paint = (): void => {
    const n = area.value.length;
    count.textContent = field.maxLength != null ? `${n} / ${field.maxLength}` : `${n} characters`;
  };
  paint();

  area.addEventListener('input', () => {
    paint();
    ctx.notifyChange();
  });

  const foot = make('div', 'instrument__row instrument__row--end');
  foot.appendChild(count);
  el.append(area, foot);

  const required = field.required ?? true;
  const minLength = field.minLength ?? 1;
  return {
    el,
    getValue: () => area.value,
    isComplete: () => {
      const trimmed = area.value.trim();
      if (!required && trimmed === '') return true;
      return trimmed.length >= minLength;
    },
    focus: () => area.focus(),
  };
}

// ─── 7. Language ─────────────────────────────────────────────────────────────

/**
 * The plates.
 *
 * A language picker that writes its options in the language you are already reading is
 * asking you to translate before you can answer. So each plate is written IN ITS OWN
 * LANGUAGE, and carries a sentence of the conversation it will produce: the name says
 * which one, the sample shows what it will sound like. You do not read "French", you
 * see it.
 *
 * No flags, ever. A flag is a country — French is not France, and English is not the
 * United Kingdom.
 */

/** The diode on a plate: dark glass until this plate is the answer. */
function diode(): HTMLSpanElement {
  const dot = make('span', 'instrument__diode');
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

/**
 * The name of a language in the display face, in that language.
 *
 * `lang` is set on every one of them, and it is not decoration: on a page declared
 * `en`, a screen reader reads "Français" with an English voice and it comes out as
 * noise. One attribute and the right voice says the word — which is the entire point of
 * writing the option in its own language in the first place.
 */
function endonym(text: string, lang: Lang): HTMLSpanElement {
  const name = make('span', 'instrument__endonym', text);
  name.lang = lang;
  return name;
}

/** One line of the conversation, in the language it will be held in. */
function sample(lang: Lang): HTMLSpanElement {
  const line = make('span', 'instrument__sample', LANG_SAMPLE[lang]);
  line.lang = lang;
  return line;
}

/** A plate for one language: its name, then a sentence of it. */
function langPlate(button: HTMLButtonElement, lang: Lang): void {
  const line = make('span', 'instrument__plate-line');
  line.append(endonym(LANG_ENDONYM[lang], lang), sample(lang));
  button.appendChild(line);
}

/**
 * The plate for `both`, which is a policy rather than a language.
 *
 * Its title is written twice because it is addressed to both readers, and the two
 * samples are stacked under it so the plate SHOWS what the answer means: the page
 * carries the two of them and follows whoever opens it.
 */
function bothPlate(button: HTMLButtonElement): void {
  const head = make('span', 'instrument__plate-head');
  const separator = make('span', 'instrument__endonym-sep', '·');
  separator.setAttribute('aria-hidden', 'true');
  head.append(endonym('Both', 'en'), separator, endonym('Les deux', 'fr'));

  const stack = make('span', 'instrument__plate-samples');
  for (const lang of LANGS) stack.appendChild(sample(lang));

  button.append(head, stack);
}

/**
 * The shared body of both language controls.
 *
 * `preselect` is a HINT, never an answer: it lights a plate so the reader sees a
 * proposal, and the click is still what commits. It is separate from `field.default`
 * on purpose — a schema default turns the panel's answer-on-click off (the built-in
 * would not settle a question that already has an answer), and this question wants to
 * be settled by one click on a plate.
 */
function createPlates(
  kind: string,
  field: AparteElicitationEnumField,
  ctx: InstrumentContext,
  preselect?: string,
): AparteElicitationFieldControl {
  const el = root(kind);
  const titleId = header(el, field);

  let value =
    typeof field.default === 'string'
      ? field.default
      : preselect != null && field.options.some((option) => option.value === preselect)
        ? preselect
        : '';

  const list = make('div', 'instrument__plates');
  const entries: GroupEntry[] = field.options.map((option) => {
    const both = option.value === 'both';
    const button = radioButton(`instrument__plate${both ? ' instrument__plate--both' : ''}`);

    if (isLang(option.value)) langPlate(button, option.value);
    else if (both) bothPlate(button);
    // A value from outside the contract: name it and say nothing we cannot vouch for.
    else button.appendChild(make('span', 'instrument__endonym', option.label ?? option.value));

    if (option.description) {
      button.appendChild(make('span', 'instrument__plate-note', option.description));
    }
    button.appendChild(diode());
    if (option.recommended) button.appendChild(srOnly('recommended'));
    return { value: option.value, el: button };
  });
  for (const entry of entries) list.appendChild(entry.el);

  const group = wireGroup(
    list,
    entries,
    (picked) => {
      value = picked;
      ctx.notifyChange();
      ctx.commit?.();
    },
    titleId,
    field.title ?? 'Language',
  );
  group.select(value);

  el.appendChild(list);

  return {
    el,
    getValue: () => value,
    isComplete: () => value !== '',
    focus: () => group.focus(),
  };
}

/**
 * Which language the CONFIGURATOR speaks — the first question anyone is asked.
 *
 * Two plates, side by side, each in its own language, so the question can be answered
 * without being read. The browser's own language lights one of them before anybody
 * touches anything; that is a guess, and a guess is worth exactly one lit diode.
 */
export function createLanguage(
  field: AparteElicitationEnumField,
  ctx: InstrumentContext,
): AparteElicitationFieldControl {
  return createPlates('language', field, ctx, detectLang());
}

/**
 * Which language the GENERATED SPACE speaks — a different question, asked later.
 *
 * The same plates, plus `both`. Nothing is pre-lit here: the browser knows what its
 * owner reads, and knows nothing at all about the visitors of a Space that does not
 * exist yet. The scenario can still propose one through `default`.
 */
export function createSpaceLanguage(
  field: AparteElicitationEnumField,
  ctx: InstrumentContext,
): AparteElicitationFieldControl {
  return createPlates('space-language', field, ctx);
}
