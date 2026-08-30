/**
 * Sign in with Hugging Face, and push a generated Space — entirely from the browser.
 *
 * Two homes, one flow: hosted as a static HF Space the OAuth app is handed to us in
 * `window.huggingface.variables`; on a plain domain (space.apartejs.dev, or localhost)
 * we supply our own client id, scopes and redirect URL.
 *
 * WHAT THE CONFIGURATOR SIGNS IN FOR (v1): reading a repo the visitor can read, and
 * pushing the generated Space. Nothing else. The GENERATED Space has no login at all —
 * it runs transformers.js in the visitor's browser, so it never sees a token.
 *
 * ABOUT THE TOKEN — no illusions. It lives in `localStorage` under a fixed key, which
 * means any script running on this origin can read it: a dependency, an injected script,
 * a devtools paste. `getSession()` returning a token-free view and `getToken()` being the
 * one documented door are ergonomics, not security; the storage is as exposed as the page.
 * Two invariants follow, and they are not negotiable:
 *   1. the preview iframe MUST be sandboxed WITHOUT `allow-same-origin` — with it, the
 *      generated page (built from text the user typed) becomes same-origin and can read
 *      this key outright;
 *   2. the token is never logged, never put in a URL, and never included in an error
 *      message — including the ones this module builds.
 */

import {
  createRepo,
  oauthHandleRedirectIfPresent,
  oauthLoginUrl,
  uploadFiles,
  whoAmI,
  type RepoDesignation,
} from '@huggingface/hub';
import { slugify } from '../config/space-config';
import type { GeneratedFile } from '../generator/types';
import type { HubUser } from './types';

/**
 * What the product actually needs:
 * - `read-repos`  — scan a private or gated model the user can read;
 * - `write-repos` — create the Space and push the files.
 *
 * `openid profile` is what gives us a username to show.
 *
 * TWO repo scopes, because this product does two different things with a Space.
 * `contribute-repos` is the one that says CREATE — "create and manage repos created by
 * this app only", which is exactly `createRepo` and nothing wider. `write-repos` is for
 * the second push onto a Space that already exists, possibly made by hand rather than by
 * us. `manage-repos` would cover both and is refused on purpose: it grants full
 * management of every repository the person owns, to a tool that writes two files.
 *
 * `inference-api` is deliberately absent: v1 generates browser/ONNX Spaces only, so
 * neither the configurator nor the Space it writes ever calls inference on the user's
 * behalf. Asking for a scope we do not use is a consent screen we cannot justify.
 */
export const SPACE_OAUTH_SCOPES =
  'openid profile read-repos write-repos contribute-repos';

/** Bump the suffix rather than migrating: a stale session is only a re-login. */
const STORAGE_KEY = 'aparte-spaces:hf-session:v1';

/** Everything the Hub serves relative URLs against. */
const HUB_URL = 'https://huggingface.co';

/** The signed-in user, minus anything secret. */
export interface HubSession {
  user: HubUser;
  /** Epoch ms. A session past this is treated as signed out. */
  expiresAt: number;
  /** Scopes actually granted — enough to tell "can push" from "can only look". */
  scopes: string[];
}

interface StoredSession extends HubSession {
  accessToken: string;
}

/** Why a sign-in did not happen. Never carries the token. */
export interface OAuthFailure {
  /**
   * `access_denied` when the visitor refused on the Hub, whatever else the Hub sent, or
   * `exchange_failed` when the code came back but could not be traded for a token.
   */
  code: string;
  /**
   * Fit for a chat bubble. UNTRUSTED: it can quote text the Hub sent us. It is bounded
   * and stripped of `<>&"'` here, but render it as TEXT — never as HTML.
   */
  message: string;
}

/** What `handleRedirect()` learned. A fresh session and an error are mutually exclusive. */
export interface RedirectOutcome {
  /** The session after the redirect: the fresh one, the one already stored, or null. */
  session: HubSession | null;
  /** Non-null when the Hub refused or the exchange failed — say so, do not stay silent. */
  error: OAuthFailure | null;
}

export interface PushSpaceOptions {
  /** `my-space`, or `owner/my-space` to push into an org. */
  repoName: string;
  /** Defaults to public — a Space nobody can open is rarely the point. */
  private?: boolean;
  /** Defaults to the stored session's token. */
  token?: string;
}

export interface PushSpaceResult {
  /** `owner/name`. */
  repoId: string;
  /** The repo page on the Hub. */
  url: string;
  /** The running Space itself, `https://owner-name.hf.space`. */
  spaceUrl: string;
  /** False when the repo already existed and we only pushed a new commit. */
  created: boolean;
}

// —————————————————————————————————————————————————————————————————————————————
// Session
// —————————————————————————————————————————————————————————————————————————————

/** The current session, or null when signed out or expired. */
export function getSession(): HubSession | null {
  const stored = readStored();
  if (!stored) return null;
  // Rebuilt field by field rather than spread-minus-token: it is impossible to leak
  // something you never copy.
  return { user: stored.user, expiresAt: stored.expiresAt, scopes: stored.scopes };
}

/**
 * The access token, for the callers that genuinely need one: scanning a repo the visitor
 * can read, and `pushSpace`. Treat it as write-only — never render it, never log it.
 */
export function getToken(): string | null {
  return readStored()?.accessToken ?? null;
}

/** Whether the granted scopes cover an operation (`read-repos`, `write-repos`). */
export function hasScope(scope: string): boolean {
  return getSession()?.scopes.includes(scope) ?? false;
}

/**
 * Leave for the Hub's consent screen. Resolves only if the redirect somehow does not
 * happen; on success the browser navigates away and `handleRedirect()` picks it up.
 */
export async function signIn(options: { redirectUrl?: string } = {}): Promise<void> {
  const url = await oauthLoginUrl(loginOptions(options.redirectUrl));
  window.location.href = url;
}

/**
 * Local escape hatch: adopt a pasted fine-grained token. OAuth needs a registered app and
 * an allowed redirect URL, which nobody has on `localhost` on day one — this keeps the
 * whole product usable there. `whoAmI` doubles as the validity check.
 */
export async function signInWithToken(token: string): Promise<HubSession> {
  const accessToken = token.trim();
  if (!accessToken) throw new Error('That token is empty.');

  const me = await whoAmI({ accessToken });
  // `auth` is declared non-optional by the library; the `?.` is for the day the Hub ships
  // a payload without it — this is the only place we read someone else's JSON as truth.
  const auth = me.auth;

  const session: StoredSession = {
    accessToken,
    user: {
      name: me.name ?? 'you',
      fullname: 'fullname' in me ? (me.fullname ?? null) : null,
      avatarUrl: 'avatarUrl' in me ? absoluteAvatarUrl(me.avatarUrl) : null,
    },
    // The Hub tells us when the token dies if it is going to; otherwise a day is a sane
    // re-check window for something we cannot introspect.
    expiresAt: expiryOf(auth?.expiresAt),
    // Not guessed: `whoAmI` reports the token's role, which is what the Hub will enforce.
    scopes: scopesForRole(auth?.accessToken?.role),
  };
  writeStored(session);
  return { user: session.user, expiresAt: session.expiresAt, scopes: session.scopes };
}

/**
 * Call once on boot. Consumes an OAuth redirect if the URL carries one, scrubs the code
 * (and any error) out of the address bar, and otherwise returns whatever session was
 * already stored.
 *
 * A refusal is a result, not silence: a visitor who declines consent on the Hub comes back
 * with `?error=access_denied`, and this returns `{ session, error }` so the caller can say
 * so out loud instead of pretending the click never happened.
 */
export async function handleRedirect(): Promise<RedirectOutcome> {
  // Read straight from the URL rather than parsing the library's exception message: the
  // Hub's `error` code is the one thing we can report precisely.
  const refusal = readRefusal();

  let result: Awaited<ReturnType<typeof oauthHandleRedirectIfPresent>> = false;
  try {
    result = await oauthHandleRedirectIfPresent();
  } catch (cause) {
    scrubOAuthParams();
    return {
      session: getSession(),
      error: refusal ?? {
        code: 'exchange_failed',
        // A stale or replayed `?code=` lands here too — worth a sentence, never a stack.
        message: `The Hugging Face sign-in could not be completed: ${safeText(readable(cause), 200)}`,
      },
    };
  }

  if (!result) {
    if (!refusal) return { session: getSession(), error: null };
    scrubOAuthParams();
    return { session: getSession(), error: refusal };
  }

  const info = result.userInfo;
  writeStored({
    accessToken: result.accessToken,
    user: {
      name: info.preferred_username,
      fullname: info.name || null,
      avatarUrl: absoluteAvatarUrl(info.picture),
    },
    expiresAt: result.accessTokenExpiresAt.getTime(),
    scopes: (result.scope || SPACE_OAUTH_SCOPES).split(' ').filter(Boolean),
  });
  scrubOAuthParams();
  return { session: getSession(), error: null };
}

/** Forget the session locally. The token stays valid on the Hub until it expires. */
export function signOut(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage disabled — nothing was persisted in the first place.
  }
}

// —————————————————————————————————————————————————————————————————————————————
// Push
// —————————————————————————————————————————————————————————————————————————————

/**
 * Create (or reuse) a static Space and commit the generated files to it.
 *
 * A static Space needs no build step: the moment `README.md` (with `sdk: static`) and
 * `index.html` land, the Space is RUNNING.
 */
export async function pushSpace(
  files: GeneratedFile[],
  options: PushSpaceOptions,
): Promise<PushSpaceResult> {
  if (files.length === 0) throw new Error('There is nothing to push yet.');

  const accessToken = options.token?.trim() || getToken();
  if (!accessToken) throw new Error('Sign in with Hugging Face first — pushing needs write access.');

  const repoId = await resolveRepoId(options.repoName, accessToken);
  const repo: RepoDesignation = { type: 'space', name: repoId };
  const created = await ensureSpaceRepo(repo, repoId, accessToken, options.private === true);

  try {
    await uploadFiles({
      repo,
      accessToken,
      commitTitle: 'Generated with aparté Spaces',
      files: files.map((file) => ({ path: file.path, content: new Blob([file.content]) })),
    });
  } catch (error) {
    throw new Error(`The files could not be pushed to ${repoId}: ${readable(error)}`);
  }

  return {
    repoId,
    url: `${HUB_URL}/spaces/${repoId}`,
    spaceUrl: `https://${spaceSubdomain(repoId)}.hf.space`,
    created,
  };
}

// —————————————————————————————————————————————————————————————————————————————
// Internals
// —————————————————————————————————————————————————————————————————————————————

/** `window.huggingface.variables` — only present when we are served from a Space. */
function spaceVariables(): Record<string, string | undefined> | null {
  const globals = globalThis as {
    huggingface?: { variables?: Record<string, string | undefined> };
  };
  return globals.huggingface?.variables ?? null;
}

function loginOptions(redirectUrl?: string): {
  clientId?: string;
  scopes?: string;
  redirectUrl?: string;
} {
  const variables = spaceVariables();
  if (variables?.['OAUTH_CLIENT_ID']) {
    // Hosted as a Space: the Hub injected the app, and any URL inside the Space is an
    // allowed redirect — so we let the library default to the current one.
    return {
      clientId: variables['OAUTH_CLIENT_ID'],
      scopes: variables['OAUTH_SCOPES'] || SPACE_OAUTH_SCOPES,
      ...(redirectUrl ? { redirectUrl } : {}),
    };
  }

  const clientId = viteEnv('VITE_HF_CLIENT_ID');
  if (!clientId) {
    throw new Error(
      'No Hugging Face OAuth app is configured for this domain. ' +
        'Set VITE_HF_CLIENT_ID (a Connected App with the openid, profile, read-repos and ' +
        'write-repos scopes), or sign in with a token instead.',
    );
  }
  return {
    clientId,
    scopes: SPACE_OAUTH_SCOPES,
    redirectUrl: redirectUrl ?? currentUrlWithoutQuery(),
  };
}

function viteEnv(key: string): string | undefined {
  const value: unknown = import.meta.env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function currentUrlWithoutQuery(): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}`;
}

/** The Hub's `?error=…` for this page load, if it sent one. */
function readRefusal(): OAuthFailure | null {
  let params: URLSearchParams;
  try {
    params = new URL(window.location.href).searchParams;
  } catch {
    return null;
  }

  const code = params.get('error');
  if (!code) return null;

  const safeCode = safeText(code, 60);
  const headline =
    safeCode === 'access_denied'
      ? 'The Hugging Face sign-in was declined, so nothing was connected.'
      : `Hugging Face refused the sign-in (${safeCode}).`;
  const description = params.get('error_description');

  return {
    code: safeCode,
    message: description ? `${headline} ${safeText(description, 200)}` : headline,
  };
}

/**
 * Take the OAuth round-trip out of the address bar so a reload is neither a failed second
 * exchange nor a second copy of the same refusal.
 */
function scrubOAuthParams(): void {
  const consumed = ['code', 'state', 'error', 'error_description', 'error_uri'];
  try {
    const url = new URL(window.location.href);
    if (!consumed.some((param) => url.searchParams.has(param))) return;
    for (const param of consumed) url.searchParams.delete(param);
    const query = url.searchParams.toString();
    window.history.replaceState({}, '', `${url.pathname}${query ? `?${query}` : ''}${url.hash}`);
  } catch {
    // No History API (or an exotic URL) — a stale query string is harmless.
  }
}

function readStored(): StoredSession | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // Private mode, or storage blocked.
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession> | null;
    if (!parsed?.accessToken || !parsed.user?.name) return null;
    if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= Date.now()) {
      signOut();
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      user: {
        name: parsed.user.name,
        fullname: parsed.user.fullname ?? null,
        avatarUrl: parsed.user.avatarUrl ?? null,
      },
      expiresAt: parsed.expiresAt,
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes : [],
    };
  } catch {
    signOut();
    return null;
  }
}

function writeStored(session: StoredSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage blocked: the session simply will not survive a reload.
  }
}

/**
 * `My Space` → `you/my-space`, `an-org/My Space` → `an-org/my-space`.
 *
 * The name goes through the same `slugify()` the rest of the configurator uses, so what we
 * push under is what the title suggested — and a third slash is refused rather than sent to
 * the Hub to be rejected there.
 */
async function resolveRepoId(repoName: string, accessToken: string): Promise<string> {
  const raw = repoName.trim().replace(/^\/+|\/+$/g, '');
  if (!raw) throw new Error('The Space needs a name.');

  const parts = raw.split('/').filter((part) => part.trim().length > 0);
  if (parts.length > 2) {
    throw new Error(
      `"${safeText(raw)}" has one slash too many — a Space is "my-space", or "owner/my-space".`,
    );
  }

  const name = slugify(parts[parts.length - 1] ?? '');
  if (!name) {
    throw new Error(
      `"${safeText(raw)}" leaves nothing usable as a Space name — letters, digits, "-" or "_".`,
    );
  }

  if (parts.length === 2) {
    const owner = (parts[0] ?? '').trim();
    if (!/^[\w.-]+$/.test(owner)) {
      throw new Error(`"${safeText(owner)}" is not a Hugging Face user or organisation name.`);
    }
    return `${owner}/${name}`;
  }

  const owner = getSession()?.user.name ?? (await whoAmI({ accessToken })).name;
  return `${owner}/${name}`;
}

/**
 * @returns true when the repo was created, false when it already existed.
 *
 * One attempt, no retry: `createRepo` defaults `sdk` to `"static"` for a space repo, so the
 * fallback that used to live here re-sent a byte-identical request and could only fail the
 * same way twice.
 */
async function ensureSpaceRepo(
  repo: RepoDesignation,
  repoId: string,
  accessToken: string,
  isPrivate: boolean,
): Promise<boolean> {
  try {
    await createRepo({
      repo,
      accessToken,
      sdk: 'static',
      visibility: isPrivate ? 'private' : 'public',
    });
    return true;
  } catch (error) {
    if (isAlreadyExists(error)) return false;
    throw new Error(`The Space ${repoId} could not be created: ${readable(error)}`);
  }
}

function isAlreadyExists(error: unknown): boolean {
  if ((error as { statusCode?: unknown })?.statusCode === 409) return true;
  return /already (exists|created|been created)/i.test(readable(error));
}

/** An error message fit for a chat bubble — never a stack, never a token. */
function readable(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

/**
 * Text from the user or from the Hub, on its way into something we display: bounded, and
 * stripped of the characters that turn a message into markup.
 */
function safeText(value: string, max = 60): string {
  const cleaned = value.replace(/[<>&"']/g, '').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

/**
 * `whoAmI` answers with a ROOT-RELATIVE avatar (`/avatars/x.svg`), which resolves against
 * whatever origin this page happens to be on — a broken image everywhere but the Hub.
 * Anything that is not http(s) is dropped rather than handed to an `<img src>`.
 */
function absoluteAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, HUB_URL);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The token's role, as the Hub reports it, expressed in the scope vocabulary the rest of
 * the app speaks. `contributor` can write to the repos it contributes to, so it is offered
 * `write-repos` and the API stays the final judge.
 */
function scopesForRole(role: string | undefined): string[] {
  switch (role) {
    case 'read':
      return ['openid', 'profile', 'read-repos'];
    case 'write':
    case 'admin':
    case 'contributor':
      return ['openid', 'profile', 'read-repos', 'write-repos'];
    default:
      // No role in the payload: assume what the OAuth flow asks for, and let the first
      // real call be the judge. Guessing narrow would lock a valid token out of pushing.
      return SPACE_OAUTH_SCOPES.split(' ');
  }
}

/** A day, unless the Hub told us the token dies sooner. */
function expiryOf(expiresAt: Date | undefined): number {
  const fallback = Date.now() + 24 * 60 * 60 * 1000;
  const declared = expiresAt instanceof Date ? expiresAt.getTime() : NaN;
  return Number.isFinite(declared) && declared > Date.now() ? Math.min(declared, fallback) : fallback;
}

/** `owner/My_Space` → `owner-my-space`, the subdomain the Space is actually served on. */
function spaceSubdomain(repoId: string): string {
  return repoId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
