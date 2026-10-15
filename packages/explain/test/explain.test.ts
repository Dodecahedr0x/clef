import { createBundledSource, IdlResolver, UserIdlSource } from '@clef/idl';
import { MemoryChainReader, type RawAccount, type TxMeta } from '@clef/rpc';
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';
import { getTransferSolInstruction } from '@solana-program/system';
import { getApproveInstruction, getTransferCheckedInstruction, getTransferInstruction } from '@solana-program/token';
import { AccountRole, address, createNoopSigner, type Address, type Instruction } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { explain, shortAddress, CLOCK_SYSVAR, COMPUTE_BUDGET_PROGRAM, STAKE_PROGRAM, TOKEN_PROGRAM, type ExplainContext } from '../src';
import { buildWire, ME, OTHER, simulateWith, tokenAccountData, USDC } from './helpers';
import { AUTHORITY, VAULT, depositInstruction, setPool, vaultAddresses } from './vault';
import vaultJson from './fixtures/vault-anchor.json' with { type: 'json' };

const me = createNoopSigner(ME);
const MY_USDC = address('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
const OTHER_USDC = address('8VJxZ3tRvpHFAMrUmEfPQh4SXP8a2hDuDb6ZZnLK2gGq');
const ATTACKER = address('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh');
const DRAINER = address('FXZYmk8C97rhzTn7nE8YZCw1V9EGofcJ8jJ5XidoddLz');
const SOL = 1_000_000_000n;

const ctx = (reader: MemoryChainReader, over: Partial<ExplainContext> = {}): ExplainContext => ({
  reader, idls: new IdlResolver([createBundledSource()]), me: [ME], ...over,
});
const rules = (ex: { warnings: { rule: string; severity: string }[] }) => ex.warnings.map((w) => [w.rule, w.severity]);

const tokenAccount = (reader: MemoryChainReader, at: Address, owner: Address, amount: bigint, mint: Address = USDC) =>
  reader.setAccount({ address: at, owner: address(TOKEN_PROGRAM), data: tokenAccountData(owner, mint, amount) });

describe('explain', () => {
  it('explains a SOL transfer end to end with simulated balance changes', async () => {
    const reader = new MemoryChainReader();
    reader.setAccount({ address: ME, owner: OTHER, lamports: 10_000_000_000n, data: new Uint8Array() });
    reader.simulateImpl = async (_wire, addresses) => ({
      err: null, logs: [], unitsConsumed: 150n,
      postAccounts: addresses.map((a) => ({
        address: a, owner: OTHER, executable: false, data: new Uint8Array(),
        lamports: a === ME ? 8_500_000_000n : 1_500_000_000n,
      })),
    });
    const wire = buildWire([getTransferSolInstruction({ source: me, destination: OTHER, amount: 1_500_000_000n })]);
    const ex = await explain({ wire }, ctx(reader));

    expect(ex.summary).toBe(`Send 1.5 SOL to ${OTHER.slice(0, 4)}\u2026${OTHER.slice(-4)}`);
    expect(ex.instructions[0]).toMatchObject({ name: 'transferSol', programName: 'system' });
    expect(ex.instructions[0]!.accounts[0]).toMatchObject({ name: 'source', mine: true, label: 'Your wallet' });
    expect(ex.balanceChanges).toContainEqual({ owner: ME, mint: 'SOL', symbol: 'SOL', decimals: 9, delta: -1_500_000_000n });
    expect(ex.warnings).toEqual([]);
    expect(ex.issues).toEqual([]);
  });

  it('records a failed simulation as an issue and a warning, without throwing', async () => {
    const reader = new MemoryChainReader();
    reader.simulateImpl = async () => ({ err: { InstructionError: [0, { Custom: 1 }] }, logs: [], unitsConsumed: null, postAccounts: [] });
    const wire = buildWire([getTransferSolInstruction({ source: me, destination: OTHER, amount: 1n })]);
    const ex = await explain({ wire }, ctx(reader));
    expect(ex.balanceChanges).toBeNull();
    expect(ex.issues[0]).toMatchObject({ stage: 'simulate' });
    expect(ex.warnings.map((w) => w.rule)).toContain('simulation-failed');
  });

  it('treats a misaligned simulation result as a failed simulation', async () => {
    const reader = new MemoryChainReader();
    reader.simulateImpl = async (_wire, addresses) => ({
      err: null, logs: [], unitsConsumed: null,
      postAccounts: [...addresses].reverse().map((a) => ({ address: a, owner: OTHER, lamports: 1n, data: new Uint8Array(), executable: false })),
    });
    const wire = buildWire([getTransferSolInstruction({ source: me, destination: OTHER, amount: 1n })]);
    const ex = await explain({ wire }, ctx(reader));
    expect(ex.balanceChanges).toBeNull();
    expect(ex.issues).toContainEqual(expect.objectContaining({ stage: 'simulate' }));
  });

  it('collects verified relations for an Anchor program', async () => {
    const accounts = await vaultAddresses();
    const reader = new MemoryChainReader();
    await setPool(reader, accounts.pool, { mint: accounts.mint, authority: AUTHORITY });
    const user = new UserIdlSource();
    user.set(VAULT, JSON.stringify(vaultJson));
    const ix = await depositInstruction(accounts);
    const wire = buildWire([{ programAddress: ix.programId, data: ix.data, accounts: ix.accounts.map((a) => ({ address: a.address, role: ((a.signer ? 2 : 0) | (a.writable ? 1 : 0)) as AccountRole })) }]);

    const ex = await explain({ wire }, { reader, idls: new IdlResolver([user]), me: [ME] });
    expect(ex.relations.filter((r) => r.instructionIndex === 0).map((r) => r.status)).toEqual(
      ['verified', 'verified', 'verified', 'verified', 'verified'],
    );
    expect(ex.warnings.filter((w) => w.severity === 'danger')).toEqual([]);
    // Verification-only fields never leave the orchestrator.
    for (const out of ex.instructions) {
      expect(out).not.toHaveProperty('rawArgs');
      expect(out).not.toHaveProperty('resolvedIdl');
    }
    expect(JSON.stringify(ex, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toMatch(/rawArgs|resolvedIdl/);
  });

  it('does not verify relations from state an earlier instruction may have modified', async () => {
    const accounts = await vaultAddresses();
    const reader = new MemoryChainReader();
    await setPool(reader, accounts.pool, { mint: accounts.mint, authority: AUTHORITY });
    const user = new UserIdlSource();
    user.set(VAULT, JSON.stringify(vaultJson));
    const ix = await depositInstruction(accounts);
    const deposit: Instruction = { programAddress: ix.programId, data: ix.data, accounts: ix.accounts.map((a) => ({ address: a.address, role: ((a.signer ? 2 : 0) | (a.writable ? 1 : 0)) as AccountRole })) };
    // Instruction 0 writes the pool; instruction 1 reads it for has_one.
    const wire = buildWire([getTransferSolInstruction({ source: me, destination: accounts.pool, amount: 1n }), deposit]);

    const ex = await explain({ wire }, { reader, idls: new IdlResolver([user, createBundledSource()]), me: [ME] });
    const hasOne = ex.relations.filter((r) => r.instructionIndex === 1 && r.kind === 'has_one');
    expect(hasOne.length).toBeGreaterThan(0);
    for (const r of hasOne) expect(r).toMatchObject({ status: 'unverified', detail: expect.stringContaining('earlier instruction') });
  });

  it('omits stake account names in the legacy layout', async () => {
    const STAKE_ACC = address('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
    const data = new Uint8Array(8);
    new DataView(data.buffer).setUint32(0, 10, true); // authorizeChecked
    new DataView(data.buffer).setUint32(4, 1, true); // Withdrawer
    const legacy: Instruction = {
      programAddress: address(STAKE_PROGRAM),
      data,
      // Legacy: [stake, clock, old authority, new authority].
      accounts: [
        { address: STAKE_ACC, role: AccountRole.WRITABLE },
        { address: address(CLOCK_SYSVAR), role: AccountRole.READONLY },
        { address: ME, role: AccountRole.READONLY_SIGNER },
        { address: OTHER, role: AccountRole.READONLY_SIGNER },
      ],
    };
    const ex = await explain({ wire: buildWire([legacy]) }, ctx(new MemoryChainReader()));
    expect(ex.instructions[0]!.name).toBe('authorizeChecked');
    expect(ex.instructions[0]!.accounts.map((a) => a.name)).toEqual(['stake', undefined, undefined, undefined]);
    expect(ex.issues).toContainEqual({ stage: 'parse', instructionIndex: 0, message: 'legacy stake account layout; names omitted' });
    // Risk rules read stake accounts by position: the hand-off to OTHER is still caught.
    expect(rules(ex)).toContainEqual(['authority-change', 'danger']);
  });

  it('flags a CPI drainer that only sets a delegate on your token account (N4)', async () => {
    const reader = new MemoryChainReader();
    reader.setAccount({ address: ME, owner: address('11111111111111111111111111111111'), lamports: 5n * SOL, data: new Uint8Array() });
    tokenAccount(reader, MY_USDC, ME, 100_000_000n);
    simulateWith(reader, {
      [MY_USDC]: { data: tokenAccountData(ME, USDC, 100_000_000n, { delegate: ATTACKER, delegatedAmount: 100_000_000n }) },
    });
    const drain: Instruction = {
      programAddress: DRAINER,
      data: new Uint8Array([7]),
      accounts: [
        { address: ME, role: AccountRole.WRITABLE_SIGNER },
        { address: MY_USDC, role: AccountRole.WRITABLE },
        { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
      ],
    };
    const ex = await explain({ wire: buildWire([drain]) }, ctx(reader));
    // Only the fee moves.
    expect(ex.balanceChanges).toEqual([{ owner: ME, mint: 'SOL', symbol: 'SOL', decimals: 9, delta: -5000n }]);
    expect(rules(ex)).toContainEqual(['delegation', 'danger']);
    expect(rules(ex)).toContainEqual(['unknown-program', 'warn']);
  });

  it('does not let a user IDL rename a Token approve', async () => {
    const reader = new MemoryChainReader();
    tokenAccount(reader, MY_USDC, ME, 100n);
    const user = new UserIdlSource();
    user.set(address(TOKEN_PROGRAM), JSON.stringify({
      address: TOKEN_PROGRAM, metadata: { name: 'token', version: '0.1.0', spec: '0.1.0' },
      instructions: [{ name: 'harmless', discriminator: [4], accounts: [{ name: 'a', writable: true }, { name: 'b' }, { name: 'c', signer: true }], args: [{ name: 'x', type: 'u64' }] }],
    }));
    const wire = buildWire([getApproveInstruction({ source: MY_USDC, delegate: ATTACKER, owner: me, amount: (1n << 64n) - 1n })]);
    const ex = await explain({ wire }, ctx(reader, { idls: new IdlResolver([user, createBundledSource()]) }));
    expect(ex.instructions[0]).toMatchObject({ name: 'approve', idl: { trust: 'curated' } });
    expect(rules(ex)).toContainEqual(['delegation', 'danger']);
  });

  it('rates a limited top-level approve as warn, using the pre-state balance', async () => {
    const run = async (amount: bigint) => {
      const reader = new MemoryChainReader();
      tokenAccount(reader, MY_USDC, ME, 100n);
      simulateWith(reader, { [MY_USDC]: { data: tokenAccountData(ME, USDC, 100n, { delegate: OTHER, delegatedAmount: amount }) } });
      const wire = buildWire([getApproveInstruction({ source: MY_USDC, delegate: OTHER, owner: me, amount })]);
      return explain({ wire }, ctx(reader));
    };
    const limited = await run(5n);
    expect(rules(limited)).toEqual([['delegation', 'warn']]);
    expect(limited.instructions[0]!.accounts[0]).toMatchObject({ name: 'source', mine: true });
    expect(limited.instructions[0]!.amountUnit).toEqual({ symbol: 'USDC', decimals: 6 });
    expect(rules(await run(100n))).toEqual([['delegation', 'danger']]);
    // The fee the simulation charges is not a send.
    expect(limited.summary).not.toMatch(/Send/);
  });

  it('flags a sweep of SOL and USDC to a wallet, and the summary still lists the outflows', async () => {
    const reader = new MemoryChainReader();
    reader.setAccount({ address: ME, owner: address('11111111111111111111111111111111'), lamports: 10n * SOL, data: new Uint8Array() });
    tokenAccount(reader, MY_USDC, ME, 100_000_000n);
    tokenAccount(reader, OTHER_USDC, OTHER, 0n);
    simulateWith(reader, {
      [ME]: { lamports: 8n * SOL },
      [OTHER]: { lamports: 2n * SOL, owner: address('11111111111111111111111111111111') },
      [MY_USDC]: { data: tokenAccountData(ME, USDC, 0n) },
      [OTHER_USDC]: { data: tokenAccountData(OTHER, USDC, 100_000_000n) },
    });
    const wire = buildWire([
      getTransferSolInstruction({ source: me, destination: OTHER, amount: 2n * SOL }),
      getTransferCheckedInstruction({ source: MY_USDC, mint: USDC, destination: OTHER_USDC, authority: me, amount: 100_000_000n, decimals: 6 }),
    ]);
    const ex = await explain({ wire }, ctx(reader));
    expect(rules(ex)).toContainEqual(['sweep', 'danger']);
    expect(ex.summary).toContain('2 SOL');
    expect(ex.summary).toContain('100 USDC');
    expect(ex.summary).toMatch(/^Send /);
    // The recipient is named in the summary and in the warning.
    expect(ex.summary).toContain(`to ${shortAddress(OTHER)}`);
    expect(ex.warnings.find((w) => w.rule === 'sweep')!.message).toContain(shortAddress(OTHER));
  });

  it('counts the priority fee read from compute budget instructions as expected spend', async () => {
    const run = async (microLamports: bigint, lost: bigint) => {
      const reader = new MemoryChainReader();
      reader.setAccount({ address: ME, owner: address('11111111111111111111111111111111'), lamports: 5n * SOL, data: new Uint8Array() });
      simulateWith(reader, {}, { fee: lost });
      const wire = buildWire([
        getSetComputeUnitLimitInstruction({ units: 1_000_000 }),
        getSetComputeUnitPriceInstruction({ microLamports }),
        { programAddress: DRAINER, data: new Uint8Array([1]), accounts: [{ address: ME, role: AccountRole.WRITABLE_SIGNER }] },
      ]);
      return rules(await explain({ wire }, ctx(reader)));
    };
    // 1M CU at 8e6 microLamports = 0.008 SOL priority fee + 5000 base, plus 0.005 SOL of rent: not an outflow.
    expect(await run(8_000_000n, 13_005_000n)).toEqual([['unknown-program', 'warn']]);
    // The same loss without the priority fee is beyond the rent slack.
    expect(await run(0n, 13_005_000n)).toContainEqual(['unexplained-outflow', 'danger']);
    // A priority fee above 0.01 SOL is flagged, and only 0.01 SOL of it is allowed for.
    expect(await run(20_000_000n, 20_005_000n)).toEqual([['unknown-program', 'warn'], ['high-fee', 'warn']]);
    expect(await run(20_000_000n, 30_005_001n)).toContainEqual(['unexplained-outflow', 'danger']);
  });

  it('flags an absurd priority fee, and never summarizes it as a plain transfer', async () => {
    const reader = new MemoryChainReader();
    reader.setAccount({ address: ME, owner: address('11111111111111111111111111111111'), lamports: 10n * SOL, data: new Uint8Array() });
    const fee = 8_400_005_000n; // 1.4M CU x 6e9 microLamports + 5000
    simulateWith(reader, { [ME]: { lamports: 10n * SOL - SOL / 1000n }, [OTHER]: { lamports: SOL / 1000n, owner: address('11111111111111111111111111111111') } }, { fee });
    const wire = buildWire([
      getSetComputeUnitLimitInstruction({ units: 1_400_000 }),
      getSetComputeUnitPriceInstruction({ microLamports: 6_000_000_000n }),
      getTransferSolInstruction({ source: me, destination: OTHER, amount: SOL / 1000n }),
    ]);
    const ex = await explain({ wire }, ctx(reader));
    expect(ex.fee).toBe(fee);
    expect(rules(ex)).toContainEqual(['high-fee', 'danger']);
    expect(ex.summary).not.toBe(`Send 0.001 SOL to ${shortAddress(OTHER)}`);
    // Only the base fee and 0.01 SOL of priority fee are taken out of what you send.
    expect(ex.summary).toMatch(/^Send 8\.391 SOL/);
  });

  it('leaves the fee unknown when a compute budget instruction cannot be decoded', async () => {
    const reader = new MemoryChainReader();
    const bogus: Instruction = { programAddress: address(COMPUTE_BUDGET_PROGRAM), data: new Uint8Array([99]), accounts: [] };
    const ex = await explain({ wire: buildWire([bogus, getTransferSolInstruction({ source: me, destination: OTHER, amount: 1n })]) }, ctx(reader));
    expect(ex.fee).toBeNull();
  });

  it('shows raw units, never assumed decimals, for a token whose mint is unknown', async () => {
    const MINT = address('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');
    const reader = new MemoryChainReader();
    tokenAccount(reader, MY_USDC, ME, 5_000_000n, MINT);
    tokenAccount(reader, OTHER_USDC, OTHER, 0n, MINT);
    simulateWith(reader, {
      [MY_USDC]: { data: tokenAccountData(ME, MINT, 2_500_000n) },
      [OTHER_USDC]: { data: tokenAccountData(OTHER, MINT, 2_500_000n) },
    });
    const wire = buildWire([getTransferInstruction({ source: MY_USDC, destination: OTHER_USDC, authority: me, amount: 2_500_000n })]);
    const ex = await explain({ wire }, ctx(reader));
    expect(ex.instructions[0]!.amountUnit).toBeUndefined();
    expect(ex.balanceChanges).toContainEqual({ owner: ME, mint: MINT, symbol: undefined, decimals: null, delta: -2_500_000n });
    expect(ex.summary).toBe(`Send 2500000 (raw units) ${shortAddress(MINT)} to ${shortAddress(OTHER)}`);
  });

  it('loads the mints of token accounts created in the transaction', async () => {
    const MINT = address('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');
    const reader = new MemoryChainReader();
    const mint = new Uint8Array(82);
    mint[44] = 3; // decimals
    mint[45] = 1; // initialized
    reader.setAccount({ address: MINT, owner: address(TOKEN_PROGRAM), data: mint });
    // A CPI creates a token account of MINT for you; MINT itself is not in the transaction.
    simulateWith(reader, { [MY_USDC]: { owner: address(TOKEN_PROGRAM), lamports: 2_039_280n, data: tokenAccountData(ME, MINT, 7_000n) } });
    const create: Instruction = {
      programAddress: DRAINER, data: new Uint8Array([2]),
      accounts: [{ address: ME, role: AccountRole.WRITABLE_SIGNER }, { address: MY_USDC, role: AccountRole.WRITABLE }],
    };
    const ex = await explain({ wire: buildWire([create]) }, ctx(reader));
    expect(ex.balanceChanges).toContainEqual(expect.objectContaining({ owner: ME, mint: MINT, decimals: 3, delta: 7_000n }));
  });

  it('uses tx meta instead of simulating when given', async () => {
    const reader = new MemoryChainReader();
    reader.simulateImpl = async () => {
      throw new Error('must not simulate');
    };
    const wire = buildWire([getTransferSolInstruction({ source: me, destination: OTHER, amount: SOL })]);
    const meta: TxMeta = {
      err: null, fee: 5000n,
      preBalances: [3n * SOL, 0n, 1n], postBalances: [2n * SOL - 5000n, SOL, 1n],
      preTokenBalances: [], postTokenBalances: [],
      loadedAddresses: { writable: [], readonly: [] }, logMessages: [],
    };
    const ex = await explain({ wire, meta }, ctx(reader));
    expect(ex.issues).toEqual([]);
    expect(ex.balanceChanges).toEqual([
      { owner: ME, mint: 'SOL', symbol: 'SOL', decimals: 9, delta: -SOL - 5000n },
      { owner: OTHER, mint: 'SOL', symbol: 'SOL', decimals: 9, delta: SOL },
    ]);
    expect(ex.warnings).toEqual([]);
  });

  it('labels with the address book and marks it as not a sweep target', async () => {
    const reader = new MemoryChainReader();
    reader.setAccount({ address: ME, owner: address('11111111111111111111111111111111'), lamports: 10n * SOL, data: new Uint8Array() });
    simulateWith(reader, { [ME]: { lamports: 3n * SOL } });
    const wire = buildWire([getTransferSolInstruction({ source: me, destination: OTHER, amount: 7n * SOL })]);
    const ex = await explain({ wire }, ctx(reader, { addressBook: { [OTHER]: 'Alice' } }));
    expect(ex.summary).toBe('Send 7 SOL to Alice');
    // A token transfer names the destination's owner wallet, not the token account.
    const r2 = new MemoryChainReader();
    tokenAccount(r2, MY_USDC, ME, 10_000_000n);
    tokenAccount(r2, OTHER_USDC, OTHER, 0n);
    simulateWith(r2, { [MY_USDC]: { data: tokenAccountData(ME, USDC, 9_000_000n) }, [OTHER_USDC]: { data: tokenAccountData(OTHER, USDC, 1_000_000n) } });
    const send = buildWire([getTransferCheckedInstruction({ source: MY_USDC, mint: USDC, destination: OTHER_USDC, authority: me, amount: 1_000_000n, decimals: 6 })]);
    expect((await explain({ wire: send }, ctx(r2, { addressBook: { [OTHER]: 'Alice' } }))).summary).toBe('Send 1 USDC to Alice');
    expect(ex.instructions[0]!.accounts[1]).toMatchObject({ label: 'Alice', mine: false });
  });
});

