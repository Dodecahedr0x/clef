import {
  getAddressEncoder,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getTransactionDecoder,
  type Address,
  type Blockhash,
} from '@solana/kit';
import type { VaultMessage } from './accounts';

/** Reads a wire transaction (signatures + message) into the Squads vault message shape. */
export function vaultMessageFromWire(wire: Uint8Array): VaultMessage {
  const { messageBytes } = getTransactionDecoder().decode(wire);
  const msg = getCompiledTransactionMessageDecoder().decode(messageBytes);
  if (msg.version !== 0 && msg.version !== 'legacy') throw new Error(`Unsupported inner transaction version ${String(msg.version)}`);
  const { numSignerAccounts: s, numReadonlySignerAccounts: rs, numReadonlyNonSignerAccounts: rn } = msg.header;
  const lookups = msg.version === 0 ? (msg.addressTableLookups ?? []) : [];
  return {
    numSigners: s,
    numWritableSigners: s - rs,
    numWritableNonSigners: msg.staticAccounts.length - s - rn,
    accountKeys: [...msg.staticAccounts],
    instructions: msg.instructions.map((ix) => ({
      programIdIndex: ix.programAddressIndex,
      accountIndexes: new Uint8Array(ix.accountIndices ?? []),
      data: new Uint8Array(ix.data ?? []),
    })),
    addressTableLookups: lookups.map((l) => ({
      accountKey: l.lookupTableAddress,
      writableIndexes: new Uint8Array(l.writableIndexes),
      readonlyIndexes: new Uint8Array(l.readonlyIndexes),
    })),
  };
}

/** Squads' compact `TransactionMessage` (u8 / u16 length prefixes) passed to `vault_transaction_create`. */
export function encodeTransactionMessage(m: VaultMessage): Uint8Array {
  const out: number[] = [];
  const u8 = (n: number) => {
    if (!Number.isInteger(n) || n < 0 || n > 0xff) throw new RangeError('Inner transaction too large for a Squads message');
    out.push(n);
  };
  const small = (b: Uint8Array) => {
    u8(b.length);
    out.push(...b);
  };
  const key = (a: Address) => out.push(...getAddressEncoder().encode(a));
  u8(m.numSigners);
  u8(m.numWritableSigners);
  u8(m.numWritableNonSigners);
  u8(m.accountKeys.length);
  m.accountKeys.forEach(key);
  u8(m.instructions.length);
  for (const ix of m.instructions) {
    u8(ix.programIdIndex);
    small(ix.accountIndexes);
    if (ix.data.length > 0xffff) throw new RangeError('Inner instruction data too large');
    out.push(ix.data.length & 0xff, ix.data.length >> 8, ...ix.data);
  }
  u8(m.addressTableLookups.length);
  for (const l of m.addressTableLookups) {
    key(l.accountKey);
    small(l.writableIndexes);
    small(l.readonlyIndexes);
  }
  return new Uint8Array(out);
}

const ZERO_BLOCKHASH = '11111111111111111111111111111111' as Blockhash;

/** The vault message as v0 compiled message bytes (all-zero blockhash), for explaining a proposal. */
export function vaultMessageToV0(m: VaultMessage): Uint8Array {
  return new Uint8Array(
    getCompiledTransactionMessageEncoder().encode({
      version: 0,
      header: {
        numSignerAccounts: m.numSigners,
        numReadonlySignerAccounts: m.numSigners - m.numWritableSigners,
        numReadonlyNonSignerAccounts: m.accountKeys.length - m.numSigners - m.numWritableNonSigners,
      },
      staticAccounts: m.accountKeys,
      lifetimeToken: ZERO_BLOCKHASH,
      instructions: m.instructions.map((ix) => ({
        programAddressIndex: ix.programIdIndex,
        accountIndices: [...ix.accountIndexes],
        data: ix.data,
      })),
      addressTableLookups: m.addressTableLookups.map((l) => ({
        lookupTableAddress: l.accountKey,
        writableIndexes: [...l.writableIndexes],
        readonlyIndexes: [...l.readonlyIndexes],
      })),
    }),
  );
}
