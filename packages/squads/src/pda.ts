import { getAddressEncoder, getProgramDerivedAddress, getU64Encoder, type Address } from '@solana/kit';

export const SQUADS_PROGRAM_ID = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf' as Address;

const PREFIX = 'multisig';

async function derive(seeds: (string | Uint8Array)[]): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({ programAddress: SQUADS_PROGRAM_ID, seeds });
  return pda;
}

const key = (a: Address) => getAddressEncoder().encode(a) as Uint8Array;
const u64 = (n: bigint) => getU64Encoder().encode(n) as Uint8Array;

export function programConfigPda(): Promise<Address> {
  return derive([PREFIX, 'program_config']);
}

export function multisigPda(createKey: Address): Promise<Address> {
  return derive([PREFIX, 'multisig', key(createKey)]);
}

export async function vaultPda(multisig: Address, index: number): Promise<Address> {
  if (!Number.isInteger(index) || index < 0 || index > 255) throw new RangeError(`Invalid vault index ${index}`);
  return derive([PREFIX, key(multisig), 'vault', new Uint8Array([index])]);
}

export function transactionPda(multisig: Address, index: bigint): Promise<Address> {
  return derive([PREFIX, key(multisig), 'transaction', u64(index)]);
}

export function proposalPda(multisig: Address, index: bigint): Promise<Address> {
  return derive([PREFIX, key(multisig), 'transaction', u64(index), 'proposal']);
}

export function transactionBufferPda(multisig: Address, creator: Address, bufferIndex: number): Promise<Address> {
  if (!Number.isInteger(bufferIndex) || bufferIndex < 0 || bufferIndex > 255) throw new RangeError(`Invalid buffer index ${bufferIndex}`);
  return derive([PREFIX, key(multisig), 'transaction_buffer', key(creator), new Uint8Array([bufferIndex])]);
}

export function ephemeralSignerPda(transaction: Address, index: number): Promise<Address> {
  return derive([PREFIX, key(transaction), 'ephemeral_signer', new Uint8Array([index])]);
}
