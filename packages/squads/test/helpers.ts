import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryChainReader } from '@clef/rpc';
import { address, getBase64Encoder, type Address } from '@solana/kit';

type JsonAccount = { owner: string; lamports: string; data: string } | null;
type MainnetFixture = {
  multisig: string;
  accounts: Record<string, JsonAccount>;
  expected: {
    multisig: { threshold: number; timeLock: number; transactionIndex: string; staleTransactionIndex: string; members: { key: string; mask: number }[] };
    proposals: Record<string, { status: string; approved: string[]; rejected: string[]; cancelled: string[] }>;
    transactions: Record<string, { vaultIndex: number; accountKeys: string[]; numSigners: number; numWritableSigners: number; numWritableNonSigners: number; instructions: { programIdIndex: number; accountIndexes: number[]; data: string }[]; lookups: number }>;
  };
};
type Ix = { programId: string; keys: [string, boolean, boolean][]; data: string };
type SdkVectors = Record<'vaultTransactionCreate' | 'proposalCreate' | 'proposalApprove' | 'proposalReject' | 'execute387', Ix> & {
  innerWire: string;
  alts: Record<string, JsonAccount>;
};

const read = <T>(name: string): T => JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')) as T;
export const mainnet = read<MainnetFixture>('mainnet-accounts.json');
export const sdk = read<SdkVectors>('sdk-vectors.json');
export const MULTISIG = address(mainnet.multisig);
export const MEMBER = address('3TPczDPBfQpA6KiHSwYC51Qwzn1DJApVwqCK88zB69Au');

export const b64 = (s: string) => new Uint8Array(getBase64Encoder().encode(s));
export const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

export function mainnetReader(extra: Record<string, JsonAccount> = {}): MemoryChainReader {
  const reader = new MemoryChainReader();
  for (const [key, acc] of Object.entries({ ...mainnet.accounts, ...extra })) {
    if (!acc) continue;
    reader.setAccount({ address: key as Address, owner: address(acc.owner), lamports: BigInt(acc.lamports), data: b64(acc.data) });
  }
  return reader;
}
