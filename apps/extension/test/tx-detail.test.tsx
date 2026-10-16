import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createBundledSource, IdlResolver } from '@clef/idl';
import { explainLanded, viewForBatch, type DetailLevel, type ExplainedBatch } from '@clef/explain';
import { MemoryChainReader, type TxMeta } from '@clef/rpc';
import { getTransferSolInstruction } from '@solana-program/system';
import { createNoopSigner } from '@solana/kit';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildWire, ME, OTHER } from '../../../packages/explain/test/helpers';

const SOL = 1_000_000_000n;
const h = vi.hoisted(() => ({
  state: null as unknown,
  result: null as unknown,
  levels: [] as string[],
  call: vi.fn(async () => ({})),
}));

vi.mock('../lib/hooks', () => ({
  useWallet: () => ({ state: h.state, error: null, refresh: async () => {} }),
  useExplainLanded: (_sig: string, level: string) => {
    h.levels.push(level);
    return typeof h.result === 'function' ? (h.result as (l: string) => unknown)(level) : h.result;
  },
}));
vi.mock('../lib/api', () => ({ call: h.call }));
vi.mock('wxt/browser', () => ({ browser: { windows: { getCurrent: async () => ({ id: 1, type: 'popup' }), update: async () => {} }, tabs: { create: vi.fn() } } }));

window.history.replaceState(null, '', '/transaction.html?sig=5igSig&origin=https%3A%2F%2Fjup.ag');
const { TxDetail } = await import('../entrypoints/transaction/TxDetail');

const settings = { network: 'mainnet', rpcUrl: 'https://solana-rpc.publicnode.com', customCluster: 'mainnet', autoLockMinutes: 15, detailLevel: 'basic', hideSpam: true, networkSwitchInHeader: true, devnetTint: true, jupiterApiKey: null, errorReports: false, openIn: 'popup' };
const state = (detailLevel: DetailLevel) =>
  ({ initialized: true, unlocked: true, accounts: [{ kind: 'hd', address: ME, label: 'Main', index: 0 }], permissions: [], settings: { ...settings, detailLevel }, activeAccount: ME, errorReportsAvailable: false }) as unknown;

let landed: ExplainedBatch;
beforeAll(async () => {
  const meta: TxMeta = {
    err: null,
    fee: 5000n,
    preBalances: [3n * SOL, 0n, 1n],
    postBalances: [2n * SOL - 5000n, SOL, 1n],
    preTokenBalances: [],
    postTokenBalances: [],
    loadedAddresses: { writable: [], readonly: [] },
    logMessages: ['Program 11111111111111111111111111111111 invoke [1]', 'Program 11111111111111111111111111111111 success'],
  };
  const wire = buildWire([getTransferSolInstruction({ source: createNoopSigner(ME), destination: OTHER, amount: SOL })]);
  landed = await explainLanded({ wire, meta }, { reader: new MemoryChainReader(), idls: new IdlResolver([createBundledSource()]), me: [ME], addressBook: { [ME]: 'Main' } });
});

const ok = (level: string) => ({ status: 'ok', batch: landed, view: viewForBatch(landed, level as DetailLevel), blockTime: 1_792_000_000 });

afterEach(() => {
  cleanup();
  h.levels.length = 0;
});

describe('History transaction detail', () => {
  it('shows a landed transaction like the Basic approval, worded as on chain, with no sign or reject', () => {
    h.state = state('basic');
    h.result = ok;
    render(<TxDetail />);
    expect(screen.getByText('jup.ag')).toBeTruthy();
    expect(screen.getByText(/^Confirmed · /)).toBeTruthy();
    expect(screen.getByText('This transaction')).toBeTruthy();
    expect(screen.getByText('Recorded on chain')).toBeTruthy();
    expect(screen.queryByText(/Simulated/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Sign/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reject/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy signature' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('switches to Expert: transaction logs and a note that past account data is not recorded', () => {
    h.state = state('basic');
    h.result = ok;
    render(<TxDetail />);
    fireEvent.click(screen.getByRole('radio', { name: /Expert/ }));
    expect(h.levels.at(-1)).toBe('expert');
    expect(h.call).toHaveBeenCalledWith({ type: 'settings:update', patch: { detailLevel: 'expert' } });
    expect(screen.getByRole('heading', { name: 'Transaction logs' })).toBeTruthy();
    expect(screen.getByText(/not account data/)).toBeTruthy();
  });

  it('fails closed when the transaction cannot be loaded', () => {
    h.state = state('intermediate');
    h.result = { status: 'failed', error: 'Transaction not found on this network' };
    render(<TxDetail />);
    expect(screen.getByText(/Clef could not explain this transaction \(Transaction not found on this network\)/)).toBeTruthy();
  });
});
