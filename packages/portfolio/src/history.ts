import type { Address } from '@solana/kit';
import type { ChainReader } from '@clef/rpc';
import {
  explain,
  formatUnits,
  PLUMBING_PROGRAMS,
  PROGRAM_NAMES,
  shortAddress,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAMS,
  type BalanceChange,
  type ExplainContext,
  type ExplainedTransaction,
} from '@clef/explain';
import type { PortfolioReader, SignatureInfo } from './deps';

export type HistoryItem = {
  signature: string;
  slot: bigint;
  blockTime: number | null;
  status: 'success' | 'failed';
  kind: 'send' | 'receive' | 'swap' | 'other';
  title: string;
  subtitle: string;
  deltas: { symbol: string; amount: string; direction: 'in' | 'out' }[];
  fee: string;
};

type HistoryDeps = { reader: PortfolioReader; chain: ChainReader; explainCtx: ExplainContext };

const DEX_PROGRAMS: ReadonlySet<string> = new Set([
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
]);

const SUMMARY_MAX = 48;

export async function loadHistory(
  deps: HistoryDeps,
  owner: Address,
  opts: { before?: string; limit: number },
): Promise<{ items: HistoryItem[]; next?: string }> {
  const sigs = await deps.reader.getSignatures(owner, opts);
  const items = await Promise.all(sigs.map((sig) => historyItem(deps, owner, sig)));
  const last = sigs[sigs.length - 1];
  return last && sigs.length === opts.limit ? { items, next: last.signature } : { items };
}

async function historyItem(deps: HistoryDeps, owner: Address, sig: SignatureInfo): Promise<HistoryItem> {
  const base = { signature: sig.signature, slot: sig.slot, blockTime: sig.blockTime };
  const unavailable: HistoryItem = {
    ...base, status: sig.err != null ? 'failed' : 'success', kind: 'other', title: 'Transaction', subtitle: 'details unavailable', deltas: [], fee: '',
  };
  let ex: ExplainedTransaction;
  let fetched;
  try {
    fetched = await deps.chain.getTransaction(sig.signature);
    if (!fetched) return unavailable;
    const me = [...new Set([owner, ...deps.explainCtx.me])];
    ex = await explain({ wire: fetched.wire, meta: fetched.meta }, { ...deps.explainCtx, me });
  } catch {
    return unavailable;
  }
  const meta = fetched.meta;
  const fee = meta ? formatUnits(meta.fee, 9) : '';
  const failed = sig.err != null || (meta?.err ?? null) !== null;

  if (failed) {
    const kind = failedKind(ex, owner);
    const title = kind === 'swap' ? 'Swap failed' : kind === 'send' ? 'Send failed' : 'Transaction failed';
    return { ...base, status: 'failed', kind, title, subtitle: 'nothing moved', deltas: [], fee };
  }

  const all = ex.balanceChanges ?? [];
  const mine = ownerChanges(all, owner, ex.tx.feePayer === owner ? (meta?.fee ?? ex.fee ?? 0n) : 0n);
  const outs = mine.filter((c) => c.delta < 0n);
  const ins = mine.filter((c) => c.delta > 0n);
  const kind: HistoryItem['kind'] = outs.length && ins.length ? 'swap' : outs.length ? 'send' : ins.length ? 'receive' : 'other';
  const symbolOf = (c: BalanceChange) => (c.mint === 'SOL' ? 'SOL' : c.symbol ?? shortAddress(c.mint));
  const counterparty = (c: BalanceChange | undefined) => {
    const cp = c && all.find((o) => o.mint === c.mint && o.owner !== owner && (o.delta > 0n) !== (c.delta > 0n) && o.delta !== 0n)?.owner;
    if (!cp) return 'unknown';
    return deps.explainCtx.addressBook?.[cp] ?? shortAddress(cp);
  };
  let title: string;
  if (kind === 'swap') title = `Swap ${symbolOf(outs[0]!)} → ${symbolOf(ins[0]!)}`;
  else if (kind === 'send') title = `Sent to ${counterparty(outs[0])}`;
  else if (kind === 'receive') title = `Received from ${counterparty(ins[0])}`;
  else title = ex.summary.length > SUMMARY_MAX ? `${ex.summary.slice(0, SUMMARY_MAX)}…` : ex.summary;

  const subtitle = [
    ...new Set(ex.instructions.filter((ix) => !PLUMBING_PROGRAMS.has(ix.programId)).map((ix) => PROGRAM_NAMES[ix.programId] ?? shortAddress(ix.programId))),
  ].join(' · ');

  return {
    ...base, status: 'success', kind, title, subtitle, fee,
    deltas: mine.map((c) => ({
      symbol: symbolOf(c),
      amount: formatUnits(c.delta < 0n ? -c.delta : c.delta, c.decimals),
      direction: c.delta < 0n ? 'out' : 'in',
    })),
  };
}

/** The owner's changes, with the network fee added back to its SOL delta when it paid it. */
function ownerChanges(all: readonly BalanceChange[], owner: Address, feeBack: bigint): BalanceChange[] {
  const mine = all.filter((c) => c.owner === owner).map((c) => ({ ...c }));
  if (feeBack) {
    const sol = mine.find((c) => c.mint === 'SOL');
    if (sol) sol.delta += feeBack;
    else mine.unshift({ owner, mint: 'SOL', symbol: 'SOL', decimals: 9, delta: feeBack });
  }
  return mine.filter((c) => c.delta !== 0n);
}

function failedKind(ex: ExplainedTransaction, owner: Address): HistoryItem['kind'] {
  if (ex.instructions.some((ix) => DEX_PROGRAMS.has(ix.programId))) return 'swap';
  const send = ex.instructions.some(
    (ix) =>
      (ix.programId === SYSTEM_PROGRAM || TOKEN_PROGRAMS.has(ix.programId)) &&
      /^transfer/i.test(ix.name ?? '') &&
      ix.accounts.some((a) => a.address === owner && a.signer),
  );
  return send ? 'send' : 'other';
}
