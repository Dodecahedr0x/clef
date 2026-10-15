import { createBundledSource, IdlResolver, UserIdlSource } from '@clef/idl';
import { MemoryChainReader, type RawAccount } from '@clef/rpc';
import { getSetComputeUnitLimitInstruction } from '@solana-program/compute-budget';
import { getTransferSolInstruction } from '@solana-program/system';
import { getTransferInstruction } from '@solana-program/token';
import { AccountRole, address, createNoopSigner, type Address } from '@solana/kit';
import { beforeAll, describe, expect, it } from 'vitest';
import { explain, shortAddress, viewFor, TOKEN_PROGRAM, type ExplainedTransaction } from '../src';
import { buildWire, ME, OTHER, tokenAccountData } from './helpers';
import { AUTHORITY, VAULT, depositInstruction, setPool, vaultAddresses } from './vault';
import vaultJson from './fixtures/vault-anchor.json' with { type: 'json' };

const bigintSafe = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? [...x] : x));

let ex: ExplainedTransaction;
beforeAll(async () => {
  const wire = buildWire([
    getSetComputeUnitLimitInstruction({ units: 200_000 }),
    getTransferSolInstruction({ source: createNoopSigner(ME), destination: OTHER, amount: 1_500_000_000n }),
  ]);
  ex = await explain({ wire }, { reader: new MemoryChainReader(), idls: new IdlResolver([createBundledSource()]), me: [ME] });
});

describe('viewFor', () => {
  it('basic shows only summary, your balance changes and warnings', () => {
    const v = viewFor(ex, 'basic');
    expect(Object.keys(v).sort()).toEqual(['balanceChanges', 'level', 'summary', 'warnings']);
  });

  it('intermediate adds named instructions with formatted args and hides compute budget', () => {
    const v = viewFor(ex, 'intermediate');
    expect(v.instructions).toHaveLength(1);
    expect(v.instructions[0]).toMatchObject({ program: 'System Program', name: 'transferSol', args: { amount: '1.5 SOL' } });
    expect(v.instructions[0]!.accounts[0]).toMatchObject({ name: 'source', label: 'Your wallet' });
  });

  it('expert shows everything including raw data and compute budget', () => {
    const v = viewFor(ex, 'expert');
    expect(v.instructions).toHaveLength(2);
    expect(v.computeUnitLimit).toBe(200_000);
    expect(v.instructions[1]!.dataHex).toMatch(/^[0-9a-f]+$/);
    expect(v.instructions[1]!.accounts[0]).toMatchObject({ signer: true, writable: true });
    expect(v.feePayer).toBe(ME);
  });

  it('never includes verification-only fields, even if the input carries them', () => {
    const tainted = {
      ...ex,
      instructions: ex.instructions.map((ix) => ({ ...ix, rawArgs: { secret: 1n }, resolvedIdl: { root: 'x' } })),
    } as ExplainedTransaction;
    for (const level of ['basic', 'intermediate', 'expert'] as const) {
      expect(bigintSafe(viewFor(tainted, level))).not.toMatch(/rawArgs|resolvedIdl|secret/);
    }
  });

  it('shows unknown balance changes as unknown, not as none', async () => {
    const reader = new MemoryChainReader();
    reader.simulateImpl = async () => ({ err: 'boom', logs: [], unitsConsumed: null, postAccounts: [] });
    const wire = buildWire([getTransferSolInstruction({ source: createNoopSigner(ME), destination: OTHER, amount: 1n })]);
    const failed = await explain({ wire }, { reader, idls: new IdlResolver([createBundledSource()]), me: [ME] });
    expect(viewFor(failed, 'basic').balanceChanges).toBeNull();
    expect(viewFor(failed, 'expert').balanceChanges).toBeNull();
  });

  it('shows raw units when decimals are unknown', async () => {
    const MINT = address('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');
    const SRC = address('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
    const DST = address('8VJxZ3tRvpHFAMrUmEfPQh4SXP8a2hDuDb6ZZnLK2gGq');
    const reader = new MemoryChainReader();
    const token = (at: Address, owner: Address, amount: bigint) =>
      reader.setAccount({ address: at, owner: address(TOKEN_PROGRAM), data: tokenAccountData(owner, MINT, amount) });
    token(SRC, ME, 5_000_000n);
    token(DST, OTHER, 0n);
    const post: Record<string, RawAccount> = {
      [SRC]: { ...reader.accounts.get(SRC)!, data: tokenAccountData(ME, MINT, 2_500_000n) },
      [DST]: { ...reader.accounts.get(DST)!, data: tokenAccountData(OTHER, MINT, 2_500_000n) },
    };
    reader.simulateImpl = async (_w, addresses) => ({
      err: null, logs: [], unitsConsumed: null, postAccounts: addresses.map((a) => post[a] ?? reader.accounts.get(a) ?? null),
    });
    const wire = buildWire([getTransferInstruction({ source: SRC, destination: DST, authority: createNoopSigner(ME), amount: 2_500_000n })]);
    const t = await explain({ wire }, { reader, idls: new IdlResolver([createBundledSource()]), me: [ME] });
    const v = viewFor(t, 'intermediate');
    expect(v.instructions[0]!.args.amount).toBe('2500000 (raw units)');
    expect(v.balanceChanges).toEqual([{ owner: ME, asset: shortAddress(MINT), amount: '-2500000 (raw units)' }]);
    expect(viewFor(t, 'expert').balanceChanges).toContainEqual({ owner: OTHER, asset: shortAddress(MINT), amount: '+2500000 (raw units)' });
  });

  it('never lets an IDL name pass for a known program', async () => {
    const accounts = await vaultAddresses();
    const reader = new MemoryChainReader();
    await setPool(reader, accounts.pool, { mint: accounts.mint, authority: AUTHORITY });
    const user = new UserIdlSource();
    user.set(VAULT, JSON.stringify({ ...vaultJson, metadata: { ...vaultJson.metadata, name: 'system' } }));
    const ix = await depositInstruction(accounts);
    const wire = buildWire([{ programAddress: ix.programId, data: ix.data, accounts: ix.accounts.map((a) => ({ address: a.address, role: ((a.signer ? 2 : 0) | (a.writable ? 1 : 0)) as AccountRole })) }]);
    const t = await explain({ wire }, { reader, idls: new IdlResolver([user]), me: [ME] });
    const short = `${VAULT.slice(0, 4)}\u2026${VAULT.slice(-4)}`;
    expect(viewFor(t, 'intermediate').instructions[0]).toMatchObject({ program: `system (user IDL, ${short})`, trust: 'user' });
    expect(viewFor(t, 'expert').instructions[0]).toMatchObject({ program: `system (user IDL, ${short})`, programId: VAULT });
    expect(t.summary).toBe(`Interact with system (user IDL, ${short})`);
    // Verified relations show as badges.
    const badges = viewFor(t, 'intermediate').instructions[0]!.accounts.flatMap((a) => a.badges);
    expect(badges.some((b) => b.endsWith('\u2713'))).toBe(true);
  });
});
