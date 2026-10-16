import { NotASignerError } from '@clef/signers';
import { getPublicKeyFromAddress, getTransactionDecoder, getTransactionEncoder, verifySignature, type Address, type SignatureBytes } from '@solana/kit';

export async function verifyEd25519(message: Uint8Array, signature: Uint8Array, address: Address): Promise<boolean> {
  if (signature.length !== 64) return false;
  try {
    return await verifySignature(await getPublicKeyFromAddress(address), signature as SignatureBytes, message);
  } catch {
    return false;
  }
}

export const transactionMessageBytes = (wire: Uint8Array): Uint8Array => new Uint8Array(getTransactionDecoder().decode(wire).messageBytes);

export function attachSignature(wire: Uint8Array, address: Address, signature: Uint8Array): Uint8Array {
  const tx = getTransactionDecoder().decode(wire);
  if (!Object.hasOwn(tx.signatures, address)) throw new NotASignerError(address);
  return new Uint8Array(getTransactionEncoder().encode({ ...tx, signatures: { ...tx.signatures, [address]: signature as SignatureBytes } }));
}
