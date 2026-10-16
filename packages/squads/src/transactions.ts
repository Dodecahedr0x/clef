import type { ChainReader } from '@clef/rpc';
import {
  AccountRole,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  getTransactionEncoder,
  getU64Encoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type AccountMeta,
  type Address,
  type Blockhash,
  type Instruction,
} from '@solana/kit';
import { decodeVaultTransaction, type VaultMessage } from './accounts';
import { encodeTransactionMessage, vaultMessageFromWire } from './message';
import { proposalPda, SQUADS_PROGRAM_ID, transactionPda, vaultPda } from './pda';

const SYSTEM_PROGRAM = '11111111111111111111111111111111' as Address;
const ALT_PROGRAM = 'AddressLookupTab1e1111111111111111111111111' as Address;
const ALT_HEADER = 56;
const PACKET_DATA_SIZE = 1232;

const DISC = {
  vaultTransactionCreate: [0x30, 0xfa, 0x4e, 0xa8, 0xd0, 0xe2, 0xda, 0xd3],
  proposalCreate: [0xdc, 0x3c, 0x49, 0xe0, 0x1e, 0x6c, 0x4f, 0x9f],
  proposalApprove: [0x90, 0x25, 0xa4, 0x88, 0xbc, 0xd8, 0x2a, 0xf8],
  proposalReject: [0xf3, 0x3e, 0x86, 0x9c, 0xe6, 0x6a, 0xf6, 0x87],
  vaultTransactionExecute: [0xc2, 0x08, 0xa1, 0x57, 0x99, 0xa4, 0x19, 0xab],
} as const;

const u64 = (n: bigint) => [...getU64Encoder().encode(n)];
const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const NO_MEMO = 0;

const meta = (address: Address, role: AccountRole): AccountMeta => ({ address, role });

function squadsIx(accounts: AccountMeta[], data: number[]): Instruction {
  return { programAddress: SQUADS_PROGRAM_ID, accounts, data: new Uint8Array(data) };
}

/** Unsigned v0 wire transaction with `member` as fee payer and only signer. */
function toWire(member: Address, blockhash: string, instructions: Instruction[]): Uint8Array {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(member, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash as Blockhash, lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const wire = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
  if (wire.length > PACKET_DATA_SIZE) throw new Error(`Squads transaction is ${wire.length} bytes, over the ${PACKET_DATA_SIZE}-byte limit`);
  return wire;
}

function voteIx(multisig: Address, member: Address, proposal: Address, vote: 'approve' | 'reject'): Instruction {
  return squadsIx(
    [meta(multisig, AccountRole.READONLY), meta(member, AccountRole.WRITABLE_SIGNER), meta(proposal, AccountRole.WRITABLE)],
    [...(vote === 'approve' ? DISC.proposalApprove : DISC.proposalReject), NO_MEMO],
  );
}

/**
 * Wraps `innerWire` (a wire transaction whose only signer is the vault) into a new vault transaction, opens its
 * proposal and casts the member's approval. Unsigned; the member pays.
 */
export async function buildProposeTransaction(p: {
  multisig: Address;
  vaultIndex: number;
  member: Address;
  innerWire: Uint8Array;
  transactionIndex: bigint;
  blockhash: string;
}): Promise<Uint8Array> {
  const vault = await vaultPda(p.multisig, p.vaultIndex);
  const inner = vaultMessageFromWire(p.innerWire);
  if (inner.numSigners !== 1 || inner.accountKeys[0] !== vault) {
    throw new Error(`The inner transaction must be signed by vault ${vault} alone`);
  }
  const [transaction, proposal] = await Promise.all([transactionPda(p.multisig, p.transactionIndex), proposalPda(p.multisig, p.transactionIndex)]);
  const messageBytes = encodeTransactionMessage(inner);
  const create = squadsIx(
    [
      meta(p.multisig, AccountRole.WRITABLE),
      meta(transaction, AccountRole.WRITABLE),
      meta(p.member, AccountRole.READONLY_SIGNER),
      meta(p.member, AccountRole.WRITABLE_SIGNER),
      meta(SYSTEM_PROGRAM, AccountRole.READONLY),
    ],
    [...DISC.vaultTransactionCreate, p.vaultIndex, 0, ...u32(messageBytes.length), ...messageBytes, NO_MEMO],
  );
  const propose = squadsIx(
    [
      meta(p.multisig, AccountRole.READONLY),
      meta(proposal, AccountRole.WRITABLE),
      meta(p.member, AccountRole.READONLY_SIGNER),
      meta(p.member, AccountRole.WRITABLE_SIGNER),
      meta(SYSTEM_PROGRAM, AccountRole.READONLY),
    ],
    [...DISC.proposalCreate, ...u64(p.transactionIndex), 0],
  );
  return toWire(p.member, p.blockhash, [create, propose, voteIx(p.multisig, p.member, proposal, 'approve')]);
}

export async function buildVoteTransaction(p: {
  multisig: Address;
  member: Address;
  transactionIndex: bigint;
  vote: 'approve' | 'reject';
  blockhash: string;
}): Promise<Uint8Array> {
  const proposal = await proposalPda(p.multisig, p.transactionIndex);
  return toWire(p.member, p.blockhash, [voteIx(p.multisig, p.member, proposal, p.vote)]);
}

async function ephemeralSignerPdas(transaction: Address, count: number): Promise<Set<Address>> {
  const tx = getAddressEncoder().encode(transaction);
  const pdas = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      getProgramDerivedAddress({ programAddress: SQUADS_PROGRAM_ID, seeds: ['multisig', tx, 'ephemeral_signer', new Uint8Array([i])] }),
    ),
  );
  return new Set(pdas.map(([pda]) => pda));
}

/** Same order as the program expects (and @sqds/multisig produces): tables, static keys, then per-table loaded keys. */
async function executeRemainingAccounts(chain: ChainReader, m: VaultMessage, vault: Address, ephemeral: Set<Address>): Promise<AccountMeta[]> {
  const tables = m.addressTableLookups.map((l) => l.accountKey);
  const accounts = tables.length ? await chain.getAccounts(tables) : [];
  const decoder = getAddressDecoder();
  const loaded = (table: Address, i: number): Address => {
    const acc = accounts[tables.indexOf(table)];
    if (!acc || acc.owner !== ALT_PROGRAM) throw new Error(`Address lookup table ${table} not found`);
    const at = ALT_HEADER + i * 32;
    if (at + 32 > acc.data.length) throw new Error(`Address lookup table ${table} has no address at index ${i}`);
    return decoder.decode(acc.data.subarray(at, at + 32));
  };

  const metas: AccountMeta[] = tables.map((t) => meta(t, AccountRole.READONLY));
  m.accountKeys.forEach((key, i) => {
    const signer = i < m.numSigners && key !== vault && !ephemeral.has(key);
    const writable = i < m.numSigners ? i < m.numWritableSigners : i - m.numSigners < m.numWritableNonSigners;
    metas.push(meta(key, signer ? (writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER) : writable ? AccountRole.WRITABLE : AccountRole.READONLY));
  });
  for (const l of m.addressTableLookups) {
    for (const i of l.writableIndexes) metas.push(meta(loaded(l.accountKey, i), AccountRole.WRITABLE));
    for (const i of l.readonlyIndexes) metas.push(meta(loaded(l.accountKey, i), AccountRole.READONLY));
  }
  return metas;
}

export async function buildExecuteTransaction(
  chain: ChainReader,
  p: { multisig: Address; member: Address; transactionIndex: bigint; blockhash: string },
): Promise<Uint8Array> {
  const [transaction, proposal] = await Promise.all([transactionPda(p.multisig, p.transactionIndex), proposalPda(p.multisig, p.transactionIndex)]);
  const [account] = await chain.getAccounts([transaction]);
  if (!account || account.owner !== SQUADS_PROGRAM_ID) throw new Error(`Vault transaction ${transaction} not found`);
  const vt = decodeVaultTransaction(account.data);
  if (vt.multisig !== p.multisig || vt.index !== p.transactionIndex) throw new Error(`Vault transaction ${transaction} does not belong to ${p.multisig}`);
  const vault = await vaultPda(p.multisig, vt.vaultIndex);
  const ephemeral = await ephemeralSignerPdas(transaction, vt.ephemeralSignerBumps.length);
  const remaining = await executeRemainingAccounts(chain, vt.message, vault, ephemeral);
  const execute = squadsIx(
    [
      meta(p.multisig, AccountRole.READONLY),
      meta(proposal, AccountRole.WRITABLE),
      meta(transaction, AccountRole.READONLY),
      meta(p.member, AccountRole.READONLY_SIGNER),
      ...remaining,
    ],
    [...DISC.vaultTransactionExecute],
  );
  return toWire(p.member, p.blockhash, [execute]);
}
