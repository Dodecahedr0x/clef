import type { RawAccount } from '@clef/rpc';
import type { Address } from '@solana/kit';
import { decodeTokenAccount } from './accounts';

export type StateChange = {
  address: Address;
  kind: 'program-owner' | 'token-owner' | 'token-delegate' | 'token-close-authority';
  before: Address | null;
  after: Address | null;
  /** token-delegate: the delegated amount after the transaction. */
  amount?: bigint;
  /** Token kinds: the token account's owner before the transaction (after it, for a new account). */
  holder?: Address;
  /** Token kinds: the token account's balance before the transaction (after it, for a new account). */
  balance?: bigint;
};

/**
 * Authority-relevant differences between pre- and post-transaction account states (e.g. from simulation),
 * whichever instruction (top-level or CPI) caused them. Accounts are matched by address. A token account that
 * is new (or wasn't one before) is compared against an empty baseline: a drainer can create an account for you,
 * give itself authority over it, and move your funds in, all with zero net balance change.
 */
export function computeStateChanges(
  pre: readonly (RawAccount | null | undefined)[],
  post: readonly (RawAccount | null)[],
): StateChange[] {
  const preByAddress = new Map(pre.filter((a): a is RawAccount => !!a).map((a) => [a.address, a]));
  const changes: StateChange[] = [];
  for (const after of post) {
    if (!after) continue;
    const address = after.address;
    const before = preByAddress.get(address);
    if (before && before.owner !== after.owner) {
      changes.push({ address, kind: 'program-owner', before: before.owner, after: after.owner });
    }

    const a = decodeTokenAccount(after);
    if (!a) continue;
    const b = decodeTokenAccount(before);
    const base = b ?? { owner: a.owner, amount: a.amount, delegate: null, delegatedAmount: 0n, closeAuthority: null };
    const common = { address, holder: base.owner, balance: base.amount };
    if (a.owner !== base.owner) changes.push({ ...common, kind: 'token-owner', before: base.owner, after: a.owner });
    if (a.delegate !== null && (a.delegate !== base.delegate || a.delegatedAmount > base.delegatedAmount)) {
      changes.push({ ...common, kind: 'token-delegate', before: base.delegate, after: a.delegate, amount: a.delegatedAmount });
    }
    if (a.closeAuthority !== null && a.closeAuthority !== base.closeAuthority) {
      changes.push({ ...common, kind: 'token-close-authority', before: base.closeAuthority, after: a.closeAuthority });
    }
  }
  return changes;
}
