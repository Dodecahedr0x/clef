import type { RawAccount } from '@clef/rpc';
import { SYSTEM_PROGRAM } from './registry';

/** SOL an account of `size` data bytes must hold to exist: (128 + size) bytes at 6,960 lamports per byte. */
export const rentExempt = (size: number) => (128n + BigInt(size)) * 6_960n;

/** SOL locked up in accounts a transaction opens: not spent, it goes back to whoever closes the account. */
export type Deposits = { count: number; lamports: bigint };

/**
 * Accounts that did not exist before and do after, with data or a program owner (a token account, a program's
 * state): the rent each holds. A wallet funded for the first time is a transfer, not a deposit. Wrapped SOL
 * counts only its rent; the rest is the user's SOL.
 */
export function depositsOf(states: { pre: readonly (RawAccount | null)[]; post: readonly (RawAccount | null)[] } | null | undefined): Deposits | null {
  if (!states) return null;
  let count = 0;
  let lamports = 0n;
  states.post.forEach((post, i) => {
    const pre = states.pre[i];
    if (!post || post.lamports === 0n || (pre && pre.lamports > 0n)) return;
    if (post.owner === SYSTEM_PROGRAM && post.data.length === 0) return;
    const rent = rentExempt(post.data.length);
    count++;
    lamports += post.lamports < rent ? post.lamports : rent;
  });
  return count ? { count, lamports } : null;
}

export const sumDeposits = (all: readonly (Deposits | null | undefined)[]): Deposits | null => {
  const some = all.filter((d): d is Deposits => !!d);
  return some.length ? { count: some.reduce((n, d) => n + d.count, 0), lamports: some.reduce((n, d) => n + d.lamports, 0n) } : null;
};
