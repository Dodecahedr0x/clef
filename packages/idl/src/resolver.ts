import type { ChainReader } from '@clef/rpc';
import type { Address } from '@solana/kit';
import { AnchorOnchainIdlSource } from './anchor-onchain';
import { createBundledSource } from './bundled';
import { IdlDecodeError } from './errors';
import { ProgramMetadataIdlSource, type ProgramMetadataIdlSourceOptions } from './program-metadata';
import type { UserIdlSource } from './static-source';
import type { IdlSource, IdlSourceKind, ResolvedIdl } from './types';

export type IdlLoadError = { source: IdlSourceKind; programId: Address; message: string };

export type IdlResolverOptions = {
  /** A source load slower than this fails with a transient error (retried on the next call). Default 10 s. */
  loadTimeoutMs?: number;
};

const MAX_MESSAGE_LENGTH = 200;

/**
 * Same character class as `UNSAFE` in packages/explain/src/text.ts (`sanitizeText`), duplicated because @clef/idl
 * cannot depend on @clef/explain: keep the two in sync.
 */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\u115f\u1160\u3164\uffa0\ufe00-\ufe0f\u{e0100}-\u{e01ef}]/gu;

/** Error text can come from the network: strip control, invisible and bidi characters and bound its length. */
function sanitize(message: string): string {
  return Array.from(message.replace(UNSAFE, '')).slice(0, MAX_MESSAGE_LENGTH).join('');
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class IdlResolver {
  private readonly cache = new Map<string, Promise<ResolvedIdl | null>>();
  private readonly loadTimeoutMs: number;

  constructor(
    private readonly sources: readonly IdlSource[],
    options: IdlResolverOptions = {},
  ) {
    this.loadTimeoutMs = options.loadTimeoutMs ?? 10_000;
  }

  /**
   * Yields every available IDL for `programId`, best source first. Loads lazily and caches per source:
   * results ("no IDL" included) and `IdlDecodeError`s stay cached (the error is re-reported on every call);
   * any other failure is treated as transient (RPC error, timeout), reported, and retried on the next call.
   */
  async *candidates(programId: Address, onError: (e: IdlLoadError) => void = () => {}): AsyncGenerator<ResolvedIdl> {
    for (const source of this.sources) {
      const key = `${source.kind}:${programId}`;
      let pending = this.cache.get(key);
      if (!pending) {
        pending = withTimeout(source.load(programId), this.loadTimeoutMs, `IDL source ${source.kind}`);
        this.cache.set(key, pending);
      }
      try {
        const idl = await pending;
        if (idl) yield idl;
      } catch (e) {
        // Only evict our own entry, never a newer retry started meanwhile.
        if (!(e instanceof IdlDecodeError) && this.cache.get(key) === pending) this.cache.delete(key);
        onError({ source: source.kind, programId, message: sanitize(e instanceof Error ? e.message : String(e)) });
      }
    }
  }

  invalidate(programId: Address): void {
    for (const source of this.sources) this.cache.delete(`${source.kind}:${programId}`);
  }
}

/** user -> curated bundle -> Program Metadata -> on-chain Anchor IDL. */
export function createDefaultResolver(
  reader: ChainReader,
  user: UserIdlSource,
  options: IdlResolverOptions & ProgramMetadataIdlSourceOptions = {},
): IdlResolver {
  return new IdlResolver(
    [user, createBundledSource(), new ProgramMetadataIdlSource(reader, options), new AnchorOnchainIdlSource(reader)],
    options,
  );
}
