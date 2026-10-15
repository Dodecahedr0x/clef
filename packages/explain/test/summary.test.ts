import { address, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import {
  KNOWN_PROGRAMS,
  RENT_SLACK,
  TRUSTED_PROGRAMS,
  formatUnits,
  programDisplay,
  shortAddress,
  summarize,
  COMPUTE_BUDGET_PROGRAM,
  CLOCK_SYSVAR,
  STAKE_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  U64_MAX,
  type ExplainedInstruction,
  type Warning,
} from '../src';
import { ME, OTHER, USDC } from './helpers';

const base = { accounts: [], data: new Uint8Array() };
const curated = { source: 'bundled' as const, trust: 'curated' as const, hash: 'h' };
const SRC = address('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
const DST = address('8VJxZ3tRvpHFAMrUmEfPQh4SXP8a2hDuDb6ZZnLK2gGq');

const transferSol = (over: Partial<ExplainedInstruction> = {}): ExplainedInstruction => ({
  ...base, index: 1, programId: address(SYSTEM_PROGRAM), name: 'transferSol', args: { amount: 1_500_000_000n }, idl: curated,
  accounts: [
    { name: 'source', address: ME, signer: true, writable: true, mine: true },
    { name: 'destination', address: OTHER, signer: false, writable: true, mine: false, label: 'Alice' },
  ],
  ...over,
});

const tokenTransfer = (amountUnit?: ExplainedInstruction['amountUnit']): ExplainedInstruction => ({
  ...base, index: 0, programId: address(TOKEN_PROGRAM), name: 'transfer', args: { amount: 2_500_000n }, idl: curated,
  ...(amountUnit && { amountUnit }),
  accounts: [
    { name: 'source', address: SRC, signer: false, writable: true, mine: true },
    { name: 'destination', address: DST, signer: false, writable: true, mine: false },
    { name: 'authority', address: ME, signer: true, writable: false, mine: true },
  ],
});

describe('formatUnits', () => {
  it('formats with decimals and trims zeros', () => {
    expect(formatUnits(1_500_000_000n, 9)).toBe('1.5');
    expect(formatUnits(-60n, 6)).toBe('-0.00006');
    expect(formatUnits(42n, 0)).toBe('42');
  });

  it('shows raw base units when decimals are unknown, never assuming 0', () => {
    expect(formatUnits(1_000_000n, null)).toBe('1000000 (raw units)');
    expect(formatUnits(-5n, null)).toBe('-5 (raw units)');
  });
});

describe('programDisplay', () => {
  it('uses the registry for known programs, whatever the IDL calls itself', () => {
    expect(programDisplay({ programId: address(SYSTEM_PROGRAM), programName: 'evil' })).toBe('System Program');
  });

  it('qualifies IDL names of other programs with the trust tier and short address', () => {
    const ix = { programId: OTHER, programName: 'system', idl: { ...curated, source: 'program-metadata' as const, trust: 'authority' as const } };
    expect(programDisplay(ix)).toBe(`system (authority IDL, ${shortAddress(OTHER)})`);
    expect(programDisplay({ programId: OTHER })).toBe(shortAddress(OTHER));
  });

  it('names other programs from the address book, qualified as such, ahead of their IDL name', () => {
    expect(programDisplay({ programId: OTHER, programLabel: 'Router' })).toBe(`Router (address book, ${shortAddress(OTHER)})`);
    const ix = { programId: OTHER, programName: 'jupiter', programLabel: 'Router', idl: { ...curated, trust: 'authority' as const } };
    expect(programDisplay(ix)).toBe(`Router (address book, ${shortAddress(OTHER)})`);
    // The registry still wins.
    expect(programDisplay({ programId: address(SYSTEM_PROGRAM), programLabel: 'Router' })).toBe('System Program');
  });

  it('names pump.fun and PumpSwap, as display labels only', () => {
    const PUMP = address('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
    const PUMP_SWAP = address('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
    expect(programDisplay({ programId: PUMP, programLabel: 'Mine' })).toBe('pump.fun');
    expect(programDisplay({ programId: PUMP_SWAP })).toBe('PumpSwap');
    for (const p of [PUMP, PUMP_SWAP]) {
      expect(TRUSTED_PROGRAMS.has(p)).toBe(false);
      expect(Object.hasOwn(KNOWN_PROGRAMS, p)).toBe(false);
    }
  });
});

describe('summarize', () => {
  it('uses a template for a lone known instruction, ignoring compute budget', () => {
    const instructions: ExplainedInstruction[] = [
      { ...base, index: 0, programId: address(COMPUTE_BUDGET_PROGRAM), name: 'setComputeUnitPrice' },
      transferSol(),
    ];
    expect(summarize({ instructions, balanceChanges: null, me: [ME] })).toBe('Send 1.5 SOL to Alice');
  });

  it('does not apply templates to names from non-curated IDLs', () => {
    const userIdl = { source: 'user' as const, trust: 'user' as const, hash: 'h' };
    const instructions = [transferSol({ idl: userIdl })];
    expect(summarize({ instructions, balanceChanges: [], me: [ME] })).toBe('Interact with System Program');
  });

  it('says whose funds move when the source is not yours', () => {
    const ix = transferSol();
    ix.accounts[0] = { ...ix.accounts[0]!, mine: false, address: SRC };
    expect(summarize({ instructions: [ix], balanceChanges: null, me: [ME] })).toBe(`Transfer 1.5 SOL from ${shortAddress(SRC)} to Alice`);
  });

  it('templates token transfers only when the amount unit is known', () => {
    expect(summarize({ instructions: [tokenTransfer({ symbol: 'USDC', decimals: 6 })], balanceChanges: null, me: [ME] })).toBe(
      `Send 2.5 USDC to ${shortAddress(DST)}`,
    );
    // Unknown decimals: fall back to the balance changes, in raw units.
    const MINT = address('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh');
    const balanceChanges = [{ owner: ME, mint: MINT, decimals: null, delta: -2_500_000n }];
    expect(summarize({ instructions: [tokenTransfer()], balanceChanges, me: [ME] })).toBe(
      `Send 2500000 (raw units) ${shortAddress(MINT)}`,
    );
  });

  it('names the recipient when all outflows go to one owner', () => {
    const instructions: ExplainedInstruction[] = [{ ...base, index: 0, programId: OTHER }];
    const change = (owner: Address, mint: Address | 'SOL', delta: bigint) =>
      ({ owner, mint, symbol: mint === 'SOL' ? 'SOL' : 'USDC', decimals: mint === 'SOL' ? 9 : 6, delta });
    const oneOwner = [change(ME, 'SOL', -1_000_000_000n), change(SRC, 'SOL', 1_000_000_000n), change(ME, USDC, -5_000_000n), change(SRC, USDC, 5_000_000n)];
    expect(summarize({ instructions, balanceChanges: oneOwner, me: [ME], labels: { [SRC]: 'Bob' } })).toBe(
      `Send 1 SOL, 5 USDC to Bob via ${shortAddress(OTHER)}`,
    );
    const twoOwners = [...oneOwner.slice(0, 3), change(DST, USDC, 5_000_000n)];
    expect(summarize({ instructions, balanceChanges: twoOwners, me: [ME] })).toBe(`Send 1 SOL, 5 USDC via ${shortAddress(OTHER)}`);
  });

  it('names the owner wallet of a token transfer destination when known', () => {
    const ix = tokenTransfer({ symbol: 'USDC', decimals: 6 });
    expect(summarize({ instructions: [ix], balanceChanges: null, me: [ME], tokenOwners: { [DST]: OTHER } })).toBe(
      `Send 2.5 USDC to ${shortAddress(OTHER)}`,
    );
    expect(summarize({ instructions: [ix], balanceChanges: null, me: [ME], tokenOwners: { [DST]: OTHER }, labels: { [OTHER]: 'Alice' } })).toBe(
      'Send 2.5 USDC to Alice',
    );
  });

  it('falls back to balance changes and program names', () => {
    const idl = { source: 'program-metadata' as const, trust: 'authority' as const, hash: 'h' };
    const instructions: ExplainedInstruction[] = [
      { ...base, index: 0, programId: OTHER, programName: 'jupiter', name: 'route', idl },
    ];
    const balanceChanges = [
      { owner: ME, mint: 'SOL' as const, symbol: 'SOL', decimals: 9, delta: -1_500_000_000n },
      { owner: ME, mint: USDC, symbol: 'USDC', decimals: 6, delta: 212_400_000n },
    ];
    expect(summarize({ instructions, balanceChanges, me: [ME] })).toBe(
      `Send 1.5 SOL, receive 212.4 USDC via jupiter (authority IDL, ${shortAddress(OTHER)})`,
    );
  });

  it('does not count the network fee as a send', () => {
    const instructions: ExplainedInstruction[] = [{ ...base, index: 0, programId: OTHER }];
    const sol = (delta: bigint) => [{ owner: ME, mint: 'SOL' as const, symbol: 'SOL', decimals: 9, delta }];
    expect(summarize({ instructions, balanceChanges: sol(-5000n), me: [ME], fee: 5000n, feePayer: ME })).toBe(`Interact with ${shortAddress(OTHER)}`);
    expect(summarize({ instructions, balanceChanges: sol(-1_000_005_000n), me: [ME], fee: 5000n, feePayer: ME })).toBe(
      `Send 1 SOL via ${shortAddress(OTHER)}`,
    );
    // Someone else pays: your loss is all yours.
    expect(summarize({ instructions, balanceChanges: sol(-5000n), me: [ME], fee: 5000n, feePayer: OTHER })).toBe(
      `Send 0.000005 SOL via ${shortAddress(OTHER)}`,
    );
  });

  it('does not call a rent-sized SOL gain a receive when nothing of yours leaves', () => {
    const instructions: ExplainedInstruction[] = [{ ...base, index: 0, programId: OTHER }];
    const sol = (delta: bigint) => [{ owner: ME, mint: 'SOL' as const, symbol: 'SOL', decimals: 9, delta }];
    expect(summarize({ instructions, balanceChanges: sol(2_039_280n), me: [ME] })).toBe(`Interact with ${shortAddress(OTHER)}`);
    expect(summarize({ instructions, balanceChanges: sol(RENT_SLACK), me: [ME] })).toBe(`Interact with ${shortAddress(OTHER)}`);
    expect(summarize({ instructions, balanceChanges: sol(RENT_SLACK + 1n), me: [ME] })).toBe(`Receive 0.010000001 SOL via ${shortAddress(OTHER)}`);
    // A swap with a small SOL output: the SOL is what comes back, so it is a receive.
    const swap = [...sol(193_618n), { owner: ME, mint: USDC, symbol: 'USDC', decimals: 6, delta: -1_000_000n }];
    expect(summarize({ instructions, balanceChanges: swap, me: [ME] })).toBe(`Send 1 USDC, receive 0.000193618 SOL via ${shortAddress(OTHER)}`);
  });

  it('describes interactions when nothing moves', () => {
    const instructions: ExplainedInstruction[] = [{ ...base, index: 0, programId: OTHER }];
    expect(summarize({ instructions, balanceChanges: [], me: [ME] })).toBe(`Interact with ${OTHER.slice(0, 4)}\u2026${OTHER.slice(-4)}`);
  });

  it('says when balance changes are unknown', () => {
    const instructions: ExplainedInstruction[] = [{ ...base, index: 0, programId: OTHER }];
    expect(summarize({ instructions, balanceChanges: null, me: [ME] })).toBe(
      `Interact with ${shortAddress(OTHER)} (balance changes unknown)`,
    );
  });

  it('never reads as benign when a sweep or unexplained outflow is flagged', () => {
    const balanceChanges = [
      { owner: ME, mint: 'SOL' as const, symbol: 'SOL', decimals: 9, delta: -1_500_000_000n },
      { owner: OTHER, mint: 'SOL' as const, symbol: 'SOL', decimals: 9, delta: 1_500_000_000n },
    ];
    const sweep: Warning[] = [{ rule: 'sweep', severity: 'danger', message: 'm' }];
    // The template would only describe the instruction; the summary must state what actually leaves.
    expect(summarize({ instructions: [transferSol()], balanceChanges, me: [ME], warnings: sweep })).toBe(`Send 1.5 SOL to ${shortAddress(OTHER)} -- m`);
    const highFee: Warning[] = [{ rule: 'high-fee', severity: 'warn', message: 'm' }];
    // A high fee keeps the template and says so, warn or danger.
    expect(summarize({ instructions: [transferSol()], balanceChanges, me: [ME], warnings: highFee })).toBe('Send 1.5 SOL to Alice -- m');
    // Without a template, the whole fee comes out of what you send.
    const unknown: ExplainedInstruction = { ...base, index: 0, programId: OTHER };
    const paid = [{ owner: ME, mint: 'SOL' as const, symbol: 'SOL', decimals: 9, delta: -1_000_005_000n }];
    expect(summarize({ instructions: [unknown], balanceChanges: paid, me: [ME], warnings: highFee, fee: 1_000_005_000n, baseFee: 5000n, feePayer: ME })).toBe(
      `Interact with ${shortAddress(OTHER)} -- m`,
    );
    const unexplained: Warning[] = [{ rule: 'unexplained-outflow', severity: 'danger', message: 'm' }];
    expect(summarize({ instructions: [transferSol()], balanceChanges: null, me: [ME], warnings: unexplained })).toBe(
      'Interact with System Program (balance changes unknown) -- m',
    );
  });
});

describe('summary templates for authority-moving instructions', () => {
  const DELEGATE = address('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh');
  const acc = (name: string | undefined, a: Address, over: { mine?: boolean; label?: string } = {}) =>
    ({ name, address: a, signer: false, writable: true, mine: over.mine ?? false, ...(over.label && { label: over.label }) });
  const token = (name: string, accounts: ReturnType<typeof acc>[], args: Record<string, unknown> = {}, over: Partial<ExplainedInstruction> = {}): ExplainedInstruction =>
    ({ ...base, index: 0, programId: address(TOKEN_PROGRAM), name, idl: curated, accounts, args, ...over });
  const usdc = { symbol: 'USDC', decimals: 6 };
  const src = acc('source', SRC, { mine: true, label: 'Your USDC token account' });
  const approve = (amount: bigint) =>
    token('approve', [src, acc('delegate', DELEGATE), acc('owner', ME, { mine: true })], { amount }, { amountUnit: usdc });
  const one = (ix: ExplainedInstruction, over: Partial<Parameters<typeof summarize>[0]> = {}) =>
    summarize({ instructions: [ix], balanceChanges: [], me: [ME], ...over });

  it('approve: unlimited, entire balance, or an amount', () => {
    const d = shortAddress(DELEGATE);
    expect(one(approve(U64_MAX))).toBe(`Let ${d} spend UNLIMITED USDC from Your USDC token account`);
    const tokenBalances = { [SRC]: { owner: ME, mint: USDC, amount: 5_000_000n } };
    expect(one(approve(5_000_000n), { tokenBalances })).toBe(`Let ${d} spend your entire USDC from Your USDC token account`);
    expect(one(approve(1_000_000n), { tokenBalances })).toBe(`Let ${d} spend 1 USDC from Your USDC token account`);
    // Unknown balance and unknown unit.
    const raw = token('approve', [src, acc('delegate', DELEGATE), acc('owner', ME)], { amount: 7n });
    expect(one(raw)).toBe(`Let ${d} spend 7 (raw units) tokens from Your USDC token account`);
  });

  it('revoke, setAuthority, closeAccount', () => {
    expect(one(token('revoke', [src, acc('owner', ME)]))).toBe('Revoke the delegate of Your USDC token account');
    const set = (newAuthority: unknown) => token('setAuthority', [{ ...src, name: 'owned' }, acc('owner', ME)], { authorityType: { __kind: 'CloseAccount', __discriminator: 3 }, newAuthority });
    expect(one(set({ __option: 'Some', value: DELEGATE }))).toBe(`Set the close account authority of Your USDC token account to ${shortAddress(DELEGATE)}`);
    expect(one(set({ __option: 'None' }))).toBe('Revoke the close account authority of Your USDC token account');
    expect(one(set('garbage'))).toBe('Interact with Token Program');
    const close = token('closeAccount', [{ ...src, name: 'account' }, acc('destination', DELEGATE, { label: 'Bob' }), acc('owner', ME)]);
    expect(one(close)).toBe('Close Your USDC token account and send its rent to Bob');
  });

  it('stake authorize, withdraw and delegate (accounts by position)', () => {
    const STAKE = address('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
    const stake = (name: string, accounts: ReturnType<typeof acc>[], args: Record<string, unknown> = {}): ExplainedInstruction =>
      ({ ...base, index: 0, programId: address(STAKE_PROGRAM), name, idl: curated, accounts, args });
    const s = shortAddress(STAKE);
    const d = shortAddress(DELEGATE);
    const withdrawer = { __kind: 'Withdrawer', __discriminator: 1 };
    expect(one(stake('authorize', [acc('stake', STAKE), acc(undefined, address(CLOCK_SYSVAR))], { arg0: DELEGATE, arg1: withdrawer }))).toBe(
      `Make ${d} the withdrawer of stake account ${s}`,
    );
    // authorizeChecked, legacy layout [stake, clock, old, new]: names were omitted, positions still work.
    const legacy = [acc('stake', STAKE), acc(undefined, address(CLOCK_SYSVAR)), acc(undefined, ME), acc(undefined, DELEGATE)];
    expect(one(stake('authorizeChecked', legacy, { stakeAuthorize: { __kind: 'Staker', __discriminator: 0 } }))).toBe(
      `Make ${d} the staker of stake account ${s}`,
    );
    expect(one(stake('withdraw', [acc('stake', STAKE), acc('recipient', DELEGATE)], { args: 2_000_000_000n }))).toBe(
      `Withdraw 2 SOL from stake account ${s} to ${d}`,
    );
    expect(one(stake('delegateStake', [acc('stake', STAKE), acc('vote', DELEGATE)]))).toBe(`Delegate stake account ${s} to vote account ${d}`);
  });

  it('appends the first danger the summary does not express', () => {
    const delegation = { rule: 'delegation', severity: 'danger' as const, message: 'Lets a delegate spend ALL of the tokens in your token account.', instructionIndex: 0 };
    // The approve template expresses its own delegation danger.
    expect(one(approve(U64_MAX), { warnings: [delegation] })).toBe(`Let ${shortAddress(DELEGATE)} spend UNLIMITED USDC from Your USDC token account`);
    // A danger the summary doesn't express is appended, shortened.
    const cpi = { ...delegation, instructionIndex: undefined };
    const unknown: ExplainedInstruction = { ...base, index: 0, programId: OTHER };
    expect(one(unknown, { warnings: [{ rule: 'unknown-program', severity: 'warn', message: 'x' }, cpi] })).toBe(
      `Interact with ${shortAddress(OTHER)} -- lets a delegate spend ALL of the tokens in your token account`,
    );
    const long = { rule: 'x', severity: 'danger' as const, message: `${'a'.repeat(200)}.` };
    expect(one(unknown, { warnings: [long] })).toBe(`Interact with ${shortAddress(OTHER)} -- ${'a'.repeat(99)}\u2026`);
  });
});
