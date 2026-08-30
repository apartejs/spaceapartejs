import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
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
