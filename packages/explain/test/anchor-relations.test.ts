import { MemoryChainReader } from '@clef/rpc';
import type { Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { AccountCache, identifyInstruction, verifyAnchorExtras } from '../src';
import { anchorIdl, customIx, poolData, PROG } from './custom-idl';
import { ME, USDC } from './helpers';
import { AUTHORITY, OTHER, VAULT, depositInstruction, setPool, vaultAddresses, vaultResolver } from './vault';

async function run(poolFields: Partial<{ mint: Address; authority: Address }> = {}, owner: Address = VAULT) {
  const accounts = await vaultAddresses();
  const reader = new MemoryChainReader();
  await setPool(reader, accounts.pool, { mint: accounts.mint, authority: AUTHORITY, ...poolFields }, owner);
  const ix = await identifyInstruction(await depositInstruction(accounts), vaultResolver(), []);
  return { accounts, edges: await verifyAnchorExtras(ix, new AccountCache(reader)) };
}

describe('verifyAnchorExtras', () => {
  it('verifies has_one relations and nested-path seeds against decoded account data', async () => {
    const { accounts, edges } = await run();
    // Order follows the IDL's account order: mint, user_position, authority.
    expect(edges.map((e) => [e.kind, e.label, e.status])).toEqual([
      ['has_one', 'pool.mint', 'verified'],
      ['pda', 'PDA("pos", pool.mint, user)', 'verified'],
      ['has_one', 'pool.authority', 'verified'],
    ]);
    expect(edges[0]).toMatchObject({ from: accounts.mint, to: accounts.pool });
  });

  it('flags a relation that does not hold', async () => {
    const { edges } = await run({ authority: OTHER });
    const authority = edges.find((e) => e.label === 'pool.authority');
    expect(authority).toMatchObject({ status: 'mismatch', detail: `pool.authority is ${OTHER}` });
  });

  it('marks relations unverified when the holder account cannot be read', async () => {
    const accounts = await vaultAddresses();
    const ix = await identifyInstruction(await depositInstruction(accounts), vaultResolver(), []);
    const edges = await verifyAnchorExtras(ix, new AccountCache(new MemoryChainReader()));
    expect(new Set(edges.map((e) => e.status))).toEqual(new Set(['unverified']));
  });

  it('flags a holder account not owned by the program, even with matching data', async () => {
    const { edges } = await run({}, OTHER);
    expect(edges).toHaveLength(3);
    for (const edge of edges) {
      expect(edge).toMatchObject({ status: 'mismatch', detail: 'pool is not owned by the program' });
    }
  });

  it('reads has_one fields by the target account name inside duplicate composites', async () => {
    const side = (name: string) => ({ name, accounts: [{ name: 'pool' }, { name: 'mint', relations: ['pool'] }] });
    const json = anchorIdl([side('from'), side('to')]);
    const reader = new MemoryChainReader();
    reader.setAccount({ address: ME, owner: PROG, data: await poolData(json, USDC, AUTHORITY) });
    reader.setAccount({ address: OTHER, owner: PROG, data: await poolData(json, USDC, AUTHORITY) });
    const ix = await customIx(json, [ME, USDC, OTHER, USDC]);
    const edges = await verifyAnchorExtras(ix, new AccountCache(reader));
    expect(edges.map((e) => [e.label, e.status, e.to])).toEqual([
      ['fromPool.mint', 'verified', ME],
      ['toPool.mint', 'verified', OTHER],
    ]);
  });

  it('reports unverified instead of throwing when account reads fail', async () => {
    const accounts = await vaultAddresses();
    const ix = await identifyInstruction(await depositInstruction(accounts), vaultResolver(), []);
    const reader = new MemoryChainReader();
    reader.getAccounts = async () => {
      throw new Error('rpc down');
    };
    const edges = await verifyAnchorExtras(ix, new AccountCache(reader));
    expect(edges).toHaveLength(3);
    for (const edge of edges) expect(edge).toMatchObject({ status: 'unverified', detail: expect.stringMatching(/rpc down/) });
  });

  it('never guesses an unnamed holder', async () => {
    const accounts = await vaultAddresses();
    const reader = new MemoryChainReader();
    await setPool(reader, accounts.pool, { mint: accounts.mint, authority: AUTHORITY });
    const ix = await identifyInstruction(await depositInstruction(accounts), vaultResolver(), []);
    const unnamed = { ...ix, accounts: ix.accounts.map((a) => (a.name === 'pool' ? { ...a, name: undefined } : a)) };
    const edges = await verifyAnchorExtras(unnamed, new AccountCache(reader));
    expect(edges.map((e) => [e.label, e.status, e.detail, e.to])).toEqual([
      ['pool.mint', 'unverified', 'pool not identified', VAULT],
      ['PDA of userPosition', 'unverified', 'pool not identified', VAULT],
      ['pool.authority', 'unverified', 'pool not identified', VAULT],
    ]);
  });

  describe('absent optional accounts (passed as the program id)', () => {
    it('reports a has_one with an absent holder as not provided', async () => {
      const json = anchorIdl([{ name: 'pool', optional: true }, { name: 'mint', relations: ['pool'] }]);
      const reader = new MemoryChainReader();
      reader.setAccount({ address: PROG, owner: OTHER, data: new Uint8Array(36), executable: true });
      const edges = await verifyAnchorExtras(await customIx(json, [PROG, USDC]), new AccountCache(reader));
      expect(edges).toEqual([expect.objectContaining({ label: 'pool.mint', status: 'unverified', detail: 'pool not provided' })]);
    });

    it('produces no edge for an absent has_one target', async () => {
      const json = anchorIdl([{ name: 'pool' }, { name: 'mint', optional: true, relations: ['pool'] }]);
      const edges = await verifyAnchorExtras(await customIx(json, [ME, PROG]), new AccountCache(new MemoryChainReader()));
      expect(edges).toEqual([]);
    });

    it('reports a nested seed through an absent account as not provided', async () => {
      const json = anchorIdl([
        { name: 'pool', optional: true },
        { name: 'p', pda: { seeds: [{ kind: 'account', path: 'pool.mint', account: 'Pool' }] } },
      ]);
      const edges = await verifyAnchorExtras(await customIx(json, [PROG, OTHER]), new AccountCache(new MemoryChainReader()));
      expect(edges).toEqual([expect.objectContaining({ kind: 'pda', status: 'unverified', detail: 'pool not provided' })]);
    });
  });
});
