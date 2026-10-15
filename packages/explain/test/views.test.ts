import { createBundledSource, IdlResolver, UserIdlSource } from '@clef/idl';
import { MemoryChainReader, type RawAccount } from '@clef/rpc';
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';
import { getTransferSolInstruction } from '@solana-program/system';
import { getTransferInstruction } from '@solana-program/token';
import { AccountRole, address, createNoopSigner, type Address } from '@solana/kit';
import { beforeAll, describe, expect, it } from 'vitest';
import { explain, shortAddress, viewFor, TOKEN_PROGRAM, type ExplainedTransaction } from '../src';
import { buildV1Wire, buildWire, ME, OTHER, simulateWith, tokenAccountData } from './helpers';

const MINT_X = address('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');
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
    expect(v.fee).toBe('0.000005 SOL');
    // The basic view shows the fee only when it is high.
    expect(viewFor(ex, 'basic')).not.toHaveProperty('fee');
  });

  it('expert view: strings for bigints, copies of shared arrays, and state changes', async () => {
    const MY_TA = address('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
    const reader = new MemoryChainReader();
    reader.setAccount({ address: MY_TA, owner: address(TOKEN_PROGRAM), data: tokenAccountData(ME, MINT_X, 100n) });
    simulateWith(reader, { [MY_TA]: { data: tokenAccountData(ME, MINT_X, 100n, { delegate: OTHER, delegatedAmount: 100n }) } });
    const wire = buildWire([
      getSetComputeUnitPriceInstruction({ microLamports: 1000n }),
      { programAddress: OTHER, data: new Uint8Array([1]), accounts: [{ address: ME, role: AccountRole.WRITABLE_SIGNER }, { address: MY_TA, role: AccountRole.WRITABLE }] },
    ]);
    const t = await explain({ wire }, { reader, idls: new IdlResolver([createBundledSource()]), me: [ME] });
    expect(t.stateChanges).toEqual([
      { address: MY_TA, kind: 'token-delegate', before: null, after: OTHER, amount: 100n, holder: ME, balance: 100n },
    ]);
    const v = viewFor(t, 'expert');
    expect(v.computeUnitPrice).toBe('1000');
    expect(v.stateChanges).toEqual([
      { address: MY_TA, kind: 'token-delegate', before: null, after: OTHER, amount: '100', holder: ME, balance: '100' },
    ]);
    expect(v.warnings).toEqual(t.warnings);
    expect(v.warnings).not.toBe(t.warnings);
    expect(v.warnings[0]).not.toBe(t.warnings[0]);
    expect(v.relations).not.toBe(t.relations);
    expect(v.issues).not.toBe(t.issues);
    v.warnings[0]!.severity = 'info';
    expect(t.warnings[0]!.severity).not.toBe('info');
    // Unknown (no successful simulation): null, not "no changes".
    expect(viewFor({ ...t, stateChanges: null }, 'expert').stateChanges).toBeNull();
  });

  it('expert shows a v1 transaction\'s version and config, never compute budget instruction values', async () => {
    const wire = buildV1Wire(
      [
        getSetComputeUnitLimitInstruction({ units: 999 }),
        getSetComputeUnitPriceInstruction({ microLamports: 77n }),
        getTransferSolInstruction({ source: createNoopSigner(ME), destination: OTHER, amount: 1n }),
      ],
      { config: { computeUnitLimit: 300_000, priorityFeeLamports: 1000n, loadedAccountsDataSizeLimit: 65_536, heapSize: 64 * 1024 } },
    );
    const t = await explain({ wire }, { reader: new MemoryChainReader(), idls: new IdlResolver([createBundledSource()]), me: [ME] });
    const v = viewFor(t, 'expert');
    expect(v).toMatchObject({ version: '1', computeUnitLimit: 300_000, priorityFeeLamports: '1000', loadedAccountsDataSizeLimit: 65_536, heapSize: 65_536, fee: '0.000006 SOL' });
    expect(v).not.toHaveProperty('computeUnitPrice');
    // Unset fields are absent.
    const bare = await explain(
      { wire: buildV1Wire([getTransferSolInstruction({ source: createNoopSigner(ME), destination: OTHER, amount: 1n })], { config: { computeUnitLimit: 5 } }) },
      { reader: new MemoryChainReader(), idls: new IdlResolver([createBundledSource()]), me: [ME] },
    );
    const bv = viewFor(bare, 'expert');
    expect(bv.computeUnitLimit).toBe(5);
    for (const k of ['priorityFeeLamports', 'loadedAccountsDataSizeLimit', 'heapSize', 'computeUnitPrice']) expect(bv).not.toHaveProperty(k);
    // Legacy and v0 never carry v1-only fields.
    for (const k of ['priorityFeeLamports', 'loadedAccountsDataSizeLimit', 'heapSize']) expect(viewFor(ex, 'expert')).not.toHaveProperty(k);
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
