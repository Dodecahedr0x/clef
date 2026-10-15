import { describe, expect, it } from 'vitest';
import { pageBridge } from '../lib/page-bridge';

function fakeWindow(origin = 'https://dapp.example') {
  const handlers: ((e: MessageEvent) => void)[] = [];
  const posted: { data: any; target: string }[] = [];
  const win = {
    location: { origin },
    addEventListener: (_t: string, h: (e: MessageEvent) => void) => handlers.push(h),
    postMessage: (data: unknown, target: string) => posted.push({ data, target }),
  };
  const deliver = (data: unknown, opts: { source?: unknown; origin?: string } = {}) =>
    handlers.forEach((h) => h({ data, source: 'source' in opts ? opts.source : win, origin: opts.origin ?? origin } as MessageEvent));
  return { win: win as any, posted, deliver };
}

describe('pageBridge', () => {
  it('posts requests to its own origin and resolves the matching response', async () => {
    const { win, posted, deliver } = fakeWindow();
    const bridge = pageBridge(win);
    const p = bridge.request('connect', { silent: false });
    expect(posted[0]).toMatchObject({ target: 'https://dapp.example', data: { source: 'clef-inpage', method: 'connect', params: { silent: false } } });
    deliver({ source: 'clef-relay', response: { id: posted[0]!.data.id, ok: true, result: { accounts: [] } } });
    expect(await p).toEqual({ accounts: [] });
  });

  it('rejects with the wallet error code', async () => {
    const { win, posted, deliver } = fakeWindow();
    const p = pageBridge(win).request('connect', {});
    deliver({ source: 'clef-relay', response: { id: posted[0]!.data.id, ok: false, error: { code: 4001, message: 'User rejected the request' } } });
    await expect(p).rejects.toMatchObject({ code: 4001, message: 'User rejected the request' });
  });

  it('ignores messages from other windows, origins or sources', async () => {
    const { win, posted, deliver } = fakeWindow();
    const p = pageBridge(win).request('connect', {});
    const id = posted[0]!.data.id;
    deliver({ source: 'clef-relay', response: { id, ok: true, result: 'forged' } }, { source: {} });
    deliver({ source: 'clef-relay', response: { id, ok: true, result: 'forged' } }, { origin: 'https://evil.example' });
    deliver({ source: 'other', response: { id, ok: true, result: 'forged' } });
    deliver({ source: 'clef-relay', response: { id, ok: true, result: 'real' } });
    expect(await p).toBe('real');
  });

  it('delivers account events', () => {
    const { win, deliver } = fakeWindow();
    const seen: string[][] = [];
    pageBridge(win).onEvent((a) => seen.push(a));
    deliver({ source: 'clef-relay', event: { accounts: ['x'] } });
    deliver({ source: 'clef-relay', event: { accounts: [1] } });
    expect(seen).toEqual([['x']]);
  });
});
