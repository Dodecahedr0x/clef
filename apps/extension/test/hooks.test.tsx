// @vitest-environment jsdom
import type { ChainReader } from '@clef/rpc';
import type { Settings } from '@clef/wallet-core';
import type { Address } from '@solana/kit';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { fakeBrowser } from '@webext-core/fake-browser';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FullState } from '../lib/api';
import { ClientsContext, createExplainContext, type Clients } from '../lib/clients';
import { useActiveAccount, useCall, useExplainBatch, useHealth, useHistory, usePortfolio, useWallet } from '../lib/hooks';

const m = vi.hoisted(() => ({
  loadPortfolio: vi.fn(),
  loadHistory: vi.fn(),
  explainBatch: vi.fn(),
  viewForBatch: vi.fn(),
}));

vi.mock('wxt/browser', async () => ({ browser: (await import('@webext-core/fake-browser')).fakeBrowser }));
vi.mock('@clef/portfolio', () => ({ loadPortfolio: m.loadPortfolio, loadHistory: m.loadHistory }));
vi.mock('@clef/market', () => ({ JupiterClient: class {} }));
vi.mock('@clef/explain', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  explainBatch: m.explainBatch,
  viewForBatch: m.viewForBatch,
}));

const ME = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS' as Address;
const OTHER = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address;
const FRIEND = '11111111111111111111111111111111' as Address;

const settings = { network: 'mainnet', rpcUrl: 'http://rpc.test', hideSpam: true, jupiterApiKey: null } as unknown as Settings;
const baseState = (): FullState =>
  ({
    hasVault: true,
    unlocked: true,
    accounts: [
      { kind: 'hd', address: ME, label: 'Main', index: 0 },
      { kind: 'hd', address: OTHER, label: 'Second', index: 1 },
    ],
    settings,
    permissions: [],
    activeAccount: OTHER,
    errorReportsAvailable: false,
  }) as FullState;

let backend: { state: FullState; calls: string[]; fail: Record<string, string> };

function handle(msg: { channel: string; call?: { type: string } & Record<string, unknown> }) {
  const c = msg.call!;
  backend.calls.push(c.type);
  if (backend.fail[c.type]) return { ok: false, error: backend.fail[c.type] };
  switch (c.type) {
    case 'state':
      return { ok: true, value: structuredClone(backend.state) };
    case 'contacts:list':
      return { ok: true, value: [{ address: FRIEND, name: 'Alice', kind: 'contact', createdAt: 0 }] };
    case 'idls:list':
      return { ok: true, value: [] };
    case 'echo':
      return { ok: true, value: { echoed: c.value } };
    default:
      return { ok: false, error: `unknown ${c.type}` };
  }
}

const health = vi.fn();
const fakeClients = { chain: { fake: 'chain' }, portfolio: { getHealth: health }, jupiter: { fake: 'jupiter' } } as unknown as Clients;
const factory = vi.fn(() => fakeClients);
const wrapper = ({ children }: { children: ReactNode }) => <ClientsContext.Provider value={factory}>{children}</ClientsContext.Provider>;

beforeEach(() => {
  fakeBrowser.reset();
  backend = { state: baseState(), calls: [], fail: {} };
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((async (msg: never) => handle(msg)) as never);
  for (const f of [m.loadPortfolio, m.loadHistory, m.explainBatch, m.viewForBatch, health, factory]) f.mockReset();
  factory.mockImplementation(() => fakeClients);
  health.mockResolvedValue({ slot: 42n, latencyMs: 120 });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useWallet', () => {
  it('fetches state and re-fetches on a storage change event', async () => {
    const { result } = renderHook(() => useWallet());
    await waitFor(() => expect(result.current.state?.activeAccount).toBe(OTHER));
    expect(result.current.error).toBeNull();

    backend.state = { ...baseState(), unlocked: false };
    await act(() => fakeBrowser.storage.session.set({ anything: 1 }));
    await waitFor(() => expect(result.current.state?.unlocked).toBe(false));
    expect(backend.calls.filter((c) => c === 'state').length).toBe(2);
  });

  it('shares one fetch among hooks and reports errors', async () => {
    const a = renderHook(() => [useWallet(), useWallet()] as const);
    await waitFor(() => expect(a.result.current[1].state).not.toBeNull());
    expect(backend.calls.filter((c) => c === 'state').length).toBe(1);
    a.unmount();

    backend.fail.state = 'Wallet is asleep';
    const b = renderHook(() => useWallet());
    await waitFor(() => expect(b.result.current.error).toBe('Wallet is asleep'));
    expect(b.result.current.state).toBeNull();
    delete backend.fail.state;
    await act(() => b.result.current.refresh());
    expect(b.result.current.error).toBeNull();
    expect(b.result.current.state?.unlocked).toBe(true);
  });

  it('stops listening once unmounted', async () => {
    const { result, unmount } = renderHook(() => useWallet());
    await waitFor(() => expect(result.current.state).not.toBeNull());
    unmount();
    await fakeBrowser.storage.local.set({ x: 1 });
    expect(backend.calls.filter((c) => c === 'state').length).toBe(1);
  });

  it('useActiveAccount resolves the active address, falling back to the first account', async () => {
    const { result } = renderHook(() => useActiveAccount());
    await waitFor(() => expect(result.current?.label).toBe('Second'));
    backend.state = { ...baseState(), activeAccount: null };
    await act(() => fakeBrowser.storage.local.set({ y: 1 }));
    await waitFor(() => expect(result.current?.label).toBe('Main'));
  });
});

describe('useCall', () => {
  it('returns data, then error, and reloads', async () => {
    const { result } = renderHook(() => useCall<{ echoed: number }>('echo', { value: 7 }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual({ echoed: 7 }));
    expect(result.current).toMatchObject({ loading: false, error: null });

    backend.fail.echo = 'nope';
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBe('nope'));
    expect(backend.calls.filter((c) => c === 'echo').length).toBe(2);
  });

  it('re-runs when deps change', async () => {
    const { result, rerender } = renderHook(({ v }) => useCall<{ echoed: number }>('echo', { value: v }, [v]), { initialProps: { v: 1 } });
    await waitFor(() => expect(result.current.data).toEqual({ echoed: 1 }));
    rerender({ v: 2 });
    await waitFor(() => expect(result.current.data).toEqual({ echoed: 2 }));
  });
});

describe('usePortfolio', () => {
  it('loads with injected clients and the hideSpam setting, and refreshes', async () => {
    m.loadPortfolio.mockResolvedValueOnce({ owner: ME, totalUsd: 1 }).mockResolvedValueOnce({ owner: ME, totalUsd: 2 });
    const { result } = renderHook(() => usePortfolio(ME), { wrapper });
    await waitFor(() => expect(result.current.data).toMatchObject({ totalUsd: 1 }));
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ rpcUrl: 'http://rpc.test' }));
    expect(m.loadPortfolio).toHaveBeenCalledWith({ reader: fakeClients.portfolio, chain: fakeClients.chain, prices: fakeClients.jupiter }, ME, {
      hideSpam: true,
    });
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.data).toMatchObject({ totalUsd: 2 }));
  });

  it('reports errors and stays empty without an owner', async () => {
    m.loadPortfolio.mockRejectedValue(new Error('rpc down'));
    const { result } = renderHook(() => usePortfolio(ME), { wrapper });
    await waitFor(() => expect(result.current.error).toBe('rpc down'));
    const none = renderHook(() => usePortfolio(null), { wrapper });
    expect(none.result.current.data).toBeNull();
    expect(m.loadPortfolio).toHaveBeenCalledTimes(1);
  });
});

describe('useHistory', () => {
  const item = (s: string) => ({ signature: s, title: s });

  it('loads pages with loadMore until there is no cursor', async () => {
    m.loadHistory.mockResolvedValueOnce({ items: [item('a'), item('b')], next: 'b' }).mockResolvedValueOnce({ items: [item('c')] });
    const { result } = renderHook(() => useHistory(ME), { wrapper });
    await waitFor(() => expect(result.current.items.map((i) => i.signature)).toEqual(['a', 'b']));
    expect(result.current.hasMore).toBe(true);
    const [deps, owner, opts] = m.loadHistory.mock.calls[0]!;
    expect(owner).toBe(ME);
    expect(opts).toEqual({ limit: 20 });
    expect(deps.reader).toBe(fakeClients.portfolio);
    expect(deps.explainCtx.addressBook).toMatchObject({ [FRIEND]: 'Alice', [ME]: 'Main' });

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items.map((i) => i.signature)).toEqual(['a', 'b', 'c']));
    expect(m.loadHistory.mock.calls[1]![2]).toEqual({ before: 'b', limit: 20 });
    expect(result.current.hasMore).toBe(false);
    act(() => result.current.loadMore());
    expect(m.loadHistory).toHaveBeenCalledTimes(2);
  });

  it('reports errors', async () => {
    m.loadHistory.mockRejectedValue(new Error('history down'));
    const { result } = renderHook(() => useHistory(ME), { wrapper });
    await waitFor(() => expect(result.current.error).toBe('history down'));
    expect(result.current.hasMore).toBe(false);
  });
});

describe('useHealth', () => {
  it('reports slot and latency from the portfolio reader', async () => {
    const { result } = renderHook(() => useHealth(), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ slot: 42n, latencyMs: 120 }));
  });

  it('clears on failure', async () => {
    health.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useHealth(), { wrapper });
    await waitFor(() => expect(health).toHaveBeenCalled());
    expect(result.current).toEqual({ slot: null, latencyMs: null });
  });
});

describe('useExplainBatch', () => {
  const wires = [new Uint8Array([1]), new Uint8Array([2])];

  it('explains the batch with labels and renders the view at the level', async () => {
    const batch = { mode: 'sequential', steps: [] };
    m.explainBatch.mockResolvedValue(batch);
    m.viewForBatch.mockImplementation((_b, level) => ({ level }));
    const { result, rerender } = renderHook(({ level }) => useExplainBatch(wires, level), { wrapper, initialProps: { level: 'basic' as const } as { level: 'basic' | 'expert' } });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ok'));
    expect(result.current).toEqual({ status: 'ok', batch, view: { level: 'basic' } });
    const [inputs, ctx] = m.explainBatch.mock.calls[0]!;
    expect(inputs).toEqual([{ wire: wires[0] }, { wire: wires[1] }]);
    expect(ctx.reader).toBe(fakeClients.chain);
    expect(ctx.me).toEqual([ME, OTHER]);

    rerender({ level: 'expert' });
    expect(result.current).toMatchObject({ status: 'ok', view: { level: 'expert' } });
    expect(m.explainBatch).toHaveBeenCalledTimes(1);
  });

  it('fails closed when explaining throws', async () => {
    m.explainBatch.mockRejectedValue(new Error('simulation exploded'));
    const { result } = renderHook(() => useExplainBatch(wires, 'intermediate'), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ status: 'failed', error: 'simulation exploded' }));
  });

  it('fails closed when building the view throws', async () => {
    m.explainBatch.mockResolvedValue({});
    m.viewForBatch.mockImplementation(() => {
      throw new Error('bad view');
    });
    const { result } = renderHook(() => useExplainBatch(wires, 'expert'), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ status: 'failed', error: 'bad view' }));
  });

  it('stays loading without wires', async () => {
    const { result } = renderHook(() => useExplainBatch(null, 'basic'), { wrapper });
    await waitFor(() => expect(backend.calls).toContain('idls:list'));
    expect(result.current).toEqual({ status: 'loading' });
    expect(m.explainBatch).not.toHaveBeenCalled();
  });
});

describe('createExplainContext', () => {
  it('labels accounts and contacts (accounts win) and serves user IDLs for the current network', async () => {
    const chain = {} as ChainReader;
    const legacy = JSON.stringify({ version: '0.1.0', name: 'legacy', instructions: [{ name: 'doIt', accounts: [], args: [] }] });
    const ctx = createExplainContext(
      baseState(),
      {
        contacts: [
          { address: FRIEND, name: 'Alice', kind: 'contact', createdAt: 0 },
          { address: ME, name: 'Not me', kind: 'label', createdAt: 0 },
        ],
        userIdls: [
          { programId: ME, network: 'mainnet', name: 'legacy', json: legacy, hash: 'h', addedAt: 0 },
          { programId: OTHER, network: 'devnet', name: 'legacy', json: legacy, hash: 'h', addedAt: 0 },
        ],
        prices: { SOL: 150 },
      },
      chain,
    );
    expect(ctx.addressBook).toEqual({ [FRIEND]: 'Alice', [ME]: 'Main', [OTHER]: 'Second' });
    expect(ctx.me).toEqual([ME, OTHER]);
    expect(ctx.reader).toBe(chain);
    expect(ctx.prices).toEqual({ SOL: 150 });

    const first = async (programId: Address) => {
      for await (const idl of ctx.idls.candidates(programId)) return idl;
      return null;
    };
    expect(await first(ME)).toMatchObject({ source: 'user' });
    const devnetOnly = await first(OTHER);
    expect(devnetOnly?.source).not.toBe('user');
  });
});
