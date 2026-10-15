import type { RawAccount, TxMeta } from '@clef/rpc';
import { address, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { balanceChangesFromMeta, balanceChangesFromSimulation, TOKEN_PROGRAM } from '../src';
import { ME, OTHER, USDC, tokenAccountData } from './helpers';

const ATA = address('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
const accounts = [ME, OTHER, ATA];
const mintInfo = () => ({ symbol: 'USDC', decimals: 6 });
const acc = (addr: Address, lamports: bigint, data: Uint8Array = new Uint8Array(), owner = addr): RawAccount =>
  ({ address: addr, owner, lamports, data, executable: false });
const tokenOwner = address(TOKEN_PROGRAM);

describe('balance changes', () => {
  it('reads SOL and token deltas from transaction meta', () => {
    const meta: TxMeta = {
      err: null, fee: 5000n, logMessages: [], loadedAddresses: { writable: [], readonly: [] },
      preBalances: [10n, 0n, 2n], postBalances: [4n, 6n, 2n],
      preTokenBalances: [{ accountIndex: 2, mint: USDC, owner: ME, amount: 100n, decimals: 6 }],
      postTokenBalances: [{ accountIndex: 2, mint: USDC, owner: ME, amount: 40n, decimals: 6 }],
    };
    expect(balanceChangesFromMeta(accounts, meta, mintInfo)).toEqual([
      { owner: ME, mint: 'SOL', symbol: 'SOL', decimals: 9, delta: -6n },
      { owner: OTHER, mint: 'SOL', symbol: 'SOL', decimals: 9, delta: 6n },
      { owner: ME, mint: USDC, symbol: 'USDC', decimals: 6, delta: -60n },
    ]);
  });

  it('diffs pre/post simulated account states', () => {
    const pre = [acc(ME, 10n), acc(ATA, 2n, tokenAccountData(ME, USDC, 100n), tokenOwner)];
    const post = [acc(ME, 7n), acc(ATA, 2n, tokenAccountData(ME, USDC, 30n), tokenOwner)];
    expect(balanceChangesFromSimulation(pre, post, mintInfo)).toEqual([
      { owner: ME, mint: 'SOL', symbol: 'SOL', decimals: 9, delta: -3n },
      { owner: ME, mint: USDC, symbol: 'USDC', decimals: 6, delta: -70n },
    ]);
  });

  it('shows a token account changing hands as an outflow from the old owner', () => {
    const lost = [
      { owner: ME, mint: USDC, symbol: 'USDC', decimals: 6, delta: -100n },
      { owner: OTHER, mint: USDC, symbol: 'USDC', decimals: 6, delta: 100n },
    ];
    const meta: TxMeta = {
      err: null, fee: 0n, logMessages: [], loadedAddresses: { writable: [], readonly: [] },
      preBalances: [0n, 0n, 2n], postBalances: [0n, 0n, 2n],
      preTokenBalances: [{ accountIndex: 2, mint: USDC, owner: ME, amount: 100n, decimals: 6 }],
      postTokenBalances: [{ accountIndex: 2, mint: USDC, owner: OTHER, amount: 100n, decimals: 6 }],
    };
    expect(balanceChangesFromMeta(accounts, meta, mintInfo)).toEqual(lost);

    const pre = [acc(ATA, 2n, tokenAccountData(ME, USDC, 100n), tokenOwner)];
    const post = [acc(ATA, 2n, tokenAccountData(OTHER, USDC, 100n), tokenOwner)];
    expect(balanceChangesFromSimulation(pre, post, mintInfo)).toEqual(lost);
  });
});
