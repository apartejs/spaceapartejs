/**
 * The session and the push, over a mocked `@huggingface/hub` and a mocked `localStorage`
 * — no network, no real storage, ever.
 *
 * These are the paths where a mistake is expensive: a session that outlives its token, a
 * refusal the user never hears about, a Space pushed under a name nobody asked for. Every
 * private helper is exercised through the exported door that uses it, so the tests keep
 * holding when the internals are rearranged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// —————————————————————————————————————————————————————————————————————————————
// Harness
// —————————————————————————————————————————————————————————————————————————————

const hub = vi.hoisted(() => ({
  createRepo: vi.fn(),
  uploadFiles: vi.fn(),
  whoAmI: vi.fn(),
  oauthLoginUrl: vi.fn(),
  oauthHandleRedirectIfPresent: vi.fn(),
}));

vi.mock('@huggingface/hub', () => hub);

import {
  getSession,
  handleRedirect,
  hasScope,
  pushSpace,
  signInWithToken,
  signOut,
  SPACE_OAUTH_SCOPES,
} from './oauth';

const STORAGE_KEY = 'aparte-spaces:hf-session:v1';
const DAY = 24 * 60 * 60 * 1000;

interface FakeStorage extends Storage {
  /** Make the next reads throw, the way a locked-down browser does. */
  breakReads(): void;
}

function fakeStorage(): FakeStorage {
  const map = new Map<string, string>();
  let broken = false;
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem(key: string) {
      if (broken) throw new DOMException('The operation is insecure.', 'SecurityError');
      return map.get(key) ?? null;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem(key: string) {
      if (broken) throw new DOMException('The operation is insecure.', 'SecurityError');
      map.delete(key);
    },
    setItem(key: string, value: string) {
      if (broken) throw new DOMException('The operation is insecure.', 'SecurityError');
      map.set(key, String(value));
    },
    breakReads() {
      broken = true;
    },
  };
}

let storage: FakeStorage;

/** Put a session in storage without going through the module that writes them. */
function store(overrides: Record<string, unknown> = {}): void {
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      accessToken: 'hf_stored',
      user: { name: 'maxituc', fullname: 'Max', avatarUrl: 'https://huggingface.co/avatars/x.svg' },
      expiresAt: Date.now() + DAY,
      scopes: ['openid', 'profile', 'read-repos', 'write-repos'],
      ...overrides,
    }),
  );
}

/** jsdom gives us a real History API: this is how the OAuth query string gets set. */
function visit(search: string): void {
  window.history.replaceState({}, '', `/${search}`);
}

const FILES = [{ path: 'index.html', content: '<!doctype html>' }];

beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal('localStorage', storage);
  visit('');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

// —————————————————————————————————————————————————————————————————————————————
// The stored session
// —————————————————————————————————————————————————————————————————————————————

describe('getSession', () => {
  it('reads a live session back, without the token', () => {
    store();

    const session = getSession();

    expect(session?.user.name).toBe('maxituc');
    expect(session?.scopes).toContain('write-repos');
    expect(session && 'accessToken' in session).toBe(false);
    expect(JSON.stringify(session)).not.toContain('hf_stored');
  });

  it('is null when nothing was ever stored', () => {
    expect(getSession()).toBeNull();
  });

  it('drops an expired session, and forgets it', () => {
    store({ expiresAt: Date.now() - 1 });

    expect(getSession()).toBeNull();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('refuses a session with no expiry rather than treating it as eternal', () => {
    store({ expiresAt: undefined });
    expect(getSession()).toBeNull();
  });

  it('survives a corrupt payload', () => {
    storage.setItem(STORAGE_KEY, '{not json at all');
    expect(getSession()).toBeNull();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();

    storage.setItem(STORAGE_KEY, JSON.stringify({ user: { name: 'maxituc' } })); // no token
    expect(getSession()).toBeNull();

    storage.setItem(STORAGE_KEY, JSON.stringify({ accessToken: 'hf_x', expiresAt: Date.now() + DAY }));
    expect(getSession()).toBeNull(); // no user
  });

  it('fills in the optional halves of the user', () => {
    store({ user: { name: 'maxituc' } });

    const session = getSession();
    expect(session?.user.fullname).toBeNull();
    expect(session?.user.avatarUrl).toBeNull();
  });

  it('treats non-array scopes as no scopes', () => {
    store({ scopes: 'write-repos' });

    expect(getSession()?.scopes).toEqual([]);
    expect(hasScope('write-repos')).toBe(false);
  });

  it('returns null instead of throwing when storage itself is blocked', () => {
    store();
    storage.breakReads();

    expect(() => getSession()).not.toThrow();
    expect(getSession()).toBeNull();
    expect(hasScope('write-repos')).toBe(false);
  });

  it('does not throw when signing out of blocked storage', () => {
    storage.breakReads();
    expect(() => signOut()).not.toThrow();
  });
});

// —————————————————————————————————————————————————————————————————————————————
// signInWithToken — scopes and avatar come from the Hub, not from a guess
// —————————————————————————————————————————————————————————————————————————————

describe('signInWithToken', () => {
  it('derives the scopes from the token role the Hub reports', async () => {
    hub.whoAmI.mockResolvedValue({
      type: 'user',
      name: 'maxituc',
      fullname: 'Max',
      avatarUrl: '/avatars/x.svg',
      auth: { type: 'access_token', accessToken: { displayName: 'laptop', role: 'read' } },
    });

    const session = await signInWithToken('  hf_pasted  ');

    // A read-only token must not advertise a push it cannot perform.
    expect(session.scopes).toEqual(['openid', 'profile', 'read-repos']);
    expect(hasScope('write-repos')).toBe(false);
  });

  it('grants write for a write/admin/contributor token', async () => {
    for (const role of ['write', 'admin', 'contributor']) {
      hub.whoAmI.mockResolvedValue({
        type: 'user',
        name: 'maxituc',
        auth: { type: 'access_token', accessToken: { displayName: 't', role } },
      });

      const session = await signInWithToken('hf_pasted');
      expect(session.scopes).toContain('write-repos');
    }
  });

  it('falls back to the requested scopes when the Hub reports no role', async () => {
    hub.whoAmI.mockResolvedValue({ type: 'user', name: 'maxituc', auth: { type: 'access_token' } });

    const session = await signInWithToken('hf_pasted');
    expect(session.scopes).toEqual(SPACE_OAUTH_SCOPES.split(' '));
    expect(session.scopes).not.toContain('inference-api');
  });

  it('resolves the relative avatar against the Hub', async () => {
    hub.whoAmI.mockResolvedValue({
      type: 'user',
      name: 'maxituc',
      avatarUrl: '/avatars/x.svg',
      auth: { type: 'access_token', accessToken: { role: 'write' } },
    });

    const session = await signInWithToken('hf_pasted');
    expect(session.user.avatarUrl).toBe('https://huggingface.co/avatars/x.svg');
  });

  it('honours an expiry the Hub declares, and never exceeds a day', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    hub.whoAmI.mockResolvedValue({
      type: 'user',
      name: 'maxituc',
      auth: { type: 'access_token', accessToken: { role: 'write' }, expiresAt: soon },
    });
    expect((await signInWithToken('hf_pasted')).expiresAt).toBe(soon.getTime());

    hub.whoAmI.mockResolvedValue({
      type: 'user',
      name: 'maxituc',
      auth: { type: 'access_token', accessToken: { role: 'write' }, expiresAt: new Date(Date.now() + 40 * DAY) },
    });
    expect((await signInWithToken('hf_pasted')).expiresAt).toBeLessThanOrEqual(Date.now() + DAY);
  });

  it('refuses an empty token without asking the Hub', async () => {
    await expect(signInWithToken('   ')).rejects.toThrow('empty');
    expect(hub.whoAmI).not.toHaveBeenCalled();
  });
});

// —————————————————————————————————————————————————————————————————————————————
// handleRedirect — a refusal is a result, not silence
// —————————————————————————————————————————————————————————————————————————————

describe('handleRedirect', () => {
  it('reports a declined consent instead of pretending nothing happened', async () => {
    visit('?error=access_denied&error_description=The+user+denied+the+request');
    hub.oauthHandleRedirectIfPresent.mockRejectedValue(
      new Error('access_denied: The user denied the request'),
    );

    const outcome = await handleRedirect();

    expect(outcome.session).toBeNull();
    expect(outcome.error?.code).toBe('access_denied');
    expect(outcome.error?.message).toContain('declined');
    // …and the address bar no longer carries the refusal, so a reload is not a rerun.
    expect(window.location.search).toBe('');
  });

  it('keeps the stored session when a stale code fails to exchange', async () => {
    store();
    visit('?code=stale&state=whatever');
    hub.oauthHandleRedirectIfPresent.mockRejectedValue(new Error('Missing oauth nonce'));

    const outcome = await handleRedirect();

    expect(outcome.session?.user.name).toBe('maxituc');
    expect(outcome.error?.code).toBe('exchange_failed');
    expect(outcome.error?.message).toContain('Missing oauth nonce');
    expect(window.location.search).toBe('');
  });

  it('stores the session a successful exchange brings back', async () => {
    visit('?code=fresh&state=whatever&keep=me');
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    hub.oauthHandleRedirectIfPresent.mockResolvedValue({
      accessToken: 'hf_fresh',
      accessTokenExpiresAt: expiresAt,
      scope: 'openid profile read-repos write-repos',
      userInfo: { preferred_username: 'maxituc', name: 'Max', picture: '/avatars/x.svg' },
    });

    const outcome = await handleRedirect();

    expect(outcome.error).toBeNull();
    expect(outcome.session?.user.name).toBe('maxituc');
    expect(outcome.session?.user.avatarUrl).toBe('https://huggingface.co/avatars/x.svg');
    expect(outcome.session?.expiresAt).toBe(expiresAt.getTime());
    expect(outcome.session?.scopes).toContain('write-repos');
    // Only the OAuth parameters are consumed — the rest of the query string is not ours.
    expect(window.location.search).toBe('?keep=me');
  });

  it('is a no-op on an ordinary page load', async () => {
    store();
    hub.oauthHandleRedirectIfPresent.mockResolvedValue(false);

    const outcome = await handleRedirect();

    expect(outcome.error).toBeNull();
    expect(outcome.session?.user.name).toBe('maxituc');
  });

  it('never leaks the token into the error message', async () => {
    visit('?code=fresh');
    hub.oauthHandleRedirectIfPresent.mockRejectedValue(new Error('boom while exchanging'));

    const outcome = await handleRedirect();
    expect(outcome.error?.message).not.toContain('fresh');
    expect(outcome.error?.message).toContain('boom while exchanging');
  });
});

// —————————————————————————————————————————————————————————————————————————————
// pushSpace — the repo id, the create, the subdomain
// —————————————————————————————————————————————————————————————————————————————

describe('pushSpace / repo id', () => {
  beforeEach(() => {
    store();
    hub.createRepo.mockResolvedValue({ repoUrl: 'https://huggingface.co/spaces/x', id: 'x' });
    hub.uploadFiles.mockResolvedValue({ commit: { oid: 'abc' } });
  });

  it('slugifies a bare name under the signed-in owner', async () => {
    const result = await pushSpace(FILES, { repoName: '  My Grand Space  ' });

    expect(result.repoId).toBe('maxituc/my-grand-space');
    expect(result.url).toBe('https://huggingface.co/spaces/maxituc/my-grand-space');
    expect(hub.whoAmI).not.toHaveBeenCalled(); // the session already knows the owner
  });

  it('keeps an explicit owner and slugifies only the name', async () => {
    const result = await pushSpace(FILES, { repoName: 'An-Org/My Space' });
    expect(result.repoId).toBe('An-Org/my-space');
  });

  it('forgives the slashes people paste', async () => {
    expect((await pushSpace(FILES, { repoName: '/maxituc/my-space/' })).repoId).toBe(
      'maxituc/my-space',
    );
    expect((await pushSpace(FILES, { repoName: 'maxituc//my-space' })).repoId).toBe(
      'maxituc/my-space',
    );
  });

  it('refuses an id with one slash too many, and says why', async () => {
    await expect(pushSpace(FILES, { repoName: 'a/b/c' })).rejects.toThrow(/one slash too many/);
    expect(hub.createRepo).not.toHaveBeenCalled();
  });

  it('refuses a name with nothing usable in it', async () => {
    await expect(pushSpace(FILES, { repoName: '   ' })).rejects.toThrow('The Space needs a name.');
    await expect(pushSpace(FILES, { repoName: '///' })).rejects.toThrow('The Space needs a name.');
    await expect(pushSpace(FILES, { repoName: '🛸🛸' })).rejects.toThrow(/nothing usable/);
  });

  it('asks the Hub who we are only when there is no session', async () => {
    signOut();
    hub.whoAmI.mockResolvedValue({ type: 'user', name: 'from-token' });

    const result = await pushSpace(FILES, { repoName: 'my-space', token: 'hf_explicit' });

    expect(result.repoId).toBe('from-token/my-space');
    expect(hub.whoAmI).toHaveBeenCalledWith({ accessToken: 'hf_explicit' });
  });

  it('refuses to push without a token at all', async () => {
    signOut();
    await expect(pushSpace(FILES, { repoName: 'my-space' })).rejects.toThrow(/Sign in/);
  });

  it('refuses to push nothing', async () => {
    await expect(pushSpace([], { repoName: 'my-space' })).rejects.toThrow(/nothing to push/);
  });

  it('builds the subdomain the Space is actually served on', async () => {
    const result = await pushSpace(FILES, { repoName: 'An-Org/My_Space' });
    expect(result.spaceUrl).toBe('https://an-org-my-space.hf.space');
  });
});

describe('pushSpace / creating the repo', () => {
  beforeEach(() => {
    store();
    hub.uploadFiles.mockResolvedValue({ commit: { oid: 'abc' } });
  });

  it('creates a static Space in one call, and says it created it', async () => {
    hub.createRepo.mockResolvedValue({ repoUrl: 'u', id: 'i' });

    const result = await pushSpace(FILES, { repoName: 'my-space' });

    expect(result.created).toBe(true);
    expect(hub.createRepo).toHaveBeenCalledTimes(1);
    expect(hub.createRepo.mock.calls[0]?.[0]).toMatchObject({
      sdk: 'static',
      visibility: 'public',
      repo: { type: 'space', name: 'maxituc/my-space' },
    });
    expect(hub.uploadFiles).toHaveBeenCalledTimes(1);
  });

  it('marks a private Space private', async () => {
    hub.createRepo.mockResolvedValue({ repoUrl: 'u', id: 'i' });
    await pushSpace(FILES, { repoName: 'my-space', private: true });
    expect(hub.createRepo.mock.calls[0]?.[0]).toMatchObject({ visibility: 'private' });
  });

  it('pushes into an existing Space when the Hub answers 409', async () => {
    hub.createRepo.mockRejectedValue(Object.assign(new Error('Api error with status 409'), {
      statusCode: 409,
    }));

    const result = await pushSpace(FILES, { repoName: 'my-space' });

    expect(result.created).toBe(false);
    expect(hub.createRepo).toHaveBeenCalledTimes(1); // no byte-identical retry
    expect(hub.uploadFiles).toHaveBeenCalledTimes(1);
  });

  it('recognises "already exists" from the message alone', async () => {
    hub.createRepo.mockRejectedValue(new Error('You already created this model repo'));

    const result = await pushSpace(FILES, { repoName: 'my-space' });

    expect(result.created).toBe(false);
    expect(hub.uploadFiles).toHaveBeenCalledTimes(1);
  });

  it('gives up on an unrelated failure instead of retrying it', async () => {
    hub.createRepo.mockRejectedValue(new Error('Api error with status 403. Forbidden'));

    await expect(pushSpace(FILES, { repoName: 'my-space' })).rejects.toThrow(
      /The Space maxituc\/my-space could not be created: .*Forbidden/,
    );
    expect(hub.createRepo).toHaveBeenCalledTimes(1);
    expect(hub.uploadFiles).not.toHaveBeenCalled();
  });

  it('names the repo when the upload is what failed', async () => {
    hub.createRepo.mockResolvedValue({ repoUrl: 'u', id: 'i' });
    hub.uploadFiles.mockRejectedValue(new Error('413 Payload Too Large'));

    await expect(pushSpace(FILES, { repoName: 'my-space' })).rejects.toThrow(
      /could not be pushed to maxituc\/my-space: 413/,
    );
  });
});
