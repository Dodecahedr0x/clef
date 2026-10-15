import { MemoryChainReader } from '@clef/rpc';
import { getMintEncoder } from '@solana-program/token';
import { address, none } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { AccountCache, decodeMintDecimals, decodeTokenAccount, TOKEN_PROGRAM } from '../src';
import { ME, OTHER, USDC, tokenAccountData } from './helpers';

describe('account helpers', () => {
  it('decodes token accounts and mint decimals', () => {
    const acc = { address: OTHER, owner: address(TOKEN_PROGRAM), lamports: 1n, executable: false, data: tokenAccountData() };
    expect(decodeTokenAccount(acc)).toEqual({ mint: USDC, owner: ME, amount: 10n, delegate: null });
    const mintData = new Uint8Array(
      getMintEncoder().encode({ mintAuthority: none(), supply: 1n, decimals: 6, isInitialized: true, freezeAuthority: none() }),
    );
    expect(decodeMintDecimals({ ...acc, data: mintData })).toBe(6);
    expect(decodeTokenAccount({ ...acc, owner: OTHER })).toBeNull();
  });

  it('fetches each address once', async () => {
    const reader = new MemoryChainReader();
    const spy = vi.spyOn(reader, 'getAccounts');
    const cache = new AccountCache(reader);
    await cache.load([ME, OTHER, ME]);
    await cache.load([ME]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith([ME, OTHER]);
    expect(cache.get(ME)).toBeNull();
  });
});
