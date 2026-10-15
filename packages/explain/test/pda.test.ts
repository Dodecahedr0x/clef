import { describe, expect, it } from 'vitest';
import { identifyInstruction, toHex, verifyCodamaPdas, type IdentifiedInstruction } from '../src';
import { OTHER, depositInstruction, vaultAddresses, vaultResolver } from './vault';

async function identified(overrides: Partial<Awaited<ReturnType<typeof vaultAddresses>>> = {}) {
  const accounts = { ...(await vaultAddresses()), ...overrides };
  const ix = await identifyInstruction(await depositInstruction(accounts), vaultResolver(), []);
  return { accounts, ix };
}

async function edgesFor(overrides: Partial<Awaited<ReturnType<typeof vaultAddresses>>> = {}) {
  const { accounts, ix } = await identified(overrides);
  return { accounts, edges: await verifyCodamaPdas(ix) };
}

describe('verifyCodamaPdas', () => {
  it('verifies PDAs whose seeds Codama can express', async () => {
    const { accounts, edges } = await edgesFor();
    // userPosition uses a nested seed (pool.mint): handled by Anchor extras, not here.
    expect(edges.map((e) => [e.from, e.status])).toEqual([
      [accounts.pool, 'verified'],
      [accounts.poolVault, 'verified'],
    ]);
    expect(edges[0]!.seeds).toEqual([
      { kind: 'const', display: '"pool"' },
      { kind: 'account', display: 'mint' },
    ]);
    expect(edges[0]!.label).toBe('PDA("pool", mint)');
  });

  it('flags a substituted PDA as a mismatch', async () => {
    const { edges } = await edgesFor({ poolVault: OTHER });
    const vault = edges.find((e) => e.from === OTHER);
    expect(vault?.status).toBe('mismatch');
    expect(vault?.detail).toMatch(/^expected /);
  });

  it('skips accounts whose Anchor extras carry nested seeds', async () => {
    const { accounts, ix } = await identified();
    const idl = ix.resolvedIdl!;
    const withNested: IdentifiedInstruction = {
      ...ix,
      resolvedIdl: { ...idl, anchorExtras: { deposit: { pool: { relations: [], nestedSeeds: [] } } } },
    };
    const edges = await verifyCodamaPdas(withNested);
    expect(edges.map((e) => e.from)).toEqual([accounts.poolVault]);
  });

  it('never guesses unnamed accounts', async () => {
    const { accounts, ix } = await identified();
    const unnamed: IdentifiedInstruction = {
      ...ix,
      accounts: ix.accounts.map((a) => (a.name === 'mint' || a.name === 'poolVault' ? { ...a, name: undefined } : a)),
    };
    const edges = await verifyCodamaPdas(unnamed);
    // poolVault has no name: no edge. pool's seed account (mint) has no name: unverified.
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: accounts.pool, status: 'unverified' });
  });
});

describe('toHex', () => {
  it('encodes bytes as lowercase hex', () => {
    expect(toHex(new Uint8Array([0, 1, 0xab, 0xff]))).toBe('0001abff');
  });
});
