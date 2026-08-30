<script module lang="ts">
  export type { SaucerState } from '../lib/mascotte/states';
</script>

<script lang="ts">
  /**
   * The saucer is a SCENE, not a logo.
   *
   * The aparté face is the pilot under the glass dome, and the ship reacts to what the
   * configurator is doing: it sweeps its beam while we read the Hub, carries the letters
   * of a reply down that same beam while text is written, chases its rim lights and
   * climbs away on a liftoff, tilts and blinks when something breaks.
   *
   * Everything is inline SVG plus CSS in `../styles/scene.css` — no asset, no library,
   * no per-frame JavaScript. The one timer in here does not animate anything: it removes
   * the outgoing face after its crossfade, because a fade that never ran (reduced motion,
   * a background tab) never fires `animationend` either.
   *
   * The whole thing is `aria-hidden`: it is decoration, and the chat next to it is where
   * the state is actually announced.
   */
  import { untrack } from 'svelte';

  import '../styles/scene.css';

  import {
    MASCOT_CROSSFADE_MS,
    faceOf,
    pilotFor,
    type MascotFace,
    type MascotState,
    type SaucerState,
  } from '../lib/mascotte/states';

  interface Props {
    /** What the ship is doing. */
    state?: SaucerState;
    /** Override the pilot's face — the night intro wakes him from `sleeping`. */
    pilot?: MascotState;
    /** Rendered width; the scene is square. A string passes through as-is (`'100%'`). */
    size?: number | string;
    /** Extra classes on the host, for placement. */
    class?: string;
  }

  /*
   * `state` is renamed on the way in, and it has to be: a binding called `state` in this
   * scope turns every `$state` below into a store subscription on it, and Svelte fails
   * with `store_invalid_shape` at runtime. The PROP keeps its name — this is the ship's
   * state and nothing else would read as well from the outside.
   */
  let { state: ship = 'idle', pilot, size = 240, class: className = '' }: Props = $props();

  const face = $derived(faceOf(pilot ?? pilotFor(ship)));
  const width = $derived(typeof size === 'number' ? `${size}px` : size);

  /**
   * Below a certain size the scene stops being a scene.
   *
   * The whole thing is drawn in a 240-unit box with 4-unit strokes and a 19px cargo
   * glyph. At the 34px the console strip asks for, that is a 0.57px hairline and a
   * 2.7px letter: the ship goes to a grey smudge, the stars round away to nothing, and
   * eight glyph animations run forever on cargo no one can see. So a small saucer is a
   * MARK — the ship alone, with the strokes thickened back to a line you can see — and
   * the beam, the stars and the travelling letters belong to the one place they are
   * legible. That is also the design answer: the signature effect happens once.
   *
   * Only a numeric size can be judged here; `'100%'` and `min(46vmin, 208px)` are the
   * big renders by construction.
   */
  const mark = $derived(typeof size === 'number' && size < 96);

  /* ── The pilot changes his mind by dissolving, not by cutting ────────────────
   *
   * Both faces are drawn at the same x/y for the length of the crossfade. SVG text has
   * no layout flow, so they simply overlay — no absolute positioning, no second group.
   * `seq` exists to remount the incoming glyphs so their CSS animation restarts even
   * when the same mood comes back a second time.
   */
  /* `untrack` says what is meant: this is the FIRST face, read once. The effect below
     owns every face after it, and reading the props here without untracking makes the
     compiler warn that the initial value is all this line ever sees — which is true,
     and intended. */
  let shown = $state<MascotFace>(untrack(() => faceOf(pilot ?? pilotFor(ship))));
  let leaving = $state<MascotFace | null>(null);
  let seq = $state(0);
  let fade: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const next = face;
    if (untrack(() => shown).core === next.core) return;

    leaving = untrack(() => shown);
    shown = next;
    seq = untrack(() => seq) + 1;

    if (fade) clearTimeout(fade);
    fade = setTimeout(() => {
      fade = null;
      leaving = null;
    }, MASCOT_CROSSFADE_MS);
  });

  $effect(() => () => {
    if (fade) clearTimeout(fade);
  });

  /**
   * A few fixed points of light, and deliberately NOT a star field: the ship breathes and
   * the beam works, and that is the whole motion budget. Twinkling was the first thing
   * cut — eight blinking dots behind a moving beam is where a cockpit turns into a
   * screensaver. Fixed positions, because a star that jumps on a re-render is a glitch.
   */
  const STARS = [
    { x: 26, y: 42, r: 2.4, o: 0.3 },
    { x: 196, y: 30, r: 2.6, o: 0.22 },
    { x: 16, y: 118, r: 2.1, o: 0.16 },
    { x: 216, y: 146, r: 2.4, o: 0.26 },
    { x: 38, y: 198, r: 1.8, o: 0.14 },
  ];

  /**
   * The letters the beam carries. They spell the house name as they travel, which nobody
   * will ever notice and which is exactly the right amount of detail to put in.
   *
   * `dx` is where a letter drifts sideways on its way out — the beam is a cone, so a
   * glyph that falls dead straight looks pasted onto it rather than carried by it. `s`
   * scales the letter's own duration: identical speeds read as a conveyor belt.
   */
  const BEAM_GLYPHS = [
    { char: 'a', x: 118, delay: '0s', dx: -9, s: 1 },
    { char: 'p', x: 106, delay: '0.18s', dx: -15, s: 1.14 },
    { char: 'a', x: 131, delay: '0.36s', dx: 13, s: 0.92 },
    { char: 'r', x: 112, delay: '0.54s', dx: -6, s: 1.06 },
    { char: 't', x: 126, delay: '0.72s', dx: 10, s: 0.96 },
    { char: 'é', x: 100, delay: '0.9s', dx: -18, s: 1.1 },
    { char: "'", x: 137, delay: '1.08s', dx: 17, s: 0.9 },
    { char: '.', x: 120, delay: '1.26s', dx: 4, s: 1.02 },
  ];
</script>

<div
  class="saucer {className}"
  class:saucer--mark={mark}
  data-state={ship}
  style="--saucer-size: {width}"
  aria-hidden="true"
>
  <svg class="saucer-svg" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" focusable="false">
    {#if !mark}
      <g class="saucer-stars">
        {#each STARS as star (`${star.x}:${star.y}`)}
          <circle class="saucer-star" cx={star.x} cy={star.y} r={star.r} style="--o: {star.o}" />
        {/each}
      </g>

      <!-- Behind the ship, pivoting on the emitter so a scan sweeps like a searchlight. -->
      <g class="saucer-beam">
        <path class="saucer-beam-cone" d="M 100 147 L 52 226 L 188 226 L 140 147 Z" />
        <path class="saucer-beam-core" d="M 110 147 L 88 226 L 152 226 L 130 147 Z" />
        <ellipse class="saucer-beam-pool" cx="120" cy="226" rx="68" ry="9" />

        <!--
          The signature motion. The letters live INSIDE the beam group, so a scanning ship
          swings them with it: they are cargo, not decoration parked next to a cone.
          Direction carries the meaning — they fall while the ship writes, and rise while
          it reads the Hub.
        -->
        <g class="saucer-glyphs">
          {#each BEAM_GLYPHS as glyph, i (i)}
            <text
              class="saucer-glyph"
              x={glyph.x}
              y="156"
              style="--d: {glyph.delay}; --dx: {glyph.dx}px; --s: {glyph.s}">{glyph.char}</text
            >
          {/each}
        </g>
      </g>
    {/if}

    <!--
      Geometry lifted from the icon draft and scaled to this box, then raised to leave
      the beam somewhere to go. Two relationships carry the whole silhouette, and both
      were wrong before they were measured in a browser:
      the hull's top edge (y 94) sits just ABOVE the dome's base (y 98), so the glass
      reads as a dome rather than as a squashed arc; and the face's descenders land a
      couple of units into the hull, which is why the pilot is drawn last.
    -->
    <g class="saucer-ship">
      <path class="saucer-dome" d="M 64 98 A 56 56 0 0 1 176 98 Z" />
      <ellipse class="saucer-body" cx="120" cy="121" rx="92" ry="27" />

      <g class="saucer-lights">
        <circle class="saucer-light" cx="74" cy="140" r="6" style="--i: 0" />
        <circle class="saucer-light" cx="120" cy="144" r="6" style="--i: 1" />
        <circle class="saucer-light" cx="166" cy="140" r="6" style="--i: 2" />
      </g>

      <!-- No `textLength`: forcing a width stretches the parentheses away from the eyes
           and `('.')` stops looking like a face. The faces differ in width by design —
           `(^.^)` is the widest and still clears the glass — so centring is enough. -->
      {#if leaving}
        <text class="saucer-pilot saucer-pilot--out" x="120" y="85" text-anchor="middle"
        ><tspan class="saucer-pilot-paren">(</tspan><tspan class="saucer-pilot-eyes"
          >{leaving.core}</tspan
        ><tspan class="saucer-pilot-paren">)</tspan></text>
      {/if}
      {#key seq}
        <text class="saucer-pilot saucer-pilot--in" x="120" y="85" text-anchor="middle"
        ><tspan class="saucer-pilot-paren">(</tspan><tspan class="saucer-pilot-eyes"
          >{shown.core}</tspan
        ><tspan class="saucer-pilot-paren">)</tspan></text>
      {/key}
    </g>
  </svg>
</div>
