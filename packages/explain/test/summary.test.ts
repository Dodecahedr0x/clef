import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import {
  formatUnits,
  programDisplay,
  shortAddress,
  summarize,
  COMPUTE_BUDGET_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
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
    expect(summarize({ instructions: [transferSol()], balanceChanges, me: [ME], warnings: sweep })).toBe('Send 1.5 SOL');
    const highFee: Warning[] = [{ rule: 'high-fee', severity: 'warn', message: 'm' }];
    expect(summarize({ instructions: [transferSol()], balanceChanges, me: [ME], warnings: highFee })).not.toMatch(/Alice/);
    const unexplained: Warning[] = [{ rule: 'unexplained-outflow', severity: 'danger', message: 'm' }];
    expect(summarize({ instructions: [transferSol()], balanceChanges: null, me: [ME], warnings: unexplained })).toBe(
      'Interact with System Program (balance changes unknown)',
    );
  });
});
