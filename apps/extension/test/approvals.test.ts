import type { ApprovalRequest } from '@clef/wallet-core';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalQueue } from '../lib/approvals';
import { PanelRegistry } from '../lib/panel-host';
import { APPROVAL_SIZE, EXPERT_APPROVAL_SIZE, approvalWindowSize, hardwareTabUrl, openApprovalWindow } from '../lib/windows';

const CONNECT: ApprovalRequest = { kind: 'connect', origin: 'https://dapp.example', phishing: null };
const tick = () => new Promise((r) => setTimeout(r, 0));

function queue(open: (id: string) => Promise<number | undefined> = async () => 7) {
  const opened: string[] = [];
  const requests: ApprovalRequest[] = [];
  const close = vi.fn();
  const q = new ApprovalQueue(async (id, request) => {
    opened.push(id);
    requests.push(request);
    return open(id);
  }, close);
  return { q, opened, requests, close };
}

describe('ApprovalQueue', () => {
  it('opens a window per request and resolves with the decision', async () => {
    const { q, opened, requests, close } = queue();
    const decision = q.request(CONNECT);
    await tick();
    expect(opened).toHaveLength(1);
    expect(requests).toEqual([CONNECT]);
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

const A = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk' as never;
const TX = { kind: 'signTransactions', origin: 'https://d.example', phishing: null, account: A, chain: 'solana:mainnet', transactions: [], send: false, signer: { kind: 'software' } } as ApprovalRequest;
const SQUADS = { kind: 'squadsPropose' } as ApprovalRequest;
const MSG = { kind: 'signMessage' } as ApprovalRequest;
const SIWS = { kind: 'signIn' } as ApprovalRequest;

describe('approval window size', () => {
  it('is 400x680 by default and 760x960 for transactions at Expert level', () => {
    expect(APPROVAL_SIZE).toEqual({ width: 400, height: 680 });
    expect(EXPERT_APPROVAL_SIZE).toEqual({ width: 760, height: 960 });
    expect(approvalWindowSize(TX, 'expert')).toEqual(EXPERT_APPROVAL_SIZE);
    expect(approvalWindowSize(SQUADS, 'expert')).toEqual(EXPERT_APPROVAL_SIZE);
  });

  it.each([
    ['tx basic', TX, 'basic'],
    ['tx intermediate', TX, 'intermediate'],
    ['connect expert', CONNECT, 'expert'],
    ['message expert', MSG, 'expert'],
    ['sign-in expert', SIWS, 'expert'],
    ['squads basic', SQUADS, 'basic'],
  ] as const)('%s -> default size', (_n, req, level) => {
    expect(approvalWindowSize(req, level)).toEqual(APPROVAL_SIZE);
  });

  it('opens a focused popup window on the approval page with that size', async () => {
    const create = vi.fn(async (_o: unknown) => ({ id: 42 }));
    const api = { windows: { create }, runtime: { getURL: (p: string) => `chrome-extension://x${p}` } };
    expect(await openApprovalWindow(api, 'a b', { width: 760, height: 960 })).toBe(42);
    expect(create).toHaveBeenCalledWith({
      url: 'chrome-extension://x/approval.html?id=a%20b',
      type: 'popup',
      focused: true,
      width: 760,
      height: 960,
    });
  });

  it('hardware connect opens in a tab', () => {
    expect(hardwareTabUrl('ledger')).toBe('/hardware.html?kind=ledger');
    expect(hardwareTabUrl('keystone')).toBe('/hardware.html?kind=keystone');
  });
});

describe('approvals in the side panel', () => {
  const port = () => {
    const sent: unknown[] = [];
    let onClose = () => {};
    return {
      sent,
      close: () => onClose(),
      postMessage: (m: unknown) => void sent.push(m),
      onDisconnect: { addListener: (f: () => void) => void (onClose = f) },
    };
  };

  it('shows the request in an open panel instead of opening a window, and clears it once decided', async () => {
    const open = vi.fn(async () => 9);
    let queue!: ApprovalQueue;
    const panels = new PanelRegistry((ids) => queue.panelClosed(ids));
    queue = new ApprovalQueue(open, vi.fn(), panels);
    const p = port();
    panels.add(p);
    const decision = queue.request(CONNECT);
    expect(open).not.toHaveBeenCalled();
    const shown = p.sent[0] as { type: string; id: string };
    expect(shown.type).toBe('show');
    expect(queue.get(shown.id)).toEqual(CONNECT);
    queue.decide(shown.id, { approved: true });
    expect(await decision).toEqual({ approved: true });
    expect(p.sent[1]).toEqual({ type: 'done', id: shown.id });
  });

  it('closing the panel rejects what it showed; with no panel, a window opens', async () => {
    const open = vi.fn(async () => 9);
    let queue!: ApprovalQueue;
    const panels = new PanelRegistry((ids) => queue.panelClosed(ids));
    queue = new ApprovalQueue(open, vi.fn(), panels);
    const p = port();
    panels.add(p);
    const decision = queue.request(CONNECT);
    p.close();
    expect(await decision).toEqual({ approved: false });
    void queue.request(CONNECT);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
