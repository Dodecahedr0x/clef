import { BUNDLED_PHISHING_LIST, PHISHING_LIST_URL, PhishingListStore } from '@clef/wallet-core';
import { describe, expect, it, vi } from 'vitest';
import { PHISHING_ALARM, schedulePhishingRefresh } from '../lib/phishing';

const DAY_MIN = 24 * 60;
const FRESH = { version: 99, tolerance: 1, fuzzylist: ['clef.app'], whitelist: [], blacklist: ['new-evil.example'] };

function memStore() {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T>(k: string) => data.get(k) as T | undefined,
    set: async <T>(k: string, v: T) => void data.set(k, v),
    remove: async (k: string) => void data.delete(k),
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

const respond = (body: string, status = 200) => vi.fn(async (_u: string, _i?: RequestInit) => new Response(body, { status }));

function setup(fetch = respond(JSON.stringify(FRESH))) {
  const store = memStore();
  const list = new PhishingListStore({ store, fetch: fetch as unknown as typeof globalThis.fetch, now: () => BUNDLED_PHISHING_LIST.fetchedAt + 1 });
  return { store, list, fetch };
}

describe('phishing list in the background', () => {
  it('starts from the bundled snapshot', async () => {
    const { list } = setup();
    expect(BUNDLED_PHISHING_LIST.blacklist.length).toBeGreaterThan(1000);
    expect(await list.status()).toMatchObject({ version: BUNDLED_PHISHING_LIST.version, fetchedAt: BUNDLED_PHISHING_LIST.fetchedAt });
    const blocked = BUNDLED_PHISHING_LIST.blacklist[0]!;
    expect(await list.check(blocked)).toEqual({ reason: 'blocklist', match: blocked });
  });

  it('schedules a daily alarm once; firing it downloads, validates and stores the list', async () => {
    const { list, store, fetch } = setup();
    const alarms = fakeAlarms();
    const onError = vi.fn();
    await schedulePhishingRefresh(alarms, list, onError);
    expect(alarms.created).toEqual([[PHISHING_ALARM, { delayInMinutes: 1, periodInMinutes: DAY_MIN }]]);

    alarms.fire('clef-autolock');
    expect(fetch).not.toHaveBeenCalled();
    alarms.fire(PHISHING_ALARM);
    await vi.waitFor(async () => expect((await list.status()).version).toBe(99));
    expect(fetch).toHaveBeenCalledWith(PHISHING_LIST_URL, expect.objectContaining({ credentials: 'omit' }));
    expect(await list.check('new-evil.example')).toEqual({ reason: 'blocklist', match: 'new-evil.example' });
    expect([...store.data.values()]).toContainEqual(expect.objectContaining({ version: 99, blacklist: ['new-evil.example'] }));
    expect(onError).not.toHaveBeenCalled();

    // After a service-worker restart the alarm already exists.
    const again = fakeAlarms(true);
    await schedulePhishingRefresh(again, list, onError);
    expect(again.created).toEqual([]);
  });

  it.each([
    ['invalid config', respond(JSON.stringify({ version: 'x', blacklist: 5 }))],
    ['http error', respond('gone', 503)],
    ['not json', respond('<html>')],
  ])('a failed refresh (%s) is reported and keeps the snapshot', async (_n, f) => {
    const { list, store } = setup(f);
    const alarms = fakeAlarms();
    const onError = vi.fn();
    await schedulePhishingRefresh(alarms, list, onError);
    alarms.fire(PHISHING_ALARM);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect((await list.status()).version).toBe(BUNDLED_PHISHING_LIST.version);
    expect(store.data.size).toBe(0);
  });
});
