import type { RawAccount, TxMeta } from '@clef/rpc';
import type { Address } from '@solana/kit';
import { decodeTokenAccount } from './accounts';
import type { BalanceChange } from './types';

type MintInfo = (mint: Address) => { symbol: string; decimals: number } | null;
type Holding = { owner: Address; mint: Address; amount: bigint; decimals: number };

const sol = (owner: Address, delta: bigint): BalanceChange => ({ owner, mint: 'SOL', symbol: 'SOL', decimals: 9, delta });

/**
 * Token deltas for one account. When the holder (or mint) changes, the old holder loses everything it held and
 * the new holder gains everything: a token account handed to someone else is an outflow, not "no change".
 */
function tokenChanges(before: Holding | null, after: Holding | null, mintInfo: MintInfo): BalanceChange[] {
  const change = (h: Holding, delta: bigint): BalanceChange =>
    ({ owner: h.owner, mint: h.mint, symbol: mintInfo(h.mint)?.symbol, decimals: h.decimals, delta });
  if (before && after && before.owner === after.owner && before.mint === after.mint) {
    return [change(after, after.amount - before.amount)];
  }
  return [...(before ? [change(before, -before.amount)] : []), ...(after ? [change(after, after.amount)] : [])];
}

/** Sums deltas per (owner, mint), drops zeros, keeps first-seen order. */
function aggregate(changes: BalanceChange[]): BalanceChange[] {
  const out = new Map<string, BalanceChange>();
  for (const c of changes) {
    const key = `${c.owner}:${c.mint}`;
    const prev = out.get(key);
    out.set(key, prev ? { ...prev, delta: prev.delta + c.delta } : c);
  }
  return [...out.values()].filter((c) => c.delta !== 0n);
}

export function balanceChangesFromMeta(accounts: readonly Address[], meta: TxMeta, mintInfo: MintInfo): BalanceChange[] {
  const changes = accounts.map((a, i) => sol(a, (meta.postBalances[i] ?? 0n) - (meta.preBalances[i] ?? 0n)));
  const pre = new Map(meta.preTokenBalances.map((t) => [t.accountIndex, t]));
  const post = new Map(meta.postTokenBalances.map((t) => [t.accountIndex, t]));
  for (const index of new Set([...pre.keys(), ...post.keys()])) {
    const holding = (t: TxMeta['preTokenBalances'][number] | undefined): Holding | null =>
      t ? { owner: t.owner ?? accounts[index]!, mint: t.mint, amount: t.amount, decimals: t.decimals } : null;
    changes.push(...tokenChanges(holding(pre.get(index)), holding(post.get(index)), mintInfo));
  }
  return aggregate(changes);
}

export function balanceChangesFromSimulation(
  pre: readonly (RawAccount | null)[],
  post: readonly (RawAccount | null)[],
  mintInfo: MintInfo,
): BalanceChange[] {
  const changes: BalanceChange[] = [];
  const holding = (account: RawAccount | null): Holding | null => {
    const token = decodeTokenAccount(account);
    return token && { ...token, decimals: mintInfo(token.mint)?.decimals ?? 0 };
  };
  pre.forEach((before, i) => {
    const after = post[i] ?? null;
    const address = (before ?? after)?.address;
    if (!address) return;
    const beforeToken = holding(before);
    const afterToken = holding(after);
    if (beforeToken || afterToken) {
      changes.push(...tokenChanges(beforeToken, afterToken, mintInfo));
      return; // rent lamports on token accounts are noise for the user
    }
    changes.push(sol(address, (after?.lamports ?? 0n) - (before?.lamports ?? 0n)));
  });
  return aggregate(changes);
}
