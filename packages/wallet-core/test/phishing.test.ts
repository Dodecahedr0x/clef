import { readFileSync } from 'node:fs';
import { MemoryStore } from '@clef/vault';
import { describe, expect, it, vi } from 'vitest';
import { BUNDLED_PHISHING_LIST, parsePhishingConfig, PHISHING_LIST_URL, PhishingDetector, PhishingListStore } from '../src/phishing';

const RAW = JSON.parse(readFileSync(new URL('./fixtures/phishing-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const LIST = parsePhishingConfig(RAW, 100);

describe('parsePhishingConfig', () => {
  it('normalizes entries and rejects wrong shapes', () => {
    expect(LIST.blacklist).toEqual(['evil-site.io', 'drainer.xyz']);
    expect(LIST.fetchedAt).toBe(100);
    expect(parsePhishingConfig({ ...RAW, blacklist: ['EVIL.COM'] }).blacklist).toEqual(['evil.com']);
    expect(() => parsePhishingConfig(null)).toThrow();
    expect(() => parsePhishingConfig({ ...RAW, blacklist: 'x' })).toThrow();
    expect(() => parsePhishingConfig({ ...RAW, tolerance: 'x' })).toThrow();
  });

  it('bundled snapshot parses', () => {
    expect(BUNDLED_PHISHING_LIST.blacklist.length).toBeGreaterThan(1000);
    expect(new PhishingDetector(BUNDLED_PHISHING_LIST).check('phantom.app')).toBeNull();
  });
});

describe('PhishingDetector', () => {
  const d = new PhishingDetector(LIST);
  it('hits blocklisted hosts and their subdomains', () => {
    expect(d.check('evil-site.io')).toEqual({ reason: 'blocklist', match: 'evil-site.io' });
    expect(d.check('App.Evil-Site.io.')).toEqual({ reason: 'blocklist', match: 'evil-site.io' });
    expect(d.check('notevil-site.io')).toBeNull();
  });
  it('hits fuzzy look-alikes but not the real domain', () => {
    expect(d.check('phant0m.app')).toEqual({ reason: 'fuzzy', match: 'phantom.app' });
    expect(d.check('www.solflere.com')).toEqual({ reason: 'fuzzy', match: 'solflare.com' });
    expect(d.check('solflare.com')).toBeNull();
    expect(d.check('jup.ag')).toBeNull();
  });
  it('whitelist overrides blocklist and fuzzy', () => {
    expect(d.check('safe.evil-site.io')).toBeNull();
    expect(d.check('solflare.co')).toBeNull();
  });
  it('never hits localhost, IPs or internal hosts', () => {
    const all = new PhishingDetector({ ...LIST, blacklist: ['localhost', '127.0.0.1', 'clef'], fuzzylist: ['localhast'] });
    expect(all.check('localhost')).toBeNull();
    expect(all.check('127.0.0.1')).toBeNull();
    expect(all.check('[::1]')).toBeNull();
    expect(all.check('clef')).toBeNull();
  });
  it('size counts blacklist and fuzzylist', () => {
    expect(d.size()).toBe(4);
  });
});

describe('PhishingListStore', () => {
  const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it('uses the bundled list, then a refreshed list', async () => {
    const fetch = ok({ ...RAW, blacklist: ['new-scam.com'] });
    const s = new PhishingListStore({ store: new MemoryStore(), fetch, now: () => 500, bundled: LIST });
    expect(await s.check('evil-site.io')).not.toBeNull();
    expect(await s.status()).toEqual({ version: 2, fetchedAt: 100, domains: 4 });
    await s.refresh();
    expect(fetch).toHaveBeenCalledWith(PHISHING_LIST_URL, expect.anything());
    expect(await s.status()).toEqual({ version: 2, fetchedAt: 500, domains: 3 });
    expect(await s.check('new-scam.com')).toEqual({ reason: 'blocklist', match: 'new-scam.com' });
    expect(await s.check('evil-site.io')).toBeNull();
  });

  it('prefers the bundled list when the stored one is older', async () => {
    const store = new MemoryStore();
    await store.set('phishingList', { ...LIST, blacklist: [], fetchedAt: 50 });
    const s = new PhishingListStore({ store, bundled: LIST });
    expect(await s.check('evil-site.io')).not.toBeNull();
  });

  it('keeps the previous list on HTTP or shape errors', async () => {
    const store = new MemoryStore();
    const good = new PhishingListStore({ store, fetch: ok({ ...RAW, blacklist: ['new-scam.com'] }), now: () => 500, bundled: LIST });
    await good.refresh();
    const bad = new PhishingListStore({ store, fetch: ok({ nope: 1 }), now: () => 600, bundled: LIST });
    await expect(bad.refresh()).rejects.toThrow();
    const http = vi.fn(async () => new Response('x', { status: 503 })) as unknown as typeof fetch;
    const down = new PhishingListStore({ store, fetch: http, now: () => 700, bundled: LIST });
    await expect(down.refresh()).rejects.toThrow(/503/);
    expect(await down.status()).toMatchObject({ fetchedAt: 500 });
    expect(await down.check('new-scam.com')).not.toBeNull();
  });
});
