import { UnsupportedMethodError, type RawAccount, type TxMeta } from '@clef/rpc';
import type { Address } from '@solana/kit';
import { decodeTransaction } from './decode';
import { computeAccountDiffs, groupDigits } from './diffs';
import { explainWith, type ExplainRun, type PresetSimulation } from './explain';
import type { Labeler } from './labels';
import { errorDetail } from './seeds';
import type { AccountDiff, BalanceChange, DecodedTransaction, ExplainContext, ExplainedTransaction, Issue, Warning } from './types';

export type BatchStep = { index: number; explained: ExplainedTransaction | null; status: 'simulated' | 'independent' | 'dependent' | 'not-simulated' | 'failed' };
export type ExplainedBatch = {
  mode: 'sequential' | 'independent';
  steps: BatchStep[];
  combined: {
    balanceChanges: BalanceChange[] | null;
    accountDiffs: AccountDiff[] | null;
    warnings: Warning[];
    summary: string;
    fee: bigint | null;
    computeUnits: bigint | null;
    incomplete: boolean;
  };
  /** Independent mode: steps whose keys overlap writable keys of earlier steps (fee payers excluded). */
  dependentSteps: number[];
  issues: Issue[];
};

type Step = BatchStep & { run: ExplainRun | null };

const writableOf = (tx: DecodedTransaction) => tx.accounts.filter((a) => a.writable).map((a) => a.address);

async function runStep(index: number, wire: Uint8Array, tx: DecodedTransaction, ctx: ExplainContext, status: BatchStep['status'], preset?: PresetSimulation): Promise<Step> {
  const run = await explainWith({ wire, tx }, ctx, preset);
  return { index, explained: run.explained, status, run };
}

/** Steps in the request whose keys overlap what earlier steps write: simulated alone, they start from the wrong state. */
function dependents(txs: readonly (DecodedTransaction | null)[]): number[] {
  const written = new Set<string>();
  const out: number[] = [];
  txs.forEach((tx, i) => {
    if (!tx) return;
    if (tx.accounts.some((a) => a.address !== tx.feePayer && written.has(a.address))) out.push(i);
    for (const a of writableOf(tx)) if (a !== tx.feePayer) written.add(a);
  });
  return out;
}

function sumBalances(lists: readonly (BalanceChange[] | null)[]): BalanceChange[] | null {
  if (lists.some((l) => l === null)) return null;
  const byKey = new Map<string, BalanceChange>();
  for (const c of lists.flat() as BalanceChange[]) {
    const key = `${c.owner}:${c.mint}`;
    const prev = byKey.get(key);
    byKey.set(key, prev ? { ...prev, delta: prev.delta + c.delta } : { ...c });
  }
  return [...byKey.values()].filter((c) => c.delta !== 0n);
}

type Net = {
  pre: RawAccount | null;
  post: RawAccount | null;
  delta: bigint;
  labeler: Labeler;
  lastChangedBy?: number;
  created?: { index: number; diff: AccountDiff };
  closed?: number;
};

/**
 * Net per-account diffs over the included steps: first pre-state against last post-state (sequential), or the
 * pre-state plus every step's lamport delta (independent: each step ran alone from the same state).
 */
async function netDiffs(steps: readonly Step[], mode: ExplainedBatch['mode'], ctx: ExplainContext): Promise<AccountDiff[] | null> {
  const nets = new Map<Address, Net>();
  for (const step of steps) {
    const run = step.run!;
    if (!run.states) return null;
    const diffs = new Map((run.explained.accountDiffs ?? []).map((d) => [d.address, d]));
    run.writable.forEach((address, j) => {
      const pre = run.states!.pre[j] ?? null;
      const post = run.states!.post[j] ?? null;
      const net = nets.get(address) ?? { pre, post, delta: 0n, labeler: run.labeler };
      net.post = post;
      net.delta += (post?.lamports ?? 0n) - (pre?.lamports ?? 0n);
      net.labeler = run.labeler;
      const diff = diffs.get(address);
      if (diff) {
        net.lastChangedBy = step.index;
        if (diff.lifecycle === 'created' && !net.created) net.created = { index: step.index, diff };
        if (diff.lifecycle === 'closed') net.closed = step.index;
      }
      nets.set(address, net);
    });
  }
  const out: AccountDiff[] = [];
  for (const [address, net] of nets) {
    const post = mode === 'independent' && net.post ? { ...net.post, lamports: (net.pre?.lamports ?? 0n) + net.delta } : net.post;
    const [diff] = await computeAccountDiffs([{ address, pre: net.pre, post }], {
      idls: ctx.idls, labeler: net.labeler, me: ctx.me, ...(ctx.addressBook && { addressBook: ctx.addressBook }),
    });
    if (diff) {
      out.push(net.lastChangedBy === undefined ? diff : { ...diff, lastChangedBy: net.lastChangedBy });
    } else if (net.created && net.closed !== undefined && net.closed > net.created.index) {
      const { diff: created, index } = net.created;
      out.push({
        address,
        title: created.title,
        mine: created.mine,
        lifecycle: 'closed',
        owner: { before: null, after: null },
        lamports: { before: 0n, after: 0n },
        decoded: {
          by: created.decoded?.by ?? 'system',
          type: 'Created & closed',
          changed: [],
          context: [
            { path: 'created', before: null, after: `tx ${index + 1} · rent ${groupDigits(created.lamports.after)}` },
            { path: 'closed', before: null, after: `tx ${net.closed + 1}` },
            { path: 'net', before: null, after: 'no account after the batch' },
          ],
        },
        raw: null,
        lastChangedBy: net.closed,
      });
    }
  }
  return out;
}

async function combine(all: readonly Step[], included: readonly Step[], mode: ExplainedBatch['mode'], incomplete: boolean, ctx: ExplainContext, issues: Issue[]): Promise<ExplainedBatch['combined']> {
  const explained = included.map((s) => s.explained!);
  // Warnings from every step, whether or not it made it into the combined view: fail closed.
  const seen = new Set<string>();
  const warnings: Warning[] = [];
  for (const step of all) {
    for (const w of step.explained?.warnings ?? []) {
      const key = `${w.rule}\u0000${w.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        warnings.push({ ...w });
      }
    }
  }
  // A step Clef could not decode, or whose effects were never simulated, is unknown: never let it pass quietly.
  const unexplained = all.filter((s) => s.explained === null || s.status === 'not-simulated').map((s) => s.index + 1);
  if (unexplained.length) {
    const which = unexplained.length === 1 ? `transaction ${unexplained[0]}` : `transactions ${unexplained.join(', ')}`;
    warnings.unshift({ rule: 'unexplained-step', severity: 'danger', message: `Clef could not explain ${which} in this request; its effects are unknown.` });
  }
  const fees = explained.map((e) => e.fee);
  const units = explained.map((e) => e.computeUnits).filter((u): u is bigint => u !== null);
  // Sequential: a step that didn't run leaves every later state unknown. Independent: the rest still adds up.
  const blank = incomplete && mode === 'sequential';
  let accountDiffs: AccountDiff[] | null = null;
  if (!blank && included.length) {
    try {
      accountDiffs = await netDiffs(included, mode, ctx);
    } catch (e) {
      issues.push({ stage: 'simulate', message: `Could not combine account diffs: ${errorDetail(e)}` });
    }
  }
  const failed = all.find((s) => s.status === 'failed');
  const parts = all.map((s) => (s.explained ? s.explained.summary : 'could not be decoded'));
  let summary = all.length === 1 ? parts[0]! : `${all.length} transactions: ${parts.map((p, i) => `${i + 1}. ${p}`).join('; ')}`;
  if (failed) summary = `Transaction ${failed.index + 1} failed -- ${summary}`;
  return {
    balanceChanges: blank || !included.length ? null : sumBalances(explained.map((e) => e.balanceChanges)),
    accountDiffs,
    warnings,
    summary,
    fee: !explained.length || fees.some((f) => f === null) ? null : (fees as bigint[]).reduce((a, b) => a + b, 0n),
    computeUnits: units.length ? units.reduce((a, b) => a + b, 0n) : null,
    incomplete,
  };
}

/**
 * Explains a multi-transaction request. Sequential (one state, in order) through `reader.simulateSequence` when
 * it is available; otherwise each transaction is simulated alone and those touching what an earlier one writes
 * are marked dependent and left out of the combined view.
 */
export async function explainBatch(inputs: { wire: Uint8Array }[], ctx: ExplainContext): Promise<ExplainedBatch> {
  const issues: Issue[] = [];
  const txs = await Promise.all(
    inputs.map(async ({ wire }, i) => {
      try {
        return await decodeTransaction(wire, ctx.reader);
      } catch (e) {
        issues.push({ stage: 'decode', message: `Transaction ${i + 1}: ${errorDetail(e)}` });
        return null;
      }
    }),
  );

  if (ctx.reader.simulateSequence && txs.every((t) => t !== null)) {
    const decoded = txs as DecodedTransaction[];
    let sequence;
    try {
      sequence = await ctx.reader.simulateSequence(inputs.map((i) => i.wire), decoded.map(writableOf));
    } catch (e) {
      if (!(e instanceof UnsupportedMethodError)) {
        issues.push({ stage: 'simulate', message: `Sequential simulation unavailable (${errorDetail(e)}); each transaction simulated alone` });
      }
    }
    if (sequence) {
      const { results, failedIndex } = sequence;
      const steps = await Promise.all(
        decoded.map((tx, i) => {
          const wire = inputs[i]!.wire;
          const result = results[i] ?? null;
          if (failedIndex !== null && i > failedIndex) {
            return runStep(i, wire, tx, ctx, 'not-simulated', { failed: 'Not simulated: an earlier transaction in the batch failed' });
          }
          if (!result) return runStep(i, wire, tx, ctx, 'failed', { failed: 'Simulation returned no result for this transaction' });
          return runStep(i, wire, tx, ctx, i === failedIndex ? 'failed' : 'simulated', { pre: result.pre, result });
        }),
      );
      const included = steps.filter((s) => s.status === 'simulated' && s.run?.states);
      const combined = await combine(steps, included, 'sequential', included.length !== steps.length, ctx, issues);
      return { mode: 'sequential', steps: steps.map(strip), combined, dependentSteps: [], issues };
    }
  }

  const dependentSteps = dependents(txs);
  const steps = await Promise.all(
    txs.map(async (tx, i): Promise<Step> => {
      if (!tx) return { index: i, explained: null, status: 'failed', run: null };
      if (dependentSteps.includes(i)) return runStep(i, inputs[i]!.wire, tx, ctx, 'dependent');
      const step = await runStep(i, inputs[i]!.wire, tx, ctx, 'independent');
      // Nothing earlier in the request feeds this step: a failed simulation alone is a failure, as in sequential mode.
      return step.run?.states ? step : { ...step, status: 'failed' };
    }),
  );
  const included = steps.filter((s) => s.status === 'independent');
  const incomplete = included.length !== steps.length || included.some((s) => !s.run?.states);
  const combined = await combine(steps, included.filter((s) => s.run?.states), 'independent', incomplete, ctx, issues);
  return { mode: 'independent', steps: steps.map(strip), combined, dependentSteps, issues };
}

const strip = ({ run: _run, ...step }: Step): BatchStep => step;

/**
 * A transaction already on chain, as a one-step batch so the approval views can show it. Its effects come from
 * the recorded meta (balances, logs, fee), not a simulation; account data is not recorded, so there are no diffs.
 */
export async function explainLanded(input: { wire: Uint8Array; meta: TxMeta }, ctx: ExplainContext): Promise<ExplainedBatch> {
  const issues: Issue[] = [];
  const run = await explainWith(input, ctx);
  const step: Step = { index: 0, explained: run.explained, status: input.meta.err ? 'failed' : 'simulated', run };
  const combined = await combine([step], [step], 'sequential', false, ctx, issues);
  return { mode: 'sequential', steps: [strip(step)], combined, dependentSteps: [], issues };
}
