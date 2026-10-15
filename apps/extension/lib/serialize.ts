import { fromBase64, toBase64 } from '@clef/vault';
import type { ApprovalDecision, ApprovalRequest } from '@clef/wallet-core';
import { isAddress, type Address } from '@solana/kit';

/** ApprovalRequest with bytes as base64, safe for runtime messaging (JSON). */
export type SerializedApproval =
  | { kind: 'connect'; origin: string }
  | { kind: 'signTransactions'; origin: string; account: string; chain: string; transactions: string[]; send: boolean }
  | { kind: 'signMessage'; origin: string; account: string; message: string }
  | { kind: 'signIn'; origin: string; account: string | null; input: Record<string, unknown> };

export function serializeApproval(r: ApprovalRequest): SerializedApproval {
  switch (r.kind) {
    case 'signTransactions':
      return { ...r, transactions: r.transactions.map(toBase64) };
    case 'signMessage':
      return { ...r, message: toBase64(r.message) };
    default:
      return r;
  }
}

export function deserializeApproval(s: SerializedApproval): ApprovalRequest {
  switch (s.kind) {
    case 'signTransactions':
      return { ...s, account: s.account as Address, transactions: s.transactions.map(fromBase64) };
    case 'signMessage':
      return { ...s, account: s.account as Address, message: fromBase64(s.message) };
    case 'signIn':
      return { ...s, account: s.account as Address | null, input: s.input };
    default:
      return s;
  }
}

const MAX_ACCOUNTS = 50;

/** Validates a decision posted by the approval page before it reaches the wallet service. */
export function parseDecision(raw: unknown): ApprovalDecision {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('Invalid decision');
  const d = raw as Record<string, unknown>;
  if (d.approved === false) return { approved: false };
  if (d.approved !== true) throw new Error('Invalid decision');
  const out: ApprovalDecision = { approved: true };
  if (d.accounts !== undefined) {
    if (!Array.isArray(d.accounts) || d.accounts.length > MAX_ACCOUNTS || !d.accounts.every((a) => typeof a === 'string' && isAddress(a))) {
      throw new Error('Invalid accounts');
    }
    out.accounts = d.accounts as string[];
  }
  if (d.account !== undefined) {
    if (typeof d.account !== 'string' || !isAddress(d.account)) throw new Error('Invalid account');
    out.account = d.account;
  }
  return out;
}
