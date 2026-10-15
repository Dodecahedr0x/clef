import type { ChainReader } from '@clef/rpc';
import {
  getAddressDecoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Address,
} from '@solana/kit';
import type { AccountRef, DecodedTransaction } from './types';

const LOOKUP_TABLE_META_SIZE = 56;

type Lookup = { lookupTableAddress: Address; writableIndexes: readonly number[]; readonlyIndexes: readonly number[] };
type Loaded = { writable: Address[]; readonly: Address[] };

async function resolveLookups(lookups: readonly Lookup[], reader: ChainReader): Promise<Loaded> {
  const tables = await reader.getAccounts(lookups.map((l) => l.lookupTableAddress));
  const decoder = getAddressDecoder();
  const loaded: Loaded = { writable: [], readonly: [] };
  lookups.forEach((lookup, i) => {
    const table = tables[i];
    if (!table) throw new Error(`Address lookup table ${lookup.lookupTableAddress} not found`);
    const at = (index: number) => decoder.decode(table.data, LOOKUP_TABLE_META_SIZE + index * 32);
    loaded.writable.push(...lookup.writableIndexes.map(at));
    loaded.readonly.push(...lookup.readonlyIndexes.map(at));
  });
  return loaded;
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

  const { numSignerAccounts, numReadonlySignerAccounts, numReadonlyNonSignerAccounts } = msg.header;
  const statics = msg.staticAccounts;
  const accounts: AccountRef[] = statics.map((address, i) => ({
    address,
    signer: i < numSignerAccounts,
    writable:
      i < numSignerAccounts
        ? i < numSignerAccounts - numReadonlySignerAccounts
        : i < statics.length - numReadonlyNonSignerAccounts,
  }));

  // Same order as kit's decompiler and the runtime's `loadedAddresses`: every table's writable
  // addresses (in lookup order), then every table's readonly addresses.
  const lookups: readonly Lookup[] = msg.version === 0 ? (msg.addressTableLookups ?? []) : [];
  if (lookups.length) {
    const resolved = loaded ?? (await resolveLookups(lookups, reader));
    const tablesFor = (key: 'writableIndexes' | 'readonlyIndexes') =>
      lookups.flatMap((l) => l[key].map(() => l.lookupTableAddress));
    const writableTables = tablesFor('writableIndexes');
    const readonlyTables = tablesFor('readonlyIndexes');
    accounts.push(
      ...resolved.writable.map((address, i) => ({ address, signer: false, writable: true, lookupTable: writableTables[i]! })),
      ...resolved.readonly.map((address, i) => ({ address, signer: false, writable: false, lookupTable: readonlyTables[i]! })),
    );
  }

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
