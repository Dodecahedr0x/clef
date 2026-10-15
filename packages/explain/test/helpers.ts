import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getAddressEncoder,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getShortU16Encoder,
  getTransactionDecoder,
  getTransactionEncoder,
  none,
  pipe,
  some,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from '@solana/kit';
import type { MemoryChainReader, RawAccount } from '@clef/rpc';
import { AccountState, getTokenEncoder } from '@solana-program/token';

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

export const LOOKUP_TABLE_PROGRAM = address('AddressLookupTab1e1111111111111111111111111');

/** Stores an address lookup table account (56-byte header + 32-byte addresses). */
export function setLookupTable(reader: MemoryChainReader, table: Address, addresses: Address[]): void {
  const data = new Uint8Array(56 + 32 * addresses.length);
  data[0] = 1; // u32 LE discriminator: LookupTable
  addresses.forEach((a, i) => data.set(getAddressEncoder().encode(a), 56 + 32 * i));
  reader.setAccount({ address: table, owner: LOOKUP_TABLE_PROGRAM, data });
}

type AnyCompiledMessage = ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>['decode']>;
export type CompiledMessage = Extract<AnyCompiledMessage, { version: 'legacy' | 0 }>;

/**
 * Re-encodes `wire` after `mutate` edits its compiled message, with zeroed signatures. Lets tests build
 * messages that kit's message builder refuses to produce (bad headers, duplicate keys, bad indices).
 */
export function rewire(wire: Uint8Array, mutate: (m: CompiledMessage) => CompiledMessage): Uint8Array {
  const tx = getTransactionDecoder().decode(wire);
  const decoded = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  if (decoded.version !== 'legacy' && decoded.version !== 0) throw new Error('rewire supports legacy and v0 only');
  const msg = mutate(decoded);
  const messageBytes = getCompiledTransactionMessageEncoder().encode(msg);
  const signatures = Math.min(msg.header.numSignerAccounts, msg.staticAccounts.length);
  return new Uint8Array([...getShortU16Encoder().encode(signatures), ...new Uint8Array(64 * signatures), ...messageBytes]);
}

export const USDC = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

export function tokenAccountData(
  owner: Address = ME,
  mint: Address = USDC,
  amount = 10n,
  extra: { delegate?: Address; delegatedAmount?: bigint; closeAuthority?: Address } = {},
): Uint8Array {
  return new Uint8Array(
    getTokenEncoder().encode({
      mint, owner, amount, delegate: extra.delegate ? some(extra.delegate) : none(), state: AccountState.Initialized,
      isNative: none(), delegatedAmount: extra.delegatedAmount ?? 0n,
      closeAuthority: extra.closeAuthority ? some(extra.closeAuthority) : none(),
    }),
  );
}

/**
 * Simulates by applying `changes` (each instruction's effect) to the reader's accounts, then charging the fee to
 * the fee payer as the runtime does: 5000 lamports per signature unless `opts.fee` says otherwise.
 */
export function simulateWith(
  reader: MemoryChainReader,
  changes: Record<string, Partial<RawAccount>>,
  opts: { fee?: bigint } = {},
): void {
  reader.simulateImpl = async (wire, addresses) => {
    const msg = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(wire).messageBytes) as CompiledMessage;
    const payer = msg.staticAccounts[0];
    const fee = opts.fee ?? 5000n * BigInt(msg.header.numSignerAccounts);
    return {
      err: null, logs: [], unitsConsumed: 1000n,
      postAccounts: addresses.map((a) => {
        const before = reader.accounts.get(a);
        const change = changes[a];
        const after: RawAccount | null = change
          ? { address: a, owner: before?.owner ?? OTHER, lamports: before?.lamports ?? 0n, data: before?.data ?? new Uint8Array(), executable: false, ...change }
          : before ? structuredClone(before) : null;
        return after && a === payer ? { ...after, lamports: after.lamports - fee } : after;
      }),
    };
  };
}
