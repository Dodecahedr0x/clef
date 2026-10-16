import type { ChainReader } from '@clef/rpc';
import {
  AccountRole,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getAddressDecoder,
  getTransactionDecoder,
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
import { decodeTransactionBuffer, decodeVaultTransaction, isAccount, type VaultMessage } from './accounts';
import { encodeTransactionMessage, vaultMessageFromWire } from './message';
import { ephemeralSignerPda, proposalPda, SQUADS_PROGRAM_ID, transactionBufferPda, transactionPda, vaultPda } from './pda';

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
  transactionBufferCreate: [0xf5, 0xc9, 0x71, 0x6c, 0x25, 0x3f, 0x1d, 0x59],
  transactionBufferExtend: [0xe6, 0x9d, 0x43, 0x38, 0x05, 0xee, 0xf5, 0x92],
  vaultTransactionCreateFromBuffer: [0xde, 0x36, 0x95, 0x44, 0x57, 0xf6, 0x30, 0xe7],
  transactionBufferClose: [0x11, 0xb6, 0xd0, 0xe4, 0x88, 0x18, 0xb2, 0x66],
} as const;

/** The program's `MAX_BUFFER_SIZE` for a transaction buffer. */
const MAX_BUFFER_SIZE = 10128;
/** `vault_transaction_create_from_buffer` requires this placeholder message (an empty Squads `TransactionMessage`). */
const EMPTY_MESSAGE = [0, 0, 0, 0, 0, 0];

const u64 = (n: bigint) => [...getU64Encoder().encode(n)];
const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const NO_MEMO = 0;

/** Vault transactions above this account size overflow the default 32 KiB heap (and CU budget) when executed. */
const LARGE_TRANSACTION = 1024;
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111' as Address;
const LARGE_BUDGET: Instruction[] = [
  { programAddress: COMPUTE_BUDGET, data: new Uint8Array([2, ...u32(1_400_000)]) },
  { programAddress: COMPUTE_BUDGET, data: new Uint8Array([1, ...u32(256 * 1024)]) },
];

const meta = (address: Address, role: AccountRole): AccountMeta => ({ address, role });

function squadsIx(accounts: AccountMeta[], data: number[]): Instruction {
  return { programAddress: SQUADS_PROGRAM_ID, accounts, data: new Uint8Array(data) };
}

function compileWire(member: Address, blockhash: string, instructions: Instruction[]): Uint8Array {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(member, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash as Blockhash, lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

/** Unsigned v0 wire transaction with `member` as fee payer and only signer. */
function toWire(member: Address, blockhash: string, instructions: Instruction[]): Uint8Array {
  const wire = compileWire(member, blockhash, instructions);
  if (wire.length > PACKET_DATA_SIZE) throw new Error(`Squads transaction is ${wire.length} bytes, over the ${PACKET_DATA_SIZE}-byte limit`);
  return wire;
}

function voteIx(multisig: Address, member: Address, proposal: Address, vote: 'approve' | 'reject'): Instruction {
  return squadsIx(
    [meta(multisig, AccountRole.READONLY), meta(member, AccountRole.WRITABLE_SIGNER), meta(proposal, AccountRole.WRITABLE)],
    [...(vote === 'approve' ? DISC.proposalApprove : DISC.proposalReject), NO_MEMO],
  );
}

type ProposeParams = {
  multisig: Address;
  vaultIndex: number;
  member: Address;
  innerWire: Uint8Array;
  transactionIndex: bigint;
  blockhash: string;
};

/**
 * The inner message as Squads stores it. The vault must sign; every other signer becomes ephemeral signer i (a PDA
 * of the vault transaction the program signs for at execute). Signers the dApp already signed for are refused:
 * their address would change.
 */
async function vaultMessage(p: ProposeParams, transaction: Address): Promise<{ message: VaultMessage; ephemeralSigners: number }> {
  const vault = await vaultPda(p.multisig, p.vaultIndex);
  const inner = vaultMessageFromWire(p.innerWire);
  const signers = inner.accountKeys.slice(0, inner.numSigners);
  if (!signers.includes(vault)) throw new Error(`The inner transaction must be signed by vault ${vault}`);
  const signatures = getTransactionDecoder().decode(p.innerWire).signatures;
  const extra = signers.filter((k) => k !== vault);
  for (const k of extra) {
    const sig = signatures[k];
    if (sig && sig.some((b) => b !== 0)) throw new Error(`The inner transaction is already signed by ${k}; a multisig vault cannot use that key`);
  }
  const ephemeral = await Promise.all(extra.map((_, i) => ephemeralSignerPda(transaction, i)));
  const accountKeys = inner.accountKeys.map((k) => {
    const i = extra.indexOf(k);
    return i < 0 ? k : ephemeral[i]!;
  });
  return { message: { ...inner, accountKeys }, ephemeralSigners: extra.length };
}

async function proposeParts(p: ProposeParams) {
  const [transaction, proposal] = await Promise.all([transactionPda(p.multisig, p.transactionIndex), proposalPda(p.multisig, p.transactionIndex)]);
  const { message, ephemeralSigners } = await vaultMessage(p, transaction);
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
  const createAccounts = [
    meta(p.multisig, AccountRole.WRITABLE),
    meta(transaction, AccountRole.WRITABLE),
    meta(p.member, AccountRole.READONLY_SIGNER),
    meta(p.member, AccountRole.WRITABLE_SIGNER),
    meta(SYSTEM_PROGRAM, AccountRole.READONLY),
  ];
  const createArgs = (messageBytes: number[] | Uint8Array) => [p.vaultIndex, ephemeralSigners, ...u32(messageBytes.length), ...messageBytes, NO_MEMO];
  return { proposal, propose, createAccounts, createArgs, messageBytes: encodeTransactionMessage(message) };
}

/**
 * Wraps `innerWire` into a new vault transaction, opens its proposal and casts the member's approval, all in one
 * transaction. Throws when that does not fit (use `buildProposeTransactions`). Unsigned; the member pays.
 */
export async function buildProposeTransaction(p: ProposeParams): Promise<Uint8Array> {
  const parts = await proposeParts(p);
  const create = squadsIx(parts.createAccounts, [...DISC.vaultTransactionCreate, ...parts.createArgs(parts.messageBytes)]);
  const single = compileWire(p.member, p.blockhash, [create, parts.propose, voteIx(p.multisig, p.member, parts.proposal, 'approve')]);
  if (single.length > PACKET_DATA_SIZE) throw new Error('The inner transaction is too large for one proposal transaction; it needs a transaction buffer');
  return single;
}

/**
 * Unsigned outer transactions that propose `innerWire`, to be submitted in order (each confirmed before the next).
 * One transaction when it fits; otherwise the message goes through the member's transaction buffer:
 * `transactionBufferCreate`, `transactionBufferExtend`*, then `vaultTransactionCreateFromBuffer` + propose + approve.
 * A buffer left by an interrupted attempt is resumed when it holds a prefix of this message, else closed first.
 */
export async function buildProposeTransactions(chain: ChainReader, p: ProposeParams): Promise<Uint8Array[]> {
  const parts = await proposeParts(p);
  const approve = voteIx(p.multisig, p.member, parts.proposal, 'approve');
  const create = squadsIx(parts.createAccounts, [...DISC.vaultTransactionCreate, ...parts.createArgs(parts.messageBytes)]);
  const single = compileWire(p.member, p.blockhash, [create, parts.propose, approve]);
  if (single.length <= PACKET_DATA_SIZE) return [single];

  const bytes = parts.messageBytes;
  if (bytes.length > MAX_BUFFER_SIZE) throw new Error(`The inner transaction message is ${bytes.length} bytes, over the Squads buffer limit of ${MAX_BUFFER_SIZE}`);
  const bufferIndex = Number(p.transactionIndex % 256n);
  const buffer = await transactionBufferPda(p.multisig, p.member, bufferIndex);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  const bufferAccounts = [meta(p.multisig, AccountRole.READONLY), meta(buffer, AccountRole.WRITABLE), meta(p.member, AccountRole.READONLY_SIGNER)];
  const createBuffer = (chunk: Uint8Array) =>
    squadsIx(
      [...bufferAccounts.slice(0, 2), meta(p.member, AccountRole.READONLY_SIGNER), meta(p.member, AccountRole.WRITABLE_SIGNER), meta(SYSTEM_PROGRAM, AccountRole.READONLY)],
      [...DISC.transactionBufferCreate, bufferIndex, p.vaultIndex, ...hash, bytes.length & 0xff, bytes.length >> 8, ...u32(chunk.length), ...chunk],
    );
  const extend = (chunk: Uint8Array) => squadsIx(bufferAccounts, [...DISC.transactionBufferExtend, ...u32(chunk.length), ...chunk]);
  const close = squadsIx(
    [meta(p.multisig, AccountRole.READONLY), meta(buffer, AccountRole.WRITABLE), meta(p.member, AccountRole.WRITABLE_SIGNER)],
    [...DISC.transactionBufferClose],
  );

  const wires: Uint8Array[] = [];
  let offset = -1;
  const [existing] = await chain.getAccounts([buffer]);
  if (existing && existing.owner === SQUADS_PROGRAM_ID && isAccount(existing.data, 'transactionBuffer')) {
    const b = decodeTransactionBuffer(existing.data);
    const resumable =
      b.multisig === p.multisig &&
      b.creator === p.member &&
      b.vaultIndex === p.vaultIndex &&
      b.finalBufferSize === bytes.length &&
      equal(b.finalBufferHash, hash) &&
      b.buffer.length <= bytes.length &&
      equal(b.buffer, bytes.subarray(0, b.buffer.length));
    if (resumable) offset = b.buffer.length;
    else wires.push(toWire(p.member, p.blockhash, [close]));
  } else if (existing) {
    throw new Error(`Transaction buffer ${buffer} is not a Squads buffer`);
  }
  if (offset < 0) {
    const first = bytes.subarray(0, chunkRoom(p.member, p.blockhash, createBuffer));
    wires.push(toWire(p.member, p.blockhash, [createBuffer(first)]));
    offset = first.length;
  }
  const room = chunkRoom(p.member, p.blockhash, extend);
  for (; offset < bytes.length; offset += room) wires.push(toWire(p.member, p.blockhash, [extend(bytes.subarray(offset, offset + room))]));

  const fromBuffer = squadsIx(
    [...parts.createAccounts, meta(buffer, AccountRole.WRITABLE), meta(p.member, AccountRole.WRITABLE_SIGNER)],
    [...DISC.vaultTransactionCreateFromBuffer, ...parts.createArgs(EMPTY_MESSAGE)],
  );
  wires.push(toWire(p.member, p.blockhash, [fromBuffer, parts.propose, approve]));
  return wires;
}

const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Largest chunk that keeps a one-instruction buffer transaction within the packet limit. */
function chunkRoom(member: Address, blockhash: string, ix: (chunk: Uint8Array) => Instruction): number {
  const probe = 200; // same 2-byte compact length prefix as any chunk up to 16383 bytes
  return PACKET_DATA_SIZE - (compileWire(member, blockhash, [ix(new Uint8Array(probe))]).length - probe);
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
  return new Set(await Promise.all(Array.from({ length: count }, (_, i) => ephemeralSignerPda(transaction, i))));
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
  return toWire(p.member, p.blockhash, [...(account.data.length > LARGE_TRANSACTION ? LARGE_BUDGET : []), execute]);
}
