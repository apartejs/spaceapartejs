<script lang="ts">
  /**
   * The sign-in panel: the one place a Hugging Face credential is entered.
   *
   * It is deliberately NOT a question in the chat. `<aparte-elicitation>` has no secret
   * field — a token typed into it would be a plain string on its way through a tool
   * result and into the transcript — so the scenario's `port.signIn()` opens this dialog
   * instead and awaits it. The chat asks *whether* to sign in; the credential itself
   * never travels through the conversation.
   *
   * Two ways in, and the second is why this exists at all:
   *
   * - **OAuth**, when a client id is configured (`VITE_HF_CLIENT_ID`, or `OAUTH_CLIENT_ID`
   *   injected by the Hub when we are hosted as a Space). It leaves the page, so it is
   *   announced as such — the conversation does not survive the round trip.
   * - **A fine-grained token**, which needs no registered app and is the only route that
   *   works on `localhost` on day one.
   *
   * Imperative on purpose: `open()` returns a promise, because its caller is a tool
   * handler that is waiting on a person.
   */
  import { signIn as oauthSignIn, signInWithToken } from '../lib/hub/oauth';
  import type { HubUser } from '../lib/hub/types';
  import { lang } from '../lib/i18n/store.svelte';
  import { uiCopy } from '../lib/i18n/ui';

  interface Props {
    /** Shown in the panel so the user knows what they are already signed in as. */
    user?: HubUser | null;
    /** Called whenever a sign-in succeeds — the app writes it to the store. */
    onsignedin?: (user: HubUser) => void;
  }

  let { user = null, onsignedin }: Props = $props();

  /** Read through a `$derived`: the panel is long-lived, and it can be open across a switch. */
  const t = $derived(uiCopy(lang.current));

  let dialog = $state<HTMLDialogElement | null>(null);
  let token = $state('');
  let failure = $state<string | null>(null);
  let working = $state(false);

  /** Resolves the promise `open()` handed out. Null until the panel is open. */
  let settle: ((user: HubUser | null) => void) | null = null;

  /**
   * Is there an OAuth app for this origin?
   *
   * The same two sources `oauth.ts` reads, asked BEFORE the click: `signIn()` throws when
   * neither is set, and a button that always throws is worse than a button that is not
   * drawn.
   */
  const oauthReady = ((): boolean => {
    const hosted = (globalThis as { huggingface?: { variables?: Record<string, string | undefined> } })
      .huggingface?.variables?.['OAUTH_CLIENT_ID'];
    if (hosted) return true;
    try {
      return Boolean(import.meta.env['VITE_HF_CLIENT_ID']);
    } catch {
      return false;
    }
  })();

  /** Open the panel and wait for it. A second call while it is open reuses the promise. */
  export function open(): Promise<HubUser | null> {
    failure = null;
    token = '';
    const promise = new Promise<HubUser | null>((resolve) => {
      // Whoever was waiting is answered rather than left hanging: a tool handler holds
      // this promise, and an unresolved one stalls the run until the tool timeout.
      settle?.(null);
      settle = resolve;
    });
    dialog?.showModal();
    return promise;
  }

  function finish(result: HubUser | null): void {
    const resolve = settle;
    settle = null;
    // The token is dropped from component state as soon as it has been used; `oauth.ts`
    // owns the only copy that outlives this panel.
    token = '';
    working = false;
    dialog?.close();
    resolve?.(result);
  }

  async function useToken(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (working) return;
    working = true;
    failure = null;
    try {
      const session = await signInWithToken(token);
      onsignedin?.(session.user);
      finish(session.user);
    } catch (error) {
      working = false;
      failure = error instanceof Error ? error.message : String(error);
    }
  }

  async function useOAuth(): Promise<void> {
    if (working) return;
    working = true;
    failure = null;
    try {
      // Resolves only if the navigation does not happen; on success the browser leaves
      // and `handleRedirect()` picks the session up on the way back.
      await oauthSignIn();
    } catch (error) {
      working = false;
      failure = error instanceof Error ? error.message : String(error);
    }
  }
</script>

<dialog
  class="aparte-dialog aparte-dialog--sm signin"
  bind:this={dialog}
  aria-labelledby="signin-title"
  onclose={() => finish(null)}
  onclick={(event) => {
    // A click on the backdrop lands on the dialog element itself, never on its content.
    if (event.target === dialog) finish(null);
  }}
>
  <div class="aparte-dialog__header">
    <h2 class="aparte-dialog__title" id="signin-title">{t.signIn.title}</h2>
    <button
      class="aparte-btn aparte-btn--icon aparte-btn--sm aparte-dialog__close"
      type="button"
      aria-label={t.signIn.close}
      onclick={() => finish(null)}>×</button
    >
  </div>

  <div class="aparte-dialog__body">
    <!-- One sentence, not a label glued to a value: "Signed in as X" and "Connecté en tant
         que X" only happen to share a word order, and the next language will not. The name
         is emphasised by the line it is on rather than by a `<strong>` that would force the
         sentence to be cut in two. -->
    {#if user}
      <p class="signin__note">{t.signIn.signedInAs(user.name)}</p>
    {/if}

    <p class="signin__note">{t.signIn.why}</p>

    {#if oauthReady}
      <button
        class="aparte-btn aparte-btn--primary aparte-btn--solid aparte-btn--block"
        type="button"
        disabled={working}
        onclick={useOAuth}>{t.signIn.oauth}</button
      >
      <p class="signin__note signin__note--small">{t.signIn.oauthNote}</p>
      <p class="signin__or">{t.signIn.or}</p>
    {/if}

    <form class="signin__form" onsubmit={useToken}>
      <label class="signin__label" for="signin-token">{t.signIn.tokenLabel}</label>
      <input
        class="aparte-field"
        id="signin-token"
        type="password"
        autocomplete="off"
        spellcheck="false"
        placeholder="hf_…"
        bind:value={token}
        disabled={working}
      />
      <p class="signin__note signin__note--small">{t.signIn.tokenNote}</p>
      {#if failure}
        <p class="signin__failure" role="alert">{failure}</p>
      {/if}
      <div class="aparte-dialog__footer">
        <button class="aparte-btn aparte-btn--ghost" type="button" onclick={() => finish(null)}>
          {t.signIn.cancel}
        </button>
        <button
          class="aparte-btn aparte-btn--primary aparte-btn--solid"
          type="submit"
          disabled={working || token.trim() === ''}>{t.signIn.useToken}</button
        >
      </div>
    </form>
  </div>
</dialog>

<style>
  .signin__note {
    margin: 0 0 0.75rem;
    color: #a79fb5;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .signin__note--small {
    font-size: 0.8125rem;
  }

  .signin__or {
    margin: 0.9rem 0;
    text-align: center;
    color: #a79fb5;
    font-size: 0.8125rem;
  }

  .signin__form {
    display: block;
  }

  .signin__label {
    display: block;
    margin-block-end: 0.35rem;
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .signin__failure {
    margin: 0 0 0.5rem;
    color: var(--aparte-error, #e5484d);
    font-size: 0.8125rem;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
</style>
