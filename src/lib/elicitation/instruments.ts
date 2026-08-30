/**
 * The instrument panel — which control answers which question.
 *
 * aparté lets a host replace ONE field of the question panel and keep everything
 * around it: the placement in the composer, the accept/decline contract, the
 * send-button gating, the focus, the teardown when a turn is stopped. That hook is
 * `setElicitationFieldRenderer`, and this file is the whole of our use of it.
 *
 * The dispatch reads `ctx.key` FIRST and the field's type second, because the type
 * system of an elicitation schema is deliberately small — `enum | boolean | string` —
 * and a colour, an emoji and a repo name are all "a string". The key is what says
 * which one, so `accent` gets swatches and `title` keeps the built-in input.
 *
 * Two rules decide when we DON'T take a field over, and both are about not taking
 * something away from the user:
 *
 * - **An enum that offers a free-text escape stays with the built-in.** `allowOther`
 *   puts an "Other…" entry in the list; a custom control cannot render it, so
 *   replacing such a field would quietly delete an answer the host had offered.
 * - **A multi-select stays with the built-in.** Every instrument here is a single
 *   choice, and pretending otherwise would return the wrong shape of value.
 *
 * And one rule about how an answer is given. The panel settles a single-choice
 * question on the click — one decision, one gesture — but it can only do that for the
 * fields it built itself: `buildField` drops the `settle` callback when a custom
 * control is returned. So we restore it from the outside, through the composer's own
 * documented `submit()`, and only in exactly the case the built-in would have settled:
 * a question asked on its own, single choice, no default, `answerOnClick` on. If the
 * composer cannot be found the control simply falls back to the send button, which is
 * a slower answer and never a broken one.
 */

import { aparteGlobalConfig } from '@aparte/core';
import type {
  AparteElicitationEnumField,
  AparteElicitationField,
  AparteElicitationFieldContext,
  AparteElicitationFieldControl,
  AparteElicitationFieldRenderer,
} from '@aparte/core';

import '../../styles/instruments.css';

import type { InstrumentContext } from './controls';
import { createChoice, createColour, createEmoji, createPrompt, createTheme, createWeights } from './controls';

/**
 * The slice of the aparté config this module touches.
 *
 * A structural type, so `aparteGlobalConfig` satisfies it and a test can pass a
 * two-method fake without building a config.
 */
export interface InstrumentHost {
  setElicitationFieldRenderer(renderer: AparteElicitationFieldRenderer | null): void;
  getElicitationOptions?(): { answerOnClick: boolean };
}

/** The `dtype` names transformers.js knows — how a weights question is recognised. */
const DTYPES = new Set([
  'q4',
  'q4f16',
  'q4f32',
  'bnb4',
  'int4',
  'int8',
  'uint8',
  'q8',
  'fp16',
  'bf16',
  'fp32',
]);

/**
 * Is this the weights question, asked without a key to say so?
 *
 * `ask_precision` asks it on its own — a single field, so `ctx.key` is `undefined` —
 * and the values are the only thing left to recognise it by. Every option has to be a
 * known dtype: one stray value and this is somebody else's question.
 */
function looksLikeWeights(field: AparteElicitationEnumField): boolean {
  return field.options.length >= 2 && field.options.every((option) => DTYPES.has(option.value));
}

/** The host's answer-on-click policy, defaulting to aparté's own default of `true`. */
function answersOnClick(host: InstrumentHost): boolean {
  try {
    return host.getElicitationOptions?.().answerOnClick ?? true;
  } catch {
    return true;
  }
}

/**
 * Submit the panel this element sits in.
 *
 * `<aparte-composer>.submit()` is public and documented as callable programmatically;
 * with a panel open it runs that panel's `onSubmit`, which is the same path the send
 * button takes. Nothing happens if the answer is not complete, and nothing happens if
 * there is no composer — a control mounted anywhere else keeps working.
 */
function submitPanel(el: HTMLElement): void {
  const composer = el.closest('aparte-composer') as (HTMLElement & { submit?: () => void }) | null;
  if (composer && typeof composer.submit === 'function') composer.submit();
}

/**
 * The dispatch itself. Exported for the tests, which build controls without a panel.
 *
 * Returns `null` for anything we have no instrument for — the built-in renders it, and
 * that is what makes overriding a handful of fields practical.
 */
export function createInstrument(
  field: AparteElicitationField,
  ctx: AparteElicitationFieldContext,
  host: InstrumentHost = aparteGlobalConfig,
): AparteElicitationFieldControl | null {
  const key = ctx.key;

  // Only where the built-in itself would have settled on the click.
  const settles =
    key === undefined &&
    field.type === 'enum' &&
    field.multiple !== true &&
    field.default == null &&
    answersOnClick(host);

  let built: AparteElicitationFieldControl | null = null;
  const instrument: InstrumentContext = {
    notifyChange: () => ctx.notifyChange(),
    ...(settles ? { commit: (): void => { if (built) submitPanel(built.el); } } : {}),
  };

  built = build(field, key, instrument);
  return built;
}

function build(
  field: AparteElicitationField,
  key: string | undefined,
  ctx: InstrumentContext,
): AparteElicitationFieldControl | null {
  if (field.type === 'string') {
    if (key === 'accent') return createColour(field, ctx);
    if (key === 'emoji') return createEmoji(field, ctx);
    if (key === 'systemPrompt') return createPrompt(field, ctx);
    return null;
  }

  if (field.type === 'enum') {
    // Both escape hatches the built-in owns and we cannot reproduce.
    if (field.multiple === true || field.allowOther !== false) return null;
    if (key === 'theme') return createTheme(field, ctx);
    if (key === 'dtype' || key === 'precision' || (key === undefined && looksLikeWeights(field))) {
      return createWeights(field, ctx);
    }
    return createChoice(field, ctx);
  }

  // A yes/no is two words and a click; the built-in already draws it well.
  return null;
}

/** Hosts already fitted, so a second call is a no-op rather than a second renderer. */
const fitted = new WeakSet<InstrumentHost>();

/**
 * Fit the instrument panel to a config instance.
 *
 * ```ts
 * import { installInstruments } from './lib/elicitation/instruments';
 * installInstruments();            // the global config
 * ```
 *
 * Idempotent: calling it twice registers one renderer. Call it once, before the first
 * question is asked — mounting order does not matter, since the renderer is read at
 * the moment a field is built, not when the panel is created.
 */
export function installInstruments(host: InstrumentHost = aparteGlobalConfig): void {
  if (fitted.has(host)) return;
  fitted.add(host);
  host.setElicitationFieldRenderer((field, ctx) => createInstrument(field, ctx, host));
}
