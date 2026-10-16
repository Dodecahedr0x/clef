import { describe, expect, it, vi } from 'vitest';
import { ErrorReporter, scrub } from '../src/error-reporter';

const ADDR = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const SIG = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';

describe('scrub', () => {
  it('redacts addresses, signatures, long numbers, urls, blobs and phrases', () => {
    expect(scrub(`account ${ADDR} failed`)).toBe('account <b58> failed');
    expect(scrub(`sig ${SIG}`)).toBe('sig <b58>');
    expect(scrub('lamports 123456789 small 42')).toBe('lamports <num> small 42');
    expect(scrub('see https://evil.example/path?x=1 now')).toBe('see <url> now');
    expect(scrub('from https://dapp.example/a/b', 'dapp.example')).toBe('from dapp.example');
    expect(scrub('blob AAECAwQFBgcICQoLDA0ODxAREhMUFRYX+/==')).toBe('blob <b64>');
    const phrase = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
    expect(scrub(`mnemonic: ${phrase}.`)).toBe('mnemonic: <words>.');
    expect(scrub('Error: Simulation failed at instruction 2')).toBe('Error: Simulation failed at instruction 2');
  });
});

describe('ErrorReporter', () => {
  const opts = { version: '1.2.3', browser: 'chrome' };

  it('is unavailable without an https endpoint and never fetches', async () => {
    const fetch = vi.fn();
    for (const endpoint of [null, 'http://errors.example/report']) {
      const r = new ErrorReporter({ ...opts, endpoint, enabled: async () => true, fetch: fetch as unknown as typeof globalThis.fetch });
      expect(r.available).toBe(false);
      await r.report(new Error('x'), { area: 'bg' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not POST when disabled', async () => {
    const fetch = vi.fn();
    const r = new ErrorReporter({ ...opts, endpoint: 'https://errors.example/r', enabled: async () => false, fetch: fetch as unknown as typeof globalThis.fetch });
    expect(r.available).toBe(true);
    await r.report(new Error('x'), { area: 'bg' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('POSTs a scrubbed payload and never throws', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
    const r = new ErrorReporter({ ...opts, endpoint: 'https://errors.example/r', enabled: async () => true, fetch: fetch as unknown as typeof globalThis.fetch });
    const err = new TypeError(`bad ${ADDR} at https://dapp.example/x and ${'.'.repeat(3000)}`);
    await r.report(err, { area: 'approval', origin: 'https://dapp.example:8443/page' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://errors.example/r');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['area', 'browser', 'message', 'name', 'origin', 'stack', 'v', 'version']);
    expect(body).toMatchObject({ v: 1, version: '1.2.3', browser: 'chrome', area: 'approval', origin: 'dapp.example', name: 'TypeError' });
    expect(body.message).toMatch(/^bad <b58> at dapp\.example and \.+$/);
    expect((body.message as string).length).toBeLessThanOrEqual(2000);
    expect((body.stack as string).length).toBeLessThanOrEqual(8000);
    expect(body.stack).not.toContain(ADDR);

    const failing = new ErrorReporter({ ...opts, endpoint: 'https://errors.example/r', enabled: async () => true, fetch: (async () => { throw new Error('offline'); }) as unknown as typeof globalThis.fetch });
    await expect(failing.report('plain string', { area: 'x' })).resolves.toBeUndefined();
    const throwing = new ErrorReporter({ ...opts, endpoint: 'https://errors.example/r', enabled: async () => { throw new Error('no'); }, fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(throwing.report(new Error('x'), { area: 'x' })).resolves.toBeUndefined();
  });
});
