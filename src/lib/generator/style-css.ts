/**
 * The theme block of a generated Space.
 *
 * aparté is 100% CSS-driven — there is no JS theme logic — so "theming" here is a
 * short list of `--aparte-*` overrides plus the page furniture core does not own:
 * the header, the greeting, the gate and the badge.
 *
 * The result is inlined into `index.html` rather than shipped as a second file. The
 * generated Space has to work as ONE standalone document (and as the `srcdoc` of the
 * configurator's preview iframe, where a `<link>` to a sibling file resolves against
 * the parent page and 404s), so a separate `style.css` would break both.
 */

import { ACCENT_DEFAULT, type SpaceConfig } from '../config/space-config';

/** `#abc` or `#aabbcc`. Anything else is not going near a stylesheet. */
const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * The accent, or the default when it is not a plain hex colour.
 *
 * The value lands in a CSS declaration, so it is the one piece of user input in this
 * file that could carry a `}` out of the rule it belongs to. A whitelist is simpler
 * than an escape, and a brand colour has no reason to be anything else.
 */
export function safeAccent(accent: string): string {
  const value = accent.trim();
  return HEX_COLOUR.test(value) ? value : ACCENT_DEFAULT;
}

/**
 * The `<style>` contents of the generated Space.
 *
 * Everything reads core's own palette tokens (`--aparte-bg`, `--aparte-text`,
 * `--aparte-border`…), which core declares for both light and dark — so the page
 * chrome follows `data-aparte-theme` with nothing else to write.
 */
export function generateStyleCss(config: SpaceConfig): string {
  const accent = safeAccent(config.accent);

  return `/* ── Theme ──────────────────────────────────────────────────────────────
   One brand colour is enough: core derives the rest of the palette from it and
   works out the ink to put ON a fill, so a solid button stays readable whatever
   this is set to. The hover is the same colour a step darker.
   Changing the accent from the Space settings? See the ACCENT variable below. */
:root {
  --aparte-primary: ${accent};
  --aparte-primary-hover: color-mix(in oklab, var(--aparte-primary) 84%, black);
}

/* ── Page ───────────────────────────────────────────────────────────────
   A Space is shown INSIDE an iframe on huggingface.co, at a width and height we
   do not control. 100dvh (not 100vh) follows mobile browser chrome as it hides,
   so the composer stays on screen; the transcript is the only thing that scrolls
   — the page itself never does. */
* { box-sizing: border-box; }

html,
body {
  height: 100%;
}

body {
  margin: 0;
  background: var(--aparte-bg);
  color: var(--aparte-text);
  font-family: var(--aparte-font-family);
}

.app {
  display: flex;
  flex-direction: column;
  height: 100dvh;
}

/* flex:1 + min-height:0 lets the chat shrink below its content so its transcript
   scrolls; height:auto releases core's default height:100%, which would ignore
   the header and overflow the page. */
.app > aparte-chat {
  flex: 1 1 auto;
  min-height: 0;
  height: auto;
}

/* ── Header ─────────────────────────────────────────────────────────── */
.app-header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--aparte-border);
}

.app-emoji {
  font-size: 20px;
  line-height: 1;
}

.app-title {
  margin: 0;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── The gate ───────────────────────────────────────────────────────────
   Shown while the chat cannot answer yet: the weights have not been asked for,
   or are still downloading. That is the only thing it ever waits on — v1 runs
   in the browser, so there is nobody to sign in and no key to type.
   [hidden] alone would lose to display:flex. */
.gate {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: calc(100% - 32px);
  max-width: 34rem;
  margin: 12px auto 0;
  padding: 14px 18px;
  border: 1px solid var(--aparte-border);
  border-radius: var(--aparte-radius-lg);
  background: var(--aparte-surface-1);
  text-align: center;
}

.gate[hidden] { display: none; }

.gate-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
}

.gate-note {
  margin: 0;
  font-size: 12px;
  color: var(--aparte-text-muted);
}

.status {
  margin: 0;
  font-size: 13px;
  color: var(--aparte-text-muted);
  font-variant-numeric: tabular-nums;
}

.progress {
  width: 100%;
  max-width: 22rem;
  height: 6px;
  appearance: none;
  border: 0;
  border-radius: var(--aparte-radius-full);
  background: var(--aparte-surface-2);
  overflow: hidden;
}

.progress[hidden] { display: none; }
.progress::-webkit-progress-bar { background: var(--aparte-surface-2); }
.progress::-webkit-progress-value { background: var(--aparte-primary); }
.progress::-moz-progress-bar { background: var(--aparte-primary); }

/* ── The empty state ────────────────────────────────────────────────────
   <aparte-chat center-empty> keeps the composer in the middle until the first
   message and carries [data-empty] while it does — that attribute is the hook
   for a greeting of our own. :not(:empty) so a Space with no greeting shows no
   empty box. */
.welcome {
  display: none;
  padding: 0 16px 16px;
  text-align: center;
  font-size: 15px;
  line-height: 1.55;
  color: var(--aparte-text-muted);
  text-wrap: balance;
}

aparte-chat[data-empty] .welcome:not(:empty) { display: block; }

/* ── Footer badge ─────────────────────────────────────────────────────── */
.app-footer {
  flex: none;
  display: flex;
  justify-content: center;
  padding: 0 16px 10px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: var(--aparte-radius-full);
  font-size: 12px;
  color: var(--aparte-text-muted);
  text-decoration: none;
}

.badge:hover {
  color: var(--aparte-text);
  background: var(--aparte-surface-2);
}

.badge:focus-visible {
  outline: var(--aparte-focus-outline-width) solid var(--aparte-primary);
  outline-offset: 2px;
}

/* The aparté mascot, drawn in punctuation — no image asset to host. */
.badge-mark {
  font-family: var(--aparte-code-font-family);
  letter-spacing: 0.04em;
}

@media (prefers-reduced-motion: reduce) {
  * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
`;
}
