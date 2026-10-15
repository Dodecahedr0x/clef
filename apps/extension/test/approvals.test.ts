import type { ApprovalRequest } from '@clef/wallet-core';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalQueue } from '../lib/approvals';

const CONNECT: ApprovalRequest = { kind: 'connect', origin: 'https://dapp.example' };
const tick = () => new Promise((r) => setTimeout(r, 0));

function queue(open: (id: string) => Promise<number | undefined> = async () => 7) {
  const opened: string[] = [];
  const close = vi.fn();
  const q = new ApprovalQueue(async (id) => {
    opened.push(id);
    return open(id);
  }, close);
  return { q, opened, close };
}

describe('ApprovalQueue', () => {
  it('opens a window per request and resolves with the decision', async () => {
    const { q, opened, close } = queue();
    const decision = q.request(CONNECT);
    await tick();
    expect(opened).toHaveLength(1);
    expect(q.get(opened[0]!)).toEqual(CONNECT);
    q.decide(opened[0]!, { approved: true, accounts: ['a'] });
    expect(await decision).toEqual({ approved: true, accounts: ['a'] });
    expect(close).toHaveBeenCalledWith(7);
    expect(q.get(opened[0]!)).toBeUndefined();
  });

  it('closing the window rejects; deciding twice is a no-op', async () => {
    const { q, opened } = queue();
    const decision = q.request(CONNECT);
    await tick();
    q.windowClosed(7);
    expect(await decision).toEqual({ approved: false });
    q.decide(opened[0]!, { approved: true });
    expect(await decision).toEqual({ approved: false });
  });

  it('a window that fails to open rejects', async () => {
    const { q } = queue(async () => {
      throw new Error('no windows');
    });
    expect(await q.request(CONNECT)).toEqual({ approved: false });
  });

  it('unknown ids are ignored and ids are unguessable', async () => {
    const { q, opened } = queue();
    void q.request(CONNECT);
    void q.request(CONNECT);
    await tick();
    expect(opened[0]).not.toBe(opened[1]);
    expect(opened[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(q.get('nope')).toBeUndefined();
    q.decide('nope', { approved: true });
  });

  it('a window closed before its id is known still rejects once the id arrives', async () => {
    let resolveOpen!: (id: number) => void;
    const { q } = queue(() => new Promise((r) => (resolveOpen = r)));
    const decision = q.request(CONNECT);
    await tick();
    q.windowClosed(9);
    resolveOpen(9);
    await tick();
    q.windowClosed(9);
    expect(await decision).toEqual({ approved: false });
  });
});
