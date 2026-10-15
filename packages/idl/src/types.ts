import type { RootNode } from '@codama/nodes';
import type { Address } from '@solana/kit';
import type { AnchorExtras } from './anchor-extras';

/** How much to trust names coming from this IDL. */
export type TrustTier = 'curated' | 'authority' | 'user';
export type IdlSourceKind = 'user' | 'bundled' | 'program-metadata' | 'anchor-onchain';

export type NormalizedIdl = { root: RootNode; anchorExtras?: AnchorExtras; hash: string };

export type ResolvedIdl = NormalizedIdl & {
  programId: Address;
  source: IdlSourceKind;
  trust: TrustTier;
};

export interface IdlSource {
  readonly kind: IdlSourceKind;
  load(programId: Address): Promise<ResolvedIdl | null>;
}
