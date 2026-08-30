/**
 * Every word the configurator says, in English — and the SOURCE of the type.
 *
 * `ScenarioCopy` is `typeof en`, and `fr.ts` is declared as one. So English is not
 * merely the first translation, it is the schema: a string added here and forgotten
 * there is a compile error rather than a blank on someone's screen. Nothing in this
 * file may be typed `Record<string, string>` for that reason — a record accepts a
 * missing key, and an index signature would give the whole scheme away.
 *
 * The scenario is a script: its prose is written ahead of time and cannot interpolate
 * anything a tool discovered. So the rule is — **static text explains, questions and
 * tool results carry the values**. Anything that must name a real model, size, title or
 * file count is a function here, called from a tool handler where the value exists.
 *
 * That rule is the reason `script` has four ONNX branches instead of one. A sentence
 * that cannot hold a number earns its keep by being TRUE of the case it was chosen for:
 * one size or several, images or text only. The scan picks the branch, the row under it
 * carries the figures, and the question above the composer names them again — so every
 * step says something that could only be said about this repo.
 *
 * The same rule bans concatenation across languages: never glue a sentence out of
 * fragments, because word order is not a shared property of English and French. A value
 * goes INTO a function — `weights: (dtype, size) => …` — and the function is written
 * once per language.
 *
 * Voice: a warm, plain assistant. Short sentences, concrete nouns, second person. The
 * space lexicon is rationed to the three moments that carry it — the go/no-go before the
 * push, the liftoff, the Space in orbit — and appears nowhere else. No exclamation
 * marks, no "Great choice", no emoji in the prose.
 *
 * One promise runs through all of it, and v1 is built so it stays true: the generated
 * Space asks the visitor for nothing. No account, no token, no bill — the weights
 * download from the Hub into their browser and the model answers there. Nothing here
 * may offer a route we do not build.
 */

import type { SpaceConfig } from '../../config/space-config';
import { formatBytes, type ModelScan } from '../../hub/types';
import { LANG_ENDONYM, LANG_SAMPLE, type Lang, type SpaceLang } from '../../i18n/lang';

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

const plural = (count: number, noun: string): string => (count === 1 ? noun : `${noun}s`);

/** `q4, fp16 and fp32` — a list a person reads, not an array they parse. */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** Small numbers in words, because a sentence is not a table. */
const spelled = (count: number): string => NUMBERS[count] ?? String(count);

/**
 * What each set of ONNX weights means to someone who has to wait for the download.
 *
 * Keyed by the `dtype` transformers.js takes. The ORDER of the choice is not here — the
 * scan decides which sizes a repo actually ships, and `tools.ts` sorts them.
 */
const PRECISION: Record<string, { label: string; description: string; tradeoff: string }> = {
  q4: {
    label: 'q4 — smallest',
    description: 'About a quarter of the full download. The shortest wait, answers a shade rougher.',
    tradeoff: 'The shortest wait. Answers a shade rougher than the full weights.',
  },
  q4f16: {
    label: 'q4f16 — small, for WebGPU',
    description: '4-bit weights, 16-bit maths. As small as q4, and at its best on WebGPU.',
    tradeoff: '4-bit weights, 16-bit maths — at its best on WebGPU.',
  },
  bnb4: {
    label: 'bnb4 — 4-bit',
    description: 'Another 4-bit packing, about a quarter of the full download.',
    tradeoff: 'Another 4-bit packing. A short wait, answers a shade rougher.',
  },
  int8: {
    label: 'int8 — quantised',
    description: 'Around a quarter of the full download, and close to it in quality.',
    tradeoff: '8-bit weights. Close to the full ones in quality.',
  },
  uint8: {
    label: 'uint8 — quantised',
    description: 'Around a quarter of the full download, and close to it in quality.',
    tradeoff: '8-bit weights. Close to the full ones in quality.',
  },
  q8: {
    label: 'q8 — quantised',
    description: 'Around a quarter of the full download, and close to it in quality.',
    tradeoff: '8-bit weights. Close to the full ones in quality.',
  },
  fp16: {
    label: 'fp16 — half precision',
    description: 'Half the full download, quality all but identical.',
    tradeoff: 'Half precision. Quality all but identical to the full weights.',
  },
  fp32: {
    label: 'fp32 — full precision',
    description: 'The full weights. Best answers, longest wait.',
    tradeoff: 'The full weights. Best answers, longest wait.',
  },
};

/** dtype → bytes, as the scan reports it. A missing key means "we do not know". */
export type OnnxSizes = Readonly<Record<string, number>>;

/**
 * `q4 · 172 MB`, or a bare `q4` when the Hub never told us what it weighs.
 *
 * The whole reason the precision question is worth asking: "smallest" and "full" are
 * adjectives, 172 MB and 514 MB are the decision. When the number is missing the label
 * falls back to the adjective rather than inventing a figure — the `·` is a promise that
 * what follows it was measured.
 */
const sized = (dtype: string, bytes?: number): string => {
  const weight = formatBytes(bytes ?? 0);
  return weight ? `${dtype} · ${weight}` : dtype;
};

/** What the generated Space is written in, as a person would say it. */
const spaceLangLabel = (value: SpaceLang): string =>
  value === 'both' ? 'both languages' : LANG_ENDONYM[value];

/**
 * The whole config, one field per line — the answer to "recap", and the tail of any
 * message that has to say where we stand. Standalone because `copy` refers to it twice
 * and an object cannot reference itself in its own initialiser.
 *
 * No `mode` line: v1 has one, it never changes, and a field that cannot vary is noise.
 */
function recap(config: SpaceConfig): string {
  return [
    `model: ${config.modelId || '(none yet — the Space reads MODEL_ID)'}`,
    'runs: in the visitor’s browser, through transformers.js',
    `weights: ${config.dtype}`,
    `title: ${config.title || '(none yet)'}`,
    `emoji: ${config.emoji}`,
    `theme: ${config.theme}`,
    `accent: ${config.accent}`,
    `written in: ${spaceLangLabel(config.lang)}`,
    `attachments: ${yesNo(config.attachments)}`,
    `system prompt: ${config.systemPrompt ? `${config.systemPrompt.length} characters` : 'none'}`,
    `greeting: ${config.greeting || 'none'}`,
    `badge: ${yesNo(config.badge)}`,
  ].join('\n');
}

export const en = {
  /**
   * The door, before the conversation exists.
   *
   * The script only speaks once someone has typed, so the invitation to paste an id
   * belongs to the host's empty state and composer placeholder — not to the first turn,
   * which would be asking for something already sent.
   */
  entry: {
    placeholder: 'Paste a model id, or say hello',
    emptyState: [
      'Paste a model id — it looks like owner/model — and I will build a Hugging Face Space around it: one page, no server, no keys, the model running in your visitors’ own browsers.',
      '',
      'Not published one yet? Say so and we carry on without it.',
    ].join('\n'),
  },

  // ── The script: one entry per scenario key ────────────────────────────────
  script: {
    /**
     * The first thing anyone reads, and the one paragraph that is ENGLISH IN BOTH
     * FILES — `fr.ts` re-exports these four rather than translating them.
     *
     * The reason is the whole point of asking: a French speaker can read "Français" in
     * the list below, and an English speaker can read the question. Writing this turn
     * in the language `detectLang()` guessed would make the guess load-bearing, which
     * is exactly what asking is supposed to avoid.
     *
     * The question itself is NOT in these two: it is the field's title, right above the
     * plates. Said in both places, it was printed twice on screen. What the bubble
     * carries is the half the panel cannot — why this one turn is in English.
     */
    language: [
      'Welcome aboard. One thing before anything else — and this turn is in English so that everyone can read it.',
      '',
      'Everything after it — my questions, my explanations, the buttons — follows your answer.',
    ].join('\n'),

    /** Same turn, when the first thing they sent was a model id. */
    languageWithId: [
      'Welcome aboard, and thank you for the model id — I will look it up in a moment.',
      '',
      'One thing before I do, in English so that everyone can read it: everything after this turn follows your answer.',
    ].join('\n'),

    /** Asked for again, mid-conversation. Written in the language we are leaving. */
    languageAgain:
      'Of course. Pick a language and I carry on in it — nothing you have answered so far is lost.',

    /** Said in the language just chosen, which is what makes it worth saying. */
    languageChanged: 'English from here on. Say **go** and we pick up where we left off.',

    welcome: [
      'Right. I build Hugging Face Spaces: a model in, a real chat page out — one static page, hosted for free, with aparté loaded from the CDN.',
      '',
      'The model runs in the visitor’s browser, so the page asks them for nothing. Let me see what I have to work with.',
    ].join('\n'),

    welcomeWithId:
      'Good — I will build the Space around that model. Let me look it up on the Hub first.',

    /** Found, ONNX, one size, text in and text out: the plainest good news there is. */
    scanOnnx: [
      'That repo ships ONNX weights, so this model runs in the visitor’s browser. One size of them, so there is nothing to choose here — the row above names it, and that is the file the generated page will ask the Hub for.',
      '',
      'What it means for whoever opens your Space: no account, no token, nothing to pay. The weights download once, the browser keeps them, and every answer after that is computed on their own machine.',
    ].join('\n'),

    /** Found, ONNX, several sizes: the one question the weights genuinely earn. */
    scanOnnxVariants: [
      'That repo ships ONNX weights, so this model runs in the visitor’s browser: no account, no token, nothing to pay. The weights download once and the browser keeps them.',
      '',
      'There is more than one size of them in there, and the size decides how long a first visit waits. That is worth one question before we talk about the look.',
    ].join('\n'),

    /** Found, ONNX, one size, and it reads images. */
    scanOnnxVision: [
      'ONNX weights, one size of them — and this one takes images as well as text, so I have switched attachments on in the composer it will generate.',
      '',
      'All of it happens in the visitor’s browser: no account, no token, nothing to pay. The weights download once, and the pictures they drop in are read on their own machine — nothing is uploaded anywhere.',
    ].join('\n'),

    /** Found, ONNX, several sizes, and it reads images. */
    scanOnnxVisionVariants: [
      'ONNX weights — and this one takes images as well as text, so I have switched attachments on. It all runs in the visitor’s browser: no account, no token, nothing to pay, and the pictures they drop in never leave their machine.',
      '',
      'The repo ships more than one size of weights, though, and vision models are the heavy ones. One question before the look.',
    ].join('\n'),

    /** The wall that is a door: three real ways to get ONNX weights. */
    scanNoOnnx: [
      'I found the repo — there are no ONNX weights in it. That is the format transformers.js needs to run a model inside a browser tab, and it is the one thing I cannot improvise.',
      '',
      'Three ways on, in the order I would try them:',
      '',
      '- **Look for it under `onnx-community`.** That organisation on the Hub publishes converted copies of most popular small models, usually in several sizes. Search the model name there and paste what you find.',
      '- **Convert your own.** Hugging Face Optimum does it in one command — `optimum-cli export onnx --model owner/name onnx/` — then push the `onnx/` folder to your repo and I will scan it again.',
      '- **Publish now, point at a model later.** The page reads its model id from the Space’s `MODEL_ID` variable, so the Space can go up today and be aimed at the converted model the day it exists.',
      '',
      'Paste a converted id and I will scan that one instead — or leave the box empty and we carry on without a model.',
    ].join('\n'),

    scanPrivate: [
      'The Hub answered 401: the repo is private or gated, so I could not read what is in it — not the weights, not the task, nothing.',
      '',
      'Worth knowing before launch — the visitor’s browser fetches the weights straight from the Hub, with no token in the page, so a private model leaves them at that same 401. We can carry on and set the rest by hand.',
    ].join('\n'),

    scanMissing: [
      'No repo under that id. Typos happen — ids are case-sensitive, always `owner/name`, and the owner half is as easy to get wrong as the name.',
      '',
      'Paste it again, or leave the box empty and we carry on without a model.',
    ].join('\n'),

    scanError: [
      'I could not reach the Hub just now, so this says nothing about the model itself — I simply did not get an answer.',
      '',
      'Nothing is lost: we set the rest by hand, and detection is only ever a shortcut. Say **go** at any point and I will try the lookup again.',
    ].join('\n'),

    scanNone: 'No id yet, then. Nothing here needs one to get going.',

    modelSet: 'Noted. Let me look that one up.',

    modelNone:
      'We carry on without one. The generated page reads its model id from the Space’s `MODEL_ID` variable, so you can publish the thing today and fill that in the day the model is ready.',

    precisionSet:
      'Noted — that is the download settled. Every visitor gets those weights once, and their browser caches them.',

    behaviourDefault: 'Defaults it is.',

    behaviourCustom: 'Noted. Now the look.',

    behaviourLook: 'The look, then.',

    appearanceDone: 'Got it. Building the files.',

    filesReady: [
      'Your Space is generated — the files are listed above, and the preview on the right is those exact bytes.',
      '',
      'No build step, no bundler, no server: `index.html` loads aparté and transformers.js from a CDN and does the rest in the tab.',
    ].join('\n'),

    /** Generated, but the page has no model to load yet. Say what to do about it. */
    filesReadyNoModel: [
      'Generated — the preview on the right is the real thing, and it will stay a page with no model until you give it one.',
      '',
      'That is a supported way round: `index.html` reads `MODEL_ID` from the Space’s variables and only falls back to what is baked in. Ship it now, add the variable when the model exists, and the next visitor gets a working chat.',
    ].join('\n'),

    filesReadyPrivate: [
      'Generated — the preview on the right is the real thing.',
      '',
      'One thing to fix first: the weights are fetched from the Hub by the visitor’s browser, and this model is private, so they would hit a 401 and the chat would never start. Make the model public, or paste a public id and I will rebuild around it.',
    ].join('\n'),

    filesIncompleteModel:
      'Almost. I cannot write the files without a model id — that is the one field with no sensible default.',

    filesError:
      'The generator refused that config — the row above says why. Say **recap** and I will try again.',

    outcomeDownload: 'Zipping it up.',

    outcomePush: 'Right — go/no-go. Nothing is written to your account until you say so.',

    outcomePushAnon:
      'I need your Hugging Face account for that, and I cannot see one. Sign in, then say **go** — or take the zip instead.',

    downloaded: [
      'Saved. Two files: `index.html`, which is the whole application, and a `README.md` whose front matter tells Hugging Face this is a **static** Space.',
      '',
      'To put it in orbit: new Space on Hugging Face, SDK **Static**, then drop these files at the root of the repo. Any static host works just as well — there is no backend to run.',
    ].join('\n'),

    /** The zip is saved, but the page still has no model id. One thing left to do. */
    downloadedNoModel: [
      'Saved. New Space on Hugging Face, SDK **Static**, drop these files at the root — or serve them from any static host. There is no backend to run.',
      '',
      'Then the one thing left: in the Space’s **Settings → Variables**, add `MODEL_ID` with your `owner/model`. The page reads it on load, so nothing needs rebuilding.',
    ].join('\n'),

    downloadError: 'The zip did not make it — the row above has the error. Say **zip** to try again.',

    pushed: [
      'Liftoff. The Space is live — the URL in the row above opens it.',
      '',
      'It is a static page, so it is up as soon as the files land. Open it and send it one message: that first one downloads the weights, and every one after it is instant.',
    ].join('\n'),

    /** In orbit, with an empty seat: the Space exists, the model does not yet. */
    pushedNoModel: [
      'Liftoff. The Space is live — the URL in the row above opens it — and it has no model yet.',
      '',
      'One thing to do next: on the Space, **Settings → Variables**, add `MODEL_ID` with your `owner/model`. The page reads it on load, so a refresh is all it takes after that.',
    ].join('\n'),

    pushError:
      'The push failed — the row above has what the Hub said. Say **go** to try again, or **zip** to take the files instead.',

    pushRejected:
      'No push, then — nothing left your browser. The zip is still on the table: say **zip** whenever you want it.',

    paused: 'Paused — no answer, no harm. Say **go** and I will ask again.',

    // ── Off-script answers, reached by a `when` pattern ─────────────────────
    help: [
      'Here is how this works.',
      '',
      '- The buttons in the box below are the fast path: one click is the answer.',
      '- You can type instead. Ask me about **onnx**, **size**, **cost**, **phones**, **private** models, or **aparté** itself.',
      '- Paste a model id whenever you like and I will scan that one.',
      '- Say **recap** for the current config, **zip** to grab the files as they stand, **language** to switch, or **start over** to begin again.',
      '',
      'Say **go** to carry on where we left off.',
    ].join('\n'),

    onnx: [
      'ONNX is the format transformers.js needs to run a model in a browser tab, on WebGPU or WASM, with no server anywhere. A repo has it when it carries an `onnx/` folder of weights, usually in several sizes.',
      '',
      'Most repos do not, and there are two ways round that. `onnx-community` on the Hub publishes converted copies of most popular small models. Or convert your own with Hugging Face Optimum — `optimum-cli export onnx --model owner/name onnx/` — and push the `onnx/` folder to the repo.',
      '',
      'Paste a converted id whenever you have one, or say **go** to carry on.',
    ].join('\n'),

    size: [
      'The weights download once, on the visitor’s first message, and the browser keeps them after that. Every later visit starts instantly.',
      '',
      'How much: a small embedding model is tens of megabytes, a 0.5B chat model in 4-bit lands near 300 MB, and a 7B one is a gigabyte or more — which is a lot to ask of a first visit. Quantised weights are roughly a quarter of the full ones and answer a shade rougher; half precision is half the bytes and all but indistinguishable.',
      '',
      'Say **go** to carry on.',
    ].join('\n'),

    cost: [
      'Nothing, on either side. A static Space is free to host on Hugging Face — there is no machine to rent, because nothing runs on a server. The weights come off the Hub’s CDN, also free, and aparté and transformers.js come off a public CDN.',
      '',
      'Your visitors pay nothing and sign nothing: no account, no token, no key in the page. The only cost anywhere is their bandwidth, once, for the download.',
      '',
      'Say **go** to carry on.',
    ].join('\n'),

    phone: [
      'Yes, within reason. transformers.js uses WebGPU where the browser offers it and falls back to WASM where it does not, so a recent phone will run a small model — slower than a laptop, and warmer.',
      '',
      'The limits are memory and patience: a few hundred megabytes of weights is fine on a modern phone, a multi-gigabyte model is not. If phones matter to you, take the smallest weights on offer and keep to a model under a billion parameters.',
      '',
      'Say **go** to carry on.',
    ].join('\n'),

    aparte: [
      'aparté is the chat library this page is made of, and the one your Space will load. Web components — a chat, a composer, tool calls, and the question panel you have been clicking — with no framework and no build step: a script tag and a provider.',
      '',
      'That is why this configurator is worth showing. Nothing here is a mock-up of a chat: the script is a provider, every step is a real tool call, and every question is a real elicitation. Your generated Space is the same library, talking to transformers.js in the same tab.',
      '',
      'Say **go** to carry on.',
    ].join('\n'),

    private: [
      'The generated page carries no token, so the visitor’s browser fetches the weights from the Hub as an anonymous request. A private or gated repo answers that with a 401 and the chat never starts.',
      '',
      'Two ways out — make the model public, or point the Space at a public one. Signing in here only lets me read the repo while we build; it does not follow your visitors.',
      '',
      'Say **go** to carry on.',
    ].join('\n'),

    recap: 'Here is everything I have so far.',

    restart: [
      'We can start over from any model id: paste one and I rebuild the whole thing around it. Nothing carries over that you have not told me — and if you want a genuinely blank slate, reloading the page gives you one.',
      '',
      'So: which model?',
    ].join('\n'),

    zip: 'Zipping what I have.',
  },

  // ── Questions asked through elicitation ───────────────────────────────────
  ask: {
    /**
     * The first question, and the only one asked in English whatever happens — see
     * `script.language`. `fr.ts` re-exports this object rather than translating it.
     *
     * The options do the talking instead: each one is named in its own language and
     * carries a sentence written in it, so the list DEMONSTRATES the two languages
     * rather than labelling them. A flag would be a country, which is not a language.
     */
    language: {
      // The question lives in the FIELD, not in the panel's message: with both set the
      // question was printed twice, and with only the message the panel fell back to
      // showing the field's key. An empty message and a real title leaves exactly one.
      message: '',
      header: 'Language',
      title: 'Which language should we do this in?',
      description: 'It changes everything I say from here — and nothing about the Space itself.',
      option: (code: Lang): { label: string; description: string } => ({
        label: LANG_ENDONYM[code],
        description: LANG_SAMPLE[code],
      }),
    },

    model: {
      /**
       * The same box, asked for four different reasons. A question that repeats the
       * sentence above it word for word is a form; one that picks up where the last
       * paragraph stopped is a conversation.
       */
      message: {
        none: 'What is the model id? It looks like owner/model — leave it empty if you have not published one yet.',
        converted:
          'Which id should I scan? An `onnx-community/…` copy, or your own repo once the `onnx/` folder is in it. Leave it empty and we carry on without a model.',
        missing:
          'What is the id, then? Case-sensitive, always owner/name. Leave it empty and we carry on without a model.',
        restart: 'Which model do we build around this time?',
      },
      placeholder: 'owner/model',
    },

    precision: {
      /**
       * Names the sizes this repo actually ships — the numbers the script cannot hold.
       *
       * With `sizes` in hand the list stops being abstract: "q4 · 172 MB, fp16 · 257 MB
       * and fp32 · 514 MB" is a question someone can answer. Without them it reads
       * exactly as it did before, because a made-up megabyte is worse than none.
       */
      message: (variants: readonly string[], sizes: OnnxSizes = {}): string =>
        `This repo ships ${spelled(variants.length)} ${plural(variants.length, 'size')} of weights: ${listed(variants.map((dtype) => sized(dtype, sizes[dtype])))}. Whichever you pick is what every visitor downloads once, before their first answer — smaller starts sooner, larger answers a shade better.`,
      /**
       * The label and description for one `dtype`, or a plain fallback.
       *
       * When the weight is known the label carries it and the description drops to the
       * one line the number does not say — the trade-off. Repeating "about a quarter of
       * the full download" next to "172 MB" would be the vaguer half arguing with the
       * precise one.
       */
      option: (dtype: string, bytes?: number): { label: string; description: string } => {
        const known = PRECISION[dtype];
        const weight = formatBytes(bytes ?? 0);
        if (!known) {
          return { label: sized(dtype, bytes), description: 'Another set of weights in the repo.' };
        }
        return weight
          ? { label: `${dtype} · ${weight}`, description: known.tradeoff }
          : { label: known.label, description: known.description };
      },
    },

    behaviour: {
      message: 'Anything to change before I build it?',
      defaults: {
        label: 'Build it with the defaults',
        description: (config: SpaceConfig): string =>
          `A general-purpose assistant called "${config.title || 'Aparté chat'}", with no system prompt — the visitor types first.`,
      },
      custom: {
        label: 'Write a system prompt and a greeting',
        description: 'What the assistant is told about itself, and the line that greets a visitor.',
      },
      look: {
        label: 'Change the look',
        description: 'Title, emoji, theme, accent colour and language, one at a time.',
      },
      systemPrompt: {
        header: 'System prompt',
        title: 'What should the assistant be told about itself?',
        description: 'It is sent ahead of every conversation, and the visitor never sees it.',
        placeholder: 'You are a helpful assistant for…',
      },
      greeting: {
        header: 'Greeting',
        title: 'First line the visitor reads, before they type anything.',
        description: 'Written into the page, not generated — it costs no download.',
        placeholder: 'Ask me anything about…',
      },
    },

    appearance: {
      message: 'How should it look?',
      /** The lead-in when the look is what the user came here for: no choice, just the form. */
      form: 'Five things, one at a time. The chips take you back to any of them.',
      keep: {
        label: 'Use these',
        description: (config: SpaceConfig): string =>
          `${config.emoji || '🛸'} ${config.title || 'Aparté chat'} · ${config.theme} theme · accent ${config.accent} · ${spaceLangLabel(config.lang)}`,
      },
      custom: {
        label: 'Let me set them',
        description: 'Title, emoji, theme, accent colour and the language of the page.',
      },
      title: {
        header: 'Title',
        title: 'What is the Space called?',
        description: 'It shows on the Space card, and in the header of the page itself.',
      },
      emoji: {
        header: 'Emoji',
        title: 'One emoji for the Space card.',
        description: 'Hugging Face shows it beside the title everywhere the Space is listed.',
      },
      theme: {
        header: 'Theme',
        title: 'Which theme does the Space open in?',
        light: 'Light',
        lightNote: 'Light for everyone, whatever their machine prefers.',
        dark: 'Dark',
        darkNote: 'Dark for everyone, whatever their machine prefers.',
        system: 'Follow the visitor’s system',
        systemNote: 'Whichever they already chose. The safe answer.',
      },
      accent: {
        header: 'Accent',
        title: 'Accent colour, as a hex value.',
        description: 'Buttons, links, the send arrow, the focus ring. Everything else follows it.',
        placeholder: '#FF3E00',
      },
      /**
       * The SECOND language question, and a different one: this is what the generated
       * page says, not what we say to each other.
       *
       * `both` is the recommended answer because a Space is public on a worldwide Hub.
       * Its author is allowed not to decide for people they will never meet, and the
       * page can simply read the visitor's own browser.
       */
      spaceLang: {
        header: 'Language',
        title: 'What language is the Space itself written in?',
        description:
          'The words in the page — the greeting, the send button, the placeholder. Not what the model answers in: that follows whatever a visitor types.',
        both: 'Both',
        bothNote: 'The page carries both, and follows each visitor’s own browser.',
        englishNote: 'English for every visitor, wherever they open it.',
        frenchNote: 'French for every visitor, wherever they open it.',
      },
    },

    outcome: {
      message: (config: SpaceConfig): string =>
        `${config.emoji || '🛸'} "${config.title || 'Aparté chat'}" is built. What now?`,
      download: {
        label: 'Download the zip',
        description: 'The files, on your machine. Unzip into a static Space, or host them anywhere.',
      },
      push: {
        label: 'Create the Space in my account',
        descriptionSignedIn: (user: string, name: string): string =>
          `A new public static Space at ${user}/${name}. I will ask before writing anything.`,
        descriptionAnonymous: 'You will need to sign in to Hugging Face first.',
      },
      name: {
        message: 'What should the Space be called on the Hub? Lowercase, no spaces.',
        placeholder: 'my-model-chat',
      },
    },

    signIn: {
      message:
        'That repo is private or gated. I can sign you in to Hugging Face and try again, or we carry on by hand.',
      yes: { label: 'Sign in and try again', description: 'Read access to your own repos.' },
      no: {
        label: 'Carry on by hand',
        description: 'Nothing is blocked — detection is only a shortcut.',
      },
    },
  },

  // ── What a tool writes into its row: the values the script cannot name ────
  result: {
    /** Written after the switch, so it is already in the language it names. */
    languageSet: (code: Lang): string => `Language: ${LANG_ENDONYM[code]}.`,

    scanNone: 'No model id to scan yet.',
    /**
     * The readout. Everything here was read off the Hub a second ago — the file count and
     * the sizes especially, which are the two facts that decide the rest of the run.
     */
    scanFound: (scan: ModelScan, variants: string[]): string =>
      [
        `${scan.id} — found.`,
        `task: ${scan.pipelineTag ?? 'not declared'} · library: ${scan.libraryName ?? 'not declared'}`,
        variants.length > 0
          ? `ONNX weights: ${scan.onnxFiles.length} ${plural(scan.onnxFiles.length, 'file')}, ${spelled(variants.length)} ${plural(variants.length, 'size')} (${variants
              .map((dtype) => sized(dtype, scan.onnxSizes?.[dtype]))
              .join(', ')})`
          : 'ONNX weights: none in this repo',
        `image input: ${yesNo(scan.supportsImage)}`,
        `visibility: ${scan.isPrivate ? 'private' : scan.gated ? 'gated' : 'public'}`,
      ].join('\n'),
    scanPrivate: (id: string): string => `${id} — 401. Private or gated, so nothing could be read.`,
    scanMissing: (id: string): string => `${id} — 404. No repo under that id.`,
    scanError: (id: string, error: string | null): string =>
      `${id} — the Hub could not be reached${error ? `: ${error}` : '.'}`,
    signedIn: (user: string): string => `Signed in as ${user}. Rescanning.`,
    signInFailed: 'Sign-in did not complete. Carrying on by hand.',

    modelSet: (id: string): string => `Model id set to ${id}.`,
    modelNone: 'No model id. The generated page will read MODEL_ID from the Space’s variables.',
    modelInvalid: (typed: string): string =>
      `"${typed}" is not an owner/name id, so the model is unset.`,

    precisionSet: (dtype: string, bytes?: number): string => `Weights: ${sized(dtype, bytes)}.`,
    precisionKept: (dtype: string, bytes?: number): string =>
      `One set of weights in the repo: ${sized(dtype, bytes)}.`,

    behaviourDefault: 'Keeping the default behaviour and the default look.',
    behaviourCustom: (config: SpaceConfig): string =>
      [
        `system prompt: ${config.systemPrompt ? `${config.systemPrompt.length} characters` : 'none'}`,
        `greeting: ${config.greeting || 'none'}`,
      ].join('\n'),
    behaviourLook: 'Straight to the look.',

    appearanceKept: (config: SpaceConfig): string =>
      `${config.emoji} ${config.title} · ${config.theme} theme · accent ${config.accent} · written in ${spaceLangLabel(config.lang)}`,

    generated: (paths: string[]): string =>
      `${paths.length} ${plural(paths.length, 'file')}: ${paths.join(', ')}`,
    generatedIncomplete: (missing: string[], config: SpaceConfig): string =>
      [`Still missing: ${missing.join(', ')}.`, '', recap(config)].join('\n'),
    generateFailed: (error: string): string => `Generation failed: ${error}`,

    recap,

    outcomeDownload: 'Downloading the zip.',
    outcomePush: (user: string, name: string): string => `Ready to create ${user}/${name}.`,
    outcomePushAnonymous: 'No account in reach — sign in first.',
    outcomeNone: 'No choice made.',

    zipSaved: (filename: string | undefined): string =>
      filename ? `Saved ${filename}.` : 'The zip was handed to your browser.',
    zipFailed: (error: string): string => `The zip failed: ${error}`,

    pushed: (url: string): string => `Live at ${url}`,
    pushFailed: (error: string): string => `The Hub refused the push: ${error}`,

    noAnswer: 'No answer — the question was dismissed.',
  },

  // ── Tool descriptions: not shown in the transcript, but read by humans ────
  tools: {
    ask_language: 'Ask which language the configurator should speak.',
    scan_model: 'Look a model up on the Hugging Face Hub and pre-fill what it supports.',
    ask_model: 'Ask the user for a Hugging Face model id.',
    ask_precision: 'Ask which set of ONNX weights the visitor should download.',
    ask_behaviour: 'Ask whether to keep the defaults, or set the system prompt and greeting.',
    ask_appearance: 'Ask for the title, emoji, theme, accent colour and language of the Space.',
    generate_files: 'Generate the Space files from the current config and refresh the preview.',
    ask_outcome: 'Ask whether to download the zip or create the Space on the Hub.',
    download_zip: 'Package the generated files as a zip and hand it to the browser.',
    create_space: 'Create the Space in the user’s Hugging Face account and push the files.',
  },

  // ── The instrument rows: every word `tool-renderers.ts` puts on screen ────
  /**
   * What the tool rows say.
   *
   * These were English literals inside the renderers until the configurator learned a
   * second language, on the reasoning — written into that file's header — that a row
   * had "no locale to re-read". It does now: `scan_model` sat under a French transcript
   * still saying `no model id yet`. Hub data (a repo id, a pipeline tag, an error the
   * Hub sent) stays untranslated on purpose; only our own words are here.
   */
  rows: {
    /** The word in the row's own corner: its state, before anything it found. */
    state: {
      running: 'Running',
      waiting: 'Waiting',
      declined: 'Declined',
      stopped: 'Stopped',
      failed: 'Failed',
      nothingToScan: 'Nothing to scan',
      scanned: 'Scanned',
      locked: 'Locked',
      noRepo: 'No repo',
      unreachable: 'Unreachable',
      incomplete: 'Incomplete',
      written: 'Written',
      refused: 'Refused',
      live: 'Live',
      saved: 'Saved',
      unanswered: 'Unanswered',
      answered: 'Answered',
    },

    /** A call with no result yet — or that will never have one. */
    stage: {
      approval: 'waiting for your go-ahead',
      declined: 'you declined this call',
      stopped: 'stopped before it finished',
      crashed: 'the handler crashed',
    },

    scan: {
      readingHub: 'reading the Hub…',
      reading: (id: string): string => `reading ${id} on the Hub…`,
      noModelYet: 'no model id yet',
      shipsOnnx: 'ships ONNX weights',
      noOnnx: 'no ONNX weights',
      vision: 'vision',
      /** The disclosure's left column. */
      task: 'task',
      library: 'library',
      onnx: 'onnx',
      imageInput: 'image input',
      visibility: 'visibility',
      notDeclared: 'not declared',
      noneInRepo: 'none in this repo',
      files: (count: number, dtypes: string[]): string =>
        `${count} ${plural(count, 'file')}${dtypes.length > 0 ? ` — ${dtypes.join(', ')}` : ''}`,
      yes: 'yes',
      no: 'no',
      private: 'private',
      gated: 'gated',
      public: 'public',
      /** Not "no weights": nothing was read, so nothing is known about what is inside. */
      locked: '401 — private or gated, so nothing could be read',
      notFound: '404 — no repo under that id',
      unreachable: 'the Hub could not be reached',
    },

    files: {
      writing: 'writing the files…',
      refused: 'the generator refused this config',
      stillMissing: (missing: string[]): string => `still missing: ${missing.join(', ')}`,
      configIncomplete: 'config incomplete',
      nothingWritten: 'nothing was written',
      counted: (count: number): string => `${count} ${plural(count, 'file')}`,
      total: 'total',
    },

    space: {
      creating: 'creating the Space on the Hub…',
      approval: 'waiting for your go-ahead — this writes to your account',
      refused: 'the Hub refused the push',
      theSpace: 'the Space',
      noModel: 'no model id yet — set MODEL_ID in the Space',
    },

    zip: {
      zipping: 'zipping the files…',
      failed: 'the zip did not make it',
      handed: 'handed to your browser',
      noModel: 'no model id yet — set MODEL_ID before you deploy',
    },

    /** The five `ask_*` rows: the question in two words, then what was chosen. */
    ask: {
      waiting: 'waiting for your answer…',
      noAnswer: 'no answer',
      model: 'Model',
      precision: 'Weights',
      behaviour: 'Behaviour',
      appearance: 'Look',
      outcome: 'Next',
      behaviourDefault: 'defaults kept',
      behaviourCustom: 'own prompt and greeting',
      behaviourLook: 'straight to the look',
      appearanceDefault: 'kept as it is',
      appearanceCustom: 'set by hand',
      outcomeDownload: 'download the zip',
      outcomePush: 'create the Space',
      outcomeAnonymous: 'no account in reach',
    },
  },
};

/**
 * The shape every language must satisfy — English is the source, so English defines it.
 *
 * A `Record<string, string>` here would accept a French file with half the keys missing
 * and hand the gap to a user; `typeof en` hands it to `tsc` instead.
 */
export type ScenarioCopy = typeof en;
