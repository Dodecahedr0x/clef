import type { Address } from '@solana/kit';
import { Cursor } from './reader';

export type Member = { key: Address; initiate: boolean; vote: boolean; execute: boolean };
export type MultisigInfo = { address: Address; threshold: number; members: Member[]; transactionIndex: bigint; staleTransactionIndex: bigint; timeLock: number };
export type ProposalStatus = 'draft' | 'active' | 'approved' | 'rejected' | 'executing' | 'executed' | 'cancelled';

export type VaultMessage = {
  numSigners: number;
  numWritableSigners: number;
  numWritableNonSigners: number;
  accountKeys: Address[];
  instructions: { programIdIndex: number; accountIndexes: Uint8Array; data: Uint8Array }[];
  addressTableLookups: { accountKey: Address; writableIndexes: Uint8Array; readonlyIndexes: Uint8Array }[];
};

const DISCRIMINATORS = {
  multisig: 'e07479ba44a14fec',
  proposal: '1a5ebdbb74883521',
  vaultTransaction: 'a8faa264510ea2cf',
  programConfig: 'c4d25ae790958c3f',
  transactionBuffer: '5a2423db5de16e60',
} as const;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** True if `data` starts with the Anchor discriminator of the given Squads account type. */
export function isAccount(data: Uint8Array, kind: keyof typeof DISCRIMINATORS): boolean {
  return data.length >= 8 && hex(data.subarray(0, 8)) === DISCRIMINATORS[kind];
}

function open(data: Uint8Array, kind: keyof typeof DISCRIMINATORS): Cursor {
  if (!isAccount(data, kind)) throw new Error(`Not a Squads ${kind} account`);
  const c = new Cursor(data);
  c.skip(8);
  return c;
}

export function decodeMultisig(address: Address, data: Uint8Array): MultisigInfo {
  const c = open(data, 'multisig');
  c.skip(64); // create_key, config_authority
  const threshold = c.u16();
  const timeLock = c.u32();
  const transactionIndex = c.u64();
  const staleTransactionIndex = c.u64();
  c.option(() => c.address()); // rent_collector
  c.u8(); // bump
  const members = c.vec(() => {
    const key = c.address();
    const mask = c.u8();
    return { key, initiate: (mask & 1) !== 0, vote: (mask & 2) !== 0, execute: (mask & 4) !== 0 };
  });
  return { address, threshold, members, transactionIndex, staleTransactionIndex, timeLock };
}

const STATUSES: ProposalStatus[] = ['draft', 'active', 'rejected', 'approved', 'executing', 'executed', 'cancelled'];

export function decodeProposal(data: Uint8Array): { multisig: Address; index: bigint; status: ProposalStatus; approved: Address[]; rejected: Address[]; cancelled: Address[] } {
  const c = open(data, 'proposal');
  const multisig = c.address();
  const index = c.u64();
  const tag = c.u8();
  const status = STATUSES[tag];
  if (!status) throw new Error(`Unknown Squads proposal status ${tag}`);
  if (status !== 'executing') c.skip(8); // timestamp
  c.u8(); // bump
  const approved = c.vec(() => c.address());
  const rejected = c.vec(() => c.address());
  const cancelled = c.vec(() => c.address());
  return { multisig, index, status, approved, rejected, cancelled };
}

export function decodeVaultTransaction(data: Uint8Array): { multisig: Address; index: bigint; vaultIndex: number; ephemeralSignerBumps: Uint8Array; message: VaultMessage } {
  const c = open(data, 'vaultTransaction');
  const multisig = c.address();
  c.address(); // creator
  const index = c.u64();
  c.u8(); // bump
  const vaultIndex = c.u8();
  c.u8(); // vault_bump
  const ephemeralSignerBumps = c.vecU8();
  const message: VaultMessage = {
    numSigners: c.u8(),
    numWritableSigners: c.u8(),
    numWritableNonSigners: c.u8(),
    accountKeys: c.vec(() => c.address()),
    instructions: c.vec(() => ({ programIdIndex: c.u8(), accountIndexes: c.vecU8(), data: c.vecU8() })),
    addressTableLookups: c.vec(() => ({ accountKey: c.address(), writableIndexes: c.vecU8(), readonlyIndexes: c.vecU8() })),
  };
  return { multisig, index, vaultIndex, ephemeralSignerBumps, message };
}

export function decodeProgramConfig(data: Uint8Array): { authority: Address; multisigCreationFee: bigint; treasury: Address } {
  const c = open(data, 'programConfig');
  return { authority: c.address(), multisigCreationFee: c.u64(), treasury: c.address() };
}

export type TransactionBufferInfo = { multisig: Address; creator: Address; bufferIndex: number; vaultIndex: number; finalBufferHash: Uint8Array; finalBufferSize: number; buffer: Uint8Array };

export function decodeTransactionBuffer(data: Uint8Array): TransactionBufferInfo {
  const c = open(data, 'transactionBuffer');
  return { multisig: c.address(), creator: c.address(), bufferIndex: c.u8(), vaultIndex: c.u8(), finalBufferHash: c.bytes(32), finalBufferSize: c.u16(), buffer: c.vecU8() };
}
