import {
  appendTransactionMessageInstruction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Blockhash,
  type TransactionSigner,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';

export async function transferWire(
  from: TransactionSigner,
  to: Address,
  amount: bigint,
  latest: { blockhash: string; lastValidBlockHeight: bigint },
): Promise<Uint8Array> {
  const tx = await signTransactionMessageWithSigners(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(from, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: latest.blockhash as Blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, m),
      (m) => appendTransactionMessageInstruction(getTransferSolInstruction({ source: from, destination: to, amount: lamports(amount) }), m),
    ),
  );
  return new Uint8Array(getBase64Encoder().encode(getBase64EncodedWireTransaction(tx)));
}
