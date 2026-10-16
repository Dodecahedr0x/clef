import { fromBase64, toBase64 } from '@clef/vault';
import type { ApprovalDecision, ApprovalRequest, PhishingHit, SignerInfo } from '@clef/wallet-core';
import { isAddress, type Address } from '@solana/kit';

type Common = { origin: string; phishing: PhishingHit | null };

/** ApprovalRequest with bytes as base64, safe for runtime messaging (JSON). */
export type SerializedApproval =
  | ({ kind: 'connect' } & Common)
  | ({ kind: 'signTransactions'; account: string; chain: string; transactions: string[]; send: boolean; signer: SignerInfo } & Common)
  | ({ kind: 'signMessage'; account: string; message: string; signer: SignerInfo } & Common)
  | ({ kind: 'signIn'; account: string | null; input: Record<string, unknown>; signer: SignerInfo | null } & Common)
  | ({
      kind: 'squadsPropose';
      account: string;
      multisig: string;
      vaultIndex: number;
      member: string;
      inner: string;
      proposal: string;
      signer: SignerInfo;
    } & Common);

/** ApprovalDecision as the approval page posts it: signatures as base64. */
export type SerializedDecision = { approved: false } | { approved: true; accounts?: string[]; account?: string; signatures?: string[] };

export function serializeApproval(r: ApprovalRequest): SerializedApproval {
  switch (r.kind) {
    case 'signTransactions':
      return { ...r, transactions: r.transactions.map(toBase64) };
    case 'signMessage':
      return { ...r, message: toBase64(r.message) };
    case 'squadsPropose':
      return { ...r, inner: toBase64(r.inner), proposal: toBase64(r.proposal) };
    case 'signIn':
      return { ...r, input: r.input as Record<string, unknown> };
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
      return { ...s, account: s.account as Address | null, input: s.input } as ApprovalRequest;
    case 'squadsPropose':
      return {
        ...s,
        account: s.account as Address,
        multisig: s.multisig as Address,
        member: s.member as Address,
        inner: fromBase64(s.inner),
        proposal: fromBase64(s.proposal),
      };
    default:
      return s;
  }
}

export function serializeDecision(d: ApprovalDecision): SerializedDecision {
  if (!d.approved) return { approved: false };
  const { signatures, ...rest } = d;
  return signatures ? { ...rest, signatures: signatures.map(toBase64) } : rest;
}

const MAX_ACCOUNTS = 50;
const MAX_SIGNATURES = 16;
const SIGNATURE_BYTES = 64;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function parseSignatures(raw: unknown): Uint8Array[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SIGNATURES) throw new Error('Invalid signatures');
  return raw.map((s) => {
    if (typeof s !== 'string' || s.length % 4 !== 0 || !BASE64.test(s)) throw new Error('Invalid signatures');
    const bytes = fromBase64(s);
    if (bytes.length !== SIGNATURE_BYTES) throw new Error('Invalid signatures');
    return bytes;
  });
}

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
  if (d.signatures !== undefined) out.signatures = parseSignatures(d.signatures);
  return out;
}
