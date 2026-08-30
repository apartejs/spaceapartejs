/**
 * The single source of truth of the configurator.
 *
 * The scenario fills a `SpaceConfig`; the generator turns it into files; the preview
 * renders those files. Nothing else is shared state — keep it that way.
 */

/** Where the generated chat runs its inference. */
export type InferenceMode = 'browser' | 'providers' | 'endpoint';

/** The theme baked into the generated Space (`system` writes no attribute). */
export type SpaceTheme = 'light' | 'dark' | 'system';

export interface SpaceConfig {
  // — Model and inference —
  /** HF repo id (`owner/name`), or '' while the user has not named one. */
  modelId: string;
  mode: InferenceMode;
  /** OpenAI-compatible base URL — `endpoint` mode only. */
  endpointUrl: string;
  /** Quantisation passed to registerModel() — `browser` mode only. */
  dtype: string;

  // — Behaviour of the generated chat —
  systemPrompt: string;
  greeting: string;
  /** File/image input in the composer. Set from detection, not asked. */
  attachments: boolean;
  /**
   * The MODEL reads images — which is not the same fact as `attachments`, and the two
   * must not be collapsed.
   *
   * `attachments` is about the composer: may a visitor add a file. This is about the
   * load path: a vision model is registered with `task: 'image-text-to-text'`, and
   * registered as text it does not merely ignore images — it **does not load at all**
   * ("Unsupported model type: lfm2_vl", seen in a browser). So turning attachments off
   * must never turn this off with it, or the Space stops working entirely.
   */
  vision: boolean;

  // — Appearance and Space metadata —
  title: string;
  emoji: string;
  theme: SpaceTheme;
  /** Brand colour, hex. Drives --aparte-primary in the generated Space. */
  accent: string;
  /** HF card gradient (Space metadata only). */
  colorFrom: string;
  colorTo: string;
  /** "Made with aparté" in the footer and in the README. */
  badge: boolean;
  /**
   * What the generated Space is written in — a SEPARATE decision from the language the
   * configurator speaks. `both` ships both sets of strings and lets the page follow the
   * visitor's own browser, with this creator's language as the fallback.
   */
  lang: SpaceLang;
}

import type { SpaceLang } from '../i18n/lang';

/** Pinned across the whole product: the generated Spaces live on without us. */
export const APARTE_VERSION = '0.16.5';

/** The HF Inference Providers router — OpenAI-compatible. */
export const HF_ROUTER_BASE_URL = 'https://router.huggingface.co/v1';

/** Svelte orange: the configurator wears its stack. */
export const ACCENT_DEFAULT = '#FF3E00';

export const DEFAULT_CONFIG: SpaceConfig = {
  modelId: '',
  mode: 'browser',
  endpointUrl: '',
  dtype: 'q4',
  systemPrompt: '',
  greeting: '',
  attachments: false,
  vision: false,
  title: '',
  emoji: '🛸',
  theme: 'system',
  accent: ACCENT_DEFAULT,
  colorFrom: 'indigo',
  colorTo: 'purple',
  badge: true,
  lang: 'en',
};

/** A repo id that HF would accept: `owner/name`, no spaces. */
export function isValidRepoId(id: string): boolean {
  return /^[\w.-]+\/[\w.-]+$/.test(id.trim());
}

/** `owner/my-model` → `my-model`; used to seed the Space title and name. */
export function modelName(id: string): string {
  const name = id.split('/').pop() ?? id;
  return name.trim();
}

/** A repo name HF accepts for the generated Space. */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
    .toLowerCase();
}

/**
 * What a config still needs before it can be generated.
 *
 * `modelId` is deliberately NOT in here. The generated page reads `MODEL_ID` from the
 * Space's variables and only falls back to the baked-in value, so a Space without a
 * model is a legitimate thing to ship: you publish the page while the model is still
 * training or converting, then fill the variable in. Refusing to generate would also
 * contradict the promise the scenario makes out loud — "you can drop it in later" —
 * and would leave someone with no model with no way through at all.
 */
export function missingFields(config: SpaceConfig): string[] {
  const missing: string[] = [];
  if (config.mode === 'endpoint' && !config.endpointUrl) missing.push('endpointUrl');
  if (!config.title) missing.push('title');
  return missing;
}

/** True when the Space will need its `MODEL_ID` variable filled in before it answers. */
export function needsModelLater(config: SpaceConfig): boolean {
  return config.mode === 'browser' && !config.modelId;
}
