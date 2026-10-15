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
  /** Token kinds: the token account's owner before the transaction. */
  holder?: Address;
  /** Token kinds: the token account's balance before the transaction. */
  balance?: bigint;
};

/**
 * Authority-relevant differences between pre- and post-transaction account states (e.g. from simulation),
 * whichever instruction (top-level or CPI) caused them. Only accounts that exist on both sides are compared.
 */
export function computeStateChanges(
  pre: readonly (RawAccount | null | undefined)[],
  post: readonly (RawAccount | null)[],
): StateChange[] {
  const postByAddress = new Map(post.filter((a): a is RawAccount => !!a).map((a) => [a.address, a]));
  const changes: StateChange[] = [];
  for (const before of pre) {
    const after = before && postByAddress.get(before.address);
    if (!before || !after) continue;
    const address = before.address;
    if (before.owner !== after.owner) changes.push({ address, kind: 'program-owner', before: before.owner, after: after.owner });

    const b = decodeTokenAccount(before);
    const a = decodeTokenAccount(after);
    if (!b || !a) continue;
    const common = { address, holder: b.owner, balance: b.amount };
    if (a.owner !== b.owner) changes.push({ ...common, kind: 'token-owner', before: b.owner, after: a.owner });
    if (a.delegate !== null && (a.delegate !== b.delegate || a.delegatedAmount > b.delegatedAmount)) {
      changes.push({ ...common, kind: 'token-delegate', before: b.delegate, after: a.delegate, amount: a.delegatedAmount });
    }
    if (a.closeAuthority !== null && a.closeAuthority !== b.closeAuthority) {
      changes.push({ ...common, kind: 'token-close-authority', before: b.closeAuthority, after: a.closeAuthority });
    }
  }
  return changes;
}
