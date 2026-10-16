import { IdlResolver } from '@clef/idl';
import { MemoryChainReader, UnsupportedMethodError, type RawAccount, type SequenceResult } from '@clef/rpc';
import { getTransferSolInstruction } from '@solana-program/system';
import { address, createNoopSigner, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { SYSTEM_PROGRAM, TOKEN_PROGRAM, explainBatch, type ExplainContext } from '../src';
import { ME, OTHER, USDC, buildWire, simulateWith, tokenAccountData } from './helpers';

const TEMP = address('4fYNw3dojWmQ4dXtSGE9epjRGy9pFSx62YypT7avPYvA');
const USDC_ACCT = address('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
const POOL = address('Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE');

const sys = (a: Address, lamports: bigint): RawAccount => ({ address: a, owner: SYSTEM_PROGRAM as Address, lamports, data: new Uint8Array(), executable: false });
const tok = (a: Address, amount: bigint, mint: Address = USDC, lamports = 2_039_280n): RawAccount => ({
  address: a, owner: TOKEN_PROGRAM as Address, lamports, data: tokenAccountData(ME, mint, amount), executable: false,
});

const transfer = (to: Address, amount = 1n) => getTransferSolInstruction({ source: createNoopSigner(ME), destination: to, amount });

/** Step i applies `changes[i]` to the running state; `failAt` makes that step fail (later results null). */
function sequenceReader(changes: Record<string, RawAccount | null>[], opts: { failAt?: number } = {}): MemoryChainReader {
  const reader = new MemoryChainReader();
  reader.setAccount({ ...sys(ME, 10_000_000_000n) });
  reader.setAccount({ ...tok(USDC_ACCT, 100n) });
  reader.setAccount({ ...sys(POOL, 5n) });
  Object.assign(reader, {
    async simulateSequence(_wires: readonly Uint8Array[], addresses: readonly (readonly Address[])[]): Promise<SequenceResult> {
      const state = new Map<string, RawAccount | null>([...reader.accounts].map(([k, v]) => [k, structuredClone(v)]));
      const results: SequenceResult['results'] = [];
      for (let i = 0; i < addresses.length; i++) {
        const keys = addresses[i]!;
        if (opts.failAt !== undefined && i > opts.failAt) {
          results.push(null);
          continue;
        }
        const pre = keys.map((k) => state.get(k) ?? null);
        if (i === opts.failAt) {
          results.push({ err: { InstructionError: [0, 'Custom'] }, logs: ['Program 11111111111111111111111111111111 invoke [1]', 'Program 11111111111111111111111111111111 failed: custom'], unitsConsumed: 150n, postAccounts: pre, pre });
          continue;
        }
        for (const [k, v] of Object.entries(changes[i] ?? {})) state.set(k, v);
        const fee = 5000n;
        const payer = state.get(ME)!;
        state.set(ME, { ...payer, lamports: payer.lamports - fee });
        results.push({ err: null, logs: ['Program 11111111111111111111111111111111 invoke [1]', 'Program 11111111111111111111111111111111 success'], unitsConsumed: 1000n, postAccounts: keys.map((k) => state.get(k) ?? null), pre });
      }
      return { results, failedIndex: opts.failAt ?? null };
    },
  });
  return reader;
}

const ctxFor = (reader: MemoryChainReader): ExplainContext => ({ reader, idls: new IdlResolver([]), me: [ME], addressBook: { [ME]: 'Main' } });

// 1: create TEMP (wrap), 2: swap (TEMP drained, USDC_ACCT up, POOL changes), 3: close TEMP (rent back).
const wires = [buildWire([transfer(TEMP)]), buildWire([transfer(TEMP), transfer(USDC_ACCT), transfer(POOL)]), buildWire([transfer(TEMP)])];
const steps = (): Record<string, RawAccount | null>[] => [
  { [TEMP]: tok(TEMP, 1_500_000_000n, address('So11111111111111111111111111111111111111112')), [ME]: sys(ME, 10_000_000_000n - 1_502_039_280n) },
  { [TEMP]: tok(TEMP, 0n, address('So11111111111111111111111111111111111111112')), [USDC_ACCT]: tok(USDC_ACCT, 212_400_000n), [POOL]: sys(POOL, 6n) },
  { [TEMP]: null, [ME]: sys(ME, 10_000_000_000n - 1_502_039_280n - 10_000n + 2_039_280n) },
];

describe('explainBatch sequential', () => {
  it('explains each step on accumulated state and nets the batch', async () => {
    const batch = await explainBatch(wires.map((wire) => ({ wire })), ctxFor(sequenceReader(steps())));
    expect(batch.mode).toBe('sequential');
    expect(batch.steps.map((s) => s.status)).toEqual(['simulated', 'simulated', 'simulated']);
    expect(batch.dependentSteps).toEqual([]);

    const step1 = batch.steps[0]!.explained!;
    expect(step1.accountDiffs!.find((d) => d.address === TEMP)!.lifecycle).toBe('created');
    expect(step1.logs![0]).toMatchObject({ kind: 'invoke', depth: 0, programName: 'System Program' });
    expect(step1.computeUnits).toBe(1000n);
    const step3 = batch.steps[2]!.explained!;
    expect(step3.accountDiffs!.find((d) => d.address === TEMP)!.lifecycle).toBe('closed');
    // Step 2 starts from step 1's state: TEMP already holds 1.5 wSOL.
    expect(batch.steps[1]!.explained!.accountDiffs!.find((d) => d.address === TEMP)!.decoded!.changed[0]).toMatchObject({ path: 'amount', before: '1_500_000_000', after: '0' });

    const { combined } = batch;
    expect(combined.incomplete).toBe(false);
    expect(combined.computeUnits).toBe(3000n);
    const usdc = combined.accountDiffs!.find((d) => d.address === USDC_ACCT)!;
    expect(usdc).toMatchObject({ lifecycle: 'modified', lastChangedBy: 1, title: 'Your USDC account' });
    expect(usdc.decoded!.changed).toEqual([{ path: 'amount', before: '100', after: '212_400_000', note: '0.0001 USDC → 212.4 USDC' }]);
    const me = combined.accountDiffs!.find((d) => d.address === ME)!;
    expect(me.lamports).toEqual({ before: 10_000_000_000n, after: 10_000_000_000n - 1_500_015_000n });
    expect(me.lastChangedBy).toBe(2);
    const temp = combined.accountDiffs!.find((d) => d.address === TEMP)!;
    expect(temp).toMatchObject({ lifecycle: 'closed', owner: { before: null, after: null }, lastChangedBy: 2 });
    expect(temp.decoded!.context.map((c) => [c.path, c.after])).toEqual([
      ['created', 'tx 1 · rent 2_039_280'],
      ['closed', 'tx 3'],
      ['net', 'no account after the batch'],
    ]);
    expect(combined.balanceChanges).toContainEqual(expect.objectContaining({ owner: ME, mint: USDC, delta: 212_399_900n }));
    expect(combined.balanceChanges).toContainEqual(expect.objectContaining({ owner: ME, mint: 'SOL', delta: -1_500_015_000n }));
  });

  it('marks a failed middle step and leaves later steps not simulated', async () => {
    const batch = await explainBatch(wires.map((wire) => ({ wire })), ctxFor(sequenceReader(steps(), { failAt: 1 })));
    expect(batch.mode).toBe('sequential');
    expect(batch.steps.map((s) => s.status)).toEqual(['simulated', 'failed', 'not-simulated']);
    expect(batch.steps[1]!.explained!.issues.some((i) => i.stage === 'simulate' && i.message.startsWith('Simulation failed'))).toBe(true);
    expect(batch.steps[1]!.explained!.logs!.at(-1)).toMatchObject({ kind: 'failed' });
    expect(batch.steps[2]!.explained!.balanceChanges).toBeNull();
    expect(batch.combined).toMatchObject({ incomplete: true, balanceChanges: null, accountDiffs: null });
    expect(batch.combined.summary).toMatch(/failed/i);
    expect(batch.combined.warnings).toContainEqual(expect.objectContaining({ rule: 'unexplained-step', severity: 'danger' }));
    expect(batch.combined.warnings.find((w) => w.rule === 'unexplained-step')!.message).toMatch(/transaction 3/);
  });
});

describe('explainBatch independent fallback', () => {
  const plain = () => {
    const reader = new MemoryChainReader();
    reader.setAccount(sys(ME, 10_000_000_000n));
    simulateWith(reader, {});
    return reader;
  };

  it('simulates each step alone when the reader has no sequence support and marks dependent steps', async () => {
    const reader = plain();
    Object.assign(reader, { simulateSequence: undefined });
    const batch = await explainBatch([{ wire: buildWire([transfer(TEMP)]) }, { wire: buildWire([transfer(POOL)]) }, { wire: buildWire([transfer(TEMP)]) }], ctxFor(reader));
    expect(batch.mode).toBe('independent');
    // Every step writes the fee payer: that alone is no dependency. Step 3 touches TEMP, written by step 1.
    expect(batch.dependentSteps).toEqual([2]);
    expect(batch.steps.map((s) => s.status)).toEqual(['independent', 'independent', 'dependent']);
    expect(batch.combined.incomplete).toBe(true);
    // Combined covers the independent steps only: each simulated alone from the same state, their deltas add.
    const me = batch.combined.accountDiffs!.find((d) => d.address === ME)!;
    expect(me.lamports).toEqual({ before: 10_000_000_000n, after: 10_000_000_000n - 10_000n });
  });

  it('falls back when simulateSequence throws UnsupportedMethodError', async () => {
    const reader = plain();
    Object.assign(reader, { simulateSequence: async () => { throw new UnsupportedMethodError('simulateBundle'); } });
    const batch = await explainBatch([{ wire: buildWire([transfer(TEMP)]) }, { wire: buildWire([transfer(OTHER)]) }], ctxFor(reader));
    expect(batch.mode).toBe('independent');
    expect(batch.dependentSteps).toEqual([]);
    expect(batch.combined.incomplete).toBe(false);
    expect(batch.issues).toEqual([]);
  });

  it('records other sequence errors as an issue and falls back', async () => {
    const reader = plain();
    Object.assign(reader, { simulateSequence: async () => { throw new Error('boom'); } });
    const batch = await explainBatch([{ wire: buildWire([transfer(TEMP)]) }], ctxFor(reader));
    expect(batch.mode).toBe('independent');
    expect(batch.issues[0]).toMatchObject({ stage: 'simulate' });
  });

  it('fails a step whose wire does not decode', async () => {
    const batch = await explainBatch([{ wire: new Uint8Array([1, 2, 3]) }, { wire: buildWire([transfer(TEMP)]) }], ctxFor(plain()));
    expect(batch.steps[0]).toMatchObject({ status: 'failed', explained: null });
    expect(batch.combined.incomplete).toBe(true);
    expect(batch.issues.some((i) => i.stage === 'decode')).toBe(true);
    expect(batch.combined.warnings).toContainEqual(expect.objectContaining({ rule: 'unexplained-step', severity: 'danger', message: expect.stringMatching(/transaction 1/) }));
  });
});
