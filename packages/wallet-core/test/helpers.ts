import { getTransferSolInstruction } from '@solana-program/system';
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
} from '@solana/kit';

const BLOCKHASH = 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k' as Blockhash;
export const OTHER = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');

/** An unsigned v0 SOL transfer from `from` (also the fee payer) to OTHER. */
export function sampleWire(from: Address = address('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk')): Uint8Array {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(from, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstructions([getTransferSolInstruction({ source: createNoopSigner(from), destination: OTHER, amount: 1n })], m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}
