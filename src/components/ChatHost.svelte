<script lang="ts">
  /**
   * The chat, with its Svelte 4 events kept in one leaf.
   *
   * `@aparte/svelte`'s `<AparteChat>` dispatches through `createEventDispatcher`, so a
   * consumer listens with `on:messagesChange` — the shape its docs show. That API is
   * deprecated in Svelte 5 and removed in Svelte 6, so it is worth having in exactly one
   * file rather than in the app's largest one. The app talks to this through plain
   * callback props, and the day the wrapper gains `onmessagesChange` this component
   * becomes a two-line delete.
   *
   * A correction, since an earlier version of this comment said otherwise: `on:` does
   * NOT disable runes. It was measured — a minimal component with `on:messagesChange`
   * and a `$state` mounts fine on Svelte 5.57, and so does the real app. The
   * `store_invalid_shape` crash that led here came from a stale Vite dependency cache
   * while several agents were rewriting these files, not from the directive.
   * See apartejs/aparte#46.
   */
  import { AparteChat } from '@aparte/svelte';
  import type { AparteChatImperativeApi, AparteMessage } from '@aparte/svelte';

  export let messages: AparteMessage[] = [];
  export let placeholder = '';
  export let centerWhenEmpty = false;
  /** Bound by the parent, so it keeps the imperative API. */
  export let component: AparteChatImperativeApi | null = null;

  export let onmessages: (messages: AparteMessage[]) => void = () => {};
  export let ontyping: (typing: boolean) => void = () => {};
</script>

<AparteChat
  bind:this={component}
  {messages}
  {placeholder}
  {centerWhenEmpty}
  on:messagesChange={(event: CustomEvent<AparteMessage[]>) => onmessages(event.detail)}
  on:typingChange={(event: CustomEvent<boolean>) => ontyping(event.detail)}
>
  <svelte:fragment slot="empty-state">
    <slot name="empty-state" />
  </svelte:fragment>
</AparteChat>
