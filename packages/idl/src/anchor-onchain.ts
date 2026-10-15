import type { ChainReader } from '@clef/rpc';
import { createAddressWithSeed, getProgramDerivedAddress, type Address } from '@solana/kit';
import { unzlibSync } from 'fflate';
import { resolveIdl } from './normalize';
import type { IdlSource, ResolvedIdl } from './types';

const HEADER = 8 + 32; // discriminator + authority

export async function anchorIdlAddress(programId: Address): Promise<Address> {
  const [base] = await getProgramDerivedAddress({ programAddress: programId, seeds: [] });
  return createAddressWithSeed({ baseAddress: base, programAddress: programId, seed: 'anchor:idl' });
}

export function decodeAnchorIdlAccount(data: Uint8Array): string {
  const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(HEADER, true);
  const start = HEADER + 4;
  return new TextDecoder().decode(unzlibSync(data.subarray(start, start + length)));
}

export class AnchorOnchainIdlSource implements IdlSource {
  readonly kind = 'anchor-onchain' as const;

  constructor(private readonly reader: ChainReader) {}

  async load(programId: Address): Promise<ResolvedIdl | null> {
    const [account] = await this.reader.getAccounts([await anchorIdlAddress(programId)]);
    if (!account) return null;
    return resolveIdl(programId, this.kind, 'authority', decodeAnchorIdlAccount(account.data));
  }
}
