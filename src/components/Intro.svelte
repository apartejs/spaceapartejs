<script module lang="ts">
  /**
   * The arrival.
   *
   * ONE arrival. There used to be four, drawn at random the way a game picks a title
   * screen — a warp with its own streaked stars, an orange wash down the page, a night
   * watch where the pilot woke up. Each was charming and each brought a visual
   * vocabulary that appeared for a second and a half and then never again; a first
   * impression drawn from a hat is a first impression nobody can learn. What is left is
   * the one that is made entirely of things the product already says: the ship
   * descends, the beam is on, and the letters are falling through it — the same
   * signature effect that then lives in the empty state under it.
   *
   * Three rules are not negotiable, because an intro that breaks any of them is a tax on
   * the three-click path:
   *
   *   1. **≤ 2.5s.**
   *   2. **Interruptible** by any click, key, scroll or touch — and the overlay is
   *      `pointer-events: none`, so the gesture that skips it also does what the user
   *      actually meant. The intro can never swallow a click or trap focus.
   *   3. **Once per session** (`sessionStorage`) — the returning visitor lands straight
   *      in the chat.
   *
   * And it never plays at all under `prefers-reduced-motion`.
   */

  /** The saucer descends and its beam sets the interface down. */
  export type IntroVariant = 'drop';

  export const INTRO_VARIANTS: readonly IntroVariant[] = ['drop'];

  /** The hard ceiling. The CSS finishes fading a touch before this. */
  export const INTRO_MAX_MS = 2500;

  /** How long the overlay takes to leave when the user skips it. */
  export const INTRO_EXIT_MS = 200;

  const SESSION_KEY = 'aparte-spaces:intro-played';

  export function prefersReducedMotion(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  export function introAlreadyPlayed(): boolean {
    try {
      return sessionStorage.getItem(SESSION_KEY) === 'played';
    } catch {
      // Storage can be disabled outright. Then we simply have no memory of the visit.
      return false;
    }
  }

  export function markIntroPlayed(): void {
    try {
      sessionStorage.setItem(SESSION_KEY, 'played');
    } catch {
      // Nothing to do: the worst case is one extra intro, and it is 2.5 seconds long.
    }
  }

  /** The helper the app asks before mounting anything: "should we play an intro?" */
  export function shouldPlayIntro(): boolean {
    if (typeof window === 'undefined') return false;
    if (prefersReducedMotion()) return false;
    return !introAlreadyPlayed();
  }

  /**
   * Kept as a function, and kept exported, because the app asks for the arrival by name
   * rather than hard-coding one — the pool is a list with one entry in it today.
   */
  export function pickIntroVariant(): IntroVariant {
    return 'drop';
  }
</script>

<script lang="ts">
  import '../styles/scene.css';

  import { untrack } from 'svelte';

  import Saucer from './Saucer.svelte';

  interface Props {
    /** Pin a variant instead of drawing one — handy for a screenshot or a demo. */
    variant?: IntroVariant;
    /** Play even if the session has already seen one (a "replay" easter egg). */
    force?: boolean;
    /** Called once, as soon as the intro is over or skipped. Never called twice. */
    onDone?: () => void;
  }

  let { variant, force = false, onDone }: Props = $props();

  /**
   * Drawn once, at mount, and deliberately not reactive: swapping the variant halfway
   * through a 2.5s arrival would restart it. `untrack` says so out loud.
   */
  const chosen: IntroVariant = untrack(() => variant) ?? pickIntroVariant();

  let visible = $state(false);
  let leaving = $state(false);

  /** Not runes: a re-run of the effect must never restart a finished intro, and the
      teardown has to be reachable from `finish()` — see below. */
  let settled = false;
  let teardown: (() => void) | null = null;

  function finish(): void {
    if (settled) return;
    settled = true;
    // Drop the timers and the four window listeners HERE rather than leaving them to
    // the effect's cleanup: a parent that keeps this component mounted after `onDone`
    // (which is the normal thing to do) would otherwise keep listening to every
    // pointerdown and keydown for the rest of the session.
    teardown?.();
    teardown = null;
    leaving = true;
    // The app is told straight away; the overlay takes its 200ms to leave on its own.
    onDone?.();
  }

  $effect(() => {
    if (settled) return;

    if (!(force || shouldPlayIntro())) {
      finish();
      return;
    }

    markIntroPlayed();
    visible = true;

    const timers: number[] = [window.setTimeout(finish, INTRO_MAX_MS)];

    const skip = (): void => finish();
    // Capture, so a gesture is seen even when something else stops its propagation.
    const options: AddEventListenerOptions = { capture: true, passive: true };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const name of events) window.addEventListener(name, skip, options);

    teardown = () => {
      for (const id of timers) clearTimeout(id);
      for (const name of events) window.removeEventListener(name, skip, options);
    };

    return () => {
      teardown?.();
      teardown = null;
    };
  });

  // The overlay outlives `finish()` just long enough to fade.
  $effect(() => {
    if (!leaving) return;
    const id = window.setTimeout(() => (visible = false), INTRO_EXIT_MS);
    return () => clearTimeout(id);
  });
</script>

{#if visible}
  <div class="intro" class:intro--leaving={leaving} data-variant={chosen} aria-hidden="true">
    <div class="intro-veil"></div>

    <!-- `streaming`: the beam is on and the letters are falling through it, which is
         what the ship does while it writes. The arrival is the effect introducing
         itself. -->
    <div class="intro-stage">
      <Saucer state="streaming" size="100%" />
    </div>
  </div>
{/if}
