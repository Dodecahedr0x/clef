import type { Address } from '@solana/kit';
import { resolveIdl } from './normalize';
import type { IdlSource, IdlSourceKind, ResolvedIdl, TrustTier } from './types';

/** Serves IDLs from an in-memory map of program id → IDL JSON, normalizing each one at most once. */
export class StaticIdlSource implements IdlSource {
  protected readonly cache = new Map<string, Promise<ResolvedIdl>>();

  constructor(
    readonly kind: IdlSourceKind,
    private readonly trust: TrustTier,
    protected readonly idls = new Map<string, string | object>(),
  ) {}

  load(programId: Address): Promise<ResolvedIdl | null> {
    const cached = this.cache.get(programId);
    if (cached) return cached;
    const idl = this.idls.get(programId);
    if (!idl) return Promise.resolve(null);
    const resolved = resolveIdl(programId, this.kind, this.trust, idl);
    this.cache.set(programId, resolved);
    return resolved;
  }
}

export class UserIdlSource extends StaticIdlSource {
  constructor() {
    super('user', 'user');
  }

  set(programId: Address, json: string): void {
    this.idls.set(programId, json);
    this.cache.delete(programId);
  }

  delete(programId: Address): void {
    this.idls.delete(programId);
    this.cache.delete(programId);
  }
}
