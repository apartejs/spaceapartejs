<script lang="ts">
  /**
   * The page: a scripted chat on the left, the Space it is building on the right.
   *
   * Everything here is wiring. The three modules under `src/lib` know nothing about each
   * other — the scenario asks for capabilities through a port, the generator is a pure
   * function, the hub layer is fetch and OAuth — and this file is the one place they meet,
   * plus the one place that knows there is a DOM.
   *
   * The shape comes from the library, not from CSS written here: `.aparte-app-shell` is
   * the grid (header above, `__main` in the rest), `<aparte-split>` is the seam, and the
   * chat sits IN the first pane — a pane contains a chat, a chat never contains a split.
   * There is no sidebar: v1 is one conversation, and a column listing it would be a
   * column listing one thing.
   *
   * Two ordering rules hold the aparté side together, and both are why registration
   * happens at the top of this script rather than in `onMount`:
   *
   * 1. The provider, the transport and the tools are registered BEFORE
   *    `createAparteClient()` — the client reads the config as it starts.
   * 2. `registerAIProvider` auto-selects when it is handed the ONLY provider and that
   *    provider has exactly ONE model (verified in `AparteConfig.registerAIProvider`:
   *    `!hasSelectedModel() && size === 1 && models.length === 1`). The scenario provider
   *    ships exactly one model, so no `setModelConfig` call is needed here.
   */
  import JSZip from 'jszip';

  import { aparteGlobalConfig, AparteDirectTransport } from '@aparte/core';
  import { createAparteChat, createAparteClient } from '@aparte/svelte';
  import type { AparteChatImperativeApi, AparteMessage } from '@aparte/svelte';

  // The cockpit's own instrument panel for aparté's elicitations, and the sheet that
  // paints it. Imported here rather than in `main.ts` because the instruments only ever
  // exist inside this app shell — the generated Spaces ship the plain library.
  import './styles/instruments.css';
  import './styles/tool-rows.css';

  import { slugify } from './lib/config/space-config';
  import { installInstruments } from './lib/elicitation/instruments';
  import { installToolRenderers } from './lib/elicitation/tool-renderers';
  import { generateSpace } from './lib/generator/generate';
  import type { GeneratedFile, GeneratedSpace, PreviewTheme } from './lib/generator/types';
  import { scanModel } from './lib/hub/api';
  import { getSession, getToken, handleRedirect, pushSpace, signOut } from './lib/hub/oauth';
  import type { HubUser, ModelScan } from './lib/hub/types';
  import { initLang, lang } from './lib/i18n/store.svelte';
  import { uiCopy } from './lib/i18n/ui';
  import { startMascotFavicon } from './lib/mascotte/favicon';
  import { installMascotRenderers } from './lib/mascotte/renderers';
  import { mascotState, pilotFor } from './lib/mascotte/states';
  import type { SaucerState } from './lib/mascotte/states';
  import { copy } from './lib/scenario/copy';
  import { createConfigurator } from './lib/scenario/scenario';
  import type { ConfiguratorPort } from './lib/scenario/tools';
  import { config, patchConfig, preview, session } from './lib/stores/app-state.svelte';

  import ChatHost from './components/ChatHost.svelte';
  import FileTabs from './components/FileTabs.svelte';
  import Intro, { shouldPlayIntro } from './components/Intro.svelte';
  import Preview from './components/Preview.svelte';
  import PreviewBar from './components/PreviewBar.svelte';
  import Saucer from './components/Saucer.svelte';
  import SignIn from './components/SignIn.svelte';

  // ─── What the page holds that is not in a store ────────────────────────────

  /** The files behind the preview — the same bytes the zip and the push carry. */
  let files = $state<GeneratedFile[]>([]);
  /** The last shippable build. Kept out of `$state`: nothing renders it directly. */
  let latest: GeneratedSpace | null = null;
  /** The last zip handed to the browser — the only place its byte size exists. */
  let lastArchive: { name: string; bytes: number } | null = null;

  /** A network round trip is in flight; the ship sweeps its beam while one is. */
  let busy = $state<'scan' | 'push' | null>(null);
  /** The chat is writing. */
  let typing = $state(false);
  /** Something shipped: a zip saved, a Space live. Fades on its own. */
  let celebrating = $state(false);
  /** Something broke on OUR side of the wire; cleared by the next thing that works. */
  let failed = $state(false);
  let celebrationTimer: ReturnType<typeof setTimeout> | null = null;

  /** Which half of the right-hand pane is showing. */
  let pane = $state<'preview' | 'files'>('preview');
  /** Structurally typed rather than by component: all this file needs is `open()`. */
  let signInPanel = $state<{ open(): Promise<HubUser | null> } | null>(null);
  let chatComponent = $state<AparteChatImperativeApi | null>(null);

  // ─── The port: what the scenario borrows from the outside world ────────────

  function celebrate(): void {
    failed = false;
    celebrating = true;
    if (celebrationTimer) clearTimeout(celebrationTimer);
    celebrationTimer = setTimeout(() => (celebrating = false), 6000);
  }

  /**
   * Build from the CURRENT config, and remember the result.
   *
   * A plain spread rather than the `$state` proxy: the generator is pure and must never
   * be handed something that can change under it, or that it could write to.
   */
  function build(): GeneratedSpace {
    const space = generateSpace({ ...config });
    latest = space;
    files = space.files;
    return space;
  }

  /** What the zip and the push send: the last build, or a fresh one if none exists. */
  function shippable(): GeneratedSpace {
    return latest ?? build();
  }

  async function scan(id: string): Promise<ModelScan> {
    busy = 'scan';
    failed = false;
    try {
      // The token is passed so a private repo the signed-in user can read comes back as
      // 'found' rather than as the 401 branch.
      const result = await scanModel(id, getToken() ?? undefined);
      session.scan = result;
      return result;
    } finally {
      busy = null;
    }
  }

  /**
   * Open the generated page in a real tab.
   *
   * The preview frame is sandboxed without `allow-same-origin` so it can never reach the
   * localStorage where a signed-in user's Hugging Face token sits — and that same
   * sandbox makes Cache Storage throw, so Transformers.js cannot download weights in
   * there. A tab has a normal origin: the model loads, caches and answers exactly as it
   * will once the page is a Space.
   */
  function openPreviewInTab(): void {
    const space = shippable();
    const blob = new Blob([space.indexHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    // Late, so the new tab has finished reading it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function downloadZip(): Promise<string> {
    const space = shippable();
    const zip = new JSZip();
    for (const file of space.files) zip.file(file.path, file.content);
    const blob = await zip.generateAsync({ type: 'blob' });
    lastArchive = { name: `${slugify(config.title) || 'aparte-space'}.zip`, bytes: blob.size };

    const name = `${slugify(config.title) || 'aparte-space'}.zip`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    // Appended rather than clicked detached: Firefox ignores a click on an anchor that
    // is not in the document.
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Revoked late: revoking it in the same task cancels the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);

    celebrate();
    return name;
  }

  async function push(name: string): Promise<string> {
    busy = 'push';
    try {
      const result = await pushSpace(shippable().files, { repoName: name });
      session.spaceUrl = result.spaceUrl;
      celebrate();
      return result.spaceUrl;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      busy = null;
    }
  }

  /**
   * A sign-in, asked for by the script.
   *
   * The panel, never an elicitation: a token is a secret and the transcript is not the
   * place for one. An already-valid session answers without asking anything.
   */
  async function signIn(): Promise<HubUser | null> {
    const existing = getSession();
    if (existing) {
      session.user = existing.user;
      return existing.user;
    }
    const user = (await signInPanel?.open()) ?? null;
    if (user) session.user = user;
    return user;
  }

  const port: ConfiguratorPort = {
    getConfig: () => config,
    patchConfig,
    scan,
    generate: build,
    download: downloadZip,
    push,
    getUser: () => session.user,
    signIn,
  };

  // ─── Language: guessed now, ASKED in the first question of the script ──────

  /**
   * The opening language, before anyone has chosen.
   *
   * Called here rather than in `onMount` for the same reason the provider is registered
   * here: it writes `document.documentElement.lang` and swaps aparté's own 88 UI strings,
   * and a locale that arrives after the first render is a locale the first render never
   * saw. It is a GUESS from `navigator.languages` and nothing more — the scenario still
   * asks, in English, as its first question, and `setLang()` has the last word.
   */
  initLang();

  /**
   * Every word of the chrome, in the language of the moment.
   *
   * `lang.current` is read inside a `$derived`, which is what subscribes this component:
   * `setLang('fr')` re-runs it and the header, the switches, the empty state and every
   * `aria-label` below change together. Nothing is pushed, and nothing re-mounts.
   */
  const t = $derived(uiCopy(lang.current));

  // ─── aparté: provider, transport, tools, then the client ───────────────────

  const { provider, tools, maxTurns, toolTimeoutMs } = createConfigurator(port);

  // The panel before the client, for the same reason the provider is: a renderer that
  // arrives after the first elicitation is a renderer the first elicitation never saw.
  installInstruments();

  /* The scenario's steps are real tools, so the transcript is full of their rows — and
     a row is what the reader looks at most. These renderers turn each one into a
     readout: what the scan found, which files were written and how big they are, the
     Space that went live. The two getters exist because no tool result carries a byte
     count: the files and the archive are measured here, and read at render time so a
     row always shows the build it belongs to. */
  installToolRenderers({
    files: () => files,
    archive: () => lastArchive,
  });

  aparteGlobalConfig.registerAIProvider(provider);
  aparteGlobalConfig.setTransport(new AparteDirectTransport({ byok: true }));
  for (const tool of tools) aparteGlobalConfig.registerTool(tool.definition, tool.handler);
  // With a client mounted these do something; without one they are dead buttons, which
  // is why they ship off. A retry here replays a branch — the scenario is built for it.
  aparteGlobalConfig.setBubbleActions({ retry: true, edit: true });

  const chat = createAparteChat();
  const { messages } = chat;
  // The caps the configurator needs: eight provider calls on the longest branch, and a
  // tool that is "running" for as long as a person is deciding.
  createAparteClient({ maxTurns, toolTimeoutMs });

  $effect(() => {
    chat.connect(chatComponent);
  });

  // ─── The ship's mood ───────────────────────────────────────────────────────

  /**
   * One state, read from what the chat is actually doing. Order is a priority: a failure
   * outranks a celebration, a network call outranks the typewriter, and "waiting" is
   * simply "a conversation exists and nothing is moving" — which is true both while a
   * question is on screen and while we are waiting for someone to type.
   */
  const saucer = $derived<SaucerState>(
    failed
      ? 'error'
      : celebrating
        ? 'liftoff'
        : busy !== null
          ? 'scanning'
          : typing
            ? 'streaming'
            : $messages.length > 0
              ? 'waiting'
              : 'idle',
  );

  // The favicon follows the page-wide mood, and the mood follows the ship. aparté's own
  // renderers nudge the same store when a status line or an error is drawn; those nudges
  // are transient by design and the next change here has the last word.
  $effect(() => {
    mascotState.set(pilotFor(saucer));
  });

  $effect(() => {
    const renderers = installMascotRenderers();
    const favicon = startMascotFavicon();
    return () => {
      renderers();
      favicon();
    };
  });

  // ─── Boot: the OAuth round trip, and the session we may already have ───────

  $effect(() => {
    let live = true;
    void (async () => {
      const outcome = await handleRedirect();
      if (!live) return;
      // Destructured, and the error SAID: a refusal on the Hub's consent screen used to
      // come back as a silent null and looked like a click that never happened.
      if (outcome.session) session.user = outcome.session.user;
      if (outcome.error) session.notice = outcome.error.message;
    })();
    return () => {
      live = false;
    };
  });

  $effect(() => () => {
    if (celebrationTimer) clearTimeout(celebrationTimer);
  });

  // ─── The seam's position, which the element does not store ─────────────────

  const SPLIT_KEY = 'aparte-spaces:split-position';

  function storedSplit(): string {
    try {
      return localStorage.getItem(SPLIT_KEY) ?? '42';
    } catch {
      return '42';
    }
  }

  /** Read once: re-reading it during the session would fight the person dragging it. */
  const splitPosition = storedSplit();

  let splitElement = $state<HTMLElement | null>(null);

  /**
   * The element stores nothing: `position` goes in, one `aparte-split-resize` comes out
   * when the position SETTLES (never during a drag), and persistence is the host's.
   *
   * Listened for imperatively rather than in the markup: `HTMLElementEventMap` is
   * augmented by `@aparte/core`, so `event.detail.position` is typed here — and the
   * template's `on:` form would be the old event syntax in a component that uses the new
   * one everywhere else, which Svelte 5 refuses outright.
   */
  $effect(() => {
    const element = splitElement;
    if (!element) return;
    const remember = (event: HTMLElementEventMap['aparte-split-resize']): void => {
      try {
        localStorage.setItem(SPLIT_KEY, String(event.detail.position));
      } catch {
        // Storage disabled: the seam still moves, it just does not remember.
      }
    };
    element.addEventListener('aparte-split-resize', remember);
    return () => element.removeEventListener('aparte-split-resize', remember);
  });

  /**
   * Which pane is on screen while the split is stacked — mirrored, not owned.
   *
   * The `[data-aparte-split-pane]` buttons are handled by a document-level listener in
   * the element itself, so nothing here is told when one is pressed; the element
   * reflects the answer onto its own `pane` attribute instead (and removes it entirely
   * above the breakpoint, where both panes are visible and neither button means
   * anything). Observing that attribute is what lets the two buttons carry a real
   * `aria-pressed` rather than being a toggle that never says which way it is set.
   */
  let visiblePane = $state<'start' | 'end'>('start');

  $effect(() => {
    const element = splitElement;
    if (!element) return;
    const sync = (): void => {
      visiblePane = element.getAttribute('pane') === 'end' ? 'end' : 'start';
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(element, { attributes: true, attributeFilter: ['pane'] });
    return () => observer.disconnect();
  });

  // ─── Small helpers for the markup ──────────────────────────────────────────

  function onSignOut(): void {
    signOut();
    session.user = null;
  }

  /**
   * The pane waits until the conversation has decided something — not until there is a
   * model. A Space published before its model exists is a supported outcome, and it has
   * a page worth showing: the one that says where to put the MODEL_ID variable. `title`
   * is written by the scenario's own defaults the moment the look is settled, so it is
   * the honest signal that there is something to render.
   */
  const previewIdle = $derived(!config.modelId && !config.title);

  /**
   * There is one ship.
   *
   * The arrival flies a saucer down the middle of the viewport; the empty state keeps one
   * in the middle of the chat pane. Both were on screen at once for two seconds — the
   * veil is translucent by the end and the second ship sat right behind the first, a
   * hundred pixels to its left. Two saucers is a mascot parade, and it is the one thing
   * this page is not allowed to be.
   *
   * So the cockpit's ship waits for the arrival to finish and then fades up in its own
   * place. Read once, at init, and deliberately not reactive: `Intro` marks the session
   * as played from its own effect, which runs after this.
   */
  let arriving = $state(shouldPlayIntro());
</script>

<div class="aparte-app-shell shell">
  <!-- The console strip. One line, 52px, and read left to right it is the ship's own
       status: who is flying, what this is, what it is flying around, who is aboard. -->
  <header class="aparte-app-header shell__header">
    <Saucer state={saucer} size={34} class="shell__saucer" />
    <span class="aparte-app-header__title shell__title">
      <span class="shell__name">Aparté Spaces</span>

      <!-- The readout is the one place the model id belongs in the chrome: monospace,
           lit, and with an etched label so it needs no tooltip to be understood. It
           replaces the tagline the moment there is something to read out — a cockpit
           does not keep a slogan on a gauge it needs. -->
      {#if config.modelId}
        <span class="shell__readout">
          <span class="shell__diode" class:is-live={busy !== null} aria-hidden="true"></span>
          <span class="shell__readout-label">{t.header.modelLabel}</span>
          <span class="shell__readout-value">{config.modelId}</span>
        </span>
      {:else}
        <span class="shell__subtitle">{t.header.tagline}</span>
      {/if}
    </span>

    <div class="aparte-app-header__actions">
      {#if session.spaceUrl}
        <a
          class="aparte-btn aparte-btn--sm aparte-btn--surface shell__live"
          href={session.spaceUrl}
          target="_blank"
          rel="noreferrer noopener">{t.header.openSpace}</a
        >
      {/if}

      <!-- STATE, never an action: signing in is a decision, and decisions belong in the
           chat, where the script asks for one at the moment it needs it. The header only
           says who you are, and offers the way out. -->
      {#if session.user}
        <span class="shell__user" title={t.header.signedIn}>{session.user.name}</span>
        <button class="aparte-btn aparte-btn--sm aparte-btn--ghost" type="button" onclick={onSignOut}>
          {t.header.signOut}
        </button>
      {/if}

      <!-- The other half of the loop. Every generated Space carries "Made with aparté"
           pointing here; here it points at the library. A visitor can walk the whole
           circle without being sold anything. -->
      <a
        class="shell__made"
        href="https://apartejs.dev"
        target="_blank"
        rel="noreferrer noopener"
        title={t.header.madeWith}
      >
        <!-- The mark itself is never translated: it is a signature, and a signature that
             changes with the interface language is not a signature. -->
        <span class="shell__made-face" aria-hidden="true">('.')</span>
        <span class="shell__made-text">Made with aparté</span>
      </a>

      <!-- Under the split's breakpoint these switch the visible pane; above it they
           change nothing on screen, so the same media query hides the group. The
           element handles the click itself, from the document; `aria-pressed` comes
           back from the `pane` attribute it reflects. -->
      <div class="aparte-btn-group shell__panes" role="group" aria-label={t.header.panesLabel}>
        <button
          class="aparte-btn aparte-btn--sm aparte-btn--surface"
          type="button"
          aria-pressed={visiblePane === 'start'}
          data-aparte-split-pane="start">{t.header.paneChat}</button
        >
        <button
          class="aparte-btn aparte-btn--sm aparte-btn--surface"
          type="button"
          aria-pressed={visiblePane === 'end'}
          data-aparte-split-pane="end">{t.header.panePreview}</button
        >
      </div>
    </div>
  </header>

  <!-- Inside `__main`, not beside it: the shell's grid has exactly two rows, and a third
       child here would take the `1fr` row away from the split. -->
  <main class="aparte-app-shell__main">
    {#if session.notice}
      <p class="shell__notice" role="status">
        {session.notice}
        <button
          class="aparte-btn aparte-btn--sm aparte-btn--ghost"
          type="button"
          onclick={() => (session.notice = null)}>{t.shell.dismiss}</button
        >
      </p>
    {/if}

    <aparte-split
      bind:this={splitElement}
      position={splitPosition}
      breakpoint="60rem"
      label={t.shell.splitLabel}
    >
      <!-- Not <AparteChat> directly: its Svelte 4 events would need `on:`, and one
           `on:` directive puts this whole file in legacy mode, where `$state(…)` stops
           being a rune. ChatHost quarantines that. See apartejs/aparte#46. -->
      <ChatHost
        bind:component={chatComponent}
        messages={$messages}
        placeholder={copy.entry.placeholder}
        centerWhenEmpty
        onmessages={(next: AparteMessage[]) => chat.onMessagesChange(next)}
        ontyping={(isTyping: boolean) => {
          typing = isTyping;
          if (isTyping) failed = false;
        }}
      >
        <!-- The thesis of the page, not filler. Before the first message this is the
             whole product: the ship, one sentence in the display face, and the
             composer directly under it. Nothing else is on screen, and nothing else
             needs to be — the invitation IS the interface. -->
        <div class="entry" slot="empty-state">
          <div class="entry__ship" class:is-waiting={arriving}>
            <Saucer state={saucer} size="min(46vmin, 208px)" />
          </div>
          <p class="entry__lede">{t.shell.lede}</p>
          <p class="entry__text">{copy.entry.emptyState}</p>
        </div>
      </ChatHost>

      <section class="aparte-split__pane pane">
        <div class="pane__bar">
          <!-- No `size` any more: the viewport owns it, one bar lower, where it can be
               honest about the number. This strip keeps what is true of the whole pane. -->
          <PreviewBar
            theme={preview.theme}
            shipTheme={config.theme}
            onthemechange={(next: PreviewTheme) => (preview.theme = next)}
            onopentab={openPreviewInTab}
          />
          <div class="pane__switch">
            <span class="pane__label" aria-hidden="true">{t.shell.viewLabel}</span>
            <div class="aparte-btn-group" role="group" aria-label={t.shell.viewGroup}>
              <button
                class="aparte-btn aparte-btn--sm aparte-btn--surface"
                type="button"
                aria-pressed={pane === 'preview'}
                onclick={() => (pane = 'preview')}>{t.shell.viewPreview}</button
              >
              <button
                class="aparte-btn aparte-btn--sm aparte-btn--surface"
                type="button"
                aria-pressed={pane === 'files'}
                onclick={() => (pane = 'files')}>{t.shell.viewFiles}</button
              >
            </div>
          </div>
        </div>

        <!-- Both stay mounted: unmounting the preview would throw away its frame and
             re-download nothing, but it would flash a rebuild on every toggle. -->
        <div class="pane__body">
          <div class="pane__slot" class:is-hidden={pane !== 'preview'}>
            <Preview
              {config}
              generate={generateSpace}
              theme={preview.theme}
              idle={previewIdle}
              isolated
              ongenerated={(space: GeneratedSpace) => {
                latest = space;
                files = space.files;
              }}
            />
          </div>
          <div class="pane__slot" class:is-hidden={pane !== 'files'}>
            <FileTabs {files} />
          </div>
        </div>
      </section>
    </aparte-split>
  </main>
</div>

<SignIn
  bind:this={signInPanel}
  user={session.user}
  onsignedin={(user: HubUser) => (session.user = user)}
/>

<!-- Mounted unconditionally: it decides for itself whether there is an arrival to play
     (once per session, never under prefers-reduced-motion) and renders nothing when
     there is not. Unmounting it from its own `onDone` would be a component removing
     itself from inside its own effect. -->
<Intro onDone={() => (arriving = false)} />

<style>
  /*
   * The cockpit's shell.
   *
   * Three surfaces and one line, and the whole page is built from them: the VOID is
   * what the ship flies over (the page ground and, behind the glass, the windshield),
   * the HULL is a panel, the RAISED HULL is anything the hand touches, and the SEAM is
   * the hairline where two panels meet. Nothing here invents a colour; every value is a
   * token from `tokens.css`.
   *
   * Fallbacks are kept on every `var()` for the same reason they were there before: this
   * file must render if the token sheet ever fails to load before it.
   */

  .shell {
    height: 100%;
    background: var(--void, #0f0d14);
  }

  /* ── The console strip ─────────────────────────────────────────────────────
     One line, 52px, and a lit hairline under it rather than a grey one: it is
     the bezel between the console and the glass, and it is the only place in the
     chrome where the gold is allowed to run the full width. */

  .shell__header {
    gap: 0.55rem;
    padding-inline: 0.75rem;
    border-block-end: 1px solid var(--seam, #322a40);
    background: var(--hull, #1a1622);
    box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--thruster, var(--thruster, #ff3e00)) 12%, transparent);
  }

  .shell__title {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    min-width: 0;
  }

  /* The display face, at its one job: the product's name. It is set in a serif so
     the two mono readouts either side of it read as instruments and not as prose. */
  .shell__name {
    flex: none;
    font-family: var(--font-display, Georgia, 'Times New Roman', serif);
    font-size: var(--text-title, 1.25rem);
    font-weight: 400;
    line-height: 1.1;
    letter-spacing: 0.01em;
    color: var(--thruster, var(--thruster, #ff3e00));
  }

  .shell__subtitle {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm, 0.8125rem);
    color: var(--ink-dim, #a79fb5);
  }

  /* ── The model readout ─────────────────────────────────────────────────────
     A gauge: a bezel, a diode, an etched label, and the value in the data face.
     The value is what the Hub owns, so it is monospace — that is the page saying
     "this is a literal, and it is exactly what you typed". */

  .shell__readout {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
    padding: 0.15rem 0.55rem;
    border: 1px solid color-mix(in srgb, var(--thruster, var(--thruster, #ff3e00)) 26%, transparent);
    border-radius: 999px;
    background: var(--hull-lit, #241f2e);
  }

  .shell__diode {
    flex: none;
    inline-size: 6px;
    block-size: 6px;
    border-radius: 50%;
    background: var(--thruster, var(--thruster, #ff3e00));
    /* Off is not dark, it is dim: an unlit diode is still a diode. */
    opacity: 0.5;
    transition: background-color var(--tick, 180ms) ease, opacity var(--tick, 180ms) ease;
  }

  /* Lit while a round trip is in flight — the one moment the console has news. */
  .shell__diode.is-live {
    background: var(--thruster, #ff3e00);
    opacity: 1;
    animation: diode-pulse 1.1s ease-in-out infinite;
  }

  @keyframes diode-pulse {
    0%, 100% { opacity: 0.45; }
    50% { opacity: 1; }
  }

  .shell__readout-label {
    flex: none;
    font-size: var(--text-2xs, 0.6875rem);
    letter-spacing: var(--track-etched, 0.14em);
    text-transform: uppercase;
    color: var(--ink-dim, #a79fb5);
  }

  .shell__readout-value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-data, ui-monospace, monospace);
    font-size: var(--text-xs, 0.75rem);
    color: var(--thruster-lit, var(--thruster-lit, #ff5c26));
  }

  /* The ship is the pilot's seat in the strip — small, and never a reason to grow
     the row. */
  .shell :global(.shell__saucer) {
    flex: none;
  }

  /* The badge is quiet by default and warms on hover: it is a signature, not a call
     to action, and the header has no other ornament. */
  .shell__made {
    display: inline-flex;
    align-items: baseline;
    gap: 0.4rem;
    padding: 0.15rem 0.5rem;
    border-radius: var(--space-radius-sm, 8px);
    color: var(--ink-dim, #a79fb5);
    font-size: var(--text-2xs, 0.6875rem);
    text-decoration: none;
    white-space: nowrap;
    transition: color var(--tick, 180ms) ease;
  }

  .shell__made:hover,
  .shell__made:focus-visible {
    color: var(--brass-lit, #e7c588);
  }

  .shell__made-face {
    font-family: var(--font-display, Georgia, serif);
    font-size: var(--text-sm, 0.8125rem);
    color: var(--brass, #d9a24b);
  }

  @media (max-width: 40rem) {
    /* On a phone the header keeps the identity and drops the sentence. */
    .shell__made-text {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .shell__made {
      transition: none;
    }
  }

  .shell__user {
    max-width: 12ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-data, ui-monospace, monospace);
    font-size: var(--text-xs, 0.75rem);
    color: var(--ink-dim, #a79fb5);
  }

  /* A Space that is live is the one thing in the strip worth a brass edge. */
  .shell :global(.shell__live) {
    border-color: color-mix(in srgb, var(--thruster, var(--thruster, #ff3e00)) 45%, transparent);
    color: var(--thruster-lit, var(--thruster-lit, #ff5c26));
  }

  /* ── The notice rail ───────────────────────────────────────────────────────
     A rate limit or an offline moment is not an error page; it is a line on the
     console with a lit edge. */

  .shell__notice {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0;
    padding: 0.5rem 0.9rem;
    border-block-end: 1px solid var(--seam, #322a40);
    border-inline-start: 3px solid var(--thruster, var(--thruster, #ff3e00));
    background: var(--hull-lit, #241f2e);
    color: var(--ink, #ece8f1);
    font-size: var(--text-sm, 0.8125rem);
  }

  /* ── The spine ─────────────────────────────────────────────────────────────
     The seam between the console and the glass, and the one structural line of
     the page. A channel, not a bar: two hairlines with the void between them, and
     a lit vertebra in the middle that is the thing the hand aims at. It lights
     in the thruster colour while it is being dragged, which is the palette's rule
     — orange means live — applied to the only control that moves the layout. */

  .shell :global(.aparte-split__handle),
  .shell :global(.aparte-split__handle:hover),
  .shell :global(.aparte-split__handle[data-dragging]) {
    background:
      linear-gradient(
        to right,
        var(--seam, #322a40) 0 1px,
        var(--void, #0f0d14) 1px calc(100% - 1px),
        var(--seam, #322a40) calc(100% - 1px) 100%
      );
  }

  .shell :global(.aparte-split__handle)::before {
    content: '';
    position: absolute;
    inset-inline: 2px;
    inset-block-start: calc(50% - 17px);
    block-size: 34px;
    border-radius: 999px;
    background: var(--thruster, var(--thruster, #ff3e00));
    opacity: 0.55;
    transition:
      opacity var(--tick, 180ms) ease,
      background-color var(--tick, 180ms) ease;
  }

  .shell :global(.aparte-split__handle:hover)::before,
  .shell :global(.aparte-split__handle:focus-visible)::before,
  .shell :global(.aparte-split__handle[data-dragging])::before {
    background: var(--thruster, #ff3e00);
    opacity: 1;
  }

  /* ── The empty state: the thesis ───────────────────────────────────────────
     The ship, one sentence, the composer. The lede is the only place outside the
     header where the display face speaks, and it is sized off the viewport so it
     is a headline at 375px and a headline at 1600px. */

  .entry {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.9rem;
    padding: 1rem 1.25rem 0.5rem;
    text-align: center;
  }

  /* The ship takes the arrival's place rather than sharing the screen with it. The
     fade is longer than the shell's `--tick` on purpose: this is the only handover in
     the product, and a 180ms one would read as a flicker. */
  .entry__ship {
    width: 100%;
    display: flex;
    justify-content: center;
    transition: opacity 420ms ease 120ms;
  }

  .entry__ship.is-waiting {
    opacity: 0;
    transition: none;
  }

  .entry__lede {
    margin: 0;
    max-width: 20ch;
    font-family: var(--font-display, Georgia, 'Times New Roman', serif);
    font-size: var(--text-hero, 2.25rem);
    font-weight: 400;
    line-height: 1.08;
    letter-spacing: 0.01em;
    /* Ink, not brass: the sentence is the product speaking, and gold on this scale
       would turn a thesis into a logotype. */
    color: var(--ink, #ece8f1);
    text-wrap: balance;
  }

  .entry__text {
    margin: 0;
    max-width: 34rem;
    /* The copy is written with its own line breaks; they are the shape of the
       invitation. */
    white-space: pre-line;
    font-size: var(--text-md, 0.875rem);
    line-height: 1.6;
    color: var(--ink-dim, #a79fb5);
    text-wrap: pretty;
  }

  /* ── The windshield ────────────────────────────────────────────────────────
     The right pane is the glass the ship is building through. The bar above it is
     the instrument strip; the body is the view. */

  .pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--hull, #1a1622);
  }

  .pane__bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 0.75rem;
    flex-wrap: wrap;
    /* The whole row's gutters live here, so a wrapped line still starts on the
       panel's own margin instead of at the pane's edge. */
    padding: 0.5rem 0.75rem;
    border-block-end: 1px solid var(--seam, #322a40);
    background: var(--hull, #1a1622);
  }

  .pane__switch {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  /* Etched, like every label in this cockpit: uppercase, tracked out, and small
     enough that it names the control without competing with it. */
  .pane__label {
    font-size: var(--text-2xs, 0.6875rem);
    letter-spacing: var(--track-etched, 0.14em);
    text-transform: uppercase;
    color: var(--ink-dim, #a79fb5);
  }

  .pane__body {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    background: var(--void, #0f0d14);
  }

  /*
   * The glass itself: a brass hairline all the way round, and the light falling off
   * at the top and bottom edges the way it does inside a canopy. Purely an overlay —
   * `pointer-events: none` and no background wash, because whatever theme the
   * generated Space ships with has to come through this pane HONESTLY. Tinting the
   * preview would make the windshield a liar.
   */
  .pane__body::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--thruster, var(--thruster, #ff3e00)) 13%, transparent),
      inset 0 24px 40px -28px rgb(0 0 0 / 0.9),
      inset 0 -24px 40px -28px rgb(0 0 0 / 0.9);
  }

  .pane__slot {
    position: absolute;
    inset: 0;
  }

  .pane__slot.is-hidden {
    display: none;
  }

  /* ── Responsive ────────────────────────────────────────────────────────────
     One breakpoint is the split's own (60rem): below it the two panes stack and
     the header's Chat/Preview group becomes the only way to move between them.
     The second (44rem) is where the strip runs out of room, and it gives up the
     readout — the model id is on screen twice more, in the transcript and in the
     files — before it ever gives up the product's name. */

  .shell__panes {
    display: none;
  }

  @media (max-width: 60rem) {
    .shell__panes {
      display: inline-flex;
    }

    .shell__subtitle {
      display: none;
    }

    .shell__readout {
      max-width: 16ch;
    }
  }

  @media (max-width: 44rem) {
    .shell__header {
      gap: 0.4rem;
      padding-inline: 0.5rem;
    }

    .shell__name {
      font-size: var(--text-base, 1rem);
    }

    .shell__readout,
    .shell__user {
      display: none;
    }

    .entry {
      padding-inline: 0.75rem;
    }

    /* Same trade as the preview bar's own labels: the strip has to fit first. */
    .pane__label {
      display: none;
    }

    /* The strip wraps to three short rows on a phone; tightening the gaps is what
       keeps it a strip rather than a third of the screen. */
    .pane__bar {
      gap: 0.35rem 0.5rem;
      padding: 0.4rem 0.6rem;
    }
  }

  /* The armed control, everywhere in the shell.
     The palette has two colours and two jobs: BRASS is identity and structure — the
     name, the pilot, the bezels, the etched labels — and THRUSTER is what is live: the
     beam, a lit diode, the send button, and this. The product has ONE colour, and brass
     is not a second one: it is aparté's signature, kept for the "Made with aparté" mark
     alone. Scoped to the shell's own groups — the chat keeps the library's treatment. */
  .pane__switch :global(.aparte-btn[aria-pressed='true']),
  .shell__panes :global(.aparte-btn[aria-pressed='true']) {
    background: color-mix(in srgb, var(--thruster, #ff3e00) 15%, transparent);
    border-color: color-mix(in srgb, var(--thruster, #ff3e00) 65%, transparent);
    color: var(--thruster-lit, #ff5c26);
  }

  @media (prefers-reduced-motion: reduce) {
    .shell__diode.is-live {
      animation: none;
      opacity: 1;
    }
  }
</style>
