/**
 * The generator is a pure function: SpaceConfig → files.
 *
 * No DOM, no network, no clock. That is what makes it testable, and what lets the
 * preview render exactly the bytes the user will download or push.
 */

export interface GeneratedFile {
  /** Path inside the Space repo, e.g. `index.html`. */
  path: string;
  content: string;
}

export interface GeneratedSpace {
  files: GeneratedFile[];
  /** The entry point, ready to feed an iframe's srcdoc. */
  indexHtml: string;
}

/** Preview-only settings — never part of SpaceConfig, never exported. */
export type PreviewSize = 'mobile' | 'tablet' | 'full';
export type PreviewTheme = 'light' | 'dark' | 'system';

export const PREVIEW_WIDTHS: Record<PreviewSize, number | null> = {
  mobile: 375,
  tablet: 768,
  full: null,
};
