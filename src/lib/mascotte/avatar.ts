/**
 * The pilot's face as living DOM — and the hook that puts it on every assistant bubble.
 *
 * Two things live here, and they are the same thing at two speeds:
 *
 * - `buildMascotFace` draws one mood, once. It is the vocabulary every surface shares
 *   (the status line, the error card, the avatar), so `('.')` is assembled in exactly
 *   one place and coloured in exactly one stylesheet.
 * - `createLiveMascotFace` keeps that drawing *alive*: hand it a new mood and the old
 *   glyphs CROSSFADE into the new ones instead of jump-cutting. A face that snaps from
 *   `('.')` to `(^.^)` reads as a re-render; a face that dissolves reads as a reaction,
 *   and the whole point of the pilot is that it reacts.
 *
 * On top of both sits `installMascotAvatar`, which registers an `AparteAvatarProvider`
 * so the mascot becomes the assistant's avatar in the chat. The USER avatar is left
 * exactly as aparté rendered it — which, for the default shell, means empty and hidden
 * by `.aparte-avatar:empty`. The pilot is the ship, not the passenger.
 *
 * Plain DOM only, no Svelte: this runs inside the library's own render path, which knows
 * nothing about a component tree.
 *
 * Doctrine (2026-08-29): PRODUCT code. That the mascot needs nothing but aparté's public
 * hooks — `setStatusRenderer`, `setErrorRenderer`, `setAvatarProvider` — is the proof
 * those hooks are enough, and it stops being proof the moment any of this moves into the
 * library.
 */

import { aparteGlobalConfig } from '@aparte/core';
import type { AparteAvatarProvider } from '@aparte/core';

import {
  MASCOT_CARET,
  MASCOT_CROSSFADE_MS,
  MASCOT_ELLIPSIS_DOTS,
  faceOf,
  mascotState,
  type MascotState,
  type MascotStore,
} from './states';

/* -------------------------------------------------------------------------- */
/* One face, drawn once                                                        */
/* -------------------------------------------------------------------------- */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface MascotFaceOptions {
  /**
   * Draw the trail — the running ellipsis of `thinking`, the caret of `talking`.
   * Off in the avatar slot, which is a 32px box with `overflow: hidden`: a trail there
   * is either clipped or cramped, and the mood is carried by CSS instead.
   */
  trail?: boolean;
}

/**
 * The face itself: `(`, the eyes, `)` — three nodes so the parentheses and the eyes can
 * be coloured apart, which is the whole reason the face reads as a face and not as
 * punctuation.
 *
 * Always `aria-hidden`: to a screen reader `('.')` is five pieces of punctuation, and
 * the region that hosts it already carries the real accessible name.
 */
export function buildMascotFace(
  state: MascotState,
  options: MascotFaceOptions = {},
): HTMLElement {
  const { face, core, trail } = faceOf(state);
  const withTrail = options.trail ?? true;

  const root = el('span', `mascot mascot--${state}`);
  root.setAttribute('aria-hidden', 'true');
  root.dataset['mascotState'] = state;
  // The whole face on the element too: copy-paste, and a CSS-less fallback, still work.
  root.title = face;

  const glyphs = el('span', 'mascot-face');
  glyphs.append(
    el('span', 'mascot-paren', '('),
    el('span', 'mascot-eyes', core),
    el('span', 'mascot-paren', ')'),
  );
  root.append(glyphs);

  if (!withTrail) return root;

  if (trail === 'ellipsis') {
    const dots = el('span', 'mascot-ellipsis');
    for (let i = 0; i < MASCOT_ELLIPSIS_DOTS; i += 1) {
      const dot = el('span', 'mascot-dot', '.');
      dot.style.setProperty('--i', String(i));
      dots.append(dot);
    }
    root.append(dots);
  } else if (trail === 'caret') {
    root.append(el('span', 'mascot-caret', MASCOT_CARET));
  }

  return root;
}

/* -------------------------------------------------------------------------- */
/* The same face, alive                                                        */
/* -------------------------------------------------------------------------- */

export interface LiveMascotFaceOptions extends MascotFaceOptions {
  /** Mood to open on. Defaults to `idle`. */
  initial?: MascotState;
  /** Crossfade length, in ms. Must match `--mascot-crossfade` if you retune it. */
  crossfadeMs?: number;
}

export interface LiveMascotFace {
  /** The node to insert. Owns its own children; never write into it yourself. */
  readonly element: HTMLElement;
  /** The mood currently showing. */
  state(): MascotState;
  /** Change mood. Same mood twice is a no-op — no crossfade to nowhere. */
  set(next: MascotState): void;
  /** Drop the pending timer and detach. Safe to call twice. */
  destroy(): void;
}

/**
 * A face that changes its mind gracefully.
 *
 * Both moods exist in the DOM for the length of the crossfade, stacked in the same grid
 * cell so they overlay without a single absolute position, and the outgoing layer is
 * removed by a timer rather than by `animationend` — an animation that never runs (a
 * hidden tab, `prefers-reduced-motion`, a browser that skips it) still has to be cleaned
 * up, and `animationend` is exactly the event that does not fire then.
 *
 * At most two layers exist at once: a mood arriving while another is still leaving evicts
 * the leaver on the spot. Faster than the crossfade is not a smear of three faces.
 */
export function createLiveMascotFace(options: LiveMascotFaceOptions = {}): LiveMascotFace {
  const crossfadeMs = options.crossfadeMs ?? MASCOT_CROSSFADE_MS;
  const faceOptions: MascotFaceOptions = { trail: options.trail ?? true };

  let current: MascotState = options.initial ?? 'idle';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dead = false;

  const root = el('span', 'mascot-live');
  root.setAttribute('aria-hidden', 'true');
  root.dataset['mascotState'] = current;

  const layerFor = (state: MascotState): HTMLElement => {
    const layer = el('span', 'mascot-layer');
    layer.append(buildMascotFace(state, faceOptions));
    return layer;
  };

  let layer = layerFor(current);
  root.append(layer);

  const dropStale = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    for (const stale of [...root.querySelectorAll('.mascot-layer--out')]) stale.remove();
  };

  return {
    element: root,
    state: () => current,
    set(next: MascotState): void {
      if (dead || next === current) return;
      dropStale();

      const outgoing = layer;
      outgoing.classList.add('mascot-layer--out');

      const incoming = layerFor(next);
      incoming.classList.add('mascot-layer--in');
      root.append(incoming);

      layer = incoming;
      current = next;
      root.dataset['mascotState'] = next;

      timer = setTimeout(() => {
        timer = null;
        outgoing.remove();
      }, crossfadeMs);
    },
    destroy(): void {
      dead = true;
      dropStale();
      root.remove();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The avatar hook                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Anything that can take an avatar provider.
 *
 * Structural, like `MascotRendererHost` next door: `aparteGlobalConfig` satisfies it and
 * so does an `AparteConfig` handed to `attachConfig` for a single chat.
 */
export interface MascotAvatarHost {
  setAvatarProvider(provider: AparteAvatarProvider | null): void;
}

export interface MascotAvatarOptions {
  /** Where to register. Defaults to the page-wide `aparteGlobalConfig`. */
  host?: MascotAvatarHost;
  /** Mood to follow. Defaults to the page-wide store. */
  store?: MascotStore;
  /**
   * Which assistant bubbles are alive.
   *
   * `'last'` (the default) keeps exactly ONE face following the mood — the most recently
   * rendered one — and settles every other bubble to `resting`. A transcript where six
   * pilots blink in unison is a Christmas tree, not a cockpit: the history is finished,
   * only the current turn is happening.
   *
   * `'all'` is there for a demo of the effect, and for nothing else.
   */
  follow?: 'last' | 'all';
  /** What a bubble settles to when it stops being the live one. Defaults to `idle`. */
  resting?: MascotState;
}

interface LiveSlot {
  face: LiveMascotFace;
  unsubscribe: () => void;
}

/**
 * The provider itself, if you want to register it yourself (or hand it to a scoped
 * config). `installMascotAvatar` is the one-liner around it.
 *
 * The `user` role returns without touching the host, which leaves the slot exactly as
 * the shell rendered it — empty, and hidden by `.aparte-avatar:empty`.
 */
export function createMascotAvatarProvider(
  options: MascotAvatarOptions = {},
): AparteAvatarProvider {
  const store = options.store ?? mascotState;
  const follow = options.follow ?? 'last';
  const resting = options.resting ?? 'idle';

  /** The one bubble currently wired to the store, in `'last'` mode. */
  let live: LiveSlot | null = null;

  const settle = (): void => {
    if (!live) return;
    live.unsubscribe();
    live.face.set(resting);
    live = null;
  };

  return {
    render(role, host) {
      if (role !== 'assistant') return;

      const face = createLiveMascotFace({ initial: store.get(), trail: false });
      const shell = el('span', 'mascot-avatar');
      shell.append(face.element);
      host.append(shell);
      // A hook for the stylesheet that does not depend on `:has()` — and a way to see,
      // in devtools, which slots the pilot actually claimed.
      host.setAttribute('data-mascot-avatar', '');

      // `subscribe` fires immediately; the face already opened on `store.get()`, so that
      // first call lands on the `next === current` no-op rather than on a crossfade.
      const unsubscribe = store.subscribe((value) => face.set(value));

      if (follow === 'last') {
        settle();
        live = { face, unsubscribe };
      }

      return () => {
        if (live?.face === face) live = null;
        unsubscribe();
        face.destroy();
        host.removeAttribute('data-mascot-avatar');
        shell.remove();
      };
    },
  };
}

/**
 * Put the pilot on every assistant bubble, and return the undo.
 *
 * ```ts
 * const stop = installMascotAvatar();
 * // …
 * stop();
 * ```
 *
 * Passing `null` back restores aparté's default (no avatar at all), which is what the
 * disposer does — so a test, or a hot reload, leaves no trace.
 */
export function installMascotAvatar(options: MascotAvatarOptions = {}): () => void {
  const host = options.host ?? aparteGlobalConfig;
  host.setAvatarProvider(createMascotAvatarProvider(options));
  return () => host.setAvatarProvider(null);
}
