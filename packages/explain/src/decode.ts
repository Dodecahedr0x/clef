import type { ChainReader } from '@clef/rpc';
import {
  getAddressDecoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Address,
  type V1CompiledTransactionMessage,
} from '@solana/kit';
import type { AccountRef, DecodedTransaction, V1Config } from './types';

const LOOKUP_TABLE_PROGRAM = 'AddressLookupTab1e1111111111111111111111111';
const LOOKUP_TABLE_META_SIZE = 56;
/** `ProgramState::LookupTable` (u32 LE at offset 0); 0 is `Uninitialized`. */
const LOOKUP_TABLE_DISCRIMINATOR = 1;

type Lookup = { lookupTableAddress: Address; writableIndexes: readonly number[]; readonlyIndexes: readonly number[] };
type Loaded = { writable: Address[]; readonly: Address[] };
type Header = { numSignerAccounts: number; numReadonlySignerAccounts: number; numReadonlyNonSignerAccounts: number };
type CompiledInstruction = { programAddressIndex: number; accountIndices?: readonly number[]; data?: Uint8Array | ArrayLike<number> };

async function resolveLookups(lookups: readonly Lookup[], reader: ChainReader): Promise<Loaded> {
  const tables = await reader.getAccounts(lookups.map((l) => l.lookupTableAddress));
  const decoder = getAddressDecoder();
  const loaded: Loaded = { writable: [], readonly: [] };
  lookups.forEach((lookup, i) => {
    const name = lookup.lookupTableAddress;
    const table = tables[i];
    if (!table) throw new Error(`Address lookup table ${name} not found`);
    if (table.owner !== LOOKUP_TABLE_PROGRAM) {
      throw new Error(`Address lookup table ${name} is not owned by the address lookup table program`);
    }
    const { data } = table;
    if (data.length < LOOKUP_TABLE_META_SIZE || (data.length - LOOKUP_TABLE_META_SIZE) % 32 !== 0) {
      throw new Error(`Address lookup table ${name} has an invalid size (${data.length} bytes)`);
    }
    const discriminator = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true);
    if (discriminator !== LOOKUP_TABLE_DISCRIMINATOR) {
      throw new Error(`Account ${name} is not an initialized address lookup table`);
    }
    const count = (data.length - LOOKUP_TABLE_META_SIZE) / 32;
    const at = (index: number) => {
      if (index >= count) throw new Error(`Address lookup table ${name}: index ${index} out of range (${count} addresses)`);
      return decoder.decode(data, LOOKUP_TABLE_META_SIZE + index * 32);
    };
    loaded.writable.push(...lookup.writableIndexes.map(at));
    loaded.readonly.push(...lookup.readonlyIndexes.map(at));
  });
  return loaded;
}

const malformed = (reason: string) => new Error(`malformed transaction: ${reason}`);

/** Rejects messages the runtime would reject, so that nothing downstream explains an impossible transaction. */
function sanitizeMessage(
  msg: { header: Header; staticAccounts: readonly Address[]; instructions: readonly CompiledInstruction[] },
  loaded: readonly Address[],
): void {
  const { header, staticAccounts: statics } = msg;
  if (!statics.length) throw malformed('no static accounts');
  if (header.numSignerAccounts < 1) throw malformed('no signers');
  if (header.numReadonlySignerAccounts >= header.numSignerAccounts) throw malformed('fee payer is not writable');
  if (header.numSignerAccounts + header.numReadonlyNonSignerAccounts > statics.length) {
    throw malformed('header exceeds static accounts');
  }
  const seen = new Set<string>();
  for (const a of [...statics, ...loaded]) {
    if (seen.has(a)) throw malformed(`duplicate account ${a}`);
    seen.add(a);
  }
  const total = statics.length + loaded.length;
  for (const ix of msg.instructions) {
    // Programs must be static (not loaded from a table) and cannot be the fee payer.
    if (ix.programAddressIndex <= 0 || ix.programAddressIndex >= statics.length) {
      throw malformed(`invalid program index ${ix.programAddressIndex}`);
    }
    for (const i of ix.accountIndices ?? []) {
      if (i >= total) throw malformed(`account index ${i} out of range`);
    }
  }
}

/**
 * v1 config fields by mask bit, in `configValues` order (SIMD-0385; kit's `decompileTransactionConfig`). The
 * priority fee takes bits 0 and 1 (both or neither) and one u64 value; every other field one bit and one u32.
 */
const PRIORITY_FEE_BITS = 0b11;
const V1_FIELDS = [
  { name: 'priorityFeeLamports', bits: PRIORITY_FEE_BITS, kind: 'u64' },
  { name: 'computeUnitLimit', bits: 0b100, kind: 'u32' },
  { name: 'loadedAccountsDataSizeLimit', bits: 0b1000, kind: 'u32' },
  { name: 'heapSize', bits: 0b10000, kind: 'u32' },
] as const;
const KNOWN_CONFIG_BITS = V1_FIELDS.reduce((mask, f) => mask | f.bits, 0);
/** The runtime's heap frame bounds: a requested size must be a multiple of 1 KiB within them. */
const MIN_HEAP = 32 * 1024;
const MAX_HEAP = 256 * 1024;

/** SIMD-0385 transaction constraints: violations are sanitization failures. */
const V1_MAX_WIRE_BYTES = 4096;
const V1_MAX_SIGNERS = 12;
const V1_MAX_ACCOUNTS = 64;
const V1_MAX_INSTRUCTIONS = 64;
/** Message offset of the v1 config mask (u32 LE): after the version byte and the 3-byte header. */
const V1_CONFIG_MASK_OFFSET = 4;
const V1_VERSION_BYTE = 0x81;

/** The mask, if it uses only known bits and sets the priority fee's two bits together. */
function checkConfigMask(configMask: number): number {
  const mask = configMask >>> 0;
  if (mask & ~KNOWN_CONFIG_BITS) throw malformed(`unknown config bits 0x${((mask & ~KNOWN_CONFIG_BITS) >>> 0).toString(16)}`);
  const fee = mask & PRIORITY_FEE_BITS;
  if (fee !== 0 && fee !== PRIORITY_FEE_BITS) throw malformed('priority fee needs both config bits');
  return mask;
}

const popcount = (n: number) => {
  let count = 0;
  for (let v = n >>> 0; v; v >>>= 1) count += v & 1;
  return count;
};

/**
 * A v1 message's config and instructions, checked for consistency: the counts the message declares must match
 * what it carries, and the config may only use bits Clef (and kit) know. Exported for tests: kit's decoder
 * builds consistent counts from wire bytes, so only hand-made messages can break them.
 */
export function flattenV1(msg: Omit<V1CompiledTransactionMessage, 'version'>): { config: V1Config; instructions: CompiledInstruction[] } {
  if (msg.header.numSignerAccounts > V1_MAX_SIGNERS) throw malformed(`more than ${V1_MAX_SIGNERS} signers`);
  if (msg.numStaticAccounts !== msg.staticAccounts.length) throw malformed('static account count mismatch');
  if (msg.numStaticAccounts > V1_MAX_ACCOUNTS) throw malformed(`more than ${V1_MAX_ACCOUNTS} accounts`);
  if (msg.numInstructions > V1_MAX_INSTRUCTIONS) throw malformed(`more than ${V1_MAX_INSTRUCTIONS} instructions`);
  const mask = checkConfigMask(msg.configMask);
  // Each value is one 4-byte word per mask bit.
  const words = msg.configValues.reduce((n, v) => n + (v.kind === 'u64' ? 2 : 1), 0);
  if (words !== popcount(mask)) throw malformed('config value count does not match the config mask');
  const config: Record<string, number | bigint> = {};
  let at = 0;
  for (const field of V1_FIELDS) {
    if (!(mask & field.bits)) continue;
    const value = msg.configValues[at++];
    if (!value || value.kind !== field.kind) throw malformed(`config ${field.name} is not a ${field.kind}`);
    config[field.name] = value.value;
  }
  const heap = config.heapSize;
  if (typeof heap === 'number' && (heap % 1024 !== 0 || heap < MIN_HEAP || heap > MAX_HEAP)) {
    throw malformed(`invalid heap size ${heap}`);
  }

  if (msg.numInstructions !== msg.instructionHeaders.length || msg.numInstructions !== msg.instructionPayloads.length) {
    throw malformed('instruction count mismatch');
  }
  const instructions = msg.instructionHeaders.map((header, i) => {
    const payload = msg.instructionPayloads[i]!;
    if (payload.instructionAccountIndices.length !== header.numInstructionAccounts) {
      throw malformed(`instruction ${i}: account count mismatch`);
    }
    if (payload.instructionData.length !== header.numInstructionDataBytes) {
      throw malformed(`instruction ${i}: data length mismatch`);
    }
    return { programAddressIndex: header.programAccountIndex, accountIndices: payload.instructionAccountIndices, data: payload.instructionData };
  });
  return { config: config as V1Config, instructions };
}

/**
 * Decodes a wire transaction into a flat account list and instructions.
 * `loaded` (from tx meta) takes precedence over fetching lookup tables, which may have changed since.
 */
export async function decodeTransaction(wire: Uint8Array, reader: ChainReader, loaded?: Loaded): Promise<DecodedTransaction> {
  const tx = getTransactionDecoder().decode(wire);
  if (tx.messageBytes[0] === V1_VERSION_BYTE) {
    if (wire.length > V1_MAX_WIRE_BYTES) throw malformed(`${wire.length} bytes exceeds the v1 limit of ${V1_MAX_WIRE_BYTES}`);
    // Checked before kit decodes the message: kit skips unknown bits, so value words padded in for them would be
    // read as instruction headers, and it reports a lone priority fee bit with its own error.
    const bytes = tx.messageBytes;
    if (bytes.length < V1_CONFIG_MASK_OFFSET + 4) throw malformed('message too short');
    checkConfigMask(new DataView(bytes.buffer, bytes.byteOffset + V1_CONFIG_MASK_OFFSET, 4).getUint32(0, true));
  }
  const [msg, end] = getCompiledTransactionMessageDecoder().read(tx.messageBytes, 0);
  if (msg.version !== 'legacy' && msg.version !== 0 && msg.version !== 1) {
    throw new Error(`Unsupported transaction version ${String((msg as { version: unknown }).version)}`);
  }
  // v1 forbids trailing data; kit's envelope decoder would hand it over as message bytes.
  if (msg.version === 1 && end !== tx.messageBytes.length) throw malformed('trailing bytes after the message');
  const v1 = msg.version === 1 ? flattenV1(msg) : undefined;
  const compiled: readonly CompiledInstruction[] = msg.version === 1 ? v1!.instructions : msg.instructions;

  // Same order as kit's decompiler and the runtime's `loadedAddresses`: every table's writable
  // addresses (in lookup order), then every table's readonly addresses.
  const lookups: readonly Lookup[] = msg.version === 0 ? (msg.addressTableLookups ?? []) : [];
  const writableTables = lookups.flatMap((l) => l.writableIndexes.map(() => l.lookupTableAddress));
  const readonlyTables = lookups.flatMap((l) => l.readonlyIndexes.map(() => l.lookupTableAddress));
  const resolved: Loaded =
    loaded ?? (lookups.length ? await resolveLookups(lookups, reader) : { writable: [], readonly: [] });
  if (resolved.writable.length !== writableTables.length || resolved.readonly.length !== readonlyTables.length) {
    throw new Error('lookup table address count mismatch');
  }
  sanitizeMessage({ header: msg.header, staticAccounts: msg.staticAccounts, instructions: compiled }, [...resolved.writable, ...resolved.readonly]);

  const { numSignerAccounts, numReadonlySignerAccounts, numReadonlyNonSignerAccounts } = msg.header;
  const statics = msg.staticAccounts;
  const accounts: AccountRef[] = [
    ...statics.map((address, i) => ({
      address,
      signer: i < numSignerAccounts,
      writable:
        i < numSignerAccounts
          ? i < numSignerAccounts - numReadonlySignerAccounts
          : i < statics.length - numReadonlyNonSignerAccounts,
    })),
    ...resolved.writable.map((address, i) => ({ address, signer: false, writable: true, lookupTable: writableTables[i] })),
    ...resolved.readonly.map((address, i) => ({ address, signer: false, writable: false, lookupTable: readonlyTables[i] })),
  ];

  const account = (i: number): AccountRef => {
    const a = accounts[i];
    if (!a) throw new Error(`Instruction references missing account index ${i}`);
    return a;
  };

  return {
    version: msg.version,
    feePayer: statics[0]!,
    recentBlockhash: msg.lifetimeToken,
    accounts,
    ...(v1 && { config: v1.config }),
    instructions: compiled.map((ix, index) => ({
      index,
      programId: account(ix.programAddressIndex).address,
      accounts: (ix.accountIndices ?? []).map(account),
      data: new Uint8Array(ix.data ?? []),
    })),
    wire,
  };
}
