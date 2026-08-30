<script module lang="ts">
  /** Ids have to be unique across instances; a counter is enough and needs no runtime. */
  let instances = 0;
</script>

<script lang="ts">
  /**
   * The bytes behind the preview: one tab per generated file, and a copy button.
   *
   * Read-only on purpose. This is where a user checks that the thing they are about to
   * push is a plain `index.html` they could have written themselves — the whole promise
   * of the product is that it is, so the file is shown, not summarised.
   */
  import type { GeneratedFile } from '../lib/generator/types';
  import { lang } from '../lib/i18n/store.svelte';
  import { uiCopy } from '../lib/i18n/ui';

  interface Props {
    /** Straight from `GeneratedSpace.files`. */
    files: GeneratedFile[];
    /** Controlled selection. Left out, the component keeps its own. */
    selected?: string | null;
    onselect?: (path: string) => void;
  }

  let { files, selected = null, onselect }: Props = $props();

  const base = `filetabs-${(instances += 1)}`;
  const panelId = `${base}-panel`;

  /** Read through a `$derived`, so a language switch redraws the tabs and the live region. */
  const t = $derived(uiCopy(lang.current));

  let internal = $state<string | null>(null);
  let copied = $state(false);
  /**
   * A FLAG, not the sentence.
   *
   * Storing the message would freeze whichever language was current when the copy failed,
   * and the failure sits on screen for 2.4 seconds — long enough to switch under it. The
   * state says what happened; the template says it in the language of the moment.
   */
  let copyFailed = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  let tablist = $state<HTMLDivElement | null>(null);

  const wanted = $derived(selected ?? internal);
  /** Falls back to the first file, so a mode change that drops `style.css` cannot strand us. */
  const active = $derived(files.find((file) => file.path === wanted) ?? files[0] ?? null);
  const activeIndex = $derived(active === null ? -1 : files.indexOf(active));

  function select(path: string): void {
    internal = path;
    onselect?.(path);
  }

  /**
   * The tab-list keyboard contract: one stop in the tab order, arrows inside it.
   *
   * Bound to each tab rather than to the list, because the list is not focusable and an
   * ARIA container with a key handler is a role its markup cannot honour.
   */
  function onkeydown(event: KeyboardEvent): void {
    if (activeIndex < 0 || files.length === 0) return;

    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (activeIndex + 1) % files.length;
        break;
      case 'ArrowLeft':
        next = (activeIndex - 1 + files.length) % files.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = files.length - 1;
        break;
      default:
        return;
    }

    const file = files[next];
    if (!file) return;
    event.preventDefault();
    select(file.path);
    tablist?.querySelectorAll<HTMLButtonElement>('.aparte-tabs__tab')[next]?.focus();
  }

  async function copy(): Promise<void> {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(active.content);
      copied = true;
      copyFailed = false;
    } catch {
      // No permission, no secure context, no clipboard API — all the same to the user:
      // the button did not do the thing, and selecting the text still works.
      copied = false;
      copyFailed = true;
    }
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied = false;
      copyFailed = false;
    }, 2400);
  }

  $effect(() => () => {
    if (copyTimer) clearTimeout(copyTimer);
  });

  function size(text: string): string {
    const bytes = new TextEncoder().encode(text).length;
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`;
  }
</script>

<div class="filetabs">
  {#if active}
    <div class="filetabs__head">
      <div
        class="aparte-tabs aparte-tabs--underline"
        role="tablist"
        aria-label={t.files.tabsLabel}
        bind:this={tablist}
      >
        {#each files as file, index (file.path)}
          <button
            type="button"
            class="aparte-tabs__tab"
            role="tab"
            id="{base}-tab-{index}"
            aria-selected={file.path === active.path}
            aria-controls={panelId}
            tabindex={file.path === active.path ? 0 : -1}
            onclick={() => select(file.path)}
            {onkeydown}
          >
            {file.path}
          </button>
        {/each}
      </div>

      <div class="filetabs__actions">
        <span class="filetabs__size">{size(active.content)}</span>
        <button
          type="button"
          class="aparte-btn aparte-btn--sm aparte-btn--surface"
          onclick={copy}
        >
          {copied ? t.files.copied : t.files.copy}
        </button>
      </div>
    </div>

    <div
      class="aparte-tabs__panel filetabs__panel"
      role="tabpanel"
      id={panelId}
      aria-labelledby="{base}-tab-{activeIndex}"
      tabindex="0"
    ><pre class="filetabs__code">{active.content}</pre></div>

    <p class="filetabs__status" aria-live="polite">
      {copied
        ? t.files.copiedStatus(active.path)
        : copyFailed
          ? t.files.copyFailed
          : ''}
    </p>
  {:else}
    <p class="filetabs__empty">{t.files.empty}</p>
  {/if}
</div>

<style>
  /* The bytes, on the void: a file listing is the most literal thing in the product,
     so it is shown on the darkest ground with nothing between it and the reader. */
  .filetabs {
    --aparte-text: var(--ink, #ece8f1);
    --aparte-text-muted: var(--ink-dim, #a79fb5);

    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
    background: var(--void, #0f0d14);
  }

  .filetabs__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding-inline: 0.75rem;
    border-block-end: 1px solid var(--seam, #322a40);
    background: var(--hull, #1a1622);
  }

  /* File names are what the Hub and the generator own, so the tabs are set in the data
     face like every other literal in the cockpit. */
  .filetabs :global(.aparte-tabs__tab) {
    font-family: var(--font-data, ui-monospace, monospace);
    font-size: var(--text-xs, 0.75rem);
  }

  .filetabs__actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .filetabs__size {
    font-family: var(--font-data, ui-monospace, monospace);
    font-size: var(--text-2xs, 0.6875rem);
    font-variant-numeric: tabular-nums;
    color: var(--ink-dim, #a79fb5);
  }

  /* The kit's panel is padded for prose; a code view wants its own gutters. */
  .filetabs__panel {
    flex: 1;
    min-height: 0;
    padding-block: 0;
    overflow: auto;
  }

  .filetabs__code {
    margin: 0;
    padding: 0.75rem;
    font-family: var(--font-data, ui-monospace, monospace);
    font-size: var(--text-xs, 0.75rem);
    line-height: 1.55;
    color: var(--ink, #ece8f1);
    /* Generated HTML has long lines. Scrolling them beats wrapping them: a wrapped tag
       stops looking like the file the user is about to ship. */
    white-space: pre;
    tab-size: 2;
  }

  .filetabs__status,
  .filetabs__empty {
    margin: 0;
    padding: 0.4rem 0.75rem;
    min-height: 1.6rem;
    border-block-start: 1px solid var(--seam, #322a40);
    background: var(--hull, #1a1622);
    font-size: var(--text-2xs, 0.6875rem);
    color: var(--ink-dim, #a79fb5);
  }

  .filetabs__empty {
    border-block-start: 0;
    background: none;
    padding: 1.25rem 0.75rem;
    font-size: var(--text-md, 0.875rem);
  }

  /* Selected-tab ink: the kit points it at `--aparte-primary-ink`, which this product
     maps to white-on-orange for solid buttons — not the colour a quiet underline wants. */
  .filetabs :global(.aparte-tabs__tab[aria-selected='true']) {
    color: var(--ink, #ece8f1);
    border-block-end-color: var(--thruster, var(--thruster, #ff3e00));
  }
</style>
