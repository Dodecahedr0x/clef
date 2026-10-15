import type { RootNode } from '@codama/nodes';
import { rootNodeFromAnchor, type AnchorIdl } from '@codama/nodes-from-anchor';
import { extractAnchorExtras } from './anchor-extras';
import type { NormalizedIdl } from './types';

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Accepts a Codama root or an Anchor IDL (as JSON text or parsed object) and returns a Codama root. */
export async function normalizeIdl(input: string | object): Promise<NormalizedIdl> {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  const parsed = (typeof input === 'string' ? JSON.parse(input) : input) as Record<string, unknown>;
  const hash = await sha256Hex(text);

  if (parsed.kind === 'rootNode') return { root: parsed as unknown as RootNode, hash };
  if (Array.isArray(parsed.instructions)) {
    return {
      root: rootNodeFromAnchor(parsed as unknown as AnchorIdl),
      anchorExtras: extractAnchorExtras(parsed),
      hash,
    };
  }
  throw new Error('Unrecognized IDL format (expected a Codama rootNode or an Anchor IDL)');
}
