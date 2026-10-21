import type { RawAccount } from '@clef/rpc';
import { MemoryChainReader } from '@clef/rpc';
import { AccountState, getMintEncoder } from '@solana-program/token';
import { address, none, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_MIN_CONTEXT_SLOT_NOT_REACHED, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY, SolanaError, type Address } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { AccountCache, decodeMintDecimals, decodeTokenAccount, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '../src';
import { ME, OTHER, USDC, tokenAccountData } from './helpers';

const T = address(TOKEN_PROGRAM);
const T22 = address(TOKEN_2022_PROGRAM);
const raw = (data: Uint8Array, owner: Address = T): RawAccount => ({ address: OTHER, owner, lamports: 1n, executable: false, data });
const mintData = (isInitialized = true) =>
  new Uint8Array(
    getMintEncoder().encode({ mintAuthority: none(), supply: 1n, decimals: 6, isInitialized, freezeAuthority: none() }),
  );
/** Base data padded to 165 bytes, then the Token-2022 account type byte and a 4-byte TLV header. */
const extended = (base: Uint8Array, accountType: number) => {
  const data = new Uint8Array(170);
  data.set(base);
  data[165] = accountType;
  return data;
};
/** A 355-byte multisig whose signer keys are chosen so the other layouts' tell-tale bytes look valid. */
const multisig = (typeByte: number) => {
  const data = new Uint8Array(355);
  data.set([1, 11, 1]);
  data.set(tokenAccountData().subarray(0, 165), 3); // spoof mint/owner/state under the token layout (shifted)
  data[45] = 1; // mint is_initialized
  data[44] = 6;
  data[108] = 1; // token account state
  data[165] = typeByte;
  return data;
};

describe('account helpers', () => {
  it('decodes token accounts and mint decimals', () => {
    expect(decodeTokenAccount(raw(tokenAccountData()))).toEqual({
      mint: USDC, owner: ME, amount: 10n, delegate: null, delegatedAmount: 0n, closeAuthority: null,
    });
    expect(decodeTokenAccount(raw(tokenAccountData(ME, USDC, 10n, { delegate: OTHER, delegatedAmount: 7n, closeAuthority: OTHER })))).toEqual({
      mint: USDC, owner: ME, amount: 10n, delegate: OTHER, delegatedAmount: 7n, closeAuthority: OTHER,
    });
    expect(decodeMintDecimals(raw(mintData()))).toBe(6);
    expect(decodeTokenAccount(raw(tokenAccountData(), OTHER))).toBeNull();
  });

  it('rejects multisig accounts under both token programs', () => {
    for (const owner of [T, T22]) {
      for (const typeByte of [0, 1, 2]) {
        expect(decodeTokenAccount(raw(multisig(typeByte), owner))).toBeNull();
        expect(decodeMintDecimals(raw(multisig(typeByte), owner))).toBeNull();
      }
    }
  });

  it('accepts Token-2022 extended token accounts and mints', () => {
    expect(decodeTokenAccount(raw(extended(tokenAccountData(), 2), T22))).toMatchObject({ mint: USDC, owner: ME });
    expect(decodeMintDecimals(raw(extended(mintData(), 1), T22))).toBe(6);
    expect(decodeTokenAccount(raw(extended(mintData(), 1), T22))).toBeNull();
    expect(decodeMintDecimals(raw(extended(tokenAccountData(), 2), T22))).toBeNull();
  });

  it('rejects uninitialized accounts and mints', () => {
    const uninit = tokenAccountData();
    uninit[108] = AccountState.Uninitialized;
    expect(decodeTokenAccount(raw(uninit))).toBeNull();
    expect(decodeMintDecimals(raw(mintData(false)))).toBeNull();
  });

  it('rejects legacy Token accounts that are not exactly 165 bytes', () => {
    expect(decodeTokenAccount(raw(extended(tokenAccountData(), 2).subarray(0, 166), T))).toBeNull();
    expect(decodeMintDecimals(raw(extended(mintData(), 1), T))).toBeNull();
  });

  it('returns null instead of throwing on undecodable data', () => {
    const bad = tokenAccountData();
    bad[108] = 9; // not an AccountState
    expect(decodeTokenAccount(raw(bad))).toBeNull();
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
    expect(cache.get(USDC)).toBeUndefined();
  });
});

describe('AccountCache reads at a slot', () => {
  const behind = () => new SolanaError(SOLANA_ERROR__JSON_RPC__SERVER_ERROR_MIN_CONTEXT_SLOT_NOT_REACHED, { contextSlot: 30n });
  const reader = (answers: (Error | { accounts: (RawAccount | null)[]; slot: bigint })[]) => {
    const calls: unknown[][] = [];
    const r = {
      getAccounts: async () => [],
      getAccountsWithSlot: async (...args: unknown[]) => {
        calls.push(args);
        const next = answers.shift()!;
        if (next instanceof Error) throw next;
        return next;
      },
    } as unknown as ConstructorParameters<typeof AccountCache>[0];
    return { r, calls };
  };

  it('asks again while the node is behind the slot, then takes its answer', async () => {
    const { r, calls } = reader([behind(), behind(), { accounts: [null], slot: 31n }]);
    const waits: number[] = [];
    const cache = new AccountCache(r, async (ms) => void waits.push(ms));
    expect(await cache.fetch([ME], 31n)).toEqual([null]);
    expect(calls).toHaveLength(3);
    expect(calls[2]).toEqual([[ME], { minContextSlot: 31n }]);
    expect(waits).toEqual([400, 400]);
    expect(cache.slot).toBe(31n);
  });

  it('gives up after about two seconds, and never retries other errors', async () => {
    const stuck = reader(Array.from({ length: 6 }, behind));
    await expect(new AccountCache(stuck.r, async () => {}).fetch([ME], 31n)).rejects.toThrow(/Minimum context slot/);
    expect(stuck.calls).toHaveLength(5);
    const down = reader([new SolanaError(SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY, { numSlotsBehind: 3 })]);
    await expect(new AccountCache(down.r, async () => {}).fetch([ME], 31n)).rejects.toThrow();
    expect(down.calls).toHaveLength(1);
  });
});
