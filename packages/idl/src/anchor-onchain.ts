import type { ChainReader } from '@clef/rpc';
import { createAddressWithSeed, getProgramDerivedAddress, type Address } from '@solana/kit';
import { asDecodeError, IdlDecodeError } from './errors';
import { inflateCapped } from './inflate';
import { resolveIdl } from './normalize';
import type { IdlSource, ResolvedIdl } from './types';

const HEADER = 8 + 32; // discriminator + authority
const DATA_START = HEADER + 4; // + u32 length

export async function anchorIdlAddress(programId: Address): Promise<Address> {
  const [base] = await getProgramDerivedAddress({ programAddress: programId, seeds: [] });
  return createAddressWithSeed({ baseAddress: base, programAddress: programId, seed: 'anchor:idl' });
}

/**
 * Decodes an Anchor IDL account: 8-byte discriminator, 32-byte IDL authority, u32 LE length `n`, then `n` bytes
 * of zlib-compressed IDL JSON (the rest of the account is slack). Throws `IdlDecodeError` on any malformed input.
 */
export function decodeAnchorIdlAccount(data: Uint8Array): string {
  if (data.length < DATA_START) throw new IdlDecodeError(`Anchor IDL account too short (${data.length} bytes)`);
  const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(HEADER, true);
  if (DATA_START + length > data.length) {
    throw new IdlDecodeError(`Anchor IDL length ${length} overruns the account (${data.length} bytes)`);
  }
  return new TextDecoder().decode(inflateCapped(data.subarray(DATA_START, DATA_START + length)));
}

/**
 * Anchor IDLs stored on chain by `anchor idl init`. Trust is 'authority' because only the IDL account's
 * authority can write it — note that this is the IDL authority, which may differ from the upgrade authority.
 */
export class AnchorOnchainIdlSource implements IdlSource {
  readonly kind = 'anchor-onchain' as const;

  constructor(private readonly reader: ChainReader) {}

  async load(programId: Address): Promise<ResolvedIdl | null> {
    const [account] = await this.reader.getAccounts([await anchorIdlAddress(programId)]);
    if (!account || account.owner !== programId) return null;
    return asDecodeError(() => resolveIdl(programId, this.kind, 'authority', decodeAnchorIdlAccount(account.data)));
  }
}
