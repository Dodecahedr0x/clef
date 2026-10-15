import type { Address } from '@solana/kit';
import { normalizeIdl } from './normalize';
import type { IdlSource, IdlSourceKind, ResolvedIdl, TrustTier } from './types';

/** Serves IDLs from an in-memory map of program id → IDL JSON. */
export class StaticIdlSource implements IdlSource {
  constructor(
    readonly kind: IdlSourceKind,
    private readonly trust: TrustTier,
    protected readonly idls = new Map<string, string | object>(),
  ) {}

  async load(programId: Address): Promise<ResolvedIdl | null> {
    const idl = this.idls.get(programId);
    if (!idl) return null;
    return { programId, source: this.kind, trust: this.trust, ...(await normalizeIdl(idl)) };
  }
}

export class UserIdlSource extends StaticIdlSource {
  constructor() {
    super('user', 'user');
  }

  set(programId: Address, json: string): void {
    this.idls.set(programId, json);
  }

  delete(programId: Address): void {
    this.idls.delete(programId);
  }
}
