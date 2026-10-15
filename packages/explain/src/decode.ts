import type { ChainReader } from '@clef/rpc';
import {
  getAddressDecoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Address,
} from '@solana/kit';
import type { AccountRef, DecodedTransaction } from './types';

const LOOKUP_TABLE_PROGRAM = 'AddressLookupTab1e1111111111111111111111111';
const LOOKUP_TABLE_META_SIZE = 56;
/** `ProgramState::LookupTable` (u32 LE at offset 0); 0 is `Uninitialized`. */
const LOOKUP_TABLE_DISCRIMINATOR = 1;

type Lookup = { lookupTableAddress: Address; writableIndexes: readonly number[]; readonlyIndexes: readonly number[] };
type Loaded = { writable: Address[]; readonly: Address[] };
type Header = { numSignerAccounts: number; numReadonlySignerAccounts: number; numReadonlyNonSignerAccounts: number };
type CompiledInstruction = { programAddressIndex: number; accountIndices?: readonly number[] };

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
 * Decodes a wire transaction into a flat account list and instructions.
 * `loaded` (from tx meta) takes precedence over fetching lookup tables, which may have changed since.
 */
export async function decodeTransaction(wire: Uint8Array, reader: ChainReader, loaded?: Loaded): Promise<DecodedTransaction> {
  const tx = getTransactionDecoder().decode(wire);
  const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  if (msg.version !== 'legacy' && msg.version !== 0) {
    throw new Error(`Unsupported transaction version ${String(msg.version)}`);
  }

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
  sanitizeMessage(msg, [...resolved.writable, ...resolved.readonly]);

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
    instructions: msg.instructions.map((ix, index) => ({
      index,
      programId: account(ix.programAddressIndex).address,
      accounts: (ix.accountIndices ?? []).map(account),
      data: new Uint8Array(ix.data ?? []),
    })),
    wire,
  };
}
