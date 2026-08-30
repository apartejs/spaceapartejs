/**
 * The tool rows, as instruments.
 *
 * Every step of the configurator is a real aparté tool call, so the transcript is mostly
 * rows: `scan_model`, `generate_files`, `create_space`. The library draws each one as a
 * quiet line — a name, a spinner, a word — which is the right default for a tool nobody
 * knows anything about. We know everything about these nine, so each one gets a readout:
 * what it found, what it wrote, where the Space went.
 *
 * Four rules hold this file together.
 *
 * 1. **The structured result, never the prose.** Every handler in `scenario/tools.ts`
 *    returns `structuredContent` beside its text, and core lands it on the segment as
 *    `structuredResult`. That object is what a row reads. The prose is written for the
 *    model and for a human reading the disclosure; parsing it would make a rewording of
 *    one sentence a rendering bug three files away.
 * 2. **Plain DOM, and `textContent` for everything.** `render` may return an element, and
 *    then — the library's own words — "there is no innerHTML surface at all". A repo id
 *    is typed by the user, an error message comes from the Hub, and `ModelScan.error`
 *    says in its own doc comment that it must never reach `innerHTML`. So nothing here
 *    builds a string of markup, ever.
 * 3. **The status decides first.** A row is read for its state before its content: a call
 *    that is pending, awaiting approval, rejected, stopped or failed has no result to
 *    show, and inventing one from an absent `structuredResult` is how "we could not look"
 *    turns into "there is nothing there". Every view starts at {@link stage}.
 * 4. **One line at rest.** The readout lives in the summary, so the reader never has to
 *    open anything to know what happened; the disclosure holds the detail — the full
 *    scan, the per-file sizes, the arguments and the raw result.
 *
 * ## Two languages
 *
 * This file used to say it had no locale to re-read, and that was true right up until the
 * configurator learned French: a row drawn under `ask_language` kept saying `no model id
 * yet` under a French transcript. Every word a row shows now comes from `copy.rows`,
 * which reads the current language on every access — so a renderer must ask for its
 * words WHEN IT DRAWS, never at module load. `const rows = copy.rows` at the top of this
 * file would freeze the language of whoever imported first.
 *
 * What is deliberately NOT translated: a repo id, a pipeline tag, a library name, a
 * dtype, a file path, and an error the Hub sent back. Those are the Hub's words, and a
 * French translation of `text-generation` would be this product inventing data.
 *
 * ## What the rows cannot know on their own
 *
 * Two facts a good row wants are not in any tool result, because the tools genuinely do
 * not have them: the BYTE SIZE of each generated file (the generator returns text, and
 * `generate_files` reports paths) and the NAME AND SIZE of the zip (the browser was
 * handed a blob; `download_zip` reports that it went). Both live in the host — `App.svelte`
 * holds the last build and makes the archive — so they are passed in:
 *
 * ```ts
 * installToolRenderers({
 *   files: () => latest?.files ?? null,
 *   archive: () => lastArchive,          // { name, bytes }
 * });
 * ```
 *
 * With neither, the rows still render and simply say less: `4 files` instead of
 * `4 files · 11.4 kB`. A row never guesses a number — a zip's size is not the sum of its
 * contents, and a plausible wrong byte count is worse than no byte count.
 */

import { aparteGlobalConfig } from '@aparte/core';
import type { AparteToolCallSegment, AparteToolRenderer } from '@aparte/core';

import { copy } from '../scenario/copy';

import '../../styles/tool-rows.css';

/** The row words of the language being spoken right now. Called per draw, never hoisted. */
const words = () => copy.rows;

// ─── The port: what the host lends the rows ──────────────────────────────────

/** One generated file, as much of it as a row needs. */
export interface ToolRowFile {
  path: string;
  /** The file's text, when the host has it — the row measures it in UTF-8 bytes. */
  content?: string;
  /** A size the host measured itself. Wins over `content`. */
  bytes?: number;
}

/** The archive `download_zip` handed to the browser. */
export interface ToolRowArchive {
  name?: string;
  bytes?: number;
}

/**
 * The slice of the aparté config this module touches.
 *
 * A structural type, so `aparteGlobalConfig` satisfies it and a test can register into a
 * two-line fake without building a config.
 */
export interface ToolRowHost {
  registerToolRenderer(toolName: string, renderer: AparteToolRenderer): void;
}

/** Everything `installToolRenderers` accepts. Every field is optional on purpose. */
export interface ToolRendererOptions {
  /** Where to register. Defaults to `aparteGlobalConfig`. */
  host?: ToolRowHost;
  /** The files of the last build, for the sizes `generate_files` does not carry. */
  files?: () => readonly ToolRowFile[] | null | undefined;
  /** The last archive saved, for the name and size `download_zip` does not carry. */
  archive?: () => ToolRowArchive | null | undefined;
}

/** The facts, resolved at render time so a row shows the build it belongs to. */
interface Facts {
  files?: () => readonly ToolRowFile[] | null | undefined;
  archive?: () => ToolRowArchive | null | undefined;
}

// ─── Reading an unknown ──────────────────────────────────────────────────────

/**
 * `structuredResult` is typed `unknown`, and it is: a replayed conversation, a tool that
 * changed shape, a handler that returned nothing at all. Every read below is a question
 * that answers "no" rather than throwing.
 */
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(source: Record<string, unknown> | null, key: string): string {
  const value = source?.[key];
  return typeof value === 'string' ? value : '';
}

function bool(source: Record<string, unknown> | null, key: string): boolean {
  return source?.[key] === true;
}

function strings(source: Record<string, unknown> | null, key: string): string[] {
  const value = source?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

// ─── Numbers a person reads ──────────────────────────────────────────────────

/**
 * The UTF-8 length of a string, without `TextEncoder`.
 *
 * Not a purity exercise: the generated files carry emoji (the Space's, in its README and
 * its metadata), `String.length` counts a surrogate pair as two and would under-report
 * every one of them by two bytes. Written out because the byte count is displayed as a
 * fact, and a fact has to be right in a test environment as well as in a browser.
 */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.codePointAt(index) ?? 0;
    if (code > 0xffff) {
      bytes += 4;
      index += 1; // the low surrogate, already counted
    } else if (code > 0x7ff) {
      bytes += 3;
    } else if (code > 0x7f) {
      bytes += 2;
    } else {
      bytes += 1;
    }
  }
  return bytes;
}

/**
 * Bytes, in the Hub's units: SI multiples, one decimal above a kilobyte.
 *
 * kB and not KiB deliberately — every size the visitor will meet next (the model card,
 * the file browser, the download) is written this way, and two conventions for one number
 * is how a reader stops trusting either.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** The bytes of one generated file, from whichever of the two facts the host gave. */
function fileBytes(file: ToolRowFile): number | null {
  if (typeof file.bytes === 'number' && Number.isFinite(file.bytes)) return file.bytes;
  if (typeof file.content === 'string') return utf8Length(file.content);
  return null;
}

/**
 * The transformers.js dtypes, and what each one weighs per parameter.
 *
 * The weight is the whole point of the chip: `q4` and `fp32` are the same model and a
 * download eight times apart, and that ratio is the only reason the precision question
 * exists. A dtype we do not know keeps its name and says nothing about its size.
 */
const DTYPE_WEIGHT: Readonly<Record<string, string>> = {
  q4f16: '4-bit',
  q4f32: '4-bit',
  q4: '4-bit',
  int4: '4-bit',
  bnb4: '4-bit',
  int8: '8-bit',
  uint8: '8-bit',
  q8: '8-bit',
  fp16: '16-bit',
  bf16: '16-bit',
  fp32: '32-bit',
};

// ─── Small DOM ───────────────────────────────────────────────────────────────

function span(className: string, text?: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/** Anything the Hub or the user owns: a repo id, a path, a dtype, a file name. */
function mono(text: string): HTMLSpanElement {
  return span('tool-row__mono', text);
}

/** A word about the row, in the row's own voice. */
function note(text: string): HTMLSpanElement {
  return span('tool-row__note', text);
}

/** A fact with a unit: `q4 · 4-bit`, `index.html · 2.1 kB`. */
function chip(label: string, suffix?: string): HTMLSpanElement {
  const element = span('tool-row__chip');
  element.append(span('tool-row__chip-label', label));
  if (suffix) element.append(span('tool-row__chip-note', suffix));
  return element;
}

/** The chevron, drawn rather than fetched: no icon provider, no innerHTML. */
function chevron(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M4 6.5 8 10.5 12 6.5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

/**
 * A link that does not swallow the disclosure.
 *
 * An anchor inside a `<summary>` toggles the `<details>` on its way out, so the Space
 * opens in a tab AND the row unfolds behind it. `stopPropagation` on the click is the
 * whole fix, and it covers the keyboard too — Enter on a focused link fires a click.
 *
 * `target="_blank"` with `rel="noreferrer noopener"`, because the other tab is a page we
 * do not control and `window.opener` is a handle onto this one.
 */
function link(href: string, text: string): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.className = 'tool-row__link tool-row__mono';
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noreferrer noopener';
  anchor.textContent = text;
  anchor.addEventListener('click', (event) => event.stopPropagation());
  return anchor;
}

/**
 * A URL we are willing to put in an `href`.
 *
 * It comes from our own Hub client today, which is exactly the kind of sentence that
 * stops being true. `javascript:` is a script in the page's origin; anything that is not
 * http(s) is rendered as text instead.
 */
export function safeHttpUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * `owner/name` out of a Space URL — the id a Hub reader recognises.
 *
 * The push tool reports the repo NAME it asked for, never the owner (the account is the
 * host's business), so the full id only exists in the URL. A shape we do not recognise
 * falls back to the name we do have, rather than to a slice of somebody's path.
 */
export function spaceRepoId(url: string, fallback: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const start = parts.indexOf('spaces');
    const owner = start >= 0 ? parts[start + 1] : parts[0];
    const name = start >= 0 ? parts[start + 2] : parts[1];
    if (owner && name) return `${owner}/${name}`;
  } catch {
    /* not a URL: the fallback below is the honest answer */
  }
  return fallback;
}

// ─── The row ─────────────────────────────────────────────────────────────────

/**
 * How the row's diode is lit. Four states and no more: it is a lamp, not a palette.
 *
 * `live` and `ok` are the product colour — the ship's own "this is working" — while
 * `warn` and `bad` borrow the status hues the token file already declares. Green is
 * deliberately not among them: aparté tints a resolved row's word with its success ink,
 * and the stylesheet takes that back so the transcript keeps one accent.
 */
type Tone = 'idle' | 'live' | 'ok' | 'warn' | 'bad';

/** What a renderer says about one segment: a word, a lamp, a readout, a detail. */
interface RowView {
  /** The word at the far end of the row. */
  state: string;
  tone: Tone;
  /** The readout, in the summary. Read at a glance, never unfolded. */
  gist: Node[];
  /** Extra detail, above the arguments and the raw result. */
  detail?: Node[];
}

type ViewOf = (segment: AparteToolCallSegment, facts: Facts) => RowView;

const statusOf = (segment: AparteToolCallSegment): AparteToolCallSegment['status'] =>
  segment.status ?? 'pending';

/**
 * Every state that is not `resolved`, answered before any result is read.
 *
 * This is rule 3 of the file header, as one function: a row that has no result yet — or
 * will never have one — says so, in the row's own words, and no view below it ever sees
 * an absent `structuredResult` it might mistake for an empty finding.
 */
function stage(
  segment: AparteToolCallSegment,
  running: string,
  waiting = words().stage.approval,
): RowView | null {
  const { state, stage: said } = words();
  switch (statusOf(segment)) {
    case 'pending':
      return { state: state.running, tone: 'live', gist: [note(running)] };
    case 'awaiting-approval':
      return { state: state.waiting, tone: 'idle', gist: [note(waiting)] };
    case 'rejected':
      return { state: state.declined, tone: 'warn', gist: [note(said.declined)] };
    case 'aborted':
      return { state: state.stopped, tone: 'warn', gist: [note(said.stopped)] };
    case 'failed':
      // The one place a row shows the raw result in its summary: a crash has no
      // structured content, and its single line IS the finding.
      return { state: state.failed, tone: 'bad', gist: [note(segment.result || said.crashed)] };
    default:
      return null;
  }
}

/** A labelled block in the disclosure, in the shape aparté's own detail uses. */
function part(label: string, text: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'aparte-tool-part';
  wrap.append(span('aparte-tool-part-label', label));
  const body = document.createElement('div');
  body.className = 'aparte-tool-part-body';
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = text;
  pre.append(code);
  body.append(pre);
  wrap.append(body);
  return wrap;
}

/** The arguments the model chose, as the tool-call UI page asks for. */
function inputPart(segment: AparteToolCallSegment): HTMLElement | null {
  const input = segment.toolCall?.input;
  if (!input || typeof input !== 'object' || Object.keys(input).length === 0) return null;
  try {
    return part('Input', JSON.stringify(input, null, 2));
  } catch {
    return null;
  }
}

/** The empty shell: built once, then painted on every change. */
function shell(segment: AparteToolCallSegment, name: string): HTMLElement {
  const root = document.createElement('details');
  root.className = 'aparte-segment aparte-segment-tool-call tool-row';
  root.dataset['segmentId'] = segment.id;
  root.dataset['toolCallId'] = segment.toolCall?.id ?? '';

  const summary = document.createElement('summary');
  summary.className = 'aparte-tool-summary tool-row__summary';

  const toggle = span('aparte-tool-toggle tool-row__toggle');
  toggle.append(chevron());

  const label = span('aparte-tool-label tool-row__label');
  const diode = span('tool-row__diode');
  diode.setAttribute('aria-hidden', 'true');
  label.append(diode, span('aparte-tool-name tool-row__name', name));

  const spinner = span('aparte-spinner aparte-tool-spinner');
  spinner.setAttribute('aria-hidden', 'true');
  spinner.toggleAttribute('hidden', true);

  summary.append(toggle, label, span('tool-row__gist'), spinner, span('aparte-tool-state'));

  const detail = document.createElement('div');
  detail.className = 'aparte-tool-detail tool-row__detail';

  root.append(summary, detail);
  return root;
}

const replace = (host: Element | null, children: readonly Node[]): void => {
  if (!host) return;
  host.replaceChildren(...children);
};

/**
 * Paint an existing shell. Called by `render` once and by `update` on every change.
 *
 * The root element and the summary's frame are never rebuilt, which is what `update` is
 * for: the `<details>` carries the reader's `open`, and a row that slams shut every time
 * a status changes is the defect the library's own contract names. Only the readout, the
 * state word and the detail are replaced, and none of them holds focus or state.
 */
function paint(root: HTMLElement, segment: AparteToolCallSegment, view: RowView): void {
  const status = statusOf(segment);
  root.dataset['status'] = status;
  root.dataset['tone'] = view.tone;

  replace(root.querySelector('.tool-row__gist'), view.gist);

  const state = root.querySelector('.aparte-tool-state');
  if (state) state.textContent = view.state;

  root.querySelector('.aparte-tool-spinner')?.toggleAttribute('hidden', status !== 'pending');

  const detail: Node[] = [...(view.detail ?? [])];
  const input = inputPart(segment);
  if (input) detail.push(input);
  if (segment.result) detail.push(part('Result', segment.result));
  replace(root.querySelector('.tool-row__detail'), detail);
  // An empty disclosure is a lever that opens onto nothing; the stylesheet hides the
  // chevron on this attribute rather than the summary pretending to be clickable.
  root.dataset['empty'] = detail.length === 0 ? 'true' : 'false';
}

/** Turn a view function into the renderer aparté registers. */
function rowRenderer(name: string, view: ViewOf, facts: Facts): AparteToolRenderer {
  return {
    render: (segment) => {
      const root = shell(segment, name);
      paint(root, segment, view(segment, facts));
      return root;
    },
    update: (element, segment) => {
      paint(element, segment, view(segment, facts));
    },
    /**
     * The language changed under a transcript that is already on screen.
     *
     * `setLang()` calls `setLocale()`, core calls this on every row still mounted, and
     * without it a run that switched to French kept a dozen English rows above the
     * switch — the one place the two languages would sit in the same column.
     *
     * The contract says to replace text and glyphs and to add or remove no child node,
     * and `paint` rebuilds the two content zones instead of mutating them. The shape it
     * rebuilds is identical — the same nodes in the same order, carrying the other
     * language's words — and what the reader can hold is outside those zones: the
     * `<details>` keeps its open state and the `<summary>` keeps focus, which is what
     * the rule protects. The one thing it costs is focus sitting on the link inside a
     * `create_space` row at the instant the language changes.
     */
    relabel: (element, segment) => {
      paint(element, segment, view(segment, facts));
    },
  };
}

// ─── scan_model ──────────────────────────────────────────────────────────────

/**
 * The row the whole configurator turns on.
 *
 * Two things it must never do, both of them ways of saying something the scan did not
 * find out. A 401 means the repo could not be READ — `modesFor()` in `hub/types.ts`
 * exists for exactly this — so the row says so in those words and names no weights at
 * all; and a 404 is about the id, not about ONNX. "We could not look" and "there is
 * nothing there" are one keystroke apart in a renderer and a world apart to a reader.
 */
const scanView: ViewOf = (segment) => {
  const { state, scan: said } = words();
  const requested = str(record(segment.toolCall?.input), 'modelId');
  const staged = stage(segment, requested ? said.reading(requested) : said.readingHub);
  if (staged) return staged;

  const result = record(segment.structuredResult);
  const scan = record(result?.['scan']);
  const id = str(scan, 'id') || requested;

  if (!scan) {
    return { state: state.nothingToScan, tone: 'warn', gist: [note(said.noModelYet)] };
  }

  const detail: Node[] = [];
  const line = (label: string, value: string): void => {
    const row = span('tool-row__line');
    row.append(span('tool-row__line-label', label), span('tool-row__line-value', value));
    detail.push(row);
  };

  switch (str(scan, 'status')) {
    case 'found': {
      const variants = strings(result, 'variants');
      const dtypes = variants.length > 0 ? variants : strings(scan, 'onnxDtypes');
      const ships = dtypes.length > 0 || bool(scan, 'hasOnnx');
      const pipeline = str(scan, 'pipelineTag');
      const vision = bool(scan, 'supportsImage');

      const gist: Node[] = [mono(id), note(ships ? said.shipsOnnx : said.noOnnx)];
      for (const dtype of dtypes) gist.push(chip(dtype, DTYPE_WEIGHT[dtype]));
      if (pipeline) gist.push(span('tool-row__tag', pipeline));
      if (vision) gist.push(span('tool-row__flag', said.vision));

      // `pipeline` and `libraryName` are the Hub's own words and stay in them.
      line(said.task, pipeline || said.notDeclared);
      line(said.library, str(scan, 'libraryName') || said.notDeclared);
      const onnxFiles = strings(scan, 'onnxFiles').length;
      line(said.onnx, ships ? said.files(onnxFiles, dtypes) : said.noneInRepo);
      line(said.imageInput, vision ? said.yes : said.no);
      line(
        said.visibility,
        bool(scan, 'isPrivate') ? said.private : bool(scan, 'gated') ? said.gated : said.public,
      );

      return { state: state.scanned, tone: ships ? 'ok' : 'warn', gist, detail };
    }
    case 'private':
      return {
        state: state.locked,
        tone: 'warn',
        // Not "no weights": nothing was read, so nothing is known about what is inside.
        gist: [mono(id), note(said.locked)],
      };
    case 'not-found':
      return {
        state: state.noRepo,
        tone: 'bad',
        gist: [mono(id), note(said.notFound)],
      };
    default: {
      const error = str(scan, 'error');
      const gist: Node[] = [mono(id), note(said.unreachable)];
      // UNTRUSTED, and said so in its own doc comment: it can carry what the user typed
      // and what the Hub sent back. `textContent`, like everything else here.
      if (error) gist.push(span('tool-row__error', error));
      return { state: state.unreachable, tone: 'bad', gist };
    }
  }
};

// ─── generate_files ──────────────────────────────────────────────────────────

/** The moment the product delivers: what was written, and how much of it. */
const filesView: ViewOf = (segment, facts) => {
  const { state, files: said } = words();
  const staged = stage(segment, said.writing);
  if (staged) return staged;

  const result = record(segment.structuredResult);
  const value = str(result, 'value');

  if (value === 'error') {
    return { state: state.failed, tone: 'bad', gist: [note(said.refused)] };
  }
  if (value.startsWith('incomplete')) {
    const missing = strings(result, 'missing');
    return {
      state: state.incomplete,
      tone: 'warn',
      gist: [note(missing.length > 0 ? said.stillMissing(missing) : said.configIncomplete)],
    };
  }

  const paths = strings(result, 'paths');
  const built = facts.files?.() ?? null;
  const sizes = new Map<string, number>();
  for (const file of built ?? []) {
    const bytes = fileBytes(file);
    if (bytes !== null) sizes.set(file.path, bytes);
  }

  const gist: Node[] = [];
  const detail: Node[] = [];
  let total = 0;
  let measured = 0;
  for (const path of paths) {
    const bytes = sizes.get(path);
    if (bytes !== undefined) {
      total += bytes;
      measured += 1;
    }
    gist.push(chip(path, bytes === undefined ? undefined : formatBytes(bytes)));
    const row = span('tool-row__line');
    row.append(
      span('tool-row__line-label tool-row__mono', path),
      span('tool-row__line-value', bytes === undefined ? '—' : formatBytes(bytes)),
    );
    detail.push(row);
  }

  // The total is only shown when every file was measured: a partial sum presented as a
  // total is a wrong number, and the file count is a true one.
  const complete = paths.length > 0 && measured === paths.length;
  const counted = said.counted(paths.length);
  const summary = complete ? `${counted} · ${formatBytes(total)}` : counted;
  gist.push(span('tool-row__total', summary));

  if (complete) {
    const row = span('tool-row__line tool-row__line--total');
    row.append(
      span('tool-row__line-label', said.total),
      span('tool-row__line-value', formatBytes(total)),
    );
    detail.push(row);
  }

  return {
    state: state.written,
    tone: 'ok',
    gist: paths.length > 0 ? gist : [note(said.nothingWritten)],
    detail,
  };
};

// ─── create_space ────────────────────────────────────────────────────────────

/** The only irreversible act in the configurator, and the only row with a link in it. */
const spaceView: ViewOf = (segment) => {
  const { state, space: said } = words();
  const staged = stage(segment, said.creating, said.approval);
  if (staged) return staged;

  const result = record(segment.structuredResult);
  const name = str(result, 'name');
  const value = str(result, 'value');

  if (value === 'error' || !value) {
    const gist: Node[] = [];
    if (name) gist.push(mono(name));
    gist.push(note(said.refused));
    return { state: state.refused, tone: 'bad', gist };
  }

  const href = safeHttpUrl(str(result, 'url'));
  const repoId = href ? spaceRepoId(href, name) : name;
  const gist: Node[] = [href ? link(href, repoId) : mono(repoId || said.theSpace)];
  if (value.endsWith('no-model')) gist.push(note(said.noModel));

  return { state: state.live, tone: 'ok', gist };
};

// ─── download_zip ────────────────────────────────────────────────────────────

/** The file that left the browser: its name, and its size when the host measured one. */
const zipView: ViewOf = (segment, facts) => {
  const { state, zip: said } = words();
  const staged = stage(segment, said.zipping);
  if (staged) return staged;

  const value = str(record(segment.structuredResult), 'value');
  if (value === 'error' || !value) {
    return { state: state.failed, tone: 'bad', gist: [note(said.failed)] };
  }

  const archive = facts.archive?.() ?? null;
  const name = typeof archive?.name === 'string' ? archive.name : '';
  const bytes =
    typeof archive?.bytes === 'number' && Number.isFinite(archive.bytes) ? archive.bytes : null;

  const gist: Node[] = [];
  if (name) gist.push(mono(name));
  if (bytes !== null) gist.push(span('tool-row__total', formatBytes(bytes)));
  if (!name && bytes === null) gist.push(note(said.handed));
  if (value.endsWith('no-model')) gist.push(note(said.noModel));

  return { state: state.saved, tone: 'ok', gist };
};

// ─── the ask_* family ────────────────────────────────────────────────────────

/** How one answer reads: the words, and whether they belong to the Hub's face. */
interface Answer {
  text: string;
  mono?: boolean;
}

/**
 * A question and its answer, on one line.
 *
 * These five rows are the transcript's rhythm — the panel above already asked the
 * question in full and the paragraph below already acted on it, so a row that repeated
 * either would be the third copy of the same sentence. What is missing between those two
 * is the RECORD: what was chosen, in a line the reader can scan later.
 *
 * An empty value always means "no answer", per the result protocol in `tools.ts`, and it
 * is a warn rather than a failure: nothing went wrong, the conversation simply carried on
 * without a decision.
 */
function askView(question: () => string, answers: (value: string) => Answer): ViewOf {
  return (segment) => {
    const { state, ask: said } = words();
    const staged = stage(segment, said.waiting);
    if (staged) return staged;

    const value = str(record(segment.structuredResult), 'value');
    // A THUNK, not a string: these five views are built once at module load, and a
    // question captured there would still be in English three turns into a French run.
    const gist: Node[] = [span('tool-row__question', question())];
    if (!value) {
      gist.push(note(said.noAnswer));
      return { state: state.unanswered, tone: 'warn', gist };
    }
    const answer = answers(value);
    const element = span(answer.mono ? 'tool-row__answer tool-row__mono' : 'tool-row__answer');
    element.textContent = answer.text;
    gist.push(element);
    return { state: state.answered, tone: 'ok', gist };
  };
}

/** A repo id: the Hub's, and the same string in either language. */
const modelView = askView(
  () => words().ask.model,
  (value) => ({ text: value, mono: true }),
);

const precisionView = askView(
  () => words().ask.precision,
  (value) => ({
    text: DTYPE_WEIGHT[value] ? `${value} · ${DTYPE_WEIGHT[value]}` : value,
    mono: true,
  }),
);

const behaviourView = askView(
  () => words().ask.behaviour,
  (value) => {
    const said = words().ask;
    return {
      text:
        value === 'default'
          ? said.behaviourDefault
          : value === 'custom'
            ? said.behaviourCustom
            : value === 'look'
              ? said.behaviourLook
              : value,
    };
  },
);

const appearanceView = askView(
  () => words().ask.appearance,
  (value) => {
    const said = words().ask;
    return {
      text:
        value === 'default'
          ? said.appearanceDefault
          : value === 'custom'
            ? said.appearanceCustom
            : value,
    };
  },
);

const outcomeView = askView(
  () => words().ask.outcome,
  (value) => {
    const said = words().ask;
    return {
      text:
        value === 'download'
          ? said.outcomeDownload
          : value === 'push'
            ? said.outcomePush
            : value === 'push.anon'
              ? said.outcomeAnonymous
              : value,
    };
  },
);

/** Every tool that gets a readout. Anything absent keeps aparté's own row, on purpose. */
const VIEWS: ReadonlyArray<readonly [string, ViewOf]> = [
  ['scan_model', scanView],
  ['generate_files', filesView],
  ['create_space', spaceView],
  ['download_zip', zipView],
  ['ask_model', modelView],
  ['ask_precision', precisionView],
  ['ask_behaviour', behaviourView],
  ['ask_appearance', appearanceView],
  ['ask_outcome', outcomeView],
];

// ─── Installation ────────────────────────────────────────────────────────────

/**
 * The facts one host was given, kept by host rather than by module.
 *
 * So a second call can hand over the file sizes the first one did not have — `App.svelte`
 * may well install the rows before it has ever built anything — without registering nine
 * renderers twice.
 */
const fitted = new WeakMap<ToolRowHost, Facts>();

/**
 * Fit the instrument rows.
 *
 * ```ts
 * import { installToolRenderers } from './lib/elicitation/tool-renderers';
 * installToolRenderers({ files: () => latest?.files ?? null, archive: () => lastArchive });
 * ```
 *
 * Idempotent: calling it twice registers one set of renderers and merges whatever new
 * facts the second call carried. Call it before the first turn — a renderer that arrives
 * after a row is drawn is a renderer that row never saw.
 */
export function installToolRenderers(options: ToolRendererOptions = {}): void {
  const host = options.host ?? aparteGlobalConfig;
  const existing = fitted.get(host);
  const facts: Facts = existing ?? {};
  if (options.files) facts.files = options.files;
  if (options.archive) facts.archive = options.archive;
  if (existing) return;

  fitted.set(host, facts);
  for (const [name, view] of VIEWS) host.registerToolRenderer(name, rowRenderer(name, view, facts));
}
