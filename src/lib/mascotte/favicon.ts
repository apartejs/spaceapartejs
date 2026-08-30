/**
 * The favicon is the mascot too.
 *
 * Drawn as an SVG data-URI from the current mood — no PNG, no build step, no asset
 * pipeline. The tab shows the saucer with the pilot's current face, so a scan that is
 * still running or a liftoff that succeeded is visible from a background tab.
 *
 * The plate stays cosmos in both colour schemes. A favicon behaves like an app icon:
 * inverting it would trade the identity for a contrast problem it does not have (dark
 * plate, lit glyphs, high contrast on any tab strip). What the scheme changes is the
 * hairline ring — a dark tab strip is the one place a dark plate can melt away — and
 * everything is overridable through `palette` anyway.
 *
 * THE SHIP WEARS THE PRODUCT'S COLOUR, NOT APARTÉ'S. This file drew a brass saucer on a
 * violet plate, which is what the whole product looked like before the palette moved to
 * night blue and the brass was reserved for the "Made with aparté" mark alone. The tab
 * kept the old identity long after the page had changed its own — the saucer on screen
 * has been orange on night blue for a while. Same six colours as `tokens.css` now.
 */

import { faceOf, mascotState, type MascotState, type MascotStore } from './states';

export type FaviconMode = 'light' | 'dark';

export interface MascotFaviconPalette {
  /** The rounded plate behind everything — and, at this size, the dome itself. */
  bg: string;
  /** Hull of the saucer: the plate it sits on, one step lighter. */
  hull: string;
  /** Outlines and the parentheses of the face — `--saucer-shell` on screen. */
  shell: string;
  /** The eyes, the nose, and the rim lights — `--saucer-lamp` on screen. */
  lamp: string;
  /** The beam under the ship. */
  accent: string;
  /** Hairline around the plate, or `null` for none. */
  ring: string | null;
}

/*
 * The cockpit palette, literal: `--void`, `--seam`, `--thruster`, `--thruster-lit`. A
 * favicon is drawn into a string long before any stylesheet exists, so these cannot be
 * `var()` — which is exactly why they went stale when the palette moved. They are the
 * scene's own values: `hull` is what `--saucer-dome` resolves to, `shell` is
 * `--saucer-shell`, `lamp` is `--saucer-lamp`. No brass: the mark in the header is the
 * only place it belongs.
 */
const LIGHT_PALETTE: MascotFaviconPalette = {
  bg: '#070A12',
  hull: '#222C42',
  shell: '#FF3E00',
  lamp: '#FF5C26',
  accent: '#FF3E00',
  ring: null,
};

const DARK_PALETTE: MascotFaviconPalette = {
  ...LIGHT_PALETTE,
  // A seam, doing exactly what a seam does: keeping the plate off a dark tab strip
  // instead of letting it dissolve into one.
  ring: '#222C42',
};

export interface MascotFaviconOptions {
  /** Defaults to whatever `prefers-color-scheme` says, or `light` off-browser. */
  mode?: FaviconMode;
  /** Override the whole palette, or just the accent, without touching the drawing. */
  palette?: Partial<MascotFaviconPalette>;
  /** Rendered box, in px. 64 is plenty: the browser downscales it. */
  size?: number;
}

/** XML text escaping. None of our glyphs need it today; a future eye might. */
function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function currentMode(): FaviconMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolvePalette(options: MascotFaviconOptions): MascotFaviconPalette {
  const base = (options.mode ?? currentMode()) === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
  return { ...base, ...options.palette };
}

/**
 * The saucer at 64×64 — which, at this size, is really the face at 64×64.
 *
 * This is NOT the `<Saucer>` scene scaled down. The first attempt was, and it came out
 * as mush: shrink a dome, a hull and a beam into 64px and the one part that carries the
 * state — the face — ends up three pixels tall.
 *
 * So the composition inverts. The **rounded plate is the dome**, the face fills it, and
 * the ship keeps only what still reads at 16px: one hull ellipse under the chin, three
 * rim lights, a stub of beam. What never changes gets small; what changes stays legible.
 *
 * No `textLength` here either — forcing a width stretches the parentheses away from the
 * eyes and `('.')` stops looking like a face. `(^.^)` is the widest of the seven and
 * still clears the plate.
 *
 * As in the scene and in the icon draft, the face is drawn **last**: the pilot is in
 * front of the glass, not behind it.
 */
export function mascotFaviconSvg(
  state: MascotState,
  options: MascotFaviconOptions = {},
): string {
  const p = resolvePalette(options);
  const size = options.size ?? 64;
  const { core, label } = faceOf(state);

  const ring = p.ring
    ? `<rect x="1" y="1" width="62" height="62" rx="13" fill="none" stroke="${p.ring}" stroke-width="2"/>`
    : '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${xml(label)}">`,
    `<rect width="64" height="64" rx="14" fill="${p.bg}"/>`,
    ring,
    // Beam first: it belongs behind the ship.
    `<path d="M 24 48 L 18 60 L 46 60 L 40 48 Z" fill="${p.accent}" opacity="0.22"/>`,
    `<ellipse cx="32" cy="42" rx="25" ry="6" fill="${p.hull}" stroke="${p.shell}" stroke-width="2.5"/>`,
    // The lamps take `lamp`, not `accent`: on screen they are the lit orange against the
    // shell's own, and painting both the same flattens the ship into one silhouette.
    `<circle cx="16" cy="45" r="2.2" fill="${p.lamp}"/>`,
    `<circle cx="32" cy="47" r="2.2" fill="${p.lamp}"/>`,
    `<circle cx="48" cy="45" r="2.2" fill="${p.lamp}"/>`,
    `<text x="32" y="32" text-anchor="middle"`,
    ` font-family="Georgia, 'Iowan Old Style', 'Times New Roman', serif" font-size="23" fill="${p.shell}">`,
    `(<tspan fill="${p.lamp}">${xml(core)}</tspan>)`,
    `</text>`,
    `</svg>`,
  ].join('');
}

/**
 * The same drawing as a `data:` URI.
 *
 * Percent-encoded rather than base64: shorter, and readable in devtools when the tab
 * icon is wrong and you need to see why.
 */
export function mascotFaviconDataUri(
  state: MascotState,
  options: MascotFaviconOptions = {},
): string {
  return `data:image/svg+xml,${encodeURIComponent(mascotFaviconSvg(state, options))}`;
}

/** Point the document's icon link at `state`, creating the link if the page has none. */
export function applyMascotFavicon(
  state: MascotState,
  options: MascotFaviconOptions = {},
): void {
  if (typeof document === 'undefined') return;

  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.append(link);
  }
  link.type = 'image/svg+xml';
  link.href = mascotFaviconDataUri(state, options);
}

export interface StartMascotFaviconOptions extends MascotFaviconOptions {
  /** Mood to follow. Defaults to the page-wide store. */
  store?: MascotStore;
}

/**
 * Follow the mood — and the colour scheme — until the returned disposer is called.
 *
 * ```ts
 * const stop = startMascotFavicon();
 * ```
 */
export function startMascotFavicon(options: StartMascotFaviconOptions = {}): () => void {
  const { store = mascotState, ...draw } = options;

  let current: MascotState = store.get();
  const paint = (): void => applyMascotFavicon(current, draw);

  const unsubscribe = store.subscribe((value) => {
    current = value;
    paint();
  });

  // Only worth watching when the mode is not pinned by the caller.
  const query =
    draw.mode === undefined && typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
  query?.addEventListener('change', paint);

  return () => {
    unsubscribe();
    query?.removeEventListener('change', paint);
  };
}
