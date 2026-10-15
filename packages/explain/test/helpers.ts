import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getAddressEncoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from '@solana/kit';
import type { MemoryChainReader } from '@clef/rpc';

export const ME = address('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
export const OTHER = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
export const BLOCKHASH = 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k' as Blockhash;

/** Builds an unsigned wire transaction (v0) from kit instructions. */
export function buildWire(
  instructions: Instruction[],
  opts: { feePayer?: Address; lookupTables?: Record<Address, Address[]> } = {},
): Uint8Array {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(opts.feePayer ?? ME, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const compressed = opts.lookupTables
    ? compressTransactionMessageUsingAddressLookupTables(message, opts.lookupTables)
    : message;
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(compressed)));
}

/** Stores an address lookup table account (56-byte header + 32-byte addresses). */
export function setLookupTable(reader: MemoryChainReader, table: Address, addresses: Address[]): void {
  const data = new Uint8Array(56 + 32 * addresses.length);
  addresses.forEach((a, i) => data.set(getAddressEncoder().encode(a), 56 + 32 * i));
  reader.setAccount({ address: table, owner: address('AddressLookupTab1e1111111111111111111111111'), data });
}
