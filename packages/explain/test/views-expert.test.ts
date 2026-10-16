import { createBundledSource, IdlResolver } from '@clef/idl';
import { MemoryChainReader } from '@clef/rpc';
import { getTransferSolInstruction } from '@solana-program/system';
import { address, createNoopSigner, type Address } from '@solana/kit';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  explain, shortAddress, viewFor, viewForBatch, SYSTEM_PROGRAM, TOKEN_PROGRAM,
  type AccountDiff, type ExplainedBatch, type ExplainedTransaction,
} from '../src';
import { buildWire, ME, OTHER, USDC } from './helpers';

const ACCT = address('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
const POOL = address('Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE');
const SYS = SYSTEM_PROGRAM as Address;
const TOK = TOKEN_PROGRAM as Address;

const base = { mine: true, owner: { before: TOK, after: TOK }, lamports: { before: 2_039_280n, after: 2_039_280n }, raw: null } as const;
const DIFFS: Record<string, AccountDiff> = {
  system: {
    address: ME, title: 'You · Main', mine: true, lifecycle: 'modified', owner: { before: SYS, after: SYS },
    lamports: { before: 6_210_400_000n, after: 4_710_285_000n }, decoded: { by: 'system', type: 'System account', changed: [], context: [] }, raw: null,
  },
  token: {
    ...base, address: ACCT, title: 'Your USDC account', lifecycle: 'modified',
    decoded: {
      by: 'token', type: 'Token account',
      changed: [{ path: 'amount', before: '312_400_000', after: '524_800_000', note: '312.4 USDC → 524.8 USDC' }],
      context: [{ path: 'mint', before: USDC, after: USDC, note: 'USDC' }],
    },
  },
  created: {
    ...base, address: ACCT, title: 'Your wSOL account', lifecycle: 'created', owner: { before: null, after: TOK }, lamports: { before: 0n, after: 2_039_280n },
    decoded: { by: 'token', type: 'Token account', changed: [{ path: 'owner', before: null, after: ME, note: 'you' }], context: [] },
  },
  closed: {
    ...base, address: ACCT, title: 'Your wSOL account', lifecycle: 'closed', owner: { before: TOK, after: null }, lamports: { before: 2_039_280n, after: 0n },
    decoded: { by: 'token', type: 'Token account', changed: [{ path: 'amount', before: '0', after: null }], context: [] },
  },
  temp: {
    ...base, address: ACCT, title: 'Your wSOL account', lifecycle: 'closed', owner: { before: null, after: null }, lamports: { before: 0n, after: 0n }, lastChangedBy: 2,
    decoded: {
      by: 'token', type: 'Created & closed', changed: [],
      context: [{ path: 'created', before: null, after: 'tx 1 · rent 2_039_280' }, { path: 'closed', before: null, after: 'tx 3' }, { path: 'net', before: null, after: 'no account after the batch' }],
    },
  },
  idl: {
    ...base, address: POOL, title: 'Czfq…44zE', mine: false, lifecycle: 'modified', owner: { before: OTHER, after: OTHER }, lamports: { before: 5n, after: 5n },
    decoded: {
      by: 'idl', type: 'Whirlpool',
      changed: [{ path: 'sqrtPrice', before: '6_942_118', after: '6_941_870' }],
      context: ['liquidity', 'a', 'b', 'c'].map((p) => ({ path: p, before: '1', after: '1' })),
    },
  },
  undecoded: {
    ...base, address: POOL, title: 'Czfq…44zE', mine: false, lifecycle: 'modified', owner: { before: OTHER, after: OTHER }, lamports: { before: 5n, after: 5n },
    decoded: null, undecodedReason: 'no IDL for owner program 7xKX…gAsU',
    raw: { size: { before: 512, after: 512 }, changedBytes: 3, changes: [{ offset: 0xc1, before: '00 00', after: 'a4 3f' }, { offset: 0x1a8, before: '00', after: '12' }] },
  },
};

let ex: ExplainedTransaction;
beforeAll(async () => {
  const wire = buildWire([getTransferSolInstruction({ source: createNoopSigner(ME), destination: OTHER, amount: 1n })]);
  ex = await explain({ wire }, { reader: new MemoryChainReader(), idls: new IdlResolver([createBundledSource()]), me: [ME] });
});

const withDiffs = (diffs: AccountDiff[]): ExplainedTransaction => ({ ...ex, accountDiffs: diffs });
const lines = (d: AccountDiff) => viewFor(withDiffs([d]), 'expert').accountDiffs![0]!;

describe('expert view: account diffs', () => {
  it('system account: lamports lines with SOL notes', () => {
    const v = lines(DIFFS.system!);
    expect(v).toMatchObject({ address: ME, title: 'You · Main', type: 'System account', tag: 'modified' });
    expect(v.lines).toEqual([
      { sign: '-', key: 'lamports', value: '6_210_400_000', note: '6.2104 SOL' },
      { sign: '+', key: 'lamports', value: '4_710_285_000', note: '4.710285 SOL' },
    ]);
  });

  it('token account: context first, then before and after lines; addresses shortened', () => {
    expect(lines(DIFFS.token!).lines).toEqual([
      { sign: ' ', key: 'mint', value: shortAddress(USDC), note: 'USDC' },
      { sign: '-', key: 'amount', value: '312_400_000' },
      { sign: '+', key: 'amount', value: '524_800_000', note: '312.4 USDC → 524.8 USDC' },
    ]);
  });

  it('created, closed and temp accounts get their tags and types', () => {
    const created = lines(DIFFS.created!);
    expect(created).toMatchObject({ tag: 'new', type: 'New account' });
    expect(created.lines).toEqual([
      { sign: '+', key: 'owner', value: shortAddress(ME), note: 'you' },
      { sign: '+', key: 'lamports', value: '2_039_280', note: '0.00203928 SOL' },
    ]);
    const closed = lines(DIFFS.closed!);
    expect(closed).toMatchObject({ tag: 'closed', type: 'Closed' });
    expect(closed.lines.map((l) => l.sign)).toEqual(['-', '-']);
    const temp = lines(DIFFS.temp!);
    expect(temp).toMatchObject({ tag: 'temp', type: 'Created & closed', lastChangedBy: 2 });
    expect(temp.lines).toEqual([
      { sign: ' ', key: 'created', value: 'tx 1 · rent 2_039_280' },
      { sign: ' ', key: 'closed', value: 'tx 3' },
      { sign: ' ', key: 'net', value: 'no account after the batch' },
    ]);
  });

  it('IDL account: type marked IDL, at most 3 unchanged context lines', () => {
    const v = lines(DIFFS.idl!);
    expect(v.type).toBe('Whirlpool · IDL');
    expect(v.lines.filter((l) => l.sign === ' ')).toHaveLength(3);
    expect(v.lines[0]).toEqual({ sign: ' ', key: 'liquidity', value: '1', note: 'unchanged' });
  });

  it('undecoded account: byte runs with hex offsets and a summary', () => {
    const v = lines(DIFFS.undecoded!);
    expect(v.type).toBe('Undecoded');
    expect(v.lines).toEqual([]);
    expect(v.undecoded).toEqual({
      reason: 'no IDL for owner program 7xKX…gAsU',
      lines: [
        { sign: '-', offset: '0x00c1', bytes: '00 00' },
        { sign: '+', offset: '0x00c1', bytes: 'a4 3f' },
        { sign: '-', offset: '0x01a8', bytes: '00' },
        { sign: '+', offset: '0x01a8', bytes: '12' },
      ],
      summary: '3 bytes changed of 512',
    });
  });

  it('null diffs stay null', () => {
    expect(viewFor({ ...ex, accountDiffs: null }, 'expert').accountDiffs).toBeNull();
  });
});

describe('expert view: logs, compute and external relations', () => {
  it('formats logs, compute units and copies external relations', () => {
    const external = [{ kind: 'program-owner' as const, from: ME, to: SYS, label: 'program', status: 'verified' as const, external: true }];
    const v = viewFor({
      ...ex,
      computeUnits: 16_101n,
      externalRelations: external,
      logs: [
        { depth: 0, kind: 'invoke', text: 'Program 1111 invoke [1]', programId: SYS, programName: 'System Program' },
        { depth: 1, kind: 'consumed', text: 'Program 1111 consumed 12906 of 199850 compute units', programId: SYS, computeUnits: { consumed: 12906, budget: 199850 } },
      ],
    }, 'expert');
    expect(v.computeUnits).toBe('16,101 CU');
    expect(v.logs).toEqual([
      { depth: 0, kind: 'invoke', text: 'Program 1111 invoke [1]', program: 'System Program' },
      { depth: 1, kind: 'consumed', text: 'Program 1111 consumed 12906 of 199850 compute units', computeUnits: '12,906 CU' },
    ]);
    expect(v.externalRelations).toEqual(external);
    expect(v.externalRelations[0]).not.toBe(external[0]);
  });

  it('unknown logs and compute stay null', () => {
    const v = viewFor({ ...ex, logs: null, computeUnits: null }, 'expert');
    expect(v).toMatchObject({ logs: null, computeUnits: null });
  });
});

describe('viewForBatch', () => {
  const batch = (): ExplainedBatch => ({
    mode: 'sequential',
    steps: [
      { index: 0, status: 'simulated', explained: { ...ex, summary: 'Wrap 1.5 SOL into your wrapped SOL account for the swap' } },
      { index: 1, status: 'failed', explained: null },
    ],
    combined: {
      balanceChanges: [{ owner: ME, mint: 'SOL', symbol: 'SOL', decimals: 9, delta: -1_500_000_000n }, { owner: OTHER, mint: 'SOL', symbol: 'SOL', decimals: 9, delta: 1n }],
      accountDiffs: [DIFFS.temp!],
      warnings: [{ rule: 'x', severity: 'warn', message: 'm' }],
      summary: '2 transactions',
      fee: 10_000n,
      computeUnits: 201_429n,
      incomplete: true,
    },
    dependentSteps: [],
    issues: [],
  });

  it.each(['basic', 'intermediate', 'expert'] as const)('%s: combined view and per-step views at that level', (level) => {
    const v = viewForBatch(batch(), level);
    expect(v).toMatchObject({ level, mode: 'sequential', dependentSteps: [] });
    expect(v.combined).toMatchObject({ summary: '2 transactions', fee: '0.00001 SOL', computeUnits: '201,429 CU', incomplete: true, warnings: [{ rule: 'x' }] });
    expect(v.combined.accountDiffs![0]).toMatchObject({ tag: 'temp', lastChangedBy: 2 });
    expect(v.combined.balanceChanges).toEqual(
      level === 'expert'
        ? [{ owner: ME, asset: 'SOL', amount: '-1.5' }, { owner: OTHER, asset: 'SOL', amount: '+0.000000001' }]
        : [{ owner: ME, asset: 'SOL', amount: '-1.5' }],
    );
    expect(v.steps[0]).toMatchObject({ index: 0, status: 'simulated', title: 'Wrap 1.5 SOL into your wrapped SOL acco…' });
    expect(v.steps[0]!.title.length).toBeLessThanOrEqual(40);
    expect(v.steps[0]!.view!.level).toBe(level);
    expect(v.steps[1]).toEqual({ index: 1, status: 'failed', title: 'Transaction 2', view: null });
  });

  it('copies: editing the view never changes the batch', () => {
    const b = batch();
    const v = viewForBatch(b, 'expert');
    v.combined.warnings[0]!.message = 'changed';
    v.dependentSteps.push(9);
    expect(b.combined.warnings[0]!.message).toBe('m');
    expect(b.dependentSteps).toEqual([]);
  });
});
