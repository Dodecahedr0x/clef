import type { RawAccount, TxMeta } from '@clef/rpc';
import { address, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { balanceChangesFromMeta, balanceChangesFromSimulation, TOKEN_PROGRAM, type BalanceChange } from '../src';
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
    // The account's rent lamports go with it.
    const lost = [
      { owner: ME, mint: 'SOL', symbol: 'SOL', decimals: 9, delta: -2n },
      { owner: OTHER, mint: 'SOL', symbol: 'SOL', decimals: 9, delta: 2n },
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
    expect(balanceChangesFromSimulation(pre, post, mintInfo)).toEqual([lost[2], lost[0], lost[3], lost[1]]);
  });

  describe('token account lamports', () => {
    const WSOL = address('So11111111111111111111111111111111111111112');
    const RENT = 2_039_280n;
    const SOL = 1_000_000_000n;
    const info = (mint: Address) => (mint === WSOL ? { symbol: 'wSOL', decimals: 9 } : { symbol: 'USDC', decimals: 6 });
    const row = (owner: Address, mint: Address | 'SOL', delta: bigint): BalanceChange =>
      mint === 'SOL'
        ? { owner, mint, symbol: 'SOL', decimals: 9, delta }
        : { owner, mint, symbol: info(mint).symbol, decimals: info(mint).decimals, delta };
    type Side = { lamports: bigint; token?: { owner: Address; mint: Address; amount: bigint } };
    /** Runs one scenario through both paths: [wallet ME, wallet OTHER, token account ATA]. */
    const both = (pre: [bigint, bigint, Side], post: [bigint, bigint, Side]) => {
      const tb = (side: Side) =>
        side.token ? [{ accountIndex: 2, mint: side.token.mint, owner: side.token.owner, amount: side.token.amount, decimals: info(side.token.mint).decimals }] : [];
      const meta: TxMeta = {
        err: null, fee: 0n, logMessages: [], loadedAddresses: { writable: [], readonly: [] },
        preBalances: [pre[0], pre[1], pre[2].lamports], postBalances: [post[0], post[1], post[2].lamports],
        preTokenBalances: tb(pre[2]), postTokenBalances: tb(post[2]),
      };
      const state = (s: [bigint, bigint, Side]) => [
        acc(ME, s[0]),
        acc(OTHER, s[1]),
        s[2].token
          ? acc(ATA, s[2].lamports, tokenAccountData(s[2].token.owner, s[2].token.mint, s[2].token.amount), tokenOwner)
          : s[2].lamports ? acc(ATA, s[2].lamports) : null,
      ];
      const fromMeta = balanceChangesFromMeta(accounts, meta, info);
      expect(balanceChangesFromSimulation(state(pre), state(post), info)).toEqual(fromMeta);
      return fromMeta;
    };
    const mine = (mint: Address, amount: bigint) => ({ owner: ME, mint, amount });

    it('wrap and unwrap show SOL against wSOL once', () => {
      const wrap = both([10n * SOL, 0n, { lamports: RENT, token: mine(WSOL, 0n) }], [9n * SOL, 0n, { lamports: RENT + SOL, token: mine(WSOL, SOL) }]);
      expect(wrap).toEqual([row(ME, 'SOL', -SOL), row(ME, WSOL, SOL)]);
      const unwrap = both([9n * SOL, 0n, { lamports: RENT + SOL, token: mine(WSOL, SOL) }], [10n * SOL + RENT, 0n, { lamports: 0n }]);
      expect(unwrap).toEqual([row(ME, 'SOL', SOL), row(ME, WSOL, -SOL)]);
    });

    it('creating an ATA for someone else costs you its rent; for yourself the rent stays yours', () => {
      const forOther = both([SOL, 0n, { lamports: 0n }], [SOL - RENT, 0n, { lamports: RENT, token: { owner: OTHER, mint: USDC, amount: 0n } }]);
      expect(forOther).toEqual([row(ME, 'SOL', -RENT), row(OTHER, 'SOL', RENT)]);
      const forMe = both([SOL, 0n, { lamports: 0n }], [SOL - RENT, 0n, { lamports: RENT, token: mine(USDC, 0n) }]);
      expect(forMe).toEqual([]);
    });

    it('closing your token account to someone else shows the rent leaving', () => {
      const toOther = both([SOL, 0n, { lamports: RENT, token: mine(USDC, 0n) }], [SOL, RENT, { lamports: 0n }]);
      expect(toOther).toEqual([row(ME, 'SOL', -RENT), row(OTHER, 'SOL', RENT)]);
    });
  });

  it('reports unknown decimals as null in simulation', () => {
    const pre = [acc(ATA, 2n, tokenAccountData(ME, USDC, 100n), tokenOwner)];
    const post = [acc(ATA, 2n, tokenAccountData(ME, USDC, 30n), tokenOwner)];
    expect(balanceChangesFromSimulation(pre, post, () => null)).toEqual([
      { owner: ME, mint: USDC, symbol: undefined, decimals: null, delta: -70n },
    ]);
  });

  it('falls back to ownerOf when meta has no token owner', () => {
    const meta: TxMeta = {
      err: null, fee: 0n, logMessages: [], loadedAddresses: { writable: [], readonly: [] },
      preBalances: [0n, 0n, 2n], postBalances: [0n, 0n, 2n],
      preTokenBalances: [{ accountIndex: 2, mint: USDC, owner: null, amount: 100n, decimals: 6 }],
      postTokenBalances: [{ accountIndex: 2, mint: USDC, owner: null, amount: 40n, decimals: 6 }],
    };
    expect(balanceChangesFromMeta(accounts, meta, mintInfo, (a) => (a === ATA ? ME : null))).toEqual([
      { owner: ME, mint: USDC, symbol: 'USDC', decimals: 6, delta: -60n },
    ]);
    expect(balanceChangesFromMeta(accounts, meta, mintInfo)).toEqual([
      { owner: ATA, mint: USDC, symbol: 'USDC', decimals: 6, delta: -60n },
    ]);
  });
});
