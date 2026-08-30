/**
 * The app's reactive state: the config being built, the preview settings, the session.
 *
 * The scenario mutates the config through the port the app injects; everything else reads
 * it. Preview settings live here too but are deliberately kept OUT of SpaceConfig — they
 * are how you look at the Space, not part of it.
 */
import { DEFAULT_CONFIG, type SpaceConfig } from '../config/space-config';
import type { ModelScan, HubUser } from '../hub/types';
import type { PreviewSize, PreviewTheme } from '../generator/types';

/** The single SpaceConfig the whole app builds. */
export const config = $state<SpaceConfig>({ ...DEFAULT_CONFIG });

export function patchConfig(patch: Partial<SpaceConfig>): void {
  Object.assign(config, patch);
}

export function resetConfig(): void {
  Object.assign(config, DEFAULT_CONFIG);
}

/** What detection found, if anything was scanned yet. */
export const session = $state<{
  scan: ModelScan | null;
  user: HubUser | null;
  /** Set once the user has pushed a Space; the URL of the result. */
  spaceUrl: string | null;
  /** Non-fatal message shown in the header (rate limit, offline…). */
  notice: string | null;
}>({
  scan: null,
  user: null,
  spaceUrl: null,
  notice: null,
});

/** How the preview is being viewed. Never generated, never exported. */
export const preview = $state<{ size: PreviewSize; theme: PreviewTheme }>({
  size: 'full',
  theme: 'system',
});
