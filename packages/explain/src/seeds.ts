import { sanitizeText } from './text';
import type { RelationEdge } from './types';
import { toHex } from './hex';

/** The relation cannot be checked from what the transaction and IDL provide: reported as `unverified`. */
export class Unresolvable extends Error {}

/** Printable ASCII is shown as a quoted string, anything else as hex. */
export function displayBytes(bytes: Uint8Array): string {
  const printable = bytes.length > 0 && bytes.every((b) => b >= 0x20 && b < 0x7f);
  return printable ? JSON.stringify(new TextDecoder().decode(bytes)) : `0x${toHex(bytes)}`;
}

/** An error as an edge detail: sanitized (messages can carry IDL names) and bounded. */
export function errorDetail(e: unknown): string {
  // Production builds of @solana/errors replace messages with a code; the RPC's own words stay in the context.
  const server = (e as { context?: { __serverMessage?: unknown } } | null)?.context?.__serverMessage;
  return sanitizeText(typeof server === 'string' && server ? server : e instanceof Error ? e.message : String(e), 200);
}

/**
 * A relation edge with every IDL-derived string (label, detail, seed displays) sanitized and bounded: names and
 * decoded values come from the IDL or account data, both untrusted.
 */
export function sanitizeEdge(edge: RelationEdge): RelationEdge {
  return {
    ...edge,
    label: sanitizeText(edge.label, 200),
    ...(edge.detail !== undefined && { detail: sanitizeText(edge.detail, 200) }),
    ...(edge.seeds && { seeds: edge.seeds.map((s) => ({ ...s, display: sanitizeText(s.display, 100) })) }),
  };
}

/**
 * Status of a re-derived PDA. A match under an untrusted program (one the transaction chose) proves nothing.
 * `getProgramDerivedAddress` finds the canonical bump only: an account created with a non-canonical bump shows
 * as a mismatch.
 */
export function pdaStatus(
  expected: string,
  actual: string,
  programAddress: string,
  trusted: boolean,
): { status: RelationEdge['status']; detail?: string } {
  if (expected !== actual) return { status: 'mismatch', detail: `expected ${expected}` };
  return trusted ? { status: 'verified' } : { status: 'unverified', detail: `derived under ${programAddress}` };
}
