import { MemoryChainReader } from '@clef/rpc';
import type { Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { AccountCache, identifyInstruction, verifyAnchorExtras } from '../src';
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
});
