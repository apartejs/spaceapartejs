/**
 * Every word the CHROME says, in English. This file is the SOURCE.
 *
 * Two rules hold this dictionary together, and both are structural rather than stylistic:
 *
 * 1. **English defines the type.** `UiCopy` is `typeof en`, and `fr.ts` declares itself as
 *    `UiCopy`. A French string that is missing, misspelt in its key, or given the wrong
 *    shape is a COMPILE ERROR — not a blank space that ships. A `Record<string, string>`
 *    would accept anything and catch nothing, which is why there is no index signature
 *    anywhere below.
 * 2. **A string that carries a value is a FUNCTION, never a concatenation.** Word order is
 *    not universal: "768 by 1024 pixels" and "768 sur 1024 pixels" happen to agree, "the
 *    dark theme" and "le thème sombre" do not. Gluing fragments together works until it
 *    silently does not, so every interpolation is a function that owns its whole sentence
 *    and each language writes that sentence its own way.
 *
 * What is NOT here, deliberately: the product name "Aparté Spaces", the "Made with aparté"
 * mark, model ids, dtypes, byte units, file paths, and anything else set in the data face
 * — those belong to the Hub or to aparté, and translating them would be inventing facts.
 * The conversation is not here either: the script has its own copy under `lib/scenario`.
 *
 * Grouped by SURFACE so a component imports the one group it renders.
 */

export const en = {
  /** The console strip across the top. */
  header: {
    /** Replaced by the model readout as soon as there is an id to read out. */
    tagline: 'a demo for your model, in three clicks',
    /** The etched label on the readout. Its VALUE is the model id, never translated. */
    modelLabel: 'model',
    openSpace: 'Open the Space',
    signedIn: 'Signed in to Hugging Face',
    signOut: 'Sign out',
    /** The link on the "Made with aparté" mark. The mark itself is not translated. */
    madeWith: 'aparté — the chat library this is built with, and built for',
    /** The stacked-layout pane switch, which only exists under the split's breakpoint. */
    panesLabel: 'Visible pane',
    paneChat: 'Chat',
    panePreview: 'Preview',
  },

  /** The page around the strip: the seam, the notice rail, the empty state, the switch. */
  shell: {
    /** The accessible name of the whole split — what the two panes are. */
    splitLabel: 'Chat and preview',
    dismiss: 'Dismiss',
    /**
     * The thesis. Not a label: it is the entire product before the first message, and it
     * has to be the sentence someone repeats.
     */
    lede: 'Your model deserves better than a README.',
    /** The etched label over the preview/files switch. */
    viewLabel: 'view',
    viewGroup: 'What the pane shows',
    viewPreview: 'Preview',
    viewFiles: 'Files',
  },

  /** The glass: what is on it, and what is said when there is nothing on it. */
  preview: {
    /** An instrument with no input says so in words. Etched, uppercased by the sheet. */
    standby: 'no signal',
    emptyTitle: 'Nothing to preview yet',
    emptyBody: 'Answer a couple of questions on the left and your Space appears here, live.',
    /** The iframe's accessible name — an untitled frame is a dead end for a screen reader. */
    frameTitle: 'Live preview of the generated Space',
    failureTitle: 'This Space could not be built',
    /** The live region, read out while a rebuild is in flight. */
    updating: 'Updating preview',
  },

  /** The pane's own strip: the theme lens, and the way out of the sandbox. */
  previewBar: {
    themeLabel: 'theme',
    themeGroup: 'Preview theme',
    /** The three lenses. Also used to name the shipped theme in the caveat below. */
    themes: {
      light: 'Light',
      dark: 'Dark',
      system: 'System',
    },
    /** Takes the already-translated theme name: "the dark theme", "le thème sombre". */
    themeOption: (theme: string) => `Preview in the ${theme.toLowerCase()} theme`,
    /** The warning light: the glass is showing a theme the Space does not ship with. */
    overridden: 'preview only',
    shipsWith: (theme: string) => `The generated Space still ships with “${theme}”.`,
    openTab: 'Open in a tab',
    openTabHint: 'The model can only be downloaded and run outside the sandboxed preview',
  },

  /** The bytes. File paths and sizes stay in the data face and stay untranslated. */
  files: {
    tabsLabel: 'Generated files',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Copy failed — select the text instead',
    copiedStatus: (path: string) => `${path} copied to the clipboard`,
    empty: 'No files yet — they appear as soon as the Space can be built.',
  },

  /** The one dialog. The only place a Hugging Face credential is ever typed. */
  signIn: {
    title: 'Sign in to Hugging Face',
    close: 'Close',
    signedInAs: (name: string) => `Signed in as ${name}.`,
    why: 'Only needed to read a private model or to push the Space to your account. The Space itself never asks its visitors for anything.',
    oauth: 'Continue with Hugging Face',
    oauthNote: 'This leaves the page and comes back signed in. The conversation starts over.',
    or: 'or',
    tokenLabel: 'Access token',
    tokenNote:
      'A fine-grained token from huggingface.co/settings/tokens. It needs write access to repositories to push a Space; read access is enough to look at a private model. It is kept in this browser and sent to the Hub only.',
    cancel: 'Cancel',
    useToken: 'Use this token',
  },

  /** The instrument that measures the glass: size, orientation, zoom. */
  viewport: {
    sizeLabel: 'size',
    sizeGroup: 'Preview viewport size',
    /** Sizes, not devices — nothing here simulates a phone, it only sets a width. */
    presets: {
      mobile: 'Mobile',
      tablet: 'Tablet',
      laptop: 'Laptop',
      fill: 'Fill',
    },
    presetOption: (preset: string, width: number, height: number) =>
      `${preset}, ${width} by ${height} pixels`,
    fillOption: 'Fill the pane',
    fillHint: 'As wide as the pane',
    rotate: 'Rotate',
    rotateOption: 'Rotate the viewport, swapping its width and height',
    zoomLabel: 'zoom',
    zoomGroup: 'Preview zoom',
    zoomFit: 'Fit',
    zoomFitOption: 'Zoom to fit the pane',
    zoomOption: (zoom: string) => `Zoom to ${zoom}`,
    /**
     * The live region, spelled out for the ear. The readout beside it is glyphs for the
     * eye — "768 × 1024 · 47 %" is read aloud as "768 times 1024 middle dot 47 percent",
     * which is not a sentence anybody wants twice a second.
     */
    spokenSize: (width: number, height: number, percent: number) =>
      `${width} by ${height} pixels, shown at ${percent} percent`,
    gripWidth: 'Drag or use the arrow keys to change the viewport width',
    gripHeight: 'Drag or use the arrow keys to change the viewport height',
    gripBoth: 'Drag or use the arrow keys to change the viewport width and height',
    gripWidthHint: 'Drag to resize the width',
    gripHeightHint: 'Drag to resize the height',
    gripBothHint: 'Drag to resize',
  },
};

/**
 * The shape every language must satisfy.
 *
 * Derived from the object rather than declared beside it, so there is exactly one place a
 * new string is added and no interface to forget to update.
 */
export type UiCopy = typeof en;
