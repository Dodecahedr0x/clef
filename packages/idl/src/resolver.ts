import type { ChainReader } from '@clef/rpc';
import type { Address } from '@solana/kit';
import { AnchorOnchainIdlSource } from './anchor-onchain';
import { createBundledSource } from './bundled';
import { ProgramMetadataIdlSource } from './program-metadata';
import type { UserIdlSource } from './static-source';
import type { IdlSource, IdlSourceKind, ResolvedIdl } from './types';

export type IdlLoadError = { source: IdlSourceKind; programId: Address; message: string };

export class IdlResolver {
  private readonly cache = new Map<string, Promise<ResolvedIdl | null>>();

  constructor(private readonly sources: readonly IdlSource[]) {}

  /**
   * Yields every available IDL for `programId`, best source first. Loads lazily and caches per source;
   * results (including "no IDL") stay cached, failed loads are reported and retried on the next call.
   */
  async *candidates(programId: Address, onError: (e: IdlLoadError) => void = () => {}): AsyncGenerator<ResolvedIdl> {
    for (const source of this.sources) {
      const key = `${source.kind}:${programId}`;
      let pending = this.cache.get(key);
      if (!pending) {
        pending = source.load(programId);
        this.cache.set(key, pending);
      }
      try {
        const idl = await pending;
        if (idl) yield idl;
      } catch (e) {
        // Failures (often transient RPC errors) are not cached. Only evict our own entry, not a newer retry.
        if (this.cache.get(key) === pending) this.cache.delete(key);
        onError({ source: source.kind, programId, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  invalidate(programId: Address): void {
    for (const source of this.sources) this.cache.delete(`${source.kind}:${programId}`);
  }
}

/** user → curated bundle → Program Metadata → on-chain Anchor IDL. */
export function createDefaultResolver(reader: ChainReader, user: UserIdlSource): IdlResolver {
  return new IdlResolver([user, createBundledSource(), new ProgramMetadataIdlSource(reader), new AnchorOnchainIdlSource(reader)]);
}
