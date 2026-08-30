/**
 * The mascot, wired into aparté through nothing but public render hooks.
 *
 * `setStatusRenderer` and `setErrorRenderer` each replace one region's markup and each
 * return `string | HTMLElement` (guides/customization.mdx). We always return an
 * **element** and write text with `textContent`: a renderer that returns a string is
 * inserted as `innerHTML`, and an error message is the one string on the page that came
 * from a transport we do not control. No escaping to get wrong if there is no string.
 *
 * The third hook, `setAvatarProvider`, lives next door in `avatar.ts` — it is imperative
 * where these two are declarative, and it owns a face that outlives a single call. This
 * module still installs it, so the app keeps ONE line to wire the whole mascot up.
 *
 * Plain DOM only — no Svelte in here. These functions run inside the library's render
 * path, which knows nothing about a component tree, and keeping them framework-free is
 * what makes the mascot shareable between products.
 *
 * Styles live in `src/styles/scene.css`; import it once in the app (the saucer scene
 * pulls it in already).
 */

import { aparteGlobalConfig } from '@aparte/core';
import type { AparteErrorRenderer, AparteStatusRenderer } from '@aparte/core';

import { buildMascotFace, installMascotAvatar, type MascotAvatarHost } from './avatar';
import { mascotState, type MascotStore } from './states';

/**
 * Anything that can take our three hooks.
 *
 * Structural on purpose: `aparteGlobalConfig` satisfies it, and so does an
 * `AparteConfig` instance handed to `attachConfig` for a single chat. Naming the class
 * here would have ruled out the scoped case for no benefit.
 */
export interface MascotRendererHost extends MascotAvatarHost {
  setStatusRenderer(renderer: AparteStatusRenderer | null): void;
  setErrorRenderer(renderer: AparteErrorRenderer | null): void;
}

export interface MascotRendererOptions {
  /** Where to register. Defaults to the page-wide `aparteGlobalConfig`. */
  host?: MascotRendererHost;
  /**
   * Store to nudge when a renderer fires — `thinking` on a status line, `error` on an
   * error segment. Pass `null` to register the visuals and drive the mood yourself.
   *
   * It is also the mood the avatar follows, and there a `null` store is not an option:
   * a face with nothing to follow is just a sticker, so `null` installs the renderers
   * and skips the avatar.
   */
  store?: MascotStore | null;
  /** Heading above an error message. Kept short; the message carries the detail. */
  errorTitle?: string;
  /** Put the pilot on every assistant bubble. On by default. */
  avatar?: boolean;
}

const DEFAULT_ERROR_TITLE = 'Signal lost';

/* -------------------------------------------------------------------------- */
/* Building blocks                                                            */
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

/* -------------------------------------------------------------------------- */
/* The two hooks                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The typing indicator: a thinking face and the app's own status text.
 *
 * `<aparte-chat-status>` keeps ownership of show/hide and of the accessible name (it
 * mirrors its `text` attribute into `aria-label`), so everything we return is decorative
 * and the text is repeated visually only.
 */
export function renderMascotStatus(text: string): HTMLElement {
  const row = el('span', 'mascot-status');
  row.setAttribute('aria-hidden', 'true');
  row.append(buildMascotFace('thinking'));

  const label = text.trim();
  if (label) row.append(el('span', 'mascot-status-text', label));

  return row;
}

/**
 * An error segment: the pilot pulls a face, then says what happened.
 *
 * `message` and `details` reach us from a provider or a transport. They are written with
 * `textContent` and never interpolated into markup.
 */
export function renderMascotError(
  ctx: { message: string; details?: string },
  title: string = DEFAULT_ERROR_TITLE,
): HTMLElement {
  const root = el('div', 'mascot-error');
  root.dataset['mascotState'] = 'error';
  root.append(buildMascotFace('error'));

  const body = el('div', 'mascot-error-body');
  body.append(el('p', 'mascot-error-title', title));
  body.append(el('p', 'mascot-error-message', ctx.message));
  if (ctx.details) body.append(el('p', 'mascot-error-details', ctx.details));
  root.append(body);

  return root;
}

/* -------------------------------------------------------------------------- */
/* Installation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Register the whole mascot — status line, error card, avatar — and return the undo.
 *
 * Passing `null` back to any of the three setters restores aparté's default, which is
 * what the returned disposer does — so a test, or a hot reload, leaves no trace.
 *
 * ```ts
 * const stop = installMascotRenderers();
 * // …
 * stop();
 * ```
 */
export function installMascotRenderers(options: MascotRendererOptions = {}): () => void {
  const host = options.host ?? aparteGlobalConfig;
  const store = options.store === undefined ? mascotState : options.store;
  const errorTitle = options.errorTitle ?? DEFAULT_ERROR_TITLE;

  host.setStatusRenderer((text) => {
    // A nudge, not a verdict: nothing calls a renderer back when the status line goes
    // away, so the app stays the authority on when we stop thinking.
    store?.set('thinking');
    return renderMascotStatus(text);
  });

  host.setErrorRenderer((ctx) => {
    store?.set('error');
    return renderMascotError(ctx, errorTitle);
  });

  const stopAvatar =
    (options.avatar ?? true) && store ? installMascotAvatar({ host, store }) : null;

  return () => {
    host.setStatusRenderer(null);
    host.setErrorRenderer(null);
    stopAvatar?.();
  };
}
