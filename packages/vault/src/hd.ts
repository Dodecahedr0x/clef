import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { utf8, zeroize } from './bytes';

const HARDENED = 0x80000000;

function assertIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED) throw new Error(`Invalid path index ${index}`);
}

/**
 * SLIP-0010 ed25519 derivation. Every segment is hardened (ed25519 has no non-hardened derivation),
 * so `path` lists unhardened indexes. Returns the 32-byte private key; intermediate material is zeroed.
 */
export function deriveEd25519(seed: Uint8Array, path: readonly number[]): Uint8Array {
  path.forEach(assertIndex);
  let I = hmac(sha512, utf8('ed25519 seed'), seed);
  let key = I.slice(0, 32);
  let chain = I.slice(32);
  zeroize(I);
  for (const index of path) {
    const data = new Uint8Array(37);
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, (index + HARDENED) >>> 0, false);
    I = hmac(sha512, chain, data);
    zeroize(key, chain, data);
    key = I.slice(0, 32);
    chain = I.slice(32);
    zeroize(I);
  }
  zeroize(chain);
  return key;
}

/** m/44'/501'/index'/0' -- the path used by Phantom, Solflare and Backpack. */
export function solanaPath(index: number): number[] {
  assertIndex(index);
  return [44, 501, index, 0];
}
