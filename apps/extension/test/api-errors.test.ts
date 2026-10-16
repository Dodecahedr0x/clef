import { describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage: send } } }));
const { call, backgroundBuild, STALE_BACKGROUND } = await import('../lib/api');

describe('page -> background errors', () => {
  it('an action the background does not know is explained as an old background to reload', async () => {
    send.mockResolvedValueOnce({ ok: false, error: 'Unknown call "idls:update"' });
    await expect(call({ type: 'idls:update' })).rejects.toThrow(STALE_BACKGROUND);
    send.mockResolvedValueOnce({ ok: false, error: 'Invalid IDL JSON' });
    await expect(call({ type: 'idls:add' })).rejects.toThrow('Invalid IDL JSON');
  });

  it('reports the background build, or null for a background too old to report it', async () => {
    send.mockResolvedValueOnce({ ok: true, value: { build: '123' } });
    expect(await backgroundBuild()).toBe('123');
    send.mockResolvedValueOnce({ ok: false, error: 'Unknown message' });
    expect(await backgroundBuild()).toBeNull();
  });
});
