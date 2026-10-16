import {
  getPublicKeyFromAddress,
  getTransactionDecoder,
  getTransactionEncoder,
  verifySignature,
  type Address,
  type SignatureBytes,
} from '@solana/kit';
import { NotASignerError } from './software';

export * from './errors';

export async function verifyEd25519(message: Uint8Array, signature: Uint8Array, address: Address): Promise<boolean> {
  if (signature.length !== 64) return false;
  try {
    return await verifySignature(await getPublicKeyFromAddress(address), signature as SignatureBytes, message);
  } catch {
    return false;
  }
}

/** The bytes a signer signs: the serialized message of a wire transaction. */
export function transactionMessageBytes(wire: Uint8Array): Uint8Array {
  return new Uint8Array(getTransactionDecoder().decode(wire).messageBytes);
}

/** Places an externally produced signature in `address`'s slot. Callers verify it first (verifyEd25519). */
export function attachSignature(wire: Uint8Array, address: Address, signature: Uint8Array): Uint8Array {
  const tx = getTransactionDecoder().decode(wire);
  if (!Object.hasOwn(tx.signatures, address)) throw new NotASignerError(address);
  if (signature.length !== 64) throw new Error(`Expected a 64-byte signature, got ${signature.length}`);
  const signatures = { ...tx.signatures, [address]: new Uint8Array(signature) as SignatureBytes };
  return new Uint8Array(getTransactionEncoder().encode({ ...tx, signatures }));
}
