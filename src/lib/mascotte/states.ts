/**
 * The mascot: pure punctuation, never an asset.
 *
 * Parentheses are the face, the eyes are whatever pair of glyphs the mood calls for,
 * and the period between them is the nose. `('.')` is the whole brand — it survives a
 * copy-paste into a README, a plain-text log, a 16px favicon and a screen reader.
 *
 * This module is deliberately DOM-free and framework-free: it is the vocabulary that
 * the aparté renderers, the favicon and the saucer scene all agree on. Rendering lives
 * next door (`renderers.ts`, `favicon.ts`, `../../components/Saucer.svelte`).
 *
 * House rule (doctrine, 2026-08-29): this is PRODUCT code and must never become an
 * aparté plugin. That the mascot works through nothing but the library's public hooks
 * IS the proof those hooks are enough.
 */

/** The seven moods of the face. */
export type MascotState =
  /** `('.')` — nothing happening, and happy about it. */
  | 'idle'
  /** `('.')` plus a running ellipsis — we are working on it. */
  | 'thinking'
  /** `('o')` plus a caret — words are coming out. */
  | 'talking'
  /** `(^.^)` — it worked. */
  | 'happy'
  /** `(x.x)` — it did not. */
  | 'error'
  /** `(-.-)` — the tab has been in the background a while. */
  | 'sleeping'
  /** `('o')` — the moment after sleeping, eyes not yet level. */
  | 'wake';

export const MASCOT_STATES: readonly MascotState[] = [
  'idle',
  'thinking',
  'talking',
  'happy',
  'error',
  'sleeping',
  'wake',
];

/** What trails the face, if anything. Both are drawn by CSS, never by a timer. */
export type MascotTrail = 'none' | 'ellipsis' | 'caret';

/** The block caret that follows the talking face. */
export const MASCOT_CARET = '▌';

/** How many dots the running ellipsis is made of. */
export const MASCOT_ELLIPSIS_DOTS = 3;

/**
 * How long one face takes to dissolve into the next, in ms.
 *
 * Duplicated as `--mascot-crossfade` in `scene.css`, and it has to be: CSS runs the
 * fade, JavaScript removes the layer underneath it, and the two have to agree. This
 * constant is the one both are derived from — retune here, mirror there.
 */
export const MASCOT_CROSSFADE_MS = 220;

/**
 * One mood, taken apart.
 *
 * The pieces are exposed separately because every surface needs a different cut: the
 * chat colours the parentheses and the eyes differently, the favicon needs one string,
 * and a test wants to assert on `core` without caring about the brackets.
 */
export interface MascotFace {
  readonly state: MascotState;
  /** Left eye. */
  readonly left: string;
  /** The nose — a period in every state, which is what keeps the family resemblance. */
  readonly nose: string;
  /** Right eye. */
  readonly right: string;
  /** `left + nose + right`, e.g. `'.'` or `^.^`. */
  readonly core: string;
  /** The whole face, brackets included: `('.')`. */
  readonly face: string;
  readonly trail: MascotTrail;
  /** A short human phrase for the mood — for a tooltip or an accessible name. */
  readonly label: string;
}

function makeFace(
  state: MascotState,
  left: string,
  right: string,
  trail: MascotTrail,
  label: string,
): MascotFace {
  const nose = '.';
  const core = `${left}${nose}${right}`;
  return { state, left, nose, right, core, face: `(${core})`, trail, label };
}

/** The table. Adding a mood means adding a row here and a colour nowhere else. */
export const MASCOT_FACES: Readonly<Record<MascotState, MascotFace>> = {
  idle: makeFace('idle', "'", "'", 'none', 'Standing by'),
  thinking: makeFace('thinking', "'", "'", 'ellipsis', 'Working on it'),
  talking: makeFace('talking', "'", 'o', 'caret', 'Transmitting'),
  happy: makeFace('happy', '^', '^', 'none', 'All systems go'),
  error: makeFace('error', 'x', 'x', 'none', 'Signal lost'),
  sleeping: makeFace('sleeping', '-', '-', 'none', 'Powered down'),
  wake: makeFace('wake', "'", 'o', 'none', 'Waking up'),
};

/** The face for a mood. Total — every `MascotState` has a row. */
export function faceOf(state: MascotState): MascotFace {
  return MASCOT_FACES[state];
}

/** True when the mood carries a trail that moves (an ellipsis or a caret). */
export function isAnimated(state: MascotState): boolean {
  return MASCOT_FACES[state].trail !== 'none';
}

/**
 * The saucer's moods — the ship, not the pilot.
 *
 * They are a different list on purpose: the ship reacts to *events* (a scan, a stream,
 * a liftoff) while the face reacts to *feelings*. `pilotFor` is the one place the two
 * vocabularies meet, so the mapping is testable instead of scattered through markup.
 */
export type SaucerState =
  /** Gentle float, stars twinkling, beam banked. */
  | 'idle'
  /** The tractor beam sweeps like a searchlight — we are reading the Hub. */
  | 'scanning'
  /** Letters travel through the beam while text is being written. The signature effect. */
  | 'streaming'
  /** Hovering, waiting on the human. */
  | 'waiting'
  /** Rim lights chase, the beam retracts, the ship rises. */
  | 'liftoff'
  /** Rim lights blink, the ship tilts, the pilot is not having a good day. */
  | 'error';

export const SAUCER_STATES: readonly SaucerState[] = [
  'idle',
  'scanning',
  'streaming',
  'waiting',
  'liftoff',
  'error',
];

/** Which face the pilot wears while the ship is doing a given thing. */
export function pilotFor(state: SaucerState): MascotState {
  switch (state) {
    case 'scanning':
      return 'thinking';
    case 'streaming':
      return 'talking';
    case 'liftoff':
      return 'happy';
    case 'error':
      return 'error';
    case 'waiting':
    case 'idle':
    default:
      return 'idle';
  }
}

/**
 * A one-value store, Svelte-store-shaped but written by hand.
 *
 * `subscribe` calls back immediately and returns an unsubscriber, which is the whole
 * contract — so `$mascotState` works in a component while `mascotState.get()` works in
 * a plain module and in a test. No rune here on purpose: this file is a `.ts`, and the
 * favicon has to follow the state from outside any component tree.
 */
export interface MascotStore {
  get(): MascotState;
  set(next: MascotState): void;
  subscribe(run: (value: MascotState) => void): () => void;
}

export function createMascotStore(initial: MascotState = 'idle'): MascotStore {
  let value: MascotState = initial;
  const listeners = new Set<(value: MascotState) => void>();

  return {
    get: () => value,
    set(next: MascotState): void {
      if (next === value) return;
      value = next;
      // Iterate a copy: a listener is allowed to unsubscribe itself on the first call.
      for (const run of [...listeners]) run(value);
    },
    subscribe(run: (value: MascotState) => void): () => void {
      listeners.add(run);
      run(value);
      return () => {
        listeners.delete(run);
      };
    },
  };
}

/**
 * The page-wide mood. The app is the authority on it; the aparté renderers only nudge
 * it (they are called when something is rendered, and nothing calls them back when it
 * goes away), so never treat a nudge as the end of a state.
 */
export const mascotState: MascotStore = createMascotStore('idle');
