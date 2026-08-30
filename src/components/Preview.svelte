<script lang="ts">
  /**
   * The preview pane: the generated `index.html`, running.
   *
   * This component owns the BYTES on the glass and nothing about the glass itself: the
   * blob URL, the debounced rebuild and the sandbox live here, and `Viewport` — which
   * owns the size, the zoom and the frame's housing — is handed the iframe to render and
   * hands the element back through `bind:frame`. That split is why the size controls are
   * not in `PreviewBar` any more: they belong to the instrument that measures, and this
   * one only decides what is shown.
   *
   * It takes the config and a `generate` function as props and hands the result back
   * through `ongenerated`, so the app keeps the wiring and the store stays out of here.
   * Compose it with `PreviewBar` (the theme lens and the way out) and `FileTabs` (the
   * bytes) — all three are preview-only, and none of them can reach `SpaceConfig`.
   *
   *     <PreviewBar theme={previewTheme} shipTheme={config.theme}
   *                 onthemechange={(t) => (previewTheme = t)} />
   *     <Preview {config} {generate} theme={previewTheme}
   *              ongenerated={(space) => (files = space.files)} />
   *     <FileTabs {files} />
   */
  import { untrack } from 'svelte';

  import type { SpaceConfig } from '../lib/config/space-config';
  import type { GeneratedSpace, PreviewTheme } from '../lib/generator/types';
  import { lang } from '../lib/i18n/store.svelte';
  import { uiCopy } from '../lib/i18n/ui';

  import Viewport from './Viewport.svelte';

  interface Props {
    /** The live config. Read only — this component never writes to it. */
    config: SpaceConfig;
    /** The generator, injected so the preview stays a pure consumer of it. */
    generate: (config: SpaceConfig) => GeneratedSpace;
    /**
     * Preview-only theme override. `null` means "show the theme the Space ships with",
     * which is the case where the previewed bytes are exactly the shipped bytes.
     */
    theme?: PreviewTheme | null;
    /** The app sets this while the scenario has produced nothing worth rendering. */
    idle?: boolean;
    /** Drop `allow-same-origin` from the sandbox. See the sandbox comment below. */
    isolated?: boolean;
    /** How long typing has to settle before the frame reloads. */
    debounceMs?: number;
    /**
     * The *shippable* build (no theme override), emitted after every debounced
     * regeneration. Optional: it exists so `FileTabs`, the download and the push can
     * all show the same bytes the frame was built from, without generating twice.
     */
    ongenerated?: (space: GeneratedSpace) => void;
  }

  let {
    config,
    generate,
    theme = null,
    idle = false,
    isolated = true,
    debounceMs = 200,
    ongenerated,
  }: Props = $props();

  /** Bound down into `Viewport`, which renders the element this component navigates. */
  let frame = $state<HTMLIFrameElement | null>(null);
  /** A change has landed but the frame has not been rebuilt yet. */
  let pending = $state(false);
  /** The frame is navigating; cleared by its own `load`. */
  let loading = $state(false);
  let failure = $state<string | null>(null);

  let blobUrl: string | null = null;
  /** The first build is immediate: nobody is typing yet, and a 200ms blank pane reads as broken. */
  let firstBuild = true;

  /**
   * A stable, deep change signal.
   *
   * Reading `config` alone would only track the object's identity, so a store that
   * mutates a field in place (`config.title = …`) would never reach us; reading a
   * `$derived` object would give a new identity on every recompute and re-run the effect
   * forever. A JSON string is both: it touches every field, and `$derived` compares it
   * by value, so an unchanged config is genuinely no change.
   */
  /**
   * The words on the glass. Read through a `$derived` so a language switch redraws the
   * empty state, the frame's accessible name and the live region together — including the
   * frame title, which is only ever read by a screen reader and would otherwise be the one
   * English sentence left in a French session.
   */
  const t = $derived(uiCopy(lang.current));

  const configKey = $derived(JSON.stringify(config));
  const previewTheme = $derived<PreviewTheme>(theme ?? config.theme);
  const busy = $derived(pending || loading);

  /**
   * The sandbox, token by token. Everything not listed here stays denied.
   *
   * - `allow-scripts` — non-negotiable: the generated Space *is* JavaScript.
   * - `allow-same-origin` — a blob: URL inherits the creating document's origin, but a
   *   sandbox without this token gives the frame an opaque storage key instead. Measured
   *   in Chrome, on the same blob document: `caches`, `indexedDB` and `localStorage` all
   *   throw `SecurityError`. Cache Storage is exactly where transformers.js keeps its
   *   weights, so the browser mode would re-download the model on every reload of the
   *   preview — hundreds of megabytes, every time typing settles. It is also what lets an
   *   OAuth round-trip read back the state it stored. The cost is real and worth saying
   *   out loud: `allow-scripts` plus `allow-same-origin` means the frame is no longer
   *   isolated from the configurator — the same measurement confirms it can reach
   *   `parent.document`, and with it the localStorage where a signed-in user's Hugging
   *   Face token sits. So it stays OFF by default (`isolated`): the token is worth more
   *   than the preview's cache, the values baked into the page are user-supplied, and a
   *   shared `?model=…` link would otherwise be an XSS away from stealing a token. The
   *   cost is that Cache Storage throws inside the frame, so the model cannot be
   *   downloaded there — which is what the bar's "Open in a tab" button is for: a normal
   *   origin, the real behaviour, the same bytes.
   * - `allow-forms` — the composer and any provider token form.
   * - `allow-popups` + `allow-popups-to-escape-sandbox` — a sign-in window, or a link out
   *   to the model card, opens as a normal tab instead of dying silently.
   * - `allow-downloads` — exporting a conversation from the previewed chat.
   *
   * Deliberately absent: `allow-modals` (nothing in the generated page prompts),
   * `allow-top-navigation` (the preview must never take the configurator with it),
   * `allow-pointer-lock`, `allow-presentation`.
   *
   * Changing this attribute only takes effect on the next navigation, which is fine:
   * `isolated` is a deployment decision, not a control.
   */
  const sandbox = $derived(
    [
      'allow-scripts',
      ...(isolated ? [] : ['allow-same-origin']),
      'allow-forms',
      'allow-popups',
      'allow-popups-to-escape-sandbox',
      'allow-downloads',
    ].join(' '),
  );

  /**
   * Blob URL rather than `srcdoc`.
   *
   * `srcdoc` would have to HTML-escape a document that is already tens of kilobytes into
   * a single attribute — unreadable in devtools, and it gives the frame no URL of its
   * own, so anything the generated page resolves relatively behaves differently from the
   * file the user ships. A blob URL is a real navigation of a real document: what runs
   * here is what runs on the Hub.
   */
  function point(target: HTMLIFrameElement, url: string): void {
    loading = true;
    // `location.replace`, not `src = url`: assigning `src` pushes an entry onto the
    // *parent's* session history, so a pane that regenerates twenty times puts twenty
    // steps between the user and wherever they came from. `replace()` is one of the few
    // members a cross-origin `Location` still exposes, so this keeps working in the
    // isolated sandbox too (measured) — the `catch` is only there for the day it does not.
    try {
      target.contentWindow?.location.replace(url);
    } catch {
      target.src = url;
    }
  }

  function navigate(html: string): void {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const previous = blobUrl;
    blobUrl = url;
    loading = true;

    if (frame) point(frame, url);

    if (previous) URL.revokeObjectURL(previous);
  }

  /**
   * A NEW element is a blank frame, and nothing else here would ever fill it.
   *
   * `Viewport` renders the iframe, so the element's identity is not this component's to
   * control: anything that remounts it — a hot update during development today, a
   * conditional inside the viewport tomorrow — hands us a fresh `about:blank` while the
   * rebuild effect below sits quiet, because the config it watches has not changed. One
   * white rectangle and the preview looks dead.
   *
   * So: whenever the element changes, point it back at the document we already built.
   * `blobUrl` is a plain variable, not `$state`, which is exactly what makes this safe —
   * the effect depends on the ELEMENT alone and cannot re-run itself by reading the URL
   * that `navigate` has just written.
   */
  $effect(() => {
    const target = frame;
    if (target && blobUrl) point(target, blobUrl);
  });

  $effect(() => {
    // Tracked, and read before the branch so the dependency set is the same either way.
    const key = configKey;
    const nextTheme = previewTheme;

    if (idle) {
      pending = false;
      return;
    }

    // Untracked: the callbacks and the timing. A parent passing an inline arrow for
    // `generate` would otherwise re-run this effect on every one of its own renders —
    // including the render caused by `ongenerated`, which is a loop.
    const build = untrack(() => generate);
    const emit = untrack(() => ongenerated);
    const wait = untrack(() => (firstBuild ? 0 : debounceMs));

    if (!firstBuild) pending = true;

    const timer = setTimeout(() => {
      firstBuild = false;
      pending = false;

      // Parsed back from the very string this effect tracked: a detached, plain snapshot.
      // The store is never handed to the generator, and never mutated.
      const shipConfig = JSON.parse(key) as SpaceConfig;
      const previewConfig: SpaceConfig =
        nextTheme === shipConfig.theme ? shipConfig : { ...shipConfig, theme: nextTheme };

      try {
        const previewSpace = build(previewConfig);
        // Identical objects unless the theme is overridden — one build in the common case.
        const shipSpace = previewConfig === shipConfig ? previewSpace : build(shipConfig);
        failure = null;
        emit?.(shipSpace);
        navigate(previewSpace.indexHtml);
      } catch (cause) {
        loading = false;
        failure = cause instanceof Error ? cause.message : String(cause);
      }
    }, wait);

    return () => clearTimeout(timer);
  });

  // One blob URL is alive at a time; the last one goes with the component.
  $effect(() => () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = null;
  });
</script>

<div class="preview">
  {#if idle}
    <div class="preview__empty">
      <span class="preview__standby" aria-hidden="true">{t.preview.standby}</span>
      <p class="preview__empty-title">{t.preview.emptyTitle}</p>
      <p class="preview__empty-body">{t.preview.emptyBody}</p>
    </div>
  {:else}
    <!-- The frame is rendered by `Viewport` and bound back up to here: this component
         navigates it, that one sizes it. Neither can reach `SpaceConfig`. -->
    <Viewport
      bind:frame
      {sandbox}
      {busy}
      title={t.preview.frameTitle}
      allow="clipboard-write"
      onload={() => (loading = false)}
    >
      {#if failure}
        <div class="preview__failure" role="alert">
          <p class="preview__failure-title">{t.preview.failureTitle}</p>
          <p class="preview__failure-body">{failure}</p>
        </div>
      {/if}
    </Viewport>
  {/if}

  <!-- Always present, so the live region is not created at the moment it has to speak. -->
  <p class="preview__status" class:is-busy={busy} aria-live="polite">
    {busy ? t.preview.updating : ''}
  </p>
</div>

<style>
  /* Behind the glass. The pane paints the void and the frame's own shadow is drawn by
     the shell, so this component only owns what is inside the canopy. */
  .preview {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
    background: var(--void, #0f0d14);
  }

  /* The one thing this component still draws on the glass: a state, not a measurement.
     The measurement is the viewport's, and it lives in the viewport's own strip.
     Monospace and tabular, so the pill does not shuffle its width as it appears. */
  .preview__status {
    position: absolute;
    margin: 0;
    padding: 0.2rem 0.5rem;
    border-radius: 999px;
    font-family: var(--font-data, ui-monospace, monospace);
    font-size: var(--text-2xs, 0.6875rem);
    font-variant-numeric: tabular-nums;
    line-height: 1.4;
    letter-spacing: 0.02em;
    background: color-mix(in srgb, var(--void, #0f0d14) 82%, transparent);
    color: var(--ink-dim, #a79fb5);
    border: 1px solid var(--seam, #322a40);
    pointer-events: none;
  }

  /* The one live thing on the glass: something is being rebuilt behind it. */
  .preview__status.is-busy {
    border-color: color-mix(in srgb, var(--thruster, #ff3e00) 55%, transparent);
    color: var(--ink, #ece8f1);
  }

  /* Bottom right, not top right: the top of this pane is the viewport's instrument
     strip now, and a floating pill over a row of buttons is a pill over a button. */
  .preview__status {
    inset-block-end: 0.5rem;
    inset-inline-end: 0.5rem;
    opacity: 0;
    transition: opacity 0.18s ease;
  }

  .preview__status.is-busy {
    opacity: 1;
  }

  .preview__empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    padding: 2rem;
    text-align: center;
  }

  /*
   * An instrument with nothing to display says so in words, not with a picture.
   *
   * This used to be the Space's own emoji at 2.5rem — a colour cartoon of a flying
   * saucer, sitting a few hundred pixels from a flying saucer drawn in hairlines and
   * punctuation. The product's whole mark is typography that became a face; an emoji
   * beside it undoes that in one glyph. So: an etched readout, the same small-caps the
   * rest of the cockpit labels its gauges with, and no image anywhere on the page.
   */
  .preview__standby {
    padding: 0.2rem 0.6rem;
    border: 1px solid var(--seam, #322a40);
    border-radius: 999px;
    margin-block-end: 0.65rem;
    font-family: var(--font-data, ui-monospace, monospace);
    font-size: var(--text-2xs, 0.6875rem);
    letter-spacing: var(--track-etched, 0.14em);
    text-transform: uppercase;
    color: var(--ink-dim, #a79fb5);
  }

  /* The glass before there is anything to see through it. Display face, because an
     empty windshield is still part of the ship and not a placeholder card. */
  .preview__empty-title {
    margin: 0;
    font-family: var(--font-display, Georgia, 'Times New Roman', serif);
    font-size: var(--text-lg, 1.125rem);
    font-weight: 400;
    letter-spacing: 0.01em;
    color: var(--ink, #ece8f1);
  }

  .preview__empty-body {
    margin: 0;
    max-width: 26rem;
    color: var(--ink-dim, #a79fb5);
    font-size: var(--text-md, 0.875rem);
    line-height: 1.5;
    text-wrap: pretty;
  }

  /* A failure is a warning light on the panel: the raised surface, and the live colour
     on the edge that faces the reader. */
  .preview__failure {
    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);
    max-width: 28rem;
    padding: 1rem 1.1rem;
    border: 1px solid var(--seam, #322a40);
    border-inline-start: 3px solid var(--thruster, #ff3e00);
    border-radius: var(--space-radius, 12px);
    background: var(--hull-lit, #241f2e);
    color: var(--ink, #ece8f1);
  }

  .preview__failure-title {
    margin: 0 0 0.35rem;
    font-weight: 600;
  }

  .preview__failure-body {
    margin: 0;
    font-family: var(--font-data, ui-monospace, monospace);
    font-size: var(--text-sm, 0.8125rem);
    line-height: 1.5;
    color: var(--ink-dim, #a79fb5);
    overflow-wrap: anywhere;
  }

  @media (prefers-reduced-motion: reduce) {
    .preview__status {
      transition: none;
    }
  }
</style>
