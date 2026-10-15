import { createKeyPairSignerFromPrivateKeyBytes, getBase58Encoder, type Address } from '@solana/kit';
import { zeroize } from './bytes';

export class InvalidSecretError extends Error {
  constructor(reason: string) {
    super(`Invalid secret key: ${reason}`);
    this.name = 'InvalidSecretError';
  }
}

function decode(input: string): Uint8Array {
  const text = input.trim();
  if (text.startsWith('[')) {
    let arr: unknown;
    try {
      arr = JSON.parse(text);
    } catch {
      throw new InvalidSecretError('malformed JSON array');
    }
    if (!Array.isArray(arr) || !arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      throw new InvalidSecretError('expected an array of bytes');
    }
    return Uint8Array.from(arr as number[]);
  }
  try {
    return new Uint8Array(getBase58Encoder().encode(text));
  } catch {
    throw new InvalidSecretError('not base58');
  }
}

/**
 * Accepts a 64-byte secret key (Phantom's base58 export, or the Solana CLI JSON array) and verifies
 * that its public half matches its private half. Returns the 32-byte private key; the input copy is zeroed.
 */
export async function parseSecretKey(input: string): Promise<{ address: Address; privateKey: Uint8Array }> {
  const bytes = decode(input);
  try {
    if (bytes.length !== 64) throw new InvalidSecretError('expected 64 bytes');
    const privateKey = bytes.slice(0, 32);
    const signer = await createKeyPairSignerFromPrivateKeyBytes(privateKey, true);
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', signer.keyPair.publicKey));
    if (!pub.every((b, i) => b === bytes[32 + i])) {
      zeroize(privateKey);
      throw new InvalidSecretError('public key does not match');
    }
    return { address: signer.address, privateKey };
  } finally {
    zeroize(bytes);
  }
}
