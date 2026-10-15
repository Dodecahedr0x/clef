import { MemoryChainReader } from '@clef/rpc';
import { address, getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { AccountCache, identifyInstruction, verifyAnchorExtras } from '../src';
import { anchorIdl, customIx, poolData, PROG } from './custom-idl';
import { ME, tokenAccountData, USDC } from './helpers';
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

  describe('holders owned by another program', () => {
    const TOKEN = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const TOK = address('3dsp7ma1RzvD2XUuPmazs5qLRXAc7N1QR2B5AsZZsZp4');

    it('reads has_one fields from an SPL token account', async () => {
      const json = anchorIdl([{ name: 'tok' }, { name: 'owner', relations: ['tok'] }]);
      const reader = new MemoryChainReader();
      reader.setAccount({ address: TOK, owner: TOKEN, data: tokenAccountData(OTHER, USDC) });
      const edges = await verifyAnchorExtras(await customIx(json, [TOK, OTHER]), new AccountCache(reader));
      expect(edges.map((e) => [e.label, e.status])).toEqual([['tok.owner', 'verified']]);
    });

    it('resolves nested seeds through an SPL token account', async () => {
      const json = anchorIdl([
        { name: 'tok' },
        { name: 'p', pda: { seeds: [{ kind: 'const', value: [120] }, { kind: 'account', path: 'tok.mint', account: 'TokenAccount' }] } },
      ]);
      const [p] = await getProgramDerivedAddress({ programAddress: PROG, seeds: ['x', getAddressEncoder().encode(USDC)] });
      const reader = new MemoryChainReader();
      reader.setAccount({ address: TOK, owner: TOKEN, data: tokenAccountData(OTHER, USDC) });
      const edges = await verifyAnchorExtras(await customIx(json, [TOK, p]), new AccountCache(reader));
      expect(edges.map((e) => [e.label, e.status])).toEqual([['PDA("x", tok.mint)', 'verified']]);
    });

    it('rejects a token account where the IDL expects its own account type', async () => {
      // Probe case 12: `pool: Account<Pool>` replaced by an SPL token account whose `mint` matches.
      const json = anchorIdl([
        { name: 'pool' },
        { name: 'mint', relations: ['pool'] },
        { name: 'p', pda: { seeds: [{ kind: 'account', path: 'pool.mint', account: 'Pool' }] } },
      ]);
      const [p] = await getProgramDerivedAddress({ programAddress: PROG, seeds: [getAddressEncoder().encode(USDC)] });
      const reader = new MemoryChainReader();
      reader.setAccount({ address: TOK, owner: TOKEN, data: tokenAccountData(OTHER, USDC) });
      const edges = await verifyAnchorExtras(await customIx(json, [TOK, USDC, p]), new AccountCache(reader));
      expect(edges.map((e) => [e.label, e.status, e.detail])).toEqual([
        ['pool.mint', 'unverified', 'pool type unknown; token account not accepted'],
        ['PDA of p', 'unverified', 'pool is a token account, expected Pool'],
      ]);
    });

    it('rejects a token account for an untyped nested seed when an IDL type has that field', async () => {
      const json = anchorIdl([{ name: 'pool' }, { name: 'p', pda: { seeds: [{ kind: 'account', path: 'pool.mint' }] } }]);
      const reader = new MemoryChainReader();
      reader.setAccount({ address: TOK, owner: TOKEN, data: tokenAccountData(OTHER, USDC) });
      const edges = await verifyAnchorExtras(await customIx(json, [TOK, OTHER]), new AccountCache(reader));
      expect(edges).toEqual([expect.objectContaining({ status: 'unverified', detail: 'pool type unknown; token account not accepted' })]);
    });

    it('leaves other foreign holders unverified', async () => {
      const json = anchorIdl([{ name: 'pool' }, { name: 'mint', relations: ['pool'] }]);
      const reader = new MemoryChainReader();
      reader.setAccount({ address: ME, owner: OTHER, data: new Uint8Array(40) });
      const edges = await verifyAnchorExtras(await customIx(json, [ME, USDC]), new AccountCache(reader));
      expect(edges).toEqual([expect.objectContaining({ status: 'unverified', detail: `pool is owned by ${OTHER}` })]);
    });
  });

  it('flags a nested-seed PDA that does not match the holder data', async () => {
    const { edges } = await run({ mint: OTHER });
    expect(edges.find((e) => e.kind === 'pda')).toMatchObject({ status: 'mismatch', detail: expect.stringMatching(/^expected /) });
  });

  describe('seedProgram taken from an account', () => {
    const accounts = (pinned: boolean) => [
      { name: 'pool' },
      { name: 'prog', ...(pinned && { address: USDC }) },
      {
        name: 'p',
        pda: { seeds: [{ kind: 'account', path: 'pool.mint', account: 'Pool' }], program: { kind: 'account', path: 'prog' } },
      },
    ];
    async function edgesFor(pinned: boolean, target?: Address) {
      const json = anchorIdl(accounts(pinned));
      const reader = new MemoryChainReader();
      reader.setAccount({ address: ME, owner: PROG, data: await poolData(json, OTHER, AUTHORITY) });
      const [p] = await getProgramDerivedAddress({ programAddress: USDC, seeds: [getAddressEncoder().encode(OTHER)] });
      return verifyAnchorExtras(await customIx(json, [ME, USDC, target ?? p]), new AccountCache(reader));
    }

    it('is verified when the IDL pins the program account', async () => {
      expect(await edgesFor(true)).toEqual([expect.objectContaining({ label: 'PDA(pool.mint)', status: 'verified', to: USDC })]);
    });

    it('is unverified when the transaction chose the program', async () => {
      expect(await edgesFor(false)).toEqual([expect.objectContaining({ status: 'unverified', detail: `derived under ${USDC}` })]);
    });

    it('stays a mismatch when the derivation fails', async () => {
      expect(await edgesFor(false, AUTHORITY)).toEqual([expect.objectContaining({ status: 'mismatch' })]);
    });
  });

  it('does not trust holder state an earlier instruction may have modified', async () => {
    const accounts = await vaultAddresses();
    const reader = new MemoryChainReader();
    await setPool(reader, accounts.pool, { mint: accounts.mint, authority: AUTHORITY });
    const ix = await identifyInstruction(await depositInstruction(accounts), vaultResolver(), []);
    const edges = await verifyAnchorExtras(ix, new AccountCache(reader), new Set([accounts.pool]));
    expect(edges).toHaveLength(3);
    for (const edge of edges) {
      expect(edge).toMatchObject({ status: 'unverified', detail: 'pool may be modified by an earlier instruction' });
    }
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
