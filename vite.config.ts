import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  /*
   * ONE Svelte runtime, and it has to be said out loud.
   *
   * In dev, Vite pre-bundles dependencies; `@aparte/svelte` came out of that with its
   * own copy of the runtime inlined, so `onMount()` called inside `createAparteClient()`
   * looked for a component context the app's runtime was holding. First load after a
   * server start, in the console:
   *
   *   Svelte error: lifecycle_outside_component
   *   `onMount(...)` can only be used during component initialisation
   *
   * The library declares itself properly (a `svelte` export condition and published
   * `.svelte` files), so the plugin ought to leave it alone — it did not. Naming it here
   * is what actually keeps a single runtime, and `dedupe` guarantees the same for any
   * other path that resolves `svelte`.
   */
  resolve: { dedupe: ['svelte'] },
  optimizeDeps: { exclude: ['@aparte/svelte'] },
  build: {
    target: 'es2022',
    // The configurator ships as a static HF Space: one entry, hashed assets.
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    // Under Node, @aparte/core resolves to its DOM-free entry and no <aparte-*>
    // element upgrades — the browser entry is the one with the elements in it.
    alias: { '@aparte/core': '@aparte/core/browser' },
  },
});
