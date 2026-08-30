# Aparté Spaces

**Turn a Hugging Face model into a working demo, through a conversation.**

A scripted chat — no LLM behind it — asks what your Space should be. The preview on the
right rebuilds as you answer. At the end you get a single standalone `index.html`, either
as a zip or pushed straight to your account as a static Space.

Live at [space.apartejs.dev](https://space.apartejs.dev).

## The double aparté

The same chat component runs on both sides of the screen, with opposite providers behind
it: a deterministic scenario on the left, real inference in the Space it writes. The
configurator is built with [aparté](https://apartejs.dev) and so is everything it
produces — which makes this product a working demonstration of the library's transport
layer rather than a description of it.

## What the generated Space is

One HTML file. No build step, no bundler, no backend, no account, and no cost to run.
aparté is loaded from jsDelivr at a pinned version, so a Space generated today keeps
working after this configurator has moved on.

The model runs in the visitor's own browser through ONNX and Transformers.js, which means
the page asks its visitors for nothing — no key, no login, no quota. Settings are read
from the Space's own variables, so the owner can swap the model, the prompt or the title
from the Hugging Face settings UI without editing the file.

**v1 ships browser inference only.** The `providers` and `endpoint` modes are part of the
`SpaceConfig` contract and will come back; today every generated Space runs on ONNX.

Both the configurator and the Spaces it writes speak **English and French**, and those are
two separate choices — you can configure in French a Space written in English. A Space can
also carry both, and follow each visitor's own browser.

## Development

```bash
pnpm install
pnpm dev
```

| Command | What it does |
|---|---|
| `pnpm dev` | The configurator, locally |
| `pnpm test` | The test suite (Vitest) |
| `pnpm check` | `svelte-check` — types and templates |
| `pnpm build` | The static bundle, into `dist/` |
| `pnpm preview` | Serves the build, to check what will ship |

Svelte 5 with runes, TypeScript in strict mode, Vite, and no UI framework — the interface
is built from aparté's own components and a small set of CSS tokens.

## Deployment

The site is a static bundle served by nginx. The `Dockerfile` builds `dist/` and serves
it; the final image carries neither Node, nor pnpm, nor the sources.

```bash
docker build -t aparte-spaces . && docker run --rm -p 8080:80 aparte-spaces
```

Nothing about the site itself involves Hugging Face — `space.apartejs.dev` is an ordinary
static site. It is the **Spaces it generates** that live on the Hub.

### Signing in to Hugging Face

Pushing a generated Space to someone's account needs their authorisation, and there are
two ways to get it. The configurator supports both, and picks whichever is available.

**A token, pasted by hand** — works everywhere, needs no setup, and is the fallback.

**OAuth**, which is the one worth having: one click, no token to copy. It needs a
[Connected App](https://huggingface.co/settings/connected-applications) registered on
Hugging Face, with the `openid profile read-repos write-repos` scopes and this site's URL
as a redirect. Pass its client id at **build** time:

```bash
docker build --build-arg VITE_HF_CLIENT_ID=xxxxxxxx -t aparte-spaces .
```

Build time, not run time: Vite inlines `VITE_*` into the bundle, so a value handed to the
container at start-up arrives after the page was built. In Coolify it goes in **Build
Variables**. The client id is not a secret — it travels in the authorisation URL — but a
token or a client secret must never be built in.

Hosted as a Hugging Face Space instead, none of this applies: the Hub injects
`OAUTH_CLIENT_ID` itself and the configurator reads it from the Space variables.

## License

MIT — see [LICENSE](LICENSE).
