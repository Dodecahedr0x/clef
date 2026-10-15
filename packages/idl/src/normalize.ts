import type { RootNode } from '@codama/nodes';
import { rootNodeFromAnchor, type AnchorIdl } from '@codama/nodes-from-anchor';
import type { Address } from '@solana/kit';
import { extractAnchorExtras } from './anchor-extras';
import type { IdlSourceKind, NormalizedIdl, ResolvedIdl, TrustTier } from './types';

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** JSON with object keys sorted recursively and no whitespace. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const UNRECOGNIZED = 'Unrecognized IDL format (expected a Codama rootNode or an Anchor IDL)';

/** Accepts a Codama root or an Anchor IDL (as JSON text or parsed object) and returns a Codama root. */
export async function normalizeIdl(input: string | object): Promise<NormalizedIdl> {
  const value: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(UNRECOGNIZED);
  const parsed = value as Record<string, unknown>;
  const hash = await sha256Hex(canonicalJson(parsed));

  if (parsed.kind === 'rootNode') return { root: parsed as unknown as RootNode, hash };
  if (Array.isArray(parsed.instructions)) {
    const spec = (parsed.metadata as { spec?: unknown } | undefined)?.spec;
    if (spec !== undefined && spec !== '0.1.0') throw new Error(`Unsupported Anchor IDL spec ${String(spec)}`);
    return {
      root: rootNodeFromAnchor(parsed as unknown as AnchorIdl),
      anchorExtras: extractAnchorExtras(parsed),
      hash,
    };
  }
  throw new Error(UNRECOGNIZED);
}

/**
 * Normalizes an IDL served for `programId`. IDLs without an address (legacy Anchor) are bound to `programId`;
 * IDLs declaring a different address are rejected.
 */
export async function resolveIdl(
  programId: Address,
  source: IdlSourceKind,
  trust: TrustTier,
  input: string | object,
): Promise<ResolvedIdl> {
  const normalized = await normalizeIdl(input);
  const declared = normalized.root.program.publicKey;
  if (declared && declared !== programId) throw new Error(`IDL is for program ${declared}, not ${programId}`);
  const root: RootNode = declared
    ? normalized.root
    : { ...normalized.root, program: { ...normalized.root.program, publicKey: programId } };
  return { ...normalized, root, programId, source, trust };
}
