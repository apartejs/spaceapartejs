<script lang="ts">
  /**
   * The preview's pane-level controls: in which theme, and the way out of the sandbox.
   *
   * The WIDTH used to be here too, as three buttons that changed a CSS scale. It has
   * moved into `Viewport`, one bar lower, and for a reason worth writing down: a size
   * control belongs to the instrument that can be honest about the number. Up here it
   * could only shrink a picture; down there it sets the document's real viewport and
   * prints the measurement beside it. What is left in this bar is what is true of the
   * whole pane whatever size the glass is.
   *
   * The theme is a LENS, like everything else on this side of the split: it never writes
   * to `SpaceConfig` and never reaches the generated files — it is a shallow override
   * handed to the generator for the frame only. When it differs from the theme the Space
   * ships with, the bar says so rather than letting the user believe they changed the
   * product.
   */
  import type { SpaceTheme } from '../lib/config/space-config';
  import type { PreviewTheme } from '../lib/generator/types';
  import { lang } from '../lib/i18n/store.svelte';
  import { uiCopy } from '../lib/i18n/ui';

  interface Props {
    theme: PreviewTheme;
    /** The theme baked into the generated files, so the bar can flag a divergence. */
    shipTheme?: SpaceTheme | null;
    onthemechange?: (theme: PreviewTheme) => void;
    /** Open the generated page in a real tab. Absent while there is nothing to open. */
    onopentab?: () => void;
  }

  let { theme, shipTheme = null, onthemechange, onopentab }: Props = $props();

  /** Read inside a `$derived`, so a language switch redraws every label and title here. */
  const t = $derived(uiCopy(lang.current));

  /** The order of the lenses, which is a fact about the control. The NAMES are copy. */
  const THEMES: readonly PreviewTheme[] = ['light', 'dark', 'system'];

  const overridden = $derived(shipTheme !== null && shipTheme !== theme);
</script>

<div class="preview-bar">
  <!-- One gauge and one way out. The gauge carries an ETCHED label — small, uppercase,
       tracked out — because that is what an instrument panel does instead of making you
       infer a control's job from its values. The label is `aria-hidden`: the group
       already has a real `aria-label`, and a screen reader does not need it twice. -->
  <div class="preview-bar__theme">
    {#if overridden && shipTheme}
      <span class="preview-bar__note" title={t.previewBar.shipsWith(t.previewBar.themes[shipTheme])}>
        {t.previewBar.overridden}
      </span>
    {/if}

    <div class="preview-bar__gauge">
      <span class="preview-bar__label" aria-hidden="true">{t.previewBar.themeLabel}</span>
      <div class="aparte-btn-group" role="group" aria-label={t.previewBar.themeGroup}>
        {#each THEMES as option (option)}
          {@const label = t.previewBar.themes[option]}
          <button
            type="button"
            class="aparte-btn aparte-btn--sm aparte-btn--surface"
            aria-pressed={theme === option}
            aria-label={t.previewBar.themeOption(label)}
            onclick={() => onthemechange?.(option)}
          >
            {label}
          </button>
        {/each}
      </div>
    </div>

    <!-- The frame is sandboxed without `allow-same-origin`, which is what keeps the
         configurator's Hugging Face token out of its reach — and also what stops
         Transformers.js from reaching Cache Storage there. So the model is loaded in a
         tab of its own, where the page has a normal origin and behaves exactly as it
         will once it is a Space. -->
    {#if onopentab}
      <button
        type="button"
        class="aparte-btn aparte-btn--sm aparte-btn--surface preview-bar__eject"
        title={t.previewBar.openTabHint}
        onclick={() => onopentab()}
      >
        {t.previewBar.openTab}
      </button>
    {/if}
  </div>
</div>

<style>
  .preview-bar {
    /* The kit's buttons read aparté's ink tokens, and this product remaps the surfaces
       without remapping the text. Feeding them the product's own text colours here keeps
       the controls legible whatever the page decides about `data-aparte-theme`. */
    --aparte-text: var(--ink, #ece8f1);
    --aparte-text-muted: var(--ink-dim, #a79fb5);

    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 0.9rem;
    flex: 1 1 auto;
    min-width: 0;
    flex-wrap: wrap;
    /* No padding, no border and no background of its own: this bar is one strip of the
       pane's instrument row, and the row owns all three. Two components each drawing
       their own hairline is how a panel ends up with a double seam across it. */
  }

  .preview-bar__gauge,
  .preview-bar__theme {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .preview-bar__theme {
    gap: 0.6rem;
    flex-wrap: wrap;
  }

  /* Etched into the panel: uppercase, tracked out, and dim enough that it names the
     gauge without competing with the values on it. */
  .preview-bar__label {
    font-size: var(--text-2xs, 0.6875rem);
    letter-spacing: var(--track-etched, 0.14em);
    text-transform: uppercase;
    color: var(--ink-dim, #a79fb5);
  }

  /* The one warning light on this strip: the glass is showing a theme the Space does
     not ship with. Brass rather than thruster — it is a caveat, not a live state. */
  .preview-bar__note {
    padding: 0.1rem 0.4rem;
    border: 1px solid color-mix(in srgb, var(--thruster, var(--thruster, #ff3e00)) 34%, transparent);
    border-radius: 999px;
    font-size: var(--text-2xs, 0.6875rem);
    letter-spacing: var(--track-etched, 0.14em);
    text-transform: uppercase;
    color: var(--thruster, var(--thruster, #ff3e00));
    cursor: help;
  }

  /* No colour of its own.
     It used to carry a brass edge to mark "leaving the glass is not adjusting it" — but
     brass belongs to one thing here, the "Made with aparté" mark, and a lone yellow
     button in a strip of neutral ones reads as a mistake rather than as a distinction. What sets this one apart is where it
     sits, at the end of the strip, past the two gauges. Its `title` carries the rest. */
  .preview-bar__eject {
    margin-inline-start: 0.25rem;
  }

  /* The one place this component reaches into the kit: `--aparte-btn-bg-toggled` is a
     single surface step, which is plenty in a transcript and not enough in a segmented
     control where the selected item has to be findable at a glance. */
  /* Selected is LIVE, so selected is thruster — brass is identity and structure only.
     See the note on the same rule in App.svelte. */
  .preview-bar :global(.aparte-btn[aria-pressed='true']) {
    background: color-mix(in srgb, var(--thruster, #ff3e00) 15%, transparent);
    border-color: color-mix(in srgb, var(--thruster, #ff3e00) 65%, transparent);
    color: var(--thruster-lit, #ff5c26);
  }

  /* On a phone the strip has to fit before it has to be charming: the etched labels
     go, the controls stay. Nothing is lost to a screen reader — the labels are
     `aria-hidden` and every group keeps its own `aria-label`. */
  @media (max-width: 44rem) {
    .preview-bar__label {
      display: none;
    }
  }
</style>
