import type { RawAccount, TxMeta } from '@clef/rpc';
import type { Address } from '@solana/kit';
import { decodeTokenAccount } from './accounts';
import { NATIVE_MINTS } from './registry';
import type { BalanceChange } from './types';

type MintInfo = (mint: Address) => { symbol: string; decimals: number } | null;
type Holding = { owner: Address; mint: Address; amount: bigint; decimals: number | null };

const sol = (owner: Address, delta: bigint): BalanceChange => ({ owner, mint: 'SOL', symbol: 'SOL', decimals: 9, delta });

/**
 * Token and SOL deltas for one token account. Its lamports belong to its token owner: the rent of a new account
 * is still yours, and closing it to someone else loses it. For native (wSOL) accounts the lamports backing the
 * token amount are already counted as wSOL, so only the rest (rent) is counted as SOL. When the holder (or mint)
 * changes, the old holder loses everything and the new holder gains everything: a token account handed to
 * someone else is an outflow, not "no change".
 */
function tokenAccountChanges(
  before: Holding | null,
  after: Holding | null,
  preLamports: bigint,
  postLamports: bigint,
  mintInfo: MintInfo,
): BalanceChange[] {
  const token = (h: Holding, delta: bigint): BalanceChange =>
    ({ owner: h.owner, mint: h.mint, symbol: mintInfo(h.mint)?.symbol, decimals: h.decimals, delta });
  const rent = (h: Holding | null, lamports: bigint) => lamports - (h && NATIVE_MINTS.has(h.mint) ? h.amount : 0n);
  if (before && after && (before.owner !== after.owner || before.mint !== after.mint)) {
    return [
      token(before, -before.amount),
      sol(before.owner, -rent(before, preLamports)),
      token(after, after.amount),
      sol(after.owner, rent(after, postLamports)),
    ];
  }
  const h = (after ?? before)!;
  return [token(h, (after?.amount ?? 0n) - (before?.amount ?? 0n)), sol(h.owner, rent(after, postLamports) - rent(before, preLamports))];
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

/**
 * `ownerOf` resolves a token account's owner when the meta doesn't say; without it, such balances are
 * attributed to the token account itself.
 */
export function balanceChangesFromMeta(
  accounts: readonly Address[],
  meta: TxMeta,
  mintInfo: MintInfo,
  ownerOf?: (tokenAccount: Address) => Address | null,
): BalanceChange[] {
  const pre = new Map(meta.preTokenBalances.map((t) => [t.accountIndex, t]));
  const post = new Map(meta.postTokenBalances.map((t) => [t.accountIndex, t]));
  const lamports = (balances: bigint[], i: number) => balances[i] ?? 0n;
  const changes = accounts.flatMap((a, i) =>
    pre.has(i) || post.has(i) ? [] : [sol(a, lamports(meta.postBalances, i) - lamports(meta.preBalances, i))],
  );
  for (const index of new Set([...pre.keys(), ...post.keys()])) {
    const address = accounts[index]!;
    const holding = (t: TxMeta['preTokenBalances'][number] | undefined): Holding | null =>
      t ? { owner: t.owner ?? ownerOf?.(address) ?? address, mint: t.mint, amount: t.amount, decimals: t.decimals } : null;
    changes.push(
      ...tokenAccountChanges(
        holding(pre.get(index)),
        holding(post.get(index)),
        lamports(meta.preBalances, index),
        lamports(meta.postBalances, index),
        mintInfo,
      ),
    );
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
    return token && { ...token, decimals: mintInfo(token.mint)?.decimals ?? null };
  };
  pre.forEach((before, i) => {
    const after = post[i] ?? null;
    const address = (before ?? after)?.address;
    if (!address) return;
    const preLamports = before?.lamports ?? 0n;
    const postLamports = after?.lamports ?? 0n;
    const beforeToken = holding(before);
    const afterToken = holding(after);
    if (beforeToken || afterToken) {
      changes.push(...tokenAccountChanges(beforeToken, afterToken, preLamports, postLamports, mintInfo));
    } else {
      changes.push(sol(address, postLamports - preLamports));
    }
  });
  return aggregate(changes);
}
