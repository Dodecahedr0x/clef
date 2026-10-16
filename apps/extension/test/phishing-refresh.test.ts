import type { PhishingHit, PhishingList } from '@clef/wallet-core';
import { describe, expect, it, vi } from 'vitest';
import { PHISHING_ALARM, PHISHING_STORAGE_KEY, PhishingGuard, type PhishingGuardDeps } from '../lib/phishing';

const DAY_MIN = 24 * 60;
const SNAPSHOT = { version: 1, tolerance: 1, fuzzylist: [], whitelist: [], blacklist: ['old-evil.example'] };
const FRESH = { version: 2, tolerance: 1, fuzzylist: ['clef.app'], whitelist: [], blacklist: ['old-evil.example', 'new-evil.example'] };

// Stand-ins for @clef/wallet-core's parsePhishingConfig / PhishingDetector: strict shape check, exact match.
function parse(json: unknown): PhishingList {
  const j = json as Record<string, unknown>;
  if (typeof j !== 'object' || j === null || typeof j.version !== 'number' || !Array.isArray(j.blacklist)) throw new Error('bad config');
  return { version: j.version, tolerance: 1, fuzzylist: (j.fuzzylist as string[]) ?? [], whitelist: [], blacklist: j.blacklist as string[], fetchedAt: 0 };
}
const detector = (list: PhishingList) => ({
  check: (host: string): PhishingHit | null => (list.blacklist.includes(host) ? { reason: 'blocklist', match: host } : null),
});

function memStore(init: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(init));
  return {
    data,
    get: async <T>(k: string) => data.get(k) as T | undefined,
    set: async <T>(k: string, v: T) => void data.set(k, v),
  };
}

function fakeAlarms(existing = false) {
  const listeners: ((a: { name: string }) => void)[] = [];
  return {
    created: [] as [string, unknown][],
    get: vi.fn(async (name: string) => (existing ? { name } : undefined)),
    create(name: string, info: unknown) {
      this.created.push([name, info]);
    },
    onAlarm: { addListener: (cb: (a: { name: string }) => void) => void listeners.push(cb) },
    fire: (name: string) => listeners.forEach((l) => l({ name })),
  };
}

const okFetch = (body: unknown) =>
  vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

function guard(over: Partial<PhishingGuardDeps> = {}) {
  const store = memStore();
  const deps: PhishingGuardDeps = { snapshot: () => SNAPSHOT, parse, detector, store, fetch: okFetch(FRESH), url: 'https://list.example/config.json', now: () => 1000, ...over };
  return { g: new PhishingGuard(deps), store: deps.store as ReturnType<typeof memStore>, deps };
}

describe('PhishingGuard', () => {
  it('loads the bundled snapshot at startup and checks origins by hostname', async () => {
    const { g } = guard();
    await g.ready;
    expect(g.checkOrigin('https://old-evil.example')).toEqual({ reason: 'blocklist', match: 'old-evil.example' });
    expect(g.checkOrigin('https://old-evil.example:8443')).toEqual({ reason: 'blocklist', match: 'old-evil.example' });
    expect(g.checkOrigin('https://fine.example')).toBeNull();
    expect(g.status()).toEqual({ version: 1, fetchedAt: 0, domains: 1 });
  });

  it('never checks the wallet itself or non-web origins', async () => {
    const check = vi.fn(() => ({ reason: 'blocklist' as const, match: 'x' }));
    const { g } = guard({ detector: () => ({ check }) });
    await g.ready;
    expect(g.checkOrigin('clef://wallet')).toBeNull();
    expect(g.checkOrigin('not a url')).toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  it('refresh fetches the list, validates it, stores it and swaps the detector', async () => {
    const { g, store, deps } = guard({ now: () => 5000 });
    await g.ready;
    await g.refresh();
    expect(deps.fetch).toHaveBeenCalledWith('https://list.example/config.json', expect.objectContaining({ credentials: 'omit' }));
    expect(g.checkOrigin('https://new-evil.example')).toEqual({ reason: 'blocklist', match: 'new-evil.example' });
    expect(g.status()).toEqual({ version: 2, fetchedAt: 5000, domains: 3 });
    expect(store.data.get(PHISHING_STORAGE_KEY)).toMatchObject({ version: 2, fetchedAt: 5000, blacklist: FRESH.blacklist });
  });

  it('a stored list newer than the snapshot is used at startup', async () => {
    const store = memStore({ [PHISHING_STORAGE_KEY]: { ...FRESH, fetchedAt: 7 } });
    const { g } = guard({ store });
    await g.ready;
    expect(g.checkOrigin('https://new-evil.example')).not.toBeNull();
    expect(g.status().fetchedAt).toBe(7);
  });

  it('a corrupt stored list falls back to the snapshot', async () => {
    const store = memStore({ [PHISHING_STORAGE_KEY]: { nope: true } });
    const { g } = guard({ store });
    await g.ready;
    expect(g.status().version).toBe(1);
  });

  it.each([
    ['invalid config', okFetch({ hello: 'world' })],
    ['http error', vi.fn(async () => new Response('gone', { status: 503 })) as unknown as typeof fetch],
    ['not json', vi.fn(async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch],
    ['network failure', vi.fn(async () => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch],
  ])('a failed refresh (%s) throws and keeps the current list', async (_n, f) => {
    const { g, store } = guard({ fetch: f });
    await g.ready;
    await expect(g.refresh()).rejects.toThrow();
    expect(g.status().version).toBe(1);
    expect(store.data.has(PHISHING_STORAGE_KEY)).toBe(false);
  });

  it('schedules a daily refresh alarm once and refreshes when it fires', async () => {
    const { g } = guard();
    const alarms = fakeAlarms();
    const onError = vi.fn();
    await g.schedule(alarms, onError);
    expect(alarms.created).toEqual([[PHISHING_ALARM, { delayInMinutes: 1, periodInMinutes: DAY_MIN }]]);
    alarms.fire('clef-autolock');
    alarms.fire(PHISHING_ALARM);
    await vi.waitFor(() => expect(g.status().version).toBe(2));
    expect(onError).not.toHaveBeenCalled();

    const again = fakeAlarms(true);
    await g.schedule(again, onError);
    expect(again.created).toEqual([]);
  });

  it('reports a failed scheduled refresh instead of throwing', async () => {
    const { g } = guard({ fetch: okFetch({ bad: 1 }) });
    const alarms = fakeAlarms();
    const onError = vi.fn();
    await g.schedule(alarms, onError);
    alarms.fire(PHISHING_ALARM);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
  });
});
