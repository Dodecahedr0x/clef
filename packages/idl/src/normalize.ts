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

/**
 * Some generators (e.g. Phoenix's Ember) emit the new Anchor layout (metadata.spec, discriminators) with the legacy
 * `publicKey` type name; Codama's new-format parser only knows `pubkey`. Rename it wherever a type is named.
 */
export function fixHybridTypeNames(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fixHybridTypeNames);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === 'publicKey' && (k === 'type' || k === 'option' || k === 'vec' || k === 'coption')) out[k] = 'pubkey';
    else if (k === 'array' && Array.isArray(v) && v[0] === 'publicKey') out[k] = ['pubkey', ...v.slice(1)];
    else out[k] = fixHybridTypeNames(v);
  }
  return out;
}

/**
 * Production builds of Codama replace error messages with a code and an encoded context; turn that back into
 * something a person can act on.
 */
export function describeIdlError(e: unknown): string {
  const err = e as { message?: unknown; context?: Record<string, unknown> } | null;
  const message = typeof err?.message === 'string' ? err.message : String(e);
  const ctx = err?.context;
  if (!ctx || !/^Codama error #/.test(message)) return message;
  if (ctx.__code === 2100000 && typeof ctx.idlType !== 'undefined') return `Unrecognized Anchor IDL type ${JSON.stringify(ctx.idlType)}`;
  const details = Object.entries(ctx)
    .filter(([k]) => k !== '__code')
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ');
  return `The IDL could not be read (Codama error ${String(ctx.__code)}${details ? `; ${details}` : ''})`;
}

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
    const anchor = (spec !== undefined ? fixHybridTypeNames(parsed) : parsed) as Record<string, unknown>;
    let root: RootNode;
    try {
      root = rootNodeFromAnchor(anchor as unknown as AnchorIdl);
    } catch (e) {
      throw new Error(describeIdlError(e));
    }
    return { root, anchorExtras: extractAnchorExtras(anchor), hash };
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
